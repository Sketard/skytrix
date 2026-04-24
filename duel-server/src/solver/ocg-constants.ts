// =============================================================================
// ocg-constants.ts — OCGCore enum mappings and adapter-wide constants.
// Split out of ocgcore-adapter.ts so the adapter owns behavior and this
// module owns pure data. Importable by the field-query helpers without
// pulling the whole adapter surface.
// =============================================================================

import { OcgPosition, OcgMessageType } from '@n1xx1/ocgcore-wasm';
import type { Phase } from '../ws-protocol.js';
import type { FieldCard, PromptType } from './solver-types.js';

/** Player team constants. The solver always plays team 0 (PLAYER); the
 *  opponent is team 1 (OPPONENT). */
export const PLAYER = 0 as const;
export const OPPONENT = 1 as const;

/** Filler card for opponent deck in goldfish mode — vanilla Alexandrite
 *  Dragon (Lv4 beater with no effects). Intentionally low-impact so it
 *  doesn't interfere with the player's combo line. */
export const FILLER_CARD = 43096270;

/** OCGCore phase bitmask → our canonical Phase string. */
export const PHASE_MAP: Record<number, Phase> = {
  0x01: 'DRAW',
  0x02: 'STANDBY',
  0x04: 'MAIN1',
  0x08: 'BATTLE_START',
  0x10: 'BATTLE_STEP',
  0x20: 'DAMAGE',
  0x40: 'DAMAGE_CALC',
  0x80: 'BATTLE',
  0x100: 'MAIN2',
  0x200: 'END',
};

/** OCGCore position enum → our canonical FieldCard.position union.
 *  Handles the discrete monster positions (1/2/4/8) AND the combined values
 *  used for SZONE cards: POS_FACEUP=5 (FACEUP_ATTACK|FACEUP_DEFENSE) and
 *  POS_FACEDOWN=10 (FACEDOWN_ATTACK|FACEDOWN_DEFENSE). MoveToField uses the
 *  combined forms when placing cards in spell/trap zone, so without these
 *  the position falls back to 'facedown' and breaks produces matching for
 *  bridges that place cards face-up in SZONE (e.g. Poplar.e4 → Diabellstar). */
export const POSITION_MAP: Record<number, FieldCard['position']> = {
  [OcgPosition.FACEUP_ATTACK]: 'faceup-atk',
  [OcgPosition.FACEUP_DEFENSE]: 'faceup-def',
  [OcgPosition.FACEDOWN_DEFENSE]: 'facedown-def',
  [OcgPosition.FACEDOWN_ATTACK]: 'facedown',
  [OcgPosition.FACEUP]: 'faceup-atk',     // 5 — SZONE face-up convention
  [OcgPosition.FACEDOWN]: 'facedown',     // 10 — SZONE face-down convention
};

/** OCGCore SELECT_* message types → our PromptType string union. */
export const MESSAGE_TO_PROMPT: Record<number, PromptType> = {
  [OcgMessageType.SELECT_IDLECMD]: 'SELECT_IDLECMD',
  [OcgMessageType.SELECT_BATTLECMD]: 'SELECT_BATTLECMD',
  [OcgMessageType.SELECT_CHAIN]: 'SELECT_CHAIN',
  [OcgMessageType.SELECT_EFFECTYN]: 'SELECT_EFFECTYN',
  [OcgMessageType.SELECT_YESNO]: 'SELECT_YESNO',
  [OcgMessageType.SELECT_OPTION]: 'SELECT_OPTION',
  [OcgMessageType.SELECT_CARD]: 'SELECT_CARD',
  [OcgMessageType.SELECT_UNSELECT_CARD]: 'SELECT_UNSELECT_CARD',
  [OcgMessageType.SELECT_POSITION]: 'SELECT_POSITION',
  [OcgMessageType.SELECT_PLACE]: 'SELECT_PLACE',
  [OcgMessageType.SELECT_TRIBUTE]: 'SELECT_TRIBUTE',
  [OcgMessageType.SELECT_SUM]: 'SELECT_SUM',
  [OcgMessageType.SELECT_COUNTER]: 'SELECT_COUNTER',
  [OcgMessageType.SELECT_DISFIELD]: 'SELECT_DISFIELD',
};

/** Set of SELECT_* message type numeric IDs — fast-path check in
 *  `runUntilPlayerPrompt`. */
export const SELECT_MSG_TYPES: ReadonlySet<number> = new Set(
  Object.keys(MESSAGE_TO_PROMPT).map(Number),
);
