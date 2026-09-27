# Diagnostic Audit (2026-04-25) — Wiring Bug Found, Earlier Findings Invalidated

After option-A appeared to "succeed" with +61 % aggregate lift and zero
regressions, a sanity check (random shuffle of trained weights) reproduced
the same +61 % numbers byte-identically. That impossible result revealed
two compounding bugs.

## Bug #1 — `GraphGuidedRanker` wiring bypassed `evaluate-structural`

`evaluate-structural-worker.ts` constructs a `RouteAwareRanker` directly
via `setupEvaluationContext()` and never invokes
`loadTunedWeightsIfEnabled`. `solver-worker.ts` (the production solver
worker) was wired correctly, but the **eval harness uses a different
worker path**. Every "tuned" gate run prior to commit `<this commit>`
actually used the same untuned ranker. The differences against the
"untuned baseline" were entirely Bug #2 below.

**Fix** : `evaluate-structural.ts:setupEvaluationContext` now calls
`loadTunedWeightsIfEnabled`, conditionally wraps `RouteAwareRanker` with
`GraphGuidedRanker`, exposes both via the `EvaluationContext`. The worker
plumbs `dfsRanker` to `runFixture`. Loud failure mode + JSONL trace at
`data/training-logs/loader-trace.jsonl` ensure post-hoc verifiability.

## Bug #2 — Parallel `Piscina` pool produces non-deterministic, score-compressed evaluations

Empirical N=3 untuned runs each at `--budget-ms=30000`:

| Mode | Aggregate score (3 runs) | σ | Per-fixture max σ | Per-fixture max range |
|---|---|---|---|---|
| Parallel pool (default size) | 297.17 / 298.50 / 301.17 | 1.886 | 0.943 | 2.000 |
| Sequential `--pool-size=1` | 364.17 / 364.17 / 364.17 | **0.000** | 0.000 | 0.000 |

**Two issues** :

1. **Non-determinism**: parallel mode varies run-to-run (σ ~1.9 aggregate,
   per-fixture σ up to ~1.0).
2. **Score compression**: parallel aggregate is **−18 %** vs sequential
   (298.50 vs 364.17). Per-fixture, the worst hits are :
   - stun-runick : 13 (seq) → 0.33 (par), −97 %
   - kashtira : 24 (seq) → 8.33 (par), −65 %
   - ryzeal-mitsurugi : 69.5 (seq) → 40.17 (par), −42 %

**Root cause** : 6 workers competing for CPU, each fixture gets ~1/6th of
the wall-clock budget as effective compute. Different fixtures get
starved differently per run depending on Piscina's task assignment.

**Implication for prior findings** : every gate run prior to this audit
was comparing snapshots taken under non-deterministic compressed-CPU
conditions. The "+61 % aggregate lift" of `tier-a-snake-eye` was
indistinguishable from the +60 % difference between the original
untuned baseline (186.86, anomalously low — possibly a cold-start outlier)
and a fresh untuned run (~298). The lift was not real.

**Fix for testing** : use `--pool-size=1` for all comparison gates. Slower
(~7.5 min per 15-fixture run) but deterministic and reflects real
production behaviour (single solver job at a time).

## Real Effect of Trained Weights — `tier-a-snake-eye` Sequential Gate

Comparison vs deterministic untuned baseline (`noise-untuned-seq-r1.json`,
aggregate 364.17 / 20 matched):

| Aggregate | Untuned | Snake-eye tuned | Δ |
|---|---:|---:|---:|
| matched | 20 / 69 | 21 / 69 | **+1** |
| score | 364.17 | 362.81 | **−1.36** |
| explorationScore | 381.34 | 380.39 | −0.94 |

Per-fixture :

| Fixture | Δ | Tag |
|---|---:|---|
| **snake-eye-yummy-opener** (own fixture) | matched +1, score +8.57 | ✓ training-fixture lift |
| branded-dracotail-opener | matched +0, score +2.50 | ✓ small cross-archetype lift |
| **ryzeal-mitsurugi-opener** | matched +0, score **−11.00 (−15.8 %)** | ✗ regression |
| 12 other fixtures | matched +0, score 0 ± 1.43 | = stable |

**Net** : modest training-fixture lift, modest cross-lift on branded, real
regression on ryzeal-mitsurugi. **No free lunch.** F5 partially holds —
single-fixture training does cause some cross-fixture regressions, just
not the catastrophic ones the buggy parallel runs had implied.

## Shuffle Test (Sanity Check)

Random permutation of `tier-a-snake-eye` values across active edges (same
267 active set, same value distribution, different assignments):

| Aggregate | Untuned | Shuffled | Δ |
|---|---:|---:|---:|
| matched | 20 / 69 | **17 / 69** | **−3** |
| score | 364.17 | 375.67 | +11.50 |

**Different effect from trained weights.** Shuffled produces matched-drops
(corrections in 2 fixtures, score swings) where trained gave matched +1.
This proves the ranker IS responding to specific edge identities, not just
"any non-zero weights help". **Learning is real but its magnitude is
modest.**

## New Findings

### F9 — Parallel pool is non-deterministic AND systematically lower-scoring

CPU contention compresses each fixture's effective compute. Aggregate
score in parallel mode = sequential × ~0.82, with σ ≈ 1.9. Use
`--pool-size=1` for any comparison gate. Cost: ~5× wall-time per run
(7.5 min vs 1.5 min for 15 fixtures), but deterministic.

### F10 — F6 / F7 / F8 INVALIDATED

The earlier conclusions (F6 "production-budget falsifies F4", F7 "zero
regressions cross-archetype", F8 "cross-archetype transfer ≠ no
specialisation") were drawn from gate runs that (a) bypassed the
`GraphGuidedRanker` wiring entirely and (b) used non-deterministic
parallel evaluations whose run-to-run variance dwarfed any signal. None
of those findings has empirical support and they should be considered
retracted.

### F11 — Learning IS real, but small at production budget

After fixing both bugs, the deterministic gate of `tier-a-snake-eye`
produces +8.57 on its own fixture, +2.50 cross-transfer to branded, and
**−11.00 regression on ryzeal-mitsurugi**. Net aggregate: −1.36 score,
+1 matched. The ranker *does* respond to specific edge values (shuffle
test shows different matched profile), so the framework is functional —
but the magnitude of real learning at this training budget is below the
threshold that would justify shipping.

## Status of v1 Framework

**Plumbing**: ✅ verified working end-to-end with diagnostic trace
- Loader fires (JSONL trace confirms outcome per worker boot)
- Loud-fail prevents silent bypass
- `GraphGuidedRanker` wired in both `solver-worker` (production) and
  `evaluate-structural` (eval harness)
- Sequential mode mandatory for fair comparison

**Learning quality**: 🟡 modest at current settings
- Real but small training-fixture lift (~+8 score on snake-eye-yummy,
  ~+2.50 cross-transfer)
- Genuine regression risk (~−11 on ryzeal-mitsurugi)
- Net aggregate near zero at sequential budget

**Open questions for next session** :
1. Does longer training (μ=10 λ=20, gen=20+) at production budget
   produce stronger weights?
2. Is `DEFAULT_GRAPH_SCALE = 100` too small for the bonus to dominate
   tie-breakers in the base ranker? Could need scale calibration.
3. Multi-fixture training (sum reward across 2-3 fixtures) might
   reduce cross-fixture regression by averaging.
4. Tier-B expansion (629 edges vs 267) might unlock new ranking levers
   that pure tier-A misses.

## Artefacts

| File | Purpose |
|---|---|
| `noise-untuned-r{1,2,3}.json` | parallel-mode untuned, σ ≈ 1.9 |
| `noise-untuned-seq-r{1,2,3}.json` | sequential-mode untuned, σ = 0 |
| `v3-gate-snake-eye-seq.{json,log}` | trained weights, sequential gate |
| `v3-gate-shuffled-seq.{json,log}` | shuffled weights, sequential gate |
| `data/training-logs/loader-trace.jsonl` | per-worker loader trace |
| `analyze-noise.mjs` | variance script |
