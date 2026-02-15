---
title: 'Responsive UX Fixes — Multi-Page'
slug: 'responsive-ux-fixes'
created: '2026-02-15'
status: 'in-progress'
stepsCompleted: [1, 2, 3, 4, 5]
tech_stack: ['Angular 19.1.3', 'Angular Material 19.1.1', 'CDK BreakpointObserver', 'CDK DragDrop', 'SCSS', 'TypeScript 5.5.4']
files_to_modify:
  - 'front/src/app/services/navbar-collapse.service.ts'
  - 'front/src/app/pages/deck-page/components/deck-list/deck-list.component.scss'
  - 'front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html'
  - 'front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss'
  - 'front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts'
  - 'front/src/app/components/card-searcher/card-searcher.component.html'
  - 'front/src/app/components/card-searcher/card-searcher.component.scss'
  - 'front/src/app/components/card-searcher/card-searcher.component.ts'
  - 'front/src/app/components/card/card.component.scss'
  - 'front/src/app/pages/simulator/zone.component.scss'
  - 'front/src/app/pages/simulator/hand.component.ts'
  - 'front/src/app/pages/simulator/board.component.scss'
  - 'front/src/app/components/search-bar/search-bar.component.scss'
  - 'front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.scss'
  - 'front/src/app/components/deck-card-zone/deck-card-zone.component.scss'
  - 'front/src/app/styles/variable.scss'
code_patterns:
  - 'Signal-based state (signal(), computed())'
  - 'OnPush change detection'
  - 'Standalone components'
  - 'Canvas scaling via ScalingContainerDirective (referenceWidth + aspectRatio inputs)'
  - 'Responsive mixins: respond-above($bp), respond-below($bp)'
  - 'CDK DragDrop: cdkDropListGroup > cdkDropList > cdkDrag'
test_patterns: ['Manual visual testing only — no automated tests until MVP']
---

# Tech-Spec: Responsive UX Fixes — Multi-Page

**Created:** 2026-02-15

## Overview

### Problem Statement

Hand testing on mobile (portrait + landscape) and desktop reveals 9 responsive/render issues across 4 pages: decklist, deck builder, card search, and simulator. Issues include navbar appearing on mobile landscape, inaccessible filters, suboptimal deck builder layout (both mobile and desktop), and visual bugs in the simulator (DEF card overflow, broken hand layout, drag-induced scroll).

### Solution

9 targeted SCSS/HTML/TS fixes addressing layout, visibility, and interaction issues. The Two-Track Strategy is preserved: Track A (canvas scaling) internal dimensions are reworked for the deck builder, Track B (mobile-first CSS) fixes are applied to content pages. Simulator fixes are render bug corrections (not responsive).

### Scope

**In Scope (9 tasks):**
1. Decklist portrait: delete button repositioned as badge overlay on deckbox
2. Global mobile landscape: navbar hidden via BreakpointObserver height+width condition
3. Deck builder portrait mobile: **blocking overlay** "Rotate your device" (not dismissible banner)
4. Deck builder mobile landscape: canvas internal dimensions reworked (60/40 ratio, Master Duel style) — depends on #9
5. Card search: filter toggle button added next to search bar, visible at all viewports. Panel open by default on desktop, closed by default on mobile.
6. Simulator: DEF position card scaled to fit zone *(render bug — validate at all sizes)*
7. Simulator: hand/card fan layout fixed *(render bug — FAN_SPACING too small, z-index formula incorrect)*
8. Simulator: `touch-action: none` on game board to prevent drag-scroll
9. Deck builder desktop: header moved to right column with grouped action menu — **must be implemented before #4**

**Out of Scope:**
- New features or gameplay mechanics
- Track A/B infrastructure refactoring
- Backend changes
- Simulator gameplay logic
- Automated tests (big bang approach — tests after full MVP)

## Context for Development

### Codebase Patterns

- **Two-Track Responsive Strategy**: Track A (canvas scaling via `transform: scale()` + `ScalingContainerDirective`) for simulator, deck builder, card search. Track B (mobile-first CSS with breakpoints) for deck list, settings, login.
- **Breakpoints**: `$bp-mobile: 576px`, `$bp-tablet: 768px`, `$navbar-breakpoint: 768px`, `$bp-desktop-sm: 1024px`
- **Responsive mixins**: `respond-above($bp)`, `respond-below($bp)`, `touch-target-min`
- **Canvas scaling**: `ScalingContainerDirective` computes `scale = min(parentW/refW, parentH/refH, 1)` — capped at 1.0, no upscaling. Parent must have explicit height.
- **Navbar**: CDK `BreakpointObserver` in `NavbarCollapseService` with `(max-width: 768px)` query, exposes `isMobile` signal → `AppComponent` binds `[class.mobile-mode]`
- **Mobile overlays**: Fixed-position panels with `transform: translateX()` slide transitions (300ms)
- **Simulator card dimensions**: Zone grid `148px × 200px`, card aspect ratio `59:86`, hand card height `96px` (~66px wide)

### Technical Decisions

- **Q1 — Navbar breakpoint**: Modify `NavbarCollapseService` BreakpointObserver query to `'(max-width: 768px), (max-width: 1024px) and (max-height: 500px)'`. Covers mobile portrait (≤768px) AND phone/tablet landscape (≤1024px with height ≤500px) WITHOUT affecting resized desktop windows. *(Refined via Party Mode.)*
- **Q2 — Deck builder Track A**: Keep canvas scaling, rework internal reference dimensions to allocate ~60% to deck viewer, ~40% to search panel (Master Duel proportions).
- **Q3 — Filter toggle**: No toggle button exists currently. Must CREATE: a `mat-icon-button` with filter icon next to search bar, a `filtersOpen` signal in `card-searcher.component.ts`, and toggle-based SCSS (replace `display: none` with signal-driven class). Visible at all viewports. Open by default on desktop (`≥768px`), closed by default on mobile (`<768px`).
- **Q4 — `touch-action: none`**: Zero `touch-action` declarations in entire codebase. CDK DragDrop uses its own touch handlers (`cdkDrag` directive). Adding `touch-action: none` on `.board-container` should not conflict — CDK docs recommend it for drag containers.
- **Q5 — Header restructuring (#9)**: Moving header from full-width (HTML L3-55) into side panel column (L66-83). Impacts: flex flow reversal, header becomes vertical layout, action buttons grouped in dropdown. Must be done BEFORE #4 (canvas dimensions depend on available space).
- **Q6 — Hand layout root cause**: `FAN_SPACING=36px` but card width ~66px → excessive overlap. z-index formula `n - Math.abs(Math.round(t * n))` may produce incorrect layering. Fix: increase FAN_SPACING, verify z-index math.
- **Q7 — DEF card overflow**: `card.component.scss:19-21` applies `rotate(90deg)` without compensating scale. Rotated card's visual width (86 units) exceeds zone width (148px). Fix: add `scale()` on `.def-position` to fit zone constraints.

### Files to Reference

| File | Purpose | Anchor Lines |
| ---- | ------- | ------------ |
| `services/navbar-collapse.service.ts` | BreakpointObserver query | L15 |
| `app.component.html` | `[class.mobile-mode]` binding | L1 |
| `app.component.scss` | `.mobile-mode` padding + CSS var | L2, L22-26 |
| `components/navbar/navbar.component.scss` | Mobile top bar, drawer, backdrop | L110-237 |
| `pages/deck-page/components/deck-list/deck-list.component.html` | Deckbox + delete button structure | L3-10 |
| `pages/deck-page/components/deck-list/deck-list.component.scss` | `.deckPage-deck` flex + delete position | L18-37 |
| `pages/deck-page/components/deck-builder/deck-builder.component.html` | Header (L3-55), body (L57-84), canvas (L60) | L1-106 |
| `pages/deck-page/components/deck-builder/deck-builder.component.scss` | Header (L31-119), body (L121-127), canvas (L129-141), side panel (L143-208) | Full |
| `pages/deck-page/components/deck-builder/deck-builder.component.ts` | No layout logic — pure CSS | — |
| `pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.scss` | Main deck 750px width, card sizes | L12-49 |
| `components/card-searcher/card-searcher.component.html` | Search bar + display toggles + filter panel | L1-41 |
| `components/card-searcher/card-searcher.component.scss` | Searcher width calc, filter `display:none` | L19-84 |
| `components/card-searcher/card-searcher.component.ts` | No filter toggle logic — to be added | — |
| `components/card/card.component.scss` | `.def-position { rotate(90deg) }` | L19-21 |
| `pages/simulator/zone.component.scss` | Card flex sizing in zone, overflow:hidden | L19, L23-26 |
| `pages/simulator/board.component.html` | `cdkDropListGroup` container | L1 |
| `pages/simulator/board.component.scss` | `.board-container` — missing touch-action | L9-18 |
| `pages/simulator/hand.component.ts` | Fan constants + style computation | L26-43 |
| `pages/simulator/hand.component.scss` | Fan absolute positioning + transforms | L21-38 |
| `pages/simulator/_sim-tokens.scss` | `$sim-hand-card-height: 96px` | L33 |
| `components/scaling-container/scaling-container.directive.ts` | Scale computation logic | L32-34 (inputs), L92-102 (scale) |
| `styles/_responsive.scss` | Breakpoint variables + mixins | L14-36 |
| `styles/_canvas-scaling.scss` | Canvas parent/host mixins | L8-31 |

## Implementation Plan

### Tasks

#### Bloc 1 — Navbar Breakpoint (foundation)

- [x] **Task 1: Extend navbar mobile detection to cover landscape phones** (#2)
  - File: `front/src/app/services/navbar-collapse.service.ts`
  - Action: Change BreakpointObserver query at L15 from `'(max-width: 768px)'` to `'(max-width: 768px), (max-width: 1024px) and (max-height: 500px)'`
  - Notes: This makes `isMobile` signal true for phone landscape (width ≤1024px AND height ≤500px). All CSS depending on `.mobile-mode` class and all TS consuming `isMobile` signal will automatically adapt. No other file changes needed — the signal propagates everywhere.

#### Bloc 2 — Deck Builder (#9 → #4 → #3)

- [x] **Task 2: Move header into right column on desktop** (#9)
  - File: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html`
  - Action: Restructure HTML — move header content (deck name input L4-6, cover images L7-12, action buttons L13-54) from `.deckBuilder-header` (L3-55) into `.deckBuilder-side` (L66-83), above the card-searcher. Group action buttons (save, print, export, import, hand test, simulator) into a `mat-menu` triggered by a single "..." icon button.
  - File: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss`
  - Action: Remove `.deckBuilder-header` full-width styles (L31-119). Add header styles inside `.deckBuilder-side` — vertical layout, deck name input full-width, action menu inline. On mobile (<768px): header stays in the slide-in side panel overlay. On desktop: header is at top of the fixed 300px right column.
  - File: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts`
  - Action: Add `MatMenu`, `MatMenuItem`, and `MatMenuTrigger` to standalone component imports (NOT `MatMenuModule` — Angular 19 standalone). The trigger button needs `[matMenuTriggerFor]="actionsMenu"` and the menu needs `<mat-menu #actionsMenu="matMenu">`.
  - Notes: **Must be completed before Task 3.** After this, the body section becomes a simple two-column layout: canvas (flex: 1) + side panel (300px) with no header row above. Verify that the mobile slide-in side panel still works correctly with the header content inside it.

- [x] **Task 3: Rework canvas dimensions for Master Duel 60/40 ratio** (#4)
  - File: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html`
  - Action: Adjust `[referenceWidth]` and `[aspectRatio]` on L60 `appScalingContainer`. Current: `referenceWidth="800"` `aspectRatio="0.9"` (800×889px). Target: wider canvas that fills ~60% of viewport, with a more landscape-friendly aspect ratio. Try `referenceWidth="1100"` `aspectRatio="1.4"` (~1100×786px) to better match Master Duel proportions.
  - File: `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.scss`
  - Action: Adjust main deck grid width at L15 — currently `calc($DECK_CARD_WIDTH * 10)` = 750px for 10 cards/row. With wider canvas, could increase to 12 cards/row or increase card size. Tune to fill the 60% allocation naturally.
  - File: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss`
  - Action: Adjust side panel width — currently 300px (L145). May need to reduce to ~250px or make proportional to give canvas more room. Adjust `.deckBuilder-canvasParent` if needed.
  - Notes: Reference `deckbuilder_masterduel.jpg` for target layout. The ScalingContainerDirective auto-scales, so the canvas will proportionally fill available space. **Calibration must be empirical:** complete Task 2 first, measure the actual parent container size in mobile landscape (accounting for 48px mobile top bar still present), then tune `referenceWidth` and `aspectRatio` to achieve readable card sizes at the resulting scale factor. The proposed values (1100/1.4) are starting estimates — iterate visually.

- [x] **Task 4: Add blocking portrait overlay on mobile** (#3)
  - File: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html`
  - Action: Add a new `<div class="deckBuilder-portraitOverlay">` with a rotate-device icon (use `mat-icon` with `screen_rotation`) and message text. Place it as a direct child of `.deckBuilder` root container.
  - File: `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss`
  - Action: Add `.deckBuilder-portraitOverlay` styles:
    - `display: none` by default
    - `@media (orientation: portrait) and (max-width: 768px)`: `display: flex`, `position: fixed`, `inset: 0`, `z-index: 2000`, `background: rgba(0,0,0,0.95)`, flex column centered, white text + icon
    - When overlay is visible, the content behind is blocked (no interaction)
  - Notes: No TS logic needed — pure CSS media query. The overlay auto-shows in portrait and auto-hides in landscape.

#### Bloc 3 — Card Search Filter Toggle (#5)

- [x] **Task 5: Add filter toggle button visible at all viewports** (#5)
  - File: `front/src/app/components/card-searcher/card-searcher.component.ts`
  - Action: Add a `filtersOpen` signal. Initialize based on viewport: `signal(window.innerWidth >= 768)` — open by default on desktop, closed on mobile. Add `toggleFilters()` method that calls `this.filtersOpen.update(v => !v)`.
  - File: `front/src/app/components/card-searcher/card-searcher.component.html`
  - Action: Add a `mat-icon-button` with `tune` icon next to the search bar (inside `.cardSearchPage-searcher-bar`, after `<search-bar>`). Bind `(click)="toggleFilters()"`. On the filter panel div (L36), add `[class.filters-open]="filtersOpen()"` and remove the `@if (!deckBuildMode())` condition — replace with `@if (!deckBuildMode()) { <div class="cardSearchPage-filters" [class.filters-open]="filtersOpen()">...</div> }`.
  - File: `front/src/app/components/card-searcher/card-searcher.component.scss`
  - Action:
    - Remove `display: none` at L82 (the `respond-below` rule)
    - Replace filter panel styles: default `display: none`, `.filters-open` → `display: block`
    - Searcher width: `width: 100%` by default, `.cardSearchPage.filters-visible .cardSearchPage-searcher { width: calc(100% - 300px) }` when filters open
    - Toggle button: style with `mat-icon-button`, position inline next to search bar
  - Notes: The `filtersOpen` signal drives everything. On desktop, initial state = open. On mobile, initial state = closed. User can toggle at any breakpoint.

#### Bloc 4 — Decklist (#1)

- [x] **Task 6: Reposition delete button as badge overlay on deckbox** (#1)
  - File: `front/src/app/pages/deck-page/components/deck-list/deck-list.component.scss`
  - Action: The delete button (`.deckPage-deck-remove`) is already `position: absolute` with `top: 4px; right: 4px` inside a `position: relative` parent. The visual issue is the parent `.deckPage-deck` uses `display: flex` but the deckbox takes `width: 100%`, pushing the absolute button visually outside on narrow screens. Fix: ensure the parent container constrains properly — remove `display: flex` from `.deckPage-deck` (L20), keep `position: relative`. The deckbox naturally fills the block container, and the absolute-positioned button overlays at top-right correctly.
  - Notes: Verify the button overlaps the deckbox corner cleanly at all breakpoints (375px, 576px, 768px+). The `z-index: 1010` on the button ensures it stays above the deckbox content.

#### Bloc 5 — Simulator (#8 → #6 → #7)

- [x] **Task 7: Add `touch-action: none` to simulator board** (#8)
  - File: `front/src/app/pages/simulator/board.component.scss`
  - Action: Add `touch-action: none;` inside `.board-container` rule (after L15 `overflow: hidden`).
  - Notes: Quick win — one line of CSS. CDK DragDrop docs recommend this for drag containers. Prevents browser from interpreting touch drags as scroll gestures. No conflict with CDK's own touch handlers.

- [x] **Task 8: Scale DEF position cards to fit zone** (#6)
  - File: `front/src/app/components/card/card.component.scss`
  - Action: Modify `.def-position` rule at L19-21. Current: `transform: rotate(90deg)`. Change to: `transform: rotate(90deg) scale(0.69)`. The scale factor 0.69 ≈ 59/86 (card width/height ratio) ensures a rotated card's visual width matches the original card width, fitting within the zone.
  - Notes: The `scale(0.69)` is a **tuning value** (approximation based on card aspect ratio 59/86). The exact value depends on zone padding. Test visually at multiple viewport sizes — if the card is slightly too large or too small, adjust the scale factor. The card should fill the zone height (now its visual width) without overflowing the zone width.

- [x] **Task 9: Fix hand fan layout** (#7)
  - File: `front/src/app/pages/simulator/hand.component.ts`
  - Action: Adjust fan constants at L26-28:
    - `FAN_SPACING`: increase from `36` to `50`–`55` (card width ~66px, spacing should be ~75-80% of card width for readable overlap)
    - `FAN_MAX_ANGLE`: keep at `4` or increase slightly to `6` for more visual fan spread
    - `FAN_MAX_ARC`: keep at `12` or increase to `16` for more pronounced arc
    - Verify z-index formula at L40: `n - Math.abs(Math.round(t * n))` — center cards should have highest z-index. Test with 5, 7, 10 cards in hand.
  - Notes: These are tuning values — exact numbers need visual iteration. Start with `FAN_SPACING=50`, test, adjust. The key constraint: all cards must fit within the hand container width without spilling out of the board.

### Acceptance Criteria

#### Bloc 1 — Navbar
- [ ] **AC-1**: Given a phone in portrait (375×667), when the page loads, then the mobile top bar (48px) is shown and the desktop sidebar is hidden.
- [ ] **AC-2**: Given a phone in landscape (667×375), when the page loads, then the mobile top bar (48px) with hamburger menu is shown and the desktop sidebar is hidden. Navigation is accessible via the burger menu.
- [ ] **AC-3**: Given a desktop browser (1920×1080), when the window is resized to 800×400, then the desktop sidebar remains visible (width > 1024px constraint not met, even though height < 500px).
- [ ] **AC-4**: Given a tablet in landscape (1024×768), when the page loads, then the desktop sidebar is shown (height > 500px).

#### Bloc 2 — Deck Builder
- [ ] **AC-5**: Given the deck builder on desktop (≥1024px), when the page loads, then the header (deck name + action menu) is in the right column above the card search, and the deck viewer fills the full left column height.
- [ ] **AC-6**: Given the deck builder on desktop, when the user clicks the "..." action menu, then all actions (save, print, export, import, hand test, simulator) are listed in a dropdown.
- [ ] **AC-7**: Given the deck builder on a phone in landscape, when the page loads, then the deck viewer takes ~60% width and the search panel ~40%, matching Master Duel proportions (see `deckbuilder_masterduel.jpg`).
- [ ] **AC-8**: Given the deck builder on a phone in portrait (≤768px), when the page loads, then a full-screen overlay with a rotate icon and message blocks all interaction.
- [ ] **AC-9**: Given the portrait overlay is shown, when the user rotates to landscape, then the overlay disappears and the deck builder is usable.
- [ ] **AC-9b**: Given the deck builder on mobile (<768px), when the user taps the search button, then the side panel slides in from the right with the header content (deck name, action menu) and card searcher, and the close button dismisses it.

#### Bloc 3 — Card Search
- [ ] **AC-10**: Given the card search page on desktop (≥768px), when the page loads, then the filter panel is open and a filter toggle button is visible next to the search bar.
- [ ] **AC-11**: Given the card search page on desktop with filters open, when the user clicks the filter toggle, then the filter panel closes and the search results expand to full width.
- [ ] **AC-12**: Given the card search page on mobile (<768px), when the page loads, then the filter panel is closed and the toggle button is visible.
- [ ] **AC-13**: Given the card search page on mobile with filters closed, when the user clicks the toggle, then the filter panel opens (300px sidebar or overlay).

#### Bloc 4 — Decklist
- [ ] **AC-14**: Given the decklist on mobile portrait (375px), when deckboxes with delete buttons are displayed, then each delete button overlays the top-right corner of its deckbox with no visual gap.
- [ ] **AC-15**: Given the decklist on desktop (1024px+), when deckboxes are displayed in a multi-column grid, then delete buttons still overlay correctly on each deckbox.

#### Bloc 5 — Simulator
- [ ] **AC-16**: Given the simulator on a touch device, when the user drags a card, then the page does not scroll.
- [ ] **AC-17**: Given a card in DEF position (rotated 90°), when displayed in a monster zone, then the card fits entirely within the zone boundaries without overflow.
- [ ] **AC-18**: Given 5+ cards in hand, when displayed in the fan layout, then cards are evenly spaced with readable overlap, center cards layered on top, and no cards spill outside the hand zone.

## Visual References

Screenshots at project root — read these images to understand current state and target:

| Screenshot | Shows | Task |
|-----------|-------|------|
| `decklist.PNG` | Delete buttons detached from deckboxes (portrait) | #1 |
| `deckbuilder_desktop.PNG` | Header wasting full width on desktop | #9 |
| `deckbuilder_skytrix.PNG` | Current mobile landscape layout (deck too small) | #4 |
| `deckbuilder_masterduel.jpg` | **TARGET** — Master Duel deck builder layout to emulate | #4 |
| `search_card.PNG` | Advanced filters missing in portrait | #5 |
| `search_card_landscape.PNG` | Filters permanently visible, not collapsible in landscape | #5 |
| `image.png` | Simulator bugs: DEF overflow, broken hand fan, drag scroll | #6, #7, #8 |

## Additional Context

### Dependencies

- No new dependencies required. All fixes use existing Angular Material, CDK, and SCSS infrastructure.

### Testing Strategy

- Manual visual testing at breakpoints: 375px, 576px, 768px, 1024px, 1440px (portrait + landscape on mobile)
- Simulator bugs (#6, #7): validate at ALL viewport sizes, not just breakpoints
- Big bang approach: no automated tests until full MVP

### Notes

- Priority order (refined via Party Mode rounds):
  - Bloc 1: #2 Navbar breakpoint (foundation, unblocks other fixes)
  - Bloc 2: #9 Header desktop → #4 Canvas Master Duel → #3 Overlay portrait (sequential dependency: #9 before #4)
  - Bloc 3: #5 Filter toggle (all viewports, open by default on desktop)
  - Bloc 4: #1 Delete badge (decklist)
  - Bloc 5: #8 touch-action → #6 DEF scale → #7 Hand layout (simulator render bugs)
- Party Mode insights:
  - Points #6/#7 are render bugs, not responsive issues — test at all viewports
  - Points #5/#6 (original) merged into single task #5 — one toggle, one component
  - #9 → #4 hard dependency: HTML restructuring before canvas dimension rework
  - Point #3: blocking overlay confirmed (not dismissible banner)

## Review Notes

- Adversarial review completed
- Findings: 16 total, 13 addressed, 3 skipped (pre-existing: ngModel signal mutation, @Input() decorator, ::ng-deep usage)
- Resolution approach: auto-fix all except F6 (portrait overlay escape hatch — spec-mandated blocking behavior)
- Key fixes applied: breakpoint 1px alignment, BreakpointObserver for filtersOpen, prefers-reduced-motion, aria-labels, aria-expanded, !important removal, fan spacing cap

---

## Bloc 6 — Deck Viewer Readability (Master Duel Style)

**Created:** 2026-02-15
**Status:** pending
**Depends on:** Bloc 2 (Tasks 2-4) must be complete

### Problem Statement

Despite the Bloc 2 fixes (header restructuring + canvas dimension rework), the deck viewer remains **unreadable** on typical laptop screens (1366×768). Root cause analysis:

1. **Scaling container compresses everything** — The `ScalingContainerDirective` on the deck builder canvas sets a reference canvas of 1100×786px, then applies `transform: scale()` to fit the parent. On a laptop (1366×768), available height after navbar (~48px) is ~720px. Scale = min(1106/1100, 720/786, 1) ≈ **0.92** (height-constrained). On smaller viewports or with browser chrome, scale drops further. Cards shrink from 75px to ~69px or less.
2. **Too many cards per row** — `deckViewer-part` width is `calc($DECK_CARD_WIDTH * 12)` = 900px, showing 12 cards per line. Even at scale 0.92, each card is ~69px wide — combined with the density, thumbnails are hard to distinguish.
3. **No vertical scroll** — The canvas is a fixed-height scaled element with `overflow: hidden`. All cards must fit in the visible area or they're clipped.

**Reference**: `deckbuilder_masterduel.jpg` — Master Duel shows ~5-6 cards per row, all clearly visible with recognizable artwork, and the deck scrolls vertically.

### Solution: Replace Canvas Scaling with Scrollable Native Layout

Remove the `ScalingContainerDirective` from the deck builder and replace it with a simple scrollable container where cards maintain their **native pixel size**. The deck viewer becomes vertically scrollable instead of shrink-to-fit.

### Design Decisions

- **Keep colors**: Orange (main deck), black (extra deck), grey (side deck) — unchanged for desktop coherence
- **Keep card pixel sizes**: `$DECK_CARD_WIDTH: 75px` / `$DECK_CARD_HEIGHT: 100px` for main deck, `$DECK_EXTRASIDE_CARD_WIDTH: 50px` / `$DECK_EXTRASIDE_CARD_HEIGHT: 66.5px` for extra/side — cards displayed at native resolution, no scaling
- **Fluid grid (auto-fill)**: Deck parts use `width: 100%` and cards wrap naturally via `flex-wrap: wrap`. Cards are 75px wide + 10px padding = ~85px per slot. Cards per row adapts to available width: ~11-12 on a 1366px laptop (1366 - 320 side - 32 padding ≈ 1014px), ~18 on a 1920px monitor (1920 - 320 - 32 ≈ 1568px). No fixed column count, no breakpoints. Cards always stay at native 75px width.
- **Vertical scroll**: The deck viewer (MAIN + EXTRA + SIDE stacked) scrolls inside its container. User scrolls to see the full deck rather than squinting at compressed thumbnails.
- **Side panel widened to 320px**: Current 260px causes the filter button (`filter_alt`) to be pushed off-screen because `.searchBar-input` uses `width: 100%` leaving no room for the adjacent button. At 320px: ~24px padding + 44px filter button + ~252px input = comfortable fit. Impact on deck viewer is minimal (~1 card/row less).
- **Note — mobile override**: Below `$bp-tablet` (768px), the side panel CSS already overrides to `width: 100%; min-width: 0` (fixed overlay). The 320px change only affects desktop. No mobile regression.

### Files to Modify

| File | Change | Why |
|------|--------|-----|
| `deck-builder.component.html` | Remove `appScalingContainer`, `[referenceWidth]`, `[aspectRatio]` from `.deckBuilder-canvas` div. Remove the wrapper div entirely — the viewer sits directly in `.deckBuilder-canvasParent` | Eliminate canvas scaling |
| `deck-builder.component.ts` | Remove `ScalingContainerDirective` from `imports` array (L44). Remove `import` statement (L25) | Clean up unused directive |
| `deck-builder.component.scss` | Replace `@include cs.canvas-parent` on `&-canvasParent` with `overflow-y: auto; flex: 1; min-height: 0;`. Remove `@use 'canvas-scaling' as cs;` import. Remove `&-canvas` and `&-canvas-viewer` rules | Switch from scaling to scrolling |
| `deck-viewer.component.scss` | Change `&-part` width from `calc($DECK_CARD_WIDTH * 12)` to `100%`. Remove fixed width — cards auto-fill the available space | Fluid grid: cards/row adapts to viewport |
| `deck-builder.component.scss` | Change side panel width from `260px` / `min-width: 260px` to `320px` / `min-width: 320px` | Fix filter button being pushed off-screen |
| `search-bar.component.scss` | Change `.searchBar-input` from `width: 100%` to `flex: 1; min-width: 0;` | Allow input to shrink and coexist with filter button in flex row |

### Implementation Plan

#### Task 10: Remove ScalingContainerDirective from deck builder

**File: `deck-builder.component.html`**
- Remove the `appScalingContainer` wrapper. Current structure:
  ```html
  <div class="deckBuilder-canvasParent">
    <button ...searchToggle... />
    <div class="deckBuilder-canvas" appScalingContainer [referenceWidth]="1100" [aspectRatio]="1.4">
      <div class="deckBuilder-canvas-viewer">
        <deck-viewer ...></deck-viewer>
      </div>
    </div>
  </div>
  ```
- Target structure:
  ```html
  <div class="deckBuilder-canvasParent">
    <button ...searchToggle... />
    <deck-viewer ...></deck-viewer>
  </div>
  ```

**File: `deck-builder.component.ts`**
- Remove L25: `import { ScalingContainerDirective } from '../../../../components/scaling-container/scaling-container.directive';`
- Remove L44: `ScalingContainerDirective,` from imports array

**File: `deck-builder.component.scss`**
- Remove: `@use 'canvas-scaling' as cs;` (L3)
- Replace `&-canvasParent` rule:
  ```scss
  // BEFORE
  &-canvasParent {
    @include cs.canvas-parent;
    flex: 1;
    min-height: 0;
  }
  // AFTER
  &-canvasParent {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1em;
  }
  ```
- Remove `&-canvas` and `&-canvas-viewer` rules entirely (L62-66)
- **F7 fix**: The first `.deckViewer-part` has `margin-top: 1em` which stacks with the new `padding: 1em` on `.deckBuilder-canvasParent`, creating 2em of space at the top. Add `&:first-child { margin-top: 0; }` inside `&-part` in `deck-viewer.component.scss` to eliminate the double spacing.

#### Task 11: Switch deck grid to fluid auto-fill layout

**File: `deck-viewer.component.scss`**
- Change L15:
  ```scss
  // BEFORE
  width: calc($DECK_CARD_WIDTH * 12);
  // AFTER
  width: 100%;
  ```
- The `deck-card-zone` component already uses `flex-wrap: wrap` with fixed-size card slots (`$DECK_CARD_WIDTH: 75px`). By removing the fixed container width, cards will naturally fill the available space — the browser determines how many fit per row based on the parent's width. No CSS grid or `auto-fill` needed; the existing flexbox + wrap handles it.
- **F1 caution — absolute overlay pattern**: `deck-card-zone` uses a two-layer layout: `.grid-list` (background slot grid, normal flow) and `.grid-list.element` (card layer, `position: absolute; inset: 0`). The absolute layer inherits dimensions from the slot grid. With `width: 100%`, if `slotNumber` differs from actual card count, the background grid may produce a different number of rows than the card layer. **Verify visually** that Main Deck (no fixed `slotNumber` — defaults to card count), Extra Deck (`slotNumber=15`), and Side Deck (`slotNumber=15`) all align correctly at the new fluid width. If misaligned, fix by ensuring the absolute layer also wraps cards at the same effective width as the slot grid.

#### Task 12: Widen side panel to 320px and fix search bar flex

**File: `deck-builder.component.scss`**
- Change side panel width:
  ```scss
  // BEFORE
  &-side {
    width: 260px;
    min-width: 260px;
  // AFTER
  &-side {
    width: 320px;
    min-width: 320px;
  ```

**File: `search-bar.component.scss`**
- Fix `.searchBar-input` to coexist with the filter button in a flex row:
  ```scss
  // BEFORE
  &-input {
    width: 100%;
  // AFTER
  &-input {
    flex: 1;
    min-width: 0;
  ```
- The `.searchBar` parent already has `display: flex`. Switching the input from `width: 100%` to `flex: 1` allows it to shrink and share space with the filter button. `min-width: 0` prevents flex items from overflowing.
- **F6 fix — badge clipping**: The filter badge (`.searchBar-input-filters-number`) is `position: absolute; top: 0; right: 0` with 21×21px size. The side panel has `overflow: hidden` which could clip the badge if the button is flush against the right edge. Fix: add `overflow: visible` on `.searchBar` to ensure the badge isn't clipped by the search bar container. The side panel's `overflow: hidden` does not clip because the badge stays within the padded content area (0.75em padding on `&-header`).

### Acceptance Criteria

- [ ] **AC-20**: Given the deck builder on a laptop (1366×768), when a deck with 40+ main deck cards is loaded, then cards are displayed at native 75×100px size and the deck viewer scrolls vertically to show all cards. Cards per row adapts to available width (~11-12 cards at 1366px with 320px side panel).
- [ ] **AC-21**: Given the deck builder on a large monitor (1920×1080), when a deck is loaded, then more cards fit per row (~18) and the artwork remains at native 75px width — no upscaling, no downscaling.
- [ ] **AC-22**: Given the deck builder on desktop, when looking at main deck cards, then the artwork is clearly visible and recognizable without zooming (card width = 75px rendered, always).
- [ ] **AC-23**: Given the deck builder on desktop, when the Extra Deck section overflows below the viewport, then the user can scroll down to see it.
- [ ] **AC-24**: Given the deck builder on desktop, the orange (main), black (extra), and grey (side) background colors are preserved.
- [ ] **AC-25**: Given the deck builder on mobile landscape, when the page loads, the portrait overlay still functions correctly (Bloc 2 AC-8/AC-9 unaffected).
- [ ] **AC-26**: Given the deck builder, when drag-and-drop is used between deck zones or from search results, then CDK DragDrop still works correctly without the scaling container (no coordinate offset issues).
- [ ] **AC-27**: Given the deck builder side panel on desktop, the search bar input and filter button (`filter_alt`) are both fully visible on the same row without overflow or clipping.
- [ ] **AC-28**: Given the deck builder side panel at 320px, when the filter button badge shows active filter count, the badge is fully visible and not cut off.
- [ ] **AC-29**: Given the deck builder on desktop, the first deck section (MAIN) has no double spacing at the top (no margin + padding stacking).

### Bloc 6 Review Notes

- Adversarial review completed: 11 findings, 7 addressed, 2 skipped (F4: pre-existing `@import` — out of scope, F8: empty deck visual — MVP acceptable), 2 acceptable as-is (F2: CDK DragDrop covered by AC-26, F5: mat-form-field flex — verify visually)
- Key fixes applied: F1 (absolute overlay caution note), F3 (mobile override note), F6 (badge `overflow: visible`), F7 (`first-child margin-top: 0`), F9 (corrected scale math), F10 (front matter `files_to_modify`), F11 (recalculated cards/row estimates in ACs and design decisions)

---

## Bloc 7 — Deck Viewer Fluid Card Grid (Master Duel Desktop+Mobile)

**Created:** 2026-02-15
**Status:** pending
**Depends on:** Bloc 6 (Tasks 10-12) must be complete
**Supersedes:** Bloc 6 design decisions on card sizing, background colors, and grid strategy

### Problem Statement

After Bloc 6 (canvas scaling removed, scrollable layout), three layout issues remain:

1. **Gap résiduel** — Flexbox with fixed card sizes (75px) creates an uneven gap at the end of each row. The container width is rarely an exact multiple of card width + padding.
2. **Visible empty space** — Solid background colors (orange `#ff8800`, black `rgb(0,0,0)`, grey `rgb(141,141,141)`) make the gap and partial rows highly visible, unlike Master Duel where dark uniform backgrounds hide them.
3. **Inconsistent card sizes** — Extra/Side cards (50×66.5px) are smaller than Main Deck cards (75×100px). A `::ng-deep` override in `deck-viewer.component.scss` forces uniform size but is fragile.

**Reference analysis** — Master Duel handles this by:
- **Desktop** (`deckbuilder_masterduel_desktop.png`): ~10 cards/row, full-width grid, dark uniform background, no slots
- **Mobile** (`deckbuilder_masterduel.jpg`): ~5 cards/row, same principle, scrollable

### Solution: Fixed-Column CSS Grid with Responsive Cards

Replace flexbox + fixed-pixel cards with CSS Grid using a **fixed column count** (10 or 5) where cards fill their grid cells responsively.

```
Container (100% width)
├── CSS Grid: repeat(10, 1fr)    ← desktop (≥1024px)
├── CSS Grid: repeat(5, 1fr)     ← tablet/mobile (<1024px)
└── Cards: width 100% + aspect-ratio 59/86 (from app-card :host)
```

Cards stretch to fill each `1fr` cell — **zero gap by construction**. Column count is fixed per breakpoint, not computed via `auto-fill`.

### Design Decisions

- **Fixed column count, not `auto-fill`**: `repeat(10, 1fr)` on desktop, `repeat(5, 1fr)` on smaller screens. Avoids arbitrary column counts (7, 8, 12...) and guarantees visual harmony across Main/Extra/Side zones since all standard deck sizes are multiples of 5.
- **Why multiples of 5**: Extra Deck (max 15) = 3 full rows at 5 cols, 1.5 rows at 10 cols. Side Deck (max 15) = same. Main Deck (40-60) = 4-6 full rows at 10 cols, 8-12 at 5 cols. All zones align cleanly.
- **Remove zone background colors, header becomes separator**: Zone backgrounds (orange/black/grey) removed. Headers become Master Duel-style separator bars: semi-transparent dark background (`rgba(0,0,0,0.3)`), full width, acting as visual dividers between zones. Empty space in partial rows is invisible against the page background.
- **Empty zone placeholder**: When a zone has 0 cards, a `min-height` of one card row is applied with a dashed border, providing a visible drop target for CDK DragDrop. Disappears as soon as the first card is added.
- **Responsive card sizing via `app-card`**: Cards use `width: 100%` of their grid cell + `aspect-ratio: 59/86` (already on `app-card :host`). No fixed pixel dimensions needed. Card size adapts to container width automatically.
- **Breakpoint 10→5 at `$bp-desktop-sm` (1024px)**: `respond-above($bp-desktop-sm)` generates `@media (min-width: 1024px)`. At ≥1024px: 10 cols. Below 1024px: 5 cols. With 320px side panel — at 1024px viewport: container ≈ 660px → 10 cols × 66px/card (lower readability bound). At 1366px: container ≈ 1000px → 10 cols × 100px/card. Below 1024px: container varies → 5 cols (large comfortable cards).
- **No empty slots in deck viewer**: Already implemented in Bloc 6 — `deck-card-zone` hides background slot grid when `deckZone()` is set.
- **`app-card` unchanged**: Already has `:host { width: 100%; height: 100%; aspect-ratio: 59/86; }`. Fills its parent naturally. **Note (F5 risk)**: `height: 100%` in CSS Grid auto-height rows creates a circular dependency resolved via `aspect-ratio` fallback. Works in all modern browsers but is not explicitly standardized. Verify visually in Chrome, Firefox, Safari.
- **Simulator not impacted**: Separate components with own sizing. Hand card bug tracked in `bug-simulator-hand-card-sizing.md`.

### Files to Modify

| File | Change | Why |
|------|--------|-----|
| `components/deck-card-zone/deck-card-zone.component.scss` | Replace flexbox with CSS Grid. Remove fixed pixel card sizes for deck zones. Keep flexbox for cover image mode. | Core layout change |
| `deck-builder/components/deck-viewer/deck-viewer.component.scss` | Remove background colors, borders, `fit-content`, `::ng-deep` size override. Set `width: 100%`. | Clean zone styling |
| `styles/variable.scss` | Remove `$DECK_EXTRASIDE_CARD_WIDTH` and `$DECK_EXTRASIDE_CARD_HEIGHT` if unused after changes | Clean up |

### Implementation Plan

#### Task 13: Convert deck-card-zone to CSS Grid with fixed columns

**File: `deck-card-zone.component.scss`**

Current state — flexbox with fixed pixel card sizes:
```scss
.grid-list {
  display: flex;
  flex-wrap: wrap;

  &-slot {
    height: $DECK_CARD_HEIGHT;      // 100px
    width: $DECK_CARD_WIDTH;        // 75px
    padding: 5px;

    &.extraDeck, &.sideDeck {
      height: $DECK_EXTRASIDE_CARD_HEIGHT;  // 66.5px
      width: $DECK_EXTRASIDE_CARD_WIDTH;    // 50px
      padding: 2px;
    }
  }
}
```

Target — CSS Grid with responsive `1fr` cells:
```scss
@use '../../styles/variable' as *;
@use '../../styles/responsive' as r;

.grid {
  display: flex;
  flex-wrap: wrap;
  position: relative;
  align-content: flex-start;
  justify-content: flex-start;

  &-list {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    width: 100%;

    @include r.respond-above(r.$bp-desktop-sm) {
      grid-template-columns: repeat(10, 1fr);
    }

    // Cover image mode: both layers keep flexbox
    &.element {
      display: flex;
      flex-wrap: wrap;
      position: absolute;
      top: 0; bottom: 0; left: 0; right: 0;
    }

    // F2 fix: background slot grid (cover images, no deckZone) must stay flexbox
    // When !deckZone(), this .grid-list has no zone class and no .element class
    // Selector: .grid-list that contains .grid-list-slot.grid children (background slots)
    &:has(> .grid-list-slot.grid) {
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      justify-content: flex-start;
    }

    &-slot {
      box-sizing: border-box;

      &.card {
        position: relative;
        padding: 3px;

        app-card {
          --card-border-radius: 2px;
          --card-shadow: none;
        }
      }

      // Background slot grid (cover images only): keep fixed sizes
      &.grid {
        position: relative;
        border: $white solid 1px;
        background-color: rgba(255, 255, 255, 0.3);
        height: $DECK_CARD_HEIGHT;
        width: $DECK_CARD_WIDTH;
      }
    }
  }
}
```

Key changes:
- `.grid-list` switches from `display: flex` to `display: grid` with `repeat(5, 1fr)` / `repeat(10, 1fr)`
- Fixed pixel dimensions (`width`, `height`) removed from `.grid-list-slot` — grid `1fr` cells + `app-card` `aspect-ratio` handle sizing
- `.extraDeck` / `.sideDeck` size overrides removed — all deck zones use the same uniform grid cells
- `.element` (cover image absolute layer) keeps `display: flex` — unchanged
- **F2 fix**: `.grid-list:has(> .grid-list-slot.grid)` overrides back to flexbox for the background slot grid (cover images). This targets the `.grid-list` that contains `.grid` slots (only exists when `!deckZone()`)
- `.grid` (background slot for cover images) keeps fixed pixel sizes — unchanged
- **F6 fix**: `.remove` class removed (dead code — never referenced in any template)
- **F7+F11**: Default `border: transparent 1px` and `padding: 5px` removed from `.grid-list-slot` — cover image slots are already overridden in `deck-builder.component.scss` (`width: 30px; height: 44px; padding: 1px`)
- **F8 fix**: Both `@use 'variable'` and `@use 'responsive'` imports preserved

#### Task 14: Remove deck zone backgrounds and size overrides

**File: `deck-viewer.component.scss`**

Current state:
```scss
&-part {
  margin-top: 1em;
  background-color: #ff8800;
  width: fit-content;
  max-width: 100%;
  &:first-child { margin-top: 0; }
  border: 1px solid $white;
  border-radius: 4px;
  position: relative;

  // header styles...

  ::ng-deep .grid-list-slot.extraDeck,
  ::ng-deep .grid-list-slot.sideDeck { ... }

  &.extra { background-color: rgb(0, 0, 0); }
  &.side { background-color: rgb(141, 141, 141); }
}
```

Target:
```scss
&-part {
  margin-top: 1em;
  width: 100%;

  &:first-child { margin-top: 0; }

  // F4 fix: Header as Master Duel-style separator bar
  &-header {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.25em 0.5em;
    font-weight: bold;
    font-size: 0.85em;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 2px;

    &-count {
      margin-left: auto;
      background: $green;
      color: $white;
      border-radius: 4px;
      padding: 0 0.4em;
      font-size: 0.9em;

      &.illegal {
        background: $red;
      }
    }
  }

  // F3 fix: Empty zone placeholder (visible drop target)
  deck-card-zone:has(.grid-list:empty),
  deck-card-zone:has(.grid-list > :empty:only-child) {
    display: block;
    min-height: 60px;
    border: 1px dashed rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
}
```

Removals:
- `background-color: #ff8800` and `&.extra` / `&.side` color rules
- `width: fit-content; max-width: 100%` → replaced by `width: 100%`
- `border: 1px solid $white; border-radius: 4px` (on `&-part` — replaced by header background)
- `position: relative` (no longer needed)
- `::ng-deep .grid-list-slot.extraDeck/.sideDeck` size override block

**Note on F3 empty zone selector**: The `:has(.grid-list:empty)` selector may not match if the grid-list always renders (even with 0 cards). If so, the empty state should be driven by a `[class.empty]` binding on `deck-card-zone` based on `cardDetails().length === 0`. Verify during implementation and adjust selector accordingly — the visual style (dashed border + min-height) is the same either way.

#### Task 15: Clean up unused SCSS variables

**File: `variable.scss`**

After Tasks 13-14, verify references:
- `$DECK_EXTRASIDE_CARD_WIDTH` / `$DECK_EXTRASIDE_CARD_HEIGHT`: only used in `deck-card-zone.component.scss` for `.extraDeck/.sideDeck` sizing → **remove** if Task 13 eliminates all references
- `$DECK_CARD_WIDTH` / `$DECK_CARD_HEIGHT`: still used by `.grid-list-slot.grid` (cover image background slots) → **keep**

### Acceptance Criteria

- [ ] **AC-30**: Given the deck builder on desktop (≥1024px), when a deck is loaded, then Main/Extra/Side zones each display **10 cards per row**. Cards fill their column width edge-to-edge with no gap between filled cells.
- [ ] **AC-31**: Given the deck builder below 1024px (tablet landscape), when a deck is loaded, then zones display **5 cards per row**.
- [ ] **AC-32**: Given a 1920px monitor, when a deck with 40 Main Deck cards is loaded, then Main Deck shows **4 full rows of 10** with no partial rows.
- [ ] **AC-33**: Given the deck builder, Extra and Side deck cards are **the same visual size** as Main Deck cards (uniform grid cells).
- [ ] **AC-34**: Deck zones have **no colored backgrounds** (orange, black, grey). Zone headers are semi-transparent dark separator bars (Master Duel style).
- [ ] **AC-35**: Resizing the browser across the 1024px threshold switches column count smoothly between 5 and 10.
- [ ] **AC-36**: CDK DragDrop between zones and from search results still works correctly with the CSS Grid layout.
- [ ] **AC-37**: Cover image display in the side panel header (no `deckZone`) is **unchanged** — background slot grid with fixed-size cards is not affected by the CSS Grid changes.
- [ ] **AC-38**: A deck with 15 Extra Deck cards at 10 cols shows 1 full row (10) + 1 partial row (5 cards). Empty cells are invisible (no background).
- [ ] **AC-39**: Given an empty deck zone (0 cards), a dashed-border placeholder with min-height is visible as a drop target. The placeholder disappears when the first card is added.
- [ ] **AC-40**: Visual verification in Chrome, Firefox, and Safari that card aspect ratio renders correctly in CSS Grid `1fr` cells (cross-browser `height: 100%` + `aspect-ratio` interaction).

### Impact Analysis

| Component | Impacted? | Notes |
|-----------|-----------|-------|
| `deck-card-zone` | **Yes** | Flexbox → CSS Grid for deck zones. Cover image mode unchanged |
| `deck-viewer` | **Yes** | Remove backgrounds, borders, size overrides |
| `app-card` | **No** | Already responsive |
| `card-list` (search) | **No** | Separate component, own layout |
| `hand-test` | **No** | Fixed-width cards, centered row |
| Simulator | **No** | Separate components, own sizing |

### Bloc 7 Design Rationale

**Why not `auto-fill` + `minmax()`?**
`repeat(auto-fill, minmax(70px, 1fr))` produces arbitrary column counts (7, 8, 9...) depending on container width. This breaks visual harmony between Main/Extra/Side zones. Fixed multiples of 5 guarantee clean alignment.

**Why not `fit-content` + flexbox?**
Flexbox with fixed card sizes always produces a gap when container width isn't an exact multiple of card width. CSS Grid with `1fr` eliminates this by construction.

**Why remove backgrounds?**
With full-width grid, colored backgrounds fill the entire container — making empty cells in partial rows visible as colored blocks. Removing backgrounds follows Master Duel's approach where the header separator bar alone distinguishes zones.

### Bloc 7 Review Notes

- Adversarial review completed: 11 findings, all addressed
- **F1** (breakpoint off-by-one): Fixed — spec text aligned to `min-width: 1024px` (mixin actual behavior)
- **F2** (background slot grid broken): Fixed — added `:has(> .grid-list-slot.grid)` flexbox override in target SCSS
- **F3** (empty zone no drop target): Fixed — added dashed-border placeholder with `min-height`, AC-39 added
- **F4** (header loses context): Fixed — header restyled as Master Duel separator bar (`rgba(0,0,0,0.3)` background)
- **F5** (`height: 100%` in grid): Accepted with risk note — added cross-browser verification note in design decisions and AC-40
- **F6** (`.remove` dead code): Confirmed dead code (no HTML reference) — removed from target
- **F7+F11** (default border/padding removed): Accepted — cover image slots already overridden in `deck-builder.component.scss`
- **F8** (missing `@use variable`): Fixed — both imports preserved in target SCSS
- **F9** (AC-30 wording): Fixed — "edge-to-edge with no gap between filled cells"
- **F10** (front matter): Fixed — `deck-card-zone.component.scss` and `variable.scss` added
