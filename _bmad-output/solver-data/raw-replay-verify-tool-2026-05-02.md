# raw-replay-verify.ts — round-trip ground-truth validation tool

**Date:** 2026-05-02
**Status:** SHIPPED — new script, no production code modified
**Predecessor:** `project_replay_to_fixture_tool_2026_04_19.md` (memo flagged the round-trip gap as "1-day fix")

## TL;DR

A new CLI script `duel-server/scripts/raw-replay-verify.ts` replays a `.raw-replay.json` (PvP-recorded combo) directly through OCGCore (bypassing the solver adapter) and matches the resulting endboard against the fixture's `expectedBoard`. Provides **ground-truth `matched/score`** for fixtures with a recorded PvP replay — answering definitively "is the gap a search-side limitation or a structural ceiling?".

## Decisive empirical results — three "structural ceiling" claims falsified

Cross-fixture validation on the 3 raw-replay files in `_bmad-output/planning-artifacts/research/trajectories/`:

| Fixture | Path β best | DFS Option G | **raw-replay-verify** | Diagnosis |
|---|---:|---:|---:|---|
| branded-dracotail-opener | 7/8 | 4/8 | **8/8** | Both Path β 7/8 and DFS 4/8 are local optima |
| ddd-pendulum-opener | 3/5 | 1/5 | **5/5** | Subagent's "structurally unreachable" claim falsified |
| snake-eye-yummy-opener | 4/7 | 2/7 | **7/7** | Path β 4/7 plateau is search-bounded |

Sum of best-known matched on these 3 fixtures jumps from `7+3+4 = 14` to `8+5+7 = 20`, **+6 cum matched** if the solver could find these lines. Extrapolating the same ratio to the other 12 fixtures (where no PvP replay exists yet, but the same phenomenon likely holds): the canonical-eval Option G ceiling of 31/69 is far from a hard limit — the structural budget is more like 50-60+/69.

## What was already there

- `replay-to-fixture.ts` (2026-04-19) — fetches a PvP replay from the Spring Boot backend, runs it through OCGCore, captures hand + expectedBoard, writes a fixture entry + the `.raw-replay.json` artifact. Validated end-to-end on snake-eye-yummy 7/7 in 2026-04-19. **This is the upstream source of `.raw-replay.json` files.**
- `raw-replay-to-trajectory.ts` (2026-04-19) — converts a `.raw-replay.json` into an adapter-format summary (24 high-level decisions out of 177 raw responses for snake-eye-yummy). Useful for visualization, but the output `_warning` flags it as **non-replayable in the solver**.
- The 2026-04-19 memo (`project_replay_to_fixture_tool_2026_04_19.md`) explicitly anticipates this round-trip gap and proposes a fix: "extend solver adapter to support PvP-style init when `deckSeed.length === 4` AND `hand === []` — use `startingDrawCount=5`, let the engine shuffle+deal. Matches PvP state deterministically. Estimated 1 day."

## Why the "1-day fix" was unnecessary

I tried to implement the proposed fix on `replay-trajectory-cli.ts` (the β-1/β-3 plan replayer), then realized:

1. The solver adapter **already supports** PvP-style init at `ocgcore-adapter.ts:706-710`: `deckSeed.length >= 4` → use full seed, otherwise hardcoded fallback; `startingDrawCount = config.startingDrawCount ?? 5`. The infra was added some time after the 2026-04-19 memo without updating the memo.
2. The actual blocker for `replay-trajectory-cli` is **adapter auto-resolve of mechanical sub-prompts** (SELECT_PLACE/SELECT_POSITION/SELECT_CARD-deterministic) via `MechanicalDefaultOracle`. Humans pick zone 4, default picks zone 0 — divergence happens on the first board placement decision regardless of the seed.
3. Round-trip therefore requires **bypassing the adapter entirely** and feeding raw responses verbatim to OCGCore via `duelSetResponse`. The `replay-to-fixture.ts::runReplayOnCore` loop already does this for the upstream capture path.

The new `raw-replay-verify.ts` is essentially `runReplayOnCore` reused as a verification tool: load `.raw-replay.json`, recreate the duel with the captured 4-bigint seed + decks, feed each captured response in order, capture the final board, match against fixture's `expectedBoard`.

## Implementation

`duel-server/scripts/raw-replay-verify.ts` (~290 LoC, 0 production code touched).

- **Direct OCGCore.** `createCore({ sync: true })` + `duelProcess`/`duelGetMessage`/`duelSetResponse` loop. Same pattern as `replay-to-fixture.ts:238-352`.
- **PvP-style init.** `team1.startingDrawCount=5`, full 4-bigint seed from raw-replay, decks[team].main loaded into DECK location, no pre-loaded HAND. Engine shuffles + deals 5 cards = same starting hand as recorded.
- **Verbatim response feed.** For each select-prompt message, take the next captured response from `raw.steps[responseIdx]` if its `type` matches the prompt's `expectedResponseType`. Otherwise fall back to `autoRespond` for prompts not stored in `playerResponses` (RPS, initial SELECT_OPTION). No matching/skipping — strict in-order consumption.
- **Endboard capture.** Same `queryZoneCard` + `captureBoard` helpers as `replay-to-fixture.ts`, extended to also capture overlay materials (XYZ stacks).
- **Output** (`VerifyResult`): `matched`, `matchedCardIds`, `missingCardIds`, `unexpectedOnFieldCardIds` (cards on field beyond expected = "bonus" board pieces), `finalBoardSelf`, `finalBoardOpp`, `terminated` reason, `divergence` log.

## Known limitations

- **Replay must end at the desired snapshot point.** OCGCore typically emits one or more residual prompts after the captured stream is exhausted (end-of-turn settlement, opponent's turn-1 IDLECMD, etc.). The verifier reports `terminated=responses-exhausted` and treats the state at that point as the snapshot. If the recording stops at an undesirable moment (e.g., before the End Phase return-from-banishment fires), the snapshot will be incomplete. None of the 3 validated fixtures have this issue; all 3 reach exactly their `expectedBoard`.
- **Not a fixture-from-replay tool.** This script verifies an existing fixture against an existing replay. Use `replay-to-fixture.ts` to mint new `.raw-replay.json` files from PvP records.
- **No solver-adapter parity claimed.** The adapter cannot produce the PvP combo via DFS or β-1 plan replay because the auto-resolve path picks different zones than the recorded human choices. This is fundamental, not a config issue.

## Strategic implications

The **plafond ~80% via Path β** narrative I held earlier is now empirically falsified. On the 3 fixtures with PvP replays:

- The full `expectedBoard` is **always reachable** (8/8, 5/5, 7/7).
- Both DFS and Path β subagents systematically find a strict subset of the optimal endboard.
- The gap is **search-side**, not material-side.

For the user's "100% atteignable via LLM" question: the answer shifts from "no, ~80% structural ceiling" to **"yes in principle, but only by giving the LLM the right grammar / search hints / starting trajectory"**. The current Path β pipeline plateau on a fixture is *not* evidence of a structural ceiling.

## Immediate follow-ups (suggested order)

1. **Generate raw-replays for the 11 unaudited fixtures.** Run real PvP combos for each (or have a strong human player record them once), then feed through `replay-to-fixture.ts`. This turns "unknown ceiling" into "ground-truth ceiling" for the entire canonical-eval set.
2. **Mark `expectedBoard` as "verified-by-replay"** vs "aspirational" in `solver-validation-decks.json`. The 3 verified fixtures should have a `_verifiedByReplay: <path>` annotation. Future R&D should compare DFS/Path β against the verified ceiling rather than the literal expectedBoard (which can drift from achievable reality).
3. **Provide raw-replay summaries to Path β subagents.** A 16-decision summary of the 8/8 line for branded would dramatically constrain the subagent's search space. This is a near-zero-cost augmentation to the methodology.
4. **Train a per-fixture canonical-line learned policy** seeded from the raw-replay decisions — this is exactly the Phase 5-lite behavior cloning the original memo flagged as the high-leverage long-term direction.

## Files

- New script: `duel-server/scripts/raw-replay-verify.ts` (~290 LoC)
- This memo: `_bmad-output/solver-data/raw-replay-verify-tool-2026-05-02.md`
- Predecessors:
  - `_bmad-output/solver-data/project_replay_to_fixture_tool_2026_04_19.md` (auto-memory)
  - `duel-server/scripts/replay-to-fixture.ts` (upstream capture path)
  - `duel-server/scripts/raw-replay-to-trajectory.ts` (visualization-only converter)

## Recommended canonical commands

```bash
# Verify a recorded PvP replay reaches the fixture's expectedBoard
cd duel-server
npx tsx scripts/raw-replay-verify.ts \
  --raw-replay=../_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener.raw-replay.json \
  --fixture-id=branded-dracotail-opener \
  --out=/tmp/branded-verify.json
```

Output goes to `<out>` as JSON; key fields = `matched`, `matchedCardIds`, `missingCardIds`, `finalBoardSelf`. Process exit = 0 if no divergence (replay consumed cleanly), 1 if mid-stream mismatch.
