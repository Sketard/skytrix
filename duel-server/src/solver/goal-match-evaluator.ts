// =============================================================================
// goal-match-evaluator.ts — Strategic Grammar v1 goal evaluator
// Pure function: FieldState + active ArchetypeExpertise[] → matched bonus
// Called by InterruptionScorer; wholly side-effect-free so DFS recursion is safe.
// =============================================================================

import type { ZoneId } from '../ws-protocol.js';
import type { FieldCard, FieldState } from './solver-types.js';
import type {
  ArchetypeExpertise,
  BridgeSubroute,
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
  /** Phase B (2026-04-21): waypoints whose contribution was subsumed into an
   *  apex via a viable successor bridge. Debug/audit surface only. */
  subsumedWaypointIds?: readonly string[];
}

/** Evaluate all goals across all active expertise against the current state.
 *  Returns Σ(goal.baselineScore × matchRatio) where matchRatio ∈ [0, 1] is the
 *  fraction of `required` CardSlots present on board. Partial matches are
 *  awarded proportionally — DFS sees the gradient as it progresses through a
 *  combo line.
 *
 *  Phase B (2026-04-21): when `deckCardIds` is provided, a fully-matched
 *  waypoint goal (ratio === 1) with at least one successor whose bridge has
 *  every `requiresDeckPieces` present in the deck is SUBSUMED — its
 *  contribution is skipped. The apex goal is scored on its own required
 *  slots in the same loop, so the DFS sees the apex gradient instead of
 *  plateauing at the waypoint's baseline. When `deckCardIds` is omitted
 *  (legacy callers / pre-Phase-B tests), subsumption is disabled. */
export function evaluateGoalMatch(
  state: FieldState,
  expertise: readonly ArchetypeExpertise[],
  deckCardIds?: readonly number[],
): GoalMatchResult {
  if (expertise.length === 0) return { totalPoints: 0 };

  const deckSet = deckCardIds ? new Set(deckCardIds) : undefined;
  const bridgeMap = deckSet ? buildBridgeMap(expertise) : undefined;
  const subsumed: string[] = [];

  let totalPoints = 0;
  let bestGoalId: string | undefined;
  let bestGoalRatio = 0;

  for (const e of expertise) {
    for (const goal of e.goals) {
      const ratio = computeGoalRatio(state, goal, e);
      if (ratio <= 0) continue;

      if (ratio >= 1 && deckSet && bridgeMap && goal.successors
          && hasViableSuccessor(goal, bridgeMap, deckSet, state, e)) {
        subsumed.push(goal.id);
        continue;
      }

      totalPoints += goal.baselineScore * ratio;
      if (ratio > bestGoalRatio) {
        bestGoalRatio = ratio;
        bestGoalId = goal.id;
      }
    }
  }

  const result: GoalMatchResult = { totalPoints };
  if (bestGoalId !== undefined) result.bestGoalId = bestGoalId;
  if (bestGoalRatio > 0) result.bestGoalRatio = bestGoalRatio;
  if (subsumed.length > 0) result.subsumedWaypointIds = subsumed;
  return result;
}

function buildBridgeMap(expertise: readonly ArchetypeExpertise[]): Map<string, BridgeSubroute> {
  const map = new Map<string, BridgeSubroute>();
  for (const e of expertise) {
    for (const b of e.bridges ?? []) map.set(b.id, b);
  }
  return map;
}

/** Field-state-aware bridge viability check (2026-04-24).
 *
 *  A successor's bridge is viable when BOTH:
 *    (1) every `requiresDeckPieces` id is present in the deck (static),
 *    (2) every `requiresInitialState` CardSlot matches the current field
 *        (dynamic — checked against the live state).
 *
 *  The `requiresInitialState` field is shared with bridge-validator, where
 *  it declares prior-state card placements before a duel starts. Repurposed
 *  here to encode bridge preconditions: a bridge whose preconditions are
 *  not yet satisfied must not trigger subsumption, because the apex it
 *  points to is not reachable from the current state.
 *
 *  Bridges without `requiresInitialState` (or with `[]`) fall back to
 *  deck-only viability — preserves pre-2026-04-24 behavior for existing
 *  bridges like `feral-imps-mikoto-ritual-tutor`. */
function hasViableSuccessor(
  goal: ComboGoal,
  bridgeMap: Map<string, BridgeSubroute>,
  deckSet: ReadonlySet<number>,
  state: FieldState,
  expertise: ArchetypeExpertise,
): boolean {
  for (const s of goal.successors ?? []) {
    const bridge = bridgeMap.get(s.viaBridge);
    if (!bridge) continue;
    if (!bridge.requiresDeckPieces.every(id => deckSet.has(id))) continue;
    const preconditions = bridge.requiresInitialState ?? [];
    if (!preconditions.every(slot => slotMatches(state, slot, expertise))) continue;
    return true;
  }
  return false;
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

// =============================================================================
// Phase A scorer fix (2026-04-26) — implicit board goals from `expectedBoard`.
// The eval harness wires the fixture's expectedBoard list into the scorer as
// implicit goals so each card present on the terminal field contributes
// `weight` units to `interruptionScore`. Distinct from the grammar's
// ComboGoal/ZoneKind plumbing because the fixture format uses MZONE/SZONE
// shorthand (M1-M5 + EMZ_L/EMZ_R / S1-S5 respectively) that doesn't map 1:1
// to a single ZoneKind. Production runtime never sets implicit goals — this
// path is eval-only (gated on SOLVER_IMPLICIT_GOALS=1 in evaluate-structural).
// =============================================================================

export interface ImplicitBoardGoal {
  /** 'MZONE' | 'SZONE' | individual ZoneId ('M1'-'M5', 'S1'-'S5', 'FIELD',
   *  'EMZ_L', 'EMZ_R', 'HAND', 'GY', 'BANISHED', 'EXTRA'). Mirrors the fixture's
   *  expectedBoard.zone shorthand. */
  zone: string;
  cardId: number;
  position?: 'attack' | 'defense' | 'set';
}

const MZONE_EXPANSION_SET: ReadonlySet<string> = new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R']);
const SZONE_EXPANSION_SET: ReadonlySet<string> = new Set(['S1', 'S2', 'S3', 'S4', 'S5']);

const IMPLICIT_SCANNED_ZONES: readonly ZoneId[] = [
  'M1', 'M2', 'M3', 'M4', 'M5',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'FIELD', 'EMZ_L', 'EMZ_R',
  'HAND', 'GY', 'BANISHED', 'EXTRA',
];

function implicitZoneMatches(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  if (expected === 'MZONE') return MZONE_EXPANSION_SET.has(actual);
  if (expected === 'SZONE') return SZONE_EXPANSION_SET.has(actual);
  return false;
}

function implicitPositionMatches(
  expected: 'attack' | 'defense' | 'set' | undefined,
  actual: FieldCard['position'],
): boolean {
  if (!expected) return true;
  if (expected === 'attack') return actual === 'faceup-atk';
  if (expected === 'defense') return actual === 'faceup-def';
  if (expected === 'set') return actual === 'facedown' || actual === 'facedown-def';
  return false;
}

function implicitGoalMatches(state: FieldState, g: ImplicitBoardGoal): boolean {
  for (const zoneId of IMPLICIT_SCANNED_ZONES) {
    if (!implicitZoneMatches(g.zone, zoneId)) continue;
    const cards = state.zones[zoneId];
    if (!cards || cards.length === 0) continue;
    for (const card of cards) {
      if (card.cardId !== g.cardId) continue;
      if (!implicitPositionMatches(g.position, card.position)) continue;
      return true;
    }
  }
  return false;
}

export interface ImplicitGoalResult {
  totalPoints: number;
  matchedCount: number;
}

/** Count `expectedBoard` matches in `state.zones` and return `matchedCount × weight`.
 *  Pure / side-effect-free. Returns zero when goals/weight are absent so the
 *  scorer's caller can call this unconditionally. */
export function evaluateImplicitGoals(
  state: FieldState,
  goals: readonly ImplicitBoardGoal[],
  weight: number,
): ImplicitGoalResult {
  if (goals.length === 0 || weight <= 0) return { totalPoints: 0, matchedCount: 0 };
  let matched = 0;
  for (const g of goals) {
    if (implicitGoalMatches(state, g)) matched++;
  }
  return { totalPoints: matched * weight, matchedCount: matched };
}

/** Optimistic upper bound on still-reachable implicit-goal points from
 *  `state`. A goal contributes `weight` to the bound when the card is present
 *  in any non-banished zone (HAND/DECK/GY/EXTRA/field) — generous, so DFS's
 *  α-β cut never elaguates a branch that could still complete an expectedBoard
 *  card. Subtracts `currentImplicitPoints` so the delta is the headroom over
 *  what's already credited at this state.
 *
 *  Returns 0 when the implicit goal list is empty or weight is zero. */
export function implicitGoalsReachableUpperBound(
  state: FieldState,
  goals: readonly ImplicitBoardGoal[],
  weight: number,
  currentImplicitPoints: number,
): number {
  if (goals.length === 0 || weight <= 0) return 0;
  let reachableCount = 0;
  for (const g of goals) {
    if (cardReachableAnywhere(state, g.cardId)) reachableCount++;
  }
  return Math.max(0, reachableCount * weight - currentImplicitPoints);
}

function cardReachableAnywhere(state: FieldState, cardId: number): boolean {
  for (const zoneId of REACHABLE_ZONES) {
    const cards = state.zones[zoneId];
    if (!cards) continue;
    for (const card of cards) {
      if (card.cardId === cardId) return true;
    }
  }
  return false;
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
