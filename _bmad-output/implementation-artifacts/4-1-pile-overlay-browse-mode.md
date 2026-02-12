# Story 4.1: Pile Overlay — Browse Mode

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to click on a stacked zone and see all its cards in a side overlay,
so that I can browse and drag cards from the graveyard, banished pile, or extra deck to the board.

## Acceptance Criteria

1. **Given** I click on a stacked zone (GY, Banished, or ED),
   **When** the overlay opens,
   **Then** a `SimPileOverlayComponent` appears to the side of the board (never centered fullscreen),
   **And** it displays all cards in the zone as scrollable rows: card image thumbnail + card name,
   **And** each card row is a CDK drag source — I can drag any card to a board zone,
   **And** the overlay opens within 300ms.

2. **Given** I click on the Extra Deck zone,
   **When** the overlay opens in browse mode,
   **Then** face-down ED cards and face-up Pendulum monsters are displayed in separate visual groups within the overlay.

3. **Given** I click on the Banished zone and it contains face-down banished cards,
   **When** the overlay opens in browse mode,
   **Then** face-down cards are visually distinct (card back image + subtle face-down indicator icon) and displayed in a separate visual group from face-up cards.

4. **Given** a pile overlay is open and I click a different stacked zone,
   **When** the new overlay opens,
   **Then** the previous overlay auto-closes (max 1 pile overlay visible at a time).

5. **Given** I drag a card from the overlay to the board,
   **When** the drag starts,
   **Then** the source overlay **stays open** during the drag (allows multi-card operations),
   **And** `cdkDragPreviewContainer: 'global'` ensures the drag preview has correct z-index above the overlay.

6. **Given** I click on a stacked zone that has 0 cards,
   **When** the overlay opens,
   **Then** it shows a subtle message: "No cards in [zone name]".

7. **Given** a pile overlay is open on the right side,
   **When** the SimCardInspectorComponent would appear on the right,
   **Then** the inspector repositions to the left via computed signal.

8. **Given** I click outside the overlay or press Escape,
   **When** the dismiss event fires,
   **Then** the overlay closes.

## Tasks / Subtasks

- [x] **Task 1: Add overlay state signals to BoardStateService** (AC: 4, 7)
  - [x] 1.1: Add `readonly activeOverlayZone = signal<ZoneId | null>(null)` to `board-state.service.ts`
  - [x] 1.2: Add `openOverlay(zoneId: ZoneId): void` method — sets `activeOverlayZone` (auto-closes previous by overwriting)
  - [x] 1.3: Add `closeOverlay(): void` method — sets `activeOverlayZone` to `null`
  - [x] 1.4: Add `readonly isOverlayOpen = computed(() => this.activeOverlayZone() !== null)` convenience signal
  - [x] 1.5: Add `readonly activeOverlayCards = computed(...)` that returns the cards for the active overlay zone from `boardState()`

- [x] **Task 2: Create SimPileOverlayComponent** (AC: 1, 2, 3, 5, 6, 8)
  - [x] 2.1: Create `pile-overlay.component.ts` — standalone, OnPush, selector `app-sim-pile-overlay`
  - [x] 2.2: Inject `BoardStateService`
  - [x] 2.3: Read `activeOverlayZone`, `activeOverlayCards`, `isDragging` signals
  - [x] 2.4: Create `isOpen = computed(() => this.activeOverlayZone() !== null)`
  - [x] 2.5: Create `zoneName = computed(() => ...)` that returns human-readable zone name from `ZONE_CONFIG`
  - [x] 2.6: Create `isEmpty = computed(() => this.activeOverlayCards().length === 0)`
  - [x] 2.7: Create computed signals for visual groups (ED: face-down vs face-up Pendulum; Banished: face-down vs face-up)
  - [x] 2.8: Create `pile-overlay.component.html` with card list (image thumbnail + name per row), empty state, visual groups
  - [x] 2.9: Each card row is a `cdkDrag` source with `[cdkDragData]="card"` and `cdkDragPreviewContainer: 'global'`
  - [x] 2.10: Whole overlay is a `cdkDropList` with `[cdkDropListData]="activeOverlayZone()"` and `[cdkDropListEnterPredicate]="noDrop"` (browse mode: no drop INTO overlay)
  - [x] 2.11: Add close button and Escape key handler (`@HostListener('document:keydown.escape')`)
  - [x] 2.12: Add click-outside detection via `document:mousedown` listener
  - [x] 2.13: Create `pile-overlay.component.scss` — fixed right panel, `$sim-surface` bg, scrollable, z-index 50 (above inspector z:10, below CDK overlay z:1000)
  - [x] 2.14: Wire hover events on overlay cards via `(hovered)` / `(unhovered)` outputs on `<app-sim-card>`
  - [x] 2.15: ARIA: `role="complementary"`, `aria-label` with zone name, focus management via `effect()` on open
  - [x] 2.16: `prefers-reduced-motion` support (disable fade transition)

- [x] **Task 3: Wire click handler on SimStackedZoneComponent** (AC: 1, 4, 6)
  - [x] 3.1: Modify `onZoneClick()` in `stacked-zone.component.ts` — for GY, Banish, ED: call `boardState.openOverlay(this.zoneId())`
  - [x] 3.2: Keep existing Deck zone behavior: deck shake on empty click, no overlay on click (Deck search = context menu in Story 4.2)
  - [x] 3.3: Overlay stays open during drag — `openOverlay()` is NOT suppressed by `isDragging`

- [x] **Task 4: Move cdkDropListGroup for cross-container drag** (AC: 5)
  - [x] 4.1: In `board.component.html`, wrap the `.sim-board` div + `<app-sim-pile-overlay />` + `<app-sim-card-inspector />` in a container div with `cdkDropListGroup`
  - [x] 4.2: Remove `cdkDropListGroup` from the `.sim-board` div
  - [x] 4.3: The container div ensures all `cdkDropList` elements (board zones + overlay) belong to the same group
  - [x] 4.4: Container div uses `height: 100%; position: relative;` for layout

- [x] **Task 5: Add SimPileOverlayComponent to board** (AC: all)
  - [x] 5.1: Add `SimPileOverlayComponent` to `board.component.ts` imports array
  - [x] 5.2: Add `<app-sim-pile-overlay />` to `board.component.html` — inside the new container div, sibling to `.sim-board` and `<app-sim-card-inspector />`

- [x] **Task 6: Inspector repositioning** (AC: 7)
  - [x] 6.1: In `card-inspector.component.ts`, inject `BoardStateService` (already done)
  - [x] 6.2: Add `readonly inspectorPosition = computed(() => this.boardState.isOverlayOpen() ? 'left' : 'right')`
  - [x] 6.3: Add `[class.position-left]` host binding driven by `inspectorPosition()`
  - [x] 6.4: In `card-inspector.component.scss`, add `.position-left` styles: `right: auto; left: 0; border-left: none; border-right: 1px solid $sim-zone-border;`
  - [x] 6.5: Compact desktop drawer (bottom) — no repositioning needed (overlay and inspector don't conflict at bottom)

- [x] **Task 7: Drag from overlay handler** (AC: 5)
  - [x] 7.1: In `SimPileOverlayComponent`, handle `(cdkDragStarted)` to set `boardState.isDragging(true)` and `(cdkDragEnded)` to set `false`
  - [x] 7.2: On drag end, do NOT auto-close overlay — overlay stays open for multi-card operations
  - [x] 7.3: Target zones' existing `onDrop()` handlers already call `commandStack.moveCard()` using `event.previousContainer.data` as source zone — no changes needed on target zones

- [x] **Task 8: Verify build** (AC: all)
  - [x] 8.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **Overlay is a cross-cutting UI concern.** The `activeOverlayZone` signal MUST live in `BoardStateService` (same exception rationale as `isDragging` and `hoveredCard`) because 3+ non-hierarchical components need it: `SimStackedZoneComponent` (trigger), `SimPileOverlayComponent` (render), `SimCardInspectorComponent` (reposition). [Source: architecture.md#Anti-Patterns — Exception for cross-cutting UI signals]
- **Opening an overlay is NOT a command.** Overlay open/close is UI-only state — not board state. No command created. Does not affect undo/redo. [Source: architecture.md#Action Flow Pattern, ux-design-specification.md#Loading & Empty State Patterns]
- **Dragging FROM the overlay IS a command.** When a card is dragged from overlay to a board zone, `CommandStackService.moveCard()` is called — this IS a board state mutation tracked in undo stack. [Source: architecture.md#Action Flow Pattern]
- **Max 1 pile overlay visible.** Setting a new `activeOverlayZone` automatically closes the previous one — the signal overwrite IS the auto-close mechanism. [Source: ux-design-specification.md#Overlay & Panel Patterns]
- **Overlay stays open during drag-from-overlay.** The overlay MUST NOT close when a drag starts from within it. Only closes via explicit action (click-outside, Escape, opening different zone overlay). [Source: ux-design-specification.md#Drag & Drop Patterns]
- **cdkDragPreviewContainer: 'global'** is MANDATORY on overlay card drag items. Without it, the drag preview inherits the overlay's CDK overlay z-index and renders incorrectly when dragging to the board. [Source: ux-design-specification.md#Drag & Drop Patterns, epics.md#Epic 4 Implementation Notes]
- **cdkDropListGroup must encompass ALL drop lists.** The overlay's `cdkDropList` and all board zone `cdkDropList` elements must be descendants of the same `cdkDropListGroup` container. This requires restructuring the board template. [Source: ux-design-specification.md#Cross-Container Drag]
- **Overlay's cdkDropList prevents drops INTO it.** Browse mode = read-only pile view with drag-out only. `cdkDropListEnterPredicate` returns `false` always. [Source: architecture.md#Drag & Drop Orchestration Pattern]
- **Zero direct board state mutation** — cards moved via `CommandStackService.moveCard()` only. Overlay reads cards reactively from `BoardStateService.boardState()`. [Source: architecture.md#Enforcement Guidelines]
- **SimCardComponent stays pure.** Overlay uses `<app-sim-card>` for rendering. Parent wires hover events to `boardState.setHoveredCard()`. Same pattern as SimZoneComponent and SimHandComponent. [Source: 3-2-card-inspector-panel.md#Hover Event Design Decision]

### Overlay Component Design

The overlay is a `position: fixed` right panel — NOT a CDK Overlay/Dialog. This avoids CDK Overlay z-index conflicts and keeps the DOM structure simple. The overlay is a sibling to the board grid, rendered conditionally via `@if (isOpen())`.

```typescript
@Component({
  selector: 'app-sim-pile-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, SimCardComponent, MatIconModule],
  templateUrl: './pile-overlay.component.html',
  styleUrl: './pile-overlay.component.scss',
  host: {
    'role': 'dialog',
    '[attr.aria-modal]': '"true"',
    '[attr.aria-label]': 'ariaLabel()',
    '[class.open]': 'isOpen()',
  },
})
export class SimPileOverlayComponent {
  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);

  readonly activeZone = this.boardState.activeOverlayZone;
  readonly isOpen = this.boardState.isOverlayOpen;
  readonly cards = this.boardState.activeOverlayCards;
  readonly isDragging = this.boardState.isDragging;

  readonly zoneName = computed(() => {
    const zone = this.activeZone();
    return zone !== null ? ZONE_CONFIG[zone].label : '';
  });

  readonly ariaLabel = computed(() => `${this.zoneName()} overlay`);

  readonly isEmpty = computed(() => this.cards().length === 0);

  // Visual grouping for Extra Deck
  readonly isExtraDeck = computed(() => this.activeZone() === ZoneId.EXTRA_DECK);
  readonly faceDownCards = computed(() => this.cards().filter(c => c.faceDown));
  readonly faceUpCards = computed(() => this.cards().filter(c => !c.faceDown));

  // Visual grouping for Banished (face-down vs face-up)
  readonly isBanished = computed(() => this.activeZone() === ZoneId.BANISH);

  // Needs grouping: ED or Banished when face-down cards exist
  readonly needsGrouping = computed(() =>
    (this.isExtraDeck() || this.isBanished()) && this.faceDownCards().length > 0
  );

  readonly noDrop = (): boolean => false; // Browse mode: cannot drop INTO overlay

  close(): void {
    this.boardState.closeOverlay();
  }

  onDragStarted(): void {
    this.boardState.isDragging.set(true);
  }

  onDragEnded(): void {
    this.boardState.isDragging.set(false);
  }

  onCardHovered(card: CardInstance): void {
    this.boardState.setHoveredCard(card);
  }

  onCardUnhovered(): void {
    this.boardState.setHoveredCard(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) {
      this.close();
    }
  }
}
```

### Overlay Template Structure

```html
<!-- pile-overlay.component.html -->
@if (isOpen()) {
  <!-- Backdrop: click to close -->
  <div class="overlay-backdrop" (click)="close()"></div>

  <div class="overlay-panel"
       cdkDropList
       [cdkDropListData]="activeZone()"
       [cdkDropListSortingDisabled]="true"
       [cdkDropListEnterPredicate]="noDrop">

    <!-- Header -->
    <div class="overlay-header">
      <h3 class="overlay-title">{{ zoneName() }}</h3>
      <button class="overlay-close" (click)="close()" aria-label="Close overlay">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <!-- Empty state -->
    @if (isEmpty()) {
      <div class="overlay-empty">
        <span>No cards in {{ zoneName() }}</span>
      </div>
    } @else {
      <!-- Grouped display for ED / Banished -->
      @if (needsGrouping()) {
        @if (faceUpCards().length > 0) {
          <div class="card-group">
            <span class="group-label">Face-up</span>
            @for (card of faceUpCards(); track card.instanceId) {
              <div class="overlay-card-row"
                   cdkDrag
                   [cdkDragData]="card"
                   cdkDragPreviewContainer="global"
                   (cdkDragStarted)="onDragStarted()"
                   (cdkDragEnded)="onDragEnded()">
                <app-sim-card [cardInstance]="card"
                              [size]="'hand'"
                              (hovered)="onCardHovered($event)"
                              (unhovered)="onCardUnhovered()" />
                <span class="card-name">{{ card.card.card.name }}</span>
              </div>
            }
          </div>
        }
        @if (faceDownCards().length > 0) {
          <div class="card-group">
            <span class="group-label">Face-down</span>
            @for (card of faceDownCards(); track card.instanceId) {
              <div class="overlay-card-row face-down-row"
                   cdkDrag
                   [cdkDragData]="card"
                   cdkDragPreviewContainer="global"
                   (cdkDragStarted)="onDragStarted()"
                   (cdkDragEnded)="onDragEnded()">
                <app-sim-card [cardInstance]="card"
                              [size]="'hand'"
                              (hovered)="onCardHovered($event)"
                              (unhovered)="onCardUnhovered()" />
                <span class="card-name face-down-label">Face-down</span>
                <mat-icon class="face-down-icon">visibility_off</mat-icon>
              </div>
            }
          </div>
        }
      } @else {
        <!-- Flat display for GY (all face-up) -->
        @for (card of cards(); track card.instanceId) {
          <div class="overlay-card-row"
               cdkDrag
               [cdkDragData]="card"
               cdkDragPreviewContainer="global"
               (cdkDragStarted)="onDragStarted()"
               (cdkDragEnded)="onDragEnded()">
            <app-sim-card [cardInstance]="card"
                          [size]="'hand'"
                          (hovered)="onCardHovered($event)"
                          (unhovered)="onCardUnhovered()" />
            <span class="card-name">{{ card.card.card.name }}</span>
          </div>
        }
      }
    }
  </div>
}
```

### Overlay Styling

```scss
// pile-overlay.component.scss
@use 'sim-tokens' as *;

.overlay-backdrop {
  position: fixed;
  inset: 0;
  background: transparent; // Invisible click target — board visible underneath
  z-index: 49;
}

.overlay-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 300px;
  height: 100vh;
  background: $sim-surface;
  border-left: 1px solid $sim-zone-border;
  z-index: 50; // Above inspector (10), below CDK overlay (1000+)
  overflow-y: auto;
  padding: $sim-padding-overlay;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  animation: overlay-fade-in 150ms ease-out;
}

@keyframes overlay-fade-in {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

.overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid $sim-zone-border;
}

.overlay-title {
  color: $sim-text-primary;
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.overlay-close {
  background: none;
  border: none;
  color: $sim-text-secondary;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  border-radius: $sim-radius-zone;

  &:hover {
    color: $sim-text-primary;
    background: $sim-surface-elevated;
  }
}

.overlay-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: $sim-text-secondary;
  font-size: 0.875rem;
  font-style: italic;
}

.card-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.group-label {
  color: $sim-text-secondary;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.25rem 0;
}

.overlay-card-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem;
  border-radius: $sim-radius-zone;
  cursor: grab;

  &:hover {
    background: $sim-surface-elevated;
  }

  app-sim-card {
    width: 40px;
    flex-shrink: 0;
  }
}

.card-name {
  color: $sim-text-primary;
  font-size: 0.875rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.face-down-row {
  opacity: 0.7;
}

.face-down-label {
  color: $sim-text-secondary;
  font-style: italic;
}

.face-down-icon {
  color: $sim-text-secondary;
  font-size: 18px;
  width: 18px;
  height: 18px;
}

// CDK drag styling for overlay cards
.overlay-card-row.cdk-drag-preview {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  background: $sim-surface-elevated;
  border-radius: $sim-radius-zone;
  z-index: 1100; // Above everything
}

.overlay-card-row.cdk-drag-placeholder {
  opacity: 0.3;
}

// Reduced motion support
@media (prefers-reduced-motion: reduce) {
  .overlay-panel {
    animation: none;
  }
}

:host-context(.force-reduced-motion) .overlay-panel {
  animation: none;
}
```

### BoardStateService Changes

```typescript
// board-state.service.ts — ADD these signals and methods

// After isDragging signal:
readonly activeOverlayZone = signal<ZoneId | null>(null);
readonly isOverlayOpen = computed(() => this.activeOverlayZone() !== null);
readonly activeOverlayCards = computed(() => {
  const zone = this.activeOverlayZone();
  if (zone === null) return [];
  return this.boardState()[zone];
});

openOverlay(zoneId: ZoneId): void {
  this.activeOverlayZone.set(zoneId);
}

closeOverlay(): void {
  this.activeOverlayZone.set(null);
}
```

**Key behavior:** `activeOverlayCards` is a computed signal derived from `boardState()`. When a card is dragged OUT of the overlay, `CommandStackService.moveCard()` mutates `boardState` → `activeOverlayCards` recomputes → overlay card list updates reactively (removed card disappears from the list). No manual overlay refresh needed.

### SimStackedZoneComponent Click Handler Changes

```typescript
// stacked-zone.component.ts — MODIFY onZoneClick()

onZoneClick(): void {
  if (this.isDeckZone()) {
    // Deck zone: shake if empty, do nothing otherwise (search = context menu in Story 4.2)
    if (this.cardCount() === 0) {
      this.triggerDeckShake();
    }
    return;
  }

  // GY, Banished, ED: open browse overlay
  this.boardState.openOverlay(this.zoneId());
}
```

**Key behavior:** Clicking GY, Banish, or ED (empty or not) always opens the overlay. Empty overlay shows "No cards in [zone name]" message. Clicking a different stacked zone auto-closes the current overlay (signal overwrite). Main Deck retains its current click behavior (shake if empty).

### Board Template Restructuring

```html
<!-- board.component.html — RESTRUCTURED for cdkDropListGroup -->
<div class="board-container" cdkDropListGroup>
  <div class="sim-board" role="application" aria-label="Yu-Gi-Oh simulator board">
    <!-- Row 1: Extra Monster Zones + Banish -->
    <app-sim-zone [zoneId]="ZoneId.EXTRA_MONSTER_L" [style.grid-area]="'emz-l'" />
    <app-sim-zone [zoneId]="ZoneId.EXTRA_MONSTER_R" [style.grid-area]="'emz-r'" />
    <app-sim-stacked-zone [zoneId]="ZoneId.BANISH" [style.grid-area]="'banish'" />

    <!-- Row 2: Field + Monster Zones + GY -->
    <app-sim-zone [zoneId]="ZoneId.FIELD_SPELL" [style.grid-area]="'field'" />
    <app-sim-zone [zoneId]="ZoneId.MONSTER_1" [style.grid-area]="'m1'" />
    <app-sim-zone [zoneId]="ZoneId.MONSTER_2" [style.grid-area]="'m2'" />
    <app-sim-zone [zoneId]="ZoneId.MONSTER_3" [style.grid-area]="'m3'" />
    <app-sim-zone [zoneId]="ZoneId.MONSTER_4" [style.grid-area]="'m4'" />
    <app-sim-zone [zoneId]="ZoneId.MONSTER_5" [style.grid-area]="'m5'" />
    <app-sim-stacked-zone [zoneId]="ZoneId.GRAVEYARD" [style.grid-area]="'gy'" />

    <!-- Row 3: ED + Spell/Trap Zones + Deck -->
    <app-sim-stacked-zone [zoneId]="ZoneId.EXTRA_DECK" [style.grid-area]="'ed'" />
    <app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_1" [style.grid-area]="'st1'" />
    <app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_2" [style.grid-area]="'st2'" />
    <app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_3" [style.grid-area]="'st3'" />
    <app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_4" [style.grid-area]="'st4'" />
    <app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_5" [style.grid-area]="'st5'" />
    <app-sim-stacked-zone [zoneId]="ZoneId.MAIN_DECK" [style.grid-area]="'deck'" />

    <!-- Row 4: Controls + Hand -->
    <div [style.grid-area]="'controls'" class="controls-placeholder"></div>
    <app-sim-hand [style.grid-area]="'hand'" />
  </div>

  <!-- Pile overlay — inside cdkDropListGroup container, outside grid -->
  <app-sim-pile-overlay />

  <!-- Inspector — inside cdkDropListGroup container, outside grid -->
  <app-sim-card-inspector />
</div>
```

**Board SCSS update required:** Add `.board-container { height: 100%; position: relative; }` and move `height: 100%` from `:host` to `.board-container` if needed. The `.sim-board` CSS grid styles remain unchanged.

### Card Inspector Repositioning

```typescript
// card-inspector.component.ts — ADD repositioning
readonly inspectorPosition = computed(() =>
  this.boardState.isOverlayOpen() ? 'left' : 'right'
);
```

```typescript
// Update host bindings:
host: {
  'role': 'complementary',
  '[attr.aria-label]': '"Card inspector"',
  'aria-live': 'polite',
  '[class.visible]': 'isVisible()',
  '[class.expanded]': 'isExpanded()',
  '[class.position-left]': 'inspectorPosition() === "left"',
},
```

```scss
// card-inspector.component.scss — ADD left position variant

:host.position-left {
  right: auto;
  left: 0;
  border-left: none;
  border-right: 1px solid $sim-zone-border;
}

// Compact desktop: no repositioning needed (drawer is bottom)
@media (max-width: 1279px) {
  :host.position-left {
    right: 0;
    left: 0;
    border-right: none;
    border-top: 1px solid $sim-zone-border;
  }
}
```

### Z-Index Hierarchy Recap

Per UX spec overlay hierarchy:
1. CDK drag preview — z-index ~1100 (`cdkDragPreviewContainer: 'global'` + `.cdk-drag-preview`)
2. Context menus — z-index ~1000 (`mat-menu` CDK Overlay)
3. **Pile overlay panel** — z-index 50 (`.overlay-panel`) ← **this story**
4. Pile overlay backdrop — z-index 49 (`.overlay-backdrop`)
5. Card inspector — z-index 10 (`position: fixed`)
6. Board zones — base level (no explicit z-index)

### NFR Compliance

- **NFR6:** Zone overlays open within 300ms — 150ms CSS fade-in animation. Well under 300ms budget.
- **NFR2:** Board state updates within 100ms — cards moved from overlay trigger `boardState.update()` → computed signals propagate instantly.
- **NFR4:** Responsive with full board — overlay uses `position: fixed`, no impact on board rendering. OnPush + computed signals ensure only affected components re-render.

### What This Story Does NOT Include

- **No search mode** (deck search with text filter) — Story 4.2
- **No reveal mode** (deck top N reveal) — Story 4.2
- **No context menu additions** (Search, Mill, Reveal on Deck) — Story 4.2
- **No XYZ material management** — Story 4.3
- **No Deck zone click-to-overlay** — Deck uses context menu for search (Story 4.2)
- **No undo/redo UI** (ControlBar buttons) — Story 5.1
- **No keyboard shortcuts** (Ctrl+Z, Ctrl+Y) — Story 5.2 (note: Escape for overlay close IS in this story)
- **No card pills** (quick actions on hover) — post-MVP
- **No overlay for Main Deck browse** — Main Deck is always face-down; "browse" is meaningless. Deck contents are accessed via Search (Story 4.2)

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `SimPileOverlayComponent` (with mode scaffolding) | Story 4.2 (search + reveal modes), Story 4.3 (XYZ material context) |
| `activeOverlayZone` / `isOverlayOpen` signals in BoardStateService | Story 4.2 (deck search triggers overlay), Story 5.2 (Escape closes overlay) |
| `openOverlay()` / `closeOverlay()` methods | Story 4.2 (deck context menu → search), Story 5.2 (keyboard shortcut Escape) |
| Inspector `position-left` CSS class | All future overlay stories |
| `cdkDropListGroup` restructuring (board container) | Story 4.2 (overlay drag in search mode), Story 4.3 (XYZ material drag) |
| Hover wiring on overlay cards (`hovered`/`unhovered`) | Already functional via existing SimCardComponent + BoardStateService |

### Previous Story Intelligence (Story 3.2)

**Patterns established to follow:**
- SCSS import: `@use 'sim-tokens' as *` (not `@import`) — Dart Sass 2.0
- Service injection: `inject()` function pattern (not constructor injection in components)
- Signal access: read via `.()`, mutate via `.set()` or `.update()`
- `isDragging` management via `(cdkDragStarted)` and `(cdkDragEnded)` on parent components
- `prefers-reduced-motion` media query on all animations
- `.force-reduced-motion` host-context for dev toggle
- `isDevMode()` guard where appropriate
- try/catch wrapping service calls with `console.warn` in dev mode
- `aria-label` on all interactive elements
- SimCardComponent is pure — parent wires hover events

**Story 3.2 code review fixes to maintain:**
- try/catch in all command service call sites
- `requestAnimationFrame` + timeout reset for glow restart on rapid drops (via `triggerGlow()`)
- `aria-label` on draggable cards in overlay
- `@if` aliasing instead of non-null assertions (`hoveredCard()!` → `@if (hoveredCard(); as card)`)

### Existing Code — What NOT to Change

| File | Keep As-Is |
|---|---|
| `simulator.models.ts` | `CardInstance`, `ZoneId`, `ZONE_CONFIG` — all sufficient. No changes. |
| `command-stack.service.ts` | No new commands — overlay open/close is UI-only. `moveCard()` already handles cross-zone moves. No changes. |
| `commands/*` | All 7 command files unchanged. |
| `sim-card.component.*` | Already has `hovered`/`unhovered` outputs and face-up/face-down rendering. No changes. |
| `zone.component.*` | Single-card zones unaffected by overlay. No changes. |
| `hand.component.*` | Hand zone unaffected by overlay. No changes. |
| `simulator-page.component.*` | Service provider, deck loading — unchanged. |
| `glow-effect.ts` | Glow utility — unchanged. |
| `_sim-tokens.scss` | All tokens needed already exist (`$sim-surface`, `$sim-overlay-backdrop`, etc.). No changes. |

### Project Structure Notes

**New files created by this story:**
```
front/src/app/pages/simulator/
  pile-overlay.component.ts     # NEW — SimPileOverlayComponent
  pile-overlay.component.html   # NEW — Overlay template
  pile-overlay.component.scss   # NEW — Overlay styles + responsive + reduced-motion
```

**Files modified by this story:**
```
front/src/app/pages/simulator/
  board-state.service.ts          # MODIFIED — add activeOverlayZone signal, openOverlay(), closeOverlay(), activeOverlayCards, isOverlayOpen
  stacked-zone.component.ts      # MODIFIED — extend onZoneClick() for GY/Banish/ED overlay trigger
  board.component.ts             # MODIFIED — add SimPileOverlayComponent to imports
  board.component.html           # MODIFIED — wrap in container div with cdkDropListGroup, add <app-sim-pile-overlay />
  board.component.scss           # MODIFIED — add .board-container styles
  card-inspector.component.ts    # MODIFIED — add inspectorPosition computed signal + position-left host binding
  card-inspector.component.scss  # MODIFIED — add .position-left styles + compact desktop override
```

### References

- [Source: ux-design-specification.md#Overlay & Panel Patterns] — Pile overlay lifecycle, auto-close, stays open during drag, click-outside/Escape dismiss
- [Source: ux-design-specification.md#Overlay & Panel Patterns — Card Inspector Panel] — Inspector repositioning when overlay open
- [Source: ux-design-specification.md#Drag & Drop Patterns] — cdkDragPreviewContainer: 'global', isDragging suppression, cross-container drag
- [Source: ux-design-specification.md#Cross-Container Drag] — cdkDropListGroup on root, overlay as child
- [Source: ux-design-specification.md#Feedback & State Indication Patterns] — Z-index hierarchy
- [Source: ux-design-specification.md#Loading & Empty State Patterns] — Empty stacked zone click opens empty overlay
- [Source: ux-design-specification.md#Component Strategy — SimPileOverlayComponent] — Component spec (purpose, modes, states, technical notes)
- [Source: ux-design-specification.md#Accessibility Strategy] — ARIA roles, focus trap, reduced motion
- [Source: architecture.md#Service Responsibility Boundaries] — BoardStateService owns cross-cutting UI signals
- [Source: architecture.md#Anti-Patterns to Avoid] — Exception for cross-cutting UI signals (isDragging, hoveredCard, activeOverlayZone)
- [Source: architecture.md#Drag & Drop Orchestration Pattern] — cdkDropListGroup, enter predicate, sorting disabled
- [Source: architecture.md#Component Communication Patterns] — Signal-based inputs/outputs, service injection
- [Source: architecture.md#Action Flow Pattern] — Canonical action flow for state mutations
- [Source: architecture.md#Enforcement Guidelines] — Zero direct board state mutation
- [Source: epics.md#Story 4.1] — Acceptance criteria, user story
- [Source: epics.md#Epic 4 Implementation Notes] — SimPileOverlayComponent modes, cdkDragPreviewContainer, auto-close, inspector repositioning
- [Source: prd.md#FR22] — View full contents of stacked zones in overlay
- [Source: prd.md#FR23] — Select and move card from stacked zone
- [Source: prd.md#NFR6] — Overlay opens within 300ms
- [Source: 3-2-card-inspector-panel.md] — Previous story patterns, hover wiring, inspector architecture
- [Source: 3-1-card-state-toggle-via-context-menu.md] — Context menu patterns, try/catch convention

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No issues encountered during implementation.

### Completion Notes List

- Task 1: Added `activeOverlayZone`, `isOverlayOpen`, `activeOverlayCards` signals + `openOverlay()`/`closeOverlay()` methods to BoardStateService. Overlay state is UI-only (not a command).
- Task 2: Created SimPileOverlayComponent with full browse mode — card list with image+name rows, visual grouping for ED (face-down vs face-up) and Banished zones, empty state, CDK drag sources with `cdkDragPreviewContainer: 'global'`, `cdkDropList` with `noDrop` predicate, Escape key handler, click-outside via `document:mousedown` listener, ARIA `role="complementary"`, focus management via `effect()`, `prefers-reduced-motion` support.
- Task 3: Modified `onZoneClick()` in SimStackedZoneComponent — GY/Banish/ED call `openOverlay()`, Deck retains existing behavior (shake on empty, no overlay).
- Task 4: Restructured board template — `cdkDropListGroup` moved from `.sim-board` to new `.board-container` wrapper div encompassing board + overlay + inspector. Added `.board-container` CSS.
- Task 5: Added SimPileOverlayComponent to board imports and template.
- Task 6: Added `inspectorPosition` computed signal + `position-left` host class binding to SimCardInspectorComponent. SCSS styles flip inspector to left when overlay is open. Compact desktop (bottom drawer) unaffected.
- Task 7: Drag handlers already implemented in Task 2 — `onDragStarted()`/`onDragEnded()` set `isDragging` signal. Overlay stays open during drag. Target zones' existing `onDrop()` handles cross-zone moves via `previousContainer.data`.
- Task 8: Build verified — zero errors with `ng build --configuration development`.
- Note: `CommandStackService` is NOT injected — overlay is read-only (browse mode). Drag-to-board triggers `moveCard()` on target zone's `onDrop()` handler, not on overlay.

### Change Log

- 2026-02-11: Implemented Story 4.1 — Pile Overlay Browse Mode. Created SimPileOverlayComponent (3 files), added overlay state management to BoardStateService, wired click handlers on stacked zones, restructured board template for cdkDropListGroup, added inspector repositioning.
- 2026-02-11: Code Review fixes — [H1] Replaced full-viewport backdrop with `document:mousedown` listener for click-outside (fixes AC 4 single-click zone switching). [H2] Changed `role="dialog"` + `aria-modal="true"` to `role="complementary"` (non-modal side panel). [M2] Added focus management via `effect()` + `tabindex="-1"` on overlay panel. [M3] ED cards now initialized `faceDown: true` (enables AC 2 grouping). [L2] Escape handler checks `event.defaultPrevented`. [M1/L1] Corrected story Task 2.2 and Completion Notes.

### File List

**New files:**
- `front/src/app/pages/simulator/pile-overlay.component.ts`
- `front/src/app/pages/simulator/pile-overlay.component.html`
- `front/src/app/pages/simulator/pile-overlay.component.scss`

**Modified files:**
- `front/src/app/pages/simulator/board-state.service.ts`
- `front/src/app/pages/simulator/stacked-zone.component.ts`
- `front/src/app/pages/simulator/board.component.ts`
- `front/src/app/pages/simulator/board.component.html`
- `front/src/app/pages/simulator/board.component.scss`
- `front/src/app/pages/simulator/card-inspector.component.ts`
- `front/src/app/pages/simulator/card-inspector.component.scss`
