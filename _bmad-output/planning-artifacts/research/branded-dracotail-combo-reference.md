# Branded Dracotail Combo Reference (2026-04-17)

Canonical Branded Dracotail combos for solver validation. Targets the
Bainbridge WCQ Regional 2nd Place build. Paired with
`solver-validation-decks.json` fixtures `branded-dracotail-opener`
(Arthalion line) + `branded-dracotail-opener-mirrorjade-line`.

Sources:
- Master Duel Meta Dracotail guide (masterduelmeta.com/articles/guides/dracotail-guide)
- Master Duel Meta Dracotail tier guide
- Cards Realm Dracotail Branded TCG deck guide
- archetypesnexus.com Dracotail archetype breakdown
- Yugipedia Dracotail archetype

**Paradigm note**: Branded Dracotail is a **Fusion archetype with split
combo lines**. Two canonical finishes — the Arthalion line (Dracotail-
primary end) and the Mirrorjade line (Branded-primary end with Albion
Sanctifire). The fixture has TWO hands with identical opener cards but
different expected endboards, because both lines are reachable from
the same hand depending on Branded Fusion's target + SELECT_CARD
choices. This is the ONLY fixture in the suite with multi-line
expected outcomes.

---

## Endboard piece cheat sheet

Dracotail finishers:
- **Dracotail Arthalion** (Fusion Level 10, 33760966) — THE Dracotail
  boss. Quick-effect omni-negate. Summoned via Faimena/Mululu fusion.
  Primary MZONE end-piece for the Arthalion line.
- **Dracotail Gulamel** (Fusion, alt) — secondary Dracotail Fusion.
- **Dracotail Faimena** (Level 7, 1498449) — core Fusion starter. Quick-
  effect: discard self to fuse into Dracotail. Can end in HAND as
  "kept resource" for turn-2 fusion.

Branded finishers:
- **Mirrorjade the Iceblade Dragon** (Fusion Level 8, 44146295) — Branded
  Fusion primary target. Effect: detach card from hand/field, destroy
  opp card + banish. Primary MZONE end-piece for the Mirrorjade line.
- **Albion the Sanctifire Dragon** (Fusion Level 10, 38811586) — bigger
  Branded Fusion, summoned atop Mirrorjade via Branded Fusion's own
  effects. The terminal Branded piece.
- **Ecclesia and the Dark Dragon** (Fusion Level 10, 78397661) —
  alternative Branded-Dracotail hybrid Fusion (Arthalion line MZONE 2nd).

Normal summon bodies (core engine):
- **Dracotail Lukias** (Level 6, 75003700) — main normal summon. On-NS:
  add a Dracotail monster from deck to hand.
- **Fallen of the White Dragon** (75003700... wait, no — 7375867) — an
  alt Lvl 7 body that can self-SS in Branded builds. Replaces Pan in
  the 2026-04-13 fixture audit (Pan was dead in opening hands).
- **Mululu** (73819701) — normal summon alt for fuse-during-main-phase.
  Locks into Dracotail fusions for the turn.

Branded engine:
- **Branded Fusion** (44362883) — key Branded Fusion spell. Fuses
  Branded-Despia materials into Mirrorjade etc.
- **Blazing Cartesia** (95515789) — Branded extender, quick-effect fuse.

Dracotail trap package:
- **Dracotail Flame** (Normal Trap, 5431722) — trigger on Dracotail
  fusion, chain-set.
- **Dracotail Horn** (Normal Trap, 69932023) — trigger on Dracotail.
- **Dracotail Sting** (Normal Trap, 80208225) — trigger on Dracotail.

Support bodies:
- **Dracotail Pan** (cut from the 2026-04-13 audit — was dead in hand,
  required tribute).

---

## Card ID reference (this fixture's available cards)

Dracotail engine (main):
- `75003700` Dracotail Lukias (3x)
- `1498449`  Dracotail Faimena (3x) — core starter
- `84477320` (unknown specific)
- `7375867`  Fallen of the White Dragon (1x) — added in 2026-04-13 audit
- `70871153` (unknown specific)
- `44482554` (unknown specific)
- `73819701` Mululu / alt Dracotail body (2x)
- `68468459` (unknown specific)
- `95515789` Blazing Cartesia (1x)
- `55273560` (unknown specific, preferredIntermediates target)

Branded spells:
- `44362883` Branded Fusion (2x) — Branded Fusion spell
- `32548318` (unknown specific, 3x)
- `42141493` Mulcharmy Fuwalos (3x)
- `24224830` Called by the Grave (1x)

Handtraps (main):
- `14558127` Ash Blossom & Joyous Spring (3x)
- `94145021` Droll & Lock Bird (1x)
- `27204311` Nibiru, the Primal Being (2x)
- `97268402` (unknown specific, 2x)
- `73642296` Ghost Belle & Haunted Mansion (2x)

Trap package:
- `80208225` Dracotail Sting (1x)
- `69932023` Dracotail Horn (1x)
- `5431722`  Dracotail Flame (1x)
- `6153210`  (unknown trap, 1x)
- `30271097` (unknown trap, 2x)

Extra Deck:
- `33760966` Dracotail Arthalion (2x) — Fusion Lvl 10 boss
- `79755671` (unknown Fusion)
- `42125140` (unknown Fusion)
- `89851827` (unknown Fusion)
- `87746184` (unknown Fusion)
- `44146295` Mirrorjade the Iceblade Dragon — Branded Fusion primary
- `38811586` Albion the Sanctifire Dragon — Branded Fusion terminal
- `70534340` (unknown Fusion)
- `3410461`  (unknown)
- `51409648` (unknown)
- `76666602` (unknown Fusion)
- `72578374` (unknown)
- `70538272` (unknown)
- `78397661` Ecclesia and the Dark Dragon — alt Fusion

---

## 2 CARD COMBO — Arthalion line

**Opener**: Faimena + Lukias + Mululu (or alt extender) + Branded Fusion + Blazing Cartesia.

**Endboard (Arthalion line, 6 pieces)**:
- MZONE: Dracotail Arthalion (33760966)
- MZONE: Ecclesia and the Dark Dragon (78397661)
- SZONE: Dracotail Flame (5431722) set
- SZONE: Dracotail Horn (69932023) set
- SZONE: Dracotail Sting (80208225) set
- HAND: Dracotail Faimena (1498449) kept for turn 2

**Combo line**:
1. NS **Dracotail Lukias**. Lukias on-NS: search **Mululu** from deck.
2. Activate **Branded Fusion**. Fuses **Fallen of the White Dragon** (from
   hand or deck per Branded Fusion's rule) into **Lubellion the Searing
   Dragon** (intermediate Fusion).
3. Lubellion → chain into Mirrorjade via Branded Fusion's second clause.
4. **Faimena's Quick Effect**: discard self to Fuse into **Dracotail
   Arthalion**. Arthalion's on-Fusion-SS trigger: set **Dracotail Flame/
   Horn/Sting** from deck.
5. Mulululu fusion: NS Mululu (via Lukias search) → fuse into another
   Dracotail Fusion.
6. Branded-Dracotail hybrid: Fuse into **Ecclesia and the Dark Dragon**
   as 2nd MZONE boss.
7. End of turn: Faimena returned to hand via its effect for turn 2.

**Preferred intermediates** (from fixture metadata):
- `7375867` Fallen of the White Dragon (Branded Fusion material)
- `55273560` ??? (2nd preferred target — likely another Branded body)

## 2 CARD COMBO — Mirrorjade line

**Opener**: SAME AS ARTHALION LINE.

**Endboard (Mirrorjade line, 6 pieces)**:
- MZONE: Mirrorjade the Iceblade Dragon (44146295)
- MZONE: Albion the Sanctifire Dragon (38811586)
- SZONE: Dracotail Flame (5431722) set
- SZONE: Dracotail Horn (69932023) set
- SZONE: Dracotail Sting (80208225) set
- HAND: Dracotail Faimena (1498449) kept

**Divergence from Arthalion line**: the Branded Fusion + Lubellion path
lands on Mirrorjade first, then Branded's recursive effect lands Albion
atop Mirrorjade. The Dracotail side uses Lukias/Mululu to set traps but
does NOT go into Arthalion (tracks a purely Branded-centric finish).

The solver explores both lines via the same opener — matching EITHER
line (not both) indicates canonical reach. Use matched-per-line tracking
rather than additive matched count.

---

## Key SELECT_CARD decisions

1. Lukias search → **Mululu** (additional fusion material access).
2. Branded Fusion target → **Fallen of the White Dragon** or **Blazing
   Cartesia** (Branded materials from hand+deck). CRITICAL: the solver
   must pick the correct Branded fusion that leads to Mirrorjade OR the
   Branded-Dracotail hybrid that leads to Arthalion.
3. Faimena's Quick-Effect discard target → any Dracotail fusion material
   (typically Lukias or a Dracotail body already in hand).
4. Arthalion's trap-set from deck → all 3 traps (Flame + Horn + Sting)
   if Arthalion's on-SS effect allows (per Arthalion's canonical ruling).

---

## THIS FIXTURE's canonical openers (KEEP — user-audited 2026-04-13)

Both `branded-dracotail-opener` and `branded-dracotail-opener-mirrorjade-line`
use the same 5-card hand:
```
[1498449  Dracotail Faimena,
 75003700 Dracotail Lukias,
 73819701 Mululu (Dracotail body),
 44362883 Branded Fusion,
 95515789 Blazing Cartesia]
```

Plus `preferredIntermediates`: [7375867, 55273560]

Rationale (user-audited — Pan → Fallen of the White Dragon swap done
2026-04-13):
- Faimena = Dracotail core Fusion starter.
- Lukias = Dracotail normal summon + search.
- Mululu = fusion extender.
- Branded Fusion = Branded engine spell.
- Blazing Cartesia = Branded extender / fusion body from hand.

## THIS FIXTURE's canonical expectedBoards (KEEP — user-audited)

Both lines preserve their 6-piece endboards as curated. HAND as
endboard zone (Faimena kept) is unusual but valid — the canonical
Dracotail play pattern preserves Faimena for turn-2 re-use.

Structural sanity checks:
- ✓ Arthalion + Ecclesia can coexist as 2 MZONE bosses — both are
  Fusions, summoned via different Fusion spells, no self-consumption.
- ✓ Mirrorjade + Albion can coexist — Albion is summoned atop Mirrorjade
  via Branded Fusion's recursive clause.
- ✓ Flame + Horn + Sting in SZONE: all 3 Normal Traps set face-down for
  opp-turn triggers.
- ✓ Faimena in HAND: returned via its own effect after discarding for
  Fusion. Valid endgame state.

---

## Solver diagnostic mapping

Arthalion line:
- Missing Arthalion → Faimena's discard-fusion didn't reach Arthalion
  materials. Check: was Faimena + Dracotail Lvl 7+ available?
- Missing Ecclesia → 2nd Fusion line didn't complete. Check: Branded
  Fusion chain?
- Missing trap set → Arthalion's trap-set-from-deck effect didn't fire
  OR Dracotail Fusion was not the trigger.

Mirrorjade line:
- Missing Mirrorjade → Branded Fusion → Lubellion → Mirrorjade chain
  broken. Check: Fallen of the White Dragon available as Branded
  material?
- Missing Albion → Mirrorjade's Branded recursion didn't fire.

---

## Endboard weights (solver scoring)

Arthalion line priority:
1. **Dracotail Arthalion** — omni-negate Fusion boss.
2. **Ecclesia and the Dark Dragon** — 2nd boss.
3. **Dracotail Sting** — trap disruption.
4. **Dracotail Flame** — trap disruption.
5. **Dracotail Horn** — trap disruption.
6. **Faimena in HAND** — turn-2 fusion resource.

Mirrorjade line priority:
1. **Mirrorjade the Iceblade Dragon** — Branded primary negate.
2. **Albion the Sanctifire Dragon** — Branded terminal.
3-5. Same Dracotail trap set.
6. **Faimena in HAND** — same.

Matched 6/6 = full canonical finish. ≥3/6 = engine fired. Multi-line
fixture: matching EITHER the Arthalion OR Mirrorjade line indicates
correct solver behavior (not additive). Per the fixture note:
"`matched` on EITHER fixture indicates canonical reach".

Pre-validation smoke (pre-s2 baseline): 41/2-6 (Arthalion) and 32/3-6
(Mirrorjade). Both lines scored structurally and matched partial
pieces. Post-validation preserves these as gold-standard control
Fusion paradigm under methodology v2.
