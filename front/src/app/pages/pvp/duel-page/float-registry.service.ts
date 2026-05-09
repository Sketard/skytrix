import { Injectable, OnDestroy } from '@angular/core';

interface InFlightEntry {
  animation: Animation;
  resolve: () => void;
}

/**
 * Tracks the lifecycle of card-travel float elements created by
 * `CardTravelEngine.travel()`. Split from CardTravelService (M11 Phase 2)
 * so the Engine focuses on geometry/keyframes/animation kickoff while
 * this service owns the post-animation registry — in-flight Map and
 * landed Set — plus all the LIFO/FIFO matching, prefix queries, and
 * lifecycle cleanup the orchestrator and managers depend on.
 *
 * `register(el, animation, onLand?)` is the single entry point for
 * adding a float to the registry. It:
 *  - inserts `el` into `_inFlight` immediately,
 *  - on `animation.finished` success: removes from `_inFlight`, runs the
 *    optional `onLand` hook (e.g. slam-dust particles), adds to `_landed`,
 *    resolves the returned promise,
 *  - on `animation.cancel()` rejection: removes from `_inFlight`, resolves.
 *
 * The animation is deliberately NOT re-added to `_landed` on cancel — a
 * cancelled travel never visually lands.
 */
@Injectable()
export class FloatRegistryService implements OnDestroy {
  private readonly _inFlight = new Map<HTMLDivElement, InFlightEntry>();
  private readonly _landed = new Set<HTMLDivElement>();

  /**
   * Register a freshly-animated float. Returns a promise that resolves
   * when the animation finishes OR is cancelled — never rejects (a
   * cancel resolves so the queue never hangs).
   */
  register(el: HTMLDivElement, animation: Animation, onLand?: () => void): Promise<void> {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    this._inFlight.set(el, { animation, resolve });
    animation.finished.then(() => {
      this._inFlight.delete(el);
      onLand?.();
      this._landed.add(el);
      resolve();
    }).catch(() => {
      this._inFlight.delete(el);
      resolve();
    });
    return promise;
  }

  // ---------------------------------------------------------------------------
  // Read-only counters / probes
  // ---------------------------------------------------------------------------

  landedCount(): number { return this._landed.size; }
  inFlightCount(): number { return this._inFlight.size; }

  /** Return the most recently landed float element (if any). */
  getLastLandedFloat(): HTMLElement | null {
    let last: HTMLElement | null = null;
    for (const el of this._landed) last = el;
    return last;
  }

  /**
   * Remove and return a landed float matching the given filters.
   *
   * @param dstPrefix When provided, restricts to floats whose `dstKey` starts
   *   with the prefix (e.g., 'HAND', 'GRAVE-0').
   * @param cardCode When provided, restricts to floats whose `dataset.cardCode`
   *   matches — used by `confirmCardsInHand` so an interleaved per-card
   *   CONFIRM reveals the correct ghost.
   *
   * Strategy:
   *   - With `cardCode`: LIFO — return the MOST RECENTLY added matching
   *     float. An interleaved confirm always runs right after its tutor
   *     lands, so the newest matching float is the correct ghost. Critical
   *     when the same cardCode is tutored multiple times: FIFO would
   *     re-pop the previously revealed-and-returned float (via
   *     `returnToLanded`) instead of the freshly landed one.
   *   - Without `cardCode`: FIFO — preserves behavior for non-interleaved
   *     paths (shuffle-hand, opponent face-down reveals where the float
   *     wasn't tagged with a cardCode).
   */
  popLandedFloat(dstPrefix?: string, cardCode?: number): HTMLElement | null {
    if (cardCode !== undefined) {
      let match: HTMLDivElement | null = null;
      for (const el of this._landed) {
        if (dstPrefix && !el.dataset['dstKey']?.startsWith(dstPrefix)) continue;
        if (el.dataset['cardCode'] !== String(cardCode)) continue;
        match = el;
      }
      if (match) this._landed.delete(match);
      return match;
    }
    for (const el of this._landed) {
      if (dstPrefix && !el.dataset['dstKey']?.startsWith(dstPrefix)) continue;
      this._landed.delete(el);
      return el;
    }
    return null;
  }

  /**
   * Return (without removing) all landed floats whose dstKey starts with the
   * given prefix. Used by `processShuffleEvent` to match every newly-added
   * card to its post-shuffle DOM position in multi-tutor scenarios.
   */
  getLandedFloatsByDstPrefix(prefix: string): HTMLDivElement[] {
    const out: HTMLDivElement[] = [];
    for (const el of this._landed) {
      if (el.dataset['dstKey']?.startsWith(prefix)) out.push(el);
    }
    return out;
  }

  /**
   * Cancel running animations on a float and pin it at its current visual
   * position using fixed CSS coords. `baseRotateCSS` (e.g. 'rotateZ(180deg)')
   * is preserved so opponent cards keep facing their owner.
   * Returns the rect captured before cancellation.
   */
  stabilizeFloat(el: HTMLElement, baseRotateCSS: string): DOMRect {
    const rect = el.getBoundingClientRect();
    el.getAnimations().forEach(a => a.cancel());
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.transform = baseRotateCSS;
    return rect;
  }

  /** Re-add a previously popped float to the landed set for deferred cleanup. */
  returnToLanded(el: HTMLDivElement): void {
    this._landed.add(el);
  }

  /** Remove all landed floats whose dstKey starts with the given prefix, or all if no prefix. */
  clearLandedByDstPrefix(prefix?: string): void {
    for (const el of this._landed) {
      if (!prefix || (el.dataset['dstKey']?.startsWith(prefix))) {
        el.remove();
        this._landed.delete(el);
      }
    }
  }

  /** Remove all travel elements whose animations have finished. */
  clearLandedTravels(): void {
    for (const el of this._landed) el.remove();
    this._landed.clear();
  }

  /** Map of zone keys → in-flight travel elements for lock assertion ([LOCK-ASSERT]). */
  inFlightByZone(): Map<string, HTMLDivElement[]> {
    const byZone = new Map<string, HTMLDivElement[]>();
    for (const [el] of this._inFlight) {
      const key = el.dataset['dstKey'];
      if (key) {
        const list = byZone.get(key);
        if (list) list.push(el);
        else byZone.set(key, [el]);
      }
    }
    return byZone;
  }

  /** Cancel any in-flight travel whose dstKey matches. Used to abort a travel
   *  scheduled by a setTimeout that fired after the orchestrator started a reset. */
  cancelTravel(dstKey: string): void {
    for (const [el, { animation, resolve }] of this._inFlight) {
      if (el.dataset['dstKey'] === dstKey) {
        animation.cancel();
        el.remove();
        resolve();
        this._inFlight.delete(el);
      }
    }
  }

  /** Cancel all in-flight animations and remove all travel elements.
   *  Cancel (not finish) so the registered .finished.then() does not
   *  asynchronously re-add the element to _landed after we cleared it. */
  clearAllTravels(): void {
    for (const [el, { animation, resolve }] of this._inFlight) {
      animation.cancel();
      el.remove();
      resolve();
    }
    this._inFlight.clear();
    this.clearLandedTravels();
  }

  ngOnDestroy(): void {
    for (const [el, { animation, resolve }] of this._inFlight) {
      animation.cancel();
      el.remove();
      resolve();
    }
    this._inFlight.clear();
    this.clearLandedTravels();
  }
}
