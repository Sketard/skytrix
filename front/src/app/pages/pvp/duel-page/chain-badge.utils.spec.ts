import { LOCATION, type CardLocation } from '../duel-ws.types';
import type { ChainLinkState } from '../types';
import { buildHandChainBadges, buildOpponentHandChainData } from './chain-badge.utils';

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
});
