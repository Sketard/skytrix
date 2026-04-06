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
- **Existing WebSocket reuse:** Same WS connection as PvP duels. 5 new message types only.
- **Spring Boot minimal impact:** No new REST endpoints. Decks via existing API. Interruption tags in JSON file (not PostgreSQL for MVP).
- **Desktop-first:** Tree viewer designed for desktop. No mobile target for MVP.
- **POC-validated baselines:** OCGCore 6µs/action, WASM snapshot 10ms, duel creation 55-67ms, combo deck branching factor 15.6.

### Cross-Cutting Concerns Identified

- **Resource isolation:** Solver worker pool must be completely separate from duel workers. Core reservation (min 2 cores for event loop + active duels). Memory budget enforcement per pool.
- **Anytime behavior:** Every algorithm must support interruption and return best-so-far. Permeates all strategy implementations, the orchestrator, and the WS protocol.
- **State forking strategy:** Snapshot vs replay-from-scratch choice varies by algorithm (DFS prefers snapshot at branch points, MCTS prefers replay from root). The GameOracle interface must support both patterns.
- **Termination guarantees:** Max depth (50) + Zobrist hash loop detection applies to all strategies. Not algorithm-specific — cross-cutting safety net.
- **Legality post-condition:** Every returned sequence must be verified by replaying on OCGCore. Cross-cutting across all result paths (normal completion, timeout, cancellation).
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

**Affects:** DFS solver, SP-MCTS solver, future algorithm additions, orchestrator validation.

### Domain Core — ActionRanker Interface

**Decision: Optional pruning/ordering dependency for strategies**

```typescript
interface ActionRanker {
  rank(actions: Action[], state: FieldState): Action[];
}
```

**Rationale:** Strategies call `ranker.rank()` before exploring children. Default implementation: identity (no pruning). Future implementations: WindBot-derived heuristics, progressive widening, action type filtering. Critical for DFS on high-BF decks (Snake-Eye BF ~25 requires pruning to top-5 for tractability).

**Affects:** All solver strategies (opt-in usage).

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
| Aggregation | Top-K per worker (default K=3). Orchestrator merges all top-K trees, keeps global best + diverse alternatives |
| Concurrency | 1 solve per user. New SOLVER_START aborts current solve |
| Warm pool | piscina `idleTimeout` keeps workers alive between solves. WASM module stays loaded. No cold start except first solve |
| Worker I/O | Zero — orchestrator (main thread) loads deck via HTTP, constructs DuelConfig, passes to worker via pool.run() |

**Algorithm auto-detection:** `algorithm` field in SOLVER_START accepts `'dfs' | 'mcts' | 'auto'` (default: `'auto'`). Auto mode: run 100 nodes DFS → measure average BF → if BF < 12 continue DFS, else switch to MCTS.

**Complexity detection:** After 100 nodes, if measured BF > configurable threshold (default 25), emit `SOLVER_PROGRESS` with `highComplexity: true`. Client displays warning. Solver continues (anytime behavior).

### Zobrist Hashing & Transposition Table

| Aspect | Decision |
|---|---|
| Hash size | 64-bit via two 32-bit `number` (not BigInt — 5-10x slower in V8) |
| Zobrist table | Pre-generated at worker boot: `zobrist[cardId][zoneId][position]` with crypto PRNG |
| Hash components | Card positions + phase + turn count modulo 4 |
| Update | Incremental O(1) per action: `hash ^= old ^ new` |
| Loop detection | Hash set on current path. Hash already seen → cut branch |
| Transposition table | `Map` per worker, per solve (reset between solves) |
| Entry | `{ hash, depth, score, bestAction, boundType, verificationKey }` |
| Verification key | Compact fingerprint (cards-per-zone + top card IDs). On lookup, fingerprint must match — else treated as cache miss |
| Replacement | Replace if new depth ≥ existing |
| Table size | Bounded — max entries configurable (default 100K) for NFR16 |
| Usage | DFS uses transposition table. MCTS does not (independent rollouts). Opt-in per strategy |

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

**Scoring formula:** `sum(weight × usesPerTurn)` for each tagged card on the final field.
**A card can have multiple types** (e.g., Baronne = `omni-negate` + `destruction`).
**Brick detection:** Total score = 0 → "no viable combo" (FR25).

**Fallback heuristic for untagged cards:** Each face-up monster on the field = 1 base point. Guarantees the solver finds "the board with the most presence" even without tags. Contextual scoring (interruption types) adds on top. Prevents false "no viable combo" for rogue decks with untagged end-board cards.

### WS Protocol

**6 message types:**

| Direction | Type | Payload |
|---|---|---|
| Client → Server | `SOLVER_START` | `{ deckId, hand, mode, speed, algorithm, handtraps? }` |
| Client → Server | `SOLVER_CANCEL` | `{}` |
| Server → Client | `SOLVER_PROGRESS` | `{ nodesExplored, bestScore, elapsed, highComplexity? }` |
| Server → Client | `SOLVER_RESULT` | `{ tree, mainPath, score, scoreBreakdown, minimax?, stats }` |
| Server → Client | `SOLVER_CANCELLED` | `{ partialTree?, stats }` |
| Server → Client | `SOLVER_ERROR` | `{ error, message }` |

```typescript
interface SolverErrorMessage {
  type: 'SOLVER_ERROR';
  error: 'DECK_NOT_FOUND' | 'DECK_ACCESS_DENIED' | 'WASM_INIT_FAILED' | 'INTERNAL_ERROR';
  message: string;
}
```

**Rules:**
- `SOLVER_START` replaces any running solve (no solverId needed — 1 solve/user). `algorithm` default: `'auto'`
- `SOLVER_RESULT` includes pre-computed `mainPath` (client doesn't traverse tree)
- `SOLVER_CANCELLED` returns `partialTree` if solver found at least one result (anytime FR16)
- Progress throttled at 200ms server-side
- Rate limit: max 1 `SOLVER_START` per user per 2 seconds (configurable in `solver-config.json`)

**Deck loading flow:** WS handler receives `SOLVER_START` → HTTP internal call `GET /api/decks/{deckId}` with user's JWT → Spring Boot validates ownership → deck list passed to worker. Same pattern as PvP duel.

### Frontend Architecture

**Component hierarchy:**
```
SolverPageComponent (lazy-loaded /decks/:id/solver)
├── SolverConfigComponent
│   ├── Hand selector (5 cards from deck, or random)
│   ├── Mode toggle (Goldfish / Adversarial)
│   ├── Speed toggle (Fast / Optimal)
│   ├── Algorithm select (DFS / MCTS / Auto)
│   └── Handtrap checkboxes (adversarial only)
├── SolverProgressComponent (progress bar + live stats + cancel)
└── SolverResultComponent
    ├── BreadcrumbPathComponent (main path, Material chips)
    └── DecisionTreeComponent (CDK flat tree)
        └── TreeNodeComponent (annotation + score badges)
```

| Aspect | Decision |
|---|---|
| Route | `/decks/:id/solver` in `app.routes.ts`, lazy-loaded |
| State machine | Signal: `'loading' \| 'idle' \| 'configuring' \| 'running' \| 'complete' \| 'error'` |
| SolverService | `providedIn: 'root'`, manages WS communication, exposes signals. Root-scoped for session history persistence across navigations (FR26) |
| Session history | `Signal<SolverResult[]>` in SolverService, client-side in-memory (FR26) |
| Tree component | CDK `CdkTree` flat mode + `getLevel()` for performance (NFR4/NFR5) |
| i18n | Labels in `fr.json` / `en.json` (ngx-translate) |

### Configuration Files

| File | Content | Reload |
|---|---|---|
| `duel-server/data/solver-config.json` | Pool size, max depth, time budgets (fast/optimal), progress throttle interval, tree pruning top-X, maxResultNodes (500), transposition table max entries (100K), memory budget (512MB), BF complexity threshold (25), rate limit interval (2s), IS-MCTS determinizationsPerIteration (1), maxHandtraps (5) | At boot |
| `duel-server/data/interruption-tags.json` | cardId → effects[] (type, weight, usesPerTurn) for 50+ end-board cards | At boot |
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
}

interface SolverStats {
  nodesExplored: number;
  elapsed: number;
  algorithm: string;
  maxDepthReached: number;
  averageBranchingFactor: number;
  transpositionHits?: number;
}
```

The orchestrator relies on this exact shape for top-K aggregation across workers. Any deviation breaks the merge.

### State Management Patterns (Frontend)

**Rule: Solver state transitions are explicit and unidirectional.**
```
loading → idle → configuring → running → complete
                                    ↓         ↓
                                  error     configuring (new solve)
```
No direct jump from `loading` to `running`. No `complete` → `idle`.

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
  maxTimeMs: number;
}
```

File: `duel-server/data/golden-tests.json`. Each test hand-verified by Axel. Runner compares solver output against expectations. 100% concordance = pass.

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
│   │   ├── solver-types.ts               # ALL data types: DuelConfig, FieldState, FieldCard, DecisionNode, SolverAction, ScoreBreakdown, SolverConfig, SolverResult, SolverStats, SolverProgress, HandtrapConfig, GoldenTestCase
│   │   ├── game-oracle.ts                # GameOracle interface + DuelHandle
│   │   ├── ocgcore-adapter.ts            # OCGCoreAdapter implements GameOracle (handle tracking, snapshot fallback)
│   │   ├── solver-strategy.ts            # SolverStrategy + ActionRanker interfaces
│   │   ├── strategies/
│   │   │   ├── dfs-solver.ts             # DFS with iterative deepening
│   │   │   └── mcts-solver.ts            # SP-MCTS + IS-MCTS for adversarial
│   │   ├── zobrist.ts                    # Zobrist hasher (dual 32-bit, incremental)
│   │   ├── transposition-table.ts        # Transposition table with verification key
│   │   └── interruption-scorer.ts        # Board evaluation (15 types + fallback heuristic)
│   └── ...existing files...
├── data/
│   ├── solver-config.json                # pool size, budgets, thresholds
│   ├── interruption-tags.json            # cardId → effects[] (50+ cards)
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
│   └── ...existing services...
├── core/
│   └── model/
│       ├── solver.model.ts                # DecisionNode, SolverAction, ScoreBreakdown, SolverState (must match backend — same commit)
│       └── ...existing models...
└── ...
```

### Type Organization Convention

**3 type files in solver module (not 5):**
- `solver-types.ts` — all data types (DuelConfig, FieldState, DecisionNode, ScoreBreakdown, SolverConfig, SolverResult, SolverStats, etc.)
- `game-oracle.ts` — GameOracle interface + DuelHandle type
- `solver-strategy.ts` — SolverStrategy + ActionRanker interfaces

**WS type sharing convention:** Backend is source of truth for all WS message types. Frontend `solver.model.ts` must match exactly. If a WS type changes in the backend, the frontend must be updated in the same commit.

### Architectural Boundaries

**Boundary 1: Orchestrator ↔ Worker (piscina)**
- Communication: `pool.run(payload)` + `MessagePort` for progress
- Serialization: structured clone (JSON-safe objects only)
- The worker never accesses the orchestrator's state. The orchestrator never accesses the worker's OCGCore instance.

**Boundary 2: Duel-server ↔ Angular (WebSocket)**
- 6 message types: SOLVER_START, SOLVER_CANCEL, SOLVER_PROGRESS, SOLVER_RESULT, SOLVER_CANCELLED, SOLVER_ERROR
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

Verify mode reuses `SOLVER_START` with an optional `verifyPath?: SolverAction[]` field. When present, the solver replays the exact sequence with the handtrap at the declared timing and confirms the result. No new WS message type needed. `SOLVER_RESULT` includes `verified?: boolean`.

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
