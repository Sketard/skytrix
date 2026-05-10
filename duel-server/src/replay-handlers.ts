import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import * as logger from './logger.js';
import { createConfigurable } from './configurable.js';
import { recordFailedWsAttempt } from './ws-rate-limit.js';
import { extractCardCodes, type WorkerReplayPayload, type ReplayMetadata } from './types.js';
import { validateWorkerMessage } from './validation/worker-message-validation.js';
import { getScriptsHash, getOcgcoreVersion } from './ocg-scripts.js';
import type { ReplayCache } from './replay-cache.js';

/**
 * Replay-mode WebSocket connection state machine + worker pool.
 *
 * Two distinct workers cycle through here:
 *  1. **Replay pre-computation worker** (createReplayWorker) — replays the
 *     stored playerResponses against ocgcore, streams BOARD_STATES to the
 *     client, then terminates. Slot is bounded by MAX_REPLAY_WORKERS.
 *  2. **Fork worker** (createForkWorker) — re-runs the replay up to
 *     `targetResponseCount`, then either signals divergence (warning) or
 *     transitions into a real solo `ActiveDuelSession` via the host-supplied
 *     `createForkSoloSession` callback.
 *
 * `createForkSoloSession` is the boundary towards the host's
 * `DuelSessionManager`. It registers the new session and wires
 * `setupForkWorkerHandlers` — replay-handlers stays unaware of
 * `ActiveDuelSession` shape and the manager's internal Maps.
 */

export type ReplayConnectionState = 'loading' | 'ready' | 'fork_pending' | 'fork_warning' | 'transitioning' | 'closed';

export interface ReplayConnection {
  ws: WebSocket;
  replayId: string;
  userId: string;
  worker: Worker | null;
  watchdogTimer: ReturnType<typeof setTimeout> | null;
  state: ReplayConnectionState;
}

interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

interface PendingForkEntry {
  worker: Worker;
  replayData: WorkerReplayPayload;
  forkDuelId: string;
}

// =============================================================================
// State (process-global, internal to this module)
// =============================================================================

const activeReplayConnections = new Map<WebSocket, ReplayConnection>();
const pendingForkWorkers = new Map<ReplayConnection, PendingForkEntry>();
let replayWorkerCount = 0;
const replayQueue: Array<() => void> = [];

// =============================================================================
// Configuration (set via configureReplayHandlers at boot)
// =============================================================================

export interface ReplayHandlersConfig {
  /** Cache of replay payloads (created via createReplayCache in replay-cache.ts). */
  replayCache: ReplayCache;
  /** Spring Boot base URL — used to fetch the authoritative replay payload. */
  springBootApiUrl: string;
  /** Internal API shared secret forwarded as `X-Internal-Key`. */
  internalApiKey: string;
  /** Worker pool concurrency cap. */
  maxReplayWorkers: number;
  /** Per-worker watchdog timeout (ms) — fires on inactivity. */
  replayWorkerWatchdogMs: number;
  /** Worker `workerData.dataDir` (passed at spawn). */
  dataDir: string;
  /**
   * Bridge to the DuelSessionManager. Called when a fork worker reports
   * `WORKER_FORK_READY` with a matching sanity check. The host owns the
   * full session lifecycle: it must
   *  1. Allocate two pending wsTokens.
   *  2. Construct an `ActiveDuelSession` (solo mode) wrapping `worker`.
   *  3. Register both in the host's `DuelSessionManager`.
   *  4. Schedule a connection timeout (cleans up if no client connects).
   *  5. Re-wire the worker's message/exit/error handlers from the
   *     replay-handlers ones to the host's `setupForkWorkerHandlers`
   *     (replay-handlers does NOT call `worker.removeAllListeners` first
   *     — the host must do it before attaching new handlers).
   *
   * Returns `{ token1, token2 }` so this module can flush
   * `REPLAY_FORK_READY { token1, token2 }` to the client and then close
   * the WebSocket. After this call, replay-handlers detaches `conn.worker`
   * and releases its worker pool slot — the worker lives on under the
   * session's ownership.
   */
  createForkSoloSession: (args: {
    forkDuelId: string;
    userId: string;
    worker: Worker;
    replayData: WorkerReplayPayload;
  }) => { token1: string; token2: string };
}

const configurable = createConfigurable<ReplayHandlersConfig>('replay-handlers');
export const configureReplayHandlers = configurable.configure;
export const isReplayHandlersConfigured = configurable.isConfigured;
const getCfg = configurable.get;

// =============================================================================
// Worker concurrency gate
// =============================================================================

function tryStartReplayWorker(startFn: () => void): void {
  if (replayWorkerCount < getCfg().maxReplayWorkers) {
    replayWorkerCount++;
    startFn();
  } else {
    replayQueue.push(startFn);
  }
}

function onReplayWorkerDone(): void {
  replayWorkerCount--;
  if (replayQueue.length > 0) {
    replayWorkerCount++;
    const next = replayQueue.shift()!;
    next();
  }
}

// =============================================================================
// Replay connection entry point
// =============================================================================

export async function handleReplayConnection(ws: WebSocket, jwt: string, replayId: string, ip: string): Promise<void> {
  const c = getCfg();
  // Decode JWT to extract userId (same pattern as duel auth — JWT payload is base64 middle segment)
  let userId: string;
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    userId = String(payload.sub ?? payload.userId ?? payload.id ?? '');
    if (!userId) throw new Error('No user ID in JWT');
  } catch (err) {
    logger.error('Replay JWT decode error', { error: err instanceof Error ? err.message : String(err) });
    recordFailedWsAttempt(ip);
    ws.close(4001, 'Invalid token');
    return;
  }

  logger.log('Replay connection', { replayId, userId });

  // Fetch replay data from Spring Boot (or hit the cache)
  let replayData!: WorkerReplayPayload;
  const cached = c.replayCache.get(replayId);
  if (cached) {
    if (cached.playerIds[0] !== userId && cached.playerIds[1] !== userId) {
      logger.error('Replay auth failed (cached)', { replayId, userId, allowed: cached.playerIds });
      recordFailedWsAttempt(ip);
      ws.close(4003, 'Not authorized');
      return;
    }
    replayData = cached.data;
    c.replayCache.touch(replayId);
    logger.debug('Replay cache hit (TTL refreshed)', { replayId });
  } else {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`${c.springBootApiUrl}/internal/replays/${replayId}`, {
          headers: { 'X-Internal-Key': c.internalApiKey },
        });
        if (response.status === 404) {
          logger.error('Replay not found', { replayId });
          recordFailedWsAttempt(ip);
          ws.close(4004, 'Replay not found');
          return;
        }
        if (!response.ok) {
          logger.error('Replay fetch failed', { replayId, status: response.status, attempt, maxRetries });
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(3, attempt - 1) * 1000));
            continue;
          }
          ws.close(4500, 'Internal error');
          return;
        }
        const body = await response.json() as { replayData: Omit<WorkerReplayPayload, 'metadata'>; metadata: ReplayMetadata; player1Id: number; player2Id: number };

        const p1 = String(body.player1Id);
        const p2 = String(body.player2Id);
        if (p1 !== userId && p2 !== userId) {
          logger.error('Replay auth failed', { replayId, userId, p1: body.player1Id, p2: body.player2Id });
          recordFailedWsAttempt(ip);
          ws.close(4003, 'Not authorized');
          return;
        }

        replayData = { ...body.replayData, metadata: body.metadata };
        c.replayCache.set(replayId, { data: replayData, playerIds: [p1, p2] });
        break;
      } catch (err) {
        logger.error('Replay fetch error', { replayId, attempt, maxRetries, error: err instanceof Error ? err.message : String(err) });
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(3, attempt - 1) * 1000));
          continue;
        }
        ws.close(4500, 'Internal error');
        return;
      }
    }
    if (!replayData) return;
  }

  if (ws.readyState !== WebSocket.OPEN) return;

  const divergenceWarning = replayData.metadata.scriptsHash !== getScriptsHash()
    || replayData.metadata.ocgcoreVersion !== getOcgcoreVersion();
  const cardCodes = extractCardCodes(replayData.decks);
  ws.send(JSON.stringify({
    type: 'REPLAY_METADATA',
    playerUsernames: replayData.metadata.playerUsernames,
    deckNames: replayData.metadata.deckNames,
    turnCount: replayData.metadata.turnCount,
    result: replayData.metadata.result,
    divergenceWarning,
    totalResponses: replayData.playerResponses.length,
    cardCodes,
  }));

  // Mark as alive for heartbeat (shared with duel connections via wss.clients)
  (ws as AliveWebSocket).isAlive = true;
  ws.on('pong', () => { (ws as AliveWebSocket).isAlive = true; });

  const conn: ReplayConnection = { ws, replayId, userId, worker: null, watchdogTimer: null, state: 'loading' };
  activeReplayConnections.set(ws, conn);

  const startFn = () => createReplayWorker(conn, replayData);
  tryStartReplayWorker(startFn);

  ws.on('message', (raw) => {
    let parsed: { type: string;[key: string]: unknown };
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (parsed.type === 'REPLAY_FORK') {
      handleReplayFork(conn, replayData, parsed as { type: 'REPLAY_FORK'; responseCount: number; expectedState: { lp: [number, number]; turnNumber: number; phase: number } });
    } else if (parsed.type === 'REPLAY_FORK_CONTINUE') {
      handleReplayForkContinue(conn);
    } else if (parsed.type === 'REPLAY_FORK_CANCEL') {
      handleReplayForkCancel(conn);
    }
  });

  ws.on('close', () => {
    logger.log('Replay client disconnected', { replayId });
    cleanupReplayConnection(conn);
  });
  ws.on('error', (err) => {
    logger.error('Replay WS error', { replayId, error: err.message });
    cleanupReplayConnection(conn);
  });
}

// =============================================================================
// Replay pre-computation worker
// =============================================================================

function createReplayWorker(conn: ReplayConnection, replayData: WorkerReplayPayload): void {
  const c = getCfg();
  const replayDuelId = `replay-${conn.replayId}-${Date.now()}`;
  const worker = new Worker(new URL('./duel-worker.js', import.meta.url), {
    workerData: { dataDir: c.dataDir },
  });
  conn.worker = worker;

  function resetWatchdog(): void {
    if (conn.watchdogTimer) clearTimeout(conn.watchdogTimer);
    conn.watchdogTimer = setTimeout(() => {
      logger.error('Replay watchdog timeout — terminating worker', { replayId: conn.replayId });
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ type: 'REPLAY_ERROR', message: 'Pre-computation timed out (30s inactivity)' }));
      }
      cleanupReplayConnection(conn);
    }, c.replayWorkerWatchdogMs);
  }
  resetWatchdog();

  worker.on('message', (raw: unknown) => {
    const wmsg = validateWorkerMessage(raw);
    if (!wmsg) {
      logger.error('Dropping malformed replay worker message', { replayId: conn.replayId, raw });
      return;
    }
    if (wmsg.type === 'WORKER_REPLAY_BOARD_STATES') {
      resetWatchdog();
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({
          type: 'REPLAY_BOARD_STATES',
          turnNumber: wmsg.turnNumber,
          states: wmsg.states,
        }));
      }
    } else if (wmsg.type === 'WORKER_REPLAY_COMPLETE') {
      logger.log('Replay pre-computation complete', { replayId: conn.replayId });
      conn.state = 'ready';
      if (conn.watchdogTimer) { clearTimeout(conn.watchdogTimer); conn.watchdogTimer = null; }
      worker.removeAllListeners();
      worker.terminate();
      conn.worker = null;
      onReplayWorkerDone();
    } else if (wmsg.type === 'WORKER_REPLAY_ERROR') {
      logger.error('Replay worker error', { replayId: conn.replayId, error: wmsg.message });
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ type: 'REPLAY_ERROR', code: wmsg.code ?? 'REPLAY_COMPUTATION_ERROR', message: wmsg.message }));
      }
      if (conn.watchdogTimer) { clearTimeout(conn.watchdogTimer); conn.watchdogTimer = null; }
      worker.removeAllListeners();
      worker.terminate();
      conn.worker = null;
      // Evict stale cache entry to prevent reuse of failed replay data
      c.replayCache.delete(conn.replayId);
      onReplayWorkerDone();
    }
  });

  worker.on('exit', (code) => {
    logger.log('Replay worker exited', { replayId: conn.replayId, exitCode: code });
    if (conn.worker === worker) {
      conn.worker = null;
      onReplayWorkerDone();
    }
  });

  worker.on('error', (err: Error) => {
    logger.error('Replay worker thread error', { replayId: conn.replayId, error: err.message });
  });

  worker.postMessage({
    type: 'INIT_REPLAY',
    duelId: replayDuelId,
    seed: replayData.seed,
    decks: replayData.decks,
    playerResponses: replayData.playerResponses,
    metadata: replayData.metadata,
  });
}

// =============================================================================
// Fork handling
// =============================================================================

function handleReplayFork(
  conn: ReplayConnection,
  replayData: WorkerReplayPayload,
  msg: { type: 'REPLAY_FORK'; responseCount: number; expectedState: { lp: [number, number]; turnNumber: number; phase: number } },
): void {
  const c = getCfg();
  if (conn.state !== 'loading' && conn.state !== 'ready') {
    logger.warn('Ignoring REPLAY_FORK in unexpected state', { replayId: conn.replayId, state: conn.state });
    return;
  }

  if (typeof msg.responseCount !== 'number' || !Number.isInteger(msg.responseCount) || msg.responseCount < 0 || msg.responseCount > replayData.playerResponses.length) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'REPLAY_ERROR', message: 'Invalid responseCount' }));
    }
    return;
  }

  const es = msg.expectedState;
  if (!es || !Array.isArray(es.lp) || es.lp.length !== 2
    || typeof es.lp[0] !== 'number' || typeof es.lp[1] !== 'number'
    || typeof es.turnNumber !== 'number' || typeof es.phase !== 'number') {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'REPLAY_ERROR', message: 'Invalid expectedState' }));
    }
    return;
  }

  // Auth re-check (defense in depth)
  const cached = c.replayCache.get(conn.replayId);
  if (cached && cached.playerIds[0] !== conn.userId && cached.playerIds[1] !== conn.userId) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'REPLAY_ERROR', message: 'Not authorized' }));
    }
    return;
  }

  // Double fork guard: terminate previous fork/pre-computation worker if still running (AC#5)
  const hadWorker = !!conn.worker;
  if (conn.worker) {
    logger.log('Terminating previous worker before starting fork', { replayId: conn.replayId });
    conn.worker.removeAllListeners();
    conn.worker.terminate();
    conn.worker = null;
    // Don't call onReplayWorkerDone() — we're reusing this slot for the fork worker
  }

  const pending = pendingForkWorkers.get(conn);
  if (pending) {
    pending.worker.removeAllListeners();
    pending.worker.terminate();
    pendingForkWorkers.delete(conn);
    onReplayWorkerDone();
  }

  conn.state = 'fork_pending';

  if (hadWorker) {
    createForkWorker(conn, replayData, msg.responseCount, msg.expectedState);
  } else {
    tryStartReplayWorker(() => createForkWorker(conn, replayData, msg.responseCount, msg.expectedState));
  }
}

function createForkWorker(
  conn: ReplayConnection,
  replayData: WorkerReplayPayload,
  targetResponseCount: number,
  expectedState: { lp: [number, number]; turnNumber: number; phase: number },
): void {
  const c = getCfg();
  const forkDuelId = `fork-${conn.replayId}-${Date.now()}`;
  const worker = new Worker(new URL('./duel-worker.js', import.meta.url), {
    workerData: { dataDir: c.dataDir },
  });
  conn.worker = worker;

  if (conn.watchdogTimer) clearTimeout(conn.watchdogTimer);
  conn.watchdogTimer = setTimeout(() => {
    logger.error('Fork watchdog timeout — terminating worker', { replayId: conn.replayId });
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'REPLAY_ERROR', message: 'Fork reconstruction timed out (30s)' }));
    }
    worker.removeAllListeners();
    worker.terminate();
    conn.worker = null;
    conn.watchdogTimer = null;
    conn.state = 'ready';
    onReplayWorkerDone();
  }, c.replayWorkerWatchdogMs);

  worker.on('message', (raw: unknown) => {
    const wmsg = validateWorkerMessage(raw);
    if (!wmsg) {
      logger.error('Dropping malformed fork worker message', { replayId: conn.replayId, raw });
      return;
    }
    if (wmsg.type === 'WORKER_FORK_READY') {
      if (conn.watchdogTimer) { clearTimeout(conn.watchdogTimer); conn.watchdogTimer = null; }

      if (!wmsg.sanityResult.match) {
        // Divergence — keep worker alive pending client decision
        conn.state = 'fork_warning';
        logger.log('Fork sanity mismatch', { replayId: conn.replayId, details: wmsg.sanityResult.details });
        pendingForkWorkers.set(conn, { worker, replayData, forkDuelId });
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(JSON.stringify({ type: 'REPLAY_ERROR', code: 'FORK_DIVERGENCE_WARNING', message: wmsg.sanityResult.details ?? '' }));
        }
      } else {
        // Sanity OK — hand off to host-supplied session manager
        conn.state = 'transitioning';
        transitionForkToSolo(conn, worker, forkDuelId, replayData);
      }
    } else if (wmsg.type === 'WORKER_FORK_ERROR') {
      logger.error('Fork worker error', { replayId: conn.replayId, error: wmsg.message });
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({ type: 'REPLAY_ERROR', code: wmsg.code ?? 'REPLAY_COMPUTATION_ERROR', message: wmsg.message }));
      }
      if (conn.watchdogTimer) { clearTimeout(conn.watchdogTimer); conn.watchdogTimer = null; }
      worker.removeAllListeners();
      worker.terminate();
      conn.worker = null;
      conn.state = 'ready';
      onReplayWorkerDone();
    }
  });

  worker.on('exit', (code) => {
    logger.log('Fork worker exited', { replayId: conn.replayId, exitCode: code });
    if (conn.worker === worker) {
      conn.worker = null;
      onReplayWorkerDone();
    }
  });

  worker.on('error', (err: Error) => {
    logger.error('Fork worker thread error', { replayId: conn.replayId, error: err.message });
  });

  worker.postMessage({
    type: 'INIT_FORK',
    duelId: forkDuelId,
    seed: replayData.seed,
    decks: replayData.decks,
    playerResponses: replayData.playerResponses,
    targetResponseCount,
    expectedState,
    scriptsHash: getScriptsHash(),
    ocgcoreVersion: getOcgcoreVersion(),
  });
}

function transitionForkToSolo(conn: ReplayConnection, worker: Worker, forkDuelId: string, replayData: WorkerReplayPayload): void {
  const c = getCfg();

  // Hand off to the host: it allocates tokens, builds the ActiveDuelSession,
  // registers it with DuelSessionManager, schedules its own connection-
  // timeout, and wires the fork worker handlers.
  const { token1, token2 } = c.createForkSoloSession({
    forkDuelId,
    userId: conn.userId,
    worker,
    replayData,
  });

  // Detach worker from replay connection (it's now owned by ActiveDuelSession)
  conn.worker = null;
  // Release the replay worker slot — the worker lives on in the solo session
  // but is no longer a replay worker. Without this, replayWorkerCount leaks +1
  // per fork, eventually blocking all future replay pre-computations.
  onReplayWorkerDone();

  // Remove WS event listeners BEFORE close to prevent double cleanup
  // (close handler would call cleanupReplayConnection without preserveCache,
  // evicting the cache).
  conn.ws.removeAllListeners('close');
  conn.ws.removeAllListeners('error');
  conn.ws.removeAllListeners('message');

  // M16 — Send REPLAY_FORK_READY with tokens, close after message is flushed (AC#3)
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify({ type: 'REPLAY_FORK_READY', token1, token2 }), () => {
      conn.ws.close();
    });
  }

  // Clean up replay connection but PRESERVE cache (needed for return/re-fork)
  cleanupReplayConnection(conn, true);

  logger.log('Fork transitioned to solo session', { replayId: conn.replayId, duelId: forkDuelId });
}

function handleReplayForkContinue(conn: ReplayConnection): void {
  if (conn.state !== 'fork_warning') {
    logger.warn('Ignoring REPLAY_FORK_CONTINUE in unexpected state', { replayId: conn.replayId, state: conn.state });
    return;
  }
  const pending = pendingForkWorkers.get(conn);
  if (!pending) return;
  pendingForkWorkers.delete(conn);
  conn.state = 'transitioning';
  transitionForkToSolo(conn, pending.worker, pending.forkDuelId, pending.replayData);
}

function handleReplayForkCancel(conn: ReplayConnection): void {
  if (conn.state !== 'fork_warning') {
    logger.warn('Ignoring REPLAY_FORK_CANCEL in unexpected state', { replayId: conn.replayId, state: conn.state });
    return;
  }
  const pending = pendingForkWorkers.get(conn);
  if (!pending) return;
  pending.worker.removeAllListeners();
  pending.worker.terminate();
  pendingForkWorkers.delete(conn);
  onReplayWorkerDone();
  conn.state = 'ready';
}

// =============================================================================
// Cleanup
// =============================================================================

export function cleanupReplayConnection(conn: ReplayConnection, preserveCache = false): void {
  const c = getCfg();
  conn.state = 'closed';

  if (conn.watchdogTimer) {
    clearTimeout(conn.watchdogTimer);
    conn.watchdogTimer = null;
  }

  if (conn.worker) {
    conn.worker.removeAllListeners();
    conn.worker.terminate();
    conn.worker = null;
    onReplayWorkerDone();
  }

  if (!preserveCache) {
    c.replayCache.delete(conn.replayId);
  }

  const pending = pendingForkWorkers.get(conn);
  if (pending) {
    pending.worker.removeAllListeners();
    pending.worker.terminate();
    pendingForkWorkers.delete(conn);
    onReplayWorkerDone();
  }

  activeReplayConnections.delete(conn.ws);
}

/**
 * Tear down all in-flight replay state at process shutdown:
 * - cleanupReplayConnection on every active connection
 * - terminate any pending fork workers
 * - clear the queued worker backlog
 *
 * Safe to call once from the SIGTERM/SIGINT handler.
 */
export function cleanupAllReplayState(): void {
  // Drain the queue FIRST so the onReplayWorkerDone() calls below can't
  // re-spawn a worker mid-shutdown.
  replayQueue.length = 0;
  for (const conn of activeReplayConnections.values()) {
    cleanupReplayConnection(conn);
  }
  for (const [conn, pending] of pendingForkWorkers) {
    pending.worker.removeAllListeners();
    pending.worker.terminate();
    pendingForkWorkers.delete(conn);
    onReplayWorkerDone();
  }
}
