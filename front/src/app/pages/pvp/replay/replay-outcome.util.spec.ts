import { deriveOutcome } from './replay-outcome.util';

describe('deriveOutcome (D19)', () => {
  describe('mySide = 0', () => {
    it('maps explicit self-wins to victory', () => {
      expect(deriveOutcome('victory', 0)).toBe('victory');
      expect(deriveOutcome('opponentTimeout', 0)).toBe('victory');
      expect(deriveOutcome('opponentDisconnect', 0)).toBe('victory');
      expect(deriveOutcome('opponentSurrender', 0)).toBe('victory');
    });

    it('maps explicit self-losses to defeat', () => {
      expect(deriveOutcome('defeat', 0)).toBe('defeat');
      expect(deriveOutcome('timeout', 0)).toBe('defeat');
      expect(deriveOutcome('disconnect', 0)).toBe('defeat');
      expect(deriveOutcome('surrender', 0)).toBe('defeat');
    });

    it('maps explicit draw to draw', () => {
      expect(deriveOutcome('draw', 0)).toBe('draw');
    });
  });

  describe('mySide = 1 (perspective flipped)', () => {
    it('flips victory → defeat and vice versa', () => {
      expect(deriveOutcome('victory', 1)).toBe('defeat');
      expect(deriveOutcome('defeat', 1)).toBe('victory');
    });

    it('flips opponent variants symmetrically', () => {
      expect(deriveOutcome('opponentSurrender', 1)).toBe('defeat');
      expect(deriveOutcome('surrender', 1)).toBe('victory');
      expect(deriveOutcome('opponentTimeout', 1)).toBe('defeat');
      expect(deriveOutcome('timeout', 1)).toBe('victory');
    });

    it('keeps draw as draw under flip', () => {
      expect(deriveOutcome('draw', 1)).toBe('draw');
    });
  });

  describe('fallback', () => {
    it('returns draw on null/undefined/empty', () => {
      expect(deriveOutcome(null, 0)).toBe('draw');
      expect(deriveOutcome(undefined, 0)).toBe('draw');
      expect(deriveOutcome('', 1)).toBe('draw');
    });

    it('returns draw on unknown result strings rather than crashing', () => {
      expect(deriveOutcome('cosmicRayFlip', 0)).toBe('draw');
      expect(deriveOutcome('xyz_unknown', 1)).toBe('draw');
    });
  });
});
