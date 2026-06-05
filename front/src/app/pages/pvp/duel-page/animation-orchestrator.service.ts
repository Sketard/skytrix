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
import { tagAsAbsorbed, isAbsorbed } from './absorbed-event-registry';
import { AnimatingZoneProjection, BaseProjection, CounterPulseProjection, IsAnimatingProjection, OverlayShowReadyProjection, ScopeResetDispatcher, SwapGraveDeckProjection, TargetedZoneKeysProjection, type ScopeCategory } from '../projections';
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
   * Game Log handle — used only for `reset()` on rematch / state sync
   * (R8). The journal is fed by subscribing to `eventStream` from the
   * page (`attachEventStream` at Lot 2d), no tap method is called from
   * here.
   */
  private readonly gameLog = inject(DuelGameLogService);
  /**
   * α.5 — the duel-page-scoped `ScopeResetDispatcher`. Used by
   * `notifyPerspectiveSwitch` + `resetForReplaySeek` (both dispatch
   * PERSPECTIVE_LIFETIME) and `onStateSync` (dispatches DUEL_LIFETIME)
   * to fan-out resets to the 4 `ResetTarget` managers (Chain, Lp,
   * Battle, Log). Cf. duel-session-chantier.md §3.5.
   */
  private readonly scopeDispatcher = inject(ScopeResetDispatcher);

  // --- Public read-only signals ---
  /**
   * β.3 Lot 3.1 — `_isRunning` lifecycle exposed as a projection of
   * the EventStream's `runner-started` / `runner-stopped` transport
   * events (emitted by `QueueRunner.setRunning` via
   * `onInternalEvent`, absorbed onto `_eventStream` since β.2a).
   * PERSPECTIVE_LIFETIME scope. Templates / computed / effects read
   * `isAnimating.value()`; the legacy `isAnimating()` callable alias
   * is exposed below for back-compat.
   */
  readonly isAnimating = new IsAnimatingProjection();

  /**
   * β.3 Lot 2.6 — pulse glow on a field zone whose card just flipped
   * face-up (MSG_FLIP_SUMMONING / MSG_CHANGE_POS face-down → face-up)
   * or activated (MSG_CHAINING with a non-HAND zoneId). Cleared by the
   * matching `AnimationCompleted` (wall-clock end of the handler's
   * hold) or by `applyReset` on §3.6 cascades. Templates read
   * `animatingZone.value()` directly.
   */
  readonly animatingZone = new AnimatingZoneProjection({
    relativePlayer: (abs: number) => this.ctx.relativePlayer(abs),
  });

  /** Single source of truth for the chain pulse glow duration (ms). */
  chainPulseDuration(): number {
    return Math.round(CHAIN_PULSE_BASE_MS * this.ctx.speedMultiplier());
  }

  /** Single source of truth for the chain exit animation duration (ms). */
  chainExitDuration(): number {
    return Math.round(CHAIN_PULSE_BASE_MS * this.ctx.speedMultiplier());
  }

  /**
   * F3 (2026-05-30) — true iff the animation board is in a stable,
   * perspective-swappable state. Originally gated `canSwitchPerspective` in the
   * SOLO orchestrator. v3 Phase 5 (2026-06-05) — no longer read by prod code :
   * `notifyPerspectiveSwitch` now vacates the runner + drops orphaned locks
   * before the dispatch, so SOLO mid-anim switches are safe by construction
   * (parity with replay's always-cliquable seek). Kept as a public read
   * surface for diagnostic / debug snapshots only — pinned by the 4 specs in
   * `animation-orchestrator.projections.spec.ts` to prevent silent semantic
   * drift. If a future refactor needs an upstream board-stability gate, this
   * is still the right primitive to read.
   *
   * Built from REACTIVE signals (`isAnimating`) so a `[disabled]` binding reading
   * this refreshes the instant the runner stops. `isAnimating` subsumes the
   * non-reactive `rbs.hasLockedZones`: the runner's `finalizeAndCommit()`
   * commits every lock BEFORE `setRunning(false)` flips `isAnimating` off
   * (CLAUDE.md invariant), so `!isAnimating` already implies "no held locks".
   */
  get isBoardStableForSwitch(): boolean {
    return !this.isAnimating.value();
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
      isAnimating: this.isAnimating.value(),
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
   *   - the page-bootstrapped out-of-band sink (PvP page wires
   *     `wsService.attachOutOfBandSink`, replay page wires
   *     `adapter.attachOutOfBandSink`) for the types that bypass the
   *     queue by design (`MSG_CHAIN_NEGATED`, `SELECT_CARD`, synthetic
   *     `MSG_WIN` from `DUEL_END`, β.1 BoundaryEvents) — fed through a
   *     direct `pushToStream(ev)` call ;
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

  // ===========================================================================
  // β.3 projections (Lots 1-4, 2026-05-26)
  // ---------------------------------------------------------------------------
  // Each projection below is instantiated as a `readonly` field then
  // registered + attached in the constructor (search for
  // `scopeDispatcher?.register`). The `?.` is load-bearing: it lets the
  // unit-test suite construct the orchestrator without providing a
  // `ScopeResetDispatcher`. In production the DuelPageComponent's
  // providers list ALWAYS includes the dispatcher, so the register
  // calls fire — see `duel-page.component.ts` providers section.
  //
  // **β.3 checkpoint R3 mitigation (2026-05-26)**: if you spot a
  // projection registered without a matching `applyReset` branch in
  // its corresponding scope dispatch, the `?.` silently no-ops in the
  // unit-test path. The lint rule `pipeline-signal-tagged` catches
  // missing signals, NOT missing dispatcher registrations. Each
  // projection's spec covers `applyReset` directly without going
  // through the dispatcher, which proves the projection's reset
  // semantics independently of the wiring.
  // ===========================================================================

  /**
   * β.3 Lot 1b — first production `BaseProjection<T>` consumer of the
   * DEP flux. Tracks the set of `chainId`s for which the chain overlay
   * is allowed to appear; gated on `EffectReady('overlay-show:chain-<N>')`
   * from the DEP. Read by `pvp-chain-overlay.component.onNewChainLink`
   * to defer the `overlayVisible=true` set until the cost MSG_MOVE's
   * `AnimationCompleted` has landed on the stream. THIS is what makes
   * the cost-before-overlay test of victory visible in the UI.
   *
   * Auto-registered + attached to the event stream in the constructor
   * after the runner is wired (the registration goes through the same
   * `scopeDispatcher` as the DEP, so PERSPECTIVE_LIFETIME resets clear
   * it alongside the chain manager).
   */
  readonly overlayShowReady = new OverlayShowReadyProjection();

  /**
   * β.3 Lot 2.3 — pulse glow indicator for the counter badge on a card
   * whose counters just changed (MSG_ADD_COUNTER / MSG_REMOVE_COUNTER).
   * Cleared by the matching `AnimationCompleted` (wall-clock end of the
   * COUNTER_PULSE_MS hold) or by `applyReset` on §3.6 checkpoint cascades.
   * Reduced-motion gate is internal to the projection: it ignores the
   * event entirely when `ctx.reducedMotion()` is true, mirroring the
   * legacy handler's early-return.
   */
  readonly counterPulse = new CounterPulseProjection({
    relativePlayer: (abs: number) => this.ctx.relativePlayer(abs),
    reducedMotion: () => this.ctx.reducedMotion(),
  });

  /**
   * β.3 Lot 4.1-REDO — zone keys of FIELD cards currently being
   * targeted (MSG_BECOME_TARGET). Pile-zone targets (GY/Banished/
   * Extra) are handled separately by `TargetIndicatorManager`. The
   * projection self-sets on each MSG_BECOME_TARGET (accumulation /
   * union) and self-clears on `AnimationPhaseCompleted({phase:
   * 'reticle-pulse', msgType: 'MSG_BECOME_TARGET'})` emitted by the
   * handler via `phaseWait('reticle-pulse', holdMs, 'MSG_BECOME_TARGET')`
   * — the boundary between the reticle hold and the pile-float
   * fade-out (which itself outlives the field reticles).
   * Templates read `targetedZoneKeys.value()`.
   */
  readonly targetedZoneKeys = new TargetedZoneKeysProjection({
    relativePlayer: (abs: number) => this.ctx.relativePlayer(abs),
  });
  /**
   * β.3 Lot 2.4-REDO — pulse glow on `GY-rel` + `DECK-rel` zones
   * during the glow sub-phase of `MSG_SWAP_GRAVE_DECK`. Cleared by
   * `AnimationPhaseCompleted({phase: 'glow'})` emitted by the
   * handler via `phaseWait('glow', glowMs, 'MSG_SWAP_GRAVE_DECK')`
   * — the boundary between the glow phase and the travel phase.
   * Templates read `swapGraveDeckKeys.value()` directly.
   */
  readonly swapGraveDeckKeys = new SwapGraveDeckProjection({
    relativePlayer: (abs: number) => this.ctx.relativePlayer(abs),
    reducedMotion: () => this.ctx.reducedMotion(),
  });

  /**
   * C3 + C5 (2026-06-01) — registry of every `BaseProjection` attached to
   * `_eventStream`. Populated by `attachProjection` in the constructor
   * wiring block (one call per projection). `destroy()` iterates this list
   * to detach symmetrically, closing the C5 latent leak (missing
   * `targetedZoneKeys.detachEventStream()`) by construction: adding the 8th
   * projection means adding ONE `attachProjection` call, not three.
   *
   * The smoke spec walks the orchestrator instance via reflection and
   * asserts every own field that is `instanceof BaseProjection` appears in
   * this list — so a future field forgotten by `attachProjection` surfaces
   * as a red test instead of a silent effect leak.
   */
  private readonly _streamProjections: BaseProjection<unknown>[] = [];

  private get rbs() { return this.dataSource.renderedBoardState; }

  private scheduleTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(fn, ms);
    this.animationTimeouts.push(id);
    return id;
  }

  /**
   * β.3 Standardisation 1 (2026-05-26) — wait for a sub-phase duration,
   * then emit `AnimationPhaseCompleted({phase, msgType, ref})` on the
   * stream. Projections observing the phase boundary react via the
   * usual `applyEvent` path.
   *
   * **Contract**:
   * - `durationMs` is wall-clock; the caller is responsible for
   *   playback-speed scaling (typically via
   *   `ctx.scaledDuration(BASE, MIN)`) — symmetric with the runner's
   *   own `setTimeout` in `handleEntryAndAwait` which already gets
   *   already-scaled durations.
   * - `ref` is captured from `_transport_lastDispatchedRef` at the
   *   moment of emission (NOT at call time). The handler's body runs
   *   inside a single `processEvent` dispatch, so the side-channel is
   *   still pinned to the parent business event when `phaseWait`
   *   awaits — no race with a NEXT handler overwriting it (the
   *   runner waits for the handler's Promise to resolve before
   *   advancing).
   * - If `ref === null` (event was diverted / buffered), skip the
   *   emit — there's no parent ref to correlate with.
   *
   * **Cancellation**: the underlying setTimeout is tracked via
   * `scheduleTimeout` so `clearTimersAndPolling` aborts it on a hard
   * reset. The await still resolves naturally when the timer fires;
   * in the cancelled case the projection sees the phase event one
   * tick later (acceptable since the projection will be cleared by
   * the dispatcher in the same scope).
   */
  /**
   * β.3 Standardisation 2 (2026-05-26) — decorate LP-class messages
   * (`MSG_DAMAGE`, `MSG_RECOVER`, `MSG_PAY_LPCOST`) with `lpDelta:
   * { fromLp, toLp, durationMs }` so the `AnimatingLpProjection`
   * (Lot 2.2-REDO) can derive its visual state purely from the
   * flux, without duplicating the tracker's `trackedLp` map.
   *
   * Pure — never mutates the input event. Returns the input
   * unchanged for non-LP messages.
   *
   * The `peekLpDelta` is a pure read of the tracker's current state;
   * the subsequent `processLpEvent` (called from the dispatch switch)
   * re-derives the same values + applies the mutation. The two
   * methods agree by construction (single `_computeLpArithmetic`
   * helper since β.3 checkpoint R1 mitigation).
   *
   * **β.3 checkpoint R6 mitigation (2026-05-26)** — the returned
   * object is a SHALLOW CLONE with `lpDelta` added; the original
   * `event` arg is never mutated. Two callers retain a reference to
   * the ORIGINAL (without `lpDelta`):
   *   · `processEvent` keeps `event` for the dispatch switch (reads
   *     `event.type`, `event.player`, `event.amount` — the
   *     `lpDelta` field is purely for the stream / projection layer).
   *   · `processDirective.case 'lp'` keeps `entry.event` and passes
   *     it to `fireLpReplayEvent` (which also doesn't need
   *     `lpDelta`).
   * Any future caller that reads the event AFTER `pushToStream` sees
   * the ORIGINAL (the decorated clone exists only on `_eventStream`).
   */
  private decorateLpEventForStream(event: GameEvent): GameEvent {
    switch (event.type) {
      case 'MSG_DAMAGE': {
        const msg = event as DamageMsg;
        const lpDelta = this.lpTracker.peekLpDelta(msg.player, msg.amount, 'damage');
        return { ...msg, lpDelta } as GameEvent;
      }
      case 'MSG_RECOVER': {
        const msg = event as RecoverMsg;
        const lpDelta = this.lpTracker.peekLpDelta(msg.player, msg.amount, 'recover');
        return { ...msg, lpDelta } as GameEvent;
      }
      case 'MSG_PAY_LPCOST': {
        const msg = event as PayLpCostMsg;
        const lpDelta = this.lpTracker.peekLpDelta(msg.player, msg.amount, 'damage');
        return { ...msg, lpDelta } as GameEvent;
      }
      default:
        return event;
    }
  }

  private phaseWait(phase: string, durationMs: number, msgType: string): Promise<void> {
    const ref = this._transport_lastDispatchedRef;
    return new Promise<void>(resolve => {
      this.scheduleTimeout(() => {
        if (ref !== null && ref >= 0) {
          this.pushToStream({
            kind: 'animation', type: 'AnimationPhaseCompleted',
            phase, msgType, ref,
          });
        }
        resolve();
      }, durationMs);
    });
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
      getLastDispatchedRef: () => this._transport_lastDispatchedRef,
      processDirective: entry => this.processDirective(entry),
      applyInstantAnimation: ev => this.applyInstantAnimation(ev),
      consumeDeferredSolving: () => this.chainManager.consumeDeferredSolving(),
      preReplayBuffer: () => this.replayBuffer(true),
      preLockQueuedSources: () => this.moveRouter.preLockQueuedSources(),
      onStepSettled: (event, ref) => {
        this.lpTracker.commitIfPending();
        // β.3 Lot 2.6 — `animatingZone` projection clears itself when it
        // observes the `AnimationCompleted` pushed below for an event
        // whose msgType is in the FLIP/CHAIN/CHANGE_POS family.
        // β.3 — emit AnimationCompleted at the REAL wall-clock end of
        // the awaited step. Pair with the AnimationStarted that
        // `emitAnimationStarted` pushed synchronously at dispatch
        // time. `ref === -1` (back-compat sentinel) or `null`
        // side-channel means the event was diverted / buffered and
        // never reached the stream — skip emit.
        if (ref >= 0) {
          this.pushToStream({
            kind: 'animation', type: 'AnimationCompleted',
            ref, msgType: event.type,
          });
        }
      },
      onFinalize: () => {
        this.finalizeAndCommit();
        this.drawManager.resetHandAnimationState();
        // β.3 Lot 2.6 + 2.2-REDO — `animatingZone` AND
        // `animatingLpPlayerProjection` both clear themselves via
        // AnimationCompleted in `onStepSettled`. The legacy defensive
        // `set(null)` doubles here are redundant and removed.
        const state = this.rbs.logicalState();
        if (state.players.length === 2) {
          this.lpTracker.syncFromBoardState(state.players[0].lp, state.players[1].lp);
        }
      },
      onIsRunningChange: running => {
        // β.3 Lot 3.1 — the `isAnimating` projection self-tracks via
        // `runner-started` / `runner-stopped` on the stream. This
        // callback now only fires the imperative `setAnimating` on the
        // adapter (drives `advanceStep` in replay).
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
      if (this.isAnimating.value()) this.runner.notifyEnqueue();
    });
    // Wire draw manager queue resume callback
    this.drawManager.initQueueResumeCallback(() => this.runner.notifyEnqueue());

    // β.2a — auto-register the DEP with the scope-reset dispatcher so
    // STATE_SYNC / RematchStarted (DUEL_LIFETIME → cascades to
    // CONNECTION) abandon every pending deferred with
    // `EffectAbandoned(reason='checkpoint')`.
    this.scopeDispatcher.register(this.deferredProcessor);

    // C3 + C5 (2026-06-01) — symmetric register + attach for every
    // `BaseProjection`. `attachProjection` registers with the scope
    // dispatcher, attaches to `_eventStream`, AND pushes the projection
    // onto `_streamProjections` so `destroy()` can detach all 7 in one
    // loop. Adding the 8th projection means adding ONE call below, not
    // editing destroy() + 3 other sites.
    //
    // Order MUST stay: register first (so a checkpoint reset fired during
    // attach can reach the projection); attach next so `applyEvent`
    // drains DEP + boundary events pushed AFTER attach. Events pushed
    // BEFORE attach are missed by design (the projection starts clean;
    // an in-flight overlay-show from a pre-bootstrap chain is lost —
    // acceptable because chain-overlay's onChainEnd hides it on
    // MSG_CHAIN_END anyway).
    //
    // Inventory (see CLAUDE.md "Projections β.3 — inventory"):
    //   · overlayShowReady  — β.3 Lot 1b
    //   · counterPulse      — β.3 Lot 2.3 (PERSPECTIVE_LIFETIME, SOLO switchPlayer clears)
    //   · animatingZone     — β.3 Lot 2.6 (flip/activate field zone)
    //   · isAnimating       — β.3 Lot 3.1 (lifts runner._isRunning to §3.5)
    //   · swapGraveDeckKeys — β.3 Lot 2.4-REDO (glow sub-phase via phaseWait)
    //   · animatingLp       — β.3 Lot 2.2-REDO (lpTracker-owned but wired here for symmetry)
    //   · targetedZoneKeys  — β.3 Lot 4.1-REDO (reticle-pulse via phaseWait)
    this.attachProjection(this.overlayShowReady);
    this.attachProjection(this.counterPulse);
    this.attachProjection(this.animatingZone);
    this.attachProjection(this.isAnimating);
    this.attachProjection(this.swapGraveDeckKeys);
    this.attachProjection(this.lpTracker.animatingLpPlayerProjection);
    this.attachProjection(this.targetedZoneKeys);

    // F15 (2026-05-31) — `chain-resolution-announce` projection retired.
    // The state is now a single signal owned by `ChainResolutionManager`
    // (`chainResolutionAnnounce`), set sync by `markAnnouncePending` and
    // cleared in `reset()`/`handleEnd`. No stream observation needed;
    // the manager is already registered with the dispatcher (above) and
    // its `applyReset → reset()` chain covers the §3.6 cascade.
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
    // resetForReplaySeek / onStateSync / notifyPerspectiveSwitch) means
    // the next sequence starts fresh, replaying its own BOARD_STATE +
    // MSG_DRAW sequence. Carrying stale buffered events would mean the
    // rematch board flashes the previous duel's draws.
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
    // β.3 Lot 3.1 — `isAnimating` projection flips false via the
    // `runner-stopped` event that `runner.requestStop()` (called by
    // `clearTimersAndPolling` above) emits. The legacy
    // `_isAnimating.set(false)` line was redundant.
    this.chainManager.reset();
    this.lpTracker.reset();
    this.battleTracker.reset();
    this.gameLog.reset();
    // F12 (2026-05-31) — symmetric with the other ResetTarget managers
    // above. The dispatcher's auto-fire path covers production resets ;
    // this defensive call covers the explicit teardown.
    this.targetIndicator.reset();
    // β.2a — silent reset on hard teardown (mirrors BP.silentReset and
    // the orchestrator's intent for `destroy`). Drops timers + the
    // active map WITHOUT emitting `EffectAbandoned` — the stream
    // subscriber dies with the same scope so emitting closures would
    // only pollute a stream nobody reads.
    this.deferredProcessor.silentReset();
    // β.3 Lot 1b / C3 + C5 (2026-06-01) — detach every projection's
    // effect subscription in one loop. The injector's DestroyRef would
    // handle this implicitly on page teardown, but explicit detach
    // avoids relying on injector lifetime for a hard reset path. The
    // list IS the manifest — adding a projection means adding ONE
    // `attachProjection` call in the constructor wiring block; no
    // matching destroy edit needed. Closes the C5 latent leak
    // (`targetedZoneKeys.detachEventStream` was missing pre-C3 fix).
    for (const p of this._streamProjections) p.detachEventStream();
    this.drawManager.clearTimeouts();
    this.moveRouter.clearTimeouts();
    this.moveRouter.releaseAllPreLocks();
  }

  /**
   * C3 + C5 (2026-06-01) — atomic register + attach + track for a
   * `BaseProjection`. The 3 sites that used to live separately
   * (`scopeDispatcher.register`, `attachEventStream`, manual
   * `detachEventStream` in `destroy`) collapse into one call here:
   *   1. Register with the scope dispatcher.
   *   2. Attach to `_eventStream` so the projection drains via
   *      `applyEvent`.
   *   3. Track on `_streamProjections` so `destroy()` can detach all
   *      registered projections symmetrically.
   */
  private attachProjection(p: BaseProjection<unknown>): void {
    this.scopeDispatcher.register(p);
    p.attachEventStream(this._eventStream, this.injector);
    this._streamProjections.push(p);
  }

  /**
   * Shared reset logic for `notifyPerspectiveSwitch`, `resetForReplaySeek`
   * and `onStateSync`. Caller passes the scope set to dispatch — α.5
   * replaces what used to be manual chains of `chainManager.reset()` /
   * `lpTracker.reset()` / `battleTracker.reset()` with a single
   * `dispatcher.dispatch(scopes)` driven by the 4 ResetTarget managers'
   * declared scopes:
   *
   *   - `notifyPerspectiveSwitch` dispatches `{PERSPECTIVE_LIFETIME}` →
   *     hits Chain (declared PERSPECTIVE) + Battle (PERSPECTIVE) only.
   *     Lp + Log (DUEL_LIFETIME) survive the switch — the same duel
   *     viewed from either side must share LP state + journal. The
   *     duel-session-chantier §3.5 invalidation matrix is now
   *     mechanically enforced instead of relying on a comment that
   *     "the line must not be added back".
   *
   *     Behaviour change from pre-α.5: `LpAnimationTracker.reset()` is
   *     no longer called at SOLO switchPlayer. Safe because the BOARD_STATE
   *     that immediately follows the switch re-syncs `trackedLp` via
   *     `lpTracker.syncFromBoardState`, so the rendered LP values stay
   *     accurate. Mid-chain `_pendingLpCommits` now correctly survive the
   *     switch (cf. §3.5 LP scope rationale).
   *
   *   - `resetForReplaySeek` passes `{PERSPECTIVE_LIFETIME}` (LP tracker
   *     + journal preserved here — the journal is wiped explicitly by
   *     the caller `abortAndClean` before its `rebuildUpTo` re-feed).
   *   - `onStateSync` passes `{DUEL_LIFETIME}`
   *     → cascade hits all 4 managers (DUEL ⊃ CONNECTION ⊃ PERSPECTIVE).
   *     The journal is cleared via `gameLog.applyReset` so the incoming
   *     STATE_SYNC payload's `gameLogEntries` can repopulate from a clean
   *     slate (R8 rematch + F5 reconnect path), and replay seek rebuilds
   *     via `gameLogRebuildTick` → `rebuildUpTo([0..currentIndex])`. No
   *     explicit `gameLog?.reset()` needed after the shared helper.
   *
   * Non-ResetTarget cleanups (drawManager, moveRouter, toastService,
   * transient signal sets) stay as explicit chains here — they aren't
   * projection state, so they don't participate in the dispatcher.
   * β.3+ will revisit which of these become projections.
   *
   * F12 (2026-05-31) — `targetIndicator` removed from that list: it
   * now `implements ResetTarget` and is dispatched alongside the
   * `targetedZoneKeys` projection (its FIELD-side equivalent).
   */
  private resetAllState(scopes: ReadonlySet<ScopeCategory>): void {
    this.clearTimersAndPolling();
    // β.3 Lot 3.1 — `isAnimating` projection flips false via the
    // `runner-stopped` event emitted by `clearTimersAndPolling →
    // runner.requestStop()` above + via scopeDispatcher applyReset
    // below (PERSPECTIVE_LIFETIME scope).
    this.drawManager.reset();
    this.drawManager.clearTimeouts();
    // β.3 Lot 2.6 — `animatingZone` projection cleared via the
    // scopeDispatcher.dispatch below (PERSPECTIVE_LIFETIME scope).
    this.finalizeAndCommit();
    // F19 (2026-05-31) — assert lock state at the reset boundary BEFORE
    // commitAll() wipes everything inconditionally. `finalizeAndCommit`
    // above runs the queue's `commitUnlocked` path; any zone still locked
    // here means a `lockZone` was never paired. Throws in dev, console.errors
    // in prod via duelAssert — the alternative is `commitAll` silently
    // covering the leak.
    //
    // v3 Phase 4 (2026-06-04) — the `tolerateLocks` skip is removed.
    // `clearTimersAndPolling` above calls `runner.requestStop()` which
    // now (Phase 3) calls `rbs.dropOrphanedLocks('runner-requestStop')`
    // — the locks a user-triggered seek mid-animation legitimately
    // leaves behind are cleared THERE. The assert here can be strict
    // again : any survivor at this point is a real bug (a lock taken
    // OUTSIDE the runner's loop scope, i.e. not covered by the runner
    // abort + drop). The 3 sibling sites in `replay-duel-adapter.ts`
    // are equally strict by construction.
    this.rbs.assertNoLocks('resetAllState');
    this.rbs.commitAll();
    this.scopeDispatcher.dispatch(scopes);
    this.moveRouter.clearTimeouts();
    this.moveRouter.releaseAllPreLocks();
    // F12 (2026-05-31) — `targetIndicator.reset()` removed from this
    // chain : the manager now `implements ResetTarget` and registers
    // itself with the scope dispatcher (PERSPECTIVE_LIFETIME scope),
    // so the `dispatch(scopes)` call above already drives its cleanup.
    // The explicit call here was the dette pointed at by the audit
    // (would have leaked floats had a future caller dispatched without
    // hitting this method). Defense-in-depth `reset()` stays in
    // `destroy()` below, mirroring the other `ResetTarget` managers.
    // β.3 Lot 2.3 + 2.4-REDO + 4.1-REDO — `counterPulse` +
    // `swapGraveDeckKeys` + `targetedZoneKeys` projections clear
    // themselves via `applyReset` driven by the scopeDispatcher.dispatch
    // above (PERSPECTIVE_LIFETIME scope).
    this.toastService.clear();
    // β.2a note + β.3 red-team finding #5 (2026-05-26) — any
    // `EffectAbandoned(checkpoint)` emitted by the DEP during
    // `dispatch(scopes)` above lands here BEFORE the wipe, so the
    // journal subscriber's effect (one task) only sees the final empty
    // array. Bénin by accident at β.3: the projections that DO consume
    // EffectAbandoned (e.g. OverlayShowReadyProjection's graceful-
    // degradation fallback) receive their own `applyReset` immediately
    // after the DEP's in the same `dispatch`, so their state is clean
    // even if the EffectAbandoned event is lost.
    //
    // Backlog: see `_bmad-output/planning-artifacts/beta-3-backlog.md`
    // §"Finding #5". Triggers for re-priorisation: a future projection
    // that LEGITIMATELY needs to observe `EffectAbandoned(checkpoint)`
    // (not just as fallback) — at which point a 2-pass dispatch +
    // manual stream-effect flush will be required.
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
   *   · the page bootstrap (duel-page / replay-page) wires this as the
   *     out-of-band sink on `wsService.attachOutOfBandSink` /
   *     `adapter.attachOutOfBandSink` for events that bypass the
   *     animation queue by design : `MSG_CHAIN_NEGATED` (processor
   *     onEvent), `SELECT_CARD` (PvP prompt routing), synthetic
   *     `MSG_WIN` (PvP DUEL_END reconstruction), β.1 `BoundaryEvent`s
   *     (BoundaryProcessor emissions) ;
   *   · `QueueRunner.onInternalEvent` sink (β.2a — α.3 runner
   *     `InternalTransportEvent`s, absorbed onto the stream so the DEP
   *     observes transport state alongside WS messages).
   * Does NOT touch `dataSource.animationQueue()` — invariant
   * "`MSG_CHAIN_NEGATED` is NOT enqueued" stays true.
   *
   * γ-c cleanup F-1.2 (audit) — made public, replacing the
   * `notifyOutOfBandEvent` wrapper which was a transparent pipe.
   * Out-of-band sink callers now invoke `pushToStream` directly.
   */
  pushToStream(event: StreamEvent): number {
    const ref = this._transport_nextStreamRef++;
    this._eventStream.update(s => [...s, event]);
    // U16 (2026-06-01) — propagate the DEP's `{absorbed}` flag. A
    // `RewriterRule` (today only `xyzLeaveWithMaterials`) that matches the
    // event via `chainTo` consumes it: the routing aval (`processEvent`
    // dispatch switch) MUST skip the per-type handler and the journal MUST
    // skip the ingest. Both surfaces read `isAbsorbed(event)`. The event
    // stays on `_eventStream` so DEP-driven projections (deferred markers,
    // animation lifecycle pair) keep observing a complete history.
    const { absorbed } = this.deferredProcessor.observe(event, ref);
    if (absorbed) tagAsAbsorbed(event);
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
   * β.3 — emit `AnimationStarted({ref, msgType})` synchronously after
   * `processEvent` returns. The matching `AnimationCompleted` is
   * emitted by the runner's `onStepSettled` callback at the REAL
   * wall-clock end of the awaited step (Promise.race resolve or
   * setTimeout fire). This is the alignment the cost-before-overlay
   * test of victory needs — sync emission would fire EffectReady
   * immediately and the overlay would pop the same frame as the
   * MSG_CHAINING, defeating the whole point.
   *
   * β.2b history: emitted BOTH events synchronously. Worked for the
   * DEP-side test (relative order is correct) but the user-perceived
   * timing was wrong because EffectReady fired the same frame as the
   * cost MSG_MOVE. β.3 splits the pair: AnimationStarted stays sync,
   * AnimationCompleted moves to onStepSettled.
   *
   * No-op if the side-channel is `null` (buffered / divert / no
   * push happened).
   */
  private emitAnimationStarted(msgType: string): void {
    const ref = this._transport_lastDispatchedRef;
    if (ref === null) return;
    this.pushToStream({ kind: 'animation', type: 'AnimationStarted', ref, msgType });
  }


  /**
   * γ commit 5 — émission de `PerspectiveSwitched(from, to)` sur le
   * flux + dispatch `applyReset({PERSPECTIVE_LIFETIME})` via
   * `ScopeResetDispatcher`. Source UNIQUE de reset PERSPECTIVE_LIFETIME
   * pour le SOLO orchestrator. La méthode `resetForReplaySeek` (F27
   * renaming) est réservée au replay seek (cf. son docblock) — le
   * rematch SOLO compte sur `onStateSync({DUEL_LIFETIME})` (post-review
   * B1, 2026-05-28).
   *
   * Ordering garanti (cf. §4.5 spec) :
   *   1. `pushToStream` écrit l'event sur `_eventStream` (atomique).
   *   2. Le `BaseProjection.attachEventStream` `effect()` voit le
   *      nouvel event sur le tick suivant et le passe à `applyEvent`
   *      (chaque projection narrow via `kind === 'perspective'`).
   *   3. `scopeDispatcher.dispatch({PERSPECTIVE_LIFETIME})` est appelé
   *      ici SYNCHRONEMENT, après le `pushToStream`. Tous les
   *      `ResetTarget` registered (cf. CLAUDE.md "Orchestrator
   *      Decomposition" + α.4b) reçoivent `applyReset` ; les
   *      projections PERSPECTIVE_LIFETIME (BattleAnimationTracker,
   *      TargetIndicatorManager [F12, 2026-05-31],
   *      animatingLpPlayer, targetedZoneKeys, swapGraveDeckKeys,
   *      animatingZone, counterPulse, isAnimating,
   *      chainResolutionAnnounce, overlayShowReady) reset au passage.
   *
   * Déclenche désormais (v3 Phase 5, 2026-06-05) :
   *   · `clearTimersAndPolling()` en tête → `runner.requestStop()` →
   *     `dropOrphanedLocks('runner-requestStop')` (Phase 3 wire).
   *   · `RenderedBoardStateService` (locks) — vacated par dropOrphanedLocks.
   *     Pré-Phase-5 ce bullet était dans la liste "Ne déclenche PAS" ;
   *     Phase 5 a CHANGÉ ça intentionnellement. Tout lock tenu par un
   *     handler async en vol au moment du switch est droppé synchrone,
   *     le `.then(commit, release)` post-abort hit le zombie-safe path
   *     (Option G, af3195fa, idempotent).
   *   · `_postRequestStopWindow` (Phase 1 instrumentation) ouvert par
   *     `requestStop`, fermé eagerly à la fin de la méthode (P2 follow-up,
   *     2026-06-05) pour éviter qu'il reste ouvert pendant WAITING_RESPONSE.
   *   · `_preActivationBuffer` cleared par `clearTimersAndPolling`. Le
   *     toolbar button est gaté sur `roomState() === 'active'` côté
   *     composant (P1 follow-up, 2026-06-05) pour empêcher le wipe
   *     accidentel pendant la fenêtre bootstrap.
   *
   * Ne déclenche PAS (CONNECTION_LIFETIME ou plus haut, par construction) :
   *   · `DuelEventProcessor` (activeChainLinks, chainPhase, pendingChainEntry, buffer)
   *   · `DeferredEffectProcessor` (pas d'`EffectAbandoned` — cf. §3.7bis
   *     chantier ; le DEP est CONNECTION_LIFETIME, son scope `applyReset`
   *     ne s'active qu'à STATE_SYNC / Rematch)
   *   · `LpAnimationTracker.trackedLp + _pendingLpCommits` (DUEL_LIFETIME)
   *   · `DuelGameLogService` (DUEL_LIFETIME — R10 acté §8 : journal réactif
   *     au render, l'historique re-flippe You/Opponent au switch sans
   *     reset du contenu)
   *   · `BoundaryProcessor` (CONNECTION_LIFETIME, pas de `forceClosure`
   *     parce qu'un switch n'est pas un checkpoint)
   *
   * Doctrine : la "parité descendante" (spec anim-pipeline-v3-abort-safety
   * §"Décisions ouvertes", ligne 314) prescrit que SOLO converge vers
   * replay. Replay's `togglePerspective` n'a pas de gate amont — SOLO
   * suit, et la safety devient structurelle via cette méthode au lieu
   * d'être un gate amont.
   *
   * Garde-fou contre un futur 2ᵉ caller : le script CI
   * `scripts/check-perspective-isolation.mjs` (introduit γ-c post-review
   * M10, 2026-05-28) vérifie statiquement que `SoloDuelOrchestratorService`
   * est seul caller — si un nouveau site devait notifier sans vouloir
   * le clear, il faudrait extraire le reset transition dans une méthode
   * séparée et adapter la liste `ALLOWED_PROD` du script.
   */
  notifyPerspectiveSwitch(from: 0 | 1, to: 0 | 1): void {
    // v3 Phase 5 — vacate runner + locks BEFORE the dispatch. The cascade
    // `runner.requestStop → dropOrphanedLocks` (Phase 3) clears any lock
    // held by an in-flight handler whose travel Promise was abandoned by
    // `_abort.abort()`. The handler's `.then(commit, release)` still fires
    // post-cleanup but hits the zombie-safe `commit()` path (Option G,
    // af3195fa) which is idempotent. The subsequent `pushToStream` +
    // `dispatch(PERSPECTIVE_LIFETIME)` see a clean lock map ; the caller
    // (`SoloDuelOrchestratorService.switchPerspective`) then re-feeds the
    // cached absolute board state via `conn.onPerspectiveSwitched()` →
    // `syncRendered()` which lands the target state on the next tick.
    this.clearTimersAndPolling();
    this.pushToStream({
      kind: 'perspective',
      type: 'PerspectiveSwitched',
      from,
      to,
    });
    // Dispatch reset PERSPECTIVE_LIFETIME. Source UNIQUE de reset
    // PERSPECTIVE-scoped depuis la transition B1 (2026-05-28) qui a
    // retiré le pre-reset rematch via l'ancien `resetForSwitch`. Le
    // rematch SOLO compte désormais sur `onStateSync({DUEL_LIFETIME})`
    // qui suit immédiatement le REMATCH_STARTING (handler unique).
    this.scopeDispatcher.dispatch(new Set<ScopeCategory>(['PERSPECTIVE_LIFETIME']));
    // v3 Phase 5-bis follow-up (2026-06-05, P2) — close the
    // post-requestStop instrumentation window eagerly. The window was
    // opened by `clearTimersAndPolling → runner.requestStop` above
    // (Phase 1 instrumentation : track lockZone calls between requestStop
    // and the next legitimate notifyEnqueue). Without this eager close,
    // if the worker is in WAITING_RESPONSE post-switch, no fresh event
    // arrives → `notifyEnqueue` never fires → the window stays open
    // until the next message (minutes potentially). The dispatch above
    // does NOT take locks (it touches scope-resettable projections only),
    // and any subsequent legitimate lock arrives via a fresh
    // `notifyEnqueue` which will re-close the window anyway. Closing
    // here keeps the Phase 1 instrumentation's signal value intact :
    // a `[v3-instr]` warn during the WAITING_RESPONSE window now means
    // an actual out-of-band lock taker, not a stale window.
    this.dataSource.renderedBoardState.setPostRequestStopWindow(false);
    this.logger.log(DuelLogCategory.PIPELINE,
      'notifyPerspectiveSwitch %d → %d → dispatch({PERSPECTIVE_LIFETIME})', from, to);
  }

  /**
   * Hard reset triggered by a replay seek (the unique caller :
   * `ReplayPageComponent.abortAndClean`). Dispatches
   * `{PERSPECTIVE_LIFETIME}` — clears the volatile slice (chain
   * resolution banner / replay timers, battle + target indicators,
   * `animatingLpPlayer`, in-progress attack) without touching the
   * LP tracker's `trackedLp` (DUEL_LIFETIME). The caller restores
   * the journal explicitly via `gameLog.reset()` immediately after,
   * since DUEL is not cascaded.
   *
   * F27 (2026-05-31) — renamed from `resetForSwitch`. Initially also
   * widened scope to `{DUEL_LIFETIME}` on the rationale that a seek
   * is "causally a checkpoint", but post-merge adversarial review
   * (2026-06-01) showed the widening introduces a real desync : the
   * DUEL cascade resets `trackedLp` to `[STARTING_LP, STARTING_LP]`,
   * and `requestStop` aborts BEFORE `onFinalize` would re-prime the
   * tracker via `syncFromBoardState`. The next `peekLpDelta` post-
   * seek reads `fromLp = 8000` instead of the real LP at the target
   * state. Reverted to PERSPECTIVE here ; the journal wipe stays
   * explicit at the caller site (DRY enough for a single caller).
   *
   * SOLO PvP perspective switch does NOT go through this method — it
   * goes through `notifyPerspectiveSwitch` which dispatches
   * `{PERSPECTIVE_LIFETIME}` as well (LP + journal survive a switch
   * on the same duel). The two paths share semantics by design.
   */
  resetForReplaySeek(): void {
    this.logger.log(DuelLogCategory.QUEUE, 'resetForReplaySeek — clearing all state & timeouts');
    // v3 Phase 4 (2026-06-04) — the `tolerateLocks=true` skip is gone.
    // Phase 3's `runner.requestStop() → dropOrphanedLocks()` (driven by
    // `clearTimersAndPolling` inside `resetAllState`) clears the locks
    // a user-triggered seek mid-animation legitimately leaves behind.
    // `assertNoLocks('resetAllState')` is now strict again — a survivor
    // at the assert site signals a real bug in a lock taker outside
    // the runner's loop scope.
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

    // β.3 — emit AnimationStarted sync after dispatch; AnimationCompleted
    // is emitted by the runner's `onStepSettled` callback at the REAL
    // wall-clock end of the awaited step. This split is what makes the
    // cost-before-overlay test of victory land correctly: EffectReady
    // arrives at the moment the user actually sees the cost finish, not
    // the same frame as the MSG_CHAINING. Buffered events skip the wrap
    // because the side-channel is null.
    this.emitAnimationStarted(event.type);

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
        // β.3 — capture each event's stream ref synchronously after its
        // processEvent push, so AnimationCompleted can be emitted per
        // event after the group's Promise.all resolves. Sync emission
        // of AnimationCompleted (right after processEvent) would defeat
        // the wall-clock alignment the cost-before-overlay fix needs.
        const pendingCompletions: Array<{ event: GameEvent; ref: number }> = [];
        for (let i = 0; i < entry.events.length; i++) {
          if (i > 0 && entry.staggerMs) {
            await new Promise<void>(r => setTimeout(r, entry.staggerMs));
          }
          const result = this.processEvent(entry.events[i]);
          const rlabel = result instanceof Promise ? 'Promise' : result === 'async' ? 'async' : `${result}`;
          this.trace('groupEvent', { type: entry.events[i].type, result: rlabel, idx: i });
          this.emitAnimationStarted(entry.events[i].type);
          const ref = this._transport_lastDispatchedRef;
          if (ref !== null) pendingCompletions.push({ event: entry.events[i], ref });
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
        // β.3 — emit AnimationCompleted for every event in the group
        // AFTER Promise.all resolves. DEP rules awaiting an
        // AnimationCompleted with a specific ref now fire at the real
        // wall-clock end of the group's animations.
        for (const { event, ref } of pendingCompletions) {
          this.pushToStream({
            kind: 'animation', type: 'AnimationCompleted',
            ref, msgType: event.type,
          });
        }
        // β.3 Lot 2.6 + 2.2-REDO — `animatingZone` and
        // `animatingLpPlayerProjection` both clear themselves on the
        // AnimationCompleted events emitted above.
        return 'continue';
      }
      case 'barrier':
        this.trace('directive', { kind: 'barrier' });
        await this.drawManager.awaitDrawsComplete();
        this.rbs.commitUnlocked();
        return 'continue';
      case 'lp': {
        this.trace('directive', { kind: 'lp' });
        // β.3 Lot 2.2-REDO — buffered LP replay path needs to feed the
        // projection too. Decorate + push to the stream first (so the
        // projection picks up the LP delta), THEN mutate via the
        // tracker. Order matters: `peekLpDelta` inside
        // `decorateLpEventForStream` reads the PRE-mutation trackedLp.
        const decorated = this.decorateLpEventForStream(entry.event);
        const ref = this.pushToStream(decorated);
        this._transport_lastDispatchedRef = ref;
        this.lpTracker.fireLpReplayEvent(entry.event);
        // β.3 red-team finding #2 (2026-05-26) — the directive path
        // returns 'continue' without going through `handleEntryAndAwait`,
        // so the `QueueRunner.onStepSettled` callback (which emits
        // `AnimationCompleted` for the standard dispatch path) never
        // fires for buffered LP. Without this, `AnimatingLpProjection._data`
        // stayed set indefinitely after a buffered LP event — visually
        // harmless (the badge's RAF stops at t>=1) but contract-broken.
        //
        // Emit `AnimationStarted` synchronously and `AnimationCompleted`
        // after a setTimeout matching the LP count duration. The
        // decorator stashes the duration on the event under `lpDelta`
        // (β.3 Standardisation 2); peek it for the timer length and
        // fall back to the tracker's `baseLpDuration` if absent
        // (defensive — should not happen since `decorateLpEventForStream`
        // always populates it for LP-class messages).
        if (ref !== null && ref >= 0) {
          const msgType = entry.event.type;
          this.emitAnimationStarted(msgType);
          const lpDelta = (decorated as GameEvent & { lpDelta?: { durationMs?: number } }).lpDelta;
          const durationMs = lpDelta?.durationMs ?? this.lpTracker.baseLpDuration;
          this.scheduleTimeout(() => {
            this.pushToStream({
              kind: 'animation', type: 'AnimationCompleted',
              ref, msgType,
            });
          }, durationMs);
        }
        return 'continue';
      }
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
      case 'announcement': {
        // β.3 cas #13 (2026-05-26) — sequential-announcement-gating. Affiche
        // une annonce visuelle (phase / chain resolution / future banners).
        // Deux modes:
        //   · `nonBlocking: true` (phase announces) — `onShow` synchrone,
        //     `onClear` schedulé via setTimeout, runner continue
        //     immédiatement. La draw animation peut ainsi jouer en
        //     parallèle avec le banner DRAW.
        //   · `nonBlocking: false | undefined` (chain banner) — gate la
        //     queue: `prePauseMs` puis `onShow`, attente `showMs`,
        //     `onClear`, return 'continue'.
        // Les deux timers passent par `scheduleTimeout` (tracked dans
        // `animationTimeouts`) pour qu'un `clearTimersAndPolling`
        // (rematch / state-sync / destroy) les coupe.
        const totalMs = this.ctx.scaledDuration(entry.durationMs);
        const preMs = entry.prePauseMs ? this.ctx.scaledDuration(entry.prePauseMs) : 0;
        const showMs = Math.max(0, totalMs - preMs);
        this.trace('directive', { kind: 'announcement', source: entry.source, totalMs, preMs, nonBlocking: !!entry.nonBlocking });
        if (entry.nonBlocking) {
          // Non-blocking path: schedule onShow (after prePauseMs) and
          // onClear (after totalMs) via setTimeout, return immediately so
          // the runner advances to the next entry without waiting.
          if (preMs === 0) {
            entry.onShow();
          } else {
            this.scheduleTimeout(() => entry.onShow(), preMs);
          }
          this.scheduleTimeout(() => entry.onClear(), totalMs);
          return 'continue';
        }
        if (preMs > 0) {
          await new Promise<void>(resolve => { this.scheduleTimeout(resolve, preMs); });
        }
        entry.onShow();
        try {
          await new Promise<void>(resolve => {
            this.scheduleTimeout(resolve, showMs);
          });
        } finally {
          entry.onClear();
        }
        return 'continue';
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
    //
    // β.3 Standardisation 2 (2026-05-26) — decorate LP messages with
    // `lpDelta: { fromLp, toLp, durationMs }` BEFORE the push. The
    // `peekLpDelta` is pure (reads `trackedLp` without mutating); the
    // subsequent `processLpEvent` in the dispatch switch re-derives the
    // same values and applies the mutation. Decoration is a shallow
    // clone — the original event arg is never mutated, so any caller
    // that retained a reference still sees the original shape.
    const eventToPush = this.decorateLpEventForStream(event);
    this._transport_lastDispatchedRef = this.pushToStream(eventToPush);

    // U16 (2026-06-01) — skip the dispatch switch when the just-pushed
    // event was absorbed by a DEP `RewriterRule`. The stream entry is
    // already in place (DEP / projections observe it); the lifecycle pair
    // (`AnimationStarted` / `AnimationCompleted`) is emitted by the normal
    // path (`_dispatchEvent.emitAnimationStarted` after this returns +
    // `QueueRunner.onStepSettled` after the 0ms hold settles). Returning
    // 0 short-circuits any animation work — the rule has already played
    // the equivalent visual via its synthesized virtual MSG_MOVEs.
    if (isAbsorbed(eventToPush)) {
      this.logger.log(DuelLogCategory.PROC, 'Absorbed by DEP rewriter, skipping dispatch %s', event.type);
      return 0;
    }

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
    // β.3 Lot 2.6 — `animatingZone` projection observes this MSG via
    // the EventStream `pushToStream` tap and sets itself. Handler only
    // owns runtime side-effects (a11y announce + duration return).
    const zoneId = locationToZoneId(msg.location, msg.sequence);
    if (zoneId) {
      this.ctx.announceEvent('Card flip summoned', msg.player);
    }
    return POSITION_FLIP_MS;
  }

  private handleChangePos(msg: ChangePosMsg): number | Promise<void> | 0 {
    const wasFaceDown = (msg.previousPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
    const nowFaceUp = (msg.currentPosition & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
    if (wasFaceDown && nowFaceUp) {
      // β.3 Lot 2.6 — `animatingZone` projection self-sets on this msg
      // (narrowed on the face-down → face-up branch).
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
      // β.3 Lot 2.6 — `animatingZone` projection self-sets on this msg.
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
      // β.3 cas #13 (2026-05-26) — sequential-announcement-gating. The
      // multi-link chain banner is now expressed as an `announcement`
      // directive prepended right after this handler returns. The
      // directive blocks the dispatch of the deferred MSG_CHAIN_SOLVING
      // (which sits in `_deferredSolvingEvent`) until the banner clears
      // — the OLD `CHAIN_BANNER_DEFERRED_BUDGET_MS` hold no longer
      // gates it. Timing inside the directive :
      //   t=0..prePauseMs : silent pause (chain entry visible, no banner).
      //   t=prePauseMs    : onShow flips `_announcePending` (sync mirror)
      //                     + emits `AnimationPhaseCompleted` so the
      //                     `chainResolutionAnnounce` projection
      //                     (templates + Effect D) flips reactive.
      //   t=durationMs    : onClear emits `MSG_CHAIN_END`-shaped flux NO,
      //                     just resets the mirror. The projection clears
      //                     on the next MSG_CHAIN_END.
      // The single source of timing replaces the previous (handler hold
      // + phaseWait + scheduleBannerAnnounce) trio.
      const pauseMs = CHAIN_BANNER_PAUSE_MS;
      this.dataSource.prependToQueue([{
        kind: 'announcement',
        source: 'chain-resolution',
        durationMs: CHAIN_BANNER_DEFERRED_BUDGET_MS,
        prePauseMs: pauseMs,
        onShow: () => {
          // F15 (2026-05-31) — single `markAnnouncePending` call now
          // sets the unified `_announcing` signal on the manager,
          // observed reactively by templates / Effect D and read
          // synchronously by `handleSolving`'s predicate. The prior
          // `pushToStream(AnimationPhaseCompleted phase=banner-announce)`
          // was the only producer of that event ; its sole consumer
          // (`ChainResolutionAnnounceProjection`) is retired, so the
          // push is unreachable and removed.
          this.chainManager.markAnnouncePending();
        },
        // The signal self-clears in `chainManager.reset()` (triggered by
        // `handleEnd` on MSG_CHAIN_END and by the scope dispatcher's
        // applyReset cascade). onClear is a no-op so the banner stays
        // visible until the chain naturally ends.
        onClear: () => undefined,
      }]);
      return 0;
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
    return CHAIN_END_SETTLE_MS;
  }

  private handleBecomeTarget(msg: BecomeTargetMsg): number {
    // β.3 Lot 4.1-REDO — `targetedZoneKeys` projection observes this MSG
    // via the EventStream `pushToStream` tap and self-sets (union over
    // FIELD locations only). Handler keeps the pile-float side-effect +
    // a11y announce + the `phaseWait` that clears the field reticles
    // at the pulse boundary (before the pile-float fade-out, which
    // outlives the reticles).
    this.targetIndicator.spawnPileFloats(msg);
    const holdMs = BECOME_TARGET_PULSE_MS * this.ctx.speedMultiplier();
    // Fire-and-forget: the projection self-clears on the emitted
    // AnimationPhaseCompleted event. The runner waits `holdMs` (last
    // MSG) or `TARGET_PILE_FLOAT_STAGGER_MS` (non-last) via the
    // numeric return below — symmetric with the legacy setTimeout
    // that lived inline.
    void this.phaseWait('reticle-pulse', holdMs, 'MSG_BECOME_TARGET');
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

  private handleCounter(_msg: AddCounterMsg | RemoveCounterMsg): number {
    // β.3 Lot 2.3 — pulse signal owned by `counterPulse` projection, fed
    // from the EventStream `pushToStream` tap. The handler only owns the
    // RUNTIME side: returning the hold duration so the runner waits
    // before emitting AnimationCompleted (which clears the pulse).
    // reducedMotion gate stays here to keep the runner's hold at 0 — the
    // projection's own reducedMotion gate handles the visual side.
    if (this.ctx.reducedMotion()) return 0;
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

  private async processSwapGraveDeckEvent(msg: SwapGraveDeckMsg): Promise<void> {
    // β.3 Lot 2.4-REDO — `swapGraveDeckKeys` projection self-sets on
    // MSG_SWAP_GRAVE_DECK via the EventStream tap. Reduced-motion gate
    // mirrored on both sides (here for runtime short-circuit; in the
    // projection for the visual side). Handler keeps the lock + travel
    // orchestration and emits `AnimationPhaseCompleted({phase:'glow'})`
    // via `phaseWait` to clear the pulse at the glow→travel boundary.
    if (this.ctx.reducedMotion()) return;
    const rel = this.ctx.relativePlayer(msg.player);
    const gyKey = `GY-${rel}`;
    const deckKey = `DECK-${rel}`;

    const glowMs = this.ctx.scaledDuration(SWAP_GRAVE_DECK_GLOW_MS, SWAP_GRAVE_DECK_GLOW_MIN_MS);
    const travelMs = this.ctx.scaledDuration(SWAP_GRAVE_DECK_TRAVEL_MS, SWAP_GRAVE_DECK_TRAVEL_MIN_MS);

    const lockGy = this.rbs.lockZone(gyKey);
    const lockDeck = this.rbs.lockZone(deckKey);

    // Phase 1: glow pulse — projection clears itself on AnimationPhaseCompleted.
    await this.phaseWait('glow', glowMs, 'MSG_SWAP_GRAVE_DECK');
    // Phase 2: single travel DECK→GY (card back) — GY update implied by commit.
    try {
      await this.cardTravelEngine.travel(deckKey, gyKey, '', { duration: travelMs, showBack: true });
      lockGy.commit();
      lockDeck.commit();
    } catch {
      lockGy.release();
      lockDeck.release();
    }
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
