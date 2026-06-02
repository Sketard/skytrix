// =============================================================================
// duel-worker-fork.ts
//
// U4 (audit-4-modes-2026-06-01) — second extraction from `duel-worker.ts`.
// Holds `runForkReconstruction` + `performSanityCheck` + the local
// `PHASE_MAP_REVERSE` they use. The bootstrap (`initFork`) stays in the
// worker because it touches the OCGCore init pipeline (initOcgEngine,
// loadDeckToOcg, normalizeReplayDeck, resetDuelState) ; this module is
// the pure replay-driver + sanity gate that runs AFTER the engine is
// already initialised.
//
// Architecture (D5=1 per audit triage) — `forkMode` + `forkPendingSelect`
// stay as worker-level state slots (the port-message handler reads them
// at FORK_RESUME / cleanup). This module receives setters via the
// `ForkContext` interface, mirroring the `WorkerStateAccessors` pattern
// used by `wasm-snapshot-wrapper.ts` for the cancel-rollback flow.
//
// Read state is sourced via lazy closures (`() => lp`, `() => phase`, …)
// because the worker re-assigns those across `init*` calls (worker is
// reused). Eager refs would freeze pre-init values.
//
// Why not extract `initFork` too — it would force this module to import
// `initOcgEngine` (worker-private), `loadDeckToOcg` (worker-private),
// `normalizeReplayDeck`, plus a setter for the worker's mutable
// `core / duel / cardDb / systemStrings` slots. The audit triage marked
// it explicitly out of scope (D4=1) ; the value of the cleanup is
// isolating the long-running fork loop + the sanity check.
// =============================================================================

import { OcgMessageType, OcgProcessResult } from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle, OcgMessage } from '@n1xx1/ocgcore-wasm';
import { SELECT_MESSAGE_TYPES } from './replay-precompute.js';
import type { WorkerEmitter } from './duel-worker-emit.js';
import type { DuelLogger } from './logger.js';
import type { InitForkMessage } from './types.js';
import type { Phase, ServerMessage } from './ws-protocol.js';

// =============================================================================
// Phase reverse lookup (only consumer is `performSanityCheck`)
// =============================================================================

/** Inverse of the worker's `PHASE_MAP` — exposed via `ForkContext.phaseMap`
 *  so the module doesn't drift from the worker's source of truth. */
export type PhaseToCodeMap = Record<Phase, number>;

// =============================================================================
// Context interface (D5=1)
// =============================================================================

export interface ForkContext {
  /** OCGCore handles. `core` + `duel` are assigned by the worker's
   *  `initOcgEngine` before `runForkReconstruction` is called. */
  core: () => OcgCoreSync | null;
  duel: () => OcgDuelHandle | null;

  /** Read-only state accessors used by `performSanityCheck`. */
  lp: () => [number, number];
  turnCount: () => number;
  phase: () => Phase;
  phaseMap: PhaseToCodeMap;

  /** Logger + emitter — re-assigned per init, so lazy. */
  dlog: () => DuelLogger;
  emit: () => WorkerEmitter;

  /** Worker callbacks. */
  updateState: (msg: OcgMessage) => void;
  cleanup: () => void;
  /** Worker-side `transformMessage` wrapper — only used by FORK_RESUME, NOT
   *  by `runForkReconstruction` itself. Threaded through so the worker can
   *  retain a single source of truth. */
  transformMessage?: (msg: OcgMessage) => ServerMessage | null;

  /** Setters for the 2 fork state slots that live on the worker. */
  setForkMode: (v: boolean) => void;
  setForkPendingSelect: (v: OcgMessage | null) => void;
}

// =============================================================================
// Replay driver
// =============================================================================

/** Drive `core.duelProcess` until either (a) the recorded responses are
 *  exhausted and we've hit the fork point (= a SELECT_* message past
 *  `targetResponseCount`), (b) the engine emits MSG_RETRY (divergence),
 *  (c) the engine ends the duel before reaching the fork point, or
 *  (d) `MAX_ITERATIONS` is exceeded.
 *
 *  Path (a) is the success path : we stash the pending SELECT in the
 *  worker's `forkPendingSelect` slot and call `performSanityCheck`.
 *  Every other path emits a `forkError` + calls `cleanup`. */
export function runForkReconstruction(msg: InitForkMessage, ctx: ForkContext): void {
  const core = ctx.core();
  const duel = ctx.duel();
  if (!core || !duel) return;

  let responseIndex = 0;
  const MAX_ITERATIONS = 100_000;
  let iterations = 0;

  const dlog = ctx.dlog();
  const emit = ctx.emit();
  dlog.log('Fork starting reconstruction', { targetResponses: msg.targetResponseCount });

  while (true) {
    if (++iterations > MAX_ITERATIONS) {
      dlog.error('Fork max iterations reached — aborting', { maxIterations: MAX_ITERATIONS });
      emit.forkError('REPLAY_MAX_ITERATIONS', 'Fork reconstruction exceeded maximum iterations');
      ctx.cleanup();
      return;
    }

    let status: number;
    try {
      status = core.duelProcess(duel);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      dlog.error('Fork duelProcess threw', { error: message });
      emit.forkError('REPLAY_COMPUTATION_ERROR', `Fork reconstruction error: ${message}`);
      ctx.cleanup();
      return;
    }

    const messages = core.duelGetMessage(duel);

    for (const rawMsg of messages) {
      if (rawMsg.type === OcgMessageType.RETRY) {
        dlog.error('Fork MSG_RETRY — divergence', { responseIndex });
        emit.forkError('REPLAY_DIVERGED_RETRY', 'Fork diverged: MSG_RETRY encountered');
        ctx.cleanup();
        return;
      }

      ctx.updateState(rawMsg);

      if (SELECT_MESSAGE_TYPES.has(rawMsg.type)) {
        if (responseIndex >= msg.targetResponseCount) {
          // Reached fork point — WASM is waiting for player input
          dlog.log('Fork reached fork point', { responseIndex });
          ctx.setForkPendingSelect(rawMsg);
          performSanityCheck(msg.expectedState, ctx);
          return;
        }

        if (responseIndex >= msg.playerResponses.length) {
          dlog.error('Fork ran out of responses', { responseIndex });
          emit.forkError('REPLAY_DIVERGED_NO_RESPONSES', 'Fork diverged: ran out of recorded responses');
          ctx.cleanup();
          return;
        }

        core.duelSetResponse(duel, msg.playerResponses[responseIndex].data as never);
        responseIndex++;
      }
    }

    if (status === OcgProcessResult.END) {
      dlog.error('Fork duel ended before reaching fork point', { responseIndex, target: msg.targetResponseCount });
      emit.forkError('REPLAY_DIVERGED_NO_RESULT', 'Fork failed: duel ended before reaching target response count');
      ctx.cleanup();
      return;
    }
  }
}

// =============================================================================
// Sanity check (compare reconstructed LP / turn / phase to the recorded
// expectedState; emit forkReady with a mismatch report)
// =============================================================================

export function performSanityCheck(
  expectedState: InitForkMessage['expectedState'],
  ctx: ForkContext,
): void {
  const lp = ctx.lp();
  const actualLp: [number, number] = [lp[0], lp[1]];
  const actualTurn = ctx.turnCount();
  const phaseStr = ctx.phase();
  const actualPhase = ctx.phaseMap[phaseStr];
  const dlog = ctx.dlog();
  if (actualPhase === undefined) {
    dlog.warn('Fork unknown phase during sanity check — defaulting to 0', { phase: phaseStr });
  }

  const mismatches: string[] = [];
  if (expectedState.lp[0] !== actualLp[0] || expectedState.lp[1] !== actualLp[1]) {
    mismatches.push(`LP mismatch: expected [${expectedState.lp}] got [${actualLp}]`);
  }
  if (expectedState.turnNumber !== actualTurn) {
    mismatches.push(`Turn mismatch: expected ${expectedState.turnNumber} got ${actualTurn}`);
  }
  if (expectedState.phase !== actualPhase) {
    mismatches.push(`Phase mismatch: expected ${expectedState.phase} got ${actualPhase}`);
  }

  const match = mismatches.length === 0;
  const details = match ? undefined : mismatches.join('; ');

  dlog.log('Fork sanity check', { result: match ? 'PASS' : 'MISMATCH', details: details ?? undefined });

  ctx.setForkMode(true);
  ctx.emit().forkReady({ match, details });
  // Worker stays alive — waiting for PLAYER_RESPONSE messages in solo mode
}
