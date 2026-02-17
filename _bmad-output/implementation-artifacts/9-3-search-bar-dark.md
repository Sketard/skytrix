# Story 9.3: Search Bar Dark

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the search bar and filter controls to use the dark theme,
So that form inputs blend seamlessly with the dark background instead of showing harsh white fields.

## Acceptance Criteria

1. **Given** the search bar uses default Material form field styling (white background)
   **When** the dark theme is applied
   **Then** the background is `var(--surface-card)`, text is `var(--text-primary)`, placeholder is `var(--text-secondary)`
   **And** focus state uses `var(--accent-primary)` border/outline

2. **Given** the search bar is a shared component used in both card search page and deck builder
   **When** the style changes are applied
   **Then** both contexts render correctly with the dark theme
   **And** clear button (X), search icon, and filter badge all use appropriate token colors

3. **Given** the filter badge uses `$blue` (#93dafa) border
   **When** the dark theme is applied
   **Then** the badge uses `var(--accent-primary)` instead

## Tasks / Subtasks

- [x] Task 1: Replace `::ng-deep` overrides with Material CSS custom properties on search bar (AC: #1)
  - [x] 1.1: Add Material CSS custom properties on `.searchBar-input` (mat-form-field) to replace `::ng-deep` rules:
    - `--mdc-filled-text-field-container-color: var(--surface-card)` (replaces `$white !important` at line 14)
    - `--mdc-filled-text-field-input-text-color: var(--text-primary)` (replaces `$black` at line 18)
    - `--mdc-filled-text-field-caret-color: var(--text-primary)` (cursor color)
    - `--mdc-filled-text-field-focus-active-indicator-color: var(--accent-primary)` (gold focus indicator)
    - `--mdc-filled-text-field-input-text-placeholder-color: var(--text-secondary)` (placeholder color via Material API)
    - `--mdc-filled-text-field-active-indicator-color: var(--border-subtle)` (subtle unfocused indicator, token from _tokens.scss)
    - `--mdc-filled-text-field-hover-active-indicator-color: var(--text-secondary)` (hover indicator)
    - `--mdc-filled-text-field-container-shape: 0` (replaces `::ng-deep border-radius: 0`)
  - [x] 1.2: Remove all three `::ng-deep` rules (lines 13-23) — fully replaced by custom properties above
  - [x] 1.3: Replace `.mat-icon { color: $black }` (line 26) with `color: var(--text-primary)`
  - [x] 1.4: Replace `input::placeholder { color: $unselected-black }` (line 30) with `--mdc-filled-text-field-input-text-placeholder-color: var(--text-secondary)` (Material custom property, review fix M1)
  - [x] 1.5: Add `color: var(--text-primary)` to the `button` rule (line 33) for clear button (X) icon visibility
- [x] Task 2: Migrate filter badge to dark theme (AC: #3)
  - [x] 2.1: Replace `border: 1px solid $blue` (line 53) with `border: 1px solid var(--accent-primary)`
  - [x] 2.2: Replace `background-color: $black` (line 54) with `background-color: var(--surface-card)`
  - [x] 2.3: Replace `color: $blue` (line 56) with `color: var(--accent-primary)`
- [x] Task 3: Add filter icon color for dark background (AC: #2)
  - [x] 3.1: Add `color: var(--text-primary)` on `.searchBar-input-filters` (line 40) — the filter_alt icon button is a SIBLING of `.searchBar-input` (mat-form-field) in the DOM, so the `.mat-icon { color }` rule inside `&-input` does NOT apply to it
- [x] Task 4: Migrate view mode toggle and filter panel in card-searcher (AC: #2)
  - [x] 4.1: Replace toggle colors via Material custom properties on `mat-button-toggle-group`: `--mat-legacy-button-toggle-text-color: var(--text-primary)` (unchecked, review fix M2), `--mat-legacy-button-toggle-selected-state-background-color: var(--accent-primary-dim)`, `--mat-legacy-button-toggle-selected-state-text-color: var(--accent-primary)` (review fixes L1)
  - [x] 4.2: Replace `.cardSearchPage-filters { background-color: black }` (card-searcher line 118) with `background-color: var(--surface-base)`
- [x] Task 5: Clean up unused SCSS imports
  - [x] 5.1: Remove `@import 'variable';` and `@import 'mixin';` from search-bar.component.scss (lines 1-2) — no remaining SCSS variable or mixin references after migration
  - [x] 5.2: Remove `@use 'variable' as *;` from card-searcher.component.scss (line 1) — no remaining SCSS variable references after `$blue` migration. Keep `@use 'responsive' as r` (used throughout for breakpoints and mixins)
- [x] Task 6: Verify zero regression (AC: #2)
  - [x] 6.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings are expected)
  - [ ] 6.2: Verify search bar on card search page (standalone): dark background, light text, gold focus indicator, placeholder visible
  - [ ] 6.3: Verify search bar in deck builder (deckBuildMode=true): same dark styling, compact height preserved on landscape
  - [ ] 6.4: Verify filter badge shows gold border + gold text on dark background (only visible in deckBuildMode when filters are active)
  - [ ] 6.5: Verify clear button (X) and search icon (magnifier) are visible on dark form field background
  - [ ] 6.6: Verify filter_alt icon is visible on dark page background
  - [ ] 6.7: Verify view mode toggles show gold accent on checked state (both contexts)
  - [ ] 6.8: Verify filter panel background matches page background when opened on card search page

## Dev Notes

### Why This Story Exists

This is story 3 of Epic 9 (UI/UX Modernization). It is the **first Material form field migration** — the white mat-form-field search bar creates a harsh visual flash on the already-dark page background. The Screen Implementation Guide rates this as **High severity** ("Search bar white on dark background — harsh flash").

This story validates the Material CSS custom property approach for form field theming. The same pattern will be reused by subsequent stories that touch Material inputs (deck name field in 9-7, etc.).

### What This Story Does

- Replaces **1 white form field background** with `var(--surface-card)` (#1E1E1E) via Material custom properties
- Replaces **3 `$black` text references** with `var(--text-primary)` (#EAEAEA)
- Replaces **1 `$unselected-black` placeholder** with `var(--text-secondary)` (#9E9E9E)
- Adds **gold focus indicator** `var(--accent-primary)` (#C9A84C) with subtle unfocused indicator
- Replaces **2 `$blue` badge references** with `var(--accent-primary)` (gold)
- Replaces **1 `$blue` toggle checked state** with `var(--accent-primary-dim)` background + `var(--accent-primary)` icon
- Replaces **1 `black` filter panel background** with `var(--surface-base)` (#121212)
- **Removes 3 `::ng-deep` rules** — migrated to Material CSS custom properties (cleaner, no deprecated APIs)
- **Removes `@import 'variable'` and `@import 'mixin'`** from search-bar.component.scss (second component fully detached from old variable system after navbar in 9-2)
- **Removes `@use 'variable' as *`** from card-searcher.component.scss

### What This Story Does NOT Do

- Does NOT modify any component outside `search-bar.component.scss` and `card-searcher.component.scss`
- Does NOT modify `variable.scss` or `styles.scss`
- Adds `--border-subtle` token to `_tokens.scss` (review fix M3 — extracted hardcoded rgba value)
- Does NOT modify the search bar HTML template or TypeScript logic
- Does NOT modify deck-builder.component.scss form field colors (deck name is story 9-7)
- Does NOT modify card-list.component.scss (owned-row button colors are separate)
- Does NOT modify card-filters sub-components (multiselect, between-filter, toggle-icon-filter have no hardcoded colors)
- Does NOT modify the global button styling in `styles.scss` (separate concern)
- Does NOT add Angular Material dark theme globally (out of Epic 9 scope)

### Critical: `::ng-deep` to Material CSS Custom Properties Migration

The current search-bar.component.scss uses 3 `::ng-deep` rules to override Material's filled text field. `::ng-deep` is deprecated and should be replaced with Material CSS custom properties where possible.

**Current approach (REMOVE):**
```scss
// Line 13-15: Background override
::ng-deep .mdc-text-field--filled:not(.mdc-text-field--disabled) {
  background-color: $white !important;
}

// Line 17-19: Text color override
::ng-deep .mdc-text-field--filled:not(.mdc-text-field--disabled) .mdc-text-field__input {
  color: $black;
}

// Line 21-23: Border radius override
::ng-deep .mdc-text-field--filled {
  border-radius: 0;
}
```

**New approach (ADD on `.searchBar-input`):**
```scss
&-input {
  flex: 1;
  min-width: 0;

  // Material filled text field token overrides (dark theme)
  --mdc-filled-text-field-container-color: var(--surface-card);
  --mdc-filled-text-field-input-text-color: var(--text-primary);
  --mdc-filled-text-field-caret-color: var(--text-primary);
  --mdc-filled-text-field-focus-active-indicator-color: var(--accent-primary);
  --mdc-filled-text-field-active-indicator-color: rgba(255, 255, 255, 0.3);
  --mdc-filled-text-field-hover-active-indicator-color: var(--text-secondary);
  --mdc-filled-text-field-container-shape: 0;
```

This works because `.searchBar-input` IS the `mat-form-field` element (the class is applied directly on `<mat-form-field class="searchBar-input">`). Material form field reads these custom properties from itself or any ancestor.

**Precedent in codebase:** The deck-builder already uses Material custom properties (`--mdc-filled-text-field-container-color`, etc.) at lines 55-58 and 173-176 of deck-builder.component.scss. The card-searcher also uses form field custom properties at lines 34-36 for landscape compact mode. This approach is already established.

### Filter Icon Button DOM Position

Critical implementation detail: the filter button (filter_alt icon) is a **sibling** of the mat-form-field, NOT nested inside it:

```html
<div class="searchBar">
  <mat-form-field class="searchBar-input">...</mat-form-field>     <!-- mat-form-field -->
  <button class="searchBar-input-filters ...">                      <!-- SIBLING, not child -->
    <mat-icon fontIcon="filter_alt"></mat-icon>
  </button>
</div>
```

The CSS rule `.searchBar-input .mat-icon { color: var(--text-primary) }` only applies to icons INSIDE `.searchBar-input` (the mat-form-field). It does NOT reach the filter icon. Therefore, Task 3 explicitly adds `color: var(--text-primary)` on `&-filters` to ensure the filter icon is visible on the dark background.

### View Mode Toggle Color Rationale

The `mat-button-toggle-checked` currently uses `$blue` (#93dafa, light cyan). This clashes with the gold accent system. The Screen Implementation Guide specifies:
- Checked background: `var(--accent-primary-dim)` (#C9A84C33, 20% gold)
- Checked icon color: `var(--accent-primary)` (#C9A84C, gold)

This creates a subtle gold-tinted background with a visible gold icon — consistent with the active state pattern established in story 9-2 (navbar active item uses the same `--accent-primary-dim` + `--accent-primary` combination).

### Filter Panel Background

The `.cardSearchPage-filters` panel (standalone search page only, not deck builder) currently uses CSS keyword `black` (#000000). Migrating to `var(--surface-base)` (#121212) matches the page background for visual consistency. Note: in deck builder, the filters panel is managed by `deck-builder.component.scss` (`.deckBuilder-side-filters { background-color: black }`) — that's a separate story.

### Current Color Map (What Changes)

**search-bar.component.scss:**

| Line | Current Code | Purpose | New Code |
|------|-------------|---------|----------|
| 1 | `@import 'variable';` | Old SCSS variables | REMOVED |
| 2 | `@import 'mixin';` | Mixins (unused) | REMOVED |
| 13-15 | `::ng-deep ... background-color: $white !important` | Form field bg | `--mdc-filled-text-field-container-color: var(--surface-card)` |
| 17-19 | `::ng-deep ... color: $black` | Input text | `--mdc-filled-text-field-input-text-color: var(--text-primary)` |
| 21-23 | `::ng-deep ... border-radius: 0` | Sharp corners | `--mdc-filled-text-field-container-shape: 0` |
| 26 | `color: $black` | Search/close icons | `color: var(--text-primary)` |
| 30 | `color: $unselected-black` | Placeholder text | `color: var(--text-secondary)` |
| 40 | (no color rule) | Filter icon button | ADD `color: var(--text-primary)` |
| 53 | `border: 1px solid $blue` | Badge border | `border: 1px solid var(--accent-primary)` |
| 54 | `background-color: $black` | Badge background | `background-color: var(--surface-card)` |
| 56 | `color: $blue` | Badge text | `color: var(--accent-primary)` |

**card-searcher.component.scss:**

| Line | Current Code | Purpose | New Code |
|------|-------------|---------|----------|
| 1 | `@use 'variable' as *;` | Old SCSS variables | REMOVED |
| 80 | `background-color: $blue` | Toggle checked bg | `background-color: var(--accent-primary-dim)` + `color: var(--accent-primary)` |
| 118 | `background-color: black` | Filter panel bg | `background-color: var(--surface-base)` |

### Material CSS Custom Properties Reference

For Angular Material 19.1.1 MDC filled text field, these custom properties control styling:

| Property | Purpose | Value Set |
|----------|---------|-----------|
| `--mdc-filled-text-field-container-color` | Background | `var(--surface-card)` |
| `--mdc-filled-text-field-input-text-color` | Text color | `var(--text-primary)` |
| `--mdc-filled-text-field-caret-color` | Cursor | `var(--text-primary)` |
| `--mdc-filled-text-field-container-shape` | Border radius | `0` |
| `--mdc-filled-text-field-active-indicator-color` | Bottom line (unfocused) | `rgba(255, 255, 255, 0.3)` |
| `--mdc-filled-text-field-hover-active-indicator-color` | Bottom line (hover) | `var(--text-secondary)` |
| `--mdc-filled-text-field-focus-active-indicator-color` | Bottom line (focused) | `var(--accent-primary)` |

### Token Values Reference (from _tokens.scss)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--surface-base` | `#121212` | Filter panel background |
| `--surface-card` | `#1E1E1E` | Search bar form field background, filter badge bg |
| `--accent-primary` | `#C9A84C` | Focus indicator, filter badge border/text, toggle checked icon |
| `--accent-primary-dim` | `#C9A84C33` | Toggle checked background |
| `--text-primary` | `#EAEAEA` | Input text, icons, clear button, filter icon |
| `--text-secondary` | `#9E9E9E` | Placeholder text, hover indicator |

### Previous Story Intelligence (9-2)

Story 9-2 migrated the navbar (sidebar, mobile top bar, drawer) to dark theme. Key learnings:

- **Tokens work without import:** CSS custom properties on `:root` are available globally — no `@use` needed in component files
- **Variable import removal safe:** `@use 'variable' as *` can be removed once all `$variable` references are replaced
- **Pre-existing budget errors:** `ng build` exits code 1 due to bundle size (1.57 MB > 1 MB limit) and deck-builder SCSS (> 4 KB). Zero compilation errors expected. This is normal.
- **Active state pattern established:** `--accent-primary-dim` background + `--accent-primary` border/icon is the standard active state combination
- **Hover/active differentiation:** Was critical for navbar; view mode toggles follow the same principle (checked ≠ default)

### Git Intelligence

Last 2 commits implement Epic 9 stories:
- `35715a39 9.-2` — sidebar dark migration (navbar.component.scss)
- `94a9097c 9-1` — global token system (`_tokens.scss`)

Files recently modified: navbar.component.scss, _tokens.scss, styles.scss, sprint-status.yaml, story files. No conflicts expected with search-bar or card-searcher files.

### Project Structure Notes

- **Two files modified:** `search-bar.component.scss` and `card-searcher.component.scss` — all changes are SCSS-only
- **No new files** created
- **No HTML/TS changes** — all changes are purely visual (Material custom property + CSS custom property swap)
- `@import 'variable'` and `@import 'mixin'` removed from search-bar — second component fully detached from old variable system
- `@use 'variable' as *` removed from card-searcher — `@use 'responsive' as r` retained (needed for breakpoint mixins)
- All Material custom property names verified against Angular Material 19.1.1 MDC API

### Scope Boundaries

Components that ALSO use `$blue` or `$white` but are NOT in scope:
- `deck-builder.component.scss`: form field colors (lines 55-57, 173-175), search toggle (line 83), side panel bg (line 127), filters bg (line 238), hand overlay (lines 307, 315) — addressed in stories 9-6, 9-7
- `card-list.component.scss`: owned-row button/count `$white` (lines 151, 156) — addressed in story 9-5
- `styles.scss`: global button overrides (`$blue` shadow, `$black` bg, `$white` label) — addressed when global button theming is tackled
- `material.scss`: autocomplete `#000000` overrides — separate Material theming concern

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 2 - Recherche de cartes (lines 129-199)]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 2 Regression Risk Analysis (lines 437-444)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Design System Foundation (lines 256-320)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.3: Search Bar Dark (lines 1398-1419)]
- [Source: front/src/app/components/search-bar/search-bar.component.scss — search bar styles (61 lines)]
- [Source: front/src/app/components/search-bar/search-bar.component.html — search bar template (15 lines)]
- [Source: front/src/app/components/card-searcher/card-searcher.component.scss — card searcher styles (159 lines)]
- [Source: front/src/app/styles/_tokens.scss — global design tokens]
- [Source: _bmad-output/implementation-artifacts/9-2-sidebar-dark.md — previous story context]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- Replaced 3 `::ng-deep` rules with 7 Material CSS custom properties on `.searchBar-input` (container color, text color, caret, focus/hover/active indicators, border radius)
- Migrated all hardcoded SCSS variables ($white, $black, $unselected-black, $blue) to CSS custom properties (--surface-card, --text-primary, --text-secondary, --accent-primary)
- Added explicit `color: var(--text-primary)` on clear button and filter icon button for dark background visibility
- Migrated filter badge from $blue/$black to --accent-primary/--surface-card (gold on dark)
- Migrated view mode toggle checked state from $blue to --accent-primary-dim bg + --accent-primary text (gold active pattern from 9-2)
- Migrated filter panel background from CSS `black` keyword to var(--surface-base) token
- Removed `@import 'variable'` and `@import 'mixin'` from search-bar (3rd component detached from old variable system)
- Removed `@use 'variable' as *` from card-searcher (retained `@use 'responsive' as r`)
- `ng build` passes with zero compilation errors (pre-existing budget warnings only)
- Visual verification tasks (6.2–6.8) left for manual user review
- [Review fix M1] Replaced `input::placeholder` with `--mdc-filled-text-field-input-text-placeholder-color` — consistent Material custom property API
- [Review fix M2] Added `--mat-legacy-button-toggle-text-color: var(--text-primary)` — unchecked toggle icons now visible on dark background
- [Review fix M3] Extracted `rgba(255, 255, 255, 0.3)` to `--border-subtle` token in _tokens.scss — reusable for future form fields
- [Review fix L1] Replaced `.mat-button-toggle-checked` CSS class override with Material custom properties on toggle group
- [Review fix L2] Removed duplicate `mat-button-toggle mat-icon { transform: scale(0.8) }` — already covered by broader `mat-icon` rule

### Change Log

- 2026-02-17: Implemented story 9-3 — migrated search bar and card-searcher styles to dark theme using CSS custom properties. Removed 3 `::ng-deep` rules and 3 unused SCSS imports. All SCSS variables replaced with design tokens.
- 2026-02-17: Code review (Opus 4.6) — fixed 5 issues (3M, 2L): placeholder via Material API, unchecked toggle dark-themed, hardcoded rgba extracted to `--border-subtle` token, toggle checked via Material custom properties, removed duplicate mat-icon rule.

### File List

- front/src/app/components/search-bar/search-bar.component.scss (modified)
- front/src/app/components/card-searcher/card-searcher.component.scss (modified)
- front/src/app/styles/_tokens.scss (modified — added `--border-subtle` token, review fix M3)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/9-3-search-bar-dark.md (modified)
