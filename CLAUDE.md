# Project Instructions

## Code Quality

When writing or modifying code, always apply the `clean-code` and `code-principles` skills to enforce DRY, KISS, SRP, YAGNI, and Miller's Law thresholds.

### Component DI changes — run Karma before commit (A6, 2026-05-31)

Adding a new `inject(X)` (required, i.e. without `{ optional: true }`) to
an Angular component or directive REQUIRES running the component's spec
through Karma before commit, not just `tsc --noEmit`. Reason : missing
testbed providers surface as runtime `NG0201 No provider for X` — `tsc`
cannot see this. Pre-commit hooks (`stylelint` + ESLint via lint-staged)
also miss it.

Precedent — F1 (`7943aef4`, 2026-05-30) added `inject(DuelLogger)` to
`pvp-prompt-dialog` + `prompt-card-grid` claiming "tsc green". The specs
were not run ; F23 (`2879d0f0`, 2026-05-31) paid the debt 16 days later
by providing `DuelLogger` in both specs.

Minimum command : `ng test --include="<path-to-spec>" --watch=false
--browsers=ChromeHeadless`. If a refactor pass touches many components,
run the full duel-page / replay-page spec batch.

## Modes — vue d'ensemble

Skytrix has **3 live duel modes** (interactive OCGCore + WS sessions)
and **1 archive mode** (precomputed read-only playback) on top of the
animation pipeline. Plus a **paused R&D solver** that consumes the
duel-server / OCGCore stack for headless analysis.

| Mode | Bootstrap entry | Worker entry | Sockets | Server flags |
|---|---|---|---|---|
| **PvP normal** | POST `/api/duels` (2 distinct players) | `INIT_DUEL` | 2 (slots 0 + 1, both connected) | `soloMode: false, forkMode: false` |
| **PvP solo multiplex** | POST quick-duel (1 player plays both sides) | `INIT_DUEL` | 1 (slot 0 ; slot 1 reserved-but-never-connected) | `soloMode: true, forkMode: false` |
| **Fork-solo** | Replay viewer → REPLAY_FORK | `INIT_FORK` (precompute + sanity ; same worker process stays live with `forkMode=true`, no second init) | 1 (same as SOLO multiplex) | `soloMode: true, forkMode: true` |
| **Replay** | Replay viewer → REPLAY_LOAD | `INIT_REPLAY` (precompute batch only ; no live session) | 1 (WS replay endpoint, NOT WS duel) | n/a — no `ActiveDuelSession` |

**Mental pivot — fork-solo IS a SOLO multiplex.** Post-F5-bis (2026-05-31)
the fork-solo runtime is structurally identical to a SOLO multiplex
session ; only the bootstrap differs (sourced from a replay seek point
instead of a fresh POST). The `forkMode` flag gates exactly 3 skips :
no replay persist, no rematch arm, log tag `'fork_solo'`. Everything
else (omniscient filter, 1-socket slot routing, chain tracking,
MSG_CONFIRM_CARDS tagging, winReasonCode, game-log ingestion,
cancel-rollback, no turn timer) is inherited from SOLO multiplex by
construction. See "Fork-solo unification (F5-bis)" below.

**Mental pivot — replay is NOT a live duel.** The replay path runs the
worker in **precompute batch mode** : it replays the recorded
`playerResponses` against OCGCore and streams `REPLAY_STREAM_CHUNK +
REPLAY_STREAM_INIT` (messages: `ServerMessage[]` + navIndex:
`ReplayStreamNavEntry[]`) to the replay viewer, which consumes the stream
like an enriched video with play/pause/seek. There is no `ActiveDuelSession`,
no `broadcastMessage`, no per-message routing — the client drives playback
via `MockDuelConnection` + `ReplayTransportService` (v4 Phase 5, 2026-06-05
— the legacy `ReplayDuelAdapter` retired ; v4 Phase 6, 2026-06-06 — the
legacy `PreComputedState[]` / `REPLAY_BOARD_STATES` retired, the nav
index absorbs `events[]` + `responseCount` 1:1). See "Replay = PvP
readonly via MockDuelConnection" and "Pre-computation Timeline Rules"
for the parity contracts that keep replay's rendered behavior identical
to PvP's.

**The fifth consumer — R&D solver (paused).** `duel-server/src/solver/`
hosts a paused combo-path solver (R&D since 2026-04, last work
2026-05-05 ; see memory `solver-repo-cleanup-2026-05-05`) that
**ALSO spawns OCGCore** (via its own pipeline, not `duel-worker.ts`)
for headless deck analysis. It is not a runtime mode but a CLI / batch
harness — useful when debugging OCGCore behavior in isolation, because
the solver's evaluators can replay arbitrary game states without the
WS / session overhead. If you need to reproduce a tricky OCGCore
question without booting the full duel-server, the solver's
`evaluate-structural.ts` or `solver-poc.ts` entry points are valid
exploration tools. Treat its code as archived ; do not extend it
without re-activating the R&D track.

**Cross-mode invariants** (all 4 consumers share these by contract) :
- **Animation pipeline** — `AnimationOrchestratorService` consumes the
  same `GameEvent[]` regardless of mode. PvP↔Replay parity is structural
  (see "Animation Parity Rule").
- **Perspective** — absolute (server P0/P1) vs relative (viewer 0/1)
  routed via `DuelContext.relativePlayer()` where injection is
  available. See "Perspective Convention" + "Relativizer routing
  discipline (F6)".
- **Chain state machine** — `idle | building | resolving` on both
  client and server, transitions matched by contract. See "Cross-side
  `chainPhase` parity (F9)".
- **Game log** — every mode feeds the same `GameLogBuilder` via the
  EventStream (palier 0). See "EventStream vs AnimationQueue".

## Design System & Styling Conventions

The front-end has a custom Design System. **Before writing ANY UI, read
`front/DESIGN-SYSTEM.md`** — it is the canonical component catalogue
(triage of the 36 `components/`, per-component API, usage rules). Styling
rules are enforced by `stylelint` + ESLint + a pre-commit hook
(`scripts/hooks/`, activated via `core.hooksPath`); full lint reference:
`front/LINTING.md`.

Non-negotiable rules (full detail in `DESIGN-SYSTEM.md`):

- **Use DS components, never ad-hoc HTML/SCSS.** Buttons / pills / chips /
  toggles / form controls are Angular components (`<app-button>`,
  `<app-icon-button>`, `<app-pill>`, `<app-chip>`, `<app-seg-button>`,
  `<app-input>`, `<app-checkbox>`, `<app-toggle-switch>`, …), NOT global
  SCSS classes. Never `<button class="…">`, never `mat-*-button` /
  `<mat-chip>` (MDC layer). `.badge` stays a global class (`_badge.scss`,
  single consumer).
- **Colors** → always a token `var(--…)`. Literal hex only in
  token-defining files (`front/src/app/styles/**`, `_sim-tokens.scss`,
  `simulator-page.component.scss`). `--gold` = background/accent/border/
  glow; `--gold-on-surface` = gold text/icon `color:`.
- **`mat-icon` sizing** → `@include icon-size($size, $line-height?)` from
  `styles/mixin.scss`. Never re-write the `font-size/width/height
  !important` trio by hand.
- **`::ng-deep`** → forbidden in components. Non-encapsulated CDK/Material
  → `styles/_cdk-overrides.scss`; child component → a variant `input`.
- **Host-wrapper contract** (button/pill/chip/seg/input/checkbox) — a
  parent SCSS override of chrome (padding, bg, hover, `:disabled`) MUST
  target the inner `.btn__el` / `.icon-btn__el` / etc.; size contracts
  (`min-height`, `width`) stay on the host.
- **`!important`** → structural cases only; any `!important` outside the
  mixin needs a `// !important: why` comment.

Maintenance: any new component added under `components/` MUST be added to
`front/DESIGN-SYSTEM.md` (category + API) — there is no sync script.

## Animation Parity Rule

Any animation added to `AnimationOrchestratorService` MUST work through the
`AnimationDataSource` interface (animation-data-source.ts),
`RenderedBoardStateService` (board state management), and
`DuelEventProcessor` (chain/queue event processing). The orchestrator
MUST NOT import or reference `DuelWebSocketService` or `DuelConnection` directly.
This ensures replay mode automatically inherits all animation features.

When adding a new signal or method to the orchestrator that reads/writes
game state, add it to `AnimationDataSource` and implement it in both
`DuelWebSocketService` and `ReplayDuelAdapter`.

`AnimationDataSource` is injected via the `ANIMATION_DATA_SOURCE` token.
Implementations: `DuelWebSocketService` (PvP, delegates to `DuelConnection`)
and `ReplayDuelAdapter` (Replay). Shared utility: `syncAfterBoardState()` —
free function used by both for BOARD_STATE sync tier logic.
`DuelConnection` is a concrete WebSocket class, NOT an abstraction layer.

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
- **Replay** : `ReplayDuelAdapter` owns its processor outright (separate
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

### Intermediate post-cost board sync (F10, 2026-05-31)

Both PvP and Replay surface a board-sync moment between chain cost
events (`MSG_MOVE` discarding the activator from hand, banishing for
cost, etc.) and `MSG_CHAIN_SOLVING`, but via **two different mechanisms**
that achieve the same effect by construction :

- **PvP** — explicit BOARD_STATE between cost and `MSG_CHAIN_SOLVING`.
  [duel-worker.ts:697-758](duel-server/src/duel-worker.ts#L697-L758)
  tracks `hasCostMoves` (any `MSG_MOVE` emitted since the last reset)
  and emits an extra `BOARD_STATE` message right before
  `MSG_CHAIN_SOLVING` when the flag is true. Client consumes it through
  the normal `case 'BOARD_STATE'` branch → `syncAfterBoardState` → tier 3
  (chainPhase=`building`, queue non-empty) → `syncPileCounts()` so
  DECK/EXTRA counts + metadata are up to date before the chain enters
  `resolving`.
- **Replay** — implicit `ReplayStreamNavEntry` segmentation (Phase 6,
  2026-06-06). The flush on `MSG_CHAINING` in
  [replay-precompute.ts](duel-server/src/replay-precompute.ts) `flushNavEntry`
  cuts the stream so the nav entry containing `events=[..., MSG_MOVE]`
  (the cost) has its own `boardStateSnapshot` captured via `buildBoardState()`
  on flush, AND emits a synthetic `BOARD_STATE` message right before
  recording the entry. The next nav entry then carries `MSG_CHAINING` and
  the chain resolution events. Client consumes the synthetic BOARD_STATE
  via `mockConn.dispatchNext → syncAfterBoardState`. Tier decision lands
  on tier 2 (`syncRendered`) because `chainPhase=idle` at that moment
  (MSG_CHAINING hasn't yet been processed for this state).

**Difference in ordering vs `MSG_CHAINING`** :

- PvP : sync arrives **after** `MSG_CHAINING` (chainPhase=`building` at
  sync time), **before** `MSG_CHAIN_SOLVING`.
- Replay : sync arrives **before** the state carrying `MSG_CHAINING`
  (chainPhase=`idle` at sync time).

The sync tier differs as a result (tier 3 vs tier 2), but the practical
effect on rendered state is equivalent — both update DECK/EXTRA pile
counts + metadata before the chain enters `resolving`. The
`syncRendered()` tier 2 commits more aggressively than tier 3
`syncPileCounts()`, but at that moment in replay the only zones the
animation pipeline cares about (HAND for the discarded cost card) are
already committed by the MSG_MOVE handler — there are no extra zones
to mismatch.

**Why no intermediate boardStateAfter is needed on cost MSG_MOVEs** :
the `ChainSnapshotTracker` (PvP + replay shared) only attaches
`boardStateAfter` to BOARD_CHANGING events emitted **inside** the
resolving window (between `MSG_CHAIN_SOLVING` and `MSG_CHAIN_SOLVED`).
Cost moves are emitted **before** `MSG_CHAIN_SOLVING`, so they are
not tagged on either side. Both mechanisms above plug that gap
independently.

**Regression risk** : the parity is "by construction" but not by a
shared mechanism. Two ways it can break :

1. **Server splits the PvP path** — e.g. moves the `hasCostMoves` check
   to a different trigger, or drops the intermediate BOARD_STATE
   because the test "looks fine". Without an equivalent change in
   `replay-precompute.ts:407-413` segmentation, only PvP loses the
   sync — replay keeps working through the precompute flush.
2. **Client adds a sync consumer that depends on the ORDER vs
   `MSG_CHAINING`** — anything reading `chainPhase` at sync time will
   read `building` in PvP and `idle` in replay, and may branch
   differently. The current tier predicate doesn't (both fall back to
   `syncPileCounts` in the worst case, and tier 2 `syncRendered` in
   replay is a strict superset of tier 3). A future tier 4 with a
   side-effect gated on `chainPhase === 'building'` would diverge.

There is currently NO automated gate enforcing this parity. The
`ChainSnapshotTracker` shared spec covers the resolving-window snapshot
contract — the pre-resolving cost-sync contract is unwritten. If a
future bug surfaces a divergence here, the right fix is probably to
hoist the intermediate sync into a shared utility callable from both
`runDuelLoop` and `runReplayPreComputation`, rather than reproducing
the PvP message in the replay timeline (Axel-validated 2026-05-31 — a
"Chain Cost" timeline entry is internal mechanics, not a user-facing
step).

### Cross-side `chainPhase` parity (F9, 2026-05-31)

The same `chainPhase` state machine (`idle | building | resolving`)
lives on BOTH sides of the wire, in two structurally different shapes :

- **Server** ([chain-state-tracker.ts](duel-server/src/chain-state-tracker.ts) —
  `applyChainTransition(state, msg)`) — a pure function dispatched on
  every outgoing message. Single function, all transitions in one
  switch. Phase + activeLinks + negated indices + currentSolvingChainIndex
  live on a `ChainStateContainer`. Snapshotted on reconnect via
  `CHAIN_STATE`.
- **Client** ([duel-event-processor.ts](front/src/app/pages/pvp/duel-page/duel-event-processor.ts) —
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
| `MSG_CHAIN_SOLVING` | →resolving (set currentSolvingChainIndex) | →resolving (set link.resolving) — `applyChainSolving`, from queue runner |
| `MSG_CHAIN_SOLVED` | clear currentSolvingChainIndex (no phase change) | drop link from activeChainLinks (no phase change) — `applyChainSolved`, from queue runner |
| `MSG_CHAIN_END` | →idle, clear links/negated/currentSolving | →idle, clear activeChainLinks — `applyChainEnd`, from queue runner |

**Regression risk** : evolving one side without the other (e.g. server
adds a `pending` sub-phase, client splits `resolving` into `resolving`/
`announcing`) breaks the reconnect handshake silently — the client
restores `phase: 'resolving'` from a `CHAIN_STATE` payload that the
new sub-phase logic can't handle. Detected only at runtime, only on a
real reconnect mid-chain. There is currently NO automated gate ;
review-time discipline is the protection. The server suite at
[chain-state-tracker.spec.ts](duel-server/src/chain-state-tracker.spec.ts)
pins the server-side transition matrix ; the client suite at
[duel-event-processor.spec.ts](front/src/app/pages/pvp/duel-page/duel-event-processor.spec.ts)
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
[chain-state-restore.utils.ts](front/src/app/pages/pvp/duel-page/chain-state-restore.utils.ts)
`chainingMsgsToLinkStates` so the link-shape conversion can't drift
between the PvP and replay paths. Adding a 4th consumer of
`applyChainTransition` ? Update the table above, add it to the
[chain-state-tracker.spec.ts](duel-server/src/chain-state-tracker.spec.ts)
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
[replay-precompute.spec.ts](duel-server/src/replay-precompute.spec.ts).

## Fork-solo unification (F5-bis, 2026-05-31)

For the mode table + the high-level "fork-solo IS a SOLO multiplex"
pivot, see "Modes — vue d'ensemble" at the top of this file. This
section documents the runtime contract : the 3 fork-specific skips,
the inherited-from-SOLO surface, and the call-site invariants.

`ActiveDuelSession.forkMode: boolean` implies `soloMode: true` and is
NEVER set on a PvP normal session. The 3 legitimate combinations
(`soloMode: false / forkMode: false` = PvP, `soloMode: true /
forkMode: false` = SOLO multiplex, `soloMode: true / forkMode: true`
= fork-solo) all flow through the same `attachWorkerHandlers` →
`broadcastMessage` path. The 3 fork-specific behavioral differences :

1. **No replay persist** — `worker-message-router.ts`
   `case 'WORKER_REPLAY_DATA'` skips `persistReplay` when
   `session.forkMode`. Fork-solo derives from an existing replay,
   recording the variant doesn't make sense.
2. **No rematch** — `duel-end-coordinator.ts handleDuelEnd`
   ([duel-end-coordinator.ts:126](duel-server/src/duel-end-coordinator.ts#L126))
   skips the `rematchTimeout = setTimeout(...)` arm when
   `session.forkMode`. Fork-solo is exploratory one-shot. (Pre-U34
   audit-4-modes-2026-06-01 this lived in `worker-lifecycle.ts`.)
3. **Log tag** — `broadcastMessage` `case 'MSG_WIN'` writes
   `mode: 'fork_solo'` on the DUEL_END log line, alongside `'solo'`
   for SOLO multiplex and `'pvp'` for PvP normal. For audit-log
   filtering only.

### Inherited from SOLO multiplex (no fork-specific code)

Everything else flows through the SAME code path as a regular SOLO
multiplex session, no per-fork branches :

- **Omniscient filter** : `broadcastMessage` SOLO branch
  ([worker-message-router.ts:358-380](duel-server/src/worker-message-router.ts#L358-L380))
  fires on `session.soloMode`, applies to fork.
- **1-socket routing** : `decideSoloRouting` / `PSEUDO_PAIRWISE_SOLO_ROUTED`
  in `lifecycle-helpers.ts` handle slot-1 sends via tag (no-op or
  route-to-0). Same for fork.
- **Chain tracking** : `applyChainTransition` runs in
  `broadcastMessage` for every message. Same for fork.
- **MSG_CONFIRM_CARDS chainIndex tag** : tagged in `broadcastMessage`
  via `session.currentSolvingChainIndex`. Same for fork.
- **`winReasonCode` on DUEL_END** : extracted from `MSG_WIN.reason` in
  `broadcastMessage`. Same for fork.
- **Game-log ingestion** : `broadcastMessage` top of body runs
  `ingestIntoSessionGameLog(session.gameLog, message)`. Same for fork.
- **Cancel-rollback** : `takeWorkerSnapshot()` fires at every
  IDLECMD/BATTLECMD boundary
  ([duel-worker.ts:1182](duel-server/src/duel-worker.ts#L1182))
  regardless of `forkMode`. Fork-solo inherits the anti-fat-finger
  discipline. (The worker's own `forkMode` flag is scoped to other
  bootstrap concerns : bypassing `capturedSetResponse`, gating
  `emitReplayData` — see "Worker `forkMode` variable" below.)

### Turn timer disabled in SOLO + fork (F5-bis behavior change)

The `case 'WORKER_DUEL_CREATED'` handler in
[worker-message-router.ts](duel-server/src/worker-message-router.ts)
now wraps `timerContext` allocation + `sendTimerStateToAll` in
`if (!session.soloMode)`. Rationale : a turn timer counting down
against oneself is a paradox. SOLO and fork-solo simply skip the
allocation ; all timer-management functions early-return on
`timerContext === null` so no further branches are required.

**Client behavior** : with no `TIMER_STATE` ever emitted, the
`pvp-timer-badge` component reads `timerState() === null` →
`effectiveRemainingMs() === null` → displays `'--:--'` cosmetically.
All UI computeds degrade gracefully (no crash, no NaN, no off-by-one).

**Inactivity timer kept** : the per-prompt inactivity timer
(`startInactivityTimer`) is still armed via `broadcastMessage` for
SOLO sessions. Load-bearing — protects against worker leaks when the
client keeps the socket open without activity (5min timeout → forfeit
+ session cleanup). The "you forfeit yourself" paradox is accepted in
exchange for the resource-leak protection. SOLO players who walk away
from an active prompt for >5min will see "duel ended by inactivity" ;
closing the tab cleanly is the recommended flow.

### Fork-specific construction (the only path that touches `forkMode`)

[fork-handlers.ts createForkSoloSession](duel-server/src/fork-handlers.ts)
is the only constructor that sets `forkMode: true`. It :

1. Allocates 1 token (not 2 — `register(session, [token1])`).
2. Builds the session with `soloMode: true, forkMode: true`, 2 player
   slots where slot 1 is reserved-but-never-connected (same as SOLO
   multiplex — see [lifecycle-helpers.ts](duel-server/src/lifecycle-helpers.ts)
   comment block).
3. Removes the worker's transient (replay-precompute-style) listeners
   and calls `attachWorkerHandlers(session)` — the canonical PvP/SOLO
   handler set. No `setupForkWorkerHandlers` parallel implementation
   remains.

### Front consumer changes

- `REPLAY_FORK_READY` payload : `{ token1 }` only (no `token2`).
- `replay-connection.service.ts forkTokens` signal :
  `{ token1: string } | null`.
- `replay-fork.service.ts navigateToForkDuel` : router state
  `{ wsToken1: tokens.token1 }` only.
- `duel-page.component.ts` fork branch : gate is `if (!wsToken1)`
  (the `wsToken2` validation guard is gone).
- `solo-mode-effects.service.ts initFork` : unchanged. Fork still
  legitimately skips the `initSolo` player-persistence + rematch-reset
  effects — those are SOLO UX features the fork explicitly doesn't
  want.

### Worker `forkMode` variable (not the same as `session.forkMode`)

[duel-worker.ts](duel-server/src/duel-worker.ts) has an internal
`forkMode: boolean` variable ([duel-worker.ts:1063](duel-server/src/duel-worker.ts#L1063)) set on `INIT_FORK`
that gates worker-side behavior : bypassing `capturedSetResponse` (for
deterministic replay reconstruction), skipping `emitReplayData` (the
worker doesn't auto-emit on END/WIN), the `FORK_RESUME` handler.
These are LEGITIMATELY worker-internal concerns that do not collapse
into the SOLO multiplex path — they relate to how the worker bootstraps
on a replay's seek point, not how the server routes messages.

The `session.forkMode` flag is the SERVER-side concern (which routing
skips to apply) ; the worker's `forkMode` variable is the WORKER-side
concern (how to bootstrap + handle responses). They share a name but
have different scopes.

## Transport Lifecycle Invariants

Two load-bearing invariants the γ-c bootstrap relies on. Both are
implicit today (enforced by code structure + comments) — documenting
them here so a future refactor that breaks them gets caught at review.

**Invariant 1 — `DuelConnection.cleanup()` MUST stay idempotent + safe
without prior `connect()`.** The `DuelWebSocketService` ctor builds a
default `DuelConnection` even in SOLO mode (where it's immediately
orphaned and `cleanup()`-ed by `bindSoloConnection`). On top of that,
SOLO teardown can fire `cleanup()` twice on the same conn (once via
`SoloDuelOrchestratorService.cleanup`, once via
`DuelWebSocketService.ngOnDestroy` — see [F-3.3]). Both work today
because `cleanup()` is null-safe (no-op WS close, RBS destroy is
idempotent, timer slots check before clear). Any future addition to
`cleanup()` (Datadog counter, listener removal that throws on missing
listener, …) MUST preserve both properties or the SOLO bootstrap +
teardown paths break silently.

**Invariant 2 — `DuelConnection.soloMode` and `_duelCtx` MUST be set
together before `connect()`.** A conn with `soloMode = true` and
`_duelCtx === undefined` throws via `duelAssert` at the first
BOARD_STATE through `_shouldSwapForSolo`. The reverse (`soloMode =
false` with `_duelCtx` set) is harmless but pointless. The cleanup landed (F-2.3, post-c8) : `conn.soloMode` is now a
**getter derived from `soloModeSource`**
([duel-connection.ts:251-253](front/src/app/pages/pvp/duel-page/duel-connection.ts#L251-L253)),
passed in as a ctor option by `SoloDuelOrchestratorService`
([solo-duel-orchestrator.service.ts:159](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L159)),
so the "pair flip" is structurally impossible to break — there is no
longer a `setSoloMode` writer on the conn. Anyone adding a third
SOLO-only field to `DuelConnection` SHOULD follow the same pattern
(ctor option backed by a wsService source signal) rather than a
mutable setter.

## EventStream vs AnimationQueue (Palier 0)

Two distinct flux coexist in the animation pipeline:

- **`AnimationQueue`** — the animatable subset, owned by
  `DuelEventProcessor._animationQueue`, consumed by the queue runner.
  Strict `GameEvent` union; the invariant "`MSG_CHAIN_NEGATED` is NOT
  pushed to `animationQueue`" stays true.
- **`AnimationOrchestratorService.eventStream`** — every duel event in
  logical order (post-chain-buffer), the journal source. Wider
  `StreamEvent` union (`GameEvent | ChainNegatedMsg | WinMsg |
  SelectCardMsg | BoundaryEvent | DeferredFluxEvent | AnimationFluxEvent
  | InternalTransportEvent`). β.2a refactored the push pipeline around a
  **single convergence point**: `AnimationOrchestratorService.pushToStream(event)`
  appends to `_eventStream` AND calls `deferredProcessor.observe(event)`.
  The DEP's own emissions go through `pushDeferredToStream` which
  bypasses observe re-entry. Push sites converging on `pushToStream`:
  · the in-queue tap inside `processEvent` (after `bufferIfResolving`,
    after `updateLogical(boardStateAfter)`, before the dispatch switch);
  · the page-bootstrapped out-of-band sink (γ-c cleanup F-1.2 retired
    the `notifyOutOfBandEvent` wrapper — sink callers invoke
    `pushToStream` directly) — feeds
    `DuelEventProcessor.onEvent(MSG_CHAIN_NEGATED)` (wired by
    `DuelConnection.attachOutOfBandSink` /
    `ReplayDuelAdapter.attachOutOfBandSink`); `DuelConnection`
    `SELECT_CARD` prompt branch (PvP only — replay has no interactive
    prompts); `DuelConnection` `DUEL_END` handler reconstructs a
    synthetic `MSG_WIN` from `winner` + `winReasonCode` when the duel
    ended naturally in the engine (non-engine ends — surrender,
    timeout, disconnect — leave `winReasonCode` undefined and skip the
    synthesis, matching what replay sees in its precompute final state);
    β.1 BoundaryProcessor emissions via the same `processor.onEvent`
    sink the adapters wire (`ChainStarted/Ended`, `TurnStarted/Ended`,
    `PhaseStarted/Ended` — see the dedicated "BoundaryProcessor"
    section below);
  · β.2a (2026-05-26) — `QueueRunner.onInternalEvent` sink absorbed
    onto the stream (the α.3 `InternalTransportEvent` family —
    `runner-started/stopped`, `rescue-*`, `watchdog-armed`). Closes the
    W1 code-review finding. The DEP observes runner transport events
    alongside WS messages so a future rule can predicate on them.
  · β.2a (2026-05-26) — `DeferredEffectProcessor` emits
    `DeferredEffect/EffectReady/EffectAbandoned` via
    `pushDeferredToStream`. See the dedicated
    "DeferredEffectProcessor" section below.
  · β.2b (2026-05-26) — the orchestrator emits
    `AnimationStarted({ref, msgType})` + `AnimationCompleted({ref, msgType})`
    around every dispatched business event (sync emit today, see the
    DeferredEffectProcessor section for the β.3 follow-up).

`DuelGameLogService` subscribes via `attachEventStream(stream)` — a
`signal` effect that drains newly-pushed events through `notifyGameLog`
in arrival order. The journal index is reset at `reset()`; on replay
seek `orchestrator.resetForSwitch` clears the stream and the service
together, then `rebuildUpTo(states)` re-feeds the builder via the
separate `ingestState` path. PvP↔Replay parity is structural — the
same `GameLogBuilder` consumes the same event set on both sides.

## Animation Pipeline v2 — shipped lots (α + β)

For full implementation history, edge cases, and design justifications
see [docs/anim-pipeline-v2/README.md](docs/anim-pipeline-v2/README.md).
This section keeps only the **load-bearing invariants** a future dev
MUST respect to extend or modify the pipeline safely.

**Lot inventory** :

| Lot | Component | File | Status |
|---|---|---|---|
| α.1 | Signal tagging ESLint rule | `eslint-plugins/pipeline-signal-tagged/` | ACTIVE — every new `signal()` MUST be tagged |
| α.2 + α.4a | `BaseProjection<T>` + `ResetTarget` infra | `front/src/app/pages/pvp/projections/` | ACTIVE — base contracts |
| β.1 | `BoundaryProcessor` (ChainStarted/Ended, TurnStarted/Ended, PhaseStarted/Ended) | `front/src/app/pages/pvp/duel-page/boundary-processor.ts` | SHIPPED 2026-05-26 |
| β.2a + β.2b | `DeferredEffectProcessor` + rules table + central `pushToStream` ref | `front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts` + `deferred-effect-rules.ts` | SHIPPED 2026-05-26 |
| β.3 | 7 production projections + 2 standardisations + Doctrine | `front/src/app/pages/pvp/projections/*.projection.ts` | SHIPPED 2026-05-31 (F15 collapse closed last residual) |

### Signal tagging convention (α.1) — STILL ENFORCED

Every `signal()` under `front/src/app/pages/pvp/` MUST declare its
nature so a reviewer can answer "projection / @Environment / transport
state?" without archaeology. ESLint rule
`skytrix-pipeline/pipeline-signal-tagged` enforces it. Three tags + 1
escape hatch :

1. **`_transport_<name>`** — internal transport state (queue pointers,
   timer flags, debounce counters). Never read by UI templates. Strict
   prefix : `_transport_*` only (P8 hardening).
2. **`<name>Source`** — `@Environment` input (OS setting, user prefs,
   session config). Read-only from the pipeline's POV. Module-scope
   only (P8).
3. **Property of a class that `extends BaseProjection<T>` or
   `implements ResetTarget`** — every other signal MUST live inside a
   registered projection. Class membership IS the tag. The
   `BaseProjection` / `ResetTarget` import MUST be from `projections/`
   (P8 — guards against local shadow classes).
4. **`// eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged`** —
   escape hatch with a `// why:` sibling comment.

Baseline of pre-existing untagged files :
`eslint-plugins/pipeline-signal-tagged/allowed-files.json`. New files
in `pvp/` are checked from creation. Regenerate baseline (after a
migration batch) with `node front/eslint-plugins/pipeline-signal-tagged/regenerate-baseline.mjs`.

### Projection infrastructure (α.2 + α.4a) — STILL ENFORCED

Two layered contracts in
[front/src/app/pages/pvp/projections/](front/src/app/pages/pvp/projections/) :

- **`ResetTarget`** (interface, α.4a) — `readonly scope: ScopeCategory`
  + `applyReset(scopes, payload?)`. Implemented by managers that mix
  business + transport + exposed signals (`ChainResolutionManager`,
  `LpAnimationTracker`, `BattleAnimationTracker`,
  `DuelGameLogService`, `TargetIndicatorManager`).
- **`BaseProjection<T>`** (abstract class, α.2) — strict superset of
  `ResetTarget`. Adds `readonly value: Signal<T>` + `applyEvent(FluxEvent)`.
  Used by all 7 β.3 projections.

**`ScopeCategory`** : `SESSION_LIFETIME | DUEL_LIFETIME |
CONNECTION_LIFETIME | PERSPECTIVE_LIFETIME`. Ordered top-down.
Invalidating a scope cascades to every scope below via
`expandInvalidatedScopes(set)`. The algorithm anchors on the shallowest
(most durable) entry and fills every scope strictly below — non-
contiguous inputs like `{SESSION, CONNECTION}` expand to all 4 (P9
hardening).

**`ScopeResetDispatcher`** — registry + fan-out. `register(target)`
accepts any `ResetTarget`. `dispatch(scopes, payload?)` expands then
calls `applyReset` on every registered target whose scope is in the
expanded set. Idempotent register ; silent unregister.

### BoundaryProcessor invariants (β.1)

`BoundaryProcessor` (`boundary-processor.ts`) is owned privately by
`DuelEventProcessor`. Emits `ChainStarted/Ended`, `TurnStarted/Ended`,
`PhaseStarted/Ended` (carrying `kind: 'boundary'`) on the EventStream.

**Call-site invariants** (any future refactor MUST preserve) :

- `observeMessage(msg)` MUST be called as the FIRST line of
  `_processMessageInner`, BEFORE any state mutation. Sync-mandatory.
- `observeBoardState(payload)` MUST be called from the WS adapter
  AFTER `syncAfterBoardState`.
- `forceClosure(reason)` MUST be called on `STATE_SYNC` /
  `REMATCH_STARTING` / `DUEL_END` to emit `*Ended` for every open
  group in Chain → Phase → Turn order before chain state is wiped.
- `silentReset` drops state WITHOUT emitting any boundary. Use it on
  hard teardown ; use `forceClosure` when a §3.6 checkpoint is the
  actual cause and the journal should see the closures.

**Replay-side asymmetry (F29 doctrine, 2026-05-31 — v4 Phase 5)** —
the v4 `MockDuelConnection.seekToOffset` intentionally does NOT call
`forceClosure` at seek. A replay seek runs `abortAndClean` →
`resetForReplaySeek` → dispatch `{DUEL_LIFETIME}` → `processor.reset()`
→ `boundary.silentReset()` (the processor is the one owned by the mock,
which the orchestrator's `ResetTarget` registry sees via the
`ANIMATION_DATA_SOURCE` token). The journal would only see those
closures briefly because `gameLog` is fully wiped + rebuilt the same
tick via `gameLogRebuildTick` → `rebuildUpTo([0..currentIndex])` (new
`GameLogBuilder` instance). Emitting closures juste avant the wipe
would be pure noise. PvP/SOLO have NO such full rebuild — their
journal stays live across STATE_SYNC/Rematch, so `forceClosure` is
load-bearing there. Don't add `forceClosure` to the replay seek path
without first introducing a consumer that would survive the journal
wipe.


### DeferredEffectProcessor invariants (β.2)

`DeferredEffectProcessor` (`deferred-effect-processor.ts`) materialises
cross-event temporal correlations as explicit markers on the
EventStream. Owned by `AnimationOrchestratorService` (NOT by
`DuelEventProcessor` like the BP — the DEP MUST observe the SAME
convergence point that sees WS messages AND boundary events AND
runner transport events).

**Emitted event types** (all carrying `kind: 'deferred'`) :

- `DeferredEffect(name, triggerRef, awaitingPredicate)` — a rule's
  trigger fired ; the processor is now watching for a matching event.
- `EffectReady(name, triggerRef)` — a flux event matched the
  predicate ; consumers can treat the deferred as resolved.
- `EffectAbandoned(name, triggerRef, reason)` — closed without a
  match. `reason: 'timeout'` (no match within `DEFERRED_TIMEOUT_MS =
  5s`) or `'checkpoint'` (a §3.6 reset wiped every pending deferred).

**Call-site invariants** :

- **Reset scope** : `CONNECTION_LIFETIME`. `PerspectiveSwitched`
  (PERSPECTIVE-only, deeper) does NOT abandon open deferreds —
  deferreds survive the switch.
- **`silentReset`** drops state + timers WITHOUT emitting any
  `EffectAbandoned`. Mirror of `BoundaryProcessor.silentReset`. Use
  on hard teardown ; use `applyReset({CONNECTION_LIFETIME})` via the
  dispatcher when a §3.6 checkpoint is the actual cause.
- **Name collisions** are an invariant violation : `duelAssert`
  throws in dev ; in prod the older entry is abandoned with
  `EffectAbandoned(reason='timeout')`. The rules table guarantees
  uniqueness by including index / chainIndex / ref in each name.
- **Central monotonic ref** : `pushToStream(event)` returns the
  monotonic `ref` and forwards `(event, ref)` to
  `deferredProcessor.observe`. The DEP stores ref as the deferred's
  `triggerRef`. The orchestrator stashes it on
  `_transport_lastDispatchedRef` so `AnimationStarted` /
  `AnimationCompleted` carry it. The ref counter resets in
  `resetAllState`.

**Rule contract** (`deferred-effect-rules.ts`) — each rule declares
`trigger / deriveName / derivePredicate` and an optional `chainTo`.
The rule reference is stored on the active deferred so `tryRearm`
reaches `chainTo` in O(1). 6 rules ship — 5 `DeferredRule`
(overlay-show compound, trigger-show self-ref, attack-impact, lp-cost,
counter-pulse) + 1 `RewriterRule` (xyz-leave-with-materials, a
distinct `kind:'rewriter'` type that rewrites the event stream
in-place rather than producing deferred markers) ; 6 stubs documented
inline (`#3` through `#11` — see the file).

**RuleSinks doctrine (2026-06-01)** — production uses `NO_OP_SINKS`
**by design**. `xyzLeaveWithMaterials` absorbs the N XYZ-material
settling MSG_MOVE (GY→GY reason=0x600) cleanly side-journal (closes
the duplicate "→ Graveyard" rows), and the absence of a replacement
travel animation is **intentional** : a synthetic OVERLAY→GRAVE travel
from the XYZ source's MZONE carries no user-visible information, and
the pre-U16 `pileToPile` flash visual was ugly anyway. The rule's
`onTrigger` keeps synthesizing virtuals + acquiring a no-op lock so
the rule contract is self-sufficient — wire the real sinks
(`dataSource.enqueueVirtualMoves` + `rbs.lockZone`) only if a future
scenario actually wants a replacement visual. Do NOT call the
`NO_OP_SINKS` state "dette" or "Commit 2 missing" — it's the chosen
production behavior.

### Projections β.3 — inventory

7 production projections in `front/src/app/pages/pvp/projections/`,
each `extends BaseProjection<T>` and is registered + attached on
`_eventStream` by the orchestrator constructor. All `PERSPECTIVE_LIFETIME`.

| Lot | Projection | Source events | Clear path |
|---|---|---|---|
| 1 | `OverlayShowReadyProjection` | `EffectReady` / `EffectAbandoned` ('overlay-show:chain-N') from DEP | `ChainEnded(N)` boundary + applyReset |
| 2.3 | `CounterPulseProjection` | `MSG_ADD_COUNTER` / `MSG_REMOVE_COUNTER` | `AnimationCompleted({msgType ∈ COUNTER_MSG_TYPES})` |
| 2.6 | `AnimatingZoneProjection` | `MSG_FLIP_SUMMONING` / `MSG_CHANGE_POS` (FD→FU) / `MSG_CHAINING` (with zoneId) | `AnimationCompleted({msgType ∈ ZONE_MSG_TYPES})` |
| 3.1 | `IsAnimatingProjection` | `runner-started` / `runner-stopped` (InternalTransportEvents) | applyReset |
| 2.4-REDO | `SwapGraveDeckProjection` | `MSG_SWAP_GRAVE_DECK` | `AnimationPhaseCompleted({phase: 'glow'})` (Standardisation 1) |
| 2.2-REDO | `AnimatingLpProjection` | `MSG_DAMAGE` / `MSG_RECOVER` / `MSG_PAY_LPCOST` decorated with `lpDelta` (Standardisation 2) | `AnimationCompleted({msgType ∈ LP_MSG_TYPES})` |
| 4.1-REDO | `TargetedZoneKeysProjection` | `MSG_BECOME_TARGET` (FIELD locations only, union accumulation) | `AnimationPhaseCompleted({phase: 'reticle-pulse'})` (Standardisation 1) |

Slot 3.2 is intentionally absent — `chainResolutionAnnounce` (F15) is
a single dual-purpose signal owned by `ChainResolutionManager`, NOT
a projection. See Doctrine 3-bis below.

**Permanent drops (by design)** :
- `chainOverlayBoardChanged` (Lot 2.1) — replaced by
  `chainManager.hasBufferedEvents` getter.
- `confirmRevealedCards` (Lot 2.5) — orphelin (never set in prod). 3
  alternative mechanisms cover reveal : chain-tagged hand badges,
  `confirmCardsInHand` flip, `revealCardOnDeck`.

### Standardisation 1 — `phaseWait` + `AnimationPhaseCompleted`

`phaseWait(phase: string, durationMs: number, msgType: string):
Promise<void>` on the orchestrator combines a tracked
`scheduleTimeout` wait + a stream push. Emits
`AnimationPhaseCompletedEvent({phase, msgType, ref})` once the timer
fires. The `ref` is captured from `_transport_lastDispatchedRef` at
phaseWait call time (synchronous prefix of the async handler).

**Use-case** : handlers with INTERNAL sub-phases ending before the
overall animation completes (`MSG_SWAP_GRAVE_DECK`'s glow finishes
mid-handler before the travel). Projections observing the phase
boundary clear at the sub-step instead of waiting for the runner's
final `AnimationCompleted`.

**Caller's responsibility** : playback-speed scaling of `durationMs`
(typically via `ctx.scaledDuration(BASE, MIN)`) — symmetric with the
runner's already-scaled durations.

### Standardisation 2 — `decorateLpEventForStream` + `peekLpDelta`

`LpAnimationTracker.peekLpDelta(player, amount, type) → {fromLp,
toLp, durationMs}` is a pure read of the tracker's `trackedLp` —
NEVER mutates. The orchestrator's `decorateLpEventForStream(event)`
shallow-clones `MSG_DAMAGE` / `MSG_RECOVER` / `MSG_PAY_LPCOST` with
`lpDelta` attached, called BEFORE `pushToStream` in `processEvent`.

**Order contract** — `peekLpDelta` MUST run BEFORE `processLpEvent`.
If swapped, `fromLp === toLp` → silent animation freeze. Pinned by
`lp-animation-tracker.spec.ts` "β.3 R4" test pair (positive +
regression). The orchestrator's `processDirective.case 'lp'` path
follows the same contract for buffered LP replay.

### Doctrine — projection vs signal manager

Not every signal in the pipeline is a candidate projection. The β.3
chasse aux sorcières established these rules :

1. **A projection is dérivable du FLUX** — its value is a pure
   function of `(EventStream history, perspective, environment)`.
   Adding `BaseProjection<T>` is correct when the source data lives
   in events the pipeline already pushes.

2. **A signal manager is dérivable du STATE** — its value is a pure
   function of internal mutable state (a Map, a buffer, a counter)
   that lives in a manager. Examples that stayed managers in β.3 :
   `chainOverlayBoardChanged` (now `hasBufferedEvents` getter),
   `hasLockedZones` on the RBS (now `_locks.size > 0` getter).

3. **Sub-step timers internal to a handler** — when a signal clears
   via `setTimeout(...)` mid-handler (BEFORE the final
   `AnimationCompleted`), it needs Standardisation 1 (`phaseWait` +
   `AnimationPhaseCompleted`) to become migrable. Otherwise it stays
   in its manager. Examples migrated : `swapGraveDeckKeys` (phase
   `'glow'`), `targetedZoneKeys` (phase `'reticle-pulse'`, Lot 4.1-REDO).

3-bis. **Dual-purpose signal — reactive UI + sync predicate** — when
   a single signal serves BOTH a reactive Angular template / effect
   AND a synchronous predicate inside a manager method, do NOT split
   into a projection + private mirror pair. Keeping two writers in
   lock-step is fragile by construction — they may agree within a
   tick today but skew under any future timing change (F-bugB4
   2026-05-31 surfaced an infinite re-deferred loop caused by exactly
   this skew). The correct shape is a single `signal<T>` owned by the
   manager, read sync via direct call for the predicate AND exposed
   as readonly via `asReadonly()` for the reactive surface. The
   manager handles its own `applyReset` ; no projection-class wrapping
   needed. Reference implementation : `chainResolutionAnnounce`.

4. **External state dependency** — when a signal value depends on
   state outside the projection (e.g., LP's `fromLp` depending on
   `trackedLp`), the orchestrator decorates the event at push time so
   the projection consumes a self-contained payload (Standardisation
   2 pattern).

A signal that doesn't fit (1) and can't be made to fit via
Standardisation 1 or 2 isn't a candidate projection — it stays in
its manager and is documented in the drop list above.

### Wall-clock `AnimationCompleted` alignment

- `AnimationStarted({ref, msgType})` is emitted SYNC (right after
  dispatch).
- `AnimationCompleted({ref, msgType})` is emitted by
  `QueueRunner.onStepSettled(event, ref)` at the REAL wall-clock end
  of the awaited step (Promise.race resolve OR setTimeout fire). The
  runner reads the orchestrator's `_transport_lastDispatchedRef`
  synchronously after `handleEntry` returns. Captured at that moment
  so the NEXT handleEntry doesn't overwrite the ref before
  `onStepSettled` fires.

In a `group` directive, the inner events go through `processEvent`
directly (not `handleEntryAndAwait`) ; a `pendingCompletions` array
captures each event's ref + `AnimationCompleted` is emitted for every
event after the group's `Promise.all` resolves.

## Replay = PvP readonly via MockDuelConnection (v4, 2026-06-05)

**Doctrine** : the replay viewer runs the EXACT same animation pipeline
as a live PvP duel. A `MockDuelConnection` (`front/src/app/pages/pvp/replay/
mock-duel-connection.ts`) implements `AnimationDataSource` (same contract
as `DuelConnection`) and consumes a `ServerMessage[]` stream pre-computed
server-side instead of a live WS feed. Strict consequence : every code
path after `dispatchNext(msg)` in replay is identical to
`_handleMessage(msg)` in PvP — bugs reproduce by construction.

**Architecture (Phases 1-6 livrées 2026-06-05/06)** :

- **Server precompute** (`duel-server/src/replay-precompute.ts`) emits
  `REPLAY_STREAM_CHUNK + REPLAY_STREAM_INIT` as the SOLE output path
  (Phase 6 retired the legacy `REPLAY_BOARD_STATES` / `PreComputedState[]`).
  Each chunk carries `messages: ServerMessage[]`, `autoResponses:
  {offset, promptType, data}[]`, and `navEntries: ReplayStreamNavEntry[]`
  where each nav entry carries `{messageOffset, label, turnNumber,
  chainIndex?, responseCount, boardStateSnapshot, events: ServerMessage[],
  chainSnapshot?}`. The single `flushNavEntry` helper at every segmentation
  boundary (chain link start/end, phase, turn, boundary prompt, end of
  duel) builds the nav entry from the accumulated `events[]` + current
  `responseIndex` + board snapshot. The 1:1 mapping legacy-state ↔ nav
  entry is preserved by construction.
- **Client transport** (`ReplayTransportService`) reads `messages[]` via
  `mockConn.dispatchNext()` in `dispatchMockUntilIndex(targetIdx)`.
  Seek/scrub/skip call `mockConn.seekToOffset(index)` which restores
  rendered state + chain state in O(1) from `navIndex[index].boardStateSnapshot
  + chainSnapshot` (Phase 4). Auto-respond uses a fixed
  `REPLAY_PROMPT_DELAY_MS = 1200ms` (no more human timestamp math).
  `gameLog.rebuildUpTo(navIndex.slice(0, idx + 1))` re-feeds the
  `GameLogBuilder` after a seek using the per-entry `events[]` (Phase 6
  — `rebuildUpTo` signature accepts `{events, boardStateSnapshot}[]`
  structurally so `ReplayStreamNavEntry` satisfies it).
- **UI surfaces** (`busy`, `pendingPrompt`, `activeHint`,
  `activeConfirmedCards`, `activePlayer`, `activeResponse`,
  `perspectiveIndex`, `navIndex`) all live on `MockDuelConnection`. The
  legacy `ReplayDuelAdapter` retired Phase 5 ; `replayConnection.boardStates`
  + `clearBoardStates` retired Phase 6 (the connection service only
  forwards chunks via `onStreamChunk` / `onStreamInit` callbacks). The
  doctrine sections F19 (skip sites) + F29 (forceClosure asymmetry)
  become trivial because `mockConn.seekToOffset` runs the same reset
  path as the PvP `CHAIN_STATE` reconnect handshake (via the SHARED
  `chainingMsgsToLinkStates` + `processor.restoreChainState` helper).
- **Fork integration** : `ReplayForkService.fork(currentIndex, navIndex,
  replayId)` reads `entry.responseCount` (input to the server-side
  REPLAY_FORK payload's `responseCount`) and `entry.boardStateSnapshot`
  (input to the `expectedState` sanity check). `cachedNavIndex` (formerly
  `cachedBoardStates`) holds a snapshot during the fork-warning
  interstitial so the timeline keeps rendering.

**Tempo rule below is unchanged** — the v4 mock pipeline pumps
`dispatchNext` at the same cadence the v3 adapter did. Conceptually, a
replay is a PvP duel played at **maximum rate without latency or human
reflection**. The server emits states as fast as it can ; the client
paces playback to whatever its own animation pipeline can sustain.
**The client is the source of truth for the minimum tempo** — server
events queue, animations gate.

This has one structural consequence : any visual animation OUTSIDE the
main `QueueRunner` (overlays, prompt fade transitions, deck shuffles)
needs to contribute to a gate the replay scheduler observes ; otherwise
the auto-advance scheduler steps forward over an animation that is
still drawing, and the user sees a half-rendered transition before the
next state lands. The PvP side has the user clicking a button as the
natural rate limiter ; replay has no such pacing humans.

**The contract today is `PvpChainOverlayComponent.overlayActive`** — a
computed bool gating both `pvp-prompt-dialog`'s visible `dialogState`
(Approach A, F1 gate, 2026-06-03) and `ReplayTransportService.maybeAdvance`'s
`schedulePromptDismiss` window. The full list of bounded animations
that contribute, and the load-bearing list of state flags that MUST
NOT contribute (gating on `resolvingIndex` causes a POLL-DROP deadlock,
discovered the hard way during 2026-06-03 diagnosis), lives in the
docblock on the computed itself — see
[pvp-chain-overlay.component.ts:434-457](front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts#L434-L457).

**Adding a new out-of-queue animation** — a 4-point checklist :

1. **The animation MUST be bounded by construction** — entry / body /
   exit timers all known ahead of time, no waits on user input or on
   external signals that may not arrive. The chain overlay enforces
   this via per-phase `scheduleTimeout` with explicit hold tails
   (`OVERLAY_ANIM_HOLD_MS`, 400ms with 200ms floor).
2. **Contribute the animation's "in flight" flag to `overlayActive`** —
   or to a sibling aggregate signal a future evolution adds. The flag
   MUST flip false WITHIN the bounded window from (1) ; an unbounded
   flag will deadlock the replay scheduler.
3. **No new replay-side wiring is needed** — `ReplayTransportService.maybeAdvance`
   already gates on `overlayActive` (F1) ; new contributions to the
   aggregate naturally extend the gate. PvP's prompt-dialog reads the
   same signal via Approach A.
4. **Do not pile on `resolvingIndex` / `negatedResolvingIndex` / logical
   chain state** — these stay true across async cleanup flows
   (`replayBuffer`, `impactPause`) that the gate must NOT wait for.
   The "INTENTIONALLY NOT included" block in the docblock is authoritative.

PvP is unaffected by the gate (no auto-advance scheduler ; the user
clicks). The gate is replay-only, but the contract lives in a component
shared by both modes so the doctrine stays unified.

## Replay Board State Parity Rule

Replay must provide equivalent intermediate board states so
`updateLogical()` + `syncRendered()` produce the same rendered state as PVP.
Replay MUST NOT call `commitAll()` (reserved for `abort()`/`jumpToState()`);
it uses `syncRendered()` to respect the lock contract.

`assertNoLocks()` surfaces lock leaks at transition boundaries and PvP
reset points via `duelAssert()`. Throws in dev, `console.error`s in prod.

**Asserted sites (7 total — F19, 2026-05-31)**, ordered by call path :

- **PvP (`duel-connection.ts`)** :
  · `STATE_SYNC` handler — before `updateLogical + commitAll` (reconnect /
    cancel rollback). The server-side fresh state can't surface leaks
    from the prior animation pipeline if `commitAll` masks them first.
  · `REMATCH_STARTING` handler — before `commitAll`. The previous duel's
    pipeline MUST have settled all locks (chain end + queue drained)
    before the rematch transition.
  · `cleanup()` — duel teardown.
- **Animation orchestrator (`animation-orchestrator.service.ts`)** :
  · `resetAllState(scopes)` — before `commitAll`, after `finalizeAndCommit`.
    Any zone still locked here means a `lockZone` was never paired with a
    commit/release in the dispatch path that triggered the reset. v3 Phase 4
    (2026-06-04) — the legacy `tolerateLocks` skip is gone; the assert is
    now strict for ALL callers including `resetForReplaySeek`. The locks
    a seek mid-animation legitimately leaves behind are cleared by the
    earlier `clearTimersAndPolling → runner.requestStop() →
    rbs.dropOrphanedLocks('runner-requestStop')` (Phase 3) so the strict
    assert can re-take its role of canary for genuinely orphan locks
    (i.e. locks taken outside the runner's loop scope).
- **Replay (`mock-duel-connection.ts`, v4 Phase 5)** :
  · `seekToOffset(index)` — `processor.reset()` runs before the
    `rbs.commitAll('mock:seekToOffset')`. Locks from a seek mid-animation
    are cleared upstream by `orchestrator.resetForReplaySeek()` →
    `runner.requestStop()` → `dropOrphanedLocks` (called by the page's
    `abortAndClean()` BEFORE the transport's `seekToOffset`).

The v3 `ReplayDuelAdapter` step-queue API (`feedTransition`, `advanceStep`,
`collapseRemainingSteps`, `abort`, `jumpToState`) is retired ; the F19
skip sites it carried (3 call paths) collapsed into the single
`seekToOffset` site above.

Other `commitAll()` call-sites (draw-sequence-manager fallback paths,
buffer-replay-builder shuffle merge) are mid-pipeline flow recoveries,
not transition boundaries. They run with active locks by design and do
NOT assert.

Key rules:

1. **`buildSteps` final segment** MUST receive `finalBoardState` (the
   transition's `next.boardState`) as `pendingState`. This matches the PVP
   server's post-event BOARD_STATE (including shuffle results). The adapter
   passes this to `updateLogical()` so the orchestrator sees the correct
   logical state.

2. **`advanceStep` during chain** (chainPhase !== 'idle'): `updateLogical()`
   is called per step. Empty steps (0 animation events) call `syncRendered()`
   only when `chainPhase() === 'idle'`. During chain resolution, the
   orchestrator controls commits via locks and the chain overlay contract —
   `advanceStep` must not force-sync.

3. **`processAnimationQueue` queue-empty path**: `finalizeAndCommit()`
   MUST run BEFORE `setAnimating(false)`. In replay, `setAnimating(false)`
   triggers `advanceStep()` which calls `updateLogical()` with a future
   state. Committing first uses the correct current state.

4. **`boardStateAfter` per-event snapshot** (BOARD_CHANGING events during
   `chainResolving` only — see ws-protocol.ts). Attached server-side in
   both replay precompute (`replay-precompute.ts:runReplayPreComputation`)
   and live PvP (`duel-worker.ts:runDuelLoop`) via the shared
   `ChainSnapshotTracker` class — same code path on both sides guarantees
   parity by construction. `AnimationOrchestratorService.processEvent()`
   calls `rbs.updateLogical(event.boardStateAfter)` BEFORE dispatching the
   event so buffer replay progressively updates logical state per event
   instead of jumping to the chain's final state at commit. Field is
   optional: `filterMessage` sanitizes the snapshot per-player (opponent
   hand/deck hidden unless omniscient) to prevent info leak.

   **Window scope (2026-06-04 Option 2b)** — the `chainResolving` window
   spans the FIRST `MSG_CHAIN_SOLVING` of a chain through `MSG_CHAIN_END`
   (NOT `MSG_CHAIN_SOLVED`). Reason : a card that self-destroys reacting
   to its own resolution emits `MSG_MOVE` AFTER its `MSG_CHAIN_SOLVED`
   but BEFORE `MSG_CHAIN_END`. Without the extension, that MOVE has no
   `boardStateAfter` → client logical state lags → `preSrcLock.commit()`
   for the straggler copies a stale logical state to rendered → source
   card stays visible during the travel animation ("card in 2 places"
   symptom). Side-effect : the live PvP `CANCEL_PROMPT_SEQUENCE` gate
   (which reads `liveChainTracker.isResolving`) is now also active
   between the last `MSG_CHAIN_SOLVED` and `MSG_CHAIN_END` — cancel is
   semantically incorrect there (chain not finished, OCGCore still
   emitting effect-bound events), so the broader gate is the right
   behavior.

   **Tracker lifetime across `runDuelLoop` calls (2026-06-04 Option O)** —
   `liveChainTracker` is hoisted to module scope in `duel-worker.ts` and
   was historically `.reset()`-ed at every `runDuelLoop` entry to "preserve
   per-call semantics". Post-Option 2b that reset became a bug : a chain
   that includes a player prompt mid-resolution (e.g. `SELECT_CARD` for a
   discard cost — `MSG_CHAIN_SOLVING + MSG_DRAW + MSG_SHUFFLE_HAND +
   SELECT_CARD` in one call, then `MSG_MOVE + MSG_CHAIN_SOLVED + MSG_MOVE
   + MSG_CHAIN_END` in the next call) loses its window between the two
   calls — every post-prompt MOVE was emitted with `_chainResolving =
   false`, no `boardStateAfter` attached, client logical never advances
   for those events. The fix : the per-call `.reset()` is NO LONGER
   called. The tracker self-resets at `MSG_CHAIN_END` (its only legitimate
   close trigger). Module-level state survives across PLAYER_RESPONSEs
   inside a chain. Terminal resets still happen at duel start (fresh
   module instance), rematch (worker terminated), and STATE_SYNC (the
   tracker is recreated locally for the replay precompute path).

   **Client BOARD_STATE skip during resolving + queue non-empty
   (2026-06-04 Option N)** — `syncAfterBoardState` (animation-data-source.ts)
   skips its `updateLogical(boardState)` when `chainPhase === 'resolving'
   && queueLength > 0`. Reason : the server emits a BOARD_STATE
   immediately after `MSG_CHAIN_END` while events from the chain are
   still pending in the client queue. If that BOARD_STATE were applied
   to logical now, the next MOVE's `commitZone` (e.g. GY-0 at the end of
   the first MOVE's travel) would copy the FINAL post-chain state to
   rendered — including cards that haven't been animated yet — and the
   following MOVE's destination card appears at its DOM destination
   before its own travel even starts ("card appears in cemetery before
   self-destroy travel" symptom). With Option O above, per-event
   `boardStateAfter` snapshots are the canonical source of logical
   advancement during the resolving window ; the mid-chain BOARD_STATE
   is redundant for these zones and harmful for the dispatch-order
   invariant. The skip is bounded : as soon as `queueLength === 0` the
   skip lifts and the next BOARD_STATE (or STATE_SYNC) syncs normally.
   The previous DOCTRINE that "BOARD_STATE was the sole source of
   logical sync mid-chain" no longer holds — per-event snapshots ARE
   the source, BOARD_STATE is the fallback.

   **Replay perspective swap** — `boardStateAfter` arrives in absolute
   server P0 order (replay precompute is perspective-agnostic). The
   orchestrator is shared with PvP and assumes already-relative data, so
   `MockDuelConnection` MUST relativize the per-event snapshot for
   `perspectiveIndex === 1` — the mock's `_maybeSwapBoardState` at
   `dispatchNext` time rewrites the event's `boardStateAfter` via
   `swapBoardState()` before forwarding to the processor. Skip the swap
   and perspective-1 replays render the board flipped for one frame
   when the orchestrator calls `updateLogical(event.boardStateAfter)`.

5. **`ReplayStreamNavEntry.chainSnapshot` mid-chain seek restore**
   (F9-bis, 2026-06-04 ; Phase 6 absorb 2026-06-06). When a nav entry
   is captured while a chain is open (`chainPhase !== 'idle'`),
   `replay-precompute.ts` embeds a snapshot of the server-side
   `ChainStateContainer` : `{ links: ChainingMsg[], phase, negatedIndices,
   currentSolvingChainIndex }`. `MockDuelConnection.seekToOffset` applies
   it via the SAME restore code path as the PvP `CHAIN_STATE` reconnect
   handshake — shared helper
   [chain-state-restore.utils.ts](front/src/app/pages/pvp/duel-page/chain-state-restore.utils.ts)
   `chainingMsgsToLinkStates` + `processor.restoreChainState` +
   conditional `processor.applyChainSolving(currentSolvingChainIndex)`.
   Without this, seeking into the middle of a chain wipes
   `activeChainLinks` (via `processor.reset()`) and leaves the chain
   overlay + chain badges empty even though the target state is
   semantically inside a chain. The PvP reconnect handshake doesn't
   carry `currentSolvingChainIndex` because the live worker fires
   `MSG_CHAIN_SOLVING` as a real message immediately after — replay
   can't, so the field is necessary for the in-resolution link to be
   visually distinguished (`resolving: true`) on seek. `replay-handlers.ts`
   caches the source `WorkerReplayPayload` (not the precomputed nav
   index), so existing replays re-precompute on next open and inherit
   any precompute changes immediately. See F9-bis section above for the
   3-consumer table + precompute timing rule.

### Chain State Machine Rules

1. **`ChainResolutionManager.isResolving`** is a **pure observer** of
   `DuelEventProcessor.chainPhase()` — wired at construction via
   `attachChainPhaseSource(() => dataSource.chainPhase())`. The manager
   does NOT own a parallel flag; the processor is the single source of
   truth. Phase transitions: `idle → building → resolving → idle`.
   `'resolving'` is set by `applyChainSolving(chainIndex)` (driven by the
   orchestrator after `chainManager.handleSolving`) and remains true
   across all links of the same chain — it only flips back to `'idle'`
   at `applyChainEnd()` (MSG_CHAIN_END). All BOARD_CHANGING_EVENTS while
   `isResolving` is true are buffered. The buffer is replayed after the
   chain overlay hides, using queue directives (group, barrier, lp,
   batch-end, await-signal). **Regression guard** — `handleSolving` MUST
   NOT re-acquire ownership of an `_insideChainResolution` flag; the
   spec test "handleSolving alone does NOT flip isResolving" catches it.

2. **`chainSolvedCount`** tracks how many links resolved in the current
   chain. ONLY reset at MSG_CHAIN_END. Drives the first-multi-link banner
   animation. Between consecutive chains in the same turn, resets via
   CHAIN_END.

3. **Queue collapse** — LP-only predicate. Triggers only when **every**
   queued entry is a LP-class event (`MSG_DAMAGE`, `MSG_PAY_LPCOST`,
   `MSG_RECOVER`) since `applyInstantAnimation()` only knows how to fold
   those. Visual events (MSG_MOVE, MSG_DRAW, MSG_CONFIRM_CARDS,
   MSG_FLIP_SUMMONING, etc.) MUST NOT be collapsed — dropping them would
   silently skip the animation while the zone still syncs via
   `commitUnlocked()`. Chain events + directives are naturally excluded
   (not LP-class).

4. **Replay stagger guard** — draw sequence resume and `confirmCardsInHand`
   check `hasActiveReplayTimeouts` before calling `processAnimationQueue()`.
   This prevents premature queue advancement while `replayBuffer()` is
   actively staggering events. Replay timeouts are bulk-cleared at chain
   reset.

5. **Chain poll** — when the queue empties during `deferred` commitMode
   (`chainPhase === 'resolving'`), the orchestrator only polls if
   `isWaitingForOverlay` is true (post-CHAIN_SOLVED, overlay replaying
   buffered events). Otherwise it finalizes — in replay, CHAIN_SOLVED may
   be in the next step, and polling would deadlock. Poll ceiling force-resets
   chain state as a safety net. During `building` phase, `commitMode` is
   `'per-event'` — queue-empty finalizes normally.

6. **Mid-chain buffer drain rescue (2026-06-04)** — `decideNextStep`'s
   `pre-replay-buffer` branch fires whenever `isResolving && hasBufferedEvents`,
   regardless of `hasPendingPrompt`. Covers two scenarios with the same remedy
   (`replayBuffer(inlineFromLoop=true)`) :
   - **Mid-chain pre-replay (legacy)** — a prompt arrived while the chain is
     still resolving and the buffer is non-empty. Flushing ensures the player
     sees animations before answering.
   - **Post-MSG_CHAIN_SOLVED straggler** — a BOARD_CHANGING event was buffered
     AFTER the overlay-driven `replayBuffer` already drained this link's queue
     but BEFORE `chainPhase` flipped to `'idle'` (which only happens at
     MSG_CHAIN_END dispatch). In replay, `MSG_CHAIN_END` lands as a distinct
     `ReplayStreamNavEntry` produced by `replay-precompute.ts` (chain
     separator in the timeline, label `'MSG_CHAIN_END'` hidden by
     `HIDDEN_SUB_EVENT_LABELS`) and won't be reached by `dispatchMockUntilIndex`
     until `chainPhase=idle` — without an autonomous drain, the deadlock is
     circular (buffer holds the event → `chainPhase` stuck `resolving` →
     transport refuses to advance to the CHAIN_END entry). PvP bonus
     side-effect : 2 batches separated instead of one with lock GY-0
     ref-count=2 shared on stacked MSG_MOVE.

   `pause-external` (priority 1 — `isWaitingForOverlay || hasDrawsInFlight`)
   preempts this rescue ; the overlay-driven `replayBuffer` from
   `onChainLinkResolved` handles the first drain. The rescue handles whatever
   straggles after.

## Perspective Convention (absolute vs relative player index)

Two player-index referentials coexist — mixing them is a recurring bug
class ("the board briefly flips", "Equip line points at the wrong half"):

- **Absolute** — raw OCGCore index (server player 0 / 1). What the duel
  worker emits.
- **Relative** — `0` = the viewer ("me", bottom of board), `1` = the
  opponent (top). What the animation pipeline + DOM zone keys
  (`${zoneId}-${relPlayer}`) assume.

**Server-side relativization is partial.** `message-filter.ts`
`sanitizeBoardState` swaps `players[]` and `turnPlayer` to relative — but
NOT the `player` / `controller` fields buried inside cards, zones, prompt
entries, or chain links (see the Story 4.2 TODO at `message-filter.ts`).
Those stay **absolute** in both PvP and Replay.

**Replay-side swap is also partial by construction.** `ReplayDuelAdapter`
precompute data arrives in absolute server order; `swapBoardState()` swaps
`players[]` + `turnPlayer`, and `swapEventBoardStates()` swaps the
per-event `boardStateAfter`. Anything else absolute stays absolute.

**Rules:**

1. Any index used to build a DOM zone key `${zoneId}-${X}` MUST be
   relative. Convert an absolute index with the canonical idiom
   `const rel = absolute === ownPlayerIndex ? 0 : 1` (PvP/board) or
   `=== perspectiveIndex` (replay-page), or `ctx.relativePlayer(absolute)`
   inside the orchestrator/managers.
2. `DuelContext.ownPlayerIndex()` and `pvp-board-container`'s
   `ownPlayerIndex` input are **absolute** — so `absolute === ownIdx`
   comparisons are valid. In replay, `ownPlayerIndex` is fed
   `perspectiveIndex()`.
3. The prompt pipeline (`pvp-prompt-dialog` + sub-components) runs
   **fully absolute end-to-end**: `CardInfo.player`, `PlaceOption.player`,
   and the `ownPlayerIndex` it receives (`activePlayer()` = `decision.player`
   in replay) are all absolute. Do NOT relativize `activePlayer` — it would
   desync against the absolute `card.player`. Internal keys like
   `confirmedCardKeys` (`${location}-${player}-${sequence}`) are absolute on
   both sides and never hit the DOM zone registry.
4. `HintContext.player` is currently dead (never read by any renderer) —
   leave it absolute; do not build new logic on it without relativizing.

**Known-correct relativizers** (reference idiom): `chainBadges` +
`linkedZoneMap` (pvp-board-container), `target-indicator-manager`,
`prompt-derivation.service`, `replayHighlightedZones`/`replayChosenZone`
(replay-page), all `ctx.relativePlayer()` callers in the orchestrator.

### Relativizer routing discipline (F6, 2026-05-31)

Every absolute→relative conversion `abs === ownIdx ? 0 : 1` for DOM
zone-key building is now routed through `DuelContext.relativePlayer()`
where the call site has access to `DuelContext` (the conversion lives
in one place — change the semantics of "relative" once, every site
follows). Refactored sites :

- [target-indicator-manager.ts](front/src/app/pages/pvp/duel-page/target-indicator-manager.ts) — `spawnPileFloats` uses `this.ctx.relativePlayer(target.player)`.
- [duel-page.component.ts](front/src/app/pages/pvp/duel-page/duel-page.component.ts) — `onPreTargetCards` + `onZoneSelected` use `this.duelCtx.relativePlayer(c.player / pl.player)`.
- [pvp-board-container.component.ts](front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts) — `chainBadges` + `linkedZoneMap` go through a private `toRelativePlayer()` helper that injects `DuelContext` optionally and falls back to the input idiom in standalone preview specs.
- [replay-page.component.ts](front/src/app/pages/pvp/replay/replay-page.component.ts) — `replayHighlightedZones` + `replayChosenZone` use `this.duelCtx.relativePlayer(pl.player / place.player)`. Replay configures `duelCtx.ownPlayerIndex = () => perspectiveIndex()` so the helper is equivalent to the prior `=== perspectiveIndex() ? 0 : 1` inline.

**Sites intentionally left with the inline idiom** :

- [prompt-derivation.service.ts](front/src/app/pages/pvp/duel-page/prompt-derivation.service.ts) `highlightedZones` (1 site) — the service follows the two-phase init pattern (closures over signals, not DI), so it doesn't inject DuelContext. If a SECOND absolute→relative conversion ever lands in this service, add `relativePlayer: (abs) => 0 | 1` to `PromptDerivationConfig` and route through it instead of duplicating the idiom.
- Components with `ownPlayerIndex: input<Player>` that don't read `controller`/`player` fields from absolute payloads ([pvp-board-container](front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts) `playerLpAnim`/`opponentLpAnim`, [prompt-card-grid](front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts), [timeline-bar](front/src/app/pages/pvp/replay/timeline-bar/timeline-bar.component.ts)) — these run a boolean "is mine" test, not an absolute→relative conversion. Routing through `ctx.relativePlayer()` would be a no-op : the test is already absolute-vs-absolute.
- Pure utility functions taking `ownPlayerIndex` as a parameter ([chain-badge.utils.ts](front/src/app/pages/pvp/duel-page/chain-badge.utils.ts)) — by design absolute-agnostic, no ctx access.
- `mySide()` / "other side of mySide" computations in replay-page + topbar + mini-board-thumbnail — these compare with `userPseudo` (the LOGGED-IN user's position in the replay) or invert `mySide()`, NOT the viewer's perspective. Different semantic, not refactorable to `ctx.relativePlayer()`.
- `absoluteTurnPlayer` in pvp-board-container — inverse direction (relative→absolute), not the routing target.

**Enforcement** : there is currently no automated lint rule that flags
new `${zoneId}-${X}` builders where X is not provably relative. The
gate is review-time discipline + this checklist. If you add a new
relativizer, add it to the Known-correct list above and route through
`ctx.relativePlayer()` whenever possible.

**SOLO PvP — perspective is a projection signal (γ, 2026-05-27).**
`DuelContext.perspectiveSource` (tag α.1 `*Source`) is a
`WritableSignal<0 | 1>` written by `SoloDuelOrchestratorService.switchPerspective`
and read by every relativizer. A SOLO switch flips the signal +
emits `PerspectiveSwitched` on the EventStream + dispatches
`applyReset({PERSPECTIVE_LIFETIME})` — the processor state
(activeChainLinks, chainPhase, pendingChainEntry, locks, queue) is
NOT touched (CONNECTION_LIFETIME, survives). `DuelGameLogService`
re-relativises the journal entries on flip via the
`effect(() => gameLog.setPerspective(ownPlayerIndex()))` wired in
`duel-page.component.ts:606` (R10 acted at γ §8 spec). PvP normal +
replay leave `perspectiveSource` at its default 0.

**Convention §5.2 POC — révisée γ-c c10 (2026-05-29).** Le switch SOLO
n'est PAS bloqué pour TOUS les prompts pending mais seulement pour les
prompts MODAUX (`SELECT_CARD`, `SELECT_CHAIN`, `SELECT_PLACE`,
`SELECT_TRIBUTE`, …). La whitelist `IDLE_PHASE_PROMPT_TYPES` dans
[solo-duel-orchestrator.service.ts](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts)
autorise explicitement `SELECT_IDLECMD` (Main Phase 1/2) et
`SELECT_BATTLECMD` (Battle Phase) — ces prompts sont l'état stable
d'attente du joueur actif pendant TOUTE sa phase, donc les bloquer
revient à interdire le switch tout au long du tour. Bug user-facing
remonté 2026-05-29 : "je clique P1 et rien ne se passe alors que je
n'ai aucun prompt modal ouvert". Tests pinning : 4 cas dans
`phase-gamma-victory.spec.ts` (IDLECMD/BATTLECMD autorisés ;
CARD/CHAIN/PLACE bloqués).

## Orchestrator Decomposition

`AnimationOrchestratorService` is a thin coordinator that delegates to
8 extracted managers/classes. The processor (chain state machine +
animation queue) lives on the `DuelConnection` / `ReplayDuelAdapter`
that owns the WS / precompute feed, NOT on the orchestrator — see the
"Chain Event Processing & State Machine" section above for ownership
rules post-c8.

- **`ChainResolutionManager`** — chain state (signals, buffer, replay
  timeouts, solved count). Pure state + `drainBuffer()`. Orchestrator
  owns `replayBuffer()` (cross-cutting dispatch via queue directives).
  α.4b: `ResetTarget` with declared scope **`PERSPECTIVE_LIFETIME`**
  (the most volatile slice — banner + replay timers); `applyReset`
  branches on `scopes.has('CONNECTION_LIFETIME')` for the full chain
  state reset (signals + buffer + counters + deferred peek). The
  cascade guarantees a CONNECTION/DUEL/SESSION reset also carries
  PERSPECTIVE, so the timers are cleared as part of the full reset.
- **`DrawSequenceManager`** — draw sequences, hand expansion, shuffle
  processing, card confirmation.
- **`MoveAnimationRouter`** — MSG_MOVE routing via `MoveContext`, overlay
  detach, source + destination pre-locking. Field-destination branches
  lock dst synchronously (no imperative DOM hiding).
- **`LpAnimationTracker`** — LP tracking, counter animation, pending LP
  commit. α.4b: `ResetTarget` with declared scope **`DUEL_LIFETIME`**
  (the most durable slice — `trackedLp` + `_pendingLpCommits`);
  `applyReset` branches on `scopes.has('PERSPECTIVE_LIFETIME')` to
  clear `animatingLpPlayer` separately. A `PerspectiveSwitched` (which
  carries only PERSPECTIVE_LIFETIME) does NOT reach this manager — the
  declared scope is DUEL, deeper than PERSPECTIVE in the hierarchy, so
  the dispatcher's filter skips it. This is the **mirror** of
  ChainResolutionManager.
- **`BattleAnimationTracker`** — in-progress attack animations (attack
  line + clash impact), pending attack release. α.4b: `ResetTarget`
  with scope **`PERSPECTIVE_LIFETIME`** — all carried state cleared
  on every switch.
- **`TargetIndicatorManager`** — `MSG_BECOME_TARGET` reticles for cards
  inside pile zones (GY, Banished, Extra Deck). Pile zones only render
  their top card, so a separate float layer is needed to point at
  sequence > 0 cards. Field-zone targets live on the orchestrator's
  `targetedZoneKeys` projection (Lot 4.1-REDO,
  `BaseProjection<ReadonlySet<string>>`).
- **`BufferReplayBuilder`** — owns the 3-pass batch construction for
  `replayBuffer` (see "Buffer Replay Batch Construction" section below).
  `build(buffer)` returns `{ batch, releaseSessionLocks }`. The
  orchestrator stays as dispatch policy: drain → call builder → prepend
  batch + `batch-end` + `await-signal` directives.
- **`QueueRunner`** (Paliers A + B + C, 2026-05-23; α.3 wrapper, 2026-05-25)
  — async animation loop, decision step (`decideNextStep` pure), and the
  lifecycle primitives (`_isRunning`, `_isProcessing`, `_innerLoopDepth`,
  `_abort: AbortController` (palier C, replaced the maison
  `_resetGeneration` token), `_rescueNoProgressCount`,
  `_lastRescueQueueLen`). **All 5 primitives are `PERSPECTIVE_LIFETIME`
  transport state** in the §3.2 sense — annotated in-file at their
  declaration; cleared/installed-fresh by every `requestStop()`. Owns
  the per-step `setTimeout` + travel `Promise.race` guard. Business
  dispatch (per-type handlers, directive switch, pre-activation buffer)
  stays in the orchestrator and is reached via `QueueRunnerDeps`
  callbacks; the runner never imports YGO types. Plain class,
  instantiated in the orchestrator constructor. `_isAnimating`
  (orchestrator's exposed signal) is synchronised via the runner's
  `onIsRunningChange` callback — orchestrator-side façade, runner-side
  source of truth. **α.3 adds an optional
  `onInternalEvent?(e: InternalTransportEvent)`** sink in
  `QueueRunnerDeps` — the runner emits `runner-started`,
  `runner-stopped`, `rescue-fired`, `rescue-abandoned`, `watchdog-armed`
  (see `queue-runner-events.ts`). Sink errors are swallowed
  (fire-and-forget); omitting it is back-compat. Two unit suites cover
  the lifecycle: `decideNextStep` (pure decision branches) + `QueueRunner
  (loop)` (notifyEnqueue / requestStop / rescue / finalize / await-signal
  / abort invalidation / onInternalEvent emissions).

**Other `ResetTarget` implementers** (documented in their dedicated
sections — listed here so the scope-reset inventory is complete) :

- **`DeferredEffectProcessor`** — scope `CONNECTION_LIFETIME`. Owned by
  `AnimationOrchestratorService` (not by a manager). See "DeferredEffectProcessor"
  section for the rules table + emission contract.
- **`DuelGameLogService`** — scope `DUEL_LIFETIME`. Subscribes to the
  EventStream. See "EventStream vs AnimationQueue" + the perspective-
  switch wire (`gameLog.setPerspective`).

Adding a new checkpoint reset path → check both lists (the 8 managers
above + these 2) so no `ResetTarget` is missed.

**`DuelContext`** is the shared context for all managers. API surface:

- **Component-bound closures** (set via `configure({ ownPlayerIndex,
  speedMultiplier, isBoardActive })`): `ownPlayerIndex()`, `speedMultiplier()`,
  `isBoardActive()`. MUST be configured before first read — `duelAssert()`
  fires if not.
- **Reactive signal**: `reducedMotion` (auto-tracks
  `prefers-reduced-motion` MQ).
- **Player helpers**: `relativePlayer(absolute) → 0|1`, `announceEvent(text,
  player)` (LiveAnnouncer with "Opponent: " prefix when not own).
- **Timing helpers**: `scaledDuration(base, min=0)` for animation budgets,
  `safetyTimeout(baseMs)` for guard timers (divides by speedMultiplier
  then adds 50% margin, so slow playback doesn't clip and loaded hardware
  has slack).
- **Card rotation helpers**: `cardBaseRotation(rel) → 180|undefined` for
  float orientation (cards face their owner), `cardBaseRotateCSS(rel) →
  string` for inline transform fragments, `zoneCardRotation(isDefense)
  → 0|-90` for Web Animation interpolation (atan2 reads CSS 270° as
  -90°, so we use -90° to force the 90° CCW shortest path).

**DI graph:** Chain ← Draw ↔ Move (Move injected lazily in Draw).
Move depends on Draw for `travelToHand()`. Draw depends on Move
(lazy `injector.get()`) for `processShuffleEvent` → `processMoveEvent`.
Draw depends on Chain for `hasActiveReplayTimeouts`. Chain has zero
cross-manager deps.

## Card Travel Stack

The card-travel subsystem is split into 3 services (M11 Phases 1+2):

- **`CardTravelEngine`** (`card-travel-engine.service.ts`) — animates card
  travel from a source zone/element to a destination zone/element. Owns:
  zone resolver registry (`registerZoneResolver` / `getZoneElement`),
  container element (`registerContainer` / `getContainer`), geometry +
  keyframe computation (via `card-travel-helpers`), animation kickoff,
  departure/impact glow timers, `createLineBetween`, `toAbsoluteUrl`.
- **`BoardEffectsService`** (`board-effects.service.ts`) — autonomous
  visual effects anchored to a zone/element: `zoneImpactEffect`,
  `slamDustParticles`, `preDestroyEffect`, `activateEffect`,
  `createTargetFloat` / `removeTargetFloat` / `fadeOutAndRemoveTargetFloat`.
- **`FloatRegistryService`** (`float-registry.service.ts`) — tracks the
  lifecycle of float elements created by `CardTravelEngine.travel()`.
  Owns the in-flight `Map` and the landed `Set` plus the LIFO/FIFO
  `popLandedFloat`, prefix queries, `stabilizeFloat`, `cancelTravel`,
  `clearAllTravels`, `inFlightByZone` (LOCK-ASSERT consumer).

**Single entry point** for adding a float to the registry:
`FloatRegistryService.register(el, animation, onLand?)` returns a
cancel-safe `Promise<void>` (resolves on both `animation.finished`
success AND on `animation.cancel()` rejection). The Engine never
touches `_inFlight`/`_landed` directly.

**`clearAllTravels` cancels (not finishes)** so the registered
`.finished.then()` callback does NOT asynchronously re-add the element
to `_landed` after the registry was cleared.

**DI graph:** Engine ↔ BoardEffects (intentional cycle, resolved via
Angular field-level `inject()` — `travel()` calls into
`zoneImpactEffect` / `slamDustParticles` for soft/banish/slam landings,
while BoardEffects reuses Engine's zone registry rather than duplicating
it). Engine → FloatRegistry. FloatRegistry has zero cross-service deps.

`RenderedBoardStateService.attachFloatRegistry(svc)` wires the
LOCK-ASSERT observer (the assertion only ever needed `inFlightByZone()`).

## Async Handler Lock Contract

Event handlers in `processEvent()` MUST call `lockZone()` on ALL zones they
animate (source AND destination) synchronously before the first `await`.
`commitUnlocked()` runs immediately after `processEvent()` returns — any
unlocked zone will be committed.

For field-destination moves (MZONE/SZONE), the destination lock keeps the
rendered state at "zone empty" until `dstLock.commit()` fires after the
travel float lands. No imperative DOM hiding is needed.

Pre-locking (`MoveAnimationRouter.preLockQueuedSources`) protects both
source AND destination zones of future queued MSG_MOVE events from
premature `commitUnlocked()` sync. `buildMoveContext()` consumes both
src and dst pre-locks via `consumePreLock()`. Each branch method either
reuses the dst pre-lock as its animation lock (`mc.preDstLock ??
this.rbs.lockZone(mc.dstKey)`) or releases it if the destination has its
own lock management (HAND via `travelToHand`, DECK never locked).

The orchestrator releases any remaining pre-locks after `processEvent()`
unconditionally (not gated on `result === 0`). For animated MSG_MOVE
branches this is a no-op (already consumed by `buildMoveContext`). For
MSG_DRAW it cleans up the HAND pre-lock that `launchInitialDraw` replaces
with its own `earlyLocks`.

**EXCEPTION — buffered events**: when `chainManager.isResolving` and the
event type is in `BOARD_CHANGING_EVENTS`, `processEvent` returns 0 after
`bufferIfResolving()` without running the branch. The orchestrator's
`releasePreLocksForKeys` is skipped in this case — the pre-locks stay
alive in the map and are consumed later when `replayBuffer()` replays
the buffered events via group directives. `MSG_CHAIN_END`'s
`releaseAllPreLocks()` is the safety net for unreplayed pre-locks.

Initial draws lock both HAND zones synchronously before the first `await`.
DECK is NOT locked (locking before first BOARD_STATE freezes `deckCount=0`
from `EMPTY_DUEL_STATE`, hiding the pile). Inner locks ref-count; outer
early locks commit in `finally`. Pre-locks run AFTER `syncAfterBoardState()`
— safe because `syncAfterBoardState` only calls `syncPileCounts()` when
the queue has events, never `syncRendered()`.

### Pre-activation Buffer (defense in depth, post-`ANIMATIONS_READY`)

Historically this buffer absorbed a **wide** race window in SOLO
multiplex: the worker spawned the instant the lone WS connected, and
emitted MSG_DRAW × 5 + BOARD_STATE before the client had finished its
thumbnail prefetch. `boardActive=false` during that window, so events
parked in `_preActivationBuffer` and drained later via a 200ms breathe
beat. PvP normal hit a much narrower window — the dice arena flow
gave 5-10s of "human pause" between connection and worker spawn.

Post-`ANIMATIONS_READY` protocol (2026-06-05) the wide SOLO window is
closed at its root: the server's `isReadyToStart` gate waits for the
client's `ANIMATIONS_READY` message (emitted on `thumbnailsReady=true`)
before spawning the worker. The buffer's role narrows to **defense in
depth** absorbing the tick-level window between the first BOARD_STATE
landing and `setBoardActive(true)` flipping :

1. BOARD_STATE arrives → `_handleBoardState` → `updateLogical` → the
   `logicalState` signal flips → `boardReady` computed flips
2. The next Angular effect tick fires `duel-loading → active` →
   `setBoardActive(true)` + `roomState.set('active')` + `drainPreActivationBuffer()`

If MSG_DRAW × 2 arrives in the same WS batch as BOARD_STATE (Node + ws
deliver TCP-grouped frames sequentially in the same tick), it will hit
`_dispatchEvent` BEFORE the effect tick can flip `boardActive` → it
parks in the buffer. The drain re-injects it 200ms later, after
`boardActive=true`, and the animation plays correctly.

`DuelLoadingEffectsService.duel-loading → active` effect orders:
1. `setBoardActive(true)` — gates downstream handlers.
2. `roomState.set('active')` — dismisses the dice arena.
3. `orchestrator.drainPreActivationBuffer()` — schedules
   `prependToQueue(buffer)` + `processAnimationQueue()` after a
   `ctx.scaledDuration(BOARD_BREATHE_MS, BOARD_BREATHE_MIN_MS)` beat
   (500ms base, floors at 200ms under slow-playback).

Step 1 MUST precede step 3 — the drain re-enters `_handleEntry`, which
re-checks `isBoardActive()`; if it ran before the flip, events would be
re-parked instantly.

`clearTimersAndPolling` clears the buffer + the `_preActivationDrainScheduled`
flag so a hard reset (rematch, switch, destroy) does not carry stale
draws into the next duel. The `processDrawEvent` legacy guard is
retained as defense-in-depth with a `logger.warn` — reaching it now
indicates a bypass of the buffer, not the expected silent-skip.

### `ANIMATIONS_READY` client-controlled worker spawn gate (Direction B)

Client → server message that gates the server-side worker spawn on the
client's visual readiness. Pre-protocol the SOLO bootstrap spawned the
worker the instant the WS connected and emitted MSG_DRAW × 5 before the
client had finished its thumbnail prefetch — events parked in the
pre-activation buffer, the chain resolved before the drain, events lost
permanently.

**The deadlock** : the naive design "emit ANIMATIONS_READY when
thumbnailsReady=true" is circular. `thumbnailsReady` flips when
`preFetchCardImages` finishes, which is gated on having `cardCodes`
populated, which historically arrived on `DUEL_STARTING` (post-worker-spawn)
or `DECK_PREFETCH` (post-dice in PvP). Worker spawn requires
`ANIMATIONS_READY` → cycle.

**The break (Direction B)** : a new server → client message
`EARLY_DECK_PREFETCH` is emitted by `pvp-connection-handler` immediately
after `SESSION_PHASE`, BEFORE the worker spawn / dice flow. It carries
`cardCodes` (always available from `session.decks` at that point). The
client's `DuelLoadingEffectsService` triggers `preFetchCardImages` on
`wsService.cardCodes()` non-empty (no `roomState` gate), so the chain
runs:
1. WS handshake → SESSION_TOKEN → SESSION_PHASE → **EARLY_DECK_PREFETCH**
2. Client `_handleEarlyDeckPrefetch` sets `_cardCodes`
3. Loading service effect fires `preFetchCardImages` (HTTP `/api/decks/{id}` + Image preloads)
4. `thumbnailsReady = true`
5. Loading service effect fires `wsService.sendAnimationsReady()` (gated on `thumbnailsReady=true` AND `connectionStatus === 'connected'`)
6. Server `animationsReady[i] = true` → `isReadyToStart` re-eval → spawn worker / dice flow / FORK_RESUME

**Server-side state** : `ActiveDuelSession.animationsReady: [boolean, boolean]`.
Init `[false, false]` in `createInitialSessionState`, reset to
`[false, false]` in `resetSessionForRematch`.

**Server-side handler** : `client-message-router.ts` `case 'ANIMATIONS_READY'`.
Idempotent — a second emission from the same slot is logged-and-ignored.
Calls `cfg.onAnimationsReady(session, playerIndex)`, wired in `server.ts`
to re-evaluate the gate and trigger the next phase:
- PvP normal + `phase === 'WAITING_PLAYERS'` → `startFirstPlayerPhase(session)`
- SOLO multiplex + `phase === 'WAITING_PLAYERS'` → `startDuelWithOrder(session, 0)`
- Fork + `phase === 'DUELING' && forkMode` → `worker.postMessage({ type: 'FORK_RESUME' })`

**Server-side emission of `EARLY_DECK_PREFETCH`** : in `pvp-connection-handler`,
immediately after `sendToPlayer(... SESSION_PHASE ...)`. PvP normal sends
own deck only (no info leak). SOLO multiplex also sends `bothCardCodes`
(parity with `DuelStartingMsg`). Pinned source-level by
`pvp-connection-handler.spec.ts` (order: SESSION_PHASE → EARLY_DECK_PREFETCH
→ isReadyToStart branch).

**Client-side emission of `ANIMATIONS_READY`** : `DuelLoadingEffectsService`,
gated on `(thumbnailsReady === true) && (wsService.connectionStatus() === 'connected')`.
The dual gate prevents the silent-drop bug where emission before
`SESSION_TOKEN` lands would hit `safeSend`'s `readyState !== OPEN` arm.
Idempotence : `_animationsReadySent` local flag; reset by the rematch
effect.

**Rematch flow** : `resetSessionForRematch` server-side resets
`animationsReady = [false, false]`. Client-side, the loading service's
rematch effect (`wsService.rematchStarting() === true`) resets
`_animationsReadySent = false`, `prefetchStarted = false`, and
`thumbnailsReady.set(false)`. The chain then re-fires automatically since
`_cardCodes` is still populated (carried over from the previous duel).
- **Backward compat** : `PROTOCOL_VERSION` bumped to `2`. Old clients
  that don't know the message are rejected at WS handshake with
  close-code 4426 → forced refresh → new bundle. No timeout fallback
  server-side ; the protocol bump is the structural backward-compat
  fence.

Cf. `_bmad-output/planning-artifacts/animations-ready-protocol-2026-06-05.md`.

### Pre-lock Handle Ownership

1. **`travelToHand(src, relPlayer, cardImage, options, targetIndex?,
   externalHandLock?, cardCode?)`** — HAND-destination branches
   (`bounceToHand`, `pileToHand`, `fallback→HAND`) MUST pass
   `mc.preDstLock` as `externalHandLock` instead of releasing it.
   `travelToHand` reuses the pre-lock as its `handLock`, avoiding a
   release+relock race that would drop HAND ref-count to 0 and flash
   `commitZone(HAND)` between the two. The `cardCode` tag is stored on
   the float's dataset so `confirmCardsInHand` / `processShuffleEvent`
   can match floats to reveals even when multiple tutor events carry
   identical cardCodes (LIFO match: see `popLandedFloat(prefix, cardCode)`).

2. **`commitAndClearFloat(dstLock, dstKey)`** (non-HAND branches) —
   MUST be the tail call in each branch. Commits the dstLock and THEN
   clears landed floats at `dstKey` **only if the zone is actually
   unlocked** (`!lockedZoneKeys().includes(dstKey)`). For multi-event
   groups sharing a destination (Link materials → GY, mass destroy,
   multi-tribute), intermediate commits only decrement the ref-count;
   keeping the floats visible during the travel window gives the user
   a progressive overlay instead of each ghost vanishing mid-travel.
   Only the final commit (ref=0 → `commitZone`) clears the accumulated
   floats in one sweep.

### Hand Batch Slot Reservation (`replayBuffer` only)

When a buffer replay contains MSG_MOVE events with `toLocation === HAND`,
`AnimationOrchestratorService.replayBuffer` calls
`DrawSequenceManager.beginHandBatch(relPlayer, count)` before building
the queue directives. This reserves `count` distinct expansion slots
upfront (via `handExpansionSlots` signal). Each MOVE→HAND branch calls
`consumeHandBatchSlot(relPlayer)` to get a monotonic slot index and
passes it as `travelToHand`'s `targetIndex` — so tutor1 lands at slot
0, tutor2 at slot 1, each keeping the fan's per-index rotation. Released
at `batch-end` directive via `endHandBatch(relPlayer)`. Session HAND
locks (`sessionHandLocks`) are acquired in parallel for any player
with a MOVE **touching** HAND (src OR dst) so rendered HAND stays at
its pre-chain state across the whole batch replay; the per-event
`rbs.updateLogical(boardStateAfter)` hook progresses logical state
without triggering commitZone until batch-end.

## Buffer Replay Batch Construction (`BufferReplayBuilder`)

`BufferReplayBuilder.build(buffer)` (`buffer-replay-builder.ts`) is the
batch builder. `AnimationOrchestratorService.replayBuffer()` drains
`chainManager._bufferedBoardEvents` via `chainManager.drainBuffer()`,
calls `bufferReplayBuilder.build()`, and prepends the resulting
`{ batch, releaseSessionLocks }` plus `batch-end` + `await-signal`
directives to the main animation queue. The orchestrator is dispatch
policy only — all batch transformation logic lives in the builder.

The builder runs THREE sequential passes on the buffer before queue
emission:

1. **`interleaveConfirmsWithMoves(buffer)`** — splits aggregated
   `MSG_CONFIRM_CARDS` into per-card single-card CONFIRMs inlined
   immediately after each matching MOVE→HAND (match by `cardCode` +
   `player` + `card.location === HAND`). Unmatched cards (e.g., GY
   reveal, face-down) stay in a reduced CONFIRM at the original
   position. Produces the `tutor → reveal → tutor → reveal` flow.
   Uses a WeakSet to track consumed moves by reference, so splice
   index shifts across multiple CONFIRMs don't invalidate matching.

2. **Session HAND lock + `beginHandBatch`** — for every affected
   `relPlayer` (derived from MOVE-touching-HAND events in the
   interleaved buffer), acquire a `lockZone('HAND-N')` held for the
   whole batch + reserve expansion slots. Keeps rendered HAND at the
   pre-chain state throughout, and gives each tutor a distinct
   fan-positioned slot. Released in the `batch-end` resolve callback.

3. **Group category boundary flush** — the batch-building loop flushes
   the pending group when the next zone event's category differs from
   the last. Category = `'overlay'` (MSG_MOVE with `fromLocation ===
   OVERLAY`) vs `'other'`. Splits XYZ destroy patterns
   `[detach1, detach2, destroy_monster]` into two groups with a barrier
   between them, so overlay materials finish their slide-out + travel
   before the monster's `preDestroyEffect` captures a srcEl that still
   holds them.

Final shape:
`[group(..), barrier]+ | confirm | lp | ... , batch-end, await-signal`

The `await-signal` pauses the main queue until the chain overlay
component sets `chainOverlayReady=true` — coordinates chain resolve
pulse → effect animations → next link resolve.

## syncAfterBoardState Sync Tiers

`syncAfterBoardState` (animation-data-source.ts) decides how to sync
rendered state when a `BOARD_STATE` arrives:

1. **`!boardActive`** → `syncPileCounts()` — bootstrap path. The very
   first BOARD_STATE arrives AFTER `MSG_DRAW × 5` (the server runs
   `start_duel` before the first prompt), so its zone arrays already
   contain the starting hand. A full `commitAll()` here would copy those
   cards into the rendered state, then the buffered MSG_DRAWs would
   animate ON TOP of cards already visible (regression observed
   2026-05-15). `syncPileCounts()` keeps DECK/EXTRA visible so the
   "cards travel from deck to hand" animation has a source; the buffered
   MSG_DRAWs commit HAND through their normal lockZone/commit cycle when
   `drainPreActivationBuffer()` fires.
2. **`chainPhase === 'idle' && queueLength === 0`** → `syncRendered()` —
   full sync, safe because no animations are queued.
3. **`chainPhase !== 'resolving'`** (idle/building with queue) →
   `syncPileCounts()` — only DECK/EXTRA counts + global metadata (turn,
   phase). Zones are NOT synced because pre-locks may not be in place yet.
4. **`resolving`** → defer entirely — orchestrator controls commits via
   chain overlay contract.

`syncPileCounts()` preserves LP from rendered (same discipline as
`mergeUnlockedZones`) and does not touch zone arrays.

## Rendered Board State Constraint

Components MUST NOT derive conditional behavior from combining
`renderedState().turnCount` or `renderedState().phase` with zone content
during animations. Global properties (turnCount, phase) may be ahead of
locked zones by one transition. For synchronized metadata + zones, read
`logicalState()`.

## LP Commit Discipline

LP is excluded from auto-sync in `mergeUnlockedZones()` and
`syncPileCounts()` — both always copy LP from the rendered state. LP is
committed explicitly via `commitLp(playerIndex)` after the counting
animation plays, or via `commitAll()` at hard-reset / `syncRendered()`
at queue-empty.

The pending-commit batching lives in **`LpAnimationTracker`**
(`lp-animation-tracker.ts:_pendingLpCommits: Set<Player>`), NOT in the
orchestrator. The orchestrator's queue loop drains the set via
`lpTracker.commitIfPending()` after the LP counter animation duration
elapses; `discardPending()` is the escape hatch when an upcoming
`commitUnlocked()`/`commitAll()` will sync via a different path. Set
semantics let batched LP events affecting both players (e.g. mass damage
during chain resolution) commit correctly without dedup or ordering bugs.

**Switch survival (α.5, 2026-05-25)** — `trackedLp` + `_pendingLpCommits`
are `DUEL_LIFETIME` (cf. §3.5). A SOLO PvP `switchPlayer` (or replay
perspective flip) goes through `AnimationOrchestratorService.resetForSwitch`
which dispatches `{PERSPECTIVE_LIFETIME}` only — LP state is preserved.
Safe because the BOARD_STATE that immediately follows the switch
re-syncs `trackedLp` via `lpTracker.syncFromBoardState`. Mid-chain
pending LP commits now correctly survive the switch (regression risk
on the SOLO chain hygiene path, cf. memory
`pvp-solo-chain-state-hygiene-2026-05-23`). `STATE_SYNC` / rematch
dispatches `{DUEL_LIFETIME}` which cascades and fully clears LP state.

## Pre-computation Timeline Rules

1. **Turn 0 ("Setup")** contains all events before the first `MSG_NEW_TURN`.
   When `MSG_NEW_TURN` arrives, accumulated events are flushed as the Turn 0
   nav entry, then `currentTurn` increments. Transition boundary prompts
   (`SELECT_IDLECMD`, `SELECT_BATTLECMD`) trigger automatic nav-entry flushes;
   other SELECT_* prompts are accumulated within the same turn's accumulator.

2. **MSG_CHAIN_END** is flushed as its own nav entry WITHOUT `chainIndex` —
   it acts as a separator between consecutive chains in the timeline. The
   front-end hides it via `HIDDEN_SUB_EVENT_LABELS` in `buildSubEventSegments`.

3. **`generateLabel`** returns `''` for batches with only non-visual events
   (SELECT_*, WAITING_RESPONSE, MSG_CHAIN_END, MSG_CHAIN_SOLVING, etc.).
   `flushNavEntry` skips these empty-label states to avoid phantom bullets.

4. **Per-event `boardStateAfter` snapshot** — both `runReplayPreComputation`
   (in `replay-precompute.ts`) and `runDuelLoop` (in `duel-worker.ts`)
   delegate to a `ChainSnapshotTracker` instance (one per duel) which
   tracks a `chainResolving` flag (set at the first MSG_CHAIN_SOLVING of
   a chain, cleared at MSG_CHAIN_END — Option 2b, 2026-06-04) and
   attaches `buildBoardState().data` as `boardStateAfter` on each
   filtered event whose type is in `BOARD_CHANGING_EVENT_TYPES` during
   resolving. The window stays open across SOLVING/SOLVED pairs in a
   multi-link chain, across the post-SOLVED straggler gap, AND across
   `runDuelLoop` re-entries triggered by PLAYER_RESPONSE during a
   resolution prompt (Option O, 2026-06-04 — `liveChainTracker.reset()`
   is no longer called at runDuelLoop entry). Payload growth is
   ~50-150 KB gzipped per duel (snapshots are highly redundant). Both
   modes use the same shared class so the attach predicate, the field
   name, and the timing are identical by construction. Z-index-style
   note: snapshots reflect ocgcore state at `buildBoardState()` call
   time (post-batch if multiple events fire in one `duelProcess` call)
   — strictly better than no snapshot, but not truly per-event within
   a single batch.

## Duel Assertion Pattern

Use `duelAssert(condition, site, msg)` (`duel-assert.ts`) for all
animation-critical invariants. It throws in dev mode and `console.error`s
in prod — never silent. Do NOT use raw `isDevMode()` checks for new
assertions; always go through `duelAssert()`.

## Animation Constants

All animation timing magic numbers live in `animation-constants.ts`. New
timing values MUST be added there instead of inlined as literals. Naming
convention:

- **`*_MS`** — base duration (in ms) consumed by handlers via
  `ctx.scaledDuration(BASE_MS)` so playback-speed scaling applies.
- **`*_MIN_MS`** — companion floor passed to `scaledDuration(BASE, MIN)`
  for any constant whose handler uses the 2-arg form. The floor protects
  against slow-playback collapsing the animation to 0ms. Pair convention:
  every `FOO_MS` consumed with a min has a matching `FOO_MIN_MS`.
- **Safety timers** (`LOCK_SAFETY_TIMEOUT_MS`, `REPLAY_BUFFER_SAFETY_TIMEOUT_MS`,
  `POLL_DROP_REGRESSION_WATCHDOG_MS`, etc.) — wrapped in
  `ctx.safetyTimeout(BASE)` instead of `scaledDuration` so slow playback
  stretches the guard rather than tightens it.

When adding a constant: pick a `*_MS` name describing what it times,
add a `*_MIN_MS` floor if the handler will pass a min, and document the
single line "what does this gate" — most existing entries are 1-3 lines.

## Debugging Animations (`DuelLogger` + `DuelDebugService` + harness)

The animation pipeline has three layers of instrumentation. Use them in
order — they're additive, not redundant.

### Layer 1 — `DuelLogger` categories

`DuelLogger` is the gated console logger. Eleven categories, each filterable
via `localStorage['duel-log-categories']` (CSV) or the DevHub toggle. Default
set keeps the console readable; the three **verbose** categories are off by
default and must be opted in.

- `QUEUE` / `MOVE` / `DRAW` / `CHAIN` / `SHUFFLE` / `LP` / `PROC` / `REPLAY`
  — the existing animation pipeline categories. Loud but bounded; on by
  default.
- `RESOLVE` (verbose) — every conversion from a string identifier to a
  runtime object: `getZoneElement(zoneKey) → HTMLElement | null`,
  `popLandedFloat(prefix, cardCode) → HTMLElement | null`,
  `findCardOnField → CardOnField | null`. Off by default. **A failing
  resolve auto-promotes to `logger.warn`** so silent skips surface even
  when the category is filtered out.
- `PIPELINE` (verbose) — message ingestion across the WS / Replay adapter /
  `DuelEventProcessor` boundary. One line per WS message received
  (`ws.recv type=…`), per `processMessage` entry/exit with queue-length
  delta, per `advanceStep` step kind. Off by default. Use when diagnosing
  "did the event arrive at all".
- `RUNNER` (verbose, Palier A 2026-05-23) — `QueueRunner` internal trace.
  One line per queue tick (the `action` returned by `decideNextStep` +
  the inputs that drove it: `isResolving`, `queueLen`,
  `isWaitingForOverlay`, `commitMode`). Lifecycle transitions
  (`notifyEnqueue`, `requestStop`, generation bump) and rescue/finalize
  events get their own trace lines. Use when diagnosing re-entry, stalls,
  or stale-loop bugs.

`logger.resolve(method, input, result, note?)` is the canonical helper for
the `RESOLVE` category — it formats consistently and handles the null →
warn promotion automatically. Don't roll your own `console.log` for zone
lookups; use `logger.resolve`.

### Layer 2 — `window.__skytrixDebug`

`DuelDebugService` is provided at the duel-page + replay-page component
level and exposes itself on `window.__skytrixDebug` in dev mode only
(`isDevMode() === true`). No-op + tree-shaken in production.

The console surface:

- `__skytrixDebug.snapshot()` — JSON-serialisable state dump
  (logicalState, renderedState, animationQueue, chain.phase + activeLinks,
  locks, inFlightFloats, landedFloats, preActivationBuffer). The
  `domZones` field is a getter — invoking it forces ~50
  `getBoundingClientRect` reads, so don't call it on every animation tick.
- `__skytrixDebug.dump()` — same as snapshot, but also pretty-prints a
  grouped console block. Cheap.
- `__skytrixDebug.enableAll()` — turn on every log category, including
  RESOLVE + PIPELINE. Persists to localStorage.
- `__skytrixDebug.setLogCategories([...])` — fine-grained set.
- `__skytrixDebug.help()` — lists the above in the console.

The snapshot is the right tool when "the animation looks stalled, what's
the state right now?". From DevTools console, paste:
```
copy(JSON.stringify(__skytrixDebug.snapshot(), null, 2))
```
and the JSON dump goes to your clipboard for bug-report inclusion.

### Layer 3 — Playwright debug harness

Two stacked entry points share the same plumbing (login + optional `ng
build` + static server + screenshot/snapshot capture + Markdown report).
Pick the entry point that matches your scenario:

**A — Play through to end.** `front/e2e/debug-replay-harness.ts` exports
`runReplayDebug(ctx, { replayId, perspective, screenshotOn, buildFirst,
fromEvent, timeoutSec })`. Opens the replay, clicks Play, waits for the
end overlay. Use this when the bug surfaces during natural playback and
you just need a captured trace. First arg is the Playwright
`BrowserContext`.

**B — Scenario-based (seek / toggle / step / assert).** `front/e2e/replay-debug-driver.ts`
exports `setupReplaySession(ctx, opts)` + `ReplayDebugDriver`. Use this
when the bug requires a specific user-driven trajectory — mid-chain
seek, perspective flip, prompt-mode toggle, etc. Pattern:

```ts
const session = await setupReplaySession(ctx, { replayId, perspective: 1 });
try {
  await session.driver.waitForBoardStates(50);
  await session.driver.seek(42);                 // jump into a chain
  await session.capture('after-seek-mid-chain');
  const cs = await session.driver.chainState();   // assert overlay restored
  expect(cs.activeChainLinks.length).toBeGreaterThan(0);
  await session.driver.togglePerspective();
  await session.capture('after-perspective-flip');
} finally {
  await session.finalize();
  await session.page.close();
}
```

`ReplayDebugDriver` methods (all `async`, all go through the SAME
component handlers the transport-bar invokes on click — fires
`abortAndClean()` + `gameLogRebuildTick++` exactly like a real click) :

- **Navigation** : `seek(idx)`, `stepForward()`, `stepBack()`,
  `skipStart()`, `skipEnd()`, `playPause()`.
- **Toggles** : `togglePerspective()`, `toggleAnimations()`,
  `togglePromptMode()`.
- **Read-only inspectors** : `currentIndex()`, `totalBoardStates()`,
  `perspectiveIndex()`, `animationsEnabled()`, `promptMode()`,
  `isPlaying()`, `chainState()` (live read of
  `processor.activeChainLinks` + `chainPhase`),
  `currentStateChainSnapshot()` (the precompute's embedded
  `ReplayStreamNavEntry.chainSnapshot` for the current index — F9-bis
  verification surface), `fullSnapshot()` (whole `__skytrixDebug.snapshot()`).
- **Wait helpers** : `waitForIndex(target)`, `waitForBoardStates(target)`,
  `waitForEndOverlay(timeout)`.

The driver talks to a stable global surface (`window.__skytrixDebug.replay`,
wired in `replay-page.component.ts:bindToWindow` block) instead of DOM
selectors that may shift when the transport-bar / timeline is reworked.
Dev-only by design — the surface is gated on `isDevMode()`. Adding a new
debug action ? Wire it once in the component's `bindToWindow` block AND
add the typed wrapper on `ReplayDebugDriver` so consumers get
auto-completion + tsc drift detection.

**Common to both A and B** — output goes to `_bmad-output/debug-replay/<tag>/`:

- `report.md` — timeline of captures, warnings, errors, last 100 PIPELINE
  lines. Read this first.
- `console.log` — raw filtered log with timestamps.
- `frames/<idx>-<label>.png` — screenshots at each trigger.
- `snapshots/<idx>-<label>.json` — `__skytrixDebug.snapshot()` dump
  paired with each screenshot.

Two run modes:

1. **`buildFirst: false`** (fast, fragile) — points at the user's running
   `ng serve`. Iterative dev mode. HMR can truncate captures if you edit
   code mid-run.
2. **`buildFirst: true`** (slow, reproducible) — runs `ng build
   --configuration=development`, serves the static output on a free port,
   captures against that. ~30s overhead for the build, then HMR-immune.
   Use for archival captures + regression snapshots.

Run via:
```
npm run debug:replay              # default example spec
npx playwright test e2e/<spec>    # specific spec
```

Copy `debug-replay-example.spec.ts` as the template for the play-to-end
pattern. The trigger pattern that worked for the 2026-05-18 EMZ resolver
bug was `screenshotOn: ['travel skipped']` — every `travel skipped` warn
captures a frame + snapshot at the bug moment. For scenario-based
debugging, write a new spec that imports `setupReplaySession` directly.

### What NOT to instrument

- Bind expensive payloads (board-state dumps, large arrays) behind
  `logger.isEnabled(cat)` checks so the cost is paid only when the
  category is on.
- Don't use `duelAssert()` for new resolve-style failures — the
  warn-on-null path in `logger.resolve()` is already the right
  signal-without-throw mechanism.
- Don't add console.log directly — go through DuelLogger so the output
  is categorised + the prefix + traceId are consistent.

## Polling Removal — Regression Surface

The legacy chain-poll back-off (`_pollTimeout` + 50→500ms exponential +
ceiling=30) was removed 2026-05-10 after investigation found it
unreachable since commit 89b761c4 — three event-driven re-wakes
(`runner.notifyEnqueue` on WS message, `advanceStep` on
`setAnimating(false)`, `initResumeEffect` on `chainOverlayReady`) cover
the "chain resolving, queue temporarily empty" gap. Palier A
(2026-05-23) moved the loop into `QueueRunner` but the rescue + watchdog
contract is unchanged.

The `pollDropWatchdog.arm()` (fired in the runner's `'finalize'` case
when `chainPhase === 'resolving'`, cleared in `runner.notifyEnqueue` +
`runner.requestStop`) is the safety net: after
`POLL_DROP_REGRESSION_WATCHDOG_MS` (10s) it logs
`[POLL-DROP REGRESSION]` (unfilterable, not through `DuelLogger`) and
fires `duelAssert(false, 'POLL-DROP-REGRESSION', ...)`.

**If you see the marker, investigate in this order before anything
else:**
1. Did MSG_CHAIN_END arrive? Check WS logs for the duel ID.
2. Did `chainPhase` transition to `'idle'`? Grep `applyChainEnd` traces.
3. Was `initResumeEffect` fired on `chainOverlayReady`? Check
   `[ANIM:CHAIN] resumeEffect` logs.
4. Did `runner.notifyEnqueue` get called after the stall? Check
   `[RUNNER] notifyEnqueue` traces (enable category `RUNNER` first).

If none of (1-4) hold, the dropped poll mechanism was masking a real
upstream bug — find the missing event/signal first, do NOT re-introduce
the poll. Last-resort restore: a single
`setTimeout(() => this.runner.notifyEnqueue(), 500)` in the runner's
finalize case (no back-off, no ceiling — the watchdog is the ceiling).

**Grep markers (do not change without updating this section):**
`POLL-DROP REGRESSION` (the console.error string) and
`POLL-DROP-REGRESSION` (the duelAssert site tag).

### Replay interruption safety (seek / pause during a chain)

Interrupting a replay mid-chain has two distinct failure modes, both
fixed defensively (2026-05-20). Since Palier A (2026-05-23) the
lifecycle primitives live in `QueueRunner`; `orchestrator.clearTimersAndPolling`
delegates to `runner.requestStop()`.

1. **Stale async loop after a seek.** `_processAnimationQueueInner`
   (`QueueRunner`) is an async loop that cannot be cancelled mid-`await`.
   A seek / sub-event click runs `abortAndClean` → `resetForSwitch` →
   `runner.requestStop()` (flips `_isRunning` false through
   `onIsRunningChange`, which also flips `_isAnimating`). Then a fresh
   feed flips it back true — so the suspended stale loop would resume
   and run alongside the new one.

   **Root cause of the "infinite rescue" (fixed 2026-05-20):** when the
   reset landed while a loop was suspended on an `await`, that loop's
   `finally { _innerLoopDepth-- }` had not run, leaving `_innerLoopDepth`
   stale at 1. The post-reset feed's fresh loop then did `_innerLoopDepth++`
   → 2 → the parallel-re-entry `duelAssert` **threw**, aborting the loop
   body before it dispatched anything → the queue never drained → the
   `processAnimationQueue` finally rescue re-fired forever. Fix:
   `runner.requestStop()` zeroes `_innerLoopDepth`, and the inner-loop
   `finally` floors it at 0 (`Math.max(0, …)`) so a stale loop resuming
   after the reset can't drive it negative.

   Defense in depth (Palier C, 2026-05-23): the maison `_resetGeneration`
   token was replaced by an `AbortController`. `runner.requestStop()`
   calls `_abort.abort()` then installs a fresh controller; suspended
   inner loops check `abortSignal.aborted` after each `await` and bail
   cleanly. The `processAnimationQueue` finally compares its captured
   `AbortController` by reference against `_abort` to detect a swap and
   stays inert across it. Plus a no-progress ceiling
   (`RESCUE_NO_PROGRESS_CEILING`) — past N rescues with `queueLen`
   unchanged the rescue abandons with a `logger.warn` instead of looping.

   **F13 (2026-05-31) — `AbortController` does NOT make `_innerLoopDepth`
   redundant.** The two cover orthogonal scenarios:

   - `AbortController` guards RESET boundaries (single suspended loop
     bails after a `requestStop`).
   - `_innerLoopDepth` guards INTRA-TICK parallel re-entry. The finalize
     branch in `_processAnimationQueueInner` flips `_isProcessing=false`
     for a synchronous window between `onFinalize()` and
     `setRunning(false)` ; if `setRunning(false)` triggers
     `advanceStep → feedTransition → enqueue → notifyEnqueue →
     processAnimationQueue` in the same microtask, the new call passes
     the `_isProcessing=false` gate and a SECOND inner loop starts
     BEFORE the first returns. No abort involved. The `depth <= 1`
     assert is the only structural detection (audit finding C4).

   Removing `_innerLoopDepth` would lose that detection. The three
   sites (`requestStop` zero, entry `++` + assert, finally `Math.max(0,
   …)` floor) each load-bear a piece of the invariant the others rely
   on ; removing any one breaks the rest. Each site carries an `F13
   site N of 3` comment pointer in `queue-runner.ts`.

2. **Watchdog false-fire while paused.** A resolving chain can sit with
   an empty queue when replay auto-play is paused — the next link /
   `MSG_CHAIN_END` are in a transition `maybeAdvance` won't schedule
   until resume. That is healthy, not a stall. `setPlaybackPaused(bool)`
   (called from a replay-page effect watching `transport.isPlaying`)
   clears the watchdog on pause and re-arms it on resume if still
   mid-resolution. `armPollDropWatchdog` no-ops while `_playbackPaused`.
   PvP never calls `setPlaybackPaused` (no pause there).

## Server Module Configuration (`createConfigurable<T>`)

Server-side modules extracted from `server.ts` follow a two-phase init
contract via `createConfigurable<T>(name)`
(`duel-server/src/configurable.ts`). The factory returns
`{ configure(cfg), get(), isConfigured() }`. `get()` throws
`"<name>: configure<Name>() not called"` if the module is read before
configuration. `isConfigured()` participates in the **boot invariant**
in `server.ts` (block just before `wss.on('connection')`), which throws
with the list of unconfigured modules. New configurable modules MUST
register their `isXxxConfigured()` in the boot block — that block is
the regression fence for the whole pattern.

**Current extracts** (13 modules, each owns its slice of `server.ts`):

- **`http-routes`** — `/health`, `/status`, `/api/update-data`,
  `/api/validate-passcodes`.
- **`replay-handlers`** — replay WS connections + fork-solo
  bridge-in (delegates session creation to `fork-handlers`).
- **`timer-management`** — turn/inactivity/grace timers + clock-skew
  clamp.
- **`solver-handlers`** — solver WS attach/detach + deck cache +
  per-userId SOLVER_START mutex.
- **`first-player-coordinator`** — pre-duel RPS + turn-player selection
  state machine. Since U32 #3b (audit-4-modes-2026-06-01) imports
  `startDuelWithOrder` directly from `session-orchestrator` (ES module
  cycle tolerated — both sides consume each other at call time).
- **`worker-lifecycle`** — narrow scope post-U34 : owns
  `attachWorkerHandlers` (per-session worker handle wiring of
  `message`/`exit`/`error` listeners). The `exit` handler coordinates
  the duels-served counter with `duel-end-coordinator` via
  `_incrementTotalDuelsServed`.
- **`duel-end-coordinator`** — U34 cosmetic (audit-4-modes-2026-06-01).
  Owns the end-of-duel sequence : `safeTerminateWorker` (idempotent
  + counter), `handleDuelEnd` (sets `endedAt` + arms rematch timer,
  skips fork-solo), `requestReplayFromWorker`, and the `totalDuelsServed`
  counter.
- **`worker-message-router`** — dispatches worker→main messages
  (`WORKER_*`) + `broadcastMessage` outbound (chain-state update,
  CONFIRM_CARDS chainIndex tag, BOARD_STATE cache, per-player
  `filterMessage`).
- **`client-message-router`** — dispatches client→server messages
  (`PLAYER_RESPONSE`, `SURRENDER`, `REMATCH_REQUEST`,
  `REQUEST_STATE_SYNC`, `ACTIVITY_PING`, `ANIMATIONS_DONE`,
  `CANCEL_PROMPT_SEQUENCE`), invalid-response strike count,
  cancelTargetPrompt snapshot.
- **`fork-handlers`** — fork-solo `ActiveDuelSession` construction +
  worker handler attach. Behavioral skips (no replay persist, no
  rematch arm, log tag) live in `worker-message-router` and
  `duel-end-coordinator` gated on `session.forkMode`.
- **`replay-persist`** — POST replay payload to Spring Boot with
  `3^(attempt-1)s` back-off; consumes `pendingReplayResult` override
  for TIMEOUT/SURRENDER/RESIGN cases.
- **`session-orchestrator`** — U32 #3a + #3b (audit-4-modes-2026-06-01).
  Per-session lifecycle helpers : `cleanupDuelSession` (idempotent
  teardown), `sendStateSnapshot` (pre-duel + DUELING resync),
  `resendPendingPrompt` (cached prompt re-arm on reconnect),
  `startRematch` (terminate + reset + SOLO direct / PvP dice flow),
  `rematchExpired` (timer fire → REMATCH_CANCELLED + cleanup), and
  `startDuelWithOrder` (player/deck swap + Worker spawn + INIT_DUEL).
- **`pvp-connection-handler`** — U32 #2 (audit-4-modes-2026-06-01).
  The `wss.on('connection', ...)` handler body. Routes 4 modes
  (replay / solver / PvP-init / PvP-reconnect), handshake +
  grace-period + dispatch, per-WS `message` + `close` lifecycle.
  Also exports `resolveLivePlayerIndex(session, ws): 0 | 1 | null` —
  the `null` branch (F4, 2026-06-02) lets the per-WS event handlers
  ignore stale-ws events after a reconnect already swapped the slot,
  preventing a faux-positif `OPPONENT_DISCONNECTED` / grace-timer
  forfeit at `RECONNECT_GRACE_MS` against a healthy live ws.
- **`ws-write`** — U32 #1 (audit-4-modes-2026-06-01). Pure export
  (no `createConfigurable<T>` — zero injectable deps) : `sendToPlayer`
  with STATE_SYNC decoration, SOLO routing decision, `safeSend` wire.

`server.ts` residual (~751 LOC) : boot wiring (13 `configureXxx` calls
+ boot invariant), HTTP `handleRequest` (POST /api/duels + DELETE
/api/duels/:id + /api/duels/active passthrough), heartbeat, signal
handlers, graceful shutdown, `server.listen`.

### Non-configurable server-side extracts (audit-4-modes-2026-06-01)

Three modules landed in the audit-4-modes Bucket 4 + 5 that are NOT
`createConfigurable<T>` modules — they're shared factories / pure
helpers consumed by both `server.ts` and `fork-handlers.ts`, or
worker-side extracts that live outside the main-process `server.ts`
slice. They have no `configureXxx()` boot call and don't participate
in the boot invariant.

- **`session-factory.ts`** — U15 + U37 (commit `d5f3ca2b`).
  `createInitialSessionState(opts)` consolidates the 2 hand-built
  `ActiveDuelSession` constructors (PvP normal in `server.ts` POST
  `/api/duels` + fork-solo in `fork-handlers.ts createForkSoloSession`)
  + `resetSessionForRematch(session)` consolidates the rematch reset
  that previously lived inline in `server.ts startRematch`. Wipes
  per-duel state without touching long-lived fields (`duelId`,
  `players`, `decks`, `soloMode`, `forkMode`, …) ; replaces `gameLog`
  with a fresh `createSessionGameLog()` so the new duel's journal does
  NOT bleed in from the previous one.
- **`duel-worker-fork.ts`** — U4 (commit `11facf7a`). Worker-side
  extract (NOT `server.ts`). Holds `runForkReconstruction` +
  `performSanityCheck` + local `PHASE_MAP_REVERSE`. The `initFork`
  bootstrap stays in `duel-worker.ts` because it touches the OCGCore
  init pipeline ; this module is the pure replay-driver + sanity gate
  that runs AFTER engine init. Receives setters via a `ForkContext`
  interface, mirroring the `WorkerStateAccessors` pattern used by
  `wasm-snapshot-wrapper.ts`.
- **`ocg-message-transforms.ts`** — U4 (commit `c84d72a2`).
  Worker-side extract (NOT `server.ts`). Holds the ~14 OcgMessage →
  ServerMessage transforms, the `transformMessage` dispatch switch,
  the prompt→OCGCore `transformResponse`, plus 7 pure decode helpers
  (`decodePlaces` / `decodePositions` / `decodeBitmask` /
  `decodeAttributes` / `countersToRecord` / `locName` / `toCardInfo`).
  Two context objects (`OcgContext` carrying `core` + `duel` ;
  `LookupContext` carrying `cardDb` + `systemStrings` + `dlog` +
  `isTokenCard` + `setLastAnnounceNumberOptions`) are built once by
  the worker and forwarded on every call so the transforms don't
  reach module-level worker state.

## WS Protocol Module Split (barrel)

`ws-protocol.ts` (both `front/src/app/pages/pvp/duel-ws.types.ts` and
`duel-server/src/ws-protocol.ts`) is a **barrel** that re-exports 6
sub-files. Adding a new message type goes in the matching sub-file, NOT
the barrel:

- **`ws-protocol-shared.ts`** — `Player`, `Phase`, `LOCATION`, `POSITION`,
  `BoardStatePayload`, `BOARD_CHANGING_EVENT_TYPES`, etc. — types and
  enums consumed across all categories.
- **`ws-protocol-game.ts`** — game events (MSG_*: MOVE, DRAW, DAMAGE,
  CHAINING, etc.). All BOARD_CHANGING events live here.
- **`ws-protocol-prompts.ts`** — SELECT_*, ANNOUNCE_*, SORT_*,
  `PlayerResponseMsg`. Anything that pauses the duel for player input.
- **`ws-protocol-system.ts`** — duel lifecycle (DUEL_END, RPS, REMATCH,
  STATE_SYNC, CHAIN_STATE, timer, surrender, cancel). Non-game-event
  protocol messages.
- **`ws-protocol-replay.ts`** — replay-specific (REPLAY_METADATA,
  REPLAY_STREAM_CHUNK, REPLAY_STREAM_INIT, fork lifecycle).
  Phase 6 (2026-06-06) retired the legacy `REPLAY_BOARD_STATES` +
  `PreComputedState` / `DecisionMoment` ; `ReplayStreamNavEntry` now
  carries `events[]` + `responseCount` (the 1:1 successor of the
  retired `PreComputedState`).
- **`ws-protocol-solver.ts`** — solver-specific (SOLVER_INIT, START,
  PROGRESS, RESULT, etc.).

The 6 sub-files are byte-synced front↔back via
`scripts/check-ws-protocol-sync.mjs` (modulo `.js` import suffix in
duel-server). The barrels are NOT byte-synced (paths differ) but mirror
each other in structure. **A check-ws-protocol-sync run is part of
duel-server's prebuild step.**

## Server Chain Helpers (`ChainSnapshotTracker` + `ChainStateTracker`)

Two small classes encapsulate chain-related server logic that used to
live inline in `duel-worker.ts` / `server.ts`. Future bugs touching chain
state on the server side belong in these files, not in their former hosts.

- **`ChainSnapshotTracker`** (`duel-server/src/chain-snapshot-tracker.ts`)
  — owns the `chainResolving` flag (set at the first MSG_CHAIN_SOLVING
  of a chain, cleared at MSG_CHAIN_END — Option 2b, 2026-06-04) and
  attaches `boardStateAfter` snapshots to outgoing
  BOARD_CHANGING events while resolving. Single instance per duel run.
  Used by both `runDuelLoop` (live PvP, `duel-worker.ts`) and
  `runReplayPreComputation` (replay precompute, `replay-precompute.ts`)
  via `tracker.process(dto, captureSnapshot)` — the same predicate, the
  same field, the same code path on both sides → PvP↔Replay parity by
  construction.

  **Lifetime contract (Option O, 2026-06-04)** — the live PvP instance is
  module-level in `duel-worker.ts` (NOT reset per `runDuelLoop` entry —
  the historical reset was removed when Option 2b extended the window
  past `MSG_CHAIN_SOLVED`, see "Per-event `boardStateAfter` snapshot →
  Tracker lifetime across `runDuelLoop` calls"). The replay precompute
  instance is local to `runReplayPreComputation` (one per replay run,
  re-created at each open). Terminal resets only fire on worker
  start/rematch (worker terminated, fresh process) and STATE_SYNC
  (separate path, doesn't go through this tracker).

- **`ChainStateTracker`** (`duel-server/src/chain-state-tracker.ts` —
  `ChainStateContainer` interface, `emptyChainState()`, and the
  `applyChainTransition(state, message)` dispatcher) — server-side chain
  snapshot persisted per session for reconnect handshake. Stores
  `activeChainLinks`, `chainPhase`, `negatedChainIndices`,
  `currentSolvingChainIndex`. Mirror of the client-side
  `DuelEventProcessor` but minimal (server only needs what CHAIN_STATE
  replays on reconnect). The transition logic is pure — testable
  without booting the WS server (covered by `chain-state-tracker.spec.ts`).

## Solver Connection Lifecycle (`solver-handlers.ts`)

`solver-handlers.ts` owns four private Maps (`solverConnections`,
`solverJwts`, `solverLastStart`, `solverDeckCache`) — none are exported.
`server.ts` drives state via two functions:

- **`attachSolverConnection(userId, ws, jwt)`** — atomic limit-check +
  replace + set. Returns `{ kind: 'limit' }` (server.ts must close ws
  with 4029) or `{ kind: 'attached'; replaced: WS | null }` (server.ts
  closes the replaced socket with 4001 if present). Atomic so two
  concurrent attaches can't both pass `maxSolverConnections`.
- **`detachSolverConnection(userId, ws)`** — idempotent cleanup. Guards
  against the replace race (`if (solverConnections.get(userId) !== ws)
  return`) so a `close` handler that fires after a replace doesn't kick
  out the new WS. Drops connection + JWT + the user's deck-cache prefix
  entries in one call.

WS IO (the actual `ws.close(...)` calls) stays in server.ts — solver-handlers
mutates state, server.ts owns the socket lifecycle. `maxSolverConnections`
lives in `SolverHandlerConfig` (getter for hot-reload via `/api/update-data`).
A future handler that adds solver state and forgets to clean up via detach
can no longer leak silently — the Maps simply aren't reachable from outside.

## Session Management (`DuelSessionManager`)

`DuelSessionManager` (`duel-server/src/duel-session-manager.ts`) owns
the three session-state Maps (`activeDuels`, `pendingTokens`,
`reconnectTokens`). Token consumption uses **atomic read+delete** with
a tagged return discriminator: `'unknown'` (token never issued),
`'session-gone'` (orphan token; auto-pruned), `'ok'` (resolved).
Callers MUST switch on `kind` rather than null-check — the three
branches drive distinct close-codes and log lines. `terminate()` is
idempotent and called LAST in `cleanupDuelSession()`; WS close, timer
clears, and worker termination happen before it.

## Protocol Version Mismatch (Close-code 4426)

WS handshakes that fail protocol-version validation close with **code
4426** (analog to HTTP 426 "Upgrade Required"). Server side:
`protocol-version-check.ts` runs on every WS connect (PvP, replay,
solver) before any session bookkeeping; mismatches increment a
`protocolMismatchCount` counter exposed via `/status`. Client side:
every connection service (`duel-connection.ts`,
`replay-connection.service.ts`, `solver.service.ts`) MUST inspect
`event.code === 4426` in its `onclose` handler and surface a "client
outdated, refresh" UX rather than a generic "connection lost". Losing
this branch reads as a transient network error to the user and
triggers an infinite reconnect loop on stale bundles.

## Isolated dev-stack for e2e + Claude debug (`scripts/dev-stack.mjs`)

The Playwright e2e suite needs the full stack up (postgres + back + duel
+ front). Running the suite against the user's hand-driven stack on
canonical ports collides with whatever they're doing in the browser —
data writes from tests pollute the dev DB, the back can't reload on
code changes while a test holds a WS, etc. The fix : an **isolated
parallel stack on shifted ports** that the user's stack ignores
completely.

| Service       | User stack (canonical) | dev-stack (isolated)             |
|---------------|------------------------|----------------------------------|
| Postgres      | `:5432`                | `:15432` (Docker, dedicated vol) |
| back Spring   | `:8080` / `:8081`      | `:18080` / `:18081`              |
| duel-server   | `:3001`                | `:13001`                         |
| front Angular | `:4200`                | `:14200`                         |

**CLI** — `node scripts/dev-stack.mjs <cmd>` :

- `up [--only=db,back,duel,front]` — bring stack up (idempotent ; skips
  services already responding on their probe)
- `down [--only=...]` — stop managed services (`taskkill /T /F` on
  Windows ; SIGTERM→SIGKILL after 5s on POSIX)
- `restart <svc>` — `down` + `up` a single service (use after editing
  duel-server code : ~5s vs ~30s for a full `up`)
- `status` — table of pid / port / probe / uptime
- `logs <svc> [--tail=N]` — tail per-service log (default N=100)
- `sync-db` — `pg_dump` user's `:5432` → restore into `:15432` (needed
  to debug a specific replay/deck/user that lives only in the user's DB)
- `reset-db` — drop the Postgres volume + recreate (escape hatch when
  the isolated DB gets polluted by tests)
- `doctor` — pre-flight checks (Docker daemon, mvnw, port collisions)

**Playwright integration** — `playwright.config.ts` targets the user's
hand-driven stack on canonical ports (`:4200` / `:8080`) **by default**.
This matches the typical workflow where the user is actively coding in
the browser and wants Playwright to drive what they see.
`PW_AUTO_STACK=1` opt-in flips on `globalSetup` → `ensureStack()` for
the isolated stack on shifted ports — use this when Claude debugs e2e
without colliding with the user's session. `helpers.ts` reads
`E2E_BASE_URL` + `E2E_BACK_URL` env vars set by the config when
auto-stack is on ; otherwise it falls back to canonical URLs.

**Front config plumbing** — the `e2e` Angular configuration
(`angular.json`) swaps `environment.ts` → `environment.e2e.ts` (which
points `apiUrl` / `wsUrl` at the isolated ports) and uses
`src/proxy.e2e.conf.json` for the dev-server's `/api` rewrite.

**State** — `scripts/.dev-stack/` (gitignored) holds `pids.json` +
per-service `*.log` files. Log files are append-only across runs ;
delete the dir to start fresh.

**When to use what** :

- *User is running e2e against their own stack* → `npx playwright test`.
  Default config targets `:4200` / `:8080`. Assumes the user's stack is
  already up.
- *I (Claude) need to run e2e without colliding with user's session* →
  `PW_AUTO_STACK=1 npx playwright test`. `globalSetup` brings up whatever's
  missing in the isolated stack. First run is slow (~90s for cold back) ;
  subsequent runs reuse already-up services.
- *I need to inspect what the back/duel/front did during a test* → read
  `scripts/.dev-stack/{back,duel,front}.log` directly. They're written
  in real time, no harness involvement.
- *User changed duel-server code, I need to pick it up* →
  `node scripts/dev-stack.mjs restart duel` (~5s). HMR covers front
  changes ; back changes need `restart back` (slow, ~30s).
- *User wants me to debug a replay from their DB* → `node scripts/dev-stack.mjs sync-db`.
  Snapshots their entire DB into the isolated one. Re-run when they generate
  new replays.

**Pitfalls** :

- Postgres container survives `down` — its volume is persistent by
  design. Use `reset-db` to truly wipe.
- The Spring Boot back takes 30-60s to start (Hibernate + Flyway). First
  `up` of the session is the slow one ; idempotent re-`up` is ~2s.
- `ng serve --configuration e2e` rebuilds from scratch the first time
  (~30-60s). The build is cached on disk after that.
- Windows `taskkill /T /F` kills the whole process tree (mvnw → java,
  npm → node, npx → ng → node). Don't simplify to a plain `kill` — the
  parents are shims that don't propagate signals.

## Solver Interruption Tags

`duel-server/data/interruption-tags.json` is the single source of truth
for end-board interruption scoring. Adding/revalidating cards is a
procedure (AI-assisted prompt + ygoprodeck oracle fetch + human
validation flip) — see
`_bmad-output/solver-data/interruption-tags-howto.md`.
