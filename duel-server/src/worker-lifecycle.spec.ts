import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureWorkerLifecycle,
  safeTerminateWorker,
  attachWorkerHandlers,
  handleDuelEnd,
  requestReplayFromWorker,
  getTotalDuelsServed,
  _resetTotalDuelsServedForTest,
  type WorkerLifecycleConfig,
} from './worker-lifecycle.js';
import type { ActiveDuelSession, WorkerToMainMessage } from './types.js';

// =============================================================================
// Fixtures
// =============================================================================

interface FakeWorker {
  removeAllListeners: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  // Captured listeners (so the test can fire them synthetically).
  _handlers: { message?: (raw: unknown) => void; exit?: (code: number) => void; error?: (err: Error) => void };
}

function makeWorker(): FakeWorker {
  const w: FakeWorker = {
    removeAllListeners: vi.fn(),
    terminate: vi.fn(),
    postMessage: vi.fn(),
    on: vi.fn(),
    _handlers: {},
  };
  w.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    w._handlers[event as keyof FakeWorker['_handlers']] = handler as never;
    return w;
  });
  return w;
}

function makeSession(worker: FakeWorker | null = makeWorker()): ActiveDuelSession & { worker: FakeWorker | null } {
  return {
    duelId: 'd1',
    players: [
      { playerId: 'p0', playerIndex: 0, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: 'p1', playerIndex: 1, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
    ],
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    phase: 'DUELING',
    firstPlayerState: null,
    worker: worker as unknown as ActiveDuelSession['worker'],
    workerTerminated: false,
    awaitingResponse: [false, false],
    lastBoardState: null,
    lastSentPrompt: [null, null],
    lastSentHint: [null, null],
    decks: [{ main: [], extra: [] }, { main: [], extra: [] }],
    rematchRequested: [false, false],
    rematchTimeout: null,
    preservationTimer: null,
    bothDisconnected: false,
    combinedGraceTimer: null,
    storedDuelResult: null,
    lastStateSyncAt: [0, 0],
    lastCancelAt: [0, 0],
    cancelTargetPrompt: [null, null],
    timerContext: null,
    soloMode: false,
    skipShuffle: false,
    turnTimeSecs: 300,
    invalidResponseCount: [0, 0],
    promptSentAt: [0, 0],
    activeChainLinks: [],
    chainPhase: 'idle',
    negatedChainIndices: new Set(),
    currentSolvingChainIndex: null,
    playerUsernames: ['p0', 'p1'],
    deckNames: ['d0', 'd1'],
    pendingReplayResult: null,
    forkConnectionTimeout: null,
  } as unknown as ActiveDuelSession & { worker: FakeWorker | null };
}

interface SpyHooks {
  routed: { session: ActiveDuelSession; wmsg: WorkerToMainMessage }[];
  cleanups: { session: ActiveDuelSession }[];
  timerClears: { session: ActiveDuelSession }[];
  rematchExpirations: { session: ActiveDuelSession }[];
}

function makeSpy(): SpyHooks {
  return { routed: [], cleanups: [], timerClears: [], rematchExpirations: [] };
}

function makeConfig(spy: SpyHooks, overrides: Partial<WorkerLifecycleConfig> = {}): WorkerLifecycleConfig {
  return {
    handleWorkerMessage: (session, wmsg) => spy.routed.push({ session, wmsg }),
    cleanupDuelSession: (session) => spy.cleanups.push({ session }),
    clearAllDuelTimers: (session) => spy.timerClears.push({ session }),
    rematchExpiryMs: 300_000,
    onRematchExpired: (session) => spy.rematchExpirations.push({ session }),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('worker-lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetTotalDuelsServedForTest();
  });
  afterEach(() => vi.useRealTimers());

  // ==========================================================================
  // safeTerminateWorker
  // ==========================================================================

  describe('safeTerminateWorker', () => {
    it('removes listeners, terminates, flips workerTerminated, increments counter', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);

      safeTerminateWorker(s);

      expect(s.workerTerminated).toBe(true);
      expect(w.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(w.terminate).toHaveBeenCalledTimes(1);
      expect(getTotalDuelsServed()).toBe(1);
    });

    it('is idempotent — second call is a no-op', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);

      safeTerminateWorker(s);
      safeTerminateWorker(s);

      expect(w.terminate).toHaveBeenCalledTimes(1);
      expect(getTotalDuelsServed()).toBe(1);
    });

    it('no-ops when session.worker is null', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const s = makeSession(null);

      expect(() => safeTerminateWorker(s)).not.toThrow();
      expect(s.workerTerminated).toBe(false);
      expect(getTotalDuelsServed()).toBe(0);
    });

    it('counter is shared across sessions (cumulative)', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const s1 = makeSession(makeWorker());
      const s2 = makeSession(makeWorker());

      safeTerminateWorker(s1);
      safeTerminateWorker(s2);

      expect(getTotalDuelsServed()).toBe(2);
    });
  });

  // ==========================================================================
  // attachWorkerHandlers — message routing
  // ==========================================================================

  describe('attachWorkerHandlers — message dispatch', () => {
    it('routes a valid worker message through handleWorkerMessage', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);
      attachWorkerHandlers(s);

      const validMsg: WorkerToMainMessage = { type: 'WORKER_DUEL_CREATED', duelId: 'd1' } as WorkerToMainMessage;
      w._handlers.message!(validMsg);

      expect(spy.routed).toHaveLength(1);
      expect(spy.routed[0]!.wmsg).toBe(validMsg);
      expect(spy.routed[0]!.session).toBe(s);
    });

    it('drops a malformed worker message without throwing', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);
      attachWorkerHandlers(s);

      w._handlers.message!({ type: 'GARBAGE' });

      expect(spy.routed).toHaveLength(0);
    });

    it('no-ops when worker is null', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const s = makeSession(null);

      expect(() => attachWorkerHandlers(s)).not.toThrow();
    });
  });

  // ==========================================================================
  // attachWorkerHandlers — exit handler (the natural-end-vs-crash branch)
  // ==========================================================================

  describe('attachWorkerHandlers — exit branch', () => {
    it('on unexpected exit (endedAt null), runs full cleanup + increments counter', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);
      attachWorkerHandlers(s);

      w._handlers.exit!(1);

      expect(spy.cleanups).toHaveLength(1);
      expect(spy.cleanups[0]!.session).toBe(s);
      expect(s.workerTerminated).toBe(true);
      expect(getTotalDuelsServed()).toBe(1);
    });

    it('on natural end (endedAt set), does NOT cleanup (session kept alive for rematch)', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);
      s.endedAt = Date.now();
      attachWorkerHandlers(s);

      w._handlers.exit!(0);

      expect(spy.cleanups).toHaveLength(0);
      expect(s.workerTerminated).toBe(true);
      expect(getTotalDuelsServed()).toBe(1);
    });

    it('does NOT double-count when safeTerminateWorker already incremented before exit fires', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);
      attachWorkerHandlers(s);

      // Server explicitly terminated → counter went from 0 → 1.
      safeTerminateWorker(s);
      expect(getTotalDuelsServed()).toBe(1);

      // Worker's exit event arrives after — must NOT add another count.
      w._handlers.exit!(0);
      expect(getTotalDuelsServed()).toBe(1);
    });

    it('the error handler does not throw / does not cleanup', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);
      attachWorkerHandlers(s);

      expect(() => w._handlers.error!(new Error('boom'))).not.toThrow();
      expect(spy.cleanups).toHaveLength(0);
    });
  });

  // ==========================================================================
  // handleDuelEnd
  // ==========================================================================

  describe('handleDuelEnd', () => {
    it('sets endedAt + clears timers + arms rematch (PvP)', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const s = makeSession();

      handleDuelEnd(s);

      expect(s.endedAt).not.toBeNull();
      expect(spy.timerClears).toHaveLength(1);
      expect(s.rematchTimeout).not.toBeNull();
    });

    it('skips rematch arm for solo-mode sessions', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const s = makeSession();
      s.soloMode = true;

      handleDuelEnd(s);

      expect(s.rematchTimeout).toBeNull();
      // Timers still cleared.
      expect(spy.timerClears).toHaveLength(1);
    });

    it('the rematch timer calls onRematchExpired after the configured ms', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy, { rematchExpiryMs: 100 }));
      const s = makeSession();

      handleDuelEnd(s);
      expect(spy.rematchExpirations).toHaveLength(0);

      vi.advanceTimersByTime(100);
      expect(spy.rematchExpirations).toEqual([{ session: s }]);
    });
  });

  // ==========================================================================
  // requestReplayFromWorker
  // ==========================================================================

  describe('requestReplayFromWorker', () => {
    it('stashes the override + posts EMIT_REPLAY_DATA', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);

      requestReplayFromWorker(s, 'TIMEOUT');

      expect(s.pendingReplayResult).toBe('TIMEOUT');
      expect(w.postMessage).toHaveBeenCalledWith({ type: 'EMIT_REPLAY_DATA' });
    });

    it('no-ops when worker is null', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const s = makeSession(null);

      requestReplayFromWorker(s, 'SURRENDER');

      expect(s.pendingReplayResult).toBeNull();
    });

    it('no-ops when worker is already terminated', () => {
      const spy = makeSpy();
      configureWorkerLifecycle(makeConfig(spy));
      const w = makeWorker();
      const s = makeSession(w);
      s.workerTerminated = true;

      requestReplayFromWorker(s, 'SURRENDER');

      expect(s.pendingReplayResult).toBeNull();
      expect(w.postMessage).not.toHaveBeenCalled();
    });
  });
});
