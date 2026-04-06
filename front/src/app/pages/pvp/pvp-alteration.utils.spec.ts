import { getAttributeName, getRaceName, formatStat, totalCounters } from './pvp-alteration.utils';

describe('pvp-alteration.utils', () => {

  describe('getAttributeName', () => {
    it('should map known attribute IDs', () => {
      expect(getAttributeName(1)).toBe('EARTH');
      expect(getAttributeName(2)).toBe('WATER');
      expect(getAttributeName(4)).toBe('FIRE');
      expect(getAttributeName(8)).toBe('WIND');
      expect(getAttributeName(16)).toBe('LIGHT');
      expect(getAttributeName(32)).toBe('DARK');
      expect(getAttributeName(64)).toBe('DIVINE');
    });

    it('should return null for unknown attribute', () => {
      expect(getAttributeName(999)).toBeNull();
      expect(getAttributeName(0)).toBeNull();
    });
  });

  describe('getRaceName', () => {
    it('should map common race IDs', () => {
      expect(getRaceName(1)).toBe('WARRIOR');
      expect(getRaceName(2)).toBe('SPELLCASTER');
      expect(getRaceName(8192)).toBe('DRAGON');
      expect(getRaceName(16777216)).toBe('CYBERSE');
    });

    it('should return null for unknown race', () => {
      expect(getRaceName(0)).toBeNull();
      expect(getRaceName(99999999)).toBeNull();
    });
  });

  describe('formatStat', () => {
    it('should return "?" for negative values', () => {
      expect(formatStat(-1)).toBe('?');
    });

    it('should return string for normal values', () => {
      expect(formatStat(0)).toBe('0');
      expect(formatStat(2500)).toBe('2500');
      expect(formatStat(9999)).toBe('9999');
    });

    it('should abbreviate values >= 10000 with at most 1 decimal', () => {
      expect(formatStat(10000)).toBe('10k');
      expect(formatStat(50000)).toBe('50k');
      expect(formatStat(12500)).toBe('12.5k');
      expect(formatStat(10001)).toBe('10k');
      expect(formatStat(10050)).toBe('10.1k');
    });
  });

  describe('totalCounters', () => {
    it('should return 0 for undefined', () => {
      expect(totalCounters(undefined)).toBe(0);
    });

    it('should return 0 for empty object', () => {
      expect(totalCounters({})).toBe(0);
    });

    it('should sum all counter values', () => {
      expect(totalCounters({ 'spell': 3, 'xyz': 2 })).toBe(5);
    });

    it('should handle single counter', () => {
      expect(totalCounters({ 'spell': 7 })).toBe(7);
    });
  });
});
