import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { ActiveDuelSession } from './types.js';
import { RECONNECT_GRACE_MS } from './types.js';
import type { ClientMessage, Player } from './ws-protocol.js';
import { createConfigurable } from './configurable.js';
import type { DuelSessionManager } from './duel-session-manager.js';
import { consumeWsAttempt, recordFailedWsAttempt } from './ws-rate-limit.js';
import { checkProtocolVersionPure } from './protocol-version-check.js';
import { handleReplayConnection } from './replay-handlers.js';
import {
  handleSolverMessage,
  attachSolverConnection,
  detachSolverConnection,
} from './solver-handlers.js';
import { startFirstPlayerPhase } from './first-player-coordinator.js';
import {
  pauseTurnTimer, commitPendingTimer,
  startInactivityTimer, clearInactivityTimer,
  startGracePeriod,
} from './timer-management.js';
import { handleClientMessage } from './client-message-router.js';
import { validateClientMessageForPlayer } from './client-message-validator.js';
import { isReadyToStart, isFullyDisconnected } from './lifecycle-helpers.js';
import { derivePhase } from './session-phase.js';
import { sendToPlayer } from './ws-write.js';
import {
  cleanupDuelSession,
  sendStateSnapshot,
  resendPendingPrompt,
  startDuelWithOrder,
} from './session-orchestrator.js';
import { safeTerminateWorker } from './duel-end-coordinator.js';
import * as logger from './logger.js';

/**
 * PvP WebSocket connection handler — the body of the
 * `wss.on('connection', ...)` closure extracted from server.ts (U32 #2,
 * audit-4-modes-2026-06-01).
 *
 * Responsibilities :
 *   1. Atomic IP rate-limit check + protocol-version 4426 gate.
 *   2. Mode dispatch (replay / solver / PvP-default).
 *   3. PvP handshake — initial token consumption OR reconnect token,
 *      grace-period cancellation, session resync (state snapshot +
 *      pending prompt re-arm).
 *   4. Per-WS lifecycle wiring — `message` (validate → handleClientMessage)
 *      and `close` (pause timers + grace start OR rematch teardown).
 *
 * Pattern : `createConfigurable<PvpConnectionHandlerConfig>` — aligned
 * with the 12 other server modules and participates in the boot
 * invariant. One `getCfg()` read happens per connection (entry of
 * `handlePvpConnection`). `checkProtocolVersion` receives
 * `incrementProtocolMismatch` as a param, no second `getCfg()` call.
 * Per-message dispatch does NOT touch the cfg — the per-WS closure
 * caches `sessionManager` once and reuses it. `startDuelWithOrder`
 * (SOLO bridge) is imported directly from session-orchestrator since
 * U32 #3b — no cfg field for it.
 *
 * The chunk plan accepted by Axel originally proposed a pure factory
 * (`createPvpConnectionHandler(deps) → handler`). Switched to
 * `createConfigurable` at implementation time for consistency : the
 * 11 other extracted modules all use it ; the boot invariant tracks
 * "all modules configured" through the `isXxxConfigured()` triple.
 * A bare factory would leave the handler outside that fence.
 *
 * Mutation of `protocolMismatchCount` :
 *   The counter is module-local to server.ts (exposed via `/status`
 *   through `configureHttpRoutes`). The handler bumps it via the
 *   injected `incrementProtocolMismatch` getter so the host stays
 *   the single writer.
 *
 * Three closure-level locals on each incoming connection :
 *   - `session: ActiveDuelSession | undefined` — resolved from token
 *     OR reconnect-token, used by the message / close handlers.
 *   - `playerIndex: 0 | 1` — captured at handshake ; the live index
 *     is read via `currentPlayerIndex()` because
 *     `startDuelWithOrder` can swap `session.players[]` after the
 *     connection lands (see comment at the helper definition).
*   - `cfg` — captured once from `getCfg()` at entry. Reused for the
 *     `sessionManager` lookup and for the `incrementProtocolMismatch`
 *     callback passed down to `checkProtocolVersion`.
 */

export interface PvpConnectionHandlerConfig {
  /** Listening port — used to parse the request URL. */
  port: number;
  /** Behind-proxy flag — controls x-real-ip trust. */
  isProduction: boolean;
  /** The host's session manager singleton. */
  sessionManager: DuelSessionManager;
  /**
   * Bump the host's protocol-mismatch counter (exposed via /status).
   * Wired in server.ts to mutate the module-local `let` ; the handler
   * stays a pure reader otherwise.
   */
  incrementProtocolMismatch: () => void;
}

const configurable = createConfigurable<PvpConnectionHandlerConfig>('pvp-connection-handler');
export const configurePvpConnectionHandler = configurable.configure;
export const isPvpConnectionHandlerConfigured = configurable.isConfigured;
const getCfg = configurable.get;

interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

/**
 * Reject the handshake when the client's `pv` query param does not match
 * server-side `PROTOCOL_VERSION`. Returns true on accept, false on reject
 * (after closing the WS with code 4426 — analog to HTTP 426 Upgrade Required).
 *
 * Applied to all 3 modes (PvP, Replay, Solver) since 2026-06-01 — the
 * earlier "Solver exempt" comment was stale (the gate has always run on
 * solver since the unified mode dispatcher landed).
 *
 * `incrementProtocolMismatch` is passed in by the caller so this helper
 * stays pure (no `getCfg()` access — every reader is hot-path-cheap).
 */
function checkProtocolVersion(
  ws: WebSocket, url: URL, mode: string, ip: string,
  incrementProtocolMismatch: () => void,
): boolean {
  const result = checkProtocolVersionPure(url.searchParams.get('pv'));
  if (!result.ok) {
    logger.warn('WS handshake rejected — protocol version mismatch', {
      mode, clientVersion: result.rawClientVersion, serverVersion: result.serverVersion, ip,
    });
    // Count protocol mismatch as a failed handshake — otherwise an attacker
    // can spam connections with `?pv=99` and bypass the rate limiter (which
    // only counts failed AUTH attempts via recordFailedWsAttempt). Audit
    // review 2026-05-09 H2.
    recordFailedWsAttempt(ip);
    incrementProtocolMismatch();
    ws.close(4426, `Protocol version mismatch (server=${result.serverVersion}, client=${result.rawClientVersion ?? 'missing'})`);
    return false;
  }
  return true;
}

export function handlePvpConnection(ws: WebSocket, req: IncomingMessage): void {
  const cfg = getCfg();
  const { port: PORT, isProduction: IS_PRODUCTION, sessionManager } = cfg;

  // Trust x-real-ip only behind a reverse proxy in production; fall back to socket IP otherwise
  const ip = (IS_PRODUCTION && req.headers['x-real-ip'] as string) || req.socket.remoteAddress || 'unknown';

  // Atomic "count + check" closes the race where N concurrent handshakes
  // from the same IP could all pass a stale read at threshold-1.
  if (IS_PRODUCTION && consumeWsAttempt(ip)) {
    ws.close(4029, 'Too many connections');
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // Replay mode branch — separate flow from PvP duels
  const mode = url.searchParams.get('mode');
  if (mode === 'replay') {
    if (!checkProtocolVersion(ws, url, 'replay', ip, cfg.incrementProtocolMismatch)) return;
    const replayId = url.searchParams.get('replayId');
    const jwt = url.searchParams.get('token');
    if (!replayId || !jwt) {
      ws.close(4001, 'Missing replayId or token');
      return;
    }
    handleReplayConnection(ws, jwt, replayId, ip);
    return;
  }

  // Solver mode branch — separate flow from PvP duels (Story 1.4)
  if (mode === 'solver') {
    if (!checkProtocolVersion(ws, url, 'solver', ip, cfg.incrementProtocolMismatch)) return;
    const jwt = url.searchParams.get('token');
    if (!jwt) {
      ws.close(4001, 'Missing token');
      return;
    }

    // Decode JWT to extract userId (same pattern as replay)
    let userId: string;
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      userId = String(payload.sub ?? payload.userId ?? payload.id ?? '');
      if (!userId) throw new Error('No user ID in JWT');
    } catch (err) {
      logger.error('[Solver] JWT decode error', { error: err instanceof Error ? err.message : String(err) });
      recordFailedWsAttempt(ip);
      ws.close(4001, 'Invalid token');
      return;
    }

    // Atomic connection register (limit check + replace + set in one go).
    // server.ts owns WS IO: closing the rejected/replaced socket happens here.
    const attached = attachSolverConnection(userId, ws, jwt);
    if (attached.kind === 'limit') {
      ws.close(4029, 'Too many solver connections');
      return;
    }
    if (attached.replaced) {
      attached.replaced.close(4001, 'Replaced by new connection');
    }

    // Heartbeat
    (ws as AliveWebSocket).isAlive = true;
    ws.on('pong', () => { (ws as AliveWebSocket).isAlive = true; });

    // Message handler
    ws.on('message', (data: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        ws.close(4002, 'Invalid JSON');
        return;
      }
      handleSolverMessage(userId, ws, parsed);
    });

    // Close handler — release state; solver-handlers guards against the
    // race where a replace already swapped this WS out (idempotent).
    ws.on('close', () => detachSolverConnection(userId, ws));

    ws.on('error', (error) => {
      logger.error('[Solver] ws error', { userId, error: error instanceof Error ? error.message : String(error) });
    });

    logger.log('[Solver] connected', { userId });
    return;
  }

  // PvP duel branch (default — neither replay nor solver)
  if (!checkProtocolVersion(ws, url, 'pvp', ip, cfg.incrementProtocolMismatch)) return;

  const token = url.searchParams.get('token');
  const reconnect = url.searchParams.get('reconnect');

  if (!token && !reconnect) {
    recordFailedWsAttempt(ip);
    ws.close(4001, 'Missing token');
    return;
  }

  let session: ActiveDuelSession | undefined;
  let playerIndex: 0 | 1;

  if (reconnect) {
    // --- Reconnection flow ---
    const reconResult = sessionManager.consumeReconnectToken(reconnect);
    if (reconResult.kind === 'unknown') {
      recordFailedWsAttempt(ip);
      ws.close(4001, 'Invalid or expired reconnect token');
      return;
    }
    if (reconResult.kind === 'session-gone') {
      recordFailedWsAttempt(ip);
      ws.close(4001, 'Duel not found');
      return;
    }
    session = reconResult.session;
    playerIndex = reconResult.playerIndex;

    // Cancel grace period timer
    const reconPs = session.players[playerIndex];
    if (reconPs.gracePeriodTimer) {
      clearTimeout(reconPs.gracePeriodTimer);
      reconPs.gracePeriodTimer = null;
    }

    logger.log('Player reconnected', { duelId: session.duelId, player: playerIndex });

    // Story 3.2 — Resume turn timer on reconnect if a prompt is pending.
    // Use commitPendingTimer so we don't wait for ANIMATIONS_DONE from the
    // freshly reconnected client (board re-render is fast, timer starts immediately).
    if (session.awaitingResponse.some(a => a)) {
      commitPendingTimer(session);
      // Restart inactivity timer for the prompted player
      for (const p of [0, 1] as const) {
        if (session.awaitingResponse[p]) {
          startInactivityTimer(session, p);
        }
      }
    }
  } else {
    // --- Initial connection flow ---
    const tokenResult = sessionManager.consumePendingToken(token!);
    if (tokenResult.kind !== 'ok') {
      recordFailedWsAttempt(ip);
      const reason = tokenResult.kind === 'session-gone'
        ? 'token-orphaned (duel ended before handshake)'
        : 'token-unknown (never issued or already consumed)';
      logger.warn('Initial handshake rejected', { reason });
      ws.close(4001, 'Invalid or expired token');
      return;
    }
    session = tokenResult.session;
    playerIndex = tokenResult.playerIndex;

    logger.log('Player connected', { duelId: session.duelId, player: playerIndex });
  }

  // Associate WebSocket to player
  session.players[playerIndex].ws = ws;
  session.players[playerIndex].connected = true;
  session.players[playerIndex].disconnectedAt = null;

  // H2 — Clear fork connection timeout on first connect
  if (session.forkConnectionTimeout) {
    clearTimeout(session.forkConnectionTimeout);
    session.forkConnectionTimeout = null;
  }

  // Issue reconnect token (rotate: old token is dropped if any).
  const newReconnectToken = randomUUID();
  sessionManager.rotateReconnectToken(session, playerIndex, newReconnectToken);
  session.players[playerIndex].reconnectToken = newReconnectToken;

  // Send SESSION_TOKEN to client
  sendToPlayer(session, playerIndex, { type: 'SESSION_TOKEN', token: newReconnectToken });

  // Mount-discriminant: tells the client whether to mount the dice arena
  // (PRE_DUEL), the board skeleton (DUELING), or the preservation-period
  // end-screen (ENDED). Emitted exactly once per WS attachment, right after
  // SESSION_TOKEN, so the discrimination is deterministic (no message-sniff
  // or timeout). Helper is pure — see session-phase.ts.
  sendToPlayer(session, playerIndex, { type: 'SESSION_PHASE', phase: derivePhase(session) });

  // Mark as alive for heartbeat
  (ws as AliveWebSocket).isAlive = true;
  ws.on('pong', () => { (ws as AliveWebSocket).isAlive = true; });

  // Story 5.2 — Check if reconnecting during preservation period (duel already ended)
  if (reconnect && session.storedDuelResult) {
    sendToPlayer(session, playerIndex, session.storedDuelResult);
    // [Review M3 fix] Only cleanup if both players have received the result
    const otherIdx: Player = playerIndex === 0 ? 1 : 0;
    if (session.players[otherIdx].connected) {
      if (session.preservationTimer) {
        clearTimeout(session.preservationTimer);
        session.preservationTimer = null;
      }
      cleanupDuelSession(session);
      safeTerminateWorker(session);
    }
    // Otherwise keep session alive — other player may still reconnect
  } else {
    // Story 5.2 — Handle reconnection during combined grace period
    if (reconnect && session.bothDisconnected) {
      // First player reconnecting during combined grace — cancel combined timer
      if (session.combinedGraceTimer) {
        clearTimeout(session.combinedGraceTimer);
        session.combinedGraceTimer = null;
      }
      session.bothDisconnected = false;
      // Start individual grace timer for the still-disconnected player
      const otherIndex: Player = playerIndex === 0 ? 1 : 0;
      if (!session.players[otherIndex].connected) {
        startGracePeriod(session, otherIndex);
      }
    }

    // Send state snapshot (DRY — used by both reconnection and REQUEST_STATE_SYNC)
    sendStateSnapshot(session, playerIndex);

    // Story 3.3 — Reconnection: notify opponent
    if (reconnect) {
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      sendToPlayer(session, opponentIndex, { type: 'OPPONENT_RECONNECTED' });
    }

    // γ Option C PR2 c6bis (A29) — SOLO multiplex re-arms BOTH slots
    // on reconnect (single socket carries both server identities).
    if (session.soloMode) {
      resendPendingPrompt(session, 0);
      resendPendingPrompt(session, 1);
    } else {
      resendPendingPrompt(session, playerIndex);
    }
  }

  // Check if the session is ready to start — trigger pre-duel RPS or fork resume.
  // SOLO multiplex only needs socket 0 connected; PvP normal needs both.
  if (isReadyToStart(session)) {
    logger.log('Both players connected', { duelId: session.duelId });
    if (session.phase === 'WAITING_PLAYERS') {
      if (session.soloMode) {
        // Solo mode: backend already placed the first player at index 0
        startDuelWithOrder(session, 0);
      } else {
        startFirstPlayerPhase(session);
      }
    } else if (session.phase === 'DUELING' && session.forkMode) {
      // Fork session: worker already reconstructed the duel, tell it to emit state + prompt
      if (session.forkConnectionTimeout) {
        clearTimeout(session.forkConnectionTimeout);
        session.forkConnectionTimeout = null;
      }
      session.worker?.postMessage({ type: 'FORK_RESUME' });
    }
  }

  // Resolve the current OCG playerIndex of THIS WebSocket on every event.
  // Required because startDuelWithOrder() may swap session.players[] after
  // the connection — the closure's captured `playerIndex` then points to the
  // wrong player. A live lookup against session.players[*].ws is immune to
  // the swap.
  const currentPlayerIndex = (): 0 | 1 => {
    if (session!.players[0].ws === ws) return 0;
    if (session!.players[1].ws === ws) return 1;
    return playerIndex; // fallback to capture if the WS isn't attached yet
  };

  // WebSocket message handling
  ws.on('message', (data: Buffer) => {
    let parsed: unknown;
    const captured = currentPlayerIndex();
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      logger.error('Invalid JSON from player', { duelId: session!.duelId, player: captured });
      return;
    }

    // γ Option C A2 — validates `forPlayer` semantics + the payload shape.
    // PvP normal rejects any `forPlayer` (impersonation guard); SOLO accepts
    // a strict `0 | 1` as the routing override. Non-object payloads
    // (`null`, primitives, arrays from JSON) are dropped here so the
    // dispatch below can treat `parsed` as a structurally-valid message.
    const validated = validateClientMessageForPlayer(
      parsed, session!.soloMode, captured, session!.duelId,
    );
    if (validated.kind === 'reject') return;

    handleClientMessage(session!, validated.live, parsed as ClientMessage);
  });

  ws.on('close', () => {
    const live = currentPlayerIndex();
    session!.players[live].connected = false;
    session!.players[live].disconnectedAt = Date.now();
    logger.log('Player disconnected', { duelId: session!.duelId, player: live });

    if (!session!.endedAt) {
      // Story 3.2 — Pause turn timer and clear inactivity on disconnect
      pauseTurnTimer(session!);
      clearInactivityTimer(session!, live as Player);

      // γ Option C A18 — SOLO multiplex has no opponent socket to notify and
      // no grace period to start: there's only one user, and a closed socket
      // = the page is gone. Skip OPPONENT_DISCONNECTED + startGracePeriod.
      // `players[1].connected` is never written here (stays `false` for the
      // whole duel — the canonical SOLO invariant). Reconnect still works:
      // the user's next `wsToken` consumption lands at socket 0 via the
      // normal handshake path and resendPendingPrompt re-arms the prompt.
      if (session!.soloMode) return;

      // Story 3.3 — Notify opponent of disconnection
      const opponentIndex: Player = live === 0 ? 1 : 0;
      sendToPlayer(session!, opponentIndex, { type: 'OPPONENT_DISCONNECTED', gracePeriodSec: RECONNECT_GRACE_MS / 1000 });

      startGracePeriod(session!, live);
    } else {
      // γ Option C A31 — post-duel SOLO close: preserve the rematch window.
      // PvP normal cleans up once both sockets are down (`isFullyDisconnected`
      // → cleanup), because no one is left to ask for a rematch. In SOLO the
      // user might just be refreshing the tab during the rematch grace; the
      // `rematchTimeout` (armed by `handleDuelEnd`) already owns the deadline,
      // so let it fire `onRematchExpired` → `rematchExpired` → cleanup.
      // Bypassing here would race against a legitimate reconnect.
      if (session!.soloMode) return;

      // Post-duel disconnect: notify opponent rematch is cancelled
      const opponentIndex: Player = live === 0 ? 1 : 0;
      sendToPlayer(session!, opponentIndex, { type: 'REMATCH_CANCELLED', reason: 'opponent_left' });

      // If the session is fully disconnected after duel end, cleanup.
      // PvP normal needs both sockets down; SOLO has its own path above.
      if (isFullyDisconnected(session!)) {
        cleanupDuelSession(session!);
      }
    }
  });
}
