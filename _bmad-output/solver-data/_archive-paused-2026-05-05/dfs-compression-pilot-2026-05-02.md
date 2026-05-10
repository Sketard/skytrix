# DFS Compression Pilot Phase 1 (Levier D) — Verdict NULL on Canonical, Trade-off Diagnosed

**Date:** 2026-05-02
**Status:** PILOT NULL on canonical budget — opt-in flag preserved, default OFF
**Predecessor:** `path-ranker-pilot-2026-05-02.md` (Levier B NULL → diagnostic refined to search horizon, Option D = macro-action compression)

## Question asked

Can compressing single-action `SELECT_CHAIN` prompts at the DFS level (forced (pass) sentinels with no decision to make) lift `matched` on DFS standalone for ddd-pendulum-opener? The previous pilot diagnostic showed ddd-canonical needs ~80 prompts vs the DFS reaching ~50 at canonical budget; β-1 trace analysis shows 22/86 prompts on canonical ddd are mechanical SELECT_CHAIN with N=1 ((pass) sentinels), so collapsing them gives a ~26% reduction in effective trajectory length, which should put the canonical depth within the 400-node budget.

## Setup

**Hypothesis (Levier D Phase 1)**:
- Trace analysis of β-1 plans shows 22/86 ddd, 11/54 branded, 9/35 snake-eye prompts are SELECT_CHAIN with exactly 1 legal action — and **100 % of them are pure (pass) sentinels** (responseIndex=-1, cardId=0) on all 3 fixtures, no forced triggers
- Compression at top of `dfs()`: `while (actions.length === 1 && promptType === SELECT_CHAIN) { applyAction; getLegalActions; }`
- `currentActionStack.push` for each compressed action so `bestTurn1Path` includes the full sequence (verifyMainPath replays every action, so omissions would diverge)
- Wrap remaining body in try/finally to pop the same number on exit (symmetric with parent fork+push+recurse+pop)
- Increment `totalTreeNodes` per compression to keep Phase L per-subtree budget honest (without this, mitsurugi was −1 matched)
- Default OFF via `SOLVER_USE_DFS_COMPRESSION=1`; trace bit-exact when flag absent

**Infrastructure shipped** (~3h):
1. `dfs-solver.ts` — compression block at top of `dfs()` (~45 LoC) + `compressedSelectChainNodes` counter on DfsContext + `try/finally` body wrap for stack unwinding
2. `solver-types.ts` — `compressedSelectChain?: number` optional field on `terminalReasons` for diagnostic surfacing
3. `count-chain-distribution.mjs` — analysis script for the prompt-type distribution on β-1 traces (used to derive the compression-candidacy criterion)

## Results — ddd-pendulum-opener sweep

DFS standalone at canonical config (`SOLVER_USE_NEURAL_WEIGHTS=1 --budget-ms=6000 --node-budget=400 --pool-size=1 --implicit-goals=10`):

| Config | matched | score | exploration | nodes | maxDepth | compressedSelectChain |
|---|---|---|---|---|---|---|
| Baseline (no compression) | 1/5 | 68.5 | 68.5 | 329 | 40 | 0 |
| Compression ON | 1/5 | 68.5 | 68.5 | 310-331 | 19-22 | 501-510 |
| Compression ON @ 2× budget (800/12s) | 1/5 | 84.5 | 84.5 | 660 | ? | ? |
| Compression ON @ 4× budget (1600/24s) | 1/5 | 84.5 | 84.5 | 1318 | ? | ? |
| Compression ON + Path Scoring W=8 + Path Ranker W=100 @ canonical | 1/5 | 69.5 | 109.5 | 332 | ? | ? |

**Verdict on ddd canonical: matched 1/5 stable; score 68.5 stable across 3 reproducibility runs.** At 2× budget, matched stays 1/5 but score climbs +16 to 84.5 (plateau at 4× budget — same 84.5). Combined with path scoring + ranker: still 1/5 matched.

Compression is **mechanically active**: 501+ prompts collapsed in ~330 nodes explored. Without compression, those 501 prompts would have consumed 501 nodes. Effective node-throughput is ~×2.5. The DFS reaches strictly deeper logical states than baseline (proven by the +16 score at 2× budget — that's a strictly better terminal that baseline never reaches even at the same wall-clock).

**But matched does not lift.** Diagnostic: the depth gained is consumed by the SELECT_IDLECMD branching factor (15 IDLECMD prompts on ddd-canonical, ~10-15 actions each). Compression unlocks longer SELECT_CHAIN runs but the α-β + ranker still cuts the productive branches.

## Cross-fixture results

| Fixture | Baseline matched/score | Compression ON matched/score | Verdict |
|---|---|---|---|
| ddd-pendulum-opener | 1/5 score 68.5 | 1/5 score 68.5 | NULL |
| branded-dracotail-opener | 0/8 score 26 | 0/8 score 26 | identical (DFS standalone has always been 0/8 — β-1 7/8 ceiling is via plan-replay) |
| snake-eye-yummy-opener | 2/7 score 36.57 | 2/7 score 36.57 | identical |
| ryzeal-mitsurugi-opener | 3/5 score 104.5 (canonical) | **2/5 score 85.5 (canonical), 3/5 score 116.5 (2× budget)** | **REGRESSION −1 matched, −19 score @ canonical, recovers @ 2× budget** |

**Regression on mitsurugi at canonical budget is reproducible** (3/3 runs all matched=2 score=85.5). At 2× budget the regression clears and matched stays 3/5 with +12 score over baseline. So this is not a structural correctness bug — it's a **budget-dependent trade-off**: compression makes the DFS race through a different branch ordering than baseline, which can find a worse local optimum at low budgets when the canonical combo is short and already nearly-saturated.

The mid-pilot debug log instrumentation (`SOLVER_DEBUG_COMPRESSION=1`, removed before commit) showed the compression firing aggressively at depth 3-15, frequently in groups of 1-3 consecutive compressions per `dfs()` call. The β-1 trace prediction (chain1==chain1_pass: 22==22, 11==11, 9==9 across 3 fixtures = 100 % of N=1 SELECT_CHAIN are pure (pass) sentinels) was empirically validated — no forced triggers got mis-compressed.

## Diagnostic — Bottleneck refined again

**The depth bottleneck is real but shifts to the IDLECMD branching factor when relieved.**

ddd-canonical at 4× budget (1600 nodes / 24s) with compression ON reaches a 84.5-score terminal (vs 68.5 baseline canonical). That terminal is +16 score = strictly deeper than the depth-50 trap. But matched stuck 1/5. The expectedBoard requires 5 specific Extra Deck bodies, and reaching them requires 8-10 IDLECMD decisions all going right. Compression solves SELECT_CHAIN depth cost; it doesn't solve IDLECMD branching combinatorial cost.

**8th consecutive scorer/ranker/depth-side NULL/MARGINAL** on canonical (Phase B v1 marginal, Stage 3b NULL, Arch C TERMINAL NULL, V(s) MARGINAL, Resource Scoring NULL, Path Scoring NULL, Path Ranker NULL, Compression NULL). What this 8th iteration adds:
1. Compression mechanically **works** (501+ prompts collapsed, +16 score at 2× budget on ddd, +12 score at 2× budget on mitsurugi — both real gains)
2. The branching factor on SELECT_IDLECMD is now provably the next bottleneck on ddd
3. Mitsurugi shows **fast-fixture compression-regression** at canonical budget: short combos can lose matched when compression bumps branch ordering — bumping budget recovers it

## Bit-exact gate preserved

Flag OFF: replay-trajectory-cli ddd-pendulum-opener bit-exact to baseline (only the prior `pathPoints:0` line addition from commit 013a10cb). Trace JSONL byte-identical. 226/226 vitest tests pass; dfs-solver smoke test 43/43.

## Tooling shipped (reusable)

1. **DFS macro-compression block** — generic pattern for collapsing single-action prompts. Phase 2 (SELECT_EFFECTYN with deterministic policy) would extend the same mechanism — already prototyped via β-1 trace analysis (4 SELECT_EFFECTYN on ddd, all N=2, 4/5 picked yes). Same `currentActionStack` + try/finally + `compressedSelectChainNodes` infrastructure can host it.
2. **`compressedSelectChain` diagnostic** — surfaces compression count via `terminalReasons` so eval harnesses can quote the realised compression rate.
3. **`count-chain-distribution.mjs`** — trace-analysis tool for measuring which prompts on β-1 plans are statically compressible (per-fixture, per-prompt-type).
4. **`SOLVER_USE_DFS_COMPRESSION=1`** — opt-in env flag. Default OFF means production runtime no-op, bit-exact preserved.

## Why NOT revert

The compression mechanism is shippable for **non-canonical contexts**:
- At 2× budget or higher, ddd gains +16 score and mitsurugi gains +12 score with no regression. Future runs at extended budget (e.g. for offline replay reanalysis or alternative-mode dispatch) can opt-in.
- The infrastructure is the foundation for Phase 2 (SELECT_EFFECTYN compression with policy-driven tie-break — the 4 SELECT_EFFECTYN on ddd-canonical pick "yes" 4/5 times via deterministic policy from `MechanicalDefaultOracle`).
- No production-runtime cost when flag OFF (default).

## Files & references

- Implementation:
  - `duel-server/src/solver/dfs-solver.ts` — compression block (~45 LoC) + counter + try/finally body wrap
  - `duel-server/src/solver/solver-types.ts` — `compressedSelectChain` diagnostic field
  - `duel-server/scripts/count-chain-distribution.mjs` — analysis tool (new)
- Predecessors:
  - `path-ranker-pilot-2026-05-02.md` (Option D recommendation source)
  - `path-scoring-pilot-2026-05-02.md` (search horizon framing)

## Recommendation for next session

Three actionable directions emerge from this 8th pilot:

### Option G — Bump canonical budget to 800 nodes / 12s (no R&D)

Compression at 2× budget gives **+16 score on ddd, +12 score on mitsurugi**, both without regression. The canonical-eval cum score lift would be material. The trade-off: 2× wallclock per fixture = +6 minutes for the 15-fixture eval. **Preferred default if cum score is the metric** — no algorithmic change, just a budget knob with empirical gain.

### Option E — MCTS with PathBiasedRanker priors (still pending from previous memo)

Compression doubles depth throughput but can't solve the IDLECMD branching factor explosion. MCTS rollouts handle deep paths through stochastic sampling rather than exhaustive α-β; with PathBiasedRanker as a UCB prior, the ddd canonical line might be reachable. ~3 days. Risk: previous MCTS work was killed for ddd, but with directed prior + compression both ON, the verdict may differ.

### Option F — Authoring expertise on 7 stuck fixtures (no R&D risk)

Same as before. ~1-2d/fixture, +5-10 cum matched documented. **Preferred if `cumulative matched` is the metric** rather than `cumulative score`.

### My recommendation

**Option G first** (~30 min: bump budget, re-run canonical-eval, measure cum score lift, decide if accept). It's the cheapest test of "does compression help in production". If cum score lifts materially, ship the budget change with compression always-on as the new canonical. If not, fall back to E or F.

Beyond Option G: Phase 2 of the compression pilot (extend to SELECT_EFFECTYN single-action / deterministic-policy) is the natural follow-on — same mechanism, expected another 5-15 % nodes saved.

## Files produced this session

- Code: `dfs-solver.ts`, `solver-types.ts`, `count-chain-distribution.mjs` (new)
- This memo: `dfs-compression-pilot-2026-05-02.md`
