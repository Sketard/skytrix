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
}

export interface SelectEffectYnMsg {
  type: 'SELECT_EFFECTYN';
  player: Player;
  cardCode: number;
  cardName: string;
  /** 64-bit OCGCore description code: high 20 bits = cardCode, low 20 = strIndex.
   *  Resolved to localized text client-side (see duel-description.util.ts). */
  description: number;
  /** Server-resolved effect text for `description` — the code's `strN`
   *  paragraph (cards.cdb) or system string, the only place that text is
   *  reachable. `''` when nothing usable resolved (placeholder string,
   *  unknown card). Absent on legacy payloads. */
  descriptionText?: string;
}

export interface SelectYesNoMsg {
  type: 'SELECT_YESNO';
  player: Player;
  /** 64-bit OCGCore description code: high 20 bits = cardCode, low 20 = strIndex.
   *  Resolved to localized text client-side (see duel-description.util.ts). */
  description: number;
  /** Server-resolved effect text for `description` — the code's `strN`
   *  paragraph (cards.cdb) or system string, the only place that text is
   *  reachable. `''` when nothing usable resolved (placeholder string,
   *  unknown card). Absent on legacy payloads. */
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
  /** Each entry is a 64-bit OCGCore description code (high 20 bits = cardCode,
   *  low 20 = strIndex). Resolved to localized labels client-side. */
  options: number[];
  /**
   * Server-resolved effect text for each `options` entry — same index. The
   * worker resolves the code's `strN` paragraph (cards.cdb) or system string,
   * the only place the per-paragraph card text is available. A `''` entry
   * means the code resolved to nothing usable (placeholder string, unknown
   * card) — the client falls back to a generic label. Absent on legacy
   * payloads (the client then keeps its own best-effort resolution).
   */
  optionTexts?: string[];
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

/** Empty payload — the client confirms readiness to roll; the server is the
 *  source of truth for the random dice values themselves. */
export interface DiceRollResponse {
  // Intentionally empty. Kept as an interface (not `{}`) so future fields
  // (e.g. animation-skip preference) can be added without a breaking change.
  readonly _empty?: undefined;
}

export interface SelectFirstPlayerResponse {
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
  | 'DICE_ROLL'
  | 'SELECT_FIRST_PLAYER';

/** SOLO multiplex (γ Option C) — `forPlayer` tags PLAYER_RESPONSE with the
 *  perspective slot that emitted it. PvP normal MUST NOT set this field;
 *  server validates strictly and rejects PvP payloads with `forPlayer`
 *  defined (A2 — possible impersonation attempt). */
export type PlayerResponseMsg =
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_IDLECMD'; data: IdleCmdResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_BATTLECMD'; data: BattleCmdResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_CARD'; data: CardResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_CHAIN'; data: ChainResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_EFFECTYN'; data: EffectYnResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_YESNO'; data: YesNoResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_PLACE'; data: PlaceResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_DISFIELD'; data: PlaceResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_POSITION'; data: PositionResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_OPTION'; data: OptionResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_TRIBUTE'; data: TributeResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_SUM'; data: SumResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_UNSELECT_CARD'; data: ChainResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_COUNTER'; data: CounterResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SORT_CARD'; data: SortResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SORT_CHAIN'; data: SortResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'ANNOUNCE_RACE'; data: AnnounceResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'ANNOUNCE_ATTRIB'; data: AnnounceResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'ANNOUNCE_CARD'; data: AnnounceResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'ANNOUNCE_NUMBER'; data: AnnounceResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'DICE_ROLL'; data: DiceRollResponse; forPlayer?: 0 | 1 }
  | { type: 'PLAYER_RESPONSE'; promptType: 'SELECT_FIRST_PLAYER'; data: SelectFirstPlayerResponse; forPlayer?: 0 | 1 };
