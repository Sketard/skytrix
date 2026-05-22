// =============================================================================
// effect-desc-resolver.spec.ts — unit coverage for resolveDescription.
// -----------------------------------------------------------------------------
// The packed `description` code decodes to [cardCode = code >> 20 |
// strIndex = code & 0xFFFFF]. Three resolution branches + one universal
// placeholder guard — one test per branch + the guard.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { resolveDescription } from './effect-desc-resolver.js';
import type { CardDB } from '../types.js';

// -----------------------------------------------------------------------------
// Fixture — a CardDB whose only used member is `descStmt.get`. The card-text
// table is a plain map keyed by card code; each row exposes str1..strN.
// -----------------------------------------------------------------------------
function fakeCardDb(texts: Record<number, Record<string, string>>): CardDB {
  return {
    descStmt: { get: (code: number) => texts[code] },
  } as unknown as CardDB;
}

/** Pack a `(cardCode, strIndex)` pair into a `description` code. */
function pack(cardCode: number, strIndex: number): number {
  return Number((BigInt(cardCode) << 20n) | BigInt(strIndex));
}

describe('resolveDescription', () => {
  it('resolves a card effect text (cardCode != 0)', () => {
    // strIndex 0 → str1 column.
    const db = fakeCardDb({ 12345: { str1: 'Special Summon 1 monster' } });
    const code = pack(12345, 0);
    expect(resolveDescription(code, db, new Map())).toBe(
      'Special Summon 1 monster',
    );
  });

  it('resolves an OCGCore system string (cardCode == 0, strIndex != 0)', () => {
    // system 1160 — the CAS A from the Lot 1b validation.
    const sys = new Map([[1160, 'Activate it as a Pendulum Spell']]);
    expect(resolveDescription(1160, fakeCardDb({}), sys)).toBe(
      'Activate it as a Pendulum Spell',
    );
  });

  it("returns '' for description 0 (no disambiguation needed — CAS B)", () => {
    // OCGCore emits 0 when no disambiguation string is needed; system 0 is
    // absent from strings.conf — a genuine void, not a missing lookup.
    expect(resolveDescription(0, fakeCardDb({}), new Map())).toBe('');
  });

  it("returns '' for a system string carrying an unsubstituted placeholder", () => {
    // The universal guard — a `%ls` / `%d` cannot be filled without the engine
    // argument list; the resolver must never propagate it to the renderer.
    const sys = new Map([
      [200, 'Add %ls to your hand'],
      [201, 'Draw %d cards'],
    ]);
    expect(resolveDescription(200, fakeCardDb({}), sys)).toBe('');
    expect(resolveDescription(201, fakeCardDb({}), sys)).toBe('');
  });

  it("returns '' for a card text carrying an unsubstituted placeholder", () => {
    // The guard is universal — it covers card texts too, not just system ones.
    const db = fakeCardDb({ 999: { str1: 'Target 1 %ls; destroy it' } });
    expect(resolveDescription(pack(999, 0), db, new Map())).toBe('');
  });

  it("returns '' for an unknown card code", () => {
    expect(resolveDescription(pack(404, 0), fakeCardDb({}), new Map())).toBe('');
  });

  it("returns '' for an unknown system string index", () => {
    expect(resolveDescription(7777, fakeCardDb({}), new Map())).toBe('');
  });
});
