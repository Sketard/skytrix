import { Worker } from 'node:worker_threads';
import { WebSocket } from 'ws';
import type { ActiveDuelSession } from './types.js';
import type { ServerMessage } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import type { DuelSessionManager } from './duel-session-manager.js';
import { createSessionGameLog } from './session-game-log.js';
import { resetSessionForRematch } from './session-factory.js';
import { disposeFirstPlayer } from './first-player-coordinator.js';
import { clearAllDuelTimers, sendTimerStateToPlayer } from './timer-management.js';
import { filterMessage } from './message-filter.js';
import { buildPreDuelSnapshot } from './pre-duel-snapshot.js';
import { buildDuelStartingMessage } from './lifecycle-helpers.js';
import { attachWorkerHandlers } from './worker-lifecycle.js';
import { safeTerminateWorker } from './duel-end-coordinator.js';
import { getScriptsHash, getOcgcoreVersion } from './ocg-scripts.js';
import { sendToPlayer } from './ws-write.js';

/**
 * Per-session lifecycle helpers extracted from server.ts.
 *
 * Six responsibilities owned by this module since U32 #3a + #3b
 * (audit-4-modes-2026-06-01):
 *
 *   1. `cleanupDuelSession` — idempotent teardown of an
 *      `ActiveDuelSession`. Clears every timer slot tracked on the
 *      session, closes both player WebSockets, releases the
 *      `GameLogBuilder` pair to a fresh empty pair (so any belated
 *      outbound message can still ingest without throwing), and drops
 *      the session from the `DuelSessionManager` (which also nulls the
 *      `reconnectToken` back-pointers on each player). Called from 5
 *      direct sites + 3 modules via cfg (worker-lifecycle on
 *      unexpected exit, fork-handlers on no-connect timeout,
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
 *      Consumed by the pvp-connection-handler (initial connect +
 *      reconnect) and by `REQUEST_STATE_SYNC` via the
 *      `client-message-router` cfg hook.
 *
 *   3. `resendPendingPrompt` — re-emit the cached hint + prompt for a
 *      player who has `awaitingResponse[p] === true`. Sent on every
 *      reconnect and on REQUEST_STATE_SYNC. SOLO multiplex calls it
 *      for BOTH slots (single socket carries both server identities;
 *      γ Option C A29).
 *
 *   4. `startRematch` — full rematch transition. Sends REMATCH_STARTING
 *      to both players, terminates the worker, resets the per-duel
 *      session state via `resetSessionForRematch`, and either spawns a
 *      fresh worker via `startDuelWithOrder` (SOLO — keeps the same
 *      starting player) or re-enters the pre-duel dice flow via
 *      `startFirstPlayerPhase` (PvP normal — re-roll).
 *
 *   5. `rematchExpired` — fires when the rematch invitation timer
 *      expires. Sends REMATCH_CANCELLED to both players and runs
 *      `cleanupDuelSession`. Wired into `DuelEndCoordinator.handleDuelEnd`'s
 *      `onRematchExpired` callback at boot.
 *
 *   6. `startDuelWithOrder` — bridge between the first-player coordinator
 *      and the duel worker spawn. Swaps `players[]` + `decks` if
 *      `firstPlayer === 1`, sends DUEL_STARTING to each player (SOLO
 *      sends bothCardCodes on slot 0), spawns the OCGCore worker, and
 *      posts INIT_DUEL. Worker URL is resolved relative to this module
 *      (`new URL('./duel-worker.js', import.meta.url)`) — duel-worker.js
 *      lives in the same `duel-server/src/` directory.
 *
 * Pattern : `createConfigurable<SessionOrchestratorConfig>` with a
 * minimal config surface — the `DuelSessionManager` instance + the
 * `dataDir` path (passed as `workerData` to each Worker spawn). All
 * other collaborators are imported directly (pure functions or
 * already-configured module exports).
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
  /**
   * Absolute path of the runtime data directory — passed as
   * `workerData.dataDir` to each freshly-spawned duel worker. server.ts
   * resolves this at boot via `resolve(process.env['DATA_DIR'] ?? ...)`.
   */
  dataDir: string;
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

/**
 * Full rematch transition. The PvP path re-enters the pre-duel dice
 * coordinator (re-roll for turn order, exactly like a fresh duel) ;
 * SOLO keeps the same starting player and spawns a new worker
 * immediately. `startRematch` is invoked by `client-message-router`
 * when both players (or the lone SOLO user) have requested a rematch.
 */
export function startRematch(session: ActiveDuelSession): void {
  if (session.rematchTimeout) {
    clearTimeout(session.rematchTimeout);
    session.rematchTimeout = null;
  }

  sendToPlayer(session, 0, { type: 'REMATCH_STARTING' });
  sendToPlayer(session, 1, { type: 'REMATCH_STARTING' });

  // Remove old worker handlers to prevent cleanupDuelSession on exit
  safeTerminateWorker(session);

  // Reset all per-duel session state. The worker is NOT spawned here —
  // animations-ready-protocol-2026-06-05 (review F1) hoists the worker
  // spawn into the `onAnimationsReady` hook, gated on
  // `phase === 'WAITING_PLAYERS'`. `resetSessionForRematch` flips
  // `session.phase = 'WAITING_PLAYERS'` + `animationsReady = [false,
  // false]` so the rematch path waits for the client(s) to re-emit
  // ANIMATIONS_READY (driven by `DuelLoadingEffectsService`'s rematch
  // effect on REMATCH_STARTING). The dispatch (startDuelWithOrder for
  // SOLO, startFirstPlayerPhase for PvP) lives in `server.ts`
  // `onAnimationsReady` — same site as the fresh-connect path.
  //
  // U15 (audit-4-modes-2026-06-01) — per-duel state wipe consolidated in
  // `resetSessionForRematch`. Long-lived fields (decks, soloMode, forkMode,
  // playerUsernames, deckNames, turnTimeSecs, players) are preserved.
  disposeFirstPlayer(session);
  resetSessionForRematch(session);

  clearAllDuelTimers(session);
}

/**
 * Fires when the rematch invitation timer expires (set by
 * `DuelEndCoordinator.handleDuelEnd`). Sends REMATCH_CANCELLED to both
 * players and tears down the session. Wired into the coordinator's
 * `onRematchExpired` callback at boot.
 */
export function rematchExpired(session: ActiveDuelSession): void {
  session.rematchTimeout = null;
  sendToPlayer(session, 0, { type: 'REMATCH_CANCELLED', reason: 'timeout' });
  sendToPlayer(session, 1, { type: 'REMATCH_CANCELLED', reason: 'timeout' });
  cleanupDuelSession(session);
}

/**
 * Bridge between the first-player coordinator (PvP dice flow) and the
 * duel-worker spawn. Swaps `players[]` + `decks` if `firstPlayer === 1`
 * so OCGCore always sees the chosen starter at index 0, then sends
 * DUEL_STARTING to each player (SOLO multiplex sends bothCardCodes on
 * slot 0 — see γ Option C A1bis), spawns the OCGCore worker
 * with `workerData.dataDir`, attaches its handlers via
 * `attachWorkerHandlers`, and posts the INIT_DUEL message.
 *
 * Worker URL is resolved relative to THIS module — duel-worker.js
 * lives next to it in `duel-server/src/`.
 *
 * MUST stay a `function` declaration (not `const = (...) =>`) :
 * `first-player-coordinator.ts` imports this binding through an ES
 * module cycle. Function declarations are added to the module
 * environment record at INSTANTIATION (link phase, before evaluation),
 * so the cycle resolves cleanly. Converting to `const` or arrow would
 * make the binding TDZ-only at the importing site, yielding a
 * `ReferenceError: Cannot access 'startDuelWithOrder' before
 * initialization` at the first dice resolution.
 */
export function startDuelWithOrder(session: ActiveDuelSession, firstPlayer: 0 | 1): void {
  const cfg = getCfg();
  session.phase = 'DUELING';
  disposeFirstPlayer(session);

  // Swap decks and player sessions so firstPlayer becomes OCGCore player 0
  let decks = session.decks;
  if (firstPlayer === 1) {
    decks = [session.decks[1], session.decks[0]];
    session.decks = decks;
    // Swap player sessions so players[0] = OCGCore player 0
    const [p0, p1] = session.players;
    session.players = [p1, p0];
    session.players[0].playerIndex = 0;
    session.players[1].playerIndex = 1;
    cfg.sessionManager.remapReconnectTokensAfterSwap(session);
    // Swap usernames + deckNames pour rester aligné avec players[] : tout au
    // long du duel (live + replay persisté) `playerUsernames[i]` doit décrire
    // OCGCore player `i`, et `replay-persist` lit `session.players[i].playerId`
    // → toute désynchro ici décale les pseudos/decks par rapport aux IDs
    // persistés côté Spring (bug "vs admin au lieu de vs admin2", 2026-05-17).
    session.playerUsernames = [session.playerUsernames[1], session.playerUsernames[0]];
    session.deckNames = [session.deckNames[1], session.deckNames[0]];
  }

  // Tell each player their OCGCore index (after potential swap). Each side
  // receives only their own decklist's card codes — sending the union would
  // let the opponent's deck be reconstructed from the upfront image prefetch.
  // γ Option C A1bis — SOLO multiplex sends a single DUEL_STARTING on socket 0
  // carrying BOTH decks (the user is both players; both perspectives need
  // their images pre-fetched). PvP normal stays per-player.
  if (session.soloMode) {
    sendToPlayer(session, 0, buildDuelStartingMessage(session, 0));
  } else {
    sendToPlayer(session, 0, buildDuelStartingMessage(session, 0));
    sendToPlayer(session, 1, buildDuelStartingMessage(session, 1));
  }

  // Spawn worker
  const worker = new Worker(new URL('./duel-worker.js', import.meta.url), {
    workerData: { dataDir: cfg.dataDir },
  });

  session.worker = worker;
  session.workerTerminated = false;
  session.awaitingResponse = [false, false];
  session.lastSentPrompt = [null, null];
  session.lastSentHint = [null, null];
  session.startedAt = Date.now();

  attachWorkerHandlers(session);

  // v4 Phase 0 — when a tape player is attached, forward its captured
  // seed so OCGCore produces the same card pile as the replay this
  // session was bootstrapped from. Production sessions leave this
  // undefined → worker calls `generateSeed()` as usual.
  const tapeSeed = (session as { tapePlayer?: { seed: readonly string[] } }).tapePlayer?.seed;
  worker.postMessage({
    type: 'INIT_DUEL',
    duelId: session.duelId,
    decks,
    playerUsernames: session.playerUsernames,
    deckNames: session.deckNames,
    skipRps: true, // Always skip OCGCore's RPS — we handle it at app layer
    skipShuffle: session.skipShuffle,
    scriptsHash: getScriptsHash(),
    ocgcoreVersion: getOcgcoreVersion(),
    ...(tapeSeed && { seed: [...tapeSeed] }),
  });
}
