# mechanicalOverrides[] grammar — Implementation memo (2026-05-03)

## Summary

Adds opt-in `mechanicalOverrides[]` field to the β-1 v2 plan grammar in
`replay-trajectory-cli.ts`. Path β subagents (and human authors) can now
pin specific values on 5 sub-prompts that were previously hardcoded to
auto-respond defaults:

1. **SELECT_PLACE** — pin a zone (M1-M5, EMZ_L, EMZ_R, S1-S5, FZ)
2. **SELECT_POSITION** — FACEUP_ATTACK / FACEUP_DEFENSE / FACEDOWN_DEFENSE
3. **ANNOUNCE_NUMBER** — literal value (mapped to options[] index)
4. **SELECT_OPTION** — responseIndex into the option list
5. **SELECT_TRIBUTE** — responseIndex (auto-respond + first-N fallback)

## Architecture

Two integration points:

### 1. Adapter-side hook (auto-respond prompts)

`OCGCoreAdapter.setMechanicalOverrideHook(hook)` installs a callback
consulted in `runUntilPlayerPrompt` BEFORE both `tryInteractiveMechanical`
and `autoRespondMechanical` for player-0 mechanical (non-EXPLORATORY)
prompts. Hook signature:

```ts
(promptType: PromptType, msg: Record<string, unknown>) => unknown | null
```

When the hook returns a non-null `unknown`, the adapter calls
`duelSetResponse(...)` with that value and continues the prompt loop —
fully bypassing the interactive / auto-respond paths. When `null`, the
adapter falls through to its default behavior. **Backward-compat is
strict**: when no hook is installed (DFS / production), this is a single
property check and a no-op. Bit-exact verified on 3 β-1 v2 baselines.

The hook fires whether the prompt would have surfaced via
`tryInteractiveMechanical` (e.g. SELECT_PLACE with EMZ available) OR
been auto-resolved (e.g. ANNOUNCE_NUMBER, SELECT_POSITION) — the hook
short-circuits both paths.

### 2. CLI-side override consumption (SELECT_OPTION)

`SELECT_OPTION` is in `EXPLORATORY_PROMPTS`, so it's enumerated and
surfaced as legal actions to the CLI. The CLI checks
`tryConsumeMechanicalOverrideOption` BEFORE `tryConsumeTarget`, giving
overrides priority over the legacy `targets[]` mechanism.

## Schema

```jsonc
{
  "plan": [...],
  "mechanicalOverrides": [
    {
      "after": "Lance Soldier activate",          // case-insensitive substring
      "promptType": "ANNOUNCE_NUMBER",
      "value": 2                                   // literal value
    },
    {
      "after": "I:P Masquerena summon-procedure",
      "promptType": "SELECT_PLACE",
      "zone": "S5"                                 // zone string
    },
    {
      "after": "D/D Scale Surveyor activate",
      "promptType": "SELECT_POSITION",
      "position": "FACEUP_DEFENSE"
    },
    {
      "after": "Some Card activate",
      "promptType": "SELECT_OPTION",
      "responseIndex": 1
    },
    {
      "after": "Doom Queen Mach tribute-summon",
      "promptType": "SELECT_TRIBUTE",
      "responseIndex": 1
    }
  ],
  "endTurn": true
}
```

### Matching semantics

- **`after` substring match**: case-insensitive substring of the
  `lastIdlecmdDesc`, which is updated to `"<cardName> <verb>"` on every
  IDLECMD pick (no inner parens). Examples:
  - `"D/D Scale Surveyor activate"` matches IDLECMD desc `"d/d scale surveyor activate"`
  - `"Almiraj summon"` matches `"salamangreat almiraj summon-procedure"`
- **`promptType` exact match**.
- The override must match BEFORE the next SELECT_IDLECMD pick — once the
  next IDLECMD updates `lastIdlecmdDesc`, the override's window closes.
  (For prompts that fire LATE, e.g. ANNOUNCE_NUMBER during end-phase
  resolution, target the IDLECMD that immediately precedes the late
  prompt — typically `"end-phase"` for engine-driven late effects.)
- **FIFO consumption**: each override is consumed at most once. When
  multiple share the same `after`, they apply in array order.
- **Skip-on-invalid**: when an override matches but the value is
  unavailable (zone blocked, value not in options[], etc.), the override
  is consumed and the adapter falls back to its default. The skip is
  logged inline as `[override-skipped]` in `replayLog`.
- **Soft warning at end of replay**: unconsumed overrides are appended
  to `replayLog` as `[override-skipped] never matched (after="...")` and
  a stderr warning is printed. Not a fail.

### Zone string mapping

| zone   | OCG location | sequence |
|--------|--------------|----------|
| M1-M5  | MZONE        | 0-4      |
| EMZ_L  | MZONE        | 5        |
| EMZ_R  | MZONE        | 6        |
| S1-S5  | SZONE        | 0-4      |
| FZ     | FZONE        | 0        |

Cross-checked against `decodeFieldMask` in `ocg-field-query.ts:306-346`.

## Validation

- **Bit-exact backward compat**: 3/3 β-1 v2 baselines (branded-dracotail,
  ddd-pendulum, snake-eye-yummy) produce byte-identical output when run
  on plans WITHOUT `mechanicalOverrides[]`. `diff` output empty on all 3.
- **Functional Test 1 (SELECT_PLACE)**: snake-eye-yummy + override
  pinning Almiraj at EMZ_R fires `[override-applied] SELECT_PLACE →
  EMZ_R` at step 14 (Almiraj summon-procedure). Bypassed
  `tryInteractiveMechanical` correctly. Plan stored at
  `data/test-plans/mechanical-overrides/test-1-select-place.json`.
- **Functional Test 2 (SELECT_POSITION)**: ddd-pendulum + override
  pinning FACEUP_DEFENSE on D/D Scale Surveyor activate fires
  `[override-applied] SELECT_POSITION → FACEUP_DEFENSE` at step 10. Plan
  at `data/test-plans/mechanical-overrides/test-2-select-position.json`.
- **TypeScript compilation**: `tsc --noEmit` clean.
- **Smoke tests preserved**: `dfs-solver-smoke-test` (43/43),
  `prompt-resolver-smoke-test` (36/36).

## Files touched

- `duel-server/src/solver/ocgcore-adapter.ts` (~30 lines)
  - Adds `mechanicalOverrideHook` private field + `setMechanicalOverrideHook` setter
  - Inserts hook check in `runUntilPlayerPrompt` before resolver/legacy paths
- `duel-server/scripts/replay-trajectory-cli.ts` (~250 lines)
  - Adds `MechanicalOverride` discriminated union types
  - Adds `validateMechanicalOverrides` runtime validator (filter-with-warnings)
  - Adds `ZONE_STRING_TO_PLACE` and `POSITION_STRING_TO_VALUE` constants
  - Adds `findMatchingOverrideIdx`, `consumeOverrideForAdapterPrompt`,
    `tryConsumeMechanicalOverrideOption` helpers
  - Tracks `lastIdlecmdDesc` on every IDLECMD pick
  - Drains `overrideLog` into `replayLog` per-step + at end-of-replay
  - Surfaces unconsumed overrides as soft warnings
- `duel-server/data/test-plans/mechanical-overrides/` (new dir, 2 test plans)

## Empirical targets

The β-1 v2 `mechanicalOverrides[]` grammar is expected to unblock:

- **ddd-pendulum-opener** 2/5 → 5/5 — pinning ANNOUNCE_NUMBER to enable
  the Lance Soldier level-up combo (per memory.md
  `path-beta-blocker-analysis-2026-05-02`).
- **snake-eye-yummy-opener** 4/7 → 7/7 — pinning SELECT_PLACE to S5 for
  I:P Masquerena placement (per same memo).

To validate, re-dispatch the β-1 v2 subagent on those fixtures with the
new prompt template (updated to mention mechanicalOverrides).

## Caveats / limitations

1. **Late-firing prompts**: when ANNOUNCE_NUMBER or SELECT_POSITION fires
   AFTER the next IDLECMD pick (e.g. during end-phase chain resolution),
   the override won't match against the IDLECMD that "caused" it. Target
   the most-recent IDLECMD instead — typically `"end-phase"` for late
   effects. Authors should run with `SOLVER_DEBUG_OVERRIDES=1` to see
   what `lastIdlecmdDesc` is at each prompt site.

2. **SELECT_TRIBUTE single-index only**: the override pins one tribute
   index; remaining slots are filled in OCG order skipping the pinned.
   For finer-grained multi-pick control, use
   `exposeMultiPickMechanical=true` + `targets[]` (which surfaces the
   prompt as legal actions). The single-index override covers the common
   case (pin which monster gets tributed when default first-N picks
   wrong).

3. **Hook is single-instance per adapter**: only one hook can be
   installed at a time. Calling `setMechanicalOverrideHook` again
   replaces the previous hook. Production DFS NEVER installs a hook.

4. **`mechanicalOverrides[]` is β-1 only**: raw-trajectory mode (β-3)
   ignores the field. β-3 fully specifies every step including
   sub-prompts via raw `responseIndex` + `cardId`, so overrides are
   redundant.

5. **Debug toggle**: `SOLVER_DEBUG_OVERRIDES=1` env var prints
   `[overrides-debug] findMatch promptType=... ctx=... queue=N` to stderr
   on every hook call. Useful for diagnosing why an override didn't
   match (typically `lastIdlecmdDesc` mismatch).

## Next step

Re-dispatch β-1 v2 subagents on `ddd-pendulum-opener` and
`snake-eye-yummy-opener` with the updated prompt template that mentions
`mechanicalOverrides[]`. Expected lifts: ddd 2/5 → 5/5, snake-eye 4/7 →
7/7. The full canonical-eval re-run will confirm cumulative-matched
delta vs the current 31/69 status quo.
