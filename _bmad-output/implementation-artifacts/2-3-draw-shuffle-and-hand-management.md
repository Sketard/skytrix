# Story 2.3: Draw, Shuffle & Hand Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to draw cards from my deck, shuffle at any time, and reorder my hand,
so that I can manage my resources during combo testing.

## Acceptance Criteria

1. **Given** the deck has cards remaining,
   **When** I drag the top card of the deck to the hand zone,
   **Then** the card moves to hand via `CommandStackService.drawCard()`,
   **And** the deck badge decrements.

2. **Given** the deck has 0 cards,
   **When** I attempt to drag from the deck,
   **Then** no drag initiates and the deck zone shows brief visual feedback (subtle shake or highlight).

3. **Given** I right-click on the Deck zone,
   **When** the context menu opens,
   **Then** a `mat-menu` appears with "Shuffle" option,
   **And** clicking "Shuffle" calls `CommandStackService.shuffleDeck()`,
   **And** `event.preventDefault()` is applied only in production (`isDevMode()` guard).

4. **Given** I have multiple cards in hand,
   **When** I drag a card within the hand zone,
   **Then** the hand reorders via CDK sort animation (`cdkDropListSortingDisabled: false`),
   **And** `CommandStackService.reorderHand()` is called with the new order.

## Tasks / Subtasks

- [x] **Task 1: Make Deck top card draggable from SimStackedZoneComponent** (AC: 1, 2)
  - [x] 1.1: Add conditional `cdkDrag` on the `<app-sim-card>` inside stacked-zone template when `isDeckZone()` is true
  - [x] 1.2: Set `[cdkDragData]` to the actual top card (not the displayCard copy) — use `topCard()` for drag data
  - [x] 1.3: Add `[cdkDragDisabled]="cardCount() === 0"` to prevent drag initiation on empty deck
  - [x] 1.4: Add `(cdkDragStarted)="onDragStarted()"` and `(cdkDragEnded)="onDragEnded()"` to manage `isDragging` signal
  - [x] 1.5: Add computed `isDeckZone = computed(() => this.zoneId() === ZoneId.MAIN_DECK)` to SimStackedZoneComponent

- [x] **Task 2: Route Deck→Hand drops to `drawCard()` instead of `moveCard()`** (AC: 1)
  - [x] 2.1: In `SimHandComponent.onDrop()`, detect when `fromZone === ZoneId.MAIN_DECK` and `toZone === ZoneId.HAND`
  - [x] 2.2: When deck-to-hand detected, call `this.commandStack.drawCard()` instead of `this.commandStack.moveCard()`
  - [x] 2.3: Preserve existing cross-zone move and hand reorder logic for all other cases

- [x] **Task 3: Empty deck visual feedback** (AC: 2)
  - [x] 3.1: Add `@keyframes deck-shake` CSS animation to `stacked-zone.component.scss` — subtle horizontal shake (~2px, 300ms)
  - [x] 3.2: Add `deckShake` signal and method `triggerDeckShake()` in SimStackedZoneComponent
  - [x] 3.3: Trigger deck shake when user clicks on an empty deck (click handler guarded by `isDeckZone() && cardCount() === 0`)
  - [x] 3.4: Add `[class.deck--shake]="deckShake()"` and `(animationend)` cleanup on template
  - [x] 3.5: Add `prefers-reduced-motion` override to suppress shake animation

- [x] **Task 4: Add right-click context menu on Deck zone** (AC: 3)
  - [x] 4.1: Import `MatMenuModule` in `stacked-zone.component.ts`
  - [x] 4.2: Add `mat-menu` with `#deckMenu` template reference in stacked-zone template
  - [x] 4.3: Add `[matMenuTriggerFor]="deckMenu"` with `(contextmenu)` event binding on stacked-zone div (Deck only)
  - [x] 4.4: Add `onContextMenu(event: MouseEvent)` handler with `isDevMode()` guard for `event.preventDefault()`
  - [x] 4.5: Add "Shuffle" menu item that calls `this.commandStack.shuffleDeck()`
  - [x] 4.6: Conditionally render context menu only when `isDeckZone()` is true (use `@if`)

- [x] **Task 5: Verify build** (AC: all)
  - [x] 5.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **Zero direct board state mutation from components.** Components call `CommandStackService` semantic methods only. Components NEVER call `boardState.update()` directly. The ONLY direct state calls are `isDragging.set()` which is a UI signal. [Source: architecture.md#Action Flow Pattern]
- **Commands are internal to CommandStackService.** Components NEVER import from `commands/`. They call semantic methods like `commandStack.drawCard()`, `commandStack.shuffleDeck()`. [Source: architecture.md#Service Responsibility Boundaries]
- **Top of deck = last element in array.** Convention: `deck[deck.length - 1]` is the top card. This is critical for drag data — always use `topCard()` (the real card), not `displayCard()` (the face-down copy). [Source: 2-1 and board-state.service.ts]
- **`drawCard()` vs `moveCard()` distinction.** When dragging from deck to hand, ALWAYS use `drawCard()` — it has its own undo semantics (adds card to end of hand, removes from top of deck). Using `moveCard()` instead would work functionally but produces incorrect undo behavior (would restore to wrong deck position). [Source: draw-card.command.ts, move-card.command.ts]
- **`drawCard()` takes no arguments.** It always draws the top card (last element) from the main deck to the hand. The command captures the card at execute time. [Source: command-stack.service.ts:42-46]
- **`shuffleDeck()` stores previous order for undo.** Fisher-Yates shuffle with full snapshot for restoration. [Source: shuffle.command.ts]

### Deck Draggable Implementation

The deck's top card must be made draggable while remaining visually face-down. Key decisions:

**Drag data must be the real top card, not the display copy:**
```typescript
// CORRECT — use topCard() which has the real instanceId pointing to the actual card in MAIN_DECK
[cdkDragData]="topCard()"

// WRONG — displayCard() is a spread copy {...top, faceDown: true} that may cause
// MoveCardCommand to fail finding the card by reference in the zone array
// (instanceId matches, but the card object reference is different)
```

However, since `drawCard()` doesn't use a card reference (it always takes the top card), this distinction only matters if the user drags from deck to a zone OTHER than hand (which would use `moveCard()`). In that case, the `instanceId` from `topCard()` will correctly match the card in the MAIN_DECK array.

**Conditional drag on stacked zones:**
Only the Deck zone needs its top card to be draggable. GY, Banished, and ED cards are accessed through pile overlays (Story 4.1), not direct drag. Add `isDeckZone` computed and conditionally apply `cdkDrag`.

**Empty deck guard:**
`[cdkDragDisabled]="cardCount() === 0"` prevents drag initiation when deck is empty. CDK's `cdkDragDisabled` input cleanly prevents the drag sequence from starting — no custom logic needed.

### SimStackedZoneComponent Modifications

```typescript
// NEW computed signals
readonly isDeckZone = computed(() => this.zoneId() === ZoneId.MAIN_DECK);

// For drag data — the REAL top card (not the face-down display copy)
// topCard() already exists and returns the actual card from board state

// Empty deck shake feedback
readonly deckShake = signal(false);
private shakeTimeout: ReturnType<typeof setTimeout> | undefined;

triggerDeckShake(): void {
  if (this.shakeTimeout) {
    clearTimeout(this.shakeTimeout);
    this.deckShake.set(false);
  }
  requestAnimationFrame(() => {
    this.deckShake.set(true);
    this.shakeTimeout = setTimeout(() => {
      this.deckShake.set(false);
      this.shakeTimeout = undefined;
    }, 300);
  });
}

onDeckShakeAnimationEnd(): void {
  if (this.shakeTimeout) {
    clearTimeout(this.shakeTimeout);
    this.shakeTimeout = undefined;
  }
  this.deckShake.set(false);
}

// isDragging management
onDragStarted(): void {
  this.boardState.isDragging.set(true);
}

onDragEnded(): void {
  this.boardState.isDragging.set(false);
}

// Context menu handler
onContextMenu(event: MouseEvent): void {
  if (!isDevMode()) {
    event.preventDefault();
  }
}

onShuffle(): void {
  this.commandStack.shuffleDeck();
}

// Click on empty deck → shake feedback
onZoneClick(): void {
  if (this.isDeckZone() && this.cardCount() === 0) {
    this.triggerDeckShake();
  }
}
```

### Template Modifications (stacked-zone.component.html)

```html
<div class="sim-stacked-zone"
     [class.empty]="cardCount() === 0"
     [class.zone--just-dropped]="justDropped()"
     [class.deck--shake]="deckShake()"
     cdkDropList
     [cdkDropListData]="zoneId()"
     [cdkDropListSortingDisabled]="true"
     (cdkDropListDropped)="onDrop($event)"
     (animationend)="onGlowAnimationEnd()"
     (click)="onZoneClick()"
     [matBadge]="cardCount()"
     matBadgePosition="above after"
     [matBadgeHidden]="cardCount() === 0">
  @if (displayCard(); as card) {
    <app-sim-card [cardInstance]="card"
                  [cdkDrag]="isDeckZone()"
                  [cdkDragData]="topCard()"
                  [cdkDragDisabled]="cardCount() === 0"
                  [attr.aria-label]="isDeckZone() ? 'Draw card from deck' : null"
                  (cdkDragStarted)="onDragStarted()"
                  (cdkDragEnded)="onDragEnded()" />
  }
  <span class="zone-label">{{ zoneConfig().label }}</span>
</div>

<!-- Deck context menu (only rendered for deck zone) -->
@if (isDeckZone()) {
  <div class="context-menu-trigger"
       [matMenuTriggerFor]="deckMenu"
       (contextmenu)="onContextMenu($event)"
       style="position: absolute; inset: 0;">
  </div>
  <mat-menu #deckMenu="matMenu">
    <button mat-menu-item (click)="onShuffle()">
      <mat-icon>shuffle</mat-icon>
      <span>Shuffle</span>
    </button>
  </mat-menu>
}
```

**Context menu approach note:** The `matMenuTriggerFor` is typically attached to a clickable element. For right-click, we need to manually open the menu. Alternative approach using `ViewChild`:

```typescript
@ViewChild('deckMenuTrigger') deckMenuTrigger!: MatMenuTrigger;

onContextMenu(event: MouseEvent): void {
  if (!isDevMode()) {
    event.preventDefault();
  }
  if (this.isDeckZone()) {
    this.deckMenuTrigger.openMenu();
  }
}
```

This is more robust — the trigger element opens the menu programmatically on `contextmenu` event. The `matMenuTriggerFor` is set with `[matMenuTriggerFor]="deckMenu"` on a hidden trigger element.

### SimHandComponent Modifications

```typescript
// In onDrop() — ADD deck-to-hand detection BEFORE existing cross-zone logic:
onDrop(event: CdkDragDrop<ZoneId, ZoneId, CardInstance>): void {
  const fromZone = event.previousContainer.data;
  const toZone = event.container.data;

  if (fromZone === ZoneId.HAND && toZone === ZoneId.HAND) {
    // Reorder within hand (unchanged from Story 2.2)
    this.commandStack.reorderHand(event.previousIndex, event.currentIndex);
  } else if (fromZone === ZoneId.MAIN_DECK && toZone === ZoneId.HAND) {
    // Draw from deck — use drawCard() for correct undo semantics
    try {
      this.commandStack.drawCard();
      this.glow.triggerGlow();
    } catch {
      // Silently ignored
    }
  } else {
    // Cross-zone move to hand (unchanged from Story 2.2)
    const cardInstanceId = event.item.data.instanceId;
    try {
      this.commandStack.moveCard(cardInstanceId, fromZone, toZone, event.currentIndex);
      this.glow.triggerGlow();
    } catch {
      // Invalid drop — silently ignored
    }
  }
}
```

**Critical:** `drawCard()` always draws the top card at time of execution. If the user drags a card that was the top card when the drag started but isn't anymore by the time the drop fires (edge case: impossible in practice since the board is single-user), `drawCard()` still works correctly because it reads the current top card from the signal.

### CSS Specifications

#### Deck Shake Animation (stacked-zone.component.scss)

```scss
@keyframes deck-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-2px); }
  75% { transform: translateX(2px); }
}

.deck--shake {
  animation: deck-shake 300ms ease-in-out;
}

@media (prefers-reduced-motion: reduce) {
  .deck--shake {
    animation: none;
    // Fallback: brief border highlight
    border-color: $sim-accent-primary;
    transition: border-color 200ms ease;
  }
}
```

#### Context Menu Styles

No custom styles needed — `mat-menu` inherits from Angular Material theming. The context menu trigger overlay covers the stacked zone via `position: absolute; inset: 0` to capture right-click events over the entire zone area.

### What This Story Does NOT Include

- **No context menu on Extra Deck** — ED gets "View" in Story 4.1 (pile overlay)
- **No "Search", "Mill (N)", "Reveal (N)"** context menu items on Deck — added in Story 4.2
- **No drag from GY, Banished, or ED** — these come via pile overlays in Story 4.1
- **No card state toggle** (face-down/flip, ATK/DEF) — Story 3.1
- **No card inspector** (hover details) — Story 3.2
- **No undo/redo UI** — Story 5.1 (stacks fill silently)
- **No keyboard shortcuts** — Story 5.2
- **Hand reordering already works** from Story 2.2 — AC #4 is a "confirm existing" acceptance criterion, no new code needed

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| Draggable deck top card (`cdkDrag` on stacked zone) | Story 4.1 may extend with pile overlay drag |
| Context menu infrastructure on Deck zone (`mat-menu`) | Story 4.2 extends with "Search", "Mill (N)", "Reveal (N)" menu items |
| `isDeckZone` computed on SimStackedZoneComponent | Story 4.2 for conditional menu items |
| `onContextMenu()` with `isDevMode()` guard pattern | Story 3.1 reuses same pattern for card state context menu |
| `isDragging` management on stacked zone | Already used by future inspector/overlay suppression |
| Deck-to-hand draw routing in SimHandComponent | Standalone — core draw mechanic |

### Previous Story Intelligence (Story 2.2)

**Patterns established to follow:**
- SCSS import: `@use 'sim-tokens' as *` (not `@import`) — Dart Sass 2.0
- Service injection: `inject()` function pattern (not constructor injection in components)
- Signal access: read via `.()`, mutate via `.set()` or `.update()`
- Gold glow: `createGlowEffect()` factory from `glow-effect.ts` — already in use
- Drop handler pattern: try/catch wrapping `commandStack` calls, gold glow on success
- `isDragging` management via `(cdkDragStarted)` and `(cdkDragEnded)` on parent components
- `cdkDragData` uses `CardInstance` objects directly
- `aria-label` on draggable card elements
- `prefers-reduced-motion` media query on all animations

**Story 2.2 code review fixes to maintain:**
- try/catch in all drop handlers (H1)
- setTimeout fallback for `justDropped` cleanup (H2) — via `createGlowEffect()`
- `requestAnimationFrame` + timeout reset for glow restart on rapid drops (H3) — via `triggerGlow()`
- `aria-label` on draggable cards (M2)

### CDK DragDrop Technical Notes for This Story

**Conditional `cdkDrag`:**
CDK supports `[cdkDrag]="booleanCondition"` — when `false`, the element is not registered as a drag source. However, the more reliable approach is `[cdkDragDisabled]="!isDeckZone()"` which keeps the directive active but prevents interaction. Both work; `cdkDragDisabled` is preferred because it doesn't cause DOM re-registration.

**Actually**, looking at Angular CDK docs more carefully: `cdkDrag` is a directive selector, not an input. You can't do `[cdkDrag]="condition"`. Instead, use `cdkDrag [cdkDragDisabled]="condition"` to conditionally enable/disable. So the approach is:

```html
<!-- Always apply cdkDrag, but disable when not deck or empty -->
<app-sim-card [cardInstance]="card"
              cdkDrag
              [cdkDragData]="topCard()"
              [cdkDragDisabled]="!isDeckZone() || cardCount() === 0"
              (cdkDragStarted)="onDragStarted()"
              (cdkDragEnded)="onDragEnded()" />
```

This is cleaner — `cdkDrag` is always present but disabled for non-deck zones. The overhead is negligible since CDK respects `cdkDragDisabled` efficiently.

**`mat-menu` for context menu:**
Angular Material's `mat-menu` is designed for left-click triggers via `matMenuTriggerFor`. For right-click (contextmenu event), use `MatMenuTrigger.openMenu()` programmatically:

```typescript
import { MatMenuTrigger } from '@angular/material/menu';

@ViewChild('deckMenuTrigger') deckMenuTrigger?: MatMenuTrigger;

onContextMenu(event: MouseEvent): void {
  if (!isDevMode()) {
    event.preventDefault();
  }
  if (this.isDeckZone() && this.deckMenuTrigger) {
    event.preventDefault(); // Always prevent default to open our menu
    this.deckMenuTrigger.openMenu();
  }
}
```

Wait — there's a conflict. The `isDevMode()` guard says "don't preventDefault in dev mode" so the browser context menu stays accessible. But we also need to open our mat-menu. Resolution:
- In **production**: `event.preventDefault()` + open mat-menu
- In **dev mode**: open mat-menu on right-click (our menu appears), but also allow browser context menu if needed. In practice, `preventDefault` should ALWAYS be called when we want to show our menu — the isDevMode guard means "don't block browser context menu". So we need a different approach:

```typescript
onContextMenu(event: MouseEvent): void {
  if (this.isDeckZone()) {
    if (!isDevMode()) {
      event.preventDefault();
    }
    // Position and open the menu
    this.deckMenuTrigger?.openMenu();
  }
}
```

In dev mode, both menus will appear (browser + ours). In production, only ours appears. This matches the UX spec: "event.preventDefault() only in production (isDevMode() guard)".

### Existing Code — What NOT to Change

| File | Keep As-Is |
|---|---|
| `board-state.service.ts` | All existing code. No new methods needed. `isDeckEmpty` already exists. |
| `command-stack.service.ts` | All existing code. `drawCard()`, `shuffleDeck()`, `reorderHand()` already exist from Story 2.1. No changes needed. |
| `simulator.models.ts` | `SimCommand`, `ZoneId`, `CardInstance`, `ZONE_CONFIG` — all unchanged. |
| `commands/*.ts` | All command classes unchanged. |
| `simulator-page.component.*` | Unchanged. |
| `board.component.*` | Unchanged — `cdkDropListGroup` already present from Story 2.2. |
| `zone.component.*` | Unchanged. |
| `glow-effect.ts` | Unchanged — reused as-is. |
| `sim-card.component.*` | Unchanged — drag styles already present from Story 2.2. |

### Project Structure Notes

**No new files created by this story.** All changes are modifications to existing files.

**Files modified by this story:**
```
front/src/app/pages/simulator/
  stacked-zone.component.ts       # MODIFIED — add isDeckZone, deckShake, onDragStarted/Ended, onContextMenu, onShuffle, onZoneClick, MatMenuModule/MatIconModule imports, isDevMode import, ViewChild
  stacked-zone.component.html     # MODIFIED — add cdkDrag on card (with disabled), deck--shake class, context menu trigger + mat-menu, click handler
  stacked-zone.component.scss     # MODIFIED — add @keyframes deck-shake, .deck--shake, prefers-reduced-motion for shake
  hand.component.ts               # MODIFIED — add MAIN_DECK to ZoneId detection in onDrop, route deck-to-hand to drawCard()
```

### References

- [Source: architecture.md#Action Flow Pattern] — Components call CommandStackService semantic methods only
- [Source: architecture.md#Service Responsibility Boundaries] — drawCard(), shuffleDeck() on CommandStackService; isDeckEmpty on BoardStateService
- [Source: architecture.md#Error Handling Patterns] — Empty deck draw: visual feedback, no toast
- [Source: ux-design-specification.md#Context Menu Patterns] — Deck right-click: mat-menu with Shuffle, isDevMode() guard
- [Source: ux-design-specification.md#Stacked Zone Interactions] — Deck right-click opens context menu (Shuffle, Search — Search comes in Story 4.2)
- [Source: ux-design-specification.md#Drag & Drop Patterns] — Drag initiation, isDragging signal, cross-container drag via cdkDropListGroup
- [Source: ux-design-specification.md#Loading & Empty State Patterns] — Empty stacked zone visual feedback
- [Source: ux-design-specification.md#Feedback & State Indication Patterns] — Gold glow, zone highlighting
- [Source: ux-design-specification.md#Responsive Design & Accessibility] — prefers-reduced-motion support
- [Source: epics.md#Story 2.3] — Acceptance criteria, user story
- [Source: epics.md#Epic 2 Implementation Notes] — Context menu on Deck with "Shuffle" only, isDragging suppression
- [Source: 2-2-drag-and-drop-between-all-zones.md] — CDK wiring patterns, glow effect, isDragging management, try/catch drop handlers
- [Source: command-stack.service.ts] — drawCard(), shuffleDeck(), reorderHand() — all ready to use
- [Source: board-state.service.ts] — isDeckEmpty computed, isDragging signal
- [Source: draw-card.command.ts] — Draws top card (last element) to hand, no arguments
- [Source: shuffle.command.ts] — Fisher-Yates with previousOrder snapshot for undo
- [Source: _sim-tokens.scss] — $sim-accent-primary for reduced-motion fallback

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build verified: `ng build --configuration development` — zero errors, 5.2s build time

### Completion Notes List

- **Task 1:** Added `isDeckZone` computed, `cdkDrag` with `[cdkDragData]="topCard()"` and `[cdkDragDisabled]="!isDeckZone() || cardCount() === 0"` on the `<app-sim-card>` in stacked-zone template. Added `onDragStarted`/`onDragEnded` for `isDragging` signal management. Added `aria-label` on draggable deck card.
- **Task 2:** Added deck-to-hand detection in `SimHandComponent.onDrop()` — when `fromZone === ZoneId.MAIN_DECK`, calls `commandStack.drawCard()` instead of `moveCard()` for correct undo semantics. Existing cross-zone and hand reorder logic preserved.
- **Task 3:** Added `@keyframes deck-shake` (2px horizontal, 300ms), `deckShake` signal with `triggerDeckShake()` using requestAnimationFrame + setTimeout pattern. Click handler on zone triggers shake when deck is empty. Combined `onAnimationEnd` handler routes by animation name (gold-glow vs deck-shake). `prefers-reduced-motion` override suppresses shake and applies border-color fallback.
- **Task 4:** Added `MatMenuModule` + `MatIconModule` imports. Hidden `<span>` anchor with `matMenuTriggerFor` + `@ViewChild(MatMenuTrigger)` for programmatic right-click opening. `onContextMenu` with `isDevMode()` guard for `preventDefault`. Shuffle menu item calls `commandStack.shuffleDeck()`. Context menu conditionally rendered via `@if (isDeckZone())`.
- **Task 5:** Build verified with zero errors.

### Change Log

- 2026-02-11: Story 2.3 implemented — deck top card draggable, deck→hand draw routing, empty deck shake feedback, right-click shuffle context menu. All 5 tasks completed, build verified.
- 2026-02-11: Code review (Claude Opus 4.6) — 4 MEDIUM + 4 LOW issues found, all fixed. M1: context menu now opens at cursor position. M2: prefers-reduced-motion border-color transition moved to base class for smooth fade-out. M3: architecture.md Error Handling updated to reflect try/catch pattern. M4+L1+L4: removed dead try/catch around drawCard() in hand.component.ts, replaced with accurate comment. L3: added gold glow feedback after shuffle. L2: dev mode double-menu acknowledged as by-design per AC. Build re-verified zero errors.

### File List

- `front/src/app/pages/simulator/stacked-zone.component.ts` — MODIFIED (isDeckZone, deckShake, drag events, context menu with cursor positioning via ElementRef, MatMenuModule/MatIconModule imports, isDevMode, ViewChild, glow after shuffle)
- `front/src/app/pages/simulator/stacked-zone.component.html` — MODIFIED (cdkDrag on card, deck--shake class, context menu trigger + mat-menu with #menuAnchor, click/contextmenu handlers)
- `front/src/app/pages/simulator/stacked-zone.component.scss` — MODIFIED (deck-shake animation, context-menu-anchor, prefers-reduced-motion transition on base class)
- `front/src/app/pages/simulator/hand.component.ts` — MODIFIED (deck-to-hand detection routing to drawCard(), removed dead try/catch)
- `_bmad-output/planning-artifacts/architecture.md` — MODIFIED (Error Handling Patterns updated to reflect try/catch in drop handlers)
