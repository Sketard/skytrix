# Value Head V(s) Pilot — Verdict MARGINAL

**Date:** 2026-05-02
**Status:** PILOT COMPLETE — verdict MARGINAL, stop per Q3 directive
**Predecessor:** A1 + A2 honest baseline analysis (commit 5010a6e5 + Phase A ablation)
**Question asked:** can a simple MLP, fed only stateFeatures (58 dims), predict the terminal score of the trajectory it is part of better than mean-prediction?

## TL;DR

| Metric | Value |
|---|---|
| Baseline (mean-prediction) MAE val median | 11.02 |
| MLP[58→64→32→1] best MAE val median | 9.30 |
| Ratio (MLP / baseline) | **0.844** |
| GO threshold | < 0.70 |
| Verdict | **MARGINAL** — MLP beats baseline by ~16%, below the +30% GO bar |

The mechanism works (V(s) is learnable from this corpus) but the signal is too weak at this corpus + feature scale to justify Phase B v2 industrialisation. Stop and document; do not proceed to integration without an enrichment pass.

## Setup

**Corpus** built mechanically via enumerate-skip with `--dump-trajectories`:
- 27 distinct trajectories (1 baseline + variants × 3 fixtures)
- 1048 (state, V_target) pairs
- 18 distinct V_target values, range [1, 37]
- Per-fixture distribution:
  - ddd: 15 trajectories, 9 distinct scores
  - branded: 8 trajectories, 6 distinct scores
  - snake-eye: 5 trajectories, 5 distinct scores

**Tooling shipped this session:**
- `replay-trajectory-cli.ts` extended with `--dump-trajectory=<path>` flag (Stage 1 schema-compatible)
- `enumerate-skip.ts` extended with `--dump-trajectories` flag (passes to sub-replay)
- `train-value-head-pilot.ts` standalone trainer (~340 LoC, pure-JS MLP no torch dep)

**Training config:**
- Architecture: MLP[58 → 64 → 32 → 1], ReLU, dropout 0.2
- Loss: MSE on mean-centered target
- Optimizer: SGD with mini-batch (lr=1e-3, batch=64), 100 epochs
- Train/val split: by trajectory (80/20), seeded
- Multi-seed: {7, 11, 42}, median aggregation

## Per-seed results

| Seed | Train trajs | Val trajs | Baseline val MAE | MLP best val MAE | Best epoch |
|---|---|---|---|---|---|
| 7 | 22 | 5 | 11.02 | 9.30 | 98 |
| 11 | 22 | 5 | 15.09 | 11.18 | 96 |
| 42 | 22 | 5 | 8.54 | 7.08 | 5 |

Median: baseline 11.02, MLP best 9.30, ratio 0.844.

**Variance across seeds is high** — best val MAE ranges 7.08 to 11.18 just from picking which 5 trajectories land in val. Confirms the pilot scale is at the noise floor.

## Per-trajectory val predictions (seed 7, illustrative)

| Trajectory | Predicted | Target | Error |
|---|---|---|---|
| branded/variant-skip-step6 | 25.3 | 36.0 | 10.7 |
| ddd/variant-skip-step2 | 12.7 | 1.0 | 11.7 |
| ddd/variant-skip-step6 | 14.0 | 1.0 | 13.0 |
| ddd/variant-skip-step9 | 21.4 | 17.0 | 4.4 |
| snake-eye/_baseline | 22.6 | 33.0 | 10.4 |

**Pattern: MLP predicts something close to the per-fixture average** (ddd center ~17-22, branded ~25, snake-eye ~22). When the actual terminal is at an extreme (very bad like 1.0 or very good like 37.0), the MLP under/over-shoots by a large margin.

## Diagnostic

The MLP is doing **fixture-cluster regression**, not state-aware value estimation. Three plausible causes:

### 1. State features lack discriminative signal mid-combo

The 58 stateFeatures are mostly demographic (hand size, monster count, phase, normalSummonUsed, etc.). They were designed for **policy bias on action ranking**, not for **terminal score regression**. Many mid-combo states differ trivially in the features even though their downstream value is wildly different.

Example: at step 5 of ddd canonical line vs step 5 of ddd-skip-step0, the field state is "1 monster on field, 1 spell on field, 0 traps" in both cases — the features look very similar — but the canonical line will reach 37 score whereas the skip-step0 variant is doomed at 1 score. Without the **causal history** in features (which Pendulum scales were set, which contracts are stacked, what's in GY), the regression is impossible.

### 2. Within-trajectory target leakage diluted by single-target-per-trajectory

All N states from one trajectory share the same V_target = outcome.score. So the MLP sees "this state → 37" for every step of the canonical, regardless of when in the combo it occurs. The state at step 0 (turn 1, hand of 5, empty field) has the same target as state at step 80 (deep mid-combo, complex board). This is a known limitation of this naive Stage-1-helper-style data: **early states get over-credited** for terminal that's still 80 actions away.

This is fundamentally what Q1=A (option A target) buys: simplicity at the cost of bootstrapping noise. Option B (best-of-K rollouts) would rescore each state by its own potential, not trajectory-wide. But option B costs N× compute.

### 3. Corpus too small for 116-dim feature space

27 trajectories × ~38 steps = 1048 examples, in a 58-dim input space. The MLP[58→64→32→1] has ~5,860 params. Standard rule-of-thumb: ≥10× more examples than params for healthy generalization. We have ~5× fewer. Overfitting was visible (seed 42 best epoch was 5; longer training drifted upward).

## Why we don't proceed to integration

Even if MLP val MAE = 9.30 and baseline = 11.02, integrating V(s) into the DFS scorer would mean:
- Adding ±9.30 score noise per evaluated state
- The DFS already evaluates terminals with `interruptionScore` (range 0-80) plus `goalMatchPoints` (0-50). A V(s) addend with ±9 noise dominates the goalMatchPoints gradient that snake-eye + ddd authored expertise rely on.
- Risk of **regressing matched** on canonical-eval (à la branded-dracotail expertise-on regression we saw earlier).

A meaningful V(s) integration requires MAE val ≤ ~3-5 score units, far below current 9.30.

## What we learned

1. **The mechanism is buildable**: state-feature → V_target regression converges, baseline beat, multi-seed reproducible. The infra works.
2. **The corpus is enrichable cheaply**: enumerate-skip + `--dump-trajectories` produced 28 spread trajectories in ~30 minutes of runtime. Scaling to 4 fixtures × multi-skip × multi-seed is feasible.
3. **The features are the bottleneck**: 58 stateFeatures lack causal history. The same memo-noted limitation that motivated `ygo-essence-feature-deep-dive-2026-04-26` (2026-04-26: ~30 new features candidates across 7 axes proposed).
4. **The signal Q1=A bootstrap is noisy**: shared V_target across all states of a trajectory creates structural overfitting in early-state predictions. Option B (rollout-based per-state target) would be cleaner but costlier.

## Three actionable directions (not pursued today)

### Direction A — Feature enrichment (Sprint 1+2 of `ygo-essence-feature-deep-dive`)
- ~21 new features across axes A (action verbs), B (cost), C (output magnitude), E (tempo)
- ~10 days eng + 30h compute
- ROI: target features give MLP what it needs to discriminate state by **causal history** (which scales were set, which contracts stacked, which monsters in GY)
- Then re-run pilot with same corpus + new features. If ratio drops below 0.7 → GO Phase B v2.

### Direction B — Corpus enrichment (combo-depth=2 enumerate-skip)
- enumerate-skip has `--combo-depth=2` flag for pair-skip enumeration
- ddd: C(14, 2) = 91 variants, branded: C(7, 2) = 21, snake-eye: C(4, 2) = 6 → 118 new trajectories on top of existing 28
- ~5-8 hours of runtime
- Cheap to try; might lift signal by sheer volume

### Direction C — Per-state target via mini-rollout (Q1=B)
- For each state in a trajectory, run 1-3 short DFS rollouts from there with low budget, take max score as V_target
- ~2-3× compute per state but each (state, V) pair is now state-aware not trajectory-aware
- Rebuild corpus, retrain
- More principled but expensive; defer until Direction A confirms features matter

## Files & references

- Tooling:
  - `duel-server/scripts/replay-trajectory-cli.ts` (added `--dump-trajectory=<path>`)
  - `duel-server/scripts/enumerate-skip.ts` (added `--dump-trajectories` flag)
  - `duel-server/scripts/train-value-head-pilot.ts` (new, ~340 LoC pure-JS MLP)
- Corpus: `duel-server/data/value-head-pilot/corpus/{ddd,branded,snake-eye}/`
- Results: `duel-server/data/value-head-pilot/results/summary.json`
- Predecessors:
  - `solver-ml-strategic-direction` memory (Phase 2/3/4 long-term plan)
  - `phase-3/stage-1-trajectory-infra-2026-04-27.md` (Stage 1 schema reference)
  - `ygo-essence-feature-deep-dive-2026-04-26` memory (feature enrichment plan)
  - `phase-3/mcts-policy-killed-2026-04-27.md` (MCTS killed, motivation for value head)

## Recommendation

**Do NOT integrate V(s) at current MAE 9.30.** Three pragmatic next-steps in order of decreasing risk:

1. **Authoring expertise on the 7 stuck fixtures** — known method, +5-10 cum matched, ~1-2d/fixture. Bypasses ML entirely.
2. **Feature enrichment Sprint 1+2** then re-run pilot — scientifically motivated, ~10d eng. If pilot ratio drops to 0.6 → GO Phase B v2 industrialisation.
3. **Direction C (per-state rollout target)** as last-resort if features don't suffice.

Phase B v2 full industrialisation (~25h compute) is **not justified** by today's pilot data. Defer until either (a) features are enriched OR (b) corpus is 5-10× larger.
