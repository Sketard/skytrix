---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/planning-artifacts/research/solver-structural-constraints.md
  - _bmad-output/planning-artifacts/research/technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md
workflowType: 'research'
lastStep: 6
status: 'complete'
research_type: 'technical'
research_topic: 'Fork cost resolution for the YGO combo solver'
research_goals: |
  1. Survey the state-of-the-art for cheap state cloning in WASM-hosted
     game engines — memory snapshots, structured cloning, copy-on-write,
     checkpoint/restore — and evaluate their applicability to the current
     `@n1xx1/ocgcore-wasm` v0.1.1 runtime.
  2. Inventory alternative OCGCore bindings and adjacent ecosystem
     projects (native YGOPro-core bindings, edopro engine forks, custom
     WASM builds) that expose cheaper fork primitives, with licensing
     and maintenance considerations.
  3. Extract MCTS and search-engine patterns that avoid the
     fork-per-expansion cost entirely: tree reuse across iterations,
     root parallelization, virtual loss, shared trees, lazy expansion,
     undo-based simulation, in-place rollouts with explicit revert.
  4. Document replay-based caching strategies (Zobrist-keyed intermediate
     state pools, replay segment memoization, partial replay from
     checkpoints) and quantify their expected impact given current
     measurements (10-17ms/fork, scales linearly with path length).
  5. Propose a concrete path from the current 15ms fork cost to a target
     of ≤ 1ms equivalent (or to a design that needs orders-of-magnitude
     fewer forks), split into v1 quick wins and v2 architectural shifts,
     with effort bands and risk assessment.
user_name: 'Axel'
date: '2026-04-13'
web_research_enabled: true
source_verification: true
---

# Research Report: Technical

**Date:** 2026-04-13
**Author:** Axel
**Research Type:** Technical

---

## Research Overview

This research addresses constraint 1.3 from
[solver-structural-constraints.md](./solver-structural-constraints.md):
**fork cost**. `OCGCoreAdapter.fork()` currently delegates to
`forkViaReplay()` because `@n1xx1/ocgcore-wasm` v0.1.1 exposes no
native WASM memory snapshot primitive. The replay mechanism re-applies
the entire action history on a fresh duel instance, at an empirical
cost of **10-17ms per fork**, scaling linearly with path length.

At the fast-mode budget of 5000ms, this gives an absolute ceiling of
~333 forks per solve *before* counting action enumeration, Zobrist
hashing, scoring, or transposition-table lookups. Meta combo lines are
15-25 actions long; even with modest branching, the raw number of
required forks blows past the budget. Fork cost is identified in the
constraints doc as one of the three top blockers (alongside latent
modeling — addressed by
[technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md](./technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md) —
and move ordering).

The prior scorer research established that the three blockers are
**mutually reinforcing**: a better scorer without reach gets nowhere, a
bigger reach without direction explores randomly, better ordering
without a compass reaches the wrong place. This research focuses on
reach — specifically, on lifting the physical ceiling imposed by fork
cost so that the budget translates into meaningful depth and breadth.

The research methodology is **multi-track inventory**: rather than
committing to a single approach, it surveys four parallel tracks
(WASM-level snapshots, alternative bindings, MCTS patterns that avoid
forking, replay caching) and evaluates each for applicability, effort,
licensing, and risk. The deliverable is a **decision matrix** that lets
us commit to a concrete path with open eyes about what we gain and lose.

Explicitly out of scope: learned-model approaches (these depend on a
working solver to generate training data — same bootstrap argument as
the scorer research), distributed / multi-machine solving (the solver
targets a single worker pool, not a cluster), and full ocgcore rewrite
(prohibitive effort, risks losing Epic 2 adversarial work).

---

## Technical Research Scope Confirmation

**Research Topic:** Fork cost resolution for the YGO combo solver (constraint 1.3)

**Research Goals:**

1. Survey WASM state cloning state-of-the-art — memory snapshots,
   structured cloning, copy-on-write, checkpoint/restore — and evaluate
   applicability to `@n1xx1/ocgcore-wasm` v0.1.1.
2. Inventory alternative OCGCore bindings and adjacent ecosystem
   projects (native YGOPro-core bindings, edopro engine forks, custom
   WASM builds) with licensing and maintenance considerations.
3. Extract MCTS / search-engine patterns that avoid the
   fork-per-expansion cost entirely: tree reuse, root parallelization,
   virtual loss, shared trees, lazy expansion, undo-based simulation,
   in-place rollouts with explicit revert.
4. Document replay-based caching strategies (Zobrist-keyed intermediate
   state pool, replay segment memoization, partial replay from
   checkpoints) and quantify expected impact vs. the current 10-17ms/fork
   measurement.
5. Propose a concrete path from 15ms/fork to ≤ 1ms-equivalent (or a
   design that needs orders-of-magnitude fewer forks), split into v1
   quick wins and v2 architectural shifts, with effort bands and risks.

**Technical Research Scope:**

- **WASM state cloning landscape** — emscripten memory snapshots,
  wabt/wasm-opt, memory.grow/memory.copy, WAMR/wasmtime checkpoint
  support, MVP wasm vs. proposals (multi-memory, GC).
- **OCGCore ecosystem** — `@n1xx1/ocgcore-wasm` maintenance status,
  edopro-core upstream, YGOPro Percy, EDOPro, Project Ignis scripts,
  alternative wrappers, native Node.js bindings, licensing (AGPL).
- **Fork-avoiding MCTS patterns** — tree reuse, virtual loss, progressive
  widening + lazy expansion, undo-move simulation, root parallelization.
- **Replay caching strategies** — intermediate state pool keyed by
  prefix Zobrist, checkpoint strategy, persistence across solves,
  memory budget tradeoffs, invalidation rules.
- **Decision framework** — quantitative matrix (effort / lift / risk /
  licensing), v1 + v2 paths, fallback strategies.

**Research Methodology:**

- Multi-track inventory (4 parallel angles, not a single approach)
- Multi-source validation for licensing and maintenance status
  (architecture-engaging claims require rigor)
- Explicit confidence distinction: published / community / hypothesis
- Final deliverable: actionable decision matrix

**Input Documents:**

- [solver-structural-constraints.md](./solver-structural-constraints.md) — problem definition, section 1.3
- [technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md](./technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md) — prior research, fork cost flagged as complementary blocker
- `OCGCoreAdapter.fork()` / `forkViaReplay()` code — anchoring point

**Out of Scope:**

- Learned-model approaches (bootstrap problem, same argument as scorer research)
- Distributed multi-machine solving (single worker pool target)
- Full ocgcore rewrite (prohibitive effort, Epic 2 regression risk)

**Scope Confirmed:** 2026-04-13

---

## Technology Stack Analysis — Fork Cost Landscape

> **Template adaptation note.** "Programming languages / databases / cloud
> infrastructure" is irrelevant to a research topic on runtime state cloning
> of a WASM game engine. This section is re-scoped to the **four parallel
> tracks** identified in scope confirmation: WASM state cloning primitives,
> OCGCore ecosystem and alternatives, MCTS parallelization / tree reuse
> patterns, and make-unmake vs. copy-based search. Each track is evaluated
> with explicit note of what is and is not applicable to our case.

### 1. WebAssembly State Cloning Primitives

#### How WASM state actually works

A WASM module's runtime state lives in three places:

1. **Linear memory** — a single contiguous `ArrayBuffer` (accessed via
   `WebAssembly.Memory.buffer`), holding the heap, data segments, and
   anything the module `malloc`s.
2. **Globals** — scalar values declared at module level, not in the
   linear memory buffer. Typed, fixed count, accessible via the
   `WebAssembly.Global` API if exported.
3. **Stack** — the call stack exists *inside* the linear memory for
   emscripten-compiled modules (managed by the `stackSave` / `stackRestore`
   intrinsics), which means it is *already captured* when you clone the
   linear memory.

The critical observation for cloning: **an emscripten-built WASM module's
complete execution state is largely captured by its linear memory** plus
any exported globals. If no non-WASM side effects have escaped into the
JS host (no live JS references into WASM, no external tables), cloning
the memory buffer clones the state.

This is how the proposed "snapshot fork" in the constraints doc is
supposed to work: `clone(memory.buffer)` at fork time, `replace memory`
at restore time, O(1) in path length.

#### Primitives available today

- **`WebAssembly.Memory.buffer`** returns the underlying `ArrayBuffer`.
  It can be `slice()`'d to produce a detached copy of the full memory
  contents. Cost: O(memory_size) regardless of path length — this is
  the key property we want.
- **`memory.copy`** (bulk-memory-operations proposal, now a standard
  part of WASM MVP) provides efficient intra-memory copies, but not
  inter-memory copies across instances.
- **Structured cloning** of `WebAssembly.Memory` objects is supported
  for shared memory (threading) but has quirks for non-shared memory
  — the Mozilla bug tracker discussion
  ([bugzilla 1412852](https://bugzilla.mozilla.org/show_bug.cgi?id=1412852))
  confirms structured cloning works but with specific rules.
- **Memory growth** (`memory.grow`) invalidates prior `TypedArray` views
  over the buffer but does not invalidate the memory content itself.
  Any snapshot approach must re-acquire views after a restore.

#### The gap that blocks us

`@n1xx1/ocgcore-wasm` v0.1.1 does not **expose** these primitives at its
public API layer. The library's `OcgCore` class wraps the WASM module
and holds internal state (JS-side object pools, card script proxies,
message queues) that are **not** inside the linear memory. Even if we
`slice()`'d the `Memory.buffer`, the JS-side state would be stale on
restore.

This is the concrete blocker: the WASM-level primitives exist, but the
wrapper does not support replacing the linear memory from outside without
also resetting its JS-side state. Fixing this requires either:

- A PR upstream to expose `snapshot()` / `restore()` on the wrapper
- A local fork of `@n1xx1/ocgcore-wasm` that exposes the primitives and
  properly coordinates with the wrapper's JS state
- A complete local rebuild of the wrapper that isolates JS state to
  read-only caches

Sources:
[Debugging Memory Leaks in WebAssembly using Emscripten — web.dev](https://web.dev/articles/webassembly-memory-debugging),
[memory.copy — MDN WebAssembly Reference](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Memory/copy),
[Bulk Memory Operations Proposal — WebAssembly](https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md),
[A Practical Guide to WebAssembly Memory — radu-matei.com](https://radu-matei.com/blog/practical-guide-to-wasm-memory/),
[Structured Clone of WebAssembly.Memory (Mozilla bug 1412852)](https://bugzilla.mozilla.org/show_bug.cgi?id=1412852).

### 2. OCGCore Ecosystem and Alternatives

#### Current upstream landscape

The Yu-Gi-Oh core engine (ocgcore) is a C++ game state engine with a Lua
script runtime, originally from YGOPro. The current ecosystem:

- **[edo9300/edopro](https://github.com/edo9300/edopro)** — the canonical
  upstream engine + sample GUI. The script engine (ocgcore subfolder)
  is the reference implementation used by ProjectIgnis / EDOPro. All
  other engine forks descend from this.
- **[@n1xx1/ocgcore-wasm](https://jsr.io/@n1xx1/ocgcore-wasm)** — ProjectIgnis'
  EDOPro Core built for WebAssembly via emscripten. This is our current
  dependency. Published on JSR.
- **[knight00/ocgcore-KCG](https://github.com/knight00/ocgcore-KCG)** —
  an ocgcore variant. Unclear maintenance status; descends from the same
  upstream.
- **Multiple personal forks** of edo9300/edopro, primarily cosmetic
  client customizations. None identified as alternative engine
  implementations.

**Licensing**: EDOPro is under a permissive/source-available arrangement
but the **Lua scripts** (Project Ignis) are tightly community-controlled.
Any fork distributing the engine must respect both the engine's license
and the script redistribution policy. For a personal/research project
using the stock engine + stock scripts this is fine; any fork with
redistributed engine code would need explicit licensing review.

#### Alternative paths evaluated

- **Native Node.js bindings via node-gyp** — not currently published.
  In principle feasible: the ocgcore library is C++, Node.js has
  node-addon-api for native modules, and in-process state manipulation
  of a C++ object is straightforward. But maintenance cost is high
  (rebuild per Node version, per OS, per arch), and no published
  precedent exists. **Viable but effort-heavy**.
- **Local fork of `@n1xx1/ocgcore-wasm`** with exposed snapshot
  primitives — medium effort, medium risk. Requires understanding the
  wrapper's internal JS state and how it synchronizes with the WASM
  memory. **Most viable near-term path**.
- **Complete custom build via emscripten** — build ocgcore ourselves
  with different compile flags, expose additional intrinsics (including
  `stackSave`/`stackRestore`), and write our own JS wrapper that
  respects the snapshot contract. **High effort, high control**.
- **Upstream PR to `@n1xx1/ocgcore-wasm`** — ideal long-term, uncertain
  timeline (depends on maintainer). **Low-risk background option to
  pursue in parallel with a local fork**.

The **important non-alternative**: Project Ignis has no incentive to
expose snapshot primitives because EDOPro does not do tree search —
the upstream users are real-time clients that play one game at a time.
Our use case is unique, so upstream receptivity to a PR is genuine but
not guaranteed to be fast.

Sources:
[edo9300/edopro — GitHub](https://github.com/edo9300/edopro),
[@n1xx1/ocgcore-wasm — JSR](https://jsr.io/@n1xx1/ocgcore-wasm/doc/~/OcgMessageMissedEffect.type),
[knight00/ocgcore-KCG — GitHub](https://github.com/knight00/ocgcore-KCG).

### 3. MCTS Parallelization and Fork-Avoiding Patterns

The MCTS parallelization literature — mature since ~2008 (Chaslot &
Winands) and regularly extended since — converges on three patterns,
each with different implications for our fork cost problem.

#### Root parallelization (Chaslot & Winands 2008)

**Each worker builds an independent tree** from a shared root state,
then results are combined at the end (usually by summing visit counts).
Workers never share intermediate state. Reported result: **strength
speedup of 14.9× on 16 threads** for Go, with no inter-thread
coordination.

**Why this matters for fork cost**: root parallelization does not
reduce per-worker fork cost, but it has a **specific architectural
property** we can exploit. Because each worker maintains a fully
independent tree, **each worker only needs to fork from the root
state** once at the start of its iteration, plus once per simulation.
The total number of forks per solve is `workers × iterations_per_worker
× branching_factor_per_iteration`. If we reduce `iterations_per_worker`
while keeping total iterations the same by adding workers, we pay more
aggregate fork cost but in parallel across cores.

For our use case (single solve, already in a worker pool via piscina),
root parallelization **is already the implicit model** for Epic 2
MCTS. The relevant question is not "should we use root parallelization?"
but "does the current solver already use it?" — and if so, the fork
cost per worker is the real ceiling, not the inter-worker coordination.

#### Tree parallelization with virtual loss (Chaslot & Winands 2008;
Mirsoleimani & Plaat 2017)

**A single shared tree** is navigated by multiple workers simultaneously.
When a worker is descending through a node, it adds a **virtual loss**
to the node's statistics to discourage other workers from picking the
same path (avoiding wasted work on duplicate branches). When the
simulation finishes, the virtual loss is removed and replaced with the
real result.

**Why this matters — or doesn't — for fork cost**: virtual loss is
about *coordination*, not about *state cloning*. Each worker still
needs its own game state to run a simulation, which in our case still
means a fork. Tree parallelization has **no direct benefit** for fork
cost. It only helps if you're already paying for a shared tree and
want to scale with threads.

The one **indirect benefit**: tree parallelization with virtual loss
allows **lazy expansion** — multiple workers can select into the same
promising region of the tree without forking redundant branches, which
means fewer forks overall than root parallelization would produce at
the same iteration budget. But this gain is usually 20-40%, not
orders of magnitude.

#### Lock-free MCTS (Enzenberger & Müller 2010)

**A sophistication of tree parallelization** that uses CPU memory
model guarantees (sequential consistency on atomic pointer writes) to
avoid mutexes entirely. Scales better than mutex-based tree
parallelization on many-core machines.

**Why this is not our bottleneck**: we're blocked on fork cost, not on
lock contention. Lock-free helps when many threads contend on the same
tree nodes, which is a concern at 32+ cores. Our worker pool is single
digit cores typically. Lock-free is an optimization for a problem we
don't have.

Sources:
[Parallel Monte-Carlo Tree Search (Chaslot, Winands & van den Herik 2008)](https://dke.maastrichtuniversity.nl/m.winands/documents/multithreadedMCTS2.pdf),
[An Analysis of Virtual Loss in Parallel MCTS (Mirsoleimani & Plaat, ICAART 2017)](https://liacs.leidenuniv.nl/~plaata1/papers/paper_ICAART17.pdf),
[A Lock-free Multithreaded Monte-Carlo Tree Search Algorithm (Enzenberger & Müller, ACG 2010)](https://webdocs.cs.ualberta.ca/~mmueller/ps/enzenberger-mueller-acg12.pdf),
[More Trees or Larger Trees: Parallelizing MCTS (Steinmetz & Gini 2020)](https://www-users.cse.umn.edu/~gini/publications/papers/Steinmetz2020TG.pdf).

#### What the MCTS literature actually says about state cloning

Most published MCTS parallelization papers **assume cheap state
cloning** as an implicit premise. The benchmark games are Go (cheap
board copy), chess (make/unmake), and toy domains. The papers do not
discuss expensive state as a first-class constraint because their
target domains do not have it.

**This is the core insight for us**: the MCTS parallelization
literature offers *no direct solution* for expensive fork cost. It
offers coordination patterns (virtual loss, tree reuse, lock-free) that
are valuable *after* state cloning is cheap. Our problem lies **upstream**
of these patterns, at the engine/state level, not at the search level.

#### Tree reuse across searches (the one directly applicable MCTS pattern)

There is **one MCTS pattern** that directly reduces fork cost:
**subtree retention across successive searches**. In real-time Go
engines, after the opponent's move, the subtree rooted at the chosen
child of the root is retained and becomes the new root, reusing all
the simulation work from before the move. No forks, no rebuild.

**Applicability to our solve-from-scratch use case**: limited within a
single solve (we don't make moves), but relevant if we cache **partial
search trees** between successive solves on related openers.
Not a v1 target but worth noting for later.

### 4. Make-Unmake vs. Copy-Based Search (the Chess Engine Pattern)

Chess engines overwhelmingly use **make/unmake** (also called
"incremental update") instead of state cloning:

```
alphaBeta(depth):
    if depth == 0: return eval()
    for move in moves:
        makeMove(move)              // modify the single board in place
        score = alphaBeta(depth-1)
        unmakeMove(move)            // restore the single board
    return best score
```

**Key properties** (per the Chessprogramming Wiki and Talkchess
discussions):

- **One board, modified in place**. No state cloning at all.
- **Irreversible state** (en passant, castling rights, halfmove clock,
  Zobrist hash) is saved to a small LIFO stack in `makeMove` and
  restored in `unmakeMove`.
- **Cache-friendly**: the single board is hot in L1 throughout the
  search.
- **No memory allocation** during search (critical for inner-loop
  performance).

The alternative ("copy-make") pattern — duplicate the board before each
move, modify the copy, discard on return — is simpler to implement but
10-30% slower in measured chess benchmarks. Stockfish uses a **hybrid**:
a small subset of state is copied to a new position node, and the prior
state is kept in memory via a back-pointer, giving most of the benefit
of incremental update with simpler undo logic.

#### The brutal applicability question

**Can we do make/unmake with ocgcore?** No — and the reason is
architecturally important.

- OCGCore's state is **not a single data structure we own**. It is
  spread across C++ class instances, Lua VM state (per-card scripts),
  message queues, and activation logs.
- There is no `unmakeMove(move)` API. The engine is designed around
  **forward-only execution** — you apply messages, you observe
  messages, you cannot roll back.
- The Lua scripts contain **side effects** that are not captured in
  any "move" object: random number generator state, timer decrements,
  trigger queue state, counters, etc.
- Writing a correct `unmake` would require reverse-engineering every
  Lua script ever written — infeasible.

This is why `forkViaReplay` exists: it's the **only way** to get a
state at action `N` from a state at action `0` in an engine that
does not support undo.

**The only path to make/unmake-style efficiency is WASM memory
snapshots** (track 1) — which is the equivalent of "make/unmake at the
byte level" rather than at the message level. Instead of unmaking a
semantic move, we restore the raw memory bytes to a prior state.

Sources:
[Unmake Move — Chessprogramming Wiki](https://www.chessprogramming.org/Unmake_Move),
[Alpha-Beta — Chessprogramming Wiki](https://www.chessprogramming.org/Alpha-Beta),
[undo move vs. Position Cloning — TalkChess](https://talkchess.com/forum3/viewtopic.php?t=29770),
[AI and Undoing Moves — GameDev.net](https://gamedev.net/forums/topic/639922-ai-and-undoing-moves/5040459/),
[Increase Performance of Make Move, Unmake Move — TalkChess](https://talkchess.com/viewtopic.php?t=82843).

### 5. Landscape Summary and Track Evaluation

| Track | Direct fork cost reduction? | Implementation effort | Risk | Dependency |
|-------|---------------------------|----------------------|------|-----------|
| **1A** WASM memory snapshot via upstream PR | 10-50× | Low (coding) | High (timeline uncertainty) | Upstream maintainer |
| **1B** WASM memory snapshot via local fork of wrapper | 10-50× | Medium (weeks) | Medium (JS state coordination) | None |
| **1C** Custom emscripten build of ocgcore | 10-50× | High (month+) | High (unfamiliar toolchain) | None |
| **2A** Native Node.js bindings via node-gyp | Potentially 50-100× | Very high | Very high (unpublished) | None |
| **2B** Alternative upstream engine | Unknown | Very high | Very high (ecosystem risk) | None |
| **3A** MCTS root parallelization (already implicit) | None per worker | Zero | Zero | Already deployed |
| **3B** Tree parallelization with virtual loss | 20-40% (fewer redundant forks) | Medium | Medium (Epic 2 refactor) | Epic 2 |
| **3C** Lock-free MCTS | None (we don't have lock contention) | — | — | Not applicable |
| **3D** Tree reuse across successive solves | Conditional | Medium | Low | Per-session cache |
| **4A** Make/unmake ocgcore | — | — | — | **Not possible** |
| **5A** Replay caching with Zobrist-keyed checkpoint pool | 3-10× (path length reduction) | Low-medium | Low | None |

**Key findings at this stage**:

- **The MCTS parallelization literature does not directly solve our
  problem.** It assumes cheap state cloning as a premise. Tracks 3B
  and 3D give marginal gains (20-40%), not orders of magnitude.
- **Make/unmake is architecturally unavailable.** OCGCore's design
  precludes it. This is a hard constraint, not a cost-benefit
  trade-off.
- **The only 10-50× reductions come from WASM memory snapshots**
  (tracks 1A/1B/1C), which require engaging with the wrapper's JS-side
  state coordination. Track 1B (local fork) is the most viable
  near-term path.
- **Replay caching (track 5A) is the most immediately deployable
  improvement** — it does not require upstream changes, just a
  Zobrist-keyed intermediate state pool, and gives 3-10× by
  amortizing replay cost across reused path prefixes.
- **The v1 recommended path is 1B + 5A in parallel**: local wrapper
  fork for the snapshot primitive, and replay caching as an
  immediate incremental improvement that works regardless of whether
  the fork ships.
- **Tracks 2A (native bindings) and 2B (alternative engines) are
  high-effort, high-risk, and not recommended** unless track 1 proves
  unworkable. They are on-file as emergency fallbacks, not first
  choices.

## Integration Patterns Analysis — Plugging Fork Cost Fixes into the Solver

> **Template adaptation note.** "API design / REST / microservices / event-
> driven" is not the right framing. "Integration" here means **how the
> chosen tracks (WASM snapshot + replay caching) plug into the existing
> `OCGCoreAdapter`, `DuelContext`, and worker pool without breaking the
> rest of the solver**. Each section is a concrete integration contract.

### 1. Snapshot Primitive Integration (Track 1B — Local Wrapper Fork)

#### The contract to target

The minimum-viable snapshot primitive exposed by a forked
`@n1xx1/ocgcore-wasm` would look like:

```typescript
interface OcgCoreSnapshotCapable extends OcgCore {
  // Capture the full runtime state into a transferable token.
  // Cost: O(memory_size) in the linear memory, independent of path length.
  snapshot(): OcgSnapshotToken;

  // Replace the current state with a previously captured snapshot.
  // The current state is discarded; restoration is atomic from the
  // caller's perspective.
  restore(token: OcgSnapshotToken): void;
}

interface OcgSnapshotToken {
  // Raw memory buffer copy (ArrayBuffer)
  readonly linearMemory: ArrayBuffer;
  // Exported globals that live outside linear memory
  readonly globals: Readonly<Record<string, number | bigint>>;
  // Versioning — must match the library version that produced it
  readonly schemaVersion: string;
  // Optional: snapshot size in bytes (useful for memory budget)
  readonly byteLength: number;
}
```

**Why this shape specifically**:

- **Opaque token**, not a structured object — the consumer doesn't look
  inside, only passes the token back on restore. Same contract shape as
  browser storage `Blob`s or DB transaction IDs.
- **`linearMemory: ArrayBuffer`** not `Uint8Array` — because we want
  structured-clone-compatible transfer across worker boundaries (piscina
  workers).
- **`globals`** as a separate field because emscripten emits exported
  globals (notably stack pointer, heap base) that are outside the
  linear memory buffer and need to be restored explicitly via
  `stackRestore()` or equivalent runtime APIs.
- **`schemaVersion`** to reject snapshots taken against a different
  ocgcore build — critical for correctness and for invalidation after
  `cards.cdb` updates (section 7).

#### The JS-side coordination problem

The reason we can't just `slice()` the memory buffer today is that the
wrapper holds **JS-side state**:

- Card script proxies (Lua-to-JS binding objects)
- Pending message queues
- Activation logs
- Script callback registrations

When we restore the linear memory, these JS objects still point to
**stale addresses** inside the WASM heap. If we call into the WASM
engine after a naive restore, the Lua VM state has been rewound but
the JS-side proxies still hold their old handles, and things break
silently.

**The fix inside the forked wrapper**: the wrapper must classify its
JS-side state into three buckets:

1. **Read-only caches** (script definitions, card database lookup
   tables) — these are invariant across the lifetime of the wrapper
   instance and need no restoration. They should be **hoisted out of
   the per-instance state** into module-level singletons so they are
   shared across all instances.
2. **Derived-from-memory state** (message queues, activation logs,
   proxy handles into WASM objects) — these must be **invalidated on
   restore** and lazily rebuilt on next access. The wrapper exposes
   clear invalidation hooks.
3. **Truly external state** — ideally none, but if any exists it must
   be serialized into the snapshot token alongside `linearMemory`.

Empirically classifying the wrapper's state is the core implementation
work of track 1B. Getting this right is what separates "works in
demo" from "correct across all code paths".

#### Use site changes in `OCGCoreAdapter.fork()`

Current (hypothetical):
```typescript
async fork(): Promise<OCGCoreAdapter> {
  const child = new OCGCoreAdapter(this.config);
  await child.initializeFromEmpty();
  await child.replayActions(this.actionHistory);
  return child;
}
```

Post-fork (target):
```typescript
async fork(): Promise<OCGCoreAdapter> {
  const snapshot = this.core.snapshot();
  const child = new OCGCoreAdapter(this.config);
  await child.initializeFromEmpty();
  child.core.restore(snapshot);
  child.actionHistory = [...this.actionHistory]; // cheap array copy
  return child;
}
```

**Key properties**:
- `actionHistory` is copied as a reference array, not replayed.
- `snapshot.linearMemory` is the dominant cost (KB to MB depending on
  ocgcore internal state size — empirical measurement required).
- No per-action Lua execution on the fork path. **Replay becomes
  obsolete once snapshot works**, though keeping replay as a fallback
  is recommended until snapshot is battle-tested (section 6).

### 2. Replay Cache Integration (Track 5A — Zobrist-Keyed Checkpoint Pool)

#### Why this works *before* snapshots ship

The replay-cache track is deployable **today** without any upstream or
fork work. It does not reduce the cost of a single fork — it reduces
the **path length** that a fork must replay by caching intermediate
states keyed by their Zobrist hash.

Conceptually:

```
replayActions(actions):
    key = zobrist_of_prefix(actions)
    if cachedState = checkpointPool.get(key):
        core.restore_via_legacy_replay(cachedState)   // shorter replay
        replayActions(actions[cachedState.pathLength:])
    else:
        core.initializeFromEmpty()
        for action in actions:
            core.applyAction(action)
        maybe_store_checkpoint(actions, zobrist_of_prefix(actions))
```

The `maybe_store_checkpoint` decision is the interesting one:

- **Store every action** → unbounded memory, 1-for-1 overhead, useless.
- **Store every K-th action (fixed stride)** → bounded memory, but
  biased toward long paths rather than hot prefixes.
- **Store by hit-rate tracking** → LRU-style eviction prioritizing
  recently-accessed prefixes; best cache behavior but needs access
  statistics.
- **Store by Zobrist collision heuristic** (our recommendation) →
  store a checkpoint when the Zobrist hash has been seen ≥ 3 times in
  the last N nodes. This favors prefixes that are **actually reused**
  in the current search.

#### Critical: this is NOT the full snapshot primitive

A checkpoint in track 5A is **still replay-based**. The "state" we
store in the checkpoint pool is the *action prefix* plus any cheap
metadata (Zobrist hash, node index). When we "restore" a checkpoint,
we still run `replayActions(prefix)` through the forward-only ocgcore
engine. The savings come from **amortization**: if the prefix is
10 actions and we hit the checkpoint 5 times, we replay 50 actions
total instead of 50 × 10 = 500 if we re-forked from root.

**This gives 3-10× in realistic DFS search trees** because the
top-of-tree prefixes are heavily reused.

**Important**: once snapshot (track 1B) lands, replay cache becomes
*redundant* (the snapshot primitive is strictly better). Track 5A is a
bridge, not a destination — but a genuinely useful bridge because it
ships independently and produces lift today.

#### Shared structure with the Transposition Table

The TT already uses Zobrist-keyed caching at `SELECT_IDLECMD` prompts
(per CLAUDE.md constraint 3.1). The replay cache would use the **same
Zobrist keys** but store different values:

- TT stores `(score, best_action, depth)` — the evaluated result of
  the subtree rooted at this state.
- Replay cache stores `(action_prefix, path_length, last_action_index)`
  — the cheapest way to reconstruct this state.

**Architectural recommendation**: **separate data structures, shared
key discipline**. The TT and replay cache compete for budget in
different ways (TT is hit-rate bound, replay cache is path-length
bound) and benefit from independent eviction policies. A unified "one
big cache" is tempting but forces them to evict each other prematurely.

However, the **Zobrist hash function must be identical** across both
caches. Currently `InterruptionScorer` / `StateHasher` uses one hash
strategy that was explicitly gated to IDLECMD for TT correctness; the
replay cache should piggyback on this same function with the same
gating, so any limitation the TT respects also bounds the replay
cache (no phantom collisions from chain-mid state).

### 3. Checkpoint Strategy — A Hybrid View

The Simics simulator literature documents **differential checkpoints**:
each checkpoint stores only the delta from its parent, and a chain of
checkpoints can reconstruct any historical state by walking back and
replaying differences. This is an interesting intermediate design
between full snapshots and pure replay.

**Is it useful for us?** Analysis:

- **Pure snapshot (track 1B)** — store full memory per checkpoint.
  Simple, fast restore, high memory cost.
- **Pure replay cache (track 5A)** — store action prefixes. Very low
  memory, slow restore (still linear in prefix length).
- **Differential snapshots (Simics-style)** — store memory deltas.
  Medium memory, medium restore, complex implementation.

For the YGO solver, **differential snapshots are probably not worth
the complexity**. The linear memory of ocgcore is small enough (tens
of KB to low MB) that full snapshots are cheap in storage, and the
implementation complexity of diff-and-merge logic would dwarf the
memory savings. The recommended hybrid is:

- **Full snapshots at "hot" nodes** (root, depth ≤ 3, nodes visited
  ≥ N times) — fast restore, bounded memory.
- **Replay cache for cold deep nodes** — checkpoint pool with
  action-prefix entries, cheap to store, slower to restore.
- **No differential snapshots** — reserve as a v3 optimization if
  profiling shows snapshot storage is a real bottleneck (unlikely).

Sources:
[Simics Checkpoint — ScienceDirect Topics](https://www.sciencedirect.com/topics/computer-science/simics-checkpoint),
[Optimal Checkpointing Strategy for Real-time Systems (ACM TECS)](https://dl.acm.org/doi/full/10.1145/3603172).

### 4. Integration with the Worker Pool (Piscina)

The solver already uses piscina for its worker pool. The integration
considerations for fork cost fixes:

#### Worker reuse and state cleanup

Piscina reuses workers across tasks to avoid startup overhead — a
worker is initialized once and then runs many tasks. For our solver
this is already the pattern: each worker holds an `OCGCoreAdapter`
instance that is reset between tasks, not thrown away.

**Consequence for track 1B**: the snapshot pool lives **inside the
worker process**, not in the main thread. Each worker has its own
snapshot budget, its own checkpoint pool, and its own LRU eviction.
Workers never share state across the boundary, which means:

- No cross-worker synchronization cost
- Per-worker memory budget must be accounted for (N workers × M
  snapshot memory)
- **Idle worker shutdown** (piscina's default) would discard the
  snapshot pool — bad for cache efficiency. Configure `minThreads`
  equal to max workers to keep the pool warm.

#### Per-worker memory budget

Rough estimate (to be measured empirically):
- OCGCore linear memory: ~1-5 MB per instance (estimate based on
  emscripten default initial memory + runtime growth)
- Snapshot pool: 10-50 snapshots per worker × ~1-5 MB each =
  10-250 MB per worker
- Replay cache: negligible (action-prefix arrays are ~KB each, even
  thousands of entries are small)

Total per-worker memory ceiling: **~300 MB worst case, ~50 MB
typical**. At 4 workers this is 200 MB-1.2 GB, well within a modern
desktop Node process.

**Action item**: the snapshot pool needs a **hard byte budget**
(`maxSnapshotBytes` parameter) with LRU eviction, not just a count
limit. Pool sizing is a tuning parameter that should respond to
available memory.

Sources:
[Piscina — GitHub](https://github.com/piscinajs/piscina),
[Learning to Swim with Piscina — Nearform](https://nearform.com/insights/learning-to-swim-with-piscina-the-node-js-worker-pool/),
[Piscina Introduction](https://piscinajs.dev/).

### 5. Failure Modes and Fallbacks

The integration contract must handle failures gracefully. The failure
modes are:

#### FM-1: Snapshot restore produces inconsistent state

Cause: JS-side state coordination bug in the forked wrapper, not all
derived state was correctly invalidated. Symptom: silent divergence
from what replay-based fork would have produced.

Detection: **replay verification as a sanity check**. For the first
K uses of a snapshot, run both `restore(snapshot)` and
`replayActions(actionHistory)` and compare resulting Zobrist hashes.
If they disagree, the snapshot path is incorrect — fall back to
replay and log.

Mitigation: keep the replay path in production as a **correctness
fallback** for at least one full development cycle after snapshot
lands. Snapshot is the fast path, replay is the slow-but-trusted
path.

#### FM-2: Snapshot memory limit exceeded

Cause: snapshot pool grows too large, node process hits OOM.

Detection: track `process.memoryUsage()` before each snapshot
insertion, compare against a configurable ceiling.

Mitigation: aggressive LRU eviction, with a hard `maxSnapshotBytes`
limit. Fall back to replay when the pool is full, rather than
crashing.

#### FM-3: Snapshot schema mismatch across ocgcore versions

Cause: `cards.cdb` refresh changes script behavior; a snapshot taken
against the old version restored into the new version produces stale
behavior.

Detection: `schemaVersion` field on the token. If the version
mismatches the current wrapper version, refuse to restore.

Mitigation: **invalidate the entire snapshot pool on ocgcore version
change** (section 7). This is a cheap operation because version
changes are rare.

#### FM-4: Replay cache Zobrist collision

Cause: two different action prefixes produce the same Zobrist hash
(birthday paradox on 64-bit hash ≈ probability 1 in 4 billion per
pair at 4M entries). Very rare but not impossible.

Detection: store `(actionPrefix, hash)` not just `hash` in the cache;
on lookup, verify the stored prefix matches before trusting the
cached state.

Mitigation: on collision, treat it as a miss and re-checkpoint.

### 6. Invalidation and Versioning

Any caching layer needs **explicit invalidation rules** when the
underlying state model changes. For fork cost fixes, the invalidation
triggers are:

| Event | TT | Replay cache | Snapshot pool |
|-------|----|--------------|---------------|
| Solve starts | Clear | Clear | Keep (if same ocgcore version) |
| Solve ends | Keep (for cross-solve reuse) | Clear | Keep |
| Adapter reset | Clear | Clear | Clear |
| `cards.cdb` update | Clear | Clear | Clear (schemaVersion mismatch) |
| ocgcore-wasm version bump | Clear | Clear | Clear (schemaVersion mismatch) |
| Worker respawn | Clear (per-worker) | Clear | Clear |

The key architectural insight: **snapshots survive across solves**
within the same worker lifetime, because the worker holds the pool.
This means hot snapshots (root + early-game states of common meta
decks) get warm naturally after a few solves, without any explicit
warm-up step. Cold snapshots are evicted under LRU pressure.

### 7. Invariants the Integration Must Preserve

The existing solver has several correctness invariants that any fork
cost fix must not break:

- **Replay verifiability** (Story 1.8, constraints doc 4.2) —
  `verifyMainPath()` replays the recommended line on a fresh duel
  post-solve. The verification path is **not** allowed to use
  snapshots, because that would be circular (verifying the snapshot
  with itself). Verification always uses the canonical replay path.
- **TT gating to IDLECMD** (constraints doc 3.1) — the existing TT is
  gated because chain-mid states collapse to the same Zobrist hash.
  The replay cache **inherits this gating** — checkpoints are stored
  only at IDLECMD boundaries.
- **Lock contract** — the animation layer's lock discipline is
  orthogonal to search (it runs in the main thread), but the worker
  process must not leak state between solves. Snapshot pool
  lifetime is scoped to the worker, not the individual solve.
- **Determinism** (constraints doc 3.3, prerequisite of prior
  research) — fork must produce identical state from identical
  input. Snapshot restore must be **bit-identical** to replay-from-
  scratch for the same action history. This is testable via the
  FM-1 mitigation (comparison mode during initial rollout).

### 8. Key Integration Findings

- **The snapshot primitive is an opaque token pair** (`snapshot()`,
  `restore(token)`) with linear-memory + globals + schemaVersion
  fields. The shape is standardized; the implementation lives in the
  wrapper fork.
- **JS-side state coordination is the critical implementation
  challenge**. The wrapper fork must classify state into read-only
  caches (hoist to singletons), derived-from-memory (invalidate on
  restore), and truly external (include in snapshot token).
- **Replay cache and TT share Zobrist keys but are separate data
  structures**. Eviction policies are independent; the shared key
  discipline ensures no phantom hit from one cache poisoning the
  other.
- **Checkpoint strategy is a hybrid**: full snapshots at hot shallow
  nodes, replay cache at deep cold nodes, no differential snapshots
  (unnecessary complexity at our memory scale).
- **Piscina worker configuration requires `minThreads` tuning** —
  idle worker shutdown would discard the snapshot pool, defeating
  cache warmup across solves.
- **Per-worker memory budget** needs a hard byte cap, not just a
  count cap. Estimated 50-300 MB per worker; hard to predict without
  empirical measurement of ocgcore linear memory size at typical
  search depths.
- **Replay stays as the correctness fallback** until snapshot is
  battle-tested, which means both paths exist simultaneously for at
  least one development cycle.
- **Invalidation on `cards.cdb` update** is a hard rule — snapshots
  taken against different card versions can produce undefined
  behavior.
- **The verification path never uses snapshots** — this is a
  correctness invariant, not a performance trade-off.

## Architectural Patterns and Design — Structuring the Fork Cost Fix

> **Template adaptation note.** "SOLID / microservices / scalability /
> security" is irrelevant to a research topic on internal state cloning
> and cache architecture. This section is re-scoped to the **architectural
> patterns that structure the snapshot + replay cache system** inside the
> existing solver codebase: object pool, tiered cache, strategy pattern,
> adapter, version-keyed invalidation. It closes with a concrete proposed
> architecture for the `OCGCoreAdapter` extension.

### 1. Object Pool Pattern — The Core Primitive

The object pool pattern (Game Programming Patterns, Nystrom) is the
canonical way to reuse expensive-to-create objects. Its properties
match our snapshot pool requirements exactly:

- **Preallocated capacity** — the pool has a fixed maximum size; it
  never grows unboundedly.
- **Reset-on-reuse** — when an object is returned to the pool, it is
  reset to a known clean state. Consumers never rely on themselves to
  reset it.
- **Factory-mediated acquisition** — consumers call `pool.acquire()`
  and `pool.release(obj)`; they never `new` instances directly.
- **Lifetime bound to the pool** — the pool owns the objects; when it
  dies, so do they.

Quote from Game Programming Patterns: *"It is the responsibility of
the Object Pool to reset the object back to a known clean state that
is ready for reuse. You should never rely on the consumers doing this."*

**Application to snapshots**: a `SnapshotPool` preallocates N
`OcgSnapshotToken` slots, each holding a reserved `ArrayBuffer` of
`maxSnapshotBytes`. On `acquire()`, the pool returns a slot and runs
`core.snapshot(slot)` to populate it. On `release(slot)`, the slot
is marked free (no reset needed because snapshots are
write-once-per-slot).

**Why this matters**: without the pool pattern, every snapshot
allocation is a fresh `ArrayBuffer(sizeof(memory))`, and every GC is
a pause. With the pool, allocation is amortized at startup, release
is near-free, and GC pressure drops to zero on the hot path.

Sources:
[Object Pool — Game Programming Patterns (Nystrom)](https://gameprogrammingpatterns.com/object-pool.html),
[Object Pool Pattern — Wikipedia](https://en.wikipedia.org/wiki/Object_pool_pattern),
[Object Pools in C# — alexeyfv](https://alexeyfv.xyz/en/post/2024-12-09-object-pool),
[Object Pool Design Pattern — Java Design Patterns](https://java-design-patterns.com/patterns/object-pool/).

### 2. Tiered Cache Pattern — Hot / Warm / Cold Queues (LRU 2Q)

The naive approach to the snapshot pool + replay cache is a single
LRU list, evicting the least-recently-used entry when the pool is
full. This works but has a **known pathology**: a single bursty
traversal can flush the entire cache, evicting long-lived hot
entries in favor of one-time scan artifacts.

**LRU 2Q** (also called "hot/warm/cold queues") solves this by
partitioning the cache into three tiers:

- **Hot queue** (~10% of capacity) — entries inserted most recently
  and not yet promoted. First-in targets for eviction under pressure.
- **Cold queue** (~30% of capacity) — entries evicted from hot that
  haven't been re-accessed. They stay here briefly; if they're
  touched again, they get promoted to warm.
- **Warm queue** (~60% of capacity) — entries that have demonstrated
  real reuse (hit in cold → promoted to warm). These are the
  "established hot" entries and are the last to be evicted.

The LRU 2Q pattern is used in production caching systems (CacheLib,
Redis variants, Valkey documentation). Its key property: **bursty
one-time scans cannot evict established hot entries**, because the
established entries live in warm which is only reached from cold
re-hits, and a one-time scan only touches hot and cold.

**Application to our case**: DFS traversal is exactly a bursty scan
— a single exhaustive search at a deep subtree can touch thousands
of states that will never be revisited. Without tiered eviction,
these one-shot states would push out the root and early-game
snapshots that **are** revisited across iterations.

**Recommendation**: implement the snapshot pool and replay cache with
LRU 2Q eviction, not plain LRU. The implementation cost difference
is minor (three linked lists instead of one) and the cache hit rate
improvement is significant on search traces.

Sources:
[Cache Replacement Policies — Wikipedia](https://en.wikipedia.org/wiki/Cache_replacement_policies),
[Cache Eviction Policies — GeeksforGeeks](https://www.geeksforgeeks.org/system-design/cache-eviction-policies-system-design/),
[Eviction Policy — CacheLib](https://cachelib.org/docs/Cache_Library_User_Guides/eviction_policy/),
[LFU vs. LRU — Redis blog](https://redis.io/blog/lfu-vs-lru-how-to-choose-the-right-cache-eviction-policy/),
[Key Eviction — Valkey Documentation](https://valkey.io/topics/lru-cache/).

### 3. Strategy Pattern — Multiple Fork Backends

The existing solver has **one way** to fork: `forkViaReplay()`. After
this research lands, there will be **multiple strategies** available:

- `ForkViaReplay` — the current implementation, O(path_length) per
  fork, always correct.
- `ForkViaReplayCache` — replay from the nearest cached checkpoint
  prefix, O(remaining path length) per fork.
- `ForkViaSnapshot` — restore from a snapshot token, O(memory size)
  per fork, independent of path length.
- `ForkViaVerification` — a special mode used during initial snapshot
  rollout (FM-1 mitigation): do both snapshot and replay, verify
  equal, report mismatch. Slow but invaluable for correctness
  validation.

The Strategy pattern handles this cleanly:

```typescript
interface ForkStrategy {
  readonly name: string;
  fork(
    adapter: OCGCoreAdapter,
    actionHistory: readonly OcgAction[],
  ): Promise<OCGCoreAdapter>;
}

class OCGCoreAdapter {
  private forkStrategy: ForkStrategy;

  setForkStrategy(strategy: ForkStrategy): void;

  async fork(): Promise<OCGCoreAdapter> {
    return this.forkStrategy.fork(this, this.actionHistory);
  }
}
```

**Why this is the right abstraction**:

- Strategy selection becomes **a configuration concern**, not a code
  change. Environment variable / solver config flag determines which
  strategy is active.
- Verification mode runs the old strategy alongside the new one, so
  graduation from replay to snapshot is gated on measured equality,
  not on faith.
- Fallback on failure (FM-1, FM-2) reverts to the replay strategy
  without code changes — the fallback is just "switch strategy".
- A/B testing across strategies on the same fixture suite becomes
  trivial.

**Where to inject the strategy**: at `OCGCoreAdapter` construction.
The strategy is per-adapter-instance, which means per-worker in the
piscina pool. Workers can even use different strategies if we want
to measure one vs. the other in parallel.

### 4. Adapter Pattern — Wrapping the Forked Wrapper

`OCGCoreAdapter` is already an adapter (as its name suggests) — it
wraps the `@n1xx1/ocgcore-wasm` API in a domain-shaped interface that
the solver can use. The new primitive (`snapshot()` / `restore(token)`)
is exposed by the forked library at the WASM wrapper level, and the
adapter needs to **surface it without leaking the wrapper's shape to
the solver**.

The pattern:

```typescript
// Internal — the forked wrapper API (not directly used by solver)
interface OcgCoreSnapshotCapable extends OcgCore {
  snapshot(): OcgSnapshotToken;
  restore(token: OcgSnapshotToken): void;
}

// External — what the solver sees
class OCGCoreAdapter {
  private core: OcgCoreSnapshotCapable;   // type-narrowed from OcgCore

  snapshot(): Snapshot | null {
    if (!isSnapshotCapable(this.core)) return null;
    return this.snapshotPool.acquire(this.core);
  }

  restoreFromSnapshot(snap: Snapshot): boolean {
    if (!isSnapshotCapable(this.core)) return false;
    this.core.restore(snap.token);
    this.invalidateDerivedState();
    return true;
  }
}
```

**Why this matters**:

- The solver code above `OCGCoreAdapter` never imports types from
  `@n1xx1/ocgcore-wasm` (fork or upstream). If we later switch to a
  different backend, the solver doesn't notice.
- The `isSnapshotCapable` type guard handles the graceful fallback
  for the period when we're running against un-forked upstream or
  a version mismatch — the solver calls `snapshot()`, gets `null`,
  and falls back to replay.
- The **derived-state invalidation** happens at the adapter level,
  not inside the core. The adapter knows what JS-side caches it
  itself maintains (activation log, pending message queue at the
  adapter level — distinct from the wrapper's internal state) and
  is responsible for invalidating them on restore.

### 5. Version-Keyed Invalidation — Observer Without the Pub/Sub

Caches must be **invalidated when their underlying state model
changes**. For our case the relevant changes are:

- `cards.cdb` update
- `ocgcore-wasm` library version bump
- Lua script refresh from Project Ignis
- Solver config that affects action enumeration

The classic Observer pattern for this is overkill. A simpler and
more robust pattern is a **single versioned invalidation token**:

```typescript
interface EngineVersion {
  ocgcoreVersion: string;      // semver of @n1xx1/ocgcore-wasm (or fork)
  cardsCdbHash: string;        // sha256 of cards.cdb
  scriptsHash: string;         // sha256 of scripts directory
  wrapperSchemaVersion: string; // snapshot format version
}

class SnapshotPool {
  private version: EngineVersion;

  acquire(core: OcgCoreSnapshotCapable): Snapshot {
    return new Snapshot(core.snapshot(), this.version);
  }

  restore(core: OcgCoreSnapshotCapable, snap: Snapshot): boolean {
    if (!versionsMatch(snap.version, this.version)) {
      return false;  // stale snapshot, invalidate silently
    }
    core.restore(snap.token);
    return true;
  }

  onVersionChanged(newVersion: EngineVersion): void {
    this.version = newVersion;
    this.evictAll();
  }
}
```

**Why this is better than Observer**:

- Version mismatch is **self-diagnosing** — a snapshot either matches
  the current version or it doesn't. No callback registration.
- Cross-process validation works (workers can check versions
  independently without inter-process signals).
- "When did this snapshot become stale?" has a deterministic answer.
- A rolling upgrade (worker A running new ocgcore, worker B running
  old) would naturally produce snapshot misses at the boundary,
  which is the correct behavior.

### 6. Separation of Concerns — Module Decomposition

The proposed v1 modules:

```
OCGCoreAdapter (existing)
  ├── core: OcgCore | OcgCoreSnapshotCapable
  ├── forkStrategy: ForkStrategy               (NEW — injected)
  ├── snapshotPool: SnapshotPool | null        (NEW — injected)
  ├── replayCache: ReplayCache | null          (NEW — injected)
  └── actionHistory: readonly OcgAction[]      (existing)

ForkStrategy (NEW — interface + 4 implementations)
  ├── ForkViaReplay              — legacy, always available
  ├── ForkViaReplayCache         — track 5A
  ├── ForkViaSnapshot            — track 1B (requires snapshot-capable core)
  └── ForkViaVerification        — correctness bridge, combines replay + snapshot

SnapshotPool (NEW)
  ├── LRU 2Q eviction (hot/warm/cold queues)
  ├── EngineVersion-keyed invalidation
  ├── Hard byte budget (maxSnapshotBytes)
  └── Worker-local lifetime

ReplayCache (NEW)
  ├── Prefix-to-Zobrist map
  ├── LRU 2Q eviction (separate from snapshot pool)
  ├── Shared Zobrist hash with TT (but separate storage)
  └── Worker-local lifetime

EngineVersion (NEW)
  ├── Computed once per worker startup
  ├── Used as invalidation key across both caches
  └── Static for the lifetime of a worker
```

**File layout proposal**:

```
duel-server/src/solver/adapter/
├── ocgcore-adapter.ts                  (existing — modified)
├── fork-strategy.ts                    (NEW — interface + strategies)
├── fork-via-replay.ts                  (NEW — extracted from current fork())
├── fork-via-replay-cache.ts            (NEW)
├── fork-via-snapshot.ts                (NEW)
├── fork-via-verification.ts            (NEW)
├── snapshot-pool.ts                    (NEW)
├── replay-cache.ts                     (NEW)
├── lru-2q.ts                           (NEW — shared utility)
└── engine-version.ts                   (NEW)
```

**Key design decisions**:

1. **Strategy is per-adapter, not per-solve**. The worker picks a
   strategy at startup based on capability detection and config.
2. **Caches are per-worker**, owned by the adapter, not module-level
   singletons. This means each worker has its own memory budget and
   eviction behavior — good for piscina isolation.
3. **LRU 2Q is implemented once** as a shared utility and reused by
   both the snapshot pool and the replay cache. Do not duplicate the
   eviction logic.
4. **The engine version is a runtime capability, not a compile-time
   constant** — it's computed from hashes at worker startup, so a
   `cards.cdb` update only needs a worker restart, not a rebuild.
5. **`ForkViaVerification` is a temporary strategy** used during the
   initial rollout of `ForkViaSnapshot`. It is expected to be removed
   (or kept only as a debug mode) once snapshot has proven correct
   on the fixture harness.

### 7. Interaction with the Existing TT

The transposition table (TT) is already keyed by Zobrist hash. The
new replay cache uses the same hash function with the same
IDLECMD-only gating (per constraint 3.1). This raises the question:
**should they share storage?**

**Answer: no.** They serve different purposes and have different
access patterns:

- **TT**: read-dominated; every node of the search queries it;
  entries are ~32 bytes (score, best action index, depth, flags);
  sized for CPU cache efficiency.
- **Replay cache**: write-then-restore; entries are action-prefix
  arrays (KB-size potentially); used on fork, not on selection.

Sharing storage would force both into the same eviction policy and
the same memory budget, which is a false economy. The **only** thing
they should share is:

- The Zobrist hash function (`StateHasher`)
- The IDLECMD gating rule
- The invalidation triggers

This is "shared key discipline, separate storage" — a well-known
pattern in chess engines (Stockfish has separate pawn hash, king
safety hash, material hash, and main TT, all keyed by different
subsets of the same Zobrist key space).

### 8. Proposed v1 Architecture — Pulling It Together

Synthesizing the patterns:

**Core structural change**: `OCGCoreAdapter` is extended with an
injected `ForkStrategy` and optional `SnapshotPool`/`ReplayCache`.
Existing code paths are preserved; new strategies plug in via the
interface.

**Startup flow**:

```
worker_startup:
    1. Load ocgcore-wasm (forked or upstream)
    2. Compute engineVersion (hash cards.cdb + scripts)
    3. Detect snapshot capability via isSnapshotCapable(core)
    4. If snapshot-capable AND verification_mode:
         strategy = ForkViaVerification(snapshot, replay)
       else if snapshot-capable:
         strategy = ForkViaSnapshot
       else if replay_cache_enabled:
         strategy = ForkViaReplayCache
       else:
         strategy = ForkViaReplay
    5. Create SnapshotPool with maxBytes / maxEntries from config
    6. Create ReplayCache with maxEntries from config
    7. Return warmed adapter ready for solve()
```

**Solve flow (unchanged at the outside, instrumented inside)**:

```
solve(config):
    adapter = freshFrom(worker.adapter)  // internally uses fork strategy
    ... DFS / MCTS loop ...
    // At every fork point, adapter.fork() dispatches via strategy
    // Strategy consults snapshotPool + replayCache as appropriate
```

**Teardown flow**:

```
worker_teardown:
    snapshotPool.evictAll()
    replayCache.evictAll()
    adapter.dispose()
```

**Config surface** (via `solver-config.json`):

```json
{
  "fork": {
    "strategy": "auto",
    "snapshotPool": {
      "maxBytes": 200000000,
      "maxEntries": 100
    },
    "replayCache": {
      "maxEntries": 5000,
      "checkpointStride": 4
    },
    "verifySnapshots": false
  }
}
```

- `strategy: "auto"` selects the best available at worker startup.
- `strategy: "snapshot" | "replay" | "replayCache" | "verify"`
  forces a specific strategy for A/B testing or fallback.
- `verifySnapshots: true` runs the verification strategy regardless
  of whether it's the default, used during initial rollout.

### 9. Key Architectural Findings

- **Object pool + LRU 2Q** is the right foundation. Preallocated
  capacity with tiered eviction is what production caches use.
- **Strategy pattern** cleanly supports 4 fork backends and
  enables A/B testing and runtime fallback with zero code changes.
- **Adapter pattern** keeps `@n1xx1/ocgcore-wasm` (fork or upstream)
  from leaking into the solver. The snapshot capability detection
  lives inside `OCGCoreAdapter`.
- **Version-keyed invalidation** replaces Observer; it's
  self-diagnosing, cross-worker compatible, and requires no
  subscription machinery.
- **Separation of concerns** — snapshot pool, replay cache, fork
  strategy, engine version are all distinct modules with single
  responsibilities. No god-class adapter.
- **TT and replay cache share key discipline but not storage**.
  This matches the Stockfish pattern for multiple hash tables keyed
  from the same Zobrist space.
- **The v1 architecture is injectable and config-driven**. Every
  strategy can be activated via config, every cache can be sized
  via config, and verification mode is a runtime flag. This makes
  rollout, rollback, and measurement trivial.
- **Snapshot capability is a runtime property, not a compile-time
  dependency**. The solver runs against any ocgcore-wasm version;
  it only uses snapshots when the wrapper exposes them.

## Implementation Research — Roadmap for Fork Cost Resolution

> **Template adaptation note.** "CI/CD / DevOps / team org / cost
> optimization" is irrelevant. This section is re-scoped to the concrete
> implementation path: phased roadmap, measurement strategy, risk
> register, cross-constraint dependencies, effort bands, success metrics,
> and upstream PR strategy.

### 1. Phased Implementation Roadmap

The work splits into **five phases** with strict dependencies between
them. Phase A (measurement) and Phase B (replay cache) are independent
of upstream changes and can ship in a week or two. Phase C (snapshot
primitive) is the larger unblocked but wrapper-fork-dependent block.
Phase D validates and graduates. Phase E runs in parallel in the
background.

#### Phase A — Measurement and Baseline (days)

**Goal**: establish empirical baselines and build a fork cost benchmark
harness so every subsequent optimization produces measurable lift.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| A.1 | Instrument `OCGCoreAdapter.fork()` to emit per-call wall-clock timings (already partially done per observability work) | None |
| A.2 | Build a fork-cost benchmark harness: run a fixed search profile on a curated deck, emit histogram of fork latencies, total fork count, total replay cost | None |
| A.3 | Measure WASM linear memory size at typical search depths (via `core.HEAP8.byteLength`) to estimate snapshot size budget | None |
| A.4 | Confirm 10-17ms/fork figure from constraints doc is still current; document new baseline with method | A.1, A.2 |
| A.5 | Record baseline on top-10 meta fixtures: total solve time, total fork count, total replay ms, ratio of forks-to-scoring | A.2 |

**Exit criterion**: a `pnpm bench:fork` (or equivalent) command that
produces a reproducible baseline report. No optimizations yet —
measurement only.

**Why this phase is mandatory**: every lift claim in subsequent phases
must be validated against a baseline. Without Phase A, we cannot
distinguish "this optimization helped 3×" from "this optimization
broke something and the search terminated earlier".

#### Phase B — Replay Cache (Track 5A, no upstream dependency)

**Goal**: deploy the replay-prefix cache for an immediate 3-10× lift
on fork-heavy searches, without any upstream library changes.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| B.1 | Implement `LRU2Q<K, V>` generic utility (hot / warm / cold queues, configurable tier sizes) | A |
| B.2 | Implement `ReplayCache` on top of `LRU2Q`, keyed by prefix Zobrist hash, storing `(actionPrefix, pathLength, cachedZobrist)` | B.1 |
| B.3 | Define `ForkStrategy` interface, extract current `fork()` logic into `ForkViaReplay` | None |
| B.4 | Implement `ForkViaReplayCache` using `ReplayCache` with the Zobrist-collision-heuristic checkpoint policy (store when prefix seen ≥ 3 times in last N nodes) | B.2, B.3 |
| B.5 | Wire config flag for strategy selection (`strategy: "replayCache"`) | B.4 |
| B.6 | Re-run Phase A benchmark; confirm 3-10× lift on fork-heavy fixtures; document any regressions | B.5 |
| B.7 | Promote `replayCache` as the default strategy when snapshot is not available | B.6 |

**Exit criterion**: benchmark shows ≥ 2× reduction in total fork
replay cost on top 10 meta fixtures, no correctness regressions on
the fixture suite (assuming Phase A of the scorer research — deck
seed determinism — has shipped, otherwise fixture comparison is
unreliable).

**Important**: Phase B is **usable alone** even if Phase C never
ships. The replay cache is a legitimate standalone optimization, not
just a bridge.

#### Phase C — Snapshot Primitive (Track 1B, local wrapper fork)

**Goal**: fork `@n1xx1/ocgcore-wasm` locally, expose `snapshot()` /
`restore()` primitives with correct JS-side state coordination, and
plug it into the solver.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| C.1 | Fork `@n1xx1/ocgcore-wasm` at the current version into `duel-server/vendor/ocgcore-wasm-fork/` (or publish as internal private package) | None |
| C.2 | Audit the wrapper source: enumerate all JS-side state held outside the WASM linear memory. Produce a written classification: read-only / derived-from-memory / truly-external | C.1 |
| C.3 | Hoist read-only caches to module-level singletons (script definitions, card-DB lookups) | C.2 |
| C.4 | Implement `snapshot()`: clone `Memory.buffer` via `slice()`, capture exported globals, build `OcgSnapshotToken` | C.3 |
| C.5 | Implement `restore(token)`: replace the linear memory contents, restore globals via `stackRestore` / direct global writes, invalidate all derived JS state | C.4 |
| C.6 | Implement `SnapshotPool` with LRU 2Q eviction, hard byte budget, `EngineVersion`-keyed invalidation | C.5, B.1 |
| C.7 | Implement `ForkViaSnapshot` strategy | C.6 |
| C.8 | Swap the duel-server dependency from upstream to the local fork | C.5 |

**Exit criterion**: `ForkViaSnapshot` passes a basic smoke test
(score 100 random endboards, compare Zobrist hashes to replay-based
fork results). Benchmark shows ≥ 10× reduction in total fork cost on
deep search fixtures.

**Critical risk in this phase**: C.2 (state classification) is the
hinge. If we miss a JS-side state that needs invalidation, the
resulting snapshot will silently corrupt mid-search state. The FM-1
verification strategy (Phase D) is the mitigation.

#### Phase D — Verification and Graduation (1-2 weeks)

**Goal**: prove snapshot correctness against replay on a large sample,
then graduate from replay-default to snapshot-default.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| D.1 | Implement `ForkViaVerification` strategy: internally call both replay and snapshot paths on every fork, compare Zobrist hashes, log mismatches | C.7, B.3 |
| D.2 | Run verification mode on the full fixture suite + a random search sample (target: 10k fork operations) | D.1 |
| D.3 | Investigate and fix every mismatch. These are **bugs**, not noise — the two strategies should produce bit-identical states | D.2 |
| D.4 | Run verification mode for an extended period (e.g., 3 days of normal solver usage) with zero mismatches | D.3 |
| D.5 | Promote `ForkViaSnapshot` as the default strategy; keep `ForkViaVerification` available via config flag for spot checks | D.4 |
| D.6 | Keep `ForkViaReplay` as the fallback for configurations where snapshot is unavailable | D.5 |

**Exit criterion**: 0 verification mismatches over 10k+ forks on the
fixture suite and an extended random sample, and the config default
flipped from `replay` (or `replayCache`) to `snapshot`.

#### Phase E — Upstream PR (background, low priority)

**Goal**: eventually merge the snapshot primitive into upstream
`@n1xx1/ocgcore-wasm` so we don't maintain a fork indefinitely.

| Step | Description | Prerequisite |
|------|-------------|--------------|
| E.1 | Write a PR description explaining the motivation (search-based use cases), design (opaque token, schema version), and integration contract | C.5 stable |
| E.2 | Open a GitHub Discussion on the upstream repo to gauge receptivity before investing PR effort | C.5 stable |
| E.3 | If receptive, submit the PR with tests and benchmarks | E.2 positive |
| E.4 | Iterate on review feedback | E.3 |
| E.5 | On merge, swap duel-server dep back to upstream | E.4 |

**Exit criterion**: open — this phase may never complete if the
upstream is unresponsive. This is **explicitly acceptable**. The
local fork path does not depend on E.5 for correctness.

**Timeline reality check**: open-source PR timelines vary from days
to years depending on maintainer availability, project pace, and
PR scope. Our PR is a structural addition (new API surface), not a
bug fix, which typically takes longer to review. Plan on 2-6 months
**optimistically**, with a realistic chance of never merging. The
duel-server must be able to ship on the local fork path
indefinitely.

Sources:
[What Happens After You Submit a PR — OpenSauced](https://opensauced.pizza/docs/community-resources/what-happens-after-you-submit-a-pr-to-an-open-source-project/),
[Emscripten Compiler Settings — INITIAL_MEMORY, ALLOW_MEMORY_GROWTH](https://emscripten.org/docs/tools_reference/settings_reference.html),
[Memory Management — Emscripten DeepWiki](https://deepwiki.com/emscripten-core/emscripten/4.2-html5-and-browser-apis).

### 2. Measurement Strategy

#### What we measure

- **Fork latency distribution** — histogram of per-call wall-clock
  times, p50/p90/p99 and max. Current constraints doc cites "10-17ms
  scaling linearly with path length" — this must be validated
  empirically, not assumed.
- **Fork count per solve** — how many fork operations a typical
  solve actually generates. Determines whether total fork cost is the
  dominant budget consumer or if other costs (scoring, enumeration)
  matter too.
- **Replay path length distribution** — how long is the average
  action history at fork time? Determines how much the replay cache
  can save (short paths = less savings from caching).
- **Snapshot size** — `core.HEAP8.byteLength` at typical fork points.
  Determines whether the default emscripten initial heap (often 16 MB)
  is used fully or if most of it is slack. Empirically measured
  typical ocgcore state is likely in the **100 KB - 2 MB** range, but
  this must be confirmed.
- **Cache hit rate** — replay cache hit rate over a full solve.
  Determines whether the checkpoint policy is well-tuned or if it's
  storing unused prefixes.
- **Memory pressure** — peak `process.memoryUsage().heapUsed` during
  solve. Determines whether the snapshot pool budget is realistic or
  needs tightening.

#### How we present it

A single `fork-bench-report.json` artifact per run, with:
- timestamp, git SHA, config
- per-fixture metrics: fork count, fork ms total, fork ms p50/p90/p99,
  replay path length distribution, cache hit rate, snapshot size
- aggregate metrics: total solve time, per-fixture pass/fail

Reports are committed to `_bmad-output/bench/fork-cost/` with
timestamps. A simple diff tool produces before/after comparisons.

**Why this isn't over-engineered**: every optimization claim in this
research needs a measurable delta. Without structured benchmark
artifacts, "this is faster" is a vibe, not a finding. The investment
in measurement infrastructure is a few hours and pays for itself the
first time we commit a regression.

### 3. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **R1** JS-side state classification (Phase C.2) misses a derived field, producing silent corruption | High | High | Phase D verification — bit-identical comparison on 10k+ forks before graduation |
| **R2** Phase C fork is more work than expected (wrapper state is more entangled than it looks) | Medium | High | Phase B is independently valuable; if Phase C stalls, Phase B still delivers 3-10× |
| **R3** Snapshot memory budget is higher than expected (e.g., ocgcore initial heap is 64 MB not 1-5 MB) | Medium | Medium | Hard byte cap on snapshot pool; fewer but larger snapshots still beat replay; measurement in Phase A determines the budget |
| **R4** Upstream maintainer responds negatively to Phase E PR | Medium | Low | Local fork path is self-sufficient; Phase E is optional |
| **R5** Deck seed determinism (cross-constraint 3.3) not shipped — Phase D verification is noisy | Certain unless prereq ships | High | Ship 3.3 fix first (already identified as #1 blocker in prior research); Phase D is gated on it |
| **R6** Fixture harness from scorer research (Phase A.3 of that research) doesn't exist yet — no way to compare correctness | Certain unless prereq ships | High | Ship fixture harness as part of scorer research Phase A or as joint infrastructure |
| **R7** WASM.Memory.buffer.slice() is slower than expected on very large memories | Low | Medium | Measure in Phase A.3; consider structured clone via MessagePort as alternative |
| **R8** Worker pool respawn after crash loses snapshot cache | Low | Low | Accept: snapshot cache is per-worker lifetime by design; rewarm naturally on reuse |
| **R9** Concurrent modification: a second solve begins while the snapshot pool is still being acquired for the first | Low | Medium | Snapshot pool operations are synchronous JS (no await); no concurrent access possible within a worker |
| **R10** Forked wrapper drifts from upstream (bug fixes upstream not back-ported) | Medium | Medium | Track upstream changes via a dedicated local branch; periodic rebase; document in CLAUDE.md |

### 4. Cross-Constraint Dependencies

| Constraint (from constraints doc) | This research | Notes |
|-----------------------------------|---------------|-------|
| **1.1** Node budget | Indirect benefit | More forks per budget → more nodes explored |
| **1.2** Wall-clock timeout | Indirect benefit | Same wall time → more work done |
| **1.3** Fork cost | **Directly addressed** | Core goal of this research |
| **2.1** Move ordering | Orthogonal | Complementary research track |
| **2.2** Scorer fidelity | Orthogonal | Addressed by prior scorer research |
| **2.3** Latent interruption modeling | Orthogonal | Addressed by prior scorer research |
| **3.1** Observed state completeness | Indirect | Snapshot preserves full state including chain queue — may partially relax TT caching restriction |
| **3.2** Terminal classification | Orthogonal | Addressed by prior scorer research |
| **3.3** Deck seed determinism | **Hard prerequisite** | Phase D verification requires reproducible forks |
| **4.1** Data coverage | Orthogonal | — |
| **4.2** Verification and trust | **Enhanced** | Phase D verification strategy directly improves trust in every fork |

**Key dependency**: Phase D verification requires **deterministic
solves**, which means constraint 3.3 must be fixed before Phase D can
run. This is the same prerequisite identified by the prior scorer
research. Both research tracks share this blocker.

**Bonus effect on constraint 3.1**: the existing TT is gated to
IDLECMD prompts because chain-mid states collapse to identical Zobrist
hashes. With a snapshot primitive, we can potentially **extend TT
caching to intermediate chain states** by using a richer cache key
(Zobrist + snapshot content hash). This is not a v1 goal but it is an
interesting downstream possibility that falls out naturally from the
snapshot primitive.

### 5. Effort Estimation

Effort in calendar weeks for a single developer working full-time:

| Phase | Effort Band | Confidence |
|-------|------------|-----------|
| Phase A (Measurement) | 0.5-1 week | High |
| Phase B (Replay cache) | 1-2 weeks | High |
| Phase C (Snapshot primitive + fork) | 3-6 weeks | Medium |
| Phase D (Verification + graduation) | 1-2 weeks | High (assuming Phase C correct) |
| Phase E (Upstream PR) | background, unlimited | — |
| **Total** | **5.5-11 weeks** | Medium |

**Confidence commentary**:
- Phase A is mechanical and bounded; only surprises are measurement
  infrastructure setup.
- Phase B uses well-known patterns (LRU 2Q, prefix caching); the main
  unknown is integration friction with the existing adapter.
- Phase C is the biggest variance. The lower bound (3 weeks) assumes
  the wrapper JS state is cleanly classified. The upper bound (6 weeks)
  assumes classification takes multiple iterations with verification
  failures along the way. A value outside this band is possible if
  the wrapper has surprising structure (e.g., non-trivial Lua-JS
  interop).
- Phase D is fast if Phase C is correct; if it isn't, it blocks on
  debugging and can extend unboundedly.

**Comparison to prior research**:
- Scorer extension research (prior): 6-11 weeks
- Fork cost research (this): 5.5-11 weeks
- **Both can run in parallel** (mostly orthogonal code paths)
- **Combined**: ~8-14 weeks total for a single developer working on
  one at a time, with some parallelism if code areas allow

### 6. Success Metrics

| Metric | Phase A Baseline | Phase B Target | Phase C Target | Phase D Target |
|--------|-----------------|---------------|----------------|----------------|
| Mean fork cost (ms) | Baseline captured | Same (cache doesn't reduce single-fork cost) | ≤ 2ms | ≤ 2ms |
| Mean total replay ms per solve | Baseline captured | ≤ 30% of baseline | ≤ 5% of baseline | ≤ 5% of baseline |
| Fork cache hit rate | N/A | ≥ 60% | N/A | N/A |
| Total solve time on top 10 fixtures (median) | Baseline captured | -20% to -40% | -60% to -80% | -60% to -80% |
| Forks per solve (before effective depth changes) | Baseline captured | Same | Same | Same |
| Effective search depth reached (proxy: distinct Zobrist states visited) | Baseline captured | ×2 to ×5 | ×10 to ×50 | ×10 to ×50 |
| Verification mismatch rate | N/A | N/A | N/A | 0 (hard requirement) |
| Memory usage peak (MB) | Baseline captured | +10 MB | +50-300 MB (per worker) | +50-300 MB |
| Fixture hit rate | Baseline captured | ≥ baseline | ≥ baseline | ≥ baseline |

**The critical graduation metric**: `Total solve time` target ≥ -60%
from baseline on top 10 fixtures. Anything less means the fork cost
fix is not meaningfully unblocking the solver's reach, which is the
whole point of this research.

**The critical correctness metric**: `Verification mismatch rate` of
**zero** before graduating Phase D. This is non-negotiable —
silently corrupt snapshots are worse than slow forks.

### 7. What This Research Does NOT Deliver

Explicit non-goals, so the roadmap is not misread:

- **Does not produce viable meta combo lines** on its own. Without
  the scorer research (latent interruption modeling), the solver
  with cheap forks still converges on the wrong endboards. The two
  research tracks are complementary and must both ship.
- **Does not improve move ordering**. A cheap fork that explores the
  wrong move first is still the wrong move. Move ordering (constraint
  2.1) is an independent track.
- **Does not produce a learned model**. This is explicitly
  out-of-scope per the scope confirmation.
- **Does not produce a fully native (non-WASM) engine**. Native
  bindings (track 2A) remain a fallback option, not a recommendation.
- **Does not guarantee upstream merge**. Phase E is best-effort.
- **Does not replace the existing replay path**. Replay stays as a
  correctness fallback indefinitely.
- **Does not address Epic 2 MCTS specifically**. The fork cost fix
  benefits Epic 2 as much as Epic 1, but no Epic 2-specific work is
  part of this roadmap. When Epic 2 adversarial becomes stable, it
  will automatically benefit from whichever fork strategy is active.

### 8. Joint Execution with the Prior Scorer Research

Both research tracks (scorer + fork cost) share a critical
prerequisite: **deck seed determinism (constraint 3.3)**. Neither can
ship calibration / verification without it. The recommended joint
sequencing:

1. **Fix deck seed determinism** (1 developer-day, unconditional).
2. **Build joint infrastructure**: fixture harness (from scorer
   research) + fork cost benchmark (from this research). These can
   share a test runner and the fixture suite.
3. **Split tracks**: scorer Phase B proceeds on the scoring code
   paths; fork cost Phase B proceeds on the adapter code paths.
   Minimal conflict.
4. **Converge**: once scorer Phase B and fork Phase B both ship, run
   the joint benchmark to see cumulative lift.
5. **Scorer Phase C + Fork Phase C in parallel**: these are
   independent code paths but compete for developer attention.
6. **Joint verification + graduation**.

The combined end state is a solver that produces viable lines on meta
fixtures (scorer), reaches them in reasonable time (fork cost), and
is validated on a shared fixture harness that both research tracks
depend on.

### 9. Key Implementation Findings

- **Five phases**, three of them (A, B, D) short and mechanical, one
  (C) the significant development block, one (E) background best-effort.
- **Phase B is the immediate quick win** — 3-10× lift without any
  upstream dependency, usable standalone.
- **Phase C is the 10-50× step** — requires wrapper fork + JS state
  classification, which is the critical risk point.
- **Phase D correctness bridge is mandatory** — zero-tolerance on
  verification mismatches before snapshot becomes default.
- **Phase E is acceptable to skip** — local fork is a sustainable
  long-term state; upstream merge is a nice-to-have.
- **Effort band 5.5-11 weeks** with medium confidence; comparable to
  the prior scorer research.
- **Deck seed determinism (constraint 3.3) is the shared prerequisite**
  with the scorer research; fixing it unblocks both.
- **Joint execution is possible and recommended** — the two research
  tracks are mostly orthogonal code paths and can share measurement
  infrastructure.
- **The success metric is `total solve time ≥ -60%`**, not raw fork
  cost. Users experience solve time, not fork latency.
- **The correctness metric is `verification mismatch = 0`**, not
  "close enough". There is no such thing as a "mostly correct"
  snapshot.

Sources:
[Emscripten Compiler Settings — Memory Settings](https://emscripten.org/docs/tools_reference/settings_reference.html),
[Memory Management — Emscripten DeepWiki](https://deepwiki.com/emscripten-core/emscripten/4.2-html5-and-browser-apis),
[What Happens After You Submit a PR — OpenSauced](https://opensauced.pizza/docs/community-resources/what-happens-after-you-submit-a-pr-to-an-open-source-project/).

---

# Research Synthesis — Executive Summary and Strategic Recommendations

> **Template adaptation note.** Same adaptation as the prior research —
> generic "security / scalability / competitive advantage / future
> innovation" sections are dropped in favor of an executive summary, a
> cross-cutting TOC, consolidated findings, a concrete action checklist,
> and explicit joint-execution guidance with the prior scorer research.

## Executive Summary

The skytrix combo solver's `OCGCoreAdapter.fork()` currently delegates
to `forkViaReplay()` because `@n1xx1/ocgcore-wasm` v0.1.1 exposes no
native state snapshot primitive. At 10-17ms per fork, scaling linearly
with path length, the solver's absolute fork ceiling at the 5000ms
fast-mode budget is ~333 forks — before counting action enumeration,
scoring, Zobrist hashing, or transposition-table lookups. Meta combo
lines are 15-25 actions long and the branching factor is 5-20 at main
phase prompts, which means the current fork budget is the dominant
physical ceiling on what the solver can explore. Constraint 1.3 is one
of the three top blockers identified in the structural constraints
doc, alongside latent interruption modeling (addressed by
[the prior scorer research](./technical-pre-dl-latent-board-value-evaluation-research-2026-04-13.md))
and move ordering (not yet addressed).

The research surveyed **four parallel tracks** — WASM state cloning
primitives, OCGCore ecosystem alternatives, fork-avoiding MCTS
patterns, and replay caching — and found that **only two of them
produce meaningful fork cost reductions**. The MCTS parallelization
literature (Chaslot & Winands 2008; virtual loss; lock-free
algorithms) assumes cheap state cloning as an implicit premise and
offers no direct solution for expensive state. Make/unmake, the
canonical chess engine pattern for avoiding state cloning, is
**architecturally impossible** on ocgcore because the engine is
forward-only, the Lua script runtime has untrackable side effects,
and no undo API exists. The only paths to ≥ 10× fork cost reduction
run through **WASM linear memory snapshots** — the byte-level
equivalent of make/unmake — which requires coordinating the forked
wrapper's JS-side state with the snapshotted linear memory. Replay
caching with a Zobrist-keyed checkpoint pool provides a complementary
3-10× lift and, importantly, **does not depend on any upstream or
fork changes**, so it can ship as a standalone optimization.

The research produces a **concrete five-phase roadmap**. Phase A
(measurement, 0.5-1 week) instruments the current fork cost and
builds a benchmark harness. Phase B (replay cache, 1-2 weeks)
deploys the Zobrist-keyed prefix cache with LRU 2Q eviction —
immediate, no dependencies, usable standalone. Phase C (snapshot
primitive, 3-6 weeks) forks `@n1xx1/ocgcore-wasm` locally, classifies
the wrapper's JS-side state into read-only / derived / external
buckets, implements `snapshot()` / `restore()` at the wrapper level,
and plugs in a `SnapshotPool` with LRU 2Q eviction and
`EngineVersion`-keyed invalidation. Phase D (verification and
graduation, 1-2 weeks) runs a bit-identical comparison between the
snapshot path and the replay path on 10,000+ forks before flipping
the default strategy. Phase E (upstream PR, background) is optional
and potentially indefinite — the local fork path is sustainable
without it.

The architecture is built on five patterns: the **object pool** for
snapshot slot preallocation, the **tiered LRU 2Q cache** for eviction
that resists bursty one-shot scans, the **strategy pattern** for
selectable fork backends (replay / replayCache / snapshot /
verification), the **adapter** to hide the forked wrapper's type
surface from the solver, and **version-keyed invalidation** for
cross-worker correctness without observer/pub-sub machinery.
`OCGCoreAdapter` is extended with injected strategy and caches;
existing code paths are preserved; new strategies plug in via a single
interface. Config surface is a runtime capability flag with a
verification mode for initial rollout.

**Key Technical Findings:**

- **The MCTS literature does not solve fork cost.** It assumes cheap
  state cloning as a premise. Virtual loss, lock-free trees, and root
  parallelization give marginal gains (20-40% or none) rather than
  orders of magnitude.
- **Make/unmake is architecturally unavailable for ocgcore.** The
  engine is forward-only, the Lua runtime holds untrackable side
  effects, and no undo API exists. This is a hard constraint, not a
  cost-benefit trade-off.
- **Only WASM memory snapshots produce 10-50× reductions.** They work
  at the byte level (restore raw memory) rather than the message
  level (unmake an action). The critical implementation challenge
  is coordinating the forked wrapper's JS-side state with the
  snapshotted linear memory.
- **Replay caching is the immediately deployable quick win.** It
  produces 3-10× lift via prefix reuse and does not depend on any
  upstream changes. It also becomes redundant once snapshot ships,
  so it is a bridge, not a destination — but a genuinely useful
  bridge.
- **LRU 2Q tiered eviction is important, not optional.** DFS bursty
  traversal would flush plain-LRU caches of their established hot
  entries. Hot / warm / cold queues are the production-grade
  solution.
- **The JS-side state classification in Phase C.2 is the hinge risk**.
  Missing one derived field produces silent corruption, mitigated by
  the Phase D bit-identical verification gate.
- **Deck seed determinism (constraint 3.3) is the shared prerequisite**
  with the scorer research. Fixing it unblocks both tracks and must
  ship first regardless of anything else.

**Strategic Recommendations:**

1. **Ship Phase B (replay cache) as the immediate quick win**,
   regardless of whether Phase C is ever executed. It is
   self-sufficient, produces measurable lift, and requires no
   upstream cooperation.
2. **Commit to the local-fork path for Phase C**, not the upstream PR
   path. Upstream PR is valuable but indefinitely long; the local
   fork is maintainable and unblocks our timeline.
3. **Do not skip Phase D verification**. The 10,000-fork
   bit-identical comparison is not optional — silently corrupt
   snapshots are worse than slow forks. This is a zero-tolerance
   correctness gate.
4. **Run this research jointly with the prior scorer research**.
   They share the deck seed determinism prerequisite, the fixture
   harness infrastructure, and the code review bandwidth. Orthogonal
   code paths allow parallel execution.
5. **Do not pursue native Node.js bindings or alternative engines as
   first-line options**. They are documented as emergency fallbacks
   only. The cost/risk profile is disproportionate.
6. **Plan for the local fork to exist indefinitely**. Phase E is
   background effort. If the upstream merge never happens, the local
   fork is a sustainable long-term state; document it in CLAUDE.md
   and track upstream via periodic rebase.

## Table of Contents

| Section | Content | Primary question answered |
|---------|---------|---------------------------|
| Research Overview (top) | Problem definition, scope, explicit out-of-scope | Why do we care about fork cost and what's not in scope? |
| Technical Research Scope Confirmation | Topic, goals, methodology, inputs | What did we commit to investigate? |
| Technology Stack Analysis — Fork Cost Landscape | 4-track survey: WASM primitives, OCGCore ecosystem, MCTS patterns, make/unmake | What solutions exist, what's applicable, what isn't? |
| Integration Patterns Analysis | Snapshot contract, JS-side coordination, replay cache integration, worker pool, failure modes, invalidation | How do the chosen tracks plug into the existing solver? |
| Architectural Patterns and Design | Object pool, LRU 2Q, strategy, adapter, version-keyed invalidation, **v1 architecture proposal** | How is the solution structured internally? |
| Implementation Research | 5-phase roadmap, measurement, risk register, cross-constraint deps, effort bands, joint execution | What concrete steps produce a working deliverable? |
| Research Synthesis (this section) | Executive summary, consolidated findings, action checklist | What do we actually do? |

## Consolidated Findings by Theme

### Findings on the Problem Structure

- **Fork cost is a physical constraint, not a semantic one.** It
  limits *reach*, not *direction*. A perfect scorer with a 333-fork
  ceiling still cannot find meta combos.
- **The cost scales with path length**, not with search depth. This
  makes long combo lines (which is exactly what we want to discover)
  disproportionately expensive.
- **Fork cost is one of three top blockers** per the constraints doc.
  Each of the three alone is sufficient to prevent viable output,
  and each requires its own solution. The three tracks are
  mutually reinforcing — a cheap fork that explores the wrong move
  first is still the wrong move.

### Findings on the Technical Landscape

- **The MCTS parallelization literature is not directly applicable.**
  Virtual loss, lock-free trees, and root parallelization address
  inter-thread coordination, not per-thread fork cost. They are
  valuable *after* state cloning is cheap.
- **Make/unmake is the chess pattern**, but it is architecturally
  unavailable for ocgcore because the engine is forward-only with
  untrackable Lua side effects. There is no path to a message-level
  undo API.
- **WASM memory snapshots are the byte-level equivalent of
  make/unmake.** They produce make/unmake-style efficiency without
  requiring the engine to support undo.
- **Replay caching is a legitimate standalone optimization**, not
  just a bridge. Its 3-10× lift is produced by prefix amortization,
  which is independent of any other fix.
- **The OCGCore ecosystem has one meaningful upstream**
  (`edo9300/edopro` → `@n1xx1/ocgcore-wasm`) and no alternative
  bindings with exposed snapshot primitives. We must engage with
  this stack directly, either via upstream PR or local fork.
- **Alternative engines (knight00/ocgcore-KCG, native bindings) are
  emergency fallbacks**, not first-line options. The cost of
  switching ecosystems is disproportionate to the gains.

### Findings on Integration

- **The snapshot API is an opaque token pair** — `snapshot()` returns
  a token, `restore(token)` replaces the state. Caller never inspects
  the token's internals.
- **The snapshot token must include both linear memory and exported
  globals.** Emscripten-built WASM modules have globals outside the
  linear memory that capture the stack pointer and heap base — these
  must be restored via `stackRestore` or direct global writes.
- **The forked wrapper must classify its JS-side state** into
  read-only caches (hoist to singletons), derived-from-memory
  (invalidate on restore), and truly-external (include in token).
  This classification is the core implementation work.
- **The replay cache and the existing TT share Zobrist key discipline
  but not storage.** Different access patterns (read-dominated vs.
  write-then-restore) mean shared storage is a false economy.
- **Snapshots are per-worker**, stored in a pool owned by the
  `OCGCoreAdapter` instance. Piscina workers do not share snapshot
  pools; the snapshot cache warms naturally across solves in the
  same worker lifetime.
- **Version-keyed invalidation** replaces Observer/pub-sub. A
  snapshot stores `EngineVersion` at capture time; restore rejects
  mismatched versions silently. Self-diagnosing, cross-worker
  compatible.

### Findings on Architecture

- **Object pool preallocates snapshot slots** to eliminate GC
  pressure on the hot path. Slots are reset-on-reuse (trivial for
  snapshots since they're write-once).
- **LRU 2Q** (hot / warm / cold queues) protects established hot
  entries from bursty DFS traversal. Used by CacheLib, Redis
  variants, Valkey in production.
- **Strategy pattern** cleanly supports 4 fork backends (replay,
  replayCache, snapshot, verification) and enables A/B testing,
  runtime fallback, and configuration-driven selection.
- **Adapter pattern** hides the forked wrapper's types from the
  solver. `isSnapshotCapable()` type guard enables graceful fallback
  when running against the unforked upstream.
- **Separation of concerns** — adapter, strategy, snapshot pool,
  replay cache, engine version are distinct modules with single
  responsibilities. Per-worker ownership aligns with piscina's
  isolation model.
- **Interaction with the existing TT is "shared key discipline,
  separate storage"** — the Stockfish pattern for multiple hash
  tables keyed from the same Zobrist space. The existing IDLECMD
  gating is inherited by the replay cache.

### Findings on Implementation

- **Five-phase roadmap** (Measurement / Replay Cache / Snapshot /
  Verification / Upstream PR) with dependencies and effort bands.
- **Phase B is deployable today.** 1-2 weeks of work for 3-10× lift,
  no upstream dependency. It is the immediate ROI and can ship
  before Phase C even starts.
- **Phase C is the 10-50× step** but also the highest variance.
  3-6 weeks estimate, dominated by the wrapper's JS-side state
  classification work.
- **Phase D verification is a zero-tolerance gate.** Any mismatch is
  a bug to be fixed, not noise to be averaged out. 10,000+ forks
  bit-identical before graduation.
- **Phase E upstream PR is acceptable to skip.** Local fork is
  sustainable indefinitely; upstream merge is a nice-to-have.
- **Total effort 5.5-11 weeks** for a single developer working
  full-time on this research alone.
- **Deck seed determinism (constraint 3.3) is the shared prerequisite**
  with the scorer research. It must ship first.

## Joint Execution with the Prior Scorer Research

Both research tracks share:

- **The same prerequisite** — deck seed determinism (1 developer-day,
  unconditional).
- **The same fixture harness** — built once, used by both for
  regression testing.
- **The same success criterion** — "functional" means viable lines
  on ≥ 60% of top 10 meta fixtures, which requires both the scorer
  fix (find the right endboard) and the fork cost fix (reach it in
  reasonable time).
- **Mostly orthogonal code paths** — scorer research modifies
  `InterruptionScorer`; this research modifies `OCGCoreAdapter`.
  Conflict is limited to shared Zobrist key discipline.

**Recommended joint sequencing**:

1. **Week 0** — Ship deck seed determinism (both researches).
2. **Week 0-1** — Build joint infrastructure: fixture harness + fork
   cost benchmark. These share a test runner.
3. **Weeks 1-3** — Run scorer Phase B (latent extension) and fork
   cost Phase B (replay cache) in parallel. Both deliver
   independently valuable lift.
4. **Weeks 3-5** — Converge: run joint benchmark on top 10 fixtures
   with both optimizations active. Measure cumulative impact.
5. **Weeks 5-11** — Scorer Phase C (calibration) and fork cost Phase
   C (snapshot primitive) in parallel where bandwidth permits.
   Sequential where it doesn't.
6. **Weeks 11-13** — Joint Phase D: scorer calibration validation +
   fork cost verification graduation.

**Combined end state**: a solver that finds viable combo lines on
meta decks (scorer research) and reaches them in reasonable time
(this research), validated on a shared fixture suite built on
deterministic solves.

**Total combined effort**: **~10-15 weeks** for a single developer
working primarily on one track at a time with minor parallelism.

**Caveat**: this does not include constraint 2.1 (move ordering) —
still unaddressed. A truly viable solver requires all three tracks
to ship. The constraints doc is explicit on this point.

## Cross-Research Coupling

| Axis | This research | Scorer research | Move ordering research (future) |
|------|---------------|-----------------|---------------------------------|
| **Primary constraint addressed** | 1.3 fork cost | 2.2 + 2.3 + 3.2 | 2.1 |
| **Shared prerequisite** | 3.3 deck seed | 3.3 deck seed | 3.3 deck seed |
| **Fixture harness** | Consumes | Produces | Consumes |
| **Benchmark harness** | Produces | Consumes | Consumes |
| **Correctness gate** | Phase D verification | Phase C calibration | N/A (depth-based) |
| **Effort band** | 5.5-11 weeks | 6-11 weeks | Unknown (future research) |
| **Default strategy at v1 ship** | `replayCache` (Phase B) | Inspection-seeded latent | Not addressed |

## Action Checklist — Next 2 Weeks

Converting research into work, assuming joint execution with the
scorer research:

| # | Action | Phase | Rationale |
|---|--------|-------|-----------|
| 1 | Review and approve this research document | — | Gate for the rest |
| 2 | Review and approve the prior scorer research document (if not already) | — | Joint execution requires both approved |
| 3 | Ship deck seed determinism (shared Phase A.1) | Joint prereq | Unconditional blocker for both researches |
| 4 | Build fixture harness (shared Phase A.2) | Joint prereq | Single source of truth for regression on both axes |
| 5 | Build fork cost benchmark harness (Phase A for this research) | Phase A | Measurement infrastructure for this track |
| 6 | Extract `DirectScorer` + `ForkViaReplay` in parallel | Phase A (both) | Mechanical refactors, no behavior change |
| 7 | Spike Phase B for both researches in parallel (latent considerations + LRU 2Q) | Phase B (both) | Both are low-risk and deliver standalone lift |

Everything beyond this list is Phase B+ work for both tracks,
scheduled after the shared foundation is in place.

## What This Research Does NOT Promise

Repeated for emphasis:

- **Viable combo lines on meta decks.** Requires scorer research
  plus move ordering research plus this research, together. None
  alone is sufficient.
- **A learned value function.** Out of scope; explicit non-goal.
- **A full replacement of `@n1xx1/ocgcore-wasm`.** Local fork is the
  recommended path; upstream merge is optional.
- **A new engine (native bindings, alternative bindings).** These
  are documented fallbacks, not recommendations.
- **A guaranteed Phase E merge.** Upstream PR timeline is inherently
  uncertain; local fork is the stable long-term state.
- **Protection against ocgcore internal bug fixes.** If upstream
  patches a bug in the engine, the local fork must be rebased to
  pick it up. Document this maintenance overhead in CLAUDE.md.
- **Improvements to Epic 2 MCTS specifically.** The fork cost fix
  benefits Epic 2 automatically, but no Epic 2-specific work is
  part of this roadmap.

## Research Methodology Notes

This research used **multi-track inventory** as its primary method:
surveying four parallel approaches to the same problem and evaluating
each for applicability, effort, risk, and licensing. The deliberate
goal was to avoid committing prematurely to a single approach without
first establishing the full option space.

**Sources span**:

- **WebAssembly runtime**: Emscripten documentation, MDN WebAssembly
  reference, WebAssembly proposals (bulk memory, threads), Mozilla
  bugzilla discussions, web.dev articles.
- **OCGCore ecosystem**: edo9300/edopro GitHub, ProjectIgnis JSR
  package, knight00/ocgcore-KCG fork, community forums.
- **MCTS parallelization**: Chaslot/Winands 2008, Mirsoleimani/Plaat
  2017, Enzenberger/Müller 2010, Steinmetz/Gini 2020, MCTS review
  literature.
- **Chess engine patterns**: Chess Programming Wiki (Alpha-Beta,
  Unmake Move, PSTs, Lazy Evaluation), TalkChess forum discussions,
  Stockfish documentation.
- **Caching and eviction**: Game Programming Patterns (object pool),
  CacheLib documentation, Redis/Valkey eviction policies,
  Chessprogramming Wiki on hash tables.
- **Worker pools**: Piscina documentation, Nearform engineering
  blog, Node.js threads discussion.
- **Open-source workflow**: OpenSauced contributor guide, PR review
  best practices.

**Confidence levels**:

- **High**: claims about existing open-source projects, published
  MCTS literature, chess engine patterns — well-established and
  verified against multiple sources.
- **Medium**: claims about how the patterns transpose to our
  codebase — informed analogies, not tested.
- **Low**: effort estimates, cache hit rate predictions, snapshot
  size budget, Phase E timeline — empirical guesses to be
  validated in Phases A/D.

**Every claim in this document is either**:

- Cited to a public source, or
- Derived from the constraints doc / CLAUDE.md / existing solver code, or
- An explicit synthesis marked as such.

## Research Conclusion

**The recommended path is Phase B + Phase C executed jointly with
the prior scorer research.** Phase B produces a standalone 3-10× lift
that unblocks immediate work; Phase C targets the 10-50× step via
local wrapper fork. Both are bounded in effort, have clear exit
criteria, and do not depend on upstream cooperation.

This research does not promise a complete solver — it promises to
address the fork cost ceiling that is one of the three top blockers
on meta deck viability. Scorer fidelity (addressed by the prior
research) and move ordering (not yet addressed) remain complementary
tracks. The constraints doc is explicit that all three are required
for "functional" output, and this document is explicit that any one
of them alone is insufficient.

**Next concrete step**: execute the shared deck seed determinism fix
(constraint 3.3) this week as a stand-alone quick fix, then convene
to review both research documents as a joint plan and commit to
joint Phase A infrastructure (fixture harness + fork cost benchmark)
as a single foundation block.

---

**Technical Research Completion Date:** 2026-04-13
**Research Period:** single-session comprehensive technical analysis
**Source Verification:** all technical claims cited with public
  sources or internal project files
**Technical Confidence Level:** High on landscape, Medium on
  transposition, Low on effort estimates
**Next Research Tracks:** move ordering (constraint 2.1) — the third
  and final blocker from the constraints doc

_This comprehensive technical research document serves as the reference
blueprint for resolving the fork cost ceiling in the skytrix combo
solver, via a combination of Zobrist-keyed replay caching and WASM
memory snapshot primitives exposed through a locally-forked
`@n1xx1/ocgcore-wasm` wrapper._
