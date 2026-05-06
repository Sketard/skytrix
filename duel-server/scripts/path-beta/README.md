# `scripts/path-beta/` — Mechanical companions for Path β

Brute-force enumeration tools that complement LLM-authored plans.
Deterministic, $0, ~30s-2min wall — used to validate that an LLM-claimed
local-optimum really is one.

## `enumerate-skip.ts`

Tests every single-step and pair-step removal from a base plan. If a
variant ≥ baseline matched, the LLM was wrong about the ceiling.

```bash
npx tsx scripts/path-beta/enumerate-skip.ts \
  --fixture-id=<fixture> \
  --base-plan=path/to/best-plan.json \
  --out-dir=data/path-beta-poc/<fixture>/enumerate-skip/ \
  [--combo-depth=2]
```

Interpretation:
- All variants ≤ baseline → empirical local-optimum confirmed
- One variant > baseline → LLM missed; re-author
- Multiple ties at baseline → step was redundant; ship the simpler

## `enumerate-pivot.ts`

Tests substituting a single step's `cardId` (target) for each legal
alternative at that prompt. Surfaces "the LLM picked Card A but Card B
gets the same matched count" — letting you ship the simpler / cheaper
plan.

## `enumerate-edges.ts`

graph-ml-v1 dependency-graph enumeration tool. Used during the M1
research phase. Less actively used now but kept for graph audits.

## Status

Stable. The skip/pivot pair is the official mechanical companion to
the Path β methodology.
