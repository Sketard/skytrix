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
import { OcgMessageType } from '@n1xx1/ocgcore-wasm';
import type { OcgMessage } from '@n1xx1/ocgcore-wasm';
import {
  transformBattle,
  transformBecomeTarget,
  transformEquip,
  transformShuffleSetCard,
  transformHint,
  transformResponse,
  transformMessage,
  transformMove,
  type LookupContext,
  type OcgContext,
} from './ocg-message-transforms.js';
import type { DuelLogger } from './logger.js';
import { LOCATION } from './ws-protocol.js';

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
    // Reviewfix B1 — `getCardName` is now part of the contract. Tests inject
    // the same `nameFn` so the assertions on cardName resolution still pass.
    getCardName: nameFn,
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

// =============================================================================
// transformMessage (CHAINING) — F9-bis handCopiesAtChaining propagation
// =============================================================================

describe('transformMessage (CHAINING — F9-bis handCopiesAtChaining)', () => {
  const noOcg: OcgContext = { core: () => null, duel: () => null };

  function makeChainingMsg(overrides: Partial<{ code: number; controller: 0 | 1; location: number; sequence: number; chain_size: number; description: bigint | number }> = {}): OcgMessage {
    return {
      type: OcgMessageType.CHAINING,
      code: 1498449,
      controller: 0,
      location: LOCATION.HAND as number,
      sequence: 3,
      chain_size: 3,
      description: 0n,
      ...overrides,
    } as unknown as OcgMessage;
  }

  it('emits handCopiesAtChaining when activation comes from HAND + counts provided', () => {
    const { lookup } = makeMockLookup();
    const handCounts = [new Map([[1498449, 2]]), new Map<number, number>()];
    const out = transformMessage(
      makeChainingMsg({ code: 1498449, controller: 0, location: LOCATION.HAND as number, chain_size: 3 }),
      noOcg, lookup, false, undefined, undefined, handCounts,
    ) as { type: string; handCopiesAtChaining?: number; chainIndex: number; location: number };
    expect(out.type).toBe('MSG_CHAINING');
    expect(out.handCopiesAtChaining).toBe(2);
    expect(out.chainIndex).toBe(2); // chain_size - 1
    expect(out.location).toBe(LOCATION.HAND);
  });

  it('reads the count from the controller\'s map (player isolation)', () => {
    const { lookup } = makeMockLookup();
    const handCounts = [
      new Map([[100, 1]]),      // P0 has 1 copy of code 100
      new Map([[100, 3]]),      // P1 has 3 copies of code 100
    ];
    const outP0 = transformMessage(
      makeChainingMsg({ code: 100, controller: 0, location: LOCATION.HAND as number }),
      noOcg, lookup, false, undefined, undefined, handCounts,
    ) as { handCopiesAtChaining?: number };
    const outP1 = transformMessage(
      makeChainingMsg({ code: 100, controller: 1, location: LOCATION.HAND as number }),
      noOcg, lookup, false, undefined, undefined, handCounts,
    ) as { handCopiesAtChaining?: number };
    expect(outP0.handCopiesAtChaining).toBe(1);
    expect(outP1.handCopiesAtChaining).toBe(3);
  });

  it('OMITS handCopiesAtChaining when activation NOT from HAND (MZONE, SZONE, GY)', () => {
    const { lookup } = makeMockLookup();
    const handCounts = [new Map([[1498449, 2]]), new Map<number, number>()];
    for (const loc of [LOCATION.MZONE, LOCATION.SZONE, LOCATION.GRAVE, LOCATION.BANISHED] as number[]) {
      const out = transformMessage(
        makeChainingMsg({ code: 1498449, controller: 0, location: loc }),
        noOcg, lookup, false, undefined, undefined, handCounts,
      ) as { handCopiesAtChaining?: number };
      expect(out.handCopiesAtChaining).toBeUndefined();
    }
  });

  it('OMITS the field when handCountsPreBatch is not passed (legacy callers)', () => {
    const { lookup } = makeMockLookup();
    const out = transformMessage(
      makeChainingMsg({ code: 1498449, controller: 0, location: LOCATION.HAND as number }),
      noOcg, lookup, false, undefined, undefined, /* no handCounts */
    ) as { handCopiesAtChaining?: number };
    expect(out.handCopiesAtChaining).toBeUndefined();
  });

  it('OMITS the field when the cardCode is not in the snapshot (e.g. count=0)', () => {
    // Defensive: an unknown card-code in HAND maps to undefined → we omit
    // the field rather than ship `0` (which would mean "no copies expected"
    // and would force the front to skip every badge — wrong default).
    const { lookup } = makeMockLookup();
    const handCounts = [new Map<number, number>(), new Map<number, number>()];
    const out = transformMessage(
      makeChainingMsg({ code: 1498449, controller: 0, location: LOCATION.HAND as number }),
      noOcg, lookup, false, undefined, undefined, handCounts,
    ) as { handCopiesAtChaining?: number };
    expect(out.handCopiesAtChaining).toBeUndefined();
  });
});

describe('transformMove (XYZ overlay — overlay_sequence decoding)', () => {
  const noOcg: OcgContext = { core: () => null, duel: () => null };
  const loc = (over: Partial<{ controller: 0 | 1; location: number; sequence: number; position: number; overlay_sequence: number }>) =>
    ({ controller: 0 as 0 | 1, location: LOCATION.MZONE as number, sequence: 0, position: 1, ...over });

  it('attach: to.overlay_sequence present → toLocation OVERLAY + toOverlaySequence forwarded', () => {
    const { lookup } = makeMockLookup();
    const out = transformMove(
      // OCGCore emitted EXTRA|OVERLAY for an XYZ material; the binding stripped
      // the bit → location: EXTRA, overlay_sequence: 1. We must re-derive OVERLAY.
      { card: 67322708, from: loc({ location: LOCATION.MZONE as number, sequence: 0 }),
        to: loc({ location: LOCATION.EXTRA as number, sequence: 7, overlay_sequence: 1 }) },
      noOcg, lookup,
    ) as { toLocation: number; toSequence: number; toOverlaySequence?: number; fromLocation: number; toOverlayHostLocation?: number };
    expect(out.toLocation).toBe(LOCATION.OVERLAY);
    expect(out.toSequence).toBe(7); // host monster's sequence in its base zone
    expect(out.toOverlaySequence).toBe(1);
    expect(out.fromLocation).toBe(LOCATION.MZONE); // source untouched
    // host base zone EXTRA → a real XYZ summon the client should animate.
    expect(out.toOverlayHostLocation).toBe(LOCATION.EXTRA);
  });

  it('attach to an on-field host → toOverlayHostLocation MZONE (Rank-Up, no slide)', () => {
    const { lookup } = makeMockLookup();
    const out = transformMove(
      // Host already on the field: binding emits MZONE|OVERLAY → location: MZONE.
      { card: 67322708, from: loc({ location: LOCATION.HAND as number, sequence: 0 }),
        to: loc({ location: LOCATION.MZONE as number, sequence: 2, overlay_sequence: 0 }) },
      noOcg, lookup,
    ) as { toLocation: number; toOverlayHostLocation?: number };
    expect(out.toLocation).toBe(LOCATION.OVERLAY);
    expect(out.toOverlayHostLocation).toBe(LOCATION.MZONE);
  });

  it('detach: from.overlay_sequence present → fromLocation OVERLAY + fromOverlaySequence forwarded', () => {
    const { lookup } = makeMockLookup();
    const out = transformMove(
      { card: 67322708, from: loc({ location: LOCATION.MZONE as number, sequence: 2, overlay_sequence: 0 }),
        to: loc({ location: LOCATION.GRAVE as number, sequence: 0 }) },
      noOcg, lookup,
    ) as { fromLocation: number; fromOverlaySequence?: number; toLocation: number };
    expect(out.fromLocation).toBe(LOCATION.OVERLAY);
    expect(out.fromOverlaySequence).toBe(0);
    expect(out.toLocation).toBe(LOCATION.GRAVE);
  });

  it('plain move (no overlay_sequence) → locations untouched, no overlay fields', () => {
    const { lookup } = makeMockLookup();
    const out = transformMove(
      { card: 67322708, from: loc({ location: LOCATION.HAND as number, sequence: 0 }),
        to: loc({ location: LOCATION.MZONE as number, sequence: 1 }) },
      noOcg, lookup,
    ) as unknown as Record<string, unknown>;
    expect(out.fromLocation).toBe(LOCATION.HAND);
    expect(out.toLocation).toBe(LOCATION.MZONE);
    expect(out.fromOverlaySequence).toBeUndefined();
    expect(out.toOverlaySequence).toBeUndefined();
  });

  it('overlay_sequence === 0 is honored (falsy-but-present guard)', () => {
    const { lookup } = makeMockLookup();
    const out = transformMove(
      { card: 1, from: loc({ location: LOCATION.MZONE as number }),
        to: loc({ location: LOCATION.EXTRA as number, sequence: 3, overlay_sequence: 0 }) },
      noOcg, lookup,
    ) as { toLocation: number; toOverlaySequence?: number };
    expect(out.toLocation).toBe(LOCATION.OVERLAY);
    expect(out.toOverlaySequence).toBe(0);
  });
});
