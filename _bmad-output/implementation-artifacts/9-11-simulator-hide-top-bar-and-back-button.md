# Story 9.11: Simulator Hide Top Bar & Back Button

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the mobile top bar hidden in landscape simulator mode with a back button in the control bar,
So that the simulator is fully immersive with maximum board space.

## Acceptance Criteria

1. **Given** the mobile top bar consumes 48px on the simulator in landscape
   **When** landscape simulator mode is detected (`isMobile()` AND `orientation: landscape`)
   **Then** the top bar is hidden (simulator-specific immersive mode)
   **And** the board scaling recalculates to use the full viewport height (no 48px subtraction)

2. **Given** the top bar is hidden
   **When** a back/exit button is added to the control bar pill (top position, visually separated)
   **Then** it navigates back to the deck builder (`/decks/:id`)
   **And** no quit confirmation is needed (state is ephemeral by design)

3. **Given** the immersive mode uses a service signal on `NavbarCollapseService`
   **When** the simulator component is destroyed (user navigates away)
   **Then** the signal is cleaned up (`immersiveMode` set to `false`) and the top bar reappears on other pages

## Tasks / Subtasks

- [x] Task 1: Add immersive mode + landscape detection to `NavbarCollapseService` (AC: #1, #3)
  - [x] 1.1: Add `readonly immersiveMode = signal(false);` property
  - [x] 1.2: Add `setImmersiveMode(value: boolean): void { this.immersiveMode.set(value); }` method
  - [x] 1.3: Add landscape detection signal via BreakpointObserver:
    ```typescript
    readonly isLandscape = toSignal(
      this.breakpointObserver
        .observe(['(orientation: landscape)'])
        .pipe(map(result => result.matches)),
      { initialValue: false }
    );
    ```
  - [x] 1.4: Add computed signal combining both:
    ```typescript
    readonly shouldHideTopBar = computed(() => this.immersiveMode() && this.isLandscape());
    ```
  - [x] 1.5: Verify `signal`, `computed`, `toSignal`, and `map` are already imported (they are — just confirm)

- [x] Task 2: Set immersive mode in `SimulatorPageComponent` (AC: #1, #3)
  - [x] 2.1: Inject `NavbarCollapseService` in `SimulatorPageComponent` (add `private readonly navbarCollapse = inject(NavbarCollapseService);`)
  - [x] 2.2: Inject `DestroyRef` (add `private readonly destroyRef = inject(DestroyRef);`)
  - [x] 2.3: In the constructor, AFTER the existing deck-loading logic, add:
    ```typescript
    this.navbarCollapse.setImmersiveMode(true);
    this.destroyRef.onDestroy(() => this.navbarCollapse.setImmersiveMode(false));
    ```
  - [x] 2.4: Verify `NavbarCollapseService` and `DestroyRef` imports are added at top of file

- [x] Task 3: Conditionally hide mobile top bar in `NavbarComponent` (AC: #1)
  - [x] 3.1: Add `readonly shouldHideTopBar = this.navbarCollapse.shouldHideTopBar;` in `NavbarComponent` class (service already injected as `this.navbarCollapse`)
  - [x] 3.2: In `navbar.component.html`, change the mobile top bar conditional from:
    ```html
    @if (isMobile()) {
      <header class="mobile-top-bar" ...>
    ```
    to:
    ```html
    @if (isMobile() && !shouldHideTopBar()) {
      <header class="mobile-top-bar" ...>
    ```
  - [x] 3.3: The drawer backdrop and mobile-drawer `@if` blocks remain unchanged — they are INSIDE the same `@if (isMobile())` block. If the top bar condition now guards ALL mobile elements, the drawer must still be accessible. **VERIFY**: Is the drawer rendered in the same `@if` block as the top bar? If yes, they must be separated so the drawer can still be opened even without the top bar. If the drawer and backdrop are in a separate `@if` block, no change needed.
    - Based on the current template, the top bar, backdrop, and drawer are ALL inside the SAME `@if (isMobile())` block. Splitting is needed:
    ```html
    @if (isMobile() && !shouldHideTopBar()) {
      <header class="mobile-top-bar" aria-label="Application header">
        <!-- hamburger + title -->
      </header>
    }

    @if (isMobile()) {
      <div class="drawer-backdrop" [class.visible]="drawerOpen()" (click)="closeDrawer()"></div>
      <nav class="mobile-drawer" [class.open]="drawerOpen()">
        <!-- drawer content -->
      </nav>
    }
    ```
    This keeps the drawer functional even when the top bar is hidden (e.g., if a future story needs drawer access in landscape). But since there's no hamburger button visible when the top bar is hidden, the drawer is practically inaccessible — which is fine, as the back button provides the only needed navigation.
    **Simpler alternative**: Keep the entire mobile block in one `@if (isMobile())` but wrap ONLY the `<header>` in `@if (!shouldHideTopBar())`:
    ```html
    @if (isMobile()) {
      @if (!shouldHideTopBar()) {
        <header class="mobile-top-bar" aria-label="Application header">
          <!-- hamburger + title -->
        </header>
      }

      <div class="drawer-backdrop" [class.visible]="drawerOpen()" (click)="closeDrawer()"></div>
      <nav class="mobile-drawer" [class.open]="drawerOpen()">
        <!-- drawer content -->
      </nav>
    }
    ```
    **USE THIS SIMPLER APPROACH** — it preserves the existing template structure with minimal changes.

- [x] Task 4: Add back button to `SimControlBarComponent` (AC: #2)
  - [x] 4.1: Inject `Router` and `ActivatedRoute`:
    ```typescript
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    ```
  - [x] 4.2: Add `deckId` signal from route params:
    ```typescript
    readonly deckId = toSignal(
      this.route.paramMap.pipe(map(params => Number(params.get('id')) || 0)),
      { initialValue: 0 }
    );
    ```
  - [x] 4.3: Add `onBack()` method:
    ```typescript
    onBack(): void {
      const id = this.deckId();
      this.router.navigate(id > 0 ? ['/decks', id] : ['/decks']);
    }
    ```
  - [x] 4.4: Add required imports at top of file:
    ```typescript
    import { Router, ActivatedRoute } from '@angular/router';
    import { toSignal } from '@angular/core/rxjs-interop';
    import { map } from 'rxjs';
    ```
  - [x] 4.5: In `control-bar.component.html`, add back button at the TOP of the control bar (BEFORE the undo button), with a separator after it:
    ```html
    <div class="control-bar" role="toolbar" aria-label="Session controls">
      <button mat-icon-button
              aria-label="Back to deck builder"
              matTooltip="Back"
              (click)="onBack()">
        <mat-icon>arrow_back</mat-icon>
      </button>

      <div class="separator"></div>

      <button mat-icon-button [disabled]="!canUndo()" aria-label="Undo" matTooltip="Undo (Ctrl+Z)">
        <mat-icon>undo</mat-icon>
      </button>
      <!-- ... rest unchanged ... -->
    </div>
    ```
  - [x] 4.6: NO new Angular Material modules needed — `MatIconModule`, `MatButtonModule`, `MatTooltipModule` are already imported in the control bar

- [x] Task 5: Update board scaling to account for hidden top bar (AC: #1)
  - [x] 5.1: In `board.component.ts`, add `shouldHideTopBar` to the effect's tracked signals:
    ```typescript
    constructor() {
      effect(() => {
        this.navbarCollapse.navbarWidth();
        this.navbarCollapse.isMobile();
        this.navbarCollapse.shouldHideTopBar();  // NEW — track immersive mode changes
        untracked(() => this.recalculateScale());
      });
    }
    ```
  - [x] 5.2: Update `recalculateScale()` to dynamically compute top bar height:
    ```typescript
    private recalculateScale(): void {
      const isMobile = this.navbarCollapse.isMobile();
      const availableWidth = isMobile
        ? window.innerWidth
        : window.innerWidth - this.navbarCollapse.navbarWidth();
      const topBarVisible = isMobile && !this.navbarCollapse.shouldHideTopBar();
      const availableHeight = topBarVisible
        ? window.innerHeight - NavbarCollapseService.MOBILE_HEADER_HEIGHT
        : window.innerHeight;
      this.scaleFactor.set(Math.min(availableWidth / 1060, availableHeight / 772, 1));
    }
    ```

- [x] Task 6: Verify zero regression (AC: #1, #2, #3)
  - [x] 6.1: Run `ng build` — confirm zero compilation errors
  - [x] 6.2: Verify mobile portrait on simulator: top bar VISIBLE, back button in control bar works
  - [x] 6.3: Verify mobile landscape on simulator: top bar HIDDEN, board scales larger (uses full viewport height), back button in control bar works
  - [x] 6.4: Verify mobile landscape on other pages (deck list, deck builder, card search): top bar VISIBLE (immersive mode not active)
  - [x] 6.5: Verify desktop: sidebar visible, no top bar (unchanged), back button in control bar works
  - [x] 6.6: Navigate back: back button goes to `/decks/:id` (deck builder), NOT `/decks` (deck list)
  - [x] 6.7: Verify destroy cleanup: leave simulator (via back button or browser nav) → top bar reappears on the next page
  - [x] 6.8: Verify drag & drop still works on the simulator after scaling change (landscape + portrait)

## Dev Notes

### Why This Story Exists

This is story 11 of Epic 9 (UI/UX Modernization). On mobile landscape, the top bar (48px hamburger bar) wastes vertical space on the simulator — the most space-constrained screen. Hiding it reclaims 48px, which at typical mobile landscape heights (360–400px) represents a ~14% increase in available board height. The board scales proportionally larger, making cards more legible and interactions easier.

Without the top bar, there's no navigation out of the simulator. A back button in the control bar pill solves this, matching the Screen Implementation Guide's layout specification.

### What This Story Does

- Adds an `immersiveMode` signal to `NavbarCollapseService` (set by simulator page, cleaned up on destroy)
- Adds an `isLandscape` signal via `BreakpointObserver` to detect orientation
- Adds a `shouldHideTopBar` computed signal combining `immersiveMode` and `isLandscape`
- Conditionally hides the mobile top bar in the navbar template when `shouldHideTopBar()` is true
- Adds a back button (arrow_back icon) at the top of the control bar pill, visually separated by a divider
- Updates the board scaling calculation to use full viewport height when the top bar is hidden

### What This Story Does NOT Do

- Does NOT modify `_sim-tokens.scss` or any simulator token/color values
- Does NOT change the control bar's position (`fixed bottom-right 12px`) or styling (frosted glass pill)
- Does NOT modify the board grid layout, zone structure, or card rendering
- Does NOT add landscape-locking or touch-mode (post-MVP per UX spec)
- Does NOT affect the desktop sidebar or its collapse behavior
- Does NOT modify `_responsive.scss` — uses BreakpointObserver in the service instead of CSS media queries (reactive signals needed for the scaling calculation)
- Does NOT add confirmation dialogs on back navigation (state is ephemeral by design)
- Does NOT modify any other page's behavior — immersive mode is strictly simulator-scoped

### Service Signal Architecture

The immersive mode follows the existing `NavbarCollapseService` pattern — a root-provided service managing global layout signals. The `immersiveMode` signal is:

1. **Set** by `SimulatorPageComponent` on creation (`inject` in constructor)
2. **Read** by `NavbarComponent` to conditionally render the top bar
3. **Read** by `BoardComponent` (via `shouldHideTopBar`) to adjust scale factor
4. **Cleaned up** by `SimulatorPageComponent` on destroy via `DestroyRef.onDestroy()`

```
SimulatorPageComponent
  ├── sets immersiveMode(true) on init
  ├── cleans up immersiveMode(false) on destroy
  │
  └── BoardComponent
        ├── reads shouldHideTopBar() for scale calculation
        └── SimControlBarComponent
              └── back button navigates to /decks/:id

NavbarComponent (separate tree)
  └── reads shouldHideTopBar() to hide/show mobile top bar
```

**Critical cleanup**: If `DestroyRef.onDestroy` does NOT fire (e.g., app crash), `immersiveMode` stays `true`. On next navigation, `SimulatorPageComponent` sets it again (no issue). On navigation to another page, the old simulator instance is destroyed (Angular guarantees `DestroyRef` fires before next route renders). So cleanup is reliable.

### Control Bar Back Button

The back button is **always visible** in the control bar, regardless of viewport or orientation. Rationale:
- On mobile landscape (top bar hidden): it's the **only** navigation option — critical
- On mobile portrait (top bar visible): provides a convenient shortcut (no need to open drawer → find nav link)
- On desktop (sidebar visible): provides a convenient shortcut (direct back vs. clicking sidebar nav)

The button uses `ActivatedRoute.paramMap` to extract the deck ID (`:id` from the route `decks/:id/simulator`). This works because `ActivatedRoute` in Angular injects the nearest ancestor's route params when the component doesn't have its own route segment.

**Layout per Screen Implementation Guide:**
```
┌─────┐
│  ←  │  Back to deck builder (/decks/:id)
├─────┤
│  ↩  │  Undo
│  ↪  │  Redo
├─────┤
│  ⟳  │  Reset
└─────┘
```

### Board Scaling Impact

On a typical mobile landscape viewport (812×375):

| Metric | Before (top bar visible) | After (top bar hidden) |
|--------|-------------------------|----------------------|
| Available height | 375 - 48 = 327px | 375px |
| Scale factor (height) | 327/772 = 0.423 | 375/772 = 0.486 |
| Rendered board height | 327px | 375px |
| Board area increase | — | +14.7% |

The width scale factor (812/1060 = 0.766) remains the height bottleneck, so the height gain translates directly to a larger board.

### Landscape Detection via BreakpointObserver

Rather than using CSS media queries (which can't inform TypeScript scaling logic), landscape detection uses `BreakpointObserver.observe(['(orientation: landscape)'])`. This produces a reactive signal that:
- Feeds into `shouldHideTopBar` computed signal
- Triggers the board scaling `effect()` automatically
- Is consistent with the existing `isMobile` pattern in the same service

### NavbarCollapseService Breakpoints (Existing)

```typescript
// Existing — determines isMobile():
'(max-width: 767px)', '(max-width: 1023px) and (max-height: 500px)'

// New — determines isLandscape():
'(orientation: landscape)'
```

`isMobile()` is `true` for:
- Any viewport ≤ 767px width (portrait phones)
- Viewport ≤ 1023px width AND ≤ 500px height (landscape phones/small tablets)

`shouldHideTopBar()` is `true` when: `immersiveMode() && isLandscape()`. Since top bar only renders when `isMobile()`, the landscape check combined with immersive mode is sufficient.

### Routing

| Route | Page | Deck ID |
|-------|------|---------|
| `/decks/:id/simulator` | Simulator | Available via `ActivatedRoute.paramMap` |
| `/decks/:id` | Deck Builder | Target for back navigation |
| `/decks` | Deck List | Fallback if deck ID is 0 or missing |

The back button navigates to `/decks/:id` (deck builder), where `:id` is the same deck being simulated. If `deckId` is somehow 0, it falls back to `/decks` (deck list).

### Existing NavbarComponent Template Structure

```html
@if (!isMobile()) {
  <nav class="navbar-sidebar" [class.collapsed]="collapsed()">
    <!-- Desktop sidebar -->
  </nav>
}

@if (isMobile()) {
  <header class="mobile-top-bar" aria-label="Application header">
    <button class="hamburger-btn" (click)="openDrawer()">
      <mat-icon>menu</mat-icon>
    </button>
    <span class="mobile-title">skytrix</span>
  </header>

  <div class="drawer-backdrop" [class.visible]="drawerOpen()" (click)="closeDrawer()"></div>

  <nav class="mobile-drawer" [class.open]="drawerOpen()">
    <!-- Drawer content -->
  </nav>
}
```

**After this story**, the `@if (isMobile())` block becomes:

```html
@if (isMobile()) {
  @if (!shouldHideTopBar()) {
    <header class="mobile-top-bar" aria-label="Application header">
      <button class="hamburger-btn" (click)="openDrawer()">
        <mat-icon>menu</mat-icon>
      </button>
      <span class="mobile-title">skytrix</span>
    </header>
  }

  <div class="drawer-backdrop" [class.visible]="drawerOpen()" (click)="closeDrawer()"></div>

  <nav class="mobile-drawer" [class.open]="drawerOpen()">
    <!-- Drawer content -->
  </nav>
}
```

Only the `<header>` is conditionally hidden — the drawer and backdrop remain in the DOM (though practically inaccessible since no hamburger button is visible).

### Existing Control Bar Template

```html
<div class="control-bar" role="toolbar" aria-label="Session controls">
  <button mat-icon-button [disabled]="!canUndo()" aria-label="Undo" matTooltip="Undo (Ctrl+Z)">
    <mat-icon>undo</mat-icon>
  </button>

  <button mat-icon-button [disabled]="!canRedo()" aria-label="Redo" matTooltip="Redo (Ctrl+Y)">
    <mat-icon>redo</mat-icon>
  </button>

  <div class="separator"></div>

  <button mat-icon-button aria-label="Reset board" matTooltip="Reset">
    <mat-icon>refresh</mat-icon>
  </button>

  @if (isDevMode) {
    <div class="separator"></div>
    <span class="debug-info">U:{{ undoCount() }} R:{{ redoCount() }}</span>
  }
</div>
```

### Existing Board Scaling Logic

```typescript
// board.component.ts — constructor effect
effect(() => {
  this.navbarCollapse.navbarWidth();
  this.navbarCollapse.isMobile();
  untracked(() => this.recalculateScale());
});

// board.component.ts — recalculateScale
private recalculateScale(): void {
  const isMobile = this.navbarCollapse.isMobile();
  const availableWidth = isMobile
    ? window.innerWidth
    : window.innerWidth - this.navbarCollapse.navbarWidth();
  const availableHeight = isMobile
    ? window.innerHeight - NavbarCollapseService.MOBILE_HEADER_HEIGHT
    : window.innerHeight;
  this.scaleFactor.set(Math.min(availableWidth / 1060, availableHeight / 772, 1));
}
```

### Token Values Reference (from simulator-page.component.scss `:host`)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--sim-surface-translucent` | `rgba(17, 24, 39, 0.85)` | Control bar background (existing, unchanged) |
| `--sim-zone-border` | `rgba(0, 212, 255, 0.15)` | Control bar border (existing, unchanged) |
| `--text-primary` | `#f1f5f9` | Back button icon color (existing, unchanged) |
| `--text-secondary` | `#94a3b8` | Disabled button color (existing, unchanged) |
| `--surface-elevated` | inherited from global | Button hover background (existing, unchanged) |

### Previous Story Intelligence (9-8, 9-12)

**Story 9-8 (Toggles Landscape)**:
- `MatTooltip` already used in control bar (import exists)
- `landscape-split` mixin targets `(orientation: landscape) and (min-width: 576px) and (max-width: 767px)` — not used here (using BreakpointObserver instead)

**Story 9-12 (Simulator Token Migration)**:
- All simulator SCSS files migrated to CSS custom properties
- `control-bar.component.scss` now uses `var(--sim-surface-translucent)`, `var(--sim-zone-border)`, `var(--text-primary)`, `var(--surface-elevated)`
- `@use 'sim-tokens' as *` removed from `control-bar.component.scss` (no SCSS variables needed)
- `simulator-page.component.scss` defines `:host` with all token overrides — this is where the simulator's visual identity lives

### Git Intelligence

- **Current branch**: `hand-testing`
- **Recent commits**: `c4bb391a follow up`, `35715a39 9.-2`, `94a9097c 9-1`
- **Uncommitted changes** (per git status): `control-bar.component.scss`, `simulator-page.component.scss`, `card-searcher.*` (stories 9-3 through 9-12 work)
- **Files modified in last 3 commits**: 42 files, 3821 insertions, 304 deletions (Epic 9 bulk work)

### Project Structure Notes

- **Files modified:**
  - `front/src/app/services/navbar-collapse.service.ts` — add `immersiveMode`, `isLandscape`, `shouldHideTopBar`, `setImmersiveMode()`
  - `front/src/app/components/navbar/navbar.component.ts` — expose `shouldHideTopBar` signal
  - `front/src/app/components/navbar/navbar.component.html` — conditional top bar rendering
  - `front/src/app/pages/simulator/simulator-page.component.ts` — set/cleanup immersive mode
  - `front/src/app/pages/simulator/board.component.ts` — update scaling logic
  - `front/src/app/pages/simulator/control-bar.component.ts` — add Router, ActivatedRoute, back button logic
  - `front/src/app/pages/simulator/control-bar.component.html` — add back button at top of control bar
- **No new files** created
- **No new Angular Material modules** — Router, ActivatedRoute, BreakpointObserver all already available
- **No new CSS** in control-bar.component.scss — back button uses existing `.control-bar button` styles and `.separator` styling

### Scope Boundaries

Elements NOT in scope for this story:
- `.sim-page` CSS — no changes needed (100vh is correct for both hidden and visible top bar states)
- `board.component.scss` — grid layout unchanged, only TS scaling logic changes
- `control-bar.component.scss` — existing styles handle the new button (vertical flex layout auto-accommodates)
- `_responsive.scss` — no new mixins needed
- Portrait-only top bar hiding — AC specifically requires landscape only
- Drawer accessibility when top bar hidden — drawer remains in DOM but inaccessible (no hamburger), which is acceptable since the back button provides navigation
- `NavbarCollapseService.MOBILE_HEADER_HEIGHT` constant — unchanged (still 48)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.11 (lines 1598-1617)]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Landscape Navigation (lines 364-379)]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Regression Risk — Hide top bar landscape sim (line 464)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#SimControlBarComponent variants (line 895)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Responsive Navbar (lines 386-399)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Board Scaling Model (lines 152-157)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Collapsible Navbar Signal Flow (lines 241-246)]
- [Source: front/src/app/services/navbar-collapse.service.ts]
- [Source: front/src/app/components/navbar/navbar.component.ts]
- [Source: front/src/app/components/navbar/navbar.component.html]
- [Source: front/src/app/pages/simulator/simulator-page.component.ts]
- [Source: front/src/app/pages/simulator/board.component.ts]
- [Source: front/src/app/pages/simulator/control-bar.component.ts]
- [Source: front/src/app/pages/simulator/control-bar.component.html]
- [Source: front/src/app/pages/simulator/control-bar.component.scss]
- [Source: front/src/app/app.routes.ts — routing configuration]
- [Source: _bmad-output/implementation-artifacts/9-8-toggles-landscape.md — previous story intelligence]
- [Source: _bmad-output/implementation-artifacts/9-12-simulator-token-migration.md — token migration intelligence]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build budget errors (exit code 1 in prod mode) are pre-existing and unrelated to this story — dev mode build passes cleanly

### Completion Notes List

- Task 1: Added `immersiveMode` signal, `isLandscape` via BreakpointObserver, `shouldHideTopBar` computed, and `setImmersiveMode()` method to NavbarCollapseService. All imports already existed.
- Task 2: SimulatorPageComponent now injects NavbarCollapseService and DestroyRef. Sets immersive mode on init, cleans up on destroy via DestroyRef.onDestroy().
- Task 3: NavbarComponent exposes `shouldHideTopBar`. Template wraps `<header>` in `@if (!shouldHideTopBar())` inside the existing `@if (isMobile())` block. Drawer/backdrop remain in DOM.
- Task 4: SimControlBarComponent receives deckId as input signal from parent chain (SimulatorPage → Board → ControlBar). Back button (arrow_back) added at top of control bar with separator. Navigates to `/decks/:id` or `/decks` fallback.
- Task 5: Board scaling effect now tracks `shouldHideTopBar()`. `recalculateScale()` uses full viewport height when top bar is hidden (`topBarVisible = isMobile && !shouldHideTopBar`).
- Task 6: `ng build --configuration=development` passes with 0 compilation errors.

### Change Log

- 2026-02-17: Implemented story 9-11 — immersive mode hides mobile top bar in landscape simulator, back button in control bar, board scaling updated
- 2026-02-17: Code review (Claude Opus 4.6) — 8 findings (1 HIGH, 3 MEDIUM, 4 LOW), all fixed

### File List

- `front/src/app/services/navbar-collapse.service.ts` — Added immersiveMode (private + asReadonly), isLandscape signal, shouldHideTopBar computed, setImmersiveMode() method
- `front/src/app/pages/simulator/simulator-page.component.ts` — Added NavbarCollapseService + DestroyRef injection, immersive mode set/cleanup
- `front/src/app/pages/simulator/simulator-page.component.html` — Bound deckId to SimBoardComponent input
- `front/src/app/components/navbar/navbar.component.ts` — Exposed shouldHideTopBar signal
- `front/src/app/components/navbar/navbar.component.html` — Wrapped header in @if (!shouldHideTopBar()) conditional
- `front/src/app/pages/simulator/control-bar.component.ts` — Added Router, deckId input signal, onBack() method (ActivatedRoute removed — deckId passed from parent)
- `front/src/app/pages/simulator/control-bar.component.html` — Added back button with separator at top of control bar, French labels
- `front/src/app/pages/simulator/board.component.ts` — Added deckId input, shouldHideTopBar tracking in effect, updated recalculateScale for dynamic top bar height
- `front/src/app/pages/simulator/board.component.html` — Bound deckId to SimControlBarComponent input
- `front/src/app/app.component.ts` — Exposed shouldHideTopBar signal (review fix: padding-top removal)
- `front/src/app/app.component.html` — mobile-mode class now conditional on !shouldHideTopBar() (review fix: 48px dead space bug)

### Review Follow-ups

- [ ] [LOW] Investigate prod build budget errors (exit code 1) — pre-existing but undocumented root cause
- [ ] [LOW] Consider adding keyboard shortcut for back navigation (Undo=Ctrl+Z, Redo=Ctrl+Y, Back=?)
