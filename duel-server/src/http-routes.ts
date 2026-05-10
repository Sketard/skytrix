import type { IncomingMessage, ServerResponse } from 'node:http';
import { createConfigurable } from './configurable.js';
import { json, readBody, validateInternalAuth as validateInternalAuthBase } from './http-helpers.js';
import { validateData, findMissingPasscodes } from './ocg-scripts.js';
import { updateData } from './data-updater.js';
import { loadSolverConfig } from './solver/solver-config-loader.js';
import { SolverOrchestrator } from './solver/solver-orchestrator.js';
import * as logger from './logger.js';

/**
 * HTTP route handlers extracted from server.ts (H1-suite phase 1). Each
 * handler is a pure function `(req, res) => Promise<void> | void` — no module
 * state. Mutable bindings (dataReady, solverOrchestrator) are read/written via
 * getter/setter closures supplied at boot through `configureHttpRoutes`.
 *
 * Routes that touch `activeDuels` (POST /api/duels, DELETE /api/duels/:id,
 * GET /api/duels/active) stay in server.ts — they need direct access to the
 * session map, which is the H1-suite "DuelSessionManager" boundary.
 */
export interface HttpRoutesConfig {
  /** Live data-validation gate (re-checked after /api/update-data). */
  isDataReady: () => boolean;
  setDataReady: (ready: boolean) => void;
  /** Reason captured at boot when initial validateData failed; surfaced in /health. */
  getValidationReason: () => string | undefined;
  /** Number of in-flight duels — gates /api/update-data + reported by /status. */
  activeDuelsSize: () => number;
  /** Total duels played since process start. */
  totalDuelsServed: () => number;
  /** Total WS handshakes rejected with close-code 4426 (protocol mismatch). */
  protocolMismatchCount: () => number;
  /** Process boot timestamp (ms). */
  startTime: number;
  /** Absolute path to the data dir (cards.cdb + scripts_full). */
  dataDir: string;
  /** Absolute path to cards.cdb. */
  dbPath: string;
  /** Absolute path to the scripts dir. */
  scriptsDir: string;
  /** Shared secret for internal API endpoints. */
  internalApiKey: string;
  /** Live solver pool handle — destroyed + recreated by /api/update-data. */
  getSolverOrchestrator: () => SolverOrchestrator | null;
  setSolverOrchestrator: (orch: SolverOrchestrator | null) => void;
}

const configurable = createConfigurable<HttpRoutesConfig>('http-routes');
export const configureHttpRoutes = configurable.configure;
export const isHttpRoutesConfigured = configurable.isConfigured;
const getCfg = configurable.get;

function validateInternalAuth(req: IncomingMessage, res: ServerResponse): boolean {
  return validateInternalAuthBase(req, res, getCfg().internalApiKey);
}

/** GET /health — Liveness + data-validation gate. */
export function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  const c = getCfg();
  if (!c.isDataReady()) {
    json(res, 503, { status: 'unavailable', reason: c.getValidationReason() });
    return;
  }
  json(res, 200, { status: 'ok' });
}

/** GET /status — Server stats (active duels, uptime, RSS memory). */
export function handleStatus(_req: IncomingMessage, res: ServerResponse): void {
  const c = getCfg();
  json(res, 200, {
    activeDuels: c.activeDuelsSize(),
    totalDuelsServed: c.totalDuelsServed(),
    protocolMismatchCount: c.protocolMismatchCount(),
    uptimeMs: Date.now() - c.startTime,
    memoryUsageMb: process.memoryUsage().rss / 1024 / 1024,
  });
}

/**
 * PUT /api/update-data — Download latest cards.cdb + scripts from ProjectIgnis.
 * Refused while any duel is active. Solver pool is destroyed before the rename
 * (Windows file-handle issue) and re-initialized afterwards.
 */
export async function handleUpdateData(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const c = getCfg();
  if (!validateInternalAuth(req, res)) return;

  if (c.activeDuelsSize() > 0) {
    json(res, 409, { code: 'UPDATE_BLOCKED_ACTIVE_DUELS', error: 'Cannot update while duels are active', activeDuels: c.activeDuelsSize() });
    return;
  }

  // Solver pool keeps a file handle on cards.cdb open for the lifetime of
  // each worker — on Windows that blocks the rename in updateData. Destroy
  // the pool, run the update, then re-init with the fresh data.
  const previousOrchestrator = c.getSolverOrchestrator();
  c.setSolverOrchestrator(null);
  if (previousOrchestrator) {
    try {
      await previousOrchestrator.destroy();
    } catch (err) {
      logger.warn('Solver pool destroy failed before update-data', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  try {
    const result = await updateData(c.dataDir);
    const revalidation = validateData(c.dbPath, c.scriptsDir);
    c.setDataReady(revalidation.ok);
    json(res, 200, { ...result, dataReady: c.isDataReady() });
  } catch (err) {
    logger.error('UpdateData failed', { error: err instanceof Error ? err.message : String(err) });
    json(res, 500, { error: 'Update failed', detail: err instanceof Error ? err.message : String(err) });
  } finally {
    if (c.isDataReady()) {
      try {
        const solverConfig = loadSolverConfig(c.dataDir);
        const orchestrator = new SolverOrchestrator();
        await orchestrator.init(solverConfig, c.dataDir);
        c.setSolverOrchestrator(orchestrator);
      } catch (err) {
        logger.error('Solver pool re-init failed after update-data — solver disabled until restart', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

/** POST /api/validate-passcodes — Check which passcodes exist in cards.cdb. */
export async function handleValidatePasscodes(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const c = getCfg();
  if (!validateInternalAuth(req, res)) return;
  if (!c.isDataReady()) {
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

  let parsed: { passcodes: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    json(res, 400, { code: 'INVALID_JSON', error: 'Invalid JSON' });
    return;
  }

  if (!Array.isArray(parsed.passcodes) || !parsed.passcodes.every((p: unknown) => typeof p === 'number' && Number.isInteger(p) && p > 0)) {
    json(res, 400, { code: 'INVALID_PASSCODES', error: 'passcodes must be an array of positive integers' });
    return;
  }

  const missing = findMissingPasscodes(c.dbPath, parsed.passcodes as number[]);
  json(res, 200, { missing });
}
