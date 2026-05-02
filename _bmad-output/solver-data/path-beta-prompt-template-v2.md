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
  "endTurn": true
}
```

For SELECT_EFFECTYN / SELECT_YESNO override, use `targets[]` with explicit `responseIndex` (0 for NO, 1 for YES). For SELECT_PLACE / SELECT_POSITION override, use `responseIndex` matching the legal-action index in the trace. ANNOUNCE_NUMBER is NOT overridable in β-1 currently — if your plan needs a non-default value, report it as feedback.

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

The `verified` field is critical. **`verified: false` means**: I am applying a rule from my memory or training data, not from the canonical doc. Mark `verified: true` ONLY IF the ruling is explicitly stated in `yugioh-game-rules.md` (cite the section), OR confirmed empirically by `replay-trajectory-cli` returning `stoppedReason=divergence` at the step that proves the rule.

The CoT log is the post-hoc audit trail. Be thorough — uncertainty markers ("I think", "probably", "according to YGO rules I remember") should always have `verified: false`.

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
