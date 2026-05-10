# Planning Artifacts — Frozen v1

**Status:** archived 2026-05-10. Do NOT edit these files in place.

## What's here

- **PRDs** — `prd.md` (solo simulator), `prd-pvp.md`, `prd-solver.md`
- **Architecture** — `architecture.md`, `architecture-pvp.md`, `architecture-solver.md`
- **UX specs** — `ux-design-specification.md`, `ux-design-specification-pvp.md`, `ux-design-specification-replay.md`, `ux-design-specification-solver.md`, `ux-design-directions-solver.html`
- **Epics** — `epics.md`, `epics-pvp.md`, `epics-replay.md`, `epics-solver.md`
- **Solver R&D plans** — `implementation-readiness-report-solver-2026-04-06.md`, `solver-step1-structural-value-function-plan.md`, `solver-structural-weights-extension-plan.md`

## Why archived

These were pre-implementation planning specs. All 4 modules (Solo, PvP, Replay, Solver) have shipped v1. The codebase has since undergone heavy refactoring (post-big-bang testing, server module decomposition, animation orchestrator split, WS protocol versioning) that these specs do NOT reflect.

Patching them line by line after-the-fact would be high-effort low-yield and would re-diverge within weeks.

## Where the live truth lives

| Need | Source |
|---|---|
| **Invariants & contracts (animation, locks, chain state, etc.)** | `CLAUDE.md` at repo root — 645 lines, refreshed 2026-05-10 |
| **Architecture as built** | `_bmad-output/brownfield-docs/` (run `bmad-document-project` to (re)generate) |
| **Active contracts not in CLAUDE.md** | `../cancel-rollback-contract.md`, `../ocgcore-technical-reference.md` |
| **Game rules reference** | `../yugioh-game-rules.md` |
| **Last UX audit (PvP+Replay)** | `../ux-audit-pvp-replay-2026-05-08.md` |
| **Solver R&D log** | `../../solver-data/solver-rnd-log.md` |

## Reading order if you need historical context

1. Solo Simulator — `prd.md` → `architecture.md` → `epics.md`
2. PvP — `prd-pvp.md` → `architecture-pvp.md` → `epics-pvp.md`
3. Replay — `epics-replay.md` (extends PvP architecture)
4. Solver — `prd-solver.md` → `architecture-solver.md` → `epics-solver.md` → `implementation-readiness-report-solver-2026-04-06.md`

## When to consult these vs. the live sources

- **Use these** to understand *original intent* (why a feature was scoped, what was in scope at v1 cut).
- **Use CLAUDE.md / brownfield-docs** to understand *current state*.

If you find a divergence between this archive and the live code, the live code wins.
