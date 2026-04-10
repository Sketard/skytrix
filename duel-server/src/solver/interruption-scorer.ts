// =============================================================================
// interruption-scorer.ts — Board evaluation by interruption quality
// Scores terminal field states for the solver
// =============================================================================

import type { ZoneId } from '../ws-protocol.js';
import type {
  ActivationLog,
  EndBoardCard,
  FieldState,
  InterruptionTag,
  InterruptionType,
  ScoreBreakdown,
} from './solver-types.js';
import { ALL_ZONE_IDS, INTERRUPTION_TYPES } from './solver-types.js';

// =============================================================================
// Zone Constants (local to scorer)
// =============================================================================

/** Only DECK is excluded from scoring — cards not yet drawn are not
 *  usable interruptions. All other zones contribute:
 *  - MZONE/SZONE/FIELD/EMZ: on-board interruptions (primary)
 *  - HAND: remaining hand-traps post-combo (Ash Blossom, Nibiru, etc.)
 *  - GY: graveyard-active effects (Eldlich, Mirrorjade trigger, etc.)
 *  - BANISHED: banished-zone effects ("when this card is banished...")
 *  - EXTRA: face-up Pendulum monsters (recycled via Pendulum Summon)
 *  The fallback heuristic (+1 per untagged face-up monster) still only
 *  applies to MONSTER_ZONE_IDS — non-field tagged cards score but
 *  untagged cards in GY/HAND/BANISHED/EXTRA do not. */
const NON_SCORED_ZONES: ReadonlySet<ZoneId> = new Set(['DECK']);

/** Monster zones — eligible for fallback heuristic. */
const MONSTER_ZONE_IDS: readonly ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R'];

/** All scored zones — 13 field zones + HAND. */
const SCORED_ZONE_IDS: readonly ZoneId[] = ALL_ZONE_IDS.filter(z => !NON_SCORED_ZONES.has(z));

// =============================================================================
// InterruptionScorer
// =============================================================================

export class InterruptionScorer {
  private readonly tags: Record<string, InterruptionTag>;
  private readonly weights: Record<InterruptionType, number>;

  constructor(
    tags: Record<string, InterruptionTag>,
    weights: Record<InterruptionType, number>,
  ) {
    if (Object.keys(tags).length === 0) {
      throw new Error('[Solver] InterruptionScorer: tags must not be empty');
    }
    if (Object.keys(weights).length !== 15) {
      throw new Error(`[Solver] InterruptionScorer: expected 15 weight types, got ${Object.keys(weights).length}`);
    }
    this.tags = tags;
    this.weights = weights;
  }

  score(
    fieldState: FieldState,
    activationLog?: ActivationLog,
  ): { score: number; scoreBreakdown: ScoreBreakdown } {
    const { score, scoreBreakdown } = this.scoreWithCards(fieldState, activationLog);
    return { score, scoreBreakdown };
  }

  scoreWithCards(
    fieldState: FieldState,
    activationLog?: ActivationLog,
  ): { score: number; scoreBreakdown: ScoreBreakdown; endBoardCards: EndBoardCard[] } {
    const breakdown: ScoreBreakdown = {
      omniNegate: 0, typedNegate: 0, targetedNegate: 0, floodgate: 0,
      controlChange: 0, banish: 0, banishFacedown: 0, attach: 0,
      spin: 0, flipFacedown: 0, destruction: 0, moveToSt: 0,
      bounce: 0, handRip: 0, sendToGy: 0,
      weighted: 0, fallbackPoints: 0, total: 0,
    };

    let weighted = 0;
    let fallbackPoints = 0;
    const endBoardCards: EndBoardCard[] = [];
    const isMonsterZone = new Set(MONSTER_ZONE_IDS);

    for (const zoneId of SCORED_ZONE_IDS) {
      const cards = fieldState.zones[zoneId];
      const isHand = zoneId === 'HAND';
      for (const card of cards) {
        const isFaceDown = card.position === 'facedown-def' || card.position === 'facedown';
        const tag = this.tags[card.cardId];
        if (tag) {
          // Story 1.8: OPT-aware scoring. Read the activation log for this
          // card and decrement remaining uses per effect index. When no log
          // is supplied (legacy callers / tests), behavior matches pre-1.8.
          const consumedIndices = activationLog?.get(card.cardId) ?? [];
          const consumedTotal = consumedIndices.length;

          // Hard-OPT lockout for sharedOpt cards: if total consumed reaches
          // the shared budget, the card scores 0 across all effects.
          let sharedBudgetExhausted = false;
          if (tag.sharedOpt === true) {
            const budget = tag.totalUsesPerTurn ?? sumEffectUses(tag);
            if (consumedTotal >= budget) sharedBudgetExhausted = true;
          }

          if (!sharedBudgetExhausted) {
            for (let i = 0; i < tag.effects.length; i++) {
              const effect = tag.effects[i];
              const consumedCount = countOccurrences(consumedIndices, i);
              const remainingUses = Math.max(0, effect.usesPerTurn - consumedCount);
              if (remainingUses === 0) continue;
              breakdown[effect.type] += remainingUses;
              weighted += this.weights[effect.type] * remainingUses;
            }
          }

          // Face-down tagged cards on field are hidden from endBoard display.
          // Hand cards (always facedown in OCGCore) ARE shown — they represent
          // the player's remaining hand-trap interruptions post-combo.
          if (!isFaceDown || isHand) {
            const endCard: EndBoardCard = {
              cardId: card.cardId,
              cardName: card.cardName,
              position: card.position,
              zone: zoneId,
              effects: tag.effects,
              isFallback: false,
            };
            if (consumedTotal > 0) endCard.consumedUses = consumedTotal;
            endBoardCards.push(endCard);
          }
        } else if (
          isMonsterZone.has(zoneId) &&
          (card.position === 'faceup-atk' || card.position === 'faceup-def')
        ) {
          // Fallback heuristic: face-up monster, no tag.
          // Tracked separately from `weighted` so brick detection ignores it.
          fallbackPoints += 1;
          endBoardCards.push({
            cardId: card.cardId,
            cardName: card.cardName,
            position: card.position,
            zone: zoneId,
            effects: [],
            isFallback: true,
          });
        }
        // Face-down cards without tags are skipped (not visible on end board)
      }
    }

    const total = weighted + fallbackPoints;
    breakdown.weighted = weighted;
    breakdown.fallbackPoints = fallbackPoints;
    breakdown.total = total;
    return { score: total, scoreBreakdown: breakdown, endBoardCards };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function countOccurrences(arr: readonly number[], target: number): number {
  let n = 0;
  for (const v of arr) if (v === target) n++;
  return n;
}

function sumEffectUses(tag: InterruptionTag): number {
  let total = 0;
  for (const e of tag.effects) total += e.usesPerTurn;
  return total;
}
