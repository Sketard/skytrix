import { randomBytes } from 'node:crypto';
import type { Deck, DeckOrderConvention } from './types.js';

/** Fisher-Yates shuffle with crypto randomness. Returns a new array. */
export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  const buf = randomBytes(Math.max(1, result.length) * 4);
  for (let i = result.length - 1; i > 0; i--) {
    const j = buf.readUInt32LE(i * 4) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Resolves the deck top→bottom order that will be present in OCGCore.
 *  - `shuffle` on  → a random permutation of the decklist.
 *  - `shuffle` off → the decklist verbatim, so `deck.main[0]` is the top
 *    card and the first 5 decklist entries are the deterministic opening
 *    hand (the "no shuffle" duel option).
 *
 * Pure so the ordering contract is unit-testable without booting the WASM
 * core. The replay / fork paths re-load the captured deck with shuffle off,
 * so this must be idempotent on its own output — it is, because shuffle off
 * is a verbatim copy.
 */
export function resolveDeckLoadOrder(deck: Deck, shuffle: boolean): Deck {
  return {
    main: shuffle ? shuffleArray(deck.main) : [...deck.main],
    extra: [...deck.extra],
  };
}

/**
 * Normalises a captured replay/fork deck to the current `'verbatim'`
 * convention (main[0] = deck top), so it can be fed straight to the
 * shuffle-off load path.
 *
 *  - `'verbatim'` (new replays) → returned as-is.
 *  - absent (legacy replays)    → main is reversed. Pre-fix, loadDeckToOcg
 *    iterated front-to-back with `sequence: 0`, which reversed the pile vs.
 *    the stored array. The captured deck therefore holds the live pile
 *    reversed; reversing it back yields the true top→bottom order.
 *
 * The extra deck is never reversed — it was always loaded in array order
 * and the EXTRA pile order is irrelevant to draws.
 */
export function normalizeReplayDeck(deck: Deck, convention: DeckOrderConvention | undefined): Deck {
  if (convention === 'verbatim') return deck;
  return { main: [...deck.main].reverse(), extra: deck.extra };
}
