# Phase B Day 1.5 — Pre-flight verdict

**Date:** 2026-04-26
**Seeds:** 42, 7, 11
**Training fixture:** snake-eye-yummy-opener
**Control fixtures:** branded-dracotail-opener, ryzeal-mitsurugi-opener
**Compute:** ~30 min wall-clock (1 seed serial + 2 seeds parallel)

## Verdict: **GO** for Day 2 (MLP path)

The matched-lift clause of the GO criterion is satisfied (median +2 matched
on training); 0/3 catastrophic regressions on controls. The score-lift clause
falls just short (+9 vs threshold +10). OR semantics → **GO**.

## Configuration

| Parameter | Value |
|---|---|
| Model | Linear (95 input → 1 output, 95 weight params evolved) |
| ES | (μ+λ) = (5+10), 30 gen, σ_init=0.3, σ_min=0.05 |
| Per-rollout budget | nb=400, budget-ms=6000 (matches eval canonical) |
| Bias `b1` | 0 (fixed) |
| `bonusScale` | 100 (fixed; not evolved in pre-flight) |
| Fitness | PURE `interruptionScore` (no matched², no goalMatchPoints, no terminalBonus, no novelty) |
| Honest config | `SOLVER_DISABLE_EXPERTISE=1`, no `--implicit-goals` |

## Honest baselines (re-measured 2026-04-26)

| Fixture | Honest baseline (score / matched) | Note |
|---|---|---|
| snake-eye-yummy-opener | 10 / 0 | Earlier checkpoint memo cited 23.24/1 (likely stale or different config) |
| branded-dracotail-opener | 26 / 1 | Earlier memo cited 71.79/4 (stale) |
| ryzeal-mitsurugi-opener | 15 / 1 | Earlier memo cited 39.5/1 (close on matched) |

The earlier in-memo baselines are stale — Phase 1 scorer audit (commit
cb1dd370) and prior calibration changes drifted them. The 2026-04-26
re-measurements are now the canonical reference for the rest of Phase B.

## Per-seed pre-flight results (re-eval at best weights)

| Fixture | Honest | Seed 42 | Seed 7 | Seed 11 |
|---|---|---|---|---|
| snake-eye-yummy (training) | 10 / 0 | 20 / 2 | 11 / 2 | 19 / 2 |
| branded-dracotail (control) | 26 / 1 | 36 / 3 | 27 / 2 | 25 / 3 |
| ryzeal-mitsurugi (control) | 15 / 1 | 12 / 0 | 27 / 1 | 27 / 1 |

## Per-seed deltas vs honest baseline

| Fixture | Seed 42 Δ | Seed 7 Δ | Seed 11 Δ | Median |
|---|---|---|---|---|
| snake-eye-yummy | +10 / +2 | +1 / +2 | +9 / +2 | **+9 / +2** |
| branded-dracotail | +10 / +2 | +1 / +1 | -1 / +2 | +1 / **+2** |
| ryzeal-mitsurugi | -3 / -1 | +12 / 0 | +12 / 0 | +12 / 0 |

## GO criteria check

| Criterion | Threshold | Result |
|---|---|---|
| median matched lift on training | ≥ +2 | ✅ +2 |
| median score lift on training | ≥ +10 | ⚠️ +9 |
| 0/3 catastrophic regression on controls | matched < -2 | ✅ Worst = -1 (seed 42 ryzeal) |

OR clause (matched OR score) → **GO**.

## Three findings

### 1. Cross-fixture transfer is real (not overfit)

Median +2 matched on **branded-dracotail** without training on it (1 → 3
matched on seeds 42 and 11, 1 → 2 on seed 7). This is exactly the
"deck-agnostic feature ranking generalises" hypothesis the design doc
tested. Positive evidence for Phase B's whole approach.

The score median on branded-dracotail is +1 (mixed: +10, +1, -1) — matched
generalises better than score, consistent with the honest-baseline regime
where score is dominated by the +1-per-faceup-monster fallback heuristic.

### 2. Determinism issue on seed 7 — fix before Day 2

ES converged at fitness=19 (gen 4-30 plateau, all 5 parents identical), but
re-eval on the same weights gave 11. Wall-clock variance in DFS time-budget
caused one rollout to score "lucky" 19 (deeper terminal reached in budget),
and that vector dominated subsequent generations because it had the highest
fitness on record. Real signal is ~11 — seed 42 and seed 11 don't show this
gap.

**Day 2 must enable WASM snapshot fork** (`SOLVER_USE_SNAPSHOT=1`, shipped
2026-04-23 per `solver-wasm-snapshot-fork-2026-04-23` memo, opt-in) so DFS
exploration is bit-identical across rollouts. Without determinism, ES selects
"lucky individuals" instead of better weights.

### 3. σ-collapse plateau matches v1 audit F2

All 3 seeds converge at gen 2-4 to fitness 19-20 then plateau; σ collapses
0.3 → 0.05 floor by gen 15. The σ_min=0.05 floor (raised from 1e-4 in v1
audit F2) keeps mutation alive through end of training, but no further lift
is found. **Linear plateau is real** — 95 features × 1 output can't separate
beyond ~20 score on this fixture.

This is the design doc's expected result: pre-flight tests "is there ANY
signal?" not "what's the ceiling?". The MLP `[95 → 32 → 1]` (3105 params,
non-linear) is the Day 2 answer to "how high can we push?".

## Day 2 plan (per design doc §9 + round 2 corrections)

| Day | Action |
|---|---|
| **Day 2** | (1) Enable `SOLVER_USE_SNAPSHOT=1` in training to fix determinism. (2) Promote linear path to MLP `[95 → 32 → 1]` (3106 evolved params incl. bonusScale). (3) Per-class σ schedule: weights σ_init=0.3 / σ_min=0.05, bonusScale σ_init=30 / σ_min=3 (init=100, min=30). (4) Plumb `normalSummonUsed` flag onto FieldState (~1-2 h). (5) Plumb opp-zone snapshot onto FieldState (Day 1.5 zeroed those 4 features — Day 2 unblocks). |
| Day 3 | Loader updates for MLP shape + featureSpecHash validation in production. End-to-end smoke run. |
| Day 4 | Multi-fixture training script. First training run seed=42 × 4-fixture × 60 gen overnight (~6.6 h). Trajectory dump infra. |
| Day 5 | Ablations 1-6 per design doc §6, 30 gen each, seed=42. |
| Day 6 | Hyperparameter tuning if signal looks promising. Final 3-seed run on best config. |
| Day 7 | Eval on full 14-fixture cum eval set at canonical config. Memo + commit if criteria met. |

**Wall-time:** ~20 h training (4-fix × 60 gen × 3 seeds at nb=400/6000ms)
+ ablations + analysis ≈ 1 week.

**Hold-out cumulative target (per design doc §1, advisory):** matched ≥ 25-28
(+5 to +8 over honest baseline 20). The pre-flight median +2 lift on training
× 4 fixtures = ~+8 matched if it transfers fully — overlap with the advisory
target.

## Artifacts (gitignored)

| File | Purpose |
|---|---|
| `duel-server/data/trained-weights/neural-pre-flight-seed{42,7,11}.json` | Trained weights per seed |
| `duel-server/data/training-logs/neural-pre-flight-seed*-<ISO>/{population,mutations}.jsonl + meta.json` | Forensic ES traces (analyze-mutations.mjs format) |
