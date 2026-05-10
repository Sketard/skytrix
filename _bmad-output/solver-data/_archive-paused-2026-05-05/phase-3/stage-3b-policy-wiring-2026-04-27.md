# Phase 3 Stage 3b — PolicyGuidedRanker Wiring + Negative Result

**Date:** 2026-04-27
**Status:** SHIPPED (wiring) + NEGATIVE RESULT (gate fails)
**Predecessor:** `stage-3a-augmentation-2026-04-27.md`
**Decision:** Pivot to card-level policy or feature engineering — verb-class bias doesn't lift cum matched

---

## What this stage delivered

1. **`src/solver/policy-guided-ranker.ts`** — `PolicyGuidedRanker` implements
   `ActionRanker`, wraps inner ranker (NeuralFeatureRanker by default), applies
   verb-class soft-bias only at `SELECT_IDLECMD`. Composition: setters
   delegate to inner so per-fixture deck-pool / metadata pushes update both.
2. **`src/solver/verb-policy-loader.ts`** — env-gated loader mirroring
   `neural-weights-loader.ts`. `SOLVER_USE_VERB_POLICY=1` +
   `SOLVER_VERB_POLICY_FILE=<basename>` (default `verb-policy-latest`).
   Loud-failure semantics, JSON trace at `data/training-logs/loader-trace.jsonl`.
3. **Wiring** — both `solver-worker.ts` (PvP/Replay runtime) and
   `evaluate-structural.ts` (eval harness). Off by default; opt-in via env.
4. **Canonical pointer** — `data/policy-weights/verb-policy-latest.json` =
   v2 weights from `policy-weights/v2/verb-policy-v1.json`.
5. **Smoke + full eval** — 14-fixture eval at canonical 6s/nb=400 with
   biasScale sweep (25/50/100/200).

---

## Result — gate fails on cum matched

### Gate criterion (from Stage 2 memo)
- ≥ +3 cum matched on 14-fix hold-out vs MLP v3 sd7 baseline (22 matched)
- OR ≥ 2× avg trajectory length

### Stage 3b cum matched / score by config

| Config | Cum matched | Cum score |
|---|---:|---:|
| Control (no policy) | 25 | 511 |
| Policy biasScale=25 | 25 | 511 |
| Policy biasScale=50 | 25 | **520** |
| Policy biasScale=100 (canonical) | 25 | 483 |
| Policy biasScale=200 | 25 | 458 |

**Cum matched static at 25 across all biasScales.** Score moves a little
(+9 best at biasScale=50, -53 worst at biasScale=200). Per-fixture matched
breakdown unchanged across all configs — the policy doesn't surface new
terminal cards.

### Per-fixture deltas vs control (biasScale=100)

12/15 fixtures: identical to control. 3/15 regressions:
- **ryzeal-mitsurugi-opener**: score 58 → 32 (-26). Policy boosting
  normal-summon over activate; ryzeal's combo needs activate-first.
- **radiant-typhoon-opener**: score 38 → 37 (-1). Marginal.
- **horus-crystron-opener**: score 43 → 42 (-1). Marginal.

Better at biasScale=50:
- **branded-dracotail-opener**: score 70 → 80 (+10) at biasScale=50.

These are score-only deltas (matched stays at 4/8 for branded, etc.) —
the policy nudges into a slightly different terminal but never one with
more matched cards.

---

## Why the result is null

### Architectural reason

Verb-class bias only fires at `SELECT_IDLECMD`. But:
1. **DFS already evaluates ALL legal actions** at SELECT_IDLECMD (pre-α-β).
   Reordering changes exploration order, not terminal set.
2. **Most branching at deep tree levels is SELECT_CARD** (target picker,
   material selector). Verb policy doesn't bias these prompts.
3. **Value bonus already does heavy lifting** on IDLECMD ordering — the
   neural ranker's forward pass produces a ranking that incorporates
   value estimation. Verb policy adds a redundant prior on top of an
   already-good ordering.

### Distributional mismatch

The v2 policy was trained on a multi-seed corpus (sd7+sd11+sd42), where
sd11/sd42 picked normal-summon more often than canonical sd7. The
deployed solver runs sd7 weights. Policy thinks normal-summon is more
common than it is at sd7's distribution → over-promotes normal-summon
for fixtures (ryzeal) where activate is the canonical first move.

This was flagged in the augmentation memo cross-distribution check:
"For Stage 3b deployment with the canonical sd7 weights, the policy
will under-predict activate. Whether this hurts or helps DFS lift is
an empirical question to test in Stage 3b." — empirical answer: it
hurts (-26 on ryzeal), or at best is neutral on most fixtures.

### Information-theoretic reason

CV showed v2 mean P(true) = 0.314 vs class-prior 0.278. The +0.036 gap
is small information gain (0.13 nats). For a soft-bias re-ranker, this
translates to ~13% relative bias toward the correct verb. The DFS already
explores 5-10 IDLECMD actions per prompt — reorder them by ±13% policy
weight rarely changes which terminal is actually visited.

---

## Stage 3 success criterion — pivot triggered

Per Stage 2 memo: "If neither lift materializes, Phase 4 = 'negative
result' memo, pivot back to scorer revision or features."

Stage 3a beat class prior (small lift, +0.036 mean P(true)). Stage 3b
showed that beat doesn't translate to DFS lift. Three pivots possible:

### Pivot A — card-level policy (not verb-level)
Train a policy that predicts WHICH CARD to play, not which VERB class.
Card-level signals would actually change which terminal DFS reaches
(boosting Branded Fusion over Pot of Duality, not just "activate over
normal-summon"). Cost: much harder training problem (40+ classes per
fixture, deck-specific output space). Requires deck-conditioned outputs
or shared embedding.

### Pivot B — SELECT_CARD policy
Most actual decision branching at deep DFS levels happens at SELECT_CARD
(target picker, materials, etc.). Train a policy specifically for these
prompts to bias toward "good targets". Engineering: requires extending
state features to include current chain context and target candidate
metadata.

### Pivot C — back to feature engineering / scorer
The Stage 3 verb-policy approach proved that bias-as-soft-prior doesn't
change DFS terminal set at production budget. The lever that DOES
change terminals is the ranker's VALUE estimate (the neural bonus).
Investing in better features for the value ranker (cf. Phase B day-1.5
"axes" memo) or a richer scorer may yield more.

### Pivot D — accept v2 policy as null result + freeze
Document the ceiling, freeze the wiring as opt-in (already env-gated
off by default), move on. Cheap option.

---

## Recommendation

**Pivot D + queue Pivot B for next session.**
- Stage 3b wiring is shipped, runtime-validated, opt-in. No regression
  risk in production (off by default).
- v2 policy weights are committed; future card-level / SELECT_CARD
  experiments can reuse the corpus + extractor + trainer pipeline.
- Pivot B (SELECT_CARD policy) is the highest-leverage next step —
  larger branching factor → policy bias has more room to matter.

The Stage 3 long-term vision (solver receives only `(deck, hand)`,
outputs max-interruptionScore endboard + trajectory) is NOT abandoned;
Stage 3b just confirms verb-class is the wrong abstraction layer.

---

## Files & references

- Wiring (committed this stage):
  - `duel-server/src/solver/policy-guided-ranker.ts`
  - `duel-server/src/solver/verb-policy-loader.ts`
  - `duel-server/src/solver/solver-worker.ts` (env-gated wrap)
  - `duel-server/scripts/evaluate-structural.ts` (env-gated wrap)
- Canonical weights pointer: `duel-server/data/policy-weights/verb-policy-latest.json`
- Eval results: `duel-server/data/eval-stage-3b/{control,policy,policy-bias-25,policy-bias-50,policy-bias-200}.json`
- Predecessor memos:
  - `stage-3a-policy-baseline-2026-04-27.md`
  - `stage-3a-augmentation-2026-04-27.md`

---

## Out of scope this stage

- Pivot A (card-level policy) — separate session, requires deck-conditioned
  output design.
- Pivot B (SELECT_CARD policy) — separate session, requires extended
  state features + target-candidate features.
- MLP variant of the verb policy — n=101 would still overfit hard for
  MLP[16] ≈ 1k params; defer.
- True out-of-distribution eval (train on sd7+sd11, test on sd42) —
  retrospective interest only now that gate fails.
