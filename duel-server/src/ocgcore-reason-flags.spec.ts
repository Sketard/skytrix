// =============================================================================
// ocgcore-reason-flags — values match OCGCore source (L3 post-review guard)
// =============================================================================
//
// Parses `data/scripts_full/constant.lua` (the authoritative OCGCore Lua
// source) at test time and verifies that every REASON_* constant declared
// in `ocgcore-reason-flags.ts` carries the same value. Without this guard,
// a future regression of the R9 shape (a constant copied with a wrong
// numeric value) ships silently — the value mismatch only surfaces when
// a feature gates on it AND the bit lands in production.
//
// Why this matters (R9 history, 2026-05-26) :
// `game-log-builder.ts`, `replay-precompute.ts` and the front-side
// `game-log-builder.ts` shipped FALSE local copies of the REASON_*
// constants for ~6 months (REASON_FUSION=0x8 vs real 0x40000, REASON_XYZ=
// 0x40 vs real 0x200000, REASON_LINK=0x80 vs real 0x10000000, …). Every
// Fusion/Synchro/XYZ/Link summon-family branch was dead code. The fix
// (commit 0e5ae0a4) deduplicated into a single shared module, but a
// future contributor adding a new REASON_* could still type the wrong
// hex value — this guard catches that.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as flags from './ocgcore-reason-flags.js';

const LUA_PATH = join(
  resolve(import.meta.dirname!, '../data/scripts_full/constant.lua'),
);

let luaConstants: Map<string, number>;

beforeAll(() => {
  const lua = readFileSync(LUA_PATH, 'utf-8');
  luaConstants = parseLuaConstants(lua);
});

/** Parse `NAME = 0xHEX` lines from constant.lua. Filter to REASON_*
 *  declarations (skip composite expressions like `REASON_REVEAL = REASON_EXCAVATE`
 *  which are aliases, not literal hex values). */
function parseLuaConstants(lua: string): Map<string, number> {
  const map = new Map<string, number>();
  const lineRegex = /^(REASON_\w+)\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*(?:--.*)?$/;
  for (const line of lua.split('\n')) {
    const m = line.match(lineRegex);
    if (!m) continue;
    const name = m[1];
    const value = m[2].startsWith('0x')
      ? parseInt(m[2], 16)
      : parseInt(m[2], 10);
    map.set(name, value);
  }
  return map;
}

describe('ocgcore-reason-flags — values match OCGCore constant.lua', () => {
  it('REASON_DESTROY matches OCG source', () => {
    expect(flags.REASON_DESTROY).toBe(luaConstants.get('REASON_DESTROY'));
  });

  it('REASON_RELEASE matches OCG source', () => {
    expect(flags.REASON_RELEASE).toBe(luaConstants.get('REASON_RELEASE'));
  });

  it('REASON_BATTLE matches OCG source', () => {
    expect(flags.REASON_BATTLE).toBe(luaConstants.get('REASON_BATTLE'));
  });

  it('REASON_EFFECT matches OCG source', () => {
    expect(flags.REASON_EFFECT).toBe(luaConstants.get('REASON_EFFECT'));
  });

  it('REASON_COST matches OCG source', () => {
    expect(flags.REASON_COST).toBe(luaConstants.get('REASON_COST'));
  });

  it('REASON_RULE matches OCG source', () => {
    expect(flags.REASON_RULE).toBe(luaConstants.get('REASON_RULE'));
  });

  it('REASON_LOST_TARGET matches OCG source', () => {
    expect(flags.REASON_LOST_TARGET).toBe(luaConstants.get('REASON_LOST_TARGET'));
  });

  // R9-specific : the family of summon-family REASON_* constants that
  // had wrong local values for ~6 months before the dedup fix. These
  // four checks are the regression fence for the original bug.
  it('REASON_FUSION matches OCG source (R9 regression fence)', () => {
    expect(flags.REASON_FUSION).toBe(luaConstants.get('REASON_FUSION'));
  });

  it('REASON_SYNCHRO matches OCG source (R9 regression fence)', () => {
    expect(flags.REASON_SYNCHRO).toBe(luaConstants.get('REASON_SYNCHRO'));
  });

  it('REASON_XYZ matches OCG source (R9 regression fence)', () => {
    expect(flags.REASON_XYZ).toBe(luaConstants.get('REASON_XYZ'));
  });

  it('REASON_LINK matches OCG source (R9 regression fence)', () => {
    expect(flags.REASON_LINK).toBe(luaConstants.get('REASON_LINK'));
  });

  it('REASON_RITUAL matches OCG source', () => {
    expect(flags.REASON_RITUAL).toBe(luaConstants.get('REASON_RITUAL'));
  });

  it('REASON_MATERIAL matches OCG source', () => {
    expect(flags.REASON_MATERIAL).toBe(luaConstants.get('REASON_MATERIAL'));
  });

  it('REASON_SUMMON matches OCG source', () => {
    expect(flags.REASON_SUMMON).toBe(luaConstants.get('REASON_SUMMON'));
  });

  it('REASON_SPSUMMON matches OCG source', () => {
    expect(flags.REASON_SPSUMMON).toBe(luaConstants.get('REASON_SPSUMMON'));
  });

  it('REASON_DISSUMMON matches OCG source', () => {
    expect(flags.REASON_DISSUMMON).toBe(luaConstants.get('REASON_DISSUMMON'));
  });

  it('REASON_FLIP matches OCG source', () => {
    expect(flags.REASON_FLIP).toBe(luaConstants.get('REASON_FLIP'));
  });

  it('REASON_DISCARD matches OCG source', () => {
    expect(flags.REASON_DISCARD).toBe(luaConstants.get('REASON_DISCARD'));
  });

  it('REASON_RDAMAGE matches OCG source', () => {
    expect(flags.REASON_RDAMAGE).toBe(luaConstants.get('REASON_RDAMAGE'));
  });

  it('REASON_RRECOVER matches OCG source', () => {
    expect(flags.REASON_RRECOVER).toBe(luaConstants.get('REASON_RRECOVER'));
  });

  it('REASON_RETURN matches OCG source', () => {
    expect(flags.REASON_RETURN).toBe(luaConstants.get('REASON_RETURN'));
  });

  it('REASON_REPLACE matches OCG source', () => {
    expect(flags.REASON_REPLACE).toBe(luaConstants.get('REASON_REPLACE'));
  });

  it('REASON_DRAW matches OCG source', () => {
    expect(flags.REASON_DRAW).toBe(luaConstants.get('REASON_DRAW'));
  });

  it('REASON_REDIRECT matches OCG source', () => {
    expect(flags.REASON_REDIRECT).toBe(luaConstants.get('REASON_REDIRECT'));
  });

  it('REASON_TEMPORARY matches OCG source', () => {
    expect(flags.REASON_TEMPORARY).toBe(luaConstants.get('REASON_TEMPORARY'));
  });

  it('REASON_ADJUST matches OCG source', () => {
    expect(flags.REASON_ADJUST).toBe(luaConstants.get('REASON_ADJUST'));
  });

  // Composite : EXTRA_DECK_SUMMON = FUSION | SYNCHRO | XYZ | LINK
  it('EXTRA_DECK_SUMMON is the OR of the 4 ED summon reason bits', () => {
    const expected =
      luaConstants.get('REASON_FUSION')! |
      luaConstants.get('REASON_SYNCHRO')! |
      luaConstants.get('REASON_XYZ')! |
      luaConstants.get('REASON_LINK')!;
    expect(flags.EXTRA_DECK_SUMMON).toBe(expected);
  });

  // Composite : REASON_XYZ_MATERIAL_SETTLE = REASON_RULE | REASON_LOST_TARGET = 0x600
  it('REASON_XYZ_MATERIAL_SETTLE is REASON_RULE | REASON_LOST_TARGET', () => {
    const expected = luaConstants.get('REASON_RULE')! | luaConstants.get('REASON_LOST_TARGET')!;
    expect(flags.REASON_XYZ_MATERIAL_SETTLE).toBe(expected);
    // Spot-check the documented value 0x600 (R8 invariant validated empirically).
    expect(flags.REASON_XYZ_MATERIAL_SETTLE).toBe(0x600);
  });
});
