# Code Review Report — Sprint 1 (All Stories)

**Date:** 2026-02-12
**Reviewer:** Claude Opus 4.6 (Adversarial Senior Dev persona)
**Scope:** All 13 stories across 5 epics (sprint-status.yaml)
**Build status:** PASS (ng build --configuration development)

---

## Summary

| Severity | Found | Fixed |
|----------|-------|-------|
| CRITICAL | 0     | —     |
| HIGH     | 3     | 3     |
| MEDIUM   | 7     | 7     |
| LOW      | 7     | 0 (deferred) |

**All HIGH and MEDIUM issues resolved. LOW issues deferred to post-MVP.**

---

## HIGH Issues (Fixed)

### H1 — CompositeCommand partial undo failure
- **File:** `commands/composite.command.ts`
- **Problem:** If any sub-command `undo()` throws, remaining sub-commands are skipped, leaving board in corrupted state.
- **Fix:** Wrapped each sub-command undo in try/catch. Failures are logged in devMode but don't block remaining undos.

### H2 — resetBoard() and clearHistory() decoupled
- **Files:** `command-stack.service.ts`, `control-bar.component.ts`
- **Problem:** ControlBar called `boardState.resetBoard()` and `commandStack.clearHistory()` as separate operations. If one fails, state becomes inconsistent.
- **Fix:** Added `CommandStackService.reset()` method that atomically calls both. ControlBar now calls `commandStack.reset()`.

### H3 — Auto-shuffle on search close is undoable
- **Files:** `board-state.service.ts`, `pile-overlay.component.ts`
- **Problem:** Closing deck search called `commandStack.shuffleDeck()`, creating an undoable command. Undoing it would un-shuffle the deck after search, which is confusing.
- **Fix:** Added `BoardStateService.shuffleDeckSilent()` (direct state mutation, no command). Pile overlay now uses it. Removed unused `CommandStackService` import from pile-overlay.

---

## MEDIUM Issues (Fixed)

### M1 — Stacked zone cards don't trigger inspector hover
- **Files:** `stacked-zone.component.ts`, `stacked-zone.component.html`
- **Problem:** SimCard in stacked zone template had no `(hovered)`/`(unhovered)` event bindings. Hovering over GY/Banish/ED/Deck top card didn't show inspector.
- **Fix:** Added `onCardHovered()`/`onCardUnhovered()` methods and wired events in template.

### M2 — displayCard creates new object reference on every signal read
- **Files:** `sim-card.component.ts`, `stacked-zone.component.ts`, `stacked-zone.component.html`
- **Problem:** `displayCard` computed used `{ ...top, faceDown: true }` spread to force face-down display for deck/ED. This created a new object on every read, defeating OnPush change detection.
- **Fix:** Added `forceFaceDown` input to SimCardComponent. Stacked zone template now passes `[forceFaceDown]="showFaceDown()"` and uses `topCard()` directly. Removed `displayCard` computed.

### M3 — XYZ material peek overlaps card inspector
- **File:** `card-inspector.component.ts`
- **Problem:** Inspector position only checked `isOverlayOpen()`, not `isMaterialPeekOpen()`. When material peek opened on right side, inspector also positioned right, causing overlap.
- **Fix:** Updated `inspectorPosition` computed to check both `isOverlayOpen() || isMaterialPeekOpen()`.

### M4 — No debug panel for command stack state
- **Files:** `control-bar.component.ts`, `control-bar.component.html`, `control-bar.component.scss`
- **Problem:** No visibility into undo/redo stack sizes during development. Makes debugging command stack issues harder.
- **Fix:** Added `undoCount`/`redoCount` computed signals + `debug-info` span in template, behind `isDevMode()` gate.

### M5 — Pile overlay has wrong ARIA role
- **File:** `pile-overlay.component.ts`
- **Problem:** Host role was `'complementary'` (sidebar landmark). Pile overlay is a modal dialog that traps focus and dismisses on Escape.
- **Fix:** Changed to `role: 'dialog'` + `[attr.aria-modal]: 'isOpen()'`.

### M6 — Deck left-click does nothing when deck has cards
- **File:** `stacked-zone.component.ts`
- **Problem:** Left-clicking the Main Deck with cards did nothing (only empty deck triggered shake). Users had to discover right-click for context menu.
- **Fix:** Added `else` branch to `onZoneClick()` that opens the deck menu on left-click when deck is non-empty.

### M7 — No way to test reduced-motion styles during dev
- **Files:** `board-state.service.ts`, `control-bar.component.ts/html`, `board.component.ts/html`
- **Problem:** Multiple components have `:host-context(.force-reduced-motion)` SCSS rules, but no toggle to activate them.
- **Fix:** Added `forceReducedMotion` signal to BoardStateService. Toggle button in ControlBar (dev mode only). `force-reduced-motion` class bound on `board-container` div.

---

## LOW Issues (Deferred)

| ID | Issue | Affected Story |
|----|-------|---------------|
| L1 | Hand reorder emits even on no-op same-index drops | 2-3 |
| L2 | Deck shake animation lacks `will-change` hint | 2-3 |
| L3 | Context menu doesn't prevent default in production | 3-1 |
| L4 | Reveal overlay doesn't auto-close when all cards dragged out | 4-2 |
| L5 | XYZ material peek has no empty-state message | 4-3 |
| L6 | Undo/redo stack grows without limit | 5-1 |
| L7 | Keyboard shortcuts don't show in an accessible help panel | 5-2 |

---

## Files Modified

| File | Issues Fixed |
|------|-------------|
| `commands/composite.command.ts` | H1 |
| `command-stack.service.ts` | H2 |
| `board-state.service.ts` | H3, M7 |
| `pile-overlay.component.ts` | H3, M5 |
| `stacked-zone.component.ts` | M1, M2, M6 |
| `stacked-zone.component.html` | M1, M2 |
| `sim-card.component.ts` | M2 |
| `card-inspector.component.ts` | M3 |
| `control-bar.component.ts` | H2, M4, M7 |
| `control-bar.component.html` | M4, M7 |
| `control-bar.component.scss` | M4 |
| `board.component.ts` | M7 |
| `board.component.html` | M7 |
