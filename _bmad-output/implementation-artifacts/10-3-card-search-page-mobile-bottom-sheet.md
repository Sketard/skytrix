# Story 10.3: Card Search Page Mobile Bottom Sheet

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the card search page to use a bottom sheet on mobile portrait,
so that I have a familiar, draggable search panel experience consistent with the deck builder.

## Acceptance Criteria

1. **Given** the card search page has no bottom sheet on mobile
   **When** viewed on mobile portrait (<=767px width, portrait orientation)
   **Then** a `<app-bottom-sheet>` wraps the `<app-card-searcher>` component
   **And** the bottom sheet is hidden via CSS `display: none` on desktop/landscape (same pattern as deck builder)

2. **Given** the card search page needs a trigger to open the bottom sheet on mobile portrait
   **When** a FAB search toggle button is added (same pattern as deck builder's `.deckBuilder-searchToggle`)
   **Then** tapping the FAB opens the bottom sheet in `half` snap state
   **And** the FAB is only visible on mobile portrait (hidden on desktop/landscape via CSS media query)

3. **Given** the card searcher emits `filtersExpanded: true` inside the bottom sheet
   **When** the event is received by the card search page component
   **Then** the bottom sheet snaps to `full` via the programmatic snap API (from story 10.1)

4. **Given** the card searcher emits `filtersExpanded: false`
   **When** the event is received
   **Then** the bottom sheet restores to its previous snap state

5. **Given** the card search page uses `CardInspectorComponent` with `mode="click"`
   **When** a card is tapped in the bottom sheet
   **Then** the inspector opens as an overlay **above** the bottom sheet (z-index hierarchy preserved)
   **And** no nested bottom sheet is created

6. **Given** the bottom sheet is implemented on the card search page
   **When** the `ariaLabel` input is set
   **Then** it uses `"Panneau de recherche de cartes"` (or appropriate label)
   **And** the `cardDragActive` input is NOT used (no CDK drag on card search page)

7. **Given** the card search page bottom sheet is complete
   **When** tested on mobile portrait, mobile landscape, tablet, and desktop
   **Then** the bottom sheet is only visible/functional on mobile portrait
   **And** desktop/landscape behavior is unchanged (full-page card searcher with inline filters)

## Tasks / Subtasks

- [x] Task 1: Add mobile portrait detection and bottom sheet state signals (AC: #1, #2, #3, #4)
  - [x] 1.1 In `card-search-page.component.ts`: add `BreakpointObserver` injection via `inject()`, create `isMobilePortrait` signal via `toSignal(breakpointObserver.observe(['(max-width: 767px) and (orientation: portrait)'])..., { initialValue: false })`
  - [x] 1.2 Add `readonly searchPanelOpened = signal(true)` — bottom sheet auto-opens on page load (unlike deck builder where `signal(false)` because deck viewer is the main content; here search IS the main content)
  - [x] 1.3 Add `readonly filtersRequestedSnap = signal<'full' | null>(null)`
  - [x] 1.4 Add `onFiltersExpanded(expanded: boolean)` method: sets `filtersRequestedSnap` to `'full'` when `true`, `null` when `false`
  - [x] 1.5 Add `toggleSearchPanel()` method: `this.searchPanelOpened.update(v => !v)`
  - [x] 1.6 Add `BottomSheetComponent` to `imports` array. Add `toSignal` from `@angular/core/rxjs-interop`, `map` from `rxjs`

- [x] Task 2: Add bottom sheet and FAB to template (AC: #1, #2, #6)
  - [x] 2.1 In `card-search-page.component.html`: wrap existing `<app-card-searcher>` in a `<div class="cardSearchPage-desktop">` container (for CSS visibility toggle)
  - [x] 2.2 Add FAB button before the desktop container:
    ```html
    <button mat-icon-button class="cardSearchPage-searchToggle"
      aria-label="Rechercher une carte"
      (click)="toggleSearchPanel()">
      <mat-icon>search</mat-icon>
    </button>
    ```
  - [x] 2.3 Add bottom sheet with second card-searcher instance:
    ```html
    <app-bottom-sheet
      [opened]="searchPanelOpened() && isMobilePortrait()"
      [ariaLabel]="'Panneau de recherche de cartes'"
      [requestedSnap]="filtersRequestedSnap()"
      (closed)="searchPanelOpened.set(false)">
      <app-card-searcher
        [deckBuildMode]="false"
        [searchService]="cardSearchService"
        (cardClicked)="onCardClicked($event)"
        (filtersExpanded)="onFiltersExpanded($event)">
      </app-card-searcher>
    </app-bottom-sheet>
    ```
  - [x] 2.4 Add `(filtersExpanded)="onFiltersExpanded($event)"` on the desktop card-searcher too (harmless — `requestedSnap` effect guards `sheetState === 'closed'`)
  - [x] 2.5 Do NOT pass `[cardDragActive]` to the bottom sheet — card search page has no CDK drag-drop

- [x] Task 3: Add responsive CSS for bottom sheet and FAB (AC: #1, #2, #5, #7)
  - [x] 3.1 In `card-search-page.component.scss`: add `.cardSearchPage-desktop` rule that hides on mobile portrait:
    ```scss
    .cardSearchPage-desktop {
      display: contents; // transparent wrapper on desktop
      @media (max-width: 767px) and (orientation: portrait) {
        display: none;
      }
    }
    ```
  - [x] 3.2 Add `app-bottom-sheet` display toggle (same pattern as deck builder):
    ```scss
    app-bottom-sheet {
      display: none;
      @media (max-width: 767px) and (orientation: portrait) {
        display: block;
      }
    }
    ```
  - [x] 3.3 Add FAB styling (replicate deck builder `.deckBuilder-searchToggle` pattern):
    ```scss
    .cardSearchPage-searchToggle.mat-mdc-icon-button {
      display: none;
      @media (max-width: 767px) and (orientation: portrait) {
        display: flex;
        position: fixed;
        bottom: 1em;
        right: 1em;
        z-index: 10;
        color: $white;
        background: rgba(0, 0, 0, 0.6);
        @include r.touch-target-min;
      }
    }
    ```
  - [x] 3.4 Add inspector z-index override for mobile (same pattern as deck builder):
    ```scss
    app-card-inspector {
      @media (max-width: 767px) and (orientation: portrait) {
        --inspector-z-index: 1001;
      }
    }
    ```

- [ ] Task 4: Build and manual verification (AC: #7)
  - [x] 4.1 Run `ng build` — zero compilation errors (budget warnings pre-existing, ignore exit code 1)
  - [ ] 4.2 Desktop — card search page: full-page card-searcher unchanged, no FAB visible, no bottom sheet
  - [ ] 4.3 Mobile portrait — card search page: bottom sheet auto-opens in half, FAB visible, card-searcher inside bottom sheet
  - [ ] 4.4 Mobile portrait — expand filters in bottom sheet: auto-snap to full, collapse restores to half
  - [ ] 4.5 Mobile portrait — tap card in bottom sheet: inspector opens above bottom sheet (z-index 1001 > 100)
  - [ ] 4.6 Mobile portrait — dismiss bottom sheet + reopen via FAB
  - [ ] 4.7 Mobile landscape — no bottom sheet visible, full-page card-searcher works
  - [ ] 4.8 Tablet — no bottom sheet visible, full-page card-searcher works

## Dev Notes

### Scope & Intent

This story adds a **bottom sheet to the card search page for mobile portrait**, replicating the exact pattern already implemented in the deck builder (stories 10.1 and 10.2). The card search page is the last consumer of the generic bottom sheet component.

**Key difference from deck builder:** The bottom sheet **auto-opens** on page load (`searchPanelOpened = signal(true)`) because the card search page's primary content IS the searcher — there's no "main content" behind it like the deck builder has its deck viewer. Without auto-open, users would land on an empty page with just a FAB.

### Current State (Pre-Implementation)

File: `front/src/app/pages/card-search-page/card-search-page.component.ts`

**Current API:**
| Signal | Type | Purpose |
|---|---|---|
| `selectedCardForInspector` | `signal<SharedCardInspectorData \| null>` | Card detail for inspector overlay |
| `selectedCardDetail` | `signal<CardDetail \| null>` | Internal card state for favorite toggle |

**Current template:**
```
card-search-page (host: flex column, 100% height)
  ├── <app-card-searcher> [deckBuildMode]="false" [searchService]="cardSearchService"
  └── <app-card-inspector> mode="click" (with favorite toggle button)
```

**Current SCSS:** Minimal — `:host` flex column, favorite button styling only.

### Target State (Post-Implementation)

**New signals:**
| Signal | Type | Default | Purpose |
|---|---|---|---|
| `searchPanelOpened` | `signal<boolean>` | `true` | Controls bottom sheet open state |
| `isMobilePortrait` | `Signal<boolean>` | `false` | BreakpointObserver reactive signal |
| `filtersRequestedSnap` | `signal<'full' \| null>` | `null` | Drives bottom sheet auto-snap-full |

**Target template:**
```
card-search-page (host: flex column, 100% height)
  ├── .cardSearchPage-searchToggle (FAB — mobile portrait only)
  ├── .cardSearchPage-desktop (hidden on mobile portrait)
  │   └── <app-card-searcher> (desktop full-page instance)
  ├── <app-bottom-sheet> (hidden on desktop/landscape)
  │   └── <app-card-searcher> (mobile portrait instance)
  └── <app-card-inspector> mode="click" (z-index 1001 on mobile)
```

**Two card-searcher instances sharing `CardSearchService`:**
Both instances receive `[searchService]="cardSearchService"`. The `CardSearchService` is a singleton provided at root (or page) level. This is the exact same pattern as deck builder sharing `DeckBuildService`. Only one instance is visible at a time (CSS display toggle), so no duplicate API calls or conflicting state.

### Deck Builder Reference Pattern

The implementation should closely follow `deck-builder.component.ts` lines 84-94 for the breakpoint/signal pattern and `deck-builder.component.html` lines 126-140 for the bottom sheet template.

**deck-builder.component.ts (reference):**
```typescript
readonly filtersRequestedSnap = signal<'full' | null>(null);
readonly searchPanelOpened = signal(false); // ← card search page uses signal(true)

private readonly breakpointObserver = inject(BreakpointObserver);
readonly isMobilePortrait = toSignal(
  this.breakpointObserver.observe(['(max-width: 767px) and (orientation: portrait)'])
    .pipe(map(result => result.matches)),
  { initialValue: false }
);

public onFiltersExpanded(expanded: boolean) {
  this.filtersRequestedSnap.set(expanded ? 'full' : null);
}
```

**deck-builder.component.html (reference):**
```html
<app-bottom-sheet
  [opened]="searchPanelOpened() && isMobilePortrait()"
  [cardDragActive]="isCardDragActive()"   <!-- NOT USED on card search page -->
  [ariaLabel]="'Panneau de recherche de cartes'"
  [requestedSnap]="filtersRequestedSnap()"
  (closed)="searchPanelOpened.set(false)">
  <app-card-searcher ...></app-card-searcher>
</app-bottom-sheet>
```

**deck-builder.component.scss (reference):**
```scss
&-searchToggle.mat-mdc-icon-button {
  display: none;
  @media (max-width: 767px) and (orientation: portrait) {
    display: flex;
    position: fixed;
    bottom: 1em;
    right: 1em;
    z-index: 10;
    color: $white;
    background: rgba(0, 0, 0, 0.6);
    @include r.touch-target-min;
  }
}

app-bottom-sheet {
  display: none;
  @media (max-width: 767px) and (orientation: portrait) {
    display: block;
  }
}
```

### CSS `display: contents` for Desktop Wrapper

The desktop card-searcher needs a wrapper div for the mobile portrait hide. Using `display: contents` makes the wrapper transparent on desktop — the card-searcher behaves as if the wrapper doesn't exist. On mobile portrait, the wrapper switches to `display: none`, hiding the desktop instance completely.

```scss
.cardSearchPage-desktop {
  display: contents;
  @media (max-width: 767px) and (orientation: portrait) {
    display: none;
  }
}
```

**Why `display: contents`:** The `:host` uses `display: flex; flex-direction: column; height: 100%`. Adding a `<div>` wrapper as a flex child would become the card-searcher's parent and need `flex: 1; min-height: 0; overflow: hidden` to preserve the current layout. `display: contents` avoids this entirely — the card-searcher participates directly in the host's flex layout as before.

### Z-Index Hierarchy (Mobile Portrait)

| Element | z-index | Source |
|---|---|---|
| FAB search toggle | 10 | `.cardSearchPage-searchToggle` |
| Bottom sheet backdrop | 99 | `bottom-sheet.component.scss` |
| Bottom sheet panel | 100 | `bottom-sheet.component.scss` |
| Card inspector | 1001 | `--inspector-z-index` CSS variable |

The inspector at 1001 is above the bottom sheet at 100 — card taps in the bottom sheet correctly open the inspector as an overlay above. This is the proven deck builder pattern.

### Auto-Open Behavior

`searchPanelOpened = signal(true)` means the bottom sheet opens immediately when `isMobilePortrait()` becomes true. The `opened` input on the bottom sheet is `searchPanelOpened() && isMobilePortrait()`, so:
- Desktop/landscape: `false && false` = closed (bottom sheet hidden via CSS anyway)
- Mobile portrait page load: `true && true` = opens in `half` state
- After dismiss: user sets `searchPanelOpened` to `false` via `(closed)` event. FAB re-opens it.

### No `cardDragActive` Needed

The card search page does not use CDK drag-drop (`cdkDropListGroup`, `cdkDrag`). There's no cross-boundary card drag from search to deck. Therefore:
- Do NOT pass `[cardDragActive]` to `<app-bottom-sheet>`
- The default value `false` applies — no `pointer-events: none` during any interaction
- The `.card-drag-active` CSS class never activates

### Files to Modify

| File | Change |
|---|---|
| `front/src/app/pages/card-search-page/card-search-page.component.ts` | Add `BreakpointObserver`, `searchPanelOpened`, `isMobilePortrait`, `filtersRequestedSnap` signals, `onFiltersExpanded()`, `toggleSearchPanel()`, `BottomSheetComponent` import |
| `front/src/app/pages/card-search-page/card-search-page.component.html` | Add FAB, wrap desktop card-searcher in `.cardSearchPage-desktop`, add `<app-bottom-sheet>` with 2nd card-searcher, add `(filtersExpanded)` on both instances |
| `front/src/app/pages/card-search-page/card-search-page.component.scss` | Add FAB styling, bottom sheet display toggle, desktop wrapper hide, inspector z-index override |

### Anti-Pattern Warnings

- **DO NOT** use a single card-searcher instance and try to move it in/out of the bottom sheet — use two instances with CSS display toggle (proven pattern)
- **DO NOT** pass `[cardDragActive]` — no CDK drag on card search page
- **DO NOT** use `signal(false)` for `searchPanelOpened` — the card search page MUST auto-open the bottom sheet (no main content behind it unlike deck builder)
- **DO NOT** modify the `BottomSheetComponent` itself — it's generic and complete from story 10.1
- **DO NOT** modify the `CardSearcherComponent` — it already has `filtersExpanded` output from story 10.2
- **DO NOT** modify `CardSearchService` — it works identically with two card-searcher instances
- **DO NOT** change the bottom sheet snap position math, velocity logic, or pointer event handling
- **DO NOT** add `cdkDropListGroup` to the card search page — no drag-drop functionality
- **DO NOT** add any new npm dependencies
- **DO NOT** nest the inspector inside the bottom sheet — it must remain at the page level for z-index stacking

### Previous Story Intelligence (10.1 + 10.2)

**From 10.1:**
- `requestedSnap` input accepts `'half' | 'full' | 'collapsed' | null`. For filter auto-snap, use `'full'` and `null` only
- `previousSnapState` automatically saved/restored — parent just sets the signal
- `requestedSnap` effect guards: skips when `sheetState === 'closed'`, safe for both card-searcher instances to emit `filtersExpanded`
- `ariaLabel` defaults to `'Panneau de recherche de cartes'` — explicitly pass the same value for clarity
- Build budget warnings pre-existing (1.63 MB > 1 MB) — ignore exit code 1

**From 10.2:**
- `filtersExpanded` output already exists on `CardSearcherComponent` — wire it with `(filtersExpanded)="onFiltersExpanded($event)"`
- `filtersOpen` signal starts as `signal(false)` — filters are collapsed by default on all instances
- Both card-searcher instances emit `filtersExpanded`. When the desktop instance emits, the bottom sheet may not be open — the `requestedSnap` effect guards against `sheetState === 'closed'`, so this is harmless
- Grid expand/collapse for filters already works inside card-searcher — no additional work needed
- `SearchBarComponent` no longer has a `deckBuildMode` input (removed in 10.2) — no concerns for the card search page instance

**From 10.2 completion notes:**
- `SearchServiceCore.fetch()` was refactored: scroll-based infinite scroll removed, replaced with `filterForm.valueChanges` subscriber + `loadNextPage()` method. This is the current state of the service — both instances will call the same service methods
- `SearchBarComponent` now takes a `searchService` input signal (not `DeckBuildService` injection). The card-searcher passes this automatically

### Project Structure Notes

- All modified files are in the existing page directory: `front/src/app/pages/card-search-page/`
- No new files created — 3 existing files modified
- No new dependencies, no new services
- Follows the exact same integration pattern as `deck-builder.component.{ts,html,scss}`

### Architecture Compliance

- `ChangeDetectionStrategy.OnPush` ✅ (already set on CardSearchPageComponent)
- `input<T>()` / `output<T>()` — no new public API (page component only) ✅
- `signal<T>()` for internal state ✅
- `toSignal()` for BreakpointObserver → signal conversion ✅
- TypeScript strict mode ✅ (`strict: true`, `noImplicitReturns: true`)
- No new RxJS Subjects ✅
- No direct DOM manipulation ✅
- Standalone component ✅

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Epic 10, Story 10.3 — lines 1791-1831]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §Bottom Sheet Pattern — lines 1125-1148]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §Card Searcher Filter Pattern — lines 1150-1169]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §Card Search Page Density — lines 1170-1183]
- [Source: _bmad-output/planning-artifacts/architecture.md §Responsive Strategy — Track A/B, breakpoints]
- [Source: _bmad-output/implementation-artifacts/10-1-generic-bottom-sheet-and-auto-snap-full.md — requestedSnap API, ariaLabel, anti-patterns]
- [Source: _bmad-output/implementation-artifacts/10-2-unified-expand-collapse-filters-in-card-searcher.md — filtersExpanded output, grid expand/collapse, SearchBarComponent refactor]
- [Source: front/src/app/pages/card-search-page/card-search-page.component.ts — current implementation]
- [Source: front/src/app/pages/card-search-page/card-search-page.component.html — current template]
- [Source: front/src/app/pages/card-search-page/card-search-page.component.scss — current styles]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts — reference pattern: breakpoint, signals, onFiltersExpanded]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html — reference pattern: bottom sheet template]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss — reference pattern: FAB, bottom sheet display toggle]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build: zero compilation errors; exit code 1 from pre-existing budget warnings only (1.63 MB > 1 MB threshold)

### Completion Notes List

- Task 1: Added `BreakpointObserver` via `inject()`, `isMobilePortrait` signal via `toSignal()`, `searchPanelOpened = signal(true)` (auto-open), `filtersRequestedSnap` signal, `onFiltersExpanded()` and `toggleSearchPanel()` methods, `BottomSheetComponent` import. Exact deck-builder pattern replicated with `signal(true)` difference.
- Task 2: Template restructured — FAB search toggle, desktop wrapper with `cardSearchPage-desktop` class, `<app-bottom-sheet>` with second `<app-card-searcher>` instance sharing `cardSearchService`, `(filtersExpanded)` wired on both instances, no `[cardDragActive]` passed. Inspector remains at page level (not nested in bottom sheet).
- Task 3: SCSS added — `.cardSearchPage-desktop` with `display: contents` / `display: none` toggle, `app-bottom-sheet` display toggle, FAB fixed positioning with z-index 10, inspector z-index override `--inspector-z-index: 1001` on mobile portrait.
- Task 4: Build compiles successfully. Subtasks 4.2–4.8 are manual verification items for user testing.

### Change Log

- 2026-02-18: Implemented card search page mobile bottom sheet (Story 10.3) — added BreakpointObserver-based mobile portrait detection, auto-opening bottom sheet with card-searcher, FAB toggle, responsive CSS display toggles, and inspector z-index hierarchy. Replicates deck builder pattern (10.1/10.2).
- 2026-02-18: Code review fixes — [M1] unchecked Task 4 parent (subtasks 4.2-4.8 still manual); [M2] replaced hardcoded 767px breakpoint with `r.mobile-portrait` SCSS mixin and reused `NavbarCollapseService.isMobilePortrait` signal (removed local BreakpointObserver); [M3] added page-level Escape handler with `stopImmediatePropagation` to prevent double dismiss (inspector + bottom sheet); [L1] migrated constructor DI to `inject()` pattern; [L3] added `aria-expanded` on FAB for screen reader support.

### File List

- `front/src/app/pages/card-search-page/card-search-page.component.ts` (modified)
- `front/src/app/pages/card-search-page/card-search-page.component.html` (modified)
- `front/src/app/pages/card-search-page/card-search-page.component.scss` (modified)
- `front/src/app/styles/_responsive.scss` (modified — added `mobile-portrait` mixin)
