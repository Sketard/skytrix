# Phase A budget scaling — option D test (nb=400, nb=800)

**Date:** 2026-04-26.
**Question:** Does Phase A scale with larger search budget? Is the 28/69
ceiling at nb=200 a budget bound or a structural bound?
**Answer:** Budget-bound. nb=400 lifts +3 matched; nb=800 +1 more
(diminishing returns). New ceiling at v4 + Phase A + nb=800: **32/69**.

## Setup

`evaluate-structural.ts --pool-size=1` with varying node budgets. Wall-clock
budget scaled proportionally (`--budget-ms = 30 × nb`) so the global timeout
never preempts node-budget mode.

| Config | nb=200 (3000ms) | nb=400 (6000ms) | nb=800 (12000ms) |
|---|---|---|---|
| **Untuned, Phase A off** (control) | 14/69 baseline | 17/69 (+3) | — |
| **Untuned + Phase A N=10** | 25/69 (+11 vs baseline) | 28/69 (+3 vs nb=200) | — |
| **v4 tuned + Phase A N=10** | **28/69** | **31/69** (+3) | **32/69** (+1) |

## Per-fixture deltas — v4 + Phase A, nb=200 → nb=800

| Fixture | nb=200 | nb=400 | nb=800 |
|---|---|---|---|
| ddd-pendulum | 1/5 | 1/5 | 1/5 |
| ryzeal-mitsurugi | 3/5 | 3/5 | 3/5 |
| radiant-typhoon | 1/3 | **2/3** | 2/3 |
| branded-dracotail | 5/8 | **6/8** | 6/8 |
| kashtira-azamina | 1/4 | 1/4 | 1/4 |
| horus-crystron | 2/4 | 2/4 | 2/4 |
| dinomorphia | 1/3 | 1/3 | 1/3 |
| spright | 3/4 | 3/4 | 3/4 |
| snake-eye-yummy | 2/7 | 2/7 | 2/7 |
| tearlaments | 1/4 | 1/4 | 1/4 |
| floowandereeze | 2/4 | 2/4 | 2/4 |
| labrynth | 2/4 | 2/4 | 2/4 |
| stun-runick | 1/4 | **2/4** | **3/4** |
| nekroz-ryzeal | 1/4 | 1/4 | 1/4 |
| branded-mirrorjade-line | 2/6 | 2/6 | 2/6 |
| **Total** | **28/69** | **31/69** | **32/69** |

Lifts breakdown:
- nb=400: branded primary 5→6 (resolves audit -1), radiant-typhoon 1→2,
  stun-runick 1→2.
- nb=800: stun-runick 2→3 (only).

The branded "5/8 with v4" issue diagnosed in the prior memo
(`phase-a-v5-retrain-2026-04-26.md`) was not actually a v4 weight problem
— it was a budget problem. With nb=400, v4's bias toward the shorter
terminal still wins on score, but DFS now has enough budget to also
explore the 6/8 terminal and eventually rank it higher. **The v5 retrain
exercise was a red herring.**

## Cost analysis

| nb | Per-fixture wall (~) | 15-fixture pool=1 wall |
|---|---|---|
| 200 | 3s | ~45s |
| 400 | 6s | ~90s |
| 800 | 12s | ~180s |
| 1600 | 24s | ~360s |

nb=400 is the practical sweet spot — 2× cost for +3 matched is worth it.
nb=800 doubles cost for +1 marginal — only worth running when targeting
specific fixtures (stun-runick).

## Implications for Phase B

Budget scaling delivered **+4 cum matched (28→32)** at zero design cost.
This recalibrates the "what could Phase B realistically deliver?" baseline:

- Pre-budget-scaling baseline: 28/69. Phase B target: maybe +3-5 → 31-33.
- Post-budget-scaling baseline: 32/69. Phase B target: now +1-3 → 33-35.

Phase B's delta is the same in absolute terms (the bottleneck Phase B
attacks — cross-fixture generalization — is unaffected by budget). But
the relative value vs effort changes:

- Before: +3-5 matched / ~1 week = ~5%/day-of-work
- After: +1-3 matched / ~1 week = ~2%/day-of-work

Still potentially worth it, but the case is weaker. Several fixtures
remain stuck at 1-2/4 (kashtira, horus, dinomorphia, tearlaments,
floowandereeze, labrynth, nekroz-ryzeal) — these are likely
**archetype-expertise gaps** (no authored ComboGoal/route grammar)
rather than ranker gaps. Writing per-archetype expertise files might be
higher leverage than Phase B for those specific fixtures.

## Recommendations

1. **Promote nb=400 as canonical eval** in methodology.md. Update existing
   canonical command from nb=200 to nb=400.
2. **Re-eval-2026-04-26 baselines at nb=400** (cumulative 32/69 ship state).
3. **Phase B vs archetype-expertise authoring** — at this baseline, the
   marginal lift from neural ranker is competing with the marginal lift
   from "write a ComboGoal for kashtira-azamina" (much cheaper, much more
   targeted). Worth scoping both before committing.
4. **Consider nb=800 reserved mode**: when investigating a specific stuck
   fixture (e.g., stun-runick reaching 3/4 only at nb=800), use nb=800
   ad-hoc rather than as standard.

## Files

- `eval-nb400-baseline.json` — control: untuned, Phase A off, nb=400
- `eval-nb400-phase-a-tuned.json` — v4 + Phase A, nb=400 (new ship target)
- `eval-nb400-phase-a-untuned.json` — untuned + Phase A, nb=400
- `eval-nb800-phase-a-tuned.json` — v4 + Phase A, nb=800 (diminishing returns)
