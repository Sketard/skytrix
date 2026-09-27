# MVP v3 Wiring Playbook — apply post-C1

**Date:** 2026-04-26
**Status:** READY — apply when C1 (`bixe7mim0`) terminates and artefacts are archived.
**Scope:** Wire 11 new features into `state-feature-extractor.ts` in a single atomic commit. Bumps `featureSpecHash`, invalidating C1's weights — intentional.
**Author:** main session (Claude), in parallel-safe mode.

---

## Pre-conditions

1. C1 training job `bixe7mim0` has finished (artefacts written to `duel-server/data/trained-weights/checkpoints/`).
2. No other parallel session holding `state-feature-extractor.ts` open for edit.
3. Working tree clean OR only the pre-existing modifications already present at session start (slot 32-35 oppZones reads — see "Note on pre-existing modifications" below).
4. Files already shipped this session (parallel-safe, verb-tagging plumbing):
   - `duel-server/scripts/build-verb-index.ts` — pre-compute script, NEW.
   - `duel-server/data/derived/verb-index.json` — generated artifact, NEW.
   - `duel-server/src/solver/solver-types.ts` — added `ActionVerb` type + `Action.actionVerb?` field.
   - `duel-server/src/solver/ocgcore-adapter.ts` — added `ACTION_TAG_TO_VERB` map + auto-tag inside the IDLECMD/BATTLECMD/CHAIN `pushAction` closure.
5. Verb-index has been re-generated against the latest catalog (run `npx tsx scripts/build-verb-index.ts` from `duel-server/`).

---

## What gets wired (audit-honest list of 21 features)

### State-side additions (8)

Slot insertions, bumping STATE_DIM from 49 to 57:

| Slot | Name | Source | Coverage gate |
|------|------|--------|---------------|
| 6 | `normal_summon_used` | `state.normalSummonUsed?.[0] ? 1 : 0` | 100% (binary state flag) |
| 50 | `hand_combo_potential_engine` | `clamp01((state.activatableHandCardCount ?? 0) / 7)` | 100% at IDLECMD; 0 elsewhere |
| 51 | `hand_dead_card_count_engine` | `clamp01((handSize - ahcc) / 7)` if ahcc defined else 0 — see W6 for guarded form | 100% at IDLECMD; 0 elsewhere (NOT handSize/7 — that would mis-encode "all cards dead" outside IDLECMD) |
| 52 | `special_summons_this_turn_norm` | `clamp01((state.specialSummonsThisTurn?.[0] ?? 0) / 8)` — axis E | 100% (counter) |
| 53 | `effects_activated_this_turn_norm` | `clamp01((state.effectsActivatedThisTurn ?? 0) / 12)` — total effect activations (UNFILTERED counter, NOT activationLog which is OPT-tag-scoped) | 100% |
| 54 | `distinct_cards_used_this_turn_norm` | `clamp01((state.distinctCardsUsedThisTurn ?? 0) / 7)` — distinct cardIds with ≥1 activation this turn (UNFILTERED) | 100% |
| 55 | `chain_resolutions_this_turn_norm` | `clamp01((state.chainResolutionsThisTurn ?? 0) / 5)` — MSG_CHAIN_END counter | 100% |
| 56 | `cards_drawn_this_turn_norm` | `clamp01((state.cardsDrawnThisTurn?.[0] ?? 0) / 8)` — RANDOM pulls via MSG_DRAW (Pot of Desires, draw phase) | 100% |
| 57 | `cards_searched_this_turn_norm` | `clamp01((state.cardsSearchedThisTurn?.[0] ?? 0) / 8)` — TUTORS via MSG_MOVE filtered `from.DECK → to.HAND` (chosen card) | 100% |

**F14_engine + F15_engine (engine-derived axis D)** — added to MVP v3 post-audit (memo `sequences-feasibility-audit-2026-04-26.md`). The OCGCore engine evaluates every effect's activation condition in C++ when building `summons[]`/`special_summons[]`/`activates[]` at IDLECMD prompt time; this count IS the engine's ground-truth answer to "what is currently playable from hand". 100% reliable, no parser dependency, sidesteps the 36% opacity ceiling on snake-eye-yummy.

**Axis E (action density / tempo)** — 5 features capturing "YGO is mana-less; combo strength = action density per turn". Per-turn cumulative counters from existing message handlers (SPSUMMONING, CHAIN_END, DRAW) plus 2 derivations from the existing `activationLog` (no new tracking needed). Reset on every NEW_TURN. All condition-free, 100% reliable.

Plumbing already shipped this session (parallel-safe, no commit yet):
- `solver-types.ts`: `FieldState.activatableHandCardCount?: number` + axis E fields (`specialSummonsThisTurn`, `chainResolutionsThisTurn`, `cardsDrawnThisTurn`, `effectsActivatedThisTurn`, `distinctCardsUsedThisTurn`)
- `ocg-field-query.ts`: matching `FieldQueryContext` fields + propagation
- `ocgcore-adapter.ts`: `InternalHandle.lastIdlecmdActivatableHandCount?`, `specialSummonsThisTurn`, `chainResolutionsThisTurn`, `cardsDrawnThisTurn`. Helpers `countActivatableHandCardIds()` + `sumActivationLogEntries()`. NEW_TURN reset wired. SPSUMMONING / CHAIN_END / DRAW message handlers added. Both fork paths clone all new fields.
- Type-check green

Note: features 32-35 (`monsters_opp_count`, `spell_traps_opp_count`, `field_spell_opp_present`, `opp_overlay_units`) are likely **already wired** in the working tree — see "Pre-existing modifications" section. If so, the wiring batch only adds `normal_summon_used`. If not, also wire those four reads from `state.oppZones` (commit `b4142292` plumbed the data). featureSpecHash is **not affected** by the four oppZones reads (names unchanged) — they're an internal-implementation change.

### Action-side additions (10)

Inserted at end of `ACTION_FEATURE_NAMES`, bumping ACTION_DIM from 46 to 56:

**L. Action verb signature (12 features)**

| ID | Name | Source | Coverage gate |
|----|------|--------|---------------|
| L1 | `act_verb_normal_summon` | `action.actionVerb === 'normal-summon'` (Lv ≤ 4 from `summons[]`) | adapter-100% on direct-NS prompts |
| L2 | `act_verb_tribute_summon` | `action.actionVerb === 'tribute-summon'` (Lv ≥ 5 from `summons[]`) | adapter-100% on tribute prompts |
| L3 | `act_verb_set_monster` | `action.actionVerb === 'set-monster'` | adapter-100% |
| L4 | `act_verb_set_st` | `action.actionVerb === 'set-st'` | adapter-100% |
| L5 | `act_verb_summon_procedure` | `action.actionVerb === 'summon-procedure'` (Synchro/Xyz/Link/Fusion/Ritual or alt-SS-proc) | adapter-100% |
| L6 | `act_verb_pendulum_summon` | `action.actionVerb === 'pendulum-summon'` — relevant for ddd-pendulum fixture | adapter-100% (pendulum-only) |
| L7 | `act_verb_activate` | `action.actionVerb === 'activate'` | adapter-100% |
| L8 | `act_verb_attack` | `action.actionVerb === 'attack'` | adapter-100% |
| L9 | `act_verb_add_from_deck` | verb-index lookup: `cards[cardId].verbs.includes('add-from-deck')` | catalog 24/114 = 21% |
| L10 | `act_verb_special_summon_effect` | catalog: verbs.includes('special-summon') | 44/114 = 39% |
| L11 | `act_verb_destroy` | catalog: verbs.includes('destroy') | 22/114 = 19% |
| L12 | `act_verb_draw` | catalog: verbs.includes('draw') | 7/114 = 6% |

**Per-card vs per-effect false positives** (known limitation, accepted in MVP): catalog verbs (L9-L12) are *card-level* tags from verb-index. A card with multiple effects gets the union of all its verbs tagged on every activation. Example: Snake-Eyes Diabellstar has both `add-from-deck` (e2 GY-search) and `special-summon` (e1 self-SS) verbs. When activating e1 from hand (self-SS), the feature `act_verb_add_from_deck` falsely fires. The ranker can compensate via combination with `act_src_in_*` and other features. Per-effect granularity would need an `effectId` plumbed onto the Action — deferred to Sprint 3.

**Why split L1 / L2?** YGO-rules-meaningful distinction:
- **Direct NS (Lv ≤ 4)** = free placement, real starter signal — most Lv4 monsters that tutor on Normal Summon are core combo enablers.
- **Tribute Summon (Lv ≥ 5)** = costs 1-2 board monsters, almost never used in modern combo decks (Lv5+ go through Special Summon procedures or are activated from hand). Almost always a *bad* combo decision turn 1.
The ranker should be able to weight these very differently. Adapter splits via `cardDB.stmt` level lookup at IDLECMD enumeration time — ~1µs per entry.

Edge cases (accepted in MVP):
- **Magicians of Gallant Magic** and similar cards using `EFFECT_LIMIT_SUMMON_PROC` (Lv5+ Normal-Summonable without tribute under specific conditions) → appear in `msg['summons'][]` and get tagged `tribute-summon` despite being effectively direct NS. Rare in meta combo decks. Discriminating these would require reading the registered `EFFECT_LIMIT_SUMMON_PROC` flag on the card at IDLECMD time, info not exposed in the message — accepted false positive.
- **NOT an edge case here**: Cyber Dragon, Snake-Eye Diabellstar (self-SS-from-hand), Ash Blossom, etc. These cards use `EFFECT_SPSUMMON_PROC` (alternate Special Summon procedure), so they appear in `msg['special_summons'][]`, not `summons[]`. They are correctly tagged `summon-procedure`, not affected by the level split.
- **Gemini re-NS** (face-up re-summon while on field) → appears in `summons[]` via a separate code path; level-based classification still applies (most Geminis are Lv4, so tagged `normal-summon` correctly).

Drop list (below catalog coverage gate or redundant — see audit memo):
- `act_verb_add_from_gy` — only 6/114 (5.3%, borderline)
- `act_verb_return_to_hand` — 2/114 (1.8%, drop)
- `act_verb_banish` — 8/114 (7%, but high overlap with destroy semantically; defer to Sprint 3)
- `act_cost_discard`, `act_cost_tribute`, `act_cost_banish_self` — parser-coverage too sparse (≤3 cards each); defer until catalog grows or parser improves
- `act_no_cost` — 95/114 (83%) — high-positive-rate boolean is OK in principle, but signal-to-noise low; defer to Sprint 3 with the cost feature family

If post-MVP signal is positive on the 10 features above, Sprint 3 can revisit the dropped features once the catalog expands beyond 114 cards.

---

## The exact diff to apply

### Step W1: extend `STATE_FEATURE_NAMES`

File: `duel-server/src/solver/state-feature-extractor.ts`, line 107.

```typescript
// BEFORE
  'is_self_turn',
  'lp_self_norm',
  // B. Hand composition (11)

// AFTER
  'is_self_turn',
  'lp_self_norm',
  'normal_summon_used',  // NEW: state.normalSummonUsed[0] (plumbed c6e923b2)
  // B. Hand composition (11)
```

Update the section A comment from `// A. Turn / phase / LP (6)` to `// A. Turn / phase / LP (7)`.

Then, at the end of `STATE_FEATURE_NAMES` (after section F's last entry `'gy_revival_targets_count'`), append:

```typescript
  'gy_revival_targets_count',
  // S. Engine-derived axis D (2) — Phase B MVP v3, 2026-04-26
  'hand_combo_potential_engine',         // distinct hand cardIds with ≥1 offered slot at IDLECMD (engine truth)
  'hand_dead_card_count_engine',         // (hand size) − above
  // T. Axis E action density / tempo (6) — Phase B MVP v3, 2026-04-26
  'special_summons_this_turn_norm',      // own MSG_SPSUMMONING count this turn / 8
  'effects_activated_this_turn_norm',    // sum of activationLog entries / 12
  'distinct_cards_used_this_turn_norm',  // activationLog.size / 7
  'chain_resolutions_this_turn_norm',    // own MSG_CHAIN_END count this turn / 5
  'cards_drawn_this_turn_norm',          // RANDOM pulls (MSG_DRAW) / 8
  'cards_searched_this_turn_norm',       // TUTORS (MSG_MOVE deck→hand) / 8
];
```

**Why split draw vs search?** YGO-strategic distinction (user 2026-04-26):
- **Draw** = random card pull. Variance high. Player has no choice.
- **Tutor / Search** = chosen card from deck. Variance zero. Player picks the exact card needed.
A tutor is essentially always preferred to a draw — same "card added to hand" surface, but tutor is dramatically higher value. Conflating them in a single counter would dilute the signal. The ranker should learn `tutor weight > draw weight` directly via training. Detection differs by message:
- Draw → `MSG_DRAW` (`Duel.Draw` calls).
- Tutor → `MSG_MOVE` filtered: `from.location === DECK && to.location === HAND && from.controller === to.controller`. Excludes bounces (field→hand), salvages (GY→hand), banished→hand recur, and inter-player movements.

### Step W2: extend `ACTION_FEATURE_NAMES`

File: same, after line 209 (`'act_card_overlay_count_norm'`).

```typescript
  'act_card_overlay_count_norm',
  // L. YGO action verbs (12) — Phase B MVP v3, 2026-04-26
  'act_verb_normal_summon',          // adapter actionVerb tag (Lv ≤ 4 direct NS)
  'act_verb_tribute_summon',         // adapter actionVerb tag (Lv ≥ 5 tribute NS)
  'act_verb_set_monster',            // adapter actionVerb tag
  'act_verb_set_st',                 // adapter actionVerb tag
  'act_verb_summon_procedure',       // adapter actionVerb tag (Synchro/Xyz/Link/Fusion/Ritual + alt-SS-proc)
  'act_verb_pendulum_summon',        // adapter actionVerb tag (PZONE/SZONE seq 0-4 source)
  'act_verb_activate',               // adapter actionVerb tag (idle/chain activate)
  'act_verb_attack',                 // adapter actionVerb tag
  'act_verb_add_from_deck',          // verb-index: tutor (LOCATION_DECK source)
  'act_verb_special_summon_effect',  // verb-index: SS via card effect (not procedure)
  'act_verb_destroy',                // verb-index: any destroy verb in operation
  'act_verb_draw',                   // verb-index: Duel.Draw appears in operation
];
```

### Step W3: bump dim guards

```typescript
// BEFORE
if (STATE_DIM !== 49) {
  throw new Error(...49...);
}
if (ACTION_DIM !== 46) {
  throw new Error(...46...);
}

// AFTER
if (STATE_DIM !== 58) {
  throw new Error(`[state-feature-extractor] STATE_DIM expected 58, got ${STATE_DIM}`);
}
if (ACTION_DIM !== 58) {
  throw new Error(`[state-feature-extractor] ACTION_DIM expected 58, got ${ACTION_DIM}`);
}
```

`FEATURE_DIM` derives automatically (58 + 58 = 116).

### Step W4: load the verb-index in the FeatureContext factory

File: same. Add at the top:

```typescript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename_sfe = fileURLToPath(import.meta.url);
const VERB_INDEX_PATH = join(dirname(__filename_sfe), '..', '..', 'data', 'derived', 'verb-index.json');

interface VerbIndexEntry {
  verbs: readonly string[];
  costs: readonly string[];
  noCost: boolean;
  summonProcedureKinds: readonly string[];
}
interface VerbIndex {
  schemaVersion: number;
  catalogParserVersion: string;
  cards: Record<string, VerbIndexEntry>;
}

let _verbIndexCache: VerbIndex | undefined;
function loadVerbIndex(): VerbIndex {
  if (_verbIndexCache) return _verbIndexCache;
  const raw = readFileSync(VERB_INDEX_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as VerbIndex;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`[state-feature-extractor] verb-index.json schemaVersion ${parsed.schemaVersion} unsupported`);
  }
  _verbIndexCache = parsed;
  return parsed;
}
```

Extend `FeatureContext` to carry the `verbIndex`:

```typescript
export interface FeatureContext {
  metadata: CardMetadataMap;
  interruptionTags: Record<string, InterruptionTag>;
  interruptionWeights: Record<InterruptionType, number>;
  mainDeckSet: ReadonlySet<number>;
  extraDeckSet: ReadonlySet<number>;
  verbIndex: VerbIndex;  // NEW
}
```

Update `buildFeatureContext` to populate it:

```typescript
export function buildFeatureContext(args: {...}): FeatureContext {
  return {
    ...
    verbIndex: loadVerbIndex(),
  };
}
```

### Step W5: extend `extractStateFeatures`

After `out[i++] = clamp01(state.lifePoints[0] / 8000);` (currently slot 5), insert:

```typescript
out[i++] = state.normalSummonUsed?.[0] ? 1 : 0;  // slot 6 normal_summon_used
```

At the end of the function (after section F's last write `out[i++] = clamp01(gyRevivalTargets / 10);`), append sections S + T:

```typescript
  // ---- S. Engine-derived axis D (2) ----
  // F14_engine: distinct hand cardIds the OCG engine offered at IDLECMD.
  //   Sidesteps parser opacity (36% on snake-eye-yummy). Adapter clears the
  //   counter on every non-IDLECMD prompt → undefined here means "stale or
  //   not at IDLECMD" → both features emit 0 (no signal). At IDLECMD, the
  //   counter is the engine's ground-truth answer.
  const ahcc = state.activatableHandCardCount;
  if (ahcc === undefined) {
    out[i++] = 0;
    out[i++] = 0;
  } else {
    out[i++] = clamp01(ahcc / 7);
    // F15_engine: dead-card count = (hand size) − F14. Hand size from
    //   logical state. Only meaningful when ahcc is defined.
    const handSize = state.zones.HAND?.length ?? 0;
    out[i++] = clamp01((handSize - ahcc) / 7);
  }
  // ---- T. Axis E action density / tempo (5) ----
  // YGO is mana-less; combo strength = action density per turn. These 5
  // counters reset on every NEW_TURN. All condition-free, message-handler-
  // driven (SPSUMMONING / CHAIN_END / DRAW), 100% reliable.
  out[i++] = clamp01((state.specialSummonsThisTurn?.[0] ?? 0) / 8);
  out[i++] = clamp01((state.effectsActivatedThisTurn ?? 0) / 12);
  out[i++] = clamp01((state.distinctCardsUsedThisTurn ?? 0) / 7);
  out[i++] = clamp01((state.chainResolutionsThisTurn ?? 0) / 5);
  out[i++] = clamp01((state.cardsDrawnThisTurn?.[0] ?? 0) / 8);
  out[i++] = clamp01((state.cardsSearchedThisTurn?.[0] ?? 0) / 8);
```

### Step W6: extend `extractActionFeatures`

At the end of the function (after `out[i++] = sourceOverlayCount(state, sz) / 3;`), insert:

```typescript
  // ---- L. YGO action verbs (12) ----
  // Adapter-derived (8 features, 100% coverage on exploratory prompts):
  const av = action.actionVerb;
  out[i++] = av === 'normal-summon' ? 1 : 0;     // Lv ≤ 4 direct NS — real starter signal
  out[i++] = av === 'tribute-summon' ? 1 : 0;    // Lv ≥ 5 tribute NS — almost always bad in combo
  out[i++] = av === 'set-monster' ? 1 : 0;
  out[i++] = av === 'set-st' ? 1 : 0;
  out[i++] = av === 'summon-procedure' ? 1 : 0;
  out[i++] = av === 'pendulum-summon' ? 1 : 0;
  out[i++] = av === 'activate' ? 1 : 0;
  out[i++] = av === 'attack' ? 1 : 0;
  // Catalog-derived (4 features, sparse but non-trivial coverage):
  const vi = action.cardId === 0 ? undefined : ctx.verbIndex.cards[String(action.cardId)];
  out[i++] = vi?.verbs.includes('add-from-deck') ? 1 : 0;
  out[i++] = vi?.verbs.includes('special-summon') ? 1 : 0;
  out[i++] = vi?.verbs.includes('destroy') ? 1 : 0;
  out[i++] = vi?.verbs.includes('draw') ? 1 : 0;
```

The order MUST match `ACTION_FEATURE_NAMES`. Do NOT reorder.

### Step W7: type-check

```bash
cd duel-server && npx tsc --noEmit
```

Must be green. If any error mentions a `.ts` file outside the locked list, fix in place. If a locked file errors, abort and investigate.

---

## Smoke test (post-wiring, before training)

```bash
cd duel-server
npx tsx scripts/diag-train-vs-eval.ts \
  --fixture snake-eye-yummy \
  --weights-file data/trained-weights/neural-mlp-randinit-seed42.json \
  --rollouts 1
```

Expected: runs to completion without crash. If it crashes with a featureSpecHash mismatch, that's expected (intentional hash bump). Re-run with `--init-std=1.0` against fresh random weights to verify the new feature dimensions work end-to-end.

For non-degeneracy verification, dump 10 sampled action-feature vectors to JSON and verify:
- `act_verb_normal_summon` fires only on actions where `actionVerb === 'normal-summon'`
- `act_verb_add_from_deck` fires only on cardIds present in verb-index with that verb tagged
- All 10 new action features have non-zero variance across the sample

A throwaway script (`scripts/diag-feature-coverage.ts`) can do this in ~30 lines.

---

## Note on pre-existing modifications

At session start (2026-04-26 evening), the working tree contained an uncommitted modification to `state-feature-extractor.ts`: the wiring of slot 32-35 (oppZones reads from `state.oppZones`, replacing the `out[i++] = 0;` placeholders). This change does NOT bump `featureSpecHash` (feature names unchanged), but it DOES change the runtime values seen by C1's evolving weights mid-training.

**Before applying this playbook**, decide:
- **(a)** Keep the pre-existing oppZones wiring AND add MVP v3 in the same commit. This bundles all post-C1 wiring into one hash-bump-causing commit. Recommended.
- **(b)** Revert the oppZones wiring, then apply MVP v3 only. Splits the deferred wiring into two phases. Not recommended.

Either way, the resulting commit should restore working-tree cleanliness against `HEAD` (no leftover stray modifications).

---

## Expected commit message

```
solver: phase B day 3 — wire MVP v3 features (post-C1 hash bump)

Wire 21 new features into state-feature-extractor.ts:
  STATE_DIM 49 → 58 (+normal_summon_used + 2 engine-derived axis D + 6 axis E)
  ACTION_DIM 46 → 58 (+12 act_verb_* features incl. pendulum-summon)
  FEATURE_DIM 95 → 116

State additions:
  - normal_summon_used (slot 6) — reads state.normalSummonUsed[0],
    plumbed in c6e923b2.
  - hand_combo_potential_engine (slot 50) — engine-truth count of distinct
    hand cardIds offered at IDLECMD. Plumbed via FieldState.
    activatableHandCardCount, populated by adapter at SELECT_IDLECMD
    enumeration (helper countActivatableHandCardIds).
  - hand_dead_card_count_engine (slot 51) — derived as (hand size − above).
    Sidesteps parser-opacity (audit: 36% conditions opaque on snake-eye-yummy).

  - special_summons_this_turn_norm (slot 52) — own MSG_SPSUMMONING count
    this turn. Per-turn reset. Plumbed via InternalHandle.specialSummonsThisTurn.
  - effects_activated_this_turn_norm (slot 53) — sum of activationLog
    entries (already tracked, just exposed). Total effect activations.
  - distinct_cards_used_this_turn_norm (slot 54) — activationLog.size.
    Distinct cards with ≥1 activation this turn.
  - chain_resolutions_this_turn_norm (slot 55) — count of MSG_CHAIN_END
    events this turn. Heavy combo turns produce 5+; control turns 0-1.
  - cards_drawn_this_turn_norm (slot 56) — own MSG_DRAW totals this turn.

Axis E rationale: YGO is mana-less; combo strength = action density per
turn. These counters give the ranker direct access to "how much have I
done this turn" — the cumulative dimension missing from the per-action
verb features.

Action additions (YGO action-verb signature):
  Adapter-derived (verbs from OCGCore IDLECMD/BATTLECMD enum):
    - act_verb_normal_summon (Lv ≤ 4 direct, real starter signal)
    - act_verb_tribute_summon (Lv ≥ 5 tribute, almost always bad in combo)
    - act_verb_set_monster, act_verb_set_st,
      act_verb_summon_procedure, act_verb_activate, act_verb_attack
  Catalog-derived (verbs from card-effects-catalog v7 via verb-index.json):
    - act_verb_add_from_deck (24/114 = 21% catalog coverage)
    - act_verb_special_summon_effect (44/114 = 39%)
    - act_verb_destroy (22/114 = 19%)
    - act_verb_draw (7/114 = 6%)

Drops (audit-coverage-honest, sub-5% catalog coverage):
  add_from_gy, return_to_hand, banish, mill, discard*, tribute*,
  banish_self*, no_cost. Deferred to Sprint 3 if MVP v3 lifts held-out.

Also wires deferred slot 32-35 oppZones reads (plumbed b4142292) and
slot 5 → 6 reorder for normal_summon_used insertion. Single hash bump.

featureSpecHash bumped → existing trained weights non-portable
(intentional). C1 weights archived; MVP v3 retrains from scratch.
```

---

## What this does NOT do (deferred to next playbook)

- Does NOT wire connectivity features F14-F17 (axis D — `hand_combo_potential`, `act_unlocks_*`). Audit Q3 measured ~50% reliability ceiling on parser conditions; rejected from MVP.
- Does NOT wire interruption-enrichment features F25-F27 (axis G — diversity, redundancy, chain-speed distribution). Leakage risk per adversarial review; revisit only if MVP v3 falls short on held-out.
- Does NOT wire output-magnitude features F11-F13 (axis C). Defer to Sprint 3 once MVP v3 signal is measured.

These remain documented in `ygo-essence-feature-deep-dive-2026-04-26.md` but are NOT in the current sprint scope.

---

## Validation gate (re-stated for visibility)

After wiring + smoke test, run pre-flight training:

```
3 seeds × 30 generations × 4 fixtures (training: snake-eye-yummy, ...; held-out: branded-dracotail)
Same regime as Day 1.5 verdict (wall-clock-bound, NOT nb-bound — comparing apples to apples)
```

Pre-declared decision criterion (from "/decide MVP roadmap" 2026-04-26):
- **Continue Sprint 3** if median held-out matched ≥ +3 AND no seed in regression on control
- **Stop deep dive, pivot Phase 3** if median ∈ [-1, +2]
- **Stop, debug** if median ≤ -2

The regime change to nb-bound (per determinism-investigation memo) is held back for a separate experiment to keep the comparison clean.
