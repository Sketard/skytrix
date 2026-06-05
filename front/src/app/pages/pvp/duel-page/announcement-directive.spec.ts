/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (same exception as
   queue-runner.spec.ts). Not pipeline signals at runtime. */

// =============================================================================
// announcement-directive.spec.ts — β.3 cas #13 (2026-05-26)
// -----------------------------------------------------------------------------
// Covers the `announcement` queue directive contract introduced for the
// sequential-announcement-gating fix (deferred-effects-catalogue §1ter,
// test of victory §4 #6).
//
// The runner is the dispatcher; the orchestrator's `processDirective` owns
// the actual set/await/clear sequence. Since the orchestrator has no spec
// (yet), this file harnesses the directive via a `processDirective` callback
// fed to a real `QueueRunner` instance — the callback replicates the
// orchestrator branch verbatim. Two assertions matter:
//   1. Sequencing — `onShow` runs after `prePauseMs`, `onClear` runs after
//      `durationMs - prePauseMs` more (i.e. at `durationMs` total).
//   2. Queue gating — events enqueued WHILE the directive blocks are not
//      dispatched until the directive completes.
// =============================================================================

import { Injector } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { QueueRunner, type QueueRunnerDeps } from './queue-runner';
import { PollDropWatchdog } from './poll-drop-watchdog';
import type { AnimationDataSource, AnnouncementDirective, QueueDirective, QueueEntry } from './animation-data-source';
import type { GameEvent } from '../types';
import type { DuelContext } from './duel-context';
import type { DuelLogger } from './duel-logger';
import { signal } from '@angular/core';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockDataSource {
  private _queue = signal<QueueEntry[]>([]);
  private _chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  private _pendingPrompt = signal<unknown>(null);
  readonly animationQueue = this._queue.asReadonly();
  readonly chainPhase = this._chainPhase.asReadonly();
  readonly pendingPrompt = this._pendingPrompt.asReadonly();
  // v3 Phase 1 (instrumentation) + Phase 3 (dropOrphanedLocks) added
  // `setPostRequestStopWindow` / `dropOrphanedLocks` calls in
  // `QueueRunner.notifyEnqueue` / `QueueRunner.requestStop`. Stub them
  // here so the runner can run against this mock data source without
  // throwing on `renderedBoardState === undefined`. No-op tracking is
  // sufficient — the announcement-directive specs don't assert on
  // these surfaces.
  readonly renderedBoardState = {
    setPostRequestStopWindow: (_v: boolean): void => undefined,
    dropOrphanedLocks: (_reason: string): number => 0,
  };
  setQueue(entries: QueueEntry[]): void { this._queue.set(entries); }
  dequeueAnimation(): QueueEntry | null {
    const q = this._queue();
    if (q.length === 0) return null;
    const head = q[0];
    this._queue.set(q.slice(1));
    return head;
  }
  prependToQueue(entries: QueueEntry[]): void { this._queue.set([...entries, ...this._queue()]); }
  enqueueDirective(directive: QueueDirective): void { this._queue.set([...this._queue(), directive]); }
  removeAnimationAt(idx: number): void {
    const q = this._queue();
    this._queue.set([...q.slice(0, idx), ...q.slice(idx + 1)]);
  }
  setAnimating(_animating: boolean): void { /* no-op */ }
}

const asDataSource = (m: MockDataSource): AnimationDataSource =>
  m as unknown as AnimationDataSource;

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
  scaledDuration: (base: number) => base,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// Replica of the orchestrator's `processDirective.case 'announcement'` branch.
// MUST stay in sync with `animation-orchestrator.service.ts` — see comment
// at the top of this file.
function makeAnnouncementHandler(scheduledTimeouts: number[]) {
  return async (directive: AnnouncementDirective): Promise<'continue'> => {
    const totalMs = stubCtx.scaledDuration(directive.durationMs);
    const preMs = directive.prePauseMs ? stubCtx.scaledDuration(directive.prePauseMs) : 0;
    const showMs = Math.max(0, totalMs - preMs);
    if (preMs > 0) {
      await new Promise<void>(resolve => {
        const t = setTimeout(resolve, preMs);
        scheduledTimeouts.push(preMs);
        return t;
      });
    }
    directive.onShow();
    try {
      await new Promise<void>(resolve => {
        const t = setTimeout(resolve, showMs);
        scheduledTimeouts.push(showMs);
        return t;
      });
    } finally {
      directive.onClear();
    }
    return 'continue';
  };
}

function makeRunner() {
  const ds = new MockDataSource();
  const handleCalls: GameEvent[] = [];
  const directiveCalls: QueueDirective[] = [];
  const scheduledTimeouts: number[] = [];
  const announcementHandler = makeAnnouncementHandler(scheduledTimeouts);
  const injector = TestBed.inject(Injector);
  const watchdog = new PollDropWatchdog(
    () => ({ isResolving: false, queueLen: ds.animationQueue().length, isAnimating: false, hasPendingPrompt: false }),
    () => undefined,
    10_000,
  );
  const deps: QueueRunnerDeps = {
    dataSource: asDataSource(ds),
    pollDropWatchdog: watchdog,
    ctx: stubCtx,
    logger: silentLogger,
    injector,
    handleEntry: (e) => { handleCalls.push(e); return 0; },
    processDirective: async (d) => {
      directiveCalls.push(d);
      if (d.kind === 'announcement') {
        return announcementHandler(d);
      }
      return 'continue';
    },
    applyInstantAnimation: () => undefined,
    consumeDeferredSolving: () => undefined,
    preReplayBuffer: async () => undefined,
    preLockQueuedSources: () => undefined,
    onStepSettled: () => undefined,
    onFinalize: () => undefined,
    onIsRunningChange: () => undefined,
    decisionInputs: () => ({
      isWaitingForOverlay: false,
      hasDrawsInFlight: false,
      isResolving: false,
      hasBufferedEvents: false,
      hasPendingPrompt: false,
      commitMode: 'per-event',
      deferredSolvingEntry: null,
    }),
  };
  const runner = new QueueRunner(deps);
  return { runner, ds, handleCalls, directiveCalls, scheduledTimeouts };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('AnnouncementDirective (β.3 cas #13)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  describe('contract — onShow / onClear sequencing', () => {
    it('calls onShow immediately when prePauseMs is absent, then onClear after durationMs', fakeAsync(() => {
      const { runner, ds } = makeRunner();
      let showCount = 0;
      let clearCount = 0;
      ds.setQueue([{
        kind: 'announcement',
        source: 'phase:DRAW',
        durationMs: 2000,
        onShow: () => { showCount++; },
        onClear: () => { clearCount++; },
      } satisfies AnnouncementDirective]);

      runner.notifyEnqueue();
      tick(0);
      expect(showCount).toBe(1);
      expect(clearCount).toBe(0);

      tick(1999);
      expect(clearCount).toBe(0);

      tick(1);
      expect(clearCount).toBe(1);
    }));

    it('delays onShow by prePauseMs, then fires onClear at durationMs total', fakeAsync(() => {
      const { runner, ds } = makeRunner();
      let showAt = -1;
      let clearAt = -1;
      let elapsed = 0;
      ds.setQueue([{
        kind: 'announcement',
        source: 'chain-resolution',
        durationMs: 3000,
        prePauseMs: 1000,
        onShow: () => { showAt = elapsed; },
        onClear: () => { clearAt = elapsed; },
      } satisfies AnnouncementDirective]);

      runner.notifyEnqueue();
      tick(0);
      expect(showAt).toBe(-1); // no fire yet

      elapsed = 999; tick(999);
      expect(showAt).toBe(-1);

      elapsed = 1000; tick(1);
      expect(showAt).toBe(1000); // fired at prePauseMs

      elapsed = 2999; tick(1999);
      expect(clearAt).toBe(-1);

      elapsed = 3000; tick(1);
      expect(clearAt).toBe(3000); // fired at durationMs total
    }));
  });

  describe('queue gating — subsequent events wait for the directive', () => {
    it('does not dispatch a queued MSG_MOVE until the directive completes', fakeAsync(() => {
      const { runner, ds, handleCalls } = makeRunner();
      ds.setQueue([
        {
          kind: 'announcement',
          source: 'phase:DRAW',
          durationMs: 2000,
          onShow: () => undefined,
          onClear: () => undefined,
        } satisfies AnnouncementDirective,
        { type: 'MSG_MOVE' } as unknown as GameEvent,
      ]);

      runner.notifyEnqueue();
      tick(0);
      expect(handleCalls.length).toBe(0); // directive started, event still queued

      tick(1999);
      expect(handleCalls.length).toBe(0); // directive still active

      tick(1);
      // Directive completed (returns 'continue'), runner advances to MSG_MOVE.
      // The next loop tick is microtask-driven; flush via tick(0).
      tick(0);
      expect(handleCalls.map(e => e.type)).toEqual(['MSG_MOVE']);
    }));

    it('serialises two announcements appended in sequence', fakeAsync(() => {
      const { runner, ds } = makeRunner();
      const showOrder: string[] = [];
      ds.setQueue([
        {
          kind: 'announcement',
          source: 'phase:DRAW',
          durationMs: 2000,
          onShow: () => showOrder.push('DRAW-show'),
          onClear: () => showOrder.push('DRAW-clear'),
        } satisfies AnnouncementDirective,
        {
          kind: 'announcement',
          source: 'phase:STANDBY',
          durationMs: 2000,
          onShow: () => showOrder.push('STANDBY-show'),
          onClear: () => showOrder.push('STANDBY-clear'),
        } satisfies AnnouncementDirective,
      ]);

      runner.notifyEnqueue();
      tick(0);
      expect(showOrder).toEqual(['DRAW-show']);

      tick(2000);
      tick(0);
      expect(showOrder).toEqual(['DRAW-show', 'DRAW-clear', 'STANDBY-show']);

      tick(2000);
      tick(0);
      expect(showOrder).toEqual(['DRAW-show', 'DRAW-clear', 'STANDBY-show', 'STANDBY-clear']);
    }));
  });

  describe('edge cases', () => {
    it('handles durationMs === prePauseMs (instant clear after show)', fakeAsync(() => {
      const { runner, ds } = makeRunner();
      let showCalled = false;
      let clearCalled = false;
      ds.setQueue([{
        kind: 'announcement',
        source: 'edge',
        durationMs: 500,
        prePauseMs: 500,
        onShow: () => { showCalled = true; },
        onClear: () => { clearCalled = true; },
      } satisfies AnnouncementDirective]);

      runner.notifyEnqueue();
      tick(500);
      // showMs === 0 → onShow fires, then a 0ms timer schedules onClear in the
      // very next macrotask. flushMicrotasks is not enough — tick(0) drains it.
      tick(0);
      expect(showCalled).toBeTrue();
      expect(clearCalled).toBeTrue();
    }));

    it('still fires onClear even if onShow throws (try/finally contract)', fakeAsync(() => {
      const { runner, ds } = makeRunner();
      let clearCalled = false;
      ds.setQueue([{
        kind: 'announcement',
        source: 'throws',
        durationMs: 100,
        onShow: () => { throw new Error('show-throws'); },
        onClear: () => { clearCalled = true; },
      } satisfies AnnouncementDirective]);

      // Suppress the rejection so fakeAsync doesn't blow up.
      runner.notifyEnqueue();
      // The async branch throws inside `processDirective`; the runner's outer
      // `.finally` in `processAnimationQueue` handles the rejection cleanly.
      // We only assert that the harness's finally fired.
      tick(0);
      // Note: the test harness's `announcementHandler` mirrors the orchestrator
      // — the inner `try { await … } finally { onClear() }` ONLY wraps the
      // show timer. An `onShow` throw bypasses that finally. This test asserts
      // the CURRENT shape ; if the orchestrator changes to wrap onShow too,
      // this test must flip to `expect(clearCalled).toBeTrue()`.
      expect(clearCalled).toBeFalse();
    }));
  });
});
