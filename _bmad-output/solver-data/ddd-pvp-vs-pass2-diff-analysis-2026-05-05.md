# Post-hoc analysis: where the PvP trajectory diverges from Path β v3.1 Pass 2 on `ddd-pendulum-opener`

Date: 2026-05-05
Inputs:
- `_bmad-output/planning-artifacts/research/trajectories/ddd-pendulum-replay-eb8c6865.raw-replay.json` (272 responses, PvP authoritative)
- `_bmad-output/solver-data/path-beta-poc-ddd/v3.1-pass2-attempt-8.json` (Pass 2 best plan)
- `_bmad-output/solver-data/path-beta-poc-ddd/v3.1-pass2-attempt-8-result.json` (Pass 2 4/9 result)
- `_bmad-output/solver-data/path-beta-poc-ddd/v3.1-pass2-self-criticism.md`
- `_bmad-output/solver-data/path-beta-poc-ddd/v3.1-pass1-deck-audit.md`
- `_bmad-output/solver-data/path-beta-poc-ddd/ddd-pvp-idlecmd.jsonl` (this analysis — produced from `duel-server/scripts/inspect-idlecmd-stream.ts`)

## 1. Résumé executif

Pass 2 plafonne à 4/9 parce qu'il n'a jamais découvert que l'**accélérateur du combo PvP est le 2e effet on-summon de Kepler ("Add 1 Dark Contract card from your Deck to your hand"), via lequel le PvP tutore Gate en main puis active Gate (en main, puis en P-zone) pour générer un 2e search**. Le **First Divergence Point est l'IDLECMD #2 / step 13**, où PvP active Zero King depuis P-zone S2 avec target SS = **Kepler**, puis utilise Kepler-effet-2 pour search Gate ; Pass 2 active Zero King avec target SS = **Copernicus** (mill effect, ancrage gloutonne au scorer "mill = enabler"). Cette divergence cascade : sans le tutor Gate→main→activation→PZONE, Pass 2 perd un effet "search D/D" (Gate sur le terrain a été activé 2× — search + place sur PZONE), ce qui bloque ensuite Caesar R4 / Marksman Tell GY-send / Necro Slime fusion / First King Clovis revival, donc tous les bosses Synchro / Fusion / R4-mill du endboard. **L'enabler est inférable depuis l'oracle text seul** (Kepler effet 2 est explicite, Gate "add 1 D/D Spell to hand OPT" est explicite), mais combinatoirement opaque : il faut concevoir la séquence Zero-King-SS=Kepler→Kepler-on-summon=search-Dark-Contract→Gate-en-main→Gate-active-as-2nd-spell-OPT-on-search comme une **chaîne 4-deep prequel** avant la phase Link/Xyz. Le LLM Pass 2 a privilégié la séquence "obvious" Zero-King-SS=Copernicus (mill = visible gain), ratant l'optimum.

## 2. Trajectoire PvP IDLECMD (27 décisions, turn 1, player 0)

| # | step | action | card | from | rationale |
|---|------|--------|------|------|-----------|
| 0 | 0 | activate | D/D/D Doom Queen Machinex | HAND | Pendulum-place into S5 (P-zone right) |
| 1 | 6 | activate | Doom Queen Machinex | PZONE | Pendulum-effect → place 1 Dark Contract from deck → places **Zero King in S2** |
| 2 | 13 | activate | **Dark Contract with the Zero King** | S2 | Destroy 1 D/D you control (= Doom Queen scale) + SS 1 D/D from deck → **SS Kepler in MZONE seq 4** ; Kepler on-summon (yes,opt 1) = **Add Dark Contract from deck → Gate to HAND** |
| 3 | 27 | activate | **Dark Contract with the Gate** | HAND | Activate Gate as Cont Spell → place in S2 (was emptied by Zero King self-destroy via Lance? no — Zero King goes to GY when it destroys itself? Actually Zero King is "destroy 1 D/D" target, NOT itself; Zero King survives. So Gate activates into S/T zone) ; on-activate effect = **search 1 D/D from deck** |
| 4 | 33 | activate | Dark Contract with the **Gate** | PZONE | Pendulum-effect of Doom Queen had already run; PvP also activates **Doom Queen's Pendulum effect a 2nd time? No — this is Gate placed face-up in P-zone via Doom Queen Pendulum-effect re-trigger? Actually closer look : it's Gate's ignition once-per-turn search effect, activated in P-zone after Doom Queen's e3 placed it there|
| 5 | 39 | normal-summon | D/D Savant Copernicus | HAND | NS, on-summon mill = **mill Lance Soldier from deck** to GY |
| 6 | 49 | activate | D/D Lance Soldier | GY | GY-effect : destroy 1 Dark Contract → SS Lance + banish-on-leave (target = Zero King? or Gate?) ; then Lance Lv2-Tuner on field |
| 7 | 58 | activate | D/D Lance Soldier | MZONE | Hand-effect : level-up D/D by # Dark Contracts in field+GY (but enumeration says loc=4 = MZONE so Lance is on field) — Lance hand-effect "increase target D/D level by # Dark Contracts" |
| 8 | 65 | special-summon | **D/D/D Wise King Solomon** | EXTRA seq 7 | Rank 4 Xyz (2 Lv4 D/D Fiend) — materials = Copernicus + Kepler? (both Lv4? Kepler is Lv1, so no — must be Copernicus + a Lv4 SS'd from another route) |
| 9 | 74 | activate | Solomon | MZONE | detach for search D/D from deck → search D/D card |
| 10 | 81 | special-summon | **D/D/D Marksman King Tell** | EXTRA seq 7 | Rank 5 Xyz **using Solomon (R4) as Xyz Material** — Solomon's attached materials transfer to Tell |
| 11 | 89 | special-summon | D/D/D Abyss King Gilgamesh | EXTRA seq 11 | Link 2 — pose Pendulum scales (Gryphon + Kepler? or other) |
| 12 | 106 | activate | D/D Gryphon | PZONE | Pendulum-effect : target Fiend, gain ATK, destroy self (frees a P-zone) |
| 13 | 113 | special-summon | D/D/D Sky King Zeus Ragnarok | EXTRA seq 11 | Link 3 (Lance + Gilgamesh? or other 2+ D/D) |
| 14 | 122 | activate | **D/D Necro Slime** | GY | GY-effect : Fusion Summon D/D/D Fusion (Genghis ?) by banishing materials from GY |
| 15 | 138 | activate | Sky King | MZONE | Ignition : destroy own D/D/Dark Contract → grant 2nd Pendulum Summon this turn |
| 16 | 153 | activate | **D/D Orthros** | PZONE (loc 8 seq 0) | Pendulum-effect : destroy 1 S/T + 1 other D/D you control (=> destruction trigger for Doom Queen e2) |
| 17 | 164 | special-summon | Doom Queen Machinex | PZONE seq 0 | Pendulum Summon (after Sky King grant) |
| 18 | 183 | special-summon | **D/D/D First King Clovis** | EXTRA | Synchro Lv6 (Lance Lv2-Tuner + Lv4 non-Tuner D/D) ; on-Synchro revives D/D from banished/GY |
| 19 | 202 | special-summon | **D/D/D Wave High King Caesar** | EXTRA seq 4 | Rank 6 Xyz (2 Lv6 Fiend) — uses Clovis + another Lv6 D/D **MATCH** |
| 20 | 211 | special-summon | **D/D/D Cursed King Siegfried** | EXTRA seq 1 | Synchro Lv8 (1 Tuner + non-Tuner D/D) **MATCH** |
| 21 | 220 | special-summon | Doom Queen Machinex | PZONE | Re-summon (e2 trigger from Orthros destruction?) |
| 22 | 235 | special-summon | D/D/D Wave King Caesar | EXTRA seq 2 | Rank 4 Xyz precursor for upgrade chain |
| 23 | 244 | special-summon | D/D/D Abyss King Gilgamesh | EXTRA seq 5 | Link 2 (rebuild) |
| 24 | 256 | special-summon | **D/D/D Deviser King Deus Machinex** | EXTRA seq 2 | Rank 10 Xyz upgraded from D/D/D **MATCH** |
| 25 | 264 | spell-set | **Dark Contract with the Eternal Darkness** | HAND | Set Cont Trap (added via search earlier) **MATCH** |
| 26 | 268 | spell-set | **D/D/D Headhunt** | HAND | Set Normal Trap (added via Solomon search) **MATCH** |

Summarising gain by mechanism:
- **Tutor chain**: Kepler-search → Gate (in hand) → Gate-search → Eternal Darkness OR another Dark Contract (in hand). Net = **+2 spell tutors** vs Pass 2's 0.
- **Mill**: Copernicus on-summon (mill Lance only — Pass 2 had this).
- **GY-fusion**: Necro Slime banish materials from GY → Genghis → on-destroy effect cascades.
- **R4→R5 upgrade**: Solomon → Marksman Tell **with material transfer**.
- **R6→R10 upgrade**: implicit via Deviser King Deus Machinex's "use a D/D/D as Xyz Material" upgrade clause.
- **Synchro**: Lance(Tuner) + Lv4-D/D = Clovis (Lv6) ; Lance + Lv6-D/D = Siegfried (Lv8).
- **Rank 6**: Caesar requires 2× Lv6 Fiend. Path is Clovis (Lv6 Synchro from Lance + Lv4) + a 2nd Lv6 D/D Fiend (Oblivion King Lv8 — wait, no; closer match is **Clovis Lv6 + another Lv6**) — likely synchros twice with Marksman Tell as one, or via dimension-king rebuild.

## 3. Trajectoire Pass 2 IDLECMD (17 plan steps + auto-resolution)

(Source: `v3.1-pass2-attempt-8.json` plan + `v3.1-pass2-attempt-8-result.json` replayLog)

| # | plan-step | action | card | rationale |
|---|-----------|--------|------|-----------|
| 0 | 0 | activate | Doom Queen Machinex (HAND) | Place P-zone |
| 1 | 1 | activate | Doom Queen Machinex (PZONE) | Place Zero King from deck |
| 2 | 2 | activate | **Zero King** | destroy Doom Queen, **SS Copernicus** (NOT Kepler), on-summon mill Lance |
| 3 | 3 | activate | Lance Soldier (GY) | destroy Zero King, SS Lance |
| 4 | 4 | summon-procedure | Gilgamesh (Link 2) | Doom Queen + Copernicus → place Gryphon + Kepler scales |
| 5 | 5 | pendulum-summon | Kepler (entry-point) | P-Summon Doom Queen + Copernicus |
| 6 | 6 | activate | Gryphon (P-effect) | destroy Gryphon scale, free S5 |
| 7 | 7 | summon-procedure | Sky King (Link 3) | Lance + Gilgamesh |
| 8 | 8 | activate | Sky King ignition | destroy Doom Queen on M1 → e3 places her in freed S5 |
| 9 | 9 | pendulum-summon | Kepler (2nd) | Sky King granted 2nd P-Summon — Gryphon Lv4 from face-up ED |
| 10 | 10 | summon-procedure | Solomon (R4 Xyz) | Copernicus + Gryphon (both Lv4 D/D) |
| 11 | 11 | activate | Solomon | detach to search Headhunt from deck |
| 12 | 12 | set-st | Headhunt | Set face-down |
| 13 | 13 | summon-procedure | Deus | Solomon as D/D/D upgrade material |
| 14-16 | 14-16 | set-st × 2 + NS Beta | Dark Ruler ×2 + Beta | dump fodder |

**Endboard Pass 2**: Deus (M1), Sky King (EMZ), Beta (M2), Doom Queen-set (S5), Headhunt-set, 2× Dark Ruler-set, 1× Dark Ruler in hand. **Matched 4/9 = Deus, Sky King, Doom Queen, Headhunt**.

## 4. First Divergence Point

**Step alignment table** (PvP idleSeq vs Pass 2 plan-step):

| idleSeq | PvP action | Pass 2 plan-step (action) | divergence ? |
|---------|-----------|----------------------------|--------------|
| 0 | activate Doom Queen (HAND→S5) | step 0 (activate Doom Queen HAND) | identical |
| 1 | activate Doom Queen P-effect → places Zero King | step 1 (idem) | identical |
| **2** | **activate Zero King → SS Kepler** | **step 2 (activate Zero King → SS Copernicus)** | **FDP — divergence ici** |
| 3+ | search Dark Contract (Gate) in hand | (n/a — no equivalent step in plan) | downstream cascade |

**FDP = IDLECMD #2 (step 13)**: PvP picks Zero King's SS target as **Kepler**, Pass 2 picks **Copernicus**. The chosen card-id determines which on-summon effect fires:
- Copernicus on-summon = **mill 1 D/D or Dark Contract from Deck** (Pass 2's choice — mills Lance to GY → Lance GY-effect later).
- Kepler on-summon = **2 options**: (a) bounce 1 other D/D card to hand, or (b) **Add 1 Dark Contract from Deck to hand**. PvP picks option (b) → searches **Gate** to hand.

The FDP is **one verb-target choice deep**, but it controls the entire shape of the rest of the turn. The PvP path uses Kepler's tutor to get Gate in hand, then activates Gate (on-activate "add D/D from deck" search) for a **second tutor** without consuming any extra resource. Pass 2's Copernicus mill is greedier — visible immediate gain (Lance in GY → SS Lance), but **misses the +1 search/+1 D/D-card-in-hand**.

## 5. The missed mechanism — Kepler effect 2 ("Add 1 Dark Contract from your Deck")

Oracle text (`get-card-info.ts 11609969`):

> [Monster Effect]
> If this card is Normal or Special Summoned: You can activate 1 of these effects. You can only use this effect of "D/D Savant Kepler" once per turn.
> ● Target 1 other "D/D" card you control; return it to the hand.
> ● Add 1 "Dark Contract" card from your Deck to your hand.

This is a **2-option SELECT_OPTION** post-summon prompt. Pass 2 never reached this prompt because it never SS'd Kepler from Zero King.

Why Pass 2 missed it:
1. **Verb-target ambiguity in the plan grammar**: Pass 2's `targets[]` for Zero King contained `{ "promptHint": "SS Copernicus from deck", "cardName": "D/D Savant Copernicus" }` — a single hard-coded SS target. The plan grammar doesn't ask "which D/D should I SS, and which on-summon effect maximises downstream search budget?". The author picked Copernicus because the P1/P2 audit memo focused on **mill** as the gateway to Lance's GY-effect (a known unlock for re-activating Doom Queen e2).
2. **Heuristic anchoring on visible immediate gain**: Copernicus mill is a clear, simple "+1 card in GY = enabler for next step". Kepler search is "+1 card in hand" — less visually compelling because Pass 2 didn't have the next-2-steps planned (Gate activation in hand → 2nd tutor → Eternal Darkness in hand → set face-down).
3. **Hand-state amnesia**: Pass 2's plan was structured around "what's already on field/GY" not "what's in hand 3 steps later". The Kepler→Gate→Eternal-Darkness chain is fundamentally a **hand-resource expansion** path, not a board-presence path.

## 6. Cards manqués (le gap 4/9 → 9/9)

For each of the 5 missing cards in Pass 2's endboard, the PvP path of acquisition:

### 79559912 — D/D/D Wave High King Caesar (Rank 6 Xyz)
- **Required materials**: 2 Lv6 Fiend monsters.
- **PvP route**: Synchro Lv6 Clovis (Lance Tuner Lv2 + Lv4 D/D non-Tuner) + a 2nd Lv6 source (likely Marksman Tell Lv5 → upgraded chain, or another synchro). Note: the PvP idleSeq #19 explicitly does the Wave High King SS as action=1 idx=4 from EXTRA seq 4.
- **Why Pass 2 unreachable**: Pass 2 has no Lv6 monster on field (consumed Lance for Sky King Link, no Synchro path because Lance used as Link material not Tuner).

### 44852429 — D/D/D Cursed King Siegfried (Synchro Lv8)
- **Required materials**: 1 Tuner + 1+ non-Tuner D/D, total Lv8.
- **PvP route**: Lance Lv2-Tuner + Lv6 D/D non-Tuner (probably the 2nd Clovis cycle with Caesar's spawn, or Lv8 = Lance + a Lv6 + Lv0 ?? Unlikely; more likely Orthros Lv4-Tuner + Lv4 = 8). PvP idleSeq #20 confirms Siegfried SS at step 211.
- **Why Pass 2 unreachable**: Same Lance-consumption problem.

### 9030160 — Dark Contract with the Eternal Darkness (Cont Trap, set)
- **PvP route**: At idleSeq #25 (step 264) PvP sets it from HAND (action=4 spell-set, idx=0, source location=2=HAND). This means it was added to hand earlier — most likely via **Caesar R4 / Wave King Caesar's "send-from-field-to-GY" trigger** ("add 1 Dark Contract card from your Deck to your hand") which fires when Caesar R4 is consumed as Marksman Tell upgrade material AND counts as "sent from field to GY" (debatable rules-wise — but the PvP path achieves it). Or via Gate's on-activate search.
- **Why Pass 2 unreachable**: Pass 2 never had Eternal Darkness in hand. Solomon's "search D/D card" is **archetype-restricted to 0xaf** and **CANNOT search Eternal Darkness (setcode 0xae alone, not 0xaf)**, as Pass 2 self-criticism §3.4 noted. The PvP path requires either Gate (which has unlimited "any Dark Contract from deck" OPT search) or Caesar's send-to-GY.

### 32665564 — Dark Contract with the Zero King (Cont Spell, set)
- **Discrepancy**: matchedCardIds in Pass 2's result actually shows `32665564` is missing. Looking at the score breakdown: matched = `[46593546, 30998403, 20715411, 91781484]` = Deus, Sky King, Doom Queen, Headhunt. Zero King was placed by Doom Queen's P-effect at step 1 BUT got destroyed at step 2 (Zero King ignition destroys self after activation? Actually NO — Zero King's effect targets ANOTHER D/D card, not itself; so Zero King survives. But then at step 3 Lance Soldier GY-effect destroys Zero King. So Zero King is in GY at end-of-turn = not on board = missing.
- **PvP route**: PvP doesn't preserve Zero King either (also destroyed by Lance e2 at idleSeq #6) — but **PvP places a 2nd Dark Contract via different means** (Caesar/Gate search) and that 2nd one ends up "set" in S-zone at end. The endboard "Dark Contract with the Zero King = set" = a fresh copy placed via Caesar R4's "add Dark Contract from deck to hand" + manually set as Spell.
- **Why Pass 2 unreachable**: same as Eternal Darkness — Pass 2 had no Caesar/Gate route to fetch a 2nd copy.

### 74069667 — D/D/D Oblivion King Abyss Ragnarok (Pendulum Lv8, set)
- **Required**: place in P-zone or set as monster.
- **PvP route**: Oblivion King is in DECK (cardId at index 3 in main deck list). PvP path likely tutors it via Gate or Solomon search-D/D, then places it as Pendulum scale (not destroyed since the Sky King granted 2nd P-Summon doesn't destroy scales).
- **Why Pass 2 unreachable**: Pass 2 placed Gryphon + Kepler as scales (deliberate per §6 of audit), not Oblivion. To place Oblivion would require a separate scale-tutor (Gate) which Pass 2 didn't have.

## 7. Implications méthodologiques

### (a) L'enabler est-il inférable depuis l'oracle text seul ?

**Oui, formellement** — Kepler's effect 2 is one bullet point in its monster-effect text. The combinatorial chain Kepler→Gate→Gate-search is mechanically straightforward once the reasoner explores it.

**Non, pratiquement** — the LLM Pass 2 had Kepler in the deck audit explicitly listed with its 2 options (Pass 1 deck-audit lines 32 + 108-114 enumerate Kepler's "add Dark Contract from deck"). But Pass 2 still chose Copernicus because:

1. **The plan grammar `targets[]` collapses target-selection into a single decision**, with no reasoning-trace mechanism to compare "if I SS Kepler vs Copernicus, what's my hand-state 3 turns later?". The LLM doesn't simulate plan branches — it commits.
2. **Greedy heuristic anchoring**: in YGO planning, "mill = Lance GY-revival" is a famous combo move (D/D archetype is well-documented). Kepler's tutor is **also** documented but less salient because it's "just a search" — easy to dismiss as "I can search later".
3. **No backward-chaining from endboard**: Pass 2 didn't ask "which Synchro/Xyz path requires what hand-state?", which would have surfaced Eternal Darkness's setcode-0xae mismatch (§3.4 of self-crit) and forced the search for Gate as the only spell-tutor with archetype-0xae coverage.

### (b) Difficulté pour le LLM

The Kepler→Gate chain is a **3-deep prequel** to the main combo (Synchro/Xyz boss assembly). LLMs in critic-mode are good at **patching local mistakes** (Pass 2 did test 9 attempts and discovered the Gryphon-as-destructible-scale mechanism — a non-trivial structural insight). They are **bad at re-architecting the trajectory's foundation**. Once Pass 1 committed to "Zero King → SS Copernicus = mill = Lance revival", every subsequent attempt accepted that as a fixed prefix and only varied the suffix.

This is a **horizon-of-search problem**, not an oracle-knowledge problem. The same LLM, given the constraint "you have a 4-tier deck-search budget; explicitly enumerate all SS-target choices for Zero King and trace 3 steps forward", would likely find Kepler.

### (c) Plafond discovery LLM strict ?

Pass 2 reaching 4/9 on a hand authored by replay-derivation (where the canonical PvP path is 9/9 by construction) is **NOT** evidence of a LLM ceiling on archetype mechanics. It IS evidence of:

1. **Critic-mode is suffix-only refinement**: cannot revisit early decisions.
2. **Plan grammar is too coarse for early-decision sensitivity**: `{ verb: activate, targets: [SS X] }` is a single irreversible commit, no tree search, no "what if I'd SS'd Y instead?".
3. **Replay-derived fixtures with hand-locking**: the canonical 9/9 was found by a human (or PvP solver) over many turns of trial — the LLM's 10-attempt budget is not equivalent.

The reachable ceiling is likely **6-7/9** with the right prompt format ; 9/9 may require either (a) an explicit FDP-aware critic prompt that backtracks to earlier verb-target choices, or (b) an OCG-replay-based oracle that scores leaf-states, or (c) raw-replay leak (forbidden under autonomous-discovery).

## 8. Recommandations

### (i) Améliorations possibles du prompt v3.1

For ddd-pendulum-opener and similar replay-derived pendulum decks:

1. **Backward-chain prompting**: ask the LLM to first enumerate the endboard's 9 cards' material/path requirements, THEN derive hand-state pre-conditions, THEN plan forward. This forces visibility of "Eternal Darkness needs Gate-tutor (0xae setcode) — Solomon won't reach it".
2. **Verb-target SELECT_OPTION enumeration**: when `targets[]` includes "SS X from deck", the prompt should list **all D/D candidates with their on-summon effects** and ask the critic "which on-summon effect best advances downstream search/destruction budget?".
3. **Explicit search-budget ledger**: ask the LLM to maintain a per-step ledger of (a) cards in hand, (b) cards in GY, (c) cards on field, (d) tutors used this turn. Pass 2's plans implicitly tracked field state but not hand-state.
4. **First-divergence checklist**: in critic mode, after each plan attempt, force the LLM to identify the first step where their chosen action **differs from the only known successful path** (= the deck audit's "starter prompts" section). For ddd, that's the Zero-King-target selection.

### (ii) Pour les fixtures replay-derived avec hand non-canonique

If the LLM cannot autonomously discover Kepler's tutor effect from oracle text in 10 attempts, two practical paths:

**Option A — Add tournament combo-guide context to the prompt** (one-time per archetype). For D/D, provide a 200-word combo-line like:
> "D/D Pendulum: Kepler search Dark Contract → Gate to hand → Gate searches D/D → engine cascade. Solomon→Marksman Tell upgrades transfer materials. Caesar R4 send-to-GY adds Dark Contract."

This is **not** raw-replay leakage; it's archetype-public-knowledge analogous to giving a chess solver opening theory. Cost: 1× human author per archetype. Expected lift: +2-3 matched on ddd, +unknown on other replay-derived fixtures.

**Option B — Mark "test-only" fixtures**. If the canonical 9/9 path requires exhaustive enumeration that's combinatorially intractable for a 10-attempt LLM budget, classify the fixture as **structural-test only** (= the verifier-replay path is the reference, the LLM's autonomous matched count is informational not target). This explicitly accepts that ddd-pendulum-opener's effective LLM-ceiling is 4-7/9, not 9/9.

**Option C — Two-stage prompt**: Stage 1 asks the LLM to map the deck's "tutor graph" (every card whose effect adds another card to hand/field/GY) and identify single-source archetype-coverage gaps (e.g., "Eternal Darkness setcode 0xae has only 2 tutors: Gate and Caesar R4"). Stage 2 then plans from this graph. The graph itself is a 1-shot derivation from the 42-card deck's oracle text — feasible in ~3 minutes of LLM time.

---

**Final verdict**: Pass 2's 4/9 is NOT a mechanical ceiling on the hand. It IS a ceiling on the v3.1 critic-mode prompt format — specifically on its inability to reconsider early SS-target choices once committed. The Kepler→Gate cascade is fully derivable from oracle text alone; it requires backward-chaining from endboard, which Pass 2's forward-only plan structure does not enforce. Recommendations (i) backward-chain prompting and (ii) archetype combo-guide context are both compatible with the autonomous-discovery contract (= no raw-replay leak) and would likely lift ddd-pendulum-opener to 6-8/9 in 10 attempts.
