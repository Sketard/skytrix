import type { ActiveDuelSession, WorkerToMainMessage } from './types.js';
import { createConfigurable } from './configurable.js';
import { validateWorkerMessage } from './validation/worker-message-validation.js';
import { _incrementTotalDuelsServed } from './duel-end-coordinator.js';
import * as logger from './logger.js';

/**
 * Per-session worker process **handle wiring**. The actual `new
 * Worker(...)` happens in server.ts (the host owns where the worker
 * constructor lives and what URL it resolves). This module's residual
 * role after U34 cosmetic (audit-4-modes-2026-06-01) is narrow :
 *
 *   `attachWorkerHandlers(session)` — attaches the 3 lifetime listeners
 *   (`message`, `exit`, `error`) on a freshly-spawned worker. Routes
 *   inbound messages via the injected `handleWorkerMessage`. Decides
 *   `cleanup-on-unexpected-exit` vs `keep-alive-for-rematch` based on
 *   `session.endedAt`. Increments the duels-served counter exactly
 *   once per worker handle, coordinated with
 *   `safeTerminateWorker` (which lives in `duel-end-coordinator.ts`)
 *   via the shared `_incrementTotalDuelsServed` accessor.
 *
 * The end-of-duel sequence (`safeTerminateWorker`, `handleDuelEnd`,
 * `requestReplayFromWorker`) lives in `duel-end-coordinator.ts` since
 * U34. Callers that need a worker tear-down or duel-end transition
 * import from there ; this module only owns the inbound plumbing.
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
   * Wired to `cleanupDuelSession` (session-orchestrator) via server.ts.
   */
  cleanupDuelSession: (session: ActiveDuelSession) => void;
}

const configurable = createConfigurable<WorkerLifecycleConfig>('worker-lifecycle');
export const configureWorkerLifecycle = configurable.configure;
export const isWorkerLifecycleConfigured = configurable.isConfigured;
const getCfg = configurable.get;

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
 *
 * The counter increment is coordinated with `safeTerminateWorker` via
 * the `workerTerminated` flag : whichever path observes the worker
 * still-alive flips the flag AND increments. The other path then
 * short-circuits. `_incrementTotalDuelsServed` is the shared writer.
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
      _incrementTotalDuelsServed();
    }
    if (session.endedAt !== null) return;
    cfg.cleanupDuelSession(session);
  });
  session.worker.on('error', (err: Error) => {
    logger.error('Worker error', { duelId: session.duelId, error: err.message });
  });
}
