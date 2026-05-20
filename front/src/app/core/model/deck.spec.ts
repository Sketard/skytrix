/**
 * Spec for the `Deck` model — focused on ban-list legality, which the deck
 * builder, deck list and PvP picker all depend on. Copy limits follow the
 * official TCG/OCG rule: counted GLOBALLY across main + side + extra.
 */

import { Deck } from './deck';
import { CardDetail, IndexedCardDetail } from './card-detail';
import { DeckZone } from '../../services/deck-build.service';

/** A CardDetail with an id and optional `banInfo` (0 forbidden, 1 limited,
 *  2 semi, 3/undefined unlimited) and `extraCard` flag. */
function card(id: number, opts: { banInfo?: number; extraCard?: boolean } = {}): CardDetail {
  const cd = new CardDetail();
  cd.card.id = id;
  cd.card.name = `Card ${id}`;
  cd.card.extraCard = opts.extraCard ?? false;
  if (opts.banInfo !== undefined) {
    cd.card.banInfo = opts.banInfo;
  }
  return cd;
}

/** Inject filled slots into a fresh deck's zones (Deck ctor pads with -1). */
function deckWith(zones: { main?: CardDetail[]; extra?: CardDetail[]; side?: CardDetail[] }): Deck {
  const d = new Deck();
  zones.main?.forEach((c, i) => (d.mainDeck[i] = new IndexedCardDetail(c, i)));
  zones.extra?.forEach((c, i) => (d.extraDeck[i] = new IndexedCardDetail(c, i)));
  zones.side?.forEach((c, i) => (d.sideDeck[i] = new IndexedCardDetail(c, i)));
  return d;
}

describe('Deck — ban-list legality', () => {
  it('reports no violations for a deck within copy limits', () => {
    const d = deckWith({
      main: [card(1, { banInfo: 3 }), card(1, { banInfo: 3 }), card(1, { banInfo: 3 }), card(2, { banInfo: 1 })],
    });
    expect(d.banlistViolations()).toEqual([]);
    expect(d.isBanlistLegal).toBe(true);
  });

  it('treats undefined banInfo as unlimited (cap of 3)', () => {
    const within = deckWith({ main: [card(1), card(1), card(1)] });
    expect(within.isBanlistLegal).toBe(true);

    const over = deckWith({ main: [card(1), card(1), card(1), card(1)] });
    expect(over.banlistViolations().length).toBe(1);
    expect(over.banlistViolations()[0].count).toBe(4);
  });

  it('flags a limited card (banInfo=1) present twice', () => {
    const d = deckWith({ main: [card(5, { banInfo: 1 }), card(5, { banInfo: 1 })] });
    const violations = d.banlistViolations();
    expect(violations.length).toBe(1);
    expect(violations[0].card.card.id).toBe(5);
    expect(violations[0].count).toBe(2);
  });

  it('flags a forbidden card (banInfo=0) present at all', () => {
    const d = deckWith({ main: [card(9, { banInfo: 0 })] });
    expect(d.isBanlistLegal).toBe(false);
    expect(d.banlistViolations()[0].count).toBe(1);
  });

  it('counts copies GLOBALLY across main + side + extra', () => {
    // A limited card with 1 copy in each zone — legal per zone, 3 globally.
    const d = deckWith({
      main: [card(7, { banInfo: 1 })],
      side: [card(7, { banInfo: 1 })],
      extra: [card(7, { banInfo: 1, extraCard: true })],
    });
    const violations = d.banlistViolations();
    expect(violations.length).toBe(1);
    expect(violations[0].count).toBe(3);
  });

  it('ignores empty (-1) slots when counting', () => {
    // Fresh deck is all -1 placeholders — must not report phantom violations.
    expect(new Deck().banlistViolations()).toEqual([]);
  });
});

describe('Deck — addCard copy cap', () => {
  it('blocks adding a 4th copy of an unlimited card', () => {
    let d = deckWith({ main: [card(1), card(1), card(1)] });
    d = d.addCard(card(1), DeckZone.MAIN);
    expect(d.mainDeck.filter(s => s.index !== -1).length).toBe(3);
  });

  it('blocks adding a 2nd copy of a limited card', () => {
    let d = deckWith({ main: [card(2, { banInfo: 1 })] });
    d = d.addCard(card(2, { banInfo: 1 }), DeckZone.MAIN);
    expect(d.mainDeck.filter(s => s.index !== -1).length).toBe(1);
  });

  it('counts existing copies cross-zone before allowing an add', () => {
    // 1 copy of a limited card already in side — adding to main must be blocked.
    let d = deckWith({ side: [card(3, { banInfo: 1 })] });
    d = d.addCard(card(3, { banInfo: 1 }), DeckZone.MAIN);
    expect(d.mainDeck.filter(s => s.index !== -1).length).toBe(0);
  });
});
