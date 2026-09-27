# Integration Architecture

How the three deployable parts (`back`, `front`, `duel-server`) and the database talk to each other and to the outside world.

**Reading**: the cross-part wiring (network, integration points, auth, replay and solver flows, boot invariants); the
reference for what crosses a part boundary. Read by section: `Grep "^## "`, then `Read` by range.

## Contents

1. Component graph
2. Network tiers (Docker)
3. Integration points
4. Authentication flows
5. Replay flow
6. Solver flow
7. Boot invariants
8. Data flow summary table

## Component graph

```
                  ┌──────────────────────────────────────────┐
                  │  ygoprodeck.com (external card DB API)   │
                  └──────────────────┬───────────────────────┘
                                     │  HTTPS, REST
                                     │
┌────────────┐   HTTP+WS (TLS)   ┌───┴────────────┐                          ┌──────────────┐
│  Browser   │ ◀───────────────▶ │  front (nginx) │ ◀──┐                     │  PostgreSQL  │
│  (Angular) │                   │  reverse proxy │    │ /api  (REST + SSE)  │  (db:5432)   │
└────────────┘                   └────────────────┘    │                     └──────┬───────┘
                                         │             │                            │
                                         │ /duel-server│                            │ JDBC
                                         │ (WebSocket  │     ┌──────────────────┐   │
                                         │  passthru)  └──▶  │  back (Spring)   │ ◀─┘
                                         │                   │  :8080  /api     │
                                         │                   │  :8081  /actuator│
                                         ▼                   └──────┬───────────┘
                                ┌─────────────────┐                 │
                                │  duel-server    │ ◀───────────────┘
                                │  (Node, ws)     │     HTTP /api/duels (X-Internal-Key)
                                │  :3001          │     HTTP /api/replays (X-Internal-Key)
                                └─────────────────┘
```

## Network tiers (Docker)

| Network | Members | Internet access | Notes |
|---|---|---|---|
| `skytrix-internal` (bridge) | front, back, duel-server, certbot | front exposes 80/443 | Front talks to back + duel-server via service DNS |
| `skytrix-data` (bridge, `internal: true`) | back, db | none | Even the host can't reach db unless via `back` |

Only the **front** container publishes ports (`80`, `443`). The DB has no published port at all.

## Integration points

### 1. Browser → Nginx (front) — public HTTPS

| Path | Backed by | Protocol |
|---|---|---|
| `/` | static Angular assets | HTTP |
| `/api/*` | proxied to `back:8080` | HTTP |
| `/duel-server/*` (or equivalent) | proxied to `ws://duel-server:3001` | WebSocket |
| `/.well-known/acme-challenge/*` | served from `./certbot-webroot` | HTTP |

Nginx adds:
- HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Per-IP rate limits on `/api/login`, `/api/create-account` (10 req/min, burst 5) and `/api/client-logs` (10 req/min, burst 20).
- Correlated request-ID logging.

### 2. Front (Angular) → Back (Spring Boot) — REST + SSE

- Base URL: `/api` (proxied in dev via `proxy.conf.json` → `http://localhost:8080`).
- Auth: stateless JWT.
  - **Access token**: HTTP-only cookie `Access` (TTL ≈ 16.7 h, key `jwt.validity-period`).
  - **Refresh token**: HTTP-only cookie `Refresh`, `Secure`, `SameSite=Strict` (TTL 24 h, key `jwt.refresh-validity-period`). Hashed in DB on `User.refreshToken`. Login is HTTP Basic; everything else uses the cookie pair.
- Auth interceptor (`authInterceptor`) handles 401 by queueing requests behind a `BehaviorSubject<RefreshStep>` while a single refresh runs.
- Endpoints exposed without auth: `/login`, `/refresh`, `/create-account`, `/documents/*`, `/client-logs`, `/actuator/health`.
- Endpoints reserved for admin (`@Secured("ROLE_ADMIN")`): `/api/parameters/**`, `/api/rooms/quick-duel` (DevRoomController).
- Endpoints reserved for **duel-server-to-back** (X-Internal-Key header validation): `POST /api/replays`, `GET /api/internal/replays/{id}`.
- **Server-Sent Events**: `GET /api/rooms/{roomCode}/events` returns an `SseEmitter` that streams room state changes (player joined, ready, started, ended). One emitter per client per room.
- **CORS**: configured via env var `CORS_ALLOWED_ORIGINS` (comma-separated). Methods: GET/POST/PUT/DELETE.

See [api-contracts-back.md](./api-contracts-back.md) for the endpoint catalogue.

### 3. Back (Spring) → duel-server (Node) — server-to-server HTTP

The backend creates duels by calling the duel-server over plain HTTP on the internal network.

```
DuelServerClient (back) ──HTTP──▶ duel-server :3001 /api/duels
                                  X-Internal-Key: ${INTERNAL_API_KEY}
```

Endpoints called by back:
- `POST /api/duels` — create a duel session, returns `{ duelId, wsToken1, wsToken2 }`.
- `DELETE /api/duels/{duelId}` — terminate a duel (e.g., room ended early).
- `PUT /api/update-data` — sync `cards.cdb` + scripts after admin-triggered card data refresh; blocks while duels are active.
- `POST /api/validate-passcodes` — pre-flight: verify all card passcodes in a deck exist in `cards.cdb`.
- `GET /api/duels/active` — used by the `RoomCleanupScheduler` to reconcile stale rooms.

All carry `X-Internal-Key` (compared against `duel-server.internal-key` / `INTERNAL_API_KEY`).

### 4. duel-server (Node) → Back (Spring) — replay persistence

When a PvP duel ends, the duel-server posts the captured replay to the backend (also internal-key authed):

```
duel-server ──HTTP──▶ back :8080 /api/replays  (X-Internal-Key)
                                  body: { player1, player2, metadata, replayData }
                      ──HTTP──▶ back :8080 /api/internal/replays/{id}
                                  (read-back during fork-from-decision)
```

The `Replay` entity stores `metadata` and `replayData` as JSONB columns; replays are retained for `replay.retention-days` (default 30, env var `REPLAY_RETENTION_DAYS`).

### 5. Front → duel-server — WebSocket

The front-end connects directly to the duel-server (through nginx in prod, directly in dev) for live game traffic.

| Mode | URL pattern | What it does |
|---|---|---|
| PvP duel | `wss://host/?token=<wsToken>&pv=<protocolVersion>` (or `?reconnect=...`) | Live duel: chain events, prompts, animations, RPS, rematch |
| Replay | `wss://host/?mode=replay&replayId=<uuid>&token=<jwt>&pv=<protocolVersion>` | Replay scrubber + fork-from-decision |
| Solver | `wss://host/?mode=solver` (JWT in querystring) | Combo path solver progress + result streaming |

**Protocol version** (`?pv=`) is mandatory for PvP and Replay modes. Mismatch closes the socket with **code `4426`** (analog of HTTP 426 Upgrade Required). Every connection service in front (`duel-connection.ts`, `replay-connection.service.ts`, `solver.service.ts`) MUST handle `event.code === 4426` distinctly to surface a "client outdated, refresh" UX. Solver is currently exempt from version gating.

The 6 `ws-protocol-*.ts` sub-files are **byte-synced** between front (`front/src/app/pages/pvp/duel-ws.types.ts/`) and back (`duel-server/src/`) by `scripts/check-ws-protocol-sync.mjs`, which runs as the duel-server `prebuild` step.

### 6. duel-server → cards.cdb (SQLite)

Read-only access via `better-sqlite3`. Cached behind `card-db-cache.ts` (LRU memoization of cardCode → parsed row). The DB sits in the `duel_data` Docker volume mounted at `/app/data`.

### 7. Back → ygoprodeck.com — card data ingest

`requester/YugiproRequester` (extends `Requester`) calls `https://db.ygoprodeck.com/api/v7/cardinfo.php` with retry (3 attempts, exponential 1s/2s/4s) on 429 and 5xx. Used by `YugiproApiService` for:
- Full sync (per language: EN, FR, with `misc=yes` and `format=genesys`)
- Single-card refresh (by name or passcode)
- Image download (`https://images.ygoprodeck.com/images/cards[_small]/{imageId}.jpg`)

Triggered manually via the **Paramètres** admin page.

## Authentication flows

### Login → access duel

```
Browser ──POST /api/login (HTTP Basic)──▶ back
back ◀──── 200 + Set-Cookie: Access, Refresh ──── responds
Browser ──POST /api/rooms { deckId } (Cookie)─▶ back
back ──POST /api/duels { players, decks } (X-Internal-Key)─▶ duel-server
duel-server ◀── { duelId, wsToken1, wsToken2 } ─── responds
back ◀──── { roomCode, ... } ──── front
Browser ──WS upgrade ?token=<wsToken1>&pv=...──▶ duel-server
                                                  consumePendingToken → ok
                                                  binds ws → session.players[0]
                                                  sends DUEL_STARTING + SESSION_TOKEN + STATE_SYNC
```

### Reconnect after a drop

```
Browser ◀── ws closed (code 1006/etc) ──── duel-server
                          │ session held alive for RECONNECT_GRACE_MS = 60s
Browser ──WS upgrade ?reconnect=<token>&pv=...──▶ duel-server
                                                  consumeReconnectToken → ok | session-gone | unknown
                                                  rebinds ws, cancels grace timer
                                                  resends current STATE_SYNC + pending prompt
```

After both players disconnect, the session is preserved for `BOTH_DISCONNECTED_CLEANUP_MS = 4 h` before being torn down.

## Replay flow

```
[ Live PvP duel ]
  duel-worker.runDuelLoop runs ocgcore in a worker thread
  ChainSnapshotTracker attaches `boardStateAfter` snapshots to BOARD_CHANGING events during chain resolution
  on MSG_WIN / DUEL_END:
     duel-server ──POST /api/replays──▶ back   (replay JSON persisted as JSONB)

[ User opens a replay ]
  front ──GET /api/replays──▶ back              (list metadata for current user, paginated)
  front ──WS ?mode=replay&replayId=...──▶ duel-server
  duel-server pulls the replay from back via /api/internal/replays/{id}
              runs runReplayPreComputation in a Piscina worker
              ChainSnapshotTracker (same class!) re-attaches identical snapshots
              sends REPLAY_METADATA, streams REPLAY_STREAM_CHUNKs, then REPLAY_STREAM_INIT (final nav index)
  front renders the timeline using the same AnimationOrchestratorService
       (via the AnimationDataSource interface — DuelWebSocketService for live, MockDuelConnection for replay)
```

The fact that `ChainSnapshotTracker` is the **same class** in both code paths is the parity guarantee: the field name, predicate, and timing are identical by construction.

## Solver flow

```
front ──WS ?mode=solver──▶ duel-server
                                duel-server.solver-handlers.attachSolverConnection(userId, ws, jwt)
                                  → atomic limit-check + replace + map-set
                                  → returns { kind: 'limit' | 'attached' (replaced?) }
                                  → server.ts closes the replaced ws with code 4001 if needed
                                  → over-limit returns close code 4029
front sends SOLVER_INIT (deckId, config)
duel-server caches (userId, deckId) → deck list  (solverDeckCache, expiringly)
front sends SOLVER_START (board state, handtraps, time budget)
duel-server.solver-orchestrator queues a Piscina worker
worker streams SOLVER_PROGRESS (nodes searched, best score, elapsed)
              SOLVER_RESULT  (decision tree)
              SOLVER_CANCELLED / SOLVER_ERROR
on ws close: detachSolverConnection(userId, ws) — idempotent, race-safe with attach
```

The handtrap inference uses `data/interruption-tags.json` (60 KB SoT) + `interruption-weights.json`. The schema accepts `sharedOpt`, `totalUsesPerTurn`, per-effect `trigger`, and audit metadata (`_generatedBy`, `_oracleVersion`, `_validated`); existing entries without these fields still load — the loader is forward-compatible.

## Boot invariants

### Backend boot
- Flyway migrations run automatically (`spring.flyway.enabled=true`, `spring.flyway.out-of-order=true`).
- `@SpringBootApplication` wires the layered architecture; nothing custom required at boot.
- Healthcheck (`/actuator/health`) gates compose dependencies.

### Duel-server boot
The boot invariant in `server.ts` (just before `wss.on('connection')`) **throws** if any of the four configurable modules has not been configured:
- `http-routes`
- `replay-handlers`
- `timer-management`
- `solver-handlers`

Each module exposes `isXxxConfigured()` via `createConfigurable<T>(name)`. Any new configurable module MUST register its predicate in this block — that's the regression fence for the whole pattern.

## Data flow summary table

| Source | Sink | Protocol | Auth | Note |
|---|---|---|---|---|
| Browser | front (nginx) | HTTPS | session cookies | TLS 1.2/1.3, HSTS |
| front (nginx) | back :8080 | HTTP (in-cluster) | cookie passthru | rate-limited at nginx |
| front (nginx) | duel-server :3001 | WS (in-cluster) | wsToken / JWT in querystring | protocol version gate (4426) |
| back | db :5432 | JDBC | DB user | only network with internal:true |
| back | duel-server :3001 | HTTP | X-Internal-Key | `DuelServerClient` |
| duel-server | back :8080 | HTTP | X-Internal-Key | replay persistence + read-back |
| back | ygoprodeck.com | HTTPS | none (public) | retry on 429/5xx |
| duel-server | cards.cdb (SQLite) | local FS | n/a | LRU cache |
| Spring `RoomCleanupScheduler` | duel-server `/api/duels/active` | HTTP | X-Internal-Key | reconciles stale rooms |
