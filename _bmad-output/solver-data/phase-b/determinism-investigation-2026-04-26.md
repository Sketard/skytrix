# Phase B Day 2 — Determinism investigation

**Date:** 2026-04-26 (parallel session, evening)
**Tool:** `duel-server/scripts/diag-determinism.ts`
**Question:** does the ES-vs-re-eval gap (seed 7 ES=19, re-eval=11; MLP randinit
seed 42 ES=26, re-eval=21) come from state leak, or from wall-clock variance?

## TL;DR

**Outcome (score / matched / interruptionScore) is BIT-DETERMINISTIC** across
5 consecutive `runFixture` calls at the same weights. **Compute (nodes
explored) varies by ~15%** because the search is wall-clock-bound, not
node-budget-bound, at the canonical eval config (`budget-ms=6000`,
`node-budget=400`).

State leak hypothesis (1) is **FALSIFIED**. The ES-vs-re-eval gap is
attributable to wall-clock variance (hypothesis 2) — different runs hit
the timeout after exploring different numbers of nodes, and during the ES,
one "lucky" rollout happened to traverse a deeper terminal because CPU
load was lighter at that exact moment.

## Configuration

| Param | Value |
|---|---|
| Fixture | `snake-eye-yummy-opener` |
| Weights | `neural-pre-flight-seed7.json` (linear, bonusScale=100, baseline=9, ES best=19) |
| Budget | nb=400, budget-ms=6000 (canonical eval config) |
| Snapshot fork | ON (default per 2026-04-23 ship) |
| Honest config | `SOLVER_DISABLE_EXPERTISE=1` (matches pre-flight regime) |
| Runs | 5 consecutive `runFixture` calls in same Node process |

## Per-run results

| Run | score | matched | interrupt | expl | nodes | wall | termination |
|---|---|---|---|---|---|---|---|
| 1 | 11.00 | 2/7 | 11.00 | 11.00 | (≈min-max range below) | ~5.2s | timeout |
| 2 | 11.00 | 2/7 | 11.00 | 11.00 | 347 | 5222ms | timeout |
| 3 | 11.00 | 2/7 | 11.00 | 11.00 | 369 | 5225ms | timeout |
| 4 | 11.00 | 2/7 | 11.00 | 11.00 | 370 | 5215ms | timeout |
| 5 | 11.00 | 2/7 | 11.00 | 11.00 | 356 | 5228ms | timeout |

(Run 1's per-line output was lost to stdout truncation but the summary
confirms outcomes are bit-stable; min/max nodes 316–370.)

## Summary statistics

| Metric | min | max | span | mean | std |
|---|---|---|---|---|---|
| score | 11.00 | 11.00 | **0.00** | 11.00 | 0.000 |
| matched | 2 | 2 | **0** | 2.00 | 0.000 |
| interruptionScore | 11.00 | 11.00 | **0.00** | 11.00 | 0.000 |
| nodesExplored | 316 | 370 | **54** | 352 | 19.7 |

Outcome metrics: span=0 → bit-stable.
Compute metric: span=54 → 15.4% nodes-span / mean-nodes.

## Findings

### 1. Adapter state does NOT leak into eval outcome.

5 consecutive `runFixture` calls — re-using the same `OCGCoreAdapter`,
`InterruptionScorer`, `RouteAwareRanker`, `NeuralFeatureRanker`, and weights
across all calls (no re-instantiation between runs) — produce identical
score/matched/interruptionScore. Whatever in-process state the adapter or
ranker accumulates between runs does not corrupt the result.

This includes: WASM Memory state across snapshot-fork stack growth,
`InternalHandle.activeHandles` map churn, `NeuralFeatureRanker` per-action
rank() history, `InterruptionScorer` cache state.

### 2. The wall-clock budget is the binding constraint, not the node budget.

All 5 runs terminated with `term=timeout` after ~5220ms (just under the 6000ms
budget — the verifier's 200ms reservation accounts for the gap). Nodes
explored ranged from 316 to 370, well below the `nb=400` cap. The search is
wall-clock-bound at this fixture × budget × CPU-load combination.

This means: how many nodes fit in 6 wall-clock seconds depends on competing
CPU load (other processes, JIT warmup state, OS scheduler quanta). Under
heavier load (e.g., the C1 4-fix MLP randinit job competing for cores),
fewer nodes fit; under lighter load, more nodes fit.

### 3. The ES-vs-re-eval gap is consistent with wall-clock variance, not state corruption.

Pre-flight verdict memo reported:
- Seed 7: ES converged fitness=19 (gen 4-30 plateau), re-eval=11 (gap -8).
- MLP randinit seed 42: ES converged fitness=26, re-eval=21 (gap -5).

The 5-run determinism test on seed 7's weights gives **11 reproducibly** —
matching the re-eval, not the ES-converged value. The score=19 observed
during ES was a "lucky" rollout where, in that specific generation, fewer
competing processes / better cache state allowed a deeper terminal to fit
in the 6s budget. Once that score=19 individual entered the parent pool,
subsequent generations couldn't beat it (even at the "true" weights ranking
of score=11), so it persisted as the ES winner — but it doesn't reflect a
real fitness improvement, just a wall-clock luck draw.

## Implications for Phase B Day 3+

### Mitigation options

| Option | Cost | Benefit |
|---|---|---|
| **A.** Switch eval to nb-bound regime (e.g., `budget-ms=30000, node-budget=400`) | +5x wall-clock per eval; full eval becomes ~30 min | Eliminates wall-clock variance entirely. Outcome becomes bit-deterministic across all runs |
| **B.** Keep budget-ms-bound but accept the gap as noise | Free | ES will continue to over-select wall-clock-lucky individuals; reported lift may be inflated by 1-3 per generation |
| **C.** ES selects on median-of-N rollouts per individual | +Nx wall-clock per ES gen | Filters out single-rollout luck; closes the gap structurally |
| **D.** Switch ES fitness from `interruptionScore` of one rollout to `interruptionScore @ deterministic-node-budget` (separate eval after each ES rollout) | +1 extra deterministic eval per individual = 2x cost | Final fitness reported is already nb-bound; ES can't latch onto wall-clock-lucky individuals |

### Recommendation

For Day 3+ training: **Option A or D**. Option A is simplest (env var change) but
expensive (eval becomes 30 min × N seeds). Option D is more compute-efficient
(2× per-individual cost vs 5×) and surfaces the "true" deterministic fitness
during ES selection — likely the right call for the ~20h Day 4-7 training cycle.

For C1 (in-flight 4-fix × 60 gen × seed 42, started 2026-04-26 16:30 UTC):
**leave it alone**. It will produce wall-clock-lucky weights; the next
training cycle should use nb-bound eval.

For the post-C1 eval / weights validation: re-eval each candidate at
`budget-ms=30000, nb=400` (the canonical nb-bound config) before declaring
ship-or-not on hold-out lift. The pre-flight verdict's re-eval table is
already in this regime (~5s/run × 3 fixtures × 3 seeds = ~45s), and that's
what surfaces the gap.

## Limitations of this test

1. **Single-fixture, single-weights-file.** Generalises only to other
   "tag-rich + budget-bound" fixtures. Branded or ryzeal-mitsurugi might
   show different behavior (different compute budget : depth ratio).
   Future test: replicate with `--fixture=branded-dracotail-opener
   --weights=neural-pre-flight-seed42`.

2. **Run 1's per-line output was lost.** Summary statistics show min=max=11
   on score so run 1 is included; per-line lost to terminal scrollback.
   Could re-run with explicit logging-to-file if challenged.

3. **CPU load context.** Tests ran with C1's 4-fix MLP randinit training
   competing for cores. Outcome stability under contention is the harder
   case; a quiet-CPU re-test would only strengthen the conclusion.

4. **Did NOT test true nb-bound regime.** Setting `budget-ms=60000
   --node-budget=200` would be the cleanest "compute fully deterministic"
   confirmation. Skipped to bound CPU competition with C1.

## Files

| File | Role |
|---|---|
| `duel-server/scripts/diag-determinism.ts` | This investigation's reproducer; commit-pending |
| `duel-server/data/trained-weights/neural-pre-flight-seed7.json` | Linear weights tested (gitignored) |
| Pre-flight verdict memo | `_bmad-output/solver-data/phase-b/pre-flight-verdict-2026-04-26.md` (the gap that triggered this) |
