// =============================================================================
// hydrate-llm-annotations.ts — Phase 3 Architecture C / Phase 2.
//
// Joins LLM action-index annotations with re-replayed trajectory state to
// produce a distillation-ready training corpus:
//
//   for each annotation (fixtureId, seed, step, llmRanked, llmConfidence):
//     - locate trajectory dump  data/trajectories/aug-multiseed-combined/
//       <fixtureId>{_sdN}.json   (sd7 = no suffix; sd11/sd42 = _sdN)
//     - replay canonical steps 0..step on a fresh OCGCore duel
//     - at step `step`, capture FieldState + legal Action[]
//     - extract STATE_DIM=58 stateVec via state-feature-extractor
//     - extract per-action `actionVerb` for each legal index
//     - build SOFT TARGET over the 6 v2 verb classes:
//         w_p = exp((N - p) / tau)        // softmax-of-rank, tau = 2 default
//         target[v] = sum over actions a where verb(a)=v of w_p[rank_of_a]
//         normalize to sum = 1 (KL-target)
//       Actions whose verb is NOT in v2 labelClasses contribute mass to a
//       virtual "unknown" bucket that is dropped before normalization.
//     - confidence weight: high → 1.0, medium → 0.5
//
// Outputs:
//   <out-dir>/training.jsonl   one line per hydrated sample
//   <out-dir>/manifest.json    schema, label-class order, perFixture, perConf
//
// SELECT_CARD samples are dropped (verb-policy is SELECT_IDLECMD-only by
// design; PolicyGuidedRanker.rank() gates on promptType === 'SELECT_IDLECMD').
//
// Hard constraints:
// - labelClasses are pinned to the v2 weights file order so the trained
//   distilled weights are drop-in compatible with PolicyGuidedRanker.
// - featureSpecHash is captured into the manifest and re-checked at training
//   time.
// - tau is exposed as --tau= so we can later sweep without hand-editing.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/hydrate-llm-annotations.ts \
//     --in=data/llm-annotations/phase-1-batch-1.jsonl \
//     --trajectories=data/trajectories/aug-multiseed-combined \
//     --v2-weights=data/policy-weights/v2/verb-policy-v1.json \
//     --out=data/policy-training/llm-distilled-v1 \
//     --tau=2.0
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  type HandFixture,
} from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import { buildCardMetadataMap } from '../../src/solver/card-metadata.js';
import {
  STATE_DIM,
  STATE_FEATURE_NAMES,
  computeFeatureSpecHash,
  buildFeatureContext,
  extractStateFeatures,
  type FeatureContext,
} from '../../src/solver/ml/state-feature-extractor.js';
import type { Action, DuelConfig } from '../../src/solver/solver-types.js';
import type { VerbPolicyWeights } from '../../src/solver/ml/verb-policy.js';

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

interface Args {
  inFile: string;
  trajectoriesDir: string;
  v2WeightsFile: string;
  outDir: string;
  tau: number;
}

function parseArgs(): Args {
  const pick = (n: string): string | undefined => {
    const a = process.argv.find(x => x.startsWith(`--${n}=`));
    return a?.slice(n.length + 3);
  };
  const inFile = pick('in');
  const trajectoriesDir = pick('trajectories');
  const v2WeightsFile = pick('v2-weights');
  const outDir = pick('out');
  const tauStr = pick('tau');
  if (!inFile || !trajectoriesDir || !v2WeightsFile || !outDir) {
    console.error('Usage: --in=<annotations.jsonl> --trajectories=<dir> --v2-weights=<path> --out=<dir> [--tau=2.0]');
    process.exit(2);
  }
  const tau = tauStr !== undefined ? Number(tauStr) : 2.0;
  if (!Number.isFinite(tau) || tau <= 0) {
    throw new Error(`[hydrate] tau must be positive finite: ${tauStr}`);
  }
  return { inFile, trajectoriesDir, v2WeightsFile, outDir, tau };
}

// -----------------------------------------------------------------------------
// Annotation + trajectory shapes
// -----------------------------------------------------------------------------

interface Annotation {
  fixtureId: string;
  seed: string;
  step: number;
  promptType: 'SELECT_IDLECMD' | 'SELECT_CARD';
  groundTruthIndex: number;
  groundTruthCard: string;
  llmBestIndex: number;
  llmBestCard: string;
  llmRanked: number[];
  llmConfidence: 'high' | 'medium' | 'low';
  gtRankInLlm: number;
  hitTop1: boolean;
  hitTop3: boolean;
  hitTop5: boolean;
}

interface TrajectoryStep {
  step: number;
  promptType: string;
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionVerb?: string;
}

interface TrajectoryFile {
  schemaVersion: number;
  fixtureId: string;
  trajectory: TrajectoryStep[];
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function trajectoryFileName(fixtureId: string, seed: string): string {
  // sd7 = base (no suffix). sd11/sd42 = _sdN suffix.
  if (seed === 'sd7') return `${fixtureId}.json`;
  return `${fixtureId}_${seed}.json`;
}

function softmaxOfRank(N: number, rankPos: number, tau: number): number {
  // rankPos = 0 (best) .. N-1 (worst). We want best to carry highest weight.
  // Use exp((N - 1 - rankPos) / tau): rank 0 → exp((N-1)/tau), rank N-1 → 1.
  // Renormalization is done after summing per verb, so the additive offset
  // doesn't matter; exp((N - rankPos) / tau) produces the same normalized
  // distribution. We still apply (N - rankPos)/tau for numerical clarity.
  return Math.exp((N - rankPos) / tau);
}

interface HydratedSample {
  fixtureId: string;
  seed: string;
  step: number;
  promptType: 'SELECT_IDLECMD';
  stateVec: number[];
  /** Soft KL target over labelClasses (length = K, sums to 1). */
  targetVerbDist: number[];
  /** Sample loss weight (1.0 high / 0.5 medium / 0.25 low). */
  confWeight: number;
  /** DFS-mainPath ground-truth verb (for v2-style "P(true)" diagnostic). */
  gtVerb: string | null;
  /** LLM top-pick verb (for distillation-fit diagnostic). */
  llmTopVerb: string | null;
  /** Number of legal actions at this step (for sanity). */
  legalCount: number;
  /** How many of the legal actions had a verb in labelClasses. */
  legalWithKnownVerb: number;
}

interface Manifest {
  schemaVersion: 1;
  generatedAt: string;
  source: 'llm-distilled-phase-1';
  inFile: string;
  v2WeightsFile: string;
  featureSpecHash: string;
  stateFeatureNames: readonly string[];
  stateDim: number;
  labelClasses: string[];
  tau: number;
  totalSamples: number;
  droppedSelectCard: number;
  droppedDrift: number;
  perFixture: Record<string, number>;
  perSeed: Record<string, number>;
  perConfidence: Record<string, number>;
  classWeights: Record<string, number>;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  // Load v2 weights → pin labelClasses order.
  const v2: VerbPolicyWeights = JSON.parse(readFileSync(resolve(args.v2WeightsFile), 'utf-8'));
  const labelClasses = v2.labelClasses;
  const labelToIdx = new Map(labelClasses.map((c, i) => [c, i]));
  const K = labelClasses.length;
  console.log(`[hydrate] labelClasses (pinned to v2): ${JSON.stringify(labelClasses)}`);
  console.log(`[hydrate] tau=${args.tau}`);

  // Load fixtures + adapter (one duel per fixture+seed group).
  const fixture = loadFixtureFile();
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  adapter.exposeMultiPickMechanical = true;

  // Load annotations.
  const annLines = readFileSync(resolve(args.inFile), 'utf-8').trim().split('\n').filter(l => l.length > 0);
  const annotations: Annotation[] = annLines.map(l => JSON.parse(l));
  console.log(`[hydrate] loaded ${annotations.length} annotations`);

  // Group by (fixtureId, seed) so we replay each trajectory once.
  type GroupKey = string;
  const groups = new Map<GroupKey, Annotation[]>();
  for (const a of annotations) {
    const key = `${a.fixtureId}::${a.seed}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  console.log(`[hydrate] ${groups.size} (fixture,seed) groups`);

  const samples: HydratedSample[] = [];
  let droppedSelectCard = 0;
  let droppedDrift = 0;
  const perFixture: Record<string, number> = {};
  const perSeed: Record<string, number> = {};
  const perConfidence: Record<string, number> = {};

  for (const [key, groupAnnotations] of groups) {
    const [fixtureId, seed] = key.split('::');
    const trajPath = resolve(args.trajectoriesDir, trajectoryFileName(fixtureId, seed));
    let traj: TrajectoryFile;
    try {
      traj = JSON.parse(readFileSync(trajPath, 'utf-8'));
    } catch (e) {
      console.error(`[hydrate] cannot read trajectory ${trajPath}: ${(e as Error).message}`);
      droppedDrift += groupAnnotations.length;
      continue;
    }
    if (traj.fixtureId !== fixtureId) {
      console.error(`[hydrate] fixtureId mismatch in ${basename(trajPath)}: ${traj.fixtureId} != ${fixtureId}`);
      droppedDrift += groupAnnotations.length;
      continue;
    }

    // Look up fixture (deck + hand + deckSeed).
    const hand: HandFixture | undefined = fixture.hands.find(h => h.id === fixtureId);
    if (!hand) {
      console.error(`[hydrate] fixture ${fixtureId} not in hands.yaml`);
      droppedDrift += groupAnnotations.length;
      continue;
    }
    const deck = fixture.decks[hand.deck];
    if (!deck) {
      console.error(`[hydrate] deck ${hand.deck} not found`);
      droppedDrift += groupAnnotations.length;
      continue;
    }

    const allCardIds = [...deck.main, ...deck.extra, ...hand.hand];
    const metadata = buildCardMetadataMap(cardDB, allCardIds);
    const ctx: FeatureContext = buildFeatureContext({
      metadata,
      interruptionTags: allConfigs.interruptionTags,
      interruptionWeights: allConfigs.interruptionWeights,
      mainDeck: deck.main,
      extraDeck: deck.extra,
    });

    // Setup duel.
    const mainDeck = [...deck.main];
    for (const cid of hand.hand) {
      const idx = mainDeck.indexOf(cid);
      if (idx === -1) throw new Error(`[hydrate] hand card ${cid} not in main deck of ${fixtureId}`);
      mainDeck.splice(idx, 1);
    }
    const duelConfig: DuelConfig = {
      mainDeck,
      extraDeck: deck.extra,
      hand: hand.hand,
      deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
      opponentDeck: [],
      startingDrawCount: 0,
      drawCountPerTurn: 1,
    };
    const handle = adapter.createDuel(duelConfig);

    // Build a step → annotation lookup so we can capture state at the right moments.
    const annByStep = new Map<number, Annotation>(groupAnnotations.map(a => [a.step, a]));
    const traversalEnd = Math.max(...groupAnnotations.map(a => a.step));

    let aborted = false;
    for (let i = 0; i <= traversalEnd; i++) {
      const tstep = traj.trajectory[i];
      if (!tstep) {
        console.error(`[hydrate] ${key} step ${i}: trajectory exhausted before reaching annotation step ${traversalEnd}`);
        aborted = true;
        break;
      }

      const legal = adapter.getLegalActions(handle);
      if (legal.length === 0) {
        console.error(`[hydrate] ${key} step ${i}: no legal actions (replay drift)`);
        aborted = true;
        break;
      }
      const matched = legal.find(a => a.responseIndex === tstep.responseIndex && a.cardId === tstep.cardId);
      if (!matched) {
        console.error(`[hydrate] ${key} step ${i}: no legal action matches trajectory (replay drift)`);
        aborted = true;
        break;
      }

      // If this step has an annotation, capture before applying the action.
      const ann = annByStep.get(i);
      if (ann) {
        if (ann.promptType !== 'SELECT_IDLECMD') {
          droppedSelectCard++;
        } else {
          // Sanity: legal action count and groundTruthIndex must agree with annotation.
          if (ann.groundTruthIndex < 0 || ann.groundTruthIndex >= legal.length) {
            console.error(`[hydrate] ${key} step ${i}: groundTruthIndex ${ann.groundTruthIndex} out of range [0,${legal.length})`);
            droppedDrift++;
          } else {
            const gtAction = legal[ann.groundTruthIndex];
            const gtVerb = gtAction.actionVerb ?? null;
            const llmTopAction = ann.llmBestIndex >= 0 && ann.llmBestIndex < legal.length
              ? legal[ann.llmBestIndex]
              : undefined;
            const llmTopVerb = llmTopAction?.actionVerb ?? null;

            // Build target distribution.
            const N = legal.length;
            const verbMass = new Array<number>(K).fill(0);
            let knownMass = 0;
            let legalWithKnown = 0;
            for (let actionIdx = 0; actionIdx < N; actionIdx++) {
              const a = legal[actionIdx];
              const verb = a.actionVerb;
              if (!verb) continue;
              const cIdx = labelToIdx.get(verb);
              if (cIdx === undefined) continue;
              legalWithKnown++;
              const rankPos = ann.llmRanked.indexOf(actionIdx);
              if (rankPos < 0) {
                // Action wasn't in llmRanked at all — assign worst-rank weight.
                verbMass[cIdx] += softmaxOfRank(N, N, args.tau);
              } else {
                verbMass[cIdx] += softmaxOfRank(N, rankPos, args.tau);
              }
              knownMass += verbMass[cIdx];
            }
            // Re-normalize to sum=1 over labelClasses.
            const sum = verbMass.reduce((s, v) => s + v, 0);
            if (sum <= 0) {
              console.error(`[hydrate] ${key} step ${i}: zero verb mass — no legal action has a known verb. Dropping.`);
              droppedDrift++;
            } else {
              const target = verbMass.map(v => v / sum);
              const confWeight = ann.llmConfidence === 'high' ? 1.0
                : ann.llmConfidence === 'medium' ? 0.5
                : 0.25;
              const stateVec = extractStateFeatures(adapter.getFieldState(handle), ctx);
              if (stateVec.length !== STATE_DIM) {
                throw new Error(`[hydrate] stateVec length ${stateVec.length} != STATE_DIM ${STATE_DIM}`);
              }

              samples.push({
                fixtureId,
                seed,
                step: i,
                promptType: 'SELECT_IDLECMD',
                stateVec,
                targetVerbDist: target,
                confWeight,
                gtVerb,
                llmTopVerb,
                legalCount: N,
                legalWithKnownVerb: legalWithKnown,
              });
              perFixture[fixtureId] = (perFixture[fixtureId] ?? 0) + 1;
              perSeed[seed] = (perSeed[seed] ?? 0) + 1;
              perConfidence[ann.llmConfidence] = (perConfidence[ann.llmConfidence] ?? 0) + 1;
            }
          }
        }
      }

      adapter.applyAction(handle, matched);
    }
    adapter.destroyDuel(handle);
    if (aborted) {
      // Already counted drift for this fixture's annotations? No — we only counted on capture.
      // The remaining annotations in this group are unrecoverable — count them as drift.
      for (const ann of groupAnnotations) {
        if (ann.step > -1 && !samples.some(s => s.fixtureId === fixtureId && s.seed === seed && s.step === ann.step)) {
          droppedDrift++;
        }
      }
    }
  }

  adapter.destroyAll();

  // Class weights — use INVERSE FREQUENCY of GT verbs (DFS-mainPath argmax) so
  // we keep the v2 normalization style: w_c = totalSamples / (K * (n_c + 1)).
  // For soft-target KL, class weights apply per-sample as: weight = w_{gtVerb} * confWeight.
  const gtVerbCounts: Record<string, number> = Object.fromEntries(labelClasses.map(c => [c, 0]));
  for (const s of samples) {
    if (s.gtVerb && labelToIdx.has(s.gtVerb)) {
      gtVerbCounts[s.gtVerb] = (gtVerbCounts[s.gtVerb] ?? 0) + 1;
    }
  }
  const classWeights: Record<string, number> = {};
  for (const c of labelClasses) {
    classWeights[c] = samples.length / (K * (gtVerbCounts[c] + 1));
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'llm-distilled-phase-1',
    inFile: resolve(args.inFile),
    v2WeightsFile: resolve(args.v2WeightsFile),
    featureSpecHash: computeFeatureSpecHash(),
    stateFeatureNames: STATE_FEATURE_NAMES,
    stateDim: STATE_DIM,
    labelClasses,
    tau: args.tau,
    totalSamples: samples.length,
    droppedSelectCard,
    droppedDrift,
    perFixture,
    perSeed,
    perConfidence,
    classWeights,
  };

  const outAbs = resolve(args.outDir);
  mkdirSync(outAbs, { recursive: true });
  const trainingPath = join(outAbs, 'training.jsonl');
  writeFileSync(trainingPath, samples.map(s => JSON.stringify(s)).join('\n') + '\n', 'utf-8');
  const manifestPath = join(outAbs, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  console.log(`\n[hydrate] === Summary ===`);
  console.log(`  Hydrated samples:        ${samples.length}`);
  console.log(`  Dropped SELECT_CARD:     ${droppedSelectCard}`);
  console.log(`  Dropped (drift/error):   ${droppedDrift}`);
  console.log(`  Per fixture:             ${JSON.stringify(perFixture)}`);
  console.log(`  Per seed:                ${JSON.stringify(perSeed)}`);
  console.log(`  Per confidence:          ${JSON.stringify(perConfidence)}`);
  console.log(`  GT-verb distribution:    ${JSON.stringify(gtVerbCounts)}`);
  console.log(`  Class weights:           ${JSON.stringify(classWeights, (_k, v) => typeof v === 'number' ? Number(v.toFixed(3)) : v)}`);
  console.log(`\n  Wrote ${trainingPath}`);
  console.log(`  Wrote ${manifestPath}`);
}

main().catch(err => {
  console.error('[hydrate] fatal:', err);
  process.exit(1);
});
