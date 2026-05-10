// =============================================================================
// duel-ws-shared.types.ts — Skytrix WS protocol — shared primitives + board
// Zero internal imports — copied verbatim from duel-server.
// Manual sync: front/src/app/pages/pvp/duel-ws-shared.types.ts ↔ duel-server/src/ws-protocol-shared.ts
// Update BOTH files in the same commit.
// =============================================================================

// =============================================================================
// Protocol Version
// =============================================================================

/**
 * WebSocket protocol version. Bumped whenever a breaking change to the wire
 * format ships (renamed/removed fields, semantic shift on existing fields,
 * new required handshake step). Additive changes (new optional fields,
 * new message types treated as unknown) do NOT require a bump.
 *
 * Both client and server pin this constant via the byte-synced
 * shared file. The client appends `?pv=${PROTOCOL_VERSION}` to every PvP,
 * replay, and solver WS handshake URL; the server compares and rejects
 * mismatches with close-code 4426 ("Upgrade Required" — analog to HTTP 426).
 *
 * Version log:
 *   1 — initial baseline (PvP + Replay shipped, MR5 board, chain overlay,
 *       chainIndex-tagged CONFIRM_CARDS, boardStateAfter snapshots).
 */
export const PROTOCOL_VERSION = 1;

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

export const PHASE_TO_NUM: Record<Phase, number> = {
  DRAW: 1, STANDBY: 2, MAIN1: 4, BATTLE_START: 8,
  BATTLE_STEP: 16, DAMAGE: 32, DAMAGE_CALC: 64,
  BATTLE: 128, MAIN2: 256, END: 512,
};

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

/**
 * Persistent link from one card on the field to another, exposed via the
 * server's BOARD_STATE so the client can render visual ties (highlights,
 * arrows) between linked cards. Two sources today, merged here:
 *
 *  - `'equip'`: an Equip Spell pointing at the monster it equips (from the
 *    spell side; OCGCore exposes this via `OcgQueryFlags.EQUIP_CARD`).
 *  - `'target'`: a persistent effect-target relation (Number 39 Utopia ↔ its
 *    chased materials, Chaos Hunter ↔ banished tracking, "until end phase"
 *    targets, the equipped monster's view of which spells equip it, etc.;
 *    OCGCore exposes this via `OcgQueryFlags.TARGET_CARD`).
 */
export interface LinkedCardRef {
  kind: 'equip' | 'target';
  controller: 0 | 1;
  location: number;
  sequence: number;
}

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
  /**
   * Live `OcgType` bitmask — what the card *currently* is on the field,
   * including type alterations (Effect/Tuner/Synchro/Xyz/Link/Pendulum/
   * Flip/etc. flags that effects can grant or remove). Distinct from
   * `baseType` (the printed type from the card DB).
   */
  currentType?: number;
  /** Printed `OcgType` bitmask from the card DB. */
  baseType?: number;
  isLink?: boolean;
  isEffectNegated?: boolean;
  /** Persistent links to other cards (equip + effect-target relations). */
  linkedCards?: LinkedCardRef[];
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
  /**
   * Tribute "release_param" value for SELECT_TRIBUTE entries — encodes the
   * effective tribute count this card provides (some cards count as 2 toward
   * a tribute summon's total). Absent for other prompt types.
   */
  releaseParam?: number;
}

export interface PlaceOption {
  player: Player;
  location: CardLocation;
  sequence: number;
}

/**
 * Message types whose logical effect on board state warrants a
 * `boardStateAfter` snapshot when emitted during a chain-resolving window,
 * AND which the client's `ChainResolutionManager` buffers+replays via the
 * chain overlay contract.
 *
 * Single source of truth shared between server (`duel-worker.ts` live duel
 * loop + replay precompute) and client (`chain-resolution-manager.ts`
 * buffering). Keep the contents in strict sync with any consumer that
 * reasons about "which events affect the board state during resolution".
 *
 * Two consumers gate on this set — adding a type affects BOTH:
 *  1. **Back-end snapshot attach** — `ChainSnapshotTracker.process` (in
 *     `chain-snapshot-tracker.ts`) attaches `boardStateAfter` when the
 *     event type is in this set AND the chain is resolving. Used by both
 *     `runDuelLoop` (live PvP) and `runReplayPreComputation`.
 *  2. **Front-end buffer-and-replay** — `bufferIfResolving` (in
 *     `animation-data-source.ts`) routes the event into
 *     `ChainResolutionManager._bufferedBoardEvents` for replay after the
 *     chain overlay hides.
 *
 * Remove a type and you silently lose snapshots + replay coverage; add one
 * without updating handlers and you queue events the orchestrator can't
 * dispatch. See CLAUDE.md "Chain Event Processing & State Machine" §4.
 */
export const BOARD_CHANGING_EVENT_TYPES: ReadonlySet<string> = new Set([
  'MSG_MOVE', 'MSG_DRAW', 'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
  'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_SET',
  'MSG_SHUFFLE_HAND', 'MSG_CONFIRM_CARDS', 'MSG_SHUFFLE_DECK',
  'MSG_TOSS_COIN', 'MSG_TOSS_DICE', 'MSG_EQUIP',
  'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER', 'MSG_SHUFFLE_SET_CARD', 'MSG_SWAP_GRAVE_DECK',
]);
