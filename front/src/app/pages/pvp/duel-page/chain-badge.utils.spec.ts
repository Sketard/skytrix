import { LOCATION, type CardLocation } from '../duel-ws.types';
import type { ChainLinkState } from '../types';
import { buildHandChainBadges, buildHandRevealedCards, buildOpponentHandChainData } from './chain-badge.utils';

const makeLink = (chainIndex: number, cardCode: number, player: number, sequence: number, location: CardLocation = LOCATION.HAND): ChainLinkState => ({
  chainIndex, cardCode, cardName: `Card ${cardCode}`, player,
  zoneId: null, location, sequence, resolving: false, negated: false,
});

const handCards = (codes: (number | null)[]) => codes.map(c => ({ cardCode: c }));

describe('chain-badge.utils', () => {

  describe('buildHandChainBadges', () => {
    it('should return empty map when fewer than 2 links and not resolving', () => {
      const links = [makeLink(0, 100, 0, 0)];
      const result = buildHandChainBadges(links, 0, 'building', handCards([100]));
      expect(result.size).toBe(0);
    });

    it('should populate badges when 2+ links', () => {
      const links = [makeLink(0, 100, 0, 0), makeLink(1, 200, 0, 1)];
      const hand = handCards([100, 200]);
      const result = buildHandChainBadges(links, 0, 'building', hand);
      expect(result.get(0)).toBe(1);
      expect(result.get(1)).toBe(2);
    });

    it('should populate badges when resolving even with 1 link', () => {
      const links = [makeLink(0, 100, 0, 0)];
      const result = buildHandChainBadges(links, 0, 'resolving', handCards([100]));
      expect(result.get(0)).toBe(1);
    });

    it('should ignore links from other players', () => {
      const links = [makeLink(0, 100, 0, 0), makeLink(1, 200, 1, 0)];
      const result = buildHandChainBadges(links, 0, 'building', handCards([100, 200]));
      expect(result.size).toBe(1);
      expect(result.has(0)).toBeTrue();
    });

    it('should ignore links from non-HAND locations', () => {
      const links = [
        makeLink(0, 100, 0, 0, LOCATION.HAND),
        makeLink(1, 200, 0, 0, LOCATION.MZONE),
      ];
      const result = buildHandChainBadges(links, 0, 'building', handCards([100, 200]));
      expect(result.size).toBe(1);
    });

    it('should match by cardCode and prefer closest index to original sequence', () => {
      const links = [makeLink(0, 100, 0, 2), makeLink(1, 100, 0, 3)];
      // Hand has two copies of card 100 at indices 1 and 3
      const hand = handCards([null, 100, null, 100]);
      const result = buildHandChainBadges(links, 0, 'building', hand);
      // Link 0 (original seq 2) should match index 1 (closest to 2)
      // Link 1 (original seq 3) should match index 3 (remaining)
      expect(result.get(1)).toBe(1);
      expect(result.get(3)).toBe(2);
    });

    it('should fall back to original sequence when no cardCode match remains', () => {
      const links = [makeLink(0, 100, 0, 0), makeLink(2, 100, 0, 1)];
      const hand = handCards([100]);
      const result = buildHandChainBadges(links, 0, 'building', hand);
      // First link claims index 0 by cardCode match; second link has no remaining match
      expect(result.get(0)).toBe(1);
      expect(result.size).toBe(1);
    });
  });

  describe('buildHandRevealedCards', () => {
    it('reveals an own hand card on a SINGLE-link chain (no ≥2-link threshold)', () => {
      const links = [makeLink(0, 100, 0, 0)];
      const result = buildHandRevealedCards(links, 0, handCards([100]));
      expect(result.get(0)).toBe(100);
    });

    it('reveals multiple own hand cards across links', () => {
      const links = [makeLink(0, 100, 0, 0), makeLink(1, 200, 0, 1)];
      const result = buildHandRevealedCards(links, 0, handCards([100, 200]));
      expect(result.get(0)).toBe(100);
      expect(result.get(1)).toBe(200);
    });

    it('excludes opponent links', () => {
      const links = [makeLink(0, 100, 1, 0)];
      const result = buildHandRevealedCards(links, 0, handCards([100]));
      expect(result.size).toBe(0);
    });

    it('ignores non-HAND locations', () => {
      const links = [makeLink(0, 100, 0, 0, LOCATION.MZONE)];
      const result = buildHandRevealedCards(links, 0, handCards([100]));
      expect(result.size).toBe(0);
    });

    it('does not reveal cards with cardCode 0', () => {
      const links = [makeLink(0, 0, 0, 0)];
      const result = buildHandRevealedCards(links, 0, handCards([null]));
      expect(result.size).toBe(0);
    });
  });

  describe('buildOpponentHandChainData', () => {
    it('should return empty badges but still populate revealed when not resolving with 1 link', () => {
      const links = [makeLink(0, 100, 1, 0)];
      const { badges, revealed } = buildOpponentHandChainData(links, 0, 'building', handCards([null]));
      expect(badges.size).toBe(0);
      expect(revealed.size).toBe(1);
    });

    it('should populate both badges and revealed when resolving', () => {
      const links = [makeLink(0, 100, 1, 0)];
      const { badges, revealed } = buildOpponentHandChainData(links, 0, 'resolving', handCards([100]));
      expect(badges.get(0)).toBe(1);
      expect(revealed.get(0)).toBe(100);
    });

    it('should exclude own player links', () => {
      const links = [makeLink(0, 100, 0, 0), makeLink(1, 200, 1, 0)];
      const { badges } = buildOpponentHandChainData(links, 0, 'building', handCards([200]));
      // Only player 1 link should be considered (own = 0)
      expect(badges.size).toBe(1);
    });

    it('should populate badges when 2+ opponent links (building phase)', () => {
      const links = [makeLink(0, 100, 1, 0), makeLink(1, 200, 1, 1)];
      const hand = handCards([100, 200]);
      const { badges, revealed } = buildOpponentHandChainData(links, 0, 'building', hand);
      expect(badges.get(0)).toBe(1);
      expect(badges.get(1)).toBe(2);
      expect(revealed.get(0)).toBe(100);
      expect(revealed.get(1)).toBe(200);
    });

    it('should not reveal cards with cardCode 0', () => {
      const links = [makeLink(0, 0, 1, 0), makeLink(1, 200, 1, 1)];
      const { revealed } = buildOpponentHandChainData(links, 0, 'building', handCards([null, 200]));
      expect(revealed.has(0)).toBeFalse();
      expect(revealed.get(1)).toBe(200);
    });
  });

  // F9-bis hand-discard fix (2026-06-04) — when the activated card is
  // discarded for its own cost, the second copy in hand MUST NOT inherit
  // the badge. The fix relies on the server-side `handCopiesAtChaining`
  // counter shipped on MSG_CHAINING. Tests below pin the filter logic.
  describe('handCopiesAtChaining filter (discard-cost scenario)', () => {
    const linkWithCount = (chainIndex: number, cardCode: number, sequence: number, handCopiesAtChaining?: number): ChainLinkState => ({
      ...makeLink(chainIndex, cardCode, 0, sequence),
      handCopiesAtChaining,
    });

    it('refuses to badge a second copy when activated card was discarded (own hand)', () => {
      // Scenario: 2 Faimena in hand at chaining time, activated copy
      // discards itself for cost, 1 Faimena remains in hand.
      const links = [
        makeLink(0, 100, 0, 0),                   // CL0: some other card
        linkWithCount(1, 200, 1, /*handCopiesAtChaining*/ 2),   // CL1: Faimena, was 2 in hand
      ];
      const hand = handCards([100, 200]); // 1 Faimena left (the activated one is gone)
      const result = buildHandChainBadges(links, 0, 'building', hand);
      // CL0 (the other card) is still badged.
      expect(result.get(0)).toBe(1);
      // CL1 must NOT badge index 1 — the only remaining Faimena is the
      // unrelated second copy.
      expect(result.has(1)).toBeFalse();
    });

    it('still badges when handCopiesAtChaining matches current count (no discard)', () => {
      // Scenario: 2 Faimena in hand at chaining time, no discard, both
      // copies still in hand. The activated one is still there.
      const links = [
        makeLink(0, 100, 0, 0),
        linkWithCount(1, 200, 1, /*handCopiesAtChaining*/ 2),
      ];
      const hand = handCards([100, 200, 200]); // 2 Faimena still there
      const result = buildHandChainBadges(links, 0, 'building', hand);
      expect(result.get(0)).toBe(1);
      expect(result.get(1)).toBe(2);
    });

    it('falls back to pre-fix behavior when handCopiesAtChaining is undefined (legacy)', () => {
      // Without the counter, the resolver lands on the closest remaining
      // copy by proximity. This is the pre-fix behavior — kept so legacy
      // replays don't regress further.
      const links = [
        makeLink(0, 100, 0, 0),
        linkWithCount(1, 200, 1 /* no handCopiesAtChaining */),
      ];
      const hand = handCards([100, 200]);
      const result = buildHandChainBadges(links, 0, 'building', hand);
      expect(result.get(0)).toBe(1);
      // Pre-fix: badge lands on the only copy left.
      expect(result.get(1)).toBe(2);
    });

    it('opponent hand: refuses to badge a second copy when activated card was discarded', () => {
      const links = [
        makeLink(0, 100, 1, 0),
        { ...makeLink(1, 200, 1, 1), handCopiesAtChaining: 2 } as ChainLinkState,
      ];
      const hand = handCards([100, 200]);
      const { badges } = buildOpponentHandChainData(links, 0, 'building', hand);
      expect(badges.get(0)).toBe(1);
      expect(badges.has(1)).toBeFalse();
    });

    it('opponent hand: revealed map also skips when activated card was discarded', () => {
      const links = [
        { ...makeLink(0, 200, 1, 1), handCopiesAtChaining: 2 } as ChainLinkState,
      ];
      const hand = handCards([200]);
      const { revealed } = buildOpponentHandChainData(links, 0, 'building', hand);
      // The remaining Faimena is the second copy — not the activated one.
      // It must not be marked as revealed (its identity wasn't shown to
      // the opponent via this chain).
      expect(revealed.has(0)).toBeFalse();
    });

    it('buildHandRevealedCards: refuses to flag a second copy when activated card was discarded', () => {
      const links = [
        { ...makeLink(0, 200, 0, 1), handCopiesAtChaining: 2 } as ChainLinkState,
      ];
      const hand = handCards([200]);
      const revealed = buildHandRevealedCards(links, 0, hand);
      expect(revealed.has(0)).toBeFalse();
    });

    it('handles three copies → two discarded → one badge still skipped (current < 3)', () => {
      const links = [
        { ...makeLink(0, 200, 0, 0), handCopiesAtChaining: 3 } as ChainLinkState,
      ];
      const hand = handCards([200]); // 1 copy left, 2 went somewhere
      const result = buildHandChainBadges(links, 0, 'resolving', hand);
      expect(result.has(0)).toBeFalse();
    });

    it('handCopiesAtChaining=1 with no copies in hand → no badge (degenerate but consistent)', () => {
      const links = [
        { ...makeLink(0, 200, 0, 0), handCopiesAtChaining: 1 } as ChainLinkState,
      ];
      const hand = handCards([100]); // no Faimena at all
      const result = buildHandChainBadges(links, 0, 'resolving', hand);
      expect(result.has(0)).toBeFalse();
    });

    // PvP live, non-omniscient viewer: opponent's hand contains face-down
    // cards rendered as { cardCode: null }. Strict `currentCount` would
    // skip these (null !== cardCode) and the filter would reject every
    // badge on the opponent hand mid-chain. Face-down slots must count
    // as "potential matches" (unknownCount) so a face-down card can
    // still be the activated link we just can't yet identify.
    it('opponent face-down: 2 copies at chaining, 0 revealed + 2 face-down → still allows badging by proximity', () => {
      const links = [
        { ...makeLink(0, 200, 1, 1), handCopiesAtChaining: 2 } as ChainLinkState,
      ];
      // Both Faimena copies face-down on opponent side
      const hand = handCards([null, null]);
      const { badges } = buildOpponentHandChainData(links, 0, 'resolving', hand);
      // Pre-fix behavior preserved: filter doesn't reject (unknownCount=2 covers
      // the 2 expected copies) → fallback to originalSeq → badge at index 1.
      expect(badges.get(1)).toBe(1);
    });

    it('opponent face-down: 2 at chaining, 1 revealed + 1 face-down → covers + badges revealed', () => {
      const links = [
        { ...makeLink(0, 200, 1, 1), handCopiesAtChaining: 2 } as ChainLinkState,
      ];
      // 1 visible Faimena + 1 face-down: currentCount=1, unknownCount=1,
      // 1+1 >= 2 → filter passes, bestDist finds the visible Faimena.
      const hand = handCards([200, null]);
      const { badges } = buildOpponentHandChainData(links, 0, 'resolving', hand);
      expect(badges.get(0)).toBe(1);
    });

    it('opponent face-down: 2 at chaining, 1 face-down + 0 revealed → 1 copy discarded, filter rejects', () => {
      // currentCount=0, unknownCount=1, 0+1 < 2 → at least one copy is
      // provably gone (only 1 hand slot left, but 2 were expected). The
      // activated card has left the hand → no badge on the remaining
      // face-down slot (which could be unrelated).
      const links = [
        { ...makeLink(0, 200, 1, 0), handCopiesAtChaining: 2 } as ChainLinkState,
      ];
      const hand = handCards([null]);
      const { badges } = buildOpponentHandChainData(links, 0, 'resolving', hand);
      expect(badges.has(0)).toBeFalse();
    });

    it('own hand: own player has no face-down (cardCode never null) — filter behaves as pre-face-down version', () => {
      // Regression guard: face-down handling adds `unknownCount` but
      // must NOT silently un-reject the own-hand discard scenario.
      const links = [
        { ...makeLink(0, 200, 0, 1), handCopiesAtChaining: 2 } as ChainLinkState,
      ];
      const hand = handCards([100, 200]); // own hand: 1 Faimena, 1 other (visible)
      const result = buildHandChainBadges(links, 0, 'resolving', hand);
      expect(result.has(1)).toBeFalse();
    });

    it('currentCount > handCopiesAtChaining (extra draw after activation) — badges by proximity, NOT rejected', () => {
      // Rare scenario: an effect draws a copy of the same card AFTER the
      // CHAINING was emitted (e.g. a continuous spell that draws on cost
      // payment). currentCount (2) > handCopiesAtChaining (1) → strict
      // less-than predicate is false → filter does NOT reject. The
      // proximity heuristic then badges the copy closest to the original
      // sequence — the activated copy (still in hand because cost didn't
      // discard it). Pinning this so a future `!==` strictness regression
      // is caught.
      const links = [
        { ...makeLink(0, 200, 0, 0), handCopiesAtChaining: 1 } as ChainLinkState,
      ];
      const hand = handCards([200, 200]); // 2 copies now, 1 expected
      const result = buildHandChainBadges(links, 0, 'resolving', hand);
      expect(result.get(0)).toBe(1);
    });
  });
});
