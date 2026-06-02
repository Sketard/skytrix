import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { resolve, join } from 'node:path';
import {
  MAX_WS_FRAME_SIZE,
  RECONNECT_GRACE_MS,
  TURN_TIME_INCREMENT_MS,
  INACTIVITY_TIMEOUT_MS,
  INACTIVITY_WARNING_BEFORE_MS,
  INACTIVITY_RACE_WINDOW_MS,
  BOTH_DISCONNECTED_CLEANUP_MS,
  STATE_SYNC_RATE_LIMIT_MS,
  CANCEL_PROMPT_RATE_LIMIT_MS,
  DICE_ROLL_TIMEOUT_MS,
  FIRST_PLAYER_TIMEOUT_MS,
  REPLAY_WORKER_WATCHDOG_MS,
  MAX_REPLAY_WORKERS,
  ANIMATIONS_DONE_TIMEOUT_MS,
  extractCardCodesForPlayer,
} from './types.js';
import type {
  WorkerToMainMessage,
  DuelSession,
  ActiveDuelSession,
  Deck,
  TimerContext,
  SessionPhase,
  FirstPlayerState,
  ReplayMetadata,
} from './types.js';
import type {
  SolverStartMessage, SolverResultMessage, SolverCancelledMessage,
  SolverProgressMessage, SolverErrorMessage, SolverHandtrapsMessage, SolverWsError,
} from './ws-protocol.js';
import {
  SOLVER_START, SOLVER_CANCEL, SOLVER_INIT, SOLVER_PROGRESS,
  SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR, SOLVER_HANDTRAPS,
} from './ws-protocol.js';
import { filterMessage } from './message-filter.js';
import { validateData, initScriptsHash } from './ocg-scripts.js';
import * as logger from './logger.js';
import { validateResponseData } from './validation/response-validation.js';
import { applyChainTransition, type ChainStateContainer } from './chain-state-tracker.js';
import { createInitialSessionState } from './session-factory.js';
import { DuelSessionManager } from './duel-session-manager.js';
import { startWsRateLimitSweep } from './ws-rate-limit.js';
import { json, readBody, validateInternalAuth as validateInternalAuthBase } from './http-helpers.js';
import { configureHttpRoutes, handleHealth, handleStatus, handleUpdateData, handleValidatePasscodes, isHttpRoutesConfigured } from './http-routes.js';
import { createReplayCache } from './replay-cache.js';
import { configureReplayHandlers, cleanupAllReplayState, isReplayHandlersConfigured } from './replay-handlers.js';
import {
  configureTimerManagement,
  isTimerManagementConfigured,
  clearAllDuelTimers,
} from './timer-management.js';
import {
  configureSolverHandlers,
  isSolverHandlersConfigured,
} from './solver-handlers.js';
import {
  configureFirstPlayerCoordinator,
  isFirstPlayerCoordinatorConfigured,
} from './first-player-coordinator.js';
import {
  configureWorkerLifecycle,
  isWorkerLifecycleConfigured,
} from './worker-lifecycle.js';
import {
  configureDuelEndCoordinator,
  isDuelEndCoordinatorConfigured,
  safeTerminateWorker,
  handleDuelEnd,
  requestReplayFromWorker,
  getTotalDuelsServed,
} from './duel-end-coordinator.js';
import {
  configureReplayPersist,
  isReplayPersistConfigured,
  persistReplay,
} from './replay-persist.js';
import {
  configureWorkerMessageRouter,
  isWorkerMessageRouterConfigured,
  handleWorkerMessage,
  broadcastMessage,
} from './worker-message-router.js';
import {
  configureForkHandlers,
  isForkHandlersConfigured,
  createForkSoloSession,
} from './fork-handlers.js';
import {
  configureClientMessageRouter,
  isClientMessageRouterConfigured,
} from './client-message-router.js';
import { isFullyDisconnected } from './lifecycle-helpers.js';
import { sendToPlayer } from './ws-write.js';
import {
  configureSessionOrchestrator,
  isSessionOrchestratorConfigured,
  cleanupDuelSession,
  sendStateSnapshot,
  resendPendingPrompt,
  startRematch,
  rematchExpired,
  startDuelWithOrder,
} from './session-orchestrator.js';
import {
  configurePvpConnectionHandler,
  isPvpConnectionHandlerConfigured,
  handlePvpConnection,
} from './pvp-connection-handler.js';
import { loadSolverConfig, loadHandtraps } from './solver/solver-config-loader.js';
import { SolverOrchestrator } from './solver/solver-orchestrator.js';
import type { HandtrapConfig, DuelConfig, SolverConfig, SolverProgress } from './solver/solver-types.js';
import { EMPTY_BREAKDOWN } from './solver/solver-types.js';

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const DATA_DIR = resolve(process.env['DATA_DIR'] ?? join(import.meta.dirname!, '../data'));
const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';
if (IS_PRODUCTION && !process.env['SPRING_BOOT_API_URL']) {
  logger.error('SPRING_BOOT_API_URL not set in production — refusing to start (replay persistence would silently fail against localhost)');
  process.exit(1);
}
if (IS_PRODUCTION && !process.env['INTERNAL_API_KEY']) {
  logger.error('INTERNAL_API_KEY not set in production — refusing to start (internal API auth and replay persistence would fail)');
  process.exit(1);
}
const SPRING_BOOT_API_URL = process.env['SPRING_BOOT_API_URL'] ?? 'http://localhost:8080/api';
const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] ?? 'dev-internal-key';
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_INVALID_RESPONSES = 5;
let maxSolverConnections = 10; // overridden at boot from solver-config.json
const MAX_SOLVER_CACHE_ENTRIES = 50;
const SOLVER_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const REMATCH_EXPIRY_MS = 5 * 60 * 1000;
const FILLER_CARD_ID = 43096270; // Alexandrite Dragon — vanilla filler for goldfish opponent

const startTime = Date.now();
// totalDuelsServed moved into worker-lifecycle.ts (single source of truth
// for the worker-terminate counter — read via getTotalDuelsServed()).
let dataReady = false;
/** Total WS handshakes rejected with close-code 4426 — surfaced via /status. */
let protocolMismatchCount = 0;

// =============================================================================
// State
// =============================================================================

// ActiveDuelSession moved to types.ts (H1-suite phase 4) so the timer-
// management module can reference it without re-importing server.ts.

const sessionManager = new DuelSessionManager();
// M1: gracePeriodTimers, timerContexts, inactivityTimers, raceWindowTimers
// consolidated into ActiveDuelSession.timerContext and PlayerSession per-player timers.

// =============================================================================
// Replay State
// =============================================================================

// ReplayConnection / ReplayConnectionState + replay worker pool moved to
// replay-handlers.ts (H1-suite phase 3). The cache instance stays here so
// server.ts owns its lifecycle (passed to configureReplayHandlers below).
const replayCache = createReplayCache();

// Track WebSocket liveness for heartbeat
interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

// =============================================================================
// Startup Validation
// =============================================================================

const dbPath = join(DATA_DIR, 'cards.cdb');
const scriptsDir = join(DATA_DIR, 'scripts_full');
const validation = validateData(dbPath, scriptsDir);
dataReady = validation.ok;
if (!dataReady) {
  logger.error('Data validation failed', { reason: validation.reason });
} else {
  logger.log('Data validation passed');
  initScriptsHash(scriptsDir);
}

// =============================================================================
// Solver Orchestrator (Story 1.3)
// =============================================================================

export let solverOrchestrator: SolverOrchestrator | null = null;
let solverHandtraps: HandtrapConfig[] = [];
let solverRateLimitIntervalMs = 2000;
let solverTimeBudgetFastMs = 5000;
let solverTimeBudgetOptimalMs = 30000;
let solverMaxHandtraps = 5;

if (dataReady) {
  try {
    const solverConfig = loadSolverConfig(DATA_DIR);
    const orchestrator = new SolverOrchestrator();
    await orchestrator.init(solverConfig, DATA_DIR);
    solverOrchestrator = orchestrator;

    // Store WS-layer config values from SolverConfigFile
    solverRateLimitIntervalMs = solverConfig.rateLimitIntervalMs;
    solverTimeBudgetFastMs = solverConfig.timeBudgetFastMs;
    solverTimeBudgetOptimalMs = solverConfig.timeBudgetOptimalMs;
    solverMaxHandtraps = solverConfig.maxHandtraps;
    maxSolverConnections = solverConfig.maxSolverConnections;

    solverHandtraps = loadHandtraps(DATA_DIR);
  } catch (err) {
    logger.warn('Solver orchestrator failed to initialize — solver features disabled', err as Record<string, unknown>);
  }
}

// All solver state (connections, JWTs, deck cache, last-start, result cache)
// is private to solver-handlers.ts (H2 audit closure). The WS connection
// handler below drives it via attachSolverConnection / detachSolverConnection.

configureSolverHandlers({
  orchestrator: () => solverOrchestrator,
  handtraps: () => solverHandtraps,
  rateLimitIntervalMs: () => solverRateLimitIntervalMs,
  timeBudgetFastMs: () => solverTimeBudgetFastMs,
  timeBudgetOptimalMs: () => solverTimeBudgetOptimalMs,
  maxHandtraps: () => solverMaxHandtraps,
  maxSolverConnections: () => maxSolverConnections,
  springBootApiUrl: SPRING_BOOT_API_URL,
  fillerCardId: FILLER_CARD_ID,
  maxSolverCacheEntries: MAX_SOLVER_CACHE_ENTRIES,
  solverResultCacheTtlMs: SOLVER_RESULT_CACHE_TTL_MS,
  deckFetchCacheTtlMs: 60_000, // formerly DECK_FETCH_CACHE_TTL_MS
});

configureHttpRoutes({
  isDataReady: () => dataReady,
  setDataReady: (ready) => { dataReady = ready; },
  getValidationReason: () => validation.reason,
  activeDuelsSize: () => sessionManager.size(),
  totalDuelsServed: getTotalDuelsServed,
  protocolMismatchCount: () => protocolMismatchCount,
  startTime,
  dataDir: DATA_DIR,
  dbPath,
  scriptsDir,
  internalApiKey: INTERNAL_API_KEY,
  getSolverOrchestrator: () => solverOrchestrator,
  setSolverOrchestrator: (orch) => { solverOrchestrator = orch; },
});

configureReplayHandlers({
  replayCache,
  springBootApiUrl: SPRING_BOOT_API_URL,
  internalApiKey: INTERNAL_API_KEY,
  maxReplayWorkers: MAX_REPLAY_WORKERS,
  replayWorkerWatchdogMs: REPLAY_WORKER_WATCHDOG_MS,
  dataDir: DATA_DIR,
  createForkSoloSession,
});

configureTimerManagement({
  sendToPlayer,
  handleDuelEnd,
  requestReplayFromWorker,
  cleanupDuelSession,
  safeTerminateWorker,
  turnTimeIncrementMs: TURN_TIME_INCREMENT_MS,
  inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
  inactivityWarningBeforeMs: INACTIVITY_WARNING_BEFORE_MS,
  inactivityRaceWindowMs: INACTIVITY_RACE_WINDOW_MS,
  reconnectGraceMs: RECONNECT_GRACE_MS,
  bothDisconnectedCleanupMs: BOTH_DISCONNECTED_CLEANUP_MS,
  animationsDoneTimeoutMs: ANIMATIONS_DONE_TIMEOUT_MS,
});

configureFirstPlayerCoordinator({
  sendToPlayer,
  filterMessage,
  diceRollTimeoutMs: DICE_ROLL_TIMEOUT_MS,
  firstPlayerTimeoutMs: FIRST_PLAYER_TIMEOUT_MS,
});

configureWorkerLifecycle({
  handleWorkerMessage,
  cleanupDuelSession,
});

configureDuelEndCoordinator({
  clearAllDuelTimers,
  rematchExpiryMs: REMATCH_EXPIRY_MS,
  onRematchExpired: rematchExpired,
});

configureReplayPersist({
  springBootApiUrl: SPRING_BOOT_API_URL,
  internalApiKey: INTERNAL_API_KEY,
});

configureWorkerMessageRouter({
  sendToPlayer,
  maxInvalidResponses: MAX_INVALID_RESPONSES,
});

// session-orchestrator owns cleanupDuelSession + startRematch + sendStateSnapshot
// + resendPendingPrompt, which downstream modules below consume via cfg
// (forkHandlers, clientMessageRouter). Configure it before those modules so
// any synchronous side-effect during their configure call resolves through a
// configured cfg. Today no configure has such a side-effect — but topological
// boot ordering is cheap defensive insurance (3-layer review chunk E, BH-4).
configureSessionOrchestrator({
  sessionManager,
  dataDir: DATA_DIR,
});

configureForkHandlers({
  sessionManager,
  sendToPlayer,
  cleanupDuelSession,
  forkConnectionTimeoutMs: 30_000,
});

configureClientMessageRouter({
  sendToPlayer,
  startRematch,
  onStateSyncRequested: (session, playerIndex) => {
    sendStateSnapshot(session, playerIndex);
    // γ Option C PR2 c6bis (A29) — SOLO multiplex re-arms BOTH slots'
    // pending prompts via the single socket so the user can answer
    // whichever identity is currently surface-routed. PvP normal re-arms
    // only the requesting identity.
    if (session.soloMode) {
      resendPendingPrompt(session, 0);
      resendPendingPrompt(session, 1);
    } else {
      resendPendingPrompt(session, playerIndex);
    }
  },
  maxInvalidResponses: MAX_INVALID_RESPONSES,
  stateSyncRateLimitMs: STATE_SYNC_RATE_LIMIT_MS,
  cancelPromptRateLimitMs: CANCEL_PROMPT_RATE_LIMIT_MS,
});

configurePvpConnectionHandler({
  port: PORT,
  isProduction: IS_PRODUCTION,
  sessionManager,
  incrementProtocolMismatch: () => { protocolMismatchCount++; },
});

// =============================================================================
// HTTP Helpers
// =============================================================================

// HTTP helpers (json, readBody) moved to http-helpers.ts (H1 split).
// validateInternalAuth wrapped to bind INTERNAL_API_KEY at the call site.
function validateInternalAuth(req: IncomingMessage, res: ServerResponse): boolean {
  return validateInternalAuthBase(req, res, INTERNAL_API_KEY);
}

// =============================================================================
// HTTP Request Handler
// =============================================================================

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method = req.method ?? 'GET';
  const pathname = url.pathname;
  const requestId = (req.headers['x-request-id'] as string) ?? '-';
  const start = Date.now();

  res.on('finish', () => {
    if (pathname !== '/health') {
      logger.debug('HTTP request', { requestId, method, path: pathname, status: res.statusCode, ms: Date.now() - start });
    }
  });

  // GET /health — extracted to http-routes.ts
  if (method === 'GET' && pathname === '/health') {
    handleHealth(req, res);
    return;
  }

  // GET /status — extracted to http-routes.ts
  if (method === 'GET' && pathname === '/status') {
    handleStatus(req, res);
    return;
  }

  // GET /api/duels/active — List active duel IDs (internal, used by Spring Boot scheduler)
  // Stays in server.ts: bridges through DuelSessionManager (H1-suite phase 5).
  if (method === 'GET' && pathname === '/api/duels/active') {
    json(res, 200, { duelIds: sessionManager.listIds() });
    return;
  }

  // PUT /api/update-data — extracted to http-routes.ts
  if (method === 'PUT' && pathname === '/api/update-data') {
    await handleUpdateData(req, res);
    return;
  }

  // POST /api/validate-passcodes — extracted to http-routes.ts
  if (method === 'POST' && pathname === '/api/validate-passcodes') {
    await handleValidatePasscodes(req, res);
    return;
  }

  // POST /api/duels — Create a new duel
  // NOTE: /api/duels/:id/join removed — see Story 1.3 variance #1. Story 1.4 uses token-based WS association.
  if (method === 'POST' && pathname === '/api/duels') {
    if (!validateInternalAuth(req, res)) return;
    if (!dataReady) {
      json(res, 503, { code: 'SERVER_NOT_READY', error: 'Server not ready — data validation failed' });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        json(res, 413, { code: 'PAYLOAD_TOO_LARGE', error: 'Payload too large' });
        return;
      }
      throw err;
    }

    let parsed: { player1: { id: string; deck: Deck; username?: string; deckName?: string }; player2: { id: string; deck: Deck; username?: string; deckName?: string }; soloMode?: boolean; skipShuffle?: boolean; turnTimeSecs?: number };
    try {
      parsed = JSON.parse(body);
    } catch {
      json(res, 400, { code: 'INVALID_JSON', error: 'Invalid JSON' });
      return;
    }

    if (!parsed.player1?.id || !parsed.player2?.id || !parsed.player1?.deck || !parsed.player2?.deck) {
      json(res, 400, { code: 'INVALID_DECK_FORMAT', error: 'Missing required fields: player1, player2 with id and deck' });
      return;
    }

    const soloMode = parsed.soloMode === true;
    const skipShuffle = parsed.skipShuffle === true;
    const rawTurnTimeSecs = typeof parsed.turnTimeSecs === 'number' ? parsed.turnTimeSecs : 300;
    const turnTimeSecs = Math.min(3600, Math.max(30, Math.round(rawTurnTimeSecs)));

    // Validate deck arrays (M2: prevent worker crash on malformed input)
    if (!Array.isArray(parsed.player1.deck?.main) || !Array.isArray(parsed.player1.deck?.extra) ||
      !Array.isArray(parsed.player2.deck?.main) || !Array.isArray(parsed.player2.deck?.extra)) {
      json(res, 400, { code: 'INVALID_DECK_FORMAT', error: 'Deck must have main and extra arrays' });
      return;
    }

    // Deep deck validation (M3: ensure all entries are positive integers)
    for (const deck of [parsed.player1.deck, parsed.player2.deck]) {
      if (!deck.main.every((c: unknown) => typeof c === 'number' && Number.isInteger(c) && c > 0) ||
        !deck.extra.every((c: unknown) => typeof c === 'number' && Number.isInteger(c) && c > 0)) {
        json(res, 400, { code: 'INVALID_DECK_CONTENT', error: 'Deck arrays must contain positive integers' });
        return;
      }
    }

    const duelId = randomUUID();
    const token0 = randomUUID();
    const token1 = randomUUID();

    // Create DuelSession — worker spawn is deferred until RPS/TP is resolved.
    // U15 (audit-4-modes-2026-06-01) — `createInitialSessionState` consolidates
    // PvP normal + fork-solo construction. PvP defaults are `phase:
    // 'WAITING_PLAYERS'` + `startedAt: null` so the dice flow can populate them.
    const session: ActiveDuelSession = createInitialSessionState({
      duelId,
      players: [
        { playerId: parsed.player1.id, playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
        { playerId: parsed.player2.id, playerIndex: 1, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      ],
      decks: [parsed.player1.deck, parsed.player2.deck],
      soloMode,
      playerUsernames: [parsed.player1.username ?? parsed.player1.id, parsed.player2.username ?? parsed.player2.id],
      deckNames: [parsed.player1.deckName ?? 'Deck', parsed.player2.deckName ?? 'Deck'],
      skipShuffle,
      turnTimeSecs,
    });

    // Store in active duels and pending tokens. γ Option C A6 — SOLO multiplex
    // issues a single token; socket 0 plays both perspectives. token1 is left
    // unallocated so the client can't use it (and SessionManager won't accept it).
    const tokens: readonly [string] | readonly [string, string] =
      soloMode ? [token0] : [token0, token1];
    sessionManager.register(session, tokens);

    // H17 — Connection timeout: if no players connect within 60s, clean up
    const CONNECTION_TIMEOUT_MS = 60_000;
    setTimeout(() => {
      const s = sessionManager.get(duelId);
      if (s && isFullyDisconnected(s)) {
        logger.log('Connection timeout — no players connected, cleaning up', { duelId });
        safeTerminateWorker(s);
        cleanupDuelSession(s);
      }
    }, CONNECTION_TIMEOUT_MS);

    json(res, 201, { duelId, wsTokens: tokens });
    return;
  }

  // DELETE /api/duels/:duelId — terminate a duel (called by Spring Boot on room end)
  const parts = pathname.replace(/^\//, '').split('/');
  if (method === 'DELETE' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'duels') {
    if (!validateInternalAuth(req, res)) return;
    const deleteDuelId = parts[2];
    const session = sessionManager.get(deleteDuelId);
    if (!session) {
      json(res, 404, { code: 'DUEL_NOT_FOUND', error: 'Duel not found' });
      return;
    }
    logger.log('Duel terminated via API', { duelId: deleteDuelId });
    safeTerminateWorker(session);
    cleanupDuelSession(session);
    json(res, 200, { success: true });
    return;
  }

  // 404
  json(res, 404, { code: 'NOT_FOUND', error: 'Not Found' });
}

// =============================================================================
// Worker Lifecycle + Duel End + Replay Persistence
// =============================================================================
// `attachWorkerHandlers` lives in worker-lifecycle.ts (extracted at
// H1-suite phase 2.1). `safeTerminateWorker` / `handleDuelEnd` /
// `requestReplayFromWorker` / `totalDuelsServed` counter live in
// duel-end-coordinator.ts (U34 cosmetic, audit-4-modes-2026-06-01).
// `persistReplay` lives in replay-persist.ts (phase 2.2). `new Worker(...)`
// itself moved to session-orchestrator.ts (U32 #3b) — the worker URL is
// now resolved relative to that module ; server.ts injects `dataDir`
// via the SessionOrchestratorConfig.

// =============================================================================
// Rematch + Duel Start
// =============================================================================
// startRematch / rematchExpired / startDuelWithOrder moved to
// session-orchestrator.ts (U32 #3b, audit-4-modes-2026-06-01).
// `startRematch` is consumed by client-message-router via cfg ;
// `rematchExpired` is wired into DuelEndCoordinator.handleDuelEnd's
// `onRematchExpired` callback ; `startDuelWithOrder` is consumed by
// first-player-coordinator (PvP dice flow) and by pvp-connection-handler
// (SOLO direct path). The Worker URL is now resolved relative to
// session-orchestrator.ts (duel-worker.js lives next to it in
// duel-server/src/).

// =============================================================================
// Worker → Main Message Handler
// =============================================================================

// handleWorkerMessage + broadcastMessage + isSelectMessage + SELECT_TYPES
// moved to worker-message-router.ts at H1-suite phase 2.3.
// configureWorkerMessageRouter wires sendToPlayer + maxInvalidResponses
// at boot. sendToPlayer itself lives in ws-write.ts (U32 #1,
// audit-4-modes-2026-06-01) — pure export, no configurable.

// Response data validation (bounds checking before FFI) — extracted to
// validation/response-validation.ts so it can be unit-tested in isolation
// without booting the server. Audit finding H8.

// =============================================================================
// Turn Timer & Inactivity Timeout (Story 3.2)
// =============================================================================
// Moved to timer-management.ts (H1-suite phase 4). The 13 timer functions
// take `session` as their first arg and call back into server.ts via the
// configureTimerManagement closures (sendToPlayer, handleDuelEnd, etc.).

// =============================================================================
// Duel Session Cleanup
// =============================================================================
// cleanupDuelSession moved to session-orchestrator.ts (U32 #3a,
// audit-4-modes-2026-06-01) — owns the idempotent timer + WS + manager
// teardown sequence. Consumers (worker-lifecycle, fork-handlers,
// timer-management) continue to receive it via cfg ; the import is now
// from session-orchestrator instead of a server.ts local function.

// =============================================================================
// HTTP Server
// =============================================================================

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    logger.error('HTTP unhandled error', { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) {
      json(res, 500, { code: 'INTERNAL_ERROR', error: 'Internal Server Error' });
    }
  });
});

// =============================================================================
// WebSocket Server
// =============================================================================

const wss = new WebSocketServer({ server, maxPayload: MAX_WS_FRAME_SIZE });

// WS rate limiting moved to ws-rate-limit.ts (H1 split)
const wsRateLimitSweepTimer = startWsRateLimitSweep();

// checkProtocolVersion moved to pvp-connection-handler.ts (U32 #2,
// audit-4-modes-2026-06-01). The `protocolMismatchCount` counter stays
// in server.ts (read by `configureHttpRoutes` for /status). The handler
// bumps it through the `incrementProtocolMismatch` cfg getter.

// Boot invariant: every configurable module must be wired before we accept
// connections. Catches a future refactor that adds a 5th module but forgets
// to call its configureXxx() at boot.
{
  const unconfigured: string[] = [];
  if (!isHttpRoutesConfigured()) unconfigured.push('http-routes');
  if (!isReplayHandlersConfigured()) unconfigured.push('replay-handlers');
  if (!isTimerManagementConfigured()) unconfigured.push('timer-management');
  if (!isSolverHandlersConfigured()) unconfigured.push('solver-handlers');
  if (!isFirstPlayerCoordinatorConfigured()) unconfigured.push('first-player-coordinator');
  if (!isWorkerLifecycleConfigured()) unconfigured.push('worker-lifecycle');
  if (!isDuelEndCoordinatorConfigured()) unconfigured.push('duel-end-coordinator');
  if (!isReplayPersistConfigured()) unconfigured.push('replay-persist');
  if (!isWorkerMessageRouterConfigured()) unconfigured.push('worker-message-router');
  if (!isForkHandlersConfigured()) unconfigured.push('fork-handlers');
  if (!isClientMessageRouterConfigured()) unconfigured.push('client-message-router');
  if (!isSessionOrchestratorConfigured()) unconfigured.push('session-orchestrator');
  if (!isPvpConnectionHandlerConfigured()) unconfigured.push('pvp-connection-handler');
  if (unconfigured.length > 0) {
    throw new Error(`Boot invariant failed — modules not configured: ${unconfigured.join(', ')}`);
  }
}

wss.on('connection', handlePvpConnection);

// resendPendingPrompt + sendStateSnapshot moved to session-orchestrator.ts
// (U32 #3a, audit-4-modes-2026-06-01). They're consumed by
// pvp-connection-handler.ts (U32 #2) on initial connect / reconnect, and by
// client-message-router via the `onStateSyncRequested` cfg hook
// (REQUEST_STATE_SYNC dispatch).

// startGracePeriod moved to timer-management.ts (H1-suite phase 4).

// =============================================================================
// Client Message Handling
// =============================================================================

// handleClientMessage + ALLOWED_CLIENT_TYPES moved to client-message-router.ts
// at H1-suite phase 4.1. configureClientMessageRouter wires sendToPlayer +
// startRematch + onStateSyncRequested + the 3 rate-limit/strike constants
// at boot. server.ts only keeps the WS message handler closure that calls
// handleClientMessage with the live playerIndex.

// =============================================================================
// Heartbeat
// =============================================================================

const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    const aliveWs = ws as AliveWebSocket;
    if (aliveWs.isAlive === false) {
      ws.terminate();
      return;
    }
    aliveWs.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

// =============================================================================
// Replay Connection Handling
// =============================================================================
// Moved to replay-handlers.ts (H1-suite phase 3). server.ts owns the bridge
// callback createForkSoloSession (below) which builds an ActiveDuelSession
// when a fork worker reports sanity OK.

// =============================================================================
// Fork Session Bridge
// =============================================================================
// createForkSoloSession + setupForkWorkerHandlers moved to fork-handlers.ts
// at H1-suite phase 3.1. Replay-handlers receives the imported
// createForkSoloSession via the same configureReplayHandlers call below.

// =============================================================================
// Graceful Shutdown
// =============================================================================

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.log('Shutting down...');

  clearInterval(heartbeatTimer);
  clearInterval(wsRateLimitSweepTimer);

  // Terminate all active duel workers
  for (const session of sessionManager.listAll()) {
    safeTerminateWorker(session);
  }

  // Tear down replay state (active connections + pending forks + queue)
  cleanupAllReplayState();

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, 'Server shutting down');
    }
  });

  wss.close(() => {
    server.close(() => {
      logger.log('Server stopped');
      process.exit(0);
    });
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — initiating graceful shutdown', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  shutdown();
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // Do NOT shutdown — a missed .catch() must not kill all active duels
});

// =============================================================================
// Start
// =============================================================================

if (!IS_PRODUCTION && !process.env['INTERNAL_API_KEY']) {
  logger.warn('INTERNAL_API_KEY not set — using dev default key');
}

server.listen(PORT, () => {
  logger.log(`Duel server listening on port ${PORT}`);
});
