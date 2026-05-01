---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-03-22'
inputDocuments: ['prd-solver.md', 'technical-combo-path-solver-research-2026-03-22.md', 'poc-solver-results-2026-03-22.md', 'project-context.md', 'architecture.md']
workflowType: 'architecture'
project_name: 'skytrix'
user_name: 'Axel'
date: '2026-03-22'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

The PRD defines 31 FRs across 6 categories and 17 NFRs across 5 categories. See prd-solver.md for full requirements.

### Technical Constraints & Dependencies

- **Brownfield extension:** New solver module within existing duel-server (Node.js) and Angular 19 frontend. Must coexist with active PvP duel workers without resource contention.
- **OCGCore WASM as black-box oracle:** Forward-only (no undo/rollback). State forking via WASM Memory snapshot (Emscripten implementation detail, not stable API). Automatic fallback to replay-from-scratch required.
- **Single WASM instance per worker thread:** WASM linear memory is shared within an instance — each solver worker needs its own OCGCore WASM instance for isolation.
- **No new dependencies:** CDK Tree (CdkTree + CdkTreeNode) already installed. piscina already used conceptually (new pool, not new dep pattern). No d3/vis-network.
- **Existing WebSocket reuse:** Same WS connection as PvP duels. 8 new message types (SOLVER_START, SOLVER_CANCEL, SOLVER_INIT, SOLVER_PROGRESS, SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR, SOLVER_HANDTRAPS).
- **Spring Boot minimal impact:** No new REST endpoints. Decks via existing API. Interruption tags in JSON file (not PostgreSQL for MVP).
- **Desktop-first:** Tree viewer designed for desktop. No mobile target for MVP.
- **POC-validated baselines:** OCGCore 6µs/action, WASM snapshot 10ms, duel creation 55-67ms, combo deck branching factor 15.6.

### Cross-Cutting Concerns Identified

- **Resource isolation:** Solver worker pool must be completely separate from duel workers. Core reservation (min 2 cores for event loop + active duels). Memory budget enforcement per pool via `worker_threads` `resourceLimits.maxOldGenerationSizeMb` (per-worker V8 heap cap). When a worker exceeds its limit, V8 terminates it with an OOM error — the orchestrator catches the worker crash, logs WARNING, and returns `SOLVER_ERROR { error: 'MEMORY_LIMIT' }`. Per-worker limit = `memoryBudgetMb / poolSize` (e.g., 512MB / 6 workers ≈ 85MB each).
- **Anytime behavior:** Every algorithm must support interruption and return best-so-far. Permeates all strategy implementations, the orchestrator, and the WS protocol.
- **State forking strategy:** Snapshot vs replay-from-scratch choice varies by algorithm (DFS prefers snapshot at branch points, MCTS prefers replay from root). The GameOracle interface must support both patterns.
- **Termination guarantees:** Max depth (50) + Zobrist hash loop detection applies to all strategies. Not algorithm-specific — cross-cutting safety net.
- **Legality post-condition:** Every returned sequence must be verified by replaying on OCGCore. Cross-cutting across all result paths (normal completion, timeout, cancellation). If the best path (mainPath) fails verification, the solver silently falls back to the highest-scoring valid path and recomputes mainPath from the pruned tree. The invalidation is logged server-side (NFR17) but not surfaced to the user.
- **Progress reporting:** All strategies must emit progress via MessagePort at configurable intervals. Throttled to avoid WS backpressure.
- **WASM lifecycle management:** Each worker must properly create/destroy duel handles (no heap leak). Smoke test at boot. Fallback logging.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- GameOracle interface design (fork-based, with FieldState contract)
- SolverStrategy interface (callback progress, strategy metadata)
- Decision tree data model (DecisionNode with confidence scoring)
- Worker pool architecture (root parallelism, piscina, top-K aggregation)
- WS protocol payloads (6 message types including SOLVER_ERROR)

**Important Decisions (Shape Architecture):**
- Zobrist hashing (dual 32-bit, incremental, verification key)
- Interruption scoring model (15 types, configurable weights, fallback heuristic)
- Frontend component hierarchy (SolverPage → Config/Progress/Result)
- Configuration file structure (4 separate JSON files)
- ActionRanker interface (pruning/ordering)
- Algorithm auto-detection (BF-based DFS/MCTS switch)

**Deferred Decisions (Post-MVP / Phase 2):**
- Node detail panel (full board state visualization)
- Side-by-side build comparison UI
- Tags migration to PostgreSQL
- Neural MCTS policy network
- Scoring synergies (negate + floodgate combo bonuses)
- Checkpoint system for deep MCTS replays

### Domain Core — GameOracle Interface

**Decision: Fork-based interface with handle tracking**

```typescript
interface DuelConfig {
  mainDeck: number[];         // player 0 main deck cardIds (remaining after hand removal, shuffled by deckSeed)
  extraDeck: number[];        // player 0 extra deck cardIds
  hand: number[];             // player 0 starting hand (1–5 cardIds)
  deckSeed: number;           // PRNG seed used to shuffle mainDeck
  opponentDeck: number[];     // player 1 main deck (40× filler for goldfish, filler for adversarial)
  handtraps?: number[];       // player 1 hand injection cardIds (adversarial only) — injected via duelNewCard() post-creation
}

interface Action {
  responseIndex: number;      // index to pass back to OCGCore via duelSetResponse()
  cardId: number;             // card involved (0 if no card, e.g., "pass" on SELECT_CHAIN)
  promptType: string;         // OCGCore prompt type ('SELECT_IDLECMD' | 'SELECT_CHAIN' | 'SELECT_EFFECTYN' | etc.)
  isExploratory: boolean;     // true = creates tree branch, false = mechanical (auto-resolved)
}

interface GameOracle {
  createDuel(config: DuelConfig): DuelHandle;
  getLegalActions(handle: DuelHandle): Action[];
  applyAction(handle: DuelHandle, action: Action): void;
  fork(handle: DuelHandle): DuelHandle;
  getFieldState(handle: DuelHandle): FieldState;
  destroyDuel(handle: DuelHandle): void;
  destroyAll(): void;  // safety net — cleanup all active handles
  readonly snapshotAvailable: boolean;  // false if WASM snapshot failed
}

interface FieldState {
  zones: Record<ZoneId, FieldCard[]>;
  lifePoints: [number, number];
  turn: number;
  phase: number;
}

interface FieldCard {
  cardId: number;
  cardName: string;
  position: 'faceup-atk' | 'faceup-def' | 'facedown-def' | 'facedown';
  overlayCount: number;
}
```

**Rationale:** Explicit lifecycle (create/fork/destroy), natural memory monitoring via handle counting (NFR16). DFS uses `fork()` → explore → `destroyDuel()`. MCTS uses `createDuel()` + replay from root (doesn't need fork). Performance identical (~12ms per fork).

**Handle tracking:** OCGCoreAdapter maintains a `Set<DuelHandle>` of all active handles. `destroyAll()` called in `finally` block by worker after each solve — safety net against leaks on exceptions.

**Raw OCGCore reads:** `getFieldState()` calls `duelQueryField()` directly on the OCGCore WASM instance. It does NOT go through `RenderedBoardStateService` or any animation-layer abstraction. The solver operates in its own worker threads with its own WASM instances — completely isolated from the PvP/replay animation pipeline.

**Fork fallback path:** `fork()` internally tries WASM snapshot → on failure: log WARNING → fallback to `createDuel()` + replay all actions from source handle. `snapshotAvailable` flag lets strategies adapt their budget (replay is ~6x slower).

**Smoke test at boot:** Worker startup verifies WASM Memory hook → sets `snapshotAvailable`. Logged at INFO level.

**Affects:** All solver strategies, OCGCoreAdapter, memory budget enforcement, Zobrist hasher, interruption scorer.

### Domain Core — SolverStrategy Interface

**Decision: Callback-based progress with strategy metadata**

```typescript
interface SolverStrategy {
  readonly name: string;
  readonly supportsAdversarial: boolean;
  solve(
    oracle: GameOracle,
    config: SolverConfig,
    signal: AbortSignal,
    onProgress: (progress: SolverProgress) => void
  ): Promise<SolverResult>;
}

interface SolverConfig {
  mode: 'goldfish' | 'adversarial';
  speed: 'fast' | 'optimal';
  timeLimitMs: number;
  handtraps?: HandtrapConfig[];
}

interface HandtrapConfig {
  cardId: number;
  cardName: string;
}

interface SolverProgress {
  nodesExplored: number;
  bestScore: number;
  elapsed: number;
  highComplexity?: boolean;  // true if BF > threshold
}
```

**Rationale:** Single event type (progress) doesn't justify an EventEmitter. AbortSignal handles cancellation. `name` + `supportsAdversarial` metadata lets the orchestrator validate strategy/mode compatibility at dispatch time.

**Adversarial support per strategy:**
- **DFS** — `supportsAdversarial: false`. DFS explores exhaustively; branching on every opponent `SELECT_CHAIN` window (activate × N handtraps + pass) would make the tree intractable. DFS is goldfish-only.
- **MCTS (Minimax MCTS)** — `supportsAdversarial: true`. Minimax MCTS with two-player backpropagation (player=max, opponent=min) handles the deterministic stress-test model: the opponent is assumed to have ALL configured handtraps in hand and activates at optimal timing. No determinization or subset sampling — the uncertainty being modeled is *timing*, not *hand contents*.
- **Auto mode** with adversarial: always dispatches to MCTS regardless of measured BF.

**Rollout policy (critical for combo decks):**
Pure random rollouts will almost never produce a coherent combo line in Yu-Gi-Oh! (probability of randomly chaining the correct sequence of activations through a 15+ BF tree is negligible → nearly all rollouts score 0, making UCB1 statistics meaningless). MCTS MUST use a **domain-aware rollout policy**:
- **Default: epsilon-greedy with GoldfishChainRanker.** During rollouts, with probability `1 - epsilon` (default 0.9), use the GoldfishChainRanker to select the highest-ranked action; with probability `epsilon` (default 0.1), select randomly. This biases rollouts toward coherent combo lines while preserving exploration diversity.
- `epsilon` is exposed as `rolloutEpsilon` in `solver-config.json` (range 0.0-1.0, default 0.1).
- Adversarial rollouts use the same epsilon-greedy policy for the player. Opponent SELECT_CHAIN actions during rollouts are selected by the adversarial minimax policy (not random).
- The ActionRanker used during rollouts is the same instance as for tree expansion — no separate rollout ranker.

**Backpropagation policy:**
- **Goldfish (SP-MCTS):** Max backpropagation — parent score = best child score. Prioritizes high-ceiling combo paths (we care about the best board, not the average). UCB1 exploration constant C may need to be higher than standard (√2) to compensate for max-backprop inflation.
- **Adversarial (Minimax MCTS):** Two-player minimax backpropagation — player nodes propagate max (best action for the player), opponent nodes propagate min (worst-case handtrap timing for the player). The `minimax` field in `SolverResult` is the root score of this minimax tree, not a post-hoc traversal. The tree is inherently minimax — opponent `SELECT_CHAIN` nodes select the child that minimizes the player's score. The opponent always has access to ALL selected handtraps in hand (no subset filtering).

**Affects:** DFS solver, SP-MCTS solver, future algorithm additions, orchestrator validation.

### Domain Core — ActionRanker Interface

**Decision: Optional pruning/ordering dependency for strategies**

```typescript
interface ActionRanker {
  rank(actions: Action[], state: FieldState): Action[];
}
```

**Rationale:** Strategies call `ranker.rank()` before exploring children. Critical for DFS on high-BF decks (Snake-Eye BF ~25 requires pruning to top-5 for tractability).

**Default implementation — GoldfishChainRanker (not identity):**

In goldfish mode, `SELECT_CHAIN` for player 0 is the primary source of branching factor inflation. Modern combo decks chain 10-20 trigger effects per turn, each creating N+1 branches (activate each legal chain + pass). Without pruning, this alone pushes BF above 40 for competitive decks.

The default `GoldfishChainRanker` applies the following heuristic for `SELECT_CHAIN` actions in goldfish mode:
- **Single legal activation** → auto-resolve (treat as mechanical — no branch)
- **Multiple legal activations** → rank "activate" above "pass" for effects classified as beneficial (draw, search, special summon). Pass is kept as last option (not removed — the solver can still explore it)
- **"Pass" on optional triggers where all options are beneficial** → deprioritized but not pruned

This reduces effective BF from ~40 to ~12-15 for typical combo decks. The classification is **heuristic-based** (hardcoded in the ranker, not a config JSON file). Beneficial effects are identified by **OCGCore's response buffer from `duelProcess()`**, which includes the card ID and effect description for each chainable activation in a SELECT_CHAIN prompt. The ranker classifies effects by matching known effect description patterns (e.g., patterns containing "draw", "add.*from.*Deck.*to.*hand" for search, "Special Summon" for summon) — NOT via `duelQueryField()` (which returns field state, not pending activation data). This pattern-matching approach is fragile for edge cases but covers the standard combo archetypes (Branded, Snake-Eye, Tearlaments, etc.). Cards with unusual effect text may be misclassified — the fallback is to treat unrecognized effects as "beneficial" (activate > pass). The ranker is overridable per strategy.

**Future implementations:** WindBot-derived heuristics, progressive widening, action type filtering.

**Affects:** All solver strategies (opt-in usage). DFS and MCTS both use the ranker by default.

### Data Architecture — Decision Tree Model

```typescript
interface DecisionNode {
  action: SolverAction | null;       // null for root
  annotation: string;                // generated by OCGCoreAdapter only
  score: number;
  scoreBreakdown?: ScoreBreakdown;   // terminal nodes only
  confidence: number;                // 0-1: MCTS = visits/total, DFS = 1.0 exhaustive / 0.5 pruned
  children: DecisionNode[];          // sorted by score desc — first child = recommended path
  isTerminal: boolean;
  handtrapLabel?: string;            // adversarial branching nodes only
  prunedChildren?: number;           // how many branches not shown at this node
  truncated?: boolean;               // true if subtree was cut for size limit
}

interface SolverAction {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
}

interface ScoreBreakdown {
  omniNegate: number;
  typedNegate: number;
  targetedNegate: number;
  floodgate: number;
  controlChange: number;
  banish: number;
  banishFacedown: number;
  attach: number;
  spin: number;
  flipFacedown: number;
  destruction: number;
  moveToSt: number;
  bounce: number;
  handRip: number;
  sendToGy: number;
  total: number;
}
```

**Design rules:**
- `children` sorted by score descending — first child is always the recommended path (FR18 breadcrumb)
- `annotation` generated exclusively by OCGCoreAdapter (single source of truth for card names and action descriptions)
- `confidence` unifies MCTS visit counts and DFS exhaustiveness into a single 0-1 semantic
- `prunedChildren` enables UI to display "... and 12 other branches"
- `truncated` flag for subtrees cut by `maxResultNodes` limit
- Tree pruning (top-X per node) and max result nodes (default 500) applied server-side before sending to client

### Worker Architecture & Parallelism

**Decision: Root parallelism with piscina dedicated pool and top-K aggregation**

| Aspect | Decision |
|---|---|
| Pool | piscina, separate from duel worker pool |
| Sizing | Configurable. Default: `os.availableParallelism() - 2` |
| Parallelism | Root parallelism — each worker independent, zero synchronization |
| Seed diversity | Each worker receives different PRNG seed |
| Progress | Each worker emits via MessagePort. Orchestrator aggregates (max best score, sum nodes) and throttles to WS (200ms) |
| Cancellation | AbortController per solve. abort() on SOLVER_CANCEL or WS close |
| Aggregation | Top-K per worker (default K=3). Orchestrator merges: (1) keep global best tree by score, (2) deduplicate remaining trees by mainPath hash (same action sequence = same tree, discard lower-scoring duplicate), (3) keep up to `treePruningTopX` distinct alternatives sorted by score. No complex diversity metric — dedup is sufficient for MVP. **Invariant:** the orchestrator never reconstructs a mainPath — it only reorders and deduplicates existing worker-verified results. The final SOLVER_RESULT.mainPath is always a path that was verified (NFR12) by the originating worker |
| Verification budget | **Verification (NFR12) cost estimation:** creating a fresh duel ≈ 60ms, replaying 30 actions ≈ 0.2ms, total ≈ 62ms per path. At K=3 paths per worker, verification costs ~186ms per worker. This is sequential (single OCGCore instance per worker). Strategies MUST reserve 15% of their time budget for verification (e.g., Fast 5s → explore for 4.25s, verify for 0.75s; Optimal 60s → explore for 51s, verify for 9s). The reserved budget accommodates worst-case verification (3 paths × 60ms creation + replay) plus potential recomputation if the best path fails. `verificationBudgetRatio` is configurable in solver-config.json (default 0.15, range 0.05-0.30) |
| Concurrency | 1 solve per user. New SOLVER_START aborts current solve |
| Warm pool | piscina `idleTimeout` keeps workers alive between solves. WASM module stays loaded. No cold start except first solve |
| Memory enforcement | `resourceLimits.maxOldGenerationSizeMb` per worker. **Budget formula:** WASM linear memory (~16-20MB per instance) lives outside V8's managed heap and is invisible to `maxOldGenerationSizeMb`. Per-worker V8 cap = `(memoryBudgetMb - (poolSize × 20)) / poolSize` (reserves 20MB per worker for WASM). Example: 512MB budget, 6 workers → (512 - 120) / 6 ≈ 65MB V8 heap per worker. V8 OOM → orchestrator catches → `SOLVER_ERROR { error: 'MEMORY_LIMIT' }`. No polling/MessagePort needed — V8 enforcement is native. WASM memory is bounded by OCGCore's allocation pattern (1 duel ≈ 16MB, fork snapshots are transient) |
| Hard-kill timeout | Orchestrator sets a `setTimeout` at `timeLimitMs * 1.5` per solve (wrapping `Promise.allSettled()` of all worker tasks). If any worker hasn't returned by then (stuck WASM call, AbortSignal not checked), the orchestrator calls `AbortController.abort()` and resolves with whatever results are available. Safety net — should never fire under normal operation |
| Worker I/O | Zero — orchestrator (main thread) loads deck via HTTP, constructs DuelConfig, passes to worker via pool.run() |

**Algorithm auto-detection:** `algorithm` field in SOLVER_START accepts `'dfs' | 'mcts' | 'auto'` (default: `'auto'`). Auto mode: run 100 nodes DFS → measure average BF → if BF < 12 continue DFS, else switch to MCTS. **Probe reuse:** The 100-node DFS probe tree is NOT discarded. If the worker continues with DFS, it resumes exploration from the probe's frontier (no wasted work). If it switches to MCTS, the probe's tree is used as warm-start — probe leaf nodes seed the initial MCTS tree, and their scores initialize the UCB1 statistics. This ensures the probe budget (~1-2% of Fast time) is amortized into the solve.

**Complexity detection:** After 100 nodes, if measured BF > configurable threshold (default 25), emit `SOLVER_PROGRESS` with `highComplexity: true`. Client displays warning. Solver continues (anytime behavior).

### Zobrist Hashing & Transposition Table

| Aspect | Decision |
|---|---|
| Hash size | 64-bit via two 32-bit `number` (not BigInt — 5-10x slower in V8) |
| Zobrist table | Pre-generated at worker boot: `zobrist[cardId][zoneId][position]` with crypto PRNG |
| Hash components | Card positions (all zones including GY, banished, extra) + phase + turn count modulo 4. GY and banished zones are included because they directly affect legal actions (GY recursion, banished recovery) and board evaluation. Excluding pile zones causes false transposition hits where identical fields with different GY contents produce cached suboptimal lines |
| Update | Incremental O(1) per action: `hash ^= old ^ new` |
| Loop detection | Hash set on current path. Hash already seen → cut branch |
| Transposition table | `Map` per worker, per solve (reset between solves) |
| Entry | `{ hash, depth, score, bestAction, boundType, verificationKey }` |
| Verification key | Compact fingerprint (cards-per-zone + top card IDs + overlay counts per zone + face-down flag count per zone). On lookup, fingerprint must match — else treated as cache miss |
| Replacement | Replace if new depth ≥ existing |
| Table size | Bounded — max entries configurable (default 25K) for NFR16. **Memory estimation:** each entry ≈ 300-400 bytes in V8 (hash pair + depth + score + bestAction object + boundType string + verification key fingerprint array + Map overhead). At 25K entries per worker × 6 workers = 150K entries ≈ 45-60MB total, fitting within the per-worker V8 heap cap of ~65MB with headroom for tree nodes and other allocations. The previous default of 100K entries would consume ~180-240MB across 6 workers, exceeding the per-worker budget |
| Usage | DFS uses transposition table. MCTS does not (independent rollouts). Opt-in per strategy |

**OPT/HOPT and hash correctness:** The hash does NOT include once-per-turn activation flags — intentionally. OCGCore tracks OPT/HOPT restrictions internally and `getLegalActions()` returns only currently legal activations. Two board positions with identical card layout but different activation histories produce **different legal action sets** from OCGCore, so the solver naturally explores different branches. The transposition table stores `bestAction` which is validated against the current legal action set on lookup — a stale action triggers re-exploration. Combined with the verification key (cards-per-zone fingerprint), this ensures cache correctness without encoding activation history in the hash.

**Verification key includes overlay and face-down state:** The verification key fingerprint includes overlay counts and face-down flag counts per zone, in addition to cards-per-zone and top card IDs. This prevents false transposition hits where two states have identical card layout but different overlay materials or face-down positions (common with OPT/HOPT effects activated in different orders). The OPT activation history itself is NOT in the key — OCGCore's `getLegalActions()` already differentiates those states via different legal action sets, and `bestAction` is validated on lookup.

### Interruption Scoring

**15 interruption types with configurable weights:**

| Type | Default Weight |
|---|---|
| `omni-negate` | 14 |
| `floodgate` | 12 |
| `typed-negate` | 10 |
| `targeted-negate` | 9 |
| `control-change` | 8 |
| `banish` | 8 |
| `banish-facedown` | 8 |
| `attach` | 8 |
| `spin` | 7 |
| `flip-facedown` | 7 |
| `destruction` | 6 |
| `move-to-st` | 6 |
| `bounce` | 6 |
| `hand-rip` | 6 |
| `send-to-gy` | 5 |

**Scoring formula:** `sum(typeWeight × usesPerTurn)` for each effect of each tagged card on the final field. `typeWeight` comes from `interruption-weights.json` (global per-type weights). `interruption-tags.json` defines which effects a card has (`type` + `usesPerTurn`) but does NOT carry its own weight — the weight is always looked up from the global weights file. This single-source-of-weight design prevents drift between per-card and per-type values.
**A card can have multiple types** (e.g., Baronne = `omni-negate` + `destruction` — each effect scored independently with its type's weight).
**Brick detection:** Total score = 0 → "no viable combo" (FR25).

**Fallback heuristic for untagged cards:** Each face-up monster on the field = 1 base point. Guarantees the solver finds "the board with the most presence" even without tags. Contextual scoring (interruption types) adds on top. Prevents false "no viable combo" for rogue decks with untagged end-board cards.

### WS Protocol

**8 message types:**

| Direction | Type | Payload |
|---|---|---|
| Client → Server | `SOLVER_START` | `{ deckId, hand, mode, speed, algorithm, handtraps?, deckSeed?, verifyPath?, verifyTimings? }` |
| Client → Server | `SOLVER_CANCEL` | `{}` |
| Server → Client | `SOLVER_PROGRESS` | `{ nodesExplored, bestScore, elapsed, highComplexity? }` |
| Server → Client | `SOLVER_RESULT` | `{ tree, mainPath, score, scoreBreakdown, minimax?, adversarialTimings?, stats, verified? }` |
| Server → Client | `SOLVER_CANCELLED` | `{ partialTree?, stats }` |
| Server → Client | `SOLVER_ERROR` | `{ error, message }` |
| Client → Server | `SOLVER_INIT` | `{}` |
| Server → Client | `SOLVER_HANDTRAPS` | `{ handtraps: HandtrapConfig[] }` |

**SOLVER_INIT / SOLVER_HANDTRAPS handshake:** The client sends `SOLVER_INIT` when the user navigates to the solver page (SolverService first injection). The server responds with `SOLVER_HANDTRAPS` containing the `handtraps.json` content + any cached SOLVER_RESULT for the user. This is a request/response pattern (not fire-on-connect) because SolverService is `providedIn: 'root'` and lazily instantiated — a message sent on WS connect would be lost if the user hasn't visited the solver page yet. **The frontend does NOT hardcode handtrap cardIds** — it reads them from `SOLVER_HANDTRAPS`. Single source of truth: `handtraps.json` on the server. The server validates that handtrap cardIds in SOLVER_START match its own list.

```typescript
interface SolverErrorMessage {
  type: 'SOLVER_ERROR';
  error: 'DECK_NOT_FOUND' | 'DECK_ACCESS_DENIED' | 'WASM_INIT_FAILED' | 'RATE_LIMITED' | 'MEMORY_LIMIT' | 'INTERNAL_ERROR';
  message: string;
}
```

**Rules:**
- `SOLVER_START` replaces any running solve (no solverId needed — 1 solve/user). `algorithm` default: `'auto'`
- **Deck order:** The 5 hand cards are removed from the main deck, and the remaining cards are shuffled with a random seed generated server-side. The seed is included in `SolverStats` for reproducibility (`stats.deckSeed`). Repeated solves of the same hand explore different deck orderings — this is intentional (draw-dependent lines vary). The solver evaluates the **given** ordering, not all possible orderings.
- `SOLVER_RESULT` includes pre-computed `mainPath` (client doesn't traverse tree)
- `SOLVER_CANCELLED` returns `partialTree` if solver found at least one result (anytime FR16)
- Progress throttled at 200ms server-side
- Rate limit: max 1 `SOLVER_START` per user per 2 seconds (configurable in `solver-config.json`)
- **Multi-user limitation (MVP):** The solver pool is shared across all users with no cross-user queuing or fairness policy. Root parallelism uses all available workers per solve. With default pool size (`availableParallelism() - 2`, typically 6), 2+ concurrent users will compete for the same workers. Acceptable for MVP (personal project, single user). **Phase 2:** per-user worker quotas, queue depth limits, and backpressure (reject with SOLVER_ERROR when queue is full).

- **Result resilience:** Server caches last `SOLVER_RESULT` per userId in memory (5-minute TTL, evicted on next `SOLVER_START`). On WS reconnect, cached result is automatically resent. WS disconnect does NOT abort a running solve — the solve continues and its result is cached for delivery on reconnect.
- **Verify mode (FR31):** `SOLVER_START` accepts optional `verifyPath?: SolverAction[]` and `verifyTimings?: AdversarialTiming[]`. The verifier replays the player's action sequence and injects opponent handtrap activations at the declared timings (from `adversarialTimings` in the original result). `SOLVER_RESULT` includes `verified?: boolean`. No new WS message type needed.

**Deck loading flow:** WS handler receives `SOLVER_START` → HTTP internal call `GET /api/decks/{deckId}` with user's JWT → Spring Boot validates ownership → deck list passed to worker. Same pattern as PvP duel.

### Frontend Architecture

**Layout:** Full-viewport with horizontal collapsible config panel (replay/transport bar pattern). Config panel at top, full width. Collapses after first solve completes; uncollapses on state transition to `configuring`. Maximizes horizontal space for decision tree indentation.

**Component hierarchy:**
```
SolverPageComponent (lazy-loaded /decks/:id/solver)
├── SolverConfigComponent (horizontal, full width, collapsible)
│   ├── Hand selector (1–5 cards from deck, or Fill Random to 5)
│   ├── Mode toggle (Goldfish / Adversarial)
│   ├── Speed toggle (Fast / Optimal)
│   ├── Algorithm select (DFS / MCTS / Auto)
│   ├── Handtrap checkboxes (adversarial only)
│   └── Solve / Cancel / Quick Solve buttons
├── SolverProgressComponent (mat-progress-spinner + live stats + cancel)
├── SolverHistoryMenu (mat-menu, reverse chronological, click to restore — Story 3.1b)
├── PinnedResultsBar (horizontal bar, max 4 pins, visible across decks)
├── HeroResultBlock (score + end board + interruption chips + pin/history/export buttons)
├── BrickStateBlock (pure-brick / no-resilient-line states)
├── BreadcrumbPathComponent (main path, Material chips, horizontal scroll)
└── DecisionTreeComponent (CDK flat tree)
    └── TreeNodeComponent (card art + annotation + score badges)
```

| Aspect | Decision |
|---|---|
| Route | `/decks/:id/solver` in `app.routes.ts`, lazy-loaded |
| Layout | Full-viewport, horizontal config at top, collapsible after first solve (transport bar pattern) |
| State machine | Signal: `'loading' \| 'idle' \| 'configuring' \| 'running' \| 'cancelled' \| 'complete' \| 'error'` |
| SolverService | `providedIn: 'root'`, manages WS communication, exposes signals. Root-scoped for session history persistence across navigations (FR26). Pinned results persisted to localStorage. **WS lifecycle:** Solver messages share the existing WS connection (always open when authenticated). SolverService registers SOLVER_* handlers on the shared connection at construction and processes incoming messages regardless of current route — this is intentional for result resilience (server resends cached result on reconnect). No component-scoped adapter needed — unlike PvP (which needs per-duel scoping), the solver has a single global solve per user. |
| Session history | `Signal<SolverResult[]>` in SolverService, client-side in-memory (FR26) |
| Tree component | CDK `CdkTree` flat mode + `getLevel()` for performance (NFR4/NFR5) |
| i18n | Labels in `fr.json` / `en.json` (ngx-translate) |

### Configuration Files

| File | Content | Reload |
|---|---|---|
| `duel-server/data/solver-config.json` | Pool size, max depth, time budgets (fast/optimal), progress throttle interval, tree pruning top-X, maxResultNodes (500), transposition table max entries (25K), memory budget (512MB), BF complexity threshold (25), rate limit interval (2s), maxHandtraps (5), ucb1C (float, default √2 ≈ 1.414), backpropPolicy ('max' \| 'mean', default 'max'), rolloutEpsilon (float, default 0.1), verificationBudgetRatio (float, default 0.15) | At boot |
| `duel-server/data/interruption-tags.json` | cardId → effects[] (type, usesPerTurn) for 150 end-board cards. No per-card weight — weight comes from interruption-weights.json by type | At boot |
| `duel-server/data/interruption-weights.json` | Default weights for 15 interruption types | At boot |
| `duel-server/data/handtraps.json` | 5 MVP handtraps (cardId, cardName) | At boot |

### Decision Impact Analysis

**Cross-Component Dependencies:**
- GameOracle ← consumed by all SolverStrategy implementations. FieldState ← consumed by ActionRanker + Zobrist hasher + interruption scorer
- SolverStrategy ← instantiated by worker based on config algorithm field. Orchestrator validates `supportsAdversarial` before dispatch
- ActionRanker ← optional dependency of strategies, called before child exploration
- DecisionNode ← produced by strategies, serialized over WS, consumed by Angular DecisionTreeComponent
- ScoreBreakdown ← produced by interruption scorer using FieldState, embedded in DecisionNode, displayed by TreeNodeComponent
- SolverConfig ← read by orchestrator + workers, referenced by WS SOLVER_START payload. Includes HandtrapConfig for adversarial
- Interruption tags ← loaded at boot by workers, used by scorer at leaf evaluation. Fallback heuristic for untagged cards
- Zobrist hash ← computed incrementally by strategies, used for loop detection + transposition table. Verification key from FieldState

## Implementation Patterns & Consistency Rules

_These patterns supplement the existing project-context.md (62 rules). They cover solver-specific decisions where AI agents could diverge._

### Oracle Usage Patterns

**Rule: Never call `applyAction` without checking `getLegalActions` first.**
An action not in the legal actions list will corrupt OCGCore state silently. Every strategy must validate actions against the legal list before applying.

**Rule: Hanging `duelProcess()` calls are handled by the orchestrator hard-kill, not per-call timeouts.**
OCGCore runs Lua scripts for card effects. A buggy script can hang indefinitely inside a single `duelProcess()` call. Because `duelProcess()` is a **synchronous WASM call** that blocks the worker's event loop, a `setTimeout` inside the worker cannot fire while the call is executing. The only effective backstop is the orchestrator's hard-kill timeout (1.5× time budget) on the main thread — it calls `worker.terminate()` to kill the stuck worker, then resolves with whatever results other workers produced. No per-call timeout is possible inside the worker for synchronous WASM calls.

**Rule: Always wrap solve execution in try/finally with `oracle.destroyAll()`.**
```typescript
// CORRECT
try {
  const result = await strategy.solve(oracle, config, signal, onProgress);
  return result;
} finally {
  oracle.destroyAll();
}
```

**Rule: Fork before mutating, never fork after.**
`fork()` captures current state. Always fork from the parent state, then apply on the child.
```typescript
// CORRECT
const child = oracle.fork(parent);
oracle.applyAction(child, action);

// WRONG — parent mutated, fork captures wrong state
oracle.applyAction(parent, action);
const child = oracle.fork(parent);
```

**Rule: Annotations come from the adapter, not the strategy.**
Strategies work with `Action` objects (responseIndex, cardId). The `OCGCoreAdapter` enriches annotations (card name, action description) when building the `DecisionNode`. Strategies never construct annotation strings.

### Worker Communication Patterns

**Rule: Progress emission frequency.**
Strategies emit `onProgress()` every 100 nodes OR every 200ms, whichever comes first.

```typescript
if (nodesExplored % 100 === 0 || Date.now() - lastProgress > 200) {
  onProgress({ nodesExplored, bestScore, elapsed: Date.now() - startTime });
  lastProgress = Date.now();
}
```

**Rule: Workers never do I/O.**
Workers receive all inputs via `pool.run(payload)`. No HTTP calls, no file reads, no WS access from workers. The orchestrator (main thread) handles all I/O.

**Rule: AbortSignal check location.**
Strategies check `signal.aborted` at the top of each node expansion loop, not inside nested functions. One check point per iteration.

```typescript
while (!signal.aborted && budget.hasRemaining()) {
  const node = selectNode();
  expand(node);
}
```

### Solver Result Contract

**Rule: All strategies return the same `SolverResult` structure.**

```typescript
interface SolverResult {
  tree: DecisionNode;
  mainPath: SolverAction[];
  score: number;
  scoreBreakdown: ScoreBreakdown;
  stats: SolverStats;
  adversarialTimings?: AdversarialTiming[];  // adversarial only — opponent actions needed for verify mode
  minimax?: number;                          // adversarial only — worst-case score across handtrap branches
  verified?: boolean;                        // verify mode only — true if replay confirmed the path
}

interface AdversarialTiming {
  stepIndex: number;          // 0-based index in mainPath. Semantics: the verifier applies mainPath[0..stepIndex] inclusive, then injects this opponent response, then continues with mainPath[stepIndex+1..]. Example: stepIndex=7 means "after player action mainPath[7] was applied, opponent activated this handtrap"
  handtrapCardId: number;     // cardId of the handtrap activated
  handtrapCardName: string;   // display name
  responseIndex: number;      // OCGCore response for the opponent's SELECT_CHAIN
}

interface SolverStats {
  nodesExplored: number;
  elapsed: number;
  algorithm: string;           // requested algorithm ('dfs' | 'mcts' | 'auto')
  algorithmUsed: string;       // actual algorithm that ran ('dfs' | 'mcts') — important for reproducibility: exported deckSeed is exact for DFS, approximate for MCTS
  maxDepthReached: number;
  averageBranchingFactor: number;
  transpositionHits?: number;
  deckSeed: number;            // server-generated seed used to shuffle remaining deck cards — enables reproduction (see deckSeed limitations below)
}
```

The orchestrator relies on this exact shape for top-K aggregation across workers. Any deviation breaks the merge.

### State Management Patterns (Frontend)

**Rule: Solver state transitions are explicit and unidirectional.**
```
loading → idle → configuring → running → complete
                                  ↓         ↓
                               cancelled   configuring (new solve)
                               ↓      ↓
                     (partial) → complete
                     (no partial) → configuring
                                  ↓
                                error → configuring
```
- `cancelled` is a transitional state: if `partialTree` exists → `complete` with partial badge; otherwise → `configuring`.
- No direct jump from `loading` to `running`. No `complete` → `idle`.

**Rule: All WS message handlers update signals, not component state.**
SolverService owns all signals. Components read via `computed()`. No component-local state for solver data.

### Error Handling Patterns

**Rule: Worker errors become SOLVER_ERROR, never silent failures.**
If a worker throws, the orchestrator catches, logs, and emits `SOLVER_ERROR` over WS.

**Rule: WASM snapshot failure is a WARNING, not an ERROR.**
Fallback to replay-from-scratch is automatic. Log: `[Solver] WARN: WASM snapshot unavailable, falling back to replay-from-scratch (6x slower)`. The solve continues.

**Rule: Invalid deck / missing cards is SOLVER_ERROR.**
Never start a solve with incomplete data.

### Degraded Mode Pattern

**Rule: In no-snapshot mode, time budgets remain unchanged.**
When `snapshotAvailable = false`, the solver uses the same Fast 5s / Optimal 60s budgets. The solver explores fewer nodes (replay is ~6x slower), producing lower-quality results. The latency remains predictable. Do not multiply budgets — predictable timing is more important than result quality.

### Data Flow Patterns

**Rule: Unidirectional data flow through the solver pipeline.**
```
SOLVER_START (WS)
  → Orchestrator validates config + rate limit
  → Orchestrator loads deck (HTTP → Spring Boot)
  → Orchestrator builds DuelConfig
  → pool.run({ config, deck, seed }) → Worker
  → Worker: oracle.createDuel() → strategy.solve() → SolverResult
  → Worker returns SolverResult to Orchestrator
  → Orchestrator aggregates top-K across workers
  → Orchestrator prunes tree (maxResultNodes, top-X)
  → Orchestrator extracts mainPath from best tree
  → SOLVER_RESULT (WS)
```

**Rule: Tree pruning happens in the orchestrator, not the strategy.**
Strategies return full trees. The orchestrator applies pruning before serializing to WS. Centralized and configurable.

### Logging Patterns

**Rule: Use `console.log/warn/error` with `[Solver]` prefix.**
No logging library. Matches existing duel-server pattern (`[UpdateData]`, etc.).

**Rule: Every completed solve is logged (NFR17).**
```typescript
console.log('[Solver] solve-complete', {
  deckId, algorithm: strategy.name, mode: config.mode,
  speed: config.speed, nodesExplored, finalScore: result.score,
  elapsedMs: Date.now() - startTime, workersUsed: poolSize,
  snapshotAvailable: oracle.snapshotAvailable,
});
```

**Rule: Log levels for solver events.**

| Event | Level |
|---|---|
| Solve start/complete/cancel | `console.log` `[Solver]` |
| WASM snapshot fallback | `console.warn` `[Solver]` |
| Worker crash / unhandled error | `console.error` `[Solver]` |
| Node-level debug (per-action) | `console.log` `[Solver:debug]` (disabled by default) |

### Config Access Patterns

**Rule: Config loaded once at boot, injected into workers via `workerData`.**
Workers never read files from disk. Config changes require a server restart.

**Rule: Config validation at boot.**
Missing or malformed config files → log ERROR + exit process. No silent defaults for critical params.

### Golden Test Patterns

**Rule: Golden tests use standardized JSON fixtures.**

```typescript
interface GoldenTestCase {
  id: string;
  deck: string;
  hand: number[];
  expectedOutcome: 'combo' | 'brick';
  expectedMinScore?: number;
  expectedCards?: string[];
  mode: 'goldfish';
  algorithm: 'dfs';           // golden tests are DFS-only (deterministic). MCTS coverage via manual validation (NFR14)
  maxTimeMs: number;
}
```

File: `duel-server/data/golden-tests.json`. Each test hand-verified by Axel. Runner compares solver output against expectations. 100% concordance = pass.

**Golden tests run DFS only** (`algorithm: 'dfs'`). DFS is deterministic given a deckSeed, so 100% concordance is well-defined. MCTS is stochastic — the same hand + deckSeed produces different trees on each run. MCTS coverage is via manual validation (NFR14) and is not part of the automated golden suite.

**WASM snapshot correctness test:** At least 1 golden test case must involve a multi-chain combo with OPT-restricted effects (e.g., Baronne negate + destruction in the same turn). The runner executes this test twice: once with snapshot enabled, once with snapshot force-disabled (replay fallback). Both must produce identical scores. This catches snapshot/restore divergence for complex card interactions.

### Anti-Patterns

| Anti-Pattern | Why it's wrong | Correct approach |
|---|---|---|
| Strategy calls `fs.readFileSync(...)` | Workers must not do I/O | Config via `workerData` |
| Component subscribes to WS directly | Bypasses SolverService, duplicates state | Component reads SolverService signals |
| Strategy builds annotation strings | Coupling to card names, inconsistent | Adapter builds annotations |
| `applyAction` without `getLegalActions` | Silent OCGCore corruption | Always validate against legal list |
| `catch (e) { /* ignore */ }` in worker | Silent failures → hanging solves | Catch → log → throw → SOLVER_ERROR |
| Transposition table persists across solves | Stale data from different decks | Reset table per solve |
| `import winston` or `import pino` | New dependency, inconsistent with codebase | `console.log` with `[Solver]` prefix |
| Multiplying time budgets in no-snapshot mode | Unpredictable latency | Keep budgets unchanged, accept lower quality |

### Known MVP Limitations

1. **Mechanical prompt defaults actively prevent discovering valid lines.** SELECT_POSITION (ATK), SELECT_PLACE (leftmost zone), SELECT_TRIBUTE, SELECT_SUM are auto-resolved with a single default. This is NOT merely suboptimal — it makes entire categories of lines invisible: (a) DEF-position strategies (flip monsters like Subterror Guru, setting to avoid Nibiru's ATK-based tribute count) are never explored; (b) column-specific interactions (Infinite Impermanence targets a column, so zone placement matters) are always resolved identically; (c) tribute ordering affects GY triggers (e.g., tributing a Rescue Cat vs a hand card changes what's in GY for followup). The user has no visibility into these defaults and no indication that better lines might exist. **Phase 2:** promote SELECT_POSITION to exploratory (highest impact — ATK vs DEF is a strategic choice), and add user-facing documentation of which prompts are mechanical in the solver config UI.

2. **Golden test suite is single-reviewer (Axel).** 30 hand-verified test cases have no independent cross-validation. A misidentified brick or missed combo line in the golden suite would be enshrined as ground truth. Acceptable for a personal project — the solver itself may surface disagreements during use. **Phase 2:** cross-validate against community replay data or an independent engine.

3. **Verify mode only works for the mainPath.** The Verify button replays the recommended line with the handtrap timings from `adversarialTimings`. If the user expands a non-mainPath handtrap branch in the decision tree and wants to verify that specific fallback line, there is no mechanism to do so — the branch's path and opponent timings are not surfaced to the UI. **Phase 2:** "Verify this branch" contextual action in the decision tree, extracting the branch's path + timings from the tree structure.

4. **Reproducibility is limited by in-game randomness.** `deckSeed` controls the initial deck shuffle only — NOT OCGCore's internal PRNG (coin flips, random banish from Pot of Desires, mandatory shuffles after search effects). Any combo line involving a search + shuffle changes the deck order unpredictably. Reproduction is exact for DFS on decks without in-game randomness, and approximate otherwise. MCTS adds its own stochastic rollouts on top. Exported results include `algorithmUsed` so the user knows the reproduction tier. The Deck Seed tooltip in the UI must state: "Exact reproduction for DFS without random effects. Approximate if the combo involves searches, shuffles, or coin flips."

5. **Verify mode (FR31) is unreliable for search-heavy combo decks.** Verification replays the exact action sequence on a fresh duel (same deckSeed), but OCGCore's internal PRNG may produce a different post-search deck order, causing downstream actions to become illegal. This affects **both DFS and MCTS** results — any combo involving ROTA, Branded Fusion's send-from-deck, or similar search effects may produce `verified: false` even though the original solve was correct. The UI must display a warning for DFS results too (not just the MCTS tooltip): "Verification may fail for combos involving search or shuffle effects — this does not invalidate the original result." **Phase 2:** capture OCGCore PRNG state alongside deckSeed for exact replay.

6. **Minimax MCTS adversarial convergence in Fast mode is best-effort.** Fast mode (5s) produces ~2K-3.5K MCTS iterations. Each iteration explores one path through the tree, where opponent SELECT_CHAIN nodes branch on (N handtraps + pass) — the full combinatorial space of "which handtrap at which window" grows quickly for long combos. Fast mode provides broad coverage of the most-visited branches but may not converge on the exact minimax score for deep trees. Optimal mode (60s) provides ~12x more iterations, which is sufficient for stable convergence. A UI hint icon on adversarial + Fast results signals this to the user. The UI does NOT display confidence intervals — the displayed minimax score is the current best estimate within the time budget.

7. **FR12 (transposition / avoid re-exploring equivalent states) applies to DFS only.** MCTS uses independent rollouts from root and does not use the transposition table. This means MCTS repeatedly traverses the same forced early-game states, consuming simulation budget on already-evaluated positions. Acceptable for MVP — MCTS compensates with sampling breadth rather than deduplication depth. **Phase 2:** lightweight MCTS transposition cache for early-game states (depth < 5) to avoid redundant rollout prefixes.

## Project Structure & Boundaries

### Complete Project Directory Structure

**Duel-server — new solver module:**
```
duel-server/
├── src/
│   ├── server.ts                          # existing — add solver WS handlers
│   ├── ws-protocol.ts                     # existing — add SOLVER_* message types
│   ├── types.ts                           # existing — add solver-related type exports
│   ├── duel-worker.ts                     # existing — unchanged
│   ├── solver/
│   │   ├── solver-orchestrator.ts         # main thread: pool mgmt, aggregation, WS relay
│   │   ├── solver-worker.ts              # piscina worker entry point
│   │   ├── solver-types.ts               # ALL data types: DuelConfig, Action, FieldState, FieldCard, DecisionNode, SolverAction, ScoreBreakdown, SolverConfig, SolverResult, SolverStats, SolverProgress, HandtrapConfig, AdversarialTiming, GoldenTestCase
│   │   ├── game-oracle.ts                # GameOracle interface + DuelHandle
│   │   ├── ocgcore-adapter.ts            # OCGCoreAdapter implements GameOracle (handle tracking, snapshot fallback)
│   │   ├── solver-strategy.ts            # SolverStrategy + ActionRanker interfaces
│   │   ├── strategies/
│   │   │   ├── dfs-solver.ts             # DFS with iterative deepening
│   │   │   └── mcts-solver.ts            # SP-MCTS (goldfish) + Minimax MCTS (adversarial)
│   │   ├── goldfish-chain-ranker.ts      # Default ActionRanker: SELECT_CHAIN goldfish pruning heuristic
│   │   ├── zobrist.ts                    # Zobrist hasher (dual 32-bit, incremental)
│   │   ├── transposition-table.ts        # Transposition table with verification key
│   │   └── interruption-scorer.ts        # Board evaluation (15 types + fallback heuristic)
│   └── ...existing files...
├── data/
│   ├── solver-config.json                # pool size, budgets, thresholds
│   ├── interruption-tags.json            # cardId → effects[] (150 cards)
│   ├── interruption-weights.json         # 15 type weights
│   ├── handtraps.json                    # 5 MVP handtraps
│   ├── golden-tests.json                # 30 hand-verified test cases
│   └── ...existing data files...
└── ...
```

**Frontend — new solver page:**
```
front/src/app/
├── pages/
│   ├── solver/
│   │   ├── solver-page.component.ts       # SolverPageComponent (standalone, OnPush)
│   │   ├── solver-page.component.html
│   │   ├── solver-page.component.scss
│   │   ├── solver-config/
│   │   │   ├── solver-config.component.ts
│   │   │   ├── solver-config.component.html
│   │   │   └── solver-config.component.scss
│   │   ├── solver-progress/
│   │   │   ├── solver-progress.component.ts
│   │   │   ├── solver-progress.component.html
│   │   │   └── solver-progress.component.scss
│   │   └── solver-result/
│   │       ├── solver-result.component.ts
│   │       ├── solver-result.component.html
│   │       ├── solver-result.component.scss
│   │       ├── breadcrumb-path.component.ts
│   │       ├── decision-tree.component.ts
│   │       └── tree-node.component.ts
│   └── ...existing pages...
├── services/
│   ├── solver.service.ts                  # SolverService (providedIn: root)
│   ├── solver-debug-log.service.ts        # SolverDebugLogService (gated by environment.debugTools, same pattern as PvP DebugLogService)
│   └── ...existing services...
├── core/
│   └── model/
│       ├── solver.model.ts                # DecisionNode, SolverAction, ScoreBreakdown, SolverState (must match backend — same commit)
│       └── ...existing models...
└── ...
```

### Type Organization Convention

**3 type files in solver module (not 5):**
- `solver-types.ts` — all data types (DuelConfig, Action, FieldState, FieldCard, DecisionNode, SolverAction, ScoreBreakdown, SolverConfig, SolverResult, SolverStats, SolverProgress, HandtrapConfig, AdversarialTiming, GoldenTestCase)
- `game-oracle.ts` — GameOracle interface + DuelHandle type
- `solver-strategy.ts` — SolverStrategy + ActionRanker interfaces

**WS type sharing convention:** Backend is source of truth for all WS message types. Frontend `solver.model.ts` must match exactly. If a WS type changes in the backend, the frontend must be updated in the same commit.

### Architectural Boundaries

**Boundary 1: Orchestrator ↔ Worker (piscina)**
- Communication: `pool.run(payload)` + `MessagePort` for progress
- Serialization: structured clone (JSON-safe objects only)
- The worker never accesses the orchestrator's state. The orchestrator never accesses the worker's OCGCore instance.

**Boundary 2: Duel-server ↔ Angular (WebSocket)**
- 8 message types: SOLVER_START, SOLVER_CANCEL, SOLVER_INIT, SOLVER_PROGRESS, SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR, SOLVER_HANDTRAPS
- SolverService is the single WS consumer on the frontend. No other component touches WS solver messages.

**Boundary 3: Duel-server ↔ Spring Boot (HTTP)**
- Deck loading: `GET /api/decks/{deckId}` with JWT
- One-way dependency: duel-server calls Spring Boot. Spring Boot has no knowledge of the solver.

**Boundary 4: Strategy ↔ GameOracle (interface)**
- Strategies depend on `GameOracle` interface, never on `OCGCoreAdapter` directly.
- Enables MockOracle for testing without WASM.

**Boundary 5: Strategy ↔ Scorer (composition)**
- Strategies call the interruption scorer at leaf nodes only.
- Scorer depends on `FieldState` (from GameOracle) + interruption tags (from config).

### FR Category to Structure Mapping

| FR Category | Backend files | Frontend files |
|---|---|---|
| Solve Configuration (FR1-FR6) | `solver-types.ts` (SolverConfig) | `solver-config/` components, `solver.model.ts` |
| Solve Execution (FR7-FR13) | `solver-orchestrator.ts`, `solver-worker.ts`, `strategies/`, `ocgcore-adapter.ts`, `zobrist.ts`, `transposition-table.ts` | — |
| Progress & Control (FR14-FR16) | `solver-orchestrator.ts` (progress relay, cancellation) | `solver-progress/` component, `solver.service.ts` |
| Results & Decision Tree (FR17-FR26) | `solver-types.ts` (DecisionNode), `solver-orchestrator.ts` (pruning, mainPath) | `solver-result/` components, `decision-tree.component.ts` |
| Interruption Scoring (FR27-FR30) | `interruption-scorer.ts`, `data/interruption-*.json` | `tree-node.component.ts` (score badges) |
| Handtrap Validation (FR31) | `solver-orchestrator.ts` (verify mode: `verifyPath` in SOLVER_START → replay + confirm) | `solver-config/` (verify button) |

### Verify Mode (FR31) — No Separate Flow

Verify mode reuses `SOLVER_START` with optional fields `verifyPath?: SolverAction[]` and `verifyTimings?: AdversarialTiming[]`. When present, the solver replays the exact player action sequence AND the opponent's handtrap activations at the declared timings. `SOLVER_RESULT` includes `verified?: boolean`.

**Data flow:** The original adversarial solve produces `mainPath` (player 0 actions) + `adversarialTimings` (opponent actions with `stepIndex` referencing positions in `mainPath`). The verify request sends both back. The verifier replays `mainPath` actions sequentially; after each action at a `stepIndex` that matches an `AdversarialTiming`, it injects the opponent's `responseIndex` for that `SELECT_CHAIN` prompt. All other opponent prompts remain auto-passed. No new WS message type needed.

### Adversarial Mode — Handtrap Activation Mechanism (FR13)

**Decision: OCGCore 2-player duel with injected handtraps. No manual timing modeling.**

The duel infrastructure is already 2-player in all modes (PvP, solo, solver). The solo solver currently creates a dummy opponent (40× filler cards, auto-pass all prompts). Adversarial mode extends this by:

1. **Opponent hand injection** — Handtraps from `HandtrapConfig[]` are loaded directly into player 1's hand via `duelNewCard()` with `location: OcgLocation.HAND, team: 1`. The remaining opponent deck stays filler (OCGCore requires a legal 40-card deck).

2. **Legal activation windows** — OCGCore presents `SELECT_CHAIN` to player 1 whenever a handtrap can legally chain. The engine enforces all activation conditions natively (Ash Blossom only chains to draw/search/mill effects, Nibiru triggers after 5th summon, Impermanence targets face-up monsters, etc.). No manual timing rules needed.

3. **Minimax MCTS decision routing** — When `SELECT_CHAIN` arrives for player 1 during MCTS, the `OCGCoreAdapter` yields the legal actions (activate each handtrap + pass) to the solver as opponent-tagged actions (`team: 1`). The solver's minimax tree search decides which branch is optimal for the opponent — minimizing the player's score. The `autoPassOpponent()` function is replaced by this yield-back behavior for `SELECT_CHAIN` only — all other opponent prompts remain auto-passed. In DFS adversarial mode, the same branching applies, but DFS is blocked for adversarial because exhaustive exploration of all (N+1) opponent branches per chain window is intractable.

4. **Deterministic stress-test model** — The opponent is assumed to have **ALL** selected handtraps in hand and activate them at the optimal disruption timing. There is no determinization or subset sampling: the minimax score is the guaranteed worst-case under the configured handtrap set. Semantically, the score answers the question *"if my opponent has these handtraps, what is the best combo I can still reach?"* The score is monotone decreasing in the number of selected handtraps — adding a handtrap can only equal or reduce the worst-case minimax.

   The uncertainty being modeled is **timing** (which chain window will the opponent exploit?), not **hand contents** (which handtraps does the opponent possess?). The user controls the hand contents directly via the handtrap selection UI.

**Key constraint:** The solver worker must configure `createDuel()` with valid decks for both players. Player 1's main deck = filler (40 cards) + handtraps loaded to hand post-creation. This is identical to the existing solo mode pattern — no architectural change, just different cards in the opponent's hand.

### OPT Consumption Tracking (Story 1.8)

The interruption scorer needs to know which once-per-turn (OPT) effects of each
tagged card have already been activated during the current turn. Without this,
two failure modes appear:

1. **Score inflation.** A board final showing a Baronne that has already
   activated its omni-negate to negate a handtrap mid-combo is scored as if
   the omni-negate were still available — the user sees an inflated score
   that doesn't reflect the real defensive value.
2. **Transposition table false hits.** Two states reachable via different
   action orderings can have identical visible board layouts (cardId, position,
   overlay, face-down all match) but differ in OPT consumption. The
   verification key must distinguish them; otherwise the TT reuses a stale
   score across non-equivalent states.

**Why we don't extract OPT state from OCGCore.** Investigation determined that
the upstream `ocgcore` C++ engine masks `card.status` to 3 bits before
serializing it via `OcgQueryFlags.STATUS` (`DISABLED`, `FORBIDDEN`,
`PROC_COMPLETE`). The actual OPT counters live in `effect.count_limit` and the
field-level `effect_count_code` map — neither is exposed to the WASM API.
Reading them would require patching the upstream C++ and rebuilding the WASM
blob, which is out of scope. Instead, the solver reconstructs the OPT state on
the JS side by observing `applyAction` calls.

**Data flow.**

```
applyAction(handle, action) ──► recordActivation(internal, action)
                                       │
                                       ▼
                              tags[action.cardId] exists?
                                       │ yes
                                       ▼
                            disambiguateEffect(tag, promptType, phase)
                                       │
                                       ▼
                          internal.activationLog.get(cardId).push(idx)
                                       │
                                       ▼
                       (later, at scoring time)
                                       │
                                       ▼
            scorer.scoreWithCards(state, oracle.getActivationLog(handle))
                                       │
                                       ▼
                       OPT-aware breakdown + endBoardCards
```

**Activation log shape.** `Map<cardId, number[]>` where the value array
contains effect indices into `tag.effects[]`, in chronological order. Same
index can appear multiple times when the effect's `usesPerTurn > 1`.

**Per-handle isolation.** Each `InternalHandle` owns its own log. `forkViaReplay`
deep-clones the parent's log into the child, so DFS branches do not share OPT
state. The clone is `Map.entries() → new Map(entries.map([k, [...v]]))` —
each value array is a fresh allocation.

**Reset on NEW_TURN.** `runUntilPlayerPrompt` clears the log when an OCGCore
`NEW_TURN` message is processed. The current goldfish solver only runs turn 1,
so this clear is defensive — but Epic 2 (multi-turn adversarial) will rely on it.

**Effect disambiguation.** Multi-effect cards (e.g., Baronne with omni-negate
+ destruction) need to map a runtime activation back to a specific effect index.
The solver does this via the `trigger` field on each `InterruptionEffect`,
matched against the prompt context at `applyAction` time:

| `promptType` | Compatible `trigger` values |
|--------------|----------------------------|
| `SELECT_CHAIN` | `chain`, `quick` |
| `SELECT_IDLECMD` | `main`, `quick` |
| `SELECT_BATTLECMD` | `quick` |
| `SELECT_EFFECTYN` | `trigger` |

If exactly one effect matches, return its index. If multiple effects match
(rare — typically only when a card has two effects of the same trigger type),
return the lowest matching index and log a warning. If no effect matches
(legacy entries without `trigger` fields, or unexpected prompt context),
fall back to index 0 with a warning. This is a deliberate trade-off:
89% of tagged cards are single-effect (no disambiguation needed), and the
warnings surface mis-classification at runtime so the prompt can be improved
incrementally.

**OPT-aware scoring.** `InterruptionScorer.scoreWithCards(state, log?)` decrements
each effect's `usesPerTurn` by the count of its index in the log entry. For
`sharedOpt: true` cards, the cumulative consumption is also capped against
`tag.totalUsesPerTurn ?? sum(effects.usesPerTurn)` — once exceeded, the card
scores 0 across all remaining effects (hard OPT lockout). When `log` is
omitted or empty, the function falls back to pre-1.8 behavior so legacy callers
and tests continue to work.

**Verification key extension.** `buildVerificationKey(state, log?)` appends an
`opt:cardId1=indices1;cardId2=indices2;...` segment with sorted cardIds and
sorted indices. Two states with identical board layout but different logs
produce different keys, so the TT does not collide across OPT-divergent states.
When `log` is omitted, the segment is appended as `opt:` (empty payload) —
backward compatible for legacy call sites.

**Known limitations.**

- **No per-instance card identity.** The log keys by `cardId`, so two copies
  of the same card on the field share a bucket. In practice, end-board negators
  are mono-occurrence (no deck plays 2× Baronne side by side), so the impact
  is bounded.
- **No opponent-side tracking.** Story 1.8 only logs player-side activations.
  Epic 2 will extend `applyAction` to track opponent activations the same way
  (handtraps, opponent quick effects). The current `autoRespondOpponent` always
  passes on `SELECT_CHAIN`, so there's nothing to log yet.
- **Disambiguation depends on tag quality.** If `trigger` is missing or wrong
  in `interruption-tags.json`, the index falls back to 0 with a warning. The
  AI generation pipeline (`_bmad-output/solver-data/interruption-tag-generation-prompt.md`)
  is the primary maintenance vector for keeping tags accurate as the pool
  grows.
- **OPT state is not part of `FieldState`.** It's a sidecar map fetched
  separately via `oracle.getActivationLog(handle)`. Consumers must remember to
  pass both to the scorer/verification-key builder.

### Cross-Cutting Concerns Mapping

| Concern | Files |
|---|---|
| GameOracle interface | `game-oracle.ts` → consumed by all `strategies/`, `ocgcore-adapter.ts` |
| Anytime behavior | `solver-strategy.ts` (AbortSignal), `solver-orchestrator.ts` (partial results) |
| Termination guarantees | `zobrist.ts` (loop detection), `strategies/` (max depth check) |
| Legality post-condition | `solver-orchestrator.ts` (verify before SOLVER_RESULT) |
| Progress reporting | `strategies/` (onProgress callback), `solver-orchestrator.ts` (throttle + WS relay) |
| WASM lifecycle | `ocgcore-adapter.ts` (handle tracking, destroyAll, snapshot fallback) |
| Config access | `solver-orchestrator.ts` loads at boot → `workerData` to workers |

### Files Modified (Existing)

| File | Modification |
|---|---|
| `duel-server/src/server.ts` | Add solver WS handlers (SOLVER_START, SOLVER_CANCEL), init solver orchestrator |
| `duel-server/src/ws-protocol.ts` | Add SOLVER_* message type constants |
| `duel-server/src/types.ts` | Add solver-related type exports |
| `front/src/app/app.routes.ts` | Add `/decks/:id/solver` route (lazy-loaded) |
| `front/src/assets/i18n/fr.json` | Add solver labels |
| `front/src/assets/i18n/en.json` | Add solver labels |

### Architecture Validation

All 31 FRs and 17 NFRs are architecturally supported. No critical gaps. Action vs SolverAction naming: the solver uses `SolverAction` to distinguish from the solo simulator's `Action` type.

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently — especially oracle usage and worker communication rules
- Respect the 5 architectural boundaries
- Backend solver-types.ts is source of truth — frontend solver.model.ts must match
- Refer to this document and project-context.md (62 rules) for all questions

See epics for implementation ordering.
