# Path β subagent prompt template v2 (canonical)

**Purpose**: parameterized prompt for dispatching a Claude Code subagent on a Path β-1 v2 plan composition task. Replaces the v1 ad-hoc prompt drafted in `path-beta-methodology.md`.

**Design principles**:
- **No PvP-replay leak**. The subagent must compose its plan from the deck/hand alone — never from a known reference trajectory. Showing the canonical line would test reproduction, not discovery.
- **Canonical rules reference**. The subagent reads `_bmad-output/planning-artifacts/yugioh-game-rules.md` as the authoritative source for all YGO rulings. No WebFetch.
- **Mandatory deck audit**. Before any combo hypothesis, the subagent enumerates every deck card with its potential role.
- **Structured CoT capture**. Reasoning decisions logged to a JSONL file for post-hoc analysis.
- **Self-criticism gate**. Before claiming a ceiling, the subagent must list eliminated alternatives with their justifications.

## Template (parameterized; replace `<...>` placeholders)

```
You are a Yu-Gi-Oh combo solver running Path β-1 v2 on `<FIXTURE_ID>`.

Working directory: `c:\Users\Axel\Desktop\code\skytrix\duel-server` — `cd` there before every Bash command. Use absolute paths for `Read` tool.

## Mission

Compose a β-1 plan that maximises `matched` against the fixture's `expectedBoard`. Your stretch target is `<TARGET_MATCHED>/<EXPECTED_SIZE>` (full expectedBoard). Prior runs plateaued at `<PRIOR_MATCHED>/<EXPECTED_SIZE>` if applicable; otherwise no prior baseline.

## Required reading (in order, before any other action)

1. **Yu-Gi-Oh canonical rules**: `Read` the file `c:\Users\Axel\Desktop\code\skytrix\_bmad-output\planning-artifacts\yugioh-game-rules.md`. This is your authoritative reference for all YGO rulings (PSCT, OPT variants, chain mechanics, summon procedures, state transitions, set timing, lingering effects, Xyz overlay state, etc.). When applying a rule, cite the relevant section (e.g., "§3.1 OPT variant 5"). If a rule appears missing or ambiguous, report the gap as feedback rather than guessing.

2. **Replay-trajectory-cli operational guide**: same file, Annexe B. Covers the verification tool, output schema, divergence diagnosis, plan grammar reference, auto-defaults at sub-prompts, and override mechanisms.

3. **Fixture spec**: `Read` `data/path-beta-poc/<FIXTURE_ID>/fixture.json`. Confirm hand (5 cards), main deck, extra deck, and expectedBoard.

## Forbidden actions

- **No `WebFetch` or `WebSearch` for YGO rulings.** The canonical rules document is the single source of truth. If a ruling is missing or ambiguous, report it.
- **No reading of any `.raw-replay.json` file** in `_bmad-output/planning-artifacts/research/trajectories/`. These contain reference solutions and would invalidate the discovery measurement.
- **No reading of any prior Path β `summary.md`, `critic-*.md`, or `*-best-plan.json`** for the current fixture. You compose your plan from scratch.

## Common pitfalls (pre-armed from prior v2 dispatches)

These are recurring failure modes observed across prior runs. Avoiding them upfront saves attempts:

1. **Trigger Effect redundancy trap** (Annexe B.6): cards with on-Summon, on-NS, on-SS, or on-GY-send Trigger Effects auto-resolve via SEGOC (§4.7) in the post-event window. Do **NOT** add an IDLECMD `(activate)` plan-step for these — the engine has already resolved them, and the plan-step will diverge. Use `targets[]` on the summon plan-step to provide the trigger's search/SS target, or `chainTargets[]` if it surfaces on a chain.

2. **SELECT_YESNO default NO silent failure** (Annexe B.7): optional revive/SS prompts of the form *"You can target ... Special Summon it"* on Continuous Spells/Traps consistently surface as **SELECT_YESNO with default NO**. Without an explicit `targets: [{responseIndex: 1}]` override, the optional clause silently doesn't fire and the plan completes with `matched < expected`. Always check the replayLog for `[auto]` resolutions on SELECT_YESNO when a plan completes below target.

3. **Substring matching pitfall** (Annexe B.6): `cardName` matching is bidirectional substring. `"Welcome"` will match `"Big Welcome Labrynth"` AND `"Welcome Labrynth"` — the first wins, possibly the wrong one. Use unique discriminators (e.g., `"Big Welcome"` to specifically match Big Welcome Labrynth).

4. **Retroactive lock check** (§2.4 / §A.3): `this turn` and `the turn you activate this card` locks apply to the entire current turn including before activation. If the restricted action has already been performed earlier in the turn, the card cannot be activated at all. Common offenders: Branded Fusion (no non-Fusion ED summon), Fusion Spell with similar lock, etc.

5. **Pendulum redirect bypasses GY-triggers** (§6.2): Pendulum Monsters used as Fusion Material redirect to face-up ED, NOT to GY. Triggers requiring `sent to the GY` or `sent to the GY as material for a Fusion Summon` do NOT fire for Pendulum materials.

6. **Xyz overlay state instance reset** (§6.12): attaching a card as overlay material resets all lingering effects keyed to that instance. Detaching is "from attached state to GY", NOT "from the field to GY" — triggers requiring "from the field" do not fire.

7. **Auto-respond sub-prompts that `targets[]` cannot reach** (§B.7.6): SELECT_PLACE (trivial single-slot), SELECT_POSITION, ANNOUNCE_NUMBER, and SELECT_TRIBUTE (empty `selects[]`) are auto-resolved by the adapter and never surface in the plan's `targets[]` queue. When the default value is wrong for your line (e.g. Lance Soldier's level-up wants value=2 not max, I:P Masquerena placement needs S5 not auto-default, ED Link 1 needs EMZ_R not EMZ_L), use the top-level `mechanicalOverrides[]` field to pin the right value. Common cases: ANNOUNCE_NUMBER for level-up/cost-pay effects, SELECT_PLACE for arrow-sensitive Link placements (EMZ_L vs EMZ_R, M-zone column choice), SELECT_POSITION for passive-defense walls. Set `SOLVER_DEBUG_OVERRIDES=1` to inspect what `lastIdlecmdDesc` looks like at each prompt site if the override doesn't match.

## Mandatory pre-reasoning step — full deck audit

Before forming any combo hypothesis, produce a complete enumeration of summon enablers, tutors, and combo pieces in the deck and hand. Write the result to `data/path-beta-poc/<FIXTURE_ID>/v2-deck-audit.md` with this exact structure:

```markdown
# Deck audit — <FIXTURE_ID>

## Hand (5 cards)
- <cardId> <cardName> [type, level/rank/link, role: e.g. starter / extender / fusion-enabler / handtrap]

## Main deck — Fusion Summon enablers
- <cardId> <cardName> [activation cost, source zones for materials, target restrictions, OPT class]

## Main deck — Synchro Summon enablers
- ...

## Main deck — Xyz Summon enablers
- ...

## Main deck — Link Summon enablers
- ...

## Main deck — Special Summon enablers (non-tutor)
- ...

## Main deck — Tutors and search effects
- ...

## Extra deck — fusion targets
- <cardId> <cardName> [fusion materials text, on-summon trigger, OPT class]

## Extra deck — synchro / xyz / link targets
- ...
```

Use `npx tsx scripts/get-card-info.ts <cardId> --json` to fetch oracle text for every card. Do NOT skip cards because they look unrelated — the audit must be exhaustive. After producing the audit, perform a self-check:
- Is there ONE Lvl-8+ fusion enabler in the deck/hand? Two? Three? List them.
- Is there ONE tutor that could fetch a critical missing piece? Two?
- Are there cards in the deck that do NOT appear in any combo line you've considered? Why not?

Missing a non-obvious enabler is a frequent cause of false ceiling claims. The audit is your defense against this failure mode.

## Tools

1. `npx tsx scripts/get-card-info.ts <cardId> --json` — oracle text + catalog + Lua script paths.
2. `Read` (absolute paths) for files referenced by the tools.
3. `npx tsx scripts/replay-trajectory-cli.ts --fixture-id=<FIXTURE_ID> --plan-file=<plan> --out=<result>` — verifies the plan against the OCG engine. Reports `matched/score/stoppedReason/divergence/replayLog`.
4. Local card DB: `data/cards.cdb` SQLite (queryable via `better-sqlite3` if needed).

## Plan grammar (β-1 v2)

See Annexe B.6 of the canonical rules document for the full grammar reference. Quick reminder:

```jsonc
{
  "plan": [
    {
      "cardName": "<substring, case-insensitive>",
      "verb": "activate | normal-summon | set-st | summon-procedure | set-monster | tribute-summon | end-phase",
      "targets": [
        { "promptHint": "<human description>", "cardName": "<sub-prompt target>" },
        { "promptHint": "...", "cardNames": ["<option-A>", "<option-B>"] },
        { "promptHint": "...", "responseIndex": <number> }
      ],
      "chainTargets": [
        { "promptHint": "<human description>", "cardName": "<chain link target>" }
      ]
    }
  ],
  "endTurn": true,
  "mechanicalOverrides": [
    { "after": "<lastIdlecmdDesc substring>", "promptType": "ANNOUNCE_NUMBER", "value": <int> },
    { "after": "<...>", "promptType": "SELECT_PLACE", "zone": "M1|...|EMZ_L|EMZ_R|S1|...|FZ" },
    { "after": "<...>", "promptType": "SELECT_POSITION", "position": "FACEUP_ATTACK|FACEUP_DEFENSE|FACEDOWN_DEFENSE" },
    { "after": "<...>", "promptType": "SELECT_OPTION", "responseIndex": <int> },
    { "after": "<...>", "promptType": "SELECT_TRIBUTE", "responseIndex": <int> }
  ]
}
```

For SELECT_EFFECTYN / SELECT_YESNO override, use `targets[]` with explicit `responseIndex` (0 for NO, 1 for YES).

For **SELECT_PLACE / SELECT_POSITION / ANNOUNCE_NUMBER / SELECT_OPTION / SELECT_TRIBUTE** that are NOT surfaced via `targets[]` (auto-respond by the adapter), use the top-level `mechanicalOverrides[]` field. Each override:

- Matches the `after` substring against the most recent IDLECMD pick description (`"<cardName> <verb>"`, case-insensitive).
- Fires only between that IDLECMD and the next.
- Is consumed once. Unconsumed overrides surface as `[override-skipped] never matched` in `replayLog`.
- Falls back to default when invalid (zone blocked, value not in options[], etc.) — logged as `[override-skipped]`.

See `yugioh-game-rules.md` §B.7.6 for full schema + zone string mapping + caveats. Set `SOLVER_DEBUG_OVERRIDES=1` to dump per-prompt match attempts during debugging.

## Mandatory CoT capture

While working, maintain a structured reasoning log at `data/path-beta-poc/<FIXTURE_ID>/v2-cot-log.jsonl`. Append one JSON line per significant methodological decision — NOT per-tool-call, but per reasoning step. Schema:

```jsonc
// hypothesis: starting line for an attempt
{"event":"hypothesis","attempt":1,"line":"<short description>","rationale":"<why this line>","alternatives_considered":[{"name":"<other line>","reason_eliminated":"<why dropped>","verified":<true|false>}]}

// constraint_found: a YGO rule that limits options
{"event":"constraint_found","constraint":"<rule statement>","blocks":["<line A>","<line B>"],"rule_ref":"§<X.Y>","verified":<true|false>}

// stall: replay-trajectory-cli reports divergence/incomplete
{"event":"stall","attempt":<N>,"matched":<N>,"diverged_at_step":<N>,"engine_response":"<from divergence object>","my_hypothesis":"<what I think went wrong>"}

// eliminate: ruling out a card or path
{"event":"eliminate","card":"<cardName>","reason":"<reason>","rule_ref":"§<X.Y>|none","verified":<true|false>}

// rule_uncertainty: I'm applying a rule from memory and want to flag for review
{"event":"rule_uncertainty","claim":"<my claim>","context":"<what I'm trying to do>","need_verification":true}

// verdict: final summary
{"event":"verdict","matched":<N>,"score":<N>,"claim":"<ceiling | optimal | partial>","supporting_attempts":[1,2,...],"unverified_assumptions":["<list>"]}
```

The `verified` field is critical and **mandatory** on every event that contains a claim, hypothesis, constraint, or elimination. **`verified: false` means**: I am applying a rule from my memory or training data, not from the canonical doc. Mark `verified: true` ONLY IF the ruling is explicitly stated in `yugioh-game-rules.md` (cite the section), OR confirmed empirically by `replay-trajectory-cli` returning `stoppedReason=divergence` at the step that proves the rule.

**Discipline requirement**: every `hypothesis`, `constraint_found`, and `eliminate` event MUST include the `verified` field. Omitting it is a methodology gap and will be flagged in the post-hoc analyzer report. `stall` events should include `verified` on the subagent's diagnosis (true if confirmed by the next attempt's outcome, false if speculative).

The CoT log is the post-hoc audit trail. Be thorough — uncertainty markers ("I think", "probably", "according to YGO rules I remember") should always have `verified: false`. Do not omit `verified` to avoid the question — that signals lack of methodological discipline.

## Self-criticism gate (before declaring a ceiling)

Before writing the final summary saying "matched=N/M is the ceiling, M-N cards are unreachable":

1. **Two distinct alternative decompositions** you've eliminated. For each:
   - The exact reason eliminated.
   - Whether the reason was empirically verified (`replay-trajectory-cli` showed divergence) or assumed from rules.
2. **For each card in `missingCardIds`**:
   - Which enabler chain WOULD produce it (full path).
   - Which step of that chain fails.
   - Whether the failure was empirically observed or assumed.
3. **If any "rule-based elimination" is unverified**, the ceiling claim is suspect. Test the assumption empirically by writing a minimal plan that violates the assumed rule and observing what `replay-trajectory-cli` actually reports. If the rule holds empirically, document it in the CoT log with `verified: true`.

Write the self-criticism analysis to `data/path-beta-poc/<FIXTURE_ID>/v2-self-criticism.md` before producing the final summary.

## Workflow

1. Read the canonical rules doc (mandatory).
2. Read the fixture spec.
3. Produce the **deck audit** (`v2-deck-audit.md`).
4. Begin attempts. Each attempt:
   - Append a `{"event":"hypothesis", ...}` line to `v2-cot-log.jsonl`.
   - Write the plan to `data/path-beta-poc/<FIXTURE_ID>/v2-attempt-<N>.json`.
   - Run `replay-trajectory-cli` on it; output to `v2-attempt-<N>-result.json`.
   - If divergence: append `{"event":"stall", ...}` with the divergence step. Read the result file's `replayLog` and `divergence` fields to understand what the engine did. Apply the diagnostic checklist from Annexe B.4.
   - If `matched < target`: hypothesize a fix and try a new attempt.
5. After ≤15 attempts OR when you reach the target:
   - Run the **self-criticism gate** (above).
   - Write a final report to `data/path-beta-poc/<FIXTURE_ID>/v2-summary.md`.
6. Final report (≤300 words):
   - Final matched, key mechanical discovery (which combo decomposition worked), plan-file path, attempts used.
   - **Critically**: list every `rule_uncertainty` and `eliminate` with `verified: false` from the CoT log. These are candidates for methodology improvement.

## Stop conditions

- Target matched reached → ship the plan and write the summary.
- 15 attempts OR token budget exhausted with `matched` plateaued → write summary documenting the plateau, with the explicit list of unverified assumptions from the CoT log.
- Hit Claude Code rate limit → save progress and write a partial summary before stopping.

## Reporting format (the result message you return to me)

≤300 words, structured:

- **Final matched / target**: <N>/<M>, score <S>
- **Combo decomposition** (highest matched line): <one-paragraph description with key cards used as fusion enablers, tutors, and combo bridges>
- **Plan file**: `<path to v2-attempt-N.json>`
- **Attempts used**: <N> of 15
- **Unverified assumptions** (from CoT log): list each with rule-ref or "no rule cited"
- **Feedback on tooling/rules**: any gap in the canonical doc, any ambiguity that forced guessing, any sub-prompt override missing (e.g., ANNOUNCE_NUMBER).
```

## How to dispatch (orchestrator instructions, not part of the subagent prompt)

```
Agent({
  description: "Path β-1 v2 <FIXTURE_ID> — 8/8 stretch / methodology test",
  subagent_type: "general-purpose",
  prompt: "<above template, with placeholders filled>",
  run_in_background: true
})
```

After the subagent completes:

1. Read its `v2-summary.md` and `v2-cot-log.jsonl`.
2. Run `trajectory-diff.ts` between its best plan and the PvP raw-replay (if one exists for this fixture) to identify divergences.
3. The CoT log + divergence map = methodology gap signal. Update this template based on patterns observed.
