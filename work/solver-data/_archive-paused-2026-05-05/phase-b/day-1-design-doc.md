# Phase B (graph-ml-v2) — Day 1 design doc

**Date:** 2026-04-26
**Status:** **DESIGN CORRECTED — DAY 1.5 PLUMBING IN PROGRESS.** Point-by-point walkthrough complete with user arbitrage; round 2 review caught 15 design issues now patched. **Day 1.5 plumbing partially shipped 2026-04-26:** `Action.sourceZone` field + OCGCoreAdapter populates it at SELECT_IDLECMD / SELECT_BATTLECMD / SELECT_CHAIN sites; ddd-pendulum baseline measured (1/5 matched, 18 score). **Next:** `state-feature-extractor.ts` (95 features) + `neural-ranker.ts` + training script + 3-seed pre-flight execution. Day 2-7 conditional on pre-flight GO/NO-GO (see §1.5).
**Predecessors:** Phase 0 honest baseline (commit f37c1521), Phase 1 scorer audit (commit cb1dd370).
**Reference baseline:** honest config = 20/69 cum matched, 209 cum score
(`SOLVER_DISABLE_EXPERTISE=1`, no `--implicit-goals`, nb=400 / 6000 ms / pool=1).

## Changelog

### Round 1 review (2026-04-26)
- **Branded contamination fix:** `branded-dracotail-opener-mirrorjade-line`
  removed from hold-out cumulative (same hand+deck as primary = data
  leakage). Kept as paired alt-metric for branded-dracotail in training.
- **Dropped base-ranker-position features (rows 96-97):** copy-base-ranker
  attractor argument; soft-bias additive contract `(N−i)·30` already
  encodes deference, the explicit features were a redundant gradient sink.
- **Dropped ablation #4 (λ_var=0.5):** math review showed penalty (~12-15)
  dominates expected lift (+1 to +5 per fixture). Replaced with
  "single-fixture vs multi-fixture training" ablation.
- **Source-card lookup determinism:** Action gains a `sourceZone?: ZoneId`
  field populated by OCGCoreAdapter from response.location.
- **Pre-flight gate added** (§1.5).

### Round 2 review (2026-04-26)
- **Param math fix:** MLP `[95→32→1]` = `95×32 + 32 + 32 + 1 = 3105`
  (was wrongly 3074 / 3138 in different sections — collapsed `32+32` to
  `33` by arithmetic error). Total evolved = **3105 + 1 (bonusScale) = 3106**.
- **Spright fallback dropped:** §10 originally proposed promoting
  spright-opener from hold-out to training if ddd-pendulum breaks. That
  is the same Branded-mirrorjade leak pattern. **Replaced with: drop to
  3-fixture training (branded, mitsurugi, snake-eye-yummy)** if ddd-pendulum
  is broken; accept loss of Pendulum diversity rather than pollute hold-out.
- **ddd-pendulum baseline measured pre-training:** Day 1.5 prep adds
  `runFixture(ddd-pendulum)` at honest config to fill the TBD/TBD entry
  in §5 before training commits to it.
- **Cardinality consistency:** standardised on "10 hold-out fixtures, 14
  fixtures in cum eval, 1 alt-metric (mirrorjade-line)" everywhere.
- **§1 thresholds marked advisory:** `+5 floor / +8 stretch` are **pre-pre-flight
  estimates**. Final ship thresholds are set in §1.5 GO branch from the
  pre-flight measured signal — not from these advisory numbers.
- **Pre-flight 3 seeds:** single-seed (Phase A consolidation memo:
  σ ≈ 1.7 matched per seed) is below noise. Pre-flight becomes 3 seeds
  × 30 gen × snake-eye-yummy = ~75 min compute. Median of 3 = signal.
- **Pre-flight GO bar raised:** `median(3 seeds) lift ≥ +2 matched OR
  ≥ +10 score, 0/3 catastrophic regression` (was `+1 matched OR +5 score`,
  single-seed).
- **Pre-flight NO-GO softened:** linear failure does not categorically
  imply MLP failure — non-linear interactions remain possible. NO-GO triggers
  "investigate before committing 20 h: try MLP×1-fix as 2nd pre-flight,
  or pivot to Phase 3" rather than auto-abort.
- **featureSpecHash field added** to weights JSON. Loader compares hash;
  mismatch = explicit error. Migration deferred to Phase 5.
- **Train budget aligned with eval:** training switches from
  `nb=200/3000ms` to `nb=400/6000ms` (matches eval canonical). Phase A
  consolidation showed nb=200 was budget-bound; training at the eval budget
  avoids regime-shift transfer loss. **Wall-time: ~10h → ~20h.**
- **`terminalBonus` dropped from fitness:** §1 non-goal forbids new fitness
  signals beyond `interruptionScore`. Pure `interruptionScore` only;
  timeouts are rare (~2% fixtures), shaping was philosophical violation
  for marginal value.
- **σ_init split per-param-class:** weights additive σ=0.3 (init=0,
  unchanged); bonusScale additive σ=30 (init=100, ≈ 30 % of init magnitude).
- **bonusScale floor raised:** min 10 → **30** (30 % of init = real
  floor against "ignore neural" degenerate-at-low-magnitude).
- **Trajectory dump = full 49-state vector:** the "top-12" in the original
  spec was a UI hint, not a storage constraint. Phase 3 picks subset post-hoc.
- **Attribute rationale text cleaned:** removed archetype examples
  (Branded/Snake-Eye/Drytron) from row 73-76 rationale; features themselves
  remain mechanically deck-agnostic.
- **Sort tie-break specified:** when two actions have identical
  `final_score`, **stable sort by original action index** (matches v1's
  `(y.score - x.score) || (x.i - y.i)` contract).

---

## 1. Goal & non-goals

### Goal
Replace `GraphGuidedRanker`'s 1038-dim per-edge weights (card-specific,
non-generalising) with a small MLP consuming a **deck-agnostic state-feature
vector** + **per-action features**. Train via the existing ES infrastructure,
multi-fixture, on **purified `interruptionScore` fitness**. Ship as
`neural-tier-a-latest.json`, env-gated by `SOLVER_USE_NEURAL_WEIGHTS=1`.

### Non-goals
- No new fitness signal beyond `interruptionScore` (no `matched²`, no
  `goalMatchPoints` — Phase 1 honest-baseline philosophy).
- No archetype expertise touched (ranker remains pass-through under
  `SOLVER_DISABLE_EXPERTISE=1`).
- No Python / no ONNX. Pure JS forward pass. Same brownfield discipline.
- No new fixtures. Same 15-fixture eval set.

### Decision criteria for Day 7 ship — **advisory pre-pre-flight**

> **These numbers are pre-pre-flight estimates, not the ship gate.**
> Final ship thresholds are derived in §1.5 GO branch from the *measured*
> pre-flight signal, scaled by a documented multiplier. Do not commit to
> these numbers as a contract.

Advisory targets (likely region):
- floor: cum matched ≥ **~25 / 69** (+5 over Phase-1 baseline 20)
- stretch: cum matched ≥ **~28 / 69** (+8 over baseline)
- cum score ≥ **~280** (+71 over baseline 209)
- 0 individual-fixture regressions vs baseline
- Lift comes from fixtures with tags-but-DFS-doesn't-reach
  (snake-eye-yummy, labrynth, kashtira, floowandereeze, tearlaments,
  dinomorphia, horus)

If under final threshold → ship a "Phase B marginal" memo, do **not** ship
weights, decide next direction with user (likely: Phase 3 trajectory
extraction on graph-ml-v1 weights, or a different objective).

### Long-term vision context (per 2026-04-26 philosophical shift)
The 100 % `matched / 69` target is **NOT** Phase B's metric — and
likely never will be. This DFS + scorer + ranker architecture plafonds at
~35–45 / 69 for structural reasons:

| Catégorie de gap (20 → 69) | Cards estimées | Récupérabilité |
|---|---|---|
| Tags présents, DFS ne déclenche pas | ~12-18 | **Phase B target** |
| Multi-pick / OPT-bound | ~3-5 | Partial (Phase 5-lite) |
| Budget-bound fixtures | ~5-8 | Phase B + budget scale |
| Combo enablers `_validated: null` | ~15-20 | **Not recoverable via interruptionScore** |
| DFS structural pin/transposition | ~5-10 | Architecture-bound (MCTS, policy net) |

The real long-term metric is **`cum interruptionScore` against `(deck, hand)`
input only** — the solver discovers canonical lines, doesn't execute pre-
encoded ones. Phase B is one step toward that vision; Phase 5+ (policy
network on extracted trajectories) is where the gap to "100 %" closes.

---

## 1.5. Pre-flight gate (Day 1.5 — BLOCKS Day 2)

Before committing **~20 h training × 3 seeds**, run a 3-seed smoke test
to verify the architecture has signal at all. **Cheaper to abort here
than to write a "Phase B marginal" memo after burning a week.**

### Spec

| Param | Value |
|---|---|
| Model | **Linear** (input 95 → output 1, `95 + 1 + 1 = 97 evolved` incl. bonusScale) |
| Training fixture | `snake-eye-yummy-opener` (Phase 1 added 5 tags here = strongest signal expected to surface) |
| Control fixtures (eval-only, regression check) | `branded-dracotail-opener`, `ryzeal-mitsurugi-opener` |
| ES | (μ+λ) = (5+10), 30 gen, **3 seeds (42, 7, 11)**, σ_init=0.3 (weights), σ_init=30 (bonusScale), σ_min=0.05 |
| Per-rollout | **nb=400, budget-ms=6000** (matches eval canonical — Phase A showed nb=200 was budget-bound, regime-shift training avoided) |
| Wall-time | ~25 min/seed × 3 = **~75 min compute** + ~10 min analysis |

### Required plumbing for pre-flight (Day 1.5 morning)
1. `Action.sourceZone` field + OCGCoreAdapter populates it
2. `state-feature-extractor.ts` (linear-only path: 95 features, no MLP)
3. `neural-ranker.ts` skeleton with linear forward + soft-bias contract
4. Multi-fixture training script (single-fixture mode for pre-flight)
5. **Measure ddd-pendulum baseline** at honest config to fill TBD/TBD in §5
   — must run before training set is committed (~6 min compute)

Total plumbing: ~3-4 h. Then ~75 min compute + ddd baseline + analysis =
full pre-flight cycle Day 1.5 in **~5-6 h**.

### GO / NO-GO criteria — **3-seed median, raised bar**

| Criterion | Threshold |
|---|---|
| **GO — proceed Phase B Day 2-7** | `median(3 seeds)` snake-eye-yummy lift ≥ **+2 matched** OR ≥ **+10 interruptionScore** AND **0 / 3** seeds show catastrophic regression (any control-fixture regression > −2 matched) |
| **NO-GO — investigate before 20 h commitment** | Median lift ≤ 0 OR catastrophic regression in ≥ 1 / 3 seeds. **Investigation paths:** (a) try MLP×1-fix × 1 seed as 2nd pre-flight (4-5 h compute), (b) pivot to Phase 3 (trajectory extraction on graph-ml-v1 weights). Choice driven by signal pattern, not preset rule |

**Rationale for 3-seed bar:** Phase A consolidation memo (commit 9c77b68e)
measured σ ≈ 1.7 matched per seed across 3 ES runs on identical config.
Single-seed +1 matched is well within noise. Median of 3 + ≥ +2 lift
clears 1σ comfortably; pairing with the score threshold (+10 interruptionScore)
provides redundant signal.

If **GO**: derive final ship thresholds from pre-flight measurement.
Provisional scaling guideline (re-evaluated post-pre-flight):
`expected_full_lift_matched ≈ pre_flight_lift × N_train_fixtures × M_capacity`
where `M_capacity ≈ 1.0 to 1.5` for MLP vs linear (this is *uncertain*;
treat as upper bound, not promise).

### Why linear-first for pre-flight (NOT a categorical MLP killer)
- **Lower-bound check.** ~97 evolved params at 30 gen × 1 fix gives a
  sample/param ratio of ~4.6 — well-conditioned for ES on small models.
- **Linear failure does NOT prove MLP failure.** Non-linear interactions
  may exist that no linear combination captures. NO-GO is therefore an
  *investigation gate*, not auto-abort.
- **Linear failure on the strongest tag-fresh fixture is *evidence*** that
  the scorer's signal-to-search-noise ratio is low at this budget. It
  shifts probability mass toward "Phase B will be marginal" without
  proving it.
- **Cheap to run, cheap to interpret.** ~75 min compute beats 20 h
  for a binary "should we keep going?" decision.

---

## 2. Architecture

### Ranker placement (v2 **REPLACES** v1, mutually exclusive)
```
DFS  →  NeuralFeatureRanker         ← graph-ml-v2 (this work, opt-in via SOLVER_USE_NEURAL_WEIGHTS)
           wraps
        RouteAwareRanker            ← archetype expertise (pass-through under SOLVER_DISABLE_EXPERTISE=1)
           wraps
        GoldfishChainRanker         ← unchanged base
```
- `SOLVER_USE_NEURAL_WEIGHTS=1` and `SOLVER_USE_TUNED_WEIGHTS=1` are
  **mutually exclusive**. If both set, v2 wins, v1 path is bypassed.
  Cleaner than nested composition — avoids stacking two bonus signals
  in the sort key.
- Validation config per philosophy: `NEURAL=1`, `USE_TUNED_WEIGHTS=0`,
  `DISABLE_EXPERTISE=1`, no `--implicit-goals`.

### Public surface
```ts
class NeuralFeatureRanker implements ActionRanker {
  constructor(base: ActionRanker, opts?: { baseRankScale?: number; bonusScale?: number });
  setMetadata(metadata: CardMetadataMap): void;
  setInterruptionTags(tags: InterruptionTagMap): void;
  setNeuralWeights(weights: NeuralWeights | undefined): void;
  rank(actions: Action[], state: FieldState): Action[];
  needsState(promptType: PromptType): boolean;
  enableTracking(): void;          // Phase 3 trajectory hooks
  getTracking(): NeuralRankerTrackingDump | undefined;
}
```
**Fallback semantics:** `setNeuralWeights(undefined)` makes `rank()`
delegate to `base.rank()` directly (graceful pass-through, identical to
v1's contract).

### Soft-bias additive contract
```
final_score(action_i) = (N - i) × baseRankScale + bonusScale × MLP(stateFeatures ⊕ actionFeatures)
```
- `baseRankScale = 30` (default, env override `SOLVER_BASE_RANK_SCALE`)
- `bonusScale` is **evolved as the last ES parameter** (init=100, min=30,
  σ_init=30 additive) so ES self-calibrates the magnitude. min=30 (= 30 %
  of init) prevents the "ignore neural" degenerate-at-low-magnitude trap
  while still allowing 70 % range to find the right scale.
- **Tie-break on equal `final_score`:** stable sort by original action
  index (matches v1 `(y.score - x.score) || (x.i - y.i)` contract).

### MLP shape
- Input: **95 dims** (49 state + 46 per-action — see §3, §4).
- Hidden: **32 dims**, ReLU. *(1 hidden layer — simpler-first; ablation
  #3 tests adding a 16-dim 2nd layer.)*
- Output: 1 scalar.
- Param breakdown:

| Tensor | Shape | Count |
|---|---|---|
| `W1` | 95 × 32 | 3040 |
| `b1` | 32 | 32 |
| `W2` | 32 × 1 | 32 |
| `b2` | 1 | 1 |
| **MLP subtotal** | | **3105** |
| `bonusScale` (scalar) | 1 | 1 |
| **Grand total evolved** | | **3106** |

- Forward cost: ~3 K multiplies per action. Typical rank call: 5–30 actions
  → 15 K–90 K multiplies. Negligible vs WASM duel step (~0.1–1 ms each).
- **Pre-flight model (Day 1.5):** linear (no hidden layer) =
  `95 (W1) + 1 (b1) + 1 (bonusScale) = 97 evolved params`.

### σ_init schedule (per-param-class)
- **Weights** (`W1`, `b1`, `W2`, `b2`): init=0, σ_init=0.3 additive,
  σ_min=0.05. Matches v1 audit F2 floor.
- **`bonusScale`:** init=100, σ_init=30 additive (≈ 30 % of init magnitude),
  σ_min=3 (= 1 % floor). Distinct from the weight σ schedule because the
  scalar lives on a magnitude an order higher.

### Weights JSON format
```jsonc
{
  "version": "neural-v1",
  "tier": "A",
  "arch": {
    "inputDim": 95,
    "hidden": [32],     // [] for pre-flight linear model
    "activation": "relu"
  },
  "featureSpec": {
    "stateFeatures": ["turn_norm", "phase_main1", ...],   // ordered, 49 entries
    "actionFeatures": ["act_promptType_idlecmd", ...]      // ordered, 46 entries
  },
  "featureSpecHash": "sha256:...",  // hash of stateFeatures + actionFeatures arrays;
                                    // loader hard-fails on mismatch (Phase B-only;
                                    // Phase 5 may add migration). Explicit error
                                    // beats silent feature-mismatch corruption.
  "params": {
    "W1": [[...], ...],   // 95×32 (or 95×1 for pre-flight linear)
    "b1": [...],          // 32 (or 1)
    "W2": [[...]],        // 32×1 (omitted for linear)
    "b2": [0.0],          // 1 (omitted for linear)
    "bonusScale": 100.0   // evolved scalar
  },
  "metadata": { "trainedAt": "...", "generations": 60, "fixturesUsed": [...], "seed": ..., "fitness": {...}, "notes": "..." }
}
```
Loader **hard-fails on featureSpecHash mismatch** — computes hash of the
current extractor's feature names and compares to the JSON's hash field.
Mismatch = explicit error with both hashes printed. Migration mechanism
(renames, additions, deletions) deferred to Phase 5 when feature-set
churn becomes likely; for Phase B's single weight-version, hard-fail is
the safest contract.

---

## 3. State features (49 dims, deck-agnostic)

All features normalised to roughly `[0, 1]` or `[-1, 1]`. Hard rule: every
feature is computable from `FieldState` + `CardMetadataMap` +
`interruption-tags.json` only. **No** `cardId` enumeration. **No**
archetype-conditional flags.

**Required plumbing:** `normalSummonUsed` flag must be exposed on
FieldState (or via a sibling context object passed alongside state in
`rank()`). Currently the duel state tracks it but it's not surfaced.
~1-2 h plumbing on Day 2.

### A. Turn / phase / LP (6)

| # | Name | Formula | YGO rationale |
|---|---|---|---|
| 1 | `turn_norm` | `min(turn / 5, 1)` | Turn 1 = combo turn; turn 2+ = reaction |
| 2 | `phase_main1` | `1 if phase == MAIN1 else 0` | Main ignition window |
| 3 | `phase_main2` | `1 if phase == MAIN2 else 0` | Setup-trap + EP cleanup; low-value action prior |
| 4 | `phase_battle_active` | `1 if phase ∈ {BATTLE_*, DAMAGE*}` | Sépare décisions combat des décisions combo |
| 5 | `is_self_turn` | `1 if active player == self` | Decision context: chain on opp turn ≠ chain on self turn (handtraps activables, pas d'ignition) |
| 6 | `lp_self_norm` | `selfLP / 8000` | LP fuels cost effects (Branded Fusion -2000, Snake-Eye costs, Sky Striker) |

### B. Hand composition (11)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 7 | `hand_size` | `count(HAND) / 7` | Card advantage proxy |
| 8 | `hand_monsters_count` | `count(monster ∈ HAND) / 7` | Summon material reservoir |
| 9 | `hand_extra_deck_in_hand` | `count(extraDeck ∈ HAND) / 7` | Cartesia / Pendulum / HEROLive — SS-from-hand |
| 10 | `hand_spells_count` | `count(spell ∈ HAND) / 7` | Tutor / draw / pop / ritual base |
| 11 | `hand_quickplay_count` | `count(quickplay ∈ HAND) / 7` | Flexibility / opp-turn options |
| 12 | `hand_traps_count` | `count(trap ∈ HAND) / 7` | Set-trap turns |
| 13 | `hand_disrupters_count` | `count(c ∈ HAND : c.tag.activeZones ⊇ ['HAND']) / 7` | Handtraps as game-design concept (Ash, Maxx, Imperm, Veiler) — disruption from hand. **Renamed from `hand_handtraps_count` to disambiguate from row 12** |
| 14 | `hand_tuners_count` | `count(tuner ∈ HAND) / 7` | Synchro path enabler |
| 15 | `hand_low_level_count` | `count(level ≤ 4 monster ∈ HAND) / 7` | Normal-summonable without tribute |
| 16 | `hand_pendulum_count` | `count(pendulum ∈ HAND) / 7` | Pendulum scale setup viable |
| 17 | `hand_has_dupes` | `1 if ∃ cardId appearing 2× in HAND` | OPT-aware play (Cartesia, Branded Beast, Snake-Eye Oak — having a copy in reserve influences whether to commit) |

### C. Self-board composition (14)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 18 | `monsters_self_count` | `count(MZONE+EMZ self) / 7` | Board pressure / breach surface |
| 19 | `links_self_count` | `count(link ∈ self board) / 4` | Link climbs unlock EMZ + arrows |
| 20 | `xyz_self_count` | `count(xyz ∈ self board) / 4` | Detach budget; Xyz negate density |
| 21 | `synchros_self_count` | `count(synchro ∈ self board) / 4` | Synchro = single high-impact body |
| 22 | `fusions_self_count` | `count(fusion ∈ self board) / 4` | Branded / HERO / Mirrorjade signal |
| 23 | `pendulums_active_count` | `count(pendulum in S1 or S5 self) / 2` | Pendulum scales placed |
| 24 | `pendulum_scales_set` | `1 if S1 AND S5 both occupied with pendulum cards` | Explicit "Pendulum Summon dispo" — discriminates active-scales vs partial setup |
| 25 | `field_spell_self_present` | `1 if FIELD self occupied else 0` | Many archetypes gate on field spell (Sky Striker, Branded, Spright) |
| 26 | `spell_traps_self_count` | `count(SZONE self) / 5` | Set / continuous / floodgate setup |
| 27 | `spell_traps_facedown_count` | `count(SZONE self position == facedown*) / 5` | Trap cover; turn-2-trap signal |
| 28 | `total_overlay_units_self` | `sum(overlayCount on self board) / 10` | Xyz material reservoir = pending detach |
| 29 | `field_value_proxy_self` | `sum(rating on self board, default level/12) / 30` | Crude "summoned-power" cumulative — generalises across archetypes |
| 30 | `mzones_open_count` | `(5 − count(M1..M5 self)) / 5` | Hard summon gate — many combos pin-state when full |
| 31 | `extra_zones_available` | `(2 − count(EMZ_L+EMZ_R self)) / 2` | **MR5: ED Link summons sans co-link doivent aller en EMZ** (Fusion/Synchro/Xyz can use regular MZONE). Critical for Link climbs |

### D. Opponent-board summary (4)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 32 | `monsters_opp_count` | `count(MZONE+EMZ opp) / 7` | Opp body count drives target selection |
| 33 | `spell_traps_opp_count` | `count(SZONE opp) / 5` | Targets for MST-class effects |
| 34 | `field_spell_opp_present` | `1 if FIELD opp occupied else 0` | Triggers field-spell-removal value |
| 35 | `opp_overlay_units` | `sum(overlayCount on opp board) / 10` | Opp Xyz density |

### E. Resource pools (6)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 36 | `gy_total_count` | `count(GY self) / 30` | Revival / fusion-from-GY / banish-cost reservoir |
| 37 | `gy_monsters_count` | `count(monster ∈ GY self) / 30` | Revival fodder |
| 38 | `banished_self_count` | `count(BANISHED self) / 30` | Banish-pile mechanics (Runick, Kashtira, D/D) |
| 39 | `deck_remaining_count` | `count(DECK self) / 50` | Tutor power / mill ceiling |
| 40 | `extra_remaining_count` | `count(EXTRA self) / 15` | ED reservoir; depletion = remaining summon options |
| 41 | `extra_pendulums_count` | `count(EXTRA self with isPendulum && faceup) / 10` | Faceup pendulums in EXTRA = re-summon-ables (MR5 hand) |

### F. Interruption state (8)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 42 | `interruption_pieces_field_count` | `count(self board cards with interruption tag) / 7` | Current endboard interruption density |
| 43 | `interruption_score_proxy` | `sum(weight(effect) for active effects on self board) / 50` | Approximates current `interruptionScore` |
| 44 | `omninegate_count` | `count(omniNegate effects active on self board)` | Highest-value interruption type — discrete |
| 45 | `floodgate_count` | `count(floodgate effects active on self board)` | Global lock density |
| 46 | `negate_total_count` | `count(omni+typed+targeted negates active on self board)` | All negate-class aggregate |
| 47 | `interruption_pieces_hand_count` | `count(hand cards with interruption tag) / 7` | Setup potential — count of negates / floodgates we can still play |
| 48 | `unique_interruption_types_field` | `|{e.type : e ∈ active effects on self board}| / 8` | Diversity metric; wider types = harder to break |
| 49 | `gy_revival_targets_count` | `count(level ≤ 8 monster ∈ GY self) / 10` | Loose proxy of "still have fuel for revival lines" (Snake-Eye, Branded, Mirrorjade) |

**State features total: 49.**

---

## 4. Per-action features (46 dims)

Computed per Action; concatenated with state vector.

**Source-card lookup — DETERMINISTIC via Action.sourceZone (corrected post-review).**
The Action interface gains a `sourceZone?: ZoneId` field. OCGCoreAdapter
populates it from the OCG response's `location` field at action enumeration
time. The feature extractor reads `action.sourceZone` directly.

The previous "scan FieldState for first occurrence of `action.cardId`"
strategy silently corrupted features for multi-copy cards (3× Ash Blossom
in HAND + 1 in GY → first-occurrence might pick the GY copy →
`act_src_in_hand=0, act_src_in_gy=1` for a hand-trap-from-hand action).
Multi-copies are the norm in TCG decks (3× staples), so this was a
correctness bug, not a corner case.

Plumbing requirement (Day 1.5 pre-flight prerequisite):
- Add `sourceZone?: ZoneId` to `Action` interface in `solver-types.ts`
- OCGCoreAdapter populates it during action enumeration (~10-20 LOC)
- `state-feature-extractor.ts` reads `action.sourceZone` (no scan)
- For prompts where source isn't a card (rare SELECT_OPTION discriminators),
  `sourceZone` is undefined → all `act_src_in_*` features = 0.

### G. Action-type & prompt context (9)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 50 | `act_promptType_idlecmd` | `1 if SELECT_IDLECMD` | Combo-firing prompts |
| 51 | `act_promptType_battlecmd` | `1 if SELECT_BATTLECMD` | Battle phase decisions |
| 52 | `act_promptType_chain` | `1 if SELECT_CHAIN` | Chain link selection — high-leverage |
| 53 | `act_promptType_effectyn` | `1 if SELECT_EFFECTYN` | Optional ignition prompt |
| 54 | `act_promptType_card` | `1 if SELECT_CARD` | Tutor / target / cost picker |
| 55 | `act_promptType_position` | `1 if SELECT_POSITION` | Position toggle — usually defensive |
| 56 | `act_promptType_yesno` | `1 if SELECT_YESNO` | Trigger-mandatory yes/no |
| 57 | `act_promptType_option` | `1 if SELECT_OPTION` | Multi-effect cards (Dracotail e1 SS vs e2 Set) |
| 58 | `act_is_pass` | `1 if responseIndex == -1` | "Pass-on-chain" / "no" — DFS sentinel |

### H. Source card type (14)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 59 | `act_card_isMonster` | from CardMetadata | Monster activation = ignition / trigger / quick |
| 60 | `act_card_isSpell` | from CardMetadata | Spell activation = MAIN1/2 ignition |
| 61 | `act_card_isTrap` | from CardMetadata | Trap activation = chain block (or counter) |
| 62 | `act_card_isExtraDeck` | `isFusion or isSynchro or isXyz or isLink` | ED activations = climbing / endgame |
| 63 | `act_card_isLink` | from CardMetadata | Link summons unlock EMZ slots |
| 64 | `act_card_isXyz` | from CardMetadata | Xyz attaches material |
| 65 | `act_card_isFusion` | from CardMetadata | Fusion typically requires polymerization |
| 66 | `act_card_isSynchro` | `(type & TYPE_SYNCHRO) != 0` | Symmetry with Xyz/Fusion/Link |
| 67 | `act_card_isPendulum` | `(type & TYPE_PENDULUM) != 0` | Pendulum activation can target SZONE corner |
| 68 | `act_card_isTuner` | `(type & TYPE_TUNER) != 0` | Tuner = synchro path enabler |
| 69 | `act_card_isQuickPlay` | spell sub-type | Quick-play activation timing differs |
| 70 | `act_card_isContinuous` | continuous Spell/Trap | Different chain dynamics (stays on board) |
| 71 | `act_card_isCounter` | counter trap | Only counterable by counter; chain link ≥ 2 |
| 72 | `act_card_isField` | Field Spell sub-type | Field-spell core archetypes (Snake-Eye Diabellstar, Branded Domain, Mitsurugi Tendrillon) |

### I. Source card attribute & numerical (6)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 73 | `act_card_attribute_dark` | `1 if attribute == DARK` | Mono-attribute deck cohorts (mechanical clustering signal); features are deck-agnostic by construction |
| 74 | `act_card_attribute_light` | `1 if attribute == LIGHT` | Same — mechanical attribute, no archetype label |
| 75 | `act_card_attribute_fire` | `1 if attribute == FIRE` | Same |
| 76 | `act_card_attribute_other` | `1 if not in {DARK,LIGHT,FIRE}` | Catch-all for {EARTH,WATER,WIND,DIVINE} |
| 77 | `act_card_level_norm` | `level / 12` | Tribute / synchro material levels (Link rating in same field) |
| 78 | `act_card_summon_rating_norm` | `rating / 12 if isExtraDeck else 0` | Distinguishes Link-1 from Link-4 etc |

### J. Source card location (6)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 79 | `act_src_in_hand` | source zone is HAND | Hand activation = combo starter |
| 80 | `act_src_in_mzone` | source zone is M1..M5 or EMZ_* | On-field monster effect |
| 81 | `act_src_in_szone` | source zone is S1..S5 | On-field S/T effect |
| 82 | `act_src_in_field_zone` | source zone is FIELD | Field-spell continuous effect |
| 83 | `act_src_in_gy` | source zone is GY | GY-trigger activation |
| 84 | `act_src_in_banished` | source zone is BANISHED | Banished-trigger (Runick / D/D / Kashtira) |

### K. Source card structural / interruption signal (11)

| # | Name | Formula | Rationale |
|---|---|---|---|
| 85 | `act_card_has_tag` | `1 if cardId ∈ interruption-tags` | Card is a known interruption piece |
| 86 | `act_card_tag_value` | `sum(weight(t) for t in tags[cardId].effects) / 50` | Aggregate interruption value |
| 87 | `act_card_is_handtrap_class` | `1 if any tag has activeZones ⊇ ['HAND']` | Handtrap (per-card tagged) |
| 88 | `act_card_tag_has_omninegate` | `1 if any tag.type == 'omniNegate'` | Highest-value class |
| 89 | `act_card_tag_has_floodgate` | `1 if any tag.type == 'floodgate'` | Floodgate signal |
| 90 | `act_card_tag_has_targeted_negate` | `1 if any tag.type == 'targetedNegate'` | Different curve from omni-negate (Skill Drain, Ash) |
| 91 | `act_card_tag_has_destruction` | `1 if any tag.type == 'destruction'` | **Note: par construction interruption-tags ne tagge que les effets opp-targeting**, donc destruction = opp-side disrupt (Apollousa, S:P). Self-destruction-as-combo (Fire King, Unchained, Yummy) **non capturée Phase B** — Phase 5 candidate |
| 92 | `act_card_tag_has_banish` | `1 if any tag.type ∈ {banish, banishFacedown}` | Same opp-side note |
| 93 | `act_card_in_extra_deck_pool` | `1 if cardId ∈ duel.extraDeck` | Mechanical fact (we own this in ED) |
| 94 | `act_card_in_main_deck_pool` | `1 if cardId ∈ duel.mainDeck` | Mechanical: discriminates ED-summon source vs main-deck activation |
| 95 | `act_card_overlay_count_norm` | `overlayCount(source)/3 if on board else 0` | Xyz with materials = pending detach |

### L. ~~Action position in base ranker output~~ — **DROPPED post-review**

Originally proposed: `act_baseRanker_position_norm` + `act_baseRanker_isTop3`.

**Removed because:**
1. The soft-bias additive contract `(N − i) × baseRankScale = 30·(N−i)`
   already encodes "trust top positions" explicitly. Re-encoding it as
   a feature was redundant.
2. **Copy-base-ranker attractor:** explicit position features create a
   trivial local optimum where MLP learns `score = −position_norm` (=
   exact base ranker copy) and gets a "decent" fitness without learning
   anything new about ranking. The point of v2 is to *improve* on base,
   not copy it.
3. If deference to base ranker is genuinely useful in some contexts and
   not others, the MLP can rediscover it organically through other
   features. If it doesn't rediscover it, that's evidence deference
   doesn't help in those contexts.

**Per-action features total: 46.**
**Grand total input dim: 95.**

---

## 5. Multi-fixture training loop

### Fitness function (PURIFIED — round 2)
```
per_fixture_fitness(weights, fixture) = interruptionScore_after_DFS
```
Pure `interruptionScore` only (with `SOLVER_DISABLE_EXPERTISE=1`, no
`--implicit-goals`). **No** `matched²`. **No** `goalMatchPoints`.
**No** `explorationScore`. **No** `terminalBonus` (was ε·terminalBonus in
round 1; dropped because timeouts are <2 % of fixtures and shaping bonuses
violate §1's "no new fitness signal" non-goal for marginal value).

### Aggregation (simple default — variance penalty as ablation)
```
aggregate_fitness(weights) = Σ_{fix ∈ trainSet} per_fixture_fitness(weights, fix)
```
- **Sum** (not mean) so larger training sets reward broader generalisation
  proportionally.
- **No variance penalty** by default (`λ_var = 0`). Variance penalty
  becomes ablation variant #4.

### Training set — **4 fixtures (with documented 3-fix fallback)**

| Fixture | Honest baseline matched | Honest baseline score | Why include |
|---|---|---|---|
| `branded-dracotail-opener` | 4 / 8 | 71.79 | Highest-coverage tags; was v1 training fixture; sanity anchor; user's familiar fixture |
| `ryzeal-mitsurugi-opener` | 1 / 5 | 39.5 | Long-standing cross-fixture target — historical metric for "ranker generalises" |
| `snake-eye-yummy-opener` | 1 / 7 | 23.24 | Phase 1 added 5 tags; should now be learnable |
| `ddd-pendulum-opener` | **1 / 5** | **18.0** | Pendulum + Dark Contract chain dynamics — training diversity (only Pendulum deck in training set). Honest config measured 2026-04-26 (`eval-ddd-baseline.json`); meaningful headroom for training (1/5 = 20%, room to grow) |

**Fallback if ddd-pendulum is broken / not solvable** (verified Day 1.5
smoke test): **drop to 3-fix training** (`branded-dracotail`,
`ryzeal-mitsurugi`, `snake-eye-yummy`). **Do NOT promote a hold-out
fixture** — that is the same Branded-mirrorjade leak pattern the round 1
review caught. Acceptable to lose Pendulum diversity rather than pollute
hold-out.

### Hold-out set (eval-only, never seen during training)
**10 fixtures (down from 11 post-review):** `labrynth-opener`,
`kashtira-azamina-opener`, `floowandereeze-opener`, `tearlaments-opener`,
`dinomorphia-opener`, `horus-crystron-opener`, `nekroz-ryzeal-opener`,
`radiant-typhoon-opener`, `spright-opener`, `stun-runick-opener`.

**`branded-dracotail-opener-mirrorjade-line` REMOVED from hold-out
cumulative.** It shares the exact same `(deck, hand)` as the training
fixture `branded-dracotail-opener` — only the `expectedBoard` differs
(combo path B: Mirrorjade line vs path A: Dracotail line). Including it
in hold-out cumulative = data leakage: the network learns rankings on
this starting position during training, then we re-evaluate on the same
starting position at hold-out. Hold-out lift would reflect training
memorisation, not cross-fixture generalisation.

**Mirrorjade-line is reported as a paired alternative metric** alongside
the primary branded result ("branded combo path B alt-metric") but does
not contribute to cum hold-out matched.

**Cross-fixture lift on hold-out is the headline metric.** Training-set
lift without hold-out lift = overfit, do not ship.

### Single-fixture fallback
If wall-time forces a single-fixture run (debug, fast iteration):
`branded-dracotail-opener` (user's familiar fixture, highest tag coverage,
v1 training history).

### ES configuration
- `(μ + λ) = (5 + 10)`, 1/5 success rule (Rechenberg) — same as v1.
- σ schedule split per param class (see §2 "σ_init schedule"):
  weights additive σ_init=0.3, σ_min=0.05; bonusScale additive σ_init=30,
  σ_min=3.
- **Generations: 60.**
- **Per-rollout budget during training: `nb=400`, `budget-ms=6000`** —
  matches the eval canonical config. Phase A consolidation memo
  (commit 9c77b68e + budget-scaling memo) showed nb=200 was budget-bound
  (+3 matched gratis at nb=400). Training at the eval budget avoids
  regime-shift transfer loss.
- **3 seeds (42, 7, 11).** Ship the median-not-best per Phase A
  consolidation memo (single-seed = lucky draw).
- Trace artefacts (population.jsonl, mutations.jsonl, meta.json) — same
  format as v1 for `analyze-mutations.mjs` reuse.

### Wall-time estimate (round 2 — at nb=400 / 6000 ms)
- 1 rollout ≈ 6.6 s (6 s budget + ~10 % overhead).
- 1 generation = (μ + λ) × |trainSet| = 15 × 4 = 60 rollouts ≈ 6.6 min.
- 60 generations ≈ **6.6 h per seed**.
- 3 seeds ≈ **~20 h total** (was 10 h at nb=200; round 2 doubled because
  training budget aligned with eval). Run overnight + half-day. If
  ddd-pendulum dropped → 3 fixtures × 6.6 s × 60 gen × 3 seeds ≈ **15 h**.

### ES vs CMA-ES
Default = (μ+λ) ES (same infra as v1, less risk). **Fallback:** if σ
collapses by gen 30 like v1 audit F2, escalate to CMA-ES Day 5–6 (covariance-
adaptive, better at high-D).

---

## 6. Ablation plan (Day 5–6)

Run on the same 4-fixture training set, fixed seed=42, 30 gens (half-length
for ablation throughput). Each variant compared to "full neural-v1 config"
baseline.

| # | Variant | Hypothesis under test |
|---|---|---|
| 1 | Drop attribute features (rows 73–76) | Are mono-attribute archetypes a real generalisation cluster, or noise / archetype proxy? |
| 2 | Drop interruption-tag features (rows 85–92, 42–48) | How much of the lift is "tag-aware ranking" vs raw mechanical-type? |
| 3 | 2-hidden-layer `[95 → 32 → 16 → 1]` (vs default 1-hidden) | Does depth help at this scale? |
| 4 | **Single-fixture training (snake-eye-yummy only) × 60 gen** vs default 4-fix × 60 gen | Does multi-fixture aggregation actually help? Or is single-fixture training as good (= multi-fix is overhead)? |
| 5 | Linear model (input → output, ~96 params) | Lower-bound — is non-linearity required? Same architecture as the pre-flight gate model |
| 6 | Drop NS-used flag | How much of the lift comes from the (added) `normalSummonUsed` plumbing? Validates the plumbing investment |

**Note:** Original ablation #4 was `λ_var = 0.5 (vs default 0)`.
**Removed post-review** because math showed penalty (~12-15) dominated
expected per-fixture lift (+1 to +5) → not informative. Original ablation
#6 was "drop base-ranker-position features" — those features were
themselves dropped from the design (see §4 L), so the ablation is moot.
Replaced with a more useful test (drop NS-used flag).

**Decision rule per ablation:** ship the variant that maximises **hold-out
cum matched** (not training-set fitness). If linear ≥ MLP, ship linear
(Occam).

---

## 7. Trajectory extraction — Phase 3 prep

### CLI flag (Day 4 instrumentation)
```
SOLVER_USE_NEURAL_WEIGHTS=1 \
  npx tsx scripts/evaluate-structural.ts \
    --dump-trajectories=<dir> \
    ...
```

### Per-fixture dump format
```jsonc
{
  "fixtureId": "branded-dracotail-opener",
  "score": 71.5,
  "matched": 6,
  "matchedCards": [...cardIds...],
  "trajectory": [
    {
      "step": 0,
      "promptType": "SELECT_IDLECMD",
      "cardId": 11401634,
      "responseIndex": 0,
      "actionTag": "activate-effect",
      "stateBefore": {
        // Full 49-state-feature vector (named map). Phase 3 picks
        // whichever subset for downstream analysis.
        "turn_norm": 0.2, "phase_main1": 1.0, "phase_main2": 0.0,
        "phase_battle_active": 0.0, "is_self_turn": 1.0, "lp_self_norm": 1.0,
        "hand_size": 0.57, "hand_monsters_count": 0.43,
        // ... all 49 named state features ...
      }
    },
    ...
  ]
}
```

### Decisions
- **What:** best-terminal-only (1 trajectory per fixture). Alternatives
  not dumped.
- **State snapshot:** **full 49-state-feature vector** as a named map
  (the round 1 "top-12" was a UI hint, not a storage constraint). Phase 3
  analysis picks whichever subset matters per investigation.
- **When:** eval-only (gated on `--dump-trajectories`). Not during
  training (overhead, and intermediate generations rarely produce
  ship-quality trajectories).

Phase 3 will read these dumps and convert them into Markdown canonical-
line documents, replacing manually authored `*-combo-reference.md` files.

---

## 8. Phase 5 backlog (deferred, requires prereqs)

Features intentionally skipped from Phase B because their prerequisites
aren't ready. **None of these block Phase B ship.**

| Feature | Prereq | Rationale for skip |
|---|---|---|
| `act_card_has_starter_class_effect` (search/SS/draw activable depuis zone actuelle) | `card-effects-catalog` ≥ 80 % coverage on fixture decks (currently 27.7 % bimodal) | Bimodal coverage = fixture-identity proxy = catastrophic overfit risk. Catalog extension ~2-3 d via mechanical-discovery scripts |
| `act_card_has_self_destroy_combo` / `_self_banish` / `_self_mill` | Same (catalog) | Combo-self-destruction signals (Fire King, Unchained, Yummy, Tearlaments, Runick recursion). Currently no training-set fixture critically depends on it |
| `act_chain_depth_norm` / chain context features | Solver state plumbing | Niche for turn-1 combo openers (chain typically 1-2 links). Useful for SELECT_CHAIN handtrap-response prompts |
| `act_card_atk_norm` / `act_card_def_norm` | CardMetadata extension (5-10 lines SQL) | Low YGO value for turn-1 combo focus (OTK threshold rare in combo). Add when defensive-fixture lift plafonne |
| Co-link arrow features (Link-pointing-Link signal) | None (already detectable) | Niche for current training set (Branded passes through EMZ, not via co-link). Useful for pure Link climb decks |

---

## 9. Day-by-day plan

| Day | Output |
|---|---|
| **1** (today) | This design doc — **DESIGN CORRECTED (round 2)**, awaiting pre-flight verdict. |
| **1.5 (pre-flight gate)** | **Plumbing (~3-4 h):** (1) `Action.sourceZone` + OCGCoreAdapter populates it; (2) `state-feature-extractor.ts` (95-feature linear-only path); (3) `neural-ranker.ts` skeleton with linear forward + soft-bias contract + tie-break; (4) Single-fixture mode of training script; (5) `normalSummonUsed` flag plumbing on FieldState. **Pre-pre-flight measurement (~6 min):** ddd-pendulum baseline at honest config to fill TBD/TBD. **Compute (~75 min):** linear × snake-eye-yummy × 30 gen × **3 seeds (42, 7, 11)** at nb=400/6000ms. **Verdict:** GO (median ≥ +2 matched OR ≥ +10 score, 0/3 catastrophic regression) → re-calibrate Phase B thresholds, proceed Day 2. NO-GO → investigation gate: try MLP×1-fix 2nd pre-flight, or pivot to Phase 3. |
| 2 *(conditional on GO)* | Promote linear path to MLP `[95 → 32 → 1]`. Unit tests for feature extractor normalisation ranges + deterministic-feature-vector tests + multi-copy `sourceZone` validation. Smoke test MLP forward pass (random weights → rank produces permutation, no NaN). |
| 3 *(conditional)* | `src/solver/neural-weights-loader.ts` + JSON shape + `featureSpecHash` validation (mismatch = explicit error). `solver-worker.ts` + `evaluate-structural.ts` plumbing (mutually-exclusive v1/v2 gates). End-to-end smoke run on 1 fixture with random weights. |
| 4 *(conditional)* | `scripts/train-neural-weights.ts` (multi-fixture loop, ES wrapper, bonusScale as last evolved param, σ schedule split per param-class). First training run (seed=42, 60 gens, 4 fixtures, **nb=400/6000ms**) — kicks off overnight (~6.6 h). Trajectory dump infra + `--dump-trajectories` flag (full 49-state vector). |
| 5 *(conditional)* | Ablations (variants 1–6 of §6, 30 gens each, seed=42). |
| 6 *(conditional)* | Hyperparameter tuning if signal looks promising. Final 3-seed run (42, 7, 11) on best config. |
| 7 *(conditional)* | Eval on full 14-fixture cum eval set (4 training + 10 hold-out, mirrorjade-line excluded as alt-metric) at canonical config (`SOLVER_USE_NEURAL_WEIGHTS=1`, no expertise, no implicit-goals, nb=400 / 6000 ms / pool=1). Memo + commit if criteria met (re-calibrated thresholds from pre-flight); "Phase B marginal" memo otherwise. |

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| MLP overfits to 4-fixture training set | 10-fixture hold-out; 3 seeds, ship median; ablation #4 (single-fix vs multi-fix) measures multi-fix benefit; cross-fixture lift is ship gate, not training-set lift |
| Feature leakage of "deck identity" via subtle correlations (e.g., attribute_dark + isExtraDeck + level_8) | Ablation #1 (drop attributes). Hold-out includes both DARK and non-DARK decks |
| ES still σ-collapses with 3105 params | σ_init=0.3 weights / 30 bonusScale (vs v1's 0.05), σ_min=0.05 / 3 floors, multi-fixture aggregation gives stronger gradient. CMA-ES escalation if collapses by gen 30 |
| Neural bonus magnitude mis-calibrated | Evolved as last ES param (`bonusScale`, init=100, min=30). Self-calibrates with 30 % floor |
| Training wall-time too long | 4-fix × 60 gen × 3 seeds at nb=400/6000ms ≈ ~20 h. If gen-30 signal flat, kill and reassess. 3-fix fallback (no ddd) reduces to ~15 h. Single-fixture debug fallback = branded-dracotail-opener |
| Trajectory extraction overhead slows eval | Gated behind `--dump-trajectories=<dir>` (off by default) |
| User changes mind on philosophy mid-training | This design doc validation gates all subsequent work — frozen as of 2026-04-26 (round 2) |
| ddd-pendulum-opener has limited Pendulum infrastructure in solver | Verify Day 1.5 smoke test (Pendulum mechanics produce valid actions). **If broken: drop to 3-fix training (branded, mitsurugi, snake-eye-yummy)** — do NOT promote a hold-out fixture (= leak pattern) |
| Pre-flight produces NO-GO verdict | Documented investigation paths: try MLP×1-fix as 2nd pre-flight, or pivot to Phase 3. Saves 20 h of training. Captures findings for future revisit |
| Pre-flight produces ambiguous result (median +1 matched borderline) | Pre-defined criterion: `median(3 seeds) ≥ +2 matched OR ≥ +10 score`. Anything below = NO-GO. Avoid moving the goalposts |
| Source-card lookup determinism missed multi-copy edge cases | Day 1.5 tests include action enumeration on a deck with 3× same-cardId copies in different zones. `sourceZone` field validated against ground truth |
| featureSpec drift between training and runtime | `featureSpecHash` field on weights JSON; loader hard-fails on mismatch. Phase 5 may add migration |
| Train/eval budget mismatch | Round 2: training nb aligned with eval (nb=400/6000ms in both). Doubles wall-time but eliminates regime-shift transfer loss |

---

## 11. What this is NOT

- Not a replacement for graph-ml-v1 — both ship side-by-side, env-gated,
  mutually exclusive at runtime.
- Not a "Phase 3 trajectory extraction" deliverable — only the
  instrumentation hook lands. Phase 3 is separate.
- Not a "scaffolding removal" deliverable — Phase 4 deletes
  archetype-expertise. Phase B just demonstrates the neural ranker
  works without scaffolding.
- Not an attempt at superhuman play. The honest baseline is 20 / 69; a
  +5 to +8 lift = +25 % to +40 % matched cards = solid Phase B win.
- Not a full RL agent. No tree search policy. The MLP only re-orders the
  base ranker's output at each rank-call — DFS still drives exploration.
- **Not a path to 100 % matched.** This architecture (DFS + scorer + ranker)
  plafonds at ~35–45 / 69. The path beyond is Phase 5+ (policy network on
  trajectories) and a metric switch (matched → cum interruptionScore).
