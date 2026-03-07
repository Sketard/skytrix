# Story 1.2: Duel Server Scaffold & Protocol Definition

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a runnable Node.js duel server with the complete WebSocket protocol definition,
so that server and client development can proceed in parallel against a frozen protocol.

## Acceptance Criteria

1. **Given** the duel-server/ project exists as a PoC (poc-duel.ts, test-core.ts)
   **When** the scaffold is production-ready
   **Then** `duel-server/package.json` includes all production dependencies: `@n1xx1/ocgcore-wasm` (existing), `ws` (new), `better-sqlite3` (existing), and `patch-package` moved from devDependencies to dependencies (required for Docker `postinstall`)
   **And** `tsconfig.json` targets ES2022, module ESNext, `moduleResolution: "nodenext"` (changed from PoC's `"bundler"` — required for `node dist/server.js` ESM resolution), strict mode, outDir: dist/
   **And** `"type": "module"` in package.json is preserved (existing, required for ESM)
   **And** `patches/@n1xx1+ocgcore-wasm+0.1.1.patch` remains in place (ESM fix)

2. **Given** the scaffold is created
   **When** `src/ws-protocol.ts` is implemented
   **Then** it defines ALL WebSocket DTO types as union discriminated types with zero internal imports (self-contained, copied to Angular)
   **And** message types use `SCREAMING_SNAKE_CASE` string literals
   **And** all fields use `camelCase`
   **And** absent optional values use explicit `null` (never field omission)
   **And** message categories are:
   - **Server→Client game** (19): `BOARD_STATE`, `MSG_MOVE`, `MSG_DRAW`, `MSG_DAMAGE`, `MSG_RECOVER`, `MSG_PAY_LPCOST`, `MSG_CHAINING`, `MSG_CHAIN_SOLVING`, `MSG_CHAIN_SOLVED`, `MSG_CHAIN_END`, `MSG_HINT`, `MSG_CONFIRM_CARDS`, `MSG_SHUFFLE_HAND`, `MSG_FLIP_SUMMONING`, `MSG_CHANGE_POS`, `MSG_SWAP`, `MSG_ATTACK`, `MSG_BATTLE`, `MSG_WIN`
   - **Server→Client prompts** (20): `SELECT_IDLECMD`, `SELECT_BATTLECMD`, `SELECT_CARD`, `SELECT_CHAIN`, `SELECT_EFFECTYN`, `SELECT_YESNO`, `SELECT_PLACE`, `SELECT_DISFIELD`, `SELECT_POSITION`, `SELECT_OPTION`, `SELECT_TRIBUTE`, `SELECT_SUM`, `SELECT_UNSELECT_CARD`, `SELECT_COUNTER`, `SORT_CARD`, `SORT_CHAIN`, `ANNOUNCE_RACE`, `ANNOUNCE_ATTRIB`, `ANNOUNCE_CARD`, `ANNOUNCE_NUMBER`
   - **Server→Client system** (7): `DUEL_END`, `TIMER_STATE`, `RPS_CHOICE`, `RPS_RESULT`, `REMATCH_CANCELLED`, `WORKER_ERROR`, `STATE_SYNC`
   - **Client→Server** (3): `PLAYER_RESPONSE`, `SURRENDER`, `REMATCH_REQUEST`
   **And** `PLAYER_RESPONSE` uses a single message type with a `promptType` discriminant field matching the originating `SELECT_*` type — e.g., `{ type: 'PLAYER_RESPONSE', promptType: 'SELECT_CARD', data: { indices: [0, 2] } }`. The `data` field is a union discriminated by `promptType`

3. **Given** `ws-protocol.ts` is defined
   **When** `src/types.ts` is implemented
   **Then** it defines internal types: worker-to-main message types (`WORKER_DUEL_CREATED`, `WORKER_MESSAGE`, `WORKER_ERROR`), session state interfaces (`DuelSession`, `PlayerSession`), constants (`MAX_PAYLOAD_SIZE = 4096`, `RECONNECT_GRACE_MS = 60000`, `WATCHDOG_TIMEOUT_MS = 30000`, `RPS_TIMEOUT_MS = 30000`, `INACTIVITY_TIMEOUT_MS = 100000`)

4. **Given** `ws-protocol.ts` and `types.ts` exist
   **When** `src/server.ts` is implemented
   **Then** it creates a `ws.WebSocketServer({ maxPayload: 4096 })` on a `node:http` server
   **And** `GET /health` returns HTTP 200 with `{ status: 'ok' }`
   **And** `GET /status` returns JSON: `{ activeDuels: number, totalDuelsServed: number, uptimeMs: number, memoryUsageMb: number }` (memoryUsageMb = `process.memoryUsage().rss / 1024 / 1024` — RSS is more relevant than heap for a WASM worker server)
   **And** `POST /api/duels` and `POST /api/duels/:id/join` route stubs exist (return 501 Not Implemented — actual logic is Story 1.3)
   **And** WebSocket connection handler stub exists (accepts connection, extracts JWT from query param `?token=xxx` but only validates token is non-empty string — real JWT signature validation deferred to Story 1.4 when Spring Boot auth is integrated)
   **And** graceful shutdown on SIGTERM/SIGINT closes HTTP server + WebSocket server
   **And** the server listens on `PORT` environment variable (default 3001)

5. **Given** the scaffold exists
   **When** `duel-server/LICENSE` is created
   **Then** it contains the AGPL-3.0 full license text

6. **Given** the scaffold exists
   **When** `duel-server/Dockerfile` is created
   **Then** it uses `FROM node:24-slim` (Node 24 LTS)
   **And** `WORKDIR /app`
   **And** `COPY package*.json ./` → `RUN npm ci` (installs deps + runs postinstall patch-package)
   **And** `RUN apt-get update && apt-get install -y curl --no-install-recommends && rm -rf /var/lib/apt/lists/*` (required for Docker healthcheck — `node:24-slim` does NOT include curl)
   **And** `COPY . .` → `RUN npm run build`
   **And** `CMD ["node", "dist/server.js"]`
   **And** exposes port 3001
   **And** native module `better-sqlite3` compiles in the same image as runtime (no multi-stage that splits build/runtime for native deps)
   **And** a `.dockerignore` file exists in `duel-server/` excluding `node_modules/`, `dist/`, `*.md`, `.git`, `data/` (data is mounted via volume, not baked into image)

7. **Given** the Dockerfile exists
   **When** `docker-compose.yml` is updated
   **Then** a `duel-server` service is added with:
   - `build: ./duel-server`
   - `volumes: ["./duel-server/data:/app/data:ro"]`
   - `environment: [PORT=3001]`
   - `networks: [skytrix-internal]`
   - `healthcheck: test: ["CMD", "curl", "-f", "http://localhost:3001/health"], interval: 30s, timeout: 10s, retries: 3, start_period: 10s`
   - NO `ports:` section (port not exposed externally — Angular connects via reverse proxy in production)
   **And** the `back` service gets `DUEL_SERVER_URL=http://duel-server:3001` environment variable
   **And** a `skytrix-internal` network is defined

8. **Given** `ws-protocol.ts` is frozen
   **When** the Angular PvP types file is created
   **Then** `front/src/app/pages/pvp/duel-ws.types.ts` is a manual copy of `ws-protocol.ts` with identical type definitions
   **And** a comment at the top documents the same-commit update rule: "Manual copy of duel-server/src/ws-protocol.ts — update both in the same commit"

9. **Given** the scaffold is complete
   **When** `npm run build` is executed in `duel-server/`
   **Then** TypeScript compiles without errors to `dist/`
   **And** `node dist/server.js` starts and responds to `GET /health` with 200

10. **Given** `docker-compose up duel-server` is run
    **When** the container starts
    **Then** `GET /health` returns 200
    **And** `GET /status` returns valid JSON with all 4 fields

## Tasks / Subtasks

- [x] Task 1: Production dependencies & build setup (AC: #1, #9)
  - [x] 1.1 Add `ws@^8.19.0` and `@types/ws` to package.json
  - [x] 1.2 Move `patch-package` from devDependencies to dependencies
  - [x] 1.3 Add `"build": "tsc"` and `"start": "node dist/server.js"` scripts
  - [x] 1.4 Change tsconfig.json `moduleResolution` from `"bundler"` to `"nodenext"` (required for production Node.js ESM)
  - [x] 1.5 Verify `"type": "module"` preserved in package.json
- [x] Task 2: ws-protocol.ts — Protocol boundary (AC: #2)
  - [x] 2.1 Define server→client game message types (19 types)
  - [x] 2.2 Define server→client prompt message types (20 types)
  - [x] 2.3 Define server→client system message types (7 types)
  - [x] 2.4 Define client→server message types (3 types)
  - [x] 2.5 Define `PlayerResponse` with `promptType` discriminant and `data` union — `ResponseData` variants: `IdleCmdResponse { action, index? }`, `BattleCmdResponse { action, index? }`, `CardResponse { indices }`, `ChainResponse { index | null }`, `EffectYnResponse { yes }`, `PlaceResponse { places[] }`, `PositionResponse { position }`, `OptionResponse { index }`, `YesNoResponse { yes }`, `TributeResponse { indices }`, `SumResponse { indices }`, `CounterResponse { counts[] }`, `SortResponse { order }`, `AnnounceResponse { value }` (see Dev Notes → Message Type Reference for shapes)
  - [x] 2.6 Define `ServerMessage` and `ClientMessage` union discriminated types
  - [x] 2.7 Define shared primitive types at file top (`CardLocation`, `ZoneId`, `Position`, `Phase`, `Player`)
  - [x] 2.8 Verify zero internal imports (file must be self-contained)
  - [x] 2.9 Recommended file order: shared primitives → game messages → prompt messages → system messages → client messages → union exports
  - [x] 2.10 Define `BOARD_STATE` with reusable sub-types `BoardZone` and `CardOnField` (most complex type). `STATE_SYNC` reuses the same `BoardStatePayload` type as its `data` field — NOT a separate type. Both `{ type: 'BOARD_STATE', data: BoardStatePayload }` and `{ type: 'STATE_SYNC', data: BoardStatePayload }` share the identical payload interface
- [x] Task 3: types.ts — Internal types (AC: #3)
  - [x] 3.1 Define worker message types (WORKER_DUEL_CREATED, WORKER_MESSAGE, WORKER_ERROR)
  - [x] 3.2 Define session state interfaces (DuelSession, PlayerSession)
  - [x] 3.3 Define constants (MAX_PAYLOAD_SIZE, timeouts, etc.)
- [x] Task 4: server.ts — HTTP + WebSocket skeleton (AC: #4)
  - [x] 4.1 Create node:http server with GET /health and GET /status routes
  - [x] 4.2 Create ws.WebSocketServer with maxPayload: 4096
  - [x] 4.3 Add POST /api/duels and POST /api/duels/:id/join stubs (501)
  - [x] 4.4 Add WebSocket connection handler stub (JWT validation placeholder)
  - [x] 4.5 Add graceful shutdown (SIGTERM/SIGINT → close server + WS)
- [x] Task 5: LICENSE file (AC: #5)
  - [x] 5.1 Create duel-server/LICENSE with AGPL-3.0 text
- [x] Task 6: Dockerfile & .dockerignore (AC: #6)
  - [x] 6.1 Create Dockerfile with node:24-slim, apt-get install curl, npm ci, build, expose 3001
  - [x] 6.2 Create `duel-server/.dockerignore` excluding `node_modules/`, `dist/`, `*.md`, `.git`, `data/`
- [x] Task 7: docker-compose.yml update (AC: #7)
  - [x] 7.1 Add duel-server service with volume, env, network, healthcheck
  - [x] 7.2 Add DUEL_SERVER_URL to back service
  - [x] 7.3 Define skytrix-internal network
- [x] Task 8: Angular duel-ws.types.ts (AC: #8)
  - [x] 8.1 Create front/src/app/pages/pvp/ directory structure
  - [x] 8.2 Copy ws-protocol.ts as duel-ws.types.ts with header comment
- [x] Task 9: Build verification (AC: #9, #10)
  - [x] 9.1 Run npm run build — verify zero TS errors
  - [x] 9.2 Run node dist/server.js — verify /health returns 200
  - [ ] 9.3 docker-compose up duel-server — verify container health (requires Docker Desktop)

## Dev Notes

### Architecture Compliance

- **This story is Phase 0 (Gate)** — `ws-protocol.ts` is the gating item for ALL parallel work. Once frozen, Stories 1.3-1.7 can proceed.
- **ADR-2 (Independent WebSocket DTOs)**: `ws-protocol.ts` must have ZERO internal imports. It is copied verbatim to Angular. Any `import` from server internals breaks the client.
- **ADR-4 (Whitelist message filter)**: The 49 message types in `ws-protocol.ts` define the complete protocol surface. Message filter implementation is Story 1.3.
- **Production source files (7 planned)**: This story creates 3 of 7 (`ws-protocol.ts`, `types.ts`, `server.ts`). Remaining 4 (`duel-worker.ts`, `message-filter.ts`, `ocg-callbacks.ts`, `ocg-scripts.ts`) are Story 1.3.

### Existing PoC Code — DO NOT MODIFY

- `src/poc-duel.ts` — Full duel loop with auto-player (validates OCGCore API patterns: `createCore`, `createDuel`, `duelProcess`, `duelGetMessage`, `duelSetResponse`, `duelQueryField`)
- `src/test-core.ts` — Minimal core loading test
- These files are reference only. Production code (`server.ts`, etc.) is NEW, not a refactoring of PoC files.

### Critical Technical Details

#### moduleResolution "nodenext" — Import Extension Requirement
- With `moduleResolution: "nodenext"`, ALL relative imports MUST use `.js` extension — e.g., `import { ServerMessage } from './ws-protocol.js'` (not `./ws-protocol` or `./ws-protocol.ts`)
- This is a TypeScript requirement for ESM + nodenext: TS resolves `.js` → `.ts` at compile time, and Node.js needs the `.js` extension at runtime
- Applies to `server.ts` importing from `ws-protocol.ts` and `types.ts`
- PoC files (`poc-duel.ts`, `test-core.ts`) are NOT modified — they may use extensionless imports (run via `tsx`, not `node dist/`)

#### @n1xx1/ocgcore-wasm ESM Fix
- Package installed from JSR: `"@n1xx1/ocgcore-wasm": "npm:@jsr/n1xx1__ocgcore-wasm@^0.1.1"`
- Requires `patch-package` ESM fix in `patches/@n1xx1+ocgcore-wasm+0.1.1.patch`
- `patch-package` MUST be in `dependencies` (not devDependencies) — `postinstall` must run during Docker `npm ci`

#### ws-protocol.ts Design Rules
- **All message types**: `SCREAMING_SNAKE_CASE` string literals — e.g., `'MSG_DRAW'`, `'SELECT_CARD'`
- **Union discriminated types**: `type ServerMessage = MsgDraw | MsgMove | SelectCard | ...` where each variant has `{ type: 'MSG_DRAW'; ... }`
- **Fields**: `camelCase` — e.g., `playerId`, `cardCode`, `zoneSequence`
- **Absent values**: explicit `null`, NEVER field omission — e.g., `{ cardCode: null }` not `{}`
- **Rationale**: Angular `Signal<X | null>` requires explicit null for reactivity. `undefined` vs `null` mismatch causes signal bugs.
- **OCGCore enum values**: DO NOT re-export OCGCore enums in ws-protocol.ts. Use plain number literals or define independent enums. The protocol must not depend on OCGCore internals.
- **File organization**: Define shared primitive types first (`CardLocation`, `ZoneId`, `Position`, `Phase`, `Player`), then game messages, then prompts, then system, then client messages, then union type exports. File will be ~500-800 lines — organization is critical for maintainability.
- **PLAYER_RESPONSE design**: Single message type `{ type: 'PLAYER_RESPONSE', promptType: SelectPromptType, data: ResponseData }` where `ResponseData` is a union discriminated by `promptType`. This avoids 20 separate client→server message types while keeping type safety.
- **BOARD_STATE complexity**: This is the most complex type — it is a composite snapshot (all zones with card data + both players' LP + current phase + turn player + turn count). Define a reusable `BoardStatePayload`, `BoardZone` and `CardOnField` sub-type to keep it manageable. `STATE_SYNC` reuses the same `BoardStatePayload` as its `data` field (identical interface, different `type` discriminant) — do NOT create a separate payload type for reconnection.

#### Protocol Invariant
`MSG_HINT` → `SELECT_*` → `PLAYER_RESPONSE` — always in this order. Prompt without preceding hint is a bug.

#### Message Type Reference
The PoC (`poc-duel.ts` lines 99-177) shows all SELECT_* response shapes. Use this as reference for `PLAYER_RESPONSE` payload design. Key response types from OCGCore:
- `SELECT_IDLECMD`: `{ action: number, index?: number }` (7 action types: summon, spsummon, repos, setmonst, activatecard, setspell, to_bp/to_ep)
- `SELECT_BATTLECMD`: `{ action: number, index?: number }` (4 action types: attack, activate, to_m2, to_ep)
- `SELECT_CARD`: `{ indices: number[] }` (min/max selection count)
- `SELECT_CHAIN`: `{ index: number | null }` (null = pass/don't chain)
- `SELECT_EFFECTYN`: `{ yes: boolean }`
- `SELECT_PLACE`: `{ places: { player, location, sequence }[] }`
- `SELECT_POSITION`: `{ position: number }` (OcgPosition enum value)

**SELECT_* types NOT covered by PoC** (13 of 20): `SELECT_YESNO`, `SELECT_DISFIELD`, `SELECT_OPTION`, `SELECT_TRIBUTE`, `SELECT_SUM`, `SELECT_UNSELECT_CARD`, `SELECT_COUNTER`, `SORT_CARD`, `SORT_CHAIN`, `ANNOUNCE_RACE`, `ANNOUNCE_ATTRIB`, `ANNOUNCE_CARD`, `ANNOUNCE_NUMBER`. For these, consult `@n1xx1/ocgcore-wasm` source types and OCGCore C API documentation. Acceptable minimal shapes: `{ value: number }` for single-value prompts, `{ indices: number[] }` for multi-select prompts, `{ values: number[] }` for announce/sort prompts. Refine in Story 1.3 when the duel worker implements the actual OCGCore message→DTO transformation.

#### server.ts Design Rules
- `server.ts` is the SOLE WebSocket owner — no other file calls `ws.send()`
- `node:http` server handles 4 HTTP routes (health, status, duels, duels/:id/join) — no Express/Fastify
- JSON body parsing via raw `request.on('data')` + `JSON.parse` (4 routes only, no middleware needed)
- WebSocket auth: JWT token from query parameter `?token=xxx` at handshake (one-shot, no per-message re-validation)
- `maxPayload: 4096` prevents JSON payload DoS
- WebSocket heartbeat: native `ws` ping/pong (no application-level heartbeat messages)

#### Docker Configuration
- `FROM node:24-slim` — Node 24 LTS (active LTS through April 2028)
- `better-sqlite3` is a native C++ module — MUST `npm ci` in the runtime image (no multi-stage split that builds in one image and copies to another)
- Data volume mounted `:ro` — duel server NEVER writes to card data or scripts
- Port 3001 NOT exposed externally in docker-compose — Angular connects via reverse proxy in production
- `curl` needed for healthcheck — `node:24-slim` does NOT include curl. Dockerfile MUST `apt-get install -y curl --no-install-recommends` before npm ci

#### Node.js Version Note
- Architecture document specified "Node.js 22+ LTS" — however Node 22.x enters maintenance LTS end April 2026. Use Node 24 LTS (Krypton, active LTS through April 2028) for the Dockerfile.
- Local development: any Node 22+ works (tsx compatibility)

#### TypeScript Version Note
- Project uses `"typescript": "^5.9.3"` — stable, proven. TS 6.0 is beta (Feb 2026), not recommended for production yet. Keep 5.9.x.

### ws Library Reference (v8.19.0)
```typescript
import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 });
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  // req.url contains query params (?token=xxx)
  ws.on('message', (data: Buffer) => { /* JSON.parse(data.toString()) */ });
  ws.send(JSON.stringify(payload));
  ws.ping(); // native heartbeat
});
```

### Project Structure Notes

**Files to create (this story):**
```
duel-server/
├── src/
│   ├── ws-protocol.ts    # NEW — Protocol boundary (source of truth)
│   ├── types.ts          # NEW — Internal types
│   └── server.ts         # NEW — HTTP + WebSocket server
├── .dockerignore         # NEW — Docker build context filter
├── Dockerfile            # NEW — Docker build
└── LICENSE               # NEW — AGPL-3.0
```

**Files to modify (this story):**
```
duel-server/package.json     # Add ws, move patch-package, add build/start scripts
docker-compose.yml           # Add duel-server service
```

**Files to create (Angular side):**
```
front/src/app/pages/pvp/
└── duel-ws.types.ts         # NEW — Manual copy of ws-protocol.ts
```

**Existing files — DO NOT TOUCH:**
```
duel-server/src/poc-duel.ts  # PoC reference
duel-server/src/test-core.ts # PoC reference
duel-server/patches/         # ESM fix (keep as-is)
duel-server/data/            # Card DB + scripts (keep as-is)
```

### Alignment with Unified Project Structure

- `duel-server/` is a NEW top-level directory (sibling to `front/` and `back/`) — matches architecture §Project Structure
- Angular PvP files go in `front/src/app/pages/pvp/` — matches existing `pages/` convention
- All TypeScript files use `kebab-case.ts` naming — matches project-context.md naming rules
- `duel-ws.types.ts` uses `.types.ts` suffix — consistent with Angular type file conventions

### Detected Conflicts or Variances

1. **Node.js version**: Architecture says "22+ LTS", Dockerfile uses 24 LTS (active LTS, 22 entering maintenance). This is a forward-compatible upgrade, not a conflict.
2. **tsconfig moduleResolution**: Current PoC has `"bundler"` — MUST change to `"nodenext"` for production Node.js ESM runtime. `"bundler"` only works with bundlers (tsx, vite), not `node dist/server.js`. This is a required fix, covered in Task 1.4.
3. **patch-package location**: Currently in devDependencies — MUST move to dependencies for Docker build. This is a fix, not a conflict.
4. **package.json "type": "module"**: Already present in PoC — MUST be preserved. Removal would break ESM imports.

### References

- [Source: architecture-pvp.md#Project Structure & Boundaries] — Complete duel server file tree (7 production files)
- [Source: architecture-pvp.md#Core Architectural Decisions] — ADR-2 (independent DTOs), ADR-4 (whitelist filter)
- [Source: architecture-pvp.md#Implementation Patterns & Consistency Rules] — Naming, format, communication patterns
- [Source: architecture-pvp.md#Decision Impact Analysis] — Phase 0 gate, implementation dependency graph
- [Source: epics-pvp.md#Story 1.2] — Acceptance criteria, message type lists
- [Source: prd-pvp.md#Web App Technical Context] — Dependencies, ports, communication architecture
- [Source: project-context.md#Technology Stack] — TypeScript strict, Angular 19 patterns
- [Source: duel-server/src/poc-duel.ts] — OCGCore API usage patterns (createCore, createDuel, duelProcess, etc.)
- [Source: duel-server/package.json] — Current dependency versions and ESM configuration

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- TS5110: `module: "ESNext"` incompatible with `moduleResolution: "nodenext"` in TS 5.9 — changed to `module: "nodenext"`. AC #1 specified ESNext but TS 5.9.3 enforces this constraint.
- PoC files (`poc-duel.ts`, `test-core.ts`) fail with `nodenext` module resolution (no default export from ocgcore-wasm, named exports differ). Added `exclude` in tsconfig.json — PoC files are run via `tsx` only, not the production build.

### Completion Notes List

- Task 1: package.json updated — `ws@^8.19.0` + `@types/ws` added, `patch-package` moved to dependencies, build/start scripts added, moduleResolution changed to nodenext, module changed to nodenext (TS 5.9 requirement), `"type": "module"` preserved.
- Task 2: `ws-protocol.ts` created (~490 lines) — 49 message types (19 game + 20 prompt + 7 system + 3 client), zero internal imports, SCREAMING_SNAKE_CASE type discriminants, camelCase fields, explicit null for absent values. `PlayerResponseMsg` discriminated union by `promptType` with 14 response data variants. `BoardStatePayload` shared between `BOARD_STATE` and `STATE_SYNC`. Independent `POSITION` and `LOCATION` constants (not re-exported OCGCore enums).
- Task 3: `types.ts` created — 5 constants (MAX_PAYLOAD_SIZE, RECONNECT_GRACE_MS, WATCHDOG_TIMEOUT_MS, RPS_TIMEOUT_MS, INACTIVITY_TIMEOUT_MS), 3 worker message types, DuelSession and PlayerSession interfaces.
- Task 4: `server.ts` created — node:http with 4 routes (health/200, status/200 with 4 fields, duels/501, duels/:id/join/501), WebSocketServer with maxPayload:4096, JWT token check (non-empty string), graceful SIGTERM/SIGINT shutdown, PORT env with default 3001.
- Task 5: LICENSE created — AGPL-3.0 full text downloaded from gnu.org.
- Task 6: Dockerfile (node:24-slim, curl for healthcheck, npm ci, tsc build, expose 3001) + .dockerignore (node_modules, dist, *.md, .git, data).
- Task 7: docker-compose.yml — duel-server service with volume (:ro), PORT=3001, skytrix-internal network, healthcheck via curl. DUEL_SERVER_URL added to back service. skytrix-internal network defined.
- Task 8: `duel-ws.types.ts` — verbatim copy of ws-protocol.ts in front/src/app/pages/pvp/.
- Task 9: `npm run build` passes (zero TS errors), `node dist/server.js` starts on port 3001, /health returns 200 `{"status":"ok"}`, /status returns JSON with activeDuels/totalDuelsServed/uptimeMs/memoryUsageMb. Docker container test (9.3) deferred — requires Docker Desktop.

### File List

- `duel-server/src/ws-protocol.ts` — NEW (protocol DTOs, 49 message types)
- `duel-server/src/types.ts` — NEW (internal types, constants, session interfaces)
- `duel-server/src/server.ts` — NEW (HTTP + WebSocket server skeleton)
- `duel-server/Dockerfile` — NEW (node:24-slim production image)
- `duel-server/.dockerignore` — NEW (build context filter)
- `duel-server/LICENSE` — NEW (AGPL-3.0)
- `duel-server/package.json` — MODIFIED (ws dep, patch-package moved, scripts added, license → AGPL-3.0-only)
- `duel-server/package-lock.json` — MODIFIED (regenerated from dependency changes)
- `duel-server/tsconfig.json` — MODIFIED (moduleResolution/module → nodenext, exclude PoC files, removed declaration)
- `docker-compose.yml` — MODIFIED (duel-server service, DUEL_SERVER_URL, skytrix-internal network for all services)
- `.gitignore` — MODIFIED (added duel-server/dist/)
- `front/src/app/pages/pvp/duel-ws.types.ts` — NEW (Angular copy of ws-protocol.ts)

## Change Log

- 2026-02-25: Story 1.2 implementation complete — Duel server scaffold with production build, 49-type WebSocket protocol frozen in ws-protocol.ts, HTTP/WS server skeleton, Docker config, Angular types copy. TS module changed from ESNext to nodenext (TS 5.9 requirement). PoC files excluded from production build.
- 2026-02-25: Code review fixes — (1) CRITICAL: docker-compose.yml added db/front to skytrix-internal network (was breaking back↔db connectivity), (2) package.json license ISC→AGPL-3.0-only, (3) server.ts removed readBody from 501 stubs (DoS vector), (4) server.ts removed dead on('pong') handler (heartbeat deferred to Story 1.3), (5) tsconfig.json removed unnecessary declaration:true, (6) .gitignore added duel-server/dist/, (7) File List added package-lock.json.
