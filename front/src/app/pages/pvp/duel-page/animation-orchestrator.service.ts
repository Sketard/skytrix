import { inject, Injectable, Injector, isDevMode, signal } from '@angular/core';
import type { DuelState, GameEvent, StreamEvent } from '../types';
import type { MoveMsg, DrawMsg, DamageMsg, RecoverMsg, PayLpCostMsg, FlipSummoningMsg, ChangePosMsg, ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ShuffleHandMsg, ConfirmCardsMsg, ShuffleDeckMsg, BecomeTargetMsg, SwapMsg, AttackMsg, BattleMsg, TossCoinMsg, TossDiceMsg, EquipMsg, AddCounterMsg, RemoveCounterMsg, ShuffleSetCardMsg, SwapGraveDeckMsg } from '../duel-ws.types';
import { BOARD_CHANGING_EVENT_TYPES, LOCATION, POSITION } from '../duel-ws.types';
import { DuelCardArtService } from './duel-card-art.service';
import { locationToZoneId, locationToZoneKey } from '../pvp-zone.utils';
import { ANIMATION_DATA_SOURCE, type QueueDirective, type QueueEntry } from './animation-data-source';
import { QueueRunner, type EventResult, type QueueDecisionInputs, type QueueStep } from './queue-runner';
import {
  LOCK_SAFETY_TIMEOUT_MS,
  REPLAY_BUFFER_SAFETY_TIMEOUT_MS,
  POLL_DROP_REGRESSION_WATCHDOG_MS,
  BOARD_BREATHE_MS, BOARD_BREATHE_MIN_MS,
  POSITION_FLIP_MS, BECOME_TARGET_PULSE_MS, TARGET_PILE_FLOAT_STAGGER_MS, TARGET_PILE_FLOAT_FADE_OUT_MS,
  CHAIN_ACTIVATE_MS, CHAIN_ACTIVATE_MIN_MS, CHAIN_ACTIVATE_FALLBACK_MS,
  HAND_REVEAL_DETACH_MS, HAND_REVEAL_DETACH_MIN_MS,
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
  EQUIP_LINE_MS, EQUIP_LINE_MIN_MS,
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
import { PollDropWatchdog } from './poll-drop-watchdog';
import { DuelGameLogService } from './duel-game-log.service';
import { DeferredEffectProcessor } from './deferred-effect-processor';
import { RULES as DEFERRED_RULES } from './deferred-effect-rules';
import { ScopeResetDispatcher, type ScopeCategory } from '../projections';
import { duelAssert } from '../../../core/utilities/duel-assert';

// `QueueStep` / `QueueDecisionInputs` live in `queue-runner.ts` (Palier A,
// 2026-05-23). Re-exported here for back-compat of external callers.
export type { QueueStep, QueueDecisionInputs } from './queue-runner';

/**
 * Central animation queue processor for the duel page.
 * Provided at component level (NOT root).
 *

 * Thin coordinator that owns:
 * - Business dispatch (`_dispatchEvent` + `processDirective` + the per-type
 *   handlers in `processEvent`) — the runner calls back into here.
 * - Cross-cutting replay logic (replayBuffer via queue directives).
 * - Reset/destroy lifecycle (delegates to `runner.requestStop()`).
 *
 * The async queue loop + its 5 lifecycle primitives + per-step timing live
 * in `QueueRunner` (Palier A, 2026-05-23). See `queue-runner.ts`.
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
  /**
   * Optional Game Log handle — used only for `reset()` on rematch / state
   * sync (R8). The journal is fed by subscribing to `eventStream` from the
   * page (`attachEventStream` at Lot 2d), no tap method is called from
   * here. Injected `{ optional: true }` so the orchestrator's own spec
   * suite (which does not provide the service) keeps compiling.
   */
  private readonly gameLog = inject(DuelGameLogService, { optional: true });
  /**
   * α.5 — the duel-page-scoped `ScopeResetDispatcher`. Used by
   * `resetForSwitch` (dispatches PERSPECTIVE_LIFETIME) and `onStateSync`
   * (dispatches DUEL_LIFETIME) to fan-out resets to the 4 `ResetTarget`
   * managers (Chain, Lp, Battle, Log). `{ optional: true }` for the
   * same reason as `gameLog` — the orchestrator's own spec suite
   * (`animation-orchestrator.service.spec.ts`) does not provide it.
   * Cf. duel-session-chantier.md §3.5.
   */
  private readonly scopeDispatcher = inject(ScopeResetDispatcher, { optional: true });

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
   * POLL-DROP REGRESSION watchdog. Armed when the dispatcher finalizes the
   * queue while `chainPhase === 'resolving'` — i.e. the dropped poll
   * mechanism would have been engaged. Fires a high-visibility
   * `console.error` (grep marker: 'POLL-DROP REGRESSION') + duelAssert in
   * dev if no chain event re-wakes the queue in time. Pause-aware: a paused
   * resolving chain is healthy, not stalled. Extracted to a pure,
   * unit-tested class — see `poll-drop-watchdog.ts`. Cleared on
   * startProcessingIfIdle, clearTimersAndPolling, destroy.
   */
  private readonly pollDropWatchdog = new PollDropWatchdog(
    () => ({
      isResolving: this.dataSource.chainPhase() === 'resolving',
      queueLen: this.dataSource.animationQueue().length,
      isAnimating: this._isAnimating(),
      hasPendingPrompt: this.dataSource.pendingPrompt() !== null,
    }),
    () => this.firePollDropRegression(),
  );
  /** Set while inline replayBuffer is dispatching buffered events, so processEvent skips re-buffering. */
  private _isReplayingBuffer = false;

  /**
   * Pre-activation buffer: BOARD_CHANGING events that arrived while
   * `boardActive=false` (i.e. between BOARD_STATE and the dice arena
   * dismissing). Drained back into the head of the queue by
   * `drainPreActivationBuffer()` after a BOARD_BREATHE_MS beat, so the
   * initial 5-card draw plays its full animation instead of being avalé
   * silently by `processDrawEvent`'s legacy `!isBoardActive` guard.
   *
   * FIFO. Filled by the dispatch handler (single divert point — returns
   * `'divert'` to the runner). Drained by the `DuelLoadingEffectsService`
   * `duel-loading → active` effect.
   */
  private readonly _preActivationBuffer: GameEvent[] = [];
  /** Set while drainPreActivationBuffer's setTimeout is pending. Prevents
   *  double-drain if setBoardActive(true) fires twice within the beat. */
  private _preActivationDrainScheduled = false;

  /**
   * The animation queue runner (Palier A, 2026-05-23). Instantiated in the
   * constructor with callbacks into this orchestrator. Owns the async loop,
   * the 5 lifecycle primitives, and the per-step timer mechanics; the
   * orchestrator's role is reduced to business dispatch + the wiring of
   * managers + the `EventStream` push tap.
   */
  private runner!: QueueRunner;

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

  /**
   * Palier 0 — `EventStream`. Holds every duel event in logical order
   * (post-chain-buffer). Distinct from `dataSource.animationQueue()`: the
   * queue is the *animatable subset* the runner consumes; this stream is
   * the *complete log source* the Game Log subscribes to. Fed via the
   * single convergence point `pushToStream(event)`:
   *   - in-queue tap inside `processEvent` (every MSG_*);
   *   - `notifyOutOfBandEvent` for the types that bypass the queue by
   *     design (`MSG_CHAIN_NEGATED`, `SELECT_CARD`, `MSG_WIN` from
   *     `DUEL_END`, β.1 BoundaryEvents);
   *   - the `QueueRunner.onInternalEvent` sink (β.2a — α.3
   *     `InternalTransportEvent`s join the stream so the DEP observes
   *     transport state alongside WS messages).
   * The DEP also emits onto the stream through `pushDeferredToStream`,
   * which bypasses the `observe` re-entry guard (a deferred-emitted
   * `EffectReady` doesn't need to re-feed itself). The animation queue
   * invariant "`MSG_CHAIN_NEGATED` is NOT enqueued" stays true — queue
   * and stream are two distinct objects.
   */
  private readonly _eventStream = signal<StreamEvent[]>([]);
  readonly eventStream = this._eventStream.asReadonly();

  /**
   * β.2a — the DeferredEffectProcessor. Plain class, instantiated here
   * because the DEP must observe the SAME convergence point as the
   * orchestrator's `pushToStream` (the only site that sees WS messages,
   * boundary events, AND runner transport events in arrival order). A
   * processor-side instantiation (mirror of `BoundaryProcessor` inside
   * `DuelEventProcessor`) would miss the runner half of the stream.
   *
   * Emit sink writes directly to `_eventStream` (no `observe` re-entry —
   * a deferred event must not feed itself back into the processor). The
   * lazy `getLogger` lets the DEP read `this.logger` after construction
   * (mirror of the BP wiring inside the DEP).
   *
   * Auto-registered with `scopeDispatcher` in the constructor so it
   * participates in §3.6 checkpoint fan-out (STATE_SYNC / RematchStarted
   * cascade DUEL → CONNECTION → drop every pending deferred with
   * `EffectAbandoned(reason='checkpoint')`).
   */
  private readonly deferredProcessor = new DeferredEffectProcessor(
    e => this.pushDeferredToStream(e),
    () => this.logger,
    undefined, // real clock (default)
    DEFERRED_RULES, // β.2b — metier rules table
  );

  /**
   * β.2b — monotonic stream ref counter. Owned by the orchestrator so
   * every event pushed via `pushToStream` carries a stable
   * `streamRef` that:
   *   · the DEP receives via `observe(event, ref)` and stores as the
   *     `triggerRef` for any deferred the event opens;
   *   · the orchestrator's own `_dispatchEvent` wraps with
   *     `AnimationStarted(ref)` / `AnimationCompleted(ref)` so a rule's
   *     `chainTo` can pin its next predicate to "the animation of THIS
   *     specific business event finished" via
   *     `{kind:'animation', type:'AnimationCompleted', ref: matchedRef}`.
   * Reset on `_eventStream.set([])` (resetAllState — keeps the ref
   * range bounded across rematch / state sync).
   * _transport_*: internal-only, never read by UI / templates.
   */
  private _transport_nextStreamRef = 0;

  /**
   * β.2b — side-channel: the ref the LAST `pushToStream` call assigned
   * during the currently-running `processEvent`. Read by `_dispatchEvent`
   * + `processDirective.group` right after `processEvent` returns, to
   * build `AnimationStarted/Completed({ref})` events around the await.
   * Reset to `null` at the top of `processEvent` so a buffered event
   * (which short-circuits before `pushToStream`) leaves the field at
   * `null` — the caller then knows "no animation events needed for
   * this dispatch".
   * Safe because `processEvent` is fully synchronous from entry to
   * return; the side-channel never holds across an `await`.
   * _transport_*: internal-only.
   */
  private _transport_lastDispatchedRef: number | null = null;

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

    // Palier A — instantiate the queue runner. The runner owns the async
    // loop + the 5 lifecycle primitives; the orchestrator stays a thin
    // coordinator that exposes the queue façade and dispatches business
    // logic through callbacks below.
    this.runner = new QueueRunner({
      dataSource: this.dataSource,
      pollDropWatchdog: this.pollDropWatchdog,
      ctx: this.ctx,
      logger: this.logger,
      injector: this.injector,
      handleEntry: ev => this._dispatchEvent(ev),
      processDirective: entry => this.processDirective(entry),
      applyInstantAnimation: ev => this.applyInstantAnimation(ev),
      consumeDeferredSolving: () => this.chainManager.consumeDeferredSolving(),
      preReplayBuffer: () => this.replayBuffer(true),
      preLockQueuedSources: () => this.moveRouter.preLockQueuedSources(),
      onStepSettled: () => {
        this.lpTracker.commitIfPending();
        this.animatingZone.set(null);
      },
      onFinalize: () => {
        this.finalizeAndCommit();
        this.drawManager.resetHandAnimationState();
        this.animatingZone.set(null);
        this.lpTracker.animatingLpPlayer.set(null);
        const state = this.rbs.logicalState();
        if (state.players.length === 2) {
          this.lpTracker.syncFromBoardState(state.players[0].lp, state.players[1].lp);
        }
      },
      onIsRunningChange: running => {
        this._isAnimating.set(running);
        this.dataSource.setAnimating(running);
      },
      decisionInputs: () => ({
        isWaitingForOverlay: this.chainManager.isWaitingForOverlay,
        hasDrawsInFlight: this.drawManager.hasDrawsInFlight,
        isResolving: this.chainManager.isResolving,
        hasBufferedEvents: this.chainManager.hasBufferedEvents,
        hasPendingPrompt: this.dataSource.pendingPrompt() !== null,
        commitMode: this.commitMode,
        deferredSolvingEntry: this.chainManager.deferredSolvingEvent,
      }),
      // β.2a — absorb the α.3 InternalTransportEvent sink onto the
      // EventStream. The DEP (and future projections) observe the
      // runner's lifecycle transitions in the same arrival order as WS
      // messages + boundary events, closing the W1 finding from the α
      // code-review (the transport sink was orthogonal to the stream).
      onInternalEvent: e => this.pushToStream(e),
    });

    // Resume effect: when overlay signals ready, resume queue processing.
    // Handles the negated/no-buffer case where replayBuffer is NOT called.
    this.chainManager.initResumeEffect(() => {
      if (this._isAnimating()) this.runner.notifyEnqueue();
    });
    // Wire draw manager queue resume callback
    this.drawManager.initQueueResumeCallback(() => this.runner.notifyEnqueue());

    // β.2a — auto-register the DEP with the scope-reset dispatcher so
    // STATE_SYNC / RematchStarted (DUEL_LIFETIME → cascades to
    // CONNECTION) abandon every pending deferred with
    // `EffectAbandoned(reason='checkpoint')`. `{ optional: true }` on
    // the dispatcher inject above means the orchestrator's own spec
    // suite (which does not provide the dispatcher) keeps compiling —
    // the DEP simply never receives a reset there, which is fine for
    // the unit tests that exercise it directly.
    this.scopeDispatcher?.register(this.deferredProcessor);
  }

  /** Called by the animation queue watcher effect in the component. */
  startProcessingIfIdle(): void {
    this.runner.notifyEnqueue();
  }

  /**
   * Fire callback for `pollDropWatchdog` — surfaces a genuine finalize-
   * during-resolving stall with a non-missable `console.error` (NOT
   * `logger.error`, which doesn't exist, so the marker is unfilterable by
   * debug-category settings) + a dev-mode `duelAssert`. See CLAUDE.md
   * "Polling Removal — Regression Surface".
   */
  private firePollDropRegression(): void {
    const links = this.dataSource.activeChainLinks();
    console.error(
      '[POLL-DROP REGRESSION] chain stuck after finalize-during-resolving for %dms. '
      + 'activeChainLinks=%o queueLen=%d isWaitingForOverlay=%s hasBufferedEvents=%s. '
      + 'See CLAUDE.md "Polling Removal — Regression Surface" — the dropped poll '
      + 'mechanism would have rescued this state.',
      POLL_DROP_REGRESSION_WATCHDOG_MS,
      links.map(l => ({ idx: l.chainIndex, loc: l.location, seq: l.sequence })),
      this.dataSource.animationQueue().length,
      this.chainManager.isWaitingForOverlay,
      this.chainManager.hasBufferedEvents,
    );
    duelAssert(false, 'POLL-DROP-REGRESSION',
      `chain stuck after ${POLL_DROP_REGRESSION_WATCHDOG_MS}ms — see error log above`);
  }

  /**
   * Replay-only: notify the orchestrator of auto-play pause/resume so the
   * POLL-DROP watchdog doesn't false-fire on a paused-but-healthy resolving
   * chain. Delegates to the watchdog (pure, unit-tested). No-op semantics in
   * PvP (never called).
   */
  setPlaybackPaused(paused: boolean): void {
    this.pollDropWatchdog.setPaused(paused);
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

    // Inline path: called from mid-chain pre-replay inside the runner's loop.
    // Prepend batch directly — the while loop continues and processes directives.
    // No await-signal (overlay not involved), no external `notifyEnqueue` call
    // (would be a no-op since the runner is already processing).
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
      this.runner.notifyEnqueue();
    });
  }

  // ---------------------------------------------------------------------------
  // Pre-activation buffer (initial draw breathe beat)
  // ---------------------------------------------------------------------------

  /**
   * Read-only access to the pre-activation buffer length — for tests +
   * diagnostics. Production code MUST NOT depend on this value (the
   * orchestrator owns the buffer's lifecycle end-to-end).
   */
  get preActivationBufferLength(): number {
    return this._preActivationBuffer.length;
  }

  /** Snapshot of pre-activation buffer contents for diagnostics. Returns a
   *  defensive copy with only the type tag (the full payload is not needed
   *  for debugging — `[ANIM:PIPELINE]` already traces each enqueue). */
  preActivationBufferSnapshot(): ReadonlyArray<{ type: string }> {
    return this._preActivationBuffer.map(e => ({ type: e.type }));
  }

  /**
   * True while initial-draw events are still parked OR the breathe-delay
   * drain timer is pending. Consumed by `PromptDerivationService` to gate
   * `SELECT_IDLECMD` / `SELECT_BATTLECMD` from flashing during the
   * dice→board transition: without this gate the first prompt would
   * appear, vanish under `isAnimating()` once the drain fires, then
   * re-appear, producing a visible flicker.
   *
   * NOT a signal — read at compute-time by `visiblePrompt`. The trigger
   * for re-evaluation comes from the queue/animating signals the same
   * computed already reads.
   */
  isPreActivationBufferActive(): boolean {
    return this._preActivationDrainScheduled || this._preActivationBuffer.length > 0;
  }

  /**
   * Test seam: pushes an event into the pre-activation buffer directly,
   * bypassing the `_dispatchEvent` queue-loop divert. Production code
   * routes events through `_dispatchEvent` only — spec callers use this
   * to set up fixtures without driving the whole queue.
   */
  bufferPreActivationForTesting(event: GameEvent): void {
    this._preActivationBuffer.push(event);
  }

  /**
   * Called by `DuelLoadingEffectsService` after `setBoardActive(true)` —
   * waits `BOARD_BREATHE_MS` (scaled by speedMultiplier), then prepends
   * the buffered events back into the animation queue and re-kicks the
   * runner. Idempotent: a second call while the timer is pending is
   * a no-op, and an empty buffer resolves immediately.
   *
   * `BOARD_CHANGING` events that arrive while `boardActive=false` are
   * parked by `_dispatchEvent` instead of running. The drain re-injects
   * them through the normal queue path so locks, commits, and chain
   * gating behave identically to the live case — only the timing shifts.
   */
  drainPreActivationBuffer(): void {
    if (this._preActivationDrainScheduled) return;
    if (this._preActivationBuffer.length === 0) return;
    this._preActivationDrainScheduled = true;
    const delay = this.ctx.scaledDuration(BOARD_BREATHE_MS, BOARD_BREATHE_MIN_MS);
    this.trace('preActivationDrain:schedule', { bufferLen: this._preActivationBuffer.length, delay });
    const t = setTimeout(() => {
      this._preActivationDrainScheduled = false;
      // Splice out a snapshot so concurrent buffering during the drain
      // (defensive — shouldn't happen in practice) doesn't double-process.
      const drained = this._preActivationBuffer.splice(0);
      if (drained.length === 0) return;
      this.trace('preActivationDrain:fire', { count: drained.length });
      this.dataSource.prependToQueue(drained);
      this.runner.notifyEnqueue();
    }, delay);
    this.animationTimeouts.push(t);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private clearTimersAndPolling(): void {
    this.animationTimeouts.forEach(t => clearTimeout(t));
    this.animationTimeouts = [];
    for (const el of this.activeEquipLines) el.remove();
    this.activeEquipLines = [];
    // Palier A — the runner owns its 5 lifecycle primitives + per-step
    // timers + await-signal effect + the POLL-DROP watchdog clear.
    // `requestStop()` bumps the generation so any suspended inner loop
    // bails on resume, then flips `_isRunning` back to false through the
    // `onIsRunningChange` callback — which keeps `_isAnimating` in sync.
    this.runner.requestStop();
    // Drop any parked initial-draw events — a hard reset (destroy /
    // resetForSwitch) means the next duel starts fresh, replaying its own
    // BOARD_STATE + MSG_DRAW sequence. Carrying stale buffered events
    // would mean the rematch board flashes the previous duel's draws.
    this._preActivationBuffer.length = 0;
    this._preActivationDrainScheduled = false;
  }

  /**
   * Component-scoped teardown. The 4 ResetTarget managers (Chain, Lp,
   * Battle, Log) are themselves component-scoped, so they die with this
   * service — explicit `reset()` calls here are defense-in-depth against
   * carried-over timers / live announcers / cached objects, not state
   * leaks (the DI graph already collects them). All four are listed
   * symmetrically so a future ResetTarget added without updating this
   * method is the only outlier instead of an asymmetric pair.
   */
  destroy(): void {
    this.clearTimersAndPolling();
    this._isAnimating.set(false);
    this.chainManager.reset();
    this.lpTracker.reset();
    this.battleTracker.reset();
    this.gameLog?.reset();
    // β.2a — silent reset on hard teardown (mirrors BP.silentReset and
    // the orchestrator's intent for `destroy`). Drops timers + the
    // active map WITHOUT emitting `EffectAbandoned` — the stream
    // subscriber dies with the same scope so emitting closures would
    // only pollute a stream nobody reads.
    this.deferredProcessor.silentReset();
    this.drawManager.clearTimeouts();
    this.moveRouter.clearTimeouts();
    this.moveRouter.releaseAllPreLocks();
  }

  /**
   * Shared reset logic for both `resetForSwitch` and `onStateSync`.
   * Caller passes the scope set to dispatch — α.5 replaces what used to
   * be manual chains of `chainManager.reset()` / `lpTracker.reset()` /
   * `battleTracker.reset()` with a single `dispatcher.dispatch(scopes)`
   * driven by the 4 ResetTarget managers' declared scopes:
   *
   *   - `resetForSwitch` passes `{PERSPECTIVE_LIFETIME}` → hits Chain
   *     (declared PERSPECTIVE) + Battle (PERSPECTIVE) only. Lp + Log
   *     (DUEL_LIFETIME) survive the switch — the same duel viewed from
   *     either side must share LP state + journal. The duel-session-
   *     chantier §3.5 invalidation matrix is now mechanically enforced
   *     instead of relying on a comment that "the line must not be
   *     added back".
   *
   *     Behaviour change from pre-α.5: `LpAnimationTracker.reset()` is
   *     no longer called at SOLO switchPlayer. Safe because the BOARD_STATE
   *     that immediately follows the switch re-syncs `trackedLp` via
   *     `lpTracker.syncFromBoardState`, so the rendered LP values stay
   *     accurate. Mid-chain `_pendingLpCommits` now correctly survive the
   *     switch (cf. §3.5 LP scope rationale).
   *
   *   - `onStateSync` passes `{DUEL_LIFETIME}` → cascade hits all 4
   *     managers (DUEL ⊃ CONNECTION ⊃ PERSPECTIVE). The journal is
   *     cleared via `gameLog.applyReset` so the incoming STATE_SYNC
   *     payload's `gameLogEntries` can repopulate from a clean slate
   *     (R8 rematch + F5 reconnect path). No more explicit
   *     `gameLog?.reset()` after the shared helper.
   *
   * Non-ResetTarget cleanups (drawManager, moveRouter, targetIndicator,
   * toastService, transient signal sets) stay as explicit chains here —
   * they aren't projection state, so they don't participate in the
   * dispatcher. β.3+ will revisit which of these become projections.
   */
  private resetAllState(scopes: ReadonlySet<ScopeCategory>): void {
    this.clearTimersAndPolling();
    this._isAnimating.set(false);
    this.drawManager.reset();
    this.drawManager.clearTimeouts();
    this.animatingZone.set(null);
    this.finalizeAndCommit();
    this.rbs.commitAll(); // Lifecycle: force-sync all zones + clear locks
    this.scopeDispatcher?.dispatch(scopes);
    this.moveRouter.clearTimeouts();
    this.moveRouter.releaseAllPreLocks();
    this.confirmRevealedCards.set(new Map());
    this.targetedZoneKeys.set(new Set());
    this.targetIndicator.reset();
    this.counterPulseKey.set(null);
    this.swapGraveDeckKeys.set(new Set());
    this.toastService.clear();
    // β.2a note — any `EffectAbandoned(checkpoint)` emitted by the DEP
    // during `dispatch(scopes)` above lands here BEFORE the clear, so
    // the journal subscriber's effect (one task) only sees the final
    // empty array. Acceptable at β.2a because RULES is empty in prod;
    // β.3+ projections that consume EffectAbandoned will need this
    // ordering reworked (drain dispatcher events before clearing, or
    // dispatch AFTER the clear with a fresh stream).
    this._eventStream.set([]);
    // β.2b — restart the monotonic ref so a fresh duel / state-sync
    // doesn't grow the ref unboundedly. Side-channel cleared for safety
    // (the next `processEvent` resets it anyway, but a no-op dispatch
    // wouldn't).
    this._transport_nextStreamRef = 0;
    this._transport_lastDispatchedRef = null;
  }

  /**
   * β.2a / β.2b — the single convergence point for any event that lands
   * on the EventStream. Assigns a monotonic `ref`, updates the stream
   * signal, AND feeds the DEP so it can match its `awaitingPredicate`s
   * against the event. Returns the assigned ref so callers that need
   * to correlate downstream events (animation lifecycle wrap in
   * `_dispatchEvent`) can pin them to the same value. Call sites:
   *   · in-queue tap inside `processEvent` (every MSG_* the orchestrator
   *     dispatches);
   *   · `notifyOutOfBandEvent` (events that bypass the animation queue
   *     by design — see its docblock);
   *   · `QueueRunner.onInternalEvent` sink (β.2a — α.3 runner
   *     `InternalTransportEvent`s, absorbed onto the stream so the DEP
   *     observes transport state alongside WS messages).
   * Does NOT touch `dataSource.animationQueue()` — invariant
   * "`MSG_CHAIN_NEGATED` is NOT enqueued" stays true.
   */
  private pushToStream(event: StreamEvent): number {
    const ref = this._transport_nextStreamRef++;
    this._eventStream.update(s => [...s, event]);
    this.deferredProcessor.observe(event, ref);
    return ref;
  }

  /**
   * β.2a — exclusive entry point for the DEP's own emissions. Bypasses
   * the `observe` re-entry guard: a `DeferredEffect` / `EffectReady` /
   * `EffectAbandoned` event MUST NOT be re-fed to the DEP that emitted
   * it. Otherwise correct — the stream stays the source of truth for
   * downstream projections.
   */
  private pushDeferredToStream(event: StreamEvent): void {
    this._eventStream.update(s => [...s, event]);
  }

  /**
   * β.2b — emit `AnimationStarted({ref, msgType})` + `AnimationCompleted({ref, msgType})`
   * for the business event that `processEvent` just pushed (ref read
   * from `_transport_lastDispatchedRef`). No-op if the side-channel is
   * `null` (buffered / divert / no push happened). Both events go
   * through `pushToStream` so the DEP observes them in arrival order
   * and a chainTo rule sees them after the business event.
   * SYNC emission for now — see the callsite comment for why.
   */
  private emitAnimationLifecycle(msgType: string): void {
    const ref = this._transport_lastDispatchedRef;
    if (ref === null) return;
    this.pushToStream({ kind: 'animation', type: 'AnimationStarted', ref, msgType });
    this.pushToStream({ kind: 'animation', type: 'AnimationCompleted', ref, msgType });
  }

  /**
   * Palier 0 — push a `GameEvent` that bypasses the animation queue by
   * design into the EventStream. Three+ call-sites:
   *   · `MSG_CHAIN_NEGATED` — surfaced by `DuelEventProcessor.onEvent` (the
   *     processor consumes it silently for chain-state but still emits it
   *     here so the journal sees the "Nié" badge in PvP live);
   *   · `SELECT_CARD` — surfaced by `DuelConnection` on prompt routing
   *     (the builder needs it as the secondary `MSG_BECOME_TARGET` resolver);
   *   · `MSG_WIN` (reconstructed from `DUEL_END`) — surfaced by
   *     `DuelConnection` on duel close (server converts MSG_WIN → DUEL_END;
   *     the journal needs the original to render the 🏆 row);
   *   · β.1 `BoundaryEvent`s — emitted by `BoundaryProcessor` via the
   *     same `processor.onEvent` sink the adapters wire here.
   * Delegates to `pushToStream` (β.2a) so the DEP observes these events
   * too. Public method kept as the stable adapter-side API.
   */
  notifyOutOfBandEvent(event: StreamEvent): void {
    this.pushToStream(event);
  }

  resetForSwitch(): void {
    this.logger.log(DuelLogCategory.QUEUE, 'resetForSwitch — clearing all state & timeouts');
    // PERSPECTIVE_LIFETIME only — Lp + Log survive (cf. resetAllState doc).
    this.resetAllState(new Set<ScopeCategory>(['PERSPECTIVE_LIFETIME']));
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
    // DUEL_LIFETIME — cascade hits all 4 ResetTarget managers (Lp + Log
    // included). The STATE_SYNC payload repopulates from a clean slate
    // (R8 rematch + F5 reconnect path); no separate `gameLog?.reset()`
    // needed — the dispatcher handles it.
    this.resetAllState(new Set<ScopeCategory>(['DUEL_LIFETIME']));
  }

  // ---------------------------------------------------------------------------
  // Queue dispatch (Palier A — the loop itself lives in `QueueRunner`).
  //
  // The orchestrator owns the BUSINESS dispatch (this `_dispatchEvent` +
  // `processDirective` + the per-type handlers in `processEvent`). The runner
  // owns the MECHANICS (when to dispatch, when to await, when to finalize,
  // when to rescue). The seam is `_dispatchEvent`: it runs synchronously and
  // returns the raw `EventResult` (number / 'async' / Promise) which the
  // runner then awaits. Pre-activation buffering is signalled to the runner
  // with the `'divert'` discriminant so the event is dropped silently.
  // ---------------------------------------------------------------------------

  /**
   * Synchronous business dispatch for a queued GameEvent. Pre-activation
   * buffer divert → returns `'divert'`. Otherwise: invokes `processEvent`,
   * releases pre-locks per CLAUDE.md rules, applies `commitMode` side
   * effects, and returns the raw `EventResult` for the runner to await.
   *
   * The runner consumes the returned value:
   *   · `number`           → millisecond hold (`setTimeout`).
   *   · `'async'`          → suspend until a draw/overlay callback resumes.
   *   · `Promise<void>`    → travel; awaited with a `LOCK_SAFETY_TIMEOUT_MS`
   *                          guard `Promise.race`.
   *   · `'divert'`         → event parked, dropped without further handling.
   */
  private _dispatchEvent(event: GameEvent): EventResult | 'divert' {
    // Pre-activation buffer divert: between BOARD_STATE landing and the
    // dice arena dismissing (roomState 'duel-loading' → 'active'), the
    // initial-draw + opening-board events would otherwise be silently
    // skipped by per-event `!isBoardActive` guards (draw-sequence-manager
    // legacy behavior). Park them in `_preActivationBuffer` instead;
    // `drainPreActivationBuffer()` re-injects them after `BOARD_BREATHE_MS`
    // when `DuelLoadingEffectsService` flips boardActive=true.
    //
    // Limited to `BOARD_CHANGING_EVENT_TYPES` (MSG_MOVE, MSG_DRAW, …).
    // Non-board-changing messages (TIMER_STATE, MSG_HINT) keep their
    // existing path — they're either dropped naturally or rendered to
    // text-only UI that doesn't need the breathe beat.
    //
    // The `_isReplayingBuffer` guard prevents re-buffering during a
    // late-arriving chain replay (defensive — the replay path triggers
    // only mid-DUELING so boardActive is true, but the cost of the check
    // is one boolean read).
    if (!this.ctx.isBoardActive()
        && !this._isReplayingBuffer
        && BOARD_CHANGING_EVENT_TYPES.has(event.type)) {
      this._preActivationBuffer.push(event);
      this.trace('preActivationDrain:park', { type: event.type, bufferLen: this._preActivationBuffer.length });
      return 'divert';
    }

    const result = this.processEvent(event);
    const resultLabel = result instanceof Promise ? 'Promise' : result === 'async' ? 'async' : `${result}ms`;
    this.trace('processEvent', { type: event.type, result: resultLabel });

    // β.2b — emit AnimationStarted + AnimationCompleted around this
    // dispatch so DEP rules can pin a chainTo predicate to "the
    // animation of THIS specific event finished". Sync emission for
    // now — the DEP only needs the RELATIVE order on the stream to be
    // correct (event → AnimationStarted → AnimationCompleted), not
    // wall-clock alignment with the real travel. β.3 will hook the
    // runner's onStepSettled so the AnimationCompleted matches the
    // actual wall-clock completion (needed once a projection consumes
    // EffectReady to gate a visual). Buffered events skip the wrap
    // because the side-channel is null.
    this.emitAnimationLifecycle(event.type);

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

    return result;
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
          // β.2b — sync AnimationStarted/Completed wrap, see
          // `_dispatchEvent` for the rationale.
          this.emitAnimationLifecycle(entry.events[i].type);
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
        // Palier A — the runner owns the effect lifecycle so a `requestStop`
        // can dispose it atomically. `installAwaitSignal` returns true when
        // the signal was already truthy (no effect installed); false means
        // the effect is now armed and the queue must pause.
        const alreadyResolved = this.runner.installAwaitSignal(entry.signal);
        return alreadyResolved ? 'continue' : 'pause';
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
    // β.2b side-channel reset — the buffered short-circuit below skips
    // `pushToStream`, so the field stays null and the caller knows not
    // to emit AnimationStarted/Completed for this dispatch.
    this._transport_lastDispatchedRef = null;

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

    // EventStream push — LOAD-BEARING placement, do not move (analysis §2.3):
    //  - AFTER `bufferIfResolving` so a chain-buffered event reaches the
    //    stream only on `replayBuffer` re-dispatch (logical order, once);
    //  - AFTER `updateLogical(boardStateAfter)` so any subscriber reading
    //    `logicalState()` sees the post-event board;
    //  - BEFORE the dispatch switch: passive side-effect, no influence on
    //    animation dispatch.
    // β.2a — routes through `pushToStream` so the DEP observes the event
    // in the exact same arrival order projections see it.
    // β.2b — stash the assigned ref on the side-channel so the caller
    // (`_dispatchEvent` / `processDirective.group`) can wrap the await
    // with `AnimationStarted/Completed({ref})` matching this event.
    this._transport_lastDispatchedRef = this.pushToStream(event);

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
        // Opponent activation (relPlayer 1): the card is hidden in their fan,
        // so flip it face-up + ease it clear of the neighbours so the viewer
        // can read it, then play the activation flash on the detached card.
        // The player's own activation keeps the in-place flash (no reveal
        // needed — the player already knows their card).
        // `handEl` is a REAL `.hand-card` node, not a disposable overlay — the
        // imperative zIndex MUST be reset in a `finally` so a cancelled /
        // rejected reveal animation (queue reset during a seek) does not leave
        // the card stranded above the fan.
        if (relPlayer === 1) {
          const cardImage = this.cardTravelEngine.toAbsoluteUrl(this.artService.resolveUrl(msg.cardCode));
          const detachMs = this.ctx.scaledDuration(HAND_REVEAL_DETACH_MS, HAND_REVEAL_DETACH_MIN_MS);
          handEl.style.zIndex = '1100';
          return (async () => {
            try {
              await this.boardEffects.revealOpponentHandCard(handEl, cardImage, detachMs);
              await new Promise<void>(r => setTimeout(r, holdMs));
            } finally {
              handEl.style.zIndex = '';
            }
          })();
        }
        handEl.style.zIndex = '500';
        return (async () => {
          try {
            await this.boardEffects.activateEffect(handEl, this.ctx.scaledDuration(CHAIN_ACTIVATE_MS, CHAIN_ACTIVATE_MIN_MS));
            await new Promise<void>(r => setTimeout(r, holdMs));
          } finally {
            handEl.style.zIndex = '';
          }
        })();
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
    const duration = this.ctx.scaledDuration(EQUIP_LINE_MS, EQUIP_LINE_MIN_MS);
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
