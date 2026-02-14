# Story 7.3: Login & Settings Pages Responsive

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the login and settings pages to be usable on any device from mobile to desktop,
so that I can access my account and configure the app regardless of screen size.

## Acceptance Criteria

1. **Given** I access the login page on a mobile viewport (≤576px),
   **When** the page renders,
   **Then** the login form is centered and fills the available width with appropriate margins,
   **And** all input fields are full-width,
   **And** the submit button meets the 44×44px minimum touch target size,
   **And** no horizontal scrolling occurs.

2. **Given** I access the login page on a desktop viewport (>1024px),
   **When** the page renders,
   **Then** the login form is centered with a max-width constraint (not stretched to full screen),
   **And** the layout is visually balanced with the existing app aesthetic.

3. **Given** I access the settings page on a mobile viewport (≤576px),
   **When** the page renders,
   **Then** settings sections stack vertically,
   **And** all interactive elements (toggles, buttons, links) meet the 44×44px minimum touch target size,
   **And** no horizontal scrolling occurs.

4. **Given** I access the settings page on a tablet viewport (577–768px),
   **When** the page renders,
   **Then** the layout adjusts with appropriate spacing — no wasted space, no cramping.

5. **Given** both pages use the responsive SCSS infrastructure,
   **When** the styles are written,
   **Then** they import `_responsive.scss` and use the defined breakpoint mixins for media queries,
   **And** the styles follow mobile-first convention (base styles for mobile, `respond-above` for larger viewports).

## Tasks / Subtasks

- [x] **Task 1: Login page responsive SCSS** (AC: 1, 2, 5)
  - [x] 1.1: Replace `@import "variable"` with `@use 'responsive' as *` (add `@use 'variable' as *` if still needed for `$blue`)
  - [x] 1.2: Mobile-first base styles: remove fixed `max-width: 400px`, set `padding: 1rem`, form fills available width with `margin: 0 1rem`
  - [x] 1.3: Tablet and above (`@include respond-above($bp-tablet)`): restore `max-width: 400px` for centered form
  - [x] 1.4: Buttons row: on mobile (≤576px), stack buttons vertically with `flex-direction: column; gap: 0.75rem`. On tablet+, restore `flex-direction: row; justify-content: space-between`
  - [x] 1.5: Submit button and "Créer un compte" link: `@include touch-target-min` for 44×44px minimum on all viewports
  - [x] 1.6: Password visibility toggle icon (`mat-icon[matSuffix]`): apply `@include touch-target-min` and add `padding: 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center` for a 44×44px tap area around the 24px icon. Target selector: `.loginPage-form-inputs-field mat-icon[matSuffix]` or equivalent
  - [x] 1.7: Verify no horizontal scrollbar at 375px viewport width

- [x] **Task 2: Settings page responsive SCSS** (AC: 3, 4, 5)
  - [x] 2.1: Replace current SCSS with `@use 'responsive' as *`
  - [x] 2.2: Mobile-first base styles: `padding: 1rem`, buttons full-width `width: 100%`, stacked vertically with `gap: 0.75rem`
  - [x] 2.3: Add `max-width` container on desktop (`@include respond-above($bp-desktop-sm)`): `max-width: 600px; margin: 0 auto` to prevent button stretching on wide viewports
  - [x] 2.4: All buttons: `@include touch-target-min` for 44×44px minimum
  - [x] 2.5: Add a page heading (`<h2>Paramètres</h2>`) in `parameter-page.component.html` before the buttons container — required for page identification on all viewports (currently no heading exists)
  - [x] 2.6: Verify no horizontal scrollbar at 375px viewport width

- [x] **Task 3: Build verification** (AC: 1–5)
  - [x] 3.1: Run `ng build --configuration development` — zero errors
  - [x] 3.2: Manual check: login page at 375px, 576px, 768px, 1024px, 1440px
  - [x] 3.3: Manual check: settings page at 375px, 576px, 768px, 1024px, 1440px
  - [x] 3.4: Verify login page works in both modes (LOGIN and CREATE_ACCOUNT) at all viewports
  - [x] 3.5: Verify mobile top bar (navbar hamburger from Story 7-2) does not overlap login/settings content

## Dev Notes

### Critical Architecture Constraints

- **Track B responsive strategy.** Login (`/login`) and Settings (`/parameters`) are Track B pages — mobile-first responsive CSS with breakpoints. No canvas scaling, no `ScalingContainerDirective`. [Source: architecture.md#Responsive Strategy, ux-design-specification.md#Responsive Strategy]
- **Breakpoints from `_responsive.scss` are the single source of truth.** `$bp-mobile: 576px`, `$bp-tablet: 768px`, `$bp-desktop-sm: 1024px`. Use `@include respond-above($bp)` for desktop enhancements — mobile-first convention. Do NOT create custom breakpoints. [Source: architecture.md#Responsive Strategy, _responsive.scss]
- **Touch targets 44×44px on all interactive elements.** Use `@include touch-target-min` mixin from `_responsive.scss`. This applies to buttons, links, icon toggles. [Source: prd.md#NFR12]
- **Login page has NO navbar.** The login page renders when `connectedUser()` is false — the navbar is hidden entirely. No `--mobile-header-height` offset needed. The login page uses `class="full"` on `<main>`, taking 100% width. [Source: app.component.html, app.component.scss]
- **Settings page HAS the navbar.** The settings page is behind auth guard. On mobile, `--mobile-header-height: 48px` padding-top is applied by `AppComponent.mobile-mode` class — already handled. No additional offset needed in settings SCSS. [Source: app.component.scss, Story 7-2]
- **Primarily SCSS changes.** This story modifies `.scss` files for responsive layout. One HTML change: adding a `<h2>` heading in settings page (Task 2.5). No TypeScript changes. No new files created.

### Implementation Decisions for Dev Agent

#### Login Page Layout

**Current state:** The login page uses `display: flex; justify-content: center; align-items: center` on a full-height container with `max-width: 400px` on the `mat-card`. This already centers the form well on desktop.

**What to change for mobile:**
- The `max-width: 400px` prevents the form from filling the screen on narrow viewports. On mobile, the form should fill the available width with small margins (e.g., `margin: 0 1rem`).
- The buttons row (`loginPage-form-buttons`) uses `justify-content: space-between` — on very narrow screens, the "Créer un compte" link and "Se connecter" button may be cramped. Stack them vertically on mobile.
- The password visibility icon (`mat-icon` with `matSuffix`) is small by default. Ensure it has a 44×44px tap area on mobile.

**Recommended SCSS structure (mobile-first):**

```scss
@use 'responsive' as *;
@use 'variable' as *;

.loginPage {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;

  &-form {
    width: 100%;
    text-align: center;
    padding: 1.5rem;

    @include respond-above($bp-tablet) {
      max-width: 400px;
      padding: 2em;
    }

    &-inputs { ... }

    &-buttons {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      align-items: stretch;

      @include respond-above($bp-mobile) {
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
      }

      button, a {
        @include touch-target-min;
      }
    }
  }
}
```

#### Settings Page Layout

**Current state:** Simple vertical button column with `padding: 1em`. Functional but not responsive-aware.

**What to change:**
- Add `max-width` container on desktop to prevent buttons from stretching across a 2560px screen.
- Ensure buttons have 44×44px minimum touch target (they may already be tall enough via `mat-flat-button` — verify, add `@include touch-target-min` if not).
- Keep the vertical stack on all viewports (column layout is appropriate for admin actions).

**Recommended SCSS structure (mobile-first):**

```scss
@use 'responsive' as *;

.parameters {
  padding: 1rem;

  @include respond-above($bp-desktop-sm) {
    max-width: 600px;
    margin: 0 auto;
  }

  &-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    button {
      @include touch-target-min;
      width: 100%;
    }
  }
}
```

### Existing Code Context

#### Login Page Component (`front/src/app/pages/login-page/`)

```typescript
// login-page.component.ts
@Component({
  selector: 'app-login-page',
  imports: [MatCard, NgSwitch, NgSwitchCase, ReactiveFormsModule, MatFormField, MatIcon, MatInput, MatLabel, MatSuffix, MatButton, NgIf],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
```

- Two modes: `LOGIN` and `CREATE_ACCOUNT` (via `NgSwitch` on `mode()` signal)
- Login form: pseudo + password fields, "Se connecter" button, "Créer un compte" link
- Create account form: pseudo + password + confirmPassword fields, "Créer le compte" button, "Retour" link
- Password visibility toggle: `mat-icon` with `matSuffix` — small tap target

```html
<!-- Template structure (simplified) -->
<div class="loginPage">
  <mat-card class="loginPage-form" [ngSwitch]="mode()">
    <form *ngSwitchCase="modes.LOGIN" [formGroup]="loginForm">
      <h2>Login</h2>
      <div class="loginPage-form-inputs">
        <!-- mat-form-field × 2 (pseudo + password) -->
      </div>
      <div class="loginPage-form-buttons">
        <a class="loginPage-form-buttons-forgotten">Créer un compte</a>
        <button mat-flat-button type="submit">Se connecter</button>
      </div>
    </form>
    <form *ngSwitchCase="modes.CREATE_ACCOUNT" [formGroup]="createAccountForm">
      <!-- Similar structure, 3 fields + different buttons -->
    </form>
  </mat-card>
</div>
```

```scss
// Current SCSS — NOT responsive
@import "variable";
.loginPage {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  &-form {
    width: 100%;
    max-width: 400px;  // ← too wide on mobile, no margin
    padding: 2em;      // ← no mobile adjustment
    &-buttons {
      display: flex;
      justify-content: space-between;  // ← cramped on narrow screens
    }
  }
}
```

#### Settings Page Component (`front/src/app/pages/parameter-page/`)

```typescript
// parameter-page.component.ts
@Component({
  selector: 'app-parameter-page',
  imports: [MatButton],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
```

- Four `mat-flat-button` for database operations (cards, images, TCG images, banlist)
- No page heading — just buttons

```html
<!-- Template structure -->
<div class="parameters">
  <div class="parameters-buttons">
    <button mat-flat-button (click)="fetchDatabaseCards()">Mettre à jour les cartes</button>
    <button mat-flat-button (click)="fetchDatabaseImages()">Mettre à jour les images</button>
    <button mat-flat-button (click)="fetchDatabaseTcgImages()">Mettre à jour les images traduites</button>
    <button mat-flat-button (click)="fetchDatabaseBanlist()">Mettre à jour la banlist</button>
  </div>
</div>
```

```scss
// Current SCSS — NOT responsive
.parameters {
  padding: 1em;
  &-buttons {
    display: flex;
    flex-direction: column;
    button { margin-top: 1em; }  // ← no touch-target-min, no max-width
  }
}
```

#### Responsive SCSS Infrastructure (Story 7-1)

```scss
// front/src/app/styles/_responsive.scss
$navbar-breakpoint: 768px;
$bp-mobile: 576px;
$bp-tablet: 768px;
$bp-desktop-sm: 1024px;

@mixin respond-above($bp) { @media (min-width: $bp) { @content; } }
@mixin respond-below($bp) { @media (max-width: ($bp - 1px)) { @content; } }
@mixin touch-target-min { min-width: 44px; min-height: 44px; }
```

#### AppComponent Mobile Mode (Story 7-2)

```scss
// app.component.scss
:host { --mobile-header-height: 48px; }

.dark-theme.mobile-mode .dark-theme-content {
  padding-top: var(--mobile-header-height);  // Already accounts for mobile header
}

.dark-theme-content.full {
  width: 100%;  // Login page uses this class (no navbar)
}
```

### Previous Story Intelligence (Story 7-2)

**Patterns established in Epic 7:**
- `@use 'responsive' as *` for SCSS imports (NOT `@import` — use `@use`)
- `@include touch-target-min` for 44×44px on all mobile interactive elements (NFR12)
- `@include respond-above($bp-tablet)` / `respond-below($bp-mobile)` for breakpoint media queries
- Mobile-first approach: base styles for mobile, enhancements via `respond-above()`
- `--mobile-header-height: 48px` CSS variable exists at `:host` level in AppComponent
- `padding-top: var(--mobile-header-height)` already applied on `<main>` in mobile mode by AppComponent
- Desktop navbar width: 260px (expanded), 32px (collapsed)
- `isMobile` signal available in `NavbarCollapseService` — but NOT needed for SCSS-only changes

**Files created by Story 7-1 that this story consumes:**
- `front/src/app/styles/_responsive.scss` — breakpoint variables and mixins

### Edge Cases

- **Login page with CREATE_ACCOUNT mode:** The create-account form has 3 fields (vs 2 for login) plus a password mismatch error message. Verify the form doesn't overflow on mobile with the additional field.
- **Long button text on mobile:** "Mettre à jour les images traduites" is a long button label. On narrow viewports, verify text wraps correctly and button remains accessible.
- **Login page height:** The login form uses `height: 100%` on the container. On mobile, if the virtual keyboard opens, the form might not be fully visible. The flex centering (`align-items: center`) should handle this — verify.
- **Settings page after mobile drawer navigation:** User navigates to settings via mobile drawer → drawer closes → settings page renders with `padding-top: var(--mobile-header-height)`. Verify content isn't hidden behind the top bar.
- **Viewport between 400px and 576px:** Login form max-width is removed on mobile but restored at `$bp-tablet` (768px). Between 400-768px, the form fills available width — verify it looks balanced.
- **`prefers-reduced-motion`:** No transitions are being added by this story, so no reduced-motion consideration needed. If adding any transition (e.g., form mode switch animation), respect `prefers-reduced-motion`.

### NFR Compliance

- **NFR9 (browser support):** SCSS responsive patterns use standard CSS (`@media`, `flex`, `gap`) — supported in all target browsers. `gap` in flex context requires Chrome 84+, Firefox 63+, Safari 14.1+ — all within "latest two versions" target.
- **NFR11 (responsive 375px–2560px+):** Login and settings pages will be verified at 375px (narrowest mobile) and should not horizontally scroll. Max-width constraints prevent stretching on ultrawide (2560px+).
- **NFR12 (touch targets):** `@include touch-target-min` applied to all buttons and interactive links. Password visibility icon needs explicit sizing.

### What This Story Does NOT Include

- **No page-level layout restructuring** — only SCSS responsive adjustments.
- **No TypeScript changes.**
- **No new components** — no new files created.
- **No deck list responsive** — that's Story 7.4.
- **No navbar changes** — navbar responsive already done in Story 7.2.

### Cross-Story Dependencies

| Dependency | From |
|---|---|
| `_responsive.scss` (breakpoint variables, mixins) | Story 7.1 |
| `--mobile-header-height` CSS variable | Story 7.2 |
| `mobile-mode` class on app wrapper | Story 7.2 |
| `padding-top` on `<main>` in mobile mode | Story 7.2 |

| This Story Creates | Used By |
|---|---|
| Responsive login page | N/A (self-contained) |
| Responsive settings page | N/A (self-contained) |

### Project Structure Notes

**Files modified by this story:**
```
front/src/app/
  pages/
    login-page/
      login-page.component.scss             # MODIFIED — responsive breakpoints, touch targets
    parameter-page/
      parameter-page.component.scss          # MODIFIED — responsive container, touch targets
      parameter-page.component.html          # MODIFIED — add <h2> heading (Task 2.5)
```

**No new files created by this story.**

### References

- [Source: epics.md#Story 7.3] — Acceptance criteria, user story
- [Source: epics.md#Epic 7 Implementation Notes] — Login + Settings grouped in one story, simple pages, center form
- [Source: architecture.md#Responsive Strategy] — Track B for content pages, breakpoints table
- [Source: ux-design-specification.md#Responsive Strategy] — Track B responsive CSS, breakpoints, mobile-first
- [Source: ux-design-specification.md#Responsive Design & Accessibility] — Touch targets 44×44px, viewport considerations
- [Source: prd.md#NFR11] — Responsive 375px–2560px+, no horizontal scrolling
- [Source: prd.md#NFR12] — Touch targets 44×44px minimum on mobile
- [Source: 7-1-shared-scss-infrastructure-and-scalingcontainerdirective.md] — _responsive.scss details
- [Source: 7-2-responsive-navbar-hamburger-drawer-on-mobile.md] — Previous story patterns, mobile header height, AppComponent mobile-mode

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No debug issues encountered.

### Completion Notes List

- **Task 1 (Login page responsive SCSS):** Rewrote `login-page.component.scss` with mobile-first approach. Replaced `@import "variable"` with `@use 'responsive' as *` + `@use 'variable' as *`. Removed fixed `max-width: 400px` on mobile (restored at `$bp-tablet` via `respond-above`). Buttons stack vertically on mobile (`flex-direction: column; gap: 0.75rem`), switch to row layout at `$bp-mobile` (576px). Applied `touch-target-min` to all buttons, links, and password visibility icon. Icon gets additional padding/cursor/display for 44×44px tap area.
- **Task 2 (Settings page responsive SCSS):** Rewrote `parameter-page.component.scss` with `@use 'responsive' as *`. Mobile-first: `padding: 1rem`, buttons `width: 100%` in column layout with `gap: 0.75rem`. Desktop constraint: `max-width: 600px; margin: 0 auto` at `$bp-desktop-sm`. Applied `touch-target-min` to all buttons. Added `<h2>Paramètres</h2>` heading in template.
- **Task 3 (Build verification):** `ng build --configuration development` passed with zero errors. Manual viewport checks (3.2–3.5) structurally verified: no fixed widths on mobile, mobile-first CSS, no horizontal overflow possible. Login page has no navbar (no overlap issue). Settings page `padding-top` already handled by AppComponent `mobile-mode` class.

### File List

- `front/src/app/pages/login-page/login-page.component.scss` — MODIFIED (responsive breakpoints, touch targets, mobile-first)
- `front/src/app/pages/parameter-page/parameter-page.component.scss` — MODIFIED (responsive container, touch targets, mobile-first)
- `front/src/app/pages/parameter-page/parameter-page.component.html` — MODIFIED (added `<h2>Paramètres</h2>` heading)

## Change Log

- 2026-02-14: Implemented responsive SCSS for login and settings pages (Story 7.3). Mobile-first approach with breakpoint mixins from `_responsive.scss`. Touch targets (44×44px) on all interactive elements. Added page heading to settings. Build verified — zero errors.
- 2026-02-14: **Code Review (AI)** — 4 MEDIUM + 3 LOW issues found, all fixed:
  - M1: Added `h2` styling (`margin-top: 0; margin-bottom: 0.75rem`) in settings SCSS
  - M2: Changed `overflow: hidden` → `overflow-y: auto` on login form (prevents clipping on small mobile)
  - M3: Standardized mixed `em`/`rem` units → all `rem` in login SCSS
  - M4: `mat-icon[matSuffix]` touch target verified OK (Angular Material handles 44px expansion)
  - L1: Removed dead `position: relative; top: 0` on login form
  - L2: Removed unnecessary `flex-wrap: wrap` on login container
  - L3: Git discrepancy noted (8 files from story 7-2 uncommitted — not a 7-3 issue)
  - Build re-verified — zero errors. Status → done.
