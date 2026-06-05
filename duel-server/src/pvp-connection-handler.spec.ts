import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import { resolveLivePlayerIndex } from './pvp-connection-handler.js';
import { createInitialSessionState } from './session-factory.js';
import type { ActiveDuelSession } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

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
    expect(resolveLivePlayerIndex(session, ws)).toBe(0);
  });

  it('returns 1 when ws is bound to players[1]', () => {
    const session = makeSession();
    const ws = makeWs();
    session.players[1].ws = ws as never;
    expect(resolveLivePlayerIndex(session, ws)).toBe(1);
  });

  // Post-swap scenario : startDuelWithOrder(firstPlayer=1) swapped
  // `players[]`. The connection handler captured `playerIndex=0` at
  // handshake, but `session.players[1].ws` now points to this socket.
  // The live lookup must follow the swap and return 1.
  it('follows a startDuelWithOrder swap (ws moved from slot 0 to slot 1)', () => {
    const session = makeSession();
    const wsA = makeWs();
    session.players[1].ws = wsA as never;
    expect(resolveLivePlayerIndex(session, wsA)).toBe(1);
  });

  // F4 fix — stale-ws after a reconnect already swapped the slot to a NEW
  // ws. The pre-fix fallback returned `capturedIndex`, which misattributed
  // the stale event (e.g. wsA.close fired after wsB took over slot 0) to
  // slot 0 and forfeited the healthy player. The fix returns `null` so
  // the close handler ignores the event.
  it('STALE-WS — returns null when ws matches NEITHER slot (F4 fix)', () => {
    const session = makeSession();
    const wsA = makeWs(); // alice's first ws (now stale)
    const wsB = makeWs(); // alice's reconnect ws
    session.players[0].ws = wsB as never;
    expect(resolveLivePlayerIndex(session, wsA)).toBeNull();
  });

  // F4 regression guard — DELETE /api/duels (and any other path that
  // calls `cleanupDuelSession`) nullifies `players[].ws` BEFORE the OS
  // delivers the deferred `close` event. The close handler then runs
  // with the stale ws and `players[i].ws === null`. The fix must return
  // null here too — a fallback to capturedIndex would re-write
  // `connected = false` (harmless no-op, but pollutes the log with
  // "Player disconnected" lines for an already-cleaned session).
  it('STALE-WS — returns null after cleanupDuelSession nullifies players[].ws', () => {
    const session = makeSession();
    const wsA = makeWs();
    session.players[0].ws = null;
    session.players[1].ws = null;
    expect(resolveLivePlayerIndex(session, wsA)).toBeNull();
  });
});

// =============================================================================
// animations-ready-protocol-2026-06-05 (Direction B) — EARLY_DECK_PREFETCH
// =============================================================================
//
// The Direction B revision routes around the circular deadlock (where
// preFetchCardImages was gated on roomState='duel-loading' which gated on
// boardReady which gated on worker spawn which gated on ANIMATIONS_READY
// which gated on thumbnailsReady which required preFetchCardImages) by
// having the server emit EARLY_DECK_PREFETCH immediately after
// SESSION_PHASE. This source-level guard pins the wire order : the message
// MUST be emitted (a) AFTER `sendToPlayer(... SESSION_PHASE ...)` and (b)
// BEFORE any branch that could `startDuelWithOrder` / `startFirstPlayerPhase`
// / `FORK_RESUME`. A future refactor that moves the emission elsewhere
// breaks the gate and re-introduces the deadlock.

describe('pvp-connection-handler — EARLY_DECK_PREFETCH wire order', () => {
  const SOURCE = readFileSync(join(HERE, 'pvp-connection-handler.ts'), 'utf-8');

  it("emits EARLY_DECK_PREFETCH after SESSION_PHASE in the same handshake block", () => {
    const sessionPhaseIdx = SOURCE.indexOf("type: 'SESSION_PHASE'");
    const earlyPrefetchIdx = SOURCE.indexOf("type: 'EARLY_DECK_PREFETCH'");
    expect(sessionPhaseIdx, 'SESSION_PHASE emission site').toBeGreaterThan(-1);
    expect(earlyPrefetchIdx, 'EARLY_DECK_PREFETCH emission site').toBeGreaterThan(-1);
    expect(earlyPrefetchIdx).toBeGreaterThan(sessionPhaseIdx);
  });

  it("emits EARLY_DECK_PREFETCH BEFORE the isReadyToStart branch (so cardCodes arrive ahead of worker spawn)", () => {
    const earlyPrefetchIdx = SOURCE.indexOf("type: 'EARLY_DECK_PREFETCH'");
    const isReadyToStartIdx = SOURCE.indexOf('isReadyToStart(session)');
    expect(earlyPrefetchIdx).toBeGreaterThan(-1);
    expect(isReadyToStartIdx).toBeGreaterThan(-1);
    expect(earlyPrefetchIdx).toBeLessThan(isReadyToStartIdx);
  });

  it("ships SOLO multiplex sessions with `bothCardCodes` (parity with DuelStartingMsg)", () => {
    // The branch reads `session.soloMode` and constructs a different payload
    // when true. The source-level guard pins both branches exist.
    expect(SOURCE).toMatch(/session\.soloMode\s*\?\s*\{[^}]*type:\s*'EARLY_DECK_PREFETCH'/s);
    expect(SOURCE).toMatch(/bothCardCodes:\s*\[/);
  });
});
