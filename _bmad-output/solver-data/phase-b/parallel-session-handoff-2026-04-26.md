# Phase B Day 2 — parallel session handoff

**Date:** 2026-04-26 (evening)
**Session:** parallel ("session 2"); main session running C1 4-fix MLP
randinit job `bixe7mim0` for ~3.5h.
**Branch:** `solver`. No force-push, no rebase, no pull. All commits
ahead of origin/solver.

## Items shipped

### A. Plumb opp-zone snapshot on FieldState — `b4142292`
- `solver-types.ts`: added optional
  `FieldState.oppZones?: Record<ZoneId, FieldCard[]>` (backward-compat).
- `ocg-field-query.ts`: `queryFieldState` now populates `oppZones` for
  player 1 — board zones (M1-M5, EMZ_L/R, S1-S5, FIELD) + pile zones
  (HAND, GY, BANISHED, DECK, EXTRA). Pile zones included for forward
  compatibility; ranker features 32-35 only need board.
- Type-check clean.

**State-feature-extractor wiring DEFERRED.** The reads
(`state.oppZones?.M1` etc.) for rows 32-35 (`monsters_opp_count`,
`spell_traps_opp_count`, `field_spell_opp_present`, `opp_overlay_units`)
are NOT yet wired — feature names + extractor logic stay frozen for the
duration of C1 so the active training run's `featureSpecHash` doesn't
mismatch on weights load.

### B. Plumb normalSummonUsed flag on FieldState — `c6e923b2`
- `ocgcore-adapter.ts`: added
  `InternalHandle.normalSummonsByPlayer: [boolean, boolean]`. Initialized
  `[false, false]` in `createDuel`. Tracked in `runUntilPlayerPrompt`
  message loop:
  - `OcgMessageType.NEW_TURN` → reset both to false.
  - `OcgMessageType.SUMMONING` (NS / tribute summon) → set
    `controller`'s flag true.
  - `OcgMessageType.FLIPSUMMONING` → same (NS budget shared per YGO).
  - `SPSUMMONING` NOT tracked (special summons have no NS budget).
  - Cloned in `forkViaSnapshot` and `forkViaReplay`.
- `solver-types.ts`: added optional
  `FieldState.normalSummonUsed?: [boolean, boolean]`.
- `ocg-field-query.ts`: `FieldQueryContext.normalSummonUsed?:` field;
  `queryFieldState` forwards it onto FieldState.
- `ocgcore-adapter.queryFieldState` private wrapper passes
  `internal.normalSummonsByPlayer` through.
- Type-check clean.

**Same DEFERRED note**: extractor wiring of `state.normalSummonUsed?.[0]`
into feature `normal_summon_used` (slot 5) lands in the post-C1 commit.

### D. Memory memo update
- `project_phase_b_pre_flight_verdict_2026_04_26.md` gained a `## Day 2
  progress (2026-04-26 evening)` section with all 4 commits, smoke
  results, in-flight C1 job ID + ETA, and a paragraph on the deferred
  extractor-wiring constraint.

### C. ES-vs-re-eval determinism investigation — `e5068169`
**SHIPPED.** User confirmed "ok pour c" after items A+B+D+handoff landed.

- Built `duel-server/scripts/diag-determinism.ts`: runs N consecutive
  `runFixture` calls on the same weights, reports outcome vs compute
  variance.
- Ran 5× snake-eye-yummy + neural-pre-flight-seed7 at canonical
  nb=400/budget-ms=6000.
- **Result: state leak FALSIFIED.** Score/matched/interruptionScore
  bit-stable (11/2/11.00) across all 5 runs. Only nodes vary (316-370,
  15.4% span). All runs hit `term=timeout` at ~5220ms.
- The eval is wall-clock-bound, not nb-bound. ES-vs-re-eval gap is CPU-
  load-dependent node throughput, not state corruption.
- Full report:
  `_bmad-output/solver-data/phase-b/determinism-investigation-2026-04-26.md`.

**Recommendation for Day 3+ training (in report):** switch ES selection
or eval to nb-bound regime (`budget-ms=30000`) or median-of-N rollouts.
For C1 in-flight: leave alone; re-eval candidates at nb-bound on hold-out
for ship gate.

## Items skipped / deferred

None — all 4 items (A, B, D, C) shipped this session.

## Constraints honored
- ✅ Did NOT modify `train-neural.ts` / `train-neural-pre-flight.ts`.
- ✅ Did NOT modify `neural-ranker.ts` / `state-feature-extractor.ts` /
  `neural-weights-loader.ts`.
- ✅ No restart of any node process.
- ✅ No big computes (>2 min).
- ✅ Small atomic commits (`b4142292`, `c6e923b2`); no force-push, no
  rebase, no pull.
- ✅ Type-check (`npx tsc --noEmit`) green after each change.
- ✅ Branch stays on `solver`.

## Problems encountered

None. Both A and B are pure plumbing with backward-compat optional
fields; touched 3 files total, ~106 LOC additions across 2 commits.

## Recommended next actions for main session post-C1

1. Wire extractor reads in `state-feature-extractor.ts`:
   - Row 32 `monsters_opp_count`: `state.oppZones?.M1.length + …`
   - Row 33 `spell_traps_opp_count`: `state.oppZones?.S1..S5`.
   - Row 34 `field_spell_opp_present`: `(state.oppZones?.FIELD?.length ?? 0) > 0`.
   - Row 35 `opp_overlay_units`: sum overlayCount across opp MZONE/EMZ.
   - Slot 5 `normal_summon_used`: `state.normalSummonUsed?.[0] ? 1 : 0`
     (replaces the `is_self_turn` override comment — slot 4 is
     `is_self_turn`, slot 5 is `lp_self_norm` per current ordering).

   **WAIT** — the existing extractor uses ordering A.5=`is_self_turn`,
   A.6=`lp_self_norm`, no `normal_summon_used` slot exists. Adding the
   feature changes `STATE_DIM`/feature names → bumps featureSpecHash →
   incompatible with C1's trained weights. Decision needed: (a) add
   `normal_summon_used` AFTER current 49 features (ablation 6 in design
   doc) and grow STATE_DIM to 50, accepting that C1's weights are
   non-portable; or (b) defer until next training cycle. Worth checking
   design doc §3 for the intended slot — the `normalSummonUsed` plumbing
   is the prereq either way.

2. Run the post-extractor-wiring smoke test (1-fixture × 30 gen ×
   snake-eye-yummy) to confirm features 32-35 + normal_summon_used carry
   non-zero signal before the next 20h training cycle.

3. Item C if not yet picked up by parallel session.
