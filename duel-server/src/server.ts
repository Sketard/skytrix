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
  WorkerReplayPayload,
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
import { isWsRateLimited, recordFailedWsAttempt, startWsRateLimitSweep } from './ws-rate-limit.js';
import { checkProtocolVersionPure } from './protocol-version-check.js';
import { json, readBody, validateInternalAuth as validateInternalAuthBase } from './http-helpers.js';
import { configureHttpRoutes, handleHealth, handleStatus, handleUpdateData, handleValidatePasscodes } from './http-routes.js';
import { createReplayCache } from './replay-cache.js';
import { configureReplayHandlers, handleReplayConnection, cleanupAllReplayState } from './replay-handlers.js';
import {
  configureTimerManagement,
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
  solverConnections,
  solverJwts,
  solverDeckCache,
} from './solver-handlers.js';
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
let totalDuelsServed = 0;
let dataReady = false;

// =============================================================================
// State
// =============================================================================

// ActiveDuelSession moved to types.ts (H1-suite phase 4) so the timer-
// management module can reference it without re-importing server.ts.

const activeDuels = new Map<string, ActiveDuelSession>();
const pendingTokens = new Map<string, { duelId: string; playerIndex: 0 | 1 }>();
const reconnectTokens = new Map<string, { duelId: string; playerIndex: 0 | 1 }>();
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

// Solver state (solverConnections, solverJwts, solverDeckCache, solverLastStart,
// solverResultCache) moved to solver-handlers.ts (H1 split). Re-exported maps
// imported above are used by the WS connection/close handler below.

configureSolverHandlers({
  orchestrator: () => solverOrchestrator,
  handtraps: () => solverHandtraps,
  rateLimitIntervalMs: () => solverRateLimitIntervalMs,
  timeBudgetFastMs: () => solverTimeBudgetFastMs,
  timeBudgetOptimalMs: () => solverTimeBudgetOptimalMs,
  maxHandtraps: () => solverMaxHandtraps,
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
  activeDuelsSize: () => activeDuels.size,
  totalDuelsServed: () => totalDuelsServed,
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
  // Stays in server.ts: touches `activeDuels` map (H1-suite session-manager boundary).
  if (method === 'GET' && pathname === '/api/duels/active') {
    json(res, 200, { duelIds: [...activeDuels.keys()] });
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
    activeDuels.set(duelId, session);
    pendingTokens.set(token0, { duelId, playerIndex: 0 });
    pendingTokens.set(token1, { duelId, playerIndex: 1 });

    // H17 — Connection timeout: if no players connect within 60s, clean up
    const CONNECTION_TIMEOUT_MS = 60_000;
    setTimeout(() => {
      const s = activeDuels.get(duelId);
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
    const session = activeDuels.get(deleteDuelId);
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
// Safe Worker Termination (M4: prevent double-terminate)
// =============================================================================

function safeTerminateWorker(session: ActiveDuelSession): void {
  if (!session.workerTerminated && session.worker) {
    session.workerTerminated = true;
    totalDuelsServed++;
    session.worker.removeAllListeners();
    session.worker.terminate();
  }
}

// =============================================================================
// Worker Handler Attachment (reused for initial creation + rematch)
// =============================================================================

function attachWorkerHandlers(session: ActiveDuelSession): void {
  if (!session.worker) return;
  session.worker.on('message', (wmsg: WorkerToMainMessage) => {
    handleWorkerMessage(session, wmsg);
  });
  session.worker!.on('exit', (code) => {
    logger.log('Worker exited', { duelId: session.duelId, exitCode: code });
    // Only count if not already counted by safeTerminateWorker
    if (!session.workerTerminated) {
      session.workerTerminated = true;
      totalDuelsServed++;
    }
    // If duel ended normally (endedAt set), keep session alive for rematch
    if (session.endedAt !== null) return;
    // Unexpected worker exit — full cleanup
    cleanupDuelSession(session);
  });
  session.worker!.on('error', (err: Error) => {
    logger.error('Worker error', { duelId: session.duelId, error: err.message });
  });
}

function handleDuelEnd(session: ActiveDuelSession): void {
  session.endedAt = Date.now();
  clearAllDuelTimers(session);
  // M14 — Solo sessions have no rematch flow
  if (!session.soloMode) {
    session.rematchTimeout = setTimeout(() => rematchExpired(session), 5 * 60 * 1000);
  }
}

function requestReplayFromWorker(session: ActiveDuelSession, resultOverride: string): void {
  if (!session.worker || session.workerTerminated) return;
  session.pendingReplayResult = resultOverride;
  session.worker.postMessage({ type: 'EMIT_REPLAY_DATA' });
}

async function persistReplay(session: ActiveDuelSession, payload: import('./types.js').WorkerReplayPayload): Promise<void> {
  const metadata = session.pendingReplayResult
    ? { ...payload.metadata, result: session.pendingReplayResult }
    : payload.metadata;
  session.pendingReplayResult = null;

  const player1Id = Number(session.players[0].playerId);
  const player2Id = Number(session.players[1].playerId);
  if (!Number.isFinite(player1Id) || !Number.isFinite(player2Id)) {
    logger.error('Replay persist aborted: invalid player IDs', { duelId: session.duelId, p1: session.players[0].playerId, p2: session.players[1].playerId });
    return;
  }

  const body = {
    player1Id,
    player2Id,
    metadata,
    replayData: {
      seed: payload.seed,
      decks: payload.decks,
      playerResponses: payload.playerResponses,
    },
  };

  const maxRetries = 3;
  const jsonBody = JSON.stringify(body);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${SPRING_BOOT_API_URL}/replays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': INTERNAL_API_KEY },
        body: jsonBody,
      });
      if (response.ok) {
        const data = await response.json() as { id: string };
        logger.log('Replay persisted', { duelId: session.duelId, replayId: data.id });
        return;
      }
      const errBody = await response.text().catch(() => '');
      logger.error('Replay persist failed', { duelId: session.duelId, attempt, maxRetries, status: response.status, body: errBody });
    } catch (err) {
      logger.error('Replay persist error', { duelId: session.duelId, attempt, maxRetries, error: err instanceof Error ? err.message : String(err) });
    }

    if (attempt < maxRetries) {
      const delay = Math.pow(3, attempt - 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  logger.error('All persist attempts failed — replay data lost', { duelId: session.duelId, maxRetries });
}

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
  session.rpsState = null;
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

function clearRpsTimers(session: ActiveDuelSession): void {
  if (session.rpsState) {
    for (const t of session.rpsState.timers) clearTimeout(t);
    session.rpsState.timers = [];
  }
}

const MAX_RPS_ROUNDS = 10;

function startRpsPhase(session: ActiveDuelSession, round = 0): void {
  session.phase = 'RPS';
  session.rpsState = { choices: [null, null], timers: [], round };
  session.awaitingResponse = [true, true];

  const rps0: ServerMessage = { type: 'RPS_CHOICE', player: 0 };
  const rps1: ServerMessage = { type: 'RPS_CHOICE', player: 1 };
  session.lastSentPrompt = [rps0, rps1];
  sendToPlayer(session, 0, rps0);
  sendToPlayer(session, 1, rps1);

  // Timeout: auto-pick random choice for players who don't respond
  session.rpsState.timers.push(setTimeout(() => {
    if (session.phase !== 'RPS' || !session.rpsState) return;
    for (const p of [0, 1] as const) {
      if (session.rpsState.choices[p] === null) {
        session.rpsState.choices[p] = Math.floor(Math.random() * 3);
        session.awaitingResponse[p] = false;
      }
    }
    resolveRps(session);
  }, RPS_TIMEOUT_MS));
}

function resolveRps(session: ActiveDuelSession): void {
  if (!session.rpsState) return;
  const [c0, c1] = session.rpsState.choices;
  if (c0 === null || c1 === null) return;
  const round = session.rpsState.round;

  // Determine winner: 0=Rock, 1=Paper, 2=Scissors
  let winner: Player | null = null;
  if (c0 !== c1) {
    // Rock(0) beats Scissors(2), Scissors(2) beats Paper(1), Paper(1) beats Rock(0)
    winner = ((c1 + 1) % 3 === c0) ? 0 : 1;
  } else if (round + 1 >= MAX_RPS_ROUNDS) {
    // Force random winner after too many draws
    winner = Math.random() < 0.5 ? 0 : 1;
  }

  // Send RPS_RESULT (perspective-corrected by filterMessage)
  const result: ServerMessage = { type: 'RPS_RESULT', player1Choice: c0, player2Choice: c1, winner };
  for (const p of [0, 1] as const) {
    const filtered = filterMessage(result, p);
    if (filtered) sendToPlayer(session, p, filtered);
  }

  if (winner === null) {
    // Draw — restart RPS after 2s
    setTimeout(() => {
      if (session.phase !== 'RPS') return;
      startRpsPhase(session, round + 1);
    }, 2000);
    return;
  } else {
    // Winner chooses turn order after 1.5s
    const rpsWinner = winner;
    setTimeout(() => {
      if (session.phase !== 'RPS') return;
      session.phase = 'CHOOSE_ORDER';
      session.awaitingResponse = [false, false];
      session.awaitingResponse[rpsWinner] = true;
      const tpMsg: ServerMessage = { type: 'SELECT_TP', player: rpsWinner };
      session.lastSentPrompt = [null, null];
      session.lastSentPrompt[rpsWinner] = tpMsg;
      sendToPlayer(session, rpsWinner, tpMsg);
      sendToPlayer(session, rpsWinner === 0 ? 1 : 0, { type: 'WAITING_RESPONSE' });

      // TP timeout: auto-select "Go first" → send TP_RESULT then start
      if (session.rpsState) {
        session.rpsState.timers.push(setTimeout(() => {
          if (session.phase !== 'CHOOSE_ORDER') return;
          sendToPlayer(session, 0, { type: 'TP_RESULT', goFirst: rpsWinner === 0 });
          sendToPlayer(session, 1, { type: 'TP_RESULT', goFirst: rpsWinner === 1 });
          session.phase = 'TP_RESULT';
          if (session.rpsState) {
            session.rpsState.timers.push(setTimeout(() => {
              if (session.phase !== 'TP_RESULT') return;
              startDuelWithOrder(session, rpsWinner);
            }, 1000));
          }
        }, TP_TIMEOUT_MS));
      }
    }, 1500);
  }
}

function handlePreDuelResponse(session: ActiveDuelSession, playerIndex: 0 | 1, promptType: string, data: Record<string, unknown>): boolean {
  if (session.phase === 'RPS' && promptType === 'RPS_CHOICE' && session.rpsState) {
    const choice = data['choice'] as number;
    if (typeof choice !== 'number' || choice < 0 || choice > 2) return true; // ignore invalid
    if (session.rpsState.choices[playerIndex] !== null) return true; // already answered

    session.rpsState.choices[playerIndex] = choice;
    session.awaitingResponse[playerIndex] = false;
    session.lastSentPrompt[playerIndex] = null;

    // If both have answered, resolve
    if (session.rpsState.choices[0] !== null && session.rpsState.choices[1] !== null) {
      clearRpsTimers(session);
      resolveRps(session);
    }
    return true;
  }

  if (session.phase === 'CHOOSE_ORDER' && promptType === 'SELECT_TP' && session.rpsState) {
    clearRpsTimers(session);
    const goFirst = data['goFirst'] === true;
    const firstPlayer: 0 | 1 = goFirst ? playerIndex : (playerIndex === 0 ? 1 : 0);
    session.awaitingResponse[playerIndex] = false;
    session.lastSentPrompt[playerIndex] = null;

    // Tell both players who goes first, then start duel after delay
    sendToPlayer(session, 0, { type: 'TP_RESULT', goFirst: firstPlayer === 0 });
    sendToPlayer(session, 1, { type: 'TP_RESULT', goFirst: firstPlayer === 1 });
    session.phase = 'TP_RESULT';
    session.rpsState.timers.push(setTimeout(() => {
      if (session.phase !== 'TP_RESULT') return;
      startDuelWithOrder(session, firstPlayer);
    }, 1000));
    return true;
  }

  return false; // not a pre-duel response
}

function startDuelWithOrder(session: ActiveDuelSession, firstPlayer: 0 | 1): void {
  session.phase = 'DUELING';
  clearRpsTimers(session);
  session.rpsState = null;

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
    // Update reconnect token mappings
    for (const p of [0, 1] as const) {
      const tok = session.players[p].reconnectToken;
      if (tok) reconnectTokens.set(tok, { duelId: session.duelId, playerIndex: p });
    }
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

function handleWorkerMessage(session: ActiveDuelSession, wmsg: WorkerToMainMessage): void {
  switch (wmsg.type) {
    case 'WORKER_DUEL_CREATED':
      logger.log('Duel created in worker', { duelId: wmsg.duelId });
      session.startedAt = Date.now();
      // Initialize turn timer context
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
      // Send initial TIMER_STATE for both players (clients display 5:00 from start)
      // Note: no-ops if players haven't connected yet — sendTimerStateToPlayer covers on connection
      sendTimerStateToAll(session);
      break;

    case 'WORKER_MESSAGE':
      broadcastMessage(session, wmsg.message);
      break;

    case 'WORKER_RETRY': {
      // OCGCore rejected the player's response — re-send the cached prompt.
      // lastSentPrompt is intentionally NOT cleared on PLAYER_RESPONSE for exactly this case.
      const p = wmsg.playerIndex;
      const cached = session.lastSentPrompt[p];
      if (cached) {
        session.invalidResponseCount[p]++;
        logger.warn('RETRY: re-sending prompt', { duelId: session.duelId, retryCount: session.invalidResponseCount[p], promptType: cached.type, player: p });

        if (session.invalidResponseCount[p] >= MAX_INVALID_RESPONSES) {
          const winner: Player = p === 0 ? 1 : 0;
          const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'too_many_invalid_responses' };
          logger.log('DUEL_END', { duelId: session.duelId, winner, reason: 'too_many_invalid_responses' });
          sendToPlayer(session, 0, endMsg);
          sendToPlayer(session, 1, endMsg);
          handleDuelEnd(session);
          requestReplayFromWorker(session, 'TIMEOUT');
          return;
        }

        // Re-open the response window so the player can answer again.
        session.awaitingResponse[p] = true;
        sendToPlayer(session, p, cached);
      }
      break;
    }

    case 'WORKER_CANCEL_DONE': {
      // P0-3bis.3 — the worker has rolled back to the IDLECMD/BATTLECMD
      // boundary. Re-broadcast the IDLECMD/BATTLECMD prompt (cached at
      // the moment the player committed) so the client returns to the
      // action menu. NOT counted as a retry.
      //
      // We use `cancelTargetPrompt` (snapshot at PLAYER_RESPONSE for
      // IDLECMD/BATTLECMD) rather than `lastSentPrompt` because the
      // latter was overwritten by intermediate SELECT_PLACE /
      // SELECT_TRIBUTE / SELECT_POSITION between the commit and the
      // cancel. Re-broadcasting the latest `lastSentPrompt` would
      // diverge from the worker's restored ocgcore state.
      //
      // For the FULL inventory of state slots reset across the cancel
      // flow (worker + server + client), see
      // `_bmad-output/planning-artifacts/cancel-rollback-contract.md`.
      // READ IT BEFORE ADDING A NEW MUTABLE FIELD TO ActiveDuelSession
      // that diverges between an IDLECMD/BATTLECMD response and the
      // next IDLECMD/BATTLECMD prompt.
      const p = wmsg.playerIndex;
      const cached = session.cancelTargetPrompt[p];
      if (cached) {
        logger.log('CANCEL: re-broadcasting IDLECMD/BATTLECMD prompt', { duelId: session.duelId, promptType: cached.type, player: p });

        // P0-3bis.3 follow-up — the client may have built up animation
        // queue + chain links + pending prompt between the commit and
        // the cancel (e.g. an MSG_CHAINING that pushed a chain link badge
        // into the overlay). The worker's WASM rollback has discarded
        // all of that on the server side, but the client doesn't know.
        // Send a STATE_SYNC + empty CHAIN_STATE so the client's
        // `handleMessage` STATE_SYNC path runs `processor.reset()` +
        // `commitAll()` + clears pendingPrompt, then restores the chain
        // to empty. Same machinery as a reconnection re-sync.
        if (session.lastBoardState && session.lastBoardState.type === 'BOARD_STATE') {
          const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
          const filtered = filterMessage(stateSync, p);
          if (filtered) sendToPlayer(session, p, filtered);
        }
        // Empty CHAIN_STATE — the worker has discarded the chain links.
        // The client's CHAIN_STATE handler calls
        // `processor.restoreChainState([], 'idle')` which clears the
        // overlay + activeChainLinks signal.
        sendToPlayer(session, p, {
          type: 'CHAIN_STATE',
          links: [],
          phase: 'idle',
          negatedIndices: [],
        } as ServerMessage);
        // Mirror the server-side chain bookkeeping so a subsequent
        // reconnect-resync sends the same empty chain.
        session.activeChainLinks = [];
        session.chainPhase = 'idle';
        session.negatedChainIndices.clear();
        session.currentSolvingChainIndex = null;

        // P0-3bis follow-up — clear the cached hint for this player.
        // It was set when the cancelled effect fired its MSG_HINT
        // ("Select the card(s) to send to the GY", etc.) and would
        // otherwise be replayed verbatim on a reconnect-resync after
        // cancel — pointing at an effect that no longer exists.
        session.lastSentHint[p] = null;

        // P0-3bis follow-up — reset the invalid-response counter.
        // Without this, a player who alternates "activate → cancel"
        // with a few RETRY-inducing inputs would accumulate strikes
        // toward MAX_INVALID_RESPONSES and lose the duel artificially
        // (see `WORKER_RETRY` handler around line 936). Cancel is a
        // legitimate user action and shouldn't carry retry stigma.
        session.invalidResponseCount[p] = 0;

        // Restore both `lastSentPrompt` and `awaitingResponse` so any
        // subsequent disconnect/reconnect re-sync hands back the same
        // prompt the worker is now waiting on.
        session.lastSentPrompt[p] = cached;
        session.awaitingResponse[p] = true;
        sendToPlayer(session, p, cached);
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
      sendToPlayer(session, 0, errorMsg);
      sendToPlayer(session, 1, errorMsg);
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

function broadcastMessage(session: ActiveDuelSession, message: ServerMessage): void {
  // Detect natural DUEL_END from worker (LP=0, deck-out, etc.)
  if (message.type === 'DUEL_END') {
    logger.log('DUEL_END', { duelId: session.duelId, winner: message.winner, reason: 'worker' });
    handleDuelEnd(session);
  }

  // Detect natural game end via MSG_WIN — generate DUEL_END for clients
  // The worker sends MSG_WIN (not DUEL_END) for LP=0, deck-out, Exodia, etc.
  if (message.type === 'MSG_WIN') {
    const endMsg: ServerMessage = { type: 'DUEL_END', winner: message.player, reason: 'win' };
    logger.log('DUEL_END', { duelId: session.duelId, winner: message.player, reason: 'win' });
    sendToPlayer(session, 0, endMsg);
    sendToPlayer(session, 1, endMsg);
    handleDuelEnd(session);
  }

  // Track active chain state for reconnection (extracted to chain-state-tracker
  // for unit testing — same 4 transitions as before, behavior unchanged).
  applyChainTransition(session, message);

  // M22 — Tag MSG_CONFIRM_CARDS with the currently-resolving link's chainIndex
  // so the client can filter prompt reveals per-link. Without this, a reload
  // mid-chain replays previous links' confirms into a later link's prompt
  // header (e.g. Dracotail #1 reveal leaks into Dracotail #2 SELECT_CARD).
  // applyChainTransition above already updated currentSolvingChainIndex.
  if (message.type === 'MSG_CONFIRM_CARDS' && session.currentSolvingChainIndex !== null) {
    (message as { chainIndex?: number }).chainIndex = session.currentSolvingChainIndex;
  }

  // Store last BOARD_STATE for late-connecting players
  if (message.type === 'BOARD_STATE') {
    session.lastBoardState = message;
    // Detect turn changes via turnCount in BOARD_STATE
    // (MSG_NEW_TURN is not emitted as a ServerMessage by the worker — turn info is embedded in BOARD_STATE)
    handleTurnChange(session, message.data.turnPlayer, message.data.turnCount);
  }

  // Track awaitingResponse for SELECT_* messages + start timers
  if (isSelectMessage(message)) {
    const targetPlayer = (message as { player: Player }).player;
    logger.debug('SELECT prompt sent', { duelId: session.duelId, type: message.type, player: targetPlayer, timerRunning: session.timerContext?.running });
    session.awaitingResponse[targetPlayer] = true;
    session.promptSentAt[targetPlayer] = Date.now();
    const opponentOfTarget: 0 | 1 = targetPlayer === 0 ? 1 : 0;
    sendToPlayer(session, opponentOfTarget, { type: 'WAITING_RESPONSE' });
    // Park the timer: runs for the prompted player, starts only after ANIMATIONS_DONE.
    scheduleTimerStart(session, targetPlayer);
    startInactivityTimer(session, targetPlayer);
    // P0-3bis.3 — a fresh IDLECMD/BATTLECMD = new rollback boundary.
    // The worker drops its WASM snapshot here too (see duel-worker.ts
    // around the dto emit path). Mirror that: drop our prompt cache so
    // a stale post-rollback re-broadcast can never fire after a new
    // boundary has been set.
    if (message.type === 'SELECT_IDLECMD' || message.type === 'SELECT_BATTLECMD') {
      session.cancelTargetPrompt[targetPlayer] = null;
    }
  }

  // Apply message filter per player
  for (const playerIndex of [0, 1] as const) {
    const filtered = filterMessage(message, playerIndex);
    if (filtered) {
      // Cache filtered SELECT_* message for prompt re-send on reconnection
      if (isSelectMessage(message) && (message as { player: Player }).player === playerIndex) {
        session.lastSentPrompt[playerIndex] = filtered;
      }
      // Cache last MSG_HINT per player for re-send on reconnection (precedes SELECT_*)
      if (message.type === 'MSG_HINT') {
        session.lastSentHint[playerIndex] = filtered;
      }
      sendToPlayer(session, playerIndex, filtered);
    }
  }
}

function sendToPlayer(session: ActiveDuelSession, playerIndex: 0 | 1, message: ServerMessage): void {
  const ws = session.players[playerIndex].ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

const SELECT_TYPES = new Set([
  'SELECT_IDLECMD', 'SELECT_BATTLECMD', 'SELECT_CARD', 'SELECT_CHAIN',
  'SELECT_EFFECTYN', 'SELECT_YESNO', 'SELECT_PLACE', 'SELECT_DISFIELD',
  'SELECT_POSITION', 'SELECT_OPTION', 'SELECT_TRIBUTE', 'SELECT_SUM',
  'SELECT_UNSELECT_CARD', 'SELECT_COUNTER', 'SORT_CARD', 'SORT_CHAIN',
  'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_CARD', 'ANNOUNCE_NUMBER',
  'RPS_CHOICE',
]);

function isSelectMessage(message: ServerMessage): boolean {
  return SELECT_TYPES.has(message.type);
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
  clearRpsTimers(session);
  session.rpsState = null;

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

  // Close WebSocket connections and clean up reconnect tokens
  for (const player of session.players) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.close(1000, 'Duel ended');
    }
    player.ws = null;
    player.connected = false;

    // Clean up reconnect token
    if (player.reconnectToken) {
      reconnectTokens.delete(player.reconnectToken);
      player.reconnectToken = null;
    }

    // Clean up grace period timer
    if (player.gracePeriodTimer) {
      clearTimeout(player.gracePeriodTimer);
      player.gracePeriodTimer = null;
    }
  }

  // Clean up pending tokens for this duel
  for (const [token, info] of pendingTokens) {
    if (info.duelId === session.duelId) {
      pendingTokens.delete(token);
    }
  }

  activeDuels.delete(session.duelId);
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
    ws.close(4426, `Protocol version mismatch (server=${result.serverVersion}, client=${result.rawClientVersion ?? 'missing'})`);
    return false;
  }
  return true;
}

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  // Trust x-real-ip only behind a reverse proxy in production; fall back to socket IP otherwise
  const ip = (IS_PRODUCTION && req.headers['x-real-ip'] as string) || req.socket.remoteAddress || 'unknown';

  if (IS_PRODUCTION && isWsRateLimited(ip)) {
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

    // Connection limit guard
    if (solverConnections.size >= maxSolverConnections) {
      ws.close(4029, 'Too many solver connections');
      return;
    }

    // Replace existing solver WS for same user
    const existingWs = solverConnections.get(userId);
    if (existingWs) {
      existingWs.close(4001, 'Replaced by new connection');
    }
    solverConnections.set(userId, ws);
    solverJwts.set(userId, jwt);

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

    // Close handler — remove from map but do NOT abort running solves
    ws.on('close', () => {
      if (solverConnections.get(userId) === ws) {
        solverConnections.delete(userId);
        solverJwts.delete(userId);
        // Drop the user's deck cache entries (TTL would expire them anyway,
        // but this keeps the map bounded under churn).
        for (const key of solverDeckCache.keys()) {
          if (key.startsWith(`${userId}:`)) solverDeckCache.delete(key);
        }
      }
    });

    ws.on('error', (error) => {
      console.error('[Solver] ws error', { userId, error });
    });

    console.log('[Solver] connected', { userId });
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
    const reconInfo = reconnectTokens.get(reconnect);
    if (!reconInfo) {
      recordFailedWsAttempt(ip);
      ws.close(4001, 'Invalid or expired reconnect token');
      return;
    }
    session = activeDuels.get(reconInfo.duelId);
    if (!session) {
      recordFailedWsAttempt(ip);
      ws.close(4001, 'Duel not found');
      reconnectTokens.delete(reconnect);
      return;
    }
    playerIndex = reconInfo.playerIndex;

    // Invalidate old reconnect token
    reconnectTokens.delete(reconnect);

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
    const tokenInfo = pendingTokens.get(token!);
    if (!tokenInfo) {
      recordFailedWsAttempt(ip);
      ws.close(4001, 'Invalid or expired token');
      return;
    }
    session = activeDuels.get(tokenInfo.duelId);
    if (!session) {
      recordFailedWsAttempt(ip);
      ws.close(4001, 'Duel not found');
      pendingTokens.delete(token!);
      return;
    }
    playerIndex = tokenInfo.playerIndex;
    pendingTokens.delete(token!);

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

  // Issue reconnect token
  const newReconnectToken = randomUUID();
  // Invalidate previous reconnect token if any
  const oldToken = session.players[playerIndex].reconnectToken;
  if (oldToken) reconnectTokens.delete(oldToken);
  session.players[playerIndex].reconnectToken = newReconnectToken;
  reconnectTokens.set(newReconnectToken, { duelId: session.duelId, playerIndex });

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
        const ws = session.players[playerIndex].ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ERROR', message: `Expected prompt type ${expectedPrompt.type}, got ${msg.promptType}` }));
        }
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
// `createForkSoloSession` is the bridge that replay-handlers calls when a
// fork worker reports sanity OK. It owns everything that touches the session
// manager state (activeDuels / pendingTokens / setupForkWorkerHandlers).
// Replay-handlers stays unaware of `ActiveDuelSession` shape.

function createForkSoloSession({ forkDuelId, userId, worker, replayData }: {
  forkDuelId: string;
  userId: string;
  worker: Worker;
  replayData: WorkerReplayPayload;
}): { token1: string; token2: string } {
  const token1 = randomUUID();
  const token2 = randomUUID();

  const session: ActiveDuelSession = {
    duelId: forkDuelId,
    phase: 'DUELING',
    rpsState: null,
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
  };

  activeDuels.set(forkDuelId, session);
  pendingTokens.set(token1, { duelId: forkDuelId, playerIndex: 0 });
  pendingTokens.set(token2, { duelId: forkDuelId, playerIndex: 1 });

  // H2 — Clean up if no client connects within 30s
  session.forkConnectionTimeout = setTimeout(() => {
    if (!session.players[0].connected && !session.players[1].connected) {
      logger.log('ForkSolo: no client connected within timeout — cleaning up', { duelId: forkDuelId });
      safeTerminateWorker(session);
      cleanupDuelSession(session);
    }
  }, 30_000);

  // Re-wire the fork worker from the replay-handlers handlers to the session
  // ones. Order matters: removeAllListeners FIRST, then attach.
  worker.removeAllListeners('message');
  worker.removeAllListeners('exit');
  worker.removeAllListeners('error');
  setupForkWorkerHandlers(session, worker);

  return { token1, token2 };
}

function setupForkWorkerHandlers(session: ActiveDuelSession, worker: Worker): void {
  worker.on('message', (wmsg: WorkerToMainMessage) => {
    if (wmsg.type === 'WORKER_MESSAGE') {
      const message = wmsg.message;

      // Detect natural game end via MSG_WIN — generate DUEL_END for clients (same as broadcastMessage)
      if (message.type === 'MSG_WIN') {
        const endMsg: ServerMessage = { type: 'DUEL_END', winner: message.player, reason: 'win' };
        logger.log('DUEL_END', { duelId: session.duelId, winner: message.player, reason: 'win', mode: 'fork_solo' });
        sendToPlayer(session, 0, endMsg);
        sendToPlayer(session, 1, endMsg);
        handleDuelEnd(session);
      }

      // Store last BOARD_STATE for reconnection
      if (message.type === 'BOARD_STATE') {
        session.lastBoardState = message;
      }

      // Track SELECT prompts for awaiting response + cache for reconnection
      if (isSelectMessage(message)) {
        const targetPlayer = (message as { player: Player }).player;
        session.awaitingResponse[targetPlayer] = true;
      }

      // Apply message filter (omniscient) and send per player
      for (const [idx, ps] of session.players.entries()) {
        if (ps.ws?.readyState === WebSocket.OPEN) {
          const filtered = filterMessage(message, idx as 0 | 1, true);
          if (filtered) {
            // Cache filtered SELECT prompt for re-send on reconnection
            if (isSelectMessage(message) && (message as { player: Player }).player === idx) {
              session.lastSentPrompt[idx] = filtered;
            }
            if (message.type === 'MSG_HINT') {
              session.lastSentHint[idx] = filtered;
            }
            ps.ws.send(JSON.stringify(filtered));
          }
        }
      }
    } else if (wmsg.type === 'WORKER_ERROR') {
      logger.error('ForkSolo worker error', { duelId: session.duelId, error: wmsg.error });
    } else if (wmsg.type === 'WORKER_RETRY') {
      // Re-send last prompt to the relevant player
      for (const [idx, ps] of session.players.entries()) {
        if (session.lastSentPrompt[idx] && ps.ws?.readyState === WebSocket.OPEN) {
          ps.ws.send(JSON.stringify(session.lastSentPrompt[idx]));
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
  for (const session of activeDuels.values()) {
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
