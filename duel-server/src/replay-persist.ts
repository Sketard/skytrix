import type { ActiveDuelSession, WorkerReplayPayload } from './types.js';
import { createConfigurable } from './configurable.js';
import * as logger from './logger.js';

/**
 * POST a completed duel's replay payload to the Spring Boot persistence
 * service. Retries up to `maxRetries` times with exponential back-off
 * (3^(attempt-1) seconds: 1s → 3s → 9s). On final failure, logs an
 * unfilterable error — replay data is lost but the duel itself is not
 * affected.
 *
 * Owns the `pendingReplayResult` consumption (a per-session string set
 * by `requestReplayFromWorker` for TIMEOUT / SURRENDER / RESIGN cases).
 * The override patches the natural OCGCore result before persisting.
 *
 * The HTTP call uses the **injected** SPRING_BOOT_API_URL and
 * INTERNAL_API_KEY so the module is unit-testable with a fetch stub,
 * and so a test can run with shorter back-offs.
 */

export interface ReplayPersistConfig {
  springBootApiUrl: string;
  internalApiKey: string;
  /** Override the global `fetch` so a test can stub it without spying on globalThis. */
  fetch?: typeof fetch;
  /** Total number of attempts (initial + retries). Default 3. */
  maxRetries?: number;
  /**
   * Compute the delay before retry `attempt` (1-indexed, called only for
   * attempts that aren't the last). Default: `Math.pow(3, attempt - 1) * 1000`.
   * Tests override this to bypass real time.
   */
  retryDelayMs?: (attempt: number) => number;
}

const configurable = createConfigurable<ReplayPersistConfig>('replay-persist');
export const configureReplayPersist = configurable.configure;
export const isReplayPersistConfigured = configurable.isConfigured;
const getCfg = configurable.get;

const DEFAULT_MAX_RETRIES = 3;
const defaultRetryDelay = (attempt: number): number => Math.pow(3, attempt - 1) * 1000;

export async function persistReplay(session: ActiveDuelSession, payload: WorkerReplayPayload): Promise<void> {
  const cfg = getCfg();
  const doFetch = cfg.fetch ?? fetch;
  const maxRetries = cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelay = cfg.retryDelayMs ?? defaultRetryDelay;

  const metadata = session.pendingReplayResult
    ? { ...payload.metadata, result: session.pendingReplayResult }
    : payload.metadata;
  session.pendingReplayResult = null;

  const player1Id = Number(session.players[0].playerId);
  const player2Id = Number(session.players[1].playerId);
  if (!Number.isFinite(player1Id) || !Number.isFinite(player2Id)) {
    logger.error('Replay persist aborted: invalid player IDs', {
      duelId: session.duelId, p1: session.players[0].playerId, p2: session.players[1].playerId,
    });
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
  const jsonBody = JSON.stringify(body);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await doFetch(`${cfg.springBootApiUrl}/replays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': cfg.internalApiKey },
        body: jsonBody,
      });
      if (response.ok) {
        const data = await response.json() as { id: string };
        logger.log('Replay persisted', { duelId: session.duelId, replayId: data.id });
        return;
      }
      const errBody = await response.text().catch(() => '');
      logger.error('Replay persist failed', {
        duelId: session.duelId, attempt, maxRetries, status: response.status, body: errBody,
      });
    } catch (err) {
      logger.error('Replay persist error', {
        duelId: session.duelId, attempt, maxRetries, error: err instanceof Error ? err.message : String(err),
      });
    }

    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay(attempt)));
    }
  }
  logger.error('All persist attempts failed — replay data lost', { duelId: session.duelId, maxRetries });
}
