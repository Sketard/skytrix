// =============================================================================
// deriveOutcome — maps the free-form `ReplayMetadataMsg.result` string to a
// closed 3-state outcome (victory/defeat/draw) from the local perspective.
//
// Decision D19 (spec replay-viewer-rework-2026-05-14.md): the WS protocol
// keeps `result: string | null` for forward-compatibility with future result
// kinds. The viewer maps it client-side and falls back to 'draw' on unknown
// strings rather than crashing.
//
// `result` strings observed today (see `replay.matchHistory.*` i18n keys):
//   'victory', 'defeat', 'draw',
//   'timeout', 'disconnect', 'surrender',                         (you lost)
//   'opponentTimeout', 'opponentDisconnect', 'opponentSurrender'. (you won)
//
// Server-side `result` is recorded from player 1's perspective. When `mySide`
// is 1, we flip self↔opp before mapping.
// =============================================================================

export type ReplayOutcome = 'victory' | 'defeat' | 'draw';

const SELF_WIN  = new Set(['victory', 'opponentTimeout', 'opponentDisconnect', 'opponentSurrender']);
const SELF_LOSS = new Set(['defeat',  'timeout',         'disconnect',         'surrender']);

export function deriveOutcome(result: string | null | undefined, mySide: 0 | 1): ReplayOutcome {
  if (!result) return 'draw';
  // Server records `result` from P1's perspective — flip when viewing as P2.
  const fromMySide = mySide === 0 ? result : flipPerspective(result);
  if (SELF_WIN.has(fromMySide))  return 'victory';
  if (SELF_LOSS.has(fromMySide)) return 'defeat';
  return 'draw';
}

function flipPerspective(result: string): string {
  switch (result) {
    case 'victory':            return 'defeat';
    case 'defeat':             return 'victory';
    case 'timeout':            return 'opponentTimeout';
    case 'disconnect':         return 'opponentDisconnect';
    case 'surrender':          return 'opponentSurrender';
    case 'opponentTimeout':    return 'timeout';
    case 'opponentDisconnect': return 'disconnect';
    case 'opponentSurrender':  return 'surrender';
    default:                   return result; // 'draw' and unknown stay as-is.
  }
}
