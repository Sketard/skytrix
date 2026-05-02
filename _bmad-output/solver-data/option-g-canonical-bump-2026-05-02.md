# Option G — Canonical Budget Bump (400 → 800 nodes / 12s) ACCEPTED

**Date:** 2026-05-02
**Status:** SHIPPED — new canonical baseline `canonical-eval-v2-2026-05-02.json` saved alongside the v1 reference
**Predecessor:** `dfs-compression-pilot-2026-05-02.md` (Phase 1 NULL on 400-node canonical, Option G recommended as next test)

## Decision

**Bump canonical-eval to `--budget-ms=12000 --node-budget=800` with `SOLVER_USE_DFS_COMPRESSION=1`.** Reproducible 3/3 runs at 31/69 matched / 596 score, vs 27/69 / 545 at the prior 400-node canonical: **+4 matched, +51 score, 0 regression matched.**

The wallclock cost is ~3 minutes total for the 15-fixture eval (~12s × 15 / pool=1) — acceptable. The new config becomes the reference for any future scorer/ranker iteration.

## Empirical 2×2 matrix

| | compression OFF | compression ON | Δ compression |
|---|---|---|---|
| **400 nodes / 6s** | 27/69, 545 | 28/69, 551 | +1 / +6 |
| **800 nodes / 12s** | 30/69, 575 | **31/69, 596** | +1 / +21 |
| **Δ budget** | +3 / +30 | +3 / +45 | |

Decomposition:
- **Effet budget seul** (400→800, OFF): +3 matched / +30 score
- **Effet compression seul à 400**: +1 matched / +6 score (marginal)
- **Effet compression seul à 800**: +1 matched / +21 score (synergy)
- **Combined Option G**: +4 matched / +51 score

The compression-budget synergy is empirically validated: at 400 nodes, the depth unlocked by compression is mostly consumed by SELECT_IDLECMD branching factor; at 800 nodes the additional budget actually exploits that depth (+15 score gain vs the sum of isolated effects).

## Per-fixture diff (canonical 400 OFF → Option G 800 ON)

| Fixture | 400 OFF | Option G | Δ matched | Δ score |
|---|---|---|---|---|
| branded-dracotail-opener | 4/8 80.0 | 4/8 80.0 | 0 | 0 |
| branded-dracotail-opener-mirrorjade-line | 1/6 20.0 | 1/6 29.0 | 0 | +9 |
| ddd-pendulum-opener | 1/5 27.0 | 1/5 28.0 | 0 | +1 |
| **dinomorphia-opener** | **0/3 0.0** | **1/3 11.0** | **+1** | **+11** |
| floowandereeze-opener | 2/4 32.0 | 2/4 32.0 | 0 | 0 |
| horus-crystron-opener | 2/4 43.0 | 2/4 43.0 | 0 | 0 |
| **kashtira-azamina-opener** | **1/4 34.0** | **2/4 44.0** | **+1** | **+10** |
| **labrynth-opener** | **1/4 16.0** | **2/4 21.0** | **+1** | **+5** |
| nekroz-ryzeal-opener | 2/4 37.0 | 2/4 37.0 | 0 | 0 |
| **radiant-typhoon-opener** | **2/3 38.0** | **3/3 57.0** | **+1** | **+19** |
| ryzeal-mitsurugi-opener | 3/5 72.0 | 3/5 67.0 | 0 | **−5** |
| snake-eye-yummy-opener | 2/7 39.0 | 2/7 39.0 | 0 | 0 |
| spright-opener | 3/4 50.0 | 3/4 50.0 | 0 | 0 |
| stun-runick-opener | 2/4 30.0 | 2/4 31.0 | 0 | +1 |
| tearlaments-opener | 1/4 27.0 | 1/4 27.0 | 0 | 0 |

**4 fixtures gain matched, 0 lose matched, 1 fixture (mitsurugi) loses 5 score with matched preserved.**

The mitsurugi −5 score is the "fast-fixture compression-regression" pattern from the Phase 1 pilot, shifted from a matched loss (at 400 budget) to a score-only loss (at 800 budget). 3/5 matched is preserved, so the canonical metric is unaffected.

3 of the 4 gainers (dinomorphia, kashtira-azamina, labrynth) are on the "7 stuck fixtures" list flagged in MEMORY.md as authoring-target candidates (Option F, ~1-2d/fixture). Option G unlocks those without any authoring effort.

## Reproducibility

3/3 reproducibility runs of Option G at 800 nodes / 12s + compression ON: **identical** 31/69 matched / 596 score. No flap in this config (vs the 400-node canonical's bimodal [27, 28] flap window documented in 2026-04-27 eval-noise audit).

## What this changes

1. **New canonical**: future eval comparisons quote 31/69 / 596 as the reference, not 28/69 / 555. Memos written before today's commits should be cross-read with this in mind.
2. **Compression always-on for canonical**: `SOLVER_USE_DFS_COMPRESSION=1` becomes part of the canonical command. Default OFF in code remains, so non-canonical runs (smoke tests, plan-replay-cli) keep bit-exact behavior.
3. **New reference baseline file**: `phase-1-baselines/canonical-eval-v2-2026-05-02.json` saved alongside the v1 reference. Manifest annotation pending in a follow-up if needed.
4. **Path forward**: 4 of the 7 historically-stuck fixtures still un-budgeted (tearlaments 1/4, branded-dracotail 4/8, branded-mirrorjade 1/6, snake-eye-yummy 2/7, ddd-pendulum 1/5) are no longer about depth budget — they need real algorithmic work (Option E MCTS, or Option F authoring). The depth-budget excuse is closed.

## Files

- New baseline: `_bmad-output/solver-data/phase-1-baselines/canonical-eval-v2-2026-05-02.json`
- Comparison tool: `duel-server/scripts/compare-eval-runs.mjs` (new)
- This memo: `_bmad-output/solver-data/option-g-canonical-bump-2026-05-02.md`

## Recommended canonical command from now on

```
SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 SOLVER_USE_DFS_COMPRESSION=1 \
  npx tsx scripts/evaluate-structural.ts \
  --out=<path> --budget-ms=12000 --node-budget=800 --pool-size=1 --implicit-goals=10
```
