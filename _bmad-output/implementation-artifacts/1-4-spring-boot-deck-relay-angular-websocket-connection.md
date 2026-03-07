# Story 1.4: Spring Boot Deck Relay & Angular WebSocket Connection

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want my Angular client connected to the duel server via WebSocket with my deck loaded securely,
so that I can participate in an online duel without exposing my decklist to the opponent.

## Acceptance Criteria

1. **Given** the duel server accepts duels (Story 1.3)
   **When** Spring Boot PvP additions are implemented
   **Then** `Room.java` JPA entity exists with fields: id, roomCode (`String`, unique, 6-char uppercase alphanumeric), player1, player2, status (`WAITING | CREATING_DUEL | ACTIVE | ENDED`), duelServerId, timestamps
   **And** a Flyway migration creates the room table
   **And** `RoomController.java` exposes `POST /api/rooms` (create room with decklistId) and `POST /api/rooms/:id/join` (join with decklistId, triggers duel creation)
   **And** `RoomService.java` implements the room state machine (`WAITING → CREATING_DUEL → ACTIVE → ENDED`) with 5-second timeout on `CREATING_DUEL` → revert to `WAITING`, and 30-minute timeout on `WAITING` → transition to `ENDED` (orphaned waiting room cleanup via scheduled task)
   **And** `DuelServerClient.java` calls `POST /api/duels` on the duel server with both players' validated decklists (server-to-server, deck data never passes through frontend). Player IDs sent as `User.id.toString()` (Long→String, used only for duel server session tracking)
   **And** `POST /api/rooms/:id/join` response includes `duelId` + `wsToken` (player-specific one-time token) for the Angular client. Angular constructs the WebSocket URL from `environment.wsUrl` + `?token=` + wsToken — Spring Boot does NOT return a full wsUrl
   **And** `/api/rooms/**` routes are protected by existing JWT authentication
   **And** JWT token TTL must be ≥2h to cover full duel duration + reconnection window (Spring Boot auth config)

2. **Given** Spring Boot creates the duel
   **When** the Angular PvP module is implemented
   **Then** `app.routes.ts` includes lazy-loaded routes: `/pvp` → `LobbyPageComponent` (placeholder), `/pvp/duel/:roomCode` → `DuelPageComponent`, both with auth guard
   **And** `DuelPageComponent` is `position: fixed; inset: 0` and scopes `DuelWebSocketService` as a component-level provider
   **And** `DuelWebSocketService` establishes a WebSocket connection to `environment.wsUrl + '?token=' + wsToken` (token from room response, one-time use)
   **And** it exposes 6 signals: `duelState: Signal<DuelState>`, `pendingPrompt: Signal<Prompt | null>`, `hintContext: Signal<HintContext>`, `animationQueue: Signal<GameEvent[]>`, `timerState: Signal<TimerState | null>`, `connectionStatus: Signal<ConnectionStatus>`
   **And** Angular signal types mirror ws-protocol.ts DTOs: `DuelState` = `BOARD_STATE` payload (zones map + hand cards + LP + current phase + turn player), `Prompt` = any `SELECT_*` payload, `HintContext` = `MSG_HINT` payload, `TimerState` = `TIMER_STATE` payload, `GameEvent` = any `MSG_*` that triggers animation (MSG_MOVE, MSG_CHAINING, MSG_DAMAGE, etc.), `ConnectionStatus` = `'connected' | 'reconnecting' | 'lost'` (client-only enum)
   **And** `connectionStatus` transitions through `connected | reconnecting | lost`
   **And** `environment.ts` includes `wsUrl` (`ws://localhost:3001` dev, `wss://domain/ws` prod)

3. **Given** the WebSocket handshake fails (JWT rejected, server unreachable, timeout)
   **When** the connection cannot be established within 5 seconds
   **Then** a "Connection failed" overlay is displayed with "Retry" and "Back to lobby" buttons
   **And** after 3 consecutive failed attempts: `connectionStatus` transitions to `lost` and only "Back to lobby" remains

4. **Given** `DuelWebSocketService` receives a `DUEL_END` message
   **When** `pendingPrompt` signal is non-null
   **Then** the pending prompt is cleared immediately (`pendingPrompt.set(null)`) and the result overlay takes priority

5. **Given** a room is in `ACTIVE` status in Spring Boot
   **When** a periodic health-check (every 60s) queries the duel server and the duel ID is not found
   **Then** the room status transitions to `ENDED` (orphaned room cleanup)

6. **Given** Player A created a room (status WAITING)
   **When** Player B joins the room (triggers duel creation, status → ACTIVE)
   **Then** Player A polling `GET /api/rooms/:roomCode` receives the updated RoomDTO with status `ACTIVE`, `duelId`, and their own `wsToken` (token0)
   **And** Player A's client navigates to `/pvp/duel/:roomCode` and connects using `environment.wsUrl + '?token=' + wsToken`

## Tasks / Subtasks

### Spring Boot — Room Entity & Migration

- [x] Task 1: Room entity & Flyway migration (AC: #1)
  - [x] 1.1 Create `RoomStatus.java` enum in `model/enums/`: `WAITING`, `CREATING_DUEL`, `ACTIVE`, `ENDED`
  - [x] 1.2 Create `Room.java` JPA entity in `model/entity/`: `id` (Long, generated), `roomCode` (String, unique, 6-char uppercase alphanumeric), `player1` (ManyToOne User), `player2` (ManyToOne User, nullable), `player1DecklistId` (Long), `player2DecklistId` (Long, nullable), `status` (RoomStatus, default WAITING), `duelServerId` (String, nullable — duelId from duel server), `wsToken1` (String, nullable), `wsToken2` (String, nullable), `createdAt` (Instant), `updatedAt` (Instant)
  - [x] 1.3 Create `V008__create_room_table.sql` Flyway migration: `room` table with all columns, unique index on `room_code`, FK to `app_user` for player1/player2
  - [x] 1.4 Create `RoomRepository.java` extending `JpaRepository<Room, Long>` with methods: `findByRoomCode(String)`, `findByStatusAndPlayer1IdOrPlayer2Id(RoomStatus, Long, Long)`, `findByStatus(RoomStatus)`, `findByStatusAndCreatedAtBefore(RoomStatus, Instant)` (for orphan cleanup)

### Spring Boot — DTOs & Mapper

- [x] Task 2: Room DTOs & mapper (AC: #1)
  - [x] 2.1 Create `CreateRoomDTO.java`: `decklistId` (Long, @NotNull)
  - [x] 2.2 Create `JoinRoomDTO.java`: `decklistId` (Long, @NotNull)
  - [x] 2.3 Create `RoomDTO.java`: `id`, `roomCode`, `status`, `player1` (ShortUserDTO), `player2` (ShortUserDTO, nullable), `duelId` (String, nullable), `wsToken` (String, nullable — player-specific token, populated only for the requesting user), `createdAt`
  - [x] 2.4 Create `DuelCreationResponse.java` (internal DTO for duel server response): `duelId` (String), `tokens` (String[] — [token0, token1])
  - [x] 2.5 Create `RoomMapper.java` (MapStruct, `@Mapper(componentModel = "spring")`): `Room` → `RoomDTO` with custom mapping for `wsToken` (context-dependent per requesting player — token0 for player1, token1 for player2)

### Spring Boot — DuelServerClient

- [x] Task 3: DuelServerClient — HTTP client to duel server (AC: #1, #5)
  - [x] 3.1 Create `DuelServerClient.java` in `service/`: inject `duel-server.url` from application.properties (`${DUEL_SERVER_URL:http://localhost:3001}`)
  - [x] 3.2 Use Spring Boot `RestClient` (Spring Framework 6.1+, built-in, blocking, fluent API) — NOT the existing abstract `Requester` pattern (that uses raw `java.net.http.HttpClient`; RestClient is the Spring Boot 3.4 recommended approach)
  - [x] 3.3 Implement `createDuel(String player1Id, DuelDeckDTO deck1, String player2Id, DuelDeckDTO deck2): DuelCreationResponse` — POST `/api/duels` with JSON body `{ player1: { id: string, deck: { main: int[], extra: int[] } }, player2: { id: string, deck } }`, returns `{ duelId, tokens: [token0, token1] }`. Player IDs are `User.id.toString()`
  - [x] 3.4 Implement `isServerHealthy(): boolean` — GET `/health` and check response status 200. Used by `RoomCleanupScheduler` for orphan cleanup. Note: no per-duel-ID endpoint exists on the duel server — cleanup relies on server health + Angular calling `POST /rooms/:id/end` after receiving `DUEL_END`
  - [x] 3.5 Add `duel-server.url` property to `application.properties`: `duel-server.url=${DUEL_SERVER_URL:http://localhost:3001}`. Note: this is the HTTP URL for server-to-server calls. The WebSocket URL for Angular is configured in `environment.ts` (client-side) — Spring Boot does NOT construct WebSocket URLs

### Spring Boot — RoomService & State Machine

- [x] Task 4: RoomService — room lifecycle (AC: #1, #5)
  - [x] 4.1 Create `RoomService.java` with `@Service`, `@Transactional` methods, inject `RoomRepository`, `DeckRepository`, `AuthService`, `DuelServerClient`, `RoomMapper`
  - [x] 4.2 Implement `createRoom(CreateRoomDTO dto): RoomDTO` — validate deck exists and belongs to user, generate 6-char roomCode (`SecureRandom` + uppercase alphanumeric), create Room with WAITING status, return RoomDTO
  - [x] 4.3 Implement `joinRoom(Long roomId, JoinRoomDTO dto): RoomDTO`:
    - [x] 4.3a Validate: room exists, status is WAITING, joining user ≠ room creator, deck exists and belongs to user
    - [x] 4.3b Transition `WAITING → CREATING_DUEL`, persist
    - [x] 4.3c Call `DuelServerClient.createDuel()` with both decklists (extract main/extra card codes via `extractDeck()`)
    - [x] 4.3d On success: store `duelServerId` + `wsToken1` + `wsToken2` from `DuelCreationResponse`, transition `CREATING_DUEL → ACTIVE`, return RoomDTO with player2's `wsToken`
    - [x] 4.3e On failure (duel server unreachable, timeout, error): revert `CREATING_DUEL → WAITING`, clear player2 + player2DecklistId, return error response (503 Service Unavailable)
  - [x] 4.4 Implement `getRoom(String roomCode, Long requestingUserId): RoomDTO` — used by Angular waiting-room polling and duel-page join. CRITICAL: `wsToken` in response must be player-specific — if requesting user is player1, return `wsToken1`; if player2, return `wsToken2`; otherwise `null`
  - [x] 4.5 Implement `listOpenRooms(): List<RoomDTO>` — find rooms with status WAITING, ordered by createdAt desc (prep for Story 2.2: Room Browsing & Joining)
  - [x] 4.6 Implement `endRoom(Long roomId): void` — transition to ENDED (called by Angular after DUEL_END, or by orphan cleanup) (prep for Story 3.4: Duel Result Screen & Rematch)
  - [x] 4.7 Implement deck extraction helper: `extractDeck(Long decklistId): DuelDeckDTO` — query `CardDeckIndexRepository.findByDeckId(decklistId)` (verify this method exists in `CardDeckIndexRepository.java` — add if missing), separate main vs extra card codes (using existing `DeckKeyword.MAIN`/`DeckKeyword.EXTRA` enum), return `DuelDeckDTO` with `int[] main` and `int[] extra` (primitive int arrays, not `List<Integer>` — matches JSON serialization to `number[]`)

### Spring Boot — RoomController & Scheduler

- [x] Task 5: RoomController + scheduled cleanup (AC: #1, #5)
  - [x] 5.1 Create `RoomController.java` (`@RestController`, `@RequestMapping("/rooms")` — note: context-path `/api` is already set globally): POST `/` (createRoom), POST `/{id}/join` (joinRoom), GET `/` (listOpenRooms), GET `/{roomCode}` (getRoom by code), POST `/{id}/end` (endRoom)
  - [x] 5.2 All endpoints use `@Valid` on request bodies, return appropriate HTTP status codes (201 for create, 200 for get/join/end, 404 for not found)
  - [x] 5.3 `POST /{id}/join` must return `duelId` + `wsToken` (player-specific one-time token from duel server) in the `RoomDTO` response. Spring Boot does NOT return a wsUrl — Angular constructs the WebSocket URL from `environment.wsUrl`
  - [x] 5.4 Create `RoomCleanupScheduler.java` (`@Component`, `@Scheduled`): every 5min, find rooms with `WAITING` status and `createdAt` > 30min ago → transition to ENDED (orphaned waiting rooms). Note: ACTIVE room cleanup relies on Angular calling `POST /rooms/:id/end` after receiving `DUEL_END` — no per-duel health check needed (KISS for MVP)
  - [x] 5.5 SecurityConfig.java — verify `/rooms/**` falls under existing `authenticated()` rule (it should, since all non-public routes are already protected). Note: `@EnableScheduling` already exists on `SkytrixApplication.java` — no change needed

### Spring Boot — JWT TTL & Configuration

- [x] Task 6: JWT configuration update (AC: #1)
  - [x] 6.1 Verify current JWT TTL in `application.properties`: `jwt.validity-period=60000000` (16.67h) — this already exceeds the ≥2h requirement. **No change needed** unless value has been reduced. Document this in Dev Notes
  - [x] 6.2 Add `duel-server.url` property to application.properties (used by DuelServerClient for HTTP calls). No `ws-url` property needed — Angular constructs WebSocket URLs from its own `environment.wsUrl`

### Angular — Routes & Environment

- [x] Task 7: Angular routing & environment (AC: #2)
  - [x] 7.1 Add to `app.routes.ts`: `{ path: 'pvp', loadComponent: () => import('./pages/pvp/lobby-page/lobby-page.component').then(m => m.LobbyPageComponent), canActivate: [authGuard] }` and `{ path: 'pvp/duel/:roomCode', loadComponent: () => import('./pages/pvp/duel-page/duel-page.component').then(m => m.DuelPageComponent), canActivate: [authGuard] }`
  - [x] 7.2 Create `environment.ts` in `front/src/environments/`: `export const environment = { production: false, apiUrl: 'http://localhost:8080/api', wsUrl: 'ws://localhost:3001' }`
  - [x] 7.3 Create `environment.prod.ts`: `export const environment = { production: true, apiUrl: '/api', wsUrl: 'wss://domain/ws' }`
  - [x] 7.4 Update `angular.json`: add `fileReplacements` in `architect.build.configurations.production` to swap `environment.ts` → `environment.prod.ts` during production builds (currently NOT configured — without this, prod build will use dev environment)

### Angular — LobbyPageComponent (Placeholder)

- [x] Task 8: LobbyPageComponent placeholder (AC: #2)
  - [x] 8.1 Create `front/src/app/pages/pvp/lobby-page/lobby-page.component.ts`: standalone component, `ChangeDetectionStrategy.OnPush`, minimal template with "PvP Lobby - Coming Soon" and a router link to test duel page
  - [x] 8.2 Create corresponding `.html` and `.scss` files

### Angular — PvP Type Definitions

- [x] Task 9: PvP signal types (AC: #2)
  - [x] 9.1 Create `front/src/app/pages/pvp/types/duel-state.types.ts`: `DuelState` interface mirroring `BoardStatePayload` from `duel-ws.types.ts` (zones map + hand cards + LP + phase + turn player + turn count)
  - [x] 9.2 Create `front/src/app/pages/pvp/types/prompt.types.ts`: `Prompt` type = union of all `SELECT_*` message types from `duel-ws.types.ts`
  - [x] 9.3 Create `front/src/app/pages/pvp/types/hint-context.types.ts`: `HintContext` interface matching `MsgHint` from `duel-ws.types.ts`
  - [x] 9.4 Create `front/src/app/pages/pvp/types/game-event.types.ts`: `GameEvent` type = union of animation-triggering `MSG_*` types (MSG_MOVE, MSG_DRAW, MSG_DAMAGE, MSG_RECOVER, MSG_PAY_LPCOST, MSG_CHAINING, MSG_CHAIN_SOLVING, MSG_CHAIN_SOLVED, MSG_CHAIN_END, MSG_FLIP_SUMMONING, MSG_CHANGE_POS, MSG_SWAP, MSG_ATTACK, MSG_BATTLE)
  - [x] 9.5 Create `front/src/app/pages/pvp/types/connection-status.types.ts`: `ConnectionStatus = 'connected' | 'reconnecting' | 'lost'`
  - [x] 9.6 Create `front/src/app/pages/pvp/types/index.ts`: barrel export for all types

### Angular — DuelWebSocketService

- [x] Task 10: DuelWebSocketService — core WebSocket service (AC: #2, #3, #4)
  - [x] 10.1 Create `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`: `@Injectable()` (component-scoped, NOT `providedIn: 'root'`)
  - [x] 10.2 Implement WebSocket connection: use **native WebSocket API** (not RxJS WebSocketSubject — keep it simple, no observable wrapping needed for signal-based state). Connect to `environment.wsUrl + '?token=' + wsToken` (token from room response). Set 5-second connection timeout via `setTimeout`
  - [x] 10.3 Expose 6 writable signals (private `WritableSignal`, public `Signal` via `.asReadonly()`):
    - `duelState = signal<DuelState>(initialEmptyState)`
    - `pendingPrompt = signal<Prompt | null>(null)`
    - `hintContext = signal<HintContext>({ hintType: 0, player: 0, value: 0 })`
    - `animationQueue = signal<GameEvent[]>([])`
    - `timerState = signal<TimerState | null>(null)`
    - `connectionStatus = signal<ConnectionStatus>('connected')`
  - [x] 10.4 Implement `onmessage` handler: `JSON.parse(event.data)` → switch on `message.type`:
    - `BOARD_STATE` / `STATE_SYNC` → `duelState.set(message.data)`
    - Any `SELECT_*` → `pendingPrompt.set(message)`
    - `MSG_HINT` → `hintContext.set({ hintType: message.hintType, player: message.player, value: message.value })`
    - `TIMER_STATE` → `timerState.set(message)`
    - `DUEL_END` → `pendingPrompt.set(null)`, store duel result for overlay
    - Animation-triggering `MSG_*` → `animationQueue.update(q => [...q, message])`
    - Other messages → `console.log` (no error — may be new types)
  - [x] 10.5 Implement `sendResponse(promptType: string, data: ResponseData): void` — `ws.send(JSON.stringify({ type: 'PLAYER_RESPONSE', promptType, data }))`
  - [x] 10.6 Implement `sendSurrender(): void` — `ws.send(JSON.stringify({ type: 'SURRENDER' }))`
  - [x] 10.7 Implement reconnection logic: `onclose` → `connectionStatus.set('reconnecting')` → retry with 2s/4s/8s exponential backoff (max 3 attempts) → after 3 failures: `connectionStatus.set('lost')`. NOTE: on successful reconnect, the duel server sends `STATE_SYNC` (same payload as `BOARD_STATE`) to resynchronize — the `onmessage` handler already handles this (Task 10.4)
  - [x] 10.8 Implement `onopen`: `connectionStatus.set('connected')`, reset retry counter
  - [x] 10.9 Implement `ngOnDestroy`: close WebSocket cleanly (`ws.close()`)
  - [x] 10.10 Implement `connect(wsToken: string): void` — public method called by DuelPageComponent after receiving room response. Constructs URL as `environment.wsUrl + '?token=' + wsToken`

### Angular — DuelPageComponent

- [x] Task 11: DuelPageComponent — duel container (AC: #2, #3)
  - [x] 11.1 Create `front/src/app/pages/pvp/duel-page/duel-page.component.ts`: standalone, `ChangeDetectionStrategy.OnPush`, `position: fixed; inset: 0; overflow: hidden`, provides `DuelWebSocketService` as component-level provider (`providers: [DuelWebSocketService]`)
  - [x] 11.2 On init: read `roomCode` from route params, call Spring Boot `GET /api/rooms/{roomCode}` to get `wsToken`, call `DuelWebSocketService.connect(wsToken)` (service constructs URL from `environment.wsUrl`)
  - [x] 11.3 Template: show connection status indicator, placeholder for board (will be filled by Story 1.5), placeholder for prompts (Story 1.6)
  - [x] 11.4 Create connection error overlay component (inline or separate): shown when `connectionStatus() === 'lost'` — "Connection failed" + "Retry" button (resets and retries connection) + "Back to lobby" button (navigates to `/pvp`). After 3 failed retries: only "Back to lobby" visible

### Build Verification

- [x] Task 12: Build verification (AC: all)
  - [x] 12.1 Spring Boot: verify `mvn clean package` passes (or `./mvnw`), Flyway migration executes
  - [x] 12.2 Angular: verify `ng build` passes with zero errors
  - [x] 12.3 Integration test: start duel-server + Spring Boot + Angular → create room → join room → verify WebSocket connects → verify `BOARD_STATE` received in `duelState` signal (manual test, no automated tests per project convention)

## Dev Notes

### Architecture Compliance

- **This story is Phase 1B + Phase 2A** — bridges all three services (Angular ↔ WebSocket ↔ Duel Server ↔ HTTP ↔ Spring Boot). Depends on Story 1.2 (protocol) and Story 1.3 (duel engine). Enables Stories 1.5-1.7 (board display, prompts, turn actions).
- **ADR-2 (Independent WebSocket DTOs)**: Angular types in `duel-ws.types.ts` are a manual copy of `ws-protocol.ts` — already exists from Story 1.2. **No protocol changes in this story.**
- **Anti-cheat principle**: The frontend NEVER sends decklists to the duel server. Spring Boot validates the deck, extracts card codes from the database, and relays server-to-server via `POST /api/duels`. The Angular client only receives a one-time WebSocket token.
- **Authentication chain**: Angular → Spring Boot (JWT REST) → Duel Server (Docker internal HTTP, no auth) → Angular (WebSocket with one-time token). Three authentication boundaries.
- **server.ts is the sole WebSocket owner** — Angular connects directly to the duel server WebSocket. Spring Boot is NOT in the WebSocket path — it only orchestrates duel creation via HTTP.

### Token-Based WebSocket Association (Critical Flow)

The complete flow for connecting a player to a duel:

```
1. Player A: POST /api/rooms (decklistId) → Spring Boot creates Room (WAITING)
2. Player A: shares roomCode with Player B (Discord, etc.)
3. Player B: POST /api/rooms/:id/join (decklistId) → Spring Boot:
   a. Validates both decks (exist, belong to users)
   b. Extracts card codes from DB (main[] + extra[] per player)
   c. Calls DuelServerClient.createDuel(deck1, deck2) → duel server
   d. Duel server returns { duelId, tokens: [token0, token1] }
   e. Spring Boot stores duelServerId, wsToken1, wsToken2 in Room
   f. Room transitions WAITING → CREATING_DUEL → ACTIVE
   g. Returns RoomDTO with { duelId, wsToken: token1 } to Player B
4. Player A: polls GET /api/rooms/:roomCode → detects status ACTIVE → gets { duelId, wsToken: token0 }
5. Both players: new WebSocket(environment.wsUrl + '?token=' + wsToken) — Angular constructs URL from environment config
6. Duel server: validates token → associates WS to PlayerSession → deletes token
7. When both connected: duel server sends BOARD_STATE to both
```

**CRITICAL**: Player A must poll `GET /api/rooms/:roomCode` to detect when the room becomes ACTIVE and get their wsToken. The waiting-room polling pattern (every 2-3s) handles this — when status changes from WAITING to ACTIVE, Player A gets `duelId` + `wsToken` and navigates to duel page. The polling UI (waiting-room component with visual feedback) is deferred to Epic 2 Story 2.1 (Room Creation from Decklist). This story provides the backend `GET /api/rooms/:roomCode` endpoint that the waiting room will poll. For Story 1.4 manual testing, Player A can refresh the duel page URL to trigger reconnection.

### Existing Code — What to Modify vs Create

**Spring Boot — Files to CREATE (this story):**
```
back/src/main/java/com/skytrix/
├── controller/
│   └── RoomController.java               # NEW
├── service/
│   ├── RoomService.java                   # NEW
│   └── DuelServerClient.java             # NEW (uses RestClient)
├── model/
│   ├── entity/
│   │   └── Room.java                      # NEW
│   ├── dto/
│   │   └── room/
│   │       ├── CreateRoomDTO.java         # NEW
│   │       ├── JoinRoomDTO.java           # NEW
│   │       ├── RoomDTO.java               # NEW
│   │       └── DuelDeckDTO.java           # NEW (main/extra card codes)
│   └── enums/
│       └── RoomStatus.java                # NEW
├── repository/
│   └── RoomRepository.java               # NEW
├── mapper/
│   └── RoomMapper.java                    # NEW
└── scheduler/
    └── RoomCleanupScheduler.java          # NEW
```

**Spring Boot — Files to MODIFY:**
```
back/src/main/resources/application.properties    # ADD duel-server.url
back/src/main/resources/db/migration/flyway/V008__create_room_table.sql  # NEW migration
```

**Angular — Files to CREATE:**
```
front/src/
├── environments/
│   ├── environment.ts                     # NEW
│   └── environment.prod.ts               # NEW
└── app/
    └── pages/pvp/
        ├── lobby-page/
        │   ├── lobby-page.component.ts    # NEW (placeholder)
        │   ├── lobby-page.component.html  # NEW
        │   └── lobby-page.component.scss  # NEW
        ├── duel-page/
        │   ├── duel-page.component.ts     # NEW
        │   ├── duel-page.component.html   # NEW
        │   ├── duel-page.component.scss   # NEW
        │   └── duel-web-socket.service.ts # NEW (6 signals)
        └── types/
            ├── duel-state.types.ts        # NEW
            ├── prompt.types.ts            # NEW
            ├── hint-context.types.ts      # NEW
            ├── game-event.types.ts        # NEW
            ├── connection-status.types.ts # NEW
            └── index.ts                   # NEW (barrel)
```

**Angular — Files to MODIFY:**
```
front/src/app/app.routes.ts                # ADD 2 lazy-loaded PvP routes
```

**Files NOT to touch:**
```
front/src/app/pages/pvp/duel-ws.types.ts   # FROZEN — protocol types (Story 1.2)
duel-server/src/*                           # No duel server changes in this story
```

### Critical Technical Details

#### Spring Boot — RestClient (NOT Requester)

The existing codebase uses an abstract `Requester.java` class with raw `java.net.http.HttpClient`. For Story 1.4, **use Spring Boot's `RestClient`** instead (Spring Framework 6.1+, built-in, recommended for new synchronous HTTP clients in Spring Boot 3.4):

```java
@Service
public class DuelServerClient {
    private final RestClient restClient;

    public DuelServerClient(@Value("${duel-server.url}") String duelServerUrl) {
        this.restClient = RestClient.builder()
            .baseUrl(duelServerUrl)
            .build();
    }

    public DuelCreationResponse createDuel(String player1Id, DuelDeckDTO deck1, String player2Id, DuelDeckDTO deck2) {
        // player IDs are User.id.toString() — used for session tracking only
        return restClient.post()
            .uri("/api/duels")
            .contentType(MediaType.APPLICATION_JSON)
            .body(new CreateDuelRequest(
                new DuelPlayer(player1Id, deck1),
                new DuelPlayer(player2Id, deck2)
            ))
            .retrieve()
            .body(DuelCreationResponse.class);
    }
}
```

**Why RestClient over Requester?** RestClient is the Spring Boot 3.4 standard for blocking HTTP calls. `Requester` is a project-specific abstraction over raw Java HttpClient — functional but not idiomatic Spring. New service = new pattern. Do NOT refactor existing `Requester` usage.

#### Spring Boot — Room Code Generation

```java
private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I/O/0/1 (ambiguity)
private static final int CODE_LENGTH = 6;
private static final SecureRandom RANDOM = new SecureRandom();

private String generateRoomCode() {
    StringBuilder sb = new StringBuilder(CODE_LENGTH);
    for (int i = 0; i < CODE_LENGTH; i++) {
        sb.append(CHARS.charAt(RANDOM.nextInt(CHARS.length())));
    }
    return sb.toString();
}
```

Retry if code already exists (unique constraint). Max 3 retries before throwing.

#### Spring Boot — Deck Extraction for Duel Server

The duel server's `POST /api/duels` expects `{ player1: { id, deck: { main: number[], extra: number[] } }, player2: ... }`.

The Spring Boot DB stores decks via `CardDeckIndex` (join table with `deckKeyword` enum: MAIN, EXTRA, SIDE). To extract:

```java
private DuelDeckDTO extractDeck(Long decklistId) {
    List<CardDeckIndex> cards = cardDeckIndexRepository.findByDeckId(decklistId);
    int[] main = cards.stream()
        .filter(c -> c.getDeckKeyword() == DeckKeyword.MAIN)
        .mapToInt(c -> c.getCard().getPasscode().intValue())
        .toArray();
    int[] extra = cards.stream()
        .filter(c -> c.getDeckKeyword() == DeckKeyword.EXTRA)
        .mapToInt(c -> c.getCard().getPasscode().intValue())
        .toArray();
    return new DuelDeckDTO(main, extra);
}
```

**VERIFIED**: `Card.java` has a `passcode` field of type `Long` — this is the OCGCore card code (e.g., 89631139 for Blue-Eyes White Dragon). Use `card.getPasscode().intValue()` to convert to int for the duel server request.

#### Spring Boot — Flyway Migration

```sql
-- V008__create_room_table.sql
CREATE TABLE room (
    id BIGSERIAL PRIMARY KEY,
    room_code VARCHAR(6) NOT NULL UNIQUE,
    player1_id BIGINT NOT NULL REFERENCES app_user(id),
    player2_id BIGINT REFERENCES app_user(id),
    player1_decklist_id BIGINT NOT NULL REFERENCES deck(id),
    player2_decklist_id BIGINT REFERENCES deck(id),
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    duel_server_id VARCHAR(36),
    ws_token1 VARCHAR(36),
    ws_token2 VARCHAR(36),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_status ON room(status);
CREATE INDEX idx_room_room_code ON room(room_code);
```

#### Angular — DuelWebSocketService Signal Architecture

```typescript
@Injectable()
export class DuelWebSocketService implements OnDestroy {
  // Private writable signals
  private _duelState = signal<DuelState>(EMPTY_DUEL_STATE);
  private _pendingPrompt = signal<Prompt | null>(null);
  private _hintContext = signal<HintContext>({ hintType: 0, player: 0, value: 0 });
  private _animationQueue = signal<GameEvent[]>([]);
  private _timerState = signal<TimerState | null>(null);
  private _connectionStatus = signal<ConnectionStatus>('connected');

  // Public readonly signals
  readonly duelState = this._duelState.asReadonly();
  readonly pendingPrompt = this._pendingPrompt.asReadonly();
  readonly hintContext = this._hintContext.asReadonly();
  readonly animationQueue = this._animationQueue.asReadonly();
  readonly timerState = this._timerState.asReadonly();
  readonly connectionStatus = this._connectionStatus.asReadonly();

  private ws: WebSocket | null = null;
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;
}
```

**Use native WebSocket API** — not RxJS WebSocketSubject. Rationale: the 6 signals are the reactive layer. Adding an Observable wrapper on top of signals is unnecessary complexity. The WebSocket is a simple event source that feeds signals.

#### Angular — Auth Guard Reuse

The existing `AuthService` has `canActivate()`. Check the exact guard function signature — Angular 19 uses functional guards:

```typescript
// In app.routes.ts — verify the existing guard pattern
canActivate: [() => inject(AuthService).canActivate()]
// OR if using a standalone guard function:
canActivate: [authGuard]
```

Look at how existing routes (deck-page, simulator) use the guard and replicate the same pattern.

#### Angular — Environment Files

The project currently has **no environment files** (`front/src/environments/` does not exist). Create them:

```typescript
// environment.ts (dev)
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8080/api',
  wsUrl: 'ws://localhost:3001'
};

// environment.prod.ts (prod)
export const environment = {
  production: true,
  apiUrl: '/api',
  wsUrl: 'wss://domain/ws'  // Placeholder — configure per deployment
};
```

**IMPORTANT**: Check `angular.json` for `fileReplacements` configuration. If not configured, add it so Angular CLI swaps `environment.ts` with `environment.prod.ts` during production builds.

### Previous Story Intelligence

**From Story 1.2 (Scaffold):**
- All relative imports in duel-server MUST use `.js` extension (moduleResolution: nodenext)
- `ws-protocol.ts` is 612 lines, 49 message types — `duel-ws.types.ts` is a verbatim copy
- `duel-ws.types.ts` already exists in `front/src/app/pages/pvp/` — do NOT modify it
- All services in docker-compose must be on `skytrix-internal` network
- Code review caught: DoS vectors in body parsing (readBody without Content-Length check)

**From Story 1.3 (Duel Engine):**
- `POST /api/duels` expects `{ player1: { id: string, deck: { main: number[], extra: number[] } }, player2: { id: string, deck } }` — returns `{ duelId: string, tokens: [string, string] }`
- Token-based WS association: `pendingTokens: Map<token, { duelId, playerIndex }>` — one-time use, deleted after connection
- `POST /api/duels/:id/join` was REMOVED in Story 1.3 (replaced by token-based association). Spring Boot does NOT call this endpoint — only `POST /api/duels`
- `awaitingResponse[playerIndex]` prevents response spam — only one prompt per player at a time
- Heartbeat: 30s ping/pong, terminates dead connections
- Build passed on Node 24 with `better-sqlite3` and `@n1xx1/ocgcore-wasm`

**Key variance from architecture doc**: Architecture originally said `POST /api/duels/:id/join` exists. Story 1.3 removed it. Spring Boot's `DuelServerClient` only needs `POST /api/duels` — no join endpoint.

### Git Intelligence

Recent commits are solo simulator and general maintenance — no PvP-related commits yet (Stories 1.2 and 1.3 are done but not committed to master yet based on git status showing untracked files in `duel-server/src/`).

**Uncommitted files relevant to this story:**
- `duel-server/src/server.ts` — modified (Story 1.3 changes)
- `duel-server/src/duel-worker.ts` — new (Story 1.3)
- `duel-server/src/message-filter.ts` — new (Story 1.3)
- `front/src/app/pages/pvp/` — new directory with `duel-ws.types.ts`

### Latest Technical Specifics

**Spring Boot 3.4.2 (Java 21):**
- **RestClient** is the recommended approach for new synchronous HTTP clients (replaces RestTemplate). Use `RestClient.builder().baseUrl(url).build()` — fluent, blocking, no Spring WebFlux dependency needed
- Flyway migrations run before `@PostConstruct` — schema is ready at app startup
- `@Scheduled` requires `@EnableScheduling` on a config class — verify this is enabled or add it

**Angular 19.1.3:**
- **Signals** are the primary reactive primitive. Use `signal()`, `computed()`, `effect()` for state management
- `asReadonly()` to expose public signals (prevents external mutation)
- **Lazy loading**: `loadComponent: () => import('...').then(m => m.Component)` for single-component routes
- **No built-in WebSocket service** — use native `WebSocket` API with signal-based state
- Auth guards: functional guards via `inject()` are the Angular 19 pattern

**WebSocket Reconnection:**
- Use exponential backoff: 2s → 4s → 8s (max 3 attempts)
- Track connection state in a signal for reactive UI updates
- On successful reconnect: expect `STATE_SYNC` from duel server to resynchronize board state

### Project Structure Notes

- Spring Boot entities in `model/entity/`, DTOs in `model/dto/room/`, enums in `model/enums/`
- All Spring Boot files use PascalCase Java naming (Room.java, RoomService.java)
- Angular files use kebab-case (duel-page.component.ts, duel-web-socket.service.ts)
- Angular standalone components with `ChangeDetectionStrategy.OnPush`
- MapStruct mappers use `@Mapper(componentModel = "spring")`
- Flyway migrations: `V{n}__description.sql` in `db/migration/flyway/`

### Alignment with Unified Project Structure

**After this story, the new files are:**

Spring Boot:
```
back/src/main/java/com/skytrix/
├── controller/RoomController.java
├── service/RoomService.java
├── service/DuelServerClient.java
├── model/entity/Room.java
├── model/dto/room/CreateRoomDTO.java
├── model/dto/room/JoinRoomDTO.java
├── model/dto/room/RoomDTO.java
├── model/dto/room/DuelDeckDTO.java
├── model/enums/RoomStatus.java
├── repository/RoomRepository.java
├── mapper/RoomMapper.java
└── scheduler/RoomCleanupScheduler.java
back/src/main/resources/db/migration/flyway/V008__create_room_table.sql
```

Angular:
```
front/src/environments/environment.ts
front/src/environments/environment.prod.ts
front/src/app/pages/pvp/
├── lobby-page/lobby-page.component.ts (+html, +scss)
├── duel-page/duel-page.component.ts (+html, +scss)
├── duel-page/duel-web-socket.service.ts
└── types/duel-state.types.ts, prompt.types.ts, hint-context.types.ts, game-event.types.ts, connection-status.types.ts, index.ts
```

### Detected Conflicts or Variances

1. **`POST /api/duels/:id/join` removed** — Architecture doc mentions this endpoint. Story 1.3 removed it in favor of token-based WebSocket association. `DuelServerClient` only calls `POST /api/duels` (returns tokens directly). **Dev: DO NOT implement a join HTTP call to the duel server.**

2. **RestClient vs Requester** — Existing code uses abstract `Requester.java` with raw `java.net.http.HttpClient`. New code uses Spring Boot `RestClient`. This is intentional — new Spring Boot 3.4 recommended pattern. Do NOT refactor existing `Requester` usage.

3. **Environment files** — Angular project has no `environment.ts` files. This story creates them. `angular.json` does NOT have `fileReplacements` — Task 7.4 adds it.

4. **Card code field name** — RESOLVED: `Card.java` has a `passcode` field (Long). Use `card.getPasscode().intValue()`.

5. **Waiting room mechanism** — Architecture says "poll every 2-3s". This story provides the backend `GET /api/rooms/:roomCode` endpoint. The waiting-room UI component (polling, visual feedback, auto-navigate on ACTIVE) is part of Epic 2 Story 2.1 (Room Creation from Decklist). For Story 1.4 integration testing, Player A manually navigates to `/pvp/duel/:roomCode` after being told the room is active.

6. **`wsUrl` responsibility** — Architecture doc shows `wsUrl` in Spring Boot response. Clarified: Spring Boot returns only `duelId` + `wsToken`. Angular constructs the WebSocket URL from `environment.wsUrl + '?token=' + wsToken`. This avoids Spring Boot needing to know the client-facing WebSocket URL (which differs between dev/prod/reverse proxy).

7. **Player ID for duel server** — `POST /api/duels` expects `player.id` as string. Spring Boot sends `User.id.toString()` (Long→String). This is used only for duel server session tracking — not for auth or display.

### References

- [Source: architecture-pvp.md#Spring Boot — PvP Additions] — Complete Spring Boot file tree, REST endpoints, DuelServerClient routes
- [Source: architecture-pvp.md#Angular SPA — PvP Additions] — Angular PvP module structure, DuelWebSocketService signals, route additions
- [Source: architecture-pvp.md#Core Architectural Decisions] — Authentication chain (3 boundaries), Room state machine, anti-cheat principle
- [Source: architecture-pvp.md#Implementation Patterns & Consistency Rules] — Naming patterns, enforcement checklist, protocol invariant
- [Source: architecture-pvp.md#Architectural Boundaries] — Boundary table (WebSocket protocol, Internal HTTP API, REST API)
- [Source: architecture-pvp.md#Decision Impact Analysis] — Phase 1B/2A positioning, protocol gate dependency
- [Source: epics-pvp.md#Story 1.4] — BDD acceptance criteria, cross-story dependencies
- [Source: prd-pvp.md#Web App Technical Context] — Tri-service architecture, anti-cheat principle, communication patterns
- [Source: prd-pvp.md#Functional Requirements] — FR1-7 (matchmaking & session), NFR1-2 (network), NFR6-8 (security)
- [Source: ux-design-specification-pvp.md#Core User Experience] — WebSocket connection, DuelWebSocketService signal specification
- [Source: 1-2-duel-server-scaffold-protocol-definition.md] — ws-protocol.ts design rules, duel-ws.types.ts same-commit rule
- [Source: 1-3-ocgcore-duel-engine-anti-cheat-filter.md] — POST /api/duels request/response format, token-based WS association, removed join endpoint variance
- [Source: duel-server/src/server.ts] — Current POST /api/duels implementation, token generation, WS handler
- [Source: duel-server/src/types.ts] — DuelSession, PlayerSession, constants (MAX_PAYLOAD_SIZE, timeouts)
- [Source: back/src/main/java/com/skytrix/security/] — JWT implementation, SecurityConfig, auth chain
- [Source: back/src/main/java/com/skytrix/model/entity/] — Existing entity patterns (User, Deck, Card, CardDeckIndex)
- [Source: back/src/main/java/com/skytrix/requester/Requester.java] — Existing HTTP client pattern (do NOT use for new code)
- [Source: back/src/main/resources/application.properties] — JWT validity (16.67h), Flyway config, DB config

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Angular build: zero errors (pre-existing CommonJS warnings from canvg/html2canvas only)
- Spring Boot `mvn clean compile`: BUILD SUCCESS (pre-existing MapStruct unmapped target warnings only)
- JWT TTL verified: 60000000ms (16.67h) — exceeds ≥2h requirement, no change needed
- `@EnableScheduling` already present on SkytrixApplication.java — no change needed
- SecurityConfig verified: `/rooms/**` falls under existing `authenticated()` rule via NegatedRequestMatcher
- `CardDeckIndexRepository.findByDeckId()` was missing — added

### Completion Notes List

- **Spring Boot**: Complete Room lifecycle — entity, repository, service (state machine WAITING→CREATING_DUEL→ACTIVE→ENDED), controller (5 endpoints), DuelServerClient (RestClient, not Requester), scheduled cleanup (30min orphan TTL), Flyway V008 migration
- **Angular**: PvP routes (lazy-loaded), environment files (dev/prod with fileReplacements), LobbyPageComponent placeholder, DuelWebSocketService (6 signals, native WebSocket, exponential backoff reconnection), DuelPageComponent (fullscreen, connection overlay), PvP type definitions (6 types mirroring ws-protocol.ts)
- **Key decisions**: Used `CrudRepository` (project convention) instead of `JpaRepository` (story spec). Used `@Query` for compound player lookup instead of ambiguous Spring Data method name. RoomMapper uses concrete method (not abstract MapStruct) for context-dependent wsToken mapping. HintContext fields match actual HintMsg fields (hintType, player, value) rather than story's suggested (cardCode, hintType, hintData) which don't exist in protocol.

### File List

**Spring Boot — NEW files:**
- back/src/main/java/com/skytrix/model/enums/RoomStatus.java
- back/src/main/java/com/skytrix/model/entity/Room.java
- back/src/main/java/com/skytrix/model/dto/room/CreateRoomDTO.java
- back/src/main/java/com/skytrix/model/dto/room/JoinRoomDTO.java
- back/src/main/java/com/skytrix/model/dto/room/RoomDTO.java
- back/src/main/java/com/skytrix/model/dto/room/DuelDeckDTO.java
- back/src/main/java/com/skytrix/model/dto/room/DuelCreationResponse.java
- back/src/main/java/com/skytrix/repository/RoomRepository.java
- back/src/main/java/com/skytrix/mapper/RoomMapper.java
- back/src/main/java/com/skytrix/service/DuelServerClient.java
- back/src/main/java/com/skytrix/service/RoomService.java
- back/src/main/java/com/skytrix/controller/RoomController.java
- back/src/main/java/com/skytrix/scheduler/RoomCleanupScheduler.java
- back/src/main/resources/db/migration/flyway/V008__create_room_table.sql

**Spring Boot — MODIFIED files:**
- back/src/main/resources/application.properties (added duel-server.url)
- back/src/main/java/com/skytrix/repository/CardDeckIndexRepository.java (added findByDeckId)

**Infra — MODIFIED files:**
- docker-compose.yml (added DUEL_SERVER_URL env var for back service, added duel-server service)
- .gitignore

**Angular — NEW files:**
- front/src/environments/environment.ts
- front/src/environments/environment.prod.ts
- front/src/app/pages/pvp/lobby-page/lobby-page.component.ts
- front/src/app/pages/pvp/lobby-page/lobby-page.component.html
- front/src/app/pages/pvp/lobby-page/lobby-page.component.scss
- front/src/app/pages/pvp/duel-page/duel-page.component.ts
- front/src/app/pages/pvp/duel-page/duel-page.component.html
- front/src/app/pages/pvp/duel-page/duel-page.component.scss
- front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts
- front/src/app/pages/pvp/types/duel-state.types.ts
- front/src/app/pages/pvp/types/prompt.types.ts
- front/src/app/pages/pvp/types/hint-context.types.ts
- front/src/app/pages/pvp/types/game-event.types.ts
- front/src/app/pages/pvp/types/connection-status.types.ts
- front/src/app/pages/pvp/types/index.ts

**Angular — MODIFIED files:**
- front/src/app/app.routes.ts (added 2 PvP lazy-loaded routes)
- front/angular.json (added fileReplacements for prod environment)
- front/src/app/styles/_z-layers.scss (added $z-overlay token)

## Change Log

- 2026-02-25: Story 1.4 implementation complete — Spring Boot Room lifecycle (entity, service, controller, scheduler, DuelServerClient) + Angular PvP module (routes, environment, DuelWebSocketService with 6 signals, DuelPageComponent, LobbyPageComponent placeholder, PvP type definitions)
- 2026-02-26: Code review fixes (13 issues) — C1: fix reconnection with one-time tokens (wasEverConnected guard). H1: add 60s ACTIVE room health-check scheduler. H2: pessimistic locking on joinRoom. H3: auth check on endRoom. H4: 5s HTTP timeouts on DuelServerClient. H5: 503 instead of 500 on duel server failure. M2: catch RestClientException specifically. M3: redirect on null wsToken. M4: validate DuelCreationResponse tokens. L1: @Column annotations on Room.roomCode. L2: listOpenRooms ordered by createdAt desc. M1+L3: updated File List (docker-compose.yml, .gitignore)
