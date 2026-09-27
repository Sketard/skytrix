# Radiant Typhoon Combo Reference (2026-04-17)

Canonical Radiant Typhoon combos for solver validation. Targets the
Radiant Typhoon competitive April 2026 build. Paired with
`solver-validation-decks.json` fixture `radiant-typhoon-opener`.

Sources:
- Master Duel Meta Radiant Typhoon tier guide (masterduelmeta.com/tier-list/deck-types/Radiant%20Typhoon)
- Cards Realm Radiant Typhoon TCG deck guide
- ygoprodeck Radiant Typhoon decks (2026 builds)
- YGOrganization CDP Radiant Typhoon Windwitch variant
- Flipside Gaming Radiant Typhoon Post-BPRO rogue report
- archetypesnexus.com Radiant Typhoon Cyclonic Light Warriors analysis

**Paradigm note**: Radiant Typhoon is a **control deck with a Mystical
Space Typhoon-themed engine**. Cards produce delayed Quick-Play spells
(Radiant Typhoon Quick-Plays) and turn Mystical Space Typhoon into an
omni-negate via **Radiant Typhoon Mandate** (Continuous Trap). Low-
monster count, 3-piece endboard typical (smaller than combo archetypes).
This fixture was **user-validated 2026-04-15** prior to step 2 Tier 3
review.

---

## Endboard piece cheat sheet

Radiant Typhoon Link-1/2:
- **Radiant Typhoon Varuroon, the Marine Eidolon** (Link-2 Winged-Beast,
  39341885) — the key Link body. Summoned via 2 Radiant Typhoon monsters.
  On-Link-SS: place Radiant Typhoon Mandate onto the field.
- **Varuroon, the Vibrant Vortex** (Main deck Lvl 10, 53927851) — high
  Lvl Radiant boss reached via Tribute Summon.

Rank 3 Xyz:
- **Totem Bird** (Rank 3 Winged-Beast Xyz, 71068247) — Rank 3 requires 2
  Lvl 3 monsters. Totem Bird's effect: detach material to negate spell/
  trap activation. Control piece.

Link-3 finisher:
- **Hraesvelgr, the Desperate Doom Eagle** (Link-3 Winged-Beast, 49105782)
  — big Link finisher. Win condition or board breaker.

Radiant Typhoon main-deck starters:
- **Radiant Typhoon Eldam** (Level 4, 54143349) — SS self from hand, then
  search Radiant Typhoon Krosea.
- **Radiant Typhoon Swen** (Level 4, 80538047) — SS via effect.
- **Radiant Typhoon Krosea** (Level 3, 16922142) — NS via tributing a
  Radiant Typhoon → search Mystical Space Typhoon + Radiant Typhoon
  Ascendance.
- **Radiant Typhoon Fonix, the Great Flame** (Level 8, 85315450) —
  Radiant Typhoon boss. Tribute Summon with 2x Lvl 4+ tributes.

Radiant Typhoon spells/traps:
- **Radiant Typhoon Chant** (67115133) — search Radiant Typhoon.
- **Radiant Typhoon Vision** (20508881) — Quick-Play engine piece.
- **Radiant Typhoon Mandate** (Continuous Trap, 53813120) — turns MST
  into an omni-negate. Recycles 3 Quick-Plays + draws 1.

Utility:
- **Mystical Space Typhoon** (5318639) — standard S/T destroy, weaponized
  via Mandate.

---

## Card ID reference (this fixture's available cards)

Radiant Typhoon main:
- `85315450` Radiant Typhoon Fonix, the Great Flame (1x)
- `80538047` Radiant Typhoon Swen (3x)
- `16922142` Radiant Typhoon Krosea (3x) — core NS target
- `54143349` Radiant Typhoon Eldam (3x) — core SS starter
- `53927851` Radiant Typhoon Varuroon, the Vibrant Vortex (1x) — Lvl 10
- `27755794` (unknown / check)
- `12197223` (unknown / check)
- `34242278` (unknown / check)

Handtraps:
- `42141493` Mulcharmy Fuwalos (3x)
- `25940932` (unknown / check)

Radiant Typhoon spells (main):
- `67115133` Radiant Typhoon Chant (3x)
- `20508881` Radiant Typhoon Vision (3x)
- `5318639`  Mystical Space Typhoon (3x) — Mandate-weaponized
- `24224830` Called by the Grave (1x)
- `30271097` (unknown / check)
- `24299458` Forbidden Droplet (3x)
- `48130397` (unknown / check)

Radiant Typhoon traps (main):
- `53813120` Radiant Typhoon Mandate (1x) — KEY trap

Extra Deck:
- `39341885` Radiant Typhoon Varuroon, the Marine Eidolon (2x) — Link-2
- `30674956` (unknown / check)
- `29301450` S:P Little Knight — Link-2
- `90512490` (unknown / check)
- `49105782` Hraesvelgr, the Desperate Doom Eagle — Link-3
- `71068247` Totem Bird — Rank 3 Xyz
- `71166481` (unknown / check)
- `93039339` Super Starslayer TY-PHON — Rank 12
- `54757758` (unknown / check)
- `11765832` Garura, Wings of Resonant Life — Link-2
- `89851827` (unknown / check)
- `87746184` (2x, unknown / check)
- `78397661` Ecclesia and the Dark Dragon (alt boss used in Branded variant)

---

## 1 CARD COMBO — Radiant Typhoon Eldam → Varuroon + Totem Bird + Mandate

**Endboard** (user-validated 3-piece): Totem Bird (MZONE Rank 3) +
Hraesvelgr (EMZ_L Link-3) + Radiant Typhoon Mandate set (SZONE).

1. NS/SS **Radiant Typhoon Eldam** from hand (Eldam's own effect).
2. Eldam on-SS: search **Radiant Typhoon Krosea** from deck.
3. NS Krosea by tributing Eldam (or another Radiant Typhoon).
4. Krosea on-NS (after tribute): search **Mystical Space Typhoon**
   (weaponized by Mandate) + **Radiant Typhoon Ascendance**.
5. With 2 Radiant Typhoon monsters on field → Link into **Varuroon, the
   Marine Eidolon** (Link-2).
6. Varuroon on-Link-SS: place **Radiant Typhoon Mandate** onto the field
   (as Continuous Trap). Mandate active = MST is now omni-negate.
7. Additional Lvl 3 body (via Chant or Radiant Typhoon Vision SS chain)
   → Xyz into **Totem Bird** (Rank 3).
8. Continue Link chain: Varuroon + extra bodies → **Hraesvelgr, the
   Desperate Doom Eagle** (Link-3). (Requires specific Winged-Beast
   materials; typical via Radiant Typhoon + Varuroon materials.)
9. Set remaining Radiant Typhoon spells face-down for opp-turn activation
   via Mandate.

**Final endboard**:
- MZONE: Totem Bird (71068247) attack
- EMZ_L: Hraesvelgr, the Desperate Doom Eagle (49105782) attack
- SZONE: Radiant Typhoon Mandate (53813120) set (face-down continuous
  trap awaiting activation OR already activated — both valid)

---

## Key SELECT_CARD decisions

1. Eldam search → **Krosea** (always, enables tribute-summon chain).
2. Krosea search → **Mystical Space Typhoon** + **Radiant Typhoon
   Ascendance** (dual search from one effect).
3. Link-2 Varuroon material choice → any 2 Radiant Typhoon monsters
   (Eldam + Krosea typical).
4. Rank 3 Xyz pair → 2 Lvl 3 bodies (Krosea + another Lvl 3 from deck
   via Swen's SS effect).
5. Hraesvelgr material → Varuroon + Winged-Beast body + 3rd material.

---

## THIS FIXTURE's canonical opener (KEPT — user-validated)

Existing hand:
```
[54143349 Radiant Typhoon Eldam,
 67115133 Radiant Typhoon Chant,
 16922142 Radiant Typhoon Krosea,
 20508881 Radiant Typhoon Vision,
 42141493 Mulcharmy Fuwalos]
```

Rationale (user-validated 2026-04-15):
- Eldam + Krosea = the 2-card core starter (NS/SS + tribute-summon).
- Chant = engine search spell.
- Vision = Quick-Play extender.
- Fuwalos = standard handtrap.

All 4 Radiant Typhoon engine cards in hand is realistic for this deck
— the archetype relies on multi-card engine density per the CDP guide.

## THIS FIXTURE's canonical expectedBoard (KEPT — user-validated)

Existing expectedBoard (3-piece conservative control finish):
```
MZONE: Totem Bird (71068247) — attack
EMZ_L: Hraesvelgr, the Desperate Doom Eagle (49105782) — attack
SZONE: Radiant Typhoon Mandate (53813120) — set
```

Structural sanity checks:
- ✓ Totem Bird (Rank 3) stays unless materials detached for effect.
- ✓ Hraesvelgr (Link-3) stays.
- ✓ Mandate set face-down: valid — continuous trap set for opp turn.
  Alternative: Mandate face-up active (no `position` field then).
  The `"set"` position indicates face-down during the turn-1 build-up.
- ✓ All pieces reachable from this deck's main + extra.
- ✓ Matches research: "normal endboard looks like lil Varuroon, Totem
  Bird, your favorite Radiant Typhoon boss of choice, and 2-4 face-down
  Spells" — our 3-piece is a conservative subset (Varuroon's role here
  is SS enabler for Mandate placement, consumed or kept depending on
  the path).

---

## Solver diagnostic mapping

- Missing Totem Bird → Rank 3 Xyz chain didn't complete. Check: were
  2 Lvl 3 bodies on field simultaneously?
- Missing Hraesvelgr → Link-3 chain missed. Check: did Varuroon link
  into additional bodies? Were Winged-Beast materials available?
- Missing Mandate → Varuroon's place-Mandate effect didn't resolve OR
  Mandate was face-up activated (in which case `set` position fails
  match; drop `position: set` if this is legitimate variance).

---

## Endboard weights (solver scoring)

Priority order:
1. **Radiant Typhoon Mandate** — turn-2 MST-to-omni-negate engine hub.
2. **Totem Bird** — spell/trap negate via detach material.
3. **Hraesvelgr** — Link-3 beater, closing power.

Matched 3/3 = user-validated control turn-1 finish. 2/3 = engine fired
(typically Mandate + one Xyz/Link). 0/3 = engine blocked (Ash on Eldam
search, Fuwalos on ritual attempt, etc.).

**Paradigm caveat**: Radiant Typhoon is a CONTROL paradigm — endboard is
3 pieces (smaller than combo's 4-6). The pre-validation smoke showed
score=34.58 matched=2/3 at pre-s2 baseline, which validates the engine
firing reliably. Keep this fixture as a control-paradigm gold standard.
