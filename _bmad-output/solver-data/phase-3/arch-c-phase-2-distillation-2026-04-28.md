# Phase 3 Architecture C — Phase 2 (Distillation Trainer)

**Date:** 2026-04-28
**Status:** SHIPPED — CV gate PASS at all swept configs
**Predecessor:** `arch-c-phase-1-batch-1-2026-04-27.md`
**Decision:** Phase 3 wiring eval at n=17 distilled weights — proceed.

---

## TL;DR

LLM-distilled LR (KL loss on softmax-of-rank target, tau=2) trained on 17
hydrated SELECT_IDLECMD samples beats the v2 (DFS-argmax) baseline mean
P(gtVerb) at LOFO cross-validation:

| Metric | LLM-distilled v1 (LOFO) | v2 reference | Δ |
|---|---:|---:|---:|
| Mean P(gtVerb) | **0.363** | 0.314 | **+0.049** |
| Mean P(llmTopVerb) | 0.447 | n/a | distillation-fit |
| Mean KL(target ‖ predict) | 0.409 | n/a | — |

5/5 swept configs pass the v2 gate. Phase 2 trainer architecture validated
end-to-end. Next: wire weights via `SOLVER_USE_VERB_POLICY=1` pointing at
`data/policy-weights/llm-distilled-v1/verb-policy-v1.json` and run the 14-fix
canonical eval (gate ≥+3 cum matched).

---

## What this stage delivered

1. **`scripts/hydrate-llm-annotations.ts`** — joins LLM action-index
   annotations with replayed trajectory state. For each annotation,
   re-replays the canonical trajectory, captures FieldState + legal
   `Action[].actionVerb` at the annotated step, builds the soft
   verb-class target via softmax-of-rank with temperature `tau`. Drops
   `SELECT_CARD` samples (verb-policy is `SELECT_IDLECMD`-only by design).
2. **`scripts/train-verb-policy-distilled.ts`** — KL-loss LR. Per-sample
   loss = `classWeight[gtVerb] × confWeight × CE(target, softmax(logits))`.
   Default CV scheme is leave-one-fixture-out (LOFO). Outputs are
   drop-in compatible with `PolicyGuidedRanker` (same labelClasses,
   same featureSpecHash, version=`verb-policy-v1`).
3. **Canonical artifact** at
   `data/policy-weights/llm-distilled-v1/verb-policy-v1.json` (tau=2).

---

## Hydration result (Phase 1 batch 1)

- Input: 25 annotations across 4 fixtures × seeds.
- Hydrated SELECT_IDLECMD samples: **17**.
- Dropped SELECT_CARD: 8 (verb-policy out-of-scope).
- Drift drops: 0 (all canonical replays clean).

| Distribution | Counts |
|---|---|
| Per fixture | branded(3) snake-eye(6) horus(7) spright(1) |
| Per seed | sd11(10) sd7(6) sd42(1) |
| Per confidence | high(14) medium(3) |
| GT verb | activate(5) normal-summon(3) set-st(6) summon-procedure(3) set-monster(0) end-phase(0) |

---

## CV results — sweep over tau, lr, L2, CV scheme

All runs at `epochs=2000, seed=42, n=17`. Gate = mean P(gtVerb) > 0.314.

| Config | CV scheme | tau | lr | L2 | P(gtVerb) | P(llmTop) | KL | Gate |
|---|---|---:|---:|---:|---:|---:|---:|---|
| canonical | LOFO | 2.0 | 0.05 | 0.001 | **0.363** | 0.447 | 0.409 | PASS |
| sharp tau | LOFO | 1.0 | 0.05 | 0.001 | **0.381** | 0.498 | 0.592 | PASS |
| soft tau | LOFO | 4.0 | 0.05 | 0.001 | **0.338** | 0.393 | 0.297 | PASS |
| k=5 sanity | k-fold | 2.0 | 0.05 | 0.001 | **0.325** | 0.508 | 0.379 | PASS |
| heavy reg | LOFO | 2.0 | 0.02 | 0.01 | **0.328** | 0.444 | 0.429 | PASS |

Best P(gtVerb) at tau=1.0 (sharper target → harder argmax signal). Smallest
KL divergence at tau=4.0 (softer target → easier to fit). Picked tau=2.0 as
canonical: balanced calibration, clean P(llmTop) signal, KL not blown up.

### Per-fold breakdown (tau=2.0 LOFO)

| Held-out fixture | val n | P(gtVerb) | P(llmTop) | KL |
|---|---:|---:|---:|---:|
| branded-dracotail-opener | 3 | 0.477 | 0.603 | 0.143 |
| horus-crystron-opener | 7 | 0.390 | 0.495 | 0.252 |
| snake-eye-yummy-opener | 6 | 0.334 | 0.347 | 0.635 |
| spright-opener | 1 | 0.019 | 0.248 | 0.956 |

3/4 folds clear the gate individually. Spright (val n=1) is the LOFO
cliff — when held out, training set drops 1 fixture's coverage and the
model can't infer its verb distribution. Expected at n=4 fixtures.

---

## Honest comparability caveat

The 0.314 v2 reference comes from stratified-class k-fold on n=101
multi-seed DFS-argmax labels. Our v3 LOFO at n=17 is a different test
regime. The comparison is directionally meaningful (same labelClasses,
same featureSpecHash, same metric definition) but not strictly
apples-to-apples. The real arbiter is the 14-fix eval gate (Phase 3).

---

## What this proves (and what it doesn't)

✓ The hydration pipeline (annotation → trajectory-replay → state +
  legal-verbs → soft target) is sound. 0 drift over 25 annotations.

✓ KL-on-softmax-of-rank is trainable at n=17 with our existing 58-feature
  state extractor and 6-class label space. The optimizer converges
  (loss ~1.0 at 2000 epochs, no NaN, no oscillation).

✓ The distilled LR captures *enough* of the GT signal at LOFO to clear
  the v2 reference. At least one alignment direction (LLM ↔ DFS-mainPath)
  is preserved through the soft-target regime.

✗ It does NOT prove the policy will lift cum matched in DFS. Phase 3
  wiring is the next test. Stage 3b (verb-class on multi-seed DFS argmax)
  cleared the analogous CV gate but **failed** the 14-fix eval gate
  (cum matched static, score Δ −53..+9). The CV gate is necessary, not
  sufficient.

✗ It does NOT prove the LLM signal would still help at corpus scale.
  n=17 might be too few to overcome ranker-redundancy. Scaling to ~129
  remaining prompts is conditional on Phase 3 wiring eval lift.

---

## Phase 3 wiring gate plan

```
SOLVER_USE_VERB_POLICY=1 \
SOLVER_VERB_POLICY_PATH=data/policy-weights/llm-distilled-v1/verb-policy-v1.json \
SOLVER_USE_NEURAL_WEIGHTS=1 \
node ... evaluate-structural.ts --algorithm=dfs --budget-ms=6000 \
  --node-budget=400 --implicit-goals=10
```

vs control (same flags minus `SOLVER_USE_VERB_POLICY`).

Gate: **cum matched ≥ +3** on 14-fix hold-out (deterministic per
eval-noise-audit-2026-04-27). Soft-bias scale: default
`SOLVER_POLICY_BIAS_SCALE=100`, `SOLVER_POLICY_BASE_RANK_SCALE=30`.
If null → consider biasScale=200 sweep before declaring distillation
dead.

---

## Decision branches

- **+3 ≤ cum matched on 14-fix hold-out** → ship `llm-distilled-v1` as
  `verb-policy-latest.json`, scale annotation corpus to remaining 129
  prompts (~4M tokens subscription).
- **null result on 14-fix** → bias-as-ranker paradigm exhausted at our
  budget regime (Stage 3b dead, distilled-policy dead). Pivot to:
  - Path 1: heavy-compute (more search depth, no policy)
  - Path 4: imitation-from-authored (clone the human canonical lines)
  - Pivot D: freeze ML R&D, ship status quo 25/69 v1.
- **regression cum matched** → diagnose distributional mismatch
  (canonical eval fixtures × LLM-trained-on-different-seed-corpus drift).

---

## Files & references

- Hydrated training data: `duel-server/data/policy-training/llm-distilled-v1/{training.jsonl,manifest.json}`
- Canonical weights: `duel-server/data/policy-weights/llm-distilled-v1/verb-policy-v1.json`
- CV report: `duel-server/data/policy-weights/llm-distilled-v1/cv-report.json`
- Sweep alts: `data/policy-weights/llm-distilled-v1-{tau1.0,tau4.0,kfold5,reg}/`
- Hydration script: `duel-server/scripts/hydrate-llm-annotations.ts`
- Trainer script: `duel-server/scripts/train-verb-policy-distilled.ts`
- Predecessor: `_bmad-output/solver-data/phase-3/arch-c-phase-1-batch-1-2026-04-27.md`
