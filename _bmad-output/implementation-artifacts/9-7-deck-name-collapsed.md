# Story 9.7: Deck Name Collapsed

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the deck name input to display as collapsed text by default and expand to an editable input on tap,
So that the header area is cleaner and less cluttered.

## Acceptance Criteria

1. **Given** the deck name is currently always displayed as a mat-form-field
   **When** collapsed mode is implemented
   **Then** the name displays as text only by default
   **And** tapping/clicking the text reveals the input field with focus
   **And** blur or Enter saves and returns to text display

2. **Given** the collapsed mode applies to both mobile portrait and landscape
   **When** the user interacts with the deck name
   **Then** the behavior is consistent across breakpoints

3. **Given** the auto-save triggers on blur
   **When** the user is still typing
   **Then** a debounce prevents premature saves

## Tasks / Subtasks

- [x] Task 1: Add `isEditingName` signal and toggle logic in deck-builder component (AC: #1)
  - [x] 1.1: Add `isEditingName = signal(false)` to DeckBuilderComponent
  - [x] 1.2: Add `startEditingName()` method: sets `isEditingName(true)`, then on next tick focuses the input via `ViewChild`
  - [x] 1.3: Add `stopEditingName()` method: sets `isEditingName(false)`, triggers debounced save
  - [x] 1.4: Add `onNameKeydown(event: KeyboardEvent)` method: if Enter, blur the input (which triggers stopEditingName via blur handler)
  - [x] 1.5: Add `@ViewChild('deckNameInput')` to reference the mobile deck name input element
  - [x] 1.6: Add a second `@ViewChild('deckNameInputDesktop')` to reference the desktop (side panel header) deck name input element

- [x] Task 2: Update mobile deck name template to collapsed text / editable input toggle (AC: #1, #2)
  - [x] 2.1: In `.deckBuilder-deckNameMobile` section, replace the always-visible `<mat-form-field>` with a conditional block:
    - When `!isEditingName()`: display a `<span>` (class `deckBuilder-deckNameMobile-text`) showing `deckBuildService.deck().name || 'Nom du deck...'` — with `(click)="startEditingName()"` handler
    - When `isEditingName()`: display the `<mat-form-field>` with `<input #deckNameInput>`, `(blur)="stopEditingName()"`, `(keydown)="onNameKeydown($event)"`
  - [x] 2.2: Keep the save button and more_vert menu button unchanged outside the conditional

- [x] Task 3: Update desktop side panel header deck name to collapsed text / editable input toggle (AC: #1, #2)
  - [x] 3.1: In `.deckBuilder-side-header-deckName` section, apply the same conditional pattern as Task 2:
    - When `!isEditingName()`: display a `<span>` (class `deckBuilder-side-header-deckName-text`) with `(click)="startEditingName()"` handler
    - When `isEditingName()`: display the `<mat-form-field>` with `<input #deckNameInputDesktop>`, `(blur)="stopEditingName()"`, `(keydown)="onNameKeydown($event)"`
  - [x] 3.2: Keep the save button and more_vert menu button unchanged

- [x] Task 4: Style the collapsed text display (AC: #1, #2)
  - [x] 4.1: Add styles for `.deckBuilder-deckNameMobile-text` in deck-builder.component.scss:
    - `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
    - `color: var(--text-primary); font-size: 1rem; cursor: pointer;`
    - `padding: 0.25em 0;` (vertical alignment with sibling buttons)
  - [x] 4.2: Add styles for `.deckBuilder-side-header-deckName-text` in deck-builder.component.scss:
    - Same truncation and cursor styles as 4.1
    - `color: var(--text-primary); font-size: 0.875rem;` (slightly smaller for desktop side panel)
  - [x] 4.3: Migrate mat-form-field token overrides on both deck name locations from old `$white`/`$black` SCSS variables to CSS custom properties:
    - `.deckBuilder-deckNameMobile mat-form-field`: replace `#{$white}` → `var(--surface-card)`, `#{$black}` → `var(--text-primary)` on `--mdc-filled-text-field-container-color`, `--mdc-filled-text-field-input-text-color`, `--mdc-filled-text-field-caret-color`
    - Add `--mdc-filled-text-field-focus-active-indicator-color: var(--accent-primary)` (gold focus indicator, consistent with 9-3)
    - Add `--mdc-filled-text-field-active-indicator-color: var(--border-subtle)` (subtle unfocused indicator)
    - Add `--mdc-filled-text-field-hover-active-indicator-color: var(--text-secondary)` (hover indicator)
    - Add `--mdc-filled-text-field-input-text-placeholder-color: var(--text-secondary)` (placeholder via Material API)
    - `.deckBuilder-side-header-deckName mat-form-field`: same dark theme token migration
  - [x] 4.4: Replace `input::placeholder { color: $unselected-black; opacity: 0.1 }` (line 185-188) with `--mdc-filled-text-field-input-text-placeholder-color: var(--text-secondary)` on the mat-form-field (Material custom property API, same pattern as 9-3 review fix M1)

- [x] Task 5: Add debounced save on name change (AC: #3)
  - [x] 5.1: In `stopEditingName()`, call `save()` only if the deck has an ID (existing deck) — no save for new unnamed decks
  - [x] 5.2: Wrap the save call with a debounce mechanism: use a `nameEditTimeout` class property. In `stopEditingName()`: clear any existing timeout, set a new 500ms timeout that calls `save()`. Clear the timeout in `ngOnDestroy` if needed
  - [x] 5.3: Add `OnDestroy` implementation to `DeckBuilderComponent` to clear the timeout

- [x] Task 6: Migrate remaining button colors in deck name sections to tokens (AC: #1)
  - [x] 6.1: Replace `button { color: $white; }` (line 50, inside `&-deckNameMobile`) with `color: var(--text-primary)`
  - [x] 6.2: Replace `>button { color: rgba(255, 255, 255, 0.6); }` (line 179-180, inside `&-deckName`) with `color: var(--text-secondary)` (muted button color on desktop header)

- [x] Task 7: Verify zero regression (AC: #1, #2, #3)
  - [x] 7.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings are expected)
  - [ ] 7.2: Verify mobile portrait: deck name shows as collapsed text, tap opens input with focus, blur/Enter returns to text
  - [ ] 7.3: Verify mobile landscape: same collapsed behavior in the mobile deck name section
  - [ ] 7.4: Verify desktop: collapsed text in side panel header, tap to edit, blur/Enter to close
  - [ ] 7.5: Verify debounce: rapid typing + blur does not trigger premature/multiple saves
  - [ ] 7.6: Verify new deck (no ID): no save triggered on blur, only name update in memory
  - [ ] 7.7: Verify mat-form-field dark theme: surface-card background, text-primary text, accent-primary focus indicator, text-secondary placeholder
  - [ ] 7.8: Verify save button and more_vert menu remain functional in both collapsed and editing states

## Dev Notes

### Why This Story Exists

This is story 7 of Epic 9 (UI/UX Modernization). The deck name is currently always displayed as a `mat-form-field` input, which takes up visual space and adds clutter to the header area. The Screen Implementation Guide specifies a "collapsed mode" where the deck name shows as text only and reveals the input on tap — a cleaner, more intentional interaction pattern.

This story also migrates the deck name form fields and surrounding buttons from old SCSS variables (`$white`, `$black`, `$unselected-black`) to CSS custom property tokens — consistent with the dark theme migration pattern established in stories 9-1 through 9-3.

### What This Story Does

- Adds an `isEditingName` signal to DeckBuilderComponent controlling collapsed/editing state
- Replaces always-visible `mat-form-field` with conditional: collapsed text `<span>` vs. editing `<mat-form-field>`
- Applies collapsed behavior to BOTH deck name locations:
  - `.deckBuilder-deckNameMobile` (mobile portrait/landscape, above decklist)
  - `.deckBuilder-side-header-deckName` (desktop side panel header)
- Styles collapsed text with truncation (`text-overflow: ellipsis`), cursor pointer, and token colors
- Migrates mat-form-field overrides from `$white`/`$black` to `var(--surface-card)`/`var(--text-primary)` with full Material custom property set (focus, hover, placeholder)
- Migrates button colors from `$white` / `rgba()` to `var(--text-primary)` / `var(--text-secondary)`
- Replaces `input::placeholder` hack with Material custom property `--mdc-filled-text-field-input-text-placeholder-color`
- Adds 500ms debounced save on blur to prevent premature saves while typing
- Adds `ngOnDestroy` cleanup for the debounce timeout

### What This Story Does NOT Do

- Does NOT modify the search bar component (already done in 9-3)
- Does NOT modify the card-searcher or card-filters components
- Does NOT modify the deck-viewer or deck-card-zone components
- Does NOT add new Angular Material modules — uses existing `MatInputModule`
- Does NOT change the save mechanism in `DeckBuildService` — the existing `save()` method is called with debounce from the component
- Does NOT modify any non-deck-builder file (except sprint-status.yaml and this story file)
- Does NOT change the "Aperçu du deck" section or the search panel
- Does NOT implement the side panel header "collapsible" feature (chevron toggle for "Aperçu du deck" is a separate scope if needed)

### Deck Name Locations in the Template

There are **two** deck name `mat-form-field` instances in `deck-builder.component.html`:

1. **Mobile deck name** (line 5-15): `.deckBuilder-deckNameMobile` — visible only below tablet breakpoint (`display: none` by default, `display: flex` at `respond-below(r.$bp-tablet)`). Contains: mat-form-field + save button + more_vert menu.

2. **Desktop side panel header** (line 34-71): `.deckBuilder-side-header-deckName` — visible on desktop, hidden below tablet breakpoint. Contains: mat-form-field + save button + more_vert menu + mat-menu.

Both use the same binding: `[(ngModel)]="deckBuildService.deck().name"`.

Important: The `mat-menu` (#actionsMenu) is defined ONLY in the desktop section (line 45-70). The mobile `more_vert` button also references `[matMenuTriggerFor]="actionsMenu"` — this works because Angular resolves template references within the same template. Only ONE mat-menu definition exists.

### Collapsed Mode Interaction Pattern

1. **Default state (collapsed):** `<span>` displays deck name text, truncated with ellipsis
2. **User taps/clicks text:** `startEditingName()` → `isEditingName.set(true)` → template switches to `mat-form-field` → `afterNextRender` or `setTimeout(0)` focuses the input
3. **User finishes editing:** blur or Enter → `stopEditingName()` → `isEditingName.set(false)` → template switches back to `<span>` → debounced save (500ms)
4. **Debounce safety:** If user rapidly toggles between collapsed/editing, the timeout is cleared and reset each time

### Single Signal for Both Locations

Both mobile and desktop deck name sections share the same `isEditingName` signal. This is safe because:
- Mobile section is `display: none` on desktop
- Desktop side panel header is `display: none` on mobile
- They are never both visible simultaneously
- The landscape-split media query hides the desktop header (`&-header { display: none }`)

### Focus Strategy

After setting `isEditingName(true)`, the input must be focused programmatically. `setTimeout(0)` is the correct approach here — it runs on the next macrotask, after Angular's signal-based change detection has rendered the `@if` block and resolved the `@ViewChild` queries.

Note: `afterNextRender` is an **injection-context-only API** (constructor/provider init) — it cannot be called from runtime methods like `startEditingName()`. `setTimeout(0)` is the standard Angular pattern for post-render focus in event handlers.

Use `@ViewChild('deckNameInput')` and `@ViewChild('deckNameInputDesktop')` to reference the correct input per context. Since only one is visible at a time, check both and focus whichever exists.

### Dark Theme Token Migration (deck name form fields)

**Current code (REPLACE):**
```scss
// Mobile (.deckBuilder-deckNameMobile)
mat-form-field {
  --mdc-filled-text-field-container-color: #{$white};
  --mdc-filled-text-field-input-text-color: #{$black};
  --mdc-filled-text-field-caret-color: #{$black};
  --mdc-filled-text-field-container-shape: 0;
}

// Desktop (.deckBuilder-side-header-deckName)
mat-form-field {
  --mdc-filled-text-field-container-color: #{$white};
  --mdc-filled-text-field-input-text-color: #{$black};
  --mdc-filled-text-field-caret-color: #{$black};
  --mdc-filled-text-field-container-shape: 0;
}
```

**New code (ADD):**
```scss
mat-form-field {
  --mdc-filled-text-field-container-color: var(--surface-card);
  --mdc-filled-text-field-input-text-color: var(--text-primary);
  --mdc-filled-text-field-caret-color: var(--text-primary);
  --mdc-filled-text-field-focus-active-indicator-color: var(--accent-primary);
  --mdc-filled-text-field-active-indicator-color: var(--border-subtle);
  --mdc-filled-text-field-hover-active-indicator-color: var(--text-secondary);
  --mdc-filled-text-field-input-text-placeholder-color: var(--text-secondary);
  --mdc-filled-text-field-container-shape: 0;
}
```

This is the same Material custom property pattern validated in story 9-3 for the search bar.

### Current Color Map (What Changes in deck-builder.component.scss)

| Line(s) | Current Code | Purpose | New Code |
|---------|-------------|---------|----------|
| 55 | `--mdc-filled-text-field-container-color: #{$white}` | Mobile form field bg | `var(--surface-card)` |
| 56 | `--mdc-filled-text-field-input-text-color: #{$black}` | Mobile input text | `var(--text-primary)` |
| 57 | `--mdc-filled-text-field-caret-color: #{$black}` | Mobile cursor | `var(--text-primary)` |
| 50 | `color: $white` | Mobile buttons | `var(--text-primary)` |
| 173 | `--mdc-filled-text-field-container-color: #{$white}` | Desktop form field bg | `var(--surface-card)` |
| 174 | `--mdc-filled-text-field-input-text-color: #{$black}` | Desktop input text | `var(--text-primary)` |
| 175 | `--mdc-filled-text-field-caret-color: #{$black}` | Desktop cursor | `var(--text-primary)` |
| 179-180 | `color: rgba(255, 255, 255, 0.6)` | Desktop header buttons | `var(--text-secondary)` |
| 185-188 | `input::placeholder { color: $unselected-black; opacity: 0.1 }` | Placeholder override | Material custom property |

### Token Values Reference (from _tokens.scss)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--surface-card` | `#1E1E1E` | Form field background |
| `--accent-primary` | `#C9A84C` | Focus indicator |
| `--text-primary` | `#EAEAEA` | Input text, button icons, collapsed text |
| `--text-secondary` | `#9E9E9E` | Placeholder, hover indicator, muted buttons |
| `--border-subtle` | `rgba(255, 255, 255, 0.3)` | Unfocused indicator |

### Previous Story Intelligence (9-3)

Story 9-3 validated the Material CSS custom property approach for form field dark theming:
- `--mdc-filled-text-field-*` properties work when set on the `mat-form-field` element
- `input::placeholder` should be replaced with `--mdc-filled-text-field-input-text-placeholder-color` (Material API, review fix M1)
- Tokens work without `@use` import — CSS custom properties on `:root` are globally available
- Pre-existing budget warnings on `ng build` are expected (1.57 MB > 1 MB limit, deck-builder SCSS > 4 KB)

The deck name form field in deck-builder ALREADY uses Material custom properties (`--mdc-filled-text-field-container-color`, etc.) at lines 55-58 and 173-176 — so this is a value swap, not a new pattern introduction.

### SCSS Imports Note

`deck-builder.component.scss` currently uses `@use 'variable' as *` (line 1) and `@use 'mixin' as *` (line 2). After this story, the deck name sections no longer reference `$white`, `$black`, or `$unselected-black` for their specific rules. However, other parts of the file (hand overlay `$black`/`$blue` at lines 307/315, search toggle `$white` at line 83, close button `$white` at line 145, etc.) still use old SCSS variables — so the `@use` imports MUST be kept. Full detachment of deck-builder from old variables is a separate story scope.

### Git Intelligence

Last commits implement Epic 9 stories:
- `35715a39 9.-2` — sidebar dark migration
- `94a9097c 9-1` — global token system

Current branch: `hand-testing`. Files modified in working tree: card-searcher.component.scss, search-bar.component.scss, _tokens.scss (from 9-3 work).

### Project Structure Notes

- **Files modified:** `deck-builder.component.html`, `deck-builder.component.ts`, `deck-builder.component.scss` — all within `front/src/app/pages/deck-page/components/deck-builder/`
- **No new files** created
- **No new Angular Material imports** — `MatInputModule` and `FormsModule` already imported
- All Material custom property names verified against Angular Material 19.1.1 MDC API (same as 9-3)

### Scope Boundaries

Components and rules in deck-builder.component.scss that are NOT in scope for this story:
- `.deckBuilder-searchToggle` `color: $white` (line 83) — search toggle button, separate concern
- `.deckBuilder-side` `background-color: $black` (line 127) — side panel mobile overlay bg, separate from deck name
- `.deckBuilder-side-close` `color: $white` (line 145) — close button, separate concern
- `.deckBuilder-side-filters` `background-color: black` (line 238) — filter panel bg, separate concern
- `.deckBuilder-handOverlay` `background-color: $black` / `border: 1px solid $blue` (lines 307/315) — hand test overlay, separate concern
- `.inspector-actions button/count` `color: $white` (lines 13/18) — inspector buttons, separate concern
- `.deckBuilder-side-header-row button` `color: $white` (line 213) — row button, separate concern

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 3 (lines 259-268)]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Regression Risk (line 450)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.7 (lines 1498-1519)]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss]
- [Source: front/src/app/styles/_tokens.scss — global design tokens]
- [Source: _bmad-output/implementation-artifacts/9-3-search-bar-dark.md — Material custom property pattern reference]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- Added `isEditingName` signal + `startEditingName()`, `stopEditingName()`, `onNameKeydown()` methods to DeckBuilderComponent
- Added `@ViewChild` references for both mobile (`#deckNameInput`) and desktop (`#deckNameInputDesktop`) inputs
- Replaced always-visible `mat-form-field` with `@if (isEditingName())` conditional in both mobile and desktop template sections
- Added collapsed text `<span>` with truncation (`text-overflow: ellipsis`) and click-to-edit in both locations
- Migrated mobile mat-form-field tokens from `$white`/`$black` SCSS variables to CSS custom properties (`--surface-card`, `--text-primary`, `--accent-primary`, `--border-subtle`, `--text-secondary`)
- Migrated desktop mat-form-field tokens with same pattern + removed `input::placeholder` hack (replaced by `--mdc-filled-text-field-input-text-placeholder-color`)
- Added 500ms debounced save on blur (only for existing decks with ID)
- Implemented `OnDestroy` with timeout cleanup
- Migrated mobile button color `$white` → `var(--text-primary)`
- Migrated desktop header button color `rgba(255, 255, 255, 0.6)` → `var(--text-secondary)`
- `ng build` passes with zero compilation errors (pre-existing budget warnings only)
- Visual verification tasks (7.2–7.8) left for manual user review

### Change Log

- 2026-02-17: Implemented story 9-7 — deck name collapsed mode (text-only default, tap to edit) with dark theme token migration for form fields and buttons. Added debounced save, OnDestroy cleanup.
- 2026-02-17: Code review fixes — (F1) Fixed debounce gap: startEditingName() now clears pending save timeout. (F2) Added tabindex, role, keydown handlers on collapsed spans for keyboard accessibility. (F3) Added mat-form-field height constraint (48px) in portrait to prevent layout shift. (F4) Extracted collapsed-name-text mixin to reduce CSS duplication. (F5) Corrected Dev Notes Focus Strategy (afterNextRender is injection-context only).

### File List

- front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts (modified)
- front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html (modified)
- front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/9-7-deck-name-collapsed.md (created)
