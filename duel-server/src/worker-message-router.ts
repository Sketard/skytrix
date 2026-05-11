import type { ActiveDuelSession, WorkerToMainMessage } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import { filterMessage } from './message-filter.js';
import { applyChainTransition } from './chain-state-tracker.js';
import {
  handleTurnChange,
  scheduleTimerStart,
  startInactivityTimer,
  sendTimerStateToAll,
} from './timer-management.js';
import {
  handleDuelEnd,
  requestReplayFromWorker,
  safeTerminateWorker,
} from './worker-lifecycle.js';
import { persistReplay } from './replay-persist.js';
import * as logger from './logger.js';

/**
 * Inbound worker message routing + outbound client broadcast.
 *
 * `handleWorkerMessage` dispatches on the worker-to-main message kind
 * (WORKER_DUEL_CREATED / WORKER_MESSAGE / WORKER_RETRY / WORKER_CANCEL_DONE /
 * WORKER_ERROR / WORKER_REPLAY_DATA). Five of the six branches end with
 * `broadcastMessage` (the WORKER_MESSAGE pass-through), or with one of the
 * lifecycle helpers (handleDuelEnd, safeTerminateWorker,
 * requestReplayFromWorker, persistReplay).
 *
 * `broadcastMessage` is the outbound side: it detects natural duel-end
 * (DUEL_END / MSG_WIN), updates server-side chain state, tags
 * MSG_CONFIRM_CARDS with the current chainIndex, caches the latest
 * BOARD_STATE for late-connecting players, arms response/inactivity
 * timers on SELECT_*, and finally runs each outbound message through
 * `filterMessage` per player.
 *
 * The module owns no state of its own: it reads + mutates fields on the
 * passed `session` object exactly as the inline pre-extraction code did.
 *
 * `sendToPlayer` is injected (server.ts has 37 inline call sites, so
 * keeping its implementation there avoids duplicating the safeSend
 * helper).
 *
 * The `WORKER_CANCEL_DONE` branch is intentionally verbose — for the
 * full inventory of state slots reset across the cancel flow (worker +
 * server + client), see
 * `_bmad-output/planning-artifacts/cancel-rollback-contract.md`.
 */

export interface WorkerMessageRouterConfig {
  sendToPlayer: (session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage) => void;
  /** Per-player strike count before forfeit on engine-reject (MSG_RETRY storm). */
  maxInvalidResponses: number;
}

const configurable = createConfigurable<WorkerMessageRouterConfig>('worker-message-router');
export const configureWorkerMessageRouter = configurable.configure;
export const isWorkerMessageRouterConfigured = configurable.isConfigured;
const getCfg = configurable.get;

const SELECT_TYPES = new Set([
  'SELECT_IDLECMD', 'SELECT_BATTLECMD', 'SELECT_CARD', 'SELECT_CHAIN',
  'SELECT_EFFECTYN', 'SELECT_YESNO', 'SELECT_PLACE', 'SELECT_DISFIELD',
  'SELECT_POSITION', 'SELECT_OPTION', 'SELECT_TRIBUTE', 'SELECT_SUM',
  'SELECT_UNSELECT_CARD', 'SELECT_COUNTER', 'SORT_CARD', 'SORT_CHAIN',
  'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_CARD', 'ANNOUNCE_NUMBER',
  'RPS_CHOICE',
]);

export function isSelectMessage(message: ServerMessage): boolean {
  return SELECT_TYPES.has(message.type);
}

export function handleWorkerMessage(session: ActiveDuelSession, wmsg: WorkerToMainMessage): void {
  const cfg = getCfg();
  const send = cfg.sendToPlayer;

  switch (wmsg.type) {
    case 'WORKER_DUEL_CREATED':
      logger.log('Duel created in worker', { duelId: wmsg.duelId });
      session.startedAt = Date.now();
      session.timerContext = {
        pools: [session.turnTimeSecs * 1000, session.turnTimeSecs * 1000],
        running: false,
        activePlayer: 0,
        intervalRef: null,
        lastTickMs: 0,
        turnCount: 0,
        pendingPlayer: null,
        pendingTimeout: null,
      };
      // Note: no-ops if players haven't connected yet —
      // sendTimerStateToPlayer covers on connection.
      sendTimerStateToAll(session);
      break;

    case 'WORKER_MESSAGE':
      broadcastMessage(session, wmsg.message);
      break;

    case 'WORKER_RETRY': {
      // OCGCore rejected the player's response — re-send the cached prompt.
      // lastSentPrompt is intentionally NOT cleared on PLAYER_RESPONSE for
      // exactly this case.
      const p = wmsg.playerIndex;
      const cached = session.lastSentPrompt[p];
      if (cached) {
        session.invalidResponseCount[p]++;
        logger.warn('RETRY: re-sending prompt', {
          duelId: session.duelId,
          retryCount: session.invalidResponseCount[p],
          promptType: cached.type,
          player: p,
        });

        if (session.invalidResponseCount[p] >= cfg.maxInvalidResponses) {
          const winner: Player = p === 0 ? 1 : 0;
          const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'too_many_invalid_responses' };
          logger.log('DUEL_END', { duelId: session.duelId, winner, reason: 'too_many_invalid_responses' });
          send(session, 0, endMsg);
          send(session, 1, endMsg);
          handleDuelEnd(session);
          requestReplayFromWorker(session, 'TIMEOUT');
          return;
        }

        session.awaitingResponse[p] = true;
        send(session, p, cached);
      }
      break;
    }

    case 'WORKER_CANCEL_DONE': {
      // P0-3bis.3 — the worker has rolled back to the IDLECMD/BATTLECMD
      // boundary. Re-broadcast the IDLECMD/BATTLECMD prompt cached at
      // commit time so the client returns to the action menu. NOT
      // counted as a retry. See cancel-rollback-contract.md for the
      // full inventory of state slots reset across this flow.
      const p = wmsg.playerIndex;
      const cached = session.cancelTargetPrompt[p];
      if (cached) {
        logger.log('CANCEL: re-broadcasting IDLECMD/BATTLECMD prompt', {
          duelId: session.duelId, promptType: cached.type, player: p,
        });

        // STATE_SYNC + empty CHAIN_STATE so the client's reset machinery
        // runs (processor.reset + commitAll + clear pendingPrompt + clear
        // chain overlay). Same path as a reconnection re-sync.
        if (session.lastBoardState && session.lastBoardState.type === 'BOARD_STATE') {
          const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
          const filtered = filterMessage(stateSync, p);
          if (filtered) send(session, p, filtered);
        }
        send(session, p, {
          type: 'CHAIN_STATE', links: [], phase: 'idle', negatedIndices: [],
        } as ServerMessage);

        // Mirror server-side chain bookkeeping so a subsequent
        // reconnect-resync sends the same empty chain.
        session.activeChainLinks = [];
        session.chainPhase = 'idle';
        session.negatedChainIndices.clear();
        session.currentSolvingChainIndex = null;

        // Hint replayed verbatim on reconnect would point at an effect
        // that no longer exists — drop it.
        session.lastSentHint[p] = null;

        // Cancel is a legitimate user action — don't accumulate retry
        // strikes toward `maxInvalidResponses`.
        session.invalidResponseCount[p] = 0;

        session.lastSentPrompt[p] = cached;
        session.awaitingResponse[p] = true;
        send(session, p, cached);
        // Drop the cache — the prompt is now in flight and a future
        // commit will re-snapshot it.
        session.cancelTargetPrompt[p] = null;
      } else {
        logger.warn('CANCEL: no cached IDLECMD/BATTLECMD to re-broadcast', { duelId: session.duelId, player: p });
      }
      break;
    }

    case 'WORKER_ERROR': {
      logger.error('Worker error', { duelId: wmsg.duelId, error: wmsg.error });
      const errorMsg: ServerMessage = { type: 'DUEL_END', winner: null, reason: 'worker_error' };
      logger.log('DUEL_END', { duelId: session.duelId, winner: null, reason: 'engine_error' });
      send(session, 0, errorMsg);
      send(session, 1, errorMsg);
      handleDuelEnd(session);
      safeTerminateWorker(session);
      break;
    }

    case 'WORKER_REPLAY_DATA': {
      logger.log('Received WORKER_REPLAY_DATA', { duelId: wmsg.duelId, responses: wmsg.payload.playerResponses.length });
      persistReplay(session, wmsg.payload).finally(() => {
        safeTerminateWorker(session);
      });
      break;
    }
  }
}

export function broadcastMessage(session: ActiveDuelSession, message: ServerMessage): void {
  const cfg = getCfg();
  const send = cfg.sendToPlayer;

  // Natural DUEL_END from worker (LP=0, deck-out, etc.)
  if (message.type === 'DUEL_END') {
    logger.log('DUEL_END', { duelId: session.duelId, winner: message.winner, reason: 'worker' });
    handleDuelEnd(session);
  }

  // Natural game end via MSG_WIN — generate DUEL_END for clients.
  // The worker sends MSG_WIN (not DUEL_END) for LP=0, deck-out, Exodia.
  if (message.type === 'MSG_WIN') {
    const endMsg: ServerMessage = { type: 'DUEL_END', winner: message.player, reason: 'win' };
    logger.log('DUEL_END', { duelId: session.duelId, winner: message.player, reason: 'win' });
    send(session, 0, endMsg);
    send(session, 1, endMsg);
    handleDuelEnd(session);
  }

  // Server-side chain state mirror (for reconnect resync).
  applyChainTransition(session, message);

  // M22 — Tag MSG_CONFIRM_CARDS with the currently-resolving link's
  // chainIndex so the client can filter prompt reveals per-link.
  if (message.type === 'MSG_CONFIRM_CARDS' && session.currentSolvingChainIndex !== null) {
    (message as { chainIndex?: number }).chainIndex = session.currentSolvingChainIndex;
  }

  // Cache last BOARD_STATE for late-connecting players + detect turn change.
  if (message.type === 'BOARD_STATE') {
    session.lastBoardState = message;
    handleTurnChange(session, message.data.turnPlayer, message.data.turnCount);
  }

  // SELECT_* — arm response/inactivity timers + drop stale cancel cache.
  if (isSelectMessage(message)) {
    const targetPlayer = (message as { player: Player }).player;
    logger.debug('SELECT prompt sent', {
      duelId: session.duelId, type: message.type, player: targetPlayer,
      timerRunning: session.timerContext?.running,
    });
    session.awaitingResponse[targetPlayer] = true;
    session.promptSentAt[targetPlayer] = Date.now();
    const opponentOfTarget: 0 | 1 = targetPlayer === 0 ? 1 : 0;
    send(session, opponentOfTarget, { type: 'WAITING_RESPONSE' });
    scheduleTimerStart(session, targetPlayer);
    startInactivityTimer(session, targetPlayer);
    // P0-3bis.3 — a fresh IDLECMD/BATTLECMD = new rollback boundary.
    if (message.type === 'SELECT_IDLECMD' || message.type === 'SELECT_BATTLECMD') {
      session.cancelTargetPrompt[targetPlayer] = null;
    }
  }

  // Per-player perspective filter + reconnection caches.
  for (const playerIndex of [0, 1] as const) {
    const filtered = filterMessage(message, playerIndex);
    if (filtered) {
      if (isSelectMessage(message) && (message as { player: Player }).player === playerIndex) {
        session.lastSentPrompt[playerIndex] = filtered;
      }
      if (message.type === 'MSG_HINT') {
        session.lastSentHint[playerIndex] = filtered;
      }
      send(session, playerIndex, filtered);
    }
  }
}
