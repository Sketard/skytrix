# API Contracts — Backend (Spring Boot)

> All endpoints are prefixed with the servlet context-path `/api`. Auth is JWT in cookies (`Access` + `Refresh`, both HTTP-only). Login uses HTTP Basic. Internal endpoints validate `X-Internal-Key`.

## Conventions

- **Body**: `application/json` unless stated otherwise.
- **Pagination**: `CustomPageable<T>` wrapper (custom — never Spring `Page`). Shape: `{ content: T[], pageNumber, pageSize, totalElements, totalPages }`.
- **Errors**: 400 (validation), 401 (auth), 403 (forbidden / role), 404 (not found), 500 (internal). Error bodies: `{ message, path, status, timestamp }`.
- **Auth column legend**:
  - `none` — `permitAll`
  - `JWT` — any authenticated user (role `USER` or `ADMIN`)
  - `ADMIN` — `@Secured("ROLE_ADMIN")`
  - `internal` — `X-Internal-Key` header validated against `duel-server.internal-key`

## AuthController

Base: `/api`

| Method | Path | Auth | Body / Params | Returns |
|---|---|---|---|---|
| POST | `/login` | none (HTTP Basic) | HTTP Basic header (`Authorization: Basic ...`) | `200 ShortUserDTO` + `Set-Cookie: Access; Refresh` |
| POST | `/refresh` | none (cookie) | `Cookie: Refresh=...` | `204` + refreshed `Set-Cookie: Access; Refresh` |
| POST | `/create-account` | none | `CreateUserDTO` | `201 Created` |
| POST | `/logout` | JWT | — | `204` + `Set-Cookie: Access=; Refresh=` (cleared) |

## CardController

Base: `/api/cards`

| Method | Path | Auth | Body / Params | Returns |
|---|---|---|---|---|
| POST | `/search` | JWT | body `CardFilterDTO`, query `offset`, `quantity` | `CustomPageable<CardDetailedDTO>` |
| GET | `/code/{cardCode}` | JWT | path `cardCode` | `CardDetailedDTO` |
| PUT | `/favorites/add/{cardId}` | JWT | path `cardId` | `204` |
| PUT | `/favorites/remove/{cardId}` | JWT | path `cardId` | `List<CardDetailedDTO>` (full owned list — see anomalies) |
| GET | `/names` | JWT | query `q` | `List<Map<String, Object>>` (autocomplete) |
| GET | `/possessed` | JWT | — | `Map<Long, Integer>` (cardId → qty) |
| PUT | `/possessed/{cardId}` | JWT | path `cardId`, query `number` | `204` |

## DeckController

Base: `/api/decks`

| Method | Path | Auth | Body / Params | Returns |
|---|---|---|---|---|
| POST | `` | JWT | `CreateDeckDTO` | `DeckDTO` |
| GET | `/{id}` | JWT | path `id` | `DeckDTO` |
| GET | `` | JWT | — | `List<ShortDeckDTO>` |
| DELETE | `/{id}` | JWT | path `id` | `204` |

## RoomController

Base: `/api/rooms`

| Method | Path | Auth | Body / Params | Returns |
|---|---|---|---|---|
| POST | `` | JWT | `CreateRoomDTO` | `RoomDTO` |
| POST | `/{roomCode}/join` | JWT | path `roomCode`, body `JoinRoomDTO` | `RoomDTO` |
| GET | `` | JWT | — | `List<RoomDTO>` |
| GET | `/{roomCode}` | JWT | path `roomCode` | `RoomDTO` |
| GET | `/{roomCode}/events` | JWT | path `roomCode` | `SseEmitter` (text/event-stream) |
| POST | `/{roomCode}/end` | JWT | path `roomCode` | `200 OK` |

`POST /api/rooms` triggers a `DuelServerClient.createDuel(...)` call internally to obtain `wsToken1` / `wsToken2`. The SSE endpoint streams `RoomDTO` updates on player join/ready/start/end.

## DevRoomController

Base: `/api/rooms`

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/quick-duel` | ADMIN | `QuickDuelDTO` | `QuickDuelResponseDTO` |

Dev shortcut to spin up a duel without going through the lobby (admin only).

## ReplayController

Base: `/api`

| Method | Path | Auth | Body / Params | Returns |
|---|---|---|---|---|
| GET | `/replays` | JWT | query `offset` (default 0), `quantity` (default 20) | `CustomPageable<ReplayDTO>` |
| POST | `/replays` | internal | header `X-Internal-Key`, body `ReplayDTO` | `Map<String, UUID>` (`id`) |
| DELETE | `/replays/{id}` | JWT | path `id` | `204` |
| GET | `/internal/replays/{id}` | internal | header `X-Internal-Key`, path `id` | `ReplayDTO` |

The two `internal` endpoints are how the duel-server persists captured replays after `MSG_WIN` and reads them back when a fork is requested.

## TransferController

Base: `/api/transfers`

| Method | Path | Auth | Body / Params | Returns |
|---|---|---|---|---|
| POST | `/export/deck` | JWT | `ExportDeckDTO` | `byte[]` (binary; PDF or `.ydk`) |
| POST | `/import/deck` | JWT | multipart `file` | `DeckDTO` |

## YugiproApiController

Base: `/api/yugipro`

| Method | Path | Auth | Body / Params | Returns | Notes |
|---|---|---|---|---|---|
| POST | `` | JWT | — | `201 Created` | Trigger full card sync |
| PUT | `/update/ban-list` | JWT | — | `204` | Refresh ban-list flags |
| POST | `/fetch/image` | JWT | — | `204` | Pull missing images |
| PUT | `/update/image/tcg` | JWT | — | `204` | Refresh alternate art |
| PUT | `/refresh/image/{cardId}` | JWT | path `cardId` | `204` | Single-card image refresh |

## ParameterController

Base: `/api/parameters` — class-annotated `@Secured("ROLE_ADMIN")`

| Method | Path | Auth | Body / Params | Returns | Notes |
|---|---|---|---|---|---|
| PUT | `/update/cards` | ADMIN | — | `204` | |
| PUT | `/update/images` | ADMIN | — | `204` | `@Async` |
| PUT | `/update/ban-list` | ADMIN | — | `204` | |
| PUT | `/update/images/tcg` | ADMIN | — | `204` | `@Async` |
| PUT | `/update/duel-data` | ADMIN | — | `204` | `@Async`; pushes `cards.cdb` + scripts to duel-server volume |
| GET | `/status` | ADMIN | — | `Map<String, Map<String, Object>>` | Per-task progress |
| POST | `/pause/{task}` | ADMIN | path `task` | `204` | |
| POST | `/resume/{task}` | ADMIN | path `task` | `204` | |

## ClientLogController

Base: `/api`

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/client-logs` | none | `List<ClientLogEntry>` | `204` |

Browser-side error capture. Rate-limited at nginx (10 req/min per IP, burst 20).

## DocumentService — image serving

Not strictly a `@RestController`-annotated class but exposed via routes mapped in the security config.

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/documents/big/{id}` | none | image bytes |
| GET | `/documents/small/{id}` | none | image bytes |
| GET | `/documents/small/code/{cardCode}` | none | image bytes (resolved by passcode) |
| GET | `/documents/sample` | none | placeholder |

## Spring Boot Actuator

| Method | Path | Port | Auth |
|---|---|---|---|
| GET | `/actuator/health` | 8081 | none |

The management server runs on a separate port (`management.server.port=8081`) — **not** under `/api`.

## DTO sketches

> Field-by-field DTOs are auto-generated by MapStruct from the corresponding `@Entity`. Highlights below.

### `CreateUserDTO`
```json
{ "pseudo": "string", "password": "string" }
```

### `ShortUserDTO`
```json
{ "id": 0, "pseudo": "string", "role": "USER|ADMIN" }
```

### `CardFilterDTO`
Search filter — name, type[], race[], attribute[], level range, atk/def range, archetype, set codes, banListStatus, owned-only, favorited-only.

### `CardDetailedDTO`
Card + translations (FR/EN) + images + sets + computed fields (genesys point, ban status).

### `DeckDTO`
```json
{
  "id": 0,
  "name": "string",
  "cards": [ { "cardId": 0, "selectedImageId": 0, "type": "MAIN_DECK|EXTRA_DECK|SIDE_DECK", "index": 0 }, ... ],
  "user": { "id": 0, "pseudo": "string" }
}
```

### `RoomDTO`
```json
{
  "id": 0,
  "roomCode": "ABC123",
  "player1": { ... },
  "player2": { ... } | null,
  "status": "WAITING|READY|DUELING|FINISHED",
  "duelServerId": "uuid",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

`wsToken1` and `wsToken2` are stored on the entity but **never returned** to clients. The room creator gets `wsToken1` directly in the create response (different DTO, see `DuelCreationResponse`); the joiner gets `wsToken2` similarly.

### `ReplayDTO`
```json
{
  "id": "uuid",
  "metadata": { /* ReplayMetadata: players, decks, durationMs, winner, ... */ },
  "replayData": { /* ReplayData: capturedResponses, randomSeed, ... */ },
  "createdAt": "ISO-8601"
}
```

`metadata` and `replayData` are `JSONB` columns.

### `CreateRoomDTO`, `JoinRoomDTO`
Both reference `decklistId: Long`.

### `ClientLogEntry`
```json
{
  "level": "ERROR|WARN|INFO|DEBUG",
  "message": "string",
  "stack": "string",
  "url": "string",
  "userAgent": "string",
  "timestamp": "ISO-8601",
  "context": { "duelId": "uuid", "session": "...", "...": "..." }
}
```

## Error response shape

```json
{
  "status": 400,
  "message": "Field 'pseudo' is required",
  "path": "/api/create-account",
  "timestamp": "2026-05-10T12:34:56.789Z"
}
```

Auth failures from `AuthEntryPoint` / `AuthFailureHandler` use the same shape with `status: 401` or `403`.

## See also

- [data-models-back.md](./data-models-back.md) for the schema underlying the DTOs.
- [integration-architecture.md](./integration-architecture.md) for the back ↔ duel-server HTTP contract.
- [architecture-back.md](./architecture-back.md) for layering, security, and config rules.
