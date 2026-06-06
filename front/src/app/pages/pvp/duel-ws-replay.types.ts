// =============================================================================
// ws-protocol-replay.ts — Skytrix WS protocol — replay messages
// 5 types (2 client→server load/fork, 3 server→client metadata/states/error)
// + shared sub-types (DecisionMoment, PreComputedState, ForkSanityFields).
// Sync rule: same content as duel-server/src/ws-protocol-replay.ts
// (modulo `.js` import suffix).
// =============================================================================

import type { Player, BoardStatePayload, CardInfo } from './duel-ws-shared.types';
import type { ChainingMsg } from './duel-ws-game.types';
// Cross-file import: DecisionMoment.prompt is the union of all server
// messages. Pulled lazily via the index re-export to avoid duplicating
// the union here.
import type { ServerMessage } from './duel-ws.types';

// =============================================================================
// Shared Replay Sub-Types
// =============================================================================

export interface DecisionMoment {
  prompt: ServerMessage;
  response: { data: unknown; timestamp?: string };
  player: Player;
  hint?: { hintType: number; value: number; cardName: string };
  confirmedCards?: CardInfo[];
  /** Board state snapshot taken before the player's response was fed.
   *  Matches the BOARD_STATE the live PvP client would have received. */
  boardState?: BoardStatePayload;
}

export interface PreComputedState {
  boardState: BoardStatePayload;
  events: ServerMessage[];
  label: string;
  responseCount: number;
  decisions?: DecisionMoment[];
  /** Chain link index (0-based) when this state is part of a chain resolution. */
  chainIndex?: number;
  /** Server-side chain state snapshot, embedded when this state was captured
   *  while a chain is open (`chainPhase !== 'idle'`). Mirrors the PvP
   *  `ChainStateMsg` shape so the replay viewer restores via the same
   *  `processor.restoreChainState` path as the PvP reconnect handshake.
   *  Without this, a seek that lands mid-chain leaves the overlay empty and
   *  chain badges invisible because the processor was wiped by `abort()`
   *  and no `MSG_CHAINING(1..N-1)` is re-fed.
   *
   *  F9 (cross-side `chainPhase` parity) gains a 3rd consumer with this
   *  field: `replay-precompute.ts` now also runs `applyChainTransition` to
   *  build the snapshot. See CLAUDE.md → "Cross-side `chainPhase` parity (F9)".
   *
   *  Optional: states outside chain windows + legacy replays precomputed
   *  before this field landed carry `undefined` → seek behavior degrades
   *  to today's empty-overlay. Replay precompute runs on every viewer open
   *  (`replay-handlers.ts` caches the source `WorkerReplayPayload`, not the
   *  precomputed states), so existing replays inherit the fix immediately. */
  chainSnapshot?: {
    links: ChainingMsg[];
    phase: 'building' | 'resolving';
    negatedIndices: number[];
    currentSolvingChainIndex: number | null;
  };
}

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

export interface ReplayBoardStatesMsg {
  type: 'REPLAY_BOARD_STATES';
  turnNumber: number;
  states: PreComputedState[];
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
// Anim-pipeline v4 — replay-as-PvP-readonly stream (Phase 2)
// =============================================================================
//
// New stream format that replaces `REPLAY_BOARD_STATES` step-by-step. The
// client-side `MockDuelConnection` consumes the linear `ServerMessage[]`
// exactly the way `DuelConnection` consumes a live WS feed — strict
// "Replay = PvP readonly" doctrine. See
// `_bmad-output/planning-artifacts/anim-pipeline-v4-replay-unification-2026-06-05.md`
// for the full Phase plan.
//
// Phase 2 coexistence — both formats are emitted in parallel : the legacy
// `REPLAY_BOARD_STATES` keeps powering the current `ReplayDuelAdapter`,
// the new `REPLAY_STREAM_CHUNK` + `REPLAY_STREAM_INIT` feed the
// (unbranched) mock. Phase 3 branches the mock ; Phase 5 retires
// `REPLAY_BOARD_STATES`.

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

/** A single point of interest in the navigation index — equivalent to a
 *  PreComputedState's user-facing label.
 *
 *  Phase 4 (2026-06-05) enriched the shape with `boardStateSnapshot` +
 *  `chainSnapshot` so the client's `MockDuelConnection.seekToOffset(N)`
 *  can restore the rendered state in one shot — same pattern as
 *  `ReplayDuelAdapter.jumpToState` (replay-duel-adapter.ts:373). The
 *  snapshot is captured ABSOLUTE (perspective P0, omniscient) just like
 *  every BOARD_STATE in the stream ; the mock applies `_maybeSwapBoardState`
 *  on consumption when the viewer perspective is 1. */
export interface ReplayStreamNavEntry {
  /** Cursor offset of the FIRST message that belongs to this nav entry.
   *  The scrubber seeks to this offset. */
  messageOffset: number;
  /** Human-readable label — same content as `PreComputedState.label`. */
  label: string;
  /** Turn number this entry belongs to. Matches the existing
   *  `REPLAY_BOARD_STATES.turnNumber` semantics so the UI can group
   *  entries by turn without re-deriving. */
  turnNumber: number;
  /** Chain link index when this entry is part of a multi-link chain
   *  resolution. Mirrors `PreComputedState.chainIndex`. */
  chainIndex?: number;
  /** ABSOLUTE board state at this nav point — equivalent of
   *  `PreComputedState.boardState`. Restored on `mockConn.seekToOffset`
   *  via `rbs.updateLogical + commitAll`. Required (always present),
   *  even though the legacy `boardState` field is technically derivable
   *  from a forward dispatch of `messages[0..messageOffset]` ; embedding
   *  the snapshot turns seek into an O(1) operation instead of O(N). */
  boardStateSnapshot: BoardStatePayload;
  /** Optional chain state snapshot, embedded when this nav entry was
   *  captured while a chain is open (`chainPhase !== 'idle'`). Same
   *  shape and semantics as `PreComputedState.chainSnapshot` —
   *  restored via the SHARED `chainingMsgsToLinkStates` +
   *  `processor.restoreChainState` helper (front-side). Absent for
   *  nav entries captured outside chain windows. */
  chainSnapshot?: {
    links: ChainingMsg[];
    phase: 'building' | 'resolving';
    negatedIndices: number[];
    currentSolvingChainIndex: number | null;
  };
}

/** A chunk of replay stream messages — Phase 2 emits one chunk per turn,
 *  same boundary as the legacy `REPLAY_BOARD_STATES`. Multiple chunks may
 *  share a `turnNumber` if the size threshold splits a long turn. */
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
  /** Nav entries accumulated during this chunk's range. v4 Phase 3
   *  (2026-06-05) — emitted INCREMENTALLY per chunk (in addition to
   *  the final `navIndex` in `REPLAY_STREAM_INIT`) so the client's
   *  transport scheduler can pilot `mockConn.dispatchNext` against
   *  the boardState boundaries without waiting for the precompute to
   *  finish. Each `messageOffset` is GLOBAL (already in the stream's
   *  cursor space). */
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
