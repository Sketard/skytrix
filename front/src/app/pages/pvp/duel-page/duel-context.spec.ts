import { TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DuelContext } from './duel-context';

describe('DuelContext', () => {
  let ctx: DuelContext;
  let mockAnnouncer: jasmine.SpyObj<LiveAnnouncer>;

  beforeEach(() => {
    mockAnnouncer = jasmine.createSpyObj('LiveAnnouncer', ['announce']);
    TestBed.configureTestingModule({
      providers: [
        DuelContext,
        { provide: LiveAnnouncer, useValue: mockAnnouncer },
      ],
    });
    ctx = TestBed.inject(DuelContext);
  });

  describe('before configure()', () => {
    it('should throw in dev mode when reading ownPlayerIndex', () => {
      expect(() => ctx.ownPlayerIndex()).toThrowError(/DUEL-ASSERT.*configure/);
    });

    it('should throw in dev mode when reading speedMultiplier', () => {
      expect(() => ctx.speedMultiplier()).toThrowError(/DUEL-ASSERT.*configure/);
    });

    it('should throw in dev mode when reading isBoardActive', () => {
      expect(() => ctx.isBoardActive()).toThrowError(/DUEL-ASSERT.*configure/);
    });
  });

  describe('after configure()', () => {
    beforeEach(() => {
      ctx.configure({
        ownPlayerIndex: () => 0,
        speedMultiplier: () => 1.5,
        isBoardActive: () => true,
      });
    });

    it('should return configured values', () => {
      expect(ctx.ownPlayerIndex()).toBe(0);
      expect(ctx.speedMultiplier()).toBe(1.5);
      expect(ctx.isBoardActive()).toBeTrue();
    });
  });

  describe('relativePlayer', () => {
    beforeEach(() => {
      ctx.configure({ ownPlayerIndex: () => 0, speedMultiplier: () => 1, isBoardActive: () => true });
    });

    it('should return 0 for own player', () => {
      expect(ctx.relativePlayer(0)).toBe(0);
    });

    it('should return 1 for opponent', () => {
      expect(ctx.relativePlayer(1)).toBe(1);
    });
  });

  describe('relativePlayer when own = 1', () => {
    beforeEach(() => {
      ctx.configure({ ownPlayerIndex: () => 1, speedMultiplier: () => 1, isBoardActive: () => true });
    });

    it('should return 0 for own player (absolute 1)', () => {
      expect(ctx.relativePlayer(1)).toBe(0);
    });

    it('should return 1 for opponent (absolute 0)', () => {
      expect(ctx.relativePlayer(0)).toBe(1);
    });
  });

  describe('scaledDuration', () => {
    beforeEach(() => {
      ctx.configure({ ownPlayerIndex: () => 0, speedMultiplier: () => 0.5, isBoardActive: () => true });
    });

    it('should scale base duration by multiplier', () => {
      expect(ctx.scaledDuration(400)).toBe(200);
    });

    it('should respect minimum', () => {
      expect(ctx.scaledDuration(100, 150)).toBe(150);
    });

    it('should round to integer', () => {
      // 300 * 0.5 = 150 — exact, but test with odd multiplier
      ctx.configure({ ownPlayerIndex: () => 0, speedMultiplier: () => 0.67, isBoardActive: () => true });
      expect(ctx.scaledDuration(301)).toBe(Math.max(0, Math.round(301 * 0.67)));
    });
  });

  describe('cardBaseRotation', () => {
    it('should return undefined for own player (relPlayer 0)', () => {
      expect(ctx.cardBaseRotation(0)).toBeUndefined();
    });

    it('should return 180 for opponent (relPlayer 1)', () => {
      expect(ctx.cardBaseRotation(1)).toBe(180);
    });
  });

  describe('cardBaseRotateCSS', () => {
    it('should return empty string for own player', () => {
      expect(ctx.cardBaseRotateCSS(0)).toBe('');
    });

    it('should return rotateZ(180deg) for opponent', () => {
      expect(ctx.cardBaseRotateCSS(1)).toBe('rotateZ(180deg)');
    });

    it('empty string should be falsy (consistent with undefined check pattern)', () => {
      const css = ctx.cardBaseRotateCSS(0);
      expect(!css).toBeTrue();
    });
  });

  describe('zoneCardRotation', () => {
    it('should return 0 for attack position', () => {
      expect(ctx.zoneCardRotation(0, false)).toBe(0);
      expect(ctx.zoneCardRotation(1, false)).toBe(0);
    });

    it('should return -90 for defense position', () => {
      expect(ctx.zoneCardRotation(0, true)).toBe(-90);
      expect(ctx.zoneCardRotation(1, true)).toBe(-90);
    });
  });

  describe('announceEvent', () => {
    beforeEach(() => {
      ctx.configure({ ownPlayerIndex: () => 0, speedMultiplier: () => 1, isBoardActive: () => true });
    });

    it('should announce without prefix for own player', () => {
      ctx.announceEvent('Summon', 0);
      expect(mockAnnouncer.announce).toHaveBeenCalledWith('Summon');
    });

    it('should announce with "Opponent: " prefix for opponent', () => {
      ctx.announceEvent('Summon', 1);
      expect(mockAnnouncer.announce).toHaveBeenCalledWith('Opponent: Summon');
    });
  });

  describe('reducedMotion', () => {
    it('should return a boolean', () => {
      expect(typeof ctx.reducedMotion()).toBe('boolean');
    });
  });
});
