// =============================================================================
// ws-protocol-system.ts — Skytrix WS protocol — system + reconnect + client→server
// Lifecycle messages (DUEL_END, DICE, FIRST_PLAYER, REMATCH, TIMER), reconnect
// snapshots (STATE_SYNC, CHAIN_STATE, SESSION_TOKEN), client→server commands
// (SURRENDER, REMATCH_REQUEST, REQUEST_STATE_SYNC, ACTIVITY_PING,
// ANIMATIONS_DONE, CANCEL_PROMPT_SEQUENCE, INACTIVITY_WARNING, WAITING_RESPONSE).
// Sync rule: same content as duel-server/src/ws-protocol-system.ts
// (modulo `.js` import suffix).
// =============================================================================

import type { Player, BoardStatePayload } from './duel-ws-shared.types';
import type { ChainingMsg } from './duel-ws-game.types';
import type { GameLogEntry } from './game-log/game-log-types';

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
  /** Raw OCGCore `!victory` reason code from MSG_WIN, when the duel ended
   *  naturally in the engine (LP=0, deck-out, Exodia). Resolved to a
   *  localized label client-side; absent for non-engine ends (surrender,
   *  timeout, disconnect) where `reason` drives the `duel.reason.*` path. */
  winReasonCode?: number;
}

export interface TimerStateMsg {
  type: 'TIMER_STATE';
  player: Player;
  remainingMs: number;
  /** The full turn-time pool in ms (turnTimeSecs × 1000). Lets the client
   *  render the progress bar against the real configured pool instead of a
   *  hard-coded fallback that miscalibrates short timers. */
  totalMs: number;
  /** γ Option C A37 — populated server-side from
   *  `session.timerContext.pendingPlayer` when a parked timer is waiting for
   *  `ANIMATIONS_DONE`. Read by the SOLO multiplex front as a fallback for
   *  `sendAnimationsDone.forPlayer` when `_lastSentForPlayer` is null
   *  (bootstrap + early switch). Populated in both modes for consistency;
   *  PvP normal front ignores the field. */
  pendingPlayer?: Player;
}

// =============================================================================
// Pre-duel first-player coordinator (dice 2D6, since 2026-05-13). Replaces
// the legacy RPS/SELECT_TP/TP_RESULT pre-duel flow. OCGCore's in-game RPS
// (ROCK_PAPER_SCISSORS message type) is short-circuited via `skipRps=true`
// at INIT_DUEL, so the legacy RPS_CHOICE/RPS_RESULT messages have no use
// case in skytrix and are intentionally absent from the protocol.
// State machine: WAITING_PLAYERS → ROLLING_DICE → DICE_RESOLVED →
// CHOOSE_FIRST_PLAYER → FIRST_PLAYER_RESOLVED → DUELING.
// =============================================================================

/** Server → client prompt: "ready to roll your two dice". Sent to both
 *  players simultaneously. The client confirms readiness with a
 *  `PLAYER_RESPONSE { promptType: 'DICE_ROLL', data: {} }` payload; the
 *  server is the source of truth for the random values themselves. */
export interface DiceRollPromptMsg {
  type: 'DICE_ROLL';
  player: Player;
}

/** Server → client result: per-player dice values + sums + winner. Each die
 *  is a value in [1..6]; `sum0`/`sum1` are `dice0[0]+dice0[1]` etc. `winner`
 *  is the OCGCore player index of the higher sum, or null on a tie (which
 *  triggers an auto-reroll after a 1.8s suspense delay client-side). */
export interface DiceResultMsg {
  type: 'DICE_RESULT';
  dice0: [number, number];
  dice1: [number, number];
  sum0: number;
  sum1: number;
  winner: Player | null;
}

/** Server → client prompt sent to the dice winner only. The other player
 *  receives a `WAITING_RESPONSE`. Auto-resolves as "winner goes first"
 *  after `firstPlayerTimeoutMs` if the winner stays silent. */
export interface SelectFirstPlayerMsg {
  type: 'SELECT_FIRST_PLAYER';
  player: Player;
}

/** Server → client final result (broadcast to both): perspective-flipped
 *  `goFirst` boolean (true = the receiving player goes first). After this
 *  message both clients show the "You go first / second" banner for a
 *  short window (~2.5s) before the duel proper starts. */
export interface FirstPlayerResultMsg {
  type: 'FIRST_PLAYER_RESULT';
  goFirst: boolean;
}

export interface DuelStartingMsg {
  type: 'DUEL_STARTING';
  playerIndex: Player;
  traceId: string;
  /** Unique card codes from both decklists — for upfront image prefetch. */
  cardCodes: number[];
  /** γ Option C A1bis — populated only in SOLO multiplex (`[deck0, deck1]`).
   *  The front pre-fetches both perspectives' images so a `switchPerspective`
   *  does not flash uncached cards. PvP normal omits the field — each side
   *  only ever sees its own deck. */
  bothCardCodes?: [number[], number[]];
}

/** Server → client warmup hint emitted right before FIRST_PLAYER_RESULT.
 *  Carries the receiving player's own deck card codes so the client can
 *  prime the browser image cache during the 2.5s "You go first/second"
 *  announce window, before DUEL_STARTING + the first BOARD_STATE arrive.
 *  Each side gets ONLY its own deck (no info leak about the opponent's
 *  composition). Idempotent: re-emitting on reconnect is a no-op
 *  client-side. */
export interface DeckPrefetchMsg {
  type: 'DECK_PREFETCH';
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
  /** Full game-log entries from the duel start to the current event,
   *  pre-relativised for the receiving player's perspective. Restored
   *  client-side via DuelGameLogService.restoreFromSnapshot() so an F5 /
   *  reconnect repopulates the journal instead of starting empty. Optional
   *  for backward compatibility with payload sources that don't carry a
   *  builder (cancel-rollback re-sends, fork lifecycle, future paths). */
  gameLogEntries?: GameLogEntry[];
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

/** Server → client mount discriminant, emitted exactly once per WS attachment
 *  right after `SESSION_TOKEN`. Lets the client decide between mounting the
 *  pre-duel dice arena (`PRE_DUEL`) or a board skeleton (`DUELING`) on a
 *  mid-duel refresh, without sniffing the n-th message or waiting on a
 *  timeout. `ENDED` covers the preservation-period reconnect (the duel result
 *  is delivered just after via `storedDuelResult`). Not re-emitted on
 *  rematch — the client keeps its initial mountContext for the whole
 *  page lifecycle. */
export interface SessionPhaseMsg {
  type: 'SESSION_PHASE';
  phase: 'PRE_DUEL' | 'DUELING' | 'ENDED';
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
  /** γ Option C A8.1 — the player whose inactivity is being warned. Populated
   *  in both modes for consistency; required by SOLO multiplex (A28 routing)
   *  to dispatch the warning to the correct perspective slot. PvP normal
   *  front ignores the field. */
  player?: Player;
}

export interface WaitingResponseMsg {
  type: 'WAITING_RESPONSE';
  /** γ Option C A8.2 — the player whose response is being waited on.
   *  Populated in both modes for consistency; required by SOLO multiplex
   *  (A19) which emits on socket 0 and needs the target perspective to
   *  route to the right slot. PvP normal front ignores the field. */
  targetPlayer?: Player;
}

/** γ Option C A32 — generic server-side error message. Pre-existing wire
 *  shape (`{ type: 'ERROR', message }` from `client-message-router.ts:96`)
 *  is now typed. `player` is populated by SOLO multiplex when the error
 *  originated from a specific perspective slot (A28 routing-to-0 + slot tag);
 *  unset for connection-scoped errors. PvP normal ignores `player`. */
export interface ErrorMsg {
  type: 'ERROR';
  message: string;
  player?: Player;
}

// =============================================================================
// Client → Server Messages (non-prompt-response)
//
// SOLO multiplex (γ Option C) — every client→server message gains an optional
// `forPlayer?: 0 | 1` tag, used by the SOLO multiplexer to route the message
// to the perspective slot that emitted it. PvP normal MUST NOT set this field;
// the server validates strictly and rejects PvP payloads with `forPlayer`
// defined (A2 — possible impersonation attempt).
// =============================================================================

export interface SurrenderMsg {
  type: 'SURRENDER';
  forPlayer?: 0 | 1;
}

export interface RematchRequestMsg {
  type: 'REMATCH_REQUEST';
  forPlayer?: 0 | 1;
}

export interface RequestStateSyncMsg {
  type: 'REQUEST_STATE_SYNC';
  forPlayer?: 0 | 1;
}

export interface ActivityPingMsg {
  type: 'ACTIVITY_PING';
  forPlayer?: 0 | 1;
}

export interface AnimationsDoneMsg {
  type: 'ANIMATIONS_DONE';
  forPlayer?: 0 | 1;
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
 * no payload field is needed in PvP normal — SOLO multiplex tags
 * `forPlayer` to identify which perspective slot triggered the cancel.
 */
export interface CancelPromptSequenceMsg {
  type: 'CANCEL_PROMPT_SEQUENCE';
  forPlayer?: 0 | 1;
}
