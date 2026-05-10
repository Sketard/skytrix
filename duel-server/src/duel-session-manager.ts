import type { ActiveDuelSession } from './types.js';
import type { Player } from './ws-protocol.js';

/**
 * Owns the three session-state Maps that used to live as top-level
 * `const`s in `server.ts` (`activeDuels`, `pendingTokens`, `reconnectTokens`)
 * and the small handful of multi-Map operations that were error-prone to
 * inline (`terminate()`, `consumePendingToken()`, `consumeReconnectToken()`,
 * `rotateReconnectToken()`, `remapReconnectTokensAfterSwap()`).
 *
 * The class is deliberately thin: it does not know about the WebSocket,
 * the worker, the clock, or the WS protocol. Callers (server.ts) keep
 * full control over WS lifecycle, worker termination, and timer cleanup —
 * the manager is invoked **last** in `cleanupDuelSession()` so the prior
 * teardown work has already happened.
 *
 * Construction of `ActiveDuelSession` itself stays in server.ts: PvP and
 * fork-solo sessions diverge on ~12 fields and the construction logic is
 * tied to request shape (`POST /api/duels` body, replay payload), not to
 * Map bookkeeping. The class just receives the constructed session and
 * registers it under its IDs.
 *
 * Token consumption methods (`consumePendingToken`,
 * `consumeReconnectToken`) atomically delete the matching Map entry
 * before returning so a duplicate consumption returns null. This
 * preserves the invariant the previous inline code relied on:
 * `pendingTokens.delete(token!)` happens **before** the session is
 * wired to its WebSocket, so a retry within the same handshake-rejection
 * window cannot double-claim the slot.
 */
export class DuelSessionManager {
  private readonly activeDuels = new Map<string, ActiveDuelSession>();
  private readonly pendingTokens = new Map<string, { duelId: string; playerIndex: Player }>();
  private readonly reconnectTokens = new Map<string, { duelId: string; playerIndex: Player }>();

  /**
   * Install a freshly constructed session and its 2 pending wsTokens.
   * Used by both PvP `POST /api/duels` and the fork-solo bridge.
   */
  register(session: ActiveDuelSession, wsTokens: [string, string]): void {
    this.activeDuels.set(session.duelId, session);
    this.pendingTokens.set(wsTokens[0], { duelId: session.duelId, playerIndex: 0 });
    this.pendingTokens.set(wsTokens[1], { duelId: session.duelId, playerIndex: 1 });
  }

  /**
   * Atomically read + delete a pending wsToken. Three outcomes (mirror
   * of `consumeReconnectToken` so callers can render distinct log lines):
   *  - `'unknown'`: token was never issued or already consumed
   *  - `'session-gone'`: token was valid but the duel has been cleaned
   *    up between issuance and the handshake (the orphan token is
   *    dropped from the map)
   *  - `'ok'`: caller receives the resolved session + playerIndex
   */
  consumePendingToken(token: string):
    | { kind: 'ok'; session: ActiveDuelSession; playerIndex: Player }
    | { kind: 'session-gone' }
    | { kind: 'unknown' } {
    const info = this.pendingTokens.get(token);
    if (!info) return { kind: 'unknown' };
    const session = this.activeDuels.get(info.duelId);
    if (!session) {
      this.pendingTokens.delete(token);
      return { kind: 'session-gone' };
    }
    this.pendingTokens.delete(token);
    return { kind: 'ok', session, playerIndex: info.playerIndex };
  }

  /**
   * Atomically read + delete a reconnect token. Three outcomes:
   *  - `'unknown'`: token was never issued or already consumed
   *  - `'session-gone'`: token was valid but the duel has been cleaned up
   *    (token also dropped from the map to prevent orphans)
   *  - `'ok'`: caller receives the resolved session + playerIndex
   *
   * The tagged shape lets the WS handler render the exact close-code +
   * log line the previous inline code did (one variant for "invalid
   * token" vs "duel not found").
   */
  consumeReconnectToken(token: string):
    | { kind: 'ok'; session: ActiveDuelSession; playerIndex: Player }
    | { kind: 'session-gone' }
    | { kind: 'unknown' } {
    const info = this.reconnectTokens.get(token);
    if (!info) return { kind: 'unknown' };
    const session = this.activeDuels.get(info.duelId);
    if (!session) {
      this.reconnectTokens.delete(token);
      return { kind: 'session-gone' };
    }
    this.reconnectTokens.delete(token);
    return { kind: 'ok', session, playerIndex: info.playerIndex };
  }

  /**
   * Allocate a new reconnect token for `(session, playerIndex)`,
   * dropping the player's previous one if present. Returns the new
   * token; the caller is responsible for storing it on the player and
   * sending the SESSION_TOKEN message to the client.
   */
  rotateReconnectToken(session: ActiveDuelSession, playerIndex: Player, newToken: string): string {
    const oldToken = session.players[playerIndex].reconnectToken;
    if (oldToken) this.reconnectTokens.delete(oldToken);
    this.reconnectTokens.set(newToken, { duelId: session.duelId, playerIndex });
    return newToken;
  }

  /**
   * After `startDuelWithOrder()` swaps `session.players[]` (RPS winner
   * chose to go second), re-anchor any existing reconnect tokens to
   * their new OCG indices. Iterating `[0, 1]` and re-`set`ting overwrites
   * the prior mapping — no delete-then-set window where the token
   * temporarily doesn't resolve.
   */
  remapReconnectTokensAfterSwap(session: ActiveDuelSession): void {
    for (const p of [0, 1] as const) {
      const tok = session.players[p].reconnectToken;
      if (tok) this.reconnectTokens.set(tok, { duelId: session.duelId, playerIndex: p });
    }
  }

  /**
   * Idempotent teardown of all Map entries for a session:
   *  - drops every reconnect token attached to either player
   *  - prunes every pending token whose `duelId` matches
   *  - removes the entry from `activeDuels`
   *
   * Called as the **last** step of `cleanupDuelSession()` in server.ts —
   * the WebSocket close, timer clears, and worker termination happen
   * BEFORE this. The manager intentionally does not touch any of those.
   */
  terminate(session: ActiveDuelSession): void {
    for (const player of session.players) {
      if (player.reconnectToken) {
        this.reconnectTokens.delete(player.reconnectToken);
        player.reconnectToken = null;
      }
    }
    for (const [token, info] of this.pendingTokens) {
      if (info.duelId === session.duelId) {
        this.pendingTokens.delete(token);
      }
    }
    this.activeDuels.delete(session.duelId);
  }

  // ---- Reads ----

  size(): number {
    return this.activeDuels.size;
  }

  has(duelId: string): boolean {
    return this.activeDuels.has(duelId);
  }

  get(duelId: string): ActiveDuelSession | undefined {
    return this.activeDuels.get(duelId);
  }

  /** Snapshot of all active duel IDs (for `GET /api/duels/active`). */
  listIds(): string[] {
    return [...this.activeDuels.keys()];
  }

  /**
   * Snapshot of all active sessions (for shutdown iteration). Returns
   * a fresh array so the caller can mutate/iterate safely while we
   * also delete entries.
   */
  listAll(): ActiveDuelSession[] {
    return [...this.activeDuels.values()];
  }
}
