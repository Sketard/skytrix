---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Combo path solver & board optimizer for Yu-Gi-Oh! decks'
session_goals: 'Explore algorithms, heuristics, evaluation criteria, architecture, and feasibility for an automated combo path calculator that finds optimal end boards based on configurable criteria (ceiling, handtrap resilience, etc.)'
selected_approach: 'ai-recommended'
techniques_used: ['First Principles Thinking', 'Morphological Analysis', 'Chaos Engineering']
ideas_generated: 16
session_active: false
workflow_completed: true
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Axel
**Date:** 2026-03-22

## Session Overview

**Topic:** Combo path solver & board optimizer for Yu-Gi-Oh! decks
**Goals:** Explore algorithms, heuristics, evaluation criteria, architecture, and feasibility for an automated combo path calculator that finds optimal end boards based on configurable criteria (ceiling, handtrap resilience, etc.)

### Context Guidance

_Skytrix is an existing Yu-Gi-Oh! deck management app with a solo combo testing simulator and PvP online duels, built on Angular 19 + Spring Boot + a Node.js duel server using OCGCore WASM. The combo solver would extend this ecosystem._

### Session Setup

_Session initialized with focus on the ambitious challenge of automated combo path exploration and board evaluation. Key dimensions to explore: algorithmic approaches (tree search, graph traversal, constraint solving), evaluation criteria design, handtrap resilience modeling, computational feasibility, and integration with the existing OCGCore-based architecture._

## Technique Selection

**Approach:** AI-Recommended Techniques
**Analysis Context:** Combo path solver & board optimizer — complex algorithmic/combinatorial problem requiring systematic exploration

**Recommended Techniques:**

- **First Principles Thinking:** Deconstruct what a "combo" and "optimal board" fundamentally are before jumping to algorithms
- **Morphological Analysis:** Systematically explore all parameter combinations (algorithm type × evaluation criteria × scope × constraints)
- **Chaos Engineering:** Stress-test emerging solutions against handtraps, edge cases, and computational limits

**AI Rationale:** The problem space is enormous — jumping straight to algorithms risks premature convergence. This sequence forces deconstruction first (First Principles), then systematic exploration (Morphological), then adversarial stress-testing (Chaos) — mirroring how the solver itself should work.

## Technique Execution Results

### First Principles Thinking

**Interactive Focus:** Deconstructing primitives — what is a "combo", what is an "optimal board", what are the fundamental truths the solver must be built upon.

**Key Ideas:**

**[FP #1]**: Dual solver mode
_Concept_: Two distinct modes — "Goldfish" (no interaction, pure ceiling) and "Adversarial" (with specified handtraps, including all possible activation timings per chokepoint).
_Novelty_: The adversarial mode doesn't just test "opponent has Ash" but explores WHEN they activate it on each chokepoint.

**[FP #2]**: The path is the information
_Concept_: A solver node = game state + history of vulnerabilities traversed. Two identical boards reached differently have different values because resilience depends on the path taken.
_Novelty_: Prevents naive memoization — the solver must explore a tree, not just a graph.

**[FP #3]**: Scoring = weighted interruption count
_Concept_: The final board is evaluated by the weighted total of interruptions it offers (negates, destructions, bounces, etc.), not a composite metric.
_Novelty_: Simple, concrete metric — opens the door to configurable weighted scoring later.

**[FP #4]**: Minimax evaluation
_Concept_: The solver maximizes the final board's interruption score while a virtual opponent minimizes by choosing optimal handtrap activation timings. The "best combo" = the one whose worst case under optimal adverse play is the highest.
_Novelty_: Transforms the combo optimization problem into a game theory problem — well-studied framework with known algorithms (alpha-beta pruning, etc.).

**[FP #5]**: OCGCore as rules oracle
_Concept_: The solver does not reimplement any rules — it uses OCGCore WASM as a black box to get legal actions at each state, then explores the tree. Clear separation: OCGCore = rules, Solver = search strategy.
_Novelty_: Avoids titanic reimplementation work and guarantees rule fidelity, but creates strong dependency on OCGCore performance per node explored.

**Fundamental Truths Established:**

| # | Primitive | Decision |
|---|-----------|----------|
| 1 | Input | Defined or random hand, go first, optional opponent handtraps |
| 2 | Structure | Search tree (path = information, no naive memoization) |
| 3 | Opponent | Minimax — virtual opponent optimizes handtrap timings |
| 4 | Scoring | Weighted interruption count on final board |
| 5 | Engine | OCGCore WASM as oracle, solver as explorer |

### Morphological Analysis

**Interactive Focus:** Systematically exploring all parameter combinations across 6 dimensions of the solver design.

**Key Ideas:**

**[MA #1]**: Fast vs Optimal mode
_Concept_: The solver offers two modes — "Fast" (first good result found, time-bounded) and "Optimal" (exhaustive exploration, best guaranteed). User chooses based on need.
_Novelty_: Same solver usable as "quick check" during deckbuilding and "deep analysis" for tournament prep.

**[MA #2]**: Deferred algorithm choice (Strategy pattern)
_Concept_: The exploration strategy (DFS, MCTS, A*, etc.) will be determined by post-brainstorming technical research. The solver must be architected so the algorithm is swappable (Strategy pattern).
_Novelty_: Decouples solver architecture from algorithm choice — allows benchmarking multiple approaches on the same data.

**[MA #3]**: Execution on existing duel-server
_Concept_: The solver runs in the existing Node.js duel-server, reusing OCGCore WASM worker thread infrastructure. A solve can monopolize a thread — acceptable for MVP.
_Novelty_: Zero new infrastructure, minimal time-to-market. Isolation possible later if needed.

**[MA #4]**: OCGCore constraint — no rollback
_Concept_: OCGCore is forward-only. No undo, no snapshot, no clone. Any branch exploration requires creating a new duel and replaying all actions from the start. This is the most structuring constraint of the solver.
_Novelty_: Forces an architecture where exploration cost grows with depth — aggressive pruning becomes a necessity, not an optimization.

**[MA #5]**: Parallel worker pool
_Concept_: Each major tree branch is explored in its own worker thread with its own OCGCore instance. The worker replays seed + all responses from the start to reach the branch point, then explores its sub-branch.
_Novelty_: Transforms the "replay from scratch" constraint into an advantage — each worker is independent, no shared state, natural parallelism. Worker count becomes the main performance lever.

**[MA #6]**: Exhaustive filtered exploration — all deterministic actions
_Concept_: The solver explores all legal actions returned by OCGCore, except those involving randomness (random draw, excavate, coin flip, etc.). Combined with go-first filter (no combat).
_Novelty_: Simple, consistent rule aligned with FP #5 (determinism). No complex heuristic needed for filtering — it's binary: the action is deterministic or not.

**[MA #7]**: Decision tree as output
_Concept_: The solver returns an interactive decision tree — the main path (goldfish) + alternative branches for handtrap scenarios. "If Ash here → pivot to this line, final board = X interruptions. If no interaction → continue to Y interruptions."
_Novelty_: Transforms the solver from a simple "board calculator" into a true combo coach. The player learns not just the best combo but the complete game plan with all responses to interactions.

**[MA #8]**: Dual stop criterion
_Concept_: Fast mode = configurable time budget, returns best result found. Optimal mode = exhaustive exploration with max depth as safety guard.
_Novelty_: The depth guard prevents infinite loops (some combos can theoretically loop indefinitely).

**Morphological Matrix Summary:**

| Dimension | Decision |
|-----------|----------|
| Exploration algorithm | Deferred (tech research), Strategy pattern architecture |
| Mode | Fast (time-bounded) + Optimal (exhaustive) |
| Execution | Existing duel-server, worker thread pool |
| Game state | Replay-from-scratch per worker (OCGCore constraint) |
| Action scope | All deterministic actions, go-first filter |
| Output | Interactive decision tree (main path + handtrap branches) |
| Stop criterion | Time (Fast) / Exhaustive + max depth (Optimal) |
| Opponent | Minimax — virtual opponent optimizes timings |

### Chaos Engineering

**Interactive Focus:** Deliberately breaking the design to find flaws — combinatorial explosion, replay costs, loops, scoring weaknesses, output readability.

**Key Ideas:**

**[CE #1]**: Complexity detection + user guidance
_Concept_: The solver evaluates tree complexity before launching exploration (number of legal actions at first levels). If it exceeds a threshold, it asks the user to lock the first steps to reduce branching factor. "Your deck has too many branches — guide me on the first 3 actions."
_Novelty_: Human-machine hybrid — player knowledge prunes the top of the tree (where branching is widest), the solver exhaustively explores the rest.

**[CE #2]**: Replay-from-scratch cost — acceptable
_Concept_: Based on the POC architecture, a full multi-turn duel replay runs in < 2s. A turn 1 replay (~20-30 responses) would be in the order of a few ms. With thousands of branches, we're talking seconds, not minutes — feasible with the worker pool.
_Novelty_: The "no rollback" constraint that seemed prohibitive is actually manageable thanks to OCGCore WASM's raw speed.

**[CE #3]**: Handtraps as natural pruning
_Concept_: Handtraps reduce the tree rather than expanding it — an Ash Blossom that cuts a combo at step 5 eliminates all branches after. Minimax is viable because adverse scenarios produce shorter trees.
_Novelty_: Counter-intuitive — adding complexity (handtraps) makes the problem simpler, not harder.

**[CE #4]**: Dual anti-loop — max depth + repetition detection
_Concept_: Max depth (50 actions) as absolute safety net + hash of legal actions to detect loops. If the same set of actions returns → branch cut. No monotone scoring (would kill legitimate setup steps).
_Novelty_: Two independent, complementary mechanisms — one is brutal but guaranteed, the other is intelligent but might miss an edge case.

**[CE #5]**: Weighted interruption scoring
_Concept_: Each interruption type has a configurable weight — omni-negate > targeted negate > untargeted destruction > targeted destruction > bounce > floodgate (with bonus for permanent). Board score = weighted sum.
_Novelty_: Allows the solver to distinguish board quality, not just quantity. Configurable weights allow meta-adaptation (e.g., if the meta is combo-heavy, floodgates are worth more).

**[CE #6]**: Manual interruption tagging database
_Concept_: Each "boss" / interruption card is manually tagged in a database: interruption type (omni-negate, targeted negate, destruction, bounce, floodgate), uses per turn, conditions. The solver reads this tagging to score the final board.
_Novelty_: Precise and reliable. Maintenance is acceptable since only end-board cards matter (not the entire deck) — a few dozen cards per meta, not thousands.

**[CE #7]**: Pruned decision tree — top X branches only
_Concept_: The returned decision tree keeps only the top X best branches per decision node (configurable). Reduces noise and makes output readable. Detailed UX deferred to implementation.
_Novelty_: Pruning applies to the output too, not just the exploration.

**Stress Test Summary:**

| Scenario | Risk | Response |
|----------|------|----------|
| Combinatorial explosion | Decks too complex | Complexity detection + user guidance on first steps |
| Replay-from-scratch cost | Millions of replays | Acceptable — OCGCore WASM replays T1 in a few ms |
| Minimax × handtraps | Scenarios exploding | Handtraps cut branches → tree reduces |
| Infinite loops | Solver stuck | Max depth 50 + legal action hash for loop detection |
| Naive scoring | Bad board ranking | Configurable weighting per interruption type |
| Interruption tagging | Solver doesn't know what a card does | Manual end-board card database |
| Unreadable output | Tree too large | Top X branches per node, UX deferred |

## Idea Organization and Prioritization

### Thematic Organization

**Theme 1: Fundamental Solver Model**
- [FP #1] Dual mode — Goldfish + Adversarial with handtrap timings
- [FP #2] Path is information — game state + vulnerability history, no naive memoization
- [FP #4] Minimax — solver maximizes, virtual opponent minimizes via worst timing
- [FP #5] OCGCore as oracle — rules/strategy separation

**Theme 2: Execution Architecture**
- [MA #3] Existing duel-server — reuse Node.js + worker thread infra
- [MA #4] OCGCore forward-only constraint — no rollback, replay-from-scratch mandatory
- [MA #5] Parallel worker pool — each major branch in its own worker
- [CE #2] Replay acceptable — T1 in a few ms, thousands of branches feasible

**Theme 3: Exploration Control**
- [MA #1] Fast vs Optimal mode — time-bounded or exhaustive
- [MA #2] Swappable algorithm (Strategy pattern) — choice deferred to tech research
- [MA #6] All deterministic actions — random filter + go-first
- [MA #8] Dual stop criterion — time (Fast) / exhaustive + max depth (Optimal)
- [CE #1] Complexity detection + user guidance on first steps
- [CE #4] Anti-loop — max depth 50 + legal action hash

**Theme 4: Evaluation and Output**
- [FP #3] Scoring = weighted interruptions (omni-negate > targeted negate > destruction > bounce)
- [CE #5] Configurable weighting per interruption type
- [CE #6] Manual tagging database for end-board cards
- [MA #7] Interactive decision tree as output — main path + handtrap branches
- [CE #7] Pruned tree — top X branches per node only

**Breakthrough Concept:**
- [CE #3] Handtraps as natural pruning — adding adverse complexity reduces the tree instead of expanding it

### Next Steps

1. **Technical Research:** Benchmark exploration algorithms (DFS+pruning, MCTS, A*, Iterative Deepening) on a real deck/combo using OCGCore WASM to determine the best Strategy pattern implementation
2. **BMAD Planning Workflow:** Run full PRD → Architecture → UX → Epics workflow for the combo solver feature, using this brainstorming output as input context
3. **POC Solver:** Build a minimal proof-of-concept that explores a simple combo tree (single known deck, goldfish mode only) to validate feasibility and measure real performance
4. **Interruption Database:** Design the schema for the card tagging database (interruption types, weights, conditions)

## Session Summary and Insights

**Key Achievements:**
- 16 structured ideas across 4 themes covering the full solver design space
- 5 fundamental truths established as unshakeable foundation
- 8 architectural decisions mapped in a morphological matrix
- 7 stress-test scenarios identified and resolved
- 1 breakthrough insight (handtraps as natural pruning)

**Critical Discovery:** OCGCore's forward-only constraint (no undo/snapshot/clone) is the most structuring technical constraint. It forces replay-from-scratch per branch, making the parallel worker pool architecture and aggressive pruning non-negotiable design choices.

**Session Reflections:** The First Principles → Morphological → Chaos sequence proved highly effective for this type of complex technical problem. First Principles prevented premature convergence on algorithms, Morphological systematically covered the decision space, and Chaos Engineering revealed that the seemingly biggest risk (handtrap combinatorics) is actually self-limiting.
