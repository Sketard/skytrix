# `scripts/replay/` — Plan-replay & raw-replay tooling (Path β core)

The "replay" family is what makes Path β work. These tools take a plan
(human-authored or LLM-generated) or a raw OCG response sequence, run it
through OCGCore, and report the resulting endboard match.

## Plan-replay (LLM workflow)

### `replay-trajectory-cli.ts` — main authoring tool

Takes a `plan-replay.json` (verb + targets per step) and replays it
mechanically through the OCG harness. Supports `mechanicalOverrides[]` for
pinning sub-prompt picks.

```bash
npx tsx scripts/replay/replay-trajectory-cli.ts \
  --fixture-id=<fixture> \
  --plan=path/to/plan.json \
  --out=path/to/result.json
```

Result reports `matched / matchedTotal`, missing endboard cards, the
trajectory's prompt count vs the canonical replay (compression factor).

### `replay-trajectory.ts`

Internal library powering `replay-trajectory-cli.ts`. Re-exposed for ad-hoc
use; usually you want the CLI.

## Raw-replay (PvP-derived ground truth)

### `raw-replay-verify.ts`

Replays a captured `.raw-replay.json` (272+ raw OCG responses from a real
PvP duel) directly through OCGCore and reports endboard match against a
fixture's `expectedBoard`. Falsifies "structural ceiling" claims —
if the raw replay hits N/N, the harness can reach it; the gap is search-side.

```bash
npx tsx scripts/replay/raw-replay-verify.ts \
  --raw-replay=<path-to-.raw-replay.json> \
  --fixture-id=<fixture-id>
```

### `replay-file-to-fixture.ts` / `replay-to-fixture.ts`

Converts a raw replay into a fixture (deck list + 4-bigint seed + drawn
hand + expectedBoard). `replay-file-to-fixture.ts` reads a local `.raw-replay.json`;
`replay-to-fixture.ts` fetches from the dev API.

### `raw-replay-to-trajectory.ts`

Companion analysis tool: extracts the prompt-decision sequence from a raw
replay for human inspection.

## Fixture utilities

- **`dump-fixture-context.ts`** — print a fixture's deck/hand/expectedBoard
  in markdown. Used during Path β bootstrap so the LLM has the context.
- **`verify-fixture-replay-coherence.ts`** — audit whether a fixture's
  authored hand matches what its seed would draw (exposes seed-truncation
  bugs).
- **`record-trajectory.ts`** — capture a DFS-discovered mainPath as a hint
  file for canonical-path forcing.

## Status

Stable production tooling. All Path β workflows go through this folder.
See `_bmad-output/solver-data/path-beta-methodology.md` for the full
playbook.
