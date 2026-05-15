import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureClientMessageRouter,
  handleClientMessage,
  type ClientMessageRouterConfig,
} from './client-message-router.js';
import { configureWorkerLifecycle, _resetTotalDuelsServedForTest } from './worker-lifecycle.js';
import { configureTimerManagement } from './timer-management.js';
import { configureFirstPlayerCoordinator } from './first-player-coordinator.js';
import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, ClientMessage, Player } from './ws-protocol.js';

// =============================================================================
// Fixtures
// =============================================================================

interface SentMessage { player: 0 | 1; message: ServerMessage }
interface SpyHooks {
  sent: SentMessage[];
  rematches: ActiveDuelSession[];
  stateSyncs: { session: ActiveDuelSession; playerIndex: 0 | 1 }[];
  workerPosts: unknown[];
}

function makeSpy(): SpyHooks {
  return { sent: [], rematches: [], stateSyncs: [], workerPosts: [] };
}

function makeConfig(spy: SpyHooks, overrides: Partial<ClientMessageRouterConfig> = {}): ClientMessageRouterConfig {
  return {
    sendToPlayer: (_s, p, message) => spy.sent.push({ player: p, message }),
    startRematch: (s) => spy.rematches.push(s),
    onStateSyncRequested: (session, playerIndex) => spy.stateSyncs.push({ session, playerIndex }),
    maxInvalidResponses: 5,
    stateSyncRateLimitMs: 5000,
    cancelPromptRateLimitMs: 1000,
    ...overrides,
  };
}

interface FakeWorker {
  postMessage: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function makeWorker(spy: SpyHooks): FakeWorker {
  return {
    postMessage: vi.fn().mockImplementation((m: unknown) => { spy.workerPosts.push(m); }),
    removeAllListeners: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
  };
}

interface FakeWebSocket {
  readyState: number;
  OPEN: number;
  send: ReturnType<typeof vi.fn>;
  // Captures arguments passed to safeSend (which uses .send under the hood).
  _sent: unknown[];
}

function makeWs(): FakeWebSocket {
  const ws: FakeWebSocket = { readyState: 1, OPEN: 1, send: vi.fn(), _sent: [] };
  ws.send.mockImplementation((data: unknown) => { ws._sent.push(data); });
  return ws;
}

function makeSession(spy: SpyHooks, opts: { withWorker?: boolean; phase?: 'DUELING' | 'ROLLING_DICE' | 'WAITING_PLAYERS' } = {}): ActiveDuelSession & { worker: FakeWorker | null; players: ActiveDuelSession['players'] } {
  const worker = opts.withWorker !== false ? makeWorker(spy) : null;
  const ws0 = makeWs();
  const ws1 = makeWs();
  return {
    duelId: 'd1',
    players: [
      { playerId: '100', playerIndex: 0, ws: ws0 as unknown as ActiveDuelSession['players'][0]['ws'], connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: '200', playerIndex: 1, ws: ws1 as unknown as ActiveDuelSession['players'][0]['ws'], connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
    ],
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    phase: opts.phase ?? 'DUELING',
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
    timerContext: {
      pools: [300_000, 300_000],
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
  } as unknown as ActiveDuelSession & { worker: FakeWorker | null };
}

function wireUpstreams(): void {
  _resetTotalDuelsServedForTest();
  configureWorkerLifecycle({
    handleWorkerMessage: () => undefined,
    cleanupDuelSession: () => undefined,
    clearAllDuelTimers: () => undefined,
    rematchExpiryMs: 1000,
    onRematchExpired: () => undefined,
  });
  configureTimerManagement({
    sendToPlayer: () => undefined,
    handleDuelEnd: () => undefined,
    requestReplayFromWorker: () => undefined,
    cleanupDuelSession: () => undefined,
    safeTerminateWorker: () => undefined,
    turnTimeIncrementMs: 40_000,
    inactivityTimeoutMs: 120_000,
    inactivityWarningBeforeMs: 20_000,
    inactivityRaceWindowMs: 500,
    reconnectGraceMs: 60_000,
    bothDisconnectedCleanupMs: 10_000,
    animationsDoneTimeoutMs: 30_000,
  });
  configureFirstPlayerCoordinator({
    sendToPlayer: () => undefined,
    filterMessage: (m) => m,
    startDuelWithOrder: () => undefined,
    diceRollTimeoutMs: 30_000,
    firstPlayerTimeoutMs: 15_000,
  });
}

function findMsg(spy: SpyHooks, type: string): SentMessage | undefined {
  return spy.sent.find(x => x.message.type === type);
}
function allMsgs(spy: SpyHooks, type: string): SentMessage[] {
  return spy.sent.filter(x => x.message.type === type);
}

// =============================================================================
// Tests
// =============================================================================

describe('client-message-router', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wireUpstreams();
  });
  afterEach(() => vi.useRealTimers());

  // ==========================================================================
  // Type allow-list
  // ==========================================================================

  describe('type allow-list', () => {
    it('drops unknown message types', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);

      handleClientMessage(s, 0, { type: 'NOPE' } as unknown as ClientMessage);

      expect(spy.sent).toHaveLength(0);
      expect(spy.workerPosts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // PLAYER_RESPONSE — awaitingResponse gate (anti-spam)
  // ==========================================================================

  describe('PLAYER_RESPONSE — awaitingResponse gate', () => {
    it('drops when awaitingResponse[player]=false', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      // awaitingResponse stays [false, false]

      handleClientMessage(s, 0, {
        type: 'PLAYER_RESPONSE', promptType: 'SELECT_CARD', data: {},
      } as unknown as ClientMessage);

      expect(spy.workerPosts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // PLAYER_RESPONSE — M28 promptType mismatch
  // ==========================================================================

  describe('PLAYER_RESPONSE — M28 promptType mismatch', () => {
    it('sends ERROR + does not forward when promptType disagrees with the in-flight prompt', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      s.awaitingResponse[0] = true;
      s.lastSentPrompt[0] = { type: 'SELECT_IDLECMD', player: 0 } as unknown as ServerMessage;

      handleClientMessage(s, 0, {
        type: 'PLAYER_RESPONSE', promptType: 'SELECT_CARD', data: {},
      } as unknown as ClientMessage);

      // Pulled from the player's ws._sent (safeSend writes there).
      const ws0 = s.players[0].ws as unknown as { _sent: unknown[] };
      const errStr = ws0._sent.find(x => typeof x === 'string' && x.includes('"type":"ERROR"')) as string | undefined;
      expect(errStr).toBeDefined();
      expect(errStr).toContain('Expected prompt type SELECT_IDLECMD');
      expect(spy.workerPosts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // PLAYER_RESPONSE — pre-duel branch
  // ==========================================================================

  describe('PLAYER_RESPONSE — pre-duel', () => {
    it('skips the worker forwarding when handlePreDuelResponse returns true', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      // ROLLING_DICE-phase session with a valid first-player state set up.
      const s = makeSession(spy, { phase: 'ROLLING_DICE' });
      s.firstPlayerState = { rolls: [null, null], timers: [], round: 0, resolvedWinner: null };
      s.awaitingResponse[0] = true;

      handleClientMessage(s, 0, {
        type: 'PLAYER_RESPONSE', promptType: 'DICE_ROLL', data: {},
      } as unknown as ClientMessage);

      // Dice handler consumed the response → not forwarded to the worker.
      expect(spy.workerPosts).toHaveLength(0);
      expect(s.firstPlayerState!.rolls[0]).not.toBeNull();
    });
  });

  // ==========================================================================
  // PLAYER_RESPONSE — validateResponseData strike loop
  // ==========================================================================

  describe('PLAYER_RESPONSE — invalid-data strike loop', () => {
    it('increments invalidResponseCount + re-sends the prompt (not forwarded)', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      const prompt: ServerMessage = {
        type: 'SELECT_CARD', player: 0, cards: [{ index: 0 } as unknown as never],
        min: 1, max: 1, hint: 0,
      } as unknown as ServerMessage;
      s.awaitingResponse[0] = true;
      s.lastSentPrompt[0] = prompt;

      // indices out of bounds → validateResponseData fails.
      handleClientMessage(s, 0, {
        type: 'PLAYER_RESPONSE', promptType: 'SELECT_CARD', data: { indices: [99] },
      } as unknown as ClientMessage);

      expect(s.invalidResponseCount[0]).toBe(1);
      expect(spy.workerPosts).toHaveLength(0);
      // Prompt re-sent to player 0 (via sendToPlayer spy).
      const resends = allMsgs(spy, 'SELECT_CARD');
      expect(resends).toHaveLength(1);
      expect(resends[0]!.player).toBe(0);
    });

    it('forfeits the spammer at maxInvalidResponses', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy, { maxInvalidResponses: 3 }));
      const s = makeSession(spy);
      const prompt: ServerMessage = {
        type: 'SELECT_CARD', player: 0, cards: [{ index: 0 } as unknown as never],
        min: 1, max: 1, hint: 0,
      } as unknown as ServerMessage;
      s.awaitingResponse[0] = true;
      s.lastSentPrompt[0] = prompt;
      s.invalidResponseCount[0] = 2;

      handleClientMessage(s, 0, {
        type: 'PLAYER_RESPONSE', promptType: 'SELECT_CARD', data: { indices: [99] },
      } as unknown as ClientMessage);

      const ends = allMsgs(spy, 'DUEL_END');
      expect(ends).toHaveLength(2);
      const m = ends[0]!.message as Extract<ServerMessage, { type: 'DUEL_END' }>;
      expect(m.winner).toBe(1);
      expect(m.reason).toBe('too_many_invalid_responses');
      expect(s.endedAt).not.toBeNull();
    });
  });

  // ==========================================================================
  // PLAYER_RESPONSE — happy path
  // ==========================================================================

  describe('PLAYER_RESPONSE — happy path', () => {
    function arriveAtValidIdleResponse(spy: SpyHooks): ActiveDuelSession & { worker: FakeWorker | null } {
      const s = makeSession(spy);
      s.awaitingResponse[0] = true;
      s.lastSentPrompt[0] = { type: 'SELECT_IDLECMD', player: 0 } as unknown as ServerMessage;
      // Track that a hint was set so we can pin it gets dropped.
      s.lastSentHint[0] = { type: 'MSG_HINT' } as unknown as ServerMessage;
      return s as ActiveDuelSession & { worker: FakeWorker | null };
    }

    it('on SELECT_IDLECMD commit: snapshots cancelTargetPrompt + resets strikes + clears hint', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = arriveAtValidIdleResponse(spy);
      const captured = s.lastSentPrompt[0];

      handleClientMessage(s, 0, {
        type: 'PLAYER_RESPONSE', promptType: 'SELECT_IDLECMD', data: { action: 0 },
      } as unknown as ClientMessage);

      expect(s.invalidResponseCount[0]).toBe(0);
      expect(s.awaitingResponse[0]).toBe(false);
      expect(s.lastSentHint[0]).toBeNull();
      expect(s.cancelTargetPrompt[0]).toBe(captured);
      // Forwarded to the worker.
      expect(spy.workerPosts).toHaveLength(1);
      expect(spy.workerPosts[0]).toMatchObject({
        type: 'PLAYER_RESPONSE', playerIndex: 0, promptType: 'SELECT_IDLECMD',
      });
    });

    it('on SELECT_BATTLECMD commit: also snapshots cancelTargetPrompt', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      const prompt = { type: 'SELECT_BATTLECMD', player: 1 } as unknown as ServerMessage;
      s.awaitingResponse[1] = true;
      s.lastSentPrompt[1] = prompt;

      handleClientMessage(s, 1, {
        type: 'PLAYER_RESPONSE', promptType: 'SELECT_BATTLECMD', data: { action: 0 },
      } as unknown as ClientMessage);

      expect(s.cancelTargetPrompt[1]).toBe(prompt);
    });

    it('on mid-chain SELECT_CARD commit: does NOT touch cancelTargetPrompt', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      const existingCache = { type: 'SELECT_IDLECMD', player: 0 } as unknown as ServerMessage;
      s.cancelTargetPrompt[0] = existingCache;
      s.awaitingResponse[0] = true;
      s.lastSentPrompt[0] = {
        type: 'SELECT_CARD', player: 0, cards: [{ index: 0 } as unknown as never],
        min: 1, max: 1, hint: 0,
      } as unknown as ServerMessage;

      handleClientMessage(s, 0, {
        type: 'PLAYER_RESPONSE', promptType: 'SELECT_CARD', data: { indices: [0] },
      } as unknown as ClientMessage);

      expect(s.cancelTargetPrompt[0]).toBe(existingCache);
    });

    it('skips worker forwarding when duel ended (endedAt set)', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = arriveAtValidIdleResponse(spy);
      s.endedAt = Date.now();

      handleClientMessage(s, 0, {
        type: 'PLAYER_RESPONSE', promptType: 'SELECT_IDLECMD', data: { action: 0 },
      } as unknown as ClientMessage);

      expect(spy.workerPosts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // SURRENDER
  // ==========================================================================

  describe('SURRENDER', () => {
    it('emits DUEL_END(winner=opponent, reason=surrender) + marks endedAt', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);

      handleClientMessage(s, 1, { type: 'SURRENDER' } as ClientMessage);

      const ends = allMsgs(spy, 'DUEL_END');
      expect(ends).toHaveLength(2);
      const m = ends[0]!.message as Extract<ServerMessage, { type: 'DUEL_END' }>;
      expect(m.winner).toBe(0);
      expect(m.reason).toBe('surrender');
      expect(s.endedAt).not.toBeNull();
    });
  });

  // ==========================================================================
  // REMATCH_REQUEST
  // ==========================================================================

  describe('REMATCH_REQUEST', () => {
    it('is rejected when duel is still active (endedAt null)', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);

      handleClientMessage(s, 0, { type: 'REMATCH_REQUEST' } as ClientMessage);

      expect(s.rematchRequested[0]).toBe(false);
      expect(spy.rematches).toHaveLength(0);
    });

    it('sends REMATCH_INVITATION to the other player on the first request', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      s.endedAt = Date.now();

      handleClientMessage(s, 0, { type: 'REMATCH_REQUEST' } as ClientMessage);

      expect(s.rematchRequested[0]).toBe(true);
      const inv = findMsg(spy, 'REMATCH_INVITATION');
      expect(inv?.player).toBe(1);
      expect(spy.rematches).toHaveLength(0);
    });

    it('starts rematch when both players have requested', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      s.endedAt = Date.now();
      s.rematchRequested[1] = true;

      handleClientMessage(s, 0, { type: 'REMATCH_REQUEST' } as ClientMessage);

      expect(spy.rematches).toEqual([s]);
    });
  });

  // ==========================================================================
  // ACTIVITY_PING
  // ==========================================================================

  describe('ACTIVITY_PING', () => {
    it('no-op when awaitingResponse[player]=false (player is not being prompted)', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);

      expect(() => handleClientMessage(s, 0, { type: 'ACTIVITY_PING' } as ClientMessage)).not.toThrow();
    });

    it('resets the inactivity timer when the player is being prompted', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      s.awaitingResponse[0] = true;
      // Place a fake inactivity slot to verify clear was called (timer-management
      // sets/clears `session.players[p].inactivitySlot` per-player).

      expect(() => handleClientMessage(s, 0, { type: 'ACTIVITY_PING' } as ClientMessage)).not.toThrow();
    });
  });

  // ==========================================================================
  // ANIMATIONS_DONE
  // ==========================================================================

  describe('ANIMATIONS_DONE', () => {
    it('commits the parked turn-timer when pendingPlayer matches', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      s.timerContext!.pendingPlayer = 0;
      s.timerContext!.pendingTimeout = setTimeout(() => undefined, 30_000);

      handleClientMessage(s, 0, { type: 'ANIMATIONS_DONE' } as ClientMessage);

      expect(s.timerContext!.pendingPlayer).toBeNull();
      expect(s.timerContext!.pendingTimeout).toBeNull();
    });

    it('no-op when pendingPlayer is a different player', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);
      s.timerContext!.pendingPlayer = 1;

      handleClientMessage(s, 0, { type: 'ANIMATIONS_DONE' } as ClientMessage);

      expect(s.timerContext!.pendingPlayer).toBe(1);
    });
  });

  // ==========================================================================
  // REQUEST_STATE_SYNC — rate limit
  // ==========================================================================

  describe('REQUEST_STATE_SYNC', () => {
    it('runs the state-sync hook on first call', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);

      handleClientMessage(s, 0, { type: 'REQUEST_STATE_SYNC' } as ClientMessage);

      expect(spy.stateSyncs).toEqual([{ session: s, playerIndex: 0 }]);
    });

    it('rate-limits a second call within the window', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy, { stateSyncRateLimitMs: 5000 }));
      const s = makeSession(spy);

      handleClientMessage(s, 0, { type: 'REQUEST_STATE_SYNC' } as ClientMessage);
      handleClientMessage(s, 0, { type: 'REQUEST_STATE_SYNC' } as ClientMessage);

      expect(spy.stateSyncs).toHaveLength(1);
    });

    it('allows another call after the window has elapsed', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy, { stateSyncRateLimitMs: 100 }));
      const s = makeSession(spy);

      handleClientMessage(s, 0, { type: 'REQUEST_STATE_SYNC' } as ClientMessage);
      vi.advanceTimersByTime(150);
      handleClientMessage(s, 0, { type: 'REQUEST_STATE_SYNC' } as ClientMessage);

      expect(spy.stateSyncs).toHaveLength(2);
    });

    it('rate-limit is per-player (one player\'s call does not gate the other)', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy);

      handleClientMessage(s, 0, { type: 'REQUEST_STATE_SYNC' } as ClientMessage);
      handleClientMessage(s, 1, { type: 'REQUEST_STATE_SYNC' } as ClientMessage);

      expect(spy.stateSyncs.map(x => x.playerIndex)).toEqual([0, 1]);
    });
  });

  // ==========================================================================
  // CANCEL_PROMPT_SEQUENCE — 4 guards
  // ==========================================================================

  describe('CANCEL_PROMPT_SEQUENCE — guards', () => {
    function setup(spy: SpyHooks): ActiveDuelSession & { worker: FakeWorker | null } {
      const s = makeSession(spy);
      s.awaitingResponse[0] = true;
      return s as ActiveDuelSession & { worker: FakeWorker | null };
    }

    it('rejects in non-DUELING phase', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = setup(spy);
      s.phase = 'ROLLING_DICE';

      handleClientMessage(s, 0, { type: 'CANCEL_PROMPT_SEQUENCE' } as ClientMessage);

      expect(spy.workerPosts).toHaveLength(0);
    });

    it('rate-limits a second call within the window', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy, { cancelPromptRateLimitMs: 1000 }));
      const s = setup(spy);

      handleClientMessage(s, 0, { type: 'CANCEL_PROMPT_SEQUENCE' } as ClientMessage);
      // Re-arm awaitingResponse so the third guard doesn't trip first
      s.awaitingResponse[0] = true;
      handleClientMessage(s, 0, { type: 'CANCEL_PROMPT_SEQUENCE' } as ClientMessage);

      expect(spy.workerPosts).toHaveLength(1);
    });

    it('rejects when player is not awaiting a response', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = setup(spy);
      s.awaitingResponse[0] = false;

      handleClientMessage(s, 0, { type: 'CANCEL_PROMPT_SEQUENCE' } as ClientMessage);

      expect(spy.workerPosts).toHaveLength(0);
    });

    it('rejects when worker is missing', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = makeSession(spy, { withWorker: false });
      s.awaitingResponse[0] = true;

      handleClientMessage(s, 0, { type: 'CANCEL_PROMPT_SEQUENCE' } as ClientMessage);

      expect(spy.workerPosts).toHaveLength(0);
    });

    it('rejects when duel has ended', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = setup(spy);
      s.endedAt = Date.now();

      handleClientMessage(s, 0, { type: 'CANCEL_PROMPT_SEQUENCE' } as ClientMessage);

      expect(spy.workerPosts).toHaveLength(0);
    });

    it('forwards CANCEL_PROMPT_SEQUENCE to the worker on the happy path', () => {
      const spy = makeSpy();
      configureClientMessageRouter(makeConfig(spy));
      const s = setup(spy);

      handleClientMessage(s, 0, { type: 'CANCEL_PROMPT_SEQUENCE' } as ClientMessage);

      expect(spy.workerPosts).toHaveLength(1);
      expect(spy.workerPosts[0]).toMatchObject({
        type: 'CANCEL_PROMPT_SEQUENCE', playerIndex: 0,
      });
      // lastCancelAt updated → second call would be rate-limited.
      expect(s.lastCancelAt[0]).toBeGreaterThan(0);
    });
  });
});
