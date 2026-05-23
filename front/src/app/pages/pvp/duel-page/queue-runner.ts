// =============================================================================
// queue-runner.ts — Palier A of the QueueRunner extraction chantier (2026-05-23)
// -----------------------------------------------------------------------------
// Extracted from AnimationOrchestratorService.{_processAnimationQueueInner,
// processAnimationQueue, decideNextStep}. Owns the async loop, the 5 lifecycle
// primitives (_isProcessing, _innerLoopDepth, _resetGeneration,
// _rescueNoProgressCount, _lastRescueQueueLen), the per-step wait (setTimeout
// + guardTimer Promise.race), and the `case 'finalize'` mechanics. Business
// dispatch lives in the orchestrator and is reached through injected
// callbacks; the runner never knows about YGO message types.
//
// Design notes:
//   · `_isRunning` is the runner's internal flag; the orchestrator's exposed
//     `_isAnimating` signal is synchronised via `onIsRunningChange`. This keeps
//     the public façade stable while isolating the loop's lifecycle.
//   · The runner owns the per-step setTimeout (`_stepTimeout`) and the travel
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
  /** Per-step settle hook — runs after every awaited step (LP commit + zone reset). */
  onStepSettled: () => void;
  /** Finalize hook — runs in the `case 'finalize'` branch BEFORE `onIsRunningChange(false)`. */
  onFinalize: () => void;
  /** Signal-runner-state changes back to the orchestrator (exposed `isAnimating`). */
  onIsRunningChange: (running: boolean) => void;
  /** Reads the decision inputs that depend on orchestrator state (commitMode, prompt, …). */
  decisionInputs: () => Omit<QueueDecisionInputs, 'queue'>;
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

  // --- Lifecycle primitives (the 5 ad-hoc safety primitives, now scoped) ---
  private _isRunning = false;
  /** Re-entry guard for `processAnimationQueue` (multiple sync callers). */
  private _isProcessing = false;
  /** Detects parallel re-entry of `_processAnimationQueueInner` (audit finding C4). */
  private _innerLoopDepth = 0;
  /** Bumped by `requestStop()`; the inner loop bails on mismatch. */
  private _resetGeneration = 0;
  /** Anti-runaway: counts consecutive rescues that made NO progress. */
  private _rescueNoProgressCount = 0;
  private _lastRescueQueueLen = -1;

  // --- Internal timers owned by the runner ---
  /** Per-step `setTimeout` (millisecond hold returned by `handleEntry`). */
  private _stepTimeouts: ReturnType<typeof setTimeout>[] = [];
  /** Per-step Promise.race guard against travels that never resolve. */
  private _guardTimer: ReturnType<typeof setTimeout> | null = null;
  /** Active await-signal effect (cleared by `requestStop()`). */
  private _awaitSignalEffect: EffectRef | null = null;

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
   * Notify the runner that new events were enqueued. Launches the loop if
   * idle. Idempotent — a re-entry while running is a no-op (the existing
   * loop will pick up the new events on its next tick).
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
    }
  }

  /**
   * Request the runner to stop and invalidate any in-flight inner loop.
   * Stale loops bail on their generation check. Called by the orchestrator's
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
    // Invalidate any suspended inner loop — it will see the bumped generation
    // on resume and bail.
    this._resetGeneration++;
    // Reset re-entry depth. A reset can land while a loop is suspended on an
    // `await`; that loop's `finally { _innerLoopDepth-- }` has not run yet,
    // so the counter is stale at 1. Zeroing here + the `Math.max(0, …)`
    // floor in the inner-loop finally keeps it balanced across resets.
    this._innerLoopDepth = 0;
    this.setRunning(false);
    this.trace('requestStop', { resetGeneration: this._resetGeneration });
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
    const generation = this._resetGeneration;
    this._processAnimationQueueInner().finally(() => {
      // A reset (seek / sub-event click) superseded this run — its feed
      // already started a fresh loop. Touching _isProcessing or the rescue
      // here would race that fresh loop, so this stale finally is inert.
      if (this._resetGeneration !== generation) return;
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
      if (this._isRunning) this.processAnimationQueue();
      else this.notifyEnqueue();
    });
  }

  private async _processAnimationQueueInner(): Promise<void> {
    this._innerLoopDepth++;
    duelAssert(
      this._innerLoopDepth <= 1,
      '_processAnimationQueueInner',
      `Parallel re-entry detected (depth=${this._innerLoopDepth}). The _isProcessing `
      + `finalize block opened a window where a second async loop started before the first finished (audit finding C4).`,
    );
    // Capture the reset generation at entry. Any reset (seek / sub-event
    // click / resetForSwitch) during an `await` bumps it; the guard at the
    // top of each loop turn then bails this now-stale loop instead of
    // letting it race the fresh one started by the post-reset feed.
    const generation = this._resetGeneration;
    try {
      while (this._isRunning) {
        if (this._resetGeneration !== generation) {
          this.deps.logger.log(DuelLogCategory.QUEUE,
            'inner loop bailing — reset generation changed (%d → %d), a seek/abort superseded this run',
            generation, this._resetGeneration);
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

        this.deps.logger.log(DuelLogCategory.QUEUE,
          'decideNextStep — action=%s queueLen=%d ownPlayer=%d',
          step.action, this.deps.dataSource.animationQueue().length, this.deps.ctx.ownPlayerIndex());
        this.deps.logger.log(DuelLogCategory.RUNNER,
          'tick action=%s isResolving=%s queueLen=%d isWaitingForOverlay=%s commitMode=%s',
          step.action, inputs.isResolving, this.deps.dataSource.animationQueue().length,
          inputs.isWaitingForOverlay, inputs.commitMode);

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
      this.deps.onStepSettled();
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

    this.deps.onStepSettled();
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
  }

  private trace(action: string, detail?: Record<string, unknown>): void {
    this.deps.logger.log(DuelLogCategory.RUNNER,
      '[RUNNER] %s gen=%d depth=%d %o',
      action, this._resetGeneration, this._innerLoopDepth, detail ?? {});
  }
}
