# Tearlaments Combo Reference (2026-04-17)

Canonical Tearlaments combos for solver validation. Targets the "TEARLAMENT
2026! YT:@fafnirymd" build (2026-02-21). Paired with
`solver-validation-decks.json` fixture `tearlaments-opener`.

Sources:
- Yugipedia Tearlaments archetype page
- Game8 Tearlaments deck guide (game8.co/games/Yu-Gi-Oh-Master-Duel)
- tcgplayer.com Competitive OCG Guide to Tearlaments
- Pedro Luis Bernardos Tearlaments Guide (pedroluisbernardos.github.io/Tearlaments-Guide)
- Master Duel Meta Tearlaments tier guide + deck pages (Yuki-死にたい Feb 2026)
- untapped.gg archetype page (April 2026 meta)

**Paradigm note**: Tearlaments is a **GY-fusion archetype**. Distinct from
Branded (in-hand fusion via Branded Fusion) and Nekroz (ritual summon with
GY-banish tribute). Tearlaments's key mechanic: when a main-deck Tearlaments
monster is sent from DECK to GY via card effect, its Trigger Effect fires —
typically "Fusion Summon using this card and another Tearlaments from GY/
hand/field". This mill-then-fuse loop is why the deck's pre-validation smoke
showed score=4.58 with az=60.1% — the GY-fusion paradigm creates
turn-terminals quickly because the fusion engine self-exhausts once the
Fusion monsters are summoned.

---

## Endboard piece cheat sheet

Tearlaments core bosses:
- **Tearlaments Kitkallos** (Level 10 Aqua Fusion, 92731385) — THE boss.
  Fusion materials: 2 Aqua monsters (flexible). On SS: add any Tearlaments
  card from deck. If sent to GY: mill 5 from deck. Limited in many banlists
  due to raw power. Key card to reach in turn 1.
- **Tearlaments Rulkallos** (Level 8 Aqua Fusion, 84330567) — 2 Tearlaments
  Fusion material. On SS: negate spell/trap activation. Secondary Fusion.
- **Tearlaments Kaleido-Heart** (Level 12 Aqua Fusion, 28226490) — massive
  Fusion, 4 Aqua materials. Recovers Tearlaments on destruction. The
  terminal finisher.

Core starters / mill engine:
- **Tearlaments Reinoheart** (Level 3 Aqua, 73956664) — NS effect: mill
  1 Tearlaments from deck. Also GY trigger: fuse using itself. THE 1-card
  starter.
- **Tearlaments Scheiren** (Level 3 Aqua, 572850) — SS extender: when a
  Tearlaments is SS'd, SS self from hand + mill 3 from deck. Scheiren in
  GY also triggers Fusion.
- **Tearlaments Havnis** (Level 3 Aqua, 37961969) — in-hand handtrap-style
  effect when opp SS: mill 3 from deck.
- **Tearlaments Grief** / **Tearlaments Sulliek** / **Tearlaments Kashtira**
  — additional Tearlaments bodies for Fusion material depth.

Support:
- **Tearlaments Scream** (field spell, 6767771) — Tearlaments discard-mill-
  search engine.
- **Tearlaments Heartbeat** (trap, 60362066) — search/revive.
- **Tearlaments Metanoise** (trap, 38436986) — counter.
- **Trivikarma** (7436169) — alt Tearlaments trap.

Gem-Knight package (alt Fusion engine):
- **Gem-Knight Nepyrim** (Level 2 Rock, 51831560) — mill Gem-Knight from
  deck; in GY triggers Brilliant Fusion.
- **Gem-Knight Quartz** (Level 4 Rock, 35622739) — Gem-Knight Fusion material.
- **Brilliant Fusion** (spell, 7394770) — Gem-Knight Fusion engine, searches
  Gem-Knight and fuses in one.
- **Gem-Knight Amethyst** (Fusion, 71616908) — Gem-Knight boss via Brilliant.

Fiendsmith package:
- **Fiendsmith Engraver** (60764609) — Fiendsmith starter, discard to search.
- **Fabled Lurrie** (97651498) — Fiendsmith discard fodder (Fabled LIGHT
  Fiend, bounces back on other Fabled effects).
- **Lacrima the Crimson Tears** (28803166) — Fiendsmith's Lacrima Fusion
  material.
- **Fiendsmith's Tract** (98567237) — search Fiendsmith monster/spell.
- **Fiendsmith's Requiem** (Link-1, 2463794) — Link Fiendsmith search hub.
- **Fiendsmith's Lacrima** (Fusion, 46640168) — Fiendsmith Fusion body.
- **Fiendsmith's Sequence** (Link-Link, 49867899) — Link Fiendsmith chain.

Generic utility:
- **S:P Little Knight** (29301450) — Link-2 banish.
- **I:P Masquerena** (65741786) — EP Link-2 prep.
- **Underworld Goddess of the Closed World** (98127546) — Link-5 finisher.
- **Moon of the Closed Heaven** (71818935) — Link-2 zombie finisher.

Herald package (secondary handtrap/tribute):
- **Herald of Green Light** (21074344), **Herald of Orange Light** (17266660)
  — Shadoll/Herald handtrap-style effects, good Fairy bodies.

Handtraps (main):
- **Maxx "C"** (23434538) — opp draw restriction.
- **Mulcharmy Fuwalos** (42141493) — same.

---

## Card ID reference (this fixture's available cards)

Tearlaments engine:
- `73956664` Tearlaments Reinoheart (3x) — 1-card starter
- `572850`   Tearlaments Scheiren (2x) — SS extender
- `37961969` Tearlaments Havnis (1x) — handtrap-style
- `33878367` Tearlaments Grief (1x) — body
- `74920585` Tearlaments Sulliek (1x) — body
- `4928565`  Tearlaments Kashtira (1x) — hybrid body
- `6767771`  Tearlaments Scream (3x) — field spell
- `60362066` Tearlaments Heartbeat (1x) — trap
- `38436986` Tearlaments Metanoise (1x) — trap
- `7436169`  Trivikarma (1x) — alt trap

Gem-Knight Fusion sub-engine:
- `51831560` Gem-Knight Nepyrim (3x)
- `35622739` Gem-Knight Quartz (1x)
- `7394770`  Brilliant Fusion (3x)

Fiendsmith sub-engine:
- `60764609` Fiendsmith Engraver (2x)
- `97651498` Fabled Lurrie (1x)
- `28803166` Lacrima the Crimson Tears (1x)
- `98567237` Fiendsmith's Tract (1x)

Heralds / draw:
- `21074344` Herald of Green Light (1x)
- `17266660` Herald of Orange Light (3x)
- `40177746` Eva (1x) — Dragonmaid body? Or similar
- `99937011` Mudora the Sword Oracle (1x) — Fairy Lvl 4
- `2501624`  Dark Magician Girl the Magician's Apprentice (3x)
- `342673`   Dark Magician the Magician of Black Magic (1x)
- `22283204` The Gaze of Timaeus (1x)
- `71832012` Pressured Planet Wraitsoth (1x)
- `79791878` Shining Sarcophagus (1x)

Handtraps:
- `23434538` Maxx "C" (1x)
- `42141493` Mulcharmy Fuwalos (3x)

Extra Deck:
- `92731385` Tearlaments Kitkallos — PRIMARY BOSS
- `84330567` Tearlaments Rulkallos — secondary Fusion
- `28226490` Tearlaments Kaleido-Heart — terminal Fusion
- `46640168` Fiendsmith's Lacrima — Fiendsmith Fusion
- `2463794`  Fiendsmith's Requiem — Link-1 Fiendsmith
- `49867899` Fiendsmith's Sequence — Link-Link Fiendsmith
- `71616908` Gem-Knight Amethyst — Gem-Knight Fusion
- `37818794` Red-Eyes Dark Dragoon — Fusion alt via Brilliant
- `59400890` Dark Magician of Destruction — Fusion
- `79559912` D/D/D Wave High King Caesar — XYZ alt
- `65741786` I:P Masquerena — EP Link
- `27381364` Spright Elf — Link
- `29301450` S:P Little Knight — Link-2 banish
- `71818935` Moon of the Closed Heaven — Link-2
- `98127546` Underworld Goddess of the Closed World — Link-5

---

## 1 CARD COMBO — Reinoheart → Kitkallos

**Endboard**: Kitkallos (MZONE) + Tearlaments Scream field spell (FIELD) +
milled Tearlaments in GY for turn 2 recursion.

1. NS **Tearlaments Reinoheart**. Reinoheart effect: send 1 Tearlaments
   from deck to GY — send **Tearlaments Scheiren**.
2. Scheiren GY trigger: Fusion Summon using Scheiren (in GY) + another
   Tearlaments (e.g. from hand or GY). SS **Tearlaments Kitkallos**.
3. Kitkallos on SS: search any Tearlaments card from deck (take Heartbeat
   or Metanoise for turn-2 cover, or another Tearlaments body).
4. Activate **Tearlaments Scream** (field spell) if available, to continue
   recursion chain.
5. Set any trap from hand as end-of-turn cover.

---

## 2 CARD COMBO — Reinoheart + Scheiren in hand → Kitkallos + Rulkallos + Fiendsmith

**Endboard (this fixture's canonical finish)**: Kitkallos + Kaleido-Heart
+ Fiendsmith's Requiem + S:P Little Knight.

1. NS **Reinoheart** → send Scheiren (or Kitkallos copy) from deck to GY.
2. Scheiren (now in hand, on Reinoheart SS trigger): SS self from hand
   → mill 3 from deck. Choose specific mills to hit Tearlaments Havnis,
   Grief, Sulliek (fusion material depth).
3. GY triggers stack: Scheiren + the milled Tearlaments all fuse →
   **Tearlaments Kitkallos** (Level 10 Fusion, 2 Aqua monsters from GY
   as materials).
4. Kitkallos search → **Tearlaments Grief** or **Tearlaments Heartbeat**
   for recursion.
5. Activate **Tearlaments Scream** field spell → recycles Tearlaments from
   GY to hand, enabling another Fusion chain.
6. Second Fusion → **Tearlaments Rulkallos** OR **Tearlaments Kaleido-
   Heart** (if enough Aqua material in GY).
7. Fiendsmith engine: if Engraver is available, discard Engraver → search
   Fiendsmith Tract → activate Tract → search Fiendsmith's Lacrima → fuse
   into **Fiendsmith's Requiem** using Fabled Lurrie as material.
8. Pair Kitkallos + Requiem via Link-2 setup → SS **S:P Little Knight**
   using Fabled Lurrie (re-used via Fabled effect) + another body.

**Final endboard**:
- MZONE: Tearlaments Kitkallos (92731385)
- MZONE: Tearlaments Kaleido-Heart (28226490)
- MZONE: Fiendsmith's Requiem (2463794)
- MZONE: S:P Little Knight (29301450)

Note: Kaleido-Heart requires 4 Aqua Fusion materials. Easier sub-path goes
to **Rulkallos** (2 Tearlaments material, less demanding). If depth budget
is tight, substitute Rulkallos for Kaleido-Heart in realistic expectedBoard.

---

## Key SELECT_CARD decisions

1. Reinoheart mill target → **Tearlaments Scheiren** (self-SS + mill
   trigger) OR **Tearlaments Kitkallos** (direct to GY → mill 5).
2. Scheiren mill targets → pick Tearlaments that enable NEXT Fusion (e.g.
   Havnis + Grief = 2 more Aqua materials).
3. Kitkallos on-SS search → **Tearlaments Grief** (for recycling via
   Scream) OR **Tearlaments Heartbeat** (trap cover).
4. Fiendsmith Engraver discard → **Fabled Lurrie** (returns to hand via
   Fabled effect, enabling double-use).
5. Fiendsmith search via Tract → **Fiendsmith's Lacrima**.

---

## THIS FIXTURE's canonical opener (CORRECTED)

Previous hand had 4 different Tearlaments (Reinoheart + Scheiren + Havnis
+ Grief + Fuwalos) — 4 engine cards in hand is over-loaded for tournament
realism. Correction: keep only 2 Tearlaments core + Fiendsmith enabler
+ 2 handtraps.

Corrected hand:
```
[73956664 Tearlaments Reinoheart,
 572850   Tearlaments Scheiren,
 97651498 Fabled Lurrie,
 60764609 Fiendsmith Engraver,
 42141493 Mulcharmy Fuwalos]
```

Rationale:
- Reinoheart = 1-card Tearlaments starter.
- Scheiren = SS extender for double-Fusion chain.
- Fabled Lurrie = Fiendsmith engine fuel (discarded via Engraver, bounces
  back via Fabled effect).
- Fiendsmith Engraver = Fiendsmith searcher (discard-to-search Tract).
- Fuwalos = 1 handtrap (realistic — this deck has 3x Fuwalos + 1x Maxx
  + no Ash Blossom in main).

## THIS FIXTURE's canonical expectedBoard (CORRECTED)

Previous expectedBoard: Kitkallos + Rulkallos + S:P + Scream set. Mostly
correct but Rulkallos is a secondary Fusion (often consumed into Kaleido-
Heart as material) and Scream is a field spell not a set trap.

Corrected expectedBoard (4 pieces):
```
MZONE: Tearlaments Kitkallos (92731385)
MZONE: Tearlaments Kaleido-Heart (28226490)
MZONE: Fiendsmith's Requiem (2463794)
MZONE: S:P Little Knight (29301450)
```

Structural sanity checks:
- ✓ Kitkallos + Kaleido-Heart can coexist — Kaleido-Heart is NOT Kitkallos's
  Fusion material (Kaleido-Heart uses 4 Aqua; Kitkallos uses 2 Aqua but
  Kitkallos-as-material into Kaleido-Heart is unusual and not canonical).
- ✓ Fiendsmith's Requiem is a Link-1 — does not consume Kitkallos as mat.
- ✓ S:P Little Knight is a Link-2, uses Fabled Lurrie + another body.
- ✓ All 4 pieces are in extra deck (no side-deck contamination).

---

## Solver diagnostic mapping

- Missing Kitkallos → Reinoheart mill chain did not complete Fusion. Check:
  did Reinoheart's on-NS trigger fire? Did Scheiren SS trigger? Did 2 Aqua
  materials collect in GY?
- Missing Kaleido-Heart → second Fusion chain incomplete. Check: was Scream
  activated? Was enough Aqua material recycled?
- Missing Requiem → Fiendsmith engine did not fire. Check: was Engraver
  discarded? Was Tract activated?
- Missing S:P Little Knight → Link-2 chain missed. Check: were 2+ effect
  monsters on field?

---

## Endboard weights (solver scoring)

Priority order:
1. **Kitkallos** — the Tearlaments centerpiece, highest structural value.
2. **Kaleido-Heart** — terminal Fusion, large body.
3. **Requiem** — Fiendsmith hub, enables additional Fiendsmith plays.
4. **S:P Little Knight** — banish control Link.

Matched 4/4 = full Tearlaments + Fiendsmith turn-1. 2/4 = Tearlaments
engine fired (Kitkallos + one other). 0/4 = GY-fusion paradigm did not
execute — likely handtrap (Droll, Ash equivalent) disrupting mill chain,
or solver's DFS not enumerating GY-Fusion trigger orderings correctly.

Pre-validation smoke showed score=4.58, matched=0/4, az=60.1% — the
actionsZero% is diagnostic of the GY-fusion paradigm's "fast terminal"
property. DFS terminates quickly once main Fusion bosses are summoned
because further Tearlaments plays require opp Special Summons (handtrap
mode) to trigger. This is an empirical marker of the GY-fusion
paradigm's coverage gap — worth flagging for step 3 / constraint 2.3
research on cross-paradigm scoring normalization.
