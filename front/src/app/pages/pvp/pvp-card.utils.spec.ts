import { POSITION, type PlayerBoardState, type ZoneId } from './duel-ws.types';
import { isFaceUp, isDefense, buildFaceDownZoneKeys, getCardImageUrl, getCardImageUrlByCode, preloadCardImages } from './pvp-card.utils';

describe('pvp-card.utils', () => {

  describe('isFaceUp', () => {
    it('should return true for FACEUP_ATTACK', () => {
      expect(isFaceUp(POSITION.FACEUP_ATTACK)).toBeTrue();
    });

    it('should return true for FACEUP_DEFENSE', () => {
      expect(isFaceUp(POSITION.FACEUP_DEFENSE)).toBeTrue();
    });

    it('should return false for FACEDOWN_ATTACK', () => {
      expect(isFaceUp(POSITION.FACEDOWN_ATTACK)).toBeFalse();
    });

    it('should return false for FACEDOWN_DEFENSE', () => {
      expect(isFaceUp(POSITION.FACEDOWN_DEFENSE)).toBeFalse();
    });
  });

  describe('isDefense', () => {
    it('should return true for FACEUP_DEFENSE', () => {
      expect(isDefense(POSITION.FACEUP_DEFENSE)).toBeTrue();
    });

    it('should return true for FACEDOWN_DEFENSE', () => {
      expect(isDefense(POSITION.FACEDOWN_DEFENSE)).toBeTrue();
    });

    it('should return false for FACEUP_ATTACK', () => {
      expect(isDefense(POSITION.FACEUP_ATTACK)).toBeFalse();
    });

    it('should return false for FACEDOWN_ATTACK', () => {
      expect(isDefense(POSITION.FACEDOWN_ATTACK)).toBeFalse();
    });
  });

  describe('getCardImageUrlByCode', () => {
    it('should return card back for null', () => {
      expect(getCardImageUrlByCode(null)).toBe('assets/images/card_back.jpg');
    });

    it('should return card back for 0', () => {
      expect(getCardImageUrlByCode(0)).toBe('assets/images/card_back.jpg');
    });

    it('should return API URL for valid code', () => {
      expect(getCardImageUrlByCode(46986414)).toBe('/api/documents/small/code/46986414');
    });
  });

  describe('getCardImageUrl', () => {
    it('should delegate to getCardImageUrlByCode', () => {
      expect(getCardImageUrl({ cardCode: 89631139 })).toBe('/api/documents/small/code/89631139');
      expect(getCardImageUrl({ cardCode: null })).toBe('assets/images/card_back.jpg');
    });
  });

  describe('buildFaceDownZoneKeys', () => {
    const makePlayers = (zones: { zoneId: ZoneId; position: number }[][]): PlayerBoardState[] =>
      zones.map(playerZones => ({
        lp: 8000, deckCount: 40, extraCount: 15,
        zones: playerZones.map(z => ({
          zoneId: z.zoneId,
          cards: [{ cardCode: null, name: null, position: z.position as typeof POSITION[keyof typeof POSITION], overlayMaterials: [], counters: {} }],
        })),
      }));

    it('should return empty set when no face-down cards', () => {
      const players = makePlayers([
        [{ zoneId: 'M1', position: POSITION.FACEUP_ATTACK }],
        [],
      ]);
      expect(buildFaceDownZoneKeys(players, [0, 1]).size).toBe(0);
    });

    it('should detect FACEDOWN_ATTACK zones', () => {
      const players = makePlayers([
        [{ zoneId: 'M1', position: POSITION.FACEDOWN_ATTACK }],
        [],
      ]);
      const keys = buildFaceDownZoneKeys(players, [0]);
      expect(keys.has('M1-0')).toBeTrue();
    });

    it('should detect FACEDOWN_DEFENSE zones', () => {
      const players = makePlayers([
        [],
        [{ zoneId: 'S3', position: POSITION.FACEDOWN_DEFENSE }],
      ]);
      const keys = buildFaceDownZoneKeys(players, [1]);
      expect(keys.has('S3-1')).toBeTrue();
    });

    it('should only include requested player indices', () => {
      const players = makePlayers([
        [{ zoneId: 'M1', position: POSITION.FACEDOWN_ATTACK }],
        [{ zoneId: 'S1', position: POSITION.FACEDOWN_DEFENSE }],
      ]);
      const keys = buildFaceDownZoneKeys(players, [0]);
      expect(keys.has('M1-0')).toBeTrue();
      expect(keys.has('S1-1')).toBeFalse();
    });

    it('should detect face-down among multiple cards in same zone', () => {
      const players: PlayerBoardState[] = [{
        lp: 8000, deckCount: 40, extraCount: 15,
        zones: [{
          zoneId: 'GY' as ZoneId,
          cards: [
            { cardCode: 100, name: null, position: POSITION.FACEUP_ATTACK, overlayMaterials: [], counters: {} },
            { cardCode: 200, name: null, position: POSITION.FACEDOWN_DEFENSE, overlayMaterials: [], counters: {} },
            { cardCode: 300, name: null, position: POSITION.FACEUP_DEFENSE, overlayMaterials: [], counters: {} },
          ],
        }],
      }];
      expect(buildFaceDownZoneKeys(players, [0]).has('GY-0')).toBeTrue();
    });

    it('should return empty set when indices is empty', () => {
      const players = makePlayers([[{ zoneId: 'M1', position: POSITION.FACEDOWN_ATTACK }]]);
      expect(buildFaceDownZoneKeys(players, []).size).toBe(0);
    });

    it('should gracefully skip out-of-bounds player index', () => {
      const players = makePlayers([[{ zoneId: 'M1', position: POSITION.FACEDOWN_ATTACK }]]);
      const keys = buildFaceDownZoneKeys(players, [0, 99]);
      expect(keys.size).toBe(1);
      expect(keys.has('M1-0')).toBeTrue();
    });
  });

  describe('preloadCardImages', () => {
    let created: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[];
    let OrigImage: typeof Image;

    beforeEach(() => {
      created = [];
      OrigImage = window.Image;
      (window as any).Image = class MockImage {
        src = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() { created.push(this as any); }
      };
    });

    afterEach(() => { window.Image = OrigImage; });

    it('should create Image objects with correct src for each code', async () => {
      const promise = preloadCardImages([123, 456]);
      created.forEach(img => img.onload!());
      await promise;

      expect(created.length).toBe(2);
      expect(created[0].src).toBe('/api/documents/small/code/123');
      expect(created[1].src).toBe('/api/documents/small/code/456');
    });

    it('should resolve even when images fail to load', async () => {
      const promise = preloadCardImages([999]);
      created.forEach(img => img.onerror!());
      await promise;
    });

    it('should resolve immediately for empty array', async () => {
      await expectAsync(preloadCardImages([])).toBeResolved();
    });
  });
});
