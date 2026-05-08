import { describe, it, expect } from 'vitest';
import { validateResponseData, type ValidationResult } from './response-validation.js';
import type { ServerMessage } from '../ws-protocol.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid prompt message for testing. Casts as ServerMessage —
 *  validateResponseData treats `prompt` as a generic Record after dispatching
 *  on `prompt.type`, so we don't need full DTO conformity. */
function prompt(type: string, extra: Record<string, unknown> = {}): ServerMessage {
  return { type, ...extra } as ServerMessage;
}

function expectOk(r: ValidationResult): void {
  expect(r).toEqual({ ok: true });
}

function expectErr(r: ValidationResult, pattern: RegExp): void {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(pattern);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('validateResponseData', () => {
  describe('SELECT_CARD', () => {
    const cards = [{}, {}, {}]; // 3 cards, indices 0-2

    it('valid: indices in bounds, length in [min, max]', () => {
      expectOk(validateResponseData(prompt('SELECT_CARD', { cards, min: 1, max: 2 }), { indices: [0, 1] }));
    });

    it('valid: cancel allowed when cancelable', () => {
      expectOk(validateResponseData(prompt('SELECT_CARD', { cards, cancelable: true }), { indices: null }));
    });

    it('invalid: cancel rejected when not cancelable', () => {
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: null }), /cancel not allowed/);
    });

    it('invalid: indices not an array', () => {
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: 'foo' }), /must be an array/);
    });

    it('invalid: indices length below min', () => {
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards, min: 2, max: 3 }), { indices: [0] }), /not in \[2, 3\]/);
    });

    it('invalid: indices length above max', () => {
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards, min: 1, max: 1 }), { indices: [0, 1] }), /not in \[1, 1\]/);
    });

    it('invalid: index out of bounds (negative)', () => {
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: [-1] }), /out of bounds/);
    });

    it('invalid: index out of bounds (>= cardsLen)', () => {
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: [3] }), /out of bounds/);
    });

    it('invalid: non-integer index', () => {
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards }), { indices: [1.5] }), /out of bounds/);
    });

    it('invalid: duplicate indices', () => {
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards, min: 2, max: 2 }), { indices: [0, 0] }), /duplicate indices/);
    });

    it('valid: empty cards + min default 1 — out of bounds rejected', () => {
      // Edge: cardsLen=0, default min=1, max=0 → length 0 < 1 fails
      expectErr(validateResponseData(prompt('SELECT_CARD', { cards: [] }), { indices: [] }), /not in \[1, 0\]/);
    });
  });

  describe('SELECT_TRIBUTE', () => {
    // 3 cards, each with `amount` (release_param) of tributes provided
    const cards = [{ amount: 1 }, { amount: 2 }, { amount: 1 }];

    it('valid: tribute sum matches min', () => {
      // Card 1 alone provides 2 tributes → satisfies min=2
      expectOk(validateResponseData(prompt('SELECT_TRIBUTE', { cards, min: 2, max: 2 }), { indices: [1] }));
    });

    it('valid: cancel allowed when cancelable', () => {
      expectOk(validateResponseData(prompt('SELECT_TRIBUTE', { cards, cancelable: true }), { indices: null }));
    });

    it('invalid: cancel rejected when not cancelable', () => {
      expectErr(validateResponseData(prompt('SELECT_TRIBUTE', { cards }), { indices: null }), /cancel not allowed/);
    });

    it('invalid: empty indices', () => {
      expectErr(validateResponseData(prompt('SELECT_TRIBUTE', { cards }), { indices: [] }), /must not be empty/);
    });

    it('invalid: indices length exceeds cardsLen', () => {
      expectErr(validateResponseData(prompt('SELECT_TRIBUTE', { cards }), { indices: [0, 1, 2, 3] }), /exceeds cards length/);
    });

    it('invalid: tribute sum below min', () => {
      // Card 0 alone provides 1 tribute, min=2
      expectErr(validateResponseData(prompt('SELECT_TRIBUTE', { cards, min: 2, max: 2 }), { indices: [0] }), /tribute sum 1 not in \[2, 2\]/);
    });

    it('invalid: tribute sum above max', () => {
      // Cards [0,1,2] = 1+2+1 = 4 tributes, max=2
      expectErr(validateResponseData(prompt('SELECT_TRIBUTE', { cards, min: 1, max: 2 }), { indices: [0, 1, 2] }), /tribute sum 4 not in/);
    });

    it('invalid: duplicate indices', () => {
      expectErr(validateResponseData(prompt('SELECT_TRIBUTE', { cards }), { indices: [0, 0] }), /duplicate indices/);
    });
  });

  describe('SELECT_SUM', () => {
    const cards = [{}, {}]; // cardsLen=2
    const mustSelect = [{}, {}, {}]; // mustLen=3 → totalLen=5

    it('valid: indices in bounds [0, totalLen)', () => {
      expectOk(validateResponseData(prompt('SELECT_SUM', { cards, mustSelect }), { indices: [0, 4] }));
    });

    it('invalid: index out of bounds', () => {
      expectErr(validateResponseData(prompt('SELECT_SUM', { cards, mustSelect }), { indices: [5] }), /out of bounds \[0, 5\)/);
    });

    it('invalid: duplicate indices', () => {
      expectErr(validateResponseData(prompt('SELECT_SUM', { cards, mustSelect }), { indices: [0, 0] }), /duplicate indices/);
    });
  });

  describe('SELECT_CHAIN', () => {
    const cards = [{}, {}]; // 2 chain options

    it('valid: index in bounds', () => {
      expectOk(validateResponseData(prompt('SELECT_CHAIN', { cards }), { index: 1 }));
    });

    it('valid: index null = decline chain', () => {
      expectOk(validateResponseData(prompt('SELECT_CHAIN', { cards }), { index: null }));
    });

    it('valid: index -1 = decline chain', () => {
      expectOk(validateResponseData(prompt('SELECT_CHAIN', { cards }), { index: -1 }));
    });

    it('invalid: index out of bounds (>= cardsLen)', () => {
      expectErr(validateResponseData(prompt('SELECT_CHAIN', { cards }), { index: 2 }), /out of bounds/);
    });
  });

  describe('SELECT_UNSELECT_CARD', () => {
    const cards = [{}, {}];

    it('valid: index in bounds', () => {
      expectOk(validateResponseData(prompt('SELECT_UNSELECT_CARD', { cards }), { index: 0 }));
    });

    it('valid: index null = finish selection', () => {
      expectOk(validateResponseData(prompt('SELECT_UNSELECT_CARD', { cards }), { index: null }));
    });

    it('invalid: index out of bounds', () => {
      expectErr(validateResponseData(prompt('SELECT_UNSELECT_CARD', { cards }), { index: 99 }), /out of bounds/);
    });
  });

  describe('SELECT_OPTION', () => {
    const options = [1, 2, 3]; // 3 options

    it('valid: index in bounds', () => {
      expectOk(validateResponseData(prompt('SELECT_OPTION', { options }), { index: 2 }));
    });

    it('invalid: index out of bounds', () => {
      expectErr(validateResponseData(prompt('SELECT_OPTION', { options }), { index: 3 }), /out of bounds/);
    });

    it('invalid: non-integer index', () => {
      expectErr(validateResponseData(prompt('SELECT_OPTION', { options }), { index: 'a' }), /out of bounds/);
    });
  });

  describe('SORT_CARD / SORT_CHAIN', () => {
    const cards = [{}, {}, {}]; // 3 cards

    it('valid: order is a permutation', () => {
      expectOk(validateResponseData(prompt('SORT_CARD', { cards }), { order: [2, 0, 1] }));
    });

    it('valid: order null = auto-sort', () => {
      expectOk(validateResponseData(prompt('SORT_CARD', { cards }), { order: null }));
    });

    it('invalid: order length mismatch', () => {
      expectErr(validateResponseData(prompt('SORT_CARD', { cards }), { order: [0, 1] }), /order length 2/);
    });

    it('invalid: order out of bounds', () => {
      expectErr(validateResponseData(prompt('SORT_CARD', { cards }), { order: [0, 1, 5] }), /out of bounds/);
    });

    it('invalid: duplicate values', () => {
      expectErr(validateResponseData(prompt('SORT_CARD', { cards }), { order: [0, 0, 1] }), /duplicate order value/);
    });

    it('SORT_CHAIN: same rules', () => {
      expectOk(validateResponseData(prompt('SORT_CHAIN', { cards }), { order: [2, 1, 0] }));
    });
  });

  describe('SELECT_COUNTER', () => {
    const cards = [{}, {}]; // 2 sources

    it('valid: counts sum matches required total', () => {
      expectOk(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 3 }), { counts: [1, 2] }));
    });

    it('invalid: counts not an array', () => {
      expectErr(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 3 }), { counts: 'foo' }), /must be an array/);
    });

    it('invalid: counts length mismatch', () => {
      expectErr(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 3 }), { counts: [3] }), /counts length/);
    });

    it('invalid: negative count value', () => {
      expectErr(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 3 }), { counts: [-1, 4] }), /invalid count value/);
    });

    it('invalid: counts sum != required', () => {
      expectErr(validateResponseData(prompt('SELECT_COUNTER', { cards, count: 5 }), { counts: [1, 2] }), /counts sum 3 !== required 5/);
    });
  });

  describe('SELECT_POSITION', () => {
    it('valid: position in allowed set', () => {
      expectOk(validateResponseData(prompt('SELECT_POSITION', { positions: [1, 4] }), { position: 1 }));
    });

    it('valid: no positions filter — any number ok', () => {
      expectOk(validateResponseData(prompt('SELECT_POSITION', {}), { position: 0x4 }));
    });

    it('invalid: position not a number', () => {
      expectErr(validateResponseData(prompt('SELECT_POSITION', {}), { position: 'foo' }), /must be a number/);
    });

    it('invalid: position not in allowed set', () => {
      expectErr(validateResponseData(prompt('SELECT_POSITION', { positions: [1, 4] }), { position: 8 }), /not in allowed set/);
    });
  });

  describe('SELECT_EFFECTYN / SELECT_YESNO', () => {
    it('SELECT_EFFECTYN valid: yes is boolean', () => {
      expectOk(validateResponseData(prompt('SELECT_EFFECTYN', {}), { yes: true }));
      expectOk(validateResponseData(prompt('SELECT_EFFECTYN', {}), { yes: false }));
    });

    it('SELECT_YESNO valid: yes is boolean', () => {
      expectOk(validateResponseData(prompt('SELECT_YESNO', {}), { yes: true }));
    });

    it('invalid: yes not a boolean', () => {
      expectErr(validateResponseData(prompt('SELECT_YESNO', {}), { yes: 1 }), /must be a boolean/);
    });
  });

  describe('SELECT_PLACE / SELECT_DISFIELD', () => {
    const allowed = [
      { player: 0, location: 4, sequence: 1 },
      { player: 0, location: 4, sequence: 2 },
    ];

    it('valid: place in allowed set', () => {
      expectOk(validateResponseData(prompt('SELECT_PLACE', { places: allowed, count: 1 }), { places: [{ player: 0, location: 4, sequence: 1 }] }));
    });

    it('invalid: places not an array', () => {
      expectErr(validateResponseData(prompt('SELECT_PLACE', { places: allowed }), { places: 'foo' }), /must be an array/);
    });

    it('invalid: places length mismatch', () => {
      expectErr(validateResponseData(prompt('SELECT_PLACE', { places: allowed, count: 2 }), { places: [{ player: 0, location: 4, sequence: 1 }] }), /places length 1/);
    });

    it('invalid: place not in allowed set', () => {
      expectErr(validateResponseData(prompt('SELECT_PLACE', { places: allowed, count: 1 }), { places: [{ player: 0, location: 4, sequence: 99 }] }), /not in allowed set/);
    });

    it('SELECT_DISFIELD: same rules', () => {
      expectOk(validateResponseData(prompt('SELECT_DISFIELD', { places: allowed, count: 1 }), { places: [{ player: 0, location: 4, sequence: 2 }] }));
    });
  });

  describe('ANNOUNCE_RACE / ANNOUNCE_ATTRIB', () => {
    it('ANNOUNCE_RACE valid: value is number', () => {
      expectOk(validateResponseData(prompt('ANNOUNCE_RACE', {}), { value: 0x40 }));
    });

    it('ANNOUNCE_ATTRIB valid: value is number', () => {
      expectOk(validateResponseData(prompt('ANNOUNCE_ATTRIB', {}), { value: 0x10 }));
    });

    it('invalid: value not a number', () => {
      expectErr(validateResponseData(prompt('ANNOUNCE_RACE', {}), { value: 'foo' }), /must be a number/);
    });
  });

  describe('ANNOUNCE_NUMBER', () => {
    it('valid: value is in options', () => {
      expectOk(validateResponseData(prompt('ANNOUNCE_NUMBER', { options: [3, 5, 7] }), { value: 5 }));
    });

    it('valid: no options filter', () => {
      expectOk(validateResponseData(prompt('ANNOUNCE_NUMBER', {}), { value: 42 }));
    });

    it('invalid: value not a number', () => {
      expectErr(validateResponseData(prompt('ANNOUNCE_NUMBER', {}), { value: 'foo' }), /must be a number/);
    });

    it('invalid: value not in options', () => {
      expectErr(validateResponseData(prompt('ANNOUNCE_NUMBER', { options: [3, 5, 7] }), { value: 4 }), /not in options/);
    });
  });

  describe('SELECT_BATTLECMD / SELECT_IDLECMD', () => {
    it('SELECT_IDLECMD valid: action is string', () => {
      expectOk(validateResponseData(prompt('SELECT_IDLECMD', {}), { action: 'pass' }));
    });

    it('SELECT_IDLECMD valid: action is number', () => {
      expectOk(validateResponseData(prompt('SELECT_IDLECMD', {}), { action: 7 }));
    });

    it('SELECT_BATTLECMD valid: action is string or number', () => {
      expectOk(validateResponseData(prompt('SELECT_BATTLECMD', {}), { action: 'attack' }));
      expectOk(validateResponseData(prompt('SELECT_BATTLECMD', {}), { action: 1 }));
    });

    it('invalid: action is neither', () => {
      expectErr(validateResponseData(prompt('SELECT_IDLECMD', {}), { action: true }), /must be string or number/);
    });
  });

  describe('Unknown / unhandled types', () => {
    it('returns ok for unknown prompt type (passthrough)', () => {
      // Default branch — validation skipped for non-prompt types like BOARD_STATE, MSG_*, etc.
      expectOk(validateResponseData(prompt('BOARD_STATE', {}), {}));
    });
  });
});
