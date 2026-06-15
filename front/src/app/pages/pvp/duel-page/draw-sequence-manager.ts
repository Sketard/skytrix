import { afterNextRender, inject, Injectable, Injector, signal } from '@angular/core';
import type { DrawMsg, MoveMsg, ShuffleHandMsg, ConfirmCardsMsg, CardLocation } from '../duel-ws.types';
import { LOCATION } from '../duel-ws.types';
import { locationToZoneKey } from '../pvp-zone.utils';
import { ANIMATION_DATA_SOURCE, peekAndDequeueMatching } from './animation-data-source';
import { MoveAnimationRouter } from './move-animation-router';
import { CardTravelEngine, type TravelOptions } from './card-travel-engine.service';
import { FloatRegistryService } from './float-registry.service';
import { BoardEffectsService } from './board-effects.service';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DuelContext } from './duel-context';
import { DuelLogCategory, DuelLogger } from './duel-logger';
import type { ZoneLock } from './rendered-board-state.service';
import { duelAssert } from '../../../core/utilities/duel-assert';
import {
  INITIAL_DRAW_PAIRING_ATTEMPTS, INITIAL_DRAW_PAIRING_POLL_MS,
  FIELD_REVEAL_FLIP_MS, FIELD_REVEAL_FLIP_MIN_MS,
  FIELD_REVEAL_LIFT_MS, FIELD_REVEAL_LIFT_MIN_MS,
  FIELD_REVEAL_GLOW_MS, FIELD_REVEAL_GLOW_MIN_MS,
  FIELD_REVEAL_HOLD_MS, FIELD_REVEAL_HOLD_MIN_MS,
  PILE_REVEAL_LIFT_MS, PILE_REVEAL_LIFT_MIN_MS,
  PILE_REVEAL_HOLD_MS, PILE_REVEAL_HOLD_MIN_MS,
  PILE_REVEAL_FADE_MS, PILE_REVEAL_FADE_MIN_MS,
  PILE_REVEAL_HIGHLIGHT_MS, PILE_REVEAL_HIGHLIGHT_MIN_MS,
  PILE_REVEAL_LIFT_OFFSET_PX,
  HAND_CONFIRM_FLIP_MS, HAND_CONFIRM_FLIP_MIN_MS,
  HAND_CONFIRM_HOLD_MS, HAND_CONFIRM_HOLD_MIN_MS,
} from './animation-constants';

/**
 * Manages draw sequences: initial parallel draw, mid-game draws,
 * hand expansion slots, and the travelToHand pattern.
 * Provided at component level (NOT root).
 *
 * Cross-manager couplings (audit L23):
 * - Calls `moveRouter.processMoveEvent` from `processShuffleEvent` for
 *   shuffle-induced MOVEs.
 * - Calls `moveRouter.releasePreLocksForKeys` from
 *   `peekAndDequeueOtherInitialDraw` to release the dequeued draw's HAND
 *   pre-lock — the dequeued event bypasses the normal queue loop, so the
 *   orchestrator's automatic pre-lock release in
 *   `processAnimationQueueInner` doesn't see it.
 *
 * `MoveAnimationRouter` is injected lazily (`injector.get`) to break the
 * circular DI: MoveAnimationRouter → DrawSequenceManager → MoveAnimationRouter.
 */
@Injectable()
export class DrawSequenceManager {
  private readonly cardTravelEngine = inject(CardTravelEngine);
  private readonly floatRegistry = inject(FloatRegistryService);
  private readonly boardEffects = inject(BoardEffectsService);
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
   * Stream sink for MOVE→HAND events that `processShuffleEvent` steals out
   * of the animation queue via `peekAndDequeueMatching` (search→shuffle
   * pattern : a tutored card is added to hand, then the hand is shuffled —
   * the move's travel is folded into the shuffle re-layout instead of a
   * separate DECK→HAND animation). The stolen MOVE bypasses the
   * orchestrator's `processEvent` (which owns `pushToStream`), so without
   * this sink the move never reaches `_eventStream` — the journal/parity
   * stream loses the "→ Hand" line. Wired by the orchestrator to
   * `pushToStream`. Pacing-dependent SOLO bug : at dense tape pacing the
   * MOVE + SHUFFLE_HAND arrive in the same WS batch so the shuffle steals
   * the move before chain-buffer replay can dispatch it ; at human pacing
   * the move is chain-buffered + replayed (reaching the stream) before the
   * shuffle runs. Replay never hits the race (buffer replay drains the
   * move before the shuffle dispatch) — this sink makes SOLO match. */
  private _onStolenMoveForStream: ((move: MoveMsg) => void) | null = null;

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

  /**
   * Returns a promise that resolves when all in-flight draws complete, OR
   * early when `abortSignal` fires.
   *
   * Backlog audit — the `barrier` directive awaits this OUTSIDE
   * `handleEntryAndAwait`, so it gets NO `LOCK_SAFETY_TIMEOUT_MS` guard
   * `Promise.race` (unlike a travel Promise). Without the abort listener a
   * `requestStop()` (seek / perspective switch) mid-draw clears the draw
   * timers — so `_notifyDrawsComplete` never fires — and the barrier's
   * Promise never resolves : the inner loop hangs on the `await`, its
   * `finally` never decrements `_innerLoopDepth`, and the next run trips the
   * `depth <= 1` assert → the documented infinite-rescue stall. Resolving
   * early on abort lets the loop reach its post-await `abortSignal.aborted`
   * bail-out and unwind cleanly. Mirrors `abortableWait`.
   */
  awaitDrawsComplete(abortSignal: AbortSignal): Promise<void> | null {
    if (this._drawsInFlight.size === 0) return null;
    return new Promise<void>(resolve => {
      if (abortSignal.aborted) { resolve(); return; }
      const onAbort = (): void => {
        // Drop the one-shot so a late nominal `_notifyDrawsComplete` can't
        // resolve an already-settled Promise.
        this._drawsCompleteResolve = null;
        resolve();
      };
      this._drawsCompleteResolve = (): void => {
        abortSignal.removeEventListener('abort', onAbort);
        resolve();
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // --- Wiring ---

  /** Register the callback to resume the orchestrator's queue loop after draws complete. */
  initQueueResumeCallback(onResume: () => void): void {
    this._onQueueResume = onResume;
  }

  /** Register the sink that records a shuffle-stolen MOVE→HAND on the
   *  orchestrator's EventStream (see `_onStolenMoveForStream`). Wired by
   *  the orchestrator to `pushToStream`. */
  initStolenMoveStreamSink(sink: (move: MoveMsg) => void): void {
    this._onStolenMoveForStream = sink;
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
    // Invariant: hand batches from `replayBuffer` and the initial/mid-game
    // draw loop manage the same `handExpansionSlots` signal. Their time
    // windows don't overlap in practice (initial draw fires at duel start,
    // buffer replay fires during chain resolve), but a future refactor
    // could break this assumption — fail loud in dev.
    duelAssert(
      this._drawsInFlight.size === 0,
      'beginHandBatch',
      `overlaps with ${this._drawsInFlight.size} in-flight draw sequence(s) — handExpansionSlots would double-book`,
    );
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
    // Defense in depth: AnimationOrchestratorService.`_dispatchEvent` parks
    // BOARD_CHANGING events (incl. MSG_DRAW) in `_preActivationBuffer`
    // while !boardActive, so reaching this branch indicates a bypass —
    // log it and still return 0 so the queue doesn't hang. The legacy
    // silent return is what made the "cartes déjà en main" symptom so
    // hard to diagnose; the log surfaces a future regression.
    if (!this.ctx.isBoardActive()) {
      this.logger.warn('processDrawEvent fired with !isBoardActive — pre-activation buffer bypassed?');
      return 0;
    }
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
    //
    // Hand-off contract (2026-06-05) — these earlyLocks bridge two windows :
    //   1. Between the dispatcher's `releasePreLocksForKeys({HAND-${relPlayer}})`
    //      and the inner handLock pose inside `runParallelInitialDraw`.
    //   2. Between `peekAndDequeueOtherInitialDraw` releasing the
    //      `HAND-${otherRel}` pre-lock and the 2nd inner handLock pose.
    // `runParallelInitialDraw` poses the 2 inner handLocks SYNCHRONOUSLY
    // upfront and releases these earlyLocks immediately — they never live
    // across the ~1500ms travel, so they cannot race the safety timeout.
    // The 1-msg fallback path below (only msg, no parallel) commits them
    // in `finally` since no inner-lock hand-off happened.
    const earlyLocks = [
      this.rbs.lockZone(`HAND-${relPlayer}`),
      this.rbs.lockZone(`HAND-${otherRel}`),
    ];
    let earlyLocksHandedOff = false;

    const travelDuration = this.ctx.scaledDuration(300, 150);
    const maxCards = 10; // 5 per player × 2
    const guardId = setTimeout(() => {
      this.logger.warn('Initial draw sequence timed out — forcing queue continue');
      this._drawsInFlight.clear();
      if (!earlyLocksHandedOff) earlyLocks.forEach(l => l.commit());
      this.resumeQueueIfSafe();
    }, maxCards * (travelDuration + this.ctx.scaledDuration(300, 150)) + 1000);
    this._drawTimeouts.push(guardId);

    try {
      // Check synchronously first — both draws usually arrive in the same batch
      let otherMsg: DrawMsg | null = this.peekAndDequeueOtherInitialDraw(msg);

      // Fallback: poll briefly for slow network (up to ~200ms)
      for (let attempt = 0; attempt < INITIAL_DRAW_PAIRING_ATTEMPTS && !otherMsg; attempt++) {
        await new Promise<void>(r => setTimeout(r, INITIAL_DRAW_PAIRING_POLL_MS));
        otherMsg = this.peekAndDequeueOtherInitialDraw(msg);
      }

      if (otherMsg) {
        earlyLocksHandedOff = true;
        await this.runParallelInitialDraw(msg, otherMsg, earlyLocks);
      } else {
        // Single-msg fallback (otherMsg never arrived within the poll
        // window). Hand the HAND-${relPlayer} earlyLock to runDrawSequence
        // via `externalHandLock` so its final commit() drops ref-count
        // 1→0 in the SAME tick as `clearLandedByDstPrefix` +
        // `handExpansionSlots` retraction inside runDrawSequence. Without
        // this hand-off, the inner handLock posed by runDrawSequence
        // would land at ref-count 2 (earlyLock + inner) and its commit
        // would only decrement to 1 (no commitZone) — leaving a window
        // where floats are already cleared + slots retracted but the
        // real cards haven't rendered yet (fan momentarily empty). The
        // remaining HAND-${otherRel} earlyLock is still released in the
        // finally block via `earlyLocks[1].commit()` — flag below
        // distinguishes from the parallel hand-off.
        this.ctx.announceEvent('Card drawn', msg.player);
        earlyLocksHandedOff = true;
        await this.runDrawSequence(msg, {
          guardTimeout: false,
          keepFloats: true,
          externalHandLock: earlyLocks[0],
        });
        // The HAND-${otherRel} earlyLock was NOT handed off — it has no
        // matching MSG_DRAW. Commit it directly so its ref-count drops
        // 1→0 and commitZone fires (HAND-${otherRel} stays empty in
        // logical for the duration of the single-msg path ; commitZone
        // is a no-op on an unchanged zone).
        earlyLocks[1].commit();
      }

      clearTimeout(guardId);
    } finally {
      // earlyLocks already released by `runParallelInitialDraw` (hand-off
      // to the inner handLocks). Only the single-msg fallback path needs
      // the final commit.
      if (!earlyLocksHandedOff) earlyLocks.forEach(l => l.commit());
      // `runDrawSequence` already cleared its own HAND-${rel} floats
      // via the filtered `clearLandedByDstPrefix(dstKey)` post-commit
      // (fix #4) — the unfiltered `clearLandedTravels()` call previously
      // here was redundant for the happy path AND risked wiping
      // legitimate floats on OTHER zones (GY, BANISHED) if a future
      // bootstrap (fork-solo with non-empty board) posed them inside
      // this window. `resetHandAnimationState` is the only required
      // cleanup : drops the expansion-slot reservation so Angular
      // reuses the hand <div>s without firing a layout transition.
      this.resetHandAnimationState();
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

  /**
   * @param earlyLocks The two HAND-${rel} locks acquired sync in
   *   `launchInitialDraw`. Pose the 2 inner HAND locks upfront here so the
   *   earlyLocks can be released right after — they no longer live across
   *   the full ~1500ms travel and stop racing the safety timeout.
   */
  private async runParallelInitialDraw(msgA: DrawMsg, msgB: DrawMsg, earlyLocks: ZoneLock[]): Promise<void> {
    const msgs = [msgA, msgB];
    this.ctx.announceEvent('Card drawn', msgA.player);

    // Pose both inner HAND locks SYNCHRONOUSLY upfront — they cover their
    // zones for the entire travel window. The earlyLocks' role (bridge
    // between pre-lock release and inner handLock acquisition) is now over
    // — release them so they don't race the safety timeout at t≈1500ms.
    // Release (not commit) : the inner handLock final commit (ref-count
    // 1→0) is what triggers commitZone — committing the earlyLock here
    // (ref-count 2→1) would just decrement, then the inner handLock commit
    // would decrement 1→0 and commitZone fires normally. Both paths land
    // correctly, but `release` keeps the intent clear : "this lock has
    // been handed off, the next commit is the one that matters."
    const innerHandLocks = msgs.map(m => {
      const relPlayer = this.ctx.relativePlayer(m.player);
      return this.rbs.lockZone(`HAND-${relPlayer}`);
    });
    earlyLocks.forEach(l => l.release());

    const stagger = this.ctx.scaledDuration(150, 75);
    await Promise.all(msgs.map((m, i) => {
      const delay = i * stagger;
      const opts = { guardTimeout: false, keepFloats: true, externalHandLock: innerHandLocks[i] };
      return delay > 0
        ? new Promise<void>(r => setTimeout(r, delay)).then(() => this.runDrawSequence(m, opts))
        : this.runDrawSequence(m, opts);
    }));
  }

  // --- Unified draw sequence (Axe 5: runPlayerInitialDraw + processSingleDraw → runDrawSequence) ---

  /**
   * Core draw loop: locks HAND + DECK, loops travelToHand() per card, commits.
   * @param opts.guardTimeout If true, sets a timeout guard that force-continues on hang.
   * @param opts.keepFloats If true, landed floats are kept as visual proxies (initial draw).
   * @param opts.externalHandLock If provided, reused as the HAND zone lock
   *   instead of acquiring a fresh one. Two callers use this :
   *   1. `runParallelInitialDraw` poses both inner hand locks SYNCHRONOUSLY
   *      upfront, then `release()`s the `earlyLocks` of `launchInitialDraw`
   *      immediately (ref-count 2→1 each, no commitZone yet) — the earlyLocks
   *      no longer live across the full ~1500ms travel, so the safety timeout
   *      race (commit decrement vs timer fire, both landing in the same 10ms
   *      window at t≈1500ms) is structurally impossible. The final inner
   *      handLock.commit() drops ref-count 1→0 and triggers commitZone normally.
   *   2. `launchInitialDraw`'s single-msg fallback path hands the
   *      HAND-${relPlayer} earlyLock directly here so `runDrawSequence`'s
   *      final commit() fires commitZone in the same tick as
   *      `clearLandedByDstPrefix` + `handExpansionSlots` retraction — no
   *      visible "fan empty" flicker between cleanup and the deferred
   *      `earlyLocks.commit()` of the finally block.
   *   Console-log repro 2026-06-05 (`console-export-2026-6-5_16-20-24`).
   */
  private async runDrawSequence(msg: DrawMsg, opts: { guardTimeout: boolean; keepFloats?: boolean; externalHandLock?: ZoneLock }): Promise<void> {
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
    this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — locking %s + %s lockDeck=%s external=%s (locks before: %d)',
      dstKey, srcKey, lockDeck, !!opts.externalHandLock, this.rbs.lockedZoneKeys().length);
    const handLock = opts.externalHandLock ?? this.rbs.lockZone(dstKey);
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

    // Reserve N expansion slots upfront so the fan lays out for the final
    // hand size — same upfront-reservation pattern used by `beginHandBatch`
    // in the tutor flow (`BufferReplayBuilder` → reveal sequence). We
    // cannot reuse `beginHandBatch` here because its `duelAssert` forbids
    // overlap with `_drawsInFlight`, which is already non-empty in the
    // mid-game path (`processMidGameDraw` adds to the set before calling).
    // The bookkeeping is the same: bump the signal by `drawCount`, hand
    // each iteration a unique slot index offset from the existing rendered
    // hand count, drop everything back to zero after the post-commit
    // cleanup.
    //
    // The slot index MUST be `existingHandCount + i`, NOT just `i`:
    // `resolveHandTarget(numeric)` walks ALL `.hand-card` (real +
    // expansion), so `0..N-1` would target the FIRST N real cards on
    // the left of the fan — the "draws drift left" regression where
    // floats flew onto existing hand cards instead of the freshly
    // rendered expansion slots on the right.
    const existingHandCount = this.rbs.renderedState().players[relPlayer].zones
      .find(z => z.zoneId === 'HAND')?.cards.length ?? 0;
    this.handExpansionSlots.update(c => {
      const next: [number, number] = [...c];
      next[relPlayer] += drawCount;
      return next;
    });

    await new Promise<void>(resolve =>
      afterNextRender(() => resolve(), { injector: this.injector })
    );

    for (let i = 0; i < drawCount; i++) {
      const card = msg.cards[i];
      const cardImage = isOwn && card
        ? this.cardTravelEngine.toAbsoluteUrl(`/api/documents/small/code/${card}`)
        : this.cardTravelEngine.toAbsoluteUrl('assets/images/card_back.jpg');
      const slotIdx = existingHandCount + i;
      // `targetIndex=slotIdx` makes `travelToHand` run in batch mode
      // (`manageSlotsLocally=false`) — the upfront reservation above
      // owns the slot bookkeeping.
      await this.travelToHand(srcKey, relPlayer, cardImage, {
        duration: travelDuration, showBack: true, flipDuringTravel: isOwn && !!card,
      }, slotIdx, undefined, card || undefined);
      // NO clearLandedTravels between cards — that was the root cause of
      // the multi-card regression. Floats stay landed on their reserved
      // slots until the post-commit `clearLandedByDstPrefix(dstKey)`
      // below runs (mid-game) or `resetHandAnimationState()` clears them
      // (initial draw). Critically, `clearLandedTravels` was UNFILTERED
      // → removing landed floats from OTHER zones (GY, BANISHED) when
      // they happened to be in flight at the same time as the draw —
      // the "discard MOVE→GY disappears from GY" replay bug.
    }

    this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — committing locks, renderedHand=%d',
      this.rbs.renderedState().players?.[0]?.zones?.find(z => z.zoneId === 'HAND')?.cards?.length ?? 0);
    handLock.commit();
    deckLock?.commit();
    // Drop the landed floats for THIS zone immediately after the commit —
    // the real `.hand-card` elements just rendered (commitZone fired
    // inside handLock.commit when ref-count → 0). Letting the floats
    // survive until `launchInitialDraw`'s finally block (Promise.all
    // resolution, ~150ms stagger with the other half) leaves a window
    // where the real cards render UNDERNEATH the still-visible proxy
    // floats — Axel's "vraies cartes sous les cartes d'animation"
    // symptom. Console-log repro `console-export-2026-6-5_16-37-34.log` :
    // L150 commitZone(HAND-0) | rendered_before=-1 landedFloatsHere=5 →
    // L155 commitZone(HAND-1) | landedFloatsHere=5 → L158 POST-COMMIT
    // (sync) | floats HAND-0=5 HAND-1=5 → L159 POST-CLEAR-FLOATS finally
    // wipes them globally. Filtered (`*ByDstPrefix(dstKey)`) so other
    // zones' in-flight/landed floats (GY, BANISHED, …) stay intact.
    this.floatRegistry.clearLandedByDstPrefix(dstKey);
    this.logger.log(DuelLogCategory.DRAW, 'runDrawSequence — committed, renderedHand=%d locks=%d',
      this.rbs.renderedState().players?.[0]?.zones?.find(z => z.zoneId === 'HAND')?.cards?.length ?? 0,
      this.rbs.lockedZoneKeys().length);
    if (guardId !== null) clearTimeout(guardId);

    // Retract the expansion slots reserved upfront — `commitZone(HAND-${rel})`
    // just rendered the real cards (drawCount of them), so the fake slots
    // are now redundant. Deferring this to the runner's finalize / to
    // `launchInitialDraw.finally`'s `resetHandAnimationState` causes a
    // visible layout snap : during the fenêtre between commitZone and
    // the deferred clear, the fan width = `existingHandCount + drawCount
    // (real) + drawCount (fake slots)` = `2 × drawCount`. When the fake
    // slots finally drop, the fan contracts and the real cards visibly
    // slide leftwards — Axel's "cartes poussées vers la gauche comme si
    // des cartes à droite apparaissent et étaient masquées" symptom
    // (2026-06-05 follow-up to the "vraies cartes sous les floats" fix).
    // Doing it here, in the same tick as commitZone + clearLandedByDstPrefix,
    // keeps the layout transition atomic : fake slots leave at the same
    // time the real cards arrive, no visual contraction.
    this.handExpansionSlots.update(c => {
      const next: [number, number] = [...c];
      next[relPlayer] = Math.max(0, next[relPlayer] - drawCount);
      return next;
    });

    // No post-commit highlight on draw — the user contract is:
    //   - Draw: travel deck→hand only, no reveal/highlight pulse.
    //   - Tutor: per-card travel + reveal (handled by the dedicated
    //     `confirmCardsInHand` path triggered by MSG_CONFIRM_CARDS).
    // The previous `highlightDrawnCard` call on `lastCard` only fired in
    // PvP (replay's batch dispatch path skips it via a different code
    // route), and `lastCard` resolved to an OLD card on the right of the
    // fan whenever OCGCore inserted the new draws at index 0 of the hand
    // array — so the highlight ended up pulsing a card the user never
    // drew. Dropping it altogether matches the documented behaviour and
    // restores PvP↔Replay parity.
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
      await this.cardTravelEngine.travel(src, target, cardImage, {
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
    const zone = this.cardTravelEngine.getZoneElement(zoneKey);
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
    if (this._onQueueResume) {
      // Defer to next microtask. When this is called from a synchronously-
      // resolving .finally() inside an 'async'-returning event handler (e.g.
      // MSG_CONFIRM_CARDS for a non-HAND card where confirmCardsInHand's loop
      // only hits `continue`), the QueueRunner's inner-loop .finally has not
      // yet cleared its `_isProcessing` flag, so `notifyEnqueue()` would
      // no-op on the runner's re-entry guard. queueMicrotask lets the inner
      // finally run first.
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

    // Only steal a MOVE→HAND from THIS shuffle's segment of the queue.
    // At dense pacing (D/D/D tutor cluster, 2026-06-12) a later chain's
    // tutor MOVE→HAND can already sit in the queue when this shuffle runs ;
    // a barrier-free scan would steal it and play it inside the wrong chain
    // window (parity break — the move surfaces N chains too early). Stop at
    // the first chain-boundary message : a MOVE→HAND past a CHAINING /
    // SOLVING / SOLVED / END belongs to a different chain and must stay
    // queued for its own dispatch.
    const moveMsg = peekAndDequeueMatching<MoveMsg>(this.dataSource,
      e => e.type === 'MSG_MOVE' && (e as MoveMsg).toLocation === LOCATION.HAND,
      e => e.type === 'MSG_CHAINING' || e.type === 'MSG_CHAIN_SOLVING'
        || e.type === 'MSG_CHAIN_SOLVED' || e.type === 'MSG_CHAIN_END',
    );

    this.logger.log(DuelLogCategory.SHUFFLE, 'processShuffleEvent START relPlayer=%d', relPlayer);

    if (moveMsg) {
      this.logger.log(DuelLogCategory.SHUFFLE, 'moveMsg found — processing');
      // The MOVE was pulled straight out of the animation queue, so it
      // never went through the orchestrator's `processEvent` → never hit
      // `pushToStream`. Record it on the EventStream now so the journal /
      // parity stream sees the "→ Hand" event exactly once (its travel is
      // folded into the shuffle re-layout below — no double animation).
      // Without this the move is silently lost at dense pacing where the
      // shuffle steals it before chain-buffer replay can dispatch it
      // (D/D/D tutor cluster, 2026-06-12).
      this._onStolenMoveForStream?.(moveMsg);
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

    const handZone = this.cardTravelEngine.getZoneElement(handZoneKey);

    if (this.ctx.reducedMotion() || !handZone) {
      this.floatRegistry.clearLandedByDstPrefix('HAND');
      // 2026-06-04 Option H — sync HAND only. Was `commitAll()` which wipes
      // every other actor's lock and zombifies their ZoneLock closures. The
      // shuffle phase only needs HAND-${player} synced; other zones'
      // pre-locks must stay alive for their owners' subsequent commits.
      this.rbs.commitZone(handZoneKey);
      return;
    }

    // Capture ALL landed HAND floats — each represents a newly added card
    // (search / tutor). Stabilize their positions so they can each animate
    // independently to their post-shuffle DOM slot.
    const handPrefix = `HAND-${relPlayer}`;
    const landedFloats = this.floatRegistry.getLandedFloatsByDstPrefix(handPrefix);
    const baseRZ = this.ctx.cardBaseRotateCSS(relPlayer);
    const containerRect = this.cardTravelEngine.getContainer().getBoundingClientRect();
    const floatByCode = new Map<string, { el: HTMLDivElement; rect: DOMRect }[]>();
    for (const el of landedFloats) {
      const rect = this.floatRegistry.stabilizeFloat(el, baseRZ, containerRect);
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

      // Force-sync HAND only so the rendered hand includes the newly added
      // cards (so DOM measurement below sees them). 2026-06-04 Option H —
      // was `commitAll()` which wipes every other actor's lock and zombifies
      // their ZoneLock closures (concretely, the runner's `preLockQueuedSources`
      // pre-lock on HAND-${player} acquired before the buffer drain, which
      // a subsequent discard MOVE Krosea would `consumePreLock` and call
      // `commit()` on — leading to a no-op silent skip because the wiped
      // `_locks` map made the closure orphan). See spec
      // `_bmad-output/planning-artifacts/bug-post-chain-solved-buffer-drain-2026-06-04.md`.
      this.rbs.commitZone(handZoneKey);

      // Retire the expansion slot reserved by `BufferReplayBuilder` BEFORE
      // we measure post-commit positions. Otherwise the new real card lands
      // at its "with-expansion" position, the float slides there, and the
      // expansion is only retired at `batch-end` → the fan shrinks AFTER
      // the float has landed (visible "pop"). Idempotent vs the second
      // `endHandBatch` at `batch-end` (no-op when no batch is active).
      this.endHandBatch(relPlayer);

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
      this.floatRegistry.clearLandedByDstPrefix('HAND');
    } catch (e) {
      this.logger.warn('Shuffle phase failed — committing state', e);
      this.rbs.commitAll();
      this.floatRegistry.clearLandedByDstPrefix('HAND');
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
    const handCards = msg.cards.filter(c => c.location === LOCATION.HAND);
    const deckCards = msg.cards.filter(c => c.location === LOCATION.DECK);
    // Cards confirmed at a field zone (e.g. a card Set face-down from the
    // deck — public info both players may see). location is the post-Set
    // position, so it's MZONE/SZONE rather than the source DECK.
    const fieldCards = msg.cards.filter(
      c => c.location === LOCATION.MZONE || c.location === LOCATION.SZONE,
    );
    // Cards confirmed inside a pile zone (GY / Banished) — e.g. an effect that
    // reveals cards from the graveyard to prove a cost or condition. Pile
    // zones only render their top card, so the reveal needs a lift-out
    // overlay, same shape as the deck-top reveal.
    const pileCards = msg.cards.filter(
      c => c.location === LOCATION.GRAVE || c.location === LOCATION.BANISHED,
    );
    // Sequence: DECK reveal first (card is shown then hidden again, no logical
    // state change), THEN HAND reveal (player materialization). Running both
    // in parallel would overlap visually; the deck reveal sets context for
    // any hand reveal that follows in the same MSG_CONFIRM_CARDS batch.
    // FIELD then PILE reveals run last — the card is already in place, the
    // reveal is a brief lift/flip overlay.
    if (deckCards.length || handCards.length || fieldCards.length || pileCards.length) {
      return (async () => {
        if (deckCards.length) await this.confirmCardsOnDeck(deckCards);
        if (handCards.length) await this.confirmCardsInHand(handCards);
        if (fieldCards.length) await this.confirmCardsOnField(fieldCards);
        if (pileCards.length) await this.confirmCardsOnPile(pileCards);
      })();
    }
    // No card matched a known bucket (HAND/DECK/MZONE/SZONE/GRAVE/BANISHED) —
    // an EXTRA/OVERLAY confirm or a protocol drift. Surface it instead of
    // silently dropping the reveal.
    this.logger.warn(
      'processConfirmCardsEvent — %d card(s) in unhandled location(s): %o',
      msg.cards.length,
      msg.cards.map(c => c.location),
    );
    return 0;
  }

  /** Scaled lift/hold/fade durations shared by the deck-top and pile reveals
   *  (`confirmCardsOnDeck` / `confirmCardsOnPile` — identical lift overlay). */
  private pileRevealDurations(): { lift: number; hold: number; fade: number } {
    return {
      lift: this.ctx.scaledDuration(PILE_REVEAL_LIFT_MS, PILE_REVEAL_LIFT_MIN_MS),
      hold: this.ctx.scaledDuration(PILE_REVEAL_HOLD_MS, PILE_REVEAL_HOLD_MIN_MS),
      fade: this.ctx.scaledDuration(PILE_REVEAL_FADE_MS, PILE_REVEAL_FADE_MIN_MS),
    };
  }

  async confirmCardsInHand(cards: readonly { cardCode: number; player: number; sequence: number }[]): Promise<void> {
    const flipDuration = this.ctx.scaledDuration(HAND_CONFIRM_FLIP_MS, HAND_CONFIRM_FLIP_MIN_MS);
    const highlightDuration = this.ctx.scaledDuration(PILE_REVEAL_HIGHLIGHT_MS, PILE_REVEAL_HIGHLIGHT_MIN_MS);
    const holdDuration = this.ctx.scaledDuration(HAND_CONFIRM_HOLD_MS, HAND_CONFIRM_HOLD_MIN_MS);
    let animatedCount = 0;

    for (const card of cards) {
      // Prefer matching float by cardCode so an interleaved per-card CONFIRM
      // reveals the correct ghost — otherwise FIFO re-pops a previously
      // returned float and the reveal plays on the wrong card. Fallback
      // without cardCode covers face-down / opponent-perspective floats that
      // weren't tagged at travel time.
      let floatEl = this.floatRegistry.popLandedFloat('HAND', card.cardCode);
      if (!floatEl) floatEl = this.floatRegistry.popLandedFloat('HAND');
      this.logger.log(DuelLogCategory.SHUFFLE, 'confirmCardsInHand — popLandedFloat=%s cardCode=%d', !!floatEl, card.cardCode);
      if (!floatEl) continue;
      animatedCount++;

      const relPlayer = this.ctx.relativePlayer(card.player);

      const baseRZ = this.ctx.cardBaseRotateCSS(relPlayer);
      const containerRect = this.cardTravelEngine.getContainer().getBoundingClientRect();
      this.floatRegistry.stabilizeFloat(floatEl, baseRZ, containerRect);

      if (relPlayer === 1) {
        const img = floatEl.querySelector('img');
        if (img) {
          const cardFaceUrl = this.cardTravelEngine.toAbsoluteUrl(`/api/documents/small/code/${card.cardCode}`);
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

      this.floatRegistry.returnToLanded(floatEl as HTMLDivElement);
    }
    this.logger.log(DuelLogCategory.SHUFFLE, 'confirmCardsInHand — done: animated=%d/%d', animatedCount, cards.length);
  }

  /** Reveal cards that stay on the deck (CONFIRM_DECKTOP): float lifts from the deck, shows face, fades out.
   *  Lifecycle delegated to `BoardEffectsService.revealCardOnDeck` — the float is tracked as an overlay so
   *  reset / disconnect / destroy clears it (no DOM leak). */
  async confirmCardsOnDeck(cards: readonly { cardCode: number; player: number }[]): Promise<void> {
    const durations = this.pileRevealDurations();
    const highlightDuration = this.ctx.scaledDuration(PILE_REVEAL_HIGHLIGHT_MS, PILE_REVEAL_HIGHLIGHT_MIN_MS);

    for (const card of cards) {
      const relPlayer = this.ctx.relativePlayer(card.player);
      const deckKey = `DECK-${relPlayer}`;
      const cardFaceUrl = this.cardTravelEngine.toAbsoluteUrl(`/api/documents/small/code/${card.cardCode}`);
      // Own deck is at the bottom (negative Y lifts toward center); opponent deck at top (positive Y).
      const liftY = relPlayer === 0 ? -PILE_REVEAL_LIFT_OFFSET_PX : PILE_REVEAL_LIFT_OFFSET_PX;
      await this.boardEffects.revealCardOnDeck(
        deckKey,
        cardFaceUrl,
        liftY,
        durations,
        (el) => this.highlightDrawnCard(el, highlightDuration, relPlayer === 1),
      );
    }
  }

  /**
   * Reveal cards confirmed at a field zone (MSG_CONFIRM_CARDS with
   * `location === MZONE | SZONE`) — e.g. a card Set face-down on the field
   * from the deck, which is public info both players may see. The card is
   * already on the board face-down; `revealCardOnField` overlays a brief
   * flip-up → glow ×2 → flip-down animation on the zone. A `cardCode` of 0
   * (should not happen for a public reveal) is skipped — no face to show.
   */
  async confirmCardsOnField(
    cards: readonly { cardCode: number; player: number; location: CardLocation; sequence: number }[],
  ): Promise<void> {
    const durations = {
      flip: this.ctx.scaledDuration(FIELD_REVEAL_FLIP_MS, FIELD_REVEAL_FLIP_MIN_MS),
      lift: this.ctx.scaledDuration(FIELD_REVEAL_LIFT_MS, FIELD_REVEAL_LIFT_MIN_MS),
      glow: this.ctx.scaledDuration(FIELD_REVEAL_GLOW_MS, FIELD_REVEAL_GLOW_MIN_MS),
      hold: this.ctx.scaledDuration(FIELD_REVEAL_HOLD_MS, FIELD_REVEAL_HOLD_MIN_MS),
    };
    const cardBackUrl = this.cardTravelEngine.toAbsoluteUrl('assets/images/card_back.jpg');

    for (const card of cards) {
      if (!card.cardCode) continue;
      const relPlayer = this.ctx.relativePlayer(card.player);
      const zoneKey = locationToZoneKey(card.location, card.sequence, relPlayer);
      const cardFaceUrl = this.cardTravelEngine.toAbsoluteUrl(`/api/documents/small/code/${card.cardCode}`);
      await this.boardEffects.revealCardOnField(zoneKey, cardFaceUrl, cardBackUrl, durations);
    }
  }

  /**
   * Reveal cards confirmed inside a pile zone (MSG_CONFIRM_CARDS with
   * `location === GRAVE | BANISHED`) — e.g. an effect that reveals cards from
   * the graveyard to prove a cost or condition. Pile zones render only their
   * top card, so the reveal lifts a card-shaped overlay out of the pile,
   * shows the face, then fades — same lift/hold/fade shape as the deck-top
   * reveal, just anchored on the GY / Banished zone. A `cardCode` of 0 is
   * skipped (no face to show).
   */
  async confirmCardsOnPile(
    cards: readonly { cardCode: number; player: number; location: CardLocation }[],
  ): Promise<void> {
    const durations = this.pileRevealDurations();
    const highlightDuration = this.ctx.scaledDuration(PILE_REVEAL_HIGHLIGHT_MS, PILE_REVEAL_HIGHLIGHT_MIN_MS);

    for (const card of cards) {
      if (!card.cardCode) continue;
      const relPlayer = this.ctx.relativePlayer(card.player);
      const zoneKey = locationToZoneKey(card.location, 0, relPlayer);
      const cardFaceUrl = this.cardTravelEngine.toAbsoluteUrl(`/api/documents/small/code/${card.cardCode}`);
      // Own piles sit at the bottom (lift toward centre = negative Y);
      // opponent piles at the top (positive Y) — mirrors confirmCardsOnDeck.
      const liftY = relPlayer === 0 ? -PILE_REVEAL_LIFT_OFFSET_PX : PILE_REVEAL_LIFT_OFFSET_PX;
      await this.boardEffects.revealCardOnDeck(
        zoneKey,
        cardFaceUrl,
        liftY,
        durations,
        (el) => this.highlightDrawnCard(el, highlightDuration, relPlayer === 1),
      );
    }
  }

}
