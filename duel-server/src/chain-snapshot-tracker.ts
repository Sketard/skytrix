import type { ServerMessage, BoardStatePayload } from './ws-protocol.js';
import { BOARD_CHANGING_EVENT_TYPES } from './ws-protocol.js';

/**
 * Tracks the chain-resolving window (between MSG_CHAIN_SOLVING and
 * MSG_CHAIN_END — Option 2b, 2026-06-04) and attaches a `boardStateAfter`
 * snapshot to BOARD_CHANGING events fired inside it.
 *
 * Used by both `runDuelLoop` (live PvP) and `runReplayPreComputation`
 * (omniscient replay precompute) to guarantee strict PvP↔Replay parity:
 * the same flag transitions, the same predicate, the same field name.
 *
 * The snapshot is captured lazily via the `captureSnapshot` callback so
 * callers don't pay the `buildBoardState()` cost when the event isn't
 * board-changing or the chain isn't currently resolving.
 *
 * Audit finding H2 (extracted from duel-worker.ts).
 *
 * **2026-06-04 — window extension (Option 2b).** The window was
 * previously SOLVING→SOLVED (one window per link, closed during the
 * inter-link gap). It now stays open from the FIRST `MSG_CHAIN_SOLVING`
 * until `MSG_CHAIN_END` so every BOARD_CHANGING event "inside the
 * chain" — including stragglers fired after the last `MSG_CHAIN_SOLVED`
 * (typically a self-destroy reacting to its own resolution) — carries
 * its `boardStateAfter` snapshot. Without this, the client's logical
 * state lags behind the rendered state at the moment the `preSrcLock.commit()`
 * fires for the straggler, and the source DOM element stays visible
 * during the travel animation (cosmetic but visible "card in 2 places").
 *
 * The semantic broadening also extends the `isResolving` gate
 * consumed by the live-PvP `CANCEL_PROMPT_SEQUENCE` handler: a player
 * can no longer cancel-rollback between the last `MSG_CHAIN_SOLVED`
 * and `MSG_CHAIN_END` — which is the more correct behavior (the chain
 * is not finished, the OCGCore is still emitting effect-bound events).
 */
export class ChainSnapshotTracker {
  private _chainResolving = false;

  /** True between the first MSG_CHAIN_SOLVING of a chain and the matching
   *  MSG_CHAIN_END (Option 2b — 2026-06-04 ; previously SOLVING→SOLVED).
   *  Exposed for callers that need to gate other behavior on chain
   *  resolution (e.g. the live PvP CANCEL_PROMPT_SEQUENCE handler refuses
   *  cancel mid-chain). */
  get isResolving(): boolean {
    return this._chainResolving;
  }

  /** Update the resolving flag based on `dto.type` and (if appropriate) attach
   *  a board snapshot to the outgoing DTO. Mutates the dto in place.
   *
   *  Window opens at the FIRST `MSG_CHAIN_SOLVING` of a chain (subsequent
   *  `MSG_CHAIN_SOLVING` messages — for chains with > 1 link — keep the
   *  flag true, no-op transition). Window closes at `MSG_CHAIN_END`.
   *  `MSG_CHAIN_SOLVED` no longer closes the window — events between
   *  it and `MSG_CHAIN_END` (or the next `MSG_CHAIN_SOLVING`) get
   *  their `boardStateAfter` too. */
  process(dto: ServerMessage, captureSnapshot: () => BoardStatePayload): void {
    if (dto.type === 'MSG_CHAIN_SOLVING') {
      this._chainResolving = true;
    } else if (dto.type === 'MSG_CHAIN_END') {
      this._chainResolving = false;
    }
    if (this._chainResolving && BOARD_CHANGING_EVENT_TYPES.has(dto.type)) {
      (dto as { boardStateAfter?: BoardStatePayload }).boardStateAfter = captureSnapshot();
    }
  }

  /** Reset for a new duel/replay run (called at the top of runDuelLoop). */
  reset(): void {
    this._chainResolving = false;
  }
}
