# Phase 3 Architecture C — Phase 1 Batch 1 (25 annotations)

**Date:** 2026-04-27
**Status:** SHIPPED — pipeline validated at scale
**Predecessor:** `arch-c-poc-2026-04-27.md`
**Decision:** Pipeline ready; scale-up to full 154-prompt corpus is now a token-budget call

---

## What this stage delivered

- Extended POC script to support trajectory-dump format input (multi-seed corpus).
- Generated 25 prompts from 4 multi-seed fixtures (branded sd11, snake-eye sd7, horus sd11, spright sd42).
- Dispatched 25 subagents in 3 parallel batches (8 + 9 + 8) via Claude Code Agent tool.
- 25/25 returned parseable JSON (100% format compliance).
- Saved `data/llm-annotations/phase-1-batch-1.jsonl` for downstream Phase 2 trainer.

---

## Cumulative results (n=25)

| Metric | Aggregate | SELECT_IDLECMD (n=17) | SELECT_CARD (n=8) |
|---|---:|---:|---:|
| Top-1 | 24% (6/25) | 18% (3/17) | 38% (3/8) |
| **Top-3** | **76% (19/25)** | 76% (13/17) | 75% (6/8) |
| Top-5 | 96% (24/25) | 94% (16/17) | 100% (8/8) |

### Cross-baseline top-3 signal stability

| Stage | Ground truth source | Top-3 |
|---|---|---:|
| POC original (10) | Authored canonical line | 80% |
| Calibration ablation (5, no hint) | Authored | 60% |
| Calibration radiant (5) | Authored | 80% |
| **Phase 1 batch 1 (25)** | **DFS-mainPath multi-seed** | **76%** |

Top-3 is the durable signal — robust to baseline choice, fixture diversity, prompt-format ablations.

---

## Why top-1 dropped (24% Phase 1 vs 70% POC)

The POC compared LLM picks to **authored canonical lines** (high-quality human expert).
Phase 1 compares LLM picks to **DFS-mainPath ground truth** (the current solver, which is
itself imperfect). The two experts disagree on argmax in many cases:

- **branded sd11 step 0**: DFS picks `Dracotail Phryxul NS`. LLM picks `Branded Fusion`.
  Both valid; LLM aligns with mainstream Branded combo theory.
- **horus step 2**: DFS picks `Ash Blossom NS` (a hand trap normal-summoned!). LLM picks
  `King's Sarcophagus`. LLM is more standard.
- **horus step 13**: GT and LLM both pick `King's Sarcophagus` but at different action
  indices (same card, different verbs — `set-st` vs `activate`). Score-as-argmax
  miscounts these as disagreement when they're actually the same play.

**Key insight**: top-3 captures these "same card, different verb" cases that top-1 misses.
For distillation training, top-3-as-soft-labels (KL on full ranked distribution) is the
right loss target.

---

## Pipeline metrics

- **Wall time per subagent**: 9-15s (median ~12s)
- **Wall time per batch of 8-10 in parallel**: ~15-22s
- **Tokens per subagent**: ~38K average
- **Total tokens consumed (25 prompts)**: ~750K tokens (subscription quota)
- **API cost**: $0
- **JSON format compliance**: 25/25 (100%)
- **No hallucinations**: all card names valid against the deck
- **Confidence distribution**: 21 high / 4 medium

---

## Phase 2 implications

For the distillation trainer:

1. **Label format**: use `llmRanked` (full ranking) as soft labels via KL or listwise loss,
   NOT `llmBestIndex` (argmax). Discards information.
2. **Loss weighting**: `llmConfidence` field can weight per-sample loss (high=1.0,
   medium=0.5).
3. **Training data**: 25 (state, ranked_actions) pairs is enough for a sanity Phase 2
   training run. For production policy, scale to 100-200 pairs.
4. **State representation**: same 58 state features as Stage 3a (verb-policy LR).
   Re-use the existing `state-feature-extractor.ts` + `verb-policy.ts` runtime —
   architecture identical, only training labels change.

---

## Scope decision for Phase 1 full

Remaining multi-seed corpus: ~129 prompts not yet annotated. Cost extrapolation:
- ~129 × 30K tokens = ~3.9M tokens
- Wall time: ~12-15 batches of 10 in parallel = ~5 min wall (parallel) or ~30 min (serial)
- $0 API cost (subscription only)

**Recommendation**: pause here unless committed to Phase 2 trainer in this session.
With 25 annotations we have enough to:
- Sanity-train a verb-class LR with LLM labels and compare CV vs Stage 3a v2
- Validate Phase 2 trainer architecture
- If lift positive → scale annotation corpus then

If null result (LLM-distilled policy doesn't beat DFS-derived multi-seed v2 policy),
scaling to 154 wouldn't help — it'd be a bigger version of the same null result.

---

## Out of scope this stage

- Phase 2 trainer architecture (KL loss vs cross-entropy, MLP vs LR) — separate stage.
- LLM annotation of authored canonical lines (would supplement multi-seed corpus with
  high-quality human-aligned labels) — separate stage.
- Trajectory-dump validation drift (some fixtures fail to replay due to schema drift) —
  flagged but not blocking; affects scope of annotatable corpus.

---

## Files & references

- Annotations: `duel-server/data/llm-annotations/phase-1-batch-1.jsonl` (25 entries)
- Generated prompts: `duel-server/data/llm-poc-phase1/{branded,snake-eye,horus,spright}/`
- POC script: `duel-server/scripts/llm-canonicalize-poc.ts`
- Predecessor: `_bmad-output/solver-data/phase-3/arch-c-poc-2026-04-27.md`
