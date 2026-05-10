# Path Scoring Pilot (Levier 3) — Verdict NULL on DFS Standalone

**Date:** 2026-05-02
**Status:** PILOT NULL — opt-in flag preserved, default OFF, infra reusable
**Predecessor:** `resource-scoring-pilot-2026-05-02.md` (Design D NULL → pivot to journey-vs-destination framing)

## Question asked

Can rewarding the **activation history** (cardIds whose effects activated this turn from the canonical β-1 plan) instead of the **terminal state** lift `matched` on DFS standalone for ddd-pendulum-opener — addressing the Resource Scoring NULL diagnostic that scorer-terminal-side bonuses are constant cross-branch at the canonical budget?

## Setup

**Hypothesis (Levier 3 / Path Scoring)**:
- `pathCards: number[]` per archetype-expertise (top-level, opt-in field)
- Authored from β-1 best plan: every cardId referenced as a `cardName` in plan steps
- `pathPoints = W_path × |pathCardsSet ∩ distinctActivations|` where `distinctActivations` is `OCGCoreAdapter.distinctEffectCardsThisTurn` (own-side `_isEffectActivation`, untagged-inclusive — distinct from the OPT-tagged `activationLog`)
- Counts INTO `explorationScore` only (DFS guidance), NOT `interruptionScore` (user-facing grade) — same discipline as `latentPoints` and `resourcePoints`
- Hypothesis: the differential between a short terminal (~2-3 path-cards activated) and the β-1 canonical line (~12-14 activated) creates a per-branch gradient that DFS reranks toward longer paths

**Infrastructure shipped** (~3h):
1. `GameOracle.getDistinctActivationCardIds(handle): ReadonlySet<number>` — new method exposing the existing `internal.distinctEffectCardsThisTurn` set already cloned in fork (`ocgcore-adapter.ts:2044, 2137`) and reset at NEW_TURN (`ocgcore-adapter.ts:912-913`)
2. `ArchetypeExpertise.pathCards?: readonly number[]` — top-level, opt-in field. Loader: `setArchetypeExpertise()` derives a flattened `Set<number>` automatically (zero-cost when no archetype declares pathCards)
3. `ScoreBreakdown.pathPoints: number` — new field; `scoreWithCards()` accepts optional `distinctActivations` param; bit-exact preserved when flag OFF (`pathPoints` stays 0)
4. DFS plumbing: `dfs-solver.ts` calls `oracle.getDistinctActivationCardIds()` at every interim + terminal score; passes through to `scoreWithCards()`
5. Authored `ddd-pendulum.json:pathCards` (18 cardIds) from `beta1v2-best-plan.json` (the empirical 3/5 critic ceiling)

## Results — Sweep on ddd-pendulum-opener

DFS standalone at canonical config (`SOLVER_USE_NEURAL_WEIGHTS=1 --budget-ms=6000 --node-budget=400 --pool-size=1 --implicit-goals=10`):

| W_path | matched | interruptionScore | explorationScore | pathPoints | nodes | maxDepth |
|---|---|---|---|---|---|---|
| OFF (baseline) | 1/5 | 68.5 | 68.5 | 0 | 329 | 40 |
| 3 | 1/5 | 68.5 | 80.5 | 12 | ~329 | ~40 |
| 5 | 1/5 | 68.5 | 88.5 | 20 | ~329 | ~40 |
| 8 | 1/5 | 68.5 | 100.5 | 32 | 349 | 40 |
| 12 | 1/5 | 68.5 | 116.5 | 48 | ~349 | ~40 |
| 20 | 1/5 | 68.5 | 148.5 | 80 | ~349 | ~40 |

**Verdict: NULL** across W_path ∈ [3, 20]. The DFS terminates at a state where exactly **4 path-cards have activated** (Pendulum scales placed + Gate searched), regardless of W_path scaling. The reward is paid but the DFS never visits a branch with more path-card activations.

**Doubled budget test** (`--budget-ms=12000 --node-budget=800`, W=5):

| Config | matched | score | explorationScore | pathPoints |
|---|---|---|---|---|
| W=5 budget=400 | 1/5 | 68.5 | 88.5 | 20 |
| W=5 budget=800 | 1/5 | 71.5 | 96.5 | 20 |

Doubling the budget doesn't unlock more path-card activations either. Same 4-card terminal, slightly different score via marginal exploration.

## Diagnostic

The DFS at canonical budget converges to a single high-explorationScore terminal where exactly **4 path-cards have activated** — typically Kepler+Copernicus+Surveyor (Pendulum scale activations) + Gate (Continuous Spell activation with search). It never reaches the 12-14 path-card terminal of the β-1 canonical line because:

1. **The 4-activation terminal already maximises `interruptionScore` (68.5)** at the depth the DFS can explore — it has Doom Queen scaled, Gate active, scales set, and a finisher visible. Its goalMatchPoints (41.5) + implicitGoalPoints (10) saturate.
2. **Going deeper (Zero Contract pop → Doom Queen ED-return → Gilgamesh/Siegfried/Deus Machinex) requires 15-20 more correct SELECT_CMD/SELECT_CARD decisions** — the DFS doesn't have the budget to rank-order through that combinatorial space.
3. **The path bonus is paid at the terminal**, so even W=20 doesn't reorder the action ranking at intermediate decisions. The DFS still picks the locally-best action at each prompt; the bonus only differentiates terminals it reaches, never branches it explores.

This is the **same root cause as Resource Scoring NULL (2026-05-02)**: scorer-terminal-side rewards cannot redirect DFS exploration when the rewarded states are unreachable in the budget. Path scoring shifts the proxy from "resources used (cardsOOD)" to "actions taken (activations)" but doesn't change the lever.

**Pattern:** 6 NULL/MARGINAL consecutive iterations on scorer/feature side (Phase B v1 marginal, Stage 3b NULL, Arch C TERMINAL NULL, V(s) MARGINAL, Resource Scoring NULL, Path Scoring NULL). **The bottleneck is provably not scorer composition.** It's the ranker / search algorithm.

## Bit-exact gate preserved

3 β-1 baselines (snake-eye-yummy, branded-dracotail, ddd-pendulum) re-run with flag OFF:
- `matched` / `score` / all numeric fields: **byte-identical** to `_bmad-output/solver-data/phase-1-baselines/plan-replay/*.result.json`
- Trace JSONL files: byte-identical (`tr -d '\r'`-normalised)
- `result.json` differs by **one line**: `"pathPoints": 0` added to the breakdown (additive field, forward-compatible)

**Cross-fixture non-regression** (W=5, snake-eye / branded / mitsurugi, none of which have `pathCards` in their expertise files):
- explorationScore identical to flag-OFF baseline (no change, as expected — the flattened `pathCardsSet` is empty for these archetypes)

## Tooling shipped (reusable)

1. **`GameOracle.getDistinctActivationCardIds(handle)`** — exposes own-side activation tracking that was already adapter-internal. Useful for any future ranker / policy / value-net wanting to bias on action history.
2. **`ArchetypeExpertise.pathCards`** — schema field. Forward-compatible: existing files without it load unchanged.
3. **`ScoreBreakdown.pathPoints`** — new field. Always 0 when flag OFF. Useful for any future scoring split that depends on activation count.
4. **`SOLVER_USE_PATH_SCORING=1 SOLVER_PATH_W=<N>`** — env-gated; default OFF means production runtime no-op.

## Why NOT revert

The infra is **reusable** for the next pivot:
- The `distinctActivations` plumbing through DFS → scorer is the prerequisite for any **ranker-side** path bias (the natural follow-up — give the ranker awareness of "have I activated this card yet" so it prefers actions that increase it).
- A future value head V(s) trained with path-card activations as a feature axis would consume the same infrastructure.
- The schema field on `ArchetypeExpertise` is forward-compat: archetype-expertise authors can declare `pathCards` opportunistically; the loader silently no-ops it.

Cost of keeping: one extra Set per InternalHandle (already there for axis E counters), one optional param on `scoreWithCards`, one env flag check per terminal scoring (negligible).

## Files & references

- Implementation:
  - `duel-server/src/solver/game-oracle.ts:31-39` — `getDistinctActivationCardIds`
  - `duel-server/src/solver/ocgcore-adapter.ts:643-647` — adapter implementation
  - `duel-server/src/solver/strategic-grammar.ts:213-222` — `pathCards` schema field
  - `duel-server/src/solver/interruption-scorer.ts:96-100, 142-156, 224-244, 416-450` — scorer state + setter + scoring block
  - `duel-server/src/solver/dfs-solver.ts:557-562, 581, 760, 955, 991-996, 1003-1009` — DFS plumbing
  - `duel-server/src/solver/solver-types.ts:294-313, 330-339` — `ScoreBreakdown.pathPoints` + `EMPTY_BREAKDOWN`
- Authoring: `duel-server/data/archetype-expertise/ddd-pendulum.json` — `pathCards` (18 cardIds + `_pathCardsNote`)
- Predecessors:
  - `resource-scoring-pilot-2026-05-02.md` (Design D NULL → motivation for journey-vs-destination)
  - `value-head-pilot-2026-05-02.md` (V(s) MARGINAL)
  - `ddd-pendulum-expertise-2026-05-02.md` (ddd authoring shipped, baseline 1/5)
  - User discussion 2026-05-02: Levier 3 = action-history reward as alternative to terminal-state reward

## Recommendation for next session

**Pivot to ranker-side bias.** Six consecutive scorer-side iterations have been NULL or MARGINAL — the lever is exhausted. Two practical paths:

### Option A — Authoring expertise for the 7 stuck fixtures (ROI-positive, no R&D risk)

Documented +5-10 cum matched (kashtira-azamina, dinomorphia, tearlaments, floowandereeze, labrynth, horus, nekroz-ryzeal). Known method: ~1-2d/fixture, no model change needed. **Preferred default** if the goal is to increase `cumulative matched` on the 15-fixture canonical eval.

### Option B — Ranker-side path bias (R&D continuation)

Implement a **ranker** (not scorer) that consumes `distinctActivations` at action-rank time. At each SELECT_CMD prompt, bias the action ordering toward actions whose source cardId is in `pathCards` and **not yet** activated this turn. This addresses the diagnostic head-on: the bias is paid PER DECISION, not at the terminal, so the DFS reorders its exploration. ~1d to implement (RouteAwareRanker has a wrapper pattern).

This is the genuinely new lever — and the only one that has not been falsified yet on this archetype.

### Option C — Stop here and ship Phase A + ddd authoring as the v5 cumulative baseline

Phase A (`--implicit-goals=10`) + ddd-pendulum.json shipped 2026-05-02 = canonical-eval cum matched bumped from 27 → 28 (median), score from 545 → 555. Honest baseline at honest config still 28/69 (2026-04-26 measurement holds). Three pilots NULL but **no regression**. Acceptable v5 state to commit and freeze.

## Files produced this session

- Code: `interruption-scorer.ts`, `dfs-solver.ts`, `game-oracle.ts`, `ocgcore-adapter.ts`, `strategic-grammar.ts`, `solver-types.ts`
- Data: `ddd-pendulum.json` (added `pathCards` field)
- This memo: `path-scoring-pilot-2026-05-02.md`
