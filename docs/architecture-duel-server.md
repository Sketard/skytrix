# Architecture — Duel Server (Node + ocgcore)

> Node 24 WebSocket server hosting the **ocgcore** Yu-Gi-Oh! rules engine over `@n1xx1/ocgcore-wasm`. Runs three concurrent workloads: live PvP duels (worker threads), replay precompute (Piscina pool), combo path solver (Piscina pool). Internal HTTP API for the Spring backend. Strict two-phase init via `createConfigurable<T>(name)` with a boot invariant.

## Executive summary

The duel-server is a **single-binary Node service** that owns gameplay. It speaks WebSocket to browsers (PvP, replay, solver) and HTTP to the Spring backend (replay persistence, internal coordination).

Three things make it interesting:

1. **PvP↔Replay parity by construction** — `ChainSnapshotTracker` is the same class used by `runDuelLoop` (live) and `runReplayPreComputation` (precompute). The predicate, field name, and timing for `boardStateAfter` snapshots are identical because they share the implementation.
2. **`createConfigurable<T>(name)` two-phase init** with a boot invariant in `server.ts` that throws if any of the four registered modules (`http-routes`, `replay-handlers`, `timer-management`, `solver-handlers`) is unconfigured.
3. **Protocol version close code 4426** — the server rejects mismatched clients with an HTTP-426-equivalent close code; every front-end connection service handles `event.code === 4426` distinctly.

## Technology stack

| Concern | Tech |
|---|---|
| Runtime | Node 24 (Docker base `node:24-slim`) |
| Language | TypeScript ES2022, `module: nodenext`, `strict: true` |
| WebSocket | `ws` |
| Game engine | `@n1xx1/ocgcore-wasm` (sync mode via `createCore({ sync: true })`) |
| Card DB | `better-sqlite3` (cards.cdb) |
| Worker pool | `piscina` (replay precompute, solver workers) |
| Validation | `zod` |
| Tests | `vitest` |
| Optional AI | `@anthropic-ai/sdk` (vendored — not yet on the live solver path) |

## Module map

The full file-by-file breakdown is in [source-tree-analysis.md](./source-tree-analysis.md#duel-server--node-websocket-server). Top-level groupings:

| Group | Files |
|---|---|
| Boot + lifecycle | `server.ts`, `configurable.ts`, `logger.ts` |
| Session + duel | `duel-session-manager.ts`, `duel-worker.ts` (the game loop), `timer-management.ts`, `types.ts` |
| WebSocket protocol | `ws-protocol.ts` (barrel) + 6 sub-files (shared/game/prompts/system/replay/solver), `protocol-version-check.ts`, `ws-rate-limit.ts` |
| Chain state (parity) | `chain-snapshot-tracker.ts`, `chain-state-tracker.ts` |
| HTTP routes | `http-routes.ts`, `http-helpers.ts` |
| Replay | `replay-precompute.ts`, `replay-handlers.ts`, `replay-cache.ts` |
| Solver | `solver-handlers.ts`, `solver/` (43 files: orchestrator, search, oracles, scoring, ML, ...) |
| Validation + FFI | `validation/{response,worker-message}-validation.ts`, `message-filter.ts`, `ocg-scripts.ts`, `ocg-callbacks.ts`, `card-db-cache.ts`, `data-updater.ts`, `wasm-snapshot{,-wrapper}.ts`, `lru-map.ts` |
| PoCs (excluded from build) | `poc-duel.ts`, `poc-replay.ts`, `solver-poc.ts`, `test-core.ts`, `test-snapshot.ts` |
| Tests | `*.spec.ts` (chain-snapshot-tracker, chain-state-tracker, duel-session-manager, response-validation, replay-precompute, lru-map, ws-protocol-shared, message-filter, ws-rate-limit, timer-management, inactivity-timer, wasm-snapshot, card-db-cache, ...) plus 50+ smoke tests in `solver/` |

## Boot sequence

1. Parse env (`PORT`, `DATA_DIR`, `NODE_ENV`, `SPRING_BOOT_API_URL`, `INTERNAL_API_KEY`, debug flags).
2. Start `logger`.
3. Load card DB (`cards.cdb`) and scripts via `ocg-scripts.ts`.
4. Build `ocg-callbacks.ts` (`CardReader`, `ScriptReader`).
5. **Configure** all four configurable modules via their `configure(cfg)` factories: `http-routes`, `replay-handlers`, `timer-management`, `solver-handlers`.
6. **Boot invariant** — throws with the list of unconfigured modules if any of the `isXxxConfigured()` predicates returns false. This is the regression fence for the `createConfigurable<T>` pattern: any new configurable module MUST register here.
7. Start the HTTP server (mounts `http-routes`).
8. Start the WebSocket server (`wss.on('connection')`).
9. Mark `isDataReady = true` (used by `GET /health`).

## WebSocket connection lifecycle

```
incoming WS upgrade
  │
  ▼
1. Per-IP rate-limit check (ws-rate-limit.ts) → close 4029 if exceeded
  │
  ▼
2. Mode detection via ?mode=
   ├── replay  → handleReplayConnection() (separate branch)
   ├── solver  → JWT decode → attachSolverConnection (atomic limit + replace)
   └── default → PvP path (continues below)
  │
  ▼
3. Protocol version check (?pv=...) — PvP + Replay only → close 4426 on mismatch
  │
  ▼
4. PvP token resolution
   ├── new conn        → consumePendingToken(token)   → ok | unknown | session-gone
   └── reconnection    → consumeReconnectToken(token) → ok | unknown | session-gone
   (close 4001 on anything but 'ok')
  │
  ▼
5. Bind ws to session.players[playerIndex].ws, set connected=true
  │
  ▼
6. Issue fresh reconnect token (UUID); store on session + player
  │
  ▼
7. Send SESSION_TOKEN, then DUEL_STARTING (own card codes only),
       STATE_SYNC (last board), CHAIN_STATE (active links), TIMER_STATE
  │
  ▼
8. Resend pending prompt if the player has one waiting
  │
  ▼
9. If both players are now connected and phase is WAITING_PLAYERS:
       PvP    → start RPS
       solo   → start DP / phase 0
       fork-solo + DUELING → send FORK_RESUME
  │
  ▼
10. Wire message handler → handleClientMessage(session, live, msg)
    Wire close handler   → mark disconnected, clear inactivity timer,
                           notify opponent, start RECONNECT_GRACE_MS (60 s)
                           (BOTH_DISCONNECTED_CLEANUP_MS = 4 h after both drop)
```

`currentPlayerIndex` is closed over by ws lookup (immune to `startDuelWithOrder` swapping the OCG team indices mid-flight).

## The game loop — `runDuelLoop` (`duel-worker.ts`)

Each PvP duel spawns a dedicated **worker thread**. Inside:

```
WATCHDOG (30 s per iteration; on fire → emit partial replay + process.exit(1))
│
loop {
   result = core.duelProcess(duel)             # CONTINUE | WAITING | END
   for msg in core.duelGetMessage(duel):
       updateState(msg)                        # phase, turn, LP
       detect RETRY                            # set hasRetry flag
       skipRpsAutoResponded?                   # auto-RPS for solo
       capture duelResult on MSG_WIN
       dto = transformMessage(msg)
       liveChainTracker.process(dto, captureSnapshot)   # SHARED with replay-precompute
       (emit intermediate BOARD_STATE if cost moves before MSG_CHAIN_SOLVING)
       port.postMessage({ type: 'WORKER_MESSAGE', duelId, message: dto })
       (clear lastIdleSnapshot at IDLECMD/BATTLECMD boundaries — P0-3bis.3)

   if result === WAITING:
       if hasRetry: WORKER_RETRY (server re-broadcasts cached prompt)
       emit final BOARD_STATE → return (pause loop until response)

   if result === END:
       emit replay (non-fork) → cleanup → return

   continue
}
```

### `ChainSnapshotTracker` integration

`chain-snapshot-tracker.ts` exposes `tracker.process(dto, captureSnapshot)`:
- Tracks a `chainResolving` boolean (set at `MSG_CHAIN_SOLVING`, cleared at `MSG_CHAIN_SOLVED`).
- For events whose type is in `BOARD_CHANGING_EVENT_TYPES` AND `chainResolving === true`, attaches `boardStateAfter = captureSnapshot()` to the dto.
- `captureSnapshot()` is `() => buildBoardState().data` — only invoked inside the resolving window.

The same class is used by `replay-precompute.ts:runReplayPreComputation` — that's the parity guarantee.

### Player response application

```
PLAYER_RESPONSE { promptType, data } from server
   ├── validate data bounds (validation/response-validation.ts — M28 audit, FFI safety)
   └── capturedSetResponse(duel, { type: responseType, value: encodedValue })
       → applies to ocgcore
   → loop resumes on next duelProcess
```

## Replay precompute — `replay-precompute.ts:runReplayPreComputation`

Runs in a Piscina worker. Replays the captured `playerResponses` against a fresh ocgcore duel and produces a sequence of `PreComputedState` snapshots:

```typescript
{
  chainIndex?: number;        // For grouping chain-linked events
  label: string;              // Human label ("Synchro Summon: Accel Synchro Warrior")
  boardStateAfter: BoardStatePayload;
  isDecision: boolean;        // True iff SELECT_IDLECMD / SELECT_BATTLECMD
  decisions?: DecisionMoment[];
}
```

Rules (from `CLAUDE.md` + `replay-precompute.ts`):
1. **Turn 0 ("Setup")** — all events before the first MSG_NEW_TURN flush as Turn 0. Then `currentTurn` increments. Transition boundary prompts (`SELECT_IDLECMD`, `SELECT_BATTLECMD`) trigger automatic state flushes; other SELECT_* prompts accumulate within the same state.
2. **MSG_CHAIN_END** flushes as its own state WITHOUT `chainIndex` — it acts as a separator between consecutive chains. The front hides it via `HIDDEN_LABELS` in `subEventSegments`.
3. **`generateLabel`** returns `''` for batches with only non-visual events (SELECT_*, WAITING_RESPONSE, MSG_CHAIN_END, MSG_CHAIN_SOLVING, etc.). `flushState` skips empty states.
4. **Per-event `boardStateAfter`** — `ChainSnapshotTracker` (the shared class) attaches snapshots during the chain-resolving window. Payload growth is ~50–150 KB gzipped per duel; snapshots are highly redundant.

> Snapshots reflect ocgcore state at `buildBoardState()` call time (post-batch if multiple events fire in one `duelProcess` call) — strictly better than no snapshot, but not truly per-event within a single batch. See `CLAUDE.md` §"Pre-computation Timeline Rules" for the full rules.

## Solver

### Connection lifecycle (`solver-handlers.ts`)

Four private maps — none exported:
- `solverConnections: Map<userId, ws>`
- `solverJwts: Map<userId, jwt>`
- `solverLastStart: Map<userId, ms>`
- `solverDeckCache: Map<userId:deckId, { main, extra, expiresAt }>`

Three public functions drive state from `server.ts`:

- `attachSolverConnection(userId, ws, jwt)` — atomic limit-check + replace + set. Returns:
  - `{ kind: 'limit' }` — server.ts closes ws with code 4029
  - `{ kind: 'attached', replaced: WS | null }` — server.ts closes the replaced socket with 4001 if present.
- `detachSolverConnection(userId, ws)` — idempotent. Guards the replace race (`if (solverConnections.get(userId) !== ws) return`) so a `close` handler firing after a replace doesn't kick out the new ws. Drops connection + JWT + the user's deck-cache prefix entries in one call.
- `getSolverConnection(userId)` / `getSolverJwt(userId)` — passive readers.

The actual `ws.close(...)` calls stay in `server.ts` — `solver-handlers` mutates state, `server.ts` owns socket lifecycle. `maxSolverConnections` lives in `SolverHandlerConfig` (getter for hot-reload via `/api/update-data`).

### Solver runtime — `src/solver/`

The solver module is the largest in the duel-server (43 .ts files). High-level layout:

| Sub-area | Files | Role |
|---|---|---|
| Search | `dfs-solver.ts`, `mcts-solver.ts`, `minimax-mcts-solver.ts`, `macro-dfs.ts` | Tree exploration |
| Oracles | `branching-oracles.ts`, `card-expertise-oracle.ts`, `mechanical-default-oracle.ts`, `route-aware-ranker.ts` | Action ranking |
| Board/FFI | `ocgcore-adapter.ts`, `game-oracle.ts`, `ocg-field-query.ts`, `ocg-constants.ts`, `card-metadata.ts` | State queries |
| Scoring | `interruption-scorer.ts`, `goal-match-evaluator.ts`, `structural-value-computer.ts`, `goldfish-chain-ranker.ts` | Position evaluation |
| Planning | `plan-replay-oracles.ts`, `prompt-resolver.ts` | Sequenced replay + handtrap injection |
| ML pipeline | `ml/` (10 files: neural, graph, path-biased, policy-guided rankers + loaders + pipeline) | Optional ranker stack |
| Infra | `solver-orchestrator.ts`, `solver-config-loader.ts`, `solver-verifier.ts`, `solver-instrumentation.ts`, `transposition-table.ts`, `tree-utils.ts`, `solver-assert.ts` | Pool mgmt + memoization |
| Tests | 50+ smoke tests + integration tests | |

### `interruption-tags.json` (scoring SoT)

`duel-server/data/interruption-tags.json` is the single source of truth for which cards count as end-board interruptions and how they score. Schema:

```json
{
  "<cardId>": {
    "cardName": "...",
    "effects": [
      {
        "type": "typedNegate" | "resourceDenial" | "handtrap" | ...,
        "usesPerTurn": 1,
        "trigger": "chain" | "activation" | "summon" | ...
      }
    ],
    "_generatedBy": "claude-opus-4-X",
    "_oracleVersion": "YYYY-MM-DD",
    "_validated": false
  }
}
```

The schema accepts `sharedOpt`, `totalUsesPerTurn`, per-effect `trigger`, and audit metadata. **The per-effect `trigger` field is critical** — the OPT-aware scorer disambiguates effects on multi-effect cards by it. Wrong/missing triggers fall back to index 0 with a runtime warning.

Adding new entries goes through the AI-assisted prompt at `_bmad-output/solver-data/interruption-tag-generation-prompt.md` — see [development-guide.md](./development-guide.md#adding-a-new-card-to-the-solver-scoring).

## HTTP API

`http-routes.ts` is itself a configurable module. Endpoints:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | 200 if `isDataReady`, else 503 |
| GET | `/status` | none | Server stats (activeDuels, totalDuelsServed, protocolMismatchCount, uptime, RSS) |
| GET | `/api/duels/active` | X-Internal-Key | List active duel IDs (consumed by Spring `RoomCleanupScheduler`) |
| PUT | `/api/update-data` | X-Internal-Key | Sync cards.cdb + scripts; re-init solver pool; **blocks while duels active** |
| POST | `/api/validate-passcodes` | X-Internal-Key | Pre-flight deck against `cards.cdb` |
| POST | `/api/duels` | X-Internal-Key | Create duel session, return `{ duelId, wsToken1, wsToken2 }`; arms 60 s connection timeout |
| DELETE | `/api/duels/{duelId}` | X-Internal-Key | Terminate duel (called by Spring on room end) |

See [api-contracts-duel-server.md](./api-contracts-duel-server.md) for HTTP + WebSocket contracts.

## Configuration

### `package.json` — key dependencies

- `@n1xx1/ocgcore-wasm` (via `@jsr/n1xx1__ocgcore-wasm`) — the engine.
- `ws` — WebSocket server.
- `better-sqlite3` — `cards.cdb` access (named DB + prepared statements).
- `piscina` — Worker pool.
- `zod` — Runtime schema validation.
- `@anthropic-ai/sdk` — Claude API (vendored; not yet integrated in live path).

### Scripts

| Script | Command |
|---|---|
| `prebuild` | `node ../scripts/check-ws-protocol-sync.mjs` |
| `build` | `tsc` |
| `start` | `node dist/server.js` |
| `test` | `vitest run` |
| `poc` | `tsx src/test-core.ts` |
| `solver-poc` | `tsx src/solver-poc.ts` |

### Environment variables

| Var | Default | Role |
|---|---|---|
| `PORT` | 3001 | WS + HTTP listen port |
| `DATA_DIR` | `../data` | Path to `cards.cdb`, scripts, etc. |
| `NODE_ENV` | — | Production check (gates Spring config) |
| `SPRING_BOOT_API_URL` | — | Required in prod (replay persistence) |
| `INTERNAL_API_KEY` | — | Required in prod (X-Internal-Key validation) |

Debug flags (sample):
- `OCG_DEBUG_LINK_MARKER`, `LOG_LEVEL`
- `SOLVER_USE_DFS_COMPRESSION`, `SOLVER_DEBUG_CANONICAL`, `SOLVER_DEBUG_ANNOUNCE`
- `SOLVER_USE_RESOURCE_SCORING` + W_BASE / THRESHOLD / PHASE_DECAY tuning knobs
- `SOLVER_USE_PATH_SCORING`, `SOLVER_PATH_W`
- `SOLVER_USE_SNAPSHOT` (P0-3bis WASM snapshot)
- `SOLVER_USE_PROMPT_RESOLVER`, `SOLVER_USE_PATH_RANKER`
- `SOLVER_INSTRUMENT`, `MACRO_DFS_DEBUG`

### Dockerfile

Single stage on `node:24-slim`. Installs curl/git/ca-certificates. Copies `scripts/check-ws-protocol-sync.mjs`, `package*.json`, `duel-server/`. Runs `npm ci && npm run build` (the prebuild step runs the protocol sync check first; build fails on divergence). Exposes 3001. CMD: `node dist/server.js`.

## Animation/state invariants and watchdogs

> Refresh on these from `CLAUDE.md` before debugging anything time-sensitive.

- **`POLL-DROP REGRESSION` watchdog** (`armPollDropWatchdog`) — fires `console.error('[POLL-DROP REGRESSION] ...')` and a `duelAssert(false, 'POLL-DROP-REGRESSION', ...)` if the chain stays in `'resolving'` and the queue stays empty for `POLL_DROP_REGRESSION_WATCHDOG_MS = 10 s`. **Don't reintroduce the chain-poll back-off** — find the missing event/signal upstream first. See `CLAUDE.md` §"Polling Removal — Regression Surface".
- **`duelAssert(condition, site, msg)`** — throws in dev, `console.error`s in prod. **Never** raw `if (isDevMode())` for new assertions.
- **`animation-constants.ts`** — single home for all timing magic numbers. Naming: `*_MS` (base), `*_MIN_MS` (floor), `*_TIMEOUT_MS` (safety, wrapped in `safetyTimeout` instead of `scaledDuration`).

## Tests

| Area | Examples |
|---|---|
| Core | `card-db-cache.spec.ts`, `chain-snapshot-tracker.spec.ts`, `chain-state-tracker.spec.ts` |
| Session | `duel-session-manager.spec.ts`, `duel-worker-cancel.spec.ts` (+ cancel-lifecycle, cancel-sweep variants) |
| Validation | `response-validation.spec.ts`, `worker-message-validation.spec.ts` |
| Protocol | `ws-protocol-shared.spec.ts` |
| Utils | `lru-map.spec.ts`, `message-filter.spec.ts`, `ws-rate-limit.spec.ts`, `timer-management.spec.ts`, `inactivity-timer.spec.ts` |
| Replay | `replay-precompute.spec.ts` |
| WASM/Snapshot | `wasm-snapshot.spec.ts`, `wasm-snapshot-wrapper.spec.ts`, `duel-worker-snapshot-poc.spec.ts`, `wasm-snapshot-multi-duel.spec.ts` |
| Solver | 50+ smoke tests under `src/solver/` (per-component) |

`chain-state-tracker.spec.ts` covers the four transitions (CHAINING, CHAIN_SOLVING, CHAIN_SOLVED, CHAIN_END) on a fresh container via `applyChainTransition(state, message)`. Verifies idle→building, resolving on solving, currentSolvingChainIndex tracking + clearing, negated indices accumulation + clearing on CHAIN_END, no-op for non-chain messages.

## Anomalies / known issues

1. **TODO `duel-worker.ts:1081`** — read LP from `fieldState.fp.lp` to avoid manual tracking drift.
2. **TODO `message-filter.ts:213` (Story 4.2)** — MSG_* `player` fields still use absolute OCGCore indices; relative-perspective filtering is ready in front but the back-side conversion is pending.
3. **P0-3bis.3 design choice (`duel-worker.ts:1301-1314`)** — phase transitions (Battle Phase, End Turn) and IDLECMD↔BATTLECMD pivots are intentionally NOT rollback-cancellable (rule binding + UX + fairness).
4. **Fork connection timeout (`server.ts:358`)** — 60 s hardcoded on duel creation; H2 audit finding noted but not parameterized.
5. **Solver handtrap inference** — handtraps are *inferred* by oracles (no ground truth from opponent); scoring may diverge on turn 1 vs mid-duel.

## Where to look next

- HTTP + WS contracts: [api-contracts-duel-server.md](./api-contracts-duel-server.md)
- Cross-part wiring: [integration-architecture.md](./integration-architecture.md)
- Annotated source tree: [source-tree-analysis.md](./source-tree-analysis.md#duel-server--node-websocket-server)
- AI agent rules (chain state, locks, animation parity, polling watchdog): [../CLAUDE.md](../CLAUDE.md)
- Solver R&D logs + methodology: [`_bmad-output/solver-data/`](../_bmad-output/solver-data/)
