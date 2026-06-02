import type { ActiveDuelSession } from './types.js';
import type { ServerMessage } from './ws-protocol.js';
import { safeSend } from './http-helpers.js';
import { decideSoloRouting } from './lifecycle-helpers.js';
import { entriesForPlayer } from './session-game-log.js';

/**
 * Per-player WS write helper — the single funnel through which every
 * outbound `ServerMessage` flows. Three concerns merged here intentionally
 * (cf. U36 DROP — splitting onto 5 consumers duplicates the doctrine):
 *
 *   1. STATE_SYNC decoration — attach the per-perspective game-log
 *      snapshot. Three construction sites funnel through this helper so
 *      the attach is uniform:
 *        - `broadcastMessage` forward (reconnect resync path).
 *        - `sendStateSnapshot` on connect/sync (initial post-reconnect snapshot).
 *        - Cancel-rollback re-broadcast (`worker-message-router` WORKER_CANCEL_DONE).
 *      Path 3 is technically out of the F5 scope but reuses the same plumbing —
 *      the client's `onStateSync` clears + restores the journal on every
 *      STATE_SYNC, so a right-click-cancel correctly preserves the journal too.
 *      Guards: skip when `gameLogEntries` is already populated (no current caller
 *      sets it upstream — defence-in-depth) or when the session has no log
 *      (test fixtures with the field omitted).
 *
 *   2. SOLO routing decision — γ Option C A1 + A28. In SOLO multiplex the
 *      user plays both sides on socket 0; slot 1's writes either route to
 *      socket 0 (`route-to-0`) or no-op (`noop`) depending on the message
 *      type. The pure decision lives in `decideSoloRouting` so it stays
 *      unit-testable without booting the server. PvP normal always uses
 *      the message's `playerIndex` directly.
 *
 *   3. Wire send via `safeSend` — readyState check + per-frame JSON encode.
 *
 * U32 #1 (audit-4-modes-2026-06-01) — extracted as a pure export (no
 * `createConfigurable<T>`) since the helper has zero injectable deps: the
 * 3 collaborators (`safeSend`, `decideSoloRouting`, `entriesForPlayer`)
 * are already process-wide pure utilities. The 5 modules that previously
 * received `sendToPlayer` via cfg now import it directly from here — cfg
 * shapes are unchanged.
 */
export function sendToPlayer(session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage): void {
  if (message.type === 'STATE_SYNC' && !message.gameLogEntries && session.gameLog) {
    message = { ...message, gameLogEntries: entriesForPlayer(session.gameLog, playerIndex) };
  }

  const decision = decideSoloRouting(session.soloMode, playerIndex, message.type);
  if (decision === 'noop') return;
  const targetWs = decision === 'route-to-0' ? session.players[0].ws : session.players[playerIndex].ws;
  safeSend(targetWs, message);
}
