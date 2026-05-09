import { Injectable, OnDestroy, inject } from '@angular/core';
import { toCardRect, buildTravelKeyframes } from './card-travel-helpers';
import { BoardEffectsService } from './board-effects.service';

export interface TravelOptions {
  showBack?: boolean;
  flipDuringTravel?: boolean;
  duration?: number;
  departureGlowColor?: string;
  impactGlowColor?: string;
  /** Where to land inside a wide container: 'center' (default) or 'right'. */
  destAlign?: 'center' | 'right';
  /** Extra rotateZ (degrees) applied at landing — e.g. -90 for defense position. */
  destRotateZ?: number;
  /** Extra rotateZ (degrees) applied at departure and eased out — e.g. -90 for a card leaving defense position. */
  srcRotateZ?: number;
  /** Base rotateZ applied throughout the entire travel — e.g. 180 for opponent cards. */
  baseRotateZ?: number;
  /** Landing style: 'slam' for field summon, 'soft' for GY (absorption), 'banish' for banish zone (rift), 'default' for micro-bounce. */
  landingStyle?: 'default' | 'slam' | 'soft' | 'banish';
  /** Zone key tag stored on the float for later filtering (e.g. 'HAND-0', 'GY-1'). */
  dstZoneKey?: string;
  /**
   * Card code tag stored on the float. Used by `processShuffleEvent` to match
   * multiple HAND landed floats to their post-shuffle DOM positions.
   */
  cardCode?: number;
}

@Injectable()
export class CardTravelService implements OnDestroy {
  private readonly boardEffects = inject(BoardEffectsService);
  private _zoneResolver: ((zoneKey: string) => HTMLElement | null) | null = null;
  private _container: HTMLElement = document.body;
  private readonly _inFlight = new Map<HTMLDivElement, { animation: Animation; resolve: () => void }>();
  private readonly _landed = new Set<HTMLDivElement>();
  private readonly _timers = new Set<number>();
  private readonly _reducedMotion: boolean;

  constructor() {
    this._reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Register the container element for travel cards (defaults to document.body). */
  registerContainer(el: HTMLElement): void {
    this._container = el;
  }

  registerZoneResolver(fn: (zoneKey: string) => HTMLElement | null): void {
    this._zoneResolver = fn;
  }

  getZoneElement(zoneKey: string): HTMLElement | null {
    return this._zoneResolver?.(zoneKey) ?? null;
  }

  /** The container element for floating overlays (attack lines, clash effects). */
  getContainer(): HTMLElement {
    return this._container;
  }

  /**
   * Create a positioned line element between two zone elements.
   * Returns null if either element is missing. Caller owns lifecycle (animation, removal).
   */
  createLineBetween(
    srcEl: HTMLElement | null,
    dstEl: HTMLElement | null,
    style: { color: string; height?: number; shadow?: string },
  ): HTMLDivElement | null {
    if (!srcEl || !dstEl) return null;
    const sRect = srcEl.getBoundingClientRect();
    const dRect = dstEl.getBoundingClientRect();
    const sx = sRect.left + sRect.width / 2;
    const sy = sRect.top + sRect.height / 2;
    const dx = dRect.left + dRect.width / 2;
    const dy = dRect.top + dRect.height / 2;
    const length = Math.sqrt((dx - sx) ** 2 + (dy - sy) ** 2);
    const angle = Math.atan2(dy - sy, dx - sx) * (180 / Math.PI);
    const h = style.height ?? 3;

    const line = document.createElement('div');
    line.style.cssText = `
      position: fixed; pointer-events: none; z-index: 50;
      left: ${sx}px; top: ${sy - h / 2}px;
      width: ${length}px; height: ${h}px;
      transform-origin: 0 50%; transform: rotate(${angle}deg);
      background: ${style.color}; border-radius: ${h / 2}px;
      ${style.shadow ? `box-shadow: ${style.shadow};` : ''}
    `;
    this._container.appendChild(line);
    return line;
  }

  travel(source: string | HTMLElement, destination: string | HTMLElement, cardImage: string, options: TravelOptions = {}): Promise<void> {
    if (this._reducedMotion || !this._zoneResolver) return Promise.resolve();

    const sourceEl = typeof source === 'string'
      ? this._zoneResolver(source)
      : source;
    const destEl = typeof destination === 'string'
      ? this._zoneResolver(destination)
      : destination;
    if (!sourceEl || !destEl) return Promise.resolve();

    // When srcRotateZ is set the source card is visually rotated (e.g. defense position).
    // getBoundingClientRect() returns the AABB which has swapped width/height.
    // Strip the transform momentarily to read the true un-rotated rect.
    const srcRotateZ = options.srcRotateZ ?? 0;
    let rawSourceRect: DOMRect;
    if (srcRotateZ && sourceEl instanceof HTMLElement) {
      const savedTransform = sourceEl.style.transform;
      const savedTransition = sourceEl.style.transition;
      sourceEl.style.transition = 'none';
      sourceEl.style.transform = 'none';
      rawSourceRect = sourceEl.getBoundingClientRect();
      sourceEl.style.transform = savedTransform;
      void sourceEl.offsetHeight;
      sourceEl.style.transition = savedTransition;
    } else {
      rawSourceRect = sourceEl.getBoundingClientRect();
    }
    const sourceRect = toCardRect(rawSourceRect);

    // Detect destination fan rotation BEFORE reading its rect.
    // When rotated, getBoundingClientRect() returns the AABB (axis-aligned bounding box)
    // whose center is offset from the card's true CSS center. Read the untransformed
    // rect instead so dx/dy targets the real position.
    let destRotateZ = options.destRotateZ ?? 0;
    let destTranslateY = 0;
    if (destEl instanceof HTMLElement && destEl.style.transform) {
      const matchR = destEl.style.transform.match(/rotate\(([-\d.]+)deg\)/);
      if (matchR) destRotateZ = parseFloat(matchR[1]);
      const matchTY = destEl.style.transform.match(/translateY\(([-\d.]+)px\)/);
      if (matchTY) destTranslateY = parseFloat(matchTY[1]);
    }

    let rawDestRect: DOMRect;
    if (destRotateZ && destEl instanceof HTMLElement) {
      const savedTransform = destEl.style.transform;
      const savedTransition = destEl.style.transition;
      // Disable transition so the strip/restore doesn't trigger a CSS animation
      destEl.style.transition = 'none';
      destEl.style.transform = 'none';
      rawDestRect = destEl.getBoundingClientRect();
      destEl.style.transform = savedTransform;
      // Force reflow to commit the restored transform BEFORE re-enabling transition
      void destEl.offsetHeight;
      destEl.style.transition = savedTransition;
    } else {
      rawDestRect = destEl.getBoundingClientRect();
    }

    // Compute card-visible rect within the destination zone (same aspect ratio logic as source)
    const cardDestRect = toCardRect(rawDestRect);

    // If destination is a container (much wider than source, e.g. hand row),
    // target a card-sized rect within it to avoid stretching
    const align = options.destAlign ?? 'center';
    const destRect = rawDestRect.width > sourceRect.width * 1.5
      ? new DOMRect(
          align === 'right'
            ? rawDestRect.right - sourceRect.width
            : rawDestRect.left + (rawDestRect.width - sourceRect.width) / 2,
          rawDestRect.top + (rawDestRect.height - sourceRect.height) / 2,
          sourceRect.width,
          sourceRect.height,
        )
      : cardDestRect;
    const duration = options.duration ?? 400;
    const floatingEl = this.createFloatingElement(sourceRect, cardImage, options);
    const dstKey = options.dstZoneKey ?? (typeof destination === 'string' ? destination : null);
    if (dstKey) floatingEl.dataset['dstKey'] = dstKey;
    if (options.cardCode) floatingEl.dataset['cardCode'] = String(options.cardCode);

    this._container.appendChild(floatingEl);

    // Flip: swap img src at the 90° midpoint (edge-on, visually invisible swap)
    if (options.flipDuringTravel) {
      const img = floatingEl.querySelector('img')!;
      const showingBack = options.showBack ?? false;
      this.addTimer(window.setTimeout(() => {
        img.src = showingBack
          ? this.toAbsoluteUrl(cardImage)
          : this.toAbsoluteUrl('assets/images/card_back.jpg');
      }, duration * 0.45));
    }

    // Copy transform-origin from destination as percentages so the pivot maps
    // correctly even though the floating element has different dimensions.
    // Skip when baseRotateZ is set: the float needs center origin so that the
    // constant 180° rotation doesn't shift the AABB. The dest-origin copy is
    // only meaningful for explicit destRotateZ (defense -90°), not fan angles.
    let originYFraction = 0.5; // default: center
    const base = options.baseRotateZ ?? 0;
    if (destRotateZ && !base && destEl instanceof HTMLElement) {
      const raw = getComputedStyle(destEl).transformOrigin;
      const [oxPx, oyPx] = raw.split(' ').map(parseFloat);
      const oxPct = (oxPx / rawDestRect.width) * 100;
      const oyPct = (oyPx / rawDestRect.height) * 100;
      floatingEl.style.transformOrigin = `${oxPct}% ${oyPct}%`;
      originYFraction = oyPct / 100;
    }

    const keyframes = buildTravelKeyframes(sourceRect, destRect, options, destRotateZ, destTranslateY, originYFraction);
    const animation = floatingEl.animate(keyframes, {
      duration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });

    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    this._inFlight.set(floatingEl, { animation, resolve });

    if (options.departureGlowColor) {
      this.applyGlow(sourceEl, options.departureGlowColor, duration * 0.15);
    }
    if (options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      this.addTimer(window.setTimeout(() => {
        floatingEl.style.filter = `drop-shadow(0 0 8px ${glowColor})`;
        this.addTimer(window.setTimeout(() => { floatingEl.style.filter = ''; }, duration * 0.25));
      }, duration * 0.75));
    }

    if (options.landingStyle === 'soft' && options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      this.addTimer(window.setTimeout(() => {
        this.boardEffects.zoneImpactEffect(rawDestRect, glowColor, duration);
      }, duration * 0.70));
    }
    if (options.landingStyle === 'banish' && options.impactGlowColor) {
      const glowColor = options.impactGlowColor;
      this.addTimer(window.setTimeout(() => {
        this.boardEffects.zoneImpactEffect(rawDestRect, glowColor, duration);
      }, duration * 0.70));
    }

    const onLanded = () => { this._landed.add(floatingEl); resolve(); };

    animation.finished.then(() => {
      this._inFlight.delete(floatingEl);
      if (options.landingStyle === 'slam') {
        this.boardEffects.slamDustParticles(rawDestRect);
      }
      onLanded();
    }).catch(() => {
      // animation.cancel() rejects — resolve so the queue never hangs.
      // ngOnDestroy also calls resolve(), but this covers mid-lifecycle rejections.
      this._inFlight.delete(floatingEl);
      resolve();
    });

    return promise;
  }

  /** Number of landed floats (for debug tracing). */
  landedCount(): number { return this._landed.size; }

  /** Number of in-flight travels (for debug tracing). */
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
        match = el; // keep updating to the newest matching float
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
    for (const el of this._landed) {
      el.remove();
    }
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

  /** Finish all in-flight animations and remove all travel elements. */
  clearAllTravels(): void {
    for (const [el, { animation, resolve }] of this._inFlight) {
      animation.finish();
      el.remove();
      resolve();
    }
    this._inFlight.clear();
    this.clearLandedTravels();
  }

  ngOnDestroy(): void {
    for (const id of this._timers) {
      clearTimeout(id);
    }
    this._timers.clear();
    for (const [el, { animation, resolve }] of this._inFlight) {
      animation.cancel();
      el.remove();
      resolve();
    }
    this._inFlight.clear();
    this.clearLandedTravels();
  }

  private createFloatingElement(sourceRect: DOMRect, cardImage: string, options: TravelOptions): HTMLDivElement {
    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed;
      pointer-events: none;
      will-change: transform, opacity;
      z-index: 900; /* $z-pvp-card-travel — must stay below $z-pvp-chain-overlay (950) */
      width: ${sourceRect.width}px;
      height: ${sourceRect.height}px;
      left: ${sourceRect.left}px;
      top: ${sourceRect.top}px;
      overflow: hidden;
      border-radius: 4px;
      transform-origin: ${sourceRect.width / 2}px ${sourceRect.height / 2}px;
    `;

    const img = document.createElement('img');
    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
    img.src = options.showBack
      ? this.toAbsoluteUrl('assets/images/card_back.jpg')
      : this.toAbsoluteUrl(cardImage);
    img.alt = '';
    div.appendChild(img);

    return div;
  }

  private applyGlow(el: HTMLElement, color: string, duration: number): void {
    const target = el.querySelector<HTMLElement>('img') ?? el;
    target.style.boxShadow = `0 0 12px 4px ${color}`;
    this.addTimer(window.setTimeout(() => { target.style.boxShadow = ''; }, duration));
  }

  private addTimer(id: number): void {
    this._timers.add(id);
  }

  toAbsoluteUrl(relativePath: string): string {
    if (relativePath.startsWith('http') || relativePath.startsWith('//')) return relativePath;
    return `${window.location.origin}/${relativePath.replace(/^\//, '')}`;
  }
}
