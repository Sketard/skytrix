# Resource Scoring Pilot (Design D) — Verdict NULL on DFS Standalone

**Date:** 2026-05-02
**Status:** PILOT NULL — opt-in flag preserved, default OFF, infra reusable
**Predecessor:** `value-head-pilot-2026-05-02.md` (V(s) MARGINAL → pivot to scorer-side anti-myopia)

## Question asked

Can a phase-conditional `cardsOutOfDeck` resource bonus added to the scorer's `explorationScore` (NOT `interruptionScore`) lift `matched` on the DFS standalone for ddd-pendulum-opener — addressing the myopia where the DFS prefers short terminals over long combos?

## Setup

**Hypothesis (Design D)**:
- `cardsOutOfDeck = (initialMain + initialExtra) - (currentDECK + currentEXTRA)` measures resources generated through deck/extra depletion
- `phaseProgress = min(1, interruptionScorePreResource / threshold)` — early in combo, phaseProgress is low
- `resourceWeight = W_base × (1 - 0.7 × phaseProgress)` — early states get full bonus weight, late states get reduced (capture YGO sequence "generate first, finalize last")
- `resourcePoints = cardsOutOfDeck × resourceWeight` adds to `explorationScore` only

**Empirical params from instrumented β-1 baselines**:
- 3 fixtures (ddd / branded / snake-eye) trajectories captured via `replay-trajectory-cli --dump-trajectory`
- Terminal `cardsOutOfDeck` ~6-7 across all 3 fixtures (universal magnitude)
- Terminal `interruptionScore` ~33-37 (β-1 ceilings)
- Ratio score/cardsOOD ~5.3-6.2 (very stable cross-fixture)
- W_base=4, threshold=30, phase_decay=0.7 chosen to lift terminal ~25-30%

## Results

DFS standalone on ddd-pendulum-opener at canonical config (`SOLVER_USE_NEURAL_WEIGHTS=1 --budget-ms=6000 --node-budget=400 --pool-size=1 --implicit-goals=10`):

| W_base | matched | interruptionScore | explorationScore | terminal |
|---|---|---|---|---|
| OFF (baseline) | 1/5 | 68.5 | 68.5 | Deus Machinex |
| 4 | 1/5 | 68.5 | 80.5 | identical |
| 6 | 1/5 | 68.5 | 86.5 | identical |
| 8 | 1/5 | 68.5 | 92.5 | identical |
| 10 | 0/5 | 5 | 102.2 | regression — DFS trades endboard for resource |

**Verdict: NULL** on the W_base ∈ [4, 8] range (no matched lift), regression at W_base=10.

## Diagnostic

The DFS at the canonical budget (400 nodes / 6s) does NOT explore deeply enough for `cardsOutOfDeck` to vary meaningfully between branches. All branches the DFS explores reach terminals with cardsOOD ≈ 2-3 (Pendulum scales placed, but no deep tutor/ED-summon chain). The resource bonus is therefore approximately constant across branches → ranking unchanged.

The bonus would only matter if the DFS reached a branch with cardsOOD ≈ 6 (the canonical β-1 terminal), but reaching that requires ~15 consecutive correct SELECT_IDLECMD decisions which the DFS doesn't make in the budget.

**Root insight: scorer-terminal-side resource scoring cannot solve myopia by itself.** The bonus is paid AT the terminal, but the DFS must arrive at the right terminal first. If it doesn't, the bonus is theoretical.

For this lever to lift matched, one of:
1. Bias the **ranker** (not just the scorer) toward actions that increase cardsOOD — bring resource awareness into the action ordering, not just terminal evaluation.
2. **Forward-look** at rank time — for each candidate action, estimate cardsOOD impact via a 1-2 step simulation.
3. **Path scoring exact** — reward the activation log (which path-cards have been activated during combo) instead of the terminal state (where they currently sit). This transforms "reward the destination" into "reward the journey", where mid-combo states with path-cards activated score high even if those cards have since been consumed as materials.

Option 3 (path scoring) was previously identified in the discussion as Levier 3 / Levier A. It addresses the same myopia problem from a different angle (action-history vs state-delta) and is the natural follow-up.

## Bit-exact gate preserved

- 3 β-1 baselines (snake-eye, branded, ddd-pendulum) bit-exact preserved with flag ON: 0-line diff on `tr -d '\r'`-normalised traces. The flag affects DFS exploration only; plan-replay does not use the scorer for action choice.
- 5/5 smoke test suites green (123/123 tests).
- `interruptionScore` (user-facing grade) unchanged with flag — the bonus only affects `explorationScore` (DFS guidance).

## Tooling shipped (reusable)

1. **`InterruptionScorer.setInitialDeckSizes(main, extra)`** — new setter to inject per-fixture initial deck/extra sizes. Plumbed through:
   - `evaluate-structural.ts:498-500` (eval harness)
   - `solver-worker.ts:218-220` (production worker)
2. **`SOLVER_USE_RESOURCE_SCORING=1` env flag** — gates Design D. Default OFF means baseline behavior preserved.
3. **`SOLVER_RESOURCE_W_BASE` / `SOLVER_RESOURCE_THRESHOLD` / `SOLVER_RESOURCE_PHASE_DECAY`** — per-run tunable params (defaults 4 / 30 / 0.7).
4. **`replay-trajectory-cli.ts --dump-trajectory`** extended (already shipped Phase 7 commit b7130dbb) now captures `resourceMetrics` per step (cardsOutOfDeck, deckSize, extraSize, handSize, gySize, banishedSize, endboardScoreApprox). Plus terminal `resourceMetricsTerminal` block. Useful for any future analysis of resource trajectories.

## Why NOT revert

The infra is **reusable** for future iterations:
- The scorer-side computation of `cardsOutOfDeck` is necessary for any future variation (path scoring, multi-component scoring, etc.).
- The setters and env flags are zero-cost when not enabled (default OFF).
- `--dump-trajectory --resourceMetrics` is the analysis tool we'll need to validate any future scoring change empirically.

Cost of keeping: one extra method on the scorer, one env flag check per terminal scoring (negligible).

## Files & references

- Implementation: `duel-server/src/solver/interruption-scorer.ts` (lines ~155-165 setter, ~380-410 scoring logic)
- Plumbing: `duel-server/scripts/evaluate-structural.ts:498-500`, `duel-server/src/solver/solver-worker.ts:218-220`
- Instrumentation: `duel-server/scripts/replay-trajectory-cli.ts` (resourceMetrics in dump-trajectory output)
- Predecessors:
  - `value-head-pilot-2026-05-02.md` (V(s) pilot MARGINAL → pivot to scorer-side)
  - `ddd-pendulum-expertise-2026-05-02.md` (ddd authoring shipped, gradient via goalMatchPoints 0→52.5 but matched stuck 1/5)
  - User discussion 2026-05-02: cards-out-of-deck as proxy for "resources in rotation" + Design D phase-conditional formula

## Recommendation for next session

**Pivot to path scoring (Levier 3 / Levier A)** — the natural follow-up that addresses the same myopia from the action-history angle:

1. Define `pathCards: number[]` per archetype-expertise (auto-derivable from β-1 plan steps)
2. Track an `activationLog` (already kept by adapter for OPT) of which path-cards have been activated this turn
3. Add `pathPoints = sum(W_path × matched_path_card)` to `explorationScore` (and possibly `interruptionScore`)
4. Test on ddd: if matched lifts 1/5 → 2/5, the journey-vs-destination framing is the right one

Estimated effort: ~1 day (the scorer + activation log infra is already in place).

Alternative: stop on these 4 fixtures, switch to authoring expertise on the 7 stuck fixtures (kashtira, dinomorphia, tearlaments, floowandereeze, labrynth, horus, nekroz-ryzeal). Known method, +5-10 cum matched documented, no R&D risk.
