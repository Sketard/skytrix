// =============================================================================
// deriveOutcome — maps the WS `ReplayMetadataMsg.result` enum string to a closed
// 3-state outcome (victory/defeat/draw) from the local perspective.
//
// Server-side `result` is the Jackson-serialized `DuelResult` enum, recorded
// from player 1's perspective: 'VICTORY' | 'DEFEAT' | 'DRAW' | 'TIMEOUT' |
// 'DISCONNECT' | 'SURRENDER' | 'OPPONENT_TIMEOUT' | 'OPPONENT_DISCONNECT' |
// 'OPPONENT_SURRENDER'. When `mySide === 1`, we flip self↔opp before mapping.
// Unknown strings fall back to 'draw' (D19).
// =============================================================================

export type ReplayOutcome = 'victory' | 'defeat' | 'draw';

const SELF_WIN = new Set([
  'VICTORY',
  'OPPONENT_TIMEOUT',
  'OPPONENT_DISCONNECT',
  'OPPONENT_SURRENDER',
]);
const SELF_LOSS = new Set([
  'DEFEAT',
  'TIMEOUT',
  'DISCONNECT',
  'SURRENDER',
]);

export function deriveOutcome(result: string | null | undefined, mySide: 0 | 1): ReplayOutcome {
  if (!result) return 'draw';
  const normalized = result.toUpperCase();
  const fromMySide = mySide === 0 ? normalized : flipPerspective(normalized);
  if (SELF_WIN.has(fromMySide)) return 'victory';
  if (SELF_LOSS.has(fromMySide)) return 'defeat';
  return 'draw';
}

function flipPerspective(result: string): string {
  switch (result) {
    case 'VICTORY':             return 'DEFEAT';
    case 'DEFEAT':              return 'VICTORY';
    case 'TIMEOUT':             return 'OPPONENT_TIMEOUT';
    case 'DISCONNECT':          return 'OPPONENT_DISCONNECT';
    case 'SURRENDER':           return 'OPPONENT_SURRENDER';
    case 'OPPONENT_TIMEOUT':    return 'TIMEOUT';
    case 'OPPONENT_DISCONNECT': return 'DISCONNECT';
    case 'OPPONENT_SURRENDER':  return 'SURRENDER';
    default:                    return result;
  }
}
