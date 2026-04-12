---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: 'complete'
completedAt: '2026-04-06'
inputDocuments: ['prd-solver.md', 'architecture-solver.md', 'ux-design-specification-solver.md']
---

# skytrix Combo Path Solver - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the skytrix Combo Path Solver, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Player can select an existing deck as solver input
FR2: Player can define a fixed hand (1–5 chosen cards) or request a random hand (Fill Random completes to 5)
FR3: Player can choose solve mode: Goldfish (no interaction) or Adversarial (with handtraps)
FR4: Player can choose solve speed: Fast (time-bounded) or Optimal (exhaustive)
FR5: Player can select adverse handtraps from a predefined list (Ash Blossom, Nibiru, Effect Veiler, Maxx "C", Infinite Impermanence)
FR6: Player can launch a solve on the chosen configuration
FR7: System explores all legal game actions from any game state to find optimal combo paths
FR8: System supports at least 2 swappable exploration algorithms (DFS + SP-MCTS)
FR9: System parallelizes exploration via a dedicated worker pool (separate from duel workers)
FR10: System forks duel state to explore alternative branches
FR11: System detects and cuts infinite loops (max depth + legal action hash)
FR12: System avoids re-exploring equivalent game states reached via different action orderings
FR13: In Adversarial mode, system models a virtual opponent who activates handtraps at the optimal timing to maximize disruption
FR14: Player can see solve progress in real-time (nodes explored, current best score)
FR15: Player can cancel a running solve
FR16: System returns the best result found at any time (anytime behavior), even if solve is cancelled or timed out
FR17: System returns an interactive decision tree as the primary result
FR18: Player can see the recommended main path via a breadcrumb at the top of the result
FR19: Player can expand/collapse decision tree branches
FR20: Each tree node displays the action performed with an enriched annotation (card name + complete action description)
FR21: Each tree leaf displays a contextualized score (number of interruptions with detail by type: omni-negate, targeted negate, destruction, bounce, floodgate)
FR22: In Adversarial mode, tree displays handtrap branches annotated with the handtrap and its activation timing
FR23: System displays a global resilience score (worst-case minimax) for Adversarial mode
FR24: Tree is pruned for readability: top-X branches per node (X configurable via server JSON)
FR25: System returns a "no viable combo" diagnostic when no path leads to a board with at least 1 interruption
FR26: Player can consult previous solve results from their session (client-side in-memory history)
FR27: System evaluates final board quality via weighted scoring by interruption type
FR28: Weights per interruption type are configurable via server JSON (omni-negate > targeted negate > destruction > bounce > floodgate)
FR29: System reads interruption tags from a JSON file mapping each end-board card to its type, weight, and uses/turn
FR30: Interruption database is pre-filled with top 150 meta end-board cards
FR31: Player can launch a "verify" mode that replays the recommended line with a handtrap at the declared timing and confirms the result

### NonFunctional Requirements

NFR1: Fast mode returns a result in < 5 seconds on reference hardware (8-core dev server)
NFR2: Optimal mode returns a result in < 60 seconds on reference hardware
NFR3: WS progress messages arrive with latency < 100ms
NFR4: Initial decision tree render (50 nodes) displays in < 500ms
NFR5: Branch expand/collapse animates in < 50ms
NFR6: Solver page reaches time-to-interactive in < 1 second (lazy-loaded)
NFR7: Solver completes in < 60s Optimal for top 20 meta decks — deferred post-MVP, initial validation manual against 5 meta decks
NFR8: Solver always terminates — max depth (50 actions) + loop detection (Zobrist hash)
NFR9: If WASM snapshot fails, system automatically falls back to replay-from-scratch with visible WARNING log
NFR10: Smoke test at duel-server boot verifies WASM Memory hook works and logs status
NFR11: Solver pool uses at most N configurable workers, leaving minimum 2 cores for duel-server + event loop
NFR12: Every returned sequence is 100% legal — solver verifies as integrated post-condition (replay on OCGCore) before returning. Verification time included in Fast 5s / Optimal 60s budgets
NFR13: Golden test suite (30 hand-verified hands) passes with 100% concordance after every solver change
NFR14: Handtrap results validated by manual cross-check for each golden suite hand at initial validation and after major algorithm changes
NFR15: Exact version of @n1xx1/ocgcore-wasm is pinned in package.json (no ^ range)
NFR16: Solver pool consumes at most a configurable memory budget (default: 512MB), warning logged at 80%
NFR17: Each solve is logged: nodes explored, final score, total time, algorithm, mode, deck ID

### Additional Requirements

**From Architecture:**

- GameOracle interface: fork-based with handle tracking, destroyAll() safety net, snapshot fallback to replay-from-scratch, snapshotAvailable flag
- SolverStrategy interface: callback-based progress, AbortSignal cancellation, strategy metadata (name, supportsAdversarial)
- ActionRanker interface: optional pruning/ordering dependency for strategies
- DecisionNode data model: confidence scoring (0-1), prunedChildren count, truncated flag, children sorted by score desc
- SolverAction model: responseIndex, cardId, cardName, actionDescription
- ScoreBreakdown model: 15 interruption types with individual counts + total
- Worker pool: root parallelism via piscina dedicated pool, top-K aggregation across workers (default K=3), 1 solve per user, warm pool (idleTimeout keeps workers alive)
- Algorithm auto-detection: 100-node DFS probe → measure BF → if BF < 12 continue DFS, else switch to MCTS. SOLVER_START accepts 'dfs' | 'mcts' | 'auto' (default: 'auto')
- Zobrist hashing: dual 32-bit number (not BigInt), incremental O(1) per action, verification key for transposition table
- Transposition table: Map per worker per solve, max entries configurable (default 100K), DFS only (MCTS does not use)
- 15 interruption types with configurable weights + fallback heuristic (1 base point per face-up monster for untagged cards)
- 8 WS message types: SOLVER_START, SOLVER_CANCEL, SOLVER_INIT, SOLVER_PROGRESS, SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR, SOLVER_HANDTRAPS
- SOLVER_INIT sent by client on solver page entry → server responds with SOLVER_HANDTRAPS (handtrap list from handtraps.json, single source of truth, no frontend hardcode)
- SOLVER_START replaces any running solve (no solverId needed). Rate limit: max 1 per user per 2s (configurable)
- SOLVER_RESULT includes pre-computed mainPath (client doesn't traverse tree)
- SOLVER_CANCELLED returns partialTree if solver found at least one result (anytime behavior)
- 4 config JSON files loaded at boot: solver-config.json, interruption-tags.json, interruption-weights.json, handtraps.json
- Config validation at boot with typed schema, exit on invalid
- Adversarial mode: OCGCore 2-player duel with ALL selected handtraps injected into opponent hand via duelNewCard(). SELECT_CHAIN routed to adversarial policy. Minimax MCTS with two-player backpropagation — opponent always has access to the full handtrap set, minimax emerges from tree search over activation timing
- Golden test suite: 30 standardized JSON fixtures (15 combo, 15 brick), 100% concordance
- SolverDebugLogService: client-side debug logging gated by environment.debugTools, same pattern as PvP DebugLogService
- Solver logging: console.log/warn/error with [Solver] prefix, matching existing duel-server pattern (e.g., [UpdateData])
- Worker debug channel via MessagePort: { type: 'debug', cat, data } — orchestrator logs if LOG_LEVEL=debug
- No new dependencies: CDK Tree, piscina already available
- Starter template: not applicable (brownfield)
- Backend solver-types.ts is source of truth — frontend solver.model.ts must match in same commit

**From UX (with replay-aligned corrections):**

- Layout: full-viewport like replay (NOT sidebar 280px). Config panel horizontal at top, collapsible after first solve (transport bar pattern). Result area below, full width — maximizes horizontal space for tree indentation
- Loading state: mat-progress-spinner indeterminate + progressive text (replay pattern), NOT mat-progress-bar. Text: "Exploring combo lines... {nodes} nodes, best score: {score}"
- Error handling: effect watches error signal → displayError() snackbar with "Dismiss" action button, no auto-dismiss (critical errors like WASM_INIT_FAILED must not disappear unnoticed)
- Service scoping: SolverService `providedIn: 'root'` — manages WS communication and session history. Registers SOLVER_* handlers on the shared WS connection at construction, processes messages regardless of current route (result resilience). No component-scoped adapter (unlike PvP — solver has 1 global solve per user)
- Keyboard system: tabindex="0" on host, @HostListener('keydown') with switch/case, guard on input/textarea (replay pattern). Ctrl+Enter = solve, Escape = cancel. CDK Tree native keyboard nav (arrows, Enter)
- Preference persistence: localStorage for mode, speed, handtraps, algorithm (replay pattern). Hand selection persisted in SolverService signal per deck (resets on deck change)
- Hero + end board fused block: goldfish = 1 line (score left, end board right), adversarial = 2 lines (score + minimax first, end board second)
- Breadcrumb: mat-chip-listbox with card art thumbnail (32x46px) + chevron_right between chips. Horizontal scroll, never wraps. mat-tooltip for full annotation on hover. Click chip scrolls tree to corresponding node
- Decision tree: CDK flat tree (CdkTree + CdkTreeNode), getLevel() for 24px indentation. Main path expanded + root children collapsed at load (~10-15 lines). Score delta on root-level alternatives ("+3" / "-5 vs main")
- Hand selector: deduplicated card art grid (1 per unique card, xN counter), click = +1 copy. Main deck only. Solve enabled with 1–5 cards. Fill Random completes to 5. Quick Solve = Fill Random + auto-launch
- Pin & compare: max 4 pins, visible across decks. Each pin card: score, mini hand cards, mini end board cards, mode label, deck name, deckSeed, unpin button. Flat list, no hide/restore logic
- 5 interruption chip color families: Negate (purple), Removal (orange), Control (teal), Disable (amber), Hand (grey). SCSS variables $solver-chip-* in src/app/styles/. Chips use mat-chip with text label "type xN"
- Two brick states: pure-brick ("No viable combo — try a different hand") and no-resilient-line ("No resilient line found" + goldfish score reference)
- Fallback scoring indicator: info_outline icon + mat-tooltip for untagged cards, dashed border on end board cards scored via fallback heuristic
- Card art hover enlargement: 120x175px popup via mat-tooltip (different from existing CardInspector click-mode — solver-specific for quick preview without modal)
- Card art sizing: $card-thumb-sm 32x46px (breadcrumb/tree), $card-thumb-md 56x82px (end board)
- Rate limit: Solve button disabled during 2s cooldown, simple disabled state (no micro-timer)
- State machine: loading → idle → configuring → running → complete/cancelled/error. loading = deck fetch from route param (mat-progress-spinner). cancelled is transitional: partialTree → complete with "Partial result" chip badge, no partialTree → configuring
- Partial result: hero block + "Partial result" mat-chip outline badge next to score
- WCAG AA: contrast on chip families, CDK Tree native ARIA, aria-labels on custom components, aria-live="polite" on progress stats, role="alert" on brick states
- Desktop-only: min 1024px. Message below 1024px: "Solver requires a desktop browser (1024px minimum)"
- Score display: mat-headline-4 for global score ("35 — 3 interruptions"), breakdown chips below
- Handtrap branch labels: secondary text color + small card art thumbnail, no red/danger treatment

### FR Coverage Map

| FR | Epic | Description |
|---|---|---|
| FR1 | Epic 1 | Deck selection |
| FR2 | Epic 1 | Hand definition (fixed/random) |
| FR3 | Epic 1 (goldfish) + Epic 2 (adversarial) | Solve mode selection |
| FR4 | Epic 1 | Speed selection (Fast/Optimal) |
| FR5 | Epic 2 | Handtrap selection |
| FR6 | Epic 1 | Launch solve |
| FR7 | Epic 1 | Legal action exploration |
| FR8 | Epic 1 | 2 algorithms (DFS + MCTS) |
| FR9 | Epic 1 | Worker pool parallelism |
| FR10 | Epic 1 | State forking |
| FR11 | Epic 1 | Loop detection |
| FR12 | Epic 1 | Transposition (avoid re-exploring) — **DFS only**. MCTS uses independent rollouts without transposition table (Phase 2: lightweight MCTS cache for early-game states) |
| FR13 | Epic 2 | Adversarial handtrap modeling |
| FR14 | Epic 1 | Real-time progress |
| FR15 | Epic 1 | Cancel solve |
| FR16 | Epic 1 | Anytime behavior |
| FR17 | Epic 1 | Decision tree result |
| FR18 | Epic 1 | Breadcrumb main path |
| FR19 | Epic 1 | Expand/collapse branches |
| FR20 | Epic 1 | Enriched annotations |
| FR21 | Epic 1 | Contextualized score |
| FR22 | Epic 2 | Handtrap branch annotations |
| FR23 | Epic 2 | Global minimax resilience score |
| FR24 | Epic 1 | Tree pruning (top-X) |
| FR25 | Epic 1 | Brick diagnostic |
| FR26 | Epic 3 (Story 3.1 + 3.1b) | Session history (data + UI) |
| FR27 | Epic 1 | Weighted scoring |
| FR28 | Epic 1 | Configurable weights |
| FR29 | Epic 1 | Interruption tags JSON |
| FR30 | Epic 1 | Pre-filled 150 meta cards |
| FR31 | Epic 2 | Verify adversarial path replay |

## Epic List

### Epic 1: Goldfish Combo Discovery
User selects a deck and hand, launches a goldfish solve (Fast or Optimal), and sees the complete result: score, end board, recommended path breadcrumb, and interactive decision tree with expand/collapse, enriched annotations, and contextualized scoring. Full vertical slice from engine to UI. Both DFS and MCTS algorithms. Interruption scoring with configurable weights and pre-filled tags. Progress streaming, cancellation, and anytime behavior.
**FRs covered:** FR1, FR2, FR3 (goldfish), FR4, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR14, FR15, FR16, FR17, FR18, FR19, FR20, FR21, FR24, FR25, FR27, FR28, FR29, FR30

### Epic 2: Handtrap Resilience Analysis
User switches to adversarial mode, selects handtraps from a predefined list, and sees the resilience analysis: global minimax score, handtrap branches annotated in the decision tree with activation timing, and no-resilient-line brick state. Extends the goldfish engine with Minimax MCTS adversarial, handtrap injection via OCGCore 2-player duel, and adversarial UI elements.
**FRs covered:** FR3 (adversarial), FR5, FR13, FR22, FR23, FR31

### Epic 3: Iterative Build Comparison
User iterates rapidly between solves and compares builds: pin result snapshots for side-by-side mental comparison, consult session history, Quick Solve (Fill Random + auto-launch), config persistence per deck via localStorage, and keyboard shortcuts (Ctrl+Enter to solve, Escape to cancel). These velocity features make Journey 3 (Build Comparison) fluid.
**FRs covered:** FR26

> **Testing approach:** Big bang — integration testing happens after all stories within an epic (or across epics) are complete. Individual stories must produce complete, compilable, architecture-compliant code, but end-to-end functionality is not expected until final integration. AC verify code correctness and architectural compliance, not runtime integration.

---

## Epic 1: Goldfish Combo Discovery

User selects a deck and hand, launches a goldfish solve (Fast or Optimal), and sees the complete result: score, end board, recommended path breadcrumb, and interactive decision tree with expand/collapse, enriched annotations, and contextualized scoring.

> **Post-implementation validation:** golden-tests.json (30 hand-verified test cases: 15 combo, 15 brick) and its runner must be created as a validation artifact after all stories are implemented. NFR13 concordance is verified during big bang testing, not within individual stories. **Golden tests run DFS only** (`algorithm: 'dfs'`) — DFS is deterministic given a deckSeed, so 100% concordance is well-defined. MCTS coverage is via manual validation (NFR14). At least 1 golden test case must involve a multi-chain combo with OPT effects (e.g., Baronne), run with and without WASM snapshot to detect restore divergence.

### Story 1.1: Solver Types, Config & GameOracle

As a developer,
I want the solver's foundational types, configuration system, and game oracle adapter in place,
So that all subsequent solver stories build on a validated, type-safe foundation with a working OCGCore interface.

**Acceptance Criteria:**

**Given** the duel-server codebase
**When** Story 1.1 is implemented
**Then** `solver-types.ts` exports all data types: DuelConfig, Action, FieldState, FieldCard, DecisionNode, SolverAction, ScoreBreakdown (15 types + total), SolverConfig, SolverResult, SolverStats, SolverProgress, HandtrapConfig, AdversarialTiming, GoldenTestCase
**And** `game-oracle.ts` exports the GameOracle interface (createDuel, getLegalActions, applyAction, fork, getFieldState, destroyDuel, destroyAll, snapshotAvailable) and DuelHandle type
**And** `solver-strategy.ts` exports the SolverStrategy interface (name, supportsAdversarial, solve) and ActionRanker interface (rank)

**Given** the 4 config JSON files in `duel-server/data/`
**When** the duel-server boots
**Then** `solver-config.json` is loaded and validated against the typed schema (poolSize 1-32, maxDepth 10-100, timeBudgetFastMs 1000-30000, timeBudgetOptimalMs 5000-300000, progressThrottleMs 50-2000, treePruningTopX 1-50, maxResultNodes 50-5000, transpositionMaxEntries 1000-100000 default 25000, memoryBudgetMb 128-4096, bfComplexityThreshold 5-100, rateLimitIntervalMs 500-10000, maxHandtraps 1-10, ucb1C 0.5-3.0, backpropPolicy 'max'|'mean', rolloutEpsilon 0.0-1.0 default 0.1, verificationBudgetRatio 0.05-0.30 default 0.15)
**And** `interruption-weights.json` is loaded and validated (each of 15 types has weight 0-100)
**And** `interruption-tags.json` is loaded and validated (cardId → effects[] with type in 15 types, usesPerTurn 1-10). Weights are NOT stored per-card — they come from `interruption-weights.json` (global per-type)
**And** at boot, each cardId in `interruption-tags.json` is verified against the loaded card pool; unknown cardIds produce a WARNING log listing the stale entries (cards may have been banned, errata'd, or removed between updates)
**And** `handtraps.json` is loaded and validated (5 entries with cardId > 0 and non-empty cardName)
**And** any field outside its range causes an ERROR log with field name + value + expected range and process exit

**Given** a valid DuelConfig
**When** OCGCoreAdapter.createDuel() is called
**Then** a DuelHandle is returned and tracked in the adapter's active handle Set

**Given** an active DuelHandle
**When** fork() is called
**Then** the adapter tries WASM Memory snapshot first
**And** on snapshot failure, logs WARNING and falls back to createDuel() + replay all actions from source handle
**And** the snapshotAvailable flag reflects the outcome
**And** the WASM snapshot buffer is released immediately after the new DuelHandle is created — no concurrent snapshots exist on the call stack (DFS backtrack calls destroyDuel() on the child handle before the next fork, so at most 1 transient snapshot exists at any time)

**Given** an active DuelHandle
**When** getLegalActions() is called
**Then** an array of Action objects is returned representing all currently legal actions
**And** the adapter translates OCGCore multi-step prompts (SELECT_CHAIN, SELECT_CARD, SELECT_POSITION, SELECT_IDLECMD, SELECT_BATTLECMD, etc.) into discrete Action objects that the solver can enumerate and apply
**And** each Action maps to a single responseIndex that can be passed back to OCGCore via applyAction()
**And** prompts are classified as exploratory or mechanical:
  - **Exploratory** (become tree branches): SELECT_IDLECMD, SELECT_BATTLECMD, SELECT_CHAIN, SELECT_EFFECTYN, SELECT_YESNO, SELECT_OPTION
  - **Mechanical** (auto-resolved, single default response): SELECT_POSITION (default: ATK), SELECT_PLACE (default: leftmost available zone), SELECT_TRIBUTE, SELECT_SUM, SELECT_COUNTER, SELECT_DISFIELD
  - This classification controls branching factor — mechanical prompts do NOT generate multiple Action children
  - The classification is configurable (data-driven, not hardcoded) so it can be revised per deck archetype without architectural change. MVP defaults are optimized for standard combo decks
  - **SELECT_CHAIN goldfish pruning:** In goldfish mode, SELECT_CHAIN for player 0 is the primary source of BF inflation (10-20 trigger effects per turn on combo decks). The default `GoldfishChainRanker` (see ActionRanker in architecture) reduces this: single legal activation → auto-resolve (mechanical); multiple activations → rank "activate" above "pass" for beneficial effects (draw, search, special summon), identified by pattern-matching against OCGCore's response buffer effect descriptions (NOT `duelQueryField()` — which returns field state, not pending activation data); "pass" is deprioritized but not removed. This reduces effective BF from ~40 to ~12-15 for typical combo decks

**Given** an active DuelHandle
**When** getFieldState() is called
**Then** a FieldState is returned with zones (Record<ZoneId, FieldCard[]>), lifePoints, turn, phase

**Given** an active DuelHandle
**When** destroyDuel() is called
**Then** the handle is removed from the active Set and the OCGCore duel is properly released

**Given** any state
**When** destroyAll() is called
**Then** all active handles are destroyed (safety net for finally blocks)

**Given** a `duelProcess()` call that hangs (buggy Lua card script)
**When** the worker's event loop is blocked by the synchronous WASM call
**Then** no per-call timeout is possible inside the worker (setTimeout cannot fire during a synchronous WASM call)
**And** the only backstop is the orchestrator's hard-kill timeout (1.5× time budget) on the main thread, which calls `worker.terminate()` to kill the stuck worker

**Given** the duel-server starting up
**When** the first solver worker initializes
**Then** a WASM Memory hook smoke test runs and logs INFO with the result (snapshot available or not)
**And** if the smoke test fails, the worker sets snapshotAvailable = false, logs WARNING, and continues operating in replay-from-scratch mode — the worker does NOT exit on smoke test failure

---

### Story 1.2a: Zobrist Hashing & Transposition Table

As a developer,
I want Zobrist hashing for game state fingerprinting and a transposition table for memoization,
So that the DFS solver can detect loops and avoid re-exploring equivalent game states.

**Acceptance Criteria:**

**Given** the Zobrist hasher
**When** initialized per worker at boot
**Then** the Zobrist table is pre-generated with crypto PRNG: zobrist[cardId][zoneId][position]
**And** hash is 64-bit via two 32-bit numbers (not BigInt)
**And** hash components include card positions across ALL zones (monster, spell/trap, hand, GY, banished, extra, deck) + phase + turn count modulo 4. GY and banished zones are included because they directly affect legal actions (GY recursion, banished recovery) — excluding them causes false transposition hits
**And** HAND, GY, and BANISHED are hashed as multisets (`position` fixed to 0) so different draw/discard orderings of the same cards collide intentionally. EXTRA still uses positional indexing because face-up vs face-down matters for Pendulum monsters. DECK uses a count-only hash (player doesn't know deck order). Only monster and spell/trap zones use full positional indexing (zone slot matters for legality)
**And** updates are incremental O(1) per action via XOR

**Given** the transposition table
**When** a new solve starts
**Then** the table is reset (empty Map)
**And** max entries is bounded by config (default 25K — reduced from 100K to fit within per-worker V8 heap cap; ~300-400 bytes/entry × 25K ≈ 7-10MB per worker)
**And** replacement policy: replace if new depth ≥ existing

**Given** a transposition table lookup
**When** a game state hash matches a transposition entry with valid verification key and depth ≥ current
**Then** the cached score and bestAction are reused instead of re-exploring
**And** stale actions (not in current legal action set) trigger re-exploration
**And** the verification key fingerprint includes: cards-per-zone + top card IDs + overlay counts per zone + face-down flag count per zone + per-card OPT-spent flags (read from OCGCore's effect-used flags via `duelQueryField()`'s effect status payload). OPT flags are required because cards like Baronne de Fleur (omni-negate, OPT) leave no visible board change after the first activation — a board reached via "Baronne already used" vs "Baronne fresh" has identical layout but different legal-action sets. Without OPT flags, the transposition table produces false score hits on these states

**Given** a golden test hand involving a multi-chain combo with OPT effects (e.g., Baronne de Fleur)
**When** the same board is reached via two different activation orders
**Then** the transposition table does NOT produce a false score hit (verification key diverges on overlay or face-down differences)

---

### Story 1.2b: Interruption Scorer & Tags Data

As a developer,
I want a board evaluation system that scores end boards by interruption quality,
So that the solver can rank combo paths by the defensive value of their final board.

**Acceptance Criteria:**

**Given** a FieldState at a terminal node (no more legal actions or max depth reached)
**When** the interruption scorer evaluates the board
**Then** it computes score = sum(weight × usesPerTurn) for each tagged card on player 0's field
**And** each card's effects are looked up from interruption-tags.json by cardId
**And** weights per type come from interruption-weights.json
**And** ScoreBreakdown contains individual counts for all 15 types plus total

**Given** a face-up monster on the field that has no entry in interruption-tags.json
**When** the scorer evaluates it
**Then** it receives 1 base point via the fallback heuristic (prevents false bricks for rogue decks)
**And** fallback points are tracked separately in `ScoreBreakdown.fallbackPoints` (NOT folded into `total`) so brick detection can ignore them

**Given** a terminal node where the sum of weighted interruption scores (excluding fallback heuristic points) is 0
**When** the solver evaluates it
**Then** it is marked as a brick path (FR25). A board with untagged face-up monsters but zero tagged interruptions is still a brick — the fallback heuristic exists for tie-breaking between non-brick paths, NOT to suppress brick detection

**Given** the interruption-tags.json data file (FR30)
**When** Story 1.2b is delivered
**Then** interruption-tags.json contains at least 150 entries for meta end-board cards (e.g., Baronne de Fleur, Apollousa, Borreload Savage Dragon, Mirrorjade, Accesscode Talker, etc.)
**And** each entry has correct effects[] with type and usesPerTurn matching the card's actual game effects (weight is looked up from interruption-weights.json by type, not stored per-card)
**And** cards with multiple interruption types have multiple effects entries (e.g., Baronne = omni-negate + destruction)

---

### Story 1.2c: DFS Solver Algorithm

As a developer,
I want a DFS exploration algorithm that uses the Zobrist hasher, transposition table, and interruption scorer,
So that the solver can find optimal combo paths from any game state via exhaustive depth-first search.

**Acceptance Criteria:**

**Given** a GameOracle instance, a SolverConfig (goldfish, fast or optimal), and an AbortSignal
**When** DFS solve() is called
**Then** it explores legal actions depth-first from the initial game state
**And** respects maxDepth (50 actions) as a hard termination limit
**And** returns a SolverResult with tree (DecisionNode), mainPath (SolverAction[]), score, scoreBreakdown, and stats

**Given** a strategy (DFS or MCTS) receives a SolverConfig with `timeLimitMs` and `verificationBudgetRatio`
**When** the strategy begins exploration
**Then** it MUST treat its effective exploration budget as `timeLimitMs * (1 - verificationBudgetRatio)` (default 85% of `timeLimitMs`)
**And** the strategy MUST self-halt exploration when the elapsed time crosses this internal deadline, returning the best result found so far so the worker can run verification (Story 1.3) before the orchestrator's hard-kill timeout
**And** the AbortSignal is the outer guarantee — the internal deadline is the strategy's contractual obligation. A strategy that ignores its internal deadline and only stops on AbortSignal violates the contract because verification is then either skipped or runs past the user-visible time budget

**Given** a DFS exploration in progress
**When** the same Zobrist hash is encountered on the current path
**Then** the branch is cut (loop detection) and the solver backtracks

**Given** a DFS exploration in progress
**When** nodesExplored % 100 === 0 OR 200ms elapsed since last progress
**Then** onProgress() is called with { nodesExplored, bestScore, elapsed }

**Given** a running DFS solve
**When** signal.aborted becomes true
**Then** the solver stops exploration and returns the best result found so far (anytime behavior)

**Given** the DFS strategy
**When** inspecting its metadata
**Then** name is 'dfs' and supportsAdversarial is false

**Given** the DFS solver exploring SELECT_CHAIN actions in goldfish mode
**When** legal actions are retrieved for a player 0 SELECT_CHAIN prompt
**Then** GoldfishChainRanker is applied as the default ActionRanker
**And** single legal activation → auto-resolved (treated as mechanical, no branch)
**And** multiple activations → "activate" ranked above "pass" for beneficial effects (draw, search, special summon), identified by pattern-matching against OCGCore's response buffer effect descriptions (e.g., patterns containing "draw", "add.*from.*Deck.*to.*hand", "Special Summon"). Unrecognized effects default to "beneficial" (activate > pass)
**And** "pass" is deprioritized but not removed from the action list
**And** the classification is heuristic-based (hardcoded in `goldfish-chain-ranker.ts`, not a config JSON)

**Given** a completed DFS tree
**When** the result is built
**Then** children arrays are sorted by score descending (first child = recommended path)
**And** confidence is set to 1.0 for exhaustively explored nodes, 0.5 for pruned nodes

**Given** 3 golden test hands with known SELECT_CHAIN branching patterns
**When** DFS runs with GoldfishChainRanker enabled
**Then** the measured average branching factor is within ±3 of the expected value (target: ~12-15 for standard combo decks, down from ~40 without ranker)

---

### Story 1.3: Worker Pool & Orchestrator

As a developer,
I want the solver orchestrator to manage a piscina worker pool with root parallelism and result aggregation,
So that solves are parallelized across cores and the best result is returned efficiently.

**Acceptance Criteria:**

**Given** the duel-server boot sequence
**When** the solver orchestrator initializes
**Then** a piscina pool is created separate from the duel worker pool
**And** pool size defaults to `Math.max(1, os.availableParallelism() - 2)` (clamped floor of 1 for low-core hosts: CI runners, 1–2 core VMs); configurable via solver-config.json
**And** idleTimeout keeps workers alive between solves (warm pool)

**Given** a valid solve request (deck + hand + config)
**When** the orchestrator dispatches work
**Then** each worker in the pool receives an independent task. All workers receive the **same** shuffled deck (seeded once by `deckSeed` server-side, see Story 1.4) — not different shuffles
**And** for **MCTS**, each worker is given a distinct `mctsSeed` (derived from `deckSeed + workerIndex`) that drives rollout randomization, so workers explore different stochastic trajectories of the same deck. Root parallelism is meaningful here
**And** for **DFS** (deterministic given a deck order), running multiple workers on identical input is wasteful. The orchestrator dispatches DFS to a **single** worker regardless of pool size; remaining workers stay idle. The pool exists for MCTS and `auto`-selected MCTS solves
**And** workers operate with zero synchronization (root parallelism)

**Given** multiple workers returning SolverResults
**When** all workers complete (or abort)
**Then** the orchestrator aggregates top-K trees per worker (default K=3)
**And** merges all top-K trees: (1) keep global best by score; (2) when two results share the same `mainPath` action-sequence hash, **merge** their alternative subtrees (union children at each shared level, deduplicating identical action-edges) rather than discarding the lower-scoring duplicate — this preserves distinct alternative branches that happen to share a recommended path; (3) keep up to `treePruningTopX` distinct top-level alternatives sorted by score
**And** the final tree is pruned: top-X children per node (configurable, default 5) and maxResultNodes (default 500)
**And** mainPath is extracted from the best tree (first child at each level)
**And** prunedChildren count is set on nodes where branches were removed
**And** truncated flag is set on subtrees cut by maxResultNodes

**Given** a user already has a running solve
**When** a new SOLVER_START arrives
**Then** the current solve is aborted (AbortController.abort()) before launching the new one
**And** concurrency is 1 solve per user

**Given** workers emitting progress via MessagePort
**When** progress arrives from multiple workers
**Then** the orchestrator aggregates: max bestScore across workers, sum nodesExplored
**And** emits aggregated progress at most every 200ms (throttled)

**Given** a completed or cancelled solve
**When** the result is ready
**Then** the orchestrator logs the solve: deckId, algorithm, mode, speed, nodesExplored, finalScore, elapsedMs, workersUsed, snapshotAvailable (NFR17)
**And** logging uses console.log('[Solver] solve-complete', { deckId, algorithm, mode, speed, nodesExplored, finalScore, elapsedMs, workersUsed, snapshotAvailable })

**Given** workers emitting debug entries via MessagePort ({ type: 'debug', cat, data })
**When** LOG_LEVEL=debug
**Then** the orchestrator logs them via console.log('[Solver:debug]', ...)
**And** when LOG_LEVEL is not debug, debug entries are discarded

**Given** the piscina pool creation
**When** workers are spawned
**Then** each worker is configured with `resourceLimits.maxOldGenerationSizeMb = (memoryBudgetMb - (poolSize × 20)) / poolSize` (reserves 20MB per worker for WASM linear memory which lives outside V8's managed heap). Example: 512MB budget, 6 workers → (512 - 120) / 6 ≈ 65MB V8 heap per worker
**And** if a worker exceeds its V8 heap limit, V8 terminates it with an OOM error
**And** the orchestrator catches the worker crash, logs WARNING, and returns SOLVER_ERROR { error: 'MEMORY_LIMIT', message: 'Solver worker exceeded memory limit' }

**Given** the configured per-worker V8 heap cap
**When** the post-implementation big bang test runs
**Then** a memory smoke test executes a worst-case Optimal solve (a meta combo deck — Snake-Eye or Branded — with a 5-card combo hand) under the default 65MB cap and confirms no OOM occurs
**And** if the smoke test OOMs, the default `memoryBudgetMb` in `solver-config.json` is raised until the worst-case solve fits, and the new value is recorded in the smoke test artifact
**And** the smoke test result is captured as a validation artifact alongside `golden-tests.json`

**Given** a solve dispatched to workers
**When** the orchestrator starts the solve
**Then** a hard-kill `setTimeout` is set at `timeLimitMs * 1.5` wrapping the `Promise.allSettled()` of all worker tasks
**And** if the timeout fires (worker stuck in a WASM call or missed AbortSignal check), the orchestrator calls `AbortController.abort()`, calls `worker.terminate()` on any worker that did not honor the abort within 250ms, and resolves with whatever results are available. If no results, returns SOLVER_ERROR { error: 'INTERNAL_ERROR', message: 'Solve hard-kill timeout exceeded' }
**And** under normal operation this timeout never fires (AbortSignal terminates first)

**Given** a solve in progress
**When** no `SOLVER_PROGRESS` aggregate has advanced (`nodesExplored` unchanged) for `stalledWarningMs` (default 3000ms, configurable)
**Then** the orchestrator emits `SOLVER_PROGRESS { ..., stalled: true }` so the frontend can switch the spinner copy from "Exploring combo lines..." to "Resolving complex effect..." instead of showing a frozen spinner
**And** when progress resumes, the next `SOLVER_PROGRESS` clears the flag (`stalled: false`)
**And** if every worker is simultaneously stalled at the moment the hard-kill fires, the resulting `SOLVER_ERROR` includes `cause: 'all_workers_stalled'` so the frontend can display a deck-content diagnostic ("A card effect in this deck caused the solver to hang — try removing recently added cards") rather than a generic internal error

**Given** a solve in progress
**When** the orchestrator receives a cancel signal
**Then** it aborts all workers and returns the best partial result (if any) as partialTree

**Given** a worker completing its solve
**When** it has a best result to return
**Then** it verifies its top-K results (default K=3) by replaying each action sequence on a fresh OCGCore duel (legality post-condition NFR12)
**And** verification time is included in the time budget (Fast 5s / Optimal 60s). Strategies MUST reserve `verificationBudgetRatio` (default 15%) of their time budget for verification (e.g., Fast → explore 4.25s, verify 0.75s). Cost estimate: ~62ms per path (60ms duel creation + action replay), ×3 paths = ~186ms per worker
**And** if a path fails verification, it is silently removed from the top-K set and the worker recomputes mainPath from the remaining valid paths
**And** each invalidation is logged server-side (NFR17) but not surfaced to the user

---

### Story 1.4: WS Protocol & Server Integration

As a developer,
I want the solver WebSocket protocol integrated into the duel-server,
So that clients can start, monitor, and cancel solves over the existing WS connection.

**Acceptance Criteria:**

**Given** ws-protocol.ts
**When** Story 1.4 is implemented
**Then** 8 new message type constants are exported: SOLVER_START, SOLVER_CANCEL, SOLVER_INIT, SOLVER_PROGRESS, SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR, SOLVER_HANDTRAPS

**Given** a WS client sending SOLVER_INIT
**When** the server receives it
**Then** the server responds with SOLVER_HANDTRAPS { handtraps: HandtrapConfig[] } (content of handtraps.json) + any cached SOLVER_RESULT for the user
**And** the frontend reads the handtrap list from this message (single source of truth — no frontend hardcode)
**And** SOLVER_INIT is a request/response pattern (not fire-on-connect) because SolverService is lazily instantiated — a message sent on WS connect would be lost if the user hasn't visited the solver page yet

**Given** a connected WS client
**When** SOLVER_START is received with { deckId, hand, mode: 'goldfish', speed, algorithm, deckSeed? }
**Then** the orchestrator validates the config
**And** loads the deck via HTTP GET /api/decks/{deckId} with the user's JWT
**And** validates deck ownership via Spring Boot response
**And** shuffles remaining deck cards (after removing hand cards) with deckSeed (provided or server-generated)
**And** dispatches the solve to the worker pool

**Given** SOLVER_START with algorithm field
**When** algorithm is 'dfs', 'mcts', or 'auto' (default: 'auto')
**Then** the orchestrator selects the appropriate strategy

**Given** a SOLVER_START within 2s of the previous one (same user)
**When** the rate limit is hit
**Then** SOLVER_ERROR { error: 'RATE_LIMITED', message } is returned

**Given** a solve in progress
**When** the orchestrator produces progress updates
**Then** SOLVER_PROGRESS { nodesExplored, bestScore, elapsed, highComplexity? } is sent to the client
**And** progress is throttled at 200ms server-side
**And** highComplexity is set to true if measured BF > bfComplexityThreshold after 100 nodes

**Given** a solve completing successfully
**When** the result is ready
**Then** SOLVER_RESULT { tree, mainPath, score, scoreBreakdown, minimax?, adversarialTimings?, stats, verified? } is sent
**And** stats includes deckSeed for reproducibility and algorithmUsed ('dfs' | 'mcts') reflecting the actual algorithm that ran (distinct from the requested algorithm which may be 'auto')
**And** in adversarial mode, `adversarialTimings` is an array of `AdversarialTiming` objects encoding opponent handtrap activations with their `stepIndex` in `mainPath` (needed for verify mode FR31)
**And** legality verification is handled by workers before returning results (see Story 1.3)

**Given** a connected WS client
**When** SOLVER_CANCEL is received
**Then** the current solve is aborted
**And** SOLVER_CANCELLED { partialTree?, stats } is returned
**And** partialTree is included if at least one result was found (anytime behavior FR16)

**Given** a deck loading failure (not found, access denied)
**When** SOLVER_START is processed
**Then** SOLVER_ERROR { error: 'DECK_NOT_FOUND' | 'DECK_ACCESS_DENIED', message } is sent

**Given** a WASM initialization failure
**When** a worker cannot start
**Then** SOLVER_ERROR { error: 'WASM_INIT_FAILED', message } is sent

**Given** an unexpected worker error
**When** the orchestrator catches it
**Then** SOLVER_ERROR { error: 'INTERNAL_ERROR', message } is sent and the error is logged

**Given** the SolverErrorMessage type
**When** Story 1.4 is implemented
**Then** the error field supports: 'DECK_NOT_FOUND' | 'DECK_ACCESS_DENIED' | 'WASM_INIT_FAILED' | 'RATE_LIMITED' | 'MEMORY_LIMIT' | 'INTERNAL_ERROR'

**Given** a SOLVER_RESULT sent to a user
**When** the orchestrator delivers it
**Then** the result is cached in memory keyed by userId (last result only, no history)
**And** the cache entry is evicted after 5 minutes or on next SOLVER_START

**Given** a WS reconnection for a user who has a cached result
**When** the client reconnects and sends SOLVER_INIT
**Then** the cached SOLVER_RESULT is automatically resent to the client
**And** SolverService handles the re-delivered result idempotently (same result signal update)

**Given** a WS reconnection where the previous solve's result has already been evicted from the server-side cache (5-minute TTL elapsed, or evicted by a newer SOLVER_START)
**When** the client reconnects and sends SOLVER_INIT
**Then** the server responds with SOLVER_HANDTRAPS only — no cached result is included
**And** the frontend SolverService treats the absence of a cached result as the normal post-init state: the local `result` signal is preserved (the user keeps seeing whatever result is currently rendered, which may be from before disconnection), `solverState` stays at whatever value it currently holds (`complete` or `idle`), and no error is raised
**And** the user can launch a new solve normally; the now-orphaned local result is replaced when the new SOLVER_RESULT arrives
**And** if the user had no local result before disconnection (fresh page load after eviction), state is `'idle'` and the page shows the empty config — same as a first visit

**Given** the WS connection closes during a solve
**When** the client disconnects
**Then** the current solve continues to completion (NOT aborted)
**And** the result is cached for the user if the solve completes before the 5-minute eviction
**And** if the client reconnects before eviction, the result is delivered

---

### Story 1.5a: SolverService, Route & Page Scaffold

As a developer,
I want the SolverService, route, page scaffold, and frontend models in place,
So that all frontend solver stories build on a working service layer and page structure.

**Acceptance Criteria:**

**Given** the Angular app routes
**When** Story 1.5a is implemented
**Then** `/decks/:id/solver` is registered in app.routes.ts as a lazy-loaded route with AuthService guard

**Given** solver.model.ts in core/model/
**When** Story 1.5a is implemented
**Then** it exports DecisionNode, SolverAction, ScoreBreakdown (15 types + total), SolverState, SolverProgress, SolverResult, SolverStats, SolverErrorMessage, AdversarialTiming, HandtrapConfig, and all WS message payload types
**And** types are identical to the corresponding types in duel-server solver-types.ts

**Given** SolverService (providedIn: 'root')
**When** it is instantiated
**Then** it exposes signals: solverState ('loading' | 'idle' | 'configuring' | 'running' | 'cancelled' | 'complete' | 'error'), progress (SolverProgress | null), result (SolverResult | null), error (SolverErrorMessage | null), handtraps (HandtrapConfig[] | null)
**And** 'loading' state is active while the deck is being fetched from the route param — transitions to 'idle' once the deck is loaded
**And** it manages WS communication for SOLVER_* messages
**And** on first instantiation, it sends SOLVER_INIT over WS to request the handtrap list
**And** if SOLVER_HANDTRAPS is not received within 10 seconds, retries once; if still no response, the `handtraps` signal stays `null` and a `handtrapsLoadFailed` signal is set to `true`. The page does NOT enter the global `'error'` state — goldfish mode (Epic 1) does not consume handtrap data, so it must remain fully usable. Only the adversarial mode toggle (added in Epic 2) is disabled and shows an inline error hint ("Handtrap data unavailable — adversarial mode requires server connection. Goldfish mode is still available."). The global `'error'` state is reserved for failures that block goldfish itself (deck load failure, WS disconnect, SOLVER_ERROR)
**And** on SOLVER_HANDTRAPS received, it populates the handtraps signal (+ re-delivers any cached SOLVER_RESULT)
**And** all incoming WS messages are delegated to SolverDebugLogService for logging

**Given** SolverService receives an unsolicited SOLVER_RESULT (e.g., after WS reconnect) while state is 'idle' or 'configuring'
**When** the result's deckId matches the current route param
**Then** the result is displayed and state transitions to 'complete'
**And** when the deckId does NOT match the current route param, the result is silently added to session history but not displayed (current deck context preserved)

**Given** SolverDebugLogService
**When** environment.debugTools is true
**Then** it captures solver WS messages into a Signal<SolverDebugEntry[]> with formatted output matching PvP DebugLogService pattern
**And** when debugTools is false, logging is a no-op

**Given** a user navigating to `/decks/:id/solver`
**When** the page loads
**Then** SolverPageComponent renders with full-viewport layout (replay pattern)
**And** the deck is pre-loaded from the route param :id
**And** the page structure has a config area (top, horizontal) and a result area (below, full width)
**And** the config area supports a `collapsed` signal with CSS transition for collapsing after a solve completes (transport bar pattern)
**And** when collapsed, a visible toggle button (mat-icon-button `tune` or `expand_more`) remains in the collapsed bar to uncollapse the config panel — required for keyboard users who cannot interact with hidden config controls. Clicking or pressing Enter on this button transitions state to 'configuring' and uncollapses the panel

**Given** the existing deck page
**When** Story 1.5a is implemented
**Then** a "Solve" button is added to the deck page toolbar (alongside existing actions like "Edit" and "Test") that navigates to `/decks/:id/solver`

**Given** viewport width < 1024px
**When** the solver page loads
**Then** the solver UI is hidden and a centered message is displayed: "Solver requires a desktop browser (1024px minimum)"

**Given** a SOLVER_ERROR is received
**When** the error signal updates
**Then** displayError() is called with the error message (snackbar with "Dismiss" action button, no auto-dismiss)
**And** state transitions to 'error' then to 'configuring' (config unlocked)

**Given** solver i18n labels
**When** the page renders
**Then** all labels use ngx-translate keys under a 'solver' namespace in fr.json and en.json

---

### Story 1.5b: Solver Config & Progress Components

As a player,
I want to select my hand and launch a goldfish solve with real-time feedback,
So that I can start exploring my deck's combo potential.

**Acceptance Criteria:**

**Given** the SolverConfigComponent
**When** it renders
**Then** it displays a deduplicated card art grid of main deck cards (1 art per unique card, ×N copy counter)
**And** clicking a card selects/deselects 1 copy (multi-click for multiple copies of same card)
**And** a counter shows "X / 5 max selected"
**And** Solve is enabled with 1–5 cards selected
**And** a "Fill Random" button completes the hand to 5 with random cards from remaining deck (local random)
**And** mode toggle shows Goldfish only (Adversarial added in Epic 2)
**And** speed toggle shows Fast / Optimal (mat-button-toggle)
**And** algorithm selector shows DFS / MCTS / Auto (mat-button-toggle)
**And** Solve button (mat-raised-button) is enabled only when 5/5 cards selected

**Given** the hand selector grid
**When** a card with ×3 copies is clicked 3 times
**Then** 3 copies are selected (counter reflects it)
**And** clicking again deselects one copy

**Given** the hand selector
**When** the deck has < 5 main deck cards
**Then** an error message "Not enough cards to form a hand" is displayed and Solve is disabled

**Given** the user clicks Solve
**When** 1–5 cards are selected
**Then** SolverService sends SOLVER_START over WS with { deckId, hand (1–5 cardIds), mode: 'goldfish', speed, algorithm }
**And** state transitions from 'configuring' to 'running'
**And** the config panel is locked (interactions disabled)

**Given** state is 'running'
**When** the SolverProgressComponent renders
**Then** it displays mat-progress-spinner (indeterminate) + contextual message "Exploring combo lines..."
**And** live stats in secondary zone with player-facing labels: "{N} combo lines explored", "Best board: {score} ({interruptions} interruptions)", elapsed time (from SolverService.progress signal)
**And** when the best score improves, the score value briefly highlights (300ms CSS transition) to draw attention
**And** a Cancel button (mat-raised-button warn) replaces the Solve button

**Given** the user clicks Cancel
**When** a solve is running
**Then** SolverService sends SOLVER_CANCEL over WS
**And** state transitions to 'cancelled'

**Given** state transitions from 'running' to 'complete' or 'cancelled'
**When** the page updates
**Then** the progress panel hides and the result area becomes visible

---

### Story 1.6a: Hero Result & Brick State

As a player,
I want to see my solve score, end board, and interruption breakdown immediately after a solve completes,
So that I can understand at a glance how good my combo is.

**Acceptance Criteria:**

**Given** a SOLVER_RESULT received by SolverService
**When** state transitions to 'complete'
**Then** the config panel collapses via its `collapsed` signal (built in Story 1.5a) to maximize result space
**And** the result area renders below

**Given** a successful solve result
**When** HeroResultBlock renders
**Then** it displays the global score in mat-headline-4 with interruption count: "35 — 3 interruptions" (UX spec format — no subjective qualifier like "Strong"/"Moderate")
**And** below the score: interruption breakdown chips (mat-chip) grouped by 5 color families (Negate purple, Removal orange, Control teal, Disable amber, Hand grey)
**And** each chip text reads "type ×N" (e.g., "omni-negate ×2")
**And** SCSS variables $solver-chip-negate, $solver-chip-removal, $solver-chip-control, $solver-chip-disable, $solver-chip-hand are defined in src/app/styles/

**Given** the end board display in HeroResultBlock
**When** it renders
**Then** card art thumbnails ($card-thumb-md: 56×82px) of final field cards are shown
**And** each card has an interruption badge overlay (corner bottom-right, semi-transparent background, "type ×uses" format)
**And** hovering a card art shows enlarged popup (120×175px via mat-tooltip)
**And** cards scored via fallback heuristic (untagged) display a dashed border + info_outline icon with mat-tooltip "Some cards lack interruption tags — score is estimated"

**Given** a solve result with score = 0 (no viable combo)
**When** BrickStateBlock renders with type 'pure-brick'
**Then** it displays: mat-icon 'block' + "No viable combo" + "This hand has no path to an interruption even uncontested." + "Try a different hand"
**And** role="alert" for screen reader announcement

**Given** a SOLVER_CANCELLED with partialTree
**When** the result renders
**Then** HeroResultBlock shows a "Partial result" mat-chip outline badge next to the score

**Given** a SOLVER_CANCELLED without partialTree
**When** state transitions
**Then** state goes to 'configuring' (config unlocked, no result displayed)

**Given** accessibility requirements
**When** the hero block renders
**Then** aria-label includes score and interruption summary

---

### Story 1.6b: Breadcrumb & Decision Tree

As a player,
I want to see the recommended combo path as a breadcrumb and explore alternative lines via an interactive decision tree,
So that I can discover unknown lines and understand all my options.

**Acceptance Criteria:**

**Given** the result includes a mainPath
**When** BreadcrumbPathComponent renders
**Then** it displays mat-chips with embedded card art thumbnail ($card-thumb-sm: 32×46px) + card name as chip label (e.g., "Branded Fusion", "Mirrorjade" — concise, readable as a combo narration)
**And** chips are connected by chevron_right mat-icons
**And** layout is horizontal scroll (overflow-x: auto, white-space: nowrap), never wraps to multi-line
**And** hovering a chip shows the full enriched annotation via CDK Overlay (`CdkConnectedOverlay`), NOT `mat-tooltip` (which only renders short text strings — combo annotations can exceed 150+ characters for multi-target effects like Pendulum Summons, which would truncate or overflow in a tooltip). The overlay is positioned relative to the hovered chip, displays multi-line formatted text, and is dismissed on mouseleave. Same pattern as card art hover popups
**And** clicking a chip emits output<SolverAction>() to parent, which scrolls DecisionTreeComponent to the corresponding node via viewChild

**Given** the result includes a tree
**When** DecisionTreeComponent renders
**Then** it uses CDK flat tree (CdkTree + CdkTreeNode) with getLevel() for 24px indentation per level
**And** main path is pre-expanded at load
**And** root children (alternative branches) are collapsed at load (~10-15 visible lines)
**And** each tree node row shows: card art thumbnail (32×46px, `loading="lazy"` on `<img>`) + annotation text (card name + action description) + score badge (mat-body-1 bold)
**And** all card art `<img>` elements use `loading="lazy"` to prevent 500+ simultaneous image requests when the tree has many expanded nodes
**And** root-level alternative branches show score delta vs main path ("+3" / "-5 vs main")

**Given** a tree node with prunedChildren > 0
**When** it renders
**Then** it shows "... and N other branches" below the last visible child

**Given** a tree node with truncated = true
**When** it renders
**Then** it shows a visual indicator that the subtree was cut for size

**Given** a user clicking a tree node
**When** the node has children
**Then** it toggles expand/collapse

**Given** a user hovering a card art in the tree or breadcrumb
**When** the hover activates
**Then** an enlarged card popup (120×175px) is shown via CDK Overlay (CdkConnectedOverlay), NOT mat-tooltip (which only renders text strings). The overlay is positioned relative to the hovered element and dismissed on mouseleave

**Given** accessibility requirements
**When** the tree renders
**Then** CDK Tree provides native role="tree", role="treeitem", aria-expanded
**And** each tree node has aria-label with action + score
**And** keyboard navigation works natively via CDK Tree (arrow keys, Enter)

---

### Story 1.7: MCTS Algorithm & Auto-Detection

As a developer,
I want an SP-MCTS algorithm and automatic algorithm selection based on branching factor,
So that the solver can handle high-branching-factor decks that DFS cannot tractably explore.

**Acceptance Criteria:**

**Given** a GameOracle instance, a SolverConfig (goldfish), and an AbortSignal
**When** SP-MCTS solve() is called
**Then** it performs iterative MCTS cycles: selection (UCB1), expansion, simulation (domain-aware rollout to terminal or max depth), backpropagation
**And** respects the time budget (timeBudgetFastMs or timeBudgetOptimalMs from config)
**And** returns a SolverResult with tree, mainPath, score, scoreBreakdown, and stats

**Given** the MCTS strategy
**When** inspecting its metadata
**Then** name is 'mcts' and supportsAdversarial is true

**Given** an MCTS exploration in progress
**When** nodesExplored % 100 === 0 OR 200ms elapsed since last progress
**Then** onProgress() is called with { nodesExplored, bestScore, elapsed }

**Given** a running MCTS solve
**When** signal.aborted becomes true
**Then** the solver stops and returns the best result found so far (anytime behavior)

**Given** MCTS node statistics
**When** the result tree is built
**Then** confidence is set to visits/totalVisits (0-1 range)
**And** children are sorted by score descending

**Given** SP-MCTS backpropagation
**When** a rollout score is propagated up the tree
**Then** in goldfish mode, backpropagation uses max policy (best child score), not mean, to prioritize exploration of high-ceiling combo paths. **Tradeoff:** max backprop inflates parent scores (always reflects best-case rollout), which can reduce UCB1 exploration effectiveness. This is intentional for combo solving — we care about the ceiling (best possible board), not the average. If empirical testing shows the solver gets stuck exploiting one branch, switch to mean backprop or a tunable mix (e.g., `backpropWeight * max + (1 - backpropWeight) * mean`).
**And** in adversarial mode, backpropagation uses two-player minimax: player nodes propagate max (best action for the player), opponent nodes (SELECT_CHAIN handtrap windows) propagate min (worst-case handtrap timing). The `minimax` score in the result is the root score of this minimax tree — not a separate post-hoc computation.
**And** UCB1 exploration constant C is tunable (default value calibrated during implementation). C may need to be higher than standard (√2) to compensate for max backprop inflation

**Given** a solve request with algorithm = 'auto'
**When** the orchestrator dispatches work
**Then** the orchestrator runs a **breadth-limited** probe: an iterative-deepening DFS capped at 100 expanded nodes, where each visited node fully enumerates and counts its legal actions before recursing into the highest-ranked child. The branching factor metric is the **mean of `legalActions.length` across all 100 visited nodes**, NOT the number of children actually descended into. Pure depth-first descent would systematically under-sample BF because it follows one branch deeply; the iterative-deepening shape ensures the probe samples nodes from multiple depths
**And** if mean BF < 12, the worker continues with DFS — resuming from the probe's frontier (probe tree is reused, not discarded)
**And** if mean BF ≥ 12, the worker switches to MCTS using the probe nodes as warm-start (see warm-start AC below)
**And** if mean BF > bfComplexityThreshold (default 25), the progress includes highComplexity: true
**And** in both cases the probe budget (~100 nodes) is amortized into the solve, not wasted

**Given** a probe measured BF ≥ 12 and the worker switches to MCTS
**When** MCTS solve begins
**Then** the warm-start is restricted to a **score floor**: only the probe's `bestScore` is carried over and seeded as `_bestTerminalScore` (and as `root.bestScore` / `root.score`) before the first MCTS iteration. MCTS will never report a worse line than the probe found
**And** the probe's `nodesExplored` is intentionally NOT recorded as MCTS visits, and the probe tree is NOT converted to MCTS nodes. DFS node-explorations and MCTS rollouts measure different quantities; mixing them poisons UCB1 exploration (denominator inflated, exploration bonus collapses) and the mean-policy denominator
**And** the probe and MCTS use the same `InterruptionScorer`, so the floor is directly comparable to rollout scores — no normalization needed

**Given** the ActionRanker interface
**When** a strategy calls ranker.rank(actions, state)
**Then** the default implementation returns the actions unchanged (identity — no pruning)
**And** the interface is available for future implementations (progressive widening, type filtering)

**Given** MCTS rollout simulation
**When** a rollout is performed from an expanded node
**Then** the rollout uses an **epsilon-greedy policy with GoldfishChainRanker**: with probability `1 - rolloutEpsilon` (default 0.9), select the highest-ranked action from the ranker; with probability `rolloutEpsilon` (0.1), select randomly. Pure random rollouts are NOT acceptable — they almost never produce coherent combo lines in Yu-Gi-Oh! (probability of randomly chaining correct activations through BF 15+ is negligible → nearly all rollouts score 0, making UCB1 meaningless)
**And** `rolloutEpsilon` is configurable in solver-config.json (range 0.0-1.0, default 0.1)
**And** when the rollout reaches a terminal state, the interruption scorer evaluates the board (same scorer as DFS)
**And** the score is backpropagated through the tree
**And** in adversarial rollouts, opponent SELECT_CHAIN actions use the minimax policy (not random)

**Given** 5 golden test hands run 10× each in SP-MCTS goldfish mode (same deckSeed, different MCTS PRNG seeds)
**When** comparing the resulting scores across the 10 runs per hand
**Then** the standard deviation of the final score is < 15% of the mean score for each hand (stability validation — MCTS should converge on similar quality results despite stochastic rollouts)

**Given** the UCB1 exploration constant C and backpropagation policy
**When** Story 1.7 is implemented
**Then** C is exposed as a configurable constant in `solver-config.json` (range 0.5-3.0, starting point √2 ≈ 1.414)
**And** a `backpropPolicy` config field supports `'max'` (default) and `'mean'` — enabling empirical comparison if max-backprop causes exploitation traps on specific decks
**And** a calibration script (`scripts/calibrate-mcts.ts`, dev-only) runs MCTS over a fixed set of 5 calibration hands (defined in `_bmad-output/planning-artifacts/research/mcts-calibration-hands.json` — to be created during implementation) at C ∈ {0.7, 1.0, √2, 2.0, 2.5}, 10 runs each per C, and reports the mean final score and stddev per C value
**And** the calibration is "complete" when the script has been run, its output committed as a validation artifact, and `solver-config.json` is set to the C with the highest mean score whose stddev is ≤ 15% of mean (matches the stability threshold from the MCTS golden-test AC)
**And** the story is NOT considered done if `solver-config.json` still contains the placeholder √2 value with no calibration artifact

---

### Story 1.8: ActivationLog Tracking & OPT-Aware Scoring

As a developer,
I want the solver to track which interruption effects each card has already used during a turn and apply that knowledge to scoring + transposition table fingerprinting,
So that the score of a board final reflects the real defensive value of cards that have already activated their once-per-turn effects, and the transposition table no longer produces false hits between OPT-divergent states with identical visible layouts.

**Background:** The current scorer assumes every tagged card on the board final has all its OPT effects available. In reality, cards can spend OPT effects mid-combo (e.g., a Baronne summoned early that activates omni-negate to negate a handtrap before continuing). The board final still shows Baronne, but its real value is 0, not 30. The transposition table cannot distinguish OPT-divergent states with identical visible layouts because its verification key only encodes cardId/position/overlay/face-down. This story resolves both issues by tracking activations on the JS side (the OCGCore WASM API does not expose effect counters — investigation confirmed `OcgQueryFlags.STATUS` only exposes 3 bits, none of which are OPT-related).

**Acceptance Criteria:**

**Given** a player activation of a tagged card via SELECT_CHAIN, SELECT_IDLECMD, or SELECT_EFFECTYN
**When** `applyAction()` is called
**Then** the adapter records the activation in `InternalHandle.activationLog: Map<cardId, number[]>`, where the value array contains effect indices (positions in `tag.effects[]`)
**And** the effect index is determined by `disambiguateEffect(tag, promptType, phase)` which uses the `trigger` field of each effect to match against the prompt context
**And** ambiguous matches log a warning and pick the lowest index; missing-trigger fallback uses index 0 with warning

**Given** a `forkViaReplay()` call
**When** the new handle is created
**Then** `activationLog` is deep-cloned from the parent (Map clone with array clone per entry) so DFS branches do not share state
**And** opponent activations are NOT logged in this story (Epic 2 will extend `applyAction` to track them)

**Given** a `NEW_TURN` message processed by `runUntilPlayerPrompt()`
**When** the turn counter advances
**Then** `activationLog` is cleared on the active handle

**Given** the `GameOracle` interface
**When** a consumer needs OPT state
**Then** `oracle.getActivationLog(handle): ReadonlyMap<number, readonly number[]>` is exposed

**Given** `InterruptionScorer.scoreWithCards()` called with an optional `activationLog` argument
**When** a tagged card on the field is evaluated
**Then** for each effect, `consumedCount` is computed from the log and `remainingUses = max(0, effect.usesPerTurn - consumedCount)` replaces `effect.usesPerTurn` in the breakdown count and weighted total
**And** if the tag has `sharedOpt: true`, the cumulative consumed count is capped against `tag.totalUsesPerTurn ?? sum(effects.usesPerTurn)` — once exceeded, the card scores 0 across all remaining effects
**And** when `activationLog` is omitted or empty, scoring matches the pre-1.8 behavior (backward compatible)

**Given** `buildVerificationKey()` is called during a TT store/lookup
**When** the function constructs the key
**Then** it accepts `activationLog` as a second parameter and appends a deterministic `opt:cardId1=indices1;cardId2=indices2;...` segment, with sorted cardIds and sorted indices
**And** two `FieldState` snapshots with identical board layout but different `activationLog` produce different verification keys
**And** the existing TT lookup/store call sites in `dfs-solver.ts` are updated to pass the activation log

**Given** the enriched `interruption-tags.json` schema
**When** the loader reads a tag entry
**Then** the schema accepts new optional fields per tag (`sharedOpt`, `totalUsesPerTurn`, `_generatedBy`, `_oracleVersion`, `_validated`) and per effect (`trigger`, `description`)
**And** the loader passes validation regardless of whether a given entry has the new fields (backward compatible)

**Given** the AI-assisted tag generation prompt persisted at `_bmad-output/solver-data/interruption-tag-generation-prompt.md`
**When** a developer or Claude Code session needs to generate or regenerate tags
**Then** the prompt file contains: system prompt, full TS schema with semantics, classification rules for ambiguous cases, few-shot examples (single-effect, multi-effect non-shared, multi-effect shared, continuous, null cases), and the expected output format
**And** the existing 173 entries in `interruption-tags.json` are regenerated using this prompt during Story 1.8 implementation, preserving correct entries and enriching with new fields
**And** the regeneration log is captured as a validation artifact

**Given** the frontend `HeroResultBlockComponent` displaying the end board cards
**When** a card has activations recorded in the result
**Then** the card thumbnail shows a small badge "X/Y used" with a tooltip explaining the consumed OPT effects
**And** the `EndBoardCard` type is extended with `consumedUses?: number` populated by the scorer when an activation log is present

**Given** the smoke tests for the activation log feature
**When** they run
**Then** at minimum these assertions pass: empty log on fresh handle, log populated after Apollousa activation, fork isolates state, disambiguateEffect resolves Baronne omni-negate vs destruction, scorer reduces weighted score for consumed Baronne effect, sharedOpt card with full consumption returns 0, verification key differs for OPT-divergent states, identical for OPT-equivalent states

---

## Epic 2: Handtrap Resilience Analysis

User switches to adversarial mode, selects handtraps from a predefined list, and sees the resilience analysis: global minimax score, handtrap branches annotated in the decision tree with activation timing, and no-resilient-line brick state.

### Story 2.1: Adversarial Engine — Handtrap Injection & Minimax MCTS

As a developer,
I want the solver engine to model a virtual opponent who activates handtraps at optimal timing,
So that the solver can find combo lines that survive disruption and compute resilience scores.

**Acceptance Criteria:**

**Given** a SolverConfig with mode: 'adversarial' and handtraps: HandtrapConfig[]
**When** a solver worker creates a duel via GameOracle
**Then** the duel is configured as a 2-player game
**And** the opponent (player 1) receives a legal 40-card filler deck
**And** handtraps from HandtrapConfig[] are injected into player 1's hand via duelNewCard() with location: OcgLocation.HAND, team: 1
**And** all other opponent prompts remain auto-passed (existing solo mode pattern)

**Given** an adversarial duel in progress
**When** OCGCore presents SELECT_CHAIN to player 1
**Then** the adversarial decision function replaces autoPassOpponent() for SELECT_CHAIN only
**And** at each SELECT_CHAIN window, both "activate handtrap" and "pass" are explored as child nodes in the MCTS tree
**And** the adversarial policy is implicit in the tree search (minimax: opponent move selected by lowest player score) — no manually coded activation heuristic

**Given** algorithm = 'auto' or 'mcts' with mode = 'adversarial'
**When** the orchestrator validates strategy/mode compatibility
**Then** the Minimax MCTS solver is selected (supportsAdversarial: true)
**And** DFS is never dispatched for adversarial mode (supportsAdversarial: false)
**And** auto-detection in adversarial mode bypasses the BF probe entirely and always dispatches MCTS (no 100-node DFS probe)

**Given** a Minimax MCTS solve in adversarial mode
**When** the opponent's hand is set up
**Then** all configured handtraps are injected into the opponent's hand via `duelNewCard()` — the opponent always has access to the full set (no subset sampling, no determinization)
**And** the opponent policy emerges from the minimax tree search itself (player=max, opponent=min over rollout scores) — not from a manually coded activation heuristic
**And** **convergence note:** Fast mode (~2K-3.5K iterations) provides broad coverage of the most-visited opponent branches but may not fully converge on deep trees with many chain windows. Optimal mode (60s, ~12x more iterations) is required for stable convergence. Fast adversarial results are best-effort and flagged with a UI hint

**Given** an adversarial solve completing
**When** the result tree is built
**Then** nodes where the opponent activated a handtrap include handtrapLabel (handtrap name + activation timing description)
**And** the global minimax score (worst-case across all handtrap branches) is computed and included in the result

**Given** a SOLVER_START with mode: 'adversarial'
**When** SOLVER_RESULT is sent
**Then** the payload includes minimax score alongside the primary score
**And** stats reflect the adversarial algorithm used

**Given** a SOLVER_START with mode: 'adversarial' and algorithm: 'dfs'
**When** the orchestrator validates
**Then** it rejects with SOLVER_ERROR because DFS does not support adversarial mode

---

### Story 2.2: Adversarial UI — Handtrap Selection & Mode Toggle

As a player,
I want to select handtraps and switch to adversarial mode in the solver config,
So that I can test my deck's resilience against specific disruptions.

**Acceptance Criteria:**

**Given** the SolverConfigComponent
**When** Story 2.2 is implemented
**Then** the mode toggle shows both Goldfish and Adversarial options (mat-button-toggle)

**Given** the user toggles mode to Adversarial
**When** the config panel updates
**Then** a handtrap selection section appears (progressive disclosure)
**And** it displays the handtrap list received from the server via SOLVER_HANDTRAPS (single source of truth — no frontend hardcode). MVP: 5 handtraps (Ash Blossom, Nibiru, Effect Veiler, Maxx "C", Infinite Impermanence). The server validates that handtrap cardIds in SOLVER_START match its own handtraps.json — invalid cardIds are rejected with SOLVER_ERROR
**And** each handtrap is a mat-checkbox with card art thumbnail (32×46px) + card name
**And** 0 to maxHandtraps (from server config) handtraps can be selected

**Given** mode = adversarial and 0 handtraps selected
**When** the user looks at the Solve button
**Then** the Solve button is disabled with a tooltip "Select at least 1 handtrap for adversarial mode"

**Given** the user toggles mode back to Goldfish
**When** the config panel updates
**Then** the handtrap checkboxes are hidden
**And** previously selected handtraps are preserved in memory (re-shown if user switches back to Adversarial)

**Given** the user clicks Solve in Adversarial mode
**When** at least 1 handtrap is selected and 1–5 cards are in hand
**Then** SolverService sends SOLVER_START with mode: 'adversarial' and handtraps array (cardId + cardName for each selected handtrap)

**Given** algorithm is set to DFS
**When** the user switches mode to adversarial
**Then** the algorithm automatically switches to Auto
**And** a brief inline hint is displayed: "DFS does not support adversarial — switched to Auto"

---

### Story 2.3: Adversarial Result Display — Minimax & Handtrap Branches

As a player,
I want to see the minimax resilience score and handtrap branch labels in the decision tree,
So that I can identify exactly where my combo breaks and what the best fallback line is.

**Acceptance Criteria:**

**Given** an adversarial SOLVER_RESULT
**When** HeroResultBlock renders
**Then** the layout switches to adversarial mode (2 lines): first line shows primary score + minimax score, second line shows end board cards
**And** minimax score is displayed with label "Worst-case: {minimax}" alongside the primary score
**And** if minimax = 0 and primary score > 0, the hero still displays the primary score as reference

**Given** an adversarial decision tree
**When** DecisionTreeComponent renders nodes with handtrapLabel
**Then** the handtrap branch node displays: small handtrap card art thumbnail (32×46px) + handtrap name + activation timing text (e.g., "Ash Blossom — chains to Branded Fusion")
**And** the label uses existing theme secondary text color (no red/danger treatment — clarity over drama)

**Given** an adversarial solve with primary score > 0 but minimax score = 0
**When** BrickStateBlock renders with type 'no-resilient-line'
**Then** it displays: mat-icon 'shield' + "No resilient line found" + "All combo paths are broken by the selected handtraps." + "Goldfish score: {primaryScore}" as reference
**And** role="alert" for screen reader announcement

**Given** an adversarial result with minimax > 0
**When** the user expands a handtrap branch in the tree
**Then** the subtree shows the best fallback line under that handtrap scenario
**And** each leaf in the subtree has its own score and ScoreBreakdown
**And** the user can identify the chokepoint (which step the handtrap hit) and the best recovery path

**Given** accessibility for adversarial results
**When** the hero block renders
**Then** aria-label includes both primary score and minimax score (e.g., "Score: 35, 3 interruptions. Worst-case resilience: 8")

---

### Story 2.4: Verify Adversarial Path

As a player,
I want to replay the recommended combo line with a handtrap at the declared timing and confirm the result,
So that I can independently verify the solver's adversarial analysis before trusting it in a tournament.

**Acceptance Criteria:**

**Given** an adversarial SOLVER_RESULT is displayed with a mainPath and adversarialTimings
**When** the user clicks the "Verify" button (mat-stroked-button, verified icon, next to Pin/Export)
**Then** SolverService sends SOLVER_START with the existing config + verifyPath: mainPath (SolverAction[]) + verifyTimings: adversarialTimings (AdversarialTiming[])
**And** state transitions to 'running' with a contextual message "Verifying recommended line..."

**Given** a SOLVER_START with verifyPath and verifyTimings present
**When** the solver worker receives it
**Then** it replays the exact player action sequence from verifyPath on a fresh OCGCore duel (same deckSeed)
**And** in adversarial mode, handtraps are injected into the opponent's hand as in a normal adversarial solve
**And** at each SELECT_CHAIN window for player 1, the verifier checks if an AdversarialTiming entry exists for the current stepIndex — if yes, it injects the specified responseIndex; if no, it auto-passes. This is a deterministic replay of the original adversarial path using the opponent actions encoded in adversarialTimings
**And** if the replay succeeds (all actions are legal and produce the same final board), SOLVER_RESULT is returned with verified: true
**And** if the replay diverges (an action is illegal or the final board differs), SOLVER_RESULT is returned with verified: false and a divergence description in stats
**And** note: verification confirms the path is *legal and produces the declared score* for the given deckSeed. For MCTS results, the mainPath was found via stochastic sampling — a `verified: false` indicates a genuine replay divergence (e.g., deck-order-dependent effect), not that the solver's statistical analysis was wrong. This distinction is implicit (no user-facing warning) but should be understood by the implementer

**Given** a SOLVER_RESULT with verified: true
**When** HeroResultBlock renders
**Then** a "Verified" mat-chip (outline, accent color) appears next to the score
**And** aria-label includes "Result verified"

**Given** a SOLVER_RESULT with verified: false
**When** HeroResultBlock renders
**Then** a "Verification failed" mat-chip (outline, warn color) appears next to the score
**And** displayError() displays the divergence reason (snackbar with "Dismiss" action button, no auto-dismiss)
**And** aria-label includes "Verification failed"

**Given** no adversarial result is displayed (state != 'complete' OR mode = 'goldfish')
**When** the page renders
**Then** the Verify button is hidden

**Given** the Verify button
**When** a verification is already running
**Then** the Verify button is disabled

**Given** an adversarial result (any algorithm)
**When** the Verify button renders
**Then** a mat-tooltip on the Verify button reads: "Verification may fail for combos involving search or shuffle effects (e.g., ROTA, Branded Fusion send-from-deck) — OCGCore's internal PRNG may produce different post-search deck orders. This does not invalidate the original result."
**And** this warning applies to BOTH DFS and MCTS results — deckSeed controls initial shuffle only, not OCGCore's internal PRNG for in-game searches/shuffles. DFS results are NOT immune to this divergence despite being deterministic for the original solve

---

### Epic 2 Post-Implementation Review (2026-04-11)

Adversarial review identified 12 findings (10 real). 7 code fixes applied, 1 already-correct-by-design (#10), 2 deferred for discussion (#5 verifyExpectedScore client-supplied, #9 uniform subset sampling):

- **#1 (FIXED):** "Goldfish score" label in no-resilient-line brick was misleading — renamed to "Best score (without disruption)" since the value is IS-MCTS bestScore, not a true goldfish score.
- **#3 (FIXED):** No Fast mode reliability indicator for adversarial results — added `fastAdversarialHint` tooltip icon on hero block when adversarial + Fast mode.
- **#4 (DOCUMENTED):** Story 2.2 Task 8 (E2E WS verification) was never manually executed — all 7 subtasks unchecked. Documented as gap.
- **#6 (FIXED):** Race condition where verify result could patch a stale result after a new solve. Added `verifyingResultRef` guard.
- **#7 (FIXED):** Verify button permanently disabled after failed verification. Changed disable from `verified != null` to `verified === true` — allows re-verify after PRNG divergence.
- **#8 (FIXED):** Breadcrumb opponent detection used fragile `!imgMap.has()` heuristic — now cross-references `adversarialTimings` handtrap cardIds for reliable detection even when player main-decks a handtrap.
- **#10 (OK):** Cancel button already works during verify — `solverState` is `'running'`, progress panel with Cancel is visible.
- **#11 (FIXED):** Handtrap selection persisted across deck switches without warning — added transient 5s hint when switching decks in adversarial mode.
- **#12 (OK):** `mergeResults()` criterion was unspecified in epic but correctly implemented as minimax DESC in code.

### Epic 2 Algorithm Refactor: IS-MCTS → Minimax MCTS (2026-04-12)

Post-review, the adversarial algorithm was simplified from Information Set MCTS (with handtrap subset determinization) to **deterministic Minimax MCTS**. This aligns the implementation with the intended stress-test semantics: "assume the opponent has ALL selected handtraps in hand and activates optimally."

**Rationale:**
- IS-MCTS's uniform subset sampling overweighted unrealistic scenarios (e.g., 5 handtraps simultaneously active, ~3% of realistic hands) while underweighting the realistic 1-2 handtrap cases, producing pessimistic and non-actionable minimax scores.
- The original "information set" framing modeled uncertainty about which handtraps the opponent *possesses*, but the user explicitly wants a deterministic stress-test: "if I added these handtraps to the test, assume the opponent has all of them."
- Removing determinization simplifies the algorithm, eliminates sampling-induced variance between runs, and provides a monotone guarantee: adding a handtrap can only decrease (never increase) the minimax score.

**Changes:**
- `ismcts-solver.ts` — removed `sampleHandtrapSubset()` and `filterOpponentActions()` methods, removed the outer determinization loop, simplified the main iteration to a single tree descent per iteration. `select()`, `expand()`, `simulate()` no longer take `subsetIds`. Two-player minimax backpropagation unchanged.
- `ocgcore-adapter.ts` — removed the SELECT_EFFECTYN auto-decline path (which existed to prevent "leaked" handtrap triggers from bypassing the subset filter). Opponent SELECT_CHAIN still yields to the solver; other opponent prompts still auto-respond normally.
- `solver-config.json` / `solver-types.ts` / `solver-config-loader.ts` — removed the `ismctsDeterminizations` config field (no longer used).
- UI Fast mode hint updated — the hint text now reflects the real reason (fewer iterations = less exploration), not the old IS-MCTS averaging concern.

**Semantics of the new minimax score:**

"If the opponent has the selected handtraps in hand and activates them at the optimal timing to disrupt your combo, your best achievable score is X."

The score is monotone decreasing in the number of selected handtraps (adding handtraps can only equal or reduce the minimax).

**What was preserved:**
- Two-player minimax backpropagation (player=max, opponent=min)
- UCB1 with minimax inversion on opponent nodes
- Epsilon-greedy rollouts with greedy-activate opponent heuristic
- `handtrapLabel` generation on opponent activation nodes
- `adversarialTimings` extraction for the Verify feature
- Tree sorting: opponent children ASC by worst-case, player children DESC by best-case
- `stats.algorithmUsed: 'ismcts'` (kept for backward-compat with frontend display — semantically it's now minimax-mcts, but the string is a stable API surface)

---

## Epic 3: Iterative Build Comparison

User iterates rapidly between solves and compares builds: pin result snapshots for side-by-side mental comparison, consult session history, Quick Solve, config persistence per deck, and keyboard shortcuts.

### Story 3.1: Session History & Config Persistence

As a player,
I want my solve results to be kept in memory during my session and my config to persist across solves,
So that I can iterate rapidly without reconfiguring from scratch each time.

**Acceptance Criteria:**

**Given** SolverService (root-scoped)
**When** a SOLVER_RESULT is received
**Then** the result is appended to a Signal<SolverResult[]> session history array (client-side in-memory, FR26)
**And** the history persists across navigations (root-scoped service survives route changes)
**And** session history is intentionally NOT persisted to localStorage (it contains full decision trees which are too large — pins and export cover the persistence use case)
**And** session history is capped at 10 entries (LRU eviction — oldest result is dropped when the 11th arrives) to bound client-side heap usage. **Memory estimation:** each SolverResult contains a pruned tree (up to 500 nodes × ~500 bytes/node ≈ 250KB). 10 entries ≈ 2.5MB — acceptable for desktop browsers but non-trivial GC pressure on long sessions

**Given** the user navigates away from the solver page and comes back to the same deck
**When** the solver page reloads
**Then** the previous hand selection is restored from SolverService
**And** mode, speed, algorithm, and handtrap selections are restored from localStorage
**And** the last solve result is still available in SolverService.result signal

**Given** the user navigates to a different deck's solver page
**When** the solver page loads
**Then** the hand selection resets (cards may not exist in the new deck)
**And** mode, speed, algorithm, and handtrap selections carry over from localStorage

**Given** the session history contains previous results
**When** the user wants to consult them
**Then** results are accessible via SolverService.history signal
**And** each entry contains the full SolverResult + the config used (deckId, hand, mode, speed, algorithm, handtraps)

**Given** a solve completing successfully
**When** the user adjusts 1-2 cards in the hand selector
**Then** the Solve button is immediately re-enabled (5/5 cards still selected)
**And** no full reconfiguration is needed — only the changed cards differ

---

### Story 3.1b: Session History UI

As a player,
I want to browse my previous solve results from this session,
So that I can revisit and compare earlier results without relying solely on pins.

**Acceptance Criteria:**

**Given** the SolverService.history signal contains at least 1 previous result
**When** the result area renders
**Then** a "History" mat-icon-button (history icon) is visible next to the Pin and Export buttons
**And** clicking it opens a mat-menu dropdown listing previous results in reverse chronological order (most recent first)
**And** each menu item displays: deck name, hand summary (1–5 card names truncated), score, mode label, and timestamp
**And** adversarial results additionally show minimax score

**Given** the user clicks a history entry
**When** the menu item is selected
**Then** the selected result is loaded into SolverService.result signal and state transitions to 'complete'
**And** the config panel updates to reflect the config of the restored result (hand, mode, speed, algorithm, handtraps) for easy re-solve with adjustments
**And** the previously displayed result is NOT lost — it remains in the history list

**Given** the user clicks a history entry from a different deck
**When** the menu item is selected
**Then** the result is loaded and state transitions to 'complete' (result display is self-contained)
**And** mode, speed, algorithm, and handtrap preferences are updated (global prefs)
**And** the hand selection is NOT restored (cards may not exist in the current deck)
**And** the history menu item already displays the source deck name, so the user knows the result is cross-deck

**Given** the history is empty (no previous results in this session)
**When** the page renders
**Then** the History button is hidden

**Given** the history contains 10 entries (max cap from Story 3.1)
**When** a new result arrives
**Then** the oldest entry is evicted (LRU) and the new entry is added at the top

---

### Story 3.2: Pin & Compare

As a player,
I want to pin solve result snapshots for side-by-side mental comparison across decks,
So that I can make data-driven build decisions instead of relying on gut feeling.

**Acceptance Criteria:**

**Given** a solve result is displayed
**When** the user clicks the Pin button (mat-icon-button, push_pin icon)
**Then** a summary snapshot is captured: score, end board cards, hand cards (1–5), config (mode, speed, algorithm, handtraps), minimax (if adversarial), deck name, deckSeed
**And** the snapshot is added to SolverService.pinnedResults signal

**Given** PinnedResultsBar component
**When** at least 1 pin exists
**Then** a horizontal bar renders above the result area
**And** each pin card (mat-card) displays: score, mini hand cards (1–5 thumbnails), mini end board cards (thumbnails), mode label, deck name, unpin button
**And** max 4 pins are allowed — Pin button is disabled when 4 pins exist

**Given** PinnedResultsBar
**When** the user clicks Unpin on a pin card
**Then** the pin is removed from SolverService.pinnedResults
**And** the bar hides if 0 pins remain

**Given** pins from different decks
**When** the user navigates to a different deck's solver page
**Then** all pins remain visible (flat list, each pin card shows its deck name)

**Given** pinned results
**When** a pin is added, removed, or the page loads
**Then** pins are persisted to localStorage (key: 'solver-pins')
**And** each pin stores a summary snapshot only: score, scoreBreakdown, mainPath actions (SolverAction[]), end board cardIds/names, hand cardIds/names, config (mode, speed, algorithm, handtraps), deckSeed, deckName, minimax (if adversarial), savedAt timestamp — NOT the full decision tree
**And** on page load, pins are restored from localStorage into SolverService.pinnedResults
**And** if a pinned deck has been modified since the pin was saved, the pin is displayed as-is (no automatic invalidation — the user re-solves with the same deckSeed to verify)

**Given** a pinned result from Build A
**When** the user solves Build B with the same handtraps
**Then** both results are visible simultaneously (pinned Build A + current Build B)
**And** the user can mentally compare scores, end boards, and minimax

---

### Story 3.3: Quick Solve & Keyboard Shortcuts

As a player,
I want one-click Quick Solve and keyboard shortcuts,
So that I can launch solves with minimal friction and navigate the solver efficiently.

**Acceptance Criteria:**

**Given** the SolverConfigComponent
**When** Story 3.3 is implemented
**Then** a "Quick Solve" button (mat-raised-button, secondary placement above Solve) is displayed
**And** clicking Quick Solve fills the hand to 5 with random cards from remaining deck (Fill Random) and immediately launches the solve
**And** Quick Solve works from any hand state (0–4 cards selected — completes to 5 then solves). Solve without Quick Solve works with 1–5 cards.

**Given** Quick Solve in idle state (no cards selected)
**When** clicked
**Then** transitions through idle → configuring → running in one click
**And** 5 random cards are selected and the solve launches immediately

**Given** the SolverPageComponent host element
**When** it renders
**Then** tabindex="0" is set on the host for keyboard focus
**And** a @HostListener('keydown') handles keyboard events with switch/case
**And** events are not intercepted when focus is on input or textarea elements (guard)

**Given** the keyboard shortcut Ctrl+Enter
**When** pressed while state = 'configuring' and 1–5 cards selected and not in rate limit cooldown
**Then** the solve launches (same as clicking Solve — same `canSolve` guard)
**And** the Solve button has aria-keyshortcuts="Control+Enter"

**Given** the keyboard shortcut Escape
**When** pressed while state = 'running'
**Then** the solve is cancelled (same as clicking Cancel)
**And** Escape has no effect in other states (no intercept)

**Given** the Solve button after a solve completes
**When** the user clicks Solve within 2s of the previous solve
**Then** the button is disabled (simple disabled state, no micro-timer)
**And** after 2s the button re-enables automatically

---

### Story 3.4: Export Result to Clipboard

As a player,
I want to copy my solve result as a compact JSON to share or archive,
So that I can keep a trace of my optimal combo path outside the app and share it with others.

**Acceptance Criteria:**

**Given** a solve result is displayed (state = 'complete')
**When** the user clicks the Export button (mat-icon-button, content_copy icon, next to the Pin button)
**Then** a compact JSON is copied to the clipboard via CDK Clipboard
**And** a brief NotificationService.success() toast confirms "Result copied to clipboard"

**Given** the exported JSON
**When** inspecting its content
**Then** it contains: deckName, deckId, deckSeed, hand (1–5 cardIds + cardNames), mode, speed, algorithm, algorithmUsed (actual algorithm that ran: 'dfs' | 'mcts'), score, scoreBreakdown, minimax (if adversarial), handtraps (if adversarial), adversarialTimings (if adversarial — enables re-verification of exported results), mainPath (array of SolverAction with cardName + actionDescription), timestamp
**And** it does NOT contain the full decision tree (too large for clipboard — mainPath only)
**And** the JSON is human-readable (pretty-printed with 2-space indent)

**Given** the exported JSON includes deckSeed
**When** the user later wants to reproduce the solve
**Then** they can paste the deckSeed into the solver config and re-solve with the same hand
**And** reproducibility is limited by in-game randomness: deckSeed controls the initial deck shuffle only, NOT OCGCore's internal PRNG (coin flips, random banish, shuffles after search effects). Exact for DFS on decks without in-game randomness. Approximate otherwise. MCTS adds its own stochastic rollouts on top

**Given** the SolverConfigComponent
**When** Story 3.4 is implemented
**Then** an optional "Deck Seed" input field (mat-input, collapsed by default via expandable section) is available in the config panel
**And** when a seed is provided, it is sent in SOLVER_START as deckSeed
**And** when empty, the server generates a random seed (existing behavior)
**And** the input has a mat-tooltip: "Exact reproduction for DFS without random effects. Approximate if the combo involves searches, shuffles, or coin flips. MCTS is always approximate."

**Given** no solve result is displayed (state != 'complete')
**When** the page renders
**Then** the Export button is hidden
