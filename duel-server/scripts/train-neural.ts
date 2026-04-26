// =============================================================================
// train-neural.ts — Phase B (graph-ml-v2) multi-fixture trainer.
//
// Day 2+ trainer. Mirrors `train-neural-pre-flight.ts` but extends:
// - Multi-fixture training set (default: branded + mitsurugi + snake-eye + ddd)
// - MLP support via `--arch=mlp:H` (default `mlp:32`); linear path stays
//   available via `--arch=linear` for the pre-flight regime.
// - Per-fixture aggregation = sum of `interruptionScore` (round 2 §5).
// - Honest config forced (`SOLVER_DISABLE_EXPERTISE=1`, no implicit goals).
// - Snapshot fork explicitly enabled (`SOLVER_USE_SNAPSHOT=1`) for
//   bit-deterministic DFS rollouts — fixes the seed-7 lucky-individual issue
//   surfaced in the Day 1.5 pre-flight.
//
// Hard constraints (per design doc round 2 + checkpoint memo):
// - Fitness = pure summed `interruptionScore`. No matched², no goalMatchPoints,
//   no terminalBonus, no novelty.
// - bonusScale stays constant 100 (not evolved, single σ class for weights only).
// - σ_init=0.3, σ_min=0.05.
// - Train budget aligned with eval canonical (`nb=400`, `budget-ms=6000`).
//
// Usage:
//   cd duel-server
//   npx tsx scripts/train-neural.ts \
//     --fixtures=branded-dracotail-opener,ryzeal-mitsurugi-opener,snake-eye-yummy-opener,ddd-pendulum-opener \
//     --arch=mlp:32 --seed=42 --generations=60 \
//     --budget-ms=6000 --node-budget=400 --basename=neural-tier-a-latest
// =============================================================================

import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  runFixture,
  type HandFixture,
  type FixtureFile,
  type FixtureResult,
} from './evaluate-structural.js';
import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../src/solver/route-aware-ranker.js';
import { NeuralFeatureRanker, type NeuralWeights } from '../src/solver/neural-ranker.js';
import {
  STATE_FEATURE_NAMES,
  ACTION_FEATURE_NAMES,
  FEATURE_DIM,
  computeFeatureSpecHash,
} from '../src/solver/state-feature-extractor.js';
import { buildCardMetadataMap } from '../src/solver/card-metadata.js';
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
  fixtures: string[];
  arch: 'linear' | { kind: 'mlp'; hidden: number };
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
    if (!Number.isFinite(n)) throw new Error(`[train-neural] bad number: ${v}`);
    return n;
  };

  const fixturesRaw = pick('fixtures') ?? 'branded-dracotail-opener,ryzeal-mitsurugi-opener,snake-eye-yummy-opener,ddd-pendulum-opener';
  const fixtures = fixturesRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (fixtures.length === 0) throw new Error('[train-neural] --fixtures empty');

  // --arch=linear | mlp:32 | mlp (alias for mlp:32)
  const archRaw = pick('arch') ?? 'mlp:32';
  let arch: Args['arch'];
  if (archRaw === 'linear') {
    arch = 'linear';
  } else if (archRaw === 'mlp' || archRaw.startsWith('mlp:')) {
    const hRaw = archRaw === 'mlp' ? '32' : archRaw.slice(4);
    const h = Number(hRaw);
    if (!Number.isInteger(h) || h <= 0) {
      throw new Error(`[train-neural] --arch=mlp:H requires positive integer H, got '${hRaw}'`);
    }
    arch = { kind: 'mlp', hidden: h };
  } else {
    throw new Error(`[train-neural] --arch must be 'linear' or 'mlp[:H]', got '${archRaw}'`);
  }

  const seed = numOrDefault(pick('seed'), 42);
  const baseRaw = pick('basename') ?? 'neural-tier-a-latest';
  const basename = baseRaw.includes('seed') ? baseRaw : `${baseRaw}-seed${seed}`;

  return {
    fixtures,
    arch,
    generations: numOrDefault(pick('generations'), 60),
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
// Vector layout
// -----------------------------------------------------------------------------

interface VectorLayout {
  total: number;
  arch: 'linear' | { kind: 'mlp'; hidden: number };
  // Linear: vec[0..FEATURE_DIM-1] = W1, vec[FEATURE_DIM] reserved for b1=0 (NOT in vec).
  // MLP: vec[0..H*FD-1] = W1 row-major (H × FD),
  //      vec[H*FD..H*FD+H-1] = b1,
  //      vec[H*FD+H..H*FD+2H-1] = W2,
  //      vec[H*FD+2H] = b2 scalar.
}

function makeLayout(arch: Args['arch']): VectorLayout {
  if (arch === 'linear') {
    return { total: FEATURE_DIM, arch };
  }
  const H = arch.hidden;
  const total = H * FEATURE_DIM + H + H + 1;
  return { total, arch };
}

function buildNeuralWeights(
  vec: Vector,
  layout: VectorLayout,
  bonusScale: number,
  metadata: NeuralWeights['metadata'] = {},
): NeuralWeights {
  if (vec.length !== layout.total) {
    throw new Error(`[train-neural] vec length ${vec.length} != layout total ${layout.total}`);
  }
  if (layout.arch === 'linear') {
    return {
      version: 'neural-v1',
      tier: 'A',
      arch: { inputDim: FEATURE_DIM, hidden: [], activation: 'relu' },
      featureSpec: { stateFeatures: STATE_FEATURE_NAMES, actionFeatures: ACTION_FEATURE_NAMES },
      featureSpecHash: computeFeatureSpecHash(),
      params: {
        W1: Array.from(vec),
        b1: [0],
        bonusScale,
      },
      metadata,
    };
  }

  const H = layout.arch.hidden;
  const W1: number[][] = [];
  for (let h = 0; h < H; h++) {
    const row: number[] = new Array(FEATURE_DIM);
    for (let i = 0; i < FEATURE_DIM; i++) row[i] = vec[h * FEATURE_DIM + i];
    W1.push(row);
  }
  const offsetB1 = H * FEATURE_DIM;
  const offsetW2 = offsetB1 + H;
  const offsetB2 = offsetW2 + H;
  const b1: number[] = new Array(H);
  for (let h = 0; h < H; h++) b1[h] = vec[offsetB1 + h];
  const W2Row: number[] = new Array(H);
  for (let h = 0; h < H; h++) W2Row[h] = vec[offsetW2 + h];
  const b2: number[] = [vec[offsetB2]];

  return {
    version: 'neural-v1',
    tier: 'A',
    arch: { inputDim: FEATURE_DIM, hidden: [H], activation: 'relu' },
    featureSpec: { stateFeatures: STATE_FEATURE_NAMES, actionFeatures: ACTION_FEATURE_NAMES },
    featureSpecHash: computeFeatureSpecHash(),
    params: { W1, b1, W2: [W2Row], b2, bonusScale },
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

interface FixtureCtx {
  hand: HandFixture;
  deck: { main: number[]; extra: number[] };
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Honest config + explicit determinism. Snapshot fork is on by default but
  // explicitly setting the env protects against external pollution.
  if (process.env.SOLVER_DISABLE_EXPERTISE !== '1') {
    console.log('[train-neural] forcing SOLVER_DISABLE_EXPERTISE=1');
    process.env.SOLVER_DISABLE_EXPERTISE = '1';
  }
  delete process.env.SOLVER_IMPLICIT_GOALS;
  delete process.env.SOLVER_IMPLICIT_GOALS_WEIGHT;
  if (process.env.SOLVER_USE_SNAPSHOT === '0' || process.env.SOLVER_USE_SNAPSHOT === 'false') {
    console.warn('[train-neural] WARNING: SOLVER_USE_SNAPSHOT explicitly off — DFS will be non-deterministic');
  } else {
    process.env.SOLVER_USE_SNAPSHOT = '1';
  }

  const archDesc = args.arch === 'linear' ? 'linear' : `mlp[${args.arch.hidden}]`;
  const layout = makeLayout(args.arch);
  console.log(`[train-neural] fixtures=${args.fixtures.join(',')} arch=${archDesc} dim=${layout.total} generations=${args.generations} μ=${args.mu} λ=${args.lambda} budget=${args.budgetMs}ms nb=${args.nodeBudget ?? '∞'} seed=${args.seed}`);
  console.log(`[train-neural] feature-spec hash = ${computeFeatureSpecHash()}`);
  console.log(`[train-neural] bonusScale=${args.fixedBonusScale} fixed (single σ schedule on ${layout.total} weights)`);

  // ---- Load fixtures + boot OCGCore ---------------------------------------
  const fixture: FixtureFile = loadFixtureFile();
  const fixtureCtxs: FixtureCtx[] = [];
  for (const id of args.fixtures) {
    const hand = fixture.hands.find(h => h.id === id);
    if (!hand) throw new Error(`[train-neural] fixture '${id}' not found`);
    if (hand._draft) console.warn(`[train-neural] warning: '${id}' is _draft`);
    const deck = fixture.decks[hand.deck];
    if (!deck) throw new Error(`[train-neural] deck '${hand.deck}' not found`);
    fixtureCtxs.push({ hand, deck });
  }

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  // Card metadata: union of all training-set decks + hands. Reused across
  // fixtures (deck-agnostic features only need cardId → metadata lookup).
  const allCardIds: number[] = [];
  for (const fc of fixtureCtxs) {
    allCardIds.push(...fc.deck.main, ...fc.deck.extra, ...fc.hand.hand);
  }
  const cardMetadata = buildCardMetadataMap(cardDB, allCardIds);

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

  // Per-fixture deck pool refresh happens inside `runFixture` (it detects
  // `dfsRanker instanceof NeuralFeatureRanker` and pushes mainDeck/extraDeck).

  // ---- Baseline: zeros vector (fallback to base ranker via undefined) -----
  neuralRanker.setNeuralWeights(undefined);
  const baselinePerFixture: Map<string, FixtureResult> = new Map();
  let baselineSum = 0;
  let baselineMatchedSum = 0;
  let baselineMatchedTotalSum = 0;
  for (const fc of fixtureCtxs) {
    const res = await runFixture(
      adapter, scorer, routeAware, fixture, fc.hand, allConfigs,
      args.budgetMs, args.nodeBudget, { dfsRanker: neuralRanker },
    );
    baselinePerFixture.set(fc.hand.id, res);
    baselineSum += res.breakdown.interruptionScore;
    baselineMatchedSum += res.matched;
    baselineMatchedTotalSum += res.matchedTotal;
    console.log(`[train-neural] baseline ${fc.hand.id}: score=${res.breakdown.interruptionScore.toFixed(2)} matched=${res.matched}/${res.matchedTotal} term=${res.terminationReason}`);
  }
  console.log(`[train-neural] baseline aggregate: sum=${baselineSum.toFixed(2)} matched=${baselineMatchedSum}/${baselineMatchedTotalSum}`);

  // ---- Trace dir ----------------------------------------------------------
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
      kind: 'neural-multi-fix',
      fixtures: args.fixtures,
      arch: args.arch === 'linear' ? 'linear' : `mlp[${args.arch.hidden}]`,
      vectorDim: layout.total,
      mu: args.mu,
      lambda: args.lambda,
      generations: args.generations,
      seed: args.seed,
      budgetMs: args.budgetMs,
      nodeBudget: args.nodeBudget ?? null,
      featureDim: FEATURE_DIM,
      featureSpecHash: computeFeatureSpecHash(),
      bonusScale: args.fixedBonusScale,
      baselineSum,
      baselineMatchedSum,
      baselineMatchedTotalSum,
      baselinePerFixture: Array.from(baselinePerFixture.entries()).map(([id, res]) => ({
        id,
        score: res.breakdown.interruptionScore,
        matched: res.matched,
        matchedTotal: res.matchedTotal,
      })),
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

  // Fitness = sum over fixtures of pure interruptionScore.
  const fitnessFn = async (vec: Vector): Promise<number> => {
    const w = buildNeuralWeights(vec, layout, args.fixedBonusScale);
    neuralRanker.setNeuralWeights(w);
    let sum = 0;
    for (const fc of fixtureCtxs) {
      const res = await runFixture(
        adapter, scorer, routeAware, fixture, fc.hand, allConfigs,
        args.budgetMs, args.nodeBudget, { dfsRanker: neuralRanker },
      );
      sum += res.breakdown.interruptionScore;
    }
    return sum;
  };

  let bestFitness = baselineSum;
  let bestVector: Vector = new Array(layout.total).fill(0);

  const onPop = (snap: PopulationSnapshot): void => {
    if (!populationPath || !mutationsPath) return;
    const popLines: string[] = [];
    for (let i = 0; i < snap.parents.length; i++) {
      popLines.push(JSON.stringify({
        gen: snap.generation, kind: 'parent', idx: i,
        fitness: snap.parents[i].fitness, sigma: snap.sigma,
        // For MLP runs the vector is 3000+ floats — log without inflating
        // population.jsonl beyond ~50 MB by capping at first 200 dims.
        vectorPreview: Array.from(snap.parents[i].vector).slice(0, 200),
        vectorLen: snap.parents[i].vector.length,
      }));
    }
    for (let i = 0; i < snap.offspring.length; i++) {
      const o = snap.offspring[i];
      popLines.push(JSON.stringify({
        gen: snap.generation, kind: 'offspring', idx: i,
        parentIdx: o.parentIdx, fitness: o.fitness,
        survivedAsParent: o.survivedAsParent, sigma: snap.sigma,
        vectorPreview: Array.from(o.vector).slice(0, 200),
        vectorLen: o.vector.length,
      }));
    }
    appendFileSync(populationPath, popLines.join('\n') + (popLines.length > 0 ? '\n' : ''), 'utf-8');

    if (snap.offspring.length > 0) {
      const mutLines: string[] = [];
      for (let i = 0; i < snap.offspring.length; i++) {
        const o = snap.offspring[i];
        mutLines.push(JSON.stringify({
          gen: snap.generation, childIdx: i, parentIdx: o.parentIdx,
          parentFitness: o.parentFitness, childFitness: o.fitness,
          deltaFitness: o.fitness - o.parentFitness,
          survivedAsParent: o.survivedAsParent, sigma: snap.sigma,
          // Cap deltas preview as well.
          deltasPreview: o.deltas.slice(0, 200),
          deltasLen: o.deltas.length,
        }));
      }
      appendFileSync(mutationsPath, mutLines.join('\n') + '\n', 'utf-8');
    }
  };

  const onGen = (
    stats: { generation: number; bestFitness: number; meanFitness: number; stdFitness: number; sigma: number; successRate: number },
    best: { vector: Vector; fitness: number },
  ): void => {
    console.log(`[train-neural] gen=${stats.generation} best=${stats.bestFitness.toFixed(2)} mean=${stats.meanFitness.toFixed(2)} std=${stats.stdFitness.toFixed(2)} σ=${stats.sigma.toFixed(3)} succ=${(stats.successRate * 100).toFixed(0)}%`);
    csvRows.push(`${stats.generation},${stats.bestFitness.toFixed(3)},${stats.meanFitness.toFixed(3)},${stats.stdFitness.toFixed(3)},${stats.sigma.toFixed(4)},${stats.successRate.toFixed(3)}`);

    if (best.fitness > bestFitness) {
      bestFitness = best.fitness;
      bestVector = best.vector;
    }
  };

  const initialVec: Vector = new Array(layout.total).fill(0);
  const { best, history } = await es.run(initialVec, fitnessFn, onGen, onPop);
  if (best.fitness > bestFitness) {
    bestFitness = best.fitness;
    bestVector = best.vector;
  }

  // ---- Final save ----------------------------------------------------------
  const finalWeights = buildNeuralWeights(bestVector, layout, args.fixedBonusScale, {
    trainedAt: new Date().toISOString(),
    generations: history.length,
    fixturesUsed: args.fixtures,
    seed: args.seed,
    fitness: { bestFitness, baselineFitness: baselineSum, lift: bestFitness - baselineSum },
    notes: `multi-fix arch=${archDesc} fixtures=${args.fixtures.length} baseline=${baselineSum.toFixed(2)} best=${bestFitness.toFixed(2)} lift=${(bestFitness - baselineSum).toFixed(2)}`,
  });
  const finalPath = join(args.weightsDir, `${args.basename}.json`);
  saveNeuralWeights(finalPath, finalWeights);
  console.log(`[train-neural] final weights → ${finalPath}`);

  // ---- Re-eval per-fixture at best weights ---------------------------------
  neuralRanker.setNeuralWeights(finalWeights);
  let reEvalSum = 0;
  let reEvalMatchedSum = 0;
  for (const fc of fixtureCtxs) {
    const res = await runFixture(
      adapter, scorer, routeAware, fixture, fc.hand, allConfigs,
      args.budgetMs, args.nodeBudget, { dfsRanker: neuralRanker },
    );
    reEvalSum += res.breakdown.interruptionScore;
    reEvalMatchedSum += res.matched;
    const baseline = baselinePerFixture.get(fc.hand.id)!;
    const dF = res.breakdown.interruptionScore - baseline.breakdown.interruptionScore;
    const dM = res.matched - baseline.matched;
    console.log(`[train-neural] re-eval ${fc.hand.id}: score=${res.breakdown.interruptionScore.toFixed(2)} (Δ${dF >= 0 ? '+' : ''}${dF.toFixed(2)}) matched=${res.matched}/${res.matchedTotal} (Δ${dM >= 0 ? '+' : ''}${dM}) term=${res.terminationReason}`);
  }
  const dSum = reEvalSum - baselineSum;
  const dMatched = reEvalMatchedSum - baselineMatchedSum;
  console.log(`[train-neural] re-eval aggregate: sum=${reEvalSum.toFixed(2)} (Δ${dSum >= 0 ? '+' : ''}${dSum.toFixed(2)})  matched=${reEvalMatchedSum}/${baselineMatchedTotalSum} (Δ${dMatched >= 0 ? '+' : ''}${dMatched})`);

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
