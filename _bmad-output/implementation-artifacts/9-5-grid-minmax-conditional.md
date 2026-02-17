# Story 9.5: Grid Minmax Conditional

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the card grid to use appropriate minimum column widths depending on context,
So that cards are legible on the standalone search page while fitting in the deck builder's narrower side panel.

## Acceptance Criteria

1. **Given** `card-list` is a shared component used in both card search page and deck builder
   **When** the grid minmax is made conditional
   **Then** the standalone search page uses `minmax(100px, 1fr)` for better readability
   **And** the deck builder context uses `minmax(85px, 1fr)` to fit the narrower side panel

2. **Given** the deck builder passes `deckBuildMode=true` input
   **When** this input is used as CSS class discriminant
   **Then** the correct minmax value is applied per context via CSS

3. **Given** grid gap is currently `0.5em`
   **When** the update is applied
   **Then** gap increases to `0.75em` for breathing room

4. **Given** the grid changes are applied
   **When** both the card search page and deck builder are tested
   **Then** card grids render correctly in both contexts at all breakpoints

## Tasks / Subtasks

- [x] Task 1: Add `deckBuildMode` CSS class binding to `.cardsContainer` in template (AC: #2)
  - [x] 1.1: Add `[class.deckBuildMode]="deckBuildMode()"` to the `.cardsContainer` div in `card-list.component.html` (line 1) — this enables CSS-only differentiation without changing TS logic
- [x] Task 2: Make grid minmax conditional and increase gap (AC: #1, #3)
  - [x] 2.1: Change `.cardsContainer` gap from `0.5em` to `0.75em` (line 9) — global increase for breathing room in both contexts
  - [x] 2.2: Replace the single MOSAIC/FAVORITE grid rule (lines 11-15) with two rules:
    - Default (standalone): `&.MOSAIC, &.FAVORITE { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }`
    - Deck builder: `&.MOSAIC.deckBuildMode, &.FAVORITE.deckBuildMode { grid-template-columns: repeat(auto-fill, minmax(85px, 1fr)); }`
- [ ] Task 3: Verify zero regression (AC: #4)
  - [x] 3.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings are expected)
  - [ ] 3.2: Verify card search page (standalone): MOSAIC grid uses ~100px minimum columns with 0.75em gap
  - [ ] 3.3: Verify deck builder side panel: MOSAIC grid uses ~85px minimum columns with 0.75em gap
  - [ ] 3.4: Verify FAVORITE mode behaves identically to MOSAIC in both contexts
  - [ ] 3.5: Verify drag-and-drop still works in deck builder (deckBuildMode-dependent functionality unaffected)

## Dev Notes

### Why This Story Exists

This is story 5 of Epic 9 (UI/UX Modernization). The card-list component uses a single `minmax(85px, 1fr)` for all contexts, but the standalone search page has a much wider viewport than the deck builder side panel (280-360px). Using 100px minimum on standalone gives better card readability, while the deck builder must stay at 85px to fit 3+ columns in its narrow panel. The Screen Implementation Guide rates the grid minmax as **HIGH severity risk** — if the wrong minmax is applied in the deck builder, the side panel grid breaks.

### What This Story Does

- Adds `deckBuildMode` CSS class to `.cardsContainer` div in template — CSS-only discriminant, no new TS logic
- Changes standalone MOSAIC/FAVORITE minmax from `85px` to `100px` (bigger cards, better readability)
- Keeps deck builder MOSAIC/FAVORITE minmax at `85px` (fits the narrow 280-360px side panel)
- Increases grid `gap` globally from `0.5em` to `0.75em` for better visual spacing

### What This Story Does NOT Do

- Does NOT modify the card-list TypeScript component — `deckBuildMode` input already exists (line 38)
- Does NOT modify card-searcher or deck-builder components — only touches card-list HTML and SCSS
- Does NOT change INFORMATIVE or OWNED display modes' grid layout — only MOSAIC/FAVORITE grid-template-columns are context-sensitive. The gap increase is global across all display modes.
- Does NOT modify any color, token, or theme — purely layout/sizing changes
- Does NOT change drag-and-drop behavior — `cdkDragDisabled` binding is already on the template and unaffected

### Implementation Approach: CSS Class Discriminant

The `deckBuildMode` input already exists on `CardListComponent` (line 38 of .ts file, `input<boolean>(false)`). Adding `[class.deckBuildMode]="deckBuildMode()"` to the `.cardsContainer` div enables purely CSS-driven differentiation:

**Current state (card-list.component.html line 1):**
```html
<div class="cardsContainer" [ngClass]="displayMode()" cdkDropList ...>
```

**After change:**
```html
<div class="cardsContainer" [ngClass]="displayMode()" [class.deckBuildMode]="deckBuildMode()" cdkDropList ...>
```

This makes the rendered DOM:
- Standalone search: `<div class="cardsContainer MOSAIC">`
- Deck builder: `<div class="cardsContainer MOSAIC deckBuildMode">`

### CSS Rule Structure

**Current (card-list.component.scss lines 5-16):**
```scss
.cardsContainer {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
  gap: 0.5em;

  &.MOSAIC,
  &.FAVORITE {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(85px, 1fr));
  }
}
```

**After change:**
```scss
.cardsContainer {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
  gap: 0.75em;

  &.MOSAIC,
  &.FAVORITE {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  }

  &.MOSAIC.deckBuildMode,
  &.FAVORITE.deckBuildMode {
    grid-template-columns: repeat(auto-fill, minmax(85px, 1fr));
  }
}
```

The `.deckBuildMode` selector has higher specificity (3 classes) than the default (2 classes), so it naturally overrides. No `!important` needed.

### Deck Builder Side Panel Width Context

The deck builder side panel width varies by breakpoint:
- Mobile portrait: full width (100vw) — but only shows one panel at a time
- Landscape/tablet: 280-360px side panel

With `minmax(85px, 1fr)` at 280px panel width:
- 280px ÷ 85px = ~3.3 → 3 columns (good)

With `minmax(100px, 1fr)` at 280px panel width:
- 280px ÷ 100px = 2.8 → 2 columns (too few, wastes space, cards too large)

This is why the deck builder MUST keep 85px — confirmed by the Screen Implementation Guide risk analysis.

### Previous Story Intelligence (9-3)

Story 9-3 migrated search-bar and card-searcher styles to dark theme. Key learnings:
- `ng build` exits code 1 due to pre-existing bundle size budget (1.57 MB > 1 MB limit). Zero compilation errors expected.
- Card-list SCSS still uses `@use 'variable' as *` and `@use 'mixin' as *` — these are NOT removed by this story (out of scope, only grid layout changes)

### Files Modified

Only **2 files** are touched, both in card-list component:
1. `front/src/app/components/card-list/card-list.component.html` — add `[class.deckBuildMode]` binding
2. `front/src/app/components/card-list/card-list.component.scss` — conditional minmax + gap increase

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Card Grid Mosaic (lines 176-182)]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Risk Assessment (lines 440-441)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.5: Grid Minmax Conditional (lines 1450-1473)]
- [Source: front/src/app/components/card-list/card-list.component.scss — current grid styles (253 lines)]
- [Source: front/src/app/components/card-list/card-list.component.html — card list template (77 lines)]
- [Source: front/src/app/components/card-list/card-list.component.ts — component class with deckBuildMode input (line 38)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- Added `[class.deckBuildMode]="deckBuildMode()"` binding to `.cardsContainer` div in card-list template — CSS-only discriminant, no TS changes
- Changed grid gap from `0.5em` to `0.75em` globally (both standalone and deck builder contexts)
- Split MOSAIC/FAVORITE grid rule into two: standalone uses `minmax(100px, 1fr)`, deck builder uses `minmax(85px, 1fr)`
- Specificity-based override: `.MOSAIC.deckBuildMode` (3 classes) naturally overrides `.MOSAIC` (2 classes) — no `!important`
- `ng build` passes with zero compilation errors (pre-existing budget warnings only)
- Visual verification tasks (3.2–3.5) left for manual user review

### Change Log

- 2026-02-17: Implemented story 9-5 — made card grid minmax conditional (100px standalone, 85px deck builder) and increased gap to 0.75em. Added deckBuildMode CSS class binding to card-list template.
- 2026-02-17: Code review — Fixed 3 issues: (1) Task 3 [x]→[ ] to reflect 4/5 incomplete subtasks, (2) corrected "Does NOT change" scope doc to acknowledge global gap change, (3) multi-line formatted HTML template opening tag for readability.

### File List

- front/src/app/components/card-list/card-list.component.html (modified — added `[class.deckBuildMode]` binding)
- front/src/app/components/card-list/card-list.component.scss (modified — conditional minmax + gap increase)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/9-5-grid-minmax-conditional.md (created)
