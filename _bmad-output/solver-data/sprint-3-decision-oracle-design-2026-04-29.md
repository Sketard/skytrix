# Sprint 3 — Decision Oracle Chain (Design Doc)

**Status:** DRAFT 2026-04-29
**Owner:** Axel + Claude (collab)
**Goal:** Replace the 3 parallel decision paths (DFS-runtime hardcoded, CLI plan-replay overrides, β-3 raw trajectory) with a single chain-of-responsibility oracle architecture. All current hardcoded choices become routed decisions; capitalised knowledge moves from code to data.

---

## Why now

3 bug classes have been found and fixed in 2 sprints (ANNOUNCE_NUMBER missing/index, SELECT_YESNO override). Each fix was a one-off adjustment. The root cause is structural: every hardcoded choice in `autoRespondMechanical` is a coup d'absent in combo discovery, and 5+ remain (SELECT_TRIBUTE, SELECT_POSITION, SELECT_UNSELECT_CARD, ANNOUNCE_RACE/CARD/ATTRIB, SORT_CARD/CHAIN). Continuing one-off fixes scales linearly with audited fixtures and never lifts DFS-solver standalone.

This refactor unifies the decision pipeline so every hardcoded becomes either a DFS branch, an authored expertise hint, a heuristic-scored choice, or a documented mechanical default — and the same pipeline serves DFS-solver, Path β CLI, and (future) Tier 3 ML policy.

## Non-goals (this sprint)

- **No DFS budget / scoring changes.** Pure refactor + capability extension.
- **No Tier 3 ML.** Phase 7 (HeuristicScoringOracle) is the closest, optional, deferred until Phase 0-6 ship.
- **No opponent intelligence.** `autoRespondOpponent` keeps its goldfish behavior. Future sprint.
- **No plan grammar break.** Existing `targets[]` / `chainTargets[]` semantics preserved verbatim.

---

## Architecture

### Single decision flow

```
prompt arrives → OracleChain.decide(ctx) → OcgResponse
                       │
                       ├─ 0. RawTrajectoryOracle      (β-3 verbatim, highest priority)
                       ├─ 1. PlanTargetOracle         (β-1 grammar — targets[]/chainTargets[])
                       ├─ 2. CardExpertiseOracle      (archetype-expertise/<deck>.json decisionHints)
                       ├─ 3. DfsBranchingOracle       (DFS branches exploratory + score-based)
                       ├─ 4. HeuristicScoringOracle   (1-step lookahead, Phase 7 optional)
                       └─ 5. MechanicalDefaultOracle  (legal[0]/FACEUP_ATTACK/etc., dernière chance)
```

Each oracle returns **one of three values**:

```ts
type OracleResult =
  | { kind: 'response'; response: OcgResponse }       // commit, stop chain
  | { kind: 'branch'; actions: Action[] }             // DFS fan-out (oracle 3 only)
  | { kind: 'pass' }                                  // I have no opinion, next oracle
```

The chain:

```ts
class OracleChain {
  constructor(private oracles: DecisionOracle[]) {}
  decide(ctx: DecisionContext): OracleResult {
    for (const o of this.oracles) {
      const r = o.decide(ctx);
      if (r.kind !== 'pass') return r;
    }
    throw new Error(`No oracle returned a decision for ${ctx.promptType} — MechanicalDefaultOracle should always answer`);
  }
}
```

### `DecisionContext`

```ts
interface DecisionContext {
  // OCG prompt payload (raw)
  promptType: PromptType;
  msg: Record<string, unknown>;        // raw OCG message
  legal: Action[];                      // pre-enumerated legal responses

  // State at prompt time
  state: FieldState;                    // current rendered board state
  phase: 'preBattle' | 'battle' | 'postBattle';

  // Caller hints (which oracle activates)
  caller: 'dfs' | 'plan-replay-β1' | 'plan-replay-β3' | 'mcts';
  pendingTargets?: TargetSpec[];        // β-1 plan: consumed by PlanTargetOracle
  pendingChainTargets?: TargetSpec[];   // β-1 plan: consumed by PlanTargetOracle
  rawStep?: RawTrajectoryStep;          // β-3 raw mode

  // Card-aware metadata
  sourceCardId?: number;                // which card emitted this prompt (best-effort)
  expertise?: ArchetypeExpertise;       // loaded for the deck under solve

  // Config
  config?: DuelConfig;                  // includes preferredSearchTargets etc.
}
```

`sourceCardId` is the single most important new piece of metadata. The current adapter has access to it (the prompt message contains a `code` field for many prompt types), but doesn't propagate it to the auto-resolve path. Plumbing this through is part of Phase 1.

### Oracle interface

```ts
interface DecisionOracle {
  readonly name: string;
  decide(ctx: DecisionContext): OracleResult;
}
```

That's all. No mutable state inside the oracle (ctx-driven). Oracles can be unit-tested in isolation.

---

## Per-oracle specifications

### 0. RawTrajectoryOracle

**Activates when:** `ctx.caller === 'plan-replay-β3'` AND `ctx.rawStep` is defined AND there's a legal action matching `(rawStep.responseIndex, rawStep.cardId)`.

**Returns:** `{ kind: 'response', response: matchedAction._response }` — verbatim apply.

**On no match at SELECT_IDLECMD:** `{ kind: 'pass' }` and emit divergence (caller handles).

**Migration:** lift the existing β-3 raw-step matching from `replay-trajectory-cli.ts` (lines ~480-525). No new logic.

### 1. PlanTargetOracle

**Activates when:** `ctx.caller === 'plan-replay-β1'` AND a pending target/chainTarget matches.

**Logic** (existing `tryConsumeTarget` / `tryConsumeChainTarget`):
- For SELECT_CHAIN: consume next `pendingChainTargets[0]` if it matches; on consume, shift queue.
- For other prompts: consume next `pendingTargets[0]` if cardName/responseIndex matches. Match semantics: case-insensitive substring on cardName, OR exact responseIndex match. On consume, shift queue.

**Returns:** `{ kind: 'response', response: matchedAction._response }`.

**Important change vs current:** the `SUB_PROMPT_PICKABLE` set goes away. The oracle handles **any** prompt type — including those previously hardcoded (SELECT_TRIBUTE, ANNOUNCE_NUMBER, SELECT_DISFIELD, etc.). If a plan author wants to pick a specific tribute target via cardName, it works.

**No-op fallthrough:** if no target matches, return `{ kind: 'pass' }`. Lower oracles take over.

### 2. CardExpertiseOracle

**Activates when:** the deck under solve has loaded an expertise file with a `decisionHints` section that matches `(ctx.sourceCardId, ctx.promptType)`.

**Format extension to `archetype-expertise/<deck>.json`:**

```jsonc
{
  // existing scoring tuning fields...
  "decisionHints": {
    "67322708": {  // D/D Lance Soldier
      "ANNOUNCE_NUMBER": {
        "policy": "max",
        "rationale": "Level-up effect — max enables higher-rank Xyz / Synchro material"
      }
    },
    "53639887": {  // Divine Temple of the Snake-Eye
      "SELECT_YESNO": {
        "policy": "yes",
        "context": "place-snake-eye-monster-as-cont-spell",
        "rationale": "Required to gate Diabellstar/Flamberge Cont-Spell self-summon line"
      }
    },
    "20715411": {  // D/D/D Zero Doom Queen Machinex
      "SELECT_CARD": {
        "policy": "preferred",
        "preferredCardIds": [32665564],  // Zero Contract — Pendulum-effect place target
        "context": "p-effect-place-dark-contract"
      }
    }
  }
}
```

**Policy types:**
- `"max"` / `"min"` — for ANNOUNCE_NUMBER, SELECT_OPTION (numeric)
- `"yes"` / `"no"` — for SELECT_YESNO, SELECT_EFFECTYN
- `"first"` / `"last"` — for ordered enumerations (default = first)
- `"preferred"` + `preferredCardIds[]` — for SELECT_CARD/TRIBUTE; matches first
- `"all"` — for SELECT_PLACE, SELECT_DISFIELD multi-pick
- `"face-down"` / `"face-up-attack"` / `"face-up-defense"` — for SELECT_POSITION

**Returns:** `{ kind: 'response', response: <derived from policy + msg> }`.

**Pass-through:** if no hint matches, return `{ kind: 'pass' }`.

### 3. DfsBranchingOracle

**Activates when:** `ctx.caller === 'dfs'` AND the prompt is in the EXPLORATORY set.

**Returns:** `{ kind: 'branch', actions: ctx.legal }` — signal to DFS to branch all legal actions. The DFS caller is responsible for ranking and walking branches.

**Extension:** the EXPLORATORY set, currently `{IDLECMD, BATTLECMD, CHAIN, EFFECTYN, YESNO, OPTION}`, gains:
- **SELECT_POSITION** if pool ≤ 4 (typically 2-3 choices)
- **ANNOUNCE_NUMBER** if `options.length` ≤ 6
- **SELECT_CARD small-pool** (already partially handled via `selectCardIsExploratory`)

These extensions are gated by an `EXPLORATORY_BRANCH_LIMIT` constant per prompt type (configurable, defaults conservative).

**Why this is an oracle and not just runtime DFS logic:** Phase 5 expertise can pin a single response, short-circuiting the branch. So the DFS asks "should I branch or am I told?" via the oracle chain rather than checking branching directly.

**Pass-through (for non-DFS callers):** return `{ kind: 'pass' }` (Path β / β-3 don't branch; lower oracles handle).

### 4. HeuristicScoringOracle (Phase 7, OPTIONAL)

**Activates when:** prompt is combinatoric class (SELECT_CARD large pool, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD multi-pick).

**Logic:** for each candidate (or top-K candidates by some cheap heuristic), fork the duel state, apply the candidate, evaluate scorer at the resulting state, return the candidate with the highest score.

**Cost:** N forks × scorer eval per call. Snapshot fork (~5× speedup) makes this feasible but expensive. Bound K by config.

**Returns:** `{ kind: 'response', response: bestCandidate._response }`.

**Deferred to Phase 7.** Phases 0-6 ship without this; if the previous oracles all pass, oracle 5 takes over.

### 5. MechanicalDefaultOracle

**Activates when:** all higher-priority oracles passed.

**Returns:** `{ kind: 'response', response: <hardcoded default> }`.

**Coverage requirement:** must handle **every** OCG prompt type, including currently-throwing ones (ANNOUNCE_RACE, ANNOUNCE_CARD, ANNOUNCE_ATTRIB, SORT_CARD, SORT_CHAIN, ROCK_PAPER_SCISSORS).

**Defaults catalogue:**

| Prompt | Default | Rationale |
|---|---|---|
| SELECT_POSITION | FACEUP_ATTACK | Goldfish offensive default |
| SELECT_PLACE | all places from field_mask | Take all OCG-allowed |
| SELECT_DISFIELD | all places from field_mask | Same |
| SELECT_TRIBUTE | indices `[0..min)` | First N |
| SELECT_SUM | indices `[0..min)` | First N |
| SELECT_COUNTER | all-zero counter array | Don't remove counters |
| SELECT_CARD | preferred-priority if allFromDeck && preferred set, else `[0..min)` | Match current behavior |
| SELECT_UNSELECT_CARD | `index: 0` (or null if can_finish) | Match current |
| SELECT_OPTION | `index: 0` | Match current (also exploratory if branched) |
| SELECT_CHAIN | pass (`responseIndex: -1`) | Match current |
| SELECT_EFFECTYN | YES (`responseIndex: 1`) | Match current |
| SELECT_YESNO | NO (`legal[0]`) | Match current default-NO discipline |
| ANNOUNCE_NUMBER | last index (max value) | Match current post-Sprint 1 fix |
| **ANNOUNCE_RACE** | first race in `available` mask | NEW — currently throws |
| **ANNOUNCE_ATTRIB** | first attribute in `available` mask | NEW — currently throws |
| **ANNOUNCE_CARD** | first cardId in `available` (or 0 if none) | NEW — currently throws |
| **SORT_CARD** | identity ordering `[0..N)` | NEW — currently throws (and probably non-significant) |
| **SORT_CHAIN** | identity ordering | NEW — currently throws |
| **ROCK_PAPER_SCISSORS** | per-player constant (turn-0 setup) | NEW — currently throws |

This oracle is **always last**; it must always return `{ kind: 'response' }`, never pass.

---

## Compat & migration strategy

### Feature flag

`SOLVER_USE_ORACLE_CHAIN=1` env var. Default = OFF during sprint. When ON, the chain is wired in; when OFF, existing logic runs unchanged. Allows side-by-side validation per phase.

### Phase progression

| Phase | Files touched | Validation gate |
|---|---|---|
| 0. Design doc | this file | N/A — review with Axel |
| 1. Skeleton | `oracle-types.ts` (new), `oracle-chain.ts` (new), `decision-context.ts` (new). No-op chain wires through existing logic. | Build passes, no behavioral change |
| 2. PlanTargetOracle | `replay-trajectory-cli.ts` refactor; oracle replaces `tryConsumeTarget` + `tryConsumeChainTarget` | Re-run 4 audited fixtures bit-identical (`ddd-pendulum-opener` 3/5, `branded-dracotail-opener` 7/8, `ryzeal-mitsurugi-opener` ≥3/5, `radiant-typhoon-opener` 2/3) |
| 3. DfsBranchingOracle | `ocgcore-adapter.ts` `runUntilPlayerPrompt` consult oracle for branch/pass; `dfs-solver.ts` consume `branch` results | Canonical eval `data/eval-arch-c/p5-full-pool4.json` reproducible bit-identical (cum 21/69 score 555 — current post-P5 baseline) |
| 4. MechanicalDefaultOracle exhaustive | `ocgcore-adapter.ts` `autoRespondMechanical` deleted, replaced by oracle calls. New cases for ANNOUNCE_RACE/CARD/ATTRIB/SORT_*/RPS. | Canonical eval still bit-identical for cases that previously didn't throw. New cases: at minimum, no longer throw on a fixture that fires them (regression test TBD per case) |
| 5. CardExpertiseOracle | `archetype-expertise/<deck>.json` schema extended; loader updated; oracle reads `decisionHints` | Empty `decisionHints` = pass-through; presence of hint actually applies |
| 6. Populate decisionHints for 4 fixtures | data only: `ddd-wcq-top4.json`, `branded-dracotail-bainbridge-2nd.json`, `ryzeal-mitsurugi-hk-top8.json`, `radiant-typhoon-ygoprodeck-2026.json` | DFS-solver standalone (no Path β plan) reaches the previously-Path-β-only matches: snake-eye 4/7, ddd ≥3/5 etc. |
| 7. (optional) HeuristicScoringOracle | new `heuristic-scoring-oracle.ts` | TBD — Phase 7 spec written separately if greenlit after Phase 6 |

### Bit-exact validation methodology

For each phase touching runtime decision paths, the gate is "canonical eval reproduces bit-identical output". Approach:

1. Before phase: snapshot `data/eval-arch-c/p5-full-pool4.json` as `baseline.json`
2. After phase: re-run canonical eval with `SOLVER_USE_ORACLE_CHAIN=1`, output to `phase-N.json`
3. Diff `baseline.json` vs `phase-N.json` on per-fixture `{matched, score, missingCardIds, finalBoardSelf}`
4. **Must match exactly** for the test to pass. Any divergence = potential regression to investigate before moving forward.

### Out-of-band risk: opt-in -> default switch

Once Phase 6 ships, `SOLVER_USE_ORACLE_CHAIN=1` becomes the default and the legacy code path is deleted in a follow-up commit. No silent switch — explicit cutover commit.

---

## Open design questions (review with Axel)

### Q1 — Where does oracle 3 (DFS branching) sit relative to Path β?

Path β CLI does NOT branch — it picks one. So when caller is β-1 and a prompt is exploratory:
- Today: `tryConsumeTarget` matches a specific target, else `legal[0]`.
- Tomorrow: oracle 1 (PlanTarget) consumes target if any → else oracle 2 (Expertise) → else oracle 3 says "DFS would branch but you're β-1, pass" → oracle 5 picks a sane default (auto-YES for EFFECTYN, auto-NO for YESNO, etc.).

Which means oracle 3 must be **caller-aware**. It only emits `{kind: 'branch'}` when `ctx.caller === 'dfs'`; for β-1 it passes. This is fine but means the abstraction "oracle 3 branches" is partially leaking caller knowledge. Acceptable trade — alternative would be having two separate chains (one per caller) which is more code for less unification.

### Q2 — Should `decisionHints` live in archetype-expertise or a separate file?

**Recommendation:** in archetype-expertise. Rationale:
- All deck-specific knowledge in one place
- Loader already exists, just extend the schema
- Future Tier 3 ML-extracted hints can be merged in via a tooling pass

**Alternative:** separate `decision-hints/<deck>.json`. Cleaner separation but two files to track per deck.

### Q3 — Cardinality of `sourceCardId` propagation

Many prompts have an implicit card ("you activated Lance Soldier's effect → ANNOUNCE_NUMBER"). The OCG message often (but not always) contains a `code` field. For prompts without a clear sourceCardId (e.g. SELECT_PLACE during Pendulum Summon — no single source), `sourceCardId` is undefined and oracle 2 just passes.

**Implementation note:** `sourceCardId` is a hint, not a contract. Phase 1 plumbs it best-effort; no hard guarantee.

### Q4 — Snapshot lifecycle for HeuristicScoringOracle (Phase 7)

If we ship Phase 7, each oracle call could fork-and-evaluate K times. Snapshot fork uses LIFO stack with `nativeHandle` sharing, so nested forks are tricky. Phase 7 needs a careful spec — probably each candidate evaluation needs its own snapshot push/pop. **Deferred to Phase 7 design memo if/when greenlit.**

### Q5 — How do we handle `enumerate-skip` / `enumerate-pivot` with oracle chain?

These tools exercise plan variants. They feed plans through the same CLI replay path → oracles 0-1 work as today. Phase 1 ships with these tools unchanged — they consume the oracle chain transparently.

### Q6 — Performance budget

Each oracle call is a method dispatch + a few branches. Aggregate cost across oracle chain ≈ negligible vs OCG step. Confirmed not to introduce slowdown via Phase 3 bit-exact validation.

---

## Acceptance criteria (sprint completion)

After Phase 6 (or 7 if shipped):

1. **Zero hardcoded `case OcgMessageType.X` in `autoRespondMechanical`** — all routed via oracles.
2. **Zero `throw`s** for unhandled prompt types in normal solver runs (ANNOUNCE_RACE/CARD/ATTRIB/SORT_*/RPS now answered, not crashing).
3. **Canonical eval bit-identical** to pre-refactor (or strictly improved on bug-class fixtures). Baseline = `p5-full-pool4.json` cum 21/69 score 555.
4. **Path β `targets[]` works for any prompt** (not gated by SUB_PROMPT_PICKABLE set anymore).
5. **DFS-solver standalone reaches Path β-1 v2 levels on 4 audited fixtures** when `decisionHints` populated (Phase 6 deliverable).
6. **Decision graph documented per prompt type** — for any prompt the solver encounters, we can name which oracle resolves it.

## Estimated effort

| Phase | Effort | Notes |
|---|---|---|
| 0. Design | 0.5d | This memo |
| 1. Skeleton + plumbing | 0.5d | Pure scaffolding |
| 2. PlanTargetOracle | 0.5d | Lift-and-shift existing logic |
| 3. DfsBranchingOracle | 1.0d | Most complex (fan-out signal) |
| 4. MechanicalDefaultOracle exhaustive | 1.0d | Includes new ANNOUNCE_*/SORT_*/RPS cases |
| 5. CardExpertiseOracle | 0.5d | Schema + loader + oracle |
| 6. Populate hints (4 fixtures) | 1.0d | Manual capture from Path β observations |
| **Total Phase 0-6** | **5.0d** | Ship target |
| 7. (optional) HeuristicScoringOracle | 2.0d | Defer until Phase 6 lifts confirmed |

## Risks

1. **DFS bit-exact equivalence breakage in Phase 3.** Mitigation: phase-by-phase bit-exact gate; revert if diverges.
2. **`sourceCardId` propagation gaps.** Some prompts genuinely lack a source. Acceptable — oracle 2 just passes for those.
3. **Expertise file authoring scales linearly.** True. But each fixture's hint set is small (2-5 entries typical). Tier 3 ML-extracted hints can automate later.
4. **Decision divergence at SELECT_CARD large-pool.** Oracle 5 must reproduce `enumeratePreferredSelectCard` logic exactly. Validated via Phase 4 bit-exact gate.

---

## Next step

Ship Phase 1 (skeleton + plumbing) without behavioral change. Validate canonical eval bit-identical with `SOLVER_USE_ORACLE_CHAIN=1`. Then Phase 2.
