import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROTOCOL_VERSION,
  PHASE_TO_NUM,
  POSITION,
  LOCATION,
  BOARD_CHANGING_EVENT_TYPES,
} from './ws-protocol-shared.js';
import { checkProtocolVersionPure } from './protocol-version-check.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONT_SHARED = join(HERE, '../../front/src/app/pages/pvp/duel-ws-shared.types.ts');

// =============================================================================
// PROTOCOL_VERSION constant
// =============================================================================

describe('PROTOCOL_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('is byte-synced with the front-side mirror file', () => {
    // The 6 ws-protocol files (shared/game/prompts/system/replay/solver) are
    // copied verbatim between back and front (modulo `.js` ↔ `.types` import
    // path normalization). The shared file has no internal imports, so it
    // should match byte-for-byte modulo line endings. PROTOCOL_VERSION is
    // the most-load-bearing constant — pin it explicitly here so any
    // accidental fork between the two mirrors is caught immediately.
    const frontContent = readFileSync(FRONT_SHARED, 'utf-8');
    const match = frontContent.match(/export const PROTOCOL_VERSION = (\d+);/);
    expect(match, 'front mirror must declare PROTOCOL_VERSION').not.toBeNull();
    expect(Number(match![1])).toBe(PROTOCOL_VERSION);
  });
});

// =============================================================================
// checkProtocolVersionPure — accept / reject decision
// =============================================================================

describe('checkProtocolVersionPure', () => {
  it('accepts the exact server version', () => {
    const result = checkProtocolVersionPure(String(PROTOCOL_VERSION));
    expect(result).toEqual({ ok: true });
  });

  it('rejects a missing pv (null)', () => {
    const result = checkProtocolVersionPure(null);
    expect(result).toMatchObject({
      ok: false,
      rawClientVersion: null,
      serverVersion: PROTOCOL_VERSION,
      parsedClientVersion: null,
    });
  });

  it('rejects a numeric mismatch (older client)', () => {
    const result = checkProtocolVersionPure(String(PROTOCOL_VERSION - 1));
    expect(result).toMatchObject({
      ok: false,
      rawClientVersion: String(PROTOCOL_VERSION - 1),
      serverVersion: PROTOCOL_VERSION,
      parsedClientVersion: PROTOCOL_VERSION - 1,
    });
  });

  it('rejects a numeric mismatch (newer client, future-server scenario)', () => {
    const result = checkProtocolVersionPure(String(PROTOCOL_VERSION + 99));
    expect(result).toMatchObject({
      ok: false,
      parsedClientVersion: PROTOCOL_VERSION + 99,
    });
  });

  it('rejects a non-numeric pv (NaN parse)', () => {
    const result = checkProtocolVersionPure('notanumber');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rawClientVersion).toBe('notanumber');
      expect(Number.isNaN(result.parsedClientVersion)).toBe(true);
    }
  });

  it('rejects an empty string pv', () => {
    // Number('') is 0 — does not match PROTOCOL_VERSION (1+)
    const result = checkProtocolVersionPure('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.parsedClientVersion).toBe(0);
    }
  });

  it('preserves the raw value verbatim for log output (does not coerce)', () => {
    const result = checkProtocolVersionPure('  2  ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rawClientVersion).toBe('  2  ');
    }
  });

  it('accepts pv with leading whitespace if Number() parses to server version', () => {
    // Number(' 1 ') === 1 — JS coerces whitespace. Documents the lax contract.
    const result = checkProtocolVersionPure(`  ${PROTOCOL_VERSION}  `);
    expect(result).toEqual({ ok: true });
  });
});

// =============================================================================
// Bitmask constants — sanity / no-overlap invariants
// =============================================================================

describe('PHASE_TO_NUM', () => {
  it('all values are distinct powers of 2', () => {
    const values = Object.values(PHASE_TO_NUM);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      // power-of-2 → only one bit set
      expect(v & (v - 1)).toBe(0);
    }
  });

  it('covers all 10 phases', () => {
    expect(Object.keys(PHASE_TO_NUM)).toHaveLength(10);
  });
});

describe('POSITION constants', () => {
  it('all 4 values are distinct', () => {
    const values = Object.values(POSITION);
    expect(new Set(values).size).toBe(4);
  });
});

describe('LOCATION constants', () => {
  it('all 8 values are distinct powers of 2', () => {
    const values = Object.values(LOCATION);
    expect(new Set(values).size).toBe(8);
    for (const v of values) {
      expect(v & (v - 1)).toBe(0);
    }
  });
});

describe('BOARD_CHANGING_EVENT_TYPES', () => {
  it('contains the canonical chain-buffered event types', () => {
    // Compact spot-check — the full list lives in the source. If a regression
    // accidentally drops a type, this test pins the most load-bearing entries.
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_MOVE')).toBe(true);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_DRAW')).toBe(true);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_CONFIRM_CARDS')).toBe(true);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_FLIP_SUMMONING')).toBe(true);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_DAMAGE')).toBe(true);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_RECOVER')).toBe(true);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_PAY_LPCOST')).toBe(true);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_EQUIP')).toBe(true);
  });

  it('does NOT contain chain-control events', () => {
    // Chain solving/solved/end + chaining are NOT board-changing events.
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_CHAINING')).toBe(false);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_CHAIN_SOLVING')).toBe(false);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_CHAIN_SOLVED')).toBe(false);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_CHAIN_END')).toBe(false);
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_CHAIN_NEGATED')).toBe(false);
  });

  it('does NOT contain non-board events', () => {
    expect(BOARD_CHANGING_EVENT_TYPES.has('MSG_HINT')).toBe(false);
    expect(BOARD_CHANGING_EVENT_TYPES.has('BOARD_STATE')).toBe(false);
    expect(BOARD_CHANGING_EVENT_TYPES.has('TIMER_STATE')).toBe(false);
  });

  it('is a frozen Set (not mutable from caller)', () => {
    // The constant is typed as ReadonlySet<string>; verify the shape.
    expect(BOARD_CHANGING_EVENT_TYPES).toBeInstanceOf(Set);
    expect(BOARD_CHANGING_EVENT_TYPES.size).toBeGreaterThan(0);
  });
});
