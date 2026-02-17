# Story 9.9: Simulator Board Bottom, Inspector Top & Zone Labels

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the simulator board anchored at the bottom of the viewport on mobile portrait with the card inspector at the top and labels on empty zones,
So that the board is thumb-friendly, card details are at eye level, and I can identify zones without cards.

## Acceptance Criteria

1. **Given** the board is currently anchored at the top on mobile portrait
   **When** the layout is updated
   **Then** `transform-origin` changes to `bottom center` on mobile portrait, anchoring the board at the bottom
   **And** the hand zone is at the bottom edge of the viewport for thumb interaction

2. **Given** the card inspector currently supports `position: 'left' | 'right'`
   **When** mobile portrait is detected
   **Then** a `'top'` position option is added and used, displaying the inspector as a floating overlay at the top of the viewport
   **And** the inspector does not cover Extra Monster zones

3. **Given** zone labels were previously removed due to CDK drag bugs
   **When** labels are reimplemented on empty zones
   **Then** labels display zone names (GY, Banish, ED, Deck, Field, etc.) in `var(--text-secondary)` at ~0.65rem
   **And** labels disappear when a card is placed in the zone
   **And** `pointer-events: none` + low z-index prevent CDK drag interference

4. **Given** the layout changes are applied
   **When** drag & drop operations are tested on mobile portrait
   **Then** all drag operations work correctly with no regression from label or layout changes

## Tasks / Subtasks

- [x] Task 1: Add `shortLabel` to ZONE_CONFIG (AC: #3)
  - [x] 1.1: In `simulator.models.ts`, extend the ZONE_CONFIG type to include `shortLabel: string` in the Record value type (line 50)
  - [x] 1.2: Add short labels to all 18 zone entries:
    - `HAND: 'Hand'` (not rendered — hand component is separate)
    - `MONSTER_1`–`MONSTER_5`: `'M1'`–`'M5'`
    - `SPELL_TRAP_1`–`SPELL_TRAP_5`: `'ST1'`–`'ST5'`
    - `EXTRA_MONSTER_L`: `'EMZ'`, `EXTRA_MONSTER_R`: `'EMZ'`
    - `FIELD_SPELL`: `'Field'`
    - `MAIN_DECK`: `'Deck'`, `EXTRA_DECK`: `'ED'`
    - `GRAVEYARD`: `'GY'`, `BANISH`: `'Banish'`

- [x] Task 2: Add zone labels to `zone.component` template (AC: #3)
  - [x] 2.1: In `zone.component.html`, after the `@if (card(); as c) { ... }` block and before the context menu block, add:
    ```html
    @if (!card()) {
      <span class="zone-label">{{ zoneConfig().shortLabel }}</span>
    }
    ```
  - [x] 2.2: In `zone.component.scss`, add `pointer-events: none;` to the existing `.zone-label` rule (line ~29)
  - [x] 2.3: Verify that the existing `.zone-label` style uses `color: var(--text-secondary)` and `font-size: 0.75rem` — no changes needed unless aligning to 0.65rem per spec (optional, 0.75rem is acceptable)

- [x] Task 3: Add zone labels to `stacked-zone.component` template (AC: #3)
  - [x] 3.1: In `stacked-zone.component.html`, after the `@if (topCard(); as card) { ... }` block and before the deck context menu block, add:
    ```html
    @if (!topCard()) {
      <span class="zone-label">{{ zoneConfig().shortLabel }}</span>
    }
    ```
  - [x] 3.2: In `stacked-zone.component.scss`, add `pointer-events: none;` to the existing `.zone-label` rule (line ~32)
  - [x] 3.3: Ensure stacked-zone has a `zoneConfig` computed (check if it already exists, if not, add `readonly zoneConfig = computed(() => ZONE_CONFIG[this.zoneId()]);` matching the pattern from zone.component.ts line 30)

- [x] Task 4: Add `isMobilePortrait` signal to `NavbarCollapseService` (AC: #1, #2)
  - [x] 4.1: In `navbar-collapse.service.ts`, add a new signal:
    ```typescript
    readonly isMobilePortrait = toSignal(
      this.breakpointObserver
        .observe(['(max-width: 767px) and (orientation: portrait)'])
        .pipe(map(result => result.matches)),
      { initialValue: false }
    );
    ```
  - [x] 4.2: Place it right after the existing `isMobile` signal (line ~18) — same pattern, same imports

- [x] Task 5: Board anchored at bottom on mobile portrait — CSS only (AC: #1)
  - [x] 5.1: In `board.component.scss`, add at the end of the file:
    ```scss
    @media (max-width: 767px) and (orientation: portrait) {
      .board-container {
        align-items: flex-end;
      }

      .sim-board {
        transform-origin: bottom center;
      }
    }
    ```
  - [x] 5.2: Verify default desktop/landscape layout is NOT affected: `.board-container` stays `align-items: flex-start` and `.sim-board` stays `transform-origin: top center`

- [x] Task 6: Card inspector `position: 'top'` support (AC: #2)
  - [x] 6.1: In `card-inspector.component.ts`, change the `position` input type from `'left' | 'right'` to `'left' | 'right' | 'top'` (line 27)
  - [x] 6.2: Add host class binding: `'[class.position-top]': "position() === 'top'"` in the `host` object (after line 20, the `position-right` binding)
  - [x] 6.3: In `card-inspector.component.scss`, add `.position-top` rules inside `:host.mode-dismissable`:
    ```scss
    &.position-top {
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-height: 50%;
    }
    ```
  - [x] 6.4: In the mobile media query (`@media (max-width: 768px)`), add `.position-top` override to ensure it uses the same centering but does NOT override max-height:
    ```scss
    &.position-top {
      // Already centered via .position-top rules above
      // Ensure max-height constraint is preserved
      max-height: 50%;
    }
    ```
  - [x] 6.5: In `.inspector-image` mobile rule (line 169), ensure `position-top` images also shrink to 60px (already covered by the `:host.mode-dismissable .inspector-image` selector)

- [x] Task 7: Board component returns `'top'` on mobile portrait (AC: #2)
  - [x] 7.1: In `board.component.ts`, the `navbarCollapse` service is already injected (line 30). Use its new `isMobilePortrait` signal.
  - [x] 7.2: Change the `inspectorPosition` computed (line 53) from:
    ```typescript
    readonly inspectorPosition = computed<'left' | 'right'>(() => 'left');
    ```
    to:
    ```typescript
    readonly inspectorPosition = computed<'left' | 'right' | 'top'>(() =>
      this.navbarCollapse.isMobilePortrait() ? 'top' : 'left'
    );
    ```
  - [x] 7.3: Update the `recalculateScale` effect to also react to `isMobilePortrait()` changes (add `this.navbarCollapse.isMobilePortrait();` as a tracked signal read inside the effect body, line ~62) — this ensures the board re-renders when orientation changes

- [x] Task 8: Verify zero regression (AC: #4)
  - [x] 8.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings are expected)
  - [ ] 8.2: Verify desktop layout: board centered at top, inspector on left, no zone labels (unless zones are empty)
  - [ ] 8.3: Verify mobile portrait: board anchored at bottom, hand at bottom edge, inspector at top when card selected
  - [ ] 8.4: Verify zone labels appear on all empty zones with correct short labels
  - [ ] 8.5: Verify zone labels disappear when a card is placed in the zone
  - [ ] 8.6: Verify drag & drop from hand to zones works correctly on mobile portrait
  - [ ] 8.7: Verify drag & drop between zones works with labels present (no interference)
  - [ ] 8.8: Verify inspector does not cover Extra Monster zones on mobile portrait
  - [ ] 8.9: Verify mobile landscape layout is NOT affected (board stays `transform-origin: top center`)
  - [ ] 8.10: Verify desktop with narrow viewport is NOT affected by portrait media query

## Dev Notes

### Why This Story Exists

This is story 9 of Epic 9 (UI/UX Modernization). On mobile portrait, the simulator currently has two UX problems: (1) the board is anchored at the top, leaving dead space below and making the hand zone — the most interactive area — hard to reach with thumbs; (2) empty zones have no visual identification, making it hard for players to know where to drop cards. The Screen Implementation Guide identified these as high-priority issues.

Additionally, the card inspector currently only supports left/right positioning. On mobile portrait with the board at the bottom, the inspector should float at the top of the viewport (eye level) rather than overlapping the board.

### What This Story Does

- Adds `shortLabel` to ZONE_CONFIG for all 18 zones (abbreviated zone names for labels)
- Renders zone labels on empty zones in both `zone.component` and `stacked-zone.component` templates
- Adds `pointer-events: none` to zone labels to prevent CDK drag interference
- Adds mobile portrait media query to anchor the board at the bottom (`transform-origin: bottom center`, `align-items: flex-end`)
- Adds `isMobilePortrait` signal to `NavbarCollapseService` using CDK BreakpointObserver
- Extends `CardInspectorComponent` with a `'top'` position option (type + host class + SCSS)
- Changes `board.component.ts` `inspectorPosition` computed to return `'top'` on mobile portrait

### What This Story Does NOT Do

- Does NOT modify the board grid structure (7x4 grid with named areas remains invariant)
- Does NOT change the board scaling calculation (`recalculateScale()` logic remains the same; only tracked signals updated)
- Does NOT add labels to the hand zone (hand is rendered by `SimHandComponent`, not by `SimZoneComponent`)
- Does NOT modify the control bar position or behavior (story 9-11 handles landscape immersive mode)
- Does NOT modify the XYZ material peek positioning (story 9-10 handles that)
- Does NOT hide the mobile top bar (story 9-11 handles landscape immersive mode)
- Does NOT add a back/exit button to the control bar (story 9-11)
- Does NOT modify any token values or `_tokens.scss` / `_sim-tokens.scss`
- Does NOT modify the `SimHandComponent` template or SCSS
- Does NOT modify pile overlay positioning
- Does NOT change card inspector content/template (only position input type and SCSS)

### Current Board Scaling Mechanism

The board has fixed internal dimensions (1060x772) and scales via `transform: scale()`. The scale factor is computed dynamically:

```typescript
// board.component.ts
private recalculateScale(): void {
  const isMobile = this.navbarCollapse.isMobile();
  const availableWidth = isMobile ? window.innerWidth : window.innerWidth - this.navbarCollapse.navbarWidth();
  const availableHeight = isMobile ? window.innerHeight - NavbarCollapseService.MOBILE_HEADER_HEIGHT : window.innerHeight;
  this.scaleFactor.set(Math.min(availableWidth / 1060, availableHeight / 772, 1));
}
```

On a typical mobile portrait (375x812): `scale = min(375/1060, 764/772, 1) = 0.354`. The board shrinks to ~273px tall. With `transform-origin: bottom center` + `align-items: flex-end`, the board anchors at the bottom with ~491px of empty space above — perfect for the inspector overlay.

### The `transform-origin` Change

**Current behavior:** `transform-origin: top center` + `align-items: flex-start` — board is at the top, scaled down, with dead space below.

**After this story (mobile portrait only):** `transform-origin: bottom center` + `align-items: flex-end` — board is at the bottom, scaled down, with empty space above.

**Why both properties:** `transform-origin` controls the anchor point for the `scale()` transform. `align-items` controls where the flex child (the board) sits within the container. Both must change together:
- `transform-origin: bottom center` ensures the board scales from the bottom edge
- `align-items: flex-end` ensures the board's bottom edge is at the container's bottom edge

### Inspector Position Strategy

The `CardInspectorComponent` uses `position: absolute` within the `.board-container`. On desktop, it's at `top: 8px; left: 8px`. On mobile (current), it's centered at `top: 8px; left: 50%; transform: translateX(-50%); width: 90%`.

For `position: 'top'` (mobile portrait), the styling is similar to the current mobile behavior but explicitly constrained to not cover EMZ zones:
- `max-height: 50%` ensures the inspector uses at most the top half of the container
- On a 375x812 device, 50% = ~382px — EMZ row starts at ~491px from top, leaving ~109px gap
- The inspector content (card image 60px + name + stats + truncated description) is typically 200-300px

The `position-top` class is additive to the existing `mode-dismissable` base styles.

### Zone Labels: CSS Already Exists

**Critical finding:** Both `zone.component.scss` and `stacked-zone.component.scss` ALREADY define `.zone-label` CSS rules:

```scss
// zone.component.scss (lines 26-33)
.zone-label {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  text-align: center;
  user-select: none;
}
```

The `.zone-label` in `zone.component.scss` also has a hide-on-receiving rule (lines 46-50):
```scss
.sim-zone.cdk-drop-list-receiving:not(.cdk-drop-list-dragging) {
  .zone-label { display: none; }
}
```

**What's missing:**
1. The HTML template conditional to render labels (both components)
2. `pointer-events: none` on `.zone-label` (both components)
3. `shortLabel` in ZONE_CONFIG (currently only verbose `label` exists)

### ZONE_CONFIG Short Labels

Current `ZONE_CONFIG` has verbose labels (e.g., "Monster Zone 1", "Spell/Trap Zone 2"). For zone labels on the board, abbreviated versions are needed:

| ZoneId | Current `label` | New `shortLabel` |
|--------|----------------|-----------------|
| HAND | Hand | Hand |
| MONSTER_1–5 | Monster Zone 1–5 | M1–M5 |
| SPELL_TRAP_1 | Spell/Trap Zone 1 | ST1 |
| SPELL_TRAP_2–4 | Spell/Trap Zone 2–4 | ST2–ST4 |
| SPELL_TRAP_5 | Spell/Trap Zone 5 | ST5 |
| EXTRA_MONSTER_L | Extra Monster Zone Left | EMZ |
| EXTRA_MONSTER_R | Extra Monster Zone Right | EMZ |
| FIELD_SPELL | Field Spell Zone | Field |
| MAIN_DECK | Main Deck | Deck |
| EXTRA_DECK | Extra Deck | ED |
| GRAVEYARD | Graveyard | GY |
| BANISH | Banished | Banish |

Note: ST1/ST5 also serve as Pendulum L/R zones. Pendulum labels ("P-L", "P-R") are already rendered separately by the existing `pendulum-label` class in `zone.component`. The `shortLabel` here is the primary zone label.

### CDK Drag Interference Prevention

Zone labels must NOT interfere with CDK drag-and-drop operations. Two mechanisms ensure this:

1. **`pointer-events: none`** on `.zone-label` — the label never captures mouse/touch events; events pass through to the underlying `.sim-zone` (which is the `cdkDropList`)
2. **Conditional rendering** — `@if (!card())` / `@if (!topCard())` means the label is completely removed from the DOM when a card is present, so there's zero chance of interference during drag operations on occupied zones
3. **Hide on receiving** — the existing rule `.sim-zone.cdk-drop-list-receiving .zone-label { display: none }` hides the label when a card is being dragged over the zone

### `isMobilePortrait` Signal

Added to `NavbarCollapseService` to reuse across stories 9-9, 9-10, 9-11. Uses the same pattern as the existing `isMobile` signal:

```typescript
readonly isMobilePortrait = toSignal(
  this.breakpointObserver
    .observe(['(max-width: 767px) and (orientation: portrait)'])
    .pipe(map(result => result.matches)),
  { initialValue: false }
);
```

This matches the CSS media query `@media (max-width: 767px) and (orientation: portrait)` used in `board.component.scss`. The 767px threshold is consistent with `$navbar-breakpoint: 768px` in `_responsive.scss` (mobile = below 768px).

### Mobile Portrait vs Mobile Landscape

This story ONLY affects mobile portrait. Mobile landscape is NOT modified:

| Behavior | Desktop | Mobile Portrait (NEW) | Mobile Landscape (unchanged) |
|----------|---------|----------------------|------------------------------|
| Board origin | `top center` | `bottom center` | `top center` |
| Board align | `flex-start` | `flex-end` | `flex-start` |
| Inspector | Left panel | Top overlay | Left panel |
| Zone labels | Visible on empty | Visible on empty | Visible on empty |

Zone labels are always visible on empty zones regardless of viewport — they're not mobile-specific.

### Stacked Zone `zoneConfig` Computed

Check if `stacked-zone.component.ts` already has a `zoneConfig` computed. If it does, use its `.shortLabel`. If it doesn't, add one matching the pattern from `zone.component.ts`:

```typescript
readonly zoneConfig = computed(() => ZONE_CONFIG[this.zoneId()]);
```

The import `ZONE_CONFIG` from `'./simulator.models'` is likely already present (check the existing imports).

### Board Scale Recalculation on Orientation Change

When the device orientation changes (portrait → landscape or vice versa), the board needs to recalculate its scale factor. The existing `@HostListener('window:resize')` handles viewport dimension changes. However, orientation changes on mobile may fire `orientationchange` event without always triggering `resize`. The `isMobilePortrait()` signal (from BreakpointObserver) is reactive and handles this correctly — adding it as a tracked read in the `effect()` ensures the board recalculates.

### Token Values Reference (from _tokens.scss / simulator :host)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--text-secondary` | `#94a3b8` (simulator override) | Zone label text color |
| `--surface-base` | `#0a0e1a` (simulator override) | Board container background |
| `--sim-surface` | `#111827` | Zone background (no change) |
| `--sim-zone-border` | `rgba(0, 212, 255, 0.15)` | Zone border (no change) |
| `--sim-zone-highlight` | `rgba(0, 212, 255, 0.3)` | Zone drag highlight (no change) |

### Previous Story Intelligence (9-8)

Story 9-8 (Toggles Landscape) established patterns relevant here:
- `MatTooltip` import available in project (already used in simulator control-bar)
- `landscape-split` mixin targets 576px–767px landscape — does NOT conflict with this story's `767px portrait` media query
- `card-searcher` changes are scoped to card search/deck builder — no simulator impact
- Token-based styling (--accent-primary, --text-secondary) used consistently

### Git Intelligence

- Current branch: `hand-testing`
- Last commits: `c4bb391a follow up`, `35715a39 9.-2` (sidebar dark), `94a9097c 9-1` (global tokens)
- Working tree has uncommitted changes from stories 9-3 through 9-8
- Modified simulator files: `control-bar.component.scss`, `simulator-page.component.scss`
- Pattern: Stories 9-1 through 9-8 all committed or staged on this branch

### Project Structure Notes

- **Files modified:**
  - `front/src/app/pages/simulator/simulator.models.ts` (add `shortLabel` to ZONE_CONFIG type and all entries)
  - `front/src/app/pages/simulator/zone.component.html` (add zone label conditional)
  - `front/src/app/pages/simulator/zone.component.scss` (add `pointer-events: none` to `.zone-label`)
  - `front/src/app/pages/simulator/stacked-zone.component.html` (add zone label conditional)
  - `front/src/app/pages/simulator/stacked-zone.component.scss` (add `pointer-events: none` to `.zone-label`)
  - `front/src/app/pages/simulator/board.component.ts` (change `inspectorPosition` computed, add signal tracking)
  - `front/src/app/pages/simulator/board.component.scss` (add mobile portrait media query)
  - `front/src/app/services/navbar-collapse.service.ts` (add `isMobilePortrait` signal)
  - `front/src/app/components/card-inspector/card-inspector.component.ts` (expand position type, add host class)
  - `front/src/app/components/card-inspector/card-inspector.component.scss` (add `.position-top` styles)
- **No new files** created
- **No new Angular Material modules** — all imports already available

### Scope Boundaries

Elements that are NOT in scope for this story:
- `SimHandComponent` — hand zone does not get labels (always has cards after initial draw)
- `SimPileOverlayComponent` — pile overlay positioning unchanged
- `SimXyzMaterialPeekComponent` — XYZ peek positioning is story 9-10
- `SimControlBarComponent` — control bar changes are story 9-11
- Mobile top bar visibility — story 9-11
- Token migration (`_sim-tokens.scss`) — story 9-12 (already done)
- Landscape-specific behavior — not in scope (only portrait media query added)

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 4 — Mobile Portrait Layout decisions]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 4 — Zone Labels decisions]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Board Layout — transform-origin]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#SimCardInspectorComponent — position top overlay]
- [Source: _bmad-output/planning-artifacts/architecture.md#Board Scaling Model]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.9 (lines 1546-1572)]
- [Source: front/src/app/pages/simulator/board.component.ts — inspectorPosition computed, recalculateScale]
- [Source: front/src/app/pages/simulator/board.component.scss — transform-origin, align-items]
- [Source: front/src/app/pages/simulator/zone.component.html — card rendering, no label]
- [Source: front/src/app/pages/simulator/zone.component.scss — .zone-label CSS exists]
- [Source: front/src/app/pages/simulator/stacked-zone.component.html — topCard rendering, no label]
- [Source: front/src/app/pages/simulator/stacked-zone.component.scss — .zone-label CSS exists]
- [Source: front/src/app/pages/simulator/simulator.models.ts — ZONE_CONFIG labels]
- [Source: front/src/app/components/card-inspector/card-inspector.component.ts — position input type]
- [Source: front/src/app/components/card-inspector/card-inspector.component.scss — dismissable positioning]
- [Source: front/src/app/services/navbar-collapse.service.ts — isMobile signal pattern]
- [Source: front/src/app/styles/_responsive.scss — breakpoint variables]
- [Source: _bmad-output/implementation-artifacts/9-8-toggles-landscape.md — previous story intelligence]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `ng build` exits with code 1 due to pre-existing budget errors (bundle 1.62MB > 1MB limit, deck-builder.scss 6.11kB > 4kB limit). Zero compilation or template errors from story 9-9 changes.

### Completion Notes List

- Task 1: Extended ZONE_CONFIG type with `shortLabel: string` and added abbreviated labels to all 18 zones (M1-M5, ST1-ST5, EMZ, Field, Deck, ED, GY, Banish, Hand)
- Task 2: Added `@if (!card())` conditional rendering of zone labels in zone.component.html; added `pointer-events: none` to .zone-label in zone.component.scss; verified existing CSS uses `var(--text-secondary)` and `0.75rem` (acceptable per spec)
- Task 3: Added `@if (!topCard())` conditional rendering of zone labels in stacked-zone.component.html; added `pointer-events: none` to .zone-label in stacked-zone.component.scss; confirmed `zoneConfig` computed already exists in stacked-zone.component.ts (line 38)
- Task 4: Added `isMobilePortrait` signal to NavbarCollapseService using `(max-width: 767px) and (orientation: portrait)` media query, placed right after existing `isMobile` signal
- Task 5: Added mobile portrait media query to board.component.scss — `.board-container { align-items: flex-end }` and `.sim-board { transform-origin: bottom center }`. Desktop/landscape defaults unchanged.
- Task 6: Extended CardInspectorComponent position input type to `'left' | 'right' | 'top'`; added `[class.position-top]` host binding; added `.position-top` SCSS rules in `:host.mode-dismissable` (centered, max-height 50%); added mobile override preserving max-height constraint; image 60px shrink already covered by existing selector
- Task 7: Changed `inspectorPosition` computed to return `'top'` on mobile portrait via `isMobilePortrait()` signal; added `isMobilePortrait()` as tracked signal read in recalculateScale effect for orientation change reactivity
- Task 8: `ng build` confirms zero compilation errors — only pre-existing budget warnings/errors. Subtasks 8.2-8.10 are manual visual verification items for the developer.

### Change Log

- 2026-02-17: Implemented story 9-9 — board bottom anchoring on mobile portrait, inspector top position, zone labels on empty zones
- 2026-02-17: Code review (Claude Opus 4.6) — 5 issues found (2M, 3L), all fixed:
  - [M1] stacked-zone: added `.zone-label { display: none }` in receiving state (parity with zone.component)
  - [M2] card-inspector: removed redundant `.position-top { max-height: 50% }` from mobile media query
  - [L1] zone-label font-size aligned to AC spec: 0.75rem → 0.65rem (both zone + stacked-zone)
  - [L2] card-inspector mobile breakpoint standardized: 768px → 767px (aligned with board + navbar-collapse)
  - [L3] HAND shortLabel changed from 'Hand' to '' (dead data — SimHandComponent doesn't render zone labels)

### File List

- `front/src/app/pages/simulator/simulator.models.ts` — Modified: added `shortLabel` property to ZONE_CONFIG type and all 18 entries
- `front/src/app/pages/simulator/zone.component.html` — Modified: added zone label conditional rendering
- `front/src/app/pages/simulator/zone.component.scss` — Modified: added `pointer-events: none` to `.zone-label`
- `front/src/app/pages/simulator/stacked-zone.component.html` — Modified: added zone label conditional rendering
- `front/src/app/pages/simulator/stacked-zone.component.scss` — Modified: added `pointer-events: none` to `.zone-label`
- `front/src/app/services/navbar-collapse.service.ts` — Modified: added `isMobilePortrait` signal
- `front/src/app/pages/simulator/board.component.scss` — Modified: added mobile portrait media query for bottom anchoring
- `front/src/app/pages/simulator/board.component.ts` — Modified: changed `inspectorPosition` computed, added `isMobilePortrait()` to effect tracking
- `front/src/app/components/card-inspector/card-inspector.component.ts` — Modified: expanded position type to include `'top'`, added host class binding
- `front/src/app/components/card-inspector/card-inspector.component.scss` — Modified: added `.position-top` styles in dismissable and mobile contexts
