# Option A — Per-Archetype Isolated Training (2026-04-25)

3 isolated training runs at **production budget (30 s/eval)**, each
training a separate weight file on one fixture, then cross-validated on
all 15 fixtures. Falsifies F4 and reframes F5.

## Run Configuration

| Param | Value |
|---|---|
| Tier | A (267 edges, confidence=high proxy) |
| μ / λ / generations | 3 / 4 / 8 |
| DFS budget per eval | 30 000 ms, `rootChildBudgetNodes=200` |
| Seed | 42 |
| Evals per run | 3 + 32 = 35 |
| Wall-time per run | ~10 min |

Trained 3 archetypes (4th, horus-crystron, was queued but stopped per
user request after snake-eye finished — N=3 is enough to test the option-A
hypothesis).

## Training-Time Lift (training-fixture composite fitness)

| Run | Baseline (weights=0) | Best | Δ |
|---|---:|---:|---:|
| `tier-a-branded` (branded-dracotail) | 45.73 | 48.43 | +2.68 |
| `tier-a-ryzeal-mitsurugi` (ryzeal-mitsurugi) | 55.41 | 65.72 | +10.31 |
| `tier-a-snake-eye` (snake-eye-yummy) | 17.47 | 22.97 | +5.50 |

All 3 runs plateaued by gen 2-3 (consistent with **F1**).

## Production-Budget Cross-Validation Gate (15 fixtures, untuned baseline)

Untuned aggregate : matched 11/69, score 186.86.

### Tier-a-branded weights

| Aggregate | Untuned → Tuned | Δ |
|---|---:|---:|
| matched | 11/69 → 16/69 | **+5** |
| score | 186.86 → 273.50 | **+86.64 (+46.4 %)** |
| explorationScore | 205.61 → 288.08 | +82.47 |

7 improvements, 2 corrections (`spright`, `snake-eye-yummy` : matched −1
but score up — stricter endboard), 6 stable, **0 regressions**.

Standout : own fixture `branded-dracotail-opener` lifted matched 3→6,
score 30.64→63.36 (**+106 %**).

### Tier-a-ryzeal-mitsurugi weights

| Aggregate | Untuned → Tuned | Δ |
|---|---:|---:|
| matched | 11/69 → 15/69 | **+4** |
| score | 186.86 → 252.93 | **+66.07 (+35.4 %)** |
| explorationScore | 205.61 → 267.51 | +61.90 |

6 improvements, 1 correction, 8 stable, **0 regressions**.

Cross-fixture transfer surprise : these weights lifted **branded-dracotail**
matched 3→5, score 30.64→54.79 (+78.7 %).

### Tier-a-snake-eye weights

| Aggregate | Untuned → Tuned | Δ |
|---|---:|---:|
| matched | 11/69 → 16/69 | **+5** |
| score | 186.86 → 301.17 | **+114.31 (+61.2 %)** |
| explorationScore | 205.61 → 320.75 | +115.14 |

11 improvements, 1 correction, 3 stable, **0 regressions**.

Best aggregate lift of the three. Cross-fixture broadest transfer :
ddd, ryzeal, radiant-typhoon, branded, kashtira, horus, tearlaments,
floowandereeze, stun-runick, mirrorjade-line all lifted on a single
weight file trained on snake-eye-yummy alone.

## New Findings

### F6 — F4 falsified at production-budget training

The M1 short-budget weights regressed cross-fixture (gate `dfb9be5e`).
Re-training the *same* archetype (branded) at 30 s/eval instead of 4 s/eval
produces weights that **lift** branded by +106 % on its own fixture and
lift 6 other fixtures, with zero regressions.

**Reframing of F4** : the issue was never "training-budget specificity"
in some general sense — it was that 4 s/eval is too short to produce
*real* learning signal. The weight values learnt at 4 s were tuned to
short-DFS quirks (action-ordering effects within the first ~50 nodes)
that don't generalise. At 30 s/eval, the ES sees enough state-space to
find weights that bias DFS toward broadly useful subtrees.

**Practical takeaway** : per-eval budget IS critical, but the threshold
is "long enough to produce useful learning signal", not "match production
budget exactly". 30 s/eval is sufficient on tier-A.

### F7 — Per-archetype training generalises positively at production budget

All 3 isolated archetype-specific weight files lift **most or all 15
fixtures**, not just their training fixture. This is the opposite of the
specialist-collapse predicted by **F2**+**F5**.

Two interpretations possible :

1. **The weights learnt something general about good action-ranking** —
   patterns that hold across archetypes (prefer ignition over searches
   when ignition payoff is higher, etc.). Tier-A edges are the "high
   confidence" subset of the dependency graph, so bias on these edges
   hits structural fundamentals rather than archetype quirks.

2. **The training pressure is regularised by the fitness floor** — the
   composite reward `α·matched² + β·partial_goals` puts most signal on
   `partial_goals` (= `goalMatchPoints` from the strategic-grammar
   layer), which itself draws from generic combo-shape patterns.
   Effectively training-via-grammar instead of training-via-fixture.

Either interpretation is good news for the v1 framework :
isolated per-archetype training files **already** provide the diversity
that MAP-Elites was supposed to deliver in M2. The full MAP-Elites
infrastructure may not be needed.

### F8 — Cross-archetype transfer ≠ no archetype specialisation

Despite the cross-fixture lift, training-fixture lifts are still highest
for the matching archetype's weights :

| Fixture | Best weight file | Δ score | Other top file | Δ score |
|---|---|---:|---|---:|
| branded-dracotail | snake-eye | +41.14 | branded | +32.71 |
| ryzeal-mitsurugi | snake-eye | +8.50 | branded/ryzeal | +6.50 |
| snake-eye-yummy | snake-eye (own) | +7.67 | (others = correction) |

snake-eye weights actually beat branded-trained weights ON branded-dracotail
(+41 vs +33 score lift). The training fixture isn't necessarily the optimal
match for evaluation — counter-intuitive but consistent with **F7-2**
(grammar-regularised training).

**Implication** : if shipping a single set of weights, **`tier-a-snake-eye`
is the best option-A candidate** by aggregate metric. If shipping
deck-specific weights, none of the 3 dominate clearly — needs more
fixture coverage to disentangle.

## Recommendation for Next Step

The v1 framework works at production budget (~30 s/eval). Two paths
forward, in order of cost :

1. **Ship `tier-a-snake-eye.json` as the production weight file** for
   `SOLVER_USE_TUNED_WEIGHTS=1` users. +61 % aggregate score, +5 matched,
   0 regressions vs untuned. Single weight file simplifies deployment.
2. **Extend coverage** : train tier-a-horus-crystron + tier-a-mitsurugi
   (M1's missing 4th run + the closest pair to ryzeal) and re-gate to
   pick the strongest single file (or short list of 2-3 files for deck-
   based selection via existing `filterExpertiseByDeck`).
3. **Expand to tier-B** (high+medium = 629 edges). May lift further or
   may dilute — F1 says plateau happens fast either way, so cost is
   bounded.

Skipping the full MAP-Elites M2 infrastructure is justified by **F7**
unless we see specialisation-vs-transfer trade-offs that current data
doesn't reveal. Recommend path 1 ship-now + path 2 next-session
exploration.

## Artefacts

| File | Purpose |
|---|---|
| `tier-a-branded.json` (weights) | branded-trained, 30 s/eval, gen 8 |
| `tier-a-ryzeal-mitsurugi.json` | ryzeal-mitsurugi-trained |
| `tier-a-snake-eye.json` | snake-eye-trained (best aggregate gate result) |
| `optA-gate-{branded,ryzeal-mitsurugi,snake-eye}.{json,log}` | per-weight gate runs |
| `metrics-optA-{branded,ryzeal-mitsurugi,snake-eye}.csv` | per-gen training metrics |
