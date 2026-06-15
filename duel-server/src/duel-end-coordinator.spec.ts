import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureDuelEndCoordinator,
  safeTerminateWorker,
  handleDuelEnd,
  requestReplayFromWorker,
  getTotalDuelsServed,
  _resetTotalDuelsServedForTest,
  type DuelEndCoordinatorConfig,
} from './duel-end-coordinator.js';
import type { ActiveDuelSession } from './types.js';

// =============================================================================
// Fixtures (mirror worker-lifecycle.spec.ts — these two specs share their
// FakeWorker / makeSession shapes since they exercise complementary slices of
// the same `ActiveDuelSession` lifecycle.)
// =============================================================================

interface FakeWorker {
  removeAllListeners: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function makeWorker(): FakeWorker {
  return {
    removeAllListeners: vi.fn(),
    terminate: vi.fn(),
    postMessage: vi.fn(),
    on: vi.fn(),
  };
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
    chosenFirstPlayer: null,
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
    animationsReadyDeadline: null,
  } as unknown as ActiveDuelSession & { worker: FakeWorker | null };
}

interface SpyHooks {
  timerClears: { session: ActiveDuelSession }[];
  rematchExpirations: { session: ActiveDuelSession }[];
  forkExpirations: { session: ActiveDuelSession }[];
}

function makeSpy(): SpyHooks {
  return { timerClears: [], rematchExpirations: [], forkExpirations: [] };
}

function makeConfig(spy: SpyHooks, overrides: Partial<DuelEndCoordinatorConfig> = {}): DuelEndCoordinatorConfig {
  return {
    clearAllDuelTimers: (session) => spy.timerClears.push({ session }),
    rematchExpiryMs: 300_000,
    onRematchExpired: (session) => spy.rematchExpirations.push({ session }),
    onForkSessionExpired: (session) => spy.forkExpirations.push({ session }),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('duel-end-coordinator', () => {
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
      configureDuelEndCoordinator(makeConfig(makeSpy()));
      const w = makeWorker();
      const s = makeSession(w);

      safeTerminateWorker(s);

      expect(s.workerTerminated).toBe(true);
      expect(w.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(w.terminate).toHaveBeenCalledTimes(1);
      expect(getTotalDuelsServed()).toBe(1);
    });

    it('is idempotent — second call is a no-op', () => {
      configureDuelEndCoordinator(makeConfig(makeSpy()));
      const w = makeWorker();
      const s = makeSession(w);

      safeTerminateWorker(s);
      safeTerminateWorker(s);

      expect(w.terminate).toHaveBeenCalledTimes(1);
      expect(getTotalDuelsServed()).toBe(1);
    });

    it('no-ops when session.worker is null', () => {
      configureDuelEndCoordinator(makeConfig(makeSpy()));
      const s = makeSession(null);

      expect(() => safeTerminateWorker(s)).not.toThrow();
      expect(s.workerTerminated).toBe(false);
      expect(getTotalDuelsServed()).toBe(0);
    });

    it('counter is shared across sessions (cumulative)', () => {
      configureDuelEndCoordinator(makeConfig(makeSpy()));
      const s1 = makeSession(makeWorker());
      const s2 = makeSession(makeWorker());

      safeTerminateWorker(s1);
      safeTerminateWorker(s2);

      expect(getTotalDuelsServed()).toBe(2);
    });
  });

  // ==========================================================================
  // handleDuelEnd
  // ==========================================================================

  describe('handleDuelEnd', () => {
    it('sets endedAt + clears timers + arms rematch (PvP)', () => {
      const spy = makeSpy();
      configureDuelEndCoordinator(makeConfig(spy));
      const s = makeSession();

      handleDuelEnd(s);

      expect(s.endedAt).not.toBeNull();
      expect(spy.timerClears).toHaveLength(1);
      expect(s.rematchTimeout).not.toBeNull();
    });

    // γ Option C A31 — T-S16 — SOLO sessions ARM the rematch timer (was
    // skipped pre-γ). Combined with A18 ws.on('close') SOLO branch in
    // server.ts, this is the only thing that cleans up a SOLO post-duel
    // session: the user may refresh the tab during the rematch grace and
    // expect to come back to the rematch invitation.
    it('arms rematch timer for solo-mode sessions too (γ Option C A31 / T-S16)', () => {
      const spy = makeSpy();
      configureDuelEndCoordinator(makeConfig(spy));
      const s = makeSession();
      s.soloMode = true;

      handleDuelEnd(s);

      expect(s.rematchTimeout).not.toBeNull();
      // Timers still cleared.
      expect(spy.timerClears).toHaveLength(1);
    });

    // γ defensive (BMad code review c3 finding E5) — handleDuelEnd is idempotent
    // on `endedAt`. A re-entry (TIMEOUT-after-MSG_WIN race) would otherwise
    // overwrite `rematchTimeout` and leak the prior Node timer.
    it('is idempotent on endedAt (second call leaves rematchTimeout untouched)', () => {
      const spy = makeSpy();
      configureDuelEndCoordinator(makeConfig(spy));
      const s = makeSession();

      handleDuelEnd(s);
      const firstEndedAt = s.endedAt;
      const firstTimer = s.rematchTimeout;
      expect(firstEndedAt).not.toBeNull();
      expect(firstTimer).not.toBeNull();

      // Advance the clock so the second call's Date.now() would differ.
      vi.advanceTimersByTime(50);
      handleDuelEnd(s);

      expect(s.endedAt).toBe(firstEndedAt);
      expect(s.rematchTimeout).toBe(firstTimer);
      // No second clearAllDuelTimers call either.
      expect(spy.timerClears).toHaveLength(1);
    });

    it('the rematch timer calls onRematchExpired after the configured ms', () => {
      const spy = makeSpy();
      configureDuelEndCoordinator(makeConfig(spy, { rematchExpiryMs: 100 }));
      const s = makeSession();

      handleDuelEnd(s);
      expect(spy.rematchExpirations).toHaveLength(0);

      vi.advanceTimersByTime(100);
      expect(spy.rematchExpirations).toEqual([{ session: s }]);
    });

    // F5-bis (2026-05-31) — fork-solo is an exploratory one-shot; the REMATCH
    // arm is intentionally skipped. Audit 2026-06-11 #2/#3 — but the session
    // still needs a terminal deadline (no Spring Room, no grace path for
    // soloMode, the close handler early-returns) : the fork branch now arms
    // the shared `rematchTimeout` slot with `onForkSessionExpired` (straight
    // cleanup, no REMATCH_CANCELLED) instead of arming nothing.
    it('arms the fork-expiry (NOT the rematch flow) when session.forkMode', () => {
      const spy = makeSpy();
      configureDuelEndCoordinator(makeConfig(spy, { rematchExpiryMs: 100 }));
      const s = makeSession();
      s.soloMode = true;
      s.forkMode = true;

      handleDuelEnd(s);

      expect(s.endedAt).not.toBeNull();
      expect(spy.timerClears).toHaveLength(1);
      // The shared slot IS armed — every existing clear site covers it.
      expect(s.rematchTimeout).not.toBeNull();

      // After expiry: the fork hook fires, the rematch flow never does —
      // a fork session must never emit REMATCH_CANCELLED.
      vi.advanceTimersByTime(200);
      expect(spy.rematchExpirations).toEqual([]);
      expect(spy.forkExpirations).toEqual([{ session: s }]);
    });
  });

  // ==========================================================================
  // requestReplayFromWorker
  // ==========================================================================

  describe('requestReplayFromWorker', () => {
    it('stashes the override + posts EMIT_REPLAY_DATA', () => {
      configureDuelEndCoordinator(makeConfig(makeSpy()));
      const w = makeWorker();
      const s = makeSession(w);

      requestReplayFromWorker(s, 'TIMEOUT');

      expect(s.pendingReplayResult).toBe('TIMEOUT');
      expect(w.postMessage).toHaveBeenCalledWith({ type: 'EMIT_REPLAY_DATA' });
    });

    it('no-ops when worker is null', () => {
      configureDuelEndCoordinator(makeConfig(makeSpy()));
      const s = makeSession(null);

      requestReplayFromWorker(s, 'SURRENDER');

      expect(s.pendingReplayResult).toBeNull();
    });

    it('no-ops when worker is already terminated', () => {
      configureDuelEndCoordinator(makeConfig(makeSpy()));
      const w = makeWorker();
      const s = makeSession(w);
      s.workerTerminated = true;

      requestReplayFromWorker(s, 'SURRENDER');

      expect(s.pendingReplayResult).toBeNull();
      expect(w.postMessage).not.toHaveBeenCalled();
    });
  });
});
