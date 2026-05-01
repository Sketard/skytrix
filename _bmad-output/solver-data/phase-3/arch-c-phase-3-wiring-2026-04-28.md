# Phase 3 Architecture C — Phase 3 Wiring (NULL GATE)

**Date:** 2026-04-28
**Status:** SHIPPED (eval) + NEGATIVE RESULT (gate fails)
**Predecessor:** `arch-c-phase-2-distillation-2026-04-28.md`
**Decision:** Architecture C dead. Bias-as-ranker paradigm exhausted. Pivot.

---

## TL;DR

LLM-distilled policy v1 (n=17 hydrated annotations, CV P(gtVerb)=0.363
beat v2's 0.314) **does not lift cum matched on the 14-fix canonical
hold-out**. At biasScales 5/10/25/50 the result is bit-identical to
control (26/69 matched, 523 score); at higher scales it regresses.

| Config | matched | score | Δ vs control |
|---|---:|---:|---|
| Control (no policy) | **26** | **523** | reference |
| Distilled tau=2 bs={5,10,25,50} | 26 | 523 | **0 / 0** |
| Distilled tau=2 bs=100 | 26 | 513 | 0 / **-10** |
| Distilled tau=2 bs=200 | 24 | 468 | -2 / -55 |
| Distilled tau=1 bs=50 | 25 | 506 | -1 / -17 |
| Distilled tau=1 bs=100 | 24 | 479 | -2 / -44 |

Gate ≥+3 matched: **FAIL across all configs.** Gate ≥+0 matched: tied at
the right biasScale band, regressed elsewhere.

The CV signal (LLM beats DFS-argmax verb prediction at LOFO) is REAL —
the policy *is* better at predicting the LLM's preferred verb. But the
verb-class abstraction does not translate that signal into DFS terminal
lift, just as Stage 3b proved one day prior at n=101 multi-seed
DFS-argmax labels.

---

## Reproducibility note — canonical config recovered

Initial run with `SOLVER_USE_NEURAL_WEIGHTS=1` only gave control 18/69
(σ-impossible drift vs Stage 3b's recorded 25/69). Cause: missing
`SOLVER_DISABLE_EXPERTISE=1` and `--pool-size=4` per the noise-audit
memo. With the full canonical env:

```
SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 \
  npx tsx scripts/evaluate-structural.ts \
    --budget-ms=6000 --node-budget=400 --pool-size=4 --implicit-goals=10
```

control jumped back to 26/523 (close to Stage 3b's 25/511 — minor +1/+12
drift acceptable per audit σ_score=0.49 + per-fixture variance).

Adopted as canonical eval baseline for this stage:
`data/eval-arch-c/control.json` (26 matched / 523 score).

---

## What this stage delivered

1. **`data/eval-arch-c/control.json`** — fresh canonical control on
   today's HEAD. 26/523 matched/score.
2. **`data/eval-arch-c/distilled-bs{5,10,25,50,100,200}.json`** — full
   biasScale sweep with tau=2 distilled weights.
3. **`data/eval-arch-c/distilled-tau1-bs{50,100}.json`** — tau=1 sweep
   to confirm the CV-best τ underperforms tau=2 in production (sharper
   targets → overconfident logits → worse calibration at deployment).
4. **Verdict memo (this file)**.

---

## Why bs={5..50} are bit-identical to control

The bias term `biasScale × P(verb)` competes with the base rank score
`baseRankScale × (N − rank)` (default `baseRankScale=30`). For two
adjacent ranks, the gap is `30`. To flip them, the policy bias must
exceed 30:

```
30 < biasScale × ΔP_verb     →     ΔP_verb > 30 / biasScale
```

| biasScale | ΔP_verb to flip |
|---:|---:|
| 5 | 6.0 (impossible — P ≤ 1) |
| 10 | 3.0 (impossible) |
| 25 | 1.20 (impossible) |
| 50 | 0.60 (very rare) |
| 100 | 0.30 (occasional) |
| 200 | 0.15 (frequent) |

At bs ≤ 25, the policy can essentially never reorder anything → identity
delegation to inner ranker → matches control bit-for-bit. At bs=50,
flips need ΔP_verb > 0.60 — which the distilled policy DOES produce on
some prompts (tau=1 sharper, tau=2 less so), but those flips don't
surface different terminals (DFS already found the best one within
α-β and 200-node budget).

At bs=100/200, the policy starts forcing flips that DON'T align with
DFS's value estimate → regression.

This is the same ceiling Stage 3b hit with v2 weights. Architecture C
distillation does not escape it.

---

## Why CV pass didn't predict Phase 3 lift

CV measures: "given a held-out state, can the policy predict the GT
verb and the LLM-preferred verb with high mass?" The answer is yes
(P(gtVerb)=0.363 > 0.314).

Phase 3 measures: "does that prediction, applied as soft-bias on top
of an already-good ranker, change which terminal DFS reaches?" The
answer is no — at any biasScale.

Three reasons:
1. **Verb-class is too coarse.** "Activate" covers 5+ different cards
   per prompt. The LLM picked a *specific card* in `llmRanked`; we
   collapsed that into "verb=activate". The ranker can't distinguish
   *which* activate is preferred. DFS picks one within the activate
   cluster, often the same one with or without policy.
2. **DFS already evaluates all IDLECMD actions** at depth 1. Reordering
   changes exploration order, not the terminal set found within
   200 nodes (α-β + iterative deepening converge fast).
3. **Most branching at deep tree levels is SELECT_CARD** (target picker,
   material selector). Verb-policy doesn't bias these. The leverage
   point is in the wrong prompt class.

Stage 3b's prediction ("verb-class abstraction is ranker-redundant")
generalizes to LLM-distilled labels too. The bottleneck is the
abstraction layer, not the labels.

---

## Why tau=1 underperforms tau=2 in production

CV table:

| tau | P(gtVerb) | P(llmTop) | KL |
|---:|---:|---:|---:|
| 1.0 | **0.381** | 0.498 | 0.592 |
| 2.0 | 0.363 | 0.447 | 0.409 |
| 4.0 | 0.338 | 0.393 | 0.297 |

tau=1 wins CV on P(gtVerb) but loses production. The mechanism:
sharper targets → sharper LR logits → sharper softmax at deployment
→ rare states with extreme probabilities → bs=50 already reaches
ΔP_verb > 0.60 on those states → forced flips that DFS doesn't agree
with → regression. Confirms the trainer's loss reflects training-set
fit, not deployment robustness, at small n.

---

## Architecture C verdict

Per the Phase 2 brief decision tree:

> Si Phase 2 réussit mais Phase 3 null → bias-as-ranker paradigm
> vraiment dead; le LLM signal ne se traduit pas en DFS lift même bien
> distillé.

**Phase 2 passed (CV gate). Phase 3 fails (matched gate). Architecture
C joins the Stage 3b dead-end pile.** Bias-as-ranker on verb-class is
exhausted at our budget regime regardless of label source (DFS-argmax
n=101 OR LLM-soft n=17).

What's still live:
- Path 1 (heavy compute) — bigger budgets / depth
- Path 4 (imitation authored) — DFS hint pins on canonical lines (see
  `--use-hints` infra + `branded-dracotail-hint-audit-2026-04-26`)
- Pivot D (freeze ML R&D) — ship 26/69 as v1 ceiling, switch to product
- (Live but expensive) Card-level / action-level policy — different
  abstraction, escapes the verb-class ceiling, requires deck-conditioned
  outputs and a much bigger corpus

What's dead:
- Stage 3a/3b — verb-class on DFS-argmax (multi-seed n=101)
- MCTS+policy — MCTS structurally weaker than DFS at this budget
- Architecture C — verb-class on LLM-soft (n=17, this stage)

---

## Honest takeaway

The full Phase 3 ML loop (Stage 1 corpus → Stage 2 quality audit →
Stage 3a verb-class baseline → Stage 3b wiring → MCTS pivot →
Architecture C LLM teacher) explored 5 hypotheses across the
bias-as-ranker paradigm in 2 days. All 5 nulled. The paradigm is
robust to label source, label sharpness, and engine choice (DFS vs
MCTS).

The next hypothesis — card-level policy or imitation as hint-pin —
will need to abandon "soft-bias on top of strong ranker" entirely.
That's a different research program, not a Phase 3 sub-pivot.

---

## Files & references

- Eval results: `data/eval-arch-c/{control,distilled-bs5,...,distilled-tau1-bs100}.json`
- Predecessor: `_bmad-output/solver-data/phase-3/arch-c-phase-2-distillation-2026-04-28.md`
- Stage 3b parallel: `_bmad-output/solver-data/phase-3/stage-3b-policy-wiring-2026-04-27.md`
- Eval noise audit (canonical config spec): `_bmad-output/solver-data/phase-3/eval-noise-audit-2026-04-27.md`

---

## Recommendation

**Pivot D (freeze ML R&D, ship 26/69 as v1)** unless user has appetite
for the longer card-level program.

The verb-class paradigm is provably dead at our budget regime. Card-level
is a multi-week research program with no guaranteed lift; imitation as
hint-pin is closer to product engineering than ML and has bounded
upside (only lifts fixtures with authored hints).

If user picks Pivot D: leave the distillation pipeline + canonical
weights opt-in (already env-gated off), document the dead-end memo,
move to product features.
