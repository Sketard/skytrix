import type { ServerMessage, BoardStatePayload } from './ws-protocol.js';
import { BOARD_CHANGING_EVENT_TYPES } from './ws-protocol.js';

/**
 * Tracks the chain-resolving window (between MSG_CHAIN_SOLVING and
 * MSG_CHAIN_SOLVED) and attaches a `boardStateAfter` snapshot to
 * BOARD_CHANGING events fired inside it.
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
 */
export class ChainSnapshotTracker {
  private _chainResolving = false;

  /** True between MSG_CHAIN_SOLVING and MSG_CHAIN_SOLVED. Exposed for callers
   *  that need to gate other behavior on chain resolution (e.g. the live PvP
   *  CANCEL_PROMPT_SEQUENCE handler refuses cancel mid-chain). */
  get isResolving(): boolean {
    return this._chainResolving;
  }

  /** Update the resolving flag based on `dto.type` and (if appropriate) attach
   *  a board snapshot to the outgoing DTO. Mutates the dto in place. */
  process(dto: ServerMessage, captureSnapshot: () => BoardStatePayload): void {
    if (dto.type === 'MSG_CHAIN_SOLVING') {
      this._chainResolving = true;
    } else if (dto.type === 'MSG_CHAIN_SOLVED') {
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
