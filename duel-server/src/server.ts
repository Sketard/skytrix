import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Worker } from 'node:worker_threads';
import { randomUUID, randomBytes } from 'node:crypto';
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
  RPS_TIMEOUT_MS,
  TP_TIMEOUT_MS,
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
  RpsState,
  ReplayMetadata,
} from './types.js';
import type {
  ServerMessage, ClientMessage, Player,
  SolverStartMessage, SolverResultMessage, SolverCancelledMessage,
  SolverProgressMessage, SolverErrorMessage, SolverHandtrapsMessage, SolverWsError,
} from './ws-protocol.js';
import {
  SOLVER_START, SOLVER_CANCEL, SOLVER_INIT, SOLVER_PROGRESS,
  SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR, SOLVER_HANDTRAPS,
  PROTOCOL_VERSION,
} from './ws-protocol.js';
import { filterMessage } from './message-filter.js';
import { validateData, initScriptsHash, getScriptsHash, getOcgcoreVersion } from './ocg-scripts.js';
import * as logger from './logger.js';
import { validateResponseData } from './validation/response-validation.js';
import { applyChainTransition, emptyChainState, type ChainStateContainer } from './chain-state-tracker.js';
import { DuelSessionManager } from './duel-session-manager.js';
import { consumeWsAttempt, recordFailedWsAttempt, startWsRateLimitSweep } from './ws-rate-limit.js';
import { checkProtocolVersionPure } from './protocol-version-check.js';
import { json, readBody, safeSend, validateInternalAuth as validateInternalAuthBase } from './http-helpers.js';
import { configureHttpRoutes, handleHealth, handleStatus, handleUpdateData, handleValidatePasscodes, isHttpRoutesConfigured } from './http-routes.js';
import { createReplayCache } from './replay-cache.js';
import { configureReplayHandlers, handleReplayConnection, cleanupAllReplayState, isReplayHandlersConfigured } from './replay-handlers.js';
import {
  configureTimerManagement,
  isTimerManagementConfigured,
  sendTimerStateToAll, sendTimerStateToPlayer,
  startTurnTimer, pauseTurnTimer, scheduleTimerStart, commitPendingTimer,
  addTurnIncrement, handleTurnChange,
  startInactivityTimer, clearInactivityTimer,
  clearAllDuelTimers,
  startGracePeriod,
} from './timer-management.js';
import {
  configureSolverHandlers,
  handleSolverMessage,
  isSolverHandlersConfigured,
  attachSolverConnection,
  detachSolverConnection,
} from './solver-handlers.js';
import {
  configureRpsCoordinator,
  isRpsCoordinatorConfigured,
  startRpsPhase,
  handlePreDuelResponse,
  disposeRps,
} from './rps-coordinator.js';
import {
  configureWorkerLifecycle,
  isWorkerLifecycleConfigured,
  safeTerminateWorker,
  attachWorkerHandlers,
  handleDuelEnd,
  requestReplayFromWorker,
  getTotalDuelsServed,
} from './worker-lifecycle.js';
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

configureRpsCoordinator({
  sendToPlayer,
  filterMessage,
  startDuelWithOrder,
  rpsTimeoutMs: RPS_TIMEOUT_MS,
  tpTimeoutMs: TP_TIMEOUT_MS,
});

configureWorkerLifecycle({
  handleWorkerMessage,
  cleanupDuelSession,
  clearAllDuelTimers,
  rematchExpiryMs: 5 * 60 * 1000,
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

configureForkHandlers({
  sessionManager,
  sendToPlayer,
  cleanupDuelSession,
  forkConnectionTimeoutMs: 30_000,
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

    // Create DuelSession — worker spawn is deferred until RPS/TP is resolved
    const session: ActiveDuelSession = {
      duelId,
      phase: 'WAITING_PLAYERS',
      rpsState: null,
      players: [
        { playerId: parsed.player1.id, playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
        { playerId: parsed.player2.id, playerIndex: 1, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivitySlot: null },
      ],
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      worker: null,
      workerTerminated: false,
      awaitingResponse: [false, false],
      lastBoardState: null,
      lastSentPrompt: [null, null],
      lastSentHint: [null, null],
      decks: [parsed.player1.deck, parsed.player2.deck],
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
      soloMode,
      skipShuffle,
      turnTimeSecs,
      invalidResponseCount: [0, 0],
      promptSentAt: [0, 0],
      ...emptyChainState(),
      playerUsernames: [parsed.player1.username ?? parsed.player1.id, parsed.player2.username ?? parsed.player2.id],
      deckNames: [parsed.player1.deckName ?? 'Deck', parsed.player2.deckName ?? 'Deck'],
      pendingReplayResult: null,
      forkConnectionTimeout: null,
    };

    // Store in active duels and pending tokens
    sessionManager.register(session, [token0, token1]);

    // H17 — Connection timeout: if no players connect within 60s, clean up
    const CONNECTION_TIMEOUT_MS = 60_000;
    setTimeout(() => {
      const s = sessionManager.get(duelId);
      if (s && s.players.every(p => !p.connected)) {
        logger.log('Connection timeout — no players connected, cleaning up', { duelId });
        safeTerminateWorker(s);
        cleanupDuelSession(s);
      }
    }, CONNECTION_TIMEOUT_MS);

    json(res, 201, { duelId, wsTokens: [token0, token1] });
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
// Worker Lifecycle + Replay Persistence
// =============================================================================
// safeTerminateWorker / attachWorkerHandlers / handleDuelEnd /
// requestReplayFromWorker / totalDuelsServed counter live in
// worker-lifecycle.ts (extracted at H1-suite phase 2.1). persistReplay
// lives in replay-persist.ts (phase 2.2). Server.ts keeps the actual
// `new Worker(...)` calls (the host owns where the worker URL
// resolves) — the modules own the listener wiring, lifecycle flags,
// and HTTP retry loop.

// =============================================================================
// Rematch
// =============================================================================

function startRematch(session: ActiveDuelSession): void {
  if (session.rematchTimeout) {
    clearTimeout(session.rematchTimeout);
    session.rematchTimeout = null;
  }

  sendToPlayer(session, 0, { type: 'REMATCH_STARTING' });
  sendToPlayer(session, 1, { type: 'REMATCH_STARTING' });

  // Remove old worker handlers to prevent cleanupDuelSession on exit
  safeTerminateWorker(session);

  const worker = new Worker(new URL('./duel-worker.js', import.meta.url), {
    workerData: { dataDir: DATA_DIR },
  });

  session.phase = 'DUELING';
  disposeRps(session);
  session.worker = worker;
  session.workerTerminated = false;
  session.awaitingResponse = [false, false];
  session.lastBoardState = null;
  session.lastSentPrompt = [null, null];
  session.lastSentHint = [null, null];
  session.rematchRequested = [false, false];
  session.endedAt = null;
  session.startedAt = Date.now();
  session.bothDisconnected = false;
  session.storedDuelResult = null;
  session.lastStateSyncAt = [0, 0];
  session.lastCancelAt = [0, 0];
  session.cancelTargetPrompt = [null, null];
  session.invalidResponseCount = [0, 0];
  session.promptSentAt = [0, 0];
  Object.assign(session, emptyChainState());

  clearAllDuelTimers(session);

  attachWorkerHandlers(session);

  worker.postMessage({
    type: 'INIT_DUEL',
    duelId: session.duelId,
    decks: session.decks,
    playerUsernames: session.playerUsernames,
    deckNames: session.deckNames,
    skipRps: true,
    skipShuffle: session.skipShuffle,
  });
}

function rematchExpired(session: ActiveDuelSession): void {
  session.rematchTimeout = null;
  sendToPlayer(session, 0, { type: 'REMATCH_CANCELLED', reason: 'timeout' });
  sendToPlayer(session, 1, { type: 'REMATCH_CANCELLED', reason: 'timeout' });
  cleanupDuelSession(session);
}

// =============================================================================
// Pre-Duel RPS & Turn Player Selection
// =============================================================================
// startRpsPhase / handlePreDuelResponse / disposeRps live in rps-coordinator.ts
// (extracted at H1-suite phase 5). The bridge into worker spawning below
// (startDuelWithOrder) is injected back into the coordinator via configure.

function startDuelWithOrder(session: ActiveDuelSession, firstPlayer: 0 | 1): void {
  session.phase = 'DUELING';
  disposeRps(session);

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
    sessionManager.remapReconnectTokensAfterSwap(session);
  }

  // Tell each player their OCGCore index (after potential swap). Each side
  // receives only their own decklist's card codes — sending the union would
  // let the opponent's deck be reconstructed from the upfront image prefetch.
  sendToPlayer(session, 0, { type: 'DUEL_STARTING', playerIndex: 0, traceId: session.duelId, cardCodes: extractCardCodesForPlayer(session.decks, 0) });
  sendToPlayer(session, 1, { type: 'DUEL_STARTING', playerIndex: 1, traceId: session.duelId, cardCodes: extractCardCodesForPlayer(session.decks, 1) });

  // Spawn worker
  const worker = new Worker(new URL('./duel-worker.js', import.meta.url), {
    workerData: { dataDir: DATA_DIR },
  });

  session.worker = worker;
  session.workerTerminated = false;
  session.awaitingResponse = [false, false];
  session.lastSentPrompt = [null, null];
  session.lastSentHint = [null, null];
  session.startedAt = Date.now();

  attachWorkerHandlers(session);

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
  });
}

// =============================================================================
// Worker → Main Message Handler
// =============================================================================

// handleWorkerMessage + broadcastMessage + isSelectMessage + SELECT_TYPES
// moved to worker-message-router.ts at H1-suite phase 2.3.
// configureWorkerMessageRouter wires sendToPlayer + maxInvalidResponses
// at boot. Server.ts keeps sendToPlayer as the WS-write helper (37
// inline call sites depend on it).
function sendToPlayer(session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage): void {
  safeSend(session.players[playerIndex].ws, message);
}


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

function cleanupDuelSession(session: ActiveDuelSession): void {
  session.endedAt = session.endedAt ?? Date.now();
  session.lastSentPrompt = [null, null];
  session.lastSentHint = [null, null];

  // Clear pre-duel RPS timeout
  disposeRps(session);

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
  sessionManager.terminate(session);
}

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

/**
 * Reject the handshake when the client's `pv` query param does not match
 * server-side `PROTOCOL_VERSION`. Returns true on accept, false on reject
 * (after closing the WS with code 4426 — analog to HTTP 426 Upgrade Required).
 *
 * Applied to PvP + Replay handshakes. Solver handshakes are exempt (their
 * protocol shape is request/response style and currently has no version
 * surface worth gating).
 */
function checkProtocolVersion(ws: WebSocket, url: URL, mode: string, ip: string): boolean {
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
    protocolMismatchCount++;
    ws.close(4426, `Protocol version mismatch (server=${result.serverVersion}, client=${result.rawClientVersion ?? 'missing'})`);
    return false;
  }
  return true;
}

// Boot invariant: every configurable module must be wired before we accept
// connections. Catches a future refactor that adds a 5th module but forgets
// to call its configureXxx() at boot.
{
  const unconfigured: string[] = [];
  if (!isHttpRoutesConfigured()) unconfigured.push('http-routes');
  if (!isReplayHandlersConfigured()) unconfigured.push('replay-handlers');
  if (!isTimerManagementConfigured()) unconfigured.push('timer-management');
  if (!isSolverHandlersConfigured()) unconfigured.push('solver-handlers');
  if (!isRpsCoordinatorConfigured()) unconfigured.push('rps-coordinator');
  if (!isWorkerLifecycleConfigured()) unconfigured.push('worker-lifecycle');
  if (!isReplayPersistConfigured()) unconfigured.push('replay-persist');
  if (!isWorkerMessageRouterConfigured()) unconfigured.push('worker-message-router');
  if (!isForkHandlersConfigured()) unconfigured.push('fork-handlers');
  if (unconfigured.length > 0) {
    throw new Error(`Boot invariant failed — modules not configured: ${unconfigured.join(', ')}`);
  }
}

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
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
    if (!checkProtocolVersion(ws, url, 'replay', ip)) return;
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
    if (!checkProtocolVersion(ws, url, 'solver', ip)) return;
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
  if (!checkProtocolVersion(ws, url, 'pvp', ip)) return;

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

    resendPendingPrompt(session, playerIndex);
  }

  // Check if both players are connected — trigger pre-duel RPS or fork resume
  if (session.players[0].connected && session.players[1].connected) {
    logger.log('Both players connected', { duelId: session.duelId });
    if (session.phase === 'WAITING_PLAYERS') {
      if (session.soloMode) {
        // Solo mode: backend already placed the first player at index 0
        startDuelWithOrder(session, 0);
      } else {
        startRpsPhase(session);
      }
    } else if (session.phase === 'DUELING' && session.duelId.startsWith('fork-')) {
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
    let parsed: ClientMessage;
    const live = currentPlayerIndex();
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      logger.error('Invalid JSON from player', { duelId: session!.duelId, player: live });
      return;
    }

    handleClientMessage(session!, live, parsed);
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

      // Story 3.3 — Notify opponent of disconnection
      const opponentIndex: Player = live === 0 ? 1 : 0;
      sendToPlayer(session!, opponentIndex, { type: 'OPPONENT_DISCONNECTED', gracePeriodSec: RECONNECT_GRACE_MS / 1000 });

      startGracePeriod(session!, live);
    } else {
      // Post-duel disconnect: notify opponent rematch is cancelled
      const opponentIndex: Player = live === 0 ? 1 : 0;
      sendToPlayer(session!, opponentIndex, { type: 'REMATCH_CANCELLED', reason: 'opponent_left' });

      // If both players disconnected after duel end, cleanup
      if (!session!.players[0].connected && !session!.players[1].connected) {
        cleanupDuelSession(session!);
      }
    }
  });
});

/** Re-send cached hint + prompt if the player has a pending selection. */
function resendPendingPrompt(session: ActiveDuelSession, playerIndex: 0 | 1): void {
  if (session.awaitingResponse[playerIndex] && session.lastSentPrompt[playerIndex]) {
    if (session.lastSentHint[playerIndex]) {
      sendToPlayer(session, playerIndex, session.lastSentHint[playerIndex]!);
    }
    sendToPlayer(session, playerIndex, session.lastSentPrompt[playerIndex]!);
  }
}

// Story 5.2 — DRY: reusable state snapshot for reconnection + REQUEST_STATE_SYNC
function sendStateSnapshot(session: ActiveDuelSession, playerIndex: 0 | 1): void {
  // Re-send OCGCore player index (lost on page refresh)
  if (session.phase === 'DUELING') {
    sendToPlayer(session, playerIndex, { type: 'DUEL_STARTING', playerIndex, traceId: session.duelId, cardCodes: extractCardCodesForPlayer(session.decks, playerIndex) } as ServerMessage);
  }
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

// startGracePeriod moved to timer-management.ts (H1-suite phase 4).

// =============================================================================
// Client Message Handling
// =============================================================================

const ALLOWED_CLIENT_TYPES = new Set(['PLAYER_RESPONSE', 'SURRENDER', 'REMATCH_REQUEST', 'REQUEST_STATE_SYNC', 'ACTIVITY_PING', 'ANIMATIONS_DONE', 'CANCEL_PROMPT_SEQUENCE']);

function handleClientMessage(session: ActiveDuelSession, playerIndex: 0 | 1, msg: ClientMessage): void {
  // Validate message type
  if (!ALLOWED_CLIENT_TYPES.has(msg.type)) {
    logger.error('Invalid message type', { duelId: session.duelId, player: playerIndex, type: msg.type });
    return;
  }

  switch (msg.type) {
    case 'PLAYER_RESPONSE': {
      logger.debug('PLAYER_RESPONSE', { duelId: session.duelId, player: playerIndex, promptType: msg.promptType, awaiting: session.awaitingResponse.slice(), lastPrompt: session.lastSentPrompt[playerIndex]?.type });
      // Check awaitingResponse flag — prevents spam/out-of-sequence responses
      if (!session.awaitingResponse[playerIndex]) {
        logger.error('Unexpected PLAYER_RESPONSE', { duelId: session.duelId, player: playerIndex });
        return;
      }

      // M28 — Validate promptType matches the expected prompt
      const expectedPrompt = session.lastSentPrompt[playerIndex];
      if (expectedPrompt && msg.promptType !== expectedPrompt.type) {
        safeSend(session.players[playerIndex].ws, { type: 'ERROR', message: `Expected prompt type ${expectedPrompt.type}, got ${msg.promptType}` });
        return;
      }

      // Pre-duel RPS/TP — handled by application layer, not forwarded to worker
      if (session.phase !== 'DUELING') {
        if (handlePreDuelResponse(session, playerIndex, msg.promptType, msg.data as unknown as Record<string, unknown>)) return;
      }

      // Validate response data bounds before forwarding to worker (FFI safety)
      if (expectedPrompt) {
        const validation = validateResponseData(expectedPrompt, msg.data as unknown as Record<string, unknown>);
        if (!validation.ok) {
          logger.warn('Invalid response data — re-sending prompt', { duelId: session.duelId, player: playerIndex, reason: validation.error });
          session.invalidResponseCount[playerIndex]++;
          if (session.invalidResponseCount[playerIndex] >= MAX_INVALID_RESPONSES) {
            const winner: Player = playerIndex === 0 ? 1 : 0;
            const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'too_many_invalid_responses' };
            logger.log('DUEL_END', { duelId: session.duelId, winner, reason: 'too_many_invalid_responses' });
            sendToPlayer(session, 0, endMsg);
            sendToPlayer(session, 1, endMsg);
            handleDuelEnd(session);
            requestReplayFromWorker(session, 'TIMEOUT');
            return;
          }
          // Re-send prompt like a RETRY
          sendToPlayer(session, playerIndex, expectedPrompt);
          return;
        }
      }

      session.invalidResponseCount[playerIndex] = 0;
      session.awaitingResponse[playerIndex] = false;
      // Keep lastSentPrompt set — WORKER_RETRY (OCGCore rejected response) needs it to re-send.
      // It is overwritten when the next SELECT prompt is broadcast, or cleared on reconnect/reset.
      session.lastSentHint[playerIndex] = null;

      // P0-3bis.3 — when the player commits a SELECT_IDLECMD/BATTLECMD
      // response, snapshot the prompt SO the cancel handler can restore
      // it later. The worker takes its WASM snapshot at the same boundary.
      // We mirror the worker's intent on the server side because
      // `lastSentPrompt` will be overwritten by intermediate
      // SELECT_PLACE / SELECT_TRIBUTE / SELECT_POSITION before the user
      // can right-click to cancel.
      if (msg.promptType === 'SELECT_IDLECMD' || msg.promptType === 'SELECT_BATTLECMD') {
        session.cancelTargetPrompt[playerIndex] = expectedPrompt ?? null;
      }

      // Story 3.2 — Pause turn timer + clear inactivity/race timers on player response
      pauseTurnTimer(session);
      clearInactivityTimer(session, playerIndex as Player);

      const forwardToWorker = () => {
        if (session.endedAt || !session.worker) return;
        session.worker.postMessage({
          type: 'PLAYER_RESPONSE',
          playerIndex,
          promptType: msg.promptType,
          data: msg.data,
        });
      };

      // Bluff timer disabled — forward immediately.
      forwardToWorker();
      break;
    }

    case 'SURRENDER': {
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      const endMsg: ServerMessage = { type: 'DUEL_END', winner: opponentIndex, reason: 'surrender' };
      logger.log('DUEL_END', { duelId: session.duelId, winner: opponentIndex, reason: 'surrender', player: playerIndex });
      sendToPlayer(session, 0, endMsg);
      sendToPlayer(session, 1, endMsg);
      handleDuelEnd(session);
      requestReplayFromWorker(session, 'SURRENDER');
      break;
    }

    case 'REMATCH_REQUEST': {
      if (session.endedAt === null) break;
      session.rematchRequested[playerIndex] = true;
      const opponentIdx: Player = playerIndex === 0 ? 1 : 0;
      if (session.rematchRequested[opponentIdx]) {
        startRematch(session);
      } else {
        sendToPlayer(session, opponentIdx, { type: 'REMATCH_INVITATION' });
      }
      break;
    }

    case 'ACTIVITY_PING': {
      // Reset inactivity timer if player is being prompted
      if (session.awaitingResponse[playerIndex]) {
        clearInactivityTimer(session, playerIndex as Player);
        startInactivityTimer(session, playerIndex as Player);
      }
      break;
    }

    case 'ANIMATIONS_DONE': {
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
      // Story 5.2 — Rate-limit: max 1 per 5s per player
      const now = Date.now();
      if (now - session.lastStateSyncAt[playerIndex] < STATE_SYNC_RATE_LIMIT_MS) break;
      session.lastStateSyncAt[playerIndex] = now;

      sendStateSnapshot(session, playerIndex);
      resendPendingPrompt(session, playerIndex);
      break;
    }

    case 'CANCEL_PROMPT_SEQUENCE': {
      // P0-3bis.3 — Roll back the duel to the most recent
      // IDLECMD/BATTLECMD snapshot the worker holds. The worker will
      // re-emit the original prompt so the player can choose again.
      //
      // Guards (P0-3bis.3 hardening — code-review 2026-05-08):
      //  1. Phase must be DUELING — pre-duel RPS / rematch / disconnect-grace
      //     can have `awaitingResponse=true` without an active duel worker.
      //  2. Rate-limit (CANCEL_PROMPT_RATE_LIMIT_MS) — bounds the cost of a
      //     malicious flood. Each cancel triggers a worker restore +
      //     prompt re-broadcast; without this guard, scripted spam could
      //     saturate the worker.
      //  3. `awaitingResponse[player]` — the player must currently have
      //     an in-flight prompt to cancel.
      //  4. Worker must exist and duel not ended — defensive.
      if (session.phase !== 'DUELING') {
        logger.warn('CANCEL_PROMPT_SEQUENCE rejected (non-DUELING phase)', { duelId: session.duelId, player: playerIndex, phase: session.phase });
        break;
      }
      const now = Date.now();
      if (now - session.lastCancelAt[playerIndex] < CANCEL_PROMPT_RATE_LIMIT_MS) {
        logger.warn('CANCEL_PROMPT_SEQUENCE rate-limited', { duelId: session.duelId, player: playerIndex });
        break;
      }
      if (!session.awaitingResponse[playerIndex]) {
        logger.warn('CANCEL_PROMPT_SEQUENCE while not awaiting response', { duelId: session.duelId, player: playerIndex });
        break;
      }
      if (!session.worker || session.endedAt) {
        logger.warn('CANCEL_PROMPT_SEQUENCE with no active worker', { duelId: session.duelId, player: playerIndex });
        break;
      }
      session.lastCancelAt[playerIndex] = now;
      logger.log('CANCEL_PROMPT_SEQUENCE forwarded to worker', { duelId: session.duelId, player: playerIndex });
      // The worker will re-emit BOARD_STATE + the previous IDLECMD/BATTLECMD;
      // those messages flow through the existing WORKER_MESSAGE handling so
      // `awaitingResponse` is reset by the prompt-broadcast path. Don't
      // pre-flip it here — let the prompt arrival do it normally.
      session.worker.postMessage({
        type: 'CANCEL_PROMPT_SEQUENCE',
        playerIndex,
      });
      break;
    }
  }
}

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
