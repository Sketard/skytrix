// =============================================================================
// client-message-validator.ts — γ Option C — `forPlayer` field validation
// =============================================================================
//
// SOLO multiplex (Option C) extends 7 ClientMessage types with an optional
// `forPlayer?: 0 | 1` tag, used by the SOLO multiplexer to identify which
// perspective slot emitted the message. In SOLO the user IS both players,
// so trusting `forPlayer` is safe — the worst case is the user fooling
// themselves. In PvP normal, accepting `forPlayer` would let a player
// impersonate their opponent's slot (R2 — security finding in
// `phase-gamma-option-c-findings-deep-dive.md`).
//
// This module owns the §3.3 A2 validation: in PvP normal, any payload that
// carries `forPlayer` is rejected with a `logger.warn` (impersonation
// attempt counter). In SOLO, `forPlayer ?? currentPlayerIndex` becomes the
// `live` index passed downstream to `handleClientMessage`.
//
// The §3.3 A2 spec lives here as a pure function so it can be unit-tested
// independently of the WS server bootstrap. The single caller is
// `server.ts ws.on('message')`.

import * as logger from './logger.js';

/** Reason an inbound payload was rejected. Exported as a named type so future
 *  reject branches stay exhaustively checkable at the call site. */
export type RejectReason =
  | 'non-object-payload'        // JSON.parse returned null / primitive / array
  | 'forPlayer-in-pvp-normal'   // A2 strict: PvP MUST NOT carry `forPlayer`
  | 'forPlayer-invalid';        // `forPlayer` present but not 0 | 1

/** Result of validating + resolving the `live` player index for an inbound
 *  client message. `kind: 'reject'` means the message MUST be dropped before
 *  dispatch. */
export type ValidatedClientMessage =
  | { kind: 'ok'; live: 0 | 1 }
  | { kind: 'reject'; reason: RejectReason };

/** Resolve the inbound message's `live` player index per the §3.3 A2 contract.
 *
 *  - PvP normal + `forPlayer` defined → reject (possible impersonation).
 *  - PvP normal + `forPlayer` undefined → `live = currentPlayerIndex`.
 *  - SOLO + `forPlayer` defined (and valid `0 | 1`) → `live = forPlayer`.
 *  - SOLO + `forPlayer` undefined → `live = currentPlayerIndex` (legacy clients).
 *
 *  Three runtime guards harden the contract beyond the TS type cast — the wire
 *  is JSON, so `forPlayer` may arrive as `null`, `false`, `2`, `'1'`, etc. and
 *  the bare `(parsed as { forPlayer?: 0 | 1 }).forPlayer` cast does nothing:
 *
 *  1. `parsed` must be a non-null object — `JSON.parse("null")` and the
 *     primitive cases succeed but reading `.forPlayer` off them throws.
 *  2. If `forPlayer` is present, it must be strictly `0` or `1` — coercion
 *     paths like `players[false]` ≡ `players[0]` would silently bypass A2.
 *  3. The `?? currentPlayerIndex` fallback only catches `undefined` (not
 *     `null` / `false` / `''`) — after guard #2 only `undefined` reaches it.
 *
 *  `duelId` is forwarded into the warn log so the impersonation counter is
 *  filterable per duel. */
export function validateClientMessageForPlayer(
  parsed: unknown,
  soloMode: boolean,
  currentPlayerIndex: 0 | 1,
  duelId: string,
): ValidatedClientMessage {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn('Non-object payload rejected', {
      duelId,
      from: currentPlayerIndex,
      payloadType: parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed,
    });
    return { kind: 'reject', reason: 'non-object-payload' };
  }

  const incomingForPlayer = (parsed as { forPlayer?: unknown }).forPlayer;

  if (incomingForPlayer !== undefined && incomingForPlayer !== 0 && incomingForPlayer !== 1) {
    logger.warn('forPlayer field rejected (invalid value — not 0 | 1)', {
      duelId,
      from: currentPlayerIndex,
      claimed: incomingForPlayer,
      type: (parsed as { type?: unknown }).type,
    });
    return { kind: 'reject', reason: 'forPlayer-invalid' };
  }

  if (!soloMode && incomingForPlayer !== undefined) {
    logger.warn('forPlayer field rejected (PvP normal — possible impersonation attempt)', {
      duelId,
      from: currentPlayerIndex,
      claimed: incomingForPlayer,
      type: (parsed as { type?: unknown }).type,
    });
    return { kind: 'reject', reason: 'forPlayer-in-pvp-normal' };
  }

  const live = soloMode ? (incomingForPlayer ?? currentPlayerIndex) : currentPlayerIndex;
  return { kind: 'ok', live };
}
