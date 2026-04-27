// =============================================================================
// extract-policy-training-data.ts — Phase 3 Stage 3a (Phase 4 policy MVP).
//
// Reads a Stage 1 trajectory corpus dir and emits a JSONL training set for
// the verb-class policy network. Filters to SELECT_IDLECMD steps only —
// SELECT_CHAIN responses are reactive (different decision context); SELECT_CARD
// / SELECT_EFFECTYN / etc. are mid-activation choices with no actionVerb.
//
// Output:
//   <out-dir>/training.jsonl    (one JSON object per training sample)
//   <out-dir>/manifest.json     (class index map + per-class counts +
//                                inverse-frequency class weights with Laplace
//                                smoothing + featureSpecHash)
//
// Hard constraints:
// - All trajectory dumps in the corpus dir MUST share the same
//   `featureSpecHash`, which MUST match the current `state-feature-extractor.ts`
//   hash. Mismatch → extractor fails loud (would produce mixed-spec garbage
//   training data).
// - State vector materialized by reading `stateFeatures[name]` for each name
//   in `STATE_FEATURE_NAMES` order — guards against silent reorderings.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/extract-policy-training-data.ts \
//     --in=data/trajectories/phase-b-v2-mlpv3-sd7 \
//     --out=data/policy-training/v1
// =============================================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  STATE_FEATURE_NAMES,
  STATE_DIM,
  computeFeatureSpecHash,
} from '../src/solver/state-feature-extractor.js';

// -----------------------------------------------------------------------------
// Trajectory file shape (subset — matches Stage 1 schema v1)
// -----------------------------------------------------------------------------

interface TrajectoryStep {
  step: number;
  promptType: string;
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
  actionVerb: string | null;
  stateFeatures: Record<string, number>;
}

interface TrajectoryFile {
  schemaVersion: number;
  fixtureId: string;
  featureSpecHash: string;
  trajectory: TrajectoryStep[];
}

// -----------------------------------------------------------------------------
// Training sample shape
// -----------------------------------------------------------------------------

interface TrainingSample {
  fixtureId: string;
  step: number;
  /** 58-dim float vector, ordered per `STATE_FEATURE_NAMES`. */
  stateVec: number[];
  /** Index into `manifest.labelClasses`. */
  labelIdx: number;
  /** Verb name string (redundant with labelIdx, for human inspection). */
  labelName: string;
}

interface Manifest {
  schemaVersion: 1;
  generatedAt: string;
  corpusDir: string;
  featureSpecHash: string;
  stateFeatureNames: readonly string[];
  stateDim: number;
  /** Verb classes IN OUTPUT ORDER. Index = labelIdx. Only classes that appear
   *  ≥1 time in the training set are included — runtime falls back to base
   *  ranker if action.actionVerb ∉ this list. */
  labelClasses: string[];
  /** Per-class sample count in training set. */
  perClass: Record<string, number>;
  /** Inverse-frequency class weights with Laplace smoothing.
   *  `w_c = totalSamples / (K * (n_c + 1))` where K = labelClasses.length.
   *  Used by trainer's class-weighted cross-entropy. */
  classWeights: Record<string, number>;
  /** Per-fixture sample count (training-set composition audit). */
  perFixture: Record<string, number>;
  totalSamples: number;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function loadCorpus(dir: string): TrajectoryFile[] {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  return files.map(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TrajectoryFile);
}

function materializeStateVec(stateFeatures: Record<string, number>): number[] {
  const vec = new Array<number>(STATE_DIM);
  for (let i = 0; i < STATE_DIM; i++) {
    const name = STATE_FEATURE_NAMES[i];
    const v = stateFeatures[name];
    if (v === undefined) {
      throw new Error(`[extract-policy-training-data] missing feature '${name}' in stateFeatures — corpus drift?`);
    }
    vec[i] = v;
  }
  return vec;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main(): void {
  const inDir = parseArg('in');
  const outDir = parseArg('out');
  if (!inDir || !outDir) {
    console.error('Usage: --in=<corpus-dir> --out=<output-dir>');
    process.exit(2);
  }

  const expectedHash = computeFeatureSpecHash();
  const files = loadCorpus(inDir);
  console.log(`Loaded ${files.length} trajectory files from ${inDir}`);

  // Hash validation pass.
  for (const f of files) {
    if (f.featureSpecHash !== expectedHash) {
      console.error(
        `[extract-policy-training-data] featureSpecHash mismatch in ${f.fixtureId}:\n` +
        `  trajectory: ${f.featureSpecHash}\n` +
        `  current:    ${expectedHash}\n` +
        `Re-dump corpus with current STATE_FEATURE_NAMES first.`,
      );
      process.exit(3);
    }
  }

  // Filter + collect samples. SELECT_IDLECMD only; actionVerb must be non-null
  // (drops zero-cardId pass and `(no-verb)` selections that don't appear at
  // IDLECMD anyway, but defensive).
  const samples: TrainingSample[] = [];
  const perClass = new Map<string, number>();
  const perFixture = new Map<string, number>();
  for (const f of files) {
    for (const s of f.trajectory) {
      if (s.promptType !== 'SELECT_IDLECMD') continue;
      if (!s.actionVerb) continue;
      perClass.set(s.actionVerb, (perClass.get(s.actionVerb) ?? 0) + 1);
      perFixture.set(f.fixtureId, (perFixture.get(f.fixtureId) ?? 0) + 1);
      samples.push({
        fixtureId: f.fixtureId,
        step: s.step,
        stateVec: materializeStateVec(s.stateFeatures),
        labelIdx: -1,  // assigned after class set is finalized
        labelName: s.actionVerb,
      });
    }
  }

  if (samples.length === 0) {
    console.error('[extract-policy-training-data] no SELECT_IDLECMD samples — corpus is empty?');
    process.exit(4);
  }

  // Stable label order: descending sample count, then alpha tiebreak.
  // Stable order matters because labelIdx is baked into the policy weights;
  // re-ordering the manifest invalidates a trained model.
  const labelClasses = [...perClass.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([k]) => k);
  const labelToIdx = new Map(labelClasses.map((c, i) => [c, i]));
  for (const s of samples) {
    s.labelIdx = labelToIdx.get(s.labelName)!;
  }

  // Inverse-frequency class weights with Laplace smoothing.
  const K = labelClasses.length;
  const totalSamples = samples.length;
  const classWeights: Record<string, number> = {};
  for (const c of labelClasses) {
    const n_c = perClass.get(c)!;
    classWeights[c] = totalSamples / (K * (n_c + 1));
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    corpusDir: inDir,
    featureSpecHash: expectedHash,
    stateFeatureNames: STATE_FEATURE_NAMES,
    stateDim: STATE_DIM,
    labelClasses,
    perClass: Object.fromEntries(labelClasses.map(c => [c, perClass.get(c)!])),
    classWeights,
    perFixture: Object.fromEntries(
      [...perFixture.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    totalSamples,
  };

  // Write outputs.
  const absOut = resolve(outDir);
  mkdirSync(absOut, { recursive: true });
  const jsonlPath = join(absOut, 'training.jsonl');
  const manifestPath = join(absOut, 'manifest.json');

  const lines = samples.map(s => JSON.stringify(s)).join('\n') + '\n';
  writeFileSync(jsonlPath, lines, 'utf-8');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  // Stdout summary.
  console.log(`\nWrote ${samples.length} samples to ${jsonlPath}`);
  console.log(`Wrote manifest to ${manifestPath}`);
  console.log(`\nPer-class: ${JSON.stringify(manifest.perClass)}`);
  console.log(`Per-fixture: ${JSON.stringify(manifest.perFixture)}`);
  console.log(`Class weights: ${JSON.stringify(classWeights, (_k, v) => typeof v === 'number' ? Number(v.toFixed(3)) : v)}`);
}

main();
