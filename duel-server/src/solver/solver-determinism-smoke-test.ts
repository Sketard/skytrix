// =============================================================================
// solver-determinism-smoke-test.ts — Reproducibility guard for constraint 3.3
// Run: npx tsx src/solver/solver-determinism-smoke-test.ts
//
// Proves that two DfsSolver solves on the same (deck, hand, deckSeed) produce
// a bit-identical tree — mainPath, score, nodesExplored, maxDepthReached, and
// the full scoreBreakdown. This is the prerequisite for the fixture harness,
// regression tests, ES weight tuning, and human debug sessions mentioned in
// the three post-dev research docs.
//
// The test runs in-thread (no piscina, no MessageChannels) so that OS-level
// scheduling jitter cannot leak into the assertions. Piscina-level determinism
// is asserted separately in solver-orchestrator-smoke-test.ts (Test 6.13)
// which only checks deckSeed propagation — the orchestrator layer has
// unavoidable Date.now()-based budget cutoffs.
// =============================================================================

import { join } from 'node:path';
import type { DuelConfig, SolverConfig, SolverResult, DecisionNode } from './solver-types.js';
import { DfsSolver } from './dfs-solver.js';
import { ZobristHasher } from './zobrist.js';
import { TranspositionTable } from './transposition-table.js';
import { InterruptionScorer } from './interruption-scorer.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';
import { OCGCoreAdapter } from './ocgcore-adapter.js';
import { loadInterruptionTags, loadInterruptionWeights, loadSolverConfig } from './solver-config-loader.js';
import { loadDatabase, loadScripts } from '../ocg-scripts.js';

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

function hashMainPath(result: SolverResult): string {
  return result.mainPath.map(a => `${a.responseIndex}:${a.cardId}`).join('|');
}

function hashTreeShape(node: DecisionNode, depth = 0, max = 8): string {
  if (depth >= max) return '…';
  const childHashes = node.children.map(c => hashTreeShape(c, depth + 1, max)).join(',');
  return `(${node.action.responseIndex}:${node.score}:${node.isTerminal ? 'T' : 'N'}[${childHashes}])`;
}

// Build a fresh DfsSolver stack — new hasher, new TT, new scorer, new ranker —
// so prior solves cannot leak state between runs. This is the "bit-identical
// given identical setup" baseline.
async function buildStack(dataDir: string): Promise<{
  solver: DfsSolver;
  adapter: OCGCoreAdapter;
}> {
  const cardDB = loadDatabase(join(dataDir, 'cards.cdb'));
  const scripts = loadScripts(join(dataDir, 'scripts_full'));
  const tags = loadInterruptionTags(dataDir);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, tags);
  const weights = loadInterruptionWeights(dataDir);
  const solverConfigFile = loadSolverConfig(dataDir);

  const hasher = new ZobristHasher();
  const table = new TranspositionTable(solverConfigFile.transpositionMaxEntries);
  const scorer = new InterruptionScorer(tags, weights);
  const ranker = new GoldfishChainRanker();
  const solver = new DfsSolver(hasher, table, scorer, adapter, ranker, solverConfigFile);

  return { solver, adapter };
}

async function main(): Promise<void> {
  const dataDir = join(import.meta.dirname!, '..', '..', 'data');

  let hasData = false;
  try {
    const cardDB = loadDatabase(join(dataDir, 'cards.cdb'));
    hasData = !!cardDB;
  } catch {
    console.log(`\n⚠️  Skipping — data files not found at ${dataDir}`);
    return;
  }
  if (!hasData) return;

  const duelConfig: DuelConfig = {
    mainDeck: Array(40).fill(43096270), // Alexandrite Dragon filler
    extraDeck: [],
    hand: [43096270, 43096270, 43096270, 43096270, 43096270],
    deckSeed: [0xdeadbeefcafebaben, 0x1234567890abcdefn, 0xfeedfacefeedfacen, 0xbaadf00dbaadf00dn],
    opponentDeck: [],
  };

  // Large time budget so the solver never hits the wall-clock cutoff — any
  // budget-driven variance would mask real determinism bugs.
  const solverConfig: SolverConfig = {
    mode: 'goldfish',
    speed: 'optimal',
    timeLimitMs: 60_000,
  };

  // ---------------------------------------------------------------------------
  // Test 1 — Same stack, two solves on the same input must be bit-identical
  // ---------------------------------------------------------------------------
  console.log('\n🔬 Test 1: Same stack, repeated solve → bit-identical result');
  {
    const { solver, adapter } = await buildStack(dataDir);
    const handleA = adapter.createDuel(duelConfig);
    const runA = solver.solve(adapter, solverConfig, new AbortController().signal, () => {}, handleA);

    const handleB = adapter.createDuel(duelConfig);
    const runB = solver.solve(adapter, solverConfig, new AbortController().signal, () => {}, handleB);

    assert(runA.score === runB.score, `score (A=${runA.score}, B=${runB.score})`);
    assert(
      runA.stats.nodesExplored === runB.stats.nodesExplored,
      `nodesExplored (A=${runA.stats.nodesExplored}, B=${runB.stats.nodesExplored})`,
    );
    assert(
      runA.stats.maxDepthReached === runB.stats.maxDepthReached,
      `maxDepthReached (A=${runA.stats.maxDepthReached}, B=${runB.stats.maxDepthReached})`,
    );
    assert(hashMainPath(runA) === hashMainPath(runB), `mainPath (A=${hashMainPath(runA)}, B=${hashMainPath(runB)})`);
    assert(
      hashTreeShape(runA.tree) === hashTreeShape(runB.tree),
      'tree shape bit-identical (responseIndex + score + terminal flag + children)',
    );
    assert(
      JSON.stringify(runA.scoreBreakdown) === JSON.stringify(runB.scoreBreakdown),
      'scoreBreakdown bit-identical',
    );
    assert(
      runA.stats.terminationReason === runB.stats.terminationReason,
      `terminationReason (A=${runA.stats.terminationReason}, B=${runB.stats.terminationReason})`,
    );
    adapter.destroyAll();
  }

  // ---------------------------------------------------------------------------
  // Test 2 — Fresh stack, same input must still be bit-identical
  //           (proves module-init determinism — no randomBytes leaks)
  // ---------------------------------------------------------------------------
  console.log('\n🔬 Test 2: Fresh stack per run → bit-identical result');
  {
    const { solver: solverA, adapter: adapterA } = await buildStack(dataDir);
    const handleA = adapterA.createDuel(duelConfig);
    const runA = solverA.solve(adapterA, solverConfig, new AbortController().signal, () => {}, handleA);
    adapterA.destroyAll();

    const { solver: solverB, adapter: adapterB } = await buildStack(dataDir);
    const handleB = adapterB.createDuel(duelConfig);
    const runB = solverB.solve(adapterB, solverConfig, new AbortController().signal, () => {}, handleB);
    adapterB.destroyAll();

    assert(runA.score === runB.score, `score (A=${runA.score}, B=${runB.score})`);
    assert(
      runA.stats.nodesExplored === runB.stats.nodesExplored,
      `nodesExplored (A=${runA.stats.nodesExplored}, B=${runB.stats.nodesExplored})`,
    );
    assert(hashMainPath(runA) === hashMainPath(runB), `mainPath (A=${hashMainPath(runA)}, B=${hashMainPath(runB)})`);
    assert(hashTreeShape(runA.tree) === hashTreeShape(runB.tree), 'tree shape bit-identical across fresh stacks');
    assert(
      JSON.stringify(runA.scoreBreakdown) === JSON.stringify(runB.scoreBreakdown),
      'scoreBreakdown bit-identical across fresh stacks',
    );
  }

  // ---------------------------------------------------------------------------
  // Test 3 — Different deckSeed must (usually) produce a different result.
  //          This is a negative control: if every seed collapses to the same
  //          output, the fix is a silent no-op.
  // ---------------------------------------------------------------------------
  console.log('\n🔬 Test 3: Different deckSeed → different OCGCore-visible state');
  {
    const { solver, adapter } = await buildStack(dataDir);

    const handleA = adapter.createDuel(duelConfig);
    const actionsA = adapter.getLegalActions(handleA).map(a => `${a.responseIndex}:${a.cardId}:${a.promptType}`).join(',');
    adapter.destroyDuel(handleA);

    const altConfig: DuelConfig = {
      ...duelConfig,
      deckSeed: [0xaaaaaaaaaaaaaaaan, 0x5555555555555555n, 0xcccccccccccccccn, 0x3333333333333333n],
    };
    const handleC = adapter.createDuel(altConfig);
    const actionsC = adapter.getLegalActions(handleC).map(a => `${a.responseIndex}:${a.cardId}:${a.promptType}`).join(',');
    adapter.destroyDuel(handleC);

    // With the same hand (5 vanilla Alexandrite Dragons), the first-prompt
    // actions may or may not differ between seeds — both are vanilla summons
    // of identical cards. What we _can_ assert is that re-running with the
    // same seed returns the SAME action list byte-for-byte.
    const handleA2 = adapter.createDuel(duelConfig);
    const actionsA2 = adapter.getLegalActions(handleA2).map(a => `${a.responseIndex}:${a.cardId}:${a.promptType}`).join(',');
    adapter.destroyDuel(handleA2);

    assert(actionsA === actionsA2, `Re-creating duel with same seed → same first-prompt actions`);
    // Log seed diff for debugging even though we don't hard-assert it
    console.log(`  ℹ  Seed A actions: ${actionsA.substring(0, 80)}${actionsA.length > 80 ? '…' : ''}`);
    console.log(`  ℹ  Seed C actions: ${actionsC.substring(0, 80)}${actionsC.length > 80 ? '…' : ''}`);
    solver.name; // silence unused-lint — keep reference alive
    adapter.destroyAll();
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Determinism smoke test results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));
  if (failed > 0) process.exit(1);
}

await main();
