// =============================================================================
// ws-protocol-replay.ts — Skytrix WS protocol — replay messages
// 4 types (2 client→server load/fork, 2 server→client metadata/error)
// + 2 stream messages (REPLAY_STREAM_CHUNK / REPLAY_STREAM_INIT)
// + shared sub-types (ForkSanityFields, ReplayStreamAutoResponse,
// ReplayStreamNavEntry).
// Sync rule: same content as duel-server/src/ws-protocol-replay.ts
// (modulo `.js` import suffix).
// =============================================================================

import type { BoardStatePayload } from './duel-ws-shared.types';
import type { ChainingMsg } from './duel-ws-game.types';
import type { ServerMessage } from './duel-ws.types';

// =============================================================================
// Shared Replay Sub-Types
// =============================================================================

export interface ForkSanityFields {
  lp: [number, number];
  turnNumber: number;
  phase: number;
}

// =============================================================================
// Client → Server
// =============================================================================

export interface ReplayLoadMsg {
  type: 'REPLAY_LOAD';
  replayId: string;
}

export interface ReplayForkMsg {
  type: 'REPLAY_FORK';
  responseCount: number;
  expectedState: ForkSanityFields;
}

export interface ReplayForkContinueMsg {
  type: 'REPLAY_FORK_CONTINUE';
}

export interface ReplayForkCancelMsg {
  type: 'REPLAY_FORK_CANCEL';
}

// =============================================================================
// Server → Client
// =============================================================================

export interface ReplayForkReadyMsg {
  type: 'REPLAY_FORK_READY';
  token1: string;
  // F5-bis (2026-05-31) — fork-solo is now a SOLO multiplex (1-socket)
  // session ; only `token1` is issued. Pre-F5-bis emitted a second token
  // for `players[1].ws` but the front never connected with it (the
  // orchestrator opens a single socket with token1 and multiplexes both
  // perspectives via slot routing).
}

export interface ReplayMetadataMsg {
  type: 'REPLAY_METADATA';
  playerUsernames: [string, string];
  deckNames: [string, string];
  turnCount: number;
  result: string | null;
  divergenceWarning: boolean;
  totalResponses: number;
  /** Unique card codes from both decklists — for upfront image prefetch. */
  cardCodes: number[];
  /** Duel duration in seconds — shipped by hub-rework B1 for the topbar pill.
   *  Optional: legacy replays recorded before B1 don't carry it. */
  durationSec?: number;
  /** True when both sides are the same user — a solo "quick duel". The
   *  viewer shows a "Solo" badge and the result is not a real W/L. */
  isSolo: boolean;
}

export interface ReplayErrorMsg {
  type: 'REPLAY_ERROR';
  code: string;
  message: string;
}

// =============================================================================
// Anim-pipeline v4 — replay-as-PvP-readonly stream (Phase 2-6)
// =============================================================================
//
// `MockDuelConnection` consumes the linear `ServerMessage[]` exactly the way
// `DuelConnection` consumes a live WS feed — strict "Replay = PvP readonly"
// doctrine. See CLAUDE.md → "Replay = PvP readonly via MockDuelConnection".
// Phase 6 (2026-06-06) retired the legacy `REPLAY_BOARD_STATES` + the
// `PreComputedState[]` / `DecisionMoment` types — `ReplayStreamNavEntry`
// now carries everything the client used to read from `PreComputedState`
// (events, label, boardState, chainIndex, chainSnapshot, responseCount).

/** Per-prompt auto-respond payload. Matches the `PLAYER_RESPONSE` shape
 *  the live PvP client would have sent (`sendResponse(promptType, data)`).
 *  The client-side `MockDuelConnection.simulatePlayerResponse` consumes it
 *  verbatim. */
export interface ReplayStreamAutoResponse {
  /** Cursor offset (index into `messages[]`) of the SELECT_* the response
   *  answers. The transport scheduler arms its auto-respond timer after
   *  dispatching the message at this offset. */
  offset: number;
  promptType: string;
  data: Record<string, unknown>;
}

/** A single point of interest in the navigation index. Phase 6 (2026-06-06)
 *  absorbs the residual surface of the retired `PreComputedState` :
 *  `events[]` (consumed by `DuelGameLogService.rebuildUpTo` after a seek)
 *  and `responseCount` (consumed by `ReplayForkService` for fork sanity).
 *  Each `ReplayStreamNavEntry` is now the 1:1 successor of one legacy
 *  `PreComputedState`, with no information lost. */
export interface ReplayStreamNavEntry {
  /** Cursor offset of the FIRST message that belongs to this nav entry.
   *  The scrubber seeks to this offset. */
  messageOffset: number;
  /** Human-readable label — same content as the retired `PreComputedState.label`. */
  label: string;
  /** Turn number this entry belongs to. Matches the retired
   *  `REPLAY_BOARD_STATES.turnNumber` semantics so the UI can group
   *  entries by turn without re-deriving. */
  turnNumber: number;
  /** Chain link index when this entry is part of a multi-link chain
   *  resolution. Mirrors the retired `PreComputedState.chainIndex`. */
  chainIndex?: number;
  /** Number of `playerResponses[]` consumed by the precompute when this
   *  nav entry was flushed. Mirrors the retired `PreComputedState.responseCount`.
   *  Consumed by the front-side fork service to pin the `REPLAY_FORK`
   *  payload's `responseCount` — the server-side fork worker re-runs the
   *  duel up to that response and runs the sanity check. */
  responseCount: number;
  /** ABSOLUTE board state at this nav point — equivalent of the retired
   *  `PreComputedState.boardState`. Restored on `mockConn.seekToOffset`
   *  via `rbs.updateLogical + commitAll`. */
  boardStateSnapshot: BoardStatePayload;
  /** Filtered server messages that belong to this nav entry — equivalent
   *  of the retired `PreComputedState.events`. Consumed by
   *  `DuelGameLogService.rebuildUpTo(navIndex.slice(0, idx+1))` to re-feed
   *  the `GameLogBuilder` after a seek (the live `notifyGameLog` tap only
   *  sees events dispatched after the seek). Same ABSOLUTE perspective as
   *  the rest of the stream ; the mock applies `_maybeSwapBoardState` on
   *  consumption. */
  events: ServerMessage[];
  /** Optional chain state snapshot, embedded when this nav entry was
   *  captured while a chain is open (`chainPhase !== 'idle'`). Restored
   *  via the SHARED `chainingMsgsToLinkStates` +
   *  `processor.restoreChainState` helper (front-side). Absent for nav
   *  entries captured outside chain windows. */
  chainSnapshot?: {
    links: ChainingMsg[];
    phase: 'building' | 'resolving';
    negatedIndices: number[];
    currentSolvingChainIndex: number | null;
  };
  /** F7 (2026-06-06) — last MSG_HINT seen since the previous SELECT_*
   *  consumption, captured at flush time. Restored by the mock at
   *  `seekToOffset` so a seek that lands on a SELECT_* nav entry sees
   *  the same `activeHint` it would see during sequential playback.
   *  Struct mirrors the front `HintContext` interface ; null/absent when
   *  no hint is currently armed. */
  hint?: {
    hintType: number;
    player: number;
    value: number;
    cardName: string;
  };
}

/** A chunk of replay stream messages — one chunk per turn, same boundary
 *  the legacy `REPLAY_BOARD_STATES` had. Multiple chunks may share a
 *  `turnNumber` if the size threshold splits a long turn. */
export interface ReplayStreamChunkMsg {
  type: 'REPLAY_STREAM_CHUNK';
  turnNumber: number;
  /** Cursor offset of `messages[0]` in the full stream. Cumulative across
   *  chunks. The client appends every chunk into a growing buffer indexed
   *  by global offset. */
  baseOffset: number;
  messages: ServerMessage[];
  /** Auto-respond payloads for any SELECT_* in this chunk. The `offset`
   *  field on each entry is a GLOBAL offset (already adjusted for
   *  `baseOffset`) so the client doesn't have to re-add. */
  autoResponses: ReplayStreamAutoResponse[];
  /** Nav entries accumulated during this chunk's range. Emitted INCREMENTALLY
   *  per chunk (in addition to the final `navIndex` in `REPLAY_STREAM_INIT`)
   *  so the client's transport scheduler can pilot `mockConn.dispatchNext`
   *  against the boardState boundaries without waiting for the precompute to
   *  finish. Each `messageOffset` is GLOBAL (already in the stream's cursor
   *  space). */
  navEntries: ReplayStreamNavEntry[];
}

/** Finalises the stream — emitted ONCE, AFTER the last `REPLAY_STREAM_CHUNK`.
 *  Carries the final `navIndex` (built incrementally during precompute and
 *  shipped in one shot at the end so the scrubber UI initialises atomically).
 *  `totalMessages` lets the client `assert(cursor === totalMessages)` to
 *  detect a missing chunk. */
export interface ReplayStreamInitMsg {
  type: 'REPLAY_STREAM_INIT';
  totalMessages: number;
  navIndex: ReplayStreamNavEntry[];
}
