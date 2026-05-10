import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { createConfigurable } from './configurable.js';
import {
  SOLVER_INIT, SOLVER_START, SOLVER_CANCEL,
  SOLVER_HANDTRAPS, SOLVER_PROGRESS, SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR,
} from './ws-protocol.js';
import type {
  ServerMessage,
  SolverStartMessage, SolverResultMessage, SolverCancelledMessage,
  SolverProgressMessage, SolverErrorMessage, SolverHandtrapsMessage, SolverWsError,
} from './ws-protocol.js';
import type { SolverOrchestrator } from './solver/solver-orchestrator.js';
import type { HandtrapConfig, DuelConfig, SolverConfig, SolverProgress } from './solver/solver-types.js';
import { EMPTY_BREAKDOWN } from './solver/solver-types.js';

// =============================================================================
// State (private — H2 audit closure: encapsulated, never exported)
// =============================================================================
//
// All four Maps below are private to this module. server.ts drives them
// via the public attach/detach/get helpers further down. A future handler
// that touches solver state and forgets to clean up via detach can no
// longer leak silently — the Maps simply aren't reachable.

/** Live WebSocket per userId. Drives both inbound `handleSolverMessage`
 *  dispatch and outbound progress/result emission resolved at fire time so a
 *  reconnect mid-solve still receives the result. */
const solverConnections = new Map<string, WebSocket>();

/** Last solve start time per user (ms). Drives the rate-limit window. */
const solverLastStart = new Map<string, number>();

/** TTL'd cached final result per user (last solve). Replayed on reconnect. */
interface CachedResult { message: SolverResultMessage; timer: ReturnType<typeof setTimeout>; createdAt: number }
const solverResultCache = new Map<string, CachedResult>();

/** Per-user JWT captured at handshake. Forwarded to Spring Boot to fetch the
 *  authoritative deck (never trust the client deck array — C2 fix). */
const solverJwts = new Map<string, string>();

/** Short-TTL cache for deck fetches keyed by `${userId}:${deckId}` to avoid
 *  hitting Spring Boot on every verify click. Cleared per-user on WS close. */
interface DeckCacheEntry { main: number[]; extra: number[]; expiresAt: number }
const solverDeckCache = new Map<string, DeckCacheEntry>();

// =============================================================================
// Configuration (set via configureSolverHandlers at boot)
// =============================================================================

interface SolverHandlerConfig {
  /** Live orchestrator handle (re-assigned by /api/update-data). Pass a
   *  getter so the handlers always see the current instance. */
  orchestrator: () => SolverOrchestrator | null;
  handtraps: () => HandtrapConfig[];
  rateLimitIntervalMs: () => number;
  timeBudgetFastMs: () => number;
  timeBudgetOptimalMs: () => number;
  maxHandtraps: () => number;
  /** Connection-limit ceiling — getter so the runtime can re-read it
   *  after `/api/update-data` reloads solver-config.json. */
  maxSolverConnections: () => number;
  springBootApiUrl: string;
  fillerCardId: number;
  maxSolverCacheEntries: number;
  solverResultCacheTtlMs: number;
  deckFetchCacheTtlMs: number;
}

const configurable = createConfigurable<SolverHandlerConfig>('solver-handlers');
export const configureSolverHandlers = configurable.configure;
export const isSolverHandlersConfigured = configurable.isConfigured;
const getCfg = configurable.get;

// =============================================================================
// Connection lifecycle (H2 audit closure — exclusive Map writers)
// =============================================================================

/** Result of an `attachSolverConnection` attempt. The caller (server.ts)
 *  decides what to send/close on the WebSockets — this module only mutates
 *  state so close/send IO stays in the connection handler. */
export type AttachResult =
  /** Connection limit reached; server.ts must close ws with 4029. */
  | { kind: 'limit' }
  /** Attached. If `replaced` is non-null, server.ts must close it with 4001
   *  (an older WS for the same userId was kicked out). */
  | { kind: 'attached'; replaced: WebSocket | null };

/** Register a new solver WS for `userId`. Atomic: limit check + replace +
 *  set happen here so two concurrent attaches can't both pass the limit. */
export function attachSolverConnection(userId: string, ws: WebSocket, jwt: string): AttachResult {
  if (solverConnections.size >= getCfg().maxSolverConnections()) {
    return { kind: 'limit' };
  }
  const previous = solverConnections.get(userId) ?? null;
  solverConnections.set(userId, ws);
  solverJwts.set(userId, jwt);
  return { kind: 'attached', replaced: previous };
}

/** Remove `userId`'s solver state (connection, JWT, deck cache entries) iff
 *  the live WS still matches `ws`. Idempotent — safe to call from a `close`
 *  handler that races with a replace. Does NOT close `ws` (server.ts owns IO). */
export function detachSolverConnection(userId: string, ws: WebSocket): void {
  if (solverConnections.get(userId) !== ws) return;
  solverConnections.delete(userId);
  solverJwts.delete(userId);
  // Drop the user's deck cache entries (TTL would expire them anyway,
  // but this keeps the map bounded under churn).
  for (const key of solverDeckCache.keys()) {
    if (key.startsWith(`${userId}:`)) solverDeckCache.delete(key);
  }
}

/** Live WS for `userId`, or undefined if disconnected. Resolved at every send
 *  so a reconnect mid-solve still receives async progress/result. */
export function getSolverConnection(userId: string): WebSocket | undefined {
  return solverConnections.get(userId);
}

/** Captured handshake JWT for `userId`. Used by `fetchDeckCached` to
 *  authenticate Spring Boot deck fetches (C2 fix). */
export function getSolverJwt(userId: string): string | undefined {
  return solverJwts.get(userId);
}

// =============================================================================
// WebSocket emission helpers
// =============================================================================

export function sendSolverMessage(ws: WebSocket | undefined, message: ServerMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.error('[Solver] send failed', { err });
  }
}

export function sendSolverError(ws: WebSocket | undefined, error: SolverWsError, message: string): void {
  const errMsg: SolverErrorMessage = { type: SOLVER_ERROR, error, message };
  sendSolverMessage(ws, errMsg);
}

// =============================================================================
// Message dispatch
// =============================================================================

export function handleSolverMessage(userId: string, ws: WebSocket, msg: unknown): void {
  if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
    console.warn('[Solver] malformed message', { userId });
    return;
  }
  const type = (msg as { type: string }).type;
  switch (type) {
    case SOLVER_INIT:
      handleSolverInit(userId, ws);
      break;
    case SOLVER_START:
      handleSolverStart(userId, ws, msg as SolverStartMessage).catch(err => {
        console.error('[Solver] unhandled start error', { userId, err });
        sendSolverError(ws, 'INTERNAL_ERROR', 'Unexpected error');
      });
      break;
    case SOLVER_CANCEL:
      handleSolverCancel(userId);
      break;
    default:
      console.warn('[Solver] unknown message type', { userId, type });
  }
}

// --- Task 4: SOLVER_INIT handler ---

function handleSolverInit(userId: string, ws: WebSocket): void {
  const handtrapsMsg: SolverHandtrapsMessage = { type: SOLVER_HANDTRAPS, handtraps: getCfg().handtraps() };
  sendSolverMessage(ws, handtrapsMsg);

  const cached = solverResultCache.get(userId);
  if (cached) {
    sendSolverMessage(ws, cached.message);
  }

  console.log('[Solver] init', { userId, cachedResult: !!cached });
}

// --- Task 5: SOLVER_START handler ---

/**
 * Fetch a deck composition from Spring Boot using the user's JWT.
 * AC #4 of Story 1.4 — never trust the client-supplied deck array. C2 fix
 * from the Epic 1 review.
 */
async function fetchDeckCached(userId: string, deckId: string, jwt: string) {
  const c = getCfg();
  const key = `${userId}:${deckId}`;
  const cached = solverDeckCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true as const, main: [...cached.main], extra: [...cached.extra] };
  }
  const result = await fetchDeckFromBackend(deckId, jwt, c.springBootApiUrl);
  if (result.ok) {
    solverDeckCache.set(key, {
      main: result.main,
      extra: result.extra,
      expiresAt: Date.now() + c.deckFetchCacheTtlMs,
    });
  }
  return result;
}

async function fetchDeckFromBackend(deckId: string, jwt: string, apiUrl: string): Promise<
  | { ok: true; main: number[]; extra: number[] }
  | { ok: false; error: 'DECK_NOT_FOUND' | 'DECK_ACCESS_DENIED' | 'INTERNAL_ERROR'; message: string }
> {
  try {
    const response = await fetch(`${apiUrl}/decks/${deckId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (response.status === 404) return { ok: false, error: 'DECK_NOT_FOUND', message: 'Deck not found' };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'DECK_ACCESS_DENIED', message: 'Not authorized for this deck' };
    }
    if (!response.ok) {
      return { ok: false, error: 'INTERNAL_ERROR', message: `Backend returned ${response.status}` };
    }
    const body = await response.json() as {
      mainDeck?: { card?: { card?: { id?: number } } }[];
      extraDeck?: { card?: { card?: { id?: number } } }[];
    };
    const main: number[] = [];
    for (const entry of body.mainDeck ?? []) {
      const id = entry?.card?.card?.id;
      if (typeof id === 'number' && id > 0) main.push(id);
    }
    const extra: number[] = [];
    for (const entry of body.extraDeck ?? []) {
      const id = entry?.card?.card?.id;
      if (typeof id === 'number' && id > 0) extra.push(id);
    }
    if (main.length < 40 || main.length > 60) {
      return { ok: false, error: 'INTERNAL_ERROR', message: `Invalid main deck size: ${main.length}` };
    }
    if (extra.length > 15) {
      return { ok: false, error: 'INTERNAL_ERROR', message: `Invalid extra deck size: ${extra.length}` };
    }
    return { ok: true, main, extra };
  } catch (err) {
    console.error('[Solver] fetchDeckFromBackend failed', { deckId, err });
    return { ok: false, error: 'INTERNAL_ERROR', message: 'Failed to fetch deck from backend' };
  }
}

async function handleSolverStart(userId: string, ws: WebSocket, msg: SolverStartMessage): Promise<void> {
  const c = getCfg();
  const orchestrator = c.orchestrator();
  // Per-solve correlation tag for log grep across the solve lifecycle.
  const solveId = randomBytes(4).toString('hex');
  try {
    if (!orchestrator) {
      sendSolverError(ws, 'INTERNAL_ERROR', 'Solver not available');
      return;
    }

    // Verify mode detection — skip rate limit (verify costs ~62ms, not a full solve)
    const isVerifyMode = Array.isArray(msg.verifyPath) && msg.verifyPath.length > 0
      && Array.isArray(msg.verifyTimings);

    // Rate limit check (AC #6) — skip for verify mode
    if (!isVerifyMode) {
      const now = Date.now();
      const lastStart = solverLastStart.get(userId);
      if (lastStart !== undefined && now - lastStart < c.rateLimitIntervalMs()) {
        sendSolverError(ws, 'RATE_LIMITED', 'Please wait before starting another solve');
        return;
      }
      solverLastStart.set(userId, now);
    }

    // Input validation (AC #10)
    if (!Array.isArray(msg.hand) || msg.hand.length < 1 || msg.hand.length > 5 || !msg.hand.every(c => Number.isInteger(c) && c > 0)) {
      sendSolverError(ws, 'INTERNAL_ERROR', 'Hand must be 1-5 positive integers');
      return;
    }
    if (!msg.deckId || typeof msg.deckId !== 'string') {
      sendSolverError(ws, 'INTERNAL_ERROR', 'deckId is required');
      return;
    }
    if (msg.mode !== 'goldfish' && msg.mode !== 'adversarial') {
      sendSolverError(ws, 'INTERNAL_ERROR', 'Mode must be goldfish or adversarial');
      return;
    }
    if (msg.speed !== 'fast' && msg.speed !== 'optimal') {
      sendSolverError(ws, 'INTERNAL_ERROR', 'Speed must be fast or optimal');
      return;
    }
    const algorithm: 'dfs' | 'mcts' | 'auto' = msg.algorithm ?? 'auto';
    if (algorithm !== 'dfs' && algorithm !== 'mcts' && algorithm !== 'auto') {
      sendSolverError(ws, 'INTERNAL_ERROR', 'Algorithm must be dfs, mcts, or auto');
      return;
    }
    if (msg.mode === 'adversarial' && algorithm === 'dfs') {
      sendSolverError(ws, 'INTERNAL_ERROR', 'DFS does not support adversarial mode');
      return;
    }
    if (msg.mode === 'adversarial') {
      if (!Array.isArray(msg.handtraps) || msg.handtraps.length === 0) {
        sendSolverError(ws, 'INTERNAL_ERROR', 'Adversarial mode requires at least one handtrap');
        return;
      }
      if (msg.handtraps.length > c.maxHandtraps()) {
        sendSolverError(ws, 'INTERNAL_ERROR', `Too many handtraps (got ${msg.handtraps.length}, max ${c.maxHandtraps()})`);
        return;
      }
      const validIds = new Set(c.handtraps().map(h => h.cardId));
      const invalidIds = msg.handtraps.filter(h => !validIds.has(h.cardId));
      if (invalidIds.length > 0) {
        sendSolverError(ws, 'INTERNAL_ERROR', `Invalid handtrap cardIds: ${invalidIds.map(h => h.cardId).join(', ')}`);
        return;
      }
      // Dedupe by cardId (first occurrence wins) — prevents client from
      // injecting duplicated handtraps into the opponent's hand.
      const seen = new Set<number>();
      msg.handtraps = msg.handtraps.filter(h => {
        if (seen.has(h.cardId)) return false;
        seen.add(h.cardId);
        return true;
      });
    }
    // Verify-mode input validation
    if (isVerifyMode) {
      if (msg.mode !== 'adversarial') {
        sendSolverError(ws, 'INTERNAL_ERROR', 'Verify mode requires adversarial mode');
        return;
      }
      if (!msg.verifyPath!.every(a => typeof a.responseIndex === 'number' && typeof a.cardId === 'number')) {
        sendSolverError(ws, 'INTERNAL_ERROR', 'verifyPath must contain valid SolverAction entries');
        return;
      }
      if (!msg.verifyTimings!.every(t => typeof t.stepIndex === 'number' && typeof t.responseIndex === 'number' && typeof t.handtrapCardId === 'number')) {
        sendSolverError(ws, 'INTERNAL_ERROR', 'verifyTimings must contain valid AdversarialTiming entries');
        return;
      }
      if (typeof msg.verifyExpectedScore !== 'number') {
        sendSolverError(ws, 'INTERNAL_ERROR', 'verifyExpectedScore is required for verify mode');
        return;
      }
    }

    // C2 fix: fetch the deck from Spring Boot via the user's JWT.
    const jwt = solverJwts.get(userId);
    if (!jwt) {
      sendSolverError(ws, 'INTERNAL_ERROR', 'Missing JWT for solver session');
      return;
    }
    const deckResult = await fetchDeckCached(userId, msg.deckId, jwt);
    if (!deckResult.ok) {
      sendSolverError(ws, deckResult.error, deckResult.message);
      return;
    }

    // Hand removal from deck (AC #4)
    const mainDeck = [...deckResult.main];
    for (const cardId of msg.hand) {
      const idx = mainDeck.indexOf(cardId);
      if (idx === -1) {
        sendSolverError(ws, 'INTERNAL_ERROR', `Hand card ${cardId} not found in deck`);
        return;
      }
      mainDeck.splice(idx, 1);
    }

    // Seed generation
    let deckSeed: bigint[];
    if (msg.deckSeed) {
      try {
        deckSeed = msg.deckSeed.split(',').map(s => BigInt(s.trim()));
        if (deckSeed.length !== 2) throw new Error('Expected 2 seed values');
      } catch {
        sendSolverError(ws, 'INTERNAL_ERROR', 'Invalid deckSeed format');
        return;
      }
    } else {
      const buf = randomBytes(16);
      deckSeed = [buf.readBigUInt64LE(0), buf.readBigUInt64LE(8)];
    }

    // Build DuelConfig
    const duelConfig: DuelConfig = {
      mainDeck,
      extraDeck: deckResult.extra,
      hand: msg.hand,
      deckSeed,
      opponentDeck: Array(40).fill(c.fillerCardId),
      ...(msg.mode === 'adversarial' ? { handtraps: msg.handtraps } : {}),
    };

    // Build SolverConfig
    const solverCfg: SolverConfig = {
      mode: msg.mode,
      speed: msg.speed,
      timeLimitMs: msg.speed === 'fast' ? c.timeBudgetFastMs() : c.timeBudgetOptimalMs(),
      ...(msg.mode === 'adversarial' ? { handtraps: msg.handtraps } : {}),
    };

    // Verify mode: fast single-worker dispatch, no caching, no progress
    if (isVerifyMode) {
      console.log(`[Solver][${solveId}] verify-start`, { userId, deckId: msg.deckId });
      const startTime = Date.now();
      try {
        const verifyResult = await orchestrator.verify(duelConfig, msg.verifyPath!, msg.verifyTimings!, msg.verifyExpectedScore!);
        const elapsed = Date.now() - startTime;
        const deckSeedStr = deckSeed.map(String).join(',');
        const currentWs = solverConnections.get(userId);
        const resultMsg: SolverResultMessage = {
          type: SOLVER_RESULT,
          tree: { action: { responseIndex: 0, cardId: 0, cardName: '', actionDescription: '' }, annotation: '', score: 0, confidence: 0, children: [], isTerminal: true },
          mainPath: [],
          score: 0,
          scoreBreakdown: EMPTY_BREAKDOWN,
          stats: {
            nodesExplored: 0, elapsed,
            algorithm: 'minimax-mcts', algorithmUsed: 'minimax-mcts',
            maxDepthReached: 0, averageBranchingFactor: 0, maxBranchingFactor: 0,
            deckSeed: deckSeedStr,
            // Verify path replays a known line — no search budget, no truncation surface.
            budgetMs: 0,
            truncated: false,
            terminationReason: 'completed',
            depthHistogram: [],
            ...(verifyResult.reason ? { verifyDivergence: verifyResult.reason } : {}),
          },
          verified: verifyResult.verified,
          isVerifyResult: true,
        };
        sendSolverMessage(currentWs, resultMsg);
        console.log(`[Solver][${solveId}] verify-complete`, { userId, verified: verifyResult.verified, elapsed });
      } catch (err) {
        console.error(`[Solver][${solveId}] verify-error`, { userId, err });
        sendSolverError(solverConnections.get(userId), 'INTERNAL_ERROR', 'Verification failed unexpectedly');
      }
      return;
    }

    // Evict previous cache
    evictSolverResult(userId);

    console.log(`[Solver][${solveId}] solve-start`, { userId, deckId: msg.deckId, mode: msg.mode, speed: msg.speed, algorithm });

    // Progress callback — resolve CURRENT ws (not captured closure)
    const onProgress = (progress: SolverProgress) => {
      const currentWs = solverConnections.get(userId);
      if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;
      const progressMsg: SolverProgressMessage = {
        type: SOLVER_PROGRESS,
        nodesExplored: progress.nodesExplored,
        bestScore: progress.bestScore,
        elapsed: progress.elapsed,
        ...(progress.highComplexity ? { highComplexity: true } : {}),
        ...(progress.stalled ? { stalled: true } : {}),
      };
      sendSolverMessage(currentWs, progressMsg);
    };

    const onDebug = process.env['LOG_LEVEL'] === 'debug'
      ? (cat: string, data: unknown) => { console.log('[Solver:debug]', cat, data); }
      : undefined;

    // Dispatch solve
    const outcome = await orchestrator.solve(userId, duelConfig, solverCfg, algorithm, onProgress, onDebug, msg.deckId);

    // Handle SolveOutcome — resolve CURRENT ws
    const currentWs = solverConnections.get(userId);
    const deckSeedStr = deckSeed.map(String).join(',');

    if (outcome.type === 'cancelled') {
      const stats = outcome.partialResult?.stats ?? {
        nodesExplored: 0, elapsed: 0, algorithm, algorithmUsed: algorithm,
        maxDepthReached: 0, averageBranchingFactor: 0, deckSeed: deckSeedStr,
      };
      const cancelledMsg: SolverCancelledMessage = {
        type: SOLVER_CANCELLED,
        partialTree: outcome.partialResult?.tree as SolverCancelledMessage['partialTree'],
        stats: stats as SolverCancelledMessage['stats'],
      };
      sendSolverMessage(currentWs, cancelledMsg);
      // Do NOT cache partial cancelled results as SOLVER_RESULT.
    } else if (outcome.type === 'result') {
      const result = outcome.result;
      const resultMsg: SolverResultMessage = {
        type: SOLVER_RESULT,
        tree: result.tree as SolverResultMessage['tree'],
        mainPath: result.mainPath as SolverResultMessage['mainPath'],
        score: result.score,
        scoreBreakdown: result.scoreBreakdown as SolverResultMessage['scoreBreakdown'],
        endBoardCards: result.endBoardCards as SolverResultMessage['endBoardCards'],
        stats: { ...result.stats, deckSeed: deckSeedStr } as SolverResultMessage['stats'],
        verified: result.verified,
        ...(result.minimax !== undefined ? { minimax: result.minimax } : {}),
        ...(result.adversarialTimings ? { adversarialTimings: result.adversarialTimings as SolverResultMessage['adversarialTimings'] } : {}),
      };
      cacheSolverResult(userId, resultMsg);
      sendSolverMessage(currentWs, resultMsg);
      console.log(`[Solver][${solveId}] solve-complete`, { userId, score: result.score, nodes: result.stats.nodesExplored, elapsedMs: result.stats.elapsed });
    } else if (outcome.type === 'error') {
      sendSolverError(currentWs, outcome.error as SolverWsError, outcome.message);
      console.error(`[Solver][${solveId}] solve error`, { userId, error: outcome.error, message: outcome.message });
    }
  } catch (err) {
    console.error(`[Solver][${solveId}] unexpected error`, { userId, err });
    sendSolverError(solverConnections.get(userId), 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}

// --- Task 6: SOLVER_CANCEL handler ---

function handleSolverCancel(userId: string): void {
  getCfg().orchestrator()?.cancel(userId);
  solverLastStart.delete(userId);
  console.log('[Solver] cancel-requested', { userId });
}

// --- Task 7: Result caching ---

function cacheSolverResult(userId: string, resultMsg: SolverResultMessage): void {
  const c = getCfg();
  evictSolverResult(userId);

  // LRU eviction across users when the cache fills up.
  if (solverResultCache.size >= c.maxSolverCacheEntries) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of solverResultCache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) evictSolverResult(oldestKey);
  }

  const timer = setTimeout(() => { solverResultCache.delete(userId); }, c.solverResultCacheTtlMs);
  solverResultCache.set(userId, { message: resultMsg, timer, createdAt: Date.now() });
}

function evictSolverResult(userId: string): void {
  const cached = solverResultCache.get(userId);
  if (cached) {
    clearTimeout(cached.timer);
    solverResultCache.delete(userId);
  }
}
