# Graph-Guided ML v1 — Roadmap (2026-04-24)

**Mirror of** `memory/project_graph_ml_v1_roadmap_2026_04_24.md`. Synced at every milestone boundary for git traceability.

Research project : self-play learning of grammar baselines via CMA-ES + MAP-Elites on effect-level dependency graph. 5 milestones, abort-anywhere design. Replaces hand-tuning (falsified via Secreterion POC 2026-04-24).

---

## Current Status

**Active milestone**: M1 PASSED ; regression gate exposed F4+F5 ; M2 scope clarified, **awaiting user decision** on path.
**Last update**: 2026-04-25 (15-fixture regression gate run, 3 regressions identified)
**Next action**: user alignment on M2 path — option A (minimum-viable per-archetype isolated runs at production budget, ~2 h) vs option B (full MAP-Elites framework, ~10 h). See `findings-m1-regression-gate.md` decision point.

### M1 Verdict — Branded tier-A (50 gen, μ=5 λ=10, 4s / 200-node eval)

| Metric | Value |
|---|---|
| Baseline fitness (weights=0) | 44.068 |
| Final best fitness | 55.194 |
| Lift vs baseline | **+25.2 %** ✅ (threshold +20 %) |
| Parent-mean lift (gen 1 → gen 50) | +10.3 % |
| Regression on training fixture | 0 % (lift only) ✅ |
| Convergence | plateau at gen ≈ 5, σ→0.008 by gen 50 ✅ |
| `goalMatchPoints` lift | +11.07 (workhorse term) |
| `matched` / 8 | 0 / 8 (wall-clock ceiling, not ranking) |

Full findings : `_bmad-output/solver-data/graph-ml-v1/findings-m1-branded-tier-a.md`.
Convergence CSV : `_bmad-output/solver-data/graph-ml-v1/metrics-m1-branded-tier-a.csv`.

### Key M1 Findings (transferable)

1. **F1 — tier-A converges in ~5 gens**. 50-gen default is overkill for single-fixture tier-A. Drop to 15-20 in M2 tooling.
2. **F2 — Population diversity collapses without pressure** (std: 4.685 gen 1 → 0.011 gen 2 → < 0.003 through gen 50). Quantitative motivation for MAP-Elites in M2.
3. **F3 — `matched²` is wall-clock-gated, not ranking-gated** on branded. +25 % lift was entirely from `goalMatchPoints`. M2+ : longer budgets, simpler fixtures, or accept sparse `matched²`.
4. **F4 (2026-04-25, regression gate) — Training-budget specificity**. Tuned weights gave +25 % at training budget (4 s) but **zero improvement at production budget (30 s)** on branded. M2 must train at production budget ⇒ ~10× cost vs M1 tooling.
5. **F5 (2026-04-25, regression gate) — Single-fixture training overfits**. Branded-only weights caused 3 hard regressions (ryzeal −94 %, horus −88 %, snake-eye −49 %) when cross-applied. Single-pop single-fixture is falsified as a production strategy ; M2 must use archetype cells OR isolated per-archetype loops.

### M1 files done
- ✅ `src/solver/graph-weights-types.ts` — shared schema
- ✅ `scripts/lib/weight-persistor.ts` — I/O + vector pack + `migrateWeightsToEdgeSet` (graph-evolution tolerance)
- ✅ `scripts/lib/evolution-strategy.ts` — (μ+λ)-ES with 1/5 rule sigma adaptation
- ✅ `src/solver/graph-guided-ranker.ts` — plug-in ActionRanker wrapper; setWeights() API
- ✅ `src/solver/graph-weights-loader.ts` — boot-time loader gated on `SOLVER_USE_TUNED_WEIGHTS=1`; optional `SOLVER_TUNED_WEIGHTS_FILE` basename
- ✅ `src/solver/transition-observer.ts` — JSONL logger gated on `SOLVER_OBSERVE_TRANSITIONS=1` (scaffold only — not yet wired into ranker; M2/E4 task)
- ✅ `scripts/lib/fitness-evaluator.ts` — composite reward `α·matched² + β·partial_goals + γ·novelty + ε·terminal_bonus`
- ✅ `scripts/train-graph-weights.ts` — CLI with tier filter (confidence proxy), mask-aware packer, checkpoints, CSV out
- ✅ `solver-worker.ts` — opt-in `GraphGuidedRanker` wrap, zero-diff when env var off
- ✅ Smoke run (branded tier-A, 1 gen, μ=2 λ=3, 3s, 100-node cap): baseline 44.007 → 46.545 (+2.538 fitness, +2.50 goalMatch). Loop end-to-end validated.
- ✅ `npm run build` green

### M1 pending
- ⏳ Real 50-gen convergence run on branded tier-A:
  `SOLVER_INSTRUMENT=0 npx tsx scripts/train-graph-weights.ts --fixture=branded-dracotail-opener --tier=A --generations=50 --mu=5 --lambda=10 --budget-ms=4000 --node-budget=200 --csv=../_bmad-output/solver-data/graph-ml-v1/metrics-m1-branded-tier-a.csv`
  Estimated ~35 min wall-time.
- ⏳ M1 checkpoint vs abort criteria (fitness mean +20% over 50 gen) + findings write-up

### M1 design notes (decided during plumbing)
- **Fresh TT per eval**: `FitnessEvaluator` rebuilds Zobrist+TranspositionTable per `evaluate()`. Stored sub-tree scores reflect action-ordering of the prior individual, so TT reuse contaminates fitness. JS alloc cost only.
- **Tier-A confidence proxy**: `edges-all.json` carries `confidence: 'high'|'medium'|'low'`; tier A=high (267 edges), B=+medium (629), C/full=all (926). Real bridge-tier classification lives in `_bmad-output/solver-data/candidate-bridges-tier-*.json` keyed by `bridgeId` (not edge id) — bridge→edge mapping is M2+ work.
- **Mask**: inactive edges stay at 0; ES only perturbs the active indices via `buildMaskedPacker`.
- **Matched signal**: `expectedBoard` match count against `bestTurn1FieldState`. On 3s budget smoke this was 0/8 for branded (fixture needs longer wall-clock). `goalMatchPoints` (partial_goals) is what moves in short-budget runs.
- **Artifacts path**: `data/trained-weights/` is gitignored — training outputs are local-only. Production deploy of trained weights is a separate step (copy into env).

---

## Motivation

POC 2026-04-24 (see memory `project_secreterion_goal_poc_2026_04_24.md`) falsified "hand-tuning a single goal baseline can redirect DFS". Manual grammar curation is not scaling — 15 fixtures × ~10 goals = 150+ hand-tuned parameters. This v1 explores self-play learning : the solver generates its own training data by running fixtures, CMA-ES optimizes edge weights on the mechanical dependency graph (from `enumerate-edges.ts`), MAP-Elites preserves archetype-specialist diversity.

Philosophy (from design session) : we have a graph, we have no external training data, brute-force is intractable. Prune via graph topology + weighted edges, learn weights via reward-driven evolution, enrich graph offline between sessions (v2).

---

## Locked Decisions (design session 2026-04-24)

| Axis | Choice | Rationale |
|---|---|---|
| Reward | `α×matched² + β×partial_goals + γ×novelty + ε×terminal_bonus` | Dense gradient + non-linear matched + novelty escapes plateaus. Interruption coverage EXCLUDED (avoids scorer circularity). |
| Algorithm | Evolution Strategy + graph-aware crossover + MAP-Elites | Non-differentiable reward → evolutionary. Crossover respects archetype substructure. MAP-Elites preserves specialists. **M1 starts with (μ+λ)-ES in-repo** (~100 LOC, no external dep). CMA-ES upgrade at M2 if sample efficiency matters. |
| Granularity | Effect-level | Matches `enumerate-edges.ts` output. Card-level loses signal (different effects of same card have distinct roles). |
| Tier strategy | A → B → C → full | Start 30 edges, expand progressively. Avoids high-dim cold-start. |
| Enrichment | E1 v1 (fixed), E4 target v2 | CMA-ES dim churn risky v1. Observer logs transitions for offline promotion later. |
| Hold-out | H1+H4 : 9 actionable train, all 15 regression gate, 6 ceiling-bound sentinels | 15 fixtures too few for rigorous generalization; focus regression safety. |
| Threshold | -10% | Research mode; production would be -5%. |
| Scope | L3 (M1-M5), research-grade | Full framework. Abort at milestone checkpoints if criteria fail. |
| Infra | Plug-in ranker (wraps existing) | Zero refactor. Training offline, weights loaded at boot. |

---

## Architecture

```
duel-server/
├── scripts/
│   ├── train-graph-weights.ts        # M1 — main CLI
│   └── lib/
│       ├── cma-es-wrapper.ts         # M1
│       ├── map-elites-grid.ts        # M2
│       ├── graph-aware-crossover.ts  # M3
│       ├── novelty-tracker.ts        # M3
│       ├── fitness-evaluator.ts      # M1
│       ├── weight-persistor.ts       # M1
│       └── tier-manager.ts           # M4
│
├── src/solver/
│   ├── graph-guided-ranker.ts        # M1 — wraps GoldfishChainRanker
│   ├── graph-weights-loader.ts       # M1 — boots weights.json
│   └── transition-observer.ts        # M1 — logs for v2
│
└── data/
    ├── trained-weights/
    │   ├── tier-a-latest.json
    │   └── checkpoints/<timestamp>.json
    └── training-logs/
        └── transitions.jsonl
```

---

## Milestone Status

### M1 — Learning loop minimum viable
**Goal**: CMA-ES converges on tier-A, produces `weights.json` non-regressive on branded-dracotail-opener.

**Files to create**:
- `scripts/lib/cma-es-wrapper.ts`
- `scripts/lib/fitness-evaluator.ts`
- `scripts/lib/weight-persistor.ts`
- `src/solver/graph-guided-ranker.ts`
- `src/solver/graph-weights-loader.ts`
- `src/solver/transition-observer.ts`
- `scripts/train-graph-weights.ts`

**Metrics**: fitness curve, convergence time, weights distribution, delta vs baseline.

**Abort criteria**:
- ❌ Fitness mean doesn't rise +20% over 50 gen
- ❌ Regression > -30% on training fixture
- ⚠️ Convergence > 200 gen → review hyperparams

**Status**: pending
**Start**: —  **Complete**: —  **Checkpoint result**: —  **Commits**: —

### M2 — Population + MAP-Elites
**Goal**: 4 archetype cells with stable specialists.
**Abort**: inter-cell variance < 10%, or per-cell fitness < single-pop M1.
**Status**: pending

### M3 — Graph-aware crossover + novelty
**Goal**: population diversity maintained over 100+ gen.
**Abort**: novelty bonus no effect; crossover produces invalid individuals → fallback mutation-only.
**Status**: pending

### M4 — Tiered expansion
**Goal**: tier-A + tier-B combined without tier-A regression.
**Abort**: tier-B degrades tier-A > 15%, or tier-B marginal value null.
**Status**: pending

### M5 — Full validation
**Goal**: 15-fixture comparison table, findings documented.
**Success**: 3+ fixtures lifted > 15% without > 10% regression elsewhere.
**Abort (documented research)**: no fixture lifted > 10%.
**Status**: pending

---

## Findings Log

(Empty — populated as milestones complete.)

---

## Commits

(Empty — SHAs added as milestones ship.)

---

## Parallel Work

- **Parser v7** (`extract-card-effects.ts` upgrade) — separate session, zero ML-pipeline interaction. Grows catalog for future tier-C.
- **Transition observer log analysis** — scheduled v2 (E4 enrichment).

---

## Artifacts Location

- Training logs: `duel-server/data/training-logs/`
- Weights: `duel-server/data/trained-weights/`
- Metrics CSVs: `_bmad-output/solver-data/graph-ml-v1/metrics-<milestone>.csv`
- Memory roadmap (master): `memory/project_graph_ml_v1_roadmap_2026_04_24.md`
