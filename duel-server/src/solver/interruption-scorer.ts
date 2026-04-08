// =============================================================================
// interruption-scorer.ts — Board evaluation by interruption quality
// Scores terminal field states for the solver
// =============================================================================

import type { ZoneId } from '../ws-protocol.js';
import type {
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

const NON_FIELD_ZONES: ReadonlySet<ZoneId> = new Set(['GY', 'BANISHED', 'EXTRA', 'DECK', 'HAND']);

/** Monster zones — eligible for fallback heuristic. */
const MONSTER_ZONE_IDS: readonly ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R'];

/** All 13 field zones — scanned for tag-based scoring. Derived from ALL_ZONE_IDS. */
const FIELD_ZONE_IDS: readonly ZoneId[] = ALL_ZONE_IDS.filter(z => !NON_FIELD_ZONES.has(z));

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

  score(fieldState: FieldState): { score: number; scoreBreakdown: ScoreBreakdown } {
    const { score, scoreBreakdown } = this.scoreWithCards(fieldState);
    return { score, scoreBreakdown };
  }

  scoreWithCards(fieldState: FieldState): { score: number; scoreBreakdown: ScoreBreakdown; endBoardCards: EndBoardCard[] } {
    const breakdown: ScoreBreakdown = {
      omniNegate: 0, typedNegate: 0, targetedNegate: 0, floodgate: 0,
      controlChange: 0, banish: 0, banishFacedown: 0, attach: 0,
      spin: 0, flipFacedown: 0, destruction: 0, moveToSt: 0,
      bounce: 0, handRip: 0, sendToGy: 0, total: 0,
    };

    let total = 0;
    const endBoardCards: EndBoardCard[] = [];
    const isMonsterZone = new Set(MONSTER_ZONE_IDS);

    for (const zoneId of FIELD_ZONE_IDS) {
      const cards = fieldState.zones[zoneId];
      for (const card of cards) {
        const isFaceDown = card.position === 'facedown-def' || card.position === 'facedown';
        const tag = this.tags[card.cardId];
        if (tag) {
          for (const effect of tag.effects) {
            breakdown[effect.type] += effect.usesPerTurn;
            total += this.weights[effect.type] * effect.usesPerTurn;
          }
          // Face-down tagged cards score but are not shown on the end board
          if (!isFaceDown) {
            endBoardCards.push({
              cardId: card.cardId,
              cardName: card.cardName,
              position: card.position,
              zone: zoneId,
              effects: tag.effects,
              isFallback: false,
            });
          }
        } else if (
          isMonsterZone.has(zoneId) &&
          (card.position === 'faceup-atk' || card.position === 'faceup-def')
        ) {
          // Fallback heuristic: face-up monster, no tag
          total += 1;
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

    breakdown.total = total;
    return { score: total, scoreBreakdown: breakdown, endBoardCards };
  }
}
