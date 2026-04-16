// =============================================================================
// structural-value-computer.ts — step 1 structural value function.
//
// Augments `InterruptionScorer` with features that capture combo-enabling
// LATENT value: states that do not yet have high direct interruption value
// but are structurally close to a canonical combo completion.
//
// Motivation (2026-04-16 Ryzeal audit): the scorer was myopically pruning
// multi-step tutor chains (Prayers→Saji→Ritual→Futsu) because intermediate
// states scored ≈ 0 while the fixture-match bonus rewarded Futsu-in-hand
// states that were dead ends. This module scores intermediate states for
// their structural potential.
//
// Features (S1.2+ sub-phases):
//   F1 — Ritual Unlock Co-Presence  (SHIPPED S1.2)
//   F2 — Tutor Chain Potency        (planned S1.5)
//   F3 — Extra Deck Material Pool   (planned S1.4)
//   F4 — (dropped — redundant with existing OPT-aware scoring)
//
// Design: deck-agnostic, reads from `CardMetadataMap` (pre-computed at
// scorer construction) rather than hardcoding card IDs. Gated on
// `turn === 1` per ADR-S1-3. Additive composition (no EHS formula). Global
// cap prevents runaway interaction.
//
// =============================================================================

import type { ZoneId } from '../ws-protocol.js';
import type { FieldState, ActivationLog } from './solver-types.js';
import type { CardMetadataMap } from './card-metadata.js';

// =============================================================================
// Weights Schema
// =============================================================================

export interface StructuralWeights {
  F1_W: number;
  F1_CAP: number;
  F1_tributeFodderBonus: number;

  F2_W: number;
  F2_CAP: number;

  F3_W: number;
  F3_CAP: number;

  F4_W: number;
  F4_CAP: number;

  globalCap: number;

  _validated?: boolean;
  _notes?: string;
}

export interface StructuralComputeResult {
  featureScores: {
    F1_ritualUnlock: number;
    F2_tutorChain: number;
    F3_materialPool: number;
    F4_effectBudget: number;
  };
  totalStructural: number;
}

const EMPTY_RESULT: StructuralComputeResult = {
  featureScores: {
    F1_ritualUnlock: 0,
    F2_tutorChain: 0,
    F3_materialPool: 0,
    F4_effectBudget: 0,
  },
  totalStructural: 0,
};

// =============================================================================
// Zone Constants
// =============================================================================

/** Ritual monsters can be summoned from HAND or GY (some effects), and
 *  "having one on the field" also counts toward co-presence for chained
 *  ritual summons (e.g., Habakiri-if-tributed searches + SS-back). */
const RITUAL_MONSTER_SCAN_ZONES: readonly ZoneId[] = [
  'HAND', 'GY',
  'M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
];

/** Ritual spells are accessible from HAND (playable) and GY (recyclable via
 *  archetype-specific effects — Mitsurugi Mirror, Nekroz of Sophia, etc.). */
const RITUAL_SPELL_SCAN_ZONES: readonly ZoneId[] = [
  'HAND', 'GY', 'S1', 'S2', 'S3', 'S4', 'S5',
];

/** Zones to scan for tribute-fodder candidates (non-ritual monsters that
 *  can cover the ritual summon's tribute cost). */
const TRIBUTE_FODDER_ZONES: readonly ZoneId[] = [
  'HAND',
  'M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
];

// =============================================================================
// F1 — Ritual Unlock Co-Presence
// =============================================================================

/**
 * Scores states where a ritual monster and a compatible ritual spell are
 * both accessible — the state's latent combo-progress value for any
 * ritual-summon archetype (Mitsurugi, Drytron, Herald, Nekroz, Megalith,
 * Cyber Angel, etc.).
 *
 * V1 simplification: "compatible" means type-level (any ritual monster
 * with any ritual spell). A Drytron spell with a Mitsurugi monster is a
 * false positive but rare in practice — deck compositions usually keep
 * ritual families internally consistent. V1.1 could parse card desc for
 * explicit "You can Ritual Summon this card with 'X'" compatibility.
 *
 * Tribute fodder sub-bonus: +`F1_tributeFodderBonus` if at least one
 * non-ritual monster exists in HAND/MZONE (or a second ritual monster
 * exists — ritual monsters themselves can be tributed). This captures
 * "actually summonable" vs "theoretically summonable if tribute existed".
 */
function computeF1RitualUnlock(
  fieldState: FieldState,
  cardMetadata: CardMetadataMap,
  weights: StructuralWeights,
): number {
  if (weights.F1_W === 0) return 0;

  let ritualMonsterCount = 0;
  let nonRitualMonsterCount = 0;

  for (const zoneId of RITUAL_MONSTER_SCAN_ZONES) {
    const cards = fieldState.zones[zoneId];
    for (const card of cards) {
      const meta = cardMetadata.get(card.cardId);
      if (!meta) continue;
      if (meta.isRitualMonster) ritualMonsterCount++;
    }
  }
  if (ritualMonsterCount === 0) return 0;

  let ritualSpellCount = 0;
  for (const zoneId of RITUAL_SPELL_SCAN_ZONES) {
    const cards = fieldState.zones[zoneId];
    for (const card of cards) {
      const meta = cardMetadata.get(card.cardId);
      if (!meta) continue;
      if (meta.isRitualSpell) ritualSpellCount++;
    }
  }
  if (ritualSpellCount === 0) return 0;

  for (const zoneId of TRIBUTE_FODDER_ZONES) {
    const cards = fieldState.zones[zoneId];
    for (const card of cards) {
      const meta = cardMetadata.get(card.cardId);
      if (!meta) continue;
      if (meta.isMonster && !meta.isRitualMonster) nonRitualMonsterCount++;
    }
  }

  const coPresencePairs = Math.min(ritualMonsterCount, ritualSpellCount);
  let score = weights.F1_W * Math.min(coPresencePairs, weights.F1_CAP);

  // Tribute available when either a non-ritual monster exists, or two+
  // ritual monsters exist (one tributed for the other).
  const tributeAvailable = nonRitualMonsterCount > 0 || ritualMonsterCount >= 2;
  if (tributeAvailable) score += weights.F1_tributeFodderBonus;

  return score;
}

// =============================================================================
// Public Entry Point
// =============================================================================

/**
 * Compute the total structural value bonus for a field state.
 *
 * Returns `EMPTY_RESULT` if:
 *   - `cardMetadata` is undefined (legacy callers / production before
 *      solver-worker wires metadata)
 *   - `fieldState.turn !== 1` (features are turn-1-gated per ADR-S1-3)
 *
 * The returned `totalStructural` is capped at `weights.globalCap` via
 * proportional scaling across features.
 */
export function computeStructuralValue(
  fieldState: FieldState,
  _activationLog: ActivationLog | undefined,
  cardMetadata: CardMetadataMap | undefined,
  weights: StructuralWeights,
): StructuralComputeResult {
  if (cardMetadata === undefined) return EMPTY_RESULT;
  if (fieldState.turn !== 1) return EMPTY_RESULT;

  const F1 = computeF1RitualUnlock(fieldState, cardMetadata, weights);
  const F2 = 0; // planned S1.5
  const F3 = 0; // planned S1.4
  const F4 = 0; // dropped

  const uncapped = F1 + F2 + F3 + F4;
  const totalStructural = Math.min(uncapped, weights.globalCap);

  return {
    featureScores: {
      F1_ritualUnlock: F1,
      F2_tutorChain: F2,
      F3_materialPool: F3,
      F4_effectBudget: F4,
    },
    totalStructural,
  };
}
