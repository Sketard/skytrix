import type { WorkerToMainMessage } from '../types.js';

/**
 * Runtime validation for messages crossing the piscina worker → main thread
 * boundary. The worker is in-process and bundled together with the main
 * thread, so the threat model isn't "untrusted producer" — it's
 * "internal bug yields a malformed message that the main thread then
 * dispatches into a hot path".
 *
 * Three current consumers:
 *   - `server.ts:setupForkWorkerHandlers` (fork-solo session worker)
 *   - `replay-handlers.ts::createReplayWorker` (replay precompute)
 *   - `replay-handlers.ts::createForkWorker` (fork sanity check)
 *
 * Symmetric to the client-side `validateResponseData` and the WS-onmessage
 * `isServerMessage` guard. Last frontier without a runtime check before
 * this audit (R6/A5 closure).
 *
 * Returns the narrowed message on success, or null on failure. Callers
 * MUST drop + log the offending payload — never trust the cast.
 */
export function validateWorkerMessage(raw: unknown): WorkerToMainMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['type'] !== 'string') return null;

  switch (m['type']) {
    case 'WORKER_DUEL_CREATED':
      return isStr(m['duelId']) ? (raw as WorkerToMainMessage) : null;

    case 'WORKER_MESSAGE':
      // `message` must at minimum be an object with a `type` string.
      // Deeper shape is the responsibility of consumers (filterMessage,
      // chain-state-tracker, etc.) which already pattern-match on `.type`.
      if (!isStr(m['duelId'])) return null;
      if (typeof m['message'] !== 'object' || m['message'] === null) return null;
      if (typeof (m['message'] as Record<string, unknown>)['type'] !== 'string') return null;
      return raw as WorkerToMainMessage;

    case 'WORKER_ERROR':
      return isStr(m['duelId']) && isStr(m['error']) ? (raw as WorkerToMainMessage) : null;

    case 'WORKER_RETRY':
      return isStr(m['duelId']) && isPlayerIndex(m['playerIndex']) ? (raw as WorkerToMainMessage) : null;

    case 'WORKER_CANCEL_DONE':
      return isStr(m['duelId']) && isPlayerIndex(m['playerIndex']) ? (raw as WorkerToMainMessage) : null;

    case 'WORKER_REPLAY_DATA':
      // `payload` shape is heavy (seed/decks/responses/metadata). Trust
      // the type once we know it's an object — consumers serialize it
      // back to clients via JSON.stringify which would fail loudly on
      // anything truly broken.
      if (!isStr(m['duelId'])) return null;
      if (typeof m['payload'] !== 'object' || m['payload'] === null) return null;
      return raw as WorkerToMainMessage;

    case 'WORKER_REPLAY_BOARD_STATES':
      if (!isStr(m['duelId'])) return null;
      if (typeof m['turnNumber'] !== 'number') return null;
      if (!Array.isArray(m['states'])) return null;
      return raw as WorkerToMainMessage;

    case 'WORKER_REPLAY_COMPLETE':
      return isStr(m['duelId']) ? (raw as WorkerToMainMessage) : null;

    case 'WORKER_REPLAY_ERROR':
      return isStr(m['duelId']) && isStr(m['code']) && isStr(m['message'])
        ? (raw as WorkerToMainMessage) : null;

    case 'WORKER_FORK_READY':
      if (!isStr(m['duelId'])) return null;
      if (typeof m['sanityResult'] !== 'object' || m['sanityResult'] === null) return null;
      if (typeof (m['sanityResult'] as Record<string, unknown>)['match'] !== 'boolean') return null;
      return raw as WorkerToMainMessage;

    case 'WORKER_FORK_ERROR':
      return isStr(m['duelId']) && isStr(m['code']) && isStr(m['message'])
        ? (raw as WorkerToMainMessage) : null;

    default:
      return null;
  }
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isPlayerIndex(v: unknown): v is 0 | 1 {
  return v === 0 || v === 1;
}
