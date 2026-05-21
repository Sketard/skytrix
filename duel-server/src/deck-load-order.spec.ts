// =============================================================================
// resolveDeckLoadOrder — deck top→bottom ordering contract
// =============================================================================
//
// Guards the "no shuffle" duel option: with shuffle off, the first 5
// decklist entries must be the deterministic opening hand. The replay /
// fork paths re-load the captured deck with shuffle=false, so the function
// must be idempotent on its own output.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { resolveDeckLoadOrder, normalizeReplayDeck } from './deck-load-order.js';
import type { Deck } from './types.js';

const deck: Deck = {
  main: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
  extra: [201, 202, 203],
};

describe('resolveDeckLoadOrder', () => {
  it('shuffle off → returns the decklist verbatim (deck.main[0] = top card)', () => {
    const ordered = resolveDeckLoadOrder(deck, false);
    expect(ordered.main).toEqual(deck.main);
    expect(ordered.extra).toEqual(deck.extra);
    // Opening hand = first 5 decklist entries.
    expect(ordered.main.slice(0, 5)).toEqual([101, 102, 103, 104, 105]);
  });

  it('shuffle off → returns fresh arrays (no aliasing of the input)', () => {
    const ordered = resolveDeckLoadOrder(deck, false);
    expect(ordered.main).not.toBe(deck.main);
    expect(ordered.extra).not.toBe(deck.extra);
  });

  it('is idempotent with shuffle off — replay/fork reloads the same pile', () => {
    const live = resolveDeckLoadOrder(deck, false);
    const replay = resolveDeckLoadOrder(live, false);
    expect(replay.main).toEqual(live.main);
    expect(replay.extra).toEqual(live.extra);
  });

  it('a shuffled live deck reloads verbatim on the replay path', () => {
    const live = resolveDeckLoadOrder(deck, true);
    // Replay always passes shuffle=false on the captured deck.
    const replay = resolveDeckLoadOrder(live, false);
    expect(replay.main).toEqual(live.main);
  });

  it('shuffle on → permutes main but preserves the multiset', () => {
    const ordered = resolveDeckLoadOrder(deck, true);
    expect([...ordered.main].sort((a, b) => a - b))
      .toEqual([...deck.main].sort((a, b) => a - b));
    expect(ordered.main).toHaveLength(deck.main.length);
  });

  it('shuffle never touches the extra deck order', () => {
    expect(resolveDeckLoadOrder(deck, true).extra).toEqual(deck.extra);
    expect(resolveDeckLoadOrder(deck, false).extra).toEqual(deck.extra);
  });
});

describe('normalizeReplayDeck — legacy replay compatibility', () => {
  it("'verbatim' convention → deck returned unchanged", () => {
    const out = normalizeReplayDeck(deck, 'verbatim');
    expect(out.main).toEqual(deck.main);
    expect(out.extra).toEqual(deck.extra);
  });

  it('absent convention (legacy) → main is reversed, extra untouched', () => {
    const out = normalizeReplayDeck(deck, undefined);
    expect(out.main).toEqual([...deck.main].reverse());
    expect(out.extra).toEqual(deck.extra);
  });

  it('legacy round-trip: reversing a stored legacy deck yields the live pile', () => {
    // A legacy capturedDeck is the live pile reversed (old loadDeckToOcg
    // iterated front-to-back with sequence:0). normalizeReplayDeck reverses
    // it back → the true top→bottom pile.
    const livePile = [1, 2, 3, 4, 5];
    const legacyStored = [...livePile].reverse(); // what the old code persisted
    const normalized = normalizeReplayDeck({ main: legacyStored, extra: [] }, undefined);
    expect(normalized.main).toEqual(livePile);
  });

  it('new replay (verbatim): feeding it through is a no-op', () => {
    const verbatimStored = [1, 2, 3, 4, 5];
    const normalized = normalizeReplayDeck({ main: verbatimStored, extra: [] }, 'verbatim');
    expect(normalized.main).toEqual(verbatimStored);
  });
});
