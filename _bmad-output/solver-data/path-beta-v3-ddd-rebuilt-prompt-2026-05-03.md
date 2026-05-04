# Path β v3 dispatch prompt — `ddd-pendulum-opener` (rebuilt fixture)

**Status: PREPARED, NOT DISPATCHED.** Axel must review the rebuilt
fixture (`ddd-pendulum-opener`) and the rebuild memo
(`ddd-fixture-rebuild-2026-05-03.md`) before dispatching this prompt to
a Path β v3 subagent.

## When you dispatch this

Use the same Claude Code subagent mechanism as Path β v2 (parallel
dispatch, $0 via subscription). Single-fixture target, no batching needed.

---

## Subagent prompt (copy/paste to subagent input)

You are a Path β v3 solver-research subagent. Your task: **find a
plan-replay JSON for the fixture `ddd-pendulum-opener` that
reproduces the canonical 9-piece D/D/D endboard documented below.**

### Fixture facts

- Fixture id: `ddd-pendulum-opener`
- Deck: `ddd-doom-queen-machinex-variant` (D/D/D Doom Queen Machinex
  variant, 42 main + 15 extra). Full deck list in
  `_bmad-output/planning-artifacts/research/solver-validation-decks.json`
  under `decks.ddd-doom-queen-machinex-variant`.
- Hand (5 cards, OCG-shuffled from full 4-bigint seed):
  - 54693926 Dark Ruler No More
  - 20715411 D/D/D Zero Doom Queen Machinex
  - 54693926 Dark Ruler No More
  - 54693926 Dark Ruler No More
  - 39256679 Beta The Magnet Warrior
- Seed: `13286124478549588979,13175075721773498195,8073424696826179950,4475465596156117151`

### Target endboard (9 pieces — all required for matched 9/9)

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

### Ground-truth available

This fixture was **auto-derived from a real PvP raw-replay**
(`eb8c6865-666f-4e9f-8c6a-7a69615db5f0`) — meaning the endboard above
was actually produced by a human player from this exact hand+deck+seed
combination. The full 272-prompt response sequence is on disk at
`_bmad-output/planning-artifacts/research/trajectories/ddd-pendulum-replay-eb8c6865.raw-replay.json`.

**Use raw-replay-verify** as a sanity check on your plan-replay:

```bash
cd duel-server
npx tsx scripts/raw-replay-verify.ts \
  --raw-replay=../_bmad-output/planning-artifacts/research/trajectories/ddd-pendulum-replay-eb8c6865.raw-replay.json \
  --fixture-id=ddd-pendulum-opener \
  --out=/tmp/ddd-replay-verify.json
```

This replays the captured 272 responses and reports the resulting endboard
match against your `expectedBoard`. Should report 9/9 match (it's the
ground truth). If not, the harness has a bug (very unlikely after
2026-05-02 sort-card fix, but check).

### Methodology

1. **Read the raw-replay summary first.** Use raw-replay-verify or read
   the steps[] array directly to understand:
   - Which cards were activated (cardId trajectory)
   - In what order (Pendulum scales first? Doom Queen first? When does
     each Contract trigger?)
   - Key chain interactions (any Dark Ruler chained back to negate
     opponent? — note: opponent has no field, so Dark Rulers may be
     **discarded fodder** for D/D/D effects, not activations)
   - Beta Magnet Warrior's role: probably tribute fodder for Doom Queen,
     or scale-zero pendulum monster for the scale 0/8 Pendulum Summon
     (Doom Queen scale is the high scale, need to verify card text)

2. **Build a plan-replay JSON** using the standard schema (see
   `_bmad-output/solver-data/path-beta-methodology.md` and
   `_bmad-output/solver-data/path-beta-v2-aggregate-methodology-2026-05-03.md`).

3. **Use the raw-replay's response sequence as your reference but
   re-author it** in the plan-replay format (humans can't reproduce
   exact OCG response payloads — this is the entire point of Path β —
   but you can reproduce the **decisions**: which card activated, with
   what targets, what chain order, what Pendulum scales, what
   summon-zone choice).

4. **CLI tool to test plan-replay**:
   ```bash
   cd duel-server
   npx tsx scripts/replay-trajectory-cli.ts \
     --fixture-id=ddd-pendulum-opener \
     --plan=<your-plan.json> \
     --out=<verification-result.json>
   ```

5. **Iterate until matched=9/9.** Use the standard β-1, β-2 enumeration
   tools (enumerate-pivot, enumerate-skip) for any plateau where you
   can't bridge between two combo steps.

6. **If you hit a true ceiling** (e.g., raw-replay step X requires a
   card-mechanic the harness doesn't support), document it precisely
   with the failing prompt index, the OCG card script behavior, and
   what harness change would unblock. Do **not** silently accept <9/9.

### Constraints

- **Do not modify production solver code.** All work in plan-replay JSON
  + scripts/.
- **Do not introduce new fixtures.** Only target
  `ddd-pendulum-opener`.
- **Use raw-replay-verify** to baseline that the harness can hit 9/9
  before you attempt to author the plan. If raw-replay-verify fails on
  the captured 272 responses, escalate immediately — the engine has a
  regression.
- **Document each chain link** in your plan with a comment block
  (verb-class, card, target-card, expected-effect) so Axel can audit
  the line.

### Output format

When done, write to `_bmad-output/solver-data/path-beta-v3-ddd-rebuilt-result-2026-05-03.md`:

1. matched/score from `replay-trajectory-cli.ts`
2. plan-replay JSON path
3. step-by-step combo annotation (cardId → effect → result on field)
4. any harness gaps found (with reproduction command + failing prompt index)
5. comparison: PvP raw-replay 272 prompts vs your plan-replay N prompts
   (ratio = compression factor, expected ~1× to 1.5× — this fixture's
   raw replay is already mostly mechanical, not exploratory)

### Estimated budget

- ~1-2h LLM session (single fixture, ground-truth available, hand has
  exactly 1 starter so fewer branches than e.g. branded-dracotail).
- ~30-50 plan-replay iterations to nail all 9 pieces if no harness gap.
