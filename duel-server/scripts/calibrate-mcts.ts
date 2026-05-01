// =============================================================================
// calibrate-mcts.ts — MCTS UCB1 constant calibration script (Story 1.7 AC)
//
// Runs MCTS over a fixed set of calibration hands at C ∈ {0.7, 1.0, 1.414, 2.0, 2.5},
// 10 runs per (hand, C). Reports mean and stddev per C and selects the best
// C value (highest mean score whose stddev ≤ 15% of mean — matches the MCTS
// stability threshold from the Story 1.7 golden-test AC).
//
// Usage: npx tsx scripts/calibrate-mcts.ts
//
// Inputs:
//   - duel-server/data/cards.cdb
//   - duel-server/data/scripts_full/
//   - duel-server/data/solver-config.json (overridden per run)
//   - _bmad-output/planning-artifacts/research/mcts-calibration-hands.json
//
// Outputs:
//   - _bmad-output/planning-artifacts/research/mcts-calibration-results-{date}.json
//   - Console summary report
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { MCTSSolver } from '../src/solver/mcts-solver.js';
import type { DuelConfig, SolverConfig, SolverConfigFile } from '../src/solver/solver-types.js';

// =============================================================================
// Configuration
// =============================================================================

const SMOKE = process.argv.includes('--smoke');
const PROBE = process.argv.includes('--probe');
const C_VALUES: readonly number[] = SMOKE || PROBE ? [1.414] : [0.7, 1.0, 1.414, 2.0, 2.5];
const RUNS_PER_C = SMOKE || PROBE ? 1 : 10;
// PROBE uses Optimal budget to verify MCTS can produce non-zero scores AT ALL
const TIME_LIMIT_MS = PROBE ? 30000 : SMOKE ? 3000 : 5000;
const STABILITY_THRESHOLD = 0.15; // stddev / mean must be ≤ this to qualify

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const HANDS_PATH = resolve(
  import.meta.dirname!,
  '..',
  '..',
  '_bmad-output',
  'planning-artifacts',
  'research',
  'mcts-calibration-hands.json',
);
const RESULTS_PATH = resolve(
  import.meta.dirname!,
  '..',
  '..',
  '_bmad-output',
  'planning-artifacts',
  'research',
  `mcts-calibration-results-${todayIso()}.json`,
);

// =============================================================================
// Types
// =============================================================================

interface CalibrationHand {
  id: string;
  deck: string;
  description: string;
  hand: number[];
  deckSeed: string;
}

interface CalibrationFile {
  decks: Record<string, { main: number[]; extra: number[] }>;
  hands: CalibrationHand[];
}

interface RunResult {
  cValue: number;
  handId: string;
  runIndex: number;
  score: number;
  nodesExplored: number;
  elapsedMs: number;
  errored: boolean;
}

interface AggregatedStats {
  cValue: number;
  handId: string;
  runs: number;
  mean: number;
  stddev: number;
  stddevRatio: number; // stddev / mean
  errors: number;
}

// =============================================================================
// Helpers
// =============================================================================

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseSeed(seedStr: string): bigint[] {
  return seedStr.split(',').map(s => BigInt(s.trim()));
}

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeStddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// =============================================================================
// Boot
// =============================================================================

console.log('[Calibrate] Booting solver dependencies...');
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
const scorer = new InterruptionScorer(allConfigs.interruptionTags, allConfigs.interruptionWeights);
const ranker = new GoldfishChainRanker();
console.log('[Calibrate] Boot complete\n');

// =============================================================================
// Load calibration hands
// =============================================================================

const calibFile = JSON.parse(readFileSync(HANDS_PATH, 'utf-8')) as CalibrationFile;
const hands = calibFile.hands;
console.log(`[Calibrate] Loaded ${hands.length} hands across ${Object.keys(calibFile.decks).length} decks`);
console.log(`[Calibrate] Plan: ${hands.length} hands × ${C_VALUES.length} C values × ${RUNS_PER_C} runs = ${hands.length * C_VALUES.length * RUNS_PER_C} solves`);
console.log(`[Calibrate] Estimated max time: ${(hands.length * C_VALUES.length * RUNS_PER_C * TIME_LIMIT_MS / 60000).toFixed(1)} min\n`);

// =============================================================================
// Calibration loop
// =============================================================================

const allRuns: RunResult[] = [];
const startTime = Date.now();
let solveIndex = 0;
const totalSolves = hands.length * C_VALUES.length * RUNS_PER_C;

for (const hand of hands) {
  const deckEntry = calibFile.decks[hand.deck];
  if (!deckEntry) {
    console.error(`[Calibrate] Unknown deck "${hand.deck}" for hand ${hand.id}`);
    continue;
  }

  // Remove hand cards from main deck (server logic mirror)
  const mainDeck = [...deckEntry.main];
  let handValid = true;
  for (const cardId of hand.hand) {
    const idx = mainDeck.indexOf(cardId);
    if (idx === -1) {
      console.error(`[Calibrate] Hand card ${cardId} not in deck for ${hand.id}`);
      handValid = false;
      break;
    }
    mainDeck.splice(idx, 1);
  }
  if (!handValid) continue;

  const baseDeckSeed = parseSeed(hand.deckSeed);

  for (const cValue of C_VALUES) {
    // Override ucb1C for this batch
    const tunedConfig: SolverConfigFile = { ...allConfigs.solverConfig, ucb1C: cValue };
    const mcts = new MCTSSolver(scorer, adapter, ranker, tunedConfig);

    for (let runIdx = 0; runIdx < RUNS_PER_C; runIdx++) {
      solveIndex++;
      const runSeed: bigint[] = [
        baseDeckSeed[0] ^ BigInt(runIdx + 1),
        (baseDeckSeed[1] ?? 0n) ^ BigInt((runIdx + 1) * 31),
      ];

      const duelConfig: DuelConfig = {
        mainDeck,
        extraDeck: deckEntry.extra,
        hand: hand.hand,
        deckSeed: runSeed,
        opponentDeck: [],
      };

      const solverConfig: SolverConfig = {
        mode: 'goldfish',
        speed: 'fast',
        timeLimitMs: TIME_LIMIT_MS,
      };

      const signal = AbortSignal.timeout(TIME_LIMIT_MS + 2000); // small slack for verification
      const t0 = Date.now();
      let score = 0;
      let nodesExplored = 0;
      let errored = false;

      try {
        const startHandle = adapter.createDuel(duelConfig);
        mcts.setSeed(runSeed);
        const result = mcts.solve(adapter, solverConfig, signal, () => {}, startHandle);
        score = result.score;
        nodesExplored = result.stats.nodesExplored;
        if (SMOKE || PROBE) {
          const ebc = result.endBoardCards ?? [];
          const ebcSummary = ebc.map(c => `${c.cardName}(${c.zone}${c.isFallback ? '/fb' : ''})`).join(', ');
          const mainPathSummary = result.mainPath.slice(0, 6).map(a => `${a.cardName || `#${a.cardId}`}/${a.responseIndex}`).join(' -> ');
          console.log(`\n  [run] ${hand.id} C=${cValue} run=${runIdx}:`);
          console.log(`        score=${score} nodes=${nodesExplored} maxDepth=${result.stats.maxDepthReached} bf=${result.stats.averageBranchingFactor.toFixed(2)}`);
          console.log(`        breakdown: weighted=${result.scoreBreakdown.weighted} fallback=${result.scoreBreakdown.fallbackPoints}`);
          console.log(`        endBoard(${ebc.length}): ${ebcSummary || '(empty)'}`);
          console.log(`        mainPath: ${mainPathSummary}${result.mainPath.length > 6 ? ' ...' : ''}`);
        }
      } catch (err) {
        errored = true;
        console.warn(`[Calibrate] Run failed: ${hand.id} C=${cValue} run=${runIdx}: ${String(err)}`);
      } finally {
        adapter.destroyAll();
      }

      const elapsedMs = Date.now() - t0;
      allRuns.push({
        cValue,
        handId: hand.id,
        runIndex: runIdx,
        score,
        nodesExplored,
        elapsedMs,
        errored,
      });

      // Progress line every 5 solves
      if (solveIndex % 5 === 0 || solveIndex === totalSolves) {
        const pct = ((solveIndex / totalSolves) * 100).toFixed(1);
        const elapsedTotal = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stdout.write(`\r[Calibrate] ${solveIndex}/${totalSolves} (${pct}%) — ${elapsedTotal}s elapsed`);
      }
    }
  }
}
process.stdout.write('\n\n');

// =============================================================================
// Aggregate
// =============================================================================

const perHandPerC: AggregatedStats[] = [];
for (const hand of hands) {
  for (const cValue of C_VALUES) {
    const runs = allRuns.filter(r => r.handId === hand.id && r.cValue === cValue && !r.errored);
    const errors = allRuns.filter(r => r.handId === hand.id && r.cValue === cValue && r.errored).length;
    const scores = runs.map(r => r.score);
    const mean = computeMean(scores);
    const stddev = computeStddev(scores, mean);
    perHandPerC.push({
      cValue,
      handId: hand.id,
      runs: scores.length,
      mean,
      stddev,
      stddevRatio: mean > 0 ? stddev / mean : 0,
      errors,
    });
  }
}

// Per-C aggregate (across all hands) — used for final pick
const perC = new Map<number, { meanOfMeans: number; meanStddevRatio: number; totalErrors: number }>();
for (const cValue of C_VALUES) {
  const rows = perHandPerC.filter(r => r.cValue === cValue);
  const meanOfMeans = computeMean(rows.map(r => r.mean));
  const meanStddevRatio = computeMean(rows.map(r => r.stddevRatio));
  const totalErrors = rows.reduce((s, r) => s + r.errors, 0);
  perC.set(cValue, { meanOfMeans, meanStddevRatio, totalErrors });
}

// Pick the best C: highest meanOfMeans whose meanStddevRatio ≤ STABILITY_THRESHOLD.
// If none qualify, fall back to the C with the lowest meanStddevRatio.
let bestC = C_VALUES[0];
let bestQualifyingMean = -Infinity;
for (const [c, agg] of perC) {
  if (agg.meanStddevRatio <= STABILITY_THRESHOLD && agg.meanOfMeans > bestQualifyingMean) {
    bestC = c;
    bestQualifyingMean = agg.meanOfMeans;
  }
}
let qualified = bestQualifyingMean > -Infinity;
if (!qualified) {
  // Fallback: most stable C
  let bestRatio = Infinity;
  for (const [c, agg] of perC) {
    if (agg.meanStddevRatio < bestRatio) {
      bestRatio = agg.meanStddevRatio;
      bestC = c;
    }
  }
}

// =============================================================================
// Report
// =============================================================================

console.log('================================================================');
console.log('MCTS UCB1 Calibration Results');
console.log('================================================================');
console.log(`Total runs: ${allRuns.length}`);
console.log(`Errors: ${allRuns.filter(r => r.errored).length}`);
console.log(`Total elapsed: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
console.log('');
console.log('Per-C aggregate (mean across hands):');
console.log('C       | meanScore | stddev/mean | errors');
console.log('--------|-----------|-------------|-------');
for (const cValue of C_VALUES) {
  const agg = perC.get(cValue)!;
  const ratioPct = (agg.meanStddevRatio * 100).toFixed(1);
  const marker = cValue === bestC ? ' <<' : '';
  console.log(
    `${cValue.toString().padEnd(7)} | ${agg.meanOfMeans.toFixed(2).padStart(9)} | ${(ratioPct + '%').padStart(11)} | ${agg.totalErrors.toString().padStart(6)}${marker}`,
  );
}
console.log('');
console.log(`Selected C: ${bestC} (${qualified ? 'qualified by stability threshold' : 'fallback to most-stable'})`);
console.log(`Stability threshold: stddev/mean ≤ ${(STABILITY_THRESHOLD * 100).toFixed(0)}%`);
console.log('');
console.log('Per-hand per-C breakdown:');
for (const hand of hands) {
  console.log(`  ${hand.id}:`);
  for (const cValue of C_VALUES) {
    const stats = perHandPerC.find(r => r.handId === hand.id && r.cValue === cValue)!;
    console.log(
      `    C=${cValue.toString().padEnd(5)} mean=${stats.mean.toFixed(2).padStart(7)} stddev=${stats.stddev.toFixed(2).padStart(6)} (${(stats.stddevRatio * 100).toFixed(1)}%) errors=${stats.errors}`,
    );
  }
}

// =============================================================================
// Save artifact
// =============================================================================

writeFileSync(
  RESULTS_PATH,
  JSON.stringify(
    {
      _meta: {
        date: todayIso(),
        timeLimitMs: TIME_LIMIT_MS,
        runsPerC: RUNS_PER_C,
        cValues: C_VALUES,
        stabilityThreshold: STABILITY_THRESHOLD,
        totalRuns: allRuns.length,
        errorCount: allRuns.filter(r => r.errored).length,
        elapsedSeconds: (Date.now() - startTime) / 1000,
      },
      selectedC: bestC,
      qualifiedByStability: qualified,
      perCAggregate: Object.fromEntries(perC),
      perHandPerC,
      allRuns,
    },
    null,
    2,
  ),
);
console.log(`\n[Calibrate] Results saved to ${RESULTS_PATH}`);

process.exit(0);
