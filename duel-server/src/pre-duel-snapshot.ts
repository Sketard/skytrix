/**
 * Pre-duel state snapshot — builds the list of messages required to bring a
 * refreshing/reconnecting client back to the correct dice-arena stage when the
 * session is still in a pre-DUELING phase.
 *
 * Pure module: takes a session + recipient index and returns the messages to
 * send (UNFILTERED). The caller is responsible for `filterMessage` per-player
 * swap (DICE_RESULT swaps `dice0`/`dice1` so each side reads its own roll as
 * "player 1") and the actual WS dispatch.
 *
 * Phase → message list:
 *   WAITING_PLAYERS, ROLLING_DICE  → []  (pending DICE_ROLL prompt is replayed
 *                                          by `resendPendingPrompt`)
 *   DICE_RESOLVED, CHOOSE_FIRST_PLAYER
 *                                  → [DICE_RESULT]
 *   FIRST_PLAYER_RESOLVED          → [DICE_RESULT, DECK_PREFETCH,
 *                                     FIRST_PLAYER_RESULT]
 *   DUELING                        → []  (caller handles the post-DUEL_STARTING
 *                                          board snapshot path instead)
 *
 * DICE_RESULT is emitted from `firstPlayerState.rolls`; if rolls are
 * incomplete (race: phase advanced but state not yet set, or vice-versa) the
 * function returns no DICE_RESULT to avoid emitting a half-state.
 */
import type { ActiveDuelSession } from './types.js';
import { diceSum, extractCardCodesForPlayer } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';

export function buildPreDuelSnapshot(session: ActiveDuelSession, playerIndex: 0 | 1): ServerMessage[] {
  switch (session.phase) {
    case 'WAITING_PLAYERS':
    case 'ROLLING_DICE':
      return [];
    case 'DICE_RESOLVED':
    case 'CHOOSE_FIRST_PLAYER': {
      const dr = buildDiceResult(session);
      return dr ? [dr] : [];
    }
    case 'FIRST_PLAYER_RESOLVED': {
      const out: ServerMessage[] = [];
      const dr = buildDiceResult(session);
      if (dr) out.push(dr);
      if (session.chosenFirstPlayer !== null) {
        out.push({ type: 'DECK_PREFETCH', cardCodes: extractCardCodesForPlayer(session.decks, playerIndex) });
        out.push({ type: 'FIRST_PLAYER_RESULT', goFirst: session.chosenFirstPlayer === playerIndex });
      }
      return out;
    }
    case 'DUELING':
      return [];
    default:
      return assertNever(session.phase);
  }
}

/** Exhaustiveness check: if a new SessionPhase is added without a
 *  case above, TypeScript will fail at compile time on the `never`
 *  parameter type. */
function assertNever(x: never): never {
  throw new Error(`Unhandled SessionPhase in buildPreDuelSnapshot: ${String(x)}`);
}

function buildDiceResult(session: ActiveDuelSession): ServerMessage | null {
  if (!session.firstPlayerState) return null;
  const [r0, r1] = session.firstPlayerState.rolls;
  if (r0 === null || r1 === null) return null;
  const sum0 = diceSum(r0);
  const sum1 = diceSum(r1);
  // Winner is derived from sums — the "who got to pick" question. On
  // FIRST_PLAYER_RESOLVED the actual first player can differ from the roll
  // winner (the winner may pick `goFirst=false`), but DICE_RESULT only
  // reports the roll outcome.
  const winner: Player | null = sum0 === sum1 ? null : sum0 > sum1 ? 0 : 1;
  return { type: 'DICE_RESULT', dice0: [r0[0], r0[1]], dice1: [r1[0], r1[1]], sum0, sum1, winner };
}
