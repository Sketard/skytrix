# Ryzeal-Mitsurugi Opener — Combo Plan (2026-04-18)

Research doc for hand-authoring the canonical trajectory via `trace-assist.ts`.
All card mechanics verified directly against `cards.cdb` (`scripts/dump-card-text.ts`).

## Hand

| CardId | Name | Type | Stats | Key Effect |
|---|---|---|---|---|
| 13332685 | Ame no Habakiri no Mitsurugi | Lv8 Reptile/Dark ritual | 2400/1800 | (1) Reveal: SS 1 non-ritual Mitsurugi from deck, tribute 1 monster. **Once per DUEL**. (2) If Tributed: search 1 Mitsurugi card + SS self from GY. Once/turn. |
| 8633261 | Ice Ryzeal | Lv4 Pyro/LIGHT | 1700/1000 | (1) SS-self by sending 1 card from hand/field to GY. **R4-only lock**. (2) On NS: SS 1 Ryzeal from deck except Ice. No lock via (2). |
| 35844557 | Sword Ryzeal | Lv4 Pyro/FIRE | 1500/200 | (1) SS-self if Ryzeal in field/GY. **R4-only lock**. (2) On NS/SS: search 1 LIGHT Pyro from deck. |
| 45171524 | Mitsurugi Prayers | Quickplay Spell | — | Optional tribute 1 Reptile on activation. Apply 1 effect (or both if tributed): (a) Search Mitsurugi monster. (b) Take 800 dmg, SS 1 Mitsurugi from hand/GY. |
| 42141493 | Mulcharmy Fuwalos | Lv4 Insect/WIND | 100/600 | Hand trap (requires opponent). **Dead on our turn** — useful as discard fodder or Xyz material if we can use Insect somehow. |

## Expected Endboard (6 pieces)

| Zone | CardId | Card | Position | Requires |
|---|---|---|---|---|
| MZONE | 34909328 | Ryzeal Detonator | Rank 4 Xyz atk | 2+ Lv4 Ryzeal |
| MZONE | 7511613 | Ryzeal Duo Drive | Rank 4 Xyz atk | 2+ Lv4 monsters (generic) |
| MZONE | 55397172 | Futsu no Mitama no Mitsurugi | Lv8 Reptile Ritual atk | Ritual-summon or revive |
| MZONE | 8165596 | Number 90: Galaxy-Eyes Photon Lord | Rank 8 Xyz atk | 2 Lv8 monsters (generic) |
| SZONE | 6798031 | Ryzeal Cross | Continuous Spell set | Searched/set by Star Ryzeal |
| SZONE | 17954937 | Mitsurugi Great Purification | Trap set | Searched by Saji or Habakiri on-Tribute |

## Key Intermediates

| CardId | Name | Role |
|---|---|---|
| 18176525 | Mitsurugi no Mikoto, Saji | Lv4 Reptile. On NS/SS/Tribute: search 1 Mitsurugi **Spell/Trap**. Single OPT across triggers. |
| 40543231 | Aramasa | Lv4 Reptile. On NS/SS/Tribute: search Mitsurugi **monster** (not self). |
| 82782870 | Kusanagi | Lv4 Reptile. On NS/SS/Tribute: target Mitsurugi in **GY/banishment** → add to hand (not self). |
| 19899073 | Ame no Murakumo no Mitsurugi | Lv8 Reptile Ritual. On SS: destroy all opp monsters (useless turn-1). On-Tribute: search Mitsurugi + SS self from GY. |
| 81560239 | Mitsurugi Ritual | Ritual Spell. (1) RS 1 Reptile Ritual from **deck**, tribute Reptiles from hand/field = target Lv. (2) RS from **hand**, tribute ≤ 2 Reptiles from hand/deck/field = target Lv. Each effect once/turn. |
| 49721684 | Mitsurugi Mirror | Ritual Spell. RS from **hand or GY**, tribute Reptiles from hand/field ≥ target Lv (flexible). Recycles self on Mitsurugi-tribute. |
| 84433129 | Star Ryzeal | Lv4 Pyro/LIGHT. SS-self by detach material (R4-only lock). On SS: Set 1 Ryzeal Spell/Trap from deck. **Sets Ryzeal Cross**. |
| 34022970 | Ext Ryzeal | Lv4 Pyro/LIGHT. SS-self by sending Xyz from Extra to GY (R4-only lock). Search FIRE Thunder if no non-Lv4 face-up. |
| 72238166 | Node Ryzeal | Lv4 Pyro/FIRE. SS-self if Xyz in field/GY (R4-only lock). Send hand/field card → SS Ryzeal from GY (negated). |

## Critical Constraints

1. **R4-only lock**: Ice/Sword/Ext/Star/Node Ryzeal all self-SS with "Rank 4 Xyz only from Extra for rest of turn". We need **Photon Lord (Rank 8)** → any self-SS from Ryzeal LOCKS OUT Photon Lord. **Workaround**: SS Ryzeals via other effects (Ice NS-trigger doesn't lock; Star Ryzeal via Ice NS-trigger doesn't lock).

2. **Photon Lord needs 2 Lv8 monsters**: only source is Mitsurugi ritual monsters (Habakiri, Futsu, Murakumo). Must have 2 simultaneously on field, and neither can be Futsu (Futsu must remain at end).

3. **Saji OPT**: single search across NS/SS-Tribute triggers. Must pick carefully.

4. **Habakiri on-Tribute**: fires when tributed (e.g., by Mitsurugi Ritual eff1). Searches any Mitsurugi card (monster, spell, or trap). Can SS self from GY.

5. **Ritual Summon flow**: Mitsurugi Ritual eff1 (deck) uses each effect once/turn, so Mitsurugi Ritual can only be activated once (each activation uses one eff). Spell goes to GY after resolution. To re-activate: recycle via Kusanagi (GY→hand).

## Proposed Line (narrative)

### Phase 1 — Habakiri engine opener (~steps 0-15)

1. Pass opponent's SELECT_CHAIN (no handtrap to play, Fuwalos is dead since opponent controls nothing).
2. **Habakiri hand-eff** (SELECT_IDLECMD): reveal Habakiri → SS 1 Mitsurugi from deck (Saji/Kusanagi/Aramasa pool, no rituals) → **pick Saji** → tribute Saji (only monster we control).
3. **Saji on-Tribute** (SELECT_CARD): search Mitsurugi Spell/Trap → **pick Mitsurugi Ritual** (81560239).
4. **Mitsurugi Ritual eff1** activation (SELECT_IDLECMD): select Murakumo (19899073) as target → tribute Habakiri from hand (Lv8 = 8).
5. **Habakiri on-Tribute** (SELECT_CARD): search Mitsurugi card → **pick Mitsurugi Great Purification** (17954937). Then SS Habakiri from GY.
6. Now field: Murakumo (Lv8 atk) + Habakiri (Lv8 atk). Hand: Ice, Sword, Prayers, Fuwalos, Purification.

### Phase 2 — Xyz Photon Lord (~steps 16-22)

7. **Xyz summon Photon Lord** (SELECT_IDLECMD): use Murakumo + Habakiri as materials → SS Number 90: Galaxy-Eyes Photon Lord (Rank 8, 2 Lv8 mons).
8. Field: Photon Lord (with 2 mats). Hand: Ice, Sword, Prayers, Fuwalos, Purification.

### Phase 3 — Ryzeal engine + Cross set (~steps 22-35)

9. **NS Ice Ryzeal** (SELECT_IDLECMD). Ice NS-trigger: SS 1 Ryzeal from deck except Ice → **pick Star Ryzeal** (for Cross set).
10. **Star SS-trigger**: Set 1 Ryzeal Spell/Trap from deck → **pick Ryzeal Cross** (6798031). ✓ Cross set.
11. Field: Photon Lord, Ice, Star. For Sword to SS-self we need... wait, Sword's SS-self has R4-only lock. But we already did Photon Lord, so future R4-only wouldn't break anything already done. But we can't Xyz summon Duo Drive via Sword-SS-self because… wait, Duo Drive is Rank 4, so it's fine under R4-only. ✓
12. **SS Sword Ryzeal** (SS-self, Ryzeal in field): Sword SS-trigger searches LIGHT Pyro → **pick Ext Ryzeal** (or another useful Ryzeal, see below).
13. Field: Photon Lord, Ice, Star, Sword.
14. **Xyz Ryzeal Detonator** (Rank 4, 2+ Lv4 Ryzeal): materials Ice + Star. Detonator SS-trigger: attach 1 monster from GY. GY has Habakiri, Saji (maybe Murakumo too depending on whether SS'd back to field was permanent). Attach something (Saji? Murakumo if in GY?).
15. Field: Photon Lord, Detonator, Sword. Hand: Prayers, Fuwalos, Purification, + whatever Sword searched.

### Phase 4 — Second Xyz Duo Drive + set Purification (~steps 35-50)

16. Need a 2nd Lv4 on field to Xyz Duo Drive with Sword. Options:
    - **Ext Ryzeal** self-SS (send Xyz from Extra to GY): R4-only lock (already satisfied). Then Xyz Sword + Ext → Duo Drive.
    - Or use **Node Ryzeal** if searched (SS-self if Xyz in field — Photon Lord qualifies).
17. Assume we use Ext Ryzeal. **SS Ext Ryzeal** (send 1 Xyz from Extra to GY as cost).
18. **Xyz Duo Drive**: Sword + Ext (both Lv4). Duo Drive SS-trigger: attach 1 Ryzeal from GY as material. Attach Ice or Star from GY.
19. Field: Photon Lord, Detonator, Duo Drive. Hand: Prayers, Fuwalos, Purification.

### Phase 5 — Ritual-summon Futsu + set Purification (~steps 50-60)

20. We still need **Futsu** on field. Options:
    - Ritual-summon Futsu. Requires Futsu targetable via a ritual spell.
    - Mitsurugi Ritual is in GY (used). Not reusable without Kusanagi recycle.
    - **Mitsurugi Mirror**? It's still in deck. Needs to be searched. Saji already used. No more search avenues easily.
    - **Prayers 2nd effect** (SS from hand/GY): if Futsu is in GY (unlikely unless milled), or in hand. Currently Futsu is in deck.
    
    **Hmm — the hand-authoring needs to deviate: during Phase 1, step 5, make Habakiri on-Tribute search FUTSU (monster) instead of Purification (trap). Then Purification must come from another source. Saji searched Mitsurugi Ritual at step 3.**
    
    **Revised: search Purification via a 2nd Saji/Aramasa/Kusanagi on-Tribute that we generate later.** But we only have 1 Saji (already tributed). Need Aramasa or Kusanagi.
    
    **Alternative path**: at step 5, Habakiri on-Tribute searches **Mitsurugi Mirror**. Then Mitsurugi Mirror activates to ritual-summon **Futsu from hand** (if Futsu is in hand)... but Futsu is still in deck.
    
    **Cleanest path**: at step 5, Habakiri on-Tribute searches **Futsu**. Use Prayers 2nd effect (optional tribute 1 Reptile, apply both effects) with Habakiri tribute for ritual-less SS of Mitsurugi from hand/GY. But Futsu from hand can be SS'd via Prayers 2nd eff.
    
    Wait — Prayers 2nd eff SS's Mitsurugi monsters from hand/GY. Ritual monsters have a SS restriction but Prayers explicitly allows "Special Summon 1 'Mitsurugi' monster from your hand or GY". Does this bypass ritual-summon requirement? OCG typically: ritual monsters can only be SS'd via ritual-summon UNLESS the effect says otherwise. Prayers doesn't say "bypass ritual" — just "Special Summon". In practice, OCG often requires the monster to have been properly ritual-summoned before going to GY (so SS from GY is a revival, not first-time ritual-summon).
    
    **So Prayers 2nd eff needs Futsu to have been ritual-summoned earlier → tributed/sent to GY → revive via Prayers.** Not helpful for initial Futsu RS.

21. **Genuinely simplest path**: ritual-summon Futsu via Mitsurugi Ritual AT STEP 4 (instead of Murakumo). Then Murakumo must come from elsewhere for Photon Lord. But we have only 1 ritual spell searchable, and no way to ritual-summon 2 Lv8s.

22. **Final resolution**: accept that we need BOTH Murakumo (for Photon Lord mat) AND Futsu (endboard piece) ritual-summoned. This means:
    - Use Mitsurugi Ritual eff1 for Murakumo (tribute Habakiri Lv8).
    - Recycle Mitsurugi Ritual to hand via Kusanagi's on-NS/SS/Tribute effect.
    - Use Mitsurugi Ritual eff2 (RS from hand) for Futsu (tribute Murakumo Lv8 from field → but Murakumo is needed for Photon Lord).
    - Hmm — use Mitsurugi Ritual eff2 with 2 tributes from deck (eff2 allows deck tributes). Tribute 2 Lv4 Reptiles from deck (e.g., Aramasa + Kusanagi) = 8 total → RS Futsu from hand.
    - This requires **Futsu in hand**. Search via Aramasa or Habakiri on-Tribute.
    - This requires **Kusanagi on field** to recycle Mitsurugi Ritual. Get Kusanagi via... Habakiri hand-eff is once per duel. Need another SS route.

23. **Alternative: use Mitsurugi MIRROR as the 2nd ritual spell**. Mirror is in deck. How to search Mirror? Only via a Mitsurugi Spell/Trap searcher: Saji. Saji used. Or Habakiri on-Tribute (Mitsurugi CARD — includes Mirror). 
    - Revised step 5: Habakiri on-Tribute searches **Mitsurugi Mirror**, SS Habakiri from GY.
    - Now Mirror in hand. Use Mirror to RS Futsu from hand or GY — but Futsu isn't in hand/GY either.

24. **CRUCIAL SIMPLIFICATION**: re-read Mitsurugi Ritual eff1 very carefully.

    "● Ritual Summon 1 Reptile Ritual Monster from your Deck, by Tributing Reptile monsters from your hand or field whose total Levels equal the Level of the Ritual Monster."
    
    It summons from DECK. The target is **any Reptile Ritual**, not just Futsu/Murakumo/Habakiri. But this deck only has those 3 as Reptile Rituals. And Futsu is in the deck (per main deck list — 55397172 at index 190). ✓ Ritual-summon Futsu directly from deck via eff1.
    
    **Simplest line**: RS Futsu (not Murakumo) via Mitsurugi Ritual eff1. Tribute Habakiri from hand = 8. Futsu on field. Habakiri on-Tribute: search + SS Habakiri. Field: Futsu + Habakiri.
    
    Then to get a 2nd Lv8 for Photon Lord: Habakiri is Lv8. But Photon Lord needs TWO Lv8s and Futsu must remain. So tribute... wait, Xyz uses materials, not tributes. Xyz consumes Futsu. That leaves Futsu off-field.

25. **Deepest workaround**: Futsu gets revived BACK to field via **Mitsurugi Great Purification**'s second effect: "banish this card from GY, target 1 Reptile in GY; SS it, tribute 1 other monster you control." Requires Purification in GY and 1 other monster to tribute.
    
    But Purification is SET at endboard, not banished. If we banish Purification, it's in banish zone, not set. CONFLICT.

26. **Alternative revival**: Futsu's own on-Tribute: "If this card is Tributed: add Mitsurugi card, SS self from GY." Needs Futsu tributed → GY → revive.
    - RS Futsu via Mitsurugi Ritual eff1 (step 4) → field.
    - Tribute Futsu somehow to get it to GY → on-Tribute triggers → search Mitsurugi card + SS Futsu from GY.
    - Tribute opportunities: Prayers activation tribute (Quickplay, optional Reptile tribute).
    
    Plan: RS Futsu → use Prayers (tribute Futsu from field) → Futsu goes to GY → Futsu on-Tribute: search Mitsurugi + SS self from GY. Then Prayers applies both effects: (1) search Mitsurugi monster. (2) SS Mitsurugi from hand/GY (SS something else, maybe Murakumo from GY if we had ritual-summoned it earlier — chicken-and-egg).
    
    OK simpler: after step 4 (RS Futsu) + step 5 (Habakiri on-Tribute back), field = Futsu + Habakiri. Use Prayers tributing Futsu:
    - Prayers activation + tribute Futsu (Reptile Lv8) → apply both effects.
    - Futsu on-Tribute (at cost): search Mitsurugi card (**pick Purification**), SS Futsu from GY.
    - Prayers effects: (a) search Mitsurugi monster, pick **Aramasa** (to search another Mitsurugi later). (b) SS 1 Mitsurugi from hand/GY — but Futsu is already coming back via its own on-Tribute. Could SS another Mitsurugi in GY (no other Mitsurugi in GY yet besides Habakiri — but Habakiri already on field). Or hand (if Aramasa, just searched). Hmm, Aramasa is in hand now. SS Aramasa from hand (if Prayers SSs Mitsurugi, not just ritual monsters). Aramasa is a Mitsurugi monster. ✓
    - Aramasa on-SS: search 1 Mitsurugi monster. Already used search? No, this is on-SS (different trigger from on-NS-or-Tribute). Wait Aramasa's text: "If this card is Normal or Special Summoned, or if this card is Tributed: ... You can only use each effect of Aramasa once per turn." Single OPT across the first trigger's variants. So on-SS IS the same effect. 1 use max. Search **Murakumo** (to use as Photon Lord mat later? Or Kusanagi?).

27. **Rewrite with this insight**:

**FINAL PROPOSED LINE**:

1. Pass opponent's opening chains.
2. **Habakiri hand-eff**: reveal → SS Saji → tribute Saji.
3. **Saji on-Tribute**: search **Mitsurugi Ritual** (spell).
4. **Activate Mitsurugi Ritual eff1**: target = **Futsu** (from deck), tribute Habakiri from hand (Lv8 = 8).
5. **Habakiri on-Tribute**: search **Mitsurugi Mirror**, SS Habakiri from GY. (We'll use Mirror later for a 2nd RS.)
6. Field: Futsu + Habakiri. Hand: Ice, Sword, Prayers, Fuwalos, Mitsurugi Mirror.
7. **Activate Prayers**: tribute Futsu (Reptile Lv8) → apply both effects.
   - (on-cost) Futsu on-Tribute: search Mitsurugi card → **pick Great Purification**. SS Futsu from GY (back to field).
   - Prayers eff (1): search Mitsurugi monster → **pick Aramasa**.
   - Prayers eff (2): 800 damage, SS 1 Mitsurugi from hand/GY → SS **Aramasa** from hand.
   - Aramasa on-SS: search Mitsurugi monster → **pick Kusanagi** (or Murakumo).
8. Field: Futsu (revived), Habakiri, Aramasa. Hand: Ice, Sword, Fuwalos, Mirror, Purification, Kusanagi.

   Wait — Futsu's on-Tribute says: "add 1 Mitsurugi card from your Deck to your hand, except Futsu, THEN you can Special Summon this card." The "then" implies the search is optional-resolve-first, then the SS is optional. If we resolve the search (Purification), can we also SS Futsu? Yes, both.

9. **Activate Mitsurugi Mirror**: target = Murakumo (in deck, Lv8 Reptile Ritual). Mirror RSes from hand or GY — Murakumo is in deck, not hand/GY. **FAIL**.

   So Mirror can't RS Murakumo from deck. Mirror only works with ritual monster in hand or GY. Hmm.
   
   To get Murakumo to hand/GY before Mirror:
   - Aramasa on-SS search: we searched Kusanagi. Could have searched Murakumo instead. Let's revise step 7 Aramasa search → **Murakumo**.
   - Then Mirror RS Murakumo from hand.

Revised step 7 Aramasa search: **Murakumo** (Lv8 ritual to be RS'd by Mirror).

10. **Activate Mitsurugi Mirror**: target = Murakumo (from hand), tribute Reptile levels ≥ 8 from hand/field. Tribute Aramasa (Lv4) + Habakiri (Lv8 from field) = 12 ≥ 8. ✓ RS Murakumo.
    - Habakiri on-Tribute **ALREADY USED** this turn (at step 5). Cannot trigger again.
    - Aramasa on-Tribute: search Mitsurugi monster → **pick Kusanagi** (to recycle Ritual later if needed, though we might skip this).
    - Murakumo on-SS: destroy all opponent monsters (no opponent monsters, no-op). Still triggers but no destruction.
11. Field: Futsu, Murakumo. Hand: Ice, Sword, Fuwalos, Purification, Kusanagi.

12. **Xyz Murakumo + ???** for Photon Lord — we need 2 Lv8. Murakumo alone is Lv8. Need another Lv8.
    - Habakiri was tributed for Mirror at step 10. It's in GY.
    - Futsu is Lv8 (on field) but we must keep it.
    - Only way: SS another Lv8 to field. How?
    - Mitsurugi Mirror is in GY now (used). Mirror has a self-recycle: "If a key Mitsurugi you control is Tributed while this card is in your GY, shuffle this card into the Deck." Not helpful for Lv8 summon.
    - Kusanagi on NS/SS: add Mitsurugi from GY/banishment to hand. If Habakiri in GY (yes from step 10), we can add Habakiri to hand. Then... Habakiri hand-eff once-per-duel used. So Habakiri can't be SS'd via hand-eff again.
    - Habakiri on-Tribute can trigger again IF Habakiri is tributed again... but it's once-per-turn, already used at step 5.
    
    Dead end again.

### Alternative final approach: SKIP Photon Lord via ritual-summon, use Ryzeal-only Lv8

13. **Number 90 Photon Lord** needs 2 Lv8 MONSTERS — any 2 Lv8, not just ritual. Ryzeal-wise no Lv8 in deck. Mitsurugi only has Habakiri/Futsu/Murakumo as Lv8.

14. **Alternative Rank 8 instead of Photon Lord?** No — fixture explicitly expects Photon Lord.

15. **Photon Lord built via different sequencing**: 
    - **RS Murakumo first** (via Mitsurugi Ritual eff1, tributing Habakiri from hand).
    - **Habakiri back to field** (via on-Tribute SS).
    - **Xyz Murakumo + Habakiri → Photon Lord**. Both consumed.
    - **RS Futsu via Mitsurugi Mirror** (need Futsu in hand/GY).
    - To get Futsu in hand: Aramasa search (Aramasa on-SS), or Habakiri on-Tribute (consumed already).
    - To get Aramasa SS'd to trigger its search: no NS left (we won't NS Ice this turn if we do all this ritual stuff first?). Actually Prayers 2nd effect SSs from hand. If Aramasa in hand, Prayers can SS it.

**TRULY FINAL LINE** (optimistic):

1. Pass opponent chains.
2. **Habakiri hand-eff** → SS Saji → tribute Saji.
3. Saji on-Tribute: search **Mitsurugi Ritual**.
4. **Mitsurugi Ritual eff1**: target = **Murakumo**, tribute Habakiri (hand) = 8.
5. Habakiri on-Tribute: search **Aramasa** (monster, to chain more searches) — wait, Aramasa searches monster. We need something that searches Futsu directly. Aramasa can search Futsu.
   - Revise: Habakiri on-Tribute searches **Aramasa** (via Mitsurugi-CARD clause). Then SS Habakiri from GY.
6. Field: Murakumo, Habakiri. Hand: Ice, Sword, Prayers, Fuwalos, Aramasa.
7. **Xyz Photon Lord** (Murakumo + Habakiri → Rank 8). Field: Photon Lord. Hand same.
8. **Activate Prayers**, tribute Aramasa (Reptile Lv4) from hand:
   - Aramasa on-Tribute: search Mitsurugi monster → **pick Futsu**.
   - Prayers both effects: (a) search Mitsurugi monster → **Kusanagi**; (b) 800 dmg, SS Mitsurugi from hand/GY → SS Futsu from hand (Mitsurugi monster, allowed).
   - **BUT**: can we SS Futsu (ritual monster) via Prayers? Ritual monsters normally can't be SS'd without ritual-summon. Prayers says "Special Summon" — this is NOT ritual-summon. In OCG, Futsu would need to have been ritual-summoned previously for this SS to work. Futsu has never been RS'd → cannot SS via Prayers.
   - **Alternative**: SS Kusanagi from hand (Prayers 2nd eff), Kusanagi is not a ritual monster, no restriction.
   - Revise Prayers eff (a): search **Kusanagi**. Eff (b): SS Kusanagi from hand.
   - Kusanagi on-SS: target Mitsurugi in GY/banishment → add to hand. GY has Saji, Aramasa, Habakiri (from tribute). Add **Mitsurugi Ritual** (in GY from step 4)? Mitsurugi Ritual IS a Mitsurugi card (it's a spell with "Mitsurugi" in name). Yes. Add Ritual back to hand.
9. Field: Photon Lord, Kusanagi. Hand: Ice, Sword, Fuwalos, Futsu, Mitsurugi Ritual.
10. **Activate Mitsurugi Ritual eff2** (RS from hand, tribute ≤ 2 Reptiles from hand/deck/field levels = 8): target = Futsu (from hand), tribute Kusanagi (Lv4 from field) + ??? Need total = 8. Only Kusanagi on field (Reptile). Hand Reptiles: Futsu (target, can't tribute itself). Deck Reptiles: any Mitsurugi. Tribute Kusanagi + 1 Lv4 Reptile from DECK (Saji/Aramasa/Kusanagi2/etc.).
    - Aramasa is in GY (tributed earlier). Saji in GY. Kusanagi copies in deck? Main deck has 1 Kusanagi (copy 82782870 at index 194). Already used — wait, Kusanagi was NS'd via Prayers, now to be tributed. 1 copy in deck other than the one on field? Let me check: the deck list shows 82782870 appears once (index 194). So only 1 Kusanagi total. If it's on field, deck has 0.
    - Aramasa (40543231) appears once at index 193. In GY (tributed at step 8). Deck has 0.
    - Saji (18176525) appears once at index 195. In GY. Deck has 0.
    - **We have 0 extra Lv4 Reptiles in deck**. Only Night Sword Serpent (20295753) is Lv4 Reptile/DARK left in deck.
    - Night Sword Serpent: Lv4 Reptile. Can we tribute it from deck? Mitsurugi Ritual eff2 says "Reptile monsters from your hand, Deck, or field". Yes, can tribute from deck. So tribute Kusanagi (field) + Night Sword Serpent (deck) = 8. ✓
    - Kusanagi on-Tribute: target Mitsurugi in GY → add to hand. Add what? Saji, Aramasa, or Habakiri (if in GY). Maybe Habakiri (to use later if possible).
    - Actually Kusanagi OPT: "You can only use each effect of Kusanagi once per turn." Kusanagi's on-NS/SS already used at step 8 (Mitsurugi Ritual recycle). Wait, is on-NS/SS same effect as on-Tribute? Text: "If this card is Normal or Special Summoned, or if this card is Tributed: [effect1]". Single effect with multi-triggers. OPT shared. Already used → **cannot trigger again on Tribute.** Dead trigger.
    - Night Sword Serpent on-banish/graveyard effect: "If this card is sent to the GY by a card effect: You can Special Summon this card, but banish it when it leaves the field." Tribute is NOT "sent to GY by a card effect" in OCG (tribute is its own game mechanic). So NSS doesn't SS itself from Ritual Eff2 tribute.
    - Futsu RS successful.
11. Field: Photon Lord, Futsu. Hand: Ice, Sword, Fuwalos.

### Phase 3' — Ryzeal engine (simplified)

12. **NS Ice Ryzeal**. Ice NS-trigger: SS 1 Ryzeal from deck except Ice → **pick Star Ryzeal**.
    - Star SS-trigger: Set 1 Ryzeal Spell/Trap from deck → **pick Ryzeal Cross**. ✓ Cross set.
13. Field: Photon Lord, Futsu, Ice, Star. Hand: Sword, Fuwalos.
14. **SS Sword Ryzeal** (Ryzeal in field). Sword R4-only lock (OK, future ED SS = R4 only; Photon Lord already out). Sword SS-trigger: search LIGHT Pyro → **pick Ext Ryzeal**.
15. Field: Photon Lord, Futsu, Ice, Star, Sword. Hand: Fuwalos, Ext Ryzeal.
16. **Xyz Ryzeal Detonator** (Rank 4, 2+ Lv4 Ryzeal): Ice + Star → Detonator. Detonator SS-trigger: attach 1 monster from GY as material. GY has many monsters (Habakiri, Saji, Aramasa, Kusanagi, Night Sword Serpent). Attach Habakiri or Saji (doesn't matter for endboard — Detonator position is atk regardless).
17. Field: Photon Lord, Futsu, Detonator, Sword. Hand: Fuwalos, Ext Ryzeal.
18. **SS Ext Ryzeal** (send 1 Xyz from Extra to GY as cost; R4-only, OK). Send a useless Rank 4 from Extra (not Duo Drive! We need Duo Drive for endboard). Options: 9940036, 40673853, 66011101, 61399402, 32530043, 11398059, 49678559, 45852939, 5088741 — various rank 4s. Pick the least useful one.
    - Ext SS-trigger: search FIRE Thunder **IF we control no face-up non-Lv4 monster**. Field has Photon Lord (Rank 8 = non-Lv4) + Futsu (Lv8 non-Lv4). Condition fails. No search.
19. Field: Photon Lord, Futsu, Detonator, Sword, Ext. Hand: Fuwalos.
20. **Xyz Ryzeal Duo Drive** (Rank 4, 2+ Lv4 generic): Sword + Ext → Duo Drive. Duo Drive SS-trigger: attach 1 Ryzeal from GY as material. Attach Ice or Star from GY.
21. Field: Photon Lord, Futsu, Detonator, Duo Drive. Hand: Fuwalos. ✓ 4 MZONE pieces.

### Phase 4' — Set Purification + end

22. Wait — we need **Mitsurugi Great Purification** on the board SET. Where did we search it?
    - Revisit step 5: Habakiri on-Tribute searched Aramasa (a monster). We need to search Purification somewhere.
    - Revise step 5 back: Habakiri on-Tribute searches **Mitsurugi Great Purification** (trap). But then Aramasa is never searched → step 8 Prayers path fails.
    - **OR**: use Kusanagi's on-Tribute to search Purification. But Kusanagi OPT already consumed at step 8 (on-NS/SS recycle).
    - **OR**: use Futsu's on-Tribute at step 10 (implicit when tributed for RS Futsu — wait, Futsu RS'ing itself means Futsu is the TARGET, not the TRIBUTE). Futsu is not tributed. No on-Tribute trigger for Futsu.
    - **OR**: use Aramasa on-Tribute at step 8 (currently searches Futsu). But Aramasa OPT = single effect across NS/SS/Tribute triggers. Step 8 has Aramasa tributed by Prayers → on-Tribute fires, searches Futsu. Aramasa on-NS never fires (Aramasa never NS'd). So 1 search used via on-Tribute. OK.
    - Revise step 5: Habakiri on-Tribute searches **Purification** (trap, set later from hand). Then we need to search Aramasa elsewhere.
    
    Wait — actually the Murakumo Ritual Summon (step 4) causes Habakiri-on-Tribute (at step 5). What other searches are available?
    - Saji: Spell/Trap, used for Mitsurugi Ritual (step 3).
    - Habakiri on-Tribute: Mitsurugi CARD (any), used for Purification (step 5 revised).
    - Aramasa: Mitsurugi monster. Via Prayers tribute (step 8). Search Futsu.
    - Kusanagi: Mitsurugi from GY/banishment → hand. Used for recycling Mitsurugi Ritual (step 8).
    - Murakumo on-Tribute: would fire if Murakumo tributed. Murakumo Xyz-material'd at step 7, not tributed.
    - Prayers eff (a): search Mitsurugi monster. Can search Aramasa at step 8 — but then Aramasa on-SS fires (NOT on-Tribute), searches Kusanagi instead of Futsu (since Kusanagi's on-tribute at step 10 is dead).
    - Prayers eff (b): SS Mitsurugi from hand/GY — SS Aramasa. Aramasa on-SS: single-OPT search shared with on-NS/Tribute. Can search ONE thing.

**Cleanest resolved line** (V∞):

1. Pass chains.
2. Habakiri hand-eff → SS **Aramasa** (not Saji! Aramasa searches monster) → tribute Aramasa.
   - Actually Aramasa-on-Tribute searches Mitsurugi **monster**, not Spell/Trap. We need Mitsurugi Ritual (Spell). Saji's the spell/trap searcher.
3. Revert: SS Saji → tribute Saji → Saji on-Tribute searches **Mitsurugi Ritual**.
4. Activate Mitsurugi Ritual eff1: target Murakumo, tribute Habakiri from hand (Lv8 = 8).
5. Habakiri on-Tribute: search **Mitsurugi Great Purification** (trap, keep in hand for set later), SS Habakiri from GY.
6. Field: Murakumo + Habakiri. Hand: Ice, Sword, Prayers, Fuwalos, Purification.
7. **Xyz Photon Lord** (Murakumo + Habakiri → Rank 8 Xyz). Field: Photon Lord.
8. Activate Prayers, tribute Fuwalos? Fuwalos is Insect not Reptile. Can't tribute for Prayers (requires Reptile).
   - Activate Prayers WITHOUT tribute, apply 1 effect: (a) search Mitsurugi monster → **Aramasa**. OR (b) SS Mitsurugi from hand/GY. Hand Mitsurugi: none (all used). GY Mitsurugi monsters: Saji, Habakiri (used, now maybe back in field). Habakiri SS'd back to field at step 5 — is it still on field? It was used for Photon Lord at step 7 → now Xyz material (not in GY, attached to Photon Lord).
   - So GY Mitsurugi monsters: Saji only (Aramasa not in GY, Murakumo attached to Photon Lord). SS Saji from GY? Saji is Mitsurugi monster. ✓
   - Saji on-SS: search Mitsurugi Spell/Trap. But Saji OPT already used (at step 3 on-Tribute). Dead trigger.
   - OK: **Prayers eff (a) = search Aramasa**. Aramasa in hand.
9. **Now we need to SS Aramasa to trigger its search**. How? 
   - Aramasa's SS options: no self-SS. Must be SS'd by another effect.
   - NS Aramasa: wastes our NS. Then Aramasa on-NS triggers search → Mitsurugi monster → Futsu.
10. **NS Aramasa**. Aramasa on-NS: search **Futsu** (Mitsurugi monster).
    - Field: Photon Lord, Aramasa. Hand: Ice, Sword, Fuwalos, Purification, Futsu.
11. **Mitsurugi Mirror search**? We need Mirror to RS Futsu from hand. Where do we get Mirror?
    - Saji already searched Mitsurugi Ritual.
    - Habakiri on-Tribute searched Purification.
    - No more Mitsurugi spell-searchers available.
    - **Can we activate Mitsurugi Ritual eff2 instead?** Mitsurugi Ritual is in GY after step 4. Not in hand. Can't activate from GY. To re-activate we need it in hand.
    - **Kusanagi**: recycles from GY. Get Kusanagi to field somehow. Aramasa's search is consumed. No more Mitsurugi searchers.

12. **DEAD END again** — we can't get a 2nd ritual spell activation for Futsu.

### Reconsidered: Pre-Preparation of Rites in the deck

Main deck has **13048472 Pre-Preparation of Rites** (index 225). It searches 1 Ritual Spell + 1 named Ritual Monster.

If we can get Pre-Prep to hand, we activate it to search Mitsurugi Ritual + Habakiri/Futsu/Murakumo.

But Pre-Prep is a Normal Spell not Mitsurugi. Not searchable by Saji. Not in hand. No way to access it unless we draw it.

Actually, looking at the hand: 5 cards = 13332685, 8633261, 35844557, 45171524, 42141493. Pre-Prep is NOT in hand. So it's in the 35-card undrawn deck, inaccessible unless drawn turn 2+.

### Conclusion

**We cannot ritual-summon 2 different Lv8 Mitsurugi monsters on the same turn with this opening hand without some form of extra search/recycle.**

To reach the 6/6 endboard, we must:
- RS Futsu via Mitsurugi Ritual eff1 (ONE ritual-summon this turn).
- Get a 2nd Lv8 on field via some non-ritual SS (Habakiri on-Tribute revival is the only clean way).
- Use the 2nd Lv8 + Futsu → Xyz Photon Lord. But this consumes Futsu.
- Revive Futsu post-Xyz — impossible without Futsu being tributed first (on-Tribute → GY → revive via on-Tribute SS).

**Therefore**: the combo MUST include tributing Futsu once (to trigger its on-Tribute) then having it return from GY. The tribute source is **Prayers (Quickplay) tribute Futsu at activation**.

**The resolved line** (final, with pipe-style clarity):

Pre-state: Draw phase, opponent no field, turn 1.

| Step narrative | Expected prompt / action |
|---|---|
| 0 | SELECT_CHAIN — pass (no handtrap, Fuwalos dead) |
| 1 | SELECT_CHAIN — pass |
| 2 | **Habakiri hand-eff**. SELECT_IDLECMD: pick Habakiri (reveal). |
| 3 | SELECT_CARD: pick Saji (from [Saji, Kusanagi, Aramasa]) as SS target. |
| 4 | SELECT_CARD: pick Saji (on field) as tribute target (the only monster we control). |
| 5 | Saji on-Tribute fires. SELECT_CARD: search Mitsurugi Spell/Trap → **Mitsurugi Ritual** (81560239). |
| 6 | SELECT_CHAIN — pass (chain resolves). |
| 7 | **Activate Mitsurugi Ritual eff1**. SELECT_IDLECMD: pick Mitsurugi Ritual. |
| 8 | SELECT_OPTION: pick effect 1 (RS from deck). |
| 9 | SELECT_CARD: pick **Futsu** (55397172) as ritual target. |
| 10 | SELECT_SUM / SELECT_TRIBUTE: tribute Habakiri from hand (Lv8 = 8). |
| 11 | Habakiri on-Tribute fires. SELECT_CHAIN — chain 1. |
| 12 | SELECT_CARD: search Mitsurugi card → **Great Purification** (17954937). |
| 13 | SELECT_YESNO: SS Habakiri from GY → YES. |
| 14 | Field: Futsu (Lv8) + Habakiri (Lv8). |
| 15 | SELECT_CHAIN — pass |
| 16 | **Activate Mitsurugi Prayers**. SELECT_IDLECMD: pick Prayers. |
| 17 | SELECT_YESNO: tribute Reptile at activation? YES. |
| 18 | SELECT_CARD: pick Futsu (Reptile, field) as tribute. |
| 19 | Futsu on-Tribute fires during resolution. SELECT_CHAIN/SELECT_CARD: search Mitsurugi card → **Aramasa** (40543231). SS Futsu from GY → YES. |
| 20 | Prayers apply both effects: (a) search Mitsurugi monster → **Kusanagi** or skip; (b) 800 dmg, SS Mitsurugi from hand/GY. |
| 21 | Hmm — Prayers eff (a) tries to search; we want to skip or pick something valueable. Actually we need to think carefully about chain resolution order. |

...

OK the decision table is getting very long. Let me commit this as a draft and **switch to trace-assist for actual iteration** — the interactive tool will show me real legal actions at each step, and I can decide then.

## Known card IDs for quick lookup during trace-assist

| CardId | Name | Role |
|---|---|---|
| 13332685 | Ame no Habakiri no Mitsurugi | Hand starter |
| 8633261 | Ice Ryzeal | Hand — NS trigger |
| 35844557 | Sword Ryzeal | Hand — SS-self + search |
| 45171524 | Mitsurugi Prayers | Hand — quickplay |
| 42141493 | Mulcharmy Fuwalos | Hand — dead card turn 1 |
| 18176525 | Mitsurugi no Mikoto, Saji | Deck — search spell/trap |
| 82782870 | Mitsurugi no Mikoto, Kusanagi | Deck — recycle from GY |
| 40543231 | Mitsurugi no Mikoto, Aramasa | Deck — search monster |
| 81560239 | Mitsurugi Ritual | Deck — ritual spell |
| 49721684 | Mitsurugi Mirror | Deck — alt ritual spell |
| 55397172 | Futsu no Mitama no Mitsurugi | Deck — endboard piece |
| 19899073 | Ame no Murakumo no Mitsurugi | Deck — alt ritual target |
| 17954937 | Mitsurugi Great Purification | Deck → endboard set |
| 84433129 | Star Ryzeal | Deck — sets Ryzeal spell/trap |
| 34022970 | Ext Ryzeal | Deck — SS-self via Xyz mill |
| 72238166 | Node Ryzeal | Deck — SS-self via Xyz |
| 6798031 | Ryzeal Cross | Deck → endboard set |
| 34909328 | Ryzeal Detonator | Extra — Rank 4 Xyz endboard |
| 7511613 | Ryzeal Duo Drive | Extra — Rank 4 Xyz endboard |
| 8165596 | Number 90: Galaxy-Eyes Photon Lord | Extra — Rank 8 Xyz endboard |

## Confirmed constraints summary

- **Photon Lord (Rank 8)**: needs 2 Lv8 monsters. Only Mitsurugi rituals (Habakiri/Futsu/Murakumo) are Lv8 in this deck.
- **Futsu on board at end**: must be ritual-summoned AND then revived after being tributed at some point (Prayers tribute trick).
- **Ryzeal R4-only lock**: self-SS of Ice/Sword/Ext/Star/Node triggers "only R4 Xyz from ED rest of turn". Photon Lord (R8) must be summoned BEFORE any R4-only-locked SS.
- **Saji/Aramasa/Kusanagi OPT**: each has a single shared OPT across NS/SS/Tribute triggers.
- **Habakiri hand-eff**: once per DUEL (not turn). Habakiri on-Tribute: once per turn.
- **Pre-Prep of Rites in deck**: inaccessible this turn (not in hand, not searchable).

## Action plan

Ahead with trace-assist — iterate step-by-step, using this doc as reference.
Expected number of steps: 50-70 (large combo).
Expected undo count: 3-10 (dead-ends will happen).
Expected total session time: 60-90 minutes.
