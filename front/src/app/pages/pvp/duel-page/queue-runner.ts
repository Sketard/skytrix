// =============================================================================
// queue-runner.ts — QueueRunner extraction chantier (paliers A + B + C, 2026-05-23)
// -----------------------------------------------------------------------------
// Extracted from AnimationOrchestratorService.{_processAnimationQueueInner,
// processAnimationQueue, decideNextStep}. Owns the async loop, the lifecycle
// primitives (`_isRunning`, `_isProcessing`, `_innerLoopDepth`, `_abort`,
// `_rescueNoProgressCount`, `_lastRescueQueueLen`), the per-step wait
// (setTimeout + guardTimer Promise.race), and the `case 'finalize'` mechanics.
// Business dispatch lives in the orchestrator and is reached through injected
// callbacks; the runner never knows about YGO message types.
//
// Design notes:
//   · `_isRunning` is the runner's internal flag; the orchestrator's exposed
//     `_isAnimating` signal is synchronised via `onIsRunningChange`. This keeps
//     the public façade stable while isolating the loop's lifecycle.
//   · Palier C — the maison `_resetGeneration` token was replaced by a
//     standard `AbortController`. `requestStop()` calls `_abort.abort()` and
//     installs a fresh controller; suspended inner loops check
//     `abortSignal.aborted` after each `await` and bail cleanly. Single
//     semantic concept (signal lifecycle) replacing the integer-bump
//     comparison.
//   · The runner owns the per-step setTimeout (`_stepTimeouts`) and the travel
//     `Promise.race` guard timer (`_guardTimer`) — both cleared by
//     `requestStop()`. The orchestrator's `animationTimeouts[]` registry
//     (handler-level timers, e.g. equip lines, board effects) does NOT migrate.
//   · `handleEntry` is the seam between mechanic and business. The orchestrator
//     returns the raw `EventResult` synchronously (`number | 'async' |
//     Promise<void>`) without awaiting; the runner owns the awaiting. This
//     gives us exactly one place where step duration is measured.
// =============================================================================

import { effect, EffectRef, Injector } from '@angular/core';
import type { DuelContext } from './duel-context';
import { DuelLogCategory, type DuelLogger } from './duel-logger';
import type { AnimationDataSource, QueueDirective, QueueEntry } from './animation-data-source';
import type { InternalTransportEvent } from './queue-runner-events';
import type { GameEvent } from '../types';
import {
  LOCK_SAFETY_TIMEOUT_MS, QUEUE_COLLAPSE_KEEP, QUEUE_COLLAPSE_THRESHOLD,
  RESCUE_NO_PROGRESS_CEILING,
} from './animation-constants';
import type { PollDropWatchdog } from './poll-drop-watchdog';
import { duelAssert } from '../../../core/utilities/duel-assert';

/**
 * Discrete actions returned by `QueueRunner.decideNextStep`. Drives the
 * dispatcher inside `_processAnimationQueueInner`.
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
 * Snapshot of inputs consumed by the pure `decideNextStep` function. The
 * dispatcher reads signals + internal state once per tick and passes them as
 * plain values; tests construct the object directly.
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

/** Synchronous result of `handleEntry` — the runner awaits this itself. */
export type EventResult = number | 'async' | Promise<void>;

/** Cap on how many `onInternalEvent` sink-throw warnings are emitted before
 *  the runner suppresses further logging from the same misbehaving consumer. */
const SINK_THROW_WARN_LIMIT = 5;

/**
 * Dependencies injected by the orchestrator at QueueRunner construction.
 * Every callback is invoked from inside the loop — none of them may
 * touch the runner's lifecycle flags. The runner is the single source of
 * truth for `_isRunning` and the 5 lifecycle primitives.
 */
export interface QueueRunnerDeps {
  dataSource: AnimationDataSource;
  pollDropWatchdog: PollDropWatchdog;
  ctx: DuelContext;
  logger: DuelLogger;
  injector: Injector;
  /**
   * Business dispatch for a queued `GameEvent`. MUST be synchronous in the
   * sense of "do not await"; if the event needs to suspend the queue, it
   * returns a `Promise<void>` (travel), `'async'` (draw / overlay wait), or
   * a number (millisecond hold) — the runner owns the awaiting.
   * `'divert'` means the event was parked outside the queue (pre-activation
   * buffer) and the runner should drop it without further processing.
   */
  handleEntry: (event: GameEvent) => EventResult | 'divert';
  /**
   * β.3 — returns the stream ref the orchestrator assigned to the most
   * recent `handleEntry` call, or `null` if the event was diverted /
   * buffered and never pushed to the stream. The runner reads this
   * AFTER `handleEntry` returns and forwards it to `onStepSettled` so
   * the orchestrator can emit `AnimationCompleted({ref, msgType})` at
   * the real wall-clock end of the awaited step.
   * Defaults to `() => null` (back-compat — pre-β.3 deps work but
   * `onStepSettled` receives `ref=-1` which the orchestrator's emit
   * helper treats as "skip emit").
   */
  getLastDispatchedRef?: () => number | null;
  /** Directive dispatch (`group`, `barrier`, `lp`, `batch-end`, `await-signal`). */
  processDirective: (entry: QueueDirective) => Promise<'continue' | 'pause'>;
  /** Collapse-mode side effect — applied per dropped event without animating. */
  applyInstantAnimation: (event: GameEvent) => void;
  /** Acknowledge the deferred-solving peek held by `ChainResolutionManager`. */
  consumeDeferredSolving: () => void;
  /** Mid-chain pre-replay-buffer dispatch (used by the `pre-replay-buffer` branch). */
  preReplayBuffer: () => Promise<void>;
  /** Pre-lock pass before every tick — the runner calls this once per loop turn. */
  preLockQueuedSources: () => void;
  /**
   * Per-step settle hook — runs after every awaited step (LP commit +
   * zone reset).
   *
   * β.3 — receives the `event` and `ref` of the business event whose
   * await just resolved. Lets the orchestrator emit
   * `AnimationCompleted({ref, msgType})` at the REAL wall-clock end of
   * the travel/timer (not synchronously at dispatch time like β.2b did).
   * The DEP can then close `EffectReady` at the moment the user
   * actually sees the cost finish — which is what the cost-before-overlay
   * test of victory requires for the visual to land correctly.
   *
   * `ref` is the stream ref the orchestrator assigned at
   * `pushToStream(event)`; the runner does not own a counter, it
   * forwards whatever the dispatcher captured at handleEntry time.
   */
  onStepSettled: (event: GameEvent, ref: number) => void;
  /** Finalize hook — runs in the `case 'finalize'` branch BEFORE `onIsRunningChange(false)`. */
  onFinalize: () => void;
  /** Signal-runner-state changes back to the orchestrator (exposed `isAnimating`). */
  onIsRunningChange: (running: boolean) => void;
  /** Reads the decision inputs that depend on orchestrator state (commitMode, prompt, …). */
  decisionInputs: () => Omit<QueueDecisionInputs, 'queue'>;
  /**
   * α.3 — optional sink for `InternalTransportEvent`s describing the
   * runner's lifecycle transitions (start / stop / rescue fired /
   * rescue abandoned / watchdog armed). Stays optional so existing
   * callers compile unchanged; the orchestrator wires it in α.5 to
   * push the events onto the duel's `eventStream` (cf.
   * duel-session-chantier.md §3.3). The runner never blocks on the
   * sink — emission is fire-and-forget.
   */
  onInternalEvent?: (event: InternalTransportEvent) => void;
}

/**
 * Pure decision step for the queue loop. Given a snapshot of inputs, returns
 * the next action to take. No side effects, no signal reads, no mutations —
 * entirely testable in isolation. The dispatcher in `_processAnimationQueueInner`
 * owns side effects (dequeue, trace, setTimeout, await handleEntry, etc.) and
 * is driven by the action returned here.
 */
export function decideNextStep(input: QueueDecisionInputs): QueueStep {
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
  //
  // F-bugB4 (2026-05-31) — EXCEPTION: when the queue head is an
  // `announcement` directive AND a deferred-solving event is pending,
  // dispatch the directive first. This is the head of the chain-resolution
  // banner sequence (β.3 cas #13, commit bb30c4bc): `handleChainSolving`
  // both (a) stashes the MSG_CHAIN_SOLVING into `_deferredSolvingEvent`
  // and (b) prepends an `announcement` directive whose `onShow` callback
  // flips `_announcePending = true`. Without this exception, the deferred
  // entry would win priority → `consume-deferred` → re-call
  // `handleChainSolving` → `_announcePending` is still false (directive
  // never dispatched) → the guard re-deferreds the same event → infinite
  // loop (the queue grows by one re-prepended directive per tick, the
  // deferred slot is set→consumed→re-set forever). Dispatching the
  // directive first lets `_announcePending` flip, breaking the guard on
  // the next consume-deferred tick. Pure GameEvent heads keep the
  // deferred-first priority (the pinning test `dequeue priority` covers
  // that path).
  if (
    input.deferredSolvingEntry !== null
    && input.queue.length > 0
    && 'kind' in input.queue[0]
    && (input.queue[0] as { kind: string }).kind === 'announcement'
  ) {
    return { action: 'dequeue', entry: input.queue[0] };
  }
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
  return { action: 'finalize' };
}

/**
 * Async animation queue runner. Plain class, instantiated privately by
 * `AnimationOrchestratorService`. The runner is the single source of truth
 * for the loop's lifecycle (`_isRunning` + the 5 primitives).
 */
export class QueueRunner {
  private readonly deps: QueueRunnerDeps;

  // --- Lifecycle primitives ---
  // α.3 (2026-05-25) — these 5 primitives are the runner's transport
  // state in the §3.2 sense. Their **scope is PERSPECTIVE_LIFETIME**:
  // every `requestStop()` (which a `PerspectiveSwitched` triggers via
  // the orchestrator) zeros them and installs a fresh `AbortController`.
  // None of them are read by UI templates; none of them are projections.
  // Names kept un-renamed (no `_transport_*` prefix) — file is on the
  // α.1 lint baseline and α.7 will revisit the renaming pass.
  private _isRunning = false;
  /** scope: PERSPECTIVE_LIFETIME. Re-entry guard for `processAnimationQueue`
   *  (multiple sync callers in the same microtask batch). NOT the same as
   *  the abort signal: this is a sync mutex preventing two
   *  `_processAnimationQueueInner` calls from starting in the same turn;
   *  the abort signal preserves ordering across reset boundaries (palier C). */
  private _isProcessing = false;
  /** scope: PERSPECTIVE_LIFETIME. Detects parallel re-entry of
   *  `_processAnimationQueueInner` (audit finding C4). Palier C kept this
   *  as a runtime invariant assertion — with `AbortController` it should
   *  never trip in practice, but it surfaces a regression if it does. */
  private _innerLoopDepth = 0;
  /**
   * scope: PERSPECTIVE_LIFETIME. Palier C — replaces the maison
   * `_resetGeneration` token. A suspended inner loop checks
   * `_abort.signal.aborted` after each `await`; an abort throws (via
   * `throwIfAborted()`), the loop's finally cleans up, and the post-reset
   * fresh start gets a brand-new `AbortController` so its own `aborted`
   * check stays false. Single semantic concept (signal lifecycle) replacing
   * the integer-bump comparison.
   */
  private _abort = new AbortController();
  /** scope: PERSPECTIVE_LIFETIME. Anti-runaway: counts consecutive rescues
   *  that made NO progress. */
  private _rescueNoProgressCount = 0;
  private _lastRescueQueueLen = -1;

  // --- Internal timers owned by the runner ---
  /** Per-step `setTimeout` (millisecond hold returned by `handleEntry`). */
  private _stepTimeouts: ReturnType<typeof setTimeout>[] = [];
  /** Per-step Promise.race guard against travels that never resolve. */
  private _guardTimer: ReturnType<typeof setTimeout> | null = null;
  /** Active await-signal effect (cleared by `requestStop()`). */
  private _awaitSignalEffect: EffectRef | null = null;

  // --- emitInternal defense-in-depth (P2) ---
  /** Re-entry guard: true while a sink callback is running on this thread.
   *  Prevents recursive emit if a sink (or its logger path) re-emits. */
  private _emittingInternal = false;
  /** Total sink-throw count for warn rate-limit (see `SINK_THROW_WARN_LIMIT`). */
  private _sinkThrowCount = 0;

  constructor(deps: QueueRunnerDeps) {
    this.deps = deps;
  }

  /** True when the runner is running (drives the orchestrator's exposed
   *  `isAnimating` façade). */
  isRunning(): boolean {
    return this._isRunning;
  }

  /** True when an inner loop is currently processing — used by the inline
   *  `replayBuffer(false)` path in the orchestrator to skip relaunching. */
  isProcessing(): boolean {
    return this._isProcessing;
  }

  /**
   * Notify the runner that new events were enqueued OR that a previously
   * suspended async handler is ready to resume. Two reactivation states:
   *  · `!_isRunning`        → start a fresh animation cycle.
   *  · `_isRunning && !_isProcessing` → relaunch the inner loop inside the
   *    existing cycle. This is the "stuck-but-empty queue" state an
   *    `'async'`-returning handler leaves behind: the inner loop returned,
   *    the .finally rescue early-returned because queueLen===0, but the
   *    cycle is still open and someone (drawManager.resumeQueueIfSafe,
   *    chainManager.resumeEffect, ...) is signaling that its async work is
   *    done. Without this branch the runner stalls forever — master used
   *    to handle this implicitly because `initQueueResumeCallback` routed
   *    to the private `processAnimationQueue` (guarded only on
   *    `_isProcessing`); after palier A everything routes here. Verified
   *    by the debug-replay harness on a8859c98 (2026-05-23).
   * Idempotent in both branches — the re-entry guard inside
   * `processAnimationQueue` (`_isProcessing` check) keeps multiple sync
   * callers safe.
   */
  notifyEnqueue(): void {
    this.trace('notifyEnqueue', {
      isRunning: this._isRunning,
      isProcessing: this._isProcessing,
      queueLen: this.deps.dataSource.animationQueue().length,
    });
    // Any new event arrival means the chain progressed — disarm the
    // POLL-DROP REGRESSION watchdog. Even when _isRunning is already true
    // (re-entry from another caller), the watchdog might have been armed
    // by an earlier finalize that has since been superseded.
    this.deps.pollDropWatchdog.clear();
    if (!this._isRunning) {
      this.setRunning(true);
      // Pre-lock all animated zones before first commitUnlocked — centralized
      // for both PvP and replay so cards don't appear at their destination
      // before the travel animation plays.
      this.deps.preLockQueuedSources();
      this.processAnimationQueue();
      return;
    }
    // _isRunning=true but the inner loop has exited (typically an 'async'
    // handler whose awaited work is now resolving). Re-enter the loop so
    // it can advance, finalize, or rescue depending on queue + decision
    // inputs. processAnimationQueue's own `_isProcessing` guard makes this
    // a no-op when the loop is genuinely active.
    if (!this._isProcessing) {
      this.processAnimationQueue();
    }
  }

  /**
   * Request the runner to stop and invalidate any in-flight inner loop.
   * Palier C: `_abort.abort()` is the single semantic point — any suspended
   * `_processAnimationQueueInner` resumes from its `await` and throws via
   * `throwIfAborted()`, which the loop's finally converts into a silent
   * cleanup. A fresh `AbortController` is installed for the next run so its
   * own `aborted` check stays false. Called by the orchestrator's
   * `clearTimersAndPolling`.
   */
  requestStop(): void {
    this.clearTimers();
    this.deps.pollDropWatchdog.clear();
    this._awaitSignalEffect?.destroy();
    this._awaitSignalEffect = null;
    this._isProcessing = false;
    this._rescueNoProgressCount = 0;
    this._lastRescueQueueLen = -1;
    // Abort any suspended inner loop and install a fresh controller so the
    // next run starts uncontaminated.
    this._abort.abort();
    this._abort = new AbortController();
    // Reset re-entry depth. A reset can land while a loop is suspended on an
    // `await`; that loop's `finally { _innerLoopDepth-- }` has not run yet,
    // so the counter is stale at 1. Zeroing here + the `Math.max(0, …)`
    // floor in the inner-loop finally keeps it balanced across resets.
    this._innerLoopDepth = 0;
    this.setRunning(false);
    this.trace('requestStop', { aborted: true });
  }

  /** Clear the runner's internal timers (per-step hold + travel guard). */
  private clearTimers(): void {
    for (const t of this._stepTimeouts) clearTimeout(t);
    this._stepTimeouts = [];
    if (this._guardTimer !== null) {
      clearTimeout(this._guardTimer);
      this._guardTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  /**
   * Entry point — guards against re-entry from multiple callers (await-signal
   * effect, notifyEnqueue, postFinalize rescue).
   */
  private processAnimationQueue(): void {
    if (this._isProcessing || !this._isRunning) return;
    this._isProcessing = true;
    // Capture the current AbortController at entry. If a reset happens
    // mid-await, `requestStop()` installs a fresh controller — this finally
    // block detects the swap by reference comparison and stays inert (the
    // fresh run has already taken over).
    const myAbort = this._abort;
    this._processAnimationQueueInner(myAbort.signal).finally(() => {
      // A reset (seek / sub-event click) superseded this run — its feed
      // already started a fresh loop. Touching _isProcessing or the rescue
      // here would race that fresh loop, so this stale finally is inert.
      if (this._abort !== myAbort) return;
      this._isProcessing = false;
      const queueLen = this.deps.dataSource.animationQueue().length;
      if (queueLen === 0) {
        this._rescueNoProgressCount = 0;
        this._lastRescueQueueLen = -1;
        return;
      }
      // Skip rescue when the inner loop paused on a legitimate wait — the
      // overlay-ready effect (isWaitingForOverlay) and draws-complete
      // callback (hasDrawsInFlight) own the resume. A rescue here retriggers
      // the inner loop's early return in a tight microtask loop, starving
      // the setTimeout-based animations that would clear the wait.
      const inputs = this.deps.decisionInputs();
      if (inputs.isWaitingForOverlay || inputs.hasDrawsInFlight) return;
      // Anti-runaway: if the queue has not shrunk since the last rescue,
      // re-launching cannot help — a seek/abort race left undispatchable
      // entries, or the inner loop returns early every tick. Count the
      // no-progress rescues; past the ceiling, bail with a warn instead
      // of spinning the microtask queue forever ("infinite rescue").
      if (queueLen >= this._lastRescueQueueLen && this._lastRescueQueueLen !== -1) {
        this._rescueNoProgressCount++;
      } else {
        this._rescueNoProgressCount = 0;
      }
      this._lastRescueQueueLen = queueLen;
      if (this._rescueNoProgressCount > RESCUE_NO_PROGRESS_CEILING) {
        this.deps.logger.warn('[ANIM:QUEUE] rescue abandoned — %d no-progress passes, queueLen=%d. '
          + 'A seek/abort likely raced the queue; the next user action (seek, play) re-syncs.',
          this._rescueNoProgressCount, queueLen);
        this.emitInternal({ kind: 'rescue-abandoned', queueLen, at: Date.now() });
        this._rescueNoProgressCount = 0;
        this._lastRescueQueueLen = -1;
        return;
      }
      // Rescue cases for a stalled queue:
      //  (a) onIsRunningChange(false) in the inner loop synchronously triggered
      //      advanceStep → feedTransition → enqueue. The effect that calls
      //      notifyEnqueue can fire before this finally block, sees
      //      _isProcessing=true and bails — so we re-enter here.
      //  (b) An 'async'-returning event handler whose awaited work resolved
      //      synchronously (e.g. MSG_CONFIRM_CARDS for a non-HAND card)
      //      called resumeQueueIfSafe() → processAnimationQueue() while
      //      _isProcessing was still true (microtask race). That call was a
      //      silent no-op and nothing else will relaunch the queue — rescue here.
      this.trace('postFinalize', { action: 'rescued-stall', queueLen });
      this.emitInternal({
        kind: 'rescue-fired',
        queueLen,
        noProgressCount: this._rescueNoProgressCount,
        at: Date.now(),
      });
      if (this._isRunning) this.processAnimationQueue();
      else this.notifyEnqueue();
    });
  }

  private async _processAnimationQueueInner(abortSignal: AbortSignal): Promise<void> {
    this._innerLoopDepth++;
    duelAssert(
      this._innerLoopDepth <= 1,
      '_processAnimationQueueInner',
      `Parallel re-entry detected (depth=${this._innerLoopDepth}). The _isProcessing `
      + `finalize block opened a window where a second async loop started before the first finished (audit finding C4).`,
    );
    try {
      while (this._isRunning) {
        // Palier C — single abort check at the top of each turn. A reset
        // (`requestStop`) calls `_abort.abort()` and the abortSignal we
        // captured at entry flips to `aborted=true`. Throws synchronously;
        // the outer try/finally cleans up `_innerLoopDepth`.
        if (abortSignal.aborted) {
          this.deps.logger.log(DuelLogCategory.QUEUE,
            'inner loop bailing — abort signal raised, a seek/abort superseded this run');
          return;
        }
        // Pre-lock pass is a non-decisional side effect: it must run before
        // the dispatcher reads the queue so locks for queued sources are in
        // place when downstream branches commit/dequeue.
        this.deps.preLockQueuedSources();

        const inputs = this.deps.decisionInputs();
        const step = decideNextStep({
          ...inputs,
          queue: this.deps.dataSource.animationQueue(),
        });

        if (this.deps.logger.isEnabled(DuelLogCategory.QUEUE)) {
          this.deps.logger.log(DuelLogCategory.QUEUE,
            'decideNextStep — action=%s queueLen=%d ownPlayer=%d',
            step.action, this.deps.dataSource.animationQueue().length, this.deps.ctx.ownPlayerIndex());
        }
        if (this.deps.logger.isEnabled(DuelLogCategory.RUNNER)) {
          this.deps.logger.log(DuelLogCategory.RUNNER,
            'tick action=%s isResolving=%s queueLen=%d isWaitingForOverlay=%s commitMode=%s',
            step.action, inputs.isResolving, this.deps.dataSource.animationQueue().length,
            inputs.isWaitingForOverlay, inputs.commitMode);
        }

        switch (step.action) {
          case 'pause-external':
            return;

          case 'collapse': {
            for (let i = 0; i < step.collapseCount; i++) {
              const entry = this.deps.dataSource.dequeueAnimation();
              if (entry && !('kind' in entry)) this.deps.applyInstantAnimation(entry);
            }
            continue;
          }

          case 'consume-deferred': {
            this.deps.consumeDeferredSolving();
            const flow = await this.handleEntryAndAwait(step.entry);
            if (flow === 'return') return;
            continue;
          }

          case 'dequeue': {
            const entry = this.deps.dataSource.dequeueAnimation()!;
            if ('kind' in entry) {
              const directiveResult = await this.deps.processDirective(entry);
              if (directiveResult === 'pause') return;
              continue;
            }
            const flow = await this.handleEntryAndAwait(entry);
            if (flow === 'return') return;
            continue;
          }

          case 'pre-replay-buffer': {
            // Mid-chain pre-replay: prompt is waiting and buffer non-empty.
            // preReplayBuffer prepends directives + clears overlay wait;
            // the next loop tick dequeues them via the 'dequeue' branch.
            await this.deps.preReplayBuffer();
            continue;
          }

          case 'finalize': {
            // INVARIANT (CLAUDE.md): finalizeAndCommit() MUST run BEFORE
            // setAnimating(false). In replay, setAnimating(false) triggers
            // advanceStep() → updateLogical() with the next state. Committing
            // first ensures we use the current state.
            this.trace('queueEmpty', { action: 'finalize' });
            // POLL-DROP REGRESSION watchdog — arm BEFORE finalize so a
            // reset-during-finalize chain (rare but possible if LP sync
            // triggers a sync handler) clears it correctly. The dropped poll
            // mechanism would have engaged here while chainPhase === 'resolving';
            // this watchdog catches stalls.
            if (this.deps.dataSource.chainPhase() === 'resolving') {
              this.deps.pollDropWatchdog.arm();
              this.emitInternal({ kind: 'watchdog-armed', at: Date.now() });
            }
            this.deps.onFinalize();
            // Clear _isProcessing BEFORE setRunning(false) — the call may
            // synchronously trigger advanceStep → feedTransition → enqueue,
            // and the queue watcher effect may fire in the same microtask batch.
            // If _isProcessing is still true, notifyEnqueue is a no-op
            // and the queue stalls.
            this._isProcessing = false;
            this.setRunning(false);
            const postFinalizeQueue = this.deps.dataSource.animationQueue().length;
            if (postFinalizeQueue > 0) {
              this.trace('postFinalize', { queueLen: postFinalizeQueue });
              this.setRunning(true);
              this._isProcessing = true; // re-acquired for the continue
              continue;
            }
            return;
          }
        }
      }
    } finally {
      // Floor at 0 — `requestStop` may have already zeroed the counter while
      // this loop was suspended on an `await`, in which case a bare `--` would
      // go negative and corrupt the next assert.
      this._innerLoopDepth = Math.max(0, this._innerLoopDepth - 1);
    }
  }

  /**
   * Dispatch a queued entry to the orchestrator's business handler, then
   * await whatever result it returned (Promise / async / millisecond hold).
   * The runner owns the awaiting so step duration is measured in one place.
   * Returns 'return' when the loop must exit (`'async'` result), 'continue'
   * otherwise.
   */
  private async handleEntryAndAwait(event: GameEvent): Promise<'continue' | 'return'> {
    const result = this.deps.handleEntry(event);

    if (result === 'divert') {
      // Event was parked outside the queue (pre-activation buffer). Drop it.
      return 'continue';
    }

    // β.3 — capture the stream ref synchronously, RIGHT after handleEntry
    // returned (the orchestrator's side-channel `_transport_lastDispatchedRef`
    // is overwritten by the NEXT handleEntry, so we must snapshot it now).
    // Forwarded to `onStepSettled` after the await resolves.
    const ref = this.deps.getLastDispatchedRef?.() ?? -1;

    const resultLabel = result instanceof Promise ? 'Promise' : result === 'async' ? 'async' : `${result}ms`;
    this.trace('handleEntry', { type: event.type, result: resultLabel });

    if (result === 'async') {
      this.trace('asyncReturn', { type: event.type, reason: 'draw/overlay' });
      return 'return';
    }

    if (result instanceof Promise) {
      this.trace('promiseReturn', { type: event.type, reason: 'travel' });
      // Safety guard: warn + force-resume if a travel never resolves. The
      // setTimeout must be cleared once `result` wins the race, otherwise it
      // keeps firing on every long-running animation and floods the console
      // with false "Travel promise never resolved" warnings even when the
      // animation finished cleanly (regression observed pre-2026-05-18).
      const guard = new Promise<void>(resolve => {
        this._guardTimer = setTimeout(() => {
          this._guardTimer = null;
          this.deps.logger.warn('Travel promise never resolved for %s — forcing queue continue', event.type);
          resolve();
        }, this.deps.ctx.safetyTimeout(LOCK_SAFETY_TIMEOUT_MS));
      });
      try {
        await Promise.race([result, guard]);
      } finally {
        if (this._guardTimer !== null) {
          clearTimeout(this._guardTimer);
          this._guardTimer = null;
        }
      }
      this.deps.onStepSettled(event, ref);
      return 'continue';
    }

    // Numeric result — millisecond hold.
    const speedMultiplier = this.deps.ctx.speedMultiplier();
    const adjustedDuration = Math.round(result * speedMultiplier);
    this.deps.logger.log(DuelLogCategory.QUEUE,
      'type=%s → setTimeout(%dms)', event.type, adjustedDuration);

    if (adjustedDuration > 0) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          const idx = this._stepTimeouts.indexOf(timeout);
          if (idx !== -1) this._stepTimeouts.splice(idx, 1);
          resolve();
        }, adjustedDuration);
        this._stepTimeouts.push(timeout);
      });
    }

    this.deps.onStepSettled(event, ref);
    return 'continue';
  }

  /**
   * Install an `await-signal` effect — the directive dispatcher (still
   * orchestrator-side) calls this when it receives an `await-signal`
   * directive whose predicate is currently false. When the signal flips
   * true, the effect destroys itself and re-launches the queue.
   *
   * Returns true if the signal was already truthy (no effect installed);
   * the caller (`processDirective`) then immediately returns 'continue'.
   */
  installAwaitSignal(signal: () => boolean): boolean {
    if (signal()) return true;
    // Defense-in-depth: by contract there is only one active await-signal at
    // a time, but if a prior effect was somehow still in place (e.g. a
    // signal flip raced its own destroy), drop it before installing the new
    // one — otherwise the orphan effect survives + leaks.
    this._awaitSignalEffect?.destroy();
    this._awaitSignalEffect = effect(() => {
      if (signal()) {
        this._awaitSignalEffect?.destroy();
        this._awaitSignalEffect = null;
        this.processAnimationQueue(); // re-entry guarded by _isProcessing (now false from finally)
      }
    }, { injector: this.deps.injector });
    return false;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private setRunning(running: boolean): void {
    if (this._isRunning === running) return;
    this._isRunning = running;
    this.deps.onIsRunningChange(running);
    this.emitInternal(running
      ? { kind: 'runner-started', at: Date.now() }
      : { kind: 'runner-stopped', at: Date.now() });
  }

  /**
   * Forward an {@link InternalTransportEvent} to the optional sink. Fire-
   * and-forget by contract: sink exceptions are swallowed so the runner's
   * own loop is never destabilised by a misbehaving consumer.
   *
   * Defense-in-depth (code-review #2 finding P2):
   *   - Re-entry guard: if `emitInternal` is already on the stack (sink
   *     re-emits or its logger re-enters), we drop the nested call instead
   *     of recursing.
   *   - Sink-throw warn rate-limit: a sink that throws on every event
   *     (broken wiring) would otherwise flood the warn channel — log only
   *     the first ~SINK_THROW_WARN_LIMIT failures and a single summary.
   */
  private emitInternal(event: InternalTransportEvent): void {
    const sink = this.deps.onInternalEvent;
    if (!sink) return;
    if (this._emittingInternal) return;
    this._emittingInternal = true;
    try {
      sink(event);
    } catch (err) {
      this._sinkThrowCount++;
      if (this._sinkThrowCount <= SINK_THROW_WARN_LIMIT) {
        this.deps.logger.warn('[RUNNER] onInternalEvent sink threw (#%d): %o',
          this._sinkThrowCount, err);
        if (this._sinkThrowCount === SINK_THROW_WARN_LIMIT) {
          this.deps.logger.warn(
            '[RUNNER] onInternalEvent sink threw %d times — suppressing further warnings',
            SINK_THROW_WARN_LIMIT);
        }
      }
    } finally {
      this._emittingInternal = false;
    }
  }

  private trace(action: string, detail?: Record<string, unknown>): void {
    // CLAUDE.md "What NOT to instrument" — bind expensive payloads behind
    // `logger.isEnabled(cat)` checks so the call site cost (signal-getter +
    // object literal) is paid only when the category is on.
    if (!this.deps.logger.isEnabled(DuelLogCategory.RUNNER)) return;
    this.deps.logger.log(DuelLogCategory.RUNNER,
      '[RUNNER] %s aborted=%s depth=%d %o',
      action, this._abort.signal.aborted, this._innerLoopDepth, detail ?? {});
  }
}
