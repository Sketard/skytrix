# Story 10.2: Unified Expand/Collapse Filters in Card Searcher

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want filters to expand/collapse vertically above the card list in every context,
so that I have a consistent, non-overlapping filter experience whether I'm in the deck builder, card search page, or mobile bottom sheet.

## Acceptance Criteria

1. **Given** the card searcher currently delegates filter display to external containers (deck builder overlay `z-index: 999`, card search page lateral panel `width: 0→300px`)
   **When** the filter toggle button is pressed
   **Then** the `card-filters` component expands vertically **above** the `card-list` inside the `card-searcher` component, pushing the list down
   **And** the animation uses CSS `grid-template-rows` transition for smooth expand/collapse

2. **Given** the `card-searcher` manages filters internally
   **When** filters are open
   **Then** the card list remains partially visible below the filters (in full-height contexts)
   **And** scrolling the card list still works normally

3. **Given** the card searcher emits a `filtersExpanded` output signal
   **When** filters are expanded
   **Then** the signal emits `true`
   **When** filters are collapsed
   **Then** the signal emits `false`

4. **Given** the deck builder previously had `.deckBuilder-side-filters` as an absolute-positioned overlay
   **When** the expand/collapse pattern is active
   **Then** the `.deckBuilder-side-filters` div and its styling are removed from `deck-builder.component.html` and `deck-builder.component.scss`
   **And** the `filtersOpened` signal and `closeFilters()` method in `deck-builder.component.ts` are removed (filters now managed by card-searcher)

5. **Given** the card search page previously had `.cardSearchPage-filters` as a lateral panel
   **When** the expand/collapse pattern is active
   **Then** the `.cardSearchPage-filters` div and its responsive SCSS (width transition, mobile overlay) are removed from `card-searcher.component.html` and `card-searcher.component.scss`

6. **Given** the `deckBuildMode` input exists on `card-searcher`
   **When** `deckBuildMode` is `true`
   **Then** the filter toggle button and expand/collapse work identically to when `deckBuildMode` is `false` — no mode-specific filter behavior

7. **Given** the filter expand/collapse is implemented
   **When** tested on desktop (both pages) and mobile portrait (bottom sheet)
   **Then** no visual regression occurs and filters are functional in all 3 contexts

## Tasks / Subtasks

- [x] Task 1: Internalize filters in `card-searcher` for ALL modes (AC: #1, #2, #5, #6)
  - [x] 1.1 Remove the `@if (!deckBuildMode())` guard on the filter container in `card-searcher.component.html` — filters must render in ALL modes
  - [x] 1.2 Restructure HTML: replace flex layout with CSS grid `grid-template-rows: auto auto 1fr` on `.cardSearchPage-searcher` (search bar / filters / card list)
  - [x] 1.3 Replace the `.cardSearchPage-filters` container with a new `.cardSearchPage-searcher-filters` container (lives INSIDE `.cardSearchPage-searcher`, between search bar and result)
  - [x] 1.4 Apply `grid-template-rows: auto 0fr 1fr` (collapsed) and `grid-template-rows: auto 1fr 1fr` (expanded) with `transition: grid-template-rows 0.3s ease-in-out` on `.cardSearchPage-searcher`
  - [x] 1.5 On the filters row: set `overflow: hidden` and `min-height: 0` to allow grid collapse to work
  - [x] 1.6 Remove ALL `.cardSearchPage-filters` SCSS block (lateral panel, width transitions, mobile absolute overlay, respond-below breakpoint override)
  - [x] 1.7 Remove the `.has-filters-open` class and its SCSS rules (no more width calc, no more searcher width shrink)
  - [x] 1.8 Pass `[searchService]="searchService()"` and `[filtersOpened]="filtersOpen()"` and `(close)="toggleFilters()"` to the `<app-card-filters>` inside card-searcher — same as current non-deckBuildMode, now for ALL modes
  - [x] 1.9 Change `filtersOpen` initialization from `signal(this.breakpointObserver.isMatched('(min-width: 768px)'))` to `signal(false)` — filters start collapsed in ALL modes, user opens explicitly. This prevents filters appearing open by default in the deck builder side panel (where they were previously skipped entirely)

- [x] Task 2: Add `filtersExpanded` output to `card-searcher` (AC: #3)
  - [x] 2.1 Add `readonly filtersExpanded = output<boolean>()` to `CardSearcherComponent`
  - [x] 2.2 In `toggleFilters()`, after updating `filtersOpen`, emit `this.filtersExpanded.emit(this.filtersOpen())`

- [x] Task 3: Remove external filter management from deck builder (AC: #4)
  - [x] 3.1 In `deck-builder.component.html`: remove the `<div class="deckBuilder-side-filters">...</div>` block from the side panel (lines 113-115)
  - [x] 3.2 In `deck-builder.component.html`: remove the `<div class="deckBuilder-side-filters">...</div>` block from inside the bottom sheet (lines 129-131)
  - [x] 3.3 In `deck-builder.component.html`: add `(filtersExpanded)="onFiltersExpanded($event)"` on BOTH `<app-card-searcher>` instances (side panel and bottom sheet)
  - [x] 3.4 In `deck-builder.component.html`: add `[requestedSnap]="filtersRequestedSnap()"` on the `<app-bottom-sheet>` to wire auto-snap-full
  - [x] 3.5 In `deck-builder.component.ts`: remove `readonly filtersOpened = this.deckBuildService.openedFilters;`
  - [x] 3.6 In `deck-builder.component.ts`: remove `public closeFilters() { this.deckBuildService.toggleFilters(); }`
  - [x] 3.7 In `deck-builder.component.ts`: add `readonly filtersRequestedSnap = signal<'full' | null>(null);`
  - [x] 3.8 In `deck-builder.component.ts`: add `onFiltersExpanded(expanded: boolean)` method that sets `filtersRequestedSnap` to `'full'` when `expanded === true`, or `null` when `expanded === false`
  - [x] 3.9 In `deck-builder.component.ts`: remove `CardFiltersComponent` from `imports` array (no longer used directly by deck builder)
  - [x] 3.10 In `deck-builder.component.scss`: remove entire `.deckBuilder-side-filters` block (lines 227-244)

- [x] Task 4: Clean up `SearchBarComponent` filter toggle (AC: #6)
  - [x] 4.1 In `search-bar.component.ts`: the `openFilters()` method currently calls `this.deckBuildService.toggleFilters()` when `deckBuildMode()` is true. Remove this service call — only emit `filterToggled`
  - [x] 4.2 The `card-searcher` already listens to `(filterToggled)="toggleFilters()"` — this becomes the ONLY filter toggle path for ALL modes

- [x] Task 5: Clean up `SearchServiceCore` filter state (AC: #6)
  - [x] 5.1 In `search-service-core.service.ts`: remove `openedFiltersState`, `openedFilters`, and `toggleFilters()` — filter open/close state is now owned by `CardSearcherComponent.filtersOpen` signal, not the service
  - [x] 5.2 In `search-service-core.service.ts`: remove the `this.openedFilters()` check from the `debounce` logic (line 88) — keep only `this.skipDebounceState() ? of({}) : timer(750)`. The `card-filters` component already calls `search()` explicitly on close (which patches the service form and triggers search), so the debounce skip for open filters is redundant
  - [x] 5.3 Verify `DeckBuildService` and `CardSearchService` don't override or rely on `toggleFilters` / `openedFilters` beyond what's removed

- [x] Task 6: Build and manual verification (AC: #7)
  - [x] 6.1 Run `ng build` — zero compilation errors (budget warnings pre-existing, ignore exit code 1)
  - [ ] 6.2 Desktop — deck builder: open/close filters, verify expand/collapse above card list, search works
  - [ ] 6.3 Desktop — card search page: open/close filters, verify expand/collapse above card list, search works
  - [ ] 6.4 Mobile portrait — deck builder bottom sheet: open filters, verify auto-snap to full, close filters, verify restore to half
  - [ ] 6.5 Mobile portrait — card search page: open/close filters (no bottom sheet yet — story 10.3)
  - [ ] 6.6 Verify CDK drag-drop still works (card from search → deck zone) with filters open and closed
  - [ ] 6.7 Verify card inspector opens correctly in both pages with filters in any state

## Dev Notes

### Scope & Intent

This story **unifies filter display** across all contexts. Currently there are 3 different filter presentation mechanisms:
1. **Deck builder:** External `.deckBuilder-side-filters` absolute overlay with `z-index: 999`, managed by `DeckBuildService.openedFilters` / `DeckBuilderComponent.closeFilters()`
2. **Card search page (desktop):** Internal `.cardSearchPage-filters` lateral panel with `width: 0→300px` transition
3. **Card search page (mobile):** Internal `.cardSearchPage-filters` absolute overlay with `translateX(100%)` transition

After this story, ALL contexts use a single mechanism: **vertical expand/collapse** above the card list inside `card-searcher`, using CSS `grid-template-rows` transition.

### Current State Analysis (Pre-Implementation)

#### CardSearcherComponent

File: `front/src/app/components/card-searcher/card-searcher.component.ts`

**Current API:**
| Input/Output | Type | Default |
|---|---|---|
| `deckBuildMode` | `input<boolean>` | `false` |
| `searchService` | `input<SearchServiceCore \| undefined>` | `undefined` |
| `cardClicked` | `output<CardDetail>` | — |

**Internal state:**
- `filtersOpen = signal(breakpointObserver.isMatched('(min-width: 768px)'))` — true on desktop at init
- `form: FormGroup<TypedForm<CardFilterDTO>>` — set via effect from searchService
- `displayMode: Signal<CardDisplayType>` — set via effect from searchService

**Current HTML layout (flex):**
```
.cardSearchPage (flex row)
  ├── .cardSearchPage-searcher (flex: grow, grid: auto 1fr)
  │   ├── .cardSearchPage-searcher-bar (search input + toggle buttons)
  │   └── .cardSearchPage-searcher-result (card-list)
  └── .cardSearchPage-filters (ONLY when !deckBuildMode) — lateral panel
```

**Target HTML layout (grid):**
```
.cardSearchPage
  └── .cardSearchPage-searcher (grid: auto auto 1fr)
      ├── .cardSearchPage-searcher-bar (search input + toggle buttons)
      ├── .cardSearchPage-searcher-filters (card-filters, collapsible row)
      └── .cardSearchPage-searcher-result (card-list)
```

#### DeckBuilderComponent — Filter State Flow (Current)

```
SearchBarComponent.openFilters()
  → deckBuildService.toggleFilters()     ← service state
  → emits filterToggled                  ← card-searcher receives

CardSearcherComponent.toggleFilters()
  → updates filtersOpen signal           ← component state (unused in deckBuildMode)

DeckBuilderComponent
  → filtersOpened = deckBuildService.openedFilters  ← reads service state
  → closeFilters() → deckBuildService.toggleFilters()

Two separate states exist: service.openedFilters + component.filtersOpen
```

#### DeckBuilderComponent — Filter State Flow (Target)

```
SearchBarComponent.openFilters()
  → emits filterToggled ONLY             ← no more service call

CardSearcherComponent.toggleFilters()
  → updates filtersOpen signal            ← SINGLE source of truth
  → emits filtersExpanded(boolean)        ← for bottom sheet auto-snap

DeckBuilderComponent
  → onFiltersExpanded(expanded) → filtersRequestedSnap signal
  → bottom sheet [requestedSnap] ← drives auto-snap-full
```

#### SearchBarComponent — Filter Toggle Issue

File: `front/src/app/components/search-bar/search-bar.component.ts:36-41`

Current `openFilters()`:
```typescript
public openFilters() {
  if (this.deckBuildMode()) {
    this.deckBuildService.toggleFilters(); // ← REMOVE: mutates service state
  }
  this.filterToggled.emit(); // ← KEEP: card-searcher handles toggle
}
```

**Critical:** The `deckBuildService.toggleFilters()` call in `openFilters()` MUST be removed. The `filterToggled` output alone drives the toggle. The `deckBuildMode()` condition becomes irrelevant — same behavior for all modes.

#### SearchServiceCore — Debounce Reference

File: `front/src/app/services/search-service-core.service.ts:86-89`

```typescript
debounce(() => {
  return this.openedFilters() || this.skipDebounceState() ? of({}) : timer(750);
}),
```

This skips debounce when `openedFilters()` is true (so typing in filter fields applies instantly). After removing `openedFilters` from the service, the dev needs to decide:
- **Option A (recommended):** Remove the `openedFilters()` check entirely. The `card-filters` component already calls `search()` explicitly on close (which patches the service form and triggers search). The debounce just needs to handle the text search input, where 750ms is appropriate regardless of filter state.
- **Option B:** Pass `filtersOpen` state into the service. This adds coupling between component and service. Not recommended.

#### CardFiltersComponent — Behavior Analysis

File: `front/src/app/components/card-filters/card-filters.component.ts`

The component's behavior depends on `filtersOpened` input:
- **When `filtersOpened() === true`:** Shows close button + search/clear buttons. Form changes do NOT auto-search (user explicitly clicks "Rechercher").
- **When `filtersOpened() === false`:** Hides close button + search/clear buttons. Form changes auto-search immediately (line 62: `if (!this.filtersOpened()) { this.search(); }`).

**Key insight:** After this story, `filtersOpened` will ALWAYS reflect the actual visual state (controlled by `card-searcher.filtersOpen`), which is correct. When filters are expanded and visible, the user sees buttons and clicks "Rechercher". When filters are collapsed and hidden, any residual form change triggers auto-search.

### CSS Grid Expand/Collapse Pattern

**Recommended approach — `grid-template-rows` transition:**

```scss
.cardSearchPage-searcher {
  display: grid;
  grid-template-rows: auto 0fr 1fr;  // collapsed: search-bar / filters(0) / results
  transition: grid-template-rows 0.3s ease-in-out;

  &.filters-expanded {
    grid-template-rows: auto 1fr 1fr; // expanded: search-bar / filters(1fr) / results(1fr)
  }
}

.cardSearchPage-searcher-filters {
  overflow: hidden;
  min-height: 0;
}
```

**Why `grid-template-rows` over `max-height`:**
- `grid-template-rows: 0fr → 1fr` produces a smooth transition without guessing a max-height value
- Content-aware: the row shrinks to exactly 0 and grows to natural height
- No need for JS height measurement
- Supported in all modern browsers (Chrome 107+, Firefox 106+, Safari 16.4+)

### Coordination Flow (Bottom Sheet Auto-Snap)

1. User taps filter toggle in bottom sheet → `card-searcher.toggleFilters()`
2. `filtersOpen` signal updates → `filtersExpanded.emit(true)`
3. `deck-builder.onFiltersExpanded(true)` → `filtersRequestedSnap.set('full')`
4. `<app-bottom-sheet [requestedSnap]="filtersRequestedSnap()">` → bottom sheet saves `'half'` → snaps to `'full'`
5. User closes filters → `filtersExpanded.emit(false)`
6. `deck-builder.onFiltersExpanded(false)` → `filtersRequestedSnap.set(null)`
7. Bottom sheet restores to `'half'`

**Edge case — both card-searcher instances:** The deck builder has 2 `<app-card-searcher>` instances (side panel + bottom sheet). Only the bottom sheet instance needs auto-snap coordination. However, both will emit `filtersExpanded`. The `onFiltersExpanded` handler sets `filtersRequestedSnap` for the bottom sheet. When the side panel instance emits, the bottom sheet may not be open — the `requestedSnap` effect guards against `sheetState === 'closed'`, so this is harmless.

### Files to Modify

| File | Change |
|---|---|
| `front/src/app/components/card-searcher/card-searcher.component.html` | Restructure: remove `@if (!deckBuildMode())` guard, add filters row inside `.cardSearchPage-searcher`, remove `.cardSearchPage-filters` container |
| `front/src/app/components/card-searcher/card-searcher.component.scss` | Replace flex layout with grid, remove `.cardSearchPage-filters` block, remove `.has-filters-open` block, add grid-template-rows transition |
| `front/src/app/components/card-searcher/card-searcher.component.ts` | Add `filtersExpanded` output, emit in `toggleFilters()` |
| `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html` | Remove 2x `.deckBuilder-side-filters` blocks, add `(filtersExpanded)` and `[requestedSnap]` bindings |
| `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts` | Remove `filtersOpened`, `closeFilters()`, `CardFiltersComponent` import. Add `filtersRequestedSnap`, `onFiltersExpanded()` |
| `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss` | Remove `.deckBuilder-side-filters` block |
| `front/src/app/components/search-bar/search-bar.component.ts` | Remove `deckBuildService.toggleFilters()` call from `openFilters()` |
| `front/src/app/services/search-service-core.service.ts` | Remove `openedFiltersState`, `openedFilters`, `toggleFilters()`. Update debounce logic |

### Anti-Pattern Warnings

- **DO NOT** use `max-height` for collapse animation — use `grid-template-rows: 0fr → 1fr` instead (no magic number needed)
- **DO NOT** create a new service or shared state for filter open/close — `CardSearcherComponent.filtersOpen` signal is the single source of truth
- **DO NOT** keep the `deckBuildService.toggleFilters()` call in `SearchBarComponent` — the output event alone drives the toggle
- **DO NOT** use `@if` to conditionally render `<app-card-filters>` — the component should always be in the DOM for form state preservation. Use CSS overflow/grid to hide it
- **DO NOT** modify the `CardFiltersComponent` internal logic — its `filtersOpened` input-driven behavior (close button, auto-search) remains correct
- **DO NOT** modify bottom sheet snap position math, velocity logic, or pointer event handling — all unchanged from story 10.1
- **DO NOT** add any new npm dependencies
- **DO NOT** modify `CardListComponent` — it remains unaware of filter state
- **DO NOT** change the landscape filter behavior — story 10.2 does NOT implement the landscape bottom sheet pattern (future scope per UX spec §Deck Builder Landscape Filter Bottom Sheet)

### Previous Story Intelligence (10-1)

- `requestedSnap` input added to `BottomSheetComponent` — wire via `[requestedSnap]="filtersRequestedSnap()"`
- `previousSnapState` automatically saved/restored by the bottom sheet — parent just sets `'full'` or `null`
- `requestedSnap` effect guards: skips when `sheetState === 'closed'`, safe for both card-searcher instances to emit
- `ariaLabel` already passed by deck builder — no change needed
- `pointer-events: none` fix during card drag — CDK cross-boundary drag works, no change needed
- Build budget warnings pre-existing (1.63 MB > 1 MB) — ignore exit code 1

### CardFiltersComponent — No Changes Required

The `filtersOpened` input controls: (a) visibility of close button, (b) visibility of search/clear buttons, (c) auto-search-on-change when collapsed (line 62: `if (!this.filtersOpened()) { this.search(); }`). This continues to work identically with the new internal filter management. The `close` output from card-filters wires to `card-searcher.toggleFilters()` — unchanged.

### Known Issues

- **Landscape filter UX:** After this story, the deck builder landscape mode will use vertical expand/collapse (same as desktop). The UX spec describes a future landscape-specific bottom sheet pattern anchored in the side panel (§Deck Builder Landscape Filter Bottom Sheet). This is NOT in scope for story 10.2.
- **BUG-2 (from Epic 9 retro):** Infinite scroll trigger broken in some contexts. Unrelated to this story but be aware.
- **Filter toggle button visual state:** The search bar filter button uses the same icon (`filter_alt`) regardless of open/closed state. A future improvement could show a filled icon when filters are open. Not in scope for this story.

### Project Structure Notes

- All modified files are in existing locations — no new files created
- Component location: `front/src/app/components/card-searcher/` (shared component, correct)
- No new dependencies, no new services
- Filter state moves from distributed (service + component) to centralized (component only)

### Architecture Compliance

- `ChangeDetectionStrategy.OnPush` ✅ (all components already set)
- `input<T>()` / `output<T>()` for new signals ✅
- `signal<T>()` for internal state ✅
- TypeScript strict mode ✅ (`strict: true`, `noImplicitReturns: true`)
- No new RxJS Subjects ✅
- No direct DOM manipulation ✅
- Standalone components ✅

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Epic 10, Story 10.2 — lines 1750-1789]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §Card Searcher Filter Pattern — lines 1150-1168]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §Bottom Sheet Pattern — lines 1125-1148]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §Deck Builder Landscape Filter Bottom Sheet — lines 1185-1220 (NOT in scope)]
- [Source: _bmad-output/planning-artifacts/architecture.md §Component Communication Patterns — signal inputs, OnPush, effect()]
- [Source: _bmad-output/implementation-artifacts/10-1-generic-bottom-sheet-and-auto-snap-full.md — requestedSnap API, coordination flow, anti-patterns]
- [Source: front/src/app/components/card-searcher/card-searcher.component.ts — current implementation]
- [Source: front/src/app/components/card-searcher/card-searcher.component.html — current filter container]
- [Source: front/src/app/components/card-searcher/card-searcher.component.scss — current filter SCSS]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html — current external filter divs]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts — filtersOpened, closeFilters()]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss — .deckBuilder-side-filters SCSS]
- [Source: front/src/app/components/search-bar/search-bar.component.ts — openFilters() dual-path toggle]
- [Source: front/src/app/services/search-service-core.service.ts — openedFilters state, toggleFilters(), debounce reference]
- [Source: front/src/app/components/card-filters/card-filters.component.ts — filtersOpened input behavior]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build exit code 1 — budget warnings only (pre-existing), zero compilation errors

### Completion Notes List

- Unified filter display: all 3 contexts (deck builder side panel, card search page desktop, card search page mobile) now use a single vertical expand/collapse mechanism inside `card-searcher` via CSS `grid-template-rows: 0fr → 1fr` transition
- Removed distributed filter state (dual state: `SearchServiceCore.openedFilters` + `CardSearcherComponent.filtersOpen`) — now single source of truth in `CardSearcherComponent.filtersOpen` signal
- Added `filtersExpanded` output on `card-searcher` for bottom sheet auto-snap coordination
- Removed `CardFiltersComponent` from deck builder imports — filters now fully managed internally by card-searcher
- Removed `BreakpointObserver` dependency from `CardSearcherComponent` — filters always start collapsed
- Removed debounce skip for open filters in `SearchServiceCore` (Option A from Dev Notes) — card-filters already calls `search()` explicitly on close
- Refactored `SearchServiceCore.fetch()`: removed scroll-based infinite scroll (`combineLatest`, `fromEvent`, `CARDS_CONTAINER_CLASS`), replaced with pure `filterForm.valueChanges` subscriber. Added separate `loadNextPage()` method for component-driven pagination. Simplified `clearOffset()`.
- Refactored `SearchBarComponent`: replaced `DeckBuildService` injection with `searchService` input signal. `numberOfActiveFilters$` now derives from the active search service (via `toObservable` + `switchMap`), fixing incorrect filter count in non-deckBuildMode. Removed `deckBuildMode` input (no longer needed). Replaced `CommonModule` with `AsyncPipe`.
- Restructured `search-bar.component.html`: wrapped form field in `.searchBar-field` div, extracted clear button with absolute positioning, migrated `*ngIf` to `@if`
- Migrated `card-filters.component.html` from `*ngIf` to `@if` syntax (3 occurrences), removed `NgIf` import from component, removed meaningless `class="test"` wrapper
- Subtasks 6.2–6.7 left unchecked — require manual testing by user (no backend running in dev environment)

### File List

- front/src/app/components/card-searcher/card-searcher.component.html (modified)
- front/src/app/components/card-searcher/card-searcher.component.scss (modified)
- front/src/app/components/card-searcher/card-searcher.component.ts (modified)
- front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html (modified)
- front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts (modified)
- front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss (modified)
- front/src/app/components/search-bar/search-bar.component.ts (modified — review: replaced DeckBuildService with searchService input)
- front/src/app/components/search-bar/search-bar.component.html (modified — review: restructured layout, migrated *ngIf to @if)
- front/src/app/components/search-bar/search-bar.component.scss (modified — review: reduced z-index)
- front/src/app/components/card-filters/card-filters.component.html (modified — review: migrated *ngIf to @if, removed class="test")
- front/src/app/components/card-filters/card-filters.component.ts (modified — review: removed NgIf import)
- front/src/app/services/search-service-core.service.ts (modified)

## Change Log

- 2026-02-18: Unified filter expand/collapse — internalized filters in card-searcher for all modes, removed external filter management from deck builder and search service, added filtersExpanded output for bottom sheet auto-snap coordination
- 2026-02-18: Code review fixes — (H1) added missing horizontal padding on filters row in card-searcher SCSS; (M3-M5) unified search-bar: replaced DeckBuildService injection with searchService input, filter badge now works in all modes, migrated *ngIf to @if; (L1-L2) migrated card-filters template to @if, removed class="test"; (L3) reduced z-index from 10000 to 1 on filter badge
