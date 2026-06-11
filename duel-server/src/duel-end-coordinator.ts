import type { ActiveDuelSession } from './types.js';
import { createConfigurable } from './configurable.js';

/**
 * Duel-end coordination — `safeTerminateWorker`, `handleDuelEnd`,
 * `requestReplayFromWorker`, and the `totalDuelsServed` counter.
 *
 * U34 cosmetic (audit-4-modes-2026-06-01) — extracted from
 * `worker-lifecycle.ts` to clarify intent. The three functions own the
 * **end-of-duel** sequence ; worker-lifecycle's residual role is
 * narrower (only `attachWorkerHandlers` — wraps a freshly-spawned
 * Worker handle and routes its `message`/`exit`/`error` events).
 *
 * Why "cosmetic" and not "deep" :
 *   The audit doc proposed a deeper U34 that would break the runtime
 *   invocation cycle `worker.on('message') → handleWorkerMessage →
 *   broadcastMessage → handleDuelEnd → ... can re-trigger
 *   worker.on('message')`. After investigation (Phase 2 R5 + R9 of the
 *   chunk plan), the deep refactor would NOT actually break that
 *   cycle — the cycle is anchored on the router injection inside
 *   `attachWorkerHandlers`, not on the end-of-duel sequence. The
 *   cycle is also harmless in practice : each arc consumes a
 *   message/timer (never re-entrant sync), idempotence is enforced
 *   by `workerTerminated` + `endedAt` flags, and no bug has ever
 *   been attributed to it. The cosmetic extraction below regroups
 *   the 3 functions for readability, with no behavioral change.
 *
 * Cycle-of-invocation note : `handleDuelEnd` and `safeTerminateWorker`
 * are called from 4 modules (worker-message-router, client-message-router,
 * timer-management, fork-handlers). Each import is now from
 * duel-end-coordinator instead of worker-lifecycle ; the runtime
 * invocation graph is unchanged.
 *
 * Idempotence guarantees (mirroring the pre-extraction contract) :
 *   - `safeTerminateWorker` short-circuits on `session.workerTerminated`.
 *     Increments `totalDuelsServed` exactly once per worker handle.
 *     Removes all listeners BEFORE the `terminate()` call so a late
 *     OS-scheduled event can't trigger `cleanupDuelSession` twice.
 *   - `handleDuelEnd` short-circuits on `session.endedAt !== null`.
 *     Arms the rematch timer at most once per duel. Fork-solo skips
 *     the arm by design (F5-bis, exploratory one-shot).
 *   - `requestReplayFromWorker` no-ops on `workerTerminated` or
 *     `worker === null`. Persisting a half-completed replay is
 *     meaningless without seed + playerResponses.
 */

export interface DuelEndCoordinatorConfig {
  /**
   * Clear all per-session timers (turn, inactivity, grace). Wired to
   * `clearAllDuelTimers` in timer-management.ts ; injected here so this
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
  /**
   * Audit 2026-06-11 #2/#3 — called when a fork-solo session's post-end
   * grace window expires. Wired to `cleanupDuelSession` in server.ts
   * (no REMATCH_CANCELLED — fork has no rematch flow to cancel).
   */
  onForkSessionExpired: (session: ActiveDuelSession) => void;
}

const configurable = createConfigurable<DuelEndCoordinatorConfig>('duel-end-coordinator');
export const configureDuelEndCoordinator = configurable.configure;
export const isDuelEndCoordinatorConfigured = configurable.isConfigured;
const getCfg = configurable.get;

let totalDuelsServed = 0;

/** Read-only counter exposed via /status. Incremented exactly once per
 *  worker termination, regardless of whether the terminate was driven
 *  by `safeTerminateWorker` (explicit) or by the worker exiting on its
 *  own (unexpected crash / clean shutdown). */
export function getTotalDuelsServed(): number {
  return totalDuelsServed;
}

/** Internal accessor used by `worker-lifecycle.attachWorkerHandlers`'s
 *  `exit` handler so it can increment the same counter when the worker
 *  exited naturally (i.e. without an explicit `safeTerminateWorker`
 *  call having already counted it). Not part of the public surface ;
 *  the only legitimate caller is `attachWorkerHandlers`. */
export function _incrementTotalDuelsServed(): void {
  totalDuelsServed++;
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
  //
  // F5-bis (2026-05-31) — fork-solo is exploratory one-shot: no rematch
  // invitation flow. Audit 2026-06-11 #2/#3 — the previous "skip the arm"
  // relied on a socket-close grace path that does NOT exist for soloMode
  // sessions (the close handler early-returns) : every ended fork session
  // leaked forever. Arm the same expiry window on the shared
  // `rematchTimeout` slot (so every existing clear site covers it) but
  // fire straight into session cleanup instead of the rematch flow.
  if (!session.forkMode) {
    session.rematchTimeout = setTimeout(() => cfg.onRematchExpired(session), cfg.rematchExpiryMs);
  } else {
    session.rematchTimeout = setTimeout(() => cfg.onForkSessionExpired(session), cfg.rematchExpiryMs);
  }
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
