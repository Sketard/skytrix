// =============================================================================
// train-neural-worker.ts — Piscina worker for parallel ES rollout evaluation.
//
// Each worker boots its own OCGCoreAdapter + scorer + NeuralFeatureRanker
// stack at init (~1-2s WASM boot amortized over the pool lifetime). Per task,
// it loads the candidate weights into the ranker, runs all training-set
// fixtures via runFixture, and returns the sum of interruptionScore + per-
// fixture diagnostics.
//
// Invoked from train-neural-pool.ts via Piscina. Each task is independent
// (no shared state across tasks beyond the booted adapter/scorer), so
// rollouts on separate workers run truly in parallel — bound only by CPU
// cores + thermal throttle.
//
// Determinism: WASM snapshot fork is bit-identical across rollouts (per
// parallel session investigation 2026-04-26 commit e5068169), so same
// vector → same fitness regardless of which worker evaluates it. ES
// selection is fitness-based, so worker assignment ordering doesn't affect
// the outcome.
// =============================================================================

import { join } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  runFixture,
  type FixtureFile,
  type HandFixture,
} from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../../src/solver/goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../../src/solver/route-aware-ranker.js';
import { NeuralFeatureRanker, type NeuralWeights } from '../../src/solver/ml/neural-ranker.js';
import { buildCardMetadataMap } from '../../src/solver/card-metadata.js';

// =============================================================================
// Task contract — must match train-neural-pool.ts
// =============================================================================

export interface TrainTask {
  /** Candidate weights JSON for this evaluation. Worker calls
   *  `neuralRanker.setNeuralWeights(weights)` then runs all fixtures. */
  weights: NeuralWeights;
  /** Fixture ids to evaluate. The fitness function = sum of interruptionScore
   *  across these fixtures. */
  fixtureIds: readonly string[];
  /** Per-rollout DFS budget (canonical 6000ms). */
  timeLimitMs: number;
  /** Per-root-child node-budget guard. Canonical 400. */
  nodeBudget?: number;
}

export interface PerFixtureResult {
  id: string;
  interruptionScore: number;
  matched: number;
  matchedTotal: number;
  nodesExplored: number;
  terminationReason: string;
}

export interface TrainTaskResult {
  /** Sum of `interruptionScore` across fixtures — pure Phase B fitness. */
  fitness: number;
  perFixture: PerFixtureResult[];
}

// =============================================================================
// Worker init — boots once per worker, reused across tasks
// =============================================================================

interface WorkerContext {
  fixture: FixtureFile;
  adapter: OCGCoreAdapter;
  scorer: InterruptionScorer;
  routeAware: RouteAwareRanker;
  neuralRanker: NeuralFeatureRanker;
  allConfigs: ReturnType<typeof loadAllSolverConfigs>;
}

async function initWorker(): Promise<WorkerContext> {
  // Honest config — same regime as production. Disable expertise so the
  // ranker stack matches the Phase B trained weights' expectations.
  if (process.env.SOLVER_DISABLE_EXPERTISE !== '1') {
    process.env.SOLVER_DISABLE_EXPERTISE = '1';
  }

  const fixture = loadFixtureFile();
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  // Card metadata: union across ALL non-draft fixtures (worker may serve any
  // fixture across tasks; pre-flight scope changes are pinned per task via
  // setMainDeck/setExtraDeck on the neural ranker inside runFixture).
  const metadataCardIds: number[] = [];
  for (const h of fixture.hands) {
    if (h._draft === true) continue;
    const deck = fixture.decks[h.deck];
    if (!deck) continue;
    metadataCardIds.push(...deck.main, ...deck.extra, ...h.hand);
  }
  const cardMetadata = buildCardMetadataMap(cardDB, metadataCardIds);

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

  return { fixture, adapter, scorer, routeAware, neuralRanker, allConfigs };
}

// Boot once per worker. Top-level await is supported in worker_threads.
const ctx: WorkerContext = await initWorker();

// =============================================================================
// Task handler — Piscina default export contract
// =============================================================================

export default async function runTrainTask(task: TrainTask): Promise<TrainTaskResult> {
  ctx.neuralRanker.setNeuralWeights(task.weights);

  let fitness = 0;
  const perFixture: PerFixtureResult[] = [];
  for (const id of task.fixtureIds) {
    const hand: HandFixture | undefined = ctx.fixture.hands.find(h => h.id === id);
    if (!hand) throw new Error(`[train-neural-worker] Unknown fixture id '${id}'`);

    const res = await runFixture(
      ctx.adapter,
      ctx.scorer,
      ctx.routeAware,
      ctx.fixture,
      hand,
      ctx.allConfigs,
      task.timeLimitMs,
      task.nodeBudget,
      { dfsRanker: ctx.neuralRanker },
    );

    fitness += res.breakdown.interruptionScore;
    perFixture.push({
      id,
      interruptionScore: res.breakdown.interruptionScore,
      matched: res.matched,
      matchedTotal: res.matchedTotal,
      nodesExplored: res.nodesExplored,
      terminationReason: res.terminationReason,
    });
  }

  return { fitness, perFixture };
}
