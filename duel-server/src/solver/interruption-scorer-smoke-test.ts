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
  // Total = 60. No latent contribution here (turn default = 0 → Step1/Phase2.3
  // gated off), so interruptionScore == explorationScore == 60 == score.
  assert(result.score === 60, `Total score = ${result.score} (expected 60)`);
  assert(result.scoreBreakdown.interruptionScore === 60, `Breakdown interruptionScore = ${result.scoreBreakdown.interruptionScore} (expected 60)`);
  assert(result.scoreBreakdown.explorationScore === 60, `Breakdown explorationScore = ${result.scoreBreakdown.explorationScore} (expected 60)`);
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
// Test 5.9: Voie B zone gate — default on-field, GY excluded for untagged-zones card
// =============================================================================

console.log('\n🔬 Test 5.9: Apollousa in GY — no score (default on-field)');
{
  const state = makeFieldState({
    GY: [makeCard(4280258, 'faceup-atk')], // Apollousa, default activeZones
  });
  const result = scorer.score(state);

  // Apollousa has no activeZones and no activatableFromHand → on-field-only
  // default. In GY, it must NOT score (pre-Voie B it would have scored 40).
  assert(result.score === 0, `Total score = ${result.score} (expected 0 — default on-field gate)`);
  assert(result.scoreBreakdown.typedNegate === 0, `typedNegate = ${result.scoreBreakdown.typedNegate} (expected 0)`);
}

// =============================================================================
// Test 5.10: Voie B zone gate — Mirrorjade GY trigger scores in GY
// =============================================================================

console.log('\n🔬 Test 5.10: Mirrorjade in GY scores destruction (explicit activeZones: [GY])');
{
  // Mirrorjade: effect[0] = banish quick (default on-field), effect[1] =
  // destruction trigger with activeZones: ['GY'].
  // In GY: only effect[1] should fire. Weight = destruction (6) * 1 = 6.
  const state = makeFieldState({
    GY: [makeCard(44146295, 'faceup-atk')],
  });
  const result = scorer.score(state);

  assert(result.scoreBreakdown.banish === 0, `banish count = ${result.scoreBreakdown.banish} (expected 0 — quick is field-only)`);
  assert(result.scoreBreakdown.destruction === 1, `destruction count = ${result.scoreBreakdown.destruction} (expected 1 — GY-trigger fires)`);
}

// =============================================================================
// Test 5.11: Voie B zone gate — Mirrorjade on M1 scores banish but NOT GY trigger
// =============================================================================

console.log('\n🔬 Test 5.11: Mirrorjade on M1 — banish fires, GY trigger gated out');
{
  const state = makeFieldState({
    M1: [makeCard(44146295, 'faceup-atk')],
  });
  const result = scorer.score(state);

  // On-field: effect[0] banish fires (default on-field). effect[1] destruction
  // has activeZones: ['GY'] so it must NOT fire here. This is the
  // double-count fix — pre-Voie B, both effects scored regardless of zone.
  assert(result.scoreBreakdown.banish === 1, `banish count = ${result.scoreBreakdown.banish} (expected 1 — quick fires on field)`);
  assert(result.scoreBreakdown.destruction === 0, `destruction count = ${result.scoreBreakdown.destruction} (expected 0 — GY trigger gated out)`);
}

// =============================================================================
// Test 5.12: MIGRATE placeholder tags score 0 pre-Phase-D
// =============================================================================

console.log('\n🔬 Test 5.12: Voie B MIGRATE tags (activeZones: [EXTRA]) score 0 face-down');
{
  // 6 tags migrated 2026-04-17 to activeZones: ['EXTRA'] as placeholders
  // awaiting Phase D enabler×target consumption. Today they score 0 because
  // the face-down EXTRA filter ([interruption-scorer.ts] inside _scoreWithCardsImpl)
  // skips face-down Extra cards before the zone-gate check. Phase D will
  // read these tags via a separate latent-interruption-computer module that
  // bypasses the face-down filter and applies enabler/slot conditions.
  //
  // This test guards against an accidental filter removal that would start
  // crediting these 6 tags before Phase D ships, silently inflating scores.
  // El Shaddoll Construct (20366274) removed during T2.4 re-audit —
  // oracle showed both tagged effects are combo enablers (deck-mill on SS +
  // Shaddoll S/T retrieval from GY), neither is a real opp-turn interruption.
  const migrateIds = [
    2857636,   // Knightmare Phoenix
    75452921,  // Knightmare Cerberus
    11321089,  // Guardian Chimera
    33760966,  // Dracotail Arthalion
    41209827,  // Starving Venom Fusion Dragon
  ];
  for (const id of migrateIds) {
    const state = makeFieldState({
      EXTRA: [makeCard(id, 'facedown')],
    });
    const result = scorer.score(state);
    assert(result.score === 0, `MIGRATE id ${id} in EXTRA face-down: score = ${result.score} (expected 0 — Phase D pending)`);
  }

  // Sanity: place same card face-up on M1 (e.g. already Link-Summoned). The
  // tag's activeZones: ['EXTRA'] GATES OUT scoring on field — on-summon
  // trigger is spent, no persistent on-field effect.
  //
  // Current behavior quirk: tagged cards that hit the zone gate contribute
  // 0 weighted AND 0 fallback — the fallback heuristic is wired inside the
  // `else` branch of the `if (tag)` check, so tagged cards with no active
  // zone never fall through to it. This is arguably incorrect (a Knightmare
  // Phoenix on field is still a 1800 ATK body worth the +1 heuristic like
  // any other face-up monster) but fixing it would shift scores on every
  // fixture with consumed on-summon-triggered tagged monsters. Tracked as
  // follow-up (methodology v5 known-quirk, post-Phase-D cleanup candidate).
  for (const id of migrateIds) {
    const state = makeFieldState({
      M1: [makeCard(id, 'faceup-atk')],
    });
    const result = scorer.score(state);
    assert(result.scoreBreakdown.weighted === 0, `MIGRATE id ${id} on M1: weighted = ${result.scoreBreakdown.weighted} (expected 0 — activeZones [EXTRA] gates out on-field)`);
    assert(result.scoreBreakdown.fallbackPoints === 0, `MIGRATE id ${id} on M1: fallbackPoints = ${result.scoreBreakdown.fallbackPoints} (expected 0 — tagged-but-inactive quirk)`);
  }
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
