// =============================================================================
// train-neural-pool.ts — Phase B parallel-pool trainer (Piscina-based).
//
// ⚠️ KNOWN ISSUE (2026-04-27): IN-ES PARALLELISM PRODUCES FITNESS/EVAL
// REGIME MISMATCH. With N>1 workers running offspring rollouts in parallel
// during training, CPU thermal throttle reduces per-rollout DFS depth
// (DFS is wall-clock-bound at budget-ms=6000). The trained weights
// optimize for "contended-DFS" fitness signal, but single-task re-eval
// (1 worker active) sees uncontended-DFS — the weights don't transfer.
// Empirically: pool=4 gives 3× training speedup but final re-eval drops
// to baseline (no lift). Same root cause as F2 det regime overfit-by-budget.
//
// USE `run-multi-seed-parallel.sh` INSTEAD for Sprint 3 multi-seed runs.
// That pattern uses process-level seed parallelism (one Node process per
// seed, each single-threaded) — no in-process contention, no regime
// mismatch, ~N× speedup at the seed level.
//
// This file is preserved as exploratory infrastructure. The Piscina worker
// module + .mjs bootstrap remain reusable. The `concurrency` option in
// EvolutionStrategy is also retained — could be safely used IF the regime
// mismatch is somehow mitigated (e.g., budget-ms=30000 nb-bound, where
// CPU contention doesn't affect node count).
//
// Mirrors `train-neural.ts` CLI surface but evaluates ES offspring + parents
// in parallel via a Piscina worker pool.
//
// Hard constraints (same as train-neural.ts):
// - Fitness = pure summed `interruptionScore`. No matched², no goalMatchPoints.
// - bonusScale fixed at 100. ES evolves only the linear/MLP weights.
// - σ_init=0.3, σ_min=0.05, single class.
// - Honest config (SOLVER_DISABLE_EXPERTISE=1) forced + production regime
//   budget-ms=6000 / nb=400 by default.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/train-neural-pool.ts \
//     --fixtures=branded-dracotail-opener,ryzeal-mitsurugi-opener,snake-eye-yummy-opener,ddd-pendulum-opener \
//     --arch=mlp:32 --seed=42 --generations=30 --init-std=0.1 \
//     --budget-ms=6000 --node-budget=400 \
//     --pool-size=5 \
//     --basename=neural-mlpv3-pooled
// =============================================================================

import { availableParallelism } from 'node:os';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Piscina } from 'piscina';

import {
  DATA_DIR,
  loadFixtureFile,
  type FixtureFile,
} from '../eval/evaluate-structural.js';
import { type NeuralWeights } from '../../src/solver/ml/neural-ranker.js';
import {
  STATE_FEATURE_NAMES,
  ACTION_FEATURE_NAMES,
  FEATURE_DIM,
  computeFeatureSpecHash,
} from '../../src/solver/ml/state-feature-extractor.js';
import {
  EvolutionStrategy,
  DEFAULT_ES_CONFIG,
  type Vector,
  type Individual,
  type PopulationSnapshot,
  type GenerationStats,
  type OffspringRecord,
} from './lib/evolution-strategy.js';
import type { TrainTask, TrainTaskResult, PerFixtureResult } from './train-neural-worker.js';

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
  initMode: { kind: 'zero' } | { kind: 'gaussian'; std: number };
  poolSize: number;
}

function parseArgs(): Args {
  const pick = (name: string): string | undefined => {
    const arg = process.argv.find(a => a.startsWith(`--${name}=`));
    return arg?.slice(name.length + 3);
  };
  const numOrDefault = (v: string | undefined, d: number): number => {
    if (!v) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`[train-neural-pool] bad number: ${v}`);
    return n;
  };

  const fixturesRaw = pick('fixtures') ?? 'branded-dracotail-opener,ryzeal-mitsurugi-opener,snake-eye-yummy-opener,ddd-pendulum-opener';
  const fixtures = fixturesRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (fixtures.length === 0) throw new Error('[train-neural-pool] --fixtures empty');

  const archRaw = pick('arch') ?? 'mlp:32';
  let arch: Args['arch'];
  if (archRaw === 'linear') {
    arch = 'linear';
  } else if (archRaw === 'mlp' || archRaw.startsWith('mlp:')) {
    const hRaw = archRaw === 'mlp' ? '32' : archRaw.slice(4);
    const h = Number(hRaw);
    if (!Number.isInteger(h) || h <= 0) {
      throw new Error(`[train-neural-pool] --arch=mlp:H requires positive integer H, got '${hRaw}'`);
    }
    arch = { kind: 'mlp', hidden: h };
  } else {
    throw new Error(`[train-neural-pool] --arch must be 'linear' or 'mlp[:H]', got '${archRaw}'`);
  }

  const seed = numOrDefault(pick('seed'), 42);
  const baseRaw = pick('basename') ?? 'neural-tier-a-latest';
  const basename = baseRaw.includes('seed') ? baseRaw : `${baseRaw}-seed${seed}`;

  const initStd = numOrDefault(pick('init-std'), 0);
  const initMode: Args['initMode'] = initStd > 0
    ? { kind: 'gaussian', std: initStd }
    : { kind: 'zero' };

  const poolSize = numOrDefault(pick('pool-size'), Math.max(1, availableParallelism() - 2));

  return {
    fixtures,
    arch,
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
    initMode,
    poolSize,
  };
}

// -----------------------------------------------------------------------------
// Vector layout (mirror train-neural.ts) + initial vector
// -----------------------------------------------------------------------------

interface VectorLayout {
  total: number;
  arch: 'linear' | { kind: 'mlp'; hidden: number };
}

function makeLayout(arch: Args['arch']): VectorLayout {
  if (arch === 'linear') return { total: FEATURE_DIM, arch };
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
    throw new Error(`[train-neural-pool] vec length ${vec.length} != layout total ${layout.total}`);
  }
  if (layout.arch === 'linear') {
    return {
      version: 'neural-v1',
      tier: 'A',
      arch: { inputDim: FEATURE_DIM, hidden: [], activation: 'relu' },
      featureSpec: { stateFeatures: STATE_FEATURE_NAMES, actionFeatures: ACTION_FEATURE_NAMES },
      featureSpecHash: computeFeatureSpecHash(),
      params: { W1: Array.from(vec), b1: [0], bonusScale },
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

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianSampler(seed: number): () => number {
  const rng = mulberry32(seed);
  return () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };
}

function buildInitialVector(layout: VectorLayout, args: Args): Vector {
  const vec: number[] = new Array(layout.total).fill(0);
  if (args.initMode.kind === 'zero') return vec;
  const sample = gaussianSampler(args.seed - 1);
  const std = args.initMode.std;
  for (let i = 0; i < layout.total; i++) vec[i] = sample() * std;
  return vec;
}

// -----------------------------------------------------------------------------
// Pool-based ES adapter
// -----------------------------------------------------------------------------

/** Wraps EvolutionStrategy.run() with a Piscina-backed parallel fitness
 *  function. Each generation's offspring and bootstrap parents are evaluated
 *  in parallel via the worker pool. */
async function runPooledES(args: {
  pool: Piscina;
  initialVec: Vector;
  layout: VectorLayout;
  fixedBonusScale: number;
  fixtureIds: readonly string[];
  timeLimitMs: number;
  nodeBudget: number | undefined;
  esConfig: { mu: number; lambda: number; maxGenerations: number; seed: number; initialSigma: number; sigmaMin: number; concurrency?: number };
  onGen?: (stats: GenerationStats, best: Individual) => void;
  onPop?: (snap: PopulationSnapshot) => void;
}): Promise<{ best: Individual; history: GenerationStats[] }> {
  const es = new EvolutionStrategy({ ...DEFAULT_ES_CONFIG, ...args.esConfig });

  const fitnessFn = async (vec: Vector): Promise<number> => {
    const weights = buildNeuralWeights(vec, args.layout, args.fixedBonusScale);
    const task: TrainTask = {
      weights,
      fixtureIds: args.fixtureIds,
      timeLimitMs: args.timeLimitMs,
      nodeBudget: args.nodeBudget,
    };
    const res = await args.pool.run(task) as TrainTaskResult;
    return res.fitness;
  };

  return es.run(args.initialVec, fitnessFn, args.onGen, args.onPop);
}

// -----------------------------------------------------------------------------
// Per-fixture re-eval at best weights (uses pool too — single task per fixture)
// -----------------------------------------------------------------------------

async function reEvalPerFixture(
  pool: Piscina,
  weights: NeuralWeights,
  fixtureIds: readonly string[],
  timeLimitMs: number,
  nodeBudget: number | undefined,
): Promise<PerFixtureResult[]> {
  const task: TrainTask = { weights, fixtureIds, timeLimitMs, nodeBudget };
  const res = await pool.run(task) as TrainTaskResult;
  return res.perFixture;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  // Honest config + explicit determinism enforcement (workers re-set this in
  // their own env, but parent must signal too for any in-process operations).
  if (process.env.SOLVER_DISABLE_EXPERTISE !== '1') {
    console.log('[train-neural-pool] forcing SOLVER_DISABLE_EXPERTISE=1');
    process.env.SOLVER_DISABLE_EXPERTISE = '1';
  }
  delete process.env.SOLVER_IMPLICIT_GOALS;
  delete process.env.SOLVER_IMPLICIT_GOALS_WEIGHT;
  if (process.env.SOLVER_USE_SNAPSHOT === '0' || process.env.SOLVER_USE_SNAPSHOT === 'false') {
    console.warn('[train-neural-pool] WARNING: SOLVER_USE_SNAPSHOT explicitly off — DFS will be non-deterministic');
  } else {
    process.env.SOLVER_USE_SNAPSHOT = '1';
  }

  const archDesc = args.arch === 'linear' ? 'linear' : `mlp[${args.arch.hidden}]`;
  const layout = makeLayout(args.arch);

  console.log(`[train-neural-pool] fixtures=${args.fixtures.join(',')} arch=${archDesc} dim=${layout.total} generations=${args.generations} μ=${args.mu} λ=${args.lambda} budget=${args.budgetMs}ms nb=${args.nodeBudget ?? '∞'} seed=${args.seed} pool=${args.poolSize}`);
  console.log(`[train-neural-pool] feature-spec hash = ${computeFeatureSpecHash()}`);
  console.log(`[train-neural-pool] bonusScale=${args.fixedBonusScale} fixed (single σ schedule on ${layout.total} weights)`);

  // ---- Validate fixtures (light boot, no WASM) ----------------------------
  const fixture: FixtureFile = loadFixtureFile();
  for (const id of args.fixtures) {
    const hand = fixture.hands.find(h => h.id === id);
    if (!hand) throw new Error(`[train-neural-pool] fixture '${id}' not found`);
    if (hand._draft) console.warn(`[train-neural-pool] warning: '${id}' is _draft`);
    const deck = fixture.decks[hand.deck];
    if (!deck) throw new Error(`[train-neural-pool] deck '${hand.deck}' not found`);
  }

  // ---- Spin up Piscina worker pool ----------------------------------------
  console.log(`[train-neural-pool] pool size: ${args.poolSize} workers`);
  const pool = new Piscina({
    filename: resolve(import.meta.dirname!, 'train-neural-worker.mjs'),
    minThreads: args.poolSize,
    maxThreads: args.poolSize,
    idleTimeout: Infinity,
    env: { ...process.env },
  });

  // ---- Baseline: zeros vector → workers run base ranker (since weights
  //   yield zero forward, the ranker effectively delegates to base).
  // -------------------------------------------------------------------------
  const baselineWeights = buildNeuralWeights(
    new Array(layout.total).fill(0),
    layout,
    args.fixedBonusScale,
  );
  const baselineRes = await pool.run({
    weights: baselineWeights,
    fixtureIds: args.fixtures,
    timeLimitMs: args.budgetMs,
    nodeBudget: args.nodeBudget,
  }) as TrainTaskResult;

  console.log(`[train-neural-pool] baseline aggregate: sum=${baselineRes.fitness.toFixed(2)}`);
  for (const pf of baselineRes.perFixture) {
    console.log(`[train-neural-pool] baseline ${pf.id}: score=${pf.interruptionScore.toFixed(2)} matched=${pf.matched}/${pf.matchedTotal} term=${pf.terminationReason}`);
  }
  const baselineSum = baselineRes.fitness;

  // ---- Trace dir setup ----------------------------------------------------
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
      kind: 'neural-pool',
      fixtures: args.fixtures,
      arch: args.arch === 'linear' ? 'linear' : `mlp[${args.arch.hidden}]`,
      vectorDim: layout.total,
      mu: args.mu,
      lambda: args.lambda,
      generations: args.generations,
      seed: args.seed,
      budgetMs: args.budgetMs,
      nodeBudget: args.nodeBudget ?? null,
      poolSize: args.poolSize,
      featureDim: FEATURE_DIM,
      featureSpecHash: computeFeatureSpecHash(),
      bonusScale: args.fixedBonusScale,
      baselineSum,
    }, null, 2) + '\n', 'utf-8');
    writeFileSync(populationPath, '', 'utf-8');
    writeFileSync(mutationsPath, '', 'utf-8');
    console.log(`[train-neural-pool] trace dir → ${traceDir}`);
  }

  // ---- ES loop with pooled fitness ----------------------------------------
  const csvRows: string[] = ['generation,bestFitness,meanFitness,stdFitness,sigma,successRate'];
  let bestFitness = baselineSum;
  let bestVector: Vector = new Array(layout.total).fill(0);

  const onPop = (snap: PopulationSnapshot): void => {
    if (!populationPath || !mutationsPath) return;
    const popLines: string[] = [];
    for (let i = 0; i < snap.parents.length; i++) {
      popLines.push(JSON.stringify({
        gen: snap.generation, kind: 'parent', idx: i,
        fitness: snap.parents[i].fitness, sigma: snap.sigma,
        vectorPreview: Array.from(snap.parents[i].vector).slice(0, 200),
        vectorLen: snap.parents[i].vector.length,
      }));
    }
    for (let i = 0; i < snap.offspring.length; i++) {
      const o: OffspringRecord = snap.offspring[i];
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
          deltasPreview: o.deltas.slice(0, 200),
          deltasLen: o.deltas.length,
        }));
      }
      appendFileSync(mutationsPath, mutLines.join('\n') + '\n', 'utf-8');
    }
  };

  const onGen = (stats: GenerationStats, best: Individual): void => {
    console.log(`[train-neural-pool] gen=${stats.generation} best=${stats.bestFitness.toFixed(2)} mean=${stats.meanFitness.toFixed(2)} std=${stats.stdFitness.toFixed(2)} σ=${stats.sigma.toFixed(3)} succ=${(stats.successRate * 100).toFixed(0)}%`);
    csvRows.push(`${stats.generation},${stats.bestFitness.toFixed(3)},${stats.meanFitness.toFixed(3)},${stats.stdFitness.toFixed(3)},${stats.sigma.toFixed(4)},${stats.successRate.toFixed(3)}`);
    if (best.fitness > bestFitness) {
      bestFitness = best.fitness;
      bestVector = best.vector;
    }
  };

  const initialVec = buildInitialVector(layout, args);
  if (args.initMode.kind === 'gaussian') {
    console.log(`[train-neural-pool] init=gaussian(0, ${args.initMode.std}) seeded off ${args.seed - 1}`);
  }

  const t0 = Date.now();
  const { best, history } = await runPooledES({
    pool,
    initialVec,
    layout,
    fixedBonusScale: args.fixedBonusScale,
    fixtureIds: args.fixtures,
    timeLimitMs: args.budgetMs,
    nodeBudget: args.nodeBudget,
    esConfig: {
      mu: args.mu,
      lambda: args.lambda,
      maxGenerations: args.generations,
      seed: args.seed,
      initialSigma: 0.3,
      sigmaMin: 0.05,
      concurrency: args.poolSize,  // ES dispatches λ Promise.all per gen
    },
    onGen,
    onPop,
  });
  const trainElapsedMs = Date.now() - t0;
  if (best.fitness > bestFitness) {
    bestFitness = best.fitness;
    bestVector = best.vector;
  }
  console.log(`[train-neural-pool] training elapsed: ${(trainElapsedMs / 1000).toFixed(1)}s for ${args.generations} gens`);

  // ---- Final save ---------------------------------------------------------
  const finalWeights = buildNeuralWeights(bestVector, layout, args.fixedBonusScale, {
    trainedAt: new Date().toISOString(),
    generations: history.length,
    fixturesUsed: args.fixtures,
    seed: args.seed,
    fitness: { bestFitness, baselineFitness: baselineSum, lift: bestFitness - baselineSum },
    notes: `pooled trainer arch=${archDesc} fixtures=${args.fixtures.length} pool=${args.poolSize} elapsed=${(trainElapsedMs / 1000).toFixed(1)}s baseline=${baselineSum.toFixed(2)} best=${bestFitness.toFixed(2)} lift=${(bestFitness - baselineSum).toFixed(2)}`,
  });
  const finalPath = join(args.weightsDir, `${args.basename}.json`);
  saveNeuralWeights(finalPath, finalWeights);
  console.log(`[train-neural-pool] final weights → ${finalPath}`);

  // ---- Re-eval per-fixture at best weights (single pool task) -------------
  const reEval = await reEvalPerFixture(pool, finalWeights, args.fixtures, args.budgetMs, args.nodeBudget);
  const reEvalSum = reEval.reduce((s, pf) => s + pf.interruptionScore, 0);
  const reEvalMatched = reEval.reduce((s, pf) => s + pf.matched, 0);
  const reEvalMatchedTotal = reEval.reduce((s, pf) => s + pf.matchedTotal, 0);
  const baselineMatched = baselineRes.perFixture.reduce((s, pf) => s + pf.matched, 0);
  for (const pf of reEval) {
    const baseline = baselineRes.perFixture.find(b => b.id === pf.id);
    const dF = pf.interruptionScore - (baseline?.interruptionScore ?? 0);
    const dM = pf.matched - (baseline?.matched ?? 0);
    console.log(`[train-neural-pool] re-eval ${pf.id}: score=${pf.interruptionScore.toFixed(2)} (Δ${dF >= 0 ? '+' : ''}${dF.toFixed(2)}) matched=${pf.matched}/${pf.matchedTotal} (Δ${dM >= 0 ? '+' : ''}${dM}) term=${pf.terminationReason}`);
  }
  const dSum = reEvalSum - baselineSum;
  const dMatched = reEvalMatched - baselineMatched;
  console.log(`[train-neural-pool] re-eval aggregate: sum=${reEvalSum.toFixed(2)} (Δ${dSum >= 0 ? '+' : ''}${dSum.toFixed(2)})  matched=${reEvalMatched}/${reEvalMatchedTotal} (Δ${dMatched >= 0 ? '+' : ''}${dMatched})`);

  if (args.csv) {
    mkdirSync(dirname(resolve(args.csv)), { recursive: true });
    writeFileSync(resolve(args.csv), csvRows.join('\n') + '\n', 'utf-8');
    console.log(`[train-neural-pool] csv → ${args.csv}`);
  }

  await pool.destroy();
}

main().catch(err => {
  console.error('[train-neural-pool] fatal:', err);
  process.exit(1);
});
