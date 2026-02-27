import { BoardStatePayload } from '../duel-ws.types';

export type DuelState = BoardStatePayload;

export const EMPTY_DUEL_STATE: DuelState = {
  turnPlayer: 0,
  turnCount: 0,
  phase: 'DRAW',
  players: [
    { lp: 8000, deckCount: 0, extraCount: 0, zones: [] },
    { lp: 8000, deckCount: 0, extraCount: 0, zones: [] },
  ],
};
