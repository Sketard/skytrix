# Fixture × Raw-Replay Coherence Audit — 2026-05-03

**Mission**: Identify fixtures in `solver-validation-decks.json` whose authored
`hand[]`+`deckSeed` are **not** coherent with their reference raw-replay (under
`_bmad-output/planning-artifacts/research/trajectories/`), correct them, and
re-baseline the canonical-eval against the prior 31/69 baseline.

**Trigger**: `ddd v3` subagent empirically concluded a 2/5 ceiling on the
authored hand, while a memo claimed "5/5 atteignable per raw-replay". Both
could be true on **their respective hands** if those hands diverge — this
audit checks whether they do.

---

## Methodology — what "coherent" means

The solver feeds a fixture into OCGCore via `OcgcoreAdapter.createNativeDuel`
(see `duel-server/src/solver/ocgcore-adapter.ts:734-770`):

1. The fixture's `hand[]` cards are placed verbatim into HAND (no shuffle).
2. The fixture's `mainDeck` (= deck.main minus hand) is placed into DECK.
3. `startingDrawCount` is forced to **0** in `evaluate-structural.ts:559`
   — OCG does not draw 5 on `startDuel` for solver runs.
4. `deckSeed` is passed as a 4-bigint tuple to the OCG core. **Critical
   gate**: if `config.deckSeed.length < 4`, the adapter falls back to
   stub seed `[42n, 123n, 456n, 789n]` (line 735-737), so the fixture's
   declared seed is **completely ignored** when the comma-string holds
   fewer than 4 entries.

Conversely, the raw-replay is initialized in `replay-to-fixture.ts:247-282`
with the **full** deck (40 cards) loaded into DECK and `startingDrawCount: 5`.
OCG shuffles + draws 5 cards into HAND on `startDuel`. The captured fixture
hand is what OCG drew at the first `SELECT_IDLECMD`.

**Coherence definition**: a fixture is replay-coherent if, given the
raw-replay's full deck and 4-bigint seed, OCG would draw the same 5 cards
into HAND that the fixture's `hand[]` declares. The verifier
`duel-server/scripts/verify-fixture-replay-coherence.ts` (new, ~250 LoC)
mechanically checks this.

A second, weaker form of coherence is **mid-turn shuffle parity**: the
solver's `deckSeed` should mirror the raw-replay's full 4-bigint seed so
that mid-turn searches/draws produce the same residue ordering. This is
where most fixtures diverged.

---

## Audit results — 15 fixtures × {raw-replay availability, hand match, seed
match, fixture corrected}

| # | Fixture | Raw-replay file | Replay fixtureId | Deck composition | Hand cohesion | Seed format | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | `branded-dracotail-opener` | `branded-dracotail-opener.raw-replay.json` | `branded-dracotail-opener` | identical (40 main / 15 extra) | **identical** | 2/4 bigints (slots 2-3 stubbed) | **corrected** (deckSeed extended 2→4 bigints) |
| 2 | `branded-dracotail-opener-mirrorjade-line` | (same hand as #1, but distinct fixture) | — | n/a | n/a | mnemonic `"55555,66666"` | **no-replay-available** (alternate-line fixture, no PvP capture) |
| 3 | `ddd-pendulum-opener` | `ddd-pendulum-replay-eb8c6865.raw-replay.json` | `ddd-pendulum-replay-eb8c6865` | **diff sorted=17** (different DDD build: replay deck has 42 main vs fixture's 41; cards Doom Queen Machinex / Beta Magnet Warrior / Dark Ruler No More instead of Savant Kepler / Scale Surveyor) | **deck-mismatch** | mnemonic `"11111,22222"` | **no-replay-available** (raw-replay was captured from a DIFFERENT decklist; cannot derive coherent hand) |
| 4 | `ryzeal-mitsurugi-opener` | — | — | n/a | n/a | mnemonic `"33333,44444"` | **no-replay-available** |
| 5 | `radiant-typhoon-opener` | — (only `radiant-typhoon-opener.json` summary, no `.raw-replay.json`) | — | n/a | n/a | mnemonic `"99999,10101"` | **no-replay-available** |
| 6 | `kashtira-azamina-opener` | — | — | n/a | n/a | mnemonic `"11235,81321"` | **no-replay-available** |
| 7 | `horus-crystron-opener` | — | — | n/a | n/a | mnemonic `"31415,92653"` | **no-replay-available** |
| 8 | `dinomorphia-opener` | — | — | n/a | n/a | mnemonic `"27182,81828"` | **no-replay-available** |
| 9 | `spright-opener` | — | — | n/a | n/a | mnemonic `"13579,24680"` | **no-replay-available** |
| 10 | `snake-eye-yummy-opener` | `snake-eye-yummy-opener.raw-replay.json` | `snake-eye-yummy-opener` | identical (41 main / 15 extra) | **identical** | 2/4 bigints (slots 2-3 stubbed) | **corrected** (deckSeed extended 2→4 bigints) |
| 11 | `tearlaments-opener` | — | — | n/a | n/a | mnemonic `"78787,89898"` | **no-replay-available** |
| 12 | `floowandereeze-opener` | — | — | n/a | n/a | mnemonic `"90909,10101"` | **no-replay-available** |
| 13 | `labrynth-opener` | — | — | n/a | n/a | mnemonic `"12121,23232"` | **no-replay-available** |
| 14 | `stun-runick-opener` | — | — | n/a | n/a | mnemonic `"34343,45454"` | **no-replay-available** |
| 15 | `nekroz-ryzeal-opener` | — | — | n/a | n/a | mnemonic `"70707,80808"` | **no-replay-available** |

### Summary

- **3 fixtures** have a candidate raw-replay file (`branded-dracotail-opener`,
  `snake-eye-yummy-opener`, `ddd-pendulum-opener`).
- **2 fixtures** (branded, snake-eye) had **already coherent hands** — both
  were generated 2026-04-19 via `replay-to-fixture.ts` from PvP captures.
  Their authored deckSeed was truncated to **2 of 4 bigints**, however,
  triggering the OCGCore adapter's stub-seed fallback path.
- **1 fixture** (ddd-pendulum-opener) shares an archetype label with a
  raw-replay (`ddd-pendulum-replay-eb8c6865`) but the replay's decklist
  diverges by **17 sorted-card-diff** from the fixture's deck. The replay
  is from a totally different DDD build (Doom Queen Machinex variant) and
  cannot be used to correct this fixture's authored hand.
- **12 fixtures** have no raw-replay at all and are pure authored fixtures.
  See list at the end of this memo for Axel's later decision.

---

## What we corrected

Two fixtures had their `deckSeed` extended from 2 bigints (the prior
truncated form generated by `replay-to-fixture.ts:423` "first 2 bigints of
replay.seed form the deckSeed in fixture format") to all 4 bigints from
the raw-replay's seed array.

**Why this matters**: the OCG adapter check (`ocgcore-adapter.ts:735`):

```ts
const seed: [bigint, bigint, bigint, bigint] = config.deckSeed.length >= 4
  ? [config.deckSeed[0], config.deckSeed[1], config.deckSeed[2], config.deckSeed[3]]
  : [42n, 123n, 456n, 789n];
```

A 2-bigint deckSeed activates the **stub branch** — meaning every solver
run uses the same fixed seed `[42n, 123n, 456n, 789n]` regardless of the
two bigints stored in the fixture, so mid-turn searches diverge from the
captured PvP run.

**Hand was unaffected** in both fixtures — `evaluate-structural.ts:559`
sets `startingDrawCount: 0` and the fixture's `hand[]` is placed verbatim
into HAND via `duelNewCard`. The seed truncation only matters for
**post-startup** RNG state (in-turn shuffles, mid-turn random draws).

### Backup convention

Each corrected fixture preserves the original via inline metadata fields:

```json
{
  "id": "branded-dracotail-opener",
  "hand": [...],  // unchanged — already replay-coherent
  "deckSeed": "3510667737223306533,13278052914564331778,3716801787236758182,14305699795602822198",
  "_originalDeckSeed": "3510667737223306533,13278052914564331778",
  "_replayDerivedFrom": "trajectories/branded-dracotail-opener.raw-replay.json",
  "_coherenceNote": "..."
}
```

Rollback path: replace `deckSeed` with the value of `_originalDeckSeed`,
delete the `_*` audit fields. The solver tolerates extra unknown fields
(loader is forward-compatible).

---

## Format of seed — methodological note

The user's brief flagged a potential blocker: "raw-replays have 4 bigints
vs fixtures' 2 entiers". **No conversion needed**: the fixture format is
already a comma-separated bigint string parsed in
`evaluate-structural.ts:557`:

```ts
deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim()))
```

This handles arbitrary-length comma lists. The truncation to 2 entries was
a historical artifact of `replay-to-fixture.ts:423` writing only the first
two slots. Extending to 4 is a no-code-change, native-format change.

The `ddd-pendulum-opener` mismatched seed is a different problem class:
the fixture has a synthetic mnemonic seed (`"11111,22222"`) used purely
as a determinism-anchor for a hand-authored fixture — there is no PvP
capture this fixture could be derived from. Only the
`ddd-pendulum-replay-eb8c6865.raw-replay.json` was found, which is a
**different deck** (so its hand cannot be applied to the fixture's deck).

---

## Re-baseline — canonical-eval pre/post correction

**Run config**: `SOLVER_USE_NEURAL_WEIGHTS=1 SOLVER_USE_DFS_COMPRESSION=1
npx tsx scripts/evaluate-structural.ts --budget-ms=12000 --node-budget=800
--pool-size=1 --implicit-goals=10` (Option G canonical, 2026-05-02).

**Reference baseline**: 31/69 cum matched, 596 score (canonical-eval-v2,
2026-05-02, commit pin not specified in `_meta`).

**Pre-correction baseline** (today, 2026-05-03, head `solver` branch):
**26/69 cum matched, 691 score** — see
`C:/Users/Axel/AppData/Local/Temp/pre-correction-baseline.json`. The drift
from 31→26 is unrelated to this audit (other commits between 2026-05-02
and 2026-05-03 affect this); branded-dracotail regressed 4/8 → 0/8 and
mirrorjade regressed 1/6 → 0/6 over 5 days.

**Post-correction baseline**: **26/69 cum matched, 691.64 score** —
identical to pre-correction at every fixture.

| Fixture | Pre-correction matched / score | Post-correction matched / score | Δ |
|---|---|---|---|
| ddd-pendulum-opener | 1/5, 74.5 | 1/5, 74.5 | 0 |
| ryzeal-mitsurugi-opener | 3/5, 116.5 | 3/5, 116.5 | 0 |
| radiant-typhoon-opener | 3/3, 57 | 3/3, 57 | 0 |
| **branded-dracotail-opener** | **0/8, 27** | **0/8, 27** | **0** |
| kashtira-azamina-opener | 2/4, 44 | 2/4, 44 | 0 |
| horus-crystron-opener | 2/4, 43 | 2/4, 43 | 0 |
| dinomorphia-opener | 1/3, 11 | 1/3, 11 | 0 |
| spright-opener | 3/4, 50 | 3/4, 50 | 0 |
| **snake-eye-yummy-opener** | **2/7, 36.57** | **2/7, 36.57** | **0** |
| tearlaments-opener | 1/4, 31 | 1/4, 31 | 0 |
| floowandereeze-opener | 2/4, 32 | 2/4, 32 | 0 |
| labrynth-opener | 2/4, 21 | 2/4, 21 | 0 |
| stun-runick-opener | 2/4, 31 | 2/4, 31 | 0 |
| nekroz-ryzeal-opener | 2/4, 62 | 2/4, 62 | 0 |
| branded-dracotail-mirrorjade-line | 0/6, 55.07 | 0/6, 55.07 | 0 |

**Empirical finding**: extending the deckSeed from 2 to 4 bigints had
**zero observable effect** on the canonical-eval matched/score metrics.
The DFS exploration paths the solver finds with the stub seed
`[42n,123n,456n,789n]` produce the same end-board outcomes as with the
full 4-bigint raw-replay seed at the canonical budget (12s wall + 800
nodes). Two interpretations:

1. **Mid-turn searches in these fixtures don't materially depend on
   shuffle order**. Most archetype searches enumerate by cardId match
   first (e.g., Lukias deck-search exposes all `Dracotail` matches as
   branch points), so the DFS sees identical action sets regardless of
   underlying deck order.
2. **The DFS budget is too small to traverse seed-sensitive deeper
   sub-trees**. A larger budget (e.g., `--node-budget=2000`) or a fixture
   that ends with random-discard / random-shuffle effects might surface
   a different signal. Out of scope for this audit.

The correction is therefore **maintenance / methodological hygiene**, not
a measurable solver lift. It removes a hidden coupling between the
fixture and the OCG-adapter's stub-seed branch, making any future
debugging of "fixture vs. raw-replay" coherence non-misleading.

---

## Fixtures without a raw-replay — for Axel's future decision

These 12 fixtures use mnemonic `deckSeed` strings (e.g., `"11111,22222"`,
`"31415,92653"`) and authored `hand[]` arrays. They have no PvP capture
to anchor coherence against. Three options going forward:

1. **Status quo**: leave authored. Pros: stable, deterministic. Cons: any
   "ceiling falsification" claim against these fixtures must be careful
   to compare DFS output **on the same authored hand**, not against a
   hypothetical raw-replay that doesn't exist.
2. **Generate raw-replays**: play each archetype on the simulator (or
   collect from PvP), derive fixtures via `replay-to-fixture.ts`. Cost:
   ~1-2h per archetype to record a clean canonical run. Benefit: each
   fixture's expectedBoard becomes mechanically reachable by definition.
3. **Hybrid**: keep mnemonic seed as authored-coherent baseline, attach
   raw-replays as separate fixtures (e.g., `ddd-pendulum-opener-replay`)
   when captured. Tracks both authored ceiling and replay ceiling.

Fixtures awaiting Axel's call:
- `branded-dracotail-opener-mirrorjade-line` (alternate line, same hand
  as #1)
- `ddd-pendulum-opener` (the existing replay is from a different DDD
  build)
- `ryzeal-mitsurugi-opener`
- `radiant-typhoon-opener`
- `kashtira-azamina-opener`
- `horus-crystron-opener`
- `dinomorphia-opener`
- `spright-opener`
- `tearlaments-opener`
- `floowandereeze-opener`
- `labrynth-opener`
- `stun-runick-opener`
- `nekroz-ryzeal-opener`

---

## Artifacts produced

- `duel-server/scripts/verify-fixture-replay-coherence.ts` — new ~250 LoC
  audit tool, replays a raw-replay deck through OCGCore with the captured
  seed, captures the post-startDuel HAND at the first SELECT_IDLECMD,
  and diffs against the fixture's authored `hand[]`.
- `_bmad-output/solver-data/fixture-coherence-audit-2026-05-03/` —
  per-fixture JSON results from the audit tool (3 entries: branded,
  snake-eye, ddd).
- `_bmad-output/planning-artifacts/research/solver-validation-decks.json`
  — `branded-dracotail-opener` and `snake-eye-yummy-opener` extended from
  2-bigint to 4-bigint deckSeed; `_originalDeckSeed` + `_replayDerivedFrom`
  + `_coherenceNote` audit fields added.
- `_bmad-output/solver-data/canonical-eval-post-fixture-correction.json`
  — post-correction canonical-eval (Option G config).
- `C:/Users/Axel/AppData/Local/Temp/pre-correction-baseline.json` —
  pre-correction canonical-eval at the same config (for delta isolation).
