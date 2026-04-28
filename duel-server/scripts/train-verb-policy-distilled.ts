// =============================================================================
// train-verb-policy-distilled.ts — Phase 3 Architecture C / Phase 2.
//
// Trains a logistic regression verb-class policy on LLM-distilled SOFT
// targets produced by `scripts/hydrate-llm-annotations.ts`. Diverges from
// `train-verb-policy.ts` in two ways:
//
//   1. Loss is KL-divergence to a soft target distribution per sample:
//        sample_loss = sampleWeight * sum_c -target[c] * log(softmax(logits)[c])
//      where sampleWeight = classWeight[gtVerb] * confWeight
//      (entropy term H(target) is constant w.r.t. weights → dropped).
//
//   2. Cross-validation defaults to LEAVE-ONE-FIXTURE-OUT (LOFO) — each
//      fixture is held out as the validation fold once. Fixture-level
//      generalization is the relevant gate at n≈17.
//
// Diagnostics (per-fold + cumulative):
//   - mean P(gtVerb)         — apples-to-apples vs v2 (target gate: > 0.314)
//   - mean P(llmTopVerb)     — distillation fit on the LLM signal
//   - mean KL(target, predict)
//   - per-fixture P(gtVerb)
//
// Outputs:
//   <out-dir>/verb-policy-v1.json   weights drop-in compatible with
//                                   PolicyGuidedRanker (same labelClasses,
//                                   same featureSpecHash, version='verb-policy-v1')
//   <out-dir>/cv-report.json        per-fold + cumulative metrics
//
// Usage:
//   cd duel-server
//   npx tsx scripts/train-verb-policy-distilled.ts \
//     --in=data/policy-training/llm-distilled-v1 \
//     --out=data/policy-weights/llm-distilled-v1 \
//     --seed=42 --epochs=2000 --lr=0.05 --l2=0.001 --cv=lofo
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STATE_DIM, computeFeatureSpecHash } from '../src/solver/state-feature-extractor.js';
import type { VerbPolicyWeights } from '../src/solver/verb-policy.js';

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

interface Args {
  inDir: string;
  outDir: string;
  seed: number;
  epochs: number;
  lr: number;
  l2: number;
  cv: 'lofo' | 'kfold';
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
    if (!Number.isFinite(n)) throw new Error(`[train-distilled] bad number: ${v}`);
    return n;
  };
  const inDir = pick('in');
  const outDir = pick('out');
  if (!inDir || !outDir) {
    console.error('Usage: --in=<training-dir> --out=<weights-dir> [--seed=42] [--epochs=2000] [--lr=0.05] [--l2=0.001] [--cv=lofo|kfold] [--folds=5]');
    process.exit(2);
  }
  const cvStr = pick('cv') ?? 'lofo';
  if (cvStr !== 'lofo' && cvStr !== 'kfold') {
    throw new Error(`[train-distilled] --cv must be lofo or kfold, got '${cvStr}'`);
  }
  return {
    inDir,
    outDir,
    seed: num(pick('seed'), 42),
    epochs: Math.floor(num(pick('epochs'), 2000)),
    lr: num(pick('lr'), 0.05),
    l2: num(pick('l2'), 0.001),
    cv: cvStr,
    folds: Math.floor(num(pick('folds'), 5)),
  };
}

// -----------------------------------------------------------------------------
// Data shapes
// -----------------------------------------------------------------------------

interface HydratedSample {
  fixtureId: string;
  seed: string;
  step: number;
  promptType: 'SELECT_IDLECMD';
  stateVec: number[];
  targetVerbDist: number[];
  confWeight: number;
  gtVerb: string | null;
  llmTopVerb: string | null;
  legalCount: number;
  legalWithKnownVerb: number;
}

interface HydrationManifest {
  schemaVersion: number;
  featureSpecHash: string;
  stateDim: number;
  labelClasses: string[];
  tau: number;
  totalSamples: number;
  classWeights: Record<string, number>;
  perFixture: Record<string, number>;
}

// -----------------------------------------------------------------------------
// Deterministic RNG
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
// Soft-target LR with class+confidence weighting
// -----------------------------------------------------------------------------

interface TrainedLR {
  W: number[][];
  b: number[];
  finalLoss: number;
  epochs: number;
}

function softmax(logits: number[]): number[] {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  let denom = 0;
  const probs = new Array<number>(logits.length);
  for (let c = 0; c < logits.length; c++) {
    probs[c] = Math.exp(logits[c] - max);
    denom += probs[c];
  }
  if (denom === 0) {
    const u = 1 / logits.length;
    return probs.map(() => u);
  }
  for (let c = 0; c < logits.length; c++) probs[c] /= denom;
  return probs;
}

function trainLR(
  X: number[][],
  Y: number[][],
  sampleWeight: number[],
  K: number,
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
  const Wv: number[][] = W.map(r => r.map(() => 0));
  const bv: number[] = b.map(() => 0);
  const momentum = 0.9;

  let prevLoss = Infinity;
  let finalLoss = 0;
  let actualEpochs = 0;

  for (let epoch = 0; epoch < args.epochs; epoch++) {
    const gradW: number[][] = W.map(r => r.map(() => 0));
    const gradB: number[] = b.map(() => 0);
    let totalLoss = 0;
    let totalWeight = 0;

    for (let s = 0; s < n; s++) {
      const x = X[s];
      const t = Y[s];
      const sw = sampleWeight[s];
      totalWeight += sw;

      // logits[c] = b[c] + W[c]·x
      const logits = new Array<number>(K);
      for (let c = 0; c < K; c++) {
        let z = b[c];
        const row = W[c];
        for (let i = 0; i < D; i++) z += row[i] * x[i];
        logits[c] = z;
      }
      const probs = softmax(logits);

      // KL(target || predict) = sum_c target[c] * (log target[c] - log probs[c])
      // We minimize cross-entropy: -sum_c target[c] * log probs[c]  (entropy is const).
      let xent = 0;
      for (let c = 0; c < K; c++) {
        if (t[c] > 0) xent += -t[c] * Math.log(Math.max(probs[c], 1e-12));
      }
      totalLoss += sw * xent;

      // Gradient of -sum_c target[c] * log softmax(logit)[c] w.r.t. logit[k]
      //   = (probs[k] * sum_c target[c]) - target[k]   (when sum target = 1)
      //   = probs[k] - target[k]
      // (sample-weighted)
      for (let c = 0; c < K; c++) {
        const g = sw * (probs[c] - t[c]);
        gradB[c] += g;
        const row = gradW[c];
        for (let i = 0; i < D; i++) row[i] += g * x[i];
      }
    }

    // Average over weighted sample mass + L2.
    const denom = Math.max(totalWeight, 1e-12);
    for (let c = 0; c < K; c++) {
      gradB[c] /= denom;
      const row = gradW[c];
      const Wrow = W[c];
      for (let i = 0; i < D; i++) {
        row[i] = row[i] / denom + args.l2 * Wrow[i];
      }
    }
    const avgLoss = totalLoss / denom;

    // Momentum update.
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
    if (Math.abs(prevLoss - avgLoss) < 1e-7 && epoch >= 100) break;
    prevLoss = avgLoss;
  }

  return { W, b, finalLoss, epochs: actualEpochs };
}

function predictProbs(W: number[][], b: number[], x: number[]): number[] {
  const K = W.length;
  const D = STATE_DIM;
  const logits = new Array<number>(K);
  for (let c = 0; c < K; c++) {
    let z = b[c];
    const row = W[c];
    for (let i = 0; i < D; i++) z += row[i] * x[i];
    logits[c] = z;
  }
  return softmax(logits);
}

// -----------------------------------------------------------------------------
// Fold builders
// -----------------------------------------------------------------------------

function buildLofoFolds(samples: HydratedSample[]): { fold: number[]; foldNames: string[] } {
  const fixtures = [...new Set(samples.map(s => s.fixtureId))].sort();
  const fixtureToIdx = new Map(fixtures.map((f, i) => [f, i]));
  const fold = samples.map(s => fixtureToIdx.get(s.fixtureId)!);
  return { fold, foldNames: fixtures };
}

function buildKFolds(samples: HydratedSample[], k: number, rand: () => number): { fold: number[]; foldNames: string[] } {
  const indices = samples.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const fold = new Array<number>(samples.length).fill(-1);
  indices.forEach((idx, pos) => {
    fold[idx] = pos % k;
  });
  return { fold, foldNames: Array.from({ length: k }, (_, i) => `fold${i}`) };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  const inAbs = resolve(args.inDir);
  const outAbs = resolve(args.outDir);

  const manifest: HydrationManifest = JSON.parse(
    readFileSync(join(inAbs, 'manifest.json'), 'utf-8'),
  );
  const lines = readFileSync(join(inAbs, 'training.jsonl'), 'utf-8')
    .trim().split('\n').filter(l => l.length > 0);
  const samples: HydratedSample[] = lines.map(l => JSON.parse(l));

  if (manifest.featureSpecHash !== computeFeatureSpecHash()) {
    throw new Error(
      `[train-distilled] manifest featureSpecHash ${manifest.featureSpecHash} ` +
      `!= current ${computeFeatureSpecHash()}. Re-run hydrate.`,
    );
  }
  if (manifest.stateDim !== STATE_DIM) {
    throw new Error(`[train-distilled] stateDim mismatch: ${manifest.stateDim} != ${STATE_DIM}`);
  }
  if (samples.length !== manifest.totalSamples) {
    throw new Error(`[train-distilled] sample count mismatch: ${samples.length} != ${manifest.totalSamples}`);
  }

  const labelClasses = manifest.labelClasses;
  const K = labelClasses.length;
  const labelToIdx = new Map(labelClasses.map((c, i) => [c, i]));

  // Build per-sample weights: classWeight[gtVerb] * confWeight.
  // If gtVerb is null or unknown, use weight 1.0 (no class re-balancing).
  const sampleWeight = samples.map(s => {
    const cw = (s.gtVerb && manifest.classWeights[s.gtVerb]) ? manifest.classWeights[s.gtVerb] : 1.0;
    return cw * s.confWeight;
  });

  console.log(`[train-distilled] samples=${samples.length} classes=${K} dim=${STATE_DIM}`);
  console.log(`[train-distilled] perFixture: ${JSON.stringify(manifest.perFixture)}`);
  console.log(`[train-distilled] hyperparams: seed=${args.seed} epochs=${args.epochs} lr=${args.lr} l2=${args.l2} cv=${args.cv}`);

  // ------------ Cross-validation ------------------------------------------------

  const X = samples.map(s => s.stateVec);
  const Y = samples.map(s => s.targetVerbDist);
  const rand = mulberry32(args.seed);

  const { fold, foldNames } = args.cv === 'lofo'
    ? buildLofoFolds(samples)
    : buildKFolds(samples, args.folds, rand);
  const numFolds = foldNames.length;

  let cvGtProbSum = 0;
  let cvLlmProbSum = 0;
  let cvKLSum = 0;
  let cvGtCount = 0;
  let cvLlmCount = 0;
  let cvSampleCount = 0;
  const perFoldReport: Array<{
    foldName: string;
    valSize: number;
    meanGtProb: number | null;
    meanLlmProb: number | null;
    meanKL: number;
    epochs: number;
    finalLoss: number;
  }> = [];

  for (let f = 0; f < numFolds; f++) {
    const trainX: number[][] = [];
    const trainY: number[][] = [];
    const trainW: number[] = [];
    const valIdx: number[] = [];
    for (let s = 0; s < samples.length; s++) {
      if (fold[s] === f) {
        valIdx.push(s);
      } else {
        trainX.push(X[s]); trainY.push(Y[s]); trainW.push(sampleWeight[s]);
      }
    }
    if (trainX.length === 0) {
      console.warn(`[train-distilled] fold ${foldNames[f]}: empty training set, skipping`);
      perFoldReport.push({ foldName: foldNames[f], valSize: valIdx.length, meanGtProb: null, meanLlmProb: null, meanKL: 0, epochs: 0, finalLoss: 0 });
      continue;
    }
    const model = trainLR(trainX, trainY, trainW, K, {
      epochs: args.epochs,
      lr: args.lr,
      l2: args.l2,
      seed: args.seed + f * 1000,
    });

    let gtProbSum = 0;
    let llmProbSum = 0;
    let klSum = 0;
    let gtCount = 0;
    let llmCount = 0;
    for (const s of valIdx) {
      const probs = predictProbs(model.W, model.b, X[s]);
      const target = Y[s];
      // KL(target || predict)
      let kl = 0;
      for (let c = 0; c < K; c++) {
        if (target[c] > 0) {
          kl += target[c] * (Math.log(target[c]) - Math.log(Math.max(probs[c], 1e-12)));
        }
      }
      klSum += kl;
      cvKLSum += kl;

      const sample = samples[s];
      if (sample.gtVerb) {
        const idx = labelToIdx.get(sample.gtVerb);
        if (idx !== undefined) {
          gtProbSum += probs[idx];
          cvGtProbSum += probs[idx];
          gtCount++;
          cvGtCount++;
        }
      }
      if (sample.llmTopVerb) {
        const idx = labelToIdx.get(sample.llmTopVerb);
        if (idx !== undefined) {
          llmProbSum += probs[idx];
          cvLlmProbSum += probs[idx];
          llmCount++;
          cvLlmCount++;
        }
      }
    }
    cvSampleCount += valIdx.length;

    const meanGtProb = gtCount > 0 ? gtProbSum / gtCount : null;
    const meanLlmProb = llmCount > 0 ? llmProbSum / llmCount : null;
    const meanKL = valIdx.length > 0 ? klSum / valIdx.length : 0;
    perFoldReport.push({
      foldName: foldNames[f],
      valSize: valIdx.length,
      meanGtProb,
      meanLlmProb,
      meanKL,
      epochs: model.epochs,
      finalLoss: model.finalLoss,
    });
    console.log(
      `Fold ${foldNames[f].padEnd(28)} val=${String(valIdx.length).padStart(2)} ` +
      `P(gtVerb)=${meanGtProb !== null ? meanGtProb.toFixed(3) : ' n/a '}  ` +
      `P(llmTop)=${meanLlmProb !== null ? meanLlmProb.toFixed(3) : ' n/a '}  ` +
      `KL=${meanKL.toFixed(3)}  ` +
      `[${model.epochs}ep loss=${model.finalLoss.toFixed(4)}]`,
    );
  }

  const cvMeanGtProb = cvGtCount > 0 ? cvGtProbSum / cvGtCount : 0;
  const cvMeanLlmProb = cvLlmCount > 0 ? cvLlmProbSum / cvLlmCount : 0;
  const cvMeanKL = cvSampleCount > 0 ? cvKLSum / cvSampleCount : 0;

  console.log(`\n=== CV Summary (${args.cv}, ${numFolds} folds, n=${samples.length}) ===`);
  console.log(`Mean P(gtVerb)         : ${cvMeanGtProb.toFixed(3)}    (v2 baseline = 0.314, v2 class-prior = 0.278)`);
  console.log(`Mean P(llmTopVerb)     : ${cvMeanLlmProb.toFixed(3)}    (distillation-fit metric)`);
  console.log(`Mean KL(target||predict): ${cvMeanKL.toFixed(3)}    (lower is better)`);
  console.log(`Gate (P(gtVerb) > 0.314): ${cvMeanGtProb > 0.314 ? 'PASS' : 'FAIL'}`);

  // ------------ Refit on all + write weights ------------------------------------

  console.log('\nRefitting on all samples...');
  const finalModel = trainLR(X, Y, sampleWeight, K, {
    epochs: args.epochs,
    lr: args.lr,
    l2: args.l2,
    seed: args.seed,
  });
  console.log(`Final model: ${finalModel.epochs} epochs, loss=${finalModel.finalLoss.toFixed(4)}`);

  const weights: VerbPolicyWeights = {
    version: 'verb-policy-v1',
    arch: 'lr',
    featureSpecHash: computeFeatureSpecHash(),
    stateDim: STATE_DIM,
    labelClasses,
    params: { W: finalModel.W, b: finalModel.b },
    metadata: {
      trainedAt: new Date().toISOString(),
      trainingSamples: samples.length,
      perClassTrainingCounts: manifest.perFixture as unknown as Record<string, number>,
      cvMeanAccuracy: cvMeanGtProb,
      cvFolds: numFolds,
      notes:
        `LLM-distilled KL-loss LR. tau=${manifest.tau} ` +
        `seed=${args.seed} epochs=${args.epochs} lr=${args.lr} l2=${args.l2} cv=${args.cv}. ` +
        `cv P(gtVerb)=${cvMeanGtProb.toFixed(3)} P(llmTop)=${cvMeanLlmProb.toFixed(3)} KL=${cvMeanKL.toFixed(3)}.`,
    },
  };

  mkdirSync(outAbs, { recursive: true });
  const weightsPath = join(outAbs, 'verb-policy-v1.json');
  writeFileSync(weightsPath, JSON.stringify(weights, null, 2) + '\n', 'utf-8');

  const cvReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    cvScheme: args.cv,
    seed: args.seed,
    epochs: args.epochs,
    lr: args.lr,
    l2: args.l2,
    tau: manifest.tau,
    samples: samples.length,
    cvMeanGtProb,
    cvMeanLlmProb,
    cvMeanKL,
    gateGtProbV2: 0.314,
    gateGtProbPass: cvMeanGtProb > 0.314,
    perFold: perFoldReport,
  };
  const cvPath = join(outAbs, 'cv-report.json');
  writeFileSync(cvPath, JSON.stringify(cvReport, null, 2) + '\n', 'utf-8');

  console.log(`\nWrote ${weightsPath}`);
  console.log(`Wrote ${cvPath}`);
}

main();
