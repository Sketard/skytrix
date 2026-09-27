# Moteur de duel — duel-server

**Lecture** : les modules du duel-server, le découpage du protocole WS, les trackers de chaîne, le solveur, les sessions
et le code 4426 ; texte de l'ancien `CLAUDE.md`, déplacé tel quel (en anglais) le jour de l'adoption du plugin
`workbench`. Index du moteur de duel : [`README.md`](README.md). Se lit par sections : `Grep "^## "`, puis `Read` par
plage.

## Sommaire

1. Server Module Configuration (`createConfigurable<T>`)
2. WS Protocol Module Split (barrel)
3. Server Chain Helpers (`ChainSnapshotTracker` + `ChainStateTracker`)
4. Solver Connection Lifecycle (`solver-handlers.ts`)
5. Session Management (`DuelSessionManager`)
6. Protocol Version Mismatch (Close-code 4426)

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
  Tracker lifetime across `runDuelLoop` calls" in [orchestrator.md](orchestrator.md)). The replay precompute
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
