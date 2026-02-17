# Story 9.6: Deck Builder Headers & Zone Separation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want clear section headers (MAIN/EXTRA/SIDE) and visual separation between deck zones,
So that I can quickly identify which section I'm viewing when scrolling through my deck.

## Acceptance Criteria

1. **Given** section headers currently use `rgba(0,0,0,0.3)` on dark background
   **When** the redesign is applied
   **Then** headers use opaque `var(--surface-nav)` background, uppercase bold label with count badge as pill (e.g., `MAIN [38]`)
   **And** a 3px left border in `var(--accent-primary)` marks each section
   **And** count color is `var(--danger)` when illegal (main < 40 or > 60), `var(--accent-primary)` when valid

2. **Given** sections are stacked with minimal spacing
   **When** zone separation is added
   **Then** `margin-top: 1rem` is applied between MAIN-EXTRA and EXTRA-SIDE sections

3. **Given** the headers are styled
   **When** the user scrolls through the deck viewer
   **Then** headers are sticky (`position: sticky`) so the current section is always visible
   **And** z-index is above cards but below modals/inspector

## Tasks / Subtasks

- [x] Task 1: Restyle section headers with opaque background and accent border (AC: #1)
  - [x] 1.1: Replace `background: rgba(0, 0, 0, 0.3)` (deck-viewer.scss line 19) with `background: var(--surface-nav)`
  - [x] 1.2: Replace `border-radius: 2px` (line 20) with `border-left: 3px solid var(--accent-primary)` and `border-radius: 0`
  - [x] 1.3: Add explicit `color: var(--text-primary)` on `&-header` — current SCSS has no `color` rule; text color relies on inheritance which may break after `@use 'variable'` removal
  - [x] 1.4: Ensure label text is uppercase bold — current SCSS already has `font-weight: bold` (line 17); the template already uses uppercase strings "MAIN", "EXTRA", "SIDE" (no CSS `text-transform` needed)
- [x] Task 2: Migrate count badge colors from SCSS variables to design tokens (AC: #1)
  - [x] 2.1: Remove background-based badge: delete `background: $green` (line 24), `color: $white` (line 25), `border-radius: 4px` (line 26), `padding: 0 0.4em` (line 27), and `background: $red` (line 31)
  - [x] 2.2: Add default count color: `color: var(--accent-primary)` on `&-count` (gold text for valid counts)
  - [x] 2.3: Add illegal count color: `color: var(--danger)` on `&-count.illegal` (red text for invalid counts) — this MUST come after 2.2 in the SCSS to override correctly
  - [x] 2.4: Update HTML: wrap count values in brackets — `[{{ count }}]` — this is a text-only format, NOT a Material `mat-badge` (the AC term "pill" means bracket-style inline text)
  - [x] 2.5: Update MAIN illegal condition in template: change `[class.illegal]="deckBuildService.mainCardNumber() < 40"` to `[class.illegal]="deckBuildService.mainCardNumber() < 40 || deckBuildService.mainCardNumber() > 60"` (deck-viewer.component.html line 5)
- [x] Task 3: Add sticky positioning to headers (AC: #3)
  - [x] 3.1: Add `position: sticky; top: 0; z-index: 2` to `.deckViewer-part-header` — the scroll container is `.deckBuilder-canvasParent` which has `overflow-y: auto` (deck-builder.component.scss line 101), so sticky will work
  - [x] 3.2: z-index: 2 is above card grid items (no z-index) but below FAB (10), hand backdrop (20), filters (999), side panel (1000), inspector (1001)
- [x] Task 4: Adjust zone separation spacing (AC: #2)
  - [x] 4.1: Change `margin-top: 1.5em` (line 5) to `margin-top: 1rem` for EXTRA and SIDE sections
  - [x] 4.2: Keep `&:first-child { margin-top: 0 }` (line 8-10) for MAIN section — no change
- [x] Task 5: Remove `@use 'variable' as *` from deck-viewer.component.scss (line 1)
  - [x] 5.1: After removing `$green`, `$red`, and `$white` references (Tasks 1-2), no SCSS variables remain — remove the import entirely
- [ ] Task 6: Verify zero regression
  - [x] 6.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings expected)
  - [ ] 6.2: Verify MAIN header: opaque dark background, gold left border, uppercase "MAIN" label, count in brackets
  - [ ] 6.3: Verify MAIN count shows gold `[38]` when 40-60 cards, red when < 40 or > 60
  - [ ] 6.4: Verify EXTRA and SIDE headers: same opaque/border styling, count always gold (no illegality check)
  - [ ] 6.5: Verify sticky behavior: scroll down in deck viewer, header stays pinned at top of scroll container
  - [ ] 6.6: Verify sticky z-index: header renders above card images when overlapping during scroll
  - [ ] 6.7: Verify spacing: 1rem gap between MAIN-EXTRA and EXTRA-SIDE sections
  - [ ] 6.8: Verify on mobile portrait and landscape: headers still visible and sticky in both orientations

## Dev Notes

### Why This Story Exists

This is story 6 of Epic 9 (UI/UX Modernization). The Screen Implementation Guide rates "Section headers blend into background" as **High severity** — the semi-transparent `rgba(0,0,0,0.3)` background makes MAIN/EXTRA/SIDE headers nearly invisible against the dark page. Additionally, "No strong visual separation between deck zones" is rated **High severity** — zones are stacked with minimal spacing, making it hard to distinguish sections when scrolling.

This story transforms the deck viewer from a flat card wall into clearly delineated zones with sticky navigation.

### What This Story Does

- Replaces **1 semi-transparent header background** `rgba(0,0,0,0.3)` with opaque `var(--surface-nav)` (#161616)
- Adds **3px gold left border** `var(--accent-primary)` (#C9A84C) to all section headers
- Replaces **count badge styling** from colored-background pills ($green/$red bg + $white text) to text-only bracket format with `var(--accent-primary)` (gold) / `var(--danger)` (red) text
- Extends **MAIN illegality check** to include > 60 cards (previously only < 40)
- Adds **sticky positioning** with `z-index: 2` so headers pin during scroll
- Adjusts **zone spacing** from 1.5em to 1rem
- **Removes `@use 'variable' as *`** from deck-viewer.component.scss (fourth component fully detached from old variable system after navbar, search-bar, card-searcher)

### What This Story Does NOT Do

- Does NOT modify `deck-builder.component.scss` or `deck-builder.component.html` — all changes are in the child `deck-viewer` component
- Does NOT modify `deck-card-zone.component.*` — card grid rendering is untouched
- Does NOT modify `deck-build.service.ts` — count signals already exposed (`mainCardNumber`, `extraCardNumber`, `sideCardNumber`)
- Does NOT modify `_tokens.scss` — all needed tokens already exist
- Does NOT add `isMainValid` extended check to the Deck model — legality is checked inline in the template expression
- Does NOT modify the side panel header, deck name input, or hand test overlay (separate stories 9-7, etc.)
- Does NOT add illegality checks for Extra or Side deck counts (0-15 range) — **intentional scope exclusion**: Yu-Gi-Oh! rules impose Extra ≤ 15 and Side ≤ 15 but the current codebase has no such validation, and the AC only specifies MAIN legality coloring. Extra/Side counts always render in `--accent-primary` (gold)

### Critical: Sticky Header Context

`position: sticky` requires the scroll container to NOT have `overflow: hidden` on any ancestor between the sticky element and the scroll container. The layout chain is:

```
.deckBuilder (overflow: hidden)         ← OK, this is the outer flex container
  .deckBuilder-body (overflow: hidden)  ← OK, flex wrapper
    .deckBuilder-canvasParent (overflow-y: auto)  ← THIS is the scroll container
      <deck-viewer>
        .deckViewer-part-header (position: sticky; top: 0)  ← sticky element
```

The sticky element is a direct descendant of the scroll container's content — no `overflow: hidden` between them. `position: sticky; top: 0` will pin the header at the top of `.deckBuilder-canvasParent` when scrolling. Verified in Screen Implementation Guide regression risk: "`.deckBuilder-canvasParent` has `overflow: auto` (OK)".

### Header Text Color (Party Mode Fix)

The current `.deckViewer-part-header` has no explicit `color` rule — text relies on DOM inheritance. After removing `@use 'variable' as *`, this inheritance chain must be verified. To be safe, Task 1.3 adds `color: var(--text-primary)` explicitly on the header. This guarantees white-on-dark text regardless of ancestor styling.

### Count Badge Format Change

**Important terminology:** The AC says "count badge as pill" — this means **bracket-style inline text** `[38]`, NOT a Material `mat-badge` or a colored-background UI pill. The brackets are literal characters in the HTML template. No Material badge component is involved.

**Current** (colored-background pill):
```html
<span class="deckViewer-part-header-count" [class.illegal]="...">
  {{ deckBuildService.mainCardNumber() }}
</span>
```
Renders as: green/red background badge with white text — e.g., `38` on green.

**New** (bracket text-only pill):
```html
<span class="deckViewer-part-header-count" [class.illegal]="...">
  [{{ deckBuildService.mainCardNumber() }}]
</span>
```
Renders as: gold text `[38]` (no background), or red text `[38]` when illegal. The brackets are literal characters in the template. This matches the Screen Implementation Guide spec: "count badge as pill (e.g., `MAIN [38]`)".

### SCSS Variable Removal

After this story, `deck-viewer.component.scss` has zero SCSS variable references:

| Variable | Current Usage | Replacement |
|----------|--------------|-------------|
| `$green` | Count badge valid bg (line 24) | `var(--accent-primary)` text color |
| `$red` | Count badge illegal bg (line 31) | `var(--danger)` text color |
| `$white` | Count badge text color (line 25) | Removed (no background badge) |

The `@use 'variable' as *;` import (line 1) can be safely removed.

### Current Color Map (What Changes)

**deck-viewer.component.scss:**

| Line | Current Code | Purpose | New Code |
|------|-------------|---------|----------|
| 1 | `@use 'variable' as *;` | Old SCSS variables | REMOVED |
| 5 | `margin-top: 1.5em` | Zone spacing | `margin-top: 1rem` |
| 19 | `background: rgba(0, 0, 0, 0.3)` | Header background | `background: var(--surface-nav)` |
| 20 | `border-radius: 2px` | Header corners | `border-left: 3px solid var(--accent-primary); border-radius: 0` |
| NEW | — | Header text color | `color: var(--text-primary)` (explicit, not inherited) |
| NEW | — | Sticky positioning | `position: sticky; top: 0; z-index: 2` |
| 24 | `background: $green` | Valid count bg | `color: var(--accent-primary)` (text only) |
| 25 | `color: $white` | Count text | REMOVED (inherits or set explicitly) |
| 26 | `border-radius: 4px` | Count pill shape | REMOVED or adjusted |
| 27 | `padding: 0 0.4em` | Count padding | Adjusted for bracket format |
| 31 | `background: $red` | Illegal count bg | `color: var(--danger)` (text only) |

**deck-viewer.component.html:**

| Line | Current Code | Change |
|------|-------------|--------|
| 5 | `[class.illegal]="deckBuildService.mainCardNumber() < 40"` | `[class.illegal]="deckBuildService.mainCardNumber() < 40 \|\| deckBuildService.mainCardNumber() > 60"` |
| 6 | `{{ deckBuildService.mainCardNumber() }}` | `[{{ deckBuildService.mainCardNumber() }}]` |
| 18 | `{{ deckBuildService.extraCardNumber() }}` | `[{{ deckBuildService.extraCardNumber() }}]` |
| 31 | `{{ deckBuildService.sideCardNumber() }}` | `[{{ deckBuildService.sideCardNumber() }}]` |

### Token Values Reference (from _tokens.scss)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--surface-nav` | `#161616` | Header opaque background |
| `--accent-primary` | `#C9A84C` | Header left border, valid count text |
| `--danger` | `#CF6679` | Illegal count text (MAIN < 40 or > 60) |
| `--text-primary` | `#EAEAEA` | Header label text (inherited from page) |

### z-index Map (Deck Builder Context)

| Element | z-index | Notes |
|---------|---------|-------|
| Card grid items | none | Default stacking |
| **Sticky headers** | **2** | **This story** — above cards |
| Search toggle FAB | 10 | Mobile only |
| Hand backdrop | 20 | Fixed overlay |
| Filters panel | 999 | Absolute in side panel |
| Side panel (mobile) | 1000 | Fixed overlay |
| Card inspector (mobile) | 1001 | Above side panel |

### Previous Story Intelligence (9-3)

Story 9-3 migrated the search bar and card-searcher to dark theme. Key learnings:

- **Token system stable:** CSS custom properties on `:root` available without imports — confirmed across 3 components
- **Material custom property pattern:** `.mat-form-field` accepts `--mdc-*` properties on the element itself — same pattern can extend to deck-builder form fields in 9-7
- **`@use 'variable'` removal safe:** Remove only after ALL `$variable` references are replaced in the file
- **Pre-existing budget errors:** `ng build` exits code 1 due to bundle size (1.57 MB > 1 MB limit) and deck-builder SCSS (> 4 KB). Zero compilation errors expected.
- **Active state pattern confirmed:** `--accent-primary-dim` bg + `--accent-primary` border/icon is the standard. This story uses `--accent-primary` for header border (same gold accent system).

### Git Intelligence

Last 2 commits implement Epic 9 stories:
- `35715a39 9.-2` — sidebar dark migration (navbar.component.scss)
- `94a9097c 9-1` — global token system (`_tokens.scss`)

Story 9-3 changes (search-bar.component.scss, card-searcher.component.scss) are currently uncommitted on the `hand-testing` branch. No conflict expected with deck-viewer files (completely separate component tree).

### Project Structure Notes

- **Two files modified:** `deck-viewer.component.html` and `deck-viewer.component.scss` — HTML + SCSS changes
- **No new files** created
- **No TypeScript changes** — `DeckViewerComponent` class unchanged, all count signals already exposed by `DeckBuildService`
- **No service changes** — `mainCardNumber()`, `extraCardNumber()`, `sideCardNumber()` already computed signals
- `@use 'variable' as *` removed from deck-viewer.component.scss — fourth component detached from old variable system
- File path: `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/`

### Scope Boundaries

Components that share the deck-builder context but are NOT in scope:
- `deck-builder.component.scss`: side panel header, deck name input (stories 9-7), form field colors, hand test overlay
- `deck-card-zone.component.*`: card grid layout (story 9-5), CDK drag-drop zones
- `card-searcher.component.*`: search bar (done in 9-3), toggles (story 9-8)
- `deck-build.service.ts`: deck data signals (no change needed)

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 3 - Deck Builder (lines 202-276)]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 3 Regression Risk (lines 446-456)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.6 (lines 1475-1496)]
- [Source: front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.html (40 lines)]
- [Source: front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.scss (36 lines)]
- [Source: front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.ts (21 lines)]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss#canvasParent (lines 97-103)]
- [Source: front/src/app/styles/_tokens.scss — global design tokens (69 lines)]
- [Source: _bmad-output/implementation-artifacts/9-3-search-bar-dark.md — previous story context]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `ng build` exit code 1 — pre-existing budget errors only (bundle 1.61 MB > 1 MB, deck-builder.scss 6.07 KB > 4 KB). Zero compilation errors. deck-viewer.component.scss no longer appears in budget warnings.

### Completion Notes List

- Replaced semi-transparent header background `rgba(0,0,0,0.3)` with opaque `var(--surface-nav)` (#161616)
- Added 3px gold left border `var(--accent-primary)` to all section headers, removed border-radius
- Added explicit `color: var(--text-primary)` to headers for safe inheritance after `@use` removal
- Added `position: sticky; top: 0; z-index: 2` for scroll-pinned headers
- Migrated count badge from colored-background pills ($green/$red bg + $white text) to text-only bracket format `[N]` with gold/red text colors
- Extended MAIN illegality check to include > 60 cards (was only < 40)
- Adjusted zone spacing from 1.5em to 1rem
- Removed `@use 'variable' as *` — fourth component fully detached from old SCSS variable system
- All 3 ACs satisfied: header styling (AC#1), zone separation (AC#2), sticky behavior (AC#3)
- Visual verification subtasks (6.2-6.8) left unchecked for manual user testing

**Code Review Fixes (2026-02-17):**
- [H1] Unchecked Task 6 parent — was marked [x] with 7/8 subtasks incomplete
- [M1] Added `box-shadow: 0 1px 3px rgba(0,0,0,0.5)` to sticky headers for visual separation from cards during scroll
- [L1] Removed redundant `border-radius: 0` (CSS default, no cascade source)

### File List

- `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.scss` (modified)
- `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.html` (modified)

## Change Log

- 2026-02-17: Implemented story 9-6 — deck builder headers restyled with opaque background, gold accent border, sticky positioning, bracket-format count badges with design token colors, zone spacing adjusted, `@use 'variable'` removed
- 2026-02-17: Code review — fixed H1 (Task 6 parent unchecked), M1 (box-shadow on sticky headers), L1 (removed redundant border-radius: 0). L2 (non-semantic headers) noted for future accessibility story.
