# Floowandereeze Combo Reference (2026-04-17)

Canonical Floowandereeze combos for solver validation. Targets the
"FLOOWANDEREEZE - yes floo is still good without feather storm" (2026)
competitive build. Paired with `solver-validation-decks.json` fixture
`floowandereeze-opener`.

Sources:
- Master Duel Meta Intro to Floowandereeze (masterduelmeta.com/articles/guides/floowandereeze-martin)
- Master Duel Meta Intro to Floowandereeze 2025 (masterduelmeta.com/articles/guides/floow-funky)
- Game8 Floowandereeze deck guide (game8.co/games/Yu-Gi-Oh-Master-Duel/archives/382184)
- Cards Realm Floowandereeze budget deck guide
- Yugipedia Floowandereeze archetype
- tcgplayer "The Secret Floowandereeze Combo" article

**Paradigm note**: Floowandereeze is a **Normal Summon / Tribute Summon
orientation archetype**. Distinct from every other fixture — Flo birds
can ONLY be Summoned by banishing a card from hand as tribute (not
Special Summoned normally). This forces a unique play pattern: slow-
pace, tribute-based, opp-turn chain activations. End boards feature
big Lvl 8/10 bodies (Empen, Apex Avian, Raiza) on field + continuous
field-spell/trap setup.

---

## Endboard piece cheat sheet

Flo big bodies (Level 10 finishers):
- **Floowandereeze & Empen** (Level 10 Winged-Beast, 80611581) — the
  primary Flo boss. On NS/TS: search a Floowandereeze spell/trap. PASSIVE:
  opponent cannot activate spell/trap effects while Empen is on field.
  Complete spell/trap lock + search engine.

Flo big bodies (Level 8 mid bosses):
- **Mist Valley Apex Avian** (Level 8 Winged-Beast Spirit, 29587993) —
  omni-negate boss. Effect: when a card/effect resolves, negate it and
  return self to hand (Spirit mechanic). Search via Eglen.
- **Raiza the Mega Monarch** (Level 8 Winged-Beast, 69327790) — bounce
  effect on Tribute Summon. Alt Lvl 8 finisher.

Flo small bodies (Level 1 searchers/tribute material):
- **Floowandereeze & Robina** (Level 1, 18940725) — core starter.
  NS/TS: banish 1 card from hand as tribute + search any Floowandereeze
  monster. 1-card combo starter.
- **Floowandereeze & Eglen** (Level 1, 54334420) — NS/TS: banish 1 card
  + search Apex Avian or a Flo Winged-Beast.
- **Floowandereeze & Toccan** (Level 1, 17827173) — NS/TS: banish 1 card
  + tutor a Floowandereeze spell/trap (incl. Map, Dreaming Town, Advent
  of Adventure).
- **Floowandereeze & Stri** (Level 1, 80433039) — engine extension,
  reviver.
- **Floowandereeze & Snowl** (Level 1, 53212882) — alt Lvl 1 extender.

Floowandereeze spells (engine):
- **Floowandereeze and the Magnificent Map** (28126717) — THE Floo field
  spell. Enables additional Normal Summons via its clauses. Tutored by
  Toccan.
- **Floowandereeze and the Dreaming Town** (41215808) — engine piece;
  special-summons banished Flo birds during opp turn / chain triggers.
- **Floowandereeze and the Advent of Adventure** (69087397) — search
  Flo monster from deck.
- **Floowandereeze and the Unexplored Winds** (55521751) — alt search.
- **Floowandereeze and the Scary Sea** (77610503) — alt effect.

Utility:
- **Dimension Shifter** (91800273) — banish instead of GY for whole turn.
- **Dimensional Fissure** (81674782) — continuous banish.
- **Dark Ruler No More** (54693926) — big board breaker.
- **Cosmic Cyclone** (8267140) — banish spell/trap removal.

Lyrilusc extenders:
- **Ripple Bird** (56410769) — Lyrilusc body.
- **Lyrilusc - Recital Starling** (8491961) — Rank 1 material.
- **Lyrilusc - Assembled Nightingale** (Rank 1 Xyz, 48608796) — Nightingale
  Rank 1 Xyz multi-attacker.

---

## Card ID reference (this fixture's available cards)

Flo bodies (main):
- `18940725` Robina (3x) — core starter
- `54334420` Eglen (3x) — Apex Avian searcher
- `80611581` Empen (2x) — Level 10 boss
- `80433039` Stri (2x)
- `17827173` Toccan (2x) — Map tutor
- `53212882` Snowl (1x)
- `29587993` Mist Valley Apex Avian (1x) — omni-negate
- `69327790` Raiza the Mega Monarch (1x) — bounce Lvl 8

Handtraps (main):
- `73642296` Ghost Belle & Haunted Mansion (3x)
- `91800273` Dimension Shifter (1x)

Flo spells (main):
- `28126717` Floowandereeze and the Magnificent Map (2x) — field spell
- `69087397` Floowandereeze and the Advent of Adventure (2x)
- `55521751` Floowandereeze and the Unexplored Winds (1x)
- `41215808` Floowandereeze and the Dreaming Town (2x)
- `77610503` Floowandereeze and the Scary Sea (1x)

Utility:
- `98645731` Pot of Duality (3x)
- `49238328` Pot of Extravagance (3x)
- `81674782` Dimensional Fissure (2x)
- `54693926` Dark Ruler No More (3x)
- `8267140`  Cosmic Cyclone (3x)
- `75500286` Gold Sarcophagus (1x)
- `73628505` Terraforming (1x)
- `24224830` Called by the Grave (1x)

Extra Deck:
- `56410769` Ripple Bird (3x)
- `48608796` Lyrilusc - Assembled Nightingale (3x) — Rank 1 Xyz
- `8491961`  Lyrilusc - Recital Starling (3x)
- `27240101` Kikinagashi Fucho (1x)
- `38342335` Knightmare Unicorn (2x) — Link-3
- `2857636`  Knightmare Phoenix (3x) — Link-2

Side (small): Lava Golem, Ghost Ogre.

---

## 1 CARD COMBO — Floowandereeze & Robina → Empen + Apex Avian setup

**Endboard**: Empen (MZONE) + Apex Avian (MZONE) + Assembled Nightingale
(EMZ_L Rank 1 Xyz) + Magnificent Map (FIELD).

1. Activate **Floowandereeze and the Magnificent Map** (field spell) if
   in hand; otherwise, tutor via Toccan later.
2. NS **Robina** by banishing 1 card from hand as tribute cost.
3. Robina on-NS: search **Floowandereeze & Empen** from deck.
4. NS **Eglen** (or another Lvl 1 Flo) by banishing another card from
   hand. Eglen on-NS: search **Mist Valley Apex Avian** from deck.
5. Activate Map's additional-NS clause: Tribute Summon Empen (tributing
   1 Flo Lvl 1 body, e.g. Robina).
6. Empen on-TS: search **Floowandereeze and the Dreaming Town** from deck.
7. Tribute Summon **Apex Avian** (requires 2 tributes normally, but via
   Map or direct Eglen search, the solver-simulator uses the canonical
   Tribute Summon chain with 2x Lvl 1 Flo tributes).
8. Use Ripple Bird + Recital Starling → Xyz into **Lyrilusc - Assembled
   Nightingale** (Rank 1, via banished-Flo bodies returning via Dreaming
   Town effect, or via Lyrilusc engine directly).

**Final endboard**:
- MZONE: Floowandereeze & Empen (80611581)
- MZONE: Mist Valley Apex Avian (29587993)
- EMZ_L: Lyrilusc - Assembled Nightingale (48608796)
- FIELD: Floowandereeze and the Magnificent Map (28126717)

---

## Key SELECT_CARD decisions

1. Robina's banish-tribute cost target → any non-essential card in hand
   (typically a redundant Flo).
2. Robina on-NS search → **Empen** (primary boss).
3. Eglen on-NS search → **Apex Avian** (omni-negate).
4. Toccan on-NS search (if tutoring) → **Dreaming Town** (not Map, since
   Map is typically already in hand or active).
5. Empen on-TS search → **Dreaming Town** (engine piece) or **Advent of
   Adventure** (additional search).

---

## THIS FIXTURE's canonical opener (KEEP)

Existing hand:
```
[18940725 Floowandereeze & Robina,
 28126717 Floowandereeze and the Magnificent Map,
 54334420 Floowandereeze & Eglen,
 17827173 Floowandereeze & Toccan,
 73642296 Ghost Belle & Haunted Mansion]
```

Rationale (passes methodology):
- Robina = 1-card starter (NS banish-tribute → search Empen).
- Map = field spell enabler (extra NS permits).
- Eglen = Apex Avian searcher (2nd NS after Robina).
- Toccan = Map tutor (redundant safety or Dreaming Town tutor).
- Ghost Belle = handtrap (3x in main).

All 5 cards serve engine roles in the Flo normal-summon-lock paradigm.
This is a dense but realistic Flo opener — the deck intentionally plays
4+ engine cards per hand because Tribute Summons consume hand resources.

## THIS FIXTURE's canonical expectedBoard (KEEP)

Existing expectedBoard:
```
MZONE: Floowandereeze & Empen (80611581)
MZONE: Mist Valley Apex Avian (29587993)
EMZ_L: Lyrilusc - Assembled Nightingale (48608796)
FIELD: Floowandereeze and the Magnificent Map (28126717)
```

Structural sanity checks:
- ✓ Empen stays on field (no self-tribute effect).
- ✓ Apex Avian stays unless used during opp turn (Spirit bounces self
  after negate). At end-of-your-turn-1, Apex Avian is on field.
- ✓ Assembled Nightingale Rank 1 Xyz: summoned via Lyrilusc Ripple Bird
  + Recital Starling, material attached. Stays unless detached.
- ✓ Map active in FIELD zone (not SZONE, field spell has its own zone).
- ✓ All 4 pieces reachable from this deck's main + extra.

---

## Solver diagnostic mapping

- Missing Empen → Robina or Eglen search did not fire. Check: was NS
  blocked by Ash or handtrap?
- Missing Apex Avian → Eglen's search missed, OR Apex Avian was Tribute
  Summoned and then Spirit-bounced already (it's NOT on field anymore
  after its effect). Match depends on whether Apex Avian fired its
  negate during turn 1 (unlikely for offensive player).
- Missing Nightingale → Lyrilusc engine not triggered. Check: were
  enough Lvl 1 Winged-Beasts on field/GY for Xyz?
- Missing Map → field spell was destroyed mid-turn OR not activated.
  Check: is Map active or still in hand at peak-field snapshot?

---

## Endboard weights (solver scoring)

Priority order:
1. **Empen** — spell/trap-activation floodgate + search engine.
2. **Apex Avian** — omni-negate, turn-2 defense.
3. **Nightingale** — Rank 1 Xyz multi-attacker, OTK potential.
4. **Map** — engine field spell recursion.

Matched 4/4 = full Flo turn-1 lock. 2/4 = core engine fired (Empen +
Apex Avian typically). 0/4 = normal-summon blocked (Ash on Robina's
search, Nibiru on 5th summon, etc.).

Step 3 ES tuning note: Floowandereeze's F3 Extra Deck Material Pool
scoring should heavily weight Rank 1 Xyz + Lvl 8/10 Tribute Summon
access. F2 Tutor Chain fires 3+ deep (Robina → Empen → Dreaming Town →
Lvl 1 extender search). F1 Ritual = 0.
