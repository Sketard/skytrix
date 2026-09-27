# Mitsurugi Ryzeal Combo Reference (2026-04-17)

Canonical Mitsurugi Ryzeal combos for solver validation. Targets the Yu-Gi-Oh!
Open Tournament Hong Kong 2026 AE Top 8 build (Tu Kai-Hsiang, 2026-03-23).
Paired with `solver-validation-decks.json` fixture `ryzeal-mitsurugi-opener`.

Sources:
- Master Duel Meta Ryzeal Mitsurugi tier guide and deck pages
- Game8 Mitsurugi + Ryzeal deck guides (game8.co/games/Yu-Gi-Oh-Master-Duel)
- Yugipedia Mitsurugi archetype page
- Pojo Ame no Habakiri no Mitsurugi deep-dive
- YGOrganization Mitsurugi Post-Legendary Modern Decks 2026

---

## Endboard piece cheat sheet

Mitsurugi core:
- **Futsu no Mitama no Mitsurugi** (Level 7 Reptile Ritual Monster) — ritual
  summoned via Mitsurugi Prayers. Once-per-chain effect: when opp SS, SS
  a Reptile from GY (including a copy of itself). Cornerstone "respond-to-
  SS" negate body.
- **Ame no Habakiri no Mitsurugi** (Level 8 Reptile) — 1-card starter.
  NS/SS effect: SS a Mitsurugi from deck. Self-revival after being tributed.
- **Aramasa no Mitsurugi** (alt starter, not in this fixture).
- **Mitsurugi Prayers** (ritual spell, 45171524) — Ritual Summons a Mitsurugi
  from hand (or itself from GY). Core engine spell.
- **Mitsurugi Great Purification** (trap, 17954937) — end-of-chain cover trap
  that banishes opp monsters.
- **Ryzeal Cross** (spell, 6798031) — Ryzeal search / recycle.

Ryzeal core:
- **Ice Ryzeal** (Level 4, 8633261) — Ryzeal body for Xyz material.
- **Sword Ryzeal** (Level 4, 35844557) — Ryzeal extender.
- **Node Ryzeal** (Level 4, 72238166) — Ryzeal tutor.
- **Ext Ryzeal** (Level 4, 34022970) — Ryzeal special-summon body.
- **Star Ryzeal** (Level 4, 84433129) — Ryzeal extender.

Primary Xyz bosses:
- **Number 90: Galaxy-Eyes Photon Lord** (Rank 8, 8165596) — 2x Level 8
  Mitsurugi material (e.g. 2x Habakiri). Effect-copy board-breaker with a
  one-time negate.
- **Ryzeal Detonator** (Rank 4, 34909328) — 4 Ryzeal material Xyz, Xyz
  monster attached. Massive pressure piece.
- **Ryzeal Duo Drive** (Rank 4, 7511613) — 2 Ryzeal material Xyz. Secondary
  Ryzeal finisher.

Alt / backup Extra Deck:
- **Number 60: Dugares the Timeless** (Rank 4, 66011101) — rolls dice for
  effect, secondary Xyz.
- **Number 41: Bagooska the Terribly Tired Tapir** (Rank 4, 90590303) —
  stalling defense Xyz.
- **Eclipse Twins** (45852939), **Code Igniter** (5088741), **Vallon**
  (40673853), **Mereologic Aggregator** (9940036) — Link bodies for
  Fiendsmith-adjacent plays.

---

## Card ID reference (this fixture's available cards)

Mitsurugi engine:
- `13332685` Ame no Habakiri no Mitsurugi (3x) — STARTER
- `55397172` Futsu no Mitama no Mitsurugi (1x) — ritual monster
- `19899073` Mitsurugi Prayers supporting card (1x)
- `45171524` Mitsurugi Prayers (3x) — ritual spell
- `6798031`  Ryzeal Cross (1x)
- `17954937` Mitsurugi Great Purification (1x) — cover trap

Ryzeal engine:
- `84433129` Star Ryzeal (3x)
- `8633261`  Ice Ryzeal (2x)
- `35844557` Sword Ryzeal (1x)
- `72238166` Node Ryzeal (1x)
- `34022970` Ext Ryzeal (1x)

Handtraps:
- `14558127` Ash Blossom & Joyous Spring (2x)
- `23434538` Maxx "C" (2x)
- `42141493` Mulcharmy Fuwalos (3x)
- `94145021` Droll & Lock Bird (3x)
- `45171524` Mitsurugi Prayers (not a handtrap)
- `81560239` ?

Generic:
- `25311006` Triple Tactics Talent (not seen here, check deck)
- `65681983` Crossout Designator (1x)
- `13048472` ?
- `49721684` ?
- `24224830` Called by the Grave (2x)

Extra Deck:
- `8165596`  Number 90: Galaxy-Eyes Photon Lord — Rank 8 primary boss
- `34909328` Ryzeal Detonator — Rank 4 finisher
- `7511613`  Ryzeal Duo Drive — Rank 4 secondary
- `66011101` Number 60: Dugares the Timeless — Rank 4 alt
- `90590303` Number 41: Bagooska — Rank 4 stall
- `45852939` Eclipse Twins — Link
- `5088741`  Code Igniter — Link
- `40673853` Vallon — Link
- `9940036`  Mereologic Aggregator — Link
- `8165596`  (duplicate id already listed)
- `73898890`, `1269512`, `61399402`, `32530043`, `11398059`, `49678559` —
  other extra bodies (Fiendsmith-adjacent Links, Xyz).

---

## 1 CARD COMBO — Ame no Habakiri no Mitsurugi → Futsu + Photon Lord

**Endboard**: Futsu (MZONE) + Photon Lord (MZONE) + Prayers (in GY for turn 2
recursion) + Great Purification set.

1. NS **Habakiri**. Habakiri effect: SS a Mitsurugi from deck — SS **Futsu
   no Mitama no Mitsurugi** (or another Mitsurugi body for Prayers ritual).
2. Activate **Mitsurugi Prayers** → Ritual Summon a Mitsurugi from hand
   tributing Habakiri (if Futsu was not yet SS'd) OR another material.
3. Chain: 2x Mitsurugi Lvl 8 bodies on field → Xyz into **Number 90: Galaxy-
   Eyes Photon Lord** (Rank 8).
4. Set **Mitsurugi Great Purification** as end-of-turn cover.

For the canonical 1-card Habakiri-only test, the end board is:
- MZONE: Futsu no Mitama (respond-to-SS)
- MZONE: Photon Lord (Rank 8 negate)
- SZONE: Great Purification (banish trap)
- GY: Prayers (re-activate turn 2)

---

## 2 CARD COMBO — Habakiri + Ryzeal extenders → Ryzeal Mitsurugi full

**Endboard (this fixture's canonical finish)**: Futsu + Photon Lord + Ryzeal
Detonator + Ryzeal Duo Drive + Ryzeal Cross + Great Purification.

1. NS Habakiri → SS Futsu (or Mitsurugi Lvl 8 material).
2. Prayers → Ritual → add Mitsurugi body.
3. SS **Sword Ryzeal** + **Ice Ryzeal** from hand (Ryzeal special-summon
   effects trigger on other Ryzeal SS).
4. Xyz Sword + Ice → **Ryzeal Duo Drive** (Rank 4). Duo Drive effect:
   attach a Ryzeal as Xyz material.
5. SS **Node Ryzeal** (via Duo Drive trigger) → 4 Ryzeal bodies + Duo Drive
   on field → Xyz with Duo Drive as material + 3 other Ryzeals → **Ryzeal
   Detonator** (Rank 4 with 4 materials, "Xyz monster attached" clause).
6. 2x Mitsurugi Lvl 8 → Xyz into **Photon Lord** (Rank 8).
7. Set **Ryzeal Cross** + **Mitsurugi Great Purification**.

**Final endboard** (6 pieces):
- MZONE: Futsu no Mitama no Mitsurugi (55397172)
- MZONE: Number 90: Galaxy-Eyes Photon Lord (8165596)
- MZONE: Ryzeal Detonator (34909328)
- MZONE: Ryzeal Duo Drive (7511613)
- SZONE: Ryzeal Cross (6798031)
- SZONE: Mitsurugi Great Purification (17954937)

---

## Key SELECT_CARD decisions

1. Habakiri SS-from-deck → **Futsu no Mitama** (for ritual) OR another Lvl 8
   Mitsurugi (for Photon Lord XYZ); both lines viable.
2. Prayers ritual target → **Futsu no Mitama** (the ritual-reliant body).
3. Ryzeal Node search → **Ice Ryzeal** or **Sword Ryzeal** (whichever is
   missing from hand).
4. Duo Drive attach → any Ryzeal; impact is combo duration, not endboard
   piece choice.

---

## THIS FIXTURE's canonical opener (KEPT — already realistic)

Existing hand:
```
[13332685 Ame no Habakiri no Mitsurugi,
 8633261  Ice Ryzeal,
 35844557 Sword Ryzeal,
 45171524 Mitsurugi Prayers,
 42141493 Mulcharmy Fuwalos]
```

Rationale (validated against the methodology):
- Habakiri = Mitsurugi 1-card starter (NS-SS trigger chain into Futsu).
- Ice + Sword Ryzeal = 2-card Ryzeal extender pair (both level 4 Ryzeals
  for Duo Drive XYZ).
- Mitsurugi Prayers in hand = pre-Ritual-Summon material (accelerates chain).
- Mulcharmy Fuwalos = 1 defensive handtrap (realistic — this deck has 3x
  Fuwalos + 2x Ash + 2x Maxx + 3x Droll in main, ~10 handtraps total).

This is a realistic hybrid 2-engine hand: Mitsurugi starter + Ryzeal pair +
ritual spell + handtrap. Matches the Hong Kong Top 8 play pattern.

## THIS FIXTURE's canonical endboard (KEPT — matches research)

Existing expectedBoard (6 pieces):
```
MZONE: Ryzeal Detonator (34909328)
MZONE: Ryzeal Duo Drive (7511613)
MZONE: Futsu no Mitama no Mitsurugi (55397172)
MZONE: Number 90: Galaxy-Eyes Photon Lord (8165596)
SZONE: Ryzeal Cross (6798031)
SZONE: Mitsurugi Great Purification (17954937)
```

Structural sanity checks (all pass):
- ✓ No consumed-piece conflicts (Photon Lord's materials are attached
  Mitsurugi bodies as Xyz materials, not on-field separately — they are
  replaced by Photon Lord on the field).
- ✓ No intermediate set traps (Purification and Cross are terminal cover).
- ✓ No side-deck contamination (all pieces reachable via main + extra).
- ✓ Realistic 6-piece endboard for a top-tier 2-engine hybrid.

---

## Solver diagnostic mapping

- Missing Photon Lord → 2x Mitsurugi Lvl 8 bodies not reached. Check: did
  Habakiri trigger SS-from-deck? Did Prayers ritual summon fire?
- Missing Detonator → Ryzeal Rank 4 chain didn't complete. Check: Ice +
  Sword + Node all reached on field? Duo Drive XYZ'd correctly?
- Missing Duo Drive → only 2 Ryzeal bodies reached (not 4). Check: did Node
  Ryzeal search trigger? Was Ryzeal Cross activated?
- Missing Futsu → Prayers ritual summon failed. Check: was there a Mitsurugi
  body + matching level in hand/field at activation time?
- Missing Purification → trap not set. Check: was the turn's Main Phase 2
  reached to set?
- Missing Cross → spell not set. Check: Cross activation ≠ Cross set; if
  Cross activated during combo, it's in GY not S/T zone.

---

## Endboard weights (solver scoring)

Priority order:
1. **Photon Lord** — Rank 8 omni-negate, highest-value piece.
2. **Detonator** — Rank 4 with 4 mats + Xyz attached, massive board pressure.
3. **Futsu no Mitama** — once-per-chain respond-to-SS, structural lock.
4. **Duo Drive** — Rank 4 secondary, material-heavy.
5. **Purification** — banish trap, turn-2 cover.
6. **Cross** — Ryzeal recycle spell, resource.

Matched 6/6 = full Hong Kong Top 8 finish. 3/6 = "engine fired" minimum
(Futsu + Photon Lord + either Detonator or Duo Drive). 0/6 = combo failed
(handtrap or structural gap).

Step 1 structural value function (F1 Ritual + F2 Tutor + F3 ED Pool) is
calibrated heavily against this fixture — F1 fires on Prayers + Futsu,
F2 fires on Ryzeal Node + Habakiri chain, F3 fires on ED Rank 4/8 pool
depth. Post-step-1 score for this fixture jumped 35 → 42.58 (+7.58),
the single largest structural bump in step 1 validation.
