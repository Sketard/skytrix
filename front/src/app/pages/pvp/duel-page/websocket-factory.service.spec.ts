// =============================================================================
// websocket-factory.service.spec.ts — γ Option C PR2 c7a (2026-05-29)
// -----------------------------------------------------------------------------
// Pins the A15 / A25 contract :
//   · `WebSocketFactoryService.create(url)` defaults to `new WebSocket(url)`.
//   · `DuelConnection` consumes the factory ONLY in `openConnection()` ; the
//     4 existing tests that inject a mock WS via `(conn as any).ws = mockWs`
//     keep working because `openConnection()` is bypassed there.
//   · A `DuelConnection` built with `options.wsFactory` and then driven via
//     `connect(token)` calls `factory.create(url)` and stores the returned
//     object as `this.ws` — no real `new WebSocket(url)` is fired.
//
// T-F6 (c7b — chain SOLO multiplex) builds on top of this : it overrides
// `WebSocketFactoryService` via TestBed to return a `MockWebSocket`.
// =============================================================================

import { TestBed } from '@angular/core/testing';
import { WebSocketFactoryService } from './websocket-factory.service';
import { DuelConnection } from './duel-connection';

describe('WebSocketFactoryService', () => {
  it('default `create(url)` returns a WebSocket instance bound to the URL', () => {
    const svc = TestBed.inject(WebSocketFactoryService);
    // Production behaviour : `new WebSocket(url)`. We can't fully assert
    // network state in karma (no server), but the constructor returns a
    // WebSocket object with the URL property set.
    const ws = svc.create('ws://localhost:1/ws');
    expect(ws).toBeInstanceOf(WebSocket);
    expect(ws.url).toContain('ws://localhost:1/ws');
    // Close immediately to avoid the test leaving an open connection-pending
    // socket in CONNECTING state.
    ws.close();
  });
});

describe('DuelConnection — wsFactory injection (A15)', () => {
  it('connect() routes through the injected factory (not new WebSocket)', () => {
    const fakeSocket = { close: jasmine.createSpy('close') } as unknown as WebSocket;
    const factory = {
      create: jasmine.createSpy('create').and.returnValue(fakeSocket),
    };
    const storageKey = `c7a-${Math.random().toString(36).slice(2, 10)}`;
    const conn = new DuelConnection(
      '/ws/test', false, storageKey, undefined,
      { wsFactory: factory },
    );

    conn.connect('token-xyz');

    expect(factory.create).toHaveBeenCalledTimes(1);
    const calledUrl = factory.create.calls.mostRecent().args[0] as string;
    expect(calledUrl).toContain('/ws/test');
    expect(calledUrl).toContain('token=token-xyz');
    // Pin the PROTOCOL_VERSION query param too — if a future signature
    // adds/removes a field, this catches it before c7b's MockWebSocket
    // scenario silently drifts.
    expect(calledUrl).toContain('pv=');
    expect((conn as unknown as { ws: WebSocket }).ws).toBe(fakeSocket);
  });

  it('without wsFactory, connect() falls back to global new WebSocket(url)', () => {
    // Back-compat — the 4 existing `duel-connection.spec.ts` sites bypass
    // `connect()` entirely. This test exercises a NEW DuelConnection without
    // the factory option to prove the fall-through stays a real WebSocket
    // construction (CONNECTING state visible immediately).
    const storageKey = `c7a-${Math.random().toString(36).slice(2, 10)}`;
    const conn = new DuelConnection('/ws/test', false, storageKey);

    conn.connect('token-fallback');

    const ws = (conn as unknown as { ws: WebSocket }).ws;
    expect(ws).toBeInstanceOf(WebSocket);
    expect(ws.url).toContain('token=token-fallback');
    ws.close();
  });
});
