// =============================================================================
// train-graph-weights.ts — graph-ml-v1 M1 training orchestrator.
//
// Runs a (μ+λ)-ES over `edges-all.json`, optimising the weight vector against
// a composite reward on one fixture. Periodic checkpoints are written to
// `data/trained-weights/checkpoints/`; final best is saved as `<basename>.json`
// (default `tier-a-latest.json`) so the solver-worker picks it up at boot
// when `SOLVER_USE_TUNED_WEIGHTS=1`.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/train-graph-weights.ts \
//     --fixture=branded-dracotail-opener \
//     --tier=A \
//     --generations=50 \
//     [--mu=5 --lambda=10] \
//     [--budget-ms=4000] \
//     [--node-budget=200] \
//     [--seed=42] \
//     [--basename=tier-a-latest]
//
// Tier filtering : `edges-all.json` doesn't carry a bridge-tier field; M1 uses
// the `confidence` field as a pragmatic tier proxy
// (high → tier-A proxy, medium → tier-B proxy, low → tier-C proxy). Non-
// selected edges stay at weight 0 and are not perturbed by the ES — only the
// active subset contributes to ranking bonus and is evolved.
//
// Roadmap: memory `project_graph_ml_v1_roadmap_2026_04_24.md`.
// =============================================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  type HandFixture,
  type FixtureFile,
} from './evaluate-structural.js';
import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../src/solver/route-aware-ranker.js';
import { GraphGuidedRanker } from '../src/solver/graph-guided-ranker.js';
import { buildCardMetadataMap } from '../src/solver/card-metadata.js';
import {
  EvolutionStrategy,
  DEFAULT_ES_CONFIG,
  type Vector,
} from './lib/evolution-strategy.js';
import {
  initWeights,
  loadEdges,
  orderedEdgeIds,
  packToVector,
  unpackFromVector,
  saveWeights,
  saveCheckpoint,
  edgeIdFromEdge,
  type GraphWeights,
  type Tier,
  type EdgeId,
} from './lib/weight-persistor.js';
import { FitnessEvaluator } from './lib/fitness-evaluator.js';

// -----------------------------------------------------------------------------
// CLI args
// -----------------------------------------------------------------------------

interface Args {
  fixture: string;
  tier: Tier;
  generations: number;
  mu: number;
  lambda: number;
  budgetMs: number;
  nodeBudget?: number;
  seed: number;
  basename: string;
  edgesFile: string;
  weightsDir: string;
  csv?: string;
}

function parseArgs(): Args {
  const pick = (name: string): string | undefined => {
    const arg = process.argv.find(a => a.startsWith(`--${name}=`));
    return arg?.slice(name.length + 3);
  };
  const numOrDefault = (v: string | undefined, d: number): number => {
    if (!v) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`[train] bad number for ${v}`);
    return n;
  };

  const tierRaw = (pick('tier') ?? 'A').toUpperCase();
  if (!['A', 'B', 'C', 'FULL'].includes(tierRaw)) {
    throw new Error(`[train] --tier must be A | B | C | FULL (got ${tierRaw})`);
  }
  const tier = tierRaw === 'FULL' ? 'full' : (tierRaw as Tier);

  return {
    fixture: pick('fixture') ?? 'branded-dracotail-opener',
    tier,
    generations: numOrDefault(pick('generations'), 50),
    mu: numOrDefault(pick('mu'), 5),
    lambda: numOrDefault(pick('lambda'), 10),
    budgetMs: numOrDefault(pick('budget-ms'), 4000),
    nodeBudget: pick('node-budget') ? numOrDefault(pick('node-budget'), 0) : undefined,
    seed: numOrDefault(pick('seed'), 42),
    basename: pick('basename') ?? `tier-${tierRaw.toLowerCase()}-latest`,
    edgesFile: pick('edges') ?? join(DATA_DIR, 'trained-weights', 'edges-all.json'),
    weightsDir: join(DATA_DIR, 'trained-weights'),
    csv: pick('csv'),
  };
}

// -----------------------------------------------------------------------------
// Tier filter (confidence-based proxy)
// -----------------------------------------------------------------------------

const TIER_TO_CONFIDENCE: Record<Tier, readonly ('high' | 'medium' | 'low')[]> = {
  A: ['high'],
  B: ['high', 'medium'],
  C: ['high', 'medium', 'low'],
  'A+B': ['high', 'medium'],
  'A+B+C': ['high', 'medium', 'low'],
  full: ['high', 'medium', 'low'],
};

function selectActiveEdgeIds(edgesPath: string, tier: Tier): {
  allEdgeIds: EdgeId[];
  activeEdgeIds: Set<EdgeId>;
} {
  const edgesFile = loadEdges(edgesPath);
  const acceptedConfidences = new Set(TIER_TO_CONFIDENCE[tier]);
  const allEdgeIds: EdgeId[] = [];
  const activeEdgeIds = new Set<EdgeId>();
  for (const e of edgesFile.edges) {
    const id = edgeIdFromEdge(e);
    allEdgeIds.push(id);
    if (acceptedConfidences.has(e.confidence)) activeEdgeIds.add(id);
  }
  return { allEdgeIds, activeEdgeIds };
}

// -----------------------------------------------------------------------------
// Active-subset vector ↔ full weight map conversion
// -----------------------------------------------------------------------------

function buildMaskedPacker(template: GraphWeights, activeEdgeIds: Set<EdgeId>) {
  // Use the SAME ordering as persistor's orderedEdgeIds — sorted keys.
  const allOrdered = orderedEdgeIds(template);
  const activeIndices: number[] = [];
  for (let i = 0; i < allOrdered.length; i++) {
    if (activeEdgeIds.has(allOrdered[i])) activeIndices.push(i);
  }

  const unpackActive = (activeVec: Vector): GraphWeights => {
    const full: number[] = packToVector(template);
    for (let i = 0; i < activeIndices.length; i++) {
      full[activeIndices[i]] = activeVec[i];
    }
    return unpackFromVector(template, full);
  };

  const packActive = (w: GraphWeights): Vector => {
    const full = packToVector(w);
    return activeIndices.map(i => full[i]);
  };

  return { activeIndices, unpackActive, packActive };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[train] fixture=${args.fixture} tier=${args.tier} generations=${args.generations} μ=${args.mu} λ=${args.lambda} budget=${args.budgetMs}ms seed=${args.seed}`);

  // ---- Load fixture + boot OCGCore (same recipe as setupEvaluationContext) --
  const fixture: FixtureFile = loadFixtureFile();
  const hand = fixture.hands.find(h => h.id === args.fixture);
  if (!hand) throw new Error(`[train] fixture '${args.fixture}' not found`);
  if (hand._draft) console.warn(`[train] warning: fixture '${args.fixture}' is marked _draft`);

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  const cardMetadata = buildCardMetadataMap(cardDB, [
    ...fixture.decks[hand.deck].main,
    ...fixture.decks[hand.deck].extra,
    ...hand.hand,
  ]);

  const scorer = new InterruptionScorer(
    allConfigs.interruptionTags,
    allConfigs.interruptionWeights,
    cardMetadata,
    allConfigs.structuralWeights,
    allConfigs.structuralTutorCards,
  );
  const goldfish = new GoldfishChainRanker(allConfigs.interruptionTags);
  const routeAware = new RouteAwareRanker(goldfish);
  const graphRanker = new GraphGuidedRanker(routeAware);

  // ---- Build template weights + active-subset mask ------------------------
  const { allEdgeIds, activeEdgeIds } = selectActiveEdgeIds(args.edgesFile, args.tier);
  if (activeEdgeIds.size === 0) {
    throw new Error(`[train] tier '${args.tier}' selected 0 edges — nothing to train`);
  }
  console.log(`[train] edges: total=${allEdgeIds.length} active(tier=${args.tier})=${activeEdgeIds.size}`);

  const template: GraphWeights = initWeights(allEdgeIds, args.tier, 0, [args.fixture]);
  const masker = buildMaskedPacker(template, activeEdgeIds);

  // ---- Fitness evaluator pinned to this fixture ---------------------------
  const evaluator = new FitnessEvaluator({
    adapter, scorer, baseRanker: routeAware, graphRanker,
    fixture, hand, allConfigs,
    timeLimitMs: args.budgetMs,
    nodeBudget: args.nodeBudget,
  });

  // ---- Baseline: all-zeros weights (= no graph bonus) ---------------------
  const baseline = evaluator.evaluate(template);
  console.log(`[train] baseline (weights=0): fitness=${baseline.fitness.toFixed(3)} matched=${baseline.signals.matched}/${baseline.signals.matchedTotal} goalMatch=${baseline.signals.partialGoals.toFixed(2)} nodes=${baseline.signals.nodesExplored}`);

  // ---- ES loop -------------------------------------------------------------
  const es = new EvolutionStrategy({
    ...DEFAULT_ES_CONFIG,
    mu: args.mu,
    lambda: args.lambda,
    maxGenerations: args.generations,
    seed: args.seed,
  });

  const csvRows: string[] = ['generation,bestFitness,meanFitness,stdFitness,sigma,successRate'];

  const initialActiveVec: Vector = masker.packActive(template);

  const fitnessFn = (vec: Vector): number => {
    const weights = masker.unpackActive(vec);
    return evaluator.evaluate(weights).fitness;
  };

  let bestFitness = baseline.fitness;
  let bestWeights = template;

  const onGen = (stats: { generation: number; bestFitness: number; meanFitness: number; stdFitness: number; sigma: number; successRate: number }, best: { vector: Vector; fitness: number }): void => {
    console.log(`[train] gen=${stats.generation} best=${stats.bestFitness.toFixed(3)} mean=${stats.meanFitness.toFixed(3)} std=${stats.stdFitness.toFixed(3)} σ=${stats.sigma.toFixed(3)} succ=${(stats.successRate * 100).toFixed(0)}%`);
    csvRows.push(`${stats.generation},${stats.bestFitness.toFixed(3)},${stats.meanFitness.toFixed(3)},${stats.stdFitness.toFixed(3)},${stats.sigma.toFixed(4)},${stats.successRate.toFixed(3)}`);

    if (best.fitness > bestFitness) {
      bestFitness = best.fitness;
      const full = masker.unpackActive(best.vector);
      bestWeights = {
        ...full,
        metadata: {
          ...full.metadata,
          trainedAt: new Date().toISOString(),
          generations: stats.generation,
          bestFitness,
          sigmaFinal: stats.sigma,
        },
      };
      // Checkpoint every 10 generations for resumability.
      if (stats.generation % 10 === 0) {
        const ckptPath = saveCheckpoint(args.weightsDir, bestWeights);
        console.log(`[train] checkpoint → ${ckptPath}`);
      }
    }
  };

  const { best, history } = await es.run(initialActiveVec, fitnessFn, onGen);

  // ---- Final save ---------------------------------------------------------
  const finalWeights: GraphWeights = {
    ...masker.unpackActive(best.vector),
    metadata: {
      ...bestWeights.metadata,
      trainedAt: new Date().toISOString(),
      generations: history.length,
      bestFitness: best.fitness,
      sigmaFinal: es.currentSigma,
      archetypes: [],
      notes: `baseline=${baseline.fitness.toFixed(3)} finalBest=${best.fitness.toFixed(3)} lift=${(best.fitness - baseline.fitness).toFixed(3)}`,
    },
  };
  const finalPath = join(args.weightsDir, `${args.basename}.json`);
  saveWeights(finalPath, finalWeights);
  saveCheckpoint(args.weightsDir, finalWeights);
  console.log(`[train] final weights → ${finalPath}`);

  // ---- Post-training re-evaluation (sanity: does saved vector = training best?) -
  const reEval = evaluator.evaluate(finalWeights);
  console.log(`[train] re-eval: fitness=${reEval.fitness.toFixed(3)} matched=${reEval.signals.matched}/${reEval.signals.matchedTotal} goalMatch=${reEval.signals.partialGoals.toFixed(2)} nodes=${reEval.signals.nodesExplored} term=${reEval.signals.terminationReason}`);
  console.log(`[train] Δ vs baseline: fitness ${(reEval.fitness - baseline.fitness >= 0 ? '+' : '')}${(reEval.fitness - baseline.fitness).toFixed(3)} | goalMatch ${(reEval.signals.partialGoals - baseline.signals.partialGoals >= 0 ? '+' : '')}${(reEval.signals.partialGoals - baseline.signals.partialGoals).toFixed(2)} | matched ${reEval.signals.matched}→${reEval.signals.matched} (baseline ${baseline.signals.matched})`);

  if (args.csv) {
    mkdirSync(dirname(resolve(args.csv)), { recursive: true });
    writeFileSync(resolve(args.csv), csvRows.join('\n') + '\n', 'utf-8');
    console.log(`[train] csv → ${args.csv}`);
  }

  adapter.destroyAll();
}

main().catch(err => {
  console.error('[train] fatal:', err);
  process.exit(1);
});
