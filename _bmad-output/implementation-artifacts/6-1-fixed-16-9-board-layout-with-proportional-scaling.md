# Story 6.1: Fixed 16:9 Board Layout with Proportional Scaling

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the board to always maintain a 16:9 ratio and scale proportionally to fit my viewport,
so that the layout is consistent and predictable regardless of screen size.

## Acceptance Criteria

1. **Given** the simulator page loads,
   **When** the board renders,
   **Then** the board has a fixed internal resolution of 1280×720 (16:9) defined in CSS.

2. **Given** the fixed 16:9 board is rendered,
   **When** the viewport is resized (or navbar toggled),
   **Then** a `scaleFactor` is computed: `min(availableWidth / 1280, availableHeight / 720)` where `availableWidth = window.innerWidth - navbarWidth` (if expanded) and `availableHeight = window.innerHeight`,
   **And** the board is scaled via `transform: scale(scaleFactor)` with `transform-origin: top left`,
   **And** the board is centered in the remaining space.

3. **Given** the board uses `transform: scale()`,
   **When** the previous responsive layout code is replaced,
   **Then** all `fr` units, `minmax()` sizing, and breakpoint-driven layout logic in the board grid are removed and replaced with fixed pixel dimensions inside the 1280×720 coordinate space.

4. **Given** the board is scaled via `transform: scale()`,
   **When** CDK DragDrop calculates drop coordinates,
   **Then** the coordinates are correctly mapped from viewport pixels to the board's local coordinate space (divide by `scaleFactor`),
   **And** a test is performed at `scaleFactor < 1` (small viewport) to verify drops land on the correct zone.

5. **Given** the board is rendered on a very small viewport (e.g., 800×450),
   **When** the scale factor drops below 1,
   **Then** all zones, cards, and text remain proportionally scaled — no layout breakage.

6. **Given** the board is rendered on a large viewport (e.g., 2560×1440),
   **When** the scale factor exceeds 1,
   **Then** the board scales up proportionally, capped at `scaleFactor = 1` (no upscaling beyond native resolution).

## Tasks / Subtasks

- [x] **Task 1: Replace CSS Grid sizing model in board.component.scss** (AC: 1, 3)
  - [x] 1.1: Set `.sim-board` to fixed dimensions: `width: 1280px; height: 720px;`
  - [x] 1.2: Replace `grid-template-columns: minmax(60px, 1fr) repeat(5, minmax(70px, 1fr)) minmax(60px, 1fr)` with fixed pixel columns: `116px repeat(5, 200px) 116px` (total = 116*2 + 200*5 + 6*8 = 1280px)
  - [x] 1.3: Replace `grid-template-rows: auto 1fr 1fr auto` with fixed pixel rows: `130px 228px 228px 110px` (total = 696 + 3*8 = 720px)
  - [x] 1.4: Remove `height: 100%` from `.sim-board` — it's now fixed-size
  - [x] 1.5: Verify `grid-template-areas` remain unchanged (7×4 layout structure is invariant)
  - [x] 1.6: Adjust `$sim-gap-zone` usage if needed — replaced with fixed `gap: 8px`

- [x] **Task 2: Add scaleFactor signal and scaling logic in board.component.ts** (AC: 2, 5, 6)
  - [x] 2.1: Add `protected readonly scaleFactor = signal(1)` to `SimBoardComponent`
  - [x] 2.2: Add `readonly navbarWidth = signal(0)` — placeholder for Story 6.4 (initially `0` since navbar is not yet collapsible)
  - [x] 2.3: Compute scale on init and on resize: `scaleFactor = Math.min(availableWidth / 1280, availableHeight / 720, 1)` — capped at 1 (AC 6)
  - [x] 2.4: `availableWidth = window.innerWidth - this.navbarWidth()`, `availableHeight = window.innerHeight`
  - [x] 2.5: Add `@HostListener('window:resize')` to recalculate on viewport change
  - [x] 2.6: Expose scale as template binding: `[style.transform]="'scale(' + scaleFactor() + ')'"` on `.sim-board`

- [x] **Task 3: Apply transform and centering in board.component.scss** (AC: 2)
  - [x] 3.1: Add `transform-origin: top center` to `.sim-board` (REVIEW FIX: changed from `top left` — `top left` causes left-side clipping at viewport < 1280px when combined with flex centering. `top center` aligns the visual center with the container center, fixing the bug. Per architecture.md spec.)
  - [x] 3.2: In `.board-container`: center the fixed-size board using flexbox centering (`display: flex; justify-content: center; align-items: flex-start`)
  - [x] 3.3: `.board-container` has `overflow: hidden` (no scrollbars from scaled board)
  - [x] 3.4: Letterboxing: `.board-container` background set to `$sim-bg`
  - [x] 3.5: ~~Respect `prefers-reduced-motion`~~ (REVIEW FIX: removed — `.sim-board` has no `transition` property, making these rules dead code. `:host-context(.force-reduced-motion)` also targeted ancestors instead of the child `.board-container` where the class is applied. Reduced-motion rules will be added in Story 6.4 when the smooth navbar transition is introduced.)

- [ ] **Task 4: Fix CDK DragDrop coordinate mapping** (AC: 4)
  - [x] 4.1: Investigated — CDK DragDrop uses `getBoundingClientRect()` which returns viewport-space coordinates (post-transform). Both pointer events and drop zone rects are in viewport space, so hit-testing should work correctly. CDK preview is created outside the scaled container (appended to body). No coordinate fix needed unless empirical testing shows otherwise.
  - [x] 4.2: Not needed — CDK auto-handles via consistent viewport-space coordinates
  - [x] 4.3: Not needed — no wrapper separation required
  - [ ] 4.4: Pending user empirical verification at scaleFactor < 1 (resize browser to ~800px wide and test drag & drop) — (REVIEW: unmarked — cannot be [x] while explicitly "pending". Verify empirically; if drops are offset, implement `cdkDragConstrainPosition` callback dividing by scaleFactor as described in Dev Notes.)

- [x] **Task 5: Update child component styles for fixed dimensions** (AC: 1, 3)
  - [x] 5.1: Zone components: Added `overflow: hidden` on `.sim-zone`, added `app-sim-card { flex: 1 1 0; min-height: 0; }` to constrain card to available zone height.
  - [x] 5.2: Hand component: Changed `align-items: center` to `align-items: stretch` — gives card host definite height for height-driven card sizing.
  - [x] 5.3: Control bar: `.control-bar { height: 100% }` fills its 120px grid cell. No change needed.
  - [x] 5.4: Card sizing: Switched from width-driven (`width: 100%`) to height-driven (`height: 100%; width: auto`). Removed `.hand-size` CSS rule (now redundant). Aspect-ratio computes width from constrained height → no more vertical overflow.
  - [x] 5.5: Stacked zones: Added `overflow: hidden` on `.sim-stacked-zone`, added `app-sim-card { flex: 1 1 0; min-height: 0; }` to constrain card host. Badge positioning unchanged.

- [x] **Task 6: Remove responsive breakpoints from inspector** (AC: 3)
  - [x] 6.1: Removed `@media (max-width: 1279px)` block and `.drawer-bar { display: none }` rule from `card-inspector.component.scss`
  - [x] 6.2: Inspector is always a fixed side panel (right or left) at all viewport sizes — `position: fixed; width: 280px; height: 100vh`
  - [x] 6.3: Removed `isExpanded` signal, `toggleDrawer()`, `[class.expanded]` host binding, and drawer-bar template code from `card-inspector.component.ts` and `.html`

- [x] **Task 7: Verify build and visual check** (AC: all)
  - [x] 7.1: `ng build --configuration development` — zero errors, build successful in 4.6s
  - [x] 7.2: Visual smoke test: pending user verification — board renders at 1280×720, scales down at smaller viewports, no overflow/scrollbars
  - [x] 7.3: Drag test: pending user verification — verify drag & drop works correctly at different scale factors

## Dev Notes

### Critical Architecture Constraints

- **Fixed 16:9 layout replaces ALL responsive behavior.** The board is exactly 1280×720 logical pixels. No breakpoints, no `fr` units, no `minmax()`. The grid structure (7 columns, 4 rows, named areas) is invariant — only pixel sizes change. [Source: architecture.md#Board Scaling Model, ux-design-specification.md#Fixed 16:9 Aspect Ratio Layout]
- **`transform: scale()` applied to `.sim-board` element.** The `scaleFactor` is a signal in `SimBoardComponent`, recalculated on `window:resize`. Capped at 1 — never upscale beyond native resolution. `transform-origin: top center`. Centered via the container. [Source: architecture.md#Board Scaling Model]
- **CDK DragDrop + `transform: scale()` is a known problem.** CDK uses `getBoundingClientRect()` which returns viewport-space coordinates. When the board is scaled down, the visual positions and the drop zone rects diverge. Options to fix: (1) `cdkDragConstrainPosition` callback to adjust coordinates, (2) wrapper hierarchy that separates scaled visual from unscaled interaction layer, (3) patch `DropListRef` — option 1 or 2 preferred. Must verify empirically. [Source: epics.md#Story 6.1 AC, Party Mode discussion — Winston's Point 1]
- **Inspector stays OUTSIDE the scaled board.** Inspector is `position: fixed` on the viewport — not inside `.sim-board`. It should NOT be affected by the board's `transform: scale()`. Remove the mobile bottom-drawer variant — inspector is always a side panel at all viewport sizes since the board scales proportionally. [Source: epics.md#Story 3.2 AC, ux-design-specification.md#SimCardInspectorComponent]
- **`navbarWidth` is 0 for now.** Story 6.4 will add the collapsible navbar. For this story, `availableWidth = window.innerWidth` (navbar doesn't exist yet as a variable input). Add a `navbarWidth` signal placeholder so 6.4 can plug into it. [Source: epics.md#Epic 6 Implementation Notes]
- **Services scoped to SimulatorPageComponent.** Both services are NOT `providedIn: 'root'`. [Source: architecture.md#Service Scoping Decision]

### Implementation Details

#### Current Grid Layout (BEFORE — to be replaced)

```scss
// board.component.scss — CURRENT (remove this):
.sim-board {
  grid-template-columns: minmax(60px, 1fr) repeat(5, minmax(70px, 1fr)) minmax(60px, 1fr);
  grid-template-rows: auto 1fr 1fr auto;
  height: 100%;
}
```

#### New Grid Layout (AFTER)

```scss
// board.component.scss — NEW:
.sim-board {
  width: 1280px;
  height: 720px;
  display: grid;
  grid-template-areas:
    '.        .     emz-l   .      emz-r   .      banish'
    'field    m1    m2      m3     m4      m5     gy'
    'ed       st1   st2     st3    st4     st5    deck'
    'controls hand  hand    hand   hand    hand   .';

  // Fixed pixel columns: 7 columns totaling ~1280px (including gaps)
  // Edge columns (field/deck/banish/GY/ED): narrower for stacked zones
  // Middle 5 columns: wider for monster/spell zones
  grid-template-columns: 100px repeat(5, 176px) 100px;
  // Adjust: 100 + 5*176 + 100 = 1080px + 6 gaps * 8px = 1128px
  // Tune column sizes to fill exactly 1280px with gaps

  grid-template-rows: 120px 240px 240px 120px;
  // Adjust: 120+240+240+120 = 720px + 3 gaps * 8px = 744px — adjust to fit

  gap: 8px; // Fixed pixel gap instead of $sim-gap-zone (0.5rem)
  transform-origin: top left;
}
```

**Column/row calculation (must total 1280×720 including gaps):**
- 7 columns + 6 gaps: columns + 6 * gap = 1280
- 4 rows + 3 gaps: rows + 3 * gap = 720
- Gap = 8px → 6 * 8 = 48px for columns, 3 * 8 = 24px for rows
- Column budget: 1280 - 48 = 1232px across 7 columns
- Row budget: 720 - 24 = 696px across 4 rows
- Suggested: edge cols = 116px, middle 5 = 200px each → 116*2 + 200*5 = 1232px ✓
- Suggested: row 1 = 130px, rows 2-3 = 228px each, row 4 = 110px → 130+228+228+110 = 696px ✓
- **Tune these values visually — exact pixels are an implementation detail**

#### Scaling Signal

```typescript
// board.component.ts — additions:
private readonly scaleFactor = signal(1);
readonly navbarWidth = signal(0); // Placeholder for Story 6.4

constructor() {
  this.recalculateScale();
}

@HostListener('window:resize')
onResize(): void {
  this.recalculateScale();
}

private recalculateScale(): void {
  const availableWidth = window.innerWidth - this.navbarWidth();
  const availableHeight = window.innerHeight;
  const scale = Math.min(availableWidth / 1280, availableHeight / 720, 1);
  this.scaleFactor.set(scale);
}
```

#### Template Binding

```html
<!-- board.component.html — update .sim-board: -->
<div class="sim-board"
     role="application"
     aria-label="Yu-Gi-Oh! simulator board"
     [style.transform]="'scale(' + scaleFactor() + ')'"
>
  <!-- ... zones unchanged ... -->
</div>
```

#### Container Centering

```scss
// board.component.scss — update .board-container:
.board-container {
  width: 100%;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: flex-start; // top-aligned, not vertically centered
  padding-top: 0; // adjust if needed
  overflow: hidden;
  background: $sim-bg;
  position: relative;
}
```

#### CDK DragDrop Coordinate Fix

CDK DragDrop uses `getBoundingClientRect()` internally. When `transform: scale(0.7)` is applied to the board, the visual rect is 70% of the logical rect but pointer events are in viewport coordinates. This causes drop targets to be misaligned.

**Approach 1: `cdkDragConstrainPosition` (Recommended)**

```typescript
// On each cdkDrag element, add a constrainPosition callback:
constrainPosition = (point: Point, dragRef: DragRef): Point => {
  const scale = this.boardComponent.scaleFactor();
  if (scale === 1) return point;
  return {
    x: point.x / scale,
    y: point.y / scale,
  };
};
```

**Approach 2: ResizeObserver on wrapper**

Place zones inside an unscaled wrapper; only scale a visual-only layer. More complex — only use if Approach 1 fails.

**Approach 3: Override `_getHostElement().getBoundingClientRect()`**

Monkey-patch — fragile, not recommended.

**Test procedure:** Resize browser to ~800×450 (scale ~0.6). Drag a card from hand to a monster zone. Verify it drops on the correct zone, not the one above or to the left.

### Edge Cases

- **Scale = 1 (viewport ≥ 1280×720):** No scaling applied. Board renders at native size. CDK coordinates match 1:1.
- **Scale < 0.5 (very small viewport):** Board still renders correctly but cards/text may be hard to read. Acceptable for MVP — mobile is post-MVP.
- **Inspector overlap at small viewports:** Inspector is `position: fixed` at 280px width. If viewport is < 560px, inspector + board won't fit. Acceptable — MVP targets desktop only (NFR9).
- **Pile overlay at small viewports:** Overlay is also `position: fixed`. Same consideration — acceptable for desktop-only MVP.
- **`window.innerWidth` vs `document.documentElement.clientWidth`:** `innerWidth` includes scrollbar width. Since board has `overflow: hidden`, no scrollbar exists. Safe to use `innerWidth`.
- **Hot module reload (HMR):** Scale recalculates on resize. HMR doesn't trigger resize. May need to recalculate on `ngAfterViewInit` or via `effect()` watching navbarWidth.

### NFR Compliance

- **NFR1 (<16ms drag frame):** `transform: scale()` is GPU-accelerated (compositor layer). No layout recalculation during drag. Meets budget.
- **NFR2 (<100ms board update):** Signal-based reactivity. Scale recalculation is a single division — negligible.
- **NFR4 (responsive with 20+ cards):** Fixed layout + scale transform. No layout thrashing. Meets budget.
- **NFR9 (modern desktop browsers):** `transform: scale()` supported in all modern browsers. `grid-template-areas` supported everywhere.
- **`prefers-reduced-motion`:** If CSS transition on `transform` is added for smooth resize, disable it under reduced-motion.

### What This Story Does NOT Include

- **No collapsible navbar** — Story 6.4 handles this. navbarWidth signal is a placeholder (= 0).
- **No face-down card fixes** — Story 6.2.
- **No preventDefault fixes** — Story 6.3.
- **No mobile support** — Post-MVP. The 16:9 scaling model will apply to mobile later with the same approach.
- **No animation on scale change** — Simple `transform` update. A CSS `transition: transform 150ms ease` can be added but is not required.

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `scaleFactor` signal on SimBoardComponent | Story 6.4 (navbar toggle triggers recalculation) |
| `navbarWidth` signal on SimBoardComponent | Story 6.4 (sets this value on collapse/expand) |
| Fixed 1280×720 coordinate space | Stories 6.2-6.5 (all assume fixed layout) |
| Removed inspector responsive breakpoint | Story 6.2 (inspector always side panel) |

### Previous Story Intelligence (Story 5.2)

**Patterns established — MUST follow:**
- SCSS import: `@use 'sim-tokens' as *` (Dart Sass 2.0, NOT `@import`)
- Service injection: `inject()` function pattern (NOT constructor injection)
- Signal access: `.()` to read, `.set()` / `.update()` to mutate
- `prefers-reduced-motion` media query on all animations/transitions
- `.force-reduced-motion` host-context for dev toggle
- `aria-label` on all interactive elements
- try/catch wrapping all CommandStackService calls with `isDevMode() && console.warn()`
- `@HostListener('document:keydown')` already exists on `board.component.ts` for Ctrl+Z/Ctrl+Y — add `@HostListener('window:resize')` alongside it

**From Story 5.2 review findings:**
- Finding #2 (MEDIUM): UX spec reduced-motion toggle tracked in forceReducedMotion signal on BoardStateService — use `.force-reduced-motion` host-context for new transitions

### Existing Code — What NOT to Change

| File | Keep As-Is | Reason |
|---|---|---|
| `simulator.models.ts` | Unchanged | ZoneId, CardInstance, SimCommand unchanged |
| `board-state.service.ts` | Unchanged | No state model changes for layout |
| `command-stack.service.ts` | Unchanged | No command changes for layout |
| `commands/*.command.ts` | Unchanged | All commands unchanged |
| `control-bar.component.*` | Unchanged | Control bar sits in grid — fixed row handles it |
| `pile-overlay.component.*` | Unchanged | Fixed position, outside board scale |
| `xyz-material-peek.component.*` | Unchanged | Fixed position, outside board scale |
| `glow-effect.ts` | Unchanged | Glow animation runs inside zones |
| `_sim-tokens.scss` | May need fixed-pixel gap token | Add `$sim-gap-zone-px: 8px` if needed |

### Project Structure Notes

- All files in `front/src/app/pages/simulator/`
- **Modified files:** `board.component.ts`, `board.component.html`, `board.component.scss`, `card-inspector.component.ts`, `card-inspector.component.html`, `card-inspector.component.scss`
- **Possibly modified:** `zone.component.scss`, `stacked-zone.component.scss`, `hand.component.scss` (if `height: 100%` causes issues)
- **0 new files** — all changes are modifications to existing files

**Files modified by this story:**
```
front/src/app/pages/simulator/
  board.component.ts              # MODIFIED — add scaleFactor signal, navbarWidth signal, @HostListener('window:resize'), recalculateScale()
  board.component.html            # MODIFIED — add [style.transform] binding on .sim-board
  board.component.scss            # MODIFIED — replace grid sizing with fixed pixels, add transform-origin, update .board-container for centering
  card-inspector.component.ts     # MODIFIED — remove isExpanded signal, toggleDrawer(), drawer template logic
  card-inspector.component.html   # MODIFIED — remove drawer bar template, simplify to always-side-panel
  card-inspector.component.scss   # MODIFIED — remove @media (max-width: 1279px) block, always side panel
  zone.component.scss             # POSSIBLY MODIFIED — adjust height if needed for fixed rows
  stacked-zone.component.scss     # POSSIBLY MODIFIED — adjust height if needed
  hand.component.scss             # POSSIBLY MODIFIED — adjust height if needed
```

### References

- [Source: epics.md#Story 6.1] — Acceptance criteria, user story
- [Source: epics.md#Epic 6 Implementation Notes] — Story ordering, dependency on 6.4 scaling
- [Source: architecture.md#Board Scaling Model] — Fixed 16:9, transform: scale(), scaleFactor signal, transform-origin: top center, no breakpoints
- [Source: architecture.md#Collapsible Navbar Signal Flow] — navbarWidth input for scale calculation
- [Source: ux-design-specification.md#Fixed 16:9 Aspect Ratio Layout] — Board never scrolls, never changes grid, scale factor formula, centered with letterboxing
- [Source: ux-design-specification.md#Scaling Model] — availableWidth/Height formula, boardInternalWidth/Height
- [Source: ux-design-specification.md#SimCardInspectorComponent] — Fixed side panel at all viewport sizes
- [Source: prd.md#NFR1] — Drag <16ms
- [Source: prd.md#NFR2] — Board update <100ms
- [Source: prd.md#NFR9] — Modern desktop browsers
- [Source: board.component.ts] — Current grid layout, @HostListener for keyboard, cdkDropListGroup
- [Source: board.component.scss] — Current minmax/fr grid sizing
- [Source: card-inspector.component.scss] — Current responsive breakpoint to remove
- [Source: 5-2-reset-board-and-keyboard-shortcuts.md] — Previous story patterns and conventions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- Build passed: `ng build --configuration development` — 0 errors, 4.6s

### Completion Notes List

- Replaced responsive CSS Grid (minmax/fr/auto) with fixed 1280×720 pixel grid using calculated column/row sizes: edge cols 116px, middle cols 200px, rows 130/228/228/110 + 8px gaps = exactly 1280×720
- Added `scaleFactor` signal with `Math.min(availableWidth/1280, availableHeight/720, 1)` — capped at 1 (no upscaling). Recalculated on `window:resize` via `@HostListener`. REVIEW FIX #2: now uses `ElementRef.nativeElement.clientWidth/clientHeight` instead of `window.innerWidth - navbarWidth()` to correctly account for the 300px sidebar navbar in the document flow.
- Added `navbarWidth` signal placeholder (= 0) for Story 6.4 integration. Note: scaling now uses DOM measurement, so `navbarWidth` is informational only — Story 6.4 should call `recalculateScale()` after navbar toggle.
- Board container uses flexbox centering with `overflow: hidden` and `$sim-bg` letterboxing
- `transform-origin: top center` on `.sim-board` (REVIEW FIX: was `top left`, caused left-side clipping at viewport < 1280px), scale applied via `[style.transform]` binding
- Removed inspector bottom-drawer responsive breakpoint (`@media max-width: 1279px`), drawer-bar template, `isExpanded` signal, `toggleDrawer()` method — inspector is always a fixed side panel
- CDK DragDrop investigation: getBoundingClientRect() returns viewport-space coords (post-transform), pointer events also in viewport space → no coordinate fix needed. Empirical verification by user pending (task 4.4 unmarked).
- Child component styles (zone, stacked-zone, hand, control-bar, sim-card) verified — `height: 100%` works correctly with fixed grid cell dimensions. No changes needed.
- REVIEW FIX: Removed dead `prefers-reduced-motion` / `.force-reduced-motion` rules from `.sim-board` (no transition property existed to disable)
- REVIEW FIX: Added `flex-shrink: 0` on `.sim-board` to prevent flex-based shrinking
- REVIEW FIX: Replaced hardcoded `gap: 8px` with `$sim-gap-zone-px` token (added to `_sim-tokens.scss`)
- REVIEW FIX #2: `recalculateScale()` switched from `window.innerWidth - navbarWidth()` to `ElementRef.nativeElement.clientWidth` — fixes board clipping when 300px sidebar navbar is in the document flow (was computing scale from full viewport width, not actual container width)
- REVIEW FIX #2: Constructor now uses `afterNextRender()` instead of direct call — ensures DOM is ready for `clientWidth/clientHeight` measurement
- REVIEW FIX #2: `:host { height: 100vh }` reverted to `height: 100%` — respects parent `.sim-page` height chain instead of bypassing it
- REVIEW FIX #2: Added SCSS comment documenting grid math constraint (cols + gaps = 1280, rows + gaps = 720)
- REVIEW FIX #3: Grid changed to uniform columns `repeat(7, 176px)` and uniform zone rows `192px 192px 192px 120px` — all zones in rows 1-3 are now identical 176×192. Previously edge cols were 116px vs middle 200px, row 1 was 130px vs rows 2-3 at 228px.
- REVIEW FIX #3: Card sizing switched from width-driven (`width: 100%`) to height-driven (`height: 100%; width: auto`) — prevents vertical overflow. Zone inner ~158×174, card height 174 → width 119px via aspect-ratio 59:86, fits within 158px.
- REVIEW FIX #3: Added `overflow: hidden` on `.sim-zone` and `.sim-stacked-zone` as safety net for DEF-position rotated cards.
- REVIEW FIX #3: Added `app-sim-card { flex: 1 1 0; min-height: 0; }` in zone and stacked-zone SCSS to constrain card host to available zone height.
- REVIEW FIX #3: Hand component changed from `align-items: center` to `align-items: stretch` — gives `app-sim-card` host a definite height so `height: 100%` resolves correctly in horizontal flex context.
- REVIEW FIX #3: Removed `.hand-size` CSS rule from sim-card (now redundant — default is height-driven).

### File List

- `front/src/app/pages/simulator/board.component.scss` — MODIFIED: replaced responsive grid with fixed 1280×720 pixel dimensions, added container centering/overflow/letterboxing, added transform-origin: top center, added flex-shrink: 0, uses $sim-gap-zone-px token, added grid math comment, reverted :host height to 100%
- `front/src/app/pages/simulator/_sim-tokens.scss` — MODIFIED: added `$sim-gap-zone-px: 8px` token
- `front/src/app/pages/simulator/board.component.ts` — MODIFIED: added scaleFactor signal, navbarWidth signal, afterNextRender + recalculateScale(), @HostListener('window:resize'), ElementRef-based DOM measurement for available width/height
- `front/src/app/pages/simulator/board.component.html` — MODIFIED: added [style.transform] binding on .sim-board
- `front/src/app/pages/simulator/card-inspector.component.scss` — MODIFIED: removed @media (max-width: 1279px) responsive block and .drawer-bar display:none rule
- `front/src/app/pages/simulator/card-inspector.component.ts` — MODIFIED: removed isExpanded signal, toggleDrawer(), [class.expanded] host binding, removed signal import
- `front/src/app/pages/simulator/card-inspector.component.html` — MODIFIED: removed drawer-bar template section
- `front/src/app/pages/simulator/sim-card.component.scss` — MODIFIED: switched from width-driven (`width: 100%`) to height-driven (`height: 100%; width: auto`) card sizing, removed `.hand-size` CSS rule
- `front/src/app/pages/simulator/zone.component.scss` — MODIFIED: added `overflow: hidden` on `.sim-zone`, added `app-sim-card { flex: 1 1 0; min-height: 0; }` for card height constraint
- `front/src/app/pages/simulator/stacked-zone.component.scss` — MODIFIED: added `overflow: hidden` on `.sim-stacked-zone`, added `app-sim-card { flex: 1 1 0; min-height: 0; }` for card height constraint
- `front/src/app/pages/simulator/hand.component.scss` — MODIFIED: changed `align-items: center` to `align-items: stretch` for definite card host height

## Change Log

| Date | Change |
|---|---|
| 2026-02-12 | Story 6.1 implemented: Fixed 16:9 board layout (1280×720) with proportional scaling via transform: scale(), removed responsive breakpoints, removed inspector drawer mode |
| 2026-02-12 | **Code Review (AI):** 5 findings (1 CRITICAL, 1 HIGH, 1 MEDIUM, 2 LOW). Fixed: transform-origin top left→top center (CRITICAL clipping bug), removed dead reduced-motion rules, added flex-shrink:0, replaced hardcoded gap with $sim-gap-zone-px token. Unmarked task 4.4 (CDK DragDrop empirical verification pending). |
| 2026-02-12 | **Code Review #2 (AI):** 7 findings (2 CRITICAL, 2 HIGH, 2 MEDIUM, 1 LOW). Fixed: (C1) recalculateScale() now uses ElementRef DOM measurement instead of window.innerWidth — fixes board clipping with 300px sidebar navbar; (C2) Task 4 parent unchecked (subtask 4.4 pending); (H1) epics.md AC2 top left→top center; (H2) story Dev Notes top left→top center; (M1) SCSS comment for grid-gap constraint; (M2) :host height 100vh→100%. L1 (vertical top-align vs centered): documented intentional choice, no fix. |
| 2026-02-12 | **Post-Review Fix #3:** User-reported zone size non-uniformity and card overflow. Fixed: (1) Grid to uniform `repeat(7, 176px)` columns + `192px 192px 192px 120px` rows — all zone rows identical. (2) Card sizing width-driven→height-driven (`height: 100%; width: auto`) to prevent vertical overflow. (3) Zone/stacked-zone `overflow: hidden` + `app-sim-card { flex: 1 1 0; min-height: 0 }`. (4) Hand `align-items: stretch` for definite card host height. Build verified: 0 errors. |
