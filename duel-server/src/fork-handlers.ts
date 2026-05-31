import type { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { ActiveDuelSession, WorkerReplayPayload } from './types.js';
import { emptyChainState } from './chain-state-tracker.js';
import { createSessionGameLog } from './session-game-log.js';
import type { ServerMessage } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import { attachWorkerHandlers, safeTerminateWorker } from './worker-lifecycle.js';
import { isFullyDisconnected } from './lifecycle-helpers.js';
import { DuelSessionManager } from './duel-session-manager.js';
import * as logger from './logger.js';

/**
 * Fork-solo sessions: a player asks to fork a finished replay at a
 * specific turn, the replay-handlers module spawns a dedicated worker
 * that pre-replays the responses up to the fork point, sanity-checks
 * the resulting board, and then hands the live `Worker` handle over
 * here via `createForkSoloSession`. This module owns the
 * `ActiveDuelSession` construction for fork-solo (parallel to the PvP
 * path in server.ts' POST /api/duels handler).
 *
 * F5-bis (2026-05-31) — fork-solo is now a `soloMode + forkMode` subset
 * of SOLO multiplex. The session goes through the SAME worker handlers
 * (`attachWorkerHandlers` → `handleWorkerMessage` → `broadcastMessage`)
 * as PvP and SOLO multiplex; the only behavioral differences are :
 *   1. **No replay persist** — `worker-message-router.ts` skips the
 *      `WORKER_REPLAY_DATA` persist branch when `session.forkMode`.
 *   2. **No rematch** — `worker-lifecycle.ts handleDuelEnd` skips the
 *      `rematchTimeout` arm when `session.forkMode`.
 *   3. **Log tag** — `broadcastMessage` writes `mode: 'fork_solo'` on
 *      the `DUEL_END` log line.
 *   4. **No turn timer** — inherited from `soloMode: true` (the
 *      `WORKER_DUEL_CREATED` handler skips `timerContext` init in SOLO).
 *
 * All other routing (omniscient filter, 1-socket multiplex via slot 0,
 * chain tracking, game-log ingestion, MSG_CONFIRM_CARDS tagging,
 * winReasonCode, cancel-rollback) is inherited from SOLO multiplex —
 * no separate path remains.
 *
 * Pre-F5-bis, this module also hosted `setupForkWorkerHandlers` which
 * reimplemented a subset of `broadcastMessage`. That parallel
 * implementation has been removed (audit findings F5 + F5-bis).
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
}): { token1: string } {
  const cfg = getCfg();
  const token1 = randomUUID();

  const session: ActiveDuelSession = {
    duelId: forkDuelId,
    phase: 'DUELING',
    firstPlayerState: null,
    chosenFirstPlayer: null,
    players: [
      { playerId: userId, playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      // Slot 1 is reserved but never connected (mirror of SOLO multiplex —
      // see lifecycle-helpers.ts comment block). `isReadyToStart` /
      // `isFullyDisconnected` branch on `soloMode` to read slot 0 only.
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
    forkMode: true,
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

  cfg.sessionManager.register(session, [token1]);

  // H2 — clean up if no client connects within the configured timeout.
  session.forkConnectionTimeout = setTimeout(() => {
    if (isFullyDisconnected(session)) {
      logger.log('ForkSolo: no client connected within timeout — cleaning up', { duelId: forkDuelId });
      safeTerminateWorker(session);
      cfg.cleanupDuelSession(session);
    }
  }, cfg.forkConnectionTimeoutMs);

  // Re-wire the fork worker from the replay-handlers transient handlers
  // to the canonical session-bound ones. Order matters: removeAllListeners
  // FIRST, then attach.
  worker.removeAllListeners('message');
  worker.removeAllListeners('exit');
  worker.removeAllListeners('error');
  session.worker = worker;
  attachWorkerHandlers(session);

  return { token1 };
}
