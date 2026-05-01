// =============================================================================
// fork-parity-smoke-test.ts — Parity gate for WASM snapshot fork vs replay fork.
//
// Runs the same DFS solve twice on the same (deck, hand, deckSeed), once with
// the legacy replay-based fork and once with the new snapshot-based fork.
// Asserts that every observable output is bit-identical — score, mainPath,
// nodesExplored, maxDepthReached, scoreBreakdown, tree shape.
//
// Any divergence proves the snapshot path corrupts WASM state and the feature
// is unsafe to enable in production.
//
// Run: npx tsx src/solver/fork-parity-smoke-test.ts
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

function hashMainPath(r: SolverResult): string {
  return r.mainPath.map(a => `${a.responseIndex}:${a.cardId}`).join('|');
}

function hashTreeShape(node: DecisionNode, depth = 0, max = 10): string {
  if (depth >= max) return '…';
  const children = node.children.map(c => hashTreeShape(c, depth + 1, max)).join(',');
  return `(${node.action.responseIndex}:${node.score}:${node.isTerminal ? 'T' : 'N'}[${children}])`;
}

async function buildStack(dataDir: string, useSnapshot: boolean): Promise<{
  solver: DfsSolver;
  adapter: OCGCoreAdapter;
}> {
  const cardDB = loadDatabase(join(dataDir, 'cards.cdb'));
  const scripts = loadScripts(join(dataDir, 'scripts_full'));
  const tags = loadInterruptionTags(dataDir);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, tags, { useSnapshot });
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

  try {
    loadDatabase(join(dataDir, 'cards.cdb'));
  } catch {
    console.log(`\n⚠️  Skipping — data files not found at ${dataDir}`);
    return;
  }

  // Use a moderate deck + deck seed. Vanilla is too shallow to exercise the
  // snapshot stack depth; the filler + shuffle gives a few levels of DFS.
  const duelConfig: DuelConfig = {
    mainDeck: Array(40).fill(43096270), // Alexandrite Dragon filler
    extraDeck: [],
    hand: [43096270, 43096270, 43096270, 43096270, 43096270],
    deckSeed: [0xdeadbeefcafebaben, 0x1234567890abcdefn, 0xfeedfacefeedfacen, 0xbaadf00dbaadf00dn],
    opponentDeck: [],
  };

  const solverConfig: SolverConfig = {
    mode: 'goldfish',
    speed: 'optimal',
    timeLimitMs: 60_000,
  };

  // ---------------------------------------------------------------------------
  // Test 1 — Replay vs snapshot fork parity on vanilla deck.
  // ---------------------------------------------------------------------------
  console.log('\n🔬 Test 1: replay-fork vs snapshot-fork → bit-identical DFS result');

  const replayStack = await buildStack(dataDir, /* useSnapshot= */ false);
  const replayHandle = replayStack.adapter.createDuel(duelConfig);
  const runReplay = replayStack.solver.solve(replayStack.adapter, solverConfig, new AbortController().signal, () => {}, replayHandle);
  replayStack.adapter.destroyAll();

  const snapStack = await buildStack(dataDir, /* useSnapshot= */ true);
  if (!snapStack.adapter.snapshotAvailable) {
    console.error('  ❌ snapshotAvailable=false — WASM Memory not captured');
    process.exit(1);
  }
  const snapHandle = snapStack.adapter.createDuel(duelConfig);
  const runSnap = snapStack.solver.solve(snapStack.adapter, solverConfig, new AbortController().signal, () => {}, snapHandle);
  snapStack.adapter.destroyAll();

  assert(runReplay.score === runSnap.score, `score (replay=${runReplay.score}, snap=${runSnap.score})`);
  assert(
    runReplay.stats.nodesExplored === runSnap.stats.nodesExplored,
    `nodesExplored (replay=${runReplay.stats.nodesExplored}, snap=${runSnap.stats.nodesExplored})`,
  );
  assert(
    runReplay.stats.maxDepthReached === runSnap.stats.maxDepthReached,
    `maxDepthReached (replay=${runReplay.stats.maxDepthReached}, snap=${runSnap.stats.maxDepthReached})`,
  );
  assert(hashMainPath(runReplay) === hashMainPath(runSnap), 'mainPath bit-identical');
  assert(hashTreeShape(runReplay.tree) === hashTreeShape(runSnap.tree), 'tree shape bit-identical');
  assert(
    JSON.stringify(runReplay.scoreBreakdown) === JSON.stringify(runSnap.scoreBreakdown),
    'scoreBreakdown bit-identical',
  );

  // ---------------------------------------------------------------------------
  // Test 2 — Wall-clock comparison (informational, not a gate).
  // ---------------------------------------------------------------------------
  console.log('\n⏱  Test 2: walltime comparison (informational)');
  console.log(`  replay:   ${runReplay.stats.elapsed}ms  for ${runReplay.stats.nodesExplored} nodes`);
  console.log(`  snapshot: ${runSnap.stats.elapsed}ms  for ${runSnap.stats.nodesExplored} nodes`);
  if (runSnap.stats.elapsed < runReplay.stats.elapsed) {
    const speedup = runReplay.stats.elapsed / Math.max(1, runSnap.stats.elapsed);
    console.log(`  speedup:  ${speedup.toFixed(2)}×`);
  } else {
    console.log(`  ⚠️  snapshot path not faster on this fixture — shallow/cache warm? larger fixture needed to see gain`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Uncaught:', err);
  process.exit(1);
});
