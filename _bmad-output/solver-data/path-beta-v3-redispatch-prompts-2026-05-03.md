# Path β v3 — Re-dispatch prompts with mechanicalOverrides

**Date:** 2026-05-03
**Purpose:** prepared subagent prompts for re-dispatching Path β v2 with `mechanicalOverrides[]` on the 2 fixtures plateau-bound by sub-prompt auto-respond defaults.
**Predecessors:**
- `path-beta-prompt-template-v2.md` (base methodology v2)
- `mechanical-overrides-implementation-2026-05-03.md` (the new feature)

## Context for the orchestrator

The 2 target fixtures plateaued in v2 due to **B3** (adapter mishandle of mechanical sub-prompts):
- **ddd-pendulum-opener**: 3/5 ceiling — `ANNOUNCE_NUMBER` auto-respond `opts.length-1` mishandles a sub-prompt downstream of Lance Soldier level-up. PvP raw-replay confirms 5/5 reachable.
- **snake-eye-yummy-opener**: 4/7 ceiling — `SELECT_PLACE` auto-respond lowest-sequence empty zone misplaces I:P Masquerena (or other Link summons) blocking downstream. PvP raw-replay confirms 7/7 reachable.

The new `mechanicalOverrides[]` grammar gives subagents the ability to pin specific values at sub-prompts. With this tool, both fixtures should break their plateau **without** the methodology violating the no-replay-leak rule (subagents diagnose divergence, pin override, retry — they don't read the canonical trajectory).

## Important: methodological discipline

The subagent uses `mechanicalOverrides[]` **only after empirical evidence of a sub-prompt mishandle**. The diagnostic loop is:
1. Plan diverges or stalls in `replay-trajectory-cli`
2. Subagent reads `replayLog` to identify a `[auto]` resolution at a sub-prompt that looks suspicious
3. Subagent hypothesizes an alternative value and tests via `mechanicalOverrides[]`
4. If fixed, document the override; if not, try another value or another decomposition

The subagent does **NOT** read the PvP raw-replay or canonical trajectory to find the "right" override value. It searches the override space empirically.

---

## Prompt 1 — ddd-pendulum-opener

```
You are a Yu-Gi-Oh combo solver running Path β-1 v3 on `ddd-pendulum-opener`.

Working directory: `c:\Users\Axel\Desktop\code\skytrix\duel-server` — `cd` there before every Bash command. Use absolute paths for `Read` tool.

## Mission

Compose a β-1 plan that maximises `matched` against the fixture's `expectedBoard`. Target: **5/5** (full clear). Prior v2 plateau: 3/5.

The plateau was diagnosed as B3 (adapter mishandle of a mechanical sub-prompt downstream of Lance Soldier level-up). v3 introduces `mechanicalOverrides[]` to address this — see Annexe B.7.12 of the canonical rules doc.

## Required reading (in order, before any other action)

1. **Yu-Gi-Oh canonical rules**: `Read` `c:\Users\Axel\Desktop\code\skytrix\_bmad-output\planning-artifacts\yugioh-game-rules.md`. Single source of truth for all rulings. Cite section refs (e.g., "§3.1 OPT variant 5") when applying rules.

2. **Replay-trajectory-cli operational guide**: same file, Annexe B. Pay specific attention to **B.7.12 mechanicalOverrides** (new in v3).

3. **Fixture spec**: `Read` `data/path-beta-poc/ddd-pendulum-opener/fixture.json`.

## Forbidden actions

- **No `WebFetch` or `WebSearch` for YGO rulings.**
- **No reading of any `.raw-replay.json` file** in `_bmad-output/planning-artifacts/research/trajectories/`.
- **No reading of any prior Path β `summary.md`, `critic-*.md`, or `*-best-plan.json`** for this fixture. Compose from scratch.
- **No reading of v2 attempts** in `data/path-beta-poc/ddd-pendulum-opener/v2-*`.

## Common pitfalls (pre-armed)

1. **Trigger Effect redundancy trap** (B.6): on-Summon/on-NS/on-SS/on-GY-send Trigger Effects auto-resolve via SEGOC. Do NOT add an IDLECMD `(activate)` for these — use `targets[]` on the summon plan-step.

2. **SELECT_YESNO default NO silent failure** (B.7): optional revive/SS prompts default to NO. Override with `targets: [{responseIndex: 1}]`.

3. **Substring matching pitfall** (B.6): `cardName` is bidirectional substring. Use unique discriminators.

4. **Retroactive lock check** (§2.4 / §A.3): `this turn` locks apply to the entire current turn including before activation.

5. **Pendulum redirect bypasses GY-triggers** (§6.2): Pendulum Monsters used as Fusion Material redirect to face-up ED, not GY.

6. **Xyz overlay state instance reset** (§6.12): attaching a card as overlay material resets all lingering effects keyed to that instance.

7. **NEW v3 — mechanicalOverrides for sub-prompt mishandle** (B.7.12): if your plan reaches a stall and `replayLog` shows `[auto]` resolutions at ANNOUNCE_NUMBER / SELECT_PLACE / SELECT_POSITION / SELECT_OPTION / SELECT_TRIBUTE that look suspicious, hypothesize an alternative value and test via `mechanicalOverrides[]`. Specifically for ddd: Lance Soldier level-up triggers ANNOUNCE_NUMBER — the auto-default may pick the wrong amount. Sub-prompts downstream of Lance level-up (SELECT_CARD for Solomon Xyz, SELECT_PLACE for the Xyz placement, etc.) may also need overrides if the plan stalls between Lance and Solomon.

## Mandatory pre-reasoning step — full deck audit

Produce `data/path-beta-poc/ddd-pendulum-opener/v3-deck-audit.md` with the standard audit structure (see template v2 §"Mandatory pre-reasoning step"). Use `npx tsx scripts/get-card-info.ts <cardId> --json` for oracle text on every card. Don't skip cards.

## Tools

1. `npx tsx scripts/get-card-info.ts <cardId> --json` — oracle text + catalog + Lua paths.
2. `Read` (absolute paths) for files referenced.
3. `npx tsx scripts/replay-trajectory-cli.ts --fixture-id=ddd-pendulum-opener --plan-file=<plan> --out=<result>`.
4. Local card DB: `data/cards.cdb` SQLite.

## Plan grammar (β-1 v3)

Same as v2 plus `mechanicalOverrides[]` (see Annexe B.7.12).

```jsonc
{
  "plan": [
    {
      "cardName": "<substring>",
      "verb": "activate | normal-summon | set-st | summon-procedure | set-monster | tribute-summon | end-phase",
      "targets": [...],
      "chainTargets": [...]
    }
  ],
  "mechanicalOverrides": [
    {
      "after": "<cardName> <verb>",
      "promptType": "ANNOUNCE_NUMBER",
      "value": <number>
    },
    {
      "after": "<cardName> <verb>",
      "promptType": "SELECT_PLACE",
      "zone": "M1|M2|M3|M4|M5|EMZ_L|EMZ_R|S1|S2|S3|S4|S5|FZ"
    }
    // see B.7.12 for full schema
  ],
  "endTurn": true
}
```

## Mandatory CoT capture

Maintain `data/path-beta-poc/ddd-pendulum-opener/v3-cot-log.jsonl` with structured events. Schema same as v2 + new event:

```jsonc
// override_attempted: testing a mechanicalOverride
{"event":"override_attempted","attempt":<N>,"after":"<step>","promptType":"<type>","value":<value>,"hypothesis":"<why>","verified":<true|false>}

// override_resolved: result of testing
{"event":"override_resolved","attempt":<N>,"after":"<step>","promptType":"<type>","outcome":"matched-improved|matched-unchanged|new-divergence","matched_before":<N>,"matched_after":<N>}
```

The `verified` field is mandatory on every claim/hypothesis/elimination.

## Self-criticism gate

Before declaring a ceiling, write `v3-self-criticism.md` covering:
1. Two distinct alternative decompositions eliminated, with reason + verified flag.
2. For each missing card: enabler chain, failing step, empirical or assumed.
3. **For each unverified `eliminate`**: test the assumption empirically (write a minimal violating plan, observe what cli reports).
4. **NEW v3**: list every `[auto]` sub-prompt resolution in the final plan's replayLog. For each, briefly justify why the default value is correct OR test an override.

## Workflow

1. Read canonical rules + fixture spec.
2. Produce `v3-deck-audit.md`.
3. Begin attempts:
   - Append `{"event":"hypothesis", ...}` to `v3-cot-log.jsonl`.
   - Write plan to `data/path-beta-poc/ddd-pendulum-opener/v3-attempt-<N>.json`.
   - Run replay-trajectory-cli; output `v3-attempt-<N>-result.json`.
   - If divergence/stall: read `replayLog` for `[auto]` events. Hypothesize override. Append `override_attempted`. Test in next attempt.
4. After ≤15 attempts OR target reached: self-criticism gate + final summary.

## Stop conditions

- 5/5 reached → ship and write summary.
- 15 attempts OR token budget exhausted with plateau → write summary documenting plateau with explicit list of unverified assumptions and overrides tested.

## Reporting format (≤300 words)

- **Final matched / target**: <N>/5, score <S>
- **Combo decomposition** (highest matched line): <one-paragraph>
- **Plan file**: `<path>`
- **Attempts used**: <N> of 15
- **Overrides applied** (if any): list each (after, promptType, value, outcome)
- **Unverified assumptions** (from CoT log): list each
- **Feedback on tooling/rules**: any gap

Begin.
```

---

## Prompt 2 — snake-eye-yummy-opener

Same template as Prompt 1 with these adjustments:

- Replace `ddd-pendulum-opener` → `snake-eye-yummy-opener` everywhere
- Target: **7/7** (prior v2: 4/7)
- Adjust the v3 pitfall #7 specifically:

  ```
  7. **NEW v3 — mechanicalOverrides for sub-prompt mishandle** (B.7.12): if your plan reaches a stall, check `replayLog` for `[auto]` resolutions at SELECT_PLACE / SELECT_POSITION / SELECT_OPTION / SELECT_TRIBUTE / ANNOUNCE_NUMBER that look suspicious. Specifically for snake-eye: Link Summon procedures (I:P Masquerena, S:P Little Knight, Linkuriboh) emit SELECT_PLACE. The auto-default picks the lowest-sequence empty zone, which may misplace a Link monster and block downstream Link arrows / Extra Monster Zone occupation. Test alternative zones via `mechanicalOverrides[]` if Link summons appear successful in replayLog but downstream effects fail.
  ```

- Output paths: `data/path-beta-poc/snake-eye-yummy-opener/v3-*`

## Dispatch instructions for the orchestrator

When `mechanical-overrides` branch is merged to master:

1. Verify the branch: `git log --oneline | head -5` should show the mechanical-overrides commit
2. Verify the doc: `Read _bmad-output/planning-artifacts/yugioh-game-rules.md` should contain B.7.12
3. Dispatch both prompts in parallel (they are independent fixtures):

```
// Both as background general-purpose agents
Agent({description: "Path β v3 ddd-pendulum 5/5 stretch", prompt: "<Prompt 1 above>", run_in_background: true})
Agent({description: "Path β v3 snake-eye 7/7 stretch", prompt: "<Prompt 2 above>", run_in_background: true})
```

4. Wait for completion notifications (~30-60min each)

## Post-dispatch review checklist

For each subagent:

1. Read `v3-summary.md` — final matched, attempts used
2. Read `v3-cot-log.jsonl`:
   - Count `override_attempted` events
   - Count `override_resolved` with `outcome: matched-improved`
   - Count `verified: false` on hypothesis/eliminate events (= unverified assumptions)
3. Read final plan's `replayLog`: count remaining `[auto]` events vs `[override-applied]` events
4. If 5/5 (ddd) or 7/7 (snake-eye) reached: empirical validation of `mechanicalOverrides[]` mechanism
5. If plateau persists despite override attempts: document which overrides were tested and why they didn't lift — this is signal for either (a) wrong override target, (b) deeper combinatorial blind spot, or (c) bug in mechanicalOverrides implementation

## Empirical targets

| Fixture | v2 plateau | v3 target | Mechanism expected to lift |
|---|---|---|---|
| ddd-pendulum-opener | 3/5 | 5/5 | ANNOUNCE_NUMBER override on Lance level-up sub-tree |
| snake-eye-yummy-opener | 4/7 | 7/7 | SELECT_PLACE override on Link Summon zones |
| **Cumulative** | **7/12** | **12/12** | **+5 cum matched** |

If both lift to target → +5 cum matched on these 2 fixtures alone, validates mechanicalOverrides[] empirically, justifies extending to other fixtures with similar B3 patterns (potentially branded-mirrorjade, tearlaments, dinomorphia subset).

If neither lifts → re-evaluate the B3 hypothesis: maybe the sub-prompt isn't where the mishandle is, or the LLM blind-spot is the real wall.

If one lifts and the other doesn't → fixture-specific diagnostic needed.
