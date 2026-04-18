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
//   F2 — Tutor Chain Potency        (SHIPPED S1.3)
//   F3 — Extra Deck Material Pool   (SHIPPED S1.4)
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

  /** Phase D V1 latent-interruption discount (0..1). Migrated from the
   *  hardcoded `LATENT_DISCOUNT = 0.5` const (see `latent-interruption-
   *  computer.ts`) so the value is tunable via `structural-weights.json`
   *  by the step-3 ES/grid sweep. */
  latentDiscount: number;

  _validated?: boolean;
  _notes?: string;
}

export interface StructuralTutorCardEntry {
  name: string;
  weight: number;
  archetype: string;
  role: 'combo-starter' | 'engine-glue' | 'utility';
}

export interface StructuralTutorCards {
  /** cardId (as string) → entry */
  cards: Record<string, StructuralTutorCardEntry>;
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

/** Tutors fire from the hand (activate/normal-summon path) or from the
 *  field (on-summon / ignition triggers). GY-only effects are rare in v1
 *  scope and excluded. Pendulum Zone (S1/S5) is included since Scales
 *  can tutor on activation. */
const TUTOR_SCAN_ZONES: readonly ZoneId[] = [
  'HAND',
  'M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
  'S1', 'S2', 'S3', 'S4', 'S5',
];

/** Monster zones eligible as Xyz/Link/Synchro/Fusion material. */
const MATERIAL_ZONES: readonly ZoneId[] = [
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
// F2 — Tutor Chain Potency
// =============================================================================

/**
 * Scores states where a known tutor (from the curated whitelist) is
 * present and its effect is still fresh (not in `activationLog`). This
 * rewards intermediate states where DFS has set up a multi-step tutor
 * chain — the signal the audit identified as missing for the Ryzeal
 * Saji → Mitsurugi Ritual → Futsu summon line.
 *
 * V1 simplification: "fresh" means `activationLog` has no entries for
 * this cardId. A single consumed effect marks the card as spent for
 * scoring purposes, even if the card has multiple effects with separate
 * OPTs — the over-conservative gate is fine for v1 because tutors we
 * whitelist typically have a single tutor effect per turn.
 *
 * Dedup: same cardId in multiple zones (rare — e.g. Pendulum-summoned
 * copies in EMZ and MZ) counts once to avoid multi-copy inflation.
 */
function computeF2TutorChain(
  fieldState: FieldState,
  activationLog: ActivationLog | undefined,
  tutorCards: StructuralTutorCards | undefined,
  weights: StructuralWeights,
): number {
  if (weights.F2_W === 0 || tutorCards === undefined) return 0;

  const seen = new Set<number>();
  let totalWeight = 0;

  for (const zoneId of TUTOR_SCAN_ZONES) {
    const cards = fieldState.zones[zoneId];
    for (const card of cards) {
      if (seen.has(card.cardId)) continue;
      const entry = tutorCards.cards[String(card.cardId)];
      if (!entry) continue;

      // OPT-fresh gate: any prior activation marks the card as spent.
      const consumed = activationLog?.get(card.cardId) ?? [];
      if (consumed.length > 0) continue;

      seen.add(card.cardId);
      totalWeight += entry.weight;
    }
  }

  const raw = weights.F2_W * totalWeight;
  return Math.min(raw, weights.F2_CAP);
}

// =============================================================================
// F3 — Extra Deck Material Pool Accessibility
// =============================================================================

/**
 * Scores states with face-up MAIN-DECK monsters on MZONE whose level
 * pairings unlock extra-deck summons (Rank-N Xyz, Link-2). Extra deck
 * monsters already on field (Xyz/Synchro/Fusion/Link) are excluded —
 * they're end products, not materials for further F3 opportunities.
 *
 * V1 simplification — measures only two opportunity kinds:
 *   1. Same-level pairs → 1 Rank-N Xyz opportunity per pair
 *   2. ≥2 monsters of any level → 1 Link-2 opportunity
 * Synchro opportunities (tuner + non-tuner level match) are deferred.
 *
 * The raw opportunity count is passed through log2(1+n) to dampen
 * board-spam inflation — 1 opportunity = 1 raw unit, 2 = 1.58, 4 = 2.32,
 * 15 = 4. Then multiplied by F3_W and capped at F3_CAP.
 */
function computeF3ExtraDeckMaterial(
  fieldState: FieldState,
  cardMetadata: CardMetadataMap,
  weights: StructuralWeights,
): number {
  if (weights.F3_W === 0) return 0;

  const levelToCount = new Map<number, number>();
  let materialMonsterCount = 0;

  for (const zoneId of MATERIAL_ZONES) {
    const cards = fieldState.zones[zoneId];
    for (const card of cards) {
      const isFaceUp = card.position === 'faceup-atk' || card.position === 'faceup-def';
      if (!isFaceUp) continue;
      const meta = cardMetadata.get(card.cardId);
      if (!meta || !meta.isMonster) continue;
      // Extra deck monsters already on field are end products; excluding
      // them keeps F3 a measure of FUTURE combo-expansion potential.
      if (meta.isExtraDeckMonster) continue;

      materialMonsterCount++;
      const level = meta.level || 0;
      if (level > 0) {
        levelToCount.set(level, (levelToCount.get(level) ?? 0) + 1);
      }
    }
  }

  let opportunities = 0;

  // Rank-N Xyz opportunities: one per same-level pair.
  for (const count of levelToCount.values()) {
    opportunities += Math.floor(count / 2);
  }

  // Link-2 opportunity: any two monsters on field cover this.
  if (materialMonsterCount >= 2) opportunities += 1;

  if (opportunities === 0) return 0;

  const raw = weights.F3_W * Math.log2(1 + opportunities);
  return Math.min(raw, weights.F3_CAP);
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
  activationLog: ActivationLog | undefined,
  cardMetadata: CardMetadataMap | undefined,
  weights: StructuralWeights,
  tutorCards?: StructuralTutorCards,
): StructuralComputeResult {
  if (cardMetadata === undefined) return EMPTY_RESULT;
  if (fieldState.turn !== 1) return EMPTY_RESULT;

  const F1 = computeF1RitualUnlock(fieldState, cardMetadata, weights);
  const F2 = computeF2TutorChain(fieldState, activationLog, tutorCards, weights);
  const F3 = computeF3ExtraDeckMaterial(fieldState, cardMetadata, weights);
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
