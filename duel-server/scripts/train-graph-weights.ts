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

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
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
  type PopulationSnapshot,
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
  /** Directory for forensic trace files (population.jsonl, mutations.jsonl,
   *  meta.json). When omitted, defaults to
   *  `data/training-logs/<basename>-<seed>-<timestamp>/`. Pass `--no-trace`
   *  to disable entirely. */
  traceDir?: string;
  noTrace: boolean;
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
    traceDir: pick('trace-dir'),
    noTrace: process.argv.includes('--no-trace'),
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
  /** EdgeIds that the active vector covers, in vector-index order.
   *  `activeOrdered[i]` is the edge whose weight maps to `vector[i]`. */
  const activeOrdered: EdgeId[] = activeIndices.map(i => allOrdered[i]);

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

  return { activeIndices, activeOrdered, unpackActive, packActive };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  // Phase A scorer fix (2026-04-26) — `--implicit-goals=N` enables the
  // expectedBoard-aligned reward in the scorer for the entire ES run.
  // Training under Phase A means the fitness landscape (β·explorationScore)
  // includes the implicit goal points, biasing ES toward weights that favor
  // expectedBoard-aligned states.
  const implicitGoalsArg = (() => {
    const arg = process.argv.find(a => a.startsWith('--implicit-goals='));
    if (!arg) return undefined;
    const n = Number(arg.slice('--implicit-goals='.length));
    return Number.isFinite(n) ? n : undefined;
  })();
  if (implicitGoalsArg !== undefined && implicitGoalsArg > 0) {
    process.env.SOLVER_IMPLICIT_GOALS = '1';
    process.env.SOLVER_IMPLICIT_GOALS_WEIGHT = String(implicitGoalsArg);
    console.log(`[train] --implicit-goals=${implicitGoalsArg}: expectedBoard rewards active during ES`);
  }

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
  const baseline = await evaluator.evaluate(template);
  console.log(`[train] baseline (weights=0): fitness=${baseline.fitness.toFixed(3)} matched=${baseline.signals.matched}/${baseline.signals.matchedTotal} expl=${baseline.signals.explorationScore.toFixed(2)} goalMatch=${baseline.signals.partialGoals.toFixed(2)} nodes=${baseline.signals.nodesExplored}`);

  // ---- ES loop -------------------------------------------------------------
  const es = new EvolutionStrategy({
    ...DEFAULT_ES_CONFIG,
    mu: args.mu,
    lambda: args.lambda,
    maxGenerations: args.generations,
    seed: args.seed,
  });

  const csvRows: string[] = ['generation,bestFitness,meanFitness,stdFitness,sigma,successRate'];

  // ---- Forensic trace setup (graph-ml-v1 audit reco #1 + #3) -------------
  // population.jsonl  — one line per individual per gen (parents + offspring)
  // mutations.jsonl   — one line per offspring with parent → child Δfitness + deltas
  // meta.json         — run config + edgeIdsOrdered (so vector indices map to edges)
  let traceDir: string | undefined;
  let populationPath: string | undefined;
  let mutationsPath: string | undefined;
  if (!args.noTrace) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    traceDir = args.traceDir
      ? resolve(args.traceDir)
      : join(DATA_DIR, 'training-logs', `${args.basename}-seed${args.seed}-${stamp}`);
    mkdirSync(traceDir, { recursive: true });
    populationPath = join(traceDir, 'population.jsonl');
    mutationsPath = join(traceDir, 'mutations.jsonl');
    const metaPath = join(traceDir, 'meta.json');
    writeFileSync(metaPath, JSON.stringify({
      runId: `${args.basename}-seed${args.seed}-${stamp}`,
      fixture: args.fixture,
      tier: args.tier,
      mu: args.mu,
      lambda: args.lambda,
      generations: args.generations,
      seed: args.seed,
      budgetMs: args.budgetMs,
      nodeBudget: args.nodeBudget ?? null,
      activeEdgeCount: masker.activeOrdered.length,
      // edgeIdsOrdered[i] is the edge whose weight maps to vector[i] / deltas[i].
      edgeIdsOrdered: masker.activeOrdered,
      baselineFitness: baseline.fitness,
    }, null, 2) + '\n', 'utf-8');
    // Truncate (or create) the JSONL files at start so re-runs don't append.
    writeFileSync(populationPath, '', 'utf-8');
    writeFileSync(mutationsPath, '', 'utf-8');
    console.log(`[train] trace dir → ${traceDir}`);
  }

  const initialActiveVec: Vector = masker.packActive(template);

  const fitnessFn = async (vec: Vector): Promise<number> => {
    const weights = masker.unpackActive(vec);
    return (await evaluator.evaluate(weights)).fitness;
  };

  let bestFitness = baseline.fitness;
  let bestWeights = template;

  const onPop = (snap: PopulationSnapshot): void => {
    if (!populationPath || !mutationsPath) return;
    const popLines: string[] = [];
    for (let i = 0; i < snap.parents.length; i++) {
      popLines.push(JSON.stringify({
        gen: snap.generation,
        kind: 'parent',
        idx: i,
        fitness: snap.parents[i].fitness,
        sigma: snap.sigma,
        vector: Array.from(snap.parents[i].vector),
      }));
    }
    for (let i = 0; i < snap.offspring.length; i++) {
      const o = snap.offspring[i];
      popLines.push(JSON.stringify({
        gen: snap.generation,
        kind: 'offspring',
        idx: i,
        parentIdx: o.parentIdx,
        fitness: o.fitness,
        survivedAsParent: o.survivedAsParent,
        sigma: snap.sigma,
        vector: Array.from(o.vector),
      }));
    }
    appendFileSync(populationPath, popLines.join('\n') + (popLines.length > 0 ? '\n' : ''), 'utf-8');

    if (snap.offspring.length > 0) {
      const mutLines: string[] = [];
      for (let i = 0; i < snap.offspring.length; i++) {
        const o = snap.offspring[i];
        mutLines.push(JSON.stringify({
          gen: snap.generation,
          childIdx: i,
          parentIdx: o.parentIdx,
          parentFitness: o.parentFitness,
          childFitness: o.fitness,
          deltaFitness: o.fitness - o.parentFitness,
          survivedAsParent: o.survivedAsParent,
          sigma: snap.sigma,
          deltas: o.deltas,
        }));
      }
      appendFileSync(mutationsPath, mutLines.join('\n') + '\n', 'utf-8');
    }
  };

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

  const { best, history } = await es.run(initialActiveVec, fitnessFn, onGen, onPop);

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
  const reEval = await evaluator.evaluate(finalWeights);
  console.log(`[train] re-eval: fitness=${reEval.fitness.toFixed(3)} matched=${reEval.signals.matched}/${reEval.signals.matchedTotal} expl=${reEval.signals.explorationScore.toFixed(2)} goalMatch=${reEval.signals.partialGoals.toFixed(2)} nodes=${reEval.signals.nodesExplored} term=${reEval.signals.terminationReason}`);
  const dF = reEval.fitness - baseline.fitness;
  const dExpl = reEval.signals.explorationScore - baseline.signals.explorationScore;
  const dGoal = reEval.signals.partialGoals - baseline.signals.partialGoals;
  console.log(`[train] Δ vs baseline: fitness ${dF >= 0 ? '+' : ''}${dF.toFixed(3)} | expl ${dExpl >= 0 ? '+' : ''}${dExpl.toFixed(2)} | goalMatch ${dGoal >= 0 ? '+' : ''}${dGoal.toFixed(2)} | matched ${reEval.signals.matched} (baseline ${baseline.signals.matched})`);

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
