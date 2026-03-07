# Story 5.4: Infrastructure & Optimization

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Technical debt source: Epic 1 Story 1-2 (Docker test) + Epic 2 Story 2-4 (thumbnail pre-fetch) -->

## Story

As a developer,
I want Docker container integration tests and optimized thumbnail loading,
So that deployment confidence is higher and duel loading is faster.

## Acceptance Criteria

### AC1: Docker Container Integration Tests

**Given** the duel-server Docker container is built and running
**When** an integration test suite runs against the container
**Then** the test verifies:
- `GET /health` returns 200 with `{ status: 'ok' }`
- `GET /status` returns 200 with valid JSON containing `activeDuels`, `totalDuelsServed`, `uptimeMs`, `memoryUsageMb`
- WebSocket connection can be established on port 3001 and receives no immediate error
- A minimal duel can be created via `POST /api/duels`, two WS clients connect with tokens, RPS completes, `BOARD_STATE` is received, one player surrenders, `DUEL_END` is received by both
**And** the test suite runs via `npm run test:integration`
**And** the test exits with code 0 on success, non-zero on failure
**And** the test assumes the server is already running at `DUEL_SERVER_URL` (default: `http://localhost:3001`)

### AC2: Thumbnail Pre-Fetching Optimization

**Given** a duel is in the loading screen phase (`duel-loading` state)
**When** the client prepares card thumbnails for display
**Then** thumbnails for ALL unique cards in the player's own deck (main + extra) are pre-fetched, not just the 5 hand cards
**And** the pre-fetch uses the existing `Image()` eager-loading pattern (proven in current codebase, higher priority than `<link rel="prefetch">`)
**And** the duel board renders card images without visible loading delay for the player's own cards
**And** the decklist card codes are obtained via the existing deck API using `decklistId` from `RoomDTO`
**And** opponent cards continue to be loaded reactively as they appear (anti-cheat: opponent deck contents are hidden until revealed by gameplay)

## Tasks / Subtasks

**Task dependency order:** Tasks 1-2 (Docker tests) are independent from Tasks 3-4 (thumbnail optimization). Within each group, tasks are sequential.

- [x] Task 1: Integration test script (AC: #1)
  - [x] 1.1 Create `duel-server/test/integration.ts` using Node.js built-in `node:test` module (no new dependencies)
  - [x] 1.2 Test 1 — Health check: `GET /health` → assert status 200, body `{ status: 'ok' }`
  - [x] 1.3 Test 2 — Status endpoint: `GET /status` → assert status 200, body has `activeDuels` (number), `totalDuelsServed` (number), `uptimeMs` (number), `memoryUsageMb` (number)
  - [x] 1.4 Test 3 — WebSocket connection: connect via `ws` to `ws://host:3001`, verify `open` event fires, close cleanly
  - [x] 1.5 Test 4 — Minimal duel lifecycle:
    - POST `/api/duels` with two valid test decks (reference `src/test-core.ts` for existing test deck format)
    - Connect player1 and player2 via WebSocket with returned tokens
    - Wait for `SESSION_TOKEN` on both clients
    - Complete RPS: player 0 sends Rock (choice: 2), player 1 sends Scissors (choice: 1)
    - Wait for `BOARD_STATE` (initial hand draw, both players have LP > 0)
    - Player 0 sends `SURRENDER`
    - Verify `DUEL_END` received by both clients with `reason: 'surrender'`
    - Close both WebSocket connections
  - [x] 1.6 Add timeout per test (30s) — fail if server doesn't respond
  - [x] 1.7 Read `DUEL_SERVER_URL` from environment variable, default to `http://localhost:3001`
  - [x] 1.8 Add `"test:integration": "tsx test/integration.ts"` to `package.json` scripts

- [x] Task 2: Test documentation (AC: #1)
  - [x] 2.1 Add a comment block at top of `integration.ts` explaining prerequisites: container running with data volume mounted, cards.cdb + scripts_full available
  - [x] 2.2 Test output: use `node:test` reporter (TAP format by default), exit code 0/1

- [x] Task 3: Expand thumbnail pre-fetch (AC: #2)
  - [x] 3.1 In `duel-page.component.ts`, modify `preFetchOwnDeckThumbnails()`:
    - Rename to `preFetchDeckThumbnails()` (it now covers full deck, not just hand)
    - Fetch the player's decklist via existing deck API: `GET /api/decks/${decklistId}` (using `decklistId` from `this.room()`)
    - Extract all unique card codes from main deck + extra deck arrays via `entry.card.card.passcode`
    - Create `Image()` for each unique code (same pattern as current hand pre-fetch)
    - `Promise.allSettled()` (use `allSettled` instead of `all` — one failed thumbnail shouldn't reject the batch)
    - On settle: `thumbnailsReady.set(true)`
  - [x] 3.2 Guard: if `decklistId` is not available (edge case — page reload before room fetch completes), fall back to hand-only pre-fetch (current behavior)
  - [x] 3.3 Deduplicate: hand cards are a subset of deck cards — the full-deck pre-fetch covers them. Separate `preFetchHandThumbnails()` only used as fallback
  - [x] 3.4 Preserve 15s timeout fallback (already exists) — thumbnails not loaded in time → proceed anyway

- [ ] Task 4: Manual verification (all ACs) — requires running services
  - [ ] 4.1 Verify: `docker compose up duel-server`, then `npm run test:integration` passes
  - [ ] 4.2 Verify: stop duel-server → `npm run test:integration` fails with clear error
  - [ ] 4.3 Verify: duel loading screen → DevTools Network tab shows 30-50 thumbnail requests (full deck), not just 5 (hand)
  - [ ] 4.4 Verify: after loading, card images appear instantly when drawn/played (cache hit)
  - [ ] 4.5 Verify: page reload during duel → thumbnails still pre-fetch correctly (decklistId from RoomDTO API)
  - [ ] 4.6 Verify: thumbnail fetch failures don't block duel start (15s timeout still works)

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.
- **DRY KISS**: Minimal code, no over-engineering (Axel directive from Epic 3 retro — maintained through Epic 5).
- **No new production dependencies**: `node:test` is built-in, `ws` and `tsx` already exist. Zero new packages.
- **`effect()` with `untracked()`**: For all side effects (HTTP calls, pre-fetching).
- **Immutable signal updates**: Always `.set()` or `.update()` with new reference.

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| `preFetchOwnDeckThumbnails()` | `duel-page.component.ts:1294-1321` | Exists — pre-fetches HAND cards only. **MODIFY** to pre-fetch full deck |
| `thumbnailsReady` signal | `duel-page.component.ts:107` | Exists — `signal(false)`, set true when pre-fetch completes |
| `duelLoadingReady` computed | `duel-page.component.ts:108` | Exists — `boardReady() && thumbnailsReady()` |
| 15s loading timeout | `duel-page.component.ts:460-464` | Exists — fallback if thumbnails don't load in time |
| `getCardImageUrlByCode(code)` | `pvp/pvp-card.utils.ts` | Exists — returns `/api/images/small/${code}.jpg` |
| `decklistId` on `RoomDTO` | `room.types.ts`, `RoomDTO.java` | Exists (Story 5.3) — player's own deck ID from API |
| `room()` signal | `duel-page.component.ts` | Exists — populated by `fetchRoom()`, contains `decklistId` |
| Dockerfile | `duel-server/Dockerfile` | Exists — Node 24-slim, npm ci, tsc, `node dist/server.js` |
| docker-compose.yml | project root | Exists — 4 services (db, back, duel-server, front), health check on `/health` |
| `GET /health` endpoint | `duel-server/src/server.ts:113-121` | Exists — returns 200 `{ status: 'ok' }` or 503 if data not ready |
| `GET /status` endpoint | `duel-server/src/server.ts:123-132` | Exists — returns activeDuels, totalDuelsServed, uptimeMs, memoryUsageMb |
| `GET /api/duels/active` endpoint | `duel-server/src/server.ts` | Exists (Story 5.3) — lists active duel IDs |
| `POST /api/duels` endpoint | `duel-server/src/server.ts` | Exists — creates duel, returns `{ duelId, tokens: [t1, t2] }` |
| `test-core.ts` (PoC) | `duel-server/src/test-core.ts` | Exists — reference for valid test deck format and OCGCore interaction |
| `ws` dependency | `duel-server/package.json` | Exists — WebSocket library (production dep) |
| `tsx` dependency | `duel-server/package.json` | Exists — TypeScript execution (devDependency) |
| `HttpClient` injection | `duel-page.component.ts` | Exists — already injected for API calls |
| `firstValueFrom()` pattern | various components | Exists — async HTTP pattern used across codebase |
| `Image()` pre-fetch pattern | `duel-page.component.ts:1310-1318` | Exists — creates Image, resolves on load/error |

### Critical: What Does NOT Exist Yet (Story 5.4 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| `duel-server/test/integration.ts` | **NEW** | No integration test suite exists |
| `test:integration` npm script | `duel-server/package.json` | No test script for integration testing |
| Full-deck thumbnail pre-fetch | `duel-page.component.ts` | Current pre-fetch only covers 5 hand cards, not full deck |
| Deck API call in duel-page | `duel-page.component.ts` | No call to fetch deck card codes during duel loading |

### Critical: Integration Test Architecture

**Test framework:** `node:test` (built-in since Node 18, no dependency needed). The duel-server already uses `tsx` for running TypeScript directly.

**Test execution model:**
```
Developer/CI starts container → npm run test:integration → tests run against live container → exit 0/1
```

**NOT in scope:** Automatic container lifecycle management (build/start/stop). The test assumes the server is running. This is deliberate — KISS approach, works with manual testing and CI pipelines alike.

**WebSocket test pattern:**
```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const BASE_URL = process.env.DUEL_SERVER_URL ?? 'http://localhost:3001';
const WS_URL = BASE_URL.replace('http', 'ws');
```

**Minimal duel test deck:** Reference `src/test-core.ts` for existing test deck format. The PoC test already has working deck configurations that pass OCGCore validation. Reuse the same card codes and deck structure.

**RPS flow:** After SESSION_TOKEN, OCGCore sends RPS_CHOICE to each player sequentially (player 0 first). After both respond, OCGCore auto-resolves turn order and draws hands. BOARD_STATE arrives with initial hands and LP. See `ws-protocol.ts` for exact message types.

### Critical: Thumbnail Pre-Fetch Expansion

**BEFORE (current — hand only):**
```typescript
// duel-page.component.ts:1294-1321
private preFetchOwnDeckThumbnails(): void {
  const player = this.duelState().players[0];
  const handZone = player.zones.find((z: BoardZone) => z.zoneId === 'HAND');
  const handCards = handZone?.cards ?? [];
  const cardCodes = handCards.map(c => c.cardCode).filter(...);
  // Pre-fetch 5 hand card thumbnails only
  const promises = cardCodes.map(code => { ... new Image() ... });
  Promise.all(promises).then(() => this.thumbnailsReady.set(true));
}
```

**AFTER (full deck):**
```typescript
private async preFetchDeckThumbnails(): Promise<void> {
  const decklistId = this.room()?.decklistId;
  if (!decklistId) {
    // Fallback: pre-fetch hand cards only (page reload before room fetch)
    this.preFetchHandThumbnails();
    return;
  }

  try {
    const deck = await firstValueFrom(this.http.get<DeckDTO>(`/api/decks/${decklistId}`));
    const allCodes = [...new Set([
      ...deck.mainDeck.map(c => c.cardCode ?? c.code),
      ...deck.extraDeck.map(c => c.cardCode ?? c.code),
    ].filter((code): code is number => !!code && code > 0))];

    const promises = allCodes.map(code =>
      new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve(); // Fallback — still settle
        img.src = getCardImageUrlByCode(code);
      })
    );

    await Promise.allSettled(promises);
  } catch {
    // API failure — proceed without full pre-fetch
  }

  this.thumbnailsReady.set(true);
}
```

**Key changes:**
1. **Source of card codes:** Deck API via `decklistId` instead of BOARD_STATE hand zone
2. **Coverage:** All unique cards in main + extra deck (~30-50 images) instead of 5 hand cards
3. **`Promise.allSettled()`** instead of `Promise.all()` — individual failures don't reject the batch
4. **Fallback:** If `decklistId` unavailable → fall back to hand-only (current behavior)
5. **Opponent cards:** NOT pre-fetched (anti-cheat — opponent deck contents hidden until gameplay reveals them)

**Why not pre-fetch opponent's deck?** OCGCore hides opponent cards until drawn/played. Sending opponent card codes would leak strategic information (deck composition). The "both players' decks" in the AC is interpreted as "each client pre-fetches its own deck" — both clients do it independently.

**Deck API endpoint:** `GET /api/decks/${decklistId}` (DeckController.java). Response is `DeckDTO` with `mainDeck: IndexedCardDetailDTO[]` and `extraDeck: IndexedCardDetailDTO[]`. Card code path: `entry.card.card.passcode`.

### What MUST Change

| File | Change | Why |
|------|--------|-----|
| `duel-server/test/integration.ts` | **NEW** — Integration test suite | No tests exist |
| `duel-server/package.json` | Add `test:integration` script | Test runner entry point |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Expand `preFetchOwnDeckThumbnails()` → `preFetchDeckThumbnails()` | Pre-fetch full deck, not just hand |

### What NOT to Change

- **Dockerfile** — Already correct, no modifications needed
- **docker-compose.yml** — Already has health check, no changes
- **duel-server/src/server.ts** — All endpoints already exist (health, status, POST /api/duels, GET /api/duels/active)
- **duel-server/src/ws-protocol.ts** — No protocol changes
- **duel-server/src/types.ts** — No type changes
- **pvp-card.utils.ts** — `getCardImageUrlByCode()` unchanged
- **PvpBoardContainerComponent** — No changes
- **Animation system** — No changes
- **Prompt system** — No changes
- **Card inspector** — No changes
- **DuelWebSocketService** — No WebSocket changes
- **Loading screen template** — No visual changes (same loading UX, just more thumbnails pre-fetched)
- **Spring Boot backend** — No backend changes (deck API already exists)
- **`thumbnailsReady` / `duelLoadingReady` signals** — Same signals, same computed, same 15s timeout

### Previous Story Intelligence (Stories 5.1–5.3)

**Patterns to follow:**
- `inject()` for DI, no constructor injection
- `import type` for type-only imports
- `firstValueFrom()` for async HTTP calls (deck-builder pattern)
- `effect()` + `untracked()` for side effects
- Explicit `null` (never `undefined` or field omission)
- Component-scoped services via `providers` array
- Server-side: plain Node.js + `ws`, raw HTTP routing, inline types

**Anti-Patterns from previous stories:**
- Do NOT add new npm production dependencies — `node:test` is built-in, `ws` + `tsx` exist
- Do NOT modify the loading screen UI — only change the pre-fetch logic
- Do NOT pre-fetch opponent deck thumbnails (anti-cheat — deck composition is hidden)
- Do NOT use `Promise.all()` for thumbnail batch — use `Promise.allSettled()` (one failure shouldn't block all)
- Do NOT remove the 15s timeout fallback — it's the safety net for slow networks
- Do NOT create complex test orchestration (docker build/start/stop) — KISS, test assumes server running

**Epic 5 accumulated findings:**
- Story 5.1: `firstValueFrom()` for async HTTP, card data cache pattern, `Image()` pre-fetch proven
- Story 5.2: No new dependencies ever, native Web APIs preferred
- Story 5.3: `decklistId` on `RoomDTO` — the exact field we need for deck pre-fetch

### Git Intelligence

**Recent commits:** `e7485f88 epic 4` (latest on dev-pvp), `d80b721f epic 2 & 3`, `35c96f9a epic 1`. Current branch: `dev-pvp`.

**Code conventions observed:**
- `import type` for type-only imports
- `firstValueFrom()` for async HTTP in components
- `inject()` for DI, no constructor injection
- Duel server: `tsx` for TypeScript execution, `ws` library
- ESM modules (`"type": "module"` in package.json)
- `node:` protocol for Node.js built-in imports

### Library & Framework Requirements

- **Angular 19.1.3**: Signals, OnPush, inject(), HttpClient
- **Node.js 24**: `node:test` built-in test runner, native `fetch()`
- **TypeScript 5.5.4 / 5.9.3**: Strict mode (frontend / duel-server respectively)
- **`ws` 8.19.0**: WebSocket library (already in duel-server)
- **`tsx` 4.21.0**: TypeScript execution (already in devDeps)
- **No new dependencies** — zero new packages

### Testing Requirements

- No automated frontend tests per project "big bang" approach
- Docker integration tests are the NEW automated tests (this story's scope)
- Manual verification via Task 4 subtasks
- Focus on: test suite passes against running container, thumbnail count in DevTools network tab, cache hit on card draw

### Source Tree — Files to Touch

**CREATE (1 file):**
- `duel-server/test/integration.ts` — Docker container integration test suite

**MODIFY (2 files):**
- `duel-server/package.json` — add `test:integration` script
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — expand thumbnail pre-fetch to full deck

**REFERENCE (read-only):**
- `duel-server/src/test-core.ts` — reference for test deck format and OCGCore interaction
- `duel-server/src/server.ts` — HTTP endpoints, WebSocket handling, duel lifecycle
- `duel-server/src/ws-protocol.ts` — message types for RPS_CHOICE, BOARD_STATE, SURRENDER, DUEL_END, SESSION_TOKEN
- `duel-server/src/types.ts` — constants (timeouts, etc.)
- `duel-server/Dockerfile` — existing container build
- `docker-compose.yml` — service configuration, health check
- `front/src/app/pages/pvp/pvp-card.utils.ts` — `getCardImageUrlByCode()`
- `front/src/app/pages/pvp/room.types.ts` — `RoomDTO` with `decklistId`
- Existing deck API controller + service (find via `DeckController` or `DecklistController`)

**DO NOT TOUCH:**
- `duel-server/src/server.ts` — No server code changes
- `duel-server/Dockerfile` — No Docker build changes
- `docker-compose.yml` — No compose changes
- `duel-server/src/ws-protocol.ts` — No protocol changes
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — No template changes
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss` — No style changes
- Spring Boot backend — No backend changes
- Prompt system, animation system, card inspector — No changes

### Project Structure Notes

- `duel-server/test/` is a new directory — consistent with Node.js conventions for test files outside `src/`
- Integration tests import `ws` from the project's own dependency (no new install)
- `node:test` + `node:assert` are built-in Node.js modules — zero dependency cost
- Thumbnail pre-fetch expansion is a pure logic change in one method — no new files, no new signals, no new components
- `decklistId` availability depends on `fetchRoom()` completing before `preFetchDeckThumbnails()` runs. The `duel-loading` state is entered after `boardReady` (which requires `BOARD_STATE`), which happens after `fetchRoom()` has completed — so `decklistId` should be available. Add guard anyway (fallback to hand-only)

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 5, Story 5.4: Infrastructure & Optimization (lines 919-938)]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — Duel server Dockerfile (line 439), docker-compose (lines 251-257, 586-591), health endpoint, card data pre-loading, deployment strategy]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — Duel Loading Screen (line 1589), thumbnail pre-cache at duel init (lines 1316, 1905), card image lazy loading strategy]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — Deck loading from server relay (line 78)]
- [Source: _bmad-output/implementation-artifacts/5-1-card-inspector-pvp-placeholder.md — Image() pre-fetch pattern, firstValueFrom(), CardDataCacheService]
- [Source: _bmad-output/implementation-artifacts/5-2-reconnection-edge-cases.md — No new dependencies, native Web APIs]
- [Source: _bmad-output/implementation-artifacts/5-3-room-management-fixes.md — decklistId on RoomDTO, backToDeck() fix, GET /api/duels/active endpoint]
- [Source: duel-server/src/server.ts — HTTP endpoints (health:113, status:123, POST /api/duels, GET /api/duels/active)]
- [Source: duel-server/src/test-core.ts — PoC test with valid deck data and OCGCore interaction]
- [Source: duel-server/package.json — Scripts: poc, build, start; deps: ws, tsx, better-sqlite3]
- [Source: duel-server/Dockerfile — Node 24-slim, npm ci, tsc, CMD node dist/server.js]
- [Source: docker-compose.yml — duel-server service with /health check, data volume :ro]
- [Source: front/src/app/pages/pvp/duel-page/duel-page.component.ts:1294-1321 — preFetchOwnDeckThumbnails() hand-only pre-fetch]
- [Source: front/src/app/pages/pvp/pvp-card.utils.ts — getCardImageUrlByCode() returns /api/images/small/${code}.jpg]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Story referenced `GET /api/decklists/${decklistId}` but actual endpoint is `GET /api/decks/${id}` (DeckController.java)
- Story referenced `COIN_CHOICE`/`DUEL_START` messages — these don't exist. OCGCore auto-resolves turn order after RPS. Actual flow: SESSION_TOKEN → RPS_CHOICE → BOARD_STATE
- DeckDTO card code path: `entry.card.card.passcode` (IndexedCardDetailDTO → CardDetailDTO → CardDTO)
- Pre-existing TS errors in owned-card-dto.ts/owned-card.ts (unrelated, not introduced by this story)
- Task 4 (manual verification) requires running Docker + frontend — left unchecked for developer

### Completion Notes List

- Tasks 1-3 fully implemented. Task 4 requires manual runtime verification.
- Integration test uses `node:test` + `ws` (zero new dependencies), runs via `npm run test:integration`
- Thumbnail pre-fetch expanded from 5 hand cards to full deck (~30-50 unique cards) using deck API
- Fallback to hand-only pre-fetch when `decklistId` unavailable (edge case guard)
- `Promise.allSettled()` used instead of `Promise.all()` for resilience

### File List

- `duel-server/test/integration.ts` — **CREATED** — Docker container integration test suite (4 tests)
- `duel-server/package.json` — **MODIFIED** — added `test:integration` script
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — **MODIFIED** — `preFetchOwnDeckThumbnails()` → `preFetchDeckThumbnails()` + `preFetchHandThumbnails()` fallback
