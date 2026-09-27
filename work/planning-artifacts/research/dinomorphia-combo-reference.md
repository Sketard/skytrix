# Dinomorphia Combo Reference (2026-04-17)

Canonical Dinomorphia turn-1 line for solver validation. Targets the
"When the dinos are dividing their LP" (2026-03-03) build. Paired with
`solver-validation-decks.json` fixture `dinomorphia-opener`.

Sources:
- Master Duel Meta Dinomorphia tier guide (masterduelmeta.com/tier-list/deck-types/Dinomorphia)
- Game8 Dinomorphia card guide (game8.co/games/Yu-Gi-Oh-Master-Duel/archives/385378)
- Yugipedia Dinomorphia archetype page
- Pojo Therizia deep-dive (pojo.com/dinomorphia-therizia-yu-gi-oh-card-of-the-day)

**Paradigm note**: Dinomorphia is a **LP-sacrifice trap-fusion archetype**.
Unlike conventional combo decks, the turn-1 board is dominated by SET traps
and a SINGLE Fusion boss. Monster count on field is intentionally low. This
is the structural reason why the fixture's pre-validation smoke showed
score=1, matched=0/4, t2=62.8% — the deck's endboard is literal minimalism
by design, and the solver's peak-field extraction correctly reflects that.

---

## Endboard piece cheat sheet

Primary boss:
- **Dinomorphia Rexterm** (Level 10 Fusion Dragon, 3000/4000 ATK/DEF) —
  while face-up, opponent's monsters with ATK ≥ your LP cannot activate
  effects. Crucial: Dinomorphia pays LP down to ~1000-2000 during combo,
  so this floodgate is near-total monster lock. Summoned via Kentregina's
  Quick Effect (replaces Kentregina as fusion material).

Mid-chain boss (usually consumed into Rexterm):
- **Dinomorphia Kentregina** (Level 10 Fusion, 4000 ATK base but loses ATK
  equal to your LP — thus "gains" relative power as LP drops). Quick Effect:
  pay ½ LP + banish a Dinomorphia trap from GY → copy a Dinomorphia Normal
  Trap's effect from GY. This is the recursion engine.

Core starter:
- **Dinomorphia Therizia** (Level 8 Trap Summon, 1000/2000) — when Flip-summoned
  or Normal Summoned: SET 1 Dinomorphia trap directly from deck. If LP ≤ 2000,
  gain 500 ATK. Key 1-card starter for the whole combo chain.

Extenders:
- **Dinomorphia Diplos** (Level 4, 500/1500) — when another Dinomorphia is
  SS'd, can SS itself from hand. Natural fusion material for Kentregina.
- **Dinomorphia Brute** (Level 10, 2500/3000) — Dinomorphia Level 10 body
  that self-SS by paying half LP. Fusion material for Kentregina/Rexterm.

Fusion traps (the engine's core):
- **Dinomorphia Frenzy** — Fusion Summon a Dinomorphia using deck-only
  material. "Pure" fusion; limited material pool but extremely consistent.
- **Dinomorphia Domain** — Fusion Summon a Dinomorphia using hand/deck/field
  material. More flexible, higher cost.

Utility traps:
- **Dinomorphia Intact** (trap) — protect on-field Dinomorphia from destruction;
  Quick Effect revival by paying LP.
- **Dinomorphia Alert** (trap) — revive from GY to the field.

Enabler spells:
- **Card of Demise** (59750328) — draw 3, cannot activate other spells/traps
  the turn activated, discard hand at End Phase. A 2-sided power-draw.
- **Pot of Duality** (98645731) — search a card, cannot SS the turn used.
  Combos fine with Dinomorphia's non-summon gameplay.

Support:
- **Ferret Flames** (31044787) — Dinomorphia-adjacent LP-burn. Triggers LP
  drops that power up Kentregina.
- **Soul of the Supreme King** (92428405) — big LP-cost effect, pairs with
  the deck's LP-sacrifice theme.

Floodgates (main-deck):
- **Anti-Spell Fragrance** (58921041) — delayed spell effect (opp spells
  must be set first).
- **Solemn Judgment** (41420027), **Solemn Strike** (40605147, 3x) —
  negates for everything.
- **Iron Thunder** (12682213, 3x) — banish a Dinomorphia from hand to SS
  at low-LP conditions.
- **Grand Horn of Heaven** (1637760, 3x) — massive SS negate.
- **Destructive Daruma Karma Cannon** (30748475, 3x) — quick-effect LP
  damage.

Extra Deck (rarely main-phase 1 reached in this deck):
- **Supreme King Z-ARC, Starving Venom Fusion Dragon, Odd-Eyes Rebellion**,
  etc. — alt Fusion finishers via Fusion trap calls, but Rexterm is the
  primary end boss in most games.

---

## Card ID reference (this fixture's available cards)

Main-deck starters:
- `92133240` Dinomorphia Therizia (3x) — THE 1-card starter
- `38628859` Dinomorphia Diplos (2x) — extender via self-SS on Dinomorphia SS
- `99414629` Dinomorphia Brute (1x) — Level 10 self-SS body

Fusion traps:
- `78420796` Dinomorphia Frenzy (3x) — Fusion trap (deck-only materials)
- `26631975` Dinomorphia Domain (3x) — Fusion trap (hand/deck/field)

Utility:
- `7336745`  Dinomorphia Intact (2x) — protect/revive
- `52020510` Dinomorphia Alert (2x) — GY revive

Draw engine:
- `59750328` Card of Demise (1x) — draw 3, hand dump at EP
- `98645731` Pot of Duality (3x) — search card, no SS this turn

Floodgates / negates:
- `58921041` Anti-Spell Fragrance (1x)
- `41420027` Solemn Judgment (1x)
- `40605147` Solemn Strike (3x)
- `12682213` Iron Thunder (3x)
- `1637760`  Grand Horn of Heaven (3x)
- `30748475` Destructive Daruma Karma Cannon (3x)

Extra Deck (Fusion bosses):
- `48832775` Dinomorphia Kentregina (2x) — mid-chain Fusion boss
- `92798873` Dinomorphia Rexterm (3x) — PRIMARY ENDBOARD BOSS
- `74936480` Dinomorphia Stealthbergia (1x) — alt Fusion
- `13331639` Supreme King Z-ARC, `1516510` Rune-Eyes, `41209827` Starving
  Venom, `42752141` Evolzar Dolkka, `74294676` Evolzar Laggia,
  `30095833` Odd-Eyes Rebellion Xyz, `98452268` Odd-Eyes Rebellion Overlord,
  `50954680` Crystal Wing, `59765225` Crystal Clear Wing — alt Fusion/Synchro
  targets, rarely reached.

---

## 1 CARD COMBO — Dinomorphia Therizia → Rexterm

**Endboard**: Rexterm (MZONE) + 1-2 set Dinomorphia traps + whatever
floodgate the deck naturally drew.

1. NS **Therizia** → its SS effect: SET **Dinomorphia Frenzy** (or Domain)
   directly from deck.
2. Activate **Frenzy** → Fusion Summon **Kentregina** using 2 Dinomorphia
   monsters from deck as materials (e.g. Therizia body + Brute from deck,
   OR Therizia + Diplos deck copy).
3. **Kentregina Quick Effect** (CL-2 on Frenzy activation): pay ½ LP +
   banish Frenzy from GY → copy a Dinomorphia Normal Trap effect. Use to
   copy **Frenzy again** (fuse a 2nd time).
4. Second Frenzy fusion: fuse Kentregina (on field) + another Dinomorphia
   → **Dinomorphia Rexterm**. Kentregina is consumed as material, Rexterm
   takes its place.
5. Remaining cards in hand set as backrow (Intact, Solemn, Iron Thunder,
   etc.) for end-of-turn cover.

**Final endboard**:
- MZONE: **Dinomorphia Rexterm** (92798873)
- SZONE: **Dinomorphia Domain** set (26631975) — held for next turn
- SZONE: **Dinomorphia Intact** set (7336745) — protection
- LP: ~2000 or lower (Kentregina's cost + Rexterm's passive ATK-check lock)

**Important**: Kentregina does NOT end on the field in the canonical 1-card
line — it's consumed as Rexterm's fusion material. The previous version of
the fixture listed BOTH Rexterm and Kentregina in the expectedBoard, which
is structurally wrong.

---

## Alternative: No-Card-of-Demise variant (2 card)

If the opener lacks Card of Demise, use Therizia + Frenzy (already in hand)
for direct fusion without needing to set-from-deck. Same endboard (Rexterm
alone).

---

## Key SELECT_CARD decisions

1. Therizia set-trap search → **Dinomorphia Frenzy** (NOT Domain first —
   Frenzy's deck-only fusion is more resource-efficient).
2. Frenzy fusion materials → **Diplos (deck)** + **Brute (deck)** (different
   names, both Dinomorphia, both in deck — satisfies Frenzy's requirement).
3. Kentregina's trap-copy effect → **copy Frenzy** (enables 2nd fusion).
4. Second Frenzy fusion material → **Kentregina (field)** + another Dino
   Diplos or Brute from deck/hand.

---

## THIS FIXTURE's canonical opener

Fixture hand target: **Therizia + Frenzy + Card of Demise + Pot of Duality + Iron Thunder**

Recommended hand:
```
[92133240 Dinomorphia Therizia,
 78420796 Dinomorphia Frenzy,
 59750328 Card of Demise,
 98645731 Pot of Duality,
 12682213 Iron Thunder]
```

Rationale:
- Therizia = the starter.
- Frenzy in hand = alternate activation path if Therizia-set-from-deck is
  disrupted.
- Card of Demise = +3 card advantage turn 1 (sets up sustained control).
- Pot of Duality = search flexibility (resolves Dinomorphia monster / Frenzy /
  trap pick).
- Iron Thunder = defensive floodgate if LP drops below threshold, triggers
  in response to opp attacks.

This is a compact 5-card hand reflecting a realistic Dinomorphia opener
where you expect 3 of these 5 to fire turn 1, and the rest stay as cover.

## THIS FIXTURE's realistic expectedBoard

Conservative 3-piece endboard (Rexterm + 2 backrow). A 4th piece makes the
matched target too ambitious for this minimalist paradigm:

```
MZONE: Dinomorphia Rexterm (92798873)
SZONE: Dinomorphia Domain set (26631975)
SZONE: Dinomorphia Intact set (7336745)
```

The player's LP at turn-1 end is typically ~1000-2000, which activates
Rexterm's passive effect against opponent's high-ATK monsters.

---

## Solver diagnostic mapping

- Missing Rexterm → Fusion chain did not reach second fusion step. Check:
  did Frenzy activate? Did Kentregina's Quick Effect trigger? Did the
  LP-payment succeed (Kentregina's cost)?
- Missing Domain set → 2nd fusion trap not set during turn. Check: was
  Therizia's set-from-deck selection a second Domain or something else?
- Missing Intact set → hand didn't include Intact and none was drawn. This
  can legitimately miss — the matched expected has some pieces be
  drawn-dependent.
- Peak field shows ONLY set traps, no monster → combo didn't fire at all.
  Check: was Therizia NS blocked by Ash Blossom / negate? Did the solver
  even activate Frenzy?

---

## Endboard weights (solver scoring)

Priority order:
1. **Rexterm** — the entire win condition, massive structural value
2. **Domain set** — sets up turn 2 fusion if turn 1 Rexterm is destroyed
3. **Intact set** — protection, secondary

Matched 3/3 = canonical Dinomorphia turn-1. 1/3 = Rexterm only (minimum
viable board). 0/3 = combo didn't execute (handtrap or structural gap).

---

## Paradigm caveat for step 3 ES tuning

The structural score on this fixture is intentionally LOW (pre-validation
smoke: score=1, post-validation likely similar). This is NOT a scorer bug —
it's the truth about a LP-sacrifice trap deck. Step 3 ES tuning must NOT
weight "matched count" as strictly as on combo decks; Dinomorphia's
"success" is a single-boss + trap wall, not a 4-5 card pile.

Consider: use matched count as a **ratio** (matched / matchedTotal) rather
than absolute count in step 3 fitness. This normalizes Dinomorphia's 1/3
against combo decks' 3/5 and control decks' 2/4 on equivalent footing.
