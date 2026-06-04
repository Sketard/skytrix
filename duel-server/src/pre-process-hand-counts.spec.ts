import { describe, it, expect, vi } from 'vitest';
import { OcgQueryFlags } from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle } from '@n1xx1/ocgcore-wasm';
import { capturePreProcessHandCounts } from './pre-process-hand-counts.js';
import { LOCATION } from './ws-protocol.js';

interface QueryCall {
  flags: number;
  controller: 0 | 1;
  location: number;
}

/** Build a minimal OcgCoreSync stub for the capture helper. Returns the
 *  scripted card list per `(controller, location)` and records every call. */
function makeMockCore(
  scripted: Map<string, Array<{ code?: number } | null>>,
  options: { throwOn?: { controller: 0 | 1; location: number } } = {},
): { core: OcgCoreSync; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const duelQueryLocation = vi.fn((_handle: OcgDuelHandle, q: QueryCall) => {
    calls.push({ flags: q.flags, controller: q.controller, location: q.location });
    if (options.throwOn && options.throwOn.controller === q.controller && options.throwOn.location === q.location) {
      throw new Error('binding crashed');
    }
    const key = `${q.controller}-${q.location}`;
    return (scripted.get(key) ?? []) as never;
  });
  const core = { duelQueryLocation } as unknown as OcgCoreSync;
  return { core, calls };
}

const DUEL = {} as OcgDuelHandle;
const HAND = LOCATION.HAND as number;

describe('capturePreProcessHandCounts', () => {
  it('returns two empty maps when both hands are empty', () => {
    const { core } = makeMockCore(new Map());
    const result = capturePreProcessHandCounts(core, DUEL);
    expect(result.length).toBe(2);
    expect(result[0].size).toBe(0);
    expect(result[1].size).toBe(0);
  });

  it('queries HAND for both players with FLAG_CODE', () => {
    const { core, calls } = makeMockCore(new Map());
    capturePreProcessHandCounts(core, DUEL);
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual({ flags: OcgQueryFlags.CODE as number, controller: 0, location: HAND });
    expect(calls[1]).toEqual({ flags: OcgQueryFlags.CODE as number, controller: 1, location: HAND });
  });

  it('counts copies per cardCode in HAND-0', () => {
    const scripted = new Map<string, Array<{ code?: number } | null>>([
      ['0-' + HAND, [{ code: 100 }, { code: 200 }, { code: 100 }]],
    ]);
    const { core } = makeMockCore(scripted);
    const [p0] = capturePreProcessHandCounts(core, DUEL);
    expect(p0.get(100)).toBe(2);
    expect(p0.get(200)).toBe(1);
  });

  it('keeps player 0 and player 1 counts isolated', () => {
    const scripted = new Map<string, Array<{ code?: number } | null>>([
      ['0-' + HAND, [{ code: 100 }, { code: 100 }]],
      ['1-' + HAND, [{ code: 100 }, { code: 200 }, { code: 200 }]],
    ]);
    const { core } = makeMockCore(scripted);
    const [p0, p1] = capturePreProcessHandCounts(core, DUEL);
    expect(p0.get(100)).toBe(2);
    expect(p0.has(200)).toBe(false);
    expect(p1.get(100)).toBe(1);
    expect(p1.get(200)).toBe(2);
  });

  it('skips null entries (empty slots) and entries without a code', () => {
    const scripted = new Map<string, Array<{ code?: number } | null>>([
      ['0-' + HAND, [{ code: 100 }, null, {}, { code: 100 }]],
    ]);
    const { core } = makeMockCore(scripted);
    const [p0] = capturePreProcessHandCounts(core, DUEL);
    expect(p0.get(100)).toBe(2);
    expect(p0.size).toBe(1);
  });

  it('skips entries with code <= 0 (defensive against binding quirks)', () => {
    const scripted = new Map<string, Array<{ code?: number } | null>>([
      ['0-' + HAND, [{ code: 0 }, { code: -1 }, { code: 42 }]],
    ]);
    const { core } = makeMockCore(scripted);
    const [p0] = capturePreProcessHandCounts(core, DUEL);
    expect(p0.size).toBe(1);
    expect(p0.get(42)).toBe(1);
  });

  it('returns empty maps on binding throw + warns via logger (degradation contract)', () => {
    const logger = { warn: vi.fn() };
    const { core } = makeMockCore(new Map(), { throwOn: { controller: 0, location: HAND } });
    const result = capturePreProcessHandCounts(core, DUEL, logger);
    expect(result[0].size).toBe(0);
    expect(result[1].size).toBe(0);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('handles a hand of identical copies (triple) cleanly', () => {
    // Regression for the F9-bis discard scenario: 3 copies of the same
    // card, one activated then discarded — the counter at chaining time
    // must report 3 so the front can detect the discard via "current < 3".
    const scripted = new Map<string, Array<{ code?: number } | null>>([
      ['0-' + HAND, [{ code: 999 }, { code: 999 }, { code: 999 }]],
    ]);
    const { core } = makeMockCore(scripted);
    const [p0] = capturePreProcessHandCounts(core, DUEL);
    expect(p0.get(999)).toBe(3);
  });
});
