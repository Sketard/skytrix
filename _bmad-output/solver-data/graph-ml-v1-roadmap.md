# Graph-Guided ML v1 — Roadmap (2026-04-24)

**Mirror of** `memory/project_graph_ml_v1_roadmap_2026_04_24.md`. Synced at every milestone boundary for git traceability.

Research project : self-play learning of grammar baselines via CMA-ES + MAP-Elites on effect-level dependency graph. 5 milestones, abort-anywhere design. Replaces hand-tuning (falsified via Secreterion POC 2026-04-24).

---

## Current Status

**Active milestone**: M1 — Learning loop (partial, ~40% done)
**Last update**: 2026-04-24 (session handoff to fresh context)
**Next action**: create `src/solver/graph-weights-loader.ts`, then `transition-observer.ts`, then `fitness-evaluator.ts`, then `train-graph-weights.ts`, then first training run.

### M1 files done (committed)
- ✅ `src/solver/graph-weights-types.ts` — shared schema
- ✅ `scripts/lib/weight-persistor.ts` — I/O + vector pack + `migrateWeightsToEdgeSet` (graph-evolution tolerance)
- ✅ `scripts/lib/evolution-strategy.ts` — (μ+λ)-ES with 1/5 rule sigma adaptation (in-repo, no dep)
- ✅ `src/solver/graph-guided-ranker.ts` — plug-in ranker wrapping GoldfishChainRanker
- ✅ `data/trained-weights/edges-all.json` — 926 edges regenerated
- ✅ `npm run build` green

### M1 files pending
- ⏳ `src/solver/graph-weights-loader.ts` — boot-time loader for solver-worker
- ⏳ `src/solver/transition-observer.ts` — v2 enrichment prep, JSONL logger
- ⏳ `scripts/lib/fitness-evaluator.ts` — DFS → composite reward
- ⏳ `scripts/train-graph-weights.ts` — CLI entry
- ⏳ First training run on branded tier-A
- ⏳ M1 checkpoint vs abort criteria

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
