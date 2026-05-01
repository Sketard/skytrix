# D/D/D Combo Reference (2026-04-16)

Canonical D/D/D one-card and low-card combos used as the golden reference for
solver validation. Source: competitive D/D/D player notes (user-provided).
Paired with `solver-validation-decks.json` fixture `ddd-pendulum-opener`.

This document exists so that when the solver's main path diverges from a
canonical line, we can diagnose **which specific step** it decroches on
(wrong SELECT_CARD target, wrong chain order, missing move enumeration, etc.).

---

## Endboard piece cheat sheet

- **D/D/D Deviser King Deus Machinex** — attaches monster cards on the field
  (including PZONE cards) to itself when they activate their effect, by
  detaching 2 xyz materials OR destroying your own Dark Contracts. Resolves
  fully even if Machinex left the field (destroys contracts regardless).
- **D/D/D Sky King Zeus Ragnarok** — negates monster effect in hand by banishing
  a D/D and a Dark Contract from GY for cost.
- **D/D/D Cursed King Siegfried** — targeted backrow negate until the next
  standby phase.
- **D/D/D Wave High King Caesar** — negates effects that include special
  summoning (except from field spell / continuous S/T due to wording); boosts
  itself and another D/D.
- **D/D/D Super Doom King Bright Armageddon** — monster targeting protection
  for your D/D monsters. Niche effect against pendulums (Enneacraft ignores).
- **D/D/D Headhunt** — targeted monster negate + steal. If the stolen monster
  is an ED monster, treats it as a D/D/D so you can use it as fusion material.
  Clogs the field otherwise (cannot attack).
- **D/D/D Flame High King Genghis** — situational cover piece, backrow negate
  but only on your turn. Not a true endboard piece.

---

## Card ID reference (for solver / fixture work)

Starters in the D/D/D fixture:
- `11609969` D/D Savant Kepler (Scale 10, 1-card starter)
- `46796664` D/D Savant Copernicus (Scale 1, Pendulum target + D/D)
- `42382265` D/D Scale Surveyor (Scale 9, 1.5-card starter)
- `46372010` Dark Contract with the Gate (1-card starter)
- `42141493` Mulcharmy Fuwalos (handtrap, not used own turn)

Combo-critical intermediates (reached via search/dump/SS):
- `20715411` D/D/D Zero Doom Queen Machinex (starter, 3x in deck)
- `5997110`  D/D Count Surveyor (lvl 8, scale 1 — 1x in deck)
- `67322708` D/D Lance Soldier (lvl 2 — 1x in deck)
- `72291412` D/D Necro Slime (lvl 1 — 1x in deck, fusion material)
- `28406301` D/D Gryphon (lvl 4, scale 1 — 3x in deck)
- `72181263` D/D Orthros (lvl 4, scale 3 — 1x in deck)
- `74069667` D/D/D Oblivion King Abyss Ragnarok (lvl 8, scale 5 — 1x in deck)
- `19580308` D/D Lamia (not in deck, used in some variants)
- `41546`    D/D Savant Thomas (NOT in current fixture deck)
- `93317313` D/D Defense Soldier (NOT in current fixture deck)

Dark Contracts (searched via Kepler / set via Doom Queen):
- `46372010` Dark Contract with the Gate (search D/D monster) — 3x in deck + in hand
- `32665564` Dark Contract with the Zero King (pop D/D → SS D/D from deck) — 1x in deck
- `9030160`  Dark Contract with the Eternal Darkness — 1x in deck
- `73360025` Dark Contract with the Swamp King (NOT in current fixture deck)

Boss monsters (Extra Deck, fusion/xyz):
- `44852429` D/D/D Cursed King Siegfried
- `72402069` D/D/D Super Doom King Bright Armageddon
- `79559912` D/D/D Wave High King Caesar
- `30998403` D/D/D Sky King Zeus Ragnarok
- `71398055` D/D/D/D Dimensional King Arc Crisis
- `74583607` D/D/D Flame King Genghis (High Genghis)
- `70576413` D/D/D First King Clovis
- `3758046`  D/D/D Wise King Solomon
- `32232538` D/D/D Marksman King Tell
- `71612253` D/D/D Deviser King Deus Machinex
- `46593546` D/D/D Deviser King Deus Machinex (2x)
- `62541668` Number 77: The Seven Sins
- `9024198`  D/D/D Abyss King Gilgamesh (2x)

Spells/Traps:
- `91781484` D/D/D Headhunt (trap)

---

## 1 CARD COMBO — Doom Queen Machinex (FULL endboard)

**Endboard**: Deus Machinex + 1 contract, High Caesar, Siegfried, Zeus, Headhunt

1. Scale Doom Queen Machinex → place Dark Contract with the Gate from deck.
2. Gate → search Kepler. NS Kepler → search Zero Contract.
3. Zero Contract → pop Doom Queen Machinex → SS Copernicus.
4. Copernicus → dump Lance Soldier to GY.
5. Lance Soldier self-SS by popping Zero Contract.
6. Doom Queen Machinex returns from ED (triggered by Zero Contract pop).
7. Doom Queen Machinex + Kepler → **Gilgamesh** (5th summon). Gilg effect: scale
   Gryphon and Scale Surveyor from deck.
8. Gilgamesh + Copernicus → **Zeus**.
9. Pend Summon Copernicus + Doom Queen Machinex.
10. Zeus pop Scale Surveyor → gain extra Pend Summon (unused, just for the pop).
11. Scale Surveyor effect: return Gryphon to hand → self-SS Gryphon.
12. Gryphon + Copernicus → **Solomon** → search Abyss Ragnarok.
13. Scale Abyss Ragnarok. Solomon → **Tell**, use effect.
14. Doom Queen Machinex + Tell → Gilgamesh. Tell dump Necro Slime.
15. Necro Slime → fuse with Gilgamesh → **Genghis**.
16. Abyss Ragnarok revive Gryphon → search Headhunt.
17. Gryphon + Lance Soldier → **Clovis** → bring Lance back.
18. Clovis + Lance Soldier → **Siegfried**. Genghis revive Clovis. Clovis + Genghis → **High Caesar**.
19. Gilgamesh → **Deus Machinex**. Set Headhunt.

**Key SELECT_CARD decisions in order**:
1. Gate search → **Kepler** (NOT another D/D)
2. Kepler search → **Zero Contract** (NOT Eternal Darkness, NOT Swamp King)
3. Copernicus dump → **Lance Soldier** (enables chain of pops/revives)
4. Gilgamesh scale placement → **Gryphon + Scale Surveyor** (from deck)
5. Solomon search → **Abyss Ragnarok**
6. Tell dump → **Necro Slime** (fusion material for Genghis)
7. Gryphon (from Abyss revive) search → **Headhunt**

---

## 1 CARD COMBO — Doom Queen Machinex (plays through Nibiru)

**Endboard**: Deus Machinex + 2 contracts, High Caesar, Zeus, Headhunt

1. Scale Doom Queen Machinex → place Gate from deck.
2. Search Kepler → NS → search Zero Contract.
3. Zero Contract pop Doom Queen Mach → SS Cope. Cope dump Lance.
4. Cope + Kepler → **Gilgamesh**. Scale Gryphon + Thomas.
5. Bring Lance back popping Gate.
6. Lance + Gilgamesh → **Zeus** (5th summon). Now has D/D + Contract in GY, can negate Nibiru.
7. Pend Summon Cope.
8. Gryphon pop itself → Thomas adds it back → self-SS Gryphon.
9. Gryphon + Cope → **Solomon** → search/scale Abyss Ragnarok.
10. Solomon → **Tell**, use effect.
11. Zeus pop Tell → gain pend summon. CL1 Tell dump Necro Slime, CL2 Doom Queen Mach return from ED.
12. Necro Slime fuse Gilgamesh + itself → **Genghis**.
13. Abyss bring back Gryphon. CL1 Gryphon add Headhunt, CL2 Genghis bring Cope back.
14. Cope + Gryphon → **Caesar** → Caesar + Doom Queen Mach → **Gilgamesh**. Caesar search Swamp King Contract.
15. Swamp King fuse → 2nd **Genghis**. Both → **High Caesar**. Gilgamesh → **Deus Machinex**. Set Headhunt.

---

## 1 CARD COMBO — Dark Contract with the Gate (MOST RELEVANT to our fixture)

**Endboard**: FULL — Deus Machinex + 1 contract, High Caesar, Siegfried, Zeus, Headhunt

1. **Gate → search Doom Queen Machinex** (this sets Zero Contract as a passive).
2. Zero Contract pop Doom Queen Machinex → SS Count Surveyor → adds Copernicus to hand.
3. NS Copernicus → dump Lance Soldier.
4. Copernicus + Count → **Gilgamesh**. Scale Scale Surveyor + Gryphon.
5. Pend Summon Copernicus + Count.
6. Gilgamesh + Count → **Zeus**.
7. Lance Soldier pop Zero Contract → return. Doom Queen Machinex return from ED.
8. Zeus pop Scale Surveyor → add Gryphon back. Self-SS Gryphon.
9. Gryphon + Cope → **Solomon** → search Scale Surveyor.
10. Scale Surveyor self-SS and become level 4.
11. Solomon → **Tell**, use effect.
12. Doom Queen Machinex + Tell → **Gilgamesh**. Tell dump Necro Slime.
13. Necro Slime fuse → **Genghis**. Gilgamesh → **Deus Machinex**. Genghis revive Gryphon → add Headhunt.
14. Gryphon + Lance → **Clovis** → bring Lance back → Clovis + Genghis → **High Caesar**.
15. Lance become level 4. Lance + Scale Surveyor → **Siegfried**. Set Headhunt.

**Key SELECT_CARD decisions in order** (this is the most direct path for our fixture since Gate is in hand):
1. **Gate search → Doom Queen Machinex** (`20715411`) ← CRITICAL step 1
2. Doom Queen's effect sets → **Dark Contract with the Zero King** (`32665564`) from deck
3. Zero Contract pop → Doom Queen Mach triggers SS → **Count Surveyor** (`5997110`) ← CRITICAL search target (unique deck copy)
4. Count Surveyor adds → Copernicus (already in hand so may pick another D/D — Kepler or Scale Surveyor are both already in hand/field; could pick Gryphon as alternate)
5. Copernicus dump → **Lance Soldier** (`67322708`)
6. Gilgamesh scale placement → **Scale Surveyor** (`42382265`) + **Gryphon** (`28406301`) from deck
7. Solomon search → **Scale Surveyor** or **Gryphon** depending on which already placed
8. Tell dump → **Necro Slime** (`72291412`) — fusion material for Genghis
9. Gryphon (from Abyss revive) search → **Headhunt** (`91781484`)

---

## 1 CARD COMBO — Dark Contract with the Gate (plays through Droll)

**Endboard**: Deus Machinex + 1 Contract, High Caesar, Zeus

1. Gate search Doom Queen Machinex. *(Droll hits here.)* Doom Queen sets Zero Contract.
2. Zero Contract pop Doom Queen Mach → SS Cope → dump Lance.
3. Lance return popping Zero Contract → Doom Queen Mach returns off that pop.
4. Cope + Lance → **Clovis** → bring Lance back.
5. Clovis + Doom Queen Mach → **Gilgamesh**. Scale Doom Queen Mach + Abyss Ragnarok.
6. Lance become level 4 → pend summon Cope → Cope + Lance → **Caesar** → **Tell**, use effect.
7. Tell + Gilgamesh → **Zeus**. Tell dump Necro. Necro fuse → **Genghis**.
8. Abyss reborn Clovis. Genghis bring back Tell.
9. Tell → **Deus Machinex**. Clovis + Genghis → **High Caesar**.

---

## 1 CARD COMBO — D/D Savant Kepler (plays through Nibiru gas)

**Endboard**: Deus Machinex + 1 contract, High Caesar, Zeus, 3000/1200 Nib token

1. NS Kepler → add Gate → add Doom Queen Mach → set Zero Contract.
2. Pop Doom Queen Mach → SS Cope → dump Lance. Lance return popping Zero Contract.
3. Lance become level 4. Lance + Cope → **Solomon** → add Gryphon.
4. Solomon → **Tell**. Tell + Kepler → **Gilgamesh**. Tell dump Necro. CL2 Gilgamesh scale Abyss + Doom Queen Mach.
5. Gryphon self-SS.

**!! Nibiru can hit here. If so, make Zeus off Gryphon + Gilg to negate. Or fall through to Nibiru response line below.**

6. Necro fuse with Gilgamesh → **Genghis**.
7. Abyss bring back Tell. Genghis bring back Lance.
8. Pend Gryphon. Gryphon + Lance → **Clovis** → bring Gilg back. Clovis + Tell → **Zeus**. Tell dump Defense Soldier.
9. Zeus pop Doom Queen Mach.
10. Clovis + Genghis → **High Caesar**.
11. Defense Soldier: banish from GY → add back Doom Queen Mach from ED. Scale it. Pend Kepler + Gryphon. Both → Gilg → **Deus Machinex**.

**Nibiru at 5th summon (Tell) fallback**:
1. Tell dump Necro. Necro fuse → **Genghis**. Gryphon self-SS. Genghis bring back Tell.
2. Tell + Gryphon → **Gilg**. CL1 Gilg scale Doom Queen Mach + Abyss. CL2 Tell dump Defense Soldier.
3. Pend Gryphon. Abyss bring back Lance. Both → **Clovis**.
4. Clovis revive anything. That + Gilg → **Zeus**. Zeus pop Doom Queen Mach. Clovis + Genghis → **High Caesar**.
5. Defense Soldier: banish → add Doom Queen Mach → scale → pend → **Deus Machinex**.

---

## 1.5 CARD COMBO — D/D Count Surveyor + any D/D to discard (plays through Nibiru negate)

**Endboard**: FULL + BONUS. 2 material Deus Machinex + 1 contract, High Caesar, Siegfried, Zeus, Headhunt.

1. Discard D/D → Count Surveyor self-SS → add Doom Queen Mach.
2. Scale Doom Queen Mach → place Gate from deck.
3. Gate search Kepler → NS Kepler → search Zero Contract.
4. Zero Contract pop Doom Queen Mach → SS Cope → dump Gryphon.
5. Kepler + Cope → **Gilgamesh**. Scale Abyss Ragnarok + Orthros. Orthros pop both Dark Contracts.
6. Gilgamesh + Count → **Zeus** (counters Nibiru if it hits).
7. Abyss bring back Gryphon → add Scale Surveyor → self-SS → become level 4 → **Caesar**.
8. Zeus pop Caesar → gain pend summon. CL1 Caesar add Swamp King. CL2 Doom Queen Mach return. CL3 add Orthros back.
9. Scale Doom Queen Mach again. Pend Kepler + Cope + Orthros.
10. Swamp King fuse Kepler (hand) + Gryphon (GY) → **Genghis**. Orthros + Cope → **Siegfried**. Genghis revive Scale Surveyor.
11. Pend Orthros + Cope. Orthros + Scale → **Clovis** → bring Gryphon back → Clovis + Genghis → **High Caesar**.
12. Cope + Gryphon → **Solomon** → add Headhunt → set. Solomon → **Deus Machinex**.

---

## 2 CARD COMBO — Doom Queen Machinex + Copernicus (BEST ENDBOARD)

**Endboard**: THE FULLEST. Deus Machinex + 1 contract but **3 materials** instead of 1, High Caesar, Siegfried, Bright Armageddon, Zeus, Headhunt.

1. Scale Doom Queen Machinex → place Zero Contract.
2. Zero Contract pop Doom Queen Mach → SS Count Surveyor → add Kepler.
3. NS Copernicus → dump Lance.
4. Lance pop Zero Contract → reborn itself.
5. Doom Queen Mach return from contract pop.
6. Lance + Cope → **Clovis** → bring Lance back.
7. Doom Queen Mach + Lance → **Bright Armageddon**.
8. Clovis + Count → **Gilgamesh**. Scale Abyss Ragnarok + Doom Queen Mach.
9. Pend summon Kepler + Cope → add Gate off Kepler.
10. Gate add Gryphon → self-SS → Gryphon + Cope → **Solomon** → add Orthros.
11. Solomon → **Tell**, effect. Tell + Gilg → **Zeus**. Tell dump Necro.
12. Zeus pop Kepler → gain pend summon.
13. Necro fuse → **Genghis**. Abyss bring back Gryphon. CL1 Gryphon add Headhunt, CL2 Genghis bring Clovis back, CL3 Orthros self-SS (damage trigger from Abyss revive).
14. Clovis + Genghis → **High Caesar**. Orthros + Gryphon → **Siegfried**.
15. Pend Orthros + Gryphon. Both → **Caesar** → **Deus Machinex**. Set Headhunt.

---

## Other combo variants (summary)

- **1 CARD Doom Queen Machinex + lv5+ D/D or Headhunt in hand** → swap Headhunt for Bright Armageddon; enables High Genghis (via Swamp King Contract fusion) + targeting protection.
- **1 CARD Doom Queen Machinex (OTK 2nd)** → replace High Caesar with **Arc Crisis** (banish Clovis + Genghis + Solomon + random pend from GY to fusion summon).
- **1 CARD Doom Queen Machinex (through Imperm on Gilg)** → simplified to Deus Machinex + 1 contract + High Caesar.
- **2 CARD Kepler + Doom Queen Machinex (through Droll)** → 4 material Deus Machinex + High Caesar + Siegfried + Zeus (requires knowing Droll will hit).
- **1 CARD Kepler (through Droll)** → Deus Machinex + 1 material + High Caesar (drastically reduced endboard).
- **2 CARD Kepler + Doom Queen Machinex (through Imperm on Gilg)** → Deus Machinex + 1 contract + High Caesar + Siegfried + Zeus.
- **2 CARD Necro Slime + Gryphon** → FULL endboard.
- **2 CARD 2x Scale Surveyor** → FULL endboard.
- **3 CARD lv4 D/D + Scale Surveyor + Dark Contract (Gate/Zero/Swamp)** → most pieces, slightly weaker (unused High Genghis, no second Lance revive for Bright Armageddon).

---

## Solver diagnostic mapping

For the current fixture `ddd-pendulum-opener` (hand: Kepler + Copernicus + Scale Surveyor + Gate + Fuwalos), the most applicable line is **"1 CARD Dark Contract with the Gate"** because Gate is already in hand — skip the Kepler → search Gate step and go directly to `Gate → search Doom Queen Machinex`.

The first CRITICAL SELECT_CARD decision is **Gate's search target**. In the raw D/D search pool (15+ D/D monsters in main deck), the solver's `SELECT_CARD_EXPLORATORY_MAX = 6` gate causes auto-resolution rather than branching. If auto-resolution does not pick Doom Queen Machinex (20715411), the canonical combo line dies at step 1 and the solver falls back to less productive branches.

Evidence from spike trace (2026-04-15 / 2026-04-16 runs):
- Solver mainPath eventually reaches `D/D/D Zero Doom Queen Machinex` (step 22-25) but NOT via `Gate → Doom Queen` direct. It takes a longer, less productive route.
- Only matched 1/5 (Siegfried) — none of the pendulum-cycle-dependent bosses (Caesar, Armageddon, Zeus Ragnarok, Headhunt).

Next diagnostic (Phase G-iii): probe Gate's search pool to identify what the solver auto-picks, and add `preferredIntermediates` pointing at the combo-critical intermediates (Doom Queen Mach + Count Surveyor + Lance + Necro Slime + Gryphon + Headhunt + Zero Contract + Swamp King Contract).

---

## Endboard weights (for solver scoring reference)

The canonical FULL endboard contains:
- **Deus Machinex** (71612253 or 46593546) — targetedNegate / attach
- **High Caesar** (79559912) — targetedNegate / floodgate-like SS restriction
- **Siegfried** (44852429) — backrow negate (turn-scoped)
- **Zeus Ragnarok** (30998403) — omniNegate (monster hand)
- **Headhunt** (91781484 - trap) — targetedNegate / steal

If all 5 are on board, `matched=5/5` against the fixture's `expectedBoard`.
The variant "through Nibiru" drops Siegfried and Headhunt but keeps Machinex
+ High Caesar + Zeus — `matched=3/5` equivalent. The variant "Bright
Armageddon" swaps Headhunt for Armageddon (72402069) — same matched count.

The "2 CARD Doom Queen + Copernicus" line gets ALL 6 possible pieces: full
5 + Bright Armageddon. That's `matched=5/5` plus one extra matched card not
in the fixture expectedBoard.
