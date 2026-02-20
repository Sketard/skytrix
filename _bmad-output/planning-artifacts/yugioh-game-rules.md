# Yu-Gi-Oh! TCG Complete Rules Reference — Solo Combo Simulator

**Purpose:** Formalized game rules reference for the skytrix solo combo testing simulator. Covers all zone rules, card movements, and special mechanics relevant to manual simulation.

**Source:** Official Yu-Gi-Oh! TCG Version 10.0 rulebook, Master Rule 5 (April 2020 revision), supplementary official rulings.

**Note:** The simulator does NOT enforce rules — this document serves as a reference for understanding game mechanics during UX design, epic creation, and development.

---

## 1. Game Field Zones

### 1.1 Zone Inventory (Single Player)

**On-field zones (cards here are "on the field"):**

| Zone ID | Zone Name | Capacity | Card Types Allowed |
|---------|-----------|----------|--------------------|
| MZ1-MZ5 | Monster Zones 1-5 | 1 each | Monster cards, Tokens |
| ST1 | Spell/Trap Zone 1 / Pendulum Zone Left | 1 | Spell, Trap, Pendulum Scale |
| ST2-ST4 | Spell/Trap Zones 2-4 | 1 each | Spell, Trap |
| ST5 | Spell/Trap Zone 5 / Pendulum Zone Right | 1 | Spell, Trap, Pendulum Scale |
| EMZ-L | Extra Monster Zone (Left) | 1 | Extra Deck monsters only |
| EMZ-R | Extra Monster Zone (Right) | 1 | Extra Deck monsters only |
| FZ | Field Zone | 1 | Field Spell cards only |

**Off-field zones:**

| Zone ID | Zone Name | Capacity | Ordering | Visibility |
|---------|-----------|----------|----------|------------|
| GY | Graveyard | Unlimited | Ordered stack (top matters) | Public — all cards visible |
| BN | Banished Zone | Unlimited | Unordered (face-up) + separate face-down pile | Face-up: public. Face-down: private |
| ED | Extra Deck | 0-15 | Face-down (private) + face-up Pendulum (public) | Owner sees all; opponent sees face-up only |
| MD | Main Deck | 40-60 | Ordered stack (top matters) | Private — no inspection without card effect |
| HAND | Hand | Unlimited | Ordered | Private to opponent |

### 1.2 Board Layout

```
                      [EMZ-L]          [EMZ-R]              [Banish]

[Field]    [MZ1]      [MZ2]   [MZ3]   [MZ4]    [MZ5]       [GY]

[ED]       [ST1/PZL]  [ST2]   [ST3]   [ST4]    [ST5/PZR]   [Deck]

[Controls]                    [HAND]
```

**Spatial adjacency (relevant for Link Arrows):**
- MZ1-MZ5 are in a single row
- ST1-ST5 are directly behind MZ1-MZ5 respectively
- EMZ-L is above and between MZ2/MZ3
- EMZ-R is above and between MZ3/MZ4

---

## 2. Card Positions and States

### 2.1 Monster Positions (On-Field)

| Position | Orientation | Face | Battle Stat | Notes |
|----------|-------------|------|-------------|-------|
| Face-up ATK | Vertical (portrait) | Visible | ATK | Default for Normal/Special Summon |
| Face-up DEF | Horizontal (landscape) | Visible | DEF | Link Monsters CANNOT be in this position |
| Face-down DEF | Horizontal (landscape) | Hidden | DEF | Set monsters; cannot attack |

**Illegal:** Face-down ATK does NOT exist.

### 2.2 Spell/Trap Positions

| Position | State | Notes |
|----------|-------|-------|
| Face-up | Activated/active | Continuous Spell/Trap, Equip, Field remain |
| Face-down | Set (not yet activated) | Traps must be Set 1 turn before activation |

### 2.3 Position Changes (Manual, per monster per turn)

- Face-up ATK ↔ Face-up DEF (once per turn, not the turn summoned)
- Flip Summon: Face-down DEF → Face-up ATK (triggers Flip Effects)

---

## 3. Card Movements — Exhaustive Catalog

### 3.1 Draw
- From: MD (top) → To: HAND
- If deck has 0 cards and must draw = deck-out (fail state)

### 3.2 Search (Add from Deck to Hand)
- From: MD (player chooses) → To: HAND
- **Post-action: SHUFFLE MD**

### 3.3 Normal Summon / Set

| Level | Cost | Position |
|-------|------|----------|
| 1-4 | None | ATK (summon) or face-down DEF (set) |
| 5-6 | Tribute 1 monster | ATK (summon) or face-down DEF (set) |
| 7+ | Tribute 2 monsters | ATK (summon) or face-down DEF (set) |

- Limited to 1 per turn (unless card effect grants additional)
- Tributed monsters → GY (Pendulum redirect applies if from field)

### 3.4 Special Summon

No limit per turn. Sources: Hand, GY, Banished, Deck, Extra Deck.

**Extra Deck monsters must go to:** EMZ or a Main Monster Zone that a Link Monster's arrow points to.

### 3.5 Fusion Summon
1. Activate Fusion Spell
2. Send Fusion Materials to GY (from hand/field; Pendulum redirect applies for field materials)
3. Place Fusion Monster from ED (face-down) → EMZ or linked MZ

### 3.6 Synchro Summon
1. Select 1 Tuner + 1+ non-Tuner on field (total Levels = Synchro Monster's Level)
2. Send all materials to GY (Pendulum redirect applies)
3. Place Synchro Monster from ED → EMZ or linked MZ
- Tokens CAN be Synchro Materials

### 3.7 XYZ Summon
1. Select 2+ face-up monsters on field with same Level
2. Stack as overlay materials underneath the XYZ Monster
3. Place XYZ Monster from ED → EMZ or linked MZ, materials follow underneath
- **Tokens CANNOT be XYZ Materials**
- Materials are no longer "on the field" once attached

### 3.8 Link Summon
1. Select monsters on field (count = Link Rating)
2. Send materials to GY (Pendulum redirect applies)
3. Place Link Monster from ED → EMZ or linked MZ
- Always Face-up ATK (no DEF)
- A Link Monster used as material can count as 1 OR as its Link Rating (player chooses)
- Tokens CAN be Link Materials (they vanish instead of going to GY)

### 3.9 Pendulum Summon
**Prerequisites:** Pendulum Monster in ST1 (Left Scale) + Pendulum Monster in ST5 (Right Scale), both face-up.

**Valid Level range:** Strictly between the two Scale values (exclusive).
- Example: Scale 1 + Scale 8 → Levels 2-7

**Sources:** Hand + face-up Extra Deck Pendulum Monsters in range.

**Destinations:**
- From hand → any empty MZ
- From ED face-up → EMZ or linked MZ

Once per turn. Does not use Normal Summon.

### 3.10 Ritual Summon
1. Activate Ritual Spell
2. Tribute from hand/field (total Levels ≥ Ritual Monster's Level)
3. Special Summon Ritual Monster from hand → any empty MZ
4. Ritual Spell → GY after resolution

### 3.11 Send to Graveyard

**From field (Pendulum redirect applies):**
- MZ/EMZ/ST/FZ → GY (Pendulum Monsters from field → ED face-up instead)

**From non-field (NO Pendulum redirect):**
- Hand (discard) → GY
- MD (mill) → GY
- ED/BN → GY

### 3.12 Banish
- Any zone → Banished (face-up or face-down)
- **Pendulum redirect does NOT apply** — banishing is not "sent to GY"

### 3.13 Return to Hand (Bounce)
- Any field zone → HAND
- **Extra Deck monsters returned to "hand" → ED face-down instead**
- Tokens returned to hand → vanish

### 3.14 Return to Deck
- Any zone → MD (top, bottom, or shuffle into)
- **Extra Deck monsters returned to "deck" → ED face-down instead**
- Shuffle MD if cards shuffled into deck

### 3.15 Equip
- Equip Spell placed in ST zone, associated with a face-up monster
- If equipped monster leaves field or flips face-down → Equip Card destroyed

### 3.16 Excavate / Reveal
- MD (top N) → temporarily visible → distribute per effect
- Post-action: shuffle MD if deck was searched through

---

## 4. XYZ Overlay Material Mechanics

### 4.1 Material Status
- NOT on the field (unique "attached" state)
- No position, no effects active, not monsters while attached
- Cannot be targeted by effects targeting "cards on the field"

### 4.2 Detaching
- Detach: overlay material → GY
- **Pendulum redirect applies:** Pendulum material → ED face-up
- Player chooses which material to detach
- XYZ Monster with 0 materials remains on field (unless effect says otherwise)

### 4.3 Attaching (by card effect)
- Attach from field/GY/hand/deck/banished → under XYZ Monster
- Card leaves its zone and becomes an overlay material

### 4.4 XYZ Monster Leaving Field
- Remaining overlay materials → GY (Pendulum redirect applies)
- Materials do NOT follow the XYZ Monster to its new zone

### 4.5 XYZ Evolution (Ranking Up)
- Use XYZ Monster as material for another XYZ Summon
- Old XYZ Monster + its materials all become materials of the new XYZ Monster

---

## 5. Pendulum Mechanics

### 5.1 Pendulum Zones = ST1 and ST5
- No separate Pendulum Zones under Master Rule 5
- Using both scales = only 3 S/T zones available (ST2-ST4)

### 5.2 Pendulum Monster on Field → GY = ED face-up instead
**Applies when:**
- Monster in MZ/EMZ/ST destroyed, tributed, used as material, sent by effect
- XYZ material detached (if Pendulum)

**Does NOT apply when:**
- Sent from HAND to GY (goes to GY normally)
- Milled from DECK to GY (goes to GY normally)
- Banished (goes to Banished)
- Returned to hand/deck (goes there, or ED if Extra Deck monster)

### 5.3 Face-up Extra Deck
- Pendulum Monsters redirected here are face-up
- Visible to both players
- Can be Pendulum Summoned back to field (to EMZ or linked MZ)

---

## 6. Link Monster Mechanics

### 6.1 Link Arrows (8 directions)
```
[TL] [T ] [TR]
[L ] [  ] [R ]
[BL] [B ] [BR]
```

### 6.2 "Linked" Zones
A Main Monster Zone is "linked" if a Link Monster's arrow points to it. Extra Deck monsters can be summoned there.

**EMZ-L arrows point to:** MZ2 (BL), MZ3 (BR)
**EMZ-R arrows point to:** MZ3 (BL), MZ4 (BR)
**MZ arrows:** Left/Right → adjacent MZ. Top → ST in same column.

### 6.3 Link Monster Properties
- No DEF, no Level, no Rank
- Always Face-up ATK, cannot be Set or put in DEF
- Link Rating functions as material cost for Link Summons

---

## 7. Token Mechanics

### 7.1 Properties
- Created by card effects, not summoned from any zone
- Always Normal Monsters (no effects)
- Have Name, Attribute, Type, Level, ATK, DEF as defined by creating effect

### 7.2 CAN be used as:
- Tribute, Fusion material, Synchro material, Link material

### 7.3 CANNOT:
- Be XYZ Materials
- Be Set (placed face-down)
- Exist anywhere except on the field

### 7.4 Leaving the Field
- **Token vanishes** — does not go to GY, hand, deck, or banished

---

## 8. Counter Mechanics

- Named markers on face-up cards on the field (e.g., "Spell Counter")
- Multiple counter types can coexist on one card
- Removed when card leaves field or is flipped face-down
- Only exist on face-up field cards

---

## 9. Card Movement Truth Table

| FROM \ TO | MZ | ST | EMZ | FZ | GY | BN | HAND | MD | ED |
|-----------|----|----|-----|----|----|----|----|----|----|
| HAND | Y | Y | - | Y | Y | Y | -- | Y | - |
| MZ | Y | Y | Y | - | Y* | Y | Y** | Y | Y** |
| ST | Y | Y | - | - | Y* | Y | Y | Y | - |
| EMZ | Y | - | Y | - | Y* | Y | Y** | Y | Y** |
| FZ | - | - | - | -- | Y | Y | Y | Y | - |
| GY | Y | Y | Y | - | -- | Y | Y | Y | Y |
| BN | Y | Y | Y | - | Y | -- | Y | Y | Y |
| MD | Y | Y | Y | Y | Y | Y | Y | -- | - |
| ED | Y | - | Y | - | Y | Y | Y*** | - | -- |
| Overlay | - | - | - | - | Y* | Y | Y | Y | Y* |

**Legend:**
- `Y*` = Pendulum redirect may apply (→ ED face-up instead of GY)
- `Y**` = Extra Deck monsters go to ED instead of hand/deck
- `Y***` = Rare; some effects add ED monsters to hand

---

## 10. Critical Rules Summary

1. **Pendulum Redirect:** Pendulum Monster on field → would go to GY → goes to ED face-up instead
2. **XYZ Materials are not on the field.** Cannot be targeted by field effects.
3. **Link Monsters: always Face-up ATK.** No DEF, no Set, no Defense Position.
4. **Tokens vanish when leaving the field.** Never go to GY/hand/deck/banished.
5. **Pendulum Zones = ST1 and ST5.** Not separate zones.
6. **Extra Deck monsters cannot be in hand or Main Deck.** Returned → ED face-down.
7. **Extra Deck summons → EMZ or linked MZ.**
8. **GY is an ordered stack.** Top card matters. No rearranging.
9. **Shuffle Main Deck after searching.**
10. **Field Spell replacement → old one sent to GY** (not destroyed).
11. **Tokens CANNOT be XYZ Materials** (but CAN be Synchro/Fusion/Link/Tribute materials).
12. **Counters only on face-up field cards.** Removed on leave/flip face-down.
13. **Face-down banished cards are private.**
14. **Detached Pendulum XYZ Materials → ED face-up** (redirect applies).
15. **Traps must be Set 1 turn before activation.**
