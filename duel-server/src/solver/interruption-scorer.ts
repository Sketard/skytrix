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
import { solverAssert } from './solver-assert.js';
import { time as instrumentTime } from './solver-instrumentation.js';
import type { CardMetadataMap } from './card-metadata.js';
import type { StructuralWeights, StructuralTutorCards } from './structural-value-computer.js';
import { computeStructuralValue } from './structural-value-computer.js';
import type { ArchetypeExpertise } from './strategic-grammar.js';
import {
  evaluateGoalMatch,
  goalMatchReachableUpperBound,
  evaluateImplicitGoals,
  implicitGoalsReachableUpperBound,
  type ImplicitBoardGoal,
} from './goal-match-evaluator.js';

// =============================================================================
// Zone Constants (local to scorer)
// =============================================================================

/** Only DECK is excluded from scoring — cards not yet drawn are not
 *  usable interruptions. All other zones are traversed; per-effect
 *  credit is then gated by `effectiveActiveZones()` below.
 *  The fallback heuristic (+1 per untagged face-up monster) still only
 *  applies to MONSTER_ZONE_IDS. */
const NON_SCORED_ZONES: ReadonlySet<ZoneId> = new Set(['DECK']);

/** Monster zones — eligible for fallback heuristic. */
const MONSTER_ZONE_IDS: readonly ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R'];

/** On-field zones — the implicit default activation surface for a tagged
 *  effect without explicit `activeZones`. Excludes HAND / GY / BANISHED /
 *  EXTRA (those require explicit opt-in). Added 2026-04-17 (Voie B). */
const ON_FIELD_ZONE_IDS: readonly ZoneId[] = [
  'M1', 'M2', 'M3', 'M4', 'M5',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'FIELD', 'EMZ_L', 'EMZ_R',
];

/** All scored zones — 13 field zones + HAND + GY + BANISHED + EXTRA (18 of
 *  19 total; only DECK is skipped). Iteration surface for the tag scan. */
const SCORED_ZONE_IDS: readonly ZoneId[] = ALL_ZONE_IDS.filter(z => !NON_SCORED_ZONES.has(z));

// =============================================================================
// Phase 2.3 V1 latent scoring — turn-1 combo-progress state bonus
// =============================================================================
// REMOVED 2026-04-26 (Phase 1 scorer audit): the D/D hardcode (DARK_CONTRACT_IDS
// + DOOM_QUEEN_MACHINEX_ID) was archetype-tagged latent that biased the scorer
// toward a specific archetype's mid-combo states. Per the philosophical shift
// 2026-04-26 (auto-discovery roadmap), the scorer must be deck-agnostic — any
// archetype-specific latent reward is scaffolding.
//
// Honest baseline impact: D/D fixture loses up to 11 latent points at canonical
// Doom-Queen-PZONE+4-contracts states. The same shape is now scored ONLY via
// `weighted` (= tagged interruption pieces on field) + `fallbackPoints`
// (untagged faceup monsters) + structural F1/F2/F3 latent.
//
// History: this hardcode was added in Phase 2.3 V1 (2026-04-17) before the
// audit framework existed. It was already documented as "narrowly scoped to
// D/D archetype" — by definition scaffolding under the new philosophy.

// =============================================================================
// InterruptionScorer
// =============================================================================

export class InterruptionScorer {
  private readonly tags: Record<string, InterruptionTag>;
  private weights: Record<InterruptionType, number>;
  private cardMetadata: CardMetadataMap | undefined;
  private structuralWeights: StructuralWeights | undefined;
  private readonly tutorCards: StructuralTutorCards | undefined;
  private archetypeExpertise: readonly ArchetypeExpertise[] = [];
  private deckCardIds: readonly number[] | undefined;
  // Phase A scorer fix (2026-04-26) — fixture's `expectedBoard` injected as
  // implicit goals at eval time. Empty / zero in production runtime.
  private implicitGoals: readonly ImplicitBoardGoal[] = [];
  private implicitGoalWeight = 0;

  constructor(
    tags: Record<string, InterruptionTag>,
    weights: Record<InterruptionType, number>,
    cardMetadata?: CardMetadataMap,
    structuralWeights?: StructuralWeights,
    tutorCards?: StructuralTutorCards,
  ) {
    if (Object.keys(tags).length === 0) {
      throw new Error('[Solver] InterruptionScorer: tags must not be empty');
    }
    if (Object.keys(weights).length !== 15) {
      throw new Error(`[Solver] InterruptionScorer: expected 15 weight types, got ${Object.keys(weights).length}`);
    }
    this.tags = tags;
    this.weights = weights;
    this.cardMetadata = cardMetadata;
    this.structuralWeights = structuralWeights;
    this.tutorCards = tutorCards;
  }

  /** Rebuild the per-duel card metadata. Called by solver-worker at the
   *  start of each solve request since metadata varies per duelConfig
   *  while `structuralWeights`/`tutorCards` are shared config. Piscina
   *  serializes tasks per worker so no concurrent mutation. */
  setCardMetadata(map: CardMetadataMap | undefined): void {
    this.cardMetadata = map;
  }

  /** Replace the structural weights (F1/F2/F3/globalCap + latentDiscount).
   *  Used by the step-3 tuning orchestrator (`scripts/tune-weights.ts`)
   *  to evaluate many candidate weight sets within one process without
   *  rebuilding the adapter/scorer/metadata. Production paths call this
   *  once at boot (if at all) and never mutate at runtime. */
  setStructuralWeights(w: StructuralWeights | undefined): void {
    this.structuralWeights = w;
  }

  /** Replace the active archetype expertise list. Strategic Grammar v1
   *  (2026-04-21). Harness calls this per-fixture after filtering the
   *  on-disk expertise files by main-deck keyCards overlap. Empty array
   *  (default) = no goal-match scoring. */
  setArchetypeExpertise(list: readonly ArchetypeExpertise[]): void {
    this.archetypeExpertise = list;
  }

  /** Phase B (2026-04-21): main + extra deck cardIds for the active fixture.
   *  Enables waypoint subsumption in `evaluateGoalMatch` — a matched waypoint
   *  whose successor's bridge has all `requiresDeckPieces` in the deck is
   *  subsumed into the apex (skipped from score to expose the apex gradient).
   *  Omitted / undefined = subsumption disabled (pre-Phase-B behavior). */
  setDeckContents(deckCardIds: readonly number[] | undefined): void {
    this.deckCardIds = deckCardIds;
  }

  /** Phase A scorer fix (2026-04-26). Inject the fixture's `expectedBoard`
   *  as implicit goals; each card present on the terminal field contributes
   *  `weight` units to `interruptionScore`. Eval-only — production worker
   *  never calls this (no expectedBoard available). Pass `goals=[]` or
   *  `weight=0` to disable. */
  setImplicitBoardGoals(goals: readonly ImplicitBoardGoal[], weight: number): void {
    this.implicitGoals = goals;
    this.implicitGoalWeight = weight;
  }

  /** Strategic Grammar v1 α-β upper-bound delta (2026-04-21). Returns an
   *  optimistic estimate of the goalMatchPoints still reachable from
   *  `fieldState`, given that `currentGoalMatchPoints` already contribute to
   *  the ancestor-chain turn-1 peak. DFS Phase I uses this to widen the
   *  branch-bound window for subtrees that could still complete grammar
   *  goals. Returns 0 when no expertise is active (caller must still apply
   *  its own plies-based buffer for non-expertise fixtures). */
  goalMatchUpperBoundDelta(
    fieldState: FieldState,
    currentGoalMatchPoints: number,
    currentImplicitGoalPoints: number = 0,
  ): number {
    const grammar = goalMatchReachableUpperBound(
      fieldState, this.archetypeExpertise, currentGoalMatchPoints,
    );
    // Phase A scorer fix (2026-04-26) — widen the bound by still-reachable
    // implicit goal points, otherwise α-β cuts subtrees that could still
    // produce expectedBoard cards (the very thing the gradient is meant to
    // reward). When implicit goals are empty / weight=0 this returns 0.
    const implicit = implicitGoalsReachableUpperBound(
      fieldState, this.implicitGoals, this.implicitGoalWeight, currentImplicitGoalPoints,
    );
    return grammar + implicit;
  }

  /** Replace the per-interruption-type weights. Same tuning rationale as
   *  `setStructuralWeights`. Size-validates the new map against the
   *  ctor invariant (15 types). */
  setInterruptionWeights(w: Record<InterruptionType, number>): void {
    if (Object.keys(w).length !== 15) {
      throw new Error(`[Solver] setInterruptionWeights: expected 15 weight types, got ${Object.keys(w).length}`);
    }
    this.weights = w;
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
    return instrumentTime('score', () => this._scoreWithCardsImpl(fieldState, activationLog));
  }

  private _scoreWithCardsImpl(
    fieldState: FieldState,
    activationLog?: ActivationLog,
  ): { score: number; scoreBreakdown: ScoreBreakdown; endBoardCards: EndBoardCard[] } {
    const breakdown: ScoreBreakdown = {
      omniNegate: 0, typedNegate: 0, targetedNegate: 0, floodgate: 0,
      controlChange: 0, banish: 0, banishFacedown: 0, attach: 0,
      spin: 0, flipFacedown: 0, destruction: 0, moveToSt: 0,
      bounce: 0, handRip: 0, sendToGy: 0,
      weighted: 0, fallbackPoints: 0, latentPoints: 0,
      goalMatchPoints: 0, implicitGoalPoints: 0,
      interruptionScore: 0, explorationScore: 0,
    };

    let weighted = 0;
    let fallbackPoints = 0;
    const endBoardCards: EndBoardCard[] = [];
    const isMonsterZone = new Set(MONSTER_ZONE_IDS);

    for (const zoneId of SCORED_ZONE_IDS) {
      const cards = fieldState.zones[zoneId];
      const isExtra = zoneId === 'EXTRA';
      for (const card of cards) {
        const isFaceDown = card.position === 'facedown-def' || card.position === 'facedown';
        // Face-down cards in EXTRA are un-summoned Fusion/Synchro/Xyz/Link
        // monsters waiting to be played from the Extra Deck — they are NOT
        // active interruptions. The validation harness on Branded Dracotail
        // surfaced this: a 2-action "minimal combo" (Normal Summon Faimena,
        // pass) scored 46 because the 6 tagged cards in EXTRA were credited
        // even though none of them were ever brought to the field. The
        // intent of scoring EXTRA was face-up Pendulum monsters (recycled
        // via Pendulum Summon — those still count); skipping face-downs
        // here preserves that case while removing the un-summoned bias.
        if (isExtra && isFaceDown) continue;
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
              // Zone gate (Voie B). Effect scores only when the card sits in
              // one of its active zones; default = on-field only when
              // activeZones is absent. See `isZoneActive` below.
              if (!isZoneActive(effect, zoneId)) continue;
              const consumedCount = countOccurrences(consumedIndices, i);
              const remainingUses = Math.max(0, effect.usesPerTurn - consumedCount);
              if (remainingUses === 0) continue;
              breakdown[effect.type] += remainingUses;
              weighted += this.weights[effect.type] * remainingUses;
            }
          }

          // Tagged cards on field/hand go to endBoard display regardless
          // of face-up/face-down status — a Set Normal Trap in SZONE is a
          // legitimate end-board interruption piece even though it's
          // physically face-down, and must be included for the `matched`
          // metric to count fixtures that expect Set traps (Mitsurugi
          // Great Purification, Infinite Impermanence, etc.). Earlier
          // versions filtered face-down non-HAND cards out of the display;
          // the 2026-04-15 hand-gate diagnostic revealed this hid valid
          // Set-Trap peaks from matched even when the scorer correctly
          // credited their weighted value. Consumers that need to
          // distinguish face-up vs face-down can read `card.position`.
          {
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

    // Phase 2.3 V1 D/D hardcode REMOVED 2026-04-26 (Phase 1 scorer audit).
    // The archetype-tagged latent reward (DARK_CONTRACT_IDS + DOOM_QUEEN_MACHINEX_ID)
    // biased the scorer toward a specific deck and was scaffolding under the
    // auto-discovery roadmap. `latentPoints` now starts at 0 and only accumulates
    // deck-agnostic structural signal (Step 1 F1/F2/F3 below).
    let latentPoints = 0;

    // Step 1 structural value function — deck-agnostic features that score
    // combo-enabling latent states (ritual unlock, tutor chain, material
    // pool). Additive into `latentPoints` on top of Phase 2.3 V1. Gated on
    // `cardMetadata` presence (S1.1 plumbing) AND `turn === 1` (inside
    // computeStructuralValue). Returns 0 when either gate is unmet, so
    // production paths without wired metadata see zero behavioral change.
    if (this.cardMetadata !== undefined && this.structuralWeights !== undefined) {
      const structural = computeStructuralValue(
        fieldState,
        activationLog,
        this.cardMetadata,
        this.structuralWeights,
        this.tutorCards,
      );
      latentPoints += structural.totalStructural;
    }

    // Phase D V1 retired 2026-04-18 (probe-phase-d-firing diagnostic:
    // `computeLatentInterruption` returned 0 on every DFS peak across 4
    // fixtures with Masquerena/Super Poly in deck — the rational solver
    // never brought the enabler to an active zone at nb≤200, so the
    // reward was unreachable by construction). The enabler + target data
    // files remain in `data/` for a future redesign (static tutorability
    // model or policy-guided DFS path), but the runtime scoring machinery
    // is removed. See `project_solver_phase_d_retirement_2026_04_18.md`
    // for the retirement notes.

    // Strategic Grammar v1 goal-match evaluation. Counts INTO
    // `interruptionScore` (user-facing grade) per the design decision —
    // goal-completion is disruption value, not latent exploration signal.
    // Returns 0 when no archetype expertise is active, preserving pre-grammar
    // baselines for fixtures without an authored expertise file.
    const goalMatch = evaluateGoalMatch(fieldState, this.archetypeExpertise, this.deckCardIds);
    const goalMatchPoints = goalMatch.totalPoints;

    // Phase A scorer fix (2026-04-26) — implicit goals from `expectedBoard`.
    // Counts INTO `interruptionScore` for the same reason as goalMatchPoints.
    // Eval-only: production runtime never sets implicit goals so this is 0.
    const implicit = evaluateImplicitGoals(
      fieldState, this.implicitGoals, this.implicitGoalWeight,
    );
    const implicitGoalPoints = implicit.totalPoints;

    // Split scoring (methodology v5 + Strategic Grammar v1 + Phase A).
    //   interruptionScore = weighted + fallbackPoints + goalMatchPoints + implicitGoalPoints
    //   explorationScore  = interruptionScore + latentPoints
    // interruptionScore is the user-facing grade (DecisionNode.score,
    // reportScore, rubric). explorationScore is the DFS guidance signal
    // (action ordering, TT, α-β floor) and is returned as `score` to
    // preserve the pre-v5 DFS internal contract.
    const interruptionScore = weighted + fallbackPoints + goalMatchPoints + implicitGoalPoints;
    const explorationScore = interruptionScore + latentPoints;
    breakdown.weighted = weighted;
    breakdown.fallbackPoints = fallbackPoints;
    breakdown.latentPoints = latentPoints;
    breakdown.goalMatchPoints = goalMatchPoints;
    breakdown.implicitGoalPoints = implicitGoalPoints;
    breakdown.interruptionScore = interruptionScore;
    breakdown.explorationScore = explorationScore;

    solverAssert(
      Math.abs(interruptionScore - (weighted + fallbackPoints + goalMatchPoints + implicitGoalPoints)) < 1e-9
      && Math.abs(explorationScore - (interruptionScore + latentPoints)) < 1e-9,
      'InterruptionScorer.scoreWithCards',
      'score invariant drift',
      { interruptionScore, explorationScore, weighted, fallbackPoints, latentPoints, goalMatchPoints, implicitGoalPoints },
    );

    return { score: explorationScore, scoreBreakdown: breakdown, endBoardCards };
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

/** `effect.activeZones` is authoritative when present; otherwise the
 *  default is on-field zones only. */
function isZoneActive(
  effect: { activeZones?: readonly ZoneId[] },
  zoneId: ZoneId,
): boolean {
  if (effect.activeZones !== undefined) return effect.activeZones.includes(zoneId);
  return ON_FIELD_ZONE_IDS.includes(zoneId);
}
