# Phase A consolidation — v5 retrain under Phase A active

**Status:** NEGATIVE RESULT 2026-04-26. v5 retrain on 3 seeds confirms the
6/8 branded ceiling at nb=200 is structural (search-bound), not weight-bound.
**Decision: keep v4 as production `tier-a-latest.json`. Ship Phase A as default
runtime config.** Cross-fixture transfer regressions on all 3 v5 seeds rule
out edge-weights retraining as a path forward; next lever is Phase B
(graph-ml-v2 = neural-ranker-via-ES) which replaces per-edge weights with a
small MLP on state features.

## Hypothesis tested

After Phase A shipped (+11 untuned / +14 with v4 cum matched), the
`tier-a-latest.json` weights were trained on 2026-04-25 under the OLD
fitness landscape (no implicit goals). Hypothesis: retraining v5 with
`SOLVER_IMPLICIT_GOALS=1` active during ES would shift the fitness
landscape (β·explorationScore now includes implicit goal points)
toward weights that bias DFS to expectedBoard-aligned states, lifting
cum matched beyond 28.

## Setup

3 ES runs on `branded-dracotail-opener` with Phase A active during training:
```
npx tsx scripts/train-graph-weights.ts \
  --fixture=branded-dracotail-opener --tier=A \
  --generations=50 --mu=5 --lambda=10 \
  --budget-ms=3000 --node-budget=200 \
  --seed={42,7,11} --implicit-goals=10 \
  --basename=tier-a-phase-a-v5-seed{42,7,11}
```

## Training observations

All 3 seeds report **baseline matched=6/8 at weights=0** — the 6/8 ceiling
at nb=200 is hit naturally without any ranker bias. ES exploration
plateaued early:

| Seed | Final fitness | Lift over baseline | Final σ | gens at σ_floor |
|---|---|---|---|---|
| 42 | 303.606 | +0.030 | 0.050 | 35 |
| 7 | 303.559 | +0.046 | 0.050 | 25 |
| 11 | 303.560 | +0.046 | 0.186 | 0 |

The fitness landscape is essentially FLAT around the 6/8 plateau at this
budget — ES can't push toward 7/8 because the search budget doesn't
reach those terminals. σ collapsed to the floor in 2/3 seeds, indicating
ES gave up exploring.

## Cross-fixture eval (vs current `v4 + Phase A` ship)

Canonical: `--budget-ms=3000 --node-budget=200 --pool-size=1 --implicit-goals=10`.

| Config | cum matched | branded | mitsurugi | spright | typhoon | yummy | mirrorjade |
|---|---|---|---|---|---|---|---|
| **v4 + Phase A (ship)** | **28/69** | 5/8 | **3/5** | **3/4** | **1/3** | **2/7** | 2/6 |
| v5 seed=42 + Phase A | 27 (-1) | **6/8** | 1/5 (-2) | 2/4 (-1) | 1/3 | 2/7 | **3/6 (+1)** |
| v5 seed=7 + Phase A | 24 (-4) | **6/8** | 1/5 (-2) | 2/4 (-1) | 0/3 (-1) | 1/7 (-1) | 2/6 |
| v5 seed=11 + Phase A | 23 (-5) | **6/8** | 1/5 (-2) | 2/4 (-1) | 0/3 (-1) | 1/7 (-1) | 1/6 (-1) |

Each v5 seed fixes the audit-1 on branded primary (+1 → 6/8) but loses
2-5 matches on cross-fixture transfer. All seeds destroy the v4 cross-
fixture wins on ryzeal-mitsurugi (the long-standing cross-fixture
regression v4 fixed) and spright.

**Best v5 (seed=42) is still 1 match below v4** in cum matched — net
negative.

## Why retraining failed

**v4's cross-fixture wins were lucky transfers.** v4 was trained on the
old (no-Phase-A) fitness landscape; its weights happened to pin DFS
toward states that generalized well to mitsurugi/spright/typhoon. The
old fitness rewarded `goalMatchPoints` (now-deprecated metric per audit
F1), which weighted these cross-fixture states.

v5's new fitness rewards `explorationScore` (= interruption + latent +
now implicit goals). On `branded-dracotail-opener`, this fitness is
maximized by weights that pin to the local 6/8 terminal — but these
weights don't generalize. ES finds a local optimum on the training
fixture and overfits.

**Single-fixture training is the root cause.** A multi-fixture training
loop (per [graph-ml-v1-roadmap-2026-04-24](../../memory_proxy_only)
F4 finding) would explicitly reward cross-fixture coverage, but at
1038-dim weights this is sample-inefficient (audit F6).

## Decision

1. **Keep v4** (`tier-a-latest.json`, trained 2026-04-25 seed=42) as
   production weight. Don't promote any v5 seed.
2. **Ship Phase A as default runtime** when running eval — the +14 lift
   is real and reproducible. Document
   `SOLVER_IMPLICIT_GOALS=1 SOLVER_IMPLICIT_GOALS_WEIGHT=10` (or
   `--implicit-goals=10` CLI flag) in methodology.md.
3. **Pivot to Phase B** for further lift. Per
   [solver-ml-strategic-direction](../../memory_proxy_only) RE-REVISION
   2026-04-26: graph-ml-v2 = neural-ranker-via-ES replaces per-edge
   weights (1038 dims) with a small MLP (50-200 dims) consuming a state
   feature vector. Expected to address F4 (cross-fixture transfer) by
   construction — features generalize across decks while edge weights
   don't.

## What this rules out

- **Pure edge-weight retraining as a Phase A consolidation step.** Tested
  3 seeds under Phase A; all regress.
- **Single-fixture training as a path to cross-fixture lift.** This was
  already known per F4; v5 retrain confirms it on the new fitness
  landscape.
- **σ-driven exploration breaking the 6/8 ceiling.** σ collapsed to floor
  on 2/3 seeds; the landscape is flat at the budget-bound ceiling.

## Files (kept for forensic reference; not shipped)

- `data/trained-weights/tier-a-phase-a-v5-seed{42,7,11}.json` — final
  weights (do NOT promote to `tier-a-latest`).
- `data/training-logs/tier-a-phase-a-v5-seed{42,7,11}-seed{N}-{stamp}/` —
  population.jsonl + mutations.jsonl for post-hoc forensics.
- `_bmad-output/solver-data/phase-a/eval-v5-seed{42,7,11}.json` — eval
  results.

## Open questions for Phase B

1. **State feature representation** — what features does the MLP consume?
   The 18-zone × 1k-card state is huge; need a compact, domain-aware
   encoding. Candidates: zone-bucketed counts, archetype-tagged presence
   bits, ED-pool composition vectors, hand-tutor co-presence bits.
2. **Multi-fixture training loop** — N fixtures, average fitness across,
   prevent overfitting. Cost: N× per-eval wall time.
3. **MLP architecture** — graph-ml-v2 doc per memo: 50-200 dims, single
   hidden layer probably enough at this scale. ONNX export → onnxruntime-
   node for production inference.
4. **Should Phase A be default-on in solver-worker.ts production**?
   Currently eval-only since prod has no `expectedBoard`. Consider whether
   "training-time `expectedBoard`" can be reused as `preferredSearchTargets`
   prior in production via a different mechanism.
