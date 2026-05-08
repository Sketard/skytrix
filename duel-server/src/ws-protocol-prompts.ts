// =============================================================================
// ws-protocol-prompts.ts — Skytrix WS protocol — prompt messages
// 20 SELECT_* / SORT_* / ANNOUNCE_* prompts (server → client) +
// per-prompt response data shapes (client → server payloads).
// Sync rule: same content as front/src/app/pages/pvp/duel-ws-prompts.types.ts
// (modulo `.js` import suffix).
// =============================================================================

import type { Player, CardInfo, PlaceOption } from './ws-protocol-shared.js';

// =============================================================================
// Server → Client: Prompt Messages (20)
// =============================================================================

export interface SelectIdleCmdMsg {
  type: 'SELECT_IDLECMD';
  player: Player;
  summons: CardInfo[];
  specialSummons: CardInfo[];
  repositions: CardInfo[];
  setMonsters: CardInfo[];
  activations: CardInfo[];
  setSpellTraps: CardInfo[];
  canBattlePhase: boolean;
  canEndPhase: boolean;
}

export interface SelectBattleCmdMsg {
  type: 'SELECT_BATTLECMD';
  player: Player;
  attacks: CardInfo[];
  activations: CardInfo[];
  canMainPhase2: boolean;
  canEndPhase: boolean;
}

export interface SelectCardMsg {
  type: 'SELECT_CARD';
  player: Player;
  min: number;
  max: number;
  cards: CardInfo[];
  cancelable: boolean;
}

export interface SelectChainMsg {
  type: 'SELECT_CHAIN';
  player: Player;
  cards: CardInfo[];
  forced: boolean;
  hintTiming: number;
  hintTimingLabel: string;
}

export interface SelectEffectYnMsg {
  type: 'SELECT_EFFECTYN';
  player: Player;
  cardCode: number;
  cardName: string;
  description: number;
  descriptionText?: string;
}

export interface SelectYesNoMsg {
  type: 'SELECT_YESNO';
  player: Player;
  description: number;
  descriptionText?: string;
}

export interface SelectPlaceMsg {
  type: 'SELECT_PLACE';
  player: Player;
  count: number;
  places: PlaceOption[];
}

export interface SelectDisfieldMsg {
  type: 'SELECT_DISFIELD';
  player: Player;
  count: number;
  places: PlaceOption[];
}

export interface SelectPositionMsg {
  type: 'SELECT_POSITION';
  player: Player;
  cardCode: number;
  cardName: string;
  positions: number[];
}

export interface SelectOptionMsg {
  type: 'SELECT_OPTION';
  player: Player;
  options: number[];
  descriptions: string[];
}

export interface SelectTributeMsg {
  type: 'SELECT_TRIBUTE';
  player: Player;
  min: number;
  max: number;
  cards: CardInfo[];
  cancelable: boolean;
}

export interface SelectSumMsg {
  type: 'SELECT_SUM';
  player: Player;
  mustSelect: CardInfo[];
  cards: CardInfo[];
  targetSum: number;
  minCards: number;
  maxCards: number;
  selectMax: number;
}

export interface SelectUnselectCardMsg {
  type: 'SELECT_UNSELECT_CARD';
  player: Player;
  cards: CardInfo[];
  /** Number of cards at the start of `cards` that can be selected (added). The rest are already selected (can be removed). */
  selectCount: number;
  canFinish: boolean;
}

export interface SelectCounterMsg {
  type: 'SELECT_COUNTER';
  player: Player;
  counterType: number;
  count: number;
  cards: CardInfo[];
}

export interface SortCardMsg {
  type: 'SORT_CARD';
  player: Player;
  cards: CardInfo[];
}

export interface SortChainMsg {
  type: 'SORT_CHAIN';
  player: Player;
  cards: CardInfo[];
}

export interface AnnounceRaceMsg {
  type: 'ANNOUNCE_RACE';
  player: Player;
  count: number;
  available: number[];
}

export interface AnnounceAttribMsg {
  type: 'ANNOUNCE_ATTRIB';
  player: Player;
  count: number;
  available: number[];
}

export interface AnnounceCardMsg {
  type: 'ANNOUNCE_CARD';
  player: Player;
  opcodes: number[];
}

export interface AnnounceNumberMsg {
  type: 'ANNOUNCE_NUMBER';
  player: Player;
  options: number[];
}

// =============================================================================
// Response Data Types (PLAYER_RESPONSE payload variants)
// =============================================================================

export interface IdleCmdResponse {
  action: number;
  index: number | null;
}

export interface BattleCmdResponse {
  action: number;
  index: number | null;
}

export interface CardResponse {
  indices: number[];
}

export interface ChainResponse {
  index: number | null;
}

export interface EffectYnResponse {
  yes: boolean;
}

export interface YesNoResponse {
  yes: boolean;
}

export interface PlaceResponse {
  places: PlaceOption[];
}

export interface PositionResponse {
  position: number;
}

export interface OptionResponse {
  index: number;
}

export interface TributeResponse {
  indices: number[];
}

export interface SumResponse {
  indices: number[];
}

export interface CounterResponse {
  counts: number[];
}

export interface SortResponse {
  order: number[] | null;
}

export interface AnnounceResponse {
  value: number;
}

export interface RpsResponse {
  choice: number; // 0 = Rock, 1 = Paper, 2 = Scissors (client convention)
}

export interface TpResponse {
  goFirst: boolean;
}

// =============================================================================
// SelectPromptType + PlayerResponseMsg union
// =============================================================================

export type SelectPromptType =
  | 'SELECT_IDLECMD'
  | 'SELECT_BATTLECMD'
  | 'SELECT_CARD'
  | 'SELECT_CHAIN'
  | 'SELECT_EFFECTYN'
  | 'SELECT_YESNO'
  | 'SELECT_PLACE'
  | 'SELECT_DISFIELD'
  | 'SELECT_POSITION'
  | 'SELECT_OPTION'
  | 'SELECT_TRIBUTE'
  | 'SELECT_SUM'
  | 'SELECT_UNSELECT_CARD'
  | 'SELECT_COUNTER'
  | 'SORT_CARD'
  | 'SORT_CHAIN'
  | 'ANNOUNCE_RACE'
  | 'ANNOUNCE_ATTRIB'
  | 'ANNOUNCE_CARD'
  | 'ANNOUNCE_NUMBER'
  | 'RPS_CHOICE'
  | 'SELECT_TP';

export type PlayerResponseMsg =
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_IDLECMD'; data: IdleCmdResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_BATTLECMD'; data: BattleCmdResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_CARD'; data: CardResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_CHAIN'; data: ChainResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_EFFECTYN'; data: EffectYnResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_YESNO'; data: YesNoResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_PLACE'; data: PlaceResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_DISFIELD'; data: PlaceResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_POSITION'; data: PositionResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_OPTION'; data: OptionResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_TRIBUTE'; data: TributeResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_SUM'; data: SumResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_UNSELECT_CARD'; data: ChainResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_COUNTER'; data: CounterResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SORT_CARD'; data: SortResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SORT_CHAIN'; data: SortResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'ANNOUNCE_RACE'; data: AnnounceResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'ANNOUNCE_ATTRIB'; data: AnnounceResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'ANNOUNCE_CARD'; data: AnnounceResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'ANNOUNCE_NUMBER'; data: AnnounceResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'RPS_CHOICE'; data: RpsResponse }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_TP'; data: TpResponse };
