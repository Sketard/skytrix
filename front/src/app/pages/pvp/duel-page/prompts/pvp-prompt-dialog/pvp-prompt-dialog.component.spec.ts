import { selectCurrentChainLinkIndex, selectExcavatedReveals } from './pvp-prompt-dialog.component';
import { CardInfo, LOCATION } from '../../../duel-ws.types';

// Lightweight specs for the pure helpers extracted from the dialog. These
// helpers carry the M22 / C1-follow-up logic (which chain link's reveals to
// read, and which of those reveals belong in the REVEALED CARDS panel).

function link(chainIndex: number, resolving = false): { chainIndex: number; resolving: boolean } {
  return { chainIndex, resolving };
}

function card(location: number, sequence = 0, cardCode = 1234, name = 'Card'): CardInfo {
  return { cardCode, name, player: 0, location, sequence } as CardInfo;
}

describe('selectCurrentChainLinkIndex', () => {
  it('returns null when there is no active chain', () => {
    expect(selectCurrentChainLinkIndex([])).toBeNull();
  });

  it('returns the chainIndex of the only link in build phase', () => {
    expect(selectCurrentChainLinkIndex([link(0)])).toBe(0);
  });

  it('returns the LAST link during build phase (multiple links pending)', () => {
    // Chain has been built up but no link has started resolving yet.
    expect(selectCurrentChainLinkIndex([link(0), link(1), link(2)])).toBe(2);
  });

  it('returns the link with resolving=true when one is resolving', () => {
    // LIFO resolution: links 0/1/2 chained, link 2 resolves first.
    expect(selectCurrentChainLinkIndex([link(0), link(1), link(2, true)])).toBe(2);
  });

  it('prefers a resolving link over the last link (M22 mid-chain bug)', () => {
    // After link 2 resolved (no longer resolving=true) and link 1 enters
    // resolving phase: the dialog must read link 1's reveals, NOT link 2's.
    // Without this priority, a prompt fired during link 1's resolution
    // would inherit reveals from the stale "last link" (link 2).
    expect(selectCurrentChainLinkIndex([link(0), link(1, true), link(2)])).toBe(1);
  });

  it('returns the first resolving link if multiple are flagged (defensive)', () => {
    // Should not happen in production, but Array.prototype.find returns the
    // first match — pin that semantics so it does not silently change.
    expect(selectCurrentChainLinkIndex([link(0, true), link(1, true)])).toBe(0);
  });
});

describe('selectExcavatedReveals', () => {
  it('returns an empty array for an empty input', () => {
    expect(selectExcavatedReveals([])).toEqual([]);
  });

  it('keeps DECK location cards (excavate from main deck)', () => {
    const cards = [
      card(LOCATION.DECK, 0, 18795635, 'GMX Applied Experiment #55'),
      card(LOCATION.DECK, 1, 11111111, 'Some Dinosaur'),
    ];
    const out = selectExcavatedReveals(cards);
    expect(out.length).toBe(2);
    expect(out[0].cardCode).toBe(18795635);
  });

  it('keeps EXTRA location cards (extra-deck reveals e.g. Kewl Tune)', () => {
    const cards = [card(LOCATION.EXTRA, 0, 22222222, 'Some Synchro')];
    expect(selectExcavatedReveals(cards).length).toBe(1);
  });

  // Pinning test for the C1-follow-up regression: hand-reveal prompts
  // (Aqua Dolphin) must NOT bleed their non-monster cards (Polymerization etc.)
  // into the REVEALED CARDS panel. The hand reveals come with location=HAND
  // and must be filtered out.
  it('filters out HAND location cards (Aqua Dolphin reveal must not leak)', () => {
    const cards = [
      card(LOCATION.HAND, 0, 33333333, 'Polymerization'),
      card(LOCATION.HAND, 1, 44444444, 'Some Monster'),
    ];
    expect(selectExcavatedReveals(cards)).toEqual([]);
  });

  it('mixed input: keeps only excavate cards, drops hand reveals', () => {
    const cards = [
      card(LOCATION.HAND, 0, 33333333, 'Polymerization'),
      card(LOCATION.DECK, 0, 18795635, 'GMX Applied Experiment #55'),
      card(LOCATION.HAND, 1, 44444444, 'Some Monster'),
      card(LOCATION.EXTRA, 0, 22222222, 'Some Fusion'),
    ];
    const out = selectExcavatedReveals(cards);
    expect(out.length).toBe(2);
    expect(out.map(c => c.cardCode).sort()).toEqual([22222222, 18795635].sort());
  });

  it('does not mutate the input array', () => {
    const cards = [card(LOCATION.HAND, 0), card(LOCATION.DECK, 0)];
    const before = cards.slice();
    selectExcavatedReveals(cards);
    expect(cards).toEqual(before);
  });
});
