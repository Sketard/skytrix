// =============================================================================
// evaluate-structural-worker.ts — Piscina worker for fixture-level parallelism.
//
// Boots the shared EvaluationContext once at worker init (cardDB + scripts +
// OCGCore + scorer + ranker), then processes one fixture per task. Weights
// overrides are re-applied per task so the same worker can serve candidates
// with different structural/interruption weights across tasks.
//
// Invoked via Piscina from evaluate-structural.ts / tune-weights.ts when they
// run in parallel mode. In serial mode those scripts bypass the pool entirely
// (runEvaluation() in-process path).
// =============================================================================

import {
  setupEvaluationContext,
  runFixture,
  applyWeightsOverride,
  resetWeightsToBaseline,
  type EvaluationContext,
  type FixtureResult,
  type FixtureTask,
} from './evaluate-structural.js';

// Boot once per worker. Top-level await is supported in worker_threads.
const ctx: EvaluationContext = await setupEvaluationContext();

export default async function runFixtureTask(task: FixtureTask): Promise<FixtureResult> {
  // Per-task weight application. resetWeightsToBaseline restores the loader
  // defaults so a prior task's override does not leak into this one.
  resetWeightsToBaseline(ctx);
  if (task.weightsOverride) {
    applyWeightsOverride(ctx, task.weightsOverride, `worker:${task.label}`, { silent: true });
  }

  const hand = ctx.fixture.hands.find(h => h.id === task.fixtureId);
  if (!hand) throw new Error(`[worker] Unknown fixture id '${task.fixtureId}'`);

  return runFixture(
    ctx.adapter,
    ctx.scorer,
    ctx.ranker,
    ctx.fixture,
    hand,
    ctx.allConfigs,
    task.timeLimitMs,
    task.nodeBudget,
    {
      useHints: task.useHints ?? false,
      algorithm: task.algorithm ?? 'dfs',
      // Plumb the GraphGuidedRanker-wrapped ranker through to DfsSolver.
      // When SOLVER_USE_TUNED_WEIGHTS is off, this equals ctx.ranker (no-op).
      dfsRanker: ctx.dfsRanker,
    },
  );
}
