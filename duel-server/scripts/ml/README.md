# `scripts/ml/` — ML training & weight-tuning (opt-in)

Training pipelines for the rankers in `src/solver/ml/`. None of these are
required for production; they were used in Phase 3 / Phase B / graph-ml-v1
R&D.

## Training scripts

### Neural (Phase B / graph-ml-v2)

- **`train-neural.ts`** — single-process evolution-strategy training of
  `NeuralFeatureRanker` weights (linear or MLP).
- **`train-neural-pool.ts`** — Piscina-pooled parallel ES training. Faster
  but uses more cores.
- **`train-neural-pre-flight.ts`** — small-budget smoke test before
  committing to a full overnight run.
- **`train-neural-worker.{ts,mjs}`** — Piscina worker for the pooled
  trainer.

### Graph weights (graph-ml-v1)

- **`train-graph-weights.ts`** — ES training of per-edge weights for
  `GraphGuidedRanker`.

### Verb policy (Phase 3 Stage 3b)

- **`train-verb-policy.ts`** — supervised classifier training on a labeled
  trajectory corpus.
- **`train-verb-policy-distilled.ts`** — KL-distillation variant from an
  LLM-annotated corpus (Architecture C).
- **`evaluate-verb-policy.ts`** — held-out eval of trained verb-policy
  weights.

### Other

- **`train-value-head-pilot.ts`** — AlphaZero-style value head pilot.
  Marginal lift, not integrated.
- **`tune-weights.ts`** — interruption-weight tuner (predates the ML
  rankers).
- **`cross-eval-weights.ts`** — cross-fixture transfer evaluation.
- **`extract-policy-training-data.ts`** — corpus extractor.
- **`hydrate-llm-annotations.ts`** — adds LLM annotations to a trajectory
  corpus.

## Shared library: `lib/`

- **`evolution-strategy.ts`** — generic ES optimizer used by the trainers.
- **`fitness-evaluator.ts`** — wraps `evaluate-structural` as a fitness
  fn.
- **`weight-persistor.ts`** — JSON read/write for trained weights.

## Trained weights

Trained outputs live at `duel-server/data/trained-weights/` (44 files,
~17 MB). To use a trained weight set in eval:

```bash
SOLVER_USE_NEURAL_WEIGHTS=1 \
SOLVER_NEURAL_WEIGHTS_FILE=<basename> \
  npx tsx scripts/eval/evaluate-structural.ts ...
```

## Status

R&D layer, not part of the production hot path. Most pilots ran NULL
or marginal — kept for future re-investment, not actively maintained.
