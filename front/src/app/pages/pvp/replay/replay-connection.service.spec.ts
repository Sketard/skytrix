import { ReplayConnectionService } from './replay-connection.service';
import type {
  ReplayMetadataMsg,
  ReplayBoardStatesMsg,
  ReplayErrorMsg,
  ReplayForkReadyMsg,
  PreComputedState,
  ForkSanityFields,
} from '../replay-ws.types';
import { EMPTY_DUEL_STATE } from '../types';

// =============================================================================
// Test helpers
// =============================================================================

interface MockWs {
  readyState: number;
  send: jasmine.Spy;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
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

/**
 * Replace the global WebSocket constructor with a stub that captures the
 * mock instance so the test can drive onmessage/onclose callbacks. Returns
 * a restore function to call in afterEach.
 */
function withMockedWebSocket(mock: MockWs): () => void {
  const original = globalThis.WebSocket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = function MockWebSocketCtor() { return mock; };
  // Preserve readyState constants used elsewhere.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket.OPEN = WebSocket.OPEN;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket.CONNECTING = WebSocket.CONNECTING;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket.CLOSED = WebSocket.CLOSED;
  return () => { globalThis.WebSocket = original; };
}

/** Connect svc through the mocked WS so onopen/onmessage/onclose are wired
 *  by the production code path. */
function connectWith(svc: ReplayConnectionService, ws: MockWs): void {
  const restore = withMockedWebSocket(ws);
  try {
    svc.connect('replay-id', 'token');
  } finally {
    // Don't restore yet — leave mocked for subsequent ws operations.
    // Caller is responsible for restoring after the test if needed; we'll
    // keep it simple and let each test call its own setup teardown.
    void restore;
  }
}

/** Synthesize a server → client message dispatch via the wired onmessage. */
function dispatchServerMessage(
  ws: MockWs,
  msg: ReplayMetadataMsg | ReplayBoardStatesMsg | ReplayErrorMsg | ReplayForkReadyMsg,
): void {
  if (!ws.onmessage) throw new Error('onmessage not wired (was connect() called?)');
  ws.onmessage({ data: JSON.stringify(msg) } as MessageEvent);
}

const stubPreComputed = (label: string): PreComputedState => ({
  boardState: EMPTY_DUEL_STATE,
  events: [],
  label,
  responseCount: 0,
});

// =============================================================================
// Initial state
// =============================================================================

describe('ReplayConnectionService — initial state', () => {
  it('has sane default signal values', () => {
    const svc = new ReplayConnectionService();
    expect(svc.connectionStatus()).toBe('disconnected');
    expect(svc.metadata()).toBeNull();
    expect(svc.boardStates()).toEqual([]);
    expect(svc.computedUpTo()).toBe(-1);
    expect(svc.totalResponses()).toBe(0);
    expect(svc.error()).toBeNull();
    expect(svc.lastReceivedTurn()).toBe(-1);
    expect(svc.forkStatus()).toBe('idle');
    expect(svc.forkTokens()).toBeNull();
    expect(svc.forkWarning()).toBeNull();
    expect(svc.protocolMismatch()).toBeFalse();
  });
});

// =============================================================================
// Server → Client message dispatch (via mocked WebSocket)
// =============================================================================

describe('ReplayConnectionService — server message dispatch', () => {
  let svc: ReplayConnectionService;
  let ws: MockWs;
  let restoreWs: () => void;

  beforeEach(() => {
    svc = new ReplayConnectionService();
    ws = makeMockWs(true);
    restoreWs = withMockedWebSocket(ws);
    svc.connect('replay-id', 'tok');
    // Fire onopen so connectionStatus → 'connected'.
    ws.onopen?.(undefined);
  });

  afterEach(() => {
    restoreWs();
    svc.disconnect();
  });

  it('connect() sets connectionStatus=connecting, then onopen → connected', () => {
    // Re-create to test the transition cleanly.
    const ws2 = makeMockWs(true);
    const svc2 = new ReplayConnectionService();
    const restore2 = withMockedWebSocket(ws2);
    svc2.connect('id', 't');
    expect(svc2.connectionStatus()).toBe('connecting');
    ws2.onopen?.(undefined);
    expect(svc2.connectionStatus()).toBe('connected');
    restore2();
  });

  it('REPLAY_METADATA: sets metadata + totalResponses', () => {
    const msg: ReplayMetadataMsg = {
      type: 'REPLAY_METADATA',
      playerUsernames: ['Alice', 'Bob'],
      deckNames: ['DeckA', 'DeckB'],
      turnCount: 10,
      result: null,
      divergenceWarning: false,
      totalResponses: 42,
      cardCodes: [1, 2, 3],
    };
    dispatchServerMessage(ws, msg);
    expect(svc.metadata()).toEqual(msg);
    expect(svc.totalResponses()).toBe(42);
  });

  it('REPLAY_BOARD_STATES: appends states + updates lastReceivedTurn (multi-batch)', () => {
    dispatchServerMessage(ws, {
      type: 'REPLAY_BOARD_STATES', turnNumber: 1,
      states: [stubPreComputed('s0'), stubPreComputed('s1')],
    });
    expect(svc.boardStates().map(s => s.label)).toEqual(['s0', 's1']);
    expect(svc.lastReceivedTurn()).toBe(1);
    expect(svc.computedUpTo()).toBe(1);
    dispatchServerMessage(ws, {
      type: 'REPLAY_BOARD_STATES', turnNumber: 2,
      states: [stubPreComputed('s2')],
    });
    expect(svc.boardStates().map(s => s.label)).toEqual(['s0', 's1', 's2']);
    expect(svc.lastReceivedTurn()).toBe(2);
    expect(svc.computedUpTo()).toBe(2);
  });

  it('REPLAY_ERROR (FORK_DIVERGENCE_WARNING): forkStatus=warning + forkWarning, error untouched', () => {
    dispatchServerMessage(ws, {
      type: 'REPLAY_ERROR',
      code: 'FORK_DIVERGENCE_WARNING',
      message: 'state diverges at response 12',
    });
    expect(svc.forkStatus()).toBe('warning');
    expect(svc.forkWarning()).toBe('state diverges at response 12');
    expect(svc.error()).toBeNull();
  });

  it('REPLAY_ERROR (other code) while forking: transitions forkStatus to error', () => {
    svc.forkStatus.set('forking');
    dispatchServerMessage(ws, {
      type: 'REPLAY_ERROR',
      code: 'INVALID_RESPONSE_COUNT',
      message: 'count out of range',
    });
    expect(svc.forkStatus()).toBe('error');
    expect(svc.error()).toBe('INVALID_RESPONSE_COUNT');
  });

  it('REPLAY_ERROR (other code) while idle: error set, forkStatus stays idle', () => {
    dispatchServerMessage(ws, {
      type: 'REPLAY_ERROR',
      code: 'BAD_REPLAY_FILE',
      message: 'parse failed',
    });
    expect(svc.error()).toBe('BAD_REPLAY_FILE');
    expect(svc.forkStatus()).toBe('idle');
  });

  it('REPLAY_FORK_READY: forkStatus=ready + forkTokens set', () => {
    svc.forkStatus.set('forking');
    dispatchServerMessage(ws, {
      type: 'REPLAY_FORK_READY', token1: 'tok1', token2: 'tok2',
    });
    expect(svc.forkStatus()).toBe('ready');
    expect(svc.forkTokens()).toEqual({ token1: 'tok1', token2: 'tok2' });
  });

  it('onclose with code 4426: sets protocolMismatch=true + error key', () => {
    ws.onclose?.({ code: 4426 });
    expect(svc.protocolMismatch()).toBeTrue();
    expect(svc.error()).toBe('replay.viewer.protocolMismatch');
    expect(svc.connectionStatus()).toBe('disconnected');
  });

  it('onclose with non-4426 code: does NOT set protocolMismatch', () => {
    ws.onclose?.({ code: 1006 }); // generic abnormal closure
    expect(svc.protocolMismatch()).toBeFalse();
    expect(svc.connectionStatus()).toBe('disconnected');
  });
});

// =============================================================================
// Client → Server send methods (WS-gated)
// =============================================================================

describe('ReplayConnectionService — client send methods', () => {
  const sanity: ForkSanityFields = { lp: [8000, 8000], turnNumber: 3, phase: 1 };

  function setup(open: boolean): { svc: ReplayConnectionService; ws: MockWs; restore: () => void } {
    const svc = new ReplayConnectionService();
    const ws = makeMockWs(open);
    // Inject the mock directly — bypass connect() so the readyState we set
    // in makeMockWs is what svc.sendXxx will see (no race with constructor).
    (svc as unknown as { ws: MockWs }).ws = ws;
    return { svc, ws, restore: () => undefined };
  }

  it('sendFork (WS open): sends payload + sets forkStatus=forking + clears tokens/warning', () => {
    const { svc, ws, restore } = setup(true);
    svc.forkTokens.set({ token1: 'old1', token2: 'old2' });
    svc.forkWarning.set('previous warning');
    svc.sendFork(5, sanity);
    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.calls.argsFor(0)[0] as string);
    expect(sent).toEqual({ type: 'REPLAY_FORK', responseCount: 5, expectedState: sanity });
    expect(svc.forkStatus()).toBe('forking');
    expect(svc.forkTokens()).toBeNull();
    expect(svc.forkWarning()).toBeNull();
    restore();
  });

  it('sendFork (WS not open): no-op, no send, no signal mutation', () => {
    const { svc, ws, restore } = setup(false);
    svc.sendFork(5, sanity);
    expect(ws.send).not.toHaveBeenCalled();
    expect(svc.forkStatus()).toBe('idle');
    restore();
  });

  it('sendForkContinue (WS open): sends payload', () => {
    const { svc, ws, restore } = setup(true);
    svc.sendForkContinue();
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.calls.argsFor(0)[0] as string)).toEqual({
      type: 'REPLAY_FORK_CONTINUE',
    });
    restore();
  });

  it('sendForkCancel (WS open): sends payload + resets forkStatus + clears warning', () => {
    const { svc, ws, restore } = setup(true);
    svc.forkStatus.set('warning');
    svc.forkWarning.set('something');
    svc.sendForkCancel();
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(svc.forkStatus()).toBe('idle');
    expect(svc.forkWarning()).toBeNull();
    restore();
  });
});

// =============================================================================
// State management helpers
// =============================================================================

describe('ReplayConnectionService — state helpers', () => {
  it('clearBoardStates empties the boardStates signal', () => {
    const svc = new ReplayConnectionService();
    svc.boardStates.set([stubPreComputed('s')]);
    svc.clearBoardStates();
    expect(svc.boardStates()).toEqual([]);
    expect(svc.computedUpTo()).toBe(-1);
  });

  it('resetForkState clears all 3 fork signals', () => {
    const svc = new ReplayConnectionService();
    svc.forkStatus.set('warning');
    svc.forkTokens.set({ token1: 'a', token2: 'b' });
    svc.forkWarning.set('x');
    svc.resetForkState();
    expect(svc.forkStatus()).toBe('idle');
    expect(svc.forkTokens()).toBeNull();
    expect(svc.forkWarning()).toBeNull();
  });

  it('disconnect closes WS, nullifies handlers, resets fork state (M20)', () => {
    const ws = makeMockWs(true);
    const svc = new ReplayConnectionService();
    // Inject directly to avoid the connect()→disconnect() pre-clear and
    // any race with global WebSocket constants.
    (svc as unknown as { ws: MockWs }).ws = ws;
    // Wire a non-null onmessage so we can assert it was nullified.
    ws.onmessage = () => undefined;
    ws.onclose = () => undefined;
    svc.forkTokens.set({ token1: 'leftover', token2: 'leftover2' });
    svc.disconnect();
    expect(ws.close).toHaveBeenCalled();
    expect(ws.onmessage).toBeNull();
    expect(ws.onclose).toBeNull();
    expect(svc.connectionStatus()).toBe('disconnected');
    expect(svc.forkTokens()).toBeNull();
  });

  it('disconnect is safe when WS is null (no double-close)', () => {
    const svc = new ReplayConnectionService();
    expect(() => svc.disconnect()).not.toThrow();
    expect(svc.connectionStatus()).toBe('disconnected');
  });
});
