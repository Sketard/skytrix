import { describe, it, expect } from 'vitest';
import { validateResponseData } from './response-validation.js';
import type { ServerMessage } from '../ws-protocol.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid prompt message for testing. Casts as ServerMessage —
 *  validateResponseData treats `prompt` as a generic Record after dispatching
 *  on `prompt.type`, so we don't need full DTO conformity. */
function prompt(type: string, extra: Record<string, unknown> = {}): ServerMessage {
  return { type, ...extra } as ServerMessage;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('validateResponseData', () => {
  describe('SELECT_CARD', () => {
    const cards = [{}, {}, {}]; // 3 cards, indices 0-2

    it('valid: indices in bounds, length in [min, max]', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards, min: 1, max: 2 }), { indices: [0, 1] })).toBeNull();
    });

    it('valid: cancel allowed when cancelable', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards, cancelable: true }), { indices: null })).toBeNull();
    });

    it('invalid: cancel rejected when not cancelable', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: null })).toMatch(/cancel not allowed/);
    });

    it('invalid: indices not an array', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: 'foo' })).toMatch(/must be an array/);
    });

    it('invalid: indices length below min', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards, min: 2, max: 3 }), { indices: [0] })).toMatch(/not in \[2, 3\]/);
    });

    it('invalid: indices length above max', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards, min: 1, max: 1 }), { indices: [0, 1] })).toMatch(/not in \[1, 1\]/);
    });

    it('invalid: index out of bounds (negative)', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: [-1] })).toMatch(/out of bounds/);
    });

    it('invalid: index out of bounds (>= cardsLen)', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: [3] })).toMatch(/out of bounds/);
    });

    it('invalid: non-integer index', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: [1.5] })).toMatch(/out of bounds/);
    });

    it('invalid: duplicate indices', () => {
      expect(validateResponseData(prompt('SELECT_CARD', { cards, min: 2, max: 2 }), { indices: [0, 0] })).toMatch(/duplicate indices/);
    });

    it('valid: empty cards + min default 1 — out of bounds rejected', () => {
      // Edge: cardsLen=0, default min=1, max=0 → length 0 < 1 fails
      expect(validateResponseData(prompt('SELECT_CARD', { cards: [] }), { indices: [] })).toMatch(/not in \[1, 0\]/);
    });
  });

  describe('SELECT_TRIBUTE', () => {
    // 3 cards, each with `amount` (release_param) of tributes provided
    const cards = [{ amount: 1 }, { amount: 2 }, { amount: 1 }];

    it('valid: tribute sum matches min', () => {
      // Card 1 alone provides 2 tributes → satisfies min=2
      expect(validateResponseData(prompt('SELECT_TRIBUTE', { cards, min: 2, max: 2 }), { indices: [1] })).toBeNull();
    });

    it('valid: cancel allowed when cancelable', () => {
      expect(validateResponseData(prompt('SELECT_TRIBUTE', { cards, cancelable: true }), { indices: null })).toBeNull();
    });

    it('invalid: cancel rejected when not cancelable', () => {
      expect(validateResponseData(prompt('SELECT_TRIBUTE', { cards }), { indices: null })).toMatch(/cancel not allowed/);
    });

    it('invalid: empty indices', () => {
      expect(validateResponseData(prompt('SELECT_TRIBUTE', { cards }), { indices: [] })).toMatch(/must not be empty/);
    });

    it('invalid: indices length exceeds cardsLen', () => {
      expect(validateResponseData(prompt('SELECT_TRIBUTE', { cards }), { indices: [0, 1, 2, 3] })).toMatch(/exceeds cards length/);
    });

    it('invalid: tribute sum below min', () => {
      // Card 0 alone provides 1 tribute, min=2
      expect(validateResponseData(prompt('SELECT_TRIBUTE', { cards, min: 2, max: 2 }), { indices: [0] })).toMatch(/tribute sum 1 not in \[2, 2\]/);
    });

    it('invalid: tribute sum above max', () => {
      // Cards [0,1,2] = 1+2+1 = 4 tributes, max=2
      expect(validateResponseData(prompt('SELECT_TRIBUTE', { cards, min: 1, max: 2 }), { indices: [0, 1, 2] })).toMatch(/tribute sum 4 not in/);
    });

    it('invalid: duplicate indices', () => {
      expect(validateResponseData(prompt('SELECT_TRIBUTE', { cards }), { indices: [0, 0] })).toMatch(/duplicate indices/);
    });
  });

  describe('SELECT_SUM', () => {
    const cards = [{}, {}]; // cardsLen=2
    const mustSelect = [{}, {}, {}]; // mustLen=3 → totalLen=5

    it('valid: indices in bounds [0, totalLen)', () => {
      expect(validateResponseData(prompt('SELECT_SUM', { cards, mustSelect }), { indices: [0, 4] })).toBeNull();
    });

    it('invalid: index out of bounds', () => {
      expect(validateResponseData(prompt('SELECT_SUM', { cards, mustSelect }), { indices: [5] })).toMatch(/out of bounds \[0, 5\)/);
    });

    it('invalid: duplicate indices', () => {
      expect(validateResponseData(prompt('SELECT_SUM', { cards, mustSelect }), { indices: [0, 0] })).toMatch(/duplicate indices/);
    });
  });

  describe('SELECT_CHAIN', () => {
    const cards = [{}, {}]; // 2 chain options

    it('valid: index in bounds', () => {
      expect(validateResponseData(prompt('SELECT_CHAIN', { cards }), { index: 1 })).toBeNull();
    });

    it('valid: index null = decline chain', () => {
      expect(validateResponseData(prompt('SELECT_CHAIN', { cards }), { index: null })).toBeNull();
    });

    it('valid: index -1 = decline chain', () => {
      expect(validateResponseData(prompt('SELECT_CHAIN', { cards }), { index: -1 })).toBeNull();
    });

    it('invalid: index out of bounds (>= cardsLen)', () => {
      expect(validateResponseData(prompt('SELECT_CHAIN', { cards }), { index: 2 })).toMatch(/out of bounds/);
    });
  });

  describe('SELECT_UNSELECT_CARD', () => {
    const cards = [{}, {}];

    it('valid: index in bounds', () => {
      expect(validateResponseData(prompt('SELECT_UNSELECT_CARD', { cards }), { index: 0 })).toBeNull();
    });

    it('valid: index null = finish selection', () => {
      expect(validateResponseData(prompt('SELECT_UNSELECT_CARD', { cards }), { index: null })).toBeNull();
    });

    it('invalid: index out of bounds', () => {
      expect(validateResponseData(prompt('SELECT_UNSELECT_CARD', { cards }), { index: 99 })).toMatch(/out of bounds/);
    });
  });

  describe('SELECT_OPTION', () => {
    const options = [1, 2, 3]; // 3 options

    it('valid: index in bounds', () => {
      expect(validateResponseData(prompt('SELECT_OPTION', { options }), { index: 2 })).toBeNull();
    });

    it('invalid: index out of bounds', () => {
      expect(validateResponseData(prompt('SELECT_OPTION', { options }), { index: 3 })).toMatch(/out of bounds/);
    });

    it('invalid: non-integer index', () => {
      expect(validateResponseData(prompt('SELECT_OPTION', { options }), { index: 'a' })).toMatch(/out of bounds/);
    });
  });

  describe('SORT_CARD / SORT_CHAIN', () => {
    const cards = [{}, {}, {}]; // 3 cards

    it('valid: order is a permutation', () => {
      expect(validateResponseData(prompt('SORT_CARD', { cards }), { order: [2, 0, 1] })).toBeNull();
    });

    it('valid: order null = auto-sort', () => {
      expect(validateResponseData(prompt('SORT_CARD', { cards }), { order: null })).toBeNull();
    });

    it('invalid: order length mismatch', () => {
      expect(validateResponseData(prompt('SORT_CARD', { cards }), { order: [0, 1] })).toMatch(/order length 2/);
    });

    it('invalid: order out of bounds', () => {
      expect(validateResponseData(prompt('SORT_CARD', { cards }), { order: [0, 1, 5] })).toMatch(/out of bounds/);
    });

    it('invalid: duplicate values', () => {
      expect(validateResponseData(prompt('SORT_CARD', { cards }), { order: [0, 0, 1] })).toMatch(/duplicate order value/);
    });

    it('SORT_CHAIN: same rules', () => {
      expect(validateResponseData(prompt('SORT_CHAIN', { cards }), { order: [2, 1, 0] })).toBeNull();
    });
  });

  describe('SELECT_COUNTER', () => {
    const cards = [{}, {}]; // 2 sources

    it('valid: counts sum matches required total', () => {
      expect(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 3 }), { counts: [1, 2] })).toBeNull();
    });

    it('invalid: counts not an array', () => {
      expect(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 3 }), { counts: 'foo' })).toMatch(/must be an array/);
    });

    it('invalid: counts length mismatch', () => {
      expect(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 3 }), { counts: [3] })).toMatch(/counts length/);
    });

    it('invalid: negative count value', () => {
      expect(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 3 }), { counts: [-1, 4] })).toMatch(/invalid count value/);
    });

    it('invalid: counts sum != required', () => {
      expect(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 5 }), { counts: [1, 2] })).toMatch(/counts sum 3 !== required 5/);
    });
  });

  describe('SELECT_POSITION', () => {
    it('valid: position in allowed set', () => {
      expect(validateResponseData(prompt('SELECT_POSITION', { positions: [1, 4] }), { position: 1 })).toBeNull();
    });

    it('valid: no positions filter — any number ok', () => {
      expect(validateResponseData(prompt('SELECT_POSITION', {}), { position: 0x4 })).toBeNull();
    });

    it('invalid: position not a number', () => {
      expect(validateResponseData(prompt('SELECT_POSITION', {}), { position: 'foo' })).toMatch(/must be a number/);
    });

    it('invalid: position not in allowed set', () => {
      expect(validateResponseData(prompt('SELECT_POSITION', { positions: [1, 4] }), { position: 8 })).toMatch(/not in allowed set/);
    });
  });

  describe('SELECT_EFFECTYN / SELECT_YESNO', () => {
    it('SELECT_EFFECTYN valid: yes is boolean', () => {
      expect(validateResponseData(prompt('SELECT_EFFECTYN', {}), { yes: true })).toBeNull();
      expect(validateResponseData(prompt('SELECT_EFFECTYN', {}), { yes: false })).toBeNull();
    });

    it('SELECT_YESNO valid: yes is boolean', () => {
      expect(validateResponseData(prompt('SELECT_YESNO', {}), { yes: true })).toBeNull();
    });

    it('invalid: yes not a boolean', () => {
      expect(validateResponseData(prompt('SELECT_YESNO', {}), { yes: 1 })).toMatch(/must be a boolean/);
    });
  });

  describe('SELECT_PLACE / SELECT_DISFIELD', () => {
    const allowed = [
      { player: 0, location: 4, sequence: 1 },
      { player: 0, location: 4, sequence: 2 },
    ];

    it('valid: place in allowed set', () => {
      expect(validateResponseData(prompt('SELECT_PLACE', { places: allowed, count: 1 }), { places: [{ player: 0, location: 4, sequence: 1 }] })).toBeNull();
    });

    it('invalid: places not an array', () => {
      expect(validateResponseData(prompt('SELECT_PLACE', { places: allowed }), { places: 'foo' })).toMatch(/must be an array/);
    });

    it('invalid: places length mismatch', () => {
      expect(validateResponseData(prompt('SELECT_PLACE', { places: allowed, count: 2 }), { places: [{ player: 0, location: 4, sequence: 1 }] })).toMatch(/places length 1/);
    });

    it('invalid: place not in allowed set', () => {
      expect(validateResponseData(prompt('SELECT_PLACE', { places: allowed, count: 1 }), { places: [{ player: 0, location: 4, sequence: 99 }] })).toMatch(/not in allowed set/);
    });

    it('SELECT_DISFIELD: same rules', () => {
      expect(validateResponseData(prompt('SELECT_DISFIELD', { places: allowed, count: 1 }), { places: [{ player: 0, location: 4, sequence: 2 }] })).toBeNull();
    });
  });

  describe('ANNOUNCE_RACE / ANNOUNCE_ATTRIB', () => {
    it('ANNOUNCE_RACE valid: value is number', () => {
      expect(validateResponseData(prompt('ANNOUNCE_RACE', {}), { value: 0x40 })).toBeNull();
    });

    it('ANNOUNCE_ATTRIB valid: value is number', () => {
      expect(validateResponseData(prompt('ANNOUNCE_ATTRIB', {}), { value: 0x10 })).toBeNull();
    });

    it('invalid: value not a number', () => {
      expect(validateResponseData(prompt('ANNOUNCE_RACE', {}), { value: 'foo' })).toMatch(/must be a number/);
    });
  });

  describe('ANNOUNCE_NUMBER', () => {
    it('valid: value is in options', () => {
      expect(validateResponseData(prompt('ANNOUNCE_NUMBER', { options: [3, 5, 7] }), { value: 5 })).toBeNull();
    });

    it('valid: no options filter', () => {
      expect(validateResponseData(prompt('ANNOUNCE_NUMBER', {}), { value: 42 })).toBeNull();
    });

    it('invalid: value not a number', () => {
      expect(validateResponseData(prompt('ANNOUNCE_NUMBER', {}), { value: 'foo' })).toMatch(/must be a number/);
    });

    it('invalid: value not in options', () => {
      expect(validateResponseData(prompt('ANNOUNCE_NUMBER', { options: [3, 5, 7] }), { value: 4 })).toMatch(/not in options/);
    });
  });

  describe('SELECT_BATTLECMD / SELECT_IDLECMD', () => {
    it('SELECT_IDLECMD valid: action is string', () => {
      expect(validateResponseData(prompt('SELECT_IDLECMD', {}), { action: 'pass' })).toBeNull();
    });

    it('SELECT_IDLECMD valid: action is number', () => {
      expect(validateResponseData(prompt('SELECT_IDLECMD', {}), { action: 7 })).toBeNull();
    });

    it('SELECT_BATTLECMD valid: action is string or number', () => {
      expect(validateResponseData(prompt('SELECT_BATTLECMD', {}), { action: 'attack' })).toBeNull();
      expect(validateResponseData(prompt('SELECT_BATTLECMD', {}), { action: 1 })).toBeNull();
    });

    it('invalid: action is neither', () => {
      expect(validateResponseData(prompt('SELECT_IDLECMD', {}), { action: true })).toMatch(/must be string or number/);
    });
  });

  describe('Unknown / unhandled types', () => {
    it('returns null for unknown prompt type (passthrough)', () => {
      // Default branch — validation skipped for non-prompt types like BOARD_STATE, MSG_*, etc.
      expect(validateResponseData(prompt('BOARD_STATE', {}), {})).toBeNull();
    });
  });
});
