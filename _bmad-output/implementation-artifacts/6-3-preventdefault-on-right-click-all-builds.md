# Story 6.3: preventDefault on Right-Click (All Builds)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the native browser context menu to be suppressed on the board,
so that right-click interactions (future card actions) are not blocked by the browser.

## Acceptance Criteria

1. **Given** I right-click anywhere inside the `SimBoardComponent`,
   **When** the `contextmenu` event fires,
   **Then** `event.preventDefault()` is called and the native context menu does not appear,
   **And** this behavior applies in ALL builds (development and production) — no `isDevMode()` guard.

2. **Given** I right-click on the navbar (outside `SimBoardComponent`),
   **When** the `contextmenu` event fires,
   **Then** the native browser context menu appears normally (preventDefault is scoped to the board only).

## Tasks / Subtasks

- [x] **Task 1: Add board-wide contextmenu preventDefault** (AC: 1, 2)
  - [x] 1.1: In `board.component.ts`, add `@HostListener('contextmenu', ['$event'])` on the component host
  - [x] 1.2: Handler calls `event.preventDefault()` unconditionally — NO `isDevMode()` guard
  - [x] 1.3: Verify this does NOT affect the navbar — `@HostListener('contextmenu')` on the component host only captures events within the component's DOM tree
  - [x] 1.4: Remove any per-zone `event.preventDefault()` in `zone.component.ts` `onContextMenu()` — it's now handled at board level (avoid double prevention)
  - [x] 1.5: Verify `stacked-zone.component.ts` context menu handler — if it calls `event.preventDefault()`, it can be removed (board-level handles it)

- [x] **Task 2: Verify existing context menus still work** (AC: 1)
  - [x] 2.1: Right-click on a board card → `mat-menu` opens (zone.component.ts context menu)
  - [x] 2.2: Right-click on deck zone → `mat-menu` opens (stacked-zone.component.ts context menu)
  - [x] 2.3: Both menus work because `mat-menu` uses Angular overlay (CDK Overlay), not native context menu — unaffected by `preventDefault()`

- [x] **Task 3: Verify build** (AC: all)
  - [x] 3.1: Run `ng build --configuration development` — zero errors
  - [x] 3.2: Run `ng build` (production) — zero compilation errors (pre-existing budget warning unrelated to this story)
  - [x] 3.3: Test in dev mode: right-click board → no native menu; right-click navbar → native menu appears

## Dev Notes

### Critical Architecture Constraints

- **`event.preventDefault()` on contextmenu in ALL builds.** The current implementation may use `isDevMode()` guard to allow browser dev tools context menu during development. This guard must be REMOVED. The board's custom `mat-menu` context menu is the only right-click behavior on the board. [Source: epics.md#Story 6.3 AC, ux-design-specification.md#preventDefault, epics.md#Additional Requirements]
- **Scoped to SimBoardComponent only.** The `@HostListener('contextmenu')` on the board component host element captures all contextmenu events bubbling from child elements (zones, cards, hand, stacked zones). Events outside the board (navbar, other pages) are not affected. [Source: epics.md#Story 6.3 AC 2]
- **mat-menu is unaffected.** Angular Material's `mat-menu` is rendered in a CDK Overlay attached to `<body>`, not inside the right-click target. `preventDefault()` on `contextmenu` prevents the native browser menu but does not interfere with programmatic overlay triggers. [Source: Angular Material docs]

### Implementation Details

#### Board-Level Prevention

```typescript
// board.component.ts — addition:
@HostListener('contextmenu', ['$event'])
onContextMenu(event: MouseEvent): void {
  event.preventDefault();
}
```

This is the simplest and most correct approach:
- `@HostListener('contextmenu')` captures the event on the component host element
- All child events bubble up and get caught here
- Events outside the component (navbar) are unaffected
- No `if (isDevMode()) return;` guard — always prevent

#### Per-Zone Cleanup

In `zone.component.ts`, the current `onContextMenu(event)` method has a production-only guard:
```typescript
onContextMenu(event: MouseEvent): void {
  // ...
  if (!isDevMode()) {
    event.preventDefault(); // ← Remove: board-level HostListener now handles this
  }
  // ... position anchor, open mat-menu ...
}
```

Remove the `if (!isDevMode()) { event.preventDefault(); }` block from zone-level handlers since the board now handles it unconditionally. The `mat-menu` trigger logic remains unchanged.

Same pattern in `stacked-zone.component.ts` — remove the `!isDevMode()` guarded `event.preventDefault()` from its context menu handler.

**Why remove per-zone prevention?** Clean separation of concerns. Board owns `preventDefault`, zones own their `mat-menu` triggers. No double prevention.

### Edge Cases

- **Right-click on empty board area (no zone):** Board-level `@HostListener` still catches it. No native menu.
- **Right-click on pile overlay:** Pile overlay is rendered inside `board.component.html` (`<app-sim-pile-overlay />`), so it IS part of the board's DOM tree despite using `position: fixed` CSS. Board `@HostListener` captures its contextmenu events. Native menu is suppressed — acceptable for MVP.
- **Right-click on inspector:** Same as overlay — inside board DOM tree (`<app-sim-card-inspector />`). Board `@HostListener` captures it. Native menu is suppressed — acceptable for MVP.
- **Right-click on control bar:** Control bar is INSIDE the board grid (`controls` area). Board `@HostListener` catches it. If control bar right-click should show native menu, add `event.stopPropagation()` in control bar. For MVP, preventing native menu on control bar is acceptable.

### NFR Compliance

- **NFR1 (<16ms frame):** `event.preventDefault()` is O(1). Zero performance impact.

### What This Story Does NOT Include

- **No new context menu actions** — Only preventing native menu. Custom context menus already exist.
- **No changes to mat-menu content** — Flip/position/shuffle/search/mill/reveal options unchanged.
- **No overlay or inspector right-click changes** — Only board scope.

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| Board-wide contextmenu prevention | All future right-click features on the board |

### Previous Story Intelligence (Story 6.2)

**Patterns to follow:**
- `@HostListener` decorator pattern (already used for `document:keydown` in board.component.ts)
- Keep changes minimal — this is a LOW impact quick fix
- Zero new files

### Existing Code — What NOT to Change

| File | Keep As-Is | Reason |
|---|---|---|
| `simulator.models.ts` | Unchanged | No model changes |
| `board-state.service.ts` | Unchanged | No state changes |
| `command-stack.service.ts` | Unchanged | No command changes |
| All `commands/*.command.ts` | Unchanged | No command changes |
| `pile-overlay.component.*` | Unchanged | Board-level HostListener handles preventDefault; no per-component changes needed |
| `card-inspector.component.*` | Unchanged | Board-level HostListener handles preventDefault; no per-component changes needed |
| `hand.component.*` | Unchanged | No context menu changes needed |
| `sim-card.component.*` | Unchanged | Card rendering unchanged |
| `control-bar.component.*` | Unchanged | No changes needed |

### Project Structure Notes

- All files in `front/src/app/pages/simulator/`
- **0 new files**

**Files modified by this story:**
```
front/src/app/pages/simulator/
  board.component.ts              # MODIFIED — add @HostListener('contextmenu') with unconditional preventDefault
  zone.component.ts               # MODIFIED — remove event.preventDefault() from onContextMenu (board handles it)
  stacked-zone.component.ts       # POSSIBLY MODIFIED — remove event.preventDefault() if present in context menu handler
```

### References

- [Source: epics.md#Story 6.3] — Acceptance criteria, user story
- [Source: epics.md#Additional Requirements] — preventDefault on entire board in all builds
- [Source: ux-design-specification.md#preventDefault] — No isDevMode() guard, navbar retains native menu
- [Source: board.component.ts] — Current @HostListener handlers (document:keydown for Ctrl+Z/Ctrl+Y)
- [Source: zone.component.ts] — Current onContextMenu handler with event.preventDefault()
- [Source: stacked-zone.component.ts] — Current context menu handler
- [Source: 6-2-face-down-card-behavior-fixes-solo-context.md] — Previous story patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation with zero issues.

### Completion Notes List

- Added `@HostListener('contextmenu', ['$event'])` to `SimBoardComponent` with unconditional `event.preventDefault()` — no `isDevMode()` guard
- Removed `!isDevMode()` guarded `event.preventDefault()` from `zone.component.ts` `onContextMenu()` — board-level now handles it unconditionally
- Removed `!isDevMode()` guarded `event.preventDefault()` from `stacked-zone.component.ts` `onContextMenu()` — board-level now handles it unconditionally
- Verified `mat-menu` triggers in zone and stacked-zone components remain functional (CDK Overlay unaffected by native contextmenu prevention)
- Development build passes with zero errors; production build has pre-existing bundle budget warning (unrelated to this story)
- Zero new files created, zero new dependencies added

### File List

- `front/src/app/pages/simulator/board.component.ts` — MODIFIED (added board-level contextmenu HostListener with unconditional preventDefault)
- `front/src/app/pages/simulator/zone.component.ts` — MODIFIED (removed !isDevMode() guarded event.preventDefault() from onContextMenu)
- `front/src/app/pages/simulator/stacked-zone.component.ts` — MODIFIED (removed !isDevMode() guarded event.preventDefault() from onContextMenu)

### Change Log

- **2026-02-12**: Implemented board-wide contextmenu preventDefault — suppresses native browser context menu on the entire board in all builds (dev + prod), while preserving mat-menu context menus and leaving navbar unaffected.
- **2026-02-12**: Code review (AI) — 1 MEDIUM, 3 LOW findings. All fixed: corrected Dev Notes DOM tree claims for pile-overlay/inspector, fixed Per-Zone Cleanup code example to show actual `!isDevMode()` guard, fixed Completion Notes guard direction precision, added delegation comments in zone/stacked-zone onContextMenu handlers. Status → done.
