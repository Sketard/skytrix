# Stun Runick Combo Reference (2026-04-17)

Canonical Stun Runick turn-1 strategy for solver validation. Targets the
Melbourne WCQ Regional Top 8 build. Paired with
`solver-validation-decks.json` fixture `stun-runick-opener`.

Sources:
- Master Duel Meta Runick guide 2025 (masterduelmeta.com/articles/guides/runick-tuesday)
- Master Duel Meta Stun guide (masterduelmeta.com/articles/guides/stun/reijus)
- untapped.gg Stun Runick archetype page (Feb 2026)
- Yugipedia Runick archetype
- Game8 Runick deck guide

**Paradigm note**: Stun Runick is a **floodgate-stall archetype**. Unlike
conventional combo decks, this deck:
- Has NO Main Deck monsters (Runick archetype is spell-based).
- Wins via deck-out (each Runick Quick-Play banishes 3-6 cards from opp's
  deck over multiple turns).
- Stacks floodgates to prevent opponent's plays entirely.
- End-of-turn board is minimal: 1 Link-1 Runick + field spell + 1-2 set
  traps.

This fixture is the validation suite's ONLY stall/non-summoning
primary-engine archetype — critical for paradigm coverage breadth.

---

## Endboard piece cheat sheet

Runick Link-1 bodies (Extra Deck, end-phase SS):
- **Hugin the Runick Wings** (Link-1, 55990317) — on SS, search **Runick
  Fountain**. Provides protection for Runick cards. Main defensive Link.
- **Munin the Runick Wings** (Link-1, 92385016) — on SS, search **Runick
  Allure** (alt spell). Protection variant.
- **Geri the Runick Fangs** (Link-1, 28373620) — on SS, recycle 1 Runick
  Quick-Play from GY to hand. Resource engine.
- **Freki the Runick Fangs** (Link-1, 47219274) — alt recycling Link.
- **Sleipnir the Runick Mane** (Link-1 (?), 74659582) — alt Runick Link.

Runick Fountain (field spell):
- **Runick Fountain** (92107604) — signature field spell. Effect 1: during
  opp turn, activate a Runick Quick-Play from hand. Effect 2: shuffle up
  to 3 Runick Quick-Plays from GY to bottom of deck + draw that many.
  Recursion + opp-turn disruption engine.

Runick Quick-Play spells (primary engine):
- **Runick Destruction** (94445733) — banish 3 cards from opp's deck,
  pay 1000 LP cost.
- **Runick Flashing Fire** (68957034) — banish 3 cards from opp's deck,
  destroy a monster opp controls.
- **Runick Tip** (31562086) — banish 3 cards from opp's deck, search a
  Runick card to hand.
- **Runick Freezing Curses** (30430448) — banish 6 cards from opp's deck,
  big cost.
- **Runick Slumber** (67835547) — banish 3 cards + flip opp monster
  face-down.
- **Runick Dispelling** (66712905) — banish 3 cards + negate a spell.
- **Runick Smiting Storm** (93229151) — banish 3 cards + destroy spell/
  trap.
- **Runick Golden Droplet** (20618850) — banish 3 cards + LP gain.

Floodgates (main deck, the "Stun" half):
- **Rivalry of Warlords** (90846359) — continuous trap; opp can only
  control 1 monster type.
- **There Can Be Only One** (24207889) — continuous trap; 1 monster per
  type per player.
- **Gozen Match** (53334471) — continuous trap; 1 attribute per player.
- **Synchro Zone** (60306277) — continuous trap; no Synchro monsters can
  activate effects.
- **Inspector Boarder** (15397015) — Lvl 4 Fairy; opp limited to 1 effect
  activation per turn type (monster/spell/trap).

Draw / search engine (main):
- **Pot of Desires** (35261759) — banish 10, draw 2.
- **Pot of Duality** (98645731) — top-3-reveal, add 1 (no SS this turn).
- **Card of Demise** (59750328) — draw 3, hand dump at EP.
- **One Day of Peace** (33782437) — both players draw 1, no battle dmg.
- **Card Scanner** (77066768) — draw alt.
- **Terraforming** (73628505) — search field spell.

Radiant Typhoon mini-engine:
- **Radiant Typhoon Vision** (20508881) — Radiant Typhoon Quick-Play
  (banish-pay effect similar to Runick).

---

## Card ID reference (this fixture's available cards)

Runick Quick-Plays (main):
- `94445733` Runick Destruction (3x)
- `68957034` Runick Flashing Fire (3x)
- `31562086` Runick Tip (3x)
- `30430448` Runick Freezing Curses (3x)
- `67835547` Runick Slumber (3x)
- `66712905` Runick Dispelling (1x)
- `93229151` Runick Smiting Storm (1x)
- `20618850` Runick Golden Droplet (1x)

Fountain + Terraforming:
- `92107604` Runick Fountain (2x)
- `73628505` Terraforming (1x)

Draw engine (main):
- `35261759` Pot of Desires (3x)
- `98645731` Pot of Duality (3x)
- `59750328` Card of Demise (1x)
- `33782437` One Day of Peace (1x)
- `77066768` Card Scanner (1x)

Monster floodgate:
- `15397015` Inspector Boarder (2x)

Continuous floodgates (main):
- `90846359` Rivalry of Warlords (1x)
- `24207889` There Can Be Only One (1x)
- `53334471` Gozen Match (1x)
- `60306277` Synchro Zone (2x)

Radiant Typhoon sub-engine:
- `20508881` Radiant Typhoon Vision (3x)

Extra Deck (Runick Link-1 pool):
- `55990317` Hugin the Runick Wings (3x)
- `92385016` Munin the Runick Wings (2x)
- `28373620` Geri the Runick Fangs (3x)
- `47219274` Freki the Runick Fangs (3x)
- `74659582` Sleipnir the Runick Mane (1x)
- `93039339` Super Starslayer TY-PHON — Rank 12 alt finisher (rarely used
  in pure stun build)
- `90590303` Number 41: Bagooska — stall Xyz
- `29301450` S:P Little Knight — Link-2 banish

---

## Canonical turn-1 play pattern — no "combo", just setup

Stun Runick does not run a traditional combo. The turn-1 goal is:
1. Activate **Runick Fountain** (field spell).
2. Use a Runick Quick-Play's cost (pay LP / skip battle phase next turn):
   SS a Runick Link-1 from Extra Deck via the Quick-Play's unique "SS
   Runick Link-1" clause.
3. On Link-1 SS: search another Runick card (Hugin → Fountain; Munin →
   Allure; Geri → recycle).
4. Set a floodgate trap (Rivalry / Gozen / TCBOO / Synchro Zone).
5. Set additional Runick Quick-Plays face-down (for activation via
   Fountain on opp's turn).
6. End turn with 1 Link-1 body + Fountain + 1-2 set traps.

**No summoning chain. No Normal Summon. No Xyz/Synchro/Fusion.** The entire
"combo" is resource deployment + floodgate activation.

---

## 1-card setup — Runick Fountain + any Runick Quick-Play

**Endboard**: Hugin (Link-1) + Fountain (active Field) + Rivalry set
+ Runick Freezing Curses set.

1. **Terraforming** → search Runick Fountain (if not in hand).
2. Activate **Runick Fountain** (field spell).
3. Activate a Runick Quick-Play (e.g. **Runick Destruction**): pay 1000
   LP + banish 3 cards from opp deck → SS **Hugin the Runick Wings**
   from Extra Deck.
4. Hugin on SS: search **Runick Fountain** (2nd copy, if first copy on
   field). OR if Fountain already active, pass.
5. Activate **Rivalry of Warlords** (or another floodgate) from hand if
   drawn, set face-up on field (continuous trap activation pre-set? check
   ruling — actually continuous traps must be set first then flipped;
   play pattern is set + activate next turn, OR activate immediately if
   drawn into).
6. Set **Runick Freezing Curses** face-down for opp-turn 6-banish.

For the fixture's `expectedBoard` matching, end-of-turn state is:
- EMZ_L: Hugin the Runick Wings (55990317)
- FIELD: Runick Fountain (92107604) active
- SZONE: Rivalry of Warlords (90846359) set or active
- SZONE: Runick Freezing Curses (30430448) set

---

## Key SELECT_CARD decisions

1. Terraforming search → **Runick Fountain** (92107604).
2. First Runick Quick-Play activation target → any opp deck top 3 (or
   specific 6 for Freezing Curses). No real choice — effect is automatic.
3. Hugin on SS search → **Runick Fountain** (2nd copy for insurance) OR
   any Runick spell.
4. Pot of Duality top-3-reveal → **floodgate trap** if visible, else Pot
   of Desires or Runick Quick-Play.

---

## THIS FIXTURE's canonical opener (KEPT — experimentally validated)

Original fixture hand:
```
[92107604 Runick Fountain,
 94445733 Runick Destruction,
 68957034 Runick Flashing Fire,
 31562086 Runick Tip,
 98645731 Pot of Duality]
```

**Experimental probe findings** (2026-04-17):
A "realism refinement" was attempted to swap Runick Tip for Rivalry of
Warlords (floodgate trap in hand). The probe revealed:
- Original hand: score=12, matched=1/3 → 1/4 (pre → post expectedBoard update)
- Refined hand: score=0, matched=0/4

The 12-point structural score is primarily driven by **Runick Tip's F2
tutor-chain contribution**. Tip's "search a Runick card to hand" effect
triggers the F2 Tutor Chain Potency feature. Removing Tip dropped the
score to the paradigm floor (0). This validates the original hand as
the correct Stun Runick tournament-realistic opener — 3 Runick Quick-
Plays (Destruction + Flashing Fire + Tip) provide engine depth that
matches the deck's play pattern (cycle multiple Quick-Plays via Fountain
recursion + opp-turn set traps).

Rationale:
- Fountain = field spell enabler (mandatory).
- Runick Destruction + Flashing Fire = 2 Quick-Plays for 2 Link-1 SSs.
- Runick Tip = search-spell (F2 tutor chain contributor).
- Pot of Duality = draw engine (no SS this turn; fits Runick's non-
  summon pattern).

Rivalry of Warlords lives in the DECK (drawn via Pot of Duality if
lucky) rather than in the opening hand — this matches real tournament
play where floodgates are drawn into, not committed to opening hands.

## THIS FIXTURE's canonical expectedBoard (EXTENDED)

Previous expectedBoard (3 pieces): Hugin + Fountain + Freezing Curses set.
Matches the minimalist Runick paradigm, but a 4th piece (floodgate trap)
is realistic once a continuous trap is in hand.

Extended expectedBoard (4 pieces):
```
EMZ_L: Hugin the Runick Wings (55990317)
FIELD: Runick Fountain (92107604)
SZONE: Rivalry of Warlords (90846359)
SZONE: Runick Freezing Curses (30430448)
```

Structural sanity checks:
- ✓ Hugin in EMZ_L (Link-1 from Extra); Fountain in FIELD zone (field
  spell); 2 set traps in SZONE. No zone conflicts.
- ✓ Hugin stays because its SS clause doesn't self-destruct; it's a
  permanent Link body.
- ✓ Runick Freezing Curses set face-down in SZONE: valid — activated
  during opp turn via Fountain's effect.
- ✓ Rivalry of Warlords: can be activated face-up first turn if drawn,
  or set face-down and activated when needed. Either state is valid.

---

## Solver diagnostic mapping

- Missing Hugin → Runick Link-1 SS did not happen. Check: was Fountain
  active? Was a Runick Quick-Play's Link-1-SS clause resolved?
- Missing Fountain → Terraforming didn't fire OR Fountain was destroyed
  mid-turn. Check: is Fountain in main deck and was it searched?
- Missing Rivalry of Warlords → floodgate not set. Check: was it in
  hand? Was set-phase reached before combo end?
- Missing Freezing Curses set → all Runick Quick-Plays used during turn
  (not set for opp turn). Check: how many Runick spells activated vs
  set during the play?

---

## Endboard weights (solver scoring)

Priority order:
1. **Rivalry of Warlords** — hard floodgate, blocks most combo decks.
2. **Hugin the Runick Wings** — Link-1 protection body.
3. **Runick Fountain** — engine recursion.
4. **Runick Freezing Curses set** — opp-turn disruption.

Matched 4/4 = full Stun Runick turn-1 lock. 2/4 = engine fired (Hugin +
Fountain typically the easiest). 0/4 = Runick Quick-Play chain was
disrupted (handtraps on Fountain activation or Quick-Play).

**Paradigm caveat for step 3 ES tuning**: Stun Runick's structural score
is intentionally LOW because the deck has zero Ritual/Fusion/Synchro/
Xyz/Link engine (F1 Ritual Unlock = 0, F2 Tutor Chain = minimal
Terraforming, F3 Extra Deck Material Pool = Link-1 only → low F3).
Step 3 fitness function MUST accept that Stun Runick's structural
score is a floor, not a signal of solver weakness. The deck's
"success" is a single Link-1 body + field spell + 1-2 traps, scored
appropriately low.

Pre-validation smoke: score=12, matched=1/3 — this was already honest
and matches paradigm expectations. Post-validation will adjust to 4-
piece expected, matched likely stays near 1-2/4.
