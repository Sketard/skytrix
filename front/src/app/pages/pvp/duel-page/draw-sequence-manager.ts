import { afterNextRender, inject, Injectable, Injector, signal } from '@angular/core';
import type { DrawMsg, MoveMsg, ShuffleHandMsg, ConfirmCardsMsg } from '../duel-ws.types';
import { LOCATION } from '../duel-ws.types';
import { ANIMATION_DATA_SOURCE, peekAndDequeueMatching } from './animation-data-source';
import { MoveAnimationRouter } from './move-animation-router';
import { CardTravelService, type TravelOptions } from './card-travel.service';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DuelContext } from './duel-context';
import { DuelLogCategory, DuelLogger } from './duel-logger';
import type { ZoneLock } from './rendered-board-state.service';

/**
 * Manages draw sequences: initial parallel draw, mid-game draws,
 * hand expansion slots, and the travelToHand pattern.
 * Provided at component level (NOT root).
 */
@Injectable()
export class DrawSequenceManager {
  private readonly cardTravelService = inject(CardTravelService);
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly ctx = inject(DuelContext);
  private readonly logger = inject(DuelLogger);
  private readonly chainManager = inject(ChainResolutionManager);
  private readonly injector = inject(Injector);

  private get rbs() { return this.dataSource.renderedBoardState; }

  // Lazy to break circular DI: MoveAnimationRouter → DrawSequenceManager → MoveAnimationRouter
  private _moveRouter?: MoveAnimationRouter;
  private get moveRouter(): MoveAnimationRouter {
    return this._moveRouter ??= this.injector.get(MoveAnimationRouter);
  }

  // --- State ---
  private _drawsInFlight = new Set<number>();
  private _drawsCompleteResolve: (() => void) | null = null;
  private _initialDrawDone: [boolean, boolean] = [false, false];
  private _drawTimeouts: ReturnType<typeof setTimeout>[] = [];
  private _onQueueResume: (() => void) | null = null;

  /**
   * Batch slot bookkeeping for replayBuffer() — one entry per player with
   * pending MOVE→HAND events. Keeps distinct fan-positioned slots alive for
   * the whole replay so each tutor lands at its own slot (not the same last
   * slot repeatedly) and floats stay rotated with the fan curve.
   */
  private _handBatch: [
    { slotCount: number; nextOffset: number } | null,
    { slotCount: number; nextOffset: number } | null,
  ] = [null, null];

  readonly handExpansionSlots = signal<[number, number]>([0, 0]);

  // --- Public queries ---
  get hasDrawsInFlight(): boolean { return this._drawsInFlight.size > 0; }

  /** Returns a promise that resolves when all in-flight draws complete. */
  awaitDrawsComplete(): Promise<void> | null {
    if (this._drawsInFlight.size === 0) return null;
    return new Promise<void>(resolve => { this._drawsCompleteResolve = resolve; });
  }

  // --- Wiring ---

  /** Register the callback to resume the orchestrator's queue loop after draws complete. */
  initQueueResumeCallback(onResume: () => void): void {
    this._onQueueResume = onResume;
  }

  // --- Hand batch (replayBuffer tutor sequencing) ---

  /**
   * Reserve `slotCount` distinct expansion slots in HAND for an upcoming
   * tutor-reveal replay sequence. Each subsequent `consumeHandBatchSlot(p)`
   * call returns the DOM index of the next unused slot — so tutor1 lands at
   * slot 0, tutor2 at slot 1, etc., each with its own fan-positioned rotation.
   * Pair with `endHandBatch(p)` at batch-end.
   */
  beginHandBatch(relPlayer: 0 | 1, slotCount: number): void {
    if (slotCount <= 0) return;
    this._handBatch[relPlayer] = { slotCount, nextOffset: 0 };
    this.handExpansionSlots.update(c => {
      const next: [number, number] = [...c];
      next[relPlayer] += slotCount;
      return next;
    });
  }

  /** Release all slots reserved by `beginHandBatch` for this player. */
  endHandBatch(relPlayer: 0 | 1): void {
    const batch = this._handBatch[relPlayer];
    if (!batch) return;
    this._handBatch[relPlayer] = null;
    this.handExpansionSlots.update(c => {
      const next: [number, number] = [...c];
      next[relPlayer] = Math.max(0, next[relPlayer] - batch.slotCount);
      return next;
    });
  }

  /**
   * Returns the DOM index of the next unused slot for the current batch, or
   * `undefined` when no batch is active. The index is
   * `renderedHandCount + offset` so the slot element can be selected via
   * `resolveHandTarget` with a numeric index.
   */
  consumeHandBatchSlot(relPlayer: 0 | 1): number | undefined {
    const batch = this._handBatch[relPlayer];
    if (!batch) return undefined;
    const existingCards = this.rbs.renderedState().players[relPlayer].zones
      .find(z => z.zoneId === 'HAND')?.cards.length ?? 0;
    const idx = existingCards + batch.nextOffset;
    batch.nextOffset++;
    return idx;
  }

  // --- Draw event processing ---

  processDrawEvent(msg: DrawMsg): number | 'async' {
    if (!this.ctx.isBoardActive()) return 0;
    if (this.ctx.reducedMotion()) return 0;
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const isInitialDraw = !this._initialDrawDone[relPlayer];
    if (isInitialDraw) this._initialDrawDone[relPlayer] = true;

    if (isInitialDraw) {
      this._drawsInFlight.add(relPlayer);
      this.launchInitialDraw(msg);
      return 'async';
    }

    this.logger.log(DuelLogCategory.DRAW, 'processDrawEvent → midGame relPlayer=%d cards=%d', relPlayer, msg.cards.length);
    return this.processMidGameDraw(msg, relPlayer);
  }

  // --- Initial draw ---

  private async launchInitialDraw(msg: DrawMsg): Promise<void> {
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const otherRel = relPlayer === 0 ? 1 : 0;

    // Lock HAND zones synchronously (before first await) to prevent
    // commitUnlocked() from revealing cards before the animation plays.
    // DECK is intentionally NOT locked — its count decreasing during draw
    // is visually natural, and locking it at EMPTY_DUEL_STATE (before the
    // first BOARD_STATE arrives) would freeze deckCount=0, hiding the pile.
    const earlyLocks = [
      this.rbs.lockZone(`HAND-${relPlayer}`),
      this.rbs.lockZone(`HAND-${otherRel}`),
    ];

    const travelDuration = this.ctx.scaledDuration(300, 150);
    const maxCards = 10; // 5 per player × 2
    const guardId = setTimeout(() => {
      this.logger.warn('Initial draw sequence timed out — forcing queue continue');
      this._drawsInFlight.clear();
      earlyLocks.forEach(l => l.commit());
      this.resumeQueueIfSafe();
    }, maxCards * (travelDuration + this.ctx.scaledDuration(300, 150)) + 1000);
    this._drawTimeouts.push(guardId);

    try {
      // Check synchronously first — both draws usually arrive in the same batch
      let otherMsg: DrawMsg | null = this.peekAndDequeueOtherInitialDraw(msg);

      // Fallback: poll briefly for slow network (up to ~200ms)
      for (let attempt = 0; attempt < 5 && !otherMsg; attempt++) {
        await new Promise<void>(r => setTimeout(r, 40));
        otherMsg = this.peekAndDequeueOtherInitialDraw(msg);
      }

      if (otherMsg) {
        await this.runParallelInitialDraw(msg, otherMsg);
      } else {
        this.ctx.announceEvent('Card drawn', msg.player);
        await this.runDrawSequence(msg, { guardTimeout: false, keepFloats: true });
      }

      clearTimeout(guardId);
    } finally {
      earlyLocks.forEach(l => l.commit());
    }

    this._drawsInFlight.clear();
    this.resumeQueueIfSafe();
  }

  private peekAndDequeueOtherInitialDraw(firstMsg: DrawMsg): DrawMsg | null {
    const otherMsg = peekAndDequeueMatching<DrawMsg>(this.dataSource,
      e => e.type === 'MSG_DRAW' && (e as DrawMsg).player !== firstMsg.player,
    );
    if (otherMsg) {
      this._initialDrawDone[this.ctx.relativePlayer(otherMsg.player)] = true;
      // Release the pre-lock for the dequeued MSG_DRAW's HAND zone — it bypassed
      // the normal queue loop which handles pre-lock release after processEvent.
      const otherRel = this.ctx.relativePlayer(otherMsg.player);
      this.moveRouter.releasePreLocksForKeys(new Set([`HAND-${otherRel}`]));
    }
    return otherMsg;
  }

  private async runParallelInitialDraw(msgA: DrawMsg, msgB: DrawMsg): Promise<void> {
    const msgs = [msgA, msgB];
    this.ctx.announceEvent('Card drawn', msgA.player);

    const stagger = this.ctx.scaledDuration(150, 75);
    await Promise.all(msgs.map((m, i) => {
      const delay = i * stagger;
      return delay > 0
        ? new Promise<void>(r => setTimeout(r, delay)).then(() => this.runDrawSequence(m, { guardTimeout: false, keepFloats: true }))
        : this.runDrawSequence(m, { guardTimeout: false, keepFloats: true });
    }));
  }

  // --- Unified draw sequence (Axe 5: runPlayerInitialDraw + processSingleDraw → runDrawSequence) ---

  /**
   * Core draw loop: locks HAND + DECK, loops travelToHand() per card, commits.
   * @param opts.guardTimeout If true, sets a timeout guard that force-continues on hang.
   * @param opts.keepFloats If true, landed floats are kept as visual proxies (initial draw).
   */
  private async runDrawSequence(msg: DrawMsg, opts: { guardTimeout: boolean; keepFloats?: boolean }): Promise<void> {
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const isOwn = relPlayer === 0;
    const srcKey = `DECK-${relPlayer}`;
    const dstKey = `HAND-${relPlayer}`;
    const travelDuration = opts.guardTimeout ? this.ctx.scaledDuration(400, 200) : this.ctx.scaledDuration(300, 150);
    const drawCount = msg.cards.length;

    // In keepFloats mode (initial draw), DECK is intentionally NOT locked:
    // the logical state already contains the final deck count (set by
    // syncAfterBoardState before animations start). Locking would freeze the
    // count until all draws finish, then jump to the final value at once.
    // Leaving it unlocked lets commitUnlocked() decrement it progressively.
    const lockDeck = !opts.keepFloats;
    this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — locking %s + %s lockDeck=%s (locks before: %d)', dstKey, srcKey, lockDeck, this.rbs.lockedZoneKeys().length);
    const handLock = this.rbs.lockZone(dstKey);
    const deckLock = lockDeck ? this.rbs.lockZone(srcKey) : null;

    let guardId: ReturnType<typeof setTimeout> | null = null;
    if (opts.guardTimeout) {
      guardId = setTimeout(() => {
        this.logger.warn('Draw sequence timed out — forcing queue continue');
        handLock.release();
        deckLock?.release();
        this._drawsInFlight.delete(relPlayer);
        this.resumeQueueIfSafe();
      }, drawCount * (travelDuration + this.ctx.scaledDuration(400, 200)) + 600);
      this._drawTimeouts.push(guardId);
    }

    if (opts.keepFloats) {
      // Initial draw: add all expansion slots upfront so the fan layout is
      // computed for N cards. Each card targets its own slot by index.
      // Slots stay until resetHandAnimationState() runs in the same
      // synchronous block as commitAll() — Angular reuses the outer <div>
      // elements (same track $index count), no CSS transition fires.
      this.handExpansionSlots.update(c => {
        const next: [number, number] = [...c];
        next[relPlayer] += drawCount;
        return next;
      });

      await new Promise<void>(resolve =>
        afterNextRender(() => resolve(), { injector: this.injector })
      );
    }

    for (let i = 0; i < drawCount; i++) {
      const card = msg.cards[i];
      const cardImage = isOwn && card
        ? this.cardTravelService.toAbsoluteUrl(`/api/documents/small/code/${card}`)
        : this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg');
      await this.travelToHand(srcKey, relPlayer, cardImage, {
        duration: travelDuration, showBack: true, flipDuringTravel: isOwn && !!card,
      }, opts.keepFloats ? i : undefined, undefined, card || undefined);
      if (!opts.keepFloats) this.cardTravelService.clearLandedTravels();
    }

    this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — committing locks, renderedHand=%d',
      this.rbs.renderedState().players?.[0]?.zones?.find(z => z.zoneId === 'HAND')?.cards?.length ?? 0);
    handLock.commit();
    deckLock?.commit();
    this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — committed, renderedHand=%d locks=%d',
      this.rbs.renderedState().players?.[0]?.zones?.find(z => z.zoneId === 'HAND')?.cards?.length ?? 0,
      this.rbs.lockedZoneKeys().length);
    if (guardId !== null) clearTimeout(guardId);

    // Mid-game draw: highlight the drawn card with a blue frame pulse
    // before the shuffle event runs (card must be committed and rendered first).
    if (!opts.keepFloats && this.ctx.isBoardActive() && !this.ctx.reducedMotion()) {
      this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — awaiting render for highlight');
      await new Promise<void>(resolve =>
        afterNextRender(() => resolve(), { injector: this.injector })
      );
      const zone = this.cardTravelService.getZoneElement(dstKey);
      if (zone) {
        const cards = zone.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--expansion)');
        const lastCard = cards.length ? cards[cards.length - 1] : null;
        this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — highlight target: cards=%d lastCard=%s', cards.length, !!lastCard);
        if (lastCard) {
          await this.highlightDrawnCard(lastCard, this.ctx.scaledDuration(600, 300), relPlayer === 1);
          this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — highlight done');
        }
      }
    }
  }

  /** Standard mid-game draw — wraps runDrawSequence with async tracking. */
  private processMidGameDraw(msg: DrawMsg, relPlayer: number): 'async' {
    this.logger.log(DuelLogCategory.DRAW, 'processMidGameDraw — adding to drawsInFlight relPlayer=%d', relPlayer);
    this._drawsInFlight.add(relPlayer);
    this.runDrawSequence(msg, { guardTimeout: true }).finally(() => {
      this.logger.log(DuelLogCategory.DRAW, 'processMidGameDraw — runDrawSequence done, removing from drawsInFlight');
      this._drawsInFlight.delete(relPlayer);
      if (this._drawsCompleteResolve) this._notifyDrawsComplete();
      else { this.logger.log(DuelLogCategory.DRAW, 'processMidGameDraw — resumeQueueIfSafe'); this.resumeQueueIfSafe(); }
    });
    this.ctx.announceEvent('Card drawn', msg.player);
    return 'async';
  }

  // --- travelToHand + resolveHandTarget ---

  /**
   * Animate a card traveling to the hand zone.
   * @param targetIndex When provided, targets a specific expansion slot (batch mode,
   *   slots managed by caller). When omitted, adds/removes a slot per card (default).
   * @param externalHandLock Caller-owned HAND lock (typically a pre-lock consumed
   *   from `preLockQueuedSources`). When provided, it is reused as the animation
   *   lock instead of being released-then-reacquired — avoids a commitZone(HAND)
   *   flash between the outer release and the inner lockZone.
   * @param cardCode Optional cardCode tag stored on the landed float's dataset.
   *   Used by `processShuffleEvent` to match N landed floats to their
   *   post-shuffle DOM positions in multi-tutor scenarios.
   */
  async travelToHand(
    src: string | HTMLElement,
    relPlayer: number,
    cardImage: string,
    options: TravelOptions,
    targetIndex?: number,
    externalHandLock?: ZoneLock,
    cardCode?: number,
  ): Promise<void> {
    const dstKey = `HAND-${relPlayer}`;
    const handLock = externalHandLock ?? this.rbs.lockZone(dstKey);
    const manageSlotsLocally = targetIndex === undefined;

    if (manageSlotsLocally) {
      this.handExpansionSlots.update(c => {
        const next: [number, number] = [...c];
        next[relPlayer]++;
        return next;
      });
    }

    let success = false;
    try {
      // Always wait one render cycle so the slot just added (manageSlotsLocally
      // mode) OR the pre-reserved batch slots (targetIndex mode, managed by
      // beginHandBatch) are in the DOM before resolving the target. When
      // Angular has nothing to flush this is effectively a microtask.
      await new Promise<void>(resolve =>
        afterNextRender(() => resolve(), { injector: this.injector })
      );

      const target = this.resolveHandTarget(dstKey, targetIndex ?? 'last');
      await this.cardTravelService.travel(src, target, cardImage, {
        ...options, dstZoneKey: dstKey, cardCode,
      });
      success = true;
    } finally {
      if (manageSlotsLocally) {
        this.handExpansionSlots.update(c => {
          const next: [number, number] = [...c];
          next[relPlayer] = Math.max(0, next[relPlayer] - 1);
          return next;
        });
      }
      if (success) handLock.commit();
      else handLock.release();
    }
  }

  resolveHandTarget(zoneKey: string, index: number | 'last'): HTMLElement | string {
    const zone = this.cardTravelService.getZoneElement(zoneKey);
    if (!zone) return zoneKey;
    if (index === 'last') {
      const slots = zone.querySelectorAll('.hand-card--expansion');
      const slot = slots.length ? slots[slots.length - 1] as HTMLElement : null;
      if (slot) return slot;
      const cards = zone.querySelectorAll('.hand-card');
      return cards.length ? cards[cards.length - 1] as HTMLElement : zoneKey;
    }
    const cards = zone.querySelectorAll('.hand-card');
    return (index >= 0 && index < cards.length) ? cards[index] as HTMLElement : zoneKey;
  }

  /** Blue frame pulse on a drawn/tutored card. */
  async highlightDrawnCard(el: HTMLElement, duration: number, isOpponent = false): Promise<void> {
    const lift = isOpponent ? '12px' : '-12px';
    await el.animate([
      { transform: `translateY(${lift})`, boxShadow: '0 0 0 0px rgba(80,160,255,0)',   offset: 0    },
      { transform: `translateY(${lift})`, boxShadow: '0 0 0 3px rgba(80,160,255,0.9)', offset: 0.10 },
      { transform: `translateY(${lift})`, boxShadow: '0 0 0 8px rgba(80,160,255,0)',   offset: 0.45 },
      { transform: `translateY(${lift})`, boxShadow: '0 0 0 0px rgba(80,160,255,0)',   offset: 0.46 },
      { transform: `translateY(${lift})`, boxShadow: '0 0 0 3px rgba(80,160,255,0.9)', offset: 0.55 },
      { transform: `translateY(${lift})`, boxShadow: '0 0 0 8px rgba(80,160,255,0)',   offset: 0.90 },
      { transform: 'translateY(0px)',     boxShadow: '0 0 0 0px rgba(80,160,255,0)',   offset: 1.0  },
    ], { duration, fill: 'none', easing: 'ease-out', composite: 'add' }).finished;
  }

  // --- Lifecycle ---

  reset(): void {
    this._drawsInFlight.clear();
    this._drawsCompleteResolve = null;
    this._initialDrawDone = [false, false];
    this.handExpansionSlots.set([0, 0]);
  }

  resetHandAnimationState(): void {
    this.handExpansionSlots.set([0, 0]);
  }

  /** Clear the one-shot draws-complete callback (called by chain end reset). Does NOT touch _initialDrawDone. */
  clearDrawsCompleteCallback(): void {
    this._drawsCompleteResolve = null;
  }

  clearTimeouts(): void {
    this._drawTimeouts.forEach(t => clearTimeout(t));
    this._drawTimeouts = [];
  }

  // --- Private helpers ---

  private _notifyDrawsComplete(): void {
    if (this._drawsInFlight.size === 0 && this._drawsCompleteResolve) {
      const resolve = this._drawsCompleteResolve;
      this._drawsCompleteResolve = null;
      resolve();
    }
  }

  private resumeQueueIfSafe(): void {
    if (!this.chainManager.hasActiveReplayTimeouts && this._onQueueResume) {
      // Defer to next microtask. When this is called from a synchronously-
      // resolving .finally() inside an 'async'-returning event handler (e.g.
      // MSG_CONFIRM_CARDS for a non-HAND card where confirmCardsInHand's loop
      // only hits `continue`), the orchestrator's _processAnimationQueueInner
      // .finally has not yet cleared _isProcessing, so processAnimationQueue()
      // would no-op on the `_isProcessing` guard. queueMicrotask lets the
      // inner finally run first.
      const resume = this._onQueueResume;
      queueMicrotask(() => resume());
    }
  }

  // ---------------------------------------------------------------------------
  // Shuffle / Confirm subsystem (moved from orchestrator)
  // ---------------------------------------------------------------------------

  async processShuffleEvent(msg: ShuffleHandMsg): Promise<void> {
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const handZoneKey = `HAND-${relPlayer}`;

    const moveMsg = peekAndDequeueMatching<MoveMsg>(this.dataSource,
      e => e.type === 'MSG_MOVE' && (e as MoveMsg).toLocation === LOCATION.HAND,
    );

    this.logger.log(DuelLogCategory.SHUFFLE, 'processShuffleEvent START relPlayer=%d', relPlayer);

    if (moveMsg) {
      this.logger.log(DuelLogCategory.SHUFFLE, 'moveMsg found — processing');
      const moveLock = this.rbs.lockZone(handZoneKey);
      try {
        const moveResult = this.moveRouter.processMoveEvent(moveMsg);
        if (moveResult instanceof Promise) await moveResult;
      } catch (e) {
        this.logger.warn('Shuffle move phase failed — releasing lock', e);
        moveLock.release();
        this.rbs.commitAll();
        return;
      }
      moveLock.commit();
    } else {
      this.logger.log(DuelLogCategory.SHUFFLE, 'no moveMsg in queue');
    }

    const handZone = this.cardTravelService.getZoneElement(handZoneKey);

    if (this.ctx.reducedMotion() || !handZone) {
      this.cardTravelService.clearLandedByDstPrefix('HAND');
      this.rbs.commitAll();
      return;
    }

    // Capture ALL landed HAND floats — each represents a newly added card
    // (search / tutor). Stabilize their positions so they can each animate
    // independently to their post-shuffle DOM slot.
    const handPrefix = `HAND-${relPlayer}`;
    const landedFloats = this.cardTravelService.getLandedFloatsByDstPrefix(handPrefix);
    const baseRZ = this.ctx.cardBaseRotateCSS(relPlayer);
    const floatByCode = new Map<string, { el: HTMLDivElement; rect: DOMRect }[]>();
    for (const el of landedFloats) {
      const rect = this.cardTravelService.stabilizeFloat(el, baseRZ);
      const code = el.dataset['cardCode'] ?? '';
      if (!floatByCode.has(code)) floatByCode.set(code, []);
      floatByCode.get(code)!.push({ el, rect });
    }
    this.logger.log(DuelLogCategory.SHUFFLE, 'landedFloats=%d codes=%o', landedFloats.length, [...floatByCode.keys()]);

    const breathingRoom = this.ctx.scaledDuration(100, 50);

    await new Promise<void>(r => {
      const tid = setTimeout(r, breathingRoom);
      this._drawTimeouts.push(tid);
    });

    try {
      await new Promise<void>(resolve =>
        afterNextRender(() => resolve(), { injector: this.injector })
      );

      // Read old positions of existing real cards (before the new card appears)
      const oldCardEls = handZone.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--expansion)');
      const oldPositions = new Map<string, DOMRect[]>();
      oldCardEls.forEach(el => {
        const code = el.dataset['cardCode'] ?? '';
        if (!oldPositions.has(code)) oldPositions.set(code, []);
        oldPositions.get(code)!.push(el.getBoundingClientRect());
      });

      // Force-sync ALL state — clears any stacked locks from move/travel
      // so the rendered hand includes the newly added cards.
      this.rbs.commitAll();

      await new Promise<void>(resolve =>
        afterNextRender(() => resolve(), { injector: this.injector })
      );

      const flipDuration = this.ctx.scaledDuration(400, 200);
      const newCardEls = handZone.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--expansion)');
      const animations: Animation[] = [];
      const floatAssignments: Array<{ float: HTMLDivElement; rect: DOMRect; targetEl: HTMLElement }> = [];

      newCardEls.forEach(el => {
        const code = el.dataset['cardCode'] ?? '';
        const oldRects = oldPositions.get(code);
        const newRect = el.getBoundingClientRect();

        if (oldRects?.length) {
          const oldRect = oldRects.shift()!;
          const dx = oldRect.left - newRect.left;
          const dy = oldRect.top - newRect.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          animations.push(el.animate([
            { transform: `translate(${dx}px, ${dy}px)`, composite: 'add' },
            { transform: 'translate(0, 0)', composite: 'add' },
          ], { duration: flipDuration, easing: 'ease-out' }));
        } else {
          // Newly added card: prefer a float tagged with the same cardCode.
          // Falls back to any unused float so shuffle still hides the pop-in
          // (covers the face-down / opponent-perspective case where the float
          // wasn't tagged because we didn't know the code at travel time).
          let float = floatByCode.get(code)?.shift();
          if (!float) {
            for (const [, floats] of floatByCode) {
              if (floats.length > 0) { float = floats.shift(); break; }
            }
          }
          if (float) {
            floatAssignments.push({ float: float.el, rect: float.rect, targetEl: el });
            el.style.visibility = 'hidden';
          }
        }
      });

      // Slide each assigned float from its captured position to its target slot.
      for (const { float, rect, targetEl } of floatAssignments) {
        const targetRect = targetEl.getBoundingClientRect();
        const dx = targetRect.left + targetRect.width / 2 - (rect.left + rect.width / 2);
        const dy = targetRect.top + targetRect.height / 2 - (rect.top + rect.height / 2);
        animations.push(float.animate([
          { transform: `translate(0, 0) ${baseRZ}` },
          { transform: `translate(${dx}px, ${dy}px) ${baseRZ}` },
        ], { duration: flipDuration, easing: 'ease-out', fill: 'forwards' }));
      }

      if (animations.length > 0) {
        await Promise.all(animations.map(a => a.finished));
      }

      // Reveal the real cards, remove the floats
      for (const { targetEl } of floatAssignments) targetEl.style.visibility = '';
      this.cardTravelService.clearLandedByDstPrefix('HAND');
    } catch (e) {
      this.logger.warn('Shuffle phase failed — committing state', e);
      this.rbs.commitAll();
      this.cardTravelService.clearLandedByDstPrefix('HAND');
    }
  }

  processConfirmCardsEvent(msg: ConfirmCardsMsg): number | Promise<void> {
    if (!this.ctx.isBoardActive() || this.ctx.reducedMotion() || msg.cards.length === 0) return 0;

    // Return a Promise (not 'async') so the orchestrator awaits the reveal
    // before dequeuing the next entry. Returning 'async' without an in-flight
    // flag (like _drawsInFlight) causes the rescue path in
    // processAnimationQueue.finally to relaunch the queue immediately — the
    // next event (e.g. a discard MSG_MOVE buffered by the chain replay) would
    // start animating mid-reveal. The Promise.race guard in the orchestrator
    // (LOCK_SAFETY_TIMEOUT_MS) prevents hangs if confirmCardsInHand stalls.
    this.ctx.announceEvent('Cards revealed', msg.player);
    return this.confirmCardsInHand(msg.cards);
  }

  async confirmCardsInHand(cards: readonly { cardCode: number; player: number; sequence: number }[]): Promise<void> {
    const flipDuration = this.ctx.scaledDuration(300, 150);
    const highlightDuration = this.ctx.scaledDuration(600, 300);
    const holdDuration = this.ctx.scaledDuration(200, 100);

    for (const card of cards) {
      // Prefer matching float by cardCode so an interleaved per-card CONFIRM
      // reveals the correct ghost — otherwise FIFO re-pops a previously
      // returned float and the reveal plays on the wrong card. Fallback
      // without cardCode covers face-down / opponent-perspective floats that
      // weren't tagged at travel time.
      let floatEl = this.cardTravelService.popLandedFloat('HAND', card.cardCode);
      if (!floatEl) floatEl = this.cardTravelService.popLandedFloat('HAND');
      this.logger.log(DuelLogCategory.SHUFFLE, 'confirmCardsInHand — popLandedFloat=%s cardCode=%d', !!floatEl, card.cardCode);
      if (!floatEl) continue;

      const relPlayer = this.ctx.relativePlayer(card.player);

      const baseRZ = this.ctx.cardBaseRotateCSS(relPlayer);
      this.cardTravelService.stabilizeFloat(floatEl, baseRZ);

      if (relPlayer === 1) {
        const img = floatEl.querySelector('img');
        if (img) {
          const cardFaceUrl = this.cardTravelService.toAbsoluteUrl(`/api/documents/small/code/${card.cardCode}`);
          // Skip flip if the float already shows the card face (replay/omniscient mode).
          const alreadyRevealed = img.src === cardFaceUrl;
          if (!alreadyRevealed) {
            const swapTimer = setTimeout(() => { img.src = cardFaceUrl; }, flipDuration * 0.45);
            this._drawTimeouts.push(swapTimer);
            await floatEl.animate([
              { transform: `rotateY(180deg) ${baseRZ}`, offset: 0 },
              { transform: `rotateY(90deg) ${baseRZ}`,  offset: 0.45 },
              { transform: `rotateY(0deg) ${baseRZ}`,   offset: 1 },
            ], { duration: flipDuration, easing: 'ease-in-out', fill: 'forwards' }).finished;
          }
        }
      }

      await this.highlightDrawnCard(floatEl, highlightDuration, relPlayer === 1);

      await new Promise<void>(r => {
        const tid = setTimeout(r, holdDuration);
        this._drawTimeouts.push(tid);
      });

      this.cardTravelService.returnToLanded(floatEl as HTMLDivElement);
    }
  }

}
