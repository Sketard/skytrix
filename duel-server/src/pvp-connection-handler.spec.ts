import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { resolveLivePlayerIndex } from './pvp-connection-handler.js';
import { createInitialSessionState } from './session-factory.js';
import type { ActiveDuelSession } from './types.js';

// =============================================================================
// Fixtures
// =============================================================================
// Pure-function tests — no boot of the WSS, no mocked event listeners. Each
// ws value is a unique sentinel object whose identity matters (the function
// uses strict `===` against `session.players[i].ws`). A bare `{}` cast is
// enough — the body never reads any field.

function makeWs(): WebSocket {
  return {} as unknown as WebSocket;
}

function makeSession(): ActiveDuelSession {
  return createInitialSessionState({
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
}

// =============================================================================
// Tests
// =============================================================================

describe('resolveLivePlayerIndex', () => {
  it('returns 0 when ws is bound to players[0]', () => {
    const session = makeSession();
    const ws = makeWs();
    session.players[0].ws = ws as never;
    expect(resolveLivePlayerIndex(session, ws, 0)).toBe(0);
  });

  it('returns 1 when ws is bound to players[1]', () => {
    const session = makeSession();
    const ws = makeWs();
    session.players[1].ws = ws as never;
    expect(resolveLivePlayerIndex(session, ws, 1)).toBe(1);
  });

  // Post-swap scenario : startDuelWithOrder(firstPlayer=1) swapped
  // `players[]`. The connection handler captured `playerIndex=0` at
  // handshake, but `session.players[1].ws` now points to this socket.
  // The live lookup must follow the swap and return 1.
  it('follows a startDuelWithOrder swap (captured=0, ws now at slot 1)', () => {
    const session = makeSession();
    const wsA = makeWs();
    session.players[1].ws = wsA as never;
    expect(resolveLivePlayerIndex(session, wsA, /*captured=*/ 0)).toBe(1);
  });

  // F4 — current (buggy) fallback pinned. Next commit flips this branch
  // to return `null` so the close handler can ignore stale events. The
  // test below WILL be flipped (to `.toBeNull()` + a sibling regression
  // guard) in the F4 fix commit. See the JSDoc of `resolveLivePlayerIndex`.
  it('STALE-WS — returns capturedIndex when ws matches NEITHER slot (pre-F4 fallback)', () => {
    const session = makeSession();
    const wsA = makeWs(); // alice's first ws (now stale)
    const wsB = makeWs(); // alice's reconnect ws
    session.players[0].ws = wsB as never;
    // BUG: returns capturedIndex=0 even though wsA is no longer attached.
    // Pinned so the next commit's flip surfaces as a visible test diff.
    expect(resolveLivePlayerIndex(session, wsA, /*captured=*/ 0)).toBe(0);
  });
});
