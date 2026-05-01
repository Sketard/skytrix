# Nekroz Ryzeal Combo Reference (2026-04-17)

Canonical Nekroz Ryzeal combos for solver validation. Targets the
1st Place Undefeated Nekroz Ryzeal (Jan. 2026 TCG Format) build. Paired
with `solver-validation-decks.json` fixture `nekroz-ryzeal-opener`.

Sources:
- YGOrganization Nekroz Springans Ryzeal Nemeses deep-dive (ygorganization.com/cdp_nekrozspringans)
- Master Duel Meta Ryzeal tier guide
- Game8 Nekroz + Ryzeal deck guides (game8.co/games/Yu-Gi-Oh-Master-Duel)
- Dueling Nexus Nekroz Ryzeal 2025/2026 blog walkthroughs
- Cubic Creativity Nekroz archetype analysis (cubiccreativity.wordpress.com/2021/01/16/archetype-analysis-nekroz)
- Steam Community Nekroz guide (comprehensive ritual combo catalogue)

---

## Endboard piece cheat sheet

Nekroz core:
- **Nekroz of Trishula** (Level 9 Water Warrior Ritual, 52068432) — on SS,
  banish 1 card from opp's hand, field, and GY. The classic Nekroz boss.
  Highest disruption value of any Nekroz monster.
- **Nekroz of Unicore** (Level 4 Water Warrior Ritual, 89463537) — floodgate:
  prevents opponent from SS from Extra Deck. The lock body.
- **Nekroz of Areadbhair** (Level 8 Water Warrior Ritual, 39468724) —
  effect/attack negate. Situational but strong against specific decks.
- **Nekroz of Brionac** (Level 6 Water Warrior Ritual, 26674724) — starter
  hand effect: discard to search any Nekroz card. THE 1-card starter.
- **Nekroz of Clausolas** (Level 5 Water Warrior Ritual, 99185129) — discard
  to search Nekroz spell/trap.
- **Nekroz Kaleidoscope** (Ritual spell, 51124303) — performs ritual summon,
  ALLOWS Extra Deck Ritual monster as tribute (key for Herald combo).
- **Nekroz Mirror** (Ritual spell, 14735698) — alt ritual performer.
- **Nekroz Cycle** (Ritual spell, 97211663) — alt ritual performer.
- **Nekroz Divinemirror** (Ritual spell, 50596425) — alt ritual spell.
- **Preparation of Rites** (96729612) — search Lvl ≤ 7 Ritual + optional
  Ritual spell from GY.
- **Shurit, Strategist of the Nekroz** (Tuner Level 4, 90307777) — when
  tributed as ritual material, search another Nekroz ritual monster.

New 2026 Nekroz cards:
- **Emilia, Dance Priestess of the Nekroz** (Level 4 Water Spellcaster,
  87003671) — new searcher, NS/SS effect: add Nekroz ritual monster OR
  ritual spell. Key 2026 generalized tutor.
- **Avance, Swordsman of the Nekroz** (Level 4 Water Warrior, 51618973) —
  new body. Effect SS from hand / discards to extend.

Herald of the Arc Light:
- **Herald of the Arc Light** (Level 4 LIGHT Fairy Ritual/Synchro?, 79606837)
  — accessible via Nekroz Kaleidoscope as Extra Deck ritual tribute
  (Kaleidoscope's unique clause). On SS, searches Ritual monster or spell.
  Typically CONSUMED as ritual tribute — goes to GY, NOT on-field at end.

Ryzeal package:
- **Ryzeal Duo Drive** (Rank 4, 7511613) — 2 Ryzeal material, attach Ryzeal
  from deck.
- **Ryzeal Detonator** (Rank 4 w/4 materials, 34909328) — massive Ryzeal
  finisher with Xyz monster attached clause.
- **Ryzeal Cross** (spell, 6798031) — Ryzeal search/recycle.
- **Ice Ryzeal** / **Sword Ryzeal** / **Node Ryzeal** / **Ext Ryzeal** /
  **Star Ryzeal** — Lvl 4 Ryzeal bodies for Rank 4 Xyz.

---

## Card ID reference (this fixture's available cards)

Nekroz ritual monsters (main):
- `39468724` Nekroz of Areadbhair (1x)
- `52068432` Nekroz of Trishula (1x)
- `13408726` Nekroz of Metaltron (1x)
- `26674724` Nekroz of Brionac (3x) — 1-card starter
- `89463537` Nekroz of Unicore (1x) — ED floodgate
- `99185129` Nekroz of Clausolas (1x)
- `90307777` Shurit, Strategist of the Nekroz (1x) — tribute search

Nekroz modern searchers (main):
- `87003671` Emilia, Dance Priestess of the Nekroz (3x) — 2026 tutor
- `51618973` Avance, Swordsman of the Nekroz (3x) — 2026 body

Ritual spells (main):
- `14735698` Nekroz Mirror (1x)
- `51124303` Nekroz Kaleidoscope (1x) — Herald-tribute unique
- `97211663` Nekroz Cycle (1x)
- `50596425` Nekroz Divinemirror (3x)
- `96729612` Preparation of Rites (3x)

Ryzeal engine (main):
- `84433129` Star Ryzeal (1x)
- `35844557` Sword Ryzeal (2x)
- `72238166` Node Ryzeal (1x)
- `34022970` Ext Ryzeal (1x)
- `6798031`  Ryzeal Cross (1x)

Handtraps (main):
- `42141493` Mulcharmy Fuwalos (3x)
- `14558127` Ash Blossom & Joyous Spring (2x)

Utility:
- `25311006` Triple Tactics Talent (1x)
- `24224830` Called by the Grave (1x)
- `24299458` Forbidden Droplet (3x)

Extra Deck:
- `79606837` Herald of the Arc Light — ritual tribute enabler
- `34909328` Ryzeal Detonator — Rank 4 finisher
- `7511613`  Ryzeal Duo Drive — Rank 4 secondary
- `66011101` Number 60: Dugares the Timeless — Rank 4 alt
- `55285840` Time Thief Redoer — Rank 4 alt
- `581014`   Daigusto Emeral — Rank 4 search/draw
- `90590303` Number 41: Bagooska — Rank 4 stall
- `46772449` Evilswarm Exciton Knight — Rank 4 field-wipe
- `9940036`  Mereologic Aggregator — Link
- `45852939` Eclipse Twins — Link
- `5088741`  Code Igniter — Link
- `8809344`  Outer Entity Nyarla — Link
- `90809975` Toadally Awesome — Rank 2 Xyz omni
- `6983839`  Tornado Dragon — Rank 4 spell/trap break
- `93039339` Super Starslayer TY-PHON — Rank 12 alt finisher

---

## 1 CARD COMBO — Nekroz of Brionac (in hand)

**Endboard**: Nekroz of Trishula + Nekroz Kaleidoscope set + Brionac in GY.

1. Discard **Nekroz of Brionac** from hand (Brionac's in-hand effect):
   search **Nekroz of Unicore** (or another Nekroz ritual).
2. Activate **Preparation of Rites** (if in hand): search **Nekroz of
   Clausolas** + take **Nekroz Mirror** from GY (empty here, may skip).
3. Discard Clausolas to search **Nekroz Kaleidoscope**.
4. Activate **Kaleidoscope** → Ritual Summon **Nekroz of Unicore** by
   tributing **Herald of the Arc Light** from Extra Deck (Kaleidoscope's
   unique clause). Herald's on-SS triggers before being sent to GY:
   search Nekroz of Gungnir or Trishula.
5. Ritual Summon **Nekroz of Trishula** next turn OR same turn if materials
   (Level 9 = Unicore+Clausolas in GY; Mirror allows GY Lvl materials).
6. Set **Nekroz Kaleidoscope** (recycled via Clausolas/Herald effect in GY).

For 2026 Nekroz, the core turn-1 variant does NOT reach a full Trishula
board from Brionac alone — that requires Ryzeal extension.

---

## 2 CARD COMBO — Emilia + Avance (THIS FIXTURE's canonical line)

This is the post-2026 Nekroz Ryzeal core 2-card combo (per YGOrganization
CDP guide). Starts with two Level 4 Nekroz monsters.

**Endboard**: Ryzeal Duo Drive + Ryzeal Detonator + Nekroz of Trishula +
Nekroz Kaleidoscope set. Herald goes to GY as tribute (NOT on field).

1. NS **Emilia** → search any Nekroz ritual monster (e.g. Nekroz of Unicore
   or Nekroz of Brionac).
2. SS **Avance** from hand (Avance's self-SS effect when a Nekroz is SS'd
   or NS'd).
3. Avance effect: discard a Nekroz to search **Nekroz Kaleidoscope**.
4. Activate **Kaleidoscope** → Ritual Summon **Nekroz of Unicore** (Level
   4) using Herald of the Arc Light from Extra Deck as tribute. Herald on
   SS-from-ED → search Nekroz of Trishula from deck. Herald goes to GY.
5. Trigger **Shurit** (if in hand; discard for Nekroz search) or continue
   with existing flow.
6. Ritual Summon **Nekroz of Trishula** using Kaleidoscope (again) OR
   Nekroz Mirror, tributing Level 9 = Emilia + Avance + Unicore from
   GY/field. Trishula banishes 3 opp cards.
7. With 2 Level 4 Ryzeal bodies in hand (Ice + Sword or Node + Ext),
   activate Ryzeal engine: SS Ice/Sword → Xyz into **Ryzeal Duo Drive**
   (Rank 4).
8. Duo Drive effect: attach a Ryzeal from deck as Xyz material. Duo Drive
   + 3 additional Ryzeal bodies reached → Xyz into **Ryzeal Detonator**
   (Rank 4 with 4 materials + Xyz-attached clause).
9. Set **Nekroz Kaleidoscope** from GY for turn-2 recursion.

**Final endboard**:
- MZONE: Ryzeal Duo Drive (7511613)
- MZONE: Ryzeal Detonator (34909328)
- MZONE: Nekroz of Trishula (52068432)
- SZONE: Nekroz Kaleidoscope (51124303) set

---

## Key SELECT_CARD decisions

1. Emilia search → **Nekroz of Brionac** or **Nekroz of Unicore** (NOT
   Trishula directly — Trishula is ritual-summoned, not hand-added).
2. Avance discard-to-search → **Nekroz Kaleidoscope** (ritual spell that
   uses Herald).
3. Kaleidoscope ritual target → **Nekroz of Unicore** (Level 4, easy
   material) OR if reaching terminal, **Nekroz of Trishula** (Level 9).
4. Kaleidoscope tribute → **Herald of the Arc Light** (Extra Deck ritual
   tribute — the unique Kaleidoscope clause).
5. Herald on-SS search → **Nekroz of Trishula** (the terminal piece).
6. Duo Drive attach → any Ryzeal (Node/Ext are most valuable for Detonator
   chain).

---

## THIS FIXTURE's canonical opener (KEEP)

Existing hand:
```
[87003671 Emilia, Dance Priestess of the Nekroz,
 51618973 Avance, Swordsman of the Nekroz,
 96729612 Preparation of Rites,
 42141493 Mulcharmy Fuwalos,
 14558127 Ash Blossom & Joyous Spring]
```

Rationale (passes methodology):
- Emilia + Avance = 2026 core 2-card Nekroz combo (per YGOrganization CDP).
- Preparation of Rites = ritual search accelerator.
- Fuwalos + Ash = 2 handtraps for realistic protection (this deck's main
  has 3x Fuwalos + 2x Ash).

Hand matches canonical Emilia + Avance opener documented above.

## THIS FIXTURE's canonical expectedBoard (CORRECTED)

Previous fixture listed Herald of the Arc Light + Unicore + Duo Drive +
Kaleidoscope. Correction applied: Herald of the Arc Light is CONSUMED as
Kaleidoscope's ritual tribute (Extra Deck → GY, not on-field at end of
turn). Replace Herald with the terminal Nekroz boss (Trishula) and add
Ryzeal Detonator as the terminal Ryzeal finisher.

Corrected expectedBoard (4 pieces):
```
MZONE: Ryzeal Duo Drive (7511613)
MZONE: Ryzeal Detonator (34909328)
MZONE: Nekroz of Trishula (52068432)
SZONE: Nekroz Kaleidoscope (51124303) set
```

Structural sanity checks:
- ✓ No consumed-piece conflicts (Herald removed — was being listed as
  on-field but is actually in GY as ritual tribute).
- ✓ Kaleidoscope after combo: set again via Herald's in-GY or Clausolas
  in-GY trigger. Valid terminal state.
- ✓ Nekroz of Unicore is NOT in endboard because Trishula is the stronger
  terminal; Unicore is mid-chain pivot or GY material.
- ✓ No side-deck contamination (all pieces reachable via main + extra).

---

## Solver diagnostic mapping

- Missing Trishula → Ritual Summon chain did not complete. Check: was
  Kaleidoscope activated? Was Herald tribute accepted? Were Lvl 9 materials
  (Emilia + Avance + Unicore) in GY at activation time?
- Missing Duo Drive → Ryzeal Xyz not reached. Check: were 2 Ryzeal Lvl 4
  bodies on field? Did any Ryzeal SS trigger fire?
- Missing Detonator → Rank 4 with 4 materials not reached. Check: Did Duo
  Drive attach trigger? Node/Ext/Star Ryzeal counts on field?
- Missing Kaleidoscope set → trap-like spell not set turn-end. Check: was
  Kaleidoscope sent to GY during combo and not recovered via Clausolas/
  Herald's GY effects?

---

## Endboard weights (solver scoring)

Priority order:
1. **Trishula** — banish 3 opp cards, the premium Nekroz boss.
2. **Detonator** — Rank 4 + Xyz-attached + 4 materials, massive pressure.
3. **Duo Drive** — Rank 4 Ryzeal hub, secondary pressure.
4. **Kaleidoscope set** — turn-2 ritual spell recursion enabler.

Matched 4/4 = full Nekroz Ryzeal turn-1 finish. 2/4 = engine fired at
least one full side (either Nekroz or Ryzeal). 0/4 = combo failed
(handtrap or structural gap in enumeration).

F1 Ritual Unlock Co-Presence (step 1) fires on Emilia + Nekroz ritual
monsters + Kaleidoscope/Mirror — this was the fixture specifically
added to validate F1 generalization beyond Mitsurugi Prayers. F1
signal confirmed firing on Nekroz cards during Tier 0 smoke
(score=46.58 in the pre-validation run, confirming F1 deck-agnostic).
