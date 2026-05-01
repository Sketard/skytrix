# Spright Combo Reference (2026-04-17)

Canonical Spright combos for solver validation. Targets the Greenville
WCQ Regional Top 8 build (Ivan Villa, 2026-01-10). Paired with
`solver-validation-decks.json` fixture `spright-opener`.

Sources:
- Master Duel Meta Spright in-depth guide (masterduelmeta.com/articles/guides/spright-introduction-wanderlust)
- Road of the King Spright combo article (roadoftheking.com/spright-combo)
- Game8 Spright deck guide (game8.co/games/Yu-Gi-Oh-Master-Duel/archives/404893)
- ygoprodeck "Terminally Awesome" Swap Frog + Toadally article
- Cards Realm Spright deck tech

**Paradigm note**: Spright is a **Level/Rank 2 toolbox archetype**. Every
Spright monster is Level 2, enabling dense Rank 2 Xyz chains (Gigantic,
Toadally Awesome) and Link-2 via Spright Elf. Unique mechanic: Spright
monsters can only be Special Summoned if you control a Level/Rank/Link 2
monster. This forces an early Lvl 2 body — typically Swap Frog NS or a
Nimble extender.

---

## Endboard piece cheat sheet

Spright bosses:
- **Spright Red** (Level 2 Fiend, 75922381) — negates monster effect
  activation by tributing a Lvl/Rank/Link 2 monster. Quick-effect negate.
- **Spright Carrot** (Level 2 Fiend, 2311090) — negates opp card effect by
  tributing a Lvl/Rank/Link 2 monster. Quick-effect, opp-turn disruption.
- **Spright Blue** (Level 2 Fiend, 76145933) — search engine; on NS/SS,
  add a Spright or Lvl 2 Aqua monster.
- **Spright Jet** (Level 2 Fiend, 13533678) — search engine for Spright
  spell/trap.

Rank 2 Xyz:
- **Gigantic Spright** (Rank 2, 54498517) — detach material to SS any
  Level 2 monster from deck. Toolbox engine.
- **Toadally Awesome** (Rank 2, 90809975) — 2 Lvl 2 WATER Aqua material.
  Omni-negate on activation. Premium negate.
- **Number 65: Djinn Buster** (Rank 2, 3790062) — Rank 2 with hand-
  disruption.
- **Cat Shark** (Rank 2, 84224627) — face-up monster destruction.
- **Number 29: Mannequin Cat** (Rank 2, 54191698) — alt Rank 2 effect.
- **Number 2: Ninja Shadow Mosquito** (Rank 2, 32453837) — sneaky Rank 2.
- **Downerd Magician** (Rank 2, 72167543) — Rank 2 beat.
- **Onibimaru Soul Sweeper** (Rank 2, 9486959) — alt Rank 2.

Link-2:
- **Spright Sprind** (Link-2, 72329844) — Spright Link, SS Spright from GY.
- **S:P Little Knight** (Link-2, 29301450) — generic banish Link.
- **I:P Masquerena** (Link-2, 65741786) — EP Link.

Frog extenders (Level 2 non-Spright):
- **Swap Frog** (Level 2 WATER Aqua, 9126351) — NS effect: mill Aqua + SS
  another Frog from hand. Key Gigantic Spright target.
- **Nimble Angler** (Level 2 Fish, 88686573) — when NS/SS, SS 2 Lvl 2
  Nimbles from deck.
- **Nimble Beaver** (Level 2 Beast, 68353324) — alt Lvl 2 Nimble extender.
- **Ronintoadin** (Level 2 WATER Aqua, not in this deck) — commonly paired
  with Swap Frog; this build uses Nimble Beaver instead.

Other Lvl 2 supports:
- **Click & Echo** (2992467) — Lvl 2 Fiend with effect.
- **Mirror Mage of the Ice Barrier** (9396662) — Lvl 2 Spellcaster.
- **Barrier Statue of the Torrent** (10963799) — Lvl 2 floodgate.
- **Freezing Chains of the Ice Barrier** (43582229) — ice trap.

---

## Card ID reference (this fixture's available cards)

Spright core:
- `76145933` Spright Blue (3x) — primary 1-card starter
- `75922381` Spright Red (2x) — monster-negate boss
- `2311090`  Spright Carrot (1x) — opp-negate boss
- `13533678` Spright Jet (3x) — spell/trap searcher
- `15443125` Spright Starter (3x) — SS Lvl 2 Spright from deck
- `68250822` Spright Double Cross (1x) — Spright spell

Level 2 extenders:
- `88686573` Nimble Angler (2x)
- `68353324` Nimble Beaver (3x)
- `9126351`  Swap Frog (3x)
- `2992467`  Click & Echo (1x)
- `9396662`  Mirror Mage of the Ice Barrier (1x)
- `10963799` Barrier Statue of the Torrent (1x)
- `43582229` Freezing Chains of the Ice Barrier (1x)

Handtraps:
- `14558127` Ash Blossom & Joyous Spring (3x)
- `94145021` Droll & Lock Bird (3x)
- `42141493` Mulcharmy Fuwalos (3x)

Utility:
- `24299458` Forbidden Droplet (3x)
- `65681983` Crossout Designator (1x)
- `81439173` Foolish Burial (1x) — alias-normalized
- `24224830` Called by the Grave (1x)
- `40366667` Dominus Impulse (3x) — Dominus floodgate

Extra Deck:
- `54498517` Gigantic Spright (2x) — Rank 2 toolbox
- `90809975` Toadally Awesome — Rank 2 omni-negate
- `3790062`  Number 65: Djinn Buster — Rank 2
- `84224627` Cat Shark — Rank 2
- `54191698` Number 29: Mannequin Cat — Rank 2
- `32453837` Number 2: Ninja Shadow Mosquito — Rank 2
- `72167543` Downerd Magician — Rank 2
- `9486959`  Onibimaru Soul Sweeper — Rank 2
- `72329844` Spright Sprind — Spright Link-2
- `29301450` S:P Little Knight — Link-2
- `65741786` I:P Masquerena — Link-2
- `12067160` Gorgon of Zilofthonia — Link
- `73309655` Eria the Water Charmer, Gentle — Link
- `90448279` Divine Arsenal AA-ZEUS - Sky Thunder — Rank 12

---

## 1 CARD COMBO — Spright Blue → Toadally Awesome

**Endboard**: Spright Red (MZONE) + Gigantic Spright (EMZ) + Toadally
Awesome (MZONE or EMZ) + Spright Jet on field.

1. NS **Spright Blue**. Blue on-NS: search any Spright OR Lvl 2 Aqua —
   search **Spright Starter** (spell).
2. Activate **Spright Starter** → SS a Lvl 2 Spright from deck. SS
   **Spright Jet**.
3. Jet on-SS: search Spright spell/trap — search **Spright Elf** trigger
   or an alt engine spell.
4. Blue + Jet on field → Xyz into **Gigantic Spright** (Rank 2).
5. Gigantic effect: detach material, SS a Lvl 2 from deck — SS **Swap
   Frog** (pick an Aqua for Toadally).
6. Swap Frog on-SS: mill Aqua from deck, SS another Frog from hand (if
   available).
7. With Swap Frog + Gigantic Spright + another Lvl 2 on field → Xyz
   into **Toadally Awesome** (Rank 2 WATER Aqua).
8. SS **Spright Red** via Gigantic's effect (or leftover Spright in GY).
   Set end-of-turn trap if available.

---

## 2 CARD COMBO — Spright Blue + Swap Frog → Full endboard

**Endboard (this fixture's canonical finish)**: Spright Red + Spright
Carrot + Gigantic Spright + Toadally Awesome.

1. NS Swap Frog (or SS Spright first if Spright Blue's path is preferred).
2. Swap Frog on-NS: mill Aqua from deck + SS a Frog from hand (if
   available).
3. SS Spright Blue via Swap Frog being Lvl 2 (Blue's activation condition
   is satisfied: "If you control a Lvl/Rank/Link 2 monster").
4. Blue searches Spright Starter → Starter SS Spright Jet from deck.
5. Swap Frog + Spright Jet → Xyz into **Toadally Awesome** (both WATER
   Aqua).
6. Spright Blue + another Lvl 2 (Click & Echo via Starter, or another
   Nimble) → Xyz into **Gigantic Spright**.
7. Gigantic → SS **Spright Red** (search from deck via Spright chain).
8. Leftover Spright in GY → SS **Spright Carrot** via Spright Elf (Link-2)
   revival.

**Final endboard**:
- MZONE: Spright Red (75922381)
- MZONE: Spright Carrot (2311090)
- EMZ_L: Gigantic Spright (54498517)
- EMZ_R: Toadally Awesome (90809975)

Dual negate setup: Red (monster negate) + Carrot (opp-effect negate) +
Toadally (omni-negate quick-effect) = 3 layered negates. Gigantic as
Rank 2 toolbox engine enables turn-2 recursion.

---

## Key SELECT_CARD decisions

1. Spright Blue search → **Spright Starter** (1-card starter into Jet SS).
2. Spright Starter SS target → **Spright Jet** (searches Spright spell/
   trap for extension).
3. Spright Jet search → **Spright Double Cross** (Spright extender spell)
   OR **Spright Smashers** (not in this deck's main — check).
4. Gigantic Spright SS target → **Swap Frog** (for Toadally WATER Aqua
   synergy) OR **Ronintoadin** if available (not in this deck).
5. Swap Frog discard → any Aqua (Nimble Angler for extenders, or another
   Frog).

---

## THIS FIXTURE's canonical opener (CORRECTED)

Previous hand: [Blue + Red + Jet + Starter + Nimble Angler] = 4 Spright
engine cards + 1 extender = over-loaded. Realistic Spright opener is 1
Spright starter + 1 Lvl 2 extender + 2-3 handtraps.

Corrected hand:
```
[76145933 Spright Blue,
 9126351  Swap Frog,
 15443125 Spright Starter,
 14558127 Ash Blossom & Joyous Spring,
 42141493 Mulcharmy Fuwalos]
```

Rationale:
- Spright Blue = 1-card Spright starter (search → Spright Starter).
- Swap Frog = Lvl 2 Aqua extender (required for Toadally WATER Aqua
  summon) AND immediate Lvl 2 body for Spright activation condition.
- Spright Starter = engine spell (ensures Lvl 2 Spright SS from deck).
- Ash Blossom + Fuwalos = 2 handtraps (this deck has 3x Ash + 3x Fuwalos
  + 3x Droll in main, ~9 handtraps).

This is a realistic 2-engine Spright + Frog 1+1 hand with proper protection.

## THIS FIXTURE's canonical expectedBoard (KEEP)

Existing expectedBoard matches research:
```
MZONE: Spright Red (75922381)
MZONE: Spright Carrot (2311090)
EMZ_L: Gigantic Spright (54498517)
EMZ_R: Toadally Awesome (90809975)
```

Structural sanity checks:
- ✓ Red + Carrot + Gigantic + Toadally can coexist (none are consumed
  as Xyz/Link materials for each other in the canonical 2-card line).
- ✓ Gigantic in EMZ_L and Toadally in EMZ_R — two Extra Monster Zones
  occupied, valid since Xyz don't require Link arrows.
- ✓ All pieces in extra + main (no side-deck contamination).

---

## Solver diagnostic mapping

- Missing Toadally Awesome → Frog chain did not complete. Check: was
  Swap Frog on field with another Lvl 2 Aqua (Spright Jet or another
  Frog)? Was Rank 2 Xyz materialized?
- Missing Gigantic Spright → Rank 2 chain missed entirely. Check: were
  2 Lvl 2 monsters on field simultaneously at Main Phase 2?
- Missing Spright Red → Spright boss SS from deck failed. Check: did
  Gigantic's effect fire? Were Spright cards available to SS?
- Missing Spright Carrot → second boss not reached. Check: was Spright
  Elf (Link-2) summoned? Did GY Spright revival happen?

---

## Endboard weights (solver scoring)

Priority order:
1. **Toadally Awesome** — omni-negate Rank 2, highest-value disruption.
2. **Spright Red** — monster-effect negate, strong turn-2 cover.
3. **Spright Carrot** — opp-effect negate, alt turn-2 cover.
4. **Gigantic Spright** — Rank 2 toolbox engine, resource piece.

Matched 4/4 = full dual-negate Spright turn-1. 2/4 = engine fired
partially (Gigantic + one of Red/Carrot/Toadally). 0/4 = combo blocked.

Step 3 ES tuning note: Spright's F3 Extra Deck Material Pool scoring
should heavily weight Rank 2 Xyz depth (this deck has 8 Rank 2 options
in extra). F2 Tutor Chain fires on Spright Blue + Jet + Starter + Blue
chain (3+ tutorial searches deep).
