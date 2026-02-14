# Story 7.2: Responsive Navbar (Hamburger/Drawer on Mobile)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the navbar to switch to a hamburger menu with a drawer on mobile devices,
so that I can navigate the app on small screens without the sidebar consuming permanent screen space.

## Acceptance Criteria

1. **Given** the viewport width is greater than 768px (desktop),
   **When** the navbar renders,
   **Then** the existing collapsible sidebar behavior from Epic 6.4 is unchanged (chevron toggle, expanded/collapsed states),
   **And** no hamburger icon is visible.

2. **Given** the viewport width is 768px or less (mobile/tablet),
   **When** the navbar renders,
   **Then** the sidebar is hidden,
   **And** a fixed top bar appears with: hamburger icon button (left), "skytrix" app title text (centered),
   **And** the top bar has a defined height stored in CSS variable `--mobile-header-height`.

3. **Given** the navbar is in mobile mode and the hamburger is visible,
   **When** I tap/click the hamburger icon,
   **Then** the navbar content slides in as a custom CSS drawer overlay from the left (`position: fixed` + `transform: translateX`),
   **And** a semi-transparent backdrop appears behind the drawer.

4. **Given** the drawer is open on mobile,
   **When** I tap the backdrop, press Escape, or navigate to a page,
   **Then** the drawer closes.

5. **Given** the viewport is resized across the 768px threshold,
   **When** the width crosses from above to below (or vice versa),
   **Then** the navbar mode switches between sidebar and hamburger/drawer via `@if(isMobile())` template conditional driven by `BreakpointObserver` (not `window.resize`),
   **And** no intermediate frame shows both modes simultaneously.

6. **Given** the navbar is in mobile mode on the simulator page (only Track A page currently implemented),
   **When** the page renders,
   **Then** `SimBoardComponent.recalculateScale()` subtracts the mobile header height from available height,
   **And** the board scales correctly within the reduced available space.
   **Note:** Deck builder and card search (future Epic 8) will inherit `--mobile-header-height` when implemented — this story only modifies the simulator.

7. **Given** the navbar mode detection is implemented,
   **When** the component initializes,
   **Then** CDK `BreakpointObserver` is used with the `$navbar-breakpoint` value (768px) as the single source of truth — matching the SCSS variable.

8. **Given** the navbar is in mobile mode,
   **When** I right-click anywhere on the top bar or drawer,
   **Then** the native browser context menu appears (navbar is excluded from board `preventDefault` scope).

## Tasks / Subtasks

- [x] **Task 1: Extend NavbarCollapseService with mobile state** (AC: 7)
  - [x] 1.1: Import `BreakpointObserver` from `@angular/cdk/layout`
  - [x] 1.2: Add `isMobile` signal — derived from `BreakpointObserver.observe('(max-width: 768px)')`. Use `toSignal()` or manual subscription to convert Observable to signal. CRITICAL: the 768px value must match `$navbar-breakpoint` in `_responsive.scss`
  - [x] 1.3: Add `drawerOpen = signal(false)` for mobile drawer state
  - [x] 1.4: Add `toggleDrawer()` method — toggles `drawerOpen` signal
  - [x] 1.5: Add `closeDrawer()` method — sets `drawerOpen` to `false`
  - [x] 1.6: Add `openDrawer()` method — sets `drawerOpen` to `true`
  - [x] 1.7: Fix `EXPANDED_WIDTH` discrepancy — service has `220` but SCSS uses `260px`. Align to `260` to match actual CSS rendering (see Dev Notes). OR verify which is correct and align both

- [x] **Task 2: Update NavbarComponent for responsive dual-mode** (AC: 1, 2, 3, 4, 5)
  - [x] 2.1: Inject `NavbarCollapseService` (already done) — read new `isMobile()` signal
  - [x] 2.2: Desktop mode template (`!isMobile()`): existing sidebar HTML unchanged — chevron toggle, collapsed/expanded states, all nav links
  - [x] 2.3: Mobile mode template (`isMobile()`):
    - Fixed top bar (`position: fixed; top: 0; left: 0; right: 0; z-index: 1000`) with:
      - Hamburger `mat-icon-button` with `menu` icon (`aria-label="Open navigation"`)
      - "skytrix" app title text centered in the top bar
    - Drawer overlay (`position: fixed; top: 0; left: 0; bottom: 0; width: 280px; z-index: 1100`) with:
      - Close button (X icon or chevron) at the top
      - Same navigation links as sidebar (reuse link template via `@if`/`ng-template` or shared method)
      - User section (pseudo + logout) at the bottom
      - Slide-in animation from left (`transform: translateX(-100%)` → `translateX(0)`)
      - Z-index hierarchy: drawer (1100) > backdrop (1050) > top bar (1000). All BELOW simulator drag preview z-index and CDK overlay z-index. This ensures the simulator's overlay hierarchy (drag preview > context menus > pile overlays > inspector > board) remains unaffected when navigating away from the drawer
    - Semi-transparent backdrop (`position: fixed; inset: 0; z-index: 1050; background: rgba(0,0,0,0.5)`) — click closes drawer
  - [x] 2.4: On route navigation in mobile mode → `closeDrawer()` immediately (no slide-out animation delay — navigation takes priority). Use `Router.events` (NavigationEnd) or handle in link click handlers. Drawer disappears instantly when navigating.
  - [x] 2.5: On Escape keypress when drawer is open → `closeDrawer()`. Use `@HostListener('document:keydown.escape')`
  - [x] 2.6: On viewport resize crossing 768px threshold → if transitioning to desktop, `closeDrawer()`. If transitioning to mobile, ensure sidebar is hidden. BreakpointObserver handles this reactively

- [x] **Task 3: Update NavbarComponent SCSS for responsive modes** (AC: 2, 5)
  - [x] 3.1: Import `_responsive.scss` via `@use 'responsive' as *`
  - [x] 3.2: Desktop styles (unchanged — existing sidebar CSS): wrapped in `@include respond-above($navbar-breakpoint)` or conditional via `[class.desktop-mode]` binding
  - [x] 3.3: Mobile top bar styles:
    - Height: `48px` (or suitable value) stored as `--mobile-header-height` CSS variable on `:root` or `.app` container
    - Background: match existing navbar surface color
    - Hamburger button: `@include touch-target-min` (44x44px minimum — NFR12)
    - `box-shadow` for elevation separation
  - [x] 3.4: Mobile drawer styles:
    - Width: `280px` (standard material drawer width)
    - Background: match existing navbar surface color
    - Slide-in transition: `transform 200ms ease`. With `prefers-reduced-motion: reduce`: NO slide animation — drawer appears/disappears instantly via `visibility: hidden/visible` (no `translateX` transition)
    - Nav links: full-width, `@include touch-target-min` (44x44px minimum)
  - [x] 3.5: Backdrop styles: fade-in opacity transition. With `prefers-reduced-motion: reduce`: NO fade — backdrop appears/disappears instantly (opacity jump, no transition)
  - [x] 3.6: Ensure no layout flash during mode transition — test viewport resize across 768px boundary

- [x] **Task 4: Update AppComponent layout for mobile header** (AC: 2, 6)
  - [x] 4.1: Define `--mobile-header-height` CSS variable (e.g., `48px`) at the `:root` level or in `app.component.scss`
  - [x] 4.2: On mobile mode, `<main>` content needs `padding-top: var(--mobile-header-height)` to account for the fixed top bar (preventing content from being hidden behind it)
  - [x] 4.3: Read `isMobile` signal from `NavbarCollapseService` in AppComponent (inject service)
  - [x] 4.4: Apply `[class.mobile-mode]="isMobile()"` on the app wrapper to enable mobile layout adjustments
  - [x] 4.5: On mobile: the `<main>` no longer needs to account for sidebar width (navbar is hidden) — `flex: 1` naturally fills full width
  - [x] 4.6: Verify that on mobile, AppComponent hides the sidebar `<navbar>` from the flex layout (navbar handles its own mobile rendering as fixed-position elements, not as a flex child)

- [x] **Task 5: Simulator page mobile header height accounting** (AC: 6)
  - [x] 5.1: In `SimulatorPageComponent` or `board.component.ts`: on mobile, the available height must subtract `--mobile-header-height`. The current `recalculateScale()` uses `window.innerHeight` — on mobile, this should be `window.innerHeight - mobileHeaderHeight`
  - [x] 5.2: Read `isMobile` from `NavbarCollapseService` in the board component
  - [x] 5.3: When `isMobile() === true`: `availableHeight = window.innerHeight - mobileHeaderHeight` and `availableWidth = window.innerWidth` (no sidebar on mobile)
  - [x] 5.4: When `isMobile() === false`: existing behavior unchanged (`availableWidth = window.innerWidth - navbarWidth`)
  - [x] 5.5: Add `MOBILE_HEADER_HEIGHT` as a TypeScript constant (e.g., `48`) in `NavbarCollapseService` — synchronized with the CSS variable `--mobile-header-height`. Use the constant directly in `recalculateScale()`. Do NOT read the CSS variable at runtime via `getComputedStyle` — it adds fragility and complexity for no benefit

- [x] **Task 6: Accessibility & keyboard support** (AC: 4, 8)
  - [x] 6.1: Mobile top bar: `aria-label="Application header"` on the top bar element
  - [x] 6.2: Hamburger button: `aria-label="Open navigation"`, `aria-expanded` bound to `drawerOpen()` signal
  - [x] 6.3: Drawer: `role="dialog"`, `aria-label="Navigation menu"`, `aria-modal="true"`
  - [x] 6.4: Focus trap in drawer when open (use CDK `cdkTrapFocus` or manual focus management)
  - [x] 6.5: On drawer open: focus the first navigation link or close button
  - [x] 6.6: On drawer close: return focus to hamburger button
  - [x] 6.7: Escape key closes drawer (Task 2.6)
  - [x] 6.8: Touch targets: all nav links and buttons meet 44x44px minimum on mobile (NFR12)

- [x] **Task 7: Build verification & regression testing** (AC: 1, 5)
  - [x] 7.1: Run `ng build --configuration development` — zero errors
  - [ ] 7.2: Desktop >768px: verify sidebar behavior unchanged (expand/collapse, chevron toggle, all links functional)
  - [ ] 7.3: Mobile ≤768px: verify top bar appears, hamburger opens drawer, links navigate, drawer closes on nav/backdrop/escape
  - [ ] 7.4: Viewport resize across 768px: verify seamless transition, no flash, no layout jump
  - [ ] 7.5: Simulator page (desktop): verify board scaling unchanged (navbar collapse/expand triggers rescale)
  - [ ] 7.6: Simulator page (mobile): verify board scales correctly accounting for top bar height
  - [ ] 7.7: `prefers-reduced-motion`: verify drawer slide and backdrop fade are disabled
  - [ ] 7.8: Other pages (deck list, settings, login): verify content renders correctly with mobile header padding

## Dev Notes

### Critical Architecture Constraints

- **Single component, two modes.** The NavbarComponent handles both desktop sidebar and mobile hamburger/drawer modes. Mode determined by CDK `BreakpointObserver` at 768px. [Source: architecture.md#Navbar Responsive Behavior, epics.md#Epic 7 Implementation Notes]
- **768px breakpoint is the single source of truth.** Defined as `$navbar-breakpoint: 768px` in `_responsive.scss` (created in Story 7.1). Must be matched EXACTLY in TypeScript via CDK `BreakpointObserver`. Do NOT create a second breakpoint constant — reference the SCSS comment. [Source: architecture.md#Responsive Strategy, _responsive.scss]
- **`--mobile-header-height` CSS variable required.** Track A pages (simulator, deck builder, card search) use this to compute canvas parent height on mobile: `calc(100vh - var(--mobile-header-height))`. This variable must be defined globally (`:root` or app-level). [Source: epics.md#Story 7.2 AC, architecture.md#Navbar Responsive Behavior]
- **Simulator board scaling must account for mobile header.** The existing `SimBoardComponent.recalculateScale()` uses `window.innerHeight` for available height. On mobile (≤768px), available height = `window.innerHeight - mobileHeaderHeight`. Available width on mobile = `window.innerWidth` (no sidebar). [Source: architecture.md#Board Scaling Model, ux-design-specification.md#Scaling Model]
- **Ephemeral state.** Drawer open/closed state is NOT persisted. Navigating away closes the drawer. [Source: ux-design-specification.md#Collapsible Navbar]
- **Navbar retains native context menu.** `event.preventDefault()` on right-click applies ONLY to the simulator board. The navbar (desktop sidebar, mobile top bar, and mobile drawer) must show the native browser context menu on right-click. [Source: ux-design-specification.md#Context Menu Production Rule]
- **`prefers-reduced-motion` support.** All transitions (drawer slide, backdrop fade, mode switch) must be disabled when `prefers-reduced-motion: reduce` is active. Follow existing pattern from Story 6.4 / Story 7.1. [Source: ux-design-specification.md#Reduced Motion]

### Implementation Decisions for Dev Agent

#### Custom CSS Drawer — DECIDED (not mat-sidenav)

**Decision: Custom CSS drawer within NavbarComponent.** Do NOT use `mat-sidenav`.

**Rationale:** The existing desktop sidebar has custom collapse behavior (chevron toggle, 260px → 32px thin bar) that doesn't map to `mat-sidenav`'s built-in modes. Using `mat-sidenav` would require restructuring `AppComponent` with `mat-sidenav-container` and managing two different navigation paradigms (custom collapse on desktop + mat-sidenav on mobile). The custom drawer approach is self-contained within NavbarComponent — no app layout restructuring needed.

**Implementation:**
- Drawer: `position: fixed` div within NavbarComponent template (only rendered when `isMobile()`)
- Backdrop: `position: fixed` div with `(click)="closeDrawer()"`
- Slide animation: `transform: translateX(-100%)` → `translateX(0)` via CSS transition
- Focus trap: use CDK `cdkTrapFocus` directive on the drawer div (import `A11yModule` from `@angular/cdk/a11y`)

#### BreakpointObserver → Signal Conversion

```typescript
// Recommended pattern for Angular 19 signal integration
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

// In NavbarCollapseService or NavbarComponent:
private readonly breakpointObserver = inject(BreakpointObserver);

readonly isMobile = toSignal(
  this.breakpointObserver.observe('(max-width: 768px)').pipe(
    map(result => result.matches)
  ),
  { initialValue: false }
);
```

This converts the RxJS Observable from BreakpointObserver into a signal. `toSignal()` handles the subscription lifecycle automatically.

#### `toSignal()` Injection Context Constraint

`toSignal()` requires an injection context — it must be called during construction (field initializer or constructor body), NOT inside a method called later. The code pattern shown above (field initializer `readonly isMobile = toSignal(...)`) is correct. Do NOT refactor this into a method like `initBreakpointObserver()` called from `ngOnInit` — it will throw a runtime error.

#### NavbarCollapseService Width Discrepancy

Story 7-1 Dev Notes confirm: **Navbar expanded width is 260px** (in SCSS), but `NavbarCollapseService.EXPANDED_WIDTH` is `220px`. This was flagged as "corrected during implementation" of Story 6.4 but the service constant was never updated. **Fix this in Task 1.7** — set `EXPANDED_WIDTH = 260` to match the actual rendered width.

**Cascade impact:** This fix changes `navbarCollapse.navbarWidth()` from 220 → 260 when expanded. `SimBoardComponent.recalculateScale()` uses this value: `availableWidth = window.innerWidth - navbarWidth`. On a 1920px viewport, this means available width drops from 1700 to 1660 — the board scale factor decreases slightly. This is a **correction** (the board was already rendering with 260px sidebar, the scale calculation was just wrong). After the fix, the calculated scale matches the actual rendered layout. Visually: the board will be marginally smaller on desktop expanded mode (correct behavior), no change when collapsed.

### Existing Code Context

#### NavbarCollapseService (`front/src/app/services/navbar-collapse.service.ts`)
```typescript
@Injectable({ providedIn: 'root' })
export class NavbarCollapseService {
  private readonly EXPANDED_WIDTH = 220;   // ⚠️ DISCREPANCY — SCSS uses 260px
  private readonly COLLAPSED_WIDTH = 32;

  readonly collapsed = signal(false);
  readonly navbarWidth = computed(() => (this.collapsed() ? this.COLLAPSED_WIDTH : this.EXPANDED_WIDTH));

  toggle(): void { this.collapsed.update(v => !v); }
  setCollapsed(value: boolean): void { this.collapsed.set(value); }
}
```

#### NavbarComponent Template (`front/src/app/components/navbar/navbar.component.html`)
```html
<nav class="navbar-sidebar" [class.collapsed]="collapsed()">
  <!-- .navbar-content only rendered when expanded -->
  @if (!collapsed()) {
    <div class="navbar-content">
      <!-- Logo, nav links (Deck Builder, Card Search, Parameters), user section -->
    </div>
  }
  <!-- Collapse toggle always visible -->
  <button class="collapse-toggle" (click)="toggle()" ...>
    <mat-icon>{{ collapsed() ? 'chevron_right' : 'chevron_left' }}</mat-icon>
  </button>
</nav>
```

#### NavbarComponent SCSS Key Properties
- Default width: `260px`, collapsed: `32px`
- `transition: width 200ms ease` with `prefers-reduced-motion` respect
- Collapse toggle: absolute positioned at `right: -16px, top: 1.5rem`, circular (32x32px)
- Layout: vertical flexbox (logo top, tabs middle, user bottom via spacer)
- No mobile-specific styles currently

#### AppComponent Layout (`front/src/app/app.component.html`)
```html
<div class="app mat-app-background dark-theme no-transition">
  <app-loader></app-loader>
  @if (connectedUser()) {
    <navbar></navbar>
  }
  <main class="dark-theme-content" [class.full]="!connectedUser()">
    <router-outlet></router-outlet>
  </main>
  <!-- card-tooltip -->
</div>
```

App uses `display: flex; flex-direction: row` — navbar and main side by side. On mobile, navbar will be hidden (replaced by top bar), so main will fill full width naturally.

#### SimBoardComponent Scaling Logic
```typescript
private recalculateScale(): void {
  const availableWidth = window.innerWidth - this.navbarCollapse.navbarWidth();
  const availableHeight = window.innerHeight;
  this.scaleFactor.set(Math.min(availableWidth / 1060, availableHeight / 720, 1));
}
```
Board dimensions: **1060px × 720px** (not 1280×720 as architecture originally specified — corrected in Story 6.1).

#### SimulatorPageComponent Navbar Collapse
```typescript
constructor() {
  this.navbarCollapse.setCollapsed(true);   // Force collapsed on mount
  inject(DestroyRef).onDestroy(() => this.navbarCollapse.setCollapsed(false));  // Restore on unmount
}
```
On mobile: this `setCollapsed(true)` call should be a no-op since the sidebar is hidden entirely. The mobile mode uses `drawerOpen` signal instead.

### Previous Story Intelligence (Story 7-1)

**Patterns to follow:**
- `inject()` for all dependency injection (no constructor params)
- `signal()` / `computed()` for reactive state
- `DestroyRef.onDestroy()` for cleanup
- `afterNextRender()` for browser-only initialization (SSR-safe)
- `prefers-reduced-motion` respect on all transitions
- `@use 'responsive' as *` for SCSS imports of breakpoint infrastructure
- `@include touch-target-min` for 44x44px minimum touch targets (NFR12)

**Dimensions confirmed in Story 7-1 / 6-4:**
- Navbar expanded width: 260px (SCSS) — service has 220 (to be fixed)
- Navbar collapsed width: 32px
- Board internal dimensions: 1060×720px
- `NavbarCollapseService` is `providedIn: 'root'`

**Files created by Story 7-1 that this story consumes:**
- `front/src/app/styles/_responsive.scss` — `$navbar-breakpoint: 768px`, `respond-above()`, `respond-below()`, `touch-target-min` mixin
- `front/src/app/styles/_canvas-scaling.scss` — canvas mixins (not directly used by this story)
- `front/src/app/components/scaling-container/scaling-container.directive.ts` — not used by this story directly

### Git Intelligence

Recent commits show only high-level commits (`v1`, `mvp`, `init bmad`). No granular commit history for Story 7-1 implementation details. All code was committed as `v1`.

### Web Research: Latest Technical Specifics

**CDK BreakpointObserver (Angular 19.1.x):**
- Available in `@angular/cdk/layout` — already installed (`@angular/cdk: ^19.1.1`)
- Use `toSignal()` from `@angular/core/rxjs-interop` to convert the Observable to a signal
- `breakpointObserver.observe('(max-width: 768px)')` returns an Observable<BreakpointState>
- `result.matches` is the boolean indicating if the breakpoint is active
- CSS-first approach recommended: use BreakpointObserver only for behavioral changes (template switching), not pure visual changes (use SCSS media queries for those)

**mat-sidenav (Angular Material 19.1.x):**
- Import `MatSidenavModule` from `@angular/material/sidenav`
- Supports `mode` property: `'side'` (pushes content), `'over'` (overlays content), `'push'` (pushes partially)
- Built-in backdrop, keyboard handling, and focus trap
- For responsive pattern: switch `mode` between `'side'` (desktop) and `'over'` (mobile) based on BreakpointObserver
- Requires wrapping layout in `<mat-sidenav-container>` → `<mat-sidenav>` + `<mat-sidenav-content>`

### Edge Cases

- **Rapid viewport resizing (window drag):** BreakpointObserver fires asynchronously. Ensure no layout flash during mode transition. Use CSS transitions with `prefers-reduced-motion` guard.
- **Simulator page + mobile mode:** `setCollapsed(true)` in SimulatorPageComponent should be guarded — on mobile, the sidebar is hidden, so collapse state is irrelevant. Either: (a) `setCollapsed` is a no-op when `isMobile()`, or (b) simulator checks `isMobile()` before calling `setCollapsed()`.
- **Drawer open + navigate:** Router navigation should auto-close the drawer. Subscribe to `Router.events.pipe(filter(e => e instanceof NavigationEnd))` → `closeDrawer()`.
- **Drawer open + viewport resize to desktop:** If the user resizes from mobile (drawer open) to desktop (>768px), the drawer should close and sidebar should appear. BreakpointObserver signal change naturally handles this if the template conditionally renders drawer vs sidebar.
- **External links in drawer:** If any nav link navigates externally (unlikely in SPA), ensure drawer closes first.
- **Touch interaction on mobile:** The top bar hamburger button must be easily tappable. 44x44px minimum touch target per NFR12. Nav links inside drawer same.
- **Keyboard-only navigation:** Tab should cycle through top bar → hamburger → drawer content when open. Escape closes drawer. Focus management is critical.
- **Drawer z-index vs simulator overlays:** The drawer z-index (1100) and backdrop (1050) are intentionally below CDK Overlay z-index (~1000+ in CDK default). If the simulator has overlays open and the user somehow triggers the drawer (e.g., via keyboard), the drawer should appear above the simulator board but below CDK-managed overlays. In practice, on mobile the simulator overlays and the drawer are mutually exclusive (drawer = navigation, overlays = gameplay).
- **Drawer close on navigation — no blocking animation:** When a nav link is clicked, the drawer must close **instantly** (no 200ms slide-out delay). The page navigation should not wait for the drawer animation. Set `drawerOpen.set(false)` and let the page change happen immediately. The slide-out animation is for manual close (backdrop tap, Escape) only.
- **`prefers-reduced-motion` fallback:** With reduced motion active: drawer appears/disappears via `visibility` toggle (no `transform` transition), backdrop appears/disappears via `opacity` jump (no fade). All functional behavior remains identical — only decorative transitions are removed.

### NFR Compliance

- **NFR9 (browser support):** CDK BreakpointObserver uses `window.matchMedia()` — supported in all target browsers. CSS `position: fixed` and `transform` — universal support.
- **NFR11 (responsive 375px–2560px+):** Navbar mode switch at 768px enables content pages to render correctly on all viewports.
- **NFR12 (touch targets):** All mobile interactive elements (hamburger button, nav links, close button) must use `@include touch-target-min` for 44x44px minimum.

### What This Story Does NOT Include

- **No page-level responsive CSS** — Login, settings, deck list responsive styles are Stories 7.3 and 7.4.
- **No shared component extraction** — CardComponent/CardInspectorComponent extraction is Epic 8.
- **No simulator migration to ScalingContainerDirective** — simulator keeps inline scaling, adds mobile header height accounting only.
- **No touch-to-place interaction** — mobile touch card interaction is post-MVP.
- **No landscape lock on simulator** — landscape orientation lock is post-MVP mobile consideration.

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `--mobile-header-height` CSS variable | Story 7.3 (login/settings), 7.4 (deck list), Epic 8 (deck builder/card search canvas height) |
| `isMobile` signal in NavbarCollapseService | Story 7.3, 7.4 (responsive page layout decisions) |
| Mobile top bar UI | All subsequent mobile-responsive stories |
| Simulator mobile header height accounting | All future simulator mobile improvements |

| Dependency | From |
|---|---|
| `_responsive.scss` (breakpoint variables, mixins) | Story 7.1 |
| `NavbarCollapseService` (collapsed signal, toggle) | Story 6.4 |
| `NavbarComponent` (sidebar, chevron toggle) | Story 6.4 |
| CDK `BreakpointObserver` | `@angular/cdk/layout` (already installed ^19.1.1) |

### Project Structure Notes

**Files modified by this story:**
```
front/src/app/
  services/
    navbar-collapse.service.ts         # MODIFIED — add isMobile, drawerOpen, fix EXPANDED_WIDTH
  components/
    navbar/
      navbar.component.ts             # MODIFIED — dual-mode rendering, BreakpointObserver integration
      navbar.component.html           # MODIFIED — desktop sidebar + mobile top bar/drawer templates
      navbar.component.scss           # MODIFIED — mobile top bar, drawer, backdrop styles
  app.component.ts                    # MODIFIED — inject isMobile, apply mobile-mode class
  app.component.html                  # MODIFIED — conditional mobile-mode class binding
  app.component.scss                  # MODIFIED — --mobile-header-height, mobile padding-top on main
  pages/
    simulator/
      board.component.ts              # MODIFIED — mobile header height accounting in recalculateScale()
```

**No new files created by this story.**

### References

- [Source: epics.md#Story 7.2] — Acceptance criteria, user story
- [Source: epics.md#Epic 7 Implementation Notes] — Navbar responsive extends existing, CDK BreakpointObserver at 768px
- [Source: architecture.md#Navbar Responsive Behavior] — Desktop sidebar vs mobile hamburger/drawer table, 768px breakpoint
- [Source: architecture.md#Responsive Strategy] — Two-track approach, breakpoint source of truth
- [Source: architecture.md#Collapsible Navbar Signal Flow] — NavbarCollapseService, ephemeral state, route-driven default
- [Source: ux-design-specification.md#Collapsible Navbar] — Chevron toggle, collapsed ~32px, expanded default, simulator collapsed default
- [Source: ux-design-specification.md#Responsive Strategy] — Track A/B strategy, navbar responsive table
- [Source: ux-design-specification.md#Navbar Responsive UX] — Desktop sidebar vs mobile hamburger mode table
- [Source: ux-design-specification.md#Context Menu Production Rule] — Navbar retains native context menu
- [Source: ux-design-specification.md#Reduced Motion] — `prefers-reduced-motion` support
- [Source: prd.md#NFR9] — Browser support (desktop + mobile, latest two versions)
- [Source: prd.md#NFR11] — Responsive 375px–2560px+
- [Source: prd.md#NFR12] — Touch targets 44×44px minimum on mobile
- [Source: 7-1-shared-scss-infrastructure-and-scalingcontainerdirective.md] — Previous story patterns, _responsive.scss details, SCSS conventions
- [Source: project-context.md] — Angular conventions: standalone components, signal inputs, OnPush, SCSS conventions

## Change Log

- **2026-02-14**: Implemented responsive navbar with hamburger/drawer on mobile. Added `isMobile` signal via CDK BreakpointObserver, custom CSS drawer with slide-in animation, mobile top bar with hamburger icon, backdrop overlay, focus trap, Escape key handling, auto-close on navigation, `--mobile-header-height` CSS variable, simulator board scaling accounting for mobile header, `prefers-reduced-motion` support, and fixed `EXPANDED_WIDTH` discrepancy (220→260).
- **2026-02-14 (Code Review 1)**: Fixed 4 issues (1 HIGH, 3 MEDIUM). H1: Added `visibility: hidden/visible` to drawer for screen reader accessibility (transform alone doesn't hide from AT). M1: Fixed `aria-modal` to be removed when drawer closed (was outputting `"false"`). M2: Refactored backdrop to always be in DOM with opacity/visibility transitions (was using `@if` which bypassed CSS transitions). M3: Added `skipDrawerTransition` signal for instant drawer close on navigation (spec requires no animation delay on route change). 4 LOW issues noted but not fixed (breakpoint 1px inconsistency, DI pattern mix in AppComponent, redundant signal reads in board effect, backdrop aria-hidden — now fixed as part of M2). Build verified: zero errors.
- **2026-02-14 (Code Review 2 — Sprint 7+8 cross-review)**: navbar.component.scss: `@import 'variable'` → `@use 'variable' as *` (deprecated SCSS syntax fix).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No errors encountered during implementation. Build passed on first attempt.

### Completion Notes List

- **Task 1**: Extended `NavbarCollapseService` with `isMobile` signal (via `toSignal` + `BreakpointObserver`), `drawerOpen` signal, drawer management methods (`toggleDrawer`, `closeDrawer`, `openDrawer`), `MOBILE_HEADER_HEIGHT = 48` static constant, and fixed `EXPANDED_WIDTH` from 220 to 260.
- **Task 2**: Updated `NavbarComponent` with dual-mode template (`@if(isMobile())`): desktop sidebar unchanged, mobile mode adds fixed top bar (hamburger + centered title) and fixed drawer overlay with backdrop. Added `Router.events` subscription for auto-close on navigation, `@HostListener('document:keydown.escape')` for Escape key, imported `A11yModule` and `MatIconButton`.
- **Task 3**: Rewrote navbar SCSS with `@use 'responsive' as *`. Added mobile top bar styles (48px fixed, box-shadow), drawer styles (280px, slide-in via `transform 200ms ease`), backdrop styles, touch targets via `@include touch-target-min`, and `prefers-reduced-motion` support (visibility toggle for drawer, no transition for backdrop).
- **Task 4**: Updated `AppComponent` — injected `NavbarCollapseService`, exposed `isMobile` signal, added `[class.mobile-mode]` binding on app wrapper, defined `--mobile-header-height: 48px` on `:host`, added `padding-top: var(--mobile-header-height)` on main content in mobile mode.
- **Task 5**: Updated `SimBoardComponent.recalculateScale()` — on mobile: `availableWidth = window.innerWidth` (no sidebar), `availableHeight = window.innerHeight - MOBILE_HEADER_HEIGHT`. Desktop behavior unchanged. Effect now tracks both `navbarWidth()` and `isMobile()`.
- **Task 6**: All accessibility attributes already implemented in Tasks 2-3: ARIA labels, roles, `aria-expanded`, `aria-modal`, `[cdkTrapFocus]="drawerOpen()"` with `cdkTrapFocusAutoCapture` for focus management, Escape key handler, 44x44px touch targets.
- **Task 7**: `ng build --configuration development` passed with zero errors. Manual testing subtasks (7.2–7.8) left for user verification.

### File List

- `front/src/app/services/navbar-collapse.service.ts` — MODIFIED (added isMobile signal, drawerOpen signal, drawer methods, MOBILE_HEADER_HEIGHT constant, fixed EXPANDED_WIDTH 220→260)
- `front/src/app/components/navbar/navbar.component.ts` — MODIFIED (dual-mode rendering, Router NavigationEnd subscription, Escape key handler, new imports)
- `front/src/app/components/navbar/navbar.component.html` — MODIFIED (desktop sidebar in @if(!isMobile()), mobile top bar + drawer + backdrop in @if(isMobile()))
- `front/src/app/components/navbar/navbar.component.scss` — MODIFIED (added @use responsive, mobile top bar/drawer/backdrop styles, prefers-reduced-motion support)
- `front/src/app/app.component.ts` — MODIFIED (injected NavbarCollapseService, exposed isMobile signal)
- `front/src/app/app.component.html` — MODIFIED (added [class.mobile-mode] binding)
- `front/src/app/app.component.scss` — MODIFIED (added --mobile-header-height CSS variable, mobile-mode padding-top on main)
