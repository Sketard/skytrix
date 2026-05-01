# MCTS+Policy — Killed Before UCT Prior

**Date:** 2026-04-27
**Status:** KILLED (no commits — diagnostic only)
**Predecessor:** `eval-noise-audit-2026-04-27.md`
**Decision:** Skip MCTS as policy host; pivot to SELECT_CARD policy on DFS.

---

## TL;DR

MCTS at canonical config (`SOLVER_USE_NEURAL_WEIGHTS=1 --algorithm=mcts
--budget-ms=6000 --node-budget=400 --implicit-goals=10`) scores
**420 cum vs DFS 511 (-18%)** before any policy is applied.

Adding a verb-class policy as UCT prior cannot recover this gap — MCTS
needs to at least match DFS at base for "MCTS+policy surfaces deeper
terminals" to be plausible.

Test killed before writing the UCT-prior patch. ~2-3 days saved.

---

## What was attempted

1. Audited `MCTSSolver` UCT formula (`mcts-solver.ts:269`): plain UCB1 =
   `score + C * sqrt(ln(parent.visits) / child.visits)`, no prior term.
   Adding policy prior would require AlphaZero-style PUCT modification.
2. Ran MCTS baseline (no policy) at canonical config to verify it could
   match DFS+neural's 25 cum matched / 511 cum score before pivoting.
3. Result: **MCTS cum score 420** (vs DFS 511, -91 pts, -18%), cum
   matched read as 0 due to a separate measurement gap (MCTSSolver
   doesn't populate `result.stats.diagnostic.bestTurn1FieldState`,
   which is what `evaluate-structural.ts` reads — see solver-types.ts
   `DfsDiagnostic` is DFS-specific). The score gap is real and not
   the measurement gap.

---

## Why MCTS is structurally weaker than DFS at this budget

DFS+neural at `nb=400 / 6s` has three engines working together that
MCTS lacks:

1. **Alpha-beta pruning** — once a lower bound is established, branches
   that can't beat it are cut. MCTS spreads visits more uniformly.
2. **Transposition table** — DFS short-circuits on revisited states.
   MCTSSolver doesn't use a TT (mcts-core.ts:88: `transpositionHits: 0`).
3. **Iterative deepening** — DFS commits all budget to deeper exploration
   on the proven-good branch. MCTS keeps exploring siblings via UCB1
   even after the best branch is found.

At narrow search trees (typical YGO combo decisions), DFS's targeted
deepening dominates MCTS's uniform exploration. MCTS shines at WIDE
trees where uniform sampling beats greedy depth — not our regime.

---

## Why we can't fix this with policy

A policy prior helps MCTS by biasing UCB1 selection toward high-prob
actions. Best case: it makes MCTS slightly more efficient at depth.
But the structural disadvantages (no α-β cutoff, no TT) remain. Even
a perfect policy wouldn't close the 18% gap to DFS+neural at this
budget — DFS would also benefit from the same policy via biased
move-ordering, and DFS still has its α-β + TT advantages.

The hypothesis "MCTS+policy surfaces deeper terminals than DFS" rests
on MCTS *being able to look further* by sampling smartly. It can't —
DFS already looks further via deepening.

---

## What's next — Pivot B (SELECT_CARD policy on DFS)

Sticks to DFS as the search engine. Trains a policy specifically for
SELECT_CARD prompts (target picker, materials selector — the deep-tree
branching factor). Wires as ranker bias on those prompts.

Why this is the last live policy-paradigm hypothesis:
- Verb-class on SELECT_IDLECMD = ranker-redundant (Stage 3b null)
- MCTS as alternate engine = structurally weaker (this memo)
- SELECT_CARD policy on DFS = unfalsified, biggest leverage left

Cost estimate: ~2 weeks (state features + corpus + train + wire + eval).

If Pivot B also nulls, the policy-as-bias paradigm is exhausted at our
budget regime. Recommendation at that point: Pivot D (freeze ML R&D,
ship status quo 25/69 as v1, switch to product features).

---

## Files & references

- `data/eval-mcts/baseline.json` (15-fix MCTS baseline)
- `_bmad-output/solver-data/phase-3/eval-noise-audit-2026-04-27.md`
- `_bmad-output/solver-data/phase-3/stage-3b-policy-wiring-2026-04-27.md`
