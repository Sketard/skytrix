# Phase 3 Stage 3a — Verb-Class Policy MVP Baseline

**Date:** 2026-04-27
**Status:** SHIPPED (livrables) + HONEST RESULT (signal weak at n=35)
**Predecessor:** `stage-2-quality-2026-04-27.md`
**Decision needed:** Stage 3b wiring path (augment first OR proceed with weak policy)

---

## What this stage delivered

Four livrables, all type-clean, all run-tested:

1. **`scripts/extract-policy-training-data.ts`** — corpus → JSONL training
   set. Filters SELECT_IDLECMD with non-null `actionVerb`, materializes 58-dim
   state vectors, computes inverse-frequency class weights with Laplace
   smoothing, writes `manifest.json` + `training.jsonl`.
2. **`src/solver/verb-policy.ts`** — runtime forward pass (LR + softmax).
   `featureSpecHash` validation at load. `setWeights(undefined)` fallback
   contract mirrors `neural-ranker.ts`.
3. **`scripts/train-verb-policy.ts`** — class-weighted CE + L2 with
   stratified k-fold (or LOOCV via `--folds=N`). Produces `verb-policy-v1.json`
   + `cv-report.json` with top-1, top-2, mean P(true), mean log P(true).
4. **`scripts/evaluate-verb-policy.ts`** — standalone evaluator on any
   trajectory corpus. Confusion matrix + per-class precision/recall/F1.

Trained `data/policy-weights/v1/verb-policy-v1.json` from
`data/trajectories/phase-b-v2-mlpv3-sd7/` (35 SELECT_IDLECMD samples).

---

## Honest result — n=35 is too small to beat a class prior

### LOOCV metrics (canonical hyperparameters: seed=42, lr=0.1, l2=0.001, epochs=1000)

| Metric | Value | Reference |
|---|---:|---|
| Top-1 accuracy | 51.4% | Majority-class baseline 62.9% (worse) |
| Top-2 accuracy | 77.1% | Uniform 2-of-5 = 40.0% (almost 2×) |
| Mean P(true)   | 0.434 | Class-prior baseline 0.432 (parity) |
| Mean log P(true) | -1.439 | Uniform -1.609 (slightly better) |

### Per-class LOOCV (precision / recall)

| Class | Support | Precision | Recall |
|---|---:|---:|---:|
| activate (n=22, 62.9%) | 22 | 66.7% | 54.5% |
| set-st (n=4, 11.4%) | 4 | 42.9% | 75.0% |
| summon-procedure (n=4, 11.4%) | 4 | 50.0% | 50.0% |
| set-monster (n=3, 8.6%) | 3 | 20.0% | 33.3% |
| normal-summon (n=2, 5.7%) | 2 | 0.0% | 0.0% |

### In-sample (overfit signature)

In-sample top-1 = 80%, top-2 = 94.3%, mean P(true) = 0.649.
Gap to LOOCV (51.4% top-1) is the overfit cost: with 35 samples and 295
weight params, the model memorizes individual training points but
generalizes to "barely-better-than-class-prior".

### L2 sweep (LOOCV — diagnostic only, all on same dataset)

| L2 | Top-1 | Top-2 | Mean P(true) | Mean log P(true) | Final loss |
|---:|---:|---:|---:|---:|---:|
| 0.1    | 45.7% | 80.0% | 0.243 | -1.452 | 1.038 |
| 0.01   | 48.6% | 77.1% | 0.324 | -1.310 | 0.611 |
| **0.001** | **51.4%** | **77.1%** | **0.434** | **-1.439** | **0.302** |
| 0.0001 | 48.6% | 77.1% | 0.472 | -1.698 | 0.229 |

L2=0.001 is the canonical pick: best top-1, mean P(true) at class-prior
parity, log-prob still better than uniform. L2=0.0001 overfits (highest
P(true) but worst log-prob — overconfident on mistakes).

---

## Interpretation

### What the policy IS learning

- **Top-2 80% vs uniform 40%** is the single strongest signal. The true
  verb is in the policy's top-2 predictions four times out of five.
  This IS usable as a soft prior for ranker biasing.
- **set-st recall 75%, summon-procedure recall 50%** are well above their
  empirical priors (11.4%, 11.4%). The class-weighted CE is doing its job
  — minorities ARE getting boosted detection.
- **Mean log P(true) -1.439 vs uniform -1.609** = ~0.17 nats of
  information per sample. Not nothing, but not strong either.

### What the policy is NOT learning

- **Top-1 51.4% vs majority 62.9%** — the model loses argmax accuracy by
  trying to detect minorities. A "always predict activate" predictor
  would beat the trained model on argmax.
- **Mean P(true) 0.434 ≈ class-prior 0.432** — the policy gives the same
  expected mass to the true label as a fixed empirical-frequency
  predictor. No measurable signal beyond class prior on this metric.
- **normal-summon 0% / 0%** — 2 samples is too few for the model to
  learn anything; the LR's decision boundary for normal-summon is
  effectively random.

### Verdict

The model has **measurable signal but at the floor of class-prior parity**.
Causes:
1. n=35 strategic samples is below the threshold where dim-58 LR can find
   stable boundaries. Rule of thumb: ≥10× samples per class × dim → we'd
   want ~580 samples for dim 58 / 5 classes. We have 35.
2. Class imbalance amplifies the problem: 2 normal-summon samples cannot
   pin a decision boundary, no matter the regularization.
3. Stage 2 finding "feature-conditioning gives weak signal" is confirmed —
   no single feature is sharply discriminative; the model has to learn
   non-trivial combinations from too few examples.

---

## Recommendation — augment before Stage 3b wiring

### Why not ship Stage 3b now with v1 weights

The Stage 3b ranker would be a soft-bias re-ranker. With a policy at
class-prior parity, the bias is barely informative. Wiring it into DFS,
running 14-fixture evaluation, and measuring `+3 cum matched OR 2× length`
is a 4-6h compute spend. If the policy is truly at class-prior parity,
this will return "no measurable lift" and we'll have spent the budget
before testing the actual hypothesis.

### Augmentation paths (cheapest first)

| Path | Expected sample count | Compute cost | Risk |
|---|---:|---:|---|
| A. Top-K alternatives per fixture (TOP_K=3) | ~105 | minimal (re-process existing dumps) | data redundant — alts may share early decisions with mainPath |
| B. Multi-budget corpus (6s / 12s / 24s) | ~70-100 | ~30 min wall | longer-budget trajectories may differ; unknown how much |
| C. Multi-seed corpus (5 seeds × 14 fix) | ~175 | ~10 min wall | DFS is deterministic — different seeds may yield SAME trajectory if no tie-break randomization. NEEDS investigation. |
| D. More fixtures (Tier-B + Tier-C decks) | varies | depends on fixture availability | adds heterogeneity; closest to true generalization eval |
| E. Authored canonical-line corpus | ~80 (2 fixtures × 30-40 steps) | already exists | only 2 fixtures, biased toward those archetypes |

**Recommended sequence:** A → B (combined) is the minimal cheap test.
~150-200 samples in <1h compute. If LR moves above class prior on log-prob
(< -1.5 nats) and top-1 above majority, augmentation worked → Stage 3b
gets a non-toy policy. If still floors at class-prior, signal is
fundamentally weak at this dim — escalate to D + E.

### Pivot path if augmentation doesn't lift

Two fall-back hypotheses:
1. **Feature gap**: 58 state features are demographic (counts, totals)
   but lack action-context features. Could add per-card-in-hand features
   (e.g., "is starter ⊕ is_extender for the highest-scoring playable
   hand card"). Feature engineering pivot.
2. **Wrong abstraction level**: verb-class as a label drops critical
   information (which CARD activates matters as much as which VERB).
   Could move to card-level classification or hierarchical (verb-then-card).

These are larger pivots — defer until augmentation is exhausted.

---

## Files & references

- Livrables (committed in this stage):
  - `duel-server/scripts/extract-policy-training-data.ts`
  - `duel-server/src/solver/verb-policy.ts`
  - `duel-server/scripts/train-verb-policy.ts`
  - `duel-server/scripts/evaluate-verb-policy.ts`
- Trained weights: `duel-server/data/policy-weights/v1/verb-policy-v1.json`
- Training data: `duel-server/data/policy-training/v1/`
  (`training.jsonl` + `manifest.json`)
- CV report: `duel-server/data/policy-weights/v1/cv-report.json`
- Stage 1 corpus: `duel-server/data/trajectories/phase-b-v2-mlpv3-sd7/`
- Predecessor memos:
  - `stage-1-trajectory-infra-2026-04-27.md`
  - `stage-2-quality-2026-04-27.md`
- Strategic direction: `solver-ml-strategic-direction` (memory)

---

## Out of scope this stage

- Augmentation runs (paths A-E above) — separate session, separate decision.
- Stage 3b wiring (`PolicyGuidedRanker` composition) — gated on augmentation
  outcome.
- MLP variant of the policy — n=35 would overfit even worse; revisit only
  with augmented dataset.
- Card-level / hierarchical policy — pivot path, only if augmentation
  exhausted.
