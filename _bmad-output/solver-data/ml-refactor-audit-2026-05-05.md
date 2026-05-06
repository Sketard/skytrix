# ML Layer Refactor Audit — 2026-05-05

## Summary

The ML layer (10 production files, 2.6K LOC) is functionally sound but has **three moderate-severity DRY and composition issues** that will compound as new rankers arrive. The loaders are quasi-identical, decorator stacking is implicit and fragile, and per-solve plumbing is scattered across two wiring points with no consistency check. Together, these increase onboarding friction, bug risk, and maintenance cost without architectural necessity.

---

## Pain Points

### P1: Three Loaders Quasi-Identical (DRY violation, moderate severity)
**Evidence:** 
- `neural-weights-loader.ts:51-122` (72 lines)
- `graph-weights-loader.ts:66-136` (71 lines)  
- `verb-policy-loader.ts:51-122` (72 lines)

**Duplication:** All three follow the same pattern:
1. Lines 2-6 (approx): read env-var enable flag + filename
2. Lines 7-10: check file exists, throw loudly if missing
3. Lines 11-18: JSON parse with try/catch and trace logging
4. Lines 19-25: schema validation (feature-spec hash or weights version)
5. Lines 26-30: trace logging on outcome + console.warn
6. Return the loaded weights

Concrete example (all three are structurally identical):
- `graph-weights-loader.ts:67` vs `neural-weights-loader.ts:54` — both read `SOLVER_*_WEIGHTS` + filename env var
- `graph-weights-loader.ts:76-90` vs `neural-weights-loader.ts:64-78` — both check disabled state then file existence
- `graph-weights-loader.ts:93-117` vs `neural-weights-loader.ts:80-105` — both parse JSON, validate, trace, return

**Why it hurts:**  
A fourth ranker (e.g., attention-weights) will copy this pattern verbatim. Bug fixes (e.g., improved error message, new trace field) must ship in three places. Schema validation logic is duplicated — each loader has its own `validateXxx()` import but calls identical logic (check version string, check array lengths, etc.).

**Refactor cost estimate:** **S** (Small) — extract a generic loader template with schema-validation callback.

---

### P2: Decorator Composition is Implicit & Fragile (architecture, moderate severity)

**Evidence:**  
- `solver-worker.ts:117-168` — boot-time ranker composition
- `evaluate-structural.ts:985-1029` — eval-time composition (nearly identical)

**The problem:**  
The rankers are composed outside-in at boot in this order:
1. Base: `GoldfishChainRanker` 
2. Wrap: `RouteAwareRanker` (expertise-driven move ordering)
3. Wrap: `NeuralFeatureRanker` OR `GraphGuidedRanker` (value bonus) [**mutually exclusive, undeclared**]
4. Wrap: `PolicyGuidedRanker` (verb-class prior, optional)
5. Wrap: `PathBiasedRanker` (path activation bias, optional)

**Implicit orderings & assumptions:**
- Lines 130-143 (solver-worker): `neuralWeights ? ... : tunedWeights ? ... : fallback` — the mutual exclusion is enforced by a ternary, not a schema or interface. A dev unfamiliar with Phase B can easily enable both flags and get silent fallback.
- Lines 117-120 (graph-guided-ranker): `baseRankScale` is read from env **OR** passed via opts. The precedence is opts > env > default. But `NeuralFeatureRanker` (lines 176-181) reads **env only if opts undefined**. **Different precedence!** Graph uses opts as override; neural treats opts as replacement.
- Implicit: Why is `PathBiasedRanker` outermost? It boosts actions by `cardId ∈ pathCards AND ∉ activations`. If it wraps `PolicyGuidedRanker`, path-boosted actions get re-scored by policy. If policy weight is high, does the path bonus still matter? No evidence of this interaction being tested.
- Implicit: `setArchetypeExpertise` is **called directly on `routeAwareRanker` (line 225)**, never delegated through wrappers. Why? Because only `RouteAwareRanker` and `PathBiasedRanker` implement it; `GraphGuidedRanker` and `NeuralFeatureRanker` don't. This is undocumented.

**Why it hurts:**  
- A fifth ranker that depends on `baseRankScale` (like a future ensemble) will have to guess at precedence.
- Mutual exclusion of Neural and Graph is a convention, not a contract. If both flags are set by mistake (e.g., a config deployment error), the behavior is "silent fallback to Graph" with no warning.
- Path bonus composition with Policy is untested. Is the interaction order correct? Should PathBiasedRanker wrap Policy or sit below it?

**Refactor cost estimate:** **M** (Medium) — design a `MLPipelineConfig` interface that declares mutual exclusions, precedence, and composition order explicitly. Validate at boot.

---

### P3: Per-Solve Plumbing Scattered Across Two Wiring Points (consistency risk, moderate severity)

**Evidence:**  
**Solver-worker (`solver-worker.ts:194-231`)**
- Line 199: `neuralRanker.setMetadata(cardMetadata)`
- Line 200-201: `neuralRanker.setMainDeck/setExtraDeck`
- Line 207-209: `policyRanker.setMetadata/setMainDeck/setExtraDeck`
- Line 225: `routeAwareRanker.setArchetypeExpertise`
- Line 230: `pathRanker.setArchetypeExpertise` (optional)
- Line 239: `scorer.setInitialDeckSizes` (not ranker-side)

**Evaluate-structural (`evaluate-structural.ts:585-593`)**
- Lines 585-592: `dfsRanker.setMainDeck/setExtraDeck` (conditionally per `instanceof`)
- Lines 997-1000: `neuralRanker.setMetadata/setInterruptionTags/setInterruptionWeights/setNeuralWeights`
- Lines 1016-1019: `policyRanker.setMetadata/setInterruptionTags/setInterruptionWeights/setVerbPolicyWeights`

**Inconsistencies:**
1. **Missing `setInterruptionTags` in solver-worker** — neural and policy rankers need `interruptionTags` to build `FeatureContext` (see `neural-ranker.ts:186-188`). In solver-worker, this is set at boot (lines 132-133) **before the instance exists**. In evaluate-structural, it's set per-fixture (lines 998-999, 1017-1018). The solver-worker gets away with it because `FeatureContext.rebuildContext()` is called once during boot, but this is fragile — if a fixture changes interruption tags (unlikely but possible in a future feature), solver-worker won't notice.

2. **`setMainDeck/setExtraDeck` dispatch is brittle** — evaluate-structural uses `instanceof` checks (lines 584-593) to dispatch these setters. If `PathBiasedRanker` wraps `PolicyGuidedRanker` wraps `NeuralFeatureRanker`, the outermost check (`PolicyGuidedRanker`) fires and delegates. But what if both PolicyGuidedRanker and NeuralFeatureRanker need to be configured independently? The code assumes `PolicyGuidedRanker.setMainDeck` → `delegateToInner` is sufficient. **This works only because `PolicyGuidedRanker.delegateToInner` uses runtime method lookup** (line 127: `fn.call(this.inner, value)`). If a future ranker doesn't implement `delegateToInner`, this breaks.

3. **No consistency check across rankers** — solver-worker sets metadata on `neuralRanker` if it exists (line 198). Evaluate-structural checks `if (neuralWeights)` (line 995) then sets metadata. Both assume that if neural weights are loaded, the neural ranker instance exists and is ready. But there's no interface asserting this contract.

**Why it hurts:**  
- A new ranker that requires per-fixture state (e.g., opponent-model based) must remember to wire setters in **two places** without guidance.
- The `instanceof` chain in evaluate-structural will fail if a new wrapper is inserted between PolicyGuidedRanker and NeuralFeatureRanker.
- No test ensures solver-worker and evaluate-structural stay in sync.

**Refactor cost estimate:** **M** (Medium) — unify wiring via a `RankerPipeline` class that holds all ranker instances and provides a single `configurePerFixture(metadata, decks, ...)` method. Both callers invoke this one point.

---

## Out-of-`ml/` ML Scaffolding

The scorer side has ML-adjacent code that should be considered for refactoring cohesion:

**`interruption-scorer.ts`** (not in `ml/` folder):
- Lines 90, 155, 183: `pathCardsSet` — Levier B plumbing (Audit #10). Set via `setArchetypeExpertise`, read in `scoreWithCards`. This mirrors the path-ranker's distinct-activation logic but on the scoring side.
- Lines 183, 226-468: `setInitialDeckSizes()` and `pathPoints` computation — Levier D (Design D, 2026-05-02). Resource-pool based bonus. Separate from ranker plumbing but coupled to the solver's per-fixture setup.

**`dfs-solver.ts`** (not in `ml/` folder):
- Line 638, 965: `distinctActivations` is fetched from oracle, then passed to scorer (line 662) **and to ranker** (line 965: `r.setDistinctActivations(distinctActivations)`). The ranker (PathBiasedRanker) reads this per-node to bias actions. The pattern is clean, but it's a form of "per-step ML state" that lives in the solver loop, not the ranker.

**Recommendation:** These are not refactor candidates *now* — they're orthogonal to the loader/decorator/wiring issues. But when you refactor the ML layer, ensure `pathCardsSet` and `distinctActivations` threading is documented and consistent with the new pipeline design.

---

## Additional Findings

### 4. Feature Extraction (`state-feature-extractor.ts`)
- **Size:** 812 lines (largest single ranker file)
- **API cleanliness:** Good. Public API is three functions: `extractStateFeatures()`, `extractActionFeatures()`, `buildFeatureContext()`. Constants (`STATE_DIM`, `ACTION_DIM`, `FEATURE_DIM`) are exported. Hash validation is delegated to callers (`neural-ranker.ts:101`, `verb-policy.ts:65`). No leaks.
- **Versioning:** Hard-fail contract via `computeFeatureSpecHash()` — good practice. Mismatch between train and runtime is explicit error, not silent bug.

### 5. Trained Weights Basenames
- **Graph weights:** Default `tier-a-latest.json` (env override: `SOLVER_TUNED_WEIGHTS_FILE`)
- **Neural weights:** Default `neural-tier-a-latest.json` (env override: `SOLVER_NEURAL_WEIGHTS_FILE`)
- **Verb policy:** Default `verb-policy-latest.json` (env override: `SOLVER_VERB_POLICY_FILE`)
- **No manifest or version field.** Basename is the sole identifier. Graph weights carry a `tier` field and `metadata.bestFitness`. Neural and policy weights carry `metadata` with `trainedAt`, `generations`, etc., but no semantic version. If you regenerate with a breaking change (e.g., new features), you must manually rename files. No content-hash or schema-version collision detection.

### 6. Mutual Exclusion Policy
- `SOLVER_USE_NEURAL_WEIGHTS=1` vs `SOLVER_USE_TUNED_WEIGHTS=1`: Neural wins (both loaders run; neural is picked in conditional). No warning if both are set. Reason given in comments: "Phase B design doc §2" — not recorded in code.
- `SOLVER_USE_VERB_POLICY=1` is independent (compatible with neural and graph).
- `SOLVER_USE_PATH_RANKER=1` is independent (compatible with all).

### 7. Environment Variable Inventory (ML layer + wiring)

| Env Var | Reader | Default | Effect |
|---------|--------|---------|--------|
| `SOLVER_USE_TUNED_WEIGHTS` | graph-weights-loader:67 | unset → disabled | Load graph-ml-v1 weights |
| `SOLVER_TUNED_WEIGHTS_FILE` | graph-weights-loader:68 | `tier-a-latest` | Basename for graph weights |
| `SOLVER_GRAPH_SCALE` | graph-guided-ranker:113 | 100 | Bonus scale for graph edges |
| `SOLVER_USE_NEURAL_WEIGHTS` | neural-weights-loader:54 | unset → disabled | Load neural-ml-v2 weights |
| `SOLVER_NEURAL_WEIGHTS_FILE` | neural-weights-loader:55 | `neural-tier-a-latest` | Basename for neural weights |
| `SOLVER_NEURAL_BONUS_SCALE` | neural-ranker:181 | 100 | Bonus scale for neural forward pass |
| `SOLVER_BASE_RANK_SCALE` | all 4 rankers | 30 | Soft-bias additive per-position cost |
| `SOLVER_POLICY_BASE_RANK_SCALE` | policy-guided-ranker:84 | 30 | Override for policy only |
| `SOLVER_POLICY_BIAS_SCALE` | policy-guided-ranker:87 | 100 | Bonus scale for policy softmax |
| `SOLVER_USE_VERB_POLICY` | verb-policy-loader:54 | unset → disabled | Load verb-class policy |
| `SOLVER_VERB_POLICY_FILE` | verb-policy-loader:55 | `verb-policy-latest` | Basename for policy weights |
| `SOLVER_PATH_RANKER_W` | path-biased-ranker:67 | 50 | Path bias magnitude |
| `SOLVER_USE_PATH_RANKER` | solver-worker:165, evaluate-structural:1026 | unset → disabled | Enable path-biased ranker |

**Finding:** `SOLVER_BASE_RANK_SCALE` is used by four rankers but only overridable as a whole. Policy has its own `SOLVER_POLICY_BASE_RANK_SCALE` (which overrides the base if set). This is a sharp edge: if you want to tune graph and neural independently, you cannot — they both read the same env var (unless you rebuild).

### 8. Tests
- No unit tests found in `src/solver/ml/` or `src/solver/`. ML rankers are integration-tested only via `evaluate-structural.ts`.

---

## Refactor Proposal Sketch

### Option A: Moderate (3-5 days)
**Extract a generic weight loader template:**
Create `src/solver/ml/weight-loader-base.ts` with a generic loader function. Three loaders become instantiations with their validation function. Saves ~150 lines, centralizes error handling and trace logic.

**Unify per-solve wiring:**
Create `src/solver/ml/ranker-pipeline.ts` with a `RankerPipeline` class. Both solver-worker and evaluate-structural instantiate it once, then call `configurePerFixture` per solve. Eliminates the `instanceof` chain and centralizes wiring logic.

**Cost:** ~150 LOC new shared infra, ~100 LOC removed duplication, ~1-2 day integration.

### Option B: Comprehensive (7-10 days)
**Option A + formal ranker composition:**
Define `ComposableRanker` interface with `delegateToInner()`. Enforce composition order via `MLPipelineConfig` schema. Validate mutual exclusions at boot, not runtime. Constructor throws if config is invalid.

**Cost:** ~300 LOC new types + runtime validation, ~50 LOC removed conditionals, ~3-4 day refactor + testing.

---

## What's Actually Fine (Don't Touch)

1. **Soft-bias additive ranking discipline** — all rankers use the same `(N - i) × baseRankScale + bonus` formula. Clean, consistent, allows composition. **Keep as-is.**

2. **Feature extraction & hashing** — `state-feature-extractor.ts` has a solid public API and hard-fail version contract. The 812 lines are necessary complexity. **Keep as-is.**

3. **Per-ranker tracking (neural, graph, policy)** — each ranker has optional tracking for diagnostics. Kept private, toggleable. Clean. **Keep as-is.**

4. **Evaluation script** — `evaluate-structural.ts` correctly wires rankers per-fixture. The `instanceof` pattern is fragile but works. Only refactor if Option B happens; else leave it.

5. **Loader error handling** — loud failure when enabled but missing/malformed is the right call (caught Phase B's wiring bug earlier). **Keep as-is.**

---

## Risk Assessment

**If left unchanged:**
- Onboarding a 5th ranker type: +2–3 hours to understand dual-wiring pattern, copy loader boilerplate, remember `instanceof` checks.
- Debugging mutual exclusion bugs: 2–3 hours (silent fallback confuses ownership).
- Adding a new per-solve state requirement: risk of inconsistency between two wiring points.

**Overall:** Not critical (system works), but friction compounds quickly. Recommend **Option A** in next planning cycle (low-cost, high-payoff DRY win).
