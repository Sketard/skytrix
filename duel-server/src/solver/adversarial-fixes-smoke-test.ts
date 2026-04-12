// =============================================================================
// adversarial-fixes-smoke-test.ts — Regression harness for the 4 critical
// Epic 2 fixes landed on 2026-04-12:
//
//   C1 — Minimax-MCTS `mainPath` must be player-only (no opponent activations,
//        no opponent passes) so `verifyAdversarialPath` can replay it.
//
//   C2 — `verifyAdversarialPath` must pass the activation log to the scorer
//        so OPT-aware scoring matches the original solve.
//
//   H1 — `walkRecommendedPath` must use `children[0].player` (not
//        `current.player`) to decide min/max direction — consistent with
//        `select()`'s UCB1 inversion convention.
//
// Verified at the public-API level (`MinimaxMctsSolver.solve()` +
// `verifyAdversarialPath()`) so the tests survive all planned refactors
// (AbstractMctsSolver, ocgcore-adapter split, etc.).
//
// Run: npx tsx src/solver/adversarial-fixes-smoke-test.ts
// =============================================================================

import { join } from 'node:path';
import type { SolverConfig } from './solver-types.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';
import { MinimaxMctsSolver } from './minimax-mcts-solver.js';
import { InterruptionScorer } from './interruption-scorer.js';
import { loadInterruptionTags, loadInterruptionWeights, loadSolverConfig, loadHandtraps } from './solver-config-loader.js';
import { OCGCoreAdapter } from './ocgcore-adapter.js';
import { loadDatabase, loadScripts } from '../ocg-scripts.js';
import { verifyAdversarialPath } from './solver-verifier.js';

// =============================================================================
// Harness
// =============================================================================

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${details ? ` — ${details}` : ''}`);
    failed++;
  }
}

// =============================================================================
// Boot shared solver infrastructure
// =============================================================================

console.log('\n🔬 Adversarial fixes regression tests (C1, C2, H1)\n');

const DATA_DIR = join(import.meta.dirname, '..', '..', 'data');
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const tags = loadInterruptionTags(DATA_DIR);
const weights = loadInterruptionWeights(DATA_DIR);
const solverConfig = loadSolverConfig(DATA_DIR);
const adapter = await OCGCoreAdapter.create(cardDB, scripts, tags);
const scorer = new InterruptionScorer(tags, weights);
const ranker = new GoldfishChainRanker();
const handtraps = loadHandtraps(DATA_DIR);

if (handtraps.length === 0) {
  console.error('❌ No handtraps in data/handtraps.json — cannot run adversarial tests');
  process.exit(1);
}

// Use the first 3 handtraps (typical adversarial config)
const testHandtraps = handtraps.slice(0, 3);
const handtrapIds = new Set(testHandtraps.map(h => h.cardId));

// Vanilla test deck — Alexandrite Dragon × 40 + Alexandrite hand ×5.
// This is the weakest possible combo fixture (no chain triggers) but it's
// enough to exercise the walkRecommendedPath + verify round-trip without
// depending on meta-deck card scripts that may change across OCGCore versions.
const ALEXANDRITE = 43096270;
const testDeck = Array(40).fill(ALEXANDRITE);
const testHand = Array(5).fill(ALEXANDRITE);
const testExtra: number[] = [];

// =============================================================================
// Shared solve setup
// =============================================================================

function runSolve() {
  const solver = new MinimaxMctsSolver(scorer, adapter, ranker, solverConfig);
  solver.setSeed([42n, 137n]);

  const config: SolverConfig = {
    mode: 'adversarial',
    speed: 'fast',
    timeLimitMs: 3000,
    handtraps: testHandtraps,
  };

  const handle = adapter.createDuel({
    mainDeck: testDeck,
    extraDeck: testExtra,
    hand: testHand,
    deckSeed: [42n, 137n],
    opponentDeck: Array(40).fill(ALEXANDRITE),
    handtraps: testHandtraps,
  });

  try {
    const signal = AbortSignal.timeout(config.timeLimitMs);
    return { config, result: solver.solve(adapter, config, signal, () => {}, handle) };
  } finally {
    adapter.destroyAll();
  }
}

// =============================================================================
// Test 1 — C1: mainPath does not carry opponent handtrap activations
// NOTE: we can't reliably test "no opponent pass" because player SELECT_CHAIN
// pass has the identical signature (cardId=0, responseIndex=-1). The real C1
// regression check is Test 3 (verify round-trip), which would fail at a
// replay step if opponent entries made it into mainPath.
// =============================================================================

console.log('📋 Test 1 — mainPath contains no handtrap cardIds (C1 partial)');
{
  const { result } = runSolve();

  // If an opponent activation (handtrap) was erroneously pushed into
  // mainPath by the walker, its cardId would match a configured handtrap.
  const handtrapActivations = result.mainPath.filter(a => handtrapIds.has(a.cardId));
  assert(
    handtrapActivations.length === 0,
    'mainPath has no handtrap-activation entries (opponent cardIds)',
    handtrapActivations.length > 0
      ? `${handtrapActivations.map(a => a.cardName).join(', ')}`
      : undefined,
  );

  // Structural sanity
  assert(Array.isArray(result.mainPath), 'mainPath is an array');
  assert(result.mainPath.length < 100, 'mainPath length reasonable');

  console.log(`  ℹ️ mainPath length = ${result.mainPath.length}, entries = ${result.mainPath.map(a => a.cardName || '(pass)').join(', ')}`);
}

// =============================================================================
// Test 2 — H1: adversarialTimings align with mainPath player indices
// =============================================================================

console.log('\n📋 Test 2 — adversarialTimings stepIndex < mainPath.length (H1)');
{
  const { result } = runSolve();

  if (!result.adversarialTimings || result.adversarialTimings.length === 0) {
    console.log('  ℹ️ No adversarial timings in this result (opponent likely all-pass on vanilla deck)');
    console.log('  ℹ️ Skipping timing alignment checks — vanilla fixture has no chain triggers');
  } else {
    // All stepIndex must be < mainPath.length (the timing references a
    // position IN the player-only path, so it must fit)
    const outOfBounds = result.adversarialTimings.filter(t => t.stepIndex >= result.mainPath.length);
    assert(
      outOfBounds.length === 0,
      'All timings have stepIndex < mainPath.length',
      outOfBounds.length > 0
        ? `${outOfBounds.length} timings out of bounds: ${outOfBounds.map(t => `step${t.stepIndex}`).join(', ')}`
        : undefined,
    );

    // All handtrapCardId must be in the configured handtrap set
    const unknownHandtraps = result.adversarialTimings.filter(t => !handtrapIds.has(t.handtrapCardId));
    assert(
      unknownHandtraps.length === 0,
      'All timings reference configured handtrap cardIds',
      unknownHandtraps.length > 0
        ? `${unknownHandtraps.map(t => t.handtrapCardName).join(', ')}`
        : undefined,
    );

    console.log(`  ℹ️ ${result.adversarialTimings.length} adversarial timings recorded`);
  }
}

// =============================================================================
// Test 3 — C2 + C1 end-to-end: verifyAdversarialPath succeeds on the result
// =============================================================================

console.log('\n📋 Test 3 — verifyAdversarialPath succeeds on minimax-mcts result (C2 + end-to-end)');
{
  const { config, result } = runSolve();

  const duelConfig = {
    mainDeck: testDeck,
    extraDeck: testExtra,
    hand: testHand,
    deckSeed: [42n, 137n],
    opponentDeck: Array(40).fill(ALEXANDRITE),
    handtraps: config.handtraps,
  };

  // Only run verify if we have a non-empty mainPath. Vanilla fixtures may
  // produce an empty mainPath if the solver runs out of budget before expanding.
  if (result.mainPath.length === 0) {
    console.log('  ℹ️ Empty mainPath — skipping verify round-trip');
  } else {
    const verifyResult = verifyAdversarialPath(
      adapter,
      scorer,
      duelConfig,
      result.mainPath,
      result.adversarialTimings ?? [],
      result.score,
    );

    assert(
      verifyResult.verified === true,
      'verify returned { verified: true }',
      verifyResult.verified ? undefined : verifyResult.reason,
    );

    if (!verifyResult.verified) {
      console.log(`  ℹ️ Divergence at step ${verifyResult.divergenceStep}: ${verifyResult.reason}`);
    }
  }
}

// =============================================================================
// Test 4 — Empty-path contract
// =============================================================================

console.log('\n📋 Test 4 — verifyAdversarialPath returns verified: true for empty path');
{
  const duelConfig = {
    mainDeck: testDeck,
    extraDeck: testExtra,
    hand: testHand,
    deckSeed: [42n, 137n],
    opponentDeck: Array(40).fill(ALEXANDRITE),
    handtraps: testHandtraps,
  };

  const verifyResult = verifyAdversarialPath(adapter, scorer, duelConfig, [], [], 0);
  assert(verifyResult.verified === true, 'empty verifyPath → verified: true');
}

// =============================================================================
// Test 5 — Score tolerance rejects wildly-divergent expected scores
// =============================================================================

console.log('\n📋 Test 5 — Score tolerance rejects beyond-tolerance drift');
{
  // Run verify with an obviously-inflated expectedScore (+100). The replay
  // cannot realistically reach that, so the tolerance check must reject.
  // We don't test the accept side of the tolerance band because replay
  // determinism vs rollout stochasticity means finalScore can diverge
  // significantly from result.score (the "advertised" value is root.bestScore
  // = max over rollouts, not the walker's deterministic terminal).
  const { config, result } = runSolve();

  if (result.mainPath.length === 0) {
    console.log('  ℹ️ Empty mainPath — skipping tolerance rejection test');
  } else {
    const duelConfig = {
      mainDeck: testDeck,
      extraDeck: testExtra,
      hand: testHand,
      deckSeed: [42n, 137n],
      opponentDeck: Array(40).fill(ALEXANDRITE),
      handtraps: config.handtraps,
    };

    // Obviously-inflated expected score → must fail
    const beyond = verifyAdversarialPath(
      adapter, scorer, duelConfig,
      result.mainPath, result.adversarialTimings ?? [],
      result.score + 100,
    );
    assert(
      beyond.verified === false,
      'tolerance +100 rejected',
      beyond.verified ? 'should have failed' : undefined,
    );
    if (!beyond.verified) {
      console.log(`  ℹ️ rejection reason: ${beyond.reason}`);
    }
  }
}

// =============================================================================
// Report
// =============================================================================

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`❌ ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('✅ All adversarial fix tests passed');
  process.exit(0);
}
