/**
 * ChainCostSyncTracker — same-batch intermediate board sync (F10 unification,
 * 2026-06-12).
 *
 * Decides when an intermediate BOARD_STATE must be emitted right before a
 * `MSG_CHAIN_SOLVING`: when at least one `MSG_MOVE` (cost — discard, banish,
 * tribute…) was emitted earlier IN THE SAME `duelProcess` batch. Without it,
 * the client enters `chainPhase='resolving'` (which freezes board syncs)
 * with stale DECK/pile counts.
 *
 * SHARED between the two OCGCore-replaying loops — `runDuelLoop`
 * (duel-worker.ts, live PvP/SOLO/fork) and `runReplayPreComputation`
 * (replay-precompute.ts) — same pattern as `ChainSnapshotTracker`: one
 * predicate, one position on the wire, parity by shared code instead of
 * by-construction coincidence.
 *
 * Scope contract: the flag is BATCH-scoped. Call {@link resetBatch} at the
 * top of every `duelProcess` batch (mirror of the historical
 * `let hasCostMoves = false` local in runDuelLoop). A cost MOVE separated
 * from its MSG_CHAIN_SOLVING by a player prompt (cross-batch — the common
 * case) deliberately does NOT trigger this sync: the per-prompt BOARD_STATE
 * the wire ships after every SELECT_* already covers it (see CLAUDE.md
 * "Intermediate post-cost board sync (F10)" + the 2026-06-12 wire
 * investigation that established the cadence).
 */
export class ChainCostSyncTracker {
  private hasMovesSinceLastSolving = false;

  /** Reset at every `duelProcess` batch boundary. */
  resetBatch(): void {
    this.hasMovesSinceLastSolving = false;
  }

  /**
   * Observe an outgoing message (in wire order). Returns `true` when an
   * intermediate BOARD_STATE must be emitted BEFORE `msg` — i.e. `msg` is
   * a `MSG_CHAIN_SOLVING` preceded by at least one `MSG_MOVE` in the same
   * batch. The flag self-clears on emission so a multi-link batch emits
   * once per (moves → solving) window.
   */
  shouldEmitBefore(msg: { type: string }): boolean {
    if (msg.type === 'MSG_MOVE') {
      this.hasMovesSinceLastSolving = true;
      return false;
    }
    if (msg.type === 'MSG_CHAIN_SOLVING' && this.hasMovesSinceLastSolving) {
      this.hasMovesSinceLastSolving = false;
      return true;
    }
    return false;
  }
}
