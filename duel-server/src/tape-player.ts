/**
 * Tape player — server-side auto-responder for PvP↔Replay parity testing
 * (chantier v4 Phase 0).
 *
 * Powers the `POST /api/duels/from-replay` endpoint : a PvP NORMAL session
 * (soloMode=false) is bootstrapped with the same seed + decks as a stored
 * replay, then the tape player intercepts each SELECT_* the worker emits
 * and auto-dispatches the matching response from the replay's
 * `playerResponses[]`.
 *
 * From the client's perspective this is a regular PvP duel : the WS feed
 * is identical to a real 2-player session. The 2 sockets connect (or not
 * — neither is required for the tape player to drive), the worker runs
 * the OCGCore loop, BOARD_STATE + MSG_* messages stream as usual. The
 * only thing missing is the human input ; the tape supplies it.
 *
 * Used by the `event-stream-parity.spec.ts` e2e test to compare the
 * `AnimationOrchestratorService._eventStream` captured from this PvP run
 * against the same stream captured from a regular replay viewing — they
 * should be structurally identical (modulo timing / volatile fields, see
 * `e2e/parity/normalize-stream.ts`).
 *
 * NOT production code — only reachable via the gated `/api/duels/from-replay`
 * endpoint which is dev-only (process.env.NODE_ENV check). See
 * `pvp-replay-event-stream-parity-spec-2026-06-05.md`.
 */

import type { ActiveDuelSession, CapturedResponse } from './types.js';
import type {
  ServerMessage,
  SelectPromptType,
  PlayerResponseMsg,
} from './ws-protocol.js';

export interface TapePlayerState {
  /** Ordered list of responses captured during the original duel, in the
   *  order they were dispatched to OCGCore. Each contains opaque `data`
   *  matching the `PlayerResponseMsg.data` shape for the corresponding
   *  prompt type. */
  readonly playerResponses: readonly CapturedResponse[];
  /** Next response index to consume. Advances on every successful
   *  auto-response. */
  cursor: number;
  /** Total responses consumed (for logging). Equals `cursor` in the happy
   *  path ; diverges if any response was skipped. */
  consumed: number;
  /** Seed to inject into the worker's `INIT_DUEL`. The replay's original
   *  seed — guarantees OCGCore produces the same card pile. Forwarded
   *  by `startDuelWithOrder` when present on the session. */
  readonly seed: readonly string[];
  /** Original `firstPlayer` (0 or 1) from the replay metadata. Skips the
   *  pre-duel RPS / SELECT_FIRST_PLAYER flow by calling `startDuelWithOrder`
   *  directly. */
  readonly firstPlayer: 0 | 1;
}

/** Marker injected on the session to identify a tape-player-driven duel.
 *  Production code never sets this. The hook in `worker-message-router.ts`
 *  checks for its presence before scheduling auto-responses. */
export type SessionWithTapePlayer = ActiveDuelSession & { tapePlayer?: TapePlayerState };

/**
 * Create a fresh tape player state from a list of captured responses.
 * The cursor starts at 0 ; consumption advances it monotonically.
 */
export function createTapePlayer(
  playerResponses: readonly CapturedResponse[],
  seed: readonly string[],
  firstPlayer: 0 | 1,
): TapePlayerState {
  return {
    playerResponses,
    cursor: 0,
    consumed: 0,
    seed,
    firstPlayer,
  };
}

/**
 * Schedule the next auto-response for a SELECT_* prompt emitted by the
 * worker. Called from `worker-message-router.ts` at the SAME point where
 * `awaitingResponse[playerIndex] = true` is set.
 *
 * Uses `setImmediate` so the response is dispatched AFTER the current
 * broadcast-message processing finishes. This mirrors the timing of a
 * real human click : the prompt is fully delivered to the (would-be)
 * client before the response is generated.
 *
 * Returns `true` if a response was scheduled, `false` if the tape is
 * exhausted (in which case the duel hangs — caller should log).
 */
export interface TapePlayerLogger {
  log: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
}

export function scheduleAutoResponse(
  session: SessionWithTapePlayer,
  playerIndex: 0 | 1,
  prompt: ServerMessage,
  forwardToWorker: (msg: PlayerResponseMsg) => void,
  logger: TapePlayerLogger,
): boolean {
  const tape = session.tapePlayer;
  if (!tape) return false;

  if (tape.cursor >= tape.playerResponses.length) {
    logger.error('[tape-player] tape exhausted', {
      duelId: session.duelId,
      consumed: tape.consumed,
      cursor: tape.cursor,
      promptType: prompt.type,
    });
    return false;
  }

  const response = tape.playerResponses[tape.cursor];
  const promptType = prompt.type as SelectPromptType;

  // setImmediate so the prompt fully propagates through `broadcastMessage`
  // before we dispatch the response. Matches the natural ordering a real
  // PvP would have (prompt arrives at client → client thinks → response).
  setImmediate(() => {
    // The session might have ended during the immediate tick (e.g. DUEL_END
    // fired from another path). Guard.
    if (session.endedAt || !session.worker) {
      logger.warn('[tape-player] skip auto-response — session ended', {
        duelId: session.duelId,
        cursor: tape.cursor,
      });
      return;
    }

    // Also guard against the awaiting-response flag being already cleared
    // (e.g. another path responded — shouldn't happen for the tape path,
    // but belt-and-braces).
    if (!session.awaitingResponse[playerIndex]) {
      logger.warn('[tape-player] skip auto-response — already responded', {
        duelId: session.duelId,
        cursor: tape.cursor,
        playerIndex,
      });
      return;
    }

    logger.log('[tape-player] auto-respond', {
      duelId: session.duelId,
      playerIndex,
      promptType,
      cursor: tape.cursor,
      total: tape.playerResponses.length,
    });

    // Mirror the validated PLAYER_RESPONSE path in `client-message-router.ts`
    // but skip the protocol checks — we're synthesizing a trusted response.
    session.awaitingResponse[playerIndex] = false;
    session.lastSentHint[playerIndex] = null;
    tape.cursor++;
    tape.consumed++;

    // Mirror exactly what `client-message-router.ts` posts to the worker —
    // including the `playerIndex` field, which is REQUIRED. OCGCore needs
    // to know which player is responding.
    //
    // CRITICAL: pass `preTransformed: true` so the worker skips
    // `transformResponse`. The captured response is already in raw
    // OCGCore wire format (e.g. `{type:5, indicies:[4]}` with the OCGCore
    // typo). Running transformResponse on it would rename
    // `indices → indicies` on a payload that has neither, yielding
    // `{indicies: null}` and an immediate WORKER_RETRY. This is exactly
    // the SELECT_CARD discard failure that took down the parity test
    // at the 6th response in the original Radiant Typhoon Vision repro.
    forwardToWorker({
      type: 'PLAYER_RESPONSE',
      playerIndex,
      promptType,
      data: response.data as PlayerResponseMsg['data'],
      preTransformed: true,
    } as unknown as PlayerResponseMsg);
  });

  return true;
}

/** Type guard — narrows an `ActiveDuelSession` to one with a tape player. */
export function hasTapePlayer(
  session: ActiveDuelSession,
): session is SessionWithTapePlayer & { tapePlayer: TapePlayerState } {
  return (session as SessionWithTapePlayer).tapePlayer !== undefined;
}
