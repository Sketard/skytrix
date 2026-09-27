# Solver R&D Log

**Status:** R&D paused 2026-05-05. Repo cleanup shipped (commits 91a81ddd→fe657389). Bit-exact preserved (branded 5/8, snake-eye 3/7).

This file is the **single index** for solver R&D. Anything not listed here lives in `_archive-paused-2026-05-05/` for historical context only.

## Live references (read these first when resuming)

| File | Purpose |
|---|---|
| [`path-beta-methodology.md`](path-beta-methodology.md) | Methodology playbook — how Path β works (LLM subagent + plan-replay CLI). Reproducible recipe. |
| [`option-g-canonical-bump-2026-05-02.md`](option-g-canonical-bump-2026-05-02.md) | **Canonical baseline v2**: `--budget-ms=12000 --node-budget=800` + DFS_COMPRESSION ON + IMPLICIT_GOALS=10. Cum 31/69 596. |
| [`path-beta-v2-aggregate-2026-05-03.md`](path-beta-v2-aggregate-2026-05-03.md) | Last R&D state before pause. Cum 22/50 → 39/50 (+17 matched) on 11 audited fixtures. Largest sustained ML-R&D lift to date. |
| [`ml-refactor-audit-2026-05-05.md`](ml-refactor-audit-2026-05-05.md) | Audit of the ML layer Option A refactor (generic loader factory + RankerPipeline). Last touch before pause. |
| [`graph-ml-v1-roadmap.md`](graph-ml-v1-roadmap.md) + [`graph-ml-v1/`](graph-ml-v1/) | Long-term ML roadmap. Soft-bias ranker is the default. |

## Live references (operational)

| File | Purpose |
|---|---|
| [`interruption-tag-generation-prompt.md`](interruption-tag-generation-prompt.md) | Prompt template for adding/revalidating cards in `duel-server/data/interruption-tags.json`. Active workflow — see CLAUDE.md "Solver Interruption Tags Generation" section. |
| [`cards-cdb-hex-reference.md`](cards-cdb-hex-reference.md) | Reference for the cards.cdb SQLite hex schema. Read when working with `duel-server/data/cards.cdb`. |
| [`card-effects-catalog/`](card-effects-catalog/) | Active card-effects catalog used by the solver. |

## Strategic direction (frozen 2026-04-26)

The solver's long-term vision is captured in the user-memory entry `solver-ml-strategic-direction`: solver receives only `(deck, hand)`, outputs max-interruptionScore endboard + trajectory; expectedBoard moves to validation-only. Roadmap Phases 0→4.

**When resuming R&D**, the canonical entry points are (in order):
1. `option-g-canonical-bump-2026-05-02.md` — re-establish the v2 baseline numbers locally.
2. `path-beta-methodology.md` — re-run Path β on the 11-fixture audit set.
3. `path-beta-v2-aggregate-2026-05-03.md` — diff against the 39/50 reference.
4. `ml-refactor-audit-2026-05-05.md` — verify the Option A refactor is still bit-exact.

## Archive

`_archive-paused-2026-05-05/` contains 58 entries: NULL pilots, superseded plans, fixture iterations, per-archetype combo plans (branded, ddd, ryzeal, snake-eye, tearlaments, radiant-typhoon, doomed-dragon), discovery investigations, candidate-bridge tier exports, and earlier phase logs.

**Notable archived pilots** (NULL or marginal lift, kept for context):
- `macro-action-*` (NULL/regression 2026-05-03)
- `prompt-resolver-refactor-*` (Phase 0-7 shipped, falsified 2026-05-01)
- `value-head-pilot`, `resource-scoring-pilot`, `path-scoring-pilot`, `path-ranker-pilot`, `dfs-compression-phase-2-pilot` (all 2026-05-02 NULL)
- Per-archetype combo plans (2026-04-18 → 2026-04-21) — superseded by Path β
- `phase-3/`, `phase-a/`, `phase-b/`, `phase-1-baselines/` — pre-canonical-v2 baselines

**Read on demand only.** Don't re-run pilots from the archive without first checking whether the canonical baseline (`option-g-canonical-bump-2026-05-02.md`) has moved.

## Conventions

- **Adding a new investigation/pilot during a future R&D restart:** create the file at `solver-data/<name>-YYYY-MM-DD.md` and add a row to the relevant table above. Promote to "live references" only when the investigation produces a result that future work depends on.
- **Retiring a live reference:** move it to a new dated archive folder (e.g. `_archive-paused-2026-MM-DD/`) and remove its row from this file.
- **CLAUDE.md** (repo root) is the source of truth for solver invariants that touch shipped code (interruption tags generation, MR5 EMZ rules, etc.).
