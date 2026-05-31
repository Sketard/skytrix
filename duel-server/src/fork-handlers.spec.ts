import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureForkHandlers,
  createForkSoloSession,
  type ForkHandlersConfig,
} from './fork-handlers.js';
import { configureWorkerLifecycle, _resetTotalDuelsServedForTest } from './worker-lifecycle.js';
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
      result: 'VICTORY',
      date: '2026-05-30',
      scriptsHash: 'h',
      ocgcoreVersion: 'v',
      durationSec: 60,
    },
  };
}

interface SpyHooks {
  sent: { player: 0 | 1; message: ServerMessage }[];
  cleanups: ActiveDuelSession[];
}

function makeSpy(): SpyHooks { return { sent: [], cleanups: [] }; }

function wireUpstreams(): void {
  // Minimum upstream config so attachWorkerHandlers (used by fork-handlers
  // after F5-bis) does not throw on the boot check.
  configureWorkerLifecycle({
    cleanupDuelSession: () => undefined,
    handleWorkerMessage: () => undefined,
    clearAllDuelTimers: () => undefined,
    rematchExpiryMs: 30_000,
    onRematchExpired: () => undefined,
  });
  _resetTotalDuelsServedForTest();
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

describe('fork-handlers (F5-bis collapsed onto SOLO multiplex)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wireUpstreams();
  });
  afterEach(() => vi.useRealTimers());

  // ==========================================================================
  // createForkSoloSession — session shape + registration
  // ==========================================================================

  describe('createForkSoloSession', () => {
    it('returns a single token (F5-bis collapse — no token2)', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr));
      const w = makeWorker();

      const ret = createForkSoloSession({
        forkDuelId: 'fork-1', userId: 'u1', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      expect(ret.token1).toBeTruthy();
      expect((ret as { token2?: string }).token2).toBeUndefined();
    });

    it('registers the session under forkDuelId with only token1', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr));
      const w = makeWorker();

      const { token1 } = createForkSoloSession({
        forkDuelId: 'fork-X', userId: 'u1', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      const session = mgr.get('fork-X');
      expect(session).toBeDefined();
      const r1 = mgr.consumePendingToken(token1);
      expect(r1.kind).toBe('ok');
      if (r1.kind === 'ok') {
        expect(r1.session.duelId).toBe('fork-X');
        expect(r1.playerIndex).toBe(0);
      }
    });

    it('builds a soloMode + forkMode, skip-shuffle session with both player slots pointing at the same userId', () => {
      const spy = makeSpy();
      const mgr = new DuelSessionManager();
      configureForkHandlers(makeConfig(spy, mgr));
      const w = makeWorker();

      createForkSoloSession({
        forkDuelId: 'fork-S', userId: 'u42', worker: w as unknown as Worker, replayData: makeReplayData(),
      });

      const s = mgr.get('fork-S')!;
      expect(s.soloMode).toBe(true);
      expect(s.forkMode).toBe(true);
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

    it('removes the worker\'s existing listeners + attaches canonical session-bound ones', () => {
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
      // attachWorkerHandlers (canonical) attaches 3 handlers via worker.on
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

    it('does NOT clean up if slot 0 has connected before the timeout (SOLO multiplex pattern)', () => {
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

  // F5-bis (2026-05-31) — `setupForkWorkerHandlers` was removed (it
  // reimplemented a subset of `broadcastMessage`). All worker-to-client
  // routing now goes through `worker-message-router.handleWorkerMessage`
  // which is tested directly in `worker-message-router.spec.ts`. The
  // routing parity between fork-solo and SOLO multiplex is structural
  // (same code path, same `if (session.forkMode)` skips for persist +
  // rematch), so no per-message dispatch tests are needed here.
});
