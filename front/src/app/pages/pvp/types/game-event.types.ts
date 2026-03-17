import {
  MoveMsg,
  DrawMsg,
  ShuffleHandMsg,
  ShuffleDeckMsg,
  DamageMsg,
  RecoverMsg,
  PayLpCostMsg,
  ChainingMsg,
  ChainSolvingMsg,
  ChainSolvedMsg,
  ChainEndMsg,
  FlipSummoningMsg,
  ChangePosMsg,
  SwapMsg,
  BecomeTargetMsg,
  AttackMsg,
  BattleMsg,
  ConfirmCardsMsg,
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
  | SwapMsg
  | BecomeTargetMsg
  | AttackMsg
  | BattleMsg
  | ConfirmCardsMsg;
