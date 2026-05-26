// =============================================================================
// ocgcore-reason-flags.ts — β.3 cas #12 (2026-05-26)
// -----------------------------------------------------------------------------
// OCGCore reason bitfield constants. Source de vérité authoritative :
// `duel-server/data/scripts_full/constant.lua:125-152`.
//
// Isolé du fichier `animation-constants.ts` à dessein — la knowledge YGO
// (REASON_*) n'a rien à voir avec les durations d'animation. Cf. décision
// D2 architecture review β.3 cas #12.
//
// ⚠️ Le wasm `@n1xx1/ocgcore-wasm` émet ces valeurs telles quelles sur
// la query `OcgQueryFlags.REASON`. NE PAS confondre avec les constantes
// (fausses) déclarées dans `duel-server/src/game-log/game-log-builder.ts`
// et `duel-server/src/replay-precompute.ts` (REASON_FUSION=0x8 au lieu
// de 0x40000, REASON_XYZ=0x40 au lieu de 0x200000, etc.) — bug pré-
// existant orthogonal, signalé dans R9 spec cas #12.
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

/**
 * Cas #12 — exactement le mask émis par OCGCore pour le settling
 * position des ex-matériaux d'XYZ une fois l'XYZ parti
 * (`GRAVE → GRAVE reason = REASON_RULE | REASON_LOST_TARGET = 0x600`).
 *
 * À vérifier en pass 1 d'implémentation Commit 0bis (R1 spec) que la
 * valeur réelle émise correspond bien à `0x600` strict (et non un
 * mask incluant des bits supplémentaires).
 */
export const REASON_XYZ_MATERIAL_SETTLE = REASON_RULE | REASON_LOST_TARGET; // 0x600
