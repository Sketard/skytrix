// =============================================================================
// ws-protocol.ts — Skytrix PvP WebSocket Protocol DTOs
// Zero internal imports — this file is copied verbatim to Angular
// Manual copy: duel-server/src/ws-protocol.ts <-> front/src/app/pages/pvp/duel-ws.types.ts
// Update BOTH files in the same commit
// =============================================================================

// =============================================================================
// Shared Primitive Types
// =============================================================================

export type Player = 0 | 1;

export type Phase =
  | 'DRAW'
  | 'STANDBY'
  | 'MAIN1'
  | 'BATTLE_START'
  | 'BATTLE_STEP'
  | 'DAMAGE'
  | 'DAMAGE_CALC'
  | 'BATTLE'
  | 'MAIN2'
  | 'END';

// Card position bitmask values (independent of OCGCore OcgPosition)
export const POSITION = {
  FACEUP_ATTACK: 0x1,
  FACEDOWN_ATTACK: 0x2,
  FACEUP_DEFENSE: 0x4,
  FACEDOWN_DEFENSE: 0x8,
} as const;
export type Position = (typeof POSITION)[keyof typeof POSITION];

// Card location bitmask values (independent of OCGCore OcgLocation)
export const LOCATION = {
  DECK: 0x01,
  HAND: 0x02,
  MZONE: 0x04,
  SZONE: 0x08,
  GRAVE: 0x10,
  BANISHED: 0x20,
  EXTRA: 0x40,
  OVERLAY: 0x80,
} as const;
export type CardLocation = (typeof LOCATION)[keyof typeof LOCATION];

// Board zone identifiers (18 physical zones per Master Rule 5)
// S1/S5 double as Pendulum L/R
export type ZoneId =
  | 'M1' | 'M2' | 'M3' | 'M4' | 'M5'
  | 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
  | 'FIELD'
  | 'EMZ_L' | 'EMZ_R'
  | 'GY' | 'BANISHED' | 'EXTRA' | 'DECK' | 'HAND';

// =============================================================================
// Board State Sub-Types (BOARD_STATE / STATE_SYNC)
// =============================================================================

export interface CardOnField {
  cardCode: number | null;
  name: string | null;
  position: Position;
  overlayMaterials: number[];
  counters: Record<string, number>;
  currentAtk?: number;
  currentDef?: number;
  baseAtk?: number;
  baseDef?: number;
  currentLevel?: number;
  baseLevel?: number;
  currentRank?: number;
  baseRank?: number;
  currentAttribute?: number;
  baseAttribute?: number;
  currentRace?: number;
  baseRace?: number;
  currentLScale?: number;
  currentRScale?: number;
  baseLScale?: number;
  baseRScale?: number;
  isLink?: boolean;
  isEffectNegated?: boolean;
  equipTarget?: { controller: 0 | 1; location: number; sequence: number } | null;
}

export interface BoardZone {
  zoneId: ZoneId;
  cards: CardOnField[];
}

export interface PlayerBoardState {
  lp: number;
  deckCount: number;
  extraCount: number;
  zones: BoardZone[];
}

export interface BoardStatePayload {
  turnPlayer: Player;
  turnCount: number;
  phase: Phase;
  players: [PlayerBoardState, PlayerBoardState];
}

// =============================================================================
// Shared Sub-Types for Messages
// =============================================================================

export interface CardInfo {
  cardCode: number;
  name: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  position?: number;
  description?: string;
  amount?: number;
}

export interface PlaceOption {
  player: Player;
  location: CardLocation;
  sequence: number;
}

// =============================================================================
// Server -> Client: Game Messages (19)
// =============================================================================

export interface BoardStateMsg {
  type: 'BOARD_STATE';
  data: BoardStatePayload;
}

export interface MoveMsg {
  type: 'MSG_MOVE';
  cardCode: number;
  cardName: string;
  player: Player;
  fromLocation: CardLocation;
  fromSequence: number;
  fromPosition: Position;
  toLocation: CardLocation;
  toSequence: number;
  toPosition: Position;
  isToken: boolean;
  reason: number;
}

export interface DrawMsg {
  type: 'MSG_DRAW';
  player: Player;
  cards: (number | null)[];
}

export interface DamageMsg {
  type: 'MSG_DAMAGE';
  player: Player;
  amount: number;
}

export interface RecoverMsg {
  type: 'MSG_RECOVER';
  player: Player;
  amount: number;
}

export interface PayLpCostMsg {
  type: 'MSG_PAY_LPCOST';
  player: Player;
  amount: number;
}

export interface ChainingMsg {
  type: 'MSG_CHAINING';
  cardCode: number;
  cardName: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  chainIndex: number;
  description: number;
}

export interface ChainSolvingMsg {
  type: 'MSG_CHAIN_SOLVING';
  chainIndex: number;
}

export interface ChainSolvedMsg {
  type: 'MSG_CHAIN_SOLVED';
  chainIndex: number;
}

export interface ChainEndMsg {
  type: 'MSG_CHAIN_END';
}

export interface ChainNegatedMsg {
  type: 'MSG_CHAIN_NEGATED';
  chainIndex: number;
}

export interface HintMsg {
  type: 'MSG_HINT';
  hintType: number;
  player: Player;
  value: number;
  cardName: string;
  hintAction: string;
}

export interface ConfirmCardsMsg {
  type: 'MSG_CONFIRM_CARDS';
  player: Player;
  cards: CardInfo[];
}

export interface ShuffleHandMsg {
  type: 'MSG_SHUFFLE_HAND';
  player: Player;
  cards: (number | null)[];
}

export interface ShuffleDeckMsg {
  type: 'MSG_SHUFFLE_DECK';
  player: Player;
}

export interface FlipSummoningMsg {
  type: 'MSG_FLIP_SUMMONING';
  cardCode: number;
  cardName: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  position: Position;
}

export interface ChangePosMsg {
  type: 'MSG_CHANGE_POS';
  cardCode: number;
  cardName: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  previousPosition: Position;
  currentPosition: Position;
}

export interface SetMsg {
  type: 'MSG_SET';
  cardCode: number;
  cardName: string;
  player: Player;
  location: CardLocation;
  sequence: number;
  position: Position;
}

export interface SwapMsg {
  type: 'MSG_SWAP';
  card1: CardInfo;
  card2: CardInfo;
}

export interface BecomeTargetMsg {
  type: 'MSG_BECOME_TARGET';
  cards: { player: Player; location: CardLocation; sequence: number }[];
}

export interface AttackMsg {
  type: 'MSG_ATTACK';
  attackerPlayer: Player;
  attackerSequence: number;
  defenderPlayer: Player | null;
  defenderSequence: number | null;
}

export interface BattleMsg {
  type: 'MSG_BATTLE';
  attackerPlayer: Player;
  attackerSequence: number;
  attackerDamage: number;
  defenderPlayer: Player;
  defenderSequence: number;
  defenderDamage: number;
}

export interface WinMsg {
  type: 'MSG_WIN';
  player: Player;
  reason: number;
}

// =============================================================================
// Server -> Client: Prompt Messages (20)
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
// Server -> Client: System Messages (10)
// =============================================================================

export type DuelEndReason = 'surrender' | 'disconnect' | 'timeout' | 'inactivity' | 'draw_both_disconnect' | (string & {});

export interface DuelEndMsg {
  type: 'DUEL_END';
  winner: Player | null;
  reason: DuelEndReason;
}

export interface TimerStateMsg {
  type: 'TIMER_STATE';
  player: Player;
  remainingMs: number;
}

export interface RpsChoiceMsg {
  type: 'RPS_CHOICE';
  player: Player;
}

export interface RpsResultMsg {
  type: 'RPS_RESULT';
  player1Choice: number;
  player2Choice: number;
  winner: Player | null;
}

export interface SelectTpMsg {
  type: 'SELECT_TP';
  player: Player;
}

export interface TpResultMsg {
  type: 'TP_RESULT';
  goFirst: boolean;
}

export interface DuelStartingMsg {
  type: 'DUEL_STARTING';
  playerIndex: Player;
}

export interface RematchInvitationMsg {
  type: 'REMATCH_INVITATION';
}

export interface RematchStartingMsg {
  type: 'REMATCH_STARTING';
}

export interface RematchCancelledMsg {
  type: 'REMATCH_CANCELLED';
  reason: 'opponent_left' | 'timeout';
}

export interface WorkerErrorMsg {
  type: 'WORKER_ERROR';
  message: string;
}

export interface StateSyncMsg {
  type: 'STATE_SYNC';
  data: BoardStatePayload;
}

export interface ChainStateMsg {
  type: 'CHAIN_STATE';
  links: ChainingMsg[];
  phase: 'idle' | 'building' | 'resolving';
  negatedIndices: number[];
}

export interface SessionTokenMsg {
  type: 'SESSION_TOKEN';
  token: string;
}

export interface OpponentDisconnectedMsg {
  type: 'OPPONENT_DISCONNECTED';
  gracePeriodSec: number;
}

export interface OpponentReconnectedMsg {
  type: 'OPPONENT_RECONNECTED';
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
// Client -> Server Messages (3)
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

export interface SurrenderMsg {
  type: 'SURRENDER';
}

export interface RematchRequestMsg {
  type: 'REMATCH_REQUEST';
}

export interface RequestStateSyncMsg {
  type: 'REQUEST_STATE_SYNC';
}

export interface ActivityPingMsg {
  type: 'ACTIVITY_PING';
}

export interface InactivityWarningMsg {
  type: 'INACTIVITY_WARNING';
  remainingSec: number;
}

export interface WaitingResponseMsg {
  type: 'WAITING_RESPONSE';
}

// =============================================================================
// Union Type Exports
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
  // System messages (11)
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
  | WaitingResponseMsg;

export type ClientMessage =
  | PlayerResponseMsg
  | SurrenderMsg
  | RematchRequestMsg
  | RequestStateSyncMsg
  | ActivityPingMsg;
