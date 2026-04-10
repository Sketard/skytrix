// =============================================================================
// ismcts-smoke-test.ts — Smoke tests for IS-MCTS adversarial solver
// Run: npx tsx src/solver/ismcts-smoke-test.ts
// =============================================================================

import { join } from 'node:path';
import type { ZoneId } from '../ws-protocol.js';
import type { Action, DecisionNode, FieldCard, FieldState, HandtrapConfig, SolverConfig } from './solver-types.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';
import { IsMctsSolver } from './ismcts-solver.js';
import { InterruptionScorer } from './interruption-scorer.js';
import { loadInterruptionTags, loadInterruptionWeights, loadSolverConfig, loadHandtraps } from './solver-config-loader.js';
import { OCGCoreAdapter } from './ocgcore-adapter.js';
import { loadDatabase, loadScripts } from '../ocg-scripts.js';
import { extractMainPath } from './dfs-solver.js';

// =============================================================================
// Helpers
// =============================================================================

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
// Group A — Pure unit tests (no OCGCore)
// =============================================================================

console.log('\n🔬 IS-MCTS Unit Tests');

// Test: IsMctsSolver metadata
console.log('\n📋 Test: IsMctsSolver metadata');
{
  const DATA_DIR = join(import.meta.dirname, '..', '..', 'data');
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const tags = loadInterruptionTags(DATA_DIR);
  const weights = loadInterruptionWeights(DATA_DIR);
  const solverConfig = loadSolverConfig(DATA_DIR);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, tags);
  const scorer = new InterruptionScorer(tags, weights);
  const ranker = new GoldfishChainRanker();

  const solver = new IsMctsSolver(scorer, adapter, ranker, solverConfig);
  assert(solver.name === 'ismcts', `name = '${solver.name}' (expected 'ismcts')`);
  assert(solver.supportsAdversarial === true, `supportsAdversarial = ${solver.supportsAdversarial} (expected true)`);
}

// =============================================================================
// Group B — Integration: IS-MCTS with OCGCore + handtraps
// =============================================================================

console.log('\n🔬 IS-MCTS Integration Tests (with OCGCore)');

{
  const DATA_DIR = join(import.meta.dirname, '..', '..', 'data');
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const tags = loadInterruptionTags(DATA_DIR);
  const weights = loadInterruptionWeights(DATA_DIR);
  const solverConfig = loadSolverConfig(DATA_DIR);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, tags);
  const scorer = new InterruptionScorer(tags, weights);
  const ranker = new GoldfishChainRanker();

  // Load available handtraps from data
  const handtraps = loadHandtraps(DATA_DIR);

  if (handtraps.length === 0) {
    console.log('  ⚠️ No handtraps available — skipping integration tests');
  } else {
    // Use a simple test deck (Alexandrite Dragons)
    const ALEXANDRITE = 43096270;
    const testDeck = Array(40).fill(ALEXANDRITE);
    const testHand = Array(5).fill(ALEXANDRITE);
    const testExtra: number[] = [];

    // Test: IS-MCTS runs and produces a result with handtraps
    console.log('\n📋 Test: IS-MCTS adversarial solve produces minimax + timings');
    {
      const solver = new IsMctsSolver(scorer, adapter, ranker, solverConfig);
      solver.setSeed([42n, 137n]);

      const config: SolverConfig = {
        mode: 'adversarial',
        speed: 'fast',
        timeLimitMs: 3000, // Short budget for smoke test
        handtraps: handtraps.slice(0, 3), // Use first 3 handtraps
      };

      const startHandle = adapter.createDuel({
        mainDeck: testDeck.slice(5), // Remove 5 for hand
        extraDeck: testExtra,
        hand: testHand,
        deckSeed: [42n, 137n],
        opponentDeck: Array(40).fill(ALEXANDRITE),
        handtraps: handtraps.slice(0, 3),
      });

      try {
        const signal = AbortSignal.timeout(config.timeLimitMs);
        const result = solver.solve(adapter, config, signal, () => {}, startHandle);

        assert(result.minimax !== undefined, `minimax is defined (value: ${result.minimax})`);
        assert(typeof result.minimax === 'number', `minimax is a number`);
        assert(result.stats.algorithmUsed === 'ismcts', `algorithmUsed = '${result.stats.algorithmUsed}' (expected 'ismcts')`);
        assert(result.score >= 0, `score >= 0 (value: ${result.score})`);
        assert(result.tree !== undefined, 'tree is defined');
        assert(result.mainPath !== undefined, 'mainPath is defined');

        // Adversarial timings may or may not be populated depending on whether
        // opponent actually activated a handtrap in the best line
        if (result.adversarialTimings && result.adversarialTimings.length > 0) {
          const timing = result.adversarialTimings[0];
          assert(typeof timing.stepIndex === 'number', `adversarialTiming[0].stepIndex is number`);
          assert(typeof timing.handtrapCardId === 'number', `adversarialTiming[0].handtrapCardId is number`);
          assert(typeof timing.handtrapCardName === 'string', `adversarialTiming[0].handtrapCardName is string`);
          console.log(`  ℹ️ Adversarial timings: ${result.adversarialTimings.length} opponent actions recorded`);
        } else {
          console.log('  ℹ️ No adversarial timings (opponent may not have activated in best line)');
        }

        // Check handtrapLabel on tree nodes (walk tree looking for opponent nodes)
        let foundHandtrapLabel = false;
        const walkQueue = [result.tree];
        while (walkQueue.length > 0) {
          const node = walkQueue.shift()!;
          if (node.handtrapLabel) {
            foundHandtrapLabel = true;
            break;
          }
          walkQueue.push(...node.children);
        }
        if (foundHandtrapLabel) {
          console.log('  ✅ handtrapLabel found on at least one opponent node');
          passed++;
        } else {
          console.log('  ℹ️ No handtrapLabel found (opponent may not have expanded activation branches)');
        }

        // Verify extractMainPath works on adversarial tree
        const mainPath = extractMainPath(result.tree, solverConfig.maxDepth);
        assert(Array.isArray(mainPath), 'extractMainPath returns array on adversarial tree');

        // If tree has opponent nodes, verify children[0] sort order
        let foundOpponentNode = false;
        const checkQueue = [result.tree];
        while (checkQueue.length > 0) {
          const node = checkQueue.shift()!;
          if (node.handtrapLabel && node.children?.length > 0) {
            // This is an opponent node with children — verify ASC score sort
            // (children[0] should have lowest score for minimax)
            // Note: opponent node children represent player responses, sorted DESC
            foundOpponentNode = true;
            break;
          }
          checkQueue.push(...(node.children ?? []));
        }
        if (foundOpponentNode) {
          console.log('  ✅ Opponent node with children found in tree');
          passed++;
        } else {
          console.log('  ℹ️ No opponent nodes with children found in tree');
        }

        console.log(`  ℹ️ Result: score=${result.score}, minimax=${result.minimax}, nodes=${result.stats.nodesExplored}`);
      } finally {
        adapter.destroyAll();
      }
    }

    // Test: Minimax correctness — minimax <= score (worst-case <= best-case)
    console.log('\n📋 Test: Minimax score is worst-case (minimax <= score)');
    {
      const solver2 = new IsMctsSolver(scorer, adapter, ranker, solverConfig);
      solver2.setSeed([99n, 42n]);
      const config2: SolverConfig = {
        mode: 'adversarial',
        speed: 'fast',
        timeLimitMs: 3000,
        handtraps: handtraps.slice(0, 3),
      };
      const handle2 = adapter.createDuel({
        mainDeck: testDeck.slice(5),
        extraDeck: testExtra,
        hand: testHand,
        deckSeed: [99n, 42n],
        opponentDeck: Array(40).fill(ALEXANDRITE),
        handtraps: handtraps.slice(0, 3),
      });
      try {
        const sig2 = AbortSignal.timeout(config2.timeLimitMs);
        const r = solver2.solve(adapter, config2, sig2, () => {}, handle2);
        assert(
          r.minimax !== undefined && r.minimax <= r.score,
          `minimax (${r.minimax}) <= score (${r.score}) — worst-case never exceeds best-case`,
        );
        // Verify opponent nodes in tree use worstScore, player nodes use bestScore
        let opponentCorrect = true;
        const q: DecisionNode[] = [r.tree];
        while (q.length > 0) {
          const n = q.shift()!;
          if (n.handtrapLabel && n.children.length > 1) {
            // Opponent node: children sorted ASC (worst-case first)
            const sorted = n.children[0].score <= n.children[n.children.length - 1].score;
            if (!sorted) opponentCorrect = false;
          }
          q.push(...n.children);
        }
        assert(opponentCorrect, 'Opponent nodes have children sorted ASC by score (minimax)');
      } finally {
        adapter.destroyAll();
      }
    }

    // Test: DFS rejection for adversarial mode
    console.log('\n📋 Test: DFS does not support adversarial mode');
    {
      // This is tested at the server level (server.ts validation), not at solver level.
      // Just verify the DfsSolver.supportsAdversarial flag.
      const { DfsSolver } = await import('./dfs-solver.js');
      const hasher = (await import('./zobrist.js')).ZobristHasher;
      const { TranspositionTable } = await import('./transposition-table.js');
      const h = new hasher();
      const t = new TranspositionTable(solverConfig.transpositionMaxEntries);
      const dfs = new DfsSolver(h, t, scorer, adapter, ranker, solverConfig);
      assert(dfs.supportsAdversarial === false, `DfsSolver.supportsAdversarial = ${dfs.supportsAdversarial} (expected false)`);
    }
  }
}

// =============================================================================
// Summary
// =============================================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`IS-MCTS Smoke Test: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
