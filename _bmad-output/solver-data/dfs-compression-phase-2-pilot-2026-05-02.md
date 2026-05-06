# DFS Compression Pilot Phase 2 (SELECT_EFFECTYN) — Verdict NULL+REGRESSION, Reverted

**Date:** 2026-05-02
**Status:** PILOT NULL+REGRESSION on canonical budget — code reverted to Phase 1 only, no opt-in flag preserved
**Predecessor:** `option-g-canonical-bump-2026-05-02.md` (Phase 1 + 800-node budget = new canonical 31/596)

## Question asked

Can extending the DFS macro-compression mechanism to `SELECT_EFFECTYN` N=2 prompts (with deterministic policy "pick yes") lift cum matched/score on the new Option G canonical baseline (31/69 596)? Phase 1 trace audit said 4/4 ddd, 3/3 branded, 2/2 snake-eye SELECT_EFFECTYN are picked "yes" on the canonical line, suggesting "yes" is a safe default that would let DFS skip the "no" branch and reclaim node budget.

## Setup

**Hypothesis (Levier D Phase 2)**:
- Extend the same compression block in `dfs()` to also collapse SELECT_EFFECTYN N=2 prompts when `SOLVER_DFS_COMPRESS_EFFECTYN=1`
- Force `responseIndex=1` ("yes" — the activation branch); the "no" branch is dropped from DFS exploration
- Same try/finally + currentActionStack discipline as Phase 1
- Conjectured safe based on β-1 trace audit (canonical-line picks yes 9/9 across 3 fixtures)

**Infrastructure shipped + reverted** (~1h):
1. Extension of compression block in `dfs-solver.ts` (~30 LoC) — yes-action lookup via `actions.find(a => a.responseIndex === 1)`
2. Sub-flag `SOLVER_DFS_COMPRESS_EFFECTYN=1` (default OFF even when `SOLVER_USE_DFS_COMPRESSION=1`) for separate measurement
3. Updated typedef comment for `compressedSelectChainNodes` (also count EFFECTYN)
4. **Reverted to Phase-1-only** after pilot results.

## Results — canonical eval (15 fixtures, pool=1, budget=800/12s)

| Run | matched | score |
|---|---|---|
| Option G baseline (Phase 1 only) | **31/69** | **596** |
| Phase 2 ON run 1 | 30/69 | 595 |
| Phase 2 ON run 2 (nekroz-ryzeal isolated) | 1/4 | 36 (stable) |

Per-fixture diff (Phase 2 ON vs Option G baseline):

| Fixture | Baseline | Phase 2 | Δ matched | Δ score |
|---|---|---|---|---|
| ddd-pendulum-opener | 1/5 28 | 1/5 28 | 0 | 0 |
| ryzeal-mitsurugi-opener | 3/5 67 | 3/5 67 | 0 | 0 |
| radiant-typhoon-opener | 3/3 57 | 3/3 57 | 0 | 0 |
| branded-dracotail-opener | 4/8 80 | 4/8 80 | 0 | 0 |
| kashtira-azamina-opener | 2/4 44 | 2/4 44 | 0 | 0 |
| horus-crystron-opener | 2/4 43 | 2/4 43 | 0 | 0 |
| dinomorphia-opener | 1/3 11 | 1/3 11 | 0 | 0 |
| spright-opener | 3/4 50 | 3/4 50 | 0 | 0 |
| snake-eye-yummy-opener | 2/7 39 | 2/7 39 | 0 | 0 |
| tearlaments-opener | 1/4 27 | 1/4 27 | 0 | 0 |
| floowandereeze-opener | 2/4 32 | 2/4 32 | 0 | 0 |
| labrynth-opener | 2/4 21 | 2/4 21 | 0 | 0 |
| stun-runick-opener | 2/4 31 | 2/4 31 | 0 | 0 |
| **nekroz-ryzeal-opener** | **2/4 37** | **1/4 36** | **−1** | **−1** |
| branded-dracotail-opener-mirrorjade-line | 1/6 29 | 1/6 29 | 0 | 0 |

**14/15 fixtures identical, 1 stable regression on nekroz-ryzeal-opener.**

## Diagnostic — "no" is load-bearing on at least one fixture

The β-1 trace audit ("9/9 picked yes" on the 3 canonical lines) was correct but **not sufficient** to claim safety across the 15 canonical-eval fixtures. nekroz-ryzeal-opener has at least one EFFECTYN where the "no" branch is structurally important — eliminating it makes the DFS lose the previously-found 2/4 endboard and settle for a strictly-worse 1/4.

User predicted this exactly before the test:
> "Le 'no' peut être important en effet. Si le gain est marginal, on abandonne."

The mechanism — sound on the canonical-line audit — is unsound as a global heuristic. YGO has known patterns where declining a trigger is correct (preserve OPT for a higher-value chain link, avoid a cost that breaks the combo, save a 1-time effect for later in the turn). nekroz-ryzeal-opener apparently exhibits one of those.

## Decision — abandon H1 (hard yes), no infra preserved

Per user policy ("if marginal gain, abandon"), with the actual outcome being **negative gain** (−1 cum matched), the H1 hard-pick variant is reverted entirely. No opt-in flag preserved — the trade-off (code complexity vs zero documented benefit) does not justify keeping it under env-gate.

The Phase 1 compression block (SELECT_CHAIN N=1 only) stays in place and continues to back the Option G canonical baseline.

## What this rules out / refines

**Hard "always yes" policy on SELECT_EFFECTYN is unsound for the canonical-eval fixture set.** Any future EFFECTYN-side compression would need to either:

- **H2 (soft compression)**: explore both branches but with cost asymmetry (e.g., transposition table prefers "yes" subtree, or "yes-first then no on time-permits"). Strictly more complex than H1, plausibly slower in absolute terms.
- **Per-card policy**: tag specific cardId/effect combinations where "yes" is provably safe via expertise file metadata. Tied to the archetype-expertise authoring path (Option F), not a free win.
- **Learned policy**: extend the existing `MechanicalDefaultOracle` / `CardExpertiseOracle` chain with a learned classifier predicting yes/no per (cardId, fieldState, prompt context). Substantially more R&D.

None of these are a quick win. The "free 5-15% nodes saved via deterministic policy" prediction from the Phase 1 memo is **falsified** in the canonical-eval setting.

## Bit-exact gate preserved (post-revert)

3 β-1 baselines re-run with all flags OFF after revert: byte-identical to baseline traces (only the prior `pathPoints:0` line addition from commit 013a10cb in result.json — not introduced by this work). 226/226 vitest tests pass; dfs-solver smoke test 43/43.

## 9th consecutive scorer/ranker/depth-side NULL/MARGINAL on canonical

After Phase B v1 (marginal), Stage 3b (NULL), Arch C (NULL), V(s) (MARGINAL), Resource Scoring (NULL), Path Scoring (NULL), Path Ranker (NULL), Compression Phase 1 (NULL on matched but lifted at 800 nodes via Option G), this 9th iteration confirms the diagnosis:

**The depth bottleneck has been closed by Option G + Phase 1 compression. The remaining gap on the 10 stuck fixtures is not depth-related and not solvable by mechanical policy heuristics.** The next levers must be algorithmic (MCTS with priors — Option E) or content-side (authoring expertise — Option F).

## Files

- Implementation (reverted): `duel-server/src/solver/dfs-solver.ts` — Phase 2 extension removed, Phase 1 unchanged. A pointer comment in the loop body now records the revert reason.
- This memo: `_bmad-output/solver-data/dfs-compression-phase-2-pilot-2026-05-02.md`
- Predecessors:
  - `dfs-compression-pilot-2026-05-02.md` (Phase 1 — kept)
  - `option-g-canonical-bump-2026-05-02.md` (canonical baseline this measured against)

## Recommendation for next session

**Pivot to Option E — MCTS with PathBiasedRanker priors + compression Phase 1**, as planned in the user's H→E sequence. The Phase 2 NULL is data: it forecloses the "policy heuristic on EFFECTYN" path but does not say anything about MCTS rollouts or per-card learned policies.

Rough order of operations for Option E:
1. Locate existing MCTS scaffolding (`phase-3/mcts-policy-killed-2026-04-27.md` retired prior version) and assess delta vs current state
2. Wire `PathBiasedRanker.pathBonus()` as UCB prior weight in `MCTSSolver.selectChild()`
3. Wire compression Phase 1 in MCTS (same try/finally pattern in the rollout body)
4. Pilot on ddd-pendulum-opener (matched 1/5 stuck across 9 pilots — best stress test)
5. If matched lifts → cross-fixture eval at canonical config; if NULL → either retire MCTS again with a structured verdict, or freeze 31/596 as v5 baseline and pivot to authoring (Option F)
