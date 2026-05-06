# Path β v2 — Pending follow-ups (next session)

**Date:** 2026-05-03
**Status:** TODO list for the next solver R&D session
**Predecessor:** `path-beta-v2-aggregate-2026-05-03.md` (full audit synthesis)

This memo lists what was prepared but not run in this session due to budget constraints. Read the predecessor for full context.

## Pending follow-ups (priority order)

### F1 — Re-dispatch branded-dracotail-opener-mirrorjade-line (~30-90min wallclock, $0 cost)

**Context**: prior v2 dispatch reached **5/6** but the 6th card (Dracotail Faimena) was expected in HAND zone, which was unreachable in the matcher. Two grammar fixes shipped in commit `85e75704` should unblock 6/6:
- HAND added to `SCORED_ZONES` in `replay-trajectory-cli.ts:1071`
- `responseIndex: -1` now correctly matches the `unselect-finish` action for SELECT_UNSELECT_CARD via `tryConsumeTarget` special-case
- Queue mis-consumption on non-matching `responseIndex` now consumes the target (fail-fast rather than silent mis-fire)

**Action**: dispatch the v2 subagent on `branded-dracotail-opener-mirrorjade-line` with the standard prompt template (`path-beta-prompt-template-v2.md`). Expected lift: 5/6 → 6/6. The session was started but stopped early per user request — no result yet.

**Validation**: if 6/6 reached, the HAND matcher fix is empirically validated. If still 5/6 with a different missing card, the mismatch is elsewhere (re-investigate).

### F2 — Investigate Bug 4 Tearlaments engine validation timing (~1-3h, fresh context recommended)

**Context**: OCGCore exposes invalid Fusion materials (e.g., Reinoheart, a Warrior, surfaces as legal material for Kitkallos which requires Aqua) at the SELECT_UNSELECT_CARD prompt. Fusion silently no-ops at resolve. Could be by-design (let user pick, validate at resolve) or a real bug.

**Action**: a self-contained investigation prompt was drafted in this session (it lives in the conversation transcript — re-draft from the v2 aggregate memo's "Bug 4" entry if needed). Key investigation steps:
1. Read OCGCore source / wasm wrapper for SELECT_UNSELECT_CARD candidate-set logic on Fusion materials.
2. Read Kitkallos's Lua at `duel-server/data/scripts_full/c92731385.lua` to confirm material check is filter-time vs resolve-time.
3. Compare with a "well-behaved" Fusion archetype (e.g., Branded Fusion's "1 Fallen of Albaz" filter).
4. If filter is the bug: write an adapter-level pre-filter in `enumerateUnselectCard`. If by-design: document the contract in `yugioh-game-rules.md` §5.5 and the v2 prompt template.

**Bit-exact gate**: any code change must preserve trace bit-exactness on the 3 β-1 baselines (branded-dracotail-opener, ddd-pendulum-opener, snake-eye-yummy-opener).

**Deliverable**: short memo at `_bmad-output/solver-data/tearlaments-engine-validation-timing-investigation.md` with root cause + recommended fix + reproducible test plan.

### F3 — Optionally: re-dispatch the 4 originally-audited v1 fixtures with v2 (~2-4h wallclock)

**Context**: the 4 fixtures audited in v1 sprints (branded-dracotail-opener, ddd-pendulum-opener, snake-eye-yummy-opener, ryzeal-mitsurugi-opener; plus radiant-typhoon-opener already at 3/3) might lift further with v2 methodology.

**Expected outcomes**:
- ddd-pendulum-opener (v1 best 3/5) — might find a 4/5 line with v2's deck audit + CoT discipline (the PvP raw-replay confirms 5/5 reachable, so plenty of headroom).
- snake-eye-yummy-opener (v1 best 4/7) — same; PvP raw-replay confirms 7/7.
- branded-dracotail-opener (v1 + v2 best 7/8) — same plateau; missed Albion EP-Set route. Would need explicit hint or deeper search budget to break — defer.
- ryzeal-mitsurugi-opener (v1 best 5/5) — already optimal, no need.

**Action**: dispatch v2 on ddd-pendulum-opener and snake-eye-yummy-opener. Skip branded-dracotail-opener (deep blind-spot) and ryzeal-mitsurugi-opener (already optimal). Coût: ~30-60 min each.

### F4 — Add B.7.6–B.7.11 doc sections from v2 aggregate feedback (~1h)

**Context**: 6 new sub-prompt patterns identified by subagents during the v2 aggregate audit. Listed in `path-beta-v2-aggregate-2026-05-03.md` "Doc gaps to add" section. Adding them benefits future dispatches without code changes.

Sections to add:
- B.7.6: SELECT_TRIBUTE post-pick `[(pass), (pass)]` confirmation prompt (Lv7+ TribSums, override `responseIndex: 1`)
- B.7.7: SELECT_OPTION no-tribute Lv7+ infinite loop (override `responseIndex: 1`)
- B.7.8: Continuous Spell two-step activation pattern (Deception-class)
- B.7.9: S:P Little Knight self-sabotage on banish trigger
- B.7.10: Cross-archetype SS-from-hand verb (`summon-procedure` not `activate`)
- B.7.11: chainTargets ambiguity on multi-trigger cards (workaround note)

**Action**: edit `_bmad-output/planning-artifacts/yugioh-game-rules.md` Annexe B.7. ~15 min for all 6 sections.

### F5 — Harness extension for opp-turn driver (~1-2 days, defer)

**Context**: Dinomorphia's verdict "1/3 harness limit" exposed that `replay-trajectory-cli` ends at end of turn 1, incompatible with Trap-fusion archetypes (Domain/Frenzy fire on opp's MP). Extending the harness to drive a stub opp turn unlocks Dinomorphia + classes (Eldlich, partial Floowandereeze, Labrynth deeper plays).

**Action**: design + implement a `--with-opp-turn` flag on `replay-trajectory-cli.ts` that drives a no-op opp turn after the player's turn 1, allowing player's set Quick-Plays / Traps to flip-activate at opp's MP. Coût estimé: 1-2 days infra. Defer until F1-F4 are done.

## What is shipped and committed

In the current session (commits in branch `solver`):

| Commit | Description |
|---|---|
| `cec82b32` | SELECT_EFFECTYN compression Phase 2 — NULL+REGRESSION, reverted |
| `dde591b5` | raw-replay-verifier + trajectory-diff tools — falsified ceiling claims |
| `c3e3bd44` | Path β v2 methodology — canonical YGO rules + prompt template + analyzer |
| `69e11d12` | Path β v2 doc + prompt updates from spright/labrynth feedback |
| `3779f2bb` | β-1 grammar fixes + doc updates from batch 2 feedback |
| `0cc824a3` | Path β v2 aggregate — 11/11 canonical-eval audited, +17 matched |
| `85e75704` | 3 β-1 grammar fixes from v2 aggregate audit feedback |

## Aggregate result reached

- Path β v2 dispatched on **11/11 canonical-eval fixtures** (full coverage).
- DFS Option G **22/50 → Path β v2 39/50** (+17 matched, +34 percentage points) on the 11 audited fixtures.
- 5 full clears (Spright, Labrynth, Kashtira, Stun-Runick, plus 2 rigorously-justified structural ceilings on Nekroz-Ryzeal and Floowandereeze).
- 8/11 fixtures lifted ≥+1 vs DFS.
- ~80% verification rate average across CoT logs.
- 0 confirmed false ceilings (vs v1's 3 falsified ceilings).
- $0 cost via Claude Code subscription, ~6h total wallclock.
- 15 distinct issues identified with empirical reproductions; 3 critical bugs fixed in this session; 1 deferred.

The methodology v2 is shipped, validated, and ready for continued use. The 5 follow-ups above are the natural next steps when budget permits.
