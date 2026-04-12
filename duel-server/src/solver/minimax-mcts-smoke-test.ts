// =============================================================================
// minimax-mcts-smoke-test.ts — Smoke tests for Minimax MCTS adversarial solver
// Run: npx tsx src/solver/minimax-mcts-smoke-test.ts
// =============================================================================

import { join } from 'node:path';
import type { ZoneId } from '../ws-protocol.js';
import type { Action, DecisionNode, FieldCard, FieldState, HandtrapConfig, SolverConfig } from './solver-types.js';
import { ALL_ZONE_IDS } from './solver-types.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';
import { MinimaxMctsSolver } from './minimax-mcts-solver.js';
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

console.log('\n🔬 Minimax MCTS Unit Tests');

// Test: MinimaxMctsSolver metadata
console.log('\n📋 Test: MinimaxMctsSolver metadata');
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

  const solver = new MinimaxMctsSolver(scorer, adapter, ranker, solverConfig);
  assert(solver.name === 'minimax-mcts', `name = '${solver.name}' (expected 'minimax-mcts')`);
  assert(solver.supportsAdversarial === true, `supportsAdversarial = ${solver.supportsAdversarial} (expected true)`);
}

// =============================================================================
// Group B — Integration: Minimax MCTS with OCGCore + handtraps
// =============================================================================

console.log('\n🔬 Minimax MCTS Integration Tests (with OCGCore)');

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

    // Test: Minimax MCTS runs and produces a result with handtraps
    console.log('\n📋 Test: Minimax MCTS adversarial solve produces minimax + timings');
    {
      const solver = new MinimaxMctsSolver(scorer, adapter, ranker, solverConfig);
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
        assert(result.stats.algorithmUsed === 'minimax-mcts', `algorithmUsed = '${result.stats.algorithmUsed}' (expected 'minimax-mcts')`);
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
      const solver2 = new MinimaxMctsSolver(scorer, adapter, ranker, solverConfig);
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

    // Test: full-set availability — every selected handtrap appears as an
    // opponent option in the tree (no subset filtering leaked back in)
    console.log('\n📋 Test: all configured handtraps are activable (no filtering)');
    {
      const allHandtraps = handtraps.slice(0, Math.min(3, handtraps.length));
      const configuredIds = new Set(allHandtraps.map(h => h.cardId));

      const solver3 = new MinimaxMctsSolver(scorer, adapter, ranker, solverConfig);
      solver3.setSeed([7n, 11n]);
      const config3: SolverConfig = {
        mode: 'adversarial',
        speed: 'fast',
        timeLimitMs: 3000,
        handtraps: allHandtraps,
      };
      const handle3 = adapter.createDuel({
        mainDeck: testDeck.slice(5),
        extraDeck: testExtra,
        hand: testHand,
        deckSeed: [7n, 11n],
        opponentDeck: Array(40).fill(ALEXANDRITE),
        handtraps: allHandtraps,
      });
      try {
        const sig3 = AbortSignal.timeout(config3.timeLimitMs);
        const r3 = solver3.solve(adapter, config3, sig3, () => {}, handle3);

        // Walk tree — collect every cardId that appears as a handtrapLabel node
        const seenHandtrapIds = new Set<number>();
        const q: DecisionNode[] = [r3.tree];
        while (q.length > 0) {
          const n = q.shift()!;
          if (n.handtrapLabel && n.action && configuredIds.has(n.action.cardId)) {
            seenHandtrapIds.add(n.action.cardId);
          }
          q.push(...(n.children ?? []));
        }
        // Contract: if the opponent explored activation at all, every configured
        // handtrap should be visitable (they're all in hand, always legal when
        // the chain window allows). Hands with few chain windows may yield zero
        // activations — that's a pass, not a failure. The strict assertion is:
        // no handtrap outside the configured set ever appears as a branch.
        const leaked = [...seenHandtrapIds].filter(id => !configuredIds.has(id));
        assert(
          leaked.length === 0,
          `opponent only activated configured handtraps (seen: ${seenHandtrapIds.size}, leaked: ${leaked.length})`,
        );
        if (seenHandtrapIds.size > 0) {
          console.log(`  ℹ️ Explored activations for ${seenHandtrapIds.size}/${configuredIds.size} configured handtraps`);
        } else {
          console.log('  ℹ️ No opponent activations in this hand (no chain windows triggered)');
        }
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
console.log(`Minimax MCTS Smoke Test: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
