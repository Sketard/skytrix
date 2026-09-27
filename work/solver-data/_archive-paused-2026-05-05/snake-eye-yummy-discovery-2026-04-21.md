# Snake-Eye-Yummy — Effect-Linking Discovery (2026-04-21)

Discovery experiment on `snake-eye-yummy-sarcophagus-hollywood-wcq` (WCQ 2026 fixture). **Full mechanical workflow** — decode + index built upfront via `scripts/dump-card-attrs.ts` + `scripts/index-deck.ts`, all material-slot matches resolved as bucket intersections. Zero intuition-based typing.

Author: Claude Opus 4.7. Review: Axel.

## 1. Deck composition (mechanical decode)

37 unique cards (40 main + 15 extra). Two archetypes:
- **Snake-Eye** (setcode 7 cards): FIRE/PYRO Lv1 engine + Lv8 bodies + Field Spell + Fusion
- **Yummy** (setcode 10 cards): LIGHT/BEAST Lv1 engine + Lv2 Synchros + Field Spells

Plus: 3 Mulcharmy Fuwalos, 3 Ash Blossom, 3 Effect Veiler, 2 Ghost Belle, 2 Ghost Ogre, 3 Infinite Impermanence, Azurune Continuous Trap-Monster, utility spells (One for One, Bonfire, Triple Tactics × 2), 8 Link ED bodies (I:P Masquerena, S:P Little Knight, Promethean Princess, Amblowhale, Yummy★Snatchy, Linkuriboh, Almiraj, Silhouhatte Rabbit), Herald of the Arc Light + Martial Metal Marcher (Synchro toolbox).

## 2. Critical mechanical buckets (from `index-deck.ts`)

Key buckets used for material-slot resolution throughout:

| Bucket | Members |
|---|---|
| **FIRE** (10) | Snake-Eye Ash, Poplar, Flamberge Dragon, Oak, Diabellstar, Promethean Princess (ED), Amblowhale (ED), Snake-Eyes Doomed Dragon (ED), Salamangreat Almiraj (ED), Ash Blossom (handtrap) |
| **LIGHT** (12) | Marshmao, Cupsy, Cooky, Veiler, Ghost Ogre, Azurune, Yummy★Snatchy (ED), Cupsy★Way (ED), Cooky★Way (ED), Lollipo★Way (ED), Silhouhatte Rabbit (ED), Herald of the Arc Light (ED) |
| **PYRO** (3) | Snake-Eye Ash, Poplar, Oak (all Lv1 FIRE PYRO — Bonfire targets) |
| **BEAST** (7) | Marshmao, Cupsy, Cooky (main) + Yummy★Snatchy (ED Link-1) + Cupsy★Way, Cooky★Way, Lollipo★Way (ED Lv2 Synchros). NB Yummyusment Mignon/Acroquey sont des Field Spells (type=0x80002) — pas dans le bucket BEAST. |
| **CYBERSE** (3) | I:P Masquerena, Linkuriboh, Almiraj (all Link ED bodies) |
| **ILLUSION** (1) | Silhouhatte Rabbit (ED) — key for Doomed Dragon Fusion |
| **Lv 01** (7) | Snake-Eye Ash, Poplar, Oak + Marshmao, Cupsy, Cooky + Veiler |
| **Lv 08** (3) | Snake-Eyes Flamberge Dragon, Diabellstar, Doomed Dragon (ED) |
| **Link 01** (3) | Yummy★Snatchy, Linkuriboh, Almiraj |
| **Tuner** (8) | Ash, Veiler, Belle, Ogre (handtraps) + Cupsy/Cooky/Lollipo★Way (ED Lv2 Synchros) + Martial Metal Marcher (ED Lv3 Synchro) |
| **Non-Tuner Monster** (19) | All 27 monsters minus the 8 Tuners |

## 3. Atomic-effect catalog (condensed)

Cards are ID'd `Name.N`. Full oracles via `scripts/dump-card-text.ts`.

### Snake-Eye engine

**Snake-Eye Ash (9674034)** — Lv1 FIRE PYRO
- `SeA.1`: on-NS/SS → add 1 **Lv1 FIRE monster** from Deck to hand. OPT.
- `SeA.2`: send 2 face-up cards (incl self) → SS 1 Snake-Eye (not Ash) from hand/Deck. OPT.

**Snake-Eyes Poplar (90241276)** — Lv1 FIRE PYRO
- `SeP.1`: added-to-hand-not-drawn → SS self. OPT.
- `SeP.2`: on-NS/SS → add 1 Snake-Eye S/T from Deck. OPT.
- `SeP.3`: on-sent-to-GY → target 1 FIRE in GY → place as Continuous Spell in S/T zone. OPT.

**Snake-Eye Oak (45663742)** — Lv1 FIRE PYRO
- `SeO.1`: on-NS/SS → target 1 Lv1 FIRE banished/in GY → add to hand OR SS. OPT.
- `SeO.2`: send 2 face-up (incl self) → SS 1 Snake-Eye (not Oak) from hand/Deck. OPT.

**Snake-Eyes Flamberge Dragon (48452496)** — Lv8 FIRE DRAGON
- `SeF.1`: main → target 1 face-up monster field/GY → place as Continuous Spell. OPT.
- `SeF.2`: opp-turn quick → target 1 Monster Card treated as Continuous Spell → SS to own field. OPT.
- `SeF.3`: sent from hand/field to GY → SS 2 Lv1 FIRE from GY. OPT.

**Snake-Eyes Diabellstar (27260347)** — Lv8 FIRE SPELLCASTER
- `SeD.1`: attack-declared involving self → place self + opp monster as Continuous Spells. OPT.
- `SeD.2`: while Continuous Spell → target 1 FIRE in GY (not self) → place as Continuous Spell, SS self. OPT.

**Divine Temple of the Snake-Eye (53639887)** — Field Spell
- `DT.1`: on-activation → place 1 Snake-Eye (hand/Deck/GY) as Continuous Spell. OPT.
- `DT.2`: passive: Lv1 FIRE +1100 ATK while on field.
- `DT.3`: on-opp-NS/SS → target 1 Monster Card treated as Continuous Spell → SS to own field. OPT.

**Snake-Eyes Doomed Dragon (58071334)** — Lv8 FIRE DRAGON **Fusion**
- Materials: 1 Snake-Eye + 1 Illusion. Alt-SS: send 2 face-up monsters from S/T zone to GY.
- `SeDD.1`: on-SS → target 1 face-up monster → place as Continuous Spell. OPT.

### Yummy engine

**Marshmao☆Yummy (10966439)** — Lv1 LIGHT BEAST
- `My.1`: you control no monsters OR all your monsters are LIGHT Beast → SS self from hand. OPT.
- `My.2`: on-NS/SS → add 1 Yummy S/T from GY; OR, if SS'd by Synchro-eff → place 1 Yummy Field Spell / Cont. Spell/Trap from Deck/banished face-up. OPT.

**Cupsy☆Yummy (31425736)** — Lv1 LIGHT BEAST
- `Cp.1`: control Link-1 OR Lv2 Synchro → SS self. OPT.
- `Cp.2`: on-NS/SS → add 1 Yummy from Deck (not Cupsy); OR if SS'd by Synchro-eff → draw 1. OPT.

**Cooky☆Yummy (68810435)** — Lv1 LIGHT BEAST
- `Ck.1`: control Link-1 OR Lv2 Synchro → SS self. OPT.
- `Ck.2`: on-NS/SS → target 1 face-up opp monster, -1000 ATK; OR if SS'd by Synchro-eff → destroy instead. OPT.

**Yummyusment☆Mignon (66975205)** — Field Spell
- `Mg.1`: passive: Yummy +500 ATK per LIGHT Beast on field.
- `Mg.2`: control Link-1 → target 1 Lv1 Yummy in GY, SS. OPT.
- `Mg.3`: in GY → target 2 Yummy in GY/banished → place self + them on bottom of Deck. OPT.

**Yummyusment★Acroquey (93360904)** — Field Spell
- `Aq.1`: on-Synchro-Summon-of-LIGHT-Beast-Synchro → destroy 1 opp card. OPT.
- `Aq.2`: own face-up monster leaves field by opp eff → SS 1 Yummy from Deck. OPT.
- `Aq.3`: in GY → target 2 Yummy in GY/banished → place self + them bottom of Deck. OPT.

**Yummy☆Surprise (29369059)** — Quick-Play
- `Ys.1`: target 2 LIGHT Beast you control + 2 opp cards → return all to hand. OPT (shared).
- `Ys.2`: SS 1 Yummy from hand/GY (can't attack directly). OPT (shared).
- `Ys.3`: return 1 Field Spell (own field/GY) to hand, optionally place 1 Yummy Field Spell from hand face-up. OPT (shared).

**Yummy★Snatchy (30581601)** — Link-1 LIGHT BEAST
- Material: 1 Lv4-or-lower LIGHT Beast.
- `Sn.1`: on-SS → place 1 Yummy Field Spell from hand/Deck face-up; lock Link Summon to Link-2 or lower rest of turn. OPT.
- `Sn.2`: quick-eff (once per chain) → pay 100 LP, Synchro Summon using monsters you control (must include Yummy). OPT.

**Cupsy★Yummy Way (31603289)** — Lv2 Synchro LIGHT BEAST **Tuner**
- Materials: 1 Tuner + 1 non-Tuner. **"Can treat 1 Link-1 as Lv1 Tuner"**.
- `CW.1`: on-Synchro-Summon → add 2 Yummy from Deck to hand, then discard 1. OPT.
- `CW.2`: opp activates card/eff → return self to ED → SS up to 2 Yummy from GY. OPT.

**Cooky★Yummy Way (67098897)** — Lv2 Synchro LIGHT BEAST **Tuner**
- Same Synchro material clause.
- `CkW.1`: on-Synchro → target up to 2 face-up monsters → face-down Defense. OPT.
- `CkW.2`: same quick-eff as CW.2.

**Lollipo★Yummy Way (93192592)** — Lv2 Synchro LIGHT BEAST **Tuner**
- Same Synchro material clause.
- `LpW.1`: on-Synchro → SS 2 Yummy from GY (negate their effects). OPT.
- `LpW.2`: same quick-eff.

### Link toolbox

**I:P Masquerena (65741786)** — Link-2 DARK CYBERSE. Materials: 2 non-Link.
- `Mq.1`: opp-MP quick-eff → Link Summon using materials (incl self). OPT.
- `Mq.2`: passive: Link Monster using this as material can't be destroyed by opp effects.

**S:P Little Knight (29301450)** — Link-2 DARK WARRIOR. Materials: 2 Effect Monsters.
- `SP.1`: on-Link-Summon using Fusion/Synchro/Xyz/Link material → target 1 card field/GY, banish; own monsters can't attack directly this turn. OPT.
- `SP.2`: quick-eff on opp activation → target 2 face-up monsters (incl own) → banish until EP. OPT.

**Promethean Princess (2772337)** — Link-3 FIRE FIEND. Materials: 2+ Effect Monsters.
- `Pr.0`: passive: can only SS FIRE monsters.
- `Pr.1`: own MP → SS 1 FIRE from GY. OPT.
- `Pr.2`: while in GY, opp SS's monster → target 1 FIRE own + 1 opp → destroy both, SS self. OPT.

**Amphibious Swarmship Amblowhale (20665527)** — Link-4 FIRE MACHINE. Materials: 2+ Effect Monsters.
- `Am.1`: self destroyed → target 1 Link-3-or-lower in either GY → SS. OPT.
- `Am.2`: Link-3-or-lower on field destroyed while self in GY → banish self from GY, destroy 1 card. OPT.

**Linkuriboh (41999284)** — Link-1 DARK CYBERSE. Material: 1 Lv1 monster.
- Relevant: Link-1 using any Lv1 (Snake-Eye Ash/Poplar/Oak or Yummy Lv1 or handtrap Lv1).

**Salamangreat Almiraj (60303245)** — Link-1 FIRE CYBERSE. Material: 1 NS'd/Set monster with ≤1000 ATK.
- NS Snake-Eye Ash (800 ATK ≤1000) qualifies.

**Silhouhatte Rabbit (1528054)** — Link-2 LIGHT ILLUSION. Materials: 2 Effect Monsters.
- `Sh.1`: on-Link-Summon → set 1 Continuous Trap from Deck with effect that SSes itself as monster. OPT.
- `Sh.2`: card in S/T Zone SS'd to Monster Zone → target 1 opp S/T → destroy. OPT.

### Synchro toolbox (Lv4 + Lv3 extras)

**Herald of the Arc Light (79606837)** — Lv4 Synchro LIGHT FAIRY. Materials: 1 Tuner + 1+ non-Tuner = Lv4.
- `Hr.0`: passive: any monster sent from hand/Main Deck to GY is banished instead.
- `Hr.1`: quick-eff → tribute self → negate Spell/Trap/monster-eff activation, destroy. OPT.
- `Hr.2`: sent to GY → add 1 Ritual Monster or Ritual Spell from Deck.
- **Hr.2 DEAD in this deck** — no Ritual Monsters/Spells in main or extra. Hr.0 + Hr.1 are the payoffs.

**Martial Metal Marcher (81846453)** — Lv3 Synchro WIND MACHINE **Tuner**. Materials: 1 Tuner + 1+ non-Tuner = Lv3.
- `MM.1`: on-Synchro → target 1 Tuner in GY → SS in Def pos, negate effects. OPT.
- `MM.0`: passive: Synchros using Marcher as material are treated as Tuners. Enables double-Synchro chains.

### Utility spells

**One for One (2295440)** — Normal Spell. Send 1 monster from hand → SS 1 Lv1 from hand/Deck. Any Lv1 Snake-Eye or Yummy.

**Bonfire (85106525)** — Normal Spell. Add 1 Lv4-or-lower Pyro from Deck. Targets: Snake-Eye Ash/Oak/Poplar (all PYRO Lv1). **1-card Snake-Eye starter**.

**Angel Statue - Azurune (44822037)** — Continuous Trap Monster. SS self as Effect Monster (LIGHT/FAIRY/Lv4/1800). Bonus eff: negate opp SS using this monster-self as tribute (+ destroy).

### Handtraps / staples

Standard handtraps with attr/race corrections verified:
- Ash Blossom (Tuner Lv3 FIRE ZOMBIE) — negate Deck add/SS/send
- Effect Veiler (Tuner Lv1 LIGHT SPELLCASTER) — negate 1 face-up opp eff
- Ghost Belle (Tuner Lv3 EARTH ZOMBIE) — negate GY add/SS/banish
- Ghost Ogre (Tuner Lv3 LIGHT PSYCHIC) — destroy activated card
- Mulcharmy Fuwalos (Lv4 WIND WINGED BEAST, non-Tuner) — draw-per-opp-Deck/ED-SS
- Infinite Impermanence (Trap) — negate opp monster effect
- Triple Tactics Thrust/Talent — opp-monster-eff-gated utilities

## 4. Cross-archetype bridges (mechanical proposals)

### 4.1 Snake-Eye engine ignition → Yummy via Link-1 pivot

**Mechanical slot resolution**:
- Step 1: NS Snake-Eye starter. Normal Summon pool = `Lv 01 ∩ Monster ∩ PYRO ∩ non-Tuner` = {Snake-Eye Ash, Oak, Poplar}.
- Step 2: Link-1 summon. `Link 01 ∩ deck_extra` = {Yummy★Snatchy, Linkuriboh, Almiraj}.
  - Linkuriboh material: `Lv 01 ∩ Monster` — trivially satisfied by the Snake-Eye just summoned.
  - Almiraj material: `Monster ∩ NS-this-turn ∩ ATK ≤ 1000` — Ash (800 ATK) or Oak (900 ATK) NS qualifies.
  - Yummy★Snatchy material: `Lv ≤ 04 ∩ LIGHT ∩ BEAST` — Snake-Eyes don't qualify (FIRE/PYRO, not LIGHT/BEAST). So Yummy★Snatchy is NOT reachable from step 1 directly.
- Step 3: Cupsy/Cooky SS from hand. Precondition: `Link-1 on field OR Lv2 Synchro on field`. Satisfied by Linkuriboh/Almiraj placed at step 2.
- Step 4: Synchro Yummy Way. Materials: `Tuner + non-Tuner` with Link-1-treated-as-Lv1-Tuner clause. Intersect `Link 01 ∩ own_field` + `non-Tuner ∩ Lv 01 ∩ own_field` = {Linkuriboh/Almiraj} + {Cupsy/Cooky/Marshmao}. Both slots satisfiable.

```json
{
  "id": "snake-eye-linkuriboh-yummy-ignition-bridge",
  "name": "Snake-Eye NS → Link-1 → Cupsy/Cooky SS → Synchro Yummy Way",
  "description": "Cross-archetype ignition (mechanical): the Snake-Eye starter produces a Lv1 FIRE body which becomes a Link-1 Cyberse (Linkuriboh/Almiraj), which satisfies Cupsy/Cooky's 'control Link-1' SS precondition, which enables Yummy★Way Synchro (1 Tuner + 1 non-Tuner with Link-1 treated-as Tuner). Link-1 is the single point that bridges FIRE/PYRO engine to LIGHT/BEAST engine.",
  "requiresDeckPieces": [9674034, 41999284, 31425736, 31603289],
  "produces": [
    { "zone": "monster", "card": { "kind": "anyOf", "cardIds": [31603289, 67098897, 93192592] }, "position": "faceup-atk", "note": "Cupsy★Way | Cooky★Way | Lollipo★Way Synchro'd" }
  ],
  "steps": [
    { "action": "normalSummon", "subject": { "kind": "specific", "cardId": 9674034 }, "note": "NS Snake-Eye Ash" },
    { "action": "search", "subject": { "kind": "specific", "cardId": 9674034 }, "target": { "kind": "anyOf", "cardIds": [90241276, 45663742] }, "note": "SeA.1: add Lv1 FIRE from Deck (Poplar or Oak)" },
    { "action": "linkSummon", "subject": { "kind": "specific", "cardId": 41999284 }, "note": "Link Summon Linkuriboh using Ash as Lv1 material" },
    { "action": "specialSummon", "subject": { "kind": "anyOf", "cardIds": [31425736, 68810435] }, "note": "Cp.1/Ck.1: SS Cupsy OR Cooky from hand (Link-1 Linkuriboh on field)" },
    { "action": "synchroSummon", "subject": { "kind": "anyOf", "cardIds": [31603289, 67098897, 93192592] }, "note": "Synchro Yummy★Way (Lv2): Linkuriboh treated-as Lv1 Tuner + Cupsy/Cooky (Lv1 non-Tuner)" }
  ]
}
```

### 4.2 Doomed Dragon alt-SS via Snake-Eye S/T zone cascade

**Mechanical slot resolution**:
- Doomed Dragon alt-SS requires: 2 face-up monsters in own S/T zone.
- Snake-Eye places-face-up-as-Continuous-Spell effects: `SeP.3`, `SeF.1`, `DT.1`, `SeDD.1` (self-recursion), `SeD.2`, any Snake-Eye monster effect that triggers "place as Continuous Spell".
- 2 placements required → any 2 trigger combinations.

```json
{
  "id": "snake-eye-doomed-dragon-alt-ss-bridge",
  "name": "Snake-Eye S/T placements ×2 → Doomed Dragon alt-SS",
  "description": "Snake-Eye archetype-native bridge: multiple effects place Snake-Eye or FIRE monsters face-up in own S/T zone as Continuous Spells (Poplar GY-eff, Flamberge main-eff, Divine Temple activation, Diabellstar self-recursion). Once ≥2 such monsters are placed, Doomed Dragon's alternative Special Summon fires: send 2 face-up monsters from S/T to GY → SS Doomed Dragon. On-SS: place 1 more face-up monster as Continuous Spell (extends the engine).",
  "requiresDeckPieces": [90241276, 53639887, 58071334],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 58071334 }, "position": "faceup-atk", "note": "Doomed Dragon alt-SS'd" }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "specific", "cardId": 53639887 }, "note": "Activate Divine Temple: place 1 Snake-Eye as Continuous Spell (1st S/T zone placement)" },
    { "action": "specialSummon", "subject": { "kind": "role", "role": "extender" }, "note": "2nd placement via any Snake-Eye trigger (Poplar GY, Flamberge main-eff, Ash/Oak sending, etc.)" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 58071334 }, "note": "Doomed Dragon alt-SS: send 2 face-up S/T-zone monsters to GY → SS self" }
  ]
}
```

### 4.3 Doomed Dragon Fusion via Silhouhatte Rabbit (Illusion)

**Mechanical slot resolution**:
- Doomed Dragon Fusion materials: `Snake-Eye ∩ Monster` + `Illusion ∩ Monster`.
- `Snake-Eye ∩ Monster` = {Ash, Poplar, Flamberge, Oak, Diabellstar, Doomed Dragon itself}.
- `Illusion ∩ Monster` = {Silhouhatte Rabbit} — **only 1 qualifying card in the deck** → designed cross-archetype anchor.
- Silhouhatte Rabbit is itself Link-2, so it exists only after Link Summon. Doomed Dragon Fusion therefore chains AFTER at least 2 Effect Monsters → Silhouhatte → plus 1 Snake-Eye on field.

```json
{
  "id": "snake-eye-doomed-dragon-fusion-via-silhouhatte-bridge",
  "name": "Link Silhouhatte Rabbit (Illusion) + Snake-Eye on field → Fusion Doomed Dragon",
  "description": "Designed cross-archetype anchor: Doomed Dragon's 'Illusion monster' material slot is filled uniquely by Silhouhatte Rabbit (the only ILLUSION in the deck). Silhouhatte is a Link-2 Effect Monster body; once Link Summoned (via 2 Effect Monster materials), pairing with a Snake-Eye on field enables Doomed Dragon Fusion. No explicit Fusion-enabler spell is needed — the Fusion can be triggered via any generic Fusion enabler present elsewhere OR... wait, the deck has no Fusion spell. Doomed Dragon's Fusion pathway is inaccessible without a generic Fusion enabler. The alt-SS (Bridge 4.2) is the primary pathway. **Flagged: Doomed Dragon's 'Must be Fusion Summoned' clause vs alt-SS rigor.**",
  "requiresDeckPieces": [1528054, 9674034, 58071334],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 58071334 }, "position": "faceup-atk", "note": "Doomed Dragon Fusion'd (requires Fusion enabler)" }
  ],
  "steps": [
    { "action": "linkSummon", "subject": { "kind": "specific", "cardId": 1528054 }, "note": "Link Summon Silhouhatte Rabbit using 2 Effect Monsters" },
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 58071334 }, "note": "[BLOCKED: no Fusion enabler in deck] Fusion Summon Doomed Dragon using Snake-Eye (field) + Silhouhatte Rabbit (field)" }
  ]
}
```

**Flag**: the Fusion path is likely dead — no Fusion enabler spell/ability in the main deck. Doomed Dragon's text says "Must be either Fusion Summoned, or Special Summoned by sending 2 face-up Monster Cards from your Spell & Trap Zone to the GY." So alt-SS is the ONLY practical route in this deck. Iteration 1 would have proposed this bridge; iteration mechanics catch the dead Fusion path.

### 4.4 Yummy★Way tutor + discard-Yummy-for-engine synergy

**Mechanical slot resolution**:
- Cupsy★Way on-Synchro: add 2 Yummy from Deck, discard 1. Tutor pool: `YUMMY ∩ Monster ∩ Deck` = {Marshmao, Cupsy, Cooky} + GY-eff-self ones = {Yummy★Snatchy (ED, not main), Cupsy/Cooky/Lollipo★Way (ED Synchros, not main)}. Actually Cupsy★Way targets **monsters only**, and the deck's main-deck Yummy MONSTERS are {Marshmao, Cupsy, Cooky}. So tutor target = `{Marshmao, Cupsy, Cooky}` — 3 candidates.

```json
{
  "id": "cupsy-way-yummy-double-tutor-bridge",
  "name": "Cupsy★Way on-Synchro → add 2 Yummy monsters from Deck, discard 1",
  "description": "Yummy-internal tutor with massive reach: after Cupsy★Way is Synchro'd (see Bridge 4.1 for ignition), add 2 Yummy monsters from Deck, then discard 1. Pool: {Marshmao, Cupsy, Cooky}. Discard target: a 2nd copy of a Lv1 Yummy that can later be SS'd (via Marshmao's all-LIGHT-Beast clause, or Cupsy/Cooky's Link-1 clause). Net: +2 Yummy in hand → next turn continuity AND immediate re-ignition fuel.",
  "requiresDeckPieces": [31603289, 10966439, 31425736, 68810435],
  "produces": [
    { "zone": "hand", "card": { "kind": "anyOf", "cardIds": [10966439, 31425736, 68810435] }, "note": "Yummy monster #1" },
    { "zone": "hand", "card": { "kind": "anyOf", "cardIds": [10966439, 31425736, 68810435] }, "note": "Yummy monster #2 (different)" }
  ],
  "steps": [
    { "action": "search", "subject": { "kind": "specific", "cardId": 31603289 }, "target": { "kind": "anyOf", "cardIds": [10966439, 31425736, 68810435] }, "note": "CW.1: add 2 Yummy from Deck to hand, then discard 1 card" }
  ]
}
```

### 4.5 Marshmao Field-Spell placement chain (SS'd by Synchro eff)

**Mechanical slot resolution**:
- Marshmao's 2nd-half clause ("if SS'd by Synchro-eff") triggers when Marshmao comes out of GY/banishment via Yummy★Way.
- Lollipo★Way `LpW.1` SSes 2 Yummy from GY (negated effects), so Marshmao SS'd this way — but effects negated → My.2 field-spell-placement doesn't fire.
- Cupsy★Way `CW.2` quick-eff SSes 2 Yummy from GY (no negation mentioned) — Marshmao via this could trigger My.2 clause.
- Yummyusment☆Mignon Mg.2 targets 1 Lv1 Yummy in GY → SS (no negation mentioned). SS source says "if you control a Link-1" — not Synchro-eff. Doesn't trigger Marshmao's 2nd clause.

Actually, Marshmao `My.2`'s condition is **"if this card was Special Summoned by the effect of a Synchro Monster"** → requires the SSing effect to be resolved BY a Synchro Monster. CW.2 is Cupsy★Way (Synchro) activating and SSing Yummy — satisfies. LpW.1 is Lollipo★Way (Synchro) but effects are negated → the SS still happened by a Synchro, so the condition is met, but Marshmao's eff (My.2) is negated.

→ Marshmao SS'd by Cupsy★Way's CW.2 on opp's turn triggers My.2 → place Yummy Field Spell from Deck/banished.

```json
{
  "id": "cupsy-way-marshmao-field-spell-placement-bridge",
  "name": "Cupsy★Way quick-eff SS Marshmao from GY → Marshmao My.2 places Yummy Field Spell",
  "description": "Opponent's turn continuation: Cupsy★Way's CW.2 quick-effect returns itself to ED and SSes up to 2 Yummy from GY. If Marshmao is SS'd this way, his SS-by-Synchro-effect clause activates, letting him place 1 Yummy Field Spell (Mignon or Acroquey) or Continuous S/T from Deck/banished face-up. Extends setup across turn boundary.",
  "requiresDeckPieces": [31603289, 10966439, 66975205, 93360904],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 10966439 }, "position": "faceup-atk", "note": "Marshmao SS'd to field" },
    { "zone": "field", "card": { "kind": "anyOf", "cardIds": [66975205, 93360904] }, "note": "Yummy Field Spell placed from Deck/banished" }
  ],
  "steps": [
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 10966439 }, "note": "CW.2 opp-turn quick: return Cupsy★Way to ED, SS Marshmao from GY" },
    { "action": "set", "subject": { "kind": "anyOf", "cardIds": [66975205, 93360904] }, "note": "My.2: SS'd-by-Synchro clause → place Yummy Field Spell from Deck/banished" }
  ]
}
```

### 4.6 Flamberge Dragon ↔ S/T-zone Continuous Spell monster trampoline

**Mechanical slot resolution**:
- Flamberge's `SeF.2`: opp turn quick-eff → target 1 Monster Card treated as Continuous Spell → SS to own field.
- Divine Temple `DT.3`: opp NS/SS → target 1 Monster Card treated as Continuous Spell → SS to own field.
- Both effects convert S/T-zone Snake-Eye monsters back to Monster Zone on opp turn. Combined with SeP.3 + SeF.1 + SeDD.1 placements, this is a **flip-back loop**.

### 4.7 Azurune Continuous-Trap-Monster as interruption

- Azurune `Az.1`: opp would SS → send 1 Continuous Trap in own Monster Zone (Azurune itself, after placed as Effect Monster) → negate the SS + destroy opp monster.
- Passive (Silhouhatte Rabbit side): Sh.1 (Silhouhatte Link Summon) sets a Continuous Trap from Deck with SS-self-as-monster eff → `Az` qualifies (text: "Special Summon this card as an Effect Monster"). **Sh.1 directly enables Az**.
- So Link Silhouhatte → Az set face-down → Az becomes SS'd Effect Monster in Monster Zone → Az.1 ready for opp SS negate.

```json
{
  "id": "silhouhatte-azurune-trap-summon-bridge",
  "name": "Silhouhatte Link-Summon → set Azurune from Deck → Az SS-self-as-monster → opp SS negate",
  "description": "Silhouhatte Rabbit's Sh.1 on-Link-Summon sets a Continuous Trap with SS-self-as-monster effect from Deck. Azurune qualifies: it's Continuous Trap with 'Special Summon this card as an Effect Monster (Fairy/LIGHT/Lv4/1800/1800)'. Az, once in Monster Zone, triggers Az.1 on any opp SS: send Az (as Cont Trap in Monster Zone) to GY → negate opp SS + destroy. Net: 1-card Silhouhatte Link → 1 opp SS negate + kill. Classic Snake-Eye/Tear-style disruption. **Flagged: Az.1's wording 'send 1 Continuous Trap in your Monster Zone that was Special Summoned from the Spell & Trap Zone' — must have been SS'd from S/T Zone. Trap-set-then-SS chain qualifies.**",
  "requiresDeckPieces": [1528054, 44822037],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 44822037 }, "position": "faceup-atk", "note": "Azurune SS'd as Effect Monster Lv4 LIGHT FAIRY" }
  ],
  "steps": [
    { "action": "linkSummon", "subject": { "kind": "specific", "cardId": 1528054 }, "note": "Link Silhouhatte Rabbit using 2 Effect Monsters" },
    { "action": "set", "subject": { "kind": "specific", "cardId": 44822037 }, "note": "Sh.1: set Azurune from Deck" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 44822037 }, "note": "Az: SS self as Effect Monster (still a Trap) to Monster Zone" }
  ]
}
```

### 4.8 Promethean Princess FIRE-only lock — anti-synergy

- `Pr.0`: you can only SS FIRE monsters while Prom controls field.
- Yummy engine = LIGHT Beast → BLOCKED by Prom's restriction.
- Trade-off: Prom is a powerful Link-3 but cuts off the Yummy half of the deck. Summon only after Yummy engine has fully fired, or avoid entirely.

**Anti-synergy flag** documented — not a bridge, but a constraint that the solver's gate logic should respect.

### 4.9 Cross-archetype Link material chain (Masquerena on opp turn)

- I:P Masquerena `Mq.1`: opp MP quick-eff → Link Summon using own materials incl self.
- Synthesis: own field has Masquerena + Yummy Lv1 body(s) → Masquerena + 1 Lv1 → Link Summon S:P Little Knight or Silhouhatte Rabbit (both Link-2 "2 Effect Monsters").
- Results in defensive Link-2 interruption.

```json
{
  "id": "masquerena-opp-turn-link-pivot-bridge",
  "name": "Masquerena opp MP → Link Summon S:P Little Knight (2 Eff Monsters)",
  "description": "Defensive opp-turn Link Summon: Masquerena's Mq.1 lets you Link Summon on opp's Main Phase using materials including self. Masquerena (Link-2) + any own Effect Monster = 2 materials → Link Summon S:P Little Knight (Link-2, '2 Effect Monsters') OR Silhouhatte Rabbit. SP.1 triggers if Little Knight used a Fusion/Synchro/Xyz/Link monster as material — Masquerena IS Link, so SP.1 fires → target 1 card field/GY → banish. Cross-applicability: works post-Snake-Eye OR post-Yummy engine since Masquerena materials are generic '2 non-Link'.",
  "requiresDeckPieces": [65741786, 29301450],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 29301450 }, "position": "faceup-atk", "note": "S:P Little Knight Link-summoned on opp turn" }
  ],
  "steps": [
    { "action": "linkSummon", "subject": { "kind": "specific", "cardId": 29301450 }, "note": "Mq.1: Link Summon S:P Little Knight using Masquerena + 1 own monster on opp MP" },
    { "action": "specialSummon", "subject": { "kind": "role", "role": "interruption" }, "note": "SP.1 on-Link: banish 1 card field/GY (Masquerena is Link = qualifies as Fusion/Synchro/Xyz/Link material)" }
  ]
}
```

## 5. Open questions / flagged risks

1. **Doomed Dragon Fusion dead in this deck** (Bridge 4.3 flag): no Fusion enabler. Alt-SS (Bridge 4.2) is the only route. Confirms iteration-1-style bridges can be wrong if the Fusion-enabler check is skipped.

2. **Marshmao My.2 vs LpW.1 interaction**: Lollipo★Way SSes Yummies with effects negated. Marshmao's My.2 "if SS'd by Synchro-eff" condition is met but effect is negated. Cupsy★Way's CW.2 does NOT negate — so My.2 fires via CW.2 but not LpW.1. **Verify in ocgcore**: does "SS'd by Synchro effect" mean the effect resolving WAS by a Synchro (triggering), or does effect-negation of the target override?

3. **Azurune's Az.1 "SS'd from S/T Zone" clause** (Bridge 4.7): requires Azurune to have been SS'd from the S/T Zone (i.e., the trap was set in the Spell/Trap Zone, then its effect SS'd it to Monster Zone). This is how trap-monsters work generally. **Verify**: Silhouhatte's Sh.1 sets Azurune; Azurune's activate-as-trap eff SSes itself. Does "SS'd from S/T Zone" ruling hold?

4. **Herald of the Arc Light GY eff dead** in this deck (no Ritual content). Hr.0 passive + Hr.1 quick-eff negate are the only reasons Herald is here.

5. **Yummy★Snatchy's Sn.2 (pay 100 LP → Synchro)** is a powerful alternative Synchro engine. Materials requirement: "using monsters you control, including a 'Yummy' monster". Enables Synchros that don't require an explicit Tuner (presumably via the Marcher-descendant-as-Tuner trick or the Yummy Way Link-1-as-Tuner clause). **Under-explored — possibly adds more Synchro targets than I enumerated.**

6. **Cross-archetype anti-synergy (Prom Princess FIRE lock)**: Prom on field blocks Yummy summons. Ordering matters: fire all Yummy engine FIRST, then Link into Prom only at the end. **Solver gate logic needed.**

## 6. Summary (Iteration 1 — pre-verification)

- **Cards analyzed**: 37 unique (main + ED)
- **Main deck size**: 41 cards (not 40 — recounted post-verification, see §8.5)
- **Attributes/races/types verified**: mechanical decode — zero transcription errors on primitive fields
- **Buckets built**: 11 (attribute, race, level/rank/link, type flags + Non-Tuner derived, archetype setcode)
- **Formalized bridges**: §4.1, §4.2, §4.3, §4.4, §4.5, §4.7, §4.9 — 7 have JSON specs, but §4.3 is dead-flagged (no Fusion enabler) and §4.1 was broken for the fixture opener (see §8 errata for corrections). **Real usable count pre-verification ≈ 5**.
- **Prose-only observations**: §4.6 (Flamberge/DT trampoline), §4.8 (Prom FIRE lock anti-synergy). No JSON.
- **Dead paths identified**: 2 (Doomed Dragon Fusion, Herald Ritual search)
- **Analyst time**: ~45 min for iteration 1. Axel verification pass then surfaced 11 real issues + 5 new findings → see §8.

**See §8 Errata + Correction Pass for corrected bridges (flagship 1-card combo added, Silhouhatte Sh.2 trampoline added, Snatchy↔Prom anti-synergy added, opener trace added).**

## 7. Recommended next steps

1. Axel validation on the 9 bridges, especially the flagged ones (Az SS-from-S/T clause, Marshmao-from-Lollipo-vs-Cupsy triggering).
2. ocgcore spike on Bridge 4.7 to confirm Az.1 timing.
3. If the pattern holds, the mechanical workflow graduates from "experiment" to "the way we do discovery". Apply to the remaining fixtures (Tearlaments, D/D/D, etc.) in a systematic pass.

---

*End of iteration 1. Total ~45 min of analysis. Workflow: decode → index → intersect-buckets → propose → audit.*

---

# 8. Errata + Correction Pass (2026-04-21)

Axel verification pass surfaced 11 real issues + 5 new findings that iteration 1 missed. This section corrects in full. The most important miss: **Bridge 4.1 described the right pivot conceptually but encoded the wrong mechanical path** — it assumed Cupsy/Cooky in hand, whereas the fixture opener has zero Yummy monsters. The correct 1-card combo uses Snake-Eye bodies as the non-Tuner material and exploits Yummy★Way's "treat Link-1 as Lv1 Tuner" clause.

## 8.1 Fixture opener trace

Opener (5 cards):

| cardId | Name | Role in combo |
|---|---|---|
| 66975205 | Yummyusment☆Mignon | Yummy Field Spell — ATK buff + Link-1-gated SS-Yummy-from-GY |
| 9674034 | Snake-Eye Ash | **1-card starter** — NS, tutor Lv1 FIRE from Deck |
| 35269904 | Triple Tactics Thrust | Utility (opp-monster-eff gated — inert turn 1) |
| 90241276 | Snake-Eyes Poplar | **Self-SS on add-to-hand** (SeP.1) — critical multiplier |
| 25311006 | Triple Tactics Talent | Utility (opp-monster-eff gated — inert turn 1) |

**Zero Yummy monsters in hand.** Iteration 1's Bridge 4.1 required Cupsy/Cooky in hand for their Cp.1/Ck.1 SS clause; the opener doesn't satisfy. Correct path below.

## 8.2 Bridge 4.1-CORRECTED — **flagship 1-card combo**

This is the canonical ignition for the fixture and supersedes the original Bridge 4.1.

**Mechanical slot resolution**:

- Step 1 prerequisite: NS available, Snake-Eye Ash in hand.
- Step 2: `SeA.1` adds Poplar from Deck → Poplar added to hand *not drawn* → `SeP.1` triggers → Poplar SS to field. Both Ash + Poplar now on field (Lv 1 FIRE PYRO × 2).
- Step 3: Link Summon Link-1 using one of {Ash, Poplar} as material. Candidates:
  - **Linkuriboh (41999284)**: material clause `"1 Level 1 monster"` → either Ash OR Poplar qualifies (`Lv 01 ∩ Monster`).
  - **Almiraj (60303245)**: material clause `"1 Normal Summoned/Set monster with 1000 or less ATK"` → **only Ash qualifies** (Poplar was Special Summoned, not NS'd). Ash ATK 800 ≤ 1000 ✓.
- Step 4: Synchro Summon Cupsy★Yummy Way (Lv2 Synchro). Material clause: `1 Tuner + 1 non-Tuner`, with the special clause *"For this card's Synchro Summon, you can treat 1 Link-1 monster you control as a Level 1 Tuner"*. Intersect buckets:
  - Tuner slot: Link-1 on field (Linkuriboh or Almiraj from step 3, treated as Lv1 Tuner via special clause).
  - Non-Tuner slot: `Non-Tuner ∩ Lv 01 ∩ own_field` = the remaining Snake-Eye (Ash if Poplar was Linkuriboh'd, Poplar if Ash was Linkuriboh'd).
  - Total Lv = 1 + 1 = 2 ✓.
- Step 5: `CW.1` on-Synchro → add 2 Yummy monsters from Deck to hand, then discard 1. Pool: `YUMMY ∩ Monster ∩ Main_Deck` = {Marshmao, Cupsy, Cooky}. Typical pick: Cupsy + Cooky (Marshmao's SS clause "control no monsters OR all LIGHT Beast" harder to activate; Cupsy/Cooky's Cp.1/Ck.1 clause "control Link-1 OR Lv2 Synchro" is already satisfied by Cupsy★Way on field).
- Step 6: SS Cupsy from hand via Cp.1 (Cupsy★Way = Lv2 Synchro on field ✓). SS Cooky from hand via Ck.1 (same condition). `Cp.2` on-SS adds 1 Yummy from Deck (not Cupsy) — another tutor. `Ck.2` on-SS debuffs opp monster −1000 ATK.

**Net from 1 card (NS Ash)**: Cupsy★Way + Cupsy + Cooky on field + extra Yummy tutored via Cp.2 + resources in hand + Mignon activatable for ATK buff + Mg.2 SS-Yummy-from-GY once a body enters GY.

```json
{
  "id": "snake-eye-ash-1card-yummy-ignition-bridge",
  "name": "NS Ash → Poplar self-SS → Link-1 → Synchro Cupsy★Way → tutor 2 Yummy → chain SS Cupsy/Cooky",
  "description": "1-card flagship ignition (fixture-verified against opener [Mignon, SE Ash, TT Thrust, Poplar, TT Talent]). Uses SeA.1 + SeP.1 to produce 2 Lv1 FIRE bodies from 1 NS. Link-1 (Linkuriboh or Almiraj) + remaining Lv1 → Synchro Cupsy★Way via Link-1-as-Tuner clause. CW.1 tutors 2 Yummy + discard. Cupsy/Cooky chain-SS via Cp.1/Ck.1 using Cupsy★Way as their Lv2 Synchro trigger. Pure mechanical: no intuition required, all slot matches resolved against `Lv 01 ∩ Monster`, `Link 01 ∩ ED`, `YUMMY ∩ Main_Deck`. Key insight iteration 1 missed: Yummy★Way's Synchro material accepts ANY Lv1 non-Tuner via the Link-1-as-Tuner clause — Cupsy/Cooky do NOT need to be in hand at Synchro time; they come to hand via CW.1.",
  "requiresDeckPieces": [9674034, 90241276, 41999284, 31603289, 31425736, 68810435],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 31603289 }, "position": "faceup-atk", "note": "Cupsy★Yummy Way Synchro'd" },
    { "zone": "monster", "card": { "kind": "specific", "cardId": 31425736 }, "position": "faceup-atk", "note": "Cupsy☆Yummy SS'd via Cp.1" },
    { "zone": "monster", "card": { "kind": "specific", "cardId": 68810435 }, "position": "faceup-atk", "note": "Cooky☆Yummy SS'd via Ck.1" }
  ],
  "steps": [
    { "action": "normalSummon", "subject": { "kind": "specific", "cardId": 9674034 }, "note": "NS Snake-Eye Ash" },
    { "action": "search", "subject": { "kind": "specific", "cardId": 9674034 }, "target": { "kind": "specific", "cardId": 90241276 }, "note": "SeA.1: add Poplar from Deck to hand (Lv1 FIRE target)" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 90241276 }, "note": "SeP.1: Poplar added-to-hand-not-drawn → SS self" },
    { "action": "linkSummon", "subject": { "kind": "specific", "cardId": 41999284 }, "note": "Link Summon Linkuriboh using Poplar (any Lv1 material). Almiraj alt: use Ash (NS'd, 800 ATK ≤ 1000)" },
    { "action": "synchroSummon", "subject": { "kind": "specific", "cardId": 31603289 }, "note": "Synchro Cupsy★Way: Linkuriboh treated-as Lv1 Tuner + remaining Lv1 non-Tuner (Ash) = Lv2" },
    { "action": "search", "subject": { "kind": "specific", "cardId": 31603289 }, "target": { "kind": "anyOf", "cardIds": [31425736, 68810435] }, "note": "CW.1: add 2 Yummy monsters (Cupsy + Cooky) from Deck, discard 1" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 31425736 }, "note": "Cp.1: SS Cupsy (control Lv2 Synchro Cupsy★Way)" },
    { "action": "search", "subject": { "kind": "specific", "cardId": 31425736 }, "target": { "kind": "role", "role": "extender" }, "note": "Cp.2 on-SS: add 1 Yummy (not Cupsy) from Deck (Marshmao typical pick to enable GY→field via Mg.2 later)" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 68810435 }, "note": "Ck.1: SS Cooky (control Lv2 Synchro)" }
  ]
}
```

**Mignon synergy** (not in steps above but fires naturally): `Mg.1` passive gives all Yummy +500 ATK per LIGHT Beast on field (3 LIGHT Beast on field → +1500 ATK each). `Mg.2` can SS a Lv1 Yummy from GY once a body hits GY (via discard, or via Cupsy★Way material Ash).

## 8.3 Bridge 4.10 — Silhouhatte Sh.2 + Flamberge/DT trampoline

**Missed loop**: Silhouhatte Rabbit's Sh.2: *"If a card in the Spell & Trap Zone is Special Summoned to the Monster Zone (except during the Damage Step): You can target 1 Spell/Trap your opponent controls; destroy it."* The deck has TWO triggers for this:

- `SeF.2` (Flamberge): opp turn quick → SS a Continuous-Spell-treated monster (Snake-Eye in S/T zone) back to Monster Zone.
- `DT.3` (Divine Temple): opp NS/SS → SS a Continuous-Spell-treated monster to Monster Zone.

Every time a Snake-Eye bounces S/T→Monster (which happens multiple times per turn in a live Snake-Eye combo), Silhouhatte Sh.2 fires → destroy 1 opp S/T. Free disruption stacked on the engine.

```json
{
  "id": "silhouhatte-flamberge-dt-trampoline-disruption-bridge",
  "name": "Silhouhatte on field + Flamberge/DT S/T→Monster bounce → Sh.2 destroy opp S/T",
  "description": "Passive disruption loop missed in iteration 1. Silhouhatte Rabbit's Sh.2 triggers whenever a card in own S/T zone is Special Summoned to own Monster Zone. Snake-Eye engine produces these triggers naturally via Flamberge SeF.2 (quick-eff opp-turn) and Divine Temple DT.3 (on opp NS/SS). Each bounce = 1 Sh.2 trigger = 1 opp S/T destroyed. Stacks with Azurune Az.1 SS-negate and S:P Little Knight SP.2 banish-pair for 3-layer disruption from a fully-fired board.",
  "requiresDeckPieces": [1528054, 48452496, 53639887],
  "produces": [
    { "zone": "monster", "card": { "kind": "role", "role": "interruption" }, "note": "Opp S/T destroyed per Sh.2 trigger" }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "anyOf", "cardIds": [48452496, 53639887] }, "note": "Flamberge SeF.2 (opp turn quick) OR Divine Temple DT.3 (on opp NS/SS): SS a Monster Card treated as Continuous Spell to own Monster Zone" },
    { "action": "specialSummon", "subject": { "kind": "role", "role": "interruption" }, "note": "Sh.2 triggers: S/T Zone → Monster Zone. Target 1 opp S/T, destroy" }
  ]
}
```

## 8.4 Anti-synergy Snatchy→Prom (symmetric to Prom→Yummy)

Iteration 1 flagged `Pr.0` (Prom Princess Link-3 → only SS FIRE monsters rest of turn, blocks Yummy SS). Missed the reverse: `Sn.1` (Yummy★Snatchy on-SS) → *"you cannot Link Summon Link-3 or higher Link Monsters for the rest of this turn"*. Snatchy blocks Prom.

**Solver gate logic**:
- If Prom Princess is desired on endboard → NS/Link chain must reach Prom **before** any Yummy★Snatchy SS.
- If Yummy★Snatchy is part of the chain → Prom is off-limits for the remainder of the turn.
- Clean ordering: Yummy engine first (if Snatchy used), Prom after only if Snatchy NOT used.

This is a **hard symbol-level constraint**, not a suggestion. The solver must model it as a post-activation mask: Snatchy-SS this turn → prohibit Link ≥3 Summons.

## 8.5 Factual corrections

- **Main deck size**: 41 cards (not 40). Recounted against fixture lines 583-623: 21 unique IDs × their quantities = 41.
- **Yummy★Snatchy is ×2 in ED** (not singleton). Two copies available = potential for dual Snatchy play (via chain / LP-payment Synchro via Sn.2).
- **Cooky☆Yummy is singleton** (×1 main). Cupsy★Way's `CW.1` "add 2 Yummy" can only pick 1 Cooky total.
- **Fixture metadata mismatch**: fixture description mentions "Fiendsmith + Shining Sarcophagus sub-engines". Decklist has NEITHER — no Fiendsmith cards, no Shining Sarcophagus cards. The description is stale (likely from an earlier build of the archetype). Decklist analysis in this doc is against the ACTUAL decklist, not the claimed sub-engines.
- **BEAST bucket (§2)**: 7 members = {Marshmao, Cupsy, Cooky, Snatchy, Cupsy★Way, Cooky★Way, Lollipo★Way}. Yummyusment Mignon/Acroquey are **Field Spells** (type=0x80002), not monsters — excluded from race bucket. Iteration 1 table mistakenly listed them; corrected in-place.

## 8.6 Revised bridge inventory

| # | Bridge id | Status | JSON? |
|---|---|---|---|
| 4.1-CORRECTED (§8.2) | `snake-eye-ash-1card-yummy-ignition-bridge` | ✓ flagship, fixture-verified | ✓ |
| 4.2 | `snake-eye-doomed-dragon-alt-ss-bridge` | ✓ valid | ✓ (requiresDeckPieces under-populated in iter1 — add Flamberge/Ash/Oak if more S/T zone triggers needed) |
| 4.3 | `snake-eye-doomed-dragon-fusion-via-silhouhatte-bridge` | ✗ **dead** (no Fusion enabler in deck) | prose only — retire |
| 4.4 | `cupsy-way-yummy-double-tutor-bridge` | ✓ valid (note Cooky singleton constraint) | ✓ |
| 4.5 | `cupsy-way-marshmao-field-spell-placement-bridge` | ✓ valid via CW.2 (Lollipo LpW.1 path blocked by negation — flag stands) | ✓ |
| 4.6 | Flamberge/DT trampoline | prose-only in iter1 → **formalized in §8.3 as Bridge 4.10** | see §8.3 |
| 4.7 | `silhouhatte-azurune-trap-summon-bridge` | ✓ valid (timing annotation on step 3 improved) | ✓ |
| 4.8 | Prom FIRE-lock anti-synergy | gate flag | prose (now symmetric with Snatchy→Prom in §8.4) |
| 4.9 | `masquerena-opp-turn-link-pivot-bridge` | ✓ valid | ✓ |
| **4.10 (§8.3)** | `silhouhatte-flamberge-dt-trampoline-disruption-bridge` | ✓ new | ✓ |

**Honest count**:
- Formalized bridges with JSON: **7** (4.1-corrected, 4.2, 4.4, 4.5, 4.7, 4.9, 4.10)
- Dead path: 1 (4.3)
- Anti-synergy gates (not bridges): 2 (4.8 Prom, §8.4 Snatchy)

## 8.7 Méta-leçons (updated)

Iteration 1 was 4× faster than branded-dracotail but revealed discipline gaps the decoded workflow doesn't fix on its own:

1. **Fixture-first test**: before formalizing any bridge, evaluate it against the SPECIFIC opening hand. If the bridge requires card X in hand and X isn't in the opener, the bridge is broken for the fixture regardless of the deck's theoretical capability. This check would have caught Bridge 4.1's Cupsy-in-hand assumption immediately.

2. **Pair-level connection discipline**: atomic effects listed in the catalog must be connected to upstream triggers. `SeP.1` (Poplar on-added-to-hand-not-drawn) was in the catalog but I didn't connect it to `SeA.1` (Ash adds from Deck = add-to-hand-not-drawn). This is exactly the edge the pair-level analysis is meant to find.

3. **Special clause attention**: Yummy★Way's "treat 1 Link-1 as Lv1 Tuner" is a material-rewrite clause that fundamentally changes what the Synchro accepts. Similar clauses ("treated as X", "this card's effect can...") deserve explicit re-reading during bridge proposal.

4. **Multiplicity**: counts matter for tutor targets (Cooky ×1 → can't be added twice) and for multi-copy chains (Snatchy ×2 → dual deployment).

5. **Symmetric anti-synergies**: for every card with a "cannot X rest of turn" clause, systematically check the reverse direction (what does X block that this card enables?).

6. **Honest accounting in summaries**: formalized bridges = JSON specs. Flags, dead paths, anti-synergies are valuable but not bridges. Separate the counts.

7. **Copy-edit pass**: internal "wait, let me verify" phrases are chain-of-thought artifacts and must be stripped before publication.

---

*End of Iteration 1 + §8 Errata. Corrected ~55 min (original 45 + verification integration 10). Ready for next verification pass or grammar integration.*
