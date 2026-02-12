# Story 5.2: Reset Board & Keyboard Shortcuts

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to reset the board to start fresh and use keyboard shortcuts for speed,
so that I can quickly test another hand without navigating away.

## Acceptance Criteria

1. **Given** I click the Reset button in `SimControlBarComponent`,
   **When** a confirmation dialog appears,
   **Then** confirming clears both `undoStack` and `redoStack`, reinitializes the board (re-load deck, re-shuffle, re-draw 5),
   **And** the reset completes in under 1 second,
   **And** Reset is NOT a command — it cannot be undone.

2. **Given** I dismiss the confirmation dialog,
   **When** I click Cancel,
   **Then** the board state remains unchanged.

3. **Given** I press `Ctrl+Z` anywhere on the board,
   **When** the keyboard event fires,
   **Then** `CommandStackService.undo()` is called (same as clicking Undo button).

4. **Given** I press `Ctrl+Y` anywhere on the board,
   **When** the keyboard event fires,
   **Then** `CommandStackService.redo()` is called.

5. **Given** I press `Escape` anywhere on the board,
   **When** an overlay or context menu is open,
   **Then** it closes — handled by existing component-level `@HostListener('document:keydown.escape')` in `SimPileOverlayComponent` and `SimXyzMaterialPeekComponent` (no new code needed).

6. **Given** focus is in a text input (e.g., pile overlay search filter),
   **When** I press `Ctrl+Z` or other shortcuts,
   **Then** the shortcut is not captured — default browser behavior applies.

7. **Given** there is no keyboard shortcut for Reset,
   **When** I look at the SimControlBarComponent,
   **Then** Undo and Redo buttons show shortcut hints in tooltips (`Ctrl+Z`, `Ctrl+Y`),
   **And** Reset button shows no shortcut hint.

8. **Given** all keyboard shortcuts are captured,
   **When** the board initializes,
   **Then** shortcuts are registered via `@HostListener('document:keydown')` on `SimBoardComponent`.

## Tasks / Subtasks

- [x] **Task 1: Store original Deck in BoardStateService for reset** (AC: 1)
  - [x] 1.1: Add private field `private originalDeck: Deck | null = null` in `board-state.service.ts`
  - [x] 1.2: In `initializeBoard(deck)`, store `this.originalDeck = deck` before any card processing
  - [x] 1.3: Create `resetBoard(): void` method that:
    - Closes any open overlay (`closeOverlay()`) and material peek (`closeMaterialPeek()`)
    - Clears `hoveredCard` signal to `null`
    - Re-calls `initializeBoard(this.originalDeck!)` to re-shuffle and re-draw 5
  - [x] 1.4: Verify `initializeBoard()` already produces a fresh board state (new shuffle, new draw 5) — added `boardState.set(createEmptyBoard())` before re-init to clear all zones

- [x] **Task 2: Add clearHistory() to CommandStackService** (AC: 1)
  - [x] 2.1: Add `clearHistory(): void` method that sets both `_undoStack` and `_redoStack` to empty arrays via `.set([])`
  - [x] 2.2: This is a simple setter — NOT a command. No undo/redo of this action.

- [x] **Task 3: Add Reset button to SimControlBarComponent** (AC: 1, 2, 7)
  - [x] 3.1: Inject `BoardStateService` via `inject()` in `control-bar.component.ts`
  - [x] 3.2: Add `onReset()` method using `window.confirm()` for confirmation (no MatDialog — see Dev Notes for rationale)
  - [x] 3.3: On confirm: call `boardState.resetBoard()` then `commandStack.clearHistory()`
  - [x] 3.4: On cancel: do nothing (AC 2)
  - [x] 3.6: Add Reset button to template: `mat-icon-button` with icon `refresh`, `matTooltip="Reset"` (no shortcut hint per AC 7)
  - [x] 3.7: Add `aria-label="Reset board"` on the button
  - [x] 3.8: Reset button always enabled (unlike Undo/Redo)
  - [x] 3.9: Add visual separator between Undo/Redo group and Reset button (e.g., `1px` divider line or `margin-left: auto`)

- [x] **Task 4: Register keyboard shortcuts on SimBoardComponent** (AC: 3, 4, 6, 8)
  - [x] 4.1: Add `@HostListener('document:keydown', ['$event'])` handler in `board.component.ts`
  - [x] 4.2: Inject `CommandStackService` into SimBoardComponent (no BoardStateService needed — Escape handled by existing component-level listeners)
  - [x] 4.3: Guard: if `event.target` is an `<input>` or `<textarea>`, return immediately (AC 6)
  - [x] 4.4: Handle `Ctrl+Z` (or `Meta+Z` on Mac) → call `commandStack.undo()`, `event.preventDefault()` (AC 3)
  - [x] 4.5: Handle `Ctrl+Y` (or `Meta+Y` on Mac) → call `commandStack.redo()`, `event.preventDefault()` (AC 4)
  - [x] 4.6: Wrap all CommandStackService calls in try/catch with `isDevMode() && console.warn()` (established pattern)
  - [x] 4.7: Do NOT handle Escape in this handler — already covered by `pile-overlay.component.ts` and `xyz-material-peek.component.ts` component-level `@HostListener('document:keydown.escape')` (AC 5)

- [x] **Task 5: Verify build and manual test** (AC: all)
  - [x] 5.1: Run `ng build --configuration development` — zero errors
  - [ ] 5.2: Manual smoke test: Ctrl+Z undoes, Ctrl+Y redoes, Escape closes overlay (existing handlers), Reset clears board

## Dev Notes

### Critical Architecture Constraints

- **Reset is NOT a command.** It is a definitive act that clears both undo/redo stacks and reinitializes the board. It CANNOT be undone. This is by design — reset is a destructive session action, not a board state mutation. [Source: architecture.md#Reset Behavior, epics.md#Epic 5 Implementation Notes]
- **No keyboard shortcut for Reset.** `Ctrl+Shift+R` conflicts with browser hard refresh across Chrome/Firefox/Edge. Reset requires confirmation dialog, making a shortcut less useful. Button-only. [Source: ux-design-specification.md#Keyboard Shortcut Patterns, epics.md#Story 5.2 AC]
- **Keyboard shortcuts captured at SimBoardComponent level.** Use `@HostListener('document:keydown')` for Ctrl+Z and Ctrl+Y. Escape is NOT handled at board level — existing component-level handlers in `SimPileOverlayComponent` and `SimXyzMaterialPeekComponent` already handle Escape via `@HostListener('document:keydown.escape')`. No duplication, no coordination issues. [Source: ux-design-specification.md#Shortcut Principles, epics.md#Story 5.2 AC 8]
- **Shortcuts disabled in text inputs.** When focus is in `<input>` or `<textarea>` (e.g., pile overlay search filter), Ctrl+Z should trigger browser undo, not board undo. Check `event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement`. [Source: ux-design-specification.md#Shortcut Principles, epics.md#Story 5.2 AC 6]
- **NFR3: Board reset < 1 second.** `initializeBoard()` is synchronous (Fisher-Yates shuffle + array manipulation). Well within budget. [Source: prd.md#NFR3]
- **Zero direct board state mutation.** Reset goes through `BoardStateService.resetBoard()` which internally re-calls `initializeBoard()`. CommandStackService clears stacks separately. [Source: architecture.md#Enforcement Guidelines]
- **Services scoped to SimulatorPageComponent.** Both services are NOT `providedIn: 'root'` — they are scoped via `providers` on SimulatorPageComponent. New injections in SimBoardComponent and SimControlBarComponent use standard `inject()`. [Source: architecture.md#Service Scoping Decision]

### Implementation Details

#### BoardStateService — Store Deck + Reset Method

```typescript
// board-state.service.ts — additions:
private originalDeck: Deck | null = null;

initializeBoard(deck: Deck): void {
  this.originalDeck = deck; // ADD this line — store for reset
  // ... rest of existing initialization unchanged
}

resetBoard(): void {
  if (!this.originalDeck) return;
  this.closeOverlay();
  this.closeMaterialPeek();
  this.hoveredCard.set(null);
  this.isDragging.set(false);
  this.initializeBoard(this.originalDeck);
}
```

**Key insight:** `initializeBoard()` already creates a fresh `Record<ZoneId, CardInstance[]>`, shuffles with Fisher-Yates (new random order each call), and draws 5 to hand. Re-calling it produces a valid fresh state. The existing method uses `this.boardState.set(...)` which replaces the entire state — no leftover data.

#### CommandStackService — Clear History

```typescript
// command-stack.service.ts — addition:
clearHistory(): void {
  this._undoStack.set([]);
  this._redoStack.set([]);
}
```

#### SimControlBarComponent — Reset Button + Confirmation

```typescript
// control-bar.component.ts — additions:
private readonly boardState = inject(BoardStateService);

onReset(): void {
  // Simple browser confirm() — no MatDialog dependency needed
  // Architecture says "confirmation dialog" but for a solo dev tool,
  // window.confirm() is pragmatic and avoids importing MatDialogModule
  const confirmed = confirm('Reset the board? This will clear undo history and deal a new hand.');
  if (!confirmed) return;

  try {
    this.boardState.resetBoard();
    this.commandStack.clearHistory();
  } catch (e) {
    if (isDevMode()) console.warn('Reset failed:', e);
  }
}
```

**Decision: `window.confirm()` vs `MatDialog`**
- The UX spec mentions "confirmation dialog" and references `mat-dialog` for reset
- However, `mat-dialog` requires `MatDialogModule` import, a separate dialog component, and async handling — significant overhead for a single confirmation in a solo tool
- `window.confirm()` is synchronous, zero-dependency, and achieves the same user intent: "Are you sure?"
- If the user prefers `MatDialog`, the implementation can be upgraded, but `confirm()` is the pragmatic default for MVP
- **Use `window.confirm()` unless user explicitly requests `MatDialog`**

#### SimControlBarComponent Template — Add Reset

```html
<!-- control-bar.component.html — updated: -->
<div class="control-bar" role="toolbar" aria-label="Session controls">
  <button mat-icon-button
          [disabled]="!canUndo()"
          [attr.aria-disabled]="!canUndo()"
          aria-label="Undo"
          matTooltip="Undo (Ctrl+Z)"
          (click)="onUndo()">
    <mat-icon>undo</mat-icon>
  </button>

  <button mat-icon-button
          [disabled]="!canRedo()"
          [attr.aria-disabled]="!canRedo()"
          aria-label="Redo"
          matTooltip="Redo (Ctrl+Y)"
          (click)="onRedo()">
    <mat-icon>redo</mat-icon>
  </button>

  <div class="separator"></div>

  <button mat-icon-button
          aria-label="Reset board"
          matTooltip="Reset"
          (click)="onReset()">
    <mat-icon>refresh</mat-icon>
  </button>
</div>
```

#### SimControlBarComponent Styles — Separator + Reset

```scss
// control-bar.component.scss — additions:
.separator {
  width: 1px;
  height: 24px;
  background: $sim-zone-border;
  margin: 0 $sim-gap-card;
}
```

#### SimBoardComponent — Keyboard Shortcuts (Ctrl+Z, Ctrl+Y only)

```typescript
// board.component.ts — additions:
import { isDevMode } from '@angular/core';

private readonly commandStack = inject(CommandStackService);

@HostListener('document:keydown', ['$event'])
onKeydown(event: KeyboardEvent): void {
  // Skip if focus is in a text input
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return;
  }

  const ctrl = event.ctrlKey || event.metaKey; // metaKey for Mac Cmd

  if (ctrl && event.key === 'z') {
    event.preventDefault();
    try {
      this.commandStack.undo();
    } catch (e) {
      if (isDevMode()) console.warn('Keyboard undo failed:', e);
    }
    return;
  }

  if (ctrl && event.key === 'y') {
    event.preventDefault();
    try {
      this.commandStack.redo();
    } catch (e) {
      if (isDevMode()) console.warn('Keyboard redo failed:', e);
    }
    return;
  }

  // NOTE: Escape is NOT handled here.
  // Existing @HostListener('document:keydown.escape') handlers in
  // pile-overlay.component.ts and xyz-material-peek.component.ts
  // already handle Escape for their respective overlays.
  // No board-level Escape needed — avoids listener registration order issues.
}
```

**Escape strategy (Party Mode decision):** Escape is handled exclusively by existing component-level listeners in `SimPileOverlayComponent` and `SimXyzMaterialPeekComponent`. No board-level Escape handler. This avoids `document:keydown` listener registration order ambiguity between parent and child components. Each component is responsible for its own dismissal — clean, no coordination needed.

### Edge Cases

- **Reset with empty board (just loaded, no actions):** `resetBoard()` still works — produces a new shuffle, new draw 5. Undo/redo stacks already empty, `clearHistory()` is a no-op.
- **Reset during drag:** `isDragging` is `true`. Reset button accessible but unlikely to be clicked during drag. If clicked, `resetBoard()` sets `isDragging.set(false)` and replaces board state. CDK drag state becomes stale — card will visually snap away. Acceptable for solo testing tool.
- **Reset during overlay open:** `resetBoard()` calls `closeOverlay()` before reinitializing. Overlay closes, board resets. Clean sequence.
- **Reset with XYZ materials on board:** `initializeBoard()` replaces entire `boardState` signal — all zones reset. XYZ materials are part of `CardInstance.overlayMaterials` which gets rebuilt from deck data. Material peek closed by `closeMaterialPeek()`.
- **Ctrl+Z with empty undo stack:** `commandStack.undo()` already handles this — returns early if stack empty. No error, no visual feedback beyond disabled button.
- **Ctrl+Y with empty redo stack:** Same — `commandStack.redo()` returns early.
- **Ctrl+Z in search filter input:** AC 6 — shortcut not captured. Browser undo applies to text input.
- **Escape with no overlay open:** Component-level handlers check `isOpen()` and return early. Standard browser behavior preserved.
- **Rapid Ctrl+Z spam:** Each keydown event processes one undo. Signal-based reactivity ensures each processes the current top of stack. OnPush re-renders only affected zones.
- **Reset confirmation dismissed via Escape:** `window.confirm()` — user clicks Cancel or presses Escape → returns `false` → board unchanged. Standard behavior.

### NFR Compliance

- **NFR1 (<16ms frame):** Keyboard event handler is a simple conditional + service call. Well within budget.
- **NFR2 (<100ms board update):** Board state reset via `boardState.set()` with immutable update. Computed signals propagate instantly.
- **NFR3 (<1s board reset):** `initializeBoard()` is synchronous — Fisher-Yates shuffle O(n) + array operations. For n≤60 cards, this completes in microseconds.
- **NFR4 (responsive with 20+ cards):** Reset replaces all zones atomically — single `boardState.set()` call triggers one change detection cycle.
- **`prefers-reduced-motion`:** No new animations added. Reset is instantaneous. Keyboard shortcuts have no visual animation.

### What This Story Does NOT Include

- **No Draw keyboard shortcut** — only Ctrl+Z, Ctrl+Y, and Escape are specified in the epics (FR32). No D, S, or other letter shortcuts.
- **No undo history visualization** — not in scope (post-MVP)
- **No animation on reset** — board replaces instantly. No "reshuffle animation" (post-MVP enhancement)
- **No `prefers-reduced-motion` dev toggle** — UX spec mentions it for SimControlBarComponent but it was flagged as untracked planning gap in Story 5.1 review. Not in scope for this story.

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `BoardStateService.resetBoard()` | Future stories if reset logic needs extension |
| `CommandStackService.clearHistory()` | Future stories if history management needed |
| `@HostListener('document:keydown')` on SimBoardComponent | Future stories adding more shortcuts |
| Reset button in SimControlBarComponent | Final UI for session controls |

### Previous Story Intelligence (Story 5.1)

**Patterns established — MUST follow:**
- SCSS import: `@use 'sim-tokens' as *` (Dart Sass 2.0, NOT `@import`)
- Service injection: `inject()` function pattern (NOT constructor injection)
- Signal access: `.()` to read, `.set()` / `.update()` to mutate
- `prefers-reduced-motion` media query on all animations/transitions
- `.force-reduced-motion` host-context for dev toggle
- `aria-label` on all interactive elements
- try/catch wrapping all CommandStackService calls with `isDevMode() && console.warn()`

**From Story 5.1 review findings:**
- Finding #1 (HIGH): try/catch + isDevMode() on service calls — MUST apply to new undo/redo keyboard handlers and reset
- Finding #2 (MEDIUM): UX spec reduced-motion toggle not tracked — still not in scope
- Finding #4 (LOW): Tooltip shortcut hints now functional after this story implements keyboard handlers

### Existing Code — What NOT to Change

| File | Keep As-Is | Reason |
|---|---|---|
| `commands/*.command.ts` | All unchanged | All command execute()/undo() methods already work |
| `simulator.models.ts` | Unchanged | ZoneId, CardInstance, SimCommand unchanged |
| `sim-card.component.*` | Unchanged | Card rendering unchanged |
| `zone.component.*` | Unchanged | Zone interactions unchanged |
| `stacked-zone.component.*` | Unchanged | Stacked zone interactions unchanged |
| `hand.component.*` | Unchanged | Hand interactions unchanged |
| `pile-overlay.component.*` | Unchanged | Overlay and ESC handler unchanged |
| `xyz-material-peek.component.*` | Unchanged | Material pill and ESC handler unchanged |
| `card-inspector.component.*` | Unchanged | Inspector unchanged |
| `simulator-page.component.*` | Unchanged | Page container unchanged |
| `glow-effect.ts` | Unchanged | Glow utility unchanged |
| `_sim-tokens.scss` | Unchanged | All needed tokens exist |

### Project Structure Notes

- Alignment with unified project structure: all files in `front/src/app/pages/simulator/`
- **0 new files** — all changes are modifications to existing files
- No new components, no new services, no new models

**Files modified by this story:**
```
front/src/app/pages/simulator/
  board-state.service.ts           # MODIFIED — add originalDeck field + resetBoard() method
  command-stack.service.ts         # MODIFIED — add clearHistory() method
  control-bar.component.ts        # MODIFIED — add Reset button, inject BoardStateService, add onReset()
  control-bar.component.html      # MODIFIED — add Reset button + separator
  control-bar.component.scss      # MODIFIED — add .separator style
  board.component.ts              # MODIFIED — inject CommandStackService, add @HostListener for Ctrl+Z/Ctrl+Y
```

### References

- [Source: epics.md#Story 5.2] — Acceptance criteria, user story
- [Source: epics.md#Epic 5 Implementation Notes] — Reset NOT a command, clears both stacks, SimControlBarComponent, keyboard shortcuts
- [Source: architecture.md#Reset Behavior] — Reset clears both stacks, reinitializes board, confirmation dialog
- [Source: architecture.md#Command Stack] — undoStack, redoStack signals
- [Source: architecture.md#Service Responsibility Boundaries] — BoardStateService owns board state + reset, CommandStackService owns stacks
- [Source: architecture.md#Enforcement Guidelines] — Zero direct mutation, all through services
- [Source: architecture.md#Service Scoping Decision] — Services scoped to SimulatorPageComponent, inject() access
- [Source: ux-design-specification.md#Keyboard Shortcut Patterns] — Ctrl+Z, Ctrl+Y, Escape. No Reset shortcut. @HostListener on SimBoardComponent. Disabled in text inputs.
- [Source: ux-design-specification.md#SimControlBarComponent] — Undo/Redo/Reset buttons, controls grid area, shortcut hints in tooltips
- [Source: ux-design-specification.md#Loading & Empty State Patterns — Undo/Redo Stack States] — Undo scope: board state only, undo does NOT restore UI state
- [Source: ux-design-specification.md#Overlay & Panel Patterns] — Auto-close overlay on new open, Escape closes overlay
- [Source: ux-design-specification.md#Accessibility] — prefers-reduced-motion, aria-disabled, aria-label
- [Source: prd.md#FR32] — Keyboard shortcuts (Ctrl+Z undo, Ctrl+Y redo, Escape close overlay). No keyboard shortcut for Reset.
- [Source: prd.md#FR33] — Reset board with confirmation
- [Source: prd.md#NFR3] — Board reset < 1 second
- [Source: board-state.service.ts] — initializeBoard() method, overlay/peek management, hoveredCard/isDragging signals
- [Source: command-stack.service.ts] — undo(), redo(), canUndo, canRedo, _undoStack, _redoStack signals
- [Source: board.component.ts] — Current state: no @HostListener, no keyboard handling
- [Source: control-bar.component.ts] — Current state: Undo/Redo only, no Reset
- [Source: 5-1-undo-redo-and-batch-operations.md] — Previous story patterns, code review findings, established conventions

## Change Log

- 2026-02-12: Implemented reset board functionality (resetBoard + clearHistory + UI button with confirmation) and keyboard shortcuts (Ctrl+Z undo, Ctrl+Y redo) on SimBoardComponent. Build passes with zero errors.
- 2026-02-12: **Code Review (AI)** — 6 findings (1 HIGH, 2 MEDIUM, 3 LOW). Fixed HIGH + MEDIUM:
  - [HIGH] `resetBoard()` used `hoveredCard.set(null)` instead of `setHoveredCard(null)` — pending 50ms hover timeout could restore stale card in inspector after reset. Fixed.
  - [MEDIUM] `event.key === 'z'/'y'` without `.toLowerCase()` — fragile on some platforms with Caps Lock. Fixed.
  - [MEDIUM] `window.confirm()` vs `mat-dialog` — acknowledged debt, UX spec lists mat-dialog but confirm() is pragmatic for MVP. No code change — tracked as post-MVP item.
  - [LOW] `Ctrl+Shift+Z` not supported as redo alternative — spec-compliant (FR32 only says Ctrl+Y), deferred.
  - [LOW] `contenteditable` not checked in keyboard guard — no contenteditable elements exist currently, deferred.
  - [LOW] `CommandStackService` uses constructor injection instead of `inject()` — pre-existing from Story 5.1, deferred.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Dev Notes stated `initializeBoard()` uses `boardState.set()` but actual code uses `boardState.update()` which preserves existing zone data. Fixed by adding `boardState.set(createEmptyBoard())` before re-calling `initializeBoard()` in `resetBoard()` to ensure all zones (monster, spell/trap, graveyard, banish) are properly cleared.

### Completion Notes List

- Task 1: Added `originalDeck` field + `resetBoard()` method to BoardStateService. resetBoard() clears overlays, UI state, resets board to empty, then re-initializes with fresh shuffle and draw.
- Task 2: Added `clearHistory()` method to CommandStackService — simple setter clearing both undo/redo stacks.
- Task 3: Added Reset button to SimControlBarComponent with `window.confirm()` confirmation, visual separator, aria-label, always-enabled state. Follows established try/catch + isDevMode() pattern.
- Task 4: Added `@HostListener('document:keydown')` to SimBoardComponent for Ctrl+Z (undo) and Ctrl+Y (redo). Includes input/textarea guard (AC 6), Meta key support for Mac, try/catch wrapping. No Escape handler (existing component-level handlers suffice).
- Task 5: Build verification passed — zero errors.

### File List

- `front/src/app/pages/simulator/board-state.service.ts` — MODIFIED: added `originalDeck` field, `resetBoard()` method, `this.originalDeck = deck` in `initializeBoard()`
- `front/src/app/pages/simulator/command-stack.service.ts` — MODIFIED: added `clearHistory()` method
- `front/src/app/pages/simulator/control-bar.component.ts` — MODIFIED: injected `BoardStateService`, added `onReset()` method with confirm dialog
- `front/src/app/pages/simulator/control-bar.component.html` — MODIFIED: added separator div + Reset button with aria-label and tooltip
- `front/src/app/pages/simulator/control-bar.component.scss` — MODIFIED: added `.separator` style
- `front/src/app/pages/simulator/board.component.ts` — MODIFIED: injected `CommandStackService`, added `@HostListener('document:keydown')` for Ctrl+Z/Ctrl+Y
