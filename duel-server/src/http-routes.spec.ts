import { describe, it, expect, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { configureHttpRoutes, handleStatus, type HttpRoutesConfig } from './http-routes.js';

/** Captures the status + parsed JSON body written via the `json` helper
 *  (res.writeHead + res.end). */
function makeRes(): ServerResponse & { _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: undefined as unknown,
    writeHead(status: number) { (this as { _status: number })._status = status; return this; },
    end(payload?: string) { (this as { _body: unknown })._body = payload ? JSON.parse(payload) : undefined; },
  };
  return res as unknown as ServerResponse & { _status: number; _body: unknown };
}

function baseConfig(overrides: Partial<HttpRoutesConfig> = {}): HttpRoutesConfig {
  return {
    isDataReady: () => true,
    setDataReady: () => {},
    getValidationReason: () => undefined,
    activeDuelsSize: () => 0,
    totalDuelsServed: () => 0,
    protocolMismatchCount: () => 0,
    sessionBreakdown: () => ({ total: 0, pvp: 0, solo: 0, fork: 0, live: 0, ended: 0 }),
    replayStats: () => ({ activeConnections: 0, pendingForkWorkers: 0 }),
    rateLimitedIps: () => 0,
    startTime: Date.now(),
    dataDir: '/data',
    dbPath: '/data/cards.cdb',
    scriptsDir: '/data/scripts',
    internalApiKey: 'k',
    getSolverOrchestrator: () => null,
    setSolverOrchestrator: () => {},
    ...overrides,
  };
}

describe('handleStatus — observability blocks', () => {
  beforeEach(() => {
    configureHttpRoutes(baseConfig({
      activeDuelsSize: () => 3,
      sessionBreakdown: () => ({ total: 3, pvp: 2, solo: 1, fork: 0, live: 2, ended: 1 }),
      replayStats: () => ({ activeConnections: 4, pendingForkWorkers: 1 }),
      rateLimitedIps: () => 7,
    }));
  });

  it('returns 200 with the enriched session/replay/rate-limit blocks', () => {
    const res = makeRes();
    handleStatus({} as IncomingMessage, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({
      activeDuels: 3,
      sessions: { total: 3, pvp: 2, solo: 1, fork: 0, live: 2, ended: 1 },
      replay: { activeConnections: 4, pendingForkWorkers: 1 },
      rateLimitedIps: 7,
    });
  });
});
