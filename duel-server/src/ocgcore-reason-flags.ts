// =============================================================================
// ocgcore-reason-flags.ts — back mirror (β.3 cas #12 R9 fix, 2026-05-26)
// -----------------------------------------------------------------------------
// OCGCore reason bitfield constants. Source de vérité authoritative :
// `duel-server/data/scripts_full/constant.lua:125-152`.
//
// Miroir back de `front/src/app/pages/pvp/duel-page/ocgcore-reason-flags.ts`.
// Les valeurs sont strictement identiques aux macros C OCGCore exposées par
// `@n1xx1/ocgcore-wasm` sur `OcgQueryFlags.REASON`.
//
// ⚠️ Historique (R9 spec cas #12) — `game-log-builder.ts`,
// `replay-precompute.ts` ET `front/src/app/pages/pvp/game-log/game-log-builder.ts`
// déclaraient leur propres constantes locales avec des valeurs FAUSSES
// (REASON_FUSION=0x8 au lieu de 0x40000, REASON_XYZ=0x40 au lieu de 0x200000,
// REASON_LINK=0x80 au lieu de 0x10000000, etc.). Conséquence : toutes les
// branches Fusion/Synchro/XYZ/Link/Ritual des labels de summon ne se
// déclenchaient JAMAIS en prod (le `reason` émis par le wasm est la VRAIE
// valeur, qui &-mask jamais avec les fausses constantes locales). Les specs
// validaient le bug avec des fixtures portant les fausses valeurs aussi.
// Fix : un module unique back + un miroir front, plus de constantes locales.
// =============================================================================

export const REASON_DESTROY     = 0x1;
export const REASON_RELEASE     = 0x2;        // Tribute
export const REASON_TEMPORARY   = 0x4;
export const REASON_MATERIAL    = 0x8;        // Used as material (synchro/xyz/link/fusion)
export const REASON_SUMMON      = 0x10;
export const REASON_BATTLE      = 0x20;
export const REASON_EFFECT      = 0x40;
export const REASON_COST        = 0x80;
export const REASON_ADJUST      = 0x100;
export const REASON_LOST_TARGET = 0x200;
export const REASON_RULE        = 0x400;
export const REASON_SPSUMMON    = 0x800;
export const REASON_DISSUMMON   = 0x1000;
export const REASON_FLIP        = 0x2000;
export const REASON_DISCARD     = 0x4000;
export const REASON_RDAMAGE     = 0x8000;
export const REASON_RRECOVER    = 0x10000;
export const REASON_RETURN      = 0x20000;
export const REASON_FUSION      = 0x40000;
export const REASON_SYNCHRO     = 0x80000;
export const REASON_RITUAL      = 0x100000;
export const REASON_XYZ         = 0x200000;
export const REASON_REPLACE     = 0x1000000;
export const REASON_DRAW        = 0x2000000;
export const REASON_REDIRECT    = 0x4000000;
export const REASON_LINK        = 0x10000000;

/** Composite mask — Extra Deck summon families (Fusion/Synchro/XYZ/Link). */
export const EXTRA_DECK_SUMMON =
  REASON_FUSION | REASON_SYNCHRO | REASON_XYZ | REASON_LINK;

/**
 * β.3 cas #12 — exact mask OCGCore émet pour le settling position des
 * ex-matériaux d'XYZ une fois l'XYZ parti
 * (`GRAVE → GRAVE reason = REASON_RULE | REASON_LOST_TARGET = 0x600`).
 */
export const REASON_XYZ_MATERIAL_SETTLE = REASON_RULE | REASON_LOST_TARGET; // 0x600
