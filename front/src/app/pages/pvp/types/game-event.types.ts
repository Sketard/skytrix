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
