// =============================================================================
// game-log-types.ts — Game Log entry model (pure types, zero behavior)
// -----------------------------------------------------------------------------
// The five-block grammar from the game-log chantier (§4.2). Consumed by
// GameLogBuilder (producer), the Markdown renderer, and the HTML renderer.
//
// PURITY: this file imports ONLY protocol types. No replay/duel-worker/ws/fs.
// =============================================================================

import type { Player, ZoneId } from '../ws-protocol-shared.js';

/** Relative player index: 0 = the viewer ("you"), 1 = the opponent. */
export type RelPlayer = 0 | 1;

/**
 * A card thumbnail reference inside a log entry. `revealed: false` means
 * OCGCore did not disclose the identity (opponent draw, face-down banish);
 * the renderer shows a card back + "Carte non révélée". The builder NEVER
 * infers a hidden identity — `cardCode`/`cardName` stay null in that case.
 */
export interface LogCardRef {
  revealed: boolean;
  cardCode: number | null;
  cardName: string | null;
}

/** One displaced card inside a move-row body: card + verb + destination. */
export interface MovedCard {
  card: LogCardRef;
  /** French verb naming the displacement (`Pioche`, `Ajout`, `Défausse`, …). */
  verb: string;
  /**
   * Short label of the zone the card LEFT (`DECK`, `MAIN`, `GY`, `M3`, …).
   * Used by the bare-row renderer to draw a `source → dest` flow. Absent when
   * the origin is unknown / not meaningful (the initial-hand variant).
   */
  fromZone?: string;
  /** Destination zone label for a pile target (`MAIN`, `GY`, `BANNIE`, …). */
  destZone?: string;
  /**
   * On-field destination cell, when the card lands on the board. Encodes the
   * absolute owner + monster/spell row + sequence so the renderer can paint
   * the full mini-board grid. Absent for pile destinations.
   */
  destCell?: BoardCell;
  /** True when this moved card is an Extra-Deck summon material. */
  isMaterial?: boolean;
  /**
   * Position change (`MSG_CHANGE_POS`) — the before/after battle posture.
   * Each side is 'ATK' or 'DEF' so the renderer can give each its distinct
   * visual identity (offensive vs defensive). When set, the renderer shows a
   * posture transition instead of a plain verb.
   */
  posChange?: { from: PostureKind; to: PostureKind };
}

/** A monster's battle posture — drives the ATK/DEF visual distinction. */
export type PostureKind = 'ATK' | 'DEF';

/** A single field cell reference for the mini-board grid renderer. */
export interface BoardCell {
  /** Relative owner of the cell (0 = your half, 1 = opponent half). */
  player: RelPlayer;
  /**
   * 'M' = monster row, 'S' = spell/trap row, 'EMZ' = shared Extra zone,
   * 'FIELD' = the single Field Spell cell (SZONE sequence 5, out of the
   * 5-slot spell/trap row).
   */
  row: 'M' | 'S' | 'EMZ' | 'FIELD';
  /** 0-based sequence within the row. 0 for the singleton 'FIELD' cell. */
  sequence: number;
}

// =============================================================================
// Block kind 1 — Separators
// =============================================================================

export type SeparatorKind =
  | 'decision'   // pre-duel: "X a choisi de jouer en premier/second"
  | 'turn'       // turn boundary, both players' LP
  | 'phase'      // phase boundary
  | 'chain-start'
  | 'chain-resolve'
  | 'chain-end'
  | 'duel-over';

/**
 * A separator entry. Language-agnostic (O9): the builder emits stable i18n
 * keys, never French strings — the renderer translates.
 *
 * Per-kind label policy (audited per `SeparatorKind`, Lot 0c):
 *   - `phase` / `chain-start` / `chain-resolve` / `chain-end` — **key-pure**:
 *     `labelKey` is a self-sufficient i18n key, no interpolation needed.
 *   - `turn` — **structured**: no `labelKey`; the renderer composes
 *     "Tour {{n}}" from a fixed i18n key + the `turnNumber` field carried here.
 *   - `duel-over` — **structured**: no `labelKey`; the renderer composes the
 *     winner line from `winnerSide` and the win-reason line from `reasonKey`.
 *   - `decision` — **structured**: never emitted by the current builder; if a
 *     future decision separator is added it carries its own structured fields
 *     (a pure key cannot interpolate the chooser's pseudo). No `labelKey`.
 */
export interface SeparatorEntry {
  block: 'separator';
  kind: SeparatorKind;
  /**
   * Stable i18n key for the separator label — key-pure kinds only
   * (`phase`, `chain-start`, `chain-resolve`, `chain-end`). Absent for the
   * structured kinds (`turn`, `duel-over`, `decision`) whose label needs
   * interpolation and is composed by the renderer.
   */
  labelKey?: string;
  /** Turn separator only — both players' LP, in relative order [you, opp]. */
  lp?: [number, number];
  /** Turn separator only — the turn number (the renderer composes "Tour N"). */
  turnNumber?: number;
  /** `duel-over` separator only — the relative side that won the duel. */
  winnerSide?: RelPlayer;
  /** `duel-over` separator only — i18n key of the win-reason line. */
  reasonKey?: string;
}

// =============================================================================
// Shared row head — every non-separator row carries it
// =============================================================================

/**
 * The universal 3-part row anatomy: a source-card header, an effect
 * description, and a type-specific body. The source card is the card that
 * ACTIVATED the effect — always revealed (an activation is public). It is
 * `null` only for rows with no originating card (the mandatory Draw-Phase
 * draw, the initial 5-card hand).
 */
export interface RowHead {
  /** Relative player who owns/controls the acting card. */
  player: RelPlayer;
  /** Turn number this row belongs to (for turn grouping). */
  turnNumber: number;
  /** The activating card. Null = no originating card (rule-driven draw). */
  source: LogCardRef | null;
  /** Resolved effect text. Null when there is no source. */
  description: string | null;
  /** 1-based chain link number when the row is part of a chain. */
  chainLink?: number;
  /** True when MSG_CHAIN_NEGATED marked this link. */
  negated?: boolean;
  /**
   * Cards this effect targets (`MSG_BECOME_TARGET`). Rendered as a discreet
   * "▸ cible : …" annotation under the effect description — a targeting is a
   * property of the effect, not a standalone log row. An unresolvable target
   * appears as a hidden `LogCardRef`.
   */
  targets?: LogCardRef[];
}

// =============================================================================
// Block kind 2 — Move rows
// =============================================================================

export interface MoveEntry extends RowHead {
  block: 'move';
  /** The displaced cards. Empty for the initial-hand / draw-phase variants. */
  movedCards: MovedCard[];
  /**
   * Special variant flags. `initial-hand` = the opening 5 cards (no head).
   * `draw-phase` = the mandatory turn draw (no head). Absent = normal move.
   */
  variant?: 'initial-hand' | 'draw-phase';
}

// =============================================================================
// Block kind 3 — RNG rows
// =============================================================================

export interface RngEntry extends RowHead {
  block: 'rng';
  rng: 'coin' | 'dice';
  /** Coin: 'Face' | 'Pile' per toss. Dice: '1'..'6' per roll. */
  results: string[];
}

// =============================================================================
// Block kind 4 — Combat rows
// =============================================================================

export interface CombatSide {
  card: LogCardRef;
  /** Pre-formatted stat line, e.g. "ATK 2400" / "DEF 1900". */
  stat?: string;
  /** Post-battle outcome, e.g. "détruit" / "0". */
  outcome?: string;
}

export interface CombatEntry extends RowHead {
  block: 'combat';
  combat: 'attack' | 'battle';
  attacker: CombatSide;
  /** Absent = direct attack. */
  defender?: CombatSide;
  /** Direct-attack label (plain text — the renderer supplies the icon). */
  directLabel?: string;
  /**
   * Life-point loss this combat inflicted, one entry per affected player.
   * Empty/absent = no LP changed hands — the renderer shows NOTHING. A
   * combat can damage both players at once (e.g. a double-KO), so this is a
   * list, not a single field.
   */
  lpLoss?: LpLoss[];
}

/** One player's life-point loss from a combat. */
export interface LpLoss {
  /** Relative player who lost the LP (0 = you, 1 = opponent). */
  player: RelPlayer;
  /** Positive amount of LP lost. */
  amount: number;
}

// =============================================================================
// Block kind 5 — Action rows
// =============================================================================

export interface ActionEntry extends RowHead {
  block: 'action';
  action:
    | 'counter-add'
    | 'counter-remove'
    | 'equip'
    | 'gy-deck-swap'
    | 'shuffle'
    | 'swap';
  /** i18n key naming the action (`gameLog.action.counter`, `…equip`, …). */
  labelKey: string;
  /** Counter rows — the signed badge text, e.g. "+2" / "−1". */
  counterBadge?: string;
  /**
   * Counter rows — the OCGCore counter-type code. The builder only knows the
   * numeric type, so the renderer composes "Type {{n}}" from a fixed i18n key
   * + this number (structured interpolation, O9). Absent for non-counter rows.
   */
  counterType?: number;
  /** Equip rows — the affected card thumbnails. */
  equipTargets?: LogCardRef[];
}

// =============================================================================
// The discriminated union
// =============================================================================

export type GameLogEntry =
  | SeparatorEntry
  | MoveEntry
  | RngEntry
  | CombatEntry
  | ActionEntry;

/** Re-export for renderers that need the board zone vocabulary. */
export type { Player, ZoneId };
