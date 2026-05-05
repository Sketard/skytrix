# `scripts/archive/` — Dormant R&D scripts

Pilots, spikes, debug throwaways, and shell wrappers from past R&D
phases. Kept in-repo for reference but not actively maintained — many
will fail on first run because their assumptions (file paths, env flags,
fixture schemas) have drifted.

## Categories

### POC / spike (NULL pilots)

- `macro-dfs-poc.ts` / `evaluate-macro-dfs.ts` — macro-action compression POC
- `poc-wasm-snapshot.ts` / `bench-snapshot-{all,fork}.ts` — WASM snapshot fork experiments
- `calibrate-mcts.ts` — MCTS calibration
- `spike-empirical-validation.ts` / `spike-seed-hunter.ts` — early empirical
  validation spikes
- `capture-adversarial-baseline.ts` — adversarial baseline capture
- `llm-canonicalize-poc.ts` — LLM-driven canonical-path POC

### Probes (one-off audits)

- `probe-move-enum-audit.ts` — action enumeration audit
- `probe-structural-sanity.ts` — structural-value sanity check

### Diagnostics (obsolete)

- `diag-determinism.ts` — determinism check (now superseded by
  baseline diff)
- `diag-mvp-v3-features.ts` — MVP v3 feature drift diagnostic
- `diag-train-vs-eval.ts` — training-vs-eval baseline diff

### Debug throwaways

- `debug-fieldstate.ts` / `debug-solver.ts` — interactive debug helpers
- `diagnose-ip-block.ts` — networking diagnostic (unrelated to solver)

### Shell wrappers (overnight runs)

- `run-multi-seed-parallel.sh`
- `run-overnight-f1.sh` / `run-overnight-f2.sh`
- `watchdog-f2-takeover.sh`

### Misc one-off

- `audit-sweep-coverage.ts` — sweep coverage audit
- `backfill-fixture-positions.ts` — fixture migration helper
- `build-verb-index.ts` — initial verb-index build (now done at runtime)
- `validate-bridge.ts` — bridge validator (early Strategic Grammar)

## Status

Reference only. If you find yourself needing to revive one, expect to
patch its env-flag assumptions and fixture-schema expectations first.
