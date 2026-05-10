# Phase 3 Stage 2 — Auto-Discovery Validation Quality Memo

**Date:** 2026-04-27
**Status:** SHIPPED
**Predecessor:** `stage-1-trajectory-infra-2026-04-27.md`
**Decision:** Stage 3 (Phase 4 policy network MVP) — **GO with caveat**

---

## What this stage delivered

Three Phase 3 inspection / analysis tools, each ~150-300 LoC, applied to the
Stage 1 corpus (`data/trajectories/phase-b-v2-mlpv3-sd7/`, 14 non-empty
fixtures + 1 stub):

1. **`scripts/inspect-trajectory.ts`** — pretty-prints a single trajectory
   (state features grouped by axis A-T) or batch-summarizes a corpus dir.
2. **`scripts/analyze-trajectory-patterns.ts`** — verb n-gram frequencies,
   feature-conditioned verb distributions, step-position bias.
3. **`scripts/compare-trajectories.ts`** — authored canonical line vs
   ML-extracted trajectory edit-distance + step-by-step alignment.

---

## TL;DR

The corpus encodes **real, exploitable verb grammar** (clear early-vs-late
phase shift, recurring activate-chain patterns) — sufficient for Phase 4
policy training in principle. But the ML trajectories **DO NOT reproduce
the authored canonical lines** — they're 4-5x shorter, take different
decisions, and reach different (lower-matched, higher-score-per-step)
terminals.

Implication: behavior cloning on this corpus would teach a policy to find
"DFS-reachable shallow high-score terminals", NOT the deep canonical lines.
This is consistent with the DFS budget binding (6000ms / 400 nodes /
~50ms per terminal) — DFS literally cannot reach 30-40-step authored
lines within budget at this scale.

**Stage 3 GO with explicit scope adjustment**: Phase 4 policy MVP should
target "policy-guided DFS to reach DEEPER terminals" (= longer trajectories
within similar budget), not "policy that mimics ML corpus directly".

---

## Finding 1 — The corpus has real verb grammar (POSITIVE)

Across 148 (state, action) pairs, after filtering 50% chain-pass +
23% (no-verb) selection prompts, **42 strategic decisions** remain with
the following structure:

### Verb 1-grams (corpus-wide, strategic only)

| Verb | Count | % of strategic |
|---|---:|---:|
| activate | 29 | 69.0% |
| set-st | 4 | 9.5% |
| summon-procedure | 4 | 9.5% |
| set-monster | 3 | 7.1% |
| normal-summon | 2 | 4.8% |

### Verb 2-grams (top, indicative of combo grammar)

- `activate → activate` × 13 (combo continuation, the most common)
- `activate → summon-procedure` × 3 (effect → ED summon = classic combo step)
- `set-monster → activate` × 3 (set then trigger)
- `set-st → activate` × 2 (setup then payoff)

### Verb 3-grams (chain combos)

- `activate → activate → activate` × 5 (deep chains, e.g. Snake-Eye combo)
- `activate → activate → summon-procedure` × 2

### Step-position bias (key result)

| Position | Top verbs |
|---|---|
| **Early third** of trajectory (n=21) | activate 71%, set-st 14%, set-monster 10%, normal-summon 5% |
| **Late third** of trajectory (n=13) | activate 54%, **summon-procedure 31%**, normal-summon 8%, set-st 8% |

Late-game `summon-procedure` jumps from 9% → 31%. **This is the canonical
YGO combo grammar** — early game = engine activation + setup, late game
= ED summon payoff. A policy network can learn this signal.

---

## Finding 2 — ML trajectories do NOT match authored canonical lines (NEGATIVE)

Compared 2 fixtures with full authored canonical trajectories
(branded-dracotail-opener, ryzeal-mitsurugi-opener):

| Fixture | Authored steps | ML steps | Edit distance | Similarity | Common prefix |
|---|---:|---:|---:|---:|---:|
| branded-dracotail-opener | 33 | 5 | 31 | 6.1% | 0 steps |
| ryzeal-mitsurugi-opener | 46 | 4 | 44 | 4.3% | 2 steps |

ML trajectories are **4-9x shorter** than authored canonical lines and
diverge from step 0 (or after 2 trivial chain passes). The ML solver is
NOT finding the same combo path as the human — it's finding a different
(shallower, higher-immediate-score) terminal.

Why this matters for Phase 4:
- Behavior cloning the ML corpus → policy learns shallow patterns
- Behavior cloning authored corpus only → 2-3 fixtures, way too small
- Bridge needed: policy that helps DFS reach deeper / extract longer
  trajectories

This isn't a fundamental blocker for Stage 3, but it constrains the
design: pure imitation of the ML corpus is the wrong target.

---

## Finding 3 — The corpus is small but not pathologically so (NEUTRAL)

Stage 1 produced **148 (state, action) pairs** across 14 fixtures.
Filtered to 42 strategic decisions, this is **adequate for a small
behavior-cloning experiment** but tight:

- Per-class: activate 29 → trainable, others 2-4 → severely class-imbalanced
- Per-state: 58-dim state vectors, so ~42 strategic samples × 58 features
  is well below typical "deep learning needs millions" but appropriate for
  small linear / shallow MLP policy heads
- Augmentation paths:
  - Run with multiple seeds (5 seeds × 14 fixtures = ~210 strategic
    decisions)
  - Run with multiple budgets (6s / 12s / 30s) → different trajectories
  - Top-K alternatives per fixture (today: only mainPath; could dump up
    to TOP_K_ALTERNATIVES = 3 per fixture)

For an MVP policy, 42 samples is enough to validate the pipeline. For a
production-quality policy, augmentation is needed.

---

## Finding 4 — Feature-conditioning gives weak signal (NEUTRAL)

Tested 6 discriminative state features against verb distribution:

- `monsters_self_count` HIGH (=0.4+) — **0 strategic decisions** in this
  bucket. Most strategic decisions happen when self-board is empty (early
  combo). Threshold of 0.4 = `>= 2.8 monsters` is too high for our
  trajectories which mostly stop before the board is built.
- `normal_summon_used`, `hand_combo_potential_engine`,
  `special_summons_this_turn_norm`, `effects_activated_this_turn_norm`,
  `turn_norm` — distributions reported but no strong "feature X high →
  verb Y dominant" signal at our threshold choices.

This isn't a blocker. The state features are informative for the policy
network in aggregate (the MLP can learn non-trivial combinations), even
when no single feature is sharply discriminative.

---

## Finding 5 — `dinomorphia` empty mainPath suggests bug or scoring failure (BUG)

Dinomorphia-opener produced an empty mainPath despite 227 nodes explored.
DFS searched but never settled on a "best terminal" worth recording. Two
possible causes:

1. **All terminals scored 0**: implicit goals not firing because none of
   dinomorphia's expectedBoard cards landed on the field during search.
2. **Best-tracking bug**: `result.mainPath` is empty even though some
   non-zero terminal was scored.

Worth investigating during Phase 4 prep. Not a blocker but a corpus
completeness flag.

---

## Stage 3 — GO with scope adjustment

### Original Stage 3 scope (Phase 4 MVP per Stage 1 memo)

> Behavior cloning training on Stage 1 corpus.
> Hybrid solver: policy guides DFS move ordering, MLP ranker provides
> value estimation.

### Adjusted Stage 3 scope (post-Stage 2 findings)

The "policy guides DFS move ordering" framing is correct. The
"behavior cloning on Stage 1 corpus" framing is partially correct — we
clone the verb grammar, NOT the literal trajectories.

**Concrete Stage 3 plan:**

1. **Train on Stage 1 corpus AS-IS** for the verb grammar signal (early
   = setup, late = ED summon). Target: a small policy that, given state
   features, predicts the next verb class.
2. **Use policy to bias DFS** at the prompt level:
   - At SELECT_IDLECMD, the policy outputs a verb-class distribution;
   - DFS reorders legal actions so that policy-preferred verb classes
     are tried first;
   - Empty rank fallback: existing NeuralFeatureRanker bonus.
3. **Re-extract corpus** from policy-guided DFS at higher budget
   (12s / 24s) on the same 14 fixtures. Compare:
   - Trajectory length: are we reaching deeper terminals now?
   - Cum matched: does the new corpus include more authored-canonical
     decisions?
4. **Iterate** if step 3 shows lift: retrain policy on extended corpus
   (now closer to authored-line statistics), repeat.

### Success criterion for Stage 3 (gate to Stage 4 = scaffolding removal)

- ≥ +3 cum matched on 14-fix hold-out vs MLP v3 sd7 baseline (22) at
  matched eval budget (6s)
- OR ≥ 2x average trajectory length (= ML reaches deeper terminals
  within similar budget) at matched eval budget

If neither lift materializes, Stage 3 becomes a "negative result" memo
and the project pivots back to feature engineering or scorer revision.

### Estimated effort

- Stage 3a — policy network design + initial training (~3-5d eng + ~5h
  compute)
- Stage 3b — policy-guided DFS wiring (~2-3d eng)
- Stage 3c — re-extraction + comparison (~1d eng + ~2h compute)
- Stage 3d — iteration round if first attempt shows lift (~1w)

Total: ~2 weeks engineering + ~10h compute for a first credible Phase 4
result.

---

## Out of scope this stage

- Augmentation paths (multi-seed corpus, multi-budget corpus, top-K
  alternatives) — defer until policy training shows actual data hunger.
- Dinomorphia empty-mainPath investigation — flagged for Phase 4 prep.
- Quantitative discriminative-feature analysis (mutual information,
  feature importance) — Stage 3a would surface this naturally as part
  of the policy's learned weights.

---

## Files & references

- Stage 2 tools (committed in this stage):
  - `duel-server/scripts/inspect-trajectory.ts`
  - `duel-server/scripts/analyze-trajectory-patterns.ts`
  - `duel-server/scripts/compare-trajectories.ts`
- Pattern dump artefact: `duel-server/data/trajectories/phase-b-v2-mlpv3-sd7-patterns.json`
- Stage 1 memo: `_bmad-output/solver-data/phase-3/stage-1-trajectory-infra-2026-04-27.md`
- Phase B v2 ship memo: `_bmad-output/solver-data/phase-b/ship-v2-2026-04-27.md`
- Authored corpus: `_bmad-output/planning-artifacts/research/trajectories/`
  (branded-dracotail-opener-recorded.json, ryzeal-mitsurugi-opener.json)
- Strategic direction memo: `solver-ml-strategic-direction` memory.
