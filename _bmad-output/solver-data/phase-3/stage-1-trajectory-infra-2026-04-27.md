# Phase 3 Stage 1 — Trajectory Extraction Infrastructure

**Date:** 2026-04-27
**Status:** SHIPPED
**Predecessor:** Phase B v2 ship (`_bmad-output/solver-data/phase-b/ship-v2-2026-04-27.md`)
**Roadmap:** `solver-ml-strategic-direction` memory — Phase 3 (auto-discovery via trajectory extraction)

---

## What shipped

A pluggable trajectory dump that extracts the per-step state + action features
of every DFS solve's best `mainPath`, packaged as one JSON file per fixture
in a versioned schema. Foundation for Phase 4 policy distillation.

### Wiring

- **`scripts/evaluate-structural.ts`** — new exports + behaviour:
  - `dumpTrajectoryToFile(adapter, duelConfig, mainPath, meta, outPath)` —
    side-effect free helper. Walks `mainPath` on a fresh duel fork, captures
    state + action features per step, writes JSON.
  - `runFixture(...)` accepts `opts.dumpTrajectoriesDir`, `opts.cardMetadata`,
    `opts.weightsBasename`, `opts.weights`. When `dumpTrajectoriesDir` is set
    AND `cardMetadata` is provided, runs the helper after the DFS solve.
  - `EvaluationContext` exposes `neuralWeights` + `neuralWeightsBasename` for
    worker-side traceability metadata.
  - `ParallelEvaluationOptions.dumpTrajectoriesDir` + `FixtureTask.dumpTrajectoriesDir`
    plumb the option through the Piscina pool.
  - CLI: `--dump-trajectories=<dir>` (existing fixture pipeline, no new
    standalone script).

- **`scripts/evaluate-structural-worker.ts`** — Piscina worker forwards
  `task.dumpTrajectoriesDir` and the boot-time `ctx.neuralWeights` /
  `ctx.cardMetadata` to `runFixture`.

### Schema (v1)

`<dir>/<fixtureId>.json`:

```json
{
  "schemaVersion": 1,
  "fixtureId": "branded-dracotail-opener",
  "deckLabel": "branded-dracotail-bainbridge-2nd",
  "weightsBasename": "neural-tier-a-latest",
  "weightsHash": "sha256:4f689804...ba6a",
  "weightsArch": "mlp[32]",
  "featureSpecHash": "sha256:4f689804...ba6a",
  "evalConfig": { "expertiseDisabled": true, "implicitGoalsWeight": 10,
                  "budgetMs": 6000, "nodeBudget": 400 },
  "outcome": { "score": 64, "matched": 3, "matchedTotal": 8,
               "matchedCardIds": [...], "missingCardIds": [...],
               "nodesExplored": 168, "wallMs": 5347,
               "terminationReason": "timeout" },
  "trajectory": [
    {
      "step": 0,
      "promptType": "SELECT_IDLECMD",
      "responseIndex": 6,
      "cardId": 30271097,
      "cardName": "The Fallen & The Virtuous",
      "actionDescription": "...",
      "actionVerb": "set-st",
      "stateFeatures": { "turn_norm": 0.2, "phase_main1": 1, ... },
      "actionFeatures": { "act_promptType_idlecmd": 1, ... }
    }
  ]
}
```

State features: 58 named floats per step (cf. `STATE_FEATURE_NAMES`).
Action features: 58 named floats per step (cf. `ACTION_FEATURE_NAMES`).
The `is_self_turn` slot is overridden per-step with `action.team === 1 ? 0 : 1`
so the dump matches the 116-dim vector NeuralFeatureRanker actually consumed.

`featureSpecHash` is computed at dump time and embedded — downstream
consumers MUST validate it matches their own `computeFeatureSpecHash()`
before reading features by index. Drift detection.

### Drift handling

If a step's `(responseIndex, cardId)` doesn't match any legal action at the
current prompt during replay, the dump truncates at that step (no error
thrown). Indicates the mainPath is non-replayable on a fresh duel — typically
a fixture-specific bug, not a dumper bug.

Empty mainPath → stub file with `trajectory: []`. Useful audit signal
("DFS gave up early"), e.g. `dinomorphia-opener.json` in the corpus.

## Initial corpus

Generated from MLP v3 sd7 weights (canonical Phase B v2) on the 15-fixture
solver-validation set:

```bash
SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 \
  npx tsx scripts/evaluate-structural.ts \
  --budget-ms=6000 --node-budget=400 --pool-size=4 --implicit-goals=10 \
  --label="phase-3-stage-1-corpus" \
  --dump-trajectories=data/trajectories/phase-b-v2-mlpv3-sd7
```

**Aggregate:** 24 / 69 cumulative matched, 505 cum score (consistent with
Phase B v2 reference 22 / 284 cum 14-fix hold-out, +2 with mirrorjade-line
included).

**Corpus stats:**

| Fixture | Steps | Score | Matched | Top-3 verbs |
|---|---:|---:|:-:|---|
| branded-dracotail-opener | 5 | 64 | 3/8 | pass:2, set-st:1, activate:1 |
| branded-dracotail-mirrorjade-line | 3 | 20 | 1/6 | activate:1, pass:1 |
| ddd-pendulum-opener | 7 | 27 | 1/5 | pass:5, activate:2 |
| dinomorphia-opener | 0 | 0 | 0/3 | (empty) |
| floowandereeze-opener | 10 | 32 | 2/4 | pass:5, activate:2 |
| horus-crystron-opener | 24 | 43 | 2/4 | pass:12, activate:5 |
| kashtira-azamina-opener | 10 | 34 | 1/4 | pass:4, activate:2 |
| labrynth-opener | 10 | 16 | 1/4 | pass:5, activate:2 |
| nekroz-ryzeal-opener | 14 | 36 | 1/4 | pass:8, activate:3 |
| radiant-typhoon-opener | 14 | 38 | 2/3 | pass:5, activate:3 |
| ryzeal-mitsurugi-opener | 4 | 58 | 2/5 | pass:2, activate:1 |
| snake-eye-yummy-opener | 22 | 30 | 2/7 | pass:10, activate:2 |
| spright-opener | 7 | 50 | 3/4 | pass:4, set-monster:1, activate:1 |
| stun-runick-opener | 12 | 30 | 2/4 | pass:5, activate:3 |
| tearlaments-opener | 6 | 27 | 1/4 | pass:4, set-monster:1 |

Total: 14 non-empty fixtures × ~10 steps avg = ~140 (state, action) pairs.
Single-corpus size: 19 594 lines (~580 KB total JSON, ~50 KB / fixture avg).

The corpus dir is gitignored (lives under `data/`); regenerate via the
command above.

## Observations from initial corpus

1. **`pass` dominates** — most prompts the DFS encounters during chain
   resolution are SELECT_CHAIN where the optimal action is to pass. Chain
   passes don't reflect the player's strategic intent — they're mechanical
   acceptance of resolved chains. For Phase 4 policy training, we may want
   to filter or down-weight pass actions.

2. **`activate` is the dominant decision verb** — when the DFS does pick a
   non-pass action, it's almost always to activate an effect. This makes
   `activate` a heavily over-represented class in supervised policy training,
   which has implications for class balance.

3. **`(no-verb)` for SELECT_CARD prompts** — actionVerb is `null` for many
   selection prompts (target picker, material selector). These are mid-
   activation choices, not initial verb choices. Phase 4 policy may need a
   second prompt-type-conditioned head.

4. **Step counts vary 3-24** — fixtures where DFS finds a deeper line
   (horus-crystron 24, snake-eye 22) yield richer trajectories. Short-line
   fixtures (branded 5, mitsurugi 4) yield sparse data per fixture but
   higher signal per step.

5. **dinomorphia empty** — DFS produces 0 mainPath steps despite solving
   for 5+ seconds. Same nodesExplored=227 indicates DFS explored but never
   reached a high-value terminal. Possibly a sign that the implicit-goals
   weighting is dominated by the fallback search path. Worth investigating.

## What this enables for Phase 3-4

### Stage 2 — Auto-discovery validation (next, ~5-7d)

Use the corpus to:
1. **Pattern detection** — search for recurring (state-feature, verb)
   sequences across fixtures. e.g., "after a tutor activation, what does
   the solver do next?" Cross-fixture grammar discovery.
2. **Authored vs ML comparison** — for fixtures with hand-authored
   canonical lines (`_bmad-output/planning-artifacts/research/trajectories/
   *-hint.json`), compute edit-distance between authored and dumped
   trajectories. Quantifies "did the ranker learn the human grammar?"
3. **Trajectory inspector tool** — small CLI (~200 LoC) that pretty-prints
   one trajectory step-by-step with state features grouped by axis (A-G).
   Lets a human read what the solver did.

### Stage 3 — Phase 4 policy network MVP (~1-2 weeks)

The corpus is the **training set** for a behavior-cloning policy. The
schema is designed to support that pipeline:
- Input: `stateFeatures` (58 dims) + global context
- Output: action class — could be `actionVerb` for verb-level policy, or
  `cardId` for card-level policy, or hybrid.
- Training data: `(stateFeatures, chosen-actionVerb)` pairs per step,
  filtered/weighted as needed.

A policy-guided DFS would replace the ranker's neural bonus with a
distribution over actions, dramatically narrowing the DFS branching factor.

## Smoke validation performed

- ✅ `npx tsc --noEmit` green after wiring.
- ✅ Single-fixture run on branded-dracotail-opener: 5 steps written,
  state features evolve correctly across steps (hand_combo_potential drops
  as cards are played, axis E counters increment).
- ✅ Full 15-fix corpus dump: all 15 files written, no crashes, aggregate
  matches Phase B v2 reference (24/69 incl mirrorjade-line).
- ✅ Drift detection working: dinomorphia stub written despite empty
  mainPath.

## Out of scope this commit

- Stage 2 corpus analysis (pattern detection, authored-vs-ML comparison) —
  separate session.
- Stage 3 policy network design — separate session.
- Per-step ranker score capture — currently dumps state + action features
  but not the ranker's internal score for each candidate. Would require
  a hook into NeuralFeatureRanker.rank(). Defer until Stage 2 demands it.
- Trajectory dumps for non-best-mainPath candidates — currently dumps only
  the mainPath. Top-K alternatives would help cover decision diversity but
  requires solver tree exposure. Defer.

## Files & references

- Helper + plumbing: `duel-server/scripts/evaluate-structural.ts`
- Worker forward: `duel-server/scripts/evaluate-structural-worker.ts`
- Sample corpus dir (gitignored): `duel-server/data/trajectories/phase-b-v2-mlpv3-sd7/`
- Phase B v2 ship memo: `_bmad-output/solver-data/phase-b/ship-v2-2026-04-27.md`
- Strategic direction memo: `solver-ml-strategic-direction` (memory)
- Feature spec: `duel-server/src/solver/state-feature-extractor.ts`
  (STATE_FEATURE_NAMES + ACTION_FEATURE_NAMES + computeFeatureSpecHash)
