export type ShortDeckDTO = {
  id: number;
  name: string;
  urls: Array<string>;
  // Phase 2.10 — surfaced in the deck picker grid so the user can see at a
  // glance whether a deck is ready to play. Computed server-side via
  // DeckMapper.toShortDeckDTO.
  mainDeckCount: number;
  valid: boolean;
};
