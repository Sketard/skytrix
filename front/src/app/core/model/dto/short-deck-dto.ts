export type ShortDeckDTO = {
  id: number;
  name: string;
  urls: Array<string>;
  // Phase 2.10 — surfaced in the deck picker grid so the user can see at a
  // glance whether a deck is ready to play. Computed server-side via
  // DeckMapper.toShortDeckDTO.
  mainDeckCount: number;
  valid: boolean;
  // ISO-8601 timestamp of the most recent save (V016 migration, 2026-05-18).
  // Drives the deck-list "Recent" sort mode.
  updatedAt: string;
};
