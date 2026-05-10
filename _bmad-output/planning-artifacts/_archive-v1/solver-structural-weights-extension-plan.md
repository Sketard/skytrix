# Solver Structural Weights Extension Plan

**Author**: Claude Opus 4.7 (1M context) (assisted by Axel)
**Date**: 2026-04-18
**Status**: DRAFT — awaiting go-ahead before implementation
**Parent**: [`solver-step1-structural-value-function-plan.md`](solver-step1-structural-value-function-plan.md) (Step 1 F1/F2/F3 shipped 2026-04-16)
**Related memory**: `solver-v5-state-2026-04-17`, `mr5-extra-deck-summon-destination`

> **Adversarial review applied 2026-04-18.** 23 findings were raised against this draft. The features below are preserved as-is, but each weak spot now carries an inline **INVESTIGATION REQUIRED** callout naming the specific modeling, methodology, or infrastructure gap that must be resolved before that part can be implemented non-simplistically. Treat every callout as a pre-implementation blocker for its subsection, not a post-ship todo.

---

## §1. Motivation

The current structural value function ([`structural-value-computer.ts`](../../duel-server/src/solver/structural-value-computer.ts)) ships 3 features (F1 Ritual Unlock, F2 Tutor Chain, F3 Extra Deck Material) plus 2 hardcoded archetype-specific bonuses in the scorer (Dark Contracts, Doom Queen PZONE). Weights live in [`structural-weights.json`](../../duel-server/data/structural-weights.json) with `_validated: false`.

**Audit finding (2026-04-18):** the schema covers ritual archetypes and generic extra-deck material pooling, but is blind to:

- **Pendulum Summon** setup (scales in S1/S5) — whole summon mechanic invisible
- **Synchro Summon** unlock (tuner + non-tuner) — only Xyz Rank-N modeled
- **Fusion Summon** unlock (Fusion Spell + materials) — no symmetric to F1
- **Normal Summon freshness** (`normalSummoned === false`) — high-signal binary gate
- **Field Spell active** — many engines gated by it (Sky Striker, Salamangreat, Mannadium)
- **Resource accumulation** — Xyz overlay counts, Link rating on field, GY/banish loading, hand leftover

Additionally:
- D/D family bonuses are hardcoded in [`interruption-scorer.ts`](../../duel-server/src/solver/interruption-scorer.ts), not reachable by the step-3 ES/grid tuner
- F3's log-damping base (`Math.log2`) is hardcoded, not tunable
- `globalCap = 15` already saturates at F1_max (7) + F2_max (8) = 15, leaving F3 effectively squeezed out in strong states

> **INVESTIGATION REQUIRED — quantify globalCap saturation.** The claim "F3 effectively squeezed out" is only strictly true when F1 AND F2 both reach their maxima simultaneously, which is archetype-specific (most decks hit one, not both). Before raising `globalCap`, empirically measure: over the current fixture set, (a) the distribution of `uncapped = F1+F2+F3` values, (b) the fraction of states where `uncapped > 15`, (c) the per-feature contribution breakdown when saturation happens. Without these numbers, the motivation for `globalCap → 25` is speculative. Source: [structural-value-computer.ts:350-351](../../duel-server/src/solver/structural-value-computer.ts#L350-L351).

**Goal:** extend the weights schema with deck-agnostic features that capture these mechanics, migrate hardcoded bonuses to the tunable registry, and raise `globalCap` to make room for the additional signal.

---

## §2. Current Weights Inventory

### 2.1 [`structural-weights.json`](../../duel-server/data/structural-weights.json)

| Key | Value | Max | Notes |
|---|---:|---:|---|
| `F1_W` | 3 | — | Per ritual co-presence pair |
| `F1_CAP` | 2 | — | Max pairs counted |
| `F1_tributeFodderBonus` | 1 | — | +1 if tribute fodder exists |
| **F1 max** | | **7** | `3×2+1` |
| `F2_W` | 1 | — | Per tutor (from whitelist) |
| `F2_CAP` | 8 | **8** | |
| `F3_W` | 1 | — | Per log-damped opportunity |
| `F3_CAP` | 4 | **4** | ≈15 opportunities |
| `F4_*` | 0 | 0 | Dropped |
| `globalCap` | 15 | — | Additive ceiling |
| `latentDiscount` | 0.5 | — | Phase D V1 discount |

**Structural max achievable: 15** (F1+F2 alone saturate globalCap; F3 only contributes when F1 or F2 has headroom).

### 2.2 Hardcoded bonuses in [`interruption-scorer.ts`](../../duel-server/src/solver/interruption-scorer.ts)

| Constant | Value | Purpose |
|---|---:|---|
| `DARK_CONTRACT_BONUS` | 2 | Per contract in S/T (D/D family) |
| `DARK_CONTRACT_MAX_COUNT` | 4 | Cap |
| `DOOM_QUEEN_PZONE_BONUS` | 3 | Doom Queen Machinex in PZONE |
| **D/D hardcoded max** | **11** | `2×4 + 3` |

Gated on `turn === 1` and hardcoded card IDs (4 Dark Contracts + Doom Queen).

### 2.3 Related hardcoded magic in [`structural-value-computer.ts`](../../duel-server/src/solver/structural-value-computer.ts)

- `Math.log2(1 + opportunities)` in F3 — damping base not tunable
- Scan zone constants (`RITUAL_MONSTER_SCAN_ZONES`, `TUTOR_SCAN_ZONES`, `MATERIAL_ZONES`) — structural invariants, not tunable

---

## §3. Proposed New Features

Ordered by `_id`. Each feature is deck-agnostic and reads only `CardMetadata` + `FieldState` + `activationLog`.

### F5 — Pendulum Scale Setup

**Rationale:** 2 valid Pendulum Scales in S1 (left) and S5 (right) unlock Pendulum Summon — a whole summon mechanic that the current scorer does not see. Key archetypes: Endymion, D/D/D, Mannadium, Pendulum Magician, Performapal.

**Signal:**
- Both S1 and S5 occupied by Pendulum monsters, both face-up
- `leftScale < rightScale` and `rightScale - leftScale >= F5_scaleGapMin`
- At least one Pendulum-summonable target exists in HAND (level strictly between scales) OR in face-up ED

**Score:** `F5_scaleSetupBonus` (flat) if gate holds; optional `+F5_perTargetBonus × targets` (capped).

**Infrastructure:**
- `CardMetadata` must expose `leftScale`, `rightScale` (currently absent — see §5.1)

> **INVESTIGATION REQUIRED — F5 seed values and gate definition.**
> 1. `F5_scaleGapMin = 3` admits only gaps ≥3 (usable level window ≥2). This excludes Scale 1 + Scale 3 (window = Level 2 only, still legal). Audit the canonical Pendulum engines' actual scale pairs (D/D/D, Endymion, Mannadium, Pendulum Magician) and pick `F5_scaleGapMin` from the distribution, not by inspection.
> 2. `F5_scaleSetupBonus = 5` is inspection-seeded and §8.1 already hedges "likely lower (5→3?)" — commit to a rationale or mark the value as "sweep-only". Do not ship both a seed AND a same-section note saying the seed is likely wrong.
> 3. Decide whether the gate requires a Pendulum-summonable target IN HAND (current proposal) vs. also counting face-up ED Pendulum recycling. Face-up ED is a meaningful combo state that the gate currently ignores unless the doc is rewritten.

### F6 — Synchro Unlock Co-Presence

**Rationale:** Tuner + non-tuner face-up on field unlock Synchro Summon. Key archetypes: Swordsoul, Adventurer-Synchro, Mathmech, Crystron.

**Signal:**
- ≥1 face-up tuner on MZONE
- ≥1 face-up non-tuner on MZONE (or tuner counted twice for 2-tuner Synchros)
- Sum of levels matches a common Synchro boss band (6, 8, 10, 12)

**Score:** `F6_pair_W` per valid pair, capped at `F6_CAP`. Band bonus: `+F6_bossBandBonus` if total level sums to ≥8.

**Infrastructure:**
- `CardMetadata.isTuner` must exist (currently absent — see §5.2)

> **INVESTIGATION REQUIRED — F6 Synchro level bands and pair semantics.**
> 1. **Boss bands 6/8/10/12 are incomplete.** Synchros exist at every level 2–12. Key meta bosses: L5 (Accel Synchron), L7 (Black Rose Dragon, Ancient Fairy Dragon), L9 (Crystal Wing via tuning), L11 (Phantom Fortress Enterblathnir). Bands must be chosen from the actual meta Synchro distribution, not `≥8` as a proxy for "big Synchros".
> 2. **"Tuner counted twice for 2-tuner Synchros" is mechanically wrong.** Double-tuner Synchros require TWO distinct tuners on field (Karakuri Cash Cache, Chaofeng), not one tuner counted twice. The pair enumeration has to be `choose(tuners, 1) × choose(nonTuners, 1)` with level-sum filter, NOT a scalar count.
> 3. Decide whether F6 should score per-(tuner, non-tuner) pair or as a boolean "Synchro possible" gate. Per-pair inflates combinatorially on boards with 3+ monsters and will fight with F3 Xyz-pair scoring for the same bodies.

### F7 — Normal Summon Freshness

**Rationale:** `normalSummoned === false` at a turn-1 intermediate state is a very strong "combo continues" signal. Consumed NS means one major combo lever is spent.

**Signal:** binary — NS used or not.

**Score:** `F7_normalSummonFreshBonus` if fresh.

**Infrastructure:**
- `FieldState.normalSummoned: boolean` must be added + populated by the OCGCore adapter (currently absent — see §5.3)

> **INVESTIGATION REQUIRED — F7 binary model is too coarse.**
> A boolean `normalSummoned` hides real-rule complexity:
> - **Double Summon** (TCG spell) grants an additional NS for the turn.
> - **Ultimate Offering** (legacy, but pattern exists in reprints) paid-cost additional NS.
> - **Gemini monsters** can be "re-Normal-Summoned" while already face-up to gain effect.
> - **Aleister the Invoker** (discard-to-add) is NOT a Normal Summon despite looking like one at SELECT_IDLECMD time.
>
> Options: (a) keep binary but document ignored cases as known blind-spots, (b) model `normalSummonsRemaining: number` (counter), (c) trust the OCGCore idle-cmd `summons[]` array as ground truth and skip the FieldState field entirely. V1 should pick one and justify — the current proposal assumes (a) without stating it.
>
> Also decide whether the adapter tracks the flag or the scorer infers it from action history — the two paths have different determinism + TT invariance consequences.

### F8 — Field Spell Active

**Rationale:** Face-up Field Spell unlocks archetype effects (Salamangreat Sanctuary, Multirole, Sky Striker Mobilize – Engage!, Mannadium Riensent, Purrelyly).

**Signal:** any face-up card in FIELD zone.

**Score:** `F8_fieldSpellActiveBonus` (flat).

**Infrastructure:** none.

**Refinement (optional):** whitelist of "engine field spells" with per-card multipliers (like `structural-tutor-cards.json`) — defer to V2.

> **INVESTIGATION REQUIRED — F8 is too generic without a whitelist.**
> Any face-up Field Spell gets `+F8_fieldSpellActiveBonus`, including non-engine fields that happen to be set (Necrovalley in a Labrynth backrow shell, Mystic Mine leftover, Dragon Ravine in a brick hand). The proposed +2 rewards incidental field spells at the same level as real combo enablers (Multirole, Sanctuary, Engage-search spells).
>
> Two viable V1 positions: (i) ship flat `+2` and accept the noise, measured post-hoc on fixtures; (ii) defer F8 entirely until the whitelist is curated. "Defer whitelist to V2" while shipping flat V1 creates a silent regression risk on any deck running a non-engine field spell. Pick one explicitly.
>
> **FieldState ownership is NOT a concern** — verified that [ocg-field-query.ts:100](../../duel-server/src/solver/ocg-field-query.ts#L100) iterates only `p0.spells`, so the FIELD zone in FieldState is already player-0-only.

### F9 — Fusion Unlock Co-Presence

**Rationale:** Symmetric to F1 for Fusion archetypes (Branded, Despia, Shaddoll, Yubel, Frightfur). Combo path requires Fusion Spell + materials.

**Signal:**
- ≥1 Fusion Spell in HAND/S1-S5 (face-up or face-down in S zone)
- ≥2 monsters in HAND/MZONE as potential materials (not restricted to specific types in V1)

**Score:** `F9_W × Math.min(fusionSpellCount, F9_CAP) + F9_tributeFodderBonus` if material count ≥ 2.

**Infrastructure:**
- `CardMetadata.isFusionSpell: boolean` — requires a whitelist `data/fusion-spells.json` (Fusion spells have no distinct TYPE bit — see §5.4)

> **INVESTIGATION REQUIRED — F9 gate is near-universally true.**
> "Fusion Spell in HAND/SZONE + ≥2 monsters anywhere (HAND/MZONE)" fires on most turn-1 states of any deck that runs a single copy of Polymerization-like card. F1's symmetry with F9 is claimed but not realized: F1 requires a RITUAL-MONSTER × RITUAL-SPELL pair (archetype-tied), while F9 is a FUSION-SPELL × ANY-TWO-MONSTERS pair (archetype-agnostic).
>
> To achieve real parity with F1, F9 should require either:
> - A Fusion Monster reachable from the materials (requires Fusion recipe data — not currently in `cards.cdb` exposed fields)
> - Material-type matching (e.g., both materials are Fusion-named archetype cards)
> - An archetype tag on the Fusion Spell (Branded Fusion tags "Despia"/"Fallen of Albaz", Shaddoll Fusion tags "Shaddoll", etc.)
>
> Without one of these refinements, F9 is effectively "+N for owning Polymerization" — tune-to-zero likely. Decide scope before implementation.

### F10 — Xyz Material Count

**Rationale:** Xyz monsters with overlay materials have future detach budget. An Xyz with 3 overlays can fire 3 effects; bare-body Xyz scores only as a fallback tag.

**Signal:** sum of `overlayCount` across face-up Xyz monsters on player MZONE.

**Score:** `F10_W × Math.min(totalOverlays, F10_CAP)`.

**Infrastructure:** none — `FieldCard.overlayCount` already populated.

> **INVESTIGATION REQUIRED — F10 redundancy with existing fallback heuristic.**
> The scorer's fallback rule adds `+1 fallbackPoints` per face-up untagged monster on MZONE. Every face-up Xyz on MZONE therefore already earns +1 (fallback) OR its interruption-tag weight — plus now F10's `overlayCount × F10_W` on top. A tagged Xyz with 3 materials earns: weighted(tag) + 0.5 × 3 = weighted + 1.5 latent.
>
> Questions to resolve:
> 1. Should F10 apply only to UNtagged face-up Xyz, so it replaces the fallback +1 rather than doubling it?
> 2. Should `overlayCount` factor into the tag's scoring itself (e.g., OPT-aware scoring that multiplies by remaining detaches) — in which case F10 is a poor-man's substitute for a real fix?
> 3. Measure on fixtures how often `overlayCount > 0` states correlate with already-high weighted scores. If correlation is near 1.0, F10 adds noise only.
>
> Note: [interruption-scorer.ts](../../duel-server/src/solver/interruption-scorer.ts) currently does NOT consult `overlayCount` — the scorer is overlay-blind. This is a gap of its own worth raising separately.

### F11 — Link Rating On-field

**Rationale:** High-rating Links (Apollousa Link-4, Baronne, Underworld Goddess Link-4) signal combo completion. Link ratings also contribute flexibility for Link-arrow targeting.

**Signal:** sum of `rating` across face-up Link monsters on player MZONE/EMZ.

**Score:** `F11_W × Math.min(totalLinkRating, F11_CAP)`.

**Infrastructure:** none — `CardMetadata.rating` + `summonCategory === 'LINK'` already available.

### F12 — Graveyard Loading

**Rationale:** GY-based engines (Tearlaments, Shaddoll, Lightsworn, Mathmech Circular, Runick) combo off GY state. High GY count at turn-1 peak is a proxy for these archetypes.

**Signal:** `fieldState.zones.GY.length` past a threshold.

**Score:** `F12_W × Math.max(0, zones.GY.length - F12_threshold)`, capped.

**Infrastructure:** none.

**Risk:** may over-reward mill-based decks that reach deep GY without converting it to board. Mitigate via low `F12_W` and aggressive cap. Tuning should balance it against F10/F11.

### F13 — Banish Zone Loading

**Rationale:** Same as F12 but for banish-recycle engines (Kashtira, Runick, P.U.N.K., Dimension Shifter shells).

**Signal:** `fieldState.zones.BANISHED.length` past a threshold.

**Score:** `F13_W × Math.max(0, zones.BANISHED.length - F13_threshold)`, capped.

**Infrastructure:** none.

> **INVESTIGATION REQUIRED — F12/F13 seed contradicts stated mitigation.**
> §3 F12 warns "may over-reward mill-based decks — mitigate via low F12_W and aggressive cap." But §4 seeds `F12_W = 0.5`, `CAP = 3` — a state with 9 GY cards reaches the cap, contributing +3 (comparable to the full F_DDDoomQueen bonus). F13 seeds similarly. Either (a) commit to much lower seeds (0.1?) consistent with the mitigation, or (b) accept mill-decks get over-scored and document it. Thresholds `F12_threshold = 3` and `F13_threshold = 2` are inspection-picked with no rationale from the fixture set — derive them from the actual GY/banish count distribution at fixture peak states before committing.

### F14 — Hand Leftover

**Rationale:** Cards remaining in hand after turn-1 combo = flexibility (break boards, set more traps, counter-engine reserves). A 1-card hand means all-in; 3+ signals resource efficiency.

**Signal:** `fieldState.zones.HAND.length` above a threshold.

**Score:** `F14_W × Math.max(0, zones.HAND.length - F14_threshold)`, capped.

**Infrastructure:** none.

> **INVESTIGATION REQUIRED — F14 rationale is falsified in practice.**
> The stated rationale is "cards remaining in hand = flexibility". But a BRICK hand that never combos retains a full hand and scores `F14_W × (5 - 1) = +4` at cap. A successful combo that used all resources scores 0. F14 as proposed rewards bricks more than wins.
>
> To fix: either (a) gate F14 on the combo actually having happened (e.g., at least one Special Summon occurred — requires action-history state), or (b) combine with a minimum-board-state gate (F14 only scores if `sum(face-up monsters on MZONE) ≥ 2`), or (c) drop F14 entirely. Current formulation cannot ship without one of these refinements.

### F_EMZ — EMZ Preservation Penalty (derived from MR5 audit)

**Rationale:** Under MR5 (April 2020), Fusion/Synchro/Xyz can land in any MZ. Competitive play routes them to regular MZs to preserve EMZ for Link plays. An Xyz/Synchro sitting in EMZ when a regular MZ was available is structurally worse than the same monster in M3.

**Signal:** face-up Fusion/Synchro/Xyz (non-Link) in EMZ_L or EMZ_R while at least one M1–M5 was empty at summon time.

**Score:** `F_emzPreservationPenalty` (negative, e.g. `-1` per offense), capped at a floor.

**Caveat:** "at summon time" state is not available post-hoc from `FieldState`. V1 simplification: apply the penalty whenever a non-Link ED monster occupies EMZ *currently* AND there is ≥1 empty M1–M5. This is approximate but deck-agnostic.

**Infrastructure:** none.

> **INVESTIGATION REQUIRED — F_EMZ V1 heuristic may penalize optimal lines.**
> Competitive combo lines routinely land a Fusion/Synchro/Xyz in EMZ INTENTIONALLY to set up a specific Link-arrow pattern, then Link-Summon into a linked MZ pointed to by the EMZ occupant. Example: Masquerena-into-Unicorn (Unicorn in EMZ_L with BL/BR arrows) is a canonical end-board, yet the V1 heuristic penalizes Unicorn-in-EMZ whenever M1–M5 has ≥1 empty slot.
>
> Before shipping F_EMZ, enumerate on the fixture set how often the "non-Link ED in EMZ + empty MZ" signature appears on known-OPTIMAL ending states. If >10% of optimal states trigger the penalty, the feature is net-negative. If <2%, acceptable. Without this measurement, F_EMZ is speculative.
>
> Also: F_EMZ is scheduled in Phase A (1 day) AND listed as Open Question #1 (may be entirely deferred). Reconcile this contradiction — Phase A cannot include a potentially-deferred feature.

### Migration — D/D Hardcoded Bonuses

Current hardcoded values in [`interruption-scorer.ts`](../../duel-server/src/solver/interruption-scorer.ts) migrated to the schema:

| From (hardcoded) | To (schema key) |
|---|---|
| `DARK_CONTRACT_BONUS = 2` | `F_DDContract_W` |
| `DARK_CONTRACT_MAX_COUNT = 4` | `F_DDContract_CAP` |
| `DOOM_QUEEN_PZONE_BONUS = 3` | `F_DDDoomQueen_W` |

**Design:** the D/D cardId sets (`DARK_CONTRACT_IDS`, `DOOM_QUEEN_MACHINEX_ID`) remain hardcoded — migrating card-ID lists to JSON is a separate V2 concern. Only the weights become tunable.

**Compute location:** move D/D logic into `structural-value-computer.ts` (new `computeDDFamily` function) for consistency.

> **INVESTIGATION REQUIRED — D/D migration is cosmetic if cardIds stay hardcoded.**
> §1 motivates the migration as "making D/D bonuses reachable by the step-3 ES/grid tuner". But keeping `DARK_CONTRACT_IDS` and `DOOM_QUEEN_MACHINEX_ID` hardcoded means the tuner can only modify the WEIGHTS of a fixed D/D-specific card set — it cannot extend the bonus to another archetype, nor can it disable D/D entirely without setting `F_DDContract_W = 0` (which then carries a zero-weighted dead feature forever).
>
> Decide: (i) accept migration is weight-only and drop the "tunable archetype bonus" framing from §1, OR (ii) also migrate the cardId lists to a JSON file (e.g., `archetype-latent-bonuses.json` with per-archetype entries) and reshape the feature as a generic "archetype-latent-bonus" mechanism. Option (ii) is honest but larger scope.

### Tunable F3 Damping

| From | To |
|---|---|
| `Math.log2(1 + opp)` hardcoded | `Math.log(1 + opp) / Math.log(F3_dampingBase)` |

`F3_dampingBase = 2.0` reproduces current behavior. Tuner can sweep 1.5–3.0.

---

## §4. Schema Extension (Target State)

```json
{
  "F1_W": 3,
  "F1_CAP": 2,
  "F1_tributeFodderBonus": 1,

  "F2_W": 1,
  "F2_CAP": 8,

  "F3_W": 1,
  "F3_CAP": 4,
  "F3_dampingBase": 2.0,

  "F4_W": 0,
  "F4_CAP": 0,

  "F5_scaleSetupBonus": 5,
  "F5_scaleGapMin": 3,
  "F5_perTargetBonus": 1,
  "F5_CAP": 8,

  "F6_pair_W": 2,
  "F6_pair_CAP": 3,
  "F6_bossBandBonus": 1,

  "F7_normalSummonFreshBonus": 3,

  "F8_fieldSpellActiveBonus": 2,

  "F9_W": 2,
  "F9_CAP": 3,
  "F9_tributeFodderBonus": 1,

  "F10_W": 1,
  "F10_CAP": 4,

  "F11_W": 1,
  "F11_CAP": 6,

  "F12_W": 0.5,
  "F12_threshold": 3,
  "F12_CAP": 3,

  "F13_W": 0.5,
  "F13_threshold": 2,
  "F13_CAP": 2,

  "F14_W": 1,
  "F14_threshold": 1,
  "F14_CAP": 3,

  "F_emzPreservationPenalty": -1,
  "F_emzPreservationFloor": -2,

  "F_DDContract_W": 2,
  "F_DDContract_CAP": 4,
  "F_DDDoomQueen_W": 3,

  "globalCap": 25,
  "latentDiscount": 0.5,

  "_validated": false,
  "_notes": "v2 extended seed — inspection values. Tunable by step-3 ES/grid."
}
```

**Max achievable by feature:**

| Feature | Max |
|---|---:|
| F1 | 7 |
| F2 | 8 |
| F3 | 4 |
| F5 | 8 |
| F6 | 7 |
| F7 | 3 |
| F8 | 2 |
| F9 | 7 |
| F10 | 4 |
| F11 | 6 |
| F12 | 3 |
| F13 | 2 |
| F14 | 3 |
| F_EMZ | −2 (floor) |
| F_DD | 11 |
| **Additive max** | **73** |
| **globalCap** | **25** |

The globalCap ≈ 1/3 of the uncapped max means archetype-specialized features saturate and diverse-feature states dominate — the intended behavior.

---

## §5. Code Prerequisites

### 5.1 `leftScale` / `rightScale` on `CardMetadata`

**File:** [`card-metadata.ts`](../../duel-server/src/solver/card-metadata.ts)

Pendulum monsters encode scales in the `level` column of `cards.cdb` as a packed 32-bit int:

- bits 0–7: base level
- bits 16–23: left scale
- bits 24–31: right scale

**Change:**

```ts
export interface CardMetadata {
  // ...existing fields...
  leftScale: number;   // 0 for non-Pendulum
  rightScale: number;  // 0 for non-Pendulum
  isPendulum: boolean;
}

function deriveMetadata(row: DatasRow): CardMetadata {
  const levelRaw = row.level ?? 0;
  const level = levelRaw & 0xff;
  const leftScale = (levelRaw >>> 16) & 0xff;
  const rightScale = (levelRaw >>> 24) & 0xff;
  const isPendulum = (type & TYPE_PENDULUM) !== 0;
  // ...
}
```

**Cost:** ~15 LOC. Zero behavioral change (new fields populated, existing fields unchanged).

> **INVESTIGATION REQUIRED — the "zero behavioral change" claim is wrong for Pendulum monsters.**
> Current [card-metadata.ts:105](../../duel-server/src/solver/card-metadata.ts#L105) stores `level: row.level ?? 0` as the RAW DB column. For Pendulum monsters, `row.level` is a packed 32-bit int (bits 0–7 = level, 16–23 = left scale, 24–31 = right scale). F3 reads `meta.level` at [structural-value-computer.ts:297](../../duel-server/src/solver/structural-value-computer.ts#L297) — which means for Pendulum monsters ON FIELD, F3 currently reads the PACKED bits (e.g., a Scale 4 + Level 7 Pendulum stores 0x04040007, read by F3 as "level 67305479"). This is a pre-existing F3 bug, not caused by this migration.
>
> The proposed `level = levelRaw & 0xff` would silently FIX the existing bug, changing F3 output on Pendulum-on-field states. This is a semantic improvement, but:
> 1. The doc must stop claiming "zero behavioral change".
> 2. Add a snapshot equivalence test: compute F3 scores pre- and post-migration on the full fixture set. Delta is expected on any fixture with face-up Pendulum monsters (D/D/D mainly).
> 3. Xyz/Link monsters: `row.level` stores rank/rating in low bits only (no scale packing), so `& 0xff` is a no-op for them. Verify via `cards.cdb` scan that no extra-deck monster has bits set above bit 7.

### 5.2 `isTuner` on `CardMetadata`

**File:** [`card-metadata.ts`](../../duel-server/src/solver/card-metadata.ts)

```ts
export interface CardMetadata {
  // ...existing fields...
  isTuner: boolean;
}
// In deriveMetadata:
isTuner: isMonster && (type & TYPE_TUNER) !== 0,
```

**Cost:** 2 LOC.

### 5.3 `normalSummoned` on `FieldState`

**File:** [`solver-types.ts`](../../duel-server/src/solver/solver-types.ts) + [`ocg-field-query.ts`](../../duel-server/src/solver/ocg-field-query.ts) or [`ocgcore-adapter.ts`](../../duel-server/src/solver/ocgcore-adapter.ts)

Signal is available at prompt-time via `msg.summons[]` in `SELECT_IDLECMD`. Not directly in `duelQueryField`. Best approach:

1. Adapter tracks `normalSummoned` per turn — set `true` when a `summon` action is chosen, reset at `MSG_NEW_TURN`.
2. `queryFieldState()` reads the adapter-tracked flag and populates `FieldState.normalSummoned`.

Alternative (cheaper): infer from `activationLog` if action history is accessible at terminal state, but this is brittle. Adapter tracking is cleaner.

**Cost:** ~10 LOC + transposition-table key update (new FieldState field must be part of the Zobrist / TT hash).

> **INVESTIGATION REQUIRED — adapter-tracking semantics and TT invalidation scope.**
> 1. Define precisely what counts as "Normal Summon" for the flag. SELECT_IDLECMD exposes `summons` (Normal Summon from hand) separately from `special_summons` — adapter must gate only on `summons` choices. What about Flip Summon (not a NS), Gemini re-NS, NS via effect (e.g., Monster Reborn is SS, not NS)? Spec the state machine.
> 2. Define reset timing. `MSG_NEW_TURN` is coarse: the flag must reset at the start of EACH player's turn. Does the adapter already see MSG_NEW_TURN for both players?
> 3. TT key change quantification. Adding a boolean doubles the potential cache states. Measure TT hit rate on the current fixture set pre-migration and post-migration — set a fail threshold (e.g., ≤20% hit rate regression). A naive change can invalidate caches across every fixture and add hours to Phase G compute.
> 4. Zobrist hash update: [zobrist](../../duel-server/src/solver/transposition-table.ts) must XOR a dedicated random for `normalSummoned=true`. Adding a new Zobrist dimension requires an RNG seed change rollout — cached TT entries from pre-migration sessions become unreachable but not invalid.

### 5.4 Fusion Spell Whitelist

**File:** `duel-server/data/fusion-spells.json` (new), loader in `solver-config-loader.ts`

Fusion Spells have no distinct `TYPE_*` bit — they are just Spell cards whose desc contains "Fusion Summon". Three detection strategies:

| Strategy | Pros | Cons |
|---|---|---|
| **Whitelist JSON** | Simple, tunable, follows `structural-tutor-cards.json` pattern | Requires curation for new expansions |
| **Desc regex** (`/Fusion Summon/i`) | Fully deck-agnostic | Needs `desc` column in metadata — not currently queried |
| **Name heuristic** | Zero infra | Fragile (misses "Super Polymerization", catches "Fusion Recovery") |

**Recommendation:** whitelist. Seed list to be curated against `cards.cdb` — initial candidates include Polymerization, Super Polymerization, Fusion Deployment, Branded Fusion, Instant Fusion, Miracle Synchro Fusion, Shaddoll Fusion, Shaddoll Schism, El Shaddoll Fusion, Branded in Red, Branded Retribution, Despian Luluwalilith (as target, not as spell), Predaplant Triphioverutum, and archetype-specific Fusion spells per engine in the fixture set. Entries follow `structural-tutor-cards.json` shape minus the `role` enum.

**Cost:** ~30 LOC for loader + initial JSON.

> **INVESTIGATION REQUIRED — Fusion whitelist seed list is unvalidated.**
> The earlier draft of this seed list contained errors ("Despian Luluwalilith Fusion" is not a real card; "Predaplant Verte Anaconda's search target" is a monster, not a spell). Do NOT commit a seed list until every entry has been verified against `cards.cdb` (name exact match) AND classified via desc regex `/Fusion Summon/i` as an actual Fusion-enabling spell.
>
> Curation workflow: (i) `SELECT id, name FROM texts WHERE name LIKE '%Fusion%'` → candidate list; (ii) for each candidate, fetch `desc` and keep only those whose text contains "Fusion Summon" as an action (not just descriptively); (iii) strip Fusion Monsters (they appear in that query too) via `TYPE_SPELL` gate; (iv) human review on archetype coverage gaps. Expect ~30–50 cards post-curation.
>
> Also: `tutor-cards.json` is referenced elsewhere in this plan — the real filename is `structural-tutor-cards.json`. All internal references have been corrected in this section but the plan should be re-swept.

### 5.5 D/D Migration — Move Logic Out of Scorer

**File:** [`interruption-scorer.ts`](../../duel-server/src/solver/interruption-scorer.ts) → [`structural-value-computer.ts`](../../duel-server/src/solver/structural-value-computer.ts)

Extract the D/D block (lines 70–92, 286–307 of scorer) into a new `computeDDFamily(fieldState, cardMetadata, weights)` function in the structural computer. Scorer just calls into it. Weights come from the schema.

Card-ID sets (`DARK_CONTRACT_IDS`, `DOOM_QUEEN_MACHINEX_ID`) stay colocated with the compute function.

**Cost:** ~30 LOC of refactor. Risk: scoring determinism must be preserved — add an equivalence test comparing pre-migration and post-migration scores on a fixture snapshot.

### 5.6 Extend `STRUCTURAL_WEIGHT_RANGES` validation map — **PRE-WORK BLOCKER**

**File:** [`solver-config-loader.ts`](../../duel-server/src/solver/solver-config-loader.ts) lines 292–304.

The current loader validates EXACTLY 11 keys (`F1_W`, `F1_CAP`, `F1_tributeFodderBonus`, `F2_W`, `F2_CAP`, `F3_W`, `F3_CAP`, `F4_W`, `F4_CAP`, `globalCap`, `latentDiscount`). Two consequences for any V1 extension:

1. **Loader silently ignores unknown keys** — `loadStructuralWeights()` iterates only over `STRUCTURAL_WEIGHT_RANGES` (line 311), so new JSON keys are never validated and never populated into the returned `StructuralWeights` object. Without this fix, every new feature in §3 reads `undefined` at runtime and either throws a TypeError or no-ops depending on the feature's code.
2. **Override path hard-errors on unknown keys** — `applyStructuralWeightsOverride()` (line 368) throws `Invalid weights override: unknown structural field '...'` for any key not in the range map. The tuner cannot sweep any new dimension until its range rule is registered.

**Required change:** extend `STRUCTURAL_WEIGHT_RANGES` with one entry per new key listed in §4 BEFORE implementing any feature. Range bounds should be conservative (0–20 for weights, 0–10 for caps, -5–0 for penalties, 0–1 for ratios) and tightened after the first sweep surfaces actual optima.

**Cost:** ~30 LOC for the new entries. Zero feature cost on its own but blocks every feature implementation.

> **INVESTIGATION REQUIRED — §5.6 alone gates V1 start.** Until this section ships, no feature in §3 can be added to the weights JSON without silently misbehaving. Treat §5.6 as Phase 0 — must land before any Phase A task.

---

## §6. Implementation Phases

### Phase A — Free Features (zero infrastructure)

Features F8, F10, F11, F12, F13, F14, F_EMZ. All read existing `FieldState`/`CardMetadata` fields.

**Tasks:**
1. Add schema keys to `structural-weights.json` with seed values (all inactive by default: `F8_W = 0`, etc., then flip to seed values in a separate commit to separate "plumbing" from "activation")
2. Add `StructuralWeights` interface fields in `structural-value-computer.ts`
3. Add compute functions for each feature
4. Wire into `computeStructuralValue()` additive sum
5. Raise `globalCap` from 15 → 25
6. Add smoke tests covering each feature in isolation (empty state = 0, trigger state > 0, capped state = CAP)
7. Run `evaluate-structural` vs `post-phase-d-baseline.json`; no matched regression, expect score movement

**Estimated budget:** 1 day of LLM-paired work.

### Phase B — D/D Migration

Refactor only. No new features.

**Tasks:**
1. Move D/D logic from scorer to structural computer
2. Add `F_DDContract_*` + `F_DDDoomQueen_W` to schema
3. Equivalence test: snapshot score pre-migration, assert identical score post-migration on D/D fixture
4. Delete hardcoded constants from scorer

**Estimated budget:** 0.5 day.

### Phase C — `isTuner` + F6 Synchro Unlock

1. Add `isTuner` to `CardMetadata` (§5.2)
2. Add F6 compute function
3. Smoke tests + baseline re-run

**Estimated budget:** 0.5 day.

### Phase D — Pendulum Scales + F5

1. Add `leftScale`/`rightScale`/`isPendulum` to `CardMetadata` (§5.1)
2. Add F5 compute function
3. Smoke tests + baseline re-run

**Estimated budget:** 0.5 day.

### Phase E — `normalSummoned` + F7

1. Extend `FieldState` (§5.3)
2. Adapter tracking
3. Transposition-table key update
4. F7 compute function
5. Smoke tests + baseline re-run
6. Regression check: TT hit rate on existing fixtures should be roughly preserved

**Estimated budget:** 1 day (TT change has broader blast radius).

> **INVESTIGATION REQUIRED — Phase E invalidates Phase A–D baselines.**
> Adding `normalSummoned` to `FieldState` changes the Zobrist hash domain. Every fixture baseline produced by Phases A–D was computed on a FieldState without this field. Running `evaluate-structural` post-Phase-E against those baselines compares apples to oranges: state-identity changes mean TT cache misses rise and solver exploration diverges.
>
> Consequence: Phases C/D/E/F cannot be executed in parallel (contradicting §9 OQ#5). Phase E must either (a) be scheduled LAST among infrastructure phases so all prior baselines can be re-established post-Phase-E, or (b) trigger a full baseline regeneration for all prior phases. Sequential-with-rebaseline adds ~1 day.

### Phase F — Fusion Spells + F9

1. Create `data/fusion-spells.json` (seed 20 cards) (§5.4)
2. Loader + plumbing
3. F9 compute function
4. Smoke tests + baseline re-run

**Estimated budget:** 1 day (initial JSON curation is the bulk).

### Phase G — Step-3 Sweep Re-run

After all features ship, re-run the coarse ES/grid sweep with the extended weight space. Expect the tuner to shift many seed values — the inspection-seeded defaults are not optimal.

**Task:** extend `sweep-specs/coarse-v1.json` with the new dimensions. Run `tune-weights.ts`. Validate top candidates on held-out fixtures.

**Estimated budget:** 1 day of compute + review.

> **INVESTIGATION REQUIRED — Phase G compute budget is 2–3 orders of magnitude off.**
> Current [coarse-v1.json](../../_bmad-output/planning-artifacts/research/sweep-specs/coarse-v1.json) has 4 axes × 3 values = 3^4 = 81 candidates × 5 fixtures × ~90s = ~10 hours. Extending to ~25 new dimensions naively: 3^25 = 847 billion candidates — impossible.
>
> Phase G cannot be a grid sweep. Required redesign before scheduling:
> 1. **Two-stage:** first isolate each feature's contribution independently (1-dim sweep per feature, held-out-gated), then a joint fine sweep on the top-5 correlated features.
> 2. **CMA-ES or Bayesian Optimization** on the full 25-dim space with a compute budget (e.g., 200 evaluations × 5 fixtures × 90s = 25h) and convergence criteria.
> 3. **Feature activation order:** activate features incrementally, measure each one's marginal fixture score delta before accepting, drop tune-to-zero features.
>
> None of these fit in "1 day of compute + review". Re-budget to 3–5 days minimum after the methodology is picked. The sweep methodology redesign itself is a separate deliverable (step-3 V2 plan) — do not start Phase G until it exists.

### Total budget estimate: **5.5 days** paired with LLM.

> **INVESTIGATION REQUIRED — total budget is significantly under-estimated.**
> 5.5 days sums Phase A (1) + B (0.5) + C (0.5) + D (0.5) + E (1) + F (1) + G (1). Missing from the rollup:
> - §5.6 Phase 0 (STRUCTURAL_WEIGHT_RANGES extension) — 0.5 day
> - Smoke tests for 10+ new features — ~2 hours each = 2.5 days
> - Held-out fixture methodology design (§7.5 gap) — 1 day
> - D/D equivalence test harness (§5.5) — 0.5 day
> - Phase E TT hit-rate benchmark + rollout — add 1 day to Phase E
> - Phase G realistic methodology + compute — 3–5 days instead of 1
> - Regression-triage buffer for any matched drops — 1–2 days contingency
>
> Honest estimate: **14–18 days paired with LLM**, with Phase G as the dominant variable. If any matched fixture regresses during Phase A–F, add 2–4 days of triage. Rework this total before committing a calendar.

---

## §7. Testing & Validation Strategy

### 7.1 Unit-level (smoke tests)

Each feature gets a smoke test file following the `interruption-scorer-smoke-test.ts` pattern:
- Empty state → feature contributes 0
- Minimal trigger state → feature contributes expected base
- CAP-saturation state → feature caps correctly
- Interaction: enabled + gate-missing → feature contributes 0

### 7.2 Regression harness

`evaluate-structural` against the canonical `post-phase-d-baseline.json`:
- Per-fixture score delta logged
- **Matched must not regress.** Score may rise or fall; matched is the primary invariant.
- Any matched regression blocks the commit pending investigation.

### 7.3 Determinism harness

`solver-determinism-smoke-test.ts` must continue to pass — the extended weights must not introduce non-determinism (they won't; all reads are pure state functions).

### 7.4 TT invariant (Phase E only)

Adding `normalSummoned` to `FieldState` requires updating the Zobrist hash computation and TT key serialization. `zobrist-smoke-test.ts` must cover the new field: same-state-different-normalSummoned produces different keys.

### 7.5 Held-out fixture check

After Phase G sweep completes, the winning weight set is validated against a held-out fixture subset (TBD — currently all fixtures are training data; this exposes a methodology gap to address in step-3 V2).

> **INVESTIGATION REQUIRED — overfitting risk is unacceptable without held-out data.**
> 22 new tunable parameters on a training set of ~15 fixtures is a recipe for overfitting. §10's success criterion ("+5 cumulative score vs baseline") is measured on the same fixtures the tuner optimizes against — the metric is circular and guaranteed to improve at Phase G regardless of whether the features actually generalize.
>
> Required before Phase G ships:
> 1. **Partition the existing fixture set** into train (~10 fixtures) and held-out (~5 fixtures). Document the split rationale (archetype coverage, deck diversity, matched-score baseline parity).
> 2. **Define held-out acceptance thresholds**: e.g., ≥80% of train-set improvement must carry to held-out, OR held-out cumulative score must not regress by more than -2 points.
> 3. **Alternative if fixture count is too low for a meaningful split**: add new fixtures first (extend the fixture set to 25–30 fixtures) before running Phase G. This is its own calendar-week task and should be scheduled explicitly, not hand-waved as "V2".
>
> Success criterion in §10 must be rewritten to measure on held-out data, not train data, before any tuning run is authoritative.

---

## §8. Tuning Considerations

### 8.1 Seed value inspection

All seed values in §4 are inspection-driven, NOT tuned. The `_validated: false` flag makes this explicit. Expected post-sweep changes:

- `F5_scaleSetupBonus` likely lower (5 → 3?) — Pendulum Summon is a major ceremony, but many Pendulum boards also hit F2/F3
- `F12_W`, `F13_W` likely very low (0.5 → 0.1?) — GY/banish loading correlates with but does not cause interruption value
- `F_emzPreservationPenalty` may be zero in the optimum — the signal may be noise at this granularity
- `globalCap` — sweep candidates 20, 25, 30, 35

### 8.2 Sweep dimensions (§phase G)

Extending from the current sweep's ~6 dimensions to ~25 dimensions inflates search space. Options:
- Two-stage: coarse sweep on dimension subsets, then fine-tune winners
- Add dimension priors from domain knowledge (e.g., `F_emzPreservationPenalty` bounded to `[-2, 0]`)
- Use CMA-ES instead of grid for scalable search

Defer detailed sweep design to the step-3 V2 plan.

### 8.3 Correlation concerns

Features may correlate:
- F3 (material pool) ↔ F11 (link rating on-field) — both reward monsters on MZONE
- F10 (Xyz overlays) ↔ F11 (link rating) — both reward extra-deck bodies
- F12 (GY) ↔ F13 (banish) — mill-banish decks score both

The tuner will discover these. Correlated features may end up with low individual weights compensating for the double-count.

---

## §9. Open Questions

1. **F_EMZ signal** — is the "at summon time" approximation acceptable, or does it need FieldState history? If the latter, this feature is deferred.
2. **Fusion Spell whitelist vs desc-regex** — whitelist is the V1 choice, but long-term whether to expose `desc` in metadata is worth revisiting.
3. **F12/F13 threshold vs curve** — linear above threshold is simplest. Log damping (like F3) would be smoother but adds another tunable (`F12_dampingBase`).
4. **Held-out fixture set** — must be defined before Phase G or the sweep results risk over-fitting.
5. **Order of Phase C/D/E/F** — can run in parallel if multiple engineers / agents. Currently assumed sequential.
   > **INVESTIGATION REQUIRED — parallel scheduling is unsafe.** Phase E changes `FieldState` shape and Zobrist hash domain, invalidating every baseline produced by Phases A–D. Parallel execution of E alongside A–D would leave A–D baselines stranded and require re-run post-Phase-E. Either sequence E LAST (after F), or accept a full rebaseline pass after E lands. This is a hard sequencing constraint, not a parallelization opportunity.
6. **Archetype-locked features** — Kashtira-specific floodgate bonuses, P.U.N.K. turn-steal bonuses, etc. — deferred to V3 as per the current scope boundary on "deck-agnostic".
7. **F5 / Pendulum-from-ED face-up count** — the current F5 signal uses HAND + face-up ED for Pendulum targets, but an "extra-deck-is-stocked" sub-feature might score combo-mid states better. Defer to V2 refinement.

---

## §10. Success Criteria

Phase A–F land incrementally with:
- 0 matched regressions vs baseline
- Smoke tests all passing
- Determinism preserved
- TT invariants preserved

After Phase G (sweep re-run), the tuned weight set should:
- Improve cumulative score on the training fixtures by ≥ +5 pts vs `post-phase-d-baseline.json`
- Improve matched on at least one fixture currently stuck at ≤2 (e.g., Mitsurugi 2→3)
- Not regress any existing matched fixture

If Phase G fails to deliver a matched improvement, the extension reverts to Phase A–F results only (still valuable for the tunability migration and the additional signal) and we reassess whether matched improvements require a qualitatively different approach (e.g., Tier 4 value network).

> **INVESTIGATION REQUIRED — success criteria are unvalidated and partly circular.**
> 1. **"Mitsurugi 2→3" causal link unestablished.** The plan names Mitsurugi as a concrete target but never identifies which of F5–F14 is expected to fire on Mitsurugi's intermediate states. Before shipping any feature, run it against the Mitsurugi fixture's known peak state and verify the feature actually contributes score. If none of F5–F14 light up on Mitsurugi, the success goal is unreachable by this plan and should be replaced with a fixture that actually responds to the added features.
> 2. **"Training fixtures +5 pts"** is circular per §7.5 — after moving to held-out, restate this criterion on held-out data.
> 3. **"Not regress any matched fixture"** — applies per phase, not only post-Phase-G. Phase A–F each need a matched gate.
> 4. **Per-feature attribution**: each feature should have a declared expected-impact fixture (e.g., "F5 expected to raise D/D score by ≥3 pts, verified on `ddd-opener` fixture"). If the expected impact doesn't materialize, the feature is tune-to-zero noise.

---

## §11. References

- Parent plan: [`solver-step1-structural-value-function-plan.md`](solver-step1-structural-value-function-plan.md)
- YGO rules: [`yugioh-game-rules.md`](yugioh-game-rules.md) §11 (Timing/Chain) + §12 (MR5 EMZ)
- Current weights: [`duel-server/data/structural-weights.json`](../../duel-server/data/structural-weights.json)
- Current scorer: [`duel-server/src/solver/interruption-scorer.ts`](../../duel-server/src/solver/interruption-scorer.ts)
- Current structural computer: [`duel-server/src/solver/structural-value-computer.ts`](../../duel-server/src/solver/structural-value-computer.ts)
- MR5 audit memory: `mr5-extra-deck-summon-destination`
- Tuner: [`duel-server/scripts/tune-weights.ts`](../../duel-server/scripts/tune-weights.ts)
- Evaluator: [`duel-server/scripts/evaluate-structural.ts`](../../duel-server/scripts/evaluate-structural.ts)
