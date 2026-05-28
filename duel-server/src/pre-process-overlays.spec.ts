import { describe, it, expect, vi } from 'vitest';
import { OcgQueryFlags } from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle } from '@n1xx1/ocgcore-wasm';
import {
  capturePreProcessOverlays,
  preProcessOverlayKey,
  readOverlayMaterialsForMove,
  buildSettlingSourceFifo,
  consumeSettlingSource,
} from './pre-process-overlays.js';
import { LOCATION } from './ws-protocol.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

interface DuelQueryLocationCall {
  flags: number;
  controller: 0 | 1;
  location: number;
}

/** Build a minimal OcgCoreSync stub that scripts the `duelQueryLocation`
 *  return value per (controller, location) call. The capture helper only
 *  reads `duelQueryLocation`; nothing else on the binding is touched. */
function makeMockCore(
  scriptedReturns: Map<string, unknown[]>,
  options: { throwOn?: { controller: 0 | 1; location: number } } = {},
): { core: OcgCoreSync; calls: DuelQueryLocationCall[] } {
  const calls: DuelQueryLocationCall[] = [];
  const duelQueryLocation = vi.fn((_handle: OcgDuelHandle, query: { flags: number; controller: 0 | 1; location: number }) => {
    calls.push({ flags: query.flags, controller: query.controller, location: query.location });
    if (
      options.throwOn &&
      options.throwOn.controller === query.controller &&
      options.throwOn.location === query.location
    ) {
      throw new Error('binding crashed');
    }
    const key = `${query.controller}-${query.location}`;
    return (scriptedReturns.get(key) ?? []) as never;
  });
  const core = {
    duelQueryLocation,
  } as unknown as OcgCoreSync;
  return { core, calls };
}

const DUEL_HANDLE = {} as OcgDuelHandle;

// ─── preProcessOverlayKey ─────────────────────────────────────────────────

describe('preProcessOverlayKey', () => {
  it('builds the controller-sequence key string', () => {
    expect(preProcessOverlayKey(0, 0)).toBe('0-0');
    expect(preProcessOverlayKey(0, 5)).toBe('0-5');
    expect(preProcessOverlayKey(1, 6)).toBe('1-6');
  });
});

// ─── readOverlayMaterialsForMove ──────────────────────────────────────────

describe('readOverlayMaterialsForMove (transformMove logic)', () => {
  const MZONE = LOCATION.MZONE as number;

  // T-B1 — no snapshot → undefined (back-compat caller).
  it('T-B1: returns undefined when snapshot is absent', () => {
    const result = readOverlayMaterialsForMove(undefined, MZONE, 0, 0, MZONE);
    expect(result).toBeUndefined();
  });

  // T-B2 — snapshot has a matching entry → return the captured codes.
  it('T-B2: returns captured codes when snapshot has a matching MZONE entry', () => {
    const snapshot = new Map<`${0 | 1}-${number}`, number[]>([['0-0', [12345, 67890]]]);
    const result = readOverlayMaterialsForMove(snapshot, MZONE, 0, 0, MZONE);
    expect(result).toEqual([12345, 67890]);
  });

  // T-B3 — fromLocation !== MZONE (here HAND) → undefined (anti-leak).
  it('T-B3: returns undefined when fromLocation is not MZONE', () => {
    const snapshot = new Map<`${0 | 1}-${number}`, number[]>([['0-0', [12345]]]);
    const result = readOverlayMaterialsForMove(snapshot, LOCATION.HAND as number, 0, 0, MZONE);
    expect(result).toBeUndefined();
  });

  it('returns undefined when key is missing from the snapshot (XYZ-less slot)', () => {
    const snapshot = new Map<`${0 | 1}-${number}`, number[]>([['1-3', [555]]]);
    const result = readOverlayMaterialsForMove(snapshot, MZONE, 0, 0, MZONE);
    expect(result).toBeUndefined();
  });

  it('returns undefined when captured entry is an empty array', () => {
    // Defensive — capturePreProcessOverlays omits empty entries, but a buggy
    // direct insert into the Map should still degrade gracefully.
    const snapshot = new Map<`${0 | 1}-${number}`, number[]>([['0-0', []]]);
    const result = readOverlayMaterialsForMove(snapshot, MZONE, 0, 0, MZONE);
    expect(result).toBeUndefined();
  });

  it('matches separately per controller (EMZ shared slot)', () => {
    const snapshot = new Map<`${0 | 1}-${number}`, number[]>([
      ['0-5', [111]],
      ['1-5', [222]],
    ]);
    expect(readOverlayMaterialsForMove(snapshot, MZONE, 0, 5, MZONE)).toEqual([111]);
    expect(readOverlayMaterialsForMove(snapshot, MZONE, 1, 5, MZONE)).toEqual([222]);
  });
});

// ─── capturePreProcessOverlays ────────────────────────────────────────────

describe('capturePreProcessOverlays', () => {
  it('queries duelQueryLocation once per player with OVERLAY_CARD + MZONE', () => {
    const { core, calls } = makeMockCore(new Map());
    capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.flags).toBe(OcgQueryFlags.OVERLAY_CARD as number);
      expect(c.location).toBe(LOCATION.MZONE as number);
    }
    expect(new Set(calls.map(c => c.controller))).toEqual(new Set([0, 1]));
  });

  // T-B4 — no XYZ on the field → empty Map.
  it('T-B4: returns empty Map when no MZONE slot has overlay', () => {
    const scripted = new Map<string, unknown[]>([
      ['0-4', [null, null, null, null, null, null, null]],
      ['1-4', [null, null, null, null, null, null, null]],
    ]);
    const { core } = makeMockCore(scripted);
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(snapshot.size).toBe(0);
  });

  it('captures a single XYZ in MZONE-0 (camelCase binding)', () => {
    const scripted = new Map<string, unknown[]>([
      ['0-4', [{ overlayCards: [12345, 67890] }, null, null, null, null, null, null]],
      ['1-4', []],
    ]);
    const { core } = makeMockCore(scripted);
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(snapshot.get('0-0')).toEqual([12345, 67890]);
    expect(snapshot.size).toBe(1);
  });

  it('accepts snake_case binding (overlay_cards)', () => {
    const scripted = new Map<string, unknown[]>([
      ['0-4', [{ overlay_cards: [11111] }, null, null, null, null, null, null]],
      ['1-4', []],
    ]);
    const { core } = makeMockCore(scripted);
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(snapshot.get('0-0')).toEqual([11111]);
  });

  it('coerces bigint card codes to number', () => {
    const scripted = new Map<string, unknown[]>([
      ['0-4', [{ overlayCards: [BigInt(99999), 88888] }, null, null, null, null, null, null]],
      ['1-4', []],
    ]);
    const { core } = makeMockCore(scripted);
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(snapshot.get('0-0')).toEqual([99999, 88888]);
  });

  // T-B5 — capture EMZ slot 5 + 6 when an XYZ sits there (MR5).
  it('T-B5: captures EMZ slots (seq 5 + 6) when an XYZ sits there', () => {
    const scripted = new Map<string, unknown[]>([
      // P0 has nothing in main slots 0-4, then EMZ_L = XYZ, EMZ_R = nothing.
      ['0-4', [null, null, null, null, null, { overlayCards: [777, 888] }, null]],
      // P1 has an XYZ in EMZ_R (seq 6).
      ['1-4', [null, null, null, null, null, null, { overlayCards: [999] }]],
    ]);
    const { core } = makeMockCore(scripted);
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(snapshot.get('0-5')).toEqual([777, 888]);
    expect(snapshot.get('1-6')).toEqual([999]);
    expect(snapshot.size).toBe(2);
  });

  it('omits entries when overlayCards array is empty', () => {
    const scripted = new Map<string, unknown[]>([
      ['0-4', [{ overlayCards: [] }, null, null, null, null, null, null]],
      ['1-4', []],
    ]);
    const { core } = makeMockCore(scripted);
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(snapshot.size).toBe(0);
  });

  it('catches binding errors and logs a warn (graceful degradation)', () => {
    const warn = vi.fn();
    const scripted = new Map<string, unknown[]>([
      ['0-4', [{ overlayCards: [555] }, null, null, null, null, null, null]],
      // P1 throws — capture aborts in the middle.
      ['1-4', []],
    ]);
    const { core } = makeMockCore(scripted, { throwOn: { controller: 1, location: LOCATION.MZONE as number } });
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE, { warn });
    // P0 was captured before the P1 throw — the partial result survives.
    expect(snapshot.get('0-0')).toEqual([555]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not throw when no logger is provided and binding errors', () => {
    const scripted = new Map<string, unknown[]>([['0-4', []], ['1-4', []]]);
    const { core } = makeMockCore(scripted, { throwOn: { controller: 0, location: LOCATION.MZONE as number } });
    expect(() => capturePreProcessOverlays(core, DUEL_HANDLE)).not.toThrow();
  });

  it('skips non-array overlay fields (defensive against future binding changes)', () => {
    const scripted = new Map<string, unknown[]>([
      ['0-4', [{ overlayCards: 'not-an-array' }, null, null, null, null, null, null]],
      ['1-4', []],
    ]);
    const { core } = makeMockCore(scripted);
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(snapshot.size).toBe(0);
  });

  it('handles null entries inside the duelQueryLocation result (empty slots)', () => {
    const scripted = new Map<string, unknown[]>([
      ['0-4', [null, { overlayCards: [42] }, null, null, null, null, null]],
      ['1-4', []],
    ]);
    const { core } = makeMockCore(scripted);
    const snapshot = capturePreProcessOverlays(core, DUEL_HANDLE);
    expect(snapshot.get('0-1')).toEqual([42]);
    expect(snapshot.size).toBe(1);
  });

  // H7 post-review — the warn fires when MZONE returns an unexpected
  // slot count (binding pivot to dense, or some future MR6 layout).
  // Length-0 stays silent (legitimate empty / degraded path).
  it('H7: warns on unexpected MZONE cards.length (binding-change canary)', () => {
    const warn = vi.fn();
    const scripted = new Map<string, unknown[]>([
      // length 3 — neither 5 (pre-MR5) nor 7 (MR5).
      ['0-4', [{ overlayCards: [101] }, null, null]],
      ['1-4', []],
    ]);
    const { core } = makeMockCore(scripted);
    capturePreProcessOverlays(core, DUEL_HANDLE, { warn });
    expect(warn).toHaveBeenCalledOnce();
    const [msg, data] = warn.mock.calls[0];
    expect(msg).toContain('unexpected MZONE cards.length');
    expect(data).toMatchObject({ player: 0, length: 3 });
  });

  it('H7: length-0 stays silent (degraded but valid)', () => {
    const warn = vi.fn();
    // Default empty fixture for both players.
    const { core } = makeMockCore(new Map());
    capturePreProcessOverlays(core, DUEL_HANDLE, { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

// ─── buildSettlingSourceFifo + consumeSettlingSource (B3) ───────────────────

describe('buildSettlingSourceFifo (B3)', () => {
  it('builds an empty FIFO from an empty snapshot', () => {
    const fifo = buildSettlingSourceFifo(new Map());
    expect(fifo.size).toBe(0);
  });

  it('groups cardCodes from one XYZ into the same source seq entry', () => {
    const snapshot = new Map<`${0 | 1}-${number}`, number[]>([
      ['0-3', [101, 202]],
    ]);
    const fifo = buildSettlingSourceFifo(snapshot);
    expect(fifo.get(101)).toEqual([3]);
    expect(fifo.get(202)).toEqual([3]);
    expect(fifo.size).toBe(2);
  });

  it('aggregates per cardCode across multiple XYZ source seqs (B3 case)', () => {
    // Two XYZ at seq 3 and seq 4 sharing cardCode 101 — the FIFO holds
    // [3, 4] for that cardCode so consumeSettlingSource can pop them
    // in order.
    const snapshot = new Map<`${0 | 1}-${number}`, number[]>([
      ['0-3', [101]],
      ['0-4', [101]],
    ]);
    const fifo = buildSettlingSourceFifo(snapshot);
    expect(fifo.get(101)).toEqual([3, 4]);
  });

  it('preserves snapshot iteration order (Map insertion order)', () => {
    // Build the snapshot in a non-sorted-seq order to ensure the FIFO
    // follows insertion order rather than sorting on the seq value.
    const snapshot = new Map<`${0 | 1}-${number}`, number[]>([
      ['0-5', [42]],
      ['0-2', [42]],
      ['1-0', [42]],
    ]);
    const fifo = buildSettlingSourceFifo(snapshot);
    expect(fifo.get(42)).toEqual([5, 2, 0]);
  });
});

describe('consumeSettlingSource (B3)', () => {
  it('returns undefined for unknown cardCode', () => {
    const fifo = new Map<number, number[]>();
    expect(consumeSettlingSource(fifo, 999)).toBeUndefined();
  });

  it('returns undefined for empty list (all sources already consumed)', () => {
    const fifo = new Map<number, number[]>([[101, []]]);
    expect(consumeSettlingSource(fifo, 101)).toBeUndefined();
  });

  it('pops the head and mutates the list in place', () => {
    const fifo = new Map<number, number[]>([[101, [3, 4]]]);
    expect(consumeSettlingSource(fifo, 101)).toBe(3);
    expect(fifo.get(101)).toEqual([4]);
    expect(consumeSettlingSource(fifo, 101)).toBe(4);
    expect(fifo.get(101)).toEqual([]);
    expect(consumeSettlingSource(fifo, 101)).toBeUndefined();
  });
});
