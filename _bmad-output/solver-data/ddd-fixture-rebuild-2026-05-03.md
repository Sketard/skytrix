# D/D/D Pendulum Fixture Rebuild from PvP Raw-Replay — 2026-05-03

## Context

The fixture-replay coherence audit (`fixture-replay-coherence-audit-2026-05-03.md`)
established that the authored `ddd-pendulum-opener` fixture has a **deck list
that diverges from the only D/D/D PvP raw-replay on record** (17 cardIds
differ on the main deck). Since the authored seed is not the OCG-style
4-bigint seed (it was set to placeholder `"11111,22222"`), no PvP raw-replay
can be re-bound to the authored fixture.

User direction: *"Il y a un pvp replay sur D/D/D, il faudrait faire la
fixture à partir de ce replay"* — rebuild from the replay, do not patch
the existing authored fixture.

This memo documents that rebuild.

## Setup

- Raw-replay used:
  `_bmad-output/planning-artifacts/research/trajectories/ddd-pendulum-replay-eb8c6865.raw-replay.json`
- Source PvP replay id: `eb8c6865-666f-4e9f-8c6a-7a69615db5f0` (skytrix dev DB,
  generated 2026-04-29)
- Tool: `duel-server/scripts/replay-file-to-fixture.ts` (sibling of
  `replay-to-fixture.ts`, reads from the local `.raw-replay.json` instead
  of fetching from the API).
- Verified: tool already preserves the **full 4 bigints of the deck seed**
  (no truncation bug — see file header lines 14-21). Solver evaluator
  (`evaluate-structural.ts:557`) and `ocgcore-adapter.ts:735` both accept
  `deckSeed.length >= 4` verbatim.
- Seed extracted from raw-replay (4 bigints):
  ```
  13286124478549588979
  13175075721773498195
   8073424696826179950
   4475465596156117151
  ```
- Deck composition (player 0 in raw-replay):
  - main: **42 cards** (atypical — dev-build allowed 42-card main, the
    authored ddd-wcq-top4 is canonical 41 main + 15 side. Real-deck
    cardlist diverges, see "Diff vs authored" below)
  - extra: **15 cards**
- responseCount: 272 prompts replayed end-to-end; OCGCore terminated
  cleanly with `responses-exhausted` after 632 iterations.

## Generated fixture

- New deck entry registered as `ddd-doom-queen-machinex-variant` in
  `_meta.decks` and `decks` of `solver-validation-decks.json`.
- New hand entry registered as `ddd-pendulum-opener-replay` (coexists with
  the authored `ddd-pendulum-opener`).
- Hand drawn (5 cards, OCG-shuffle from full 4-bigint seed):
  | cardId | name |
  |--------|------|
  | 54693926 | Dark Ruler No More |
  | 20715411 | D/D/D Zero Doom Queen Machinex |
  | 54693926 | Dark Ruler No More |
  | 54693926 | Dark Ruler No More |
  | 39256679 | Beta The Magnet Warrior |
- Note: this is an **atypical handtrap-heavy opener** — 3× Dark Ruler No
  More + Beta The Magnet Warrior + a single combo starter (Doom Queen).
  The PvP players still produced the canonical D/D/D apex despite this
  hand, suggesting Doom Queen + Beta as a hard-line into Caesar/Siegfried
  via Pendulum scales 4 + 8 (Doom Queen scale 4, Beta scale 0... actual
  scales TBD; see prompt v3 for instructions).
- expectedBoard derived from OCG `duelQueryField()` post-replay (9 pieces):

  | zone | cardId | name | position |
  |------|--------|------|----------|
  | MZONE | 79559912 | D/D/D Wave High King Caesar | attack |
  | MZONE | 44852429 | D/D/D Cursed King Siegfried | attack |
  | MZONE | 46593546 | D/D/D Deviser King Deus Machinex | defense |
  | MZONE | 30998403 | D/D/D Sky King Zeus Ragnarok | attack |
  | SZONE | 20715411 | D/D/D Zero Doom Queen Machinex | set |
  | SZONE | 9030160 | Dark Contract with the Eternal Darkness | set |
  | SZONE | 32665564 | Dark Contract with the Zero King | set |
  | SZONE | 91781484 | D/D/D Headhunt | set |
  | SZONE | 74069667 | D/D/D Oblivion King Abyss Ragnarok | set |

## Diff vs authored fixture

| Field | Authored `ddd-pendulum-opener` | Replay-derived `ddd-pendulum-opener-replay` |
|-------|--------------------------------|---------------------------------------------|
| deck id | `ddd-wcq-top4` | `ddd-doom-queen-machinex-variant` |
| main len | 41 | 42 |
| extra len | 15 | 15 |
| deckSeed | `"11111,22222"` (placeholder, 2 bigints) | full 4-bigint OCG seed |
| `_seedFrozen` | true | true |
| hand[0..4] | Savant Kepler+Copernicus+Surveyor+Gate+Fuwalos | 3× Dark Ruler + Doom Queen + Beta Magnet Warrior |
| expectedBoard | 5 pieces | 9 pieces |
| `_replayDerivedFrom` | (none) | `eb8c6865-666f-4e9f-8c6a-7a69615db5f0` |

Main deck overlap: **24 / 41 cards** in common (17 cards diverge — confirmed by
manual cross-tabulation: replay variant adds Doom Queen Machinex × 3 main +
Eternal Darkness, removes Savant Kepler/Copernicus, etc.).

## Validation

- **Coherence** (replay-to-fixture verifier):
  ```
  fixtureHand    = [54693926, 20715411, 54693926, 54693926, 39256679]
  replayDrawnHand = [54693926, 20715411, 54693926, 54693926, 39256679]
  cohesion       = identical
  deck-main diff count = 0
  deck-extra diff count = 0
  ```
  → **`coherent: true`** (identical match).

- **Solver eval** (canonical config: `--budget-ms=12000 --node-budget=800
  --pool-size=1 --implicit-goals=10`, no neural weights / compression for
  faster comparison):

  | fixture | matched | score | nodes | depth | walltime | term |
  |---------|---------|-------|-------|-------|----------|------|
  | `ddd-pendulum-opener` (authored, 5-piece eb) | **1/5** | 68.5 | 840 | 45 | 10243ms | timeout |
  | `ddd-pendulum-opener-replay` (replay, 9-piece eb) | **0/9** | 60.5 | 842 | 26 | 10251ms | timeout |

  The replay fixture is structurally **harder** for the DFS:
  (a) 9-piece endboard has a smaller match radius per piece, (b) the
  handtrap-heavy hand (3× Dark Ruler) gives the solver fewer mechanical
  starters than the 1-card-Gate authored hand, (c) max DFS depth at the
  same budget is shallower (26 vs 45) — the 42-card deck and unusual hand
  make the solver burn nodes earlier without reaching apex.

## Decision: SWAP (Scenario A) — final

User decision 2026-05-03: **swap** the canonical `ddd-pendulum-opener` id
to point at the replay-derived fixture. Rationale: the canonical-eval
benchmark must reflect mechanically-grounded targets, not authored
combinatorics that may be unreachable from the specified hand. The PvP
raw-replay is the gold standard — the players reached the 9-piece
endboard from this exact hand+seed, so the discovery target is
mechanically guaranteed.

### Resulting state in `solver-validation-decks.json`

- `ddd-pendulum-opener` (canonical id) → now points at the **replay-derived**
  Doom Queen Machinex variant. 9-piece endboard, 4-bigint OCG seed, hand
  drawn from raw-replay shuffle. Mechanically validated.
- `ddd-pendulum-opener-authored-2026-04` (archived id) → preserves the
  prior authored 5-piece variant for historical reference. Marked with
  `_archived` field documenting the swap rationale (subagent v3 concluded
  2/5 ceiling — likely fixture authoring mismatch where expectedBoard
  combinatorics exceed what the authored hand can mechanically deliver).
  Not removed from the file to allow rollback or comparison runs.

### Implication for canonical-eval baselines

The `ddd-pendulum-opener` baseline shifts from 1/5 (authored) to 0/9
(replay-derived) at canonical config. Cum-matched on the 14-fixture
canonical-eval will need re-baselining post-swap:
- Pre-swap baseline: 1/5 contribution from ddd
- Post-swap baseline: 0/9 contribution from ddd

Eval comparisons spanning the swap date must reference the appropriate
baseline. The `_archived` fixture stays available via `--only=ddd-pendulum-opener-authored-2026-04`
for parallel runs if needed.

The deck `ddd-doom-queen-machinex-variant` is now formally registered, so
future raw-replays of this variant can extend the hand list under the same
deck without re-importing.

## Files touched

- `_bmad-output/planning-artifacts/research/solver-validation-decks.json`
  - Added `_meta.decks.ddd-doom-queen-machinex-variant` (PvP source,
    notes).
  - Added `decks.ddd-doom-queen-machinex-variant` (42-card main + 15-card
    extra).
  - Added `hands[].ddd-pendulum-opener-replay` (canonical schema with
    `_replayDerivedFrom`).
- `_bmad-output/solver-data/ddd-pendulum-fixture-from-replay.json` (dry-run
  artifact from `replay-file-to-fixture.ts`, kept for reference).
- `_bmad-output/solver-data/ddd-replay-eval.json` (matched=0/9 baseline).
- `_bmad-output/solver-data/ddd-old-eval.json` (authored 1/5 baseline at
  same config — kept for the comparison table above).

## Path β v3 prompt — prepared, NOT dispatched

Stored at: `_bmad-output/solver-data/path-beta-v3-ddd-rebuilt-prompt-2026-05-03.md`

Targets: `ddd-pendulum-opener` (the new canonical id, post-swap). Path β v3
methodology with raw-replay-verify constraint: subagent receives the raw
replay summary and should produce a plan-replay JSON that hits all 9
endboard pieces. Expected lift: 0/9 → 7-9/9 if the LLM can reproduce the
PvP combo with Doom Queen + Beta + 3× Dark Ruler.

**Note**: the prompt file may reference the old `ddd-pendulum-opener-replay` id
in pre-swap drafts — update to `ddd-pendulum-opener` before dispatch (the
canonical id post-swap).

## Coherence audit closure

The 2026-05-03 audit flagged `ddd-pendulum-opener` as the only fixture
with a unrecoverable `_seedFrozen=true` mismatch (placeholder seed → no
raw-replay reconciliation possible). With this rebuild, the replay-derived
shape now sits alongside it; the authored fixture's seed remains as
documented (placeholder, intentional research artifact, not claiming PvP
reproducibility).

For the 11 other `_seedFrozen=true` fixtures auto-generated by
`replay-to-fixture.ts:423` (truncate-to-2-bigints bug), the audit
recommendation stands — re-derive each via `replay-file-to-fixture.ts`
when the corresponding raw-replay file is available, or fix the
underlying bug in `replay-to-fixture.ts:423`. Out of scope for this
memo.
