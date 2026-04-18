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

**Extra Deck summon destinations under MR5 (April 2020 revision):**
- **Fusion / Synchro / Xyz** (non-Pendulum) → **any empty MZ** (EMZ or MZ1–MZ5). No Link-arrow requirement.
- **Link monsters** → EMZ or a MZ pointed to by any Link arrow.
- **Pendulum monsters Special Summoned from face-up ED** → EMZ or a MZ pointed to by any Link arrow. (Pendulum monsters from hand are unrestricted — standard SS.)

See §12 for the full MR5 slot-availability decision tree.

### 3.5 Fusion Summon
1. Activate Fusion Spell
2. Send Fusion Materials to GY (from hand/field; Pendulum redirect applies for field materials)
3. Place Fusion Monster from ED (face-down) → any empty MZ (MR5: no EMZ restriction)

### 3.6 Synchro Summon
1. Select 1 Tuner + 1+ non-Tuner on field (total Levels = Synchro Monster's Level)
2. Send all materials to GY (Pendulum redirect applies)
3. Place Synchro Monster from ED → any empty MZ (MR5: no EMZ restriction)
- Tokens CAN be Synchro Materials

### 3.7 XYZ Summon
1. Select 2+ face-up monsters on field with same Level
2. Stack as overlay materials underneath the XYZ Monster
3. Place XYZ Monster from ED → any empty MZ (MR5: no EMZ restriction), materials follow underneath
- **Tokens CANNOT be XYZ Materials**
- Materials are no longer "on the field" once attached

### 3.8 Link Summon
1. Select monsters on field (count = Link Rating)
2. Send materials to GY (Pendulum redirect applies)
3. Place Link Monster from ED → **EMZ or MZ pointed to by any Link arrow** (MR5 restriction applies to Links)
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
7. **Extra Deck summons under MR5:** Fusion/Synchro/Xyz → any empty MZ. Links (and Pendulum from face-up ED) → EMZ or linked MZ.
8. **GY is an ordered stack.** Top card matters. No rearranging.
9. **Shuffle Main Deck after searching.**
10. **Field Spell replacement → old one sent to GY** (not destroyed).
11. **Tokens CANNOT be XYZ Materials** (but CAN be Synchro/Fusion/Link/Tribute materials).
12. **Counters only on face-up field cards.** Removed on leave/flip face-down.
13. **Face-down banished cards are private.**
14. **Detached Pendulum XYZ Materials → ED face-up** (redirect applies).
15. **Traps must be Set 1 turn before activation.**
16. **MR5 EMZ/linked restriction applies ONLY to Link monsters and Pendulum-from-ED** (see §12). Fusion/Synchro/Xyz from ED can land in any empty MZ.
17. **Spell Speed 3 (Counter Traps) wins priority over SS2/SS1** (see §11.2).
18. **Chain resolution is LIFO.** Last link activated resolves first.
19. **Hard OPT binds the card name; Soft OPT binds each effect independently** (see §11.5).
20. **"When... you can" effects miss the timing when buried mid-chain** (see §11.6).

---

## 11. Effect Timing & Chain Rules

This section formalizes effect classification, activation timing, chain building, and OPT (Once-Per-Turn) semantics — the rules governing *when* an effect can be activated and *how* it interacts with other effects. These rules are implicit in the solver's interruption tagging schema (`trigger`, `sharedOpt`, `totalUsesPerTurn`) and Phase D latent interruption logic.

### 11.1 Effect Categories (Monsters)

| Category | Trigger Condition | When Activatable | Spell Speed | Example |
|---|---|---|---|---|
| **Ignition** | Player chooses | Own Main Phase only | 1 | Blue-Eyes burn, D/D/D Gate activation |
| **Trigger** | A specific event ("When/If X happens") | Immediately after the event, in a chain | 1 (mandatory / optional) | Ash Blossom on search, Nibiru on 5+ SS |
| **Quick** | Player chooses | Either player's turn, near any time | 2 | I:P Masquerena, Ghost Ogre, Infinite Impermanence |
| **Continuous** | Always | No activation — the effect is permanently applied while face-up | N/A | Skill Drain, Macro Cosmos, Apollousa |
| **Flip** | Monster flipped face-up | Immediately after the flip, in a chain | 1 | Man-Eater Bug, Morphing Jar |

**Solver `trigger` field mapping** (from `interruption-tags.json` schema):
- `chain` → Trigger or Quick effect that activates *in response* to opponent activations (covers most negates)
- `main` → Ignition effect (own Main Phase only)
- `quick` → Quick Effect (both turns)
- `trigger` → Mandatory/optional Trigger on an event (on-summon, on-destruction, etc.)
- `continuous` → Continuous effect (always active while face-up)

### 11.2 Spell Speed

| Speed | Categories | Chainable To |
|---|---|---|
| **SS1** | Normal Spells, Ignition Effects, Trigger Effects, Flip Effects, Continuous Effects | Cannot chain to anything — must start a chain |
| **SS2** | Quick-Play Spells, all Traps except Counter, Quick Effects | SS1, SS2 |
| **SS3** | **Counter Traps only** (Solemn Judgment, Solemn Strike, Red Reboot, Dark Bribe) | SS1, SS2, SS3 |

**Key rule:** a lower-speed effect cannot be chained to a higher-speed effect. An SS1 activation cannot respond to an SS2 Quick Effect — the opportunity has already passed.

**SS1 ignition on own turn** is unchainable *except* by SS2/SS3 effects — this is why Ash Blossom (SS2 Quick) can negate a Normal Spell activation (SS1).

### 11.3 Chain Building (LIFO Resolution)

1. **Active player** has the first response opportunity after any trigger or activation.
2. Players alternate passing priority until both pass — the chain closes.
3. **Resolution is LIFO:** last link activated resolves first, building back down to the initial activation.
4. Each chain link resolves fully (including all its sub-effects) before the next link begins resolving.
5. After the chain fully resolves, any **Trigger effects that triggered during resolution** form a new chain automatically (the "when the chain resolves" window).

**Solver implication:** during a chain, effects that would trigger from intermediate states (e.g., "When a monster is sent to the GY") may miss their timing if they were buried by a later chain link — see §11.6.

### 11.4 Response Windows

After each game action or sub-step, both players receive a window to respond. Typical windows on own turn:

- Draw Phase: after Standby-Phase triggers; after draw
- Main Phase 1: before each action; after Normal/Flip/Special Summon; after activating a Spell; after setting
- Battle Phase: entry (Start Step), before each attack declaration, after damage step, after replay
- End Phase: entry; after each End Phase trigger

**Opp turn** also has response windows for the defender — this is where **Quick Effects** and **Counter Traps** fire. Phase D latent interruption modeling in the solver (Masquerena, Super Poly) encodes this: the enabler must sit in a zone where a Quick Effect activation is legal on the opponent's turn.

### 11.5 Once-Per-Turn Variants

| Variant | Example Wording | Binding Scope | Solver Encoding |
|---|---|---|---|
| **Hard OPT (name)** | "You can only use this effect of *Card X* once per turn" | Card name across all copies. Additional copies of the same card can still use it. Wait — *HOPT binds the NAME*, so only one copy of Card X anywhere on the table can use this effect per turn | `sharedOpt: true` with `totalUsesPerTurn: 1` |
| **Soft OPT (effect)** | "You can only use each effect of *Card X* once per turn" | Each effect of the card independently. Multiple copies each have their own budget | Default per-effect `usesPerTurn`, no `sharedOpt` |
| **Shared OPT** | "You can only use 1 of the following effects of *Card X* per turn, and only once that turn" | All listed effects share a single budget. Using one spends them all for that copy | `sharedOpt: true` with `totalUsesPerTurn: 1` |
| **Once-per-chain** | "You can only use this effect once per chain" | Cannot be used twice in the same chain (e.g., Apollousa pip-negate) | Not yet modeled; future schema extension |

**Clarification** — most competitive negates are HOPT:
- Ash Blossom → HOPT (only one Ash can fire per turn regardless of copies)
- Ghost Belle → HOPT (same card family, separate budget from Ash)
- Effect Veiler → HOPT
- Infinite Impermanence → HOPT

### 11.6 Timing: "When" vs "If"

Konami Problem-Solving Card Text (PSCT) distinguishes two trigger forms:

- **"When [event] happens, you can [do Y]"** — the effect activates *immediately after* the event. If the event is buried mid-chain (not the last resolved link), the effect **misses the timing** and cannot activate.
- **"If [event] happens, [do Y]"** — the effect activates at the next legal opportunity regardless of chain timing. No missed-timing.

**Mandatory trigger effects** with "When" ("When X happens, do Y" — no "you can") also miss the timing.

**Solver implication:** the `trigger: 'trigger'` tag class does not currently distinguish When vs If. Many "on-summon" floodgate/search effects are technically "If" and can't be missed; others are "When" (e.g., Maxx "C"). For interruption scoring this rarely matters because interruption effects are usually Quick/Chain-class, not Trigger-class on a transient event.

### 11.7 Mandatory vs Optional

- **Mandatory** effects (no "you can"): resolve whenever triggered, cannot be skipped. Miss-the-timing rules still apply to When-mandatory.
- **Optional** effects ("you can"): the player chooses to activate or decline.

**Solver implication:** intermediate state reachability must account for mandatory trigger effects (they fire regardless of solver preference). Currently the solver's action space is player-choice-driven and does not branch on mandatory-trigger refusal.

### 11.8 Priority (Legacy Rule — Removed)

Old TCG had a "priority rule" letting the active player chain an Ignition effect to their own Normal Summon before opponent response. This was **removed in the 2014 PSCT overhaul**. Current rule: after a summon, the opponent has the first response opportunity. This matters for Kashtira / Shifter type intermediaries — a Normal Summoned monster with an Ignition effect cannot fire before the opponent's SS2 response window.

---

## 12. Master Rule 5 — Extra Monster Zone Ownership

This section formalizes the MR5 (April 2020) revision of Extra Deck summon locations and the skytrix FieldState convention. Previously (MR4) only the *middle* EMZ was accessible; MR5 loosens this and introduces the Link-arrow fallback, which is fundamental to the solver's Phase D slot-check logic.

### 12.1 The MR5 Core Rule (April 2020 revision)

MR5 **loosened** the MR4 restriction. Destinations depend on the monster type:

| Extra Deck summon type | Destination |
|---|---|
| **Fusion / Synchro / Xyz** (non-Pendulum) | **Any empty MZ** (MZ1–MZ5 or EMZ) — no Link-arrow requirement |
| **Link monsters** | EMZ **OR** MZ pointed to by any Link Monster's arrow (incl. opponent's) |
| **Pendulum monsters Special Summoned from face-up ED** | EMZ **OR** MZ pointed to by any Link arrow |

**Non-Extra-Deck Special Summons** (Ritual from hand, Reborn-from-GY, Special-Summonable Normal, Pendulum Summon from HAND) are NOT subject to any EMZ/linked restriction — they can land in any empty MZ.

**Strategic corollary — EMZ preservation:** although Fusion/Synchro/Xyz *can* land in EMZ, competitive play almost always routes them to a regular MZ to keep the EMZ free for a future Link Summon. A Synchro/Xyz in EMZ blocks Link-ladder plays more often than it helps. The structural scorer should treat "Extra Deck monster in EMZ (when it could have been in MZ)" as slightly *negative* structural value compared to the same monster in a regular MZ, except for Links (which have no choice).

### 12.2 EMZ Ownership Convention

There are **2 EMZs physically** (EMZ-L and EMZ-R), shared between both players.

**Ownership rule under MR5:**
- Each player "owns" at most **one** EMZ at a time — whichever is currently occupied by one of their cards.
- If neither EMZ is occupied, either slot is available to claim on the next Extra Deck summon.
- The other EMZ, once claimed by the opponent, is not accessible to the player *except* via the Link-arrow fallback (§12.1 rule 2).
- Both players can simultaneously occupy both EMZs (one each).

### 12.3 skytrix FieldState Convention

In `FieldState.zones`, both `EMZ_L` and `EMZ_R` are **player-0-relative** — the opponent's EMZs are **not represented** in FieldState at all. Only the player's own view of the 2 shared EMZs exists in the zone map.

**Implication:** an EMZ slot is "free" for the player's next Extra Deck summon iff `FieldState.zones.EMZ_L.length === 0 && FieldState.zones.EMZ_R.length === 0` — because the opponent's presence is modeled by hiding opponent-occupied slots from the zone map rather than by marking them occupied.

Phase E will revisit this encoding if bilateral modeling becomes necessary (e.g., for Kashtira-style EMZ banish effects).

### 12.4 Free-Slot Decision Tree (Extra Deck Summon)

Given a player wants to Extra Deck Summon a monster of category `C`:

**Branch A — Fusion / Synchro / Xyz (non-Pendulum):**
1. **Any empty MZ?** Scan M1..M5 and EMZ_L/EMZ_R. If any is empty → summon is legal. Link arrows are irrelevant.
2. **All 7 slots on the player's side occupied?** Summon is blocked (rare — requires a full board).

**Branch B — Link monster, or Pendulum monster from face-up ED:**
1. **EMZ available?** Yes if either `EMZ_L` or `EMZ_R` is empty in the player's zone map → summon can land there.
2. **Otherwise, linked MZ available?** Scan all face-up Link monsters on the field (both players). For each, compute its arrow targets in grid coordinates. If any arrow targets a player-side empty MZ, that zone is available.
3. **Neither?** The Extra Deck summon is blocked.

**Arrow grid** (MR5 layout, from player-0 perspective):

| Zone | Col | Row |
|---|---|---|
| EMZ_L | 2 | 2 |
| EMZ_R | 4 | 2 |
| M1 | 1 | 3 |
| M2 | 2 | 3 |
| M3 | 3 | 3 |
| M4 | 4 | 3 |
| M5 | 5 | 3 |

Arrow direction deltas: T/TL/TR point to row-1; L/R point to same-row neighbors; BL/B/BR point to row+1. Arrows pointing off-grid (opponent row, S row) yield no player-side slot.

### 12.5 Consumes-Self Exception (Phase D Encoding)

Quick Effect enablers that consume themselves as material (e.g., I:P Masquerena: tribute self to SS Link-2 using self + another monster) free their EMZ as part of the activation. The slot-check must treat the enabler's own EMZ as "empty" for this one summon.

Solver encoding: `consumesSelfAsMaterial: true` in `opp-turn-summon-enablers.json` triggers this exception at the slot-check stage.

### 12.6 Known Gaps (Deferred to Phase E)

- **Opponent EMZ representation** — skytrix FieldState hides opponent zones; bilateral modeling required for opp-Link-arrow scenarios and for Kashtira-style EMZ bans.
- **Sequential slot consumption** — the solver currently treats one Extra Deck summon in isolation; a multi-SS combo chain (Masquerena → Link-4 evolution) requires re-checking the slot map after each intermediate landing.
- **Token-MZ obstruction** — tokens occupy MZ slots just like monsters; their presence blocks linked-MZ fallback. The solver handles this correctly via `zone.length > 0` checks, but this section makes the invariant explicit.
- **Pendulum Summon MZ pool** — Pendulum Summons from face-up ED are subject to the same MR5 rule (EMZ or linked MZ). From hand, any empty MZ is valid (not MR5-restricted).
