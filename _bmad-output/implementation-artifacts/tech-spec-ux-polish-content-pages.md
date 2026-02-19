---
title: 'UX Polish — Content Pages, Notifications & Navbar'
slug: 'ux-polish-content-pages'
created: '2026-02-19'
status: 'implemented'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Angular 19.1.3', 'Angular Material 19.1.1', 'CDK', 'TypeScript 5.5.4', 'SCSS', 'RxJS 7.8']
files_modified:
  # New files
  - 'front/src/app/styles/_z-layers.scss'
  - 'front/src/app/components/snackbar/snackbar.component.ts'
  - 'front/src/app/components/snackbar/snackbar.component.html'
  - 'front/src/app/components/snackbar/snackbar.component.scss'
  - 'front/src/app/components/empty-state/empty-state.component.ts'
  - 'front/src/app/components/empty-state/empty-state.component.html'
  - 'front/src/app/components/empty-state/empty-state.component.scss'
  - 'front/src/app/core/guards/unsaved-changes.guard.ts'
  # Modified files — Foundation
  - 'front/src/app/styles/_tokens.scss'
  - 'front/src/app/styles/variable.scss'
  - 'front/src/app/core/utilities/functions.ts'
  - 'front/src/app/app.config.ts'
  - 'front/angular.json'
  - 'front/package.json'
  - 'front/src/app/app.routes.ts'
  # Modified files — Notification migration
  - 'front/src/app/pages/login-page/login-page.component.ts'
  - 'front/src/app/pages/login-page/login-page.component.html'
  - 'front/src/app/pages/login-page/login-page.component.scss'
  - 'front/src/app/pages/parameter-page/parameter-page.component.ts'
  - 'front/src/app/pages/parameter-page/parameter-page.component.html'
  - 'front/src/app/pages/parameter-page/parameter-page.component.scss'
  - 'front/src/app/services/export.service.ts'
  - 'front/src/app/core/interceptors/auth.interceptor.ts'
  # Modified files — Empty state deployment
  - 'front/src/app/pages/deck-page/components/deck-list/deck-list.component.html'
  - 'front/src/app/pages/deck-page/components/deck-list/deck-list.component.ts'
  # Modified files — Components
  - 'front/src/app/components/navbar/navbar.component.ts'
  - 'front/src/app/components/navbar/navbar.component.html'
  - 'front/src/app/components/navbar/navbar.component.scss'
  - 'front/src/app/services/navbar-collapse.service.ts'
  - 'front/src/app/services/deck-build.service.ts'
  - 'front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts'
  - 'front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html'
  - 'front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss'
  - 'front/src/app/components/card-list/card-list.component.html'
  - 'front/src/app/components/card-list/card-list.component.ts'
  # Modified files — Z-index migration (touched files)
  - 'front/src/app/components/bottom-sheet/bottom-sheet.component.scss'
  - 'front/src/app/components/card-inspector/card-inspector.component.scss'
  - 'front/src/app/components/loader/loader.component.scss'
  - 'front/src/app/styles/mixin.scss'
  # Post-migration
  - '_bmad-output/project-context.md'
code_patterns:
  - 'Standalone components with OnPush + signal-based state'
  - 'Signal inputs: input<T>(), output<T>()'
  - 'Immutable signal updates via .update() — no direct mutation'
  - 'Utility functions as centralized call points (functions.ts)'
  - 'NavbarCollapseService for responsive breakpoint signals'
  - 'Functional interceptors (not class-based)'
  - 'CSS custom properties on :root (_tokens.scss) for theming'
  - 'SCSS mixins via @use from styles/ (includePaths configured)'
  - 'MatSnackBar.openFromComponent() for custom snackbar UI'
  - 'CanDeactivateFn<T> for functional route guards'
test_patterns: ['Manual verification only — big bang approach']
---

# Tech-Spec: UX Polish — Content Pages, Notifications & Navbar

**Created:** 2026-02-19
**Status:** Implemented

## Overview

### Problem Statement

The skytrix content pages (login, parameters) were functional but visually bare — no branding, no structured layout, no user feedback. The notification system relied on ngx-toastr when Angular Material's MatSnackBar was already available and better integrated with the dark theme. The navbar hid all content when collapsed. Z-index values were scattered across 15+ SCSS files with no centralization. The deck builder save action provided zero feedback. Empty states rendered blank space instead of guiding the user.

### Solution

7 targeted UX improvements as documented in the UX Design Specification (revisions N–T, 2026-02-19). Each improvement has a clear design spec with layout, colors, behavior, and responsive requirements defined.

### Scope

**Implemented:**
- Login page: hero-centered layout with logo-icon + logo-text, radial cyan halo, fadeIn animation, `@if`/`@switch` control flow
- Parameters page: mat-card sections with icons, descriptions, loading spinners, last-sync date (localStorage)
- Migration ngx-toastr → MatSnackBar (all call sites + dependency removal)
- Custom SnackbarComponent: left colored border, Material icon, top center position
- Shared EmptyStateComponent: `<app-empty-state>`, deployed on card-list (search, favorites, owned) and deck-list
- Deck builder save feedback: snackbar success/error, dirty indicator (gold dot), canDeactivate guard with dialog
- Navbar collapsed: icon-only mode with matTooltip (56px width)
- Centralized z-index: `_z-layers.scss` with named SCSS variables
- Legacy variable → semantic token migration on touched files

**Out of Scope:**
- Simulator page (no modifications)
- Backend (no endpoint changes)
- New dependencies
- Automated tests (big bang approach — tests after full MVP)
- Deck builder empty state ("Votre deck est vide") — deferred; the search panel is already visible, making a CTA-less empty state low value

## Context for Development

### Codebase Patterns

- Standalone components with OnPush change detection
- Signal-based state management (`signal()`, `computed()`, `.set()`, `.update()`)
- Signal-based inputs/outputs (`input<T>()`, `output<T>()`)
- SCSS with shared styles via `@use` from `src/app/styles/` (includePaths configured)
- Semantic tokens as CSS custom properties on `:root` in `_tokens.scss`
- Responsive mixins in `_responsive.scss` (`respond-above`, `mobile-portrait`, etc.)
- Utility functions in `core/utilities/functions.ts` — `displaySuccess` and `displayError` (centralized call point)
- Material components: mat-form-field (outline), mat-icon, mat-button, mat-card, mat-dialog, mat-menu, mat-tooltip
- NavbarCollapseService manages collapse/mobile state via signals
- Functional interceptors (`authInterceptor`, `loaderInterceptor`)
- DeckBuildService extends SearchServiceCore, uses immutable signal updates

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `styles/_tokens.scss` | Global CSS custom properties (dark theme tokens) |
| `styles/variable.scss` | Legacy SCSS color variables (migration source) |
| `styles/_responsive.scss` | Responsive breakpoint mixins |
| `styles/_z-layers.scss` | Centralized z-index hierarchy (`@use 'z-layers' as z`) |
| `styles/mixin.scss` | Shared mixins (touch-target-min) |
| `core/utilities/functions.ts` | Notification utility functions: `displaySuccess(snackBar, message)`, `displayError(snackBar, error)`, `parseErrorBlob(err, snackBar)` |
| `app.config.ts` | App providers |
| `app.routes.ts` | Route definitions with `canDeactivate: [unsavedChangesGuard]` |
| `services/navbar-collapse.service.ts` | Collapse signals, breakpoints, `COLLAPSED_WIDTH = 56` |
| `services/deck-build.service.ts` | Deck state signals, `save(onSuccess?, onError?)`, `isDirty`, `isSaving`, card mutations |
| `services/export.service.ts` | Uses `parseErrorBlob` with `MatSnackBar` |
| `core/interceptors/auth.interceptor.ts` | Uses `MatSnackBar` + `displayError` in `handleBlobError` |
| `_bmad-output/planning-artifacts/ux-design-specification.md` | UX spec (revisions N–T) — source of truth for all visual/behavioral decisions |

### Technical Decisions

- **MatSnackBar over ngx-toastr**: Zero new dependency, native Material theme integration, CDK overlay z-index management
- **Snackbar position top center**: `verticalPosition: 'top'`, `horizontalPosition: 'center'` — avoids collision with bottom sheet
- **Custom snackbar via openFromComponent()**: Needed for Material icon prefix + colored left border. Simple `open()` doesn't support icon.
- **Snackbar data via MAT_SNACK_BAR_DATA**: Pass `{ message: string, type: 'success' | 'error', icon: string }` to custom component
- **Global panelClass override**: `.snackbar-panel` in `styles.scss` sets `--mdc-snackbar-container-color: transparent` and removes default padding so the custom component styles take over
- **localStorage for last-sync date**: Simple, no backend change, keyed per action (e.g., `sync_cards_lastDate`)
- **Relative time in French**: Hand-rolled `lastSync(key)` method with second/minute/hour/day thresholds and French plural rules (e.g., `il y a ${n} jour${n > 1 ? 's' : ''}`)
- **Shared empty state component**: Standalone component with `message` input + optional `ctaLabel`/`ctaLink` inputs and `ctaAction` output. CTA renders as `<a routerLink>` if `ctaLink` is set, else as `<button>` if `ctaLabel` is set (emitting `ctaAction`). No CTA if neither is set.
- **isDirty signal in DeckBuildService**: Simple boolean signal, set true on mutations, reset on save/init/reset
- **canDeactivate as functional guard**: `CanDeactivateFn<DeckBuilderComponent>` — Angular's router runs functional guards within an injection context, so `inject(MatDialog)` inside the guard body is valid
- **Z-index as SCSS variables**: Build-time constants, no runtime theming needed. `@use 'z-layers' as z` then `z.$z-*`
- **Navbar COLLAPSED_WIDTH = 56**: Accommodates icon-only display with centered icons
- **Name editing dirty tracking**: For existing decks (has id), `stopEditingName()` triggers auto-save via 500ms debounce — dirty resets. For new decks (no id), `markDirty()` is called in `stopEditingName()`.

## Implementation Plan

### Phase 1 — Foundations

#### Task 1: Centralize z-index values

- [x] **1.1** Create `front/src/app/styles/_z-layers.scss`
  - Defined all z-index tokens as SCSS variables:
    ```scss
    $z-card-overlay: 1;
    $z-ui-button: 10;
    $z-hand-backdrop: 20;
    $z-control-bar: 40;
    $z-panel: 50;
    $z-sheet-backdrop: 99;
    $z-sheet: 100;
    $z-hand-hover: 100;
    $z-navbar-header: 1000;
    $z-drag-preview: 1000;
    $z-inspector-mobile: 1001;
    $z-drawer-backdrop: 1050;
    $z-inspector-click: 1050;
    $z-drawer: 1100;
    $z-pile-drag: 1100;
    $z-flight: 10000;
    $z-loader: 100000000;
    ```
- [x] **1.2** Migrate z-index in touched SCSS files (non-simulator only)
  - Files: `navbar.component.scss`, `bottom-sheet.component.scss`, `card-inspector.component.scss`, `loader.component.scss`, `mixin.scss`, `deck-builder.component.scss`, `card-list.component.scss`
  - Added `@use 'z-layers' as z;` and replaced hardcoded z-index values with `z.$z-*` tokens
  - Simulator component SCSS files not touched (out of scope). Their hardcoded values will migrate when simulator stories are implemented.

#### Task 2: Create custom SnackbarComponent + migrate ngx-toastr → MatSnackBar

**This task was atomic — all sub-tasks completed together.**

- [x] **2.1** Create `front/src/app/components/snackbar/snackbar.component.ts`
  - Standalone component, OnPush. Injects `MAT_SNACK_BAR_DATA` (typed as `SnackbarData: { message: string, type: 'success' | 'error', icon: string }`). Injects `MatSnackBarRef` for dismiss button.
- [x] **2.2** Create `front/src/app/components/snackbar/snackbar.component.html`
  - Template with Material icon prefix + message + dismiss button:
    ```html
    <div class="snackbar" [class.snackbar-success]="data.type === 'success'" [class.snackbar-error]="data.type === 'error'">
      <mat-icon>{{ data.icon }}</mat-icon>
      <span class="snackbar-message">{{ data.message }}</span>
      <button mat-icon-button (click)="snackBarRef.dismiss()" aria-label="Fermer">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    ```
- [x] **2.3** Create `front/src/app/components/snackbar/snackbar.component.scss`
  - Styles per UX spec — `--surface-card` background, 3px left border (`--accent-primary` for success, `--danger` for error), icon colored by type, flexbox row layout, 8px border-radius.
  - Global `.snackbar-panel` panelClass in `styles.scss` removes default MatSnackBar padding/background.
- [x] **2.4** Update `front/src/app/core/utilities/functions.ts`
  - Utility functions use `MatSnackBar` with `openFromComponent(SnackbarComponent, ...)`:
    - `displaySuccess(snackBar: MatSnackBar, message: string)`: type `'success'`, icon `'check_circle'`, duration 3000ms, top center
    - `displayError(snackBar: MatSnackBar, error: HttpErrorResponse | string)`: type `'error'`, icon `'error'`, extracts message from `error.error?.error` if HttpErrorResponse
    - `parseErrorBlob(err: HttpErrorResponse, snackBar: MatSnackBar)`: calls `displayError` internally
- [x] **2.5** Update `front/src/app/pages/login-page/login-page.component.ts`
  - Injects `MatSnackBar`. Calls `displaySuccess`/`displayError` for account creation and login.
- [x] **2.6** Update `front/src/app/pages/parameter-page/parameter-page.component.ts`
  - Injects `MatSnackBar`. Calls `displaySuccess`/`displayError` for all fetch actions.
- [x] **2.7** Update `front/src/app/services/export.service.ts`
  - Injects `MatSnackBar`. Uses `parseErrorBlob(err, snackBar)` in catchError pipe.
- [x] **2.8** Update `front/src/app/core/interceptors/auth.interceptor.ts`
  - `handleBlobError()` uses `inject(MatSnackBar)` and calls `displayError(snackBar, messageObject.message)`.
- [x] **2.9** Clean config files
  - `app.config.ts`: No `provideToastr()` — only standard Angular providers remain
  - `angular.json`: No `ngx-toastr/toastr.css` in styles array
  - `package.json`: No `ngx-toastr` in dependencies
- [x] **2.10** Build verification passed — all files updated atomically
- [x] **2.11** Global snackbar panel styles added to `front/src/styles.scss`
  - `.snackbar-panel` class sets `--mdc-snackbar-container-color: transparent` and removes default padding

#### Task 3: Create shared EmptyStateComponent

- [x] **3.1** Create `front/src/app/components/empty-state/empty-state.component.ts`
  - Standalone component, OnPush. Signal inputs: `message: input.required<string>()`, `ctaLabel: input<string>()`, `ctaLink: input<string>()`. Output: `ctaAction: output<void>()`. If `ctaLink` is set, renders `<a routerLink>`. Else if `ctaLabel` is set, renders `<button>` that emits `ctaAction`. Otherwise, no CTA.
- [x] **3.2** Create `front/src/app/components/empty-state/empty-state.component.html`
  - Template:
    ```html
    <div class="empty-state">
      <p class="empty-state-message">{{ message() }}</p>
      @if (ctaLink()) {
        <a class="empty-state-cta" [routerLink]="ctaLink()">{{ ctaLabel() }}</a>
      } @else if (ctaLabel()) {
        <button class="empty-state-cta" (click)="ctaAction.emit()">{{ ctaLabel() }}</button>
      }
    </div>
    ```
- [x] **3.3** Create `front/src/app/components/empty-state/empty-state.component.scss`
  - Centered flex column layout, `padding: 4rem 1rem`, `gap: 1.5rem`. Message in `--text-secondary`, 1.1rem. CTA: `--accent-primary` border + text, 8px radius, hover with `color-mix(in srgb, var(--accent-primary) 10%, transparent)`.

### Phase 2 — Pages (independent, done in parallel)

#### Task 4: Login page redesign

- [x] **4.1** Update `front/src/app/pages/login-page/login-page.component.html`
  - Logo section above form: `<img class="loginPage-logo-icon" src="/assets/images/logo-icon.png" alt="skytrix">` + `<img class="loginPage-logo-text" src="/assets/images/logo-text.png" alt="skytrix">`. Uses `@switch`/`@if` control flow (no legacy directives). No `<h2>Login</h2>` (logo replaces it). Keeps `<h2>Créer un compte</h2>` for create account mode.
- [x] **4.2** Update `front/src/app/pages/login-page/login-page.component.scss`
  - Logo styles: `.loginPage-logo-icon` (width 140px desktop, 100px mobile) + `.loginPage-logo-text` (max-width 200px desktop, 150px mobile). Radial gradient: `radial-gradient(ellipse at center top, rgba(0, 212, 255, 0.06) 0%, transparent 60%)`. Animation: `@keyframes fadeIn` 400ms ease. `prefers-reduced-motion: reduce` disables animation. Error text uses `var(--danger)`. No legacy `$blue` or `@use 'variable'`.
- [x] **4.3** Update `front/src/app/pages/login-page/login-page.component.ts`
  - Imports: `ReactiveFormsModule`, `MatFormField`, `MatIcon`, `MatInput`, `MatLabel`, `MatSuffix`, `MatButton`. No legacy directives (`NgSwitch`, `NgSwitchCase`, `NgIf`). Injects `MatSnackBar`.

#### Task 5: Parameters page redesign

- [x] **5.1** Update `front/src/app/pages/parameter-page/parameter-page.component.html`
  - Three mat-card sections: "Base de données" (`storage` icon, cards action), "Images" (`image` icon — original + `translate` icon — translated, separated by `mat-divider`), "Règles" (`gavel` icon, banlist). Each action row: icon in `<h3>`, info column (title + description + last-sync date), action button with `mat-spinner` (diameter 20) while loading.
- [x] **5.2** Update `front/src/app/pages/parameter-page/parameter-page.component.scss`
  - Cards: `--surface-card` background, `--border-subtle` border, 8px radius. Section headers: `--text-secondary`, 500 weight, icon inline. Action rows: flex row, info flex-column, button right-aligned. Description/date in `--text-secondary`. Max-width 600px centered. Responsive: 1rem mobile, 2rem desktop.
- [x] **5.3** Update `front/src/app/pages/parameter-page/parameter-page.component.ts`
  - `loading` signal: `signal({ cards: false, images: false, tcgImages: false, banlist: false })`. `setLoading()` helper updates specific key via `.update()`. `lastSync(key: string): string` reads from localStorage (`sync_${key}_lastDate`), returns French relative time:
    ```typescript
    lastSync(key: string): string {
      const raw = localStorage.getItem(`sync_${key}_lastDate`);
      if (!raw) return 'Jamais synchronisé';
      const date = new Date(raw);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return 'il y a quelques secondes';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `il y a ${diffMin} minute${diffMin > 1 ? 's' : ''}`;
      const diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return `il y a ${diffH} heure${diffH > 1 ? 's' : ''}`;
      const diffD = Math.floor(diffH / 24);
      return `il y a ${diffD} jour${diffD > 1 ? 's' : ''}`;
    }
    ```
  - On fetch success: stores `new Date().toISOString()` in localStorage, calls `displaySuccess`. On error: calls `displayError`. Private helpers `onSuccess(key, message)` and `onError(key, error)` factored out. Imports: `MatCard`, `MatDivider`, `MatIconModule`, `MatProgressSpinner`.

#### Task 6: Navbar icon-only collapse

- [x] **6.1** Verified `COLLAPSED_WIDTH = 56` in `navbar-collapse.service.ts`
  - Already set to 56 (icon-only mode). `navbarWidth` computed signal returns 56 when collapsed, 260 when expanded.
- [x] **6.2** Update `front/src/app/components/navbar/navbar.component.html`
  - Desktop sidebar: `@for (tab of tabs; track tab.path)` always renders nav links with icons outside the collapsed condition. Labels conditionally rendered: `@if (!collapsed()) { <span class="nav-label">{{ tab.name }}</span> }`. Logo and user section inside `@if (!collapsed())`. `matTooltip` on each link: `[matTooltip]="tab.name" [matTooltipDisabled]="!collapsed()"`.
- [x] **6.3** Update `front/src/app/components/navbar/navbar.component.scss`
  - `.collapsed` width: 56px. Icon-only mode: nav-link centered with `justify-content: center`, icon `margin-right: 0`. Active state in collapsed: `background: var(--accent-primary-dim); border-left-color: transparent; border-radius: 8px`. Label transition: `opacity 200ms ease`. Sidebar transition: `width 200ms ease`. `prefers-reduced-motion: reduce` disables all transitions (sidebar, collapse-toggle, drawer, backdrop, nav-link, nav-label).
- [x] **6.4** Update `front/src/app/components/navbar/navbar.component.ts`
  - `MatTooltip` added to imports array.

### Phase 3 — Integration

#### Task 7: Deploy empty states

- [x] **7.1** Update `front/src/app/components/card-list/card-list.component.html`
  - After `@for` loop and spinner, empty state check:
    ```html
    @if (!svc?.isLoading() && (cardsDetails$() | async)?.length === 0) {
      <app-empty-state
        [message]="emptyMessage()"
        [ctaLabel]="emptyCta()"
        (ctaAction)="onEmptyCta()">
      </app-empty-state>
    }
    ```
- [x] **7.2** Update `front/src/app/components/card-list/card-list.component.ts`
  - `EmptyStateComponent` added to imports. Computed signals for empty state messages:
    - `FAVORITE`: "Pas encore de favoris — marquez vos cartes préférées avec l'étoile"
    - `OWNED`: "Aucune carte marquée comme possédée"
    - `INFORMATIVE` / `MOSAIC` (default): "Aucun résultat trouvé"
  - `emptyCta` computed: returns "Effacer les filtres" for INFORMATIVE/MOSAIC, empty string otherwise
  - `onEmptyCta()` calls `searchService()?.clearFilters()` (method exists in `SearchServiceCore` line 77 — resets form controls and emits `filtersCleared$`)
- [x] **7.3** `card-list.component.scss` — No changes needed, EmptyStateComponent handles its own styling
- [x] **7.4** Deck list page already uses EmptyStateComponent
  - `deck-list.component.html` line 19: `<app-empty-state message="Aucun deck pour le moment" ctaLabel="Créer un deck" ctaLink="/decks/builder"></app-empty-state>`. `EmptyStateComponent` in imports.

**Note:** The UX spec (Revision P) also defines a deck builder empty state ("Votre deck est vide — recherchez des cartes pour commencer"). This was intentionally deferred — the search panel is already visible in the deck builder, making a CTA-less empty state low value for this iteration.

#### Task 8: Deck builder save feedback

- [x] **8.1** Update `front/src/app/services/deck-build.service.ts`
  - Dirty tracking signals:
    ```typescript
    private readonly _isDirty = signal(false);
    readonly isDirty = this._isDirty.asReadonly();
    private readonly _isSaving = signal(false);
    readonly isSaving = this._isSaving.asReadonly();

    markDirty(): void { this._isDirty.set(true); }
    private resetDirty(): void { this._isDirty.set(false); }
    ```
  - `this._isDirty.set(true)` at the end of: `addCard`, `removeCard`, `removeFirstCard`, `updateCardIndex`, `addImage`, `removeImage`, `updateImageIndex` (7 mutation methods — all accounted for)
  - `this.resetDirty()` in: `save()` success callback, `initDeck()`, `resetDeck()`
  - Save signature accepts optional callbacks:
    ```typescript
    public save(onSuccess?: () => void, onError?: (error: HttpErrorResponse) => void): void {
      this._isSaving.set(true);
      this.httpClient
        .post<DeckDTO>('/api/decks', new CreateDeckDTO(this.deck()))
        .pipe(take(1))
        .subscribe({
          next: (deck: DeckDTO) => {
            this.deckState.set(new Deck(deck));
            this.resetDirty();
            this._isSaving.set(false);
            onSuccess?.();
          },
          error: (err: HttpErrorResponse) => {
            this._isSaving.set(false);
            onError?.(err);
          },
        });
    }
    ```
- [x] **8.2** Update `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts`
  - Injects `MatSnackBar`
  - `save()` passes callbacks:
    ```typescript
    public save(): void {
      this.deckBuildService.save(
        () => displaySuccess(this.snackBar, 'Deck sauvegardé'),
        (err) => displayError(this.snackBar, err)
      );
    }
    ```
  - `stopEditingName()`: calls `this.deckBuildService.markDirty()` for new decks (no id), triggers auto-save via 500ms debounce for existing decks (has id)
  - Exposes `isDirty = this.deckBuildService.isDirty` as component property
- [x] **8.3** Update `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html`
  - Dirty indicator dot on both save buttons (mobile + desktop):
    ```html
    <button mat-icon-button [disabled]="deckBuildService.deckEmpty()" (click)="save()" aria-label="Sauvegarder">
      <mat-icon>save</mat-icon>
      @if (isDirty()) {
        <span class="dirty-dot"></span>
      }
    </button>
    ```
- [x] **8.4** Update `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss`
  - Dirty dot styles:
    ```scss
    .dirty-dot {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-primary);
    }
    ```
  - Legacy variables migrated to semantic tokens (`var(--text-primary)`, `var(--accent-primary)`, etc.)
- [x] **8.5** Create `front/src/app/core/guards/unsaved-changes.guard.ts`
  - Functional `canDeactivate` guard. Angular's router runs `CanDeactivateFn` within an injection context, so `inject(MatDialog)` inside the guard body is valid:
    ```typescript
    export const unsavedChangesGuard: CanDeactivateFn<DeckBuilderComponent> = (component) => {
      if (!component.deckBuildService.isDirty() || component.deckBuildService.isSaving()) return true;

      const dialog = inject(MatDialog);
      const dialogRef = dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
        data: {
          title: 'Modifications non sauvegardées',
          message: 'Voulez-vous quitter sans sauvegarder ?',
          confirmLabel: 'Quitter',
          cancelLabel: 'Rester',
        },
      });

      return dialogRef.afterClosed().pipe(map(result => !!result));
    };
    ```
  - Reuses existing `ConfirmDialogComponent` — its `ConfirmDialogData` interface already supports `title`, `message`, `confirmLabel?`, `cancelLabel?`.
- [x] **8.6** Update `front/src/app/app.routes.ts`
  - `canDeactivate: [unsavedChangesGuard]` on both deck builder routes:
    ```typescript
    { path: 'decks/builder', component: DeckBuilderComponent, canActivate: [AuthService], canDeactivate: [unsavedChangesGuard] },
    { path: 'decks/:id', component: DeckBuilderComponent, canActivate: [AuthService], canDeactivate: [unsavedChangesGuard] },
    ```

### Phase 4 — Cleanup

#### Task 9: Update project-context.md

- [x] **9.1** Update `_bmad-output/project-context.md`
  - Removed `ngx-toastr 19.0.0` from Technology Stack > Frontend. Updated Framework-Specific Rules > Angular: "Notifications via MatSnackBar with custom SnackbarComponent (openFromComponent). Utility functions `displaySuccess`/`displayError` in `core/utilities/functions.ts`." Added z-layers note: "Z-index values centralized in `styles/_z-layers.scss` — always use `@use 'z-layers' as z` and reference `z.$z-*` tokens."

### Acceptance Criteria

#### AC-1: Z-Index Centralization
- [x] Given the app is built, when inspecting any non-simulator SCSS file, then no hardcoded z-index values remain — all reference `z.$z-*` tokens from `_z-layers.scss`
- [x] Given `_z-layers.scss` exists, when a developer needs a z-index, then the layer hierarchy is documented and discoverable in one file

#### AC-2: Snackbar Migration
- [x] Given any action triggers a success notification, when the snackbar appears, then it displays at top center with `--surface-card` background, 3px gold left border, `check_circle` icon, and auto-dismisses after 3 seconds
- [x] Given any action triggers an error notification, when the snackbar appears, then it displays at top center with `--surface-card` background, 3px red (`--danger`) left border, `error` icon, and error message
- [x] Given the migration is complete, when searching for "ngx-toastr" in the codebase, then zero results are found (no imports, no providers, no CSS, no package dependency)
- [x] Given the bottom sheet is open on mobile, when a snackbar appears, then they do not overlap (snackbar is top, sheet is bottom)
- [x] Given a snackbar is visible, when clicking the dismiss (close) button, then the snackbar closes immediately

#### AC-3: Empty State Component
- [x] Given the card search returns no results, when the card-list renders, then "Aucun résultat trouvé" is displayed with an "Effacer les filtres" CTA button
- [x] Given the favorites list is empty, when the card-list renders in FAVORITE mode, then "Pas encore de favoris — marquez vos cartes préférées avec l'étoile" is displayed without CTA
- [x] Given the owned list is empty, when the card-list renders in OWNED mode, then "Aucune carte marquée comme possédée" is displayed without CTA
- [x] Given the deck list is empty, when the deck-list renders, then "Aucun deck pour le moment" is displayed with "Créer un deck" CTA linking to `/decks/builder`

#### AC-4: Login Page
- [x] Given the login page loads, when the page appears, then the logo-icon (crystal wings) and logo-text (SKYTRIX) are centered above the form with a subtle cyan radial halo behind the logo
- [x] Given `prefers-reduced-motion` is NOT set, when the page loads, then a 400ms fadeIn animation plays
- [x] Given `prefers-reduced-motion` IS set, when the page loads, then the page appears instantly without animation
- [x] Given the login page code, when inspecting imports, then no `NgSwitch`, `NgSwitchCase`, or `NgIf` are present — uses `@if`/`@switch` control flow
- [x] Given the viewport is mobile (≤576px), when viewing the login page, then the logo-icon is 100px and the form takes full width

#### AC-5: Parameters Page
- [x] Given the parameters page loads, when viewing it, then 3 card sections are visible (Base de données, Images, Règles) with icons, descriptions, and action buttons
- [x] Given an update action is clicked, when the fetch is in progress, then the button shows a spinner and is disabled
- [x] Given the fetch succeeds, when the snackbar appears, then a success message is shown and the last-sync date updates to "il y a quelques secondes"
- [x] Given the fetch fails, when the snackbar appears, then an error message is shown
- [x] Given a previous sync was performed, when viewing the parameters page, then the last-sync date displays correctly (e.g., "il y a 3 jours")
- [x] Given no sync has ever been performed, when viewing the parameters page, then the date displays "Jamais synchronisé"

#### AC-6: Navbar Collapsed
- [x] Given the navbar is collapsed on desktop, when viewing it, then navigation icons are visible (centered in 56px width), labels are hidden, and tooltips appear on hover
- [x] Given the navbar is collapsed, when the active route icon is visible, then it has an accent background (rounded, `--accent-primary-dim`) instead of a left border
- [x] Given `prefers-reduced-motion` is set, when toggling collapse, then no width/opacity transition occurs

#### AC-7: Deck Builder Save Feedback
- [x] Given a card is added to the deck, when viewing the save button, then a gold dot (8px) appears on the save icon indicating unsaved changes
- [x] Given the deck is saved successfully, when the save completes, then the gold dot disappears and a "Deck sauvegardé" snackbar appears
- [x] Given the save fails, when the error occurs, then an error snackbar appears and the gold dot remains
- [x] Given the deck has unsaved changes, when navigating away, then a confirmation dialog appears: "Modifications non sauvegardées — Voulez-vous quitter sans sauvegarder?" with "Rester" and "Quitter" buttons
- [x] Given the user clicks "Rester" in the dialog, when the dialog closes, then navigation is cancelled and the user stays on the deck builder
- [x] Given a new deck (no id) has its name edited, when the name input blurs, then the dirty indicator appears (no auto-save for new decks)
- [x] Given an existing deck (has id) has its name edited, when the name input blurs, then auto-save triggers after 500ms debounce and dirty resets on success
- [x] Given save is in-flight (HTTP request pending), when navigating away, then navigation is allowed without the confirmation dialog (save will complete)

## Additional Context

### Dependencies

- Removed: `ngx-toastr` (`package.json`, `angular.json` styles, `app.config.ts` provider)
- Added: None
- Reused: `ConfirmDialogComponent` (existing, data interface already supported custom labels)

### Testing Strategy

No automated tests per project approach (big bang — tests after full MVP). Manual verification:

1. After Task 2: verify all existing notification points still fire (login success/error, parameter success/error, export error, auth interceptor error)
2. After Task 4: verify login/create account flow works, responsive at 375px and 1920px
3. After Task 5: verify all 4 fetch actions work with loading spinner and snackbar feedback
4. After Task 6: verify navbar collapse shows icons, tooltips appear, active state highlights
5. After Task 7: verify empty states appear in all 4 contexts (search, favorites, owned, deck list)
6. After Task 8: verify dirty dot, save snackbar, navigation guard dialog, new vs existing deck behavior

### Notes

- **ConfirmDialogComponent reuse**: The existing dialog for deck deletion already had `ConfirmDialogData` with optional `confirmLabel`/`cancelLabel`. No interface extension was needed.
- **UX Design Specification**: All visual decisions (colors, spacing, responsive breakpoints, animations) are specified in `_bmad-output/planning-artifacts/ux-design-specification.md` (revisions N–T). Refer to it for any ambiguity.
- **Simulator isolation**: No simulator SCSS files were touched. Simulator z-index values stay hardcoded until simulator stories migrate them.
- **Legacy variable migration**: Only migrated variables in files already modified by this tech-spec. Files outside scope were not touched just for variable cleanup.
- **Deck builder empty state gap**: UX spec Revision P defines "Votre deck est vide — recherchez des cartes pour commencer" for the deck builder. This was deferred because the search panel is already visible, making a CTA-less message low priority. Can be added in a future iteration if needed.
