# Solver Validation Decks — Methodology

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
      "deckSeed": "<seed1>,<seed2>"
    }
  ]
}
```

Cards are numeric IDs (OCGCore passcodes). Duplicates in an array are
meaningful — each element is one physical copy.

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
  const html = await (await fetch(DECK_URL)).text();
  const mainIdx = html.indexOf('id="main_deck"');
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
  for (const [k, s] of Object.entries(sections)) {
    console.log(k, extract(s).length, JSON.stringify(extract(s)));
  }
})();
```

Expected sizes: main 40–60, extra 0–15, side 0–15. Mismatch = broken parse.

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

Known aliases seen so far:

| Alias ID | Canonical ID | Card |
|---|---|---|
| 14558128 | 14558127 | Ash Blossom & Joyous Spring |
| 18144507 | 18144506 | Harpie's Feather Duster |

To detect them in bulk:

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
as a 128-bit seed. Any values work for ad-hoc tests; use distinct seeds
across hands so RNG-dependent behavior is not confounded.

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

**Step 5 — Write the reference doc using the 9-section template**

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

(optional) ## Paradigm caveat for step 3 ES tuning
<only for unusual paradigms — explains how to interpret matched count>
```

**Step 6 — Update the fixture JSON**

- `description`: mention the reference doc via markdown link
  (`[<archetype>-combo-reference.md](<archetype>-combo-reference.md)`)
- `hand`: exactly as specified in the reference doc's "canonical opener"
- `expectedBoard`: exactly as specified in the reference doc's "realistic
  expectedBoard"
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

Expected outcomes after validation (vs pre-validation smoke):
- `matched` may DECREASE (endboard is more rigorous — excluded intermediate
  pieces that falsely inflated the old count). **Not a regression.**
- `score` stable or slightly higher (focused hand explores better).
- `depth` stable or higher.
- `az%` and `t2%` may shift — usually a good sign (more turn-1 exploration).

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
- [ ] Wrote `<archetype>-combo-reference.md` using the 9-section template
- [ ] Fixture `description` links to reference doc
- [ ] `hand` and `expectedBoard` match reference doc's "canonical opener"
      and "realistic expectedBoard" sections verbatim
- [ ] Deterministic smoke (node-budget=400) run, matched interpretation
      documented in commit message
- [ ] Commit stages both reference doc + fixture JSON update together
