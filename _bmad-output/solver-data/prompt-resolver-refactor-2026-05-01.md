# Prompt Resolver Refactor — Design Doc

**Status:** DRAFT 2026-05-01
**Owner:** Axel + Claude (collab)
**Supersedes:** `sprint-3-decision-oracle-design-2026-04-29.md` (5-day "Sprint 3" framing was unrealistic — see adversarial review 2026-05-01)
**Goal:** Unify the two parallel decision pipelines (DFS via `runUntilPlayerPrompt`, plan-replay via `replay-trajectory-cli.ts`) behind a single `PromptResolver` + `OracleChain` abstraction. Materialise every implicit decision point as a manipulable object so that any source (mechanical default, expertise hint, agentic chain, future ML policy) can produce its value through a uniform interface.
**Estimated effort:** 4-5 weeks across 7 phases (Phase 0 inventory is mandatory before any code).

---

## Why now

Three bug classes have been found and patched in two sprints (ANNOUNCE_NUMBER missing/index, SELECT_YESNO override missing, P5 Xyz overlay parser). Each fix was a one-off. The structural root cause is that decisions are spread across **two unsynchronised entry points** with subtly different invariants:

- `runUntilPlayerPrompt` (ocgcore-adapter.ts:818-878) — DFS exploration + adversarial branching + opponent goldfishing + auto-resolve mechanical
- `replay-trajectory-cli.ts` boucle (lines 487-650) — β-1 plan consumption + β-3 raw trajectory matching + endphase ceiling + aggressive cascade

Five-plus prompt types remain hardcoded inside `autoRespondMechanical` (SELECT_TRIBUTE, SELECT_POSITION, SELECT_UNSELECT_CARD, ANNOUNCE_RACE/CARD/ATTRIB, SORT_CARD, SORT_CHAIN). Continuing one-off patches scales linearly with audited fixtures, never lifts DFS-solver standalone, and risks new divergences each time an entry point evolves independently.

This refactor consolidates **the actual flow of control**, not just the surface API. After it ships, every decision the solver makes is routed through the same chain, with composition varying per caller.

## Non-goals

- **No DFS budget / scoring changes.** Pure plumbing refactor + capability extension.
- **No Tier 3 ML.** The `decisionHints` schema is *designed* to accept ML-produced values, but no model is trained as part of this work.
- **No opponent intelligence.** `autoRespondOpponent` keeps its goldfish behavior. Future sprint.
- **No new mechanical defaults guessed without validation.** ANNOUNCE_RACE/CARD/ATTRIB/SORT_*/RPS keep their `solverAssert(false)` throw unless a fixture exercises them and validates the chosen default. See Phase 2 §"Coverage discipline".

---

## Architecture

### Single flow of control

```
prompt arrives
    ↓
runUntilPlayerPrompt  OR  replay-trajectory-cli loop
    ↓
PromptResolver.resolve(handle, ctx)
    ↓
OracleChain.decide(ctx) — composition varies per caller
    ↓
ResolveResult { kind: 'response' | 'branches' | 'divergence' }
    ↓
caller dispatches: apply response | return branches to DFS | propagate divergence
```

The composition of the chain — which oracles are present, in which order — is the **only** thing that distinguishes DFS mode from plan-replay mode. Same chain class, same flow, different parameter list.

### Chain compositions

| Caller | Composition |
|---|---|
| DFS (player turn, exploratory or mechanical) | `[OpponentBranching, CardExpertise, Branching, MechanicalDefault]` |
| DFS (opponent prompt, adversarial chain) | `[OpponentBranching, MechanicalDefault]` |
| Plan-replay β-1 | `[CardExpertise, PlanStep, PlanTarget, EndPhasePolicy, MechanicalDefault]` |
| Plan-replay β-3 | `[CardExpertise, RawTrajectory, EndPhasePolicy, MechanicalDefault]` |
| Enumerate-skip / enumerate-pivot | same as β-1 with `CardExpertise` disabled by default (see §"Enumeration tools") |

**`MechanicalDefaultOracle` is always last and always answers** — never pass. This is enforced by the chain's terminal contract: `OracleChain.decide` throws if the terminal oracle passes, but the terminal oracle is constructed with a coverage-tested switch that cannot pass.

**`CardExpertise` is always before any caller-specific oracle** — the matching key `(sourceCardId, promptType)` is independent of caller, and an expertise hint expresses "this card has a known correct answer" which should override caller-specific heuristics like `legal[0]` mechanical defaults but **not** override an explicit Plan target (which is the human/agent saying "I know better than the catalogue here").

Wait — that's wrong on second look. If a plan author writes a target `{cardName: 'Doom Queen'}` to override an expertise hint, the target should win. So actual order in plan modes is `[CardExpertise, PlanStep, PlanTarget, ...]` only if expertise passes when there's a pending matching plan target. **Resolution:** `CardExpertise.decide` returns `pass` whenever `ctx.pendingTargets` (or `pendingChainTargets` for SELECT_CHAIN) contains an entry that *would match* the current legal set. This keeps the priority "explicit plan > expertise > mechanical" without inverting chain order.

### `ResolveResult` and `OracleResult`

```ts
type ResolveResult =
  | { kind: 'response'; response: OcgResponse; source: OracleName }
  | { kind: 'branches'; actions: Action[]; source: OracleName }
  | { kind: 'divergence'; info: DivergenceInfo; source: OracleName };

type OracleResult =
  | { kind: 'response'; response: OcgResponse }
  | { kind: 'branches'; actions: Action[] }
  | { kind: 'divergence'; info: DivergenceInfo }
  | { kind: 'pass' };
```

The `branches` kind exists because DFS exploration *is* a real decision outcome — "I have no opinion, fan out the legal set and let DFS scoring rank". It is produced exclusively by `BranchingOracle` and `OpponentBranchingOracle`. Lower oracles never emit `branches`; expertise/plan/raw all converge to a single response.

`runUntilPlayerPrompt` accepts `branches` and returns the `Action[]` to its DFS caller (current behavior preserved). The plan-replay loop never receives `branches` because no oracle in its composition emits them.

`source` on `ResolveResult` is the name of the oracle that produced the result — e.g. `'PlanTargetOracle'`, `'MechanicalDefaultOracle'`. Used for telemetry and debugging only, no logic depends on it.

### `DecisionContext`

```ts
interface DecisionContext {
  // OCG prompt payload
  promptType: PromptType;
  msg: Record<string, unknown>;        // raw OCG message
  legal: Action[];                      // pre-enumerated legal responses

  // State
  state: FieldState;
  phase: 'preBattle' | 'battle' | 'postBattle';
  caller: 'dfs' | 'plan-β1' | 'plan-β3' | 'enumerate';

  // Plan-mode mutable queues (oracles document which they mutate)
  pendingTargets?: TargetSpec[];
  pendingChainTargets?: TargetSpec[];
  rawSteps?: RawTrajectoryStep[];
  rawIdx?: { value: number };  // boxed for mutation through ctx
  planSteps?: PlanStep[];
  planIdx?: { value: number };

  // Card-aware metadata
  sourceCardId?: number;                // best-effort, see Phase 6
  expertise?: ArchetypeExpertise;

  // Adapter-internal counters
  endPhaseAttempts?: { value: number };
  aggressiveActions?: { value: number };

  // Config
  config?: DuelConfig;
}
```

**Mutation contract:** `ctx` IS mutable. Each oracle declares in its docstring which fields it reads vs. writes. The "no mutable state inside oracles" goal of the previous draft was unrealistic because plan/raw consumption is intrinsically stateful. Boxing counters as `{ value: number }` makes mutation explicit and reviewable rather than hidden behind reference semantics.

### Oracle interface

```ts
interface DecisionOracle {
  readonly name: string;
  decide(ctx: DecisionContext): OracleResult;
  reset?(): void;  // optional, for oracles with internal caches
}
```

Oracles are constructed once per solve (or per CLI run). `reset()` clears any internal cache between solves; not all oracles need it.

---

## Per-oracle specifications

### 1. `OpponentBranchingOracle`

**Activates when:** prompt is for the opponent player AND `config.handtraps.length > 0` AND `promptType === 'SELECT_CHAIN'`.

**Returns:** `{ kind: 'branches', actions: enumerated_with_team_1 }`.

**Otherwise:** `{ kind: 'pass' }`. The `MechanicalDefaultOracle` at chain end will produce a goldfish response for non-adversarial opponent prompts (current `autoRespondOpponent` behavior reproduced as a sub-case of `MechanicalDefaultOracle`).

**Migration source:** `ocgcore-adapter.ts:807-816, 1676+`.

### 2. `CardExpertiseOracle`

**Activates when:** `ctx.expertise` is loaded AND a `decisionHints[ctx.sourceCardId][ctx.promptType]` entry exists AND no pending plan target/chainTarget would match the current legal set.

**Pass-through guard:** before reading hints, scan `ctx.pendingTargets` (or `pendingChainTargets`) for an entry whose `cardName` or `responseIndex` matches any element of `ctx.legal`. If such a target exists, return `{ kind: 'pass' }` so PlanTargetOracle wins.

**Returns:** `{ kind: 'response', response: derive(policy, msg, legal) }`.

**Schema** of `decisionHints` entry:

```jsonc
{
  "67322708": {                              // sourceCardId (e.g. D/D Lance Soldier)
    "ANNOUNCE_NUMBER": {
      "policy": "max",
      "context": "level-up-effect",          // optional, free-text disambiguation
      "_source": "manual",                   // 'manual' | 'path-beta-subagent' | 'tier-3-policy' | 'default-mechanical'
      "_confidence": "observed",             // 'observed' | 'inferred' | 'guessed'
      "_authored": "2026-05-15",
      "_rationale": "max enables higher-rank Xyz/Synchro material downstream"
    }
  }
}
```

**Provenance metadata is permanent.** `_source` is not a deprecation flag — it is a data lineage field. A value can be authored manually today (`_source: 'manual'`, `_confidence: 'guessed'`), validated later by a Path β subagent run (`_source: 'path-beta-subagent'`, `_confidence: 'observed'`), and ultimately replaced by an ML-extracted value (`_source: 'tier-3-policy'`). The format and the runtime path are unchanged across these transitions — only the value's provenance updates.

**Policy types** (extensible, each maps a hint to a concrete OCG response):

| Policy | Applies to | Behavior |
|---|---|---|
| `"max"` / `"min"` | ANNOUNCE_NUMBER, SELECT_OPTION | pick last/first index of `options[]` |
| `"yes"` / `"no"` | SELECT_YESNO, SELECT_EFFECTYN | force responseIndex 1/0 |
| `"first"` / `"last"` | any indexed prompt | pick legal[0] / legal[N-1] |
| `"preferred"` + `preferredCardIds[]` | SELECT_CARD, SELECT_TRIBUTE | first match by cardId |
| `"all"` | SELECT_PLACE, SELECT_DISFIELD | take all places from field_mask |
| `"face-down"` / `"face-up-attack"` / `"face-up-defense"` | SELECT_POSITION | corresponding OcgPosition |

Unknown policies → log + return `pass` (graceful fallback). Adding a new policy is a code change, not a data change.

**Pass-through:** if no hint matches, `{ kind: 'pass' }`.

### 3. `RawTrajectoryOracle` (β-3 only)

**Activates when:** `ctx.caller === 'plan-β3'` AND `ctx.rawSteps` defined AND `ctx.rawIdx.value < ctx.rawSteps.length`.

**Logic:**
- Try matching `legal.find(a => a.responseIndex === step.responseIndex && a.cardId === step.cardId)`.
- On match: increment `rawIdx`, return `{ kind: 'response' }`.
- On no-match at non-strategic prompt (anything except SELECT_IDLECMD): return `{ kind: 'pass' }` *without* consuming the step. Lower oracles auto-resolve. The trajectory drifts at sub-prompts but resyncs at the next strategic decision.
- On no-match at SELECT_IDLECMD: return `{ kind: 'divergence', info: ... }` — strategic divergence is fatal.

**Mutates:** `ctx.rawIdx`.

**Migration source:** `replay-trajectory-cli.ts:499-555`.

### 4. `PlanStepOracle` (β-1 only, SELECT_IDLECMD only)

**Activates when:** `ctx.caller === 'plan-β1'` AND `promptType === 'SELECT_IDLECMD'` AND `ctx.planIdx.value < ctx.planSteps.length`.

**Logic:**
- Match next plan step against legal via `actionMatchesPlanStep` (existing function).
- On match: increment `planIdx`, load `step.targets` into `ctx.pendingTargets`, load `step.chainTargets` into `ctx.pendingChainTargets`, return `{ kind: 'response' }`.
- On no-match: return `{ kind: 'divergence' }`.

**Plan-exhausted continuation** (`planIdx.value === planSteps.length`):
- If `endTurn === false`: caller stops the loop (handled at PromptResolver level via a config flag, not inside the oracle).
- If `endTurn === true`: pass to `EndPhasePolicyOracle`.

**Mutates:** `ctx.planIdx`, `ctx.pendingTargets`, `ctx.pendingChainTargets`.

**Migration source:** `replay-trajectory-cli.ts:558-612`.

### 5. `PlanTargetOracle` (β-1, sub-prompts)

**Activates when:** `ctx.caller === 'plan-β1'` AND prompt is in `PLAN_PICKABLE_PROMPTS` AND a pending target/chainTarget matches the legal set.

**`PLAN_PICKABLE_PROMPTS`** (preserved from current `SUB_PROMPT_PICKABLE`):
```
SELECT_CARD, SELECT_OPTION, SELECT_PLACE, SELECT_UNSELECT_CARD,
SELECT_TRIBUTE, SELECT_SUM, SELECT_POSITION,
SELECT_YESNO, SELECT_EFFECTYN
```

The set is **not** opened up by default. The previous draft proposed handling "any prompt type" — that is a sneaky breaking change for existing plans. Expansion is opt-in via a separate flag in a future sprint.

**Logic:** identical to current `tryConsumeTarget` / `tryConsumeChainTarget` — case-insensitive substring on cardName, OR exact responseIndex match. SELECT_CHAIN consumes from `pendingChainTargets`, others from `pendingTargets`.

**Mutates:** `ctx.pendingTargets` or `ctx.pendingChainTargets` (shifts head on consume).

**Migration source:** `replay-trajectory-cli.ts:443-484, 614-650`.

### 6. `BranchingOracle` (DFS only)

**Activates when:** `ctx.caller === 'dfs'` AND prompt is in the exploratory set.

**Sub-rules** (each a private method, named for traceability):

| Sub-rule | Trigger | Output |
|---|---|---|
| `IdlecmdBattlecmdChainEffectynYesnoOption` | `promptType ∈ EXPLORATORY_PROMPTS` | branches = `enumerateActionsWithResponses(...)` |
| `SelectCardSmallPool` | `promptType === SELECT_CARD` AND pool ≤ `SELECT_CARD_EXPLORATORY_MAX` (currently 6) AND single-pick | branches = enumerated candidates |
| `SelectCardPreferredLargePool` | `promptType === SELECT_CARD` AND pool > MAX AND `preferredSearchTargets` has matches | branches = top-K preferred matches via `enumeratePreferredSelectCard` |
| `MultiPickInteractive` | `exposeMultiPickMechanical` flag AND prompt ∈ {SELECT_CARD min>1, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD multi} | branches = `tryInteractiveMechanical` output |

Each sub-rule fires in the order listed; first to match wins. Pass-through if none match.

**Returns:** `{ kind: 'branches', actions: ... }` or `{ kind: 'pass' }`.

**F14 plumbing preserved:** the post-resolve hook in `PromptResolver` populates `internal.lastIdlecmdActivatableHandCount` after a `branches` result for SELECT_IDLECMD — this is graph-ml-v2 feature extraction, must survive bit-exact.

**Migration source:** `ocgcore-adapter.ts:825-876, 894-1100+`.

### 7. `EndPhasePolicyOracle` (plan-mode only, plan exhausted)

**Activates when:** plan/raw is exhausted AND `endTurn === true`.

**Logic** (per current CLI):
- SELECT_IDLECMD with productive verbs available AND `continueMode === 'aggressive'` AND `aggressiveActions < cap`: pick productive, increment.
- SELECT_IDLECMD: pick `actionVerb === 'end-phase'`, increment `endPhaseAttempts`.
- `endPhaseAttempts > MAX_END_PHASE_ATTEMPTS`: return `{ kind: 'divergence', info: ceiling }`.
- SELECT_CHAIN: pass (chain end auto-pass via mechanical).
- SELECT_EFFECTYN: pass (default YES via mechanical).
- All others: pass (legal[0] via mechanical).

**Mutates:** `ctx.endPhaseAttempts`, `ctx.aggressiveActions`.

**Migration source:** `replay-trajectory-cli.ts:534-555, 584-612`.

### 8. `MechanicalDefaultOracle` (always last)

**Coverage discipline:** every `OcgMessageType` that *currently* has a case in `autoRespondMechanical` (ocgcore-adapter.ts:1573-1672) is migrated verbatim. Behavior is bit-exact reproducible.

**New cases ARE NOT added speculatively.** ANNOUNCE_RACE / ANNOUNCE_CARD / ANNOUNCE_ATTRIB / SORT_CARD / SORT_CHAIN / ROCK_PAPER_SCISSORS keep their current `solverAssert(false, ...)` throw. The previous draft proposed defaults like "first race in mask" without a fixture validating the choice. That's the kind of guess that produces silent regressions on Mind Crush, Number Annihilation, etc. Until a fixture exercises one of these prompts, the throw stays.

**Adding a new default IS a 3-step process:**
1. Identify the fixture exercising the prompt.
2. Choose a default with documented rationale.
3. Add a test asserting the chosen response is legal-correct on that fixture.

This applies to `MechanicalDefaultOracle` extensions in this refactor and to all future ones.

**Returns:** `{ kind: 'response', response: <hardcoded default> }` for known cases. For unknown cases: `solverAssert` throws (dev) / returns `{ type: 4, index: 0 }` (prod) — same fail-safe as today.

**Includes:** `autoRespondOpponent` cases (sub-branch on team if needed) — opponent goldfish becomes a sub-case here so DFS opponent path still routes through the chain.

**Migration source:** `ocgcore-adapter.ts:1571-1690`.

---

## `sourceCardId` plumbing (Phase 6)

Many prompts have an implicit "source card" (the card whose effect emitted the prompt). The OCG message often contains a `code` field. Phase 6 produces a **coverage matrix** before any expertise hint is wired:

| OcgMessageType | `code` field present? | sourceCardId resolution strategy |
|---|---|---|
| ANNOUNCE_NUMBER | TBD | TBD |
| SELECT_YESNO | TBD | TBD |
| SELECT_EFFECTYN | TBD | TBD |
| SELECT_CARD | TBD | TBD (likely the *triggering* card, distinct from the cards being selected) |
| SELECT_POSITION | TBD | TBD |
| SELECT_PLACE | TBD | TBD |
| SELECT_TRIBUTE | TBD | TBD |
| (etc.) | | |

The matrix is filled by Phase 6 by:
1. Logging `msg` payloads at every prompt during a corpus of audited fixtures.
2. Inspecting OCGCore source for the message-construction code path.
3. Documenting the field name and reliability per prompt type.

**If <60% of prompt types expose a reliable sourceCardId:** `CardExpertiseOracle` is demoted from a Phase 5 critical path to a best-effort path, and Phase 7 expertise population is restricted to the prompts where sourceCardId is reliable. This is a hard gate — we do not author hints that won't fire.

---

## Phase plan

| Phase | Duration | Deliverable | Gate |
|---|---|---|---|
| **0. Inventory** | 3-4 days | `inventory-2026-05-XX.md` cataloguing every branchement in both entry points (current behavior, mutation, dependencies, OCGCore-version sensitivity) | Reviewed and signed off by Axel before Phase 1 |
| **1. Test harness** | 2-3 days | Snapshots: 69 canonical fixtures, 4 audited Path β-1 fixtures, 4 audited Path β-3 traces, enumerate-skip/pivot baselines, 1 adversarial fixture | All snapshots reproduce on rerun byte-identical |
| **2. PromptResolver + MechanicalDefaultOracle** | 3 days | New module wired but not called by either entry point yet. Unit tests covering every existing `autoRespondMechanical` case + every `autoRespondOpponent` case. | Unit suite green; coverage matrix filled for current cases |
| **3. Adapter migration** | 3-4 days | `runUntilPlayerPrompt` calls `PromptResolver` (DFS chain composition: `[OpponentBranching, BranchingOracle, MechanicalDefault]`). F14 plumbing preserved via post-resolve hook. | Canonical eval bit-identical vs Phase 1 baseline |
| **4. CLI migration** | 3-4 days | `replay-trajectory-cli.ts` calls `PromptResolver` (Plan/Raw chain compositions). `tryConsumeTarget`/`tryConsumeChainTarget`/raw matching deleted from CLI. | Path β-1/β-3 + enumerate baselines bit-identical vs Phase 1 |
| **5. CardExpertiseOracle (empty)** | 2 days | Oracle inserted in chain compositions. Schema extension for `archetype-expertise/<deck>.json`. Loader updates. Pass-through when `decisionHints` absent. | All baselines still bit-identical (proves pass-through is a no-op) |
| **6. sourceCardId plumbing** | 2-3 days | Coverage matrix filled. Plumbing implemented for prompts where reliable. | Matrix published; <60% reliability triggers scope reduction for Phase 7 |
| **7. decisionHints population** | 2-3 days | 4 audited fixtures get hint files. Capture tooling extracts overrides from existing β-1 plans (no manual transcription). | DFS-solver standalone reaches Path β-1 levels on prompt-local decisions (e.g. snake-eye 4/7 via SELECT_YESNO override). Trajectory-level lifts (Doom Queen pivot etc.) explicitly out of scope. |

**Phase 0 is non-negotiable.** It's the ingrate phase that determines whether the refactor surfaces all invariants or misses one. Without a published inventory reviewed by Axel, Phase 3 will discover a hidden invariant (F14, adversarial branching, locale of ANNOUNCE_NUMBER `value` semantics) and lose a week patching mid-flight.

### Bit-exact gate methodology

For every phase touching runtime decision paths (3, 4, 5):

1. Pre-phase: snapshot baselines from Phase 1 — `baseline-pre-refactor-{eval,β1,β3,enumerate}.json`.
2. Post-phase: rerun the same harness with `SOLVER_USE_PROMPT_RESOLVER=1`.
3. Diff per fixture on `{matched, score, missingCardIds, finalBoardSelf, divergenceReason, prompt-by-prompt response trace}`.
4. Any divergence is a regression — investigate before advancing.

**Pinned baseline:** the canonical eval baseline is captured in Phase 1 at a specific commit SHA. The current memory note (cum 21/69 score 555) is informational; the *gate* is whatever Phase 1 captures at the chosen commit. If SELECT_YESNO override option A is not yet merged at Phase 1 start, Phase 1 waits for it.

### Feature flag and cutover

`SOLVER_USE_PROMPT_RESOLVER=1` env var. Default OFF until Phase 5 ships. Then a separate "default-flip + legacy-deletion" commit, with a one-week window where the flag remains toggleable for emergency revert. After the window, legacy code paths are deleted in a follow-up.

---

## Acceptance criteria

After Phase 7:

1. **Single decision path.** No code outside `PromptResolver`/`OracleChain` produces an `OcgResponse` for a player prompt. (`autoRespondMechanical` + `autoRespondOpponent` deleted; CLI fallbacks deleted.)
2. **Bit-exact preservation.** All baselines from Phase 1 reproduce byte-identical with the resolver on (modulo Phase 7 hint-driven changes, which are intentional).
3. **Coverage matrix published** for `sourceCardId` per OcgMessageType.
4. **Expertise schema documented** with provenance metadata fields (`_source`, `_confidence`, `_authored`, `_rationale`).
5. **No speculative defaults.** Every entry in `MechanicalDefaultOracle` is either a verbatim migration of a previously-existing case OR has a fixture+test backing it.
6. **Decision graph documented.** For every OcgMessageType the solver encounters, the design doc (or a generated table) names which oracle resolves it under each chain composition.

---

## Enumeration tools (`enumerate-skip`, `enumerate-pivot`)

These tools measure mechanical brute-force potential per plan variant. They must remain comparable across runs — i.e. expertise hints should not silently change the score of a pivoted starter.

**Default:** `CardExpertiseOracle` is **disabled** in the chain composition for these tools. CLI flag `--use-expertise=true` opts in if needed.

This is consistent with the existing `SOLVER_DISABLE_EXPERTISE=1` discipline (memo phase-0-honest-baseline-2026-04-26) — measurement tools run on raw mechanical performance.

---

## Open design questions

### Q1 — `ctx` mutation visibility

`ctx` is mutable. Oracles document mutations in their docstrings. Is this enough or do we want a runtime guard (e.g. dev-mode `Object.freeze` on read-only fields)? **Proposal:** ship Phase 2 without runtime guards; revisit if a mutation bug is observed during Phase 3-4 bit-exact validation.

### Q2 — Where is `ArchetypeExpertise` loaded into `ctx.expertise`?

Currently expertise is loaded once per solve into the adapter. Proposal: `PromptResolver` constructor accepts an `expertise` object; passes it via every `ctx`. Plan-replay CLI loads expertise from the deck's archetype file at startup, same path.

### Q3 — Snapshot lifecycle for ML evaluation oracles (future)

Out of scope for this refactor. Mentioned only to flag that future ML oracles producing values via fork-and-evaluate need a careful snapshot stack design (current LIFO with `nativeHandle` sharing is fragile under nested forks). When a Tier 3 ML evaluation oracle is greenlit, a separate design memo addresses this.

### Q4 — Provenance metadata enforcement

Should the loader reject `decisionHints` entries missing `_source` / `_confidence` / `_authored`? **Proposal:** warn, don't reject. Forward-compatible loader is more important than strict schema during the manual-authoring → ML-extraction transition window.

---

## Risks

1. **Phase 0 inventory misses an invariant** → Phase 3-4 bit-exact gate fails late. *Mitigation:* Phase 0 sign-off by Axel; review checklist includes specific search for: F14 plumbing, adversarial branching, opponent goldfish, endphase ceiling, aggressive cap, lastCommittedPlanStepIndex, divergence reporting structure.
2. **`sourceCardId` matrix shows <60% coverage** → Phase 7 scope shrinks. Already mitigated by the explicit gate at Phase 6.
3. **Bit-exact divergence at Phase 3 or 4** → revert phase, investigate. Mitigated by feature flag default-OFF and per-phase baseline comparison.
4. **Effort overrun beyond 5 weeks.** *Mitigation:* phases 6-7 can be deferred to a follow-up if 1-5 take all of the budget. Phases 1-5 alone deliver the unification value (decisions go through one path); phases 6-7 deliver the expertise capability on top.
5. **Adapter caching breakage.** `runUntilPlayerPrompt` has subtle internal state (`internal.responseHistory`, `internal.lastIdlecmdActivatableHandCount`, etc.). The `PromptResolver` post-resolve hook must replicate every side effect. *Mitigation:* Phase 0 inventory enumerates these explicitly; Phase 3 unit tests cover each.

---

## Next step

Phase 0 inventory. Two parallel tracks:

- **Track A** — audit `runUntilPlayerPrompt` and all helpers reachable from it. Output: a markdown listing every branchement with trigger/mutation/dependency/OCGCore-version sensitivity.
- **Track B** — audit `replay-trajectory-cli.ts` boucle and helpers. Same format.

Both tracks merge into `inventory-2026-05-XX.md`. Reviewed in a sit-down with Axel before any code lands.
