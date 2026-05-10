import { effect, type EffectRef, inject, Injectable, Injector, isDevMode, signal } from '@angular/core';
import type { DuelState, GameEvent } from '../types';
import type { MoveMsg, DrawMsg, DamageMsg, RecoverMsg, PayLpCostMsg, FlipSummoningMsg, ChangePosMsg, ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ShuffleHandMsg, ConfirmCardsMsg, ShuffleDeckMsg, BecomeTargetMsg, SwapMsg, AttackMsg, BattleMsg, TossCoinMsg, TossDiceMsg, EquipMsg, AddCounterMsg, RemoveCounterMsg, ShuffleSetCardMsg, SwapGraveDeckMsg } from '../duel-ws.types';
import { BOARD_CHANGING_EVENT_TYPES, LOCATION, POSITION } from '../duel-ws.types';
import { DuelCardArtService } from './duel-card-art.service';
import { locationToZoneId, locationToZoneKey } from '../pvp-zone.utils';
import { ANIMATION_DATA_SOURCE, type QueueDirective, type QueueEntry } from './animation-data-source';
import {
  LOCK_SAFETY_TIMEOUT_MS, QUEUE_COLLAPSE_KEEP, QUEUE_COLLAPSE_THRESHOLD,
  REPLAY_BUFFER_SAFETY_TIMEOUT_MS,
  POLL_DROP_REGRESSION_WATCHDOG_MS,
  POSITION_FLIP_MS, BECOME_TARGET_PULSE_MS, TARGET_PILE_FLOAT_STAGGER_MS, TARGET_PILE_FLOAT_FADE_OUT_MS,
  CHAIN_ACTIVATE_MS, CHAIN_ACTIVATE_MIN_MS, CHAIN_ACTIVATE_FALLBACK_MS,
  CHAIN_BANNER_PAUSE_MS, CHAIN_BANNER_DEFERRED_BUDGET_MS,
  CHAIN_END_SETTLE_MS, CHAIN_SOLVING_TAIL_MS,
  TOSS_TOAST_MS, COUNTER_PULSE_MS,
  SHUFFLE_SET_CARD_TRAVEL_MS, SHUFFLE_SET_CARD_TRAVEL_MIN_MS,
  SWAP_TRAVEL_MS, SWAP_TRAVEL_MIN_MS,
  SWAP_GRAVE_DECK_GLOW_MS, SWAP_GRAVE_DECK_GLOW_MIN_MS,
  SWAP_GRAVE_DECK_TRAVEL_MS, SWAP_GRAVE_DECK_TRAVEL_MIN_MS,
  SHUFFLE_DECK_MS, SHUFFLE_DECK_MIN_MS,
  POSITION_ROTATE_MS, POSITION_ROTATE_MIN_MS,
  CHAIN_PULSE_BASE_MS,
} from './animation-constants';
import { CardTravelEngine } from './card-travel-engine.service';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DrawSequenceManager } from './draw-sequence-manager';
import { BattleAnimationTracker } from './battle-animation-tracker';
import { BufferReplayBuilder } from './buffer-replay-builder';
import { DuelContext } from './duel-context';
import { DuelLogCategory, DuelLogger } from './duel-logger';
import { LpAnimationTracker } from './lp-animation-tracker';
import { MoveAnimationRouter } from './move-animation-router';
import { TargetIndicatorManager } from './target-indicator-manager';
import { DuelToastService } from './duel-toast.service';
import { EQUIP_LINE_COLOR, EQUIP_LINE_SHADOW } from './equip-line.constants';
import { duelAssert } from '../../../core/utilities/duel-assert';

/**
 * Discrete actions returned by `AnimationOrchestratorService.decideNextStep`.
 * Drives the dispatcher inside `_processAnimationQueueInner`.
 *
 * NOTE: 'poll' / 'poll-ceiling-reset' actions were removed in 2026-05-10
 * (Phase 2 of pvp-replay-2026-05-08 audit closure). Investigation found
 * the poll branch UNREACHABLE since 2026-04-06 because the wait gate
 * (priority 1) returned first whenever the poll predicate matched. All
 * legitimate wait paths are now event-driven (WS message, advanceStep,
 * resume effect on chainOverlayReady). A POLL-DROP REGRESSION watchdog
 * fires if a finalize-during-resolving stalls — see CLAUDE.md.
 */
export type QueueStep =
  | { action: 'pause-external' }
  | { action: 'collapse'; collapseCount: number }
  | { action: 'consume-deferred'; entry: GameEvent }
  | { action: 'dequeue'; entry: QueueEntry }
  | { action: 'pre-replay-buffer' }
  | { action: 'finalize' };

/**
 * Snapshot of inputs consumed by the pure `decideNextStep` function.
 * The dispatcher reads signals + internal state once per tick and passes
 * them as plain values; tests construct the object directly.
 */
export interface QueueDecisionInputs {
  isWaitingForOverlay: boolean;
  hasDrawsInFlight: boolean;
  queue: readonly QueueEntry[];
  isResolving: boolean;
  hasBufferedEvents: boolean;
  hasPendingPrompt: boolean;
  commitMode: 'per-event' | 'deferred';
  deferredSolvingEntry: GameEvent | null;
}

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
  private readonly cardTravelEngine = inject(CardTravelEngine);
  private readonly boardEffects = inject(BoardEffectsService);
  private readonly floatRegistry = inject(FloatRegistryService);
  private readonly ctx = inject(DuelContext);
  readonly chainManager = inject(ChainResolutionManager);
  readonly drawManager = inject(DrawSequenceManager);
  readonly moveRouter = inject(MoveAnimationRouter);
  private readonly battleTracker = inject(BattleAnimationTracker);
  private readonly targetIndicator = inject(TargetIndicatorManager);
  private readonly toastService = inject(DuelToastService);
  private readonly artService = inject(DuelCardArtService);
  private readonly bufferReplayBuilder = inject(BufferReplayBuilder);

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
    return Math.round(CHAIN_PULSE_BASE_MS * this.ctx.speedMultiplier());
  }

  /** Single source of truth for the chain exit animation duration (ms). */
  chainExitDuration(): number {
    return Math.round(CHAIN_PULSE_BASE_MS * this.ctx.speedMultiplier());
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
  /**
   * POLL-DROP REGRESSION watchdog. Armed when the dispatcher finalizes
   * the queue while `chainPhase === 'resolving'` — i.e. the dropped poll
   * mechanism would have been engaged. If no chain event re-wakes the
   * queue within POLL_DROP_REGRESSION_WATCHDOG_MS, fires a high-visibility
   * `logger.error` (grep marker: 'POLL-DROP REGRESSION') + duelAssert in
   * dev. Cleared on chainManager.reset(), startProcessingIfIdle, and
   * destroy. See CLAUDE.md "Polling Removal — Regression Surface".
   */
  private _pollDropWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** Re-entry guard for processAnimationQueue (prevents double-dequeue). */
  private _isProcessing = false;
  /** Detects parallel re-entry into _processAnimationQueueInner (audit finding C4).
   *  Always 0 or 1 in normal operation. >1 means a second async loop started before
   *  the first finished — would dequeue events out of order. duelAssert fires in dev,
   *  console.error in prod. See PVP-REPLAY-DIVERGENCES.md §2 for the design rationale
   *  of the _isProcessing finalize block (lines ~648-656). */
  private _innerLoopDepth = 0;
  /** Set while inline replayBuffer is dispatching buffered events, so processEvent skips re-buffering. */
  private _isReplayingBuffer = false;
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
    this.floatRegistry.clearAllTravels();
    this.lpTracker.discardPending();
    this.trace('commitUnlocked', { site: 'finalizeAndCommit' });
    this.rbs.commitUnlocked();
  }

  constructor() {
    // Wire FloatRegistry for [LOCK-ASSERT] dev-mode assertion in commitUnlocked().
    this.rbs.attachFloatRegistry(this.floatRegistry);
    // Scale RBS lock safety timeouts with playback speed so slow replay
    // (speedMultiplier < 1) doesn't guard-fire mid-travel, and add the
    // 50% safety margin from DuelContext.safetyTimeout().
    this.rbs.getSafetyTimeoutMs = () => this.ctx.safetyTimeout(LOCK_SAFETY_TIMEOUT_MS);
    // H1 — chain phase observer wiring. ChainResolutionManager.isResolving
    // becomes a pure read of dataSource.chainPhase(); no parallel state to
    // keep in sync.
    this.chainManager.attachChainPhaseSource(() => this.dataSource.chainPhase());
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
    // Any new event arrival means the chain progressed — disarm the
    // POLL-DROP REGRESSION watchdog. Even when _isAnimating is already
    // true (re-entry from another caller), the watchdog might have been
    // armed by an earlier finalize that has since been superseded.
    this.clearPollDropWatchdog();
    if (!this._isAnimating()) {
      this._isAnimating.set(true);
      this.dataSource.setAnimating(true);
      // Pre-lock all animated zones before first commitUnlocked — centralized
      // for both PvP and replay so cards don't appear at their destination
      // before the travel animation plays.
      this.moveRouter.preLockQueuedSources();
      this.processAnimationQueue();
    }
  }

  /**
   * POLL-DROP REGRESSION watchdog — see CLAUDE.md "Polling Removal —
   * Regression Surface" for the full investigation context. Armed at
   * finalize-during-resolving; if it fires the dropped poll mechanism
   * would have rescued the queue, so we surface the regression with a
   * non-missable error log and (in dev) a duelAssert.
   */
  private armPollDropWatchdog(): void {
    this.clearPollDropWatchdog();
    this._pollDropWatchdog = setTimeout(() => {
      this._pollDropWatchdog = null;
      // Re-check state at fire time: if anything has changed (queue
      // re-filled, chain ended), the watchdog is moot.
      const stillResolving = this.dataSource.chainPhase() === 'resolving';
      const queueLen = this.dataSource.animationQueue().length;
      if (!stillResolving || queueLen > 0 || this._isAnimating()) return;
      const links = this.dataSource.activeChainLinks();
      // console.error (NOT logger.error — that doesn't exist) so the
      // marker is unfilterable by debug-category settings.
      console.error(
        '[POLL-DROP REGRESSION] chain stuck after finalize-during-resolving for %dms. '
        + 'activeChainLinks=%o queueLen=%d isWaitingForOverlay=%s hasBufferedEvents=%s. '
        + 'See CLAUDE.md "Polling Removal — Regression Surface" — the dropped poll '
        + 'mechanism would have rescued this state.',
        POLL_DROP_REGRESSION_WATCHDOG_MS,
        links.map(l => ({ idx: l.chainIndex, loc: l.location, seq: l.sequence })),
        queueLen,
        this.chainManager.isWaitingForOverlay,
        this.chainManager.hasBufferedEvents,
      );
      duelAssert(false, 'POLL-DROP-REGRESSION',
        `chain stuck after ${POLL_DROP_REGRESSION_WATCHDOG_MS}ms — see error log above`);
    }, POLL_DROP_REGRESSION_WATCHDOG_MS);
  }

  private clearPollDropWatchdog(): void {
    if (this._pollDropWatchdog !== null) {
      clearTimeout(this._pollDropWatchdog);
      this._pollDropWatchdog = null;
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
   * Pure dispatch policy: drain → fast-path or build → prepend → resolve.
   * All build logic (interleave, session locks, group/barrier directives)
   * lives in `BufferReplayBuilder`.
   */
  replayBuffer(inlineFromLoop = false): Promise<void> {
    const buffer = this.chainManager.drainBuffer();
    this.logger.log(DuelLogCategory.REPLAY, 'replayBuffer — bufferLen=%d ownPlayer=%d', buffer.length, this.ctx.ownPlayerIndex());

    if (buffer.length === 0) return Promise.resolve();

    // Mark drain start: events about to be replayed must NOT re-buffer back
    // into chainManager when they pass through processEvent (mid-chain
    // pre-replay can fire while chainPhase is still 'resolving'). Cleared
    // in batch-end resolve, in the reduced-motion path below, and as a safety
    // net by chainManager.reset().
    this.chainManager.beginDrain();

    if (this.ctx.reducedMotion()) {
      this.bufferReplayBuilder.applyReducedMotion(buffer);
      this.chainManager.endDrain();
      return Promise.resolve();
    }

    const { batch, releaseSessionLocks } = this.bufferReplayBuilder.build(buffer);
    const cleanup = () => { releaseSessionLocks(); this.chainManager.endDrain(); };

    // Inline path: called from mid-chain pre-replay inside _processAnimationQueueInner.
    // Prepend batch directly — the while loop continues and processes directives.
    // No await-signal (overlay not involved), no external processAnimationQueue
    // (would be a no-op since _isProcessing is true — causing a 10s deadlock).
    if (inlineFromLoop) {
      batch.push({ kind: 'batch-end', resolve: cleanup });
      this.trace('batchEnqueue', { bufferLen: buffer.length, directives: batch.filter(e => 'kind' in e).length, inline: true });
      this._isReplayingBuffer = true;
      this.dataSource.prependToQueue(batch);
      this.chainManager.clearWaiting();
      return Promise.resolve();
    }

    // Overlay path: wrap in Promise — resolved by batch-end sentinel.
    // await-signal pauses the queue until overlay re-shows.
    return new Promise<void>(resolve => {
      const safety = setTimeout(() => {
        this.logger.warn('replayBuffer safety timeout — forcing resolve');
        this.chainManager.endDrain();
        resolve();
      }, this.ctx.safetyTimeout(REPLAY_BUFFER_SAFETY_TIMEOUT_MS));
      batch.push({
        kind: 'batch-end', resolve: () => {
          clearTimeout(safety);
          cleanup();
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

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private clearTimersAndPolling(): void {
    this.animationTimeouts.forEach(t => clearTimeout(t));
    this.animationTimeouts = [];
    for (const el of this.activeEquipLines) el.remove();
    this.activeEquipLines = [];
    this.clearPollDropWatchdog();
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
    this.targetIndicator.reset();
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
    // Surface suspicious timing in dev: a STATE_SYNC arriving with an
    // active chain resolution + buffered events indicates a disconnect
    // or server-state divergence mid-resolve. The reset itself recovers
    // safely (clearAllTravels + releaseAllPreLocks), but the race is
    // worth catching early if a real duel triggers it.
    duelAssert(
      !this.chainManager.isResolving || !this.chainManager.hasBufferedEvents,
      'onStateSync',
      `STATE_SYNC arrived mid-chain-resolve with ${this.dataSource.animationQueue().length} queued + buffered events — possible lock orphan`,
    );
    this.resetAllState();
  }

  // ---------------------------------------------------------------------------
  // Queue processing (Phase 6: while-loop + directive handling)
  // ---------------------------------------------------------------------------

  /**
   * Pure decision step for the queue loop. Given a snapshot of inputs,
   * returns the next action to take. No side effects, no signal reads,
   * no mutations — entirely testable in isolation.
   *
   * The dispatcher in _processAnimationQueueInner owns side effects
   * (dequeue, trace, setTimeout, await processEvent, etc.) and is
   * driven by the action returned here.
   */
  static decideNextStep(input: QueueDecisionInputs): QueueStep {
    // 1. External wait (overlay ready / draws in flight)
    if (input.isWaitingForOverlay || input.hasDrawsInFlight) {
      return { action: 'pause-external' };
    }

    // 2. Queue collapse (LP-only burst). Visual events MUST NOT be collapsed
    // (see CLAUDE.md "Queue collapse — LP-only predicate").
    if (
      input.queue.length > QUEUE_COLLAPSE_THRESHOLD
      && input.queue.every(e => !('kind' in e)
        && (e.type === 'MSG_DAMAGE' || e.type === 'MSG_PAY_LPCOST' || e.type === 'MSG_RECOVER'))
    ) {
      return { action: 'collapse', collapseCount: input.queue.length - QUEUE_COLLAPSE_KEEP };
    }

    // 3. Dequeue priority: deferred-solving (held over from first-multi-link
    // banner) before normal queue.
    if (input.deferredSolvingEntry !== null) {
      return { action: 'consume-deferred', entry: input.deferredSolvingEntry };
    }
    if (input.queue.length > 0) {
      return { action: 'dequeue', entry: input.queue[0] };
    }

    // 4. Queue empty — three terminal branches.
    // 4a. Mid-chain pre-replay: prompt arrived while chain still resolving
    // and buffered events exist → flush them so player sees animations
    // before answering.
    if (input.isResolving && input.hasBufferedEvents && input.hasPendingPrompt) {
      return { action: 'pre-replay-buffer' };
    }

    // 4b. Default: finalize.
    // Note: prior versions had a poll back-off branch here gated on
    // (commitMode === 'deferred' && isWaitingForOverlay). It was found
    // unreachable due to the wait gate above (priority 1) and dropped
    // in 2026-05-10 — see CLAUDE.md "Polling Removal — Regression Surface".
    // The POLL-DROP REGRESSION watchdog (armPollDropWatchdog) catches
    // the pathological case the dropped branch was meant to handle.
    return { action: 'finalize' };
  }

  /**
   * Entry point — guards against re-entry from multiple callers
   * (await-signal effect, startProcessingIfIdle, postFinalize rescue).
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
    this._innerLoopDepth++;
    duelAssert(
      this._innerLoopDepth <= 1,
      '_processAnimationQueueInner',
      `Parallel re-entry detected (depth=${this._innerLoopDepth}). The _isProcessing ` +
      `finalize block (lines ~648-656) opened a window where a second async loop ` +
      `started before the first finished (audit finding C4).`,
    );
    try {
      while (this._isAnimating()) {
        // Pre-lock pass is a non-decisional side effect: it must run before
        // the dispatcher reads the queue so locks for queued sources are in
        // place when downstream branches commit/dequeue.
        this.moveRouter.preLockQueuedSources();

        const step = AnimationOrchestratorService.decideNextStep({
          isWaitingForOverlay: this.chainManager.isWaitingForOverlay,
          hasDrawsInFlight: this.drawManager.hasDrawsInFlight,
          queue: this.dataSource.animationQueue(),
          isResolving: this.chainManager.isResolving,
          hasBufferedEvents: this.chainManager.hasBufferedEvents,
          hasPendingPrompt: this.dataSource.pendingPrompt() !== null,
          commitMode: this.commitMode,
          deferredSolvingEntry: this.chainManager.deferredSolvingEvent,
        });

        this.logger.log(DuelLogCategory.QUEUE,
          'decideNextStep — action=%s queueLen=%d ownPlayer=%d',
          step.action, this.dataSource.animationQueue().length, this.ctx.ownPlayerIndex());

        switch (step.action) {
          case 'pause-external':
            return;

          case 'collapse': {
            for (let i = 0; i < step.collapseCount; i++) {
              const entry = this.dataSource.dequeueAnimation();
              if (entry && !('kind' in entry)) this.applyInstantAnimation(entry);
            }
            continue;
          }

          case 'consume-deferred': {
            // Commit the peek — chainManager held it in deferredSolvingEvent
            // until we acknowledged it.
            this.chainManager.consumeDeferredSolving();
            const flow = await this._handleEntry(step.entry);
            if (flow === 'return') return;
            continue;
          }

          case 'dequeue': {
            const entry = this.dataSource.dequeueAnimation()!;
            if ('kind' in entry) {
              const directiveResult = await this.processDirective(entry);
              if (directiveResult === 'pause') return;
              continue;
            }
            const flow = await this._handleEntry(entry);
            if (flow === 'return') return;
            continue;
          }

          case 'pre-replay-buffer': {
            // Mid-chain pre-replay: prompt is waiting and buffer non-empty.
            // replayBuffer(true) prepends directives + clears overlay wait;
            // the next loop tick dequeues them via the 'dequeue' branch.
            await this.replayBuffer(true);
            continue;
          }

          case 'finalize': {
            // INVARIANT: finalizeAndCommit() MUST run BEFORE setAnimating(false).
            // In replay, setAnimating(false) triggers advanceStep() → updateLogical()
            // with the next state. Committing first ensures we use the current state.
            this.trace('queueEmpty', { action: 'finalize' });
            // POLL-DROP REGRESSION watchdog — arm BEFORE finalize so a
            // reset-during-finalize chain (rare but possible if the LP
            // sync triggers a sync handler) clears it correctly. The
            // dropped poll mechanism would have engaged here while
            // chainPhase === 'resolving'; this watchdog catches stalls.
            if (this.dataSource.chainPhase() === 'resolving') {
              this.armPollDropWatchdog();
            }
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
              continue;
            }
            const state = this.rbs.logicalState();
            if (state.players.length === 2) {
              this.lpTracker.syncFromBoardState(state.players[0].lp, state.players[1].lp);
            }
            return;
          }
        }
      }
    } finally {
      this._innerLoopDepth--;
    }
  }

  /**
   * Process a dequeued GameEvent: release pre-locks, run processEvent,
   * apply commitMode side effects, and await the result. Returns 'return'
   * when the loop must exit (async result), 'continue' otherwise.
   *
   * Extracted from _processAnimationQueueInner to keep the dispatcher
   * focused on routing decisions. Behavior is identical to the prior
   * inline block — only the call site moved.
   */
  private async _handleEntry(event: GameEvent): Promise<'continue' | 'return'> {
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
    const buffered = this.chainManager.shouldBufferDuringChain
      && BOARD_CHANGING_EVENT_TYPES.has(event.type);
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
      this.lpTracker.discardPending();
      this.trace('commitUnlocked', { event: event.type });
      this.rbs.commitUnlocked();
    }

    if (result === 'async') {
      this.trace('asyncReturn', { type: event.type, reason: 'draw/overlay' });
      return 'return';
    }

    if (result instanceof Promise) {
      this.trace('promiseReturn', { type: event.type, reason: 'travel' });
      const guard = new Promise<void>(resolve => {
        setTimeout(() => {
          this.logger.warn('Travel promise never resolved for %s — forcing queue continue', event.type);
          resolve();
        }, this.ctx.safetyTimeout(LOCK_SAFETY_TIMEOUT_MS));
      });
      await Promise.race([result, guard]);
      this.lpTracker.commitIfPending();
      this.animatingZone.set(null);
      return 'continue';
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

    this.lpTracker.commitIfPending();
    this.animatingZone.set(null);
    return 'continue';
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
            this.logger.warn('[GROUP] Event %s returned async — a barrier MUST follow this group', entry.events[i].type);
          }
        }
        if (this.commitMode === 'per-event') {
          this.moveRouter.preLockQueuedSources();
          this.lpTracker.discardPending();
          this.rbs.commitUnlocked();
        }
        this.trace('groupAwait', { promiseCount: promises.length, inFlight: this.floatRegistry.inFlightCount(), landed: this.floatRegistry.landedCount() });
        if (promises.length > 0) await Promise.all(promises);
        this.trace('groupDone', { inFlight: this.floatRegistry.inFlightCount(), landed: this.floatRegistry.landedCount() });
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
    // Buffer board-changing events during chain resolution, unless we are
    // currently dispatching an inline buffer replay — in that case events
    // must play through rather than be re-buffered (which would loop forever).
    if (!this._isReplayingBuffer && this.chainManager.bufferIfResolving(event)) {
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
      case 'MSG_MOVE':            return this.moveRouter.processMoveEvent(event as MoveMsg);
      case 'MSG_DAMAGE':          return this.lpTracker.processLpEvent((event as DamageMsg).player, (event as DamageMsg).amount, 'damage');
      case 'MSG_RECOVER':         return this.lpTracker.processLpEvent((event as RecoverMsg).player, (event as RecoverMsg).amount, 'recover');
      case 'MSG_PAY_LPCOST':      return this.lpTracker.processLpEvent((event as PayLpCostMsg).player, (event as PayLpCostMsg).amount, 'damage');
      case 'MSG_FLIP_SUMMONING':  return this.handleFlipSummoning(event as FlipSummoningMsg);
      case 'MSG_CHANGE_POS':      return this.handleChangePos(event as ChangePosMsg);
      case 'MSG_CHAINING':        return this.handleChaining(event as ChainingMsg);
      case 'MSG_CHAIN_SOLVING':   return this.handleChainSolving(event as ChainSolvingMsg);
      case 'MSG_CHAIN_SOLVED':    return this.handleChainSolved(event as ChainSolvedMsg);
      case 'MSG_CHAIN_END':       return this.handleChainEnd();
      case 'MSG_DRAW':            return this.drawManager.processDrawEvent(event as DrawMsg);
      case 'MSG_SHUFFLE_HAND':    return this.drawManager.processShuffleEvent(event as ShuffleHandMsg);
      case 'MSG_CONFIRM_CARDS':   return this.drawManager.processConfirmCardsEvent(event as ConfirmCardsMsg);
      case 'MSG_SHUFFLE_DECK':    return this.processShuffleDeckEvent(event as ShuffleDeckMsg);
      case 'MSG_SET':             return 0; // No animation — position change handled by BOARD_STATE
      case 'MSG_BECOME_TARGET':   return this.handleBecomeTarget(event as BecomeTargetMsg);
      case 'MSG_SWAP':            return this.processSwapEvent(event as SwapMsg);
      case 'MSG_ATTACK':          return this.battleTracker.processAttackEvent(event as AttackMsg);
      case 'MSG_BATTLE':          return this.battleTracker.processBattleEvent(event as BattleMsg);
      case 'MSG_TOSS_COIN':       return this.handleTossCoin(event as TossCoinMsg);
      case 'MSG_TOSS_DICE':       return this.handleTossDice(event as TossDiceMsg);
      case 'MSG_EQUIP':           return this.handleEquip(event as EquipMsg);
      case 'MSG_ADD_COUNTER':
      case 'MSG_REMOVE_COUNTER':  return this.handleCounter(event as AddCounterMsg | RemoveCounterMsg);
      case 'MSG_SHUFFLE_SET_CARD': return this.handleShuffleSetCard(event as ShuffleSetCardMsg);
      case 'MSG_SWAP_GRAVE_DECK': return this.processSwapGraveDeckEvent(event as SwapGraveDeckMsg);
      default:                    return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-event handlers (extracted from processEvent for Miller compliance — H4)
  // ---------------------------------------------------------------------------

  private handleFlipSummoning(msg: FlipSummoningMsg): number {
    const zoneId = locationToZoneId(msg.location, msg.sequence);
    if (zoneId) {
      this.setAnimatingZone(zoneId, 'flip', msg.player);
      this.ctx.announceEvent('Card flip summoned', msg.player);
    }
    return POSITION_FLIP_MS;
  }

  private handleChangePos(msg: ChangePosMsg): number | Promise<void> | 0 {
    const wasFaceDown = (msg.previousPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const nowFaceUp = (msg.currentPosition & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
    if (wasFaceDown && nowFaceUp) {
      const zoneId = locationToZoneId(msg.location, msg.sequence);
      if (zoneId) this.setAnimatingZone(zoneId, 'flip', msg.player);
      return POSITION_FLIP_MS;
    }
    if (!wasFaceDown && nowFaceUp) {
      return this.processPositionRotation(msg);
    }
    return 0;
  }

  private handleChaining(msg: ChainingMsg): number | Promise<void> {
    const relPlayer = this.ctx.relativePlayer(msg.player);
    const holdMs = this.ctx.scaledDuration(CHAIN_ACTIVATE_MS, CHAIN_ACTIVATE_MIN_MS);
    const zoneId = locationToZoneId(msg.location, msg.sequence);
    if (zoneId) {
      this.setAnimatingZone(zoneId, 'activate', msg.player);
      const zoneKey = locationToZoneKey(msg.location, msg.sequence, relPlayer);
      if (zoneKey) return this.boardEffects.activateEffect(zoneKey, this.ctx.scaledDuration(CHAIN_ACTIVATE_MS, CHAIN_ACTIVATE_MIN_MS))
        .then(() => new Promise<void>(r => setTimeout(r, holdMs)));
    }
    if (msg.location === LOCATION.HAND) {
      const handEl = this.drawManager.resolveHandTarget(`HAND-${relPlayer}`, msg.sequence);
      if (handEl instanceof HTMLElement) {
        handEl.style.zIndex = '500';
        return this.boardEffects.activateEffect(handEl, this.ctx.scaledDuration(CHAIN_ACTIVATE_MS, CHAIN_ACTIVATE_MIN_MS))
          .then(() => { handEl.style.zIndex = ''; })
          .then(() => new Promise<void>(r => setTimeout(r, holdMs)));
      }
    }
    return CHAIN_ACTIVATE_FALLBACK_MS;
  }

  private handleChainSolving(msg: ChainSolvingMsg): number {
    // Clear pile-target floats: the cascade was for the targeting prompt
    // (MSG_BECOME_TARGET × N during chain building) and resolution begins now.
    this.targetIndicator.cleanup();
    const result = this.chainManager.handleSolving(msg);
    if (result.deferred) {
      const pauseMs = this.ctx.scaledDuration(CHAIN_BANNER_PAUSE_MS);
      const tid = this.chainManager.scheduleBannerAnnounce(pauseMs);
      this.animationTimeouts.push(tid);
      return CHAIN_BANNER_DEFERRED_BUDGET_MS;
    }
    this.dataSource.applyChainSolving(msg.chainIndex);
    const exitDelay = this.chainManager.chainSolvedCount > 0 ? this.chainExitDuration() : 0;
    return result.isSingleLink ? 0 : exitDelay + this.chainPulseDuration() + this.ctx.scaledDuration(CHAIN_SOLVING_TAIL_MS);
  }

  private handleChainSolved(msg: ChainSolvedMsg): 'async' {
    this.dataSource.applyChainSolved(msg.chainIndex);
    return this.chainManager.handleSolved(msg);
  }

  private handleChainEnd(): number {
    this.dataSource.applyChainEnd();
    this.chainManager.handleEnd();
    this.moveRouter.releaseAllPreLocks();
    this.drawManager.clearDrawsCompleteCallback();
    this.confirmRevealedCards.set(new Map());
    return CHAIN_END_SETTLE_MS;
  }

  private handleBecomeTarget(msg: BecomeTargetMsg): number {
    const ownIdx = this.ctx.ownPlayerIndex();
    // Field-zone targets keep the existing reticle binding on `.zone-card--targeted`.
    // Pile-zone targets (GY/Banished/Extra) are surfaced as floats above the pile,
    // since `.zone-pile` only renders the top card and would otherwise mis-target.
    // Accumulate (union) field keys instead of replacing — back-to-back MSG_BECOME_TARGET
    // (one per card) would otherwise leave only the last target highlighted.
    const fieldKeys = new Set<string>(this.targetedZoneKeys());
    for (const c of msg.cards) {
      if (c.location === LOCATION.MZONE || c.location === LOCATION.SZONE) {
        const relPlayer = c.player === ownIdx ? 0 : 1;
        fieldKeys.add(locationToZoneKey(c.location, c.sequence, relPlayer));
      }
    }
    this.targetedZoneKeys.set(fieldKeys);
    this.targetIndicator.spawnPileFloats(msg);
    const holdMs = BECOME_TARGET_PULSE_MS * this.ctx.speedMultiplier();
    const tid = setTimeout(() => this.targetedZoneKeys.set(new Set()), holdMs);
    this.animationTimeouts.push(tid);
    // Pile-target floats live until handleChainSolving calls targetIndicator.cleanup().
    // The cascade safety timer is sized for the worst case (many targets + slow
    // playback) plus a margin; a chain that never resolves (negated, error)
    // still cleans up eventually.
    // Coalesce + stagger back-to-back MSG_BECOME_TARGET:
    //   - non-last MSGs return TARGET_PILE_FLOAT_STAGGER_MS so consecutive
    //     spawns look sequential (carte 1 → carte 2 → ...) rather than
    //     appearing simultaneously.
    //   - the LAST MSG returns BECOME_TARGET_PULSE_MS so the cascade hold
    //     plays out before the queue advances and the next prompt shows.
    // The cleanup timer is sized to fire RIGHT AFTER the last hold so the
    // floats fade away before the SELECT_CHAIN prompt appears (which would
    // otherwise overlap the still-visible cascade in replay mode where
    // MSG_CHAIN_SOLVING arrives in a later step).
    const nextEvents = this.dataSource.animationQueue();
    const hasMoreBecomeTarget = nextEvents.some(e => !('kind' in e) && e.type === 'MSG_BECOME_TARGET');
    if (hasMoreBecomeTarget) {
      // Long fallback safety only — the next BECOME_TARGET will reschedule.
      this.targetIndicator.scheduleCleanup(holdMs * 6 + 4000);
      return TARGET_PILE_FLOAT_STAGGER_MS;
    }
    // Last MSG: cleanup starts at the hold end, queue waits until fade-out
    // completes so isAnimating stays true through the entire cascade
    // disappearance. Otherwise the next prompt would render for a frame
    // while the floats are still fading out.
    this.targetIndicator.scheduleCleanup(holdMs);
    return BECOME_TARGET_PULSE_MS + TARGET_PILE_FLOAT_FADE_OUT_MS;
  }

  private handleTossCoin(msg: TossCoinMsg): number {
    if (this.ctx.reducedMotion()) return 0;
    const lines = msg.results.map(r => r ? 'Heads ✓' : 'Tails ✗');
    this.toastService.show({ icon: '🪙', lines }, TOSS_TOAST_MS * this.ctx.speedMultiplier());
    this.ctx.announceEvent(`Coin toss: ${lines.join(', ')}`, msg.player);
    return TOSS_TOAST_MS;
  }

  private handleTossDice(msg: TossDiceMsg): number {
    if (this.ctx.reducedMotion()) return 0;
    const lines = msg.results.map((v, i) => `Die ${i + 1}: ${v}`);
    this.toastService.show({ icon: '🎲', lines }, TOSS_TOAST_MS * this.ctx.speedMultiplier());
    this.ctx.announceEvent(`Dice roll: ${msg.results.join(', ')}`, msg.player);
    return TOSS_TOAST_MS;
  }

  private handleEquip(msg: EquipMsg): number | Promise<void> {
    if (this.ctx.reducedMotion()) return 0;
    const relEquip = this.ctx.relativePlayer(msg.equipPlayer);
    const relTarget = this.ctx.relativePlayer(msg.targetPlayer);
    const equipKey = locationToZoneKey(msg.equipLocation, msg.equipSequence, relEquip);
    const targetKey = locationToZoneKey(msg.targetLocation, msg.targetSequence, relTarget);
    const equipEl = this.cardTravelEngine.getZoneElement(equipKey);
    const targetEl = this.cardTravelEngine.getZoneElement(targetKey);
    const lineEl = this.cardTravelEngine.createLineBetween(equipEl, targetEl, {
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

  private handleCounter(msg: AddCounterMsg | RemoveCounterMsg): number {
    if (this.ctx.reducedMotion()) return 0;
    const rel = this.ctx.relativePlayer(msg.player);
    const key = locationToZoneKey(msg.location, msg.sequence, rel);
    // Force signal change even for consecutive events on the same zone,
    // so Angular re-evaluates the class binding and the CSS animation restarts.
    this.counterPulseKey.set(null);
    this.counterPulseKey.set(key);
    this.scheduleTimeout(() => this.counterPulseKey.set(null), COUNTER_PULSE_MS * this.ctx.speedMultiplier());
    return COUNTER_PULSE_MS;
  }

  private handleShuffleSetCard(msg: ShuffleSetCardMsg): number | Promise<void> {
    if (this.ctx.reducedMotion()) return 0;
    const duration = this.ctx.scaledDuration(SHUFFLE_SET_CARD_TRAVEL_MS, SHUFFLE_SET_CARD_TRAVEL_MIN_MS);
    const locks: { commit: () => void; release: () => void }[] = [];
    const travels: Promise<void>[] = [];
    for (const c of msg.cards) {
      const relFrom = this.ctx.relativePlayer(c.fromPlayer);
      const relTo = this.ctx.relativePlayer(c.toPlayer);
      const fromKey = locationToZoneKey(c.location, c.fromSequence, relFrom);
      const toKey = locationToZoneKey(c.location, c.toSequence, relTo);
      locks.push(this.rbs.lockZone(fromKey));
      if (fromKey !== toKey) locks.push(this.rbs.lockZone(toKey));
      travels.push(this.cardTravelEngine.travel(fromKey, toKey, '', { duration, showBack: true }));
    }
    return Promise.all(travels).then(
      () => locks.forEach(l => l.commit()),
      () => locks.forEach(l => l.release()),
    );
  }

  private processSwapEvent(msg: SwapMsg): Promise<void> | 0 {
    if (this.ctx.reducedMotion()) return 0;
    const rel1 = this.ctx.relativePlayer(msg.card1.player);
    const rel2 = this.ctx.relativePlayer(msg.card2.player);
    const key1 = locationToZoneKey(msg.card1.location, msg.card1.sequence, rel1);
    const key2 = locationToZoneKey(msg.card2.location, msg.card2.sequence, rel2);
    const img1 = this.cardTravelEngine.toAbsoluteUrl(this.artService.resolveUrl(msg.card1.cardCode));
    const img2 = this.cardTravelEngine.toAbsoluteUrl(this.artService.resolveUrl(msg.card2.cardCode));
    const duration = this.ctx.scaledDuration(SWAP_TRAVEL_MS, SWAP_TRAVEL_MIN_MS);

    const lock1 = this.rbs.lockZone(key1);
    const lock2 = this.rbs.lockZone(key2);
    return Promise.all([
      this.cardTravelEngine.travel(key1, key2, img1, { duration, impactGlowColor: 'rgba(180,180,220,0.5)' }),
      this.cardTravelEngine.travel(key2, key1, img2, { duration, impactGlowColor: 'rgba(180,180,220,0.5)' }),
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

    const glowMs = this.ctx.scaledDuration(SWAP_GRAVE_DECK_GLOW_MS, SWAP_GRAVE_DECK_GLOW_MIN_MS);
    const travelMs = this.ctx.scaledDuration(SWAP_GRAVE_DECK_TRAVEL_MS, SWAP_GRAVE_DECK_TRAVEL_MIN_MS);

    const lockGy = this.rbs.lockZone(gyKey);
    const lockDeck = this.rbs.lockZone(deckKey);

    return new Promise<void>(resolve => {
      this.scheduleTimeout(() => {
        this.swapGraveDeckKeys.set(new Set());
        // Phase 2: single travel DECK→GY (card back) — GY update implied by commit
        this.cardTravelEngine.travel(deckKey, gyKey, '', { duration: travelMs, showBack: true }).then(
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
    const deckZone = this.cardTravelEngine.getZoneElement(deckKey);
    const pile = deckZone?.querySelector<HTMLElement>('.zone-pile');
    if (!pile) return 0;

    const duration = this.ctx.scaledDuration(SHUFFLE_DECK_MS, SHUFFLE_DECK_MIN_MS);
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
    const zoneEl = this.cardTravelEngine.getZoneElement(zoneKey);
    const cardEl = zoneEl?.querySelector<HTMLElement>('.zone-card');
    if (!cardEl) return 0;

    const fromRotation = this.extractRotationDeg(getComputedStyle(cardEl).transform);

    const nowDefense = (msg.currentPosition & (POSITION.FACEUP_DEFENSE | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const toRotation = this.ctx.zoneCardRotation(nowDefense);
    const duration = this.ctx.scaledDuration(POSITION_ROTATE_MS, POSITION_ROTATE_MIN_MS);

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

  /**
   * Apply an LP event (MSG_DAMAGE / MSG_PAY_LPCOST / MSG_RECOVER) instantly,
   * bypassing the per-event animation. Only ever called from the queue-collapse
   * path which filters its predicate to LP-class events (audit L21 — earlier
   * branches for MSG_CHAIN_SOLVING/SOLVED/END were unreachable after the
   * collapse predicate was tightened to LP-only; removed).
   *
   * H1 contract — chain events (MSG_CHAIN_SOLVING/SOLVED/END) MUST NEVER be
   * collapsed here. They drive the chain overlay contract via async overlay
   * signals; collapsing them would skip the resolve pulse + buffered-event
   * replay. If a future change re-introduces a chain branch, it MUST also
   * call `dataSource.applyChainSolving/Solved/End(...)` — otherwise the
   * processor's `chainPhase` and the manager's `isResolving` (which now
   * observes it) would both stay stuck. Refer to the audit's H1 closure.
   */
  private applyInstantAnimation(event: GameEvent): void {
    if (event.type === 'MSG_DAMAGE' || event.type === 'MSG_PAY_LPCOST'
      || event.type === 'MSG_RECOVER') {
      this.lpTracker.applyInstant(event);
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
