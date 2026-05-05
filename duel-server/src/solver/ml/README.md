# `src/solver/ml/` — Machine learning ranker layer (opt-in)

Decorator rankers and weight loaders gated on env flags. When all flags are
off (production default), `solver-worker.ts` falls back to the plain
`RouteAwareRanker(GoldfishChainRanker(...))` chain — no ML overhead.

## Files

- **`graph-guided-ranker.ts`** + **`graph-weights-loader.ts`** + **`graph-weights-types.ts`** —
  graph-ml-v1 (Phase 3.0). Soft-bias from learned per-edge weights over the
  mechanical dependency graph. Gated by `SOLVER_USE_TUNED_WEIGHTS=1`.

- **`neural-ranker.ts`** + **`neural-weights-loader.ts`** —
  graph-ml-v2 / Phase B. Linear or MLP forward pass over a 95-dim deck-agnostic
  feature vector. Gated by `SOLVER_USE_NEURAL_WEIGHTS=1` + optional
  `SOLVER_NEURAL_WEIGHTS_FILE=<basename>`.

- **`policy-guided-ranker.ts`** + **`verb-policy-loader.ts`** + **`verb-policy.ts`** —
  Phase 3 Stage 3b. Verb-class classifier providing move-ordering prior at
  `SELECT_IDLECMD`. Gated by `SOLVER_USE_VERB_POLICY=1`.

- **`path-biased-ranker.ts`** —
  Levier B. Per-decision boost on cards in `archetype-expertise.pathCards` not
  yet activated this turn. Gated by `SOLVER_USE_PATH_RANKER=1`.

- **`state-feature-extractor.ts`** —
  Shared 95-dim state + 21-dim action feature extractor. Used by both neural
  and policy rankers.

## How rankers compose

In `solver-worker.ts` boot, the ranker stack is built outside-in:

```
PathBiasedRanker(
  PolicyGuidedRanker(
    NeuralFeatureRanker | GraphGuidedRanker | (none) (
      RouteAwareRanker(GoldfishChainRanker(...))
    )
  )
)
```

Each decorator is conditional on its env flag. `Neural` and `Graph` are
mutually exclusive (Neural wins). `Policy` and `Path` stack on top.

## Mental model

- **Production runtime** = no flags = plain `RouteAwareRanker`.
- **Eval / training** = flags on = ML rankers wrap the base chain.
- **Trained weights** live under `data/trained-weights/` (44 files, ~17 MB).

## Status

Most ML pilots ran NULL or marginal lift in 2026-04 / 2026-05. The layer is
preserved as an experimental sandbox — if you want to refactor or revive,
the plumbing is intact and decoupled from the core solver.

See memory entries `graph-ml-v1-*`, `phase-b-*`, `arch-c-*` and the
`_bmad-output/solver-data/` memos for historical context.
