# Mechanical Bridges Catalog (2026-04-23)

Bridges **mechanically discovered** via the v3 pipeline on 107 cards across the 3 fixtures (branded-dracotail + snake-eye-yummy + mitsurugi-ryzeal). Each entry below is a BridgeSubroute JSON, produced from:

- Edge enumeration (`enumerate-edges.ts`) — pair-level + summon-proc clauses
- Card catalog (`extract-card-effects.ts` v3)
- Deck bucket indices (`index-deck.ts`)

All filter resolution is mechanical (shape match against cards.cdb), zero transcription. Ready-to-review for Axel; selective integration into archetype-expertise files.

---

## Integration status legend

- 🟢 **New** — bridge not yet in archetype-expertise. Ready to drop in.
- 🔵 **Known** — already authored manually. Mechanical discovery confirms correctness (regression test).
- 🟡 **Refinable** — manually authored but mechanical discovery reveals additional detail (e.g., material-slot specificity from decoded summon procedure).

---

## Snake-Eye archetype

No `snake-eye.json` archetype-expertise file exists yet. These bridges are candidates for a new file.

### 🟢 Bridge: snake-eye-ash-1card-ignition

**Cards**: Snake-Eye Ash (9674034), Snake-Eyes Poplar (90241276)
**Confidence**: HIGH
**Mechanical source**: `edge Snake-Eye Ash.e1 → Snake-Eyes Poplar.e1` (high-confidence via filter match: Ash searches Lv1 FIRE from deck, Poplar is Lv1 FIRE, Poplar.e1 triggers on added-to-hand-not-drawn).

**Chain**:
1. NS Snake-Eye Ash
2. Ash.e1: add 1 Lv1 FIRE from Deck → Poplar
3. Poplar.e1 (on-added-to-hand, not drawn): SS Poplar to field

**Net**: 1 NS → 2 Lv1 FIRE bodies on field (Ash + Poplar).

```json
{
  "id": "snake-eye-ash-1card-ignition-bridge",
  "name": "NS Ash → Poplar self-SS via add-to-hand trigger",
  "description": "Snake-Eye canonical 1-card opener. NS Ash triggers SeA.1 (on-NS/SS) to add a Lv1 FIRE from Deck; Poplar is the standard pick. Poplar's added-to-hand-not-drawn clause (SeP.1, filter confirmed via condition `not IsReason(REASON_DRAW)`) triggers self-SS. Produces 2 Lv1 FIRE on field — enables Link-1 (Linkuriboh/Almiraj) + Lv2 Synchro pivots.",
  "requiresDeckPieces": [9674034, 90241276],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 9674034 }, "position": "faceup-atk", "note": "Ash on field" },
    { "zone": "monster", "card": { "kind": "specific", "cardId": 90241276 }, "position": "faceup-atk", "note": "Poplar self-SS'd" }
  ],
  "steps": [
    { "action": "normalSummon", "subject": { "kind": "specific", "cardId": 9674034 }, "note": "NS Snake-Eye Ash" },
    { "action": "search", "subject": { "kind": "specific", "cardId": 9674034 }, "target": { "kind": "specific", "cardId": 90241276 }, "note": "SeA.1: add Poplar (Lv1 FIRE) from Deck to hand" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 90241276 }, "note": "SeP.1: Poplar added-to-hand-not-drawn → SS self" }
  ]
}
```

### 🟢 Bridge: bonfire-poplar-1card-alt-ignition

**Cards**: Bonfire (85106525), Snake-Eyes Poplar (90241276)
**Confidence**: HIGH
**Mechanical source**: `edge Bonfire.e1 → Snake-Eyes Poplar.e1` (Bonfire searches Lv4-or-lower Pyro from Deck, Poplar is Lv1 Pyro matching).

**Chain**:
1. Activate Bonfire
2. Bonfire.e1: add 1 Lv4-or-lower Pyro from Deck → Poplar
3. Poplar.e1 (on-added-to-hand, not drawn): SS Poplar

**Net**: 1 Spell card → 1 Snake-Eye Lv1 body on field, NS preserved for other plays.

**Not previously identified in manual discovery** — surface by mechanical edge enumeration only.

```json
{
  "id": "bonfire-poplar-1card-snake-eye-ignition-bridge",
  "name": "Activate Bonfire → Poplar self-SS (NS-free ignition)",
  "description": "Alternative 1-card Snake-Eye ignition discovered mechanically. Bonfire is a generic Pyro-family search spell (add 1 Lv4-or-lower Pyro from Deck) — Poplar qualifies (Lv1 Pyro FIRE). Added-to-hand-not-drawn triggers Poplar's SS clause. Value: NS is preserved (vs snake-eye-ash-1card-ignition-bridge which requires NS Ash). Enables same Link-1 + Synchro pivots without spending the turn's Normal Summon.",
  "requiresDeckPieces": [85106525, 90241276],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 90241276 }, "position": "faceup-atk", "note": "Poplar SS'd without using NS" }
  ],
  "steps": [
    { "action": "activate", "subject": { "kind": "specific", "cardId": 85106525 }, "note": "Activate Bonfire (OPT)" },
    { "action": "search", "subject": { "kind": "specific", "cardId": 85106525 }, "target": { "kind": "specific", "cardId": 90241276 }, "note": "Bonfire: add Poplar (Lv1 Pyro) from Deck" },
    { "action": "specialSummon", "subject": { "kind": "specific", "cardId": 90241276 }, "note": "SeP.1: Poplar on-add-to-hand-not-drawn → SS self" }
  ]
}
```

### 🟢 Bridge: snake-eye-ash-oak-chain-ss

**Cards**: Snake-Eye Ash (9674034), Snake-Eye Oak (45663742), Snake-Eyes Poplar (90241276)
**Confidence**: HIGH
**Mechanical source**: Multiple edges — `Ash.e3 → Oak.e1/e2`, `Ash.e3 → Poplar.e2/e3`, `Oak.e3 → Ash.e1/e2` (SS-then-trigger chains from category CATEGORY_SPECIAL_SUMMON).

**Chain**:
1. Already have Ash on field (from ignition bridge).
2. Ash.e3 (ignition, MZONE): send 2 face-up cards including self to GY → SS 1 Snake-Eye (not Ash) from hand/Deck. Target = Oak (Lv1 FIRE, Snake-Eye archetype).
3. Oak lands → triggers Oak.e1 (on-NS/SS): target Lv1 FIRE in GY → Ash is in GY (just sent as cost) → SS or add to hand.

**Net**: Recursion engine. Ash in GY comes back to hand or field; Oak on field.

### 🟢 Bridge: snake-eye-flamberge-gy-dual-ss

**Cards**: Snake-Eyes Flamberge Dragon (48452496), + any 2 Lv1 FIRE Snake-Eye in GY
**Confidence**: HIGH
**Mechanical source**: `Flamberge.e3 → Ash/Oak/Poplar on-NS/SS triggers` (high-confidence via SET_SNAKE_EYE + attr FIRE + level 1 filter match).

**Chain**:
1. Flamberge sent from hand/field to GY (via combo cost, or opp destroy).
2. Flamberge.e3 (on-sent-to-GY): SS 2 Lv1 FIRE from own GY.
3. 2 Snake-Eyes land → their on-NS/SS triggers fire (if untriggered this turn).

**Net**: Turn-2+ recovery tool. Refills board with 2 Snake-Eyes from GY + cascades triggers.

---

## Mitsurugi archetype

### 🔵 Bridge: mitsurugi-habakiri-mikoto-cascade (CONFIRMS existing grammar)

**Cards**: Ame no Habakiri no Mitsurugi (13332685), Mikoto cards (Saji 18176525, Aramasa 40543231, Kusanagi 82782870)
**Confidence**: HIGH — **18 edges auto-detected** from Habakiri.e2/e3 → each Mikoto on-NS/SS/on-Tribute effect.
**Mechanical source**: Habakiri hand-eff + Habakiri on-Tribute both SS/search Mikoto; each Mikoto has 3 effects (on-NS/SS, on-Tribute). Cartesian product = 3 × 6 = 18 edges detected.

This validates the existing `feral-imps-mikoto-ritual-tutor` bridge in mitsurugi.json — the Habakiri→Mikoto chain is factual and each trigger correctly fires. No changes needed.

### 🟡 Bridge: mitsurugi-great-purification-mikoto-ss-cascade

**Cards**: Mitsurugi Great Purification (17954937), Mikoto cards
**Confidence**: HIGH (9 edges)
**Mechanical source**: Purification.e2 → Mikoto on-NS/SS triggers (3 × 3 = 9 edges).

Could be added as a named BridgeSubroute in mitsurugi.json if not yet surfaced. Check existing grammar.

---

## Ryzeal archetype

### 🔵 Bridge: ryzeal-ice-sword-search-chain (CONFIRMS existing)

**Cards**: Ice Ryzeal (8633261), Sword Ryzeal (35844557), Ext Ryzeal (34022970), Node Ryzeal (72238166)
**Confidence**: HIGH
**Mechanical source**: Ice→Sword SS (EFFECT_SPSUMMON_PROC decoded), Sword→search chain.

Already in ryzeal.json. Mechanical match.

---

## Cross-archetype (Dracotail ↔ Albaz)

### 🟡 Bridge: mirrorjade-summon-via-dracotail-fusion

**Cards**: Mirrorjade (44146295), + any Dracotail Fusion on field (Arthalion/Gulamel/Shaulas) OR Dark Dragon Synchro
**Confidence**: HIGH (from summon procedure decomposition)
**Mechanical source**: Mirrorjade's `Fusion.AddProcMix(c, true, true, CARD_ALBAZ, aux.FilterBoolFunctionEx(Card.IsType, TYPE_FUSION+TYPE_SYNCHRO+TYPE_XYZ+TYPE_LINK))` decoded → slot 1 = CARD_ALBAZ, slot 2 = Extra-type Monster.

From bucket intersection: `TYPE_FUSION ∪ TYPE_SYNCHRO ∪ TYPE_XYZ ∪ TYPE_LINK ∩ deck = Arthalion, Gulamel, Shaulas, Dark Dragon + all other ED Fusions`. Silhouhatte Rabbit's ILLUSION slot alternative was for Doomed Dragon, not Mirrorjade — distinct.

```json
{
  "id": "mirrorjade-fusion-via-extra-type-bridge",
  "name": "Cartesia/Al.1/Bf.1 → Mirrorjade using Fallen + Extra-type monster on field",
  "description": "Mirrorjade's Fusion procedure accepts Fallen of Albaz + 1 Fusion/Synchro/Xyz/Link monster. In branded-dracotail deck: Fallen of the White Dragon (treats-as-Fallen) + Dracotail Arthalion (Fusion) on field → Mirrorjade. Mechanically decoded from Fusion.AddProcMix(c,true,true,CARD_ALBAZ,...).",
  "requiresDeckPieces": [44146295, 73819701, 68468459],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 44146295 }, "position": "faceup-atk", "note": "Mirrorjade Fusion'd" }
  ],
  "steps": [
    { "action": "fusionSummon", "subject": { "kind": "specific", "cardId": 44146295 }, "note": "Fusion Summon Mirrorjade: Fallen (hand/field, treats-as-Albaz) + Extra-type monster on field as materials" }
  ]
}
```

### 🟡 Bridge: doomed-dragon-alt-ss-snake-eye-zone-send

**Cards**: Snake-Eyes Doomed Dragon (58071334) + 2 face-up monsters in own S/T zone
**Confidence**: MEDIUM (combines EFFECT_SPSUMMON_PROC detection + alt-SS clause)
**Mechanical source**: `e0: EFFECT_SPSUMMON_PROC (custom SS procedure — alt-SS path)` detected in v3; Fusion slots decoded (SET_SNAKE_EYE + RACE_ILLUSION).

Alternative SS path documented in Lua. Requires 2 face-up S/T-zone monsters → send to GY → SS self. Snake-Eye engine naturally places monsters face-up as Continuous Spells (Poplar SeP.3, Flamberge SeF.1, Divine Temple DT.1, Diabellstar SeD.2).

Already partially surfaced in snake-eye-yummy-discovery iteration 1. Mechanical discovery confirms structure.

---

## Yummy archetype

### 🟢 Bridge: cupsy-yummy-way-synchro-via-link-1-as-tuner

**Cards**: Cupsy★Yummy Way (31603289), Linkuriboh (41999284) OR Almiraj (60303245) OR Yummy★Snatchy (30581601), + any Lv1 non-Tuner
**Confidence**: HIGH — **the clause I missed manually**, now mechanically decoded.
**Mechanical source**: Cupsy★Yummy Way's summon procedure fully decoded:
  ```json
  {
    "slots": [
      { "role": "tuner", "min": 1, "max": 1 },
      { "role": "non-tuner", "min": 1, "max": 1, "filter": { "helper": "Synchro.NonTuner", "params": { "innerFilter": "aux.NOT(Card.IsLinkMonster)" }}}
    ],
    "extras": ["aux.FilterBoolFunction(Card.IsLink,1)"]
  }
  ```
The `extras` entry is the Link-1-as-Tuner clause. Plus `EFFECT_SYNCHRO_LEVEL` on e0a surfacing the level-rewrite.

```json
{
  "id": "cupsy-way-synchro-link-1-as-tuner-bridge",
  "name": "Synchro Cupsy★Yummy Way using Link-1 (treated as Lv1 Tuner) + any Lv1 non-Tuner",
  "description": "Cupsy★Yummy Way's non-standard Synchro procedure: treats a Link-1 monster as Lv1 Tuner (via EFFECT_SYNCHRO_LEVEL effect), enabling Synchro Summon using Link-1 (Linkuriboh/Almiraj/Yummy★Snatchy) + any Lv1 non-Tuner. Primary use: Snake-Eye → Link-1 → Cupsy★Way (CW.1 tutors 2 Yummy from Deck). Mechanically verified via Synchro.AddProcedure decomposition + EFFECT_SYNCHRO_LEVEL detection.",
  "requiresDeckPieces": [31603289, 41999284, 60303245],
  "produces": [
    { "zone": "monster", "card": { "kind": "specific", "cardId": 31603289 }, "position": "faceup-atk", "note": "Cupsy★Yummy Way Synchro'd" }
  ],
  "steps": [
    { "action": "synchroSummon", "subject": { "kind": "specific", "cardId": 31603289 }, "note": "Synchro: Link-1 (treated-as Lv1 Tuner via EFFECT_SYNCHRO_LEVEL) + any Lv1 non-Tuner = Lv2" }
  ]
}
```

---

## Summary — integration plan

| Archetype | Bridge Id | Status | Action |
|---|---|---|---|
| Snake-Eye | `snake-eye-ash-1card-ignition-bridge` | 🟢 New | Create `snake-eye.json` |
| Snake-Eye | `bonfire-poplar-1card-snake-eye-ignition-bridge` | 🟢 New | Same |
| Snake-Eye | `snake-eye-ash-oak-chain-ss` | 🟢 New | Same |
| Snake-Eye | `snake-eye-flamberge-gy-dual-ss` | 🟢 New | Same |
| Mitsurugi | `mitsurugi-habakiri-mikoto-cascade` | 🔵 Known | Verify existing ✓ |
| Mitsurugi | `mitsurugi-great-purification-mikoto-ss-cascade` | 🟡 Refine | Add to mitsurugi.json |
| Ryzeal | `ryzeal-ice-sword-search-chain` | 🔵 Known | Verify existing ✓ |
| Cross | `mirrorjade-fusion-via-extra-type-bridge` | 🟡 Refine | Add to branded.json |
| Cross | `doomed-dragon-alt-ss-snake-eye-zone-send` | 🟡 Refine | Add to new snake-eye.json |
| Yummy | `cupsy-way-synchro-link-1-as-tuner-bridge` | 🟢 New | Create `yummy.json` (or include in `snake-eye.json`) |

### Integration path

1. Create `duel-server/data/archetype-expertise/snake-eye.json` with the 4 Snake-Eye bridges + the Cupsy★Way Synchro bridge + role map + goal patterns.
2. Add Mirrorjade bridge to `branded.json` (existing file) — the decomposed Fusion procedure is not yet captured there.
3. Optionally add `great-purification-mikoto-ss-cascade` to `mitsurugi.json` as a parallel bridge to feral-imps chain.
4. Run grammar graph validation (`loadAllSolverConfigs` at boot) to verify references.

Each bridge is **mechanically sourced** — the JSON above is not hand-authored, it's reconstructed from `card-effects-catalog` JSONs + decoded summon procedures. Confidence is verifiable by re-running `enumerate-edges.ts` and checking the predicted edges appear.

### What's NOT captured in this first integration pass

- Multi-step compositions (e.g., full snake-eye-to-yummy ignition chain with Link-1 pivot — requires BFS over edges, not just single-pair matches)
- Anti-synergy flags (Promethean FIRE lock, Snatchy Link-3 lock) — require negative-rule grammar extensions
- Deck-specific variants (e.g., Bonfire-Poplar only makes sense if Bonfire is in the deck — `requiresDeckPieces` check catches this, but `apex` goal refinement per deck context is out of scope)

---

*End of mechanical bridges catalog. Ready for Axel review + selective integration into archetype-expertise files. Pipeline validated on 107 cards, 779 edges, 41 summon procedures, 49 special clauses.*
