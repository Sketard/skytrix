# Phase 0 Inventory — Prompt Resolver Refactor

**Date:** 2026-05-01
**Owner:** Axel + Claude (collab)
**Companion to:** [prompt-resolver-refactor-2026-05-01.md](prompt-resolver-refactor-2026-05-01.md)
**Status:** DRAFT — awaits sign-off before Phase 1.

This inventory catalogues every branchement, decision point, mutation, and OCGCore-version dependency reachable from the two prompt-handling entry points the refactor will unify:

- **Track A** — `runUntilPlayerPrompt` and helpers in [duel-server/src/solver/ocgcore-adapter.ts](duel-server/src/solver/ocgcore-adapter.ts).
- **Track B** — main loop and helpers in [duel-server/scripts/replay-trajectory-cli.ts](duel-server/scripts/replay-trajectory-cli.ts).

Both audits were run in parallel (Phase 0 §"Next step" of the design doc). Sign-off gate per design doc Risk #1: **Axel reviews this file with the design doc open** and confirms every invariant maps to a future oracle (or an explicit "not in scope" note). Phase 3-4 bit-exact gates depend on completeness here.

> **Pre-merge cross-check notes** (additions/corrections found while merging the two tracks)
> 1. **Design-doc line numbers vs current source.** Doc cites `runUntilPlayerPrompt` at `:818-878`, `autoRespondMechanical` at `:1573-1672`, `autoRespondOpponent` at `:1571-1690`, CLI loop at `:487-650` etc. Track A places `runUntilPlayerPrompt` at `:701-882`, `autoRespondMechanical` at `:1571-1674`, `autoRespondOpponent` at `:1676-1692`. Track B confirms CLI loop has expanded to `:487-719`. Treat doc anchors as approximate; this inventory is the authoritative line-mapping for Phase 1 baseline.
> 2. **Memory note "matcher cardId-only zone-agnostic at replay-trajectory-cli.ts:760".** Confirmed: not a single-line matcher but the **scoring loop** at [replay-trajectory-cli.ts:745-764](duel-server/scripts/replay-trajectory-cli.ts#L745-L764) — `onFieldCardIds = Set<cardId>` accumulates across all SCORED_ZONES, then `expectedCardIds.filter(id => onFieldCardIds.has(id))`. Zone-agnostic by design (a card in M1 vs S1 both count as "matched"). **Out of scope for this refactor** (it's the result evaluator, not a prompt resolver) — log here for visibility only.
> 3. **`stoppedAtPlanStep` is a misnomer in raw mode** (Track B caveat). Field name reused for `rawIdx` in β-3. Not blocking; flag for a follow-up rename outside this refactor.

---

## Track A — `runUntilPlayerPrompt` audit

This document catalogues every branchement, decision point, mutation, and state surface in the prompt-handling flow of `OCGCoreAdapter`, mapping them to the architectural targets defined in the refactor design doc.

### Entry point: `runUntilPlayerPrompt` [ocgcore-adapter.ts:701-882](duel-server/src/solver/ocgcore-adapter.ts#L701-L882)

**Responsibility:** Loop over OCGCore message buffer until a player-prompt is reached (WAITING status) or engine terminates (END status). For each message:
- Track turn/phase changes via MESSAGE handlers (NEW_TURN, NEW_PHASE, SUMMONING, SPSUMMONING, CHAIN_END, DRAW, MOVE)
- Classify the waiting-state SELECT_* message into a PromptType
- Route to opponent auto-respond, mechanical auto-respond, or player-exploratory branching

**Entry condition:** Called by DFS after action application, or by external harnesses during plan-replay initialization.

**Exit condition:** Returns `Action[]` (non-empty = branches for player turn; empty = no selection needed), or throws on OCGCore WASM errors.

---

### Internal state surface: `InternalHandle` [ocgcore-adapter.ts:140-226](duel-server/src/solver/ocgcore-adapter.ts#L140-L226)

Every instance-level field and its mutation points:

| Field | Type | Mutation points | Cloned on fork? | Initialized | Reset trigger |
|-------|------|---|---|---|---|
| `id` | number | None (immutable) | No | create() | — |
| `nativeHandle` | OcgNativeHandle | None (immutable; shared on snapshot) | Snapshot: shared; Replay: new | create() | — |
| `actionHistory` | Action[] | push on applyAction (line 473) | Yes (spread `[...parent...]`) | create() as `[]` | — |
| `responseHistory` | unknown[] | push on autoRespond paths (820, 859) or applyAction (474) | Yes (spread) | create() as `[]` | — |
| `config` | DuelConfig | None (immutable reference) | Yes (same ref) | create() | — |
| `isActive` | boolean | set false on error (1978) or destroyInternal (1978) | No (always true on fork) | create() as true | error or destroy |
| `turn` | number | set on NEW_TURN msg (728) | Yes (cloned value) | create() as 1 | — |
| `phase` | Phase | set on NEW_PHASE msg (749) | Yes (cloned) | create() as 'MAIN1' | — |
| `activationLog` | Map<cardId, effectIndex[]> | clear on NEW_TURN (732), push on recordActivation (1916) | Yes (cloneActivationLog) | create() as `new Map` | NEW_TURN |
| `lastIdlecmdActivatableHandCount` | number \| undefined | set undefined at line 719 (entry), SET on line 873 (IDLECMD enum), undefined on non-IDLECMD exploratory | Yes (cloned) | create() as 0 (graph-ml-v2 F14) | every entry, every NEW_TURN (739), every non-IDLECMD exploratory |
| `normalSummonsByPlayer` | [boolean, boolean] | set on SUMMONING/FLIPSUMMONING msg (756), reset on NEW_TURN (736) | Yes (spread) | create() as `[false, false]` | NEW_TURN |
| `specialSummonsThisTurn` | [number, number] | increment on SPSUMMONING msg (761), reset on NEW_TURN (741) | Yes (spread) | create() as `[0, 0]` | NEW_TURN |
| `chainResolutionsThisTurn` | number | increment on CHAIN_END msg (765), reset on NEW_TURN (742) | Yes (cloned) | create() as 0 | NEW_TURN |
| `cardsDrawnThisTurn` | [number, number] | increment on DRAW msg (774), reset on NEW_TURN (743) | Yes (spread) | create() as `[0, 0]` | NEW_TURN |
| `cardsSearchedThisTurn` | [number, number] | increment on MOVE msg (deck→hand, line 791), reset on NEW_TURN (744) | Yes (spread) | create() as `[0, 0]` | NEW_TURN |
| `effectActivationsThisTurnAll` | number | increment on player-side `_isEffectActivation` action (1900), reset on NEW_TURN (745) | Yes (cloned) | create() as 0 | NEW_TURN |
| `distinctEffectCardsThisTurn` | Set<cardId> | add on player-side effect activation (1901), reset on NEW_TURN (746) | Yes (`new Set(...parent...)`) | create() as `new Set()` | NEW_TURN |
| `pendingMultiPick` | PendingMultiPick \| undefined | set in tryInteractiveMechanical (1327), cleared after commit/any duelSetResponse (1471) | No (trace-assist only) | create() as undefined | post-commit or any applyAction that reaches duelSetResponse |
| `isSnapshotChild` | boolean \| undefined | set on forkViaSnapshot (1776) | No | create() as undefined | — |

**Graph-ml-v2 critical fields (Phase B):**
- `lastIdlecmdActivatableHandCount` — F14 feature; populated only at SELECT_IDLECMD enum (line 873), must survive bit-exact (design doc Risk #1).
- `normalSummonsByPlayer` — 1/turn NS budget tracking (both NS and tribute summon).
- `specialSummonsThisTurn` — E-axis action-density counter.
- `chainResolutionsThisTurn` — E-axis chain activity.
- `cardsDrawnThisTurn` — E-axis random draw count.
- `cardsSearchedThisTurn` — E-axis tutor count (deck→hand only).
- `effectActivationsThisTurnAll` — E-axis unfiltered own-side effect activation count (distinct from `activationLog` which is tag-filtered).
- `distinctEffectCardsThisTurn` — E-axis card cardinality in activation.

---

### Branching layer: prompt classification and routing [ocgcore-adapter.ts:805-879](duel-server/src/solver/ocgcore-adapter.ts#L805-L879)

The runUntilPlayerPrompt main loop performs the following decision tree:

#### Layer 1: Opponent prompt detection (line 806)

**Trigger:** `(selectMsg.player as number) === OPPONENT`

**Branch A1: Adversarial SELECT_CHAIN (lines 810-816)**
- **Condition:** `config.handtraps?.length > 0` AND `promptType === 'SELECT_CHAIN'`
- **Behavior:** Enumerate opponent's chain links via `enumerateActionsWithResponses(msgAny, promptType, config)`, tag all actions with `team: 1` (opponent), return to DFS for minimax exploration
- **Mutations:** None to internal state; team tagging on returned actions only
- **Dependencies:** `enumerateActionsWithResponses` (via line 812); `config.handtraps` list
- **OCGCore version sensitivity:** SELECT_CHAIN message structure (selects[i] array + code/location/sequence fields)
- **Future oracle target:** `OpponentBranchingOracle` (design doc §1, line 149)

**Branch A2: All other opponent prompts (lines 817-821)**
- **Condition:** Opponent prompt but not adversarial SELECT_CHAIN
- **Behavior:** Auto-respond via `autoRespondOpponent(msgAny)` → `duelSetResponse()` → record in `responseHistory`
- **Mutations:** `responseHistory` += response
- **Dependencies:** `autoRespondOpponent` (goldfish defaults)
- **OCGCore version sensitivity:** Message type switch in autoRespondOpponent (lines 1679-1691)
- **Future oracle target:** Subsumed into `MechanicalDefaultOracle` (design doc §8, line 295)

#### Layer 2: Mechanical prompt classification (line 825)

**Trigger:** `promptType && !EXPLORATORY_PROMPTS.has(promptType)`

This filters for all SELECT_* except {SELECT_IDLECMD, SELECT_BATTLECMD, SELECT_CHAIN, SELECT_EFFECTYN, SELECT_YESNO, SELECT_OPTION}. The set is defined in solver-types.ts:90-97.

**Branch B1: Interactive multi-pick trace-assist (lines 830-833)**
- **Condition:** `exposeMultiPickMechanical === true` AND `tryInteractiveMechanical(msgAny, promptType, internal)` returns non-null
- **Behavior:** Enumerate multi-pick actions (SELECT_CARD min>1, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD, or SELECT_PLACE count=1 with choice), accumulate picks in `internal.pendingMultiPick`, return action list
- **Mutations:**
  - `internal.pendingMultiPick` = new PendingMultiPick (or mutated on subsequent re-entries via applyAction partial-pick path)
  - `_lastActionResponses` cache cleared and repopulated
- **Dependencies:** `exposeMultiPickMechanical` flag (default false, set only by trace-assist); `tryInteractiveMechanical` (lines 1257-1337)
- **OCGCore version sensitivity:** Message type enums and field structure (selects[], min/max, field_mask for SELECT_PLACE)
- **Future oracle target:** Not directly mapped to an oracle in design doc; this is a CLI/trace-assist feature orthogonal to the PromptResolver chain

**Branch B2a: Small-pool SELECT_CARD exploratory (lines 845-848)**
- **Condition:** `promptType === 'SELECT_CARD'` AND `selectCardIsExploratory(msgAny)` returns true
  - Sub-conditions (all must pass):
    - min === 1 AND max === 1 (single-pick only)
    - selects.length > 0 AND selects.length ≤ SELECT_CARD_EXPLORATORY_MAX (currently 6, line 894)
- **Behavior:** Enumerate each candidate as an action via `enumerateActionsWithResponses(msgAny, 'SELECT_CARD', config)`, return branches to DFS
- **Mutations:** `_lastActionResponses` cache populated
- **Dependencies:** `SELECT_CARD_EXPLORATORY_MAX` constant (894)
- **OCGCore version sensitivity:** SELECT_CARD message selects[] array structure
- **Future oracle target:** Sub-case of `BranchingOracle` SelectCardSmallPool rule (design doc §6, line 251)

**Branch B2b: Large-pool SELECT_CARD with preferred targets (lines 853-856)**
- **Condition:** `promptType === 'SELECT_CARD'` AND `selectCardIsPreferredExploratory(msgAny, config)` returns true
  - Sub-conditions (all must pass):
    - min === 1 AND max === 1
    - selects.length > SELECT_CARD_EXPLORATORY_MAX
    - DECK-only location (all `selects[i].location === OcgLocation.DECK`)
    - `config.preferredSearchTargets` exists and has at least 1 match in pool
- **Behavior:** Enumerate up to SELECT_CARD_PREFERRED_EXPOSURE_K (currently 4, line 906) preferred matches + OCG-index-0 fallback via `enumeratePreferredSelectCard(msgAny, config)`, return branches
- **Mutations:** `_lastActionResponses` cache populated
- **Dependencies:** `preferredSearchTargets` from config (solver-types.ts:35); `SELECT_CARD_PREFERRED_EXPOSURE_K` constant (906); gate checks `location === OcgLocation.DECK`
- **OCGCore version sensitivity:** Same as B2a
- **Future oracle target:** Sub-case of `BranchingOracle` SelectCardPreferredLargePool rule (design doc §6, line 253)

**Branch B3: Mechanical auto-respond (lines 857-860)**
- **Condition:** Mechanical prompt that did not match B1, B2a, or B2b above
- **Behavior:** Auto-respond via `autoRespondMechanical(msgAny, config)` → `duelSetResponse()` → record response
- **Mutations:** `responseHistory` += response
- **Dependencies:** `autoRespondMechanical` switch (lines 1571-1674)
- **OCGCore version sensitivity:** All message types in the switch; see §MechanicalDefault layer below
- **Future oracle target:** Majority routed to `MechanicalDefaultOracle`; some may be promoted to interactive via flags

#### Layer 3: Exploratory prompt for player (lines 864-876)

**Trigger:** Player prompt (not opponent) AND prompt type is exploratory

**Branch C1: SELECT_IDLECMD enumeration with F14 feature extraction (lines 864-875)**
- **Condition:** `promptType` is set (passed MESSAGE_TO_PROMPT) AND is in EXPLORATORY_PROMPTS
- **Behavior:** Enumerate legal actions via `enumerateActionsWithResponses(msgAny, promptType, config)`, return to DFS
- **Special handling for SELECT_IDLECMD:** Compute `countActivatableHandCardIds(actions)` and store in `internal.lastIdlecmdActivatableHandCount` (line 873)
  - **F14 feature:** Number of distinct hand cardIds for which the engine enumerated at least one action slot (NS, tribute summon, special summon, set, activate). Engine-derived, not parser-based. Must survive bit-exact (design doc Risk #1).
  - Other exploratory prompts (BATTLECMD, CHAIN, EFFECTYN, YESNO, OPTION) leave it undefined so the feature extractor reads no signal.
- **Mutations:** `_lastActionResponses` cache cleared and populated; `internal.lastIdlecmdActivatableHandCount` populated iff SELECT_IDLECMD
- **Dependencies:** `enumerateActionsWithResponses` (lines 991-1180); `countActivatableHandCardIds` (lines 73-81)
- **OCGCore version sensitivity:** Prompt message structure varies per PromptType; SELECT_IDLECMD has summons[], special_summons[], pos_changes[], monster_sets[], spell_sets[], activates[], to_bp, to_ep fields
- **Future oracle target:** Majority routed to `BranchingOracle` in DFS mode; opponent SELECT_CHAIN routed through `OpponentBranchingOracle`

---

### Mechanical default layer: `autoRespondMechanical` [ocgcore-adapter.ts:1571-1674](duel-server/src/solver/ocgcore-adapter.ts#L1571-L1674)

Exhaustive switch over all non-exploratory OCG message types currently handled by the adapter.

**Coverage discipline:** Every case listed here is a verbatim migration from the current adapter. Cases **not** listed (ANNOUNCE_RACE, ANNOUNCE_CARD, ANNOUNCE_ATTRIB, SORT_CARD, SORT_CHAIN, ROCK_PAPER_SCISSORS) remain unhandled and throw `solverAssert(false, ...)` (design doc §8, Risk #5).

| Message type | Line | Trigger | Default behavior | Mutations | OCGCore sensitivity |
|---|---|---|---|---|---|
| SELECT_POSITION | 1574-1575 | Position change for a monster | Return `{type:11, position:FACEUP_ATTACK}` | None | OcgPosition enum |
| SELECT_PLACE | 1576-1577 | Summon zone selection | Decode field_mask, return all available places | None | field_mask bitfield encoding (7 bits MZONE 0-6) |
| SELECT_DISFIELD | 1578-1579 | Dispel/Destroy target zone | Decode field_mask, return all places | None | field_mask |
| SELECT_TRIBUTE | 1580-1581 | Select tributes for summon | Return first min indices: `{type:12, indicies:[0, 1, ...]}` | None | min field |
| SELECT_SUM | 1582-1583 | Cumulative effect (e.g., ritual material sum) | Return first min indices: `{type:14, indicies:[0, 1, ...]}` | None | min field |
| SELECT_COUNTER | 1584-1585 | Distribute counters | Map all cards to 0 counters: `{type:13, counters:[0, 0, ...]}` | None | cards[] array |
| SELECT_CARD | 1586-1639 | Select from pool (single or multi-pick, deck or mixed) | **Priority-order preferred-targets logic** (Phase G-iv, lines 1603-1637): iterate `config.preferredSearchTargets` in declaration order, match first min entries against pool by cardId, top up with OCG-index-first if insufficient matches. Gate: allFromDeck (all candidates locate in DECK). Returns `{type:5, indicies:[i, j, ...]}` | None (read-only on config) | Requires `selects[i].code` and `selects[i].location` fields; location === OcgLocation.DECK gate (1602-1603) |
| SELECT_UNSELECT_CARD | 1640-1642 | Toggle multi-select cards in/out | If `can_finish` is true, return null-index (commit); else return 0 (auto-pick first). `{type:7, index:<null or 0>}` | None | can_finish field |
| ANNOUNCE_NUMBER | 1643-1661 | Lance Soldier level-up or similar numeric announcement | **Phase G-v default:** pick index of LAST option (max announced value), rationale: enables higher-rank Xyz/Synchro downstream. Returns `{type:19, value:<index>}` | Debug console log if SOLVER_DEBUG_ANNOUNCE=1 | Requires options[] array in msg; index semantics: 0-based array index, **not the value itself** (critical, duel-worker.ts:947 consistency) |
| Default (unhandled) | 1662-1672 | Any message type not matched above (e.g., future OCGCore upgrades, ANNOUNCE_RACE, SORT_*, RPS) | `solverAssert(false, ...)` throws in dev; prod fallback: `{type:4, index:0}` (SELECT_OPTION first choice) | None | Critical: this is a latent upgrade risk; any new message type from OCGCore will silently default to first-choice without warning in prod |

**Unhandled message types (still throw):**
- ANNOUNCE_RACE — no fixture validates a default
- ANNOUNCE_CARD — no fixture validates a default
- ANNOUNCE_ATTRIB — no fixture validates a default
- SORT_CARD — no fixture validates a default
- SORT_CHAIN — no fixture validates a default
- ROCK_PAPER_SCISSORS — no fixture validates a default

See design doc §8 "Coverage discipline" (lines 282-291): "ANNOUNCE_RACE / ANNOUNCE_CARD / ANNOUNCE_ATTRIB / SORT_CARD / SORT_CHAIN / RPS keep their current `solverAssert(false, ...)` throw unless a fixture exercises them and validates the chosen default."

---

### Opponent layer: `autoRespondOpponent` [ocgcore-adapter.ts:1676-1692](duel-server/src/solver/ocgcore-adapter.ts#L1676-L1692)

Goldfish auto-respond for opponent turns. Fallback path for all opponent prompts not matched by adversarial SELECT_CHAIN branching.

| Message type | Behavior | Rationale |
|---|---|---|
| SELECT_IDLECMD | Return `{type:1, action:7 (to_ep)}` if `to_ep` available; else `{type:1, action:6 (to_bp)}` | Skip opponent turn immediately; no strategy |
| SELECT_BATTLECMD | Return `{type:0, action:3 (to_ep)}` if `to_ep` available; else `{type:0, action:2 (to_m2)}` | Skip battle; no attacks |
| SELECT_CHAIN | Return `{type:8, index:null}` | Decline to chain (pass-action) |
| SELECT_EFFECTYN | Return `{type:2, yes:true}` | Always activate (yes) |
| SELECT_YESNO | Return `{type:3, yes:false}` | Always decline (no) — defaults to "don't accept" semantics |
| Default | Delegate to `autoRespondMechanical(msg)` | Fallback for SELECT_POSITION, SELECT_PLACE, SELECT_CARD, etc. |

**Mutations:** `responseHistory` += response (line 820, on auto-respond path)

**Dependencies:** `autoRespondMechanical` for any unmatched type

**Future oracle target:** Subsumed into `MechanicalDefaultOracle` with opponent sub-case switch (design doc §8, line 295: "Includes: autoRespondOpponent cases (sub-branch on team if needed)")

---

### Interactive multi-pick layer: `tryInteractiveMechanical` [ocgcore-adapter.ts:1257-1337](duel-server/src/solver/ocgcore-adapter.ts#L1257-L1337)

**Condition:** Flag `exposeMultiPickMechanical === true` (default false, trace-assist only)

**Dispatch logic:**

1. **SELECT_UNSELECT_CARD (lines 1266-1268):** Enumerate each card in `select_cards` and `unselect_cards`, plus "finish" action if `can_finish` is true (via `enumerateUnselectCard`, lines 1418-1464)

2. **SELECT_PLACE count=1 (lines 1277-1296):** Enumerate available player-side zones when EMZ available OR 2-4 main-zone slots free (placement choice matters for Link targeting). Otherwise auto-resolve.

3. **SELECT_CARD large pool (lines 1303-1308):** Enumerate ALL candidates (overriding the preferredSearchTargets heuristic) via `enumerateSinglePickSelectCard` (lines 1387-1405)

4. **Atomic multi-pick (lines 1312-1336):** For SELECT_CARD min>1, SELECT_TRIBUTE, SELECT_SUM: allocate `internal.pendingMultiPick` state and call `enumerateMultiPickAtomic` (lines 1472-1536). Returns "add-pick", "undo-last-pick", and "commit" actions. Partial picks mutate `pendingMultiPick.picks[]` array; commit sends batched `{type:5|12|14, indicies:[...]}` response.

**All paths return `null`** if not applicable, causing caller to fall through to mechanical default.

**Mutations:**
- `internal.pendingMultiPick` allocated or mutated
- `_lastActionResponses` cleared and repopulated

**Dependencies:** Multi-pick sub-enumerators (`enumerateUnselectCard`, `enumerateSelectPlace`, `enumerateSinglePickSelectCard`, `enumerateMultiPickAtomic`)

**Future oracle target:** Not mapped to a single oracle; this is a CLI/trace-assist feature orthogonal to PromptResolver design. Present mention: design doc §6 (line 254) notes `exposeMultiPickMechanical` as a DFS flag in the BranchingOracle MultiPickInteractive sub-rule.

---

### Exploratory enumeration: `enumerateActionsWithResponses` [ocgcore-adapter.ts:991-1180](duel-server/src/solver/ocgcore-adapter.ts#L991-L1180)

Central dispatcher for converting OCG prompts into `Action[]` for DFS branching. Every prompt type has a switch case that extracts candidate options from the message, derives metadata (cardId, sourceZone, actionVerb, _isEffectActivation), and pushes an Action with a cached OCGCore response.

**Entry:** Called from runUntilPlayerPrompt (lines 812, 847, 856, 865) with msg, promptType, config.

**Exit:** Returns Action[] (may be empty if no candidates present).

#### SELECT_IDLECMD (lines 1019-1082)

- **Candidates:** summons[], special_summons[], pos_changes[], monster_sets[], spell_sets[], activates[], to_bp, to_ep
- **Derivations:**
  - **summons[i]:** split by level (1-4 = normal-summon, 5+ = tribute-summon) via card metadata lookup (line 1031)
  - **special_summons[i]:** detect Pendulum Summon via location PZONE or SZONE seq 0/4 (lines 1048-1050)
  - **activates[i]:** set `_isEffectActivation = isFieldActivation(location)` to filter out Synchro/Xyz/Link summon EXTRA activations (not real interruptions)
- **Response:** `{type:1, action:<0-7>}` indexed by summon array position

#### SELECT_BATTLECMD (lines 1083-1107)

- **Candidates:** attacks[], chains[], to_m2, to_ep
- **Derivations:**
  - **chains[i]:** set `_isEffectActivation = isFieldActivation(location)`
- **Response:** `{type:0, action:<0-3>}`

#### SELECT_CHAIN (lines 1108-1123)

- **Candidates:** selects[] chain links + optional pass (if !forced)
- **Derivations:**
  - Decode description (bigint → card code + string index lookup)
  - Set `_isEffectActivation = isFieldActivation(location)`
- **Response:** `{type:8, index:<i or null>}`

#### SELECT_EFFECTYN (lines 1124-1131)

- **Candidates:** two fixed responses (no, yes)
- **Derivations:** responseIndex=1 (yes) sets `_isEffectActivation=true`; responseIndex=0 (no) leaves it false
- **Response:** `{type:2, yes:<boolean>}`

#### SELECT_YESNO (lines 1132-1136)

- **Candidates:** two fixed responses (no, yes)
- **Derivations:** No special flags
- **Response:** `{type:3, yes:<boolean>}`

#### SELECT_OPTION (lines 1137-1143)

- **Candidates:** options[] array
- **Derivations:** None
- **Response:** `{type:4, index:<i>}`

#### SELECT_CARD (lines 1144-1176)

- **Candidates:** selects[] candidates
- **Derivations:** Order preference: preferred-first, then OCG-index order (via preferredSearchTargets config)
- **Response:** `{type:5, indicies:[<single-pick index>]}`

#### SELECT_CARD preferred exploratory (`enumeratePreferredSelectCard`, lines 1192-1245)

- **Candidates:** up to SELECT_CARD_PREFERRED_EXPOSURE_K (4) preferred matches + OCG-index-0 fallback
- **Derivations:** Iterate `config.preferredSearchTargets` in order, match against pool by cardId, collect distinct indices, append index 0 if not already matched
- **Rationale:** Phase M.2 fallback ensures OCG-index-0 remains reachable even when preferred targets are populated (avoids Phase M.1 D/D/D regression where baseline relied on Clovis fusion material at index 0)
- **Response:** `{type:5, indicies:[<single matched index>]}`

**Response caching:** After each action push, store response in:
1. `action._response` (survives DFS recursion/replay)
2. `_lastActionResponses.set(responseIndex, response)` (adapter-level cache for the current prompt)

---

### OCGCore version dependencies and message field sensitivities

Every enumeration case above depends on specific OCG message field names and value encodings. The following are critical upgrade risks (design doc Risk #3):

| Prompt type | Critical fields | P3/P4/P5/P6/P7 risk |
|---|---|---|
| SELECT_IDLECMD | summons[i].code, special_summons[i].location/sequence, activates[i].location, to_bp, to_ep | **P5+:** Pendulum summon detection relies on SZONE seq 0/4 or PZONE; MR4→MR5 boundary changes location semantics; **P6+:** unknown |
| SELECT_BATTLECMD | attacks[i].code, chains[i].location/sequence, to_m2, to_ep | **P6+:** location encoding unknown |
| SELECT_CHAIN | selects[i].code / description / location / sequence, forced | **P3+:** description bigint encoding (card code << 20 + strIndex) is engine-dependent |
| SELECT_EFFECTYN | code | None (stable field) |
| SELECT_YESNO | None | None (protocol stable) |
| SELECT_OPTION | options[] | None |
| SELECT_CARD | selects[i].code / location / min / max | **All:** location field semantics (DECK vs GY vs FIELD); **P3+:** unknown |
| SELECT_POSITION | None | None |
| SELECT_PLACE | field_mask, count | **All:** bitfield encoding (7 bits for MZONE seq 0-6, 5 bits for SZONE seq 0-4, 1 bit for FZONE) |
| SELECT_TRIBUTE / SELECT_SUM | selects[i], min / max / amount | **SELECT_SUM:** amount field semantics; **SELECT_TRIBUTE wire:** P6 patch added `release_param` (commit 1dcebeef in current branch) — propagated; verify resolver-time consumers |
| SELECT_COUNTER | cards[] | None |
| SELECT_UNSELECT_CARD | select_cards[] / unselect_cards[] / can_finish | **All:** array structure semantics |
| ANNOUNCE_NUMBER | options[] | **All:** value vs index semantics (critical: duel-worker.ts:947 converts client value → idx via indexOf) |
| NEW_TURN | turn_count | None |
| SUMMONING / FLIPSUMMONING / SPSUMMONING | controller | None |
| CHAIN_END | None | None |
| DRAW | drawn[] | None |
| MOVE | from.location / from.controller / to.location / to.controller | None |

---

### Action metadata derivation

Every Action returned by `enumerateActionsWithResponses` carries the following metadata populated by `pushAction` helper (lines 997-1009):

| Field | Source | Mutation point | Semantics |
|---|---|---|---|
| `responseIndex` | Loop counter (idx) | None | Index into OCGCore response (varies per prompt: array index, -1 for pass, etc.) |
| `cardId` | msg candidate code | None | Card code from the pool (0 for pass-actions, transitions, phase-changes) |
| `promptType` | Argument | None | Copied from function parameter |
| `isExploratory` | Constant true | None | Always set (distinguishes from mechanical paths) |
| `description` | Optional, prompt-specific | None | Human-readable label for UI/logging |
| `actionTag` | String enum (see below) | Line 1003-1006: auto-derived from `ACTION_TAG_TO_VERB` map, populating `actionVerb` if not already set | YGO-vocabulary classification for ranker features |
| `_response` | Cached OCGCore response | Line 998 | Survives DFS fork/replay; converted back via `actionToResponse` |
| `_isEffectActivation` | Derived in switch cases | Line 1071, 1096, 1115, 1129 | True iff action represents a real effect activation (not summon proc, not NS, not set, not attack, not phase-change); used by `recordActivation` to populate per-turn activation counters |
| `sourceZone` | Derived from location/sequence | Line 1072, 1098, 1116 | ZoneId ('HAND', 'MZONE', 'SZONE', 'EXTRA', 'GY', 'BANISHED', 'DECK', 'M1-M5', 'EMZ_L', 'EMZ_R', 'S1-S5', 'FIELD') via `ocgLocationToZoneId`; used by ranker's act_src_in_* features |
| `team` | Set in line 814 (opponent SELECT_CHAIN) | None | 0 (default/player) or 1 (opponent adversarial); controls minimax branching |

**`actionTag` values:** `'summon'`, `'ss'`, `'psummon'`, `'mset'`, `'sset'`, `'pos'`, `'activate'`, `'chain'`, `'attack'`, `'to_bp'`, `'to_m2'`, `'to_ep'`, `'pass'`, `'pick'`, `'place'`, `'unselect-pick'`, `'unselect-drop'`, `'unselect-finish'`, `'multi-pick-add'`, `'multi-pick-undo'`, `'multi-pick-commit'`.

---

### F14 plumbing: `lastIdlecmdActivatableHandCount` (graph-ml-v2 feature extraction)

**Definition:** The number of distinct hand cardIds for which the OCGCore engine offered at least one action slot in the most recent SELECT_IDLECMD enumeration.

**Lifecycle:**
1. **Cleared (undefined):**
   - Start of `runUntilPlayerPrompt` (line 719)
   - On every NEW_TURN message (line 739)
   - On every non-IDLECMD exploratory prompt (implicit: not set for BATTLECMD, CHAIN, EFFECTYN, YESNO, OPTION)
2. **Populated:**
   - At SELECT_IDLECMD enumeration (line 873) via `countActivatableHandCardIds(actions)`
3. **Cloned:** On both fork paths (snapshot line 1769, replay line 1860)

**Computation:** `countActivatableHandCardIds` (lines 73-81) iterates the enumerated actions, accumulates cardIds from actions with `sourceZone === 'HAND'` and `cardId !== 0` into a Set, returns cardinality.

**Feature extraction:** Via `queryFieldState` (line 1709, line 1713 returns the value as `activatableHandCardCount`) → FieldState surface → passed to ranker features.

**Critical invariant (design doc Risk #1):** This counter represents engine-derived potential (OCGCore already evaluated all effect activation conditions); it must survive **bit-exact** across refactoring because it is part of the graph-ml-v2 feature vector used in MCTS scoring. Any off-by-one or divergence in Hand card enumeration will cause Phase 3 bit-exact gate failure. The PromptResolver post-resolve hook in design doc §6 (line 260) is the contractual home for this side-effect.

---

### Adversarial branching: opponent SELECT_CHAIN enumeration (lines 806-816)

**Context:** Handtrap research mode. When `config.handtraps` is configured (non-empty array), opponent SELECT_CHAIN prompts are enumerated and returned as branched actions (team:1) so the minimax solver can explore opponent handtrap activation timing.

**Trigger:** `(selectMsg.player === OPPONENT) && isAdversarial && (promptType === 'SELECT_CHAIN')`
- isAdversarial: `(internal.config.handtraps?.length ?? 0) > 0` (line 810)

**Behavior:**
- Enumerate all opponent chain links via `enumerateActionsWithResponses(msgAny, 'SELECT_CHAIN', config)`
- Tag each action with `team: 1` (line 814)
- Return to DFS

**Mutations:** None to internal state; actions tagged for minimax routing

**Dependencies:** `config.handtraps` list (not consumed in enumeration itself, just checked for presence)

**OCGCore sensitivity:** SELECT_CHAIN message structure (same as player-side SELECT_CHAIN)

**Future oracle target:** `OpponentBranchingOracle` (design doc §1, line 143)

---

### Artifact: `pendingMultiPick` state and trace-assist protocol

**Scope:** Trace-assist feature only (flag `exposeMultiPickMechanical`, default false).

**Lifecycle:**
1. **Allocated:** In `tryInteractiveMechanical` for multi-pick prompts (line 1327)
2. **Mutated:**
   - In `applyAction` for 'multi-pick-add' actions: `pending.picks.push(index)` (line 444)
   - In `applyAction` for 'multi-pick-undo' actions: `pending.picks.pop()` (line 453)
3. **Cleared:**
   - In `applyAction` after 'multi-pick-commit' or any other action (line 1471)
   - On re-entry from partial-pick state: enumeration recaches message and re-enumerates (line 706)

**Data structure (PendingMultiPick, lines 216-226):**
```ts
{
  promptType: 'SELECT_CARD' | 'SELECT_TRIBUTE' | 'SELECT_SUM';
  responseType: 5 | 12 | 14;  // OCGCore message type
  min: number;
  max: number;
  picks: number[];                          // accumulated OCG-indices selected so far
  targetSum?: number;                       // SELECT_SUM only
  cachedMsg: Record<string, unknown>;       // source message (OCG drains buffer)
}
```

**Critical invariant:** Partial picks must not escape applyAction — every 'multi-pick-add' / 'multi-pick-undo' call mutates internal state only; no duelSetResponse is sent until 'multi-pick-commit'. This ensures consistency with DFS's action-history-based replay.

**Future oracle target:** Not present in design doc PromptResolver chain; this is a CLI/tracing feature outside the main refactor scope.

---

### Response history and action history tracking

**`actionHistory`:** Append-only log of Action objects applied via `applyAction` (line 473). Includes all actions (exploratory, mechanical, partial picks, commits).

**`responseHistory`:** Append-only log of OCGCore response objects sent via `duelSetResponse`. Excludes partial picks (which don't call duelSetResponse).
- Populated on: line 820 (opponent auto-respond), line 859 (mechanical auto-respond), line 474 (applyAction successful commit)

**Cloning on fork:** Both spread-cloned on every fork (lines 1761, 1844), ensuring child duels have independent histories.

**Usage:** `responseHistory` is consumed by `forkViaReplay` (line 1822) to reconstruct engine state without WASM snapshot.

---

### Helpers and dependencies

| Helper | Lines | Purpose | Mutations |
|---|---|---|---|
| `countActivatableHandCardIds` | 73-81 | Derive F14 feature from enumerated actions | None (read-only) |
| `ocgLocationToZoneId` | 26-55 | Map OCG location+sequence to ZoneId | None |
| `selectCardIsExploratory` | 912-920 | Gate for small-pool SELECT_CARD branching | None |
| `selectCardIsPreferredExploratory` | 934-948 | Gate for large-pool SELECT_CARD with preferred matches | None |
| `enumerateActionsWithResponses` | 991-1180 | Enumerate exploratory actions for any prompt type | `_lastActionResponses` cache |
| `enumeratePreferredSelectCard` | 1192-1245 | Enumerate top-K preferred matches + fallback | `_lastActionResponses` cache |
| `tryInteractiveMechanical` | 1257-1337 | Dispatch multi-pick trace-assist (returns null if not applicable) | `internal.pendingMultiPick`, `_lastActionResponses` cache |
| `enumerateUnselectCard` | 1418-1464 | Enumerate SELECT_UNSELECT_CARD actions | `_lastActionResponses` cache |
| `enumerateSelectPlace` | 1344-1381 | Enumerate SELECT_PLACE actions (summon zones) | `_lastActionResponses` cache |
| `enumerateSinglePickSelectCard` | 1387-1405 | Enumerate all SELECT_CARD candidates (trace-assist override) | `_lastActionResponses` cache |
| `enumerateMultiPickAtomic` | 1472-1536 | Enumerate "add/undo/commit" actions for multi-pick state | `_lastActionResponses` cache |
| `canCommitMultiPick` | 1543-1556 | Gate for "commit" action in multi-pick | None |
| `autoRespondMechanical` | 1571-1674 | Switch over all mechanical prompt types → OCGCore response | None (read-only on config) |
| `autoRespondOpponent` | 1676-1692 | Goldfish defaults for opponent prompts | None |
| `queryFieldState` | 1698-1737 | Assemble FieldState snapshot from internal counters | None (read-only) |
| `applyAction` → `_applyActionImpl` | 427-480 | Send OCGCore response, record in histories, track activations | `actionHistory`, `responseHistory`, `pendingMultiPick`, `activationLog`, `effectActivationsThisTurnAll`, `distinctEffectCardsThisTurn` |
| `recordActivation` | 1883-1918 | Update per-turn activation counters and OPT log | `effectActivationsThisTurnAll`, `distinctEffectCardsThisTurn`, `activationLog` |
| `fork` → `forkViaSnapshot` or `forkViaReplay` | 482-496 / 1751-1782 / 1815-1870 | Clone handle state for DFS branching | Copy all internal state fields |
| `restoreTopSnapshot` | 1787-1809 | Restore WASM memory after snapshot child destroyed | WASM memory buffer |

---

### Config-driven branching

| Config field | Usage sites | Effect on branching |
|---|---|---|
| `handtraps?: HandtrapConfig[]` | Line 810 (isAdversarial gate) | Enables opponent SELECT_CHAIN branching in adversarial mode |
| `preferredSearchTargets?: number[]` | Lines 943, 1154, 1200, 1600, 1620 | Gates and prioritizes SELECT_CARD branches (mechanical and exploratory) |
| `startingDrawCount?: number` | Not in ocgcore-adapter; passed to createNativeDuel | Affects initial hand size (not decision-branching relevant) |
| `drawCountPerTurn?: number` | Not in ocgcore-adapter; passed to createNativeDuel | Affects turn-to-turn hand growth (not decision-branching relevant) |

---

### Summary table: all decision points and mutation sites (Track A)

| Location | Prompt type | Trigger | Decision | Mutations | Oracle target |
|---|---|---|---|---|---|
| 810-816 | SELECT_CHAIN, opponent | `handtraps.length > 0` | Branching vs goldfish | None to state | OpponentBranchingOracle |
| 818-821 | opponent any | not adversarial SELECT_CHAIN | Auto-respond | responseHistory | MechanicalDefaultOracle |
| 830-833 | SELECT_CARD, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD | `exposeMultiPickMechanical` true | Interactive vs mechanical | `pendingMultiPick` | (trace-assist, not oracle) |
| 845-848 | SELECT_CARD | pool ≤ 6, single-pick | Branching vs mechanical | `_lastActionResponses` | BranchingOracle.SelectCardSmallPool |
| 853-856 | SELECT_CARD | pool > 6, preferred matches, DECK-only, single-pick | Branching vs mechanical | `_lastActionResponses` | BranchingOracle.SelectCardPreferredLargePool |
| 857-860 | mechanical (non-SELECT_CARD) | all mechanical prompts | Auto-respond | responseHistory | MechanicalDefaultOracle |
| 864-875 | exploratory (IDLECMD, BATTLECMD, CHAIN, etc.) | player, exploratory | Branching | `_lastActionResponses`, `lastIdlecmdActivatableHandCount` | BranchingOracle, OpponentBranchingOracle |
| 873 | SELECT_IDLECMD | N/A | Compute F14 | `lastIdlecmdActivatableHandCount` | (post-resolve hook) |

---

### Track A — Invariants flagged by design doc (Risk #1, #5)

1. **F14 plumbing (`lastIdlecmdActivatableHandCount`):** Must survive bit-exact. Populated only at SELECT_IDLECMD enumeration via engine-derived hand card counting. Cleared on NEW_TURN and non-IDLECMD prompts.

2. **Adversarial branching (opponent SELECT_CHAIN):** When handtraps configured, opponent SELECT_CHAIN is enumerated and returned as `team:1` actions for minimax exploration. All opponent prompts must continue to route through `autoRespondOpponent` (goldfish) for handtrap-less config.

3. **Opponent goldfish path (`autoRespondOpponent`):** Every opponent prompt not matched by adversarial SELECT_CHAIN must auto-respond via goldfish defaults (end turn, decline chains, etc.). No strategic opponent decision-making in current design.

4. **Internal counter surface (axis E graph-ml-v2):**
   - `normalSummonsByPlayer` — 1/turn NS budget
   - `specialSummonsThisTurn` — special summon count
   - `chainResolutionsThisTurn` — chain resolution count
   - `cardsDrawnThisTurn` — random card draw count
   - `cardsSearchedThisTurn` — tutor (deck→hand) count
   - `effectActivationsThisTurnAll` — unfiltered own-side effect activation count
   - `distinctEffectCardsThisTurn` — distinct card cardinality in activation
   All reset on NEW_TURN; all cloned on fork.

5. **`exposeMultiPickMechanical` flag:** Trace-assist feature (default false). When true, multi-pick mechanical prompts (SELECT_CARD min>1, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD) are surfaced as interactive branches with `pendingMultiPick` state accumulation. Production DFS keeps false.

6. **`tryInteractiveMechanical` integration:** Returns null for non-applicable prompts, falling through to mechanical default. Partial picks (multi-pick-add, multi-pick-undo) mutate internal state without duelSetResponse; commits send batched response.

7. **`enumerateActionsWithResponses` / `enumeratePreferredSelectCard` / `SELECT_CARD_EXPLORATORY_MAX`:** Small-pool SELECT_CARD (≤6 candidates, single-pick) is branched; large-pool with preferred matches (>6, top-K=4 matches) is branched; others auto-resolve via `preferredSearchTargets` priority order.

8. **`preferredSearchTargets` priority order:** Phase G-iv: iterate preferred list in declaration order, pick first min matches, top up with OCG-index-first. Critical for multi-step combos where different prompts need different targets (Gate → Doom Queen Mach → Count Surveyor, etc.).

9. **`solverAssert(false)` sites in `autoRespondMechanical`:** Lines 1666-1671 — unhandled message type throws in dev, prod fallback `{type:4, index:0}`. ANNOUNCE_RACE, ANNOUNCE_CARD, ANNOUNCE_ATTRIB, SORT_CARD, SORT_CHAIN, RPS remain unhandled (no fixture validates a default).

10. **ANNOUNCE_NUMBER semantics (critical):** Response index is the array index of the chosen option (0-based), NOT the option value itself. Defaults to max (last index). Consistent with duel-worker.ts:947 `lastAnnounceNumberOptions.indexOf` conversion.

---

## Track B — `replay-trajectory-cli.ts` audit

The `replay-trajectory-cli.ts` file (804 lines) implements the β-1 (plan-based) and β-3 (raw trajectory) replay modes for Path β subagents. The main loop ([replay-trajectory-cli.ts:487-719](duel-server/scripts/replay-trajectory-cli.ts#L487-L719)) branches on `rawMode`, consuming either `PlanStep[]` or `RawTrajectoryStep[]` in lockstep with OCGCore prompts, mutating stateful queues and counters at every decision point. The current design spreads decisions across **two parallel pathways** with subtly different invariants:

- **β-1 (plan-based):** SELECT_IDLECMD → consume plan step (cardName/verb match), load targets/chainTargets, sub-prompts → consume from pending queues or auto-pick.
- **β-3 (raw trajectory):** SELECT_IDLECMD (and all prompts) → consume raw step (responseIndex + cardId exact match), strategic divergence on SELECT_IDLECMD no-match only.

Both flows share sub-prompt resolution logic, but the plan mode layering of targets/chainTargets and the raw mode's responseIndex-exact contract are structurally distinct.

---

### Main loop entry [replay-trajectory-cli.ts:487-719](duel-server/scripts/replay-trajectory-cli.ts#L487-L719)

**Trigger:** Sequential polling via `while (stepCount < args.maxIterations)`. At each iteration:
1. Fetch `legal = adapter.getLegalActions(handle)`.
2. Extract `promptType = legal[0].promptType`.
3. Branch on `rawMode` (inferred at startup from input file shape).

**Mutations per iteration:**
- `stepCount++` (line 712)
- `replayLog.push({...})` (line 702)
- Conditional mutations vary by mode and sub-branch (see below).

**Stop conditions:**
- `legal.length === 0` (engine halted, lines 489-491)
- Divergence (plan/raw no-match at strategic, lines 563-573, 523-532)
- Plan/raw exhausted AND `endTurn === false` (lines 611, 554)
- `endPhaseAttempts > MAX_END_PHASE_ATTEMPTS` (50, lines 603-607, 540-543)
- `stepCount >= args.maxIterations` (safety ceiling, line 720)
- Exception thrown (lines 724-728)

---

### β-1 plan consumption [replay-trajectory-cli.ts:557-612](duel-server/scripts/replay-trajectory-cli.ts#L557-L612)

#### SELECT_IDLECMD plan step matching (lines 558-612)

**Trigger:** `promptType === 'SELECT_IDLECMD'` AND `!rawMode` AND `planIdx < planSteps.length`.

**Match contract** (`actionMatchesPlanStep`, lines 297-308):
- Normalize both step.cardName and action.cardName (remove quotes, unify spacing, lowercase).
- Exact name match OR bidirectional substring match (allow "Branded Fusion" to match "Branded Fusion (Quick-Play)").
- If step.verb is specified (non-empty): `action.actionVerb === step.verb` (exact, case-sensitive).
- Return false if name or verb fails.

**On match (lines 560-582):**
1. Set `chosen = matched action`.
2. Set `planStepIndex = planIdx` (stamped into replayLog and corpus rows).
3. Set `lastCommittedPlanStepIndex = planIdx` (used for corpus `ownerPlanStepIndex`, line 680).
4. Load `step.targets` into `pendingTargets = (step.targets ?? []).slice()` (fresh copy, overwrites leftovers).
5. Load `step.chainTargets` into `pendingChainTargets = (step.chainTargets ?? []).slice()` (fresh copy).
6. Increment `planIdx++`.
7. Set `pickSource = 'plan'`.

**On no-match (lines 563-573):**
- Emit divergence object (see §Divergence shaping below).
- Set `stoppedReason = 'divergence'`, `stoppedAtPlanStep = planIdx`, break loop.

**Plan exhausted** (`planIdx >= planSteps.length`, lines 584-612):
- If `endTurn === false`: break immediately (lines 610-611) — caller requested stop at plan end.
- If `endTurn === true`: fall through to end-phase policy (see §End-phase policy).

---

### β-1 sub-prompt target consumption [replay-trajectory-cli.ts:443-484, 614-650](duel-server/scripts/replay-trajectory-cli.ts#L443-L650)

#### Sub-prompt pickable set (lines 431-441)

`SUB_PROMPT_PICKABLE` constant (renamed `PLAN_PICKABLE_PROMPTS` in design doc):

```
SELECT_CARD, SELECT_OPTION, SELECT_PLACE, SELECT_UNSELECT_CARD,
SELECT_TRIBUTE, SELECT_SUM, SELECT_POSITION,
SELECT_YESNO, SELECT_EFFECTYN
```

**Rationale:** SELECT_YESNO and SELECT_EFFECTYN are included **only** to allow plans to override defaults via `targets: [{responseIndex: 0|1}]`:
- SELECT_EFFECTYN defaults to YES (auto-pick responseIndex 1) but a plan might force NO (responseIndex 0) to preserve a chain link.
- SELECT_YESNO defaults to NO (auto-pick legal[0], typically responseIndex 0) but a plan might force YES (responseIndex 1) for "place from deck" triggers.

#### `tryConsumeTarget` (lines 443-461)

**Activates:** `promptType ∈ SUB_PROMPT_PICKABLE` AND `pendingTargets.length > 0`.

**Match contract:**
- If `t.responseIndex !== undefined`: exact match on `legal.find(a => a.responseIndex === t.responseIndex)`.
- Else if `t.cardName` or `t.cardNames` present: normalize each name, find legal action whose normalized name:
  - Equals the normalized target name, OR
  - Substring-bidirectional (action name includes target name OR target includes action name — line 455).
- Case-insensitive (both names normalized via `normalizeName`).

**On match:** `pendingTargets.shift()` (consume), return matched action.
**On no-match:** return `null`, caller falls back to auto-pick (legal[0] or special case).

#### `tryConsumeChainTarget` (lines 467-484)

**Activates:** `promptType === 'SELECT_CHAIN'` AND `pendingChainTargets.length > 0`.

**Match contract:** identical to `tryConsumeTarget`:
- Exact responseIndex OR normalized cardName substring match (bidirectional).

**On match:** `pendingChainTargets.shift()`, return matched action.
**On no-match:** return `null`, caller auto-passes (responseIndex -1).

#### Sub-prompt resolution order (lines 613-647)

**SELECT_CHAIN (lines 622-629):**
1. Try `tryConsumeChainTarget(legal)`.
2. If matched: choose it, `pickSource = 'target'`.
3. Else: choose `legal.find(a => a.responseIndex === -1) ?? legal[0]` (auto-pass, fallback to first), `pickSource = 'auto'`.

**SELECT_EFFECTYN (lines 630-637):**
1. Try `tryConsumeTarget(legal, promptType)`.
2. If matched: choose it, `pickSource = 'target'`.
3. Else: choose `legal.find(a => a.responseIndex === 1) ?? legal[0]` (default YES, responseIndex 1), `pickSource = 'auto'`.

**SELECT_YESNO / other pickable (lines 638-646):**
1. Try `tryConsumeTarget(legal, promptType)`.
2. If matched: choose it, `pickSource = 'target'`.
3. Else: choose `legal[0]` (default NO / first legal), `pickSource = 'auto'`.
4. (SELECT_YESNO default-NO comment: lines 617-620 — plans that need YES must override explicitly.)

---

### β-3 raw trajectory matching [replay-trajectory-cli.ts:499-555](duel-server/scripts/replay-trajectory-cli.ts#L499-L555)

#### Raw step exact matching (lines 501-507)

**Trigger:** `rawMode && rawIdx < rawSteps.length` at any prompt type (not just SELECT_IDLECMD).

**Match contract:**
```
chosen = legal.find(a => a.responseIndex === step.responseIndex && a.cardId === step.cardId) ?? null
```
- Both responseIndex AND cardId must match exactly (no substring, no flexibility).

**On match at any prompt (lines 504-507):**
1. Set `chosen = matched action`.
2. Set `planStepIndex = rawIdx` (stamped into replayLog).
3. Increment `rawIdx++`.
4. Set `pickSource = 'raw'`.

#### Non-strategic mismatch fallback (lines 508-521)

**Trigger:** Match failed AND `promptType !== 'SELECT_IDLECMD'` (non-strategic).

**Behavior:** Auto-resolve the prompt without consuming the raw step — trajectory may drift but divergence is only reported at strategic prompts:
- SELECT_CHAIN: `legal.find(a => a.responseIndex === -1) ?? legal[0]` (auto-pass).
- SELECT_EFFECTYN: `legal.find(a => a.responseIndex === 1) ?? legal[0]` (default YES).
- Other: `legal[0]` (first legal).
- Set `pickSource = 'auto'` (non-consuming auto-pick).

#### Strategic divergence (lines 522-532)

**Trigger:** Match failed AND `promptType === 'SELECT_IDLECMD'` (strategic).

**Behavior:**
- Emit divergence object with `reason: "Raw trajectory step ${rawIdx} of ${rawSteps.length}: no legal action at SELECT_IDLECMD matches responseIndex=${step.responseIndex} cardId=${step.cardId}..."`
- Set `stoppedAtPlanStep = rawIdx`, `stoppedReason = 'divergence'`, break loop.

#### Raw exhausted (lines 534-555)

**Trigger:** `rawIdx >= rawSteps.length` at any prompt.

**Behavior if `endTurn === true`:** Continue end-phase loop (fall through to auto-finish, lines 535-552). Identical to plan mode end-phase (see §End-phase policy).
**Behavior if `endTurn === false`:** break immediately (line 554).

---

### End-phase policy [replay-trajectory-cli.ts:534-555, 584-612](duel-server/scripts/replay-trajectory-cli.ts#L534-L612)

#### Constants and state (lines 428-430)

```typescript
let endPhaseAttempts = 0;
const MAX_END_PHASE_ATTEMPTS = 50;
```

#### Policy logic (plan mode, lines 584-609)

**Activates:** Plan exhausted (`planIdx >= planSteps.length`) AND `endTurn === true` AND `promptType === 'SELECT_IDLECMD'`.

**Two continuation modes:**

**`continueMode === 'end-phase'` (default) (lines 600-608)**
1. Pick `legal.find(a => a.actionVerb === 'end-phase') ?? legal[legal.length - 1]` (end-phase action or fallback to last).
2. Increment `endPhaseAttempts++`.
3. If `endPhaseAttempts > MAX_END_PHASE_ATTEMPTS` (50):
   - Set `stoppedReason = 'ceiling'`, `errorMessage = 'End-phase loop exceeded ceiling'`, break.
4. Set `pickSource = 'auto-end-phase'`.

**`continueMode === 'aggressive'` AND `aggressiveActions < args.maxAggressiveActions` (lines 591-599)**
1. Define `PRODUCTIVE_VERBS = ['summon-procedure', 'activate', 'pendulum-summon', 'normal-summon', 'set-st', 'set-monster']`.
2. Find `productive = legal.find(a => PRODUCTIVE_VERBS.includes(a.actionVerb ?? ''))`.
3. If found:
   - Pick `productive`.
   - Increment `aggressiveActions++`.
   - Set `pickSource = 'auto-end-phase'` (reused tag; `aggressiveActions` disambiguates).
4. Else: fall back to end-phase (lines 600-608).

**Aggressive cap constant:**
```typescript
maxAggressiveActions: number;  // CLI arg, default 40 (line 138)
```

#### Policy logic (raw mode, lines 534-555)

**Activates:** Raw exhausted (`rawIdx >= rawSteps.length`) AND `endTurn === true` AND `promptType === 'SELECT_IDLECMD'`.
**Behavior:** Same as plan mode (identical code lines 536-551):
- Pick end-phase action.
- Increment `endPhaseAttempts++`.
- Ceiling check at MAX_END_PHASE_ATTEMPTS.
- Set `pickSource = 'auto-end-phase'`.

> **Note:** raw mode end-phase **does not** include the aggressive cascade — only plan mode wires `args.maxAggressiveActions` into the loop. If aggressive continuation in raw mode is desired post-refactor, it's a deliberate scope expansion (not parity preservation).

---

### Divergence shaping [replay-trajectory-cli.ts:563-573, 523-532](duel-server/scripts/replay-trajectory-cli.ts#L523-L573)

#### Divergence info object (plan mode, lines 564-570)

```typescript
divergence = {
  step: stepCount,
  promptType: string,
  expected: string,                     // "${step.cardName}${step.verb ? ' (' + step.verb + ')' : ''}"
  legalActionsAtPrompt: legal.slice(0, 30).map(a => summarizeAction(a, getName)),
                                         // First 30 legal actions, summarized
  reason: string,                       // "No legal action matches \"${step.cardName}\"${step.verb ? ' verb=' + step.verb : ''} at this prompt. Plan step ${planIdx} of ${planSteps.length}."
};
stoppedAtPlanStep = planIdx;
stoppedReason = 'divergence';
```

#### Divergence info object (raw mode, lines 523-529)

```typescript
divergence = {
  step: stepCount,
  promptType: string,
  expected: string,                     // "${step.cardName ?? getName(step.cardId) ?? '(pass)'} (responseIndex=${step.responseIndex} cardId=${step.cardId})"
  legalActionsAtPrompt: legal.slice(0, 30).map(a => summarizeAction(a, getName)),
  reason: string,                       // "Raw trajectory step ${rawIdx} of ${rawSteps.length}: no legal action at SELECT_IDLECMD matches responseIndex=${step.responseIndex} cardId=${step.cardId}. Trajectory has drifted from engine state at a strategic decision."
};
stoppedAtPlanStep = rawIdx;             // misnomer in raw mode; field reused
stoppedReason = 'divergence';
```

#### `LegalActionSummary` shape (lines 233-239, 310-318)

```typescript
interface LegalActionSummary {
  responseIndex: number;
  cardId: number;
  cardName: string;           // Resolved via getName() if action.cardName falsy
  verb: string | null;        // action.actionVerb or null
  sourceZone?: string;        // action.sourceZone (e.g., 'HAND', 'M1', etc.)
}

function summarizeAction(a: Action, getName: (id: number) => string): LegalActionSummary {
  return {
    responseIndex: a.responseIndex,
    cardId: a.cardId,
    cardName: a.cardName || getName(a.cardId),
    verb: a.actionVerb ?? null,
    sourceZone: a.sourceZone,
  };
}
```

---

### Helpers and utilities (Track B)

#### `normalizeName` (lines 289-295)

**Purpose:** Unify string comparison across card names.

```typescript
function normalizeName(s: string): string {
  return s.toLowerCase()
    .replace(/[''‚‛'`]/g, "'")       // smart quotes → '
    .replace(/[""„‟"]/g, '"')        // smart double quotes
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim();
}
```

**Used by:** `actionMatchesPlanStep`, `tryConsumeTarget`, `tryConsumeChainTarget`.
**Sensitivity:** Handles Unicode quote variants (common in copy-paste from documents). Critical for plan matching robustness.

#### `getName` cache (lines 379-388)

```typescript
const nameCache = new Map<number, string>();
const getName = (code: number): string => {
  if (!code) return '(pass)';         // cardId 0 → pass action
  const cached = nameCache.get(code);
  if (cached !== undefined) return cached;
  const row = cardDB.nameStmt.get(code) as { name: string } | undefined;
  const name = row?.name ?? `#${code}`;
  nameCache.set(code, name);
  return name;
};
```

**Used by:** action summaries, divergence reporting, replayLog, corpus dump.

---

### State mutations summary (Track B)

#### Plan-mode state (lines 409-429)

| Variable | Type | Writer(s) | Purpose |
|---|---|---|---|
| `planIdx` | number | +1 per plan step (line 582) | Index into `planSteps[]`; stops at exhaustion |
| `lastCommittedPlanStepIndex` | number \| null | Set on SELECT_IDLECMD match (line 576) | Stamped into corpus rows for `ownerPlanStepIndex` |
| `pendingTargets` | TargetSpec[] | Overwrites on plan step match (line 580) | Queue of sub-prompt overrides; consumed by `tryConsumeTarget` |
| `pendingChainTargets` | TargetSpec[] | Overwrites on plan step match (line 581) | Queue of chain-trigger overrides; consumed by `tryConsumeChainTarget` |
| `endPhaseAttempts` | number | +1 per end-phase pick (lines 602, 539) | Incremented after end-phase action selected; checked against ceiling |
| `aggressiveActions` | number | +1 per productive pick (line 597) | Incremented when aggressive cascade selects productive verb |

#### Raw-mode state (lines 410-428)

| Variable | Type | Writer(s) | Purpose |
|---|---|---|---|
| `rawIdx` | number | +1 per raw step match (line 506) | Index into `rawSteps[]`; stops at exhaustion |
| `endPhaseAttempts` | number | Same as plan mode | Shared end-phase ceiling |

#### Shared output state (lines 422-425)

| Variable | Type | Writer(s) | Purpose |
|---|---|---|---|
| `stoppedReason` | string enum | Set on stop condition (lines 531, 572, 604, 651, 721) | One of: `'completed' \| 'divergence' \| 'exception' \| 'ceiling'` |
| `divergence` | DivergenceInfo \| null | Emitted on plan/raw mismatch (lines 523-529, 564-570) | Null until divergence occurs |
| `stoppedAtPlanStep` | number \| null | Set on divergence/exception (lines 530, 571, 727) | Index of plan/raw step where stop occurred |
| `replayLog` | ReplayLogEntry[] | Pushed every iteration (line 702) | Audit trail of all prompts and picks |

---

### Tier 3 corpus dump [replay-trajectory-cli.ts:656-698](duel-server/scripts/replay-trajectory-cli.ts#L656-L698)

#### Feature extraction (lines 662-698)

**Activates:** `featureCtx && promptType === 'SELECT_CARD' && legal.length >= 2`.

**Output** (one JSONL row per qualifying SELECT_CARD):
```typescript
{
  fixtureId: string,
  stepIndex: number,
  planStepIndex: number | null,        // Index of consuming plan step (raw mode: rawIdx)
  ownerPlanStepIndex: number | null,   // Value of lastCommittedPlanStepIndex
  pickSource: string,                  // 'plan' | 'raw' | 'target' | 'auto' | 'auto-end-phase'
  promptType: 'SELECT_CARD',
  promptHint: string,                  // chosen!.description
  stateDim: number,                    // STATE_DIM constant
  actionDim: number,                   // ACTION_DIM constant
  featureSpecHash: string,             // Deterministic spec fingerprint
  stateFeatures: number[],             // extractStateFeatures(fs, featureCtx)
  candidates: Array<{
    cardId: number,
    cardName: string,
    responseIndex: number,
    actionFeatures: number[],          // extractActionFeatures(a, fs, featureCtx)
  }>,
  pickedIndex: number,                 // Index of chosen action in legal[]
  pickedCardId: number,                // chosen.cardId
  pickedResponseIndex: number,         // chosen.responseIndex
}
```

**Error handling:** Corpus extraction failures are logged but do NOT halt replay (lines 694-697).

---

### OCGCore version sensitivity (Track B)

The replay CLI consumes action objects post-enumeration, so it is **insensitive** to OCGCore message wire format. However:

1. **SELECT_TRIBUTE / SELECT_SUM indices logic** (ocgcore-adapter.ts:1580-1583):
   - Adapter returns `indicies: Array.from({ length: (msg['min'] as number) ?? 1 }, (_, i) => i)` (first N).
   - Plan matching via `actionMatchesPlanStep` operates on action name/verb only, not on index semantics — **robust to index reordering**.
   - **P6 patch (commit 1dcebeef):** added `release_param` propagation on SELECT_TRIBUTE wire. Plan-replay layer doesn't read this directly; verify Phase 4 baseline picks identical responseIndex tuples.

2. **SELECT_POSITION wire format** (ocgcore-adapter.ts:1575):
   - Adapter returns `OcgPosition.FACEUP_ATTACK` hardcoded.
   - Plan mode can override via `targets: [{responseIndex: <position_enum_value>}]` — **exact-index sensitive**.

3. **ANNOUNCE_NUMBER index semantics** (ocgcore-adapter.ts:1643-1660):
   - Adapter returns `value = opts.length > 0 ? opts.length - 1 : 0` (index of last option = max).
   - Plan mode overrides via `targets: [{responseIndex: <index>}]`.
   - **Recent fix (memo path-beta-sprint-1):** ANNOUNCE_NUMBER initial + index-semantic correction. CLI is downstream consumer — shipped change visible at adapter only.
   - Sensitivity: if OCGCore message layout changes (e.g., `options[]` field renamed or reordered), the adapter breaks but the CLI remains unaffected (it consumes enumerated `Action[]`).

4. **SELECT_YESNO override option A path** (memo path-beta-sprint-2):
   - File implements at lines 617-620 (default-NO, plan overrides to YES via `responseIndex: 1`).
   - Sensitivity: `responseIndex` 0/1 encoding for NO/YES is assumed stable.

5. **SELECT_EFFECTYN default-YES** (lines 630-637):
   - Hardcoded to `responseIndex === 1` (YES) on auto-pick.
   - Plan overrides via `responseIndex: 0` (NO).
   - Sensitivity: assumes responseIndex 1 = YES.

6. **P5 Xyz overlay parser** (memo path-beta-sprint-2): adapter-side change. CLI consumes the corrected `overlayMaterials` field via FieldState in scoring loop only.

---

### Input file schema

#### Plan file (β-1, lines 142-189, 186-189)

```typescript
interface PlanFile {
  plan: PlanStep[];
  endTurn?: boolean;  // Default: true
}

interface PlanStep {
  cardName: string;              // Card to match in legal action list
  verb?: string;                 // Optional action verb to match (e.g., 'activate', 'normal-summon')
  targets?: TargetSpec[];        // Sub-prompt overrides
  chainTargets?: TargetSpec[];   // Chain-trigger overrides
}

interface TargetSpec {
  cardName?: string;             // Substring-match card name (case-insensitive)
  cardNames?: string[];          // Multiple acceptable names
  responseIndex?: number;        // Exact response index (for effect-choice prompts)
  promptHint?: string;           // Human note (no semantic effect)
}
```

#### Raw trajectory file (β-3, lines 191-217)

**Two shape variants (auto-detected):**

```typescript
// Canonical authored format
interface CanonicalTrajectoryFile {
  fixtureId: string;
  steps: RawTrajectoryStep[];
}

// Trajectory dump format (from replay output)
interface DumpTrajectoryFile {
  fixtureId: string;
  trajectory: RawTrajectoryStep[];
}

interface RawTrajectoryStep {
  responseIndex: number;
  cardId: number;
  cardName?: string;          // Audit only; not matched
  actionDescription?: string; // Audit only; not matched
}
```

**Detection logic** (lines 221-227):
```typescript
function isRawTrajectory(f: InputFile): f is CanonicalTrajectoryFile | DumpTrajectoryFile {
  return 'steps' in f || 'trajectory' in f;
}

function getRawSteps(f: CanonicalTrajectoryFile | DumpTrajectoryFile): RawTrajectoryStep[] {
  return 'steps' in f ? f.steps : f.trajectory;
}
```

---

### CLI arguments

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `--fixture-id` | string | (required) | Fixture ID from structural.json |
| `--plan-file` | string | (required) | Path to plan.json or trajectory.json |
| `--out` | string | (optional) | Output file path; stdout if omitted |
| `--max-iterations` | number | 2000 | Safety iteration ceiling |
| `--continue-mode` | `'end-phase' \| 'aggressive'` | `'end-phase'` | Continuation policy when plan/raw exhausted |
| `--max-aggressive-actions` | number | 40 | Aggressive cascade cap |
| `--dump-corpus` | string | (optional) | Path to JSONL corpus dump file (Tier 3 feature extraction) |

---

### Output shape (lines 266-283)

```typescript
interface ReplayResult {
  fixtureId: string;
  expectedBoardSize: number;
  matched: number;
  matchedCardIds: number[];
  missingCardIds: number[];
  score: number;
  scoreBreakdown: unknown;
  stoppedReason: 'completed' | 'divergence' | 'exception' | 'ceiling';
  stoppedAtPlanStep: number | null;     // misnomer: holds rawIdx in raw mode
  divergence: DivergenceInfo | null;
  replayLog: ReplayLogEntry[];
  finalBoardSelf: FinalBoardEntry[];
  finalLifePoints: { self: number; opp: number };
  finalTurn: number;
  finalPhase: string;
  errorMessage?: string;
}
```

---

### Integration points with `ocgcore-adapter.ts`

The replay CLI calls:
1. **`adapter.createDuel(duelConfig)`** (line 406) — initializes game state.
2. **`adapter.getLegalActions(handle)`** (line 488) — returns enumerated `Action[]` at each prompt.
3. **`adapter.getFieldState(handle)`** (lines 664, 733) — queries current board state (for corpus dump and final scoring).
4. **`adapter.applyAction(handle, chosen)`** (line 711) — applies the picked action and advances engine.
5. **`adapter.destroyAll()`** (line 787) — cleanup.

The CLI **does not** call `autoRespondMechanical` or `autoRespondOpponent` directly — those are internal to the adapter's `runUntilPlayerPrompt` loop. The CLI receives enumerated `Action[]` post-enumeration and makes its own decisions (plan-match or raw-exact). **Implication for refactor:** the unified PromptResolver entry point must preserve a path where the CLI gets `legal: Action[]` *before* the resolver fires (so the CLI's PlanStep / PlanTarget oracles can match against it), then *use* the resolver to dispatch. The chain composition table in the design doc captures this — confirming the architecture handles it bit-exactly is a Phase 4 deliverable.

---

### Configuration and flags (Track B)

| Config field | Type | Source | Used by |
|---|---|---|---|
| `args.continueMode` | `'end-phase' \| 'aggressive'` | CLI arg (line 126) | End-phase policy (line 592) |
| `args.maxAggressiveActions` | number | CLI arg (line 138) | Aggressive cap (line 592) |
| `endTurn` (from input file) | boolean | PlanFile.endTurn (line 330) | Plan exhaustion gate (line 584) AND raw exhaustion gate (line 534) |
| `adapter.exposeMultiPickMechanical` | boolean | Set to true (line 352) | (ocgcore-adapter.ts only; enables multi-pick mechanical exposure) |
| `featureCtx` | FeatureContext \| null | Loaded if `args.dumpCorpus` set (lines 365-371) | Corpus dump (line 662) |

> **Cross-track note:** the CLI **enables** `exposeMultiPickMechanical = true` at startup (line 352). This is the trace-assist flag that Track A flagged as "default false" — in CLI mode it's always on. Phase 4 must wire the equivalent flag through PromptResolver/CLI composition so multi-pick prompts continue surfacing as branches in plan-replay.

---

### Caveats and risks (Track B)

1. **`stoppedAtPlanStep` misnomer:** Field name used for both plan and raw indices. In raw mode, it holds `rawIdx`, not a plan step index. The design doc does not flag this; not a blocker but flag for a follow-up rename outside this refactor.

2. **Corpus dump in SELECT_CARD only:** Lines 662-698 capture only SELECT_CARD prompts. Other prompt types (SELECT_OPTION, SELECT_PLACE, SELECT_TRIBUTE, etc.) are not dumped, so Tier 3 model training will be skewed to SELECT_CARD decisions. Current limitation, not a bug.

3. **Legal actions capped at 30 in divergence:** Lines 527 / 568 cap the `legalActionsAtPrompt` to first 30 for JSON output size. Rare edge cases with >30 legal actions will have truncated divergence diagnostics.

4. **No `sourceCardId` plumbing:** The CLI does not extract or expose `sourceCardId` from OCG messages. Phase 6 of the refactor (per design doc) will add this.

5. **No expertise or branching in CLI:** Unlike `runUntilPlayerPrompt`, the replay CLI has no DFS branching, adversarial chain exploration, or expertise hints. It is a purely mechanical replay engine. CardExpertiseOracle is added at Phase 5 (design doc table).

6. **Raw mode aggressive continuation gap:** Plan mode supports `continueMode === 'aggressive'`; raw mode does not. Phase 4 chain composition for β-3 must reflect this OR explicitly add aggressive continuation with a separate baseline.

---

### Summary table: decision points and oracle targets (Track B)

| Location | Branchement | Trigger | Oracle target | Mutation |
|---|---|---|---|---|
| 558-583 | Plan SELECT_IDLECMD match | `promptType === 'SELECT_IDLECMD'` && `planIdx < len` | `PlanStepOracle` | `planIdx++`, `pendingTargets`, `pendingChainTargets`, `lastCommittedPlanStepIndex` |
| 563-573 | Plan SELECT_IDLECMD no-match | Match failed | (Divergence) | `divergence`, `stoppedReason`, break |
| 584-612 | Plan exhaustion policy | `planIdx >= len` && `endTurn` | `EndPhasePolicyOracle` | `endPhaseAttempts++` or `aggressiveActions++` or break |
| 614-647 | Sub-prompt target matching | Sub-prompt in `SUB_PROMPT_PICKABLE` | `PlanTargetOracle` | `pendingTargets.shift()` or `pendingChainTargets.shift()` |
| 501-507 | Raw step exact match | `rawIdx < len` | `RawTrajectoryOracle` | `rawIdx++` |
| 508-521 | Raw non-strategic mismatch | No match && `promptType ≠ 'SELECT_IDLECMD'` | (Auto-resolve via MechanicalDefaultOracle pass-through) | None (no consumption) |
| 522-532 | Raw strategic divergence | No match && `promptType = 'SELECT_IDLECMD'` | (Divergence) | `divergence`, `stoppedReason`, break |
| 534-555 | Raw exhaustion policy | `rawIdx >= len` && `endTurn` | `EndPhasePolicyOracle` (no aggressive sub-branch) | `endPhaseAttempts++` or break |

---

### Track B — Design contract verification checklist

1. **`actionMatchesPlanStep` contract** [lines 297-308] — ✓ Normalizes both names, exact OR bidirectional substring, verb match if specified.
2. **`tryConsumeTarget` / `tryConsumeChainTarget` matching** [lines 443-484] — ✓ Substring (bidirectional) on normalized names OR exact responseIndex; case-insensitive; FIFO consumption via `.shift()`.
3. **`PLAN_PICKABLE_PROMPTS` (named `SUB_PROMPT_PICKABLE` in code)** [lines 431-441] — ✓ Exact set matches design doc §5.
4. **`actionVerb === 'end-phase'` selection logic** [lines 600-601] — ✓ Exact match, fallback to `legal[legal.length - 1]`. Plan + raw symmetric.
5. **"Productive verbs" definition** [line 591] — ✓ `['summon-procedure', 'activate', 'pendulum-summon', 'normal-summon', 'set-st', 'set-monster']`. Aggressive continuation only.
6. **`MAX_END_PHASE_ATTEMPTS` ceiling** [line 430] — ✓ Constant 50; checked plan + raw; triggers `stoppedReason='ceiling'` + errorMessage (not a divergence object).
7. **Aggressive cap constant** [line 138] — ✓ CLI arg `--max-aggressive-actions` default 40.
8. **β-3 raw step matching** [lines 501-507] — ✓ responseIndex + cardId both exact; strategic-only divergence at SELECT_IDLECMD.
9. **`lastCommittedPlanStepIndex` semantics** [lines 576, 680, 415] — ✓ Written only on SELECT_IDLECMD plan match; null in raw mode.
10. **Divergence info object shape** [lines 564-570, 523-529] — ✓ Plan + raw same shape; legal capped at 30.
11. **`endTurn === false` plan-exhaustion stop path** [lines 610-611] — ✓ Breaks immediately. Symmetric for raw mode (line 554).
12. **`endTurn === true` continuation** [lines 584, 534] — ✓ Activates end-phase or aggressive cascade. **Asymmetric**: aggressive only in plan mode.
13. **Expertise hook absence** — ✓ Confirmed: no expertise loading; will be added in Phase 5 as pass-through.
14. **Memory note "matcher cardId-only zone-agnostic at :760"** — Located at lines 745-764 (final scoring loop, not a prompt resolver). Out of scope.
15. **SELECT_YESNO override option A path** [lines 617-620, 638-646] — ✓ Default-NO, override via `responseIndex: 1`.
16. **ANNOUNCE_NUMBER fix** — Adapter-side at lines 1643-1660; CLI consumes via `Action[]` only.

---

## Phase 1 baseline capture targets (informational)

Recorded for cross-reference; Phase 1 will pin specific harness commands and commit SHAs.

- **Canonical 69-fixture eval** — `SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 --budget-ms=6000 --node-budget=400 --pool-size=4 --implicit-goals=10` (memo `eval-noise-audit-2026-04-27`)
- **Audited Path β-1 fixtures** — branded 7/8, ddd 3/5, mitsurugi 5/5, snake-eye 4/7 (post option A)
- **Audited Path β-3 traces** — radiant typhoon 3/3, snake-eye-yummy 5/7 (memo `path-beta-cumulative-2026-04-28`)
- **Enumerate-skip / enumerate-pivot baselines** — per-fixture mechanical brute-force scores (Sprint 1, memo `path-beta-sprint-1-2026-04-28`)
- **Adversarial fixture** — TBD; Phase 1 must add 1 fixture exercising opponent SELECT_CHAIN with ≥1 handtrap configured to lock in OpponentBranchingOracle behavior

---

## Sign-off checklist

Phase 0 closes when Axel confirms:

- [ ] All 10 Track A invariants are mapped to a future oracle (or marked out-of-scope).
- [ ] All 16 Track B verification items are reproduced exactly under the new chain composition.
- [ ] F14 plumbing has a documented post-resolve hook design.
- [ ] `pendingMultiPick` lifecycle is preserved (CLI sets `exposeMultiPickMechanical=true`; PromptResolver chain composition for plan-replay must surface multi-pick branches).
- [ ] `release_param` SELECT_TRIBUTE wire (commit 1dcebeef) has been considered for Phase 4 baseline.
- [ ] The `stoppedAtPlanStep` misnomer is explicitly accepted as out-of-scope (or added to a follow-up backlog).
- [x] **Adversarial fixture for OpponentBranchingOracle**: Phase 1 creates 1 minimal fixture (snake-eye-yummy + ≥1 Ash Blossom in `config.handtraps[]`) to exercise the branch in anticipation of the combo-vs-handtrap feature. Goal = surface the code path, not measure performance.
- [x] **Raw-mode aggressive continuation gap**: Accepted out-of-scope. Rationale: `continueMode='aggressive'` has a single caller — [enumerate-pivot.ts:113](duel-server/scripts/enumerate-pivot.ts#L113) with `--auto-finish` — used to mechanically complete the combo after a truncated pivot variant so scores remain comparable to the full plan. β-3 raw trajectories are exhaustive by construction (cover the entire turn to end-phase), no caller needs cascade. Phase 4 `EndPhasePolicyOracle` for β-3 omits the aggressive sub-branch (parité stricte).
- [x] **Snapshot mode for Phase 1 baseline**: ON (default behavior, no env var needed). Confirmed via [ocgcore-adapter.ts:373-377](duel-server/src/solver/ocgcore-adapter.ts#L373-L377): default-on since 2026-04-23, opt-out via `SOLVER_USE_SNAPSHOT=0`. `eval-noise-audit-2026-04-27` confirms baseline cum 21/69 score 555 was measured with snapshot ON (σ=0.00).
