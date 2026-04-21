import { effect, type EffectRef, inject, Injectable, Injector, isDevMode, signal } from '@angular/core';
import type { DuelState, GameEvent } from '../types';
import type { MoveMsg, DrawMsg, DamageMsg, RecoverMsg, PayLpCostMsg, FlipSummoningMsg, ChangePosMsg, ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ShuffleHandMsg, ConfirmCardsMsg, ShuffleDeckMsg, BecomeTargetMsg, SwapMsg, AttackMsg, BattleMsg, TossCoinMsg, TossDiceMsg, EquipMsg, AddCounterMsg, RemoveCounterMsg, ShuffleSetCardMsg, SwapGraveDeckMsg, CardInfo } from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';
import { getCardImageUrlByCode } from '../pvp-card.utils';
import { locationToZoneId, locationToZoneKey } from '../pvp-zone.utils';
import { ANIMATION_DATA_SOURCE, type QueueDirective, type QueueEntry } from './animation-data-source';
import { CHAIN_POLL_BASE_DELAY_MS, CHAIN_POLL_CEILING, CHAIN_POLL_MAX_DELAY_MS, GROUP_STAGGER_MS, LOCK_SAFETY_TIMEOUT_MS, QUEUE_COLLAPSE_KEEP, QUEUE_COLLAPSE_THRESHOLD, REPLAY_BUFFER_SAFETY_TIMEOUT_MS } from './animation-constants';
import { CardTravelService } from './card-travel.service';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DrawSequenceManager } from './draw-sequence-manager';
import { BattleAnimationTracker } from './battle-animation-tracker';
import { DuelContext } from './duel-context';
import { DuelLogCategory, DuelLogger } from './duel-logger';
import { LpAnimationTracker } from './lp-animation-tracker';
import { MoveAnimationRouter } from './move-animation-router';
import { DuelToastService } from './duel-toast.service';
import { EQUIP_LINE_COLOR, EQUIP_LINE_SHADOW } from './equip-line.constants';

/**
 * Central animation queue processor for the duel page.
 * Provided at component level (NOT root).
 *
 * Thin coordinator that owns:
 * - Queue loop (processAnimationQueue, queue collapse)
 * - Event dispatch switch (processEvent → delegates to managers)
 * - Cross-cutting replay logic (replayBuffer via queue directives)
 * - Reset/destroy lifecycle
 *
 * Extracted managers:
 * - ChainResolutionManager: chain state, signals, buffer, replay timeouts
 * - DrawSequenceManager: draw sequences, travelToHand, hand expansion slots,
 *   shuffle/confirm subsystem (processShuffleEvent, confirmCardsInHand)
 * - MoveAnimationRouter: MSG_MOVE routing, destination hiding, source pre-locking
 * - LpAnimationTracker: LP tracking, counter animation, pending LP commit
 * - BattleAnimationTracker: attack line + clash impact, pending attack release
 */
@Injectable()
export class AnimationOrchestratorService {
  private readonly logger = inject(DuelLogger);
  readonly lpTracker = inject(LpAnimationTracker);
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly cardTravelService = inject(CardTravelService);
  private readonly ctx = inject(DuelContext);
  readonly chainManager = inject(ChainResolutionManager);
  readonly drawManager = inject(DrawSequenceManager);
  readonly moveRouter = inject(MoveAnimationRouter);
  private readonly battleTracker = inject(BattleAnimationTracker);
  private readonly toastService = inject(DuelToastService);

  // --- Public read-only signals ---
  private readonly _isAnimating = signal(false);
  readonly isAnimating = this._isAnimating.asReadonly();
  readonly animatingZone = signal<{
    zoneId: string;
    animationType: 'flip' | 'activate';
    relativePlayerIndex: number;
  } | null>(null);

  /** Single source of truth for the chain pulse glow duration (ms). */
  chainPulseDuration(): number {
    return Math.round(600 * this.ctx.speedMultiplier());
  }

  /** Single source of truth for the chain exit animation duration (ms). */
  chainExitDuration(): number {
    return Math.round(600 * this.ctx.speedMultiplier());
  }

  /** Current speed multiplier (0.5 when speed toggle is Off, 1 otherwise). */
  speedMultiplier(): number {
    return this.ctx.speedMultiplier();
  }

  private readonly injector = inject(Injector);

  // --- Internal state ---
  private animationTimeouts: ReturnType<typeof setTimeout>[] = [];
  /** Active equip line elements — tracked for cleanup on destroy/reset. */
  private activeEquipLines: HTMLDivElement[] = [];
  /** Chain polling: pending poll timeout (cleared on interruptPoll or destroy). */
  private _pollTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Chain polling: back-off delay (50→100→200→…→500ms), reset on event dequeue. */
  private _pollDelay = CHAIN_POLL_BASE_DELAY_MS;
  /** Chain polling: consecutive empty polls (safety ceiling — force finalize after 30). */
  private _pollCount = 0;
  /** Re-entry guard for processAnimationQueue (prevents double-dequeue). */
  private _isProcessing = false;
  /** Active await-signal effect (cleaned up on destroy/resetForSwitch). */
  private _awaitSignalEffect: EffectRef | null = null;

  /**
   * Commit mode for the queue loop. Every commit decision is a single switch.
   * - per-event: chain idle, normal queue — commitUnlocked after each event
   * - deferred: chain building/resolving — no commits (chain not done)
   */
  private get commitMode(): 'per-event' | 'deferred' {
    // Only defer during resolving (server sends batches with gaps between links).
    // During building (MSG_CHAINING / prompt answers), queue-empty is normal —
    // finalize so setAnimating(false) triggers advanceStep → prompt display.
    if (this.dataSource.chainPhase() === 'resolving') return 'deferred';
    return 'per-event';
  }

  /** Zone keys of cards currently being targeted (MSG_BECOME_TARGET). */
  readonly targetedZoneKeys = signal<ReadonlySet<string>>(new Set());
  /** Zone key of card with pulsing counter badge (MSG_ADD_COUNTER / MSG_REMOVE_COUNTER). */
  readonly counterPulseKey = signal<string | null>(null);
  /** Zone keys of GY+DECK pulsing during SWAP_GRAVE_DECK. */
  readonly swapGraveDeckKeys = signal<ReadonlySet<string>>(new Set());
  /** Temporary reveal map for MSG_CONFIRM_CARDS: opponent hand index → cardCode. */
  readonly confirmRevealedCards = signal<ReadonlyMap<number, number>>(new Map());

  private get rbs() { return this.dataSource.renderedBoardState; }

  private scheduleTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(fn, ms);
    this.animationTimeouts.push(id);
    return id;
  }

  private finalizeAndCommit(): void {
    this.cardTravelService.clearAllTravels();
    this.lpTracker.clearPending();
    this.trace('commitUnlocked', { site: 'finalizeAndCommit' });
    this.rbs.commitUnlocked();
  }

  constructor() {
    // Wire CardTravelService for [LOCK-ASSERT] dev-mode assertion in commitUnlocked().
    this.rbs.cardTravelService = this.cardTravelService;
    // Resume effect: when overlay signals ready, resume queue processing.
    // Handles the negated/no-buffer case where replayBuffer is NOT called.
    this.chainManager.initResumeEffect(() => {
      if (this._isAnimating()) this.processAnimationQueue();
    });
    // Wire draw manager queue resume callback
    this.drawManager.initQueueResumeCallback(() => this.processAnimationQueue());
  }

  /** Called by the animation queue watcher effect in the component. */
  startProcessingIfIdle(): void {
    this.trace('startProcessingIfIdle', { isAnimating: this._isAnimating(), isProcessing: this._isProcessing, queueLen: this.dataSource.animationQueue().length });
    if (!this._isAnimating()) {
      this._isAnimating.set(true);
      this.dataSource.setAnimating(true);
      // Pre-lock all animated zones before first commitUnlocked — centralized
      // for both PvP and replay so cards don't appear at their destination
      // before the travel animation plays.
      this.moveRouter.preLockQueuedSources();
      this.processAnimationQueue();
    } else {
      this.interruptPoll(); // wake up immediately if polling during chain
    }
  }

  /**
   * Interrupts a pending chain poll timeout, resets back-off, and resumes
   * queue processing immediately. Called when new events arrive while the
   * orchestrator is polling (chain gap).
   */
  private interruptPoll(): void {
    if (this._pollTimeout !== null) {
      clearTimeout(this._pollTimeout);
      this._pollTimeout = null;
      this._pollDelay = CHAIN_POLL_BASE_DELAY_MS;
      this.processAnimationQueue();
    }
  }

  /** Sync tracked LP to authoritative board state. */
  syncTrackedLp(playerLp: number, opponentLp: number): void {
    this.lpTracker.syncFromBoardState(playerLp, opponentLp);
  }

  /** Returns [playerLp, opponentLp] for the current tracked values. */
  getTrackedLp(): [number, number] {
    return this.lpTracker.getTrackedLp();
  }

  // ---------------------------------------------------------------------------
  // Replay buffered events (Phase 6: batch queue with directives)
  // ---------------------------------------------------------------------------

  /**
   * Drain chain-buffered events and re-inject them into the main queue as
   * directives. The queue loop processes them identically to normal events.
   * Returns a Promise that resolves when the batch-end sentinel fires.
   *
   * Replaces the old replayBufferedEvents (~80 lines of parallel pipeline).
   */
  replayBuffer(inlineFromLoop = false): Promise<void> {
    const buffer = this.chainManager.drainBuffer();
    this.logger.log(DuelLogCategory.REPLAY, 'replayBuffer — bufferLen=%d ownPlayer=%d', buffer.length, this.ctx.ownPlayerIndex());

    if (buffer.length === 0) return Promise.resolve();

    // Reduced motion: apply state changes instantly
    if (this.ctx.reducedMotion()) {
      for (const event of buffer) {
        if (event.type === 'MSG_MOVE') this.moveRouter.processMoveEvent(event as MoveMsg);
        else if (event.type === 'MSG_DRAW') this.drawManager.processDrawEvent(event as DrawMsg);
      }
      this.rbs.commitAll();
      for (const event of buffer) {
        if (event.type === 'MSG_DAMAGE' || event.type === 'MSG_RECOVER' || event.type === 'MSG_PAY_LPCOST') {
          this.lpTracker.fireLpReplayEvent(event);
        }
      }
      return Promise.resolve();
    }

    const isZoneEvent = (e: GameEvent) => e.type === 'MSG_MOVE' || e.type === 'MSG_DRAW';
    const isLpEvent = (e: GameEvent) =>
      e.type === 'MSG_DAMAGE' || e.type === 'MSG_RECOVER' || e.type === 'MSG_PAY_LPCOST';
    const KNOWN_BUFFER_TYPES = new Set([
      'MSG_MOVE', 'MSG_DRAW', 'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
      'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_SET', 'MSG_SHUFFLE_HAND',
      'MSG_CONFIRM_CARDS', 'MSG_SHUFFLE_DECK', 'MSG_TOSS_COIN', 'MSG_TOSS_DICE',
      'MSG_EQUIP', 'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER', 'MSG_SHUFFLE_SET_CARD',
      'MSG_SWAP_GRAVE_DECK', 'MSG_BECOME_TARGET', 'MSG_SWAP',
    ]);
    const unknown = buffer.filter(e => !KNOWN_BUFFER_TYPES.has(e.type));
    if (unknown.length) {
      this.logger.warn('replayBuffer: %d unknown event type(s): %o', unknown.length, unknown.map(e => e.type));
    }

    // Interleave MSG_CONFIRM_CARDS cards with their matching MOVE→HAND events.
    // For each card in a CONFIRM, find the earliest unconsumed preceding
    // MOVE→HAND with the same (cardCode, player); emit a single-card CONFIRM
    // immediately after that MOVE. Cards with no match remain in the original
    // CONFIRM at its original position. Produces tutor→reveal→tutor→reveal →
    // … → shuffle flow instead of tutor→tutor→reveal-all→discard.
    const interleaved = this.interleaveConfirmsWithMoves(buffer);

    // Session HAND lock + expansion-slot batch: hold HAND across the entire
    // buffer replay so travelToHand/discardFromHand inner commits only
    // decrement their own ref-count without firing commitZone(HAND). This
    // keeps rendered HAND at its pre-chain state throughout the sequence,
    // otherwise:
    //   - For tutors: the first tutor's commit would snap rendered HAND to
    //     the pre-computed FINAL logical state mid-way.
    //   - For discards: the first discard's commit would remove the
    //     subsequent cards from the HAND DOM, breaking
    //     `resolveHandTarget(HAND, fromSeq)` for discard 2/3 — they'd
    //     animate from the HAND zone centre instead of their real card
    //     position.
    //
    // Also reserves N distinct expansion slots per affected player via
    // `drawManager.beginHandBatch` (only for MOVE→HAND), so tutor1 lands at
    // slot 0, tutor2 at slot 1, etc., each keeping the fan's per-index
    // rotation. Released at batch-end.
    const sessionHandLocks: Array<{ commit(): void; release(): void }> = [];
    const handMoveCountByRelPlayer = new Map<0 | 1, number>();
    const handInvolvedRelPlayers = new Set<0 | 1>();
    for (const e of interleaved) {
      if (e.type !== 'MSG_MOVE') continue;
      const mm = e as MoveMsg;
      const touchesHand = mm.toLocation === LOCATION.HAND || mm.fromLocation === LOCATION.HAND;
      if (!touchesHand) continue;
      const rp = this.ctx.relativePlayer(mm.player);
      handInvolvedRelPlayers.add(rp);
      if (mm.toLocation === LOCATION.HAND) {
        handMoveCountByRelPlayer.set(rp, (handMoveCountByRelPlayer.get(rp) ?? 0) + 1);
      }
    }
    for (const rp of handInvolvedRelPlayers) {
      sessionHandLocks.push(this.rbs.lockZone(`HAND-${rp}`));
    }
    for (const [rp, count] of handMoveCountByRelPlayer) {
      this.drawManager.beginHandBatch(rp, count);
    }

    // Pre-lock all zone event sources across the entire buffer
    this.moveRouter.preLockQueuedSources(interleaved.filter(isZoneEvent));

    // Build batch preserving buffer chronology.
    // Consecutive zone events (MSG_MOVE/MSG_DRAW) are grouped for parallel
    // travel with stagger; a barrier follows each group so subsequent events
    // see cards in their final positions. When a single-card CONFIRM has been
    // inlined right after a MOVE→HAND (see interleaveConfirmsWithMoves), the
    // MOVE becomes a group of one, followed by barrier and its reveal.
    const batch: QueueEntry[] = [];
    let pendingGroup: GameEvent[] = [];

    const flushGroup = () => {
      if (pendingGroup.length === 0) return;
      batch.push({ kind: 'group', events: pendingGroup, staggerMs: GROUP_STAGGER_MS });
      batch.push({ kind: 'barrier' });
      pendingGroup = [];
    };

    // A zone event is an "overlay detach" when its source is the OVERLAY
    // location. We split the group at the boundary between overlay detach
    // events and other zone events so XYZ destruction plays cleanly:
    //   detach material 1 + detach material 2 (parallel, ~600ms)
    //   └─ barrier ─┘
    //   destroy monster (next group, ~400ms)
    // Without the split, all three animate together: the monster's
    // `preDestroyEffect` captures a srcEl that still holds the sliding-out
    // overlay children, and the monster finishes disappearing before its
    // materials finish their slide-out.
    const isOverlayDetach = (e: GameEvent): boolean =>
      e.type === 'MSG_MOVE' && (e as MoveMsg).fromLocation === LOCATION.OVERLAY;

    for (const e of interleaved) {
      if (isZoneEvent(e)) {
        const last = pendingGroup[pendingGroup.length - 1];
        if (last && isOverlayDetach(last) !== isOverlayDetach(e)) {
          // Category boundary (overlay→non-overlay or vice versa) — flush so
          // the two phases play sequentially with a barrier between them.
          flushGroup();
        }
        pendingGroup.push(e);
      } else {
        flushGroup();
        batch.push(isLpEvent(e) ? { kind: 'lp', event: e } : e);
      }
    }
    flushGroup();

    const releaseSessionLocks = () => {
      // Safety release: processShuffleEvent's commitAll() clears locks during
      // normal shuffle flow, and each lock's .release() is idempotent via the
      // internal `released` flag. Release all here so the last remaining
      // session lock drops HAND ref-count to the travelToHand commits' level
      // and commitZone(HAND) fires with the final logical state. Also
      // retires the hand-batch expansion slots so the post-commit fan lays
      // out against the final card count.
      for (const rp of handMoveCountByRelPlayer.keys()) {
        this.drawManager.endHandBatch(rp);
      }
      for (const l of sessionHandLocks) l.release();
    };

    // Inline path: called from mid-chain pre-replay inside _processAnimationQueueInner.
    // Prepend batch directly — the while loop continues and processes directives.
    // No await-signal (overlay not involved), no external processAnimationQueue
    // (would be a no-op since _isProcessing is true — causing a 10s deadlock).
    if (inlineFromLoop) {
      batch.push({ kind: 'batch-end', resolve: releaseSessionLocks });
      this.trace('batchEnqueue', { bufferLen: buffer.length, directives: batch.filter(e => 'kind' in e).length, inline: true });
      this.dataSource.prependToQueue(batch);
      this.chainManager.clearWaiting();
      return Promise.resolve();
    }

    // Overlay path: wrap in Promise — resolved by batch-end sentinel.
    // await-signal pauses the queue until overlay re-shows.
    return new Promise<void>(resolve => {
      const safety = setTimeout(() => {
        this.logger.warn('replayBuffer safety timeout — forcing resolve');
        resolve();
      }, REPLAY_BUFFER_SAFETY_TIMEOUT_MS);
      batch.push({
        kind: 'batch-end', resolve: () => {
          clearTimeout(safety);
          releaseSessionLocks();
          resolve();
        },
      });
      batch.push({ kind: 'await-signal', signal: this.chainManager.chainOverlayReady });

      this.trace('batchEnqueue', { bufferLen: buffer.length, directives: batch.filter(e => 'kind' in e).length });
      this.dataSource.prependToQueue(batch);

      // Queue is paused from MSG_CHAIN_SOLVED 'async'. Clear the overlay wait
      // flag so the isWaitingForOverlay guard doesn't block, then force-resume.
      this.chainManager.clearWaiting();
      this.processAnimationQueue();
    });
  }

  /**
   * Split aggregated MSG_CONFIRM_CARDS into per-card reveals inlined right
   * after each matching MOVE→HAND, so the visual flow becomes
   * `tutor1 → reveal1 → tutor2 → reveal2 → … → (unmatched remainder)`.
   *
   * Matching: confirm card is matched to the earliest unconsumed preceding
   * MOVE→HAND with the same (cardCode, player) AND the confirm card's
   * location === HAND. Unmatched cards stay as a reduced CONFIRM at the
   * original CONFIRM position.
   *
   * Consumed moves are tracked by reference so splice-induced index shifts
   * don't invalidate matching state across multiple CONFIRM events.
   */
  private interleaveConfirmsWithMoves(buffer: readonly GameEvent[]): GameEvent[] {
    const interleaved: GameEvent[] = [];
    const consumedMoves = new WeakSet<MoveMsg>();
    for (const e of buffer) {
      if (e.type !== 'MSG_CONFIRM_CARDS') { interleaved.push(e); continue; }
      const confirmMsg = e as ConfirmCardsMsg;
      const remaining: CardInfo[] = [];
      const matches: Array<{ card: CardInfo; moveIdx: number }> = [];
      for (const card of confirmMsg.cards) {
        let matchIdx = -1;
        for (let i = 0; i < interleaved.length; i++) {
          const prev = interleaved[i];
          if (prev.type !== 'MSG_MOVE') continue;
          const mm = prev as MoveMsg;
          if (consumedMoves.has(mm)) continue;
          if (mm.toLocation === LOCATION.HAND
            && mm.cardCode === card.cardCode
            && mm.player === card.player
            && card.location === LOCATION.HAND) {
            matchIdx = i;
            break;
          }
        }
        if (matchIdx >= 0) {
          consumedMoves.add(interleaved[matchIdx] as MoveMsg);
          matches.push({ card, moveIdx: matchIdx });
        } else {
          remaining.push(card);
        }
      }
      // Splice back-to-front so earlier indices stay valid during insertion.
      matches.sort((a, b) => b.moveIdx - a.moveIdx);
      for (const { card, moveIdx } of matches) {
        interleaved.splice(moveIdx + 1, 0, {
          type: 'MSG_CONFIRM_CARDS',
          player: confirmMsg.player,
          cards: [card],
        } as ConfirmCardsMsg);
      }
      if (remaining.length > 0) {
        interleaved.push({ ...confirmMsg, cards: remaining } as ConfirmCardsMsg);
      }
    }
    return interleaved;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private clearTimersAndPolling(): void {
    this.animationTimeouts.forEach(t => clearTimeout(t));
    this.animationTimeouts = [];
    for (const el of this.activeEquipLines) el.remove();
    this.activeEquipLines = [];
    if (this._pollTimeout !== null) { clearTimeout(this._pollTimeout); this._pollTimeout = null; }
    this._pollDelay = CHAIN_POLL_BASE_DELAY_MS;
    this._pollCount = 0;
    this._awaitSignalEffect?.destroy();
    this._awaitSignalEffect = null;
    this._isProcessing = false;
  }

  destroy(): void {
    this.clearTimersAndPolling();
    this._isAnimating.set(false);
    this.chainManager.reset();
    this.drawManager.clearTimeouts();
    this.moveRouter.clearTimeouts();
    this.moveRouter.releaseAllPreLocks();
    this.battleTracker.reset();
  }

  /** Shared reset logic for both resetForSwitch and onStateSync. */
  private resetAllState(): void {
    this.clearTimersAndPolling();
    this._isAnimating.set(false);
    this.drawManager.reset();
    this.drawManager.clearTimeouts();
    this.animatingZone.set(null);
    this.lpTracker.reset();
    this.battleTracker.reset();
    this.finalizeAndCommit();
    this.rbs.commitAll(); // Lifecycle: force-sync all zones + clear locks
    this.chainManager.reset();
    this.moveRouter.clearTimeouts();
    this.moveRouter.releaseAllPreLocks();
    this.confirmRevealedCards.set(new Map());
    this.targetedZoneKeys.set(new Set());
    this.counterPulseKey.set(null);
    this.swapGraveDeckKeys.set(new Set());
    this.toastService.clear();
  }

  resetForSwitch(): void {
    this.logger.log(DuelLogCategory.QUEUE, 'resetForSwitch — clearing all state & timeouts');
    this.resetAllState();
    document.querySelectorAll<HTMLElement>('.pvp-deck-shuffle').forEach(el => {
      el.classList.remove('pvp-deck-shuffle');
      el.style.removeProperty('--pvp-shuffle-duration');
    });
    document.querySelectorAll<HTMLElement>('.pvp-xyz-detach').forEach(el => {
      el.classList.remove('pvp-xyz-detach');
      el.style.removeProperty('--pvp-detach-duration');
    });
  }

  onStateSync(): void {
    this.resetAllState();
  }

  // ---------------------------------------------------------------------------
  // Queue processing (Phase 6: while-loop + directive handling)
  // ---------------------------------------------------------------------------

  /**
   * Entry point — guards against re-entry from multiple callers
   * (interruptPoll, await-signal effect, startProcessingIfIdle).
   */
  private processAnimationQueue(): void {
    if (this._isProcessing || !this._isAnimating()) return;
    this._isProcessing = true;
    this._processAnimationQueueInner().finally(() => {
      this._isProcessing = false;
      const queueLen = this.dataSource.animationQueue().length;
      if (queueLen === 0) return;
      // Skip rescue when the inner loop paused on a legitimate wait — the
      // overlay-ready effect (isWaitingForOverlay) and draws-complete
      // callback (hasDrawsInFlight) own the resume. A rescue here retriggers
      // the inner loop's early return in a tight microtask loop, starving
      // the setTimeout-based animations that would clear the wait.
      if (this.chainManager.isWaitingForOverlay || this.drawManager.hasDrawsInFlight) return;
      // Rescue cases for a stalled queue:
      //  (a) setAnimating(false) in the inner loop synchronously triggered
      //      advanceStep → feedTransition → enqueue. The effect that calls
      //      startProcessingIfIdle can fire before this finally block, sees
      //      _isProcessing=true and bails — so we re-enter here.
      //  (b) An 'async'-returning event handler whose awaited work resolved
      //      synchronously (e.g. MSG_CONFIRM_CARDS for a non-HAND card, where
      //      confirmCardsInHand's loop bodies all `continue`) called
      //      resumeQueueIfSafe() → processAnimationQueue() while _isProcessing
      //      was still true (microtask race). That call was a silent no-op
      //      and nothing else will relaunch the queue — rescue here.
      this.trace('postFinalize', { action: 'rescued-stall', queueLen });
      if (this._isAnimating()) this.processAnimationQueue();
      else this.startProcessingIfIdle();
    });
  }

  private async _processAnimationQueueInner(): Promise<void> {
    while (this._isAnimating()) {
      if (this.chainManager.isWaitingForOverlay || this.drawManager.hasDrawsInFlight) return;
      const queue = this.dataSource.animationQueue();
      this.logger.log(DuelLogCategory.QUEUE, 'processAnimationQueue — queueLen=%d ownPlayer=%d',
        queue.length, this.ctx.ownPlayerIndex());

      // Queue collapse (AC7): only trigger when ALL queued entries can be
      // applied instantly without data loss. Visual events (MSG_MOVE,
      // MSG_DRAW, MSG_CONFIRM_CARDS, MSG_FLIP_SUMMONING, MSG_SET, MSG_SHUFFLE_*,
      // etc.) are NOT handled by applyInstantAnimation — collapsing them would
      // silently drop the animation and the card would snap to destination via
      // the next commitUnlocked(). So we limit collapse to LP-class bursts.
      if (queue.length > QUEUE_COLLAPSE_THRESHOLD && queue.every(e =>
        !('kind' in e) && (e.type === 'MSG_DAMAGE' || e.type === 'MSG_PAY_LPCOST' || e.type === 'MSG_RECOVER')
      )) {
        const collapseCount = queue.length - QUEUE_COLLAPSE_KEEP;
        for (let i = 0; i < collapseCount; i++) {
          const entry = this.dataSource.dequeueAnimation();
          if (entry && !('kind' in entry)) this.applyInstantAnimation(entry);
        }
      }

      this.moveRouter.preLockQueuedSources();

      const entry = this.chainManager.consumeDeferredSolving() ?? this.dataSource.dequeueAnimation();
      if (!entry) {
        // Mid-chain pre-replay: board events were buffered during chain resolution but a prompt
        // is already waiting. Replay them now so the player sees the animations before answering.
        if (this.chainManager.isResolving
          && this.chainManager.hasBufferedEvents
          && this.dataSource.pendingPrompt() !== null) {
          await this.replayBuffer(true);
          continue; // re-enter loop — directives prepended, while loop dequeues them
        }

        // During an active chain resolution, poll with exponential back-off
        // instead of stopping — but ONLY if we are genuinely waiting for more
        // events from the server (PvP) or the overlay (post-CHAIN_SOLVED).
        //
        // In replay, CHAIN_SOLVING may arrive alone in a step (CHAIN_SOLVED is
        // in the next step). No WS events will come — only advanceStep() can
        // feed the queue, and it requires setAnimating(false). Polling here
        // would deadlock. The isWaitingForOverlay check catches post-SOLVED
        // waits; without it, we finalize and let advanceStep resume the chain.
        if (this.commitMode === 'deferred' && this.chainManager.isWaitingForOverlay) {
          this._pollCount++;
          if (this._pollCount > CHAIN_POLL_CEILING) {
            this.trace('queueEmpty', { action: 'pollCeiling', count: this._pollCount });
            this.logger.warn('Chain poll ceiling reached (%d) — forcing finalize. '
              + 'This likely indicates a lost chain event (MSG_CHAIN_END never arrived).', this._pollCount);
            this._pollCount = 0;
            this._pollDelay = CHAIN_POLL_BASE_DELAY_MS;
            // Reset chain state so finalize path runs cleanly (commitMode → per-event)
            this.chainManager.reset();
            // Fall through to normal finalize path below
          } else {
            this._pollDelay = Math.min(this._pollDelay * 2, CHAIN_POLL_MAX_DELAY_MS);
            this.trace('queueEmpty', { action: 'poll', delay: this._pollDelay, count: this._pollCount });
            this._pollTimeout = setTimeout(() => {
              this._pollTimeout = null;
              this.processAnimationQueue();
            }, this._pollDelay);
            return; // _isAnimating stays true — _pollTimeout cleared by clearTimersAndPolling
          }
        }

        // INVARIANT: finalizeAndCommit() MUST run BEFORE setAnimating(false).
        // In replay, setAnimating(false) triggers advanceStep() → updateLogical()
        // with the next state. Committing first ensures we use the current state.
        this.trace('queueEmpty', { action: 'finalize' });
        this.finalizeAndCommit();
        this.drawManager.resetHandAnimationState();
        this.animatingZone.set(null);
        this.lpTracker.animatingLpPlayer.set(null);
        // Clear _isProcessing BEFORE setAnimating(false) — the call may
        // synchronously trigger advanceStep → feedTransition → enqueue,
        // and the queue watcher effect may fire in the same microtask batch.
        // If _isProcessing is still true, startProcessingIfIdle is a no-op
        // and the queue stalls.
        this._isProcessing = false;
        this._isAnimating.set(false);
        this.dataSource.setAnimating(false);
        const postFinalizeQueue = this.dataSource.animationQueue().length;
        if (postFinalizeQueue > 0) {
          this.trace('postFinalize', { queueLen: postFinalizeQueue });
          this._isAnimating.set(true);
          this.dataSource.setAnimating(true);
          this._isProcessing = true; // re-acquired for the continue
          continue; // re-enter loop
        }
        const state = this.rbs.logicalState();
        if (state.players.length === 2) {
          this.lpTracker.syncFromBoardState(state.players[0].lp, state.players[1].lp);
        }
        return;
      }

      this._pollDelay = CHAIN_POLL_BASE_DELAY_MS; // reset back-off on successful dequeue
      this._pollCount = 0;

      // --- Directive handling ---
      if ('kind' in entry) {
        const action = await this.processDirective(entry);
        if (action === 'pause') return; // queue paused — external trigger resumes it
        continue;
      }

      // --- Normal GameEvent processing ---
      const event = entry as GameEvent;
      const result = this.processEvent(event);
      const resultLabel = result instanceof Promise ? 'Promise' : result === 'async' ? 'async' : `${result}ms`;
      this.trace('processEvent', { type: event.type, result: resultLabel });

      // Release pre-locks after processing — animated branches consume them
      // in buildMoveContext (MSG_MOVE) so this is a no-op; for non-animated
      // (result === 0) or async events (MSG_DRAW) it cleans up orphans.
      //
      // EXCEPTION: when `chainManager.isResolving`, board-changing events are
      // buffered by `bufferIfResolving()` and replayed later as a group
      // directive. Releasing pre-locks here would drop HAND/GY ref-counts to
      // zero, fire commitZone() synchronously, and expose the buffered cards
      // at their destination before the replay animates them — the classic
      // "tutor cards appear in hand before travel" flash. Keep the pre-locks
      // alive; `replayBuffer()` will reuse them via its own preLockQueuedSources
      // pass (the `!has` guard prevents duplication), and MSG_CHAIN_END's
      // `releaseAllPreLocks()` is the safety net for any orphans.
      const buffered = this.chainManager.isResolving
        && ChainResolutionManager.BOARD_CHANGING_EVENTS.has(event.type);
      if (!buffered) {
        if (event.type === 'MSG_MOVE') {
          const msg = event as MoveMsg;
          const relPlayer = this.ctx.relativePlayer(msg.player);
          const srcKey = locationToZoneKey(msg.fromLocation, msg.fromSequence, relPlayer);
          const dstKey = locationToZoneKey(msg.toLocation, msg.toSequence, relPlayer);
          const keys = new Set<string>();
          if (srcKey) keys.add(srcKey);
          if (dstKey) keys.add(dstKey);
          if (keys.size) this.moveRouter.releasePreLocksForKeys(keys);
        } else if (event.type === 'MSG_DRAW') {
          const relPlayer = this.ctx.relativePlayer((event as DrawMsg).player);
          this.moveRouter.releasePreLocksForKeys(new Set([`HAND-${relPlayer}`]));
        }
      }

      if (this.commitMode === 'per-event') {
        this.moveRouter.preLockQueuedSources();
        this.lpTracker.clearPending();
        this.trace('commitUnlocked', { event: event.type });
        this.rbs.commitUnlocked();
      }

      if (result === 'async') {
        this.trace('asyncReturn', { type: event.type, reason: 'draw/overlay' });
        return;
      }

      if (result instanceof Promise) {
        this.trace('promiseReturn', { type: event.type, reason: 'travel' });
        const guard = new Promise<void>(resolve => {
          setTimeout(() => {
            this.logger.warn('Travel promise never resolved for %s — forcing queue continue', event.type);
            resolve();
          }, LOCK_SAFETY_TIMEOUT_MS);
        });
        await Promise.race([result, guard]);
        this.lpTracker.commitPendingLp();
        this.animatingZone.set(null);
        this.lpTracker.animatingLpPlayer.set(null);
        continue;
      }

      const speedMultiplier = this.ctx.speedMultiplier();
      const adjustedDuration = Math.round(result * speedMultiplier);
      this.logger.log(DuelLogCategory.QUEUE, 'type=%s → setTimeout(%dms)', event.type, adjustedDuration);

      if (adjustedDuration > 0) {
        await new Promise<void>(resolve => {
          const timeout = setTimeout(() => {
            const idx = this.animationTimeouts.indexOf(timeout);
            if (idx !== -1) this.animationTimeouts.splice(idx, 1);
            resolve();
          }, adjustedDuration);
          this.animationTimeouts.push(timeout);
        });
      }

      this.lpTracker.commitPendingLp();
      this.animatingZone.set(null);
      this.lpTracker.animatingLpPlayer.set(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Directive dispatch (extracted from queue loop for readability)
  // ---------------------------------------------------------------------------

  /**
   * Process a single queue directive. Returns 'pause' if the queue must wait
   * for an external trigger (await-signal), 'continue' otherwise.
   */
  private async processDirective(entry: QueueDirective): Promise<'continue' | 'pause'> {
    switch (entry.kind) {
      case 'group': {
        this.trace('directive', { kind: 'group', count: entry.events.length, staggerMs: entry.staggerMs });
        const promises: Promise<void>[] = [];
        for (let i = 0; i < entry.events.length; i++) {
          if (i > 0 && entry.staggerMs) {
            await new Promise<void>(r => setTimeout(r, entry.staggerMs));
          }
          const result = this.processEvent(entry.events[i]);
          const rlabel = result instanceof Promise ? 'Promise' : result === 'async' ? 'async' : `${result}`;
          this.trace('groupEvent', { type: entry.events[i].type, result: rlabel, idx: i });
          if (result instanceof Promise) promises.push(result);
          else if (result === 'async' && isDevMode()) {
            console.warn('[GROUP] Event %s returned async — a barrier MUST follow this group', entry.events[i].type);
          }
        }
        if (this.commitMode === 'per-event') {
          this.moveRouter.preLockQueuedSources();
          this.lpTracker.clearPending();
          this.rbs.commitUnlocked();
        }
        this.trace('groupAwait', { promiseCount: promises.length, inFlight: this.cardTravelService.inFlightCount(), landed: this.cardTravelService.landedCount() });
        if (promises.length > 0) await Promise.all(promises);
        this.trace('groupDone', { inFlight: this.cardTravelService.inFlightCount(), landed: this.cardTravelService.landedCount() });
        this.animatingZone.set(null);
        this.lpTracker.animatingLpPlayer.set(null);
        return 'continue';
      }
      case 'barrier':
        this.trace('directive', { kind: 'barrier' });
        await this.drawManager.awaitDrawsComplete();
        this.rbs.commitUnlocked();
        return 'continue';
      case 'lp':
        this.trace('directive', { kind: 'lp' });
        this.lpTracker.fireLpReplayEvent(entry.event);
        return 'continue';
      case 'batch-end':
        this.trace('directive', { kind: 'batch-end' });
        entry.resolve();
        return 'continue';
      case 'await-signal': {
        this.trace('directive', { kind: 'await-signal', resolved: entry.signal() });
        if (entry.signal()) return 'continue';
        // Pause queue until signal becomes true.
        this._awaitSignalEffect = effect(() => {
          if (entry.signal()) {
            this._awaitSignalEffect?.destroy();
            this._awaitSignalEffect = null;
            this.processAnimationQueue(); // re-entry guarded by _isProcessing (now false from finally)
          }
        }, { injector: this.injector });
        return 'pause';
      }
      default:
        this.logger.warn('Unknown directive kind: %o', entry);
        return 'continue';
    }
  }

  // ---------------------------------------------------------------------------
  // Event dispatch
  // ---------------------------------------------------------------------------

  private processEvent(event: GameEvent): number | 'async' | Promise<void> {
    // Buffer board-changing events during chain resolution
    if (this.chainManager.bufferIfResolving(event)) {
      const moveInfo = event.type === 'MSG_MOVE' ? ` card=${(event as MoveMsg).cardCode} reason=${(event as MoveMsg).reason}` : '';
      this.logger.log(DuelLogCategory.CHAIN, 'Buffering %s during chain resolution%s', event.type, moveInfo);
      return 0;
    }

    // Progressive logical-state sync for replay: when the precompute attached a
    // `boardStateAfter` snapshot (BOARD_CHANGING events captured during
    // `chainPhase === 'resolving'`), update logical BEFORE the animation runs.
    // The rendered zones stay protected by active locks (session HAND lock,
    // per-event dstLock); the snapshot simply shifts what `commitZone` will
    // show when the last lock releases. PvP events never carry this field.
    const boardStateAfter = (event as GameEvent & { boardStateAfter?: DuelState }).boardStateAfter;
    if (boardStateAfter) this.rbs.updateLogical(boardStateAfter);

    switch (event.type) {
      case 'MSG_MOVE':
        return this.moveRouter.processMoveEvent(event as MoveMsg);
      case 'MSG_DAMAGE':
        return this.lpTracker.processLpEvent((event as DamageMsg).player, (event as DamageMsg).amount, 'damage');
      case 'MSG_RECOVER':
        return this.lpTracker.processLpEvent((event as RecoverMsg).player, (event as RecoverMsg).amount, 'recover');
      case 'MSG_PAY_LPCOST':
        return this.lpTracker.processLpEvent((event as PayLpCostMsg).player, (event as PayLpCostMsg).amount, 'damage');
      case 'MSG_FLIP_SUMMONING': {
        const msg = event as FlipSummoningMsg;
        const zoneId = locationToZoneId(msg.location, msg.sequence);
        if (zoneId) {
          this.setAnimatingZone(zoneId, 'flip', msg.player);
          this.ctx.announceEvent('Card flip summoned', msg.player);
        }
        return 300;
      }
      case 'MSG_CHANGE_POS': {
        const msg = event as ChangePosMsg;
        const wasFaceDown = (msg.previousPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
        const nowFaceUp = (msg.currentPosition & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
        if (wasFaceDown && nowFaceUp) {
          const zoneId = locationToZoneId(msg.location, msg.sequence);
          if (zoneId) this.setAnimatingZone(zoneId, 'flip', msg.player);
          return 300;
        }
        if (!wasFaceDown && nowFaceUp) {
          return this.processPositionRotation(msg);
        }
        return 0;
      }
      case 'MSG_CHAINING': {
        const msg = event as ChainingMsg;
        const relPlayer = this.ctx.relativePlayer(msg.player);
        const holdMs = this.ctx.scaledDuration(500, 250);
        const zoneId = locationToZoneId(msg.location, msg.sequence);
        if (zoneId) {
          this.setAnimatingZone(zoneId, 'activate', msg.player);
          const zoneKey = locationToZoneKey(msg.location, msg.sequence, relPlayer);
          if (zoneKey) return this.cardTravelService.activateEffect(zoneKey, this.ctx.scaledDuration(500, 250))
            .then(() => new Promise<void>(r => setTimeout(r, holdMs)));
        }
        if (msg.location === LOCATION.HAND) {
          const handEl = this.drawManager.resolveHandTarget(`HAND-${relPlayer}`, msg.sequence);
          if (handEl instanceof HTMLElement) {
            handEl.style.zIndex = '500';
            return this.cardTravelService.activateEffect(handEl, this.ctx.scaledDuration(500, 250))
              .then(() => { handEl.style.zIndex = ''; })
              .then(() => new Promise<void>(r => setTimeout(r, holdMs)));
          }
        }
        return 400;
      }
      case 'MSG_CHAIN_SOLVING': {
        const msg = event as ChainSolvingMsg;
        const result = this.chainManager.handleSolving(event);
        if (result.deferred) {
          const pauseMs = this.ctx.scaledDuration(1000);
          const tid = this.chainManager.scheduleBannerAnnounce(pauseMs);
          this.animationTimeouts.push(tid);
          return 3000;
        }
        this.dataSource.applyChainSolving(msg.chainIndex);
        const exitDelay = this.chainManager.chainSolvedCount > 0 ? this.chainExitDuration() : 0;
        return result.isSingleLink ? 0 : exitDelay + this.chainPulseDuration() + this.ctx.scaledDuration(300);
      }
      case 'MSG_CHAIN_SOLVED': {
        const msg = event as ChainSolvedMsg;
        this.dataSource.applyChainSolved(msg.chainIndex);
        return this.chainManager.handleSolved(event);
      }
      case 'MSG_CHAIN_END':
        this.dataSource.applyChainEnd();
        this.chainManager.handleEnd();
        this.moveRouter.releaseAllPreLocks();
        this.drawManager.clearDrawsCompleteCallback();
        this.confirmRevealedCards.set(new Map());
        return 100;
      case 'MSG_DRAW':
        return this.drawManager.processDrawEvent(event as DrawMsg);
      case 'MSG_SHUFFLE_HAND':
        return this.drawManager.processShuffleEvent(event as ShuffleHandMsg);
      case 'MSG_CONFIRM_CARDS':
        return this.drawManager.processConfirmCardsEvent(event as ConfirmCardsMsg);
      case 'MSG_SHUFFLE_DECK':
        return this.processShuffleDeckEvent(event as ShuffleDeckMsg);
      case 'MSG_SET':
        return 0; // No animation — position change handled by BOARD_STATE
      case 'MSG_BECOME_TARGET': {
        const msg = event as BecomeTargetMsg;
        const ownIdx = this.ctx.ownPlayerIndex();
        const keys = new Set(msg.cards.map(c => {
          const relPlayer = c.player === ownIdx ? 0 : 1;
          return locationToZoneKey(c.location, c.sequence, relPlayer);
        }));
        this.targetedZoneKeys.set(keys);
        const tid = setTimeout(() => this.targetedZoneKeys.set(new Set()), 800 * this.ctx.speedMultiplier());
        this.animationTimeouts.push(tid);
        return 800;
      }
      case 'MSG_SWAP':
        return this.processSwapEvent(event as SwapMsg);
      case 'MSG_ATTACK':
        return this.battleTracker.processAttackEvent(event as AttackMsg);
      case 'MSG_BATTLE':
        return this.battleTracker.processBattleEvent(event as BattleMsg);
      case 'MSG_TOSS_COIN': {
        if (this.ctx.reducedMotion()) return 0;
        const msg = event as TossCoinMsg;
        const lines = msg.results.map(r => r ? 'Heads ✓' : 'Tails ✗');
        this.toastService.show({ icon: '🪙', lines }, 1200 * this.ctx.speedMultiplier());
        this.ctx.announceEvent(`Coin toss: ${lines.join(', ')}`, msg.player);
        return 1200;
      }
      case 'MSG_TOSS_DICE': {
        if (this.ctx.reducedMotion()) return 0;
        const msg = event as TossDiceMsg;
        const lines = msg.results.map((v, i) => `Die ${i + 1}: ${v}`);
        this.toastService.show({ icon: '🎲', lines }, 1200 * this.ctx.speedMultiplier());
        this.ctx.announceEvent(`Dice roll: ${msg.results.join(', ')}`, msg.player);
        return 1200;
      }
      case 'MSG_EQUIP': {
        if (this.ctx.reducedMotion()) return 0;
        const msg = event as EquipMsg;
        const relEquip = this.ctx.relativePlayer(msg.equipPlayer);
        const relTarget = this.ctx.relativePlayer(msg.targetPlayer);
        const equipKey = locationToZoneKey(msg.equipLocation, msg.equipSequence, relEquip);
        const targetKey = locationToZoneKey(msg.targetLocation, msg.targetSequence, relTarget);
        const equipEl = this.cardTravelService.getZoneElement(equipKey);
        const targetEl = this.cardTravelService.getZoneElement(targetKey);
        const lineEl = this.cardTravelService.createLineBetween(equipEl, targetEl, {
          color: EQUIP_LINE_COLOR, shadow: EQUIP_LINE_SHADOW,
        });
        if (!lineEl) return 0;
        this.activeEquipLines.push(lineEl);
        const duration = this.ctx.scaledDuration(500, 250);
        lineEl.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], {
          duration: duration * 0.4, easing: 'ease-out', fill: 'forwards',
        });
        return new Promise<void>(resolve => {
          this.scheduleTimeout(() => {
            const idx = this.activeEquipLines.indexOf(lineEl);
            if (idx !== -1) this.activeEquipLines.splice(idx, 1);
            lineEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.3, easing: 'ease-in' })
              .finished.then(() => lineEl.remove()).catch(() => lineEl.remove());
            resolve();
          }, duration * 0.7);
        });
      }
      case 'MSG_ADD_COUNTER':
      case 'MSG_REMOVE_COUNTER': {
        if (this.ctx.reducedMotion()) return 0;
        const msg = event as AddCounterMsg | RemoveCounterMsg;
        const rel = this.ctx.relativePlayer(msg.player);
        const key = locationToZoneKey(msg.location, msg.sequence, rel);
        // Force signal change even for consecutive events on the same zone,
        // so Angular re-evaluates the class binding and the CSS animation restarts.
        this.counterPulseKey.set(null);
        this.counterPulseKey.set(key);
        this.scheduleTimeout(() => this.counterPulseKey.set(null), 400 * this.ctx.speedMultiplier());
        return 400;
      }
      case 'MSG_SHUFFLE_SET_CARD': {
        if (this.ctx.reducedMotion()) return 0;
        const msg = event as ShuffleSetCardMsg;
        const duration = this.ctx.scaledDuration(400, 200);
        const locks: { commit: () => void; release: () => void }[] = [];
        const travels: Promise<void>[] = [];
        for (const c of msg.cards) {
          const relFrom = this.ctx.relativePlayer(c.fromPlayer);
          const relTo = this.ctx.relativePlayer(c.toPlayer);
          const fromKey = locationToZoneKey(c.location, c.fromSequence, relFrom);
          const toKey = locationToZoneKey(c.location, c.toSequence, relTo);
          locks.push(this.rbs.lockZone(fromKey));
          if (fromKey !== toKey) locks.push(this.rbs.lockZone(toKey));
          travels.push(this.cardTravelService.travel(fromKey, toKey, '', { duration, showBack: true }));
        }
        return Promise.all(travels).then(
          () => locks.forEach(l => l.commit()),
          () => locks.forEach(l => l.release()),
        );
      }
      case 'MSG_SWAP_GRAVE_DECK':
        return this.processSwapGraveDeckEvent(event as SwapGraveDeckMsg);
      default:
        return 0;
    }
  }

  private processSwapEvent(msg: SwapMsg): Promise<void> | 0 {
    if (this.ctx.reducedMotion()) return 0;
    const rel1 = this.ctx.relativePlayer(msg.card1.player);
    const rel2 = this.ctx.relativePlayer(msg.card2.player);
    const key1 = locationToZoneKey(msg.card1.location, msg.card1.sequence, rel1);
    const key2 = locationToZoneKey(msg.card2.location, msg.card2.sequence, rel2);
    const img1 = this.cardTravelService.toAbsoluteUrl(getCardImageUrlByCode(msg.card1.cardCode));
    const img2 = this.cardTravelService.toAbsoluteUrl(getCardImageUrlByCode(msg.card2.cardCode));
    const duration = this.ctx.scaledDuration(400, 200);

    const lock1 = this.rbs.lockZone(key1);
    const lock2 = this.rbs.lockZone(key2);
    return Promise.all([
      this.cardTravelService.travel(key1, key2, img1, { duration, impactGlowColor: 'rgba(180,180,220,0.5)' }),
      this.cardTravelService.travel(key2, key1, img2, { duration, impactGlowColor: 'rgba(180,180,220,0.5)' }),
    ]).then(() => {
      lock1.commit();
      lock2.commit();
    }, () => {
      lock1.release();
      lock2.release();
    });
  }

  private processSwapGraveDeckEvent(msg: SwapGraveDeckMsg): Promise<void> | 0 {
    if (this.ctx.reducedMotion()) return 0;
    const rel = this.ctx.relativePlayer(msg.player);
    const gyKey = `GY-${rel}`;
    const deckKey = `DECK-${rel}`;

    // Phase 1: glow pulse on both zones (force signal change for consecutive events)
    this.swapGraveDeckKeys.set(new Set());
    this.swapGraveDeckKeys.set(new Set([gyKey, deckKey]));

    const glowMs = this.ctx.scaledDuration(300, 150);
    const travelMs = this.ctx.scaledDuration(400, 200);

    const lockGy = this.rbs.lockZone(gyKey);
    const lockDeck = this.rbs.lockZone(deckKey);

    return new Promise<void>(resolve => {
      this.scheduleTimeout(() => {
        this.swapGraveDeckKeys.set(new Set());
        // Phase 2: single travel DECK→GY (card back) — GY update implied by commit
        this.cardTravelService.travel(deckKey, gyKey, '', { duration: travelMs, showBack: true }).then(
          () => { lockGy.commit(); lockDeck.commit(); resolve(); },
          () => { lockGy.release(); lockDeck.release(); resolve(); },
        );
      }, glowMs);
    });
  }

  private processShuffleDeckEvent(msg: ShuffleDeckMsg): number {
    if (this.ctx.reducedMotion()) return 0;
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const deckKey = `DECK-${relPlayer}`;
    const deckZone = this.cardTravelService.getZoneElement(deckKey);
    const pile = deckZone?.querySelector<HTMLElement>('.zone-pile');
    if (!pile) return 0;

    const duration = this.ctx.scaledDuration(500, 250);
    pile.style.setProperty('--pvp-shuffle-duration', `${duration}ms`);
    pile.classList.add('pvp-deck-shuffle');

    const tid = setTimeout(() => {
      pile.classList.remove('pvp-deck-shuffle');
      pile.style.removeProperty('--pvp-shuffle-duration');
    }, duration);
    this.animationTimeouts.push(tid);

    return duration;
  }

  private processPositionRotation(msg: ChangePosMsg): Promise<void> | 0 {
    if (this.ctx.reducedMotion()) return 0;
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const zoneId = locationToZoneId(msg.location, msg.sequence);
    if (!zoneId) return 0;
    const zoneKey = `${zoneId}-${relPlayer}`;
    const zoneEl = this.cardTravelService.getZoneElement(zoneKey);
    const cardEl = zoneEl?.querySelector<HTMLElement>('.zone-card');
    if (!cardEl) return 0;

    const fromRotation = this.extractRotationDeg(getComputedStyle(cardEl).transform);

    const nowDefense = (msg.currentPosition & (POSITION.FACEUP_DEFENSE | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const toRotation = this.ctx.zoneCardRotation(relPlayer, nowDefense);
    const duration = this.ctx.scaledDuration(300, 150);

    const lock = this.rbs.lockZone(zoneKey);
    const anim = cardEl.animate(
      [{ transform: `rotate(${fromRotation}deg)` }, { transform: `rotate(${toRotation}deg)` }],
      { duration, easing: 'ease-in-out', fill: 'forwards' },
    );
    return anim.finished.then(() => {
      lock.commit();
      anim.cancel();
    }).catch(() => {
      lock.release();
    });
  }

  /** Extract rotation angle (degrees) from a CSS computed transform matrix. */
  private extractRotationDeg(transform: string): number {
    if (!transform || transform === 'none') return 0;
    // matrix(a, b, c, d, tx, ty) → angle = atan2(b, a)
    const match = transform.match(/matrix\(([^,]+),\s*([^,]+)/);
    if (!match) return 0;
    const a = parseFloat(match[1]);
    const b = parseFloat(match[2]);
    return Math.atan2(b, a) * (180 / Math.PI);
  }

  // ---------------------------------------------------------------------------
  // Instant animation (queue collapse)
  // ---------------------------------------------------------------------------

  private applyInstantAnimation(event: GameEvent): void {
    if (event.type === 'MSG_DAMAGE' || event.type === 'MSG_PAY_LPCOST'
      || event.type === 'MSG_RECOVER') {
      this.lpTracker.applyInstant(event);
    } else if (event.type === 'MSG_CHAIN_SOLVING') {
      this.dataSource.applyChainSolving((event as ChainSolvingMsg).chainIndex);
      this.chainManager.applyInstantSolving();
    } else if (event.type === 'MSG_CHAIN_SOLVED') {
      this.dataSource.applyChainSolved((event as ChainSolvedMsg).chainIndex);
      this.chainManager.applyInstantSolved();
    } else if (event.type === 'MSG_CHAIN_END') {
      this.dataSource.applyChainEnd();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private setAnimatingZone(
    zoneId: string,
    animationType: 'flip' | 'activate',
    absolutePlayer: number,
  ): void {
    const relativePlayerIndex = this.ctx.relativePlayer(absolutePlayer);
    this.animatingZone.set({ zoneId, animationType, relativePlayerIndex });
  }

  private trace(action: string, detail?: Record<string, unknown>): void {
    this.logger.log(DuelLogCategory.QUEUE,
      '[ANIM-TRACE] %s | mode=%s locks=[%s] queue=%d chainPhase=%s %o',
      action, this.commitMode,
      this.rbs.lockedZoneKeys().join(','),
      this.dataSource.animationQueue().length,
      this.dataSource.chainPhase(),
      detail ?? {});
  }

}
