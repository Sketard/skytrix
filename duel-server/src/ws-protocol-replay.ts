// =============================================================================
// ws-protocol-replay.ts — Skytrix WS protocol — replay messages
// 5 types (2 client→server load/fork, 3 server→client metadata/states/error)
// + shared sub-types (DecisionMoment, PreComputedState, ForkSanityFields).
// Sync rule: same content as front/src/app/pages/pvp/duel-ws-replay.types.ts
// (modulo `.js` import suffix).
// =============================================================================

import type { Player, BoardStatePayload, CardInfo } from './ws-protocol-shared.js';
// Cross-file import: DecisionMoment.prompt is the union of all server
// messages. Pulled lazily via the index re-export to avoid duplicating
// the union here.
import type { ServerMessage } from './ws-protocol.js';

// =============================================================================
// Shared Replay Sub-Types
// =============================================================================

export interface DecisionMoment {
  prompt: ServerMessage;
  response: { data: unknown; timestamp?: string };
  player: Player;
  hint?: { hintType: number; value: number; cardName: string; hintAction: string };
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
  token2: string;
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
}

export interface ReplayErrorMsg {
  type: 'REPLAY_ERROR';
  code: string;
  message: string;
}
