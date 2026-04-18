// =============================================================================
// latent-interruption-smoke-test.ts — Phase D V1 integration tests.
// Run: npx tsx src/solver/latent-interruption-smoke-test.ts
// =============================================================================

import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { ZoneId } from '../ws-protocol.js';
import type { FieldCard, FieldState } from './solver-types.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import { InterruptionScorer } from './interruption-scorer.js';
import {
  loadInterruptionTags,
  loadInterruptionWeights,
} from './solver-config-loader.js';
import { loadOppTurnEnablers, loadLinkArrows } from './latent-interruption-computer.js';
import { buildCardMetadataMap } from './card-metadata.js';
import type { CardDB } from '../types.js';

const MASQUERENA = 65741786;
const KNIGHTMARE_PHOENIX = 2857636;   // Link-2, activeZones: ['EXTRA']
const KNIGHTMARE_CERBERUS = 75452921; // Link-2, activeZones: ['EXTRA']
const STARVING_VENOM = 41209827;      // Fusion-8, activeZones: ['EXTRA']
const APOLLOUSA = 4280258;            // Non-Link, shouldn't match LINK enabler
const SUPER_POLY = 48130397;
const GUARDIAN_CHIMERA = 11321089;    // Fusion-9, activeZones: ['EXTRA']

function makeCard(cardId: number, position: FieldCard['position'] = 'faceup-atk'): FieldCard {
  return { cardId, cardName: `Card#${cardId}`, position, overlayCount: 0 };
}

function makeFieldState(
  partialZones: Partial<Record<ZoneId, FieldCard[]>>,
  turn: number = 1,
): FieldState {
  const zones = {} as Record<ZoneId, FieldCard[]>;
  for (const z of ALL_ZONE_IDS) zones[z] = [];
  for (const [z, cards] of Object.entries(partialZones)) {
    zones[z as ZoneId] = cards!;
  }
  return { zones, lifePoints: [8000, 8000], turn, phase: 'MAIN1' };
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}`); failed++; }
}

// Boot
const dataDir = join(import.meta.dirname, '..', '..', 'data');
const tags = loadInterruptionTags(dataDir);
const weights = loadInterruptionWeights(dataDir);
const enablers = loadOppTurnEnablers(dataDir);
const linkArrows = loadLinkArrows(dataDir);

const cdbPath = join(dataDir, 'cards.cdb');
const db = new Database(cdbPath, { readonly: true });
const cardDB: CardDB = {
  stmt: db.prepare('SELECT id, type, level, attribute, race FROM datas WHERE id = ?'),
  close: () => db.close(),
} as CardDB;

const metadataIds = [
  MASQUERENA, KNIGHTMARE_PHOENIX, KNIGHTMARE_CERBERUS,
  STARVING_VENOM, APOLLOUSA, SUPER_POLY, GUARDIAN_CHIMERA,
];
const metadata = buildCardMetadataMap(cardDB, metadataIds);

const scorer = new InterruptionScorer(
  tags, weights, metadata,
  undefined, undefined, // no structural V1 for these focused tests
  enablers,
  linkArrows,
);

console.log('\n🔬 Test D.1: Masquerena on-field + Knightmare Phoenix in Extra → positive latent');
{
  const state = makeFieldState({
    EMZ_L: [makeCard(MASQUERENA)],
    EXTRA:  [makeCard(KNIGHTMARE_PHOENIX, 'facedown')],
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints > 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (>0, Masquerena→Phoenix via consumesSelf)`);
  // Phoenix destruction usesPerTurn=1 × weight × 0.5 discount. Verify discount applied.
  const destructionWeight = weights.destruction;
  const expected = destructionWeight * 1 * 0.5;
  assert(Math.abs(result.scoreBreakdown.latentPoints - expected) < 1e-9,
    `latentPoints=${result.scoreBreakdown.latentPoints} (expected ${expected} = ${destructionWeight}×1×0.5)`);
}

console.log('\n🔬 Test D.2: No enabler → 0 latent');
{
  const state = makeFieldState({
    M1: [makeCard(APOLLOUSA)],  // Apollousa on field, but not an enabler
    EXTRA: [makeCard(KNIGHTMARE_PHOENIX, 'facedown')],
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints === 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (expected 0 — no enabler)`);
}

console.log('\n🔬 Test D.3: Masquerena present but no compatible target in Extra → 0 latent');
{
  const state = makeFieldState({
    EMZ_L: [makeCard(MASQUERENA)],
    EXTRA:  [], // Empty Extra Deck
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints === 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (expected 0 — no Extra Deck target)`);
}

console.log('\n🔬 Test D.4: Turn 2 → latent gated off regardless of enabler/target');
{
  const state = makeFieldState({
    EMZ_L: [makeCard(MASQUERENA)],
    EXTRA:  [makeCard(KNIGHTMARE_PHOENIX, 'facedown')],
  }, /* turn */ 2);
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints === 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (expected 0 — turn 2 gate)`);
}

console.log('\n🔬 Test D.5: EMZ occupied by other monster (not enabler consumesSelf) → slot unavailable');
{
  // Masquerena in HAND (not on-field), Apollousa in EMZ_L (blocking), Phoenix in Extra.
  // Masquerena's activeFromZones excludes HAND — so she's not an active enabler here.
  // No enabler → 0 latent.
  const state = makeFieldState({
    HAND:  [makeCard(MASQUERENA)],
    EMZ_L: [makeCard(APOLLOUSA)],
    EXTRA:  [makeCard(KNIGHTMARE_PHOENIX, 'facedown')],
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints === 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (expected 0 — Masquerena in HAND is not active)`);
}

console.log('\n🔬 Test D.6: Masquerena in M3 + non-Link blockers in both EMZ → 0 latent (no arrow path)');
{
  // STARVING_VENOM is a Fusion, not a Link — has no arrows in link-arrows.json.
  // Masquerena self-consumes from M3 (arrows excluded), both EMZs blocked by
  // non-Link bodies. No face-up Link on the field contributes arrows → no slot.
  const state = makeFieldState({
    M3:    [makeCard(MASQUERENA)],
    EMZ_L: [makeCard(STARVING_VENOM)],
    EMZ_R: [makeCard(STARVING_VENOM)],
    EXTRA:  [makeCard(KNIGHTMARE_PHOENIX, 'facedown')],
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints === 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (expected 0 — both EMZ occupied by non-Link, no arrow path)`);
}

console.log('\n🔬 Test D.7: Super Poly in HAND + Starving Venom in Extra → positive latent (Fusion path)');
{
  const state = makeFieldState({
    HAND:  [makeCard(SUPER_POLY)],
    EXTRA:  [makeCard(STARVING_VENOM, 'facedown')],
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints > 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (>0, Super Poly→Starving Venom Fusion)`);
}

console.log('\n🔬 Test D.8: Masquerena on-field + Starving Venom in Extra (Fusion, not Link) → 0 latent (category mismatch)');
{
  const state = makeFieldState({
    EMZ_L: [makeCard(MASQUERENA)],
    EXTRA:  [makeCard(STARVING_VENOM, 'facedown')],
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints === 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (expected 0 — Masquerena is LINK enabler, Starving Venom is FUSION)`);
}

console.log('\n🔬 Test D.9: interruptionScore excludes latent (Masquerena+Phoenix scenario)');
{
  const state = makeFieldState({
    EMZ_L: [makeCard(MASQUERENA)],
    EXTRA:  [makeCard(KNIGHTMARE_PHOENIX, 'facedown')],
  });
  const result = scorer.score(state);
  // Masquerena is tagged (targetedNegate quick, weighted). Phoenix contributes 0 to weighted
  // (activeZones: ['EXTRA'] gates it out on-field, face-down EXTRA skipped by filter).
  // interruptionScore = weighted + fallbackPoints (no latent).
  const expectedInterruption = result.scoreBreakdown.weighted + result.scoreBreakdown.fallbackPoints;
  assert(result.scoreBreakdown.interruptionScore === expectedInterruption,
    `interruptionScore=${result.scoreBreakdown.interruptionScore} = weighted(${result.scoreBreakdown.weighted}) + fallback(${result.scoreBreakdown.fallbackPoints})`);
  assert(result.scoreBreakdown.explorationScore === expectedInterruption + result.scoreBreakdown.latentPoints,
    `explorationScore=${result.scoreBreakdown.explorationScore} = interruption + latent`);
  assert(result.scoreBreakdown.interruptionScore < result.scoreBreakdown.explorationScore,
    `interruptionScore < explorationScore (latent=${result.scoreBreakdown.latentPoints} > 0)`);
}

console.log('\n🔬 Test D.10 (Phase E axis 2): Masquerena in M3 + Apollousa in EMZ_L → positive via arrow path');
{
  // Apollousa (Link-4, arrows B/BL/BR from col 2 row 2) points to M1/M2/M3.
  // Masquerena self-consumes M3 → M3 effectively empty → arrow path supplies slot.
  // EMZ_R unoccupied too (would trigger EMZ branch first), so also restrict EMZ_R
  // with a non-Link to isolate the arrow path signal.
  const state = makeFieldState({
    M3:    [makeCard(MASQUERENA)],
    EMZ_L: [makeCard(APOLLOUSA)],
    EMZ_R: [makeCard(STARVING_VENOM)],
    EXTRA:  [makeCard(KNIGHTMARE_PHOENIX, 'facedown')],
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints > 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (>0, Apollousa arrow → M1/M2/M3 slot)`);
}

console.log('\n🔬 Test D.11 (Phase E axis 2): face-down Link in EMZ_L cannot provide arrow path');
{
  // Even though Apollousa is normally a Link, a face-down card cannot extend
  // arrows (logically: face-down Link isn't possible in canonical play, but
  // the solver guards against corrupt states). Both EMZs blocked, no other
  // face-up Link → 0 latent.
  const state = makeFieldState({
    M3:    [makeCard(MASQUERENA)],
    EMZ_L: [makeCard(APOLLOUSA, 'facedown')],
    EMZ_R: [makeCard(STARVING_VENOM)],
    EXTRA:  [makeCard(KNIGHTMARE_PHOENIX, 'facedown')],
  });
  const result = scorer.score(state);
  assert(result.scoreBreakdown.latentPoints === 0,
    `latentPoints=${result.scoreBreakdown.latentPoints} (expected 0 — face-down Link doesn't provide arrow)`);
}

console.log(`\n📊 Phase D results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
