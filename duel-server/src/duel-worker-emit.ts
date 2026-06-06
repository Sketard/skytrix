import type { MessagePort } from 'node:worker_threads';
import type { ServerMessage } from './ws-protocol.js';
import type {
  WorkerReplayPayload,
  WorkerToMainMessage,
} from './types.js';

/**
 * Typed worker emitter — one method per `WorkerToMainMessage` variant
 * (U33, 2026-06-01).
 *
 * Pre-U33, `duel-worker.ts` had 25 raw `port.postMessage({ type: 'WORKER_*',
 * duelId, ... })` calls. `port.postMessage` is typed `(value: any) => void`
 * on the Node `worker_threads` API, so a typo in the literal type string
 * (`'WORKER_MESSGE'`) would compile cleanly and the main thread's
 * `validateWorkerMessage` would drop the frame silently
 * (worker-message-validation.ts default branch).
 *
 * `createWorkerEmitter(port, duelId)` returns an object whose methods are
 * typed against the individual interfaces of the `WorkerToMainMessage`
 * union. A typo in the method name fails at compile time ; adding a new
 * variant to the union surfaces as a TS error in the consumer until the
 * matching emitter method is added here.
 *
 * `duelId` is captured once at construction time, removing the DRY
 * violation of repeating it 25× in the worker.
 *
 * `replay-precompute.ts` also emits `WORKER_REPLAY_COMPLETE` and the
 * v4 stream messages (`WORKER_REPLAY_STREAM_CHUNK` /
 * `WORKER_REPLAY_STREAM_INIT`) — included via direct `port.postMessage`
 * in that module, since it holds its own `replayDuelId` variable
 * different from the worker's main `duelId`.
 */

export interface WorkerEmitter {
  /** WORKER_DUEL_CREATED — duel instance built, main thread can start its timers. */
  duelCreated(): void;
  /** WORKER_MESSAGE — wrap a ServerMessage for downstream broadcast. */
  message(message: ServerMessage): void;
  /** WORKER_ERROR — terminal worker error (engine crash, watchdog, init fail). */
  error(error: string): void;
  /** WORKER_RETRY — OCGCore rejected the player's response ; re-send cached prompt. */
  retry(playerIndex: 0 | 1): void;
  /** WORKER_CANCEL_DONE — rollback applied ; main thread re-broadcasts cached IDLECMD/BATTLECMD. */
  cancelDone(playerIndex: 0 | 1): void;
  /** WORKER_REPLAY_DATA — capture payload for persisting to Spring Boot. */
  replayData(payload: WorkerReplayPayload): void;
  /** WORKER_REPLAY_COMPLETE — precomputation finished. */
  replayComplete(): void;
  /** WORKER_REPLAY_ERROR — replay precompute failed mid-stream. */
  replayError(code: string, message: string): void;
  /** WORKER_FORK_READY — fork worker ready ; sanityResult tells main whether to gate the user. */
  forkReady(sanityResult: { match: boolean; details?: string }): void;
  /** WORKER_FORK_ERROR — fork worker init or reconstruction error. */
  forkError(code: string, message: string): void;
}

/**
 * Minimal port surface — we only call `postMessage`. Typing it against
 * `WorkerToMainMessage` (not `any`) means a future change to the union
 * surface (renaming a variant, dropping a field) fails to compile at
 * every emitter method that built the now-invalid shape.
 */
type TypedPort = Pick<MessagePort, 'postMessage'> & {
  postMessage(value: WorkerToMainMessage): void;
};

export function createWorkerEmitter(port: TypedPort, duelId: string): WorkerEmitter {
  return {
    duelCreated:        () => port.postMessage({ type: 'WORKER_DUEL_CREATED', duelId }),
    message:            (message) => port.postMessage({ type: 'WORKER_MESSAGE', duelId, message }),
    error:              (error) => port.postMessage({ type: 'WORKER_ERROR', duelId, error }),
    retry:              (playerIndex) => port.postMessage({ type: 'WORKER_RETRY', duelId, playerIndex }),
    cancelDone:         (playerIndex) => port.postMessage({ type: 'WORKER_CANCEL_DONE', duelId, playerIndex }),
    replayData:         (payload) => port.postMessage({ type: 'WORKER_REPLAY_DATA', duelId, payload }),
    replayComplete:     () => port.postMessage({ type: 'WORKER_REPLAY_COMPLETE', duelId }),
    replayError:        (code, message) => port.postMessage({ type: 'WORKER_REPLAY_ERROR', duelId, code, message }),
    forkReady:          (sanityResult) => port.postMessage({ type: 'WORKER_FORK_READY', duelId, sanityResult }),
    forkError:          (code, message) => port.postMessage({ type: 'WORKER_FORK_ERROR', duelId, code, message }),
  };
}
