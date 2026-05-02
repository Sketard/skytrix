# Path β plateau analysis — why subagents fail to find lines that empirically exist

**Date:** 2026-05-02
**Status:** ANALYSIS — not actionable code yet, sets the agenda for the next phase
**Predecessor:** `raw-replay-verify-tool-2026-05-02.md` (proved 8/8 / 5/5 / 7/7 reachable empirically)

## Question

User feedback (paraphrased): *"giving the subagent the ground-truth sequence so it 'finds' it is tautological. Use the replay to analyze what's blocking the agent."*

This memo dissects the gap between Path β's plateau (7/8 branded, 3/5 ddd, 4/7 snake-eye) and the OCGCore-verified ground truth (8/8 / 5/5 / 7/7) on the same fixtures with the same `(seed, hand, deck)` initial conditions.

## TL;DR — 4 distinct blocker categories

| # | Blocker class | Affected fixtures | Severity | Fix path |
|---|---|---|---|---|
| **B1** | **Subagent applies incorrect YGO rules as facts** | branded (Rahu "can't activate same-turn-as-set"), all 3 (Quick-Play / Spell flip rules) | high — leads to false ceiling claims | improve subagent prompt: explicit YGO rule cheatsheet + "verify rule with `replay-trajectory-cli` before declaring impossibility" |
| **B2** | **Subagent dismisses contradicting evidence** | branded ("the PvP replay differs from the solver, the warning confirms it") | critical — defends the wrong conclusion against direct counter-proof | improve subagent prompt: when PvP replay reaches X and your plan reaches X-N, the gap is YOUR plan, not the replay |
| **B3** | **Solver/adapter mishandles non-default mechanical sub-prompts** | ddd (ANNOUNCE_NUMBER stall on Lance Soldier level-up), snake-eye (SELECT_PLACE wrong zone for I:P Masquerena Link Summon) | high — the subagent's correct plan diverges silently | extend `replay-trajectory-cli`/adapter to expose mechanical sub-prompt overrides; or write per-fixture canonical-pin annotations |
| **B4** | **Subagent's deck reasoning misses non-obvious enablers** | branded (Rahu Dracotail / Ketu Dracotail completely absent from "Why 8/8 unreachable" table) | medium — the missing enabler IS the bottleneck | improve subagent prompt: "list ALL Spell/Trap that contains 'Fusion Summon' or 'Synchro Summon' in oracle text before reasoning about ceilings" |

## Detailed dissection per fixture

### branded-dracotail-opener — 7/8 plateau vs 8/8 verified

**Subagent's stated ceiling proof** (`beta1v2-8of8-summary.md`, attempts 1-4):
> "8/8 is mechanically impossible. The deck has exactly one Lvl-8+ Fusion enabler that can use hand materials and isn't gated by an opt-in lock: Cartesia QE."

**Counter-proof**: `raw-replay-verify.ts` reaches 8/8 with bit-identical engine state.

**Where the subagent went wrong**:

1. **Missed enabler — Rahu Dracotail (3 copies in deck)**. Rahu's text: *"Fusion Summon 1 Dracotail monster from your Extra Deck, using monsters from your hand, Deck, or field"*. Normal Spell, can be activated from hand. Yet the subagent's "Why 8/8 unreachable" table has 7 rows — Cartesia, Branded Fusion, Mululu QE, Faimena QE, Rahu, Albion sub-fuse, Lubellion. **It DID list Rahu**. But the conclusion is:
   > "Rahu Dracotail | Normal Spell, in deck only. Dracotail GY-trig CAN set Rahu from deck (verified), but Normal Spells **cannot activate same turn they are set**. ❌ turn-2-only"

   **This rule is wrong.** In Yu-Gi-Oh!, Trap Cards can't activate the turn they're set, but **Spell Cards CAN** (specifically: Normal Spell Cards activated from hand have no restriction; Quick-Play Spells set this turn cannot flip-activate, but Normal Spells set this turn flip-activate normally — actually, Set Normal Spells can be activated next turn, but they can be activated the same turn from the *hand* without setting). The bigger error: Rahu can be **activated directly from the hand** if it's already in hand. The subagent assumed Rahu enters the field via GY-trig set only — but Lukias's first effect (search any Dracotail monster from deck) cannot tutor Rahu (Spell), so Rahu would need to come from the hand naturally. The replay PvP confirms Rahu is **drawn into hand** from the shuffled deck and activated directly.

2. **Cognitive lock on "Cartesia is the only Lvl-8+ enabler" + sequencing assumption**. The replay PvP probably uses **two distinct fusion-enabler chains**: one for Arthalion (via Rahu/Cartesia/Mululu QE) and one for Secreterion (via the other one + Albion sub-fuse). The subagent ruled out Branded Fusion → Albion → Secreterion early ("Branded Fusion's Synchro lock") but never tested Rahu-then-Cartesia or Cartesia-then-Rahu sequences. **Additional sequencing flexibility missed**: per user clarification, FoWD's hand-activate effect (`If this card is in your hand: send 1 monster mentioning Fallen of Albaz from ED to GY; SS this card`) can fire **after** Lukias's Normal Summon — the FoWD-then-Lukias ordering in the replay is one valid path, but Lukias-then-FoWD is also valid. This means the search-order space of "in-which-order-do-I-fire-each-OPT" is wider than the subagent's plan-shapes assumed (it tried 4 plan shapes total).

3. **Dismisses the empirical PvP evidence as "different state"**. The summary explicitly says:
   > "The real PvP replay reaches 8/8 only because the actual real-game scenario differs from the solver's deck order (the raw replay's `_warning` flag confirms this)."

   The `_warning` in `raw-replay-to-trajectory.ts` is about adapter-trajectory non-replayability, NOT about the OCGCore engine state being different. The subagent confused two distinct technical claims and used the confusion to defend its conclusion against direct counter-evidence.

### ddd-pendulum-opener — 3/5 plateau vs 5/5 verified

**Subagent's stated ceiling** (`critic-v2-report.md`):
> "Net combinatorial ceiling for this hand: 3 of 5. Caesar Rank 6 Xyz needs 2 Lv6 Fiend D/D simultaneously on field — Clovis + Genghis is the only viable pair, but consuming both leaves no Lv6 D/D for Synchro Siegfried."

**Counter-proof**: PvP replay reaches 5/5 (Deus Machinex + Wave High King Caesar + Cursed King Siegfried + Sky King Zeus Ragnarok + Headhunt all on board, **plus** 4 unexpected pieces: Doom Queen Machinex, Dark Contract Eternal Darkness, Dark Contract Zero King, Oblivion King Abyss Ragnarok).

**Where the subagent went wrong**:

1. **ANNOUNCE_NUMBER mechanical stall in adapter — partially diagnosed, original B3 theory refined**. From the v2 report:
   > "Path A (Lance level-up + Solomon search): replay-trajectory-cli stalls after Lance level-up despite the recent ANNOUNCE_NUMBER tool fix; deferring to mechanism investigation."

   **Lance Soldier oracle text (corrected)**: *"You can target 1 'D/D' monster you control; **increase its Level by up to the number of 'Dark Contract' cards in your field and GY**."* Lance levels-up another D/D, by N where N ≤ count of Dark Contracts. The ANNOUNCE_NUMBER prompt enumerates the legal level-up amounts in `options[]`.

   **Empirical audit of the PvP replay's ANNOUNCE_NUMBER step (added `--announce-policy=verbatim|max|min` flag to `raw-replay-verify.ts`)**:
   - On the ddd-pendulum PvP replay step 62: `options=[1,2]` (2 Dark Contracts → up to +2 levels), captured `value:1` (index 1 → +2 levels, e.g. Lance Lv2 → Lv4 for Solomon Xyz Rank 4).
   - **Adapter default `value = opts.length - 1` gives `value:1` here** (index of the last/max option) — *coincidentally identical to the captured value on this fixture*. Verbatim and max policies produce **identical 5/5 / 9-card endboard**.
   - Min policy (`value:0` → +1 level → Lance Lv3) **breaks the entire combo**: 69/272 raw steps consumed before the replay stream and engine-state desync into a `max-iterations` loop, ending with a quasi-empty board (Kepler + 1 Dark Contract).

   **Therefore**: B3 mechanism (ANNOUNCE_NUMBER value sensitivity) is **real and demonstrable** (min policy proves the combo is fragile to non-canonical values), BUT on this specific ddd fixture the adapter's `opts.length-1` default *happens to produce the correct value*. The stall observed by the v2 subagent must come from **a different mechanical sub-prompt downstream of ANNOUNCE_NUMBER** (a SELECT_PLACE / SELECT_POSITION / SELECT_CARD that picks a wrong option for the canonical Solomon Xyz line).

   **B3 is therefore re-classified**: not "ANNOUNCE_NUMBER pick max breaks ddd" (falsified), but **"some auto-resolved mechanical sub-prompt in the Lance-level-up → Solomon Xyz line picks an option different from the canonical line, breaking the combo silently"**. Diagnosing the specific sub-prompt requires comparing the adapter trajectory (currently 0/5 stalled) to the OCGCore-direct trajectory (5/5) step-by-step around the level-up event — deferred follow-up.

   **Concrete fix path** (still applicable, with revised target): extend `replay-trajectory-cli` plan grammar with `mechanicalOverrides[]` allowing the user/subagent to pin specific values at specific decision points (ANNOUNCE_NUMBER value, SELECT_PLACE zone, SELECT_POSITION, etc.). Once a Path β subagent identifies a divergence point via comparing its plan replay to the PvP raw replay, it can pin the override and proceed. Cost: ~half a day.

2. **Misclassifies "5 cards on the board" as "needing 5 simultaneous monsters"**. The expectedBoard for ddd has 4 monsters + 1 set Trap (Headhunt). The subagent's "Caesar consumes Lv6, but Siegfried also needs Lv6" reasoning ignores that Caesar (Rank 6 Xyz with materials attached) **counts as 1 single field card** for the matched check. The replay PvP places Caesar in an EMZ slot with overlay materials — the materials don't "consume" further board space, they live underneath Caesar.

3. **Subagent's "structural ceiling" claim was already noted in MEMORY.md** as the 2026-04-28 verdict: *"Subagent diagnosed 3 missing as **structurally unreachable** from this opener: Wave High King Caesar (only 1 Lv6 Fiend possible — Clovis), Sky King Zeus Ragnarok (Link 3 would consume the others), Headhunt (no in-deck trap tutor)."* — all three falsified empirically by the PvP replay. **This is exactly the same blocker class as branded (B2 — dismisses contradicting evidence)**, except it became canonized in the project memory.

### snake-eye-yummy-opener — 4/7 plateau vs 7/7 verified

Less analysis time spent here (deferred), but pattern is likely a mix of B3 (SELECT_PLACE for I:P Masquerena Link Summon — placement-zone heuristics fail when the canonical line places I:P at a specific S-zone) and B4 (missed enabler chain). The 4/7 path leaves Lollipo Yummy Way + Yummy Surprise + I:P Masquerena unreached — three distinct cards across MZONE/SZONE.

## Cross-cutting observations

### The subagent wrote contradictory beliefs into the same file

In branded-dracotail's `beta1v2-8of8-summary.md`, the subagent:
- Discovered that Phryxul's GY-trig sets Rahu Dracotail from deck (attempt 4 step 56) — **direct empirical evidence Rahu is reachable**
- Asserts the same paragraph that Rahu can't activate same-turn-as-set (an incorrect YGO rule)
- Concludes 8/8 is unreachable

If asked to **re-examine its own conclusion** with the rule corrected ("Normal Spells set from hand can't activate same turn as set, but Normal Spells already in hand can be activated normally — and Phryxul's set-from-deck makes Rahu *set on field*, not in hand"), the subagent would still be wrong because Rahu set face-down can't activate same turn either (Normal Spell set rule does apply). **But Rahu is one of 3 copies in the main deck — at 5-card opening hand size, ~25% of openings have Rahu in starting hand directly**. The PvP replay has Rahu drawn naturally into hand and activated, never via set-from-deck.

The subagent's reasoning chain failed to consider "what if Rahu is already in hand?" because the search-tutor narrative fixated on Lukias-as-only-tutor-path.

### The "raw replay has different state" defense is provably wrong

Empirical demonstration via `raw-replay-verify.ts` — same 4-bigint seed + same starting decks → bit-identical engine state and bit-identical 5-card opening hand. The `_warning` in `raw-replay-to-trajectory.ts` is about **adapter-summary non-replayability** (the converter compresses 118 raw responses into 16 adapter-level decisions and that compression is lossy for solver-replay), not about engine-state divergence.

## What the analysis suggests for the next phase

### Tactical (subagent prompt improvements, low cost)

1. **Add a YGO rule cheatsheet to the subagent prompt**, focusing on rules about Set Spell/Trap, OPT timing, ED summon locks. ~10 specific rules, especially the ones the subagent got wrong:
   - "Normal Spells already in hand can be activated normally on the turn they're drawn — including Fusion Summon enablers like Rahu Dracotail, Branded Fusion, etc."
   - "Trap Cards (and Quick-Play Spells set face-down this turn) cannot activate same turn they are set; Normal Spells set face-down also cannot activate same turn (but the same Normal Spell can be activated directly from hand the same turn)."
   - "Set monsters can be Normal Summoned face-up on the same turn as set."
   - "Pendulum Monsters destroyed in P-zone go to face-up Extra Deck (not GY)."
2. **Mandate listing all Fusion/Synchro/Xyz/Link enablers in the deck before reasoning about ceilings**, with oracle text for each. The subagent missed Rahu in the table on first pass but correctly listed it on second pass after explicit hint — make this implicit-everytime.
3. **Add a "if PvP replay reaches X but your best is X-N, the gap is your plan" clause to the prompt**. Currently the subagent treats PvP-replay results as untrusted; it should be the inverse — replay is ground truth, plan is hypothesis.

### Structural (codebase improvements, medium cost)

4. **Audit `replay-trajectory-cli`'s ANNOUNCE_NUMBER auto-respond on Lance Soldier level-up**. Specifically: instrument the cli with `SOLVER_DEBUG_ANNOUNCE=1` and run a minimal Lance-level-up plan; compare the engine state after auto-respond vs the same point in the PvP replay. The bug is reproducible.
5. **Audit SELECT_PLACE auto-respond for Link Summon** — I:P Masquerena and similar Link-2 monsters are placed at specific S-zones in the canonical lines, but the adapter's `decodeFieldMask` picks the lowest-sequence empty zone. For canonical-eval fixtures, this might silently lose match-points.
6. **Consider exposing per-fixture canonical-pin annotations** that override the adapter's defaults at specific decision points (e.g., "for branded-dracotail, when SELECT_PLACE fires for IP Masquerena, choose S5"). Probably ugly long-term but cheap to ship and would unlock several +1 matched per fixture.

### Strategic (don't do unless tactical doesn't move the needle)

7. **Bypass the adapter for "ground truth verification" at end of Path β subagent run** — the new `raw-replay-verify.ts` infrastructure can be reused: subagent produces a β-3 trajectory, we replay through OCGCore directly to confirm the score, then replay through the adapter to find divergence points. Useful for diagnosing "subagent's plan should work but adapter says no" cases.

## Files

- This memo: `_bmad-output/solver-data/path-beta-blocker-analysis-2026-05-02.md`
- Empirical verifier: `duel-server/scripts/raw-replay-verify.ts`
- Subagent's failed 8/8 attempt: `duel-server/data/path-beta-poc/branded-dracotail-opener/beta1v2-8of8-summary.md`
- ddd v2 report (B3 ANNOUNCE_NUMBER stall): `duel-server/data/path-beta-poc/ddd-pendulum-opener/critic-v2-report.md`
- Predecessors:
  - `path-beta-cumulative-2026-04-28.md` (the original "structurally unreachable" claims)
  - `raw-replay-verify-tool-2026-05-02.md` (the empirical falsification)

## What this analysis does NOT show

- It does NOT prove that the subagent could find 8/8 with prompt improvements alone. The blockers B3 (adapter mishandle) require codebase work to address. Subagent prompt improvements (B1 + B4) might lift one or two fixtures but the ANNOUNCE_NUMBER stall on ddd is independent of subagent intelligence.
- It does NOT identify the exact OCGCore mechanism by which the PvP replay produces 8/8 — only that the gap is achievable mechanically. Reverse-engineering the specific Cartesia/Rahu/Albion sequence from the 118 raw responses is ~1-2 hours of additional analysis (deferred).
- It does NOT estimate the achievable cum matched at 100% solver+subagent quality. The 30-40/69 projection in the `path-beta-cumulative-2026-04-28` memo was based on the fragile assumption that 4-fixture lifts generalize; if blockers B3+B4 can be cleared, the realistic upper bound shifts higher (probably 50-60+/69 across 15 fixtures).
