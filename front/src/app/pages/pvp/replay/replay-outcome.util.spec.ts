import { deriveOutcome } from './replay-outcome.util';

describe('deriveOutcome (D19)', () => {
  describe('mySide = 0', () => {
    it('maps explicit self-wins to victory', () => {
      expect(deriveOutcome('VICTORY', 0)).toBe('victory');
      expect(deriveOutcome('OPPONENT_TIMEOUT', 0)).toBe('victory');
      expect(deriveOutcome('OPPONENT_DISCONNECT', 0)).toBe('victory');
      expect(deriveOutcome('OPPONENT_SURRENDER', 0)).toBe('victory');
    });

    it('maps explicit self-losses to defeat', () => {
      expect(deriveOutcome('DEFEAT', 0)).toBe('defeat');
      expect(deriveOutcome('TIMEOUT', 0)).toBe('defeat');
      expect(deriveOutcome('DISCONNECT', 0)).toBe('defeat');
      expect(deriveOutcome('SURRENDER', 0)).toBe('defeat');
    });

    it('maps explicit draw to draw', () => {
      expect(deriveOutcome('DRAW', 0)).toBe('draw');
    });
  });

  describe('mySide = 1 (perspective flipped)', () => {
    it('flips victory → defeat and vice versa', () => {
      expect(deriveOutcome('VICTORY', 1)).toBe('defeat');
      expect(deriveOutcome('DEFEAT', 1)).toBe('victory');
    });

    it('flips opponent variants symmetrically', () => {
      expect(deriveOutcome('OPPONENT_SURRENDER', 1)).toBe('defeat');
      expect(deriveOutcome('SURRENDER', 1)).toBe('victory');
      expect(deriveOutcome('OPPONENT_TIMEOUT', 1)).toBe('defeat');
      expect(deriveOutcome('TIMEOUT', 1)).toBe('victory');
    });

    it('keeps draw as draw under flip', () => {
      expect(deriveOutcome('DRAW', 1)).toBe('draw');
    });
  });

  describe('case-insensitive input (defensive)', () => {
    // Server enum is UPPERCASE_UNDERSCORE; we normalize so legacy/test payloads
    // in mixed case still resolve correctly.
    it('accepts lowercase and mixed case', () => {
      expect(deriveOutcome('victory', 0)).toBe('victory');
      expect(deriveOutcome('Victory', 0)).toBe('victory');
      expect(deriveOutcome('opponent_surrender', 0)).toBe('victory');
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
      expect(deriveOutcome('XYZ_UNKNOWN', 1)).toBe('draw');
    });
  });
});
