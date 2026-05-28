// =============================================================================
// lifecycle-helpers.ts — γ Option C A3 + A28 — session connection-lifecycle
// predicates + the SOLO multiplex routing decision.
//
// In SOLO multiplex `session.players[1].connected` stays `false` for the whole
// duel (one socket multiplexes both perspectives). Direct boolean comparisons
// `players[0].connected && players[1].connected` would never fire in SOLO, and
// `!players[0].connected && !players[1].connected` would fire spuriously.
//
// These helpers centralise the asymmetry: PvP normal keeps its two-socket
// invariant ; SOLO answers based on socket 0 alone. Call sites read like the
// intent ("is this session ready to start the duel?") instead of inlining the
// boolean pattern + a soloMode special-case at every site.
// =============================================================================

import type { ActiveDuelSession } from './types.js';
import { extractCardCodesForPlayer } from './types.js';
import type { ServerMessage, DuelStartingMsg } from './ws-protocol.js';

/**
 * True when the session has enough live sockets to start (or resume) the duel.
 *
 * - PvP normal : both players must be connected.
 * - SOLO       : only socket 0 must be connected (socket 1 is never expected).
 */
export function isReadyToStart(session: ActiveDuelSession): boolean {
  if (session.soloMode) return session.players[0].connected;
  return session.players[0].connected && session.players[1].connected;
}

/**
 * True when no live socket remains. Used by cleanup paths (connection timeout,
 * post-duel grace cleanup, terminal disconnect).
 *
 * - PvP normal : both players must be disconnected.
 * - SOLO       : socket 0 alone determines liveness (socket 1 stays `false`).
 */
export function isFullyDisconnected(session: ActiveDuelSession): boolean {
  if (session.soloMode) return !session.players[0].connected;
  return !session.players[0].connected && !session.players[1].connected;
}

/**
 * γ Option C A28 — message types whose front consumer routes by slot tag.
 * In SOLO multiplex these are forwarded to socket 0 (with the slot tag
 * preserved) when the original `sendToPlayer` target was player 1; anything
 * not in this set becomes a no-op (the broadcast loop already sent it to
 * socket 0 once).
 *
 * Empty in PR1 to keep the phase strictly additive: γ clients (still using
 * two sockets at deploy time) see zero routing change. PR2 commit 4
 * populates the set when the front's PerspectiveSlot machinery lands.
 */
export const PSEUDO_PAIRWISE_SOLO_ROUTED: ReadonlySet<ServerMessage['type']> = new Set([]);

/**
 * γ Option C A1bis + A20 — assemble the `DUEL_STARTING` payload for one
 * player. In PvP normal each side only sees its own deck; in SOLO multiplex
 * socket 0 receives a `bothCardCodes` tuple so the front can pre-fetch both
 * perspectives' images upfront.
 *
 * Pure function — same shape regardless of caller (initial site at
 * `startDuelWithOrder`, reconnect site at `sendStateSnapshot`).
 */
export function buildDuelStartingMessage(
  session: ActiveDuelSession,
  playerIndex: 0 | 1,
): DuelStartingMsg {
  const cardCodes = extractCardCodesForPlayer(session.decks, playerIndex);
  if (!session.soloMode) {
    return { type: 'DUEL_STARTING', playerIndex, traceId: session.duelId, cardCodes };
  }
  const bothCardCodes: [number[], number[]] = [
    extractCardCodesForPlayer(session.decks, 0),
    extractCardCodesForPlayer(session.decks, 1),
  ];
  return { type: 'DUEL_STARTING', playerIndex, traceId: session.duelId, cardCodes, bothCardCodes };
}

/**
 * Pure decision function for `sendToPlayer` in SOLO multiplex. Lets the
 * routing be unit-tested without booting the WS server.
 *
 * - `'send'`         : forward to `session.players[playerIndex].ws` normally
 *                      (PvP normal, or SOLO socket 0).
 * - `'route-to-0'`   : SOLO socket 1 + the message type is in the whitelist;
 *                      forward to socket 0 with the slot tag intact.
 * - `'noop'`         : SOLO socket 1 + the type is NOT whitelisted; drop
 *                      because the broadcast loop already sent it to socket 0.
 */
export function decideSoloRouting(
  soloMode: boolean,
  playerIndex: 0 | 1,
  messageType: ServerMessage['type'],
): 'send' | 'route-to-0' | 'noop' {
  if (!soloMode || playerIndex === 0) return 'send';
  return PSEUDO_PAIRWISE_SOLO_ROUTED.has(messageType) ? 'route-to-0' : 'noop';
}
