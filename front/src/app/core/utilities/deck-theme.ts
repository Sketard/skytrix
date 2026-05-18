export const DECK_THEMES = ['gold', 'cyan', 'purple', 'rose', 'green'] as const;
export type DeckTheme = (typeof DECK_THEMES)[number];

/**
 * Deterministically picks one of 5 visual themes for a deck silhouette
 * based on its database id. No backend round-trip needed.
 *
 * Pure function: same id → same theme across page reloads. Decision
 * Axel 2026-05-17: hash front instead of persisting a `theme` column
 * (skip the migration + picker UI altogether).
 */
export function pickDeckTheme(deckId: number | undefined | null): DeckTheme {
  if (deckId == null) return 'gold';
  return DECK_THEMES[Math.abs(Math.floor(deckId * Math.PI)) % DECK_THEMES.length];
}
