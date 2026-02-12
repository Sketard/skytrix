# Story 1.3: Load Deck, Shuffle & Draw Initial Hand

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want my deck to be automatically loaded, shuffled, and dealt when I enter the simulator,
so that I can immediately start testing combos without manual setup.

## Acceptance Criteria

1. **Given** the simulator page loads with a valid deck ID,
   **When** deck data is fetched from the existing deck service,
   **Then** main deck cards populate the Deck zone and extra deck cards populate the ED zone,
   **And** card count badges update reactively (e.g., Deck: 40, ED: 15).

2. **Given** the deck is loaded,
   **When** initialization completes,
   **Then** the main deck is shuffled (client-side Fisher-Yates randomization),
   **And** 5 cards are drawn from the top to the hand zone, displayed face-up via SimCardComponent,
   **And** Deck badge decrements (e.g., 40 → 35).

3. **Given** a deck ID that returns 404 from the API,
   **When** the simulator tries to load,
   **Then** the player is redirected to the deck list page (`/decks`).

4. **Given** a deck with 0 main deck cards (ED only),
   **When** the simulator loads,
   **Then** the board renders with Deck: 0, ED populated, hand empty — no error.

## Tasks / Subtasks

- [x] **Task 1: Add `initializeBoard()` method to BoardStateService** (AC: 1, 2, 4)
  - [x] 1.1: Create private `convertToCardInstances(cards: IndexedCardDetail[]): CardInstance[]` method — filters empty slots (`index !== -1`), maps each `IndexedCardDetail` to a `CardInstance` (see Data Conversion Guide below)
  - [x] 1.2: Create private `shuffle(cards: CardInstance[]): CardInstance[]` method — Fisher-Yates algorithm on a shallow copy, returns new array
  - [x] 1.3: Create public `initializeBoard(deck: Deck): void` method — converts main+extra deck, shuffles main deck, draws up to 5 from top to hand, sets boardState signal
  - [x] 1.4: Verify that computed signals (`mainDeck`, `extraDeck`, `hand`, `isDeckEmpty`) update reactively after `boardState.set()`
  - [x] 1.5: Handle edge case: deck with 0 main deck cards — skip shuffle and draw, set Deck: 0, hand empty

- [x] **Task 2: Add deck loading to SimulatorPageComponent** (AC: 1, 3)
  - [x] 2.1: Inject `DeckBuildService` (root-provided), `BoardStateService` (scoped), and `Router`
  - [x] 2.2: Add deck loading Observable chain in constructor: `route.paramMap → map → filter → switchMap(getById) → boardState.initializeBoard()`
  - [x] 2.3: Handle HTTP error (404 or other) → `router.navigate(['/decks'])`
  - [x] 2.4: Use `takeUntilDestroyed()` for automatic cleanup (must be called in constructor injection context)

- [x] **Task 3: Verify build and visual check** (AC: all)
  - [x] 3.1: Run `ng build --configuration development` — must pass with zero errors
  - [x] 3.2: Run `ng serve` → navigate to `/decks/:id/simulator` with a valid deck → verify cards appear in hand (face-up), deck badge decrements (e.g., 40 → 35)
  - [x] 3.3: Navigate with invalid deck ID → verify redirect to `/decks`

## Dev Notes

### Critical Architecture Constraints

- **Initialization is NOT a command.** `initializeBoard()` directly calls `boardState.set()` — bypasses CommandStackService entirely. This is the same pattern as Reset (Story 5.2). The undo/redo stacks start empty (service freshly created) and are NOT involved in initialization. [Source: architecture.md#Reset Behavior]
- **Zero direct board state mutation from components.** `SimulatorPageComponent` calls `boardState.initializeBoard(deck)` — this is the ONE allowed exception where a component triggers a direct state mutation, because initialization is not a command. All future state changes (Stories 2+) go through CommandStackService. [Source: architecture.md#Action Flow Pattern]
- **Services scoped to SimulatorPageComponent.** `BoardStateService` and `CommandStackService` are freshly created each time the simulator loads. No cleanup of previous state needed. [Source: architecture.md#Service Scoping Decision]
- **Top of deck = last element in array.** Convention established in Story 1.2: `topCard = cards[cards.length - 1]`. Drawing from the top means taking from the END of the array. [Source: 1-2-render-18-zone-board-with-components.md#SimStackedZoneComponent]
- **`DeckBuildService` is root-provided (singleton).** The simulator only READS from it via `getById()`. Do NOT call `initDeck()` or mutate `deckState` — the simulator has its own `BoardStateService` for state management. [Source: deck-build.service.ts]
- **`DeckBuildService.getById()` already uses `take(1)`.** The observable completes after one emission. Combined with `switchMap`, this handles rapid navigation gracefully. [Source: deck-build.service.ts:91-96]

### Data Conversion Guide (IndexedCardDetail → CardInstance)

**CRITICAL: The Deck model uses fixed-size arrays with empty slots.** `Deck.mainDeck` is a 60-element array where empty slots have `index === -1` and `card.card.id` is undefined. You MUST filter before converting:

```typescript
// CORRECT: Filter empty slots first
const realCards = deck.mainDeck.filter(slot => slot.index !== -1);

// WRONG: Do not use the array directly — contains 60 slots with empties!
const broken = deck.mainDeck.map(...); // ← Creates CardInstances for empty slots!
```

**The `cleanSlots()` method in Deck is private.** You cannot call `deck.cleanSlots()`. Filter manually: `deck.mainDeck.filter(slot => slot.index !== -1)`.

**Conversion mapping:**

| `IndexedCardDetail` field | → | `CardInstance` field | Notes |
|---|---|---|---|
| `id` | → | `instanceId` | Cast to string: `String(icd.id)`. `IndexedCardDetail.id` is `number` (Uint32), `CardInstance.instanceId` is `string`. |
| `card` | → | `card` | Direct reference: `icd.card` (CardDetail object) |
| `card.images[0]` | → | `image` | First image from the CardDetail's images array. This is the primary card image (`smallUrl` for board rendering, `url` for inspector in Story 3.2). |
| _(default)_ | → | `faceDown` | `false` — all cards start face-up |
| _(default)_ | → | `position` | `'ATK'` — all cards start in ATK position |
| _(omit)_ | → | `overlayMaterials` | `undefined` — no XYZ materials at initialization |

### Fisher-Yates Shuffle Implementation

The existing `Deck.getRandomMainCards()` uses `sort(() => Math.random() - 0.5)` — this is NOT a proper Fisher-Yates shuffle and produces biased results. Implement proper Fisher-Yates in BoardStateService:

```typescript
private shuffle(cards: CardInstance[]): CardInstance[] {
  const shuffled = [...cards]; // Shallow copy — immutable pattern
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
```

This produces an unbiased random permutation in O(n) time. Returns a new array (immutable update pattern consistent with signal-based state).

### initializeBoard() Implementation Guide

```typescript
// In BoardStateService — add public method
initializeBoard(deck: Deck): void {
  // 1. Convert to CardInstance arrays, filtering empty slots
  const mainDeckCards = this.convertToCardInstances(
    deck.mainDeck.filter(slot => slot.index !== -1)
  );
  const extraDeckCards = this.convertToCardInstances(
    deck.extraDeck.filter(slot => slot.index !== -1)
  );

  // 2. Shuffle main deck (Fisher-Yates)
  const shuffledMain = this.shuffle(mainDeckCards);

  // 3. Draw up to 5 from top (last N elements) → hand
  const drawCount = Math.min(5, shuffledMain.length);
  const handCards = shuffledMain.slice(shuffledMain.length - drawCount);
  const remainingDeck = shuffledMain.slice(0, shuffledMain.length - drawCount);

  // 4. Set board state (reuse existing createEmptyBoard function)
  const state = createEmptyBoard();
  state[ZoneId.MAIN_DECK] = remainingDeck;
  state[ZoneId.EXTRA_DECK] = extraDeckCards;
  state[ZoneId.HAND] = handCards;
  this.boardState.set(state);
}

private convertToCardInstances(cards: IndexedCardDetail[]): CardInstance[] {
  return cards.map(icd => ({
    instanceId: String(icd.id),
    card: icd.card,
    image: icd.card.images[0],
    faceDown: false,
    position: 'ATK' as const,
  }));
}
```

**Key notes:**
- `createEmptyBoard()` already exists as a module-level function at the top of `board-state.service.ts` (line 4). Reuse it — do NOT duplicate.
- Drawing from "top" = taking from the END of the array (array convention: last element = top of stack).
- `Math.min(5, shuffledMain.length)` handles decks with fewer than 5 cards.
- Extra deck cards are NOT shuffled (game rule: extra deck order doesn't matter for this simulator but keeping original order is fine).

### Deck Loading Flow (SimulatorPageComponent)

**Recommended implementation pattern:**

```typescript
// In SimulatorPageComponent constructor — add deck loading chain
constructor() {
  const route = inject(ActivatedRoute);
  const deckBuildService = inject(DeckBuildService);
  const boardState = inject(BoardStateService);
  const router = inject(Router);

  // Keep existing deckId signal for potential future use (reset, etc.)
  this.deckId = toSignal(
    route.paramMap.pipe(map(params => Number(params.get('id')) || 0)),
    { initialValue: 0 }
  );

  // Deck loading — separate observable chain for the side effect
  route.paramMap.pipe(
    map(params => Number(params.get('id')) || 0),
    filter(id => id > 0),
    switchMap(id => deckBuildService.getById(id)),
    takeUntilDestroyed(),
  ).subscribe({
    next: (deck) => boardState.initializeBoard(deck),
    error: () => router.navigate(['/decks']),
  });
}
```

**Key decisions:**
- Keep existing `deckId` signal (useful for future operations like reset reload in Story 5.2)
- Add a SEPARATE observable chain for the fetch+init side effect — do not reuse the `toSignal` observable
- `takeUntilDestroyed()` auto-cleans the subscription on component destruction — MUST be called in the constructor (injection context)
- `filter(id => id > 0)` prevents fetch with invalid/missing ID
- `switchMap` cancels previous fetch if route params change (handles rapid navigation)
- Error handler navigates to `/decks` on ANY HTTP error (404, 500, network failure) — no distinction needed for MVP
- The existing constructor parameter `private readonly route: ActivatedRoute` should be converted to `inject()` pattern for consistency with the new injections

### Existing Code Integration Points

- **`DeckBuildService.getById(id: number): Observable<Deck>`** — HTTP GET `/api/decks/:id`. Returns `Deck` constructed from `DeckDTO`. Already uses `take(1)` internally. On 404, the HTTP client emits an error observable. [Source: `front/src/app/services/deck-build.service.ts:91-96`]
- **`Deck.mainDeck: Array<IndexedCardDetail>`** — Fixed-size array of 60 slots. Empty slots: `index === -1`, `card.card.id` is undefined. [Source: `front/src/app/core/model/deck.ts:13`]
- **`Deck.extraDeck: Array<IndexedCardDetail>`** — Fixed-size array of 15 slots. Same empty slot pattern. [Source: `front/src/app/core/model/deck.ts:14`]
- **`IndexedCardDetail`** — `{ card: CardDetail, index: number, id: number }`. `id` is a random `Uint32` generated at construction time via `generateRandomId()`. Unique per card slot instance. [Source: `front/src/app/core/model/card-detail.ts:22-31`]
- **`CardDetail.images: Array<CardImageDTO>`** — Array of card images. `images[0]` is the primary image. Has `.url` (full res) and `.smallUrl` (thumbnail for board rendering). [Source: `front/src/app/core/model/card-detail.ts:11`]
- **`boardState.set()`** — Direct signal set. Triggers all 18 computed signals to re-evaluate. Components with OnPush re-render reactively. [Source: `front/src/app/pages/simulator/board-state.service.ts:29`]
- **`createEmptyBoard()`** — Module-level function in `board-state.service.ts` (line 4-25). Returns `Record<ZoneId, CardInstance[]>` with empty arrays for all 18 zones. Already exists — reuse it. [Source: `front/src/app/pages/simulator/board-state.service.ts:4-25`]
- **`CardInstance` interface** — `{ instanceId: string, card: CardDetail, image: CardImageDTO, faceDown: boolean, position: 'ATK' | 'DEF', overlayMaterials?: CardInstance[] }`. [Source: `front/src/app/pages/simulator/simulator.models.ts:25-32`]
- **Routes** — Error redirect target: `/decks` → `DeckPageComponent` (deck list). [Source: `front/src/app/app.routes.ts:13`]

### Imports Needed

**SimulatorPageComponent (new imports to add):**
```typescript
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs'; // map already imported
import { DeckBuildService } from '../../services/deck-build.service';
import { BoardStateService } from './board-state.service';
```

**BoardStateService (new imports to add):**
```typescript
import { Deck } from '../../core/model/deck';
import { IndexedCardDetail } from '../../core/model/card-detail';
```

### What This Story Does NOT Include

- **No drag & drop** (Story 2.2) — no CDK DragDrop infrastructure, no `cdkDrag`, no `cdkDropList`
- **No commands** (Story 2.1) — no command classes, no `CommandStackService` methods beyond empty shell
- **No context menus** (Stories 2.3, 3.1) — no right-click behavior
- **No card inspector** (Story 3.2) — no hover behavior, no `hoveredCard` signal consumption
- **No pile overlays** (Story 4.1) — no stacked zone click behavior
- **No control bar** (Story 5.1) — placeholder div remains in controls grid area
- **No loading spinner or indicator** — the empty board IS the loading state per UX spec ("Board zones render immediately (empty state) — cards populate once data arrives"). The fetch is fast enough that the brief empty board is acceptable.
- **No shuffle animation** — cards appear instantly in their final positions
- **No `prefers-reduced-motion` support** — no animations to suppress yet (added in Story 2.2)
- **No draw button or draw-one interaction** — Story 2.3 adds draw capability. This story only handles the INITIAL 5-card draw during board initialization.

### Previous Story Intelligence (Story 1.2)

**Established Patterns to Follow:**
- SCSS import pattern: `@use 'sim-tokens' as *` (not `@import`) — Dart Sass 2.0 compliance
- Route param extraction: `toSignal()` with `map()` for Observable-to-Signal bridge (already in place)
- Service pattern: `@Injectable()` without `providedIn`, provided at component level
- Signal pattern: `boardState` is public writable (initialization calls `.set()`), but components only read via computed
- `createEmptyBoard()` module-level function exists in `board-state.service.ts` — reuse, don't duplicate

**Files Modified by Story 1.2 (context for dependency):**
- `sim-card.component.ts/html/scss` — already renders cards based on `CardInstance` input (face-up image via `cardInstance().image.smallUrl`, face-down via CSS card back)
- `stacked-zone.component.ts` — `displayCard` computed handles face-down override for Deck/ED, `cardCount` computed for badge
- `hand.component.ts` — reads from `boardState.hand()` computed signal, renders cards via `@for` with `track card.instanceId`
- `_sim-tokens.scss` — fully populated with all design tokens

**Story 1.2 Debug Learnings:**
- Fixed Sass deprecation: `59 / 86` → `list.slash(59, 86)` for card aspect ratio
- Removed unused SimCardComponent import from SimBoardComponent (board doesn't render cards directly)
- Added `displayCard` computed in SimStackedZoneComponent to avoid object spread in template

**Build Notes:**
- `ng build --configuration development` passes after Story 1.2 with zero errors and zero warnings
- Production build has pre-existing bundle budget warnings (jspdf/canvg) — unrelated to simulator

### Edge Cases

- **Deck with 0 main deck cards (ED only)** — `filter(slot => slot.index !== -1)` returns empty array, shuffle returns empty, `Math.min(5, 0)` = 0 cards drawn, hand stays empty. Board renders: Deck: 0, ED: N, Hand: dashed border (empty). No error.
- **Deck with < 5 main deck cards** — `Math.min(5, actualCount)` cards drawn. E.g., 3-card deck: draw 3, Deck: 0, Hand: 3 cards.
- **Card with empty images array** — `icd.card.images[0]` would be `undefined`. In practice, all cards from the API have at least one image. No defensive code needed per "big bang, no tests" approach. If this crashes, the data is bad upstream.
- **deckId = 0 (invalid route param)** — Filtered by `filter(id => id > 0)` in the observable chain. No fetch triggered. Board stays empty.
- **Network error (non-404)** — Same error handler: redirect to `/decks`. No distinction needed between 404, 500, or network failures for MVP.
- **Rapid navigation (double-click "Tester")** — `switchMap` cancels previous fetch. `takeUntilDestroyed()` cleans up on component destruction. No race condition or memory leak.
- **Navigate to simulator, then back, then to simulator again** — Fresh `SimulatorPageComponent` + fresh `BoardStateService` created each time (scoped providers). Clean state guaranteed.

### Project Structure Notes

**No new files created by this story.**

Files modified by this story:
```
front/src/app/pages/simulator/
  simulator-page.component.ts    # MODIFIED — add deck loading logic (inject DeckBuildService, Router; add Observable chain)
  board-state.service.ts          # MODIFIED — add initializeBoard(), shuffle(), convertToCardInstances()
```

### References

- [Source: architecture.md#Data Architecture] — Board state model: `Record<ZoneId, CardInstance[]>`, zone-centric
- [Source: architecture.md#Core Architectural Decisions] — Reset is NOT a command; initialization bypasses CommandStackService
- [Source: architecture.md#Service Responsibility Boundaries] — BoardStateService owns deck operations (shuffle, draw logic)
- [Source: architecture.md#Action Flow Pattern] — Zero direct board state mutation (except init/reset)
- [Source: architecture.md#Data Flow] — DeckBuildService → SimulatorPage → BoardStateService
- [Source: architecture.md#Service Scoping Decision] — Services provided via component-level `providers`
- [Source: ux-design-specification.md#Loading & Empty State Patterns] — Board renders empty immediately, cards populate on load
- [Source: ux-design-specification.md#User Journey Flows — Journey 1] — Auto: shuffle + draw 5 to hand
- [Source: epics.md#Story 1.3] — Acceptance criteria, user story
- [Source: front/src/app/services/deck-build.service.ts:91-96] — `getById()` implementation
- [Source: front/src/app/core/model/deck.ts:13-14] — Deck mainDeck/extraDeck fixed-size arrays
- [Source: front/src/app/core/model/deck.ts:248-250] — `cleanSlots()` is private
- [Source: front/src/app/core/model/card-detail.ts:22-31] — IndexedCardDetail with random numeric id
- [Source: front/src/app/core/utilities/functions.ts:6-11] — `generateRandomId()` returns Uint32
- [Source: front/src/app/pages/simulator/board-state.service.ts:4-25] — `createEmptyBoard()` module-level function
- [Source: front/src/app/pages/simulator/simulator.models.ts:25-32] — `CardInstance` interface
- [Source: front/src/app/app.routes.ts:13] — `/decks` route for error redirect
- [Source: 1-2-render-18-zone-board-with-components.md] — Previous story patterns and debug learnings

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build passed on first attempt with zero errors (ng build --configuration development)

### Completion Notes List

- **Task 1 Complete:** Added `initializeBoard()`, `convertToCardInstances()`, and `shuffle()` methods to BoardStateService. Fisher-Yates shuffle implemented per spec (O(n), unbiased). Empty slot filtering (`index !== -1`) handles fixed-size Deck arrays. Edge case for 0 main deck cards handled via `Math.min(5, shuffledMain.length)`.
- **Task 2 Complete:** Refactored SimulatorPageComponent from constructor injection to `inject()` pattern. Added deck loading Observable chain: `route.paramMap → map → filter → switchMap(getById) → boardState.initializeBoard()`. Error handler redirects to `/decks`. `takeUntilDestroyed()` in constructor for auto-cleanup.
- **Task 3.1 Complete:** `ng build --configuration development` passes with zero errors.
- **Tasks 3.2 & 3.3 Complete:** Visual verification confirmed by user — cards appear in hand, badge decrements, invalid deck redirects to `/decks`.

### Implementation Plan

- Followed Dev Notes implementation guides exactly
- Converted constructor-based `ActivatedRoute` injection to `inject()` for consistency with new injections (Router, DeckBuildService, BoardStateService)
- Kept existing `deckId` signal for future use (reset/reload in Story 5.2)
- Added separate Observable chain for fetch+init side effect (not reusing toSignal observable)
- Top of deck = last element convention respected (slice from end for draw)

### File List

- `front/src/app/pages/simulator/board-state.service.ts` — NEW (untracked, created in Story 1.2): Added imports (Deck, IndexedCardDetail), added `initializeBoard()`, `convertToCardInstances()`, `shuffle()` methods. Review fix: `images[0]` fallback, `.update()` instead of `createEmptyBoard()` + `.set()`.
- `front/src/app/pages/simulator/simulator-page.component.ts` — NEW (untracked, created in Story 1.1): Added imports (inject, Router, takeUntilDestroyed, toObservable, catchError, EMPTY, filter, switchMap, DeckBuildService), refactored to inject() pattern, added deck loading Observable chain with error handling. Review fix: `catchError` inside `switchMap`, `toObservable(deckId)` to deduplicate paramMap subscription.

### Known UX Spec Divergence

- UX spec mentions "Brief loading indicator while deck data loads" in one section, but also states "Board zones render immediately (empty state) — cards populate once data arrives" in another. This story follows the latter: the empty board IS the loading state. No loading spinner implemented. Acceptable for MVP given fast API response times.

## Change Log

- **2026-02-10:** Implemented deck loading, Fisher-Yates shuffle, and initial 5-card draw. BoardStateService gains `initializeBoard(deck)` method. SimulatorPageComponent fetches deck via route param and initializes board state. Error redirect to `/decks` on HTTP failure.
- **2026-02-10 (Code Review):** Fixed 6 issues (1H, 2M, 3L). H1: `catchError` inside `switchMap` replaces `subscribe({ error })` to prevent observable chain death. M1: `images[0]` fallback prevents crash on missing card images. M2: `boardState.update()` replaces `createEmptyBoard() + set()` to preserve unchanged zone references. L1: `toObservable(deckId)` eliminates duplicate `route.paramMap` subscription. L2: Documented UX spec loading indicator divergence. L3: Corrected File List to reflect untracked (not MODIFIED) git state.
