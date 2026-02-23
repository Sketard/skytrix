---
type: technical-research
project: skytrix
author: Claude (AI Research Agent)
date: 2026-02-23
subject: OCGCore Binary Message Protocol - Detailed Specification
status: complete
---

# OCGCore Binary Message Protocol - Detailed Research

## Table of Contents

1. [Protocol Architecture Overview](#1-protocol-architecture-overview)
2. [Binary Wire Format](#2-binary-wire-format)
3. [Complete Message Type Catalog](#3-complete-message-type-catalog)
4. [Message Categories & Classification](#4-message-categories--classification)
5. [Detailed Message Formats (Selection/Input Messages)](#5-detailed-message-formats-selectioninput-messages)
6. [Detailed Message Formats (State Update Messages)](#6-detailed-message-formats-state-update-messages)
7. [Response Formats for OCG_DuelSetResponse](#7-response-formats-for-ocg_duelsetresponse)
8. [Existing TypeScript/JavaScript Parsers](#8-existing-typescriptjavascript-parsers)
9. [Key Constants and Enums](#9-key-constants-and-enums)
10. [Implementation Recommendations for Skytrix](#10-implementation-recommendations-for-skytrix)
11. [Sources](#11-sources)

---

## 1. Protocol Architecture Overview

### Core Loop

The OCGCore engine operates on a simple request-response loop:

```
1. Host calls OCG_DuelProcess(duel)
   -> Returns OCG_DUEL_STATUS_AWAITING (needs player input)
           or OCG_DUEL_STATUS_CONTINUE (more processing)
           or OCG_DUEL_STATUS_END (duel over)

2. Host calls OCG_DuelGetMessage(duel, &length)
   -> Returns pointer to binary buffer containing 0..N messages

3. Host parses all messages from the buffer
   -> If any message requires a response (SELECT_* messages),
      host collects player input

4. Host calls OCG_DuelSetResponse(duel, buffer, length)
   -> Sends the player's decision as raw binary back to the engine

5. Repeat from step 1
```

### Key API Functions (from `ocgapi.h`)

| Function | Purpose |
|----------|---------|
| `OCG_CreateDuel(out, options)` | Initialize a duel with seed, LP, draw counts, flags |
| `OCG_DuelNewCard(duel, info)` | Add a card to the initial field state |
| `OCG_StartDuel(duel)` | Begin the duel |
| `OCG_DuelProcess(duel)` | Advance the duel state machine |
| `OCG_DuelGetMessage(duel, &len)` | Retrieve accumulated binary messages |
| `OCG_DuelSetResponse(duel, buf, len)` | Submit player response to current prompt |
| `OCG_DuelQuery(duel, &len, info)` | Query a specific card's data |
| `OCG_DuelQueryField(duel, &len)` | Query full field state |
| `OCG_LoadScript(duel, buf, len, name)` | Load a Lua card script |
| `OCG_DestroyDuel(duel)` | Cleanup |

### Engine Return States

```c
enum OCG_DuelStatus {
    OCG_DUEL_STATUS_END       = 0,  // Duel is over
    OCG_DUEL_STATUS_AWAITING  = 1,  // Waiting for player response
    OCG_DUEL_STATUS_CONTINUE  = 2   // More internal processing needed
};
```

---

## 2. Binary Wire Format

### Message Buffer Structure

When `OCG_DuelGetMessage()` returns a buffer, it contains **zero or more** concatenated messages. Each message is prefixed with its length:

```
[uint32_le: message_size_1][message_data_1][uint32_le: message_size_2][message_data_2]...
```

### Individual Message Structure

Each `message_data` block starts with a **1-byte message type** followed by type-specific payload:

```
[uint8: MSG_TYPE][...payload bytes...]
```

The `message_size` includes the MSG_TYPE byte. So a message with 0 payload bytes has `message_size = 1`.

### Serialization Details (from `duel.cpp`)

```cpp
// Message creation - first byte is always the message type
duel::duel_message::duel_message(uint8_t message) {
    write<uint8_t>(message);
}

// Buffer generation - each message gets a uint32 length prefix
void duel::generate_buffer() {
    for(auto& message : messages) {
        uint32_t size = static_cast<uint32_t>(message.data.size());
        write_buffer(&size, sizeof(size));        // 4-byte LE length
        write_buffer(message.data.data(), size);  // message bytes
    }
    messages.clear();
}
```

### Location Info Structure (`loc_info`)

Many messages include card locations, serialized as:

```
[uint8: controller][uint8: location][uint32_le: sequence][uint32_le: position]
```

Total: **10 bytes** per location info.

- `controller`: 0 or 1 (which player controls the card)
- `location`: bitmask from LOCATION_* constants
- `sequence`: zone index (0-6 for MZONE, 0-7 for SZONE, index in hand/deck/grave/etc.)
- `position`: bitmask from POS_* constants (face-up attack, face-down defense, etc.)

### Byte Order

All multi-byte integers are **little-endian** (x86 native order since OCGCore is a C++ library).

### SetResponse Format

`OCG_DuelSetResponse(duel, buffer, length)` copies the raw bytes into `game_field->returns.data`. The response format varies by message type (see Section 7).

---

## 3. Complete Message Type Catalog

Source: `ocgapi_constants.h` from `edo9300/ygopro-core`

### All 78 Message Types

| Constant | Value | Category | Needs Response? |
|----------|-------|----------|-----------------|
| MSG_RETRY | 1 | Error | No (re-send previous) |
| MSG_HINT | 2 | Info | No |
| MSG_WAITING | 3 | Info | No |
| MSG_START | 4 | Lifecycle | No |
| MSG_WIN | 5 | Lifecycle | No |
| MSG_UPDATE_DATA | 6 | State | No |
| MSG_UPDATE_CARD | 7 | State | No |
| MSG_REQUEST_DECK | 8 | Lifecycle | No |
| MSG_SELECT_BATTLECMD | 10 | Selection | **Yes** |
| MSG_SELECT_IDLECMD | 11 | Selection | **Yes** |
| MSG_SELECT_EFFECTYN | 12 | Selection | **Yes** |
| MSG_SELECT_YESNO | 13 | Selection | **Yes** |
| MSG_SELECT_OPTION | 14 | Selection | **Yes** |
| MSG_SELECT_CARD | 15 | Selection | **Yes** |
| MSG_SELECT_CHAIN | 16 | Selection | **Yes** |
| MSG_SELECT_PLACE | 18 | Selection | **Yes** |
| MSG_SELECT_POSITION | 19 | Selection | **Yes** |
| MSG_SELECT_TRIBUTE | 20 | Selection | **Yes** |
| MSG_SORT_CHAIN | 21 | Selection | **Yes** |
| MSG_SELECT_COUNTER | 22 | Selection | **Yes** |
| MSG_SELECT_SUM | 23 | Selection | **Yes** |
| MSG_SELECT_DISFIELD | 24 | Selection | **Yes** |
| MSG_SORT_CARD | 25 | Selection | **Yes** |
| MSG_SELECT_UNSELECT_CARD | 26 | Selection | **Yes** |
| MSG_CONFIRM_DECKTOP | 30 | Display | No |
| MSG_CONFIRM_CARDS | 31 | Display | No |
| MSG_SHUFFLE_DECK | 32 | State | No |
| MSG_SHUFFLE_HAND | 33 | State | No |
| MSG_REFRESH_DECK | 34 | State | No |
| MSG_SWAP_GRAVE_DECK | 35 | State | No |
| MSG_SHUFFLE_SET_CARD | 36 | State | No |
| MSG_REVERSE_DECK | 37 | State | No |
| MSG_DECK_TOP | 38 | State | No |
| MSG_SHUFFLE_EXTRA | 39 | State | No |
| MSG_NEW_TURN | 40 | Phase | No |
| MSG_NEW_PHASE | 41 | Phase | No |
| MSG_CONFIRM_EXTRATOP | 42 | Display | No |
| MSG_MOVE | 50 | State | No |
| MSG_POS_CHANGE | 53 | State | No |
| MSG_SET | 54 | State | No |
| MSG_SWAP | 55 | State | No |
| MSG_FIELD_DISABLED | 56 | State | No |
| MSG_SUMMONING | 60 | Animation | No |
| MSG_SUMMONED | 61 | Animation | No |
| MSG_SPSUMMONING | 62 | Animation | No |
| MSG_SPSUMMONED | 63 | Animation | No |
| MSG_FLIPSUMMONING | 64 | Animation | No |
| MSG_FLIPSUMMONED | 65 | Animation | No |
| MSG_CHAINING | 70 | Chain | No |
| MSG_CHAINED | 71 | Chain | No |
| MSG_CHAIN_SOLVING | 72 | Chain | No |
| MSG_CHAIN_SOLVED | 73 | Chain | No |
| MSG_CHAIN_END | 74 | Chain | No |
| MSG_CHAIN_NEGATED | 75 | Chain | No |
| MSG_CHAIN_DISABLED | 76 | Chain | No |
| MSG_CARD_SELECTED | 80 | Display | No |
| MSG_RANDOM_SELECTED | 81 | Display | No |
| MSG_BECOME_TARGET | 83 | Display | No |
| MSG_DRAW | 90 | State | No |
| MSG_DAMAGE | 91 | State | No |
| MSG_RECOVER | 92 | State | No |
| MSG_EQUIP | 93 | State | No |
| MSG_LPUPDATE | 94 | State | No |
| MSG_UNEQUIP | 95 | State | No |
| MSG_CARD_TARGET | 96 | State | No |
| MSG_CANCEL_TARGET | 97 | State | No |
| MSG_PAY_LPCOST | 100 | State | No |
| MSG_ADD_COUNTER | 101 | State | No |
| MSG_REMOVE_COUNTER | 102 | State | No |
| MSG_ATTACK | 110 | Battle | No |
| MSG_BATTLE | 111 | Battle | No |
| MSG_ATTACK_DISABLED | 112 | Battle | No |
| MSG_DAMAGE_STEP_START | 113 | Battle | No |
| MSG_DAMAGE_STEP_END | 114 | Battle | No |
| MSG_MISSED_EFFECT | 120 | Info | No |
| MSG_BE_CHAIN_TARGET | 121 | Info | No |
| MSG_CREATE_RELATION | 122 | Info | No |
| MSG_RELEASE_RELATION | 123 | Info | No |
| MSG_TOSS_COIN | 130 | State | No |
| MSG_TOSS_DICE | 131 | State | No |
| MSG_ROCK_PAPER_SCISSORS | 132 | Selection | **Yes** |
| MSG_HAND_RES | 133 | State | No |
| MSG_ANNOUNCE_RACE | 140 | Selection | **Yes** |
| MSG_ANNOUNCE_ATTRIB | 141 | Selection | **Yes** |
| MSG_ANNOUNCE_CARD | 142 | Selection | **Yes** |
| MSG_ANNOUNCE_NUMBER | 143 | Selection | **Yes** |
| MSG_CARD_HINT | 160 | Info | No |
| MSG_TAG_SWAP | 161 | State | No |
| MSG_RELOAD_FIELD | 162 | State | No |
| MSG_AI_NAME | 163 | Info | No |
| MSG_SHOW_HINT | 164 | Info | No |
| MSG_PLAYER_HINT | 165 | Info | No |
| MSG_MATCH_KILL | 170 | Lifecycle | No |
| MSG_CUSTOM_MSG | 180 | Info | No |
| MSG_REMOVE_CARDS | 190 | State | No |

**Total: 78 distinct message types**
**Messages requiring response: 20** (all SELECT_*, SORT_*, ANNOUNCE_*, ROCK_PAPER_SCISSORS)

---

## 4. Message Categories & Classification

### Category 1: Selection/Input Messages (20 types) -- REQUIRE RESPONSE

These pause the engine (`OCG_DUEL_STATUS_AWAITING`) and wait for `OCG_DuelSetResponse()`:

| Message | Purpose | Typical UI |
|---------|---------|------------|
| SELECT_BATTLECMD | Choose battle phase action | Button menu: activate/attack/M2/EP |
| SELECT_IDLECMD | Choose main phase action | Button menu: summon/set/activate/BP/EP |
| SELECT_EFFECTYN | Activate optional effect? | Yes/No dialog |
| SELECT_YESNO | Generic yes/no question | Yes/No dialog |
| SELECT_OPTION | Choose from N options | Dropdown/button list |
| SELECT_CARD | Pick card(s) from list | Card selection UI (min/max) |
| SELECT_UNSELECT_CARD | Pick/unpick cards iteratively | Toggle selection UI |
| SELECT_CHAIN | Choose chain activation | Chain link selection |
| SELECT_PLACE | Choose zone placement | Zone highlight on field |
| SELECT_DISFIELD | Choose zone to disable | Zone highlight on field |
| SELECT_POSITION | Choose card position | ATK/DEF buttons |
| SELECT_TRIBUTE | Choose tribute material | Card selection (with release_param) |
| SELECT_COUNTER | Distribute counters | Counter allocation UI |
| SELECT_SUM | Choose cards summing to target | Level/ATK sum selection |
| SORT_CARD | Order cards | Drag-and-drop reorder |
| SORT_CHAIN | Order chain links | Drag-and-drop reorder |
| ANNOUNCE_RACE | Declare monster type(s) | Race picker |
| ANNOUNCE_ATTRIB | Declare attribute(s) | Attribute picker |
| ANNOUNCE_CARD | Declare card name | Card search/input |
| ANNOUNCE_NUMBER | Choose a number | Number picker |
| ROCK_PAPER_SCISSORS | RPS choice | Rock/Paper/Scissors buttons |

### Category 2: State Update Messages (~30 types)

Inform the client of game state changes. No response needed.

- **Card Movement**: MOVE, SET, SWAP, POS_CHANGE, DRAW, EQUIP, UNEQUIP
- **Life Points**: DAMAGE, RECOVER, LPUPDATE, PAY_LPCOST
- **Counters**: ADD_COUNTER, REMOVE_COUNTER
- **Targeting**: CARD_TARGET, CANCEL_TARGET, BECOME_TARGET
- **Data Refresh**: UPDATE_DATA, UPDATE_CARD, RELOAD_FIELD, FIELD_DISABLED
- **Shuffling**: SHUFFLE_DECK, SHUFFLE_HAND, SHUFFLE_EXTRA, SHUFFLE_SET_CARD, REVERSE_DECK
- **Randomness**: TOSS_COIN, TOSS_DICE, HAND_RES

### Category 3: Phase/Turn Messages (2 types)

- **NEW_TURN**: Indicates turn change (contains player id)
- **NEW_PHASE**: Indicates phase change (contains phase constant)

### Category 4: Chain System Messages (7 types)

- CHAINING, CHAINED, CHAIN_SOLVING, CHAIN_SOLVED, CHAIN_END, CHAIN_NEGATED, CHAIN_DISABLED

### Category 5: Animation/Summon Messages (6 types)

Paired messages for summon animations:
- SUMMONING/SUMMONED (Normal Summon)
- SPSUMMONING/SPSUMMONED (Special Summon)
- FLIPSUMMONING/FLIPSUMMONED (Flip Summon)

### Category 6: Lifecycle Messages (4 types)

- START, WIN, REQUEST_DECK, MATCH_KILL

### Category 7: Display/Info Messages (~10 types)

- HINT, WAITING, CONFIRM_DECKTOP, CONFIRM_CARDS, CONFIRM_EXTRATOP
- CARD_SELECTED, RANDOM_SELECTED, CARD_HINT, PLAYER_HINT
- MISSED_EFFECT, BE_CHAIN_TARGET, AI_NAME, SHOW_HINT, CUSTOM_MSG

---

## 5. Detailed Message Formats (Selection/Input Messages)

All formats show fields after the 1-byte MSG_TYPE. All integers are little-endian.

### MSG_SELECT_IDLECMD (11)

```
uint8   player
uint32  summon_count          // Normal Summonable cards
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
uint32  spsummon_count        // Special Summonable cards
  for each:  (same as above)
uint32  reposition_count      // Can change position
  for each:  (same as above)
uint32  mset_count            // Can Set as monster
  for each:  (same as above)
uint32  sset_count            // Can Set spell/trap
  for each:  (same as above)
uint32  activate_count        // Can activate effects
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
    uint64  effect_description
    uint8   client_mode        // EFFECT_CLIENT_MODE_*
uint8   can_battle_phase      // 1 if BP available
uint8   can_end_phase         // 1 if EP available
uint8   can_shuffle_hand      // 1 if shuffle available
```

### MSG_SELECT_BATTLECMD (10)

```
uint8   player
uint32  activate_count        // Activatable effects during battle
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
    uint64  effect_description
    uint8   client_mode
uint32  attack_count          // Cards that can attack
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
    uint8   direct_attackable  // 1 if can direct attack
uint8   can_main_phase_2      // 1 if M2 available
uint8   can_end_phase         // 1 if EP available
```

### MSG_SELECT_CARD (15)

```
uint8   player
uint8   cancelable            // 0 or 1
uint32  min_count
uint32  max_count
uint32  card_count
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
    uint32  position          // (subsequence for overlays)
```

### MSG_SELECT_UNSELECT_CARD (26)

```
uint8   player
uint8   finishable            // 1 if current selection is valid
uint8   cancelable
uint32  min_count
uint32  max_count
uint32  selectable_count      // Cards that CAN be selected
  for each:  (code + loc_info)
uint32  unselectable_count    // Cards that CANNOT be deselected
  for each:  (code + loc_info)
```

### MSG_SELECT_CHAIN (16)

```
uint8   player
uint8   spe_count             // Special chain count
uint8   forced                // 1 if must chain
uint32  hint_timing_0         // Current player timing
uint32  hint_timing_1         // Opponent timing
uint32  chain_count
  for each:
    uint8   flag
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
    uint32  position
    uint64  effect_description
    uint8   client_mode
```

### MSG_SELECT_EFFECTYN (12)

```
uint8   player
uint32  card_code
uint8   controller
uint8   location
uint32  sequence
uint32  position
uint64  description
```

### MSG_SELECT_YESNO (13)

```
uint8   player
uint64  description
```

### MSG_SELECT_OPTION (14)

```
uint8   player
uint8   option_count
  for each:
    uint64  option_value
```

### MSG_SELECT_PLACE (18) / MSG_SELECT_DISFIELD (24)

```
uint8   player
uint8   count                 // Number of zones to select
uint32  field_flag            // Bitmask of available zones
```

Zone bitmask encoding (32-bit):
- Bits 0-4: Player 0 Monster Zones (1-5)
- Bits 5-7: unused
- Bits 8-12: Player 0 Spell/Trap Zones (1-5)
- Bits 13: Player 0 Field Zone
- Bits 14-15: Player 0 Pendulum Zones
- Bits 16-20: Player 1 Monster Zones
- etc.
- A bit value of **0** means the zone IS selectable (inverted logic)

### MSG_SELECT_POSITION (19)

```
uint8   player
uint32  card_code
uint8   positions_mask        // Bitfield of allowed positions (POS_*)
```

### MSG_SELECT_TRIBUTE (20)

```
uint8   player
uint8   cancelable
uint32  min_count
uint32  max_count
uint32  card_count
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
    uint8   release_param      // Extra tribute parameter
```

### MSG_SELECT_COUNTER (22)

```
uint8   player
uint16  counter_type
uint16  counter_count         // How many counters to remove total
uint32  card_count
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
    uint16  current_counter_count
```

### MSG_SELECT_SUM (23)

```
uint8   player
uint8   select_mode           // 0 = exact sum, 1 = at least sum
uint32  target_sum
uint32  min_count
uint32  max_count
uint32  must_select_count     // Cards that MUST be selected
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
    uint32  param              // level1 = param & 0xFFFF, level2 = param >> 16
uint32  optional_count        // Cards that CAN be selected
  for each:  (same as above)
```

### MSG_SORT_CARD (25) / MSG_SORT_CHAIN (21)

```
uint8   player
uint32  card_count
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
```

### MSG_ANNOUNCE_RACE (140)

```
uint8   player
uint8   count                 // How many races to declare
uint64  available_mask        // Bitmask of valid races
```

### MSG_ANNOUNCE_ATTRIB (141)

```
uint8   player
uint8   count                 // How many attributes to declare
uint32  available_mask        // Bitmask of valid attributes
```

### MSG_ANNOUNCE_CARD (142) / MSG_ANNOUNCE_NUMBER (143)

```
uint8   player
uint8   option_count
  for each:
    uint64  option             // Card filter opcodes or number values
```

### MSG_ROCK_PAPER_SCISSORS (132)

```
uint8   player                // Which player must choose
```

---

## 6. Detailed Message Formats (State Update Messages)

### MSG_START (4)

```
uint8   player_type           // Bit flags for observer/first/second
[uint8  master_rule]          // Only if buffer length > 17 bytes
int32   lp_player1
int32   lp_player2
int16   deck_count_player1
int16   extra_count_player1
int16   deck_count_player2
int16   extra_count_player2
```

### MSG_MOVE (50)

```
uint32  card_code
uint8   from_controller
uint8   from_location
uint32  from_sequence
uint32  from_position
uint8   to_controller
uint8   to_location
uint32  to_sequence
uint32  to_position
uint32  reason                // REASON_* bitmask
```

### MSG_DRAW (90)

```
uint8   player
uint32  drawn_count
  for each:
    uint32  card_code
    uint32  position
```

### MSG_DAMAGE (91) / MSG_RECOVER (92) / MSG_PAY_LPCOST (100) / MSG_LPUPDATE (94)

```
uint8   player
uint32  amount
```

### MSG_NEW_TURN (40)

```
uint8   player                // Whose turn it now is
```

### MSG_NEW_PHASE (41)

```
uint16  phase                 // PHASE_* constant
```

### MSG_HINT (2)

```
uint8   hint_type             // HINT_* constant
uint8   player
uint64  data                  // Interpretation depends on hint_type
```

### MSG_WIN (5)

```
uint8   player                // Winner (0 or 1, or 2 for draw)
uint8   reason                // Win reason type
```

### MSG_SUMMONING (60) / MSG_SPSUMMONING (62) / MSG_FLIPSUMMONING (64)

```
uint32  card_code
loc_info location             // (10 bytes)
```

### MSG_SUMMONED (61) / MSG_SPSUMMONED (63) / MSG_FLIPSUMMONED (65)

```
(empty payload)
```

### MSG_CHAINING (70)

```
uint32  card_code
loc_info triggering_location
uint8   triggering_controller
uint8   triggering_location_byte
uint32  triggering_sequence
uint64  description
uint32  chain_count
```

### MSG_ATTACK (110)

```
loc_info attacker_location
loc_info target_location      // Empty if direct attack
```

### MSG_SET (54)

```
uint32  card_code
loc_info location
```

### MSG_POS_CHANGE (53)

```
uint32  card_code
uint8   controller
uint8   location
uint8   sequence
uint8   prev_position
uint8   curr_position
```

### MSG_CONFIRM_CARDS (31)

```
uint8   player
uint32  card_count
  for each:
    uint32  card_code
    uint8   controller
    uint8   location
    uint32  sequence
```

### MSG_SHUFFLE_HAND (33)

```
uint8   player
uint32  card_count
  for each:
    uint32  card_code
```

### MSG_TOSS_COIN (130)

```
uint8   player
uint8   coin_count
  for each:
    uint8   result             // 0 = tails, 1 = heads
```

### MSG_TOSS_DICE (131)

```
uint8   player
uint8   dice_count
  for each:
    uint8   result             // 1-6
```

### MSG_RELOAD_FIELD (162)

Complex message encoding the entire field state:

```
uint8   duel_rule
for player in [0, 1]:
    uint32  lp
    for zone in monster_zones[0..6]:
        uint8   has_card
        if has_card:
            uint8   position
            uint32  overlay_count
    for zone in spell_trap_zones[0..7]:
        uint8   has_card
        if has_card:
            uint8   position
    uint32  deck_count
    uint32  hand_count
    uint32  grave_count
    uint32  banished_count
    uint32  extra_count
    uint32  extra_pending_count
```

### MSG_HAND_RES (133)

```
uint8   result                // hand0 + (hand1 << 2), values 1-3 for RPS
```

---

## 7. Response Formats for OCG_DuelSetResponse

Responses are raw binary buffers passed to `OCG_DuelSetResponse(duel, buffer, length)`. The engine copies them into `game_field->returns.data` and interprets them based on the current pending message type.

### Response Decoding by Message Type

#### MSG_SELECT_IDLECMD

**Response**: 4 bytes (int32)
```
int32   response
  lower 16 bits: command_type
    0 = Normal Summon
    1 = Special Summon
    2 = Reposition
    3 = Monster Set
    4 = Spell/Trap Set
    5 = Activate Effect
    6 = To Battle Phase
    7 = To End Phase
    8 = Shuffle Hand
  upper 16 bits: index into corresponding array
```

Example: To activate the 3rd effect in the list: `(2 << 16) | 5` = `0x00020005`

#### MSG_SELECT_BATTLECMD

**Response**: 4 bytes (int32)
```
int32   response
  lower 16 bits: command_type
    0 = Activate chain effect
    1 = Attack with card
    2 = Go to Main Phase 2
    3 = Go to End Phase
  upper 16 bits: index into corresponding array
```

#### MSG_SELECT_CARD / MSG_SELECT_TRIBUTE / MSG_SELECT_SUM

**Response**: Variable length
```
// Type 0 format (default):
uint32  indices[]             // Array of selected card indices (0-based)

// Type 1 format:
uint16  indices[]             // Array of uint16 indices

// Type 3 format (bitfield):
bitfield selection            // One bit per card
```

The engine validates: count within [min, max], indices within bounds, no duplicates.

#### MSG_SELECT_UNSELECT_CARD

**Response**: 4 bytes (int32)
```
int32   index                 // Index of selected card, or -1 for cancel
```

#### MSG_SELECT_EFFECTYN / MSG_SELECT_YESNO

**Response**: 4 bytes (int32)
```
int32   answer                // 0 = No, 1 = Yes
```

#### MSG_SELECT_OPTION

**Response**: 4 bytes (int32)
```
int32   index                 // Index of chosen option (0-based)
```

#### MSG_SELECT_CHAIN

**Response**: 4 bytes (int32)
```
int32   index                 // Index of chosen chain, or -1 to pass
```

#### MSG_SELECT_PLACE / MSG_SELECT_DISFIELD

**Response**: 3 bytes per selection
```
for each zone selected:
    uint8   player            // 0 or 1
    uint8   location          // LOCATION_MZONE or LOCATION_SZONE
    uint8   sequence          // Zone index (0-6 for MZONE, 0-7 for SZONE)
```

Validation: sequence within bounds (0-4 for main zones, 5-6 for EMZ, etc.)

#### MSG_SELECT_POSITION

**Response**: 4 bytes (int32)
```
int32   position              // One of: POS_FACEUP_ATTACK (0x1),
                              //         POS_FACEDOWN_ATTACK (0x2),
                              //         POS_FACEUP_DEFENSE (0x4),
                              //         POS_FACEDOWN_DEFENSE (0x8)
```

#### MSG_SELECT_COUNTER

**Response**: 2 bytes per card (uint16 array)
```
uint16  counters[]            // Number of counters to remove from each card
```

Must sum to the requested total counter count.

#### MSG_SORT_CARD / MSG_SORT_CHAIN

**Response**: 1 byte per card
```
uint8   order[]               // New position for each card (0-based indices)
```

Or: all zeros to accept default order (no reordering).

#### MSG_ANNOUNCE_RACE

**Response**: 8 bytes (uint64)
```
uint64  race_mask             // Bitwise OR of selected RACE_* values
```

Must have exactly `count` bits set, all within `available_mask`.

#### MSG_ANNOUNCE_ATTRIB

**Response**: 4 bytes (uint32)
```
uint32  attribute_mask        // Bitwise OR of selected ATTRIBUTE_* values
```

#### MSG_ANNOUNCE_CARD / MSG_ANNOUNCE_NUMBER

**Response**: 4 bytes (uint32)
```
uint32  value                 // Card code or number value
```

#### MSG_ROCK_PAPER_SCISSORS

**Response**: 4 bytes (int32)
```
int32   choice                // 1 = Scissors, 2 = Rock, 3 = Paper
```

---

## 8. Existing TypeScript/JavaScript Parsers

### 1. @n1xx1/ocgcore-wasm (RECOMMENDED)

**Repository**: https://github.com/n1xx1/ocgcore-wasm
**Package**: https://jsr.io/@n1xx1/ocgcore-wasm
**Language**: TypeScript (95%)
**License**: AGPL-3.0 (inherited from OCGCore)

**What it provides**:
- Full WASM build of OCGCore (edo9300/ygopro-core compiled with Emscripten)
- Complete TypeScript message parser (`messages.ts`) handling all 60+ message types
- Complete response serializer (`responses.ts`) for all 20 response types
- Type-safe discriminated union types for all messages (`OcgMessage`)
- Type-safe response types (`OcgResponse`)
- All game constants as TypeScript enums (`OcgLocation`, `OcgPosition`, `OcgType`, etc.)
- Helper functions for parsing bitmasks (races, attributes, link markers, etc.)
- Works in Node.js, Deno, and browsers

**Architecture**: The `readMessage()` function takes a `BufferReader` and dispatches on the message type enum via a massive switch statement, returning typed `OcgMessage` objects. Response serialization works inversely via `writeResponse()`.

**Key API**:
```typescript
import { createCore } from "@n1xx1/ocgcore-wasm";

const core = await createCore({ /* options */ });
const duel = core.createDuel({ /* options */ });
core.startDuel(duel);

const status = core.duelProcess(duel);
const messages: OcgMessage[] = core.duelGetMessage(duel);

for (const msg of messages) {
    switch (msg.type) {
        case OcgMessageType.SELECT_CARD:
            // msg is typed as OcgMessageSelectCard
            const response: OcgResponseSelectCard = {
                type: OcgResponseType.SELECT_CARD,
                indices: [0, 2]  // select 1st and 3rd cards
            };
            core.duelSetResponse(duel, response);
            break;
    }
}
```

### 2. DarkNeos/neos-ts

**Repository**: https://github.com/DarkNeos/neos-ts
**Language**: TypeScript (97%) + React
**Purpose**: Full web client for YGOPro duels

**Message parsing location**: `src/api/ocgcore/ocgAdapter/stoc/stocGameMsg/`
- 43 individual parser files, one per message type
- Main router in `mod.ts` dispatches by MSG_* type via switch statement
- Uses Protocol Buffers (protobuf) for internal message representation
- Has both STOC (server-to-client) and CTOS (client-to-server) adapters
- Response encoding in `src/api/ocgcore/ocgAdapter/ctos/ctosGameMsgResponse/`

**Architecture notes**:
- Designed for network play (WebSocket to YGOPro server), not direct WASM
- STOC packet format: `[uint16_le: length][uint8: proto_id][payload]`
- Game messages are nested: STOC_GAME_MSG contains `[uint8: MSG_TYPE][...data]`
- Uses `BufferReaderExt` wrapper with methods like `readCardInfo()`, `readCardLocation()`

### 3. ygocore-interface (npm)

**Repository**: https://github.com/ghlin/node-ygocore-interface
**Package**: `npm install ygocore-interface`
**Language**: TypeScript (100%)
**Status**: WIP, older

**What it provides**:
- `parseMessage(buffer)` - Deserialize OCGCore message buffer into typed objects
- `parseCardQueryResult()` / `parseFieldCardQueryResult()` - Card query parsing
- Constants: LOCATION, POS, TYPE, QUERY, LINK_MARKER, DUEL flags
- Companion to `ygocore` npm package (Node.js native bindings)

### 4. mycard/srvpro

**Repository**: https://github.com/mycard/srvpro
**Language**: CoffeeScript (42%), JavaScript (38%), TypeScript (20%)
**Purpose**: YGOPro game server

- `YGOProMessages.ts` / `YGOProMessages.js` - Message handling
- Network packet format: `[uint16_le: length][uint8: proto][payload]`
- Handler priority system (levels 0-4)
- More focused on network relay than message parsing
- Message structure compatibility layer in `ygopro-msg-struct-compat.ts`

### 5. Other Language Implementations

| Project | Language | URL | Notes |
|---------|----------|-----|-------|
| IceYGO/ygosharp | C# | https://github.com/IceYGO/ygosharp | Full duel server, message parsing |
| melvinzhang/yugioh-ai | Python + C | https://github.com/melvinzhang/yugioh-ai | Python FFI to libygo.so |
| ghlin/node-ygocore | C++ + TS | https://github.com/ghlin/node-ygocore | Node.js native addon |
| Buttys/YGOCore | C# | https://github.com/Buttys/YGOCore | Duel server with message handling |

**No known Rust implementation** of the message parser was found.

---

## 9. Key Constants and Enums

### Locations (LOCATION_*)

| Constant | Value | Description |
|----------|-------|-------------|
| LOCATION_DECK | 0x01 | Main deck |
| LOCATION_HAND | 0x02 | Hand |
| LOCATION_MZONE | 0x04 | Monster Zone |
| LOCATION_SZONE | 0x08 | Spell/Trap Zone |
| LOCATION_GRAVE | 0x10 | Graveyard |
| LOCATION_REMOVED | 0x20 | Banished pile |
| LOCATION_EXTRA | 0x40 | Extra Deck |
| LOCATION_OVERLAY | 0x80 | XYZ overlay material |
| LOCATION_ONFIELD | 0x0C | MZONE + SZONE |
| LOCATION_FZONE | 0x100 | Field Zone |
| LOCATION_PZONE | 0x200 | Pendulum Zone |

### Positions (POS_*)

| Constant | Value | Description |
|----------|-------|-------------|
| POS_FACEUP_ATTACK | 0x1 | Face-up Attack position |
| POS_FACEDOWN_ATTACK | 0x2 | Face-down Attack (rare) |
| POS_FACEUP_DEFENSE | 0x4 | Face-up Defense position |
| POS_FACEDOWN_DEFENSE | 0x8 | Face-down Defense (Set) |
| POS_FACEUP | 0x5 | Any face-up |
| POS_FACEDOWN | 0xA | Any face-down |
| POS_ATTACK | 0x3 | Any attack position |
| POS_DEFENSE | 0xC | Any defense position |

### Phases (PHASE_*)

| Constant | Value |
|----------|-------|
| PHASE_DRAW | 0x01 |
| PHASE_STANDBY | 0x02 |
| PHASE_MAIN1 | 0x04 |
| PHASE_BATTLE_START | 0x08 |
| PHASE_BATTLE_STEP | 0x10 |
| PHASE_DAMAGE | 0x20 |
| PHASE_DAMAGE_CAL | 0x40 |
| PHASE_BATTLE | 0x80 |
| PHASE_MAIN2 | 0x100 |
| PHASE_END | 0x200 |

### Duel Mode Flags

| Constant | Description |
|----------|-------------|
| DUEL_MODE_MR5 | Master Rule 5 (current standard) |
| DUEL_MODE_MR4 | Master Rule 4 (Link era) |
| DUEL_MODE_SPEED | Speed Duel format |
| DUEL_MODE_RUSH | Rush Duel format |
| DUEL_MODE_GOAT | GOAT format |
| DUEL_EMZONE | Extra Monster Zones active |
| DUEL_PZONE | Pendulum Zones active |
| DUEL_SEPARATE_PZONE | Separate Pend. Zones (not in ST) |

### Hint Types (HINT_*)

| Constant | Value | Meaning of `data` field |
|----------|-------|------------------------|
| HINT_EVENT | 1 | String ID for event description |
| HINT_MESSAGE | 2 | String ID for generic message |
| HINT_SELECTMSG | 3 | String ID for "Select..." prompt |
| HINT_OPSELECTED | 4 | String ID for opponent's choice |
| HINT_EFFECT | 5 | Card code of activated effect |
| HINT_RACE | 6 | Race bitmask |
| HINT_ATTRIB | 7 | Attribute bitmask |
| HINT_CODE | 8 | Card code |
| HINT_NUMBER | 9 | Number value |
| HINT_CARD | 10 | Card code (for card-specific hints) |
| HINT_ZONE | 11 | Zone bitmask |

---

## 10. Implementation Recommendations for Skytrix

### Recommended Approach: Use @n1xx1/ocgcore-wasm

For Skytrix's solo combo testing simulator, `@n1xx1/ocgcore-wasm` is the best option because:

1. **Full engine in WASM**: No server needed, runs entirely in the browser
2. **TypeScript-first**: Type-safe message and response types
3. **Complete parser included**: All 60+ message types already parsed
4. **Response serialization included**: All 20 response types handled
5. **Active maintenance**: Built on edo9300/ygopro-core (the EDOPro fork)

### What Skytrix Needs to Handle

For a **solo combo testing** scenario, the critical messages are:

**Always needed** (minimum viable):
- MSG_SELECT_IDLECMD (main phase actions)
- MSG_SELECT_CARD (tribute targets, materials, etc.)
- MSG_SELECT_CHAIN (optional effect activation)
- MSG_SELECT_EFFECTYN (activate effect yes/no)
- MSG_SELECT_POSITION (ATK/DEF choice)
- MSG_SELECT_PLACE (zone selection for summons)
- MSG_SELECT_TRIBUTE (tribute selection)
- MSG_MOVE (track card movements)
- MSG_DRAW, MSG_NEW_TURN, MSG_NEW_PHASE (game flow)
- MSG_START, MSG_WIN (lifecycle)

**Frequently needed**:
- MSG_SELECT_SUM (Synchro/XYZ level selection)
- MSG_SELECT_UNSELECT_CARD (iterative material selection)
- MSG_SELECT_OPTION (choose between multiple effects)
- MSG_SELECT_BATTLECMD (if battle phase testing included)
- MSG_SORT_CARD (top-of-deck ordering)
- MSG_CHAINING/CHAINED/CHAIN_SOLVED (chain visualization)

**Rarely needed** (but may come up):
- MSG_SELECT_COUNTER (counter-based effects)
- MSG_ANNOUNCE_RACE/ATTRIB/CARD/NUMBER (declaration effects)

### Mapping to Skytrix Architecture

The OCGCore message protocol maps well to the existing architecture:

| OCGCore Concept | Skytrix Equivalent |
|-----------------|-------------------|
| `loc_info.location` (LOCATION_*) | `ZoneId` in BoardStateService |
| `loc_info.controller` (0/1) | Player side |
| `loc_info.sequence` (0-6) | Zone sequence/index |
| `loc_info.position` (POS_*) | CardInstance face-up/face-down state |
| SELECT_* messages | User prompts / CommandStackService commands |
| MSG_MOVE | BoardStateService zone-to-zone transfer |
| `card_code` | Card database lookup key |

### Alternative: Build Custom Parser

If not using ocgcore-wasm (e.g., to avoid AGPL license, or to use the manual simulation approach), Skytrix could build a **subset parser** that only handles the ~15 message types needed for solo testing. The neos-ts codebase provides excellent TypeScript reference implementations for each message type.

---

## 11. Sources

### Primary Sources (OCGCore Engine)

- **edo9300/ygopro-core**: https://github.com/edo9300/ygopro-core
  - `ocgapi_constants.h` - All MSG_*, LOCATION_*, POS_*, PHASE_* constants
  - `ocgapi.h` / `ocgapi.cpp` - Public C API
  - `ocgapi_types.h` - Structure definitions
  - `duel.h` / `duel.cpp` - Message buffering, binary serialization
  - `playerop.cpp` - Selection message construction + response parsing
  - `operations.cpp` - State update message construction
  - `processor.cpp` - Processor state machine

### TypeScript/JavaScript Parsers

- **@n1xx1/ocgcore-wasm**: https://github.com/n1xx1/ocgcore-wasm / https://jsr.io/@n1xx1/ocgcore-wasm
- **DarkNeos/neos-ts**: https://github.com/DarkNeos/neos-ts (parser in `src/api/ocgcore/ocgAdapter/`)
- **ygocore-interface**: https://www.npmjs.com/package/ygocore-interface / https://github.com/ghlin/node-ygocore-interface
- **mycard/srvpro**: https://github.com/mycard/srvpro

### Other Implementations

- **IceYGO/ygosharp** (C#): https://github.com/IceYGO/ygosharp
- **melvinzhang/yugioh-ai** (Python): https://github.com/melvinzhang/yugioh-ai
- **ghlin/node-ygocore** (Node native): https://github.com/ghlin/node-ygocore

### Documentation

- **Fluorohydride/ygopro Issue #2291**: How to use OCGCore APIs: https://github.com/Fluorohydride/ygopro/issues/2291
- **Fluorohydride/ygopro Issue #1613**: Expanding documentation: https://github.com/Fluorohydride/ygopro/issues/1613
