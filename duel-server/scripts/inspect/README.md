# `scripts/inspect/` — Inspection, diagnostics, and ad-hoc analysis

Read-only tools for understanding what's in the data, what the solver did,
and how cards work. None of these write to production state.

## Card oracle

- **`get-card-info.ts`** — print a card's text + interruption tags + verb
  index entry. First stop when investigating mechanics.
- **`dump-card-text.ts`** — bulk-dump card oracle text from `cards.cdb`.
- **`dump-card-attrs.ts`** — bulk-dump card type/attribute/level/atk/def.
- **`extract-card-effects.ts`** — pull effect entries from the
  card-effects-catalog.
- **`extract-link-arrows.mjs`** — link-monster arrow extraction.

## Deck

- **`index-deck.ts`** — sanity-check a fixture's deck (counts, banlist,
  duplicates).

## Trajectory analysis

- **`inspect-trajectory.ts`** — pretty-print a single trajectory dump.
- **`compare-trajectories.ts`** / **`trajectory-diff.ts`** — diff two
  trajectories step-by-step.
- **`inspect-idlecmd-stream.ts`** — extract just SELECT_IDLECMD prompts
  from a trajectory; useful when comparing PvP vs solver decision points.

## Eval & solver post-mortem

- **`investigate-structural.ts`** — drill into a single fixture's solve.
- **`compare-eval-runs.mjs`** — diff two `evaluate-structural` baseline
  files.
- **`count-chain-distribution.mjs`** — chain-link distribution stats.
- **`analyze-pathbeta-v2.ts`** — Path β v2 batch result analyzer.
- **`analyze-trajectory-patterns.ts`** — heuristic pattern miner over
  trajectory dumps.
- **`trace-assist.ts`** — interactive OCG trace debugger.
- **`dump-replay-events.ts`** — print the event stream from a replay.

## Status

Ad-hoc utilities. None are wired into CI; some have evolved out of one-off
investigations. Don't expect strict argument schemas — read the file's
top-of-file comment for usage.
