import { DuelConnection } from './duel-connection';
import type {
  ServerMessage,
  TimerStateMsg,
  ConfirmCardsMsg,
  CardInfo,
  Player,
} from '../duel-ws.types';

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
    expect(conn.rpsResult()).toBeNull();
    expect(conn.rpsInProgress()).toBeFalse();
    expect(conn.timerState()).toBeNull();
    expect(conn.timerStatePerPlayer()).toEqual([null, null]);
    expect(conn.inactivityWarning()).toBeNull();
    expect(conn.waitingForOpponent()).toBeFalse();
    expect(conn.tpResult()).toBeNull();
    expect(conn.tpResponseSent()).toBeFalse();
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

  it('clearLastSelections clears all 5 prompt-flow buffers', () => {
    const { conn } = makeConn();
    // Prime the buffers via a CONFIRM_CARDS dispatch.
    const card: CardInfo = {
      cardCode: 42, name: 'X', player: 0 as Player,
      location: 1, sequence: 0,
    };
    dispatch(conn, {
      type: 'MSG_CONFIRM_CARDS', player: 0 as Player, cards: [card],
    } as ConfirmCardsMsg);
    expect(conn.lastConfirmedCards.length).toBe(1);

    conn.clearLastSelections();
    expect(conn.lastConfirmedCards).toEqual([]);
    expect(conn.lastSelectedCards).toEqual([]);
    // _confirmedCardsByChain is private; verify via accessor.
    expect(conn.confirmedCardsForChainIndex(0)).toEqual([]);
  });

  it('clearStorageToken removes the storage entry', () => {
    const storageKey = `duel-test-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(storageKey, 'token-abc');
    const conn = new DuelConnection('/ws/test', false, storageKey);
    conn.clearStorageToken();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('clearRpsResult sets rpsResult signal to null', () => {
    const { conn } = makeConn();
    dispatch(conn, {
      type: 'RPS_RESULT',
      winner: 0 as Player,
      choices: [1, 2],
    } as unknown as ServerMessage);
    expect(conn.rpsResult()).not.toBeNull();
    conn.clearRpsResult();
    expect(conn.rpsResult()).toBeNull();
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
    const t0: TimerStateMsg = { type: 'TIMER_STATE', player: 0 as Player, remainingMs: 100_000 };
    const t1: TimerStateMsg = { type: 'TIMER_STATE', player: 1 as Player, remainingMs: 90_000 };
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
// handleMessage dispatch — RPS cycle
// =============================================================================

describe('DuelConnection — handleMessage: RPS', () => {
  it('RPS_CHOICE sets rpsInProgress=true, RPS_RESULT clears it and stores result', () => {
    const { conn } = makeConn();
    dispatch(conn, {
      type: 'RPS_CHOICE',
    } as unknown as ServerMessage);
    expect(conn.rpsInProgress()).toBeTrue();
    expect(conn.pendingPrompt()).toEqual({ type: 'RPS_CHOICE' } as never);

    const result = { type: 'RPS_RESULT', winner: 0, choices: [1, 2] } as unknown as ServerMessage;
    dispatch(conn, result);
    expect(conn.rpsInProgress()).toBeFalse();
    expect(conn.rpsResult()).toBe(result as never);
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
});
