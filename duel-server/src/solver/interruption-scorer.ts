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
import type { OppTurnEnablerMap } from './latent-interruption-computer.js';
import { computeLatentInterruption } from './latent-interruption-computer.js';

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

/** Hardcoded D/D-family card IDs that earn latent combo-progress bonuses.
 *  Narrowly scoped to the D/D archetype so Branded/Mitsurugi intermediate
 *  states are unaffected by construction (neither archetype uses Dark
 *  Contracts or Doom Queen Machinex).
 *
 *  Rationale: the canonical D/D/D turn-1 peak (Siegfried + Deus Machinex
 *  endboard, confirmed via `probe-ddd-mainpath-autopsy.ts` on 2026-04-17)
 *  has 2 Dark Contracts in the S/T zone + Doom Queen Machinex in PZONE.
 *  Rewarding this shape gives the DFS a gradient between "bare field" (0
 *  latent) and "mid-combo progress" (5-11 latent), which downstream phases
 *  (alpha-beta pruning, iterative deepening) can exploit for cutoffs.
 *
 *  DO NOT widen this set to generic continuous spells or "any monster on
 *  field" — both would leak into Branded (Cartesia ritual) and Mitsurugi
 *  (continuous trap shell), reintroducing regression risk. */
const DARK_CONTRACT_IDS: ReadonlySet<number> = new Set([
  46372010, // Dark Contract with the Gate
  32665564, // Dark Contract with the Zero King
  9030160,  // Dark Contract with the Eternal Darkness
  73360025, // Dark Contract with the Swamp King
]);

const DOOM_QUEEN_MACHINEX_ID = 20715411; // D/D/D Zero Doom Queen Machinex

/** Pendulum scale zones under Master Rule 5 (S1/S5 double as P_L/P_R). */
const PZONE_IDS: readonly ZoneId[] = ['S1', 'S5'];

/** S/T zones where continuous spells (Dark Contracts) live. */
const ST_ZONE_IDS: readonly ZoneId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];

/** Per-contract latent bonus. */
const DARK_CONTRACT_BONUS = 2;
/** Maximum contracts counted (caps at 4 to prevent pathological
 *  duplicate-contract paths from dominating). */
const DARK_CONTRACT_MAX_COUNT = 4;
/** Doom Queen in PZONE bonus — one-shot (at most one can be in each PZONE
 *  slot but the combo only needs one to mark canonical progress). */
const DOOM_QUEEN_PZONE_BONUS = 3;

// =============================================================================
// InterruptionScorer
// =============================================================================

export class InterruptionScorer {
  private readonly tags: Record<string, InterruptionTag>;
  private readonly weights: Record<InterruptionType, number>;
  private cardMetadata: CardMetadataMap | undefined;
  private readonly structuralWeights: StructuralWeights | undefined;
  private readonly tutorCards: StructuralTutorCards | undefined;
  private readonly oppTurnEnablers: OppTurnEnablerMap | undefined;

  constructor(
    tags: Record<string, InterruptionTag>,
    weights: Record<InterruptionType, number>,
    cardMetadata?: CardMetadataMap,
    structuralWeights?: StructuralWeights,
    tutorCards?: StructuralTutorCards,
    oppTurnEnablers?: OppTurnEnablerMap,
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
    this.oppTurnEnablers = oppTurnEnablers;
  }

  /** Rebuild the per-duel card metadata. Called by solver-worker at the
   *  start of each solve request since metadata varies per duelConfig
   *  while `structuralWeights`/`tutorCards` are shared config. Piscina
   *  serializes tasks per worker so no concurrent mutation. */
  setCardMetadata(map: CardMetadataMap | undefined): void {
    this.cardMetadata = map;
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

    // Phase 2.3 V1 — turn-1 latent combo-progress bonus. Gated on
    // `turn === 1` so turn-0 baseline and turn>=2 virtual terminals are
    // unaffected. Hardcoded to D/D card IDs for zero-regression-by-
    // construction on Branded/Mitsurugi. Capped at
    // DARK_CONTRACT_BONUS * DARK_CONTRACT_MAX_COUNT + DOOM_QUEEN_PZONE_BONUS
    // = 2*4 + 3 = 11 points to prevent dominating the tagged-weighted peak.
    let latentPoints = 0;
    if (fieldState.turn === 1) {
      let contractCount = 0;
      for (const zoneId of ST_ZONE_IDS) {
        const cards = fieldState.zones[zoneId];
        for (const card of cards) {
          if (DARK_CONTRACT_IDS.has(card.cardId)) contractCount++;
        }
      }
      const contractBonus = DARK_CONTRACT_BONUS * Math.min(contractCount, DARK_CONTRACT_MAX_COUNT);
      latentPoints += contractBonus;

      let doomQueenInPzone = false;
      for (const zoneId of PZONE_IDS) {
        const cards = fieldState.zones[zoneId];
        for (const card of cards) {
          if (card.cardId === DOOM_QUEEN_MACHINEX_ID) { doomQueenInPzone = true; break; }
        }
        if (doomQueenInPzone) break;
      }
      if (doomQueenInPzone) latentPoints += DOOM_QUEEN_PZONE_BONUS;
    }

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

    // Phase D V1 latent interruption — opp-turn Extra Deck summon path
    // (Masquerena Link-2, Super Poly Fusion). Scores Extra Deck targets
    // tagged with `activeZones: ['EXTRA']` conditional on an enabler
    // on-field + free summon slot (MR5 EMZ ownership + consumesSelf
    // exception for Masquerena). Discounted 0.5× for conditional
    // materialization (see LATENT_DISCOUNT in latent-interruption-computer).
    // Gated on `oppTurnEnablers` wired (via scorer ctor) — production paths
    // without Phase D config see zero behavioral change.
    if (this.oppTurnEnablers !== undefined) {
      const latent = computeLatentInterruption(
        fieldState,
        this.oppTurnEnablers,
        this.tags,
        this.weights,
        this.cardMetadata,
      );
      latentPoints += latent.totalLatent;
    }

    // Split scoring (methodology v5). interruptionScore is the user-facing
    // grade (DecisionNode.score, reportScore, rubric). explorationScore is
    // the DFS guidance signal (action ordering, TT, α-β floor) and is
    // returned as `score` to preserve the pre-v5 DFS internal contract.
    const interruptionScore = weighted + fallbackPoints;
    const explorationScore = interruptionScore + latentPoints;
    breakdown.weighted = weighted;
    breakdown.fallbackPoints = fallbackPoints;
    breakdown.latentPoints = latentPoints;
    breakdown.interruptionScore = interruptionScore;
    breakdown.explorationScore = explorationScore;

    solverAssert(
      Math.abs(interruptionScore - (weighted + fallbackPoints)) < 1e-9
      && Math.abs(explorationScore - (interruptionScore + latentPoints)) < 1e-9,
      'InterruptionScorer.scoreWithCards',
      'score invariant drift',
      { interruptionScore, explorationScore, weighted, fallbackPoints, latentPoints },
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
