import type { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ActiveDuelSession, WorkerReplayPayload } from './types.js';
import { applyChainTransition, emptyChainState } from './chain-state-tracker.js';
import { createSessionGameLog, ingestMessage as ingestIntoSessionGameLog } from './session-game-log.js';
import type { ServerMessage, Player } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import { safeSend } from './http-helpers.js';
import { filterMessage } from './message-filter.js';
import { validateWorkerMessage } from './validation/worker-message-validation.js';
import { isSelectMessage } from './worker-message-router.js';
import { safeTerminateWorker, handleDuelEnd } from './worker-lifecycle.js';
import { DuelSessionManager } from './duel-session-manager.js';
import * as logger from './logger.js';

/**
 * Fork-solo sessions: a player asks to fork a finished replay at a
 * specific turn, the replay-handlers module spawns a dedicated worker
 * that pre-replays the responses up to the fork point, sanity-checks
 * the resulting board, and then hands the live `Worker` handle over
 * here via `createForkSoloSession`. This module owns the ActiveDuelSession
 * construction for fork-solo (parallel to the PvP path in server.ts'
 * POST /api/duels handler) and the fork-specific worker handlers.
 *
 * Why a separate handler set instead of reusing `attachWorkerHandlers`
 * from worker-lifecycle:
 *   1. **Omniscient filtering** — fork-solo is single-player; both
 *      `players[0]` and `players[1]` are the same user. `filterMessage`
 *      is called with `omniscient=true` so the player sees both sides
 *      of the board.
 *   2. **No chain tracking / no turn timer / no inactivity timer** —
 *      replay-style; the worker drives turn flow directly.
 *   3. **WORKER_CANCEL_DONE / WORKER_REPLAY_DATA / WORKER_DUEL_CREATED
 *      are not reachable** — the fork worker enters mid-duel after
 *      sanity, so the PvP-specific WORKER_DUEL_CREATED init path
 *      doesn't apply, and replay persist / cancel-rollback are PvP
 *      flows.
 *   4. **MSG_WIN logs `mode: 'fork_solo'`** — for filtering replay
 *      audit logs from PvP duels in the field.
 *
 * The bridge into replay-handlers is `createForkSoloSession`, registered
 * at boot as `createForkSoloSession` in replay-handlers config.
 */

export interface ForkHandlersConfig {
  sessionManager: DuelSessionManager;
  sendToPlayer: (session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage) => void;
  cleanupDuelSession: (session: ActiveDuelSession) => void;
  /** Time before an un-connected fork session self-cleans (H2). */
  forkConnectionTimeoutMs: number;
}

const configurable = createConfigurable<ForkHandlersConfig>('fork-handlers');
export const configureForkHandlers = configurable.configure;
export const isForkHandlersConfigured = configurable.isConfigured;
const getCfg = configurable.get;

export function createForkSoloSession({
  forkDuelId,
  userId,
  worker,
  replayData,
}: {
  forkDuelId: string;
  userId: string;
  worker: Worker;
  replayData: WorkerReplayPayload;
}): { token1: string; token2: string } {
  const cfg = getCfg();
  const token1 = randomUUID();
  const token2 = randomUUID();

  const session: ActiveDuelSession = {
    duelId: forkDuelId,
    phase: 'DUELING',
    firstPlayerState: null,
    chosenFirstPlayer: null,
    players: [
      { playerId: userId, playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      { playerId: userId, playerIndex: 1, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
    ],
    createdAt: Date.now(),
    startedAt: Date.now(),
    endedAt: null,
    worker,
    workerTerminated: false,
    awaitingResponse: [false, false],
    lastBoardState: null,
    lastSentPrompt: [null, null],
    lastSentHint: [null, null],
    decks: replayData.decks,
    rematchRequested: [false, false],
    rematchTimeout: null,
    preservationTimer: null,
    bothDisconnected: false,
    combinedGraceTimer: null,
    storedDuelResult: null,
    lastStateSyncAt: [0, 0],
    lastCancelAt: [0, 0],
    cancelTargetPrompt: [null, null],
    timerContext: null,
    soloMode: true,
    skipShuffle: true,
    turnTimeSecs: 300,
    invalidResponseCount: [0, 0],
    promptSentAt: [0, 0],
    ...emptyChainState(),
    playerUsernames: replayData.metadata.playerUsernames,
    deckNames: replayData.metadata.deckNames,
    pendingReplayResult: null,
    forkConnectionTimeout: null,
    gameLog: createSessionGameLog(),
  };

  cfg.sessionManager.register(session, [token1, token2]);

  // H2 — clean up if no client connects within the configured timeout.
  session.forkConnectionTimeout = setTimeout(() => {
    if (!session.players[0].connected && !session.players[1].connected) {
      logger.log('ForkSolo: no client connected within timeout — cleaning up', { duelId: forkDuelId });
      safeTerminateWorker(session);
      cfg.cleanupDuelSession(session);
    }
  }, cfg.forkConnectionTimeoutMs);

  // Re-wire the fork worker from the replay-handlers transient handlers
  // to the session-bound ones. Order matters: removeAllListeners FIRST,
  // then attach.
  worker.removeAllListeners('message');
  worker.removeAllListeners('exit');
  worker.removeAllListeners('error');
  setupForkWorkerHandlers(session, worker);

  return { token1, token2 };
}

function setupForkWorkerHandlers(session: ActiveDuelSession, worker: Worker): void {
  const cfg = getCfg();
  const send = cfg.sendToPlayer;

  worker.on('message', (raw: unknown) => {
    const wmsg = validateWorkerMessage(raw);
    if (!wmsg) {
      logger.error('Dropping malformed fork worker message', { duelId: session.duelId, raw });
      return;
    }

    if (wmsg.type === 'WORKER_MESSAGE') {
      const message = wmsg.message;

      // F5 (2026-05-31) — bits mirrored from `broadcastMessage`
      // (worker-message-router.ts). The two paths diverged because fork-
      // solo originally reimplemented a sub-set ; the fix here adds back
      // the missing pieces so the user-facing experience is the same.
      // KEEP IN SYNC WITH `broadcastMessage` until the architectural
      // unification (audit finding F5-bis) collapses both paths into one.

      // (1) Game-log ingestion — was MISSING in fork-solo : the gameLog
      // allocated at `createForkSoloSession` was orphaned (never fed).
      // Now an F5 mid-fork repopulates the journal from the snapshot.
      if (session.gameLog) ingestIntoSessionGameLog(session.gameLog, message);

      // MSG_WIN → generated DUEL_END (mirrors broadcastMessage in PvP,
      // tagged with mode: 'fork_solo' for log filtering).
      if (message.type === 'MSG_WIN') {
        // (2) F5 (2026-05-31) — propagate the raw OCGCore `!victory`
        // code as `winReasonCode` so the client UI can localize the
        // exact win reason (LP=0 vs deck-out vs Exodia) instead of a
        // generic "win" label. Was MISSING in fork-solo.
        const endMsg: ServerMessage = {
          type: 'DUEL_END', winner: message.player, reason: 'win', winReasonCode: message.reason,
        };
        logger.log('DUEL_END', {
          duelId: session.duelId, winner: message.player, reason: 'win', mode: 'fork_solo',
        });
        send(session, 0, endMsg);
        send(session, 1, endMsg);
        handleDuelEnd(session);
      }

      // (3) Server-side chain state mirror — was MISSING in fork-solo.
      // Without it, an F5 mid-chain loses the active chain links
      // (`server.ts` reconnect path reads `session.activeChainLinks` to
      // decide whether to re-emit CHAIN_STATE). Now the tracker
      // accumulates the state alongside SOLO multiplex.
      applyChainTransition(session, message);

      // (4) MSG_CONFIRM_CARDS chainIndex tag — was MISSING in fork-solo.
      // The client's prompt-reveal filter narrows on this tag to show
      // ONLY the reveals belonging to the currently-resolving chain
      // link ; without the tag, multi-link forks mix reveals across
      // links. Now tagged identically to SOLO multiplex.
      if (message.type === 'MSG_CONFIRM_CARDS' && session.currentSolvingChainIndex !== null) {
        (message as { chainIndex?: number }).chainIndex = session.currentSolvingChainIndex;
      }

      if (message.type === 'BOARD_STATE') {
        session.lastBoardState = message;
      }

      if (isSelectMessage(message)) {
        const targetPlayer = (message as { player: Player }).player;
        session.awaitingResponse[targetPlayer] = true;
      }

      // Omniscient filter — both player ports show both sides of the
      // board. The readyState gate is a fast-path that skips
      // filterMessage for closed sockets; safeSend covers the
      // close-between-check-and-send race.
      for (const [idx, ps] of session.players.entries()) {
        if (ps.ws?.readyState === WebSocket.OPEN) {
          const filtered = filterMessage(message, idx as 0 | 1, true);
          if (filtered) {
            if (isSelectMessage(message) && (message as { player: Player }).player === idx) {
              session.lastSentPrompt[idx] = filtered;
            }
            if (message.type === 'MSG_HINT') {
              session.lastSentHint[idx] = filtered;
            }
            safeSend(ps.ws, filtered);
          }
        }
      }
    } else if (wmsg.type === 'WORKER_ERROR') {
      logger.error('ForkSolo worker error', { duelId: session.duelId, error: wmsg.error });
    } else if (wmsg.type === 'WORKER_RETRY') {
      // Re-send last prompt to the relevant player.
      for (const [idx, ps] of session.players.entries()) {
        if (session.lastSentPrompt[idx]) {
          safeSend(ps.ws, session.lastSentPrompt[idx]);
        }
      }
    }
  });

  worker.on('exit', (code) => {
    logger.log('ForkSolo worker exited', { duelId: session.duelId, exitCode: code });
    session.workerTerminated = true;
  });

  worker.on('error', (err: Error) => {
    logger.error('ForkSolo worker thread error', { duelId: session.duelId, error: err.message });
  });
}
