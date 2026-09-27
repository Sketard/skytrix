# Moteur de duel — chaîne

**Lecture** : les événements de chaîne, la machine d'état `chainPhase` et la synchro du plateau après coût ; texte de
l'ancien `CLAUDE.md`, déplacé tel quel (en anglais) le jour de l'adoption du plugin `workbench`. Index du moteur de duel
: [`README.md`](README.md). Se lit par sections : `Grep "^## "`, puis `Read` par plage.

## Sommaire

1. Chain Event Processing & State Machine

## Chain Event Processing & State Machine

`DuelEventProcessor` is the single source of truth for chain state
management (activeChainLinks, chainPhase, animation queue, chain entry
commit). Ownership rules (γ-c PR2 c8, 2026-05-29) :

- **PvP normal** : the `DuelWebSocketService` ctor builds a default
  `DuelConnection` which owns its processor outright. Lifetime = the
  wsService's component scope.
- **SOLO multiplex** : `SoloDuelOrchestratorService.init` builds ONE
  `DuelConnection` (mono-conn, post-c6a) which owns its processor
  outright, then swaps it into the wsService via `bindSoloConnection`.
  Both perspectives are projected from the same `_slots[0|1]` on this
  SAME conn — the cardinal γ invariant that eliminates the
  `bug-solo-sequence.md` chain-orphan bug structurally (a
  `switchPerspective` no longer routes future messages to a different
  processor — there is only one). The default conn built by the
  wsService ctor is orphaned and `cleanup()`-ed by `bindSoloConnection`.
- **Replay** : `MockDuelConnection` owns its processor outright (separate
  scope, no SOLO/PvP interaction). γ does not touch the replay path.

The `sharedProcessor` ctor option on `DuelConnection` was dropped in
PR2 c8 — there is no longer a "processor shared across multiple
conns" model. Every `DuelConnection` instance owns its processor ;
the consolidation happened by collapsing to 1 conn, not by sharing.

No manual PvP/replay parity is required — the processor guarantees
identical behavior across both modes.

`MSG_CHAIN_NEGATED` is consumed silently by the processor (sets `negated`
flag on the matching chain link) — it is NOT pushed to `animationQueue`.
It IS pushed to `AnimationOrchestratorService.eventStream` via
`DuelEventProcessor.onEvent` so the Game Log sees the "Nié" badge in PvP
live (Palier 0).

### Intermediate post-cost board sync (F10 — UNIFIED 2026-06-12)

The in-stream `BOARD_STATE` cadence is now **identical on both wires**
(live worker + replay precompute), via shared code instead of the
historical "equivalent by construction" pair of mechanisms. Two
emission rules :

1. **Per-prompt** — every prompt batch ships `[...events, SELECT_*,
   BOARD_STATE]` (`status=WAITING` branch in `runDuelLoop` ; mirrored
   by `ingestStream` in
   [replay-precompute.ts](../../duel-server/src/replay-precompute.ts), which
   ingests a synthetic BOARD_STATE after every `PROMPT_TYPES_STREAM`
   message). This is the sync that covers the COMMON cost case — a cost
   paid through a prompt always has a prompt between the cost `MSG_MOVE`
   and `MSG_CHAIN_SOLVING`.
2. **Same-batch cost sync** — a `MSG_CHAIN_SOLVING` preceded by a
   `MSG_MOVE` in the SAME `duelProcess` batch gets an extra
   `BOARD_STATE` right before it, so DECK/pile counts are fresh before
   `chainPhase='resolving'` freezes board syncs. The predicate lives in
   the SHARED
   [chain-cost-sync-tracker.ts](../../duel-server/src/chain-cost-sync-tracker.ts)
   (`ChainCostSyncTracker`, batch-scoped via `resetBatch()`), consumed
   at the same wire position by `runDuelLoop` AND
   `runReplayPreComputation` — same pattern as `ChainSnapshotTracker`.
   The flag is DELIBERATELY batch-scoped : cross-batch costs are rule
   1's job. Pinned by `chain-cost-sync-tracker.spec.ts` + the F10
   cadence pins in `replay-precompute-v4-stream.spec.ts`.

The historical per-`flushNavEntry` synthetic BOARD_STATE was retired the
same day : it put a sync BEFORE `MSG_CHAINING` where live has none, and
none after mid-chain prompts where live has one — the two cadences were
disjoint, not equivalent (wire-level objectivation in
`work/planning-artifacts/f10-parity-investigation-2026-06-12.md`,
finding 2 ; the live `hasCostMoves` predicate never fired on cross-batch
costs, the per-prompt BOARD_STATE was the real live sync all along).
`flushNavEntry` still captures `boardStateSnapshot` per nav entry — that
is the SEEK surface (F9-bis restore), orthogonal to the in-stream
cadence.

**Why no intermediate boardStateAfter is needed on cost MSG_MOVEs** :
the `ChainSnapshotTracker` (PvP + replay shared) only attaches
`boardStateAfter` to BOARD_CHANGING events emitted **inside** the
resolving window (between `MSG_CHAIN_SOLVING` and `MSG_CHAIN_END`).
Cost moves are emitted **before** `MSG_CHAIN_SOLVING`, so they are not
tagged on either side — the per-prompt + same-batch BOARD_STATEs plug
that gap, now identically on both wires.

**Residual asymmetry (client-side timing, accepted)** : the replay mock
yields at a prompt and only dispatches the following BOARD_STATE after
the auto-response (~1.2s later), where the live client processes it
while the human reads the prompt. Pile counts therefore sync slightly
later in replay — cosmetic. A consumer branching on `chainPhase` at
sync time now sees the SAME phase on both sides (the wire order is
identical), which closes the historical tier-2/tier-3 divergence the
pre-unification doctrine documented as a regression risk.

### Cross-side `chainPhase` parity (F9, 2026-05-31)

The same `chainPhase` state machine (`idle | building | resolving`)
lives on BOTH sides of the wire, in two structurally different shapes :

- **Server** ([chain-state-tracker.ts](../../duel-server/src/chain-state-tracker.ts) —
  `applyChainTransition(state, msg)`) — a pure function dispatched on
  every outgoing message. Single function, all transitions in one
  switch. Phase + activeLinks + negated indices + currentSolvingChainIndex
  live on a `ChainStateContainer`. Snapshotted on reconnect via
  `CHAIN_STATE`.
- **Client** ([duel-event-processor.ts](../../front/src/app/pages/pvp/duel-page/duel-event-processor.ts) —
  `DuelEventProcessor`) — split across two layers :
  · `_processMessageInner` handles `MSG_CHAINING` (idle→building) and
    `MSG_CHAIN_NEGATED` (no phase change) synchronously on message
    receipt — SAME branches as the server's `applyChainTransition`.
  · `applyChainSolving(idx)` / `applyChainEnd()` flip
    `resolving` / `idle` but are called by the orchestrator from the
    QUEUE RUNNER (when `MSG_CHAIN_SOLVING` / `MSG_CHAIN_END` is dequeued
    and dispatched), NOT on receipt. The server flips on receipt.

**The asymmetry is intentional, not a bug**. The server's `chainPhase`
tracks the wire state ("what did I emit"); the client's `chainPhase`
tracks the animation state ("what am I rendering right now"). They
diverge for a window between the server emitting `MSG_CHAIN_SOLVING` /
`MSG_CHAIN_END` and the client's queue runner reaching that event —
during which the server is `resolving`/`idle` while the client is still
on the previous phase. That window is BOUNDED by the queue draining +
the chain overlay contract (`chainOverlayReady` await-signal).

**Invariant** : at the boundaries (idle for ≥ 1 tick after the queue
drains AND `MSG_CHAIN_END` has been dispatched), both sides agree on
phase. Reconnect handshake (`CHAIN_STATE`) ships the server's snapshot;
the client's `restoreChainState(links, phase)` re-aligns.

**Transition matrix** (CHAIN_* messages only — see both files for the
non-chain no-op handling) :

| Message | Server transition | Client transition (where) |
|---|---|---|
| `MSG_CHAINING` | idle→building (push link) | idle→building (push pending) — `_processMessageInner` sync |
| `MSG_CHAIN_NEGATED` | no phase change (add idx) | no phase change (flag link.negated) — sync |
| `MSG_CHAIN_SOLVING` | →resolving (set currentSolvingChainIndex) | →resolving (set link.resolving, dispatching generation only) — `applyChainSolving`, from queue runner |
| `MSG_CHAIN_SOLVED` | clear currentSolvingChainIndex (no phase change) | drop link from activeChainLinks (dispatching generation only, no phase change) — `applyChainSolved`, from queue runner |
| `MSG_CHAIN_END` | →idle, clear links/negated/currentSolving | clear links of the closed generation only; →idle, or →building when next-chain links survive — `applyChainEnd`, from queue runner |

**Dense back-to-back chains — generation scoping (2026-06-12).** The
client machine is a hybrid: receipt (sync) COMMITS links
(`commitPendingChainEntry` on SOLVING / WAITING_RESPONSE / SELECT_* /
CHAIN_END receipt) while dispatch (queue runner) CLEARS them. When
chains follow each other with no prompt in between (dense auto-play,
from-replay tape), chain N+1's CHAINING + SOLVING are RECEIVED — and
its link committed — while chain N's `MSG_CHAIN_END` still sits in the
animation queue. A blanket-wipe `applyChainEnd` destroyed that link;
the overlay then had no link to drop at SOLVED(N+1) dispatch, never
flipped `chainOverlayReady`, and the runner deadlocked on
`isWaitingForOverlay` (`pause-external`) while the queue grew and the
batch locks expired in cascade (D/D/D 24-chain fixture, trace in
`work/debug-solo/ddd-stall-diag/`). Fix: `DuelEventProcessor`
counts `MSG_CHAIN_END` *received* (`_chainGeneration`, tags every link
built) and `applyChainEnd` calls (`_dispatchedEndCount`, FIFO ⇒ the Nth
call closes generation N-1); `applyChainSolving/Solved/End` only touch
links of the dispatching generation (chain indices restart at 0 every
chain, so chainIndex alone is ambiguous). `reset()` rebases both
counters; `restoreChainState` rebases them to 0 (restored links carry
no `generation` and read as 0 via the `?? 0` fallback). The server
needs NO generation: it transitions at EMIT in wire order, where
`CHAIN_END(N)` always precedes `CHAINING(N+1)` — at the dispatch
instant where the client now keeps survivor links with phase
`'building'`, the server container holds exactly those links, so the
boundary-parity invariant is *improved*. Defense in depth: the
orchestrator's `handleChainSolved` passes `hasOverlayWork=false` to
`chainManager.handleSolved` when no tracked link matched (the overlay
can never signal → degrade to a sync 0ms step instead of arming
`_waitingForOverlay`). Pinned by the "dense back-to-back chains"
describe in
[duel-event-processor.spec.ts](../../front/src/app/pages/pvp/duel-page/duel-event-processor.spec.ts)
+ the garde-aval describe in
[animation-orchestrator.projections.spec.ts](../../front/src/app/pages/pvp/duel-page/animation-orchestrator.projections.spec.ts).

**Regression risk** : evolving one side without the other (e.g. server
adds a `pending` sub-phase, client splits `resolving` into `resolving`/
`announcing`) breaks the reconnect handshake silently — the client
restores `phase: 'resolving'` from a `CHAIN_STATE` payload that the
new sub-phase logic can't handle. Detected only at runtime, only on a
real reconnect mid-chain. There is currently NO automated gate ;
review-time discipline is the protection. The server suite at
[chain-state-tracker.spec.ts](../../duel-server/src/chain-state-tracker.spec.ts)
pins the server-side transition matrix ; the client suite at
[duel-event-processor.spec.ts](../../front/src/app/pages/pvp/duel-page/duel-event-processor.spec.ts)
pins the client-side. Any change to the chain phase semantics on
either side MUST update both specs + this matrix.

**F9-bis (2026-06-04) — `applyChainTransition` has 3 server-side
consumers, all driven by the same transition table.** Before this fix,
seeking into a replay mid-chain wiped `activeChainLinks` (via
`adapter.abort()` → `processor.reset()`) and never re-fed the prior
`MSG_CHAINING` events, leaving the chain overlay + chain badges empty
even though the target state was semantically inside a chain. The fix
mirrors the PvP `CHAIN_STATE` reconnect handshake, embedded into the
precompute timeline :

| Site | Driven by | Stored on | Restored by |
|---|---|---|---|
| `worker-message-router.ts` | live PvP/SOLO session | `session.activeChainLinks` + `chainPhase` | client `_handleChainState` on `CHAIN_STATE` |
| `replay-precompute.ts` (F9-bis) | per-replay-run container | `ReplayStreamNavEntry.chainSnapshot` on every nav entry captured while `chainPhase !== 'idle'` | client `MockDuelConnection.seekToOffset` |
| `chain-state-tracker.spec.ts` | transition pin | — | — |

The replay snapshot shape (`{ links: ChainingMsg[]; phase; negatedIndices;
currentSolvingChainIndex }`) is the same as the PvP `ChainStateMsg`
plus `currentSolvingChainIndex` (the live PvP path doesn't need it
because the server fires `MSG_CHAIN_SOLVING` as a real message right
after the handshake — replay can't, hence the field). Both sides
restore via the SHARED helper
[chain-state-restore.utils.ts](../../front/src/app/pages/pvp/duel-page/chain-state-restore.utils.ts)
`chainingMsgsToLinkStates` so the link-shape conversion can't drift
between the PvP and replay paths. Adding a 4th consumer of
`applyChainTransition` ? Update the table above, add it to the
[chain-state-tracker.spec.ts](../../duel-server/src/chain-state-tracker.spec.ts)
F9-bis comment block, and consider whether the new site needs its own
integration spec on top of the transition pin.

**Precompute timing rule for the snapshot embed** — `applyChainTransition`
fires AFTER any flush triggered by the current message itself
(`MSG_CHAINING` / `MSG_CHAIN_END` branches flush events that PRECEDE
the current message ; the snapshot at flush time must reflect the
pre-transition state) and BEFORE the current message is pushed into
`events[]` for any other branch (so the next flush triggered by a
later message sees the post-transition state on the current message).
Concretely : the `MSG_CHAINING(N)` branch flushes link N-1's events
WITH a snapshot that includes only links 1..N-1, then transitions
(push link N) ; the `MSG_CHAIN_END` branch flushes the last link's
events WITH a snapshot still showing `phase='resolving'`, then
transitions to `idle` so the separator state itself carries no
snapshot. The contract is pinned by the F9-bis tests in
[replay-precompute.spec.ts](../../duel-server/src/replay-precompute.spec.ts).
