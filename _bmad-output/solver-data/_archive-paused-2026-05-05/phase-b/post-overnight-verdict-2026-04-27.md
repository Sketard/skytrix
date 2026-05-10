# Phase B Day 3 — Post-overnight verdict (F1 + F2 + α takeover)

**Date:** 2026-04-27
**Compute window:** ~14h overnight (F1 ~7h + F2 step 1 ~7h before kill + α takeover ~3h45)
**Status:** Sprint 3 GO confirmed. Three critical findings change Sprint 3 plan.
**Predecessor:** `pre-flight-verdict-2026-04-26.md` (Day 1.5 GO with +2 matched cum hold-out median).

---

## TL;DR

- **MVP v3 features (21 new, axis L verbs + axis S engine + axis E tempo + normal_summon_used) deliver +7 matched cum hold-out median** vs PF v2 baseline. Sprint 3 GO STRONG cleared at 2.3× threshold.
- **MLP[32] arch is NOT optional — it's a rescue mechanism**. Without MLP, Linear v3 fails catastrophically on sd11 (-6 matched vs PF v2 sd11). MLP recovers sd11 from 9 to 17 matched (+8 architectural lift on the hardest seed).
- **Det regime training overfits by budget**. F2 sd7 trained at budget-ms=30000 produced weights that score 14 cum hold-out at production eval (vs 22 for F1 prod-trained). Production regime budget-ms=6000 remains canonical.
- **Variance roughly tripled with feature additions**. PF v2 linear range = 3 matched across seeds; Linear v3 range = 9. Multi-seed discipline (≥3, ideally 5) becomes mandatory for Sprint 3.

---

## Experiments timeline

| Phase | What | Duration | Output |
|---|---|---|---|
| F1 (overnight) | Gate v3: 3 seeds × MLP[32] × 30 gen × 4 fix at budget-ms=6000 + linear v3 sd42 ablation + cum evals | ~7h | 4 weights + 4 cum eval logs |
| F2 step 1 (overnight) | Det regime: sd7 × MLP[32] × 30 gen × 4 fix at budget-ms=30000 | ~7h (longer than estimated 3.5h) | 1 weights file |
| F2 step 2 (killed) | Det regime: sd42 (intended), killed by watchdog at gen 6 after step 1 wrote weights | ~1.5h wasted | — |
| Watchdog takeover (afternoon) | Cum eval seed 7 det @ prod regime + bonus eval F1 sd7 weights @ det eval + α-1 linear v3 sd7 + α-2 linear v3 sd11 | ~3h45 | 4 cum evals + 2 weights |

Net : 5 trained weights, 6 cum eval logs, 4 trace dirs.

---

## Cum 14-fix matched table (excluding mirrorjade alt)

| Config | sd 42 | sd 7 | sd 11 | Median | Range | Score (median) |
|---|:-:|:-:|:-:|:-:|:-:|---:|
| PF v2 linear (95 feat, F1 ref) | 12 | 13 | 15 | 13 | 3 | 188 |
| C1 MLP v2 (95 feat, sd42 only) | 16 | — | — | — | — | 226 |
| **Linear v3 (116 feat)** | 18 | 18 | **9** | 18 | **9** | 220-264 |
| **MLP v3 (116 feat)** | 20 | 22 | **17** | **20** | 5 | 233-294 |
| F2 det train sd7 @ prod eval | — | **14** | — | — | — | 159 |
| F1 sd7 weights @ det eval (bonus) | — | **24** | — | — | — | 313 |

Honest baselines (canonical for Phase B): snake-eye-yummy 10/0, branded-dracotail 26/1, ryzeal-mitsurugi 15/1, ddd-pendulum 18/1.

### Per-fixture pattern — F1 MLP v3 sd7 (best, 22 matched cum)

Fixtures where the MLP v3 features delivered:
- **branded-dracotail**: 1→3 matched (cross-fixture transfer confirmed since Day 1.5)
- **ryzeal-mitsurugi**: 1→3 matched (long-standing plateau broken)
- **radiant-typhoon**: 1→2 matched
- **floowandereeze**: 1→2 matched
- **horus-crystron**: 1→2 matched

Fixtures stuck at baseline:
- **labrynth**, **dinomorphia**, **ddd-pendulum**, **stun-runick**, **nekroz-ryzeal**: all stable around baseline (1 matched)

Fixtures with regression at sd11 specifically:
- **branded-dracotail** sd11 Linear v3: 1→0 matched (lost matched!)
- **ryzeal-mitsurugi** sd11 Linear v3: 1→0 matched (lost!)

---

## Three critical findings

### Finding 1 — Linear v3 sd11 catastrophe reveals fitness/objective misalignment

Linear v3 sd11 cum hold-out = 9 matched, **WORSE than PF v2 sd11 = 15 matched (Δ -6).** Adding features without sufficient model capacity made this seed *regress*.

#### Root cause

The fitness function is `sum(interruptionScore)` where:
- `interruptionScore = weighted (tagged interruption pieces) + fallbackPoints (face-up untagged monsters) + ...`

The optimizer can maximize total `interruptionScore` via two paths:
- **Canonical path** : end on a board with tagged interruption pieces (= matched goes up)
- **Fallback path** : end on a board with many untagged faceup monsters (+1 fallback per monster, score goes up but matched stays low)

For sd11 with random init and ES dynamics, Linear v3 settled into a **fallback-favoring basin** : 4-fix re-eval = 80 score / 1 matched. Score was inflated (+12 vs baseline 68), matched dropped (-2 vs baseline 3).

A linear model cannot express **"prefer A unless B is also true"** — it can only compose features additively. Once the optimizer found weights pushing toward fallback boards, no linear adjustment could simultaneously reward canonical patterns AND penalize fallback chasing.

#### MLP[32] resolves it

MLP v3 sd11 cum hold-out = 17 matched (+2 vs PF v2). The MLP can learn:
> "When state features indicate fallback-only board, suppress the score signal regardless of magnitude"

ReLU non-linearity creates conditional weighting that linear cannot.

#### Quantification

| Seed | PF v2 (linear, 95) | Linear v3 (linear, 116) | MLP v3 (MLP, 116) |
|:-:|:-:|:-:|:-:|
| 42 | 12 | 18 (+6) | 20 (+8) |
| 7 | 13 | 18 (+5) | 22 (+9) |
| 11 | 15 | **9 (-6)** | **17 (+2)** |

**MLP arch is the difference between Phase B v2 ship (matched > baseline on all seeds) and Phase B v2 disaster (1/3 seeds regresses)**.

### Finding 2 — Det regime training overfits by budget

F2 sd7 det train (budget-ms=30000) → cum hold-out at production eval = 14 matched. F1 sd7 prod train → 22 matched. Δ = -8.

#### Per-fixture analysis

Comparing F2 det sd7 cum hold-out vs F1 prod sd7 cum hold-out, same seed:

| Fixture | F1 prod | F2 det train | Δ matched | Δ score |
|---|:-:|:-:|:-:|:-:|
| branded-dracotail | 3/8 | **5/8** | **+2** | -19 |
| ryzeal-mitsurugi | 3/5 | 0/5 | **-3** | -28 |
| snake-eye-yummy | 2/7 | 0/7 | -2 | -8 |
| spright | 3/4 | 1/4 | -2 | -7 |
| horus-crystron | 2/4 | 1/4 | -1 | -12 |
| nekroz-ryzeal | 1/4 | 0/4 | -1 | -16 |
| Most others | similar | similar | 0 | mixed |

Branded gained matched (+2). Almost everything else regressed. Total : -8 matched.

#### Hypothesis — overfit-by-budget

At budget-ms=30000, DFS during training has 5× more wall-time per rollout. It explores deeper terminals on average. The fitness signal during training is "score against deep terminals". Weights optimize for patterns that work in deep search.

At eval budget-ms=6000, DFS only reaches shallower terminals. Weights tuned for deep patterns don't help — the prod-DFS doesn't reach the boards the training optimized for.

Branded was the exception : its canonical line is reachable even at shallow budget, so deep-trained weights still helped there.

#### Implication

**Train and eval at the SAME regime, or there's a fitness/deployment mismatch.** Production regime budget-ms=6000 remains canonical. F2 was a 7h compute investment that confirmed regime change is NOT a free improvement — the parallel session's CPU-noise concern is real but doesn't dominate training quality.

### Finding 3 — Variance tripled with feature additions

| Config | Matched range across 3 seeds | Variance type |
|---|:-:|---|
| PF v2 linear (95 feat) | 3 matched (12-15) | Stable |
| **Linear v3 (116 feat)** | **9 matched (9-18)** | **3× wider** |
| MLP v3 (116 feat) | 5 matched (17-22) | 1.7× PF v2, MLP narrows |

Adding 21 features expanded the search space. ES at (μ+λ)=(5+10) with σ_init=0.3 finds different optima per seed in the larger space. **Without sufficient model capacity (MLP), some seeds settle in basins worse than the smaller-feature baseline.**

This implies :
- **Sprint 3 will likely increase variance further** (more features → more basins)
- **MLP arch becomes more critical** as the rescue mechanism
- **Multi-seed discipline (≥3) is mandatory** to detect sd11-class failures
- **5 seeds would give better confidence** but doubles compute

---

## Bonus finding — eval-side regime affects measurement

F1 sd7 weights at det eval = 24 matched (vs prod eval = 22). Same weights, different eval regime. **The eval-side regime can squeeze 2 more matched out of existing weights** by giving DFS more time to reach canonical terminals.

This is informational for ship-gate metrics : if we want the *true* matched score weights can produce, evaluate at higher budget (det). For comparison with historical Phase B numbers, prod eval is canonical.

Implication : **production at budget-ms=6000 may be undermeasuring weight quality** by ~2 matched per fixture. Not changing canonical, but worth noting for any "is this enough to ship?" decision.

---

## Sprint 3 plan — confirmed and refined

### Architecture (locked)

- **MLP[32] is non-negotiable.** Linear arch carries 3× the variance and can fail catastrophically on individual seeds.
- **Hidden dim 32 confirmed adequate** at this scale (no MLP[64] data, but MLP[32] saves sd11 already; depth experiments deferred).
- **Random init (gaussian:0.1) required.** Zero-init was tested in Day 2, hits ReLU saturation.

### Regime (locked)

- **Production regime budget-ms=6000, nb=400** remains canonical for both training and eval.
- **No determinism-fixed retrain.** F2 confirmed it's a different objective, not better.
- **CPU noise concern from parallel session** : real but marginal. Acceptable defect. The mitigation is multi-seed not regime change.

### Multi-seed discipline (mandatory)

- **3 seeds (42, 7, 11) minimum**, ideally 5 (add 2 new for better variance estimate).
- **Median is the headline metric**, but **min must be reported and inspected** for sd11-class failures.
- **Variance tracking** : if Sprint 3 adds features and variance increases above current MLP v3 range=5, that's a flag.

### Feature additions (priority order from ygo-essence backlog)

Per the backlog memo `ygo-essence-feature-deep-dive-2026-04-26.md`, axes ranked by expected ROI :

1. **Axis B (cost features)** — ~5-7 features. Catalog parser extension required (`act_cost_discard`, `act_cost_tribute`, `act_cost_banish_self`). Sprint coverage gate currently <5%, defer until parser improved.
2. **Axis C (output magnitude)** — ~4-6 features. `act_card_atk_norm`, `act_card_def_norm`, `act_card_target_count`. Direct from CardMetadata + parser. Easier path.
3. **Axis D (connectivity / unlocks)** — `act_unlocks_*` features. Parser-dependent, audit showed ~50% reliability ceiling. Defer.
4. **Axis F (interruption-enrichment)** — diversity, redundancy. Risk of leakage per adversarial review. Defer until other axes plateau.

**Recommended Sprint 3 wave 1** : axis C (output magnitude, ~5 features). Smallest catalog dependency, direct measurable.

### Compute infrastructure (priority bumped)

Sprint 3 compute estimate :
- Wave 1 retrain (3 seeds × MLP × 30 gen × 4 fix × 116+5 feat) : ~7h sequential
- + Ablation sweep (drop axis L, drop axis E, drop axis S) : ~6h sequential
- + Multi-seed extension (5 seeds) : +5h sequential
- + Final 60-gen run + ablations : +10h sequential
- **Total ~28-35h sequential** for Sprint 3 deliverable

With pool ES (4-5x speedup), Sprint 3 = ~7-9h. **Pool ES infra (~1j eng)** has clear ROI.

### Phase 3 trajectory tooling (priority bumped)

The sd11 vs sd7 divergence (different basins, different decisions) makes it interesting to **extract trajectories per seed** to understand WHY they diverge. Phase 3 tooling could be built in parallel with Sprint 3 retrains and analyzed during Sprint 3 ablations.

---

## Files & references

- F1 logs : `data/training-logs/path-1.5-overnight-20260426T205207Z/`
- F2 logs : `data/training-logs/path-1.5-overnight-f2-20260427T054905Z/`
- α takeover logs : `data/training-logs/post-f2step1-takeover-20260427T130548Z/`
- Best weights for ship : `data/trained-weights/neural-mlpv3-gate-seed7.json` (Phase B v2 candidate, cum hold-out 22 matched, score 284)
- Trained weights archive : `neural-mlpv3-gate-seed{42,7,11}.json`, `neural-linearv3-{seed42-from-F1,seed7,seed11}.json`, `neural-mlpv3-detregime-seed7.json`
- Predecessor verdict memo : `_bmad-output/solver-data/phase-b/pre-flight-verdict-2026-04-26.md`
- Wiring playbook : `_bmad-output/solver-data/phase-b/mvp-v3-wiring-playbook-2026-04-26.md`
- Determinism investigation : `_bmad-output/solver-data/phase-b/determinism-investigation-2026-04-26.md`
- Ygo-essence backlog : `_bmad-output/solver-data/phase-b/ygo-essence-feature-deep-dive-2026-04-26.md`
