# Snake-Eye Combo Reference (2026-04-17)

Canonical Snake-Eye combos for solver validation. Specifically targets the
Hollywood WCQ Regional winner build: Shining Sarcophagus Fiendsmith Snake-Eye
Yummy (Jad Andary, 2026-03-22). Paired with `solver-validation-decks.json`
fixture `snake-eye-yummy-opener`.

Sources:
- Master Duel Meta tier guide + deck pages (masterduelmeta.com)
- ygoprodeck tournament listings (hollywood-wcq-regional-4371)
- YGO101 + gathering-games combo guide for 2026 TCG meta

---

## Endboard piece cheat sheet

Core Snake-Eye:
- **Snake-Eyes Flamberge Dragon** (Level 8 Pyro) — once per turn, place a face-up
  monster from field or GY face-up in your S/T zone as a Continuous Spell.
  Other effect: during opponent's turn, SS any monster currently treated as a
  Continuous Spell to your field. Enables a "monster treated as Continuous Spell"
  ecosystem (cornerstone of Snake-Eye's recursion).
- **Snake-Eyes Doomed Dragon** (Fusion Level 10 Pyro Dragon) — fusion requires
  2 Level 1 FIRE monsters. Unaffected by monster effects, destroys a card on
  activation + destroys opponent's monster on each SS. Not always reached;
  depends on Flamberge placement loop.
- **Snake-Eye Ash** (Level 1 Pyro) — the 1-card starter. Searches any Snake-Eye
  spell/trap OR places itself face-up in S/T zone as Continuous Spell (lifeline
  for Flamberge revival).
- **Snake-Eyes Poplar** (Level 1 Pyro) — when SS'd, add 1 Level 1 FIRE or
  "Snake-Eyes" Spell/Trap. Chained into a tutor loop.

Fiendsmith engine:
- **Fiendsmith's Requiem** (Link-1) — summoned with a LIGHT Fiend, searches
  Fiendsmith spell/trap or a Fiendsmith monster. Tutor hub.
- **Fiendsmith's Desirae** (Fusion Link-like) — big Fiendsmith boss, provides
  omni-negate effect. End-of-combo finisher via Fiendsmith's Lacrima fusion.
- **Fiendsmith Engraver** (Level 6 Fiend) — discard self from hand to search
  a Fiendsmith spell/trap. Core enabler for the engine.
- **A Bao A Qu, the Lightless Shadow** (Link-1) — zombie ritual finisher,
  revived from GY.

Yummy engine:
- **Lollipo★Yummy Way** (Synchro Level 2), **Cupsy★Yummy Way** (Synchro Level 4),
  **Cooky★Yummy Way** (Synchro Level 3) — synchro chain via Marshmao discard.
- **Yummy★Snatchy** (Link-1) — end Link-1 for the Yummy chain.

Shining Sarcophagus:
- **Shining Sarcophagus** (continuous trap) — when an "Nth Spell" (1st, 2nd,
  etc.) activates, summons a generic "Spell Card" monster token. The Hollywood
  build exploits this for extra bodies mid-combo. `Spell Card "Monster Reborn"`
  (28958464) is the monster form of Monster Reborn, summoned by Sarcophagus.

Generic Link utility:
- **S:P Little Knight** (Link-2) — banish-zone control, flips opponent face-down
  with a destroy-if-face-up clause.

---

## Card ID reference (this fixture's available cards)

Main-deck starters:
- `9674034`  Snake-Eye Ash (3x) — THE 1-card starter
- `90241276` Snake-Eyes Poplar (2x)
- `45663742` Snake-Eye Oak (1x) — searches Poplar/Ash from GY
- `48452496` Snake-Eyes Flamberge Dragon (1x, MAIN deck — searchable, not Extra)
- `72270339` Diabellstar the Black Witch (1x, main + 1x side) — Sinful Spoils pivot
- `28803166` Lacrima the Crimson Tears (1x) — Fiendsmith's Lacrima Fusion material

Fiendsmith core:
- `60764609` Fiendsmith Engraver (3x) — discard-self to search
- `97651498` Fabled Lurrie (1x) — Fiend discard fodder for Engraver (Level 1 Fiend)

Yummy core:
- `31425736` Cupsy☆Yummy (3x)
- `10966439` Marshmao☆Yummy (3x)
- `68810435` Cooky☆Yummy (2x)
- `4215180`  Lollipo☆Yummy (2x)

Search/tutor spells & traps:
- `80845034` WANTED: Seeker of Sinful Spoils (1x) — tutor Snake-Eye + Diabellstar
- `98567237` Fiendsmith's Tract (2x) — search Fiendsmith
- `26700718` Dramatic Snake-Eye Chase (1x) — SS Snake-Eye tutor
- `24081957` Sinful Spoils of Subversion - Snake-Eye (1x) — Snake-Eye trap
- `85106525` Bonfire (1x) — search Level 1 Pyro (Ash/Oak/Poplar)
- `2295440`  One for One (1x) — SS Level 1 (Snake-Eye activation)
- `79791878` Shining Sarcophagus (1x) — NAMED spell-activation trigger

Extra Deck bosses (this fixture):
- `82135803` Fiendsmith's Desirae — Fusion Fiendsmith boss
- `49867899` Fiendsmith's Sequence — Link Fiendsmith
- `2463794`  Fiendsmith's Requiem — Link-1 Fiendsmith tutor
- `4731783`  A Bao A Qu, the Lightless Shadow — Link-1 Zombie
- `29301450` S:P Little Knight — Link-2 banish
- `41999284` Linkuriboh — Link-1 body
- `58071334` Snake-Eyes Doomed Dragon — Fusion boss
- `59400890` Dark Magician of Destruction — Fusion alt finisher
- `22850702` Chaos Angel — big Synchro
- `73082255` The Zombie Vampire — Rank 3 Xyz

Handtraps (main):
- `14558127` Ash Blossom & Joyous Spring (3x)
- `42141493` Mulcharmy Fuwalos (3x)
- `84192580` Mulcharmy Purulia (3x)
- `27204311` Nibiru, the Primal Being (3x)

---

## 1 CARD COMBO — Snake-Eye Ash (pure) → Flamberge + Desirae

**Endboard (reachable from THIS fixture's extra deck)**:
Flamberge + Fiendsmith's Desirae + S:P Little Knight + Sinful Spoils set

1. NS **Snake-Eye Ash**. Ash effect: search **Snake-Eyes Poplar**.
2. Ash self-effect: place itself face-up in S/T zone as Continuous Spell.
3. SS **Poplar** (Level 1 trigger). Poplar effect: add **Dramatic Snake-Eye Chase**
   (or Sinful Spoils) to hand.
4. Activate **Chase** → target Ash (now as Continuous Spell) → SS Ash back to
   field in Def position. Chase + Ash on field.
5. Use Ash's on-field effect: place a monster on field or GY as Continuous Spell.
6. Summon a Link-2 body combining Ash + Poplar (e.g. via Level 1 tuner loop
   with Fabled Lurrie) → send Fabled Lurrie (Level 1 Fiend) to trigger Fiendsmith.
7. Fiendsmith chain: discard **Fiendsmith Engraver** → search **Fiendsmith's
   Tract**. Activate Tract → search **Fiendsmith's Lacrima**. Lacrima effect:
   fuse into **Fiendsmith's Requiem** (Link-1).
8. Requiem effect: search Fiendsmith card. Chain into **Fiendsmith's Desirae**
   via Sequence fusion (Link-up).
9. **Snake-Eyes Flamberge Dragon** is summoned via Snake-Eye's in-hand/from-deck
   SS clause (Snake-Eye + another FIRE on field → SS Flamberge from ED or hand).
10. Final board: Flamberge (MZONE), Desirae (MZONE), S:P Little Knight (MZONE),
    Sinful Spoils set (SZONE).

**Key SELECT_CARD decisions**:
1. Ash search → **Poplar** (NOT Oak, NOT Diabellstar in this line)
2. Poplar search → **Dramatic Snake-Eye Chase** OR **Sinful Spoils of Subversion**
3. Fiendsmith Engraver discard → **Fabled Lurrie** (Level 1 Fiend, returns to hand)
4. Engraver search via Tract → **Fiendsmith's Lacrima**

---

## 1 CARD COMBO — Snake-Eye Ash + Fabled Lurrie in hand → extended Fiendsmith board

**Endboard**: Flamberge + Desirae + Requiem (GY) + A Bao A Qu (GY/field)

Fabled Lurrie's ability to return to hand means double-tap Fiendsmith engine:
1. Standard Ash → Poplar → Flamberge ramp (steps 1-5 above).
2. First Engraver discard: Fabled Lurrie → search Tract → Lacrima fuse into
   Requiem. Lurrie returns to hand (Fabled effect).
3. Second Engraver discard: Fabled Lurrie again → Tract (2nd) → chain into
   Desirae via Sequence.
4. A Bao A Qu: end-of-chain Link-1 from Fiendsmith + zombie fodder.

---

## 2 CARD COMBO — Snake-Eye Ash + WANTED → full board with Diabellstar pivot

**Endboard**: Flamberge + Doomed Dragon + Desirae + Sinful Spoils set + I:P
would be added IF I:P was in extra (not in this fixture's extra).

1. NS Ash → search Poplar.
2. Activate **WANTED: Seeker of Sinful Spoils** → search Diabellstar.
3. SS **Diabellstar the Black Witch** (by placing WANTED in GY as Spell card).
   Diabellstar effect: set any Sinful Spoils from deck.
4. Set Sinful Spoils → activate → triggers Spoils chain.
5. Flamberge + Fiendsmith as before.
6. Doomed Dragon: fuse 2 Level 1 FIRE (Ash + Poplar already on field or in GY).

---

## THIS FIXTURE's canonical opener

Fixture hand target: **Snake-Eye Ash + 4 Fiendsmith/handtrap support**

Recommended hand (realistic 2026 meta composition):
```
[9674034 Snake-Eye Ash, 14558127 Ash Blossom, 42141493 Mulcharmy Fuwalos,
 97651498 Fabled Lurrie, 60764609 Fiendsmith Engraver]
```

Rationale:
- Ash is the single starter (NOT Ash + WANTED + Bonfire — that's over-loaded).
- Ash Blossom + Fuwalos are standard protective handtraps (3x each in main).
- Fabled Lurrie enables the Fiendsmith engine via Engraver's discard cost.
- Fiendsmith Engraver in hand is optional (can be drawn from deck via Tract
  search), but having it in hand makes the combo deterministic.

## THIS FIXTURE's realistic expectedBoard

Conservative 4-piece endboard actually reachable from THIS deck's extra:

```
MZONE: Snake-Eyes Flamberge Dragon (48452496)
MZONE: Fiendsmith's Desirae (82135803)
MZONE: S:P Little Knight (29301450)
MZONE: Snake-Eyes Doomed Dragon (58071334)
```

Notes:
- **I:P Masquerena** appears in the deck's SIDE (65741786) — NOT reachable in
  a main-deck combo. Excluded from expectedBoard.
- **Promethean Princess** is referenced in generic Snake-Eye guides but is
  NOT in this deck — the Hollywood build cut it for Shining Sarcophagus + Yummy
  slots. Excluded.
- **Fiendsmith's Requiem** (2463794) is typically tributed to summon Desirae
  in the standard chain, so listing BOTH is unusual. We list Desirae only.

---

## Solver diagnostic mapping

When solver's peak field deviates from the expectedBoard:
- Missing Flamberge → Snake-Eye Ash base activation did not chain into
  Snake-Eye boss summon. Check: did Ash search Poplar correctly? Did Poplar SS
  happen? Did the "Continuous Spell placement" effect fire?
- Missing Desirae → Fiendsmith engine did not fire. Check: was Engraver's
  discard effect resolved? Was Fabled Lurrie available as discard target?
- Missing S:P Little Knight → Link summoning chain didn't reach Link-2. Check:
  were 2 effect monsters on field simultaneously?
- Missing Doomed Dragon → Fusion failed. Check: were 2 Level 1 FIRE monsters
  in GY? Doomed Dragon is the most advanced piece and hardest to reach in
  deterministic budget.

---

## Endboard weights (solver scoring)

```
MZONE (each = ~3-5 structural score):
- Flamberge: omni-negate via Continuous Spell revival loop = highest priority
- Desirae: Fusion omni-negate = high priority
- S:P Little Knight: banish + set-face-down control = medium
- Doomed Dragon: Fusion on-SS destruction = medium (nice-to-have)
```

Matched 4/4 = full endboard reached. 2/4 = core Flamberge + Desirae. 0/4 = combo
did not execute (likely handtrap stall or Engraver misfire).
