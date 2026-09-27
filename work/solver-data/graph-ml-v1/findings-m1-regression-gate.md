# M1 Regression Gate — 15-Fixture Cross-Validation (2026-04-25)

The M1 branded-tier-A weights (commit `93eb96de`,
`duel-server/data/trained-weights/tier-a-latest.json`) were applied to all
15 fixtures and compared against an untuned run at matched config (30 s /
200-node budget, same code version).

## Aggregate

| Metric | Untuned | Tuned | Δ |
|---|---:|---:|---:|
| cumulative matched | 11 / 69 | 7 / 69 | **−4** |
| cumulative score | 186.86 | 142.29 | **−44.57 (−23.9 %)** |
| cumulative explorationScore | 205.61 | 159.04 | **−46.57 (−22.6 %)** |
| training fixture (branded) | 3/8, score 30.64 | 3/8, score 30.64 | **0** |

## Per-Fixture Outcome

| Fixture | Δ matched | Δ score | Status |
|---|---:|---:|---|
| branded-dracotail-opener *(train)* | 0 | 0.00 | = stable |
| ddd-pendulum-opener | 0 | 0.00 | = stable |
| radiant-typhoon-opener | 0 | 0.00 | = stable |
| kashtira-azamina-opener | 0 | 0.00 | = stable |
| dinomorphia-opener | 0 | 0.00 | = stable |
| spright-opener | 0 | 0.00 | = stable |
| tearlaments-opener | 0 | −1.00 | = stable (tie-break) |
| floowandereeze-opener | 0 | 0.00 | = stable |
| labrynth-opener | 0 | 0.00 | = stable |
| stun-runick-opener | 0 | 0.00 | = stable |
| nekroz-ryzeal-opener | 0 | 0.00 | = stable |
| branded-dracotail-opener-mirrorjade-line | −1 | +2.00 | ~ correction (stricter endboard, score up) |
| **ryzeal-mitsurugi-opener** | **−1** | **−31.00 (−93.9 %)** | ✗ regression |
| **horus-crystron-opener** | **−1** | **−7.00 (−87.5 %)** | ✗ regression |
| **snake-eye-yummy-opener** | **−1** | **−7.57 (−48.6 %)** | ✗ regression |

3 fixtures regressed, all well beyond the research-mode −10 % threshold.

## Reading the Result

**Two findings surface together** :

### F4 — Training-budget specificity

The training loop used **4 s / 200-node** per eval. At that budget, learned
weights gave +25.2 % fitness lift on branded. At **production-like 30 s /
200-node**, branded's tuned vs untuned score is **identical** (30.64 in
both runs). The lift was a *low-budget shortcut* — it nudged the first few
action-ranker picks into a goal-advancing subtree that DFS could reach
within 4 s. Given a longer budget, DFS finds the same subtree unaided.

**Implication** : learned weights optimised at short budgets don't transfer
to production budgets. M2 training must use production-equivalent budgets,
OR the reward formula must explicitly penalise this drift.

Budget implication on training cost : 60 s × 500 evals = ~8.3 h per
experiment. Steep. Mitigations : (a) smaller pop (μ=3 λ=6), (b) fewer
generations per **F1** (plateau by gen 5), (c) multi-fixture reward so
each compute hour informs more decisions.

### F5 — Single-fixture training overfits (specialist collapse)

267 weights trained on branded alone produced three hard regressions on
ryzeal-mitsurugi (−94 %), horus-crystron (−88 %), snake-eye-yummy (−49 %).
These are archetypes that share card-effect *patterns* with branded
(tutor → extender → combo chain) where the branded-tuned rankings flip a
critical ordering.

This is the quantitative motivation for **MAP-Elites** in M2. Without
archetype-cell segregation and diversity pressure, single-pop ES produces
a *specialist* (optimal on its niche, harmful elsewhere) — exactly what
**F2** (2026-04-25 findings) predicted from the gen-2 population-std
collapse.

**M2 entry requirements** (from gate) :

1. **Archetype cells** : one weight vector per archetype, trained on the
   deck's representative fixtures. Avoids cross-archetype bleed-through.
2. **Multi-fixture reward inside a cell** : `fitness = Σ fixture_i ·
   fitness_i − λ · Σ max(0, regressing_j)`. Penalises any vector that
   regresses a sibling fixture in the same cell.
3. **Production budget per eval** (per F4) : 30–60 s minimum.
4. **Smaller sweeps per F1** : 10–15 generations, μ=3 λ=6 (≤ 100 evals
   per cell).

## Conservative M2 Budget Estimate

| Axis | Value |
|---|---|
| Archetype cells | 4 (branded, ryzeal, snake-eye, mitsurugi) |
| Fixtures per cell | 2–3 |
| Evals per cell | ~100 (μ=3 λ=6 × 10 gen, + 10 bootstrap) |
| Per-eval wall | 30 s × fixtures_per_cell = 60–90 s |
| Total wall | 4 cells × 100 evals × 90 s = **10 h** |

If the plateau finding (F1) generalises beyond tier-A, per-cell generations
can drop to 5–8 and total budget to ~5 h.

## Artefacts

| File | Purpose |
|---|---|
| `regression-untuned.json` | untuned 15-fixture snapshot (30 s / 200-node) |
| `regression-tuned.json` | M1-weights 15-fixture snapshot, same config |
| `regression-untuned.log` / `regression-tuned.log` | stripped stdout logs |

## Decision Point

Before committing M2 compute, two open questions for user alignment :

1. **Train at production budget (60 s / eval)** — costly (~10 h) but
   directly actionable weights. Versus train at short budget (4 s) —
   fast, but F4 says the lift evaporates at production time.
2. **MAP-Elites cells vs isolated per-archetype runs** — cells require the
   full MAP-Elites infrastructure (cell grid, boundary archive, novelty
   tracker). Isolated runs are simpler: one `train-graph-weights.ts` call
   per archetype, 4 independent weight files. Simpler, less research-grade,
   but answers "do archetype-specific weights work at all ?" without
   committing to the full M2–M5 framework.

Option 2 is the minimum-viable M2 pivot ; option 1 is the roadmap-intended
M2. Recommend option 2 first (falsifies or confirms the per-archetype
approach in ~2 h), then commit to option 1 only if the result is
positive.
