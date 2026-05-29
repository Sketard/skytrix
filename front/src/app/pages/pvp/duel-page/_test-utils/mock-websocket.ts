// =============================================================================
// mock-websocket.ts — γ Option C PR2 c7b (2026-05-29)
// -----------------------------------------------------------------------------
// EventTarget-based mock for `WebSocket`, consumed by `WebSocketFactoryService`
// override in unit specs. Models the 4 listener properties (`onopen`,
// `onmessage`, `onclose`, `onerror`) the way `DuelConnection.openConnection`
// assigns them, plus `readyState` + `close(code)` + `send(data)` for outbound
// capture. The test drives the socket via `fireOpen()` / `feed(payload)` /
// `close(code)` — all synchronous so the spec's frame ordering is the spec's
// to control.
//
// **Not a faithful WebSocket protocol simulator**. We don't enforce the
// CONNECTING → OPEN → CLOSING → CLOSED transitions (just OPEN / CLOSED), nor
// the binaryType / extensions / protocol fields. The DuelConnection consumer
// reads `readyState` to decide whether to send, and treats `onopen` as a
// trigger, so the minimal surface suffices.
// =============================================================================

import type { ServerMessage } from '../../duel-ws.types';

/** Live mock socket fed by a spec. Stored references survive across the test
 *  lifecycle and `factory.create()` is expected to return ONE instance per
 *  spec — the WS factory override below uses a closure. */
export class MockWebSocket extends EventTarget {
  static readonly OPEN = 1 as const;
  static readonly CLOSED = 3 as const;

  /** The URL handed to `factory.create(url)`. Kept for spec assertions. */
  readonly url: string;

  /** State machine — only `OPEN` and `CLOSED` are modelled. Default starts
   *  at `OPEN` so `DuelConnection.sendResponse` immediately succeeds. Tests
   *  that exercise the pre-open send path should set this to `CLOSED`
   *  before driving any send + assert no send fires. */
  readyState: number = MockWebSocket.OPEN;

  /** Listener properties — `DuelConnection.openConnection` assigns these
   *  directly (not via `addEventListener`). They become the dispatch hooks
   *  for `fireOpen()` / `feed()` / `close()`. */
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  /** Outbound payloads captured by `send(...)`. The spec asserts against
   *  this to verify client→server frames (e.g. PLAYER_RESPONSE in T-F6). */
  readonly sent: object[] = [];

  /** Tracks `close()` invocations from the production code (not test-driven
   *  closes). Useful when the spec wants to assert "DuelConnection never
   *  closed me on its own". */
  closedByProduction = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  send(data: string): void {
    try {
      this.sent.push(JSON.parse(data));
    } catch {
      // Defensive: DuelConnection only ever sends `JSON.stringify(...)`. A
      // raw payload here means a future caller bypassed that — surface it.
      this.sent.push({ _raw: data });
    }
  }

  /** Production-side close (e.g. `connection-timeout` rearm watching).
   *  Records the call so the spec can verify production didn't tear down
   *  the socket unexpectedly, but does NOT fire `onclose` — that path is
   *  reserved for the test's explicit `.close(code)` driver below. */
  close(_code?: number): void {
    this.closedByProduction = true;
    this.readyState = MockWebSocket.CLOSED;
  }

  // ───────────────────────────────────────────────
  //  Test-driver API — synchronous frame injection
  // ───────────────────────────────────────────────

  /** Fire `onopen` synchronously. Required to clear the `connection` timeout
   *  + populate `_connectionStatus` later via SESSION_TOKEN feed. */
  fireOpen(): void {
    if (!this.onopen) return;
    this.onopen(new Event('open'));
  }

  /** Feed one server frame. The payload is JSON-stringified into a
   *  `MessageEvent` so `DuelConnection.openConnection`'s `JSON.parse(event.data)`
   *  succeeds, mirroring the real WS data flow. */
  feed(payload: ServerMessage): void {
    if (!this.onmessage) return;
    this.onmessage(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }

  /** Fire `onclose` with the given code (default 1000 = normal close).
   *  Used by specs that exercise reconnect / protocol-mismatch / rate-limit
   *  branches (4426, 4029, 4001). */
  fireClose(code = 1000): void {
    this.readyState = MockWebSocket.CLOSED;
    if (!this.onclose) return;
    this.onclose(new CloseEvent('close', { code }));
  }
}

/** Single shared `MockWebSocket` factory : `create()` recycles one instance
 *  across all calls. The spec captures `factory.socket` to drive frames ;
 *  `factory.createCount` pins the "single connection" invariant of γ-c (a
 *  refactor reintroducing a 2nd `new DuelConnection` would bump it to 2). */
export function createMockWebSocketFactory(): {
  create(url: string): MockWebSocket;
  readonly socket: MockWebSocket | null;
  readonly createCount: number;
} {
  let socket: MockWebSocket | null = null;
  let createCount = 0;
  return {
    create(url: string): MockWebSocket {
      createCount += 1;
      if (!socket) socket = new MockWebSocket(url);
      return socket;
    },
    get socket(): MockWebSocket | null { return socket; },
    get createCount(): number { return createCount; },
  };
}
