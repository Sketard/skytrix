// =============================================================================
// train-value-head-pilot.ts — Pilot V(s) trainer for the value-head experiment.
//
// Question: can a simple MLP, fed only stateFeatures (58 dims), predict the
// terminal score of the trajectory it is part of better than mean-prediction?
//
// If YES (MAE val < 70% of mean-prediction MAE) → GO industrialisation.
// If marginal → diagnose corpus / features / arch.
// If NULL (MAE val >= MAE mean) → value head doesn't fit the corpus, pivot.
//
// Inputs: trajectory dumps under data/value-head-pilot/corpus/<fixture>/.
//   Each *.json file = 1 trajectory with .trajectory[] (per-step features) +
//   .outcome.score (target V for every step in this trajectory).
//
// Output: data/value-head-pilot/results/<seed>.json with MAE train/val per
//   seed + median across seeds + verdict.
//
// Architecture: MLP[58 → 64 → 32 → 1] with ReLU + dropout 0.2.
// Training: Adam lr=1e-3, batch=64, epochs=100 with early stopping on val.
// Loss: MSE.
// Val split: by trajectory (NOT by step) to avoid temporal leakage —
//   states from the same trajectory share V_target, so per-step split would
//   trivially leak.
// =============================================================================

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STATE_DIM = 58;

interface TrajectoryStep {
  step: number;
  promptType: string;
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionVerb: string | null;
  stateFeatures: Record<string, number>;
  actionFeatures: Record<string, number>;
}

interface TrajectoryDump {
  schemaVersion: number;
  fixtureId: string;
  outcome: { score: number; matched: number; matchedTotal: number };
  trajectory: TrajectoryStep[];
}

interface DataPoint {
  features: number[]; // 58 stateFeatures, ordered
  target: number;     // outcome.score
  trajectoryId: string;
  fixtureId: string;
  step: number;
}

// =============================================================================
// Data loading
// =============================================================================

function loadCorpus(corpusRoot: string): DataPoint[] {
  const points: DataPoint[] = [];
  const fixtures = readdirSync(corpusRoot);
  for (const fixture of fixtures) {
    const dir = join(corpusRoot, fixture);
    const files = readdirSync(dir).filter(f => f.endsWith('-trajectory.json'));
    for (const f of files) {
      const dump = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TrajectoryDump;
      const trajectoryId = `${fixture}/${f.replace('-trajectory.json', '')}`;
      const target = dump.outcome.score;
      for (const step of dump.trajectory) {
        const features = Object.values(step.stateFeatures);
        if (features.length !== STATE_DIM) {
          console.warn(`[loader] ${trajectoryId} step ${step.step}: expected ${STATE_DIM} features, got ${features.length}`);
          continue;
        }
        points.push({
          features,
          target,
          trajectoryId,
          fixtureId: fixture,
          step: step.step,
        });
      }
    }
  }
  return points;
}

// =============================================================================
// MLP from scratch (no torch dep, pure JS — pilot scale)
// =============================================================================

class MLP {
  // Weights and biases for 3 layers: 58→64, 64→32, 32→1
  W1: number[][]; b1: number[];
  W2: number[][]; b2: number[];
  W3: number[][]; b3: number[];
  drop: number;

  constructor(rng: () => number, dropout = 0.2) {
    this.drop = dropout;
    // Xavier init
    const init = (fanIn: number, fanOut: number): number[][] => {
      const std = Math.sqrt(2 / fanIn);
      return Array.from({ length: fanIn }, () =>
        Array.from({ length: fanOut }, () => (rng() * 2 - 1) * std)
      );
    };
    this.W1 = init(STATE_DIM, 64);
    this.b1 = new Array(64).fill(0);
    this.W2 = init(64, 32);
    this.b2 = new Array(32).fill(0);
    this.W3 = init(32, 1);
    this.b3 = [0];
  }

  // Forward pass with optional dropout (training mode).
  forward(x: number[], training: boolean, rng: () => number): {
    out: number;
    h1: number[]; h1_relu: number[]; h1_mask: number[];
    h2: number[]; h2_relu: number[]; h2_mask: number[];
  } {
    const h1 = matVec(this.W1, x, this.b1);  // 64
    const h1_relu = h1.map(v => Math.max(0, v));
    const h1_mask = training
      ? h1_relu.map(_ => rng() < this.drop ? 0 : 1 / (1 - this.drop))
      : new Array(h1_relu.length).fill(1);
    const h1_out = h1_relu.map((v, i) => v * h1_mask[i]);

    const h2 = matVec(this.W2, h1_out, this.b2);  // 32
    const h2_relu = h2.map(v => Math.max(0, v));
    const h2_mask = training
      ? h2_relu.map(_ => rng() < this.drop ? 0 : 1 / (1 - this.drop))
      : new Array(h2_relu.length).fill(1);
    const h2_out = h2_relu.map((v, i) => v * h2_mask[i]);

    const h3 = matVec(this.W3, h2_out, this.b3);  // 1
    return { out: h3[0], h1, h1_relu, h1_mask, h2, h2_relu, h2_mask };
  }

  // Backward pass on (x, target) with MSE loss. Returns gradients per param.
  backward(
    x: number[], target: number, fwd: ReturnType<MLP['forward']>,
  ): {
    dW1: number[][]; db1: number[];
    dW2: number[][]; db2: number[];
    dW3: number[][]; db3: number[];
    loss: number;
  } {
    const dOut = 2 * (fwd.out - target);  // dLoss/dOut for MSE
    const loss = (fwd.out - target) ** 2;

    // Layer 3: h2_out (32) → out (1)
    // dW3[i][0] = dOut * h2_out[i], db3[0] = dOut
    const h2_out = fwd.h2_relu.map((v, i) => v * fwd.h2_mask[i]);
    const dW3 = h2_out.map(v => [dOut * v]);
    const db3 = [dOut];

    // d_h2_out[i] = dOut * W3[i][0]
    const d_h2_out = this.W3.map(row => dOut * row[0]);
    // d_h2_relu[i] = d_h2_out[i] * mask[i]
    const d_h2_relu = d_h2_out.map((v, i) => v * fwd.h2_mask[i]);
    // d_h2[i] = d_h2_relu[i] if h2[i] > 0 else 0 (ReLU)
    const d_h2 = d_h2_relu.map((v, i) => fwd.h2[i] > 0 ? v : 0);

    // Layer 2: h1_out (64) → h2 (32)
    const h1_out = fwd.h1_relu.map((v, i) => v * fwd.h1_mask[i]);
    const dW2: number[][] = [];
    for (let i = 0; i < 64; i++) {
      const row: number[] = [];
      for (let j = 0; j < 32; j++) row.push(d_h2[j] * h1_out[i]);
      dW2.push(row);
    }
    const db2 = [...d_h2];

    // d_h1_out[i] = sum_j (d_h2[j] * W2[i][j])
    const d_h1_out: number[] = [];
    for (let i = 0; i < 64; i++) {
      let sum = 0;
      for (let j = 0; j < 32; j++) sum += d_h2[j] * this.W2[i][j];
      d_h1_out.push(sum);
    }
    const d_h1_relu = d_h1_out.map((v, i) => v * fwd.h1_mask[i]);
    const d_h1 = d_h1_relu.map((v, i) => fwd.h1[i] > 0 ? v : 0);

    // Layer 1: x (58) → h1 (64)
    const dW1: number[][] = [];
    for (let i = 0; i < STATE_DIM; i++) {
      const row: number[] = [];
      for (let j = 0; j < 64; j++) row.push(d_h1[j] * x[i]);
      dW1.push(row);
    }
    const db1 = [...d_h1];

    return { dW1, db1, dW2, db2, dW3, db3, loss };
  }

  applyGrad(
    grads: { dW1: number[][]; db1: number[]; dW2: number[][]; db2: number[]; dW3: number[][]; db3: number[] },
    lr: number,
  ): void {
    for (let i = 0; i < this.W1.length; i++)
      for (let j = 0; j < this.W1[0].length; j++)
        this.W1[i][j] -= lr * grads.dW1[i][j];
    for (let i = 0; i < this.b1.length; i++) this.b1[i] -= lr * grads.db1[i];
    for (let i = 0; i < this.W2.length; i++)
      for (let j = 0; j < this.W2[0].length; j++)
        this.W2[i][j] -= lr * grads.dW2[i][j];
    for (let i = 0; i < this.b2.length; i++) this.b2[i] -= lr * grads.db2[i];
    for (let i = 0; i < this.W3.length; i++)
      for (let j = 0; j < this.W3[0].length; j++)
        this.W3[i][j] -= lr * grads.dW3[i][j];
    for (let i = 0; i < this.b3.length; i++) this.b3[i] -= lr * grads.db3[i];
  }
}

function matVec(W: number[][], x: number[], b: number[]): number[] {
  const out = [...b];
  for (let i = 0; i < W.length; i++) {
    for (let j = 0; j < W[0].length; j++) {
      out[j] += W[i][j] * x[i];
    }
  }
  return out;
}

// =============================================================================
// Seedable RNG
// =============================================================================

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Train / val split by trajectory
// =============================================================================

function splitByTrajectory(points: DataPoint[], rng: () => number, valRatio = 0.2): {
  train: DataPoint[]; val: DataPoint[]; trajIds: string[]; valTrajIds: string[];
} {
  const trajIds = Array.from(new Set(points.map(p => p.trajectoryId)));
  // Shuffle trajectory IDs deterministically.
  for (let i = trajIds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [trajIds[i], trajIds[j]] = [trajIds[j], trajIds[i]];
  }
  const valCount = Math.max(1, Math.round(trajIds.length * valRatio));
  const valTrajIds = new Set(trajIds.slice(0, valCount));
  const train = points.filter(p => !valTrajIds.has(p.trajectoryId));
  const val = points.filter(p => valTrajIds.has(p.trajectoryId));
  return { train, val, trajIds, valTrajIds: Array.from(valTrajIds) };
}

// =============================================================================
// Training loop
// =============================================================================

interface TrainResult {
  seed: number;
  numTrajectories: number;
  numTrainTrajs: number;
  numValTrajs: number;
  numTrainSteps: number;
  numValSteps: number;
  baselineMeanMaeTrain: number;
  baselineMeanMaeVal: number;
  finalMaeTrain: number;
  finalMaeVal: number;
  bestEpochVal: number;
  bestMaeVal: number;
  valTrajIds: string[];
  predictionsVal: { trajectoryId: string; meanPred: number; meanTarget: number }[];
}

function train(points: DataPoint[], seed: number, epochs = 100, batchSize = 64, lr = 1e-3): TrainResult {
  const rng = mulberry32(seed);
  const split = splitByTrajectory(points, rng);
  const { train: trainData, val: valData } = split;

  // Normalize features: z-score on training set only.
  const featStats: { mean: number[]; std: number[] } = {
    mean: new Array(STATE_DIM).fill(0),
    std: new Array(STATE_DIM).fill(1),
  };
  for (let i = 0; i < STATE_DIM; i++) {
    let sum = 0;
    for (const p of trainData) sum += p.features[i];
    featStats.mean[i] = sum / Math.max(1, trainData.length);
    let sqSum = 0;
    for (const p of trainData) sqSum += (p.features[i] - featStats.mean[i]) ** 2;
    featStats.std[i] = Math.sqrt(sqSum / Math.max(1, trainData.length)) || 1;
  }
  const norm = (p: DataPoint): number[] =>
    p.features.map((v, i) => (v - featStats.mean[i]) / featStats.std[i]);

  // Target normalization: mean-center.
  const targetMean = trainData.reduce((s, p) => s + p.target, 0) / Math.max(1, trainData.length);

  // Baselines: mean prediction (constant = targetMean).
  const baselineMaeTrain = trainData.reduce((s, p) => s + Math.abs(p.target - targetMean), 0) / Math.max(1, trainData.length);
  const baselineMaeVal = valData.reduce((s, p) => s + Math.abs(p.target - targetMean), 0) / Math.max(1, valData.length);

  const mlp = new MLP(rng);
  let bestMaeVal = Infinity;
  let bestEpoch = 0;
  let lastMaeTrain = 0;
  let lastMaeVal = 0;

  // Training loop
  const trainNorm = trainData.map(p => ({ x: norm(p), y: p.target - targetMean, ref: p }));
  const valNorm = valData.map(p => ({ x: norm(p), y: p.target - targetMean, ref: p }));

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Shuffle train.
    for (let i = trainNorm.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [trainNorm[i], trainNorm[j]] = [trainNorm[j], trainNorm[i]];
    }
    // Mini-batch gradient descent.
    for (let b = 0; b < trainNorm.length; b += batchSize) {
      const batch = trainNorm.slice(b, b + batchSize);
      // Accumulate gradients.
      const accum = {
        dW1: zeros2D(STATE_DIM, 64), db1: new Array(64).fill(0),
        dW2: zeros2D(64, 32), db2: new Array(32).fill(0),
        dW3: zeros2D(32, 1), db3: [0],
      };
      for (const item of batch) {
        const fwd = mlp.forward(item.x, true, rng);
        const grad = mlp.backward(item.x, item.y, fwd);
        accum2D(accum.dW1, grad.dW1); accum1D(accum.db1, grad.db1);
        accum2D(accum.dW2, grad.dW2); accum1D(accum.db2, grad.db2);
        accum2D(accum.dW3, grad.dW3); accum1D(accum.db3, grad.db3);
      }
      // Average over batch.
      const inv = 1 / batch.length;
      scale2D(accum.dW1, inv); scale1D(accum.db1, inv);
      scale2D(accum.dW2, inv); scale1D(accum.db2, inv);
      scale2D(accum.dW3, inv); scale1D(accum.db3, inv);
      mlp.applyGrad(accum, lr);
    }

    // Eval (no dropout).
    let maeTrain = 0;
    for (const item of trainNorm) {
      const fwd = mlp.forward(item.x, false, rng);
      maeTrain += Math.abs(fwd.out - item.y);
    }
    maeTrain /= Math.max(1, trainNorm.length);
    let maeVal = 0;
    for (const item of valNorm) {
      const fwd = mlp.forward(item.x, false, rng);
      maeVal += Math.abs(fwd.out - item.y);
    }
    maeVal /= Math.max(1, valNorm.length);
    lastMaeTrain = maeTrain;
    lastMaeVal = maeVal;
    if (maeVal < bestMaeVal) {
      bestMaeVal = maeVal;
      bestEpoch = epoch;
    }
    if (epoch === 0 || epoch === epochs - 1 || epoch % 20 === 0) {
      console.log(`  epoch ${epoch.toString().padStart(3)}: maeTrain=${maeTrain.toFixed(2)} maeVal=${maeVal.toFixed(2)}  (best val so far: ${bestMaeVal.toFixed(2)})`);
    }
  }

  // Per-trajectory val predictions for diagnostic.
  const valByTraj = new Map<string, { preds: number[]; targets: number[] }>();
  for (const item of valNorm) {
    const fwd = mlp.forward(item.x, false, rng);
    const trajId = item.ref.trajectoryId;
    if (!valByTraj.has(trajId)) valByTraj.set(trajId, { preds: [], targets: [] });
    const e = valByTraj.get(trajId)!;
    e.preds.push(fwd.out + targetMean);
    e.targets.push(item.ref.target);
  }
  const predictionsVal = Array.from(valByTraj.entries()).map(([trajectoryId, e]) => ({
    trajectoryId,
    meanPred: e.preds.reduce((s, v) => s + v, 0) / e.preds.length,
    meanTarget: e.targets[0],
  }));

  return {
    seed,
    numTrajectories: split.trajIds.length,
    numTrainTrajs: split.trajIds.length - split.valTrajIds.length,
    numValTrajs: split.valTrajIds.length,
    numTrainSteps: trainData.length,
    numValSteps: valData.length,
    baselineMeanMaeTrain: baselineMaeTrain,
    baselineMeanMaeVal: baselineMaeVal,
    finalMaeTrain: lastMaeTrain,
    finalMaeVal: lastMaeVal,
    bestEpochVal: bestEpoch,
    bestMaeVal,
    valTrajIds: split.valTrajIds,
    predictionsVal,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function zeros2D(r: number, c: number): number[][] {
  return Array.from({ length: r }, () => new Array(c).fill(0));
}
function accum2D(target: number[][], src: number[][]): void {
  for (let i = 0; i < target.length; i++)
    for (let j = 0; j < target[0].length; j++)
      target[i][j] += src[i][j];
}
function accum1D(target: number[], src: number[]): void {
  for (let i = 0; i < target.length; i++) target[i] += src[i];
}
function scale2D(target: number[][], k: number): void {
  for (let i = 0; i < target.length; i++)
    for (let j = 0; j < target[0].length; j++)
      target[i][j] *= k;
}
function scale1D(target: number[], k: number): void {
  for (let i = 0; i < target.length; i++) target[i] *= k;
}

// =============================================================================
// Main
// =============================================================================

function main(): void {
  const corpusRoot = resolve('./data/value-head-pilot/corpus');
  const resultsDir = resolve('./data/value-head-pilot/results');
  if (!existsSync(corpusRoot)) {
    console.error(`[train] corpus dir not found: ${corpusRoot}`);
    process.exit(1);
  }
  mkdirSync(resultsDir, { recursive: true });

  console.log('=== V(s) PILOT TRAINING ===');
  console.log(`[train] loading corpus from ${corpusRoot}`);
  const points = loadCorpus(corpusRoot);
  console.log(`[train] loaded ${points.length} (state, V_target) pairs`);
  const trajectories = new Set(points.map(p => p.trajectoryId));
  console.log(`[train] across ${trajectories.size} distinct trajectories`);
  const targets = Array.from(new Set(points.map(p => Math.round(p.target))));
  console.log(`[train] V_target distinct values: ${targets.length}, range [${Math.min(...targets)}, ${Math.max(...targets)}]`);
  console.log('');

  const seeds = [7, 11, 42];
  const results: TrainResult[] = [];

  for (const seed of seeds) {
    console.log(`--- SEED ${seed} ---`);
    const r = train(points, seed);
    console.log(`  splits: ${r.numTrainTrajs} train trajs / ${r.numValTrajs} val trajs (${r.numTrainSteps} / ${r.numValSteps} steps)`);
    console.log(`  baseline mean-pred MAE: train=${r.baselineMeanMaeTrain.toFixed(2)} val=${r.baselineMeanMaeVal.toFixed(2)}`);
    console.log(`  final MLP MAE:          train=${r.finalMaeTrain.toFixed(2)} val=${r.finalMaeVal.toFixed(2)}`);
    console.log(`  best val MAE: ${r.bestMaeVal.toFixed(2)} at epoch ${r.bestEpochVal}`);
    console.log(`  val trajs: ${r.valTrajIds.join(', ')}`);
    console.log(`  per-traj val predictions:`);
    for (const p of r.predictionsVal) {
      const err = Math.abs(p.meanPred - p.meanTarget);
      console.log(`    ${p.trajectoryId}: pred=${p.meanPred.toFixed(1)} target=${p.meanTarget.toFixed(1)} err=${err.toFixed(1)}`);
    }
    results.push(r);
    console.log('');
  }

  // Aggregate across seeds.
  const medianMaeVal = median(results.map(r => r.bestMaeVal));
  const medianBaseline = median(results.map(r => r.baselineMeanMaeVal));
  const ratio = medianMaeVal / medianBaseline;

  console.log('=== AGGREGATE ===');
  console.log(`baseline (mean-pred) median val MAE: ${medianBaseline.toFixed(2)}`);
  console.log(`MLP best val MAE median:             ${medianMaeVal.toFixed(2)}`);
  console.log(`ratio (MLP / baseline): ${ratio.toFixed(3)}`);
  console.log('');

  let verdict: string;
  if (ratio < 0.7) {
    verdict = 'GO — MLP beats mean-prediction by >30%, value head signal is real';
  } else if (ratio < 1.0) {
    verdict = 'MARGINAL — MLP marginally beats mean-prediction, corpus or features may need enrichment';
  } else {
    verdict = 'NULL — MLP does not beat mean-prediction; value head with this corpus + features fails';
  }
  console.log(`VERDICT: ${verdict}`);

  const summary = {
    seeds,
    numTrajectories: results[0].numTrajectories,
    medianBaselineMaeVal: medianBaseline,
    medianBestMaeVal: medianMaeVal,
    ratio,
    verdict,
    perSeed: results,
  };
  const outPath = join(resultsDir, 'summary.json');
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  console.log(`\n[train] wrote ${outPath}`);
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

main();
