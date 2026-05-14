import { describe, it, expect, beforeEach } from 'vitest';
import { DuelSessionManager } from './duel-session-manager.js';
import type { ActiveDuelSession } from './types.js';

// Same POJO fixture pattern as timer-management.spec.ts (the modules don't
// share a fixture file because they exercise disjoint slices of
// ActiveDuelSession).
function makeSession(duelId = 'd1'): ActiveDuelSession {
  return {
    duelId,
    players: [
      { playerId: 'p0', playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: 'p1', playerIndex: 1, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
    ],
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    phase: 'WAITING_PLAYERS',
    firstPlayerState: null,
    chosenFirstPlayer: null,
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

describe('DuelSessionManager', () => {
  let mgr: DuelSessionManager;

  beforeEach(() => {
    mgr = new DuelSessionManager();
  });

  describe('register / size / get / has / listIds / listAll', () => {
    it('registers a session under its duelId and pending tokens', () => {
      const s = makeSession('d1');
      mgr.register(s, ['t0', 't1']);

      expect(mgr.size()).toBe(1);
      expect(mgr.has('d1')).toBe(true);
      expect(mgr.get('d1')).toBe(s);
      expect(mgr.listIds()).toEqual(['d1']);
      expect(mgr.listAll()).toEqual([s]);
    });

    it('listIds + listAll snapshot the current state (mutating the result is safe)', () => {
      mgr.register(makeSession('a'), ['ta0', 'ta1']);
      mgr.register(makeSession('b'), ['tb0', 'tb1']);
      const ids = mgr.listIds();
      ids.pop();
      expect(mgr.listIds()).toHaveLength(2);

      const all = mgr.listAll();
      all.pop();
      expect(mgr.listAll()).toHaveLength(2);
    });

    it('isolates duels — terminating one does not touch the other', () => {
      const a = makeSession('a');
      const b = makeSession('b');
      mgr.register(a, ['ta0', 'ta1']);
      mgr.register(b, ['tb0', 'tb1']);

      mgr.terminate(a);

      expect(mgr.has('a')).toBe(false);
      expect(mgr.has('b')).toBe(true);
      expect(mgr.consumePendingToken('tb0').kind).toBe('ok');
    });
  });

  describe('consumePendingToken', () => {
    it('returns ok + session+playerIndex and deletes the token', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);

      const r0 = mgr.consumePendingToken('t0');
      expect(r0).toEqual({ kind: 'ok', session: s, playerIndex: 0 });

      // Second call: token already consumed → unknown.
      expect(mgr.consumePendingToken('t0')).toEqual({ kind: 'unknown' });
    });

    it('returns unknown for an unknown token', () => {
      expect(mgr.consumePendingToken('never-issued')).toEqual({ kind: 'unknown' });
    });

    it('returns session-gone and drops the orphan token when activeDuels lost the session before terminate()', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);
      // Simulate a desync: the activeDuels entry vanishes (e.g. an
      // earlier code path forgot to register, or the entry was wiped
      // bypassing terminate()). The pending token is still in the map.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mgr as any).activeDuels.delete(s.duelId);

      const r = mgr.consumePendingToken('t1');
      expect(r).toEqual({ kind: 'session-gone' });

      // Orphan is dropped — second call is unknown.
      expect(mgr.consumePendingToken('t1')).toEqual({ kind: 'unknown' });
    });

    it('returns unknown after terminate() prunes the pending tokens', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);
      // Simulate the duel being cleaned up the normal way (terminate()
      // prunes pendingTokens by duelId). The token is gone before lookup,
      // so this is the 'unknown' branch — the 'session-gone' branch only
      // fires when the activeDuels entry vanished without terminate().
      mgr.terminate(s);
      expect(mgr.consumePendingToken('t1')).toEqual({ kind: 'unknown' });
    });

    it('maps the second token to playerIndex 1', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);
      const r1 = mgr.consumePendingToken('t1');
      expect(r1).toEqual({ kind: 'ok', session: s, playerIndex: 1 });
    });
  });

  describe('rotateReconnectToken / consumeReconnectToken', () => {
    it('first allocation: caller stores token on player; consume resolves OK', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);
      mgr.consumePendingToken('t0');

      mgr.rotateReconnectToken(s, 0, 'r-new-0');
      // Caller stores it (server.ts pattern).
      s.players[0].reconnectToken = 'r-new-0';

      const result = mgr.consumeReconnectToken('r-new-0');
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.session).toBe(s);
        expect(result.playerIndex).toBe(0);
      }
    });

    it('rotation: new token works, old token becomes unknown', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);

      mgr.rotateReconnectToken(s, 0, 'r-old');
      s.players[0].reconnectToken = 'r-old';

      mgr.rotateReconnectToken(s, 0, 'r-new');
      s.players[0].reconnectToken = 'r-new';

      expect(mgr.consumeReconnectToken('r-old').kind).toBe('unknown');
      expect(mgr.consumeReconnectToken('r-new').kind).toBe('ok');
    });

    it('consumeReconnectToken: unknown token → unknown', () => {
      expect(mgr.consumeReconnectToken('never').kind).toBe('unknown');
    });

    it('consumeReconnectToken: orphan after session removed → session-gone, then unknown', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);
      mgr.rotateReconnectToken(s, 0, 'rA');
      s.players[0].reconnectToken = 'rA';

      // Simulate the activeDuels entry being dropped while a reconnect token
      // is still in flight. We bypass terminate() (which would also prune
      // the token via the player back-pointer) by deleting the entry directly.
      mgr['activeDuels'].delete(s.duelId);

      const first = mgr.consumeReconnectToken('rA');
      expect(first.kind).toBe('session-gone');
      // Token has been dropped — second call resolves as unknown.
      expect(mgr.consumeReconnectToken('rA').kind).toBe('unknown');
    });
  });

  describe('remapReconnectTokensAfterSwap', () => {
    it('after RPS swap, tokens still resolve to the new physical player index', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);

      // Two reconnect tokens issued (typical state after both players connected).
      mgr.rotateReconnectToken(s, 0, 'rA');
      mgr.rotateReconnectToken(s, 1, 'rB');
      s.players[0].reconnectToken = 'rA';
      s.players[1].reconnectToken = 'rB';

      // Sanity before swap: rA → 0, rB → 1.
      const beforeA = mgr.consumeReconnectToken('rA');
      const beforeB = mgr.consumeReconnectToken('rB');
      expect(beforeA.kind === 'ok' && beforeA.playerIndex).toBe(0);
      expect(beforeB.kind === 'ok' && beforeB.playerIndex).toBe(1);

      // Re-issue (consume deleted them).
      mgr.rotateReconnectToken(s, 0, 'rA');
      mgr.rotateReconnectToken(s, 1, 'rB');
      s.players[0].reconnectToken = 'rA';
      s.players[1].reconnectToken = 'rB';

      // Caller (startDuelWithOrder) swaps players[] in place.
      const [p0, p1] = s.players;
      s.players = [p1, p0];
      s.players[0].playerIndex = 0;
      s.players[1].playerIndex = 1;
      // BEFORE remap: 'rA' is on s.players[1] (old p0), but the manager map
      // still says rA→0. The remap re-aligns the map to the new layout.
      mgr.remapReconnectTokensAfterSwap(s);

      // After remap: the token that's now sitting on s.players[0] (= 'rB')
      // should resolve to index 0; and 'rA' (now on s.players[1]) to index 1.
      const afterB = mgr.consumeReconnectToken('rB');
      const afterA = mgr.consumeReconnectToken('rA');
      expect(afterB.kind === 'ok' && afterB.playerIndex).toBe(0);
      expect(afterA.kind === 'ok' && afterA.playerIndex).toBe(1);
    });

    it('handles a single missing reconnect token (player never connected)', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);
      mgr.rotateReconnectToken(s, 0, 'rA');
      s.players[0].reconnectToken = 'rA';
      // p1 never connected → no reconnect token.

      // No throw, no orphan write.
      expect(() => mgr.remapReconnectTokensAfterSwap(s)).not.toThrow();
      const r = mgr.consumeReconnectToken('rA');
      expect(r.kind).toBe('ok');
    });
  });

  describe('terminate', () => {
    it('drops activeDuels entry, all reconnect tokens, all pending tokens of this duel', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);
      // p0 connected: pending consumed, reconnect issued.
      mgr.consumePendingToken('t0');
      mgr.rotateReconnectToken(s, 0, 'rA');
      s.players[0].reconnectToken = 'rA';
      // p1 still pending.

      mgr.terminate(s);

      expect(mgr.has(s.duelId)).toBe(false);
      expect(mgr.consumePendingToken('t1').kind).toBe('unknown'); // pruned
      expect(mgr.consumeReconnectToken('rA').kind).toBe('unknown'); // dropped
      // Side-effect on player object: reconnectToken nulled so the player
      // record is consistent.
      expect(s.players[0].reconnectToken).toBeNull();
    });

    it('is idempotent (second call is a no-op)', () => {
      const s = makeSession();
      mgr.register(s, ['t0', 't1']);
      mgr.terminate(s);
      expect(() => mgr.terminate(s)).not.toThrow();
      expect(mgr.size()).toBe(0);
    });

    it('does not affect other sessions registered concurrently', () => {
      const a = makeSession('a');
      const b = makeSession('b');
      mgr.register(a, ['ta0', 'ta1']);
      mgr.register(b, ['tb0', 'tb1']);
      mgr.rotateReconnectToken(a, 0, 'rA');
      mgr.rotateReconnectToken(b, 1, 'rB');
      a.players[0].reconnectToken = 'rA';
      b.players[1].reconnectToken = 'rB';

      mgr.terminate(a);

      expect(mgr.has('b')).toBe(true);
      const r = mgr.consumePendingToken('tb0');
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') expect(r.session).toBe(b);
      expect(mgr.consumeReconnectToken('rB').kind).toBe('ok');
    });
  });
});
