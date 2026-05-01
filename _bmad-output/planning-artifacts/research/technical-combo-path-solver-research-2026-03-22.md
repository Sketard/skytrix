---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments: ['brainstorming-session-2026-03-22.md']
workflowType: 'research'
lastStep: 5
workflow_completed: true
research_type: 'technical'
research_topic: 'Combo path solver & board optimizer — exploration algorithms benchmark'
research_goals: 'Benchmark exploration algorithms (DFS+pruning, MCTS, A*, Iterative Deepening) for automated combo path solving in Yu-Gi-Oh!, evaluate feasibility with OCGCore WASM forward-only constraint, and determine the best Strategy pattern implementation'
user_name: 'Axel'
date: '2026-03-22'
web_research_enabled: true
source_verification: true
---

> **Note:** Interface definitions and implementation roadmaps in this document are research-stage drafts. See `architecture-solver.md` for final, authoritative contracts and `prd-solver.md` for final requirements.

# Technical Research Report: Combo Path Solver — Exploration Algorithms Benchmark

**Date:** 2026-03-22
**Author:** Axel
**Research Type:** Technical
**Input:** Brainstorming session 2026-03-22 (16 ideas, 4 themes, 5 fundamental truths)

---

## Research Overview

This report investigates the algorithmic, architectural, and implementation feasibility of a combo path solver for Yu-Gi-Oh! decks, extending the skytrix platform. The solver uses OCGCore WASM as a black-box rules oracle and explores game trees to find optimal combo paths and end boards.

**Key Research Questions:**
1. Which tree search algorithm (DFS, MCTS, A*, beam search) best suits the combo solving domain?
2. How to handle OCGCore's forward-only constraint (no rollback/undo)?
3. How to parallelize the solver across Node.js worker threads?
4. How to model handtrap resilience (imperfect information)?
5. Is the project feasible given OCGCore's per-node simulation cost?

**Methodology:** Web research with multi-source verification, cross-referenced against academic papers, open-source implementations, and established game AI literature. 50+ sources cited.

**Key Findings:**
- **SP-MCTS** (Single-Player MCTS) and **DFS with iterative deepening** are the two most promising algorithms — A* eliminated (no admissible heuristic possible)
- **Root parallelism** via piscina worker pool delivers ~15x speedup with zero synchronization complexity
- **IS-MCTS** (Information Set MCTS) with determinization is the preferred approach for handtrap modeling
- **Zobrist hashing** with incremental O(1) updates enables transposition tables for avoiding redundant exploration
- **No existing production-grade combo path solver exists** — skytrix would be the first
- **Critical unknown:** OCGCore per-action latency — Phase 1 POC must profile this before committing to full implementation

---

## Technology Stack Analysis

### Tree Search Algorithms

_The core algorithmic landscape for single-player game tree optimization._

**DFS with Pruning** — The foundation of game tree search. Explores depth-first, cuts branches early via domain heuristics. With perfect move ordering, alpha-beta pruning reduces complexity from O(b^m) to O(b^(m/2)). Memory-efficient at O(bd). Best suited when strong heuristic pruning rules exist.
_Source: https://www.geeksforgeeks.org/artificial-intelligence/alpha-beta-pruning-in-adversarial-search-algorithms/_

**Iterative Deepening DFS (IDDFS)** — Runs depth-limited DFS with increasing limits. Combines DFS memory efficiency with BFS completeness. Re-expansion overhead is only ~11% for branching factor ~10. Preferred uninformed search when solution depth is unknown.
_Source: https://en.wikipedia.org/wiki/Iterative_deepening_depth-first_search_

**A* / IDA*** — A* with admissible heuristic finds optimal solutions but requires O(b^d) memory. IDA* combines A*'s heuristic guidance with IDDFS memory efficiency. Leading solver for puzzles (Sokoban, 15-puzzle). **Critical limitation: requires an admissible heuristic function — impractical for Yu-Gi-Oh! combos due to domain complexity.**
_Source: https://link.springer.com/chapter/10.1007/978-3-540-87608-3_1_

**SP-MCTS (Single-Player Monte Carlo Tree Search)** — Adapts MCTS for single-player optimization with three modifications: (1) UCB formula uses maximum score alongside average, (2) variance term encourages exploring high-variance nodes, (3) both average and maximum scores are backpropagated. Achieved highest known scores on SameGame benchmark. Does NOT require an evaluation function beyond simulating to terminal state — only needs a forward simulator.
_Source: https://link.springer.com/chapter/10.1007/978-3-540-87608-3_1, https://dke.maastrichtuniversity.nl/m.winands/documents/KNOSYS_SameGame.pdf_

**Beam Search** — Bounded-width best-first search keeping only top-β nodes per depth level. Memory O(β × d). Incomplete but tractable for large search spaces. Width 1 = greedy hill-climbing, ∞ = full best-first.
_Source: https://en.wikipedia.org/wiki/Beam_search_

**Beam MCTS (BMCTS)** — Hybrid of MCTS and beam search. Builds MCTS tree but prunes below beam width after fixed simulations per depth level. Matched record scores in Morpion Solitaire (82 moves).
_Source: https://dke.maastrichtuniversity.nl/m.winands/documents/CIG2012_paper_32.pdf_

**Neural MCTS (AlphaZero-style)** — Replaces random rollouts with neural network evaluation. Policy network guides selection, value network evaluates leaves. 40x speedup over vanilla MCTS. Not feasible for MVP (requires training data) but noted as future evolution path.
_Source: https://www.moderndescartes.com/essays/deep_dive_mcts/_

### Algorithm Comparison for Combo Solving

| Criterion | DFS+Pruning | IDDFS | A*/IDA* | SP-MCTS | Beam Search |
|---|---|---|---|---|---|
| **Completeness** | Yes (given time) | Yes | Yes | No (anytime) | No |
| **Optimality** | With exhaustive search | Yes (depth) | Yes (with h) | No (best found) | No |
| **Requires heuristic** | Domain pruning rules | No | Yes (critical) | No | Evaluation fn |
| **Memory** | O(bd) | O(bd) | O(b^d) / O(bd) | O(tree size) | O(β × d) |
| **High branching factor** | Struggles | Struggles | Struggles | Handles well | Handles well |
| **Forward-only simulator** | Compatible | Compatible | Needs state eval | Ideal match | Compatible |

_Confidence: HIGH — based on well-established computer science literature and multiple verified sources._

### Forward-Only Simulation: State Forking Strategies

_OCGCore WASM cannot undo/rollback — the most structuring constraint._

**Strategy A — Copy-Make (WASM Memory Snapshot)**
Snapshot the entire WASM linear memory via `ArrayBuffer.slice()` on `WebAssembly.Memory.buffer`. This gives a byte-level copy of the simulator state in one operation. Chess engines benchmark copy-make at 3.7-5.5% of total time for 216-728 byte states. For WASM linear memory (2-8 MB per duel), the cost is higher but still O(1) per snapshot.
_Source: https://www.chessprogramming.org/Copy-Make_

**Strategy B — Replay from Scratch**
Store the action sequence from initial state. To explore a different branch at depth d, replay actions 0..d-1 from scratch. Cost grows linearly with depth: O(d × avg_action_cost). Minimal memory (action log only).

**Real-World Precedent: Pokemon Showdown** faced the identical constraint. Their approach: deterministic recreation from input logs. Benchmarked at ~0.4s per full game simulation, targeting <0.1s optimized. Confirmed that replay-from-scratch is viable for card game engines.
_Source: https://github.com/smogon/pokemon-showdown/issues/5270_

**Chess/Go Engines:** Leela Zero and KataGo use copy-make (Go board state ~361 intersections + metadata). Each MCTS simulation copies state at the leaf, evaluates, discards. State is never rolled back — simply discarded after evaluation. Same pattern applicable to the combo solver.
_Source: https://jonathan-hui.medium.com/monte-carlo-tree-search-mcts-in-alphago-zero-8a403588276a_

| Factor | Copy-Make (Memory Snapshot) | Replay from Scratch |
|---|---|---|
| **Cost per branch** | O(state_size) ~2-8 MB copy | O(d × action_cost) |
| **Depth scaling** | Constant per branch point | Linear with depth |
| **Memory** | O(max_depth × state_size) | O(action_log) — minimal |
| **Implementation** | `memory.buffer.slice()` | Re-instantiate + replay |
| **Best when** | Frequent branching, shallow trees | Deep trees, minimal branching |

_Confidence: HIGH — both strategies verified against real implementations (chess engines, Pokemon Showdown)._

### WASM Performance in Node.js

_OCGCore is a C++ card game rules engine compiled to WASM._

**Execution Speed:** Optimized WASM in V8 runs at 60-90% of native C++ speed. Integer/logic-heavy workloads (like OCGCore's rule checks) perform closer to 80-95% native. Two-tier compilation: Liftoff (fast baseline) → TurboFan (optimized).
_Source: https://v8.dev/blog/wasm-compilation-pipeline, https://www.usenix.org/conference/atc19/presentation/jangda_

**JS→WASM Boundary Cost:** ~50-200ns per call. For millions of calls, this matters. **Mitigation:** Design "chunky" WASM interface — `simulate_until_choice_point()` that loops internally, one call replacing hundreds.
_Source: https://nicolo-ribaudo.github.io/wasm-call-overhead/_

**Memory per Instance:** OCGCore duel state: ~2-8 MB. V8 overhead per instance: ~1-2 MB (compiled code shared across same Module). Multiple independent instances in separate worker threads: fully supported, no GC contention.
_Source: https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory, https://v8.dev/blog/wasm-code-caching_

**Instantiation Cost:** Module compilation: 50-500ms (one-time). Instance creation from compiled module: 1-10ms per instance. TurboFan warm-up: first ~100-1000 calls at 2-5x slower, then optimized.
_Source: https://v8.dev/blog/liftoff_

**Key Optimization:** `WebAssembly.Module` can be transferred between threads via `postMessage` — compile once on main thread, share to all workers. Each worker instantiates (~5ms) without recompiling.
_Source: https://nodejs.org/api/worker_threads.html, https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Module_

### Node.js Worker Thread Infrastructure

_Parallel execution layer for the combo solver._

**Worker Pool Libraries:**

| Feature | **piscina** | **tinypool** | **workerpool** |
|---|---|---|---|
| Maintainer | Node.js core team | Vitest team (piscina fork) | Jos de Jong |
| Transferables | Full support | Full support | Limited |
| WASM Module sharing | Via workerData | Via workerData | Manual |
| Backpressure | Built-in (maxQueue) | Built-in | Manual |
| Performance | Best-in-class | ~Same as piscina | ~10-20% slower |
| Active (2024-2025) | Very active | Very active | Moderate |

**Recommendation: piscina** — de facto standard, maintained by core team, battle-tested WASM + worker integration.
_Source: https://github.com/piscinajs/piscina_

**Worker Overhead:** ~5-10 MB base (V8 isolate) + 3-10 MB (WASM). Total ~10-20 MB per worker. Startup: 30-100ms (worker) + 1-10ms (WASM instantiation). For 8 workers: ~80-160 MB, ~150ms startup (parallel).

**Optimal Worker Count:** For CPU-bound combo solving: `physical_cores` (not logical). Hyperthreading helps I/O, not pure compute. If duel server also handles WebSocket: `physical_cores - 2`. Piscina supports `minThreads` / `maxThreads` for dynamic scaling.
_Source: https://nodejs.org/api/worker_threads.html, https://blog.appsignal.com/2024/01/17/dealing-with-cpu-bound-tasks-in-nodejs.html_

**Communication Patterns:**

| Method | Use Case | Cost |
|---|---|---|
| `postMessage()` | Action sequences, results | Deep copy (structured clone) |
| `Transferable` (ArrayBuffer) | WASM memory snapshots | Zero-copy transfer, sender loses access |
| `SharedArrayBuffer` | Progress counters, work-stealing | Zero-copy, requires Atomics |
| `workerData` | Initial config, WASM Module | One-time at creation |

_Confidence: HIGH — Node.js documentation and established library benchmarks._

### Parallel Tree Search Strategies

_How to distribute search across workers._

**Root Parallelism** — Each thread builds its own independent search tree from the root. Zero synchronization during search. Results merged after completion. **Empirical speedup: 14.9x for 16 threads** (Chaslot et al.). Equivalent to randomized restarts run in parallel. Drawback: duplicated work across threads.
_Source: https://link.springer.com/chapter/10.1007/978-3-540-87608-3_6_

**Tree Parallelism** — Multiple threads on a single shared tree. Requires synchronization (mutexes). Without virtual loss: 3.3x speedup for 16 threads. With virtual loss + local mutexes: 8.5x speedup for 16 threads. More complex, but shares discoveries.
_Source: https://link.springer.com/chapter/10.1007/978-3-540-87608-3_6_

**Leaf Parallelism** — One thread does selection/expansion, multiple threads run simulations on the same leaf. Simplest, but modest speedup (bottlenecked by single selection thread).

**Virtual Loss Technique:** When a thread descends through a node, it temporarily adds a loss to the node's stats, making it appear less attractive to other threads. Diverts parallel threads to different branches. AlphaGo Zero used this to enable batch GPU inference: 8-16 leaves selected simultaneously, evaluated in one batch.
_Source: https://liacs.leidenuniv.nl/~plaata1/papers/paper_ICAART17.pdf, https://www.moderndescartes.com/essays/deep_dive_mcts/_

**Recommendation for Combo Solver: Root Parallelism** — Each worker runs an independent SP-MCTS (or DFS) with its own OCGCore WASM instance. Zero synchronization. Natural fit for the "no shared state" constraint. Main thread merges best solutions from all workers.

### Combinatorial Optimization in TypeScript

_JS/TS ecosystem for game tree search._

**Landscape:** No established game tree search library in JS/TS. Custom implementation is the norm. Notable utilities:
- **js-combinatorics** — permutations, combinations, power sets (card subset enumeration)
- **graphology** — graph data structures (state tree representation)
- **pathfinding** — A*/BFS/DFS for spatial grids (interface patterns instructive)

**TypeScript Strategy Pattern:** Well-supported. Discriminated unions and interface-based polymorphism provide clean algorithm swapping without runtime overhead.

**V8 Performance for Tree Traversal:**
- Simple DFS: ~50-200M nodes/second (minimal per-node work)
- With game state evaluation: ~100K-1M nodes/second
- With WASM OCGCore simulation per node: ~1K-50K nodes/second
- **Bottleneck is OCGCore simulation per node, not JS traversal.** Pruning strategy matters 100x more than JS optimization.

**GC Mitigation:** Object pooling for search nodes, typed arrays for hot data (hashes, scores), avoid closures in hot loops.
_Source: https://v8.dev/blog/fast-properties, https://v8.dev/blog/trash-talk_

### Technology Adoption Trends

_Current state-of-the-art and emerging patterns (2024-2026)._

**MCTS in AI/ML Pipelines:** MCTS and beam search now used for LLM reasoning (ReasoningAgent, AG2). Demonstrates algorithmic versatility beyond traditional games. Massively parallel MCTS scaled to thousands of workers for molecular design — a single-player optimization domain analogous to combo search.
_Source: https://docs.ag2.ai/0.8.7/docs/blog/2024/12/20/Reasoning-Update/, https://openreview.net/pdf?id=6k7VdojAIK_

**WASM Maturity:** WASM in Node.js is production-grade (2024-2025). Component Model and Interface Types approaching standardization. Multi-threading via `wasm-threads` proposal gaining traction but not yet needed — Node.js worker_threads provide sufficient parallelism at the process level.

**Worker Pools Consolidation:** piscina emerging as the de facto standard. Vitest's tinypool validates the same API surface. workerpool losing ground. SharedArrayBuffer usage growing for coordination primitives, not data sharing.

_Confidence: MEDIUM-HIGH — trend analysis based on 2024-2025 data, may shift._

## Integration Patterns Analysis

### Worker Thread Task Orchestration

_How the solver integrates with the existing duel-server event loop._

**Dedicated Solver Pool (separate from duel workers)** — The duel-server currently spawns one Worker per duel session. The solver must use a **separate piscina worker pool** to avoid contention. Main thread stays free for WebSocket I/O; all CPU-bound solver work goes to pool workers. Pool sizing: `os.availableParallelism() - duelWorkerCount - 1` (reserve cores for event loop + active duels).
_Source: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop_

**Piscina Task Queue with Priority** — `@piscina/priority-queue` provides a drop-in custom TaskQueue. Tasks carry priority via `Piscina.queueOptionsSymbol`. Note: priorities only affect *queued* tasks — if a worker is immediately available, the task runs regardless of priority. Useful for prioritizing "Fast mode" solves over "Optimal mode" solves.
_Source: https://piscinajs.dev/advanced-topics/Custom%20Task%20Queues/, https://www.npmjs.com/package/@piscina/priority-queue_

**Task Cancellation via AbortController** — Piscina natively supports `AbortSignal`:
```typescript
const ac = new AbortController();
const task = pool.run(solverInput, { signal: ac.signal });
// Cancel on client disconnect or explicit cancel:
ac.abort(); // task Promise rejects with AbortError
```
Combine with timeout: `AbortSignal.any([userAbort.signal, AbortSignal.timeout(60_000)])`. Important: abortable tasks cannot share threads — fine for the solver since each solve is a heavyweight single-occupancy task.
_Source: https://github.com/piscinajs/piscina/blob/current/README.md, https://blog.appsignal.com/2025/02/12/managing-asynchronous-operations-in-nodejs-with-abortcontroller.html_

**Progress Reporting via MessagePort** — Pass a `MessagePort` through piscina's `transferList`:
```typescript
// Main thread
const { port1, port2 } = new MessageChannel();
port2.on('message', (progress) => {
  ws.send(JSON.stringify({ type: 'SOLVER_PROGRESS', ...progress }));
});
await pool.run({ port: port1, deck, config }, { transferList: [port1] });

// Worker thread
module.exports = ({ port, deck, config }) => {
  port.postMessage({ nodesExplored: 1000, bestScore: 5, elapsed: '2.3s' });
  // ... continue solving ...
  return finalResult;
};
```
_Source: https://piscinajs.dev/examples/Message%20Port/_

_Confidence: HIGH — piscina APIs verified against official documentation and npm packages._

### WebSocket Communication Protocol

_How the Angular client interacts with the solver through the existing WS connection._

**Reuse Existing WebSocket** — The duel-server already maintains a persistent WS connection per client. The solver reuses this same connection. No SSE or separate HTTP endpoint needed — bidirectional communication (send cancel, receive progress) is already available.
_Source: https://websocket.org/comparisons/sse/, https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html_

**Message Flow (research draft — superseded by `architecture-solver.md` §WS Protocol for final 6-message contract, payloads, and rules):**

| Step | Direction | Message Type | Payload |
|---|---|---|---|
| 1 | Client → Server | `SOLVER_START` | `{ deckId, config: { mode, timeLimit, handtraps, lockedFirstSteps } }` |
| 2 | Server → Client | `SOLVER_PROGRESS` | `{ nodesExplored, branchesCompleted, bestScore, elapsed }` |
| 3 | Server → Client | `SOLVER_RESULT` | `{ decisionTree, bestPaths[], stats }` |
| 4 | Client → Server | `SOLVER_CANCEL` | `{ solverId }` |
| 5 | Server → Client | `SOLVER_CANCELLED` | `{ solverId, partialResults? }` |

**Progress Throttling** — Browser WebSocket API has no flow control. If events arrive faster than the client processes them, messages queue in memory. Mitigation: throttle progress messages in the worker (emit every N iterations or every 200ms, whichever comes first).

**Cancellation Wiring:**
```typescript
// On SOLVER_CANCEL or WS close → abort the solver task
ws.on('close', () => {
  for (const [key, entry] of activeSolverTasks) {
    if (key.startsWith(`${userId}:`)) {
      entry.abortController.abort();
      activeSolverTasks.delete(key);
    }
  }
});
```
_Source: https://dev.to/silentwatcher_95/the-complete-guide-to-request-cancellation-in-web-applications-using-nodejs-1f6k_

_Confidence: HIGH — pattern aligns with existing duel-server WS architecture and verified cancellation patterns._

### Strategy Pattern for Algorithm Swapping

_Runtime-swappable solver algorithms in TypeScript._

**Core Strategy Interface:**
```typescript
interface SolverStrategy {
  solve(state: DuelState, config: SolverConfig, signal: AbortSignal): Promise<SolverResult>;
}
```

**Registry-based Factory** — Avoid switch/case chains. New strategies register themselves:
```typescript
type SolverType = 'dfs' | 'mcts' | 'beam' | 'iddfs';
const solverRegistry = new Map<SolverType, () => SolverStrategy>([
  ['dfs',  () => new DfsPruningSolver()],
  ['mcts', () => new SpMctsSolver()],
  ['beam', () => new BeamSearchSolver()],
  ['iddfs', () => new IterativeDeepeningSolver()],
]);
```

**Runtime Selection** — Client config determines algorithm: `{ mode: 'fast', algorithm: 'mcts' }` vs `{ mode: 'optimal', algorithm: 'dfs' }`. The factory creates the appropriate strategy, and the worker executes it against the OCGCore oracle.

**Game AI Framework Pattern** — MCTS requires no evaluation function (only forward simulation); Minimax + alpha-beta needs a heuristic evaluation. The strategy pattern decouples this: each strategy knows its own requirements, the solver context just provides the OCGCore interface.
_Source: https://refactoring.guru/design-patterns/strategy/typescript/example, https://dev.to/davidkroell/strategy-design-pattern-with-dependency-injection-7ba_

_Confidence: HIGH — standard TypeScript patterns, well-documented._

### WASM Module Lifecycle in Worker Pool

_How OCGCore WASM instances are managed across solver workers._

**Compilation Strategy: Per-Worker Init (matching existing pattern)** — Each solver worker calls `createCore()` once at startup, caches the instance, reuses it across tasks. Matches the existing `duel-worker.ts` pattern. OCGCore WASM (~2-5 MB) compiles in <100ms per worker — acceptable for a pool of 3-8 workers.
_Source: https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Module_

**Alternative: Compile-once + share via workerData** — `WebAssembly.Module` is cloneable via structured clone. V8 shares compiled native code under the hood:
```typescript
const wasmModule = await WebAssembly.compile(wasmBuffer);
const pool = new Piscina({
  filename: 'solver-worker.js',
  workerData: { wasmModule }
});
```
Trade-off: slightly faster worker startup vs. deviating from existing architecture. Recommendation: keep per-worker init for consistency.

**Instance Recycling per Task** — Each solve task: `OCG_CreateDuel` → run simulation → `OCG_DestroyDuel`. The WASM module stays loaded; only duel handles are created/destroyed. Critical: ensure every `OCG_CreateDuel` is matched by `OCG_DestroyDuel` to prevent heap growth.
_Source: https://blog.logrocket.com/node-worker-threads-shared-array-buffers-rust-webassembly/_

**Heap Growth Mitigation:**
1. **Proper C++ cleanup** — match create/destroy (already done in duel-worker)
2. **Worker recycling** — piscina's `idleTimeout` naturally recycles idle workers
3. **Forced recycling** — terminate and respawn workers after N tasks if heap growth observed
4. **Advanced: Emscripten memory reset** — reset static data region (~microseconds vs ~35ms respawn). Only if profiling shows necessity.
_Source: https://radu-matei.com/blog/practical-guide-to-wasm-memory/, https://web.dev/articles/webassembly-memory-debugging_

_Confidence: HIGH — patterns verified against Node.js docs, WASM specs, and real-world game engine integrations._

### Integration Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    Angular Frontend                          │
│  SolverService ──WS──► SOLVER_START / SOLVER_CANCEL         │
│  SolverService ◄──WS── SOLVER_PROGRESS / SOLVER_RESULT      │
└─────────────────────────┬───────────────────────────────────┘
                          │ WebSocket (existing)
┌─────────────────────────▼───────────────────────────────────┐
│                    Duel Server (Node.js)                      │
│                                                              │
│  ┌─────────────┐  ┌──────────────────────────────────┐      │
│  │ WS Handler  │  │  Solver Orchestrator              │      │
│  │ (existing)  ├──►  - AbortController per task       │      │
│  │             │  │  - MessagePort progress relay      │      │
│  └─────────────┘  │  - Result aggregation             │      │
│                    └──────────┬───────────────────────┘      │
│                               │ piscina pool                 │
│  ┌────────────────────────────▼──────────────────────┐      │
│  │  Solver Worker Pool (piscina, N = physical_cores)  │      │
│  │                                                    │      │
│  │  Worker 1: OCGCore WASM + SolverStrategy          │      │
│  │  Worker 2: OCGCore WASM + SolverStrategy          │      │
│  │  Worker N: OCGCore WASM + SolverStrategy          │      │
│  │                                                    │      │
│  │  Each worker: independent tree, root parallelism   │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │  Duel Worker Pool (existing, 1 per active duel)    │      │
│  └────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

## Architectural Patterns and Design

### Game Tree Search Architecture

_Node representation, storage, and state fingerprinting._

**Node/Edge Representation** — A game tree node = game state; an edge = legal action (activate, summon, set, etc.). For forward-only engines, DFS only keeps the current path from root to leaf in memory — O(b×d). MCTS stores the explored portion permanently (visit counts accumulate). Beam search stores only the current beam of k candidates per depth — O(k×d).
_Source: https://www.chessprogramming.org/Search_Tree_

**Transposition Tables** — Hash map caching previously evaluated game states to avoid re-exploring equivalent positions reached via different action orderings (e.g., "Summon A then activate B" = "Activate B then summon A"). Each entry stores: hash key, evaluation score, best action, search depth, bound type (exact/upper/lower). Replacement policy: prefer deeper entries. **Critical for combo solving** — card games have many action-order transpositions.
_Source: https://en.wikipedia.org/wiki/Transposition_table_

**Zobrist Hashing for Yu-Gi-Oh! States** — XOR-based fingerprinting using pre-generated random 64-bit bitstrings. Adapted to card game zones:

| Component | Hash Key Structure |
|---|---|
| Hand cards | `zobrist[card_id][ZONE_HAND][slot_index]` |
| Monster zones | `zobrist[card_id][ZONE_M1..M5][face_up/face_down/defense]` |
| Spell/Trap zones | `zobrist[card_id][ZONE_ST1..ST5][face_up/set]` |
| Graveyard | `zobrist[card_id][ZONE_GY][slot_index]` |
| Banished | `zobrist[card_id][ZONE_BANISHED][face_up/face_down]` |
| Extra deck | `zobrist[card_id][ZONE_EXTRA][face_up/face_down]` |
| XYZ overlays | `zobrist[card_id][parent_zone][overlay_index]` |
| State flags | LP thresholds, once-per-turn flags, chain state |

**Incremental update** (O(1) per action): `newHash = oldHash XOR zobrist[card][oldZone][oldSlot] XOR zobrist[card][newZone][newSlot]`. Collision rate with 64-bit: first collision around ~4 billion states — more than sufficient. Use cryptographically seeded PRNG (not `Math.random()`). In TypeScript: two parallel 32-bit numbers or BigInt (architecture chose dual 32-bit — BigInt is 5-10× slower in V8).
_Source: https://www.chessprogramming.org/Zobrist_Hashing, https://iq.opengenus.org/zobrist-hashing-game-theory/_

_Confidence: HIGH — well-established computer science patterns, verified against multiple sources._

### Anytime Algorithm Architecture

_Returning "best so far" at any interruption point._

**Core Pattern** — Three requirements: (1) a "best so far" register always holding current best solution, (2) interruptibility via budget checks between iterations, (3) monotonic improvement per iteration.

**Budget Types:**

| Budget Type | Mechanism | Best For |
|---|---|---|
| Time budget | `Date.now() < deadline` per iteration | User-facing latency targets ("Fast mode") |
| Node budget | Counter per node expansion | Deterministic reproducibility |
| Iteration budget | Counter per top-level iteration | Simple control (MCTS rollouts, IDDFS depth levels) |

**MCTS — Natural Anytime** — Each select→expand→simulate→backpropagate iteration improves root statistics. At any point, the action with the highest visit count at the root is the "best so far." UCB1 formula balances exploitation vs exploration:
`UCB1(node) = Q(node)/N(node) + C × sqrt(ln(N(parent)) / N(node))`
_Source: https://gibberblot.github.io/rl-notes/single-agent/mcts.html_

**DFS Adaptations:**
- **IDDFS**: run DFS at depth 1, 2, 3, ... Each completed level provides best solution at that depth. Earlier iterations fast. Re-expansion overhead ~2x only (b ≥ 2).
- **DFS with Incumbent**: run full DFS, record first complete combo path as "incumbent", continue searching for better paths, update incumbent when superior found. Check budget between node expansions.
_Source: https://en.wikipedia.org/wiki/Iterative_deepening_depth-first_search_

**Complete Anytime Beam Search (CABS)** — Successive beam search iterations with progressively wider beam: k=1, 2, 4, 8, ... Each completed pass provides a solution; wider beams find better ones. Combines beam search tractability with anytime behavior.
_Source: https://en.wikipedia.org/wiki/Beam_search_

_Confidence: HIGH — anytime algorithm theory is well-established._

### Minimax and Handtrap Modeling

_Modeling the "virtual opponent" for adversarial mode._

**Expectiminimax** — Adds chance nodes to minimax:
- **MAX nodes**: solver's choices (which action to take)
- **CHANCE nodes**: "does opponent have handtrap X?" with probability p(X)
- **MIN nodes**: opponent chooses optimal activation timing to maximize disruption

Chance node value = `sum(P(outcome_i) × V(child_i))`. Complexity: O((b×n)^d) where n = chance outcomes. In practice, only 3-5 most common handtraps modeled per meta.
_Source: https://inst.eecs.berkeley.edu/~cs188/textbook/games/expectimax.html_

**Pruning Limitation** — Standard alpha-beta does NOT apply to expectiminimax (extreme child values skew expected value). Star1/Star2 pruning (Ballard) enables pruning at chance nodes IF evaluation values have known bounds (e.g., 0-100 score). Applicable to the combo solver since interruption scores are bounded.
_Source: https://dke.maastrichtuniversity.nl/m.winands/documents/CIG2009.pdf_

**Information Set MCTS (IS-MCTS) — Preferred for Card Games** — Purpose-built for hidden information. At each MCTS iteration, randomly assign the opponent a hand consistent with known information ("determinization"), then search as if perfect information. Over many iterations, statistics converge to account for the distribution of possible opponent hands. Avoids strategy fusion and non-locality pathologies. Used successfully in poker, Dou Di Zhu, Hanabi.

**For Yu-Gi-Oh! handtrap modeling**: define probability distributions for common handtraps in the current meta. Each MCTS rollout samples a random opponent hand from this distribution. The solver naturally learns which combo lines are robust against the likely disruption spread.
_Source: https://ieeexplore.ieee.org/document/6203567/, https://arxiv.org/abs/1902.06075_

_Confidence: HIGH for expectiminimax fundamentals, MEDIUM-HIGH for IS-MCTS adaptation to Yu-Gi-Oh! (no direct precedent found, but card game applications well-documented)._

### Result Aggregation and Decision Tree Output

_Merging parallel results and building readable output._

**Aggregation Strategies (Root Parallelism):**

| Strategy | Description | Trade-off |
|---|---|---|
| Best-path selection | Each worker returns best path; aggregator picks global best | Simple but discards alternatives |
| Union of paths | Collect all unique paths, deduplicate by terminal state hash, rank top-K | Comprehensive but may have redundancy |
| Vote-based (MCTS) | Merge visit counts at root-level actions across all trees | Statistically sound, standard in parallel MCTS |
| Hierarchical merge | Merge trees level-by-level; union children at each depth | Produces combined decision tree |

_Source: https://dke.maastrichtuniversity.nl/m.winands/documents/multithreadedMCTS2.pdf_

**Decision Tree Data Structure:**
```typescript
interface DecisionNode {
  state: StateSnapshot;
  action: Action | null;       // null for root
  score: number;
  visitCount: number;
  children: DecisionNode[];
  annotation?: string;         // "Normal Summon Aleister the Invoker"
  isComboEnd?: boolean;
  handtrapScenario?: string;   // "Opponent activates Ash Blossom"
}
```

**Pruning for Readability:**
- Remove branches with visit count below threshold
- Collapse linear chains (single-child sequences) into composite action nodes
- Limit to top-X branches per decision node (configurable)
- Sort children by score descending (recommended path always first)

**Visualization Patterns:** Progressive disclosure (expand on click), color coding by score, annotations on edges, "..." for pruned subtrees with hidden branch count, highlighted recommended path.
_Source: https://www.yworks.com/pages/interactive-decision-tree-diagrams_

_Confidence: HIGH — data structures and aggregation patterns well-documented._

### Hexagonal Architecture for the Solver

_Separating domain logic from infrastructure._

**Three Layers:**
```
[Domain Core]        [Adapters]              [Infrastructure]
Search algorithms ←→ OCGCoreAdapter      ←→ WASM binary
Scoring/evaluation←→ PiscinaWorkerAdapter←→ Worker pool
Decision tree     ←→ StateSerializer     ←→ ArrayBuffer
```

**Port — GameOracle (driven):**

> ⚠ Research draft — final interface uses `applyAction`/`fork`. See `architecture-solver.md`.

```typescript
interface GameOracle {
  createDuel(config: DuelConfig): DuelHandle;
  getLegalActions(handle: DuelHandle): Action[];
  executeAction(handle: DuelHandle, action: Action): StateSnapshot;
  serializeState(handle: DuelHandle): Uint8Array;
  deserializeState(data: Uint8Array): DuelHandle;
  destroyDuel(handle: DuelHandle): void;
}
```

**Port — SearchStrategy (driving):**

> ⚠ Research draft — final interface is `SolverStrategy` with `solve()`. See `architecture-solver.md`.

```typescript
interface SearchStrategy {
  search(
    oracle: GameOracle,
    initialState: StateSnapshot,
    budget: SearchBudget,
    onImprovement?: (result: SearchResult) => void
  ): Promise<SearchResult>;
}

interface SearchBudget {
  maxTimeMs?: number;
  maxNodes?: number;
  maxIterations?: number;
}
```

**Testability via MockOracle** — Pre-configure a small game tree for deterministic testing. Unit test each strategy against known outcomes. Test transposition tables with crafted diamond-shaped DAGs. Test anytime behavior with very small budgets. Test result aggregation with multiple mock searches. **No OCGCore WASM dependency for domain logic testing.**
_Source: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html, https://alistair.cockburn.us/hexagonal-architecture_

### State Forking Design Decision

_How to handle OCGCore's forward-only constraint within the architecture._

**Option 1 — Serialize/Deserialize at branch points:** Before branching, call `serializeState()` (WASM memory snapshot). For each child, `deserializeState()` into a fresh duel instance. Cost: O(state_size) per branch point. Preferred for DFS (frequent shallow backtracking).

**Option 2 — Replay from root:** Store action sequence. Create fresh duel, replay parent's actions to reach branch point. Cost: O(depth × action_cost). Better for deep trees with sparse branching.

**Option 3 — Hybrid with checkpoints:** Serialize at checkpoint depths (every N levels), replay only from nearest checkpoint. Balances both approaches.

**In root parallelism:** Each worker replays from root independently — no serialization overhead for parallelism itself. Within each worker, the choice between serialize/replay depends on the algorithm:
- DFS → serialize/deserialize at branch points (constant-cost backtracking)
- MCTS → replay from root per simulation (natural fit with independent rollouts)
- Beam search → serialize current beam, deserialize for each candidate expansion

_Source: https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/, https://github.com/piscinajs/piscina_

_Confidence: HIGH — patterns verified against real game engine implementations._

## Implementation Approaches and Technology Adoption

### Existing Yu-Gi-Oh! AI/Solver Projects

_Landscape of prior art — what exists, what algorithms they use, and what gaps remain._

**WindBot (Rule-Based, C#)** — The most widely deployed Yu-Gi-Oh! AI. Uses purely rule-based executors — hand-authored decision trees per deck (30+ decks supported). Ships with EDOPro via WindBot-Ignite. **Not a tree search solver.** However, WindBot executor files are a gold mine for **domain heuristics** — action priority orderings, card evaluation logic, and chain resolution preferences that can seed pruning/evaluation functions.
_Source: https://github.com/ProjectIgnis/WindBot-Ignite, https://github.com/IceYGO/windbot_

**ygo-agent (Deep RL, JAX/Python)** — Most advanced Yu-Gi-Oh! AI project. Uses PPO with recurrent actor-critic, transformer self-attention card encoders, and LLM-generated card embeddings. Built on ygoenv (ygopro-core + EnvPool). **Key data point: caps legal actions at 24 per step** — informative branching factor baseline. Trained on 8× RTX 4090.
_Source: https://github.com/sbl1996/ygo-agent, https://deepwiki.com/exterrestialfake/ygo-agent/5-neural-network-models_

**melvinzhang/yugioh-ai (MCTS, Python/C++)** — Uses MCTS directly on top of ygopro-core. The closest existing project to skytrix's solver ambition. Accepts any .ydk file. Early-stage, no published performance data.
_Source: https://github.com/melvinzhang/yugioh-ai_

**YGO-Combo-Simulator (Java, Statistical)** — Monte Carlo simulation for hand consistency testing (draws N sample hands, checks combo piece presence). NOT a tree search — only checks probabilities, doesn't simulate play sequences.
_Source: https://github.com/SpearKitty/YGO-Combo-Simulator_

**Community Tools:**
- DeckLens YGO — browser-based deck analyzer with hand probability calculator
- Master Duel Meta Deck Tester — online sample hand simulation
- Untapped.gg — deck tracker with remaining-deck-contents tracking

**Gap Analysis:** No existing tool performs automated combo path solving with tree search on OCGCore. WindBot is rule-based per-deck; ygo-agent is full RL (requires GPU training); yugioh-ai is MCTS but early-stage with no performance data. The skytrix solver would be the **first production-grade, general-purpose combo path solver** using tree search with OCGCore as oracle.

_Confidence: HIGH — verified against GitHub repositories and community sources._

### Academic Research on CCG/TCG AI

**"Survey of Artificial Intelligence for Card Games" (Stamm et al., 2019)** — CCGs are challenging due to "vast search space and dynamically changing game states." Card-Play Policy Networks can "improve rollout quality and reduce branching factor."
_Source: https://arxiv.org/abs/1906.04439_

**"MCTS Based Agents for Multistage Single-Player Card Game" (Godlewski, 2021)** — Tested flat Monte-Carlo, full MCTS-UCB, and expert-rule agents on LOTR:TCG. **MCTS with optimized playout strategies outperformed expert-rule agents.** Validates MCTS for single-player card game solving.
_Source: https://arxiv.org/abs/2109.12112_

**"Summarizing Strategy Card Game AI Competition" (Kowalski & Miernik, 2023)** — Five years of LOCM competitions. Covers tree search, neural networks, evaluation functions for CCG.
_Source: https://arxiv.org/abs/2305.11814_

**"Automated Playtesting in CCGs using Evolutionary Algorithms" (Hearthstone)** — EA outperformed MCTS in some Hearthstone scenarios, suggesting EA as viable alternative for combo enumeration.
_Source: https://www.researchgate.net/publication/324767888_

_Confidence: HIGH — peer-reviewed academic sources._

### POC/MVP Strategy

_Minimum viable slice to prove feasibility._

**MVP Scope:**
1. **Single deck** (known combo deck, e.g., Branded Despia or Snake-Eye)
2. **Goldfish mode** (no opponent interaction)
3. **Fixed 1–5-card hand** (eliminates draw randomness; fewer than 5 cards supported for partial-hand testing)
4. **Goal: reach a specified board state** (e.g., "Baronne de Fleur + Mirrorjade + set Infinite Impermanence")
5. **DFS with iterative deepening** as first algorithm — simplest to implement, debug, benchmark

**Solitaire Solver Parallel:** Klondike/FreeCell solvers follow the exact same pattern — known initial state, forward-only simulation, goal detection. MinimalKlondike achieves 80%+ solvability detection in <4 seconds using similar techniques.

**Benchmarking Methodology (DFS vs MCTS):**
- Identical initial states (same hand, deck order, random seed)
- Equal computational budget (wall-clock time OR node count, not both)
- Minimum 100 independent runs per configuration
- Metrics: solve rate (%), solution quality (score), time-to-first-solution, nodes explored
- Statistical tests: Wilcoxon signed-rank or Mann-Whitney U, with effect size (Cohen's d)
- **Hybrid worth testing:** Replace MCTS rollouts with budget-limited DFS for intensification in deep regions
_Source: https://drops.dagstuhl.de/storage/00lipics/lipics-vol210-cp2021/LIPIcs.CP.2021.14/LIPIcs.CP.2021.14.pdf_

_Confidence: HIGH — standard benchmarking methodology from game AI research._

### Performance Profiling and Tooling

_Measuring OCGCore latency — the critical unknown._

**Profiling Stack:**
- **Clinic.js** (`clinic flame`) — flamegraphs exposing event loop stalls, WASM frames visible as compiled-code hints
- **Node.js `--inspect`** + Chrome DevTools — CPU profiling per worker
- **0x** — single-command flamegraph generation for quick worker task profiling
- **`perf_hooks`** — `performance.mark()`/`performance.measure()` wrapping each OCGCore WASM call
- **Piscina built-in stats** — run-time and wait-time per task, queue depth, worker utilization
_Source: https://clinicjs.org, https://nodesource.com/blog/understanding-flame-graphs-in-nodejs_

**Recommended Profiling Workflow:**
1. Wrap each OCGCore WASM call in `performance.mark()`/`performance.measure()`
2. Use Clinic.js flame to identify bottleneck (WASM execution vs JS overhead vs worker comms)
3. Use Piscina stats to measure queue depth and worker utilization
4. Profile with fixed hand/deck for deterministic flamegraphs

**Estimated Performance Budget:** If OCGCore takes 1-5ms per action, a 15-30 action combo simulation = 15-150ms. At 1000 MCTS iterations = 15-150 seconds per hand. **Must be parallelized** — with 8 workers: 2-19 seconds. With Zobrist caching reducing re-simulations by ~50-80%: **target < 5 seconds for Fast mode.**

_Confidence: MEDIUM — OCGCore per-action latency is an estimate, must be profiled._

### Testing Strategies

_How to validate solver correctness and quality._

**Property-Based Testing (Invariants):**
1. Every returned action sequence is legal (replaying on OCGCore produces no errors)
2. Terminal state matches the declared goal
3. Solution length is monotonically non-increasing as budget increases
4. Transposition table consistency (same board state → same hash)
5. Fuzzing: random 1–5-card hands from deck → solver finds valid path or reports "no solution" — never crashes or returns illegal sequence

**Golden Test Suite (Regression):**
- Curate 20-50 hand/deck/goal triplets with known-optimal solutions (hand-verified by expert players)
- After any solver change: (1) solve rate must not decrease, (2) avg solution length must not increase, (3) no previously-solved case becomes unsolved
- Store golden results as JSON fixtures in repo; CI compares against baseline
- Include 3-5 **canary decks** stressing specific features (high branching, long chains, XYZ combos, Pendulum scales)
_Source: https://www.shaped.ai/blog/golden-tests-in-ai, https://heavythoughtcloud.com/knowledge/designing-a-golden-set_

**Testing Stochastic Algorithms (MCTS):**
- Minimum 100+ independent runs per configuration for statistical power
- Wilcoxon signed-rank test for algorithm comparison
- Effect size reporting (Cohen's d) alongside p-values
- Wilson score interval for solve rate confidence intervals

**Mock Oracle Testing:**
- State transition stubs with simplified card effects
- Recorded trace replay (capture OCGCore transitions for known combos, replay deterministically)
- Hexagonal architecture's `GameOracle` port enables swapping `RealOCGCoreOracle` for `MockOracle`

_Confidence: HIGH — standard testing patterns verified against software testing literature._

### Risk Assessment and Mitigation

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| **OCGCore too slow per node** | HIGH | MEDIUM | Profile first; piscina pool + Zobrist cache + anytime return |
| **Branching factor explosion (30-60+ actions)** | HIGH | HIGH (complex decks) | Progressive widening + WindBot heuristics for action filtering |
| **MCTS local optima** | MEDIUM | MEDIUM | Randomized restarts (root parallelism inherently provides this) |
| **MCTS poor rollout quality** | MEDIUM | HIGH (complex effects) | Domain heuristics from WindBot; epsilon-greedy rollouts |
| **Infinite loops in combo exploration** | MEDIUM | LOW | Zobrist hash loop detection + max depth 50 safety net |
| **Interruption tagging maintenance** | LOW | HIGH (100-200 new cards/quarter) | Lean on OCGCore scripts; make heuristic tags optional, not required |
| **Memory pressure (WASM heap growth)** | LOW | MEDIUM | Instance recycling + forced worker respawn after N tasks |

**Key Maintenance Insight:** "A heuristic system for card games requires constant updating as new cards are released, whereas a more complete solution would likely only require a list of new cards" (Stamm et al., 2019). **Strategy: OCGCore handles card effects via Lua scripts (community-maintained). The solver should work at reduced quality with zero card-specific heuristics. Heuristic tagging is an optional quality enhancement, not a correctness requirement.**
_Source: https://arxiv.org/abs/1906.04439_

_Confidence: HIGH for risk identification, MEDIUM for probability estimates (need profiling data)._

## Technical Research Recommendations

### Technology Stack Recommendations

| Component | Choice | Rationale |
|---|---|---|
| Worker pool | piscina | De facto Node.js standard, AbortController + MessagePort + priority queues |
| First algorithm | DFS + iterative deepening | Simplest, establishes baseline, anytime via IDDFS |
| Second algorithm | SP-MCTS with randomized restarts | Handles high branching, natural anytime, no heuristic required |
| State hashing | Zobrist (64-bit, ~~BigInt~~ dual 32-bit `number`) | O(1) incremental updates, proven for game state caching. **Architecture decision:** dual 32-bit chosen over BigInt (5-10× slower in V8). See `architecture-solver.md` §Zobrist Hashing. |
| Parallelism | Root parallelism | 14.9x speedup / 16 threads, zero synchronization |
| Architecture | Hexagonal (ports/adapters) | Testable without OCGCore, clean separation |
| Handtrap modeling | IS-MCTS with determinization | Purpose-built for hidden information card games |
| Profiling | Clinic.js + perf_hooks + Piscina stats | Full-stack observability from WASM to worker pool |

> Targets below are pre-POC estimates. See `prd-solver.md` for final requirements.

### Success Metrics and KPIs

| Metric | Target (Fast Mode) | Target (Optimal Mode) |
|---|---|---|
| Time to first solution | < 3 seconds | < 30 seconds |
| Solve rate (known combo decks) | > 80% | > 95% |
| Solution quality (vs hand-verified optimal) | Within 90% of optimal score | Optimal or near-optimal |
| Nodes explored per second | > 500/sec (with caching) | > 100/sec |
| Memory per worker | < 30 MB | < 50 MB |
| Worker pool startup | < 500ms | < 500ms |

_All targets are estimates based on research. Phase 1 POC profiling will calibrate real values._
