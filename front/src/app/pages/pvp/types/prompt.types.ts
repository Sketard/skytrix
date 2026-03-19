import {
  SelectIdleCmdMsg,
  SelectBattleCmdMsg,
  SelectCardMsg,
  SelectChainMsg,
  SelectEffectYnMsg,
  SelectYesNoMsg,
  SelectPlaceMsg,
  SelectDisfieldMsg,
  SelectPositionMsg,
  SelectOptionMsg,
  SelectTributeMsg,
  SelectSumMsg,
  SelectUnselectCardMsg,
  SelectCounterMsg,
  SortCardMsg,
  SortChainMsg,
  AnnounceRaceMsg,
  AnnounceAttribMsg,
  AnnounceCardMsg,
  AnnounceNumberMsg,
  RpsChoiceMsg,
  SelectTpMsg,
} from '../duel-ws.types';

export type Prompt =
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
  | RpsChoiceMsg
  | SelectTpMsg;
