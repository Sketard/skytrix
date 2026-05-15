// =============================================================================
// ws-protocol.ts — Skytrix WS protocol — index + union types
//
// Re-exports the 6 protocol files (shared / game / prompts / system / replay /
// solver) and assembles the ServerMessage / ClientMessage unions.
//
// Audit finding H9 — split into 6 logical files. The 6 split files are
// strictly synced front↔back via check-ws-protocol-sync.mjs (modulo `.js`
// import suffix). This index file is NOT byte-synced (paths differ between
// the two sides) but its content mirrors the front index in structure.
// =============================================================================

export * from './ws-protocol-shared.js';
export * from './ws-protocol-game.js';
export * from './ws-protocol-prompts.js';
export * from './ws-protocol-system.js';
export * from './ws-protocol-replay.js';
export * from './ws-protocol-solver.js';

import type {
  BoardStateMsg, MoveMsg, DrawMsg, DamageMsg, RecoverMsg, PayLpCostMsg,
  ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ChainEndMsg, ChainNegatedMsg,
  HintMsg, ConfirmCardsMsg, ShuffleHandMsg, ShuffleDeckMsg, FlipSummoningMsg,
  ChangePosMsg, SetMsg, SwapMsg, BecomeTargetMsg, AttackMsg, BattleMsg,
  TossCoinMsg, TossDiceMsg, EquipMsg, AddCounterMsg, RemoveCounterMsg,
  ShuffleSetCardMsg, SwapGraveDeckMsg, WinMsg,
} from './ws-protocol-game.js';

import type {
  SelectIdleCmdMsg, SelectBattleCmdMsg, SelectCardMsg, SelectChainMsg,
  SelectEffectYnMsg, SelectYesNoMsg, SelectPlaceMsg, SelectDisfieldMsg,
  SelectPositionMsg, SelectOptionMsg, SelectTributeMsg, SelectSumMsg,
  SelectUnselectCardMsg, SelectCounterMsg, SortCardMsg, SortChainMsg,
  AnnounceRaceMsg, AnnounceAttribMsg, AnnounceCardMsg, AnnounceNumberMsg,
  PlayerResponseMsg,
} from './ws-protocol-prompts.js';

import type {
  DuelEndMsg, TimerStateMsg,
  DiceRollPromptMsg, DiceResultMsg,
  SelectFirstPlayerMsg, FirstPlayerResultMsg, DuelStartingMsg, DeckPrefetchMsg,
  RematchInvitationMsg, RematchStartingMsg, RematchCancelledMsg,
  WorkerErrorMsg, StateSyncMsg, ChainStateMsg,
  SessionTokenMsg, SessionPhaseMsg, OpponentDisconnectedMsg, OpponentReconnectedMsg,
  InactivityWarningMsg, WaitingResponseMsg,
  SurrenderMsg, RematchRequestMsg, RequestStateSyncMsg,
  ActivityPingMsg, AnimationsDoneMsg, CancelPromptSequenceMsg,
} from './ws-protocol-system.js';

import type {
  ReplayBoardStatesMsg, ReplayMetadataMsg, ReplayErrorMsg, ReplayForkReadyMsg,
  ReplayLoadMsg, ReplayForkMsg, ReplayForkContinueMsg, ReplayForkCancelMsg,
} from './ws-protocol-replay.js';

import type {
  SolverProgressMessage, SolverResultMessage, SolverCancelledMessage,
  SolverErrorMessage, SolverHandtrapsMessage,
  SolverStartMessage, SolverCancelMessage, SolverInitMessage,
} from './ws-protocol-solver.js';

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
  // System messages (19)
  | DuelEndMsg
  | TimerStateMsg
  | DiceRollPromptMsg
  | DiceResultMsg
  | SelectFirstPlayerMsg
  | FirstPlayerResultMsg
  | DuelStartingMsg
  | DeckPrefetchMsg
  | RematchInvitationMsg
  | RematchStartingMsg
  | RematchCancelledMsg
  | WorkerErrorMsg
  | StateSyncMsg
  | ChainStateMsg
  | SessionTokenMsg
  | SessionPhaseMsg
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
