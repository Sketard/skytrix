import type { ActiveDuelSession, WorkerToMainMessage } from './types.js';
import { createConfigurable } from './configurable.js';
import { validateWorkerMessage } from './validation/worker-message-validation.js';
import * as logger from './logger.js';

/**
 * Per-session worker process lifecycle: spawn → handler attach → natural
 * end → safe terminate. The actual `new Worker(...)` happens in server.ts
 * (the host owns where the worker constructor lives and what URL it
 * resolves), but everything that wraps the worker handle — attaching the
 * 3 listeners, the idempotent terminate, the `endedAt`/rematch-timer
 * bookkeeping for natural duel-end, the replay-flush request — lives
 * here. Single source of truth for the `workerTerminated` flag and the
 * `totalDuelsServed` counter, both of which had subtle off-by-one races
 * in the pre-extraction inline code (the `exit` handler used to re-count
 * even when `safeTerminateWorker` had already counted).
 *
 * The cross-cutting hooks (`handleWorkerMessage` for routing messages to
 * the player WS, `handleDuelEnd → cleanup` orchestration, rematch timer
 * arming on natural end) are injected at boot via
 * `configureWorkerLifecycle`. This keeps the module decoupled from the
 * WS layer and from `cleanupDuelSession`.
 */

export interface WorkerLifecycleConfig {
  /**
   * Route a (validated) worker message to its consumers. Server.ts wires
   * this to `handleWorkerMessage` (which calls `broadcastMessage`,
   * `requestReplayFromWorker`, etc.). The router decides what to do
   * with each message kind — this module only owns the inbound plumbing.
   */
  handleWorkerMessage: (session: ActiveDuelSession, wmsg: WorkerToMainMessage) => void;
  /**
   * Tear down a session after an unexpected worker exit (no `endedAt`).
   * Wired to `cleanupDuelSession` in server.ts.
   */
  cleanupDuelSession: (session: ActiveDuelSession) => void;
  /**
   * Clear all per-session timers (turn, inactivity, grace). Wired to
   * `clearAllDuelTimers` in timer-management.ts; injected here so this
   * module doesn't take a hard dep on timer-management.
   */
  clearAllDuelTimers: (session: ActiveDuelSession) => void;
  /**
   * Duration before the rematch invitation expires (in ms). Configurable
   * so a test can use a short value.
   */
  rematchExpiryMs: number;
  /**
   * Called when the rematch timer fires. Wired to `rematchExpired` in
   * server.ts (sends REMATCH_CANCELLED, calls cleanupDuelSession).
   */
  onRematchExpired: (session: ActiveDuelSession) => void;
}

const configurable = createConfigurable<WorkerLifecycleConfig>('worker-lifecycle');
export const configureWorkerLifecycle = configurable.configure;
export const isWorkerLifecycleConfigured = configurable.isConfigured;
const getCfg = configurable.get;

let totalDuelsServed = 0;

/** Read-only counter exposed via /status. Incremented exactly once per
 *  worker termination, regardless of whether the terminate was driven
 *  by `safeTerminateWorker` (explicit) or by the worker exiting on its
 *  own (unexpected crash / clean shutdown). */
export function getTotalDuelsServed(): number {
  return totalDuelsServed;
}

/**
 * Idempotent worker terminate.
 *
 * Three pre-extraction bugs this guards against:
 *   1. Double-terminate of the same handle (e.g. WORKER_ERROR + cleanup
 *      both calling terminate) — the `workerTerminated` flag short-
 *      circuits the second call.
 *   2. Double-counted `totalDuelsServed` (the inline `exit` handler used
 *      to also increment when the worker exited after we'd already
 *      terminated it) — the flag also guards the increment.
 *   3. Re-fire of `exit`/`error`/`message` handlers after terminate has
 *      decided to tear down — `removeAllListeners()` clears them before
 *      the actual `terminate()` so a late OS-scheduled event can't
 *      trigger `cleanupDuelSession` a second time.
 */
export function safeTerminateWorker(session: ActiveDuelSession): void {
  if (!session.workerTerminated && session.worker) {
    session.workerTerminated = true;
    totalDuelsServed++;
    session.worker.removeAllListeners();
    session.worker.terminate();
  }
}

/**
 * Wire the 3 worker event listeners. Called by `startDuelWithOrder` right
 * after each worker spawn — both for the initial duel and for a rematch
 * (a rematch re-enters the pre-duel dice flow, which bridges back into
 * `startDuelWithOrder`; `startRematch` itself no longer spawns a worker).
 * Safe to call on a session whose worker was just replaced; existing
 * listeners are NOT removed by this function (the caller tears down the
 * old worker via `safeTerminateWorker` before re-attaching).
 *
 * The `exit` handler distinguishes:
 *  - Natural end (session.endedAt !== null) → keep the session alive
 *    so a rematch can spawn a new worker into the same session.
 *  - Unexpected exit (endedAt is null) → full cleanup.
 */
export function attachWorkerHandlers(session: ActiveDuelSession): void {
  if (!session.worker) return;
  const cfg = getCfg();
  session.worker.on('message', (raw: unknown) => {
    const wmsg = validateWorkerMessage(raw);
    if (!wmsg) {
      logger.error('Dropping malformed worker message', { duelId: session.duelId, raw });
      return;
    }
    cfg.handleWorkerMessage(session, wmsg);
  });
  session.worker.on('exit', (code) => {
    logger.log('Worker exited', { duelId: session.duelId, exitCode: code });
    if (!session.workerTerminated) {
      session.workerTerminated = true;
      totalDuelsServed++;
    }
    if (session.endedAt !== null) return;
    cfg.cleanupDuelSession(session);
  });
  session.worker.on('error', (err: Error) => {
    logger.error('Worker error', { duelId: session.duelId, error: err.message });
  });
}

/**
 * Mark the duel as ended (natural game end or admin-driven). Sets
 * `endedAt` so the worker's `exit` handler will keep the session alive
 * for rematch, clears all duel timers (turn, inactivity, grace), and
 * arms the rematch-invitation expiry. Solo-mode sessions skip the
 * rematch arm — they have no rematch flow.
 *
 * Idempotent only on the `endedAt` field — re-arming the rematch timer
 * is a bug (callers MUST guard with `session.endedAt === null` or the
 * timer accumulator pattern). Pre-extraction code consistently called
 * this once per duel-end event.
 */
export function handleDuelEnd(session: ActiveDuelSession): void {
  // Idempotent on `endedAt` (the leading comment above said so, but the body
  // did not enforce it). Re-entry through a TIMEOUT-after-MSG_WIN race would
  // otherwise overwrite `rematchTimeout` and leak the prior Node timer —
  // and `endedAt` would get bumped to the second timestamp.
  if (session.endedAt !== null) return;
  const cfg = getCfg();
  session.endedAt = Date.now();
  cfg.clearAllDuelTimers(session);
  // γ Option C A31 — the rematch grace window applies to SOLO too: the user
  // may have closed the tab during the rematch invitation and want to come
  // back. PR1 c3 makes `ws.on('close')` SOLO-aware so the only thing that
  // can fire `cleanupDuelSession` post-duel is this timer expiring naturally
  // (`onRematchExpired`). Pre-γ SOLO had no rematch grace at all — the
  // session was cleaned the instant the worker reported MSG_WIN.
  session.rematchTimeout = setTimeout(() => cfg.onRematchExpired(session), cfg.rematchExpiryMs);
}

/**
 * Ask the worker to flush its accumulated replay data to the main
 * thread. The override string is stashed on `session.pendingReplayResult`
 * so the eventual WORKER_REPLAY_DATA handler can patch the metadata
 * before persisting (used for TIMEOUT / SURRENDER / RESIGN — overrides
 * the natural OCGCore "win/lose" result).
 *
 * No-op if the worker is gone (terminated or never spawned). Persisting
 * a half-completed replay after the worker died is meaningless: the
 * worker is the only source of `playerResponses` + `seed`, both
 * required for replay reconstruction.
 */
export function requestReplayFromWorker(session: ActiveDuelSession, resultOverride: string): void {
  if (!session.worker || session.workerTerminated) return;
  session.pendingReplayResult = resultOverride;
  session.worker.postMessage({ type: 'EMIT_REPLAY_DATA' });
}

/** Test-only: reset the duels-served counter back to zero. */
export function _resetTotalDuelsServedForTest(): void {
  totalDuelsServed = 0;
}
