import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureReplayPersist, persistReplay, type ReplayPersistConfig } from './replay-persist.js';
import type { ActiveDuelSession, WorkerReplayPayload } from './types.js';

// =============================================================================
// Fixtures
// =============================================================================

function makeSession(p1Id = '100', p2Id = '200'): ActiveDuelSession {
  return {
    duelId: 'd1',
    players: [
      { playerId: p1Id, playerIndex: 0, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: p2Id, playerIndex: 1, ws: null, connected: true, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
    ],
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    phase: 'DUELING',
    firstPlayerState: null,
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
  } as unknown as ActiveDuelSession;
}

function makePayload(): WorkerReplayPayload {
  return {
    seed: ['1', '2', '3', '4'],
    decks: [{ main: [], extra: [] }, { main: [], extra: [] }],
    playerResponses: [],
    metadata: {
      playerUsernames: ['p0', 'p1'],
      deckNames: ['d0', 'd1'],
      turnCount: 3,
      result: 'win',
      date: '2026-05-11',
      scriptsHash: 'abc',
      ocgcoreVersion: '1.2.3',
    },
  };
}

function makeConfig(overrides: Partial<ReplayPersistConfig>): ReplayPersistConfig {
  return {
    springBootApiUrl: 'http://api.example/api',
    internalApiKey: 'secret',
    maxRetries: 3,
    retryDelayMs: () => 0, // bypass real-time waits by default
    ...overrides,
  };
}

function okResponse(id = 'r1'): Response {
  return new Response(JSON.stringify({ id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function errResponse(status = 500, body = 'boom'): Response {
  return new Response(body, { status });
}

// =============================================================================
// Tests
// =============================================================================

describe('replay-persist', () => {
  // Note: real timers — the retry back-off is exercised through the
  // injected `retryDelayMs` callback (defaults to 0 in makeConfig), so
  // there's no actual sleep to advance through.

  // ==========================================================================
  // Happy path
  // ==========================================================================

  describe('happy path', () => {
    it('POSTs to {url}/replays with the right body + headers and returns on 200', async () => {
      const fetchStub = vi.fn().mockResolvedValue(okResponse('r123'));
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch }));

      const s = makeSession('100', '200');
      const payload = makePayload();
      await persistReplay(s, payload);

      expect(fetchStub).toHaveBeenCalledTimes(1);
      const [url, init] = fetchStub.mock.calls[0]!;
      expect(url).toBe('http://api.example/api/replays');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Internal-Key': 'secret',
      });
      const body = JSON.parse(init.body);
      expect(body.player1Id).toBe(100);
      expect(body.player2Id).toBe(200);
      expect(body.metadata.result).toBe('win');
      expect(body.replayData.seed).toEqual(['1', '2', '3', '4']);
    });

    it('uses pendingReplayResult override when set (TIMEOUT / SURRENDER path)', async () => {
      const fetchStub = vi.fn().mockResolvedValue(okResponse());
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch }));

      const s = makeSession();
      s.pendingReplayResult = 'SURRENDER';
      await persistReplay(s, makePayload());

      const body = JSON.parse(fetchStub.mock.calls[0]![1].body);
      expect(body.metadata.result).toBe('SURRENDER');
    });

    it('consumes pendingReplayResult (sets it to null) so a re-call uses payload.metadata', async () => {
      const fetchStub = vi.fn().mockResolvedValue(okResponse());
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch }));

      const s = makeSession();
      s.pendingReplayResult = 'TIMEOUT';
      await persistReplay(s, makePayload());

      expect(s.pendingReplayResult).toBeNull();
    });
  });

  // ==========================================================================
  // Player ID validation
  // ==========================================================================

  describe('player ID validation', () => {
    it('aborts without fetch when playerId is not a finite number', async () => {
      const fetchStub = vi.fn();
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch }));

      const s = makeSession('not-a-number', '200');
      await persistReplay(s, makePayload());

      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('aborts when BOTH playerIds are invalid', async () => {
      const fetchStub = vi.fn();
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch }));

      const s = makeSession('a', 'b');
      await persistReplay(s, makePayload());

      expect(fetchStub).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Retry loop
  // ==========================================================================

  describe('retry loop', () => {
    it('retries on transient HTTP error and succeeds on attempt 2', async () => {
      const fetchStub = vi.fn()
        .mockResolvedValueOnce(errResponse(503))
        .mockResolvedValueOnce(okResponse());
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch }));

      await persistReplay(makeSession(), makePayload());

      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it('retries on thrown fetch error and succeeds on attempt 3', async () => {
      const fetchStub = vi.fn()
        .mockRejectedValueOnce(new Error('net1'))
        .mockRejectedValueOnce(new Error('net2'))
        .mockResolvedValueOnce(okResponse());
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch }));

      await persistReplay(makeSession(), makePayload());

      expect(fetchStub).toHaveBeenCalledTimes(3);
    });

    it('gives up after maxRetries failures', async () => {
      const fetchStub = vi.fn().mockResolvedValue(errResponse(500));
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch, maxRetries: 3 }));

      await persistReplay(makeSession(), makePayload());

      expect(fetchStub).toHaveBeenCalledTimes(3);
    });

    it('does NOT sleep after the final attempt (back-off only between)', async () => {
      const delays: number[] = [];
      const fetchStub = vi.fn().mockResolvedValue(errResponse(500));
      configureReplayPersist(makeConfig({
        fetch: fetchStub as unknown as typeof fetch,
        maxRetries: 3,
        retryDelayMs: (attempt) => { delays.push(attempt); return 0; },
      }));

      await persistReplay(makeSession(), makePayload());

      // retryDelay called for attempts 1, 2 (NOT 3 — last attempt has no follow-up sleep).
      expect(delays).toEqual([1, 2]);
    });

    it('respects custom maxRetries=1 (single attempt, no retry)', async () => {
      const fetchStub = vi.fn().mockResolvedValue(errResponse(500));
      configureReplayPersist(makeConfig({ fetch: fetchStub as unknown as typeof fetch, maxRetries: 1 }));

      await persistReplay(makeSession(), makePayload());

      expect(fetchStub).toHaveBeenCalledTimes(1);
    });
  });
});
