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
      weighted: 0, fallbackPoints: 0, latentPoints: 0, total: 0,
    };

    let weighted = 0;
    let fallbackPoints = 0;
    const endBoardCards: EndBoardCard[] = [];
    const isMonsterZone = new Set(MONSTER_ZONE_IDS);

    for (const zoneId of SCORED_ZONE_IDS) {
      const cards = fieldState.zones[zoneId];
      const isHand = zoneId === 'HAND';
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
              // HAND gate: tagged effects in the HAND zone only score if
              // `activatableFromHand` is explicitly true. Default false keeps
              // Normal Traps / Ritual Monsters / field-bound quick effects
              // (Mitsurugi Purification, D/D/D Siegfried, etc.) from being
              // credited while still in the player's hand — they have to
              // reach the field (Set / Summon) to matter. Handtraps (Ash,
              // Maxx "C", Fuwalos, Effect Veiler) opt in explicitly.
              // See 2026-04-15 diagnostic — scorer was treating
              // "HAND Purification" = "SZONE Purification" = +14 omniNegate,
              // removing the DFS incentive to Set it.
              if (isHand && effect.activatableFromHand !== true) continue;
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

    const total = weighted + fallbackPoints + latentPoints;
    breakdown.weighted = weighted;
    breakdown.fallbackPoints = fallbackPoints;
    breakdown.latentPoints = latentPoints;
    breakdown.total = total;

    // Invariant: total is the sum of the three component scores. Brick
    // detection uses `weighted` specifically (excluding fallback and latent)
    // so any drift between `total` and `weighted + fallbackPoints + latentPoints`
    // corrupts both score display and brick classification.
    solverAssert(
      Math.abs(breakdown.total - (breakdown.weighted + breakdown.fallbackPoints + breakdown.latentPoints)) < 1e-9,
      'InterruptionScorer.scoreWithCards',
      'total !== weighted + fallbackPoints + latentPoints',
      { total: breakdown.total, weighted: breakdown.weighted, fallbackPoints: breakdown.fallbackPoints, latentPoints: breakdown.latentPoints },
    );

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
