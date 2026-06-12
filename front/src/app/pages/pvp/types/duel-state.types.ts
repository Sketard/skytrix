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
  // Resolved effect text, carried from MSG_CHAINING.descriptionText.
  // Optional: absent on legacy payloads that predate server-side resolution.
  descriptionText?: string;
  // F9-bis hand-discard fix (2026-06-04) — count of `cardCode` copies in
  // `player`'s HAND at the moment of activation, carried verbatim from
  // MSG_CHAINING.handCopiesAtChaining. Only set when the activation came
  // from HAND. The hand chain-badge resolver (`findCurrentIndex` in
  // chain-badge.utils.ts) compares this to the current HAND count: if the
  // current count is strictly lower, at least one copy of `cardCode`
  // (typically the activated card itself, discarded for cost) has left
  // the hand, so the badge is NOT placed on any remaining copy.
  handCopiesAtChaining?: number;
  // Dense-chain fix (2026-06-12) — receipt-side chain generation (count of
  // MSG_CHAIN_END received when the link was built). `applyChainEnd` for
  // chain N only clears links of generation ≤ N, so a link of chain N+1
  // committed by sync receipt before chain N's END dispatches from the
  // animation queue survives the clear. Absent (legacy/restored links)
  // reads as generation 0.
  generation?: number;
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
