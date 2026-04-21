// =============================================================================
// route-aware-ranker.ts — Strategic Grammar v1 progressive action ranker
//
// Wraps a base ActionRanker (typically GoldfishChainRanker). For each
// exploratory prompt, computes alignment against ArchetypeExpertise routes
// and re-orders actions so those advancing the NEXT undone step get highest
// priority, followed by actions matching later steps (gradient), with past
// steps ignored.
//
// Stateless per-call: no DFS-path memory. The "next step" of a route is
// derived from current FieldState — step N is considered DONE if step N's
// subject cardId is present in a field or GY zone (the card has been played
// this turn). First undone step = next. This heuristic is cheap, idempotent,
// and aligns with how a human sees combo progress ("Prayers is in GY, Saji
// is on field, so next step is the ritual activation").
//
// Design constraints:
// - No hard filtering (soft pin only — DFS can still deviate)
// - Base ranker tie-break preserved
// - Multi-route + multi-archetype: max bonus across all active routes
// - Step 2026-04-21 v2 — replaces the flat +100 alignment bonus with a
//   step-index-weighted bonus to fix the "DFS skips middle-combo decisions"
//   symptom seen on ryzeal-mitsurugi-opener (matched plateau 3/5).
// =============================================================================

import type { ActionRanker } from './solver-strategy.js';
import type { Action, FieldCard, FieldState, PromptType } from './solver-types.js';
import type { ZoneId } from '../ws-protocol.js';
import type {
  ArchetypeExpertise,
  CardSelector,
  ComboRoute,
  RouteStep,
  StartCondition,
} from './strategic-grammar.js';

const BONUS_NEXT_STEP = 300;
const BONUS_FUTURE_STEP = 150;
const BONUS_PAST_STEP = 0;

/** Zones considered "played" for stepDone detection. A step's subject is
 *  considered executed when its cardId appears here. Excludes hand/deck/
 *  extra/banished — those are resource zones, not evidence of play. */
const PLAYED_ZONES: readonly ZoneId[] = [
  'M1', 'M2', 'M3', 'M4', 'M5',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'FIELD', 'EMZ_L', 'EMZ_R',
  'GY',
];

export class RouteAwareRanker implements ActionRanker {
  private readonly base: ActionRanker;
  private expertise: readonly ArchetypeExpertise[] = [];

  constructor(base: ActionRanker) {
    this.base = base;
  }

  setArchetypeExpertise(list: readonly ArchetypeExpertise[]): void {
    this.expertise = list;
  }

  needsState(promptType: PromptType): boolean {
    if (this.base.needsState(promptType)) return true;
    return this.expertise.length > 0;
  }

  rank(actions: Action[], state: FieldState): Action[] {
    const baseRanked = this.base.rank(actions, state);
    if (baseRanked.length === 0 || this.expertise.length === 0) return baseRanked;

    const keyed = baseRanked.map((a, i) => ({
      a,
      i,
      align: this.alignmentScore(a, state),
    }));
    keyed.sort((x, y) => (y.align - x.align) || (x.i - y.i));
    return keyed.map(k => k.a);
  }

  /** Max alignment bonus across all active routes for this action. */
  private alignmentScore(action: Action, state: FieldState): number {
    let best = 0;
    for (const exp of this.expertise) {
      for (const route of exp.routes) {
        if (!routeActive(route, state, exp)) continue;
        const bonus = routeAlignmentBonus(route, action, state, exp);
        if (bonus > best) best = bonus;
      }
    }
    return best;
  }
}

// -----------------------------------------------------------------------------
// Route activity + progressive step alignment
// -----------------------------------------------------------------------------

/** A route is "active" if any of its `starts` is satisfied by current state.
 *  Routes with empty `starts` are always active. */
function routeActive(
  route: ComboRoute,
  state: FieldState,
  expertise: ArchetypeExpertise,
): boolean {
  if (route.starts.length === 0) return true;
  for (const cond of route.starts) {
    if (startSatisfied(cond, state, expertise)) return true;
  }
  return false;
}

/** Compute bonus for an action in the context of a specific route.
 *
 *  Algorithm:
 *    1. Find the index of the first UNDONE step (nextIndex)
 *    2. If action matches step[nextIndex].subject → BONUS_NEXT_STEP
 *    3. Else if action matches step[j].subject for some j > nextIndex → BONUS_FUTURE_STEP
 *    4. Else → BONUS_PAST_STEP (0)
 *
 *  Route fully complete (all steps done): returns 0 (no remaining guidance). */
function routeAlignmentBonus(
  route: ComboRoute,
  action: Action,
  state: FieldState,
  expertise: ArchetypeExpertise,
): number {
  const nextIndex = findNextUndoneStepIndex(route, state, expertise);
  if (nextIndex === -1) return 0;

  const nextStep = route.steps[nextIndex];
  if (selectorMatchesCardId(nextStep.subject, action.cardId, expertise)) {
    return BONUS_NEXT_STEP;
  }

  for (let j = nextIndex + 1; j < route.steps.length; j++) {
    const futureStep = route.steps[j];
    if (selectorMatchesCardId(futureStep.subject, action.cardId, expertise)) {
      return BONUS_FUTURE_STEP;
    }
  }

  return BONUS_PAST_STEP;
}

/** First step index whose subject is NOT yet evidenced by state. -1 when all
 *  steps are done. */
function findNextUndoneStepIndex(
  route: ComboRoute,
  state: FieldState,
  expertise: ArchetypeExpertise,
): number {
  for (let i = 0; i < route.steps.length; i++) {
    if (!stepDone(route.steps[i], state, expertise)) return i;
  }
  return -1;
}

/** Step is "done" if its subject card (or any card matching its selector) is
 *  present in a played zone (field or GY). Heuristic — doesn't prove the step
 *  specifically executed, but correlates strongly in practice. */
function stepDone(
  step: RouteStep,
  state: FieldState,
  expertise: ArchetypeExpertise,
): boolean {
  for (const zoneId of PLAYED_ZONES) {
    const cards = state.zones[zoneId];
    if (!cards || cards.length === 0) continue;
    for (const card of cards) {
      if (selectorMatchesCard(step.subject, card, expertise)) return true;
    }
  }
  return false;
}

// -----------------------------------------------------------------------------
// Start conditions
// -----------------------------------------------------------------------------

function startSatisfied(
  cond: StartCondition,
  state: FieldState,
  expertise: ArchetypeExpertise,
): boolean {
  const pool = collectCardIds(cond.location, state);
  let count = 0;
  for (const cardId of pool) {
    if (selectorMatchesCardId(cond.selector, cardId, expertise)) count++;
    if (count >= cond.minCount) return true;
  }
  return false;
}

function collectCardIds(
  location: StartCondition['location'],
  state: FieldState,
): readonly number[] {
  switch (location) {
    case 'hand': return state.zones.HAND.map(c => c.cardId);
    case 'gy': return state.zones.GY.map(c => c.cardId);
    case 'banished': return state.zones.BANISHED.map(c => c.cardId);
    case 'deck': return state.zones.DECK.map(c => c.cardId);
    case 'extra': return state.zones.EXTRA.map(c => c.cardId);
    case 'field': {
      const out: number[] = [];
      const zones: (keyof FieldState['zones'])[] = [
        'M1', 'M2', 'M3', 'M4', 'M5',
        'S1', 'S2', 'S3', 'S4', 'S5',
        'FIELD', 'EMZ_L', 'EMZ_R',
      ];
      for (const z of zones) {
        for (const c of state.zones[z]) out.push(c.cardId);
      }
      return out;
    }
  }
}

// -----------------------------------------------------------------------------
// Selector matching
// -----------------------------------------------------------------------------

function selectorMatchesCardId(
  selector: CardSelector,
  cardId: number,
  expertise: ArchetypeExpertise,
): boolean {
  switch (selector.kind) {
    case 'specific': return selector.cardId === cardId;
    case 'anyOf': return selector.cardIds.includes(cardId);
    case 'role': {
      const roles = expertise.roleMap[cardId];
      return roles !== undefined && roles.includes(selector.role);
    }
  }
}

function selectorMatchesCard(
  selector: CardSelector,
  card: FieldCard,
  expertise: ArchetypeExpertise,
): boolean {
  return selectorMatchesCardId(selector, card.cardId, expertise);
}
