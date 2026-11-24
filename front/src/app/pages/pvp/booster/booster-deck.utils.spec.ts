import { CardType } from '../../../core/enums/card-type.enum';
import { CardDetailDTO } from '../../../core/model/dto/card-detail-dto';
import { CardDTO } from '../../../core/model/dto/card-dto';
import { PulledCardDTO } from './booster.types';
import { addCopy, buildPool, deckFromPulls, deckProblem, fillDeck, removeCopy } from './booster-deck.utils';

let nextPullId = 1;

export function makePull(cardId: number, opts: { extra?: boolean; types?: CardType[]; level?: number; name?: string } = {}): PulledCardDTO {
  const card = {
    id: cardId,
    passcode: 1000 + cardId,
    name: opts.name ?? `Card ${cardId}`,
    types: opts.types ?? [CardType.MONSTER],
    level: opts.level,
    extraCard: opts.extra ?? false,
  } as unknown as CardDTO;
  return {
    id: nextPullId++,
    boosterIndex: 0,
    slotIndex: 0,
    card: new CardDetailDTO(card),
    deckZone: null,
    deckIndex: null,
  };
}

const LIMITS = { minMain: 2, maxMain: 3, maxExtra: 1 };

describe('booster-deck.utils', () => {
  it('buildPool groups the copies of a card and counts those in the deck', () => {
    const a1 = makePull(1);
    const a2 = makePull(1);
    const b = makePull(2);
    const pool = buildPool([a1, b, a2], new Set([a2.id]));

    const a = pool.find(e => e.cardId === 1)!;
    expect(a.copyIds).toEqual([a1.id, a2.id]);
    expect(a.inDeck).toBe(1);
    expect(pool.find(e => e.cardId === 2)!.inDeck).toBe(0);
  });

  it('buildPool sorts monsters (high level first), spells, traps, then the Extra Deck', () => {
    const pool = buildPool([
      makePull(1, { types: [CardType.TRAP] }),
      makePull(2, { extra: true, types: [CardType.MONSTER, CardType.FUSION] }),
      makePull(3, { types: [CardType.SPELL] }),
      makePull(4, { level: 4 }),
      makePull(5, { level: 8 }),
    ], new Set());
    expect(pool.map(e => e.cardId)).toEqual([5, 4, 3, 1, 2]);
    expect(pool[4].zone).toBe('EXTRA');
  });

  it('addCopy adds a free copy to the card zone and stops when none is free', () => {
    const p1 = makePull(1);
    const p2 = makePull(1);
    const [entry] = buildPool([p1, p2], new Set());
    let deck = addCopy({ main: [], extra: [] }, entry, LIMITS);
    deck = addCopy(deck, entry, LIMITS);
    expect(deck.main).toEqual([p1.id, p2.id]);
    expect(addCopy(deck, entry, LIMITS)).toBe(deck);
  });

  it('addCopy respects the Extra Deck maximum', () => {
    const pulls = [makePull(9, { extra: true }), makePull(9, { extra: true })];
    const [entry] = buildPool(pulls, new Set());
    const deck = addCopy({ main: [], extra: [] }, entry, LIMITS);
    expect(addCopy(deck, entry, LIMITS).extra.length).toBe(1);
  });

  it('removeCopy removes the last added copy only', () => {
    const p1 = makePull(1);
    const p2 = makePull(1);
    const other = makePull(2);
    const [entry] = buildPool([p1, p2], new Set());
    const deck = removeCopy({ main: [p1.id, other.id, p2.id], extra: [] }, entry);
    expect(deck.main).toEqual([p1.id, other.id]);
  });

  it('fillDeck takes every copy up to the maxima', () => {
    const pulls = [makePull(1), makePull(2), makePull(3), makePull(4), makePull(5, { extra: true }), makePull(6, { extra: true })];
    const deck = fillDeck(buildPool(pulls, new Set()), LIMITS);
    expect(deck.main.length).toBe(3);
    expect(deck.extra.length).toBe(1);
  });

  it('deckFromPulls restores the submitted deck in deck order', () => {
    const a = { ...makePull(1), deckZone: 'MAIN' as const, deckIndex: 1 };
    const b = { ...makePull(2), deckZone: 'MAIN' as const, deckIndex: 0 };
    const c = { ...makePull(3, { extra: true }), deckZone: 'EXTRA' as const, deckIndex: 0 };
    const d = makePull(4);
    expect(deckFromPulls([a, b, c, d])).toEqual({ main: [b.id, a.id], extra: [c.id] });
  });

  it('deckProblem reports the first broken limit', () => {
    expect(deckProblem({ main: [1], extra: [] }, LIMITS)).toBe('mainTooSmall');
    expect(deckProblem({ main: [1, 2, 3, 4], extra: [] }, LIMITS)).toBe('mainTooLarge');
    expect(deckProblem({ main: [1, 2], extra: [5, 6] }, LIMITS)).toBe('extraTooLarge');
    expect(deckProblem({ main: [1, 2], extra: [5] }, LIMITS)).toBeNull();
  });
});
