// =============================================================================
// evaluate-verb-policy.ts — Phase 3 Stage 3a (Phase 4 policy MVP).
//
// Standalone evaluator for a trained verb-policy on a trajectory corpus.
// Loads weights, predicts on every SELECT_IDLECMD step, prints confusion
// matrix + per-class precision/recall + top-1/top-2 accuracy + log-prob.
//
// Use cases:
//   1. Sanity check: evaluate v1 weights on the training corpus they were
//      trained on (top-1 should be high → training-set memorization audit).
//   2. Future: evaluate v1 weights on an augmented (multi-seed) corpus to
//      measure generalization without retraining.
//   3. Re-evaluate after retraining without rerunning the full trainer.
//
// Output: stdout report; optional `--out=<json>` saves a structured report.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/evaluate-verb-policy.ts \
//     --weights=data/policy-weights/v1/verb-policy-v1.json \
//     --corpus=data/trajectories/phase-b-v2-mlpv3-sd7
//
//   # With per-sample predictions table:
//   npx tsx scripts/evaluate-verb-policy.ts --weights=<...> --corpus=<...> --verbose
// =============================================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  STATE_DIM,
  STATE_FEATURE_NAMES,
  computeFeatureSpecHash,
} from '../../src/solver/ml/state-feature-extractor.js';
import { VerbPolicy, type VerbPolicyWeights } from '../../src/solver/ml/verb-policy.js';

interface TrajectoryStep {
  step: number;
  promptType: string;
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionVerb: string | null;
  stateFeatures: Record<string, number>;
}

interface TrajectoryFile {
  fixtureId: string;
  featureSpecHash: string;
  trajectory: TrajectoryStep[];
}

function parseArg(name: string): string | undefined {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}

function loadCorpus(dir: string): TrajectoryFile[] {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  return files.map(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TrajectoryFile);
}

function materializeStateVec(stateFeatures: Record<string, number>): number[] {
  const vec = new Array<number>(STATE_DIM);
  for (let i = 0; i < STATE_DIM; i++) {
    const v = stateFeatures[STATE_FEATURE_NAMES[i]];
    if (v === undefined) throw new Error(`missing feature: ${STATE_FEATURE_NAMES[i]}`);
    vec[i] = v;
  }
  return vec;
}

function main(): void {
  const weightsPath = parseArg('weights');
  const corpusDir = parseArg('corpus');
  const outPath = parseArg('out');
  const verbose = process.argv.includes('--verbose');
  if (!weightsPath || !corpusDir) {
    console.error('Usage: --weights=<weights-json> --corpus=<trajectory-dir> [--out=<json>] [--verbose]');
    process.exit(2);
  }

  const expectedHash = computeFeatureSpecHash();
  const weights: VerbPolicyWeights = JSON.parse(readFileSync(resolve(weightsPath), 'utf-8'));
  const policy = new VerbPolicy();
  policy.setWeights(weights);
  const labelClasses = policy.labelClasses();
  const K = labelClasses.length;
  const labelToIdx = new Map(labelClasses.map((c, i) => [c, i]));

  const files = loadCorpus(corpusDir);
  console.log(`Weights: ${weightsPath}`);
  console.log(`Corpus:  ${corpusDir} (${files.length} files)`);
  console.log(`Classes: ${labelClasses.join(', ')}`);

  // Validation: corpus featureSpecHash must match runtime hash.
  for (const f of files) {
    if (f.featureSpecHash !== expectedHash) {
      console.error(`featureSpecHash mismatch in ${f.fixtureId}: ${f.featureSpecHash} != ${expectedHash}`);
      process.exit(3);
    }
  }

  // Filter to SELECT_IDLECMD with non-null actionVerb.
  let total = 0;
  let unknownLabel = 0;
  let top1Correct = 0;
  let top2Correct = 0;
  let trueLabelProbSum = 0;
  let trueLabelLogProbSum = 0;
  const confusion: number[][] = Array.from({ length: K }, () => Array(K).fill(0));
  type SampleRow = {
    fixtureId: string;
    step: number;
    cardName: string;
    trueVerb: string;
    predVerb: string;
    trueProb: number;
    correct: boolean;
  };
  const samples: SampleRow[] = [];

  for (const file of files) {
    for (const s of file.trajectory) {
      if (s.promptType !== 'SELECT_IDLECMD') continue;
      if (!s.actionVerb) continue;
      total++;
      const trueIdx = labelToIdx.get(s.actionVerb);
      if (trueIdx === undefined) {
        unknownLabel++;
        continue;
      }
      const stateVec = materializeStateVec(s.stateFeatures);
      const probs = policy.predict(stateVec);
      let bestC = 0;
      let secondC = 0;
      let bestP = -Infinity;
      let secondP = -Infinity;
      for (let c = 0; c < K; c++) {
        if (probs[c] > bestP) {
          secondP = bestP; secondC = bestC;
          bestP = probs[c]; bestC = c;
        } else if (probs[c] > secondP) {
          secondP = probs[c]; secondC = c;
        }
      }
      const correct = bestC === trueIdx;
      if (correct) top1Correct++;
      if (bestC === trueIdx || secondC === trueIdx) top2Correct++;
      trueLabelProbSum += probs[trueIdx];
      trueLabelLogProbSum += Math.log(Math.max(probs[trueIdx], 1e-12));
      confusion[trueIdx][bestC]++;
      samples.push({
        fixtureId: file.fixtureId,
        step: s.step,
        cardName: s.cardName,
        trueVerb: s.actionVerb,
        predVerb: labelClasses[bestC],
        trueProb: probs[trueIdx],
        correct,
      });
    }
  }

  const evaluable = total - unknownLabel;
  if (evaluable === 0) {
    console.error('No evaluable SELECT_IDLECMD samples found.');
    process.exit(4);
  }
  const top1Acc = top1Correct / evaluable;
  const top2Acc = top2Correct / evaluable;
  const meanTrueProb = trueLabelProbSum / evaluable;
  const meanTrueLogProb = trueLabelLogProbSum / evaluable;

  console.log(`\n=== Evaluation summary ===`);
  console.log(`SELECT_IDLECMD samples:  ${evaluable}${unknownLabel > 0 ? ` (${unknownLabel} skipped, verb not in policy classes)` : ''}`);
  console.log(`Top-1 accuracy:          ${top1Correct}/${evaluable} (${(top1Acc * 100).toFixed(1)}%)`);
  console.log(`Top-2 accuracy:          ${top2Correct}/${evaluable} (${(top2Acc * 100).toFixed(1)}%)`);
  console.log(`Mean P(true label):      ${meanTrueProb.toFixed(3)}   (uniform=${(1 / K).toFixed(3)})`);
  console.log(`Mean log P(true):        ${meanTrueLogProb.toFixed(3)}   (uniform=${(-Math.log(K)).toFixed(3)})`);

  // Per-class metrics from confusion matrix.
  console.log('\nPer-class metrics:');
  const perClassReport: Record<string, { support: number; precision: number; recall: number; f1: number }> = {};
  for (let c = 0; c < K; c++) {
    const support = confusion[c].reduce((a, b) => a + b, 0);
    const truePositive = confusion[c][c];
    let predictedAsC = 0;
    for (let r = 0; r < K; r++) predictedAsC += confusion[r][c];
    const precision = predictedAsC > 0 ? truePositive / predictedAsC : 0;
    const recall = support > 0 ? truePositive / support : 0;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    perClassReport[labelClasses[c]] = { support, precision, recall, f1 };
    console.log(`  ${labelClasses[c].padEnd(20)} support=${String(support).padStart(3)}  precision=${(precision * 100).toFixed(1).padStart(5)}%  recall=${(recall * 100).toFixed(1).padStart(5)}%  f1=${(f1 * 100).toFixed(1).padStart(5)}%`);
  }

  // Confusion matrix.
  console.log('\nConfusion matrix (rows=true, cols=pred):');
  const colWidths = labelClasses.map(c => Math.max(c.length, 4));
  const headerCells = labelClasses.map((c, i) => c.padStart(colWidths[i])).join(' ');
  console.log(`  ${' '.repeat(20)} ${headerCells}`);
  for (let r = 0; r < K; r++) {
    const cells = confusion[r].map((v, i) => String(v).padStart(colWidths[i])).join(' ');
    console.log(`  ${labelClasses[r].padEnd(20)} ${cells}`);
  }

  if (verbose) {
    console.log('\nPer-sample predictions:');
    for (const s of samples) {
      const mark = s.correct ? '✓' : '✗';
      console.log(`  ${mark}  ${s.fixtureId.padEnd(40)} step=${String(s.step).padStart(3)}  true=${s.trueVerb.padEnd(20)} pred=${s.predVerb.padEnd(20)} P(true)=${s.trueProb.toFixed(3)}  ${s.cardName}`);
    }
  }

  if (outPath) {
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      weightsPath: resolve(weightsPath),
      corpusDir: resolve(corpusDir),
      labelClasses,
      total,
      evaluable,
      unknownLabel,
      top1Accuracy: top1Acc,
      top2Accuracy: top2Acc,
      meanTrueLabelProb: meanTrueProb,
      meanTrueLabelLogProb: meanTrueLogProb,
      confusionMatrix: confusion,
      perClassReport,
      samples: verbose ? samples : undefined,
    };
    const abs = resolve(outPath);
    writeFileSync(abs, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    console.log(`\nWrote ${abs}`);
  }
}

main();
