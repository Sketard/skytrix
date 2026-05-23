import {
  MoveMsg,
  DrawMsg,
  ShuffleHandMsg,
  ShuffleDeckMsg,
  DamageMsg,
  RecoverMsg,
  PayLpCostMsg,
  ChainingMsg,
  ChainNegatedMsg,
  ChainSolvingMsg,
  ChainSolvedMsg,
  ChainEndMsg,
  FlipSummoningMsg,
  ChangePosMsg,
  SetMsg,
  SwapMsg,
  BecomeTargetMsg,
  AttackMsg,
  BattleMsg,
  ConfirmCardsMsg,
  TossCoinMsg,
  TossDiceMsg,
  EquipMsg,
  AddCounterMsg,
  RemoveCounterMsg,
  ShuffleSetCardMsg,
  SwapGraveDeckMsg,
  WinMsg,
  SelectCardMsg,
} from '../duel-ws.types';

export type GameEvent =
  | MoveMsg
  | DrawMsg
  | ShuffleHandMsg
  | ShuffleDeckMsg
  | DamageMsg
  | RecoverMsg
  | PayLpCostMsg
  | ChainingMsg
  | ChainSolvingMsg
  | ChainSolvedMsg
  | ChainEndMsg
  | FlipSummoningMsg
  | ChangePosMsg
  | SetMsg
  | SwapMsg
  | BecomeTargetMsg
  | AttackMsg
  | BattleMsg
  | ConfirmCardsMsg
  | TossCoinMsg
  | TossDiceMsg
  | EquipMsg
  | AddCounterMsg
  | RemoveCounterMsg
  | ShuffleSetCardMsg
  | SwapGraveDeckMsg;

/**
 * Palier 0 — the EventStream type. Wider than `GameEvent` (animation
 * queue subset): adds the three types that bypass the animation queue by
 * design but still belong to the duel's logical event stream:
 *   · `ChainNegatedMsg` — consumed by `DuelEventProcessor` for chain state,
 *     never enqueued; surfaces here for the Game Log "Nié" badge;
 *   · `WinMsg` — PvP only: the server forwards both the raw MSG_WIN AND a
 *     DUEL_END synthesized from it. The raw MSG_WIN is dropped at the
 *     DuelConnection layer (no case in `handleMessage`'s switch); the
 *     journal 🏆 row is sourced from a synthetic WinMsg reconstructed in
 *     the `DUEL_END` case using `winner` + `winReasonCode`. Replay
 *     reaches the same row via `GameLogBuilder.ingestState` instead, so
 *     the synthesis is PvP-only.
 *   · `SelectCardMsg` — a prompt, routed outside `processEvent`; the
 *     builder needs it as the secondary `MSG_BECOME_TARGET` resolver.
 * The animation queue and the EventStream are distinct objects; the
 * "MSG_CHAIN_NEGATED is NOT enqueued" invariant stays true.
 */
export type StreamEvent = GameEvent | ChainNegatedMsg | WinMsg | SelectCardMsg;
