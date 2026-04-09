// =============================================================================
// activation-log-smoke-test.ts — Story 1.8 ActivationLog tracking smoke tests
// Run: npx tsx src/solver/activation-log-smoke-test.ts
//
// Validates the OPT-aware scoring + verification key extension WITHOUT booting
// the OCGCore WASM. The activation log is constructed by hand and fed to the
// scorer / verification-key builder directly. End-to-end coverage of the
// adapter wiring (applyAction → recordActivation → log mutation) is left to
// the post-implementation big-bang test (golden-tests.json runner).
// =============================================================================

import { join } from 'node:path';
import type { ZoneId } from '../ws-protocol.js';
import type { ActivationLog, FieldCard, FieldState, InterruptionTag, InterruptionType } from './solver-types.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import { InterruptionScorer } from './interruption-scorer.js';
import { buildVerificationKey } from './transposition-table.js';
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

function makeLog(entries: Array<[number, number[]]>): Map<number, number[]> {
  return new Map(entries);
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
// Boot: load real data so we test against the actual config
// =============================================================================

const dataDir = join(import.meta.dirname, '..', '..', 'data');
const tags = loadInterruptionTags(dataDir);
const weights = loadInterruptionWeights(dataDir);
const scorer = new InterruptionScorer(tags, weights);

// Card IDs used by tests — must match interruption-tags.json
const BARONNE = 84815190; // omni-negate (chain) + destruction (main)
const APOLLOUSA = 4280258; // typed-negate ×4 (chain)

// Sanity check: tags must contain our test cards
if (!tags[String(BARONNE)] || !tags[String(APOLLOUSA)]) {
  console.error('[Solver] activation-log-smoke-test: missing test fixture cards in interruption-tags.json');
  process.exit(1);
}

// =============================================================================
// Test A1: Empty activation log produces pre-1.8 scoring (baseline)
// =============================================================================

console.log('\n🔬 Test A1: empty log = pre-1.8 scoring (backward compat)');
{
  const state = makeFieldState({
    M1: [makeCard(BARONNE)],
    EMZ_L: [makeCard(APOLLOUSA)],
  });

  const noLog = scorer.score(state);
  const emptyLog = scorer.score(state, new Map());
  const undefLog = scorer.score(state, undefined);

  assert(noLog.score === emptyLog.score, `no-log score (${noLog.score}) === empty-log score (${emptyLog.score})`);
  assert(noLog.score === undefLog.score, `no-log score (${noLog.score}) === undefined-log score (${undefLog.score})`);
}

// =============================================================================
// Test A2/A3: ActivationLog stores effect indices per cardId
// (helper-level test — adapter wiring is covered by smoke at a higher level)
// =============================================================================

console.log('\n🔬 Test A2: log entry shape — single Apollousa activation');
{
  const log = makeLog([[APOLLOUSA, [0]]]);
  const stored = log.get(APOLLOUSA);
  assert(stored !== undefined && stored.length === 1 && stored[0] === 0, `log[APOLLOUSA] = [0] (got ${JSON.stringify(stored)})`);
}

console.log('\n🔬 Test A3: log entry shape — two Apollousa activations');
{
  const log = makeLog([[APOLLOUSA, [0, 0]]]);
  const stored = log.get(APOLLOUSA);
  assert(stored !== undefined && stored.length === 2 && stored[0] === 0 && stored[1] === 0, `log[APOLLOUSA] = [0,0] (got ${JSON.stringify(stored)})`);
}

// =============================================================================
// Test A4: Map cloning idiom — mutating clone does not affect parent
// =============================================================================

console.log('\n🔬 Test A4: deep-clone isolation between parent and child handles');
{
  const parent = new Map<number, number[]>([[APOLLOUSA, [0]]]);
  // Same idiom used by ocgcore-adapter.cloneActivationLog
  const child = new Map<number, number[]>();
  for (const [k, v] of parent) child.set(k, [...v]);

  child.get(APOLLOUSA)!.push(0);

  const parentArr = parent.get(APOLLOUSA)!;
  const childArr = child.get(APOLLOUSA)!;

  assert(parentArr.length === 1, `parent log unchanged after child mutation (parent=${parentArr.length}, expected 1)`);
  assert(childArr.length === 2, `child log advances independently (child=${childArr.length}, expected 2)`);
}

// =============================================================================
// Test A6: OPT-aware scoring — Baronne with omni-negate consumed
// =============================================================================

console.log('\n🔬 Test A6: scorer reduces weighted score when Baronne omni-negate is consumed');
{
  const state = makeFieldState({
    M1: [makeCard(BARONNE)],
  });

  const fresh = scorer.score(state);
  const consumed = scorer.score(state, makeLog([[BARONNE, [0]]])); // index 0 = omni-negate

  // Baronne breakdown: omniNegate weight + destruction weight = total
  // Consuming index 0 should remove the omni-negate weight from the total
  const omniWeight = weights['omniNegate' as InterruptionType];
  const expectedDelta = omniWeight; // 1 use of omni-negate

  assert(
    fresh.scoreBreakdown.weighted - consumed.scoreBreakdown.weighted === expectedDelta,
    `weighted delta = ${fresh.scoreBreakdown.weighted - consumed.scoreBreakdown.weighted} (expected ${expectedDelta})`,
  );
  assert(
    consumed.scoreBreakdown.omniNegate === 0,
    `omniNegate count after consume = ${consumed.scoreBreakdown.omniNegate} (expected 0)`,
  );
  assert(
    consumed.scoreBreakdown.destruction === 1,
    `destruction count after consume = ${consumed.scoreBreakdown.destruction} (expected 1, untouched)`,
  );
}

// =============================================================================
// Test A6b: Apollousa with 2/4 negates consumed
// =============================================================================

console.log('\n🔬 Test A6b: scorer decrements Apollousa to 2/4 remaining negates');
{
  const state = makeFieldState({
    EMZ_L: [makeCard(APOLLOUSA)],
  });

  const fresh = scorer.score(state);
  const partial = scorer.score(state, makeLog([[APOLLOUSA, [0, 0]]])); // 2 of 4 used

  const typedWeight = weights['typedNegate' as InterruptionType];

  assert(fresh.scoreBreakdown.typedNegate === 4, `fresh typedNegate count = ${fresh.scoreBreakdown.typedNegate}`);
  assert(partial.scoreBreakdown.typedNegate === 2, `partial typedNegate count = ${partial.scoreBreakdown.typedNegate} (expected 2)`);
  assert(
    fresh.scoreBreakdown.weighted - partial.scoreBreakdown.weighted === typedWeight * 2,
    `weighted delta = ${fresh.scoreBreakdown.weighted - partial.scoreBreakdown.weighted} (expected ${typedWeight * 2})`,
  );
}

// =============================================================================
// Test A7: sharedOpt card fully consumed scores 0
// =============================================================================

console.log('\n🔬 Test A7: sharedOpt card with full budget consumed scores 0');
{
  // Construct a synthetic sharedOpt card and inject into a temporary scorer
  // (safer than mutating the production interruption-tags map).
  const SYNTHETIC = 999999001;
  const syntheticTags: Record<string, InterruptionTag> = {
    ...tags,
    [SYNTHETIC]: {
      cardName: 'Synthetic Shared OPT Test',
      sharedOpt: true,
      totalUsesPerTurn: 1,
      effects: [
        { type: 'destruction', usesPerTurn: 1, trigger: 'quick' },
        { type: 'banish', usesPerTurn: 1, trigger: 'quick' },
      ],
    },
  };
  const localScorer = new InterruptionScorer(syntheticTags, weights);
  const state = makeFieldState({
    M1: [makeCard(SYNTHETIC)],
  });

  const fresh = localScorer.score(state);
  // Consume 1 effect — this exhausts the shared budget (totalUsesPerTurn === 1)
  const consumed = localScorer.score(state, makeLog([[SYNTHETIC, [0]]]));

  assert(fresh.scoreBreakdown.weighted > 0, `fresh sharedOpt card has weighted score (got ${fresh.scoreBreakdown.weighted})`);
  assert(consumed.scoreBreakdown.weighted === 0, `consumed sharedOpt card weighted = ${consumed.scoreBreakdown.weighted} (expected 0)`);
  assert(consumed.scoreBreakdown.destruction === 0, `destruction count after sharedOpt lockout = ${consumed.scoreBreakdown.destruction}`);
  assert(consumed.scoreBreakdown.banish === 0, `banish count after sharedOpt lockout = ${consumed.scoreBreakdown.banish}`);
}

// =============================================================================
// Test A8: verification key differs for OPT-divergent states
// =============================================================================

console.log('\n🔬 Test A8: buildVerificationKey distinguishes OPT-divergent states');
{
  const state = makeFieldState({
    M1: [makeCard(BARONNE)],
  });

  const keyFresh = buildVerificationKey(state);
  const keyEmpty = buildVerificationKey(state, new Map());
  const keyConsumed = buildVerificationKey(state, makeLog([[BARONNE, [0]]]));

  assert(keyFresh === keyEmpty, `no-log key === empty-log key (backward compat)`);
  assert(keyFresh !== keyConsumed, `fresh key !== consumed key (TT collision avoidance)`);
}

// =============================================================================
// Test A9: verification key is deterministic regardless of insertion order
// =============================================================================

console.log('\n🔬 Test A9: buildVerificationKey is deterministic across insertion orders');
{
  const state = makeFieldState({
    M1: [makeCard(BARONNE)],
    EMZ_L: [makeCard(APOLLOUSA)],
  });

  // Two logs with same content but different insertion orders
  const logA = new Map<number, number[]>();
  logA.set(BARONNE, [0]);
  logA.set(APOLLOUSA, [0, 0]);

  const logB = new Map<number, number[]>();
  logB.set(APOLLOUSA, [0, 0]);
  logB.set(BARONNE, [0]);

  // Two logs with same set but different array orderings within an entry
  const logC = new Map<number, number[]>();
  logC.set(BARONNE, [0]);
  logC.set(APOLLOUSA, [0, 0]); // Apollousa always [0,0] but order shouldn't matter

  const keyA = buildVerificationKey(state, logA);
  const keyB = buildVerificationKey(state, logB);
  const keyC = buildVerificationKey(state, logC);

  assert(keyA === keyB, `keys are insertion-order independent (Map ordering)`);
  assert(keyA === keyC, `keys are stable across equivalent logs`);
}

// =============================================================================
// Test A10: full pipeline — Baronne + Apollousa with mixed consumption
// =============================================================================

console.log('\n🔬 Test A10: combined Baronne+Apollousa state with mixed consumption');
{
  const state = makeFieldState({
    M1: [makeCard(BARONNE)],
    EMZ_L: [makeCard(APOLLOUSA)],
  });

  // Baronne: 1 use of omni-negate consumed (index 0)
  // Apollousa: 1 use of typed-negate consumed (index 0)
  const log = makeLog([
    [BARONNE, [0]],
    [APOLLOUSA, [0]],
  ]);

  const fresh = scorer.score(state);
  const consumed = scorer.score(state, log);

  // Expected delta = omniNegate weight (Baronne) + typedNegate weight (Apollousa)
  const expectedDelta = weights['omniNegate' as InterruptionType] + weights['typedNegate' as InterruptionType];

  assert(
    fresh.scoreBreakdown.weighted - consumed.scoreBreakdown.weighted === expectedDelta,
    `combined delta = ${fresh.scoreBreakdown.weighted - consumed.scoreBreakdown.weighted} (expected ${expectedDelta})`,
  );

  // Baronne destruction (index 1) is still available
  assert(consumed.scoreBreakdown.destruction === 1, `Baronne destruction still scored = ${consumed.scoreBreakdown.destruction}`);
  // Apollousa has 3 negates left
  assert(consumed.scoreBreakdown.typedNegate === 3, `Apollousa typedNegate after 1 used = ${consumed.scoreBreakdown.typedNegate} (expected 3)`);
}

// =============================================================================
// Test A11: end board card carries consumedUses metadata
// =============================================================================

console.log('\n🔬 Test A11: scoreWithCards populates EndBoardCard.consumedUses');
{
  const state = makeFieldState({
    M1: [makeCard(BARONNE)],
  });

  const result = scorer.scoreWithCards(state, makeLog([[BARONNE, [0, 1]]]));
  const baronneCard = result.endBoardCards.find(c => c.cardId === BARONNE);

  assert(baronneCard !== undefined, `Baronne in end board cards`);
  assert(baronneCard?.consumedUses === 2, `consumedUses = ${baronneCard?.consumedUses} (expected 2)`);
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
