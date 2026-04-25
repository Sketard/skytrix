# graph-ml-v1 — operational methodology

Version: 2026-04-25 (post-audit ship of v3 weights)

## Quick reference

| What | How |
|---|---|
| Production weights | `duel-server/data/trained-weights/tier-a-latest.json` |
| Enable in solver | `SOLVER_USE_TUNED_WEIGHTS=1` (env var, opt-in) |
| Pin a specific file | `SOLVER_TUNED_WEIGHTS_FILE=<basename>` (file under `data/trained-weights/`, no `.json`) |
| Training script | `scripts/train-graph-weights.ts` |
| Evaluation script | `scripts/evaluate-structural.ts` |
| Mutation analysis | `scripts/analyze-mutations.mjs` |

## Evaluation methodology — `--pool-size=1` is canonical

`evaluate-structural.ts` defaults to `pool-size = availableParallelism() - 2` (≈ 12 workers on a typical dev machine). Running 15 fixtures simultaneously creates **severe WASM memory and CPU contention**: each fixture's DFS gets only 10-25 nodes per 3s budget instead of 200+. This is a stress test, not a measurement of single-duel solver quality.

**For meaningful weight evaluation, always pass `--pool-size=1`.** Single-duel production usage (one solver run at a time) corresponds to the pool=1 measurement.

```bash
# Canonical evaluation invocation
cd duel-server
SOLVER_USE_TUNED_WEIGHTS=1 \
SOLVER_TUNED_WEIGHTS_FILE=tier-a-latest \
SOLVER_INSTRUMENT=1 \
npx tsx scripts/evaluate-structural.ts \
  --budget-ms=3000 --node-budget=200 \
  --pool-size=1 \
  --label=tier-a-latest \
  --out=../_bmad-output/solver-data/graph-ml-v1/eval-tier-a-latest.json
```

`--pool-size=12` evaluations are valid as **stress tests** (do trained weights survive contention?) but should never be used as the primary quality benchmark.

## Training methodology

### Composite reward

The fitness function combines four signals:

```
fitness = α · matched²  +  β · explorationScore  +  γ · novelty  +  ε · terminalBonus
```

Defaults: `α = 5.0`, `β = 1.0`, `γ = 0.001`, `ε = 2.0` (see `fitness-evaluator.ts`).

- `matched²` rewards the discrete event of landing each `expectedBoard` card on the peak turn-1 field. Squared so the marginal value rises with each additional match (1 → 4 → 9 → ...).
- `explorationScore` is the production-aligned shaping metric (= `interruptionScore + latentPoints`). **Replaced `goalMatchPoints` after the 2026-04-25 audit revealed the latter was gameable** (ES could inflate goalMatch without producing matches, while production interruption score collapsed).
- `novelty` is `nodesExplored − transpositionHits` — small bonus to prefer wider over deeper search.
- `terminalBonus` rewards clean DFS completion (vs timeout / abort).

### ES hyperparameters

(μ+λ) Evolution Strategy with 1/5 success rule (Rechenberg). Sensible defaults:

```bash
npx tsx scripts/train-graph-weights.ts \
  --fixture=<fixtureId> \
  --tier=A \
  --generations=50 --mu=5 --lambda=10 \
  --budget-ms=3000 --node-budget=200 \
  --seed=42 \
  --basename=<output-name>
```

`sigmaMin = 0.05` (raised from 1e-4 in 2026-04-25 audit F2): prevents σ from collapsing below numerical-noise level when the ES hits a flat plateau. Without this floor, the last 20 generations of a typical run are wasted at σ ≈ 0.002.

### Trace artefacts

Every training run writes three files under `data/training-logs/<basename>-seed<N>-<ISO>/`:

- `meta.json` — run config + `edgeIdsOrdered[]` (vector index → EdgeId map). **Critical for post-hoc decoding of `deltas[]`.**
- `population.jsonl` — one line per individual per generation (parents + offspring), with vectors.
- `mutations.jsonl` — one line per offspring with parent → child Δfitness, deltas, survivedAsParent flag.

Pass `--no-trace` to disable (training still works; you lose forensic artefacts).

## Post-hoc analysis

### Mutation forensics

```bash
node scripts/analyze-mutations.mjs                       # auto-pick latest run
node scripts/analyze-mutations.mjs <traceDir> --top=10 --json=report.json
```

Three views:
1. **Per-gen survivor stats** (acceptance rate, σ, mean ΔFit accept vs reject) — diagnoses σ calibration and learning plateau.
2. **Top-K worst rejects + best accepts** — concrete examples with the 3 edges whose perturbation magnitude was largest. "This mutation tanked because it slammed edge X by Δ=+1.8."
3. **Per-edge Pearson corr(Δ_edge, ΔFit)** — fragile vs learning-aligned edges across all offspring.

### Per-fixture edge usage

```bash
SOLVER_USE_TUNED_WEIGHTS=1 \
SOLVER_TUNED_WEIGHTS_FILE=tier-a-latest \
SOLVER_INSTRUMENT=1 \
npx tsx scripts/evaluate-structural.ts \
  --budget-ms=3000 --node-budget=200 --pool-size=1 \
  --dump-edges-per-fixture=../_bmad-output/solver-data/graph-ml-v1/edges-tier-a-latest \
  --label=tier-a-latest-edges
```

Per fixture, dumps `<fixtureId>.json` with `byEdgeId[edgeId] = { hits, cumulativeContribution, weight }` and `cardsTouched[]`. Reveals which edges DFS actually traversed and how the trained weights biased ranking decisions.

Three behavioral classes typically emerge:
- **Zero overlap** (cumContribution = 0): no deck card matches `edge.from` of trained set
- **Accidental overlap** (edges visited but weight = 0): cards have edges in the *full* graph but outside the active subset
- **Real overlap**: trained weights apply; sumContribution can be strongly positive or negative

## What v4 weights deliver (apples-to-apples at pool=1)

v4 is the current production ship: 50 gens × λ=10 on `branded-dracotail-opener` under the **soft-bias additive ranker** (F8 fix). Trained weights are stored as `tier-a-branded-trace-v4.json` and copied to `tier-a-latest.json`.

| Metric | Untuned baseline | v3 (hard-flip) | **v4 (soft-bias)** |
|---|---|---|---|
| Cumulative score | 272.74 | 280.57 | **283.43** (+10.69 vs baseline, +3.9%) |
| Cumulative matched | 14/69 | 14/69 | **17/69** (+3 matched) |
| branded-dracotail (training) | 71.79 (4/8) | 63.36 (6/8) | 62.36 (5/8) |
| ryzeal-mitsurugi (cross) | 39.5 (1/5) | 43 (1/5) | **69 (3/5)** ← +29.5, +2 matched |
| spright (cross) | 9 (0/4) | 9 (0/4) | 10 (1/4) ← +1 matched |
| nekroz-ryzeal | 1 (0/4) | 15 (0/4) | 2 (0/4) |
| snake-eye-yummy | 23.24 (1/7) | 9 (0/7) | 18 (0/7) |
| radiant-typhoon | 12 (1/3) | 11 (0/3) | 12 (1/3) |
| branded-mirrorjade-line | 44.21 (1/6) | 59.21 (1/6) | 38.07 (1/6) |

**Headline**: v4 trades a few score points on the training fixture for **+3 matched cards across cross-fixture transfer** — primarily a +2 matched gain on ryzeal-mitsurugi (the long-standing cross-fixture regression). Net cumulative is the highest of any production weight version, including untuned baseline.

The soft-bias mechanism (default `baseRankScale = 30`, tunable via `SOLVER_BASE_RANK_SCALE` env) means trained weights nudge the base ranker's ordering instead of overriding it. v3 weights re-evaluated under the soft-bias ranker fall to cum=253.14 (-27 vs v3 hard-flip), so soft-bias semantics REQUIRE retraining — weights are not portable between regimes.

## Soft-bias ranker — operational notes

`GraphGuidedRanker.rank()` (post-F8 refactor):

```
final_score(action_i) = (N - i) × baseRankScale + graphBonus(action_i)
```

Where `i` is the action's position in the base ranker's output and `N` is the total action count. Per-position cost is `baseRankScale = 30` by default. A typical trained-weight bonus (one edge × weight 0.3 × scale 100 = 30) buys roughly 1 swap.

A/B testing knobs:
- `SOLVER_BASE_RANK_SCALE=0` — recovers prior hard-flip behavior (graph bonus alone determines order)
- `SOLVER_BASE_RANK_SCALE=1000` — graph bonus near-no-op (sanity check during retraining)
- `SOLVER_GRAPH_SCALE=N` — overall bonus magnitude scaler (default 100)
