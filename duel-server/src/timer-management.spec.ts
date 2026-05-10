import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureTimerManagement,
  sendTimerStateToAll,
  startTurnTimer,
  pauseTurnTimer,
  scheduleTimerStart,
  commitPendingTimer,
  addTurnIncrement,
  handleTurnChange,
  clearAllDuelTimers,
  startGracePeriod,
  type TimerManagementConfig,
} from './timer-management.js';
import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';

// =============================================================================
// Test fixtures
// =============================================================================

interface SentMessage {
  player: 0 | 1;
  message: ServerMessage;
}

interface SpyHooks {
  sent: SentMessage[];
  duelEnds: { session: ActiveDuelSession }[];
  replayRequests: { session: ActiveDuelSession; reason: string }[];
  cleanups: { session: ActiveDuelSession }[];
  terminations: { session: ActiveDuelSession }[];
}

function makeConfig(spy: SpyHooks, overrides: Partial<TimerManagementConfig> = {}): TimerManagementConfig {
  return {
    sendToPlayer: (session, p, message) => spy.sent.push({ player: p, message }),
    handleDuelEnd: (session) => spy.duelEnds.push({ session }),
    requestReplayFromWorker: (session, reason) => spy.replayRequests.push({ session, reason }),
    cleanupDuelSession: (session) => spy.cleanups.push({ session }),
    safeTerminateWorker: (session) => spy.terminations.push({ session }),
    turnTimeIncrementMs: 40_000,
    inactivityTimeoutMs: 120_000,
    inactivityWarningBeforeMs: 20_000,
    inactivityRaceWindowMs: 500,
    reconnectGraceMs: 60_000,
    bothDisconnectedCleanupMs: 10_000,
    animationsDoneTimeoutMs: 30_000,
    ...overrides,
  };
}

function makeSession(initialPoolMs = 300_000): ActiveDuelSession {
  return {
    duelId: 'test-duel',
    players: [
      { playerId: 'p0', playerIndex: 0, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: 'p1', playerIndex: 1, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
    ],
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    phase: 'DUELING',
    rpsState: null,
    worker: null,
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
    timerContext: {
      pools: [initialPoolMs, initialPoolMs],
      running: false,
      activePlayer: 0,
      intervalRef: null,
      lastTickMs: 0,
      turnCount: 0,
      pendingPlayer: null,
      pendingTimeout: null,
    },
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
  } as unknown as ActiveDuelSession;
}

function makeSpy(): SpyHooks {
  return { sent: [], duelEnds: [], replayRequests: [], cleanups: [], terminations: [] };
}

function timerStateMessages(spy: SpyHooks): SentMessage[] {
  return spy.sent.filter(s => s.message.type === 'TIMER_STATE');
}

// =============================================================================
// Tests
// =============================================================================

describe('timer-management', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================================================
  // addTurnIncrement — first-turn skip (Bug A bonus fix 2026-05-10)
  // ==========================================================================

  describe('addTurnIncrement — opening turn +40s skip', () => {
    it('skips +40s on turn 1 (P1 opening)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(300_000);

      addTurnIncrement(s, 0, 1);

      expect(s.timerContext!.pools[0]).toBe(300_000);
      expect(s.timerContext!.turnCount).toBe(1);
      expect(s.timerContext!.activePlayer).toBe(0);
    });

    it('skips +40s on turn 2 (P2 opening — symmetric with P1)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(300_000);
      s.timerContext!.turnCount = 1;

      addTurnIncrement(s, 1, 2);

      // The fix is `turnCount > 2`. Both players' opening turns keep 300s intact.
      expect(s.timerContext!.pools[1]).toBe(300_000);
      expect(s.timerContext!.turnCount).toBe(2);
      expect(s.timerContext!.activePlayer).toBe(1);
    });

    it('applies +40s on turn 3 (P1 second turn)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(280_000);
      s.timerContext!.turnCount = 2;

      addTurnIncrement(s, 0, 3);

      expect(s.timerContext!.pools[0]).toBe(320_000); // 280 + 40
    });

    it('applies +40s on turn 4 (P2 second turn)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(295_000);
      s.timerContext!.turnCount = 3;

      addTurnIncrement(s, 1, 4);

      expect(s.timerContext!.pools[1]).toBe(335_000);
    });

    it('does not modify the inactive player pool', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(290_000);
      s.timerContext!.turnCount = 5;
      s.timerContext!.pools[1] = 250_000;

      addTurnIncrement(s, 0, 6);

      expect(s.timerContext!.pools[0]).toBe(330_000); // active gets increment
      expect(s.timerContext!.pools[1]).toBe(250_000); // inactive untouched
    });

    it('no-op when timerContext is null', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.timerContext = null;

      expect(() => addTurnIncrement(s, 0, 5)).not.toThrow();
    });
  });

  // ==========================================================================
  // startTurnTimer — pool depletion forfeit
  // ==========================================================================

  describe('startTurnTimer — pool depletion timeout forfeit', () => {
    it('starts the 250ms tick interval and broadcasts both pools on resume', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(300_000);
      s.timerContext!.activePlayer = 0;

      startTurnTimer(s);

      // Snapshot of both pools sent on resume (Bug A fix 2026-05-10)
      const snapshots = timerStateMessages(spy);
      // sendTimerStateToAll → 2 messages × 2 clients = 4
      expect(snapshots).toHaveLength(4);
      expect(s.timerContext!.running).toBe(true);
    });

    it('decrements active pool on each tick and broadcasts to both players', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(300_000);

      startTurnTimer(s);
      spy.sent.length = 0; // discard the resume snapshot

      vi.advanceTimersByTime(250);

      const ticks = timerStateMessages(spy);
      // 1 tick = 1 message broadcast to both clients = 2 entries
      expect(ticks).toHaveLength(2);
      expect(ticks[0].message).toMatchObject({ type: 'TIMER_STATE', player: 0 });
      const m = ticks[0].message as { remainingMs: number };
      expect(m.remainingMs).toBeLessThanOrEqual(300_000);
      expect(m.remainingMs).toBeGreaterThanOrEqual(299_500); // ~250ms elapsed
    });

    it('emits DUEL_END with timeout reason when active pool reaches 0', () => {
      const spy = makeSpy();
      // Real server.ts handleDuelEnd calls clearAllDuelTimers — emulate that here
      // so the ticker stops after the first DUEL_END (otherwise the interval
      // continues firing DUEL_END every 250ms in fake-timer land).
      const cfg = makeConfig(spy);
      cfg.handleDuelEnd = (session) => {
        spy.duelEnds.push({ session });
        clearAllDuelTimers(session);
      };
      configureTimerManagement(cfg);
      const s = makeSession(500); // very short pool
      s.timerContext!.activePlayer = 1;

      startTurnTimer(s);

      // Tick past the 500ms pool
      vi.advanceTimersByTime(1000);

      const duelEnd = spy.sent.find(m => m.message.type === 'DUEL_END');
      expect(duelEnd).toBeDefined();
      expect(duelEnd!.message).toMatchObject({ type: 'DUEL_END', winner: 0, reason: 'timeout' });
      expect(spy.duelEnds).toHaveLength(1);
      expect(spy.replayRequests).toEqual([{ session: s, reason: 'TIMEOUT' }]);
      expect(s.awaitingResponse[1]).toBe(false);
    });

    it('clamps pool at 0 (does not go negative even on long advance)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(200);

      startTurnTimer(s);
      vi.advanceTimersByTime(5_000);

      expect(s.timerContext!.pools[0]).toBe(0);
    });

    it('SKIPPED branch — running already true, no-op + no extra broadcast', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.timerContext!.running = true;

      startTurnTimer(s);

      expect(spy.sent).toHaveLength(0);
    });

    it('SKIPPED branch — timerContext null, no-op', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.timerContext = null;

      expect(() => startTurnTimer(s)).not.toThrow();
      expect(spy.sent).toHaveLength(0);
    });
  });

  // ==========================================================================
  // pauseTurnTimer
  // ==========================================================================

  describe('pauseTurnTimer', () => {
    it('clears the interval, deducts elapsed, and broadcasts the corrected pool', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(300_000);

      startTurnTimer(s);
      vi.advanceTimersByTime(125); // mid-tick
      spy.sent.length = 0;

      pauseTurnTimer(s);

      expect(s.timerContext!.running).toBe(false);
      expect(s.timerContext!.intervalRef).toBeNull();
      // Elapsed deducted at pause time, ~125ms gone
      expect(s.timerContext!.pools[0]).toBeLessThan(300_000);
      expect(s.timerContext!.pools[0]).toBeGreaterThan(299_500);
      // Broadcast a final correct snapshot (1 message × 2 clients)
      const post = timerStateMessages(spy);
      expect(post).toHaveLength(2);
    });

    it('SKIPPED branch — running false, no-op', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      pauseTurnTimer(s);

      expect(spy.sent).toHaveLength(0);
    });

    // R6 — backward clock skew (NTP correction, container drift) used to
    // grow the pool because elapsed went negative. Now floored to 0.
    it('clamps elapsed to 0 on backward clock skew (pause path)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(300_000);

      startTurnTimer(s);
      const poolAtStart = s.timerContext!.pools[0];
      const tickAtStart = s.timerContext!.lastTickMs;

      // Roll the clock backwards 5s — simulates an NTP correction during
      // an active turn. Date.now() < lastTickMs.
      vi.setSystemTime(tickAtStart - 5_000);

      pauseTurnTimer(s);

      // Pool MUST NOT grow above its starting value.
      expect(s.timerContext!.pools[0]).toBeLessThanOrEqual(poolAtStart);
    });

    it('clamps elapsed to 0 on backward clock skew (interval tick path)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(300_000);

      startTurnTimer(s);
      const poolAtStart = s.timerContext!.pools[0];
      const tickAtStart = s.timerContext!.lastTickMs;

      // Backward jump just before the next 250ms tick fires.
      vi.setSystemTime(tickAtStart - 5_000);
      vi.advanceTimersByTime(250);

      // Pool would grow by ~5s without the floor; with it, stays put.
      expect(s.timerContext!.pools[0]).toBeLessThanOrEqual(poolAtStart);
    });
  });

  // ==========================================================================
  // scheduleTimerStart + commitPendingTimer + ANIMATIONS_DONE flow
  // ==========================================================================

  describe('scheduleTimerStart — pendingTimeout safety fallback', () => {
    it('arms pendingPlayer + pendingTimeout, does not start ticker', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      scheduleTimerStart(s, 1);

      expect(s.timerContext!.pendingPlayer).toBe(1);
      expect(s.timerContext!.pendingTimeout).not.toBeNull();
      expect(s.timerContext!.running).toBe(false);
      expect(s.timerContext!.activePlayer).toBe(1);
    });

    it('safety fallback fires after animationsDoneTimeoutMs and starts the ticker', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      scheduleTimerStart(s, 0);
      vi.advanceTimersByTime(30_000);

      expect(s.timerContext!.running).toBe(true);
      expect(s.timerContext!.pendingPlayer).toBeNull();
      expect(s.timerContext!.pendingTimeout).toBeNull();
    });

    it('clears prior pending slot before arming a new one (no double timer)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      scheduleTimerStart(s, 0);
      const firstTimeout = s.timerContext!.pendingTimeout;
      scheduleTimerStart(s, 1);

      expect(s.timerContext!.pendingTimeout).not.toBe(firstTimeout);
      expect(s.timerContext!.pendingPlayer).toBe(1);
    });
  });

  describe('commitPendingTimer — start without waiting for ANIMATIONS_DONE', () => {
    it('clears pending and starts ticker immediately', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      scheduleTimerStart(s, 1);
      commitPendingTimer(s);

      expect(s.timerContext!.pendingPlayer).toBeNull();
      expect(s.timerContext!.pendingTimeout).toBeNull();
      expect(s.timerContext!.running).toBe(true);
    });
  });

  // ==========================================================================
  // handleTurnChange — Bug C: re-arm pendingTimeout when SELECT preceded BOARD_STATE
  // ==========================================================================

  describe('handleTurnChange — Bug C re-arm logic', () => {
    it('no-op when newTurnCount <= ctx.turnCount', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.timerContext!.turnCount = 5;

      handleTurnChange(s, 0, 5);
      handleTurnChange(s, 0, 4);

      expect(s.timerContext!.turnCount).toBe(5);
    });

    it('pauses then resumes ticker if it was running', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      startTurnTimer(s);

      handleTurnChange(s, 1, 1);

      expect(s.timerContext!.activePlayer).toBe(1);
      expect(s.timerContext!.running).toBe(true);
    });

    it('Bug C — re-arms pendingTimeout for new turn player when one was pending', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      // Worker emitted SELECT before BOARD_STATE → scheduleTimerStart armed
      scheduleTimerStart(s, 0);
      expect(s.timerContext!.pendingTimeout).not.toBeNull();
      expect(s.timerContext!.pendingPlayer).toBe(0);

      // BOARD_STATE arrives with new turnCount → handleTurnChange must re-arm
      handleTurnChange(s, 0, 1);

      // After re-arm: pendingTimeout active for new turn player
      expect(s.timerContext!.pendingTimeout).not.toBeNull();
      expect(s.timerContext!.pendingPlayer).toBe(0);
      expect(s.timerContext!.running).toBe(false);
    });

    it('Bug C — pre-fix path was: silently clear pendingTimeout, never re-arm', () => {
      // Regression guard: if hadPending → re-arm. Without re-arm, ANIMATIONS_DONE
      // arrives and `pendingPlayer === null` rejects it → 30s safety fallback.
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      scheduleTimerStart(s, 1);
      handleTurnChange(s, 1, 1);

      // commitPendingTimer simulates ANIMATIONS_DONE arrival from client
      commitPendingTimer(s);
      expect(s.timerContext!.running).toBe(true);
    });

    it('does NOT re-arm when no pendingTimeout existed and timer was idle', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      handleTurnChange(s, 0, 1);

      expect(s.timerContext!.pendingTimeout).toBeNull();
      expect(s.timerContext!.running).toBe(false);
    });

    it('broadcasts both pools on turn change (Bug A fix)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      handleTurnChange(s, 1, 1);

      const snapshots = timerStateMessages(spy);
      // sendTimerStateToAll → 2 timers × 2 clients = 4
      expect(snapshots).toHaveLength(4);
      const players = snapshots.map(s => (s.message as { player: 0 | 1 }).player);
      expect(players).toContain(0);
      expect(players).toContain(1);
    });

    it('opening turns (1, 2) keep 300s pool; turn 3 first to receive +40s', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession(300_000);

      handleTurnChange(s, 0, 1);
      expect(s.timerContext!.pools[0]).toBe(300_000);

      handleTurnChange(s, 1, 2);
      expect(s.timerContext!.pools[1]).toBe(300_000);

      handleTurnChange(s, 0, 3);
      expect(s.timerContext!.pools[0]).toBe(340_000);
    });
  });

  // ==========================================================================
  // sendTimerStateToAll
  // ==========================================================================

  describe('sendTimerStateToAll', () => {
    it('emits 2 TIMER_STATE per player (one per pool) → 4 sends total', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.timerContext!.pools = [298_000, 245_000];

      sendTimerStateToAll(s);

      const ts = timerStateMessages(spy);
      expect(ts).toHaveLength(4);

      const grouped = { 0: 0, 1: 0 };
      for (const sent of ts) grouped[sent.player]++;
      expect(grouped[0]).toBe(2); // each client receives 2 timer messages
      expect(grouped[1]).toBe(2);
    });

    it('clamps negative pool values at 0 in the broadcast', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.timerContext!.pools = [-500, 100_000];

      sendTimerStateToAll(s);

      const player0Snap = timerStateMessages(spy).find(m =>
        (m.message as { player: 0 | 1 }).player === 0,
      );
      expect((player0Snap!.message as { remainingMs: number }).remainingMs).toBe(0);
    });

    it('no-op when timerContext is null', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.timerContext = null;

      expect(() => sendTimerStateToAll(s)).not.toThrow();
      expect(spy.sent).toHaveLength(0);
    });
  });

  // ==========================================================================
  // clearAllDuelTimers
  // ==========================================================================

  describe('clearAllDuelTimers', () => {
    it('clears interval, pendingTimeout, and nulls timerContext', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();

      startTurnTimer(s);
      scheduleTimerStart(s, 0);

      clearAllDuelTimers(s);

      expect(s.timerContext).toBeNull();
    });

    it('idempotent on already-cleared session', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.timerContext = null;

      expect(() => clearAllDuelTimers(s)).not.toThrow();
    });
  });

  // ==========================================================================
  // startGracePeriod — single-player + both-disconnect chain
  // ==========================================================================

  describe('startGracePeriod — single player disconnect', () => {
    it('schedules a per-player grace timer that fires DUEL_END on no reconnect', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;

      startGracePeriod(s, 0);

      expect(s.players[0].gracePeriodTimer).not.toBeNull();
      expect(spy.duelEnds).toHaveLength(0);

      vi.advanceTimersByTime(60_000);

      const duelEnd = spy.sent.find(m => m.message.type === 'DUEL_END');
      expect(duelEnd!.message).toMatchObject({ type: 'DUEL_END', winner: 1, reason: 'disconnect' });
      expect(spy.duelEnds).toHaveLength(1);
      expect(spy.replayRequests).toEqual([{ session: s, reason: 'DISCONNECT' }]);
    });

    it('does NOT fire DUEL_END if player reconnected before grace period elapsed', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;

      startGracePeriod(s, 0);
      vi.advanceTimersByTime(30_000);

      // Reconnect mid-grace
      s.players[0].connected = true;

      vi.advanceTimersByTime(40_000); // total 70s > 60s grace

      // Timer fires but the connected check guards: no DUEL_END
      expect(spy.duelEnds).toHaveLength(0);
    });

    it('does NOT fire DUEL_END if duel already ended (endedAt set)', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;
      s.endedAt = Date.now();

      startGracePeriod(s, 0);
      vi.advanceTimersByTime(60_000);

      expect(spy.duelEnds).toHaveLength(0);
    });

    it('idempotent — second call while a grace timer is already armed is a no-op', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;

      startGracePeriod(s, 0);
      const firstTimer = s.players[0].gracePeriodTimer;
      startGracePeriod(s, 0);

      expect(s.players[0].gracePeriodTimer).toBe(firstTimer);
    });
  });

  describe('startGracePeriod — both-disconnect chain', () => {
    it('cancels per-player grace and arms combined grace timer', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;

      // P0 disconnects first
      startGracePeriod(s, 0);
      expect(s.players[0].gracePeriodTimer).not.toBeNull();
      expect(s.bothDisconnected).toBe(false);

      // P1 disconnects → flips into both-disconnect path
      s.players[1].connected = false;
      startGracePeriod(s, 1);

      expect(s.bothDisconnected).toBe(true);
      expect(s.combinedGraceTimer).not.toBeNull();
      // Per-player timer for P0 was cancelled (otherIndex from P1's perspective)
      expect(s.players[0].gracePeriodTimer).toBeNull();
    });

    it('emits draw + cleanup after combined grace period when neither reconnects', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;
      s.players[1].connected = false;

      startGracePeriod(s, 1);
      vi.advanceTimersByTime(60_000);

      expect(s.combinedGraceTimer).toBeNull();
      expect(s.storedDuelResult).toMatchObject({
        type: 'DUEL_END',
        winner: null,
        reason: 'draw_both_disconnect',
      });
      expect(spy.duelEnds).toHaveLength(1);
      expect(spy.replayRequests).toEqual([{ session: s, reason: 'DISCONNECT' }]);

      // Preservation timer arms cleanup + worker termination
      expect(s.preservationTimer).not.toBeNull();
      vi.advanceTimersByTime(10_000);
      expect(spy.cleanups).toHaveLength(1);
      expect(spy.terminations).toHaveLength(1);
    });

    it('does NOT emit draw if a player reconnects before combined grace expires', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;
      s.players[1].connected = false;

      startGracePeriod(s, 1);
      vi.advanceTimersByTime(30_000);

      s.players[1].connected = true; // reconnect

      vi.advanceTimersByTime(40_000);

      expect(s.storedDuelResult).toBeNull();
      expect(spy.duelEnds).toHaveLength(0);
    });

    it('does NOT emit draw if duel already ended', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;
      s.players[1].connected = false;
      s.endedAt = Date.now();

      startGracePeriod(s, 1);
      vi.advanceTimersByTime(60_000);

      expect(s.storedDuelResult).toBeNull();
      expect(spy.duelEnds).toHaveLength(0);
    });

    it('does NOT re-arm combined timer if already armed', () => {
      const spy = makeSpy();
      configureTimerManagement(makeConfig(spy));
      const s = makeSession();
      s.players[0].connected = false;

      // Simulate first call set bothDisconnected + combined timer
      s.players[1].connected = false;
      startGracePeriod(s, 1);
      const firstCombinedTimer = s.combinedGraceTimer;

      startGracePeriod(s, 0);

      expect(s.combinedGraceTimer).toBe(firstCombinedTimer);
    });
  });
});
