// =============================================================================
// ws-protocol-system.ts — Skytrix WS protocol — system + reconnect + client→server
// Lifecycle messages (DUEL_END, RPS, TP, REMATCH, TIMER), reconnect snapshots
// (STATE_SYNC, CHAIN_STATE, SESSION_TOKEN), client→server commands (SURRENDER,
// REMATCH_REQUEST, REQUEST_STATE_SYNC, ACTIVITY_PING, ANIMATIONS_DONE,
// CANCEL_PROMPT_SEQUENCE, INACTIVITY_WARNING, WAITING_RESPONSE).
// Sync rule: same content as duel-server/src/ws-protocol-system.ts
// (modulo `.js` import suffix).
// =============================================================================

import type { Player, BoardStatePayload } from './duel-ws-shared.types';
import type { ChainingMsg } from './duel-ws-game.types';

// =============================================================================
// Server → Client: System Messages
// =============================================================================

export type DuelEndReason =
  | 'win'
  | 'surrender'
  | 'disconnect'
  | 'timeout'
  | 'inactivity'
  | 'draw_both_disconnect'
  | 'too_many_invalid_responses'
  | 'worker_error';

export interface DuelEndMsg {
  type: 'DUEL_END';
  winner: Player | null;
  reason: DuelEndReason;
}

export interface TimerStateMsg {
  type: 'TIMER_STATE';
  player: Player;
  remainingMs: number;
}

export interface RpsChoiceMsg {
  type: 'RPS_CHOICE';
  player: Player;
}

export interface RpsResultMsg {
  type: 'RPS_RESULT';
  player1Choice: number;
  player2Choice: number;
  winner: Player | null;
}

export interface SelectTpMsg {
  type: 'SELECT_TP';
  player: Player;
}

export interface TpResultMsg {
  type: 'TP_RESULT';
  goFirst: boolean;
}

export interface DuelStartingMsg {
  type: 'DUEL_STARTING';
  playerIndex: Player;
  traceId: string;
  /** Unique card codes from both decklists — for upfront image prefetch. */
  cardCodes: number[];
}

export interface RematchInvitationMsg {
  type: 'REMATCH_INVITATION';
}

export interface RematchStartingMsg {
  type: 'REMATCH_STARTING';
}

export interface RematchCancelledMsg {
  type: 'REMATCH_CANCELLED';
  reason: 'opponent_left' | 'timeout';
}

export interface WorkerErrorMsg {
  type: 'WORKER_ERROR';
  message: string;
}

export interface StateSyncMsg {
  type: 'STATE_SYNC';
  data: BoardStatePayload;
}

export interface ChainStateMsg {
  type: 'CHAIN_STATE';
  links: ChainingMsg[];
  phase: 'idle' | 'building' | 'resolving';
  negatedIndices: number[];
}

export interface SessionTokenMsg {
  type: 'SESSION_TOKEN';
  token: string;
}

export interface OpponentDisconnectedMsg {
  type: 'OPPONENT_DISCONNECTED';
  gracePeriodSec: number;
}

export interface OpponentReconnectedMsg {
  type: 'OPPONENT_RECONNECTED';
}

export interface InactivityWarningMsg {
  type: 'INACTIVITY_WARNING';
  remainingSec: number;
}

export interface WaitingResponseMsg {
  type: 'WAITING_RESPONSE';
}

// =============================================================================
// Client → Server Messages (non-prompt-response)
// =============================================================================

export interface SurrenderMsg {
  type: 'SURRENDER';
}

export interface RematchRequestMsg {
  type: 'REMATCH_REQUEST';
}

export interface RequestStateSyncMsg {
  type: 'REQUEST_STATE_SYNC';
}

export interface ActivityPingMsg {
  type: 'ACTIVITY_PING';
}

export interface AnimationsDoneMsg {
  type: 'ANIMATIONS_DONE';
}

/**
 * P0-3bis.3 — Cancel the in-flight multi-step prompt sequence and roll
 * back to the most recent SELECT_IDLECMD/SELECT_BATTLECMD state.
 *
 * Sent by the client when the player right-clicks on a continuation
 * prompt (SELECT_PLACE / SELECT_DISFIELD / SELECT_POSITION) that
 * followed an IDLECMD/BATTLECMD response. The server forwards to the
 * worker; the worker restores its WASM snapshot + non-WASM state slots
 * and re-emits the original IDLECMD/BATTLECMD prompt.
 *
 * No-op if no rollback target is held (defensive — the client should
 * not have sent it).
 *
 * The player is implicit (the connection's authenticated playerIndex);
 * no payload field is needed.
 */
export interface CancelPromptSequenceMsg {
  type: 'CANCEL_PROMPT_SEQUENCE';
}
