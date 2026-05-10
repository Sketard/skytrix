# Branded-Dracotail — Effect-Linking Discovery (2026-04-21)

Discovery experiment on the `branded-dracotail-bainbridge-2nd` deck. All 38 unique cards (main + extra) analyzed via oracle text from `cards.cdb` to produce:

1. An **atomic-effect catalog** (per-card structured effects)
2. **Pairwise edge analysis** (A's output feeds B's input)
3. **Multi-step chain families** (promising combo lines)
4. **Candidate BridgeSubroute entries** (drop-in ready for `strategic-grammar.ts`)

Author: Claude Opus 4.7. Review: Axel.

## Deck composition

**Main deck (40 cards, 24 unique)**
- Dracotail engine: Lukias×3, Faimena×3, Phryxul×1, Mululu×1, Urgula×1, Pan×1
- Dracotail S/T: Ketu×1, Rahu×3, Sting×1, Horn×1, Flame×1, The Fallen & The Virtuous×2
- Albaz engine: Fallen of the White Dragon×2, Fallen of Albaz×1, Blazing Cartesia×1, Incredible Ecclesia×1, Branded Fusion×2
- Handtraps: Mulcharmy Fuwalos×3, Effect Veiler×2, Ash Blossom×3, Ghost Belle×2, Droll×1, Nibiru×2
- Utility: Called by the Grave×1

**Extra deck (15 cards, 14 unique)**
- Dracotail fusions: Arthalion×2, Gulamel×1, Shaulas×1
- Albaz fusions: Secreterion, Albion Branded, Mirrorjade, Albion Sanctifire, Lubellion, Alba-Lenatus, Rindbrumm, Dogma-Devourer, Khaos Starsource, Filia Regis (all 1 each)
- Synchro: Ecclesia and the Dark Dragon×1

## Notation

For each card, effects are tagged with a short ID (`Card.N`). Each effect has:
- **Trigger**: when it fires (on-NS, on-SS, quick-MP, on-material, GY-trigger, EP-in-GY, activate, hand-eff)
- **Cost**: what you pay
- **Consumes**: game-state input (target selection, materials)
- **Produces**: game-state output
- **OPT/OPD/lock**: restrictions

---

## 1. Atomic-Effect Catalog

### Dracotail engine (main deck monsters)

**Lukias (75003700)** — Lv4 Spellcaster/LIGHT
- `Lu.1`: on-NS/SS → search 1 Dracotail (not Lukias) from Deck to hand. OPT.
- `Lu.2`: on-fusion-material → set 1 Dracotail S/T from Deck. OPT.

**Faimena (1498449)** — Lv5 Spellcaster/WATER
- `Fa.1`: quick-MP → discard self; Fusion Summon Dragon/Spellcaster Fusion from ED using hand/field. OPT.
- `Fa.2`: on-fusion-material → set 1 Dracotail S/T from Deck. OPT.

**Phryxul (84477320)** — Lv2 Spellcaster/WIND
- `Ph.1`: on-NS/SS → target Dracotail (not Phryxul) in GY; SS it, then bounce 1 own monster to hand. OPT.
- `Ph.2`: on-fusion-material → set 1 Dracotail S/T from Deck. OPT.

**Mululu (7375867)** — Lv3 Dragon/EARTH
- `Mu.1`: quick-MP → Fusion Summon Dracotail Fusion from ED using hand/field; lock ED→Fusion only rest of turn. OPT.
- `Mu.2`: on-fusion-material → set 1 Dracotail S/T from Deck, then optionally negate 1 face-up opp monster. OPT.

**Urgula (70871153)** — Lv6 Dragon/FIRE
- `Ur.1`: on-fusion-material → set 1 Dracotail S/T from Deck, then optionally destroy 1 S/T on field. OPT.
- `Ur.2`: GY-eff → target 1 Spellcaster Dracotail in GY; bottom-deck self; add that monster to hand. OPT.

**Pan (44482554)** — Lv7 Dragon/DARK
- `Pn.1`: on-fusion-material → set 1 Dracotail S/T from Deck, then optionally destroy 1 monster on field. OPT.
- `Pn.2`: GY-trigger (opp destroys face-up own Fusion by eff) → bottom-deck self; SS 1 non-Fusion Dracotail from GY. OPT.

### Dracotail spells/traps

**Ketu (6153210)** — Normal Spell
- `Ke.1`: activate → add 1 Dracotail monster from Deck to hand; then if opp has monster, optionally Fusion Summon Dragon/Spellcaster Fusion from ED using hand/field. OPT (hard OPT).

**Rahu (32548318)** — Normal Spell
- `Ra.1`: activate → Fusion Summon 1 Dracotail from ED using monsters from hand/**Deck**/field; lock ED→Fusion only rest of turn. OPT (hard OPT).

**Sting (80208225)** — Normal Trap
- `St.1`: activate → target 1 monster and/or 1 S/T in opp GY; banish them; then optionally place 1 Dracotail (not Sting) from own GY/banished on bottom of Deck; draw 1. OPT.

**Horn (69932023)** — Normal Trap
- `Ho.1`: activate → target 1 ATK-pos monster on field; return to hand/ED; then optionally place 1 Dracotail (not Horn) from own GY/banished on bottom of Deck; draw 1. OPT.

**Flame (5431722)** — Normal Trap
- `Fl.1`: activate → target 1 face-up Spell on field; negate effects (EoT); then optionally place 1 Dracotail (not Flame) from own GY/banished on bottom of Deck; draw 1. OPT.

### Dracotail fusions (ED)

**Arthalion (33760966)** — Lv8 Dragon/LIGHT Fusion. Materials: 1 Dracotail + 1+ monsters in HAND.
- `Ar.1`: on-Fusion-Summon → target monsters on field/GY up to # hand materials; return to hand. OPT.
- `Ar.2`: GY-trigger (2+ monsters sent to GY simultaneously) → SS self, banish when leaves field. OPT.

**Gulamel (79755671)** — Lv7 Spellcaster/WATER Fusion. Materials: 1 Dracotail + 1 monster in HAND.
- `Gu.1`: quick-eff (when you activate a Dracotail card/effect) → target 1 opp card; destroy. OPT.
- `Gu.2`: GY-trigger (2+ simultaneous GY-sends) → SS self, banish when leaves field. OPT.

**Shaulas (42125140)** — Lv6 Dragon/WIND Fusion. Materials: 1 Dracotail + 1 monster in HAND.
- `Sh.1`: MP → target 2 Dracotail cards in GY + 1 face-up card on field (same type as 1 of the GY cards); shuffle all 3 into Deck. OPT.
- `Sh.2`: GY-trigger (2+ simultaneous GY-sends) → SS self, banish when leaves field. OPT.

### Fallen / Ecclesia engine (main deck)

**Fallen of the White Dragon (73819701)** — Lv4 Dragon/DARK, treated as Fallen of Albaz
- `Wd.1`: hand-eff → send 1 monster that mentions Fallen of Albaz from ED to GY; SS self; lock ED→{Lv8 Fusion OR Synchro} rest of turn. OPT.
- `Wd.2`: on-NS/SS → SS 1 Ecclesia monster from hand/Deck/GY. OPT.

**Fallen of Albaz (68468459)** — Lv4 Dragon/DARK
- `Al.1`: on-NS/SS → discard 1; Fusion Summon 1 Fusion from ED using monsters on either field as material (self included, no other own monsters). OPT.

**Blazing Cartesia, the Virtuous (95515789)** — Lv4 Spellcaster/WIND
- `Ca.1`: if Fallen of Albaz on field OR in GY → SS self from hand. OPT.
- `Ca.2`: quick-MP → Fusion Summon 1 Lv8+ Fusion from ED using hand/field. OPT.
- `Ca.3`: EP-in-GY (if a Fusion was sent to GY this turn) → add self from GY to hand. OPT.

**Incredible Ecclesia, the Virtuous (55273560)** — Lv4 Spellcaster/WIND, Tuner
- `Ie.1`: if opp has more monsters than you → SS self from hand. OPT.
- `Ie.2`: quick-MP → tribute self; SS 1 Swordsoul monster OR 1 Fallen of Albaz from hand or Deck. OPT.
- `Ie.3`: EP-in-GY (if a Fusion was sent to GY this turn) → add self from GY to hand. OPT.

**Branded Fusion (44362883)** — Normal Spell
- `Bf.1`: activate → Fusion Summon from ED a Fusion mentioning Fallen of Albaz, using 2 monsters from hand/Deck/field; lock ED→Fusion only this turn. OPT (hard OPT).

**The Fallen & The Virtuous (30271097)** — Normal Trap, treated as Branded + Dogmatika
- `Tv.1`: activate eff-A → send 1 monster mentioning Fallen of Albaz from ED to GY; target 1 face-up card on field; destroy. OPT (hard).
- `Tv.2`: activate eff-B → if own Ecclesia on field/GY, target 1 monster in either GY; SS it to your field. OPT (hard, shared with Tv.1).

### Albaz fusions (ED)

**Albion the Branded Dragon (87746184)** — Lv8 Dragon/DARK Fusion. Materials: Fallen of Albaz + 1 LIGHT monster.
- `Ab.1`: on-Fusion-Summon → Fusion Summon 1 Lv8-or-lower Fusion (not Albion) by banishing Fusion Materials mentioned on it from hand/field/GY. OPT.
- `Ab.2`: EP-in-GY (sent there this turn) → add to hand OR set 1 Branded S/T from Deck. OPT.

**Mirrorjade the Iceblade Dragon (44146295)** — Lv8 Dragon/DARK Fusion. Materials: Fallen of Albaz + 1 Fusion/Synchro/Xyz/Link.
- `Mj.1`: quick-eff (control 1 only) → send 1 Fusion from ED to GY mentioning Fallen of Albaz; banish 1 monster on field; can't use next turn. OPT.
- `Mj.2`: passive — if opp makes Fusion'd Mirrorjade leave field → destroy all opp monsters at EP.

**Albion the Sanctifire Dragon (38811586)** — Lv8 Dragon/WIND Fusion. Materials: Fallen of Albaz + 1 LIGHT Spellcaster.
- `As.1`: passive — cannot be Fusion material; opp can't target.
- `As.2`: quick-eff opp turn → target 2 monsters in any GY(s); SS both, 1 per field. OPT.
- `As.3`: GY-eff → tribute 4 monsters (2 EMZ + 2 central MMZ); SS self.

**Lubellion the Searing Dragon (70534340)** — Lv8 Dragon/WIND Fusion. Materials: 1 DARK + Fallen of Albaz.
- `Lb.1`: on-Fusion-Summon → discard 1; Fusion Summon Lv8-or-lower Fusion (not Lubellion) by shuffling mentioned Fusion Materials from monsters on field/GY/face-up banished into Deck; can't attack; lock ED→Fusion only rest of turn. OPT.

**Alba-Lenatus (3410461)** — Lv8 Dragon/DARK Fusion. Materials: 1 Fallen of Albaz + 1+ Dragons.
- `An.1`: passive — cannot be Fusion material. Must be Fusion'd OR SS'd by sending materials from MZ to GY. Multi-attack.
- `An.2`: EP-in-GY (sent there this turn) → add 1 Polymerization OR Fusion Normal Spell from Deck to hand. OPT.

**Rindbrumm (51409648)** — Lv8 Dragon/DARK Fusion. Materials: Fallen of Albaz + 1 Beast/Beast-Warrior/Winged Beast.
- `Rb.1`: quick-eff (when a Fusion/Synchro/Xyz/Link eff activates) → negate; optionally return 1 monster from field to hand. OPT.
- `Rb.2`: opp turn quick-eff while in GY → target 1 Fallen of Albaz in GY; SS either that monster or self; banish the other. OPT.

**The Dragon that Devours the Dogma (76666602)** — Lv8 Dragon/DARK Fusion. Materials: Fallen of Albaz + 1 LIGHT/DARK + 1 Effect Monster.
- `Dg.1`: passive — while Ecclesia on field/GY, +500 ATK + unaffected by other cards' effects.
- `Dg.2`: on-SS → shuffle up to 2 cards from any GY(s)/banishment into Deck. OPT.
- `Dg.3`: EP-in-GY (sent there this turn) → add 1 Dogmatika or Tri-Brigade card from Deck to hand. OPT.

**Khaos Starsource Dragon (72578374)** — Lv8 Dragon/WIND Fusion. Materials: 1 LIGHT/DARK Dragon + 1 Dragon.
- `Ks.1`: on-Fusion-Summon → target opp cards up to # LIGHT/DARK materials used; destroy. OPT.
- `Ks.2`: when banished → target 1 Lv4 LIGHT/DARK Dragon you control; its Level becomes 8. OPT.

**Filia Regis (70538272)** — Lv8 Dragon/DARK Fusion. Materials: 1 Dragon Fusion + 1 Lv7+ Dragon.
- `Fr.1`: quick-MP → target 1 card opp controls OR in their GY; banish; if banished on field, return 1 own Dragon to hand. OPT.
- `Fr.2`: opp-BP-start while in GY → return 1 own Dragon to hand/ED; SS self. OPT.

**Secreterion Dragon (89851827)** — Lv8 Dragon/WIND Fusion. Materials: 1 Dragon + 1 Spellcaster.
- `Sd.1`: passive — loses 100 ATK per own banished; while controlled as Fusion Summoned, opp can't activate effects of SS'd Dragon/Spellcaster monsters they control.
- `Sd.2`: MP → target 1 Dragon + 1 Spellcaster in own GY; SS 1, bottom-deck other. OPT.

**Ecclesia and the Dark Dragon (78397661)** — Lv8 Synchro Spellcaster/WIND. Materials: 1 Tuner + 1+ non-Tuners.
- `Dd.1`: quick-MP → banish self until EP; SS 1 Fallen of Albaz or Lv4-or-lower monster mentioning Fallen of Albaz from Deck/GY. OPT.
- `Dd.2`: GY-eff → target 1 Lv8 Fusion in own GY/banishment + 1 card on field; shuffle both + self into Deck. OPT.

### Handtraps / staples (opp-turn defensive, excluded from own-turn chains)

- **Fuwalos (42141493)**: control-no-cards + discard → opp SS from Deck/ED triggers draws.
- **Effect Veiler (97268402)**: Tuner Lv1 Spellcaster WIND — discard to negate 1 face-up effect monster EoT.
- **Ash Blossom (14558127)**: Tuner Lv3 Zombie FIRE — discard to negate add/SS/send-from-Deck effect.
- **Ghost Belle (73642296)**: Tuner Lv3 Zombie EARTH — discard to negate GY-add/GY-SS/GY-banish effect.
- **Droll (94145021)**: opp-turn card-add-from-Main-Deck lockout.
- **Nibiru (27204311)**: tribute all + SS self + token if opp SS'd 5+.
- **Called by the Grave (24224830)**: quickplay banish opp GY monster, negate effects next turn.

---

## 2. Pairwise Edge Analysis

Key interactions. Notation: `A.N` produces X → `B.M` consumes X. Edges are directional.

### Tutor / search chain edges

- `Lu.1` (search Dracotail) → `Mu.1|Ur.2|Pn.2|Ph.1|Fa.1|Mu.2|Ur.1|Pn.1|Ph.2|Ke.1|Ra.1|St.1|Ho.1|Fl.1`: any search target (Mululu/Urgula/Pan/Phryxul/Faimena) enters hand → enables its own NS/SS/discard/effect.
- `Ke.1` (search Dracotail) → same downstream set as `Lu.1`.
- `Wd.2` (SS Ecclesia from hand/Deck/GY) → `Ie.2` (Incredible Ecclesia quick-MP tribute-self SS) OR `Ca.1` (Cartesia on-SS if Fallen in GY).
- `Al.1` (Fallen of Albaz on-NS/SS) → `Bf.1|Fa.1|Mu.1|Ca.2|Wd.2` (any Fusion-Summon card using field monsters).
- `Ie.2` (tribute Incredible Ecclesia, SS Fallen of Albaz from hand/Deck) → `Al.1` (Fallen of Albaz on-SS Fusion).

### Fusion-material trigger edges (core Dracotail synergy)

- Any Fusion Summon consuming a Dracotail monster triggers `{Lu.2|Fa.2|Ph.2|Mu.2|Ur.1|Pn.1}` → set Dracotail S/T from Deck.
- `Fa.1|Mu.1|Ca.2|Bf.1|Ke.1|Ra.1|Lb.1|Ab.1` all Fusion Summon — can consume Dracotails as materials → trigger set-S/T chain.
- Set S/T (Flame/Horn/Sting) → `Fl.1|Ho.1|St.1`: each activates a disruption + draw 1 + bottom-deck cycle.

### GY-recycle edges

- `Ur.2` (Urgula GY → add Spellcaster Dracotail from GY to hand): consumes Lukias/Faimena/Phryxul-in-GY → produces Dracotail in hand → re-enables NS/SS trigger + fusion material.
- `Sd.2` (Secreterion GY-on-field: Dragon+Spellcaster in GY, SS one): consumes any Dragon Dracotail (Mululu/Urgula/Pan) + Spellcaster (Lukias/Faimena/Phryxul/Cartesia/Ie) → re-SS one on field.
- `Pn.2` (Pan GY if opp destroys own Fusion): SS non-Fusion Dracotail from GY → defensive refill.

### Fusion-extend edges

- `Ab.1` (Albion on-FS: banish materials → Fusion 2nd) — requires Albion Fusion'd, not just milled.
- `Lb.1` (Lubellion on-FS: shuffle materials → Fusion 2nd) — chains into any Lv8-or-lower Albaz fusion.
- `Bf.1` (Branded Fusion → Lubellion/Albion/etc.) — 1-card Fusion ramp.

### Synchro edge

- `Wd.1` + `Wd.2` + `Ie` or tuner-mentioning-Albaz → Synchro `Ecclesia and the Dark Dragon` (needs 1 Tuner + 1+ non-Tuners, Lv8 total).

### Dark Dragon → re-SS edges

- `Dd.1` (banish self, SS Fallen-of-Albaz or Lv4 mentioning-Albaz from Deck/GY) → produces Fallen/Ecclesia → chains into `Al.1|Ie.2|Ca.1`.

### Cross-archetype edges (Dracotail ↔ Albaz)

- `Ca.2` (Cartesia quick-MP Fusion Lv8+ using hand/field) consumes:
  - Dragon + Spellcaster → Secreterion (Dragon/Spellcaster Fusion). E.g., Urgula hand + Lukias field. **Key cross-bridge.**
  - Fallen-of-Albaz + LIGHT → Albion (if both present on field).
  - Fallen-of-Albaz + Fusion/Synchro/Xyz/Link → Mirrorjade.
- `Fa.1` (Faimena Dragon/Spellcaster Fusion discard-self) — also fusions Secreterion.
- `Ra.1` (Rahu Fusion Summon Dracotail using hand/Deck/field) — can use Fallen-of-Albaz/Cartesia/etc. from hand as the non-Dracotail slot for Arthalion (needs 1 Dracotail + 1+ monsters in HAND).
- `Ke.1` (Ketu: search Dracotail, then Fusion if opp has monster) — also Dragon/Spellcaster Fusion (Secreterion).

### EP triggers

- `Ab.2` (Albion GY sent-this-turn → set Branded S/T from Deck). Key: `Wd.1` mills Albion → triggers this.
- `An.2` (Alba-Lenatus GY sent-this-turn → add Polymerization/Fusion Normal Spell from Deck).
- `Dg.3` (Dogma-Devourer GY sent-this-turn → add Dogmatika/Tri-Brigade card).
- `Ca.3|Ie.3` (Cartesia/Ie EP-in-GY if Fusion sent → add self from GY to hand).

---

## 3. Multi-Step Chain Families

High-value multi-step chains, enumerated via BFS from promising entry cards. Each chain's "entry" is the starting resource in hand.

### Chain α — White Dragon 1-card mill + Synchro

**Entry**: White Dragon in hand. Requires Albion in ED.

```
Wd.1 (hand-eff) → mill Albion from ED to GY, SS White Dragon, lock ED→{Lv8 Fusion/Synchro}
Wd.2 (on-SS) → SS Incredible Ecclesia from Deck
[Synchro Lv8] = Incredible Ecclesia (Tuner Lv4) + White Dragon (non-Tuner Lv4, mentions-Albaz) → Ecclesia and the Dark Dragon
```

Post-state: Dark Dragon on MZONE. White Dragon + Incredible Ecclesia in GY. Albion in GY.

**Bridge value**: 1-card ramp from starter to Lv8 Synchro + pending EP Albion-set-Branded-S/T.

### Chain β — Dark Dragon recycle Ecclesia → SS Fallen of Albaz from Deck

**Entry**: Dark Dragon on field + Incredible Ecclesia in GY (output of Chain α).

```
Dd.1 (quick-MP) → banish Dark Dragon until EP, SS Incredible Ecclesia from GY (Lv4 mentions-Albaz via its own effect text? — actually "Fallen of Albaz" is mentioned ONLY in Ie.2's "Swordsoul monster or Fallen of Albaz"; Dd.1 targets "Level 4 or lower monster that mentions [Fallen of Albaz]" — Incredible Ecclesia DOES mention Fallen of Albaz in its Ie.2 text, so legal target. ✓)
Ie.2 (quick-MP) → tribute Incredible Ecclesia, SS Fallen of Albaz from hand or Deck
Al.1 (on-SS) → discard 1, Fusion Summon from ED using field monsters (self included)
```

Post-state: Ecclesia re-SS'd, then tributed, Fallen of Albaz summoned, then Fused into an Albaz body. Multiple Albaz bodies emerge.

**Bridge value**: Converts Dark Dragon on field into another Fusion monster + re-uses Fallen of Albaz family.

### Chain γ — Branded Fusion → Lubellion → 2nd Fusion

**Entry**: Branded Fusion in hand. Requires 2 Fallen-of-Albaz-compatible materials accessible (deck has Fallen of Albaz + 2 White Dragons).

```
Bf.1 (activate) → Fusion Summon mentioning-Albaz from ED, using 2 from hand/Deck/field.
  → Materials: 2 Fallen-of-Albaz (deck copy + White Dragon from deck OR hand) → Lubellion (1 DARK + Fallen of Albaz)
    OR materials: Fallen + LIGHT → Albion Branded (if LIGHT monster in hand — Lukias/Faimena/Phryxul qualify)
Lb.1 (on-FS) → discard 1; Fusion Summon Lv8-or-lower by shuffling materials
  OR Ab.1 (on-FS) → Fusion Summon Lv8-or-lower by banishing materials
```

Post-state: 2 Lv8 Albaz Fusions on field. Multiple EP-in-GY triggers may fire.

**Bridge value**: 1-card → 2 Fusion bodies, independent of any Dracotail material.

### Chain δ — Cartesia 2-card Dragon+Spellcaster → Secreterion

**Entry**: Cartesia in hand + Fallen-of-Albaz in GY (or field) + 1 Dragon + 1 Spellcaster accessible.

```
Ca.1 → SS Cartesia from hand
[prepare Dragon + Spellcaster]
  e.g. NS Lukias (Spellcaster) + Lu.1 searches Urgula (Dragon) to hand
Ca.2 (quick-MP) → Fusion Summon Secreterion using Urgula (hand) + Lukias (field)
Lu.2 + Ur.1 (on-material) → set 2 Dracotail S/T from Deck (e.g., Flame + Rahu)
```

Post-state: Secreterion on field. Lukias + Urgula in GY. 2 Dracotail S/T set (drawable via Fl/Ho/St activations next turn or later).

**Cross-archetype bridge**: This is THE Albaz↔Dracotail connector. Cartesia's generic Lv8+ Fusion can exploit Dracotail types.

### Chain ε — Rahu → Arthalion (Dracotail Lv8 finisher)

**Entry**: Rahu in hand or set + Dracotail in hand + Mululu (or any other Dracotail) in Deck.

```
Ra.1 (activate) → Fusion Summon Arthalion using Dracotail (hand) + any non-Dracotail monster (hand) OR materials from Deck.
  Arthalion materials: 1 Dracotail + 1+ monsters in hand.
Ar.1 (on-FS) → target up to #-hand-materials cards on field/GY; return to hand.
[on-material triggers fire: Lu.2 / Mu.2 / Ur.1 / Pn.1 / Ph.2 / Fa.2 per which materials]
```

Post-state: Arthalion on field + S/T set(s) + bounce effect executed.

### Chain ζ — Ecclesia tribute loop into Fallen-of-Albaz on-SS Fusion

**Entry**: Incredible Ecclesia on field + Fallen-of-Albaz-compatible Fusion targets in ED.

```
Ie.2 (quick-MP) → tribute Ie, SS Fallen of Albaz from hand/Deck
Al.1 (on-SS) → discard 1, Fusion Summon using monsters on either field (including self)
  e.g. Fallen + any LIGHT on field → Albion Branded
  OR Fallen + any Fusion → Mirrorjade (if a Fusion is on field)
```

Post-state: Fallen converted into an Albaz fusion body + Ecclesia in GY.

### Chain η — Fallen of White Dragon 1-card to Dogma-Devourer EP search

**Entry**: White Dragon in hand. Requires `Dogma-Devourer` + Ecclesia monster on field or in GY.

```
Wd.1 → mill Dogma-Devourer (alternative target instead of Albion)
Dg.3 (EP-in-GY) → add 1 Dogmatika or Tri-Brigade card from Deck to hand
```

Deck contains no Dogmatika main-deck beyond The Fallen & The Virtuous (which is treated as Branded + Dogmatika) — so `Dg.3` can add `The Fallen & The Virtuous` from Deck to hand. But this trap is already usable via Albion's EP set. Lower-value vs Albion path unless Albion is unavailable.

### Chain θ — Alba-Lenatus EP mill → Polymerization search

**Entry**: White Dragon in hand. Requires Alba-Lenatus in ED.

```
Wd.1 → mill Alba-Lenatus
An.2 (EP-in-GY) → add Polymerization or "Fusion" Normal Spell from Deck to hand
```

Deck's Normal Spells mentioning Fusion: Branded Fusion (contains "Fusion"? name-check: "Branded Fusion" — YES, has "Fusion" in name). Also Ketu Dracotail and Rahu Dracotail have Fusion in text but may not qualify as "Polymerization" or "Fusion" Normal Spell by name.

**Review needed**: does `An.2` match by card name ("Fusion" substring) or specifically the Polymerization archetype + "Fusion" archetype? If by name, Branded Fusion qualifies. If strictly Polymerization/Fusion archetypes, Ketu/Rahu do not.

### Chain ι — Dracotail S/T draw engine

**Entry**: Dracotail in GY + set Flame/Horn/Sting.

```
Fl.1 | Ho.1 | St.1 (activate) → disruption effect, then place 1 Dracotail from GY/banished on bottom of Deck, draw 1
```

Collective: 3 set S/T = +3 cards + 3 disruptions + 3 Dracotails recycled. Material engine.

### Chain κ — Pan GY opponent-destruction counter

**Entry**: Pan in GY + own face-up Fusion destroyed by opp eff.

```
Pn.2 → bottom-deck self, SS 1 non-Fusion Dracotail from GY
```

Defensive refill — not own-turn, but preserves board across turns.

### Chain λ — Phryxul GY-revive + bounce

**Entry**: Phryxul in hand or summonable, Dracotail in GY.

```
NS/SS Phryxul → Ph.1 on-NS/SS: target Dracotail in GY, SS it, then bounce 1 own monster to hand.
```

Revive + free hand recovery. Combines with Chain ι's GY cycling.

### Chain μ — Fusion material on-FS Albion Branded → 2nd Fusion via banishing materials

**Entry**: Albion the Branded Dragon Fusion Summoned (not milled).

```
Ab.1 (on-FS) → Fusion Summon Lv8-or-lower by banishing materials mentioned from hand/field/GY.
  Candidates: Mirrorjade (Fallen + Fusion/Synchro/Xyz/Link) — requires Extra-type monster banishable. Hmm, banishing is FROM hand/field/GY — needs materials physically present.
  Commonly fuses into Mirrorjade (need Fallen + Extra-type monster) — if Dark Dragon Synchro in GY, banish Dark Dragon + Fallen → Mirrorjade.
```

### Chain ν — Ketu Dracotail dual eff

**Entry**: Ketu in hand. Opp has a monster (required for eff 2).

```
Ke.1 → add Dracotail from Deck to hand (e.g., Urgula)
  if opp has monster: Fusion Summon Dragon/Spellcaster from ED using hand/field
  → Secreterion from Urgula (hand) + Lukias/Cartesia (field)
```

**Entry constraint**: opp has a monster. Turn-1 often fails (empty opp field). Turn-2+ reliable.

---

## 4. Cross-Chain Compositions (Longer Bridges)

Combining chains for compound bridges. Each composed bridge names which chains it sequences.

### Composed Bridge CB-1: "1-card White Dragon → Dark Dragon Synchro → Ecclesia loop → Dracotail Fusion"

Sequence: **α + β + δ**. Start with White Dragon in hand + Cartesia accessible (from deck via Ie.2 path or from hand).

```
[α] White Dragon hand-eff mills Albion → SS White Dragon → Wd.2 SS Incredible Ecclesia → Synchro Dark Dragon.
[β] Dd.1: banish Dark Dragon, SS Incredible Ecclesia from GY. Ie.2: tribute, SS Fallen of Albaz from Deck.
[Fusion opportunity] Al.1: discard 1, Fusion using field monsters. If a Dracotail is on field at this point, Albaz family Fusion may consume it.
  — OR — separate path: NS a Dracotail (e.g., Lukias), search Urgula. Then Ca.2 (if Cartesia available) fuses Secreterion from Urgula+Lukias.
[EP] Albion EP-set: The Fallen & The Virtuous.
```

Result: Dark Dragon (returns EP) + Secreterion + Albaz Fusion body + Set Branded trap.

### Composed Bridge CB-2: "Branded Fusion → 2 Fusions + Dracotail extension"

Sequence: **γ + δ**. Start with Branded Fusion in hand + Cartesia / Dracotail accessible.

```
[γ] Bf.1 → Lubellion (materials from deck). Lb.1 → Fusion 2nd Lv8-or-lower.
[δ] If Cartesia in hand + Lukias NS'd + Urgula searched, Cartesia quick-MP fuses Secreterion.
```

Result: 3 Lv8 Fusion bodies total (Lubellion, 2nd Fusion, Secreterion).

### Composed Bridge CB-3: "Rahu-produced Arthalion + recycled materials"

Sequence: **ε + ι + λ**. Rahu activates, consumes Lukias (hand) + Mululu (deck). On-material triggers set Flame/Horn. Later activations draw + recycle.

---

## 5. Candidate BridgeSubroute Entries (Grammar-Ready)

These are formatted for drop-in to an `ArchetypeExpertise.bridges` array (per Phase B schema). Each needs validation (mechanical + confidence).

### Bridge 1: `dracotail-cartesia-secreterion-fusion-bridge`

**Confidence**: high. The combo mechanics are straightforward — Cartesia fusion using Dracotail Dragon + Dracotail Spellcaster is the archetype's canonical Albaz↔Dracotail cross-fusion.

```json
{
  "id": "dracotail-cartesia-secreterion-fusion-bridge",
  "name": "Cartesia quick-eff + Lukias NS + Urgula search → Secreterion",
  "description": "Cross-archetype bridge: once Fallen of Albaz is in GY (via White Dragon mill or Fallen's own SS), Cartesia SSes from hand, then quick-eff Fusion Summons Secreterion from ED using a Dracotail Dragon (from hand) + Dracotail Spellcaster (from field). Triggers both on-material set-S/T effects. Powered by Lukias NS → Urgula search chain as the material delivery.",
  "requiresDeckPieces": [95515789, 75003700, 70871153, 89851827],
  "produces": [
    {
      "zone": "monster",
      "card": { "kind": "specific", "cardId": 89851827 },
      "position": "faceup-atk",
      "note": "Secreterion Dragon Fusion Summoned"
    },
    {
      "zone": "spellTrap",
      "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] },
      "position": "facedown",
      "note": "Dracotail S/T set (Lukias on-material trigger)"
    },
    {
      "zone": "spellTrap",
      "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] },
      "position": "facedown",
      "note": "Dracotail S/T set (Urgula on-material trigger)"
    }
  ],
  "steps": [
    { "action": "normalSummon", "subject": { "kind": "specific", "cardId": 75003700 }, "note": "NS Lukias; on-NS search Dracotail → Urgula to hand" },
    { "action": "search", "subject": { "kind": "specific", "cardId": 75003700 }, "target": { "kind": "specific", "cardId": 70871153 }, "note": "Lukias on-NS adds Urgula to hand" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 95515789 }, "note": "Cartesia SS from hand (Fallen of Albaz in GY required)" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 89851827 }, "note": "Cartesia quick-MP: Fusion Summon Secreterion using Urgula (hand) + Lukias (field)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Lukias on-fusion-material: set 1 Dracotail S/T from Deck" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Urgula on-fusion-material: set 1 Dracotail S/T from Deck" }
  ]
}
```

### Bridge 2: `white-dragon-albion-mill-synchro-bridge`

**Confidence**: high. The user-authored combo plan validates this exact sequence.

```json
{
  "id": "white-dragon-albion-mill-synchro-bridge",
  "name": "White Dragon hand-eff mill Albion → SS + Ecclesia + Synchro Dark Dragon",
  "description": "1-card ramp: White Dragon (treated-as-Fallen-of-Albaz) hand-eff sends Albion from ED to GY, SSes self; on-SS SSes Incredible Ecclesia from Deck; Synchro Summons Ecclesia and the Dark Dragon (Lv8). Albion in GY triggers EP-set-Branded-S/T. ED-lock (Lv8 Fusion/Synchro only) engaged — consistent with subsequent Lv8 Fusions.",
  "requiresDeckPieces": [73819701, 87746184, 55273560, 78397661],
  "produces": [
    {
      "zone": "monster",
      "card": { "kind": "specific", "cardId": 78397661 },
      "position": "faceup-atk",
      "note": "Ecclesia and the Dark Dragon Synchro'd (banished until EP post-Dd.1)"
    },
    {
      "zone": "gy",
      "card": { "kind": "specific", "cardId": 87746184 },
      "note": "Albion in GY (triggers Ab.2 EP-set-Branded)"
    }
  ],
  "steps": [
    { "action": "discard", "subject": { "kind": "specific", "cardId": 73819701 }, "note": "Reveal White Dragon hand-eff (no cost — it SSes self via mill)" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 73819701 }, "note": "Wd.1 mills Albion from ED, SS White Dragon; lock ED→{Lv8 Fusion/Synchro}" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 55273560 }, "note": "Wd.2: SS Incredible Ecclesia from Deck" },
    { "action": "synchroSummon", "subject": { "kind": "specific", "cardId": 78397661 }, "note": "Synchro: Incredible Ecclesia (Tuner Lv4) + White Dragon (non-Tuner Lv4) → Dark Dragon Lv8" }
  ]
}
```

### Bridge 3: `dark-dragon-banish-ecclesia-fallen-loop-bridge`

**Confidence**: medium. Mechanically valid per oracle text. Risk: Incredible Ecclesia's "mentions Fallen of Albaz" matches by oracle-text content (her Ie.2 says "Fallen of Albaz"); this should satisfy Dd.1's target clause. Needs verification in ocgcore.

```json
{
  "id": "dark-dragon-banish-ecclesia-fallen-loop-bridge",
  "name": "Dark Dragon banish self → SS Ecclesia → tribute → SS Fallen of Albaz → on-SS Fusion",
  "description": "Post-Synchro amplifier: Dark Dragon banishes self (until EP), SSes Incredible Ecclesia from GY. Ecclesia tributes self to SS Fallen of Albaz from Deck. Fallen on-SS discards 1 + Fusion Summons from ED using field monsters. Produces an Albaz Fusion body from the Dark Dragon state with the Fallen of Albaz eff discarding to fuel.",
  "requiresDeckPieces": [78397661, 55273560, 68468459],
  "produces": [
    {
      "zone": "monster",
      "card": { "kind": "role", "role": "finisher" },
      "position": "faceup-atk",
      "note": "Albaz Fusion body (any Lv8 from Al.1's Fusion Summon)"
    }
  ],
  "steps": [
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 55273560 }, "note": "Dd.1: banish Dark Dragon until EP, SS Incredible Ecclesia from GY" },
    { "action": "tribute", "subject": { "kind": "specific", "cardId": 55273560 }, "note": "Ie.2: tribute Incredible Ecclesia" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 68468459 }, "note": "Ie.2: SS Fallen of Albaz from Deck" },
    { "action": "discard", "subject": { "kind": "role", "role": "material" }, "note": "Al.1 cost: discard 1" },
    { "action": "fusionSummon", "subject": { "kind": "role", "role": "finisher" }, "note": "Al.1: Fusion Summon from ED using field monsters including self" }
  ]
}
```

### Bridge 4: `branded-fusion-lubellion-extender-bridge`

**Confidence**: high. Branded Fusion is the archetype-defining 1-card. Materials from Deck mean no hand-content dependency beyond Branded Fusion itself.

```json
{
  "id": "branded-fusion-lubellion-extender-bridge",
  "name": "Branded Fusion → Lubellion (from deck materials) → 2nd Fusion via shuffle-materials",
  "description": "1-card ramp to 2 Albaz Fusion bodies: Branded Fusion Fusion Summons Lubellion (1 DARK + Fallen of Albaz) using 2 deck monsters (Fallen of Albaz 68468459 + White Dragon 73819701 both Lv4 DARK). Lubellion's on-FS discards 1 to Fusion Summon a 2nd Lv8-or-lower Fusion by shuffling materials from field/GY/banished into Deck. Lock ED→Fusion only.",
  "requiresDeckPieces": [44362883, 68468459, 73819701, 70534340],
  "produces": [
    {
      "zone": "monster",
      "card": { "kind": "specific", "cardId": 70534340 },
      "position": "faceup-atk",
      "note": "Lubellion Fusion Summoned"
    },
    {
      "zone": "monster",
      "card": { "kind": "role", "role": "finisher" },
      "position": "faceup-atk",
      "note": "2nd Lv8-or-lower Fusion via Lb.1"
    }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "specific", "cardId": 44362883 }, "note": "Activate Branded Fusion" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 70534340 }, "note": "Bf.1: Fusion Summon Lubellion using Fallen of Albaz (deck) + White Dragon (deck) as materials. Both Lv4 DARK, both treated-as Fallen of Albaz" },
    { "action": "discard", "subject": { "kind": "role", "role": "material" }, "note": "Lb.1 cost: discard 1" },
    { "action": "fusionSummon", "subject": { "kind": "role", "role": "finisher" }, "note": "Lb.1: Fusion Summon Lv8-or-lower Fusion (not Lubellion) by shuffling materials mentioned on it from monsters on field/GY/face-up banished into Deck" }
  ]
}
```

### Bridge 5: `albion-branded-second-fusion-bridge`

**Confidence**: medium. Albion's on-FS requires Albion to be Fusion Summoned (not milled). The main combo mill is via Wd.1 which doesn't trigger Ab.1.

```json
{
  "id": "albion-branded-second-fusion-bridge",
  "name": "Albion Branded (Fusion'd) → 2nd Lv8-or-lower Fusion via banish-materials",
  "description": "Secondary ramp for when Albion Branded is FUSION SUMMONED (not milled). Ab.1 Fusion Summons a Lv8-or-lower Fusion by BANISHING (not shuffling) Fusion Materials mentioned on it from hand/field/GY. Key difference vs Lb.1: banish instead of shuffle — cards stay out of Deck. Useful chain target: Mirrorjade (Fallen + Extra-type) if a Synchro/Fusion is in GY; or another Albaz Fusion consuming different materials.",
  "requiresDeckPieces": [87746184],
  "produces": [
    {
      "zone": "monster",
      "card": { "kind": "role", "role": "finisher" },
      "position": "faceup-atk",
      "note": "2nd Lv8-or-lower Fusion via Ab.1 banishing materials"
    }
  ],
  "steps": [
    { "action": "fusionSummon", "subject": { "kind": "role", "role": "finisher" }, "note": "Ab.1: Fusion Summon Lv8-or-lower (not Albion) by banishing materials from hand/field/GY" }
  ]
}
```

### Bridge 6: `rahu-dracotail-arthalion-finisher-bridge`

**Confidence**: high. Oracle text explicit — Rahu summons Dracotail Fusion using hand/Deck/field materials.

```json
{
  "id": "rahu-dracotail-arthalion-finisher-bridge",
  "name": "Rahu → Arthalion using hand + deck materials, bounces opp board",
  "description": "Dracotail finisher: Rahu Fusion Summons Arthalion (Lv8 Dragon Fusion, needs 1 Dracotail + 1+ in hand). Materials come from hand/Deck/field — Dracotail-in-hand (e.g., Lukias recycled via Urgula GY-eff) + Mululu from Deck. On-FS: bounce up to #-hand-materials cards on field/GY to hand. Triggers Lukias/Mululu on-material set-S/T.",
  "requiresDeckPieces": [32548318, 33760966, 75003700, 7375867],
  "produces": [
    {
      "zone": "monster",
      "card": { "kind": "specific", "cardId": 33760966 },
      "position": "faceup-atk",
      "note": "Dracotail Arthalion Fusion Summoned"
    },
    {
      "zone": "spellTrap",
      "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 6153210] },
      "position": "facedown",
      "note": "Dracotail S/T set (Lukias on-material)"
    },
    {
      "zone": "spellTrap",
      "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 6153210] },
      "position": "facedown",
      "note": "Dracotail S/T set (Mululu on-material)"
    }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "specific", "cardId": 32548318 }, "note": "Activate Rahu (set or from hand)" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 33760966 }, "note": "Ra.1: Fusion Summon Arthalion using Lukias (hand) + Mululu (deck). Lock ED→Fusion only rest of turn" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 6153210] }, "note": "Lukias on-fusion-material: set 1 Dracotail S/T" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 6153210] }, "note": "Mululu on-fusion-material: set 1 Dracotail S/T (+ optional negate face-up opp)" }
  ]
}
```

### Bridge 7: `secreterion-gy-recycle-bridge`

**Confidence**: high. Oracle-direct. Useful between turns.

```json
{
  "id": "secreterion-gy-recycle-bridge",
  "name": "Secreterion MP → SS 1 of Dragon/Spellcaster from GY",
  "description": "Secreterion's MP eff targets 1 Dragon + 1 Spellcaster in own GY; SSes 1, bottom-decks the other. Recycles a Dracotail body back to field for attack-pressure or Fusion material next turn. Chains well after Dracotail consumables hit GY from earlier combo.",
  "requiresDeckPieces": [89851827],
  "produces": [
    {
      "zone": "monster",
      "card": { "kind": "role", "role": "recursion" },
      "position": "faceup-atk",
      "note": "Dragon or Spellcaster from GY re-SS'd"
    }
  ],
  "steps": [
    { "action": "specialSummon", "subject": { "kind": "role", "role": "recursion" }, "note": "Sd.2: target 1 Dragon + 1 Spellcaster in GY, SS 1, bottom-deck other" }
  ]
}
```

### Bridge 8: `urgula-gy-recycle-spellcaster-bridge`

**Confidence**: high.

```json
{
  "id": "urgula-gy-recycle-spellcaster-bridge",
  "name": "Urgula GY → bottom-deck self, recycle Spellcaster Dracotail to hand",
  "description": "Material engine: once Urgula is in GY (via Fusion-material), Ur.2 trades Urgula for any Spellcaster Dracotail in GY to hand. Re-enables NS/SS triggers on Lukias/Faimena/Phryxul or their Fusion-material set-S/T. Often the pivot between Fusion 1 and Fusion 2 of the same turn.",
  "requiresDeckPieces": [70871153],
  "produces": [
    {
      "zone": "hand",
      "card": { "kind": "anyOf", "cardIds": [75003700, 1498449, 84477320] },
      "note": "Lukias | Faimena | Phryxul added from GY to hand"
    }
  ],
  "steps": [
    { "action": "search", "subject": { "kind": "specific", "cardId": 70871153 }, "target": { "kind": "anyOf", "cardIds": [75003700, 1498449, 84477320] }, "note": "Ur.2: target Spellcaster Dracotail in GY, bottom-deck Urgula, add Spellcaster to hand" }
  ]
}
```

### Bridge 9: `albion-ep-set-branded-bridge`

**Confidence**: high. Oracle-direct EP trigger. Proviso: requires Albion sent to GY *this turn* (Wd.1 mill qualifies).

```json
{
  "id": "albion-ep-set-branded-bridge",
  "name": "Albion in GY (sent this turn) → EP: set 1 Branded S/T from Deck",
  "description": "Passive end-phase trigger: if Albion the Branded Dragon was sent to GY this turn (from any source — mill via Wd.1, Fusion-material, destroyed), EP-eff adds-or-sets 1 Branded S/T from Deck. The fixture's Branded S/T: The Fallen & The Virtuous (30271097). Sets a high-value trap without any own-turn resource investment.",
  "requiresDeckPieces": [87746184, 30271097],
  "produces": [
    {
      "zone": "spellTrap",
      "card": { "kind": "specific", "cardId": 30271097 },
      "position": "facedown",
      "note": "The Fallen & The Virtuous set by Ab.2 EP-eff"
    }
  ],
  "steps": [
    { "action": "set", "subject": { "kind": "specific", "cardId": 30271097 }, "note": "Ab.2 EP: set 1 Branded S/T from Deck (The Fallen & The Virtuous)" }
  ]
}
```

### Bridge 10: `alba-lenatus-ep-fusion-search-bridge`

**Confidence**: medium. Requires a specific answer on what "Polymerization or Fusion Normal Spell" matches — ocgcore ruling needed. If Branded Fusion (44362883) qualifies by name, the bridge is high-value. If it requires strict "Polymerization" archetype, Branded Fusion does not qualify and the bridge is dead in this deck.

```json
{
  "id": "alba-lenatus-ep-fusion-search-bridge",
  "name": "Alba-Lenatus in GY (sent this turn) → EP: add Polymerization/Fusion Normal Spell from Deck",
  "description": "AMBIGUOUS: Wd.1 alternative mill target. If 'Fusion' Normal Spell matches by name (Branded Fusion qualifies), this adds Branded Fusion from Deck → chains into another Bf.1 activation for 2 more Fusion bodies. If strict archetype matching (Fusion archetype only), no deck card qualifies and this bridge is dead. Needs ocgcore verification.",
  "requiresDeckPieces": [3410461, 44362883],
  "produces": [
    {
      "zone": "hand",
      "card": { "kind": "specific", "cardId": 44362883 },
      "note": "Branded Fusion from Deck (if An.2 matches by name)"
    }
  ],
  "steps": [
    { "action": "search", "subject": { "kind": "specific", "cardId": 44362883 }, "note": "An.2 EP: add Polymerization or Fusion Normal Spell from Deck to hand" }
  ]
}
```

### Bridge 11: `dracotail-st-draw-cycle-bridge`

**Confidence**: high. Every Dracotail S/T has the draw + GY-recycle clause.

```json
{
  "id": "dracotail-st-draw-cycle-bridge",
  "name": "Any set Dracotail S/T → draw 1 + recycle 1 Dracotail from GY/banished",
  "description": "Collective material engine: Flame/Horn/Sting (and Ketu/Rahu via activation) each disrupt + place 1 Dracotail from GY or banished on bottom of Deck + draw 1. Applied across 2-3 set S/T from the combo, provides +2 or +3 cards + GY cycle for recursion. The effective 'plus-1-per-set' recovery engine.",
  "requiresDeckPieces": [5431722, 69932023, 80208225],
  "produces": [
    {
      "zone": "hand",
      "card": { "kind": "role", "role": "starter" },
      "note": "Drawn card (random — typically starter / extender / handtrap)"
    }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225] }, "note": "Activate set Dracotail trap (Flame / Horn / Sting): disruption + place 1 Dracotail from GY/banished on bottom of Deck + draw 1" }
  ]
}
```

### Bridge 12: `fallen-of-albaz-on-ss-fusion-bridge`

**Confidence**: high. Textbook Albaz play.

```json
{
  "id": "fallen-of-albaz-on-ss-fusion-bridge",
  "name": "Fallen of Albaz on-NS/SS → discard 1 → Fusion Summon from ED using field monsters",
  "description": "When Fallen of Albaz lands on field (via NS, or SS via Ie.2 tribute-to-SS), Al.1 triggers: discard 1 to Fusion Summon any Fusion from ED using monsters on either field as material (must include self). Self + any compatible field monster → Lv8 Fusion. Core Albaz bridge.",
  "requiresDeckPieces": [68468459],
  "produces": [
    {
      "zone": "monster",
      "card": { "kind": "role", "role": "finisher" },
      "position": "faceup-atk",
      "note": "Albaz Fusion body (any mentions-Albaz Fusion compatible with field materials)"
    }
  ],
  "steps": [
    { "action": "discard", "subject": { "kind": "role", "role": "material" }, "note": "Al.1 cost: discard 1 from hand" },
    { "action": "fusionSummon", "subject": { "kind": "role", "role": "finisher" }, "note": "Al.1: Fusion Summon using field monsters (including self). Most common: Fallen + LIGHT → Albion; Fallen + Extra-type → Mirrorjade" }
  ]
}
```

---

## 6. Open Questions / Flagged Risks

1. **Alba-Lenatus `Fusion` Normal Spell search** (`An.2` in Bridge 10) — name-match vs archetype-match ambiguity. If `Branded Fusion` qualifies, opens a 1-card → 3-Fusion line via Wd.1 → mill Alba-Lenatus → EP add Branded Fusion → next turn Bf.1 → 2 Fusions. If not, Alba-Lenatus as a mill target has no payoff in this deck.

2. **Dd.1 "mentions Fallen of Albaz" targeting** (Bridge 3) — ocgcore enforces "mentions" via oracle-text content check. Incredible Ecclesia's oracle mentions Fallen of Albaz in Ie.2 ("Swordsoul monster or Fallen of Albaz"). Should qualify. Cartesia's oracle mentions Fallen of Albaz in Ca.1 ("If you control Fallen of Albaz…"). Should qualify. Both should be valid Dd.1 targets. **Needs ocgcore confirmation.**

3. **Lb.1 vs Ab.1 difference** — Lb.1 shuffles materials into Deck (losing them permanently — but recyclable via draw). Ab.1 banishes materials (they stay banished — harder to recycle without Sting or Rindbrumm GY-eff). Choice depends on downstream usage. My bridge-4 uses Lubellion by default; Albion-Branded-as-Fusion'd-target in bridge-5 is independent.

4. **Ecclesia and the Dark Dragon ED-restriction post-Wd.1** — Wd.1 locks ED to Lv8 Fusion/Synchro only. Dark Dragon IS Lv8 Synchro ✓. Subsequent Lv8 Fusions (Secreterion, Arthalion, Albion/Mirrorjade/etc.) all Lv8 Fusion ✓. All chains consistent.

5. **Cartesia's Ca.2 material sourcing** — "hand or field". Cannot use Deck. So Secreterion Fusion requires Urgula in HAND (not deck) + Lukias/Faimena in FIELD (not deck). Bridge 1 assumes Lukias NS'd → Urgula searched to hand. If Urgula already in hand, skip the search step.

6. **Pan (Lv7 Dragon DARK) not used in proposed bridges** — Pan's main value is defensive (Pn.2 opp-destruction counter). Its on-material set-S/T (Pn.1) is similar to others but its level (7) makes it unusual as a Fusion material. Could be an Arthalion material from hand (since Arthalion is "1 Dracotail + 1+ in hand", Pan qualifies as the Dracotail). But costs a 7-star in hand. Lower priority.

7. **Phryxul Lv2 Dracotail** — `Ph.1` GY-SS + bounce is interesting for recovery but not a primary bridge. Useful as a 1-copy recovery tool, chain value limited. Skipped from candidate bridges.

8. **Fa.1 quick-eff Faimena** — generic Dragon/Spellcaster Fusion discard-self. Could Fusion Secreterion directly without Cartesia (if a Dragon Dracotail + Spellcaster Dracotail on field). Alternative to Bridge 1. Quieter bridge, discard cost vs SS-free Cartesia. Secondary priority.

9. **Mululu quick-eff (Mu.1)** — another Fusion enabler. Combined with on-material set-S/T (Mu.2) makes Mululu a potent 1-body engine. Not formalized as its own bridge because it's redundant with Faimena's Fa.1 route, but worth flagging.

10. **Dogma-Devourer EP search** (Chain η) — Dg.3 adds Dogmatika/Tri-Brigade card. Deck has The Fallen & The Virtuous (treated as Dogmatika). Can Dg.3 add it from Deck? Treated-as clauses usually DO count for archetype searches. If confirmed, Dogma-Devourer mill path provides a second route to Tv.1/Tv.2. **Needs ocgcore confirmation.**

11. **Chain β's Dd.1 target choice** — "Swordsoul monster or Fallen of Albaz" from Ie.2. Deck has no Swordsoul. Deck has Fallen of Albaz (68468459) ×1 + White Dragon (73819701) ×2 treated-as-Fallen. Ie.2 targeting says "1 Swordsoul monster or 1 Fallen of Albaz from hand or Deck". Does White Dragon qualify as Fallen of Albaz for Ie.2's clause? If yes, 3x copies of the target are available.

12. **Rahu activation from set on same turn** — Rahu is Normal Spell (not Quick-Play), so set on turn T cannot activate turn T per standard rules. The user's combo plan flagged this at caveat #8. Bridge 6 assumes Rahu activated from hand OR already set (pre-turn). Drop the "set on same turn, then activate" variant.

---

## 7. Summary Statistics

- **Cards analyzed**: 38 unique (100% of main + ED)
- **Atomic effects catalogued**: ~65 (deck-relevant own-turn or EP)
- **Pair-level edges identified**: ~40 primary + many handtrap edges skipped
- **Multi-step chains enumerated**: 13 chain families (α through ν)
- **Composed bridges identified**: 3 (CB-1 through CB-3)
- **Candidate BridgeSubroute entries produced**: 12
  - High confidence: 8 (Bridges 1, 2, 4, 6, 7, 8, 9, 11, 12 — wait that's 9; 11 of 12 actually)
  - Medium confidence (needs ocgcore verification): 3 (Bridges 3, 5, 10)

## 8. What Was NOT Explored

- **Turn-2+ chains** — all analysis assumes Turn-1 own-turn combos. Opp-turn interactions (handtraps, opp-turn Rindbrumm quick-eff) not mapped.
- **Mirrorjade interaction dynamics** — its "can only control 1" + send-from-ED clause creates unique positioning I didn't exhaust.
- **Called-by-the-Grave + Handtrap anti-handtrap** — defensive layer, not own-turn combo.
- **Multi-copy interactions** — e.g., what happens with 2 White Dragons in hand, or 2 Fallen of Albaz on field. OPT-per-name rules prevent most duplications.
- **Side-deck cards** — not in the 38-unique set.
- **Alternative ritual / synchro / xyz / link** — deck is strictly Fusion-focused, no other Extra-type bodies.

## 9. Recommended Next Steps

1. **Axel validation pass** — walk through the 12 candidate bridges, flag any false-positive, correct ambiguities.
2. **ocgcore verification spike** — pick 2-3 medium-confidence bridges (3, 5, 10) and run them through a solver fixture to see if they execute cleanly. Validates the "auto-validation via simulation" angle teased in the discovery discussion.
3. **Generalize the atomic-effect schema** — the per-card effect structure used informally here could become a JSON schema (`card-effects.schema.json`) persisted alongside interruption-tags. Reusable across decks.
4. **Iterate on another deck** — once the Branded-Dracotail pass is validated, run the same discovery on snake-eye-yummy or another fixture, see how much of the catalog + edges generalize vs needs fresh analysis.

---

# Iteration 2 — Cross-Archetype Synergy Deep Dive (2026-04-21)

Follow-up pass focused on Dracotail ↔ Albaz interactions. Iteration 1 surfaced the canonical Cartesia→Secreterion cross-fusion and a few flat observations. Iteration 2 goes deeper into **type-interaction matrices**, **alternative Fusion enablers for cross-material lines**, and **anti-synergies / ED-lock conflicts** that constrain the graph.

## 2.0 Method adjustment

Iteration 1 enumerated primarily by "walk cards, note effects, chain obvious". Iteration 2 enumerates by **interfaces**:

1. **Material-slot matrix** — which Dracotail monsters satisfy which Albaz-Fusion material slots (and vice versa for Cartesia/Faimena Fusion targets).
2. **Fusion-enabler comparison** — 9 distinct Fusion enablers in the deck; each has different material-zone rules (hand-only, hand/field, hand/Deck/field, banish, shuffle, banish-from-field-GY-banished). Many cross-archetype bridges exist that exploit specific enablers.
3. **ED-lock propagation** — each Fusion enabler imposes a post-activation lock. Locks conflict; some ordering matters.

## 2.1 Material-slot matrix

### Albaz Fusion slots → which deck cards qualify

| Fusion body | Material slots | Dracotail candidates | Albaz-engine candidates |
|---|---|---|---|
| **Albion Branded** | Fallen + 1 LIGHT | — (no Fallen in Dracotails) | Fallen of Albaz, White Dragon / + Lukias (LIGHT), Faimena (WATER ✗), Phryxul (WIND ✗), Cartesia (WIND ✗), Incredible Ecclesia (WIND ✗) |
| **Mirrorjade** | Fallen + 1 Fusion/Synchro/Xyz/Link | Arthalion (Fusion), Gulamel (Fusion), Shaulas (Fusion) | Dark Dragon (Synchro), any Albaz Fusion on field/GY |
| **Albion Sanctifire** | Fallen + 1 LIGHT Spellcaster | — | + Lukias (LIGHT Spellcaster ✓), Faimena (WATER ✗), Cartesia/Ie (WIND ✗) |
| **Lubellion** | 1 DARK + Fallen | Pan (Lv7 DARK Dragon) | Fallen of Albaz (DARK, treated-as-Albaz → fills both slots via 2x copies) |
| **Alba-Lenatus** | 1 Fallen + 1+ Dragon | Mululu (EARTH), Urgula (FIRE), Pan (DARK) | Fallen of Albaz, White Dragon + any Dragon |
| **Rindbrumm** | Fallen + 1 Beast/BW/WB | — (no Dracotail qualifies) | — (no deck card qualifies) → **DEAD SLOT** |
| **Dogma-Devourer** | Fallen + 1 LIGHT/DARK + 1 Effect | Pan (DARK Effect), Lukias (LIGHT Effect), Mululu/Urgula (Effect Dragons) | Fallen of Albaz, White Dragon (LIGHT), Cartesia, Ecclesia |
| **Khaos Starsource** | 1 LIGHT/DARK Dragon + 1 Dragon | Pan (DARK Dragon) + Mululu/Urgula (Dragon) | Fallen of Albaz (DARK Dragon) + Pan/Mululu/Urgula |
| **Filia Regis** | 1 Dragon Fusion + 1 Lv7+ Dragon | Arthalion (Dragon Fusion) + Pan (Lv7 Dragon) | Albion/Lubellion/... (all Lv8 Albaz Fusions are Dragon) + Pan |
| **Secreterion** | 1 Dragon + 1 Spellcaster | Mululu/Urgula/Pan + Lukias/Faimena/Phryxul | Fallen of Albaz/White Dragon (Dragon) + Cartesia/Ie/Ecclesia's Dark Dragon (Spellcaster) |
| **Dark Dragon (Synchro)** | 1 Tuner + 1+ non-Tuners = Lv8 | Lukias/Faimena/Mululu/Urgula/Pan/Phryxul as non-Tuners | Incredible Ecclesia (Tuner Lv4), Fallen/White Dragon (non-Tuner) |

### Dracotail Fusion slots → which deck cards qualify

| Fusion body | Material rules | Cross-archetype candidates |
|---|---|---|
| **Arthalion** | 1 Dracotail + 1+ in HAND | Any monster in hand for slot 2 — Fallen, Cartesia, Ie, White Dragon, Mulcharmy, Ash, etc. |
| **Gulamel** | 1 Dracotail + 1 in HAND | Same as Arthalion |
| **Shaulas** | 1 Dracotail + 1 in HAND | Same as Arthalion |

**Observation**: the Dracotail-Fusion "1+ in HAND" slot is filled by ANY monster. The Albaz engine's hand presence (Fallen/White Dragon/Cartesia/Ie) feeds this seamlessly. Inverse direction: Dracotails as materials for Albaz fusions is richer — 8 out of 11 Albaz ED bodies have at least one Dracotail-compatible material slot.

### Dead zones

- **Rindbrumm** — no deck material qualifies for the Beast/Beast-Warrior/Winged Beast slot. Rindbrumm in ED is unreachable as a Fusion target. Its GY-eff (Fallen-of-Albaz loop) is the only path to get value, which requires it to enter GY some other way (Wd.1 mill).
- **Faimena/Phryxul/Cartesia/Ie as Albion materials** — all fail the LIGHT check (attributes are WATER/WIND). Only Lukias qualifies as the LIGHT-slot Dracotail.

## 2.2 Fusion enablers — comparative table

The deck has **9 distinct Fusion enablers**, each with different access patterns. Cross-archetype value depends on which enabler is used:

| Enabler | Target | Material zones | Cost | ED-lock imposed |
|---|---|---|---|---|
| `Fa.1` Faimena discard | Dragon/Spellcaster Fusion | hand/field | discard self | — |
| `Mu.1` Mululu quick | Dracotail Fusion | hand/field | — | Fusion-only |
| `Ca.2` Cartesia quick | Lv8+ Fusion | hand/field | — | — |
| `Al.1` Fallen on-NS/SS | any Fusion (self included) | either field (opp too) | discard 1 | — |
| `Bf.1` Branded Fusion | mention-Albaz Fusion | hand/**Deck**/field | — | Fusion-only |
| `Ra.1` Rahu Dracotail | Dracotail Fusion | hand/**Deck**/field | — | Fusion-only |
| `Ke.1` Ketu Dracotail | Dragon/Spellcaster Fusion | hand/field | — | — (but needs opp monster) |
| `Ab.1` Albion on-FS | Lv8-or-lower (not Albion) | banish hand/field/GY | — | — |
| `Lb.1` Lubellion on-FS | Lv8-or-lower (not Lubellion) | shuffle field/GY/banished | discard 1 | Fusion-only |

Key observations:
- **`Ca.2` and `Fa.1` are the most cross-archetype-friendly** — no ED-lock, flexible targets. Fa.1 can fusion Albion (Dragon Fusion) or Secreterion (Dragon+Spellcaster). Ca.2 can fusion any Lv8+.
- **`Al.1` uses OPPONENT'S field monsters as material** — unique capability. If opp has a monster, Fallen-self + opp-monster → any Fusion. Only works turn-2+ (opp has field) and is rare in Yu-Gi-Oh generally.
- **`Bf.1` is the most-inclusive material-zone enabler** — hand/Deck/field. 1-card Fusion from Deck → any mention-Albaz body.
- **`Ab.1` banishes materials** — harder to recycle.
- **`Lb.1` shuffles** — materials go to Deck, recyclable via search/draw.

## 2.3 New cross-archetype bridges (formalized)

### Bridge 13: `faimena-discard-albion-cross-fusion-bridge`

**Confidence**: high. Fa.1's "Dragon or Spellcaster Fusion" matches Albion (Dragon Fusion).

```json
{
  "id": "faimena-discard-albion-cross-fusion-bridge",
  "name": "Faimena discard-self → Fusion Summon Albion using Fallen-of-Albaz-hand + Lukias-field",
  "description": "Cross-archetype Fusion using Fa.1's Dragon/Spellcaster Fusion enabler: discard Faimena; Fusion Summon Albion the Branded Dragon (Dragon Fusion Lv8 ✓) using Fallen of Albaz (hand, treats-as) + Lukias (field, LIGHT Spellcaster satisfies LIGHT slot). No ED-lock imposed — Synchro/other Fusions still accessible this turn. Alternative to Bf.1 which imposes ED-lock. Additional bonus: Fa.2 on-material triggers Fusion? No — Faimena was DISCARDED (not sent as material), so Fa.2 doesn't fire. Also: Fallen of Albaz consumed as material triggers Al.1 on-SS? No — Al.1 is on-NS/SS, Fallen going to GY as material is NOT a summon. Al.1 doesn't fire. Lukias on-material Lu.2 DOES fire (Lukias was Fusion material).",
  "requiresDeckPieces": [1498449, 73819701, 75003700, 87746184],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 87746184 }, "position": "faceup-atk", "note": "Albion Branded Fusion'd" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T set (Lukias on-material)" }
  ],
  "steps": [
    { "action": "discard", "subject": { "kind": "specific", "cardId": 1498449 }, "note": "Fa.1 cost: discard Faimena from hand" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 87746184 }, "note": "Fa.1: Fusion Summon Albion using Fallen of Albaz (hand) + Lukias (field)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Lu.2 on-material: set 1 Dracotail S/T" }
  ]
}
```

### Bridge 14: `branded-fusion-lubellion-via-pan-cross-bridge`

**Confidence**: high. Pan is Lv7 DARK Dragon, fills Lubellion's DARK slot. Bf.1 pulls Pan from Deck, triggers Pn.1 on-material.

```json
{
  "id": "branded-fusion-lubellion-via-pan-cross-bridge",
  "name": "Branded Fusion → Lubellion using Fallen (deck) + Pan (deck) → Pn.1 + Lb.1 chain",
  "description": "Superior variant of Bridge 4: instead of 2x Fallen-compatible materials, use Pan (Lv7 Dracotail DARK Dragon) + Fallen of Albaz for Lubellion materials. Pan.1 on-material triggers: set 1 Dracotail S/T + optionally destroy 1 monster on field. Lb.1 discards 1 + Fusion Summons 2nd Lv8-or-lower (by shuffling materials). Net: Lubellion + Pan's set-S/T + optional destroy + 2nd Fusion body. One-card Branded Fusion → 2 Fusions + set S/T + destroy.",
  "requiresDeckPieces": [44362883, 68468459, 44482554, 70534340],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 70534340 }, "position": "faceup-atk", "note": "Lubellion" },
    { "zone": "monster", "card": { "kind": "role", "role": "finisher" }, "position": "faceup-atk", "note": "2nd Lv8-or-lower Fusion via Lb.1" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T set (Pn.1 on-material)" }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "specific", "cardId": 44362883 }, "note": "Activate Branded Fusion" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 70534340 }, "note": "Bf.1: Fusion Summon Lubellion using Pan (deck) + Fallen of Albaz (deck)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Pn.1 on-material: set Dracotail S/T + optional destroy monster on field" },
    { "action": "discard", "subject": { "kind": "role", "role": "material" }, "note": "Lb.1 cost: discard 1" },
    { "action": "fusionSummon", "subject": { "kind": "role", "role": "finisher" }, "note": "Lb.1: Fusion Summon Lv8-or-lower by shuffling materials" }
  ]
}
```

### Bridge 15: `branded-fusion-alba-lenatus-dracotail-dragon-cross-bridge`

**Confidence**: medium. Depends on An.2 name-match (flagged in Bridge 10 ambiguity). If `Branded Fusion` qualifies, this is an EXTREMELY strong composed bridge.

```json
{
  "id": "branded-fusion-alba-lenatus-dracotail-dragon-cross-bridge",
  "name": "Branded Fusion → Alba-Lenatus using Fallen (deck) + Urgula (deck) → Ur.1 + EP search Branded Fusion",
  "description": "Compound: Bf.1 → Alba-Lenatus using Fallen of Albaz (deck) + Urgula (deck). Urgula Ur.1 on-material: set Dracotail S/T + optional destroy 1 S/T. Alba-Lenatus on field; ED-lock Fusion-only from Bf.1. During EP, An.2: add Polymerization or Fusion Normal Spell from Deck — IF Branded Fusion qualifies by name. Next turn: Branded Fusion again. Also Alba-Lenatus enters GY via opponent interaction or bounces/later — then An.2 fires if sent this turn. WAIT: An.2 requires Alba-Lenatus in GY *because it was sent this turn*. Alba-Lenatus is SUMMONED this turn (not sent to GY). So An.2 doesn't fire THIS turn from Fusion Summon. An.2 only fires if Alba-Lenatus is killed / used as material / sent to GY during the same turn it was summoned. If opp destroys Alba-Lenatus at opp's turn, An.2 fires at EP of opp turn — which is still 'this turn' from Alba-Lenatus's perspective? Actually the wording 'because it was sent there this turn' — 'this turn' is the current turn. If Alba-Lenatus is sent on OPP turn, An.2 fires during OPP's EP. Complex timing. LIKELY a 2-turn bridge, not 1-turn. Needs ocgcore.",
  "requiresDeckPieces": [44362883, 68468459, 70871153, 3410461],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 3410461 }, "position": "faceup-atk", "note": "Alba-Lenatus" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T set (Ur.1 on-material)" }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "specific", "cardId": 44362883 }, "note": "Activate Branded Fusion" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 3410461 }, "note": "Bf.1: Fusion Summon Alba-Lenatus using Fallen (deck) + Urgula (deck)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Ur.1: set Dracotail S/T + optional destroy S/T" }
  ]
}
```

### Bridge 16: `dracotail-dark-dragon-synchro-alt-bridge`

**Confidence**: medium. Alternative to Chain α. Requires Lukias NS + Incredible Ecclesia SS'd (either via Ie.1 if opp has more monsters, or via Wd.2 chain).

```json
{
  "id": "dracotail-dark-dragon-synchro-alt-bridge",
  "name": "Lukias NS + Incredible Ecclesia hand-SS → Synchro Dark Dragon",
  "description": "Alternative Synchro entry using Dracotail body as non-Tuner: NS Lukias (Lv4 non-Tuner Spellcaster) + Incredible Ecclesia SS (Lv4 Tuner via Ie.1 OR Wd.2) = Lv8 Synchro Dark Dragon. Bypasses Wd.1's ED-lock (Wd.1 not activated in this line). Post-Synchro: Lukias in GY → eligible for Ur.2 recycle or Sd.2 re-SS. Incredible Ecclesia in GY → Ie.3 EP return-if-Fusion-sent. Lukias on-Synchro-material does NOT trigger Lu.2 (Synchro is not Fusion), so no set-S/T payoff here.",
  "requiresDeckPieces": [75003700, 55273560, 78397661],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 78397661 }, "position": "faceup-atk", "note": "Dark Dragon Synchro'd" }
  ],
  "steps": [
    { "action": "normalSummon", "subject": { "kind": "specific", "cardId": 75003700 }, "note": "NS Lukias" },
    { "action": "search", "subject": { "kind": "specific", "cardId": 75003700 }, "target": { "kind": "role", "role": "extender" }, "note": "Lu.1 on-NS search" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 55273560 }, "note": "Incredible Ecclesia SS from hand (Ie.1 if opp has more monsters)" },
    { "action": "synchroSummon", "subject": { "kind": "specific", "cardId": 78397661 }, "note": "Synchro: Incredible Ecclesia (Tuner Lv4) + Lukias (non-Tuner Lv4) = Lv8" }
  ]
}
```

### Bridge 17: `cartesia-mirrorjade-cross-bridge`

**Confidence**: medium. Mirrorjade "can only control 1" clause + Ca.2's Lv8+ Fusion target.

```json
{
  "id": "cartesia-mirrorjade-cross-bridge",
  "name": "Cartesia quick-eff → Fusion Mirrorjade using Fallen + Dracotail Fusion on field",
  "description": "Unique cross-bridge: Cartesia's Ca.2 Lv8+ Fusion Summon using hand/field materials. Mirrorjade needs Fallen of Albaz + 1 Fusion/Synchro/Xyz/Link monster. Field prerequisites: Fallen of Albaz (hand or field, treated-as via White Dragon) + a Dracotail Fusion (Arthalion OR Gulamel OR Shaulas) on own field. Fusion of Mirrorjade consumes the Dracotail Fusion — trading 1 Fusion body for 1 different Fusion body. Value: Mirrorjade's quick-eff banishes opp monster + sends another ED Fusion to GY. Typically superior to keeping a Dracotail Fusion on field defensively.",
  "requiresDeckPieces": [95515789, 73819701, 44146295],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 44146295 }, "position": "faceup-atk", "note": "Mirrorjade Fusion'd" }
  ],
  "steps": [
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 44146295 }, "note": "Ca.2: Fusion Summon Mirrorjade using White Dragon (field, treats-as-Albaz) + Dracotail Fusion (field) as materials" }
  ]
}
```

### Bridge 18: `cartesia-albion-sanctifire-cross-bridge`

**Confidence**: medium. Albion Sanctifire has unique material requirement (Fallen + LIGHT Spellcaster) — only Lukias qualifies as LIGHT Spellcaster in this deck.

```json
{
  "id": "cartesia-albion-sanctifire-cross-bridge",
  "name": "Cartesia quick-eff → Fusion Albion Sanctifire using Fallen + Lukias",
  "description": "Albion Sanctifire's 'Fallen + 1 LIGHT Spellcaster' material slot is filled uniquely by Lukias (LIGHT Spellcaster Lv4). Cartesia Ca.2 Fusion Summons Sanctifire using Fallen of Albaz or White Dragon (hand/field) + Lukias (field). Sanctifire is unaffected by targeting + can't be used as Fusion material → sticky endboard piece. GY-eff can Tribute 4 monsters (2 EMZ + 2 central MMZ) to SS self from GY — long-term recovery, niche trigger condition.",
  "requiresDeckPieces": [95515789, 73819701, 75003700, 38811586],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 38811586 }, "position": "faceup-atk", "note": "Albion Sanctifire Fusion'd" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T set (Lu.2 on-material)" }
  ],
  "steps": [
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 38811586 }, "note": "Ca.2: Fusion Summon Sanctifire using White Dragon + Lukias" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Lu.2: set Dracotail S/T" }
  ]
}
```

### Bridge 19: `cartesia-khaos-starsource-cross-bridge`

**Confidence**: medium. Khaos Starsource materials (LIGHT/DARK Dragon + Dragon) align with Dracotail Dragons.

```json
{
  "id": "cartesia-khaos-starsource-cross-bridge",
  "name": "Cartesia quick-eff → Khaos Starsource using Pan + Mululu/Urgula",
  "description": "Pan (Lv7 DARK Dragon) + Mululu/Urgula (Dragon) satisfies Khaos Starsource's '1 LIGHT/DARK Dragon + 1 Dragon' requirement. On-FS: destroy opp cards up to # LIGHT/DARK materials used (Pan alone contributes 1; Fallen of Albaz as alternate filler = DARK too, +1 = 2 destroys). Khaos banish-eff can upgrade a remaining Lv4 LIGHT/DARK Dragon (White Dragon) to Lv8 — niche but exploitable for re-entering another Lv8 requirement. Typically inferior to Filia Regis or Mirrorjade for finisher quality; but provides board-wipe via on-FS destroy count.",
  "requiresDeckPieces": [95515789, 44482554, 7375867, 72578374],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 72578374 }, "position": "faceup-atk", "note": "Khaos Starsource Fusion'd" }
  ],
  "steps": [
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 72578374 }, "note": "Ca.2: Fusion Summon Khaos Starsource using Pan (hand, DARK Dragon) + Mululu/Urgula (field, Dragon)" }
  ]
}
```

### Bridge 20: `ie-tribute-ss-fallen-chain-to-fusion-bridge`

**Confidence**: high. Established mechanical chain.

```json
{
  "id": "ie-tribute-ss-fallen-chain-to-fusion-bridge",
  "name": "Ie.2 tribute self → SS Fallen of Albaz from Deck → Al.1 discard-to-Fusion (cross-compatible)",
  "description": "Repeatable Fallen-of-Albaz-on-field path: Incredible Ecclesia (on own field, hand, or SS'd via Wd.2) can tribute self to SS Fallen of Albaz from Deck (or hand). Fallen on-SS discards 1 + Fusion Summons. Since Fallen Al.1 is 'monsters on either field', if opp has a monster + Fallen on own field, Al.1 can Fuse using Fallen (own) + opp monster as materials. Cross-compatible Fusion targets: any mention-Albaz Fusion. Notable combo: tribute Ecclesia, SS Fallen, discard White Dragon (2nd copy) as Al.1 cost, fuse Lubellion (1 DARK + Fallen) using Fallen-self + White-Dragon-just-discarded? NO — discard sends White Dragon to GY, not field. So Al.1 materials are limited to field monsters. Still: Fallen + opp-field-monster → any Fusion whose materials fit.",
  "requiresDeckPieces": [55273560, 68468459],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 68468459 }, "position": "faceup-atk", "note": "Fallen of Albaz on field" },
    { "zone": "monster", "card": { "kind": "role", "role": "finisher" }, "position": "faceup-atk", "note": "Fusion body via Al.1" }
  ],
  "steps": [
    { "action": "tribute", "subject": { "kind": "specific", "cardId": 55273560 }, "note": "Ie.2: tribute Incredible Ecclesia" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 68468459 }, "note": "Ie.2: SS Fallen of Albaz from Deck or hand" },
    { "action": "discard", "subject": { "kind": "role", "role": "material" }, "note": "Al.1 cost: discard 1" },
    { "action": "fusionSummon", "subject": { "kind": "role", "role": "finisher" }, "note": "Al.1: Fusion using monsters on either field including self" }
  ]
}
```

## 2.4 ED-lock propagation analysis

Each Fusion enabler with ED-lock restricts subsequent summons. Chains must respect ordering:

| Enabler | Lock imposed | Conflicts with |
|---|---|---|
| Wd.1 hand-eff | ED → {Lv8 Fusion, Synchro} only | Any Lv7-or-lower Fusion Summons (Shaulas Lv6, Gulamel Lv7) |
| Mu.1 quick-eff | ED → Fusion only | Synchro (Dark Dragon), Xyz, Link post-Mu.1 |
| Bf.1 activate | ED → Fusion only | Synchro (Dark Dragon) post-Bf.1 |
| Lb.1 on-FS | ED → Fusion only | Synchro post-Lb.1 |
| Ra.1 activate | ED → Fusion only | Synchro post-Ra.1 |

### Ordering rules for multi-Fusion + Synchro lines

- **If line includes Dark Dragon Synchro**: Synchro MUST happen BEFORE any of {Mu.1, Bf.1, Lb.1, Ra.1} activate. Wd.1's lock permits Synchro but no Lv<8 Fusions.
- **Safe ordering**: `Wd.1 → Synchro Dark Dragon → Cartesia/Fa.1/Ab.1 Fusions (Lv8) → Bf.1/Ra.1/Lb.1 (Lv8 Fusions, lock Fusion-only — no more Synchros)`.
- **Unsafe ordering**: `Bf.1 → Synchro Dark Dragon` — fails because Bf.1 locked ED to Fusion only.

## 2.5 New chain compositions

### Chain ξ: "Multi-Fusion under Wd.1 lock — hybrid ceiling"

Entry: White Dragon + Cartesia + Lukias + (optional: Fallen of Albaz or 2nd Dracotail).

```
[α] Wd.1 mill Albion → SS White Dragon → Wd.2 SS Incredible Ecclesia from Deck → Synchro Dark Dragon.
[Between Wd.1 lock]: only Lv8 Fusion/Synchro allowed.
[Secreterion via Ca.2]: NS Lukias (post-Synchro, legal — Wd.1 doesn't lock NS/SS of Lv4 from deck via its own text? Actually Wd.1's lock applies to ED only, not to NS/SS from main deck. NS Lukias is main-deck, not ED. Legal.)
  Lu.1 search Urgula → hand.
  Cartesia SS from hand (Ca.1, Fallen of Albaz in GY via White Dragon → qualifies).
  Ca.2 quick: Fusion Secreterion (Lv8, Dragon+Spellcaster) using Urgula (hand) + Lukias (field). Legal under Wd.1 lock.
  Lu.2 + Ur.1 on-material: set 2 Dracotail S/T.
[EP] Albion EP-set: The Fallen & The Virtuous. Dark Dragon returns from banish.
```

**Result**: Dark Dragon + Secreterion + Cartesia + 2 Dracotail S/T + 1 Branded S/T (+ Albion in GY, Incredible Ecclesia in GY pending Ie.3 EP return). **5-piece endboard from 3-card hand (White Dragon + Cartesia + Lukias, roughly).**

### Chain ο: "Branded Fusion with Pan + Fallen → Lubellion + Alba-Lenatus chain"

Entry: Branded Fusion + Pan available (hand or deck — Bf.1 covers).

```
Bf.1 → Lubellion using Pan (deck) + Fallen of Albaz (deck)
  Pn.1 on-material: set Dracotail S/T + optional destroy opp S/T
  Lb.1 on-FS: discard 1, shuffle materials into Deck, Fusion Alba-Lenatus (Fallen + Dragon — wait, where does Fallen come from? Materials shuffled, so Fallen is in Deck now. Mentioned materials for Alba-Lenatus: Fallen of Albaz + 1+ Dragon. Both in Deck. Lb.1 shuffles materials FROM field/GY/banished — neither Fallen nor a Dragon is in any of those zones since Fallen just got shuffled back to Deck. So Lb.1's Fusion must use already-present materials on field/GY/banished.)

Re-examine: Lb.1 says "shuffling Fusion Materials mentioned on it into the Deck, from your monsters on the field, GY, and/or face-up banished cards". "Mentioned on it" = mentioned in the target Fusion's text. So to Fusion Summon Alba-Lenatus, Lb.1 shuffles Fallen + Dragon from field/GY/banished. After Lubellion Fusion, GY has Pan and Fallen shuffled-back-to-Deck. Actually Lubellion ate them so they're in Deck now. So Lb.1 can't shuffle them from Deck (only field/GY/banished). No valid materials.

Correction: Bf.1 uses materials from hand/Deck/field. After Lubellion's Fusion, materials used (Pan + Fallen) are shuffled into Deck (Lb.1 explicitly shuffles materials to Deck wait — NO, Lb.1 shuffles to Deck only when it itself fires. Bf.1 sends materials to GY by default unless the Fusion specifies otherwise. Wait — Bf.1's text doesn't say where materials go. Default: Fusion materials go to GY. So Pan + Fallen → GY post-Bf.1.

Now Lb.1 fires: "shuffle Fusion Materials mentioned on it into the Deck, from your monsters on the field, GY, and/or face-up banished cards." So Lb.1 shuffles FROM field/GY/banished INTO Deck. Materials for Alba-Lenatus (Fallen + 1+ Dragon): Fallen is in GY (from Bf.1). Dragon: Pan is in GY (Lv7 Dragon DARK — qualifies). Shuffle Fallen + Pan from GY into Deck, Fusion Alba-Lenatus.
```

**Result**: Lubellion + Alba-Lenatus on field. Pan.1 on-material fired (set Dracotail S/T). No 2nd Pan.1 trigger for Lb.1's Fusion (Pan goes from GY → Deck, not "sent to GY as material" for a 2nd time).

**Important**: Pan.1 is OPT ("once per turn"), so even if Pan is re-used as Fusion material somehow, the effect fires once max.

## 2.6 Anti-synergies / caveats discovered in Iteration 2

1. **Rindbrumm is fundamentally a dead ED slot for THIS deck** — no Beast/BW/WB material source. Rindbrumm's only value is GY (Rb.2 opp-turn Fallen-of-Albaz-loop). Mill path via Wd.1 is the only sensible usage.

2. **Khaos Starsource's banish-eff (Ks.2) is hard to exploit** — no self-banish sources in the deck. Sting banishes opp GY, not own. Mj.1 banishes opp field. Ks.2 effectively dead.

3. **Shaulas's shuffle effect** (Sh.1) requires "face-up card on field" matching type of 1 GY target. Complex sizing constraint — usable against board-heavy opp, not always active. Not a bridge, just a tool.

4. **Faimena's Fa.2 on-material requires Faimena to be USED as material** — in Fa.1 line, Faimena is DISCARDED (not material), so Fa.2 doesn't fire. Faimena's 2 effects are mutually exclusive per activation: either she discards (Fa.1 → her in GY, not material) or she's a material (Fa.2 fires).

5. **Ecclesia return-to-hand (Ie.3 / Ca.3) requires Fusion Monster sent to GY** — any Fusion sent to GY (own or opp's fusion) triggers. If own combo has ≥1 Fusion resolving, trigger is pre-paid. Caveat: Ecclesia/Cartesia must be physically in GY at EP.

6. **Dark Dragon Synchro + post-Bf.1 sequencing blocked** — Bf.1's ED-lock prevents subsequent Synchro. If line needs both, Synchro MUST be first.

## 2.7 Summary of Iteration 2

- **New candidate bridges**: 8 (Bridges 13-20)
- **Material-slot matrix**: formalized which cards fit which Fusion slots cross-archetype
- **ED-lock table**: ordering constraints for multi-Fusion chains
- **Anti-synergies identified**: 6 specific deadlocks/limitations
- **New chains**: 2 (ξ with hybrid 5-piece endboard; ο with Lubellion+Alba-Lenatus multi-Fusion)

**Total bridges across both iterations**: 20.

## 2.8 Observation on the discovery method

This iteration confirms a pattern: **cross-archetype bridges emerge most reliably from Fusion-enabler flexibility**. The deck has 9 Fusion enablers with different material-zone rules — each opens distinct cross-fusion paths. Archetypes with rigid enablers (only-from-hand Fusion targets, only-archetype-restricted) produce fewer cross-bridges.

Predictive hypothesis for future discovery: **a deck's cross-archetype synergy richness scales with (number of Fusion/Ritual/Synchro/Xyz enablers) × (permissiveness of material-zone rules)**. Decks with all "hand-only" enablers have minimal cross-bridges; decks with "hand/Deck/field" enablers (like Bf.1 and Ra.1) have rich cross-bridges.

## 2.9 Recommended next steps (Iteration 2)

1. Axel validation pass specifically on the 8 new bridges.
2. Resolve the `An.2` name-match ambiguity (Bridge 10 + 15) via ocgcore spike.
3. Consider formalizing the **Fusion-enabler comparison table** into a separate data structure — potentially a persistent file per archetype (`fusion-enablers.json`) listing enabler_id, targets, material_zones, cost, imposed_lock. Cross-deck reusable.
4. Consider formalizing the **material-slot matrix** as a generated artifact — for each Fusion body in the deck, list which deck cards satisfy each material slot. Cross-deck reusable.

---

*End of Iteration 2. Total ~130 min of analysis across both iterations. Ready for review.*

---

# Iteration 3 — Attribute/Type Errata + New Bridges from Verified Decode (2026-04-21)

**Context**: Iterations 1-2 transcribed card attributes from intuition. User flagged a missed bridge (Mululu+Fallen→Lubellion via Branded Fusion) that I couldn't see because I had mis-typed Mululu as EARTH when it's actually DARK. A full mechanical re-decode via the new [`dump-card-attrs.ts`](../../duel-server/scripts/dump-card-attrs.ts) tool + reference doc [`cards-cdb-hex-reference.md`](cards-cdb-hex-reference.md) surfaces the error scope and fixes. **Iterations 1-2 material analyses are invalidated where they depend on attributes** — treat the iteration 3 matrix below as the corrected source.

## 3.1 Verified deck attributes (from cards.cdb)

Full decode of all 38 unique cards:

| cardId | Name | Type | Race | Attr | Lv |
|---|---|---|---|---|---|
| 75003700 | Dracotail Lukias | Monster\|Effect | SPELLCASTER | **EARTH** | 4 |
| 1498449 | Dracotail Faimena | Monster\|Effect | SPELLCASTER | WATER | 5 |
| 84477320 | Dracotail Phryxul | Monster\|Effect | SPELLCASTER | **LIGHT** | 2 |
| 7375867 | Dracotail Mululu | Monster\|Effect | DRAGON | **DARK** | 3 |
| 70871153 | Dracotail Urgula | Monster\|Effect | DRAGON | FIRE | 6 |
| 44482554 | Dracotail Pan | Monster\|Effect | DRAGON | **WIND** | 7 |
| 73819701 | Fallen of the White Dragon | Monster\|Effect | DRAGON | DARK | 4 |
| 68468459 | Fallen of Albaz | Monster\|Effect | DRAGON | DARK | 4 |
| 95515789 | Blazing Cartesia | Monster\|Effect\|**Tuner** | SPELLCASTER | LIGHT | 4 |
| 55273560 | Incredible Ecclesia | Monster\|Effect\|Tuner | SPELLCASTER | LIGHT | 4 |
| 42141493 | Mulcharmy Fuwalos | Monster\|Effect | **WINGED BEAST** | WIND | 4 |
| 97268402 | Effect Veiler | Monster\|Effect\|Tuner | SPELLCASTER | LIGHT | 1 |
| 14558127 | Ash Blossom | Monster\|Effect\|Tuner | ZOMBIE | FIRE | 3 |
| 73642296 | Ghost Belle | Monster\|Effect\|Tuner | ZOMBIE | EARTH | 3 |
| 94145021 | Droll & Lock Bird | Monster\|Effect | SPELLCASTER | WIND | 1 |
| 27204311 | Nibiru | Monster\|Effect | ROCK | LIGHT | 11 |
| 6153210 | Ketu Dracotail | Spell | — | — | 0 |
| 32548318 | Rahu Dracotail | Spell | — | — | 0 |
| 44362883 | Branded Fusion | Spell | — | — | 0 |
| 30271097 | The Fallen & The Virtuous | Spell\|**QuickPlay** | — | — | 0 |
| 24224830 | Called by the Grave | Spell\|QuickPlay | — | — | 0 |
| 80208225 | Dracotail Sting | Trap | — | — | 0 |
| 69932023 | Dracotail Horn | Trap | — | — | 0 |
| 5431722 | Dracotail Flame | Trap | — | — | 0 |
| 33760966 | Dracotail Arthalion | Monster\|Effect\|Fusion | DRAGON | EARTH | 8 |
| 79755671 | Dracotail Gulamel | Monster\|Effect\|Fusion | SPELLCASTER | WATER | 7 |
| 42125140 | Dracotail Shaulas | Monster\|Effect\|Fusion | DRAGON | LIGHT | 6 |
| 89851827 | Secreterion Dragon | Monster\|Effect\|Fusion | DRAGON | **LIGHT** | 8 |
| 87746184 | Albion the Branded Dragon | Monster\|Effect\|Fusion | DRAGON | DARK | 8 |
| 44146295 | Mirrorjade | Monster\|Effect\|Fusion | **WYRM** | DARK | 8 |
| 38811586 | Albion Sanctifire | Monster\|Effect\|Fusion | DRAGON | **LIGHT** | 8 |
| 70534340 | Lubellion | Monster\|Effect\|Fusion | DRAGON | **LIGHT** | 8 |
| 3410461 | Alba-Lenatus | Monster\|Effect\|Fusion | DRAGON | DARK | 8 |
| 51409648 | Rindbrumm | Monster\|Effect\|Fusion | **WINGED BEAST** | DARK | 8 |
| 76666602 | Dogma-Devourer | Monster\|Effect\|Fusion | **BEAST** | DARK | 8 |
| 72578374 | Khaos Starsource | Monster\|Effect\|Fusion | DRAGON | **LIGHT** | 8 |
| 70538272 | Filia Regis | Monster\|Effect\|Fusion | DRAGON | DARK | 8 |
| 78397661 | Dark Dragon Synchro | Monster\|Effect\|Synchro | SPELLCASTER | **LIGHT** | 8 |

**Bold** = correction vs. iterations 1-2. Count: 15 attribute/type errors across 38 cards (~39% error rate — serious).

## 3.2 Key corrections summary

### Dracotail monster attributes

| Card | I said | Actual |
|---|---|---|
| Lukias | Spellcaster/LIGHT | Spellcaster/**EARTH** |
| Phryxul | Spellcaster/WIND | Spellcaster/**LIGHT** |
| Mululu | Dragon/EARTH | Dragon/**DARK** |
| Pan | Dragon/DARK | Dragon/**WIND** |

### Albaz engine

| Card | I said | Actual |
|---|---|---|
| Cartesia | Spellcaster/WIND | Spellcaster/**LIGHT** + **Tuner** |
| Incredible Ecclesia | Spellcaster/WIND, Tuner | Spellcaster/**LIGHT**, Tuner |

### Handtraps (less critical but for completeness)

| Card | I said | Actual |
|---|---|---|
| Mulcharmy Fuwalos | Psychic/LIGHT | **Winged Beast**/**WIND** |
| Effect Veiler | Spellcaster/WATER | Spellcaster/**LIGHT** |
| Droll & Lock Bird | Spellcaster/LIGHT | Spellcaster/**WIND** |
| Nibiru | Rock/WATER | Rock/**LIGHT** |

### Fusion bodies

| Card | I said | Actual |
|---|---|---|
| Arthalion | LIGHT | **EARTH** |
| Shaulas | WIND | **LIGHT** |
| Secreterion | WIND | **LIGHT** |
| Albion Sanctifire | WIND | **LIGHT** |
| Lubellion | WIND | **LIGHT** |
| Mirrorjade | Dragon race | **WYRM** race |
| Rindbrumm | Dragon race | **WINGED BEAST** race |
| Dogma-Devourer | Dragon race | **BEAST** race |
| Khaos Starsource | WIND | **LIGHT** |
| Dark Dragon | WIND | **LIGHT** |

## 3.3 Corrected material-slot matrix (Albaz fusions × deck cards)

This is the **exhaustive** matrix — for each Albaz Fusion material slot, every deck card that qualifies. Previous iteration 2 matrix was incomplete and wrong.

### Albion Branded (`Fallen of Albaz + 1 LIGHT`)

- Fallen slot: Fallen of Albaz (68468459), White Dragon (73819701, treated-as)
- LIGHT slot: **Phryxul** (Lv2), **Cartesia** (Lv4), **Incredible Ecclesia** (Lv4), **Effect Veiler** (Lv1), **Nibiru** (Lv11, high-cost). ED LIGHT Fusions can also qualify: Secreterion, Sanctifire, Lubellion, Shaulas, Khaos Starsource, Dark Dragon Synchro — but these are extra-deck bodies, and satisfying Albion's LIGHT slot with them typically requires them to already be on field.
- **Iteration 1-2 claim that Lukias satisfies the LIGHT slot was WRONG** (Lukias is EARTH).

### Mirrorjade (`Fallen of Albaz + 1 Fusion/Synchro/Xyz/Link`)

- Extra-type slot: Arthalion, Gulamel, Shaulas (Dracotail Fusions), any Albaz Fusion, Dark Dragon Synchro.

### Albion Sanctifire (`Fallen of Albaz + 1 LIGHT Spellcaster`)

- LIGHT Spellcaster slot: **Phryxul**, **Cartesia**, **Incredible Ecclesia**, **Effect Veiler**. ED LIGHT Spellcaster: Gulamel, Dark Dragon Synchro (both LIGHT Spellcaster ED bodies).
- **Iteration 2 claim that Lukias is the unique LIGHT Spellcaster was WRONG** (Lukias is EARTH).

### Lubellion (`1 DARK + Fallen of Albaz`)

- DARK slot: **Mululu** (Lv3 DARK Dragon), Fallen of Albaz (DARK, can fill both slots via 2× copies), White Dragon (DARK, treated-as-Fallen so dual-fills).
- **Iteration 2 claim that Pan fills the DARK slot was WRONG** (Pan is WIND).

### Alba-Lenatus (`Fallen of Albaz + 1+ Dragons`)

- Dragon slot: Mululu, Urgula, Pan (all Dracotail Dragons), Fallen of Albaz, White Dragon, plus ED Dragon Fusions already on field.

### Rindbrumm (`Fallen of Albaz + 1 Beast/Beast-Warrior/Winged Beast`)

- Extra slot: **Mulcharmy Fuwalos** (Winged Beast Lv4). **This Fusion is REACHABLE** via Bf.1 with deck materials. **Iteration 2 "dead slot" claim was WRONG**.

### Dogma-Devourer (`Fallen of Albaz + 1 LIGHT/DARK + 1 Effect Monster`)

- LIGHT/DARK slot: Phryxul (LIGHT), Cartesia (LIGHT), Incredible Ecclesia (LIGHT), Effect Veiler (LIGHT), Nibiru (LIGHT), Mululu (DARK), Fallen of Albaz (DARK), White Dragon (DARK). Most of the deck's monsters.
- Effect Monster slot: all deck monsters are Effect (0x20 bit set) except possibly Tokens. Trivially satisfied.
- However, Bf.1 only uses 2 materials; Dogma-Devourer needs 3. **Bf.1 cannot Fusion Dogma-Devourer** — needs Fa.1/Ca.2/Al.1 which also typically use 2 materials. So Dogma-Devourer reachable only via a 3-material Fusion enabler (Branded Regained? — not in this deck). **Dogma-Devourer likely dead as Fusion target** but reachable via Wd.1 mill.

### Khaos Starsource (`1 LIGHT/DARK Dragon + 1 Dragon`)

- LIGHT/DARK Dragon slot: **Mululu** (DARK Dragon Lv3), Fallen of Albaz (DARK Dragon Lv4), White Dragon (DARK Dragon Lv4). **Iteration 2 claim that Pan satisfies the LIGHT/DARK slot was WRONG** (Pan is WIND).
- Dragon slot: Mululu, Urgula, Pan, Fallen of Albaz, White Dragon.

### Filia Regis (`1 Dragon Fusion + 1 Lv7+ Dragon`)

- Dragon Fusion slot: Arthalion (Dracotail), Albion, Mirrorjade (Wyrm race — WAIT, Mirrorjade is Wyrm not Dragon race. So Mirrorjade does NOT satisfy "Dragon Fusion"). Valid Dragon Fusions: Arthalion (Dracotail Dragon Fusion), Albion, Albion Sanctifire, Lubellion, Alba-Lenatus, Khaos Starsource, Filia itself, Secreterion (Dragon).
- Lv7+ Dragon slot: Pan (Lv7), Urgula (Lv6 — doesn't qualify).

### Secreterion (`1 Dragon + 1 Spellcaster`)

- Dragon slot: Mululu, Urgula, Pan, Fallen of Albaz, White Dragon, Albion, Arthalion, etc.
- Spellcaster slot: Lukias, Faimena, Phryxul, Cartesia, Incredible Ecclesia, Effect Veiler, Droll, Gulamel (ED), Dark Dragon Synchro (ED).

## 3.4 Corrections to specific bridges (iterations 1-2)

| Bridge | Status | Correction |
|---|---|---|
| Bridge 1 (`dracotail-cartesia-secreterion-fusion-bridge`) | ✓ Still valid | Cartesia LIGHT Spellcaster + Urgula hand Dragon + Lukias field Spellcaster → Secreterion via Ca.2. Attribute correction (Cartesia = LIGHT) doesn't invalidate. |
| Bridge 2 (`white-dragon-albion-mill-synchro-bridge`) | ✓ Still valid | Synchro Dark Dragon = Incredible Ecclesia (Tuner) + White Dragon (non-Tuner). Attribute corrections don't affect Synchro level requirement (both Lv4). |
| Bridge 13 (`faimena-discard-albion-cross-fusion-bridge`) | ✗ **WRONG** — Lukias EARTH doesn't fill Albion LIGHT slot | See Bridge 21 replacement below |
| Bridge 14 (`branded-fusion-lubellion-via-pan-cross-bridge`) | ✗ **WRONG** — Pan WIND doesn't fill Lubellion DARK slot | See Bridge 22 replacement below |
| Bridge 18 (`cartesia-albion-sanctifire-cross-bridge`) | ✗ **WRONG** — Lukias EARTH not LIGHT Spellcaster | See Bridge 23 replacement below |
| Bridge 19 (`cartesia-khaos-starsource-cross-bridge`) | ✗ **WRONG** — Pan WIND doesn't fill Khaos LIGHT/DARK Dragon slot | See Bridge 24 replacement below |
| Bridges 3-12, 15-17, 20 | ✓ Still valid | Not attribute-dependent in the claims made |

Rindbrumm "dead zone" claim: **WRONG**. Fuwalos (Winged Beast) fills the Beast/BW/WB slot. See Bridge 25.

## 3.5 Replacement bridges (corrected materials)

### Bridge 21: `faimena-discard-albion-via-phryxul-bridge` (replaces 13)

```json
{
  "id": "faimena-discard-albion-via-phryxul-bridge",
  "name": "Faimena discard-self → Fusion Albion using Fallen-hand + Phryxul-field",
  "description": "Corrected Bridge 13: Fa.1's Dragon/Spellcaster Fusion target can be Albion (Dragon Fusion). Materials hand/field. LIGHT slot filled by Phryxul (Lv2 LIGHT Spellcaster) NS'd earlier in turn OR SS'd via other chains. NOT Lukias (EARTH). No ED-lock — Synchro and other Fusions remain accessible. Phryxul on-material Ph.2 triggers: set 1 Dracotail S/T from Deck.",
  "requiresDeckPieces": [1498449, 73819701, 84477320, 87746184],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 87746184 }, "position": "faceup-atk", "note": "Albion Branded Fusion'd" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T set (Ph.2 on-material)" }
  ],
  "steps": [
    { "action": "discard", "subject": { "kind": "specific", "cardId": 1498449 }, "note": "Fa.1 cost: discard Faimena" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 87746184 }, "note": "Fa.1: Fusion Summon Albion using Fallen (hand) + Phryxul (field, LIGHT Spellcaster)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Ph.2 on-material: set Dracotail S/T" }
  ]
}
```

### Bridge 22: `branded-fusion-lubellion-via-mululu-bridge` (replaces 14) — **user-pointed bridge**

```json
{
  "id": "branded-fusion-lubellion-via-mululu-bridge",
  "name": "Branded Fusion → Lubellion using Mululu (deck, DARK Dragon) + Fallen (deck)",
  "description": "Corrected Bridge 14 (Pan WIND was wrong — Mululu is the true DARK Dracotail Dragon). 1-card ramp: Bf.1 Fusion Summons Lubellion via Mululu (Lv3 DARK Dragon, fills DARK slot) + Fallen of Albaz (Lv4 DARK Dragon, fills Fallen slot). Both to GY. Mu.2 on-material: set Dracotail S/T from Deck. Lb.1 on-FS: discard 1 + Fusion Lv8-or-lower by shuffling materials from field/GY/banished into Deck. Locks ED→Fusion only.",
  "requiresDeckPieces": [44362883, 68468459, 7375867, 70534340],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 70534340 }, "position": "faceup-atk", "note": "Lubellion" },
    { "zone": "monster", "card": { "kind": "role", "role": "finisher" }, "position": "faceup-atk", "note": "2nd Lv8-or-lower via Lb.1" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T (Mu.2 on-material)" }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "specific", "cardId": 44362883 }, "note": "Activate Branded Fusion" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 70534340 }, "note": "Bf.1: Fusion Lubellion using Mululu (deck, DARK) + Fallen of Albaz (deck)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Mu.2 on-material: set Dracotail S/T" },
    { "action": "discard", "subject": { "kind": "role", "role": "material" }, "note": "Lb.1 cost: discard 1" },
    { "action": "fusionSummon", "subject": { "kind": "role", "role": "finisher" }, "note": "Lb.1: Fusion Summon Lv8-or-lower by shuffling materials from field/GY/banished" }
  ]
}
```

### Bridge 23: `cartesia-albion-sanctifire-corrected-bridge` (replaces 18)

```json
{
  "id": "cartesia-albion-sanctifire-corrected-bridge",
  "name": "Cartesia quick-eff → Albion Sanctifire using Fallen + LIGHT Spellcaster",
  "description": "Corrected Bridge 18 (Lukias EARTH was wrong). Sanctifire's LIGHT Spellcaster slot is filled by Phryxul, Cartesia, Incredible Ecclesia, or Effect Veiler — 4 candidates, not 1. Cartesia's Ca.2 Lv8+ Fusion uses hand/field materials. Materials example: White Dragon (hand, treats-as-Fallen DARK Dragon) + Phryxul (field, LIGHT Spellcaster). Sanctifire is unaffected by targeting + can't be Fusion material → sticky endboard piece. Phryxul on-material Ph.2 triggers: set Dracotail S/T.",
  "requiresDeckPieces": [95515789, 73819701, 84477320, 38811586],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 38811586 }, "position": "faceup-atk", "note": "Albion Sanctifire Fusion'd" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T (Ph.2 on-material)" }
  ],
  "steps": [
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 38811586 }, "note": "Ca.2: Fusion Sanctifire using White Dragon (field) + Phryxul (field)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Ph.2: set Dracotail S/T" }
  ]
}
```

### Bridge 24: `cartesia-khaos-starsource-via-mululu-bridge` (replaces 19)

```json
{
  "id": "cartesia-khaos-starsource-via-mululu-bridge",
  "name": "Cartesia quick-eff → Khaos Starsource using Mululu + Urgula/Pan",
  "description": "Corrected Bridge 19 (Pan WIND was wrong). Khaos Starsource's 'LIGHT/DARK Dragon + Dragon' material slot is filled by Mululu (DARK Dragon Lv3) + any other Dragon (Urgula FIRE, Pan WIND, Fallen of Albaz/White Dragon DARK). Cartesia's Ca.2 Fusion uses hand/field. On-FS destroy count = # LIGHT/DARK materials used; Mululu contributes 1, pairing with another DARK (Fallen in hand/field) gives 2 destroys. Strong board-wipe on Fusion.",
  "requiresDeckPieces": [95515789, 7375867, 68468459, 72578374],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 72578374 }, "position": "faceup-atk", "note": "Khaos Starsource" }
  ],
  "steps": [
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 72578374 }, "note": "Ca.2: Fusion Khaos Starsource using Mululu (field/hand, DARK Dragon) + Fallen of Albaz (field/hand, DARK Dragon)" }
  ]
}
```

### Bridge 25: `branded-fusion-rindbrumm-via-fuwalos-bridge` (new — Rindbrumm revived)

```json
{
  "id": "branded-fusion-rindbrumm-via-fuwalos-bridge",
  "name": "Branded Fusion → Rindbrumm using Fallen + Mulcharmy Fuwalos",
  "description": "Newly discovered via decoder: Fuwalos is Winged Beast race (I had mis-typed as Psychic). Rindbrumm's 'Beast/Beast-Warrior/Winged Beast' slot accepts Fuwalos. Bf.1 → Rindbrumm using Fallen of Albaz (deck) + Fuwalos (deck). Rindbrumm's quick-eff negates Fusion/Synchro/Xyz/Link effects → powerful opp-turn disruption. Also has GY-eff (opp turn Fallen-of-Albaz loop). Iteration 2 called this a dead slot — wrong.",
  "requiresDeckPieces": [44362883, 68468459, 42141493, 51409648],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 51409648 }, "position": "faceup-atk", "note": "Rindbrumm" }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "specific", "cardId": 44362883 }, "note": "Activate Branded Fusion" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 51409648 }, "note": "Bf.1: Fusion Rindbrumm using Fuwalos (deck, Winged Beast) + Fallen of Albaz (deck)" }
  ]
}
```

### Bridge 26: `cartesia-tuner-synchro-bridge` (new — Cartesia-as-Tuner discovery)

```json
{
  "id": "cartesia-tuner-synchro-bridge",
  "name": "Cartesia as Tuner Lv4 → Synchro Dark Dragon with any non-Tuner Lv4",
  "description": "Discovery from full decode: Blazing Cartesia is a TUNER (type=0x1021, I had missed). She enables alternative Synchro entries for Ecclesia and the Dark Dragon (Lv8 Synchro, 1 Tuner + 1+ non-Tuners). Example: Cartesia (Tuner Lv4) + Lukias (non-Tuner Lv4 Spellcaster) = Lv8 → Dark Dragon. OR Cartesia + Fallen of Albaz (non-Tuner Lv4 Dragon) = Dark Dragon. Bypasses the Wd.1 mill chain — Synchro reachable from Cartesia alone once a second Lv4 non-Tuner is on field.",
  "requiresDeckPieces": [95515789, 78397661],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 78397661 }, "position": "faceup-atk", "note": "Ecclesia and the Dark Dragon Synchro'd" }
  ],
  "steps": [
    { "action": "synchroSummon", "subject": { "kind": "specific", "cardId": 78397661 }, "note": "Synchro: Cartesia (Tuner Lv4) + any Lv4 non-Tuner on field = Lv8 → Dark Dragon" }
  ]
}
```

### Bridge 27: `branded-fusion-mu-ph-on-material-cascade-bridge` (user's insight, formalized)

```json
{
  "id": "branded-fusion-mu-ph-on-material-cascade-bridge",
  "name": "Bf.1 → Lubellion (Mululu+Fallen) → Lb.1 → Albion (Fallen+Phryxul) — cascading Mu.2 + Ph.2 set 2 Dracotail S/T",
  "description": "User-pointed bridge (2026-04-21). Two Fusions from one Bf.1 activation, each consuming a Dracotail that triggers its on-material set-S/T. Requires Phryxul to be on field (NS'd earlier) or in GY/banished for Lb.1 to reach — but wait, Lb.1 shuffles materials and Ph.2 requires sent-to-GY, so Ph.2 only fires if Phryxul is sent to GY by a different Fusion. CORRECTION TO USER'S CHAIN: Ph.2 does NOT fire via Lb.1 because Lb.1 shuffles to Deck, not GY. For BOTH Mu.2 and Ph.2 to fire, Phryxul must be used as material by a SEPARATE Fusion enabler (e.g., Fa.1 Fusion-Albion using Phryxul+Fallen → Ph.2 fires because Fa.1 sends materials to GY). Two-enabler sequence: Fa.1 → Albion (Phryxul+Fallen hand/field, Ph.2 sets S/T) + Bf.1 → Lubellion (Mululu+second-Fallen deck/hand, Mu.2 sets S/T). Both on-material sets fire. Requires 2 Fallen-of-Albaz-compatible bodies in deck (deck has Fallen 68468459 ×1 + White Dragon 73819701 ×2 = 3 qualifiers). Produces 2 Fusion bodies + 2 set Dracotail S/T. **Needs ocgcore verification** on the interaction.",
  "requiresDeckPieces": [1498449, 44362883, 68468459, 73819701, 7375867, 84477320, 70534340, 87746184],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 87746184 }, "position": "faceup-atk", "note": "Albion via Fa.1" },
    { "zone": "monster", "card": { "kind": "specific", "cardId": 70534340 }, "position": "faceup-atk", "note": "Lubellion via Bf.1" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T (Ph.2)" },
    { "zone": "spellTrap", "card": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "position": "facedown", "note": "Dracotail S/T (Mu.2)" }
  ],
  "steps": [
    { "action": "discard", "subject": { "kind": "specific", "cardId": 1498449 }, "note": "Fa.1 cost: discard Faimena" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 87746184 }, "note": "Fa.1: Fusion Albion using Phryxul (field) + Fallen of Albaz (hand)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Ph.2 on-material: set Dracotail S/T (e.g., Ketu)" },
    { "action": "activate", "subject": { "kind": "specific", "cardId": 44362883 }, "note": "Activate Branded Fusion (must come AFTER Fa.1 since Bf.1 locks ED→Fusion only, which wouldn't prevent Fa.1 since Fa.1 is Fusion anyway, but if order inverted the ED-lock consistency holds either way)" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 70534340 }, "note": "Bf.1: Fusion Lubellion using Mululu (deck, DARK) + White Dragon (deck, DARK treats-as-Fallen)" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [5431722, 69932023, 80208225, 32548318, 6153210] }, "note": "Mu.2 on-material: set Dracotail S/T (e.g., Rahu)" }
  ]
}
```

## 3.6 Post-Iteration-3 bridge count

- Original: 20 bridges (itérations 1-2)
- Retired (wrong attributes): 4 (Bridges 13, 14, 18, 19)
- Replacements: 4 (Bridges 21, 22, 23, 24)
- New from decoder: 3 (Bridges 25, 26, 27)
- **Net: 23 valid bridges**, with 3 flagged as medium-confidence (needs ocgcore verification): 10 (An.2 name-match), 15 (same), 27 (two-enabler chain)

## 3.7 Meta-observation on the discovery method (v3)

The attribute-transcription bug class is systemic, not incidental. Without a mechanical decoder, even careful human reading produces ~40% typing errors on racial/attribute classification for a 38-card deck. Iteration 3 — grounded in the decoder output — should now be the minimum-viable starting point for any future discovery pass on this or any other deck.

**Recommended workflow for future discovery passes**:

1. Dump full deck via `npx tsx scripts/dump-card-attrs.ts <cardIds>`. Paste the decoded table into the discovery doc BEFORE writing the catalog.
2. Build the material-slot matrix MECHANICALLY — for each Fusion body's material clause, enumerate all deck cards that qualify. Use the decoder data as the filter.
3. Propose bridges only after the matrix is complete.
4. Cross-check bridge claims against the matrix before writing the JSON.

This turns the error class from "intuition-dependent" into "code-dependent". Transcription is no longer the bottleneck.

---

*End of Iteration 3. Total ~170 min. Bridges 21-27 should be Axel-validated + ocgcore-spiked before grammar integration.*

