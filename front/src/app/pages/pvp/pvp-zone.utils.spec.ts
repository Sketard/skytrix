import { LOCATION, type BoardZone, type CardOnField, POSITION } from './duel-ws.types';
import { locationToZoneId, locationToZoneKey, getZonePillCards } from './pvp-zone.utils';

describe('pvp-zone.utils', () => {

  describe('locationToZoneId', () => {
    it('should map MZONE sequences 0-4 to M1-M5', () => {
      expect(locationToZoneId(LOCATION.MZONE, 0)).toBe('M1');
      expect(locationToZoneId(LOCATION.MZONE, 1)).toBe('M2');
      expect(locationToZoneId(LOCATION.MZONE, 2)).toBe('M3');
      expect(locationToZoneId(LOCATION.MZONE, 3)).toBe('M4');
      expect(locationToZoneId(LOCATION.MZONE, 4)).toBe('M5');
    });

    it('should map MZONE sequence 5/6 to EMZ_L/EMZ_R', () => {
      expect(locationToZoneId(LOCATION.MZONE, 5)).toBe('EMZ_L');
      expect(locationToZoneId(LOCATION.MZONE, 6)).toBe('EMZ_R');
    });

    it('should map SZONE sequences 0-4 to S1-S5', () => {
      expect(locationToZoneId(LOCATION.SZONE, 0)).toBe('S1');
      expect(locationToZoneId(LOCATION.SZONE, 4)).toBe('S5');
    });

    it('should map SZONE sequence 5 to FIELD', () => {
      expect(locationToZoneId(LOCATION.SZONE, 5)).toBe('FIELD');
    });

    it('should return null for non-field locations', () => {
      expect(locationToZoneId(LOCATION.HAND, 0)).toBeNull();
      expect(locationToZoneId(LOCATION.GRAVE, 0)).toBeNull();
      expect(locationToZoneId(LOCATION.DECK, 0)).toBeNull();
      expect(locationToZoneId(LOCATION.EXTRA, 0)).toBeNull();
      expect(locationToZoneId(LOCATION.BANISHED, 0)).toBeNull();
    });

    it('should return null for out-of-range MZONE sequence', () => {
      expect(locationToZoneId(LOCATION.MZONE, 7)).toBeNull();
      expect(locationToZoneId(LOCATION.MZONE, -1)).toBeNull();
    });
  });

  describe('locationToZoneKey', () => {
    it('should use ZoneId for field zones', () => {
      expect(locationToZoneKey(LOCATION.MZONE, 0, 0)).toBe('M1-0');
      expect(locationToZoneKey(LOCATION.SZONE, 2, 1)).toBe('S3-1');
    });

    it('should map HAND location', () => {
      expect(locationToZoneKey(LOCATION.HAND, 0, 0)).toBe('HAND-0');
    });

    it('should map DECK location', () => {
      expect(locationToZoneKey(LOCATION.DECK, 0, 1)).toBe('DECK-1');
    });

    it('should map EXTRA location', () => {
      expect(locationToZoneKey(LOCATION.EXTRA, 0, 0)).toBe('EXTRA-0');
    });

    it('should map GRAVE to GY', () => {
      expect(locationToZoneKey(LOCATION.GRAVE, 0, 1)).toBe('GY-1');
    });

    it('should map BANISHED location', () => {
      expect(locationToZoneKey(LOCATION.BANISHED, 0, 0)).toBe('BANISHED-0');
    });

    it('should map OVERLAY to parent MZONE zone', () => {
      expect(locationToZoneKey(LOCATION.OVERLAY, 2, 0)).toBe('M3-0');
    });

    it('should return UNKNOWN for OVERLAY with out-of-range sequence', () => {
      expect(locationToZoneKey(LOCATION.OVERLAY, 99, 0)).toBe('UNKNOWN-0');
    });

    it('should return UNKNOWN for unrecognized location', () => {
      expect(locationToZoneKey(0xff as any, 0, 0)).toBe('UNKNOWN-0');
    });
  });

  describe('getZonePillCards', () => {
    const card = (code: number): CardOnField => ({
      cardCode: code, name: `Card ${code}`,
      position: POSITION.FACEUP_ATTACK, overlayMaterials: [], counters: {},
    });

    const zones: BoardZone[] = [
      { zoneId: 'GY', cards: [card(1), card(2), card(3)] },
      { zoneId: 'M1', cards: [card(10)] },
      { zoneId: 'BANISHED', cards: [card(4), card(5)] },
      { zoneId: 'EXTRA', cards: [card(6)] },
    ];

    it('should reverse pile zones (GY)', () => {
      const result = getZonePillCards(zones, 'GY');
      expect(result.map(c => c.cardCode)).toEqual([3, 2, 1]);
    });

    it('should reverse pile zones (BANISHED)', () => {
      const result = getZonePillCards(zones, 'BANISHED');
      expect(result.map(c => c.cardCode)).toEqual([5, 4]);
    });

    it('should reverse pile zones (EXTRA)', () => {
      const result = getZonePillCards(zones, 'EXTRA');
      expect(result.map(c => c.cardCode)).toEqual([6]);
    });

    it('should NOT reverse non-pile zones', () => {
      const result = getZonePillCards(zones, 'M1');
      expect(result.map(c => c.cardCode)).toEqual([10]);
    });

    it('should return empty array for missing zone', () => {
      expect(getZonePillCards(zones, 'M2')).toEqual([]);
    });

    it('should not mutate the original cards array', () => {
      const original = zones.find(z => z.zoneId === 'GY')!.cards;
      const firstCodeBefore = original[0].cardCode;
      getZonePillCards(zones, 'GY');
      expect(original[0].cardCode).toBe(firstCodeBefore);
    });
  });
});
