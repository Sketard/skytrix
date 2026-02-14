# Story 7.1: Shared SCSS Infrastructure & ScalingContainerDirective

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want shared SCSS breakpoint variables, responsive mixins, canvas scaling mixins, and a reusable ScalingContainerDirective,
so that all pages can implement consistent responsive behavior and canvas scaling without duplicating code.

## Acceptance Criteria

1. **Given** the shared SCSS infrastructure is needed,
   **When** `src/app/styles/_responsive.scss` is created,
   **Then** it defines breakpoint variables: `$navbar-breakpoint: 768px`, `$bp-mobile: 576px`, `$bp-tablet: 768px`, `$bp-desktop-sm: 1024px`,
   **And** it provides mobile-first responsive mixins (e.g., `@mixin respond-above($bp)` wrapping `@media (min-width: $bp)`),
   **And** it provides shared responsive utilities (e.g., `.touch-target-min` ensuring 44×44px minimum).

2. **Given** the canvas scaling infrastructure is needed,
   **When** `src/app/styles/_canvas-scaling.scss` is created,
   **Then** it provides mixins for Track A canvas parent setup (explicit height, overflow hidden, centering),
   **And** it provides host styles for scaled containers (transform-origin, letterboxing background).

3. **Given** the ScalingContainerDirective is created in `src/app/components/scaling-container/`,
   **When** applied to a host element via `[appScalingContainer]`,
   **Then** it accepts `aspectRatio` input (default: `16/9`) and `referenceWidth` input (default: `1920`),
   **And** it observes the parent element dimensions via `ResizeObserver`,
   **And** it computes `scale = min(parentWidth / referenceWidth, parentHeight / (referenceWidth / aspectRatio))`,
   **And** it applies `transform: scale(scale)` and `transform-origin: top center` on the host element,
   **And** it emits the computed scale factor via a `scale` output signal (for debug/UI use).

4. **Given** the directive's parent container has `height: auto` (no explicit height),
   **When** the ResizeObserver fires,
   **Then** the directive still functions but the scale may not respond correctly to viewport changes — this is a documented constraint (parent MUST have explicit height).

5. **Given** the directive is applied and the parent resizes (viewport change, navbar toggle),
   **When** the ResizeObserver detects the dimension change,
   **Then** the scale factor is recomputed and the transform updates reactively.

6. **Given** all new files are created,
   **When** the build runs,
   **Then** the existing application compiles and functions identically — no existing component imports these files yet.

## Tasks / Subtasks

- [x] **Task 1: Create `_responsive.scss` shared SCSS file** (AC: 1)
  - [x] 1.1: Create `front/src/app/styles/_responsive.scss`
  - [x] 1.2: Define breakpoint variables: `$navbar-breakpoint: 768px`, `$bp-mobile: 576px`, `$bp-tablet: 768px`, `$bp-desktop-sm: 1024px`
  - [x] 1.3: Create `@mixin respond-above($bp)` — wraps `@media (min-width: $bp) { @content; }`
  - [x] 1.4: Create `@mixin respond-below($bp)` — wraps `@media (max-width: ($bp - 1px)) { @content; }` (convenience for mobile-first overrides)
  - [x] 1.5: Create `.touch-target-min` utility class — `min-width: 44px; min-height: 44px;` (for NFR12 compliance)
  - [x] 1.6: Add a comment header documenting the two-track responsive strategy (Track A = canvas scaling, Track B = responsive CSS)

- [x] **Task 2: Create `_canvas-scaling.scss` shared SCSS file** (AC: 2)
  - [x] 2.1: Create `front/src/app/styles/_canvas-scaling.scss`
  - [x] 2.2: Create `@mixin canvas-parent` — sets `overflow: hidden`, `position: relative`, `display: flex`, `justify-content: center`, `align-items: flex-start`. Documents the **explicit height** requirement via comment
  - [x] 2.3: Create `@mixin canvas-host` — sets `transform-origin: top center`, `width` and `height` to reference dimensions (passed as mixin arguments), `position: relative`
  - [x] 2.4: Create `@mixin canvas-letterbox` — sets background color for letterboxing area (uses the app's existing background)

- [x] **Task 3: Create ScalingContainerDirective** (AC: 3, 4, 5)
  - [x] 3.1: Create directory `front/src/app/components/scaling-container/`
  - [x] 3.2: Create `scaling-container.directive.ts` — standalone directive, selector `[appScalingContainer]`
  - [x] 3.3: Signal-based inputs: `aspectRatio = input<number>(16 / 9)`, `referenceWidth = input<number>(1920)`
  - [x] 3.4: Output: `scaleChange = output<number>()` — emits computed scale factor
  - [x] 3.5: Inject `ElementRef` to access host element, then `el.nativeElement.parentElement` for parent measurement
  - [x] 3.6: Create ResizeObserver in `afterNextRender()` (SSR-safe) — observes `parentElement`
  - [x] 3.7: On resize callback: compute `refHeight = referenceWidth / aspectRatio`, then `scale = Math.min(parentWidth / referenceWidth, parentHeight / refHeight)`. Cap at 1 (no upscaling beyond native resolution)
  - [x] 3.8: Apply `transform: scale(${scale})` and `transform-origin: top center` on host element via `Renderer2.setStyle()`
  - [x] 3.9: Set host element width/height to reference dimensions (`referenceWidth × refHeight` px) so the browser knows the unscaled size
  - [x] 3.10: Emit scale via `scaleChange.emit(scale)`
  - [x] 3.11: Use `DestroyRef.onDestroy()` to disconnect the ResizeObserver on directive destruction
  - [x] 3.12: Handle edge case: if `parentElement` is null (unlikely, but defensive), log warning and skip

- [x] **Task 4: Build verification & SCSS accessibility** (AC: 6)
  - [x] 4.1: Verify `angular.json` has `src/app/styles` in `stylePreprocessorOptions.includePaths` — if missing, add it so `@use 'responsive'` works from any component
  - [x] 4.2: Run `ng build --configuration development` — zero errors
  - [x] 4.3: Verify no existing component is affected (no imports of new files yet)
  - [x] 4.4: Verify `_responsive.scss` and `_canvas-scaling.scss` are accessible via `@use` from any component SCSS file

## Dev Notes

### Critical Architecture Constraints

- **ScalingContainerDirective is NEW code — the simulator is NOT migrated to use it in this epic.** The existing BoardComponent retains its inline scaling logic. Migration happens in Epic 8. Zero simulator regression risk. [Source: epics.md#Epic 7 Implementation Notes, architecture.md#ScalingContainerDirective Migration]
- **The directive measures the PARENT container, not the viewport.** Navbar awareness comes naturally from the DOM layout — when the navbar toggles, the parent resizes, ResizeObserver fires, scale updates. No direct dependency on NavbarCollapseService. [Source: architecture.md#ScalingContainerDirective]
- **Parent container MUST have explicit height.** `height: auto` will not trigger ResizeObserver on viewport changes. All Track A page parents must set height (e.g., `100vh`, `calc(100vh - headerHeight)`). This is a documented constraint, not a bug. [Source: architecture.md#ScalingContainerDirective, ux-design-specification.md#Scaling Model]
- **`referenceWidth` is per-page, not global.** Simulator uses 1920 (architecture spec), deck builder and card search will have different values. The current board uses 1060×720 internally — the directive's referenceWidth is independent of the existing board dimensions. [Source: architecture.md#Responsive Strategy]
- **No upscaling beyond native resolution.** Scale capped at 1.0 — `Math.min(..., 1)`. [Source: epics.md#Story 6.1 AC]
- **Zero new dependencies.** ResizeObserver is a native browser API (supported in all target browsers per NFR9). No polyfill needed. [Source: prd.md#Compatibility]
- **`referenceWidth` default (1920) ≠ current board (1060).** The directive's default of 1920 is per architecture.md spec. The simulator board currently uses 1060×720 internally (set in Story 6.1). When Epic 8 migrates the simulator to use this directive, the consumer must pass `[referenceWidth]="1060"`. Add a code comment in the directive clarifying this. [Source: Party Mode review — Winston]
- **Inputs are read reactively in resize callback, but host dimensions are set once at init.** If `referenceWidth` or `aspectRatio` inputs change dynamically after init, the scale computation will use the new values (signal inputs are reactive), but the host element's width/height in px won't update. This is acceptable for MVP — these inputs are static per page. Document as constraint. [Source: Party Mode review — Amelia]

### Implementation Details

#### _responsive.scss

```scss
// front/src/app/styles/_responsive.scss
// =============================================
// Responsive Infrastructure - Two-Track Strategy
// =============================================
// Track A (Canvas Scaling): Simulator, Deck Builder, Card Search
//   → Fixed internal resolution, transform: scale() to fit viewport
//   → Use ScalingContainerDirective + _canvas-scaling.scss
// Track B (Responsive CSS): Deck List, Settings, Login
//   → Mobile-first CSS with breakpoints below
//   → Use respond-above() / respond-below() mixins
// =============================================

// Breakpoint variables — single source of truth
$navbar-breakpoint: 768px;  // Matched in TS via CDK BreakpointObserver
$bp-mobile: 576px;
$bp-tablet: 768px;
$bp-desktop-sm: 1024px;

// Mobile-first responsive mixins
@mixin respond-above($bp) {
  @media (min-width: $bp) {
    @content;
  }
}

@mixin respond-below($bp) {
  @media (max-width: ($bp - 1px)) {
    @content;
  }
}

// Touch target utility (NFR12: 44×44px minimum on mobile)
.touch-target-min {
  min-width: 44px;
  min-height: 44px;
}
```

#### _canvas-scaling.scss

```scss
// front/src/app/styles/_canvas-scaling.scss
// =============================================
// Canvas Scaling Infrastructure (Track A Pages)
// =============================================
// Used by: ScalingContainerDirective host elements and their parents
// Pages: Simulator, Deck Builder, Card Search
// =============================================

// Parent container setup — MUST have explicit height (not auto)
@mixin canvas-parent {
  overflow: hidden;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: flex-start; // Anchor content to top
  // CRITICAL: Parent must set explicit height (e.g., height: 100vh, calc(100vh - headerHeight))
  // ResizeObserver on auto-height parent will NOT detect viewport changes
}

// Host element (the [appScalingContainer] element) base styles
@mixin canvas-host($ref-width, $ref-height) {
  width: #{$ref-width}px;
  height: #{$ref-height}px;
  transform-origin: top center;
  position: relative;
}

// Letterboxing — background for empty space around scaled canvas
@mixin canvas-letterbox($bg-color: transparent) {
  background-color: $bg-color;
}
```

#### ScalingContainerDirective

```typescript
// front/src/app/components/scaling-container/scaling-container.directive.ts
import {
  Directive,
  ElementRef,
  Renderer2,
  afterNextRender,
  inject,
  input,
  output,
  DestroyRef,
} from '@angular/core';

@Directive({
  selector: '[appScalingContainer]',
  standalone: true,
})
export class ScalingContainerDirective {
  // Inputs
  aspectRatio = input<number>(16 / 9);
  referenceWidth = input<number>(1920);

  // Output — emits computed scale factor
  scaleChange = output<number>();

  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly destroyRef = inject(DestroyRef);
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      this.initScaling();
    });
  }

  private initScaling(): void {
    const hostEl = this.el.nativeElement as HTMLElement;
    const parentEl = hostEl.parentElement;

    if (!parentEl) {
      console.warn('[ScalingContainerDirective] No parent element found — scaling disabled');
      return;
    }

    // Set initial host dimensions
    this.updateHostDimensions(hostEl);

    // Create ResizeObserver on parent
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.computeAndApplyScale(hostEl, width, height);
      }
    });

    this.resizeObserver.observe(parentEl);

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  private updateHostDimensions(hostEl: HTMLElement): void {
    const refWidth = this.referenceWidth();
    const refHeight = refWidth / this.aspectRatio();
    this.renderer.setStyle(hostEl, 'width', `${refWidth}px`);
    this.renderer.setStyle(hostEl, 'height', `${refHeight}px`);
    this.renderer.setStyle(hostEl, 'transformOrigin', 'top center');
  }

  private computeAndApplyScale(hostEl: HTMLElement, parentWidth: number, parentHeight: number): void {
    const refWidth = this.referenceWidth();
    const refHeight = refWidth / this.aspectRatio();

    const scale = Math.min(parentWidth / refWidth, parentHeight / refHeight, 1);

    this.renderer.setStyle(hostEl, 'transform', `scale(${scale})`);
    this.scaleChange.emit(scale);
  }
}
```

### Edge Cases

- **Rapid parent resizing (window drag):** ResizeObserver fires at ~60fps. Scale recalculation is trivial arithmetic. No debounce needed.
- **Parent with `height: auto`:** ResizeObserver will observe width changes but may miss height-only viewport changes. Documented constraint — parent MUST have explicit height. No runtime error — just potentially stale scale.
- **SSR rendering:** `afterNextRender()` ensures ResizeObserver is only created in the browser. SSR will skip scaling entirely — safe.
- **Multiple directives on same page:** Each instance observes its own parent independently. No shared state, no conflicts.
- **Parent removed from DOM:** ResizeObserver will stop firing. `DestroyRef.onDestroy()` disconnects it. No memory leak.
- **Very small parent (< 100px):** Scale will be very small but still computes correctly. No minimum scale enforced — the canvas becomes tiny but proportional.
- **Very large parent (> referenceWidth):** Scale capped at 1.0. Canvas displays at native resolution, centered with letterboxing.

### NFR Compliance

- **NFR9 (browser support):** ResizeObserver supported in Chrome 64+, Firefox 69+, Safari 13.1+, Edge 79+. All within "latest two versions" requirement.
- **NFR10 (build pipeline):** Zero new dependencies. Angular CLI builds the directive and SCSS files normally.
- **NFR11 (responsive 375px–2560px+):** `_responsive.scss` breakpoints cover the full range. Track B pages will use these mixins.
- **NFR12 (touch targets):** `.touch-target-min` utility class provides 44×44px minimum. Applied by consuming pages.

### What This Story Does NOT Include

- **No simulator migration** — BoardComponent keeps its inline scaling logic. Migration to ScalingContainerDirective is Epic 8.
- **No navbar responsive mode** — Hamburger/drawer mobile navbar is Story 7.2.
- **No page-level responsive CSS** — Login, settings, deck list responsive styles are Stories 7.3 and 7.4.
- **No shared component extraction** — CardComponent/CardInspectorComponent extraction is Epic 8.
- **No actual usage of `_responsive.scss` or `_canvas-scaling.scss`** — These are foundation files. Consumption happens in subsequent stories.

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `_responsive.scss` (breakpoint variables, mixins) | Story 7.2 (navbar responsive), 7.3 (login/settings), 7.4 (deck list) |
| `_canvas-scaling.scss` (canvas parent/host mixins) | Story 8.4 (deck builder), 8.5 (card search) |
| `ScalingContainerDirective` | Story 8.4 (deck builder canvas), 8.5 (card search canvas), Epic 8 simulator migration |

| Dependency | From |
|---|---|
| `NavbarCollapseService` (existing) | Story 6.4 — not used by directive, but navbar toggle triggers parent resize |
| `src/app/styles/` directory | Existing — angular.json `includePaths` already includes it |
| Angular 19.1.3 signal inputs/outputs | Existing stack — `input()`, `output()` |

### Previous Story Intelligence (Story 6.4)

**Patterns to follow:**
- `inject()` for all dependency injection (no constructor params)
- `signal()` / `computed()` for reactive state
- `DestroyRef.onDestroy()` for cleanup (not `OnDestroy` interface)
- `afterNextRender()` for browser-only initialization (SSR-safe)
- `prefers-reduced-motion` respect on all transitions
- `@use 'sim-tokens' as *` pattern for SCSS imports (existing SCSS convention)

**Lessons from 6.4:**
- Navbar expanded width is 260px (not 220px as originally spec'd — corrected during implementation)
- Navbar collapsed width is 32px
- Board internal dimensions are 1060×720px (not 1280×720 as original architecture spec)
- `effect()` with `untracked()` is the pattern for reacting to signal changes without creating circular dependencies
- Build verification is essential — run `ng build --configuration development` before marking done

**Files that must NOT be changed:**
- All simulator files — zero regression risk
- `navbar-collapse.service.ts` — unchanged
- `navbar.component.*` — unchanged (Story 7.2 will modify)
- All existing `styles/*.scss` files — new files only, no modifications

### Project Structure Notes

- Alignment with architecture: new files match the documented structure in architecture.md#Shared Infrastructure (Epics 7-8)
- `_responsive.scss` and `_canvas-scaling.scss` follow the existing naming pattern in `src/app/styles/` (underscore-prefixed SCSS partials)
- `ScalingContainerDirective` placed in `components/scaling-container/` per architecture.md

**Files created by this story:**
```
front/src/app/
  styles/
    _responsive.scss                           # NEW — breakpoints, responsive mixins, touch utility
    _canvas-scaling.scss                       # NEW — canvas parent/host mixins, letterboxing
  components/
    scaling-container/
      scaling-container.directive.ts           # NEW — ScalingContainerDirective
```

### References

- [Source: epics.md#Story 7.1] — Acceptance criteria, user story
- [Source: epics.md#Epic 7 Implementation Notes] — ScalingContainerDirective is NEW code, simulator NOT migrated
- [Source: architecture.md#ScalingContainerDirective] — Interface, behavior, parent constraint, referenceWidth per-page
- [Source: architecture.md#Responsive Strategy] — Two-track approach, breakpoints, hybrid layout pattern
- [Source: architecture.md#Shared SCSS Infrastructure] — `_canvas-scaling.scss` and `_responsive.scss` purposes
- [Source: ux-design-specification.md#Responsive Strategy] — Track A/B strategy, breakpoint table
- [Source: ux-design-specification.md#Scaling Model] — Scale formula, parent measurement, letterboxing
- [Source: prd.md#NFR9] — Browser support targets (latest two versions)
- [Source: prd.md#NFR11] — Responsive 375px–2560px+
- [Source: prd.md#NFR12] — Touch targets 44×44px minimum
- [Source: project-context.md#Angular Rules] — standalone: true, signal inputs/outputs, OnPush, SCSS conventions
- [Source: 6-4-collapsible-navbar-vertical-sidebar.md] — Previous story patterns, navbar dimensions (260px/32px), board dimensions (1060×720)

## Change Log

- 2026-02-14: Story implemented — created shared SCSS infrastructure (`_responsive.scss`, `_canvas-scaling.scss`) and `ScalingContainerDirective`. Build verified with zero errors. No existing components affected.
- 2026-02-14: Code review fixes applied (8 issues: 1H, 4M, 3L). Output renamed `scaleChange` → `scale` per architecture contract. `.touch-target-min` converted from CSS class to `@mixin`. ResizeObserver callback wrapped in `NgZone.run()`. Division-by-zero guards added. `canvas-host` mixin documented for unitless args. Barrel `index.ts` created. Parent 0×0 edge case documented. Build re-verified zero errors.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- Build verification: `ng build --configuration development` — success in 4.7s, zero errors, zero warnings
- `angular.json` already had `src/app/styles` in `stylePreprocessorOptions.includePaths` — no modification needed

### Completion Notes List

- Task 1: Created `_responsive.scss` with 4 breakpoint variables, 2 responsive mixins (`respond-above`, `respond-below`), 1 mixin `touch-target-min` (converted from CSS class during review), and two-track strategy documentation header
- Task 2: Created `_canvas-scaling.scss` with 3 mixins (`canvas-parent`, `canvas-host`, `canvas-letterbox`) including explicit height constraint documentation and unitless-args warning on `canvas-host`
- Task 3: Created `ScalingContainerDirective` — standalone directive with signal-based `aspectRatio` and `referenceWidth` inputs, `scale` output (renamed from `scaleChange` during review per architecture contract), ResizeObserver on parent via `afterNextRender()` (SSR-safe) with `NgZone.run()` wrapper, scale capped at 1.0, division-by-zero guards, cleanup via `DestroyRef.onDestroy()`, defensive null-parent check with warning, parent 0×0 edge case documented
- Task 4: Build verification passed — `angular.json` includePaths pre-configured, `ng build --configuration development` zero errors (re-verified post-review fixes), no existing components affected, SCSS files accessible via `@use`

### File List

- `front/src/app/styles/_responsive.scss` — NEW
- `front/src/app/styles/_canvas-scaling.scss` — NEW
- `front/src/app/components/scaling-container/scaling-container.directive.ts` — NEW
- `front/src/app/components/scaling-container/index.ts` — NEW (barrel export, added during review)
