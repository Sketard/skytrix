// 9-value enum (vs 6 in architecture spec): OPPONENT_* variants preserve
// contextual "why" in match history UI. See DuelResult.java for flip() logic.
export enum DuelResult {
  VICTORY = 'VICTORY',
  DEFEAT = 'DEFEAT',
  DRAW = 'DRAW',
  TIMEOUT = 'TIMEOUT',
  DISCONNECT = 'DISCONNECT',
  SURRENDER = 'SURRENDER',
  OPPONENT_TIMEOUT = 'OPPONENT_TIMEOUT',
  OPPONENT_DISCONNECT = 'OPPONENT_DISCONNECT',
  OPPONENT_SURRENDER = 'OPPONENT_SURRENDER',
}
