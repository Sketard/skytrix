# Phase 1 Baselines — Prompt Resolver Refactor

**Companion to:** [prompt-resolver-refactor-2026-05-01.md](../prompt-resolver-refactor-2026-05-01.md) and [inventory-2026-05-01.md](../inventory-2026-05-01.md)
**Pinned commit SHA:** `7f2aa40640a8d3f4b99356df8c818f5b506aa079` (branch `solver`)
**Captured at:** 2026-05-01

This directory holds the bit-exact baseline snapshots that Phase 3 (adapter migration) and Phase 4 (CLI migration) must reproduce byte-identically. See `manifest.json` for the canonical command per baseline.

## Categories

| Category | Files | Purpose |
|---|---|---|
| `canonical-eval.json` | (single file) | 15-fixture eval via `evaluate-structural.ts`. `cumulativeMatched=28` / `cumulativeMatchedTotal=69` (the "69" in memory notes refers to the aggregate expectedBoard card count, not fixture count). Gates DFS-side regressions globally. **See "Eval determinism caveats" below.** |
| `plan-replay/` | 3 fixtures × `{*.result.json, *.trace.jsonl}` | β-1 plan-replay baselines (`PlanStepOracle` + `PlanTargetOracle` migration target). |
| `raw-replay/` | 3 fixtures × `{*.result.json, *.trace.jsonl}` | β-3 raw-trajectory baselines (`RawTrajectoryOracle` migration target). |
| `enumerate-skip/` | 2 fixtures × `aggregate.json + per-variant *.json` | Skip-variant enumeration baselines (`pickSource` semantics gate). |
| `adversarial/` | `alexandrite-handtraps.json` | `OpponentBranchingOracle` migration target (handtrap branch coverage). |
| `manifest.json` | manifest | SHA pin + capture timestamp + command per entry + decisions log. |

## Captured baseline summary

| Fixture | Mode | Plan source | matched | score | stoppedReason |
|---|---|---|---|---|---|
| branded-dracotail-opener | β-1 | critic-branded-best-plan.json | 7/8 | 37 | completed |
| ddd-pendulum-opener | β-1 | sprint2-option-b-best-plan.json | 3/5 | 37 | completed |
| snake-eye-yummy-opener | β-1 | beta1v2-yesno-best-plan.json | 4/7 | 33 | completed |
| ryzeal-mitsurugi-opener | β-3 | beta3-best-trajectory.json | 5/5 | 40 | divergence (post-combo, see note) |
| radiant-typhoon-opener | β-3 | beta3-best-trajectory.json | 3/3 | 27 | completed |
| branded-dracotail-opener | β-3 | beta3-best-trajectory.json | 6/8 | 23 | completed |
| adversarial-alexandrite | adversarial | (synthetic) | — | 4 | mainPath length=1, nodes=15 (run 2+) |
| **canonical-eval (aggregate)** | DFS eval, pool=1 | 15 fixtures | **28/69** | 555 | — |

> **ryzeal-mitsurugi β-3 divergence note**: trajectory completes the 5/5 endboard before diverging at step 59 / planStep 50 on a SELECT_IDLECMD that the recording has as `(responseIndex=0 cardId=0)`. The matched/score numbers reflect the post-combo state and are stable. The divergence itself is reproducible byte-identically — it's part of the gate.

## Reproducibility verification

### Replay + adversarial + skip → BYTE-IDENTICAL

All non-eval categories were captured and re-captured back-to-back. Diff result:

```
$ diff -r --brief /tmp/phase-1-r2 _bmad-output/solver-data/phase-1-baselines
(no differences except manifest.json timestamp)
```

**Replay paths (β-1 / β-3) and enumerate-skip are byte-deterministic from a warm process.**

**Adversarial caveat**: the very first run after a fresh process startup recorded `nodesExplored=14`; runs 2+ recorded `nodesExplored=15` byte-identically. Speculation: WASM cold-cache vs warm-cache impacting evaluation order in MinimaxMcts. **Workaround for Phase 3 gate: discard the first run after process startup, compare from run 2 onward.**

### Canonical eval → STABLE EXCEPT 1 NOISY FIXTURE

6 runs measured (2 at pool=4, 4 at pool=1):

| Run | Pool | cum matched | cum score | Noisy fixture |
|---|---|---|---|---|
| 1 | 4 | 26 | 523 | — |
| 2 | 4 | 27 | 537 | ryzeal-mitsurugi: 2→3 |
| 3 | 1 | 27 | 545 | — |
| 4 | 1 | 27 | 545 | (identical to r3) |
| 5 | 1 | 28 | 555 | radiant-typhoon: 1→2 |
| 6 | 1 | 28 | 555 | (identical to r5 — captured baseline) |

**Bimodal**: pool=1 oscillates between two states (27/545 and 28/555). The captured baseline reflects state {28/555}. State {27/545} = `radiant-typhoon` matched=1 (no Vortex from Hraesvelgr Xyz), state {28/555} = `radiant-typhoon` matched=2.

**Pool=4 path was completely deterministic at 2026-04-27** (memo `eval-noise-audit-2026-04-27` reported σ=0.00 across 10 reps). Today both pool=4 and pool=1 paths show ±1 fixture variance. **Something between 2026-04-27 and 2026-05-01 made the canonical eval DFS sensitive to `nodesExplored` jitter.** Suspect commits:

- `513446af` solver: enable SELECT_YESNO/SELECT_EFFECTYN plan-targets override
- `d941609f` solver: fix ANNOUNCE_NUMBER response semantic
- `2ce120fd` duel-server: fix Xyz overlay materials missing in BoardState (P5 patch)
- `34f72f31` solver: phase 3 path β sprint 1 — critic-mode + brute-force tooling

None obviously DFS-related, but each introduces new code paths in the adapter that may shift action enumeration order under timing pressure.

**Phase 1 baseline = pool=1 r6 (cum=28/555)** — chosen because:
1. Pool=1 has slightly less variance than pool=4 in this small sample (1/3 runs noisy vs ½ runs noisy).
2. Pool=1 is sequential → easier to reason about for Phase 3 debug if a regression appears.
3. The **stable subset** (14 fixtures) gates strict; the noisy 1 fixture is documented per-run.

**Phase 3/4 gate methodology for canonical-eval**:
- Strict per-fixture matched/score gate on **14 stable fixtures** (`!= radiant-typhoon-opener`).
- `radiant-typhoon-opener` matched ∈ {1, 2}, score ∈ {25, 27} accepted under `--pool-size=1` (bimodal).
- Cum matched accepted ∈ [27, 28], cum score ∈ [545, 555] (bimodal).
- `nodesExplored`, `transpositionHits`, `wallMs`, `actionsZeroPct`, `turn2Pct` per-fixture: NOT gated (wall-clock-bound jitter).

### TODO follow-up: investigate eval determinism regression

Before Phase 3 ships, ideally bisect commits 2026-04-27 → 2026-05-01 (~30 commits) to find the change that introduced eval non-determinism, and either revert/fix or accept it as a permanent gate adjustment. **Not blocking for Phase 1 sign-off** — the gate above is workable.

## Decisions snapshot (signed off Phase 0)

- **Snapshot mode**: ON (default since 2026-04-23, no env var needed). Memo `solver-wasm-snapshot-fork-2026-04-23`.
- **Aggressive continuation**: β-1 only (parité stricte). β-3 `EndPhasePolicyOracle` omits the aggressive sub-branch. Justification: only caller is `enumerate-pivot.ts --auto-finish`, β-3 trajectories are exhaustive by construction.
- **Expertise in eval**: OFF (`SOLVER_DISABLE_EXPERTISE=1`). Memo `phase-0-honest-baseline-2026-04-26`.
- **Neural weights in eval**: ON (`SOLVER_USE_NEURAL_WEIGHTS=1`).
- **Node budget**: 400 (deterministic guard, but doesn't fully prevent wall-clock jitter — see "Canonical eval" caveat).
- **Pool size**: **1** (NOT 4 — see eval caveat).
- **Implicit goals**: 10.
- **Adversarial fixture**: minimal Alexandrite ×40 + 3 handtraps (Ash, Nibiru, Veiler) + seed `[42, 137]`. Reused setup from `adversarial-fixes-smoke-test.ts`.

## How to re-capture

```bash
cd duel-server
npx tsx scripts/capture-phase-1-baselines.ts \
  --out-dir=../_bmad-output/solver-data/phase-1-baselines \
  --mode=all
```

Modes:
- `--mode=all` — all 5 categories (default, ~15 min including eval)
- `--mode=eval` — canonical eval only (~10 min, pool=1)
- `--mode=replay` — plan-replay + raw-replay (~3 min)
- `--mode=adversarial` — adversarial only (~5 sec)
- `--mode=enumerate` — enumerate-skip only (~1 min)
- `--skip-eval` — `--mode=all` minus eval (~3 min, useful for iterating)

## Phase 3 / 4 gate methodology

For each phase touching runtime decision paths:

1. Pre-phase: snapshot baselines from this directory (already captured at SHA `7f2aa406`).
2. Post-phase: `SOLVER_USE_PROMPT_RESOLVER=1 npx tsx scripts/capture-phase-1-baselines.ts --out-dir=/tmp/post-phase-N --mode=all`
3. **Replay + adversarial + skip categories**: `diff -r --brief` must be empty (modulo manifest timestamp). Bit-exact gate.
4. **Canonical eval category**: per-fixture matched/score must match for the 14 stable fixtures; `radiant-typhoon-opener` accepted matched ∈ {1, 2} and score ∈ {25, 27}; cum matched ∈ [27, 28]; cum score ∈ [545, 555]. Bimodal — both states observed pre-refactor, either is acceptable post-refactor.
5. **Trace-level diff for forensics** if any divergence: `diff <baseline>.trace.jsonl <post>.trace.jsonl` — pinpoints exact prompt where pool or pick changed.

## Files NOT used as baselines (intentionally)

- `_bmad-output/planning-artifacts/research/trajectories/snake-eye-yummy-opener.raw-replay.json`
- `_bmad-output/planning-artifacts/research/trajectories/ddd-pendulum-replay-eb8c6865.raw-replay.json`
- `_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener.raw-replay.json`

These use the `raw-replay-v1` PvP recording format which is **not round-trip compatible** with the solver (different deck-shuffle init: PvP uses 4-bigint seed + `startingDrawCount=5`, solver uses 2-bigint seed + explicit hand). They diverge at step 0 deterministically. See the warning block at the top of `scripts/raw-replay-to-trajectory.ts`. Phase 1 only baselines β-3 trajectories produced by Path β subagents under `data/path-beta-poc/<fixture>/beta3-best-trajectory.json`.

## Working tree caveat

`manifest.workingTreeDirty: true` indicates uncommitted changes during capture. At pin time, the only uncommitted files were `scripts/capture-phase-1-baselines.ts` and `scripts/capture-adversarial-baseline.ts` (the harness scripts themselves) plus this `.md`. They will be committed after Phase 1 completes; subsequent re-captures will reset the flag.
