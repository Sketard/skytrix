import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureForkHandlers,
  createForkSoloSession,
  type ForkHandlersConfig,
} from './fork-handlers.js';
import { configureWorkerLifecycle, _resetTotalDuelsServedForTest } from './worker-lifecycle.js';
import { configureTimerManagement } from './timer-management.js';
import { configureWorkerMessageRouter } from './worker-message-router.js';
import { DuelSessionManager } from './duel-session-manager.js';
import type { ActiveDuelSession, WorkerReplayPayload } from './types.js';
import type { ServerMessage } from './ws-protocol.js';
import type { Worker } from 'node:worker_threads';

// =============================================================================
// Fixtures
// =============================================================================

interface FakeWorker {
  removeAllListeners: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
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

function makeReplayData(): WorkerReplayPayload {
  return {
    seed: ['1', '2', '3', '4'],
    decks: [{ main: [], extra: [] }, { main: [], extra: [] }],
    playerResponses: [],
    metadata: {
      playerUsernames: ['axel', 'axel'],
      deckNames: ['deck-a', 'deck-b'],
      turnCount: 3,
      result: 'win',
      date: '2026-05-11',
      scriptsHash: 'abc',
      ocgcoreVersion: '1.2.3',
      durationSec: 120,
    },
  };
}

interface SpyHooks {
  sent: { player: 0 | 1; message: ServerMessage }[];
  cleanups: ActiveDuelSession[];
}

function makeSpy(): SpyHooks {
  return { sent: [], cleanups: [] };
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
  configureWorkerMessageRouter({
    sendToPlayer: () => undefined,
    maxInvalidResponses: 5,
  });
}

function makeConfig(spy: SpyHooks, sessionManager: DuelSessionManager, overrides: Partial<ForkHandlersConfig> = {}): ForkHandlersConfig {
  return {
    sessionManager,
    sendToPlayer: (_s, p, message) => spy.sent.push({ player: p, message }),
    cleanupDuelSession: (s) => spy.cleanups.push(s),
    forkConnectionTimeoutMs: 30_000,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('fork-handlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wireUpstreams();
  });
  afterEach(() => vi.useRealTimers());

  // ==========================================================================
  // createForkSoloSession — session shape + registration
  // ==========================================================================

  describe('createForkSoloSession', () => {
    it('returns two distinct tokens', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr));
      const w = makeWorker();

      const { token1, token2 } = createForkSoloSession({
        forkDuelId: 'fork-1', userId: 'u1', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      expect(token1).not.toBe(token2);
      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
    });

    it('registers the session under forkDuelId with both tokens', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr));
      const w = makeWorker();

      const { token1, token2 } = createForkSoloSession({
        forkDuelId: 'fork-X', userId: 'u1', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      const session = mgr.get('fork-X');
      expect(session).toBeDefined();
      // Both pending tokens resolve to the same duel.
      const r1 = mgr.consumePendingToken(token1);
      const r2 = mgr.consumePendingToken(token2);
      expect(r1.kind).toBe('ok');
      expect(r2.kind).toBe('ok');
      if (r1.kind === 'ok' && r2.kind === 'ok') {
        expect(r1.session.duelId).toBe('fork-X');
        expect(r2.session.duelId).toBe('fork-X');
        expect(r1.playerIndex).toBe(0);
        expect(r2.playerIndex).toBe(1);
      }
    });

    it('builds a solo-mode, skip-shuffle session with both player slots pointing at the same userId', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr));
      const w = makeWorker();

      createForkSoloSession({
        forkDuelId: 'fork-S', userId: 'u42', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      const s = mgr.get('fork-S')!;
      expect(s.soloMode).toBe(true);
      expect(s.skipShuffle).toBe(true);
      expect(s.phase).toBe('DUELING');
      expect(s.players[0].playerId).toBe('u42');
      expect(s.players[1].playerId).toBe('u42');
      expect(s.worker).toBe(w as unknown as Worker);
    });

    it('copies replayData decks + metadata onto the session', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr));
      const w = makeWorker();
      const data = makeReplayData();

      createForkSoloSession({
        forkDuelId: 'fork-M', userId: 'u1', worker: w as unknown as Worker, replayData: data,
      });

      const s = mgr.get('fork-M')!;
      expect(s.decks).toBe(data.decks);
      expect(s.playerUsernames).toEqual(['axel', 'axel']);
      expect(s.deckNames).toEqual(['deck-a', 'deck-b']);
    });

    it('removes the worker\'s existing listeners + attaches the fork-specific ones', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr));
      const w = makeWorker();

      createForkSoloSession({
        forkDuelId: 'fork-W', userId: 'u1', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      // 3 removeAllListeners calls (message, exit, error)
      expect(w.removeAllListeners).toHaveBeenCalledWith('message');
      expect(w.removeAllListeners).toHaveBeenCalledWith('exit');
      expect(w.removeAllListeners).toHaveBeenCalledWith('error');
      // 3 .on() calls
      expect(w._handlers.message).toBeDefined();
      expect(w._handlers.exit).toBeDefined();
      expect(w._handlers.error).toBeDefined();
    });
  });

  // ==========================================================================
  // Timeout safety net (H2)
  // ==========================================================================

  describe('forkConnectionTimeout (H2)', () => {
    it('cleans up after timeout when no client connects', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr, { forkConnectionTimeoutMs: 100 }));
      const w = makeWorker();

      createForkSoloSession({
        forkDuelId: 'fork-T', userId: 'u1', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      const s = mgr.get('fork-T')!;
      expect(s.players[0].connected).toBe(false);
      expect(s.players[1].connected).toBe(false);

      vi.advanceTimersByTime(100);

      expect(w.terminate).toHaveBeenCalledTimes(1);
      expect(spy.cleanups).toHaveLength(1);
      expect(spy.cleanups[0]!.duelId).toBe('fork-T');
    });

    it('does NOT clean up if at least one client has connected before the timeout', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr, { forkConnectionTimeoutMs: 100 }));
      const w = makeWorker();

      createForkSoloSession({
        forkDuelId: 'fork-Y', userId: 'u1', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      const s = mgr.get('fork-Y')!;
      s.players[0].connected = true;

      vi.advanceTimersByTime(100);

      expect(w.terminate).not.toHaveBeenCalled();
      expect(spy.cleanups).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Fork worker handlers (the actual routing)
  // ==========================================================================

  describe('fork worker handlers — message dispatch', () => {
    function makeFreshFork(spy: SpyHooks, overrides: Partial<ForkHandlersConfig> = {}): {
      worker: FakeWorker;
      session: ActiveDuelSession;
    } {
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr, overrides));
      const worker = makeWorker();
      createForkSoloSession({
        forkDuelId: 'fork-H', userId: 'u1', worker: worker as unknown as Worker, replayData: makeReplayData(),
      });
      return { worker, session: mgr.get('fork-H')! };
    }

    it('drops malformed worker messages without throwing', () => {
      const spy = makeSpy();
      const { worker, session } = makeFreshFork(spy);

      expect(() => worker._handlers.message!({ type: 'GARBAGE' })).not.toThrow();
      expect(spy.sent).toHaveLength(0);
      expect(session.lastBoardState).toBeNull();
    });

    it('on MSG_WIN, generates DUEL_END to both ports + marks endedAt', () => {
      const spy = makeSpy();
      const { worker, session } = makeFreshFork(spy);

      worker._handlers.message!({
        type: 'WORKER_MESSAGE',
        duelId: 'fork-H',
        message: { type: 'MSG_WIN', player: 1 },
      });

      const ends = spy.sent.filter(x => x.message.type === 'DUEL_END');
      expect(ends).toHaveLength(2);
      const m = ends[0]!.message as Extract<ServerMessage, { type: 'DUEL_END' }>;
      expect(m.winner).toBe(1);
      expect(m.reason).toBe('win');
      expect(session.endedAt).not.toBeNull();
    });

    it('WORKER_ERROR logs without throwing (no DUEL_END emitted)', () => {
      const spy = makeSpy();
      const { worker } = makeFreshFork(spy);

      expect(() => worker._handlers.message!({
        type: 'WORKER_ERROR', duelId: 'fork-H', error: 'boom',
      })).not.toThrow();
      expect(spy.sent.filter(x => x.message.type === 'DUEL_END')).toHaveLength(0);
    });

    it('exit handler flips workerTerminated', () => {
      const spy = makeSpy();
      const { worker, session } = makeFreshFork(spy);

      worker._handlers.exit!(0);

      expect(session.workerTerminated).toBe(true);
    });

    it('error handler does not throw', () => {
      const spy = makeSpy();
      const { worker } = makeFreshFork(spy);

      expect(() => worker._handlers.error!(new Error('thread boom'))).not.toThrow();
    });
  });
});
