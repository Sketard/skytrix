import type { BoardStatePayload, CardLocation, ZoneId } from '../duel-ws.types';

export type DuelState = BoardStatePayload;

export interface ChainLinkState {
  chainIndex: number;
  cardCode: number;
  cardName: string;
  player: number;
  zoneId: string | null;
  location: CardLocation;
  sequence: number;
  resolving: boolean;
  negated: boolean;
}

export const EMPTY_DUEL_STATE: DuelState = {
  turnPlayer: 0,
  turnCount: 0,
  phase: 'DRAW',
  players: [
    { lp: 8000, deckCount: 0, extraCount: 0, zones: [] },
    { lp: 8000, deckCount: 0, extraCount: 0, zones: [] },
  ],
};

// Shared inert defaults for board container inputs (replay + timeline preview)
export const EMPTY_ZONE_SET = new Set<ZoneId>();
export const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();
export const EMPTY_ARRAY: never[] = [];
