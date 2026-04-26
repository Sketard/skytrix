# YGO Essence Feature Deep Dive — Phase B graph-ml-v2

**Date:** 2026-04-26
**Author:** Claude (deep-dive session)
**Status:** Draft for human review (Axel)
**Scope:** Identify universal, deck-agnostic mechanical features that capture the *grammar* of Yu-Gi-Oh combos, beyond the current 95 "demographic" features. Output a prioritized taxonomy of ~30 candidate features for Phase B graph-ml-v2 ranker enrichment.

---

## 1. Context & motivation

### 1.1 The current 95-feature audit

The Phase B feature spec at `state-feature-extractor.ts` describes the board with **demographic counts**:

- "How many monsters on the field?"
- "Is the source card a Link / Xyz / Pendulum?"
- "Does the card have an interruption tag?"

These features are **structural and observational**. They answer *"who is on the field?"* but not *"what is happening?"* or *"what becomes possible next?"*

The risk: a ranker built on these features can only learn correlations between board *positions* and combo *success*. It cannot directly model the verb-and-condition grammar that actually drives combo construction. This caps the ceiling regardless of training compute.

### 1.2 The strategic constraint (Phase 0 / philosophical shift)

The roadmap (memory: `solver-ml-strategic-direction`) explicitly rejects "scaffolding" — hardcoded archetype knowledge, named card lists, manual combo authoring. The honest baseline is **20/69 matched without expertise**, and the long-term vision is `(deck, hand) → endboard` with no human authoring.

Therefore: the deep dive must produce features that are **mechanically derivable from existing infrastructure** (card-effects-catalog, ocgcore Lua, interruption tags, FieldState) and **deck-agnostic by construction**. No "is this a Snake-Eye starter" features. Universal verbs and conditions only.

### 1.3 What this memo delivers

- §2 — the 7 axes of YGO combo essence (universal, not archetype-specific)
- §3 — audit of the 95 features against the 7 axes (where signal is rich, where it's missing)
- §4 — candidate feature taxonomy (~30 features, organized by axis, each with mechanical source + hypothesis + cost + validation)
- §5 — validation methodology (coverage, variance, leakage, transfer)
- §6 — implementation roadmap (phasing, compute estimate, risk register)

---

## 2. The 7 axes of YGO combo essence

A combo turn in modern Yu-Gi-Oh is a sequence of **state transitions**, each subject to **conditions** and producing **outputs** that **unlock** further transitions, until a **terminal posture** is reached. Strip away the archetype flavor and you get seven universal axes:

### Axis A — Resource verbs (what does an action *do*?)

Every meaningful action mutates the resource graph. The verb vocabulary is small and universal:

- **Generators**: DRAW (deck→hand random), SEARCH (deck→hand targeted), MILL (deck→GY), SUMMON (any→field, with sub-types: Normal, Special, Tribute, Ritual, Fusion, Synchro, Xyz, Link, Pendulum), RECUR (GY/banished→hand/field), BOUNCE (field/GY→hand)
- **Consumers**: DISCARD (hand→GY), TRIBUTE/RELEASE (field→GY), DESTROY (field→GY), BANISH (any→banished), DETACH (overlay→GY)
- **Modifiers**: FLIP (facedown↔faceup), SET (hand→facedown S/T or M), POSITION (atk↔def), ATKCHANGE, NEGATE, COUNTER (place/remove)

The OCG card-effects-catalog already extracts these from Lua: I observed 20+ distinct `kind` strings in the v7 catalog (`special-summon`, `send-to-hand`, `send-to-grave`, `send-to-deck`, `tribute`, `destroy`, `banish`, `spell-trap-set`, `detach-material`, `fusion-summon-operation`, `move-to-field`, etc.). **The vocabulary is already extracted; it just isn't surfaced as features.**

### Axis B — Cost structure (what does an action *cost*?)

Every effect has a cost (possibly zero). Costs are universal:
- Discard from hand (1+ cards)
- Tribute monsters from field
- Banish self / banish-from-zone / banish-from-GY
- Pay LP (fixed amount or fraction)
- Destroy self
- Detach Xyz materials
- Decrement counter

Costs are extracted in the catalog under `effect.cost` with action verbs inside (e.g., `Cost.SelfDiscard` resolves to a `discard` action). **Available, not surfaced.**

### Axis C — Output magnitude & quality

Beyond *what verb*, *how much*?
- Cards moved (1, 2, 3+)
- Destination quality (field > hand > GY > deck)
- Output type matches a needed material (level/attribute/race for a downstream summon)

This is partially in the catalog (the `actions[]` list per effect), partially derivable from filters (`simpleFilter.predicates` on race/attribute/level).

### Axis D — Connectivity / unlock potential (the *graph*)

This is the key axis the current features completely miss. A combo turn is a **traversal**: each action makes future actions legal. Three concrete signals:

- **Hand unlocks**: how many of my hand cards have their effect *condition* now met after this action? (Example: Diabellstar has the condition "if a card was discarded this turn" — discarding ANY card creates the unlock.)
- **ED unlocks**: how many of my Extra Deck monsters now have valid materials available? (Example: posting a Lv4 monster unlocks every Rank 4 Xyz that lists "2 Lv4 monsters".)
- **Trigger fan-out**: how many "if you Special Summon a monster" / "when you add a card to hand" effects exist in my hand or on field that could chain off this action?

These are computable from catalog `condition` filters intersected against current FieldState.

### Axis E — Tempo / commitment

Where in the combo are we?
- Cards committed (hand depleted from 5 → 1 = late combo)
- Field value accumulated this turn (from 0 → 3 monsters → ED summon imminent)
- OPT budget consumed (7 named effects already used = late combo, fewer pivots available)
- Special summons this turn (some decks gate at SS#2, SS#3 as power-spike thresholds)

The recently-plumbed `normalSummonUsed` is the first feature on this axis. The rest is computable from FieldState deltas (need turn-start snapshot) or per-handle activation log (already maintained for OPT).

### Axis F — Constraint / friction state

What blocks future plays?
- EMZ contested (opp Link points to my zone)
- Maxx C resolved (drawing on every SS)
- Floodgate active (e.g., Vanity's Ruler = no SS)
- Hand cards with unmet conditions (dead cards)
- Phase-locked cards (quickplay just set this turn → can't activate)

Currently zero features on this axis. The opp-zone snapshot (just plumbed in `b4142292`) gives the raw data; we need to interpret it.

### Axis G — Interruption posture (terminal value)

What's the end-state worth? Already partially captured by `interruption_score_proxy` (sum of weighted tags). Missing nuances:
- Diversity (1 omni + 1 floodgate > 2 omni)
- Redundancy (can lose 1 piece without collapse)
- Trigger timing distribution (chain-block vs main-phase floodgate vs trap-speed)

These are richer reads on the same `interruption-tags.json` data.

---

## 3. Current 95-feature audit against the 7 axes

| Axis | Current features | Coverage | Notes |
|------|------------------|----------|-------|
| **A. Resource verbs** | 0 | ❌ none | Catalog has 20+ verb kinds; not exposed |
| **B. Cost structure** | 0 | ❌ none | Catalog has cost actions; not exposed |
| **C. Output magnitude** | 0 | ❌ none | Catalog has actions[]; not exposed |
| **D. Connectivity** | 0 | ❌ none | Discovery edges exist; not used as features |
| **E. Tempo / commitment** | 1 (`turn_norm`) + 1 deferred (`normal_summon_used`) | ⚠ thin | Per-handle activation log unused |
| **F. Constraint / friction** | 4 (opp-board summary) | ⚠ raw counts only | No interpretation; new in Day 2 |
| **G. Interruption posture** | 7 (proxy + counts) | ✅ adequate | Could be richer (diversity, redundancy) |
| Demographics (type/attribute/level/zone) | 60+ | ✅ saturated | Diminishing returns from more |

**Verdict**: of the 95 features, ~80 are demographic, ~15 are weak signal on axes E-G, and **0 are on axes A-D**. The biggest signal gain is on the missing axes — particularly **A (verbs) and D (connectivity)** — because they describe *combo dynamics*, not just *board snapshots*.

---

## 4. Candidate feature taxonomy

Below: ~30 candidate features grouped by axis, each with definition, mechanical source, hypothesis, implementation cost, and validation criterion. Numbered FN# for traceability in future commits.

### 4.A — Action verb signature (6 features, axis A)

For each catalogued verb, a 0/1 flag on whether the action's source-card effect contains it.

| ID | Name | Definition | Source | Hypothesis |
|----|------|------------|--------|------------|
| F01 | `act_verb_search` | Source-card effect contains `send-to-hand` action with deck-range filter | Catalog `actions[].kind == 'send-to-hand'` + range LOCATION_DECK | Search actions pull combo pieces; high signal for early-combo decisions |
| F02 | `act_verb_special_summon` | Source-card effect contains `special-summon` action | Catalog `actions[].kind == 'special-summon'` | SS is the primary combo verb; almost always a combo step |
| F03 | `act_verb_mill` | Source-card effect contains `send-to-grave` with deck-range filter (own deck) | Catalog `actions[].kind == 'send-to-grave'` + range LOCATION_DECK | Fills GY for recur-engines |
| F04 | `act_verb_recur` | Source-card effect contains `special-summon` or `send-to-hand` with GY-range filter | Catalog action range LOCATION_GRAVE | GY recursion is a major engine class (Snake-Eye, Branded, etc.) |
| F05 | `act_verb_destroy` / `_banish` (2 sub-features) | Effect contains `destroy` or `banish` action | Catalog `actions[].kind` | Removal/disruption tagging |
| F06 | `act_verb_extra_summon` | Effect contains `fusion-summon-operation` or special-summon w/ EXTRA range | Catalog | ED-summon pivots are payoff steps |

**Implementation**: pre-compute per-card verb set at boot (`Map<cardId, Set<Verb>>`) by walking the catalog. Per-action lookup is O(1).

**Validation**: ≥80% non-zero on `SELECT_IDLECMD`/`SELECT_EFFECTYN` actions; ≈0% on pass actions.

### 4.B — Action cost structure (4 features, axis B)

| ID | Name | Definition | Source | Hypothesis |
|----|------|------------|--------|------------|
| F07 | `act_cost_discard` | Effect's `cost` function contains `discard` action | Catalog `effect.cost.actions[].kind == 'discard'` | Discard cost = -1 hand; ranker should value the trade |
| F08 | `act_cost_tribute` | Effect's `cost` contains `tribute` / `release` action | Catalog | Tribute cost = -1 field; high cost, usually high payoff |
| F09 | `act_cost_banish_self` | Effect's `cost` includes self-banish | Catalog action target = "c" + kind = banish | Common engine signal (Snake-Eye, Tearlaments, Kashtira) |
| F10 | `act_no_cost` | All cost-action lists empty | Catalog | Free activations are higher priority by default |

**Implementation**: same pre-compute as F01-F06 but on `effect.cost` rather than `effect.operation`.

### 4.C — Action output magnitude (3 features, axis C)

| ID | Name | Definition | Source | Hypothesis |
|----|------|------------|--------|------------|
| F11 | `act_output_count_norm` | Estimated number of cards moved by action / 5 | Catalog actions[] count + filter "min" hint | Larger output = larger combo step |
| F12 | `act_output_to_field` | Action lands ≥1 card on field (M/S/EMZ) | Catalog action target range LOCATION_MZONE/SZONE | Field-landing output is what builds endboard |
| F13 | `act_creates_material` | Output's expected level/race/attribute matches an unmet ED-summon requirement in this state | Catalog filter intersection with extra-deck catalog | High signal: this action enables an ED summon next turn |

**Implementation**: F11-F12 trivial. F13 requires a per-fixture pre-pass building "ED summons reachable if I add monster of (level X, race Y)" lookup table. ~50 lines.

### 4.D — Connectivity / unlock potential (4 features, axis D)

This axis is the most expensive but potentially the highest signal. Approximation strategy: pre-compute per-card "trigger-condition signatures" at boot, intersect against current state in O(hand_size) per rank() call.

| ID | Name | Definition | Source | Hypothesis |
|----|------|------------|--------|------------|
| F14 | `hand_combo_potential` | Count of hand cards whose effect.condition currently evaluates true (approximated via simpleFilter check) | Catalog `effect.condition.simpleFilter` against state | High = combo-capable hand; low = dead hand |
| F15 | `hand_dead_card_count` | Count of hand cards with NO playable effect right now | Same; complement of F14 | Symmetry of F14 — ranker may weight differently |
| F16 | `act_unlocks_hand_count` | After applying this action's predicted output, how many *additional* hand cards become activatable? | Forward-look on simpleFilter | Direct signal of "this is a starter, others extend off it" |
| F17 | `act_triggers_chain_count` | Count of cards in own field/hand with triggered effect matching this action's verb (e.g., "if you SS a monster") | Catalog `effect.events` cross-ref | Trigger fan-out signal |

**Implementation**: F14/F15 read-only over hand × catalog. F16 requires applying a *symbolic* version of the action's output to FieldState (move predicted cards), re-evaluating F14, taking delta. Acceptable cost since rank() is called O(actions per node), not O(simulation steps). F17 needs an inverse index: `Map<Verb, cardId[]>` of "cards that trigger on verb V"; pre-computed once.

**Risk**: simpleFilter approximations are imperfect. Conditions like "if a card was discarded this turn" require **history** (turn log), not just state. We start with state-only conditions and iterate.

### 4.E — Tempo / commitment (4 features, axis E)

| ID | Name | Definition | Source | Hypothesis |
|----|------|------------|--------|------------|
| F18 | `normal_summon_used` | (already planned, currently zeroed) | `state.normalSummonUsed[0]` | Ablation already in design doc |
| F19 | `special_summons_this_turn_norm` | Count of own SS this turn / 8 | Per-handle activation log | Tempo gauge; combo decks pace at SS#2-#5 |
| F20 | `hand_depletion` | (initial_hand_size - current_hand_size) / initial_hand_size | FieldState delta from turn start | Late-combo signal; may favor closer plays |
| F21 | `opt_budget_used` | Number of distinct named effects burned this turn / 8 | Per-handle activation log (already kept for OPT) | More OPT used = fewer pivots remain |

**Implementation**: F18 already plumbed (need to wire). F19/F21 need per-turn counters in the activation log (existing infra). F20 needs `initial_hand_size` snapshot at NEW_TURN.

### 4.F — Constraint / friction (3 features, axis F)

| ID | Name | Definition | Source | Hypothesis |
|----|------|------------|--------|------------|
| F22 | `emz_contested` | 1 if opp has any monster with link arrow pointing to a self EMZ | `state.oppZones` × `link-arrows.json` | EMZ block kills many ED lines |
| F23 | `floodgate_active_count` | Count of opp-board cards tagged `floodgate` whose `activeZones` matches their current zone | `state.oppZones` × `interruption-tags.json` | Skill Drain / Mistake / Vanity = combo dead |
| F24 | `opp_handtrap_threats_norm` | Estimated threat from opp hand (proxy via `opp_overlay_units` + `monstersOpp`) — low data, may be noisy | `state.oppZones` summary | Weak signal on turn 1; may not survive ablation |

**Implementation**: F22 needs link-arrow lookup (`link-arrows.json` already extracted, see memory). F23 reuses interruption-tags. F24 is a placeholder; may be dropped.

### 4.G — Interruption enrichment (3 features, axis G)

| ID | Name | Definition | Source | Hypothesis |
|----|------|------------|--------|------------|
| F25 | `interruption_diversity_norm` | Number of distinct interruption types on field / 8 | Currently `unique_interruption_types_field`, but as a proxy of *kind* not just *count* | Diverse interruption survives single answers; pure signal |
| F26 | `interruption_chain_speed_distribution` | Fraction of interruption pieces with `trigger == 'quick'` vs `'chain'` | `interruption-tags.json` per-effect `trigger` field | Quick > chain > trigger > main for omninegate-type pressure |
| F27 | `interruption_redundancy` | Min count of any single interruption type ≥ 2 → 1, else 0 | `interruption-tags.json` | Redundant pieces survive removal |

### 4.H — State enrichment beyond current set (2-3 features, cross-cut)

Small additions that don't fit a single axis but show up repeatedly:

| ID | Name | Definition | Source | Hypothesis |
|----|------|------------|--------|------------|
| F28 | `extra_deck_summon_threshold_distance` | Min(materials_needed - materials_available) over all reachable ED summons | Catalog × FieldState | "How close am I to my next big play?" |
| F29 | `gy_engine_pieces_count` | Count of GY cards with self-recur condition met | Catalog GY-range conditions on `effect.condition` | Recursion potential; key for Branded/Snake-Eye/Tearlaments |
| F30 | `chain_active_link_count_norm` | Currently-resolving chain links / 5 | OCGCore chain state (already exposed in adapter) | Mid-chain decisions differ from main-phase decisions |

---

## 5. Validation methodology

Adding 30 features to a 95-feature spec is a non-trivial change. Validation gates before training:

### 5.1 Pre-training (before any CMA-ES run)

1. **Coverage check** — for each new feature, dump values over 10 fixtures × full DFS run. Compute (count_nonzero / total_actions). Drop features below 5% coverage or above 95% (constants).
2. **Variance check** — std/range per feature across all sampled actions. Drop near-zero variance.
3. **Pairwise correlation** — Spearman between new features and `act_card_isMonster`, `interruption_score_proxy`, etc. Features highly correlated (|ρ| > 0.9) with existing → redundant.
4. **Leakage audit** — explicitly list features that read scorer-related data (interruption tags, weights). These are acceptable signals for `score`-fitness but must not be the *only* differentiator from honest baseline.

### 5.2 Mid-training (after 1-3 short runs)

1. **Single-feature ablation on top suspected drivers** — train with feature dropped, measure delta on held-out fixture. Cheap (1 short run per feature) and identifies dead weight.
2. **Convergence sanity** — fitness curve must be monotone-bruyante. σ collapse at gen 5-10 = signal-poor input.

### 5.3 Post-training (verdict gate)

1. **Cross-fixture transfer** — held-out fixture median-3-seeds matched delta. Same standard as Day 1.5.
2. **Honest-baseline distance** — run ranker with `SOLVER_DISABLE_EXPERTISE=1`. If new features only help with expertise on, they're laundering authoring through ML.
3. **Feature attribution** — if framework supports it (linear ranker only), report top-10 features by absolute weight.

### 5.4 The leakage trap (most important risk)

Features F25-F27 (interruption enrichment) and F13 (creates_material) read the same data the scorer uses. There's a real risk the ranker learns to maximize "interruption proxy" not because it understands combos but because that's the literal optimization target. Mitigation:
- **Train one model with axes A-F only** (verbs/cost/output/connectivity/tempo/friction — *no* axis G enrichment). Compare to model with all axes.
- If the no-G model matches or exceeds the all-axis model, the enrichment is leakage; drop it.

---

## 6. Implementation roadmap

### 6.1 Phasing (3 sprints)

**Sprint 1 (~2-3 days, ~6-8h compute)** — extract pre-computed lookup tables
- Build `Map<cardId, VerbSet>` from catalog
- Build `Map<cardId, CostSet>` from catalog
- Build `Map<Verb, cardId[]>` inverse index (for F17)
- Build `Map<MaterialSpec, ED_cardId[]>` for F13 / F28
- Wire `featureSpecHash` invalidation: new spec breaks loader, prevents accidental loading of pre-deep-dive weights

Deliverable: precomputed indexes loaded at ranker boot. No ranker code change yet. Sanity tests on 10 fixtures.

**Sprint 2 (~2-3 days)** — implement features F01-F21 (axes A, B, C, E)
- Extend `state-feature-extractor.ts` to STATE_DIM = 49 + new state features, ACTION_DIM = 46 + new action features
- Update `STATE_FEATURE_NAMES` / `ACTION_FEATURE_NAMES`
- Run §5.1 pre-training validation (coverage, variance, correlation)
- **Drop any feature failing gates**

Deliverable: extended feature spec, validation report.

**Sprint 3 (~3-4 days)** — implement features F22-F30 (axes D, F, G enrichment)
- F14-F17 are the most expensive; benchmark per-rank() cost
- Run pre-training validation
- Run mid-training ablations on suspected drivers
- Final spec freeze, hash recompute

Deliverable: final feature spec for Phase B graph-ml-v2 training.

### 6.2 Compute estimate

- Validation runs (§5.1, §5.2): ~10 short runs × 30 min = 5h compute
- Final Phase B training (4-fix × 60-gen × 3-seed) on enriched spec: ~20h, same as planned in verdict memo

Net: ~25-30h compute end-to-end, plus ~7-10 days engineering.

### 6.3 Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Catalog coverage gap (cards not in catalog) | High | Medium | Default verb features to 0; coverage% reported at boot; expand catalog opportunistically |
| simpleFilter approximations imperfect (F14 false positives) | Medium | Medium | Whitelist filter predicates known to be reliable; mark others as "approximate" with confidence flag |
| Compute cost of F16 (forward-look) | Medium | Low | Memoize per (state-hash, action-hash); profile before commit |
| Leakage from axis G (F25-F27) | Medium | High | A/B test with axis G dropped (§5.4) |
| Variance noise from 30 new features overfitting on 4 fixtures | High | Medium | Run §5.1 ablation aggressively; consider 6-fixture training (add stun-runick + ddd-pendulum) |
| Feature spec hash mismatch breaking existing weights | Certain | Low | Intentional; existing weights are pre-Phase-B anyway |

### 6.4 Open design questions

1. **Action vs state placement** — some features (F19, F21, F18) describe *cumulative state*; should they be state-features or action-features? Probably state, since they don't depend on the candidate action.
2. **Normalization choices** — current spec divides by fixed denominators (e.g., /7 for hand). For new features, what's the right denominator? F19 by /8 (assumed combo-deck max SS) is a guess.
3. **Hand-batch boundary** — F14/F16 read hand contents, but during chain resolution the rendered hand may lag the logical hand by one buffer flush. Use logical state? Yes (consistent with current `act_card_in_*` features).
4. **History features** — F19/F21 require history, not pure state. Wire via OCGCoreAdapter into FieldState (e.g., `state.activations: ActivationLogEntry[]`)? Decision needed before Sprint 1.

---

## 7. Recommendation summary

**The single biggest gap in current features is axis A (verbs) and axis D (connectivity).** The catalog has 20+ verb kinds extracted; surfacing them as 6-8 boolean features alone could substantially improve the ranker's ability to distinguish "discard cost" from "tribute summon" from "free draw" — which are *very* different in combo grammar but currently identical in feature space (all are "this card is a Spell/Monster of type X").

**Recommended path:**
1. Implement Sprint 1 + Sprint 2 first (axes A, B, C, E — ~21 features). Run a short Phase B training. **Compare to current baseline.** If matched cards moves significantly (≥+3 on held-out), the hypothesis is confirmed.
2. Only then implement Sprint 3 (axes D, F, G — ~9 features). The connectivity features (F14-F17) are the most expensive and most theoretically powerful, but also the most prone to approximation drift. Validate the cheaper signal first.

**What this enables strategically:** features on axis A and D give the ranker a vocabulary that maps onto **what the human thinks about when planning a combo turn** — "what does this do, what does it cost, what does it open up?" — without ever hardcoding archetype knowledge. This is the bridge between the demographic baseline and the auto-discovery vision (Phase 3 trajectory extraction): the auto-discovered trajectories will use the same vocabulary as the ranker, making policy distillation possible.

**Cost-benefit:** ~10 days engineering + ~30h compute for a feature set that, if successful, lifts matched on held-out by +5 to +10 cards (informed estimate, not measured) and crucially makes the Phase B ranker *interpretable* in YGO terms. Worth more than another optimizer-tuning round on the existing 95.

---

## Appendix A — Verb kinds observed in catalog (frequency, 114 cards)

```
declare-operation 191       (meta-verb, not used as feature)
hint              177       (meta-verb, not used as feature)
raw               132       (placeholder for unparsed inline)
setCard           109       (filter predicate, not action)
gameState          92       (filter predicate)
ableToHand         91       (predicate; supports F13)
canBeSpecialSummoned 58     (predicate)
special-summon     54       → F02
send-to-hand       53       → F01 (with deck-range filter)
send-to-grave      26       → F03 (with deck-range filter)
send-to-deck       16
destroy            24       → F05a
banish             11       → F05b
spell-trap-set     10
move-to-field      10
detach-material    11       (axis B cost in Xyz context)
fusion-summon-operation 9   → F06a
tribute            15       → F08 cost
discard           (in cost) → F07 cost
```

Distinctively absent verbs (not seen in 114-card sample but expected on broader catalog): synchro-summon, xyz-summon, link-summon, draw, mill (separate from send-to-grave), flip, attack-change, equip. These will surface when the catalog expands beyond 114 cards.

## Appendix B — Mapping to existing infrastructure

| Sprint | Reads from | Writes to |
|--------|------------|-----------|
| 1 | `_bmad-output/solver-data/card-effects-catalog/*.json`, `link-arrows.json`, card-metadata | New file: `duel-server/data/derived/verb-index.json` (precomputed) |
| 2 | verb-index.json + FieldState + Action | `state-feature-extractor.ts` (extend, bump featureSpecHash) |
| 3 | catalog conditions + interruption-tags + activation log | same |

## Appendix C — Why this is not "scaffolding"

A reasonable concern: "if you encode 'is-search', 'is-summon', 'cost-discard', etc., aren't you encoding YGO knowledge — which is exactly what Phase 0 said to remove?"

Answer: there is a categorical difference between:
- **Mechanical universals** (every YGO action is one of {search, summon, mill, ...}; this is *the protocol*, not authoring) → ✅ keep
- **Archetype-specific knowledge** ("Snake-Eye is a starter", "Branded combos through Albaz") → ❌ removed

The taxonomy here is the first kind. Every feature is computed from the **same Lua scripts every legal Yu-Gi-Oh game runs on**, and the same catalog parser would extract the same verbs from any future card released. There is no per-deck or per-archetype branch. If you swap the deck from Branded to Floowandereeze, the same feature extractor produces meaningful values without code change.

This is what the strategic memo calls "the protocol layer" — universal enough to be deck-agnostic, structured enough to give the ranker a real vocabulary to learn from.
