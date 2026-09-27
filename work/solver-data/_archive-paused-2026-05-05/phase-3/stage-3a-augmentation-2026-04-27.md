# Phase 3 Stage 3a v2 — Multi-Seed Augmentation Result

**Date:** 2026-04-27
**Status:** SHIPPED — augmentation lifted policy above class prior, Stage 3b unblocked
**Predecessor:** `stage-3a-policy-baseline-2026-04-27.md`
**Decision:** Proceed to Stage 3b ranker wiring

---

## What this stage delivered

1. **Top-K alt extraction wired** in `evaluate-structural.ts` (`--dump-trajectories-alts=K` flag, plumbs through `FixtureTask` + worker). Result: yield is ~0-1 alts per fixture in single-worker DFS mode (lastResultNode contains only the iterative-deepening winner branch). Code kept for higher-budget regimes; not the primary augmentation lever.

2. **Multi-budget investigation falsified** — running 6s vs 12s vs 24s produces bit-identical `mainPath` per fixture (verified via md5 hash). Score / matched differ because `bestTurn1FieldState` reflects internal exploration past the recorded mainPath, but the recorded player-decision sequence is the same. Multi-budget does NOT augment the training data.

3. **Multi-seed augmentation succeeded** — running with `neural-mlpv3-gate-seed7/11/42` weights yields 13/15 fixtures with 3 distinct trajectories. Combined corpus: **101 SELECT_IDLECMD samples** (vs 35 in v1) — 2.9× augmentation.

4. **v2 LR baseline trained** on the multi-seed corpus, evaluated via 101-fold LOOCV. **First time the policy beats class prior on mean P(true)**.

---

## v1 vs v2 — head-to-head

| Metric | v1 (n=35) | v2 (n=101) | Δ |
|---|---:|---:|---|
| Top-1 accuracy | 51.4% | 35.6% | -15.8 pp |
| Majority baseline | 62.9% | 41.6% | (more balanced corpus) |
| **Top-1 vs baseline gap** | **-11.5 pp** | **-6.0 pp** | **closed by 5.5 pp** |
| Top-2 accuracy | 77.1% | 74.3% | -2.8 pp |
| Top-2 vs uniform gap | +37 pp | +41 pp | +4 pp |
| **Mean P(true)** | **0.434** | **0.314** | (raw value drops because K=6 vs K=5) |
| Class-prior P(true) | 0.432 | 0.278 | |
| **Mean P(true) vs prior** | **+0.002 (parity)** | **+0.036 (above prior)** | **first lift above prior** |
| Mean log P(true) | -1.439 | -1.458 | -0.019 nats |
| Uniform log P | -1.609 | -1.792 | (more classes) |
| Information gain vs uniform | +0.17 nats | +0.33 nats | **2× more info** |

The two metrics that matter most for ranker biasing — **Mean P(true) above class-prior** and **Top-2 vs uniform gap** — both improved.

### Per-class signal (v2 LOOCV)

| Class | n (train) | precision | recall | Notes |
|---|---:|---:|---:|---|
| activate | 42 (41.6%) | 47.6% | 23.8% | over-predicted in v1 (62.9%); now under-predicted as model learns minorities |
| normal-summon | 25 (24.8%) | 43.8% | 56.0% | major lift — class was 5.7% in v1, now genuinely learnable |
| set-st | 17 (16.8%) | 31.8% | 41.2% | solid signal |
| summon-procedure | 12 (11.9%) | 38.5% | 41.7% | solid signal |
| set-monster | 4 (4.0%) | 0.0% | 0.0% | still too sparse |
| end-phase | 1 (1.0%) | 0.0% | 0.0% | new class from dinomorphia alt; n=1 |

normal-summon is the standout — went from "untrainable at n=2 in v1" to "above-prior recall at n=25 in v2". The augmentation changed the corpus composition because sd11/sd42 weights pick normal-summon more frequently than sd7.

### Cross-distribution sanity check

Evaluating v2 weights on the original sd7-only corpus (subset of training):
- Top-2 accuracy: 77.1% (matches v1 in-sample top-2)
- Mean P(true): 0.363 (higher than v2's LOOCV mean 0.314 — sd7 verb mix easier)
- activate recall drops to 27.3% on sd7-only (training had 41.6% activate vs sd7's 62.9%)

The model has shifted its prior toward the multi-seed mean. For Stage 3b deployment with the canonical sd7 weights, the policy will under-predict activate. Whether this hurts or helps DFS lift is an empirical question to test in Stage 3b.

---

## Augmentation strategy retrospective

| Strategy | Yield | Cost | Verdict |
|---|---|---|---|
| Top-K alts extraction | 1 alt / 15 fixtures | code + 1 run | LOW — single-worker DFS doesn't expose alts at standard budgets |
| Multi-budget (6s/12s/24s) | 0 (identical mainPath) | 3 runs | NULL — eval scores differ but trajectories don't |
| **Multi-seed weights (sd7/sd11/sd42)** | **+66 IDLECMD samples** | **3 runs × 2 min** | **WIN — 2.9× corpus, 13/15 distinct per fixture** |

Multi-seed weights are the cheap-and-effective lever. Future augmentation paths:
- Apply same multi-seed strategy on Tier-B/C decks (more deck heterogeneity)
- Train more weight checkpoints on different fixture compositions
- Authored canonical-line corpus (~80 samples on 2 fixtures, opposite extreme of "many decks, shallow trajectories")

---

## Stage 3b — UNBLOCKED, can proceed

Gate criterion from v1 verdict: "If the policy doesn't beat class prior at all, Stage 3b is wasted compute". v2 beats class prior on mean P(true). Wiring `PolicyGuidedRanker` into the DFS now has a non-toy signal to test.

### Stage 3b plan unchanged

1. New `PolicyGuidedRanker` wrapping `NeuralFeatureRanker` (composition).
2. At SELECT_IDLECMD: predict verb-class distribution from current state, re-order base ranker output by policy probability for that action's `actionVerb` class.
3. Empty fallback (action.actionVerb not in policy classes) → identity (delegate to inner).
4. Integration smoke: 1-fixture run, verify policy hits forward pass + ranker order changes.
5. Gate evaluation: 14-fix hold-out at 6s budget, measure cum matched + mean trajectory length vs MLP v3 sd7 baseline (22 matched).

### Stage 3b success criterion (gate to Stage 4 / scaffolding removal)

- ≥ +3 cum matched OR ≥ 2× avg trajectory length vs MLP v3 sd7 baseline (unchanged from Stage 2 plan).

### What we expect

The v2 policy gives ~+13% relative lift on mean P(true) — modest but measurable. For ranker bias, this translates to roughly: the correct verb gets boosted in ranker order ~74% of the time (top-2). DFS already evaluates multiple actions; the bias steers exploration sequence, not the action set. Realistic Stage 3b expectation: +1 to +3 matched. If we hit +3, gate passes. If we plateau at +1-2, augment more (see "future paths" above) before judging null.

---

## Files & references

- v2 weights: `duel-server/data/policy-weights/v2/verb-policy-v1.json`
- v2 training data: `duel-server/data/policy-training/v2/training.jsonl` + `manifest.json`
- v2 CV report: `duel-server/data/policy-weights/v2/cv-report.json`
- Combined corpus: `duel-server/data/trajectories/aug-multiseed-combined/`
- Multi-seed source dirs:
  - `duel-server/data/trajectories/phase-b-v2-mlpv3-sd7/` (canonical Stage 1)
  - `duel-server/data/trajectories/aug-sd11/`
  - `duel-server/data/trajectories/aug-sd42/`
- Predecessor: `stage-3a-policy-baseline-2026-04-27.md`

---

## Out of scope this stage

- Stage 3b wiring — separate session.
- MLP variant of the policy — at n=101 with 6 classes, MLP[16] (≈1k params) is feasible. Defer until Stage 3b lift baseline established.
- True out-of-distribution eval (train on sd7+sd11, test on sd42) — informative but not required to gate Stage 3b.
- Authored canonical-line corpus integration — biggest pending augmentation lever, defer.
