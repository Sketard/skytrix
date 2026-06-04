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
