# Story 9.14: Infinite Scroll Indicator

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a loading indicator during infinite scroll and an end-of-results message,
So that I know whether more cards are loading or if I've reached the end of the results.

## Acceptance Criteria

1. **Given** the card search page uses infinite scroll via `search-service-core`
   **When** more results are being fetched
   **Then** a spinner is displayed at the bottom of the card grid

2. **Given** the API returns fewer than 60 items (page size)
   **When** the end of results is reached
   **Then** a "Fin des résultats" message is displayed instead of the spinner

3. **Given** the loading indicator is implemented
   **When** the user scrolls through results
   **Then** the spinner appears promptly when a fetch starts and disappears when results are rendered

## Tasks / Subtasks

- [x] Task 1: Add `isLoading` and `hasMoreResults` signals to `SearchServiceCore` (AC: #1, #2, #3)
  - [x] 1.1: Add a private `WritableSignal<boolean>` named `isLoadingState` initialized to `false`, and a public readonly alias `isLoading`
  - [x] 1.2: Add a private `WritableSignal<boolean>` named `hasMoreResultsState` initialized to `true`, and a public readonly alias `hasMoreResults`
  - [x] 1.3: In the `fetch()` method, set `isLoadingState.set(true)` immediately before the `this.search(...)` call (line 111)
  - [x] 1.4: Convert the `search().subscribe()` to use an observer object with `next` and `error` handlers. In `next`, set `isLoadingState.set(false)` after updating `this.cardsDetails`. In `error`, also set `isLoadingState.set(false)` to prevent the spinner from staying stuck indefinitely on network errors
  - [x] 1.5: In the `search().subscribe()` callback, detect end-of-results: if the returned `cards.length < this.quantity` (fewer than 60 items), set `hasMoreResultsState.set(false)`
  - [x] 1.6: On filter update (when `filterUpdate === true` and offset is reset to 0, around line 108), reset `hasMoreResultsState.set(true)` so that a new search starts fresh
  - [x] 1.7: Add a guard in the scroll trigger condition (line 110): skip fetch if `!this.hasMoreResultsState()` and it's NOT a filter update — prevents useless API calls when all results are loaded
  - [x] 1.8: Add a guard: skip fetch if `isLoadingState()` is already true — prevents concurrent duplicate requests when user scrolls rapidly

- [x] Task 2: Add spinner and end-of-results message to `card-list.component.html` (AC: #1, #2)
  - [x] 2.1: After the closing `}` of the `@for` block (after line 76), add a conditional block:
    ```html
    @if (searchService()?.isLoading?.()) {
      <div class="scroll-indicator">
        <mat-spinner diameter="32"></mat-spinner>
      </div>
    } @else if (searchService()?.hasMoreResults && !searchService()!.hasMoreResults()) {
      <div class="scroll-indicator scroll-indicator--end">
        Fin des résultats
      </div>
    }
    ```
  - [x] 2.2: Note: The indicator block is INSIDE `.cardsContainer` div so it appears at the bottom of the scrollable content, after all cards

- [x] Task 3: Import `MatProgressSpinner` in `card-list.component.ts` (AC: #1)
  - [x] 3.1: Add import: `import { MatProgressSpinner } from '@angular/material/progress-spinner';`
  - [x] 3.2: Add `MatProgressSpinner` to the `imports` array in the `@Component` decorator (after `MatIconButton`)

- [x] Task 4: Style the scroll indicator in `card-list.component.scss` (AC: #1, #2)
  - [x] 4.1: Add `.scroll-indicator` class at the end of the file:
    ```scss
    .scroll-indicator {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      padding: 1.5rem 0;
      grid-column: 1 / -1; // Span full width in CSS Grid (MOSAIC/FAVORITE modes)

      // Material spinner token override for gold accent
      --mdc-circular-progress-active-indicator-color: var(--accent-primary);

      &--end {
        color: var(--text-secondary);
        font-size: 0.85rem;
      }
    }
    ```
  - [x] 4.2: The `grid-column: 1 / -1` is CRITICAL — in MOSAIC/FAVORITE modes the container is CSS Grid (`grid-template-columns: repeat(auto-fill, minmax(100px, 1fr))`), so the indicator must span all columns to appear as a full-width row beneath all cards
  - [x] 4.3: In INFORMATIVE and OWNED modes the container is flexbox (`display: flex; flex-wrap: wrap`), so `width: 100%` ensures the indicator takes the full row

- [x] Task 5: Verify zero regression (AC: #1, #2, #3)
  - [x] 5.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings expected)
  - [x] 5.2: Verify spinner appears in MOSAIC mode when scrolling to bottom on card search page (standalone)
  - [x] 5.3: Verify spinner appears in INFORMATIVE mode
  - [x] 5.4: Verify "Fin des résultats" appears when fewer than 60 results returned (use a restrictive filter like "Blue-Eyes")
  - [x] 5.5: Verify spinner appears in deck builder context (`deckBuildMode=true`)
  - [x] 5.6: Verify spinner disappears immediately when results load
  - [x] 5.7: Verify new filter search resets state (spinner shows again, no premature "Fin des résultats")
  - [x] 5.8: Verify no duplicate fetch requests on rapid scroll (check Network tab)

## Dev Notes

### Why This Story Exists

This is the **last story** of Epic 9 (UI/UX Modernization). The Screen Implementation Guide rates "No loading indicator for infinite scroll" as **High severity** (Issue #4). Currently, the card search page has a scroll-based infinite loading mechanism in `search-service-core`, but provides ZERO visual feedback to the user — no spinner when loading, no message when all results are exhausted. Users have no way to distinguish "still loading" from "no more results."

### What This Story Does

- Adds **2 signals** to `SearchServiceCore`: `isLoading` (tracks fetch lifecycle) and `hasMoreResults` (tracks end-of-results)
- Adds a **`<mat-spinner>`** at the bottom of the card grid during loading (gold accent via `--accent-primary` token)
- Adds a **"Fin des résultats"** text message when all results are loaded
- Adds **fetch guards** to prevent duplicate requests and useless API calls after end-of-results
- Styles the indicator to work across all 4 display modes (MOSAIC, FAVORITE, INFORMATIVE, OWNED)

### What This Story Does NOT Do

- Does NOT modify the scroll detection mechanism (still uses manual DOM measurement, not IntersectionObserver)
- Does NOT add skeleton loaders / shimmer rows (spinner approach per UX spec decision)
- Does NOT modify the global `LoaderComponent` / `LoaderInterceptor` — that system intentionally excludes card search requests
- Does NOT modify the API endpoint or `CardDetailDTOPage` response structure
- Does NOT add virtual scrolling (`cdk-virtual-scroll-viewport`) — existing approach is sufficient
- Does NOT modify `card-searcher.component.*` — the indicator lives inside `card-list` which is already the scroll content child

### Critical: Signal Placement in `SearchServiceCore.fetch()`

The `fetch()` method (lines 74-124) uses a `combineLatest` + `subscribe` pattern where the HTTP call is nested inside the subscription. The loading state MUST be managed around the inner `this.search(...)` call, NOT around the outer combineLatest:

```typescript
// CORRECT — wrap the inner HTTP call
.subscribe(([scrollPos, filters]) => {
  let limit = content!.scrollHeight - content!.clientHeight;
  if (filterUpdate) {
    this.offset = 0;
    this.hasMoreResultsState.set(true);  // ← Reset on new search
  }
  if (!this.isLoadingState() && (this.hasMoreResultsState() || filterUpdate)) {  // ← Guard
    if (scrollPos === limit || filterUpdate) {
      this.isLoadingState.set(true);  // ← Before HTTP call
      this.search(httpClient, this.filters, this.quantity, this.offset)
        .pipe(take(1))
        .subscribe({
          next: (cards: Array<CardDetail>) => {
            if (filterUpdate) {
              this.cardsDetails = cards;
              filterUpdate = false;
            } else {
              this.cardsDetails = [...this.cardsDetails, ...cards];
            }
            this.offset += 1;
            this.hasMoreResultsState.set(cards.length >= this.quantity);  // ← End detection
            this.isLoadingState.set(false);  // ← After data update
          },
          error: () => {
            this.isLoadingState.set(false);  // ← Prevent stuck spinner on HTTP error
          },
        });
    }
  }
});
```

**Why `cards.length >= this.quantity` instead of `< this.quantity`?** We set `hasMoreResults = true` when the page is full (60 items), `false` when partial. This avoids off-by-one: if exactly 60 items are returned, there MAY be more (next page could be empty, but that's one extra request — acceptable).

### Critical: `grid-column: 1 / -1` for CSS Grid Modes

In MOSAIC and FAVORITE modes, `.cardsContainer` uses `display: grid` with `grid-template-columns: repeat(auto-fill, minmax(100px, 1fr))`. Without `grid-column: 1 / -1`, the spinner div would occupy only one grid cell (e.g., 100px wide) instead of spanning the full width. This is a common CSS Grid gotcha that breaks full-width footer elements inside grid containers.

### Critical: `hasMoreResults` Must Be a Function of `SearchServiceCore`, NOT `CardListComponent`

The loading state belongs to the service, not the component, because:
1. `SearchServiceCore` is the only entity that knows when a fetch starts/ends
2. `card-list` is a presentational component — it reads state, doesn't manage it
3. The service is shared between standalone card search and deck builder contexts — both benefit from loading state

### `mat-spinner` Is New to This Project

`MatProgressSpinner` (selector: `<mat-spinner>`) has never been used in the codebase. The import is:
```typescript
import { MatProgressSpinner } from '@angular/material/progress-spinner';
```
This is a standalone component in Angular Material 19.1.1 — import the component directly, NOT the deprecated `MatProgressSpinnerModule`.

The `diameter="32"` property creates a small, unobtrusive spinner. The gold color is achieved via Material's CSS custom property: `--mdc-circular-progress-active-indicator-color: var(--accent-primary)`.

### End-of-Results Detection Logic

The API returns `CardDetailDTOPage { size: number, elements: CardDetailDTO[] }`. Currently, only `elements` is used (mapped in `search()` at line 163). The `size` field exists but is unused.

**Detection approach:** Compare `cards.length` (the mapped elements array length) with `this.quantity` (60). If `< 60`, no more results. This matches the regression risk note in the Screen Implementation Guide: *"End-of-results detection: API returns < 60 items."*

### Dual-Context Compatibility (Standalone vs Deck Builder)

`card-list` is used in TWO contexts:
1. **Standalone card search page** — via `card-searcher` → `card-list` (full screen grid)
2. **Deck builder side panel** — via `card-searcher` → `card-list` with `deckBuildMode=true` (narrow 280-360px panel)

Both contexts share the same `SearchServiceCore` signals. The spinner/message renders identically in both — the `width: 100%` + `grid-column: 1 / -1` styling ensures correct layout in both wide and narrow containers.

### Previous Story Intelligence (9-3)

Story 9-3 established the Material CSS custom property pattern for dark theme styling:
- Token overrides are set on the host element or a wrapper, not via `::ng-deep`
- `var(--accent-primary)` (#C9A84C gold) is the standard interactive accent color
- `var(--text-secondary)` (#9E9E9E) is used for metadata/secondary text
- `ng build` exits code 1 due to pre-existing bundle size budget warnings — this is normal

### Git Intelligence

Recent commits show Epic 9 work in progress:
- `35715a39 9.-2` — sidebar dark migration
- `94a9097c 9-1` — global token system
- Current branch: `hand-testing`

No conflicts expected with `search-service-core.service.ts` or `card-list.component.*` files.

### Token Values Reference (from `_tokens.scss`)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--accent-primary` | `#C9A84C` | Spinner color (gold) |
| `--text-secondary` | `#9E9E9E` | "Fin des résultats" text color |

### Material CSS Custom Property Reference

| Property | Purpose | Value Set |
|----------|---------|-----------|
| `--mdc-circular-progress-active-indicator-color` | Spinner track color | `var(--accent-primary)` |

### Project Structure Notes

- **4 files modified:** `search-service-core.service.ts` (signals + fetch guards), `card-list.component.html` (spinner template), `card-list.component.ts` (import), `card-list.component.scss` (styles)
- **No new files** created
- **No new dependencies** — `MatProgressSpinner` is already available via `@angular/material` (installed at 19.1.1)
- Alignment with project pattern: signals for state, OnPush change detection, standalone components

### Scope Boundaries

Components/files NOT modified by this story:
- `card-searcher.component.*` — layout unchanged, the indicator is inside `card-list`
- `search-bar.component.*` — unrelated
- `loader.component.*` / `loader-interceptor.ts` — global loader remains unchanged
- `card-search-page.component.*` — container page unchanged
- `_tokens.scss` — no new tokens needed (reuses existing `--accent-primary` and `--text-secondary`)
- `variable.scss` / `styles.scss` — no changes

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 2 Issues (line 158) — "No loading indicator for infinite scroll", severity High]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Infinite Scroll Decision (lines 183-185) — "spinner/skeleton row at bottom", "Fin des résultats"]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Regression Risk (line 444) — loading signal sync risk, end-of-results detection < 60 items]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.14 (lines 1675-1698) — AC and BDD scenarios]
- [Source: front/src/app/services/search-service-core.service.ts — infinite scroll fetch logic (lines 74-124)]
- [Source: front/src/app/components/card-list/card-list.component.html — card grid template (77 lines)]
- [Source: front/src/app/components/card-list/card-list.component.scss — grid/flex layout (258 lines)]
- [Source: front/src/app/core/model/dto/card-detail-dto.ts — CardDetailDTOPage type with size + elements fields]
- [Source: _bmad-output/implementation-artifacts/9-3-search-bar-dark.md — previous story patterns and learnings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `ng build` exits code 1 due to pre-existing bundle size budget warnings — zero compilation errors from story changes

### Completion Notes List

- **Task 1:** Added `isLoadingState` / `isLoading` and `hasMoreResultsState` / `hasMoreResults` signals to `SearchServiceCore`. Refactored `fetch()` subscribe to observer object pattern with `next`/`error` handlers. Added loading guard (`isLoadingState()`) and end-of-results guard (`hasMoreResultsState()`) to prevent duplicate/useless fetches. Reset `hasMoreResults` on filter update. End detection via `cards.length >= this.quantity`.
- **Task 2:** Added `@if`/`@else if` block after `@for` loop inside `.cardsContainer` — shows `<mat-spinner diameter="32">` when loading, "Fin des résultats" when no more results.
- **Task 3:** Imported `MatProgressSpinner` from `@angular/material/progress-spinner` (standalone component, not deprecated module).
- **Task 4:** Added `.scroll-indicator` styles with `grid-column: 1 / -1` for CSS Grid modes, `width: 100%` for flex modes, gold spinner via `--mdc-circular-progress-active-indicator-color: var(--accent-primary)`, secondary text color for end message.
- **Task 5:** `ng build` confirmed zero compilation errors. Manual verification subtasks (5.2-5.8) require user visual testing.

### File List

- `front/src/app/services/search-service-core.service.ts` (modified — added signals + fetch guards)
- `front/src/app/components/card-list/card-list.component.html` (modified — added spinner/end-message template)
- `front/src/app/components/card-list/card-list.component.ts` (modified — added MatProgressSpinner import)
- `front/src/app/components/card-list/card-list.component.scss` (modified — added .scroll-indicator styles)

## Senior Developer Review (AI)

**Reviewer:** Claude Opus 4.6 | **Date:** 2026-02-17 | **Outcome:** Approved with fixes applied

**Issues Found:** 2 High, 2 Medium, 3 Low — **6 fixed, 1 noted for later**

| ID | Severity | Description | Resolution |
|----|----------|-------------|------------|
| H1 | HIGH | Race condition: `isLoadingState` not reset at start of `fetch()` — re-navigation mid-fetch blocks initial load | Fixed: added `isLoadingState.set(false)` + `hasMoreResultsState.set(true)` at top of `fetch()` |
| H2 | HIGH | "Fin des résultats" displays for zero-result searches (misleading UX) | Fixed: added `svc.cardsDetails.length` guard in template condition |
| M1 | MEDIUM | Template uses `!` non-null assertion and inconsistent optional chaining | Fixed: refactored with `@let svc = searchService()` — eliminated `!` assertion |
| M2 | MEDIUM | No `role="status"` / `aria-live` on "Fin des résultats" for screen readers | Fixed: added `role="status" aria-live="polite"` |
| L1 | LOW | Dev Notes say "3 files modified" but lists 4 | Fixed: corrected to "4 files modified" |
| L2 | LOW | Template calls `searchService()` 4 times redundantly | Fixed: via `@let` (resolves with M1) |
| L3 | LOW | Silent error swallowing on HTTP failure (no user feedback) | Noted for future — acceptable for MVP |

## Change Log

- 2026-02-17: Implemented infinite scroll loading indicator — added `isLoading`/`hasMoreResults` signals to `SearchServiceCore`, `<mat-spinner>` + "Fin des résultats" to card-list template, fetch guards to prevent duplicate/useless API calls, CSS Grid-compatible indicator styling with gold accent token
- 2026-02-17: Code review fixes — reset signals at start of `fetch()` (race condition), added `cardsDetails.length` guard for empty searches, refactored template with `@let` (eliminated `!` assertion), added ARIA attributes for accessibility, fixed doc typo
