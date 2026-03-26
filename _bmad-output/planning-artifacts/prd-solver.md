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

**Differentiator:** First automated handtrap resilience analyzer for TCG. A player knows their goldfish combo line but cannot systematically explore all fallback lines against every handtrap combination. The solver replaces hours of manual testing with a systematic analysis in seconds.

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
| Solve rate (playable hands) | **100%** |
| Brick detection — false positives | **0%** |
| Brick detection — false negatives | **0%** |
| Decision tree readability | Recommended line identifiable in **< 10s** |
| Handtraps modeled | **5: Ash Blossom, Nibiru, Effect Veiler, Maxx "C", Infinite Impermanence** |
| Golden test suite | 30 hands (15/15), 100% concordance |

## User Journeys

### Journey 1: Goldfish Discovery — "What can my deck do?"

**Axel** just finished a new Branded Despia build. He theorycrafted on paper but isn't sure of the real ceiling — does the hand Branded Fusion + Fallen of Albaz + a discard really open into a 3-negate board?

He opens skytrix, navigates to his deck, and clicks **"Solve"**. He selects **Goldfish Fast** mode and sets his test hand (5 chosen cards). The solver starts — a progress bar shows advancement. In **3 seconds**, the result appears:

**Score: 35 (3 interruptions)** — the main path displays: Normal Summon Aleister → activate Branded Fusion → send materials → Fusion Summon Mirrorjade → effect chain → set Branded in Red. Each step is annotated with the card name and action. The final board shows 2 omni-negates + 1 destruction.

Axel spots a branch he hadn't seen — at step 4, instead of Fusion Summoning Mirrorjade, the solver shows an alternative with Lubellion leading to a different board (2 negates + 1 floodgate, score 32). He clicks to expand the branch, compares both boards, and realizes the Lubellion line is actually better against aggro decks.

**Aha moment:** "I didn't know this line existed with this hand."

Curious, Axel tries a different hand — 3 spells and 2 traps, no combo starter. The solver runs for 2 seconds and returns: **"No viable combo — no path leads to a board with at least 1 interruption."** Axel nods — confirmed brick. He now knows this hand configuration is unplayable and can evaluate how often his deck draws it.

**Capabilities revealed:** Deck selection, hand selection (fixed), solve launch, progress feedback, decision tree display, expand/collapse branches, score per board, step annotations, brick diagnostic.

### Journey 2: Handtrap Resilience — "Does it hold against Ash?"

The next day, Axel prepares for a locals tournament. His Branded deck works well in goldfish, but he knows opponents play **Ash Blossom** and **Nibiru** in triplicate. He wants to know: if the opponent has Ash, what's the best fallback line?

He returns to the solver, same deck, same hand. This time he selects **Adversarial** mode and checks **Ash Blossom + Nibiru** in the handtrap list. He launches in **Optimal** mode — he has time, he wants the complete result.

The progress streaming shows: "Exploring... 1200 nodes, best score = 28". After **45 seconds**, the final result arrives: a **complete decision tree** with the main path (goldfish, score 35) and two handtrap branches:

- **"If Ash on Branded Fusion"** → pivot to Lubellion line, score 22 (1 negate + 1 bounce)
- **"If Nibiru at 5th summon"** → only 1 token remaining, score 8

Axel immediately sees the problem: his deck is **vulnerable to Nibiru**. He notes he needs to add protections (Crossout Designator) or play a line that stays under the 5-summon threshold. The global resilience score (worst-case minimax) is displayed at the top: **8** — the score if the opponent plays optimally.

**Aha moment:** "My deck folds to Nibiru. I need to change my play sequence or add outs."

**Capabilities revealed:** Handtrap selection (checkboxes), adversarial mode, long-running progress streaming, minimax score (worst-case), handtrap branches annotated with activation timing, global resilience score.

### Journey 3: Build Comparison — "With or without the Extender?"

Axel hesitates: he has a version of his deck with 2 copies of **Aluber the Jester of Despia** (extender) and a version without (replaced by 2 copies of **Crossout Designator** for resilience). Which build is better?

He opens the solver, loads **Build A** (with Aluber), launches an Adversarial Fast solve on a representative hand. Result in 4 seconds: goldfish score 38, minimax resilience 12. He notes the numbers.

Then he loads **Build B** (with Crossout), same hand, same handtraps. Result: goldfish score 30 (lower ceiling without the extender), but minimax resilience **22** — Crossout protects Branded Fusion from Ash.

Axel sees the trade-off clearly: Build A = higher ceiling but fragile. Build B = lower ceiling but resilient. For his local meta (lots of Ash), **Build B is the better choice**. Decision made in 2 solves, < 30 seconds.

**Aha moment:** "Now I have data to decide, not just gut feeling."

**Capabilities revealed:** Successive solves on different decks, mental score comparison (no side-by-side UI in MVP), Fast mode speed for iterative use.

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

1. **WASM Memory Snapshot as State Fork** — `WebAssembly.Memory.buffer.slice()` creates complete OCGCore state snapshots (~16MB, ~10ms). Enables branching without recreating the duel (6.5x speedup vs replay). **Relies on Emscripten implementation detail (Memory export), not a stable public API.** Validated by POC; requires CI smoke test per package update.

2. **First Handtrap Resilience Analyzer for TCG** — Positioning is not "first combo solver" but **"first automated handtrap resilience analyzer"**. A player knows their goldfish line but cannot systematically explore all fallback lines against every handtrap combination.

3. **IS-MCTS with Determinization for Handtrap Modeling** — Information Set MCTS (poker/Hanabi technique) applied to model adverse handtrap timings. MCTS has been applied to Yu-Gi-Oh! (melvinzhang/yugioh-ai), but **IS-MCTS with determinization for handtrap resilience is novel**.

4. **Handtraps as Natural Pruning** — Counter-intuitive insight: adverse interactions reduce the exploration tree. An Ash that cuts a line eliminates all downstream branches. Makes minimax viable.

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

### Frontend (Angular 19)

- New `SolverPageComponent` (standalone, OnPush, signals)
- `DecisionTreeComponent` based on **Angular CDK Tree** (`CdkTree` + `CdkTreeNode`) — no new dependency
- **MVP UI**: breadcrumb best path + tree expand/collapse with scores per node. Detail panel → Growth.
- Communication via existing WebSocket (same connection as PvP)
- Reuses existing DeckService (REST → Spring Boot), CardDatabaseService, Material components
- i18n labels in fr.json/en.json (ngx-translate)
- State management via Angular signals (idle/running/complete/error)

### Backend — duel-server (Node.js)

- Dedicated solver module: piscina worker pool separate from duel workers
- WS handlers: SOLVER_START, SOLVER_PROGRESS, SOLVER_RESULT, SOLVER_CANCEL, SOLVER_CANCELLED
- Strategy pattern: `SolverStrategy` interface with DFS + SP-MCTS implementations
- WASM snapshot via `WebAssembly.instantiate` hook with automatic fallback to replay-from-scratch
- Interruption tagging: static JSON file, manually editable. **Pre-filled with top 50 meta end-board cards.** UI admin → Growth.

### Backend — Spring Boot (minimal impact)

- No new REST endpoint required for MVP
- Decks already exposed via existing API
- PostgreSQL not required for tags (JSON file for MVP)

### Implementation Considerations

- **No new dependencies** — CDK Tree already installed, no d3/vis-network
- **Contextualized score** — Display "3 interruptions (2 omni-negate, 1 destruction)" not a raw number. Board summary at path end.
- **Enriched annotations** — "Activate Branded Fusion → send Albaz + Lubellion → Fusion Summon Mirrorjade", not just "Activate effect"
- **Meta deck profiling** — Profile 3 real meta decks (Snake-Eye, Branded, Tearlaments) from dev start. CI regression: "top 5 meta decks < 60s Optimal"
- **Handtrap validation** — Cross-validation golden suite vs manual test. "Verify" mode replays the line with handtrap at declared timing.
- **WASM snapshot safety** — Pin exact `@n1xx1/ocgcore-wasm` version (no `^`). Smoke test at boot. Log WARNING if replay fallback activated.
- **Pre-filled interruption tags** — Top 50 meta end-board cards. User completes for their specific cards.
- **Desktop-first** — Tree viewer designed for desktop. No mobile-specific target for MVP.

## Product Scope & Phased Development

### MVP Strategy

**Approach:** Problem-solving MVP — smallest product that validates "an automated solver is useful for Yu-Gi-Oh! deck optimization."

**Resource:** Solo dev (Axel). Existing duel-server + Angular frontend.

**Implementation Sequence:**
1. GameOracle interface + OCGCoreAdapter (foundation)
2. DFS + Iterative Deepening (first algorithm, baseline)
3. Zobrist hashing + transposition table
4. Goldfish solver functional (Journey 1 complete)
5. SP-MCTS (second algorithm via Strategy swap)
6. piscina worker pool + root parallelism
7. IS-MCTS determinization + handtrap modeling (Journey 2 complete)
8. WS protocol + Angular UI + CDK Tree viewer (Journey 3 complete)
9. Interruption tagging JSON (pre-filled top 50)
10. Golden test suite (30 hands)

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

## Functional Requirements

### Solve Configuration

- **FR1:** Player can select an existing deck as solver input
- **FR2:** Player can define a fixed hand (5 chosen cards) or request a random hand
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
- **FR21:** Each tree leaf displays a contextualized score (number of interruptions with detail by type: omni-negate, targeted negate, destruction, bounce, floodgate)
- **FR22:** In Adversarial mode, tree displays handtrap branches annotated with the handtrap and its activation timing
- **FR23:** System displays a global resilience score (worst-case minimax) for Adversarial mode
- **FR24:** Tree is pruned for readability: top-X branches per node (X configurable via server JSON)
- **FR25:** System returns a "no viable combo" diagnostic when no path leads to a board with at least 1 interruption
- **FR26:** Player can consult previous solve results from their session (client-side in-memory history)

### Interruption Scoring

- **FR27:** System evaluates final board quality via weighted scoring by interruption type
- **FR28:** Weights per interruption type are configurable via server JSON (omni-negate > targeted negate > destruction > bounce > floodgate)
- **FR29:** System reads interruption tags from a JSON file mapping each end-board card to its type, weight, and uses/turn
- **FR30:** Interruption database is pre-filled with top 50 meta end-board cards

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
- **NFR7:** Solver completes in < 60s Optimal for **top 20 meta decks** (source: masterduelmeta.com tier list, updated per banlist ~4x/year, CI regression)

### Reliability

- **NFR8:** Solver **always terminates** — max depth (50 actions) + loop detection (Zobrist hash)
- **NFR9:** If WASM snapshot fails, system **automatically falls back** to replay-from-scratch with visible WARNING log
- **NFR10:** Smoke test at duel-server boot **verifies WASM Memory hook** works and logs status
- **NFR11:** Solver pool uses at most **N configurable workers**, leaving minimum 2 cores for duel-server + event loop

### Data Integrity

- **NFR12:** Every returned sequence is **100% legal** — solver verifies as **integrated post-condition** (replay on OCGCore) before returning. Invalid sequences are silently filtered.
- **NFR13:** Golden test suite (30 hand-verified hands) passes with **100% concordance** after every solver change
- **NFR14:** Handtrap results validated by manual cross-check for each golden suite hand at initial validation and after major algorithm changes
- **NFR15:** Exact version of `@n1xx1/ocgcore-wasm` is **pinned** in package.json (no `^` range)

### Resource Management

- **NFR16:** Solver pool consumes at most a **configurable memory budget** (default: 512MB), warning logged at 80%
- **NFR17:** Each solve is **logged**: nodes explored, final score, total time, algorithm, mode, deck ID
