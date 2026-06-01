/**
 * U12 (audit-4-modes-2026-06-01) — segmentation taxonomy for
 * `runReplayPreComputation`.
 *
 * The precompute loop slices the worker's flat event stream into
 * `PreComputedState[]` (one per timeline entry) based on per-message
 * decisions: flush the accumulator BEFORE this message starts a new
 * group, accumulate INTO the current group, or skip metadata-only
 * messages entirely. Historically those decisions live as a 4-branch
 * `if (filtered.type === 'MSG_CHAINING') ... else if (...)` ladder
 * in `replay-precompute.ts` — fine for the 4 existing branches, but a
 * new `MSG_*` added to the protocol without touching the precompute
 * silently lands in the `accumulate` default, even when the correct
 * answer is `flush-before` or `skip`. Frequency of `MSG_*` additions
 * is ~1/year (per git log), but the regression is invisible until a
 * user replays a duel that triggers the new feature and notices a
 * mislabeled / mis-grouped timeline entry.
 *
 * This module makes the taxonomy declarative: every `ServerMessage`
 * type has an explicit `SegmentationAction` here. The `Record<...>`
 * shape forces TypeScript to error at compile time when a new union
 * member is added — the PR that adds the type MUST also classify it.
 *
 * **NOT consumed by the prod ladder today** — `replay-precompute.ts`
 * keeps its inline branches. This module is the doctrine + the
 * compile-time gate. If a future refactor wants to replace the ladder
 * with `switch (getSegmentationAction(filtered.type))`, this map is
 * already the source of truth.
 *
 * Phase / turn flushes (`NEW_PHASE`, `NEW_TURN`) operate on raw
 * `OcgMessageType` BEFORE the message-to-protocol transform — they
 * stay outside this taxonomy by design.
 */

import type { ServerMessage } from './ws-protocol.js';

export type SegmentationAction =
  /** Flush the accumulated `events` buffer as its own PreComputedState
   *  BEFORE this message is pushed (the message itself then starts a
   *  new accumulation, or gets pushed as a separator state). Used for
   *  chain-resolution boundaries. */
  | 'flush-before'
  /** Accumulate into the current `events` buffer — the default for
   *  every visual game event (MSG_MOVE, MSG_DRAW, MSG_DAMAGE, …). */
  | 'accumulate'
  /** Metadata-only message that does not contribute to the timeline
   *  buffer and does not break a group (e.g. MSG_HINT, MSG_CONFIRM_CARDS
   *  metadata, WAITING_RESPONSE, MSG_CHAIN_SOLVING/SOLVED ticks). */
  | 'skip'
  /** Not produced by the worker's filtered event stream — exists in
   *  the `ServerMessage` union (transport / prompt / replay-control)
   *  but never reaches the precompute event accumulator. Asserts that
   *  the type is intentionally excluded rather than accidentally so. */
  | 'not-an-event';

/**
 * Exhaustive segmentation classification. `Record<ServerMessage['type'], …>`
 * forces TS to fail to compile when a new union member is added without
 * a documented action. Add the entry, decide the action, ship the PR.
 *
 * Default for visual game events is `'accumulate'`; flush boundaries are
 * `'flush-before'`; metadata ticks are `'skip'`; everything outside the
 * worker's filtered output is `'not-an-event'`.
 */
export const SEGMENTATION: Readonly<Record<ServerMessage['type'], SegmentationAction>> = {
  // --- Visual game events — accumulate into the current timeline entry ---
  BOARD_STATE: 'not-an-event',         // emitted by the precompute itself per state, not consumed
  MSG_MOVE: 'accumulate',
  MSG_DRAW: 'accumulate',
  MSG_DAMAGE: 'accumulate',
  MSG_RECOVER: 'accumulate',
  MSG_PAY_LPCOST: 'accumulate',
  MSG_SHUFFLE_HAND: 'accumulate',
  MSG_SHUFFLE_DECK: 'accumulate',
  MSG_FLIP_SUMMONING: 'accumulate',
  MSG_CHANGE_POS: 'accumulate',
  MSG_SET: 'accumulate',
  MSG_SWAP: 'accumulate',
  MSG_BECOME_TARGET: 'accumulate',
  MSG_ATTACK: 'accumulate',
  MSG_BATTLE: 'accumulate',
  MSG_TOSS_COIN: 'accumulate',
  MSG_TOSS_DICE: 'accumulate',
  MSG_EQUIP: 'accumulate',
  MSG_ADD_COUNTER: 'accumulate',
  MSG_REMOVE_COUNTER: 'accumulate',
  MSG_SHUFFLE_SET_CARD: 'accumulate',
  MSG_SWAP_GRAVE_DECK: 'accumulate',
  MSG_WIN: 'accumulate',

  // --- Flush boundaries — break the accumulator BEFORE pushing ---
  // MSG_CHAINING starts a new chain link's timeline entry (each effect gets
  //   its own row in the replay timeline).
  // MSG_CHAIN_END flushes the last link, then pushes itself as a separator
  //   state without chainIndex (front hides it via HIDDEN_LABELS).
  MSG_CHAINING: 'flush-before',
  MSG_CHAIN_END: 'flush-before',

  // --- Metadata ticks — neither flush nor accumulate visually ---
  // Pushed to the event buffer in some cases (MSG_CONFIRM_CARDS for animated
  // reveal) or used solely for accumulator metadata (MSG_HINT) — but neither
  // breaks a timeline group nor contributes a standalone label. The label
  // generator's SKIP_TYPES set (replay-precompute.ts:137) matches this list.
  WAITING_RESPONSE: 'skip',
  MSG_CHAIN_SOLVING: 'skip',
  MSG_CHAIN_SOLVED: 'skip',
  MSG_CHAIN_NEGATED: 'skip',
  MSG_HINT: 'skip',
  MSG_CONFIRM_CARDS: 'skip',

  // --- Prompts (SELECT_*, SORT_*, ANNOUNCE_*) — not visual events ---
  // The precompute feeds them as `currentDecisions`, not into `events`.
  // SELECT_IDLECMD / SELECT_BATTLECMD also flush via TRANSITION_BOUNDARY_PROMPTS
  // but that branch lives outside the per-event taxonomy.
  SELECT_IDLECMD: 'not-an-event',
  SELECT_BATTLECMD: 'not-an-event',
  SELECT_CARD: 'not-an-event',
  SELECT_CHAIN: 'not-an-event',
  SELECT_EFFECTYN: 'not-an-event',
  SELECT_YESNO: 'not-an-event',
  SELECT_PLACE: 'not-an-event',
  SELECT_DISFIELD: 'not-an-event',
  SELECT_POSITION: 'not-an-event',
  SELECT_OPTION: 'not-an-event',
  SELECT_TRIBUTE: 'not-an-event',
  SELECT_SUM: 'not-an-event',
  SELECT_UNSELECT_CARD: 'not-an-event',
  SELECT_COUNTER: 'not-an-event',
  SORT_CARD: 'not-an-event',
  SORT_CHAIN: 'not-an-event',
  ANNOUNCE_RACE: 'not-an-event',
  ANNOUNCE_ATTRIB: 'not-an-event',
  ANNOUNCE_CARD: 'not-an-event',
  ANNOUNCE_NUMBER: 'not-an-event',

  // --- System / transport — never seen by the event accumulator ---
  DUEL_END: 'not-an-event',
  TIMER_STATE: 'not-an-event',
  DICE_ROLL: 'not-an-event',
  DICE_RESULT: 'not-an-event',
  SELECT_FIRST_PLAYER: 'not-an-event',
  FIRST_PLAYER_RESULT: 'not-an-event',
  DUEL_STARTING: 'not-an-event',
  DECK_PREFETCH: 'not-an-event',
  REMATCH_INVITATION: 'not-an-event',
  REMATCH_STARTING: 'not-an-event',
  REMATCH_CANCELLED: 'not-an-event',
  WORKER_ERROR: 'not-an-event',
  STATE_SYNC: 'not-an-event',
  CHAIN_STATE: 'not-an-event',
  SESSION_TOKEN: 'not-an-event',
  SESSION_PHASE: 'not-an-event',
  OPPONENT_DISCONNECTED: 'not-an-event',
  OPPONENT_RECONNECTED: 'not-an-event',
  INACTIVITY_WARNING: 'not-an-event',
  ERROR: 'not-an-event',

  // --- Replay control + solver — out of scope for live precompute ---
  REPLAY_BOARD_STATES: 'not-an-event',
  REPLAY_METADATA: 'not-an-event',
  REPLAY_ERROR: 'not-an-event',
  REPLAY_FORK_READY: 'not-an-event',
  SOLVER_PROGRESS: 'not-an-event',
  SOLVER_RESULT: 'not-an-event',
  SOLVER_CANCELLED: 'not-an-event',
  SOLVER_ERROR: 'not-an-event',
  SOLVER_HANDTRAPS: 'not-an-event',
};

/**
 * Look up the segmentation action for a `ServerMessage` type. Default is
 * `'accumulate'` for unknown types, but the exhaustive `Record` above
 * means TS will error before that path is reachable from prod code.
 */
export function getSegmentationAction(t: ServerMessage['type']): SegmentationAction {
  return SEGMENTATION[t] ?? 'accumulate';
}
