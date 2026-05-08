// =============================================================================
// Worker Snapshot Wrapper (P0-3bis.2) — testable, accessor-driven
// =============================================================================
//
// This module wraps `wasm-snapshot.ts` (WASM-only) with the five non-WASM
// state slots identified in P0-3bis-POC.1's report Q2:
//
//   - turnPlayer / turnCount / phase / lp     (UI mirror)
//   - lastResponsePlayerIndex                 (response trace)
//   - lastAnnounceNumberOptions               (last prompt context)
//   - capturedResponses.length                (replay buffer truncation)
//
// To stay testable without booting a Node worker_thread, this module
// receives accessors instead of importing `duel-worker.ts` directly.
// `duel-worker.ts` provides the closures bound to its own `let` bindings.
// Tests provide closures bound to local variables.
//
// The split also keeps the wrapper narrow and provable: WASM concerns
// stay in `wasm-snapshot.ts`, worker-state concerns stay here, and the
// worker module just glues them together.
//
// =============================================================================

import { takeSnapshot as takeWasmSnapshot, restoreSnapshot as restoreWasmSnapshot } from './wasm-snapshot.js';
import type { Player, Phase } from './ws-protocol.js';

/**
 * Snapshot of the duel worker at a rollback-able boundary.
 *
 * Five non-WASM state slots (per POC report Q2):
 *  - `ui` mirrors what the client display tracks (turn / phase / LP)
 *  - `lastResponsePlayerIndex` is overwritten on every `PLAYER_RESPONSE`
 *  - `lastAnnounceNumberOptions` is overwritten on every `MSG_ANNOUNCE_NUMBER`
 *  - `capturedResponsesLength` lets us in-place truncate the replay buffer
 *    so a cancelled response never lands in the persisted replay
 *
 * Divergence vs the solver's `forkViaSnapshot` (ocgcore-adapter.ts:2095):
 * the solver clones ~10 additional fields (`activationLog`,
 * `normalSummonsByPlayer`, `specialSummonsThisTurn`,
 * `chainResolutionsThisTurn`, `cardsDrawnThisTurn`,
 * `cardsSearchedThisTurn`, `effectActivationsThisTurnAll`,
 * `distinctEffectCardsThisTurn`, etc.). These are SOLVER-SIDE counters
 * for OPT-aware scoring and turn-limit tracking — they exist in the
 * solver's `InternalHandle` but NOT in the PVP duel-worker's module
 * state. The PVP worker delegates OPT enforcement to ocgcore itself
 * (via the WASM-side `proc_persistent`), so a WASM snapshot already
 * captures the equivalent state.
 *
 * Restoring snapshot only covers what's in this struct. Any module-
 * level worker state outside the 5 slots (e.g. `forkMode`, telemetry
 * counters) is NOT rolled back. Adding a slot here requires updating
 * `takeWorkerSnapshotImpl` + `restoreWorkerSnapshotImpl` + every
 * `WorkerStateAccessors` implementation in lockstep.
 */
export interface WorkerSnapshot {
  wasm: ArrayBuffer;
  ui: { turnPlayer: Player; turnCount: number; phase: Phase; lp: [number, number] };
  lastResponsePlayerIndex: 0 | 1;
  lastAnnounceNumberOptions: number[];
  capturedResponsesLength: number;
}

/**
 * Read+write accessors for the 5 divergent state slots. Provided by
 * `duel-worker.ts` in production and by the test in unit tests.
 *
 * NOTE: `getCapturedResponsesLength` reads `.length`, while
 * `truncateCapturedResponses(n)` performs an IN-PLACE truncation
 * (`arr.length = n`) — never reassign the binding, since other
 * consumers of the array hold the same reference.
 */
export interface WorkerStateAccessors {
  getTurnPlayer: () => Player;
  getTurnCount: () => number;
  getPhase: () => Phase;
  getLp: () => [number, number];
  getLastResponsePlayerIndex: () => 0 | 1;
  getLastAnnounceNumberOptions: () => number[];
  getCapturedResponsesLength: () => number;
  setTurnPlayer: (v: Player) => void;
  setTurnCount: (v: number) => void;
  setPhase: (v: Phase) => void;
  setLp: (v: [number, number]) => void;
  setLastResponsePlayerIndex: (v: 0 | 1) => void;
  setLastAnnounceNumberOptions: (v: number[]) => void;
  truncateCapturedResponses: (len: number) => void;
  log: (msg: string) => void;
}

/**
 * Capture WASM linear memory + the 5 divergent state slots through `acc`.
 *
 * @throws if WASM memory was not captured at boot (snapshot unavailable)
 */
export function takeWorkerSnapshotImpl(acc: WorkerStateAccessors): WorkerSnapshot {
  const t0 = performance.now();
  const wasm = takeWasmSnapshot().buffer;
  const lp = acc.getLp();
  const snap: WorkerSnapshot = {
    wasm,
    ui: {
      turnPlayer: acc.getTurnPlayer(),
      turnCount: acc.getTurnCount(),
      phase: acc.getPhase(),
      lp: [lp[0], lp[1]],
    },
    lastResponsePlayerIndex: acc.getLastResponsePlayerIndex(),
    lastAnnounceNumberOptions: [...acc.getLastAnnounceNumberOptions()],
    capturedResponsesLength: acc.getCapturedResponsesLength(),
  };
  const ms = performance.now() - t0;
  acc.log(`[duel-worker] worker snapshot taken (${(wasm.byteLength / 1024 / 1024).toFixed(1)} MB, ${ms.toFixed(2)}ms)`);
  return snap;
}

/**
 * P0-3bis.4 — Pure decision helper for the cancel-prompt-sequence flow.
 *
 * Inputs:
 *   - `snap`           the held rollback snapshot (or null)
 *   - `requestingPlayer`  the player who sent CANCEL_PROMPT_SEQUENCE
 *   - `chainResolving` whether ocgcore is mid-chain (MSG_CHAIN_SOLVING
 *                      received but not yet MSG_CHAIN_SOLVED)
 *
 * Returns whether the cancel may proceed, and if not, the reason. Side-
 * effect-free so the worker handler stays trivially testable.
 *
 * Rejection reasons:
 *   - `'no-snapshot'`   nothing to roll back to
 *   - `'wrong-player'`  the cancelling player isn't the one who took the snapshot
 *   - `'chain-resolving'` mid-chain — rolling back would corrupt chain state
 */
export function tryCancelRollback(
  snap: WorkerSnapshot | null,
  requestingPlayer: 0 | 1,
  chainResolving: boolean,
): { canCancel: true } | { canCancel: false; reason: 'no-snapshot' | 'wrong-player' | 'chain-resolving' } {
  if (snap === null) return { canCancel: false, reason: 'no-snapshot' };
  if (snap.lastResponsePlayerIndex !== requestingPlayer) return { canCancel: false, reason: 'wrong-player' };
  if (chainResolving) return { canCancel: false, reason: 'chain-resolving' };
  return { canCancel: true };
}

/**
 * Restore both the WASM memory and the 5 state slots through `acc`.
 *
 * After this returns the worker is bit-identical to its pre-snapshot
 * state — ocgcore field (via WASM), UI mirror, response trace, and
 * replay buffer length are all rolled back.
 */
export function restoreWorkerSnapshotImpl(snap: WorkerSnapshot, acc: WorkerStateAccessors): void {
  const t0 = performance.now();
  restoreWasmSnapshot(snap.wasm);
  acc.setTurnPlayer(snap.ui.turnPlayer);
  acc.setTurnCount(snap.ui.turnCount);
  acc.setPhase(snap.ui.phase);
  acc.setLp([snap.ui.lp[0], snap.ui.lp[1]]);
  acc.setLastResponsePlayerIndex(snap.lastResponsePlayerIndex);
  acc.setLastAnnounceNumberOptions([...snap.lastAnnounceNumberOptions]);
  acc.truncateCapturedResponses(snap.capturedResponsesLength);
  const ms = performance.now() - t0;
  acc.log(`[duel-worker] worker snapshot restored (${(snap.wasm.byteLength / 1024 / 1024).toFixed(1)} MB, ${ms.toFixed(2)}ms)`);
}
