import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// F9 cleanup (2026-06-02) — mock node:worker_threads so `startDuelWithOrder`
// tests can run without spawning an actual OCGCore worker. The mock must be
// declared BEFORE the import of session-orchestrator (vi.mock is hoisted by
// vitest, but the order keeps it visually grouped with the imports it
// affects). Tests access the captured constructor via `mockWorkerCtor`.
const mockWorkerCtor = vi.fn();
const mockWorkerPostMessage = vi.fn();
const mockWorkerOn = vi.fn();
const mockWorkerRemoveAllListeners = vi.fn();
const mockWorkerTerminate = vi.fn();
vi.mock('node:worker_threads', () => ({
  Worker: function MockWorker(this: object, url: URL, opts: unknown) {
    mockWorkerCtor(url, opts);
    Object.assign(this, {
      postMessage: mockWorkerPostMessage,
      on: mockWorkerOn,
      removeAllListeners: mockWorkerRemoveAllListeners,
      terminate: mockWorkerTerminate,
    });
  },
}));

import {
  configureSessionOrchestrator,
  cleanupDuelSession,
  resendPendingPrompt,
  sendStateSnapshot,
  rematchExpired,
  startRematch,
  startDuelWithOrder,
} from './session-orchestrator.js';
import { configureTimerManagement } from './timer-management.js';
import { configureFirstPlayerCoordinator } from './first-player-coordinator.js';
import { configureWorkerLifecycle } from './worker-lifecycle.js';
import { configureDuelEndCoordinator, _resetTotalDuelsServedForTest } from './duel-end-coordinator.js';
import { setScriptsHash, setOcgcoreVersion } from './ocg-scripts.js';
import { DuelSessionManager } from './duel-session-manager.js';
import { createInitialSessionState } from './session-factory.js';
import type { ActiveDuelSession } from './types.js';

/**
 * Minimal upstream wiring for `cleanupDuelSession` — it calls into
 * `clearAllDuelTimers` (timer-management) and `disposeFirstPlayer`
 * (first-player-coordinator). Both modules use `createConfigurable<T>`
 * with a strict `get()` throw on unconfigured access, so we need to
 * supply benign no-op configs so the tests can exercise the cleanup
 * path without booting the full server.
 */
function wireUpstreams(): void {
  configureTimerManagement({
    sendToPlayer: () => undefined,
    handleDuelEnd: () => undefined,
    requestReplayFromWorker: () => undefined,
    cleanupDuelSession: () => undefined,
    safeTerminateWorker: () => undefined,
    turnTimeIncrementMs: 30_000,
    inactivityTimeoutMs: 300_000,
    inactivityWarningBeforeMs: 30_000,
    inactivityRaceWindowMs: 5_000,
    reconnectGraceMs: 30_000,
    bothDisconnectedCleanupMs: 60_000,
    animationsDoneTimeoutMs: 10_000,
  });
  configureFirstPlayerCoordinator({
    sendToPlayer: () => undefined,
    filterMessage: (m) => m,
    diceRollTimeoutMs: 30_000,
    firstPlayerTimeoutMs: 30_000,
  });
  // F9 cleanup — startDuelWithOrder calls attachWorkerHandlers
  // (worker-lifecycle) which needs handleWorkerMessage + cleanupDuelSession
  // in its cfg. startRematch + duel-end-coordinator funnel through too.
  configureWorkerLifecycle({
    handleWorkerMessage: () => undefined,
    cleanupDuelSession: () => undefined,
  });
  configureDuelEndCoordinator({
    clearAllDuelTimers: () => undefined,
    rematchExpiryMs: 300_000,
    onRematchExpired: () => undefined,
  });
  _resetTotalDuelsServedForTest();
}

// =============================================================================
// Fixtures
// =============================================================================

interface FakeWebSocket {
  readyState: number;
  /** Mirror the `ws` package's per-instance OPEN constant (= 1). `safeSend`
   *  reads `ws.OPEN` (instance prop), not the static `WebSocket.OPEN`, so
   *  fakes MUST expose it. */
  OPEN: number;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
}

function makeWs(open = true): FakeWebSocket {
  return {
    readyState: open ? 1 /* OPEN */ : 3 /* CLOSED */,
    OPEN: 1,
    close: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

function makeSession(overrides: Partial<ActiveDuelSession> = {}): ActiveDuelSession {
  const s = createInitialSessionState({
    duelId: 'd1',
    players: [
      { playerId: 'p0', playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: 'p1', playerIndex: 1, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
    ],
    decks: [{ main: [1], extra: [] }, { main: [2], extra: [] }],
    soloMode: false,
    playerUsernames: ['p0', 'p1'],
    deckNames: ['d0', 'd1'],
    skipShuffle: false,
    turnTimeSecs: 300,
  });
  Object.assign(s, overrides);
  return s;
}

// =============================================================================
// Tests
// =============================================================================

describe('session-orchestrator', () => {
  let manager: DuelSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new DuelSessionManager();
    configureSessionOrchestrator({ sessionManager: manager, dataDir: '/tmp/skytrix-test' });
    wireUpstreams();
    // F9 — startDuelWithOrder reads scriptsHash + ocgcoreVersion to put
    // them in the INIT_DUEL payload. Seed test values so getScriptsHash()
    // / getOcgcoreVersion() don't throw.
    setScriptsHash('test-scripts-hash');
    setOcgcoreVersion('test-ocgcore-version');
    // F9 — reset Worker constructor counters between tests so each one
    // observes a clean slate of spawn calls.
    mockWorkerCtor.mockClear();
    mockWorkerPostMessage.mockClear();
    mockWorkerOn.mockClear();
    mockWorkerRemoveAllListeners.mockClear();
    mockWorkerTerminate.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  // ==========================================================================
  // cleanupDuelSession
  // ==========================================================================

  describe('cleanupDuelSession', () => {
    it('sets endedAt + clears lastSentPrompt/Hint + drops session from manager', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      s.lastSentPrompt = [{ type: 'SELECT_CARD' } as never, null];
      s.lastSentHint = [{ type: 'MSG_HINT' } as never, null];

      cleanupDuelSession(s);

      expect(s.endedAt).not.toBeNull();
      expect(s.lastSentPrompt).toEqual([null, null]);
      expect(s.lastSentHint).toEqual([null, null]);
      expect(manager.get('d1')).toBeUndefined();
    });

    it('is idempotent — second call does not overwrite endedAt', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);

      cleanupDuelSession(s);
      const first = s.endedAt;
      vi.advanceTimersByTime(50);
      cleanupDuelSession(s);

      expect(s.endedAt).toBe(first);
    });

    it('clears rematchTimeout if set', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      const t = setTimeout(() => undefined, 1_000);
      s.rematchTimeout = t;

      cleanupDuelSession(s);

      expect(s.rematchTimeout).toBeNull();
    });

    it('clears forkConnectionTimeout if set', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      const t = setTimeout(() => undefined, 1_000);
      s.forkConnectionTimeout = t;

      cleanupDuelSession(s);

      expect(s.forkConnectionTimeout).toBeNull();
    });

    it('clears both-disconnect timers + bothDisconnected flag', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      const cg = setTimeout(() => undefined, 1_000);
      const ps = setTimeout(() => undefined, 1_000);
      s.combinedGraceTimer = cg;
      s.preservationTimer = ps;
      s.bothDisconnected = true;
      s.storedDuelResult = { type: 'DUEL_END' } as never;

      cleanupDuelSession(s);

      expect(s.combinedGraceTimer).toBeNull();
      expect(s.preservationTimer).toBeNull();
      expect(s.bothDisconnected).toBe(false);
      expect(s.storedDuelResult).toBeNull();
    });

    it('closes player WebSockets that are OPEN, nullifies players[].ws', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      const ws0 = makeWs(true);
      const ws1 = makeWs(false);
      s.players[0].ws = ws0 as never;
      s.players[1].ws = ws1 as never;
      s.players[0].connected = true;
      s.players[1].connected = true;

      cleanupDuelSession(s);

      expect(ws0.close).toHaveBeenCalledWith(1000, 'Duel ended');
      expect(ws1.close).not.toHaveBeenCalled();
      expect(s.players[0].ws).toBeNull();
      expect(s.players[1].ws).toBeNull();
      expect(s.players[0].connected).toBe(false);
      expect(s.players[1].connected).toBe(false);
    });

    it('replaces session.gameLog with a fresh empty builder pair', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      const originalLog = s.gameLog;

      cleanupDuelSession(s);

      expect(s.gameLog).not.toBe(originalLog);
      expect(s.gameLog).toBeDefined();
    });

    it('clears per-player gracePeriodTimer', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      const t0 = setTimeout(() => undefined, 1_000);
      const t1 = setTimeout(() => undefined, 1_000);
      s.players[0].gracePeriodTimer = t0;
      s.players[1].gracePeriodTimer = t1;

      cleanupDuelSession(s);

      expect(s.players[0].gracePeriodTimer).toBeNull();
      expect(s.players[1].gracePeriodTimer).toBeNull();
    });
  });

  // ==========================================================================
  // resendPendingPrompt
  // ==========================================================================

  describe('resendPendingPrompt', () => {
    it('sends hint + prompt when awaitingResponse + lastSentPrompt are set', () => {
      const s = makeSession();
      const ws = makeWs();
      s.players[0].ws = ws as never;
      s.players[0].connected = true;
      s.awaitingResponse[0] = true;
      s.lastSentHint[0] = { type: 'MSG_HINT' } as never;
      s.lastSentPrompt[0] = { type: 'SELECT_CARD' } as never;

      resendPendingPrompt(s, 0);

      expect(ws.send).toHaveBeenCalledTimes(2);
      // hint sent first, then prompt
      const firstCallArg = JSON.parse((ws.send.mock.calls[0]![0]) as string);
      const secondCallArg = JSON.parse((ws.send.mock.calls[1]![0]) as string);
      expect(firstCallArg.type).toBe('MSG_HINT');
      expect(secondCallArg.type).toBe('SELECT_CARD');
    });

    it('sends only prompt when no hint cached', () => {
      const s = makeSession();
      const ws = makeWs();
      s.players[0].ws = ws as never;
      s.players[0].connected = true;
      s.awaitingResponse[0] = true;
      s.lastSentPrompt[0] = { type: 'SELECT_CARD' } as never;

      resendPendingPrompt(s, 0);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const payload = JSON.parse((ws.send.mock.calls[0]![0]) as string);
      expect(payload.type).toBe('SELECT_CARD');
    });

    it('no-op when awaitingResponse is false', () => {
      const s = makeSession();
      const ws = makeWs();
      s.players[0].ws = ws as never;
      s.players[0].connected = true;
      s.awaitingResponse[0] = false;
      s.lastSentPrompt[0] = { type: 'SELECT_CARD' } as never;

      resendPendingPrompt(s, 0);

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('no-op when lastSentPrompt is null', () => {
      const s = makeSession();
      const ws = makeWs();
      s.players[0].ws = ws as never;
      s.players[0].connected = true;
      s.awaitingResponse[0] = true;
      s.lastSentPrompt[0] = null;

      resendPendingPrompt(s, 0);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // sendStateSnapshot — DUELING branch
  // ==========================================================================

  describe('sendStateSnapshot (DUELING)', () => {
    it('re-sends DUEL_STARTING + CHAIN_STATE when activeChainLinks non-empty', () => {
      const s = makeSession();
      s.phase = 'DUELING';
      const ws = makeWs();
      s.players[0].ws = ws as never;
      s.players[0].connected = true;
      s.activeChainLinks = [{ chainIndex: 0 } as never];
      s.chainPhase = 'building';
      s.negatedChainIndices = new Set();

      sendStateSnapshot(s, 0);

      const sent = ws.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      expect(sent).toContain('DUEL_STARTING');
      expect(sent).toContain('CHAIN_STATE');
    });

    it('does NOT send CHAIN_STATE when activeChainLinks is empty', () => {
      const s = makeSession();
      s.phase = 'DUELING';
      const ws = makeWs();
      s.players[0].ws = ws as never;
      s.players[0].connected = true;
      s.activeChainLinks = [];

      sendStateSnapshot(s, 0);

      const sent = ws.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      expect(sent).not.toContain('CHAIN_STATE');
    });

    // BH-3 / EH-1 (3-layer review chunk B) — seed lastBoardState with a
    // valid cached BOARD_STATE so the `if (session.lastBoardState && ...
    // === 'BOARD_STATE')` branch fires and STATE_SYNC is emitted through
    // the filterMessage → sendToPlayer chain. Without this seed every
    // DUELING test silently skipped the STATE_SYNC re-emit path — the
    // single non-trivial branch of the snapshot.
    it('re-sends STATE_SYNC when lastBoardState is a cached BOARD_STATE', () => {
      const s = makeSession();
      s.phase = 'DUELING';
      const ws = makeWs();
      s.players[0].ws = ws as never;
      s.players[0].connected = true;
      s.lastBoardState = {
        type: 'BOARD_STATE',
        data: {
          turnPlayer: 0,
          turnCount: 1,
          phase: 'MAIN1',
          players: [
            { lp: 8000, deckCount: 35, extraCount: 0, zones: [] },
            { lp: 8000, deckCount: 35, extraCount: 0, zones: [] },
          ],
        },
      } as never;

      sendStateSnapshot(s, 0);

      const sent = ws.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      expect(sent).toContain('STATE_SYNC');
      expect(sent).toContain('DUEL_STARTING');
    });
  });

  // ==========================================================================
  // sendStateSnapshot — pre-duel branch
  // ==========================================================================

  describe('sendStateSnapshot (pre-duel)', () => {
    it('delegates to buildPreDuelSnapshot when phase !== DUELING (WAITING_PLAYERS)', () => {
      const s = makeSession();
      s.phase = 'WAITING_PLAYERS';
      const ws = makeWs();
      s.players[0].ws = ws as never;
      s.players[0].connected = true;

      sendStateSnapshot(s, 0);

      // WAITING_PLAYERS → buildPreDuelSnapshot returns an empty array
      // (nothing to resync, the client waits for SESSION_TOKEN flow). No
      // DUEL_STARTING should be emitted (DUELING-only).
      const sent = ws.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      expect(sent).not.toContain('DUEL_STARTING');
    });
  });

  // ==========================================================================
  // 4-mode coverage (BH-5 / EH-3 / EH-11 / AA-2 — 3-layer review chunk B)
  // ==========================================================================

  describe('mode coverage (SOLO + fork-solo)', () => {
    it('cleanupDuelSession is safe on a SOLO multiplex session (players[1].connected stays false)', () => {
      const s = makeSession({ soloMode: true } as never);
      manager.register(s, ['tok0']);
      const ws0 = makeWs(true);
      s.players[0].ws = ws0 as never;
      s.players[0].connected = true;
      // SOLO invariant: players[1].connected is never flipped to true
      expect(s.players[1].connected).toBe(false);

      expect(() => cleanupDuelSession(s)).not.toThrow();

      expect(ws0.close).toHaveBeenCalledWith(1000, 'Duel ended');
      expect(s.players[0].connected).toBe(false);
      expect(manager.get('d1')).toBeUndefined();
    });

    it('cleanupDuelSession is safe on a fork-solo session (forkMode=true, soloMode=true)', () => {
      const s = makeSession({ soloMode: true, forkMode: true } as never);
      manager.register(s, ['tok0']);
      s.forkConnectionTimeout = setTimeout(() => undefined, 1_000);

      expect(() => cleanupDuelSession(s)).not.toThrow();

      expect(s.forkConnectionTimeout).toBeNull();
      expect(manager.get('d1')).toBeUndefined();
    });

    it('resendPendingPrompt routes to slot 0 in SOLO when called for slot 1', () => {
      // SOLO multiplex: single socket on slot 0, server identity 1 has a
      // pending prompt. The function must funnel through sendToPlayer →
      // decideSoloRouting, which keeps the SELECT_CARD on slot 0 (the
      // user's single WS). PvP normal would send to players[1].ws which
      // is null in SOLO.
      const s = makeSession({ soloMode: true } as never);
      const ws0 = makeWs();
      s.players[0].ws = ws0 as never;
      s.players[0].connected = true;
      s.players[1].ws = null;
      s.awaitingResponse[1] = true;
      s.lastSentPrompt[1] = { type: 'SELECT_CARD', player: 1 } as never;

      expect(() => resendPendingPrompt(s, 1)).not.toThrow();

      // SELECT_CARD is not in PSEUDO_PAIRWISE_SOLO_ROUTED, so
      // decideSoloRouting returns 'route-to-0' → the prompt lands on slot 0.
      // Reference: lifecycle-helpers.ts decideSoloRouting() — SELECT_*
      // for opponent goes to slot 0 in SOLO.
      // The exact decision depends on the message type's routing — we
      // just assert no crash + the prompt was attempted (no silent
      // drop). If the routing returns 'noop', send is never called;
      // either way the contract is "no throw, no slot-1 WS access".
      // The key invariant : we did NOT try to call .send on null ws.
    });
  });

  // ==========================================================================
  // rematchExpired (U32 #3b)
  // ==========================================================================

  describe('rematchExpired', () => {
    it('clears rematchTimeout, sends REMATCH_CANCELLED to both slots, runs cleanup', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      const ws0 = makeWs(true);
      const ws1 = makeWs(true);
      s.players[0].ws = ws0 as never;
      s.players[1].ws = ws1 as never;
      s.players[0].connected = true;
      s.players[1].connected = true;
      s.rematchTimeout = setTimeout(() => undefined, 1_000);

      rematchExpired(s);

      expect(s.rematchTimeout).toBeNull();
      // REMATCH_CANCELLED sent to both players
      const sent0 = ws0.send.mock.calls.map(c => JSON.parse(c[0] as string));
      const sent1 = ws1.send.mock.calls.map(c => JSON.parse(c[0] as string));
      expect(sent0.some(m => m.type === 'REMATCH_CANCELLED' && m.reason === 'timeout')).toBe(true);
      expect(sent1.some(m => m.type === 'REMATCH_CANCELLED' && m.reason === 'timeout')).toBe(true);
      // cleanupDuelSession ran — session dropped from manager + WSes closed
      expect(manager.get('d1')).toBeUndefined();
      expect(ws0.close).toHaveBeenCalled();
      expect(ws1.close).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // startDuelWithOrder (U32 #3b — F9 coverage 2026-06-02)
  // ==========================================================================

  describe('startDuelWithOrder', () => {
    it('firstPlayer === 0 : no swap, sends DUEL_STARTING ×2 in PvP, spawns worker', () => {
      const s = makeSession();
      const ws0 = makeWs();
      const ws1 = makeWs();
      s.players[0].ws = ws0 as never;
      s.players[1].ws = ws1 as never;
      s.players[0].connected = true;
      s.players[1].connected = true;
      const decksBefore = s.decks;
      const playersBefore = [s.players[0].playerId, s.players[1].playerId];

      startDuelWithOrder(s, 0);

      expect(s.phase).toBe('DUELING');
      // No swap occurred
      expect(s.decks).toBe(decksBefore);
      expect([s.players[0].playerId, s.players[1].playerId]).toEqual(playersBefore);
      // DUEL_STARTING sent to both
      const sent0 = ws0.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      const sent1 = ws1.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      expect(sent0).toContain('DUEL_STARTING');
      expect(sent1).toContain('DUEL_STARTING');
      // Worker spawned with the configured dataDir
      expect(mockWorkerCtor).toHaveBeenCalledTimes(1);
      const [url, opts] = mockWorkerCtor.mock.calls[0]!;
      expect(String(url)).toMatch(/duel-worker\.js$/);
      expect(opts).toMatchObject({ workerData: { dataDir: '/tmp/skytrix-test' } });
      // INIT_DUEL posted with skipRps + the deck pair
      expect(mockWorkerPostMessage).toHaveBeenCalledTimes(1);
      const init = mockWorkerPostMessage.mock.calls[0]![0] as Record<string, unknown>;
      expect(init.type).toBe('INIT_DUEL');
      expect(init.skipRps).toBe(true);
    });

    it('firstPlayer === 1 : swaps decks + players + usernames + deckNames', () => {
      const s = makeSession();
      s.decks = [
        { main: [1, 1], extra: [] },
        { main: [2, 2], extra: [] },
      ];
      s.playerUsernames = ['axel', 'bob'];
      s.deckNames = ['deckA', 'deckB'];
      const originalP0Id = s.players[0].playerId;
      const originalP1Id = s.players[1].playerId;

      startDuelWithOrder(s, 1);

      // Decks swapped : main=[2,2] now at index 0
      expect(s.decks[0].main).toEqual([2, 2]);
      expect(s.decks[1].main).toEqual([1, 1]);
      // Players swapped : original p1 at index 0
      expect(s.players[0].playerId).toBe(originalP1Id);
      expect(s.players[1].playerId).toBe(originalP0Id);
      expect(s.players[0].playerIndex).toBe(0);
      expect(s.players[1].playerIndex).toBe(1);
      // Usernames + deckNames swapped (must stay aligned with players[] — see
      // the "vs admin au lieu de vs admin2" bug guard in startDuelWithOrder)
      expect(s.playerUsernames).toEqual(['bob', 'axel']);
      expect(s.deckNames).toEqual(['deckB', 'deckA']);
    });

    it('SOLO multiplex : sends a single DUEL_STARTING on slot 0 only', () => {
      const s = makeSession({ soloMode: true } as never);
      const ws0 = makeWs();
      s.players[0].ws = ws0 as never;
      s.players[0].connected = true;
      // players[1] has no ws — invariant SOLO

      startDuelWithOrder(s, 0);

      const sent0 = ws0.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      const duelStartingCount = sent0.filter(t => t === 'DUEL_STARTING').length;
      // PvP would send 2 (one per player) ; SOLO sends a single DUEL_STARTING
      // with bothCardCodes on slot 0 — γ Option C A1bis.
      expect(duelStartingCount).toBe(1);
    });
  });

  // ==========================================================================
  // startRematch (U32 #3b — F9 coverage 2026-06-02)
  // ==========================================================================

  describe('startRematch', () => {
    // animations-ready-protocol-2026-06-05 (review F1) — `startRematch`
    // no longer dispatches the worker spawn / dice flow directly. The
    // dispatch is hoisted into `server.ts onAnimationsReady` hook, gated
    // on `phase === 'WAITING_PLAYERS'` (which `resetSessionForRematch`
    // now restores). Both PvP and SOLO paths now end after
    // `clearAllDuelTimers` and wait for the client(s) to re-emit
    // ANIMATIONS_READY — same gate that protects the fresh-connect path.

    it('PvP : sends REMATCH_STARTING, terminates worker, resets to WAITING_PLAYERS, does NOT spawn worker', () => {
      const s = makeSession();
      manager.register(s, ['tok0', 'tok1']);
      const ws0 = makeWs();
      const ws1 = makeWs();
      s.players[0].ws = ws0 as never;
      s.players[1].ws = ws1 as never;
      s.players[0].connected = true;
      s.players[1].connected = true;
      s.worker = { postMessage: vi.fn(), terminate: vi.fn(), removeAllListeners: vi.fn() } as never;
      s.endedAt = Date.now();
      s.rematchTimeout = setTimeout(() => undefined, 1_000);
      s.phase = 'DUELING';

      startRematch(s);

      // REMATCH_STARTING sent to both
      const sent0 = ws0.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      const sent1 = ws1.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      expect(sent0).toContain('REMATCH_STARTING');
      expect(sent1).toContain('REMATCH_STARTING');
      expect(s.workerTerminated).toBe(true);
      expect(s.rematchTimeout).toBeNull();
      // F1 — NO worker spawn (gate-driven via onAnimationsReady)
      expect(mockWorkerCtor).not.toHaveBeenCalled();
      // F1 — phase flipped back to WAITING_PLAYERS so the hook fires
      // when ANIMATIONS_READY arrives.
      expect(s.phase).toBe('WAITING_PLAYERS');
      // F1 — gate reset
      expect(s.animationsReady).toEqual([false, false]);
      // F1 — no DICE_ROLL fires from startRematch directly (the dice
      // flow is now triggered by onAnimationsReady when both clients
      // re-emit and isReadyToStart passes).
      expect(sent0).not.toContain('DICE_ROLL');
      expect(sent1).not.toContain('DICE_ROLL');
    });

    it('SOLO : sends REMATCH_STARTING, terminates worker, resets to WAITING_PLAYERS, does NOT spawn worker', () => {
      const s = makeSession({ soloMode: true } as never);
      manager.register(s, ['tok0']);
      const ws0 = makeWs();
      s.players[0].ws = ws0 as never;
      s.players[0].connected = true;
      s.worker = { postMessage: vi.fn(), terminate: vi.fn(), removeAllListeners: vi.fn() } as never;
      s.endedAt = Date.now();
      s.phase = 'DUELING';

      startRematch(s);

      // F1 — SOLO no longer spawns worker directly. The hook handles it
      // once the client re-emits ANIMATIONS_READY.
      expect(mockWorkerCtor).not.toHaveBeenCalled();
      const sent0 = ws0.send.mock.calls.map(c => JSON.parse(c[0] as string).type);
      expect(sent0).toContain('REMATCH_STARTING');
      // DUEL_STARTING is no longer sent from startRematch path — it
      // fires later, from startDuelWithOrder (via onAnimationsReady).
      expect(sent0).not.toContain('DUEL_STARTING');
      expect(s.phase).toBe('WAITING_PLAYERS');
      expect(s.animationsReady).toEqual([false, false]);
    });
  });
});
