/**
 * U4 (audit-4-modes-2026-06-01) — unit tests for the OCG message transforms
 * extracted from `duel-worker.ts`.
 *
 * These tests demonstrate the promise of the extraction : transforms can
 * now be unit-tested WITHOUT booting the worker thread + OCGCore WASM.
 *
 * Coverage philosophy : pin one representative test per coupling tier —
 *   - 4 pure transforms (Battle / BecomeTarget / Equip / ShuffleSetCard) :
 *     1 test each, walks the OcgMessage payload only.
 *   - 1 lookup-coupled transform (Hint) via a mocked LookupContext.
 *   - 1 inverse-direction `transformResponse` (ANNOUNCE_NUMBER) — the
 *     option-index round-trip the worker relies on for SELECT_NUMBER UX.
 *
 * The dispatcher `transformMessage` and the 13 other transforms remain
 * exercised by their existing integration sites (replay-precompute.spec.ts +
 * runDuelLoop end-to-end specs). The unit pinning here is the proof of
 * extractability, not a substitute for end-to-end coverage.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  transformBattle,
  transformBecomeTarget,
  transformEquip,
  transformShuffleSetCard,
  transformHint,
  transformResponse,
  type LookupContext,
} from './ocg-message-transforms.js';
import type { DuelLogger } from './logger.js';

// =============================================================================
// Helpers
// =============================================================================

function makeMockLookup(opts: {
  cardName?: (code: number) => string;
  systemStrings?: Map<number, string>;
  lastAnnounceNumberOptions?: number[];
} = {}): { lookup: LookupContext; dlog: DuelLogger } {
  const dlog: DuelLogger = {
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const nameFn = opts.cardName ?? ((code) => `Card${code}`);
  const lookup: LookupContext = {
    cardDb: () => ({
      nameStmt: { get: (code: number) => ({ name: nameFn(code) }) },
    } as unknown as import('./types.js').CardDB),
    systemStrings: () => opts.systemStrings ?? new Map(),
    dlog: () => dlog,
    isTokenCard: () => false,
    setLastAnnounceNumberOptions: () => {},
    getLastAnnounceNumberOptions: () => opts.lastAnnounceNumberOptions ?? [],
  };
  return { lookup, dlog };
}

// =============================================================================
// Pure transforms (no context)
// =============================================================================

describe('transformBattle (pure)', () => {
  it('returns null on direct attack (no target)', () => {
    expect(transformBattle({ card: {}, target: null })).toBeNull();
    expect(transformBattle({ card: {} })).toBeNull();
  });

  it('emits attacker + defender atk/def, picks DEF when target is in defense position', () => {
    const msg = {
      card: { controller: 0, sequence: 2, attack: 2500 },
      target: { controller: 1, sequence: 3, attack: 1800, defense: 2100, position: 0x4 }, // FACEUP_DEFENSE
    };
    const out = transformBattle(msg) as any;
    expect(out.type).toBe('MSG_BATTLE');
    expect(out.attackerPlayer).toBe(0);
    expect(out.attackerSequence).toBe(2);
    expect(out.attackerDamage).toBe(2500);
    expect(out.defenderPlayer).toBe(1);
    expect(out.defenderDamage).toBe(2100); // defense used because target in def-pos
  });

  it('uses ATK when target is in attack position', () => {
    const msg = {
      card: { controller: 0, sequence: 0, attack: 1900 },
      target: { controller: 1, sequence: 1, attack: 1500, defense: 800, position: 0x1 }, // FACEUP_ATTACK
    };
    const out = transformBattle(msg) as any;
    expect(out.defenderDamage).toBe(1500); // attack used because target in atk-pos
  });
});

describe('transformBecomeTarget (pure)', () => {
  it('maps OCGCore cards array to {player, location, sequence}', () => {
    const msg = {
      cards: [
        { controller: 0, location: 4 /* MZONE */, sequence: 0 },
        { controller: 1, location: 8 /* SZONE */, sequence: 2 },
      ],
    };
    const out = transformBecomeTarget(msg) as any;
    expect(out.type).toBe('MSG_BECOME_TARGET');
    expect(out.cards).toEqual([
      { player: 0, location: 4, sequence: 0 },
      { player: 1, location: 8, sequence: 2 },
    ]);
  });
});

describe('transformEquip (pure)', () => {
  it('captures equip + target controller/location/sequence verbatim', () => {
    const msg = {
      card: { controller: 0, location: 8, sequence: 1 },
      target: { controller: 1, location: 4, sequence: 3 },
    };
    const out = transformEquip(msg) as any;
    expect(out.type).toBe('MSG_EQUIP');
    expect(out.equipPlayer).toBe(0);
    expect(out.equipLocation).toBe(8);
    expect(out.equipSequence).toBe(1);
    expect(out.targetPlayer).toBe(1);
    expect(out.targetLocation).toBe(4);
    expect(out.targetSequence).toBe(3);
  });
});

describe('transformShuffleSetCard (pure)', () => {
  it('maps each from/to pair preserving location', () => {
    const msg = {
      cards: [
        { from: { controller: 0, location: 8, sequence: 0 }, to: { controller: 0, sequence: 2 } },
        { from: { controller: 0, location: 8, sequence: 1 }, to: { controller: 0, sequence: 0 } },
      ],
    };
    const out = transformShuffleSetCard(msg) as any;
    expect(out.type).toBe('MSG_SHUFFLE_SET_CARD');
    expect(out.cards).toEqual([
      { fromPlayer: 0, fromSequence: 0, toPlayer: 0, toSequence: 2, location: 8 },
      { fromPlayer: 0, fromSequence: 1, toPlayer: 0, toSequence: 0, location: 8 },
    ]);
  });
});

// =============================================================================
// Lookup-coupled transform (Hint)
// =============================================================================

describe('transformHint (lookup-coupled)', () => {
  it('resolves cardName for HINT_CARD (hintType 10) via the cardDb lookup', () => {
    const { lookup } = makeMockLookup({ cardName: (c) => c === 12345 ? 'Maxx C' : '' });
    const msg = { hint_type: 10, hint: 12345, player: 0 };
    const out = transformHint(msg, lookup) as any;
    expect(out.type).toBe('MSG_HINT');
    expect(out.hintType).toBe(10);
    expect(out.value).toBe(12345);
    expect(out.cardName).toBe('Maxx C');
    expect(out.player).toBe(0);
  });

  it('returns empty cardName for HINT_SELECTMSG (hintType 3) when value matches a system string', () => {
    const systemStrings = new Map([[1234, 'Choose a target']]);
    const { lookup } = makeMockLookup({ systemStrings });
    const msg = { hint_type: 3, hint: 1234, player: 1 };
    const out = transformHint(msg, lookup) as any;
    // Value is a system-string ID, so the cardName resolution skips
    expect(out.cardName).toBe('');
    expect(out.value).toBe(1234);
  });

  it('returns empty cardName for non-card hintTypes (e.g. type 1)', () => {
    const { lookup } = makeMockLookup();
    const out = transformHint({ hint_type: 1, hint: 99, player: 0 }, lookup) as any;
    expect(out.cardName).toBe('');
  });
});

// =============================================================================
// Inverse-direction transform (Response)
// =============================================================================

describe('transformResponse (lookup-coupled)', () => {
  it('SELECT_IDLECMD wraps action + index with OCGCore type 1', () => {
    const { lookup } = makeMockLookup();
    const out = transformResponse('SELECT_IDLECMD', { action: 2, index: 5 }, lookup) as any;
    expect(out).toEqual({ type: 1, action: 2, index: 5 });
  });

  it('ANNOUNCE_NUMBER resolves value → index via lookup.getLastAnnounceNumberOptions', () => {
    const { lookup } = makeMockLookup({ lastAnnounceNumberOptions: [10, 25, 50] });
    const out = transformResponse('ANNOUNCE_NUMBER', { value: 25 }, lookup) as any;
    expect(out).toEqual({ type: 19, value: 1 }); // index of 25 in [10,25,50]
  });

  it('ANNOUNCE_NUMBER falls back to raw value when not found in options', () => {
    const { lookup } = makeMockLookup({ lastAnnounceNumberOptions: [10, 25, 50] });
    const out = transformResponse('ANNOUNCE_NUMBER', { value: 99 }, lookup) as any;
    expect(out).toEqual({ type: 19, value: 99 }); // raw fallback
  });

  it('unknown promptType returns null + logs error via lookup.dlog', () => {
    const { lookup, dlog } = makeMockLookup();
    const out = transformResponse('NOT_A_PROMPT', {}, lookup);
    expect(out).toBeNull();
    expect(dlog.error).toHaveBeenCalledWith('Unknown promptType', { promptType: 'NOT_A_PROMPT' });
  });

  it('SELECT_CARD passes `indices` through OCGCore typo `indicies`', () => {
    const { lookup } = makeMockLookup();
    const out = transformResponse('SELECT_CARD', { indices: [0, 2] }, lookup) as any;
    expect(out).toEqual({ type: 5, indicies: [0, 2] });
  });
});
