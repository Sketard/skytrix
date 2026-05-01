# Solver Validation Decks — Methodology

**Methodology version:** 5 (bumped 2026-04-17 after score split —
`ScoreBreakdown` now carries two composite scores. `interruptionScore =
weighted + fallbackPoints` is the **user-facing end-board grade** —
returned as `score` to the harness, recorded in baselines, gated by
regression rubric, surfaced as `DecisionNode.score` in the decision
tree UI, and labelled "Score d'interruption" / "Interruption score" in
the frontend hero/progress/brick-state displays. `explorationScore =
interruptionScore + latentPoints` is the **DFS-internal guidance signal**
— drives action ordering, TT storage, α-β floor, virtual-terminal
propagation. Latent combo-progress (Phase 2.3 Dark Contract, Step 1
F1/F2/F3, future Phase D) feeds exploration only and no longer
contaminates the reported score. Existing baselines at `score = X.58...`
(log2-derived F3 fractions) will re-baseline to integer
`interruptionScore` values — expect small post-split score drops on
fixtures where Step 1 / Phase 2.3 were firing.

Frontend + backend migration scope:
- Backend core: `InterruptionScorer._scoreWithCardsImpl` computes both
  scores. The scorer returns `score = explorationScore`. `DfsSolver.makeNode`
  derives `DecisionNode.score = scoreBreakdown.interruptionScore` when the
  breakdown is present. Top-level `reportScore` reads
  `breakdown.interruptionScore`.
- DFS internal renames (T2, post-split alignment): `DfsContext.bestScore`
  → `bestExplorationScore`; `DfsContext.bestTurn1Score` →
  `bestTurn1ExplorationScore`; local `bestScore`, `pathTurn1Score`,
  `lastResultScore`, `ancestorTurn1Score` → their `ExplorationScore`
  analogues; `DfsNodeResult.score` → `DfsNodeResult.explorationScore`.
  Docstrings on each field state explicitly "exploration signal — not the
  reported grade". No behavior change — pure cosmetic alignment.
- Progress emission fix (T2.2): `SolverProgress.bestScore` previously
  carried `ctx.bestExplorationScore` for DFS solves, contaminating the
  live "Meilleur score d'interruption" display with latent bonuses.
  DFS now emits `ctx.bestTurn1Breakdown.interruptionScore` (or 0 before
  the first turn-1 peak lands). `SolverProgress.bestScore` docstring
  documents the per-algorithm semantic (DFS = interruption; MCTS /
  Minimax-MCTS = backprop max, unchanged).
- Frontend: i18n `solver.result.interruptionScoreLabel` +
  `interruptionScoreHint` added; `solver.progress.bestScore` and
  `solver.result.bestScoreRef` re-worded to "Score d'interruption".
  Hero / progress / decision-tree / pinned / history displays all show
  interruption value with a clarifying tooltip. `ScoreBreakdown.total`
  deprecated alias removed from both backend (`solver-types.ts`,
  `ws-protocol.ts`) and frontend (`solver.model.ts`, `duel-ws.types.ts`).
- Schema consolidation: `InterruptionEffect.activatableFromHand` removed
  — handtraps now opt in via `activeZones: ['HAND']`. Zero tags used the
  flag (all 162 entries were default on-field), so removal is a clean
  schema simplification.
- Orchestrator: DecisionNode sorts (`b.score - a.score`) and SolverResult
  sorts stay correct under interruption semantic (best-first = highest
  interruption first, coherent for user display).

Phase D V1 latent interruption (shipped 2026-04-17, methodology v5):
- **Module**: `latent-interruption-computer.ts`. Scores opp-turn Extra
  Deck summon paths conditional on (enabler on-field × target compatible
  × free slot per MR5 × discount).
- **V1 enablers**: I:P Masquerena (Link-2, `consumesSelfAsMaterial: true`)
  and Super Polymerization (Fusion, Quick-Play hand/set). Data file at
  `duel-server/data/opp-turn-summon-enablers.json`.
- **V1 targets**: any tag with `activeZones: ['EXTRA']` (6 entries set up
  via Voie B MIGRATE batch: Knightmare Phoenix/Cerberus, Guardian Chimera,
  Dracotail Arthalion, Starving Venom Fusion Dragon, El Shaddoll Construct
  — Construct later removed in T2.4 re-audit → 5 active).
- **Slot-check (MR5 per user clarification)**: player's own EMZ is
  whichever is currently occupied by their card, or any available if none
  claimed. Free slot requires neither EMZ occupied — exception:
  `consumesSelfAsMaterial: true` enablers in an EMZ frees that EMZ
  (Masquerena consumes herself as material for Link Summon).
- **Discount**: `LATENT_DISCOUNT = 0.5` — conservative first cut,
  documented as tunable via step 3 ES tuner.
- **Deferred to Phase E** (dedicated combo-enabler work):
  - More enablers: Ultra Polymerization, Predaplant Verte Anaconda,
    Formula Synchron, Rank-Up-Magic spells, archetype-locked enablers
    (Branded Fusion Quick-Play timing, etc.)
  - MZONE-via-Link-arrow slot targeting (link-arrows.json already
    extracted for 468 Links, 2026-04-17)
  - Resource-cost gating (Super Poly hand-discard)
  - Phase 2.3 Dark Contract hardcode migration into the enabler registry
  - Tag taxonomy extension for Tri-Brigade Rugal-style "SS-negated-body"
    effects (no clean match in the 15 existing interruption types)

v4 (earlier 2026-04-17): Voie B shipped —
`InterruptionEffect.activeZones: ZoneId[]` added to the schema, scorer
gates tag credit by effective zones. Default for tags without explicit
`activeZones` = on-field zones only (M1-M5, S1-S5, FIELD, EMZ_L, EMZ_R);
`activatableFromHand: true` adds HAND. GY / BANISHED / EXTRA now require
explicit opt-in. Closes the double-count of multi-zone effects (e.g.
Mirrorjade trigger-destruction no longer scored while on-field).
v3 (earlier 2026-04-17): narrowed `score` semantics documentation.
v2 (earlier 2026-04-17): zone-aware matcher, `position` schema field,
canonical source tiebreaker, matched-drop rubric, determinism rules,
expectedBoard scope pinned to on-field zones. Bump on every structural
change so existing `<archetype>-combo-reference.md` docs can be audited
for drift.

How to add a new competitive decklist fixture to
[`solver-validation-decks.json`](solver-validation-decks.json) for benchmarking
the solver against real meta decks.

## When to use this

- You want to validate solver combo-finding against a known competitive deck.
- You need a reproducible decklist fixture with numeric Yu-Gi-Oh card IDs
  that OCGCore can load directly.
- You want the same schema as
  [`mcts-calibration-hands.json`](mcts-calibration-hands.json) (consumable by
  `duel-server/scripts/calibrate-mcts.ts` or equivalent harnesses).

## Schema

```json
{
  "_meta": {
    "purpose": "...",
    "createdAt": "YYYY-MM-DD",
    "decks": {
      "<deck-key>": {
        "source": "short human description with player + date",
        "url": "<canonical source URL>",
        "format": "TCG/OCG month year",
        "validatedAgainstCardDb": true
      }
    },
    "usage": "..."
  },
  "decks": {
    "<deck-key>": {
      "main":  [<card_id>, ...],
      "extra": [<card_id>, ...],
      "side":  [<card_id>, ...]
    }
  },
  "hands": [
    {
      "id": "<hand-key>",
      "deck": "<deck-key>",
      "description": "which opener + what board it should build",
      "hand": [<5 card_ids from the deck>],
      "deckSeed": "<seed1>,<seed2>",
      "expectedBoard": [
        {
          "zone": "MZONE|EMZ_L|EMZ_R|SZONE|FIELD|HAND",
          "cardId": <number>,
          "cardName": "<human name>",
          "position": "attack|defense|set"
        }
      ]
    }
  ]
}
```

Cards are numeric IDs (OCGCore passcodes). Duplicates in an array are
meaningful — each element is one physical copy.

### expectedBoard semantics (matcher-enforced)

- `zone` is **required** and zone-aware in the matcher. `MZONE` expands to any
  of `M1..M5, EMZ_L, EMZ_R`; `SZONE` expands to `S1..S5`. Specific zones
  (`EMZ_L`, `EMZ_R`, `FIELD`, `HAND`) match only themselves.
- `position` is **optional**. When present, match requires `position` parity:
  - `attack` ↔ `faceup-atk`
  - `defense` ↔ `faceup-def`
  - `set` ↔ `facedown` OR `facedown-def` (monsters face-down OR spells/traps
    face-down; the underlying solver tracks both).
- When `position` is omitted, any position counts. Omit for face-up activated
  Continuous Spells (no canonical ATK/DEF) and whenever the combo line
  legitimately branches between positions.
- **Deduce `position` from the canonical combo line (reference doc), NEVER
  from solver output.** expectedBoard is a ground-truth target independent of
  the solver's current exploration budget.

### expectedBoard scope — on-field only, by design

`expectedBoard` is restricted to on-field zones (`MZONE`, `EMZ_L`, `EMZ_R`,
`SZONE`, `FIELD`, `HAND`). Entries in `GY`, `BANISHED`, or face-up `EXTRA`
are **intentionally excluded** even though these zones can legitimately host
disruption-active cards. Canonical non-field examples:

- **HAND-activated Quick Effects** — **Bystial Druiswurm** sits in hand and,
  when an opponent monster effect activates, Special Summons itself from
  hand by banishing 1 LIGHT/DARK monster in either GY. A resource-denial
  banish (not a negate) that disrupts GY-dependent combos (e.g. banishing
  Herald cuts off Kaleidoscope recursion). Same family: Bystial Magnamhut,
  Saronir; Ash Blossom; Maxx "C"; Nibiru; Effect Veiler; Fuwalos.
- **GY-active triggers / quick effects** — **Mirrorjade the Iceblade
  Dragon** (when sent to GY by opponent's card effect: banish 1 card on
  the field); **Eldlich the Golden Lord** (quick effect: banish self from
  GY + 1 Eldlixir from ST to destroy 1 face-up card).
- **Banished-zone quick-plays** — Runick spells remain face-up in the
  banished zone after activation and can be re-activated via Runick
  Fountain / Smoke Signal, continuing to disrupt on opponent's turn.

Face-up `EXTRA` (Pendulum monsters destroyed returning to Extra) does NOT host
disruption — Pendulum re-summoning is a combo/tempo tool, not opp-turn
interruption. Most "GY combo pieces" (Lacrima-to-Desirae, Herald-to-Kaleidoscope,
milled Tearlaments fusion materials) are COMBO enablers, NOT disruption. Only
cards with a direct quick-effect or trigger that banishes/bounces/destroys an
opponent card FROM the non-field zone count as disruption-active.

The duality with the `score` metric is intentional and complementary:

| Metric | Captures | Source of truth |
|---|---|---|
| `matched` | Physical on-field presence at turn-1 peak — did the solver *materialize* the canonical visible board? | `expectedBoard` entries in the fixture |
| `score` | On-field disruption value + HAND handtraps that opt in via `activatableFromHand`. GY / BANISHED / EXTRA face-up are scanned but **without zone discrimination** — a tag credits identically in every zone it appears. | [`interruption-tags.json`](../../../duel-server/data/interruption-tags.json) |

Extending `expectedBoard` to non-field zones would duplicate tag
infrastructure (Lacrima is a combo-enabler not interruption, Herald as
Kaleidoscope-recycle-enabler does not count, Mirrorjade GY-trigger does),
so the methodology leaves this to `score`. Since Voie B (v4, 2026-04-17),
the scorer gates tag credit by **effective active zones**, resolved per
effect as:

1. `effect.activeZones` present → authoritative list.
2. `effect.activatableFromHand === true` → on-field zones + HAND.
3. Otherwise → on-field zones only (M1-M5, S1-S5, FIELD, EMZ_L, EMZ_R).

This closes the former double-count: a card tagged only for its GY
trigger (e.g. Mirrorjade destruction) no longer scores while on-field.
Symmetrically, field-bound effects no longer score while in GY.

**Current coverage caveat** (as of v4): the schema now supports precise
zone expression, but the **tag data** is still predominantly on-field.
0 / 192 tags carry `activatableFromHand: true`, so Ash Blossom / Maxx "C"
/ Nibiru / Veiler / Fuwalos / Bystials / Called by the Grave / Crossout
Designator still score 0 in HAND. Only Mirrorjade (effect[1] destruction)
has been migrated to explicit `activeZones: ['GY']` so far. `score` today
still primarily reflects **on-field** disruption — schema unblocks the
fix but the tag-batch coverage closure is in-flight.

**Interim rule**: until tag coverage closes for handtraps / Bystials /
Runick / Eldlich, fixtures whose strength is non-field disruption
(Bystial pure, Runick stall, Eldlich control) should declare a
**paradigm caveat** in their reference doc (see section 7a step 5)
explaining that `score` under-represents their real board value. The
matched-drop rubric (step 7) already treats these decks with `matched`
as a secondary gate.

**Authoring rule for new tags**: every effect with a non-default zone
activation surface MUST specify `activeZones` explicitly. Examples:

- Handtrap: `activeZones: ['HAND']` (or the legacy `activatableFromHand: true`).
- GY-trigger: `activeZones: ['GY']`.
- Banished-zone quick-play (Runick face-up banished): `activeZones: ['BANISHED']`.
- Dual-zone (field quick + GY trigger, e.g. Mirrorjade):
  two separate effects, one default (on-field), one with `activeZones: ['GY']`.
- Pendulum Scale on S1/S5: typically no override needed (PZONE is in
  default on-field set); override only if the effect is explicitly Scale-
  only and excludes non-pendulum activations.

## Step-by-step

### 1. Find a reliable source

**Use [ygoprodeck.com](https://ygoprodeck.com) deck pages only.** They embed
the full card list as structured HTML, which is machine-parseable.

Do **not** use:

- Blog posts that list cards as plain text (e.g. duelingnexus.com, game8).
  These forced the WebFetch tool through an LLM summarizer which hallucinated
  card names (e.g. "Mulcharmy Afflicted", "Baronne de Montmorency" — cards
  that do not exist).
- Screenshots or YouTube combo guides for the deck list itself. Use them
  only for the expected endboard afterwards.

**Search query pattern:**

```
site:ygoprodeck.com <archetype> deck tournament 2026
```

Prefer recent tournament tops (WCQ Regional, YGO Open Tournament,
championship regional) over netdecked ladder lists.

### 2. Extract raw card IDs from the ygoprodeck HTML

ygoprodeck embeds each card slot as:

```html
<a class="ygodeckcard" ...>
  <img data-card="44362883" data-cardname="Branded Fusion" ... />
</a>
```

The `data-card` attribute is the numeric ID. Each slot is one `<a>` tag
(one physical card copy), so counting tags = counting cards.

Use this Node snippet (works from `duel-server/`, no new deps required):

```js
const DECK_URL = 'https://ygoprodeck.com/deck/<deck-slug-and-id>';

(async () => {
  const res = await fetch(DECK_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (fixture-audit)' },
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${res.statusText}`);
  const html = await res.text();
  const mainIdx = html.indexOf('id="main_deck"');
  if (mainIdx < 0) throw new Error('main_deck section not found — page layout changed?');
  const extraIdx = html.indexOf('id="extra_deck"');
  const sideIdx = html.indexOf('id="side_deck"');
  const sections = {
    main: html.substring(mainIdx, extraIdx > 0 ? extraIdx : html.length),
    extra: extraIdx > 0 ? html.substring(extraIdx, sideIdx > 0 ? sideIdx : html.length) : '',
    side: sideIdx > 0 ? html.substring(sideIdx) : '',
  };
  const extract = (s) => {
    const ids = [];
    const re = /<a class="ygodeckcard"[\s\S]*?<\/a>/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const id = m[0].match(/data-card="(\d+)"/);
      if (id) ids.push(parseInt(id[1]));
    }
    return ids;
  };
  const results = Object.fromEntries(
    Object.entries(sections).map(([k, s]) => [k, extract(s)])
  );
  if (results.main.length < 40) throw new Error(`main deck too small: ${results.main.length} — scrape likely broken`);
  for (const [k, ids] of Object.entries(results)) {
    console.log(k, ids.length, JSON.stringify(ids));
  }
})();
```

Expected sizes: main 40–60, extra 0–15, side 0–15. The runtime guards above
abort on 4xx/5xx, layout change, or suspiciously small main. A silent empty
main array is the most common root cause of broken fixtures.

### 3. Validate every ID against cards.cdb

The authoritative card database is
[`duel-server/data/cards.cdb`](../../../duel-server/data/cards.cdb) — OCGCore's
SQLite card DB. This is the same DB the duel server uses at runtime, so
anything it can name is guaranteed to load.

Lookup uses `better-sqlite3` (already a `duel-server` dep):

```js
const Database = require('better-sqlite3');
const db = new Database('./data/cards.cdb', { readonly: true });
const nameStmt = db.prepare('SELECT name FROM texts WHERE id = ?');
const aliasStmt = db.prepare('SELECT alias FROM datas WHERE id = ?');

for (const id of allCardIds) {
  const row = nameStmt.get(id);
  if (!row) console.error('MISSING:', id);
  else console.log(id, row.name);
}
```

If a card is missing, the cdb is older than the card's release. Update
`cards.cdb` from the OCGCore upstream before proceeding — there is no point
writing a fixture the server cannot load.

### 4. Normalize alias IDs

Some IDs are alternate prints (different art) that redirect to a canonical
card. `datas.alias != 0` means "this id is an alias for datas.alias".

**Always normalize to the canonical ID.** The existing `mcts-calibration-hands.json`
fixture uses canonical IDs, and using alias IDs in a deck is a source of
subtle bugs (effects that check `card.code == canonical_id` won't match).

**NON-EXHAUSTIVE reference table** (known from past fixtures — always run
the detection script below, do not trust this table alone):

| Alias ID | Canonical ID | Card |
|---|---|---|
| 14558128 | 14558127 | Ash Blossom & Joyous Spring |
| 18144507 | 18144506 | Harpie's Feather Duster |

Konami reprints produce new alias IDs on every set release, so the table
below lags reality by months. The detection script is authoritative:

```js
for (const id of allCardIds) {
  const { alias } = aliasStmt.get(id) || {};
  if (alias && alias !== 0) console.log(id, '→', alias);
}
```

Replace `id` with `alias` in the deck arrays and re-run validation.

### 5. Write the fixture file

Append the new deck under `decks` in `solver-validation-decks.json`. Keep
array formatting readable — group copies of the same card on one line
(see existing entries as a model). The JSON linter does not care, but
diffs stay meaningful when cards are visually grouped.

### 6. Add at least one starter hand

Pick a plausible 5-card opener that actually appears in the main deck.
Verify each hand card ID exists in the corresponding deck array (the
solver will crash otherwise — it treats `hand` as cards dealt from the top
of the deck before shuffling).

`deckSeed` format: two decimal integers comma-separated, passed to OCGCore
as a 128-bit seed.

**Determinism rule (v2)**: pick seeds from a documented rubric so two
contributors reach the same seed for the same fixture and regression
comparisons remain meaningful over time. Accepted rubrics:

1. Paired decimal constants with mnemonic significance for the archetype
   (e.g. `31415,92653` for π, `27182,81828` for e, `11235,81321` for
   Fibonacci). Use when a mnemonic reads well in the diff.
2. Stable derivation from the fixture id: e.g. a short hash of the
   hand `id` truncated to the integer range. Use when no mnemonic fits.

Do NOT change a seed in an existing fixture without also republishing the
baseline — seed changes invalidate baseline comparability. Frozen seeds
may carry `_seedFrozen: true` as a marker for "do not touch".

### 7. Capture the expected endboard — ground-truth against a combo reference doc

**Deprecated naive approach** (do NOT use):
1. ~~Run the solver → paste its endBoardCards as expectedBoard.~~ This freezes
   whatever the solver currently reaches as "correct", including its mistakes
   and budget-truncated outputs. Any future solver improvement that changes
   peak field will look like a regression.

**Canonical approach** (validated 2026-04-17 across Snake-Eye, Kashtira,
Dinomorphia in Tier 1):

Each fixture pairs with a standalone `<archetype>-combo-reference.md` file in
this directory that documents the canonical tournament combo line for that
deck. The fixture's `expectedBoard` is derived from that doc, not from solver
output. The reference doc is the "golden standard" — the fixture just points
at it.

#### Defining "canonical" (v2 tiebreaker)

"Canonical tournament combo line" is the line played by the deck's author in
the tournament referenced by `_meta.decks.<key>.source`. When combo guides
disagree or the author has no write-up, use this priority order:

1. **The deck author's own decktech / combo write-up** for the exact list in
   `source` (highest authority — this is the combo the fixture actually
   represents).
2. **Master Duel Meta** tier guide for the archetype variant.
3. **ygoprodeck combo guide** by the same author or a verified Top-8 player.
4. **Game8** archetype page.
5. **Yugipedia** archetype page (lowest — encyclopedic but not competitive).

When two sources in the same tier conflict, prefer the more recent one (fixture
format field in `_meta.decks.<key>.format` bounds "recent"). Never silently
pick one — document the choice and the losers in the reference doc's
"Sources" section.

Existing references:
- [ddd-combo-reference.md](ddd-combo-reference.md) — D/D/D Pendulum (pairs with `ddd-pendulum-opener`)
- [snake-eye-combo-reference.md](snake-eye-combo-reference.md) — Snake-Eye Yummy Sarcophagus (pairs with `snake-eye-yummy-opener`)
- [kashtira-azamina-combo-reference.md](kashtira-azamina-combo-reference.md) — Kashtira Azamina Radiant Typhoon Maliss (pairs with `kashtira-azamina-opener`)
- [dinomorphia-combo-reference.md](dinomorphia-combo-reference.md) — Dinomorphia LP-sacrifice (pairs with `dinomorphia-opener`)

### 7a. The 8-step ground-truth methodology

**Step 1 — Research (2 parallel WebSearches)**

Allowed sources: Master Duel Meta, Game8, Yugipedia, ygoprodeck combo guides,
Pojo. Never use WebFetch on deck pages — it passes HTML through an LLM
summarizer that hallucinates card names. WebFetch is acceptable for prose
combo guides that you will manually re-verify, but prefer structured sources.

Parallel queries:
- Query A: `<archetype> combo guide 2026 endboard <key boss>`
- Query B: `<archetype> <key starter> combo turn 1` OR
  `<tournament/player name> decktech` when the fixture is from a specific
  tournament.

If the two queries return conflicting endboards, resolve via the canonical
tiebreaker (section above). Do NOT silently merge both — the fixture
represents ONE combo line, not a superset.

**Step 2 — Extra-deck analysis (critical)**

Cross-reference the canonical endboard pieces from research against what's
actually in THIS fixture's extra deck. Many tournament builds cut "standard"
endboard pieces to make room for their hybrid engine. If the canonical guide
says "end on X + Y", but X is not in the fixture's extra, the endboard must
be different — this deck wins through a different line.

Concrete example: Kashtira guides say "end on Arise-Heart + Shangri-Ira".
The Verquin WCQ Top 8 Azamina hybrid build does NOT have either card in its
extra — it uses Kashtira bodies as Dracossack XYZ material and pushes into
Azamina Ilia Silvia (Fusion) as the real finisher. Use Ilia Silvia, not
Arise-Heart, in the fixture expectedBoard.

**Step 3 — Structural sanity checks (3 pitfalls)**

Before writing the endboard, verify these three pitfalls:

1. **Consumed pieces**. Fusion materials cannot be on-field simultaneously
   with the Fusion summoned from them. Pitfalls seen in pre-validation
   fixtures:
   - Dinomorphia Kentregina AND Rexterm listed together — Kentregina is
     Rexterm's fusion material in the canonical chain. Pick Rexterm only.
   - Snake-Eye Requiem AND Desirae listed together — Requiem is typically
     tributed into Desirae via Sequence. Pick Desirae only.

2. **Intermediate-vs-terminal distinction**. Set traps that TRIGGER and go
   to GY during the combo are NOT endboard pieces, only terminal board state
   counts. Sinful Spoils of Subversion in Snake-Eye: activated, goes to GY —
   NOT on-field at end-of-turn. Exclude.

3. **Side-deck contamination**. `card IN side-deck` ≠ `card IN extra-deck`.
   I:P Masquerena in the side is not accessible during a turn-1 combo; it
   can only enter play if swapped in between games. Exclude from endboard.

**Step 4 — Hand realism**

Match the hand's shape to the deck's protection profile. Three archetypes
observed in Tier 1:

1. **1-card combo deck** (Snake-Eye): 1 starter + 2-3 handtraps + 1-2
   engine enablers. Example: `[Snake-Eye Ash, Ash Blossom, Fuwalos, Fabled
   Lurrie, Fiendsmith Engraver]`. Over-loading with 3 separate starters
   (Ash + WANTED + Bonfire) is unrealistic — that would never be drawn
   together tournament-realistically.
2. **Multi-engine hybrid** (Kashtira): 3-5 engine cards, 0 handtraps if the
   deck's main has no handtraps. Verquin Kashtira Azamina: 0 main-deck
   handtraps — realistic opener is 5 engine cards. Example: `[Fenrir,
   Wraitsoth, WANTED, Diabellstar, Magicians' Souls]`.
3. **Minimalist trap** (Dinomorphia): starter + draw engine + 1-2
   floodgates. Example: `[Therizia, Frenzy, Card of Demise, Pot of Duality,
   Iron Thunder]`. Dinomorphia's compact hand is a deliberate design — not
   a lack of cards.

**Step 5 — Write the reference doc using the template (8 core + 3 optional sections)**

```
# <Archetype> Combo Reference (<date>)

<intro paragraph: fixture ID pairing + tournament source + paradigm note>

Sources: <bulleted list of URLs used in research>

(optional) Paradigm note: <only if the deck's paradigm is unusual — e.g.
LP-sacrifice, normal-summon lock, GY-fusion. Explains why matched may be
lower or score may be lower than combo norms.>

## Endboard piece cheat sheet
<each key card: role + effect in combo>

## Card ID reference (this fixture's available cards)
<grouped by engine/purpose — starters, searchers, bosses, handtraps, etc.>

## 1 CARD COMBO — <starter name>
<step-by-step combo line>
**Final endboard**: <explicit board state>

## (optional) 2 CARD COMBO — <variant>
<same format>

## Key SELECT_CARD decisions
<ordered list of critical search targets>

## THIS FIXTURE's canonical opener
<recommended hand with rationale>

## THIS FIXTURE's realistic expectedBoard
<3-4 pieces with rationale, excluding consumed/intermediate/side cards>

## Solver diagnostic mapping
<if piece X is missing: check Y>

## Endboard weights (solver scoring)
<priority order for which pieces matter most>

(optional) ## Paradigm caveat
<only for unusual paradigms (LP-sacrifice, normal-summon lock, GY-fusion,
stall/non-summoning). Describes the structural reason the fixture's matched
or score can legitimately be lower than combo norms. This is FIXTURE-LEVEL
context, not tuner configuration — the step 3 ES tuner reads paradigm
normalization from its own config, not from reference docs.>
```

**Step 6 — Update the fixture JSON**

- `description`: mention the reference doc via markdown link
  (`[<archetype>-combo-reference.md](<archetype>-combo-reference.md)`)
- `hand`: exactly as specified in the reference doc's "canonical opener"
- `expectedBoard`: exactly as specified in the reference doc's "realistic
  expectedBoard", including a `position` field for every entry where the
  canonical combo specifies one:
  - Monsters landing on field = `"attack"` (aggressive canonical posture)
  - Set traps / set quick-plays = `"set"`
  - Face-up activated Continuous Spells, FIELD zone spells, HAND entries =
    omit `position` (matcher falls back to zone+cardId)
- Verify hand cards all exist in the fixture's main deck
- Verify expectedBoard cards exist in either main (for monsters searchable
  to field) or extra deck (for Fusion/Synchro/Xyz/Link bosses)

**Step 7 — Deterministic smoke test**

```bash
SOLVER_INSTRUMENT=1 npx tsx scripts/evaluate-structural.ts \
  --node-budget=400 --budget-ms=3600000 \
  --only=<fixture-hand-id> \
  --label=<archetype>-validated
```

Expected outcomes after validation (vs pre-validation smoke).

**Score metric used by the rubric (v5 clarification)**: `score` below
refers to `interruptionScore` — the `weighted + fallbackPoints` composite
recorded in baselines since methodology v5. The pre-v5 `total` field
(which conflated `explorationScore = interruptionScore + latentPoints`
into a single reported number) is deprecated as the regression gate
because it moved whenever DFS guidance features (Step 1 F1/F2/F3, Phase
2.3, Phase D) shipped — latent tuning was indistinguishable from real
score changes. The rubric now tracks `interruptionScore` strictly.
`scoreBreakdown.explorationScore` and `scoreBreakdown.latentPoints` are
still logged for diagnostics (DFS guidance quality), but they do NOT gate
commits.

**Regression rubric (v2)** — matched drop AND score drop are BOTH gates:

| score Δ | matched Δ | Verdict |
|---|---|---|
| stable or ↑ | ↓ | **Correction.** Old expectedBoard was inflated (intermediate/consumed/side-contaminated pieces). Commit with rationale. |
| ↓ significantly* | ↓ | **Real regression.** Both on-field materialization AND disruption value lost. Investigate solver path changes before committing. |
| ↓ significantly* | 0 | **Score-only regression.** On-field pieces stable, but non-field disruption (GY/banished/HAND interruption-tags) lost. Flagged automatically by the harness. Investigate interruption-tags coverage and solver path changes. |
| stable | 0 | No-op. Re-examine whether the validation actually changed anything. |
| ↑ | ↑ | **Improvement.** Stricter endboard + better exploration. Commit. |

*"Significantly" = **BOTH** conditions below (automatic harness gates):
- absolute drop `scoreDelta < -2.0` (noise floor — avoids false positives
  on low-score fixtures like Dinomorphia at ~1)
- relative drop `scoreDelta / prevScore < -10%` (intensity floor — avoids
  false positives on high-score fixtures where -2 is noise)

Concrete sub-rules:
- `depth` drop of >5 with stable score = exploration sensitivity, not a
  regression; note it but do not block.
- `az%` / `t2%`: investigate any shift >10 percentage points. Smaller shifts
  are noise. Direction of "good" depends on paradigm — do NOT read shifts
  as universally positive.
- **Paradigm caveat**: for decks whose strength is non-field disruption
  (Bystial pure, Runick stall, trap-heavy control), `matched` stays low
  by design — `score` becomes the primary regression gate. Document this
  in the ref doc's paradigm caveat section so reviewers read the verdict
  correctly.

**Step 8 — Commit per archetype**

One commit per archetype, staging both the new reference doc AND the
fixture JSON update together. Commit message structure:
```
solver: step 2 Tier N — <archetype> combo reference doc + fixture ground-truth

Adds <archetype>-combo-reference.md documenting <tournament source> then
corrects the <fixture-id> fixture to align.

<List of fixture corrections with structural rationale for why old was wrong>

Smoke (node-budget=400, post-validation):
  score=X  matched=A/B  depth=D  ...  completed

<Interpretation of matched delta — truthful signal, not regression>

Reference doc covers: <summary of sections>
```

### 7b. When NOT to use this methodology

The ground-truth methodology applies when:
- The fixture represents a known tournament deck.
- You have research access to combo guides for the archetype.
- The fixture is intended as a regression gate (affects baseline comparison).

Skip and use the deprecated "solver-output" path only when:
- The fixture is a `_draft: true` exploratory deck (not a regression gate).
- The archetype is OCG-exclusive with no English combo guide (rare; flag
  with a `_provisional: true` in the fixture and plan a follow-up).

**Draft TTL rule (v2)**: drafts are temporary, not a permanent escape
hatch. Any fixture with `_draft: true` or `_provisional: true` must be
either promoted (ground-truthed) or removed within 4 weeks of introduction.
During quarterly fixture audits, drafts older than the TTL either ship or
are deleted — they never silently carry forward polluting baselines.

### 7c. Anti-patterns observed in pre-Tier-1 fixtures

Watch for these in any fixture lacking a reference doc:
- `expectedBoard` contains BOTH a Fusion and its material (structural
  impossibility in canonical lines).
- `expectedBoard` contains SZONE pieces that were activated mid-combo (they
  should be in GY at end-of-turn, not SET).
- `hand` contains 3+ independent starters of different engines (unrealistic
  tournament hand — reflects solver-tester wishful thinking, not real play).
- `expectedBoard` contains a card that's in the side deck but not extra.
- `description` does not reference a combo-reference doc — fixture is
  "floating" without a source of truth.

## Gotchas

- **OCG vs TCG card pool.** A card released in OCG but not yet in TCG may
  or may not be in `cards.cdb` depending on when the DB was last updated.
  Prefer OCG-format tournament lists if the archetype is OCG-only.
- **Deck size limits.** Main 40–60, extra 0–15, side 0–15. 41-card main
  decks are legal and common.
- **Side deck optional.** If ygoprodeck does not show a side deck section,
  the deck's author did not publish one. Leave `side: []` rather than
  guessing.
- **Dead sources.** ygoprodeck deck IDs are stable; tournament blog URLs
  are not. Always archive the URL in `_meta.decks.<key>.url` and keep the
  `source` field human-readable so the fixture survives link rot.
- **Do not scrape with WebFetch.** WebFetch passes HTML through an LLM
  summarizer that will hallucinate plausible-but-wrong card names. Use raw
  `fetch` from Node and parse `data-card=` attributes.

## Adding a new fixture — checklist

Decklist extraction (steps 1-6):
- [ ] Found ygoprodeck URL for a recent tournament list
- [ ] Extracted main/extra/side arrays via Node `data-card=` scrape
- [ ] Verified array lengths (main ≥ 40, extra ≤ 15, side ≤ 15)
- [ ] All IDs resolve in `cards.cdb` (no missing)
- [ ] Alias IDs normalized to canonical
- [ ] Added `_meta.decks.<key>` entry with source + URL + format
- [ ] Added at least one hand with description and deckSeed
- [ ] Hand cards all exist in the corresponding main deck
- [ ] Re-ran the validation script on the final JSON, zero errors

Ground-truth validation (step 7, for non-draft fixtures intended as
regression gates):
- [ ] Ran 2 parallel WebSearches for combo research (MD Meta + Game8 /
      Yugipedia / ygoprodeck guides)
- [ ] Cross-referenced canonical endboard pieces against THIS fixture's
      extra deck — excluded pieces absent from extra
- [ ] Applied the 3 structural sanity checks: no consumed pieces,
      terminal-only (no mid-combo set traps), no side-deck contamination
- [ ] Hand composition matches deck's protection profile (1-card / multi-
      engine / minimalist) — no 3+ independent starters in one hand
- [ ] Wrote `<archetype>-combo-reference.md` using the template (8 core +
      3 optional sections)
- [ ] Fixture `description` links to reference doc
- [ ] `hand` and `expectedBoard` match reference doc's "canonical opener"
      and "realistic expectedBoard" sections verbatim
- [ ] `expectedBoard` entries carry a `position` field where canonical
      (monsters on field = `attack`; set traps/quick-plays = `set`;
      activated continuous / FIELD / HAND omitted)
- [ ] `deckSeed` follows the determinism rule (v2) — mnemonic pair or
      fixture-id-derived hash
- [ ] Deterministic smoke (node-budget=400) run, matched delta classified
      via the matched-drop rubric in the commit message
- [ ] Commit stages both reference doc + fixture JSON update together
