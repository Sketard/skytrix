# Story 5.3: Room Management Fixes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Technical debt source: Epic 3 Story 3-4 — RoomDTO lacks deck ID fields + orphaned room cleanup -->

## Story

As a player,
I want correct navigation back to my deck after a duel, and I want stale rooms cleaned up automatically,
So that the lobby stays clean and deck navigation works properly.

## Acceptance Criteria

### AC1: Deck Navigation via RoomDTO

**Given** a duel has ended and the player clicks "Back to Deck"
**When** the RoomDTO includes the deck ID used to join/create the room
**Then** the player navigates to `/decks/:id` (specific deck) instead of `/decks` (deck list)
**And** `RoomDTO` is extended with a `decklistId: number` field on both Spring Boot and Angular sides
**And** this works even after a full page reload during the duel (data comes from API, not in-memory cache)

### AC2: Orphaned Active Room Cleanup

**Given** a duel room is ACTIVE but the duel-server ended the duel (grace period expired, worker crash, etc.)
**When** the Spring Boot backend checks for stale rooms (scheduled task, every 5 minutes)
**Then** rooms whose duel-server session no longer exists are marked as CLOSED in the database
**And** CLOSED rooms do not appear in the lobby room list
**And** if the duel server is unreachable, the scheduler logs a warning and skips (does NOT mass-close rooms)

## Tasks / Subtasks

**Task dependency order:** Task 1 (duel server endpoint) → Task 2 (backend DTO + mapper + cleanup) → Task 3 (frontend). Tasks within each group are sequential.

- [x] Task 1: Duel Server — Active duels endpoint (AC: #2)
  - [x] 1.1 In `duel-server/src/server.ts`, add `GET /api/duels/active` route in the HTTP request handler (alongside existing `/api/duels` POST and `/health` GET)
  - [x] 1.2 Handler returns `{ duelIds: [...activeDuels.keys()] }` — the list of all active duel session IDs
  - [x] 1.3 Response: `200 OK`, `Content-Type: application/json`. No authentication (internal service call, same as `/health`)

- [x] Task 2: Backend — RoomDTO deck ID + CLOSED status + orphan cleanup (AC: #1, #2)
  - [x] 2.1 Add `private Long decklistId;` field (+ getter/setter) to `RoomDTO.java`
  - [x] 2.2 In `RoomMapper.toRoomDTO()`, map the requesting user's deck ID conditionally (same pattern as `wsToken`):
    - If `requestingUserId` equals player1's ID → `dto.setDecklistId(room.getPlayer1DecklistId())`
    - If `requestingUserId` equals player2's ID → `dto.setDecklistId(room.getPlayer2DecklistId())`
    - Otherwise (null or non-participant) → leave null
  - [x] 2.3 Add `CLOSED` to `RoomStatus` enum (after `ENDED`). Semantic: system-initiated cleanup, distinct from player-initiated `ENDED`
  - [x] 2.4 Add `getActiveDuelIds()` method to `DuelServerClient`:
    - `GET /api/duels/active` → parse response as `ActiveDuelsResponse(List<String> duelIds)` (private record)
    - On success: return the list
    - On exception: log warning, return `null` (null = unreachable, distinct from empty list = no active duels)
  - [x] 2.5 Rewrite `cleanupOrphanedActiveRooms()` in `RoomCleanupScheduler`:
    - Change `fixedRate` from `60_000` to `300_000` (5 minutes per AC)
    - Find all rooms with `status = ACTIVE`
    - If none → return
    - Call `duelServerClient.getActiveDuelIds()`
    - If null (unreachable) → `log.warn("Duel server unreachable — skipping orphaned room cleanup")`, return
    - For each ACTIVE room: if `duelServerId` is null OR not in the active duel ID set → `room.setStatus(RoomStatus.CLOSED)`, save
    - Log count of cleaned rooms
  - [x] 2.6 Update `cleanupOrphanedWaitingRooms()`: change `RoomStatus.ENDED` to `RoomStatus.CLOSED` (orphaned WAITING rooms are also system-cleanup, not player-initiated)

- [x] Task 3: Frontend — Update types and deck navigation (AC: #1, #2)
  - [x] 3.1 In `room.types.ts`, add `decklistId: number | null;` to `RoomDTO` interface
  - [x] 3.2 In `room.types.ts`, add `'CLOSED'` to the `status` union type: `'WAITING' | 'CREATING_DUEL' | 'ACTIVE' | 'ENDED' | 'CLOSED'`
  - [x] 3.3 In `duel-page.component.ts`, update `backToDeck()`:
    - Primary source: `this.room()?.decklistId` (from API, survives page reload)
    - Fallback: `this.decklistId` (from dialog, for edge case where room signal not yet populated)
    - `const deckId = this.room()?.decklistId ?? this.decklistId;`
  - [x] 3.4 In `duel-page.component.ts`, in `fetchRoom()` success handler: set `this.decklistId = room.decklistId` so the local cache is also populated from API data
  - [x] 3.5 In `duel-page.component.ts`, add `case 'CLOSED'` to `handleRoomStatus()` switch — redirect to lobby with distinct error message

- [ ] Task 4: Manual Verification (all ACs)
  - [ ] 4.1 Verify: create room → join → complete duel → "Back to Deck" navigates to `/decks/:id`
  - [ ] 4.2 Verify: reload page during duel → "Back to Deck" still navigates to `/decks/:id`
  - [ ] 4.3 Verify: player 2 joins and clicks "Back to Deck" after duel → navigates to their deck (not player 1's)
  - [ ] 4.4 Verify: create duel, then kill duel-server worker (or wait for session end) → scheduler marks room as CLOSED
  - [ ] 4.5 Verify: CLOSED rooms do not appear in lobby room list
  - [ ] 4.6 Verify: stop duel server entirely → scheduler logs warning, does NOT close rooms
  - [ ] 4.7 Verify: restart duel server (no active duels) → scheduler closes all previously ACTIVE rooms

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring bug caught in Epics 1-3).
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.
- **DRY KISS**: Minimal code, no over-engineering (Axel directive from Epic 3 retro — maintained through Epic 5).
- **No new dependencies**: Angular Material, CDK, standard CSS only. Spring Boot, Node.js `ws` only.
- **Token compliance**: All colors via `var(--pvp-*)` design tokens, all durations via SCSS tokens. Zero hardcoded values.

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| `Room` entity with `player1DecklistId`, `player2DecklistId` | `back/.../model/entity/Room.java` | Exists — deck IDs stored on create/join |
| `RoomDTO` (missing deck IDs) | `back/.../model/dto/room/RoomDTO.java` | Exists — `id, roomCode, status, player1, player2, duelId, wsToken, createdAt` |
| `RoomMapper.toRoomDTO(room, requestingUserId)` | `back/.../mapper/RoomMapper.java` | Exists — conditional `wsToken` mapping pattern. **Extend** for `decklistId` |
| `RoomStatus` enum | `back/.../model/enums/RoomStatus.java` | Exists — `WAITING, CREATING_DUEL, ACTIVE, ENDED` |
| `RoomCleanupScheduler` | `back/.../scheduler/RoomCleanupScheduler.java` | Exists — WAITING cleanup (30min) + nuclear ACTIVE cleanup (health-based) |
| `DuelServerClient` | `back/.../service/DuelServerClient.java` | Exists — `createDuel()`, `isServerHealthy()`. RestClient with 5s timeout |
| `RoomService.createRoom()` | `back/.../service/RoomService.java:52-69` | Exists — sets `player1DecklistId` on Room entity |
| `RoomService.joinRoom()` | `back/.../service/RoomService.java:74-144` | Exists — sets `player2DecklistId` on Room entity |
| `RoomRepository.findByStatus()` | `back/.../repository/RoomRepository.java` | Exists — used by current scheduler |
| `activeDuels: Map<string, ActiveDuelSession>` | `duel-server/src/server.ts:44` | Exists — keys are duel IDs |
| HTTP route handler | `duel-server/src/server.ts:134+` | Exists — handles `POST /api/duels`, `GET /health` |
| `RoomDTO` TypeScript interface | `front/.../pvp/room.types.ts` | Exists — mirrors backend DTO |
| `RoomApiService` | `front/.../pvp/room-api.service.ts` | Exists — `createRoom()`, `getRoom()`, `getRooms()`, `joinRoom()` |
| `backToDeck()` method | `duel-page.component.ts:985-994` | Exists — uses local `this.decklistId` (unreliable after reload) |
| `fetchRoom()` method | `duel-page.component.ts` | Exists — fetches room data, stores `roomId` and `room` signal |
| Local `decklistId` cache | `duel-page.component.ts:186` | Exists — set from join dialog, lost on reload |
| Lobby room list query | `RoomRepository.findTop10ByStatusOrderByCreatedAtDesc(WAITING)` | Exists — only shows WAITING rooms (CLOSED excluded by default) |

### Critical: What Does NOT Exist Yet (Story 5.3 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| `decklistId` field on `RoomDTO` | `RoomDTO.java` | Backend DTO doesn't expose deck IDs |
| Conditional deck ID mapping | `RoomMapper.java` | Mapper doesn't map deck IDs to DTO |
| `decklistId` on Angular `RoomDTO` | `room.types.ts` | Frontend type doesn't include deck ID |
| `CLOSED` status | `RoomStatus.java` + `room.types.ts` | No system-cleanup status distinct from ENDED |
| `GET /api/duels/active` endpoint | `duel-server/src/server.ts` | No way to query which duels are alive |
| `getActiveDuelIds()` method | `DuelServerClient.java` | No client method for the new endpoint |
| Per-duel orphan detection | `RoomCleanupScheduler.java` | Current approach is nuclear (all-or-nothing based on server health) |
| Reliable `backToDeck()` using API data | `duel-page.component.ts` | Current relies on volatile local cache |

### Critical: RoomDTO Conditional Field Pattern

The `RoomMapper` already conditionally maps `wsToken` based on the requesting user's ID. The `decklistId` field follows the **exact same pattern**:

```java
// Existing pattern (wsToken):
if (room.getPlayer1() != null && requestingUserId.equals(room.getPlayer1().getId())) {
    dto.setWsToken(room.getWsToken1());
} else if (room.getPlayer2() != null && requestingUserId.equals(room.getPlayer2().getId())) {
    dto.setWsToken(room.getWsToken2());
}

// New (decklistId) — add in the same conditional blocks:
if (room.getPlayer1() != null && requestingUserId.equals(room.getPlayer1().getId())) {
    dto.setWsToken(room.getWsToken1());
    dto.setDecklistId(room.getPlayer1DecklistId());
} else if (room.getPlayer2() != null && requestingUserId.equals(room.getPlayer2().getId())) {
    dto.setWsToken(room.getWsToken2());
    dto.setDecklistId(room.getPlayer2DecklistId());
}
```

### Critical: Duel Server HTTP Route Pattern

The duel server uses raw `http.createServer` with manual URL routing. Add the new endpoint alongside existing routes:

```typescript
// Existing routes in the request handler:
if (req.method === 'POST' && url.pathname === '/api/duels') { ... }
if (req.method === 'GET' && url.pathname === '/health') { ... }

// Add:
if (req.method === 'GET' && url.pathname === '/api/duels/active') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ duelIds: [...activeDuels.keys()] }));
  return;
}
```

### Critical: Scheduler Rewrite — Nuclear → Per-Duel

**BEFORE (current — REMOVE):**
```java
@Scheduled(fixedRate = 60_000) // every 60s
public void cleanupOrphanedActiveRooms() {
    var activeRooms = roomRepository.findByStatus(RoomStatus.ACTIVE);
    if (activeRooms.isEmpty()) return;
    if (!duelServerClient.isServerHealthy()) {
        // NUCLEAR: ends ALL active rooms if server is down
        for (var room : activeRooms) {
            room.setStatus(RoomStatus.ENDED);
            roomRepository.save(room);
        }
    }
}
```

**AFTER (new — per-duel check):**
```java
@Scheduled(fixedRate = 300_000) // every 5 minutes per AC
public void cleanupOrphanedActiveRooms() {
    var activeRooms = roomRepository.findByStatus(RoomStatus.ACTIVE);
    if (activeRooms.isEmpty()) return;

    var activeDuelIds = duelServerClient.getActiveDuelIds();
    if (activeDuelIds == null) {
        log.warn("Duel server unreachable — skipping orphaned room cleanup");
        return; // DO NOT mass-close
    }

    var activeDuelIdSet = new HashSet<>(activeDuelIds);
    int cleaned = 0;
    for (var room : activeRooms) {
        if (room.getDuelServerId() == null || !activeDuelIdSet.contains(room.getDuelServerId())) {
            room.setStatus(RoomStatus.CLOSED);
            roomRepository.save(room);
            log.info("Closed orphaned active room: {} (code: {}, duelId: {})",
                room.getId(), room.getRoomCode(), room.getDuelServerId());
            cleaned++;
        }
    }
    if (cleaned > 0) {
        log.info("Closed {} orphaned active rooms", cleaned);
    }
}
```

**Key behavioral change:** When duel server is unreachable, we **skip** instead of mass-closing. When duel server comes back with zero active duels, all stale ACTIVE rooms get cleaned up naturally on the next cycle.

### Critical: backToDeck() Fix

**BEFORE:**
```typescript
backToDeck(): void {
  if (this.roomId) {
    this.http.post(`/api/rooms/${this.roomId}/end`, {}).subscribe();
  }
  if (this.decklistId) {
    this.router.navigate(['/decks', this.decklistId]);
  } else {
    this.router.navigate(['/decks']);
  }
}
```

**AFTER:**
```typescript
backToDeck(): void {
  if (this.roomId) {
    this.http.post(`/api/rooms/${this.roomId}/end`, {}).subscribe();
  }
  const deckId = this.room()?.decklistId ?? this.decklistId;
  if (deckId) {
    this.router.navigate(['/decks', deckId]);
  } else {
    this.router.navigate(['/decks']);
  }
}
```

**Why:** `this.room()?.decklistId` comes from the API (survives page reload). `this.decklistId` is the local fallback (set from join dialog before API response arrives).

### What MUST Change

| File | Change | Why |
|------|--------|-----|
| `duel-server/src/server.ts` | Add `GET /api/duels/active` route | Per-duel orphan detection endpoint |
| `back/.../model/dto/room/RoomDTO.java` | Add `decklistId` field | Expose deck ID to frontend |
| `back/.../mapper/RoomMapper.java` | Map `decklistId` conditionally | Populate field in DTO |
| `back/.../model/enums/RoomStatus.java` | Add `CLOSED` | System-cleanup status |
| `back/.../service/DuelServerClient.java` | Add `getActiveDuelIds()` | Client for new duel server endpoint |
| `back/.../scheduler/RoomCleanupScheduler.java` | Rewrite ACTIVE cleanup, update WAITING cleanup | Per-duel check, use CLOSED status |
| `front/.../pvp/room.types.ts` | Add `decklistId` + `CLOSED` status | Frontend type sync |
| `front/.../pvp/duel-page/duel-page.component.ts` | Update `backToDeck()` + `fetchRoom()` | Reliable deck navigation |

### What NOT to Change

- **RoomController** — No new endpoints needed. Existing endpoints return RoomDTO which will now include decklistId via mapper change
- **RoomService** — createRoom/joinRoom already set deck IDs on entity. No changes
- **RoomRepository** — `findByStatus()` already exists. No new queries needed
- **Room entity** — Already has `player1DecklistId`/`player2DecklistId`. No changes
- **RoomApiService (Angular)** — HTTP calls unchanged, just the returned type gains a field
- **LobbyPageComponent** — Room list already filters by WAITING. CLOSED rooms excluded automatically
- **DuelWebSocketService** — No WebSocket protocol changes
- **duel-server types/protocol** — No duel protocol changes. New endpoint is REST, not WS
- **SCSS / templates** — No visual changes
- **Prompt system** — No changes
- **Animation system** — No changes

### Previous Story Intelligence (Story 5.2 — Reconnection Edge Cases)

**Patterns to follow:**
- `inject()` for DI — consistent across all Angular services/components
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)
- Component signals for state management
- Server-side: plain Node.js + `ws` library, raw HTTP routing, inline types in `server.ts`
- Protocol changes require updating BOTH `duel-server/src/ws-protocol.ts` AND `front/src/app/pages/pvp/duel-ws.types.ts` — **NOT applicable here** (this story has no protocol changes)

**Anti-Patterns from previous stories:**
- Do NOT add new npm dependencies
- Do NOT inline color/z-index values — use design tokens
- Do NOT modify existing WebSocket handlers — this story is REST + scheduler only
- Do NOT use `[class]` binding (use `[class.specific-class]`)
- Do NOT over-engineer — simple field additions and a scheduler rewrite
- Do NOT duplicate reconnection logic — this story doesn't touch reconnection

**Epic 4+5 Retro findings applied:**
- DRY KISS — simple wiring, no complex patterns
- Code review mandatory after implementation

### Known Edge Cases (NOT in scope)

1. **CREATING_DUEL stuck rooms**: If Spring Boot crashes mid-joinRoom() after setting CREATING_DUEL but before completion, the room stays stuck. Not addressed — extremely rare, and the 5s HTTP timeout + try/catch rollback covers normal failure. Could add cleanup for CREATING_DUEL > 1 minute old in a future story.

2. **Pessimistic lock during external HTTP call**: RoomService.joinRoom() holds a DB lock during the duelServerClient.createDuel() call (up to 5s). Documented as H3 review item for post-MVP. Not in scope.

3. **DuelServerClient timeout**: 5-second connect + read timeout. If duel server is slow, getActiveDuelIds() may fail. The scheduler handles this gracefully (null → skip).

### Git Intelligence

**Recent commits:** `e7485f88 epic 4` (latest on dev-pvp), `d80b721f epic 2 & 3`, `35c96f9a epic 1`. Current branch: `dev-pvp`.

**Code conventions observed:**
- `import type` for type-only imports
- `inject()` for DI, no constructor injection
- Spring Boot: Lombok `@Data`/`@Getter`/`@Setter`, `@Transactional` on service methods
- Spring Boot scheduler: `@Scheduled(fixedRate = ...)` + `@Transactional`
- DuelServerClient: `RestClient` (Spring 6.1+), private records for request/response DTOs
- Duel server: raw `http.createServer`, manual URL routing, `JSON.stringify`/`JSON.parse`

### Library & Framework Requirements

- **Angular 19.1.3**: Signals, OnPush, inject()
- **Spring Boot**: RestClient, JPA, @Scheduled
- **Node.js duel-server**: `http.createServer`, `ws` library
- **TypeScript 5.5.4**: Strict mode
- **No new dependencies** — zero new packages on all three sides

### Testing Requirements

- No automated tests per project "big bang" approach
- Manual verification via Task 4 subtasks
- Focus on: deck navigation after duel (reload resilience), orphaned room cleanup (per-duel), scheduler safety (unreachable duel server)

### Source Tree — Files to Touch

**CREATE (0 files)**

**MODIFY (8 files):**
- `duel-server/src/server.ts` — add GET /api/duels/active endpoint
- `back/src/main/java/com/skytrix/model/dto/room/RoomDTO.java` — add decklistId field
- `back/src/main/java/com/skytrix/mapper/RoomMapper.java` — map decklistId conditionally
- `back/src/main/java/com/skytrix/model/enums/RoomStatus.java` — add CLOSED
- `back/src/main/java/com/skytrix/service/DuelServerClient.java` — add getActiveDuelIds()
- `back/src/main/java/com/skytrix/scheduler/RoomCleanupScheduler.java` — rewrite ACTIVE cleanup, update WAITING cleanup
- `front/src/app/pages/pvp/room.types.ts` — add decklistId + CLOSED
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — update backToDeck() + fetchRoom()

**REFERENCE (read-only):**
- `back/src/main/java/com/skytrix/model/entity/Room.java` — verify entity has deck ID fields
- `back/src/main/java/com/skytrix/service/RoomService.java` — verify createRoom/joinRoom set deck IDs
- `back/src/main/java/com/skytrix/repository/RoomRepository.java` — verify findByStatus exists
- `front/src/app/pages/pvp/room-api.service.ts` — verify no changes needed

**DO NOT TOUCH:**
- `duel-server/src/ws-protocol.ts` — No protocol changes
- `duel-server/src/types.ts` — No type changes
- `front/src/app/pages/pvp/duel-ws.types.ts` — No WS type changes
- `front/src/app/pages/pvp/lobby-page/` — Lobby already filters by WAITING
- `duel-server/src/duel-worker.ts` — No worker changes
- `duel-server/src/message-filter.ts` — No filter changes
- `back/src/main/java/com/skytrix/controller/RoomController.java` — No endpoint changes
- `back/src/main/java/com/skytrix/service/RoomService.java` — No service changes
- Prompt system, animation system, card inspector — No changes

### Project Structure Notes

- `RoomDTO.decklistId` follows the same conditional-mapping pattern as `wsToken` — only the requesting user's deck ID is exposed
- `CLOSED` status is purely additive — no existing code references it, so zero regression risk
- The new `GET /api/duels/active` endpoint is internal (duel-server ↔ Spring Boot only) — no client/Angular usage
- Lobby room list query (`findTop10ByStatusOrderByCreatedAtDesc(WAITING)`) already excludes ACTIVE, ENDED, and will exclude CLOSED automatically
- `DuelServerClient` timeout (5s) applies to the new `getActiveDuelIds()` call — scheduler handles failure gracefully

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 5, Story 5.3: Room Management Fixes (lines 899-917)]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — Room state machine (line 184), Room entity (line 537), REST endpoints (lines 561-570)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — "Back to Deck" deep link (lines 1556-1561), Result Screen actions (lines 1113-1118)]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — FR6 disconnection handling, FR7 duel end conditions]
- [Source: _bmad-output/implementation-artifacts/5-1-card-inspector-pvp-placeholder.md — Previous story patterns, component-scoped service pattern]
- [Source: _bmad-output/implementation-artifacts/5-2-reconnection-edge-cases.md — Previous story patterns, server session fields, anti-patterns]
- [Source: back/src/main/java/com/skytrix/model/entity/Room.java — player1DecklistId/player2DecklistId fields exist]
- [Source: back/src/main/java/com/skytrix/mapper/RoomMapper.java — Conditional wsToken mapping pattern to replicate]
- [Source: back/src/main/java/com/skytrix/scheduler/RoomCleanupScheduler.java — Current nuclear cleanup to replace]
- [Source: back/src/main/java/com/skytrix/service/DuelServerClient.java — RestClient pattern, isServerHealthy()]
- [Source: front/src/app/pages/pvp/room.types.ts — Current RoomDTO interface to extend]
- [Source: front/src/app/pages/pvp/duel-page/duel-page.component.ts:985-994 — backToDeck() to fix]
- [Source: duel-server/src/server.ts:44 — activeDuels Map to expose via new endpoint]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No issues encountered. All builds pass (duel-server tsc, Angular ng build).

### Completion Notes List

- **Task 1**: Added `GET /api/duels/active` endpoint to duel-server HTTP handler. Returns `{ duelIds: [...activeDuels.keys()] }` with 200 OK. Placed between `/status` and `/api/duels` POST routes.
- **Task 2.1**: Added `private Long decklistId` field to `RoomDTO.java` (Lombok generates getter/setter).
- **Task 2.2**: Extended `RoomMapper.toRoomDTO()` — `decklistId` mapped conditionally using same `requestingUserId` pattern as `wsToken`.
- **Task 2.3**: Added `CLOSED` enum value to `RoomStatus.java` after `ENDED`.
- **Task 2.4**: Added `getActiveDuelIds()` to `DuelServerClient` — GET `/api/duels/active`, parses `ActiveDuelsResponse` record, returns `null` on failure (distinct from empty list).
- **Task 2.5**: Rewrote `cleanupOrphanedActiveRooms()` — nuclear approach replaced with per-duel check against `getActiveDuelIds()`. Rate changed 60s → 300s. Uses `CLOSED` status. Skips cleanup when duel server unreachable.
- **Task 2.6**: Updated `cleanupOrphanedWaitingRooms()` to use `RoomStatus.CLOSED` instead of `ENDED`.
- **Task 3.1-3.2**: Added `decklistId: number | null` and `'CLOSED'` status to frontend `RoomDTO` interface.
- **Task 3.3**: Updated `backToDeck()` — primary source `this.room()?.decklistId` (API, survives reload), fallback `this.decklistId` (dialog cache).
- **Task 3.4**: In `fetchRoom()`, set `this.decklistId = room.decklistId` to populate local cache from API data.
- **Task 3.5**: Added `case 'CLOSED'` to `handleRoomStatus()` switch — distinct message ("This room has been closed") instead of reusing ENDED's message.

### Review Fixes (AI Code Review)

- **M1**: Added status guard in `RoomService.endRoom()` — skip if room already ENDED or CLOSED (prevents race with scheduler).
- **M2**: Promoted `case 'CLOSED'` in handleRoomStatus to formal subtask 3.5 (was undocumented "Extra").
- **L1**: Refactored both scheduler cleanup methods to use `saveAll()` batch instead of individual `save()` calls.
- **L2**: Added null-safe check on `ActiveDuelsResponse.duelIds()` in `DuelServerClient.getActiveDuelIds()`.
- **L3**: CLOSED status now shows distinct message ("This room has been closed") instead of reusing ENDED message.

### File List

- `duel-server/src/server.ts` — Modified (added GET /api/duels/active endpoint)
- `back/src/main/java/com/skytrix/model/dto/room/RoomDTO.java` — Modified (added decklistId field)
- `back/src/main/java/com/skytrix/mapper/RoomMapper.java` — Modified (conditional decklistId mapping)
- `back/src/main/java/com/skytrix/model/enums/RoomStatus.java` — Modified (added CLOSED)
- `back/src/main/java/com/skytrix/service/DuelServerClient.java` — Modified (added getActiveDuelIds(), @Slf4j, ActiveDuelsResponse record, null-safe duelIds check)
- `back/src/main/java/com/skytrix/service/RoomService.java` — Modified (endRoom() status guard for ENDED/CLOSED)
- `back/src/main/java/com/skytrix/scheduler/RoomCleanupScheduler.java` — Modified (rewrote ACTIVE cleanup, updated WAITING cleanup to CLOSED, batch saveAll)
- `front/src/app/pages/pvp/room.types.ts` — Modified (added decklistId + CLOSED status)
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Modified (backToDeck(), fetchRoom(), handleRoomStatus() with distinct CLOSED message)

### Change Log

- 2026-03-01: Implemented Story 5.3 — Room Management Fixes. Added deck navigation via RoomDTO decklistId (AC1), per-duel orphaned room cleanup with CLOSED status (AC2). 8 files modified across all 3 tiers.
- 2026-03-01: Code review fixes — endRoom() status guard (M1), batch saveAll in scheduler (L1), null-safe getActiveDuelIds (L2), distinct CLOSED message (L3). 9 files total.
