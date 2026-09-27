# Kashtira Azamina Radiant Typhoon Maliss Combo Reference (2026-04-17)

Canonical combos for solver validation. Specifically targets the Verquin WCQ
Regional Top 8 build: Azamina Kashtira Radiant Typhoon Maliss (Edouard Tan,
2026-04-04). Paired with `solver-validation-decks.json` fixture
`kashtira-azamina-opener`.

Sources:
- Master Duel Meta Kashtira guide (masterduelmeta.com/articles/guides/kashtira-darth)
- ygoprodeck Kashtira combo guides (generic Kashtira 2026 lines)
- Game8 Kashtira / Maliss deck guides
- Yugipedia Kashtira archetype page
- This deck's specific engine mix (inferred from main+extra composition)

**Important**: This is a 4-engine hybrid deck (Kashtira + Maliss + Radiant
Typhoon + Azamina Fusion). It is NOT a pure Kashtira list. Kashtira Arise-Heart
and Shangri-Ira, the standard Kashtira endboard pieces, are absent from the
extra deck. The actual endboard relies on Azamina Ilia Silvia (Fusion) +
Accesscode Talker (Link-4 via 4+ body accumulation) + Rank 7 Dracossack.

---

## Endboard piece cheat sheet

Azamina (the finisher engine in this build):
- **Azamina Ilia Silvia** (Fusion) — the main Azamina boss, omni-negate via
  Sinful Spoils tribute. Fused with "Azamina + LIGHT Fiend" mats. Reached via
  WANTED → Diabellstar → Sinful Spoils of Subversion chain.
- **Azamina Debtors** (main deck trap) — mid-combo board-breaker for Azamina.

Kashtira (engine, not endboard):
- **Kashtira Unicorn** (Level 7) — on-SS: banish opp card, search Kashtira.
- **Kashtira Fenrir** (Level 7) — on-SS: banish opp card, search Kashtira.
- **Pressured Planet Wraitsoth** (field spell) — on activation, search Kashtira.
- **Kashtira Birth** (normal spell) — SS Kashtira from deck.

Maliss (alt engine, uses weird "P/C/Q" categorization):
- **Maliss <P> Dormouse / White Rabbit / Chessy Cat / March Hare** — the
  "<P>" (Practitioner) cards, searchers and setup.
- **Maliss <C> TB-11 / MTP-07** — the "<C>" (Components) in main. These are
  Link-like intermediate bodies.
- **Maliss <Q> Hearts Crypter / Red Ransom** — the "<Q>" (Queen) Extra Deck
  Link bosses, on-Link-summon effects.
- **Maliss in Underground** (spell) — Maliss search.
- **Maliss in the Mirror** (spell) — Maliss reboot/revival.

Radiant Typhoon (secondary engine):
- **Radiant Typhoon Eldam / Swen** (main) — Radiant starters.
- **Radiant Typhoon Krosea** (main) — Radiant trap-body, setup piece.
- **Radiant Typhoon Fonix / Varuroon (Vibrant Vortex)** (main) — Radiant
  finisher monsters (Level 8/10).
- **Radiant Typhoon Varuroon, the Marine Eidolon** (extra) — Radiant Link boss.
- **Radiant Typhoon Mandate** (trap) — Radiant board-ender, face-down.

Generic Link utility:
- **Accesscode Talker** (Link-4) — banish via tribute. Reached via 4-body
  accumulation (Selene → Accesscode path or via Kashtira bodies).
- **S:P Little Knight** (Link-2) — banish + flip-face-down control.
- **Selene, Queen of the Master Magicians** (Link) — spell/monster-counter
  engine, via Magicians' Souls.
- **I:P Masquerena** (Link-2) — end-phase Link summon.
- **Red-Eyes Dark Dragoon** (Fusion via Magicians' Souls) — alt omni-negate
  + burn boss.

---

## Card ID reference (this fixture's available cards)

Main-deck starters:
- `32909498` Kashtira Fenrir (3x) — Kashtira starter
- `68304193` Kashtira Unicorn (3x) — Kashtira starter
- `71832012` Pressured Planet Wraitsoth (1x) — Kashtira search field spell
- `69540484` Kashtira Birth (1x) — Kashtira SS from deck
- `72270339` Diabellstar the Black Witch (3x main + 1x side) — Azamina pivot
- `80845034` WANTED: Seeker of Sinful Spoils (3x) — Sinful Spoils tutor
- `66328392` Deception of the Sinful Spoils (1x) — Sinful Spoils extender
- `20934683` Azamina Debtors (1x) — Azamina trap board-breaker
- `22283204` The Gaze of Timaeus (1x) — Fusion enabler
- `97631303` Magicians' Souls (1x) — draw 2 engine / Fiendsmith fodder

Maliss package:
- `32061192` Maliss <P> Dormouse (1x) — Maliss starter
- `69272449` Maliss <P> White Rabbit (2x) — Maliss extender
- `96676583` Maliss <P> Chessy Cat (3x) — Maliss body
- `20938824` Maliss <P> March Hare (3x) — Maliss body
- `57111661` Maliss <C> TB-11 (1x)
- `94722358` Maliss <C> MTP-07 (1x)
- `68337209` Maliss in Underground (2x) — Maliss search spell
- `93453053` Maliss in the Mirror (1x) — Maliss revival

Radiant Typhoon package:
- `54143349` Radiant Typhoon Eldam (3x)
- `80538047` Radiant Typhoon Swen (3x)
- `16922142` Radiant Typhoon Krosea (1x)
- `85315450` Radiant Typhoon Fonix, the Great Flame (1x)
- `53927851` Radiant Typhoon Varuroon, the Vibrant Vortex (1x)
- `67115133` Radiant Typhoon Chant (3x)
- `20508881` Radiant Typhoon Vision (3x)
- `53813120` Radiant Typhoon Mandate (1x)

Generic:
- `25311006` Triple Tactics Talent (1x) — draw/search under traps
- `83764718` Monster Reborn (1x, alias-normalized)
- `73628505` Terraforming (1x)
- `24224830` Called by the Grave (1x)
- `24299458` Forbidden Droplet (3x)
- `28958464` Spell Card "Monster Reborn" (2x) — Shining Sarcophagus summon target

Extra Deck bosses (this fixture):
- `46396218` Azamina Ilia Silvia — Azamina Fusion boss (MAIN finisher)
- `37818794` Red-Eyes Dark Dragoon — alt Fusion boss
- `59400890` Dark Magician of Destruction — alt Fusion boss
- `86066372` Accesscode Talker — Link-4 finisher
- `22110647` Mecha Phantom Beast Dracossack — Rank 7 Xyz (2x Kashtira Fenrir)
- `29301450` S:P Little Knight
- `65741786` I:P Masquerena
- `45819647` Selene, Queen of the Master Magicians
- `39138610` Allied Code Talker @Ignister
- `21848500` Maliss <Q> Hearts Crypter
- `68059897` Maliss <Q> Red Ransom
- `9763474`  Haggard Lizardose
- `58699500` Cherubini, Ebon Angel of the Burning Abyss
- `50277355` Cross-Sheep
- `39341885` Radiant Typhoon Varuroon, the Marine Eidolon

**Notable absence**: NO Kashtira Arise-Heart, NO Kashtira Shangri-Ira, NO
Kashtiratheosis. This deck does NOT play the traditional Kashtira lockdown
game. Instead it uses Kashtira bodies as banish-searchers feeding Dracossack.

---

## Multi-engine opener (canonical Verquin play pattern)

**Opening hand**: a Verquin-style realistic hand is 3-5 engine cards with minimal
handtraps (this deck has no main-deck handtraps other than Droplet). The
player trusts the engines' density to overcome disruption.

Recommended hand for this fixture:
```
[32909498 Kashtira Fenrir,
 71832012 Pressured Planet Wraitsoth,
 80845034 WANTED: Seeker of Sinful Spoils,
 72270339 Diabellstar the Black Witch,
 97631303 Magicians' Souls]
```

Rationale:
- Kashtira engine primed (Fenrir + Wraitsoth)
- Azamina pivot primed (WANTED + Diabellstar)
- Magicians' Souls for +2 draw ramp / Fiendsmith fodder
- Exactly 5 cards, all engine — no handtraps (realistic for this deck)

---

## Engine combo line

1. **Activate Wraitsoth** (field spell) → search **Kashtira Unicorn** from deck.
2. NS **Kashtira Fenrir** (from hand). Trigger: banish 1 card from opp's
   hand/field/GY → search Kashtira Birth (or 2nd Kashtira if Birth was used).
3. **Activate Kashtira Birth** → SS **Kashtira Unicorn** from deck in DEF.
4. Unicorn on-SS: banish opp card → search a Kashtira card (e.g. another
   Unicorn body or Maliss card via chain).
5. **Activate WANTED** → search **Diabellstar the Black Witch** (if not in hand
   already) + send WANTED to GY as a Spell Card for Shining Sarcophagus trigger.
6. SS **Diabellstar** from hand (by sending a card as Spell from hand to
   face-up SZONE). Diabellstar effect: set a Sinful Spoils from deck to SZONE.
7. Set Sinful Spoils (e.g. Sinful Spoils of Subversion - Snake-Eye) → activate
   on next chain → triggers Azamina Fusion material setup.
8. Fusion via **The Gaze of Timaeus**: fuse Diabellstar + 1 more LIGHT Fiend
   → SS **Azamina Ilia Silvia**. Ilia Silvia has omni-negate.
9. 2x Kashtira Level 7 bodies → XYZ into **Mecha Phantom Beast Dracossack**
   (Rank 7). Dracossack offers +2 token generation + monster-destruction
   protection.
10. Remaining bodies + Selene (from Magicians' Souls) → Link-up to
    **Accesscode Talker** via Haggard Lizardose / Allied Code Talker chain.
11. Set **WANTED** (or a different Sinful Spoils trap) as end-of-turn cover.

**Final endboard**:
- MZONE: Azamina Ilia Silvia (46396218)
- MZONE: Accesscode Talker (86066372)
- MZONE: Mecha Phantom Beast Dracossack (22110647)
- SZONE: WANTED: Seeker of Sinful Spoils (80845034) set

---

## Key SELECT_CARD decisions

1. Wraitsoth search → **Kashtira Unicorn** (NOT Fenrir, to preserve Fenrir
   as an in-hand body).
2. Fenrir on-SS banish search → **Kashtira Birth** (search the normal spell,
   NOT another Kashtira monster).
3. Unicorn on-SS banish search → any other Kashtira Level 7 body (to set up
   Dracossack XYZ) — e.g. Kashtira Unicorn 2nd copy, or a Maliss <C>.
4. WANTED search → **Diabellstar** (NOT Snake-Eye Ash — Snake-Eye is NOT in
   this deck's main).
5. Diabellstar set from deck → **Sinful Spoils of Subversion - Snake-Eye**
   (24081957) — has active triggers for Snake-Eye/Azamina synergy.

---

## Solver diagnostic mapping

- Missing Azamina Ilia Silvia → Fusion did not fire. Check: was The Gaze of
  Timaeus reached? Was there a Diabellstar body + LIGHT Fiend fusion material?
- Missing Accesscode Talker → Link chain didn't reach Link-4. Check: were
  enough bodies accumulated (min 4 effect-monster chain)?
- Missing Dracossack → 2x Level 7 Kashtira bodies not reached. Check: did
  Wraitsoth + Kashtira Birth both fire?
- Missing WANTED set → Sinful Spoils activation cleared WANTED. OK to miss if
  a different Sinful Spoils trap is face-down instead; the specific card ID
  match is what `matched` looks for.

---

## Endboard weights (solver scoring)

Priority order for which pieces matter most:
1. **Azamina Ilia Silvia** — the primary omni-negate, highest scored disruption
2. **Accesscode Talker** — Link-4 finisher, high point total via tribute banish
3. **Dracossack** — Rank 7 token gen + monster negation
4. **WANTED set** — cover trap for Sinful Spoils engine

Matched 4/4 = full Verquin-style endboard. 1-2 matched is realistic given
multi-engine complexity at 400-node budget (combo depth ~40-60+).
