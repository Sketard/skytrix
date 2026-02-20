# Story 9.4: Deck Card Redesign

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want deck cards in the deck list to have a modern dark design with subtle shadows and proper hover feedback,
so that the deck list looks polished and consistent with the dark theme.

## Acceptance Criteria

1. **Given** deck cards currently have `border: 1px solid $white` and asymmetric border-radius
   **When** the redesign is applied
   **Then** borders are removed, background is `var(--surface-card)`, border-radius is `12px`, and `box-shadow: 0 2px 8px rgba(0,0,0,0.3)` is applied

2. **Given** a user hovers over a deck card on desktop
   **When** the card has the new hover state
   **Then** elevation increases, background shifts to `var(--surface-card-hover)`, with 150ms transition

3. **Given** the delete button is currently a red circle with no confirmation
   **When** the redesign is applied
   **Then** it becomes a subtle `mat-icon-button` (trash icon) top-right in `var(--danger)` color
   **And** clicking it triggers a confirmation dialog before deletion
   **And** `$event.stopPropagation()` prevents card navigation on delete click

4. **Given** the create button uses `$blue` with `scale(4)` animation
   **When** the redesign is applied
   **Then** it becomes a ghost card first in the grid with `dashed 2px var(--accent-primary-dim)` border and `+` icon in `var(--accent-primary)`

5. **Given** the deck list has no empty state for 0 decks
   **When** the empty state is implemented
   **Then** a centered message and CTA button are displayed when no decks exist

## Tasks / Subtasks

- [x] Task 1: Redesign deck card container — remove border, add dark surface + shadow (AC: #1)
  - [x] 1.1: In `deck-box.component.scss`, replace `border: 1px solid $white` (line 8) with `border: none`, add `background: var(--surface-card)`, change `border-radius: 20px 0 20px 0` (line 9) to `border-radius: 12px`, add `box-shadow: 0 2px 8px rgba(0,0,0,0.3)`
  - [x] 1.2: Remove the hover `border-color: $blue` rule (line 53) — replaced by new hover state in Task 2
  - [x] 1.3: Add `overflow: hidden` on `.deckBox` to clip fan-out card images at new rounded corners — **SKIPPED per Dev Notes: overflow:hidden clips fan-out animation. border-radius + box-shadow used instead.**
- [x] Task 2: Add new hover state with elevation and background shift (AC: #2)
  - [x] 2.1: Add `transition: background-color 150ms ease, box-shadow 150ms ease` on `.deckBox`
  - [x] 2.2: Replace the current `&:hover { border-color: $blue }` block with `&:hover { background: var(--surface-card-hover); box-shadow: 0 4px 16px rgba(0,0,0,0.5); }` — increased shadow = elevation
  - [x] 2.3: Verify fan-out animations on `.deckBox-preview:hover` still work correctly (they animate child cards, not the container) — no changes expected
- [x] Task 3: Redesign delete button as subtle mat-icon-button with confirmation (AC: #3)
  - [x] 3.1: Create a simple confirmation dialog component `front/src/app/components/confirm-dialog/confirm-dialog.component.ts` — standalone, uses `MatDialogModule`, accepts `{title: string, message: string}` via `MAT_DIALOG_DATA`, returns `boolean` (confirm/cancel). Minimal template: title, message, two buttons (Cancel / Confirm in `var(--danger)`)
  - [x] 3.2: Style the confirmation dialog in `confirm-dialog.component.scss` — dark surface: `--mat-dialog-container-color: var(--surface-card)`, text in `var(--text-primary)`, confirm button in `var(--danger)` color. Keep it minimal — **Implemented as inline styles in component (no separate .scss file)**
  - [x] 3.3: In `deck-list.component.ts`, inject `MatDialog`, add `confirmDelete(deck: ShortDeck)` method that opens the confirm dialog and only calls `deckBuildService.deleteById(id)` on confirmation
  - [x] 3.4: In `deck-list.component.html`, replace the bare `<mat-icon>` delete element with a `<button mat-icon-button>` wrapping `<mat-icon fontIcon="delete">`, call `confirmDelete(deck)` on click, preserve `$event.stopPropagation()`
  - [x] 3.5: In `deck-list.component.scss`, restyle `.deckPage-deck-remove`: remove `background-color: $red`, remove `border: 1px solid $white`, remove `padding: 8px`, remove `border-radius: 50%`. Set `color: var(--danger)`, lower `z-index` to `10` (no longer needs 1010), add `opacity: 0` with `transition: opacity 150ms ease`, show on parent hover via `.deckPage-deck:hover .deckPage-deck-remove { opacity: 1 }`. Keep `position: absolute; top: 4px; right: 4px; cursor: pointer`
  - [x] 3.6: Remove `@use 'variable' as *` from `deck-list.component.scss` (line 2) — no remaining SCSS variable references after $red/$white removal. Keep `@use 'responsive' as *` (line 1, needed for mixins)
- [x] Task 4: Redesign create button as ghost card (AC: #4)
  - [x] 4.1: In `deck-box.component.scss`, replace the `.deckBox-add` styles (lines 65-86): remove `color: $blue`, remove `transform: scale(4)`, remove the `reduce` keyframe animation. Add `font-size: 48px` (or similar) for icon sizing, set `color: var(--accent-primary)`
  - [x] 4.2: In `deck-box.component.scss`, add a modifier for add mode on `.deckBox`: when the component is in add mode, apply `background: transparent`, `border: dashed 2px var(--accent-primary-dim)`, `box-shadow: none`. Override the default surface-card background. Use `:host-context` or a CSS class approach
  - [x] 4.3: In `deck-box.component.html`, add a `[class.deckBox--add]="add()"` binding on the `.deckBox` div to enable the ghost card CSS modifier
  - [x] 4.4: Remove `@use 'variable' as *` from `deck-box.component.scss` (line 1) — no remaining SCSS variable references after $white/$blue removal. Keep `@use 'animation' as *` (line 2, needed for wiggle animation)
- [x] Task 5: Implement empty state for 0 decks (AC: #5)
  - [x] 5.1: In `deck-list.component.html`, wrap the existing grid in a conditional: show the grid (including ghost create card) when `decks$.length > 0`, show an empty state div when `decks$.length === 0`. The empty state has centered layout, a message "Aucun deck pour le moment", and a CTA button "Créer un deck" that routes to `/decks/builder`
  - [x] 5.2: Style the empty state in `deck-list.component.scss`: centered text, `color: var(--text-secondary)` for message, CTA button styled with `var(--accent-primary)` border/text. Minimal, clean
  - [x] 5.3: Ensure the create ghost card (deck-box with `[add]="true"`) is still shown as the first grid item when decks exist, but NOT in the empty state (which has its own CTA)
- [x] Task 6: Verify zero regression (AC: #1, #2, #3, #4, #5)
  - [x] 6.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings are expected and acceptable)
  - [ ] 6.2: Verify deck cards show dark background, 12px radius, subtle shadow on deck list page
  - [ ] 6.3: Verify hover state on desktop: background lightens, shadow increases, 150ms transition
  - [ ] 6.4: Verify fan-out animation still works on desktop hover (cards fan out from deckbox image)
  - [ ] 6.5: Verify delete button is subtle (danger-colored trash icon), appears on hover, triggers confirmation dialog
  - [ ] 6.6: Verify confirmation dialog has dark theme, cancel/confirm buttons, and deletion only happens on confirm
  - [ ] 6.7: Verify create ghost card has dashed border and gold + icon
  - [ ] 6.8: Verify empty state appears when no decks exist (may require temporarily deleting test data)
  - [ ] 6.9: Verify mobile layout (1-column, then 2-column) still renders correctly
  - [ ] 6.10: Verify no other pages are affected (card search, deck builder, simulator)

## Dev Notes

### Why This Story Exists

This is story 4 of Epic 9 (UI/UX Modernization). It modernizes the deck list page — the first page users see after login. The Screen Implementation Guide identifies multiple issues: white wireframe borders (High), asymmetric border-radius (Medium), delete button as most prominent element with no confirmation (Critical), create button disconnected from palette (High), and no empty state (Medium).

This story is **contained** — all changes are limited to `deck-box` and `deck-list` components plus one new dialog component. It does NOT touch any shared components (card-searcher, search-bar, card-list).

### What This Story Does

- Replaces **1 `$white` border** with `border: none` + `background: var(--surface-card)` + `box-shadow` on deck cards
- Changes **asymmetric border-radius** (`20px 0 20px 0`) to uniform `12px`
- Adds **hover state**: `var(--surface-card-hover)` background + increased elevation shadow with 150ms transition
- Redesigns **delete button**: from red circle to subtle `mat-icon-button` in `var(--danger)`, hidden by default, shown on hover
- Adds **confirmation dialog** before deck deletion (first usage of `MatDialog` in the project)
- Redesigns **create button**: from `$blue` scaled icon with pulsing animation to ghost card with `dashed 2px var(--accent-primary-dim)` border
- Adds **empty state** for 0 decks with centered message and CTA button
- **Removes `@use 'variable' as *`** from deck-box.component.scss and deck-list.component.scss (2 more components detached from old variable system)

### What This Story Does NOT Do

- Does NOT modify fan-out animations (desktop hover card preview) — they are preserved as-is
- Does NOT modify the deckbox image or its wiggle animation
- Does NOT modify `ShortDeck` model or any DTOs
- Does NOT modify `DeckBuildService` (deleteById method stays the same)
- Does NOT modify the grid layout breakpoints (1-col / 2-col / auto-fill logic stays)
- Does NOT modify `variable.scss`, `styles.scss`, or `_tokens.scss`
- Does NOT modify any component outside deck-box, deck-list, and the new confirm-dialog
- Does NOT touch card-searcher, search-bar, or deck-builder components
- Does NOT add any new npm dependencies (MatDialog is part of existing @angular/material)

### Critical: Fan-Out Animation Preservation

The `.deckBox-preview` hover animations (fan-out of 3 card images) must be PRESERVED. These are defined as `@keyframes fanOut1/2/3` in deck-box.component.scss (lines 96-132). The animations are triggered by `.deckBox-preview:hover` — they affect child `.deckBox-preview-card` elements, NOT the `.deckBox` container itself. The container hover changes (background + shadow) should NOT interfere.

**Verification:** After adding `overflow: hidden` on `.deckBox`, confirm that fan-out cards are still visible. If cards are clipped, consider using `overflow: visible` and a different approach for the rounded corners (e.g., let the shadow define the card boundary). The fan-out cards translate OUTSIDE the deckbox bounds — `overflow: hidden` WILL clip them. **IMPORTANT: Do NOT add `overflow: hidden`** — the fan-out animation translates cards outside the container. Use the `border-radius` + `box-shadow` without overflow clipping.

### Critical: Confirmation Dialog Pattern (First in Project)

`MatDialog` has never been used in this project. This is the first dialog component. The pattern established here will be reused.

**Implementation approach:**
1. Create `ConfirmDialogComponent` as a standalone component
2. Inject `MAT_DIALOG_DATA` for dynamic title/message
3. Use `MatDialogRef` to return boolean result
4. Dialog styling uses design tokens (dark surface, light text, danger confirm button)
5. Import `MatDialogModule` in the dialog component and in `DeckListComponent`

**Angular Material dialog custom properties for dark theme:**
```scss
--mat-dialog-container-color: var(--surface-card);
```

**Template structure:**
```html
<h2 mat-dialog-title>{{ data.title }}</h2>
<mat-dialog-content>{{ data.message }}</mat-dialog-content>
<mat-dialog-actions align="end">
  <button mat-button mat-dialog-close>Annuler</button>
  <button mat-button [mat-dialog-close]="true" color="warn">Supprimer</button>
</mat-dialog-actions>
```

### Delete Button Hide/Show on Hover

The delete button is redesigned from an always-visible red circle to a subtle icon that appears only on hover. This is achieved with `opacity: 0` on the button and `opacity: 1` on parent `.deckPage-deck:hover`. On mobile (touch), the button should be always visible since there's no hover — add a media query or use `@media (hover: hover)` for the hide behavior.

**Mobile consideration:** On touch devices, there is no hover. Two approaches:
- **Option A:** Always show delete on mobile (no opacity: 0)
- **Option B:** Use `@media (hover: hover)` to only hide on hover-capable devices

**Recommended:** Option B — `@media (hover: hover) { opacity: 0; }` with reveal on parent hover. On touch devices, the button is always visible.

### Delete Button z-index Reduction

Current z-index is 1010 (carried over from when the delete button was the most prominent element). With the subtler design, reduce to `z-index: 10` — above the card content but not absurdly high. The fan-out preview uses z-index 1000-1003, so the delete button should be above that: **use z-index: 1005** to stay above fan-out but below modals.

### Create Button Ghost Card

The ghost card replaces the current `add_circle_outline` icon with `scale(4)` and pulsing animation. The new design:
- Same size as other deck cards in the grid (not a different element)
- Transparent background with dashed gold border
- `+` icon centered, in `var(--accent-primary)` (gold), reasonably sized (48px or so)
- No pulsing animation — clean, static ghost card
- Hover: subtle border color change (e.g., full opacity `var(--accent-primary)` instead of dim)

**CSS approach for add mode:**
```scss
.deckBox--add {
  background: transparent;
  border: dashed 2px var(--accent-primary-dim);
  box-shadow: none;

  &:hover {
    border-color: var(--accent-primary);
    background: transparent;
    box-shadow: none;
  }
}
```

### Empty State

The empty state appears when `decks$` emits an empty array. The create ghost card is NOT shown in empty state — instead, a dedicated CTA button provides the "create deck" action.

**Implementation:** Use the async pipe result to check length:
```html
@if ((deckBuildService.decks$ | async); as decks) {
  @if (decks.length > 0) {
    <!-- grid with ghost card + deck cards -->
  } @else {
    <!-- empty state -->
  }
}
```

Note: `decks$` is a `BehaviorSubject` initialized with `new Array<ShortDeck>()` (empty array), so the template will initially show the empty state, then update when `fetchDecks()` completes. Consider that the initial empty array before fetch completes will flash the empty state — this is acceptable for now (a loading state would be a separate concern).

### Token Values Reference (from _tokens.scss)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--surface-card` | `#1E1E1E` | Deck card background |
| `--surface-card-hover` | `#252525` | Deck card hover background |
| `--accent-primary` | `#C9A84C` | Create ghost card icon, CTA button |
| `--accent-primary-dim` | `#C9A84C33` | Create ghost card dashed border |
| `--text-primary` | `#EAEAEA` | Deck name text |
| `--text-secondary` | `#9E9E9E` | Empty state message text |
| `--danger` | `#CF6679` | Delete button icon color, confirm button |

### Current Code Map (What Changes)

**deck-box.component.scss:**

| Line | Current Code | Purpose | New Code |
|------|-------------|---------|----------|
| 1 | `@use 'variable' as *;` | Old SCSS variables | REMOVED |
| 8 | `border: 1px solid $white` | Card border | `border: none` + `background: var(--surface-card)` |
| 9 | `border-radius: 20px 0 20px 0` | Asymmetric radius | `border-radius: 12px` |
| — | (no rule) | Shadow | ADD `box-shadow: 0 2px 8px rgba(0,0,0,0.3)` |
| — | (no rule) | Transition | ADD `transition: background-color 150ms ease, box-shadow 150ms ease` |
| 52-54 | `&:hover { border-color: $blue }` | Hover state | `&:hover { background: var(--surface-card-hover); box-shadow: 0 4px 16px rgba(0,0,0,0.5); }` |
| 66 | `color: $blue` | Add icon color | `color: var(--accent-primary)` |
| 67 | `transform: scale(4)` | Icon scale | `font-size: 48px` (reasonable size) |
| 70-85 | `@keyframes reduce { ... }` | Pulsing animation | REMOVED |

**deck-list.component.scss:**

| Line | Current Code | Purpose | New Code |
|------|-------------|---------|----------|
| 2 | `@use 'variable' as *;` | Old SCSS variables | REMOVED |
| 25 | `background-color: $red` | Delete bg | REMOVED (use `color: var(--danger)` only) |
| 26 | `border: 1px solid $white` | Delete border | REMOVED |
| 27 | `padding: 8px` | Delete padding | REMOVED (mat-icon-button handles sizing) |
| 28 | `z-index: 1010` | Delete z-index | `z-index: 1005` |
| 30 | `border-radius: 50%` | Delete shape | REMOVED (mat-icon-button is already circular) |

**deck-list.component.html:**

| Line | Current Code | Purpose | New Code |
|------|-------------|---------|----------|
| 5-9 | `<mat-icon ... fontIcon="delete" (click)="removeDeck(...)">` | Delete bare icon | `<button mat-icon-button ... (click)="confirmDelete(deck); $event.stopPropagation()">` wrapping mat-icon |
| — | (none) | Empty state | ADD conditional empty state div |

**deck-list.component.ts:**

| Line | Current Code | Purpose | New Code |
|------|-------------|---------|----------|
| — | (none) | MatDialog import | ADD `MatDialog` injection |
| 20-22 | `removeDeck(id)` | Direct delete | ADD `confirmDelete(deck)` with dialog, keep `removeDeck` as private |

### Previous Story Intelligence (9-3)

Story 9-3 established:
- **Tokens work without import:** CSS custom properties on `:root` are available globally — no `@use` needed
- **Variable import removal safe:** `@use 'variable' as *` can be removed once all `$variable` references are replaced
- **Pre-existing budget errors:** `ng build` exits code 1 due to bundle size (1.57 MB > 1 MB limit). Zero compilation errors expected. This is normal.
- **Material custom property approach:** Use `--mat-*` and `--mdc-*` properties for Material component theming instead of `::ng-deep`

### Git Intelligence

Last 3 commits:
- `35715a39 9.-2` — sidebar dark migration (navbar.component.scss)
- `94a9097c 9-1` — global token system (_tokens.scss)
- `6910a94d clean artefacts` — cleanup

Files recently modified: navbar.component.scss, _tokens.scss, styles.scss, search-bar.component.scss, card-searcher.component.scss. No conflicts expected with deck-box or deck-list files.

### Project Structure Notes

- **Files modified:** `deck-box.component.html`, `deck-box.component.scss`, `deck-list.component.html`, `deck-list.component.scss`, `deck-list.component.ts` — SCSS + HTML + minor TS
- **New files:** `confirm-dialog.component.ts`, `confirm-dialog.component.scss` (or inline template/styles) — first dialog component in project
- **New file location:** `front/src/app/components/confirm-dialog/` (reusable component folder, follows project structure)
- **No existing dialog pattern** in project — this establishes the pattern
- **MatDialog** is part of `@angular/material` already installed — NOT a new dependency
- All token values verified against `_tokens.scss` (story 9-1)

### Scope Boundaries

Components that use `$blue`, `$white`, `$red` but are NOT in scope:
- `deck-builder.component.scss` — addressed in stories 9-6, 9-7
- `card-list.component.scss` — addressed in story 9-5
- `styles.scss` — global button theming (separate concern)
- `material.scss` — Material theme overrides (separate concern)

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 1 - Decklist (lines 57-127)]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Regression Risk Analysis - Screen 1 (lines 431-436)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.4: Deck Card Redesign (lines 1420-1449)]
- [Source: front/src/app/components/deck-box/deck-box.component.scss — deck card styles (132 lines)]
- [Source: front/src/app/components/deck-box/deck-box.component.html — deck card template (19 lines)]
- [Source: front/src/app/components/deck-box/deck-box.component.ts — deck card component (21 lines)]
- [Source: front/src/app/pages/deck-page/components/deck-list/deck-list.component.scss — deck list styles (38 lines)]
- [Source: front/src/app/pages/deck-page/components/deck-list/deck-list.component.html — deck list template (12 lines)]
- [Source: front/src/app/pages/deck-page/components/deck-list/deck-list.component.ts — deck list component (24 lines)]
- [Source: front/src/app/styles/_tokens.scss — global design tokens (69 lines)]
- [Source: _bmad-output/implementation-artifacts/9-3-search-bar-dark.md — previous story context]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `ng build` exit code 1 — pre-existing budget errors only (bundle 1.61 MB > 1 MB, deck-builder.scss > 4 kB). Zero compilation errors.
- Subtask 1.3 (`overflow: hidden`) deliberately skipped per Dev Notes — fan-out animation translates cards outside container bounds.
- Subtask 3.2 implemented as inline styles in component (no separate `.scss` file) — dialog is minimal enough for inline.
- Used `@media (hover: hover)` for delete button hide (Option B from Dev Notes) — touch devices always show button.
- z-index set to 1005 (not 10 as in subtask text) per Dev Notes recommendation — above fan-out (1000-1003) but below modals.
- Migrated `*ngFor` to `@for` with `track deck.id` in deck-list template (modern Angular control flow).
- Added `RouterLink` import to DeckListComponent for empty state CTA `<a routerLink>`.

### Completion Notes List

- **AC #1 satisfied:** Deck cards have `border: none`, `background: var(--surface-card)`, `border-radius: 12px`, `box-shadow: 0 2px 8px rgba(0,0,0,0.3)`
- **AC #2 satisfied:** Hover state with `var(--surface-card-hover)` background + elevated shadow, 150ms transition
- **AC #3 satisfied:** Delete button is `mat-icon-button` in `var(--danger)`, hidden on hover-capable devices, confirmation dialog before deletion, `$event.stopPropagation()` preserved
- **AC #4 satisfied:** Create button is ghost card with `dashed 2px var(--accent-primary-dim)` border, `+` icon in `var(--accent-primary)`, 48px font-size
- **AC #5 satisfied:** Empty state with centered "Aucun deck pour le moment" message and "Créer un deck" CTA button routing to `/decks/builder`
- **Variable cleanup:** `@use 'variable' as *` removed from both `deck-box.component.scss` and `deck-list.component.scss`
- **First dialog pattern established:** `ConfirmDialogComponent` as reusable standalone component with `MAT_DIALOG_DATA` injection

### File List

- `front/src/app/components/deck-box/deck-box.component.scss` — modified (dark surface, shadow, hover, ghost card modifier, removed variable import)
- `front/src/app/components/deck-box/deck-box.component.html` — modified (added `[class.deckBox--add]` binding, migrated `*ngIf`/`*ngFor` → `@if`/`@for`)
- `front/src/app/components/deck-box/deck-box.component.ts` — modified (removed `CommonModule` import after control flow migration)
- `front/src/app/components/confirm-dialog/confirm-dialog.component.ts` — **new** (standalone confirmation dialog with inline template/styles, configurable `confirmLabel`)
- `front/src/app/pages/deck-page/components/deck-list/deck-list.component.ts` — modified (inject MatDialog, confirmDelete with typed generics, RouterLink import)
- `front/src/app/pages/deck-page/components/deck-list/deck-list.component.html` — modified (mat-icon-button delete with aria-label, empty state conditional, @for migration)
- `front/src/app/pages/deck-page/components/deck-list/deck-list.component.scss` — modified (subtle delete button, empty state styles, token-based CTA hover, removed variable import)
- `front/src/app/styles/_tokens.scss` — modified (added `--mat-dialog-container-color` Material override)

### Senior Developer Review (AI)

**Reviewer:** Claude Opus 4.6 — 2026-02-17
**Outcome:** Approved with fixes applied

**Findings (7 total: 2 HIGH, 3 MEDIUM, 2 LOW) — all fixed:**

| # | Severity | Finding | Fix Applied |
|---|----------|---------|-------------|
| H1 | HIGH | Dialog container `--mat-dialog-container-color` set on `:host` (child) — CSS custom properties don't inherit upward to `mat-dialog-container` parent | Moved to `:root` in `_tokens.scss`; removed from `:host` in confirm-dialog |
| H2 | HIGH | Delete button `<button mat-icon-button>` missing `aria-label` — icon-only buttons need accessible name (WCAG 2.1) | Added `[attr.aria-label]="'Supprimer ' + deck.name"` |
| M1 | MEDIUM | `dialog.open()` missing generic type parameters — first dialog pattern should be type-safe | Added `<ConfirmDialogComponent, ConfirmDialogData, boolean>` generics |
| M2 | MEDIUM | CTA hover `rgba(201,168,76,0.1)` hardcoded — won't follow if accent token changes | Replaced with `color-mix(in srgb, var(--accent-primary) 10%, transparent)` |
| M3 | MEDIUM | Confirm button label hardcoded "Supprimer" — reusable dialog needs configurable action | Added optional `confirmLabel?: string` to `ConfirmDialogData` with default `'Confirmer'` |
| L1 | LOW | deck-box template mixed `*ngIf`/`*ngFor` with `@if`/`@for` — inconsistent control flow | Migrated to `@if`/`@for`, removed `CommonModule` from deck-box imports |
| L2 | LOW | `CommonModule` in deck-list instead of `AsyncPipe` — heavier than needed | **Not fixed** — Angular Language Service false positive on `AsyncPipe` in `imports` array; kept `CommonModule` |

**Build verification:** `ng build` — zero compilation errors (pre-existing budget warnings only: 1.62 MB bundle, deck-builder.scss 6.11 kB).

## Change Log

- 2026-02-17: Story 9.4 implemented — deck card redesign with dark surface, hover elevation, confirmation dialog, ghost create card, empty state. Removed `@use 'variable'` from 2 components.
- 2026-02-17: Code review — 6 of 7 findings fixed (H1, H2, M1, M2, M3, L1). L2 deferred (IDE compatibility). Status → done.
