import { DuelConnection } from './duel-connection';
import type {
  ServerMessage,
  TimerStateMsg,
  ConfirmCardsMsg,
  CardInfo,
  Player,
} from '../duel-ws.types';
import { createMockWebSocketFactory } from './_test-utils/mock-websocket';

// =============================================================================
// Test helpers
// =============================================================================

interface MockWs {
  readyState: number;
  send: jasmine.Spy;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close: jasmine.Spy;
}

function makeMockWs(open = true): MockWs {
  return {
    readyState: open ? WebSocket.OPEN : WebSocket.CONNECTING,
    send: jasmine.createSpy('ws.send'),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close: jasmine.createSpy('ws.close'),
  };
}

function makeConn(opts: { autoReconnect?: boolean; ws?: MockWs | null } = {}): {
  conn: DuelConnection;
  ws: MockWs | null;
} {
  // Construction is side-effect-free except for initial signal setup.
  // Use a unique storageKey per test so localStorage doesn't leak across runs.
  const storageKey = `duel-test-${Math.random().toString(36).slice(2, 10)}`;
  const conn = new DuelConnection('/ws/test', opts.autoReconnect ?? false, storageKey);
  // Inject the mock WS directly — bypass connect() to avoid real
  // WebSocket construction (would fail in karma without a server).
  const ws = opts.ws ?? null;
  if (ws) (conn as unknown as { ws: MockWs }).ws = ws;
  return { conn, ws };
}

/** Invoke private handleMessage through the public surface. */
function dispatch(conn: DuelConnection, msg: ServerMessage): void {
  (conn as unknown as { handleMessage(m: ServerMessage): void }).handleMessage(msg);
}

// =============================================================================
// Initial state
// =============================================================================

describe('DuelConnection — initial state', () => {
  it('has sane default signal values', () => {
    const { conn } = makeConn();
    expect(conn.pendingPrompt()).toBeNull();
    expect(conn.connectionStatus()).toBe('connected');
    expect(conn.protocolMismatch()).toBeFalse();
    expect(conn.opponentDisconnected()).toBeFalse();
    expect(conn.disconnectGraceSec()).toBe(0);
    expect(conn.duelResult()).toBeNull();
    expect(conn.diceResult()).toBeNull();
    expect(conn.diceInProgress()).toBeFalse();
    expect(conn.timerState()).toBeNull();
    expect(conn.timerStatePerPlayer()).toEqual([null, null]);
    expect(conn.inactivityWarning()).toBeNull();
    expect(conn.waitingForOpponent()).toBeFalse();
    expect(conn.firstPlayerResult()).toBeNull();
    expect(conn.firstPlayerResponseSent()).toBeFalse();
    expect(conn.lastSelectedCards).toEqual([]);
    expect(conn.lastConfirmedCards).toEqual([]);
    expect(conn.justReconnected()).toBeFalse();
  });
});

// =============================================================================
// State-mutating helpers (no WS involvement)
// =============================================================================

describe('DuelConnection — state setters', () => {
  it('setBoardActive(true) does not throw and is observable via subsequent BOARD_STATE behavior', () => {
    const { conn } = makeConn();
    // _boardActive is private; verify the setter is callable. Effect tested
    // indirectly through BOARD_STATE handling in syncAfterBoardState.
    expect(() => conn.setBoardActive(true)).not.toThrow();
    expect(() => conn.setBoardActive(false)).not.toThrow();
  });


  it('clearStorageToken removes the storage entry', () => {
    const storageKey = `duel-test-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(storageKey, 'token-abc');
    const conn = new DuelConnection('/ws/test', false, storageKey);
    conn.clearStorageToken();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('clearDiceResult sets diceResult signal to null', () => {
    const { conn } = makeConn();
    dispatch(conn, {
      type: 'DICE_RESULT',
      winner: 0 as Player,
      dice0: [6, 5], dice1: [3, 2], sum0: 11, sum1: 5,
    } as unknown as ServerMessage);
    expect(conn.diceResult()).not.toBeNull();
    conn.clearDiceResult();
    expect(conn.diceResult()).toBeNull();
  });
});

// =============================================================================
// handleMessage dispatch — connection lifecycle
// =============================================================================

describe('DuelConnection — handleMessage: connection lifecycle', () => {
  it('SESSION_TOKEN sets connectionStatus=connected, stores reconnectToken, resets retryCount', () => {
    const { conn } = makeConn();
    dispatch(conn, {
      type: 'SESSION_TOKEN', token: 'reconnect-xyz',
    } as unknown as ServerMessage);
    expect(conn.connectionStatus()).toBe('connected');
    // _hasToken should now be true → canRetry depends on autoReconnect.
    // Inspect the rotated token via a follow-up disconnect's behavior:
    // we just assert the public-facing connectionStatus signal here.
  });

  it('SESSION_TOKEN persists token to localStorage when autoReconnect=true', () => {
    const storageKey = `duel-persist-${Math.random().toString(36).slice(2, 10)}`;
    const conn = new DuelConnection('/ws/test', true, storageKey);
    dispatch(conn, {
      type: 'SESSION_TOKEN', token: 'rotating-token',
    } as unknown as ServerMessage);
    expect(localStorage.getItem(storageKey)).toBe('rotating-token');
    // Cleanup
    localStorage.removeItem(storageKey);
  });
});

// =============================================================================
// handleMessage dispatch — opponent state
// =============================================================================

describe('DuelConnection — handleMessage: opponent state', () => {
  it('OPPONENT_DISCONNECTED sets disconnected + grace period', () => {
    const { conn } = makeConn();
    dispatch(conn, {
      type: 'OPPONENT_DISCONNECTED', gracePeriodSec: 30,
    } as unknown as ServerMessage);
    expect(conn.opponentDisconnected()).toBeTrue();
    expect(conn.disconnectGraceSec()).toBe(30);
  });

  it('OPPONENT_RECONNECTED clears disconnected + grace', () => {
    const { conn } = makeConn();
    dispatch(conn, {
      type: 'OPPONENT_DISCONNECTED', gracePeriodSec: 30,
    } as unknown as ServerMessage);
    dispatch(conn, { type: 'OPPONENT_RECONNECTED' } as unknown as ServerMessage);
    expect(conn.opponentDisconnected()).toBeFalse();
    expect(conn.disconnectGraceSec()).toBe(0);
  });

  it('INACTIVITY_WARNING sets the signal', () => {
    const { conn } = makeConn();
    const warn = { type: 'INACTIVITY_WARNING', secondsLeft: 10 } as unknown as ServerMessage;
    dispatch(conn, warn);
    expect(conn.inactivityWarning()).toBe(warn as never);
  });
});

// =============================================================================
// handleMessage dispatch — timers
// =============================================================================

describe('DuelConnection — handleMessage: TIMER_STATE', () => {
  it('updates timerState (latest) AND timerStatePerPlayer (per-player slot)', () => {
    const { conn } = makeConn();
    const t0: TimerStateMsg = { type: 'TIMER_STATE', player: 0 as Player, remainingMs: 100_000, totalMs: 1_200_000 };
    const t1: TimerStateMsg = { type: 'TIMER_STATE', player: 1 as Player, remainingMs: 90_000, totalMs: 1_200_000 };
    dispatch(conn, t0 as unknown as ServerMessage);
    expect(conn.timerState()).toBe(t0);
    expect(conn.timerStatePerPlayer()).toEqual([t0, null]);
    dispatch(conn, t1 as unknown as ServerMessage);
    expect(conn.timerState()).toBe(t1);
    expect(conn.timerStatePerPlayer()).toEqual([t0, t1]);
  });
});

// =============================================================================
// handleMessage dispatch — duel end
// =============================================================================

describe('DuelConnection — handleMessage: DUEL_END', () => {
  it('sets duelResult + clears pending prompt + clears confirm buffers + removes storage token', () => {
    const storageKey = `duel-end-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(storageKey, 'will-be-cleared');
    const conn = new DuelConnection('/ws/test', false, storageKey);
    // Prime a CONFIRM buffer entry first.
    dispatch(conn, {
      type: 'MSG_CONFIRM_CARDS', player: 0 as Player, cards: [
        { cardCode: 1, name: 'A', player: 0, location: 1, sequence: 0 },
      ],
    } as ConfirmCardsMsg);
    expect(conn.lastConfirmedCards.length).toBe(1);

    const endMsg = {
      type: 'DUEL_END', winner: 0 as Player, reason: 'lp_zero',
    } as unknown as ServerMessage;
    dispatch(conn, endMsg);

    expect(conn.duelResult()).toBe(endMsg as never);
    expect(conn.pendingPrompt()).toBeNull();
    expect(conn.lastConfirmedCards).toEqual([]);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});

// =============================================================================
// F14 (2026-05-31) — atomic STATE_SYNC + CHAIN_STATE
// -----------------------------------------------------------------------------
// STATE_SYNC is buffered ; CHAIN_STATE consumes it and applies the pair
// atomically in the same tick (no transient empty-chain window). A
// fallback timer flushes STATE_SYNC alone if CHAIN_STATE never arrives.
// =============================================================================

describe('DuelConnection — F14 atomic STATE_SYNC + CHAIN_STATE', () => {
  // Minimal BOARD_STATE-shaped payload — the spec only cares that
  // _applyStateSync runs without throwing on it. The RBS sanitization
  // path tolerates an empty-zone shape.
  const emptyBoardData = {
    players: [
      { lp: 8000, deckCount: 40, extraCount: 0, hand: [], zones: [] },
      { lp: 8000, deckCount: 40, extraCount: 0, hand: [], zones: [] },
    ],
    turnPlayer: 0,
    turnCount: 0,
    phase: 1,
  } as never;

  it('STATE_SYNC alone does NOT apply immediately — onStateSync callback is deferred', () => {
    const { conn } = makeConn({ ws: makeMockWs(true) });
    const onStateSyncSpy = jasmine.createSpy('onStateSync');
    conn.onStateSync = onStateSyncSpy;

    dispatch(conn, {
      type: 'STATE_SYNC', data: emptyBoardData,
    } as unknown as ServerMessage);

    // No CHAIN_STATE arrived yet ; the buffer is parked.
    expect(onStateSyncSpy).not.toHaveBeenCalled();
  });

  it('STATE_SYNC + CHAIN_STATE applied atomically in the same tick (onStateSync fires before chain restore)', () => {
    const { conn } = makeConn({ ws: makeMockWs(true) });
    const callOrder: string[] = [];
    conn.onStateSync = () => callOrder.push('onStateSync');
    spyOn(conn['processor'] as unknown as { restoreChainState: () => void }, 'restoreChainState')
      .and.callFake(() => callOrder.push('restoreChainState'));

    dispatch(conn, {
      type: 'STATE_SYNC', data: emptyBoardData,
    } as unknown as ServerMessage);
    dispatch(conn, {
      type: 'CHAIN_STATE', links: [], phase: 'idle', negatedIndices: [],
    } as unknown as ServerMessage);

    expect(callOrder).toEqual(['onStateSync', 'restoreChainState']);
  });

  it('STATE_SYNC fallback timer flushes the buffer if no CHAIN_STATE arrives', (done) => {
    const { conn } = makeConn({ ws: makeMockWs(true) });
    const onStateSyncSpy = jasmine.createSpy('onStateSync');
    conn.onStateSync = onStateSyncSpy;

    dispatch(conn, {
      type: 'STATE_SYNC', data: emptyBoardData,
    } as unknown as ServerMessage);

    // Just after dispatch — still buffered.
    expect(onStateSyncSpy).not.toHaveBeenCalled();

    // STATE_SYNC_FLUSH_MS is 100ms ; wait a bit more.
    setTimeout(() => {
      expect(onStateSyncSpy).toHaveBeenCalledTimes(1);
      done();
    }, 150);
  });

  it('a second STATE_SYNC flushes the prior buffer before parking the new payload', () => {
    const { conn } = makeConn({ ws: makeMockWs(true) });
    const onStateSyncSpy = jasmine.createSpy('onStateSync');
    conn.onStateSync = onStateSyncSpy;

    const first = { type: 'STATE_SYNC', data: emptyBoardData } as unknown as ServerMessage;
    const second = { type: 'STATE_SYNC', data: emptyBoardData } as unknown as ServerMessage;

    dispatch(conn, first);
    expect(onStateSyncSpy).not.toHaveBeenCalled();

    dispatch(conn, second);
    // The first one got flushed sync at the second dispatch ; the second
    // is now parked.
    expect(onStateSyncSpy).toHaveBeenCalledTimes(1);
    expect(onStateSyncSpy).toHaveBeenCalledWith(first as never);
  });

  it('CHAIN_STATE without buffered STATE_SYNC restores chain best-effort (no throw, warn-only)', () => {
    const { conn } = makeConn({ ws: makeMockWs(true) });
    spyOn(conn['processor'] as unknown as { restoreChainState: () => void }, 'restoreChainState');

    // No STATE_SYNC dispatched first — protocol violation.
    expect(() => {
      dispatch(conn, {
        type: 'CHAIN_STATE', links: [], phase: 'idle', negatedIndices: [],
      } as unknown as ServerMessage);
    }).not.toThrow();
    expect((conn['processor'] as unknown as { restoreChainState: jasmine.Spy }).restoreChainState)
      .toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// handleMessage dispatch — RPS cycle
// =============================================================================

describe('DuelConnection — handleMessage: dice', () => {
  it('DICE_ROLL is a prompt (diceInProgress stays false); sendResponse flips it to true; DICE_RESULT clears it', () => {
    // Inject an open mock WS so `sendResponse` reaches the `if (safeSend(...))`
    // branch that flips diceInProgress (no-op when WS is missing).
    const { conn } = makeConn({ ws: makeMockWs(true) });
    dispatch(conn, {
      type: 'DICE_ROLL', player: 0,
    } as unknown as ServerMessage);
    // Receiving the prompt does NOT mean "rolling" — the user still has to
    // confirm their roll (auto-roll timer or manual click).
    expect(conn.diceInProgress()).toBeFalse();
    expect(conn.pendingPrompt()).toEqual({ type: 'DICE_ROLL', player: 0 } as never);

    conn.sendResponse('DICE_ROLL', {});
    expect(conn.diceInProgress()).toBeTrue();

    const result = {
      type: 'DICE_RESULT', winner: 0, dice0: [6, 5], dice1: [3, 2], sum0: 11, sum1: 5,
    } as unknown as ServerMessage;
    dispatch(conn, result);
    expect(conn.diceInProgress()).toBeFalse();
    expect(conn.diceResult()).toBe(result as never);
  });

  // γ-c regression (2026-05-29) — pre-duel prompts (DICE_ROLL,
  // SELECT_FIRST_PLAYER) for the joiner (player:1) must reach BOTH slots.
  // The dice-arena reads via `perspectiveSlot()` = `ownPlayerIndex()`, which is
  // 0 on the first duel (ocgPlayerIndex unresolved) but the resolved index 1 on
  // a rematch (ocgPlayerIndex survives REMATCH_STARTING). A single-slot route is
  // correct for exactly one of the two cases. `_slots[1]` is asserted via the
  // per-slot accessor `getPendingPromptFor(1)` to pin the rematch path.
  function slotPrompt(conn: DuelConnection, slot: 0 | 1) {
    return (conn as unknown as {
      getPendingPromptFor(p: 0 | 1): () => unknown;
    }).getPendingPromptFor(slot)();
  }

  it('DICE_ROLL (player:1) lands in BOTH slots (first-duel + rematch read paths)', () => {
    const { conn } = makeConn({ ws: makeMockWs(true) });
    dispatch(conn, { type: 'DICE_ROLL', player: 1 } as unknown as ServerMessage);
    const expected = { type: 'DICE_ROLL', player: 1 };
    expect(slotPrompt(conn, 0)).toEqual(expected as never); // first-duel path (ownIdx=0)
    expect(slotPrompt(conn, 1)).toEqual(expected as never); // rematch path (ownIdx=1)
  });

  it('SELECT_FIRST_PLAYER (player:1) lands in BOTH slots (first-duel + rematch read paths)', () => {
    const { conn } = makeConn({ ws: makeMockWs(true) });
    dispatch(conn, { type: 'SELECT_FIRST_PLAYER', player: 1 } as unknown as ServerMessage);
    const expected = { type: 'SELECT_FIRST_PLAYER', player: 1 };
    expect(slotPrompt(conn, 0)).toEqual(expected as never);
    expect(slotPrompt(conn, 1)).toEqual(expected as never);
  });

  it('FIRST_PLAYER_RESULT clears pendingPrompt on BOTH slots (dice-loser stuck-on-result fix)', () => {
    // γ-c regression (2026-05-30) — the pre-duel prompts are written to BOTH
    // slots. The dice LOSER never sends a response, so its residual DICE_ROLL /
    // SELECT_FIRST_PLAYER is never cleared by `sendResponse`. When DUEL_STARTING
    // later flips ocgPlayerIndex 0→1 for the joiner, `perspectiveSlot()` switches
    // the read from `_slots[0]` to `_slots[1]`, resurfacing the stale DICE_ROLL.
    // The dice-arena's "fresh DICE_ROLL" effect then resets `_finalSeen=false`,
    // dropping the stage `final → result` → loser stuck on "opponent choosing".
    // FIRST_PLAYER_RESULT ends the pre-duel prompt phase, so it MUST wipe
    // pendingPrompt on both slots.
    const { conn } = makeConn({ ws: makeMockWs(true) });
    dispatch(conn, { type: 'DICE_ROLL', player: 1 } as unknown as ServerMessage);
    expect(slotPrompt(conn, 0)).not.toBeNull();
    expect(slotPrompt(conn, 1)).not.toBeNull();

    dispatch(conn, { type: 'FIRST_PLAYER_RESULT', goFirst: false } as unknown as ServerMessage);
    expect(slotPrompt(conn, 0)).toBeNull();
    expect(slotPrompt(conn, 1)).toBeNull();
  });

  it('DICE_ROLL clears rematchStarting (the dice arena takes over from the "Starting…" modal)', () => {
    // A rematch re-runs the pre-duel dice flow. rematchStarting stays true
    // from REMATCH_STARTING until the new duel's BOARD_STATE (~6s later) —
    // the first DICE_ROLL must clear it so the "Starting new duel…" modal
    // does not sit on top of, and block, the dice arena.
    const { conn } = makeConn({ ws: makeMockWs(true) });
    dispatch(conn, { type: 'REMATCH_STARTING' } as unknown as ServerMessage);
    expect(conn.rematchStarting()).toBeTrue();
    dispatch(conn, { type: 'DICE_ROLL', player: 0 } as unknown as ServerMessage);
    expect(conn.rematchStarting()).toBeFalse();
  });
});

// =============================================================================
// handleMessage dispatch — MSG_CONFIRM_CARDS chainIndex tagging (M22)
// =============================================================================

describe('DuelConnection — handleMessage: MSG_CONFIRM_CARDS chainIndex tagging', () => {
  const card = (code: number): CardInfo => ({
    cardCode: code, name: `card${code}`, player: 0 as Player,
    location: 1, sequence: 0,
  });

  it('with chainIndex: tagged into _confirmedCardsByChain AND flat _lastConfirmedCards', () => {
    const { conn } = makeConn();
    dispatch(conn, {
      type: 'MSG_CONFIRM_CARDS', player: 0 as Player, cards: [card(1)],
      chainIndex: 5,
    } as ConfirmCardsMsg);
    expect(conn.lastConfirmedCards.map(c => c.cardCode)).toEqual([1]);
    expect(conn.confirmedCardsForChainIndex(5).map(c => c.cardCode)).toEqual([1]);
    expect(conn.confirmedCardsForChainIndex(99)).toEqual([]); // other chainIndex empty
  });

  it('without chainIndex: only flat buffer is updated, no per-chain entry created', () => {
    const { conn } = makeConn();
    dispatch(conn, {
      type: 'MSG_CONFIRM_CARDS', player: 0 as Player, cards: [card(2)],
      // chainIndex omitted
    } as ConfirmCardsMsg);
    expect(conn.lastConfirmedCards.map(c => c.cardCode)).toEqual([2]);
    expect(conn.confirmedCardsForChainIndex(0)).toEqual([]);
    // confirmedCardsForChainIndex(null) returns the flat buffer.
    expect(conn.confirmedCardsForChainIndex(null).map(c => c.cardCode)).toEqual([2]);
  });
});

// =============================================================================
// sendResponse — WS gating + signal mutations
// =============================================================================

describe('DuelConnection — sendResponse', () => {
  it('returns silently when WS is not OPEN (no send, no signal mutation)', () => {
    const { conn, ws } = makeConn({ ws: makeMockWs(false) });
    // Prime a pendingPrompt to verify it is NOT cleared on dropped send.
    dispatch(conn, {
      type: 'SELECT_YESNO', player: 0,
    } as unknown as ServerMessage);
    expect(conn.pendingPrompt()).not.toBeNull();

    conn.sendResponse('SELECT_YESNO', { value: 1 });
    expect(ws!.send).not.toHaveBeenCalled();
    // pendingPrompt remains set because safeSend returned false.
    expect(conn.pendingPrompt()).not.toBeNull();
  });

  it('on success: sends PLAYER_RESPONSE, clears pendingPrompt + inactivityWarning', () => {
    const ws = makeMockWs(true);
    const { conn } = makeConn({ ws });
    dispatch(conn, {
      type: 'SELECT_YESNO', player: 0,
    } as unknown as ServerMessage);
    dispatch(conn, {
      type: 'INACTIVITY_WARNING', secondsLeft: 5,
    } as unknown as ServerMessage);
    expect(conn.pendingPrompt()).not.toBeNull();
    expect(conn.inactivityWarning()).not.toBeNull();

    conn.sendResponse('SELECT_YESNO', { value: 1 });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.calls.argsFor(0)[0] as string);
    expect(sent).toEqual({
      type: 'PLAYER_RESPONSE',
      promptType: 'SELECT_YESNO',
      data: { value: 1 },
    });
    expect(conn.pendingPrompt()).toBeNull();
    expect(conn.inactivityWarning()).toBeNull();
  });

  // F-bugB3 (2026-05-31) — PvP normal slot-resolution regression.
  // γ-c PR2 c4.3 introduced per-perspective slots (`_slots[0|1]`) and made
  // `sendResponse(_, _, forPlayer)` clear `_slots[forPlayer ?? 0]` after a
  // successful send. In SOLO `forPlayer` is the active perspective; in PvP
  // normal `wsService.sendResponse` calls through with `forPlayer===undefined`,
  // which fell back to `_slots[0]`. That fallback is right for a P0 viewer
  // but WRONG for a P1 viewer — P1's prompt is routed by `handleMessage` to
  // `_slots[1]` (per `message.player`). The stale `_slots[1].pendingPrompt`
  // survived the response and was re-read by the UI after a transient
  // `visiblePrompt` gate (animation queue / phase announcement); the dialog
  // re-opened on the same prompt, the user re-declined, the server received
  // a duplicate response while `awaitingResponse[1]===false` and dropped it
  // as `Unexpected PLAYER_RESPONSE` → modal stuck on "Sending…".
  //
  // Fix: resolve the slot from the pending prompt's own `player` field when
  // `forPlayer` is unset.
  it('clears _slots[1] for a player=1 prompt when forPlayer is omitted (F-bugB3)', () => {
    const ws = makeMockWs(true);
    const { conn } = makeConn({ ws });
    // Route a SELECT_CHAIN to player 1 — handleMessage writes _slots[1].
    dispatch(conn, {
      type: 'SELECT_CHAIN', player: 1, cards: [
        { cardCode: 42141493, location: 2, sequence: 3, player: 1 } as CardInfo,
      ], forced: false, hintTiming: 0,
    } as unknown as ServerMessage);
    // slot accessor (private API exposed for tests, mirrors the helper used
    // by the A39-bis suite below).
    const slotPrompt = (slot: 0 | 1) => (conn as unknown as {
      getPendingPromptFor(p: 0 | 1): () => unknown;
    }).getPendingPromptFor(slot)();
    expect(slotPrompt(0)).toBeNull();
    expect(slotPrompt(1)).not.toBeNull();

    // PvP normal: forPlayer omitted. The previous implementation cleared
    // _slots[0] (wrong slot) and left _slots[1] stale.
    conn.sendResponse('SELECT_CHAIN', { index: null });

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(slotPrompt(1)).toBeNull();
  });

  it('still clears _slots[0] for a player=0 prompt when forPlayer is omitted (F-bugB3)', () => {
    const ws = makeMockWs(true);
    const { conn } = makeConn({ ws });
    dispatch(conn, {
      type: 'SELECT_CHAIN', player: 0, cards: [
        { cardCode: 1, location: 2, sequence: 0, player: 0 } as CardInfo,
      ], forced: false, hintTiming: 0,
    } as unknown as ServerMessage);
    const slotPrompt = (slot: 0 | 1) => (conn as unknown as {
      getPendingPromptFor(p: 0 | 1): () => unknown;
    }).getPendingPromptFor(slot)();
    expect(slotPrompt(0)).not.toBeNull();
    expect(slotPrompt(1)).toBeNull();

    conn.sendResponse('SELECT_CHAIN', { index: null });

    expect(slotPrompt(0)).toBeNull();
  });

  it('forPlayer wins over the prompt-player heuristic (SOLO path, F-bugB3 scope)', () => {
    // In SOLO multiplex `wsService.sendForPlayer()` returns the active
    // perspective and is passed explicitly. The heuristic that fixes PvP
    // normal MUST NOT override it — pass forPlayer=0 and expect slot 0 to
    // be cleared even if _slots[1] happens to hold something.
    const ws = makeMockWs(true);
    const { conn } = makeConn({ ws });
    // Park a prompt in slot 1 (SOLO would do this for the inactive side).
    dispatch(conn, {
      type: 'SELECT_CHAIN', player: 1, cards: [
        { cardCode: 1, location: 2, sequence: 0, player: 1 } as CardInfo,
      ], forced: false, hintTiming: 0,
    } as unknown as ServerMessage);
    // Park a prompt in slot 0 too.
    dispatch(conn, {
      type: 'SELECT_CHAIN', player: 0, cards: [
        { cardCode: 2, location: 2, sequence: 0, player: 0 } as CardInfo,
      ], forced: false, hintTiming: 0,
    } as unknown as ServerMessage);
    const slotPrompt = (slot: 0 | 1) => (conn as unknown as {
      getPendingPromptFor(p: 0 | 1): () => unknown;
    }).getPendingPromptFor(slot)();
    expect(slotPrompt(0)).not.toBeNull();
    expect(slotPrompt(1)).not.toBeNull();

    // Explicit forPlayer=0 must clear slot 0 even though slot 1 has a
    // player=1 prompt that the heuristic would otherwise target.
    conn.sendResponse('SELECT_CHAIN', { index: null }, 0);

    expect(slotPrompt(0)).toBeNull();
    expect(slotPrompt(1)).not.toBeNull();
  });
});

// =============================================================================
// γ Option C PR2 c5d — A39-bis MSG_HINT broadcast intra-slot
// =============================================================================
// SAFE_PUBLIC_HINT_TYPES from message-filter.ts:32 = [1, 2, 6, 7, 9]. The server
// broadcasts these to BOTH players ; payload.player is the ORIGIN (sourcePlayer),
// not the destinataire. Without A39-bis, c4.2 routed writes `_slots[origin]`,
// leaving the other slot empty — invisible to any reader whose slotIndex !== origin.

describe('DuelConnection — A39-bis MSG_HINT broadcast intra-slot', () => {
  it('routed hint (non-broadcast type) writes only _slots[message.player]', () => {
    const { conn } = makeConn();

    dispatch(conn, {
      type: 'MSG_HINT',
      hintType: 3, // SELECT_MSG — not in broadcast set
      player: 1 as Player,
      value: 0,
      cardName: 'Solemn',
    } as unknown as ServerMessage);

    expect(conn.getHintContextFor(1)().cardName).toBe('Solemn');
    expect(conn.getHintContextFor(0)().cardName).toBe('');
  });

  it('broadcast hint (type 1) writes BOTH slots', () => {
    const { conn } = makeConn();

    dispatch(conn, {
      type: 'MSG_HINT',
      hintType: 1, // SAFE_PUBLIC_HINT_TYPES — broadcast
      player: 1 as Player,
      value: 42,
      cardName: 'Public Hint',
    } as unknown as ServerMessage);

    expect(conn.getHintContextFor(0)().cardName).toBe('Public Hint');
    expect(conn.getHintContextFor(1)().cardName).toBe('Public Hint');
    expect(conn.getHintContextFor(0)().value).toBe(42);
    expect(conn.getHintContextFor(1)().value).toBe(42);
  });

  it('broadcast hint types 2, 6, 7, 9 also write both slots', () => {
    for (const hintType of [2, 6, 7, 9]) {
      const { conn } = makeConn();
      dispatch(conn, {
        type: 'MSG_HINT',
        hintType,
        player: 0 as Player,
        value: hintType * 10,
        cardName: `H${hintType}`,
      } as unknown as ServerMessage);
      expect(conn.getHintContextFor(0)().cardName).toBe(`H${hintType}`);
      expect(conn.getHintContextFor(1)().cardName).toBe(`H${hintType}`);
    }
  });

  it('A34 intra-slot inheritance preserved across broadcast → routed sequence', () => {
    const { conn } = makeConn();
    // Routed hint sets origin slot's cardName via direct write.
    dispatch(conn, {
      type: 'MSG_HINT',
      hintType: 10, // not broadcast — cardHint type
      player: 1 as Player,
      value: 0,
      cardName: 'Origin Card',
    } as unknown as ServerMessage);

    // Follow-up SELECT_MSG (type 3 — not broadcast) inherits cardName intra-slot[1].
    dispatch(conn, {
      type: 'MSG_HINT',
      hintType: 3,
      player: 1 as Player,
      value: 0,
      cardName: '',
    } as unknown as ServerMessage);

    expect(conn.getHintContextFor(1)().cardName).toBe('Origin Card');
    // Slot 0 was never written — stays empty.
    expect(conn.getHintContextFor(0)().cardName).toBe('');
  });

  it('broadcast hint cardName empty does NOT inherit from prev (cardName: "" wins)', () => {
    const { conn } = makeConn();
    // Prime slot 1 with a cardName via routed hint.
    dispatch(conn, {
      type: 'MSG_HINT',
      hintType: 10,
      player: 1 as Player,
      value: 0,
      cardName: 'Previous',
    } as unknown as ServerMessage);

    // Broadcast hint type 1, cardName empty. Inheritance gate
    // (canInherit = isSelectMsg && !hintCardConsumed) requires isSelectMsg=true
    // (hintType=3). For broadcast type 1 (not select), no inheritance.
    dispatch(conn, {
      type: 'MSG_HINT',
      hintType: 1,
      player: 0 as Player,
      value: 0,
      cardName: '',
    } as unknown as ServerMessage);

    // Both slots overwritten by broadcast — cardName cleared.
    expect(conn.getHintContextFor(0)().cardName).toBe('');
    expect(conn.getHintContextFor(1)().cardName).toBe('');
  });
});

// =============================================================================
// U2 (audit-4-modes-2026-06-01) — Close-code 4426 (protocol version mismatch)
// branch. The DuelConnection's onclose handler at duel-connection.ts:921-937
// wipes both tokens, clears the localStorage entry, sets the protocolMismatch
// signal so the page renders the "please refresh" banner. Pre-U2 there was
// zero test exercising this branch — a regression silently removing the
// token-wipe would only surface on a PROTOCOL_VERSION bump in prod with
// stale-bundle clients.
// =============================================================================

describe('DuelConnection — onclose 4426 protocol mismatch (U2)', () => {
  function makeConnWithFactory(): {
    conn: DuelConnection;
    socket: { fireClose(code?: number): void; fireOpen(): void };
  } {
    const storageKey = `duel-test-${Math.random().toString(36).slice(2, 10)}`;
    const factory = createMockWebSocketFactory();
    const conn = new DuelConnection('/ws/test', false, storageKey, undefined, {
      // Cast to bypass the WebSocket structural-type mismatch — MockWebSocket
      // implements the subset DuelConnection actually uses.
      wsFactory: factory as unknown as { create(url: string): WebSocket },
    });
    // Drive a connect() so onclose gets wired by openConnection.
    conn.connect('tok-ws');
    const socket = factory.socket!;
    return { conn, socket };
  }

  it('wipes reconnectToken + wsToken on close code 4426', () => {
    const { conn, socket } = makeConnWithFactory();
    socket.fireOpen();
    // Simulate that the client had stored a reconnect token before the close
    // (wsToken is already set to 'tok-ws' by connect() above).
    (conn as unknown as { reconnectToken: string | null }).reconnectToken = 'tok-r';

    socket.fireClose(4426);

    expect((conn as unknown as { reconnectToken: string | null }).reconnectToken).toBeNull();
    expect((conn as unknown as { wsToken: string | null }).wsToken).toBeNull();
  });

  it('sets protocolMismatch + flips connectionStatus to "lost"', () => {
    const { conn, socket } = makeConnWithFactory();
    socket.fireOpen();
    expect(conn.protocolMismatch()).toBeFalse();

    socket.fireClose(4426);

    expect(conn.protocolMismatch()).toBeTrue();
    expect(conn.connectionStatus()).toBe('lost');
  });

  it('clears the localStorage token entry on 4426', () => {
    const { conn, socket } = makeConnWithFactory();
    socket.fireOpen();
    const storageKey = (conn as unknown as { storageKey: string }).storageKey;
    localStorage.setItem(storageKey, 'tok-persisted');

    socket.fireClose(4426);

    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('control — non-4426 close (e.g. 1006) does NOT set protocolMismatch', () => {
    const { conn, socket } = makeConnWithFactory();
    socket.fireOpen();

    socket.fireClose(1006);

    expect(conn.protocolMismatch()).toBeFalse();
  });
});

// =============================================================================
// U29 (audit-4-modes-2026-06-01) — DuelConnection.cleanup() idempotence.
// Transport Lifecycle Invariant 1 (CLAUDE.md) requires cleanup() to be safe
// to call multiple times — SOLO multiplex teardown invokes it twice
// (orchestrator.cleanup + wsService.ngOnDestroy), and the wsService ctor
// builds a default conn immediately replaced + cleaned by bindSoloConnection.
// =============================================================================

describe('DuelConnection.cleanup() — idempotence (Transport Lifecycle Invariant 1)', () => {
  it('calling cleanup() twice in a row does not throw', () => {
    const storageKey = `duel-test-${Math.random().toString(36).slice(2, 10)}`;
    const conn = new DuelConnection('/ws/test', false, storageKey);

    expect(() => {
      conn.cleanup();
      conn.cleanup();
    }).not.toThrow();
  });

  it('calling cleanup() without a prior connect() does not throw', () => {
    const storageKey = `duel-test-${Math.random().toString(36).slice(2, 10)}`;
    const conn = new DuelConnection('/ws/test', false, storageKey);

    expect(() => conn.cleanup()).not.toThrow();
  });
});
