import {
  MoveMsg,
  DrawMsg,
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
  AttackMsg,
  BattleMsg,
} from '../duel-ws.types';

export type GameEvent =
  | MoveMsg
  | DrawMsg
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
  | AttackMsg
  | BattleMsg;
