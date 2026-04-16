# Solver Step 1 — Structural Value Function Plan

**Author**: Claude Opus 4.6 (assisted by Axel)
**Date**: 2026-04-16
**Status**: Plan — not yet implemented
**Tier**: 3 (committed, see `project_solver_ml_strategic_direction.md`)
**Budget**: 2-3 calendar weeks, solo
**Prerequisite state**: audit Ryzeal complete (`project_solver_audit_ryzeal_2026_04_16.md`) — no enumeration bug, scorer myopia confirmed as root cause.

---

## 1. Goal & Non-Goals

### Goal
Ship a **structural value function** extension of `InterruptionScorer` that gives positive score to latent combo-enabling states, unblocking DFS Phase I bound-cut from myopically pruning multi-step tutor chains.

**Success** = Mitsurugi fixture jumps from 35/2-6 to ≥4/6 matched in a single re-run, with no regression on D/D/D (34/2-5), Branded Arth (41/2-6), Branded Mirr (32/3-6), Radiant Typhoon (33/2-3).

### Non-goals (explicitly deferred)
- Full EHS composer architecture (Direct/Latent/Risk sub-scorers + tapered weights) — research doc Phase B, 3-5 weeks. Defer to step-3-prime or step-4.
- Pattern library DSL runtime — defer; use TypeScript functions + small hand-authored JSON instead.
- LLM-assisted corpus labeling — belongs to step 3 (calibration).
- CMA-ES / Texel tuning — belongs to step 3.
- Card-zone-value (CZV) sparse table — defer; no empirical motivation from audit.
- Adversarial / handtrap risk modeling — belongs to step 3+ (requires opponent context).
- Value network / DL — step 4+.

**The scope intentionally excludes features whose motivation is theoretical rather than empirical.** Every feature shipped in step 1 is traceable to a specific audit finding.

---

## 2. Architecture Overview

### Principle: minimal refactor, Phase 2.3 V1 precedent

Existing shipped code in `interruption-scorer.ts:235-262` already demonstrates the pattern: hardcoded card IDs + `fieldState.turn === 1` gate + additive to `latentPoints` + global cap. Step 1 generalizes this pattern from deck-specific (D/D only) to deck-agnostic (via card typology).

### New surface

| Module | Purpose | File |
|---|---|---|
| `StructuralValueComputer` | Pure function, computes 4 structural features from `FieldState` + `ActivationLog` + `CardMetadataMap`. Returns `{ featureScores: {[featureName]: number}, totalStructural: number }` capped at `STRUCTURAL_VALUE_CAP`. | `duel-server/src/solver/structural-value-computer.ts` (NEW) |
| `CardMetadataMap` | Pre-computed per-deck lookup built at solver init from `CardDB`. Keys = cardIds in main+extra+hand. Value = `{ type, level, attribute, race, isRitualMonster, isRitualSpell, rtual_compat_ids?, tutorActionTag? }`. | Part of `StructuralValueComputer` module. Built lazily in `InterruptionScorer` constructor or passed in. |
| `structural-weights.json` | JSON-authored weights per feature. Seeded by inspection. Tunable later (step 3). | `duel-server/data/structural-weights.json` (NEW) |
| `structural-tutor-cards.json` | Hand-authored whitelist of known tutor cards (cardId → action description, search pool scope). Covers Saji, D/D tutors, Branded Fusion, Ecclesia, Ash, etc. ~30 entries for top-10 meta. | `duel-server/data/structural-tutor-cards.json` (NEW) |

**Total new files: 3 code + 2 data = 5.** No refactor of existing scoring code.

### Integration point

```ts
// interruption-scorer.ts:_scoreWithCardsImpl (existing method)
// ... existing weighted + fallbackPoints accumulation ...

// Existing Phase 2.3 V1 block (lines 235-262) — UNCHANGED
if (fieldState.turn === 1) {
  // D/D latent bonus
}

// NEW: structural value block — additive, gated on turn === 1
if (fieldState.turn === 1) {
  const { totalStructural, featureScores } =
    this.structuralComputer.compute(fieldState, activationLog, this.cardMetadata);
  latentPoints += totalStructural;
  // breakdown reports featureScores for diagnostic
}

const score = weighted + fallbackPoints + latentPoints;
```

Global cap `STRUCTURAL_VALUE_CAP` prevents runaway; if breached, compressed proportionally across features.

### Call site frequency

`_scoreWithCardsImpl` is called at **every DFS node** (`dfs-solver.ts:887`) + interim pass (`line 500`). Feature computation must be O(zone count) worst case — no nested loops over decks or search pools. Target latency ≤ 0.5ms per call.

---

## 3. Features (4 total)

### F1 — Ritual Unlock Co-Presence

**Motivation**: Ryzeal audit. Futsu-in-hand is worthless without ritual spell. Scorer must reward the composite state.

**Precondition**:
- `RitualMonster` exists in HAND ∪ GY ∪ MZONE
- AND `RitualSpell` compatible with that monster exists in HAND ∪ GY ∪ SZONE

"Compatible" = determined via `CardMetadataMap.rtual_compat_ids` — Reptile monsters ↔ Mitsurugi Ritual/Mirror, Fairy Level 1 ↔ Drytron rituals, etc. Pre-computed from card text parsing (one-time cost, cached).

**Score**: `W_F1 * min(distinct co-presence count, CAP_F1)` where W_F1=3, CAP_F1=2.
Max contribution: 6 points.

**Tribute fodder sub-bonus** (merged from F5): +1 extra if a same-level monster exists in HAND/GY/MZONE to cover the ritual tribute.

**Deck coverage**: Mitsurugi, Drytron, Herald, Nekroz, Megalith, Cyber Angel. Anything with `RitualMonster + RitualSpell` in its card pool.

### F2 — Tutor Chain Potency

**Motivation**: Ryzeal audit. Saji → Ritual tutor is a deterministic 1-action unlock but scorer gives it 0. Generalizes to D/D tutors, Branded Fusion, Ecclesia, Snake-Eye Ash, Runick Fountain, etc.

**Precondition**: a card from `structural-tutor-cards.json` whitelist is on field/hand AND its effect is fresh (not in `activationLog`).

**Score**: `W_F2 * sum(weight_per_tutor)` over each fresh tutor present. Weight per tutor encodes "how structurally important is this tutor": 3 for combo-starters (Saji, Branded Fusion), 2 for engine-glue (D/D tutors), 1 for utility tutors.

**Seeded whitelist** (~30 entries, v1):
- Mitsurugi: Saji (18176525)
- D/D: Magical Astromancer (20715411 Doom Queen), various in `DARK_CONTRACT_IDS`
- Branded: Branded Fusion, Branded Beast, Ecclesia
- Snake-Eye: Ash, Flamberge, Poplar
- Kashtira: Birth, Unicorn
- Runick: Fountain
- Ryzeal: Ice Ryzeal, Ryzeal Detonator

Format:
```json
{
  "18176525": { "name": "Mitsurugi Saji", "weight": 3, "archetype": "Mitsurugi", "scope": "spell" },
  ...
}
```

**CAP_F2** = 8 points (hard upper).

### F3 — Extra Deck Material Pool Accessibility

**Motivation**: Ryzeal peak field has Rank-4 Xyzs (Dugares, Bagooska) — proof that material pool signals combo progress. Scorer currently rewards these ONLY if tagged. Untagged generic Xyz = 0. Feature generalizes to Rank-N Xyz, Synchro, Link, Fusion.

**Precondition**: count of face-up monsters on MZONE whose levels/attributes/types unlock ≥1 extra-deck summon.

**Score**: `W_F3 * log2(1 + accessibleSummonCount)`. Logarithmic to prevent board spam from dominating — 1 Xyz candidate = +1, 2 candidates = +1.58, 4 candidates = +2.32.

**Accessibility check** (simplified v1):
- Same-level pair present → Rank-N Xyz available (count +1 per pair)
- ≥2 monsters → Link-2 available (count +1 if true)
- Level-sum matches Synchro tuner + non-tuner in deck → Synchro (defer, too complex for v1)

Scope: ONLY MZONE face-up monsters. Zero lookup in extra deck. Deck extras pre-computed once.

**CAP_F3** = 4 points.

### F4 — Unused Effect Budget

**Motivation**: generic. Monsters with fresh OPT effects (not yet in `activationLog`) represent future interruption / combo potential that current scorer under-values.

**Precondition**: card on field with `InterruptionTag` present in `interruption-tags.json` AND effect index 0 NOT in `activationLog[cardId]`.

**Score**: `W_F4 * sum(tag.weight * freshEffectCount)` across monsters on MZONE.

Weights re-use `interruption-weights.json` values but scaled by `W_F4 = 0.3` to avoid double-counting with the main weighted block.

**CAP_F4** = 6 points.

### Global cap

`STRUCTURAL_VALUE_CAP = 15 points`. If sum of capped features exceeds 15, scale down proportionally. Prevents interaction blow-up.

### Weight seed (initial, inspection-based)

```json
{
  "W_F1": 3.0, "CAP_F1": 2,
  "W_F2_tutorWeight": { "combo-starter": 3, "engine-glue": 2, "utility": 1 },
  "CAP_F2": 8,
  "W_F3": 1.0, "CAP_F3": 4,
  "W_F4": 0.3, "CAP_F4": 6,
  "GLOBAL_CAP": 15
}
```

---

## 4. Card Metadata Wiring (the only real piece of plumbing)

Currently `InterruptionScorer` has **zero CardDB access** — it only sees `interruption-tags.json`. F1/F3 require type inference (isRitualMonster, level, attribute).

### Approach: pre-compute at scorer construction

```ts
// New: solver-worker.ts builds this once per duel
const cardMetadata = buildCardMetadataMap(cardDB, duelConfig.mainDeck ∪ extraDeck ∪ hand);
const scorer = new InterruptionScorer(tags, weights, cardMetadata, structuralWeights, tutorList);
```

`buildCardMetadataMap` queries CardDB once per cardId:
```ts
type CardMetadata = {
  type: number;         // YGOPro type bitmask
  level: number;
  attribute: number;
  race: number;
  isRitualMonster: boolean;    // derived from type bitmask
  isRitualSpell: boolean;      // derived: spell subtype
  ritualCompatIds?: number[];  // derived from card desc parsing — deferred to runtime if needed
  tutorActionTag?: string;     // matched against structural-tutor-cards.json
};
```

**Cost**: ~40 cards (main+extra+hand) × 1 SQLite query = <5ms one-time.
**Scorer runtime cost**: O(1) map lookup.

### `ritualCompatIds` detail

Most ambitious sub-feature. Two options:
- **V1 simple**: for F1, only check `isRitualMonster + isRitualSpell` co-presence. Ignore specific compatibility (Mitsurugi Ritual can summon ANY Reptile Ritual — this is already captured). Mismatch (e.g., Nekroz Ritual + Mitsurugi Ritual monster) is rare and costs are low.
- **V1.1** (stretch): parse card desc for "You can Ritual Summon this card with 'X'" text via regex on cardDB `desc` column. Build compatibility map. ~1 day work, defer if time-pressed.

Start with V1 simple.

---

## 5. Evaluation Harness

### Current state
`probe-move-enum-audit.ts` runs ONE fixture at a time manually. Output: stdout + log file.

### Step 1 extension: batch runner

New script `duel-server/scripts/evaluate-structural.ts`:
- Loads ALL valid fixtures from `solver-validation-decks.json` (excluding `_draft:true`).
- Runs each at configurable budget (default 60s).
- Collects per-fixture: score, matched, nodesExplored, actionsZero%, turn2%, peak field diff.
- Outputs JSON: `{ [fixtureId]: { score, matched, ... }, aggregate: { cumulativeMatched, perFixtureScoreDelta } }`.
- Diff against previous baseline JSON — flags regressions.

### Baseline capture
Before any structural code lands, capture current baseline:
```
npm run eval:structural -- --out=baselines/pre-step1-baseline.json
```

### Regression gate
After each feature lands:
```
npm run eval:structural -- --compare=baselines/pre-step1-baseline.json
```
Exit 1 if any fixture's matched count decreases. Score deltas reported but non-blocking (slight wiggle acceptable within ±3 points).

### Effort: 4-6h for the batch runner + baseline capture.

---

## 6. Ship Order (phased within step 1)

Each sub-phase is independently deployable and validated against the regression harness before merging.

| Sub-phase | Scope | Effort | Gate |
|---|---|---|---|
| S1.0 | Batch evaluation harness + baseline capture | 0.5 day | Baseline JSON committed, deterministic re-run passes |
| S1.1 | `CardMetadataMap` pre-computation + wiring | 1 day | All 5 fixtures still at baseline (zero behavioral change) |
| S1.2 | F4 (Unused effect budget) — simplest, reuses existing tag machinery | 1 day | Regression harness passes, at least one fixture shows non-zero F4 contribution |
| S1.3 | F1 (Ritual unlock co-presence) + tribute fodder | 2 days | **Mitsurugi jumps to ≥ 4/6 matched** (primary unlock criterion). Zero regression elsewhere. |
| S1.4 | F3 (Extra deck material pool) | 2 days | At least one fixture (any) shows improved matched OR turn2%, zero regression |
| S1.5 | F2 (Tutor chain potency) + hand-authored JSON whitelist | 2 days | Mitsurugi or D/D shows improvement, zero regression. **~30 whitelist entries curated.** |
| S1.6 | Weight inspection pass + cap tuning | 1 day | Cumulative matched across 5 fixtures ≥ +3 from baseline |
| S1.7 | Documentation + memory updates | 0.5 day | Post-step-1 memory entry written, audit memory marked as resolved. |

**Total**: 10 working days = 2 weeks. 1 week buffer for discovery, feature tuning, regression investigation.

**Order rationale**: F4 first (cheapest, reuses existing infra, validates the plumbing). F1 second (highest empirical motivation from Ryzeal). F3/F2 in parallel-ish. Weight tuning last, once all features coexist.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R1**: F1 co-presence check misfires (false positives with wrong-archetype ritual spell + monster) | Medium | Medium | V1.1 stretch: parse desc for "Ritual Summon with 'X'" text, build explicit compat map. If hit in testing, promote V1.1 inside S1.3. |
| **R2**: F2 whitelist curation introduces bias — top-10 meta over-represented | High | Low | Acknowledge explicitly. Step 3 calibration will re-weight based on corpus. |
| **R3**: F3 Rank-N Xyz accessibility produces "generic Xyz spam" false positive | Medium | Medium | Log scaling (`log2(1+count)`) caps runaway. Per-archetype validation via regression harness. |
| **R4**: Feature weights lock in overfitting on 5 current fixtures | High | High | **Hard rule**: during step 1, do NOT tune weights against matched gains. Only inspection-seeded values. Tuning is step 3's responsibility against larger fixture suite. |
| **R5**: Structural computation latency inflates per-node cost, drops throughput below 15 nodes/s | Medium | Medium | Profile via `SOLVER_INSTRUMENT=1` timing counters. If >0.5ms per call, cache `CardMetadata` lookup results in closure. |
| **R6**: D/D/D Phase 2.3 V1 block (latent D/D Gate bonus) interacts with F2 tutor bonus — double-counting | Medium | Low | Explicit exclusion: in F2, exclude D/D cards that are already scored by Phase 2.3 V1. Document in code comment. |
| **R7**: Turn-gate `turn === 1` too narrow — F4 (unused effect budget) has value at turn 2+ too | Low | Low | Keep `turn === 1` for v1. Revisit after step 3 corpus ships turn-2+ fixtures. |
| **R8**: CardDB query at construction is slow (cold SQLite) | Low | Low | 40 cards × 1 query = <5ms measured elsewhere. Not a real risk but monitor. |

---

## 8. Success Criteria

### Primary (functional)
- Mitsurugi fixture: matched ≥ 4/6 (currently 2/6).
- Saji in mainPath OR Ritual/Mirror in GY at peak.
- Zero regression on D/D/D (≥ 2/5), Branded Arth (≥ 2/6), Branded Mirr (≥ 3/6), Radiant Typhoon (≥ 2/3).
- `turn2 %` on Mitsurugi ≥ 25% (currently 13.7%).

### Secondary (quality)
- Per-fixture score delta ≥ +3 cumulative across all 5 fixtures.
- Structural value computation adds <0.5ms per scorer call.
- `actionsZero %` on Mitsurugi < 50% (currently 62.7%).

### Non-criteria (explicitly NOT blocking)
- D/D/D matched improvement (the Phase 2.3 V1 block already carries it; step 1 should not touch).
- Throughput improvements — out of scope, belongs to constraint 1.3.

### Failure mode
If after S1.5 Mitsurugi is still at 2/6:
1. Re-run audit with F1-F4 contributions logged per node along mainPath.
2. Identify which feature was supposed to rescue Saji-branch and why it didn't dominate.
3. Decide: promote cap for that feature vs. admit structural additive is insufficient and escalate to Phase I pruning bound fix (move the structural value into `heuristicUpperBound` instead of `bestScoreSoFar`).

---

## 9. Out of Scope (explicit deferrals)

- **Multi-turn features**: continuation/grind (research doc "ContinuationConsideration"). Requires turn-2+ scoring and adversary modeling. Step 4+.
- **Risk sub-scorer**: handtrap susceptibility (research doc "RiskScorer"). Requires opponent hand modeling. Step 3+.
- **EHS composer**: non-linear `direct × (1-risk) + (1-direct) × latent × (1-risk)` formula from research doc. Step 3+ (after linear additive is tuned and plateaued).
- **Tapered own-turn vs opp-turn weights**: single weight per feature in v1. Tapered requires turn-parity tracking that's orthogonal to step 1. Step 3.
- **CardZoneValue table**: sparse `(cardId, zone) → value` bonus. No empirical motivation. Step 3+ if ES tuning suggests zone-correlated features matter.
- **Pattern library DSL**: JSON preconditions compiled at runtime. Over-engineered for 5-fixture scope. Revisit at step 3 corpus ≥ 200 endboards.
- **Labeled corpus / LLM bootstrap / ES tuning**: step 3 responsibility.
- **Value network / DL**: step 4+.

---

## 10. Handoff Artifacts

Upon step 1 completion, the following artifacts must exist for step 3 (calibration) to begin:

1. `duel-server/src/solver/structural-value-computer.ts` — implementation.
2. `duel-server/data/structural-weights.json` — seeded weights.
3. `duel-server/data/structural-tutor-cards.json` — curated whitelist.
4. `duel-server/scripts/evaluate-structural.ts` — batch harness.
5. `_bmad-output/planning-artifacts/research/baselines/pre-step1-baseline.json` — reference.
6. `_bmad-output/planning-artifacts/research/baselines/post-step1-baseline.json` — new reference.
7. Memory entry `project_solver_step1_structural_value_2026-XX-XX.md` — findings, cap values, decisions made, failure modes encountered.

---

## 11. Key Architectural Decision Records (brief)

### ADR-S1-1: Additive composition, not EHS composer
**Context**: Research doc proposes non-linear EHS composer.
**Decision**: Step 1 uses additive `latentPoints += structural`. Rationale: Phase 2.3 V1 already ships this pattern; simpler to implement, debug, and roll back. EHS composer adds complexity without empirical evidence of its necessity at 5-fixture scope.
**Trade-off**: Cannot capture multiplicative interactions (e.g., "risk × latent"). Acceptable for v1.

### ADR-S1-2: Inspection-seeded weights, no tuning in step 1
**Context**: Tuning produces better weights but risks overfitting on 5 fixtures.
**Decision**: No ES/CMA-ES/grid search in step 1. Weights hand-set by inspection. Tuning moved to step 3 when fixture suite ≥ 20.
**Trade-off**: Sub-optimal weights. Acceptable if feature existence alone unlocks Mitsurugi.

### ADR-S1-3: Turn-1 gate only
**Context**: Step 1 features might be valuable at turn 2+.
**Decision**: `turn === 1` gate initially. Matches Phase 2.3 V1 precedent.
**Trade-off**: Feature unused at turn 2+. Revisit in step 3.

### ADR-S1-4: No scorer refactor
**Context**: Research doc proposes extracting `DirectScorer` / `LatentScorer` modules.
**Decision**: Keep `InterruptionScorer` monolithic in step 1. Add `StructuralValueComputer` as a helper, NOT a full scorer peer.
**Trade-off**: Scorer will grow; refactor later. Avoids breaking Phase 2.3 V1 integration + risks.

### ADR-S1-5: Card metadata pre-computed at construction, not on-demand
**Context**: Scorer currently has no CardDB access.
**Decision**: Build `CardMetadataMap` once at solver construction, pass to scorer. Keeps hot path pure.
**Trade-off**: Adds a plumbing dependency (solver-worker passes cardDB indirectly via metadata map). Minor.

---

## 12. Open Questions (to resolve before starting S1.2)

1. **F1 compat check**: V1 simple (isRitualMonster + isRitualSpell) vs V1.1 (parsed explicit compat)? Decide after S1.1 metadata pre-compute.
2. **F2 whitelist source**: hand-author ~30 or reuse `structural-tutor-cards.json` draft from research doc if present? Check before S1.5.
3. **Weight scale calibration**: should `STRUCTURAL_VALUE_CAP=15` be absolute or relative to current scorer range (e.g., 10% of current max)? Decide after S1.1 baseline capture shows current score distribution.
4. **Regression gate severity**: block merge on any matched regression, or allow ±1 on non-primary fixtures? Default: block all regressions. Reconsider if too restrictive.
5. **Phase I interaction**: should structural value also feed into `heuristicUpperBound` so Phase I pruning uses it as well as score floor? Currently the floor uses `bestTurn1Score` which would include structural. Validate in S1.2 that pruning behavior is sensible.

---

## 13. Step 1 → Step 2 → Step 3 Alignment

- **Step 2** (fixture suite 15-20 decks) — can start in parallel with step 1. Prerequisite for step 3, not for step 1. Each new fixture validates step 1 features incrementally.
- **Step 3** (tuning) — strict dependency on step 1 shipped + step 2 at ≥ 15 fixtures. ES/CMA-ES sweep over `structural-weights.json` values with fixture-hit-rate as fitness.

Step 1's job is to **build the lever**. Step 2 builds the **measuring stick**. Step 3 **pulls the lever** with data-driven weights.

---

## End
