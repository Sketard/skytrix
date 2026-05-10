# Honest baseline — measure of pure solver capability

**Date:** 2026-04-26.
**Trigger:** User philosophical clarification — *"Gagner si l'humain est présent
n'est pas intéressant; cela gonfle artificiellement les résultats. À terme,
l'idée est de ne plus avoir authoreted humain mais de se servir des itérations
pour réellement construire les lignes canoniques."*
**Goal:** decompose our 32/69 cum matched into "real" search/scoring capability
vs "scaffolded" via authored expertise + expectedBoard goal anchoring.

## Three configurations measured

Canonical: `--budget-ms=6000 --node-budget=400 --pool-size=1` with v4 weights
(`tier-a-latest.json`, trained 2026-04-25 seed=42).

| Config | expertise | Phase A | cum matched | cum score |
|---|---|---|---|---|
| **(a) Status quo (ship)** | ON | ON (N=10) | **31/69** | **553** |
| **(b) Expertise OFF, Phase A ON** | OFF | ON (N=10) | 30/69 (-1) | 428 (-125) |
| **(c) Honest baseline** | OFF | OFF | 15/69 (-16) | 174 (-379) |

## Per-fixture matched at honest baseline (c)

| Fixture | (a) status quo | (c) honest |
|---|---|---|
| ddd-pendulum-opener | 1/5 | 1/5 |
| ryzeal-mitsurugi-opener | 3/5 | 1/5 |
| radiant-typhoon-opener | 2/3 | 2/3 |
| branded-dracotail-opener | 6/8 | 5/8 |
| kashtira-azamina-opener | 1/4 | 1/4 |
| horus-crystron-opener | 2/4 | 1/4 |
| dinomorphia-opener | 1/3 | 0/3 |
| spright-opener | 3/4 | 1/4 |
| snake-eye-yummy-opener | 2/7 | 0/7 |
| tearlaments-opener | 1/4 | 0/4 |
| floowandereeze-opener | 2/4 | 2/4 |
| labrynth-opener | 2/4 | 1/4 |
| stun-runick-opener | 2/4 | 0/4 |
| nekroz-ryzeal-opener | 1/4 | 0/4 |
| branded-mirrorjade-line | 2/6 | 0/6 |
| **Total** | **31/69** | **15/69** |

## Attribution decomposition

Comparing the 3 configurations isolates each layer's contribution:

| Layer | Δ matched | Δ score | Verdict |
|---|---|---|---|
| (a)→(b): Remove expertise (4 authored files) | -1 | -125 | Expertise contributes mostly to *score* via partial goal-match awards; minimal effect on *terminal selection* (1 matched cross-fixture, ryzeal-mitsurugi) |
| (b)→(c): Remove Phase A (implicit goals from expectedBoard) | -15 | -254 | **Phase A is the dominant lift mechanism**. +15 matched comes from rewarding `expectedBoard` cards on terminal field — flips DFS preference to longer expectedBoard-aligned terminals |

Honest decomposition of the 31/69 lift over raw baseline (14/69 at nb=200):
- **+15 matched** from Phase A scorer fix (legitimate — converts goal statement into reward)
- **+3 matched** from budget scaling nb=200→nb=400 (legitimate — pure search)
- **+1 matched** from authored expertise files (scaffolding — ryzeal-mitsurugi cross-fixture transfer)
- **0 matched** from v4 trained weights at honest config (noise-level — v4 was trained WITH expertise active, its lift evaporates without)

## Implications for the roadmap

### What's legitimate
- **expectedBoard as problem statement**: each fixture says "given (deck, hand), the canonical combo achieves THIS endboard". User-validated: this defines the goal, not the solution.
- **Phase A scorer fix**: converts goal statement into reward signal. Same authoring-tier as the goal itself.
- **Search budget tuning, structural latent F1/F2/F3**: deck-agnostic, pure mechanics.
- **ES-trained ranker weights**: learning is real, IF the fitness landscape is honest (= no goalMatchPoints from authored expertise).

### What's scaffolding (= temporary, must be removed long-term)
- **archetype-expertise files** (`branded.json` / `mitsurugi.json` / `ryzeal.json` / `snake-eye.json`). These encode:
  - Roles per cardId (= "Lukias is a tutor")
  - Goals (= "branded-canonical-full = these 7 cards on field")
  - Routes (= "Lukias NS → search Urgula → Cartesia Fusion → Secreterion ...")
  - Bridges (intermediate state transitions)
  
  All are HUMAN-CURATED domain knowledge. Removing them dropped score by 125 with only -1 matched, confirming most of their effect is *score inflation via partial-match credit on the same DFS terminals* — not actual terminal-flipping.

- **`preferredIntermediates`** (currently only on `branded-mirrorjade-line`). Encodes "during the combo, when SELECT_CARD prompts for a target, prefer THIS cardId". Same authoring tier as expertise routes.

- **D/D hardcode in scorer** (`DARK_CONTRACT_IDS`, `DOOM_QUEEN_MACHINEX_ID` in interruption-scorer.ts). Archetype-tagged latent points reward states that aren't deck-agnostic.

### Long-term vision (user-validated 2026-04-26)

> *"Étant donné une decklist et une main de départ, quel est le combo optimal
> pour atteindre le meilleur terrain (via calcul de pondération des
> interruptions). À terme, expectedBoard doit disparaître."*

This is **pure optimization**. The solver receives only `(deck, hand)` and
outputs the maximum-`interruptionScore` reachable endboard plus the trajectory
that gets there. expectedBoard moves from input data to **a posteriori
validation aid** (humans verify the discovered trajectory matches their intent).

The solver becomes a **canonical-line discoverer** rather than a
canonical-line-executor.

## Revised roadmap (post 2026-04-26 philosophical clarification)

### Phase 0 — Honest baseline (DONE 2026-04-26, this memo)
Measure where the solver actually stands without scaffolding: **15/69 cum
matched, 174 cum score** at honest config (c). This is the real reference point
for measuring future progress.

### Phase 1 — Scorer audit (~3-5 days, NEXT)
The scorer is now the only ground truth. Validate it's not exploitable:
1. **Fallback heuristic robustness** — `fallbackPoints` (+1 per untagged face-up
   monster) is gameable. Test if pure `interruptionScore` fitness ES converges
   to dégénérate "many-bodies" terminals. If yes, replace with stricter rule
   ("+1 only when a tag fires somewhere on the same body").
2. **D/D hardcode removal** — extract `DARK_CONTRACT_IDS` /
   `DOOM_QUEEN_MACHINEX_ID` to either a deck-agnostic structural feature
   (continuous spell on field × pendulum scaled) OR delete entirely.
3. **Interruption tag coverage** — for each meta archetype, audit that ED
   bosses + key trap pieces are all tagged. Untagged pieces = 0 reward = solver
   doesn't pursue them.
4. **Weight sanity** — current 15-type weights (omniNegate=10, typedNegate=5,
   etc.). Verify weights match relative TURN-OF-INTERRUPTION value. Possible
   miscalibration creates exploitable axes.

Output: a **purified scorer** that's safe to use as ES fitness without scaffolding.

### Phase 2 — Phase B (graph-ml-v2) on purified scorer (~1 week)
- MLP ranker (50-200 dims) on deck-agnostic state features (zone counts,
  mechanical OCG types, structural F1/F2/F3 bitmasks).
- ES fitness = pure `interruptionScore` (NO `matched²`, NO `goalMatchPoints`).
- Multi-fixture training (5+ fixtures averaged) for cross-fixture
  generalization.
- Expected lift: depends entirely on scorer quality + MLP capacity. No
  pre-estimate without scorer audit.

### Phase 3 — Auto-discovery of canonical lines (~3-5 days)
- For each fixture, extract the best ES individual's trajectory.
- Convert to human-readable: "step N : activated cardId X (= type/role tag)
  targeting cardId Y".
- These trajectories become **auto-generated documentation** — the canonical
  line for that deck, *discovered by the solver*.
- Human validates a posteriori: "yes, that matches my intuition" or "no,
  piece Z is missing because the scorer undervalues it" (= Phase 1 feedback
  loop).

### Phase 4 — Scaffolding removal (~1-2 days)
- Delete `archetype-expertise/*.json` (5 files, including the just-removed `ddd.json`).
- Delete `preferredIntermediates` from all fixtures (2 currently).
- Remove `D/D hardcode` from scorer (Phase 1 deliverable, applied here).
- Phase A becomes optional debug-only flag (off by default for "real" eval).
- expectedBoard becomes optional, used for matched metric & validation only.

## Decision criteria for Phase B

Phase B is "successful" when **at honest config (no scaffolding)**, the new
MLP ranker + retrained weights deliver:
- **cum matched ≥ 18-20/69** (+3-5 over honest baseline 15)
- **cum score ≥ 220+** (+50 over baseline 174)
- **0 regressions on individual fixtures** (no fixture drops below its honest baseline)

Below those thresholds, Phase B is marginal and we should reconsider
(Phase 1 scorer issues likely the bottleneck, not ranker mechanism).

## Files

- `eval-phase0-b.json` — config (b) expertise OFF + Phase A ON
- `eval-phase0-c.json` — config (c) honest baseline
- (a) is `eval-nb400-phase-a-tuned.json` from prior work

## Next-action recommendation

Phase 1 (scorer audit). Without a clean scorer, Phase B's optimization target
is ambiguous and the +X lift could come from gaming the scorer rather than
from real combo discovery. Ship Phase 1 first.
