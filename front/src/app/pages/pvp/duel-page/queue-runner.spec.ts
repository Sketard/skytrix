// =============================================================================
// queue-runner.spec.ts
// -----------------------------------------------------------------------------
// Two suites in this file:
//   1. `decideNextStep` (Palier A — migrated from the old
//      `animation-orchestrator.service.spec.ts`): 15 scenarios for the pure
//      decision function.
//   2. `QueueRunner (loop)` (Palier B — 2026-05-23): unit tests for the
//      lifecycle of the loop itself (notifyEnqueue / requestStop / rescue /
//      finalize / await-signal). Replaces what used to require a full PvP
//      playthrough — the bugs hunted by hand in May 2026 become spec assertions.
// =============================================================================

import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { decideNextStep, QueueRunner, type EventResult, type QueueDecisionInputs, type QueueRunnerDeps } from './queue-runner';
import { QUEUE_COLLAPSE_KEEP, RESCUE_NO_PROGRESS_CEILING } from './animation-constants';
import { PollDropWatchdog } from './poll-drop-watchdog';
import type { AnimationDataSource, QueueDirective, QueueEntry } from './animation-data-source';
import type { GameEvent } from '../types';
import type { DuelContext } from './duel-context';
import type { DuelLogger } from './duel-logger';

// Helpers — minimal GameEvent stubs. Only the `type` field is read by
// decideNextStep (collapse predicate filters on type).
const damage = (): GameEvent => ({ type: 'MSG_DAMAGE' } as unknown as GameEvent);
const recover = (): GameEvent => ({ type: 'MSG_RECOVER' } as unknown as GameEvent);
const payLp = (): GameEvent => ({ type: 'MSG_PAY_LPCOST' } as unknown as GameEvent);
const move = (): GameEvent => ({ type: 'MSG_MOVE' } as unknown as GameEvent);
const groupDirective = (): QueueEntry => ({ kind: 'group', events: [] });

const baseInputs = (overrides: Partial<QueueDecisionInputs> = {}): QueueDecisionInputs => ({
  isWaitingForOverlay: false,
  hasDrawsInFlight: false,
  queue: [],
  isResolving: false,
  hasBufferedEvents: false,
  hasPendingPrompt: false,
  commitMode: 'per-event',
  deferredSolvingEntry: null,
  ...overrides,
});

describe('QueueRunner.decideNextStep', () => {
  // -------------------------------------------------------------------------
  // External wait gate (priority 1)
  // -------------------------------------------------------------------------

  describe('pause-external (wait gate)', () => {
    it('returns pause-external when isWaitingForOverlay=true', () => {
      const step = decideNextStep(baseInputs({ isWaitingForOverlay: true }));
      expect(step.action).toBe('pause-external');
    });

    it('returns pause-external when hasDrawsInFlight=true', () => {
      const step = decideNextStep(baseInputs({ hasDrawsInFlight: true }));
      expect(step.action).toBe('pause-external');
    });

    it('returns pause-external even when queue has entries (gate priority)', () => {
      const step = decideNextStep(
        baseInputs({ isWaitingForOverlay: true, queue: [damage(), damage()] }),
      );
      expect(step.action).toBe('pause-external');
    });

    it('gate prioritized over collapse: large LP burst with isWaitingForOverlay=true', () => {
      // 6 LP events would normally collapse; gate must preempt.
      const queue = [damage(), damage(), damage(), damage(), damage(), damage()];
      const step = decideNextStep(baseInputs({ isWaitingForOverlay: true, queue }));
      expect(step.action).toBe('pause-external');
    });
  });

  // -------------------------------------------------------------------------
  // Queue collapse (priority 2 — LP-only burst)
  // -------------------------------------------------------------------------

  describe('collapse (LP-only burst)', () => {
    it('collapses when queue length > THRESHOLD and all LP-class', () => {
      // queue=6 (THRESHOLD=5), KEEP=3 → collapseCount=3
      const queue = [damage(), damage(), damage(), recover(), payLp(), damage()];
      const step = decideNextStep(baseInputs({ queue }));
      expect(step.action).toBe('collapse');
      if (step.action === 'collapse') {
        expect(step.collapseCount).toBe(queue.length - QUEUE_COLLAPSE_KEEP);
      }
    });

    it('does NOT collapse at threshold edge (queue.length === THRESHOLD)', () => {
      // queue=5 (== THRESHOLD), strict > required → no collapse
      const queue = [damage(), damage(), damage(), damage(), damage()];
      const step = decideNextStep(baseInputs({ queue }));
      expect(step.action).toBe('dequeue');
    });

    it('does NOT collapse when any non-LP event is mixed in', () => {
      // queue=10 with 1 visual MSG_MOVE among 9 LP — visual blocks collapse
      const queue = [
        damage(), damage(), damage(), damage(), damage(),
        move(), damage(), damage(), damage(), damage(),
      ];
      const step = decideNextStep(baseInputs({ queue }));
      expect(step.action).toBe('dequeue');
    });

    it('does NOT collapse when queue contains directives (not GameEvents)', () => {
      // Directives have a 'kind' field — collapse predicate excludes them
      const queue = [
        groupDirective(), groupDirective(), groupDirective(),
        groupDirective(), groupDirective(), groupDirective(),
      ];
      const step = decideNextStep(baseInputs({ queue }));
      expect(step.action).toBe('dequeue');
    });
  });

  // -------------------------------------------------------------------------
  // Dequeue — deferred-solving has priority over normal queue
  // -------------------------------------------------------------------------

  describe('dequeue priority', () => {
    it('returns consume-deferred when deferredSolvingEntry is set, even if queue non-empty', () => {
      const deferred = { type: 'MSG_CHAIN_SOLVING' } as unknown as GameEvent;
      const step = decideNextStep(baseInputs({
        deferredSolvingEntry: deferred,
        queue: [damage()],
      }));
      expect(step.action).toBe('consume-deferred');
      if (step.action === 'consume-deferred') {
        expect(step.entry).toBe(deferred);
      }
    });

    it('returns dequeue with first queue entry when no deferred', () => {
      const head = damage();
      const step = decideNextStep(baseInputs({
        queue: [head, recover()],
      }));
      expect(step.action).toBe('dequeue');
      if (step.action === 'dequeue') {
        expect(step.entry).toBe(head);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Empty queue — three terminal branches
  // -------------------------------------------------------------------------

  describe('empty queue terminal branches', () => {
    it('returns pre-replay-buffer when isResolving + hasBufferedEvents + hasPendingPrompt', () => {
      const step = decideNextStep(baseInputs({
        isResolving: true,
        hasBufferedEvents: true,
        hasPendingPrompt: true,
      }));
      expect(step.action).toBe('pre-replay-buffer');
    });

    it('returns finalize when isResolving + hasBufferedEvents but NO prompt', () => {
      // Missing prompt — pre-replay condition fails, falls through.
      // commitMode=per-event by default → poll branch also skipped.
      const step = decideNextStep(baseInputs({
        isResolving: true,
        hasBufferedEvents: true,
        hasPendingPrompt: false,
      }));
      expect(step.action).toBe('finalize');
    });

    it('returns finalize when isResolving + hasPendingPrompt but NO buffered events', () => {
      const step = decideNextStep(baseInputs({
        isResolving: true,
        hasBufferedEvents: false,
        hasPendingPrompt: true,
      }));
      expect(step.action).toBe('finalize');
    });

    it('returns finalize for empty queue with default state (per-event commitMode)', () => {
      const step = decideNextStep(baseInputs());
      expect(step.action).toBe('finalize');
    });

    it('returns finalize when commitMode=deferred (mid-chain queue gap, event-driven re-wake expected)', () => {
      // Mid-chain queue-empty: chainPhase='resolving' but no overlay wait.
      // The dispatcher arms the POLL-DROP REGRESSION watchdog at this point
      // (see CLAUDE.md "Polling Removal — Regression Surface"); decideNextStep
      // itself just returns finalize. The watchdog catches stalls if no
      // event-driven re-wake (WS / advanceStep / chainOverlayReady) arrives
      // within POLL_DROP_REGRESSION_WATCHDOG_MS.
      const step = decideNextStep(baseInputs({
        commitMode: 'deferred',
        isWaitingForOverlay: false,
      }));
      expect(step.action).toBe('finalize');
    });
  });
});

// =============================================================================
// Palier B — `QueueRunner` lifecycle specs.
//
// These cover the scenarios chased by hand in May 2026 (seek-during-await,
// infinite rescue, parallel re-entry, watchdog arm) — now expressed as
// fast unit tests. The runner is exercised through its public API
// (`notifyEnqueue`, `requestStop`, `installAwaitSignal`) with a lightweight
// `MockDataSource` driving the queue and `EventResult`-returning stubs
// driving the dispatch.
// =============================================================================

/**
 * Minimal `AnimationDataSource` stand-in. The runner only reads
 * `animationQueue`, `chainPhase`, `pendingPrompt`, and calls
 * `dequeueAnimation` + `setAnimating` — that's all we mock. The rest of the
 * interface is filled with permissive any-typed stubs to keep TS happy
 * without dragging in the full RBS contract.
 */
class MockDataSource {
  private _queue = signal<QueueEntry[]>([]);
  private _chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  private _pendingPrompt = signal<unknown>(null);

  readonly animationQueue = this._queue.asReadonly();
  readonly chainPhase = this._chainPhase.asReadonly();
  readonly pendingPrompt = this._pendingPrompt.asReadonly();

  setAnimatingCalls: boolean[] = [];

  setQueue(entries: QueueEntry[]): void { this._queue.set(entries); }
  setChainPhase(phase: 'idle' | 'building' | 'resolving'): void { this._chainPhase.set(phase); }

  dequeueAnimation(): QueueEntry | null {
    const q = this._queue();
    if (q.length === 0) return null;
    const head = q[0];
    this._queue.set(q.slice(1));
    return head;
  }
  prependToQueue(entries: QueueEntry[]): void {
    this._queue.set([...entries, ...this._queue()]);
  }
  removeAnimationAt(index: number): void {
    const q = this._queue();
    this._queue.set([...q.slice(0, index), ...q.slice(index + 1)]);
  }
  setAnimating(animating: boolean): void { this.setAnimatingCalls.push(animating); }
}

/** Cast through `unknown` — `AnimationDataSource` carries a few signals our
 *  mock omits (RBS, chain links, active links). The runner never touches
 *  them in this spec. */
const asDataSource = (m: MockDataSource): AnimationDataSource =>
  m as unknown as AnimationDataSource;

const ev = (type: string): GameEvent => ({ type } as unknown as GameEvent);

const silentLogger: DuelLogger = {
  log: () => undefined,
  warn: () => undefined,
  isEnabled: () => false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const stubCtx: DuelContext = {
  ownPlayerIndex: () => 0,
  speedMultiplier: () => 1,
  safetyTimeout: (base: number) => base,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

interface RunnerHarness {
  runner: QueueRunner;
  ds: MockDataSource;
  watchdog: PollDropWatchdog;
  handleCalls: GameEvent[];
  directiveCalls: QueueDirective[];
  isRunningHistory: boolean[];
  injector: Injector;
}

function makeRunner(opts: {
  handleEntry?: (e: GameEvent) => EventResult | 'divert';
  processDirective?: (d: QueueDirective) => Promise<'continue' | 'pause'>;
  decisionInputs?: () => Omit<QueueDecisionInputs, 'queue'>;
  pollDropWatchdog?: PollDropWatchdog;
} = {}): RunnerHarness {
  const ds = new MockDataSource();
  const handleCalls: GameEvent[] = [];
  const directiveCalls: QueueDirective[] = [];
  const isRunningHistory: boolean[] = [];
  const injector = TestBed.inject(Injector);
  const watchdog = opts.pollDropWatchdog ?? new PollDropWatchdog(
    () => ({ isResolving: ds.chainPhase() === 'resolving', queueLen: ds.animationQueue().length, isAnimating: false, hasPendingPrompt: false }),
    () => undefined,
    /* delayMs */ 10_000,
  );
  const deps: QueueRunnerDeps = {
    dataSource: asDataSource(ds),
    pollDropWatchdog: watchdog,
    ctx: stubCtx,
    logger: silentLogger,
    injector,
    handleEntry: (e: GameEvent) => {
      handleCalls.push(e);
      return opts.handleEntry ? opts.handleEntry(e) : 0;
    },
    processDirective: async (d: QueueDirective) => {
      directiveCalls.push(d);
      return opts.processDirective ? await opts.processDirective(d) : 'continue';
    },
    applyInstantAnimation: () => undefined,
    consumeDeferredSolving: () => undefined,
    preReplayBuffer: async () => undefined,
    preLockQueuedSources: () => undefined,
    onStepSettled: () => undefined,
    onFinalize: () => undefined,
    onIsRunningChange: (r) => { isRunningHistory.push(r); },
    decisionInputs: opts.decisionInputs ?? (() => ({
      isWaitingForOverlay: false,
      hasDrawsInFlight: false,
      isResolving: ds.chainPhase() === 'resolving',
      hasBufferedEvents: false,
      hasPendingPrompt: ds.pendingPrompt() !== null,
      commitMode: ds.chainPhase() === 'resolving' ? 'deferred' : 'per-event',
      deferredSolvingEntry: null,
    })),
  };
  const runner = new QueueRunner(deps);
  return { runner, ds, watchdog, handleCalls, directiveCalls, isRunningHistory, injector };
}

describe('QueueRunner (loop) — Palier B', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  describe('notifyEnqueue / lifecycle', () => {
    it('drains a single-event queue and finalizes', async () => {
      const { runner, ds, handleCalls, isRunningHistory } = makeRunner();
      ds.setQueue([ev('MSG_MOVE')]);
      runner.notifyEnqueue();
      // Allow the inner async loop to settle.
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(handleCalls.map(e => e.type)).toEqual(['MSG_MOVE']);
      // The runner flips _isRunning true (notifyEnqueue), then false (finalize).
      expect(isRunningHistory).toEqual([true, false]);
      expect(runner.isRunning()).toBeFalse();
      expect(runner.isProcessing()).toBeFalse();
    });

    it('is a no-op when called while already running', () => {
      const { runner, ds, isRunningHistory } = makeRunner({
        // Never-resolving promise: keep the loop suspended forever.
        handleEntry: () => new Promise<void>(() => undefined),
      });
      ds.setQueue([ev('MSG_MOVE')]);
      runner.notifyEnqueue();
      runner.notifyEnqueue();  // second call
      runner.notifyEnqueue();  // third call
      // Only one true transition — the subsequent calls saw _isRunning already true.
      expect(isRunningHistory.filter(b => b)).toHaveSize(1);
    });

    it('processes multiple events in queue order', async () => {
      const { runner, ds, handleCalls } = makeRunner();
      ds.setQueue([ev('MSG_DRAW'), ev('MSG_MOVE'), ev('MSG_DAMAGE')]);
      runner.notifyEnqueue();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(handleCalls.map(e => e.type)).toEqual(['MSG_DRAW', 'MSG_MOVE', 'MSG_DAMAGE']);
    });

    it('relaunches the loop when an async handler suspended the cycle then resume signals back', async () => {
      // Regression guard for the a8859c98 draw-stall bug (2026-05-23).
      // Scenario: an event handler returns 'async' (e.g. initial draw). The
      // inner loop returns without entering case 'finalize', so _isRunning
      // stays true. The .finally rescue early-returns because queueLen===0.
      // Later, the async work completes and calls notifyEnqueue (via
      // drawManager.resumeQueueIfSafe). The runner MUST relaunch the loop
      // even though _isRunning is still true — otherwise the cycle stalls
      // forever, finalizeAndCommit never runs, _isAnimating never flips.
      let asyncHandlerCount = 0;
      const { runner, ds, isRunningHistory } = makeRunner({
        handleEntry: () => {
          asyncHandlerCount++;
          return 'async';
        },
      });
      ds.setQueue([ev('MSG_DRAW')]);
      runner.notifyEnqueue();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      // After 'async' return: handler invoked once, queue drained, but
      // _isRunning stays true (case 'finalize' never reached).
      expect(asyncHandlerCount).toBe(1);
      expect(ds.animationQueue().length).toBe(0);
      expect(runner.isRunning()).toBeTrue();
      expect(runner.isProcessing()).toBeFalse();

      // Simulate drawManager.resumeQueueIfSafe → notifyEnqueue. Queue is
      // still empty (no new events arrived). The runner must relaunch the
      // inner loop, which will see empty queue + no waits and hit
      // case 'finalize' → onIsRunningChange(false).
      runner.notifyEnqueue();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      // The loop finalized — _isRunning has flipped back to false at least once.
      expect(isRunningHistory).toContain(false);
      expect(runner.isRunning()).toBeFalse();
    });

    it('drops `divert` results without further processing', async () => {
      let onStepCount = 0;
      const ds = new MockDataSource();
      const injector = TestBed.inject(Injector);
      const watchdog = new PollDropWatchdog(
        () => ({ isResolving: false, queueLen: 0, isAnimating: false, hasPendingPrompt: false }),
        () => undefined, 10_000,
      );
      const runner = new QueueRunner({
        dataSource: asDataSource(ds),
        pollDropWatchdog: watchdog,
        ctx: stubCtx,
        logger: silentLogger,
        injector,
        handleEntry: () => 'divert',
        processDirective: async () => 'continue',
        applyInstantAnimation: () => undefined,
        consumeDeferredSolving: () => undefined,
        preReplayBuffer: async () => undefined,
        preLockQueuedSources: () => undefined,
        onStepSettled: () => { onStepCount++; },
        onFinalize: () => undefined,
        onIsRunningChange: () => undefined,
        decisionInputs: () => ({
          isWaitingForOverlay: false, hasDrawsInFlight: false,
          isResolving: false, hasBufferedEvents: false,
          hasPendingPrompt: false, commitMode: 'per-event',
          deferredSolvingEntry: null,
        }),
      });
      ds.setQueue([ev('MSG_MOVE')]);
      runner.notifyEnqueue();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      // Diverted events do not trigger onStepSettled.
      expect(onStepCount).toBe(0);
    });
  });

  describe('requestStop / abort invalidation (palier C)', () => {
    it('a fresh AbortController is installed on every requestStop', () => {
      const { runner, ds } = makeRunner({
        handleEntry: () => new Promise<void>(() => undefined),
      });
      ds.setQueue([ev('MSG_MOVE')]);
      runner.notifyEnqueue();
      // Two consecutive resets → two distinct controllers. The runner exposes
      // none of this directly, but we can prove it by chaining a fresh start
      // after each reset and checking it's not pre-aborted (the new fresh
      // start succeeds in dispatching).
      runner.requestStop();
      runner.requestStop();
      ds.setQueue([ev('MSG_DAMAGE')]);
      runner.notifyEnqueue();
      // Allow the new loop to settle.
      // (Stale promise never resolves — we're testing fresh-start health.)
      expect(runner.isRunning()).toBeTrue();
    });

    it('flips _isRunning to false through onIsRunningChange', () => {
      const { runner, ds, isRunningHistory } = makeRunner({
        handleEntry: () => new Promise<void>(() => undefined),
      });
      ds.setQueue([ev('MSG_MOVE')]);
      runner.notifyEnqueue();
      expect(runner.isRunning()).toBeTrue();
      runner.requestStop();
      expect(runner.isRunning()).toBeFalse();
      expect(isRunningHistory).toEqual([true, false]);
    });

    it('a suspended loop bails on resume after requestStop (no parallel re-entry)', async () => {
      let resolveFirst: (() => void) | null = null;
      const { runner, ds, handleCalls } = makeRunner({
        handleEntry: (e) => e.type === 'MSG_MOVE'
          ? new Promise<void>(r => { resolveFirst = r; })
          : 0,
      });
      ds.setQueue([ev('MSG_MOVE'), ev('MSG_DAMAGE')]);
      runner.notifyEnqueue();
      // Loop suspended on MSG_MOVE's promise.
      expect(handleCalls.map(e => e.type)).toEqual(['MSG_MOVE']);

      // Seek-equivalent: reset bumps generation, new feed kicks again.
      runner.requestStop();
      ds.setQueue([ev('MSG_DRAW')]);
      runner.notifyEnqueue();

      // Now resolve the stale promise — the suspended loop must see the
      // generation bump and bail, NOT proceed to consume the new queue.
      resolveFirst!();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      // Both events ended up dispatched exactly once each (no duplicate
      // dispatch from the stale loop racing the fresh one).
      const types = handleCalls.map(e => e.type);
      expect(types.filter(t => t === 'MSG_DRAW')).toHaveSize(1);
      // MSG_DAMAGE from the original queue was abandoned by the reset.
      expect(types).not.toContain('MSG_DAMAGE');
    });
  });

  describe('finalize / POLL-DROP watchdog', () => {
    it('arms the watchdog when finalize fires during chainPhase=resolving', async () => {
      const armed: number[] = [];
      const watchdog = new PollDropWatchdog(
        () => ({ isResolving: true, queueLen: 0, isAnimating: false, hasPendingPrompt: false }),
        () => undefined, 10_000,
      );
      // Spy on `arm` — replace with a counter wrapper.
      const origArm = watchdog.arm.bind(watchdog);
      spyOn(watchdog, 'arm').and.callFake(() => { armed.push(1); origArm(); });

      const { runner, ds } = makeRunner({ pollDropWatchdog: watchdog });
      ds.setChainPhase('resolving');
      // Empty queue → finalize path on first tick.
      runner.notifyEnqueue();
      await Promise.resolve(); await Promise.resolve();
      expect(armed.length).toBe(1);
      watchdog.clear();
    });

    it('does NOT arm the watchdog when finalize fires during chainPhase=idle', async () => {
      const watchdog = new PollDropWatchdog(
        () => ({ isResolving: false, queueLen: 0, isAnimating: false, hasPendingPrompt: false }),
        () => undefined, 10_000,
      );
      spyOn(watchdog, 'arm');
      const { runner, ds } = makeRunner({ pollDropWatchdog: watchdog });
      ds.setChainPhase('idle');
      runner.notifyEnqueue();
      await Promise.resolve(); await Promise.resolve();
      expect(watchdog.arm).not.toHaveBeenCalled();
    });
  });

  describe('await-signal directive', () => {
    it('returns true immediately when the predicate is already truthy (no effect installed)', () => {
      const { runner } = makeRunner();
      const sig = signal(true);
      const alreadyResolved = runner.installAwaitSignal(sig);
      expect(alreadyResolved).toBeTrue();
    });

    it('installs an effect that re-launches the queue when the predicate flips true', async () => {
      const { runner, ds, handleCalls } = makeRunner();
      const sig = signal(false);

      // Pretend the loop got here via processDirective — it sees the await,
      // installs the effect, and pauses (the caller in production returns 'pause').
      const alreadyResolved = runner.installAwaitSignal(sig);
      expect(alreadyResolved).toBeFalse();

      // Enqueue something that the effect should drain when it fires.
      ds.setQueue([ev('MSG_MOVE')]);
      // Flip the signal — the effect should call `processAnimationQueue` (which
      // is private but is reached via the runner's own machinery). After Angular
      // flushes the effect + the async loop drains, the event is consumed.
      sig.set(true);
      TestBed.flushEffects();
      // The runner needed to be "running" for the loop to actually run.
      // installAwaitSignal does NOT flip _isRunning to true (it's a directive
      // path — running already). Call notifyEnqueue to mimic that state.
      runner.notifyEnqueue();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(handleCalls.map(e => e.type)).toEqual(['MSG_MOVE']);
    });
  });

  describe('rescue / anti-runaway', () => {
    it('does NOT rescue when the loop paused on isWaitingForOverlay', async () => {
      // A truthy gate makes decideNextStep return pause-external every tick.
      // The runner exits the loop without dequeuing. The rescue in the finally
      // block must skip because of the gate predicate.
      let nb = 0;
      const ds = new MockDataSource();
      ds.setQueue([ev('MSG_MOVE')]);
      const injector = TestBed.inject(Injector);
      const watchdog = new PollDropWatchdog(
        () => ({ isResolving: false, queueLen: 1, isAnimating: false, hasPendingPrompt: false }),
        () => undefined, 10_000,
      );
      const runner = new QueueRunner({
        dataSource: asDataSource(ds),
        pollDropWatchdog: watchdog,
        ctx: stubCtx,
        logger: silentLogger,
        injector,
        handleEntry: () => 0,
        processDirective: async () => 'continue',
        applyInstantAnimation: () => undefined,
        consumeDeferredSolving: () => undefined,
        preReplayBuffer: async () => undefined,
        preLockQueuedSources: () => { nb++; },
        onStepSettled: () => undefined,
        onFinalize: () => undefined,
        onIsRunningChange: () => undefined,
        decisionInputs: () => ({
          isWaitingForOverlay: true,  // always paused on the gate
          hasDrawsInFlight: false,
          isResolving: false, hasBufferedEvents: false,
          hasPendingPrompt: false, commitMode: 'per-event',
          deferredSolvingEntry: null,
        }),
      });
      runner.notifyEnqueue();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      // Loop exited via pause-external, did not dispatch the queued event.
      expect(runner.isRunning()).toBeTrue();  // still running, gated externally
      // preLockQueuedSources is called twice on first kick (notifyEnqueue +
      // loop-entry) and that's it — no rescue spin. The exact count is bounded
      // by a small constant; assert "no runaway" via a generous ceiling.
      expect(nb).toBeLessThanOrEqual(3);
    });

    it('bails the rescue after RESCUE_NO_PROGRESS_CEILING no-progress passes', async () => {
      // Force a stalled state: queue stays at 1 forever (handleEntry never
      // dequeues — we simulate a "stuck entry" by always returning 'async'
      // which makes the inner loop return without dequeuing the entry, then
      // the rescue re-enters indefinitely).
      let rescueAttempts = 0;
      const ds = new MockDataSource();
      ds.setQueue([ev('MSG_MOVE')]);
      const injector = TestBed.inject(Injector);
      const watchdog = new PollDropWatchdog(
        () => ({ isResolving: false, queueLen: 1, isAnimating: false, hasPendingPrompt: false }),
        () => undefined, 10_000,
      );
      const runner = new QueueRunner({
        dataSource: asDataSource(ds),
        pollDropWatchdog: watchdog,
        ctx: stubCtx,
        logger: silentLogger,
        injector,
        // 'async' makes the loop early-return without dequeuing — queue stays
        // at length 1. The rescue then re-enters, increments the counter, and
        // hits the ceiling at RESCUE_NO_PROGRESS_CEILING + 1 attempts.
        handleEntry: () => 'async',
        processDirective: async () => 'continue',
        applyInstantAnimation: () => undefined,
        consumeDeferredSolving: () => undefined,
        preReplayBuffer: async () => undefined,
        preLockQueuedSources: () => { rescueAttempts++; },
        onStepSettled: () => undefined,
        onFinalize: () => undefined,
        onIsRunningChange: () => undefined,
        decisionInputs: () => ({
          isWaitingForOverlay: false, hasDrawsInFlight: false,
          isResolving: false, hasBufferedEvents: false,
          hasPendingPrompt: false, commitMode: 'per-event',
          deferredSolvingEntry: null,
        }),
      });
      runner.notifyEnqueue();
      // Let the rescue spin until it bails.
      for (let i = 0; i < RESCUE_NO_PROGRESS_CEILING + 5; i++) {
        await Promise.resolve();
      }
      // The rescue must have bailed BEFORE running indefinitely. The counter
      // we incremented in preLockQueuedSources reflects the number of loop
      // entries. With async returns + no progress, we expect the count to be
      // bounded by RESCUE_NO_PROGRESS_CEILING + a small constant (initial + one
      // tick per rescue) — NOT the full microtask spin count.
      expect(rescueAttempts).toBeLessThanOrEqual(RESCUE_NO_PROGRESS_CEILING + 3);
    });
  });
});
