# OCGCore Technical Reference — `@n1xx1/ocgcore-wasm` v0.1.1

_Cheat sheet for duel-server implementation. Extracted from `index.d.ts` and validated against the PoC (`duel-server/src/poc-duel.ts`)._

---

## 1. Package Setup

```
Package:  @n1xx1/ocgcore-wasm (JSR, installed via npm:@jsr/n1xx1__ocgcore-wasm)
Version:  0.1.1
Patch:    patches/@n1xx1+ocgcore-wasm+0.1.1.patch (ESM default export fix)
Mode:     sync only (createCore({ sync: true }) → OcgCoreSync)
Runtime:  Node.js (also supports Deno, Browser)
```

**Sync vs Async:** Async requires `--experimental-wasm-stack-switching` (JSPI). Use sync mode — all methods return directly (no `await`). The sync API blocks the calling thread, which is why each duel runs in a dedicated worker thread.

---

## 2. Core API (`OcgCoreSync`)

All methods below are the **sync variants** (no Promise wrapping).

### Lifecycle

| Method | Signature | Description |
|--------|-----------|-------------|
| `getVersion()` | `() → [number, number]` | Returns `[major, minor]` |
| `createDuel(options)` | `(OcgDuelOptionsSync) → OcgDuelHandle \| null` | Creates a duel instance. Returns `null` on failure. |
| `destroyDuel(handle)` | `(OcgDuelHandle) → void` | Deallocates the duel. Must be called to free WASM memory. |
| `loadScript(handle, name, content)` | `(handle, string, string) → boolean` | Loads and executes a Lua script. Must be called for startup scripts BEFORE `startDuel()`. |
| `duelNewCard(handle, cardInfo)` | `(handle, OcgNewCardInfo) → void` | Adds a card to the duel. Call for every card in both decks before `startDuel()`. |
| `startDuel(handle)` | `(handle) → void` | Starts the duel state machine. No more `duelNewCard()` after this. |

### Duel Loop

| Method | Signature | Description |
|--------|-----------|-------------|
| `duelProcess(handle)` | `(handle) → OcgProcessResult` | Advances the duel. Returns `END` (0), `WAITING` (1), or `CONTINUE` (2). |
| `duelGetMessage(handle)` | `(handle) → OcgMessage[]` | Retrieves all messages since the last `duelProcess()` call. |
| `duelSetResponse(handle, response)` | `(handle, OcgResponse) → void` | Sends a player response. Only call when `duelProcess()` returned `WAITING`. |

### Query (for reconnection snapshots)

| Method | Signature | Description |
|--------|-----------|-------------|
| `duelQueryField(handle)` | `(handle) → OcgFieldState` | Global field state: LP, zone sizes, card positions, active chains. |
| `duelQuery(handle, query)` | `(handle, OcgQuery) → Partial<OcgCardQueryInfo> \| null` | Query a single card by controller/location/sequence. |
| `duelQueryLocation(handle, query)` | `(handle, OcgQueryLocation) → (Partial<OcgCardQueryInfo> \| null)[]` | Query all cards in a location. |
| `duelQueryCount(handle, team, location)` | `(handle, number, OcgLocation) → number` | Count cards in a location. |

---

## 3. Duel Loop Pattern

```typescript
core.startDuel(handle);

while (true) {
  const status = core.duelProcess(handle);
  const messages = core.duelGetMessage(handle);

  for (const msg of messages) {
    // 1. Broadcast state-update messages (MSG_DRAW, MSG_MOVE, etc.)
    // 2. For SELECT_* messages: send prompt to the deciding player
    // 3. For HINT messages: store context for next prompt
  }

  if (status === OcgProcessResult.END) break;      // Duel over
  if (status === OcgProcessResult.CONTINUE) continue; // More processing needed
  // status === OcgProcessResult.WAITING → need player response before next duelProcess()
  // Wait for player WebSocket response, then call duelSetResponse()
}
```

**Key invariant:** After `WAITING`, exactly one `duelSetResponse()` must be called before the next `duelProcess()`. Calling `duelProcess()` without a response when `WAITING` will produce `MSG_RETRY`.

---

## 4. Duel Creation Options

```typescript
const duel = core.createDuel({
  flags: OcgDuelMode.MODE_MR5,             // Master Rule 5 (standard 2020+)
  seed: [42n, 123n, 456n, 789n],           // Xoshiro256** seed (4 bigints, never [0,0,0,0])
  team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
  team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
  cardReader: (code: number) => OcgCardData | null,  // Must be sync
  scriptReader: (name: string) => string | null,       // Must be sync
  errorHandler: (type: OcgLogType, text: string) => void,
});
```

### `OcgCardData` (returned by `cardReader`)

```typescript
{
  code: number;        // Passcode
  alias: number;       // Alias passcode (0 if none)
  setcodes: number[];  // Archetype codes (up to 4, decoded from packed 64-bit)
  type: OcgType;       // Card type bitmask (MONSTER | EFFECT, SPELL | QUICKPLAY, etc.)
  level: number;       // Level/Rank/Link rating
  attribute: OcgAttribute; // EARTH=1, WATER=2, FIRE=4, WIND=8, LIGHT=16, DARK=32, DIVINE=64
  race: OcgRace;       // Warrior=1n, Spellcaster=2n, ... (bigint)
  attack: number;
  defense: number;
  lscale: number;      // Left pendulum scale
  rscale: number;      // Right pendulum scale
  link_marker: OcgLinkMarker; // Link arrow bitmask
}
```

**Data source:** `cards.cdb` (SQLite, ProjectIgnis/BabelCDB). The PoC uses `better-sqlite3` to read it.

### `OcgNewCardInfo` (for `duelNewCard`)

```typescript
{
  team: 0 | 1;         // Owner
  duelist: 0;           // Always 0 (non-tag)
  code: number;         // Card passcode
  controller: 0 | 1;   // Current controller (usually same as team)
  location: OcgLocation; // DECK, EXTRA, HAND, MZONE, SZONE, GRAVE, REMOVED
  sequence: number;     // 0=top of deck, 1=bottom, other=shuffled. Ignored for EXTRA/HAND/GRAVE.
  position: OcgPosition;
}
```

---

## 5. Startup Lua Scripts

These must be loaded via `core.loadScript()` **after** `createDuel()` and **before** `startDuel()`:

```
constant.lua, utility.lua, archetype_setcode_constants.lua, card_counter_constants.lua,
cards_specific_functions.lua, deprecated_functions.lua, proc_equip.lua, proc_fusion.lua,
proc_fusion_spell.lua, proc_gemini.lua, proc_link.lua, proc_maximum.lua, proc_normal.lua,
proc_pendulum.lua, proc_ritual.lua, proc_spirit.lua, proc_synchro.lua, proc_toon.lua,
proc_union.lua, proc_xyz.lua
```

Individual card scripts (`c{passcode}.lua`) are loaded on-demand via `scriptReader` callback.

**Source:** `duel-server/data/scripts_full/` (ProjectIgnis/CardScripts, ~13,000+ Lua files).

---

## 6. Message Types — Complete Reference

### 6.1 Prompt Messages (require `duelSetResponse`)

These pause the engine. The `player` field indicates who must respond.

| Message Type | ID | TypeScript Interface | What the player must do |
|---|---|---|---|
| `SELECT_BATTLECMD` | 10 | `OcgMessageSelectBattleCMD` | Choose battle action: attack, activate effect, go to M2/EP |
| `SELECT_IDLECMD` | 11 | `OcgMessageSelectIdlecmd` | Choose main phase action: summon, set, activate, go to BP/EP |
| `SELECT_EFFECTYN` | 12 | `OcgMessageSelectEffectYN` | Activate optional card effect? (yes/no) |
| `SELECT_YESNO` | 13 | `OcgMessageSelectYesno` | Generic yes/no choice |
| `SELECT_OPTION` | 14 | `OcgMessageSelectOption` | Pick one from a list of options |
| `SELECT_CARD` | 15 | `OcgMessageSelectCard` | Select min..max cards from a list |
| `SELECT_CHAIN` | 16 | `OcgMessageSelectChain` | Chain a card effect in response (or pass) |
| `SELECT_PLACE` | 18 | `OcgMessageSelectPlace` | Choose a zone on the field (placement) |
| `SELECT_POSITION` | 19 | `OcgMessageSelectPosition` | Choose card position (ATK/DEF/face-up/face-down) |
| `SELECT_TRIBUTE` | 20 | `OcgMessageSelectTribute` | Select tribute materials |
| `SORT_CHAIN` | 21 | `OcgMessageSortChain` | Order simultaneous chain activations |
| `SELECT_COUNTER` | 22 | `OcgMessageSelectCounter` | Distribute counter removal among cards |
| `SELECT_SUM` | 23 | `OcgMessageSelectSum` | Select cards whose levels/values sum to a target |
| `SELECT_DISFIELD` | 24 | `OcgMessageSelectDisfield` | Choose field zones to disable |
| `SORT_CARD` | 25 | `OcgMessageSortCard` | Reorder a list of cards (e.g., Sylvan excavation) |
| `SELECT_UNSELECT_CARD` | 26 | `OcgMessageSelectUnselectCard` | Iteratively select/unselect cards until done |
| `ROCK_PAPER_SCISSORS` | 132 | `OcgMessageRockPaperScissors` | Choose rock (2), paper (3), or scissors (1) |
| `ANNOUNCE_RACE` | 140 | `OcgMessageAnnounceRace` | Declare a monster race (type) |
| `ANNOUNCE_ATTRIB` | 141 | `OcgMessageAnnounceAttrib` | Declare a monster attribute |
| `ANNOUNCE_CARD` | 142 | `OcgMessageAnnounceCard` | Declare a card name (passcode) |
| `ANNOUNCE_NUMBER` | 143 | `OcgMessageAnnounceNumber` | Declare a number from options |

### 6.2 State Update Messages (broadcast to clients)

These describe game state changes. No response needed.

| Message Type | ID | Key Fields | Description |
|---|---|---|---|
| `START` | 4 | — | Duel started |
| `WIN` | 5 | `player`, `reason` | Duel ended, winner declared |
| `NEW_TURN` | 40 | `player` | New turn begins |
| `NEW_PHASE` | 41 | `phase: OcgPhase` | Phase transition |
| `DRAW` | 90 | `player`, `drawn[]{code, position}` | Cards drawn (**anti-cheat: sanitize code for opponent**) |
| `MOVE` | 50 | `card` (code), `from`, `to` (OcgLocPos) | Card moved between zones |
| `POS_CHANGE` | 53 | `code`, controller, location, sequence, `prev_position`, `position` | Card changed position |
| `SET` | 54 | `code`, controller, location, sequence, position | Card set on field |
| `SWAP` | 55 | `card1`, `card2` (OcgCardLocPos) | Two cards swapped |
| `SUMMONING` | 60 | `code`, controller, location, sequence, position | Summoning in progress |
| `SUMMONED` | 61 | — | Summon completed |
| `SPSUMMONING` | 62 | Same as SUMMONING | Special summoning in progress |
| `SPSUMMONED` | 63 | — | Special summon completed |
| `FLIPSUMMONING` | 64 | Same as SUMMONING | Flip summoning in progress |
| `FLIPSUMMONED` | 65 | — | Flip summon completed |
| `DAMAGE` | 91 | `player`, `amount` | Player takes damage |
| `RECOVER` | 92 | `player`, `amount` | Player recovers LP |
| `LPUPDATE` | 94 | `player`, `lp` | LP set to absolute value |
| `PAY_LPCOST` | 100 | `player`, `amount` | Player pays LP cost |
| `ATTACK` | 110 | `card` (OcgLocPos), `target` (OcgLocPos \| null) | Attack declared (null = direct) |
| `BATTLE` | 111 | `card`, `target` (OcgCardLocBattle with ATK/DEF/destroyed) | Battle resolution |
| `ATTACK_DISABLED` | 112 | — | Attack was negated |
| `DAMAGE_STEP_START` | 113 | — | Entering damage step |
| `DAMAGE_STEP_END` | 114 | — | Leaving damage step |
| `EQUIP` | 93 | `card`, `target` | Card equipped to target |
| `CARD_TARGET` | 96 | `card`, `target` | Card targeting another |
| `CANCEL_TARGET` | 97 | `card`, `target` | Targeting cancelled |
| `BECOME_TARGET` | 83 | `cards[]` | Cards became targets |
| `ADD_COUNTER` | 101 | controller, location, sequence, `counter_type`, `count` | Counter placed |
| `REMOVE_COUNTER` | 102 | Same as ADD_COUNTER | Counter removed |
| `FIELD_DISABLED` | 56 | `field_mask` | Zones disabled on field |

### 6.3 Chain Messages

| Message Type | ID | Key Fields | Description |
|---|---|---|---|
| `CHAINING` | 70 | `code`, controller, location, sequence, `chain_size`, `description` | Effect activating, entering chain |
| `CHAINED` | 71 | `chain_size` | Effect confirmed on chain |
| `CHAIN_SOLVING` | 72 | `chain_size` | Resolving chain link N |
| `CHAIN_SOLVED` | 73 | `chain_size` | Chain link N resolved |
| `CHAIN_END` | 74 | — | Entire chain finished |
| `CHAIN_NEGATED` | 75 | `chain_size` | Chain link negated |
| `CHAIN_DISABLED` | 76 | `chain_size` | Chain link disabled |

### 6.4 Information / Deck Messages

| Message Type | ID | Key Fields | Description |
|---|---|---|---|
| `HINT` | 2 | `hint_type: OcgHintType`, `player`, `hint: bigint` | Context for next prompt (**UX-critical**) |
| `CONFIRM_CARDS` | 31 | `player`, `cards[]` (OcgCardLoc) | Reveal specific cards to player (**route to intended player only**) |
| `CONFIRM_DECKTOP` | 30 | `player`, `cards[]` | Reveal top of deck |
| `CONFIRM_EXTRATOP` | 42 | `player`, `cards[]` | Reveal top of extra deck |
| `SHUFFLE_DECK` | 32 | `player` | Deck was shuffled |
| `SHUFFLE_HAND` | 33 | `player`, `cards[]` (codes) | Hand was shuffled (**anti-cheat: sanitize codes for opponent**) |
| `SHUFFLE_SET_CARD` | 36 | `location`, `cards[]{from, to}` | Face-down cards were shuffled (e.g., Tsukuyomi) |
| `SHUFFLE_EXTRA` | 39 | `player`, `cards[]` | Extra deck shuffled |
| `DECK_TOP` | 38 | `player`, `count`, `code`, position | Reveal top card(s) of deck |
| `SWAP_GRAVE_DECK` | 35 | `player`, `deck_size`, `returned_to_extra[]` | Graveyard and deck swapped |
| `REVERSE_DECK` | 37 | — | Deck reversed |
| `CARD_SELECTED` | 80 | `cards[]` | Cards were selected (info) |
| `RANDOM_SELECTED` | 81 | `player`, `cards[]` | Cards randomly selected |
| `CARD_HINT` | 160 | controller, location, sequence, `card_hint: OcgCardHintType`, `description` | Persistent card hint |
| `PLAYER_HINT` | 165 | `player`, `player_hint`, `description` | Player-level hint |
| `MISSED_EFFECT` | 120 | code, controller, location, sequence | Optional trigger missed timing |
| `TOSS_COIN` | 130 | `player`, `results: boolean[]` | Coin toss results |
| `TOSS_DICE` | 131 | `player`, `results: number[]` | Dice roll results |
| `HAND_RES` | 133 | `results: [OcgRPS, OcgRPS]` | RPS result (both choices revealed) |
| `SHOW_HINT` | 164 | `hint: string` | Display hint text |
| `RELOAD_FIELD` | 162 | Extends `OcgFieldState` | Full field state reload (useful for reconnection) |
| `REMOVE_CARDS` | 190 | `cards[]` | Cards removed from play |

### 6.5 System / Deprecated

| Message Type | ID | Notes |
|---|---|---|
| `RETRY` | 1 | Invalid response was sent. Resend a valid response. |
| `WAITING` | 3 | Waiting for opponent's response (display "waiting..." to other player) |
| `UPDATE_DATA` | 6 | Deprecated, not used |
| `UPDATE_CARD` | 7 | Deprecated, not used |
| `REQUEST_DECK` | 8 | Deprecated, not used |
| `REFRESH_DECK` | 34 | Deprecated, not used |
| `TAG_SWAP` | 161 | Tag duel only |
| `AI_NAME` | 163 | AI name hint |
| `MATCH_KILL` | 170 | Match-level kill (e.g., Victory Dragon) |
| `CUSTOM_MSG` | 180 | Custom script message |
| `BE_CHAIN_TARGET` | 121 | Internal |
| `CREATE_RELATION` | 122 | Internal |
| `RELEASE_RELATION` | 123 | Internal |

---

## 7. Response Format Reference

Every response has a `type: OcgResponseType` discriminant.

### SELECT_BATTLECMD (type: 0)

```typescript
{ type: 0, action: SelectBattleCMDAction, index: number | null }
// Actions: SELECT_CHAIN=0, SELECT_BATTLE=1, TO_M2=2, TO_EP=3
// index: card index from chains[] (action=0) or attacks[] (action=1), null for TO_M2/TO_EP
```

### SELECT_IDLECMD (type: 1)

```typescript
{ type: 1, action: SelectIdleCMDAction, index: number | null }
// Actions: SELECT_SUMMON=0, SELECT_SPECIAL_SUMMON=1, SELECT_POS_CHANGE=2,
//          SELECT_MONSTER_SET=3, SELECT_SPELL_SET=4, SELECT_ACTIVATE=5,
//          TO_BP=6, TO_EP=7, SHUFFLE=8
// index: card index from the corresponding array, null for TO_BP/TO_EP/SHUFFLE
```

### SELECT_EFFECTYN (type: 2)

```typescript
{ type: 2, yes: boolean }
```

### SELECT_YESNO (type: 3)

```typescript
{ type: 3, yes: boolean }
```

### SELECT_OPTION (type: 4)

```typescript
{ type: 4, index: number }   // Index into options[] from the message
```

### SELECT_CARD (type: 5)

```typescript
{ type: 5, indicies: number[] | null }   // null = cancel (if can_cancel). Indices into selects[].
```

### SELECT_CARD_CODES (type: 6)

```typescript
{ type: 6, codes: number[] | null }   // Alternative: select by card code instead of index
```

### SELECT_UNSELECT_CARD (type: 7)

```typescript
{ type: 7, index: number | null }
// null = finish (if can_finish)
// index < select_cards.length → select that card
// index >= select_cards.length → unselect from unselect_cards at (index - select_cards.length)
```

### SELECT_CHAIN (type: 8)

```typescript
{ type: 8, index: number | null }   // null = pass (don't chain). Index into selects[].
```

### SELECT_DISFIELD (type: 9)

```typescript
{ type: 9, places: SelectFieldPlace[] }
// SelectFieldPlace = { player: number, location: OcgLocation, sequence: number }
```

### SELECT_PLACE (type: 10)

```typescript
{ type: 10, places: SelectFieldPlace[] }
```

### SELECT_POSITION (type: 11)

```typescript
{ type: 11, position: OcgPosition }
// FACEUP_ATTACK=1, FACEDOWN_ATTACK=2, FACEUP_DEFENSE=4, FACEDOWN_DEFENSE=8
```

### SELECT_TRIBUTE (type: 12)

```typescript
{ type: 12, indicies: number[] | null }   // null = cancel. Indices into selects[].
```

### SELECT_COUNTER (type: 13)

```typescript
{ type: 13, counters: number[] }   // Array parallel to cards[]. How many counters to remove from each.
```

### SELECT_SUM (type: 14)

```typescript
{ type: 14, indicies: number[] }   // Indices into selects[] (must match target amount)
```

### SORT_CARD (type: 15)

```typescript
{ type: 15, order: number[] | null }   // null = accept default order. Array of new indices.
```

### ANNOUNCE_RACE (type: 16)

```typescript
{ type: 16, races: OcgRace[] }   // e.g., [1n] for Warrior. Must match count requirement.
```

### ANNOUNCE_ATTRIB (type: 17)

```typescript
{ type: 17, attributes: OcgAttribute[] }   // e.g., [32] for DARK
```

### ANNOUNCE_CARD (type: 18)

```typescript
{ type: 18, card: number }   // Card passcode
```

### ANNOUNCE_NUMBER (type: 19)

```typescript
{ type: 19, value: number }   // Selected number (from options[] in the message)
```

### ROCK_PAPER_SCISSORS (type: 20)

```typescript
{ type: 20, value: 1 | 2 | 3 }   // SCISSORS=1, ROCK=2, PAPER=3
```

---

## 8. Query API — Reconnection Snapshots

OCGCore has **no save/restore**. State exists only in the live WASM instance. On reconnection, build a snapshot using the query functions.

### `duelQueryField()` → `OcgFieldState`

```typescript
{
  flags: OcgDuelMode;          // Active duel mode flags
  players: [OcgFieldPlayer, OcgFieldPlayer];
  chain: OcgChain[];           // Currently active chain
}

// OcgFieldPlayer:
{
  monsters: [OcgFieldCard × 7];   // MZ1-MZ5 + EMZ-L + EMZ-R
  spells: [OcgFieldCard × 8];     // ST1-ST5 + Field + PendL + PendR
  deck_size: number;
  hand_size: number;
  grave_size: number;
  banish_size: number;
  extra_size: number;
  extra_faceup_count: number;
}

// OcgFieldCard:
{ position: OcgPosition; materials: number; }  // position=0 → empty zone
```

**Important:** `duelQueryField()` gives **positions and zone occupancy** but **not card codes**. You need `duelQuery()` or `duelQueryLocation()` for card details.

### `duelQuery()` → single card

```typescript
core.duelQuery(handle, {
  flags: OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.ATTACK |
         OcgQueryFlags.DEFENSE | OcgQueryFlags.OVERLAY_CARD | OcgQueryFlags.COUNTERS,
  controller: 0,        // Player 0 or 1
  location: OcgLocation, // MZONE, SZONE, HAND, GRAVE, REMOVED, EXTRA
  sequence: 2,           // Zone index (0-6 for MZONE, 0-7 for SZONE)
  overlaySequence: 0,    // 0 unless querying XYZ overlay materials
});
// Returns: Partial<OcgCardQueryInfo> | null
```

### `duelQueryLocation()` → all cards in a zone

```typescript
core.duelQueryLocation(handle, {
  flags: OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.IS_PUBLIC,
  controller: 0,
  location: OcgLocation.HAND,  // No sequence — queries entire location
});
// Returns: (Partial<OcgCardQueryInfo> | null)[]
```

### `OcgQueryFlags` (bitmask, combinable with `|`)

| Flag | Value | Returns |
|------|-------|---------|
| `CODE` | 1 | Card passcode |
| `POSITION` | 2 | Face-up/down, ATK/DEF |
| `ALIAS` | 4 | Alias passcode |
| `TYPE` | 8 | Card type bitmask |
| `LEVEL` | 16 | Level |
| `RANK` | 32 | Rank |
| `ATTRIBUTE` | 64 | Attribute |
| `RACE` | 128 | Race/Type |
| `ATTACK` | 256 | Current ATK |
| `DEFENSE` | 512 | Current DEF |
| `BASE_ATTACK` | 1024 | Original ATK |
| `BASE_DEFENSE` | 2048 | Original DEF |
| `OVERLAY_CARD` | 65536 | XYZ overlay material codes |
| `COUNTERS` | 131072 | Counter types & counts |
| `OWNER` | 262144 | Original owner |
| `IS_PUBLIC` | 1048576 | Public knowledge? |
| `IS_HIDDEN` | 16777216 | Hidden? |
| `LSCALE` / `RSCALE` | 2097152 / 4194304 | Pendulum scales |
| `LINK` | 8388608 | Link rating + markers |
| `EQUIP_CARD` | 16384 | Equipped-to card |
| `TARGET_CARD` | 32768 | Targeted card(s) |
| `REASON` | 4096 | Why the card is in current state |
| `REASON_CARD` | 8192 | Card that caused the reason |
| `STATUS` | 524288 | Internal status flags |
| `COVER` | 33554432 | Cover art code |

### Recommended reconnection query strategy

```typescript
// 1. Global state
const fieldState = core.duelQueryField(handle);

// 2. Per-zone detailed queries (face-up cards → full info, face-down → position only)
const FULL_FLAGS = OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.ATTACK |
  OcgQueryFlags.DEFENSE | OcgQueryFlags.TYPE | OcgQueryFlags.LEVEL | OcgQueryFlags.RANK |
  OcgQueryFlags.ATTRIBUTE | OcgQueryFlags.RACE | OcgQueryFlags.OVERLAY_CARD |
  OcgQueryFlags.COUNTERS | OcgQueryFlags.LSCALE | OcgQueryFlags.RSCALE | OcgQueryFlags.LINK;

for (const controller of [0, 1] as const) {
  for (const location of [OcgLocation.MZONE, OcgLocation.SZONE]) {
    const cards = core.duelQueryLocation(handle, { flags: FULL_FLAGS, controller, location });
    // → Apply message filter per player before sending
  }
  // Hand: full info for owner, code=0 for opponent
  const hand = core.duelQueryLocation(handle, {
    flags: FULL_FLAGS, controller, location: OcgLocation.HAND
  });
  // GY, Banished: public info (both players see)
  const grave = core.duelQueryLocation(handle, {
    flags: FULL_FLAGS, controller, location: OcgLocation.GRAVE
  });
  const banished = core.duelQueryLocation(handle, {
    flags: FULL_FLAGS, controller, location: OcgLocation.REMOVED
  });
}
```

---

## 9. RPS & Turn Order Flow

OCGCore does **not** manage RPS natively in the same way as in-duel prompts. The flow differs based on whether OCGCore's built-in RPS or server-managed RPS is used.

### OCGCore's built-in flow

1. `duelProcess()` → messages include `ROCK_PAPER_SCISSORS` for player 0
2. Server receives RPS response → `duelSetResponse({ type: 20, value: 2 })` (Rock)
3. `duelProcess()` → messages include `ROCK_PAPER_SCISSORS` for player 1
4. Server receives RPS response → `duelSetResponse({ type: 20, value: 3 })` (Paper)
5. `duelProcess()` → messages include `HAND_RES` with `results: [OcgRPS, OcgRPS]` (both revealed)
6. If tie: loop back to step 1
7. Winner receives a standard engine prompt (the engine determines turn order internally)

### PvP architecture choice (server-managed RPS)

The architecture document specifies server-managed RPS with `RPS_CHOICE` / `RPS_RESULT` WebSocket messages, letting the server handle the pre-duel ceremony separately. The winner's "Go First / Go Second" choice is then used to determine which player is `team: 0` (first) vs `team: 1` (second) when creating the OCGCore duel instance.

---

## 10. Phase Constants (`OcgPhase`)

| Phase | Value | Name |
|-------|-------|------|
| Draw | 1 | `DRAW` |
| Standby | 2 | `STANDBY` |
| Main 1 | 4 | `MAIN1` |
| Battle Start | 8 | `BATTLE_START` |
| Battle Step | 16 | `BATTLE_STEP` |
| Damage Step | 32 | `DAMAGE` |
| Damage Calc | 64 | `DAMAGE_CAL` |
| Battle End | 128 | `BATTLE` |
| Main 2 | 256 | `MAIN2` |
| End | 512 | `END` |

---

## 11. Location Constants (`OcgLocation`)

Commonly used values (check `index.d.ts` for full bitmask):

| Location | Typical Usage |
|----------|---------------|
| `DECK` | Main deck |
| `HAND` | Player's hand |
| `MZONE` | Monster zones (0-4 = main, 5-6 = EMZ) |
| `SZONE` | Spell/Trap zones (0-4 = main, 5 = field, 6 = PendL, 7 = PendR) |
| `GRAVE` | Graveyard |
| `REMOVED` | Banished zone |
| `EXTRA` | Extra deck |
| `OVERLAY` | XYZ overlay materials (combine with MZONE) |

---

## 12. Anti-Cheat: Message Filter Whitelist

Messages that require per-player sanitization:

| Message | Sanitization Rule |
|---------|-------------------|
| `DRAW` (90) | `drawn[].code` → 0 for opponent |
| `SHUFFLE_HAND` (33) | `cards[]` codes → 0 for opponent |
| `CONFIRM_CARDS` (31) | Route to `player` only |
| `CONFIRM_DECKTOP` (30) | Route to `player` only |
| `CONFIRM_EXTRATOP` (42) | Route to `player` only |
| `HINT` (2) | Route hints with `HINT_EFFECT` card codes to intended `player` only |
| `MOVE` (50) | If from/to private zone (HAND/DECK) → `card` code → 0 for opponent |
| `DECK_TOP` (38) | Route to `player` only |
| All `SELECT_*` | Route to `player` field only (the deciding player) |
| `WAITING` (3) | Route to the **non-deciding** player |

**Default policy:** Any message type NOT in the whitelist → DROP + LOG. Never transmit unknown messages.

---

## 13. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| No save/restore | Cannot serialize duel state to disk | Snapshot via query API. State lives only in WASM worker memory. |
| Sync blocks thread | `duelProcess()` can take 100-200ms+ on complex chains | Worker thread per duel |
| No built-in timer | OCGCore has no turn timer concept | Server-side timer, forfeit on timeout |
| No deck validation | OCGCore does not validate deck legality | Spring Boot validates before relaying |
| `MSG_RETRY` on invalid response | Engine re-sends the prompt if response is malformed | Count retries, forfeit after N failures |
| Lua script errors | Community-maintained scripts may crash | try/catch around `duelProcess()`, watchdog timer (30s), declare draw on error |
| WASM memory ~2MB per instance | 50 concurrent duels ≈ 100MB overhead | Acceptable for friends-only MVP |
| ESM patch required | `@n1xx1/ocgcore-wasm` missing default export | `patch-package` applied via postinstall |
