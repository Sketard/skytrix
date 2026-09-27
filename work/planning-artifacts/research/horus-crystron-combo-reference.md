# Horus Crystron Combo Reference (2026-04-17)

Canonical Horus Crystron combos for solver validation. Targets the
Santiago WCQ Regional Top 4 build (Guillermo Enrique Rivera Gonzalez,
2026-03-21). Paired with `solver-validation-decks.json` fixture
`horus-crystron-opener`.

Sources:
- Master Duel Meta Crystron guide (masterduelmeta.com/articles/guides/crystron-dlf2p)
- ygoprodeck Horus Crystron tournament deck page (horus-crystron-702073)
- OTK-Expert Horus Crystron guide (otk-expert.fr/yugioh/decks/horus-crystron-2)
- Duel Links Meta Crystrons guide (duellinksmeta.com/articles/guides/deck-types/crystrons-guide-by-fictinium)
- Master Duel Meta Crystron tier guide

**Paradigm note**: Horus Crystron is a **Synchro-climbing hybrid**. Distinct
from pure combo decks — Crystron engine discards to climb through Synchros
(Link-2 → Synchro Lvl 7/8 → Synchro Lvl 10), while Horus engine provides
large Lvl 8 bodies for Rank 8 Xyz plays. Unique synergy: Crystron Sulfefnir
discards a Crystron from hand to SS itself from deck, which chains into
Horus Sarcophagus → Imsety SS from deck. Most other fixtures do NOT cover
primary-engine synchro climbing, which is why this fixture is valuable for
solver coverage breadth.

---

## Endboard piece cheat sheet

Synchro bosses (Crystron):
- **Crystron Quariongandrax** (Synchro Level 10, 13455674) — THE Crystron
  boss. Banish on activation (Quick Effect): send a card to GY to banish an
  opponent's card. Multi-use disruption.
- **Samurai Destroyer** (Synchro Level 7, 40509732) — Machine Synchro,
  quick-effect negate.
- **F.A. Dawn Dragster** (Synchro, 33158448) — Machine Synchro alt.

Rank 8 Xyz bosses (Horus):
- **Cyber Dragon Infinity** (Rank 8, 10443957) — Cyber Dragon Nova → Infinity
  Rank-up chain. Quick-effect negate (detach material). THE premium Rank 8.
- **Cyber Dragon Nova** (Rank 8, 58069384) — pre-Infinity Rank 8. Usually
  upgraded to Infinity via rebirth.
- **Number 90: Galaxy-Eyes Photon Lord** (Rank 8, 8165596) — alt Rank 8.

Horus engine:
- **Imsety, Glory of Horus** (Level 8 LIGHT Fiend, 84941194) — can SS itself
  from hand if King's Sarcophagus is face-up. On SS: search Horus spell/
  trap. Key Horus body.
- **Hapi, Guidance of Horus** (Level 8 LIGHT Fiend, 47330808) — Horus
  family member, alt Lvl 8 body.
- **King's Sarcophagus** (Continuous Spell, 16528181) — Horus enabler.
  Active face-up: SS a Horus monster from GY OR set a Horus spell from
  deck. Recurring value engine.

Crystron engine (tuner-chain):
- **Crystron Sulfador** (Level 3 Tuner, 25865565) — Crystron Tuner. On
  SS: search Crystron Inclusion.
- **Crystron Sulfefnir** (Level 5 Tuner, 3422200) — Crystron Tuner. Discard
  Crystron → self-SS from hand. Primary 1-card starter.
- **Crystron Smiger** (Level 3 Tuner, 83443619) — mill Crystron.
- **Crystron Tristaros** (Level 5 Tuner, 99471856) — Crystron Tuner body.
- **Crystron Thystvern** (Level 1 Tuner, 29838323) — tiny Tuner.
- **Crystron Citree** (Level 3 Tuner, 20050865) — alt Crystron Tuner.
- **Crystron Inclusion** (spell, 31552317) — Crystron search. Key engine
  spell.
- **Crystron Cluster** (spell, 53829527) — big Crystron board-enabler.

Link bodies:
- **Crystron Eleskeletus** (Link-2, 47736165) — Crystron Link for Synchro
  climb. Usually mid-chain, not terminal.

---

## Card ID reference (this fixture's available cards)

Crystron engine:
- `25865565` Crystron Sulfador (3x)
- `3422200`  Crystron Sulfefnir (3x) — primary starter
- `83443619` Crystron Smiger (3x)
- `99471856` Crystron Tristaros (3x)
- `29838323` Crystron Thystvern (1x)
- `20050865` Crystron Citree (1x)
- `31552317` Crystron Inclusion (3x) — search spell
- `53829527` Crystron Cluster (1x)

Horus engine:
- `84941194` Imsety, Glory of Horus (3x)
- `47330808` Hapi, Guidance of Horus (1x)
- `16528181` King's Sarcophagus (3x)

Handtraps:
- `14558127` Ash Blossom & Joyous Spring (3x)
- `94145021` Droll & Lock Bird (2x)
- `42141493` Mulcharmy Fuwalos (3x)

Utility:
- `81439173` Foolish Burial (1x) — alias-normalized
- `24299458` Forbidden Droplet (3x)
- `10045474` Infinite Impermanence (3x)

Extra Deck:
- `47736165` Crystron Eleskeletus (2x) — Crystron Link-2
- `13455674` Crystron Quariongandrax — Synchro L10 boss
- `40509732` Samurai Destroyer — Synchro L7
- `33158448` F.A. Dawn Dragster (2x) — Synchro
- `97007933` Hi-Speedroid Kendama — Synchro
- `58069384` Cyber Dragon Nova (2x) — Rank 8 pre-Infinity
- `10443957` Cyber Dragon Infinity (2x) — Rank 8 omni-negate
- `8165596`  Number 90: Galaxy-Eyes Photon Lord — Rank 8
- `73082255` The Zombie Vampire — Rank 3
- `41739381` Clockwork Knight — Link/Xyz
- `29301450` S:P Little Knight — Link-2

---

## 1 CARD COMBO — Crystron Sulfefnir → Quariongandrax

**Endboard**: Quariongandrax (MZONE) + Crystron Inclusion active + milled
Crystron cards in GY for turn-2 recursion.

1. Discard 1 Crystron from hand (any) → SS **Crystron Sulfefnir** from
   deck via its own effect.
2. Sulfefnir on-SS: search Crystron Inclusion. Activate Inclusion.
3. Inclusion → SS another Crystron from deck (e.g. Crystron Sulfador —
   Level 3 Tuner).
4. Sulfador on-SS: searches another Crystron. Continue chain.
5. With Sulfefnir (Lvl 5 Tuner) + Sulfador (Lvl 3 Tuner) + another non-
   Tuner → Synchro Level 10 → **Crystron Quariongandrax**.

---

## 2 CARD COMBO — Sulfefnir + Imsety + Sarcophagus → Quariongandrax + Cyber Dragon Infinity + Imsety + Sarcophagus

**Endboard (this fixture's canonical finish)**: Quariongandrax + Infinity
+ Imsety + Sarcophagus active.

1. Activate **King's Sarcophagus** (Continuous Spell) from hand.
2. SS **Imsety, Glory of Horus** from hand via Sarcophagus effect (Imsety's
   self-SS clause: if Sarcophagus is face-up).
3. Imsety on-SS: search Horus spell/trap (another Sarcophagus or Horus
   Monument).
4. Discard a Crystron from hand → SS **Crystron Sulfefnir** from deck.
5. Sulfefnir searches → **Crystron Inclusion** → activate → SS **Crystron
   Sulfador** (Lvl 3 Tuner).
6. Sulfefnir (Lvl 5 Tuner) + Sulfador (Lvl 3 Tuner) + non-Tuner body =
   Synchro Level 10 → **Crystron Quariongandrax**.
7. With Imsety (Lvl 8) + another Lvl 8 Horus body (e.g. Hapi via
   Sarcophagus search then Sarcophagus SS) → Xyz into **Cyber Dragon
   Nova** (Rank 8) → rebirth via Nova effect → **Cyber Dragon Infinity**.
8. Set/activate remaining Crystron Inclusion (if 2nd copy) for turn-2.

**Final endboard**:
- MZONE: Crystron Quariongandrax (13455674)
- MZONE: Cyber Dragon Infinity (10443957)
- MZONE: Imsety, Glory of Horus (84941194)
- SZONE: King's Sarcophagus (16528181) active Continuous Spell

---

## Key SELECT_CARD decisions

1. Sulfefnir self-SS discard → any Crystron in hand (Tristaros is natural
   — it's a Level 5 Tuner alt, synergizes).
2. Crystron Inclusion search → **Crystron Sulfador** (Lvl 3 Tuner, enables
   Quariongandrax synchro).
3. Sulfador search → Crystron Inclusion (2nd copy) OR Crystron Cluster
   (bigger engine turn-2).
4. Imsety search (via Sarcophagus effect) → **King's Sarcophagus** 2nd
   copy OR Horus Monument (deck search).
5. Synchro tuner pairing → Sulfefnir + Sulfador + a non-Tuner of Level 2
   (rare) OR Sulfefnir + Tristaros (both Lvl 5 Tuner; not directly
   synergistic for Lvl 10 Synchro — prefer Sulfador as Lvl 3 Tuner).

---

## THIS FIXTURE's canonical opener (CORRECTED)

Previous hand had Sulfefnir + Sulfador + Imsety + Sarcophagus + Fuwalos.
Both Sulfefnir AND Sulfador in hand is over-loaded — realistic opener
uses only ONE Crystron starter (Sulfefnir alone chains via Inclusion into
Sulfador from deck).

Corrected hand:
```
[3422200  Crystron Sulfefnir,
 84941194 Imsety, Glory of Horus,
 16528181 King's Sarcophagus,
 14558127 Ash Blossom & Joyous Spring,
 42141493 Mulcharmy Fuwalos]
```

Rationale:
- Sulfefnir = Crystron 1-card starter (chains via discard → deck SS).
- Imsety = Horus Lvl 8 body (self-SS via Sarcophagus).
- Sarcophagus = Horus engine enabler.
- Ash + Fuwalos = 2 handtraps (this deck has 3x Ash + 3x Fuwalos + 2x
  Droll in main, ~8 handtraps total).

This is a realistic 2-engine 1+1+1 hand: Crystron 1-card + Horus 2-card
enabler pair + 2 handtraps. Matches tournament play pattern.

## THIS FIXTURE's canonical expectedBoard (CORRECTED)

Previous expectedBoard: Quariongandrax + Imsety + Eleskeletus + Sarcophagus.

Correction: Eleskeletus is the Crystron Link-2 used as mid-chain material
for Quariongandrax synchro (typically tributed as Synchro material or
used for Link-3+ climb). Not a terminal endboard piece. Replace with
Cyber Dragon Infinity (the Rank 8 terminal via Horus Imsety + another
Lvl 8 Xyz chain).

Corrected expectedBoard (4 pieces):
```
MZONE: Crystron Quariongandrax (13455674)
MZONE: Cyber Dragon Infinity (10443957)
MZONE: Imsety, Glory of Horus (84941194)
SZONE: King's Sarcophagus (16528181)
```

Structural sanity checks:
- ✓ Quariongandrax + Imsety: Imsety stays because Crystron synchro chain
  uses tuners + non-tuners (Sulfefnir + Sulfador + X), not Imsety as
  material.
- ✓ Cyber Dragon Infinity requires 2x Lvl 8 Xyz material. Imsety is one;
  second Lvl 8 body (Hapi via Sarcophagus) is the other. After Xyz,
  materials attach → Imsety returns via Sarcophagus effect.
  BUT: having both Infinity AND Imsety on field is unusual — Imsety would
  need to be re-SS'd via Sarcophagus AFTER the Rank 8 Xyz. Flagging this
  as a "may not co-occur" potential issue; if smoke shows structural
  infeasibility, drop Imsety and use Eleskeletus or another piece.
- ✓ King's Sarcophagus: Continuous Spell active face-up, stays SZONE.
- ✓ All pieces in extra + main (no side-deck contamination).

---

## Solver diagnostic mapping

- Missing Quariongandrax → Crystron synchro chain did not complete. Check:
  were tuner + non-tuner Level sums = 10 reached? Did Inclusion fire?
- Missing Infinity → Rank 8 chain missed. Check: was Cyber Dragon Nova
  summoned first? Did Nova's rebirth effect trigger into Infinity?
- Missing Imsety → Horus engine blocked. Check: did Sarcophagus activate?
  Did Imsety's SS-from-hand clause resolve?
- Missing Sarcophagus → Continuous Spell not activated or was destroyed
  mid-combo. Check: any card destruction triggers on turn 1 in the trace?

---

## Endboard weights (solver scoring)

Priority order:
1. **Cyber Dragon Infinity** — Rank 8 omni-negate, premium disruption.
2. **Quariongandrax** — Synchro L10 multi-banish, high pressure.
3. **Imsety** — Horus Lvl 8 body, resource + search engine.
4. **King's Sarcophagus** — Continuous Spell, recursion engine.

Matched 4/4 = full dual-engine finish. 2/4 = one engine fired completely
(either Synchro or Xyz side). 0/4 = both engines blocked (handtrap or
structural gap).

This fixture is the ONLY fixture in the validation suite with a primary
synchro engine — preserve for synchro-archetype coverage in step 3 ES
tuning fitness. Other fixtures cover ritual (Mitsurugi, Nekroz), fusion
(Tearlaments, Branded, Dinomorphia, Kashtira's Azamina), Link toolbox
(Snake-Eye, Spright), banish-setup (Kashtira, Floowandereeze), stall
(Runick), and LP-sacrifice (Dinomorphia). Synchro gap would be notable
without this fixture.
