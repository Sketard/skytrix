---
title: 'Possessed Cards — Migrate from CardSet to Card with User Association'
slug: 'possessed-card-to-card'
created: '2026-02-24'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Spring Boot 3.4.2', 'Java 21', 'Angular 19', 'PostgreSQL 16', 'Flyway', 'MapStruct']
files_to_modify:
  - 'back/src/main/java/com/skytrix/model/entity/Card.java'
  - 'back/src/main/java/com/skytrix/model/dto/card/CardDTO.java'
  - 'back/src/main/java/com/skytrix/service/CardService.java'
  - 'back/src/main/java/com/skytrix/controller/CardController.java'
  - 'front/src/app/services/owned-card.service.ts'
  - 'front/src/app/pages/login-page/login-page.component.ts'
  - 'front/src/app/components/card-list/card-list.component.ts'
  - 'front/src/app/components/card-list/card-list.component.html'
  - 'front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts'
  - 'front/src/app/pages/card-search-page/card-search-page.component.ts'
code_patterns:
  - '@Inject (Jakarta) for DI in services/controllers'
  - 'MapStruct abstract mapper with @AfterMapping for custom logic'
  - 'JPA @ManyToOne / @OneToMany for entity relations'
  - 'Angular standalone components with ChangeDetectionStrategy.OnPush'
  - 'Angular signals (signal, computed, toSignal) for reactive state'
  - 'HTTP calls use take(1).subscribe() or firstValueFrom()'
test_patterns: []
---

# Tech-Spec: Possessed Cards — Migrate from CardSet to Card with User Association

**Created:** 2026-02-24

## Overview

### Problem Statement

The `card_possessed` table linked a `User` to a `CardSet` (specific edition) with a quantity. This granularity by CardSet is no longer desired. The feature was partially refactored but erroneously removed the User association, making `possessedNumber` a global column on `Card`, which is incorrect in a multi-user context.

### Solution

Replace the old `card_possessed(card_set_id, user_id, number)` table with a new `card_user_possessed(card_id, user_id, possessed_number)` table. Possessed counts are **not stored in `CardDTO`** — the frontend owns the data via `OwnedCardService`, which loads all counts in a single `GET /api/cards/possessed` call post-login and stores them in an Angular signal. All views (list, inspector, deck-builder) read from this signal. The frontend UX remains identical — same badge on cards in the list, same +/- in the inspector — just wired to the new simpler, signal-first data model.

### Scope

**In Scope:**
- Fix erroneous backend: remove `possessedNumber` column from `card` table, remove the field from `Card` entity
- Create new `CardUserPossessed` entity linking `Card` + `User` + `possessed_number`
- Flyway migrations to correct the database state
- New `CardUserPossessed` repository and service logic
- REST endpoints: `GET /api/cards/possessed` (all counts for user) + `PUT /api/cards/possessed/{cardId}?number=N`
- Frontend: `OwnedCardService` refactored — `loadAll()` post-login, `resetMap()` on logout, signal-based map
- Frontend: `DeckBuilderComponent`, `CardSearchPageComponent`, `CardListComponent`, `CardInspectorComponent` updated to read from `ownedMap()` signal
- Frontend: `FindGroupedOwnedCardPipe` (`find-grouped-owned-card.ts`) deleted — components call `ownedMap().get(cardId)` directly
- Delete all obsolete DTOs and files linked to old `CardPossessed`/`CardSet` model

**Out of Scope:**
- No UX changes — same badge, same +/- inspector
- No CardSet-level granularity (edition tracking)
- No filtering/searching by possessed count
- No batch update endpoint

## Context for Development

### Codebase Patterns

- Spring Boot services use `@Inject` (Jakarta) not `@Autowired`
- Mappers use MapStruct abstract class with `@AfterMapping` for custom logic; fields with matching names are auto-mapped
- `AuthService.getConnectedUser()` / `getConnectedUserId()` provide current user (injected via `@Inject`)
- Angular uses standalone components with `ChangeDetectionStrategy.OnPush`
- Angular signals (`signal`, `computed`, `toSignal`) for reactive state
- HTTP calls use `take(1)` + `.subscribe()` or `firstValueFrom()`
- DTOs flow: Backend entity → MapStruct mapper → DTO → Angular model class (e.g. `Card extends CardDTO`)
- Existing entity relationship pattern: `@ManyToOne` with `@JoinColumn`, `@OneToMany(mappedBy=...)`
- `favorite_cards` join table as reference for ManyToMany — `card_user_possessed` uses a different pattern (explicit entity with extra column)

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `back/src/main/java/com/skytrix/model/entity/Card.java` | Remove `possessedNumber` field (line 59) |
| `back/src/main/java/com/skytrix/model/dto/card/CardDTO.java` | Remove `possessedNumber` field (line 32) — MapStruct auto-mapping disappears when field removed from entity |
| `back/src/main/java/com/skytrix/mapper/CardMapper.java` | No change needed — MapStruct auto-maps by field name; removing field from both entity and DTO is sufficient |
| `back/src/main/java/com/skytrix/model/entity/CardUserPossessed.java` | **CREATE** — new entity |
| `back/src/main/java/com/skytrix/repository/CardUserPossessedRepository.java` | **CREATE** — new repo |
| `back/src/main/java/com/skytrix/service/CardService.java` | Replace `updatePossessedNumber()` (line 64-67) + add `getPossessedMap()` |
| `back/src/main/java/com/skytrix/controller/CardController.java` | Add `@GetMapping("/possessed")` + update `PUT /possessed/{cardId}` (line 47-51) |
| `back/src/main/resources/db/migration/flyway/V009__card_user_possessed.sql` | **CREATE** — V009 migration |
| `back/src/main/java/com/skytrix/model/entity/User.java` | Reference only — fields: `id`, `pseudo`, `password`, `refreshToken`, `favoriteCards` |
| `back/src/main/java/com/skytrix/security/AuthService.java` | Reference only — `getConnectedUserId()` returns `Long`, `getConnectedUser()` returns `User` |
| `front/src/app/services/owned-card.service.ts` | Full refactor — currently: BehaviorSubject + `/api/possessed/short` + PUT `/api/possessed` |
| `front/src/app/pages/login-page/login-page.component.ts` | Call `ownedCardService.loadAll()` in `connect()` after `authService.setUser()`; call `ownedCardService.resetMap()` in `ngOnInit()` |
| `front/src/app/core/pipes/find-grouped-owned-card.ts` | **DELETE** — aggregates ShortOwnedCardDTO by cardSetId; no longer needed |
| `front/src/app/core/pipes/find-owned-card.pipe.ts` | **DELETE** — orphaned pipe (0 usages), uses ShortOwnedCardDTO |
| `front/src/app/core/model/dto/short-owned-card-dto.ts` | **DELETE** — `{cardSetId, number}` DTO |
| `front/src/app/core/model/dto/owned-card-dto.ts` | **DELETE** — full card+set DTO |
| `front/src/app/core/model/dto/update-owned-card-dto.ts` | **DELETE** — wraps `Array<ShortOwnedCardDTO>` |
| `front/src/app/components/card-list/card-list.component.ts` | Remove `FindGroupedOwnedCardPipe` from imports array only; keep `AsyncPipe` |
| `front/src/app/components/card-list/card-list.component.html` | Line 28: replace pipe chain with `ownedCardService.ownedMap().get(cd.card.id)` |
| `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts` | Replace `shortOwnedCards` toSignal + `selectedCardOwnedCount` computed; update `onOwnedCountChange` |
| `front/src/app/pages/card-search-page/card-search-page.component.ts` | Same as DeckBuilderComponent |
| `front/src/app/components/card-inspector/card-inspector.component.ts+html` | No changes needed — already uses `ownedCount` model input from parent |

### Technical Decisions

- **Signal = single source of truth**: `possessedNumber` is NOT in `CardDTO` / not populated by backend mapper. All views (list, inspector, deck-builder) read exclusively from `OwnedCardService.ownedMap()` signal.
- **Frontend-driven bulk loading**: `OwnedCardService.loadAll()` called by `LoginPageComponent.connect()` after `authService.setUser()` → `GET /api/cards/possessed` → `Map<Long, Integer>` (JSON `{"cardId": count}`) → stored in `signal<Map<number, number>>(new Map())`. `resetMap()` called from `LoginPageComponent.ngOnInit()` (runs on every login page entry = post-logout).
- `number=0` behavior: setting possessed count to 0 **deletes the row** in `card_user_possessed` (no zero-value rows stored). Badge hidden when no row exists.
- **API routes** (both under `CardController` at `/api/cards`): `GET /api/cards/possessed` + `PUT /api/cards/possessed/{cardId}` (replaces old `/api/possessed/...` routes)
- **PUT upsert pattern**: JPA find-then-save — `findByCardIdAndUserId` → update if exists, create if not, delete if `number=0`. Returns 404 if `cardId` does not exist.
- **Security**: `userId` always extracted from JWT (`AuthService.getConnectedUserId()`), never passed as request parameter.
- Frontend uses optimistic local update after `PUT` (update signal immediately, don't wait for API response)
- **JSON deserialization**: Spring serializes `Map<Long, Integer>` with string keys → Angular receives `Record<string, number>`. `OwnedCardService` must convert: `new Map(Object.entries(res).map(([k, v]) => [+k, v]))`
- **CardMapper**: No change needed. MapStruct auto-maps `possessedNumber` by field name — removing the field from `Card.java` and `CardDTO.java` (backend) is sufficient.
- **Login hook**: `LoginPageComponent` is the hook point (not `AuthService`) to avoid circular DI. `loadAll()` in `connect()` success handler; `resetMap()` in `ngOnInit()`.

## Implementation Plan

### Tasks

**Phase 1 — Backend**

- [ ] Task 1: Create Flyway V009 migration
  - File: `back/src/main/resources/db/migration/flyway/V009__card_user_possessed.sql`
  - Action: Create new file with the following SQL:
    ```sql
    ALTER TABLE card DROP COLUMN IF EXISTS possessed_number;
    CREATE TABLE card_user_possessed (
      id bigserial PRIMARY KEY,
      card_id bigint NOT NULL REFERENCES card(id),
      user_id bigint NOT NULL REFERENCES app_user(id),
      possessed_number int NOT NULL DEFAULT 1,
      CONSTRAINT uq_card_user_possessed UNIQUE (card_id, user_id)
    );
    ```
  - Notes: `DROP COLUMN IF EXISTS` is safe if V008 already ran. No data migration needed (confirmed by Axel).

- [ ] Task 2: Remove `possessedNumber` from `Card` entity
  - File: `back/src/main/java/com/skytrix/model/entity/Card.java`
  - Action: Delete the `possessedNumber` field (line 59) and its `@Column` annotation. Remove any getter/setter for it if they exist.
  - Notes: MapStruct auto-mapping will automatically stop mapping this field once it is removed from the entity.

- [ ] Task 3: Remove `possessedNumber` from `CardDTO`
  - File: `back/src/main/java/com/skytrix/model/dto/card/CardDTO.java`
  - Action: Delete the `possessedNumber` field (line 32). No mapper change needed.
  - Notes: Removing from both entity and DTO is sufficient — MapStruct will no longer generate mapping code for it.

- [ ] Task 4: Create `CardUserPossessed` entity
  - File: `back/src/main/java/com/skytrix/model/entity/CardUserPossessed.java` (CREATE)
  - Action: Create a new JPA entity class:
    ```java
    @Entity
    @Table(name = "card_user_possessed")
    public class CardUserPossessed {
        @Id
        @GeneratedValue(strategy = GenerationType.IDENTITY)
        private Long id;

        @ManyToOne
        @JoinColumn(name = "card_id", nullable = false)
        private Card card;

        @ManyToOne
        @JoinColumn(name = "user_id", nullable = false)
        private User user;

        @Column(name = "possessed_number", nullable = false)
        private int possessedNumber;

        // getters + setters
    }
    ```
  - Notes: Follow the existing entity pattern (same package as `Card.java`). Use Jakarta annotations (`@Entity`, `@Table`, `@Column`, `@ManyToOne`, `@JoinColumn`, `@Id`, `@GeneratedValue`).

- [ ] Task 5: Create `CardUserPossessedRepository`
  - File: `back/src/main/java/com/skytrix/repository/CardUserPossessedRepository.java` (CREATE)
  - Action: Create a Spring Data JPA repository interface:
    ```java
    public interface CardUserPossessedRepository extends CrudRepository<CardUserPossessed, Long> {
        Optional<CardUserPossessed> findByCardIdAndUserId(Long cardId, Long userId);
        List<CardUserPossessed> findAllByUserId(Long userId);
    }
    ```
  - Notes: Place in the same package as other repositories. Import `Optional` and `List`.

- [ ] Task 6: Refactor `CardService` — replace possessed logic
  - File: `back/src/main/java/com/skytrix/service/CardService.java`
  - Action:
    1. Inject `CardUserPossessedRepository` and `CardRepository` (via `@Inject`)
    2. Replace `updatePossessedNumber(Long cardId, Integer number)` (lines 64-67) with a new upsert method:
       - `cardRepository.findById(cardId)` → throw `ResponseStatusException(HttpStatus.NOT_FOUND)` if absent
       - `repository.findByCardIdAndUserId(cardId, userId)` → if present and `number > 0`: update `possessedNumber` + save; if present and `number == 0`: delete; if absent and `number > 0`: create new entity + save; if absent and `number == 0`: no-op
    3. Add `getPossessedMap(Long userId)`: call `repository.findAllByUserId(userId)` → collect to `Map<Long, Integer>` (key = `cardId`, value = `possessedNumber`)
  - Notes: New method signature: `updatePossessedNumber(Long cardId, Long userId, Integer number)`. Controller passes `authService.getConnectedUserId()` for `userId`.

- [ ] Task 7: Update `CardController` — add GET and fix PUT
  - File: `back/src/main/java/com/skytrix/controller/CardController.java`
  - Action:
    1. Add `@GetMapping("/possessed")` endpoint:
       ```java
       @GetMapping("/possessed")
       public Map<Long, Integer> getPossessedCards() {
           return cardService.getPossessedMap(authService.getConnectedUserId());
       }
       ```
    2. Update existing `PUT /possessed/{cardId}` (lines 47-51) to pass `authService.getConnectedUserId()` to the refactored service method:
       ```java
       @PutMapping("/possessed/{cardId}")
       public void updatePossessedNumber(@PathVariable Long cardId, @RequestParam Integer number) {
           cardService.updatePossessedNumber(cardId, authService.getConnectedUserId(), number);
       }
       ```
    3. Add `@GetMapping` import if not already present; add `Map` import.
  - Notes: `authService` is already injected in `CardController`. Both endpoints remain under `/api/cards`.

**Phase 2 — Frontend**

- [ ] Task 8: Refactor `OwnedCardService`
  - File: `front/src/app/services/owned-card.service.ts`
  - Action: Full rewrite of the service:
    1. Remove: `BehaviorSubject`, `shortOwnedCards$` observable, `shortOwnedCards` getter/setter, `getAllShort()`, `findOwnedCardBySetId()`, `update()`, constructor auto-load
    2. Add private/public signal pair (avoid naming collision):
       ```typescript
       private readonly _ownedMap = signal<Map<number, number>>(new Map());
       readonly ownedMap = this._ownedMap.asReadonly();
       ```
    3. Add `loadAll()`:
       ```typescript
       loadAll(): void {
         this.httpClient.get<Record<string, number>>('/api/cards/possessed')
           .pipe(take(1))
           .subscribe(res => {
             this._ownedMap.set(new Map(Object.entries(res).map(([k, v]) => [+k, v])));
           });
       }
       ```
    4. Add `resetMap()`:
       ```typescript
       resetMap(): void {
         this._ownedMap.set(new Map());
       }
       ```
    5. Add `updateOwned(cardId: number, newCount: number)`:
       ```typescript
       updateOwned(cardId: number, newCount: number): void {
         const current = new Map(this._ownedMap());
         if (newCount === 0) {
           current.delete(cardId);
         } else {
           current.set(cardId, newCount);
         }
         this._ownedMap.set(current); // optimistic update
         this.httpClient.put(`/api/cards/possessed/${cardId}`, null, { params: { number: newCount } })
           .pipe(take(1))
           .subscribe();
       }
       ```
  - Notes: Import `signal` from `@angular/core`, `take` from `rxjs/operators`, `HttpClient` from `@angular/common/http`. Remove `BehaviorSubject` import.

- [ ] Task 9: Update `LoginPageComponent` — hook `loadAll` and `resetMap`
  - File: `front/src/app/pages/login-page/login-page.component.ts`
  - Action:
    1. Inject `OwnedCardService` (add to constructor)
    2. In `connect()` success handler, after `this.authService.setUser(res.body!)`, add: `this.ownedCardService.loadAll();`
    3. In `ngOnInit()`, after `this.authService.resetLogin()`, add: `this.ownedCardService.resetMap();`
    4. Add `OwnedCardService` import
  - Notes: `connect()` is at line 95. `ngOnInit()` is at line 76. Do not move or restructure surrounding code.

- [ ] Task 10: Update `CardListComponent` — remove pipe, keep AsyncPipe
  - File: `front/src/app/components/card-list/card-list.component.ts`
  - Action: Remove `FindGroupedOwnedCardPipe` from the `imports` array. Do NOT remove `AsyncPipe` — it is still used for `cardsDetails$() | async` in the template.
  - Notes: Remove the import line for `FindGroupedOwnedCardPipe` as well. `OwnedCardService` injection stays (used directly in template).

- [ ] Task 11: Update `card-list.component.html` — replace pipe chain with signal lookup
  - File: `front/src/app/components/card-list/card-list.component.html`
  - Action: Replace line 28:
    - Before: `@if (ownedCardService.shortOwnedCards$ | async | findGroupedOwnedCard: cd; as count) {`
    - After: `@if (ownedCardService.ownedMap().get(cd.card.id); as count) {`
  - Notes: The `@if` block and inner `@if (count > 0)` remain unchanged. Only the signal expression changes.

- [ ] Task 12: Update `DeckBuilderComponent` — replace owned card logic
  - File: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts`
  - Action:
    1. Remove `ShortOwnedCardDTO` import
    2. Remove only the `shortOwnedCards = toSignal(ownedCardService.shortOwnedCards$, ...)` line — keep `toSignal` import (still used for `isMobilePortrait`, `isLandscapeSplit`, `isCompactHeight` breakpoint signals)
    3. Replace `selectedCardOwnedCount` computed with:
       ```typescript
       readonly selectedCardOwnedCount = computed(() => {
         const cd = this.selectedCardDetail();
         if (!cd || cd.card.id == null) return undefined; // no card selected → hides +/- buttons
         return this.ownedCardService.ownedMap().get(cd.card.id) ?? 0; // 0 = not possessed → shows +/- at 0
       });
       ```
    4. Update `onOwnedCountChange` to call: `this.ownedCardService.updateOwned(cd.card.id!, newCount)`
  - Notes: `undefined` hides the +/- buttons; `0` shows them at zero (card selected but not possessed). Do not remove the `toSignal` import.

- [ ] Task 13: Update `CardSearchPageComponent` — same changes as Task 12
  - File: `front/src/app/pages/card-search-page/card-search-page.component.ts`
  - Action: Apply the identical set of changes as Task 12:
    1. Remove `ShortOwnedCardDTO` import
    2. Remove `shortOwnedCards = toSignal(...)` line; keep `toSignal` import
    3. Replace `selectedCardOwnedCount` computed (same code as Task 12)
    4. Update `onOwnedCountChange` to call `this.ownedCardService.updateOwned(cd.card.id!, newCount)`
  - Notes: `toSignal` stays — used for breakpoint signals in this component too.

- [ ] Task 14: Delete obsolete files
  - Files to delete:
    - `front/src/app/core/pipes/find-grouped-owned-card.ts`
    - `front/src/app/core/pipes/find-owned-card.pipe.ts` (orphaned, 0 usages)
    - `front/src/app/core/model/dto/short-owned-card-dto.ts`
    - `front/src/app/core/model/dto/owned-card-dto.ts`
    - `front/src/app/core/model/dto/update-owned-card-dto.ts`
  - Action: Delete all 5 files. Verify no remaining imports reference these paths before deleting.
  - Notes: `find-owned-card.pipe.ts` was confirmed orphaned (0 usages) in Step 2 grep. The 3 DTO files are used only by the old service and pipes being replaced/deleted.

### Acceptance Criteria

- [ ] AC 1: Given a logged-in user with possessed cards, when `GET /api/cards/possessed` is called, then a JSON object `{"<cardId>": count, ...}` is returned containing only that user's data (other users' data absent).

- [ ] AC 2: Given a logged-in user, when `PUT /api/cards/possessed/{cardId}?number=5` is called with a valid card ID, then the `card_user_possessed` row is upserted and a subsequent `GET /api/cards/possessed` returns `{"<cardId>": 5}`.

- [ ] AC 3: Given a user with a possessed card (count > 0), when `PUT /api/cards/possessed/{cardId}?number=0` is called, then the row is deleted and the card no longer appears in `GET /api/cards/possessed`.

- [ ] AC 4: Given any logged-in user, when `PUT /api/cards/possessed/99999?number=1` is called with a non-existent card ID, then the API returns HTTP 404.

- [ ] AC 5: Given the database is migrated with V009, when queried, then the `card` table has no `possessed_number` column, and the `card_user_possessed` table exists with a `UNIQUE (card_id, user_id)` constraint.

- [ ] AC 6: Given a user successfully logs in, when `LoginPageComponent.connect()` completes, then `OwnedCardService.loadAll()` is called and `ownedMap()` signal is populated with the user's possessed counts.

- [ ] AC 7: Given the user navigates to the login page (post-logout), when `LoginPageComponent.ngOnInit()` runs, then `OwnedCardService.resetMap()` is called and `ownedMap()` returns an empty Map.

- [ ] AC 8: Given `ownedMap()` contains `{cardId: 3}`, when the card-list renders in deck-build mode, then the owned badge shows `3` on that card.

- [ ] AC 9: Given a card with `cardId=X` is selected in the inspector and `ownedMap()` has no entry for `X`, when `selectedCardOwnedCount()` is evaluated, then it returns `0` (showing +/- buttons at zero, not hiding them).

- [ ] AC 10: Given a card is selected and the user clicks `+`, when `updateOwned(cardId, newCount)` is called, then `ownedMap()` reflects the new count immediately (optimistic update) without waiting for the API response.

- [ ] AC 11: Given the frontend is built after Task 14 deletions, when `ng build` runs, then there are zero compilation errors (no dangling imports referencing deleted files).

## Additional Context

### Dependencies

- Flyway V008 has already run on the OVH server — V009 migration must: (1) drop `possessed_number` column from `card`, (2) create `card_user_possessed(id, card_id, user_id, possessed_number)` with FK constraints and unique index on `(card_id, user_id)`. **No data migration needed.**
- `CardUserPossessed` entity follows the same JPA pattern as the old `CardPossessed` (was: `card_set_id + user_id + number`).
- Angular `@angular/core` signals API must be imported: `signal`, `computed` (already used in project).
- `take` from `rxjs/operators` must be imported in the refactored service.

### Testing Strategy

**Manual Testing (primary — no existing automated test suite):**

1. Start backend with V009 migration — verify startup logs show V009 applied successfully
2. Open DB client: confirm `card` table has no `possessed_number` column; confirm `card_user_possessed` table exists with correct schema
3. Login as User A → verify network tab shows `GET /api/cards/possessed` called → response is `{}` or existing data
4. In card list (deck-build mode): click `+` on a card → verify badge appears with count `1`; verify `PUT /api/cards/possessed/{cardId}?number=1` fires in network tab
5. Click `+` again → badge shows `2`; click `-` to `0` → badge disappears; verify DELETE behavior via `GET /api/cards/possessed`
6. Login as User B → verify User B sees empty map (not User A's data)
7. Logout and re-login as User A → verify badges reappear (map reloaded correctly)
8. Navigate away and back to login page → verify `resetMap()` clears state (no stale data after logout)
9. Run `ng build` → zero compilation errors

**Build Verification:**
- `ng build` must complete with zero errors after all 14 tasks are done (AC 11)
- Backend: `./mvnw compile` must complete without errors after entity/DTO field removal

**Risk Areas to Test Manually:**
- Optimistic update rollback is NOT implemented — if PUT fails silently, the signal and DB will be out of sync; verify happy path only for now
- `AsyncPipe` in `card-list.component.html` must not be accidentally removed (compilation guard)

### Notes

- The old `CardPossessed` files were already deleted in a previous session (entity, repository, service, controller, DTOs). V008 migration dropped the old table and erroneously added `possessed_number` column to `card`.
- **Data migration decision (Party Mode, 2026-02-24):** Axel confirmed — no need to preserve existing possessed card data. V009 starts fresh.
- **N+1 decision (Party Mode, Winston):** Resolved — frontend handles bulk load, no per-card backend queries.
- **CardInspectorComponent**: Requires NO changes. It receives `ownedCount` as `model()` input from parent. Parents (`DeckBuilderComponent`, `CardSearchPageComponent`) pass `selectedCardOwnedCount()` and listen to `(ownedCountChange)`.
- **CardMapper**: Requires NO changes. MapStruct auto-maps `possessedNumber` by name — removing from entity + DTO is sufficient.
- **Step 2 grep confirmed:** Only 3 components use `OwnedCardService` (CardListComponent, DeckBuilderComponent, CardSearchPageComponent) + LoginPageComponent will be updated. No other components found.
- **High-risk item:** `AsyncPipe` must remain in `card-list.component.ts` imports — it is used for `cardsDetails$() | async`, not just the owned card pipe.
- **High-risk item:** `toSignal` import must remain in DeckBuilder and CardSearchPage — used for 3 breakpoint observables in each component.
- **Future consideration:** Optimistic update rollback (revert signal on API error) — not in scope for this spec.
