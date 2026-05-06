# `duel-server/scripts/` — solver tooling

All scripts run via `tsx` (`npx tsx scripts/<folder>/<file>.ts`). None are
wired into `npm run` (except `patch-ocgcore-wasm.mjs` via `postinstall`).

## Layout

| Folder | Purpose | Stability |
|--------|---------|-----------|
| [`eval/`](eval/) | Canonical-eval harness, baseline capture, fixture audit | Stable, production |
| [`replay/`](replay/) | Plan-replay & raw-replay tooling (Path β core) | Stable, production |
| [`path-beta/`](path-beta/) | Mechanical companions to Path β (skip / pivot enumeration) | Stable |
| [`inspect/`](inspect/) | Read-only diagnostics, card oracle, trajectory analysis | Stable, ad-hoc |
| [`ml/`](ml/) | ML training & weight-tuning (opt-in, R&D layer) | Experimental |
| [`archive/`](archive/) | Dormant R&D scripts (NULL pilots, debug throwaways) | Reference only |

## Root

- **`patch-ocgcore-wasm.mjs`** — npm `postinstall` hook. Patches the
  `ocgcore-wasm` package after install to expose internal symbols the
  solver needs. Don't move.

## Where to start

- **"I want to run the canonical eval"** → [`eval/README.md`](eval/README.md)
- **"I want to author a Path β plan"** → [`replay/README.md`](replay/README.md)
- **"I want to look up a card"** → [`inspect/README.md`](inspect/README.md)
- **"I want to retrain ML weights"** → [`ml/README.md`](ml/README.md)
