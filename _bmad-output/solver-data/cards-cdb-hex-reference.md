# cards.cdb Hex Reference (2026-04-21)

Canonical hex-to-name mapping for all bitmask/enum fields in `duel-server/data/cards.cdb`.
Source of truth: `duel-server/data/scripts_full/constant.lua` (mirrored from ygopro-core).
Reproducible decoder: `duel-server/scripts/dump-card-attrs.ts`.

**Rationale for this reference**: the discovery experiment on branded-dracotail (2026-04-21) surfaced a class of error where I transcribed card attributes from intuition instead of decoding the raw hex. Mis-typing 5 out of 10 Dracotail/Albaz monsters caused at least 2 candidate bridges to be wrong (Bridge 14 claimed Pan=DARK, actually WIND; Bridge 18 claimed Lukias=LIGHT Spellcaster, actually EARTH). This doc is the reference every effect-linking pass should consult before proposing material-slot matches.

---

## 1. ATTRIBUTE (single value)

A monster has exactly ONE attribute. Stored in `datas.attribute` as a single power-of-2 hex value.

| Hex | Name | Notes |
|---|---|---|
| `0x01` | EARTH | |
| `0x02` | WATER | |
| `0x04` | FIRE | |
| `0x08` | WIND | |
| `0x10` | LIGHT | |
| `0x20` | DARK | |
| `0x40` | DIVINE | Egyptian gods / Creator |

Non-monster cards (Spell/Trap) have `attribute=0`.

### Verification — branded-dracotail deck

| cardId | Name | attr hex | Attribute |
|---|---|---|---|
| 75003700 | Dracotail Lukias | `0x01` | EARTH |
| 1498449 | Dracotail Faimena | `0x02` | WATER |
| 84477320 | Dracotail Phryxul | `0x10` | **LIGHT** |
| 7375867 | Dracotail Mululu | `0x20` | **DARK** |
| 70871153 | Dracotail Urgula | `0x04` | FIRE |
| 44482554 | Dracotail Pan | `0x08` | **WIND** |
| 73819701 | Fallen of the White Dragon | `0x20` | DARK |
| 68468459 | Fallen of Albaz | `0x20` | DARK |
| 95515789 | Blazing Cartesia | `0x10` | LIGHT |
| 55273560 | Incredible Ecclesia | `0x10` | LIGHT |

(Bold entries are the ones I got wrong in the first discovery pass.)

---

## 2. RACE (single value; called "Type" in official rules)

A monster has exactly ONE race. Stored in `datas.race` as a single power-of-2 hex value.

| Hex | Name |
|---|---|
| `0x00000001` | WARRIOR |
| `0x00000002` | SPELLCASTER |
| `0x00000004` | FAIRY |
| `0x00000008` | FIEND |
| `0x00000010` | ZOMBIE |
| `0x00000020` | MACHINE |
| `0x00000040` | AQUA |
| `0x00000080` | PYRO |
| `0x00000100` | ROCK |
| `0x00000200` | WINGED BEAST |
| `0x00000400` | PLANT |
| `0x00000800` | INSECT |
| `0x00001000` | THUNDER |
| `0x00002000` | DRAGON |
| `0x00004000` | BEAST |
| `0x00008000` | BEAST-WARRIOR |
| `0x00010000` | DINOSAUR |
| `0x00020000` | FISH |
| `0x00040000` | SEA SERPENT |
| `0x00080000` | REPTILE |
| `0x00100000` | PSYCHIC |
| `0x00200000` | DIVINE |
| `0x00400000` | CREATOR GOD |
| `0x00800000` | WYRM |
| `0x01000000` | CYBERSE |
| `0x02000000` | ILLUSION |
| `0x04000000` | CYBORG (unofficial) |
| `0x08000000` | MAGICAL KNIGHT (unofficial) |
| `0x10000000` | HIGH DRAGON (unofficial) |
| `0x20000000` | OMEGA PSYCHIC (unofficial) |
| `0x40000000` | CELESTIAL WARRIOR (unofficial) |
| `0x80000000` | GALAXY (unofficial) |
| `0x4000000000000000` | YOKAI (Rush Duel) |

`RACE_ALL = 0x3ffffff` = union of all official races.
Non-monster cards have `race=0`.

### Common multi-race groupings (for material requirements)

| Constant | Members |
|---|---|
| `RACES_BEAST_BWARRIOR_WINGB` | BEAST \| BEAST-WARRIOR \| WINGED BEAST |

---

## 3. TYPE (bitmask — multiple bits can combine)

Stored in `datas.type` as a hex bitmask. Typical cards combine 2-4 bits (e.g. Effect Monster = `MONSTER | EFFECT = 0x21`).

### Top-level category (exactly one of)

| Hex | Name |
|---|---|
| `0x0001` | MONSTER |
| `0x0002` | SPELL |
| `0x0004` | TRAP |

### Monster classification bits

| Hex | Name | Notes |
|---|---|---|
| `0x0010` | NORMAL | Vanilla monster |
| `0x0020` | EFFECT | Has an effect |
| `0x0040` | FUSION | Extra-deck Fusion summon |
| `0x0080` | RITUAL | Ritual Monster OR Ritual Spell (works on both) |
| `0x0100` | TRAP MONSTER | Trap that summons as monster (rare) |
| `0x0200` | SPIRIT | |
| `0x0400` | UNION | |
| `0x0800` | GEMINI (= DUAL) | |
| `0x1000` | TUNER | |
| `0x2000` | SYNCHRO | Extra-deck Synchro summon |
| `0x4000` | TOKEN | |
| `0x8000` | MAXIMUM | Rush Duel (ignored in standard decks) |
| `0x0080_0000` | XYZ | Extra-deck Xyz summon |
| `0x0100_0000` | PENDULUM | |
| `0x0200_0000` | SPSUMMON | Special-Summon-only (e.g. Cyber Dragon-style restriction) |
| `0x0400_0000` | LINK | Extra-deck Link summon |

`TYPE_EXTRA = 0x4802040` = `FUSION | SYNCHRO | XYZ | LINK`.

### Spell subtype bits (combined with `TYPE_SPELL`)

| Hex | Name |
|---|---|
| `0x1_0000` | QUICK-PLAY |
| `0x2_0000` | CONTINUOUS (Spell) |
| `0x4_0000` | EQUIP |
| `0x8_0000` | FIELD |
| `0x80` | RITUAL |

Normal Spell = `TYPE_SPELL` alone (no subtype bit) = `0x2`.

### Trap subtype bits (combined with `TYPE_TRAP`)

| Hex | Name |
|---|---|
| `0x2_0000` | CONTINUOUS (Trap) |
| `0x10_0000` | COUNTER |

Normal Trap = `TYPE_TRAP` alone = `0x4`.

### Rush Duel / special / unused in standard format

| Hex | Name |
|---|---|
| `0x0200000` | FLIP |
| `0x0400000` | TOON |
| `0x0800_0000` | SKILL (Speed Duel) |
| `0x1000_0000` | ACTION |
| `0x2000_0000` | PLUS (Rush Duel Maximum) |
| `0x4000_0000` | MINUS (Rush Duel Maximum) |
| `0x8000_0000` | ARMOR (Rush Duel) |

---

## 4. Common TYPE combinations (quick lookup)

Verified against branded-dracotail + mitsurugi + ryzeal deck cards:

| Hex | Decoded | Example cards |
|---|---|---|
| `0x21` | Effect Monster | Lukias, Faimena, Fallen of Albaz, Mulcharmy Fuwalos |
| `0x61` | Effect Fusion Monster | Arthalion, Secreterion, Albion Branded, Mirrorjade |
| `0xa1` | Effect Ritual Monster | Futsu no Mitama, Habakiri, Murakumo |
| `0x1021` | Effect Tuner Monster | Effect Veiler, Ash Blossom, Incredible Ecclesia, Blazing Cartesia |
| `0x2021` | Effect Synchro Monster | Ecclesia and the Dark Dragon |
| `0x4021` | Effect XYZ Monster | Number 90 Galaxy-Eyes Photon Lord (hex re-check via script) |
| `0x0800_0061` | Effect Fusion Xyz? | N/A — unusual |
| `0x02` | Normal Spell | Ketu, Rahu, Branded Fusion, Mitsurugi Ritual |
| `0x82` | Ritual Spell | Mitsurugi Ritual, Mitsurugi Mirror |
| `0x04` | Normal Trap | Dracotail Sting, Dracotail Horn, Dracotail Flame |
| `0x1_0002` | Quick-Play Spell | Called by the Grave, The Fallen & The Virtuous, Mitsurugi Great Purification (verify) |
| `0x2_0004` | Continuous Trap | (Mandate, etc. — verify per deck) |
| `0x10_0004` | Counter Trap | (Solemn Strike, etc.) |
| `0x8_0002` | Field Spell | (Terraforming targets) |

**Note**: some published card descriptions in the combo plan / fixtures were hand-typed and occasionally misclassify Quick-Play Spells as Traps. cards.cdb is authoritative.

---

## 5. LEVEL encoding (Pendulum special case)

`datas.level` is a 32-bit integer packed as:

- Bits `0..7` (`level & 0xff`) — card level (or Link rating for Link monsters)
- Bits `16..23` (`(level >> 16) & 0xff`) — Pendulum LEFT scale (0 for non-Pendulum)
- Bits `24..31` (`(level >> 24) & 0xff`) — Pendulum RIGHT scale (0 for non-Pendulum)

Standard monsters: `level` is just the decimal level (1-12). Spells/Traps: `level=0`.

---

## 6. POSITION constants (reference only, not in cards.cdb but in message flow)

From `constant.lua` — used by the duel engine for face-up/face-down, attack/defense position encoding. Not directly relevant for static card analysis but useful when correlating with game-state messages.

| Hex | Name |
|---|---|
| `0x1` | FACEUP_ATTACK |
| `0x2` | FACEDOWN_ATTACK |
| `0x4` | FACEUP_DEFENSE |
| `0x8` | FACEDOWN_DEFENSE |
| `0x5` | FACEUP (atk OR def) |
| `0xa` | FACEDOWN (atk OR def) |
| `0x3` | ATTACK (faceup OR facedown) |
| `0xc` | DEFENSE (faceup OR facedown) |

---

## 7. REASON flags (for tracing *why* a card was sent somewhere)

Not in cards.cdb but surface in ocgcore messages. Useful when interpreting replays/trajectories.

| Hex | Name |
|---|---|
| `0x1` | DESTROY |
| `0x2` | RELEASE (tribute) |
| `0x4` | TEMPORARY |
| `0x8` | MATERIAL |
| `0x10` | SUMMON |
| `0x20` | BATTLE |
| `0x40` | EFFECT |
| `0x80` | COST |
| `0x100` | ADJUST |
| `0x200` | LOST_TARGET |
| `0x400` | RULE |
| `0x800` | SPSUMMON |
| `0x1000` | DISSUMMON |
| `0x2000` | FLIP |
| `0x4000` | DISCARD |
| `0x8000` | RDAMAGE |
| `0x1_0000` | RRECOVER |
| `0x2_0000` | RETURN |
| `0x4_0000` | FUSION |
| `0x8_0000` | SYNCHRO |
| `0x10_0000` | RITUAL |
| `0x20_0000` | XYZ |
| `0x100_0000` | REPLACE |
| `0x200_0000` | DRAW |
| `0x400_0000` | REDIRECT |
| `0x800_0000` | EXCAVATE (= REVEAL) |
| `0x1000_0000` | LINK |

---

## 8. SUMMON_TYPE flags (replay parsing)

32-bit summon-type id with a category in the high bits + subtype in the low bits. Used in messages describing how a monster was summoned.

| Hex | Name |
|---|---|
| `0x1000_0000` | NORMAL |
| `0x1100_0000` | TRIBUTE |
| `0x1200_0000` | GEMINI |
| `0x2000_0000` | FLIP |
| `0x4000_0000` | SPECIAL |
| `0x4300_0000` | FUSION |
| `0x4500_0000` | RITUAL |
| `0x4600_0000` | SYNCHRO |
| `0x4900_0000` | XYZ |
| `0x4A00_0000` | PENDULUM |
| `0x4C00_0000` | LINK |

---

## 9. Decoder usage

Programmatic decoding from TS:

```ts
import { decodeCardMetadata } from './src/solver/card-metadata.js';
// decodeCardMetadata returns human-readable strings for type/race/attribute
```

CLI inspection:

```bash
npx tsx scripts/dump-card-attrs.ts 75003700 7375867 84477320
# outputs: cardId, name, type(decoded), race, attribute, level, atk/def
```

---

*End of reference. Consult this before proposing any material-slot match in discovery work.*
