// =============================================================================
// train-verb-policy.ts — Phase 3 Stage 3a (Phase 4 policy MVP).
//
// Trains a logistic regression verb-class policy on the JSONL corpus produced
// by `scripts/extract-policy-training-data.ts`. Class-weighted cross-entropy +
// L2 weight decay. Stratified k-fold cross-validation reports honest accuracy.
//
// Output:
//   <out-dir>/verb-policy-v1.json    — weights file consumed by VerbPolicy
//   <out-dir>/cv-report.json         — per-fold + per-class metrics
//
// Hard constraints:
// - State vector is already in [0,1] from the extractor (clamp01 applied) —
//   no additional standardization. Runtime feeds raw extractor output.
// - Deterministic seed-driven RNG for fold splits + weight init.
// - featureSpecHash baked in via VerbPolicyWeights → loader hard-fails on drift.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/train-verb-policy.ts \
//     --in=data/policy-training/v1 \
//     --out=data/policy-weights/v1 \
//     --seed=42 --epochs=500 --lr=0.1 --l2=0.01 --folds=5
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STATE_DIM, computeFeatureSpecHash } from '../src/solver/state-feature-extractor.js';
import type { VerbPolicyWeights } from '../src/solver/verb-policy.js';

// -----------------------------------------------------------------------------
// CLI args
// -----------------------------------------------------------------------------

interface Args {
  inDir: string;
  outDir: string;
  seed: number;
  epochs: number;
  lr: number;
  l2: number;
  folds: number;
}

function parseArgs(): Args {
  const pick = (n: string): string | undefined => {
    const a = process.argv.find(x => x.startsWith(`--${n}=`));
    return a?.slice(n.length + 3);
  };
  const num = (v: string | undefined, d: number): number => {
    if (!v) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`[train-verb-policy] bad number: ${v}`);
    return n;
  };
  const inDir = pick('in');
  const outDir = pick('out');
  if (!inDir || !outDir) {
    console.error('Usage: --in=<training-dir> --out=<weights-dir> [--seed=42] [--epochs=500] [--lr=0.1] [--l2=0.01] [--folds=5]');
    process.exit(2);
  }
  return {
    inDir,
    outDir,
    seed: num(pick('seed'), 42),
    epochs: Math.floor(num(pick('epochs'), 500)),
    lr: num(pick('lr'), 0.1),
    l2: num(pick('l2'), 0.01),
    folds: Math.floor(num(pick('folds'), 5)),
  };
}

// -----------------------------------------------------------------------------
// Data shapes
// -----------------------------------------------------------------------------

interface TrainingSample {
  fixtureId: string;
  step: number;
  stateVec: number[];
  labelIdx: number;
  labelName: string;
}

interface Manifest {
  schemaVersion: number;
  featureSpecHash: string;
  stateFeatureNames: readonly string[];
  stateDim: number;
  labelClasses: string[];
  perClass: Record<string, number>;
  classWeights: Record<string, number>;
  perFixture: Record<string, number>;
  totalSamples: number;
}

// -----------------------------------------------------------------------------
// Deterministic RNG (mulberry32)
// -----------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -----------------------------------------------------------------------------
// Stratified k-fold
// -----------------------------------------------------------------------------

/** Returns an array of fold assignments (length = n samples), with foldIdx
 *  in [0, k). Stratified by labelIdx — each class is shuffled independently
 *  and round-robin-distributed across folds, so each fold's class counts
 *  are within ±1 of `n_c / k`. */
function stratifiedKFold(
  labels: number[],
  k: number,
  rand: () => number,
): number[] {
  const byClass = new Map<number, number[]>();
  labels.forEach((y, idx) => {
    if (!byClass.has(y)) byClass.set(y, []);
    byClass.get(y)!.push(idx);
  });
  const fold = new Array<number>(labels.length).fill(-1);
  for (const indices of byClass.values()) {
    // Fisher-Yates shuffle with deterministic RNG.
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    indices.forEach((sampleIdx, k_within) => {
      fold[sampleIdx] = k_within % k;
    });
  }
  return fold;
}

// -----------------------------------------------------------------------------
// Logistic regression with class-weighted CE + L2
// -----------------------------------------------------------------------------

interface TrainedLR {
  W: number[][];   // [K × stateDim]
  b: number[];     // [K]
  finalLoss: number;
  epochs: number;
}

/** Full-batch gradient descent with momentum + L2. With n=35 samples and a
 *  convex loss, this converges in ~100-300 epochs. */
function trainLR(
  X: number[][],
  Y: number[],
  K: number,
  classWeights: number[],
  args: { epochs: number; lr: number; l2: number; seed: number },
): TrainedLR {
  const D = STATE_DIM;
  const n = X.length;
  const rand = mulberry32(args.seed);

  // Init: small random weights, zero biases.
  const W: number[][] = [];
  const b: number[] = [];
  for (let c = 0; c < K; c++) {
    const row: number[] = [];
    for (let i = 0; i < D; i++) row.push((rand() - 0.5) * 0.02);
    W.push(row);
    b.push(0);
  }

  // Momentum buffers.
  const Wv: number[][] = W.map(r => r.map(() => 0));
  const bv: number[] = b.map(() => 0);
  const momentum = 0.9;

  let prevLoss = Infinity;
  let finalLoss = 0;
  let actualEpochs = 0;

  for (let epoch = 0; epoch < args.epochs; epoch++) {
    // Forward pass + accumulate gradients.
    const gradW: number[][] = W.map(r => r.map(() => 0));
    const gradB: number[] = b.map(() => 0);
    let totalLoss = 0;

    for (let s = 0; s < n; s++) {
      const x = X[s];
      const y = Y[s];
      const w_y = classWeights[y];

      // logits[c] = b[c] + W[c]·x
      const logits = new Array<number>(K);
      let maxLogit = -Infinity;
      for (let c = 0; c < K; c++) {
        let z = b[c];
        const row = W[c];
        for (let i = 0; i < D; i++) z += row[i] * x[i];
        logits[c] = z;
        if (z > maxLogit) maxLogit = z;
      }
      // Stable softmax.
      let denom = 0;
      const probs = new Array<number>(K);
      for (let c = 0; c < K; c++) {
        const e = Math.exp(logits[c] - maxLogit);
        probs[c] = e;
        denom += e;
      }
      for (let c = 0; c < K; c++) probs[c] /= denom;

      // Loss: -w_y × log p[y]
      totalLoss += -w_y * Math.log(Math.max(probs[y], 1e-12));

      // Gradient: w_y × (p[c] - 1[c=y])
      for (let c = 0; c < K; c++) {
        const g = w_y * (probs[c] - (c === y ? 1 : 0));
        gradB[c] += g;
        const row = gradW[c];
        for (let i = 0; i < D; i++) row[i] += g * x[i];
      }
    }

    // Average + add L2 (L2 not divided by n; standard convention).
    for (let c = 0; c < K; c++) {
      gradB[c] /= n;
      const row = gradW[c];
      const Wrow = W[c];
      for (let i = 0; i < D; i++) {
        row[i] = row[i] / n + args.l2 * Wrow[i];
      }
    }
    const avgLoss = totalLoss / n;

    // Update with momentum.
    for (let c = 0; c < K; c++) {
      bv[c] = momentum * bv[c] - args.lr * gradB[c];
      b[c] += bv[c];
      const Wrow = W[c];
      const Wvrow = Wv[c];
      const grow = gradW[c];
      for (let i = 0; i < D; i++) {
        Wvrow[i] = momentum * Wvrow[i] - args.lr * grow[i];
        Wrow[i] += Wvrow[i];
      }
    }

    finalLoss = avgLoss;
    actualEpochs = epoch + 1;
    // Convergence check: relative loss delta < 1e-6.
    if (Math.abs(prevLoss - avgLoss) < 1e-7 && epoch >= 50) break;
    prevLoss = avgLoss;
  }

  return { W, b, finalLoss, epochs: actualEpochs };
}

function predictLabel(W: number[][], b: number[], x: number[]): number {
  let bestC = 0;
  let bestZ = -Infinity;
  const D = STATE_DIM;
  for (let c = 0; c < W.length; c++) {
    let z = b[c];
    const row = W[c];
    for (let i = 0; i < D; i++) z += row[i] * x[i];
    if (z > bestZ) { bestZ = z; bestC = c; }
  }
  return bestC;
}

/** Returns softmax probabilities + sorted-desc class indices. Used for top-K
 *  accuracy + true-label log-probability metrics (more relevant for ranker
 *  bias than argmax accuracy when the policy is used as a soft prior). */
function predictProbs(W: number[][], b: number[], x: number[]): { probs: number[]; rank: number[] } {
  const K = W.length;
  const D = STATE_DIM;
  const logits = new Array<number>(K);
  let maxLogit = -Infinity;
  for (let c = 0; c < K; c++) {
    let z = b[c];
    const row = W[c];
    for (let i = 0; i < D; i++) z += row[i] * x[i];
    logits[c] = z;
    if (z > maxLogit) maxLogit = z;
  }
  let denom = 0;
  const probs = new Array<number>(K);
  for (let c = 0; c < K; c++) {
    const e = Math.exp(logits[c] - maxLogit);
    probs[c] = e;
    denom += e;
  }
  for (let c = 0; c < K; c++) probs[c] /= denom;
  const rank = probs.map((_, i) => i).sort((a, b) => probs[b] - probs[a]);
  return { probs, rank };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  const inAbs = resolve(args.inDir);
  const outAbs = resolve(args.outDir);

  const manifest: Manifest = JSON.parse(
    readFileSync(join(inAbs, 'manifest.json'), 'utf-8'),
  );
  const lines = readFileSync(join(inAbs, 'training.jsonl'), 'utf-8')
    .trim().split('\n').filter(l => l.length > 0);
  const samples: TrainingSample[] = lines.map(l => JSON.parse(l));

  // Sanity guards.
  if (manifest.featureSpecHash !== computeFeatureSpecHash()) {
    throw new Error(
      `[train-verb-policy] manifest featureSpecHash ${manifest.featureSpecHash} ` +
      `!= current ${computeFeatureSpecHash()}. Re-run extractor.`,
    );
  }
  if (manifest.stateDim !== STATE_DIM) {
    throw new Error(`[train-verb-policy] stateDim mismatch: ${manifest.stateDim} != ${STATE_DIM}`);
  }
  if (samples.length !== manifest.totalSamples) {
    throw new Error(`[train-verb-policy] sample count mismatch: ${samples.length} != ${manifest.totalSamples}`);
  }

  const X = samples.map(s => s.stateVec);
  const Y = samples.map(s => s.labelIdx);
  const K = manifest.labelClasses.length;
  const classWeightVec = manifest.labelClasses.map(c => manifest.classWeights[c]);

  console.log(`Training samples: ${samples.length}, classes: ${K}, dim: ${STATE_DIM}`);
  console.log(`Class distribution: ${JSON.stringify(manifest.perClass)}`);
  console.log(`Class weights: ${JSON.stringify(classWeightVec.map(v => Number(v.toFixed(3))))}`);
  console.log(`Hyperparams: seed=${args.seed} epochs=${args.epochs} lr=${args.lr} l2=${args.l2} folds=${args.folds}`);

  // Majority-class baseline.
  const majorityName = Object.entries(manifest.perClass).reduce(
    (a, b) => b[1] > a[1] ? b : a,
  )[0];
  const majorityClassIdx = manifest.labelClasses.indexOf(majorityName);
  const majorityAcc = Y.filter(y => y === majorityClassIdx).length / Y.length;
  console.log(`Majority-class baseline: ${majorityName} (acc=${(majorityAcc * 100).toFixed(1)}%)`);

  // -------------------------------------------------------------------------
  // Cross-validation
  // -------------------------------------------------------------------------

  const rand = mulberry32(args.seed);
  const fold = stratifiedKFold(Y, args.folds, rand);

  let cvCorrect = 0;
  let cvTop2Correct = 0;
  let cvTotal = 0;
  let cvTrueLabelLogProbSum = 0;
  let cvTrueLabelProbSum = 0;
  const perFoldAcc: number[] = [];
  const confusionMatrix: number[][] = Array.from({ length: K }, () => Array(K).fill(0));

  for (let f = 0; f < args.folds; f++) {
    const trainX: number[][] = [];
    const trainY: number[] = [];
    const valX: number[][] = [];
    const valY: number[] = [];
    for (let s = 0; s < X.length; s++) {
      if (fold[s] === f) {
        valX.push(X[s]); valY.push(Y[s]);
      } else {
        trainX.push(X[s]); trainY.push(Y[s]);
      }
    }
    const model = trainLR(trainX, trainY, K, classWeightVec, {
      epochs: args.epochs,
      lr: args.lr,
      l2: args.l2,
      seed: args.seed + f * 1000,
    });
    let foldCorrect = 0;
    let foldTop2 = 0;
    for (let s = 0; s < valX.length; s++) {
      const { probs, rank } = predictProbs(model.W, model.b, valX[s]);
      const trueY = valY[s];
      const pred = rank[0];
      confusionMatrix[trueY][pred]++;
      if (pred === trueY) foldCorrect++;
      // Top-2 hit if true label is in top-2 ranks (only meaningful when K ≥ 3).
      if (K >= 2 && (rank[0] === trueY || rank[1] === trueY)) foldTop2++;
      cvTrueLabelProbSum += probs[trueY];
      cvTrueLabelLogProbSum += Math.log(Math.max(probs[trueY], 1e-12));
    }
    const acc = valX.length > 0 ? foldCorrect / valX.length : 0;
    perFoldAcc.push(acc);
    cvCorrect += foldCorrect;
    cvTop2Correct += foldTop2;
    cvTotal += valX.length;
    if (valX.length > 0) {
      console.log(`Fold ${f}: top1=${foldCorrect}/${valX.length} (${(acc * 100).toFixed(1)}%) top2=${foldTop2}/${valX.length} ` +
        `[trained ${model.epochs} epochs, loss=${model.finalLoss.toFixed(4)}]`);
    }
  }

  const cvMean = cvTotal > 0 ? cvCorrect / cvTotal : 0;
  const cvTop2 = cvTotal > 0 ? cvTop2Correct / cvTotal : 0;
  const cvMeanTrueProb = cvTotal > 0 ? cvTrueLabelProbSum / cvTotal : 0;
  const cvMeanTrueLogProb = cvTotal > 0 ? cvTrueLabelLogProbSum / cvTotal : 0;
  const cvStd = (() => {
    if (perFoldAcc.length === 0) return 0;
    const mean = perFoldAcc.reduce((a, b) => a + b, 0) / perFoldAcc.length;
    const v = perFoldAcc.reduce((a, b) => a + (b - mean) ** 2, 0) / perFoldAcc.length;
    return Math.sqrt(v);
  })();
  // Reference points for "is the policy useful as a soft prior":
  //  - Uniform over K classes: true_label_prob = 1/K, true_label_logprob = -log(K)
  //  - Class-prior-weighted (use empirical class freq as policy): cf manifest
  const uniformProb = 1 / K;
  const uniformLogProb = -Math.log(K);
  const priorTrueLabelProbSum = Y.reduce((acc, y) => {
    const cName = manifest.labelClasses[y];
    return acc + (manifest.perClass[cName] / X.length);
  }, 0);
  const priorTrueLabelProbMean = priorTrueLabelProbSum / Y.length;
  console.log(`\n=== CV Summary ===`);
  console.log(`Top-1 accuracy:        ${(cvMean * 100).toFixed(1)}% ± ${(cvStd * 100).toFixed(1)}%   (majority baseline ${(majorityAcc * 100).toFixed(1)}%)`);
  console.log(`Top-2 accuracy:        ${(cvTop2 * 100).toFixed(1)}%   (uniform 2-of-${K} = ${(2 / K * 100).toFixed(1)}%)`);
  console.log(`Mean P(true label):    ${cvMeanTrueProb.toFixed(3)}    (uniform=${uniformProb.toFixed(3)}, class prior=${priorTrueLabelProbMean.toFixed(3)})`);
  console.log(`Mean log P(true):      ${cvMeanTrueLogProb.toFixed(3)}   (uniform=${uniformLogProb.toFixed(3)})`);

  // Per-class CV report (precision/recall computed from confusion matrix).
  const perClassReport: Record<string, { support: number; precision: number; recall: number }> = {};
  for (let c = 0; c < K; c++) {
    const support = confusionMatrix[c].reduce((a, b) => a + b, 0);
    const truePositive = confusionMatrix[c][c];
    let predictedAsC = 0;
    for (let r = 0; r < K; r++) predictedAsC += confusionMatrix[r][c];
    const precision = predictedAsC > 0 ? truePositive / predictedAsC : 0;
    const recall = support > 0 ? truePositive / support : 0;
    perClassReport[manifest.labelClasses[c]] = { support, precision, recall };
  }
  console.log('\nPer-class CV metrics:');
  for (const [c, m] of Object.entries(perClassReport)) {
    console.log(`  ${c.padEnd(20)} support=${m.support}  precision=${(m.precision * 100).toFixed(1)}%  recall=${(m.recall * 100).toFixed(1)}%`);
  }

  // -------------------------------------------------------------------------
  // Refit on all samples
  // -------------------------------------------------------------------------

  console.log('\nRefitting on all samples...');
  const finalModel = trainLR(X, Y, K, classWeightVec, {
    epochs: args.epochs,
    lr: args.lr,
    l2: args.l2,
    seed: args.seed,
  });
  console.log(`Final model: ${finalModel.epochs} epochs, loss=${finalModel.finalLoss.toFixed(4)}`);

  // -------------------------------------------------------------------------
  // Write outputs
  // -------------------------------------------------------------------------

  const weights: VerbPolicyWeights = {
    version: 'verb-policy-v1',
    arch: 'lr',
    featureSpecHash: computeFeatureSpecHash(),
    stateDim: STATE_DIM,
    labelClasses: manifest.labelClasses,
    params: { W: finalModel.W, b: finalModel.b },
    metadata: {
      trainedAt: new Date().toISOString(),
      trainingSamples: X.length,
      perClassTrainingCounts: manifest.perClass,
      cvMeanAccuracy: cvMean,
      cvFolds: args.folds,
      notes: `LR baseline. seed=${args.seed} epochs=${args.epochs} lr=${args.lr} l2=${args.l2}.`,
    },
  };

  mkdirSync(outAbs, { recursive: true });
  const weightsPath = join(outAbs, 'verb-policy-v1.json');
  writeFileSync(weightsPath, JSON.stringify(weights, null, 2) + '\n', 'utf-8');

  const cvReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seed: args.seed,
    folds: args.folds,
    epochs: args.epochs,
    lr: args.lr,
    l2: args.l2,
    cvMeanAccuracy: cvMean,
    cvStdAccuracy: cvStd,
    cvTop2Accuracy: cvTop2,
    cvMeanTrueLabelProb: cvMeanTrueProb,
    cvMeanTrueLabelLogProb: cvMeanTrueLogProb,
    perFoldAccuracy: perFoldAcc,
    majorityClassAccuracy: majorityAcc,
    confusionMatrix,
    confusionMatrixLabels: manifest.labelClasses,
    perClassReport,
  };
  const cvPath = join(outAbs, 'cv-report.json');
  writeFileSync(cvPath, JSON.stringify(cvReport, null, 2) + '\n', 'utf-8');

  console.log(`\nWrote ${weightsPath}`);
  console.log(`Wrote ${cvPath}`);
}

main();
