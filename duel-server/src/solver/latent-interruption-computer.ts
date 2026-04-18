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
//   - MZONE-via-Link-arrow targeting was added in Phase E axis 2: each face-up
//     player Link monster (identified via `linkArrows` map keyed on cardId)
//     extends the set of valid landing zones with the MZONE its arrows point
//     to, provided the target zone is empty. The enabler itself (when it
//     `consumesSelfAsMaterial`) is excluded as a contributor since its arrows
//     vanish with it.
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

/** Conservative first-cut discount — V1 default. See header rationale.
 *  The runtime value is now read from `structuralWeights.latentDiscount`
 *  (Phase 3.0 C2, 2026-04-18) and passed into `computeLatentInterruption`.
 *  This const remains exported as the reference default — used as the
 *  scorer-side fallback when `structuralWeights` is undefined (legacy
 *  test paths that don't wire the tuning config). */
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
  /** Final contribution = `bestRawTargetValue × discount`, added to the
   *  scorer's `latentPoints`. The discount is passed in by the caller
   *  (scorer reads `structuralWeights.latentDiscount`, fallback LATENT_DISCOUNT). */
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

const VALID_ARROW_DIRECTIONS: ReadonlySet<string> = new Set([
  'T', 'TL', 'TR', 'L', 'R', 'B', 'BL', 'BR',
]);

export function loadLinkArrows(dataDir: string): LinkArrowsMap {
  const filePath = join(dataDir, 'link-arrows.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  const out: Record<string, LinkArrowEntry> = {};
  for (const [cardId, entry] of Object.entries(raw)) {
    const e = entry as Partial<LinkArrowEntry> & { arrows?: unknown };
    if (!e.name || typeof e.name !== 'string') continue;
    if (!Array.isArray(e.arrows)) continue;
    const arrows = e.arrows.filter((a): a is string => typeof a === 'string' && VALID_ARROW_DIRECTIONS.has(a));
    if (arrows.length === 0) continue;
    out[cardId] = { name: e.name, arrows };
  }
  console.log(`[Solver] link-arrows.json loaded (${Object.keys(out).length} entries)`);
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
  linkArrows: LinkArrowsMap | undefined,
  discount: number,
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
    if (!hasSlot(state, enabler, enablerZone, linkArrows)) continue;
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
    totalLatent: bestRawTargetValue * discount,
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
 * Accepts the target if ANY of:
 *   (a) at least one EMZ is free (user clarification 2026-04-17: neither EMZ
 *       occupied by the player, with the consumes-self exception — if the
 *       enabler sits in an EMZ and self-tributes, that EMZ counts as free);
 *   (b) at least one player MZONE (M1..M5) is free AND pointed to by a Link
 *       monster arrow from another face-up player Link on the field. The
 *       enabler itself is excluded as a contributor when it consumes itself
 *       (its arrows vanish with the tribute).
 *
 * MZONE-via-arrow grid uses the MR5 column/row layout: EMZ exists only in
 * col 2 (EMZ_L) and col 4 (EMZ_R) on row 2; player MZONE is row 3, col 1..5.
 * Arrows pointing outside player's field (opp zones, S row) contribute no
 * slots to this check.
 */
function hasSlot(
  state: FieldState,
  enabler: OppTurnEnabler,
  enablerZone: ZoneId,
  linkArrows: LinkArrowsMap | undefined,
): boolean {
  const effectivelyEmpty = (z: ZoneId): boolean =>
    state.zones[z].length === 0
    || (enabler.consumesSelfAsMaterial && z === enablerZone);

  if (effectivelyEmpty('EMZ_L') || effectivelyEmpty('EMZ_R')) return true;

  if (!linkArrows) return false;

  for (const sourceZone of ARROW_SOURCE_ZONES) {
    if (enabler.consumesSelfAsMaterial && sourceZone === enablerZone) continue;
    const cards = state.zones[sourceZone];
    for (const card of cards) {
      if (!isFaceUp(card)) continue;
      const entry = linkArrows[String(card.cardId)];
      if (!entry) continue;
      for (const arrow of entry.arrows) {
        const target = arrowTargetZone(sourceZone, arrow);
        if (!target) continue;
        if (effectivelyEmpty(target)) return true;
      }
    }
  }
  return false;
}

/** Zones from which a player Link monster can point to other player zones.
 *  S-row is excluded (spells/traps never carry Link arrows). */
const ARROW_SOURCE_ZONES: readonly ZoneId[] = [
  'M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R',
];

/** MR5 zone layout in (col, row) coordinates. Row 2 = EMZ (col 2, 4 only);
 *  row 3 = player MZONE (col 1..5). Opp rows and player S-row are outside
 *  the solver's modeling surface. */
const ZONE_GRID: Readonly<Record<string, { col: number; row: number }>> = {
  EMZ_L: { col: 2, row: 2 },
  EMZ_R: { col: 4, row: 2 },
  M1:    { col: 1, row: 3 },
  M2:    { col: 2, row: 3 },
  M3:    { col: 3, row: 3 },
  M4:    { col: 4, row: 3 },
  M5:    { col: 5, row: 3 },
};

const ARROW_DELTAS: Readonly<Record<string, { dCol: number; dRow: number }>> = {
  T:  { dCol:  0, dRow: -1 },
  TL: { dCol: -1, dRow: -1 },
  TR: { dCol:  1, dRow: -1 },
  L:  { dCol: -1, dRow:  0 },
  R:  { dCol:  1, dRow:  0 },
  B:  { dCol:  0, dRow:  1 },
  BL: { dCol: -1, dRow:  1 },
  BR: { dCol:  1, dRow:  1 },
};

/** Returns the player MZONE (M1..M5, EMZ_L, EMZ_R) at (col, row), or null
 *  if the grid cell is outside the player's modeled surface (opp side,
 *  S-row, or empty row-2 columns 1/3/5). */
function arrowTargetZone(sourceZone: ZoneId, arrow: string): ZoneId | null {
  const src = ZONE_GRID[sourceZone];
  if (!src) return null;
  const delta = ARROW_DELTAS[arrow];
  if (!delta) return null;
  const col = src.col + delta.dCol;
  const row = src.row + delta.dRow;
  if (row === 2) {
    if (col === 2) return 'EMZ_L';
    if (col === 4) return 'EMZ_R';
    return null;
  }
  if (row === 3 && col >= 1 && col <= 5) {
    return (`M${col}` as ZoneId);
  }
  return null;
}
