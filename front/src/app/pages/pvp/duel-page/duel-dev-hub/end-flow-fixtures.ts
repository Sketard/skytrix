// DEV ONLY — to be removed before final ship.
// End-flow dev hub fixtures. Cf duel-end-flow-spec §8.4.

import { DevResultOutcome, DevRematchState } from './duel-dev-state.service';

function makeResult(
  outcome: DevResultOutcome['outcome'],
  cause: string,
  reason: string,
): DevResultOutcome {
  return { outcome, cause, reason };
}

export const RESULT_FIXTURES: ReadonlyArray<{ key: string; label: string; value: DevResultOutcome }> = [
  { key: 'victory',           label: 'Victory normal',     value: makeResult('victory', 'lp_zero',    'DragonSlayer92 — LP reduced to 0') },
  { key: 'defeat',            label: 'Defeat normal',      value: makeResult('defeat',  'lp_zero',    'You — LP reduced to 0') },
  { key: 'draw',              label: 'Draw normal',        value: makeResult('draw',    'lp_zero',    'Both LP reduced simultaneously') },
  { key: 'victory-disconnect', label: 'Victory disconnect', value: makeResult('victory', 'disconnect', 'Opponent disconnected') },
  { key: 'defeat-timeout',    label: 'Defeat timeout',     value: makeResult('defeat',  'timeout',    'Turn timer expired') },
  { key: 'draw-inactivity',   label: 'Draw inactivity',    value: makeResult('draw',    'inactivity', 'Both players inactive') },
];

export const REMATCH_STATES: ReadonlyArray<DevRematchState> = [
  'idle', 'requested', 'invited', 'opponent-left', 'expired',
];
