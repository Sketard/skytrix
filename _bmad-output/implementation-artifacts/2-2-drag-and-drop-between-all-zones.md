# Story 2.2: Drag & Drop Between All Zones

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to grab any card and drag it to any zone on the board,
so that I can perform all card actions (summon, activate, send to GY, banish, return) through a single intuitive gesture.

## Acceptance Criteria

1. **Given** a card (face-up or face-down) is on the board or in hand,
   **When** I click and hold on the card,
   **Then** the card lifts (scale 1.05, increased box-shadow) and `isDragging` signal is set to `true`.

2. **Given** I am dragging a card,
   **When** I hover over valid empty zones,
   **Then** those zones highlight with `$sim-zone-highlight` (cyan at 0.3 opacity + border intensification),
   **And** occupied single-card zones show no reaction (silent rejection, no card replacement).

3. **Given** I drop a card on a valid empty zone,
   **When** the drop event fires,
   **Then** the card snaps into position (<100ms),
   **And** a gold glow plays via CSS `@keyframes` + `.zone--just-dropped` class (~400ms fade),
   **And** `CommandStackService.moveCard()` is called, creating a `MoveCardCommand`,
   **And** `isDragging` is set back to `false`.

4. **Given** I drop a card on an invalid or occupied zone,
   **When** the drop event fires,
   **Then** the card returns to its origin with smooth animation (CDK default revert).

5. **Given** all zone components are rendered,
   **When** the board initializes,
   **Then** `cdkDropListGroup` is on `SimBoardComponent` root,
   **And** `cdkDropListSortingDisabled: true` on all single-card zones,
   **And** `cdkDropListEnterPredicate` rejects drops on occupied single-card zones.

6. **Given** the user's system has `prefers-reduced-motion: reduce` enabled,
   **When** drag & drop interactions occur,
   **Then** gold glow animation, card lift scale (1.05), and CDK drag placeholder transitions (`.cdk-drag-placeholder`, `.cdk-drag-animating`) are disabled — cards move instantly without animation.

## Tasks / Subtasks

- [x] **Task 1: Add `cdkDropListGroup` to SimBoardComponent** (AC: 5)
  - [x] 1.1: Import `DragDropModule` in `board.component.ts`
  - [x] 1.2: Add `cdkDropListGroup` directive to `.sim-board` div in template

- [x] **Task 2: Wire SimZoneComponent as CDK drop target + drag source** (AC: 1, 2, 3, 4, 5)
  - [x] 2.1: Import `DragDropModule` in `zone.component.ts`
  - [x] 2.2: Add `cdkDropList` to `.sim-zone` div with `[cdkDropListData]="zoneId()"`
  - [x] 2.3: Add `[cdkDropListSortingDisabled]="true"` on `.sim-zone`
  - [x] 2.4: Add `[cdkDropListEnterPredicate]="canDrop"` with function rejecting occupied zones
  - [x] 2.5: Add `(cdkDropListDropped)="onDrop($event)"` handler calling `CommandStackService.moveCard()`
  - [x] 2.6: Add `cdkDrag` + `[cdkDragData]` on `app-sim-card` in template
  - [x] 2.7: Add gold glow CSS animation (`.zone--just-dropped`) and `animationend` listener

- [x] **Task 3: Wire SimStackedZoneComponent as CDK drop target** (AC: 2, 3, 5)
  - [x] 3.1: Import `DragDropModule` in `stacked-zone.component.ts`
  - [x] 3.2: Add `cdkDropList` to `.sim-stacked-zone` div with `[cdkDropListData]="zoneId()"`
  - [x] 3.3: Add `[cdkDropListSortingDisabled]="true"`
  - [x] 3.4: Add `(cdkDropListDropped)="onDrop($event)"` handler calling `CommandStackService.moveCard()`
  - [x] 3.5: NO `cdkDropListEnterPredicate` — stacked zones always accept (multi-card)

- [x] **Task 4: Wire SimHandComponent as CDK drop target with reordering** (AC: 1, 2, 3, 5)
  - [x] 4.1: Import `DragDropModule` in `hand.component.ts`
  - [x] 4.2: Add `cdkDropList` to `.sim-hand` div with `[cdkDropListData]="ZoneId.HAND"`
  - [x] 4.3: Set `[cdkDropListSortingDisabled]="false"` (enable reorder)
  - [x] 4.4: Add `cdkDrag` + `[cdkDragData]` on each `app-sim-card`
  - [x] 4.5: Add `(cdkDropListDropped)="onDrop($event)"` handler that distinguishes reorder vs. cross-zone move

- [x] **Task 5: Add drag visual feedback CSS to all zone types** (AC: 1, 2, 3, 6)
  - [x] 5.1: Add `.cdk-drop-list-receiving` and `.cdk-drag-placeholder` styles to zone/hand/stacked-zone SCSS
  - [x] 5.2: Add card lift styles (`.cdk-drag-preview` scale + shadow) to `sim-card.component.scss`
  - [x] 5.3: Add `@keyframes gold-glow` and `.zone--just-dropped` to zone/stacked-zone/hand SCSS
  - [x] 5.4: Add `prefers-reduced-motion` media query to suppress animations

- [x] **Task 6: Manage `isDragging` signal** (AC: 1, 3)
  - [x] 6.1: Set `isDragging(true)` on `cdkDragStarted` event in each drag source component
  - [x] 6.2: Set `isDragging(false)` on `cdkDragEnded` event in each drag source component

- [x] **Task 7: Verify build** (AC: all)
  - [x] 7.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **Zero direct board state mutation from components.** Components call `CommandStackService.moveCard()` only. Components NEVER call `boardState.update()` directly. The ONLY direct state call is `isDragging.set()` which is a UI signal, not board state. [Source: architecture.md#Action Flow Pattern]
- **Commands are internal to CommandStackService.** Components NEVER import from `commands/`. They call `commandStack.moveCard(cardInstanceId, fromZone, toZone, toIndex?)`. [Source: architecture.md#Service Responsibility Boundaries]
- **Immutable state updates.** Every `boardState.update()` already handled by commands internally. The dev agent does NOT write any `boardState.update()` in this story. [Source: architecture.md#State Management Patterns]
- **Top of deck = last element in array.** Convention: `deck[deck.length - 1]` is the top card. [Source: 2-1-command-stack-infrastructure.md#Dev Notes]
- **`cdkDropListGroup` on SimBoardComponent root** — all drop lists (zones, stacked zones, hand) become children of this group. No explicit `cdkDropListConnectedTo` wiring needed. [Source: architecture.md#Drag & Drop Orchestration Pattern]
- **Each individual zone = its own `cdkDropList`** — player chooses exactly which slot to place a card in. Not one big drop list for all monsters. [Source: architecture.md#Frontend Architecture]

### Canonical Drop Handler Flow

```
User drops card on zone
  → (cdkDropListDropped) fires with CdkDragDrop event
  → Component extracts:
      - cardInstanceId: event.item.data (CardInstance.instanceId)
      - fromZone: event.previousContainer.data (ZoneId)
      - toZone: event.container.data (ZoneId)
      - toIndex: event.currentIndex (for hand reordering)
  → Component calls CommandStackService.moveCard(cardInstanceId, fromZone, toZone, toIndex?)
      - OR CommandStackService.reorderHand(fromIndex, toIndex) if same zone = HAND
  → Signal change propagates → computed signals → OnPush components re-render
```

### CDK DragDrop Wiring Specifications

#### SimBoardComponent Changes

```typescript
// board.component.ts — ADD import
import { DragDropModule } from '@angular/cdk/drag-drop';
// ADD to imports array: DragDropModule
```

```html
<!-- board.component.html — ADD directive to root div -->
<div class="sim-board" cdkDropListGroup role="application" aria-label="Yu-Gi-Oh simulator board">
  <!-- ... existing content unchanged ... -->
</div>
```

#### SimZoneComponent Changes

```typescript
// zone.component.ts — ADDITIONS
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import { CommandStackService } from './command-stack.service';
import { CardInstance, ZoneId, ZONE_CONFIG } from './simulator.models';
import { BoardStateService } from './board-state.service';

// ADD to imports array: DragDropModule
// ADD to class:

private readonly commandStack = inject(CommandStackService);

readonly canDrop = (drag: CdkDrag<CardInstance>): boolean => {
  return this.card() === null;
};

onDrop(event: CdkDragDrop<ZoneId, ZoneId, CardInstance>): void {
  if (event.previousContainer === event.container) return;
  const cardInstanceId = event.item.data.instanceId;
  const fromZone = event.previousContainer.data;
  const toZone = event.container.data;
  this.commandStack.moveCard(cardInstanceId, fromZone, toZone);
}
```

**`canDrop` explanation:** `cdkDropListEnterPredicate` receives the `CdkDrag` instance. We use `CdkDrag<CardInstance>` typing. The predicate returns `true` only if the zone is empty (`this.card() === null`). When the zone is occupied, it returns `false` and CDK shows no drop indicator — silent rejection per UX spec.

```html
<!-- zone.component.html — FULL REPLACEMENT -->
<div class="sim-zone"
     cdkDropList
     [cdkDropListData]="zoneId()"
     [cdkDropListSortingDisabled]="true"
     [cdkDropListEnterPredicate]="canDrop">
  @if (card(); as c) {
    <app-sim-card [cardInstance]="c"
                  cdkDrag
                  [cdkDragData]="c" />
  } @else {
    <span class="zone-label">{{ zoneConfig().label }}</span>
  }
  @if (isPendulum()) {
    <span class="pendulum-label">{{ pendulumLabel() }}</span>
  }
</div>
```

**IMPORTANT:** The `(cdkDropListDropped)` event is NOT on this template. Because this zone is a child of `cdkDropListGroup`, drop events are handled automatically. HOWEVER — the drop event fires on the **receiving container**. So we DO need `(cdkDropListDropped)="onDrop($event)"` on the `.sim-zone` div.

Corrected:
```html
<div class="sim-zone"
     cdkDropList
     [cdkDropListData]="zoneId()"
     [cdkDropListSortingDisabled]="true"
     [cdkDropListEnterPredicate]="canDrop"
     (cdkDropListDropped)="onDrop($event)">
```

#### SimStackedZoneComponent Changes

```typescript
// stacked-zone.component.ts — ADDITIONS
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import { CommandStackService } from './command-stack.service';
import { CardInstance, ZoneId } from './simulator.models';

// ADD to imports array: DragDropModule
// ADD to class:

private readonly commandStack = inject(CommandStackService);

onDrop(event: CdkDragDrop<ZoneId, ZoneId, CardInstance>): void {
  if (event.previousContainer === event.container) return;
  const cardInstanceId = event.item.data.instanceId;
  const fromZone = event.previousContainer.data;
  const toZone = event.container.data;
  this.commandStack.moveCard(cardInstanceId, fromZone, toZone);
}
```

**No `cdkDropListEnterPredicate`** — stacked zones (GY, Banish, Deck, ED) accept unlimited cards. The existing top-card display via `displayCard` continues to work because `topCard = computed(() => cards()[cards().length - 1])`.

```html
<!-- stacked-zone.component.html — FULL REPLACEMENT -->
<div class="sim-stacked-zone"
     [class.empty]="cardCount() === 0"
     cdkDropList
     [cdkDropListData]="zoneId()"
     [cdkDropListSortingDisabled]="true"
     (cdkDropListDropped)="onDrop($event)"
     [matBadge]="cardCount()"
     matBadgePosition="above after"
     [matBadgeHidden]="cardCount() === 0">
  @if (displayCard(); as card) {
    <app-sim-card [cardInstance]="card" />
  }
  <span class="zone-label">{{ zoneConfig().label }}</span>
</div>
```

**Note:** Cards in stacked zones are NOT directly draggable from the stacked zone component in this story. The `displayCard` is a face-down display copy — not the actual top card instance. Drag from stacked zones comes in Story 2.3 (draw from deck) and Story 4.1 (pile overlay browse). This story only makes stacked zones **drop targets**.

#### SimHandComponent Changes

```typescript
// hand.component.ts — ADDITIONS
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';
import { CommandStackService } from './command-stack.service';
import { CardInstance, ZoneId } from './simulator.models';

// ADD to imports array: DragDropModule
// ADD to class:

private readonly commandStack = inject(CommandStackService);
protected readonly ZoneId = ZoneId;

onDrop(event: CdkDragDrop<ZoneId, ZoneId, CardInstance>): void {
  const fromZone = event.previousContainer.data;
  const toZone = event.container.data;

  if (fromZone === ZoneId.HAND && toZone === ZoneId.HAND) {
    // Reorder within hand
    this.commandStack.reorderHand(event.previousIndex, event.currentIndex);
  } else {
    // Cross-zone move to hand
    const cardInstanceId = event.item.data.instanceId;
    this.commandStack.moveCard(cardInstanceId, fromZone, toZone, event.currentIndex);
  }
}
```

```html
<!-- hand.component.html — FULL REPLACEMENT -->
<div class="sim-hand"
     [class.empty]="isEmpty()"
     cdkDropList
     [cdkDropListData]="ZoneId.HAND"
     [cdkDropListSortingDisabled]="false"
     (cdkDropListDropped)="onDrop($event)">
  @for (card of cards(); track card.instanceId) {
    <app-sim-card [cardInstance]="card"
                  size="hand"
                  cdkDrag
                  [cdkDragData]="card" />
  }
</div>
```

**Hand reorder logic:** When `previousContainer === container` AND both are HAND, CDK has already visually reordered via sort. We call `reorderHand(previousIndex, currentIndex)` to persist the change. For cross-zone moves TO hand, we call `moveCard()` with `currentIndex` so the card lands where the player dropped it (not always at the end).

#### SimCardComponent Changes

**No TypeScript or template changes to SimCardComponent.** The `cdkDrag` directive is applied by parent components (zone, hand) on the `<app-sim-card>` host element, so drag events (`cdkDragStarted`, `cdkDragEnded`) are captured in the parent templates. This keeps SimCardComponent unaware of drag infrastructure.

Parent components (SimZoneComponent, SimHandComponent) handle `isDragging` signal management:

```typescript
onDragStarted(): void {
  this.boardState.isDragging.set(true);
}

onDragEnded(): void {
  this.boardState.isDragging.set(false);
}
```

### CSS Specifications

#### Gold Glow Animation (zone.component.scss, stacked-zone.component.scss, hand.component.scss)

```scss
// ADD to zone.component.scss, stacked-zone.component.scss, hand.component.scss
@keyframes gold-glow {
  0% { box-shadow: 0 0 12px 4px $sim-zone-glow-success; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.zone--just-dropped {
  animation: gold-glow 400ms ease-out forwards;
}
```

**Gold glow trigger:** After a successful drop, the receiving container element should have `.zone--just-dropped` added. Remove it after animation completes via `animationend` event. Implementation in component:

```typescript
// In zone/stacked-zone/hand component:
justDropped = signal(false);

onDrop(event: CdkDragDrop<...>): void {
  // ... moveCard() call ...
  this.justDropped.set(true);
}

onGlowAnimationEnd(): void {
  this.justDropped.set(false);
}
```

```html
<!-- On container div: -->
[class.zone--just-dropped]="justDropped()"
(animationend)="onGlowAnimationEnd()"
```

#### Drop Zone Highlight During Drag (zone.component.scss)

```scss
// CDK adds .cdk-drop-list-dragging when a drag is in progress globally
// CDK adds .cdk-drop-list-receiving when a valid drag hovers over this list
.sim-zone.cdk-drop-list-receiving {
  background: $sim-zone-highlight;
  border-color: $sim-accent-primary;
  transition: background 100ms ease, border-color 100ms ease;
}
```

**Note:** CDK automatically adds `.cdk-drop-list-receiving` class to a `cdkDropList` container when a valid drag item hovers over it (i.e., the enter predicate returns true). This is the hook for visual feedback — no manual class management needed.

#### Card Drag Preview (sim-card.component.scss)

```scss
// Card lift effect when dragging
:host.cdk-drag-preview {
  // CDK creates a clone at document level for the drag preview
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  transform: scale(1.05);
  opacity: 0.9;
  z-index: 1000;
}

// Placeholder left behind in the original position
:host.cdk-drag-placeholder {
  opacity: 0.3;
}

// Disable animations during drag return
:host.cdk-drag-animating {
  transition: transform 200ms ease;
}
```

**Important CSS note:** CDK DragDrop clones the element for the drag preview and appends it to the document body. The `:host.cdk-drag-preview` selector targets this clone. The `:host.cdk-drag-placeholder` targets the ghost left in the original position. These selectors work because CDK copies the component's host element classes.

#### Reduced Motion Support (all SCSS files that have animations)

```scss
@media (prefers-reduced-motion: reduce) {
  .zone--just-dropped {
    animation: none;
  }

  :host.cdk-drag-preview {
    transform: none;
    transition: none;
  }

  :host.cdk-drag-placeholder {
    transition: none;
  }

  :host.cdk-drag-animating {
    transition: none;
  }
}
```

### What This Story Does NOT Include

- **No drag from stacked zones** — Deck top card is a display copy (`displayCard` computed), not the actual card. Story 2.3 adds deck drag (draw), Story 4.1 adds pile overlay drag.
- **No context menus** (Story 2.3 for Deck "Shuffle", Story 3.1 for card state toggle)
- **No FlipCardCommand / TogglePositionCommand** (Story 3.1)
- **No card inspector** (Story 3.2) — `hoveredCard` signal exists but is not wired in this story
- **No pile overlays** (Story 4.1) — clicking stacked zones does nothing yet
- **No undo/redo UI** (Story 5.1) — stacks fill silently, buttons come later
- **No keyboard shortcuts** (Story 5.2)
- **Undo/redo stacks fill silently** — `moveCard()` and `reorderHand()` push to `undoStack` automatically

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| CDK infrastructure (`cdkDropListGroup`, `cdkDropList`, `cdkDrag`) | All future stories with drag interactions (4.1 overlay drag, 4.3 XYZ material) |
| `isDragging` signal management | Story 3.2 (inspector suppression), Story 4.1 (overlay suppression) |
| Gold glow animation pattern | Reused on any zone that receives a drop in future stories |
| `canDrop` predicate pattern | Extended in Story 4.3 (XYZ material attachment) |
| Hand reorder via CDK sort | Standalone, used from this story forward |

### Previous Story Intelligence (Story 2.1)

**Patterns to follow:**
- SCSS import: `@use 'sim-tokens' as *` (not `@import`) — Dart Sass 2.0
- Service injection: `inject()` function pattern (not constructor injection in components)
- Signal access: read via `.()`, mutate via `.set()` or `.update()`
- Build passes: `ng build --configuration development` zero errors after Story 2.1
- `executeBatch` is **private** — components cannot call it directly
- `reorderHand()` guards on same-index (fromIndex === toIndex returns early)
- MoveCardCommand validates card existence at construction — throws if card not found in fromZone

**Story 2.1 Code Review fixes applied:**
- MoveCardCommand same-zone duplication bug fixed (reads from newState)
- Constructor guard for card-not-found (throws Error)
- reorderHand same-index guard

### CDK DragDrop Technical Notes

**Angular CDK DragDrop module (v19.1.1) — confirmed stable API:**
- `cdkDropListGroup` — auto-connects all child `cdkDropList` containers
- `cdkDropList` — marks element as drop target, exposes `cdkDropListData`, `cdkDropListSortingDisabled`, `cdkDropListEnterPredicate`, `cdkDropListDropped`
- `cdkDrag` — marks element as draggable, exposes `cdkDragData`, `cdkDragStarted`, `cdkDragEnded`
- `CdkDragDrop<T, O, I>` — event type: `T` = container data type, `O` = previous container data type, `I` = item data type
- CDK creates a drag preview clone at document body level — global z-index context
- CDK adds `.cdk-drop-list-receiving` class on valid hover — use for visual feedback
- CDK adds `.cdk-drag-placeholder` class on ghost element — use for opacity
- CDK adds `.cdk-drag-animating` class during return animation — use for transitions

**Import:** `import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';`

**`CdkDragDrop` event properties used:**
- `event.item.data` — the `cdkDragData` value (our `CardInstance`)
- `event.previousContainer.data` — the source `cdkDropListData` (our `ZoneId`)
- `event.container.data` — the target `cdkDropListData` (our `ZoneId`)
- `event.previousIndex` — index in source container
- `event.currentIndex` — index in target container (relevant for hand reordering)

### Existing Code — What NOT to Change

| File | Keep As-Is |
|---|---|
| `board-state.service.ts` | All existing code. `isDragging` and `hoveredCard` signals already exist. No new methods needed. |
| `command-stack.service.ts` | All existing code. `moveCard()` and `reorderHand()` already exist from Story 2.1. No changes needed. |
| `simulator.models.ts` | `SimCommand`, `ZoneId`, `CardInstance`, `ZONE_CONFIG` — all unchanged. |
| `commands/*.ts` | All command classes unchanged. |
| `simulator-page.component.*` | Unchanged — just renders `<app-sim-board />`. |

### Project Structure Notes

**No new files created by this story.** All changes are modifications to existing files.

**Files modified by this story:**
```
front/src/app/pages/simulator/
  board.component.ts              # MODIFIED — add DragDropModule import
  board.component.html            # MODIFIED — add cdkDropListGroup
  zone.component.ts               # MODIFIED — add DragDropModule, CommandStackService, canDrop, onDrop, isDragging handlers, justDropped
  zone.component.html             # MODIFIED — add cdkDropList, cdkDrag, cdkDropListEnterPredicate, cdkDropListDropped, gold glow binding
  zone.component.scss             # MODIFIED — add .cdk-drop-list-receiving, gold-glow, reduced-motion
  stacked-zone.component.ts       # MODIFIED — add DragDropModule, CommandStackService, onDrop, justDropped
  stacked-zone.component.html     # MODIFIED — add cdkDropList, cdkDropListDropped, gold glow binding
  stacked-zone.component.scss     # MODIFIED — add .cdk-drop-list-receiving, gold-glow, reduced-motion
  hand.component.ts               # MODIFIED — add DragDropModule, CommandStackService, onDrop (reorder + cross-zone), isDragging handlers, justDropped, ZoneId
  hand.component.html             # MODIFIED — add cdkDropList, cdkDrag, cdkDropListSortingDisabled=false, cdkDropListDropped, gold glow binding
  hand.component.scss             # MODIFIED — add .cdk-drop-list-receiving, gold-glow, reduced-motion
  sim-card.component.scss         # MODIFIED — add .cdk-drag-preview, .cdk-drag-placeholder, .cdk-drag-animating, reduced-motion
```

### References

- [Source: architecture.md#Drag & Drop Orchestration Pattern] — cdkDropListGroup, cdkDropListSortingDisabled, cdkDropListEnterPredicate, canonical drop handler
- [Source: architecture.md#Action Flow Pattern] — Components call CommandStackService semantic methods only
- [Source: architecture.md#Service Responsibility Boundaries] — isDragging signal in BoardStateService
- [Source: architecture.md#Error Handling Patterns] — Invalid drops silently ignored, card returns to origin
- [Source: ux-design-specification.md#Drag & Drop Patterns] — Drag initiation (scale 1.05, shadow), during drag (cyan highlight), drop (gold glow), cross-container drag
- [Source: ux-design-specification.md#Feedback & State Indication Patterns] — Gold glow @keyframes, .zone--just-dropped, animationend removal
- [Source: ux-design-specification.md#Responsive Design & Accessibility] — prefers-reduced-motion support
- [Source: epics.md#Story 2.2] — Acceptance criteria, user story
- [Source: epics.md#Epic 2 Implementation Notes] — CDK DragDrop with cdkDropListGroup, cdkDropListSortingDisabled
- [Source: 2-1-command-stack-infrastructure.md] — moveCard(), reorderHand(), MoveCardCommand specs, top-of-deck convention
- [Source: command-stack.service.ts] — Existing service with moveCard(), reorderHand() ready
- [Source: board-state.service.ts] — boardState signal, isDragging signal, computed per zone
- [Source: _sim-tokens.scss] — $sim-zone-highlight, $sim-zone-glow-success, $sim-accent-primary

## Change Log

- **2026-02-10:** Implemented full drag & drop between all zones — CDK DragDrop wiring on board, zone, stacked-zone, and hand components; gold glow animation; isDragging signal management; prefers-reduced-motion support. Build passes with zero errors.
- **2026-02-10 (Code Review):** Fixed 6 issues found during adversarial code review:
  - [H1] Added try/catch in all drop handlers to silently ignore invalid drops (MoveCardCommand throw edge case)
  - [H2] Added setTimeout fallback for `justDropped` cleanup — fixes class stuck when `prefers-reduced-motion: reduce` disables `animationend`
  - [H3] Added `triggerGlow()` with `requestAnimationFrame` + timeout reset — gold glow now restarts on rapid successive drops
  - [M1] Cleaned up contradictory Dev Notes for SimCardComponent (removed misleading code block)
  - [M2] Added `aria-label` on draggable card elements in zone and hand templates
  - [L1] Extracted `createGlowEffect()` factory into `glow-effect.ts` — eliminates duplication across 3 components
  Build verified: zero errors.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build verified: `ng build --configuration development` — zero errors, 4.24 MB initial bundle

### Completion Notes List

- **Task 1:** Added `DragDropModule` import and `cdkDropListGroup` directive to `SimBoardComponent` — all child drop lists auto-connected
- **Task 2:** Wired `SimZoneComponent` as both CDK drop target and drag source. `canDrop` predicate rejects occupied single-card zones (silent rejection). `onDrop` handler calls `CommandStackService.moveCard()`. Gold glow via `justDropped` signal + `animationend`. `cdkDrag` + drag events on `<app-sim-card>`
- **Task 3:** Wired `SimStackedZoneComponent` as CDK drop target only (no drag source — per story scope). No enter predicate — stacked zones always accept cards. Gold glow on successful drop
- **Task 4:** Wired `SimHandComponent` as CDK drop target with sorting enabled. `onDrop` distinguishes hand reorder (`reorderHand`) vs cross-zone move (`moveCard` with `currentIndex`). Cards in hand are draggable with `cdkDrag` + drag events
- **Task 5:** Added CSS feedback across all zone SCSS files: `.cdk-drop-list-receiving` highlight, `@keyframes gold-glow` + `.zone--just-dropped`, `.cdk-drag-placeholder` opacity. Card SCSS: `.cdk-drag-preview` (scale 1.05 + shadow), `.cdk-drag-placeholder`, `.cdk-drag-animating`. All animations respect `prefers-reduced-motion: reduce`
- **Task 6:** `isDragging` signal managed via `(cdkDragStarted)` and `(cdkDragEnded)` events on parent components (zone + hand) — set on `BoardStateService.isDragging`
- **Task 7:** Build passes with zero errors

### File List

- `front/src/app/pages/simulator/board.component.ts` — MODIFIED (added DragDropModule import)
- `front/src/app/pages/simulator/board.component.html` — MODIFIED (added cdkDropListGroup)
- `front/src/app/pages/simulator/zone.component.ts` — MODIFIED (added DragDropModule, CommandStackService, canDrop, onDrop, justDropped, onDragStarted/Ended)
- `front/src/app/pages/simulator/zone.component.html` — MODIFIED (added cdkDropList, cdkDrag, predicates, events, gold glow binding)
- `front/src/app/pages/simulator/zone.component.scss` — MODIFIED (added .cdk-drop-list-receiving, gold-glow, reduced-motion)
- `front/src/app/pages/simulator/stacked-zone.component.ts` — MODIFIED (added DragDropModule, CommandStackService, onDrop, justDropped)
- `front/src/app/pages/simulator/stacked-zone.component.html` — MODIFIED (added cdkDropList, cdkDropListDropped, gold glow binding)
- `front/src/app/pages/simulator/stacked-zone.component.scss` — MODIFIED (added .cdk-drop-list-receiving, gold-glow, reduced-motion)
- `front/src/app/pages/simulator/hand.component.ts` — MODIFIED (added DragDropModule, CommandStackService, onDrop with reorder/cross-zone, justDropped, isDragging handlers, ZoneId)
- `front/src/app/pages/simulator/hand.component.html` — MODIFIED (added cdkDropList, cdkDrag, sorting enabled, events, gold glow binding)
- `front/src/app/pages/simulator/hand.component.scss` — MODIFIED (added .cdk-drop-list-receiving, gold-glow, reduced-motion)
- `front/src/app/pages/simulator/sim-card.component.scss` — MODIFIED (added .cdk-drag-preview, .cdk-drag-placeholder, .cdk-drag-animating, reduced-motion)
- `front/src/app/pages/simulator/glow-effect.ts` — ADDED (code review: extracted shared glow animation logic from zone/stacked-zone/hand)
