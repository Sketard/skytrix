# Story 9.13: Bottom Sheet

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the deck builder's mobile portrait search to open as a bottom sheet instead of a full overlay,
so that the top of my deck remains visible while searching for cards.

## Acceptance Criteria

1. **Given** mobile portrait search currently opens as a full-width overlay
   **When** the bottom sheet is implemented
   **Then** it opens with snap points: 60% height (default), 100% on drag up, dismiss on drag down
   **And** a drag handle is visible at the top of the sheet
   **And** the top of the deck remains visible at the 60% snap point

2. **Given** the bottom sheet is a custom component (no new dependency)
   **When** it is implemented
   **Then** it uses vanilla pointer events (pointerdown/pointermove/pointerup) for snap point tracking
   **And** velocity calculation determines whether to snap up, stay, or dismiss

3. **Given** cards in the bottom sheet are draggable to deck zones via CDK
   **When** a card is dragged from the sheet to a deck zone
   **Then** `cdkDropListGroup` coverage allows the drag to cross the sheet boundary

4. **Given** the virtual keyboard opens on mobile (search input focus)
   **When** the viewport resizes
   **Then** the bottom sheet handles the resize via `visualViewport` API without breaking layout

5. **Given** the bottom sheet z-index
   **When** layered with other UI elements
   **Then** it is above the FAB search button (z-index 10) but below the card inspector (z-index 1001)

## Tasks / Subtasks

- [x] Task 1: Create `BottomSheetComponent` standalone component (AC: #1, #2)
  - [x] 1.1 Create `front/src/app/components/bottom-sheet/bottom-sheet.component.ts` as a standalone Angular component with `ChangeDetectionStrategy.OnPush`
  - [x] 1.2 Create `bottom-sheet.component.html` with: drag handle bar, `<ng-content>` for projected content, host element with `position: fixed`
  - [x] 1.3 Create `bottom-sheet.component.scss` with sheet positioning, drag handle styling, transition animations
  - [x] 1.4 Implement snap point logic in TS:
    - `sheetState` signal: `'closed' | 'half' | 'full'` (default `'half'` when opened)
    - `translateY` signal for real-time drag tracking (percentage of viewport height)
    - Three snap positions: `40vh` from top (60% height), `0` (100% height), offscreen (dismissed)
  - [x] 1.5 Implement pointer event handling for drag gesture:
    - `pointerdown` on drag handle → call `event.target.setPointerCapture(event.pointerId)` to ensure tracking continues even if finger slides off the handle, capture start Y position
    - `pointermove` → update `translateY` in real-time (no transition during drag), store last 5 pointer positions with timestamps for velocity calculation
    - `pointerup` → call `releasePointerCapture()`, calculate velocity from stored positions, determine snap target
  - [x] 1.6 Implement velocity-based snap determination:
    - Velocity > threshold upward → snap to `full`
    - Velocity > threshold downward → dismiss (close)
    - Below threshold → snap to nearest snap point based on current position
    - Use `CSS transition` for snap animation (300ms ease-out)
  - [x] 1.7 Add `opened` input signal and `closed` output event
  - [x] 1.8 Add `touch-action: none` on drag handle to prevent browser scroll interference
  - [x] 1.9 Add accessibility attributes:
    - `role="dialog"` and `aria-modal="false"` on the sheet host (not truly modal — deck is still visible)
    - `aria-label="Panneau de recherche de cartes"` on the sheet
    - `role="slider"` + `aria-label="Ajuster la taille du panneau"` + `aria-orientation="vertical"` on the drag handle
    - Listen for `Escape` key → dismiss the sheet (same as drag-down dismiss)
  - [x] 1.10 Add `@media (prefers-reduced-motion: reduce)` → set snap transition to `0ms` (no animation, instant snap)

- [x] Task 2: Integrate bottom sheet into deck builder for mobile portrait (AC: #1, #3)
  - [x] 2.1 In `deck-builder.component.html`: wrap `app-card-searcher` in `<app-bottom-sheet>` for mobile portrait mode
  - [x] 2.2 Keep the existing `.deckBuilder-side` div for desktop and landscape — bottom sheet is mobile portrait ONLY
  - [x] 2.3 **DO NOT use `@if` for conditional rendering** — use CSS `display: none` / `display: block` to toggle visibility. An `@if` would destroy/recreate the component on orientation change (portrait↔landscape), losing search state, scroll position, and filter state. Instead, always render the bottom sheet in DOM and hide it via SCSS `@media` query. The `opened` input controls the open/close animation; the CSS media query controls whether the sheet is in the DOM flow at all
  - [x] 2.4 The `<app-bottom-sheet>` MUST be a child of the `<div class="deckBuilder" cdkDropListGroup>` root element — this ensures `cdkDropListGroup` coverage for cross-boundary card drag
  - [x] 2.5 Wire FAB search toggle button to open the bottom sheet (reuse `searchPanelOpened` signal)
  - [x] 2.6 Wire bottom sheet `closed` event to update `searchPanelOpened` signal
  - [x] 2.7 Verify `card-list` inside the sheet retains `cdkDropList` with `id="cardList"` — `deck-card-zone.drop()` checks `event.previousContainer.id === 'cardList'` to detect "from search" drops

- [x] Task 3: Handle `visualViewport` API for virtual keyboard (AC: #4)
  - [x] 3.1 In `BottomSheetComponent`, listen to `window.visualViewport.resize` event
  - [x] 3.2 When keyboard opens (viewport height shrinks), recalculate snap positions relative to `visualViewport.height` instead of `window.innerHeight`
  - [x] 3.3 When keyboard closes (viewport height restores), re-snap to current state with updated positions
  - [x] 3.4 Add `visualViewport` type guard for SSR safety (though this app is SPA-only, defensive coding)

- [x] Task 4: Style the bottom sheet (AC: #1, #5)
  - [x] 4.1 Sheet container: `position: fixed; left: 0; right: 0; bottom: 0;` with `border-radius: 16px 16px 0 0` on top corners
  - [x] 4.2 Background: `var(--surface-base)` (inherits global dark token `#121212`)
  - [x] 4.3 Drag handle: centered horizontal bar (40px wide, 4px tall, `var(--text-secondary)` color, `border-radius: 2px`), 12px padding top/bottom
  - [x] 4.4 Z-index: `100` (above FAB at 10, below card inspector at 1001, below filters at 999)
  - [x] 4.5 Box shadow: `0 -4px 16px rgba(0, 0, 0, 0.3)` for depth
  - [x] 4.6 Transition: `transform 300ms cubic-bezier(0.4, 0, 0.2, 1)` for snap animations (disabled during active drag)
  - [x] 4.7 Content area: `overflow-y: auto` for scrollable search results within the sheet (but toggle to `overflow: visible` during active CDK card drag — see CDK Stacking Context section)
  - [x] 4.8 Backdrop: semi-transparent overlay (`rgba(0, 0, 0, 0.3)`) behind sheet — **REQUIRED, not optional**. The backdrop serves two purposes: (1) tap-to-dismiss affordance (users who don't discover swipe-down), (2) prevents accidental deck interaction while searching. Backdrop click → dismiss sheet (same as drag-down dismiss)

- [x] Task 5: Remove old mobile full-screen overlay for portrait (AC: #1)
  - [x] 5.1 In `deck-builder.component.scss`: remove the `@include r.respond-below(r.$bp-tablet)` block that makes `.deckBuilder-side` a `position: fixed; width: 100%; z-index: 1000; transform: translateX(100%)` full-screen overlay
  - [x] 5.2 Keep the `.deckBuilder-side` desktop styles (`position: relative; width: clamp(280px, 25vw, 360px)`) intact
  - [x] 5.3 Keep the `@include r.landscape-split` block intact (landscape restores side-by-side, no bottom sheet)
  - [x] 5.4 Hide `.deckBuilder-side` on mobile portrait — **requires a new media query**: `@media (max-width: 767px) and (orientation: portrait)` because the existing `r.respond-below(r.$bp-tablet)` mixin only checks `max-width: 767px` without orientation. In landscape, the side panel must remain visible (landscape-split). Add a new mixin `r.portrait-mobile` or use inline `@media` in `deck-builder.component.scss`
  - [x] 5.5 Show `app-bottom-sheet` only on mobile portrait via the same `@media (max-width: 767px) and (orientation: portrait)` query — `display: block` in portrait, `display: none` otherwise
  - [x] 5.6 Update `.deckBuilder-searchToggle` behavior: FAB still only shows on mobile portrait, now opens bottom sheet instead of slide-in
  - [x] 5.7 Remove `.deckBuilder-side-close` button styling for mobile (bottom sheet dismisses via drag-down or backdrop tap)

- [x] Task 6: Verify cdkDropListGroup cross-boundary drag (AC: #3)
  - [x] 6.1 Manually test: open bottom sheet at 60%, drag a card from search results upward over the sheet edge into a deck zone (MAIN, EXTRA, SIDE)
  - [x] 6.2 Verify `deck-card-zone.drop()` receives the event with `previousContainer.id === 'cardList'`
  - [x] 6.3 If CDK drag breaks at the sheet boundary: see "CDK Stacking Context" section in Dev Notes — `position: fixed` creates a new stacking context, `elementFromPoint()` may return the sheet instead of the deck zone. Toggle `overflow: visible` + `pointer-events: none` on the sheet content area during active CDK drag
  - [x] 6.4 Verify double-click shortcut still works inside the bottom sheet (fly animation from `card-list.onDoubleClick()`) — fly clone appends to `document.body` at z-index 10000, should work regardless. **Edge case:** in 100% mode, deck zones are fully covered by the sheet — fly target `getBoundingClientRect()` returns coordinates under the sheet. The animation will look correct visually (clone flies to correct position) but lands behind the sheet. Acceptable UX: card is added to deck, sheet can be dismissed to see it

- [x] Task 7: Build and visual verification (AC: all)
  - [x] 7.1 Run `ng build` — expect zero compilation errors (budget warnings are pre-existing, ignore)
  - [x] 7.2 Desktop: verify side panel still works as before (no visual changes)
  - [x] 7.3 Mobile landscape: verify landscape-split still works (no bottom sheet)
  - [x] 7.4 Mobile portrait: verify FAB opens bottom sheet at 60%
  - [x] 7.5 Mobile portrait: drag handle up → sheet snaps to 100%
  - [x] 7.6 Mobile portrait: drag handle down → sheet dismisses
  - [x] 7.7 Mobile portrait: drag card from sheet to deck zone (cross-boundary)
  - [x] 7.8 Mobile portrait: focus search input → keyboard opens → sheet adjusts
  - [x] 7.9 Mobile portrait: card inspector opens above sheet (z-index correct)

## Dev Notes

### Critical Architecture Decision: Vanilla Pointer Events (NOT CDK Drag)

The bottom sheet drag gesture MUST use vanilla pointer events (`pointerdown`, `pointermove`, `pointerup`), NOT CDK DragDrop. Reasons:
- CDK DragDrop is designed for moving DOM elements between containers, not for resizing/repositioning a panel
- CDK drag on the handle would conflict with CDK drag on cards inside the sheet
- Pointer events give full control over velocity calculation and snap logic
- `setPointerCapture()` ensures drag tracking continues even if pointer leaves the handle element

### Snap Point Math

```
viewportHeight = window.visualViewport?.height ?? window.innerHeight

SNAP_HALF  = viewportHeight * 0.4   // sheet top at 40% from top = 60% height
SNAP_FULL  = 0                       // sheet top at viewport top = 100% height
SNAP_CLOSE = viewportHeight          // sheet fully offscreen below

// During drag:
translateY = startTranslateY + (currentPointerY - startPointerY)

// On pointerup:
velocity = (currentPointerY - prevPointerY) / timeDelta  // px/ms
if (velocity > DISMISS_THRESHOLD)   → animate to SNAP_CLOSE, emit closed
if (velocity < -EXPAND_THRESHOLD)   → animate to SNAP_FULL
else                                → snap to nearest (SNAP_HALF or SNAP_FULL)
```

Suggested velocity thresholds: `0.5 px/ms` for dismiss, `-0.5 px/ms` for expand. Tune based on feel.

### cdkDropListGroup Coverage — Critical Constraint

The `cdkDropListGroup` directive is on the root `<div class="deckBuilder">` in `deck-builder.component.html`. All `cdkDropList` instances within this DOM subtree automatically join the group. The bottom sheet component MUST be rendered **inside** this div to ensure cards dragged from `card-list` (inside the sheet) can reach `deck-card-zone` instances (outside the sheet).

```html
<!-- deck-builder.component.html structure -->
<div class="deckBuilder" cdkDropListGroup>
  <!-- deck viewer (contains deck-card-zone instances with cdkDropList) -->
  <div class="deckBuilder-canvasParent">...</div>

  <!-- desktop + landscape side panel (hidden via CSS on mobile portrait) -->
  <div class="deckBuilder-side" [class.opened]="searchPanelOpened()">
    <app-card-searcher [deckBuildMode]="true" [searchService]="deckBuildService" />
  </div>

  <!-- BOTTOM SHEET (hidden via CSS on desktop/landscape, shown on mobile portrait) -->
  <!-- MUST be inside cdkDropListGroup div for cross-boundary card drag -->
  <app-bottom-sheet
    [opened]="searchPanelOpened() && isMobilePortrait()"
    [cardDragActive]="isCardDragActive()"
    (closed)="searchPanelOpened.set(false)">
    <app-card-searcher [deckBuildMode]="true" [searchService]="deckBuildService" />
  </app-bottom-sheet>
</div>
```

**Note:** Two `app-card-searcher` instances exist in the DOM (one in side panel, one in bottom sheet), but only one is visible at a time via CSS. Both share the same `deckBuildService` (injected service), so search state is shared. If this causes performance issues (double API calls), consider a single instance moved between containers — but start with the simpler dual-instance approach.

**If the bottom sheet is rendered outside the `cdkDropListGroup` div, cross-boundary drag will silently fail.** The `deck-card-zone.drop()` handler will never fire because CDK won't connect the drop lists.

### CDK Stacking Context vs `position: fixed` — Critical Risk

`position: fixed` on the bottom sheet creates a **new stacking context**. CDK DragDrop uses `document.elementFromPoint()` to determine which `cdkDropList` the dragged card is over. If the sheet's content area overlaps the deck zones (which it does at 60% and 100%), `elementFromPoint()` may return a sheet element instead of the deck zone underneath.

**Mitigation strategy:**
1. During active CDK card drag (detect via `cdkDragStarted` event on card-list items), add a CSS class to the sheet that sets `pointer-events: none` on the sheet content wrapper (NOT the drag preview — that needs pointer events)
2. The CDK drag preview is rendered in a global overlay (`cdkDragPreviewContainer: 'global'`) which is outside the sheet stacking context — this is already the default behavior
3. When CDK drag ends (`cdkDragEnded`), remove the class and restore `pointer-events: auto`

```typescript
// In BottomSheetComponent — expose a signal for parent to control
readonly cardDragActive = input(false);

// In deck-builder.component.html
<app-bottom-sheet [cardDragActive]="isCardDragActive()">
```

Alternatively, listen to CDK drag events directly inside the bottom sheet by detecting `cdkDragStarted`/`cdkDragEnded` on projected content via `@ContentChildren` or by sharing state through the `DeckBuildService`.

### Detecting Mobile Portrait

**TS detection** (for `opened` logic, keyboard handling, etc.): Use Angular CDK `BreakpointObserver`:

```typescript
// In DeckBuilderComponent
private breakpointObserver = inject(BreakpointObserver);
readonly isMobilePortrait = toSignal(
  this.breakpointObserver.observe(['(max-width: 767px) and (orientation: portrait)'])
    .pipe(map(result => result.matches)),
  { initialValue: false }
);
```

The `card-searcher` component already uses `BreakpointObserver` for filter state initialization — this is a proven pattern in the codebase.

**SCSS detection** (for show/hide): The existing `r.respond-below(r.$bp-tablet)` mixin checks `max-width: 767px` but does NOT check `orientation: portrait`. A new inline media query or mixin is needed:

```scss
// Option A: inline in deck-builder.component.scss
@media (max-width: 767px) and (orientation: portrait) {
  .deckBuilder-side { display: none; }
  app-bottom-sheet { display: block; }
}

// Option B: new mixin in _responsive.scss (if reusable)
@mixin portrait-mobile { @media (max-width: #{$bp-tablet - 1}) and (orientation: portrait) { @content; } }
```

**DO NOT use `@if` in the template** to toggle between side panel and bottom sheet. Orientation changes (portrait↔landscape) would destroy/recreate the component, losing search input, scroll position, and filter state. Instead, always render both elements and use CSS `display` to toggle visibility. The bottom sheet should auto-close when switching to landscape (detect via `isMobilePortrait` signal change).

### Z-index Stacking Context

| Layer | z-index | Element |
|---|---|---|
| FAB search toggle | `10` | `.deckBuilder-searchToggle` (fixed bottom-right) |
| Hand test backdrop | `20` | `.deckBuilder-handBackdrop` |
| **Bottom sheet** | **`100`** | `app-bottom-sheet` (fixed bottom) |
| Filters slide-in | `999` | `.deckBuilder-side-filters` |
| Card inspector (mobile) | `1001` | `app-card-inspector` (via `--inspector-z-index`) |

The bottom sheet at z-index 100 is safely above the FAB (10) and below the card inspector (1001). The filters panel (999) is only relevant inside the desktop side panel — it doesn't overlap with the bottom sheet.

### Virtual Keyboard Handling

Mobile browsers resize the viewport when the virtual keyboard opens. The `visualViewport` API provides accurate viewport dimensions:

```typescript
// In BottomSheetComponent
ngAfterViewInit() {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', this.onViewportResize);
  }
}

private onViewportResize = () => {
  // Recalculate snap positions based on actual visible area
  this.viewportHeight.set(window.visualViewport!.height);
  // Re-snap to current state with new dimensions
  this.snapTo(this.sheetState());
};

ngOnDestroy() {
  window.visualViewport?.removeEventListener('resize', this.onViewportResize);
}
```

When the search input inside the bottom sheet gains focus and the keyboard opens, the sheet should remain at the same snap state but recalculate its position relative to the reduced viewport. This prevents the sheet content from being hidden behind the keyboard.

### Existing Code to Reuse (DO NOT Reinvent)

| What | Where | How to reuse |
|---|---|---|
| Search panel toggle | `DeckBuilderComponent.searchPanelOpened` signal | Wire to `opened` input of bottom sheet |
| Card searcher component | `app-card-searcher` | Project as `<ng-content>` inside bottom sheet |
| Card drag from search | `card-list` with `cdkDropList id="cardList"` | No changes needed — just ensure it's inside `cdkDropListGroup` |
| Double-click fly animation | `card-list.onDoubleClick()` | No changes needed — fly animation appends clone to `document.body` |
| Responsive breakpoints | `_responsive.scss` mixins | Use `r.respond-below(r.$bp-tablet)` for SCSS, `BreakpointObserver` for TS |
| Filters panel | `.deckBuilder-side-filters` | Filters within the bottom sheet need separate consideration (see below) |

### Filters Panel Inside Bottom Sheet — Parent Context Change

Currently, `.deckBuilder-side-filters` is `position: absolute` inside `.deckBuilder-side`. When `card-searcher` is projected into the bottom sheet via `<ng-content>`, the absolute-positioned filters will try to position relative to the **nearest positioned ancestor**, which is now the bottom sheet container, NOT `.deckBuilder-side`.

**Required action:** Ensure `BottomSheetComponent`'s content wrapper has `position: relative` so filters position correctly inside it. Without this, filters will position relative to the viewport or a random ancestor, appearing at an incorrect location.

```scss
// bottom-sheet.component.scss
.bottom-sheet-content {
  position: relative; // anchor for absolute-positioned filters inside card-searcher
  overflow-y: auto;
  flex: 1;
}
```

The filter toggle button inside `search-bar.component` emits `filterToggled`, and `card-searcher` handles it — no TS changes needed. Only the CSS containment context changes.

### Animation Performance

- Use `transform: translateY()` for sheet positioning (GPU-accelerated, no layout thrashing)
- Use `will-change: transform` on the sheet container
- Disable CSS transition during active pointer drag (set `transition: none`), re-enable on `pointerup` for snap animation
- Use `requestAnimationFrame` for pointermove updates to avoid jank

### Anti-Pattern Warnings

- **DO NOT** use Angular Material `MatBottomSheet` — it's a new dependency import from `@angular/material/bottom-sheet` and the project policy is no new deps
- **DO NOT** use Hammer.js or any gesture recognition library — vanilla pointer events are sufficient
- **DO NOT** use `touchstart`/`touchmove`/`touchend` — `pointer*` events are the unified API that works on both touch and mouse (better for testing on desktop)
- **DO NOT** render the bottom sheet outside the `cdkDropListGroup` div — cross-boundary drag will silently fail
- **DO NOT** use `position: absolute` on the sheet — it must be `position: fixed` to overlay the viewport correctly
- **DO NOT** break the desktop side panel — it remains unchanged (always visible, no overlay)
- **DO NOT** break the landscape-split layout — it remains unchanged (side-by-side, no bottom sheet)
- **DO NOT** add a close (X) button to the bottom sheet — dismissal is by drag-down gesture, backdrop tap, or `Escape` key (three affordances, no visual button needed)
- **DO NOT** use `@if` in the template to toggle between side panel and bottom sheet — orientation changes destroy the component and lose search state. Use CSS `display` toggling instead
- **DO NOT** use `window.innerHeight` for snap calculations when keyboard is open — use `visualViewport.height`
- **DO NOT** apply `overflow: hidden` on the sheet during card drag — it will clip the CDK drag preview. Use `overflow: visible` or toggle overflow based on drag state

### Previous Story Intelligence (9-12)

From story 9-12 (Simulator Token Migration):
- Build exits code 1 due to pre-existing budget warnings (bundle 1.57 MB > 1 MB limit) — these are NOT related to any story. Zero compilation errors = success.
- `rgba(var())` doesn't work in CSS — if you need semi-transparent overlays, hardcode the rgba value or use `color-mix()`.
- Code review found dead CSS custom properties — keep the bottom sheet's custom properties minimal and actually used.
- Prefix collision risk: be careful with `replace_all` on SCSS variables that share prefixes.

### Responsive Behavior Matrix

| Viewport | Search UX | Bottom Sheet? |
|---|---|---|
| Desktop (>= 768px) | Permanent side panel | No — side panel always visible |
| Mobile landscape (576-767px, landscape) | Side-by-side split (55%/45%) | No — landscape-split CSS handles this |
| Mobile portrait (< 768px, portrait) | **Bottom sheet** | **Yes — replaces full-screen overlay** |

### Project Structure Notes

- New component: `front/src/app/components/bottom-sheet/bottom-sheet.component.{ts,html,scss}`
- Modified: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.{ts,html,scss}`
- No new dependencies, no new services
- Bottom sheet is a shared component (in `components/`) in case it's reused elsewhere later

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Story 9.13]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md §Screen 3 Deck Builder risks, §Recommended Implementation Order step 13]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §Drag & Drop Interaction, §Mobile/Responsive Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md §Responsive Strategy Track A]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts — searchPanelOpened signal, toggleSearchPanel()]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss — .deckBuilder-side mobile overlay, .deckBuilder-searchToggle FAB]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html — cdkDropListGroup on root div]
- [Source: front/src/app/components/card-list/card-list.component.html — cdkDropList id="cardList"]
- [Source: front/src/app/components/deck-card-zone/deck-card-zone.component.ts — drop() checks previousContainer.id === 'cardList']

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build exits code 1 due to pre-existing budget warnings only (bundle 1.63 MB > 1 MB, deck-builder SCSS 5.79 kB > 4 kB). Zero compilation errors.

### Completion Notes List

- Created `BottomSheetComponent` standalone component with vanilla pointer events for drag gesture, velocity-based snap determination (0.5 px/ms threshold), three snap states (closed/half/full), `visualViewport` API for keyboard handling, accessibility attributes, and `prefers-reduced-motion` support.
- Integrated bottom sheet into deck-builder: projected `card-searcher` + `card-filters` inside `<app-bottom-sheet>`, placed inside `cdkDropListGroup` for cross-boundary drag. Used CSS `display` toggling (not `@if`) for portrait/landscape switching.
- Added `isMobilePortrait` signal via `BreakpointObserver` for TS-side detection and `@media (max-width: 767px) and (orientation: portrait)` for SCSS detection.
- Implemented CDK stacking context mitigation: `cardDragActive` signal flows from `card-list` → `DeckBuildService` → `deck-builder` → `BottomSheetComponent`, toggling `pointer-events: none` + `overflow: visible` on the sheet content during card drag.
- Replaced old mobile full-screen slide-in overlay (`position: fixed; transform: translateX`) with `display: none` on portrait mobile. FAB search toggle scoped to portrait-only.
- Backdrop with tap-to-dismiss, Escape key dismiss, and drag-down dismiss provide three dismissal affordances.
- Two `card-searcher` instances (side panel + bottom sheet) share state via `DeckBuildService`. Only one visible at a time via CSS.

### File List

- `front/src/app/components/bottom-sheet/bottom-sheet.component.ts` (new)
- `front/src/app/components/bottom-sheet/bottom-sheet.component.html` (new)
- `front/src/app/components/bottom-sheet/bottom-sheet.component.scss` (new)
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts` (modified)
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html` (modified)
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss` (modified)
- `front/src/app/components/card-list/card-list.component.ts` (modified)
- `front/src/app/components/card-list/card-list.component.html` (modified)
- `front/src/app/services/deck-build.service.ts` (modified)
- `front/src/app/services/search-service-core.service.ts` (modified — review fix: fetch guard)
- `front/src/app/components/deck-card-zone/deck-card-zone.component.ts` (modified — review fix: data-based drop detection)

## Change Log

- 2026-02-18: Implemented bottom sheet for mobile portrait search (replaces full-screen overlay). New standalone component with snap gesture, CDK cross-boundary drag support, virtual keyboard handling, and accessibility.
- 2026-02-17: Code review (9 findings: 2H, 4M, 3L — all fixed). H1: added rAF to pointer drag. H2: replaced duplicate `id="cardList"` with `cdkDropListData`. M1: removed dead close button. M2: added fetch guard against double API calls. M3: added pointerId filtering for multi-touch. M4: removed dead `[class.opened]` binding. L1: encapsulated `cardDragActive` with setter. L2: replaced `@HostListener` with host binding for Escape. L3: prevented redundant `snapTo('closed')` on dismiss.
