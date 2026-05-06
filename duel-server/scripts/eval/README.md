# `scripts/eval/` — Solver evaluation harness

Canonical-eval and baseline-capture tools. All run via `tsx`.

## Primary tool: `evaluate-structural.ts`

The 69-fixture canonical-eval harness. Spins up a Piscina worker pool, runs
each fixture's solve, computes `cumulativeMatched / cumulativeScore`,
optionally compares against a baseline file.

```bash
# Canonical eval at the locked v2 baseline (post-Option G, 2026-05-02):
SOLVER_USE_DFS_COMPRESSION=1 SOLVER_IMPLICIT_GOALS=1 \
  npx tsx scripts/eval/evaluate-structural.ts \
    --budget-ms=12000 --node-budget=800 --pool-size=14 \
    --label=baseline-check
```

Expected: `cumulativeMatched=31/69`, `cumulativeScore≈596`.

Useful flags:
- `--only=<fixture-id>` — single fixture
- `--label=<name>` — annotate the run for diff
- `--baseline=<file.json>` — compare against a saved baseline
- `--output=<file.json>` — save the run as a baseline
- `--use-hints` — load `<fixture>-hint.json` for canonical-path forcing

## Baseline capture: `capture-phase-1-baselines.ts`

Convenience wrapper that runs evaluate-structural at multiple flag-combos
and writes paired baselines for before/after comparisons. Used to validate
that a refactor preserves the cum-matched ceiling.

## Other tools

- **`evaluate-structural-worker.{ts,mjs}`** — Piscina worker. Not run
  directly; spawned by `evaluate-structural.ts`. The `.mjs` is the bootstrap
  that registers `tsx/esm` inside the worker thread.
- **`solver-validation-harness.ts`** — Drives the production solver-worker
  (via the compiled `dist/solver/solver-worker.js`). Used to sanity-check
  the prod pipeline outside of eval.
- **`audit-fixture.ts`** — Per-fixture deep-dive: dumps decisions,
  trajectory, state breakdowns. Used during fixture authoring.

## Status

Stable production tooling. `evaluate-structural.ts` is the source of truth
for any "does this regress?" check.
