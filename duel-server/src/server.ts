import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { resolve, join } from 'node:path';
import { MAX_PAYLOAD_SIZE, RECONNECT_GRACE_MS } from './types.js';
import type { WorkerToMainMessage, DuelSession, PlayerSession, Deck } from './types.js';
import type { ServerMessage, ClientMessage, Player, SelectPromptType } from './ws-protocol.js';
import { filterMessage } from './message-filter.js';
import { validateData } from './ocg-scripts.js';

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
  awaitingResponse: [boolean, boolean];
  lastBoardState: ServerMessage | null;
}

const activeDuels = new Map<string, ActiveDuelSession>();
const pendingTokens = new Map<string, { duelId: string; playerIndex: 0 | 1 }>();
const reconnectTokens = new Map<string, { duelId: string; playerIndex: 0 | 1 }>();
const gracePeriodTimers = new Map<string, ReturnType<typeof setTimeout>>(); // key: `${duelId}-${playerIndex}`

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > MAX_PAYLOAD_SIZE) {
      reject(new Error('PAYLOAD_TOO_LARGE'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAYLOAD_SIZE) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
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

  // POST /api/duels — Create a new duel
  // NOTE: /api/duels/:id/join removed — see Story 1.3 variance #1. Story 1.4 uses token-based WS association.
  if (method === 'POST' && pathname === '/api/duels') {
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

    let parsed: { player1: { id: string; deck: Deck }; player2: { id: string; deck: Deck } };
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

    // Validate deck arrays (M2: prevent worker crash on malformed input)
    if (!Array.isArray(parsed.player1.deck?.main) || !Array.isArray(parsed.player1.deck?.extra) ||
        !Array.isArray(parsed.player2.deck?.main) || !Array.isArray(parsed.player2.deck?.extra)) {
      json(res, 400, { error: 'Deck must have main and extra arrays' });
      return;
    }

    const duelId = randomUUID();
    const token0 = randomUUID();
    const token1 = randomUUID();

    // Create DuelSession
    const session: ActiveDuelSession = {
      duelId,
      players: [
        { playerId: parsed.player1.id, playerIndex: 0, ws: null, connected: false, disconnectedAt: null, reconnectToken: null },
        { playerId: parsed.player2.id, playerIndex: 1, ws: null, connected: false, disconnectedAt: null, reconnectToken: null },
      ],
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      worker: null!,
      awaitingResponse: [false, false],
      lastBoardState: null,
    };

    // Spawn worker
    const worker = new Worker(new URL('./duel-worker.js', import.meta.url), {
      workerData: { dataDir: DATA_DIR },
    });

    session.worker = worker;

    // Worker → Main message handler
    worker.on('message', (wmsg: WorkerToMainMessage) => {
      handleWorkerMessage(session, wmsg);
    });

    // Worker exit cleanup
    worker.on('exit', (code) => {
      console.log(`[Duel ${duelId}] Worker exited (code: ${code})`);
      cleanupDuelSession(session);
      totalDuelsServed++;
    });

    worker.on('error', (err: Error) => {
      console.error(`[Duel ${duelId}] Worker error:`, err.message);
    });

    // Store in active duels and pending tokens
    activeDuels.set(duelId, session);
    pendingTokens.set(token0, { duelId, playerIndex: 0 });
    pendingTokens.set(token1, { duelId, playerIndex: 1 });

    // Send INIT_DUEL to worker
    worker.postMessage({
      type: 'INIT_DUEL',
      duelId,
      decks: [parsed.player1.deck, parsed.player2.deck],
    });

    json(res, 201, { duelId, tokens: [token0, token1] });
    return;
  }

  // 404
  json(res, 404, { error: 'Not Found' });
}

// =============================================================================
// Worker → Main Message Handler
// =============================================================================

function handleWorkerMessage(session: ActiveDuelSession, wmsg: WorkerToMainMessage): void {
  switch (wmsg.type) {
    case 'WORKER_DUEL_CREATED':
      console.log(`[Duel ${wmsg.duelId}] Duel created in worker`);
      session.startedAt = Date.now();
      // If both players connected, initial BOARD_STATE will be sent by the worker
      break;

    case 'WORKER_MESSAGE':
      broadcastMessage(session, wmsg.message);
      break;

    case 'WORKER_ERROR':
      console.error(`[Duel ${wmsg.duelId}] Worker error: ${wmsg.error}`);
      // Declare draw and notify both players
      const errorMsg: ServerMessage = { type: 'DUEL_END', winner: null, reason: `Engine error: ${wmsg.error}` };
      sendToPlayer(session, 0, errorMsg);
      sendToPlayer(session, 1, errorMsg);
      session.worker.terminate();
      break;
  }
}

function broadcastMessage(session: ActiveDuelSession, message: ServerMessage): void {
  // Store last BOARD_STATE for late-connecting players
  if (message.type === 'BOARD_STATE') {
    session.lastBoardState = message;
  }

  // Track awaitingResponse for SELECT_* messages
  if (isSelectMessage(message)) {
    const targetPlayer = (message as { player: Player }).player;
    session.awaitingResponse[targetPlayer] = true;
  }

  // Apply message filter per player
  for (const playerIndex of [0, 1] as const) {
    const filtered = filterMessage(message, playerIndex);
    if (filtered) {
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
// Duel Session Cleanup
// =============================================================================

function cleanupDuelSession(session: ActiveDuelSession): void {
  session.endedAt = Date.now();

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
    const timerKey = `${session.duelId}-${player.playerIndex}`;
    const timer = gracePeriodTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      gracePeriodTimers.delete(timerKey);
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
    const timerKey = `${session.duelId}-${playerIndex}`;
    const timer = gracePeriodTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      gracePeriodTimers.delete(timerKey);
    }

    console.log(`[Duel ${session.duelId}] Player ${playerIndex} reconnected`);
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

  // Send last BOARD_STATE as STATE_SYNC to newly connected player
  if (session.lastBoardState && session.lastBoardState.type === 'BOARD_STATE') {
    const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
    const filtered = filterMessage(stateSync, playerIndex);
    if (filtered) sendToPlayer(session, playerIndex, filtered);
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

    // Start grace period — forfeit if player doesn't reconnect
    if (!session!.endedAt) {
      startGracePeriod(session!, playerIndex);
    }
  });
});

function startGracePeriod(session: ActiveDuelSession, playerIndex: 0 | 1): void {
  const timerKey = `${session.duelId}-${playerIndex}`;
  // Don't start a new timer if one already exists
  if (gracePeriodTimers.has(timerKey)) return;

  const timer = setTimeout(() => {
    gracePeriodTimers.delete(timerKey);
    // If still disconnected after grace period, forfeit
    if (!session.players[playerIndex].connected && !session.endedAt) {
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      const endMsg: ServerMessage = { type: 'DUEL_END', winner: opponentIndex, reason: 'disconnect' };
      sendToPlayer(session, 0, endMsg);
      sendToPlayer(session, 1, endMsg);
      session.worker.terminate();
    }
  }, RECONNECT_GRACE_MS);

  gracePeriodTimers.set(timerKey, timer);
}

// =============================================================================
// Client Message Handling
// =============================================================================

const ALLOWED_CLIENT_TYPES = new Set(['PLAYER_RESPONSE', 'SURRENDER', 'REMATCH_REQUEST']);

function handleClientMessage(session: ActiveDuelSession, playerIndex: 0 | 1, msg: ClientMessage): void {
  // Validate message type
  if (!ALLOWED_CLIENT_TYPES.has(msg.type)) {
    console.error(`[Duel ${session.duelId}] Invalid message type from player ${playerIndex}: ${msg.type}`);
    return;
  }

  switch (msg.type) {
    case 'PLAYER_RESPONSE': {
      // Check awaitingResponse flag — prevents spam/out-of-sequence responses
      if (!session.awaitingResponse[playerIndex]) {
        console.error(`[Duel ${session.duelId}] Unexpected PLAYER_RESPONSE from player ${playerIndex}`);
        return;
      }
      session.awaitingResponse[playerIndex] = false;

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
      // Main thread handles surrender (NOT worker)
      const opponentIndex: Player = playerIndex === 0 ? 1 : 0;
      const endMsg: ServerMessage = { type: 'DUEL_END', winner: opponentIndex, reason: 'surrender' };
      sendToPlayer(session, 0, endMsg);
      sendToPlayer(session, 1, endMsg);
      session.worker.terminate();
      break;
    }

    case 'REMATCH_REQUEST':
      // Deferred to later story
      break;
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
    session.worker.terminate();
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
