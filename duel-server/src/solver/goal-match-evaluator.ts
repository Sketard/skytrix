// =============================================================================
// goal-match-evaluator.ts — Strategic Grammar v1 goal evaluator
// Pure function: FieldState + active ArchetypeExpertise[] → matched bonus
// Called by InterruptionScorer; wholly side-effect-free so DFS recursion is safe.
// =============================================================================

import type { ZoneId } from '../ws-protocol.js';
import type { FieldCard, FieldState } from './solver-types.js';
import type {
  ArchetypeExpertise,
  CardSelector,
  CardSlot,
  ComboGoal,
  ZoneKind,
} from './strategic-grammar.js';

const ZONE_IDS_BY_KIND: Readonly<Record<ZoneKind, readonly ZoneId[]>> = {
  monster: ['M1', 'M2', 'M3', 'M4', 'M5'],
  spellTrap: ['S1', 'S2', 'S3', 'S4', 'S5'],
  field: ['FIELD'],
  extraMonster: ['EMZ_L', 'EMZ_R'],
  // Lever 2 (2026-04-21): pile zones for progress-state goals.
  gy: ['GY'],
  hand: ['HAND'],
  banished: ['BANISHED'],
  deck: ['DECK'],
};

/** Zones from which a card can still be played to fulfill a goal slot.
 *  Excludes BANISHED (hard to recover from) — generous but not absurdly so. */
const REACHABLE_ZONES: readonly ZoneId[] = [
  'HAND', 'DECK', 'GY', 'EXTRA',
  'M1', 'M2', 'M3', 'M4', 'M5',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'FIELD', 'EMZ_L', 'EMZ_R',
];

export interface GoalMatchResult {
  totalPoints: number;
  bestGoalId?: string;
  bestGoalRatio?: number;
}

/** Evaluate all goals across all active expertise against the current state.
 *  Returns Σ(goal.baselineScore × matchRatio) where matchRatio ∈ [0, 1] is the
 *  fraction of `required` CardSlots present on board. Partial matches are
 *  awarded proportionally — DFS sees the gradient as it progresses through a
 *  combo line. */
export function evaluateGoalMatch(
  state: FieldState,
  expertise: readonly ArchetypeExpertise[],
): GoalMatchResult {
  if (expertise.length === 0) return { totalPoints: 0 };

  let totalPoints = 0;
  let bestGoalId: string | undefined;
  let bestGoalRatio = 0;

  for (const e of expertise) {
    for (const goal of e.goals) {
      const ratio = computeGoalRatio(state, goal, e);
      if (ratio <= 0) continue;
      totalPoints += goal.baselineScore * ratio;
      if (ratio > bestGoalRatio) {
        bestGoalRatio = ratio;
        bestGoalId = goal.id;
      }
    }
  }

  return { totalPoints, bestGoalId, bestGoalRatio };
}

function computeGoalRatio(
  state: FieldState,
  goal: ComboGoal,
  expertise: ArchetypeExpertise,
): number {
  const total = goal.required.length;
  if (total === 0) return 0;

  let matched = 0;
  for (const slot of goal.required) {
    if (slotMatches(state, slot, expertise)) matched++;
  }
  return matched / total;
}

/** Upper bound on the goalMatchPoints gain still achievable from the current
 *  state. For each goal, sum `(reachable_slots / total_slots) × baselineScore`
 *  across the whole expertise list, then subtract the currently-awarded
 *  points. Used by DFS α-β pruning (Phase I) to avoid cutting subtrees that
 *  could still complete a grammar goal.
 *
 *  "Reachable" = each required CardSlot has at least one candidate card
 *  present in a non-banished zone. Generous upper bound — we'd rather
 *  miss a cut than eliminate a path to a grammar goal. */
export function goalMatchReachableUpperBound(
  state: FieldState,
  expertise: readonly ArchetypeExpertise[],
  currentGoalMatchPoints: number,
): number {
  if (expertise.length === 0) return 0;

  let totalReachablePoints = 0;
  for (const e of expertise) {
    for (const goal of e.goals) {
      const total = goal.required.length;
      if (total === 0) continue;
      let reachable = 0;
      for (const slot of goal.required) {
        if (slotReachable(state, slot, e)) reachable++;
      }
      totalReachablePoints += (reachable / total) * goal.baselineScore;
    }
  }

  return Math.max(0, totalReachablePoints - currentGoalMatchPoints);
}

/** A CardSlot is "reachable" when at least one candidate card is still in a
 *  non-banished zone of the game state. Does not account for OPT constraints,
 *  tribute costs, or summoning restrictions — intentionally loose. */
function slotReachable(
  state: FieldState,
  slot: { card: CardSelector },
  expertise: ArchetypeExpertise,
): boolean {
  for (const zoneId of REACHABLE_ZONES) {
    const cards = state.zones[zoneId];
    if (!cards || cards.length === 0) continue;
    for (const card of cards) {
      if (selectorMatches(card, slot.card, expertise)) return true;
    }
  }
  return false;
}

function slotMatches(
  state: FieldState,
  slot: CardSlot,
  expertise: ArchetypeExpertise,
): boolean {
  const zones = ZONE_IDS_BY_KIND[slot.zone];
  for (const zoneId of zones) {
    const cards = state.zones[zoneId];
    if (!cards || cards.length === 0) continue;
    for (const card of cards) {
      if (!selectorMatches(card, slot.card, expertise)) continue;
      if (slot.position !== undefined && !positionMatches(card, slot.position)) continue;
      return true;
    }
  }
  return false;
}

function selectorMatches(
  card: FieldCard,
  selector: CardSelector,
  expertise: ArchetypeExpertise,
): boolean {
  switch (selector.kind) {
    case 'specific':
      return card.cardId === selector.cardId;
    case 'anyOf':
      return selector.cardIds.includes(card.cardId);
    case 'role': {
      const roles = expertise.roleMap[card.cardId];
      return roles !== undefined && roles.includes(selector.role);
    }
  }
}

function positionMatches(
  card: FieldCard,
  wanted: 'faceup-atk' | 'faceup-def' | 'facedown',
): boolean {
  if (wanted === 'facedown') {
    return card.position === 'facedown-def' || card.position === 'facedown';
  }
  return card.position === wanted;
}
