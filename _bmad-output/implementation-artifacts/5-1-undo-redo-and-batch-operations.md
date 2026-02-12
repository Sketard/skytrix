# Story 5.1: Undo, Redo & Batch Operations

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to undo and redo my actions to explore different combo lines,
so that I can try alternative sequences without resetting the entire board.

## Acceptance Criteria

1. **Given** I have performed card actions (moves, flips, position toggles, shuffles),
   **When** I click the Undo button in `SimControlBarComponent`,
   **Then** the last command is popped from `undoStack`, `undo()` is called, and the command is pushed to `redoStack`,
   **And** the board state reverts to before that action.

2. **Given** I have undone an action,
   **When** I click the Redo button,
   **Then** the last command is popped from `redoStack`, `execute()` is called, and the command is pushed to `undoStack`,
   **And** the board state re-applies that action.

3. **Given** a batch operation is needed (e.g., mill 3 cards from deck to GY),
   **When** `CommandStackService.executeBatch(commands: SimCommand[])` is called,
   **Then** a `CompositeCommand` wraps all sub-commands and executes them sequentially,
   **And** the CompositeCommand is pushed as a single entry on the `undoStack`,
   **And** undoing the CompositeCommand undoes all sub-commands in reverse order as a single unit.

4. **Given** the `undoStack` is empty,
   **When** the Undo button renders,
   **Then** it is visually disabled (dimmed icon, `aria-disabled="true"`).

5. **Given** the `redoStack` is empty,
   **When** the Redo button renders,
   **Then** it is visually disabled.

6. **Given** I perform a new action after undoing,
   **When** the new command executes,
   **Then** the `redoStack` is cleared (redo history lost — standard undo/redo behavior).

7. **Given** undo is triggered,
   **When** the board state reverts,
   **Then** no overlay is re-opened and inspector state is not restored — undo scope is board state only.

## Tasks / Subtasks

- [x] **Task 1: Create SimControlBarComponent** (AC: 1, 2, 4, 5)
  - [x] 1.1: Create `control-bar.component.ts` with selector `app-sim-control-bar`, standalone, OnPush
  - [x] 1.2: Inject `CommandStackService` via `inject()`
  - [x] 1.3: Expose `canUndo` and `canRedo` from CommandStackService as component properties
  - [x] 1.4: Add `onUndo()` method → calls `commandStack.undo()`
  - [x] 1.5: Add `onRedo()` method → calls `commandStack.redo()`
  - [x] 1.6: Create template with Undo and Redo `mat-icon-button` buttons
  - [x] 1.7: Add `mat-tooltip` with shortcut hints: "Undo (Ctrl+Z)", "Redo (Ctrl+Y)"
  - [x] 1.8: Bind `[disabled]="!canUndo()"` and `[disabled]="!canRedo()"` on respective buttons
  - [x] 1.9: Add `aria-label` on each button, `aria-disabled` bound to disabled state
  - [x] 1.10: Style with `_sim-tokens.scss`: `$sim-text-primary` for active icons, `$sim-text-secondary` with reduced opacity for disabled icons

- [x] **Task 2: Create SimControlBarComponent template** (AC: 4, 5)
  - [x] 2.1: Undo button: `mat-icon` "undo", disabled when `!canUndo()`
  - [x] 2.2: Redo button: `mat-icon` "redo", disabled when `!canRedo()`
  - [x] 2.3: Horizontal layout in `controls` grid area, buttons left-aligned

- [x] **Task 3: Create SimControlBarComponent styles** (AC: 4, 5)
  - [x] 3.1: Import `@use 'sim-tokens' as *`
  - [x] 3.2: Container: `display: flex`, `align-items: center`, `gap: $sim-gap-card`
  - [x] 3.3: Buttons: `$sim-text-primary` color, `$sim-surface-elevated` hover background
  - [x] 3.4: Disabled state: `$sim-text-secondary` color with 0.4 opacity, no hover effect
  - [x] 3.5: `prefers-reduced-motion` support: disable any button transitions

- [x] **Task 4: Integrate SimControlBarComponent into SimBoardComponent** (AC: 1, 2)
  - [x] 4.1: Import `SimControlBarComponent` in `board.component.ts`
  - [x] 4.2: Replace `<div class="controls-placeholder">` with `<app-sim-control-bar [style.grid-area]="'controls'" />` in `board.component.html`
  - [x] 4.3: Remove `.controls-placeholder` CSS rule from `board.component.scss`

- [x] **Task 5: Verify existing undo/redo and batch infrastructure** (AC: 1, 2, 3, 6, 7)
  - [x] 5.1: Confirm `CommandStackService.undo()` pops from undoStack, calls `command.undo()`, pushes to redoStack
  - [x] 5.2: Confirm `CommandStackService.redo()` pops from redoStack, calls `command.execute()`, pushes to undoStack
  - [x] 5.3: Confirm `execute()` clears redoStack after new command (AC 6)
  - [x] 5.4: Confirm `executeBatch()` wraps commands in `CompositeCommand` and `CompositeCommand.undo()` reverses in correct order (AC 3)
  - [x] 5.5: Confirm undo does NOT re-open overlays or restore inspector state (AC 7)

- [x] **Task 6: Verify build** (AC: all)
  - [x] 6.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **CommandStackService undo/redo infrastructure is ALREADY IMPLEMENTED.** Since Epic 2, `undo()`, `redo()`, `canUndo`, `canRedo`, `execute()`, and `executeBatch()` have been filling stacks silently. This story EXPOSES these to the user via buttons — do NOT reimpliment the stack logic. [Source: command-stack.service.ts, architecture.md#Command Stack]
- **CompositeCommand already works for batch operations.** Mill N uses `executeBatch()` → `CompositeCommand` since Story 4.2. Undoing a CompositeCommand reverses all sub-commands in reverse order. Do NOT modify `CompositeCommand` or `executeBatch()`. [Source: commands/composite.command.ts, command-stack.service.ts:51-59]
- **SimControlBarComponent is a NEW file.** Currently, there is only a `controls-placeholder` div in `board.component.html`. Create the component and replace the placeholder. [Source: board.component.html:27]
- **No Reset button in this story.** Reset is Story 5.2. SimControlBarComponent should only have Undo and Redo buttons for now. Story 5.2 will ADD the Reset button to this component. [Source: epics.md#Story 5.2]
- **No keyboard shortcuts in this story.** Ctrl+Z, Ctrl+Y, and Escape are Story 5.2. Do NOT add `@HostListener` keyboard handlers. [Source: epics.md#Story 5.2]
- **Undo scope: board state only.** Undo reverses card movements, flips, position changes, shuffles. It does NOT re-open overlays, restore inspector state, or reverse UI-only actions. This is already guaranteed by the command architecture — commands only mutate `boardState` signal. [Source: ux-design-specification.md#Undo/Redo Stack States]
- **Zero direct board state mutation.** All through CommandStackService. Components call `undo()` / `redo()` — never touch board state directly. [Source: architecture.md#Enforcement Guidelines]
- **Services scoped to SimulatorPageComponent.** `CommandStackService` is NOT `providedIn: 'root'` — it's scoped via `providers` on SimulatorPageComponent. SimControlBarComponent accesses it via standard `inject()`. [Source: architecture.md#Service Scoping Decision]

### Implementation Details

#### SimControlBarComponent

```typescript
// control-bar.component.ts
@Component({
  selector: 'app-sim-control-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './control-bar.component.html',
  styleUrl: './control-bar.component.scss',
})
export class SimControlBarComponent {
  private readonly commandStack = inject(CommandStackService);

  readonly canUndo = this.commandStack.canUndo;
  readonly canRedo = this.commandStack.canRedo;

  onUndo(): void {
    this.commandStack.undo();
  }

  onRedo(): void {
    this.commandStack.redo();
  }
}
```

#### SimControlBarComponent Template

```html
<!-- control-bar.component.html -->
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
</div>
```

#### SimControlBarComponent Styles

```scss
// control-bar.component.scss
@use 'sim-tokens' as *;

:host {
  display: block;
}

.control-bar {
  display: flex;
  align-items: center;
  gap: $sim-gap-card;
  padding: $sim-padding-zone;
  height: 100%;
}

button {
  color: $sim-text-primary;
  transition: background 100ms ease;

  &:hover:not(:disabled) {
    background: $sim-surface-elevated;
  }

  &:disabled {
    color: $sim-text-secondary;
    opacity: 0.4;
  }
}

@media (prefers-reduced-motion: reduce) {
  button {
    transition: none;
  }
}

:host-context(.force-reduced-motion) {
  button {
    transition: none;
  }
}
```

#### Board Integration

```typescript
// board.component.ts — add import:
import { SimControlBarComponent } from './control-bar.component';

// Add to imports array:
imports: [..., SimControlBarComponent],
```

```html
<!-- board.component.html — replace controls-placeholder: -->
<app-sim-control-bar [style.grid-area]="'controls'" />
```

### Edge Cases

- **Empty stacks at game start:** Both `canUndo` and `canRedo` return `false` → both buttons disabled. First action enables Undo.
- **Undo all actions:** Player undoes every action back to initial state. `undoStack` empty → Undo disabled. All commands in `redoStack` → Redo enabled.
- **Redo then new action:** Player undoes 3 actions (3 in redoStack), redoes 1, then performs new action → redoStack cleared (loses the 2 remaining redo commands). Standard behavior per `execute()` method.
- **Undo composite (mill 3):** Single click undoes all 3 card movements. Board state reflects pre-mill state. `CompositeCommand.undo()` reverses sub-commands in reverse order.
- **Undo XYZ material attach/detach:** Works automatically — `MoveCardCommand` with `materialContext` has full undo logic (Story 4.3). No special handling needed.
- **Rapid undo/redo clicks:** Signal-based reactivity ensures each click processes the top of the stack at that moment. OnPush re-renders affected zones only.
- **Undo during overlay open:** Overlay remains open. Board state under the overlay changes. Overlay's computed signals reactively update the card list. No overlay close/re-open.
- **Undo during drag:** `isDragging` is `true`. Undo button is physically accessible but unlikely to be clicked during drag. If clicked, undo executes normally — CDK drag state may become stale. Acceptable edge case for manual solo testing tool.
- **Button disabled state + accessibility:** `[disabled]` prevents click events. `[attr.aria-disabled]` announces to assistive technology. `mat-tooltip` shows shortcut hint even on disabled buttons (Angular Material default behavior).

### NFR Compliance

- **NFR1 (<16ms frame):** Button clicks trigger `undo()` / `redo()` which do a single `boardState.update()` — well within frame budget.
- **NFR2 (<100ms board update):** `boardState.update()` with immutable spread. Computed signals propagate instantly. OnPush re-renders only affected zones.
- **NFR4 (responsive with 20+ cards):** Undo/redo buttons add zero rendering overhead to the board.
- **`prefers-reduced-motion`:** Button hover transitions disabled. No animations on undo/redo state change.

### What This Story Does NOT Include

- **No Reset button** — Story 5.2 adds Reset to SimControlBarComponent
- **No keyboard shortcuts** (Ctrl+Z, Ctrl+Y, Escape) — Story 5.2 adds `@HostListener` on SimBoardComponent
- **No confirmation dialogs** — Undo/redo are instant, no confirmation needed
- **No undo history visualization** — Not in scope (post-MVP)
- **No undo limit** — Stack grows unbounded within session (acceptable for ephemeral solo testing)

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `SimControlBarComponent` (Undo, Redo) | Story 5.2 — adds Reset button + keyboard shortcuts |
| Verification that undo/redo/batch work | Story 5.2 — keyboard shortcuts call same `undo()` / `redo()` |

### Previous Story Intelligence (Story 4.3)

**Patterns established — MUST follow:**
- SCSS import: `@use 'sim-tokens' as *` (Dart Sass 2.0, NOT `@import`)
- Service injection: `inject()` function pattern (NOT constructor injection)
- Signal access: `.()` to read, `.set()` / `.update()` to mutate
- `prefers-reduced-motion` media query on all animations/transitions
- `.force-reduced-motion` host-context for dev toggle
- `aria-label` on all interactive elements
- try/catch wrapping all CommandStackService calls with `console.warn` in devMode

**Code review fixes from 4.1/4.2/4.3 to maintain:**
- Mutual exclusion between overlays — already enforced
- `isDevMode()` guards on debug console output
- `cdkDragPreviewContainer: 'global'` on all overlay drags (not needed here — no drag in control bar)

### Existing Code — What NOT to Change

| File | Keep As-Is | Reason |
|---|---|---|
| `command-stack.service.ts` | Unchanged | undo(), redo(), canUndo, canRedo already correct |
| `commands/composite.command.ts` | Unchanged | CompositeCommand.undo() already reverses correctly |
| `commands/*.command.ts` | All unchanged | All command execute()/undo() methods already work |
| `board-state.service.ts` | Unchanged | Board state signal architecture unchanged |
| `simulator.models.ts` | Unchanged | SimCommand interface unchanged |
| `sim-card.component.*` | Unchanged | Card rendering unchanged |
| `zone.component.*` | Unchanged | Zone interactions unchanged |
| `stacked-zone.component.*` | Unchanged | Stacked zone interactions unchanged |
| `hand.component.*` | Unchanged | Hand interactions unchanged |
| `pile-overlay.component.*` | Unchanged | Overlay unchanged |
| `xyz-material-peek.component.*` | Unchanged | Material pill unchanged |
| `card-inspector.component.*` | Unchanged | Inspector unchanged |
| `simulator-page.component.*` | Unchanged | Page container unchanged |
| `glow-effect.ts` | Unchanged | Glow utility unchanged |
| `_sim-tokens.scss` | Unchanged | All needed tokens exist |

### Project Structure Notes

- Alignment with unified project structure: all files in `front/src/app/pages/simulator/`
- **3 new files** created: `control-bar.component.ts` + `.html` + `.scss`
- Component selector uses `app-sim-` prefix: `app-sim-control-bar`

**Files modified by this story:**
```
front/src/app/pages/simulator/
  board.component.ts               # MODIFIED — import SimControlBarComponent
  board.component.html             # MODIFIED — replace controls-placeholder with <app-sim-control-bar />
  board.component.scss             # MODIFIED — remove .controls-placeholder rule

front/src/app/pages/simulator/     # NEW FILES
  control-bar.component.ts         # NEW — Undo/Redo button component
  control-bar.component.html       # NEW — Undo/Redo button template
  control-bar.component.scss       # NEW — Undo/Redo button styles
```

### References

- [Source: epics.md#Story 5.1] — Acceptance criteria, user story
- [Source: epics.md#Epic 5 Implementation Notes] — Exposes undo/redo stacks from Epic 2, SimControlBarComponent, CompositeCommand for batch
- [Source: architecture.md#Command Stack] — undoStack, redoStack signals, execute/undo/redo flow
- [Source: architecture.md#Command Pattern Design] — 6 commands + CompositeCommand, delta-based
- [Source: architecture.md#Service Responsibility Boundaries] — CommandStackService owns undo/redo stacks, exposes canUndo/canRedo
- [Source: architecture.md#Enforcement Guidelines] — Zero direct mutation, components call semantic methods
- [Source: architecture.md#Project Structure & Boundaries] — control-bar.component.ts in simulator directory
- [Source: ux-design-specification.md#SimControlBarComponent] — Undo/Redo/Reset buttons, grid area "controls", keyboard shortcut hints in tooltips
- [Source: ux-design-specification.md#Keyboard Shortcut Patterns] — Ctrl+Z undo, Ctrl+Y redo (shortcuts added in Story 5.2)
- [Source: ux-design-specification.md#Loading & Empty State Patterns — Undo/Redo Stack States] — Disabled button styling, undo scope: board state only
- [Source: ux-design-specification.md#Accessibility] — aria-disabled, aria-label, prefers-reduced-motion
- [Source: prd.md#FR29] — Undo last action
- [Source: prd.md#FR30] — Redo undone action
- [Source: prd.md#FR31] — Batch undo/redo (CompositeCommand)
- [Source: command-stack.service.ts] — Existing undo/redo/execute/executeBatch implementation
- [Source: commands/composite.command.ts] — CompositeCommand with reverse-order undo
- [Source: board.component.html:27] — Current controls-placeholder to replace
- [Source: 4-3-xyz-material-management.md] — Previous story patterns, established conventions

## Senior Developer Review (AI)

**Reviewer:** Axel (adversarial code review via Claude Opus 4.6)
**Date:** 2026-02-12
**Outcome:** Approved with fixes applied

### Findings Summary

| # | Severity | Description | Resolution |
|---|---|---|---|
| 1 | HIGH | Missing try/catch + isDevMode() on undo/redo calls — pattern violation vs all other components | **FIXED** — wrapped both calls, added isDevMode import |
| 2 | MEDIUM | UX Spec requires dev-only reduced-motion toggle in SimControlBarComponent (ux-design-specification.md line 1141) but no story tracks it | **ACTION ITEM** — planning gap to track separately |
| 3 | LOW | `role="toolbar"` without WAI-ARIA roving tabindex keyboard pattern | Accepted — only 2 buttons, minimal impact |
| 4 | LOW | Tooltip shortcut hints ("Ctrl+Z", "Ctrl+Y") non-functional until Story 5.2 | Accepted — by design per story spec |
| 5 | LOW | Task 4.3 "remove .controls-placeholder CSS" unverifiable via git (simulator/ never committed) | Accepted — current state correct |

### Fixes Applied

1. `control-bar.component.ts`: Added `isDevMode` import from `@angular/core`, wrapped `onUndo()` and `onRedo()` in try/catch with `isDevMode() && console.warn()` — matches established pattern in zone.component.ts, stacked-zone.component.ts, hand.component.ts, pile-overlay.component.ts
2. Build verified: zero errors after fix

### Review Follow-ups (AI)

- [ ] [AI-Review][MEDIUM] Track UX Spec reduced-motion dev toggle for SimControlBarComponent — not assigned to any story (ref: ux-design-specification.md line 1141)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No debug issues encountered. Clean implementation matching story specifications exactly.

### Completion Notes List

- Created `SimControlBarComponent` with Undo/Redo buttons exposing existing `CommandStackService.undo()`/`redo()` infrastructure
- Component uses `inject()` pattern, OnPush change detection, standalone with MatIconModule/MatButtonModule/MatTooltipModule
- Template includes `role="toolbar"`, `aria-label`, `aria-disabled`, `matTooltip` with keyboard shortcut hints
- Styles follow established patterns: `@use 'sim-tokens' as *`, `prefers-reduced-motion` media query, `.force-reduced-motion` host-context
- Replaced `controls-placeholder` div in board with `<app-sim-control-bar>` in grid area "controls"
- Verified all 7 ACs satisfied by existing infrastructure + new UI component
- Build passes with zero errors

### File List

**New files:**
- `front/src/app/pages/simulator/control-bar.component.ts` — SimControlBarComponent class
- `front/src/app/pages/simulator/control-bar.component.html` — Undo/Redo button template
- `front/src/app/pages/simulator/control-bar.component.scss` — Control bar styles

**Modified files:**
- `front/src/app/pages/simulator/board.component.ts` — Added SimControlBarComponent import
- `front/src/app/pages/simulator/board.component.html` — Replaced controls-placeholder with `<app-sim-control-bar>`
- `front/src/app/pages/simulator/board.component.scss` — Removed `.controls-placeholder` CSS rule

## Change Log

- **2026-02-12:** Implemented Story 5.1 — Created SimControlBarComponent with Undo/Redo buttons, integrated into board grid, verified existing undo/redo/batch infrastructure, build passes clean
- **2026-02-12:** Code review — 1 HIGH fix applied (try/catch on undo/redo), 1 MEDIUM action item tracked (UX spec reduced-motion toggle gap), 3 LOW accepted
