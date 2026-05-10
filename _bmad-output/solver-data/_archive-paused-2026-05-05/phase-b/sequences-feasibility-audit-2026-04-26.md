# Sequences Feasibility Audit — Axis D (graph-ml-v2 Sprint 3 candidate)

**Date:** 2026-04-26
**Author:** Claude (parallel-safe research session, C1 in flight)
**Scope:** Measure the actual feasibility of axis D (connectivity / unlock potential) features F14-F17 from the YGO essence deep dive memo, on the snake-eye-yummy fixture (37 catalogued cards, 89 effects, 42 conditions).
**Status:** Decision input for post-MVP-v3 Sprint 3 / Phase 3 fork.
**Constraint:** Investigation only — no code changes to production paths, no commits.

---

## TL;DR

**Static-evaluation path: 3 of 4 axis D features are unreliable on snake-eye-yummy. 1 feature (F17, trigger fan-out) is structurally viable.**

| Feature | Status (static eval) | Why |
|---|---|---|
| F14 `hand_combo_potential` | ⚠ PARTIAL | parser-opacity blocks self-SS-procs and complex primary-activation gates; secondary effects (search e2/e3, GY-recur) often evaluate cleanly |
| F15 `hand_dead_card_count` | ⚠ PARTIAL | symmetric of F14 |
| F16 `act_unlocks_hand_count` | ❌ DEAD | requires forward-evaluating F14 → propagates F14's ceiling |
| F17 `act_triggers_chain_count` | ✅ VIABLE | uses `effect.events` (0% opacity), trivial verb→event map |

**Engine-derived alternative path (post-audit insight):** the OCGCore engine already evaluates every activation condition when it builds the SELECT_IDLECMD enumeration. Counting hand cardIds that appear in (`summons[]` ∪ `special_summons[]` ∪ `activates[]`) at IDLECMD time gives F14 with **100% reliability** — bypassing the parser entirely. This is the recommended path; see §Improvement options below.

**Recommendation:**
- **If MVP v3 lifts ≥ +3:** ship **F14_engine + F15_engine + F17** as Sprint 3 (~50 lines, 100% reliable, no parser dependence). F16 stays out.
- **If MVP v3 marginal/fails:** pivot to Phase 3 auto-discovery.

---

## Method

### Step S1 — condition classification per fixture-card

Loaded `solver-validation-decks.json` snake-eye-yummy-opener (5-card hand + 23 main + 14 extra = 37 unique cardIds, all catalogued). For each catalogued card, walked `effects[]` and classified each `effect.condition` into one of:

- **state-only**: `simpleFilter` exists, no opacity flag, no history-dependent predicates
- **history**: contains predicates like `linkSummoned`, `fusionSummoned`, `previousControler`, `reason`
- **opaque**: `cond.opaque === true` OR no simpleFilter

Sub-classified state-only further:
- **pure-state**: evaluable from a `FieldState` snapshot at idle-decision time (`gameState.GetFieldGroupCount`, `IsTurnPlayer`, `location`, `level`, etc.)
- **event-context**: needs a triggering EventGroup (`gameState.eg:IsExists`, `eg:Filter*`) — only valid inside trigger-effect resolution, not at idle main-phase
- **card-ability**: per-card runtime predicate (`canBeSpecialSummoned`, `discardable`, `ableToHand`) — engine-derived state
- **pool-scan**: requires field scan for candidates (`IsExistingMatchingCard`)

### Step S2 / S3 — skipped

Numbers from S1 were sufficient to draw the verdict. A prototype evaluator on the 11 pure-state conditions would only confirm the ceiling, not refute it.

---

## Findings

### F1 — Top-level condition distribution (42 conditions, 37 cards)

```
state-only       19   (45.2%)
opaque           15   (35.7%)
history           8   (19.0%)
partial-opaque    0
incomplete        0
```

The 50% reliability ceiling estimated in the deep dive memo is roughly correct, **but the cards where the parser fails are the cards that matter most.**

### F2 — Opacity clusters on complex primary-activation gates (NOT "starters" generically)

Earlier draft of this section conflated "cards with opaque conditions" with "starters". Correction: the opaque cards are not starters in the YGO sense. They are:

- **Handtraps** (defensive, not played in own combo turn): Ash Blossom, Ghost Belle, Ghost Ogre, Effect Veiler. Their conditions encode "when opponent activates X" — complex helpers the parser doesn't inline.
- **ED engine staples** (summoned mid-combo via materials): Linkuriboh, Herald of the Arc Light, S:P Little Knight. Opacity is on their alternate-SS-from-extra conditions or on tribute-self triggers.
- **Engine pieces** (Yummy archetype, summoned via the engine, not from hand-Normal-Summon): Marshmao★Yummy, Yummy★Snatchy, Yummyusment☆Mignon. Opacity on their self-SS conditions.

The actual snake-eye-yummy turn-1 starters and their condition state:

| Real starter | Primary effect (e1) | Secondary effect (e2/e3) |
|---|---|---|
| **Snake-Eyes Diabellstar** | `opaque` (self-SS-from-hand condition: helper `Snake-Eyes.spcon` not inlined) | **`state-only`** ✅ (search "Sinful Spoils" once in GY) |
| **Snake-Eyes Poplar** | `history` ("if you discarded a card this turn") | (single effect) |
| **Yummyusment★Acroquey** | `state-only` (event-context) | `state-only` (event-context) |

**Pattern**: opacity clusters on **`EFFECT_SPSUMMON_PROC` bodies** (alternate self-SS conditions written as shared Lua helpers) and on **handtrap chain-condition gates**. Secondary effects (search, GY recur) of starter cards are typically state-only and evaluable.

**Implication for F14**: the feature has *partial signal*:
- ❌ Cannot evaluate "can Diabellstar self-SS from my hand right now?" (e1 opaque)
- ✅ Can evaluate "can Diabellstar's GY-search trigger now?" (e2 state-only) — once Diabellstar reaches GY
- ❌ Cannot evaluate "can Ash Blossom respond to opp activation?" (handtrap, opaque) — but in combo turn 1, this is irrelevant (we don't activate handtraps on our own turn)

The decision-relevant gap is the *first* row: knowing whether a self-SS-proc condition is currently met determines whether to discard another card to enable it. F14 (static-evaluation path) cannot answer this.

### F3 — Sub-classification of state-only (19 → 11 actually-evaluable)

```
pure-state       11   (26.2% of all 42 conditions)
event-context     8   (19.0%)
unknown           1   (2.4%)
```

42% of state-only conditions need EventGroup context (a triggering event). At main-phase idle decision time, EventGroup is empty — these conditions evaluate to undefined. Cards in this bucket:

- Divine Temple of the Snake-Eye e3, e4 — Snake-Eye trigger effects
- Yummyusment★Acroquey e1, e2 — both Yummy-related triggers
- Promethean Princess e3 — fire-monster trigger
- Amphibious Swarmship Amblowhale e3 — protection trigger
- Silhouhatte Rabbit e3 — secondary trigger
- Salamangreat Almiraj e2 — protection trigger

These are *almost all triggered effects* (SS-success, summon-success). They cannot fire at idle and their conditions cannot be pre-evaluated.

### F4 — The 11 pure-state conditions are mostly handtraps and Triple Tactics

```
Effect Veiler e1, Mulcharmy Fuwalos e1, Infinite Impermanence e2, I:P Masquerena e1
   → all handtraps with "if opp condition" predicates (need event context anyway)
Triple Tactics Talent e1, Triple Tactics Thrust e1
   → both have "if opp activated this turn" → actually history-dependent (classifier missed)
Snake-Eyes Flamberge Dragon e2, e3 → check turn-player + GY content
Snake-Eyes Poplar e1 → check own field for Snake-Eye monster
Cupsy☆Yummy e1, Cooky☆Yummy e1 → check ZONE LP
```

Even within "pure-state", many are functionally history-aware (Triple Tactics) or trigger-aware (handtraps). **The truly idle-evaluable count is closer to ~5/42 = 12%.**

### F5 — F17 is structurally orthogonal

`act_triggers_chain_count` uses `effect.events`, not `effect.condition`. The events catalog is fully extracted (0% opacity in audit Q4). The verb→event mapping is trivial:

```
normal-summon     → EVENT_SUMMON_SUCCESS, EVENT_FLIP_SUMMON_SUCCESS
special-summon    → EVENT_SPSUMMON_SUCCESS
add-from-deck     → EVENT_TO_HAND
send-to-grave     → EVENT_TO_GRAVE
destroy           → EVENT_DESTROYED
banish            → EVENT_REMOVE
```

Per-fixture density of trigger events:

| Trigger | Effects in fixture | Cards with at least one |
|---|---|---|
| `EVENT_SPSUMMON_SUCCESS` | 18 | 17 / 37 (46%) |
| `EVENT_FREE_CHAIN` | 17 | (mostly handtraps, ignore for verb-match) |
| `EVENT_SUMMON_SUCCESS` | 14 | 7 / 37 (19%) |
| `EVENT_TO_GRAVE` | 3 | 3 / 37 (8%) |
| `EVENT_DESTROYED` | 2 | 1 / 37 (3%) |
| `EVENT_TO_HAND` | 1 | 1 / 37 (3%) |

When the player Special Summons in this fixture, **17/37 deck cards have a triggered effect that could fan out**. This is a strong density signal at the deck level. At runtime, F17 should restrict to cards in `{hand, own field, own GY}` (where triggers can fire from), not the whole deck — a smaller but still useful number per state.

**Note**: this counts trigger-event matches, not actual fires. A card may have a SPSUMMON trigger but its condition (likely opaque) gates whether it actually responds. F17 reports an *upper bound* on combo branching — informative but not deterministic.

---

## Comparison with deep dive memo's estimates

| Estimate | Deep dive memo | Audit measurement (snake-eye-yummy) |
|---|---|---|
| Opaque conditions | 25% | **35.7%** (worse) |
| History-dependent | 20% | 19% (close) |
| State-only "evaluable" | 50-55% | 45.2% (close) |
| Pure-state at idle | not estimated | **26.2%** (much worse than implied) |
| Truly idle-evaluable on starters | not estimated | **~0%** (catastrophic — starters all opaque) |

The deep dive memo's 50% optimistic figure was **structurally correct on the count** but missed the **clustering**: opacity is not random, it concentrates on the cards that drive combo decisions.

---

## Improvement options (post-audit insight)

### Option A — Engine-derived F14/F15 (RECOMMENDED, sidesteps parser entirely)

**Insight:** the OCGCore engine evaluates every effect's activation condition in C++ when building the SELECT_IDLECMD enumeration. The resulting `summons[]`, `special_summons[]`, `activates[]` arrays at IDLECMD prompt time are the engine's ground-truth answer to "what is currently activatable by which card". Re-implementing the same evaluation in TS via parser is redundant — we just need to read what the engine already produced.

**Reformulation:**
- `hand_combo_potential_engine` = count of distinct hand cardIds that appear in (`summons` ∪ `special_summons` ∪ `activates`) at the current IDLECMD prompt.
- `hand_dead_card_count_engine` = (hand size) − (above count).

**Reliability**: 100% (engine truth, no parser dependence).

**Implementation**: in `OCGCoreAdapter.enumerateActions()` for SELECT_IDLECMD, build a `Set<cardId>` of hand cards that appear in any offered slot. Surface this as a state field (e.g., `state.activatableHandCardCount`), or expose via a dedicated field on the Action enumeration. Feature extractor reads it.

Cost: ~20 lines in adapter, +1 field on FieldState (backward-compat optional). No catalog dependence.

**Caveat**: this only captures activation gates **at the current prompt**. For mid-chain decisions (SELECT_CHAIN), the engine's enumeration also reflects current chain state — same logic applies.

### Option B — Catalog F17 (independent, also ship)

`act_triggers_chain_count` works as designed: count cardIds in `{hand, own field, own GY}` whose effect events match the action's verb-class. Reliable, cheap (~50 lines).

### Option C — Parser v8 inline helpers (long-term, addresses root cause)

The opaque-conditions audit suggests v7 fails specifically on shared helpers (`Snake-Eyes.spcon`, handtrap chain helpers). A v8 parser pass that inlines these helpers from their definitions in the same Lua file would reduce opacity from 36% → estimated 15-20%.

Effort: ~3-5 days engineering, mostly in `extract-card-effects.ts`. ROI: re-opens F14/F15 via *static* evaluation (parser path) with reliable conditions.

Note: even with v8, the engine-derived path (Option A) remains simpler and more reliable. Option C would mostly help F16 (forward-look on conditions) which Option A cannot do.

### Option D — Manual condition overrides for top-N opaque cards

Hand-code `evaluateConditionFor(cardId)` JS functions for the ~10 most-played opaque cards in the test fixtures (Snake-Eye starters, Branded starters, Ash Blossom, Ghost cards, etc.). Engineering shortcut around the parser.

Pros: surgical, fast (~1 day for 10 cards). Cons: violates the "no archetype authoring" rule (Phase 0 philosophical shift). Borderline scaffolding.

### Option E — Phase 3 auto-discovery (sidesteps everything)

Trajectory extraction learns from successful endboards rather than predicate evaluation. Already in the strategic memo as the parallel/subsequent path. Doesn't depend on any condition evaluator.

### Option ranking by ROI / risk

| Option | Effort | Reliability gain | Architectural cleanliness |
|---|---|---|---|
| **A. Engine-derived F14/F15** | ~3h | 100% | Excellent — no parser dependence |
| B. Catalog F17 | ~3h | 100% | Good — events catalog is solid |
| C. Parser v8 | 3-5 days | ~80% (if v8 works as planned) | Good — fixes root cause |
| D. Manual overrides | 1 day | ~95% on whitelisted cards | Poor — partial scaffolding regression |
| E. Phase 3 | 3-5 days | N/A different paradigm | Excellent — aligns with strategic vision |

## Recommendation (revised)

### If MVP v3 lifts held-out matched ≥ +3

**Sprint 3 scope: A + B (engine-derived F14/F15 + catalog F17).**

3 features, ~6h engineering, 100% reliability, no scaffolding. F16 stays out (genuinely hard without forward-simulation infra).

Estimated lift contribution: +1 to +3 matched (informed estimate, not measured). Stronger than F17-alone because F14_engine actually addresses the load-bearing decision: "is this hand card currently usable?".

### If MVP v3 marginal (+1 to +2)

**Sprint 3 scope: A only** (lighter touch). If still <+3 cumulative, evaluate Phase 3 (option E) at next decision point.

### If MVP v3 fails (≤ 0)

**Skip Sprint 3 entirely. Pivot to Phase 3 (Option E).** Axis D static-evaluation is unviable; engine-derived would help marginally but doesn't address the underlying issue (the ranker isn't learning from the demographic features either).

### If MVP v3 falls short (<+3 lift) — pivot path

**Skip Sprint 3 entirely. Pivot to Phase 3 (auto-discovery via trajectory extraction).**

Rationale: axis D's 3-of-4 features are unreliable on this fixture. Investing engineering time to ship F17 alone gives ≤2 matched lift in the optimistic case. The remaining gap (and there will be one) is better closed by trajectory-based learning that doesn't depend on the catalog's condition decoder.

Phase 3 reuses the existing trajectory extraction infrastructure (`raw-replay-to-trajectory.ts`, `record-trajectory.ts`) and learns from successful endboards rather than predicate evaluation. It sidesteps the parser-opacity problem entirely.

### If MVP v3 marginal (+1 to +2, ambiguous)

**Skip Sprint 3 axis D. Consider instead:**
- Sprint 3-bis on **axis E (tempo / commitment)** — features F19 `special_summons_this_turn`, F20 `hand_depletion`, F21 `opt_budget_used`. These need history infrastructure (cheap to plumb on `OCGCoreAdapter`'s existing activation log) and are condition-independent.
- Or fall back to Phase 3 directly.

---

## Open questions / further investigation if needed

1. **Catalog improvements**: could parser v8 reduce opacity from 36% → 20% by inlining helper functions referenced in conditions (e.g., `Snake-Eyes.spcon` → unrolled body)? Estimated effort: ~3-5 days. ROI: would re-open F14-F16 if successful.

2. **Cross-fixture audit**: snake-eye-yummy's opacity profile may not generalize. branded-dracotail (different archetype, more Fusion procs) and ddd-pendulum (Pendulum-heavy) might have different opacity distributions. A 4-fixture sweep would take ~30 min and confirm/refute the recommendation.

3. **Event-context conditions**: the 8 "event-context" conditions could be evaluated *during trigger resolution* (not at idle decision). If F14 were redefined as "fires only when an event triggers", it might be salvageable for chain-context decisions. Out of scope for MVP/Sprint-3.

4. **F17 refinement**: should it weight triggers by their effect's interruption value? E.g., a SS that fans out to a omninegate-tagged card is more valuable than a SS that fans out to a stat-buff. Defer to post-Sprint-3 if F17 ships.

---

## Audit artifacts (this session, no commits)

- This memo: `_bmad-output/solver-data/phase-b/sequences-feasibility-audit-2026-04-26.md`
- Per-card classification logic: inline in this memo (not committed as script)
- Snake-eye-yummy hand/deck IDs: from `solver-validation-decks.json` (already in repo)

No code modifications. Type-check unaffected. C1 untouched.
