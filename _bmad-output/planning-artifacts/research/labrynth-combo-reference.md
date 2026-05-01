# Labrynth Combo Reference (2026-04-17)

Canonical Labrynth combos for solver validation. Targets the Labrynth 2026
(YGOPRODeck 682215) competitive Jan 2026 build with Dogmatika sub-engine.
Paired with `solver-validation-decks.json` fixture `labrynth-opener`.

Sources:
- Master Duel Meta Labyrinth in-depth guide (masterduelmeta.com/articles/guides/labrynth-guide-paul)
- Master Duel Meta Intro to Labrynth (masterduelmeta.com/articles/guides/labrynth-guide-nemein)
- Game8 Labrynth deck guide (game8.co/games/Yu-Gi-Oh-Master-Duel/archives/401046)
- Yugipedia Labrynth archetype
- ygom.untapped.gg Labrynth meta page (April 2026)
- Steam Community "The Enormous Silver Castle" Labrynth guide

**Paradigm note**: Labrynth is a **trap-heavy Fiend control deck**. The
engine revolves around two Normal Traps ("Welcome Labrynth" + "Big Welcome
Labrynth") that Special Summon Labrynth monsters from the deck. Core loop:
Welcome/Big Welcome → SS Labrynth → Labrynth triggers → search more traps
→ continue. Low-monster, high-backrow style.

---

## Endboard piece cheat sheet

Primary bosses:
- **Lady Labrynth of the Silver Castle** (Level 8 Fiend, 81497285) — core
  Labrynth boss. On SS: search Labrynth spell/trap. When a Normal Trap
  effect resolves: set 1 Normal Trap from deck/GY. The sustained-resource
  body.
- **Lovely Labrynth of the Silver Castle** (Level 8 Fiend, 2347656) — alt
  Lvl 8 Labrynth body. On SS via Labrynth trap: destroy opp's card. Pairs
  with Lady in extended combos.

Search Fiends (1-card extenders):
- **Labrynth Stovie Torbie** (Level 4 Fiend Flip, 74018812) — Quick Effect:
  search a Welcome Labrynth Normal Trap from deck. THE 1-card starter.
- **Labrynth Chandraglier** (Level 4 Fiend Flip, 37629703) — Quick Effect:
  search Big Welcome Labrynth Normal Trap from deck. Alt 1-card starter.
- **Arias the Labrynth Butler** (Level 4 Fiend, 73602965) — in hand/field
  effect: set any Labrynth Normal Trap from deck.
- **Arianna the Labrynth Servant** (Level 4 Fiend, 1225009) — search
  Welcome trap on SS.
- **Ariane the Labrynth Servant** (Level 4 Fiend, 75730490) — Labrynth
  extender.

Engine traps:
- **Welcome Labrynth** (Normal Trap, 5380979) — SS a Labrynth Fiend from
  deck.
- **Big Welcome Labrynth** (Normal Trap, 92714517) — SS a Labrynth Fiend
  from hand/deck + bounce your own monster (re-trigger loop).
- **Transaction Rollback** (Normal Trap, 6351147) — copy a Normal Trap's
  effect from GY. Pairs with Welcome/Big Welcome for double-summon.
- **Labrynth Labyrinth** (Field Spell, 33407125) — search + recycle engine.

Dogmatika sub-engine:
- **Dogmatika Fleurdelis, the Thunderbolt** (Level 4 Fairy, 73355772) —
  Dogmatika floodgate/negate body.
- **Dogmatika Ecclesia, the Virtuous** (Level 4 Fairy, 60303688) — Fairy
  extender.
- **Dogmatika Punishment** (Normal Trap, 82956214) — banish from opp's ED,
  trigger Dogmatika.

Utility bodies (main):
- **Absolute King Back Jack** (Level 2, 60990740) — stacks trap on top of
  deck.
- **Quadogmatika Beast** (16693934) — Dogmatika Fusion support.

Floodgate / counter traps:
- **Ice Dragon's Prison** (Normal Trap, 20899496) — banish opp monster.
- **Different Dimension Ground** (Continuous Trap, 31849106) — banish all
  SS'd monsters.
- **Terrors of the Overroot** (Continuous Trap, 63086455) — floodgate.
- **The Black Goat Laughs** (Continuous Trap, 49299410) — floodgate.
- **Trap Trick** (Normal Trap, 80101899) — search Normal Trap from deck.
- **Warning Point** (Counter Trap, 11429811) — negate.
- **Infinite Impermanence** (Continuous Trap, 10045474) — standard
  handtrap-style negate.

Destructive Daruma Karma Cannon:
- **Destructive Daruma Karma Cannon** (30748475) — Quick-play, burn.

---

## Card ID reference (this fixture's available cards)

Labrynth Fiends (main):
- `81497285` Lady Labrynth of the Silver Castle (1x) — main boss
- `2347656`  Lovely Labrynth of the Silver Castle (1x) — alt boss
- `73602965` Arias the Labrynth Butler (3x) — trap-set extender
- `75730490` Ariane the Labrynth Servant (1x)
- `1225009`  Arianna the Labrynth Servant (1x)
- `37629703` Labrynth Chandraglier (3x) — Quick Effect Big Welcome searcher
- `74018812` Labrynth Stovie Torbie (3x) — Quick Effect Welcome searcher
- `60990740` Absolute King Back Jack (3x) — trap-stacker

Dogmatika sub-engine:
- `73355772` Dogmatika Fleurdelis, the Thunderbolt (2x)
- `60303688` Dogmatika Ecclesia, the Virtuous (1x)
- `82956214` Dogmatika Punishment (2x)
- `16693934` Quadogmatika Beast (1x)

Core engine traps:
- `5380979`  Welcome Labrynth (2x) — primary summon trap
- `92714517` Big Welcome Labrynth (3x) — bounce-summon trap
- `6351147`  Transaction Rollback (2x) — Welcome copy
- `80101899` Trap Trick (2x) — search Normal Trap

Utility traps:
- `20899496` Ice Dragon's Prison (2x)
- `31849106` Different Dimension Ground (2x)
- `63086455` Terrors of the Overroot (2x)
- `49299410` The Black Goat Laughs (1x)
- `11429811` Warning Point (2x)
- `30748475` Destructive Daruma Karma Cannon (2x)
- `10045474` Infinite Impermanence (3x) — main-deck handtrap

Extra Deck (control-flavored):
- `41373230` Titaniklad the Ash Dragon — Dogmatika Fusion
- `11765832` Garura, Wings of Resonant Life — LINK-2
- `80532587` Elder Entity N'tss — Dogmatika-Fusion Rank 4
- `22850702` Chaos Angel — Synchro
- `93039339` Super Starslayer TY-PHON — Rank 12
- `40673853` Vallon, the Super Psy Skyblaster — Link
- `66011101` Number 60: Dugares the Timeless — Rank 4
- `10019086` Tri-Brigade Arms Bucephalus II — Link
- `98127546` Underworld Goddess of the Closed World — Link-5
- `8264361`  Dharc the Dark Charmer, Gloomy — Link-2
- `33781156` Tri-Brigade Arms Mouser — Link
- `29301450` S:P Little Knight — Link-2 banish
- `71607202` Muckraker From the Underworld (2x) — Link-3
- `94259633` Relinquished Anima — Link-1
- `9940036`  Mereologic Aggregator — Link

Side deck (handtraps + disruption): Ash, Droll, Fuwalos, etc.

---

## 1 CARD COMBO — Labrynth Stovie Torbie → Lady on field

**Endboard**: Lady Labrynth (MZONE) + Welcome Labrynth set + Big Welcome
Labrynth set + Transaction Rollback set.

1. NS **Labrynth Stovie Torbie**. Quick Effect: target self (or another
   Flip monster) → search **Welcome Labrynth** or **Big Welcome Labrynth**
   from deck, set to SZONE (Quick Effect allows set directly).
2. End of NS: activate **Welcome Labrynth** (if set from Stovie's effect
   allows). Welcome: SS a Labrynth Fiend from deck → **Lady Labrynth of
   the Silver Castle** (Level 8, SS via trap).
3. Lady on SS: search any Labrynth spell/trap — take **Labrynth
   Labyrinth** field spell OR **Transaction Rollback** trap.
4. Lady's continuous trigger: whenever a Normal Trap resolves, set a
   Normal Trap from deck. Welcome resolved → set **Big Welcome Labrynth**
   from deck.
5. Set **Transaction Rollback** from hand (if drawn) for turn-2 Welcome
   copy.

**Final endboard**:
- MZONE: Lady Labrynth of the Silver Castle (81497285)
- SZONE: Welcome Labrynth (5380979) — in GY now, reset via Lady's effect
- SZONE: Big Welcome Labrynth (92714517) set
- SZONE: Transaction Rollback (6351147) set

---

## Key SELECT_CARD decisions

1. Stovie Torbie Quick Effect search → **Big Welcome Labrynth** (preferred
   over Welcome because Big Welcome can bounce own monsters for
   re-trigger, more sustained value).
2. Welcome/Big Welcome SS target → **Lady Labrynth** first (primary boss).
   Second Welcome later → **Lovely Labrynth** for double boss.
3. Lady's on-SS search → **Labrynth Labyrinth** (field spell recursion)
   OR **Transaction Rollback** if not in hand.
4. Lady's Normal-Trap-resolution set → any useful trap from deck (Big
   Welcome, Dogmatika Punishment, Warning Point).

---

## THIS FIXTURE's canonical opener (KEPT — experimentally validated)

Original fixture hand:
```
[74018812 Labrynth Stovie Torbie,
 5380979  Welcome Labrynth,
 73602965 Arias the Labrynth Butler,
 1225009  Arianna the Labrynth Servant,
 10045474 Infinite Impermanence]
```

**Experimental probe findings** (2026-04-17):
A "hand realism refinement" was attempted to reduce Labrynth monster
count in hand (replace Arias + Arianna with engine traps Big Welcome +
Transaction Rollback). The probe revealed:
- Original hand: score=8, matched=2/4, depth=31, t2=40.5%
- "Refined" hand: score=6, matched=0/4, depth=17, **t2=77.3%**

The jump in t2% (40.5% → 77.3%) + depth collapse (31 → 17) indicates
the new hand DISABLES the combo engine. Diagnosis: **Big Welcome
Labrynth has a bounce-SS clause** that, when applied to YOUR OWN
Labrynth monsters, triggers their on-SS effects again. Multiple
Labrynth monsters in hand (Arias + Arianna + Stovie) form a CHAIN
of on-SS triggers via Big Welcome bouncing them → SS from deck into
a triggered Labrynth → chain more triggers. **This is not redundancy;
it is the engine's depth mechanism.**

Rationale (original hand, validated):
- Stovie Torbie = Quick Effect searcher (1-card starter).
- Welcome Labrynth = engine trap.
- Arias the Labrynth Butler = trap-set effect (set any Labrynth Normal
  Trap from deck) — key engine depth contributor.
- Arianna the Labrynth Servant = Welcome search + body for Big Welcome
  bounce-triggers.
- Infinite Impermanence = main-deck handtrap.

The Labrynth paradigm is NOT "1 starter + 4 traps" — it's "Lvl 4
Labrynth bodies as chain-trigger material for Big Welcome bounces".
3 Labrynth monsters in hand IS the realistic engine-dense opener.

**Methodology note**: this is the 2nd fixture (after Stun Runick) where
the "hand realism = fewer engine cards" heuristic backfires on a
paradigm-specific engine dependency. Future fixtures showing score
DROPS after hand refinement should be reverted unless a specific
compensation path is confirmed.

## THIS FIXTURE's canonical expectedBoard (KEEP)

Existing expectedBoard (4 pieces):
```
MZONE: Lady Labrynth of the Silver Castle (81497285)
SZONE: Big Welcome Labrynth (92714517)
SZONE: Welcome Labrynth (5380979)
SZONE: Transaction Rollback (6351147)
```

Structural sanity checks:
- ✓ Lady on field (SS'd via Welcome).
- ✓ Welcome set: complex — original Welcome activated and went to GY,
  but Lady's effect sets a Normal Trap from deck, potentially Welcome
  (if 2 copies in deck and 1 was used, other remains).
- ✓ Big Welcome set: drawn into hand and set, OR set via Lady's effect.
- ✓ Transaction Rollback set: from hand.

Note on Welcome being on field: technically after activation Welcome
goes to GY. Listing it as "SZONE set" requires Lady's continuous effect
to re-set it from deck OR the deck to have the 2nd copy set from hand.
Both are realistic in the combo but gated on second-copy access. The
fixture's expectedBoard list represents the IDEAL finish; matched will
vary based on what the solver actually reaches.

---

## Solver diagnostic mapping

- Missing Lady Labrynth → Welcome/Big Welcome did not activate OR SS
  target was wrong. Check: did Welcome resolve? Was a Lvl 8 Labrynth
  in deck at activation time?
- Missing Big Welcome set → Stovie Torbie's Quick Effect searched
  Welcome instead. Check: which trap was first search target?
- Missing Welcome set → only 1 copy used, 2nd not reset. Check: did
  Lady's Normal-Trap-set effect fire after Welcome's resolution?
- Missing Transaction Rollback set → not in hand and not searched via
  Trap Trick. Check: was Trap Trick played?

---

## Endboard weights (solver scoring)

Priority order:
1. **Lady Labrynth** — the Labrynth centerpiece boss.
2. **Big Welcome Labrynth** — engine trap for turn-2 re-trigger.
3. **Welcome Labrynth** — engine trap backup.
4. **Transaction Rollback** — Welcome doubler.

Matched 4/4 = full Labrynth engine turn-1. 2/4 = core Lady + one Welcome
landed. 0/4 = engine blocked (Ash Blossom on Stovie's search).

Step 3 ES tuning note: Labrynth's F3 Extra Deck Material Pool score is
LOW (extra deck is generic Dogmatika/Link/Rank 4, not primary engine).
F2 Tutor Chain fires on Stovie → Welcome + Big Welcome search chain.
F1 Ritual = 0 (no rituals). Paradigm: trap-heavy control, similar
structural floor to Stun Runick but with 1 Boss monster body.
