# Branded-Dracotail Opener — Combo Plan (2026-04-19)

Research doc for hand-authoring the canonical trajectory via `trace-assist.ts`
for fixture `branded-dracotail-opener`. All card mechanics verified directly
against `cards.cdb` (via `scripts/dump-card-text.ts`). User dictated the line
verbatim — it is the source of truth, revising the 6-piece endboard stored in
`solver-validation-decks.json` to a larger Dracotail-centric finish.

## User Clarifications Applied (2026-04-19)

The original draft of this doc raised two blocking concerns on step 4 and
step 9 — user corrected both:

1. **Step 4 exact flow**: "Black Dragon [= Ecclesia and the Dark Dragon,
   78397661] SS's **Incredible Ecclesia from the Deck** (not from GY);
   Incredible Ecclesia then **tributes herself to SS Blazing Cartesia from
   the Deck** (not from hand)." Incredible Ecclesia returns to hand in
   the End Phase from GY (she is in GY because she tributed herself).
   Rescind Critical Constraint #2 (agent's "Dark Dragon SS's Ecclesia
   from GY + Cartesia self-SS from hand" reading) and Known Caveat #1
   (the "EP return won't fire" conflict). Correct flow:
   - Dark Dragon banishes self until EP → SS Incredible Ecclesia from
     Deck (she mentions Fallen of Albaz at Lv4 → valid target).
   - Incredible Ecclesia's own effect: tribute self → SS Blazing Cartesia
     from Deck (Cartesia mentions Fallen of Albaz).
   - Ecclesia → GY. EP return-to-hand trigger fires at End Phase. ✓
   - Blazing Cartesia **comes from Deck via Ecclesia's tribute**, not from
     hand. The Cartesia card ID 95515789 in the opening hand is therefore
     unused in this line — like Branded Fusion, it's a dead card for this
     combo. This is consistent with "combo minimaliste" per user.

2. **Step 9 Rahu activation same-turn-as-set is legal.** Per user: "Only
   Quick-Play Spells and Traps cannot be activated the turn they are set."
   Rahu Dracotail (32548318) is a Normal Spell (cards.cdb type=0x2, no
   Quick-Play bit), so activating it the same turn it was set by Urgula's
   on-fusion-material trigger is fully legal. Rescind Known Caveat #8
   ("Rahu activation from set may be illegal").

3. **Swap Cartesia (95515789) out of the hand** — replace with a useless
   handtrap. Cartesia in the combo line comes from the **Deck** via
   Incredible Ecclesia's tribute (see #1) — it does NOT need to be in the
   opening hand. Suggested replacement: `14558127` Ash Blossom & Joyous
   Spring (present 3x in `branded-dracotail-bainbridge-2nd` main deck),
   dead on turn-1 own turn. Branded Fusion (44362883) also unused in this
   line but stays in hand (no need to swap — it remains dead without
   compromising future turns).

When the fixture JSON is updated, swap `95515789` → `14558127`.

## Hand

| CardId | Name | Type | Stats | Key Effect |
|---|---|---|---|---|
| 1498449 | Dracotail Faimena | Lv5 Spellcaster/EARTH | — | Main Phase (Quick): discard → Fusion Summon 1 Dragon/Spellcaster Fusion using hand/field. On fusion-material: set 1 Dracotail S/T. OPT each effect. **NOT USED this line** — kept in hand for T2. |
| 75003700 | Dracotail Lukias | Lv4 Spellcaster/LIGHT | — | On NS/SS: search 1 Dracotail monster (not self). On fusion-material: set 1 Dracotail S/T. OPT each. |
| 73819701 | Fallen of the White Dragon | Lv4 Dragon/LIGHT | — | Treated as "Fallen of Albaz". In hand: send 1 monster that mentions Fallen of Albaz from ED to GY; SS self, **also cannot SS from ED rest of turn except Lv8 Fusion/Synchro**. On NS/SS: SS 1 Ecclesia monster from hand/Deck/GY. OPT each. |
| 44362883 | Branded Fusion | Normal Spell | — | Fusion-summon a Fusion mentioning Fallen of Albaz from ED using hand/deck/field. Extra-deck-restricted to Fusion this turn. Once/turn. **NOT USED this line** (minimalist combo). |
| 95515789 | Blazing Cartesia, the Virtuous | Lv4 Spellcaster/LIGHT | — | If you control Fallen of Albaz or it's in your GY: SS this from hand. Main Phase (Quick): Fusion-summon 1 Lv8+ Fusion from ED using hand/field. OPT each. |

## Expected Endboard (per user-dictated line)

Superseded the 6-piece stored in `solver-validation-decks.json`. User's line
produces:

| Zone | CardId | Card | Position | How |
|---|---|---|---|---|
| MZONE | 33760966 | Dracotail Arthalion | attack | Fusion via Rahu Dracotail (Lukias hand + Mululu deck) |
| MZONE | 78397661 | Ecclesia and the Dark Dragon | attack | Synchro turn start, self-banish → returns End Phase |
| MZONE | 7375867 | Dracotail Mululu | face-up | Re-SS via Secreterion Dragon GY effect |
| MZONE | 89851827 | Secreterion Dragon | attack | Fusion via Cartesia (Urgula hand + Lukias field) |
| SZONE | 5431722 | Dracotail Flame | set | Set by Lukias or Urgula on-fusion-material trigger |
| SZONE | 69932023 | Dracotail Horn | set | Set by Mululu on-fusion-material trigger |
| SZONE | 30271097 | The Fallen & The Virtuous | set | Set by Albion the Branded Dragon End-Phase effect |
| HAND  | 1498449 | Dracotail Faimena | — | Never played, held for T2 |
| HAND  | 55273560 | Incredible Ecclesia, the Virtuous | — | Returns from GY at End Phase (Fusion-sent-to-GY clause) |
| HAND  | 73819701 | Fallen of the White Dragon | — | Returned from GY to hand by Arthalion on-fusion-summon |

Total: 4 MZONE + 3 SZONE + 3 HAND = **10 resources** surviving to opponent T2.

Discrepancies vs fixture `expectedBoard`:
- Fixture lists **Sting** set (80208225); user's line sets **The Fallen & The Virtuous** (30271097) instead via Albion End-Phase.
- Fixture has 1 MZONE (Arthalion + Ecclesia-Dark-Dragon + 3 S/T set + Faimena-in-hand); user's line has 4 MZONE + 3 S/T + 3 HAND.
- Fixture endboard must be rewritten once trace-assist confirms this line.

## Key Intermediates

| CardId | Name | Role |
|---|---|---|
| 87746184 | Albion the Branded Dragon | Lv8 Fusion Dragon/DARK. **Not Fusion Summoned here** — sent from ED to GY by Fallen of the White Dragon's hand-eff. End-Phase clause: "if in GY because sent there this turn: add to hand or Set 1 Branded S/T from Deck." Sets The Fallen & The Virtuous. |
| 55273560 | Incredible Ecclesia, the Virtuous | Lv4 Spellcaster/Tuner. SS'd by Fallen of the White Dragon's on-SS effect. Used as Synchro tuner for Ecclesia and the Dark Dragon. End-Phase: returns from GY to hand (Fusion-sent-to-GY clause). |
| 78397661 | Ecclesia and the Dark Dragon | Lv8 Synchro Dragon. 1 Tuner + 1+ non-Tuners. Quick: banish self until EP, SS 1 Fallen of Albaz or Lv4-or-lower monster that mentions it from **Deck or GY**. |
| 70871153 | Dracotail Urgula | Lv6 Dragon/EARTH. On fusion-material: set 1 Dracotail S/T + optionally destroy 1 S/T. GY-eff: place self on bottom of deck to add 1 Spellcaster Dracotail from GY to hand. OPT each. |
| 32548318 | Rahu Dracotail | Normal Spell. Fusion-summon 1 Dracotail from ED using hand/**deck**/field. ED-restricted to Fusions rest of turn after resolution. Once/turn. |
| 7375867 | Dracotail Mululu | Lv3 Dragon/WIND. Main Phase (Quick): Fusion-summon Dracotail Fusion from ED using hand/field (ED-restricted to Fusion rest of turn). On fusion-material: set 1 Dracotail S/T, then optionally negate 1 face-up opp monster. OPT each. |
| 89851827 | Secreterion Dragon | Lv8 Fusion Dragon/LIGHT. 1 Dragon + 1 Spellcaster. Target 1 Dragon + 1 Spellcaster in your GY; SS 1, place the other on bottom of Deck. OPT. |
| 30271097 | The Fallen & The Virtuous | Normal Trap. Treated as Branded & Dogmatika. Set by Albion End-Phase. |

## Critical Constraints

1. **Fallen of the White Dragon's ED-restriction** (step 1): "cannot SS from the
   Extra Deck for the rest of this turn, **except Level 8 Fusion or Synchro
   Monsters**." Every ED SS in this line (Ecclesia-Dark-Dragon Lv8 Synchro,
   Secreterion Lv8 Fusion, Arthalion Lv8 Fusion) respects this.

2. **Dark Dragon's banish-self effect targets Deck or GY only, NOT hand**
   (step 4 — critical user-line interpretation). Text: "banish this card
   (until the End Phase), and if you do, Special Summon 1 'Fallen of Albaz'
   or 1 Level 4 or lower monster that mentions it from **your Deck or GY**."
   Cartesia is in HAND at step 4 — she is **NOT** a valid target for Dark
   Dragon's effect. The mechanically-valid reading of the user's step 4 is:
   - Dark Dragon banishes itself AND SS's **Incredible Ecclesia** from GY
     (she is Lv4, mentions Fallen of Albaz: "Special Summon 1 'Swordsoul'
     monster or 1 'Fallen of Albaz' from your hand or Deck").
   - Cartesia separately SS's **herself** from hand via her own clause
     ("If you control Fallen of Albaz or it is in your GY" — Fallen of the
     White Dragon is in GY as Synchro material, and is always-treated-as
     Fallen of Albaz).
   - User likely conflated both summons into a single "spé cartesia" line.
   - This creates a problem: Incredible Ecclesia ends on the field, not GY,
     so her End-Phase return-to-hand clause (requires her in GY) won't fire
     unless she is later consumed. See caveat #1 below.

3. **Arthalion fusion materials** (step 9): "1 Dracotail monster + 1+
   monsters in the hand". At least one material MUST come from the hand.
   Rahu resolves with Lukias (from hand — returned by Urgula GY-eff at step 8)
   + Mululu (from deck). Lukias is the Dracotail; Lukias from hand satisfies
   "1+ monsters in the hand". ✓

4. **Rahu's post-resolution ED-lock**: "after this card resolves, you cannot
   Special Summon from the Extra Deck, except Fusion Monsters." Arthalion
   is Fusion ✓. Secreterion is Fusion ✓. All subsequent ED SS's are Fusions.

5. **Urgula GY-eff target clause** (step 8): "target 1 **Spellcaster**
   Dracotail monster in your GY; place this card on the bottom of your Deck,
   and if you do, add that monster to your hand." Lukias is Spellcaster
   (race code 2) ✓. Mululu is Dragon — NOT a valid target for Urgula's
   GY-eff. Faimena (Spellcaster, in hand) not in GY — also not a target.

6. **Secreterion Dragon's GY effect** (step 11): "target 1 Dragon and 1
   Spellcaster monster in **your GY**; Special Summon 1, and if you do,
   place the other on the bottom of the Deck." Mululu (Dragon, GY from
   step 9 Rahu fusion) + Lukias (Spellcaster, GY from step 9 Rahu fusion).
   SS Mululu; shuffle Lukias to deck. OPT.

7. **Albion's End-Phase clause** (step 12): "if this card is in the GY
   **because it was sent there this turn**: You can add to your hand or
   Set 1 'Branded' Spell/Trap **directly from your Deck**." Albion was sent
   from ED to GY at step 1 via Fallen of the White Dragon's hand-eff. ✓

8. **Incredible Ecclesia's End-Phase return-to-hand**: "During the End Phase,
   if a Fusion Monster(s) was sent to your GY this turn: You can add **this
   card from the GY** to your hand." Requires Ecclesia in GY at EP and at
   least one Fusion Monster sent to GY this turn. Albion (Lv8 Fusion) was
   sent to GY at step 1 ✓. But she must be IN GY at EP — see caveat #1.

9. **Cartesia Fusion** (step 6): "Fusion Summon 1 Level 8 or higher Fusion
   Monster from your Extra Deck, using monsters from your **hand or field**
   as material." Urgula from hand + Lukias from field = Secreterion (Lv8
   Dragon Fusion, materials: 1 Dragon + 1 Spellcaster → Urgula Dragon +
   Lukias Spellcaster ✓).

## Proposed Line (narrative)

Hand start: Faimena, Lukias, Fallen of the White Dragon, Branded Fusion,
Blazing Cartesia. Opponent: empty field (T1 turn player).

### Phase 1 — Albion mill + Dark-Dragon Synchro (steps 1-3)

1. **Fallen of the White Dragon hand-eff** (SELECT_IDLECMD → Fallen): send
   **Albion the Branded Dragon** (87746184) from ED to GY (mentions Fallen
   of Albaz); SS Fallen of the White Dragon (Lv4 Dragon/LIGHT) to own MZONE.
   **ED-lock engaged** (Lv8 Fusion/Synchro only rest of turn).

2. **Fallen of the White Dragon on-SS trigger**: SS 1 Ecclesia monster from
   hand/Deck/GY → pick **Incredible Ecclesia, the Virtuous** (55273560,
   Lv4 Spellcaster/Tuner) from Deck. She lands on MZONE.

3. **Synchro Summon Ecclesia and the Dark Dragon** (78397661, Lv8 Synchro):
   materials = Incredible Ecclesia (Tuner Lv4) + Fallen of the White Dragon
   (non-Tuner Lv4). Both → GY. Lv4+Lv4 = Lv8. Respects ED-lock (Lv8 Synchro
   allowed). Ecclesia and the Dark Dragon on own MZONE.

### Phase 2 — Dark Dragon banish-self + Cartesia SS (step 4)

4. **Ecclesia and the Dark Dragon Quick-eff**: banish self until End Phase,
   AND SS 1 Fallen of Albaz or Lv4-or-lower mentioning-it from Deck/GY.
   Target = **Incredible Ecclesia from GY** (Lv4, mentions Fallen of Albaz).
   Ecclesia back on MZONE. Dark Dragon → banished pile.

   Then **Blazing Cartesia SS herself from hand** (Fallen of the White
   Dragon is in GY, treated as Fallen of Albaz): SS Cartesia to MZONE.

   Post-state MZONE: Incredible Ecclesia (Lv4) + Cartesia (Lv4).
   Banished: Dark Dragon. GY: Fallen of the White Dragon, Albion.
   Hand: Faimena, Lukias, Branded Fusion.

   > **Caveat:** the user said "spé cartesia" as the target of Dark Dragon's
   > effect. Dark Dragon CANNOT SS from hand — so this is interpreted as
   > Dark Dragon SS'ing Incredible Ecclesia (from GY) + Cartesia SS'ing
   > herself. Both arrive on field. See Known Caveats for the downstream
   > implication on Incredible Ecclesia's EP return.

### Phase 3 — Lukias NS + Cartesia Fusion into Secreterion (steps 5-6)

5. **Normal Summon Dracotail Lukias** (75003700, Lv4 Spellcaster). On-NS
   trigger: search Dracotail monster from Deck → **Dracotail Urgula**
   (70871153) to hand.

6. **Blazing Cartesia Quick-eff Fusion**: materials = Urgula from hand +
   Lukias from field → Fusion Summon **Secreterion Dragon** (89851827, Lv8
   Fusion Dragon). Materials sent to GY. Secreterion on own MZONE.

   Post: MZONE = Incredible Ecclesia + Cartesia + Secreterion. GY: White
   Dragon, Albion, Urgula, Lukias.

### Phase 4 — Urgula/Lukias on-material triggers (step 7)

7. **Chain of 2 on-material triggers** (both Urgula & Lukias trigger when
   sent as Fusion material). SEGOC: active player orders both triggers on
   a single chain.
   - **Lukias on-fusion-material**: set 1 Dracotail S/T from Deck → **Flame**
     (5431722). Face-down SZONE.
   - **Urgula on-fusion-material**: set 1 Dracotail S/T from Deck → **Rahu
     Dracotail** (32548318). Face-down SZONE. Optional 2nd clause (destroy
     1 S/T on field) → **skip** (no opp target, no own target worth losing).

### Phase 5 — Urgula GY recycle Lukias to hand (step 8)

8. **Urgula GY-eff**: target **Lukias** (Spellcaster Dracotail in GY);
   place Urgula on bottom of Deck, add Lukias to hand. Urgula leaves GY →
   deck bottom. Lukias → hand.

### Phase 6 — Activate Rahu Dracotail → Arthalion Fusion (step 9)

9. **Activate Rahu Dracotail** (spell, set last turn-phase → activatable
   this same turn since it was set during MP this turn — verify in
   trace-assist; if illegal, user may need it activated from hand instead;
   but user dictated set then activate). Fusion Summon Dracotail from ED
   using hand/deck/field: materials = Lukias (hand) + Mululu (deck) →
   Arthalion (33760966, Lv8 Fusion Dragon). Lukias → GY. Mululu → GY.
   Arthalion on MZONE. Rahu → GY.

   **Arthalion materials check**: "1 Dracotail monster + 1+ monsters in
   the hand." Lukias is Dracotail ✓. Lukias from hand satisfies "1+ monsters
   in the hand" ✓.

   Rahu's ED-lock (Fusion only rest of turn) now in effect. Already
   respected since we're done with ED except End-Phase returns.

### Phase 7 — Arthalion + Mululu on-material chain (step 10)

10. **Chain of 2 triggers**:
    - **Arthalion on-Fusion-Summon**: target monsters on field/GY up to
      number of materials from hand. 1 material from hand (Lukias) = 1
      target. Target = **Fallen of the White Dragon (in GY)** → return to
      hand.
    - **Mululu on-fusion-material**: set 1 Dracotail S/T from Deck →
      **Horn** (69932023). Then optional 2nd clause (negate 1 face-up opp
      monster) → skip (no opp monsters).
    Chain order: both triggers at same time. User dictated Arthalion as C1,
    Mululu as C2; reverse order of resolution (Mululu's set fires first,
    then Arthalion's return-to-hand). End result same.

### Phase 8 — Secreterion GY-eff re-SS Mululu (step 11)

11. **Secreterion GY-eff**: target 1 Dragon + 1 Spellcaster in own GY.
    Dragon = **Mululu** (in GY from step 9). Spellcaster = **Lukias** (in
    GY from step 9). Choose to SS Mululu, shuffle Lukias to bottom of Deck.
    Mululu → MZONE. Lukias → deck bottom.

### Phase 9 — End Phase sequence (step 12)

12. **End Phase** simultaneous triggers:
    - **Albion the Branded Dragon EP-eff** (in GY because sent this turn):
      Set 1 Branded S/T from Deck → **The Fallen & The Virtuous** (30271097)
      to SZONE face-down. Albion stays in GY.
    - **Ecclesia and the Dark Dragon** return from banishment to MZONE
      (banish-until-End-Phase expires).
    - **Incredible Ecclesia EP-eff**: return from GY to hand IF she is in
      GY. See caveat #1 — requires her to have been consumed prior.

   Final MZONE: Arthalion + Secreterion + Mululu + Ecclesia and the Dark
   Dragon. Final SZONE: Flame + Horn + Fallen & Virtuous (all face-down).
   Hand: Faimena + Branded Fusion + Fallen of the White Dragon + maybe
   Incredible Ecclesia (if resolved).

## Known Caveats / Trace-Assist Risk Points

1. **Incredible Ecclesia's End-Phase return** — she must be in GY at EP for
   her EP-eff to return her to hand. In the line above, she is re-SS'd by
   Dark Dragon (step 4) and never consumed afterward → she remains on the
   field at EP and does NOT return to hand. **Resolution options**:
   (a) Use her as Synchro material earlier (but she's already used for
   Dark Dragon Synchro at step 3 and re-SS'd at step 4).
   (b) Tribute her Quick-eff (SS a Swordsoul monster or Fallen of Albaz
   from hand/Deck) — no Swordsoul in deck, and Fallen of the White Dragon
   is in GY not hand/deck. Not useful.
   (c) Use her as Fusion material for Secreterion at step 6 instead of
   Lukias (Ecclesia is Spellcaster Lv4 ✓) — but then Lukias stays on
   field, skipping Lukias's on-material set (loses Flame). Net: swap which
   Dracotail S/T is set.
   (d) Accept that the user's dictated endboard has Ecclesia on field at
   EP, NOT in hand. Revise the HAND expected endboard to drop her.
   **Recommended**: ask user during trace-assist — this is a genuine
   ambiguity in the dictated line.

2. **"spé cartesia" at step 4** — as noted in Critical Constraint #2, Dark
   Dragon cannot SS from hand, so Cartesia must SS herself. Trace-assist
   will show two separate prompt sequences: Dark Dragon's effect resolution
   (pick Incredible Ecclesia from GY) then Cartesia's optional hand SS.

3. **Step 7 chain ordering** (Urgula + Lukias simultaneous triggers): both
   are mandatory-optional on-fusion-material. SEGOC puts both on one chain;
   active player chooses link order. Both Set effects resolve. Watch the
   SELECT_CHAIN and SELECT_PLACE prompts to route correctly.

4. **Step 10 chain ordering** (Arthalion + Mululu simultaneous triggers):
   same pattern. Both optional on-SS/on-material. User dictated C1 =
   Arthalion, C2 = Mululu → Mululu resolves first, then Arthalion. This is
   preference-only; reverse order gives same end-state.

5. **SELECT_UNSELECT_CARD for Synchro materials** (step 3): Ecclesia and
   the Dark Dragon's Synchro Summon uses the multi-pick flow (1 Tuner +
   1+ non-Tuners). In recent solver work, SELECT_UNSELECT_CARD was
   identified as a risk for trajectory-replay drift. The solver's
   `exposeMultiPickMechanical` flag + iterative UnselectCard enumerator
   should handle this — but monitor during trace-assist.

6. **SELECT_CARD multi-pick** potential at step 9 (Rahu Fusion materials
   from hand+deck) — Rahu's text allows materials "from your hand, Deck,
   or field", and the pick is a multi-select. This may surface as
   SELECT_CARD with min=2,max=N and `exposeMultiPickMechanical` enumerator.

7. **Fusion-Monster ED counts** (step 9 Arthalion): the ED has 2x Arthalion
   + 1 each of Gulamel, Shaulas, Secreterion, Albion Branded, Mirrorjade,
   Albion Sanctifire, Lubellion, Alba-Lenatus, Rindbrumm, Dragon-that-
   Devours-Dogma, Khaos Starsource, Filia Regis, Ecclesia-Dark-Dragon.
   Secreterion and Albion Branded are already used. Arthalion (2x remaining)
   is the target. Pick the correct copy in trace-assist.

8. **Rahu activation from set** — user's step 9 says activate Rahu (which
   was set at step 7). Normal Spell set this turn cannot normally be
   activated this same turn (must wait to opponent's next turn). **Double-
   check this in trace-assist**: if illegal, the line needs Rahu activated
   from hand directly, which means Rahu can't also be set as an endboard
   piece. Current endboard has Rahu going to GY (used as spell), not set —
   so the "set then activate" at step 7/9 is for the trap-counter Flame +
   Horn placement and Rahu's set-phase is just how it entered. If Rahu
   must be activated from hand instead, swap step 7 Urgula's set target
   from Rahu to another trap (e.g., Sting 80208225) and activate Rahu
   from hand at step 9. **Needs trace-assist verification.**

## Quick-reference card ID table

| CardId | Name | Role |
|---|---|---|
| 1498449 | Dracotail Faimena | Hand → unused, kept for T2 |
| 75003700 | Dracotail Lukias | Hand → NS, fusion material, recycled to hand via Urgula GY |
| 73819701 | Fallen of the White Dragon | Hand → self-SS, Synchro material, returned to hand by Arthalion |
| 44362883 | Branded Fusion | Hand → unused (minimalist line) |
| 95515789 | Blazing Cartesia, the Virtuous | Hand → self-SS, Fusion catalyst (stays on field) |
| 87746184 | Albion the Branded Dragon | ED → GY (mill), EP sets Fallen & Virtuous |
| 55273560 | Incredible Ecclesia, the Virtuous | Deck → SS by White Dragon, Synchro material, re-SS by Dark Dragon |
| 78397661 | Ecclesia and the Dark Dragon | ED → Synchro, banished until EP, returns EP |
| 70871153 | Dracotail Urgula | Deck → Hand (Lukias NS search), Fusion material for Secreterion, GY-eff recycles Lukias |
| 32548318 | Rahu Dracotail | Deck → set by Urgula, activated at step 9 → GY |
| 7375867 | Dracotail Mululu | Deck → Fusion material for Arthalion, re-SS by Secreterion GY-eff |
| 89851827 | Secreterion Dragon | ED → Fusion via Cartesia, GY-eff re-SSes Mululu |
| 33760966 | Dracotail Arthalion | ED → Fusion via Rahu (Lukias+Mululu) |
| 5431722 | Dracotail Flame | Deck → set by Lukias on-fusion-material |
| 69932023 | Dracotail Horn | Deck → set by Mululu on-fusion-material |
| 30271097 | The Fallen & The Virtuous | Deck → set by Albion EP-eff |

## Action plan

Proceed to trace-assist. Expected steps: 40-60 (chain-heavy). Expected
undos: 5-15 (step 4 Dark-Dragon target ambiguity + step 9 Rahu-from-set
activation legality + step 7/10 chain ordering are the main drift risks).
Expected session time: 60-90 minutes. User should clarify the Incredible
Ecclesia EP-return intent early (caveat #1) before committing downstream
SELECT_CARD picks.
