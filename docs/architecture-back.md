# Architecture — Backend (Spring Boot)

> Java 21 / Spring Boot 3.4.2 REST API. Stateless JWT auth. PostgreSQL persistence via JPA + Flyway. MapStruct for DTO mapping. Internal HTTP client into the duel-server.

## Executive summary

The backend is a **layered Spring Boot application** that owns:
- All persistent state (users, decks, cards, rooms, replays).
- All authentication (HTTP Basic at login, JWT cookies thereafter).
- The card data ingest pipeline from ygoprodeck.com.
- Image storage and serving from a mounted volume.
- Server-Sent Events for live room state.
- The bridge between the user-facing Angular SPA and the duel-server (HTTP, X-Internal-Key authed).

It does **not** own gameplay state — duels run in the duel-server. The backend only creates them, persists their replays, and reconciles room status via a scheduler.

## Technology stack

| Layer | Technology | Notes |
|---|---|---|
| Language | Java 21 | records, pattern matching, sealed classes allowed |
| Framework | Spring Boot 3.4.2 | starters: web, data-jpa, security, validation, actuator |
| Build | Maven (with `mvnw` wrapper) | |
| ORM | Spring Data JPA / Hibernate | PostgreSQL dialect |
| DB driver | postgresql 42.7.5 | port 5433 in dev, 5432 in Docker |
| Migrations | Flyway 11.2.0 | `out-of-order` enabled |
| Auth | Spring Security + JJWT 0.12.6 | stateless, cookie-based |
| DI | `@Inject` (Jakarta) | **never** `@Autowired` |
| DTO mapping | MapStruct 1.5.5 | `componentModel = "spring"`, `@AfterMapping` for complex logic |
| Boilerplate | Lombok 1.18.36 | `@Data`, `@Getter`, `@Setter`, ... |
| Testing | Spring Boot Starter Test | JUnit 5 + Mockito |

## Architecture pattern — Layered

```
HTTP request
    │
    ▼
┌──────────────┐  @RestController + @RequestMapping("/resource")
│  Controller  │  validates DTO via Jakarta @Valid, returns DTO/wrappers
└──────┬───────┘
       │
       ▼
┌──────────────┐  @Service, @Transactional on mutations
│   Service    │  business logic, calls into requesters / DuelServerClient
└──────┬───────┘
       │
       ▼
┌──────────────┐  Spring Data JPA (CrudRepository + JpaSpecificationExecutor)
│  Repository  │  no @Query when a Specification will do
└──────┬───────┘
       │
       ▼
┌──────────────┐  @Entity (Lombok-decorated), domain objects only
│   Entity     │  mapped to/from DTO via MapStruct
└──────────────┘
```

DTOs are organized by domain (`dto/card`, `dto/deck`, `dto/replay`, `dto/room`, `dto/user`, `dto/yugipro`). The mapper layer is one MapStruct mapper per domain.

## Module map (`src/main/java/com/skytrix`)

| Package | Role |
|---|---|
| `config/` | Spring Boot configuration classes (CORS, async executor, scheduler) |
| `controller/` | `@RestController` layer (10 controllers — see [api-contracts-back.md](./api-contracts-back.md)) |
| `service/` | Business logic (CardService, DeckService, RoomService, ReplayService, YugiproApiService, DocumentService, TransferService, RoomEventService, **DuelServerClient**) |
| `repository/` | JPA repositories (one per entity) |
| `model/entity/` | JPA `@Entity` (User, Card, Deck, Room, Replay, Translation, CardImage, CardSet, CardUserPossessed, CardDeckIndex, ImageIndex) |
| `model/dto/` | DTOs by sub-package |
| `model/enums/` | Role, Language, Type, Race, Attribute, DeckKeyword, TransferType, RoomStatus, DuelResult |
| `mapper/` | MapStruct mappers |
| `security/` | JWTService, JWTAuthenticationFilter, JWTAuthenticationProvider, AuthService, SecurityConfig, DatabaseProvider, CustomUserDetailsService, AuthEntryPoint, AuthFailureHandler |
| `requester/` | Generic `Requester` base + `YugiproRequester` (ygoprodeck.com client) |
| `scheduler/` | `RoomCleanupScheduler` (reconciles stale rooms with duel-server) |
| `exception/` | UnauthorizedException, TokenExpiredException, InvalidRefreshTokenException, InternalServerError |
| `utils/` | FileUtils, RouteUtils, ThreadUtils, **CoreUtils** (`mapToList`, `filter`, `findAny`, `getNullSafe`), **CustomPageable** (replaces Spring's `Page`/`Pageable`) |

## Authentication

### Token model
- **Access token** — JWT in the `Access` HTTP-only cookie. TTL = `jwt.validity-period` (default 60 000 000 ms ≈ 16.7 h).
- **Refresh token** — JWT in the `Refresh` HTTP-only `Secure` `SameSite=Strict` cookie. TTL = `jwt.refresh-validity-period` (default 86 400 000 ms = 24 h). Hashed and persisted on `User.refreshToken`.

### Filter chain
1. `JWTAuthenticationFilter` (stateless servlet filter) — extracts JWT from cookie or `Authorization: Bearer ...` header, validates signature + expiry, populates `SecurityContext` with a `JWTAuthentication`.
2. `JWTAuthenticationProvider` — resolves the principal from the JWT claims.
3. `DatabaseProvider` — used **only** at `POST /login` (HTTP Basic authentication).
4. `AuthEntryPoint` / `AuthFailureHandler` — return 401/403 in JSON.

### Permitted (no auth required)
- `POST /login`, `POST /create-account`, `POST /refresh`
- `POST /client-logs`
- `GET /actuator/health`
- `GET /documents/big/{id}`, `GET /documents/small/{id}`, `GET /documents/small/code/{id}`, `GET /documents/sample`
- `POST /replays`, `GET /internal/replays/{id}` — internal endpoints, X-Internal-Key validation in handler

### Admin-only (`@Secured("ROLE_ADMIN")`)
- `PUT/POST /api/parameters/**`
- `POST /api/rooms/quick-duel` (`DevRoomController`)
- `GET /api/parameters/status`

### CORS
- `CORS_ALLOWED_ORIGINS` env var (comma-separated). Methods: GET, POST, PUT, DELETE.

## Persistence

### Schema — 11 entities

See [data-models-back.md](./data-models-back.md) for the full schema with relationships.

Highlights:
- `User` — `@ManyToMany` favorite cards.
- `Card` — `@OneToMany` to `CardSet`, `CardImage`, `Translation` (FR/EN). EAGER on images + translations (justified by typical access patterns; watch query cost on bulk endpoints).
- `Deck` — `@OneToMany` to `CardDeckIndex` (positional ordering, MAIN/EXTRA/SIDE) and `ImageIndex` (selected image per slot). Orphan removal on both.
- `Room` — coordinates a PvP match. Holds `wsToken1` / `wsToken2` (issued by duel-server), `duelServerId`, `status` (`RoomStatus` enum).
- `Replay` — UUID PK, two JSONB columns (`metadata`, `replayData`) for the captured replay payload.

### Migrations

Located in `src/main/resources/db/migration/flyway/`. Naming: `V{NNN}__description.sql`.

15 migrations (V001 → V015), spanning the full feature timeline:
- Initial schema (V001), card refactors (V002–V004), auth (V005), favorites (V003), genesys point (V006), translation length (V007), possessed-cards storage refactor (V008–V009), room schema (V010), passcode reconciliation (V011), role population (V012), replay table (V013), card-deck-index image link (V014), TCG art refresh trigger (V015).

`spring.flyway.out-of-order=true` is enabled — convenient in dev but risky on multi-node deployments. Single-node here, so it's tolerable.

### Pagination

`CustomPageable<T>` is used in place of Spring's `Page`/`Pageable`. The wrapper exposes content + page index + page size + total. **Never** return `Page<T>` from a controller; convert via `CoreUtils`.

## External integrations

### `YugiproRequester` (ygoprodeck.com)

| Method | Calls | When |
|---|---|---|
| `fetchAll(Language)` | `GET https://db.ygoprodeck.com/api/v7/cardinfo.php?language=...&misc=yes&format=genesys` | Full card dump (per language) |
| `fetchUnit(name)` | same endpoint, `?name=...` | Refresh single card |
| `fetchById(id)` | same endpoint, `?id=<passcode>` | Refresh by passcode |
| `fetchImage(CardImage, small?)` | `GET https://images.ygoprodeck.com/images/cards[_small]/{imageId}.jpg` | Image cache fill |

Retries: 3 attempts, exponential backoff (1 s, 2 s, 4 s), on 429 + 5xx. Triggered from the **Paramètres** admin UI via `/api/parameters/update-cards`, `/update/images`, `/update/ban-list`, `/update/images/tcg`. Most are async (`@Async`).

### `DuelServerClient` (internal duel-server)

Server-to-server HTTP client (target: `duel-server.url`, default `http://localhost:3001`). Auth via `X-Internal-Key` header (compared against `duel-server.internal-key`). Used by:

- `RoomService` — `POST /api/duels` to create a duel session, returns `{ duelId, wsToken1, wsToken2 }` which are stored on the `Room` entity.
- `RoomCleanupScheduler` — `GET /api/duels/active` to detect rooms that were torn down without a `DUEL_END` message.
- `ParameterController` — `PUT /api/update-data` to push refreshed `cards.cdb` + scripts into the duel-server volume after a card data sync.
- `ParameterController` — `POST /api/validate-passcodes` to pre-flight a deck against the duel-server's known card pool.

The replay write-back goes the **other** direction (duel-server → back) — the backend exposes `POST /api/replays` and `GET /api/internal/replays/{id}` for that.

### Image storage (`DocumentService`)

- Files on disk under `document.folder.image.small` and `document.folder.image.big` (default `./images/small/` and `./images/big/`).
- Served via `GET /documents/big/{id}` etc. Reads with `Files.readAllBytes()`.
- `CardImage.local` / `CardImage.smallLocal` flags track whether the image is cached locally; if not, falls back to the ygoprodeck.com URL.
- `CardImage.tcgUpdated` tracks alternate art refresh state. V015 reset all flags so a re-fetch could happen.

> **Hardening note**: `DocumentService` reads paths from `CardImage.url` directly. Data is internal but if you ever expose user-controlled URLs, whitelist the base directories first. (See [§"Anomalies"](#anomalies--known-issues).)

## SSE (Server-Sent Events)

`GET /api/rooms/{roomCode}/events` returns a `SseEmitter`. `RoomEventService` keeps a per-room `Map<roomCode, List<SseEmitter>>` and pushes `RoomDTO` updates whenever the room state changes (player joined, ready, started, ended). Handles disconnect + timeout cleanup.

## Async tasks (`@Async`)

`ParameterController` exposes admin-only endpoints that kick off long-running ingest tasks:
- `PUT /update/images` (async)
- `PUT /update/images/tcg` (async)
- `PUT /update/duel-data` (async)

The `/api/parameters/status` endpoint exposes per-task progress + pause/resume controls (`POST /pause/{task}`, `POST /resume/{task}`).

## Configuration

### `application.properties`

| Key | Default | Role |
|---|---|---|
| `spring.datasource.url` | `jdbc:postgresql://localhost:5432/skytrix` | env: `SPRING_DATASOURCE_URL` |
| `spring.datasource.password` | `root` (dev only) | env: `DB_PASSWORD` (or `POSTGRES_PASSWORD` in compose) |
| `server.servlet.context-path` | `/api` | All endpoints prefixed |
| `jwt.secret` | (60-char dev key) | env: `JWT_SECRET` |
| `jwt.validity-period` | 60 000 000 ms | Access token TTL |
| `jwt.refresh-validity-period` | 86 400 000 ms (24 h) | Refresh token TTL |
| `duel-server.url` | `http://localhost:3001` | env: `DUEL_SERVER_URL` |
| `duel-server.internal-key` | `dev-internal-key` | env: `DUEL_SERVER_INTERNAL_KEY` (or `INTERNAL_API_KEY`) |
| `replay.retention-days` | 30 | env: `REPLAY_RETENTION_DAYS` |
| `management.server.port` | 8081 | Actuator on a separate port |
| `document.folder.image.small` | `./images/small/` | Thumbnail cache |
| `document.folder.image.big` | `./images/big/` | Full-size cache |
| `spring.flyway.enabled` | true | |
| `spring.flyway.out-of-order` | true | |

### Dockerfile

Multi-stage:
- **Build**: `maven:3.9-eclipse-temurin-21`, copies `pom.xml` + `src/`, runs `mvn package -DskipTests`.
- **Runtime**: `eclipse-temurin:21-jre-alpine` + curl, exposes 8080. Runs `java $JAVA_OPTS -jar app.jar` with `JAVA_OPTS="-XX:+UseG1GC -Xmx512m"` from compose.

## Source tree (`src/main/java/com/skytrix`)

See [source-tree-analysis.md](./source-tree-analysis.md#back--spring-boot-backend).

## Anomalies / known issues

1. **TODO `RoomService:73`** — pessimistic lock held during `duelServerClient.createDuel()` external HTTP call. Risk: deadlock/timeout if duel-server is slow. Fix: async or timeout wrapper around the external call, or release the lock before calling.
2. **Refresh token validation hot path** — `PasswordEncoder.encode()` is called on every refresh validation. At scale, switch to constant-time comparison or pre-compute the hash.
3. **Flyway out-of-order** — risky on multi-node. Currently single-node, fine.
4. **Image path traversal** — `DocumentService` reads paths from `CardImage.url` without whitelist validation. Internal data only, but harden if URLs ever become user-controlled.
5. **No pagination on `/cards/favorites/remove`** — returns the full owned list. Long-time users will see growing payloads.

## Where to look next

- REST surface: [api-contracts-back.md](./api-contracts-back.md)
- Schema + relationships: [data-models-back.md](./data-models-back.md)
- Run/dev/build: [development-guide.md](./development-guide.md)
- Deploy: [deployment-guide.md](./deployment-guide.md)
- Cross-part wiring: [integration-architecture.md](./integration-architecture.md)
