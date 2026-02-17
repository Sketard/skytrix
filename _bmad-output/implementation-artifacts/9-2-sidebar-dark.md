# Story 9.2: Sidebar Dark

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the navigation sidebar and mobile toolbar to use the dark theme,
So that the entire application has a cohesive dark visual identity instead of a jarring light navigation on dark content.

## Acceptance Criteria

1. **Given** the navbar component uses a light gradient background
   **When** the sidebar dark theme is applied
   **Then** the background is replaced with `var(--surface-nav)` on desktop sidebar, mobile top bar, and mobile drawer
   **And** text color uses `var(--text-primary)` instead of `$black`

2. **Given** navigation items have hover and active states
   **When** they are rendered with the dark theme
   **Then** hover state uses `var(--surface-card)` background with 150ms ease transition
   **And** active item has a 3px left border in `var(--accent-primary)` + `var(--accent-primary-dim)` background

3. **Given** the collapse toggle has a hardcoded light background (`rgb(230,230,230)`)
   **When** the dark theme is applied
   **Then** the toggle background is migrated to use tokens

4. **Given** the sidebar dark theme is applied
   **When** all pages are tested (simulator, deck list, deck builder, card search, login, settings)
   **Then** no text is invisible (no dark-on-dark) and no visual regression occurs on page content

## Tasks / Subtasks

- [x] Task 1: Migrate desktop sidebar backgrounds and text (AC: #1)
  - [x] 1.1: Replace `.navbar-sidebar` `linear-gradient(to right bottom, rgb(240, 240, 240), rgb(220, 220, 220))` with `background: var(--surface-nav)` (line 13)
  - [x] 1.2: Replace `.navbar-sidebar` `color: $black` with `color: var(--text-primary)` (line 14)
  - [x] 1.3: Replace `.nav-link` `color: $black` with `color: var(--text-primary)` (line 46)
- [x] Task 2: Differentiate hover and active states on nav links (AC: #2)
  - [x] 2.1: Replace combined `&:hover, &.active` block (lines 59-62) with separate selectors
  - [x] 2.2: Add `transition: background-color 150ms ease` on `.nav-link` itself (NOT inside `&:hover`) so both hover-in and hover-out animate
  - [x] 2.3: Hover state: `&:hover { background-color: var(--surface-card) }`
  - [x] 2.4: Add `border-left: 3px solid transparent` as default on `.nav-link` to reserve space and prevent content shift when active
  - [x] 2.5: Active state (`.active` via `routerLinkActive`): `background-color: var(--accent-primary-dim)` + `border-left-color: var(--accent-primary)`
  - [x] 2.6: Apply same hover/active differentiation to `.mobile-nav-link` in drawer
  - [x] 2.7: Add `.nav-link { transition: none }` to the `prefers-reduced-motion` media query block (lines 221-237)
- [x] Task 3: Migrate collapse toggle (AC: #3)
  - [x] 3.1: Replace `.collapse-toggle` `background: rgb(230, 230, 230)` with `background: var(--surface-card)` (line 94)
  - [x] 3.2: Replace `.collapse-toggle` `color: $black` with `color: var(--text-primary)` (line 95)
  - [x] 3.3: Replace `.collapse-toggle:hover` `background: rgb(215, 215, 215)` with `background: var(--surface-card-hover)` (line 102)
  - [x] 3.4: Replace border `1px solid rgba(0, 0, 0, 0.1)` with `1px solid rgba(255, 255, 255, 0.1)` — light-on-dark visibility (line 93)
- [x] Task 4: Migrate mobile top bar (AC: #1)
  - [x] 4.1: Replace `.mobile-top-bar` gradient with `background: var(--surface-nav)` (line 119)
  - [x] 4.2: Replace `.mobile-top-bar` `color: $black` with `color: var(--text-primary)` (line 120)
  - [x] 4.3: Adjust box-shadow to `0 2px 4px rgba(0, 0, 0, 0.4)` for visibility on dark surroundings (line 121)
- [x] Task 5: Migrate mobile drawer (AC: #1)
  - [x] 5.1: Replace `.mobile-drawer` gradient with `background: var(--surface-nav)` (line 166)
  - [x] 5.2: Replace `.mobile-drawer` `color: $black` with `color: var(--text-primary)` (line 167)
  - [x] 5.3: Replace `.drawer-header` `border-bottom: 1px solid rgba(0, 0, 0, 0.1)` with `1px solid rgba(255, 255, 255, 0.1)` (line 191)
- [x] Task 6: Remove old variable import (AC: #1)
  - [x] 6.1: Confirm `$black` is the ONLY `variable.scss` reference in the file before removing the import (search for `$` prefix usages)
  - [x] 6.2: Remove `@use 'variable' as *;` from navbar.component.scss (line 2)
  - [x] 6.3: Confirm `@use 'responsive' as *;` remains (needed for breakpoints and `touch-target-min` mixin)
- [x] Task 7: Verify zero regression (AC: #4)
  - [x] 7.1: Run `ng build` — confirm zero compilation errors
  - [x] 7.2: Verify desktop sidebar: expanded state, collapsed state, collapse toggle hover
  - [x] 7.3: Verify mobile top bar and drawer open/close/backdrop
  - [x] 7.4: Verify all pages: simulator (navbar collapsed by default), deck list, deck builder, card search, login, settings — no dark-on-dark text
  - [x] 7.5: Verify `mat-flat-button` ("Se déconnecter") in `.user-section` remains visible — Material may override inherited `color` with its own theming
  - [x] 7.6: Verify nav link hover and active state differentiation on desktop and mobile drawer — confirm no content shift between active/non-active items

## Dev Notes

### Why This Story Exists

This is story 2 of Epic 9 (UI/UX Modernization). It is the **first visual change** users will see — the global tokens from story 9-1 are now consumed for the first time. The sidebar is the highest-visibility, lowest-risk component to migrate because it touches only one file and is present on every page.

The Screen Implementation Guide rates the light gradient sidebar as **Critical severity** on the simulator page ("worst immersion break in app") and **High severity** on all other pages ("clashes with dark content").

### Risk Assessment (from Screen Implementation Guide)

| Risk | Detail | Severity |
|------|--------|----------|
| Invisible text | Currently `$black` (#303030) text on light bg. If bg goes dark without migrating text → black on black. Affects: nav links, user pseudo, drawer title, drawer links | Medium |
| Collapse toggle hardcoded bg | `background: rgb(230,230,230)` in navbar.scss:94. Must migrate | Low |
| Hover state invisible | Current hover is `rgba(59,59,59,0.048)` — designed for light bg. Invisible on dark. Must replace | Medium |

**Mitigation:** All three risks are addressed in Tasks 1-5. The migration covers ALL hardcoded colors in the file — nothing is left behind.

### What This Story Does

- Replaces **3 gradient backgrounds** (desktop sidebar, mobile top bar, mobile drawer) with `var(--surface-nav)` (#161616)
- Replaces **5 `$black` references** with `var(--text-primary)` (#EAEAEA)
- Replaces **1 semi-transparent hover** with `var(--surface-card)` (#1E1E1E)
- **Differentiates** hover and active states (currently identical treatment) per UX spec
- Replaces **2 hardcoded toggle backgrounds** with `var(--surface-card)` / `var(--surface-card-hover)`
- Adjusts **3 border/shadow colors** from `rgba(0,0,0)` to `rgba(255,255,255)` for dark-bg visibility
- **Removes** the `@use 'variable' as *` import (no more old SCSS variable dependencies in this file)

### What This Story Does NOT Do

- Does NOT modify any component outside `navbar.component.scss`
- Does NOT modify `_tokens.scss`, `variable.scss`, or `_sim-tokens.scss`
- Does NOT change the navbar HTML template or TypeScript logic
- Does NOT modify `app.component.scss` or any page component styles
- Does NOT add Angular Material theme overrides (that's story 9-3 for mat-form-field)

### Current Navbar SCSS Color Map (What Changes)

| Line | Current Code | Purpose | New Code |
|------|-------------|---------|----------|
| 13 | `linear-gradient(to right bottom, rgb(240,240,240), rgb(220,220,220))` | Desktop sidebar bg | `var(--surface-nav)` |
| 14 | `color: $black` | Desktop sidebar text | `color: var(--text-primary)` |
| 46 | `color: $black` | Nav link text | `color: var(--text-primary)` |
| 59-62 | `&:hover, &.active { background-color: rgba(59,59,59,0.048) }` | Combined hover+active | Split: hover → `var(--surface-card)`, active → `var(--accent-primary-dim)` + 3px left border |
| 93 | `border: 1px solid rgba(0,0,0,0.1)` | Toggle border | `border: 1px solid rgba(255,255,255,0.1)` |
| 94 | `background: rgb(230,230,230)` | Toggle bg | `background: var(--surface-card)` |
| 95 | `color: $black` | Toggle icon | `color: var(--text-primary)` |
| 102 | `background: rgb(215,215,215)` | Toggle hover | `background: var(--surface-card-hover)` |
| 119 | `linear-gradient(to right bottom, rgb(240,240,240), rgb(220,220,220))` | Mobile top bar bg | `var(--surface-nav)` |
| 120 | `color: $black` | Mobile top bar text | `color: var(--text-primary)` |
| 166 | `linear-gradient(to right bottom, rgb(240,240,240), rgb(220,220,220))` | Mobile drawer bg | `var(--surface-nav)` |
| 167 | `color: $black` | Mobile drawer text | `color: var(--text-primary)` |
| 191 | `border-bottom: 1px solid rgba(0,0,0,0.1)` | Drawer header separator | `border-bottom: 1px solid rgba(255,255,255,0.1)` |

### Active State Implementation Detail

The current SCSS treats hover and active identically (lines 59-62). The AC and UX spec require differentiation:

```scss
// CURRENT (combined — must be split):
&:hover,
&.active {
  background-color: rgba(59, 59, 59, 0.048);
}

// TARGET:
.nav-link {
  // ... existing styles ...
  border-left: 3px solid transparent; // Reserve space — prevents content shift on active
  transition: background-color 150ms ease; // On parent, not &:hover — animates both hover-in AND hover-out

  &:hover {
    background-color: var(--surface-card);
  }

  &.active {
    background-color: var(--accent-primary-dim);
    border-left-color: var(--accent-primary); // Only color changes — no layout shift
  }
}
```

**Critical implementation details:**
- The `transition` MUST be on `.nav-link` itself, not inside `&:hover`. Placing it inside `&:hover` only animates hover-in, not hover-out.
- The `border-left: 3px solid transparent` MUST be on all `.nav-link` by default. Without it, the 3px border on `.active` shifts all content 3px right, causing a visible "jump" when navigating between pages.
- Add `.nav-link { transition: none }` to the `@media (prefers-reduced-motion: reduce)` block (lines 221-237) to respect the existing accessibility pattern.

The `.active` class is applied via Angular's `routerLinkActive="active"` directive (already in the template). No HTML changes needed.

For mobile drawer nav links (`.mobile-nav-link`), the same differentiation should apply. `routerLinkActive` is also used on mobile nav links in the template — apply the same `.active` styling. Note: `.mobile-nav-link` has `@include touch-target-min` (44px min height) — the 3px left border does not affect this constraint.

### Border/Shadow Adjustments for Dark Theme

Three borders and one shadow use `rgba(0, 0, 0, ...)` which was designed for light backgrounds. On dark backgrounds, these become invisible. Adjustments:

- `.collapse-toggle` border: `rgba(0,0,0,0.1)` → `rgba(255,255,255,0.1)` — subtle light border on dark
- `.drawer-header` border-bottom: `rgba(0,0,0,0.1)` → `rgba(255,255,255,0.1)` — visible separator
- `.mobile-top-bar` box-shadow: increase opacity from 0.15 to 0.4 — `rgba(0,0,0,0.4)` (dark shadows still work on dark, just need more intensity)
- `.collapse-toggle` box-shadow: `rgba(0,0,0,0.15)` — keep as-is (shadow below the button works fine on any bg)

### Material Button Visibility Warning

The `.user-section` contains a `mat-flat-button` ("Se déconnecter") for logout. Angular Material buttons have their own theming via `--mat-*` tokens. When the parent `.navbar-sidebar` color changes to `var(--text-primary)` (#EAEAEA), the button text MAY or MAY NOT inherit this color — Material often overrides `color` on its components. No Material dark theme is configured globally (that's beyond Epic 9 scope). During Task 7 visual verification, explicitly check that the logout button text is readable. If not, a targeted `::ng-deep` or Material color override may be needed (but this is unlikely since `mat-flat-button` typically inherits parent color for non-themed usage).

### Existing CSS Custom Properties (No Conflicts)

The codebase already uses component-scoped CSS custom properties:
- `app.component.scss`: `--mobile-header-height: 48px`
- `card.component.scss` (shared): `--card-border-radius`, `--card-bg`, etc.
- `hand.component.scss`: `--fan-x`, `--fan-y`, `--fan-rotation`

These are all component-scoped and will NOT conflict with the global `:root` tokens consumed in this story.

### Token Values Reference (from _tokens.scss)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--surface-nav` | `#161616` | Sidebar, top bar, drawer backgrounds |
| `--surface-card` | `#1E1E1E` | Hover state, collapse toggle bg |
| `--surface-card-hover` | `#252525` | Collapse toggle hover bg |
| `--accent-primary` | `#C9A84C` | Active nav item left border (gold) |
| `--accent-primary-dim` | `#C9A84C33` | Active nav item background (20% gold) |
| `--text-primary` | `#EAEAEA` | All text and icon colors |

### Previous Story Intelligence (9-1)

Story 9-1 created `_tokens.scss` with the global token system. Key learnings:
- Tokens are available globally via `:root` — no `@use` import needed in component files
- `styles.scss` imports tokens via `@import 'app/styles/tokens'` (after `material`, before `variable`)
- Zero regression was confirmed — tokens exist but are not consumed by any component yet
- Pre-existing budget errors exist (bundle 1.57 MB > 1 MB limit) — these are unrelated and expected
- Code review found and fixed a pre-existing `cubic-bezier(255, 255, 255.2, 1)` bug in `styles.scss`

### Action Items from 9-1 Review (for awareness)

- [M2] Story 9-12 planning: `rgba(var(--accent-primary), 0.15)` from UX spec won't work with hex tokens — NOT relevant to this story (no `rgba()` with tokens needed here; `--accent-primary-dim` is already a pre-computed 20% opacity value)
- [L4] Consider `@import` to `@use`/`@forward` migration for `styles.scss` — NOT relevant to this story

### Git Intelligence

Last commit: `94a9097c 9-1` — created `_tokens.scss` and wired it into `styles.scss`. Files changed:
- `front/src/app/styles/_tokens.scss` (NEW)
- `front/src/styles.scss` (MODIFIED — import added)
- `_bmad-output/` artifacts (sprint-status, story file, epics)

### Project Structure Notes

- **Single file modified:** `front/src/app/components/navbar/navbar.component.scss` — all changes are SCSS-only
- **No new files** created
- **No HTML/TS changes** — all changes are purely visual (CSS custom property swap)
- `@use 'variable' as *` removed — this is the first component to fully detach from the old variable system
- `@use 'responsive' as *` kept — still needed for `touch-target-min` mixin and future breakpoint usage

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Sidebar & Toolbar — Dark Theme]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Global — Sidebar & Toolbar Dark (Risk Assessment)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Sidebar & Toolbar Dark Theme (§312-315)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Collapsible Navbar (§860-887)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.2: Sidebar Dark (§1372-1397)]
- [Source: front/src/app/components/navbar/navbar.component.scss — current navbar styles (238 lines)]
- [Source: front/src/app/styles/_tokens.scss — global design tokens]
- [Source: _bmad-output/implementation-artifacts/9-1-global-tokens.md — previous story context]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `ng build` exit code 1 due to pre-existing budget errors only (bundle 1.57 MB > 1 MB limit, deck-builder.component.scss > 4 KB). Zero compilation errors. Same behavior as story 9-1.

### Completion Notes List

- Migrated 3 gradient backgrounds (desktop sidebar, mobile top bar, mobile drawer) to `var(--surface-nav)`
- Replaced all 5 `$black` references with `var(--text-primary)`
- Split combined `&:hover, &.active` into separate selectors with distinct visual treatment for both `.nav-link` and `.mobile-nav-link`
- Added `border-left: 3px solid transparent` on nav links to prevent content shift when active state applies
- Added `transition: background-color 150ms ease` on `.nav-link` parent (not inside `&:hover`) for bidirectional animation
- Migrated collapse toggle bg/border/hover to token-based values
- Adjusted 2 borders from `rgba(0,0,0,0.1)` to `rgba(255,255,255,0.1)` for dark-bg visibility
- Increased mobile top bar box-shadow opacity from 0.15 to 0.4
- Added `.nav-link` and `.mobile-nav-link` to `prefers-reduced-motion` block
- Removed `@use 'variable' as *` — first component fully detached from old variable system
- Confirmed `@use 'responsive' as *` retained for `touch-target-min` mixin

### Change Log

- 2026-02-17: Implemented dark theme migration for navbar component — replaced all hardcoded light-theme colors with CSS custom property tokens, differentiated hover/active states, removed legacy SCSS variable import
- 2026-02-17: Code review fixes — removed stale "(unchanged from 6.4)" comment, aligned `.collapse-toggle` transition to `background-color` (was shorthand `background`), changed `.nav-link` border-radius to `0 10px 10px 0` for straight-edge active indicator

### File List

- `front/src/app/components/navbar/navbar.component.scss` (MODIFIED)
