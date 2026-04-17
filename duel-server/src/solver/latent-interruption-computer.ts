// =============================================================================
// latent-interruption-computer.ts — Phase D V1 latent interruption scoring.
//
// Scores states where an on-field enabler (I:P Masquerena, Super Polymerization
// set or in hand) can realize an opp-turn Extra Deck summon that materializes
// an on-summon interruption trigger (tag with `activeZones: ['EXTRA']`). These
// tags don't score via the main scorer loop (face-down EXTRA filter +
// activeZones gate), so Phase D surfaces their conditional value separately.
//
// Architecture: enabler × target-compatibility × slot-availability × discount.
//
// V1 constraints (methodology v5 / 2026-04-17):
//   - 2 enablers only: I:P Masquerena (Link-2), Super Polymerization (Fusion).
//     Phase E will extend with Ultra Poly, Predaplant Verte Anaconda, Formula
//     Synchron, Rank-Up-Magic spells, and archetype-locked enablers.
//   - Slot-check follows MR5 + user clarification: player's EMZ = the one
//     already occupied by their card (or either if none claimed). A free
//     EMZ summon-slot requires neither EMZ occupied. Exception: if an enabler
//     consumes itself as material AND is in an EMZ, treat that EMZ as free
//     (Masquerena case).
//   - MZONE-via-Link-arrow targeting is NOT implemented in V1 (requires per-
//     Link column+arrow layout logic). Phase E TODO.
//   - LATENT_DISCOUNT = 0.5 — conservative first cut. The 4-factor chain
//     (enabler exists × slot free × target compatible × player chooses to
//     materialize) has more than 2× uncertainty at endboard evaluation, so a
//     50% discount is optimistic but tunable via the ES tuner (step 3).
//
// Gated on `fieldState.turn === 1` to match the existing Phase 2.3 and Step 1
// latent mechanisms — all latent features fire only during the player's peak
// turn-1 state evaluation.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZoneId } from '../ws-protocol.js';
import type {
  FieldCard,
  FieldState,
  InterruptionTag,
  InterruptionType,
} from './solver-types.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import type { CardMetadataMap, SummonCategory } from './card-metadata.js';

/** Conservative first-cut discount — V1 tune. See header rationale. */
export const LATENT_DISCOUNT = 0.5;

// =============================================================================
// Data types
// =============================================================================

export interface OppTurnEnabler {
  cardName: string;
  summonCategory: SummonCategory;
  /** [min, max] rating range of valid targets. `[2, 2]` for Masquerena. */
  ratingRange: readonly [number, number];
  /** Zones in which the enabler card must sit for its Quick Effect to be
   *  activatable on opp turn. Masquerena: on-field; Super Poly: hand or
   *  SZONE (set). */
  activeFromZones: readonly ZoneId[];
  /** True when the enabler consumes itself as material for the summon
   *  (Masquerena uses her own body). Gates the slot-check exception —
   *  enabler-in-EMZ frees that EMZ for the target to land in. */
  consumesSelfAsMaterial: boolean;
  /** Human-readable summary for debugging. */
  notes?: string;
}

export type OppTurnEnablerMap = Readonly<Record<string, OppTurnEnabler>>;

export interface LinkArrowEntry {
  /** Human-readable card name for debugging. */
  name: string;
  /** List of arrow directions (compass notation). V1 unused (MZONE-via-arrow
   *  targeting deferred to Phase E) but loaded eagerly so Phase E can
   *  consume without a loader change. */
  arrows: readonly string[];
}

export type LinkArrowsMap = Readonly<Record<string, LinkArrowEntry>>;

export interface LatentInterruptionBreakdown {
  /** Number of (enabler, target) pairs that satisfied all gates. */
  eligiblePairs: number;
  /** Best raw target interruption weight (pre-discount) among eligible pairs.
   *  0 when no pair qualified. */
  bestRawTargetValue: number;
  /** Final contribution = `bestRawTargetValue × LATENT_DISCOUNT`, added to
   *  the scorer's `latentPoints`. */
  totalLatent: number;
}

const EMPTY_BREAKDOWN: LatentInterruptionBreakdown = {
  eligiblePairs: 0,
  bestRawTargetValue: 0,
  totalLatent: 0,
};

// =============================================================================
// Loaders (file-based, consumed at scorer construction time)
// =============================================================================

interface EnablersFile {
  _meta?: unknown;
  enablers: Record<string, unknown>;
}

const VALID_SUMMON_CATEGORIES: ReadonlySet<SummonCategory> = new Set<SummonCategory>([
  'LINK', 'FUSION', 'XYZ', 'SYNCHRO',
]);
const VALID_ZONE_IDS_SET: ReadonlySet<string> = new Set(ALL_ZONE_IDS);

export function loadOppTurnEnablers(dataDir: string): OppTurnEnablerMap {
  const filePath = join(dataDir, 'opp-turn-summon-enablers.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as EnablersFile;
  if (!raw.enablers || typeof raw.enablers !== 'object') {
    throw new Error(`[Solver] Invalid opp-turn-summon-enablers.json: missing 'enablers' object`);
  }
  const out: Record<string, OppTurnEnabler> = {};
  for (const [cardId, entry] of Object.entries(raw.enablers)) {
    if (!Number.isFinite(Number(cardId)) || Number(cardId) <= 0) {
      throw new Error(`[Solver] opp-turn-summon-enablers.json invalid cardId "${cardId}"`);
    }
    const e = entry as Partial<OppTurnEnabler> & { activeFromZones?: unknown; ratingRange?: unknown };
    if (!e.cardName || typeof e.cardName !== 'string') {
      throw new Error(`[Solver] enabler ${cardId} missing cardName`);
    }
    if (!VALID_SUMMON_CATEGORIES.has(e.summonCategory as SummonCategory)) {
      throw new Error(`[Solver] enabler ${cardId} invalid summonCategory "${e.summonCategory}"`);
    }
    if (!Array.isArray(e.ratingRange) || e.ratingRange.length !== 2) {
      throw new Error(`[Solver] enabler ${cardId} ratingRange must be [min, max]`);
    }
    const [min, max] = e.ratingRange as [unknown, unknown];
    if (typeof min !== 'number' || typeof max !== 'number' || min < 0 || max < min) {
      throw new Error(`[Solver] enabler ${cardId} ratingRange invalid: [${min}, ${max}]`);
    }
    if (!Array.isArray(e.activeFromZones) || e.activeFromZones.length === 0) {
      throw new Error(`[Solver] enabler ${cardId} activeFromZones must be a non-empty array`);
    }
    for (const z of e.activeFromZones) {
      if (typeof z !== 'string' || !VALID_ZONE_IDS_SET.has(z)) {
        throw new Error(`[Solver] enabler ${cardId} activeFromZones contains invalid zone "${z}"`);
      }
    }
    if (typeof e.consumesSelfAsMaterial !== 'boolean') {
      throw new Error(`[Solver] enabler ${cardId} consumesSelfAsMaterial must be boolean`);
    }
    out[cardId] = {
      cardName: e.cardName,
      summonCategory: e.summonCategory as SummonCategory,
      ratingRange: [min, max] as const,
      activeFromZones: e.activeFromZones as ZoneId[],
      consumesSelfAsMaterial: e.consumesSelfAsMaterial,
      ...(typeof e.notes === 'string' ? { notes: e.notes } : {}),
    };
  }
  return out;
}

export function loadLinkArrows(dataDir: string): LinkArrowsMap {
  const filePath = join(dataDir, 'link-arrows.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  const out: Record<string, LinkArrowEntry> = {};
  for (const [cardId, entry] of Object.entries(raw)) {
    const e = entry as Partial<LinkArrowEntry> & { arrows?: unknown };
    if (!e.name || typeof e.name !== 'string') continue;
    if (!Array.isArray(e.arrows)) continue;
    out[cardId] = { name: e.name, arrows: e.arrows as string[] };
  }
  return out;
}

// =============================================================================
// Main computation
// =============================================================================

/**
 * Phase D V1 latent interruption score.
 *
 * @returns Total latent contribution + diagnostic breakdown. Returns 0 and an
 *          empty breakdown when any precondition fails (turn != 1, no enabler,
 *          no compatible target, no free slot).
 */
export function computeLatentInterruption(
  state: FieldState,
  enablers: OppTurnEnablerMap,
  tags: Record<string, InterruptionTag>,
  weights: Record<InterruptionType, number>,
  cardMetadata: CardMetadataMap | undefined,
): LatentInterruptionBreakdown {
  if (state.turn !== 1) return EMPTY_BREAKDOWN;
  if (cardMetadata === undefined) return EMPTY_BREAKDOWN;

  // 1. Enumerate active enablers on player 0's side.
  const activeEnablers: { enabler: OppTurnEnabler; zone: ZoneId }[] = [];
  for (const zoneId of ALL_ZONE_IDS) {
    const cards = state.zones[zoneId];
    for (const card of cards) {
      const enabler = enablers[String(card.cardId)];
      if (!enabler) continue;
      if (!enabler.activeFromZones.includes(zoneId)) continue;
      // On-field enablers must be face-up; hand/set are fine face-down.
      if (!isZoneHandOrSet(zoneId) && !isFaceUp(card)) continue;
      activeEnablers.push({ enabler, zone: zoneId });
    }
  }
  if (activeEnablers.length === 0) return EMPTY_BREAKDOWN;

  // 2. Enumerate potential targets from Extra Deck — tagged with activeZones
  //    including EXTRA (Phase D placeholder convention).
  const targets: { cardId: number; effectType: InterruptionType; usesPerTurn: number }[] = [];
  for (const card of state.zones.EXTRA) {
    const tag = tags[String(card.cardId)];
    if (!tag) continue;
    for (const eff of tag.effects) {
      if (eff.activeZones?.includes('EXTRA')) {
        targets.push({ cardId: card.cardId, effectType: eff.type, usesPerTurn: eff.usesPerTurn });
      }
    }
  }
  if (targets.length === 0) return EMPTY_BREAKDOWN;

  // 3. For each (enabler, target) pair, check compatibility + slot + value.
  let bestRawTargetValue = 0;
  let eligiblePairs = 0;
  for (const { enabler, zone: enablerZone } of activeEnablers) {
    if (!hasSlot(state, enabler, enablerZone)) continue;
    for (const target of targets) {
      const meta = cardMetadata.get(target.cardId);
      if (!meta || meta.summonCategory !== enabler.summonCategory) continue;
      const [min, max] = enabler.ratingRange;
      if (meta.rating < min || meta.rating > max) continue;
      eligiblePairs++;
      const rawValue = (weights[target.effectType] ?? 0) * target.usesPerTurn;
      if (rawValue > bestRawTargetValue) bestRawTargetValue = rawValue;
    }
  }
  if (eligiblePairs === 0) return EMPTY_BREAKDOWN;

  return {
    eligiblePairs,
    bestRawTargetValue,
    totalLatent: bestRawTargetValue * LATENT_DISCOUNT,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function isZoneHandOrSet(zoneId: ZoneId): boolean {
  return zoneId === 'HAND' || zoneId === 'S1' || zoneId === 'S2' ||
         zoneId === 'S3' || zoneId === 'S4' || zoneId === 'S5';
}

function isFaceUp(card: FieldCard): boolean {
  return card.position === 'faceup-atk' || card.position === 'faceup-def';
}

/**
 * MR5 slot availability for an opp-turn Extra Deck summon via this enabler.
 *
 * Rule (user clarification 2026-04-17): player's "own" EMZ is the one already
 * occupied by their card; if neither is occupied, either can be claimed.
 * So a free EMZ summon-slot requires neither EMZ occupied.
 *
 * Enabler-consumes-self exception: if Masquerena herself occupies an EMZ,
 * her activation frees that slot for the Link-2 target to land in. So the
 * check becomes: after removing the enabler from her zone, is any EMZ free?
 *
 * MZONE-via-Link-arrow path is not implemented in V1 (Phase E TODO).
 */
function hasSlot(state: FieldState, enabler: OppTurnEnabler, enablerZone: ZoneId): boolean {
  const emzLOccupiedByOther = state.zones.EMZ_L.length > 0
    && !(enabler.consumesSelfAsMaterial && enablerZone === 'EMZ_L');
  const emzROccupiedByOther = state.zones.EMZ_R.length > 0
    && !(enabler.consumesSelfAsMaterial && enablerZone === 'EMZ_R');
  return !emzLOccupiedByOther && !emzROccupiedByOther;
}
