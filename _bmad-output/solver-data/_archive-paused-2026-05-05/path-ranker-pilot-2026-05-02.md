# Path Ranker Pilot (Levier B) — Verdict NULL on DFS Standalone, Diagnostic Refined

**Date:** 2026-05-02
**Status:** PILOT NULL — opt-in flag preserved, default OFF, infra reusable
**Predecessor:** `path-scoring-pilot-2026-05-02.md` (Levier 3 NULL → pivot to ranker-side bias)

## Question asked

Can a **ranker-side** path bias — applied PER DECISION at action-rank time, not at the terminal — lift `matched` on DFS standalone for ddd-pendulum-opener? Hypothesis: the previous NULLs (Resource Scoring, Path Scoring) failed because terminal-side bonuses are constant cross-branch at the canonical budget; biasing the ranker per decision forces the DFS to reorder its exploration toward path-progressing branches.

## Setup

**Hypothesis (Levier B / Path-Biased Ranker)**:
- New `PathBiasedRanker` decorator wraps the outermost ranker stack (RouteAware → Neural → Policy → Path)
- At each `rank()` call, apply `final_score = (N - i) × baseRankScale + W_RANK × indicator(action.cardId ∈ pathCards \ distinctActivations ∧ _isEffectActivation)`
- DFS injects per-handle `distinctActivations` (live OCG-engine activation Set) before each rank via `setDistinctActivations()`
- Bias persists ONLY when the action would actually push the activation journey forward (cardId in pathCards AND not yet activated AND is effect activation)

**Infrastructure shipped** (~3h):
1. `PathBiasedRanker` ranker decorator (~110 LoC): soft-bias additive (same discipline as `GraphGuidedRanker`), per-fixture `pathCardsSet` derived from `setArchetypeExpertise`, per-call `setDistinctActivations` setter
2. `delegateToInner` for setter forwarding (matches `PolicyGuidedRanker` pattern) — fixed dispatch bug discovered mid-pilot where `dfsRanker instanceof NeuralFeatureRanker` failed when wrapped, breaking `setMainDeck/setExtraDeck` plumbing
3. Wired into `solver-worker.ts` (production) and `evaluate-structural.ts` (eval harness) under `SOLVER_USE_PATH_RANKER=1`, default OFF
4. DFS structural-type detection at rank time (no hard import dependency on `PathBiasedRanker`)

## Results — ddd-pendulum-opener sweep

DFS standalone at canonical config (`SOLVER_USE_NEURAL_WEIGHTS=1 --budget-ms=6000 --node-budget=400 --pool-size=1 --implicit-goals=10`):

| Config | matched | score | exploration | pathPoints | nodes | maxDepth |
|---|---|---|---|---|---|---|
| Baseline (no flags) | 1/5 | 68.5 | 68.5 | 0 | 329 | 40 |
| Path Ranker W=50 | 1/5 | 68.5 | 68.5 | 0 | ~329 | ~40 |
| Path Ranker W=200 | 1/5 | 68.5 | 68.5 | 0 | ~329 | ~40 |
| Path Ranker W=500 | 1/5 | 68.5 | 68.5 | 0 | ~329 | ~40 |
| Combined (W_rank=100 + W_path=8) | 1/5 | 68.5 | 100.5 | 32 | ~329 | ~40 |
| Combined (W_rank=100 + W_path=20) | 1/5 | 68.5 | 148.5 | 80 | ~329 | ~40 |
| Combined @ 4× budget (1600 nodes / 24s) | 1/5 | 68.5 | 116.5 | 48 | 1397 | ? |

**Verdict: NULL** across the entire sweep. Matched stable at 1/5 regardless of W_rank, regardless of combination with path scoring, even at quadrupled budget.

## Cross-fixture non-regression

Path Ranker W=50 default, snake-eye / branded / mitsurugi (none have `pathCards` declared):

| Fixture | Flag OFF | Flag ON W=50 | Verdict |
|---|---|---|---|
| snake-eye-yummy-opener | matched=2 score=36.57 | matched=2 score=36.57 | identical |
| branded-dracotail-opener | matched=0 score=26.0 | matched=0 score=26.0 | identical |
| ryzeal-mitsurugi-opener | matched=3 score=110.5 | matched=3 score=110.5 | identical |

**Note**: Initial test showed branded matched=0 vs my prior memo's "matched=3 score=74.21" — that prior figure was from `replay-trajectory-cli` (β-1 critic plan replay), not DFS standalone. DFS standalone has always been 0/8 matched on branded — no regression.

**Mid-pilot bug found and fixed**: outer `PathBiasedRanker` wrapper broke `dfsRanker instanceof NeuralFeatureRanker` dispatch for `setMainDeck/setExtraDeck`. Fix: added `delegateToInner` pass-through methods on `PathBiasedRanker` + matching `instanceof PathBiasedRanker` branch in `runFixture`. Mitsurugi regression that this revealed (110.5 → 90.5 score, −1 matched) cleared once dispatch was restored.

## Diagnostic — Bottleneck refined

The path bias is **demonstrably active**. Debug logging (SOLVER_DEBUG_PATH_RANKER=1) on ddd-pendulum-opener showed:
- At first IDLECMD prompt (N=15 actions), 4 path-cards boosted by +300 each: Gate, Kepler, Copernicus, Surveyor
- At deeper prompts, fewer actions boosted as activations accumulate
- At one observed peak, Solomon (cardId 32232538) is boosted at depth ~30+ — DFS reaches further than baseline

**But matched stays 1/5.** This rules out three earlier hypotheses:
1. ❌ "Bottleneck is in the scorer composition" (Resource Scoring + Path Scoring NULL)
2. ❌ "Bottleneck is the action-ranking ignoring path coverage" (this pilot NULL)
3. ❌ "Combined ranker + scoring will solve myopia" (combined still NULL even at 4× budget)

**The actual bottleneck is the search horizon — DFS depth, not order.**

ddd-canonical line requires ~80 prompts (Pendulum scales → Gate → Doom Queen → Zero Contract → Lance Soldier → Gate pop → Doom Queen ED-return → Pendulum Summon Copernicus → Necro Slime dump → Cursed King Siegfried Synchro → Gilgamesh Xyz → Necro Slime fusion Genghis → Deus Machinex alt-Xyz → Sky King Zeus Link → Headhunt set). At canonical budget (400 nodes / 6s), DFS reaches depth ~40-50 nodes with up to 4 path-cards activated. Even 4× budget (1600 nodes) only nudges to 6 path-cards — still half what the 5-piece apex needs.

**No heuristic on action ordering or terminal scoring will solve this.** The DFS literally does not have the budget to traverse 80+ prompts and prune effectively. The α-β bound + transposition table + path-hash dedup all assume a search depth in the 30-60 range.

**7th consecutive NULL/MARGINAL** on solver-side iterations (Phase B v1 marginal, Stage 3b NULL, Arch C TERMINAL NULL, V(s) MARGINAL, Resource Scoring NULL, Path Scoring NULL, Path Ranker NULL).

## Bit-exact gate preserved

3 β-1 baselines re-run with all flags OFF: byte-identical to `_bmad-output/solver-data/phase-1-baselines/plan-replay/*.result.json` except the single `pathPoints:0` line addition from the previous commit (013a10cb). PathBiasedRanker wrapping introduces no new divergence. 226/226 vitest tests pass; dfs-solver smoke test 43/43.

## Tooling shipped (reusable)

1. **`PathBiasedRanker`** — composable ranker decorator. Pattern: outermost wrapper with `delegateToInner` setter pass-through. Reusable for any future ranker that needs per-decision distinctActivations awareness (policy-network-guided rollouts, MCTS UCB priors, etc.).
2. **`SOLVER_USE_PATH_RANKER=1` + `SOLVER_PATH_RANKER_W=<N>`** — env-gated, default OFF.
3. **`SOLVER_DEBUG_PATH_RANKER=1`** — was used during this pilot for the boost-tracing instrumentation; removed before commit (kept the production code clean).
4. **DFS structural-type setDistinctActivations injection** — generic mechanism for any future ranker (path-biased, policy-guided, learned-bias) that wants per-handle activation context. No hard import dependency.

## Why NOT revert

The infra is **reusable for the new direction** (search-horizon levers):
- Macro-action compression (collapse SELECT_CHAIN/SELECT_EFFECTYN runs into single DFS nodes) would benefit from the same per-handle ranker context the PathBiasedRanker established.
- A Proof-Number Search or AND-OR DFS variant would use the same `setDistinctActivations` plumbing for goal-relevance pruning.
- MCTS UCB exploration with path-cards-not-yet-activated as a prior is a direct next test.

Cost of keeping: one extra env-gated decorator, ~110 LoC, default OFF means production runtime no-op.

## Files & references

- Implementation:
  - `duel-server/src/solver/path-biased-ranker.ts` (new, ~140 LoC after delegate)
  - `duel-server/src/solver/dfs-solver.ts` — DFS plumbing of `setDistinctActivations` via structural type detection
  - `duel-server/src/solver/solver-worker.ts` — wiring (production runtime)
  - `duel-server/scripts/evaluate-structural.ts` — wiring (eval harness) + dispatch fix
- Predecessors:
  - `path-scoring-pilot-2026-05-02.md` (Levier 3 NULL — predicted Path Ranker as next test)
  - `resource-scoring-pilot-2026-05-02.md` (Design D NULL — same diagnostic shape)
  - 2026-05-02 user discussion: Option B from path-scoring memo

## Recommendation for next session

**Pivot AGAIN — this time to search-horizon levers, not ranker/scorer levers.**

Three actionable directions:

### Option D — Macro-action compression (biggest ROI candidate)

Collapse runs of SELECT_CHAIN / SELECT_EFFECTYN / SELECT_SUM / SELECT_CARD that have a single legal response (or a deterministic optimal pick) into a single DFS node. ddd-canonical's 80 prompts likely contain ~50% mechanical decisions — compressing them to ~40 effective nodes would put canonical reach at 30-50 node budget, well within current 400.

Estimated effort: ~2-3 days. Risk: subtle parity bugs with replay/verify when compression mis-classifies a meaningful decision as mechanical. The `PromptResolver` infrastructure (Phase 0-7 shipped 2026-05-01) already classifies many SELECT_* prompts as mechanical — extending this to a compression pass at DFS level is a natural follow-on.

### Option E — MCTS with PathBiasedRanker-derived priors

MCTS rollouts can naturally reach depth ~80+ (no α-β cutoff). Wire PathBiasedRanker's `pathBonus` as a UCB prior weight in `MCTSSolver.selectChild()`. The bias guides selection toward path-progressing branches; the rollouts have the depth to verify they pay off.

Estimated effort: ~3 days. Risk: MCTS already killed for ddd in earlier work (`phase-3/mcts-policy-killed-2026-04-27.md`), but with a directed prior the verdict may differ.

### Option F — Authoring expertise on the 7 stuck fixtures (no R&D risk)

Same as Option A from the previous memo. Documented +5-10 cum matched, ~1-2d/fixture. **Preferred default** if the goal is `cumulative matched` increase rather than R&D continuation.

## Files produced this session

- Code: `path-biased-ranker.ts` (new), `dfs-solver.ts`, `solver-worker.ts`, `evaluate-structural.ts`
- This memo: `path-ranker-pilot-2026-05-02.md`
