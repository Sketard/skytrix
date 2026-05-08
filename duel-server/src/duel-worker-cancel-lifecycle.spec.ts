// =============================================================================
// P0-3bis.4 — Smoke tests for cancel lifecycle gating
// =============================================================================
//
// Validates the three guards introduced in this story:
//   - Test A: chain interlock (tryCancelRollback rejects when chainResolving)
//   - Test B: TTL drops the snapshot after SNAPSHOT_TTL_MS
//   - Test C: replacing a snapshot cancels the old timer (no spurious expiry)
//
// `duel-worker.ts` cannot be imported from a non-worker context (it
// throws at module load if `parentPort` is missing). Tests B and C
// replicate the `setLastIdleSnapshot` logic locally — the production
// helper is small (~10 lines) so the duplication risk is low.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Phase, Player } from './ws-protocol.js';
import { tryCancelRollback, type WorkerSnapshot } from './wasm-snapshot-wrapper.js';

// -----------------------------------------------------------------------------
// Test A — chain interlock (pure, no fixture)
// -----------------------------------------------------------------------------

function makeFakeSnapshot(player: 0 | 1 = 0): WorkerSnapshot {
  return {
    wasm: new ArrayBuffer(0),
    ui: { turnPlayer: 0 as Player, turnCount: 0, phase: 'DRAW' as Phase, lp: [8000, 8000] },
    lastResponsePlayerIndex: player,
    lastAnnounceNumberOptions: [],
    capturedResponsesLength: 0,
  };
}

describe('AC #1: tryCancelRollback rejects mid-chain even when snapshot+player are valid', () => {
  it('returns chain-resolving when chainResolving=true', () => {
    const snap = makeFakeSnapshot(0);
    const result = tryCancelRollback(snap, 0, /*chainResolving=*/true);
    expect(result.canCancel).toBe(false);
    expect(result.canCancel === false ? result.reason : null).toBe('chain-resolving');
  });

  it('returns canCancel when chainResolving=false', () => {
    const snap = makeFakeSnapshot(0);
    const result = tryCancelRollback(snap, 0, false);
    expect(result.canCancel).toBe(true);
  });

  it('returns no-snapshot regardless of chainResolving when snap is null', () => {
    expect(tryCancelRollback(null, 0, false)).toEqual({ canCancel: false, reason: 'no-snapshot' });
    expect(tryCancelRollback(null, 0, true)).toEqual({ canCancel: false, reason: 'no-snapshot' });
  });

  it('returns wrong-player when player mismatch (priority over chain check)', () => {
    const snap = makeFakeSnapshot(0);
    expect(tryCancelRollback(snap, 1, false)).toEqual({ canCancel: false, reason: 'wrong-player' });
    // The priority order is no-snapshot > wrong-player > chain-resolving.
    // Even if mid-chain, a wrong-player request still gets the wrong-player
    // reason — better diagnostic for client/server divergence.
    expect(tryCancelRollback(snap, 1, true)).toEqual({ canCancel: false, reason: 'wrong-player' });
  });
});

// -----------------------------------------------------------------------------
// Tests B + C — local replica of setLastIdleSnapshot for TTL behavior
// -----------------------------------------------------------------------------
//
// Mirrors the production logic in duel-worker.ts (~10 lines). When that
// helper changes, this fixture must match — the changes flagged by AC
// #6's "no spurious expiry" assertion are the primary signal.

const SNAPSHOT_TTL_MS = 30_000;

interface SnapshotSlot {
  current: WorkerSnapshot | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Fires whenever a snapshot is dropped via TTL. Used by tests to
   *  detect spurious expiry events on replaced snapshots. */
  onExpire: ((snap: WorkerSnapshot) => void) | null;
}

function makeSlot(): SnapshotSlot {
  return { current: null, timer: null, onExpire: null };
}

function setSlot(slot: SnapshotSlot, snap: WorkerSnapshot | null): void {
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  slot.current = snap;
  if (snap !== null) {
    const captured = snap;
    slot.timer = setTimeout(() => {
      slot.current = null;
      slot.timer = null;
      slot.onExpire?.(captured);
    }, SNAPSHOT_TTL_MS);
  }
}

describe('AC #4: TTL drops the snapshot after SNAPSHOT_TTL_MS', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('drops the held snapshot once SNAPSHOT_TTL_MS elapses', () => {
    const slot = makeSlot();
    let expiredCount = 0;
    slot.onExpire = () => { expiredCount++; };

    setSlot(slot, makeFakeSnapshot(0));
    expect(slot.current).not.toBeNull();
    expect(expiredCount).toBe(0);

    vi.advanceTimersByTime(SNAPSHOT_TTL_MS - 1);
    expect(slot.current).not.toBeNull();
    expect(expiredCount).toBe(0);

    vi.advanceTimersByTime(2);
    expect(slot.current).toBeNull();
    expect(expiredCount).toBe(1);
  });

  it('drops nothing when slot is set to null before TTL', () => {
    const slot = makeSlot();
    let expiredCount = 0;
    slot.onExpire = () => { expiredCount++; };

    setSlot(slot, makeFakeSnapshot(0));
    setSlot(slot, null);
    vi.advanceTimersByTime(SNAPSHOT_TTL_MS + 1000);

    expect(slot.current).toBeNull();
    expect(expiredCount).toBe(0); // explicit clear, not TTL drop
  });
});

describe('AC #6: replacing a snapshot cancels the old timer (no spurious expiry)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not fire S1 expiry after S2 replaces it', () => {
    const slot = makeSlot();
    const expired: WorkerSnapshot[] = [];
    slot.onExpire = (s) => { expired.push(s); };

    const s1 = makeFakeSnapshot(0);
    const s2 = makeFakeSnapshot(1);

    setSlot(slot, s1);
    vi.advanceTimersByTime(10_000);
    expect(slot.current).toBe(s1);

    setSlot(slot, s2);
    expect(slot.current).toBe(s2);

    // Advance another 25_000ms — total elapsed since s1 = 35_000ms (would
    // have been past s1's TTL if not cancelled), but only 25_000ms since
    // s2 was set, so s2 is still alive.
    vi.advanceTimersByTime(25_000);
    expect(slot.current).toBe(s2);
    expect(expired).toEqual([]); // no spurious s1 expiry

    // Advance the remaining 5_001ms to push s2 past its own TTL
    vi.advanceTimersByTime(5_001);
    expect(slot.current).toBeNull();
    expect(expired).toEqual([s2]); // exactly one expiry, and it's s2
  });
});
