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

### 7. Capture the expected endboard (optional, manual)

The schema currently has no `expectedBoards` field. When you want to turn a
hand into a golden regression test:

1. Run the solver against the hand in isolation.
2. Read the `endBoardCards` array from the `SolverResult` it returns.
3. Paste it into the hand entry as `expectedBoard`. Review manually — a
   wrong endboard from the solver will otherwise be frozen as "correct".
4. Add a smoke test under `duel-server/src/solver/` that loads the fixture
   and asserts `endBoardCards` matches `expectedBoard`.

Until then, hands are "exploratory" fixtures — useful for observing solver
behavior but not automated regression gates.

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

- [ ] Found ygoprodeck URL for a recent tournament list
- [ ] Extracted main/extra/side arrays via Node `data-card=` scrape
- [ ] Verified array lengths (main ≥ 40, extra ≤ 15, side ≤ 15)
- [ ] All IDs resolve in `cards.cdb` (no missing)
- [ ] Alias IDs normalized to canonical
- [ ] Added `_meta.decks.<key>` entry with source + URL + format
- [ ] Added at least one hand with description and deckSeed
- [ ] Hand cards all exist in the corresponding main deck
- [ ] Re-ran the validation script on the final JSON, zero errors
