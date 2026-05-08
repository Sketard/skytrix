// =============================================================================
// duel-ws.types.ts — Skytrix WS protocol — index + union types (front)
//
// Re-exports the 6 protocol files (shared / game / prompts / system / replay /
// solver) and assembles the ServerMessage / ClientMessage unions.
//
// Audit finding H9 — split into 6 logical files. The 6 split files are
// strictly synced front↔back via check-ws-protocol-sync.mjs (modulo `.js`
// import suffix). This index file is NOT byte-synced (paths differ between
// the two sides) but its content mirrors the back index in structure.
// =============================================================================

export * from './duel-ws-shared.types';
export * from './duel-ws-game.types';
export * from './duel-ws-prompts.types';
export * from './duel-ws-system.types';
export * from './duel-ws-replay.types';
export * from './duel-ws-solver.types';

import type {
  BoardStateMsg, MoveMsg, DrawMsg, DamageMsg, RecoverMsg, PayLpCostMsg,
  ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ChainEndMsg, ChainNegatedMsg,
  HintMsg, ConfirmCardsMsg, ShuffleHandMsg, ShuffleDeckMsg, FlipSummoningMsg,
  ChangePosMsg, SetMsg, SwapMsg, BecomeTargetMsg, AttackMsg, BattleMsg,
  TossCoinMsg, TossDiceMsg, EquipMsg, AddCounterMsg, RemoveCounterMsg,
  ShuffleSetCardMsg, SwapGraveDeckMsg, WinMsg,
} from './duel-ws-game.types';

import type {
  SelectIdleCmdMsg, SelectBattleCmdMsg, SelectCardMsg, SelectChainMsg,
  SelectEffectYnMsg, SelectYesNoMsg, SelectPlaceMsg, SelectDisfieldMsg,
  SelectPositionMsg, SelectOptionMsg, SelectTributeMsg, SelectSumMsg,
  SelectUnselectCardMsg, SelectCounterMsg, SortCardMsg, SortChainMsg,
  AnnounceRaceMsg, AnnounceAttribMsg, AnnounceCardMsg, AnnounceNumberMsg,
  PlayerResponseMsg,
} from './duel-ws-prompts.types';

import type {
  DuelEndMsg, TimerStateMsg, RpsChoiceMsg, RpsResultMsg, SelectTpMsg,
  TpResultMsg, DuelStartingMsg, RematchInvitationMsg, RematchStartingMsg,
  RematchCancelledMsg, WorkerErrorMsg, StateSyncMsg, ChainStateMsg,
  SessionTokenMsg, OpponentDisconnectedMsg, OpponentReconnectedMsg,
  InactivityWarningMsg, WaitingResponseMsg,
  SurrenderMsg, RematchRequestMsg, RequestStateSyncMsg,
  ActivityPingMsg, AnimationsDoneMsg, CancelPromptSequenceMsg,
} from './duel-ws-system.types';

import type {
  ReplayBoardStatesMsg, ReplayMetadataMsg, ReplayErrorMsg, ReplayForkReadyMsg,
  ReplayLoadMsg, ReplayForkMsg, ReplayForkContinueMsg, ReplayForkCancelMsg,
} from './duel-ws-replay.types';

import type {
  SolverProgressMessage, SolverResultMessage, SolverCancelledMessage,
  SolverErrorMessage, SolverHandtrapsMessage,
  SolverStartMessage, SolverCancelMessage, SolverInitMessage,
} from './duel-ws-solver.types';

// =============================================================================
// Union Types
// =============================================================================

export type ServerMessage =
  // Game messages (19)
  | BoardStateMsg
  | MoveMsg
  | DrawMsg
  | DamageMsg
  | RecoverMsg
  | PayLpCostMsg
  | ChainingMsg
  | ChainSolvingMsg
  | ChainSolvedMsg
  | ChainEndMsg
  | ChainNegatedMsg
  | HintMsg
  | ConfirmCardsMsg
  | ShuffleHandMsg
  | ShuffleDeckMsg
  | FlipSummoningMsg
  | ChangePosMsg
  | SetMsg
  | SwapMsg
  | BecomeTargetMsg
  | AttackMsg
  | BattleMsg
  | TossCoinMsg
  | TossDiceMsg
  | EquipMsg
  | AddCounterMsg
  | RemoveCounterMsg
  | ShuffleSetCardMsg
  | SwapGraveDeckMsg
  | WinMsg
  // Prompt messages (20)
  | SelectIdleCmdMsg
  | SelectBattleCmdMsg
  | SelectCardMsg
  | SelectChainMsg
  | SelectEffectYnMsg
  | SelectYesNoMsg
  | SelectPlaceMsg
  | SelectDisfieldMsg
  | SelectPositionMsg
  | SelectOptionMsg
  | SelectTributeMsg
  | SelectSumMsg
  | SelectUnselectCardMsg
  | SelectCounterMsg
  | SortCardMsg
  | SortChainMsg
  | AnnounceRaceMsg
  | AnnounceAttribMsg
  | AnnounceCardMsg
  | AnnounceNumberMsg
  // System messages (18)
  | DuelEndMsg
  | TimerStateMsg
  | RpsChoiceMsg
  | RpsResultMsg
  | SelectTpMsg
  | TpResultMsg
  | DuelStartingMsg
  | RematchInvitationMsg
  | RematchStartingMsg
  | RematchCancelledMsg
  | WorkerErrorMsg
  | StateSyncMsg
  | ChainStateMsg
  | SessionTokenMsg
  | OpponentDisconnectedMsg
  | OpponentReconnectedMsg
  | InactivityWarningMsg
  | WaitingResponseMsg
  // Replay messages (4)
  | ReplayBoardStatesMsg
  | ReplayMetadataMsg
  | ReplayErrorMsg
  | ReplayForkReadyMsg
  // Solver messages (5)
  | SolverProgressMessage
  | SolverResultMessage
  | SolverCancelledMessage
  | SolverErrorMessage
  | SolverHandtrapsMessage;

export type ClientMessage =
  | PlayerResponseMsg
  | SurrenderMsg
  | RematchRequestMsg
  | RequestStateSyncMsg
  | ActivityPingMsg
  | AnimationsDoneMsg
  | CancelPromptSequenceMsg
  // Replay messages (4)
  | ReplayLoadMsg
  | ReplayForkMsg
  | ReplayForkContinueMsg
  | ReplayForkCancelMsg
  // Solver messages (3)
  | SolverStartMessage
  | SolverCancelMessage
  | SolverInitMessage;
