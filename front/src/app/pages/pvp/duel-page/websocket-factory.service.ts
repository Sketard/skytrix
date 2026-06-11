import { Injectable } from '@angular/core';

/**
 * γ Option C PR2 c7a (2026-05-29) — A15 / A25.
 *
 * Indirection over the global `WebSocket` constructor so unit tests can feed
 * server frames through an `EventTarget`-based mock instead of opening a real
 * socket. Production callers receive the default `new WebSocket(url)` behaviour
 * unchanged ; only `DuelConnection.openConnection()` reads from this factory
 * (via the `options.wsFactory` ctor field).
 *
 * **Not consumed by replay**. Two distinct surfaces : `MockDuelConnection`
 * (the animation-pipeline data source for replays, cf. CLAUDE.md "Animation
 * Parity Rule") does NOT instantiate `DuelConnection` ; and the replay
 * WebSocket itself lives in a separate service `replay-connection.service.ts`
 * which has its own `new WebSocket(url)` path. Neither reaches this factory,
 * so γ-c leaves both untouched.
 *
 * **Not an Angular service consumed inside `DuelConnection`**. `DuelConnection`
 * is a plain class (constructed via `new`), not injectable. The factory is
 * passed through `options.wsFactory` from the 2 production callers
 * (`DuelWebSocketService`, `SoloDuelOrchestratorService`) which inject this
 * service themselves and forward it.
 */
@Injectable({ providedIn: 'root' })
export class WebSocketFactoryService {
  create(url: string): WebSocket {
    return new WebSocket(url);
  }
}

/** Structural type used by `DuelConnection.options.wsFactory`. Lets tests
 *  pass any `{ create(url): WebSocket-like }` without depending on the
 *  Angular service class. */
export interface WebSocketFactory {
  create(url: string): WebSocket;
}
