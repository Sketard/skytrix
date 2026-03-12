import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { resolve, join, basename } from 'node:path';
import { MAX_PAYLOAD_SIZE, RECONNECT_GRACE_MS, TURN_TIME_POOL_MS, TURN_TIME_INCREMENT_MS, INACTIVITY_TIMEOUT_MS, INACTIVITY_WARNING_BEFORE_MS, INACTIVITY_RACE_WINDOW_MS, BOTH_DISCONNECTED_CLEANUP_MS, STATE_SYNC_RATE_LIMIT_MS } from './types.js';
import type { WorkerToMainMessage, DuelSession, PlayerSession, Deck, TimerContext } from './types.js';
import type { ServerMessage, ClientMessage, Player, SelectPromptType } from './ws-protocol.js';
import { filterMessage } from './message-filter.js';
import { validateData, findMissingPasscodes } from './ocg-scripts.js';
import { updateData } from './data-updater.js';

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const DATA_DIR = resolve(process.env['DATA_DIR'] ?? join(import.meta.dirname!, '../data'));
const HEARTBEAT_INTERVAL_MS = 30_000;

const startTime = Date.now();
let totalDuelsServed = 0;
let dataReady = false;

// =============================================================================
// State
// =============================================================================

interface ActiveDuelSession extends DuelSession {
  worker: Worker;
  workerTerminated: boolean;
  awaitingResponse: [boolean, boolean];
  lastBoardState: ServerMessage | null;
  lastSentPrompt: [ServerMessage | null, ServerMessage | null];
  lastSentHint: [ServerMessage | null, ServerMessage | null];
  decks: [Deck, Deck];
  rematchRequested: [boolean, boolean];
  rematchTimeout: ReturnType<typeof setTimeout> | null;
  // Story 5.2 — Both-disconnect handling
  preservationTimer: ReturnType<typeof setTimeout> | null;
  bothDisconnected: boolean;
  combinedGraceTimer: ReturnType<typeof setTimeout> | null;
  storedDuelResult: ServerMessage | null;
  lastStateSyncAt: [number, number];
  // M1 consolidation — turn timer context (formerly standalone Map)
  timerContext: TimerContext | null;
  skipRps: boolean;
  skipShuffle: boolean;
  turnTimeSecs: number;
}

const activeDuels = new Map<string, ActiveDuelSession>();
const pendingTokens = new Map<string, { duelId: string; playerIndex: 0 | 1 }>();
const reconnectTokens = new Map<string, { duelId: string; playerIndex: 0 | 1 }>();
// M1: gracePeriodTimers, timerContexts, inactivityTimers, raceWindowTimers
// consolidated into ActiveDuelSession.timerContext and PlayerSession per-player timers.

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
  console.error(`[Startup] Data validation failed: ${validation.reason}`);
} else {
  console.log('[Startup] Data validation passed');
}

// =============================================================================
// HTTP Helpers
// =============================================================================

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function validateInternalAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const expected = process.env['INTERNAL_API_KEY'] || 'dev-internal-key';
  const received = req.headers['x-internal-key'];
  if (received !== expected) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > MAX_PAYLOAD_SIZE) {
      reject(new Error('PAYLOAD_TOO_LARGE'));
      return;
    }

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('Request body read timeout'));
    }, 10_000);

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAYLOAD_SIZE) {
        clearTimeout(timeout);
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString());
    });
    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// =============================================================================
// HTTP Request Handler
// =============================================================================

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method = req.method ?? 'GET';
  const pathname = url.pathname;

  // GET /health
  if (method === 'GET' && pathname === '/health') {
    if (!dataReady) {
      json(res, 503, { status: 'unavailable', reason: validation.reason });
      return;
    }
    json(res, 200, { status: 'ok' });
    return;
  }

  // GET /status
  if (method === 'GET' && pathname === '/status') {
    json(res, 200, {
      activeDuels: activeDuels.size,
      totalDuelsServed,
      uptimeMs: Date.now() - startTime,
      memoryUsageMb: process.memoryUsage().rss / 1024 / 1024,
    });
    return;
  }

  // GET /api/duels/active — List active duel IDs (internal, used by Spring Boot scheduler)
  if (method === 'GET' && pathname === '/api/duels/active') {
    json(res, 200, { duelIds: [...activeDuels.keys()] });
    return;
  }

  // PUT /api/update-data — Download latest cards.cdb + scripts from ProjectIgnis
  if (method === 'PUT' && pathname === '/api/update-data') {
    if (!validateInternalAuth(req, res)) return;

    if (activeDuels.size > 0) {
      json(res, 409, { error: 'Cannot update while duels are active', activeDuels: activeDuels.size });
      return;
    }

    try {
      const result = await updateData(DATA_DIR);
      const revalidation = validateData(dbPath, scriptsDir);
      dataReady = revalidation.ok;
      json(res, 200, { ...result, dataReady });
    } catch (err) {
      console.error('[UpdateData] Failed:', err);
      json(res, 500, { error: 'Update failed', detail: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // POST /api/validate-passcodes — Check which passcodes exist in cards.cdb
  if (method === 'POST' && pathname === '/api/validate-passcodes') {
    if (!validateInternalAuth(req, res)) return;
    if (!dataReady) {
      json(res, 503, { error: 'Server not ready — data validation failed' });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        json(res, 413, { error: 'Payload too large' });
        return;
      }
      throw err;
    }

    let parsed: { passcodes: unknown };
    try {
      parsed = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }

    if (!Array.isArray(parsed.passcodes) || !parsed.passcodes.every((c: unknown) => typeof c === 'number' && Number.isInteger(c) && c > 0)) {
      json(res, 400, { error: 'passcodes must be an array of positive integers' });
      return;
    }

    const missing = findMissingPasscodes(dbPath, parsed.passcodes as number[]);
    json(res, 200, { missing });
    return;
  }

  // POST /api/duels — Create a new duel
  // NOTE: /api/duels/:id/join removed — see Story 1.3 variance #1. Story 1.4 uses token-based WS association.
  if (method === 'POST' && pathname === '/api/duels') {
    if (!validateInternalAuth(req, res)) return;
    if (!dataReady) {
      json(res, 503, { error: 'Server not ready — data validation failed' });
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        json(res, 413, { error: 'Payload too large' });
        return;
      }
      throw err;
    }

    let parsed: { player1: { id: string; deck: Deck }; player2: { id: string; deck: Deck }; skipRps?: boolean; skipShuffle?: boolean; turnTimeSecs?: number };
    try {
      parsed = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }

    if (!parsed.player1?.id || !parsed.player2?.id || !parsed.player1?.deck || !parsed.player2?.deck) {
      json(res, 400, { error: 'Missing required fields: player1, player2 with id and deck' });
      return;
    }

    const skipRps = parsed.skipRps === true;
    const skipShuffle = parsed.skipShuffle === true;
    const rawTurnTimeSecs = typeof parsed.turnTimeSecs === 'number' ? parsed.turnTimeSecs : 300;
    const turnTimeSecs = Math.min(3600, Math.max(30, Math.round(rawTurnTimeSecs)));

    // Validate deck arrays (M2: prevent worker crash on malformed input)
    if (!Array.isArray(parsed.player1.deck?.main) || !Array.isArray(parsed.player1.deck?.extra) ||
        !Array.isArray(parsed.player2.deck?.main) || !Array.isArray(parsed.player2.deck?.extra)) {
      json(res, 400, { error: 'Deck must have main and extra arrays' });
      return;
    }

    // Deep deck validation (M3: ensure all entries are positive integers)
    for (const deck of [parsed.player1.deck, parsed.player2.deck]) {
      if (!deck.main.every((c: unknown) => typeof c === 'number' && Number.isInteger(c) && c > 0) ||
          !deck.extra.every((c: unknown) => typeof c === 'number' && Number.isInteger(c) && c > 0)) {
        json(res, 400, { error: 'Deck arrays must contain positive integers' });
        return;
      }
    }

    const duelId = randomUUID();
    const token0 = randomUUID();
    const token1 = randomUUID();

    // Create DuelSession
    const session: ActiveDuelSession = {
      duelId,
      players: [
        { playerId: parsed.player1.id, playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivityTimer: null, warningTimer: null, raceWindowTimer: null },
        { playerId: parsed.player2.id, playerIndex: 1, ws: null, connected: false, disconnectedAt: null, reconnectToken: null, gracePeriodTimer: null, inactivityTimer: null, warningTimer: null, raceWindowTimer: null },
      ],
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      worker: null!,
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
      timerContext: null,
      skipRps,
      skipShuffle,
      turnTimeSecs,
    };

    // Spawn worker
    const worker = new Worker(new URL('./duel-worker.js', import.meta.url), {
      workerData: { dataDir: DATA_DIR },
    });

    session.worker = worker;
    attachWorkerHandlers(session);

    // Store in active duels and pending tokens
    activeDuels.set(duelId, session);
    pendingTokens.set(token0, { duelId, playerIndex: 0 });
    pendingTokens.set(token1, { duelId, playerIndex: 1 });

    // Send INIT_DUEL to worker
    worker.postMessage({
      type: 'INIT_DUEL',
      duelId,
      decks: [parsed.player1.deck, parsed.player2.deck],
      skipRps,
      skipShuffle,
    });

    // H17 — Connection timeout: if no players connect within 60s, clean up
    const CONNECTION_TIMEOUT_MS = 60_000;
    setTimeout(() => {
      const s = activeDuels.get(duelId);
      if (s && s.players.every(p => !p.connected)) {
        console.log(`[${duelId}] Connection timeout — no players connected, cleaning up`);
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
      json(res, 404, { error: 'Duel not found' });
      return;
    }
    console.log(`[${deleteDuelId}] Duel terminated via API`);
    safeTerminateWorker(session);
    cleanupDuelSession(session);
    json(res, 200, { success: true });
    return;
  }

  // 404
  json(res, 404, { error: 'Not Found' });
}

// =============================================================================
// Safe Worker Termination (M4: prevent double-terminate)
// =============================================================================

function safeTerminateWorker(session: ActiveDuelSession): void {
  if (!session.workerTerminated) {
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
  session.worker.on('message', (wmsg: WorkerToMainMessage) => {
    handleWorkerMessage(session, wmsg);
  });
  session.worker.on('exit', (code) => {
    console.log(`[Duel ${session.duelId}] Worker exited (code: ${code})`);
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
  session.worker.on('error', (err: Error) => {
    console.error(`[Duel ${session.duelId}] Worker error:`, err.message);
  });
}

function handleDuelEnd(session: ActiveDuelSession): void {
  session.endedAt = Date.now();
  clearAllDuelTimers(session);
  session.rematchTimeout = setTimeout(() => rematchExpired(session), 5 * 60 * 1000);
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

  clearAllDuelTimers(session);

  attachWorkerHandlers(session);

  worker.postMessage({
    type: 'INIT_DUEL',
    duelId: session.duelId,
    decks: session.decks,
    skipRps: session.skipRps,
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
// Worker → Main Message Handler
// =============================================================================

function handleWorkerMessage(session: ActiveDuelSession, wmsg: WorkerToMainMessage): void {
  switch (wmsg.type) {
    case 'WORKER_DUEL_CREATED':
      console.log(`[Duel ${wmsg.duelId}] Duel created in worker`);
      session.startedAt = Date.now();
      // Initialize turn timer context
      session.timerContext = {
        pools: [session.turnTimeSecs * 1000, session.turnTimeSecs * 1000],
        running: false,
        activePlayer: 0,
        intervalRef: null,
        lastTickMs: 0,
        turnCount: 0,
      };
      // Send initial TIMER_STATE for both players (clients display 5:00 from start)
      // Note: no-ops if players haven't connected yet — sendTimerStateToPlayer covers on connection
      sendTimerStateToAll(session);
      break;

    case 'WORKER_MESSAGE':
      broadcastMessage(session, wmsg.message);
      break;

    case 'WORKER_RETRY': {
      // OCGCore rejected the player's response — re-send the cached prompt
      for (const p of [0, 1] as const) {
        const cached = session.lastSentPrompt[p];
        if (cached) {
          console.warn(`[Duel ${session.duelId}] RETRY: re-sending ${cached.type} to player ${p}`);
          sendToPlayer(session, p, cached);
        }
      }
      break;
    }

    case 'WORKER_ERROR': {
      console.error(`[Duel ${wmsg.duelId}] Worker error: ${wmsg.error}`);
      const errorMsg: ServerMessage = { type: 'DUEL_END', winner: null, reason: `Engine error: ${wmsg.error}` };
      sendToPlayer(session, 0, errorMsg);
      sendToPlayer(session, 1, errorMsg);
      handleDuelEnd(session);
      safeTerminateWorker(session);
      break;
    }
  }
}

function broadcastMessage(session: ActiveDuelSession, message: ServerMessage): void {
  // Detect natural DUEL_END from worker (LP=0, deck-out, etc.)
  if (message.type === 'DUEL_END') {
    handleDuelEnd(session);
  }

  // Detect natural game end via MSG_WIN — generate DUEL_END for clients
  // The worker sends MSG_WIN (not DUEL_END) for LP=0, deck-out, Exodia, etc.
  if (message.type === 'MSG_WIN') {
    const endMsg: ServerMessage = { type: 'DUEL_END', winner: message.player, reason: 'win' };
    sendToPlayer(session, 0, endMsg);
    sendToPlayer(session, 1, endMsg);
    handleDuelEnd(session);
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
    console.log(`[TIMER] SELECT ${message.type} for player=${targetPlayer}, timerRunning=${session.timerContext?.running}`);
    session.awaitingResponse[targetPlayer] = true;
    const opponentOfTarget: 0 | 1 = targetPlayer === 0 ? 1 : 0;
    sendToPlayer(session, opponentOfTarget, { type: 'WAITING_RESPONSE' });
    startTurnTimer(session);
    startInactivityTimer(session, targetPlayer);
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

// =============================================================================
// Turn Timer & Inactivity Timeout (Story 3.2)
// =============================================================================

// TIMER_STATE is sent directly via ws.send() — it does NOT go through message-filter.ts.
// This is intentional: both players see both timers, and the server is the sole source of truth.

function sendTimerStateToAll(session: ActiveDuelSession): void {
  const ctx = session.timerContext;
  if (!ctx) return;
  const timer0: ServerMessage = { type: 'TIMER_STATE', player: 0, remainingMs: Math.max(0, ctx.pools[0]) };
  const timer1: ServerMessage = { type: 'TIMER_STATE', player: 1, remainingMs: Math.max(0, ctx.pools[1]) };
  for (const client of [0, 1] as const) {
    sendToPlayer(session, client, timer0);
    sendToPlayer(session, client, timer1);
  }
}

function sendTimerStateToPlayer(session: ActiveDuelSession, targetPlayer: 0 | 1): void {
  const ctx = session.timerContext;
  if (!ctx) return;
  for (const p of [0, 1] as const) {
    sendToPlayer(session, targetPlayer, { type: 'TIMER_STATE', player: p, remainingMs: Math.max(0, ctx.pools[p]) });
  }
}

function startTurnTimer(session: ActiveDuelSession): void {
  const ctx = session.timerContext;
  if (!ctx || ctx.running) {
    console.log(`[TIMER] startTurnTimer SKIPPED — ctx=${!!ctx}, running=${ctx?.running}`);
    return;
  }

  console.log(`[TIMER] startTurnTimer START — activePlayer=${ctx.activePlayer}, pool=${ctx.pools[ctx.activePlayer]}`);
  ctx.running = true;
  ctx.lastTickMs = Date.now();

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
    sendToPlayer(session, 0, timerMsg);
    sendToPlayer(session, 1, timerMsg);

    // Pool depletion → timeout forfeit
    if (ctx.pools[ctx.activePlayer] <= 0) {
      ctx.pools[ctx.activePlayer] = 0;
      const loser = ctx.activePlayer;
      const winner: Player = loser === 0 ? 1 : 0;
      session.awaitingResponse[loser] = false;
      const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'timeout' };
      sendToPlayer(session, 0, endMsg);
      sendToPlayer(session, 1, endMsg);
      handleDuelEnd(session);
      safeTerminateWorker(session);
    }
  }, 250);
}

function pauseTurnTimer(session: ActiveDuelSession): void {
  const ctx = session.timerContext;
  if (!ctx || !ctx.running) {
    console.log(`[TIMER] pauseTurnTimer SKIPPED — ctx=${!!ctx}, running=${ctx?.running}`);
    return;
  }
  console.log(`[TIMER] pauseTurnTimer PAUSE — activePlayer=${ctx.activePlayer}, pool=${ctx.pools[ctx.activePlayer]}`);


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
  const timerMsg: ServerMessage = {
    type: 'TIMER_STATE',
    player: ctx.activePlayer,
    remainingMs: Math.max(0, ctx.pools[ctx.activePlayer]),
  };
  sendToPlayer(session, 0, timerMsg);
  sendToPlayer(session, 1, timerMsg);
}

function resumeTurnTimer(session: ActiveDuelSession): void {
  startTurnTimer(session);
}

function addTurnIncrement(session: ActiveDuelSession, player: Player, newTurnCount: number): void {
  const ctx = session.timerContext;
  if (!ctx) return;

  ctx.turnCount = newTurnCount;
  // Skip +40s on the first turn — initial 300s only
  if (ctx.turnCount > 1) {
    ctx.pools[player] += TURN_TIME_INCREMENT_MS;
  }
  ctx.activePlayer = player;
}

function handleTurnChange(session: ActiveDuelSession, newTurnPlayer: Player, newTurnCount: number): void {
  const ctx = session.timerContext;
  if (!ctx || newTurnCount <= ctx.turnCount) return;

  console.log(`[TIMER] handleTurnChange — turn ${ctx.turnCount} → ${newTurnCount}, activePlayer → ${newTurnPlayer}`);
  // New turn detected — pause current timer, add increment, switch active player
  const wasRunning = ctx.running;
  pauseTurnTimer(session);
  addTurnIncrement(session, newTurnPlayer, newTurnCount);

  // Send updated TIMER_STATE for the player who received the increment
  const timerMsg: ServerMessage = {
    type: 'TIMER_STATE',
    player: newTurnPlayer,
    remainingMs: Math.max(0, ctx.pools[newTurnPlayer]),
  };
  sendToPlayer(session, 0, timerMsg);
  sendToPlayer(session, 1, timerMsg);

  // Worker may send SELECT before BOARD_STATE — resume timer if it was running
  if (wasRunning) {
    startTurnTimer(session);
  }
}

function startInactivityTimer(session: ActiveDuelSession, player: Player): void {
  clearInactivityTimer(session, player);

  const ps = session.players[player];
  const warningDelay = INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_BEFORE_MS;

  // Stage 1: send warning N seconds before forfeit
  ps.warningTimer = setTimeout(() => {
    ps.warningTimer = null;
    if (session.endedAt) return;

    const remainingSec = Math.round(INACTIVITY_WARNING_BEFORE_MS / 1000);
    const warningMsg: ServerMessage = { type: 'INACTIVITY_WARNING', remainingSec };
    sendToPlayer(session, player, warningMsg);

    // Stage 2: forfeit after remaining time
    ps.inactivityTimer = setTimeout(() => {
      ps.inactivityTimer = null;
      if (session.endedAt) return;

      // Enter 500ms race condition window (AC4)
      ps.raceWindowTimer = setTimeout(() => {
        ps.raceWindowTimer = null;
        if (session.endedAt) return;

        // No response within grace window — forfeit for inactivity
        const winner: Player = player === 0 ? 1 : 0;
        session.awaitingResponse[player] = false;
        const endMsg: ServerMessage = { type: 'DUEL_END', winner, reason: 'inactivity' };
        sendToPlayer(session, 0, endMsg);
        sendToPlayer(session, 1, endMsg);
        handleDuelEnd(session);
        safeTerminateWorker(session);
      }, INACTIVITY_RACE_WINDOW_MS);
    }, INACTIVITY_WARNING_BEFORE_MS);
  }, warningDelay);
}

function clearInactivityTimer(session: ActiveDuelSession, player: Player): void {
  const ps = session.players[player];
  if (ps.warningTimer) {
    clearTimeout(ps.warningTimer);
    ps.warningTimer = null;
  }
  if (ps.inactivityTimer) {
    clearTimeout(ps.inactivityTimer);
    ps.inactivityTimer = null;
  }
  if (ps.raceWindowTimer) {
    clearTimeout(ps.raceWindowTimer);
    ps.raceWindowTimer = null;
  }
}

function clearAllDuelTimers(session: ActiveDuelSession): void {
  // Clear turn timer
  const ctx = session.timerContext;
  if (ctx?.intervalRef) {
    clearInterval(ctx.intervalRef);
    ctx.intervalRef = null;
    ctx.running = false;
  }
  session.timerContext = null;

  // Clear inactivity + race window timers for both players
  for (const p of [0, 1] as const) {
    clearInactivityTimer(session, p);
  }
}

// =============================================================================
// Duel Session Cleanup
// =============================================================================

function cleanupDuelSession(session: ActiveDuelSession): void {
  session.endedAt = session.endedAt ?? Date.now();
  session.lastSentPrompt = [null, null];
  session.lastSentHint = [null, null];

  // Clear rematch timeout
  if (session.rematchTimeout) {
    clearTimeout(session.rematchTimeout);
    session.rematchTimeout = null;
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
    console.error('[HTTP] Unhandled error:', err);
    if (!res.headersSent) {
      json(res, 500, { error: 'Internal Server Error' });
    }
  });
});

// =============================================================================
// WebSocket Server
// =============================================================================

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_SIZE });

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');
  const reconnect = url.searchParams.get('reconnect');

  if (!token && !reconnect) {
    ws.close(4001, 'Missing token');
    return;
  }

  let session: ActiveDuelSession | undefined;
  let playerIndex: 0 | 1;

  if (reconnect) {
    // --- Reconnection flow ---
    const reconInfo = reconnectTokens.get(reconnect);
    if (!reconInfo) {
      ws.close(4001, 'Invalid or expired reconnect token');
      return;
    }
    session = activeDuels.get(reconInfo.duelId);
    if (!session) {
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

    console.log(`[Duel ${session.duelId}] Player ${playerIndex} reconnected`);

    // Story 3.2 — Resume turn timer on reconnect if a prompt is pending
    if (session.awaitingResponse.some(a => a)) {
      resumeTurnTimer(session);
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
      ws.close(4001, 'Invalid or expired token');
      return;
    }
    session = activeDuels.get(tokenInfo.duelId);
    if (!session) {
      ws.close(4001, 'Duel not found');
      pendingTokens.delete(token!);
      return;
    }
    playerIndex = tokenInfo.playerIndex;
    pendingTokens.delete(token!);

    console.log(`[Duel ${session.duelId}] Player ${playerIndex} connected`);
  }

  // Associate WebSocket to player
  session.players[playerIndex].ws = ws;
  session.players[playerIndex].connected = true;
  session.players[playerIndex].disconnectedAt = null;

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

    // Story 3.3 — Reconnection: notify opponent + re-send pending prompt
    if (reconnect) {
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      sendToPlayer(session, opponentIndex, { type: 'OPPONENT_RECONNECTED' });

      // Re-send cached hint + prompt if player had a pending selection
      if (session.awaitingResponse[playerIndex] && session.lastSentPrompt[playerIndex]) {
        if (session.lastSentHint[playerIndex]) {
          sendToPlayer(session, playerIndex, session.lastSentHint[playerIndex]!);
        }
        sendToPlayer(session, playerIndex, session.lastSentPrompt[playerIndex]!);
      }
    }
  }

  // Check if both players are connected
  if (session.players[0].connected && session.players[1].connected) {
    console.log(`[Duel ${session.duelId}] Both players connected`);
  }

  // WebSocket message handling
  ws.on('message', (data: Buffer) => {
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      console.error(`[Duel ${session!.duelId}] Invalid JSON from player ${playerIndex}`);
      return;
    }

    handleClientMessage(session!, playerIndex, parsed);
  });

  ws.on('close', () => {
    session!.players[playerIndex].connected = false;
    session!.players[playerIndex].disconnectedAt = Date.now();
    console.log(`[Duel ${session!.duelId}] Player ${playerIndex} disconnected`);

    if (!session!.endedAt) {
      // Story 3.2 — Pause turn timer and clear inactivity on disconnect
      pauseTurnTimer(session!);
      clearInactivityTimer(session!, playerIndex as Player);

      // Story 3.3 — Notify opponent of disconnection
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      sendToPlayer(session!, opponentIndex, { type: 'OPPONENT_DISCONNECTED', gracePeriodSec: RECONNECT_GRACE_MS / 1000 });

      startGracePeriod(session!, playerIndex);
    } else {
      // Post-duel disconnect: notify opponent rematch is cancelled
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      sendToPlayer(session!, opponentIndex, { type: 'REMATCH_CANCELLED', reason: 'opponent_left' });

      // If both players disconnected after duel end, cleanup
      if (!session!.players[0].connected && !session!.players[1].connected) {
        cleanupDuelSession(session!);
      }
    }
  });
});

// Story 5.2 — DRY: reusable state snapshot for reconnection + REQUEST_STATE_SYNC
function sendStateSnapshot(session: ActiveDuelSession, playerIndex: 0 | 1): void {
  if (session.lastBoardState && session.lastBoardState.type === 'BOARD_STATE') {
    const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
    const filtered = filterMessage(stateSync, playerIndex);
    if (filtered) sendToPlayer(session, playerIndex, filtered);
  }
  sendTimerStateToPlayer(session, playerIndex);
}

function startGracePeriod(session: ActiveDuelSession, playerIndex: 0 | 1): void {
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
          session.storedDuelResult = endMsg;
          handleDuelEnd(session);
          // Don't terminate worker — preserve for 4h
          session.preservationTimer = setTimeout(() => {
            session.preservationTimer = null;
            cleanupDuelSession(session);
            safeTerminateWorker(session);
          }, BOTH_DISCONNECTED_CLEANUP_MS);
        }
      }, RECONNECT_GRACE_MS);
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
      sendToPlayer(session, 0, endMsg);
      sendToPlayer(session, 1, endMsg);
      handleDuelEnd(session);
      safeTerminateWorker(session);
    }
  }, RECONNECT_GRACE_MS);
}

// =============================================================================
// Client Message Handling
// =============================================================================

const ALLOWED_CLIENT_TYPES = new Set(['PLAYER_RESPONSE', 'SURRENDER', 'REMATCH_REQUEST', 'REQUEST_STATE_SYNC', 'ACTIVITY_PING']);

function handleClientMessage(session: ActiveDuelSession, playerIndex: 0 | 1, msg: ClientMessage): void {
  // Validate message type
  if (!ALLOWED_CLIENT_TYPES.has(msg.type)) {
    console.error(`[Duel ${session.duelId}] Invalid message type from player ${playerIndex}: ${msg.type}`);
    return;
  }

  switch (msg.type) {
    case 'PLAYER_RESPONSE': {
      console.log(`[SERVER] PLAYER_RESPONSE from player=${playerIndex} promptType=${msg.promptType} awaiting=[${session.awaitingResponse}] lastSentPrompt=${session.lastSentPrompt[playerIndex]?.type}`);
      // Check awaitingResponse flag — prevents spam/out-of-sequence responses
      if (!session.awaitingResponse[playerIndex]) {
        console.error(`[Duel ${session.duelId}] Unexpected PLAYER_RESPONSE from player ${playerIndex}`);
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

      console.log(`[TIMER] PLAYER_RESPONSE from player=${playerIndex}, promptType=${msg.promptType}`);
      session.awaitingResponse[playerIndex] = false;
      session.lastSentPrompt[playerIndex] = null;
      session.lastSentHint[playerIndex] = null;

      // Story 3.2 — Pause turn timer + clear inactivity/race timers on player response
      pauseTurnTimer(session);
      clearInactivityTimer(session, playerIndex as Player);

      // Forward to worker
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
      sendToPlayer(session, 0, endMsg);
      sendToPlayer(session, 1, endMsg);
      handleDuelEnd(session);
      safeTerminateWorker(session);
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

    case 'REQUEST_STATE_SYNC': {
      // Story 5.2 — Rate-limit: max 1 per 5s per player
      const now = Date.now();
      if (now - session.lastStateSyncAt[playerIndex] < STATE_SYNC_RATE_LIMIT_MS) break;
      session.lastStateSyncAt[playerIndex] = now;

      sendStateSnapshot(session, playerIndex);
      // Re-send pending hint + prompt if player has one
      if (session.awaitingResponse[playerIndex] && session.lastSentPrompt[playerIndex]) {
        if (session.lastSentHint[playerIndex]) {
          sendToPlayer(session, playerIndex, session.lastSentHint[playerIndex]!);
        }
        sendToPlayer(session, playerIndex, session.lastSentPrompt[playerIndex]!);
      }
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
// Graceful Shutdown
// =============================================================================

function shutdown(): void {
  console.log('Shutting down...');

  clearInterval(heartbeatTimer);

  // Terminate all active workers
  for (const session of activeDuels.values()) {
    safeTerminateWorker(session);
  }

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, 'Server shutting down');
    }
  });

  wss.close(() => {
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// =============================================================================
// Start
// =============================================================================

server.listen(PORT, () => {
  console.log(`Duel server listening on port ${PORT}`);
});
