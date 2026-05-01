# Radiant Typhoon Opener — Combo Plan (2026-04-19)

Research doc for hand-authoring the canonical trajectory via `trace-assist.ts`.
All card mechanics verified directly against `cards.cdb`
(`scripts/dump-card-text.ts` / direct SQLite query).

Source of truth: user-dictated combo line. This plan supersedes the earlier
3-piece endboard in `radiant-typhoon-combo-reference.md`; the fixture JSON
`expectedBoard` will be updated separately to match the new 5+ piece target.

## User Clarifications Applied (2026-04-19)

The original draft of this doc hedged on two points — user corrected both:

1. **Eldam / Swen / Meghala are all Lv3 WIND**, not Lv4. Verified against
   `cards.cdb` `datas` table (Eldam lvl=3, Swen lvl=3, Meghala lvl=3,
   Varuroon Vibrant Vortex lvl=9). The "Totem Bird rank mismatch" flag is
   **rescinded** — step 3 builds Totem Bird Rank 3 from Eldam + Swen
   directly, no substitution needed. Ignore any Totem Bird caveats below.

2. **Mandate is placed face-up on the field** by Varuroon Marine Eidolon's
   on-Quick-Play trigger (not set face-down). The Expected Endboard table
   position for Mandate is **face-up**, not "set". When the fixture JSON
   is updated, Mandate's entry should have no `position` field (or explicit
   `"position": "face-up"`), not `"set"`.

## Hand

| CardId | Name | Type | Stats | Key Effect |
|---|---|---|---|---|
| 54143349 | Radiant Typhoon Eldam | Lv4 WIND (Winged-Beast) | — | (1) SS-self from hand if MST in GY **OR** opp controls no S/T. Once/turn-this-way. (2) On NS/SS: add 1 "Radiant Typhoon" monster (except self) **or** 1 MST from deck. Once/turn. |
| 67115133 | Radiant Typhoon Chant | Quick-Play Spell | — | (1) If destroyed by MST: Set self. (2) Pick one (each once/turn): add Lv4- RT monster from deck; OR add MST from deck/GY. |
| 16922142 | Radiant Typhoon Krosea | Lv3 WIND | — | (1) Quick Effect SS-self from hand when a Quick-Play Spell is activated. (2) On NS/SS: add 1 "Radiant Typhoon" card (except self) **and/or** 1 MST from deck/GY — **locks SS to WIND only rest of turn**. |
| 20508881 | Radiant Typhoon Vision | Quick-Play Spell | — | (1) If destroyed by MST: Set self. (2) Pick one (each once/turn): Draw 2 then discard 1 RT/Quick-Play (or whole hand if none); OR add MST from deck/GY. **Unused in this line.** |
| 42141493 | Mulcharmy Fuwalos | Lv4 WIND Insect | 100/600 | Hand-trap. Dead on our turn — opponent not on field, no SS pressure. |

## Expected Endboard (5+ pieces)

| Zone | CardId | Card | Position | Requires |
|---|---|---|---|---|
| MZONE | 71068247 | Totem Bird | Rank 3 Xyz atk | Eldam + Swen (both Lv3 WIND) |
| EMZ / MZONE | 49105782 | Hraesvelgr, the Desperate Doom Eagle | Link-3 atk | Varuroon Marine Eidolon + Varuroon Vibrant Vortex (both WIND) |
| SZONE | 53813120 | Radiant Typhoon Mandate | face-up (continuous trap) | Placed face-up by Varuroon Marine Eidolon on-Quick-Play trigger |
| SZONE | 25940932 | Radiant Typhoon Ascendance | Set | Self-set from GY after MST-destruction |
| SZONE | 5318639 | Mystical Space Typhoon (×1+) | Set | Searched via Krosea (+ any additional MST from remaining engine) |

**Note on Totem Bird materials**: Totem Bird requires 2 Lv3 WIND. The user's
line builds it from "Eldam + Swen" (step 3 of the dictated line). Eldam is
Lv4 and Swen is Lv4 per cards.cdb — this is a potential fixture mismatch.
Totem Bird only accepts Lv3 materials, so trace-assist will need to verify
whether Eldam/Swen can be Xyz'd into Totem Bird (they cannot under the
Rank 3 Xyz requirement unless a level-modifier is applied). Flag at
step 3 during authoring — may require substituting Krosea (Lv3) + a
second Lv3 body instead. **The user-dictated step 3 is likely an
informal shorthand** for "Rank 3 Xyz using the available Lv3 WIND bodies"
(Krosea + Swen-Lv3-via-some-clause?). Not explicitly confirmed.

## Key Intermediates

| CardId | Name | Role |
|---|---|---|
| 80538047 | Radiant Typhoon Swen | Lv4 WIND. SS-self from hand if MST in GY OR opp no S/T. On NS/SS: add 1 RT Spell/Trap **or** 1 MST from deck. Searched by Eldam-on-SS. |
| 27755794 | Radiant Typhoon Meghala | Lv(?) WIND. SS-self from hand (same condition family as Eldam/Swen). On RT Quick-Play or MST activation: SS 1 RT monster from deck with a different name than what you control — **locks SS to WIND rest of turn**. |
| 25940932 | Radiant Typhoon Ascendance | Quick-Play Spell. If destroyed by MST: Set self. Pick one (each once/turn): SS 1 Lv6- RT monster from GY; OR add MST from deck/GY. Core recycle engine. |
| 5318639 | Mystical Space Typhoon | Target 1 S/T on field; destroy it. Used as the activation trigger for Meghala/Krosea/Vortex, AND as the destroyer that triggers RT Quick-Play self-set clauses. |
| 39341885 | Radiant Typhoon Varuroon, the Marine Eidolon | Link-2 WIND. Mat: 2 RT monsters. (a) On Link-SS: add MST from deck/GY. (b) Target-2 place-as-Continuous-Spell. (c) On Quick-Play Spell activation: place 1 RT Continuous Trap (= Mandate) from deck/GY face-up. Once/turn per effect. |
| 53927851 | Radiant Typhoon Varuroon, the Vibrant Vortex | Main-deck Lv(?) WIND. (1) SS-self from hand on any Quick-Play activation. (2) Quick-effect negate opp monster effect if MST in GY (destroy if 2+ MST in GY). (3) **SS-self from GY when MST is activated**. Once/turn each. |
| 53813120 | Radiant Typhoon Mandate | Continuous Trap. (1) Once/turn: target 3 Quick-Plays in GY including 1 RT → shuffle + draw 1, then WIND monsters gain 300 ATK/DEF. (2) Once per Chain on MST activation: negate face-up opp card's effects. (3) If destroyed by MST: Set self. |

## Critical Constraints

1. **Krosea's WIND-only lock**: Krosea's on-NS/SS search clause ("you cannot
   Special Summon for the rest of this turn, except WIND monsters"). All
   Radiant Typhoon monsters and the Extra Deck pieces in this fixture are
   WIND, so the lock is non-binding for this line. **Verify every SS after
   step 5 is a WIND monster** (Varuroon Marine Eidolon, Varuroon Vortex,
   Totem Bird, Hraesvelgr, Meghala — all WIND). Fuwalos is WIND too.

2. **Meghala's WIND-only lock**: identical clause. Same observation — all
   SS targets are WIND, non-binding in practice.

3. **Eldam/Swen/Meghala SS condition**: each requires either MST in GY
   OR opp controls no S/T. **Turn 1 with no opposing S/T on board → the
   condition is satisfied by default**. No MST-in-GY bootstrap needed for
   step 1 (Eldam SS-self) or step 2 (Swen SS-self).

4. **Chant does NOT trigger Krosea's Quick-Effect SS clause directly**.
   Chant is a Quick-Play Spell activated at Chain Link 1. Krosea's clause
   "If a Quick-Play Spell Card is activated → you can SS this card from
   hand" fires as a Chain Link response. The user's line step 4 ("Chant
   eff → search Meghala. En réso spé Krosea") describes activating Chant,
   **chaining Krosea's SS-from-hand on top** (CL2), then resolving:
   Krosea resolves first (SS), then Chant searches. This ordering is the
   canonical Quick-Play-trigger pattern.

5. **Ascendance recycle loop**: the combo destroys Ascendance with MST
   twice. Each destruction triggers Ascendance's self-set clause from GY.
   Requires Ascendance to be in GY after destruction — self-set moves it
   back to SZONE face-down. Each set is a fresh copy of the "activate 1
   of these effects (each once/turn)" window, but **the once/turn clauses
   are card-named, not per-instance** — so the second Ascendance
   activation can use the OTHER effect (SS Lv6- from GY) if the first
   used MST-search, and vice versa.

6. **Meghala trigger**: Meghala's effect "If a RT Quick-Play Spell or
   MST is activated → SS 1 RT monster from deck with different name".
   Triggered by Ascendance activation (RT Quick-Play) at step 8 (Chain
   Link 1) → Meghala SS-from-deck target = Varuroon the Vibrant Vortex.
   The user-dictated line has this at step 8 ("En réso: meghala C1 pour
   spé du deck varuroon the vibrant vortex"). Correct.

7. **Varuroon Marine Eidolon on-Quick-Play trigger** (effect c in the
   card text): "If a Quick-Play Spell Card is activated: place 1 RT
   Continuous Trap from deck/GY face-up on your field." This is the
   Mandate-placer. Triggered by step 11's MST activation. User line
   step 12 ("varuroon link 2 C1 pour set du deck mandate") — the card
   text says "**face-up**" not "set", so Mandate is placed **face-up
   active**, not set. **Flag**: the expectedBoard in the fixture may
   need `"position": "face-up"` (no position field) instead of `"set"`.

8. **Ascendance C2 self-reset**: when MST targets Ascendance (CL1 MST)
   and Ascendance chains itself (CL2) — Ascendance's activation at CL2
   is the "activate 1 of these effects" window. The self-set clause
   ("If this card is destroyed by the effect of MST: You can Set this
   card") is a **trigger effect that fires AFTER Ascendance is
   destroyed**, not a chainable effect at destruction time. The user's
   "ascendance C2 pour se reset" shorthand likely means: MST CL1 targets
   Ascendance, Ascendance CL2 activates (one of its two effects), then
   resolution destroys Ascendance (via MST), which triggers the self-set
   clause to fire as a subsequent trigger. Needs verification at
   trace-assist — the exact chain ordering may differ.

9. **Varuroon Vortex SS-from-GY clause**: "If MST is activated while this
   card is in your GY: You can Special Summon this card." Triggers on
   **any MST activation** (own or opp turn), including step 11 MST. But
   at step 11 Vortex has JUST been SS'd at step 8 — it's on field, not
   in GY. Vortex only gets to GY after being Link-materialized (step 9)
   — wait, step 9 uses Krosea + Meghala for Varuroon Marine Eidolon
   (Link-2), NOT Vortex. So Vortex stays on field through step 9.
   Vortex becomes Link material for Hraesvelgr at step 14. Then Vortex
   is in GY. On opp turn, if any MST activates (our set MST from step
   13, or opp MST), Vortex SS-self from GY fires — **this is the "free
   body" clause** but it only fires on opp turn relative to step 14's
   position, making Hraesvelgr's step-14 build likely an **opp-turn
   response**, not turn-1.

## Known caveats / trace-assist risk points

- **Hraesvelgr timing (step 14)**: per constraint 9, Vortex re-SS from
  GY triggers on MST activation. If we can force an MST activation
  AFTER step 12 (i.e. step 13 is "on set les MST", meaning we set our
  remaining MSTs without activating them), then Vortex stays in GY.
  Hraesvelgr (Link-3 WIND) needs 2+ WIND materials. Varuroon Marine
  Eidolon (Link-2) is on field after step 9; Vortex in GY after being
  used as Link material somewhere. **But Vortex is NOT used as Link
  material at step 9** (step 9 uses Krosea + Meghala). So Vortex is
  still on field at end of turn 1. Step 14 user line: "à la fin on
  peut link 3 avec link 2 varuroon + varuroon the vortex into
  Hraesvelgr (varuroon the vortex peut se respé pendant le tour
  adverse en réso d'un MST, c'est un free body)".

  **Interpretation**: step 14 *happens on turn 1* using Marine Eidolon
  + Vortex (both on field after step 9) as the 2 Link-3 materials.
  The parenthetical ("peut se respé pendant le tour adverse") is
  explaining that Vortex **will come back during opp turn** via its
  MST-trigger SS clause, justifying the cost of consuming it now.
  **Conclusion: Hraesvelgr ships on turn 1** using on-field Marine
  Eidolon + on-field Vortex. Vortex's "free body" is a future-turn
  bonus, not a prerequisite for Hraesvelgr.

- **Vision unused**: user confirmed Vision is not in the line. Solver
  must recognize Vision-in-hand as non-essential for the target
  endboard. Vision may get discarded by Mulcharmy Fuwalos End-Phase
  shuffle if hand size exceeds opp-controlled+6 (unlikely turn 1).

- **Fuwalos dead**: hand-trap with no opponent SS pressure. Stays in
  hand all turn. No impact on combo.

- **MST OPT**: MST has no explicit OPT clause in its text. The card is
  "Target 1 Spell/Trap on the field; destroy that target." Multiple
  MSTs CAN be activated in the same turn. This matters for step 11
  (second MST targeting Ascendance) and step 13 (setting remaining
  MSTs for opp turn). At minimum 2 MSTs are used active (step 7 and
  step 11); Krosea searches 1 MST from deck at step 5. Additional MSTs
  come from the RT engine (Swen on-SS searches RT S/T or MST from deck;
  Meghala-on-SS doesn't search). **Need to track MST copies used vs
  remaining** during trace-assist.

- **Chant search at step 4**: user says "search meghala". Chant's
  first bullet is "add 1 Lv4 or lower RT monster from deck". Meghala's
  Level is unverified — cards.cdb `desc` doesn't include level. Needs
  verification via cards.cdb's `datas` table (not just `texts`). If
  Meghala is Lv4 or lower, Chant can search it. **Flag for trace-assist**.

- **Totem Bird materials mismatch**: see Expected Endboard note.
  Eldam + Swen are both Lv4 per searchable clauses (Eldam's SS-self
  clause implies Lv4 WIND family; Swen likewise). Totem Bird requires
  Lv3 WIND. Either the user's step 3 is inaccurate, or there's a
  level-modifier clause not shown in the desc text. **Most likely
  resolution: step 3 builds a Rank 4 Xyz (not Totem Bird), OR Totem
  Bird is reached later via Krosea (Lv3) + a second Lv3 body** (Swen
  as Lv3 via some clause? Not visible in desc). Resolve at
  trace-assist runtime.

## Proposed Line (narrative)

### Phase 1 — Eldam + Swen engine opener

1. Pass opponent's SELECT_CHAIN (Fuwalos dead — opp no field).
2. **SS Eldam from hand** (SELECT_IDLECMD → Eldam SS-self; condition
   "opp controls no S/T" is satisfied turn 1). Eldam on-SS: search 1 RT
   monster from deck → **pick Swen** (80538047).
3. **SS Swen from hand** (SELECT_IDLECMD → Swen SS-self; same condition).
   Swen on-SS: search 1 RT Spell/Trap or MST from deck → **pick Chant**
   (67115133).
4. Field: Eldam, Swen. Hand: Krosea, Vision, Fuwalos, Chant.
5. **Xyz summon** using Eldam + Swen → **Totem Bird** (step 3 of user
   line). **Risk**: Eldam and Swen are Lv4, Totem Bird requires Rank 3.
   If illegal at trace-assist, substitute with a Rank 4 Xyz from extra,
   OR defer Totem Bird to later (Krosea + second Lv3 body path).

### Phase 2 — Chant → Krosea → engine searches

6. **Activate Chant** (SELECT_IDLECMD → Chant, effect 1: search Lv4-
   RT monster from deck) → **pick Meghala** (27755794). **Chain Link 2:
   Krosea SS-self from hand** (triggered by Chant Quick-Play activation).
7. Chain resolves: Krosea SS (CL2 resolves first), then Chant search
   (CL1 resolves). Krosea on-NS/SS (resolves as trigger AFTER chain):
   search 1 RT card + 1 MST from deck/GY → **pick Ascendance**
   (25940932) + **MST** (5318639). **WIND-only SS lock active rest of
   turn** — no impact (all further SS are WIND).
8. Field: Totem Bird (if step 5 legal), Krosea. Hand: Vision, Fuwalos,
   Meghala, Ascendance, MST.

### Phase 3 — Meghala SS + Ascendance recycle

9. **SS Meghala from hand** (Meghala SS-self; opp still no S/T → valid).
   Meghala on-SS has no "when I'm SS'd" clause — its trigger is on RT
   Quick-Play or MST activation.
10. **Activate Ascendance** (Quick-Play). **Chain Link 2: Meghala's
    trigger → SS 1 RT monster from deck with different name** →
    **pick Varuroon Vibrant Vortex** (53927851). Chain Link 3 potential:
    **Varuroon Vortex SS-self from hand on Quick-Play activation** — BUT
    we're SS'ing Vortex from DECK via Meghala, not from hand, so Vortex
    hand-SS clause is moot here.
11. Chain resolves: Meghala SS Vortex from deck (CL2), Ascendance
    effect (CL1) → **pick MST-search clause: add MST from deck/GY**
    → 2nd MST in hand.
12. **Activate MST targeting Ascendance** (step 7 in user line).
    **Chain Link 2: Ascendance self-chain? NO** — Ascendance's two
    effects are "SS Lv6- RT from GY" or "add MST from deck/GY". Neither
    is a chainable "in response to destruction" effect. The self-set
    clause ("If destroyed by MST: Set this card") is a **trigger effect
    that fires after resolution**, not a CL2 chainable. So MST
    targeting Ascendance resolves alone → Ascendance destroyed → trigger
    fires → Ascendance sets itself face-down from GY.
13. User line step 7 says "chain MST target ascendance pour le détruire"
    — implies a chainable response. Re-reading Ascendance: "Activate 1
    of these effects" — this IS the activation window. At MST CL1,
    Ascendance is face-up on field (just activated at step 10). MST
    targets Ascendance → Ascendance **chains one of its two effects as
    CL2** (using the activation effect window, since it's still on
    field as a face-up Quick-Play that hasn't resolved-and-left yet —
    actually after step 10 resolution it **does** leave the field to
    GY). **Flag**: exact timing of Quick-Play → GY vs chainability
    needs trace-assist verification.
14. After MST resolves, Ascendance destroyed → self-set trigger fires
    → Ascendance face-down in SZONE.

### Phase 4 — Varuroon Marine Eidolon Link + Mandate placement

15. **Link-2 summon**: materials = Krosea + Meghala → **Radiant Typhoon
    Varuroon, the Marine Eidolon** (39341885). Varuroon Link-SS
    trigger: add 1 MST from deck/GY → **3rd MST in hand**. (User
    step 10: "Effet link 2 varuroon à l'invocation pour add MST" —
    matches.)
16. **Activate 3rd MST targeting Ascendance** (set face-down from step
    14). User step 11. **Chain Link 2: Varuroon Marine Eidolon's
    on-Quick-Play trigger → place 1 RT Continuous Trap from deck/GY
    face-up** → **Mandate** (53813120) face-up on SZONE. **Chain Link
    3: Ascendance (set → flip) activates in response?** User step 12
    says "En réso, varuroon link 2 C1 pour set du deck mandate et
    ascendance C2 pour se reset". This implies Varuroon is CL1 and
    Ascendance CL2 (order reversed from my analysis) — meaning
    Varuroon's trigger goes on chain first, then Ascendance chains its
    own activation. Trace-assist will determine the exact
    SELECT_CHAIN order. The net outcome is: Mandate face-up on SZONE,
    Ascendance destroyed again → self-set trigger → Ascendance back to
    SZONE face-down.
17. Field: Totem Bird (if applicable), Varuroon Marine Eidolon, Vortex.
    SZONE: Mandate (face-up continuous), Ascendance (set), plus
    previously-activated spells in GY.

### Phase 5 — Set MSTs + Hraesvelgr Link-3

18. **Set remaining MST(s) face-down in SZONE** (user step 13). Any
    MSTs remaining in hand are set — these become opp-turn ammunition
    for Mandate's omni-negate clause.
19. **Link-3 summon Hraesvelgr**: materials = Varuroon Marine Eidolon
    + Varuroon Vortex (both on field). Hraesvelgr text: "2+ WIND
    monsters" — 2 materials minimum. **Both Marine Eidolon and Vortex
    are WIND → valid.** Hraesvelgr SS'd into EMZ or MZONE.
20. Field: Totem Bird (if step 5 succeeded), Hraesvelgr.
    SZONE: Mandate (face-up), Ascendance (set), MST(s) (set).

### End of Turn 1

Final endboard targets (5 pieces):
- MZONE: Totem Bird (Rank 3, attack) — **CONTINGENT on step 5 legality**
- EMZ/MZONE: Hraesvelgr (Link-3, attack)
- SZONE: Mandate (face-up continuous trap, active)
- SZONE: Ascendance (set)
- SZONE: MST (set, ×1+)

## Known card IDs for quick lookup during trace-assist

| CardId | Name | Role |
|---|---|---|
| 54143349 | Radiant Typhoon Eldam | Hand starter (Lv4 WIND) |
| 67115133 | Radiant Typhoon Chant | Hand — Quick-Play searcher |
| 16922142 | Radiant Typhoon Krosea | Hand — Lv3 WIND, tribute-less trigger body |
| 20508881 | Radiant Typhoon Vision | Hand — Quick-Play (unused this line) |
| 42141493 | Mulcharmy Fuwalos | Hand — dead handtrap |
| 80538047 | Radiant Typhoon Swen | Deck — searched by Eldam (Lv4 WIND) |
| 27755794 | Radiant Typhoon Meghala | Deck — searched by Chant |
| 53927851 | Radiant Typhoon Varuroon, the Vibrant Vortex | Deck — SS'd by Meghala |
| 25940932 | Radiant Typhoon Ascendance | Deck — searched by Krosea, endboard set |
| 5318639 | Mystical Space Typhoon | Deck — searched by Krosea/Swen/Varuroon |
| 53813120 | Radiant Typhoon Mandate | Deck — placed by Varuroon Marine Eidolon, endboard face-up |
| 94103142 | Radiant Typhoon Manifestation | Deck (alt, not used this line) |
| 85315450 | Radiant Typhoon Fonix, the Great Flame | Deck (alt boss, not used) |
| 39341885 | Radiant Typhoon Varuroon, the Marine Eidolon | Extra — Link-2 |
| 71068247 | Totem Bird | Extra — Rank 3 Xyz (level mismatch flag) |
| 49105782 | Hraesvelgr, the Desperate Doom Eagle | Extra — Link-3 finisher |

## Confirmed constraints summary

- **Turn-1 SS-self conditions trivially met**: opp controls no S/T →
  Eldam/Swen/Meghala/Vortex all can SS-self from hand without needing
  MST-in-GY bootstrap.
- **WIND-only lock (Krosea, Meghala)**: non-binding — all targets are
  WIND monsters.
- **MST is NOT OPT**: multiple copies activate in the same turn.
  Copies enter GY, enabling re-activation of downstream RT clauses
  (Vortex-from-GY, Meghala-from-GY-hand-condition for future turns).
- **Once/turn clauses are card-named**, not per-instance: Ascendance's
  two effects are each once/turn, but the self-set clause is a
  separate trigger that re-enables the activation window on each
  re-set.
- **Totem Bird rank vs Eldam/Swen level mismatch** (see caveats).
  Potential step-3 substitution needed.
- **Chain timing for MST→Ascendance→Varuroon**: user's shorthand
  ordering (Varuroon CL1, Ascendance CL2) will need trace-assist
  validation against the actual SELECT_CHAIN prompt order.

## Action plan

Proceed with trace-assist — iterate step-by-step, using this doc as
reference.

Expected number of steps: 40-60 (mid-complexity combo).
Expected undo count: 5-15 (step 3 Totem Bird legality + chain-order
ambiguities at steps 13 and 16 will likely require re-attempts).
Expected total session time: 60-90 minutes.
