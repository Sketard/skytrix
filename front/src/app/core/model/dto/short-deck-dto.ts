export type ShortDeckDTO = {
  id: number;
  name: string;
  urls: Array<string>;
  // Phase 2.10 — surfaced in the deck picker grid so the user can see at a
  // glance whether a deck is ready to play. Computed server-side via
  // DeckMapper.toShortDeckDTO.
  mainDeckCount: number;
  // True when the deck satisfies the card-count rules (MAIN ∈ [40,60],
  // EXTRA ≤ 15, SIDE ≤ 15). False = "incomplete". Independent from banlist.
  valid: boolean;
  // True when every card respects its ban-list copy limit (counted globally
  // across main + extra + side). False (with valid:true) = "banlist illegal".
  banlistLegal: boolean;
  // ISO-8601 timestamp of the most recent save (V016 migration, 2026-05-18).
  // Drives the deck-list "Recent" sort mode.
  updatedAt: string;
};
