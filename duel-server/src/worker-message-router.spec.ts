import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  configureWorkerMessageRouter,
  handleWorkerMessage,
  broadcastMessage,
  isSelectMessage,
  type WorkerMessageRouterConfig,
} from './worker-message-router.js';
import { configureWorkerLifecycle, _resetTotalDuelsServedForTest } from './worker-lifecycle.js';
import { configureReplayPersist } from './replay-persist.js';
import { configureTimerManagement } from './timer-management.js';
import type { ActiveDuelSession, WorkerToMainMessage } from './types.js';
import type { ServerMessage } from './ws-protocol.js';

// =============================================================================
// Fixtures
// =============================================================================

interface SentMessage {
  player: 0 | 1;
  message: ServerMessage;
}

interface SpyHooks {
  sent: SentMessage[];
}

function makeSpy(): SpyHooks {
  return { sent: [] };
}

function makeConfig(spy: SpyHooks, overrides: Partial<WorkerMessageRouterConfig> = {}): WorkerMessageRouterConfig {
  return {
    sendToPlayer: (_session, p, message) => spy.sent.push({ player: p, message }),
    maxInvalidResponses: 5,
    ...overrides,
  };
}

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
      { playerId: '100', playerIndex: 0, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: '200', playerIndex: 1, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
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
  } as unknown as ActiveDuelSession & { worker: FakeWorker | null };
}

// Wire upstream modules with no-ops so the router can call into them
// (handleDuelEnd / safeTerminateWorker / sendTimerStateToAll / persistReplay)
// without hitting unconfigured-module guards. The router's behaviour is what
// we test — the call-throughs are exercised separately in their own specs.
function wireUpstreamStubs(): void {
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
  configureReplayPersist({
    springBootApiUrl: 'http://stub/api',
    internalApiKey: 'stub',
    fetch: (async () => new Response('{"id":"x"}', { status: 200 })) as typeof fetch,
    maxRetries: 1,
    retryDelayMs: () => 0,
  });
}

function makeWorkerMsg(type: 'WORKER_MESSAGE', message: ServerMessage): WorkerToMainMessage {
  return { type, message } as unknown as WorkerToMainMessage;
}

function findMessage(spy: SpyHooks, type: string): SentMessage | undefined {
  return spy.sent.find(x => x.message.type === type);
}

/**
 * Minimal BOARD_STATE that passes `filterMessage` → `sanitizeBoardState`
 * → `sanitizeOpponentBoard`. The router doesn't read the inner zones;
 * it just routes the message through the filter for each player. We
 * supply enough structure so the filter's per-zone loop doesn't crash.
 */
function makeBoardStateMsg(turnPlayer: 0 | 1 = 0, turnCount = 1): ServerMessage {
  const emptyPlayer = { lp: 8000, deckCount: 40, extraCount: 15, zones: [] };
  return {
    type: 'BOARD_STATE',
    data: { turnPlayer, turnCount, phase: 'MAIN1', players: [emptyPlayer, emptyPlayer] },
  } as unknown as ServerMessage;
}

function allMessagesOfType(spy: SpyHooks, type: string): SentMessage[] {
  return spy.sent.filter(x => x.message.type === type);
}

// =============================================================================
// Tests
// =============================================================================

describe('worker-message-router', () => {
  beforeEach(() => {
    wireUpstreamStubs();
  });

  // ==========================================================================
  // isSelectMessage
  // ==========================================================================

  describe('isSelectMessage', () => {
    it('recognizes every SELECT_*/SORT_*/ANNOUNCE_*/dice-prompt type', () => {
      const types = [
        'SELECT_IDLECMD', 'SELECT_BATTLECMD', 'SELECT_CARD', 'SELECT_CHAIN',
        'SELECT_EFFECTYN', 'SELECT_YESNO', 'SELECT_PLACE', 'SELECT_DISFIELD',
        'SELECT_POSITION', 'SELECT_OPTION', 'SELECT_TRIBUTE', 'SELECT_SUM',
        'SELECT_UNSELECT_CARD', 'SELECT_COUNTER', 'SORT_CARD', 'SORT_CHAIN',
        'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_CARD', 'ANNOUNCE_NUMBER',
        'DICE_ROLL', 'SELECT_FIRST_PLAYER',
      ];
      for (const t of types) {
        expect(isSelectMessage({ type: t } as ServerMessage)).toBe(true);
      }
    });

    it('does not match non-prompt messages', () => {
      expect(isSelectMessage({ type: 'BOARD_STATE' } as ServerMessage)).toBe(false);
      expect(isSelectMessage({ type: 'MSG_HINT' } as ServerMessage)).toBe(false);
      expect(isSelectMessage({ type: 'DUEL_END' } as ServerMessage)).toBe(false);
    });
  });

  // ==========================================================================
  // handleWorkerMessage — WORKER_DUEL_CREATED
  // ==========================================================================

  describe('handleWorkerMessage — WORKER_DUEL_CREATED', () => {
    it('initializes timerContext and sets startedAt', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      s.turnTimeSecs = 300;

      handleWorkerMessage(s, { type: 'WORKER_DUEL_CREATED', duelId: 'd1' } as WorkerToMainMessage);

      expect(s.timerContext).not.toBeNull();
      expect(s.timerContext!.pools).toEqual([300_000, 300_000]);
      expect(s.timerContext!.running).toBe(false);
      expect(s.timerContext!.activePlayer).toBe(0);
      expect(s.startedAt).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // handleWorkerMessage — WORKER_RETRY
  // ==========================================================================

  describe('handleWorkerMessage — WORKER_RETRY', () => {
    it('increments the strike count and re-sends the cached prompt', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      const cached: ServerMessage = { type: 'SELECT_CARD', player: 0, cards: [] } as unknown as ServerMessage;
      s.lastSentPrompt[0] = cached;

      handleWorkerMessage(s, { type: 'WORKER_RETRY', duelId: 'd1', playerIndex: 0 } as WorkerToMainMessage);

      expect(s.invalidResponseCount[0]).toBe(1);
      expect(s.awaitingResponse[0]).toBe(true);
      const sent = findMessage(spy, 'SELECT_CARD');
      expect(sent?.player).toBe(0);
    });

    it('no-op when there is no cached prompt', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();

      handleWorkerMessage(s, { type: 'WORKER_RETRY', duelId: 'd1', playerIndex: 1 } as WorkerToMainMessage);

      expect(s.invalidResponseCount[1]).toBe(0);
      expect(spy.sent).toHaveLength(0);
    });

    it('on reaching maxInvalidResponses, forfeits the player who keeps retrying', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy, { maxInvalidResponses: 3 }));
      const s = makeSession();
      s.lastSentPrompt[0] = { type: 'SELECT_CARD', player: 0, cards: [] } as unknown as ServerMessage;
      s.invalidResponseCount[0] = 2;

      handleWorkerMessage(s, { type: 'WORKER_RETRY', duelId: 'd1', playerIndex: 0 } as WorkerToMainMessage);

      const endMsgs = allMessagesOfType(spy, 'DUEL_END');
      expect(endMsgs).toHaveLength(2);
      const m = endMsgs[0]!.message as Extract<ServerMessage, { type: 'DUEL_END' }>;
      expect(m.winner).toBe(1);
      expect(m.reason).toBe('too_many_invalid_responses');
    });
  });

  // ==========================================================================
  // handleWorkerMessage — WORKER_CANCEL_DONE (cancel-rollback parity)
  // ==========================================================================

  describe('handleWorkerMessage — WORKER_CANCEL_DONE', () => {
    function arriveAtCancel(spy: SpyHooks): ActiveDuelSession {
      const s = makeSession();
      const cached: ServerMessage = { type: 'SELECT_IDLECMD', player: 0 } as unknown as ServerMessage;
      s.cancelTargetPrompt[0] = cached;
      s.lastBoardState = makeBoardStateMsg(0, 1);
      // Pretend a chain was building before cancel
      s.activeChainLinks = [{ chainIndex: 0 } as unknown as never];
      s.chainPhase = 'building';
      s.negatedChainIndices.add(0);
      s.currentSolvingChainIndex = 0;
      s.lastSentHint[0] = { type: 'MSG_HINT' } as unknown as ServerMessage;
      s.invalidResponseCount[0] = 4;
      return s;
    }

    it('re-broadcasts the cached IDLECMD prompt + clears chain state + resets retry strikes', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = arriveAtCancel(spy);

      handleWorkerMessage(s, { type: 'WORKER_CANCEL_DONE', duelId: 'd1', playerIndex: 0 } as WorkerToMainMessage);

      // STATE_SYNC sent (board snapshot)
      expect(findMessage(spy, 'STATE_SYNC')).toBeDefined();
      // CHAIN_STATE empty sent
      const chain = findMessage(spy, 'CHAIN_STATE');
      expect(chain).toBeDefined();
      // Cached prompt re-broadcast
      expect(findMessage(spy, 'SELECT_IDLECMD')).toBeDefined();
      // Chain bookkeeping cleared on session
      expect(s.activeChainLinks).toHaveLength(0);
      expect(s.chainPhase).toBe('idle');
      expect(s.negatedChainIndices.size).toBe(0);
      expect(s.currentSolvingChainIndex).toBeNull();
      // Hint dropped
      expect(s.lastSentHint[0]).toBeNull();
      // Retry counter reset (cancel is not a strike)
      expect(s.invalidResponseCount[0]).toBe(0);
      // Cache drained (the new prompt is now in flight)
      expect(s.cancelTargetPrompt[0]).toBeNull();
      // lastSentPrompt restored
      expect(s.lastSentPrompt[0]).toEqual({ type: 'SELECT_IDLECMD', player: 0 });
      // awaitingResponse re-armed
      expect(s.awaitingResponse[0]).toBe(true);
    });

    it('no-op when no cached prompt to re-broadcast (logged warning, no sends)', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();

      handleWorkerMessage(s, { type: 'WORKER_CANCEL_DONE', duelId: 'd1', playerIndex: 1 } as WorkerToMainMessage);

      expect(spy.sent).toHaveLength(0);
    });
  });

  // ==========================================================================
  // handleWorkerMessage — WORKER_ERROR
  // ==========================================================================

  describe('handleWorkerMessage — WORKER_ERROR', () => {
    it('broadcasts DUEL_END(winner=null, reason=worker_error) to both players', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();

      handleWorkerMessage(s, { type: 'WORKER_ERROR', duelId: 'd1', error: 'boom' } as WorkerToMainMessage);

      const ends = allMessagesOfType(spy, 'DUEL_END');
      expect(ends).toHaveLength(2);
      const m = ends[0]!.message as Extract<ServerMessage, { type: 'DUEL_END' }>;
      expect(m.winner).toBeNull();
      expect(m.reason).toBe('worker_error');
    });
  });

  // ==========================================================================
  // broadcastMessage — DUEL_END / MSG_WIN paths
  // ==========================================================================

  describe('broadcastMessage — duel-end detection', () => {
    it('worker-emitted DUEL_END is forwarded to both players (filterMessage pass-through)', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      const msg: ServerMessage = { type: 'DUEL_END', winner: 0, reason: 'win' };

      broadcastMessage(s, msg);

      expect(allMessagesOfType(spy, 'DUEL_END')).toHaveLength(2);
    });

    it('MSG_WIN generates a DUEL_END to both players + forwards the MSG_WIN itself', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();

      broadcastMessage(s, { type: 'MSG_WIN', player: 0 } as unknown as ServerMessage);

      const ends = allMessagesOfType(spy, 'DUEL_END');
      expect(ends).toHaveLength(2);
      expect((ends[0]!.message as Extract<ServerMessage, { type: 'DUEL_END' }>).winner).toBe(0);
      // MSG_WIN is also forwarded through the per-player filter loop (one
      // per player after filterMessage).
      expect(allMessagesOfType(spy, 'MSG_WIN').length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // broadcastMessage — BOARD_STATE caching
  // ==========================================================================

  describe('broadcastMessage — BOARD_STATE cache', () => {
    it('caches the message on session.lastBoardState', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      const msg = makeBoardStateMsg(1, 3);

      broadcastMessage(s, msg);

      expect(s.lastBoardState).toBe(msg);
    });
  });

  // ==========================================================================
  // broadcastMessage — MSG_CONFIRM_CARDS chainIndex tagging (M22)
  // ==========================================================================

  describe('broadcastMessage — MSG_CONFIRM_CARDS chainIndex tag', () => {
    it('tags MSG_CONFIRM_CARDS with currentSolvingChainIndex when set', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      s.currentSolvingChainIndex = 2;
      const msg = { type: 'MSG_CONFIRM_CARDS', player: 0, cards: [] } as unknown as ServerMessage & { chainIndex?: number };

      broadcastMessage(s, msg);

      expect(msg.chainIndex).toBe(2);
    });

    it('does NOT tag when currentSolvingChainIndex is null', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      s.currentSolvingChainIndex = null;
      const msg = { type: 'MSG_CONFIRM_CARDS', player: 0, cards: [] } as unknown as ServerMessage & { chainIndex?: number };

      broadcastMessage(s, msg);

      expect(msg.chainIndex).toBeUndefined();
    });
  });

  // ==========================================================================
  // broadcastMessage — SELECT_* prompt side-effects
  // ==========================================================================

  describe('broadcastMessage — SELECT_* side-effects', () => {
    it('arms awaitingResponse[target] + sends WAITING_RESPONSE to the other player', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();

      broadcastMessage(s, { type: 'SELECT_CARD', player: 1, cards: [] } as unknown as ServerMessage);

      expect(s.awaitingResponse[1]).toBe(true);
      expect(s.promptSentAt[1]).toBeGreaterThan(0);
      const waiting = findMessage(spy, 'WAITING_RESPONSE');
      expect(waiting).toBeDefined();
      expect(waiting!.player).toBe(0);
    });

    it('SELECT_IDLECMD drops the cancelTargetPrompt cache for the target player', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      s.cancelTargetPrompt[0] = { type: 'SELECT_IDLECMD', player: 0 } as unknown as ServerMessage;

      broadcastMessage(s, { type: 'SELECT_IDLECMD', player: 0 } as unknown as ServerMessage);

      expect(s.cancelTargetPrompt[0]).toBeNull();
    });

    it('SELECT_BATTLECMD also drops the cancelTargetPrompt cache', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      s.cancelTargetPrompt[1] = { type: 'SELECT_IDLECMD', player: 1 } as unknown as ServerMessage;

      broadcastMessage(s, { type: 'SELECT_BATTLECMD', player: 1 } as unknown as ServerMessage);

      expect(s.cancelTargetPrompt[1]).toBeNull();
    });

    it('mid-chain SELECT_CARD does NOT drop the cancelTargetPrompt cache', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      const cache = { type: 'SELECT_IDLECMD', player: 0 } as unknown as ServerMessage;
      s.cancelTargetPrompt[0] = cache;

      broadcastMessage(s, { type: 'SELECT_CARD', player: 0, cards: [] } as unknown as ServerMessage);

      expect(s.cancelTargetPrompt[0]).toBe(cache);
    });

    it('caches the filtered SELECT_* message on lastSentPrompt[target]', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();
      const msg = { type: 'SELECT_CARD', player: 0, cards: [] } as unknown as ServerMessage;

      broadcastMessage(s, msg);

      expect(s.lastSentPrompt[0]).toBeDefined();
      // The cache stores the filtered message (which is just `msg` since
      // filterMessage doesn't suppress SELECT_CARD for its target).
      expect((s.lastSentPrompt[0] as ServerMessage).type).toBe('SELECT_CARD');
    });
  });

  // ==========================================================================
  // broadcastMessage — MSG_HINT caching
  // ==========================================================================

  describe('broadcastMessage — MSG_HINT cache', () => {
    it('caches MSG_HINT per-player on lastSentHint', () => {
      const spy = makeSpy();
      configureWorkerMessageRouter(makeConfig(spy));
      const s = makeSession();

      broadcastMessage(s, { type: 'MSG_HINT', player: 0, hint: 1, value: 0 } as unknown as ServerMessage);

      expect(s.lastSentHint[0]).toBeDefined();
      expect((s.lastSentHint[0] as ServerMessage).type).toBe('MSG_HINT');
    });
  });
});
