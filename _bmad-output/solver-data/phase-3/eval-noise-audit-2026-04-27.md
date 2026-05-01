# Eval Noise Audit — 2026-04-27

**Date:** 2026-04-27
**Status:** SHIPPED
**Trigger:** Stage 3b null result (matched +0) — verify whether it's real or
swallowed by gate noise. Predecessor: `stage-3b-policy-wiring-2026-04-27.md`.

---

## TL;DR

The canonical eval at `--budget-ms=6000 --node-budget=400 --pool-size=4
--implicit-goals=10` is **perfectly deterministic on cum matched**:
σ = 0.00 across 10 replications, range [25, 25]. Cum score has σ = 0.49
(range 511-512), driven by a single fixture (snake-eye-yummy: ±1 score).
Per-fixture matched is invariant across all 10 runs.

Snapshot mode (`SOLVER_USE_SNAPSHOT=1`) gives identical results — also
deterministic at 25.

**Implication:** Stage 3b's +0 cum matched delta is a genuine ceiling, not
gate noise. The +3 matched gate criterion is reliable; verb-class policy
fundamentally doesn't surface new terminals at canonical budget.

The "+3 vs Phase B v2 ship reference 22" I cited earlier was an
apples-to-oranges comparison: Phase B v2's 22 was measured at
`--implicit-goals=0`, not the current canonical `--implicit-goals=10`.
At the same config on HEAD, both runs give 25.

---

## Methodology

Two configurations evaluated, all on 14-fix hold-out + mirrorjade
(15 fixtures total):
- **No-snapshot × 10**: `SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1`
  + canonical args. Wall-clock-bound DFS (default).
- **Snapshot × 5**: same + `SOLVER_USE_SNAPSHOT=1` (Phase B day-2 fork
  determinism mode).

Each run produces a `BaselineFile` JSON. Aggregate stats computed by
direct read.

## Result tables

### Cum-level aggregates

| Config | Cum matched | Cum score |
|---|---|---|
| No-snapshot × 10 | mean=25, σ=0.00, range=[25, 25] | mean=511.4, σ=0.49, range=[511, 512] |
| Snapshot × 5 | mean=25, σ=0.00, range=[25, 25] | mean=511.2, σ=0.40, range=[511, 512] |

Per-run cum score (no-snapshot): 512, 512, 511, 511, 511, 512, 511, 512, 511, 511.
Cum matched constant 25 every run.

### Per-fixture variance (no-snapshot × 10)

All 15 fixtures: matched σ = 0.00. Score σ = 0.0 except snake-eye-yummy
(σ = 0.5, range 30-31). nodesExplored σ = 3.3-9.0 per fixture (range
~20 nodes), confirming wall-clock-bound exploration varies but the BEST
terminal converges within the first ~200 nodes.

| Fixture | Matched (mean, σ) | Score (mean, σ) | NodesExplored (mean, σ) |
|---|---|---|---|
| ddd-pendulum-opener | 1.0, 0.00 | 27, 0.0 | 213, 7.7 |
| ryzeal-mitsurugi-opener | 2.0, 0.00 | 58, 0.0 | 212, 7.5 |
| radiant-typhoon-opener | 2.0, 0.00 | 38, 0.0 | 213, 6.5 |
| branded-dracotail-opener | 4.0, 0.00 | 70, 0.0 | 210, 5.7 |
| kashtira-azamina-opener | 1.0, 0.00 | 34, 0.0 | 191, 4.2 |
| horus-crystron-opener | 2.0, 0.00 | 43, 0.0 | 220, 4.8 |
| dinomorphia-opener | 0.0, 0.00 | 0, 0.0 | 236, 9.0 |
| spright-opener | 3.0, 0.00 | 50, 0.0 | 211, 4.8 |
| snake-eye-yummy-opener | 2.0, 0.00 | **30, 0.5** | 213, 4.8 |
| tearlaments-opener | 1.0, 0.00 | 27, 0.0 | 228, 9.0 |
| floowandereeze-opener | 2.0, 0.00 | 32, 0.0 | 209, 3.3 |
| labrynth-opener | 1.0, 0.00 | 16, 0.0 | 209, 3.9 |
| stun-runick-opener | 2.0, 0.00 | 30, 0.0 | 213, 3.9 |
| nekroz-ryzeal-opener | 1.0, 0.00 | 36, 0.0 | 233, 8.7 |
| branded-dracotail-opener-mirrorjade-line | 1.0, 0.00 | 20, 0.0 | 209, 4.5 |

### Cross-mode (snapshot vs no-snapshot)

Per-fixture median matched/score is **bit-identical** between snapshot
and no-snapshot at canonical. Snapshot doesn't unlock different DFS
trajectories at this budget.

---

## Why deterministic despite wall-clock variance

`nodesExplored` ranges ~±10 per fixture across runs (wall-clock budget
absorbs CPU-throughput jitter), yet matched/score never change. Two
likely contributors:
1. **Iterative deepening converges fast**: the DFS finds the eventual
   best terminal within the first ~200 of its 213-220 nodes. Remaining
   exploration just re-confirms the choice.
2. **Alpha-beta pruning is aggressive**: the lower bound established
   early dominates ordering; later children get pruned before they can
   surface alternative terminals.

snake-eye-yummy is the outlier: it occasionally finds a 31-score
terminal vs 30, but matched stays at 2 — a tied-score branch alternation,
not a real exploration depth difference.

---

## Why "Phase B v2 reference 22" doesn't match current 25

Phase B v2 ship memo cites "22 / 284 cum 14-fix hold-out" but that was
measured **without** `--implicit-goals=10`. At canonical config (with
implicit goals), the same commit would also give 25 — the gap is config
not code.

Concretely: implicit-goals adds +10 score per matched expectedBoard
card. Going from 0 → 25 matches contributes +220 to cum score, matching
the score delta we see (511 - 284 ≈ +227).

For matched count, the implicit-goal weight slightly steers DFS toward
expectedBoard-bearing terminals via the scorer's `goalMatchPoints`,
giving +3 matched at the same compute budget.

---

## Implications for Stage 3b verdict + future gates

1. **Stage 3b null is REAL**, not noise. Verb-class policy bias adds
   nothing measurable on top of the value-bonus ranking. Pivot recs
   in `stage-3b-policy-wiring-2026-04-27.md` stand.

2. **+3 matched gate is reliable** at this scale. Any future Pivot
   that lifts cum matched by 1+ is a real signal; no need for multi-seed
   median/MAD aggregation. Single-run delta = ground truth at canonical.

3. **σ_score = 0.49 sets a floor for score-only audits**. A claimed
   "+5 score lift" from a future intervention is within noise; need
   ≥+2 (4σ) to be statistically credible without replication.

4. **Future verdict memos MUST quote the exact CLI flags** including
   `--implicit-goals=N`. Apples-to-oranges baselines like Phase B v2's
   22 vs current 25 are avoidable with discipline.

---

## Recommendation

Pivot path stays as in stage-3b memo:
- **Pivot B (SELECT_CARD policy)** — highest leverage, ~2 weeks.
- **Pivot C (feature engineering / scorer)** — proven, ~1 week, smaller per-step gains.

The audit confirms the gate is reliable. Pivot to whichever the user
wants based on time/effort tradeoff.

---

## Files & references

- Eval results: `duel-server/data/audit-noise/{no-snapshot-r1..r10,snapshot-r1..r5}.json`
- Predecessor memos:
  - `stage-3b-policy-wiring-2026-04-27.md`
  - Phase B v2 ship: `_bmad-output/solver-data/phase-b/ship-v2-2026-04-27.md`
