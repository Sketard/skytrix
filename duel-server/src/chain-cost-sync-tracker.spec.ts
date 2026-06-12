import { describe, it, expect } from 'vitest';
import { ChainCostSyncTracker } from './chain-cost-sync-tracker.js';

// =============================================================================
// F10 unification (2026-06-12) — shared same-batch cost-sync predicate.
// Consumed by BOTH runDuelLoop (duel-worker.ts) and runReplayPreComputation
// (replay-precompute.ts). These pins ARE the cross-side parity contract for
// the intermediate BOARD_STATE — if the semantics change here, both wires
// move together by construction.
// =============================================================================

describe('ChainCostSyncTracker', () => {
  it('emits before MSG_CHAIN_SOLVING when a MSG_MOVE happened in the same batch', () => {
    const t = new ChainCostSyncTracker();
    t.resetBatch();
    expect(t.shouldEmitBefore({ type: 'MSG_MOVE' })).toBe(false);
    expect(t.shouldEmitBefore({ type: 'MSG_CHAIN_SOLVING' })).toBe(true);
  });

  it('does NOT emit when MSG_CHAIN_SOLVING has no preceding MOVE in the batch', () => {
    const t = new ChainCostSyncTracker();
    t.resetBatch();
    expect(t.shouldEmitBefore({ type: 'MSG_CHAINING' })).toBe(false);
    expect(t.shouldEmitBefore({ type: 'MSG_CHAIN_SOLVING' })).toBe(false);
  });

  it('CROSS-BATCH — a prompt boundary between the cost MOVE and the SOLVING suppresses the emit', () => {
    // The common case (cost paid through a SELECT_* prompt): the live wire
    // relies on the per-prompt BOARD_STATE instead. Pinned so a future
    // "fix" that makes the flag survive batches knows it changes the wire
    // cadence on BOTH sides (2026-06-12 investigation, finding 2).
    const t = new ChainCostSyncTracker();
    t.resetBatch();
    expect(t.shouldEmitBefore({ type: 'MSG_MOVE' })).toBe(false);
    t.resetBatch(); // prompt answered → new duelProcess batch
    expect(t.shouldEmitBefore({ type: 'MSG_CHAIN_SOLVING' })).toBe(false);
  });

  it('self-clears after an emit — one emission per (moves → solving) window', () => {
    const t = new ChainCostSyncTracker();
    t.resetBatch();
    t.shouldEmitBefore({ type: 'MSG_MOVE' });
    expect(t.shouldEmitBefore({ type: 'MSG_CHAIN_SOLVING' })).toBe(true);
    // Second link in the same batch without new moves → no emit.
    expect(t.shouldEmitBefore({ type: 'MSG_CHAIN_SOLVING' })).toBe(false);
    // New cost move before the next link → emits again.
    t.shouldEmitBefore({ type: 'MSG_MOVE' });
    expect(t.shouldEmitBefore({ type: 'MSG_CHAIN_SOLVING' })).toBe(true);
  });

  it('non-MOVE messages never arm the flag', () => {
    const t = new ChainCostSyncTracker();
    t.resetBatch();
    for (const type of ['MSG_DRAW', 'MSG_DAMAGE', 'MSG_CHAINING', 'MSG_HINT', 'BOARD_STATE']) {
      expect(t.shouldEmitBefore({ type })).toBe(false);
    }
    expect(t.shouldEmitBefore({ type: 'MSG_CHAIN_SOLVING' })).toBe(false);
  });
});
