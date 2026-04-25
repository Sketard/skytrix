# Fixture Audit — 2026-04-25

**Purpose**: Surface where the solver fails across the 15-fixture corpus, give RL team concrete failure modes to optimize against.

**Run config**: `evaluate-structural.ts --node-budget=400 --budget-ms=300000` from HEAD `6ea4c9e8` (post-phase-19).

**Aggregate**: 22/69 matched (32%), cumulative score 416.17.

---

## Per-fixture results (sorted by matched ratio)

| Fixture | matched | ratio | score | goalM | term | nodes | depth | turn2% |
|---|---|---|---|---|---|---|---|---|
| radiant-typhoon-opener | 2/3 | 67% | 21 | **0** | depth_cap | 2651 | 60 | 21% |
| ryzeal-mitsurugi-opener | 3/5 | 60% | 77.5 | **55.5** | timeout | 2538 | 68 | 33% |
| branded-dracotail-opener | 4/8 | 50% | 71.8 | **43.8** | timeout | 2791 | 45 | 43% |
| floowandereeze-opener | 2/4 | 50% | 14 | **0** | completed | 2506 | 55 | 21% |
| nekroz-ryzeal-opener | 2/4 | 50% | 42 | **25** | timeout | 2376 | 64 | 39% |
| kashtira-azamina-opener | 1/4 | 25% | 25 | **0** | timeout | 2153 | 72 | 53% |
| horus-crystron-opener | 1/4 | 25% | 10 | **0** | completed | 1878 | 50 | 32% |
| spright-opener | 1/4 | 25% | 16 | **0** | timeout | 2531 | 46 | 42% |
| tearlaments-opener | 1/4 | 25% | 17 | **0** | timeout | 1970 | 70 | 33% |
| labrynth-opener | 1/4 | 25% | 9 | **0** | completed | 1795 | 36 | 58% |
| stun-runick-opener | 1/4 | 25% | 13 | **0** | depth_cap | 2044 | 50 | 42% |
| ddd-pendulum-opener | 1/5 | 20% | 17 | **0** | depth_cap | 1994 | 50 | 22% |
| branded-dracotail-mirrorjade-line | 1/6 | 17% | 58.6 | **26.6** | timeout | 3623 | 67 | 48% |
| snake-eye-yummy-opener | 1/7 | 14% | 23.2 | **15.2** | depth_cap | 2599 | 75 | 47% |
| **dinomorphia-opener** | **0/3** | **0%** | 1 | 0 | completed | 1701 | 27 | 34% |

---

## Key findings

### Finding 1 — Expertise drives matched (CRITICAL)

**5/15 fixtures have `goalMatchPoints > 0`** (= archetype expertise loaded):
- ryzeal-mitsurugi, branded-dracotail, nekroz-ryzeal, snake-eye-yummy, branded-dracotail-mirrorjade

These 5 score on average **54.6** vs **15.4** for the 10 expertise-less fixtures (3.5x). The matched ratio is also higher: 5/5 fixtures with expertise have ≥1/N matched, but the absolute count varies.

**The other 10 fixtures have ZERO goalMatchPoints** because their archetypes lack authored expertise files. The DFS explores blindly via the base ranker (GoldfishChainRanker), with no goal-direction signal.

**Implication for RL**:
- M1 trained on `snake-eye-yummy` + `branded-dracotail` (and similar). RL learned weights are tuned to these expertise-supported environments.
- 10 fixtures (kashtira, horus, dinomorphia, spright, tearlaments, floowandereeze, labrynth, stun-runick, ddd, radiant-typhoon) have NO expertise → RL training there has no goal-match signal to learn from.
- **RL generalization is bottlenecked by expertise coverage**, not by graph features.

### Finding 2 — Termination histogram

| Termination | Count | Implication |
|---|---|---|
| timeout (7) | Solver ran out of `--budget-ms` | Either combo too long for budget OR exploration too breadth-y |
| depth_cap (4) | Hit max DFS depth (~50-75) | Combo path longer than depth allowed, ranker not pruning shallow dead-ends |
| completed (4) | Search exhausted, no combo found | Either no path exists in this state OR ranker steered exclusively to bad paths |

**Critical**: `dinomorphia-opener` completed with score=1, matched=0/3 — the solver searched the full space and found nothing. dinomorphia is FTK-shape (high LP-loss self-burn), not a typical combo deck — solver's combo-orientation might be misaligned.

### Finding 3 — Snake-eye-yummy underperforms (1/7)

**Most-invested archetype but only 14% matched**. Hit depth_cap at 75, score=23.2, goalM=15.2 (lowish despite all our snake-eye work).

Hypotheses worth probing:
- expectedBoard expects a 7-piece endboard — solver's depth=75 might still be too shallow
- Snake-eye combos in this fixture might require Diabellstar SZONE (the bridge we authored today) — RL hasn't trained on weights utilizing the new bridge
- The 1 matched piece might be an early intermediate (Snake-Eye Ash on field) rather than the deep apex

**Recommendation**: drill-in via `audit-fixture.ts --fixture=snake-eye-yummy-opener` to see exact peak field vs expectedBoard.

### Finding 4 — Branded-dracotail-mirrorjade-line (1/6, score 58.6)

High score (58.6), low matched (1/6). The solver found a path that scores well but doesn't reach the canonical mirrorjade endboard. This is **score-target divergence** — the scorer rewards a different state than the expectedBoard expects.

**Recommendation**: investigate scoring mismatch. Either expected board is too specific (no SOTA path produces it cheaply), or scorer over-rewards generic strong states vs the canonical line.

---

## Concrete actionables for RL team

### Priority 1 — Authoring coverage
**10/15 fixtures lack archetype expertise**. RL trained on 5 fixtures will not generalize without:
- Authored bridges for: kashtira, horus, dinomorphia, spright, tearlaments, floowandereeze, labrynth, stun-runick, ddd, radiant-typhoon
- OR a different RL training strategy that doesn't require pre-existing expertise (e.g., self-play exploration, MCTS-style)

Phase 10c-style authoring takes ~1-2h per bridge, ~3-5 bridges per archetype = 30-100h for full coverage. **Not realistic for the current cycle.**

**Better path**: pick 1-2 high-leverage archetypes (kashtira, horus) to author next, focus RL training there.

### Priority 2 — Snake-eye-yummy regression check
- Solver scores 1/7 matched on the most-developed archetype
- Re-run after RL training cycle to measure if M1 weights help
- If yes: keep RL doing its thing. If no: investigate expectedBoard / depth_cap interaction

### Priority 3 — Fixture diversity for training
- Of the 5 expertise-supported fixtures, 2 are branded variants → over-representation
- Consider weighting fixture selection in training to avoid bias toward branded engine
- ryzeal-mitsurugi (3/5 matched, no apparent ceiling) might be a good RL training target

### Priority 4 — Termination-mode rebalancing
- 7/15 timeout = budget-bound. Could revisit `--budget-ms` ceiling, or improve ranker pruning so less budget needed
- 4/15 completed with low matched = scorer misalignment
- 4/15 depth_cap = depth budget too low for some combos. Could increase `maxDepth` per-fixture (already supported via `hand.maxDepth`)

---

## Methodology + raw output

- Run: `cd duel-server && npx tsx scripts/evaluate-structural.ts --node-budget=400 --budget-ms=300000 --out=../_bmad-output/solver-data/audit-fixtures-2026-04-25.json --label="fixture-audit-2026-04-25-post-phase-19"`
- Output JSON: [audit-fixtures-2026-04-25.json](audit-fixtures-2026-04-25.json)
- Single-fixture deep-dive: `npx tsx scripts/audit-fixture.ts --fixture=<id>`
- Re-run baseline-vs-current: `--compare=<previous-baseline.json>`

## Author notes

This audit captures HEAD = `6ea4c9e8` (post all 9 phases shipped 2026-04-25). RL training that uses these weights as input would benefit from the +156 fusion edges (phase 19) and +3458 chain-link edges (phase 18) added today, but no fixture-level score change has been verified yet.

For comparison vs pre-session baseline (commit `91fd213b`), re-run with the same node-budget and compare via `--compare`.
