import type { WebSocket } from 'ws';

/**
 * WebSocket augmented with a per-instance liveness flag set by the
 * heartbeat loop in server.ts. The handlers that create a new WS
 * (`pvp-connection-handler`, `replay-handlers`) flip `isAlive = true`
 * on connect + on every `pong` ; the heartbeat sweep flips it to
 * `false` between pings and terminates any WS still `false` on the
 * next tick.
 *
 * Hoisted to a shared module so the 3 sites (server.ts heartbeat,
 * pvp-connection-handler, replay-handlers) share ONE structural
 * definition — adding a field here propagates to all callers (3-layer
 * review chunk D, F1 cleanup 2026-06-02).
 */
export interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}
