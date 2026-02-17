# Story 9.10: Simulator XYZ Peek Mobile Positioning

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the XYZ material peek panel positioned above the board on mobile portrait instead of to the right,
so that the panel doesn't clip or overflow on narrow viewports.

## Acceptance Criteria

1. **Given** the XYZ peek panel is positioned absolute right
   **When** mobile portrait viewport is detected (`@media (orientation: portrait) and (max-width: 767px)`)
   **Then** the panel is repositioned as a top overlay: centered horizontally at the top of `.board-container`
   **And** the panel matches the card inspector's mobile placement strategy (`top: 8px; left: 50%; transform: translateX(-50%)`)

2. **Given** the panel uses `$sim-*` tokens directly
   **When** the token migration is applied
   **Then** tokens are migrated to reference global tokens with simulator overrides via `:host`
   **Status: ALREADY DONE** — Story 9-12 (Simulator Token Migration) completed this. The current SCSS already uses `var(--sim-surface)`, `var(--sim-zone-border)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--surface-elevated)`. No work needed.

3. **Given** the panel has a `@media (prefers-reduced-motion)` block
   **When** the cleanup is applied
   **Then** the block is removed from the component SCSS
   **Status: ALREADY DONE** — Story 9-12 removed all `prefers-reduced-motion` blocks from all 7 simulator SCSS files. No work needed.

4. **Given** the repositioning is applied
   **When** CDK drag from peek panel to board zones is tested on mobile portrait
   **Then** drag operations work correctly across the repositioned boundary

## Tasks / Subtasks

- [x] Task 1: Add mobile portrait media query to reposition panel as top overlay (AC: #1)
  - [x] 1.1: In `xyz-material-peek.component.scss`, add a `@media (max-width: 767px) and (orientation: portrait)` block at the end of the file (after the base `@keyframes` block — overrides come after base styles)
  - [x] 1.2: Inside the media query, override `.material-peek-panel` positioning:
    - `top: 8px` (match inspector strategy)
    - `right: auto` (remove right positioning)
    - `left: 50%` (center horizontally)
    - `transform: translateX(-50%)` (center offset)
    - `width: min(240px, calc(100% - 16px))` (constrain to viewport with 8px padding each side)
    - `max-height: 50%` (don't cover more than half the board container vertically)
  - [x] 1.3: Inside the same media query, override `@keyframes peek-fade-in` for top entry:
    - `from { opacity: 0; transform: translateX(-50%) translateY(-8px); }` (slide down)
    - `to { opacity: 1; transform: translateX(-50%) translateY(0); }` (settle)

- [x] Task 2: Confirm AC #2 and AC #3 are already satisfied (AC: #2, #3)
  - [x] 2.1: Verify `xyz-material-peek.component.scss` contains zero `$sim-` color variable references (only `$sim-padding-overlay`, `$sim-gap-zone`, `$sim-gap-card`, `$sim-radius-zone`, `$sim-radius-card`, `$sim-card-aspect-ratio` are spacing/sizing SCSS vars — correct to keep)
  - [x] 2.2: Verify `xyz-material-peek.component.scss` contains zero `@media (prefers-reduced-motion)` blocks

- [x] Task 3: Build verification (AC: #1, #4)
  - [x] 3.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings are expected and ignorable)
  - [ ] 3.2: Visually verify desktop: panel still appears right-aligned, vertically centered (no regression)
  - [ ] 3.3: Visually verify mobile portrait: panel appears as top overlay, centered horizontally
  - [ ] 3.4: Test CDK drag from peek panel material row to any board zone on mobile portrait — drag must complete successfully
  - [ ] 3.5: Verify peek panel does not cover the Extra Monster zones (top row of board)
  - [ ] 3.6: Verify panel close button and ESC key still work on mobile portrait
  - [ ] 3.7: Verify panel auto-closes when last material is detached (existing behavior preserved)

## Dev Notes

### Why This Story Exists

On mobile portrait (phone held vertically, ≤767px width), the XYZ material peek panel is positioned `absolute right` within the `.board-container`. The board itself is 1060×772px scaled down via `transform: scale()` to fit the narrow viewport. While the board content scales, the peek panel does NOT scale (it's inside `.board-container` but outside `.sim-board`). A 240px panel + 1rem right offset on a ~375px viewport takes up >65% of the width and overlaps with the scaled board content.

The Screen Implementation Guide (§XYZ Material Peek Decisions) mandates: "Mobile portrait: pill positioned **above the board** (top overlay) instead of right, matching inspector placement strategy."

### What This Story Does

- Adds a single CSS media query block to `xyz-material-peek.component.scss` that repositions `.material-peek-panel` as a horizontally-centered top overlay on mobile portrait viewports
- Overrides the `peek-fade-in` animation to slide down from top instead of from right
- **This is a CSS-only change** — zero TypeScript or HTML modifications

### What This Story Does NOT Do

- Does NOT modify any TypeScript files (no logic changes)
- Does NOT modify the HTML template (structure unchanged)
- Does NOT add new Angular Material modules or imports
- Does NOT change any other simulator component SCSS file
- Does NOT add new SCSS imports (`@use 'responsive'` is NOT needed — raw `@media` query matches the pattern used by `card-inspector.component.scss`)
- Does NOT touch `_sim-tokens.scss`, `_tokens.scss`, or `styles.scss`
- Does NOT modify token values — AC #2 already satisfied by story 9-12
- Does NOT add/remove `prefers-reduced-motion` — AC #3 already satisfied by story 9-12
- Does NOT affect desktop or landscape layouts — only mobile portrait

### Current XYZ Peek Panel Positioning (BEFORE)

```scss
.material-peek-panel {
  position: absolute;
  top: 50%;
  right: $sim-padding-overlay;     // 1rem
  transform: translateY(-50%);     // vertical center
  width: 240px;
  max-height: 400px;
  z-index: 50;
  animation: peek-fade-in 150ms ease-out;
}

@keyframes peek-fade-in {
  from { opacity: 0; transform: translateY(-50%) translateX(8px); }  // slide in from right
  to { opacity: 1; transform: translateY(-50%) translateX(0); }
}
```

### Target Positioning on Mobile Portrait (AFTER)

```scss
@media (orientation: portrait) and (max-width: 767px) {
  .material-peek-panel {
    top: 8px;
    right: auto;
    left: 50%;
    transform: translateX(-50%);
    width: min(240px, calc(100% - 16px));
    max-height: 50%;
  }

  @keyframes peek-fade-in {
    from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
}
```

### Card Inspector Mobile Strategy (Reference Pattern)

The card inspector (`card-inspector.component.scss`) uses this mobile approach:
```scss
@media (max-width: 768px) {
  :host.mode-dismissable {
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 90%;
  }
}
```
The XYZ peek follows the same pattern but uses `width: min(240px, calc(100% - 16px))` instead of `90%` because the peek panel is much smaller and should not stretch full width.

**Note:** The peek uses `max-width: 767px` (exclusive of 768px) with an `orientation: portrait` guard, while the inspector uses `max-width: 768px` (inclusive). This 1px difference is intentional — tablets in portrait at 768px+ have enough horizontal space for the right-positioned peek panel, whereas the inspector needs centering at that width. At exactly 768px portrait, the inspector centers but the peek stays right-aligned.

### Why `@media (orientation: portrait) and (max-width: 767px)` Instead of Just `max-width`

The simulator is canvas-scaled (Track A). In landscape mode (phone rotated), the viewport width is 576-932px and there's enough horizontal space for the right-positioned panel. The orientation check ensures the repositioning only happens when the phone is held vertically and the viewport is truly narrow. This avoids an edge case where a tablet in portrait (768px+) would wrongly use the top overlay.

### Positioning Context

- `.board-container` has `position: relative` (in `board.component.scss`) — this is the containing block for the peek panel's `position: absolute`
- The peek panel is rendered as a sibling to `.sim-board` inside `.board-container` (see `board.component.html`)
- The panel is NOT inside the CSS Grid and NOT affected by `transform: scale()` on `.sim-board`
- `z-index: 50` is preserved — same as card inspector, above control bar (`z-index: 40`)

### CDK Drag on Mobile Portrait

CDK drag-drop uses `document.elementFromPoint()` to find drop targets. When the peek panel is repositioned to the top:
- Material rows are still `cdkDrag` elements within a `cdkDropList`
- The `cdkDropListGroup` on `BoardComponent` auto-connects all drop lists
- Drag preview uses `cdkDragPreviewContainer="global"` (renders at document level, `z-index: 1000`)
- The repositioning does NOT change the drag behavior — only the panel's visual position changes
- **Potential concern:** If the top-positioned panel overlaps board zones, the user might have difficulty dropping materials on zones beneath it. Mitigation: `max-height: 50%` ensures the panel covers at most the top half, leaving bottom zones accessible. On mobile portrait with board anchored at bottom (future story 9-9), this will be even better.

### SCSS Variables Still Used (Correctly)

The following SCSS variables from `_sim-tokens.scss` are still referenced and should remain:

| Variable | Value | Usage |
|---|---|---|
| `$sim-padding-overlay` | `1rem` | Right position offset, padding |
| `$sim-gap-zone` | `0.25rem` | Flex gap in panel |
| `$sim-gap-card` | `0.25rem` | Flex gap in material list/rows |
| `$sim-radius-zone` | `0.375rem` | Panel border-radius |
| `$sim-radius-card` | `0.25rem` | Close button, material row, drag preview border-radius |
| `$sim-card-aspect-ratio` | `59/86` | Material image aspect ratio |

These are **spacing/sizing/animation variables** — correctly kept as SCSS per story 9-12's migration strategy.

### CSS Custom Properties Used (Already Migrated)

| Token | Source | Value in Simulator |
|---|---|---|
| `var(--sim-surface)` | `:host` on SimulatorPageComponent | `#111827` |
| `var(--sim-zone-border)` | `:host` on SimulatorPageComponent | `rgba(0, 212, 255, 0.15)` |
| `var(--text-primary)` | `:host` override | `#f1f5f9` |
| `var(--text-secondary)` | `:host` override | `#94a3b8` |
| `var(--surface-elevated)` | Global (inherited) | `#1E293B` |

### Anti-Pattern Warnings

- **DO NOT** add `@use 'responsive' as r` — the simulator does NOT use the responsive mixins. Use a raw `@media` query, consistent with `card-inspector.component.scss`.
- **DO NOT** change `position: absolute` to `position: fixed` — the panel must stay relative to `.board-container`, not the viewport.
- **DO NOT** remove the existing `right: $sim-padding-overlay` rule from the base `.material-peek-panel` — the media query overrides it with `right: auto` only on mobile portrait.
- **DO NOT** modify `z-index: 50` — it must stay consistent with the card inspector.
- **DO NOT** touch any TypeScript or HTML files — this story is CSS-only.
- **DO NOT** add JavaScript-based viewport detection — CSS media queries are sufficient and correct.
- **DO NOT** add `@media (prefers-reduced-motion)` — already deliberately removed by story 9-12 per Screen Implementation Guide decision.
- **DO NOT** modify `_sim-tokens.scss` — token migration is complete.

### Dependency Note: Story 9-9 (Board Bottom + Inspector Top)

Story 9-9 (already implemented in working tree) anchors the board at the bottom on mobile portrait and adds a `'top'` position option to the card inspector. This story (9-10) does NOT depend on 9-9 — the top overlay works regardless of board anchor position. The combined effect is optimal: board at bottom (thumb-friendly) with peek panel at top (eye-level, no overlap).

### Previous Story Intelligence

**From story 9-12 (Simulator Token Migration, done):**
- All color `$sim-*` variables migrated to CSS custom properties via `:host` on SimulatorPageComponent
- All 7 `@media (prefers-reduced-motion)` blocks removed from simulator SCSS files
- `_sim-tokens.scss` reduced to spacing/sizing/animation variables only
- `@use 'sim-tokens' as *` kept in `xyz-material-peek.component.scss` (still uses spacing/sizing SCSS vars)
- `rgba(var())` problem resolved by hardcoding derived values as CSS custom properties

**From story 9-8 (Toggles Landscape, review):**
- CSS-only media query approach works well for responsive overrides
- `landscape-split` mixin pattern — but NOT applicable here (simulator uses Track A)
- MatTooltip already available in the project

### Git Intelligence

- Current branch: `hand-testing`
- Last commits: `c4bb391a follow up`, `35715a39 9.-2`, `94a9097c 9-1`
- Story 9-12 changes are in working tree (uncommitted) — already applied to `xyz-material-peek.component.scss`

### Project Structure Notes

- **File modified:** `front/src/app/pages/simulator/xyz-material-peek.component.scss` (add mobile portrait media query)
- **No new files** created
- **No TypeScript changes** — CSS-only story
- **No HTML template changes**
- **No new dependencies or imports**
- Alignment with existing pattern: `card-inspector.component.scss` uses same `@media (max-width: 768px)` approach for mobile repositioning

### Scope Boundaries

Elements NOT in scope:
- `board.component.scss` — board anchor position is story 9-9
- `simulator-page.component.scss` — no changes needed (`:host` overrides already correct)
- `card-inspector.component.scss` — inspector positioning is story 9-9
- `control-bar.component.scss` — no changes needed
- `pile-overlay.component.scss` — no changes needed
- `_sim-tokens.scss` — migration complete (story 9-12)
- `_tokens.scss` — global tokens unchanged
- Any TypeScript or HTML file

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#XYZ Material Peek Decisions]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Regression Risk — XYZ peek mobile positioning]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Recommended Implementation Order step 10]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.10 (lines 1574-1596)]
- [Source: front/src/app/pages/simulator/xyz-material-peek.component.scss — current positioning]
- [Source: front/src/app/components/card-inspector/card-inspector.component.scss — inspector mobile strategy (lines 156-172)]
- [Source: front/src/app/pages/simulator/board.component.scss — .board-container position: relative (line 18)]
- [Source: front/src/app/pages/simulator/board.component.html — XYZ peek rendered inside .board-container]
- [Source: _bmad-output/implementation-artifacts/9-12-simulator-token-migration.md — AC #5, Task 4.7 confirm token+motion already done]
- [Source: front/src/app/styles/_responsive.scss — breakpoint variables reference]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — CSS-only change, no debugging needed.

### Completion Notes List

- **Task 1:** Added `@media (orientation: portrait) and (max-width: 767px)` block at end of `xyz-material-peek.component.scss`. Overrides `.material-peek-panel` positioning from right-aligned vertical center to top-centered horizontal overlay (`top: 8px; left: 50%; transform: translateX(-50%); width: min(240px, calc(100% - 16px)); max-height: 50%`). Overrides `@keyframes peek-fade-in` to slide down from top instead of from right.
- **Task 2:** Confirmed AC #2 (token migration) and AC #3 (prefers-reduced-motion removal) already satisfied by story 9-12. Zero `$sim-` color variables remain; zero `prefers-reduced-motion` blocks remain.
- **Task 3:** `ng build` passes with zero SCSS/TS compilation errors. Pre-existing budget warnings (bundle >1MB, deck-builder.scss >4kB) are unrelated to this change. Subtasks 3.2–3.7 are manual visual/interaction verifications for user testing.

### Change Log

- 2026-02-17: Added mobile portrait media query for XYZ peek panel top overlay positioning (AC #1). Confirmed AC #2, #3 already done. Build passes.
- 2026-02-17: Code review — 6 findings (2M, 4L), all fixed: M1 media query order consistency with board.component.scss, M2 `.peek-subtitle` text truncation for mobile, L1 stale 9-9 backlog note, L2 breakpoint 1px gap clarification, L3 `overflow: hidden` on mobile panel, L4 task 1.1 description accuracy.

### File List

- `front/src/app/pages/simulator/xyz-material-peek.component.scss` (modified — added mobile portrait media query block)
