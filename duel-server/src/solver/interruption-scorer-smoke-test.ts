// =============================================================================
// interruption-scorer-smoke-test.ts — Smoke tests for InterruptionScorer
// Run: npx tsx src/solver/interruption-scorer-smoke-test.ts
// =============================================================================

import { join } from 'node:path';
import type { ZoneId } from '../ws-protocol.js';
import type { FieldCard, FieldState } from './solver-types.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import { InterruptionScorer } from './interruption-scorer.js';
import { loadInterruptionTags, loadInterruptionWeights } from './solver-config-loader.js';

// =============================================================================
// Helpers
// =============================================================================

function makeCard(cardId: number, position: FieldCard['position'] = 'faceup-atk', overlayCount = 0): FieldCard {
  return { cardId, cardName: `Card#${cardId}`, position, overlayCount };
}

function makeFieldState(partialZones: Partial<Record<ZoneId, FieldCard[]>> = {}): FieldState {
  const zones = {} as Record<ZoneId, FieldCard[]>;
  for (const z of ALL_ZONE_IDS) zones[z] = [];
  for (const [z, cards] of Object.entries(partialZones)) {
    zones[z as ZoneId] = cards!;
  }
  return { zones, lifePoints: [8000, 8000], turn: 1, phase: 'MAIN1' };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}`);
    failed++;
  }
}

// =============================================================================
// Boot: load real data for scorer
// =============================================================================

const dataDir = join(import.meta.dirname, '..', '..', 'data');
const tags = loadInterruptionTags(dataDir);
const weights = loadInterruptionWeights(dataDir);
const scorer = new InterruptionScorer(tags, weights);

// =============================================================================
// Test 5.1: Baronne + Apollousa scoring
// =============================================================================

console.log('\n🔬 Test 5.1: Baronne + Apollousa scoring');
{
  const state = makeFieldState({
    M1: [makeCard(84815190, 'faceup-atk')],   // Baronne de Fleur
    EMZ_L: [makeCard(4280258, 'faceup-atk')],  // Apollousa
  });
  const result = scorer.score(state);

  // Baronne: omniNegate(14*1) + destruction(6*1) = 20
  // Apollousa: typedNegate(10*4) = 40
  // Total = 60
  assert(result.score === 60, `Total score = ${result.score} (expected 60)`);
  assert(result.scoreBreakdown.total === 60, `Breakdown total = ${result.scoreBreakdown.total} (expected 60)`);
  assert(result.scoreBreakdown.omniNegate === 1, `omniNegate count = ${result.scoreBreakdown.omniNegate} (expected 1)`);
  assert(result.scoreBreakdown.destruction === 1, `destruction count = ${result.scoreBreakdown.destruction} (expected 1)`);
  assert(result.scoreBreakdown.typedNegate === 4, `typedNegate count = ${result.scoreBreakdown.typedNegate} (expected 4)`);
}

// =============================================================================
// Test 5.2: Fallback heuristic for untagged face-up monster
// =============================================================================

console.log('\n🔬 Test 5.2: Fallback heuristic (untagged face-up monster)');
{
  const state = makeFieldState({
    M2: [makeCard(99999999, 'faceup-atk')], // Not in tags
  });
  const result = scorer.score(state);

  assert(result.score === 1, `Total score = ${result.score} (expected 1)`);
  // All 15 type counts should be 0
  for (const type of ['omniNegate', 'typedNegate', 'targetedNegate', 'floodgate',
    'controlChange', 'banish', 'banishFacedown', 'attach', 'spin', 'flipFacedown',
    'destruction', 'moveToSt', 'bounce', 'handRip', 'sendToGy'] as const) {
    assert(result.scoreBreakdown[type] === 0, `${type} count = 0`);
  }
}

// =============================================================================
// Test 5.3: Empty board (brick path)
// =============================================================================

console.log('\n🔬 Test 5.3: Empty board = 0 score (brick)');
{
  const state = makeFieldState();
  const result = scorer.score(state);

  assert(result.score === 0, `Total score = ${result.score} (expected 0)`);
}

// =============================================================================
// Test 5.4: Face-down monster excluded from fallback
// =============================================================================

console.log('\n🔬 Test 5.4: Face-down monster gets no fallback');
{
  const state = makeFieldState({
    M1: [makeCard(99999999, 'facedown-def')], // Not in tags, face-down
  });
  const result = scorer.score(state);

  assert(result.score === 0, `Total score = ${result.score} (expected 0)`);
}

// =============================================================================
// Test 5.5: Load real interruption-tags.json without error
// =============================================================================

console.log('\n🔬 Test 5.5: Real data file integrity');
{
  // Already loaded at top — if we got here, it didn't throw
  assert(Object.keys(tags).length >= 150, `Tags loaded: ${Object.keys(tags).length} entries (>= 150)`);
}

// =============================================================================
// Test 5.6: Tagged card on S/T zone (S3)
// =============================================================================

console.log('\n🔬 Test 5.6: Tagged card on S3 (Knightmare Gryphon)');
{
  // Knightmare Gryphon (65330383): floodgate x1
  const state = makeFieldState({
    S3: [makeCard(65330383, 'faceup-atk')],
  });
  const result = scorer.score(state);

  // floodgate weight = 12, usesPerTurn = 1 → total = 12
  assert(result.scoreBreakdown.floodgate === 1, `floodgate count = ${result.scoreBreakdown.floodgate} (expected 1)`);
  assert(result.score === 12, `Total score = ${result.score} (expected 12)`);
}

// =============================================================================
// Test 5.7: Single card with multiple effects (isolated)
// =============================================================================

console.log('\n🔬 Test 5.7: Baronne alone — multi-effect scoring');
{
  // Baronne de Fleur (84815190): omniNegate(14*1) + destruction(6*1) = 20
  const state = makeFieldState({
    M1: [makeCard(84815190, 'faceup-atk')],
  });
  const result = scorer.score(state);

  assert(result.score === 20, `Total score = ${result.score} (expected 20)`);
  assert(result.scoreBreakdown.omniNegate === 1, `omniNegate count = ${result.scoreBreakdown.omniNegate} (expected 1)`);
  assert(result.scoreBreakdown.destruction === 1, `destruction count = ${result.scoreBreakdown.destruction} (expected 1)`);
  assert(result.scoreBreakdown.typedNegate === 0, `typedNegate count = ${result.scoreBreakdown.typedNegate} (expected 0)`);
}

// =============================================================================
// Test 5.8: Multiple cards in same zone
// =============================================================================

console.log('\n🔬 Test 5.8: Two untagged face-up monsters on M1');
{
  const state = makeFieldState({
    M1: [makeCard(99999998, 'faceup-atk'), makeCard(99999997, 'faceup-atk')],
  });
  const result = scorer.score(state);

  assert(result.score === 2, `Total score = ${result.score} (expected 2 — fallback for each)`);
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
