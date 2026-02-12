# Story 2.1: Command Stack Infrastructure

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want all my card actions to be tracked internally,
so that board state changes are predictable, traceable, and consistent across all interactions.

## Acceptance Criteria

1. **Given** the CommandStackService is created,
   **When** a semantic method is called (e.g., `moveCard(cardId, fromZone, toZone)`),
   **Then** a `MoveCardCommand` is instantiated internally and `execute()` is called,
   **And** the command mutates `BoardStateService.boardState` via immutable update,
   **And** the command is pushed onto the `undoStack` signal,
   **And** the `redoStack` is cleared.

2. **Given** the following command classes are created,
   **When** each implements the `SimCommand` interface (`execute()`, `undo()`),
   **Then** `MoveCardCommand`, `DrawCardCommand`, `ShuffleCommand`, and `ReorderHandCommand` are available,
   **And** each command stores minimum delta data (cardId, fromZone, toZone, indices) at construction time,
   **And** components never import or instantiate command classes directly — only CommandStackService exposes semantic methods.

## Tasks / Subtasks

- [x] **Task 1: Create `commands/` folder with 5 command classes + barrel** (AC: 2)
  - [x] 1.1: Create `commands/move-card.command.ts` — MoveCardCommand
  - [x] 1.2: Create `commands/draw-card.command.ts` — DrawCardCommand
  - [x] 1.3: Create `commands/shuffle.command.ts` — ShuffleCommand
  - [x] 1.4: Create `commands/reorder-hand.command.ts` — ReorderHandCommand
  - [x] 1.5: Create `commands/composite.command.ts` — CompositeCommand (infrastructure for Story 4.2 Mill batch ops)
  - [x] 1.6: Create `commands/index.ts` — Barrel export for all 5 classes

- [x] **Task 2: Add `execute()` and semantic methods to CommandStackService** (AC: 1)
  - [x] 2.1: Add private `execute(command: SimCommand): void`
  - [x] 2.2: Add public `executeBatch(commands: SimCommand[]): void`
  - [x] 2.3: Add public `moveCard(cardInstanceId, fromZone, toZone, toIndex?): void`
  - [x] 2.4: Add public `drawCard(): void`
  - [x] 2.5: Add public `shuffleDeck(): void`
  - [x] 2.6: Add public `reorderHand(fromIndex, toIndex): void`

- [x] **Task 3: Verify build** (AC: all)
  - [x] 3.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **Zero direct board state mutation from components.** Components call `CommandStackService` semantic methods (e.g., `moveCard()`, `drawCard()`). Components NEVER create command instances. Components NEVER call `boardState.update()` directly. The ONLY exception is `initializeBoard()` (Story 1.3) and future Reset (Story 5.2) — these are NOT commands. [Source: architecture.md#Action Flow Pattern]
- **Commands are internal to CommandStackService.** The `commands/` folder is ONLY imported by `command-stack.service.ts`. No component, no other service, no other file imports from `commands/`. If you catch yourself importing a command class in a component, you are doing it wrong. [Source: architecture.md#Service Responsibility Boundaries]
- **Immutable state updates.** Every `boardState.update()` call MUST produce a new object reference for the Record AND new array references for any modified zones. Angular signals use reference equality — same reference = no re-render. Always spread: `{ ...state, [zone]: [...newCards] }`. [Source: architecture.md#State Management Patterns]
- **Top of deck = last element in array.** Convention from Story 1.2/1.3: `deck[deck.length - 1]` is the top card. Drawing = taking from END. Adding to top = appending. [Source: 1-3-load-deck-shuffle-and-draw-initial-hand.md#Dev Notes]
- **Undo/redo stacks already exist.** `CommandStackService` already has `_undoStack`, `_redoStack` signals, `canUndo`/`canRedo` computed, and `undo()`/`redo()` methods. This story adds the missing `execute()` method and all semantic methods. Do NOT recreate what already exists. [Source: command-stack.service.ts]
- **BoardStateService injected as `boardStateService`.** The existing constructor is `constructor(private readonly boardStateService: BoardStateService)`. Use `this.boardStateService` to access it. Pass it to command constructors. [Source: command-stack.service.ts:16]

### Canonical Action Flow

```
User Action (drag drop / button / keyboard — Stories 2.2+)
  → Component calls CommandStackService semantic method (e.g., moveCard())
  → Service creates Command instance internally
  → Service calls private execute(command)
    → command.execute() mutates boardState signal via .update()
    → command pushed to _undoStack
    → _redoStack cleared
  → Signal change propagates → computed signals → OnPush components re-render
```

This story creates the bottom 4 layers. Stories 2.2 and 2.3 will wire components to call the semantic methods.

### Command Class Specifications

All commands receive `BoardStateService` as first constructor parameter. They call `this.boardState.boardState.update()` to mutate state immutably.

#### MoveCardCommand

**Purpose:** Move a card from any zone to any other zone. Covers FR6, FR12-17, FR23.

```typescript
// commands/move-card.command.ts
import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export class MoveCardCommand implements SimCommand {
  private readonly cardInstance: CardInstance;
  private readonly fromIndex: number;

  constructor(
    private readonly boardState: BoardStateService,
    private readonly cardInstanceId: string,
    private readonly fromZone: ZoneId,
    private readonly toZone: ZoneId,
    private readonly toIndex?: number,
  ) {
    // Capture delta at construction time
    const fromCards = this.boardState.boardState()[this.fromZone];
    this.fromIndex = fromCards.findIndex(c => c.instanceId === this.cardInstanceId);
    this.cardInstance = fromCards[this.fromIndex];
  }

  execute(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      // Remove from source zone
      newState[this.fromZone] = state[this.fromZone].filter(
        c => c.instanceId !== this.cardInstanceId
      );
      // Insert into target zone
      if (this.toIndex !== undefined && this.toIndex >= 0) {
        const target = [...state[this.toZone]];
        target.splice(this.toIndex, 0, this.cardInstance);
        newState[this.toZone] = target;
      } else {
        newState[this.toZone] = [...state[this.toZone], this.cardInstance];
      }
      return newState;
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      // Remove from target zone
      newState[this.toZone] = state[this.toZone].filter(
        c => c.instanceId !== this.cardInstanceId
      );
      // Restore to source zone at original index
      const source = [...state[this.fromZone]];
      source.splice(this.fromIndex, 0, this.cardInstance);
      newState[this.fromZone] = source;
      return newState;
    });
  }
}
```

**Delta stored:** `cardInstanceId`, `fromZone`, `toZone`, `fromIndex` (captured), `toIndex`, `cardInstance` reference (captured).

**`toIndex` behavior:**
- `undefined` or omitted → append to end of target zone (default for most moves)
- `0` → insert at beginning of target zone
- Specific number → insert at that position (used by Story 2.2 for hand reordering during drag-drop)

#### DrawCardCommand

**Purpose:** Draw top card from MAIN_DECK to HAND. Semantic wrapper for deck-to-hand move. Covers FR11.

```typescript
// commands/draw-card.command.ts
import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export class DrawCardCommand implements SimCommand {
  private drawnCard!: CardInstance;

  constructor(private readonly boardState: BoardStateService) {}

  execute(): void {
    const deck = this.boardState.boardState()[ZoneId.MAIN_DECK];
    if (deck.length === 0) return;
    // Top of deck = last element
    this.drawnCard = deck[deck.length - 1];

    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.MAIN_DECK]: state[ZoneId.MAIN_DECK].slice(0, -1),
      [ZoneId.HAND]: [...state[ZoneId.HAND], this.drawnCard],
    }));
  }

  undo(): void {
    if (!this.drawnCard) return;
    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.HAND]: state[ZoneId.HAND].filter(
        c => c.instanceId !== this.drawnCard.instanceId
      ),
      [ZoneId.MAIN_DECK]: [...state[ZoneId.MAIN_DECK], this.drawnCard],
    }));
  }
}
```

**Delta stored:** `drawnCard` (captured during execute — the specific card drawn).

**Why a separate class (not MoveCardCommand)?** DrawCardCommand is semantic: it always draws from MAIN_DECK top to HAND end. No zone parameters needed. This simplifies the calling code in Story 2.3 (just `commandStack.drawCard()` — no zone IDs).

#### ShuffleCommand

**Purpose:** Shuffle the main deck. Stores order before shuffle for undo. Covers FR5.

```typescript
// commands/shuffle.command.ts
import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export class ShuffleCommand implements SimCommand {
  private previousOrder: CardInstance[] = [];

  constructor(private readonly boardState: BoardStateService) {}

  execute(): void {
    // Capture order before shuffle
    this.previousOrder = [...this.boardState.boardState()[ZoneId.MAIN_DECK]];

    this.boardState.boardState.update(state => {
      const shuffled = [...state[ZoneId.MAIN_DECK]];
      // Fisher-Yates shuffle (same algorithm as BoardStateService.shuffle)
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return { ...state, [ZoneId.MAIN_DECK]: shuffled };
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.MAIN_DECK]: this.previousOrder,
    }));
  }
}
```

**Delta stored:** `previousOrder` (full deck snapshot before shuffle — necessary because Fisher-Yates is non-deterministic).

**Duplicate Fisher-Yates:** Yes, same algorithm as `BoardStateService.shuffle()` (line 93-100). Acceptable: 5 lines, avoids changing service API surface. If duplication bothers you, do NOT refactor now — Story 2.1 is infrastructure only.

#### ReorderHandCommand

**Purpose:** Reorder a card within the hand zone. Covers FR7.

```typescript
// commands/reorder-hand.command.ts
import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export class ReorderHandCommand implements SimCommand {
  private previousOrder: CardInstance[] = [];

  constructor(
    private readonly boardState: BoardStateService,
    private readonly fromIndex: number,
    private readonly toIndex: number,
  ) {}

  execute(): void {
    this.previousOrder = [...this.boardState.boardState()[ZoneId.HAND]];

    this.boardState.boardState.update(state => {
      const hand = [...state[ZoneId.HAND]];
      const [moved] = hand.splice(this.fromIndex, 1);
      hand.splice(this.toIndex, 0, moved);
      return { ...state, [ZoneId.HAND]: hand };
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.HAND]: this.previousOrder,
    }));
  }
}
```

**Delta stored:** `fromIndex`, `toIndex`, `previousOrder` (hand snapshot for clean undo).

#### CompositeCommand

**Purpose:** Wraps multiple commands for batch undo/redo. Used by Story 4.2 (Mill N = N MoveCardCommands). Infrastructure created now.

```typescript
// commands/composite.command.ts
import { SimCommand } from '../simulator.models';

export class CompositeCommand implements SimCommand {
  constructor(private readonly commands: SimCommand[]) {}

  execute(): void {
    this.commands.forEach(cmd => cmd.execute());
  }

  undo(): void {
    // Reverse order for correct undo semantics
    [...this.commands].reverse().forEach(cmd => cmd.undo());
  }
}
```

**Delta stored:** Array of sub-commands (each stores its own delta).

#### Barrel Export

```typescript
// commands/index.ts
export { MoveCardCommand } from './move-card.command';
export { DrawCardCommand } from './draw-card.command';
export { ShuffleCommand } from './shuffle.command';
export { ReorderHandCommand } from './reorder-hand.command';
export { CompositeCommand } from './composite.command';
```

### CommandStackService Additions

Add to existing `command-stack.service.ts` (DO NOT recreate the file — edit only):

```typescript
// NEW IMPORTS — add at top of file
import { ZoneId } from './simulator.models';
import {
  MoveCardCommand,
  DrawCardCommand,
  ShuffleCommand,
  ReorderHandCommand,
  CompositeCommand,
} from './commands';

// EXISTING CODE — keep everything already in the class

// NEW METHODS — add inside the class body, after existing redo() method

private execute(command: SimCommand): void {
  command.execute();
  this._undoStack.update(stack => [...stack, command]);
  this._redoStack.set([]);
}

executeBatch(commands: SimCommand[]): void {
  const composite = new CompositeCommand(commands);
  this.execute(composite);
}

moveCard(cardInstanceId: string, fromZone: ZoneId, toZone: ZoneId, toIndex?: number): void {
  const cmd = new MoveCardCommand(this.boardStateService, cardInstanceId, fromZone, toZone, toIndex);
  this.execute(cmd);
}

drawCard(): void {
  if (this.boardStateService.isDeckEmpty()) return;
  const cmd = new DrawCardCommand(this.boardStateService);
  this.execute(cmd);
}

shuffleDeck(): void {
  const cmd = new ShuffleCommand(this.boardStateService);
  this.execute(cmd);
}

reorderHand(fromIndex: number, toIndex: number): void {
  const cmd = new ReorderHandCommand(this.boardStateService, fromIndex, toIndex);
  this.execute(cmd);
}
```

**Key decisions:**
- `execute()` is **private** — only CommandStackService calls it. Components call semantic methods.
- `executeBatch()` is **public** — components may need to trigger batch operations (e.g., Story 4.2 mill via context menu callback).
- `drawCard()` guards on `isDeckEmpty()` — prevents creating a command for an impossible action. Does nothing if deck is empty.
- All semantic methods pass `this.boardStateService` to command constructors — commands hold a reference to perform mutations.

### Existing Code — What NOT to Change

| File | Keep As-Is |
|---|---|
| `board-state.service.ts` | All existing code. No new public methods needed. `boardState` signal is already public WritableSignal. `shuffle()` stays private. `isDeckEmpty` already exists. |
| `simulator.models.ts` | `SimCommand` interface, `ZoneId` enum, `CardInstance` interface, `ZONE_CONFIG` — all unchanged. |
| `command-stack.service.ts` | Keep existing `_undoStack`, `_redoStack`, `undoStack`, `redoStack`, `canUndo`, `canRedo`, `undo()`, `redo()`, constructor. Only ADD new methods. |

### What This Story Does NOT Include

- **No UI changes** — no new components, no template changes, no SCSS changes
- **No drag & drop** (Story 2.2) — no CDK DragDrop, no `cdkDrag`, no `cdkDropList`
- **No context menus** (Story 2.3) — no right-click behavior, no mat-menu
- **No FlipCardCommand / TogglePositionCommand** (Story 3.1) — these commands come later
- **No visual feedback** — no gold glow, no zone highlighting, no isDragging management
- **No component wiring** — no component calls any semantic method yet. Stories 2.2 and 2.3 will wire components to call `moveCard()`, `drawCard()`, etc.
- **Undo/redo stacks fill silently** — buttons/shortcuts to trigger undo/redo come in Story 5.1. The stacks accumulate commands but nothing in the UI exposes them yet.

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `moveCard()` | Story 2.2 (drag & drop handler calls it on every card drop) |
| `drawCard()` | Story 2.3 (drag from deck top to hand triggers it) |
| `shuffleDeck()` | Story 2.3 (context menu "Shuffle" action) |
| `reorderHand()` | Story 2.3 (CDK sort within hand triggers it) |
| `executeBatch()` + `CompositeCommand` | Story 4.2 (Mill N wraps N MoveCardCommands) |
| All commands via undo/redo stacks | Story 5.1 (Undo/Redo buttons + Ctrl+Z/Y expose the stacks) |

### Previous Story Intelligence (Story 1.3)

**Patterns to follow:**
- SCSS import: `@use 'sim-tokens' as *` (not `@import`) — Dart Sass 2.0
- Service injection: `@Injectable()` without `providedIn`, scoped at component level
- Signal access: `boardState` is public `WritableSignal`, read via `.()`, mutate via `.update()`
- `createEmptyBoard()` is a module-level function (line 6-27 of board-state.service.ts) — not exported, not needed by commands
- `images[0]` fallback pattern: `icd.card.images[0] ?? { id: 0, ... }` (line 87)
- Build passes: `ng build --configuration development` zero errors after Story 1.3

**Story 1.3 Code Review fixes applied:**
- `catchError` inside `switchMap` (not subscribe error handler)
- `boardState.update()` instead of `createEmptyBoard() + set()` for partial state changes
- `toObservable(deckId)` to eliminate duplicate paramMap subscription

### Project Structure Notes

**New files created by this story:**
```
front/src/app/pages/simulator/
  commands/                        # NEW — command classes folder
    index.ts                       # NEW — barrel export
    move-card.command.ts           # NEW — MoveCardCommand
    draw-card.command.ts           # NEW — DrawCardCommand
    shuffle.command.ts             # NEW — ShuffleCommand
    reorder-hand.command.ts        # NEW — ReorderHandCommand
    composite.command.ts           # NEW — CompositeCommand
```

**Files modified by this story:**
```
front/src/app/pages/simulator/
  command-stack.service.ts         # MODIFIED — add execute(), executeBatch(), 4 semantic methods, new imports
```

### References

- [Source: architecture.md#Command Pattern Design: Delta-Based] — 6 command types + CompositeCommand, delta-based storage
- [Source: architecture.md#Command Stack] — execute/undo/redo signal-based flow
- [Source: architecture.md#Action Flow Pattern] — Canonical action flow, zero direct mutations
- [Source: architecture.md#Service Responsibility Boundaries] — CommandStackService creates commands internally
- [Source: architecture.md#Implementation Patterns & Consistency Rules] — Enforcement guidelines and anti-patterns
- [Source: architecture.md#Project Structure & Boundaries] — commands/ folder, naming conventions
- [Source: epics.md#Story 2.1] — Acceptance criteria, user story
- [Source: epics.md#Epic 2 Implementation Notes] — CommandStackService infrastructure, all command classes
- [Source: ux-design-specification.md#UX Consistency Patterns] — Drag & drop patterns (context for future command usage)
- [Source: command-stack.service.ts] — Existing service code (undo/redo stacks, canUndo/canRedo, constructor with boardStateService)
- [Source: board-state.service.ts] — boardState signal, computed zones, isDeckEmpty, shuffle() private method
- [Source: simulator.models.ts] — SimCommand interface, ZoneId enum, CardInstance interface
- [Source: 1-3-load-deck-shuffle-and-draw-initial-hand.md] — Previous story patterns, Fisher-Yates implementation, top-of-deck convention

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build passed on first attempt — zero errors, zero warnings

### Completion Notes List

- **Task 1:** Created 5 command classes (`MoveCardCommand`, `DrawCardCommand`, `ShuffleCommand`, `ReorderHandCommand`, `CompositeCommand`) in `commands/` folder with barrel export. All implement `SimCommand` interface with `execute()` and `undo()`. Each stores minimum delta data at construction time for reversible operations. Immutable state updates via `boardState.update()` with spread operators.
- **Task 2:** Added private `execute()` method (pushes to undoStack, clears redoStack), public `executeBatch()` wrapping in `CompositeCommand`, and 4 semantic methods (`moveCard`, `drawCard`, `shuffleDeck`, `reorderHand`). `drawCard()` guards on `isDeckEmpty()`. All methods create command instances internally — components never see command classes.
- **Task 3:** `ng build --configuration development` completed with zero errors. All new TypeScript files compile cleanly under strict mode.

### Implementation Plan

Followed Dev Notes specifications exactly — all command classes match the provided TypeScript code specs. No deviations from the story plan. Fisher-Yates shuffle duplicated in ShuffleCommand per Dev Notes guidance (acceptable 5-line duplication, no refactoring in this story).

### Change Log

- 2026-02-10: Implemented Story 2.1 — Created command stack infrastructure with 5 command classes and 6 new methods on CommandStackService. Build verified with zero errors.
- 2026-02-10: **Code Review (AI)** — 7 issues found (3 HIGH, 3 MEDIUM, 1 LOW). All HIGH and MEDIUM fixed:
  - [HIGH] Fixed MoveCardCommand same-zone duplication bug (read from newState instead of state for target zone)
  - [HIGH] Added constructor guard for card-not-found in MoveCardCommand (throws Error instead of silent corruption)
  - [HIGH] Made executeBatch private to enforce AC2 encapsulation (commands stay internal)
  - [MEDIUM] Replaced DrawCardCommand `drawnCard!` non-definite assertion with proper `CardInstance | undefined` type + local variable narrowing
  - [MEDIUM] DrawCardCommand no-op on undo stack — addressed by executeBatch being private (no external path to bypass guard)
  - [MEDIUM] Added reorderHand same-index guard (fromIndex === toIndex returns early)
  - [LOW] Story AC2 lists 4 commands but 5 created (CompositeCommand not in AC text) — doc inconsistency only, no code change
  - Build verified: zero errors after all fixes.

### File List

**New files:**
- `front/src/app/pages/simulator/commands/move-card.command.ts`
- `front/src/app/pages/simulator/commands/draw-card.command.ts`
- `front/src/app/pages/simulator/commands/shuffle.command.ts`
- `front/src/app/pages/simulator/commands/reorder-hand.command.ts`
- `front/src/app/pages/simulator/commands/composite.command.ts`
- `front/src/app/pages/simulator/commands/index.ts`

**Modified files:**
- `front/src/app/pages/simulator/command-stack.service.ts`
