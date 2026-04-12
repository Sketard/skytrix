---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
documents:
  prd: prd-solver.md
  architecture: architecture-solver.md
  epics: epics-solver.md
  ux: ux-design-specification-solver.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-04-06
**Project:** skytrix — Solver Module

> **Supersession note (2026-04-12):** Findings #58, #69, and related IS-MCTS tuning items in this report (determinization defaults, IS-MCTS Fast mode convergence) are **obsolete**. The adversarial algorithm was refactored from IS-MCTS to Minimax MCTS post-Epic 2 implementation, removing determinization entirely. The refactor is documented in `epics-solver.md` §"Epic 2 Algorithm Refactor: IS-MCTS → Minimax MCTS (2026-04-12)" and in the Story 2.1 change log. IR report entries are retained for historical traceability only — do not treat them as current architecture.

## Document Inventory

| Document Type | File | Format |
|---|---|---|
| PRD | prd-solver.md | Whole |
| Architecture | architecture-solver.md | Whole |
| Epics & Stories | epics-solver.md | Whole |
| UX Design | ux-design-specification-solver.md | Whole |

**Issues:** None — all 4 required documents found, no duplicates.

## PRD Analysis

### Functional Requirements

| ID | Requirement |
|---|---|
| FR1 | Player can select an existing deck as solver input |
| FR2 | Player can define a fixed hand (1–5 chosen cards) or request a random hand (Fill Random completes to 5) |
| FR3 | Player can choose solve mode: Goldfish (no interaction) or Adversarial (with handtraps) |
| FR4 | Player can choose solve speed: Fast (time-bounded) or Optimal (exhaustive) |
| FR5 | Player can select adverse handtraps from a predefined list (Ash Blossom, Nibiru, Effect Veiler, Maxx "C", Infinite Impermanence) |
| FR6 | Player can launch a solve on the chosen configuration |
| FR7 | System explores all legal game actions from any game state to find optimal combo paths |
| FR8 | System supports at least 2 swappable exploration algorithms (DFS + SP-MCTS) |
| FR9 | System parallelizes exploration via a dedicated worker pool (separate from duel workers) |
| FR10 | System forks duel state to explore alternative branches |
| FR11 | System detects and cuts infinite loops (max depth + legal action hash) |
| FR12 | System avoids re-exploring equivalent game states reached via different action orderings |
| FR13 | In Adversarial mode, system models a virtual opponent who activates handtraps at the optimal timing to maximize disruption |
| FR14 | Player can see solve progress in real-time (nodes explored, current best score) |
| FR15 | Player can cancel a running solve |
| FR16 | System returns the best result found at any time (anytime behavior), even if solve is cancelled or timed out |
| FR17 | System returns an interactive decision tree as the primary result |
| FR18 | Player can see the recommended main path via a breadcrumb at the top of the result |
| FR19 | Player can expand/collapse decision tree branches |
| FR20 | Each tree node displays the action performed with an enriched annotation (card name + complete action description) |
| FR21 | Each tree leaf displays a contextualized score (number of interruptions with detail by type: omni-negate, targeted negate, destruction, bounce, floodgate) |
| FR22 | In Adversarial mode, tree displays handtrap branches annotated with the handtrap and its activation timing |
| FR23 | System displays a global resilience score (worst-case minimax) for Adversarial mode |
| FR24 | Tree is pruned for readability: top-X branches per node (X configurable via server JSON) |
| FR25 | System returns a "no viable combo" diagnostic when no path leads to a board with at least 1 interruption |
| FR26 | Player can consult previous solve results from their session (client-side in-memory history) |
| FR27 | System evaluates final board quality via weighted scoring by interruption type |
| FR28 | Weights per interruption type are configurable via server JSON (omni-negate > targeted negate > destruction > bounce > floodgate) |
| FR29 | System reads interruption tags from a JSON file mapping each end-board card to its type, weight, and uses/turn |
| FR30 | Interruption database is pre-filled with top 50 meta end-board cards |
| FR31 | Player can launch a "verify" mode that replays the recommended line with a handtrap at the declared timing and confirms the result |

**Total FRs: 31**

### Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR1 | Performance | Fast mode returns a result in < 5 seconds on reference hardware (8-core dev server) |
| NFR2 | Performance | Optimal mode returns a result in < 60 seconds on reference hardware |
| NFR3 | Performance | WS progress messages arrive with latency < 100ms |
| NFR4 | Performance | Initial decision tree render (50 nodes) displays in < 500ms |
| NFR5 | Performance | Branch expand/collapse animates in < 50ms |
| NFR6 | Performance | Solver page reaches time-to-interactive in < 1 second (lazy-loaded) |
| NFR7 | Performance | Solver completes in < 60s Optimal for top 20 meta decks (deferred post-MVP, initial validation manual against 5 meta decks) |
| NFR8 | Reliability | Solver always terminates — max depth (50 actions) + loop detection (Zobrist hash) |
| NFR9 | Reliability | If WASM snapshot fails, system automatically falls back to replay-from-scratch with visible WARNING log |
| NFR10 | Reliability | Smoke test at duel-server boot verifies WASM Memory hook works and logs status |
| NFR11 | Reliability | Solver pool uses at most N configurable workers, leaving minimum 2 cores for duel-server + event loop |
| NFR12 | Data Integrity | Every returned sequence is 100% legal — solver verifies as integrated post-condition (replay on OCGCore) before returning |
| NFR13 | Data Integrity | Golden test suite (30 hand-verified hands) passes with 100% concordance after every solver change |
| NFR14 | Data Integrity | Handtrap results validated by manual cross-check for each golden suite hand at initial validation and after major algorithm changes |
| NFR15 | Data Integrity | Exact version of @n1xx1/ocgcore-wasm is pinned in package.json (no ^ range) |
| NFR16 | Resource Mgmt | Solver pool consumes at most a configurable memory budget (default: 512MB), warning logged at 80% |
| NFR17 | Resource Mgmt | Each solve is logged: nodes explored, final score, total time, algorithm, mode, deck ID |

**Total NFRs: 17**

### Additional Requirements

- **Constraints:** Brownfield — must extend existing Angular 19 + Spring Boot + Node.js duel-server stack, no new deps
- **Technical:** Strategy pattern required for algorithm swapping (DFS + SP-MCTS minimum)
- **Technical:** WASM snapshot for state forking (10ms validated), automatic fallback to replay
- **Technical:** Dedicated worker pool in duel-server (separate from duel workers)
- **Validation:** Golden test suite (30 hands: 15 combo-able, 15 bricks), 100% concordance
- **Validation:** Meta deck coverage target (top 20, < 60s Optimal) — deferred post-MVP

### PRD Completeness Assessment

The PRD is thorough and well-structured. 31 FRs cover the full lifecycle (config → execution → progress → results → scoring → validation). 17 NFRs address performance, reliability, data integrity, and resource management with measurable targets. User journeys map cleanly to capabilities. Risk mitigation table is comprehensive. POC data provides validated technical baselines. Phase 2/3 scope is clearly deferred.

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD Requirement | Epic Coverage | Status |
|---|---|---|---|
| FR1 | Deck selection | Epic 1 (Story 1.5b) | ✓ Covered |
| FR2 | Hand definition (fixed/random) | Epic 1 (Story 1.5b) | ✓ Covered |
| FR3 | Solve mode: Goldfish/Adversarial | Epic 1 (goldfish) + Epic 2 (adversarial) | ✓ Covered |
| FR4 | Solve speed: Fast/Optimal | Epic 1 (Story 1.5b) | ✓ Covered |
| FR5 | Handtrap selection | Epic 2 (Story 2.2) | ✓ Covered |
| FR6 | Launch solve | Epic 1 (Story 1.5b) | ✓ Covered |
| FR7 | Legal action exploration | Epic 1 (Story 1.2) | ✓ Covered |
| FR8 | 2 algorithms (DFS + MCTS) | Epic 1 (Story 1.2 + 1.7) | ✓ Covered |
| FR9 | Worker pool parallelism | Epic 1 (Story 1.3) | ✓ Covered |
| FR10 | State forking | Epic 1 (Story 1.1) | ✓ Covered |
| FR11 | Loop detection | Epic 1 (Story 1.2) | ✓ Covered |
| FR12 | Transposition (avoid re-exploring) | Epic 1 (Story 1.2) | ✓ Covered |
| FR13 | Adversarial handtrap modeling | Epic 2 (Story 2.1) | ✓ Covered |
| FR14 | Real-time progress | Epic 1 (Story 1.5b) | ✓ Covered |
| FR15 | Cancel solve | Epic 1 (Story 1.5b) | ✓ Covered |
| FR16 | Anytime behavior | Epic 1 (Story 1.2/1.3) | ✓ Covered |
| FR17 | Decision tree result | Epic 1 (Story 1.6b) | ✓ Covered |
| FR18 | Breadcrumb main path | Epic 1 (Story 1.6b) | ✓ Covered |
| FR19 | Expand/collapse branches | Epic 1 (Story 1.6b) | ✓ Covered |
| FR20 | Enriched annotations | Epic 1 (Story 1.6b) | ✓ Covered |
| FR21 | Contextualized score | Epic 1 (Story 1.6a) | ✓ Covered |
| FR22 | Handtrap branch annotations | Epic 2 (Story 2.3) | ✓ Covered |
| FR23 | Global minimax resilience score | Epic 2 (Story 2.3) | ✓ Covered |
| FR24 | Tree pruning (top-X) | Epic 1 (Story 1.3) | ✓ Covered |
| FR25 | Brick diagnostic | Epic 1 (Story 1.6a) | ✓ Covered |
| FR26 | Session history (data + UI) | Epic 3 (Story 3.1 + 3.1b) | ✓ Covered |
| FR27 | Weighted scoring | Epic 1 (Story 1.2) | ✓ Covered |
| FR28 | Configurable weights | Epic 1 (Story 1.1) | ✓ Covered |
| FR29 | Interruption tags JSON | Epic 1 (Story 1.1) | ✓ Covered |
| FR30 | Pre-filled 50 meta cards | Epic 1 (Story 1.2) | ✓ Covered |
| FR31 | Verify mode (replay with handtrap) | **NOT FOUND** | ❌ MISSING |

### Missing Requirements

#### Critical Missing FRs

**FR31:** Player can launch a "verify" mode that replays the recommended line with a handtrap at the declared timing and confirms the result.
- **Impact:** This is the only user-facing validation mechanism — without it, players must trust solver results without being able to independently verify. It closes the "trust but verify" loop described in J2 resilience.
- **Recommendation:** Either add a Story in Epic 2 (handtrap-related) or create a new Epic 4 for verification features. Alternatively, if FR31 is intentionally deferred post-MVP, it should be explicitly marked as deferred in the PRD.

### Coverage Statistics

- Total PRD FRs: 31
- FRs covered in epics: 30
- FRs missing from epics: 1 (FR31)
- Coverage percentage: **96.8%**

## UX Alignment Assessment

### UX Document Status

**Found:** `ux-design-specification-solver.md` — comprehensive UX spec covering layout, components, interactions, accessibility, user journeys, and emotional design.

### UX ↔ Epics Divergences (Replay-Aligned Corrections)

The Epics document contains an "Additional Requirements from UX (with replay-aligned corrections)" section that intentionally overrides several UX Design decisions to align with existing replay mode patterns. These corrections are documented in the Epics but NOT reflected back into the UX spec, creating a source-of-truth conflict.

| Topic | UX Spec Says | Epics Override | Impact |
|---|---|---|---|
| **Layout** | Sidebar 280px fixed + fluid result area | Full-viewport like replay. Config panel horizontal at top, collapsible after first solve | **HIGH** — fundamentally different page structure. Implementer must know Epics take precedence |
| **Progress indicator** | `mat-progress-bar` indeterminate | `mat-progress-spinner` indeterminate (replay pattern) + progressive text | LOW — component swap |
| **Error handling** | `mat-snackbar` via `displayError()`, NO auto-dismiss, user must click "Dismiss" | `NotificationService.error()` with standard 4s auto-dismiss (replay pattern) | **MEDIUM** — different user behavior for critical errors |
| **Pin scoping** | Scoped per deck (hidden on deck switch, restored on return) + "comparison pin" (star icon, cross-deck banner, max 1) | Flat list visible across decks, each pin card shows deck name. No comparison pin, no hide/restore | **MEDIUM** — simpler but loses cross-deck comparison pin feature |
| **Service scoping** | SolverService `providedIn: 'root'` for WS + history | WS connection + adapter component-scoped (replay pattern). Session history signal in root-scoped SolverService | LOW — architectural detail |

**Recommendation:** The Epics corrections are intentional and well-reasoned (replay consistency). The UX spec should be updated to reflect these corrections to avoid confusing implementers who read the UX spec first.

### UX ↔ Architecture Divergences

| Topic | UX Spec | Architecture | Impact |
|---|---|---|---|
| **WS message types** | Not specified (UX concern boundary) | 6 message types. Architecture says 4 error types; Epics expand to 6 (add RATE_LIMITED, MEMORY_LIMIT) | LOW — Architecture doc should be updated to include the 2 additional error types |
| **Logging** | Not specified | Architecture says `console.log/warn/error` with `[Solver]` prefix; Epics say `logger.forSolve(solveId)` and `slog.debug()` | **MEDIUM** — contradictory logging patterns between Architecture and Epics |
| **Server result resilience** | "server keeps last result per userId, resends on WS reconnect" | Not mentioned in Architecture or Epics | **MEDIUM** — UX assumes reconnection behavior that is not architecturally planned |

### UX ↔ PRD Alignment

| Topic | Status | Detail |
|---|---|---|
| All 3 user journeys | ✓ Aligned | UX flows map exactly to PRD J1/J2/J3 |
| FR coverage in UX | ✓ Complete | All FRs 1-31 have UX treatment (including FR31 verify — not in Epics but architecturally supported) |
| NFR performance targets | ✓ Aligned | < 10s readability, < 500ms tree render, < 50ms expand all match |
| Desktop-only constraint | ✓ Aligned | UX spec explicitly states desktop-first, < 1024px message |
| 5 handtraps | ✓ Aligned | Same 5 handtraps in PRD, UX, and Architecture |

### Warnings

1. **Source-of-truth conflict on layout:** The Epics override the UX sidebar layout with a full-viewport horizontal config panel. This is the single most impactful divergence — it changes the entire page structure. **Resolution needed: which document is authoritative for layout?**

2. **FR31 verify mode:** Architecturally supported (verifyPath field in SOLVER_START), UX-designed (verify button in config), but **missing from Epics** — no story implements it.

3. **Comparison pin feature dropped:** UX spec describes a "comparison pin" (star icon, cross-deck banner) that the Epics silently remove. This was a key UX innovation for Journey 3. **Intentional simplification or oversight?**

4. **Server result resilience:** UX assumes the server caches the last result per user and resends on WS reconnect. Neither Architecture nor Epics implement this. If the user disconnects during a solve, the result may be lost.

5. **Error handling philosophy divergence:** UX explicitly says "no auto-dismiss for critical errors" with rationale ("Critical errors must not disappear unnoticed"). Epics override with 4s auto-dismiss. These represent different UX philosophies — the implementer needs a clear decision.

## Epic Quality Review

### Best Practices Compliance

#### Epic 1: Goldfish Combo Discovery

| Criterion | Status | Notes |
|---|---|---|
| Delivers user value | ✓ | Full vertical slice: user selects deck/hand → launches solve → sees result |
| Can function independently | ✓ | Complete goldfish solver end-to-end |
| Stories appropriately sized | ⚠️ | Story 1.2 is very large (DFS + scoring + Zobrist + transposition + 50-card data file) |
| No forward dependencies | ✓ | No story references future Epics |
| Clear acceptance criteria | ✓ | All ACs in Given/When/Then, specific types and ranges |
| FR traceability | ✓ | 25 FRs mapped |

#### Epic 2: Handtrap Resilience Analysis

| Criterion | Status | Notes |
|---|---|---|
| Delivers user value | ✓ | User tests deck resilience against handtraps |
| Can function using Epic 1 output | ✓ | Extends goldfish engine with adversarial mode |
| Stories appropriately sized | ✓ | 3 well-scoped stories (engine, UI, result display) |
| No forward dependencies | ✓ | |
| Clear acceptance criteria | ✓ | Detailed ACs with adversarial-specific behavior |
| FR traceability | ✓ | 4 FRs mapped |

#### Epic 3: Iterative Build Comparison

| Criterion | Status | Notes |
|---|---|---|
| Delivers user value | ✓ | User iterates rapidly and compares builds |
| Can function using Epic 1 & 2 output | ✓ | Works with Epic 1 alone; adversarial pins use Epic 2 |
| Stories appropriately sized | ✓ | 4 focused stories |
| No forward dependencies | ✓ | |
| Clear acceptance criteria | ✓ | |
| FR traceability | ⚠️ | Only FR26 explicitly mapped. Story 3.2 (Pin), 3.3 (Quick Solve/Keyboard), 3.4 (Export) have no explicit FR reference — they are UX/velocity features |

### Epic Independence Validation

```
Epic 1: Standalone ✓ — Full goldfish solver, no external dependencies
Epic 2 → Epic 1: ✓ — Extends goldfish engine/UI with adversarial mode
Epic 3 → Epic 1 (+ optionally Epic 2): ✓ — Pins/history work with goldfish results
```

No circular dependencies. No forward dependencies (Epic N never requires Epic N+1). Correct dependency chain.

### Story Dependency Analysis

**Epic 1 — Story Order:**
```
1.1 (Types/Config/Oracle)
  └→ 1.2 (DFS/Scoring) — depends on 1.1 types + GameOracle
       └→ 1.3 (Worker Pool) — depends on 1.2 strategy
            └→ 1.4 (WS Protocol) — depends on 1.3 orchestrator
                 └→ 1.5a (Route/Page/Service) — depends on 1.4 WS types
                      ├→ 1.5b (Config/Progress UI) — depends on 1.5a scaffold
                      ├→ 1.6a (Hero/Brick) — depends on 1.5a result area
                      └→ 1.6b (Breadcrumb/Tree) — depends on 1.5a result area
  └→ 1.7 (MCTS/Auto) — depends only on 1.1 (GameOracle + strategy interface)
```

No forward dependencies within Epic 1. Stories 1.5b, 1.6a, 1.6b can be parallelized after 1.5a. Story 1.7 is independent of 1.2-1.6 (only needs 1.1 interfaces).

**Epic 2 — Story Order:**
```
2.1 (Adversarial Engine) — depends on Epic 1 (GameOracle, MCTS strategy)
  └→ 2.2 (Handtrap UI) — depends on Epic 1 config component
       └→ 2.3 (Result Display) — depends on 2.1 + Epic 1 result components
```

**Epic 3 — Story Order:**
```
3.1 (Session History) — depends on Epic 1 SolverService
3.2 (Pin & Compare) — depends on 3.1 signals
3.3 (Quick Solve/Keyboard) — depends on Epic 1 config component (parallel with 3.1)
3.4 (Export) — depends on Epic 1 result display (parallel with 3.1)
```

### Quality Violations Found

#### 🟠 Major Issues

**1. Story 1.2 is oversized (multiple concerns bundled)**

Story 1.2 "DFS Solver & Interruption Scoring" bundles 4 distinct concerns:
- DFS exploration algorithm with depth limit
- Zobrist hashing with dual 32-bit, incremental, crypto PRNG pre-generation
- Transposition table with verification key, replacement policy, bounded size
- Interruption scoring system with 15 types + fallback heuristic + 50-card data file

Each of these is a substantial module with its own ACs (the story has 13 AC blocks). This exceeds typical story sizing and makes it harder for an AI agent to implement in one pass.

**Recommendation:** Split into 3 stories: 1.2a (Zobrist + Transposition), 1.2b (Interruption Scorer + Tags Data), 1.2c (DFS Algorithm). This maintains the dependency chain and reduces cognitive load per story.

**2. Stories 1.1-1.4 have zero direct user value**

The first 4 stories in Epic 1 are pure backend infrastructure: types, oracle, worker pool, WS protocol. No user can do anything after these 4 stories are implemented. This is technically a "technical milestone" anti-pattern.

**Mitigating context:** The Epics document explicitly adopts "big bang" testing — stories produce compilable, architecture-compliant code, and end-to-end functionality is expected only at epic completion. For a solo dev (Axel) on a brownfield project, this is pragmatic. The Epic delivers user value as a unit, even if individual stories don't.

**Verdict:** Acknowledged but acceptable given the declared "big bang" approach.

**3. FR3 partial coverage**

FR3 ("Player can choose solve mode: Goldfish or Adversarial") is split across Epic 1 (goldfish only) and Epic 2 (adversarial). This means FR3 is NOT fully covered until Epic 2 is complete. The coverage map marks it as "Epic 1 (goldfish) + Epic 2 (adversarial)".

**Verdict:** Acceptable — Adversarial is an intentional increment, and Epic 1 delivers a complete goldfish experience. But the coverage map should note that FR3 is partially covered in Epic 1.

#### 🟡 Minor Concerns

**4. Epic 3 FR traceability is weak**

Epic 3 maps only FR26 (session history). Stories 3.2 (Pin), 3.3 (Quick Solve/Keyboard), 3.4 (Export) have no explicit FR mapping — they are UX/velocity features that emerged from UX design, not PRD requirements. This is legitimate (UX can add features beyond PRD), but the gap in traceability should be acknowledged.

**5. Story 3.4 (Export to Clipboard) introduces deckSeed input**

Story 3.4 AC introduces a "Deck Seed" input field in the config panel + deckSeed in SOLVER_START. This is a feature addition that modifies Story 1.5b's config component scope. The dependency should be explicit.

**6. Logging pattern inconsistency**

Architecture says `console.log/warn/error` with `[Solver]` prefix. Epics Stories 1.3 and 1.4 reference `logger.forSolve(solveId)` and `slog.debug()`. These are different logging approaches — the implementer needs to know which is authoritative.

### Best Practices Compliance Checklist Summary

| Practice | Epic 1 | Epic 2 | Epic 3 |
|---|---|---|---|
| Epic delivers user value | ✓ | ✓ | ✓ |
| Epic can function independently | ✓ | ✓ (needs E1) | ✓ (needs E1) |
| Stories appropriately sized | ⚠️ 1.2 oversized | ✓ | ✓ |
| No forward dependencies | ✓ | ✓ | ✓ |
| Clear acceptance criteria | ✓ | ✓ | ✓ |
| FR traceability maintained | ✓ | ✓ | ⚠️ Weak |
| Brownfield integration | ✓ | ✓ | ✓ |

## Summary and Recommendations

### Overall Readiness Status

**READY** — The planning artifacts are comprehensive, well-structured, and demonstrate thorough technical and UX analysis. 100% FR coverage (31/31), all epics deliver user value, dependencies are clean, and ACs are detailed in proper Given/When/Then format. All 6 major issues resolved post-assessment.

### Issue Summary

| Severity | Count | Status | Description |
|---|---|---|---|
| 🔴 Critical | 1 | ✅ RESOLVED | FR31 (verify mode) — Story 2.4 added to Epic 2 |
| 🟠 Major — Story 1.2 | 1 | ✅ RESOLVED | Split into 1.2a (Zobrist+Transposition), 1.2b (Scorer+Tags), 1.2c (DFS Algorithm) |
| 🟠 Major — Logging | 1 | ✅ RESOLVED | Epics aligned to Architecture: `console.log/warn/error` with `[Solver]` prefix |
| 🟠 Major — Error handling | 1 | ✅ RESOLVED | Reverted to UX pattern: displayError() with "Dismiss" button, no auto-dismiss |
| 🟠 Major — Result resilience | 1 | ✅ RESOLVED | Server result caching added to Story 1.4 (5-min TTL, resend on reconnect, solve continues on disconnect) |
| 🟠 Major — Layout | 1 | ✅ RESOLVED | UX spec updated to full-viewport horizontal collapsible config panel (Epics/replay pattern) |
| 🟠 Major — Adversarial review I3 | 9 | ✅ RESOLVED | Iteration 3: memory budget, merge strategy, loading state, comparison pin, hard-kill, algorithmUsed, IS-MCTS tuning, verify+MCTS, MVP limitations |
| 🟠 Major — Adversarial review I4 | 10 | ✅ RESOLVED | Iteration 4: DuelConfig+Action undefined, SOLVER_START table, msg count, max backprop, dual weights, epics loading, WS lifecycle, hard-kill multi-worker, debug service file |
| 🔴 Blocker — Adversarial review I5 | 2 | ✅ RESOLVED | Iteration 5: mainPath missing opponent actions (verify mode unimplementable), SELECT_CHAIN goldfish BF explosion |
| 🟠 Major — Adversarial review I5 | 4 | ✅ RESOLVED | Iteration 5: handtrap DRY violation, probe waste, deckSeed false reproducibility, WASM memory budget blind spot |
| 🟡 Minor — Adversarial review I5 | 7 | ✅ RESOLVED | Iteration 5: lazy loading, WASM snapshot test, Lua timeout, raw OCGCore reads, transposition risk, golden DFS-only, mat-tooltip misuse |
| 🔴 Blocker — Adversarial review I6 | 3 | ✅ RESOLVED | Iteration 6: GoldfishChainRanker missing (no story/file/data), duelProcess timeout impossible (sync WASM), SOLVER_HANDTRAPS lost (lazy service) |
| 🟠 Major — Adversarial review I6 | 4 | ✅ RESOLVED | Iteration 6: stepIndex off-by-one, export missing adversarialTimings, boundary stale count, file tree comment |
| 🟡 Minor — Adversarial review I6 | 4 | ✅ RESOLVED | Iteration 6: score qualifier divergence, GoldenTestCase algorithm, uncollapse button, verify mainPath-only limitation |
| 🟠 Major — Adversarial review I7 | 6 | ✅ RESOLVED | Iteration 7: transposition verification key, MCTS validation gap, IS-MCTS determinizations default, session history UI missing, score format divergence, reconnection client-side gap |
| 🟡 Minor — Adversarial review I7 | 3 | ✅ RESOLVED | Iteration 7: fork() snapshot cleanup, GoldfishChainRanker BF validation, verify tooltip for MCTS |
| 🔴 Blocker — Adversarial review I8 | 3 | ✅ RESOLVED | Iteration 8: MCTS random rollouts broken for combo decks (epsilon-greedy policy), GoldfishChainRanker false data source claim (duelQueryField → response buffer), transposition table 100K entries exceeds per-worker V8 heap (reduced to 25K) |
| 🟠 Major — Adversarial review I8 | 5 | ✅ RESOLVED | Iteration 8: verification cost unbudgeted (15% reservation), IS-MCTS convergence insufficient in Fast mode (documented as best-effort), Zobrist hash missing GY/banished zones, deckSeed verify broken for DFS too (warning added), mechanical defaults actively hide valid lines (Phase 2 promotion) |
| 🟡 Minor — Adversarial review I8 | 6 | ✅ RESOLVED | Iteration 8: mat-tooltip for breadcrumb annotations (→ CDK Overlay), session history 2.5MB memory unestimated (documented), FR12 DFS-only not noted in coverage map, tags data maintenance plan absent (documented), Quick Solve brick rate (accepted), multi-user contention (accepted MVP) |
| 🟡 Minor | 2 | OPEN | FR3 partial note; Epic 3 traceability |

### Resolved Issues (Post-Assessment)

1. **FR31 Verify Mode** — Story 2.4 "Verify Adversarial Path" added to Epic 2. FR Coverage Map updated. Coverage now 31/31 (100%).
2. **Story 1.2 Split** — Decomposed into 3 stories: 1.2a (Zobrist + Transposition Table), 1.2b (Interruption Scorer + Tags Data), 1.2c (DFS Algorithm). Dependency chain preserved.
3. **Logging Pattern** — Epics updated to use `console.log('[Solver]', ...)` pattern matching existing duel-server convention (`[UpdateData]`, etc.). No `logger.forSolve()` or `slog.debug()` references remain.
4. **Error Handling** — Epics reverted to UX pattern: `displayError()` with "Dismiss" action button, no auto-dismiss. Critical errors (WASM_INIT_FAILED, DECK_NOT_FOUND) must not disappear unnoticed.
5. **Server Result Resilience** — Story 1.4 updated: server caches last SOLVER_RESULT per userId (5-min TTL), resends on WS reconnect. Solve continues on disconnect (not aborted), result cached if completed before eviction.
6. **Layout** — UX spec updated to full-viewport with horizontal collapsible config panel (replay pattern). Sidebar 280px references replaced. Breakpoints, component table, and button hierarchy updated. `mat-progress-bar` → `mat-progress-spinner` aligned.

### Iteration 2 — Cross-Document Consistency Pass

6 additional issues found and resolved:

7. **FR31 in Epics Requirements Inventory** — FR31 was in the Coverage Map and Epic 2 FRs but missing from the Requirements Inventory list. Added.
8. **FR3 in Epic 2 FRs covered** — FR3 (adversarial) was in the Coverage Map but missing from Epic 2's "FRs covered" line. Added.
9. **Architecture component hierarchy** — Was outdated (missing PinnedResultsBar, HeroResultBlock, BrickStateBlock, collapsibility). Rewritten with full component tree, layout description, and pin support.
10. **Architecture SOLVER_ERROR types** — Had 4 types, Epics had 6. Added RATE_LIMITED and MEMORY_LIMIT to Architecture.
11. **Architecture WS reconnect resilience** — Not documented. Added: server caches last result per userId (5-min TTL), resend on reconnect, solve continues on disconnect.
12. **Architecture verify mode WS rule** — Added verifyPath field and verified boolean to WS protocol rules section.

### Iteration 3 — Adversarial Review (Post-IR)

13. **Comparison pin** — UX spec still described the comparison pin (star icon, cross-deck banner). Removed from UX spec to align with Epics flat-list approach. All 4 "scoped per deck" references updated to "visible across decks."
14. **Loading state missing from UX state machine** — Added `loading` state (deck fetch via route param) to UX spec state machine with `mat-progress-spinner` treatment.
15. **Memory budget enforcement mechanism unspecified** — Architecture and Epics updated: `worker_threads` `resourceLimits.maxOldGenerationSizeMb` per worker (native V8 enforcement, no polling).
16. **Worker merge strategy undefined** — "diverse alternatives" replaced with concrete algorithm: global best by score + dedup by mainPath hash + top-X sorted.
17. **Hard-kill timeout safety net** — Added `setTimeout(timeLimitMs * 1.5)` to architecture and Epics Story 1.3 as circuit breaker for stuck workers.
18. **`algorithmUsed` field missing from SolverStats** — Added to architecture and Epics (Story 1.4 + Story 3.4 export). Distinguishes requested algorithm ('auto') from actual ('dfs'/'mcts') for reproducibility.
19. **IS-MCTS determinization tuning note** — Tuning guidance added to architecture. **Superseded by iteration 7 finding #58:** default changed from 1 to 3 for true IS-MCTS averaging.
20. **Verify mode + MCTS semantics** — Story 2.4 clarified: verification confirms legal path + declared score for the given deckSeed, not optimality of MCTS statistical analysis.
21. **Known MVP limitations section** — Added to architecture: mechanical prompt defaults, single-reviewer golden suite, DFS/MCTS reproducibility asymmetry.

### Iteration 4 — Adversarial Review Pass 2 (Post-Iteration-3)

22. **`DuelConfig` interface undefined** — Added to architecture with full field definitions (mainDeck, extraDeck, hand, deckSeed, opponentDeck, handtraps?).
23. **`Action` interface undefined** — Added to architecture (responseIndex, cardId, promptType, isExploratory). Added to solver-types.ts export lists in both architecture and epics.
24. **SOLVER_START payload table incomplete** — Added `deckSeed?` and `verifyPath?` to the WS Protocol summary table.
25. **Message type count off-by-one** — "5 new message types" → "6 new message types" in Technical Constraints.
26. **MCTS max backprop tradeoff undocumented** — Story 1.7 updated with tradeoff note and fallback guidance (switch to mean or tunable mix if exploration suffers). UCB1 C tuning note added.
27. **Dual weight sources ambiguous** — Clarified: `interruption-weights.json` is the single source of weights (per-type). `interruption-tags.json` defines effects (type + usesPerTurn) but no per-card weight. Updated architecture config table, epics Story 1.1 and 1.2b ACs.
28. **Epics UX summary missing `loading` state** — Added `loading` to epics state machine summary line (was updated in UX spec and architecture but missed in epics).
29. **SolverService WS lifecycle contradictory** — Resolved: SolverService is root-scoped and registers on shared WS connection at construction. No component-scoped adapter needed (unlike PvP). Updated architecture and epics.
30. **Hard-kill timeout multi-worker interaction** — Clarified: wraps `Promise.allSettled()` of all worker tasks, falls back to available results.
31. **`SolverDebugLogService` missing from file tree** — Added to architecture frontend file tree.

### Iteration 5 — Adversarial Review Pass 3 (Pre-Implementation)

13 issues found across all docs. 2 blockers, 4 major, 7 minor. All resolved.

**Blockers:**

32. **mainPath does not encode opponent actions — verify mode unimplementable** — `SolverAction` only captures player 0 actions. Story 2.4's verifier had no data to replay opponent handtrap activations. **Fix:** Added `AdversarialTiming` interface (stepIndex, handtrapCardId, handtrapCardName, responseIndex) to architecture + solver-types.ts. `SolverResult` now includes `adversarialTimings?: AdversarialTiming[]`. `SOLVER_START` accepts `verifyTimings?: AdversarialTiming[]` for verify mode. Story 2.4 AC updated to use adversarialTimings for deterministic replay of opponent actions. Updated across architecture, epics, UX.

33. **SELECT_CHAIN goldfish BF explosion** — SELECT_CHAIN classified as "exploratory" but in goldfish, modern combo decks trigger 10-20 optional effects per turn, each creating N+1 branches. POC BF 15.6 was on simple HERO deck — real combo decks hit BF 40+. **Fix:** Added `GoldfishChainRanker` as default ActionRanker (not identity). Single legal activation → auto-resolve; multiple → rank "activate" above "pass" for beneficial effects; pass deprioritized. Reduces BF from ~40 to ~12-15. Updated architecture (ActionRanker section), epics (Story 1.1 AC), PRD (Risk Mitigation).

**Major:**

34. **Handtrap cardIds hardcoded in frontend AND server JSON — DRY violation** — Two sources of truth. **Fix:** Added `SOLVER_HANDTRAPS` WS message (server → client, sent on connect). Frontend reads handtrap list from server. Removed "hardcoded in frontend" from Story 2.2. Updated architecture (WS protocol: 7 message types), epics (Stories 1.4, 2.2).

35. **Algorithm probe 100 nodes wasted** — Each worker independently runs probe; results discarded. **Fix:** Architecture and Story 1.7 now specify probe tree is reused — DFS continues from frontier, MCTS warm-starts from probe leaves. No wasted work.

36. **deckSeed reproducibility claim silently broken by in-game randomness** — deckSeed controls initial shuffle only, not OCGCore's internal PRNG (coin flips, search shuffles). **Fix:** Architecture Known Limitations updated with honest description. Story 3.4 Deck Seed tooltip updated. PRD Risk Mitigation table updated.

37. **Memory budget ignores WASM linear memory** — `maxOldGenerationSizeMb` only caps V8 heap; WASM linear memory (~16-20MB per instance) is invisible to it. **Fix:** Budget formula updated: per-worker V8 cap = `(memoryBudgetMb - (poolSize × 20)) / poolSize`. Updated architecture and Story 1.3 AC.

**Minor (resolved):**

38. **500-node tree with no image lazy loading** — All card art `<img>` in tree now use `loading="lazy"`. Updated Story 1.6b AC.
39. **WASM snapshot correctness untested for complex interactions** — Added golden test requirement: 1 multi-chain OPT test case run with/without snapshot. Updated architecture (Golden Test Patterns) and epics (post-implementation note).
40. **duelProcess() can hang on buggy Lua scripts** — Initially added 5s per-call timeout; **revised in iteration 6** (synchronous WASM call blocks event loop, setTimeout cannot fire). Only backstop is orchestrator hard-kill (1.5× time budget) via worker.terminate(). Updated architecture and Story 1.1 AC.
41. **GameOracle reads through animation layer ambiguity** — Clarified: `getFieldState()` calls `duelQueryField()` directly on raw OCGCore, not through RenderedBoardStateService. Updated architecture (GameOracle section).
42. **Transposition table verification key false-hit risk** — Initially accepted as rare edge case. **Superseded by iteration 7 finding #56:** verification key extended with overlay counts + face-down flags to eliminate false hits.
43. **Golden suite undefined for MCTS** — Specified: golden tests run DFS only. MCTS coverage via manual validation (NFR14). Updated architecture and epics.
44. **mat-tooltip used for 120×175px card art popup** — `mat-tooltip` only renders text. Replaced with CDK Overlay (`CdkConnectedOverlay`) in UX spec and Story 1.6b AC.

### Iteration 6 — Adversarial Review Pass 4 (Post-Iteration-5 Fixes)

11 issues found. 3 blockers, 4 major, 4 minor. All resolved.

**Blockers:**

45. **GoldfishChainRanker: no story, no file, no data source** — Architecture described a default ActionRanker but: (a) no story implemented it, (b) no file in directory tree, (c) "data-driven" classification had no data source. **Fix:** (a) AC added to Story 1.2c for GoldfishChainRanker behavior. (b) `goldfish-chain-ranker.ts` added to architecture file tree. (c) Corrected to "heuristic-based" (hardcoded, using OCGCore prompt context) — not a config JSON.

46. **duelProcess() 5s timeout impossible in synchronous WASM worker** — `setTimeout` cannot fire while a synchronous WASM call blocks the event loop. Per-call timeout is dead code. **Fix:** Removed per-call timeout from architecture and Story 1.1. Clarified: only backstop is orchestrator hard-kill (1.5× time budget) via `worker.terminate()` from main thread.

47. **SOLVER_HANDTRAPS lost if SolverService not yet instantiated** — SolverService is lazily instantiated (`providedIn: 'root'`). Message sent on WS connect would be missed. **Fix:** Replaced with request/response pattern: client sends `SOLVER_INIT` when entering solver page → server responds with `SOLVER_HANDTRAPS`. Updated architecture (WS protocol: 8 message types), Stories 1.4 and 1.5a (SOLVER_INIT send + handtraps signal).

**Major:**

48. **AdversarialTiming.stepIndex off-by-one risk** — "index after which opponent acted" was ambiguous. **Fix:** Added precise TSDoc: `stepIndex` = 0-based index, verifier applies mainPath[0..stepIndex] inclusive, then injects opponent response, then continues mainPath[stepIndex+1..].

49. **Export JSON missing adversarialTimings** — Adversarial exports had no opponent timing data, making re-verification impossible. **Fix:** Added `adversarialTimings` to Story 3.4 export content.

50. **Architecture Boundary 2 stale count (6 → 8 message types)** — SOLVER_HANDTRAPS and SOLVER_INIT not reflected in Architectural Boundaries section. **Fix:** Updated to 8 message types with complete list.

51. **solver-types.ts file tree comment missing AdversarialTiming** — File tree comment listed all types but omitted AdversarialTiming added in iteration 5. **Fix:** Added to comment.

**Minor (resolved):**

52. **Score qualifier divergence** — Story 1.6a had "Strong board"/"Moderate board" qualifiers not in UX spec. **Fix:** Removed qualifiers from Story 1.6a. UX spec format ("35 — 3 interruptions") is authoritative.

53. **GoldenTestCase missing `algorithm` field** — Interface had `mode: 'goldfish'` but no `algorithm`. Runner had to implicitly force DFS. **Fix:** Added `algorithm: 'dfs'` to GoldenTestCase interface.

54. **Config panel collapse has no uncollapse trigger for keyboard users** — Collapsed panel hid all config controls with no visible toggle. **Fix:** Added `tune` icon toggle button in collapsed bar to UX spec and Story 1.5a AC.

55. **Verify mode only works for mainPath** — Non-mainPath adversarial branches cannot be verified. **Fix:** Documented as Known MVP Limitation #3 in architecture. Phase 2: "Verify this branch" contextual action in tree.

### Iteration 7 — Adversarial Review Pass 5 (Post-Iteration-6)

9 issues found. 6 major, 3 minor. All resolved.

**Major:**

56. **Transposition verification key missing overlay/face-down state** — Verification key (cards-per-zone + top card IDs) did not include overlay counts or face-down flags. Two states with identical card layout but different OPT activation histories produce false score hits — common with HOPT effects activated in different orders. **Fix:** Verification key extended to include overlay counts per zone + face-down flag count per zone. Architecture Zobrist section and Story 1.2a AC updated. Golden test requirement added for OPT-divergent transposition hit.

57. **MCTS has zero automated validation** — Golden tests run DFS only; MCTS coverage was "manual validation" only. No regression safety net for the algorithm that handles high-BF decks. **Fix:** Story 1.7 AC added: 5 golden test hands × 10 MCTS runs, standard deviation < 15% of mean score. UCB1 C and backpropPolicy ('max'/'mean') exposed as configurable in solver-config.json.

58. **IS-MCTS determinizations default = 1 is vanilla MCTS** — With 1 determinization per iteration, the solver samples one random handtrap subset — no IS-MCTS averaging over information sets. Adversarial results inconsistent between runs. **Fix:** Default `determinizationsPerIteration` changed from 1 to 3 across PRD, Architecture, and Story 2.1.

59. **Session history (FR26) has no UI** — Story 3.1 created the `Signal<SolverResult[]>` but no component displays it. Users had no way to browse previous results. **Fix:** Story 3.1b added with mat-menu history dropdown (reverse chronological, deck name + score + config summary, click to restore).

60. **Score display format diverges across 3 documents** — PRD: "Score 35 (3 interruptions)". UX: "3 interruptions: 2 omni-negate, 1 destruction" (inline breakdown). Epics: "35 — 3 interruptions" + chips below. **Fix:** Canonical format aligned across all docs: hero line = "35 — 3 interruptions" (`mat-headline-4`), chips breakdown below (one mat-chip per type). PRD journey and UX Experience Mechanics updated.

61. **WS reconnection result delivery has no client-side handling** — Server caches and resends SOLVER_RESULT on reconnect (Story 1.4), but no frontend story handled unsolicited results arriving while state is 'idle'/'configuring'. **Fix:** Story 1.5a AC added: if deckId matches current route, display result and transition to 'complete'; if deckId mismatches, silently add to session history.

**Minor (resolved):**

62. **fork() snapshot memory lifetime unspecified** — WASM snapshot buffer could theoretically persist on the stack across multiple DFS branches, exceeding the 20MB WASM budget. **Fix:** Story 1.1 AC added: snapshot buffer released immediately after new DuelHandle creation; at most 1 transient snapshot exists at any time.

63. **GoldfishChainRanker BF reduction unvalidated** — Claimed BF reduction from ~40 to ~12-15 had no test. **Fix:** Story 1.2c AC added: 3 golden test hands with known SELECT_CHAIN BF, measured BF within ±3 of expected.

64. **Verify button gives no MCTS-specific guidance** — Users seeing "Verification failed" on MCTS results had no context for why. **Fix:** Story 2.4 AC added: mat-tooltip on Verify button when algorithmUsed is 'mcts', explaining stochastic divergence is expected.

### Iteration 8 — Adversarial Review Pass 6 (Post-Iteration-7)

14 issues found. 3 blockers, 5 major, 6 minor. All resolved.

**Blockers:**

65. **MCTS random rollouts produce meaningless scores for combo decks** — Pure random rollouts almost never produce a coherent combo line in Yu-Gi-Oh! (BF 15.6 × depth 50 → probability of randomly chaining correct activations is negligible). Nearly all rollouts score 0, making UCB1 statistics meaningless. **Fix:** Added epsilon-greedy rollout policy (default ε=0.1) using GoldfishChainRanker to bias rollouts toward coherent combo lines. `rolloutEpsilon` configurable in solver-config.json. Updated architecture (SolverStrategy section), Story 1.7, PRD risk table.

66. **GoldfishChainRanker "effect category flags via duelQueryField()" is false** — `duelQueryField()` returns field state (zones, LP, turn, phase), NOT pending activation data or effect semantic categories. The actual source is OCGCore's response buffer from `duelProcess()`, which includes card IDs and effect descriptions for chainable activations. **Fix:** Corrected architecture (ActionRanker section), Stories 1.1 and 1.2c to specify pattern-matching against response buffer effect descriptions. Acknowledged fragility for edge cases; unrecognized effects default to "beneficial."

67. **Transposition table 100K entries exceeds per-worker V8 heap cap** — At ~300-400 bytes/entry, 100K entries ≈ 30-40MB per worker against a 65MB V8 cap, leaving minimal headroom for tree nodes, Zobrist tables, and other allocations. **Fix:** Default reduced to 25K entries (~7-10MB/worker). Updated architecture, Story 1.1 config schema, Story 1.2a.

**Major:**

68. **Verification post-condition (NFR12) cost unbudgeted** — ~62ms/path × K=3 = ~186ms/worker. For Fast 5s, that is ~4% per worker but up to 22% if recomputation needed. **Fix:** Added `verificationBudgetRatio` (default 0.15) — strategies reserve 15% of time budget for verification. Updated architecture (Worker Architecture), Story 1.3, solver-config.json schema.

69. **IS-MCTS convergence insufficient in Fast mode** — With 3 determinizations × ~2K-3.5K iterations, only ~6K-10.5K samples from 31 possible handtrap subsets. **Fix:** Documented as known limitation: Fast adversarial is best-effort (directional, not precise). Optimal (60s) provides stable averaging. Updated architecture (Known MVP Limitations #6), Story 2.1, PRD risk table.

70. **Zobrist hash missing GY/banished zone state** — Two states with identical field but different graveyards hash identically → false transposition hits. GY contents directly affect legal actions (GY recursion, banished recovery). **Fix:** Hash components extended to include ALL zones (GY, banished, extra, deck). Updated architecture (Zobrist section), Story 1.2a.

71. **deckSeed Verify (FR31) broken for DFS too, not just MCTS** — Any combo with search/shuffle effects causes OCGCore PRNG divergence, producing `verified: false` for both DFS and MCTS. The MCTS-specific tooltip was misleading. **Fix:** Story 2.4 verify tooltip now applies to ALL algorithms. Architecture Known Limitations #5 added with Phase 2 mitigation (capture OCGCore PRNG state). PRD risk table updated.

72. **Mechanical defaults actively prevent discovering valid lines (not just suboptimal)** — SELECT_POSITION=ATK prevents DEF strategies (flip monsters, Nibiru avoidance). SELECT_PLACE=leftmost prevents column-specific interactions (Impermanence). The user has no visibility. **Fix:** Architecture Known Limitations #1 rewritten with concrete examples and Phase 2 plan to promote SELECT_POSITION to exploratory.

**Minor (resolved):**

73. **mat-tooltip for breadcrumb annotations truncates long combo descriptions** — Multi-target combo annotations (Pendulum Summons, multi-material Fusions) exceed 150+ chars. `mat-tooltip` designed for short hints. **Fix:** Replaced with CDK Overlay (`CdkConnectedOverlay`) in UX spec and Story 1.6b, matching existing card art popup pattern.

74. **Session history 10 entries × ~250KB = ~2.5MB unestimated** — Memory impact never documented. **Fix:** Memory estimation added to Story 3.1 AC. Accepted as tolerable for desktop browsers.

75. **FR12 (transposition) DFS-only not noted in coverage map** — Coverage map said "Epic 1" without qualifying DFS-only. MCTS gets no deduplication. **Fix:** Coverage map FR12 annotated with "DFS only" and Phase 2 note for lightweight MCTS cache. Architecture Known Limitations #7 added.

76. **Interruption tags data (50 cards) has no maintenance plan** — No mechanism to detect stale usesPerTurn or type values when cards get errata'd. **Fix:** PRD risk table updated with maintenance note (manual update at each banlist ~4x/year). Accepted as MVP limitation.

77. **Quick Solve brick rate ~40-60% for combo decks** — Random hands lack specific starters, frequently returning "No viable combo." **Fix:** Accepted as-is for MVP. Phase 2 consideration: prioritize combo starters in random fill.

78. **Multi-user concurrent solve degrades silently** — Root parallelism dispatches to all workers per solve. 2 concurrent users timeshare without feedback. **Fix:** Accepted as MVP (personal project). Already documented in architecture.

### Remaining Minor Issues

- **FR3 partial coverage** — FR3 fully covered only after Epic 2. Acceptable (goldfish is a complete experience).
- **Epic 3 FR traceability** — Stories 3.2-3.4 are UX/velocity features without explicit FR mapping. Legitimate but noted.

### Strengths

- **Exceptional AC quality** — All stories use Given/When/Then with specific types, ranges, and behavioral expectations. No vague ACs found.
- **Clean architecture** — 5 well-defined boundaries, Strategy pattern for algorithms, GameOracle abstraction for testability.
- **POC-validated baselines** — Performance assumptions backed by measured data (6µs/action, 10ms snapshot, BF 15.6).
- **Replay-aligned corrections** — The Epics intentionally align with existing replay mode patterns, reducing implementation divergence.
- **Big bang approach acknowledged** — The testing strategy is explicit ("no end-to-end until epic complete"), preventing false expectations.

### Final Note

This assessment identified **9 initial issues** + **6 in iteration 2** + **9 in iteration 3** + **10 in iteration 4** + **13 in iteration 5** + **11 in iteration 6** + **9 in iteration 7** + **14 in iteration 8** = **81 total issues**. **All 79 critical/major issues have been resolved** across 8 iterations. All 4 documents (PRD, Architecture, UX, Epics) are now internally consistent and cross-aligned. **2 minor issues** remain (FR3 partial note, Epic 3 traceability). The planning artifacts are high-quality and the solver module is **ready for implementation**.

**Assessor:** Claude (Implementation Readiness Reviewer)
**Date:** 2026-04-07
