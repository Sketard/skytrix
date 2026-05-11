import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, ClientMessage, Player } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import { safeSend } from './http-helpers.js';
import { validateResponseData } from './validation/response-validation.js';
import {
  pauseTurnTimer, startTurnTimer,
  startInactivityTimer, clearInactivityTimer,
} from './timer-management.js';
import { handleDuelEnd, requestReplayFromWorker } from './worker-lifecycle.js';
import { handlePreDuelResponse } from './rps-coordinator.js';
import * as logger from './logger.js';

/**
 * Inbound client message routing — the mirror of `worker-message-router.ts`
 * on the client side. Dispatches the 7 ClientMessage kinds:
 *   PLAYER_RESPONSE | SURRENDER | REMATCH_REQUEST | REQUEST_STATE_SYNC |
 *   ACTIVITY_PING | ANIMATIONS_DONE | CANCEL_PROMPT_SEQUENCE
 *
 * Owns the validation + side-effects for each: awaitingResponse gating
 * (anti-spam), M28 promptType match guard, the
 * `validateResponseData → strike count → forfeit` loop (mirrors
 * WORKER_RETRY in worker-message-router), the CANCEL_PROMPT_SEQUENCE
 * 4-guard precondition stack, REQUEST_STATE_SYNC rate-limit, and the
 * cancelTargetPrompt snapshot at IDLECMD/BATTLECMD commit time.
 *
 * The module owns no state: it reads + mutates fields on the passed
 * `session` exactly as the inline pre-extraction code did.
 *
 * Three host-defined callbacks are injected (server.ts has the only
 * implementations and they're stable inline closures):
 *   - `sendToPlayer` — WS write helper (37 call-sites in server.ts)
 *   - `startRematch` — full rematch transition (terminate worker, spawn
 *     fresh, reset session state)
 *   - `sendStateSnapshot` + `resendPendingPrompt` — REQUEST_STATE_SYNC
 *     plumbing; bundled as a single `onStateSyncRequested` hook for
 *     simplicity since they always fire together.
 */

export interface ClientMessageRouterConfig {
  sendToPlayer: (session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage) => void;
  startRematch: (session: ActiveDuelSession) => void;
  /**
   * Called for REQUEST_STATE_SYNC after the rate-limit guard passes.
   * Wired in server.ts to `sendStateSnapshot(session, p) +
   * resendPendingPrompt(session, p)` — bundled so the router doesn't
   * carry two separate hooks that always fire together.
   */
  onStateSyncRequested: (session: ActiveDuelSession, playerIndex: 0 | 1) => void;
  /** Per-player strike count before forfeit on invalid-response storm. */
  maxInvalidResponses: number;
  /** Minimum interval between REQUEST_STATE_SYNC from the same player (anti-spam). */
  stateSyncRateLimitMs: number;
  /** Minimum interval between CANCEL_PROMPT_SEQUENCE from the same player (anti-flood). */
  cancelPromptRateLimitMs: number;
}

const configurable = createConfigurable<ClientMessageRouterConfig>('client-message-router');
export const configureClientMessageRouter = configurable.configure;
export const isClientMessageRouterConfigured = configurable.isConfigured;
const getCfg = configurable.get;

const ALLOWED_CLIENT_TYPES = new Set([
  'PLAYER_RESPONSE', 'SURRENDER', 'REMATCH_REQUEST',
  'REQUEST_STATE_SYNC', 'ACTIVITY_PING', 'ANIMATIONS_DONE',
  'CANCEL_PROMPT_SEQUENCE',
]);

export function handleClientMessage(session: ActiveDuelSession, playerIndex: 0 | 1, msg: ClientMessage): void {
  if (!ALLOWED_CLIENT_TYPES.has(msg.type)) {
    logger.error('Invalid message type', { duelId: session.duelId, player: playerIndex, type: msg.type });
    return;
  }

  const cfg = getCfg();
  const send = cfg.sendToPlayer;

  switch (msg.type) {
    case 'PLAYER_RESPONSE': {
      logger.debug('PLAYER_RESPONSE', {
        duelId: session.duelId, player: playerIndex, promptType: msg.promptType,
        awaiting: session.awaitingResponse.slice(),
        lastPrompt: session.lastSentPrompt[playerIndex]?.type,
      });

      // awaitingResponse gate — anti-spam / anti-out-of-sequence.
      if (!session.awaitingResponse[playerIndex]) {
        logger.error('Unexpected PLAYER_RESPONSE', { duelId: session.duelId, player: playerIndex });
        return;
      }

      // M28 — promptType must match the prompt we sent last.
      const expectedPrompt = session.lastSentPrompt[playerIndex];
      if (expectedPrompt && msg.promptType !== expectedPrompt.type) {
        safeSend(session.players[playerIndex].ws, {
          type: 'ERROR',
          message: `Expected prompt type ${expectedPrompt.type}, got ${msg.promptType}`,
        });
        return;
      }

      // Pre-duel RPS / TP responses are handled at the application layer.
      if (session.phase !== 'DUELING') {
        if (handlePreDuelResponse(session, playerIndex, msg.promptType, msg.data as unknown as Record<string, unknown>)) return;
      }

      // FFI-safety bounds check + strike-count loop.
      if (expectedPrompt) {
        const validation = validateResponseData(expectedPrompt, msg.data as unknown as Record<string, unknown>);
        if (!validation.ok) {
          logger.warn('Invalid response data — re-sending prompt', {
            duelId: session.duelId, player: playerIndex, reason: validation.error,
          });
          session.invalidResponseCount[playerIndex]++;
          if (session.invalidResponseCount[playerIndex] >= cfg.maxInvalidResponses) {
            const winner: Player = playerIndex === 0 ? 1 : 0;
            const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'too_many_invalid_responses' };
            logger.log('DUEL_END', { duelId: session.duelId, winner, reason: 'too_many_invalid_responses' });
            send(session, 0, endMsg);
            send(session, 1, endMsg);
            handleDuelEnd(session);
            requestReplayFromWorker(session, 'TIMEOUT');
            return;
          }
          // Re-send like a RETRY.
          send(session, playerIndex, expectedPrompt);
          return;
        }
      }

      session.invalidResponseCount[playerIndex] = 0;
      session.awaitingResponse[playerIndex] = false;
      // lastSentPrompt kept — WORKER_RETRY (OCGCore reject) needs it.
      // Overwritten by the next SELECT prompt broadcast.
      session.lastSentHint[playerIndex] = null;

      // P0-3bis.3 — snapshot the prompt on IDLECMD/BATTLECMD commit so
      // the cancel handler can restore it. The worker takes its WASM
      // snapshot at the same boundary; we mirror server-side because
      // lastSentPrompt gets overwritten by intermediate SELECT_PLACE/
      // SELECT_TRIBUTE/SELECT_POSITION before the user can right-click
      // to cancel.
      if (msg.promptType === 'SELECT_IDLECMD' || msg.promptType === 'SELECT_BATTLECMD') {
        session.cancelTargetPrompt[playerIndex] = expectedPrompt ?? null;
      }

      pauseTurnTimer(session);
      clearInactivityTimer(session, playerIndex as Player);

      // Forward to worker (bluff timer disabled — immediate).
      if (session.endedAt || !session.worker) return;
      session.worker.postMessage({
        type: 'PLAYER_RESPONSE',
        playerIndex,
        promptType: msg.promptType,
        data: msg.data,
      });
      break;
    }

    case 'SURRENDER': {
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      const endMsg: ServerMessage = { type: 'DUEL_END', winner: opponentIndex, reason: 'surrender' };
      logger.log('DUEL_END', {
        duelId: session.duelId, winner: opponentIndex, reason: 'surrender', player: playerIndex,
      });
      send(session, 0, endMsg);
      send(session, 1, endMsg);
      handleDuelEnd(session);
      requestReplayFromWorker(session, 'SURRENDER');
      break;
    }

    case 'REMATCH_REQUEST': {
      // Only valid post-duel.
      if (session.endedAt === null) break;
      session.rematchRequested[playerIndex] = true;
      const opponentIdx: Player = playerIndex === 0 ? 1 : 0;
      if (session.rematchRequested[opponentIdx]) {
        cfg.startRematch(session);
      } else {
        send(session, opponentIdx, { type: 'REMATCH_INVITATION' });
      }
      break;
    }

    case 'ACTIVITY_PING': {
      // Reset inactivity if the player is being prompted (anti-AFK).
      if (session.awaitingResponse[playerIndex]) {
        clearInactivityTimer(session, playerIndex as Player);
        startInactivityTimer(session, playerIndex as Player);
      }
      break;
    }

    case 'ANIMATIONS_DONE': {
      // Commit a pending turn-timer arm now that the prompted player
      // has finished their inbound animation queue.
      const ctx = session.timerContext;
      if (ctx && ctx.pendingPlayer === playerIndex) {
        if (ctx.pendingTimeout) {
          clearTimeout(ctx.pendingTimeout);
          ctx.pendingTimeout = null;
        }
        ctx.pendingPlayer = null;
        startTurnTimer(session);
      }
      break;
    }

    case 'REQUEST_STATE_SYNC': {
      const now = Date.now();
      if (now - session.lastStateSyncAt[playerIndex] < cfg.stateSyncRateLimitMs) break;
      session.lastStateSyncAt[playerIndex] = now;
      cfg.onStateSyncRequested(session, playerIndex);
      break;
    }

    case 'CANCEL_PROMPT_SEQUENCE': {
      // P0-3bis.3 — roll back to the most recent IDLECMD/BATTLECMD
      // snapshot. Four guards (cancel-rollback-contract.md):
      //   1. Phase must be DUELING (pre-duel RPS can also have
      //      awaitingResponse=true without an active worker).
      //   2. Per-player rate-limit (bounds malicious flood cost).
      //   3. awaitingResponse — must have an in-flight prompt to cancel.
      //   4. Worker must be alive + duel not ended.
      if (session.phase !== 'DUELING') {
        logger.warn('CANCEL_PROMPT_SEQUENCE rejected (non-DUELING phase)', {
          duelId: session.duelId, player: playerIndex, phase: session.phase,
        });
        break;
      }
      const now = Date.now();
      if (now - session.lastCancelAt[playerIndex] < cfg.cancelPromptRateLimitMs) {
        logger.warn('CANCEL_PROMPT_SEQUENCE rate-limited', {
          duelId: session.duelId, player: playerIndex,
        });
        break;
      }
      if (!session.awaitingResponse[playerIndex]) {
        logger.warn('CANCEL_PROMPT_SEQUENCE while not awaiting response', {
          duelId: session.duelId, player: playerIndex,
        });
        break;
      }
      if (!session.worker || session.endedAt) {
        logger.warn('CANCEL_PROMPT_SEQUENCE with no active worker', {
          duelId: session.duelId, player: playerIndex,
        });
        break;
      }
      session.lastCancelAt[playerIndex] = now;
      logger.log('CANCEL_PROMPT_SEQUENCE forwarded to worker', {
        duelId: session.duelId, player: playerIndex,
      });
      // Worker re-emits BOARD_STATE + the previous IDLECMD/BATTLECMD;
      // those messages flow through WORKER_MESSAGE so awaitingResponse
      // is reset by the prompt-broadcast path. Don't pre-flip here.
      session.worker.postMessage({ type: 'CANCEL_PROMPT_SEQUENCE', playerIndex });
      break;
    }
  }
}
