# Phase 7 — decisionHints Population

**Date:** 2026-05-01
**Companion to:** [prompt-resolver-refactor-2026-05-01.md](prompt-resolver-refactor-2026-05-01.md) §7
**Status:** SHIPPED 2026-05-01
**Pinned commit at audit start:** `4f8...` (Phase 6 ship — see git log)

## Goal (revised post-Phase 6 reality)

The original Phase 7 gate ("DFS-solver standalone reaches Path β-1 levels on prompt-local decisions, e.g. snake-eye 4/7 via SELECT_YESNO override") was empirically falsified during authoring. Phase 7 ships **mechanism validation across multiple decks** instead — every authored hint loads, fires on the expected `(sourceCardId, promptType)`, and never breaks the bit-exact β-1 baselines.

The trajectory-level gap between DFS-standalone and β-1 is owned by the scorer/ranker myopia, not by the prompt-resolver refactor. That gap is the territory of Phase B / graph-ml-v2 / scorer redesign.

## Authored hints

| File | sourceCardId | Card | Prompt | Policy | Source | Confidence | Status |
|---|---|---|---|---|---|---|---|
| `snake-eye.json` | 53639887 | Divine Temple of the Snake-Eye | SELECT_YESNO | yes | manual | observed | functional override (extracted from commit 513446af hardcoded plan-side override) |
| `branded.json` | 75003700 | Dracotail Lukias | SELECT_EFFECTYN | yes | manual | observed | default-aligned, documentary |
| `branded.json` | 73819701 | Fallen of the White Dragon | SELECT_EFFECTYN | yes | manual | observed | default-aligned, documentary |

## Bit-exact gate

3 β-1 baselines (snake-eye, branded, ddd) reproduce **byte-identically** with `SOLVER_USE_PROMPT_RESOLVER=1` and the new hints loaded:

```bash
diff <(tr -d '\r' < phase-1-baselines/plan-replay/snake-eye-yummy-opener.trace.jsonl) \
     <(tr -d '\r' < tmp-snake.trace.jsonl) | wc -l
# → 0
diff <(tr -d '\r' < phase-1-baselines/plan-replay/branded-dracotail-opener.trace.jsonl) \
     <(tr -d '\r' < tmp-branded.trace.jsonl) | wc -l
# → 0
diff <(tr -d '\r' < phase-1-baselines/plan-replay/ddd-pendulum-opener.trace.jsonl) \
     <(tr -d '\r' < tmp-ddd.trace.jsonl) | wc -l
# → 0
```

All 5 smoke test suites stay green: 22+36+15+31+19 = **123/123**.

## Empirical findings

### 1. Functional override mechanism validated

The Divine Temple hint is the canonical test. The hint authored externalises the hardcoded `targets: [{responseIndex: 1}]` from `beta1v2-yesno-best-plan.json` step 3. With the hint loaded:

- DFS-standalone visits the SELECT_YESNO Divine Temple prompt 8+ times during exploration
- `CardExpertiseOracle` resolves each visit to `responseIndex: 1` (YES) via `policy: 'yes'`
- Empirically verified via temporary `SOLVER_DUMP_PHASE7=1` instrumentation (since removed)

In β-1 plan-replay mode, the pass-through guard (`pendingTargetWouldMatch`) makes the hint inert: the plan's explicit `responseIndex: 1` target matches the legal pool → CardExpertise PASS → PlanTargetOracle wins with the same response. Bit-exact preserved.

### 2. DFS-standalone matched score: not affected

Despite the hint firing 8+ times in DFS-standalone, `matched=2/7 score=36.57` is identical to the no-resolver baseline. The hint correctly applies, but the DFS scorer/ranker prefers a different terminal trajectory (Silhouhatte+Azurune set+end-phase) over the partial Divine-Temple branches it can fit in 400 nodes / 6s.

This is the predicted "scorer structural-proxy bias" plateau (memo `branded-dracotail-hint-audit-2026-04-26`). A single prompt-local hint cannot redirect DFS when the scorer/ranker myopically prefers an alternative branch. SELECT_IDLECMD (the strategic decisions that gate the Divine Temple branch — NS Ash, Almiraj Link, Activate DT) is Tier 4 in the Phase 6 coverage matrix ("no source by construction") and cannot be hinted.

### 3. Default-aligned hints are documentary

The two branded hints (Lukias EFFECTYN=yes, FoWD EFFECTYN=yes) are default-aligned: the existing `PlanTargetOracle` falls back to `responseIndex: 1` (YES) on SELECT_EFFECTYN when no plan target matches. Adding a hint with `policy: 'yes'` produces the same response.

Value of these hints:
- **documents expected behavior** explicitly in deck-specific JSON
- **demonstrates multi-deck loading**: 4 expertise files (snake-eye, branded, ryzeal, mitsurugi) loaded simultaneously, hint dispatch finds the right one per `sourceCardId`
- **proves hint authoring doesn't require a delta from default** — provenance metadata captures intent regardless

Future evolution: if a card's correct policy diverges from the default (e.g. an EFFECTYN that should be NO to preserve OPT), changing the policy in the JSON updates behavior without a code change. The documentary entries are the canonical place for that future audit work.

## Plumbing fix

`evaluate-structural.ts` was missing `adapter.setArchetypeExpertise(filteredExpertise)` — Phase 5 plumbed `solver-worker.ts` (the production solver path) but the eval harness was never updated. Without this fix, `CardExpertiseOracle` never sees `decisionHints` during `evaluate-structural` runs (DFS-standalone path).

The fix mirrors `solver-worker.ts:217` verbatim, gated on the same `SOLVER_DISABLE_EXPERTISE` env var. No bit-exact impact on β-1 or smoke tests (those don't use `evaluate-structural`).

## What Phase 7 delivers

1. **Mechanism validated end-to-end on 2 decks** — sourceCardId resolution → hint loading → CardExpertiseOracle dispatch → bit-exact preservation. Confirmed via empirical instrumentation + 0-line diffs on 3 β-1 baselines.
2. **Hardcoded SELECT_YESNO override (commit 513446af) externalised** to `snake-eye.json`. The hardcoded fallback in `replay-trajectory-cli.ts` is now redundant: when both the hint and the plan target are present, the pass-through guard ensures the plan target wins (preserving bit-exact); when only the hint is present (DFS-standalone), it produces the correct response. Note: the legacy plan-side override mechanism (`SUB_PROMPT_PICKABLE` set) stays in place — it's the parity path for plans without expertise, and CardExpertise's pass-through guard is built around it.
3. **Plumbing fix** for `evaluate-structural.ts` so `decisionHints` are consumable in eval mode.
4. **Documentary hints** on branded — pattern for future authoring without breaking changes.
5. **Provenance metadata format proven** in production: `_source / _confidence / _authored / _rationale` survive the loader's forward-compatible warn-don't-reject discipline (memo Q4).

## What Phase 7 does NOT deliver

1. **DFS-standalone does not reach β-1 levels via hints alone.** The original Phase 7 gate was over-optimistic. snake-eye 4/7 in DFS-standalone is gated by SELECT_IDLECMD (uncoverable) + scorer myopia (out of refactor scope), not by SELECT_YESNO resolution.
2. **No automated capture-and-extract tooling** — the design doc mentioned "Capture tooling extracts overrides from existing β-1 plans". Manual authoring + empirical sourceCardId verification was sufficient for the 3 hints shipped; tooling deferred until the hint count justifies it.
3. **No coverage on ddd/mitsurugi** — ddd has no archetype-expertise file, mitsurugi is β-3 raw-replay where no SELECT_EFFECTYN/YESNO/POSITION targets are explicit in the trajectory. Adding hints there would be pure documentation without behavior change. Deferred.

## Acceptance criteria status

From design doc §"Acceptance criteria":

| # | Criterion | Status |
|---|---|---|
| 1 | Single decision path | ✅ achieved Phase 3-4 |
| 2 | Bit-exact preservation | ✅ 3 β-1 baselines byte-identical with hints loaded |
| 3 | Coverage matrix published | ✅ phase-6-coverage-matrix-2026-05-01.md |
| 4 | Expertise schema documented | ✅ provenance metadata format proven on 3 hints |
| 5 | No speculative defaults | ✅ MechanicalDefaultOracle migration is verbatim |
| 6 | Decision graph documented | ⚠️ implicit in chain compositions table, no per-OcgMessageType matrix authored. **Acceptable gap**: the chain compositions in the design doc § "Chain compositions" + the per-oracle specs in §"Per-oracle specifications" together name which oracle handles each prompt type. A separate generated table is deferred. |

## Future work

- **graph-ml-v2 / Phase B scorer redesign** — the path to lifting DFS-standalone above current ceilings. Out of resolver-refactor scope.
- **Path β-driven hint extraction** — when LLM subagents discover deck-specific overrides at scale, an extract-to-decisionHints tool (mentioned in the design doc) becomes the natural automation. Current ratio (1 functional hint discovered in 2 sprints of Path β work) doesn't justify the tooling yet.
- **`SUB_PROMPT_PICKABLE` deletion** — once enough hints are authored that `SELECT_YESNO/EFFECTYN` overrides always come through `decisionHints`, the explicit `SUB_PROMPT_PICKABLE.add('SELECT_YESNO')` from commit 513446af becomes dead code. Removal requires authoring hints on every fixture using a non-default response, which is a larger-scope follow-up.
