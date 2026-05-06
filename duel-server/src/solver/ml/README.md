# `src/solver/ml/` — Machine learning ranker layer (opt-in)

Decorator rankers and weight loaders gated on env flags. When all flags are
off (production default), the pipeline falls back to plain
`RouteAwareRanker(GoldfishChainRanker(...))` — no ML overhead.

## Layout

### Pipeline (single source of truth)

- **`ranker-pipeline.ts`** — `RankerPipeline` class. Owns the decorator stack
  composition (Goldfish → RouteAware → Neural|Graph → Policy → PathBiased)
  and per-fixture wiring (cardMetadata, mainDeck, extraDeck, expertise).
  Both `solver-worker.ts` and `scripts/eval/evaluate-structural.ts` boot
  the pipeline once, then call `pipeline.configurePerFixture(ctx)` per solve.
- **`weight-loader-base.ts`** — generic `createWeightLoader<T>(cfg)` factory.
  Absorbs the boot recipe (env-flag check → file existence → JSON parse →
  schema validate → trace → console.warn). Three concrete loaders below
  are ~25-line declarative configs.

### Rankers + their loaders

| Ranker | Files | Env flag | Role |
|--------|-------|----------|------|
| **Graph-guided** (graph-ml-v1) | `graph-guided-ranker.ts` + `graph-weights-{loader,types}.ts` | `SOLVER_USE_TUNED_WEIGHTS=1` | Soft-bias from learned per-edge weights over the mechanical dependency graph. |
| **Neural** (graph-ml-v2 / Phase B) | `neural-ranker.ts` + `neural-weights-loader.ts` | `SOLVER_USE_NEURAL_WEIGHTS=1` | Linear or MLP forward pass over a 95-dim deck-agnostic feature vector. |
| **Policy-guided** (Phase 3 Stage 3b) | `policy-guided-ranker.ts` + `verb-policy-loader.ts` + `verb-policy.ts` | `SOLVER_USE_VERB_POLICY=1` | Verb-class classifier providing move-ordering prior at `SELECT_IDLECMD`. |
| **Path-biased** (Levier B) | `path-biased-ranker.ts` | `SOLVER_USE_PATH_RANKER=1` | Per-decision boost on cards in `archetype-expertise.pathCards` not yet activated this turn. |

### Shared

- **`state-feature-extractor.ts`** — 95-dim state + 21-dim action feature
  extractor with hard-fail version hash. Consumed by neural and policy
  rankers; see `computeFeatureSpecHash()` for the version contract.

## Composition

```
PathBiasedRanker?(           # outermost — env-gated
  PolicyGuidedRanker?(       # env-gated
    NeuralFeatureRanker      # XOR (neural wins when both set)
    | GraphGuidedRanker      #
    | (none) (
      RouteAwareRanker(GoldfishChainRanker(...))
    )
  )
)
```

Mutual exclusion of Neural and Graph is enforced at boot in `RankerPipeline`
(neural loaded first; graph only attempted if neural is off).

## Trained weights

Under `data/trained-weights/` (44 files, ~17 MB, gitignored). Default
basenames: `neural-tier-a-latest`, `tier-a-latest`, `verb-policy-latest`.
Override via `SOLVER_*_WEIGHTS_FILE` env vars.

No manifest / version field — basename is the sole identifier. If you
regenerate with breaking schema changes, rename the file. The
`weight-loader-base.ts` factory throws loudly on schema mismatch (caught
Phase B's silent-fallback wiring bug).

## Status

Most ML pilots ran NULL or marginal lift in 2026-04 / 2026-05. The layer
is preserved as an experimental sandbox — refactored 2026-05-05 (Option A,
commit 05f687d8) for cleanliness:

- Generic loader factory replaced 3× 72-line duplicates
- `RankerPipeline` unified composition + per-fixture wiring across
  `solver-worker.ts` and `evaluate-structural.ts`
- Net: −160 LOC, bit-exact preserved

Skipped P2 (composition order schema with declarative mutual exclusions)
per the audit — over-engineering for 4 rankers; revisit when a 5th arrives.

See `_bmad-output/solver-data/ml-refactor-audit-2026-05-05.md` for the
audit memo, and memory entries `graph-ml-v1-*`, `phase-b-*`, `arch-c-*`
for historical context.
