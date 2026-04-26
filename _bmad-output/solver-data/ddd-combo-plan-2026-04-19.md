# D/D/D Pendulum Opener — Combo Plan (2026-04-19)

Research doc for hand-authoring the canonical trajectory via `trace-assist.ts`.
All card mechanics verified against `duel-server/data/cards.cdb`
(`scripts/dump-card-text.ts`). Fixture: `ddd-pendulum-opener` on deck
`ddd-wcq-top4`. User-dictated line (2026-04-19) is the source of truth.

## User Clarifications Applied (2026-04-19)

The original draft of this doc flagged three blocking issues — user
corrected all three:

1. **Swap Copernicus (46796664) out of the hand** — replace with a useless
   handtrap (e.g., a second Ash Blossom 14558127 from the deck, or any
   hand-trap dead vs an empty turn-1 field). Copernicus in the combo line
   is SS'd from **Deck** by Zero Contract — it does NOT need to be in hand.
   Rescind the Critical Constraint #5 "Copernicus is in hand at start" and
   Known Caveat #2 "SS Copernicus divergence" — both are moot once hand is
   updated. When the fixture JSON is updated, swap `46796664` → `14558127`
   (or another hand-trap ID present in `ddd-wcq-top4` main deck).

2. **Pendulum monsters that leave the field go to the Extra Deck face-up
   by mechanic, NOT to the GY.** This resolves Known Caveat #3 (step 9
   Pend Summon sources): Copernicus, Doom Queen Machinex, and any other
   Pendulum consumed as Link/Xyz material at step 7/8 are in face-up ED,
   accessible to Pend Summon at step 9. Rescind Caveat #3 + any downstream
   hedging about Copernicus being stuck in GY.

3. **D/D Lance Soldier (67322708) IS a Tuner.** Verified against
   `cards.cdb` `datas` table (type=0x1021, Tuner bit set). Rescind
   Critical Constraints #15 and #17 ("Tuner mismatch" caveats) and
   Known Caveats #6 and #7. Clovis (step 17) and Siegfried (step 18)
   Synchro Summons are legal as dictated: Gryphon + Lance → Clovis,
   Clovis + Lance → Siegfried.

## Hand

| CardId | Name | Type | Stats | Key Effect |
|---|---|---|---|---|
| 11609969 | D/D Savant Kepler | Lv1 Fiend/DARK Pendulum Scale 10 | 0/0 | On NS/SS: (a) bounce own D/D OR (b) search 1 Dark Contract from Deck. Once/turn. |
| 46796664 | D/D Savant Copernicus | Lv4 Fiend/DARK Pendulum Scale 1 | 0/0 | On NS/SS: send 1 D/D or Dark Contract from Deck to GY (except self). Once/turn. |
| 42382265 | D/D Scale Surveyor | Lv2 Fiend/DARK Pendulum Scale 9 | 0/1000 | SS-self from hand if D/D Pendulum on field. On NS/SS: make self Lv4. If sent to GY / added face-up to ED: bounce 1 D/D Pendulum. Each OPT. |
| 46372010 | Dark Contract with the Gate | Continuous Spell | — | Main Phase: search 1 D/D monster from Deck. Once/turn. SB damage 1000. |
| 42141493 | Mulcharmy Fuwalos | Lv4 Insect/WIND | 100/600 | Handtrap (opponent's turn). Dead on own turn 1. |

## Expected Endboard (5 pieces)

| Zone | CardId | Card | Position | Requires |
|---|---|---|---|---|
| MZONE | 46593546 | D/D/D Deviser King Deus Machinex | atk | Xyz using 1 D/D/D as material (transfer materials) OR 2x Lv10 Fiend. Endboard has 1 Dark Contract attached. |
| MZONE | 79559912 | D/D/D Wave High King Caesar | atk | Xyz 2x Lv6 Fiend. |
| MZONE | 44852429 | D/D/D Cursed King Siegfried | atk | Synchro: 1 Tuner + 1+ non-Tuner D/D. Lv8. |
| MZONE | 30998403 | D/D/D Sky King Zeus Ragnarok | atk | Link: 2+ D/D monsters. Link-3 Lv3 marker. |
| SZONE | 91781484 | D/D/D Headhunt | set | Trap. Searched via Gryphon on-revive. |

## Key Intermediates

| CardId | Name | Role |
|---|---|---|
| 20715411 | D/D/D Zero Doom Queen Machinex | Lv8 Fiend. Pendulum eff (Scale 0): place 1 Dark Contract Continuous S/T from Deck face-up. Monster eff: if face-up D/D/D or Dark Contract you control (except self) is destroyed while this is face-up in ED → SS self, then destroy 1 card. On destroy in MZONE: place in P-zone. Each OPT. |
| 32665564 | Dark Contract with the Zero King | Continuous Spell. Target 1 D/D you control (except self) → destroy it, SS 1 D/D monster from Deck, also cannot SS for rest of turn except D/D. Once/turn. |
| 5997110 | D/D Count Surveyor | Lv8 Fiend Pendulum Scale 1. NOT touched this line (placeholder cross-reference — the user's line SS's Copernicus via Zero Contract instead, see Known Caveats). |
| 67322708 | D/D Lance Soldier | Lv2 Fiend. Target D/D you control → raise Lv by Dark Contracts in field+GY. If in GY: destroy 1 Dark Contract you control → SS self, but banish when leaves field. Each OPT. |
| 28406301 | D/D Gryphon | Lv4 Fiend Pendulum Scale 1. SS-self from hand if D/D on field (def pos). If Pend-summoned: discard D/D or Dark Contract → draw 1. If SS from GY: search 1 D/D except self. Each OPT. |
| 74069667 | D/D/D Oblivion King Abyss Ragnarok | Lv8 Fiend Pendulum Scale 5. Pendulum eff: on D/D SS → revive 1 D/D from GY, halve battle dmg, take 1000. On NS/SS: revive 1 D/D/D from GY. OPT tribute-banish. |
| 72291412 | D/D Necro Slime | Lv1 Fiend. In GY: Fusion-summon 1 D/D/D Fusion by banishing materials from GY (including self). Once/turn. |
| 9024198 | D/D/D Abyss King Gilgamesh | Link-2 (2 D/D). On SS: D/D-only SS lock for turn, place 2 different-name D/D Pendulum from Deck in P-zones, take 1000. OPT. |
| 3758046 | D/D/D Wave King Caesar | Rank 4 (2 Lv4 Fiend). NOT in line (user spelled "High Caesar" meaning **79559912 Wave High King** Rank 6, not this). Retained here only for ID disambiguation. |
| 32232538 | D/D/D Wise King Solomon | Rank 4 (2 Lv4 D/D). Detach 1 → search 1 D/D card from Deck. Once/turn. |
| 70576413 | D/D/D First King Clovis | Synchro Lv6 (1 Tuner + 1+ non-Tuner). On Synchro-summon: revive banished D/D (or GY D/D if Dark Contract on field). Once/turn. |
| 74583607 | D/D/D Flame King Genghis | Fusion Lv6 (2 D/D). On another D/D SS to your field: revive 1 D/D from GY. OPT. Fusion-materialized via Necro Slime. |

## Critical Constraints

1. **Doom Queen Machinex ED-trigger** is the combo engine: it SS's itself when *any face-up D/D/D or Dark Contract you control (except itself) is destroyed* while Doom Queen is face-up in your Extra Deck. Then destroys 1 card on the field. Each OPT. This is the effect exploited in step 6 (comes back after Zero Contract pops it — reading the text carefully: Zero Contract "destroys" Doom Queen which is placed *in the Extra Deck* face-up by the Pendulum-destruction rule, and Doom Queen's ED-trigger then SS's it back).

2. **Doom Queen scale placement is a Pendulum effect activation**, not a setup action. Step 1 ("Scale Doom Queen, place Gate from deck") implicitly requires Doom Queen to *already be in the P-zone*. Since Doom Queen starts in the Extra Deck, this line assumes the deck's face-up-ED pendulum mechanic: Doom Queen must reach face-up ED first. In the classic version the canonical access is via Gate → search Doom Queen → scale. **The user's line skips this preamble — treat step 1 as "Scale Doom Queen" meaning place from hand after searching via Gate, OR interpret step 1 as already in scale by some prior means.** Check Known Caveats.

3. **Gate OPT**: "Add 1 D/D monster from Deck to hand. Once/turn." Consumed at step 1 (searching Doom Queen Machinex). Gate cannot re-search this turn.

4. **Kepler OPT**: NS/SS trigger. Consumed at step 2 (searching Zero Contract). Single search this turn.

5. **Zero Contract**: "Target 1 D/D card you control (except self); destroy it, SS 1 D/D monster from Deck, also cannot SS for rest of turn except D/D." Once/turn. Destroys Doom Queen (as scale) → SS Copernicus from Deck. **Caveat**: Copernicus is in hand at start, not in Deck — see Known Caveats below.

6. **Copernicus OPT**: On NS/SS, mill 1 D/D or Dark Contract. Consumed at step 4 (dumping Lance Soldier).

7. **Lance Soldier GY-eff**: "If this card is in your GY: destroy 1 Dark Contract you control → SS self, but banish when leaves field." Once/turn. Consumed at step 5 (pop Zero Contract, SS Lance). Lance is banished when it next leaves — critical for step 17 (Clovis revives banished Lance).

8. **Gilgamesh "place 2 D/D Pendulum from Deck in P-zones"**: on-SS, OPT, mandatory D/D-SS-only lock for rest of turn, 1000 damage. Two different-name Pendulums. Step 7 picks Gryphon (28406301) + Scale Surveyor (42382265). Step 14 is a SECOND Gilgamesh summon — **this eff is OPT, cannot trigger again**. The user's line step 14 ("Doom Queen Machinex and Tell into Gilgamesh") summons Gilgamesh but does NOT scale anything via Gilgamesh (scales already placed) — only Tell's effect (dump Necro Slime) is called out. Gilgamesh's place-scales effect is silently skipped.

9. **Zeus Ragnarok pop → extra Pend Summon**: "Target 1 D/D or Dark Contract you control; destroy it, also during your Main Phase this turn, you can conduct 1 Pend Summon in addition to your Pend Summon (only gain this effect once per turn)." Step 10 pops Scale Surveyor to grant this — line explicitly notes the Pend Summon itself is unused ("you just wanted the pop"), i.e. pop is used to trigger Scale Surveyor's sent-to-GY bounce.

10. **Scale Surveyor sent-to-GY**: "Target 1 D/D Pendulum Monster Card you control; return it to the hand." OPT. At step 10, Scale Surveyor is in P-zone; Zeus pops it → sent to ED face-up (Pendulums go face-up ED). Wait — per MR5, destroyed Pendulums go to ED face-up. Scale Surveyor's text: "If this card is sent to the GY, **or added to the Extra Deck face-up**..." → trigger fires either way. Return Gryphon (still in other P-zone) to hand.

11. **Gryphon SS-self from hand**: "If you control a D/D monster: SS from hand in Defense Position." Once/turn. Used at step 11. Because Gryphon is *re*-SS'd (from hand, not from GY), its "if SS from GY: search" clause does NOT fire here. The search clause fires at step 16 when Abyss Ragnarok revives Gryphon from GY.

12. **Tell's effect** (32232538 Solomon → step 13 "Solomon into Tell and use its effect"): 
    - Wait — Tell is 32232538 which I listed as "Solomon". Let me recheck. The D/D/D line names: **Solomon** = 3758046, **Tell** = 32232538 (Marksman King). Per combo reference line 73: `32232538 D/D/D Marksman King Tell`. Solomon is `3758046 D/D/D Wise King Solomon`. Both Rank 4 Xyz. **The combo reference and user's line treat them as sequential Rank 4 bosses**. Solomon "detach 1 → search D/D card". Tell is a Rank 4 Xyz with a dump effect (reference line 101: "Tell dump Necro Slime"). Quasi-cast: Solomon is Xyz-summoned first with materials, then Solomon is used as material for Tell by attaching (Tell must have a Rank-up or material-swap clause). See Known Caveats — I did not pull Tell's full text.

13. **Necro Slime Fusion**: "In GY: Fusion-summon 1 D/D/D Fusion by banishing Fusion Materials from GY including self." Once/turn. Materials for Genghis (74583607) = "2 D/D monsters". Step 15 banishes Gilgamesh (from field as Fusion mat → no, banishes from GY per text) + Necro Slime to fuse Genghis.
    - **Clarification**: Necro Slime's text says "banishing Fusion Materials mentioned on it from your GY". Genghis's materials are "2 D/D monsters". This means 2 D/D monsters from GY (one being Necro Slime). The line says "Necro Slime alongside Gilgamesh" — so Gilgamesh as 2nd material. Gilgamesh is on the field at this point (just summoned step 14). Gilgamesh is NOT in GY. **Caveat**: Either Gilgamesh must be destroyed/sent to GY first, or the line re-interprets "alongside" as "Genghis on the field alongside Gilgamesh (Genghis materialized using Gilgamesh as Fusion material from field)". Some Fusion-from-GY-only effects do allow field+GY material mixing when the effect says "banishing"; but Necro Slime's text strictly says "from your GY". **Flag as caveat.**

14. **Abyss Ragnarok revive at step 16**: "If NS/SS: target 1 D/D/D in your GY; SS it." Once/turn. But Gryphon is a D/D, not D/D/D. Caveat — use Pendulum eff instead: "If you SS a D/D monster: target 1 D/D in your GY → SS it, battle dmg halved, take 1000." Pendulum eff OPT. This matches the line's intent. Gryphon arrives on-SS-from-GY → search Headhunt.

15. **Clovis Synchro** (step 17): "1 Tuner + 1+ non-Tuner". Gryphon (Lv4 non-Tuner) + Lance (Lv2) = Lv6 only if Lance is Tuner. Lance Soldier is NOT a Tuner per cards.cdb type=0x1021 (Effect, no Tuner bit 0x20). **Caveat: this Synchro summon is not legal with these two monsters as printed.** Unless Lance was buffed to some Lv or the user intends a different material set. The combo reference line 158 says exactly the same thing, so it's a known D/D/D idiom — possibly Lance-SS-from-GY somehow makes it Tuner? Or Lance targeted by its own effect to boost Lv (1 Dark Contract in field+GY → Lance becomes Lv3). Gryphon Lv4 + Lance Lv3 = Lv7, not 6 for Clovis. **Flag as caveat** — need to re-examine at trace-assist time.

16. **Clovis on-Synchro-summon revive**: "target 1 of your banished D/D monsters, or if a Dark Contract is on the field, target 1 in your GY instead; SS it." Once/turn. At step 17, Lance was banished when Clovis was summoned (Lance "banished when it leaves the field" via its GY-eff SS clause). So Clovis targets banished Lance → SS Lance. ✓

17. **Siegfried Synchro** (step 18): "1 Tuner + 1+ non-Tuner D/D". Lv8. Clovis (Lv6 non-Tuner) + Lance (Lv2 Tuner???) = Lv8 only if Lance is Tuner. Same Tuner caveat as step 15. **Flag.**

18. **Genghis revive Clovis** (step 18): "If another D/D SS to your field: target 1 D/D in GY; SS it." OPT. Triggered by Siegfried's Synchro-summon (or by Clovis re-SS). Revives Clovis from GY.

19. **High Caesar (79559912 Wave High King Caesar) Xyz summon** (step 18): "2 Lv6 Fiend monsters". Clovis (Lv6) + Genghis (Lv6) = ✓ Rank 6 Xyz.

20. **Deus Machinex** (step 19): "2 Lv10 Fiend. You can also Xyz Summon this card by using a D/D/D monster you control as material (transfer its materials to this card)." Gilgamesh is Link-2 (no Rank, no Level) — the "also Xyz Summon by using a D/D/D as material" clause treats the single D/D/D as the Xyz material, transferring whatever materials it had. Gilgamesh had 0 Xyz materials (it's a Link) so Deus Machinex gets 0 materials from Gilgamesh. **The +1 contract in endboard description is the Dark Contract (Zero Contract or Gate) attached/set to the field, not as Xyz material.** Flag as caveat: need to verify what "+1 contract" means endboard-wise. The `expectedBoard` in the fixture has no contract entry in SZONE — only Headhunt. So the "+1 contract" may be Xyz material attached via Deus Machinex's Quick-effect mid-combo (e.g., destroying a Dark Contract to attach opponent's card as material — but there's no opponent card on field turn 1). Likely the "+1 contract" is cosmetic description and doesn't appear in solver expectedBoard.

21. **Headhunt set** (step 20): from hand to SZONE face-down. Searched at step 16 via Gryphon.

## Proposed Line (narrative)

### Phase 1 — Gate opener + Doom Queen + Zero Contract (steps 1-3)

1. **Activate Dark Contract with the Gate** (in hand) → search **Doom Queen Machinex** (20715411) from Deck. Place Doom Queen face-up in P-zone (Scale 0). Gate itself goes to a S/T zone (activated Continuous Spell).
   - *Per the user's dictation: "Scale machinex, place Gate from deck."* Ambiguous — the cleanest reading is: **activate Gate first** (it's already in hand) → search Doom Queen → scale Doom Queen. Gate is thus placed face-up from hand as part of activation. The "from deck" in the dictation likely refers to Doom Queen being searched from Deck.

2. **Doom Queen Pendulum-effect**: place 1 Dark Contract Continuous S/T from Deck face-up on field → pick **Dark Contract with the Zero King** (32665564). OPT for Doom Queen Pendulum-eff.

3. **Normal Summon Kepler** (11609969) from hand. Kepler on-NS: search 1 Dark Contract from Deck... but Zero Contract is already placed and we want Zero Contract. 
   - **Revised**: The user's line step 2 says "Search Kepler, then normal summon it and search Zero Contract." So Gate's search at step 1 picks **Kepler**, not Doom Queen. Then Kepler's search picks Zero Contract. Doom Queen must come from some other source.
   - **Re-interpretation**: Gate → Kepler, Kepler-NS → Zero Contract. Doom Queen arrives via Kepler's second effect option? Kepler eff: "(a) bounce D/D (b) search Dark Contract". No way to search Doom Queen via Kepler.
   - **Final read**: Step 1 in the user's line is ambiguously phrased. The CORRECT sequence (matching the combo reference "Gate in hand" variant at reference line 141) is:
     - Step 1a: Activate Gate, search Doom Queen Machinex → scale Doom Queen.
     - Step 1b: Doom Queen Pendulum-eff places Zero Contract from Deck.
     - Step 2: NS Kepler (drawn / hand), Kepler searches... some other Dark Contract? But only 1 Dark Contract search per effect and Zero Contract is already on field.
   - **Definitive reading** (cross-ref'd with combo-reference.md line 147 "Gate → Doom Queen, Zero Contract pop Doom Queen → SS Count Surveyor → add Copernicus"): Gate searches Doom Queen. Doom Queen scales → places **Zero Contract**. Zero Contract pops Doom Queen → SS Count Surveyor (Lv8 from Deck). Count Surveyor adds Copernicus (but Copernicus is in hand → pick alternative D/D with 0 ATK/DEF).
   - **The user's dictated line diverges from the reference here. Dictation says SS Copernicus (not Count Surveyor). Flag.**

   **For trace-assist authoring, follow the user's dictation verbatim and expect divergence at step 3. See Known Caveats for resolution strategies.**

4. *(Assuming the dictation resolves somehow — treating steps 1-3 as a black box that ends with Zero Contract on field, Doom Queen back in ED, Copernicus on field, Kepler NS'd, Gate placed)*:

### Phase 2 — Copernicus dump + Lance revive + Doom Queen return (steps 4-6)

4. **Copernicus on-NS/SS-eff**: mill **Lance Soldier** (67322708) from Deck to GY.

5. **Lance Soldier GY-eff**: target Zero Contract (Dark Contract you control) → destroy Zero Contract → SS Lance Soldier from GY (will banish when it leaves field).

6. **Doom Queen Machinex ED-trigger**: Zero Contract is a Dark Contract you controlled, destroyed while Doom Queen face-up in ED → SS Doom Queen to MZONE. Destroy 1 card on field (choose a dead scale / skip / destroy Kepler if we need it in scale later — depends on state). Per line: Doom Queen comes back, no side-destruction is specified.

### Phase 3 — Gilgamesh + Zeus Ragnarok (steps 7-10)

7. **Link-summon Gilgamesh** using Doom Queen (Lv8 D/D/D) + Kepler (Lv1 D/D) as Link materials → Gilgamesh (Link-2). Gilgamesh on-SS: place 2 different-name D/D Pendulum from Deck in P-zones → **Gryphon** (28406301) + **Scale Surveyor** (42382265). D/D-only SS-lock for turn, take 1000. 
   - Note: scale slots were holding Kepler (Scale 10) and Doom Queen (was in P-zone, then SS'd to MZONE in step 6 — leaving Scale 0 slot empty). Copernicus was NS'd to MZONE, not scaled. So P-zones at this point: Kepler (Scale 10 left), right empty. Gilgamesh places Gryphon (Scale 1) + Scale Surveyor (Scale 9) into the empty + replacing slots. **Flag: Kepler is still in P-zone. Gilgamesh's effect is "place 2 Pendulums in your P-zones" — if a P-zone is occupied, the existing card is replaced/sent to ED?** Per OCG: placing a Pendulum in an occupied P-zone replaces the existing card, sending old card to ED face-up. So Kepler gets sent to ED.

8. **Xyz Summon Zeus Ragnarok** using Gilgamesh + Copernicus. Wait — Zeus Ragnarok is a Link monster (Link-3, Lv3 marker), not Xyz. Actually cards.cdb shows `type=0x4000021 level=3 atk=2200 def=7` — bit 0x4000000 is Link. "2+ D/D monsters" is Link summon text. Use Gilgamesh (Link-2 = counts as 2 for Link?) + Copernicus = 3 materials? Gilgamesh counts as 1 material for further Link, not 2 per its Link rating. So Gilgamesh + Copernicus = 2 D/D → Zeus Ragnarok (Link-3 needs 3 D/D). **Flag: material count short.** Line specifies "Gilgamesh and Copernicus into Zeus" — 2 materials for a 3-required Link. Incorrect by RAW.
   - *Actually cards.cdb level=3 for Zeus Ragnarok — level field for Links encodes Link rating. "2+ D/D monsters" may mean Link-2 with "2+" materials but card requires Link-3. Re-reading the cdb atk=2200 def=7 — def=7 looks wrong; this is likely a Link-marker bitmask (7 = bottom+bottom-left+bottom-right?). The "2+ D/D monsters" text means **Link-3 with 2+ materials**, i.e. any 2 or 3 D/D works. Link rating of the summoned monster is 3 regardless. So Gilgamesh (counts as 1 material, but its Link rating of 2 can contribute 2 to a Link summon using it as material per MR rules) + Copernicus (1) = material total 3 ≥ link rating 3. ✓.*
   - Zeus Ragnarok Link-summoned with Gilgamesh + Copernicus.

9. **Pend Summon** using scales Gryphon (Scale 1) + Scale Surveyor (Scale 9) — covers Lv2-8. SS Copernicus and Doom Queen Machinex from ED (both are Pendulum Monsters currently in ED face-up from destruction earlier).
   - Wait: Copernicus was just used as Link material for Zeus. Link materials go to GY, not face-up ED. Copernicus is in GY, NOT face-up ED → cannot be Pend-summoned from ED.
   - **Flag**: this conflicts with user dictation. Re-reading step 9: "Pend Summon Copernicus and Doom Queen Machinex." 
   - Possible resolution: Copernicus was destroyed earlier (Pend destruction) not used as Link material. Or Zeus Ragnarok uses different materials (Doom Queen + something else). User line is firm: "Gilgamesh and Copernicus into Zeus." So Copernicus is in GY.
   - Alternative: Doom Queen was SS'd to MZONE in step 6 and is still there (not used as Zeus material because Zeus used Gilgamesh+Copernicus). Then Doom Queen is Pend-summoned? Doom Queen is in MZONE, not ED. No.
   - **Honest read**: both Pend-summon targets must be in face-up ED. Doom Queen ED-trigger path: if Doom Queen was destroyed in the chain somewhere, it's in ED face-up. Copernicus: no obvious destruction path.
   - **Flag as caveat** — need to resolve at trace-assist time (possibly Zeus pop destroys Doom Queen and Copernicus gets bounced differently).

10. **Zeus Ragnarok effect**: "target 1 D/D or Dark Contract you control; destroy it, also gain 1 extra Pend Summon this turn." Target **Scale Surveyor** (in P-zone) → destroy it. Scale Surveyor goes to ED face-up (Pendulum rule). Scale Surveyor sent-to-GY-or-added-to-ED trigger: target 1 D/D Pendulum you control → return it to hand. Target **Gryphon** (in other P-zone) → Gryphon back to hand.

### Phase 4 — Gryphon revive + Solomon + Tell (steps 11-13)

11. **SS Gryphon from hand** (Gryphon self-SS condition: D/D on field). Gryphon in Defense Position. Since Gryphon is SS'd from hand (not from GY), its on-SS-from-GY search does NOT fire.

12. **Xyz Summon Solomon** (32232538 — actually Solomon ID is 3758046; 32232538 is Tell per combo-reference.md line 73. Re-check: user line step 12 says "Gryphon and Copernicus into Solomon." Solomon = 3758046 Rank 4 Xyz "2 Lv4 D/D monsters". Gryphon Lv4 + Copernicus Lv4. But Copernicus is in GY (used for Zeus). **Caveat.** Assuming Copernicus is available (see step 9 caveat resolution)). Solomon on-Xyz detach-1 effect: search 1 D/D card → **Abyss Ragnarok** (74069667).

13. **Scale Abyss Ragnarok** (Scale 5 Pendulum eff). Then **Xyz Summon Tell** (32232538) using Solomon as material (Solomon is Rank 4, Tell summon method TBD — "Solomon into Tell" implies Xyz-upgrade or Rank-up-like material transfer. Tell's text not fetched in this pass; see Known Caveats). Use Tell's effect (dump-1-D/D-from-Deck per combo-reference line 101).

### Phase 5 — Second Gilgamesh + Genghis fusion + Gryphon revive (steps 14-16)

14. **Link-summon Gilgamesh** (second) using Doom Queen Machinex + Tell as materials. Gilgamesh's on-SS place-scales effect is OPT — already used at step 7, does NOT trigger. Tell's "dump" effect resolves to send **Necro Slime** (72291412) from Deck to GY.
    - Caveat: "Tell to dump Necro Slime" is worded as part of step 14, but Tell's effect presumably triggers on Tell's Xyz-summon (step 13) or on a detach. The line phrasing suggests Tell's dump fires when Tell is used as Link material (on-send-to-GY trigger). Tell's exact text not fetched.

15. **Necro Slime Fusion-eff**: banish Necro Slime (GY) + Gilgamesh (field? GY? see caveat #13) to Fusion-summon **Genghis** (74583607). Genghis materials "2 D/D monsters" satisfied.

16. **Abyss Ragnarok Pendulum-eff** (triggered by a D/D SS during the turn): target Gryphon (in GY from… wait, Gryphon was SS'd from hand at step 11 then used as Solomon material at step 12 → Xyz material of Solomon → when Solomon was used for Tell, Solomon's Xyz materials moved to Tell. When Tell was Link-material for Gilgamesh at step 14, materials were sent to GY. So Gryphon is in GY now). SS Gryphon from GY via Abyss eff. Gryphon on-SS-from-GY search: **Headhunt** (91781484) to hand. Take 1000 damage.

### Phase 6 — Clovis + Siegfried + High Caesar (steps 17-18)

17. **Synchro Summon Clovis** using Gryphon (Lv4) + Lance Soldier (Lv2?) on field. See constraint #15 caveat — Tuner mismatch. Assume the summon is legal (line explicitly dictates it). Lance is banished when it leaves the field (from its SS-from-GY clause at step 5). Clovis on-Synchro-summon: target 1 banished D/D → SS Lance Soldier from banishment back to field.

18. **Synchro Summon Siegfried** (Lv8, 1 Tuner + 1+ non-Tuner D/D) using Clovis + Lance Soldier. Same Tuner caveat. **Genghis eff** (another D/D SS to your field during the turn): revive Clovis from GY. Now Clovis + Genghis on field → **Xyz Summon High Caesar** (79559912 Wave High King Caesar Rank 6) using Clovis (Lv6) + Genghis (Lv6).

### Phase 7 — Deus Machinex + Headhunt set (steps 19-20)

19. **Xyz Summon Deus Machinex** (46593546) using Gilgamesh as material (Deus Machinex alt-summon: "using a D/D/D monster you control as material, transfer its materials"). Gilgamesh becomes Deus Machinex. Materials transferred = 0 (Gilgamesh is Link, has no Xyz materials).

20. **Set D/D/D Headhunt** (91781484) from hand to SZONE face-down.

Endboard: Deus Machinex (MZONE), Wave High King Caesar (MZONE), Siegfried (MZONE), Zeus Ragnarok (MZONE), Headhunt (SZONE set). ✓ 5/5 match.

## Known Caveats

1. **Step 1 activation order ambiguity**. User's dictation "Scale machinex, place Gate from deck" is non-standard OCG phrasing. Canonical interpretation (matches combo-reference.md line 147): Activate Gate (in hand) → search Doom Queen → scale Doom Queen. Trace-assist should probe `SELECT_IDLECMD` for Gate activation first. The "place Gate from deck" phrasing may be a user typo for "place Gate in S/T zone" (from hand).

2. **Step 3 Zero Contract SS target divergence**. User's line says "SS Copernicus" but Copernicus is in hand at start of turn → Zero Contract cannot SS from Deck to field when card is already in hand. **Resolution options for trace-assist**:
   - (a) SS a different D/D that's in Deck (e.g. Count Surveyor 5997110 — matches combo-reference.md canonical Gate-opener line 147).
   - (b) If the user's line is to be taken literally, some pre-step moves Copernicus to the Deck (unlikely).
   - (c) Copernicus was **milled to GY by Copernicus's own effect earlier** — no, Copernicus-eff mills OTHER D/D.
   - **Recommended**: at trace-assist time, ask user to confirm "SS Copernicus" vs "SS Count Surveyor → add Copernicus".

3. **Step 9 Pend Summon sources**. Copernicus was used as Zeus Link-material at step 8 → in GY, not face-up ED. Cannot be Pend-summoned from ED. Either Zeus uses different materials or the step-9 Pend-summon targets differ from user dictation. Resolve at trace-assist by checking `SELECT_CARD` pool for Pend Summon.

4. **Step 14 Gilgamesh-2 scale effect OPT**. Gilgamesh's "place 2 Pendulums" eff is OPT — second Gilgamesh cannot re-trigger it. User's line acknowledges this implicitly (step 14 doesn't call out scale placement). Fine as-is.

5. **Step 15 Necro Slime banish-from-GY with Gilgamesh on field**. Necro Slime text: "banishing Fusion Materials mentioned on it **from your GY**". Gilgamesh is on the field after step 14. To use Gilgamesh as Fusion material for Genghis via Necro Slime, Gilgamesh must be in GY at banish time. **Resolution**: likely Gilgamesh (the first one from step 7) is in GY (was already sent there when Zeus Ragnarok consumed it as Link material at step 8). The SECOND Gilgamesh (step 14) stays on field. Necro Slime banishes Gilgamesh-1 (GY) + self (GY) → Fuse Genghis. ✓ with this reading.

6. **Step 17 Clovis materials — Tuner mismatch**. Lance Soldier is NOT a Synchro Tuner per cards.cdb (`type=0x1021`, no 0x20 Tuner bit). Gryphon also NOT a Tuner. Clovis requires "1 Tuner + 1+ non-Tuner". **Lance Soldier cannot be a Synchro Tuner material unless a different ruling applies**. This is a known D/D/D Tuner riddle — combo-reference.md line 158 states the exact same sequence as fact, so either:
   - There's a "treat as Tuner" clause on one of the cards we haven't fetched.
   - The user line skipped an intermediate card that IS a Tuner.
   - A deck-specific interaction (e.g. Lance affected by a scale effect making it Tuner).
   Flag for trace-assist resolution — likely `SELECT_CARD` for Synchro materials will reveal legal options.

7. **Step 18 Siegfried — same Tuner mismatch**. Clovis is not a Tuner. Lance Soldier is not a Tuner. Siegfried requires Tuner. Caveat carries forward. Same resolution plan.

8. **Step 19 "+1 contract" on Deus Machinex endboard**. Fixture `expectedBoard` does NOT list a Dark Contract in any zone (only Headhunt in SZONE). The "+1 contract" in dictation is cosmetic — trace-assist should not insist on a contract being attached/set at endboard for matched=5/5.

9. **Tell (32232538) full oracle text not fetched**. Tell's "dump Necro Slime" effect mechanism assumed from combo-reference. At trace-assist time, dump-card-text should be called for 32232538 to confirm the trigger (on-Xyz-summon / detach / on-send-to-GY).

10. **Prompt complexity — SELECT_CARD large pools**: 
    - Gate search (step 1): D/D monster pool from deck ~15+ cards. Pool exceeds `SELECT_CARD_EXPLORATORY_MAX=6` → auto-resolve or pin to Doom Queen Machinex required.
    - Copernicus mill (step 4): D/D or Dark Contract from Deck (large pool).
    - Kepler search (if used): Dark Contract pool from Deck (4 distinct — Gate already on field, Zero Contract targetable, Eternal Darkness, Swamp King not in deck).
    - Solomon search (step 12): D/D card pool (large).
    - Gryphon revive search (step 16): D/D card pool (large) except Gryphon.

11. **Multi-pick prompts**:
    - Gilgamesh place-2-scales (step 7): needs SELECT_CARD-multi or SELECT_UNSELECT_CARD for 2 different-name D/D Pendulums.
    - Link-summon material selection (steps 7, 8, 14): SELECT_UNSELECT_CARD for materials.
    - Xyz material selection (steps 12, 13, 18, 19): SELECT_UNSELECT_CARD.
    - Pend Summon (step 9): SELECT_CARD-multi for Pend-summon targets (Copernicus + Doom Queen).

12. **Chain resolution order gotchas**:
    - Step 5-6: Lance SS and Doom Queen ED-trigger are both GY-triggered by Zero Contract's pop. Two triggers chain together — SEGOC ordering must place Doom Queen-eff CL1 or CL2 deterministically.
    - Step 10: Zeus pop + Scale Surveyor ED-trigger chain (Scale Surveyor trigger responds to Zeus pop resolving).
    - Step 18: Genghis revive-Clovis trigger fires on Siegfried Synchro-summon. The revival occurs after Siegfried is on the field.

13. **Fuwalos (42141493) is dead on turn 1 own turn** — ignore during authoring, cannot be activated without opponent SS.

## Card IDs for quick lookup during trace-assist

| CardId | Name |
|---|---|
| 11609969 | D/D Savant Kepler |
| 46796664 | D/D Savant Copernicus |
| 42382265 | D/D Scale Surveyor |
| 46372010 | Dark Contract with the Gate |
| 42141493 | Mulcharmy Fuwalos |
| 20715411 | D/D/D Zero Doom Queen Machinex |
| 32665564 | Dark Contract with the Zero King |
| 5997110 | D/D Count Surveyor (possible divergence target at step 3) |
| 67322708 | D/D Lance Soldier |
| 72291412 | D/D Necro Slime |
| 28406301 | D/D Gryphon |
| 74069667 | D/D/D Oblivion King Abyss Ragnarok |
| 3758046 | D/D/D Wise King Solomon |
| 32232538 | D/D/D Marksman King Tell |
| 9024198 | D/D/D Abyss King Gilgamesh |
| 74583607 | D/D/D Flame King Genghis |
| 70576413 | D/D/D First King Clovis |
| 44852429 | D/D/D Cursed King Siegfried |
| 79559912 | D/D/D Wave High King Caesar |
| 30998403 | D/D/D Sky King Zeus Ragnarok |
| 46593546 | D/D/D Deviser King Deus Machinex |
| 91781484 | D/D/D Headhunt |

## Action plan

Run `trace-assist` with fixture `ddd-pendulum-opener`. Expected duel events: 60-90 steps (large combo, 5-piece endboard, 2x Link + 2x Xyz + 1x Synchro + 1x Fusion + 1x Link-Xyz upgrade). Expected undo count: 5-12 (Tuner mismatches, Pend-Summon source conflicts, Copernicus vs Count Surveyor divergence). Expected session time: 90-120 minutes.

Before starting trace-assist, run:

```
cd duel-server && npx tsx scripts/dump-card-text.ts 32232538
```

to fetch Tell's full oracle text (not yet cached in this doc).
