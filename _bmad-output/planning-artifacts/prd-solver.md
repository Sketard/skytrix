---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-03-success', 'step-04-journeys', 'step-05-domain-skipped', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
status: complete
completedAt: '2026-03-22'
inputDocuments: ['brainstorming-session-2026-03-22.md', 'technical-combo-path-solver-research-2026-03-22.md', 'poc-solver-results-2026-03-22.md', 'project-context.md']
workflowType: 'prd'
documentCounts:
  briefs: 0
  research: 1
  brainstorming: 1
  projectDocs: 1
classification:
  projectType: web_app
  domain: general
  complexity: high
  projectContext: brownfield
---

# Product Requirements Document — skytrix Combo Path Solver

**Author:** Axel
**Date:** 2026-03-22
**Status:** MVP

## Executive Summary

**Product:** Automated combo path solver and handtrap resilience analyzer for Yu-Gi-Oh! decks, integrated into the skytrix platform.

**Differentiator:** To our knowledge, first automated handtrap resilience analyzer for TCG. A player knows their goldfish combo line but cannot systematically explore all fallback lines against every handtrap combination. The solver replaces hours of manual testing with a systematic analysis in seconds.

**How it works:** The solver uses the game's rules engine as a black box to explore every possible action sequence from a given hand. It evaluates end boards by counting and weighting the interruptions they provide (negates, destructions, bounces). In adversarial mode, a virtual opponent activates handtraps at the worst possible timing — the solver finds the combo line that scores highest even under optimal disruption. Output is an interactive decision tree: recommended path highlighted, with branches showing what to do if each handtrap hits.

**Technical Context (brownfield):** Extends the existing skytrix ecosystem — Angular 19 frontend, Spring Boot backend, Node.js duel-server with OCGCore WASM worker threads. The solver adds a dedicated worker pool in the duel-server, communicates over the existing WebSocket, and adds a new Angular page with a tree viewer. POC results and technical details in `poc-solver-results-2026-03-22.md` and `technical-combo-path-solver-research-2026-03-22.md`.

**POC Validated (2026-03-22):** OCGCore per-action latency = 6µs (not the bottleneck). WASM memory snapshot = 10ms for state forking (6.5x faster than replay-from-scratch). Combo deck branching factor = 15.6 (requires MCTS/pruning, not exhaustive DFS).

## Success Criteria

### User Success

- Player discovers a **combo line they didn't know** for their deck
- Player sees at a glance **which line survives which handtraps** → tournament confidence
- Player compares 2 deck builds via successive solves → informed deckbuilding decision
- Fast mode returns an exploitable result in **< 5 seconds**
- Player **identifies the recommended line and its resilience in < 10 seconds** of reading the decision tree (highlighted main path, visible score, collapsed branches by default)

### Business Success

- Personal project — success = Axel uses it for his own decks and finds it useful
- Future community potential (competitive players, content creators)
- No adoption metrics for the MVP

### Technical Success

- Action sequences returned are **100% legal** (verified by OCGCore)
- Guaranteed termination: max depth + loop detection, no crash/hang
- Performance on **reference hardware (8-core dev server)**: Fast < 5s, Optimal < 60s
- Architecture Strategy pattern: minimum 2 swappable algorithms (DFS + SP-MCTS)
- **Golden test suite**: 30 hand-verified hands (15 combo-able, 15 bricks) with **100% concordance**

### Measurable Outcomes

| Metric | MVP Target |
|---|---|
| Time-to-first-result (Fast) | < 5s (ref: 8-core) |
| Time-to-optimal (Optimal) | < 60s (ref: 8-core) |
| Solve rate (playable hands) | **100%** target (validated against golden suite; "playable" = hand that produces ≥1 legal end board with score > 0 for the given deck ordering) |
| Brick detection — false positives | **0%** target (golden suite) |
| Brick detection — false negatives | **0%** target (golden suite) |
| Decision tree readability | Recommended line identifiable in **< 10s** |
| Handtraps modeled | **5: Ash Blossom, Nibiru, Effect Veiler, Maxx "C", Infinite Impermanence** |
| Golden test suite | 30 hands (15/15), 100% concordance |

## User Journeys

### Journey 1: Goldfish Discovery — "What can my deck do?"

**Axel** just finished a new Branded Despia build. He theorycrafted on paper but isn't sure of the real ceiling — does the hand Branded Fusion + Fallen of Albaz + a discard really open into a 3-negate board?

He clicks **"Solve"** in Goldfish Fast mode with a test hand. In **3 seconds**, the result appears: **35 — 3 interruptions** with interruption type chips below (omni-negate ×2, destruction ×1) and an annotated main path from Normal Summon through Fusion Summon Mirrorjade to a 2-negate + 1-destruction board.

At step 4, he spots an alternative Lubellion line (score 32, 2 negates + 1 floodgate) he hadn't considered — better against aggro. A second test with a 3-spell/2-trap hand confirms it's a brick in 2 seconds.

### Journey 2: Handtrap Resilience — "Does it hold against Ash?"

The next day, Axel prepares for a locals tournament. His Branded deck works well in goldfish, but he knows opponents play **Ash Blossom** and **Nibiru** in triplicate. He wants to know: if the opponent has Ash, what's the best fallback line?

He switches to **Adversarial Optimal** mode, checks **Ash Blossom + Nibiru**, and launches. After **45 seconds**, the decision tree shows handtrap branches: Ash on Branded Fusion → Lubellion fallback (score 22), Nibiru at 5th summon → score 8. The minimax resilience score is **8** — the deck folds to Nibiru. He needs Crossout Designator or a sub-5-summon line.

### Journey 3: Build Comparison — "With or without the Extender?"

Axel hesitates: he has a version of his deck with 2 copies of **Aluber the Jester of Despia** (extender) and a version without (replaced by 2 copies of **Crossout Designator** for resilience). Which build is better?

He runs Adversarial Fast on **Build A** (with Aluber): goldfish 38, minimax 12. Then **Build B** (with Crossout): goldfish 30, minimax **22**. Build A has the higher ceiling but folds to Ash; Build B is resilient. For his Ash-heavy local meta, Build B wins. Decision made in 2 solves, < 30 seconds — data replaces gut feeling.

### Journey Requirements Summary

| Capability | J1 Goldfish | J2 Resilience | J3 Compare |
|---|---|---|---|
| Deck selection | ✓ | ✓ | ✓ |
| Hand selection (fixed) | ✓ | ✓ | ✓ |
| Mode Goldfish / Adversarial | Goldfish | Adversarial | Adversarial |
| Mode Fast / Optimal | Fast | Optimal | Fast |
| Handtrap selection | | ✓ | ✓ |
| Progress streaming | ✓ | ✓ | ✓ |
| Interactive decision tree | ✓ | ✓ | ✓ |
| Expand/collapse branches | ✓ | ✓ | |
| Score per board | ✓ | ✓ | ✓ |
| Minimax score (resilience) | | ✓ | ✓ |
| Handtrap branches annotated | | ✓ | |
| Step annotations | ✓ | ✓ | |
| Cancellation | | (implicit) | |
| Session history | | | ✓ |

## Innovation & Novel Patterns

### Innovation Areas

1. **IS-MCTS with Determinization for Handtrap Modeling** — Information Set MCTS (poker/Hanabi technique) applied to model adverse handtrap timings. MCTS has been applied to Yu-Gi-Oh! (melvinzhang/yugioh-ai), but **IS-MCTS with determinization for handtrap resilience is novel**. MVP default `determinizationsPerIteration = 3` provides true IS-MCTS averaging over handtrap subsets. Increase to 5 for decks with many handtrap slots if results are inconsistent. A tuning AC (Story 1.7) validates MCTS score stability against the golden suite.

2. **Handtraps as Natural Pruning** — Counter-intuitive insight: adverse interactions reduce the exploration tree. An Ash that cuts a line eliminates all downstream branches. Makes minimax viable.

### Competitive Landscape

| Tool | Approach | Limitation |
|---|---|---|
| WindBot | Rule-based per-deck executors | Manual, not general |
| ygo-agent | Deep RL (PPO + transformer) | GPU training required |
| melvinzhang/yugioh-ai | MCTS on ygopro-core | Early-stage, no handtrap modeling |
| YGO-Combo-Simulator | Monte Carlo hand sampling | Probabilities, not paths |
| DeckLens / MDM Deck Tester | Hand probability calculator | No simulation |
| **Players themselves** | **Manual testing in solo simulator** | **Know goldfish but not all fallback lines** |
| **skytrix Solver** | **Tree search + IS-MCTS + OCGCore oracle** | **Deck-agnostic within perf constraints** |

### Validation Approach

- **POC Phase 1** ✅ — OCGCore latency (6µs), WASM snapshot (10ms), branching factor (15.6)
- **Golden test suite** — 30 hand-verified hands as quality benchmark
- **WASM snapshot CI smoke test** — Verifies Memory hook works after each @n1xx1/ocgcore-wasm update
- **Meta deck coverage** — Target: < 60s Optimal for **top 20 meta decks** (source: masterduelmeta.com tier list, updated per banlist ~4x/year)
- **Algorithm iteration** — Strategy pattern enables benchmarking DFS vs MCTS on same data

## Web App Technical Context

Solver runs as a Node.js worker thread pool managed by piscina, communicating via WebSocket. See architecture-solver.md for detailed technical architecture.

## Product Scope & Phased Development

### MVP Strategy

**Approach:** Problem-solving MVP — smallest product that validates "an automated solver is useful for Yu-Gi-Oh! deck optimization."

**Resource:** Solo dev (Axel). Existing duel-server + Angular frontend.

### MVP Feature Set

**Journeys supported:** J1 Goldfish Discovery, J2 Handtrap Resilience, J3 Build Comparison

**Must-have capabilities:** Goldfish solver, adversarial solver (5 handtraps), decision tree output (breadcrumb + CDK Tree), contextualized scoring, enriched annotations, Fast + Optimal modes, WS protocol, pre-filled interruption tags, WASM snapshot with automatic fallback, golden test suite.

### Phase 2 — Growth

- Node detail panel (full board state, score breakdown)
- Complexity detection + guided first steps
- Interruption tags admin UI
- Side-by-side build comparison
- Decision tree export (image/PDF)
- Consistency analysis (N random hands)
- Tags migration to PostgreSQL

### Phase 3 — Expansion

- Neural MCTS (trained policy network)
- Deck optimizer (add/remove suggestions based on solve results)
- PvP coach mode (real-time suggestions during a duel)
- Community interruption tags

### Risk Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| WASM snapshot relies on Emscripten impl. detail | HIGH | CI smoke test + automatic fallback to replay if hook fails |
| IS-MCTS unsuitable for Yu-Gi-Oh! | MEDIUM | Fallback to DFS with heuristic pruning (Strategy pattern swap) |
| OCGCore too slow for some decks (BF 30+) | HIGH | Complexity detection + progressive widening + user guidance |
| "Deck-agnostic" not met in practice | MEDIUM | Target top 20 meta decks < 60s, complexity warning for outliers |
| Interruption scoring inaccurate | LOW | Manual tagging database, user-adjustable |
| Insufficient dev bandwidth | MEDIUM | Goldfish alone is useful (step 4). Adversarial is an increment, not a dependency. |
| deckSeed reproducibility limited by in-game randomness | LOW | deckSeed controls initial deck shuffle only, not OCGCore's internal PRNG (coin flips, shuffles after search). Exact for DFS without random effects; approximate otherwise. Tooltip in UI documents the limitation. |
| SELECT_CHAIN goldfish BF explosion on combo decks | HIGH | Default GoldfishChainRanker reduces BF from ~40 to ~12-15 by auto-resolving single-option chains and deprioritizing pass on beneficial triggers. Heuristic-based (OCGCore response buffer pattern matching), overridable per archetype. |
| MCTS random rollouts produce meaningless scores on combo decks | HIGH | Epsilon-greedy rollout policy (default ε=0.1) uses GoldfishChainRanker to bias rollouts toward coherent combo lines. Without domain-aware rollouts, UCB1 statistics collapse to noise. |
| Transposition table memory exceeds per-worker V8 heap cap | MEDIUM | Default reduced from 100K to 25K entries. Memory estimation: ~300-400 bytes/entry × 25K = ~7-10MB per worker, well within 65MB V8 cap. |
| Verify mode (FR31) unreliable for search-heavy decks | MEDIUM | OCGCore internal PRNG divergence causes `verified: false` on combos with search/shuffle effects (affects both DFS and MCTS). UI warning displayed for all algorithm types. Phase 2: capture OCGCore PRNG state for exact replay. |
| IS-MCTS adversarial convergence insufficient in Fast mode | LOW | Fast mode (~2K-3.5K iterations × 3 determinizations) provides directional results, not precise minimax. Acceptable as best-effort. Optimal mode (60s) provides 12x more samples. Documented as known limitation. |
| Interruption tags data (50 cards) will rot without maintenance | LOW | MVP: manual update at each banlist (~4x/year). CI validates cardId existence but not data correctness. Phase 2: PostgreSQL migration + community tags. |

## Functional Requirements

### Solve Configuration

- **FR1:** Player can select an existing deck as solver input
- **FR2:** Player can define a fixed hand (1–5 chosen cards) or request a random hand (Fill Random completes to 5)
- **FR3:** Player can choose solve mode: Goldfish (no interaction) or Adversarial (with handtraps)
- **FR4:** Player can choose solve speed: Fast (time-bounded) or Optimal (exhaustive)
- **FR5:** Player can select adverse handtraps from a predefined list (Ash Blossom, Nibiru, Effect Veiler, Maxx "C", Infinite Impermanence)
- **FR6:** Player can launch a solve on the chosen configuration

### Solve Execution

- **FR7:** System explores all legal game actions from any game state to find optimal combo paths
- **FR8:** System supports at least 2 swappable exploration algorithms (DFS + SP-MCTS)
- **FR9:** System parallelizes exploration via a dedicated worker pool (separate from duel workers)
- **FR10:** System forks duel state to explore alternative branches
- **FR11:** System detects and cuts infinite loops (max depth + legal action hash)
- **FR12:** System avoids re-exploring equivalent game states reached via different action orderings
- **FR13:** In Adversarial mode, system models a virtual opponent who activates handtraps at the optimal timing to maximize disruption

### Progress & Control

- **FR14:** Player can see solve progress in real-time (nodes explored, current best score)
- **FR15:** Player can cancel a running solve
- **FR16:** System returns the best result found at any time (anytime behavior), even if solve is cancelled or timed out

### Results & Decision Tree

- **FR17:** System returns an interactive decision tree as the primary result
- **FR18:** Player can see the recommended main path via a breadcrumb at the top of the result
- **FR19:** Player can expand/collapse decision tree branches
- **FR20:** Each tree node displays the action performed with an enriched annotation (card name + complete action description)
- **FR21:** Each tree node displays a contextualized score (number of interruptions with detail by type: omni-negate, targeted negate, destruction, bounce, floodgate)
- **FR22:** In Adversarial mode, tree displays handtrap branches annotated with the handtrap and its activation timing
- **FR23:** System displays a global resilience score (worst-case minimax) for Adversarial mode
- **FR24:** Tree is pruned for readability: top-X branches per node (X configurable via server JSON)
- **FR25:** System returns a "no viable combo" diagnostic when no path leads to a board with at least 1 interruption
- **FR26:** Player can consult previous solve results from their session (client-side in-memory history)

### Interruption Scoring

- **FR27:** System evaluates final board quality via weighted scoring by interruption type
- **FR28:** Weights per interruption type are configurable via server JSON (omni-negate > targeted negate > destruction > bounce > floodgate)
- **FR29:** System reads interruption tags from a JSON file mapping each end-board card to its type, weight, and uses/turn
- **FR30:** Interruption database is pre-filled with top 150 meta end-board cards

### Handtrap Validation

- **FR31:** Player can launch a "verify" mode that replays the recommended line with a handtrap at the declared timing and confirms the result

## Non-Functional Requirements

### Performance

- **NFR1:** Fast mode returns a result in **< 5 seconds** on reference hardware (8-core dev server)
- **NFR2:** Optimal mode returns a result in **< 60 seconds** on reference hardware
- **NFR3:** WS progress messages arrive with latency **< 100ms**
- **NFR4:** Initial decision tree render (50 nodes) displays in **< 500ms**
- **NFR5:** Branch expand/collapse animates in **< 50ms**
- **NFR6:** Solver page reaches time-to-interactive in **< 1 second** (lazy-loaded)
- **NFR7:** Solver completes in < 60s Optimal for **top 20 meta decks** (source: masterduelmeta.com tier list). Target: CI regression updated per banlist (~4x/year) — deferred post-MVP, initial validation manual against 5 meta decks

### Reliability

- **NFR8:** Solver **always terminates** — max depth (50 actions) + loop detection (Zobrist hash)
- **NFR9:** If WASM snapshot fails, system **automatically falls back** to replay-from-scratch with visible WARNING log
- **NFR10:** Smoke test at duel-server boot **verifies WASM Memory hook** works and logs status
- **NFR11:** Solver pool uses at most **N configurable workers**, leaving minimum 2 cores for duel-server + event loop

### Data Integrity

- **NFR12:** Every returned sequence is **100% legal** — solver verifies as **integrated post-condition** (replay on OCGCore) before returning. Invalid sequences are silently filtered. Verification time is **included** in the Fast 5s / Optimal 60s budgets (the solver must allocate time for verification within its time limit).
- **NFR13:** Golden test suite (30 hand-verified hands) passes with **100% concordance** after every solver change
- **NFR14:** Handtrap results validated by manual cross-check for each golden suite hand at initial validation and after major algorithm changes
- **NFR15:** Exact version of `@n1xx1/ocgcore-wasm` is **pinned** in package.json (no `^` range)

### Resource Management

- **NFR16:** Solver pool consumes at most a **configurable memory budget** (default: 512MB), warning logged at 80%
- **NFR17:** Each solve is **logged**: nodes explored, final score, total time, algorithm, mode, deck ID
