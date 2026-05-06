// =============================================================================
// diag-determinism.ts — Phase B Day 2 determinism investigation.
//
// Background: pre-flight verdict memo flagged a gap between ES-converged
// fitness (state "loaded" after 300+ consecutive evals) and re-eval at the
// same weights (state "fresh"). Seed 7 ES converged fitness=19, re-eval=11
// (gap -8). MLP randinit seed 42: ES=26, re-eval=21 (gap -5). The score
// median +9 fell just under the +10 GO threshold — the gap matters.
//
// Two hypotheses:
//   1. Adapter state accumulation: 300+ consecutive `runFixture` calls leak
//      state in InternalHandle / OCGCore between rollouts, biasing later
//      evals toward "lucky" terminals reachable only from accumulated state.
//   2. Wall-clock variance: DFS budget hits a different terminal under
//      varying CPU load — purely external timing noise, not state-related.
//
// This script tests hypothesis 1: if 5 consecutive `runFixture` calls at
// IDENTICAL weights produce varying (score, matched, nodes), state is
// leaking. If results are bit-stable, the gap is hypothesis 2.
//
// Usage:
//   cd duel-server
//   SOLVER_DISABLE_EXPERTISE=1 npx tsx scripts/diag-determinism.ts \
//     [--fixture=snake-eye-yummy-opener] [--weights=neural-pre-flight-seed7] \
//     [--budget-ms=6000] [--node-budget=400] [--runs=5]
//
// Output: log per run + summary; report path written to
// `_bmad-output/solver-data/phase-b/determinism-investigation-2026-04-26.md`
// when --report is passed.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  runFixture,
  type FixtureFile,
} from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../../src/solver/goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../../src/solver/route-aware-ranker.js';
import { NeuralFeatureRanker, type NeuralWeights } from '../../src/solver/ml/neural-ranker.js';
import { buildCardMetadataMap } from '../../src/solver/card-metadata.js';

interface Args {
  fixture: string;
  weightsBasename: string;
  budgetMs: number;
  nodeBudget: number;
  runs: number;
}

function parseArgs(): Args {
  const pick = (name: string): string | undefined => {
    const arg = process.argv.find(a => a.startsWith(`--${name}=`));
    return arg?.slice(name.length + 3);
  };
  const num = (v: string | undefined, d: number): number => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`[diag-determinism] bad number for ${v}`);
    return n;
  };

  return {
    fixture: pick('fixture') ?? 'snake-eye-yummy-opener',
    weightsBasename: pick('weights') ?? 'neural-pre-flight-seed7',
    budgetMs: num(pick('budget-ms'), 6000),
    nodeBudget: num(pick('node-budget'), 400),
    runs: num(pick('runs'), 5),
  };
}

interface RunResult {
  run: number;
  score: number;
  matched: number;
  matchedTotal: number;
  nodes: number;
  wallMs: number;
  termination: string;
  interruptionScore: number;
  explorationScore: number;
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Honest config — match pre-flight regime so re-eval semantics hold.
  if (process.env.SOLVER_DISABLE_EXPERTISE !== '1') {
    console.log('[diag-determinism] forcing SOLVER_DISABLE_EXPERTISE=1');
    process.env.SOLVER_DISABLE_EXPERTISE = '1';
  }
  delete process.env.SOLVER_IMPLICIT_GOALS;
  delete process.env.SOLVER_IMPLICIT_GOALS_WEIGHT;

  console.log(`[diag-determinism] fixture=${args.fixture} weights=${args.weightsBasename}`);
  console.log(`[diag-determinism] budget=${args.budgetMs}ms node-budget=${args.nodeBudget} runs=${args.runs}`);

  // ---- Load fixture + weights ---------------------------------------------
  const fixture: FixtureFile = loadFixtureFile();
  const hand = fixture.hands.find(h => h.id === args.fixture);
  if (!hand) throw new Error(`[diag-determinism] fixture '${args.fixture}' not found`);
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`[diag-determinism] deck '${hand.deck}' not found`);

  const weightsPath = join(DATA_DIR, 'trained-weights', `${args.weightsBasename}.json`);
  const weights = JSON.parse(readFileSync(weightsPath, 'utf-8')) as NeuralWeights;
  const archStr = weights.arch.hidden.length === 0 ? 'linear' : `mlp[${weights.arch.hidden.join(',')}]`;
  console.log(`[diag-determinism] weights: arch=${archStr} bonusScale=${weights.params.bonusScale} seed=${weights.metadata?.seed ?? '?'}`);

  // ---- Boot OCGCoreAdapter (snapshot fork ON by default per 2026-04-23) ---
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  console.log(`[diag-determinism] snapshot fork: available=${adapter.snapshotAvailable}`);

  const cardMetadata = buildCardMetadataMap(cardDB, [
    ...deck.main, ...deck.extra, ...hand.hand,
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
  neuralRanker.setNeuralWeights(weights);

  // ---- Run N consecutive evals --------------------------------------------
  const results: RunResult[] = [];
  for (let i = 0; i < args.runs; i++) {
    const t0 = Date.now();
    const res = await runFixture(
      adapter, scorer, routeAware, fixture, hand, allConfigs,
      args.budgetMs, args.nodeBudget, { dfsRanker: neuralRanker },
    );
    const wallMs = Date.now() - t0;
    const r: RunResult = {
      run: i + 1,
      score: res.score,
      matched: res.matched,
      matchedTotal: res.matchedTotal,
      nodes: res.nodesExplored,
      wallMs,
      termination: res.terminationReason,
      interruptionScore: res.breakdown.interruptionScore,
      explorationScore: res.explorationScore,
    };
    results.push(r);
    console.log(
      `[diag-determinism] run ${r.run}: score=${r.score.toFixed(2)} ` +
      `matched=${r.matched}/${r.matchedTotal} ` +
      `interrupt=${r.interruptionScore.toFixed(2)} expl=${r.explorationScore.toFixed(2)} ` +
      `nodes=${r.nodes} wall=${r.wallMs}ms term=${r.termination}`,
    );
  }

  // ---- Summary ------------------------------------------------------------
  const scores = results.map(r => r.score);
  const matcheds = results.map(r => r.matched);
  const nodesAll = results.map(r => r.nodes);
  const interrupts = results.map(r => r.interruptionScore);

  const stats = (xs: number[]) => {
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    return { min, max, mean, std: Math.sqrt(variance), span: max - min };
  };

  const sScore = stats(scores);
  const sMatched = stats(matcheds);
  const sNodes = stats(nodesAll);
  const sInterrupt = stats(interrupts);

  console.log('\n[diag-determinism] === SUMMARY ===');
  console.log(`score:     min=${sScore.min.toFixed(2)} max=${sScore.max.toFixed(2)} span=${sScore.span.toFixed(2)} mean=${sScore.mean.toFixed(2)} std=${sScore.std.toFixed(3)}`);
  console.log(`matched:   min=${sMatched.min} max=${sMatched.max} span=${sMatched.span} mean=${sMatched.mean.toFixed(2)} std=${sMatched.std.toFixed(3)}`);
  console.log(`interrupt: min=${sInterrupt.min.toFixed(2)} max=${sInterrupt.max.toFixed(2)} span=${sInterrupt.span.toFixed(2)} mean=${sInterrupt.mean.toFixed(2)} std=${sInterrupt.std.toFixed(3)}`);
  console.log(`nodes:     min=${sNodes.min} max=${sNodes.max} span=${sNodes.span} mean=${sNodes.mean.toFixed(0)} std=${sNodes.std.toFixed(1)}`);

  // Verdict: distinguish OUTCOME determinism (score/matched) from COMPUTE
  // determinism (nodes). State leak would corrupt outcome. Wall-clock-bound
  // search produces stable outcome but variable nodes (cycle-counting
  // truncation differs run-to-run).
  const outcomeStable = sScore.span === 0 && sMatched.span === 0 && sInterrupt.span === 0;
  const computeStable = sNodes.span === 0;
  console.log(`\nOUTCOME (score/matched/interrupt): ${outcomeStable ? 'BIT-STABLE' : 'VARIES'}`);
  console.log(`COMPUTE (nodes explored):           ${computeStable ? 'BIT-STABLE' : 'VARIES'}`);
  if (outcomeStable && !computeStable) {
    console.log(`\nVERDICT: outcome deterministic; nodes vary by ${(sNodes.span / Math.max(sNodes.mean, 1) * 100).toFixed(1)}% — ` +
      `WALL-CLOCK-BOUND search (cycle truncation differs but reaches same best terminal).`);
    console.log('Implication: ES-vs-re-eval gap likely caused by CPU-load-dependent node throughput, not state leak.');
  } else if (!outcomeStable) {
    console.log(`\nVERDICT: outcome NON-DETERMINISTIC (score-span ${sScore.span.toFixed(2)}, matched-span ${sMatched.span}). State leak or true engine non-determinism.`);
  } else {
    console.log(`\nVERDICT: BIT-IDENTICAL across all metrics. nb-bound deterministic regime.`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[diag-determinism] FATAL:', err);
  process.exit(1);
});
