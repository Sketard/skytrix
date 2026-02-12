# Story 3.1: Card State Toggle via Context Menu

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to right-click a card on the board to change its position or flip it face-down,
so that I can simulate set/flip/position changes during combo testing.

## Acceptance Criteria

1. **Given** a face-up ATK position card is on the board,
   **When** I right-click on it,
   **Then** a `mat-menu` appears with options: "Flip face-down", "Change to DEF".

2. **Given** a face-up DEF position card is on the board,
   **When** I right-click on it,
   **Then** a `mat-menu` appears with options: "Flip face-down", "Change to ATK".

3. **Given** a face-down card is on the board,
   **When** I right-click on it,
   **Then** a `mat-menu` appears with options: "Flip face-up (ATK)", "Flip face-up (DEF)".

4. **Given** I select a state change option from the context menu,
   **When** the action executes,
   **Then** `CommandStackService.flipCard()` or `CommandStackService.togglePosition()` is called,
   **And** `FlipCardCommand` or `TogglePositionCommand` is created and executed,
   **And** the card's visual state updates immediately (rotation for DEF, card back for face-down).

5. **Given** I right-click a card in the hand or in an overlay,
   **When** the context menu event fires,
   **Then** no context menu appears (card state toggle is board-only).

6. **Given** `isDevMode()` returns `true`,
   **When** I right-click a card on the board,
   **Then** the browser default context menu remains accessible (no `event.preventDefault()`).

## Tasks / Subtasks

- [x] **Task 1: Create FlipCardCommand** (AC: 4)
  - [x] 1.1: Create `commands/flip-card.command.ts` implementing `SimCommand`
  - [x] 1.2: Constructor receives `BoardStateService`, `cardInstanceId: string`, `zoneId: ZoneId`, `targetFaceDown: boolean`
  - [x] 1.3: Capture previous `faceDown` state at construction time; throw if card not found
  - [x] 1.4: `execute()` updates `boardState` immutably — produces new `CardInstance` with toggled `faceDown`
  - [x] 1.5: `undo()` restores previous `faceDown` state via immutable update

- [x] **Task 2: Create TogglePositionCommand** (AC: 4)
  - [x] 2.1: Create `commands/toggle-position.command.ts` implementing `SimCommand`
  - [x] 2.2: Constructor receives `BoardStateService`, `cardInstanceId: string`, `zoneId: ZoneId`, `targetPosition: 'ATK' | 'DEF'`
  - [x] 2.3: Capture previous `position` state at construction time; throw if card not found
  - [x] 2.4: `execute()` updates `boardState` immutably — produces new `CardInstance` with toggled `position`
  - [x] 2.5: `undo()` restores previous `position` via immutable update

- [x] **Task 3: Register commands and add semantic methods** (AC: 4)
  - [x] 3.1: Export `FlipCardCommand` and `TogglePositionCommand` from `commands/index.ts`
  - [x] 3.2: Add `flipCard(cardInstanceId: string, zoneId: ZoneId, targetFaceDown: boolean): void` to `CommandStackService`
  - [x] 3.3: Add `togglePosition(cardInstanceId: string, zoneId: ZoneId, targetPosition: 'ATK' | 'DEF'): void` to `CommandStackService`

- [x] **Task 4: Add context menu to SimZoneComponent** (AC: 1, 2, 3, 5, 6)
  - [x] 4.1: Import `MatMenuModule`, `MatIconModule`, `MatMenuTrigger` in `zone.component.ts`
  - [x] 4.2: Add `@ViewChild('cardMenuTrigger') cardMenuTrigger?: MatMenuTrigger` and `@ViewChild('menuAnchor') menuAnchor?: ElementRef<HTMLElement>`
  - [x] 4.3: Add `isDevMode` import from `@angular/core`
  - [x] 4.4: Add computed signals for dynamic menu items based on card state: `isFaceDown`, `isFaceUpAtk`, `isFaceUpDef`
  - [x] 4.5: Add `onContextMenu(event: MouseEvent)` handler — position anchor at cursor, open menu, `isDevMode()` guard for `preventDefault`
  - [x] 4.6: Add action handlers: `onFlipFaceDown()`, `onFlipFaceUp(position: 'ATK' | 'DEF')`, `onTogglePosition()`
  - [x] 4.7: Update `zone.component.html` — add `(contextmenu)` on root div, add hidden anchor + `mat-menu` with dynamic items via `@if`
  - [x] 4.8: Update `zone.component.scss` — add `.context-menu-anchor` positioning styles (same as stacked-zone pattern)

- [x] **Task 5: Verify build** (AC: all)
  - [x] 5.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **Zero direct board state mutation from components.** Components call `CommandStackService` semantic methods only. Components NEVER call `boardState.update()` directly. [Source: architecture.md#Action Flow Pattern]
- **Commands are internal to CommandStackService.** Components NEVER import from `commands/`. They call semantic methods like `commandStack.flipCard()`, `commandStack.togglePosition()`. [Source: architecture.md#Service Responsibility Boundaries]
- **Context menu is board-only.** The right-click context menu for card state changes lives on `SimZoneComponent` (single-card board zones). `SimHandComponent` and future `SimPileOverlayComponent` do NOT get this menu. [Source: epics.md#Story 3.1 AC 5, ux-design-specification.md#Context Menu Patterns]
- **isDevMode() guard pattern.** `event.preventDefault()` on contextmenu event ONLY in production builds. In dev mode, both browser and custom menus may appear. This is by-design per UX spec. [Source: ux-design-specification.md#Context Menu Production Rule, 2-3 story dev notes]
- **Immutable state updates.** FlipCardCommand and TogglePositionCommand must produce new `CardInstance` objects (not mutate in place). The `boardState.update()` pattern replaces the card in the zone array with a new object having the toggled property. [Source: architecture.md#State Management Patterns]
- **"Flip face-down" forces DEF position.** In Yu-Gi-Oh!, face-down cards on the field are ALWAYS in DEF position (horizontal). `onFlipFaceDown()` must call `flipCard(id, zone, true, 'DEF')` to set both `faceDown: true` AND `position: 'DEF'` atomically. Without this, a card flipped face-down from ATK position would display a vertical card-back — visually incorrect.
- **Context menu suppressed during drag.** `onContextMenu()` must check `boardState.isDragging()` and return early if `true`. This prevents accidental menu opens during drag operations, consistent with the `isDragging` signal pattern used to suppress pills/overlays/inspector.

### Context Menu Design Decision: SimZoneComponent (not SimCardComponent)

The context menu is placed on `SimZoneComponent` rather than `SimCardComponent` for these reasons:

1. **Consistent pattern.** Story 2.3 placed the deck context menu on `SimStackedZoneComponent`. Same parent-owns-menu pattern.
2. **SimCardComponent stays pure.** Card remains a presentation component — receives `CardInstance` input, renders image/position. No service injection, no action logic.
3. **No input flag needed.** If the menu were on SimCardComponent, it would need an `isOnBoard` input to suppress in hand/overlay. Zone-level scoping avoids this.
4. **Service injection already exists.** SimZoneComponent already injects `CommandStackService` and `BoardStateService` for drag & drop. Context menu handlers reuse these.

### FlipCardCommand Implementation

```typescript
// flip-card.command.ts
import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId } from '../simulator.models';

export class FlipCardCommand implements SimCommand {
  private readonly previousFaceDown: boolean;

  constructor(
    private readonly boardState: BoardStateService,
    private readonly cardInstanceId: string,
    private readonly zoneId: ZoneId,
    private readonly targetFaceDown: boolean,
  ) {
    const cards = this.boardState.boardState()[this.zoneId];
    const card = cards.find(c => c.instanceId === this.cardInstanceId);
    if (!card) {
      throw new Error(`FlipCardCommand: card ${this.cardInstanceId} not found in ${this.zoneId}`);
    }
    this.previousFaceDown = card.faceDown;
  }

  execute(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? { ...c, faceDown: this.targetFaceDown }
          : c
      );
      return newState;
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? { ...c, faceDown: this.previousFaceDown }
          : c
      );
      return newState;
    });
  }
}
```

### TogglePositionCommand Implementation

```typescript
// toggle-position.command.ts
import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId } from '../simulator.models';

export class TogglePositionCommand implements SimCommand {
  private readonly previousPosition: 'ATK' | 'DEF';

  constructor(
    private readonly boardState: BoardStateService,
    private readonly cardInstanceId: string,
    private readonly zoneId: ZoneId,
    private readonly targetPosition: 'ATK' | 'DEF',
  ) {
    const cards = this.boardState.boardState()[this.zoneId];
    const card = cards.find(c => c.instanceId === this.cardInstanceId);
    if (!card) {
      throw new Error(`TogglePositionCommand: card ${this.cardInstanceId} not found in ${this.zoneId}`);
    }
    this.previousPosition = card.position;
  }

  execute(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? { ...c, position: this.targetPosition }
          : c
      );
      return newState;
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? { ...c, position: this.previousPosition }
          : c
      );
      return newState;
    });
  }
}
```

### CommandStackService New Methods

```typescript
// Add to command-stack.service.ts — imports and methods:
import { FlipCardCommand, TogglePositionCommand } from './commands';

flipCard(cardInstanceId: string, zoneId: ZoneId, targetFaceDown: boolean): void {
  const cmd = new FlipCardCommand(this.boardStateService, cardInstanceId, zoneId, targetFaceDown);
  this.execute(cmd);
}

togglePosition(cardInstanceId: string, zoneId: ZoneId, targetPosition: 'ATK' | 'DEF'): void {
  const cmd = new TogglePositionCommand(this.boardStateService, cardInstanceId, zoneId, targetPosition);
  this.execute(cmd);
}
```

### SimZoneComponent Context Menu Implementation

```typescript
// Add to zone.component.ts — new imports:
import { ElementRef, ViewChild, isDevMode } from '@angular/core';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';

// Add to imports array:
imports: [DragDropModule, SimCardComponent, MatMenuModule, MatIconModule],

// Add ViewChild refs:
@ViewChild('cardMenuTrigger') cardMenuTrigger?: MatMenuTrigger;
@ViewChild('menuAnchor') menuAnchor?: ElementRef<HTMLElement>;

// Add computed signals for dynamic menu:
readonly isFaceDown = computed(() => this.card()?.faceDown ?? false);
readonly isFaceUpAtk = computed(() => {
  const c = this.card();
  return c !== null && !c.faceDown && c.position === 'ATK';
});
readonly isFaceUpDef = computed(() => {
  const c = this.card();
  return c !== null && !c.faceDown && c.position === 'DEF';
});

// Context menu handler (reuses stacked-zone cursor-position pattern):
onContextMenu(event: MouseEvent): void {
  const c = this.card();
  if (!c) return; // Empty zone — no menu
  if (this.boardState.isDragging()) return; // Suppress during drag

  if (!isDevMode()) {
    event.preventDefault();
  }

  if (this.menuAnchor) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuAnchor.nativeElement.style.left = `${event.clientX - rect.left}px`;
    this.menuAnchor.nativeElement.style.top = `${event.clientY - rect.top}px`;
  }
  this.cardMenuTrigger?.openMenu();
}

// Action handlers — delegate to CommandStackService:

onFlipFaceDown(): void {
  const c = this.card();
  if (!c) return;
  try {
    // Face-down cards are ALWAYS in DEF position in Yu-Gi-Oh!
    this.commandStack.flipCard(c.instanceId, this.zoneId(), true, 'DEF');
  } catch {
    // Silently ignored
  }
}

onFlipFaceUp(position: 'ATK' | 'DEF'): void {
  const c = this.card();
  if (!c) return;
  try {
    this.commandStack.flipCard(c.instanceId, this.zoneId(), false);
    // Also set the target position when flipping face-up
    this.commandStack.togglePosition(c.instanceId, this.zoneId(), position);
  } catch {
    // Silently ignored
  }
}

onTogglePosition(): void {
  const c = this.card();
  if (!c) return;
  const targetPosition = c.position === 'ATK' ? 'DEF' : 'ATK';
  try {
    this.commandStack.togglePosition(c.instanceId, this.zoneId(), targetPosition);
  } catch {
    // Silently ignored
  }
}
```

**Critical: "Flip face-up (ATK)" and "Flip face-up (DEF)" semantics.**

When a face-down card is flipped face-up, the player chooses which position to flip into. This requires TWO state changes (faceDown + position). Options:

1. **Two separate commands** — `flipCard` + `togglePosition` (current implementation above). Problem: undo undoes only ONE command. The player would need to undo twice. Unacceptable for a single user action.
2. **FlipCardCommand handles both faceDown AND position** — single command, single undo. Better.
3. **CompositeCommand wrapping both** — technically correct but over-engineered for 2 mutations.

**Recommended: Option 2** — Extend `FlipCardCommand` to optionally set position when flipping face-up. The command captures both `previousFaceDown` and `previousPosition`, and the `execute()` sets both `faceDown` and `position` in one immutable update.

**Revised FlipCardCommand (handles both faceDown + optional position):**

```typescript
export class FlipCardCommand implements SimCommand {
  private readonly previousFaceDown: boolean;
  private readonly previousPosition: 'ATK' | 'DEF';

  constructor(
    private readonly boardState: BoardStateService,
    private readonly cardInstanceId: string,
    private readonly zoneId: ZoneId,
    private readonly targetFaceDown: boolean,
    private readonly targetPosition?: 'ATK' | 'DEF', // optional: set when flipping face-up
  ) {
    const cards = this.boardState.boardState()[this.zoneId];
    const card = cards.find(c => c.instanceId === this.cardInstanceId);
    if (!card) {
      throw new Error(`FlipCardCommand: card ${this.cardInstanceId} not found in ${this.zoneId}`);
    }
    this.previousFaceDown = card.faceDown;
    this.previousPosition = card.position;
  }

  execute(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? {
              ...c,
              faceDown: this.targetFaceDown,
              ...(this.targetPosition !== undefined ? { position: this.targetPosition } : {}),
            }
          : c
      );
      return newState;
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? { ...c, faceDown: this.previousFaceDown, position: this.previousPosition }
          : c
      );
      return newState;
    });
  }
}
```

**Revised CommandStackService method:**

```typescript
flipCard(cardInstanceId: string, zoneId: ZoneId, targetFaceDown: boolean, targetPosition?: 'ATK' | 'DEF'): void {
  const cmd = new FlipCardCommand(this.boardStateService, cardInstanceId, zoneId, targetFaceDown, targetPosition);
  this.execute(cmd);
}
```

**Revised action handlers in SimZoneComponent:**

```typescript
onFlipFaceDown(): void {
  const c = this.card();
  if (!c) return;
  try {
    // Face-down cards are ALWAYS in DEF position in Yu-Gi-Oh!
    this.commandStack.flipCard(c.instanceId, this.zoneId(), true, 'DEF');
  } catch { /* silently ignored */ }
}

onFlipFaceUp(position: 'ATK' | 'DEF'): void {
  const c = this.card();
  if (!c) return;
  try {
    this.commandStack.flipCard(c.instanceId, this.zoneId(), false, position);
  } catch { /* silently ignored */ }
}

onTogglePosition(): void {
  const c = this.card();
  if (!c) return;
  const targetPosition = c.position === 'ATK' ? 'DEF' : 'ATK';
  try {
    this.commandStack.togglePosition(c.instanceId, this.zoneId(), targetPosition);
  } catch { /* silently ignored */ }
}
```

### SimZoneComponent Template Additions

```html
<!-- zone.component.html — updated -->
<div class="sim-zone"
     cdkDropList
     [cdkDropListData]="zoneId()"
     [cdkDropListSortingDisabled]="true"
     [cdkDropListEnterPredicate]="canDrop"
     (cdkDropListDropped)="onDrop($event)"
     [class.zone--just-dropped]="justDropped()"
     (animationend)="onGlowAnimationEnd()"
     (contextmenu)="onContextMenu($event)">
  @if (card(); as c) {
    <app-sim-card [cardInstance]="c"
                  cdkDrag
                  [cdkDragData]="c"
                  [attr.aria-label]="'Drag ' + c.card.card.name"
                  (cdkDragStarted)="onDragStarted()"
                  (cdkDragEnded)="onDragEnded()" />
  } @else {
    <span class="zone-label">{{ zoneConfig().label }}</span>
  }
  @if (isPendulum()) {
    <span class="pendulum-label">{{ pendulumLabel() }}</span>
  }

  <!-- Card state context menu (only rendered when zone has a card) -->
  @if (card()) {
    <span #cardMenuTrigger="matMenuTrigger"
          #menuAnchor
          [matMenuTriggerFor]="cardMenu"
          class="context-menu-anchor"></span>
    <mat-menu #cardMenu="matMenu">
      @if (isFaceUpAtk()) {
        <button mat-menu-item (click)="onFlipFaceDown()">
          <mat-icon>flip_to_back</mat-icon>
          <span>Flip face-down</span>
        </button>
        <button mat-menu-item (click)="onTogglePosition()">
          <mat-icon>screen_rotation</mat-icon>
          <span>Change to DEF</span>
        </button>
      }
      @if (isFaceUpDef()) {
        <button mat-menu-item (click)="onFlipFaceDown()">
          <mat-icon>flip_to_back</mat-icon>
          <span>Flip face-down</span>
        </button>
        <button mat-menu-item (click)="onTogglePosition()">
          <mat-icon>screen_rotation</mat-icon>
          <span>Change to ATK</span>
        </button>
      }
      @if (isFaceDown()) {
        <button mat-menu-item (click)="onFlipFaceUp('ATK')">
          <mat-icon>flip_to_front</mat-icon>
          <span>Flip face-up (ATK)</span>
        </button>
        <button mat-menu-item (click)="onFlipFaceUp('DEF')">
          <mat-icon>flip_to_front</mat-icon>
          <span>Flip face-up (DEF)</span>
        </button>
      }
    </mat-menu>
  }
</div>
```

### CSS Additions (zone.component.scss)

```scss
// Context menu anchor — same pattern as stacked-zone
.context-menu-anchor {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}
```

No animation changes needed for this story. The card's visual state change (rotation for DEF, card back for face-down) is already handled by existing `SimCardComponent` CSS classes (`.def-position` for DEF rotation, `.card-back` for face-down).

### What This Story Does NOT Include

- **No card inspector** (hover panel with effect text) — Story 3.2
- **No context menu on hand cards** — board-only per AC 5
- **No context menu on overlay cards** — board-only per AC 5
- **No context menu on stacked zone cards** (GY, Banished, ED, Deck) — stacked zones have their own context menu (Shuffle/Search)
- **No undo/redo UI** — Story 5.1 (stacks fill silently)
- **No keyboard shortcut for flip/toggle** — not specified in any FR
- **No card pills** (Send to GY, Banish shortcuts) — post-MVP per UX spec

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `FlipCardCommand` class | Story 5.1 (undo/redo exposes these commands) |
| `TogglePositionCommand` class | Story 5.1 (undo/redo exposes these commands) |
| `flipCard()` on CommandStackService | Standalone — card state management |
| `togglePosition()` on CommandStackService | Standalone — card state management |
| Context menu pattern on SimZoneComponent | Story 3.2 may reference this pattern for inspector trigger |
| Card state visual updates (faceDown/position) | SimCardComponent already renders these states correctly |

### Previous Story Intelligence (Story 2.3)

**Patterns established to follow:**
- SCSS import: `@use 'sim-tokens' as *` (not `@import`) — Dart Sass 2.0
- Service injection: `inject()` function pattern (not constructor injection in components)
- Signal access: read via `.()`, mutate via `.set()` or `.update()`
- Context menu pattern: `@ViewChild('menuTrigger') menuTrigger?: MatMenuTrigger` + hidden anchor `<span>` positioned at cursor coordinates
- Cursor-position menu: use `event.currentTarget.getBoundingClientRect()` offset for relative positioning of the anchor
- Gold glow: `createGlowEffect()` factory from `glow-effect.ts` — already in use on zone
- Drop handler: try/catch wrapping `commandStack` calls
- `isDragging` management via `(cdkDragStarted)` and `(cdkDragEnded)` on parent components
- `prefers-reduced-motion` media query on all animations
- `isDevMode()` guard for `event.preventDefault()` on contextmenu

**Story 2.3 code review fixes to maintain:**
- try/catch in all command service call sites (from H1 fix)
- `requestAnimationFrame` + timeout reset for glow restart on rapid drops (via `triggerGlow()`)
- `aria-label` on draggable cards
- Context menu opens at cursor position using ElementRef offset (from M1 fix)

### Existing Code — What NOT to Change

| File | Keep As-Is |
|---|---|
| `board-state.service.ts` | All existing code. No new methods or signals needed. `hoveredCard` and `isDragging` exist but unused by this story. |
| `simulator.models.ts` | `CardInstance` already has `faceDown` and `position` — no changes. `SimCommand` interface unchanged. |
| `sim-card.component.*` | Unchanged — already renders face-down (card-back div), DEF position (rotate 90deg), face-up (image). No context menu on card itself. |
| `hand.component.*` | Unchanged — no context menu on hand cards. |
| `stacked-zone.component.*` | Unchanged — existing deck context menu untouched. |
| `board.component.*` | Unchanged — `cdkDropListGroup` already present. |
| `simulator-page.component.*` | Unchanged. |
| `glow-effect.ts` | Unchanged — reused as-is. |
| `commands/move-card.command.ts` | Unchanged. |
| `commands/draw-card.command.ts` | Unchanged. |
| `commands/shuffle.command.ts` | Unchanged. |
| `commands/reorder-hand.command.ts` | Unchanged. |
| `commands/composite.command.ts` | Unchanged. |

### Project Structure Notes

**New files created by this story:**
```
front/src/app/pages/simulator/
  commands/flip-card.command.ts       # NEW — FlipCardCommand (faceDown + optional position toggle)
  commands/toggle-position.command.ts # NEW — TogglePositionCommand (ATK/DEF toggle)
```

**Files modified by this story:**
```
front/src/app/pages/simulator/
  commands/index.ts                   # MODIFIED — export FlipCardCommand, TogglePositionCommand
  command-stack.service.ts            # MODIFIED — add flipCard(), togglePosition() methods + imports
  zone.component.ts                   # MODIFIED — add context menu logic, MatMenu imports, ViewChild, action handlers, computed signals
  zone.component.html                 # MODIFIED — add (contextmenu), anchor, mat-menu with dynamic items
  zone.component.scss                 # MODIFIED — add .context-menu-anchor positioning
```

### References

- [Source: architecture.md#Action Flow Pattern] — Components call CommandStackService semantic methods only
- [Source: architecture.md#Service Responsibility Boundaries] — flipCard(), togglePosition() on CommandStackService; commands internal
- [Source: architecture.md#Command Pattern Design] — 6 concrete command types (FlipCardCommand #4, TogglePositionCommand #5) + CompositeCommand
- [Source: architecture.md#Error Handling Patterns] — try/catch in drop handlers, silent error recovery
- [Source: ux-design-specification.md#Context Menu Patterns] — Board card right-click: mat-menu with dynamic items based on card state
- [Source: ux-design-specification.md#Context Menu Production Rule] — isDevMode() guard for preventDefault
- [Source: ux-design-specification.md#Card State Indicators] — Face-up ATK (vertical), Face-up DEF (horizontal), Face-down (card back)
- [Source: ux-design-specification.md#Feedback & State Indication Patterns] — Card state visual changes
- [Source: epics.md#Story 3.1] — Acceptance criteria, user story
- [Source: epics.md#Epic 3 Implementation Notes] — FlipCardCommand + TogglePositionCommand added to CommandStackService, event.preventDefault() guard
- [Source: 2-3-draw-shuffle-and-hand-management.md] — Context menu pattern (mat-menu + cursor positioning + isDevMode guard), try/catch drop handlers
- [Source: stacked-zone.component.ts] — Reference implementation for context menu anchor + ViewChild pattern
- [Source: zone.component.ts] — Current implementation to modify (inject, canDrop, onDrop, glow)
- [Source: sim-card.component.*] — Card rendering already handles faceDown/position visually — no changes needed
- [Source: simulator.models.ts] — CardInstance.faceDown, CardInstance.position already defined

## Change Log

- **2026-02-11**: Implemented Story 3.1 — Card State Toggle via Context Menu. Created FlipCardCommand (with optional position parameter for atomic flip+position changes), TogglePositionCommand, registered both in CommandStackService with semantic methods, and added mat-menu context menu to SimZoneComponent with dynamic items based on card state. Build passes with zero errors.
- **2026-02-11**: Code review (AI) — 1 HIGH, 4 MEDIUM, 2 LOW findings. Fixed 5 issues:
  - H1: Added `isDragging()` guard to `stacked-zone.component.ts:onContextMenu()` (cross-story fix from 2-3)
  - M1: Added try/catch to `stacked-zone.component.ts:onShuffle()` (cross-story fix from 2-3)
  - M2: Simplified template duplication — merged duplicate "Flip face-down" button into single `@if (!isFaceDown())` block
  - M3: Added `triggerGlow()` on context menu actions for visual feedback consistency with drag & drop
  - M4: Added `console.warn` in dev mode in all action handler catch blocks for debugging
  - L1, L2 deferred (code clarity comment + CSS transition — cosmetic). Build passes with zero errors.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- No errors encountered during implementation. Build passed on first attempt.

### Completion Notes List

- **Task 1**: Created `FlipCardCommand` following the "Revised" Option 2 pattern from Dev Notes — handles both `faceDown` AND optional `position` in a single command for atomic flip operations. Captures both `previousFaceDown` and `previousPosition` for proper undo. This ensures "Flip face-down" (forces DEF) and "Flip face-up (ATK/DEF)" each produce a single undoable action.
- **Task 2**: Created `TogglePositionCommand` for ATK/DEF position changes on face-up cards. Follows same immutable update pattern as existing commands.
- **Task 3**: Exported both commands from `commands/index.ts`. Added `flipCard()` and `togglePosition()` semantic methods to `CommandStackService` with the `targetPosition?` optional parameter on `flipCard()`.
- **Task 4**: Added context menu to `SimZoneComponent` — imports MatMenuModule/MatIconModule, ViewChild refs for trigger/anchor, 3 computed signals (isFaceDown, isFaceUpAtk, isFaceUpDef), `onContextMenu()` handler with isDragging guard and isDevMode() check, 3 action handlers delegating to CommandStackService with try/catch. Template updated with `(contextmenu)` binding, hidden anchor span, and `mat-menu` with dynamic `@if` items per card state. SCSS adds `.context-menu-anchor` absolute positioning.
- **Task 5**: `ng build --configuration development` — zero errors.

### File List

**New files:**
- `front/src/app/pages/simulator/commands/flip-card.command.ts`
- `front/src/app/pages/simulator/commands/toggle-position.command.ts`

**Modified files:**
- `front/src/app/pages/simulator/commands/index.ts`
- `front/src/app/pages/simulator/command-stack.service.ts`
- `front/src/app/pages/simulator/zone.component.ts`
- `front/src/app/pages/simulator/zone.component.html`
- `front/src/app/pages/simulator/zone.component.scss`
- `front/src/app/pages/simulator/stacked-zone.component.ts` *(review fix: isDragging guard + try/catch)*
