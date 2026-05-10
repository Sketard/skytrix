import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';
import { createInactivityScheduler, type InactivityScheduler } from './inactivity-timer.js';
import * as logger from './logger.js';

/**
 * Per-session timer management: turn timer (with ANIMATIONS_DONE-gated start),
 * inactivity warning + forfeit, single-player + both-disconnect grace periods.
 *
 * All functions take the `session` they operate on as their first argument.
 * The module owns no state of its own — every timer handle lives on the
 * session object (`session.timerContext`, `session.players[*].inactivitySlot`,
 * `session.players[*].gracePeriodTimer`, `session.combinedGraceTimer`,
 * `session.preservationTimer`).
 *
 * Side-effects that cross the session boundary (sending TIMER_STATE / DUEL_END
 * to clients, calling handleDuelEnd, requesting a replay, cleaning up the
 * session) are injected via callbacks at boot through `configureTimerManagement`.
 * The host (server.ts) wires these to the actual implementations — this lets
 * the timer module stay decoupled from the message router and session manager.
 */

export interface TimerManagementConfig {
  /** Send a server message to one player. Routes through the host's WS layer. */
  sendToPlayer: (session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage) => void;
  /** Mark the duel as ended (sets `endedAt`, schedules preservation timer). */
  handleDuelEnd: (session: ActiveDuelSession) => void;
  /** Ask the worker to flush its replay file with a result-override reason. */
  requestReplayFromWorker: (session: ActiveDuelSession, resultOverride: string) => void;
  /** Tear down a session (workers, timers, maps). */
  cleanupDuelSession: (session: ActiveDuelSession) => void;
  /** Idempotent worker.terminate() that flips `workerTerminated`. */
  safeTerminateWorker: (session: ActiveDuelSession) => void;

  // Constants from types.ts (kept as config so a test can poke shorter values)
  turnTimeIncrementMs: number;
  inactivityTimeoutMs: number;
  inactivityWarningBeforeMs: number;
  inactivityRaceWindowMs: number;
  reconnectGraceMs: number;
  bothDisconnectedCleanupMs: number;
  animationsDoneTimeoutMs: number;
}

let cfg: TimerManagementConfig | null = null;

export function configureTimerManagement(config: TimerManagementConfig): void {
  cfg = config;
}

function getCfg(): TimerManagementConfig {
  if (!cfg) throw new Error('timer-management: configureTimerManagement() not called');
  return cfg;
}

// =============================================================================
// TIMER_STATE broadcast
// =============================================================================
// TIMER_STATE bypasses message-filter.ts on purpose: both players see both
// timers, and the server is the sole source of truth.

export function sendTimerStateToAll(session: ActiveDuelSession): void {
  const ctx = session.timerContext;
  if (!ctx) return;
  const c = getCfg();
  const timer0: ServerMessage = { type: 'TIMER_STATE', player: 0, remainingMs: Math.max(0, ctx.pools[0]) };
  const timer1: ServerMessage = { type: 'TIMER_STATE', player: 1, remainingMs: Math.max(0, ctx.pools[1]) };
  for (const client of [0, 1] as const) {
    c.sendToPlayer(session, client, timer0);
    c.sendToPlayer(session, client, timer1);
  }
}

export function sendTimerStateToPlayer(session: ActiveDuelSession, targetPlayer: 0 | 1): void {
  const ctx = session.timerContext;
  if (!ctx) return;
  const c = getCfg();
  for (const p of [0, 1] as const) {
    c.sendToPlayer(session, targetPlayer, { type: 'TIMER_STATE', player: p, remainingMs: Math.max(0, ctx.pools[p]) });
  }
}

// =============================================================================
// Turn timer
// =============================================================================

export function startTurnTimer(session: ActiveDuelSession): void {
  const ctx = session.timerContext;
  if (!ctx || ctx.running) {
    logger.debug('startTurnTimer SKIPPED', { duelId: session.duelId, hasCtx: !!ctx, running: ctx?.running });
    return;
  }

  logger.debug('startTurnTimer START', { duelId: session.duelId, activePlayer: ctx.activePlayer, pool: ctx.pools[ctx.activePlayer] });
  ctx.running = true;
  ctx.lastTickMs = Date.now();

  // Snapshot the inactive pool once on resume so clients can render its
  // frozen value. The 250ms tick below only broadcasts the active pool;
  // without this baseline the inactive client would never see their pool.
  sendTimerStateToAll(session);

  const c = getCfg();
  ctx.intervalRef = setInterval(() => {
    const now = Date.now();
    const elapsed = now - ctx.lastTickMs;
    ctx.lastTickMs = now;
    ctx.pools[ctx.activePlayer] -= elapsed;

    // Broadcast TIMER_STATE for active player to both clients
    const timerMsg: ServerMessage = {
      type: 'TIMER_STATE',
      player: ctx.activePlayer,
      remainingMs: Math.max(0, ctx.pools[ctx.activePlayer]),
    };
    c.sendToPlayer(session, 0, timerMsg);
    c.sendToPlayer(session, 1, timerMsg);

    // Pool depletion → timeout forfeit
    if (ctx.pools[ctx.activePlayer] <= 0) {
      ctx.pools[ctx.activePlayer] = 0;
      const loser = ctx.activePlayer;
      const winner: Player = loser === 0 ? 1 : 0;
      session.awaitingResponse[loser] = false;
      const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'timeout' };
      logger.log('DUEL_END', { duelId: session.duelId, winner, reason: 'timeout', loser });
      c.sendToPlayer(session, 0, endMsg);
      c.sendToPlayer(session, 1, endMsg);
      c.handleDuelEnd(session);
      c.requestReplayFromWorker(session, 'TIMEOUT');
    }
  }, 250);
}

export function pauseTurnTimer(session: ActiveDuelSession): void {
  const ctx = session.timerContext;
  if (!ctx || !ctx.running) {
    logger.debug('pauseTurnTimer SKIPPED', { duelId: session.duelId, hasCtx: !!ctx, running: ctx?.running });
    return;
  }
  logger.debug('pauseTurnTimer PAUSE', { duelId: session.duelId, activePlayer: ctx.activePlayer, pool: ctx.pools[ctx.activePlayer] });

  // Account for time elapsed since last tick
  const now = Date.now();
  const elapsed = now - ctx.lastTickMs;
  ctx.pools[ctx.activePlayer] -= elapsed;
  ctx.lastTickMs = now;

  if (ctx.intervalRef) {
    clearInterval(ctx.intervalRef);
    ctx.intervalRef = null;
  }
  ctx.running = false;

  // Broadcast accurate pool value after pause (prevents up to ~1s display drift)
  const c = getCfg();
  const timerMsg: ServerMessage = {
    type: 'TIMER_STATE',
    player: ctx.activePlayer,
    remainingMs: Math.max(0, ctx.pools[ctx.activePlayer]),
  };
  c.sendToPlayer(session, 0, timerMsg);
  c.sendToPlayer(session, 1, timerMsg);
}

/**
 * Park the timer as pending for `player` — starts only when ANIMATIONS_DONE arrives.
 * A safety timeout fires startTurnTimer() after `animationsDoneTimeoutMs`
 * in case the client never sends the message (disconnect, bug, etc.).
 */
export function scheduleTimerStart(session: ActiveDuelSession, player: Player): void {
  const ctx = session.timerContext;
  if (!ctx) return;

  // Deduct elapsed from whoever was active, then freeze.
  pauseTurnTimer(session);
  ctx.activePlayer = player;

  // Clear any previous pending slot.
  if (ctx.pendingTimeout) {
    clearTimeout(ctx.pendingTimeout);
    ctx.pendingTimeout = null;
  }
  ctx.pendingPlayer = player;

  ctx.pendingTimeout = setTimeout(() => {
    ctx.pendingPlayer = null;
    ctx.pendingTimeout = null;
    startTurnTimer(session);
  }, getCfg().animationsDoneTimeoutMs);
}

/**
 * Commit a pending timer immediately (used on reconnect so we don't wait for
 * ANIMATIONS_DONE from a client that may have just re-established its connection).
 */
export function commitPendingTimer(session: ActiveDuelSession): void {
  const ctx = session.timerContext;
  if (!ctx) return;
  if (ctx.pendingTimeout) {
    clearTimeout(ctx.pendingTimeout);
    ctx.pendingTimeout = null;
  }
  ctx.pendingPlayer = null;
  startTurnTimer(session);
}

export function addTurnIncrement(session: ActiveDuelSession, player: Player, newTurnCount: number): void {
  const ctx = session.timerContext;
  if (!ctx) return;

  ctx.turnCount = newTurnCount;
  // Skip +40s on each player's first turn (turn 1 = P1, turn 2 = P2's first).
  // Both players keep their initial 300s pool intact for the opening turn.
  if (ctx.turnCount > 2) {
    ctx.pools[player] += getCfg().turnTimeIncrementMs;
  }
  ctx.activePlayer = player;
}

export function handleTurnChange(session: ActiveDuelSession, newTurnPlayer: Player, newTurnCount: number): void {
  const ctx = session.timerContext;
  if (!ctx || newTurnCount <= ctx.turnCount) return;

  logger.debug('handleTurnChange', { duelId: session.duelId, fromTurn: ctx.turnCount, toTurn: newTurnCount, activePlayer: newTurnPlayer });
  // New turn detected — pause current timer, capture any pending ANIMATIONS_DONE
  // slot (it may have been armed by a SELECT that the worker emitted before this
  // BOARD_STATE), add increment, switch active player. If a pending slot existed,
  // re-arm it for the new turn player so the timer still starts on ANIMATIONS_DONE.
  const wasRunning = ctx.running;
  const hadPending = ctx.pendingTimeout !== null;
  pauseTurnTimer(session);
  if (ctx.pendingTimeout) {
    clearTimeout(ctx.pendingTimeout);
    ctx.pendingTimeout = null;
    ctx.pendingPlayer = null;
  }
  addTurnIncrement(session, newTurnPlayer, newTurnCount);

  // Broadcast both pools after the turn change: active pool got an increment,
  // inactive pool's value is now frozen on the new turn — clients need both
  // to render "your timer" vs "their timer".
  sendTimerStateToAll(session);

  // Worker may send SELECT before BOARD_STATE — resume timer if it was running,
  // OR re-arm the pending slot for the new turn player if a SELECT had just
  // armed one (otherwise ANIMATIONS_DONE would never start the timer).
  if (wasRunning) {
    startTurnTimer(session);
  } else if (hadPending) {
    scheduleTimerStart(session, newTurnPlayer);
  }
}

// =============================================================================
// Inactivity timer
// =============================================================================

/**
 * Build a fresh InactivityScheduler bound to the given session. Wraps the
 * dependencies (slot storage on PlayerSession, isDuelEnded check, warning +
 * forfeit side-effects) so the timer logic itself lives in inactivity-timer.ts
 * and is unit-testable in isolation.
 */
function inactivitySchedulerFor(session: ActiveDuelSession): InactivityScheduler {
  const c = getCfg();
  return createInactivityScheduler({
    isDuelEnded: () => session.endedAt !== null,
    getSlot: (p) => session.players[p].inactivitySlot,
    setSlot: (p, slot) => { session.players[p].inactivitySlot = slot; },
    sendWarning: (p, remainingSec) => {
      const warningMsg: ServerMessage = { type: 'INACTIVITY_WARNING', remainingSec };
      c.sendToPlayer(session, p, warningMsg);
    },
    forfeit: (p) => {
      const winner: Player = p === 0 ? 1 : 0;
      session.awaitingResponse[p] = false;
      const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'inactivity' };
      logger.log('DUEL_END', { duelId: session.duelId, winner, reason: 'inactivity', player: p });
      c.sendToPlayer(session, 0, endMsg);
      c.sendToPlayer(session, 1, endMsg);
      c.handleDuelEnd(session);
      c.requestReplayFromWorker(session, 'TIMEOUT');
    },
    warningDelayMs: c.inactivityTimeoutMs - c.inactivityWarningBeforeMs,
    warningBeforeMs: c.inactivityWarningBeforeMs,
    raceWindowMs: c.inactivityRaceWindowMs,
  });
}

export function startInactivityTimer(session: ActiveDuelSession, player: Player): void {
  inactivitySchedulerFor(session).start(player);
}

export function clearInactivityTimer(session: ActiveDuelSession, player: Player): void {
  inactivitySchedulerFor(session).cancel(player);
}

// =============================================================================
// Bulk cleanup
// =============================================================================

export function clearAllDuelTimers(session: ActiveDuelSession): void {
  // Clear turn timer
  const ctx = session.timerContext;
  if (ctx) {
    if (ctx.intervalRef) {
      clearInterval(ctx.intervalRef);
      ctx.intervalRef = null;
      ctx.running = false;
    }
    if (ctx.pendingTimeout) {
      clearTimeout(ctx.pendingTimeout);
      ctx.pendingTimeout = null;
    }
    ctx.pendingPlayer = null;
  }
  session.timerContext = null;

  // Clear inactivity + race window timers for both players
  for (const p of [0, 1] as const) {
    clearInactivityTimer(session, p);
  }
}

// =============================================================================
// Grace period (single-player + both-disconnect)
// =============================================================================

export function startGracePeriod(session: ActiveDuelSession, playerIndex: 0 | 1): void {
  const c = getCfg();
  // Story 5.2 — Check if both players are now disconnected
  const otherIndex: Player = playerIndex === 0 ? 1 : 0;
  if (!session.players[otherIndex].connected) {
    // Both disconnected — cancel individual grace timer for the other player
    const otherPs = session.players[otherIndex];
    if (otherPs.gracePeriodTimer) {
      clearTimeout(otherPs.gracePeriodTimer);
      otherPs.gracePeriodTimer = null;
    }

    session.bothDisconnected = true;

    // Start combined grace timer (60s from the later disconnect)
    if (!session.combinedGraceTimer) {
      session.combinedGraceTimer = setTimeout(() => {
        session.combinedGraceTimer = null;
        // Neither player reconnected — end as draw
        if (!session.players[0].connected && !session.players[1].connected && !session.endedAt) {
          const endMsg: ServerMessage = { type: 'DUEL_END', winner: null, reason: 'draw_both_disconnect' };
          logger.log('DUEL_END', { duelId: session.duelId, winner: null, reason: 'draw_both_disconnect' });
          session.storedDuelResult = endMsg;
          c.handleDuelEnd(session);
          c.requestReplayFromWorker(session, 'DISCONNECT');
          session.preservationTimer = setTimeout(() => {
            session.preservationTimer = null;
            c.cleanupDuelSession(session);
            c.safeTerminateWorker(session);
          }, c.bothDisconnectedCleanupMs);
        }
      }, c.reconnectGraceMs);
    }
    return;
  }

  // Single player disconnect — existing per-player grace logic
  const ps = session.players[playerIndex];
  if (ps.gracePeriodTimer) return;

  ps.gracePeriodTimer = setTimeout(() => {
    ps.gracePeriodTimer = null;
    if (!session.players[playerIndex].connected && !session.endedAt) {
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      const endMsg: ServerMessage = { type: 'DUEL_END', winner: opponentIndex, reason: 'disconnect' };
      logger.log('DUEL_END', { duelId: session.duelId, winner: opponentIndex, reason: 'disconnect', player: playerIndex });
      c.sendToPlayer(session, 0, endMsg);
      c.sendToPlayer(session, 1, endMsg);
      c.handleDuelEnd(session);
      c.requestReplayFromWorker(session, 'DISCONNECT');
    }
  }, c.reconnectGraceMs);
}
