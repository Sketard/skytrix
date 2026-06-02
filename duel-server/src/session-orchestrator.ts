import { WebSocket } from 'ws';
import type { ActiveDuelSession } from './types.js';
import type { ServerMessage } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import type { DuelSessionManager } from './duel-session-manager.js';
import { createSessionGameLog } from './session-game-log.js';
import { disposeFirstPlayer } from './first-player-coordinator.js';
import { clearAllDuelTimers, sendTimerStateToPlayer } from './timer-management.js';
import { filterMessage } from './message-filter.js';
import { buildPreDuelSnapshot } from './pre-duel-snapshot.js';
import { buildDuelStartingMessage } from './lifecycle-helpers.js';
import { sendToPlayer } from './ws-write.js';

/**
 * Per-session lifecycle helpers extracted from server.ts.
 *
 * Three responsibilities owned by this module today (U32 #3a partial,
 * audit-4-modes-2026-06-01):
 *
 *   1. `cleanupDuelSession` — idempotent teardown of an
 *      `ActiveDuelSession`. Clears every timer slot tracked on the
 *      session, closes both player WebSockets, releases the
 *      `GameLogBuilder` pair to a fresh empty pair (so any belated
 *      outbound message can still ingest without throwing), and drops
 *      the session from the `DuelSessionManager` (which also nulls the
 *      `reconnectToken` back-pointers on each player). Called from 5
 *      direct sites in server.ts plus 3 modules via cfg (worker-lifecycle
 *      on unexpected exit, fork-handlers on no-connect timeout,
 *      timer-management on forfeit / both-disconnect).
 *
 *   2. `sendStateSnapshot` — the DRY entry point for "re-emit everything
 *      the client needs to render the current state". Two paths:
 *        - Pre-duel (phase !== 'DUELING') → delegates to the pure
 *          `buildPreDuelSnapshot` (dice / first-player / waiting screen
 *          messages), then sends TIMER_STATE.
 *        - DUELING → re-emits DUEL_STARTING, the cached BOARD_STATE as
 *          a filtered STATE_SYNC, the active CHAIN_STATE if any, then
 *          TIMER_STATE.
 *      Consumed by the WS connection handler (initial connect +
 *      reconnect) and by `REQUEST_STATE_SYNC` via the
 *      `client-message-router` cfg hook.
 *
 *   3. `resendPendingPrompt` — re-emit the cached hint + prompt for a
 *      player who has `awaitingResponse[p] === true`. Sent on every
 *      reconnect and on REQUEST_STATE_SYNC. SOLO multiplex calls it
 *      for BOTH slots (single socket carries both server identities;
 *      γ Option C A29).
 *
 * Pattern : `createConfigurable<SessionOrchestratorConfig>` with a
 * minimal config surface — only the `DuelSessionManager` instance is
 * injected (because server.ts owns the singleton and a test fixture
 * may want its own). All other collaborators (`sendToPlayer`,
 * `filterMessage`, `buildPreDuelSnapshot`, `buildDuelStartingMessage`,
 * `createSessionGameLog`, `disposeFirstPlayer`, `clearAllDuelTimers`,
 * `sendTimerStateToPlayer`) are imported directly — they are pure
 * functions or already-configured module exports.
 *
 * Idempotence: `cleanupDuelSession` is safe to call multiple times.
 * `sessionManager.terminate()` is itself idempotent (no-op on second
 * call), and every timer-clear branch checks for null first.
 */

export interface SessionOrchestratorConfig {
  /**
   * The host's `DuelSessionManager` singleton. server.ts owns the
   * instance; this module receives it via cfg so tests can substitute
   * a fresh manager per scenario.
   */
  sessionManager: DuelSessionManager;
}

const configurable = createConfigurable<SessionOrchestratorConfig>('session-orchestrator');
export const configureSessionOrchestrator = configurable.configure;
export const isSessionOrchestratorConfigured = configurable.isConfigured;
const getCfg = configurable.get;

export function cleanupDuelSession(session: ActiveDuelSession): void {
  session.endedAt = session.endedAt ?? Date.now();
  session.lastSentPrompt = [null, null];
  session.lastSentHint = [null, null];

  // Clear pre-duel RPS timeout
  disposeFirstPlayer(session);

  // Clear rematch timeout
  if (session.rematchTimeout) {
    clearTimeout(session.rematchTimeout);
    session.rematchTimeout = null;
  }

  // H2 — Clear fork connection timeout
  if (session.forkConnectionTimeout) {
    clearTimeout(session.forkConnectionTimeout);
    session.forkConnectionTimeout = null;
  }

  // Story 5.2 — Clear both-disconnect timers
  if (session.combinedGraceTimer) {
    clearTimeout(session.combinedGraceTimer);
    session.combinedGraceTimer = null;
  }
  if (session.preservationTimer) {
    clearTimeout(session.preservationTimer);
    session.preservationTimer = null;
  }
  session.bothDisconnected = false;
  session.storedDuelResult = null;

  // Clear all timer state (turn timer, inactivity, race windows)
  clearAllDuelTimers(session);

  // Release the per-perspective GameLogBuilders. Pending closures (replay
  // persist Promise, fork timeout callbacks) capture `session` by reference,
  // so the builders would otherwise live as long as the longest-running
  // captured callback. Replace with a fresh empty pair: the GC drops the
  // old entries arrays, and any belated outbound message (cleanupDuelSession
  // is idempotent, but a queued setTimeout could still fire) ingests into
  // an empty builder rather than throwing.
  session.gameLog = createSessionGameLog();

  // Close WebSocket connections + per-player grace timers. Reconnect tokens
  // are dropped by sessionManager.terminate() below (it nulls each player's
  // reconnectToken back-pointer too, so this loop only handles WS + timers).
  for (const player of session.players) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.close(1000, 'Duel ended');
    }
    player.ws = null;
    player.connected = false;

    if (player.gracePeriodTimer) {
      clearTimeout(player.gracePeriodTimer);
      player.gracePeriodTimer = null;
    }
  }

  // Drop the session from the manager (activeDuels + pendingTokens of this
  // duel + every reconnectToken on either player). Idempotent — safe under
  // the multi-call cleanup paths (worker exit, rematch expiry, both-disconnect,
  // DELETE /api/duels, connection timeout, post-duel close, preservation).
  getCfg().sessionManager.terminate(session);
}

/** Re-send cached hint + prompt if the player has a pending selection. */
export function resendPendingPrompt(session: ActiveDuelSession, playerIndex: 0 | 1): void {
  if (session.awaitingResponse[playerIndex] && session.lastSentPrompt[playerIndex]) {
    if (session.lastSentHint[playerIndex]) {
      sendToPlayer(session, playerIndex, session.lastSentHint[playerIndex]!);
    }
    sendToPlayer(session, playerIndex, session.lastSentPrompt[playerIndex]!);
  }
}

// Story 5.2 — DRY: reusable state snapshot for reconnection + REQUEST_STATE_SYNC.
// Pre-duel resync (refresh during dice / first-player pick / announce) is
// delegated to `buildPreDuelSnapshot` (pure, easily testable). DUELING-phase
// resync (re-emit DUEL_STARTING + STATE_SYNC + CHAIN_STATE) stays inline.
export function sendStateSnapshot(session: ActiveDuelSession, playerIndex: 0 | 1): void {
  if (session.phase !== 'DUELING') {
    for (const msg of buildPreDuelSnapshot(session, playerIndex)) {
      // DICE_RESULT needs per-player filter (swaps dice0/dice1 so each side
      // reads its own roll as "player 1"). Other messages pass through.
      const out = msg.type === 'DICE_RESULT' ? filterMessage(msg, playerIndex) : msg;
      if (out) sendToPlayer(session, playerIndex, out);
    }
    sendTimerStateToPlayer(session, playerIndex);
    return;
  }

  // Re-send OCGCore player index (lost on page refresh).
  // γ Option C A20 — SOLO reconnect mirrors the initial site: ship both decks
  // so the front rebuilds its prefetch cache for both perspectives.
  sendToPlayer(session, playerIndex, buildDuelStartingMessage(session, playerIndex));
  if (session.lastBoardState && session.lastBoardState.type === 'BOARD_STATE') {
    const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
    const filtered = filterMessage(stateSync, playerIndex);
    if (filtered) sendToPlayer(session, playerIndex, filtered);
  }
  // Re-send active chain links so the client can restore reveal state
  if (session.activeChainLinks.length > 0) {
    sendToPlayer(session, playerIndex, {
      type: 'CHAIN_STATE',
      links: session.activeChainLinks,
      phase: session.chainPhase,
      negatedIndices: [...session.negatedChainIndices],
    } as ServerMessage);
  }
  sendTimerStateToPlayer(session, playerIndex);
}
