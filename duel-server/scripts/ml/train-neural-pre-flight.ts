// =============================================================================
// train-neural-pre-flight.ts — Phase B (graph-ml-v2) Day 1.5 pre-flight gate.
//
// Mirrors `train-graph-weights.ts` structure but trains a 95-dim linear
// weight vector for `NeuralFeatureRanker` (instead of the 1038-dim per-edge
// `GraphWeights`). Used to decide GO/NO-GO before committing ~20 h of MLP
// training. See design doc:
// `_bmad-output/solver-data/phase-b/day-1-design-doc.md` (round 2, §1.5).
//
// Hard constraints (from design doc + checkpoint memo):
// - Single fixture (CLI default `snake-eye-yummy-opener` — Phase 1 added 5 tags
//   here, strongest signal expected).
// - Multi-seed: run separately per seed (42, 7, 11). Median across seeds is
//   the GO/NO-GO signal — single-seed is below σ ≈ 1.7 noise.
// - Fitness = PURE `interruptionScore`. No matched², no goalMatchPoints, no
//   terminalBonus, no novelty. Round 2 review enforced this.
// - bonusScale stays constant 100 (not evolved in pre-flight). ES evolves
//   only the 95 weight params at single σ_init=0.3.
// - Train budget aligned with eval canonical (`nb=400`, `budget-ms=6000`).
// - Honest config: `SOLVER_DISABLE_EXPERTISE=1` forced on.
//
// Usage:
//   cd duel-server
//   SOLVER_DISABLE_EXPERTISE=1 npx tsx scripts/train-neural-pre-flight.ts \
//     --fixture=snake-eye-yummy-opener --seed=42 \
//     --generations=30 --mu=5 --lambda=10 \
//     --budget-ms=6000 --node-budget=400 \
//     --basename=neural-pre-flight
//
// Output: `data/trained-weights/<basename>-seed<N>.json` (pre-flight) or
//         `data/trained-weights/<basename>.json` if `--seed` not appended.
//
// GO criterion: median(seed=42, 7, 11) lift ≥ +2 matched OR ≥ +10 score AND
// 0/3 catastrophic regression on controls.
// =============================================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  runFixture,
  type HandFixture,
  type FixtureFile,
} from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../../src/solver/goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../../src/solver/route-aware-ranker.js';
import { NeuralFeatureRanker, type NeuralWeights } from '../../src/solver/ml/neural-ranker.js';
import {
  STATE_FEATURE_NAMES,
  ACTION_FEATURE_NAMES,
  FEATURE_DIM,
  computeFeatureSpecHash,
} from '../../src/solver/ml/state-feature-extractor.js';
import { buildCardMetadataMap } from '../../src/solver/card-metadata.js';
import {
  EvolutionStrategy,
  DEFAULT_ES_CONFIG,
  type Vector,
  type PopulationSnapshot,
} from './lib/evolution-strategy.js';

// -----------------------------------------------------------------------------
// CLI args
// -----------------------------------------------------------------------------

interface Args {
  fixture: string;
  generations: number;
  mu: number;
  lambda: number;
  budgetMs: number;
  nodeBudget?: number;
  seed: number;
  basename: string;
  weightsDir: string;
  csv?: string;
  traceDir?: string;
  noTrace: boolean;
  /** Linear bias scalar — pre-flight keeps b1=0 fixed (per design doc constraint). */
  fixedBonusScale: number;
}

function parseArgs(): Args {
  const pick = (name: string): string | undefined => {
    const arg = process.argv.find(a => a.startsWith(`--${name}=`));
    return arg?.slice(name.length + 3);
  };
  const numOrDefault = (v: string | undefined, d: number): number => {
    if (!v) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`[train-neural] bad number for ${v}`);
    return n;
  };

  const seed = numOrDefault(pick('seed'), 42);
  const baseRaw = pick('basename') ?? 'neural-pre-flight';
  // Auto-suffix the seed when caller passes a seed but no explicit basename
  // override — keeps multi-seed runs from clobbering each other.
  const basename = baseRaw.includes('seed') ? baseRaw : `${baseRaw}-seed${seed}`;

  return {
    fixture: pick('fixture') ?? 'snake-eye-yummy-opener',
    generations: numOrDefault(pick('generations'), 30),
    mu: numOrDefault(pick('mu'), 5),
    lambda: numOrDefault(pick('lambda'), 10),
    budgetMs: numOrDefault(pick('budget-ms'), 6000),
    nodeBudget: pick('node-budget') ? numOrDefault(pick('node-budget'), 0) : 400,
    seed,
    basename,
    weightsDir: join(DATA_DIR, 'trained-weights'),
    csv: pick('csv'),
    traceDir: pick('trace-dir'),
    noTrace: process.argv.includes('--no-trace'),
    fixedBonusScale: numOrDefault(pick('bonus-scale'), 100),
  };
}

// -----------------------------------------------------------------------------
// Vector ↔ NeuralWeights
// -----------------------------------------------------------------------------

function buildNeuralWeights(
  vec: Vector,
  bonusScale: number,
  metadata: NeuralWeights['metadata'] = {},
): NeuralWeights {
  if (vec.length !== FEATURE_DIM) {
    throw new Error(`[train-neural] vec length ${vec.length} != FEATURE_DIM ${FEATURE_DIM}`);
  }
  return {
    version: 'neural-v1',
    tier: 'A',
    arch: { inputDim: FEATURE_DIM, hidden: [], activation: 'relu' },
    featureSpec: {
      stateFeatures: STATE_FEATURE_NAMES,
      actionFeatures: ACTION_FEATURE_NAMES,
    },
    featureSpecHash: computeFeatureSpecHash(),
    params: {
      W1: Array.from(vec),
      b1: [0],
      bonusScale,
    },
    metadata,
  };
}

function saveNeuralWeights(path: string, weights: NeuralWeights): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(weights, null, 2) + '\n', 'utf-8');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  // Force honest config — Phase B trains under the same regime production
  // ships under. Expertise off, no implicit goals.
  if (process.env.SOLVER_DISABLE_EXPERTISE !== '1') {
    console.log('[train-neural] forcing SOLVER_DISABLE_EXPERTISE=1 (honest baseline regime)');
    process.env.SOLVER_DISABLE_EXPERTISE = '1';
  }
  delete process.env.SOLVER_IMPLICIT_GOALS;
  delete process.env.SOLVER_IMPLICIT_GOALS_WEIGHT;

  console.log(`[train-neural] fixture=${args.fixture} generations=${args.generations} μ=${args.mu} λ=${args.lambda} budget=${args.budgetMs}ms nb=${args.nodeBudget ?? '∞'} seed=${args.seed}`);
  console.log(`[train-neural] feature-spec hash = ${computeFeatureSpecHash()}`);
  console.log(`[train-neural] linear path: 95 weights evolved, b1=0 fixed, bonusScale=${args.fixedBonusScale} fixed`);

  // ---- Load fixture + boot OCGCore -----------------------------------------
  const fixture: FixtureFile = loadFixtureFile();
  const hand = fixture.hands.find(h => h.id === args.fixture);
  if (!hand) throw new Error(`[train-neural] fixture '${args.fixture}' not found`);
  if (hand._draft) console.warn(`[train-neural] warning: fixture '${args.fixture}' is _draft`);
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`[train-neural] deck '${hand.deck}' not found`);

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  const cardMetadata = buildCardMetadataMap(cardDB, [
    ...deck.main,
    ...deck.extra,
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
  const neuralRanker = new NeuralFeatureRanker(routeAware);
  neuralRanker.setMetadata(cardMetadata);
  neuralRanker.setInterruptionTags(allConfigs.interruptionTags);
  neuralRanker.setInterruptionWeights(allConfigs.interruptionWeights);
  neuralRanker.setMainDeck(deck.main);
  neuralRanker.setExtraDeck(deck.extra);

  // ---- Baseline: zeros vector (= no neural bonus → delegates to base) ------
  const zeroVec: Vector = new Array(FEATURE_DIM).fill(0);
  const baselineWeights = buildNeuralWeights(zeroVec, args.fixedBonusScale);
  neuralRanker.setNeuralWeights(undefined);  // explicit fallback to base
  const baselineRes = await runFixture(
    adapter, scorer, routeAware, fixture, hand, allConfigs,
    args.budgetMs, args.nodeBudget, { dfsRanker: neuralRanker },
  );
  const baselineFitness = baselineRes.breakdown.interruptionScore;
  const baselineMatched = baselineRes.matched;
  console.log(`[train-neural] baseline (no neural bonus): interruptionScore=${baselineFitness.toFixed(3)} matched=${baselineMatched}/${baselineRes.matchedTotal} expl=${baselineRes.explorationScore.toFixed(2)} nodes=${baselineRes.nodesExplored} term=${baselineRes.terminationReason}`);

  // ---- Trace dir setup -----------------------------------------------------
  let traceDir: string | undefined;
  let populationPath: string | undefined;
  let mutationsPath: string | undefined;
  if (!args.noTrace) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    traceDir = args.traceDir
      ? resolve(args.traceDir)
      : join(DATA_DIR, 'training-logs', `${args.basename}-${stamp}`);
    mkdirSync(traceDir, { recursive: true });
    populationPath = join(traceDir, 'population.jsonl');
    mutationsPath = join(traceDir, 'mutations.jsonl');
    const metaPath = join(traceDir, 'meta.json');
    writeFileSync(metaPath, JSON.stringify({
      runId: `${args.basename}-${stamp}`,
      kind: 'neural-pre-flight',
      fixture: args.fixture,
      mu: args.mu,
      lambda: args.lambda,
      generations: args.generations,
      seed: args.seed,
      budgetMs: args.budgetMs,
      nodeBudget: args.nodeBudget ?? null,
      featureDim: FEATURE_DIM,
      featureSpecHash: computeFeatureSpecHash(),
      stateFeatureNames: STATE_FEATURE_NAMES,
      actionFeatureNames: ACTION_FEATURE_NAMES,
      bonusScale: args.fixedBonusScale,
      baselineFitness,
      baselineMatched,
    }, null, 2) + '\n', 'utf-8');
    writeFileSync(populationPath, '', 'utf-8');
    writeFileSync(mutationsPath, '', 'utf-8');
    console.log(`[train-neural] trace dir → ${traceDir}`);
  }

  // ---- ES loop -------------------------------------------------------------
  const es = new EvolutionStrategy({
    ...DEFAULT_ES_CONFIG,
    mu: args.mu,
    lambda: args.lambda,
    initialSigma: 0.3,
    sigmaMin: 0.05,
    maxGenerations: args.generations,
    seed: args.seed,
  });

  const csvRows: string[] = ['generation,bestFitness,meanFitness,stdFitness,sigma,successRate'];

  // Pure interruptionScore fitness (no matched², no goalMatch, no terminalBonus,
  // no novelty). Phase B philosophy: the scorer is the only signal.
  const fitnessFn = async (vec: Vector): Promise<number> => {
    const w = buildNeuralWeights(vec, args.fixedBonusScale);
    neuralRanker.setNeuralWeights(w);
    const res = await runFixture(
      adapter, scorer, routeAware, fixture, hand, allConfigs,
      args.budgetMs, args.nodeBudget, { dfsRanker: neuralRanker },
    );
    return res.breakdown.interruptionScore;
  };

  let bestFitness = baselineFitness;
  let bestVector: Vector = zeroVec;

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
        // Vector is 95 floats — keep on same line for jq-friendly streaming.
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

  const onGen = (
    stats: { generation: number; bestFitness: number; meanFitness: number; stdFitness: number; sigma: number; successRate: number },
    best: { vector: Vector; fitness: number },
  ): void => {
    console.log(`[train-neural] gen=${stats.generation} best=${stats.bestFitness.toFixed(3)} mean=${stats.meanFitness.toFixed(3)} std=${stats.stdFitness.toFixed(3)} σ=${stats.sigma.toFixed(3)} succ=${(stats.successRate * 100).toFixed(0)}%`);
    csvRows.push(`${stats.generation},${stats.bestFitness.toFixed(3)},${stats.meanFitness.toFixed(3)},${stats.stdFitness.toFixed(3)},${stats.sigma.toFixed(4)},${stats.successRate.toFixed(3)}`);

    if (best.fitness > bestFitness) {
      bestFitness = best.fitness;
      bestVector = best.vector;
    }
  };

  const { best, history } = await es.run(zeroVec, fitnessFn, onGen, onPop);
  if (best.fitness > bestFitness) {
    bestFitness = best.fitness;
    bestVector = best.vector;
  }

  // ---- Final save ----------------------------------------------------------
  const finalWeights: NeuralWeights = buildNeuralWeights(bestVector, args.fixedBonusScale, {
    trainedAt: new Date().toISOString(),
    generations: history.length,
    fixturesUsed: [args.fixture],
    seed: args.seed,
    fitness: {
      bestFitness,
      baselineFitness,
      lift: bestFitness - baselineFitness,
    },
    notes: `pre-flight linear  baseline=${baselineFitness.toFixed(3)}  best=${bestFitness.toFixed(3)}  lift=${(bestFitness - baselineFitness).toFixed(3)}`,
  });
  const finalPath = join(args.weightsDir, `${args.basename}.json`);
  saveNeuralWeights(finalPath, finalWeights);
  console.log(`[train-neural] final weights → ${finalPath}`);

  // ---- Re-eval at best weights ---------------------------------------------
  neuralRanker.setNeuralWeights(finalWeights);
  const reEval = await runFixture(
    adapter, scorer, routeAware, fixture, hand, allConfigs,
    args.budgetMs, args.nodeBudget, { dfsRanker: neuralRanker },
  );
  const dF = reEval.breakdown.interruptionScore - baselineFitness;
  const dM = reEval.matched - baselineMatched;
  console.log(`[train-neural] re-eval: interruptionScore=${reEval.breakdown.interruptionScore.toFixed(3)} (Δ${dF >= 0 ? '+' : ''}${dF.toFixed(3)})  matched=${reEval.matched}/${reEval.matchedTotal} (Δ${dM >= 0 ? '+' : ''}${dM})  nodes=${reEval.nodesExplored}  term=${reEval.terminationReason}`);

  if (args.csv) {
    mkdirSync(dirname(resolve(args.csv)), { recursive: true });
    writeFileSync(resolve(args.csv), csvRows.join('\n') + '\n', 'utf-8');
    console.log(`[train-neural] csv → ${args.csv}`);
  }

  adapter.destroyAll();
}

main().catch(err => {
  console.error('[train-neural] fatal:', err);
  process.exit(1);
});
