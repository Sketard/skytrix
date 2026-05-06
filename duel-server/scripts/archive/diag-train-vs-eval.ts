// =============================================================================
// diag-train-vs-eval.ts — F7 diagnostic.
//
// Audit finding F7 (2026-04-25): training-side fitness-evaluator and
// production-side runFixture report different `explorationScore` values for
// the same fixture + same weights (0). 76.80 vs 54.79 with 245 vs 52 nodes
// at identical 3s budget / 200 node budget. ES is climbing a measurement
// not representative of production.
//
// This script runs BOTH paths in the SAME process to isolate whether the
// divergence is environmental (Piscina worker setup) or code-level
// (fitness-evaluator vs runFixture differ in how they invoke the solver).
//
// Usage:
//   cd duel-server
//   npx tsx scripts/diag-train-vs-eval.ts [--fixture=<id>] [--budget-ms=3000] [--node-budget=200]
// =============================================================================

import { setupEvaluationContext, runFixture } from '../eval/evaluate-structural.js';
import { FitnessEvaluator } from '../ml/lib/fitness-evaluator.js';
import { initWeights, orderedEdgeIds, loadEdges, edgeIdFromEdge } from '../ml/lib/weight-persistor.js';
import { GraphGuidedRanker } from '../../src/solver/ml/graph-guided-ranker.js';
import { DATA_DIR } from '../eval/evaluate-structural.js';
import { join } from 'node:path';

function pick(name: string): string | undefined {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const fixtureId = pick('fixture') ?? 'branded-dracotail-opener';
  const budgetMs = Number(pick('budget-ms') ?? 3000);
  const nodeBudget = Number(pick('node-budget') ?? 200);

  console.log(`[diag] booting evaluation context (Piscina-equivalent: same setupEvaluationContext)`);
  const ctx = await setupEvaluationContext();
  const hand = ctx.fixture.hands.find(h => h.id === fixtureId);
  if (!hand) throw new Error(`[diag] fixture '${fixtureId}' not found`);

  console.log(`[diag] fixture=${fixtureId}  budget=${budgetMs}ms  node-budget=${nodeBudget}`);

  // Build empty (weights=0) GraphWeights covering tier-A edges, same as fitness-evaluator default.
  const edgesFile = loadEdges(join(DATA_DIR, 'trained-weights', 'edges-all.json'));
  const allEdgeIds = edgesFile.edges.map(edgeIdFromEdge);
  const zeroWeights = initWeights(allEdgeIds, 'A', 0, [fixtureId]);

  // ---- Method A: fitness-evaluator (training path) ------------------------
  const graphRanker = new GraphGuidedRanker(ctx.ranker);
  const evaluator = new FitnessEvaluator({
    adapter: ctx.adapter,
    scorer: ctx.scorer,
    baseRanker: ctx.ranker,
    graphRanker,
    fixture: ctx.fixture,
    hand,
    allConfigs: ctx.allConfigs,
    timeLimitMs: budgetMs,
    nodeBudget,
  });
  console.log(`[diag] Method A (fitness-evaluator path) — running...`);
  const tA0 = Date.now();
  const resA = await evaluator.evaluate(zeroWeights);
  const wallA = Date.now() - tA0;
  console.log(`[diag] A result: fitness=${resA.fitness.toFixed(3)}  expl=${resA.signals.explorationScore.toFixed(3)}  matched=${resA.signals.matched}/${resA.signals.matchedTotal}  nodes=${resA.signals.nodesExplored}  walk=${wallA}ms  term=${resA.signals.terminationReason}`);

  // ---- Method B: runFixture (eval-prod path), same process ---------------
  console.log(`[diag] Method B (runFixture path) — running...`);
  const tB0 = Date.now();
  const resB = await runFixture(
    ctx.adapter,
    ctx.scorer,
    ctx.ranker,
    ctx.fixture,
    hand,
    ctx.allConfigs,
    budgetMs,
    nodeBudget,
    { dfsRanker: ctx.ranker }, // weights=0 path uses base ranker (no graph wrap, mirrors loadTunedWeightsIfEnabled disabled)
  );
  const wallB = Date.now() - tB0;
  console.log(`[diag] B result: score=${resB.score}  expl=${resB.explorationScore.toFixed(3)}  matched=${resB.matched}/${resB.matchedTotal}  nodes=${resB.nodesExplored}  walk=${wallB}ms  term=${resB.terminationReason}`);

  // ---- Method C: runFixture WITH GraphGuidedRanker(weights=0) ------------
  // Mirrors fitness-evaluator's ranker stack exactly. If A and C differ but B
  // and C match, the cause is the ranker stack difference, not the dfs setup.
  const graphRankerC = new GraphGuidedRanker(ctx.ranker);
  graphRankerC.setWeights(zeroWeights);
  console.log(`[diag] Method C (runFixture path with graphRanker(weights=0)) — running...`);
  const tC0 = Date.now();
  const resC = await runFixture(
    ctx.adapter,
    ctx.scorer,
    ctx.ranker,
    ctx.fixture,
    hand,
    ctx.allConfigs,
    budgetMs,
    nodeBudget,
    { dfsRanker: graphRankerC },
  );
  const wallC = Date.now() - tC0;
  console.log(`[diag] C result: score=${resC.score}  expl=${resC.explorationScore.toFixed(3)}  matched=${resC.matched}/${resC.matchedTotal}  nodes=${resC.nodesExplored}  walk=${wallC}ms  term=${resC.terminationReason}`);

  // ---- Verdict ------------------------------------------------------------
  const dExplAB = Math.abs(resA.signals.explorationScore - resB.explorationScore);
  const dExplAC = Math.abs(resA.signals.explorationScore - resC.explorationScore);
  console.log(`\n[diag] ════ VERDICT ════`);
  console.log(`  A (fitness-eval) vs B (runFixture base):       Δexpl=${dExplAB.toFixed(3)}  Δnodes=${resA.signals.nodesExplored - resB.nodesExplored}`);
  console.log(`  A (fitness-eval) vs C (runFixture w/ graph):   Δexpl=${dExplAC.toFixed(3)}  Δnodes=${resA.signals.nodesExplored - resC.nodesExplored}`);
  if (dExplAB < 0.01 && dExplAC < 0.01) {
    console.log(`  → All three paths agree. F7 is environmental (Piscina vs main process).`);
  } else if (dExplAC < 0.01) {
    console.log(`  → A == C, A != B. Cause: ranker stack difference (graph-guided wrapper changes DFS behavior even at weights=0).`);
  } else {
    console.log(`  → A differs from B AND C. Cause: code-level difference between fitness-evaluator and runFixture.`);
  }

  ctx.dispose();
}

main().catch(err => {
  console.error('[diag] FATAL:', err);
  process.exit(1);
});
