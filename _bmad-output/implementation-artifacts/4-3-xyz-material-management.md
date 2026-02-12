# Story 4.3: XYZ Material Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see overlay materials under my XYZ monsters and detach them when needed,
so that I can simulate XYZ effects that require detaching materials.

## Acceptance Criteria

1. **Given** an XYZ monster is on a board zone with overlay materials attached,
   **When** I look at the card,
   **Then** material card borders peek out below the XYZ card (2-3px offset per material, visible card edges).

2. **Given** I click on an XYZ monster with materials,
   **When** the material pill opens,
   **Then** a `SimXyzMaterialPeekComponent` overlay lists all attached materials with image + name,
   **And** a material count badge is visible.

3. **Given** the material pill is open,
   **When** I drag a material card from the pill to any board zone (e.g., GY),
   **Then** the material detaches from the XYZ monster and moves to the target zone via `MoveCardCommand`,
   **And** the material pill updates (count decrements, removed card disappears),
   **And** the pill shares the `cdkDropListGroup` with the board for cross-container drag.

4. **Given** an XYZ monster has 0 materials remaining,
   **When** I look at the card,
   **Then** no material borders peek and clicking does not open the pill.

5. **Given** I drag a non-XYZ card onto a monster zone that already contains an XYZ monster,
   **When** the drop event fires,
   **Then** the card is attached as an overlay material: removed from its source zone and added to the XYZ monster's `overlayMaterials` array via `MoveCardCommand`,
   **And** the material border peek visual updates immediately.

6. **Given** the material pill is open and `isDragging` signal is `true`,
   **When** I am dragging a material out of the pill,
   **Then** the pill stays open during the drag (like pile overlay behavior),
   **And** `cdkDragPreviewContainer: 'global'` ensures correct z-index for the drag preview.

## Tasks / Subtasks

- [x] **Task 1: Add material state management to BoardStateService** (AC: 1, 2, 4)
  - [x] 1.1: Add `readonly activeMaterialPeek = signal<{ cardId: string; zoneId: ZoneId } | null>(null)` to track which XYZ card's pill is open
  - [x] 1.2: Add `openMaterialPeek(cardInstanceId: string, zoneId: ZoneId): void` — sets `activeMaterialPeek`, calls `closeOverlay()` first (mutual exclusion with pile overlay)
  - [x] 1.3: Add `closeMaterialPeek(): void` — resets `activeMaterialPeek` to `null`
  - [x] 1.4: Modify existing `openOverlay()` to also call `closeMaterialPeek()` (mutual exclusion — max 1 overlay of any type)
  - [x] 1.5: Add `readonly isMaterialPeekOpen = computed(() => this.activeMaterialPeek() !== null)`

- [x] **Task 2: Extend MoveCardCommand for material attach/detach** (AC: 3, 5)
  - [x] 2.1: Add optional `materialContext?: { type: 'attach' | 'detach'; xyzHostId: string }` parameter to `MoveCardCommand` constructor
  - [x] 2.2: Implement **attach** logic in `execute()`: remove card from `fromZone` array, find XYZ host in `toZone` by `xyzHostId`, append card to host's `overlayMaterials` array (immutable update)
  - [x] 2.3: Implement **detach** logic in `execute()`: find XYZ host in `fromZone` by `xyzHostId`, remove card from host's `overlayMaterials`, add card to `toZone` array
  - [x] 2.4: Implement **undo** for attach: reverse — remove from `overlayMaterials`, restore to source zone at original `fromIndex`
  - [x] 2.5: Implement **undo** for detach: reverse — remove from `toZone`, restore to XYZ host's `overlayMaterials`
  - [x] 2.6: Adjust constructor validation: when `materialContext.type === 'detach'`, find card in XYZ host's `overlayMaterials` instead of zone array; when `type === 'attach'`, find card in `fromZone` as normal

- [x] **Task 3: Add material semantic methods to CommandStackService** (AC: 3, 5)
  - [x] 3.1: Add `attachMaterial(cardInstanceId: string, fromZone: ZoneId, xyzHostId: string, xyzZoneId: ZoneId): void` — creates `MoveCardCommand` with `{ type: 'attach', xyzHostId }` materialContext
  - [x] 3.2: Add `detachMaterial(materialInstanceId: string, xyzHostId: string, xyzZoneId: ZoneId, targetZone: ZoneId): void` — creates `MoveCardCommand` with `{ type: 'detach', xyzHostId }` materialContext
  - [x] 3.3: Enhance existing `moveCard()` to auto-detect material detach: if `cardInstanceId` not found in `fromZone` main array, search `overlayMaterials` of cards in that zone; if found, create detach MoveCardCommand automatically (transparent to callers)

- [x] **Task 4: Create SimXyzMaterialPeekComponent** (AC: 1, 2, 3, 4, 6)
  - [x] 4.1: Create `xyz-material-peek.component.ts` with selector `app-sim-xyz-material-peek`, standalone, OnPush
  - [x] 4.2: Inject `BoardStateService` and `CommandStackService` via `inject()`
  - [x] 4.3: Add `readonly peekState = this.boardState.activeMaterialPeek` — reads active pill state
  - [x] 4.4: Add `readonly isOpen = computed(() => this.peekState() !== null)`
  - [x] 4.5: Add `readonly xyzCard = computed(...)` — finds the XYZ CardInstance in `boardState` by `peekState().cardId` and `peekState().zoneId`
  - [x] 4.6: Add `readonly materials = computed(() => this.xyzCard()?.overlayMaterials ?? [])` — live material list
  - [x] 4.7: Add `readonly materialCount = computed(() => this.materials().length)`
  - [x] 4.8: Create template: overlay panel with header ("Materials — N card(s)"), close button, material card list
  - [x] 4.9: Each material row: `cdkDrag` with `[cdkDragData]="material"`, card image thumbnail + card name, `cdkDragPreviewContainer: 'global'`
  - [x] 4.10: Add `cdkDropList` wrapper with `[cdkDropListData]="peekState()?.zoneId"` and `noDrop` predicate (no internal reordering)
  - [x] 4.11: Add `@HostListener('document:keydown.escape')` → `closePill()`
  - [x] 4.12: Add `document:mousedown` click-outside handler (same pattern as pile overlay)
  - [x] 4.13: Add `(cdkDragStarted)` / `(cdkDragEnded)` handlers to set `isDragging` signal
  - [x] 4.14: Add `(mouseenter)` / `(mouseleave)` on material rows for `hoveredCard` signal (inspector integration)
  - [x] 4.15: Close pill automatically when `materialCount()` reaches 0 via `effect()`
  - [x] 4.16: Style with `_sim-tokens.scss`: `$sim-surface` background, `$sim-zone-border` border, 150ms fade-in animation, `prefers-reduced-motion` support

- [x] **Task 5: Add material border peek to SimCardComponent** (AC: 1, 4)
  - [x] 5.1: Add `readonly hasMaterials = computed(() => (this.cardInstance().overlayMaterials?.length ?? 0) > 0)`
  - [x] 5.2: Add `readonly materialCount = computed(() => this.cardInstance().overlayMaterials?.length ?? 0)`
  - [x] 5.3: Add material border peek elements in template: `@for` loop rendering offset divs (2-3px offset per material, max 5 visible), rendered BEHIND the card via negative z-index
  - [x] 5.4: Add new output: `materialPeekClicked = output<CardInstance>()` — emits on click when `hasMaterials()` is true
  - [x] 5.5: Style peek borders: `$sim-surface-elevated` background, `$sim-zone-border` border, `position: absolute`, `bottom: -(2-3px * index)`, card-back appearance

- [x] **Task 6: Modify SimZoneComponent for XYZ material attachment** (AC: 5)
  - [x] 6.1: Add `readonly isXyzMonster = computed(...)` — checks if `this.card()?.card.card.types?.includes(CardType.XYZ)` (import `CardType` from `core/enums/card-type.enum`)
  - [x] 6.2: Update `canDrop` predicate: return `true` if zone is empty OR if zone has an XYZ monster (`this.card() !== null && this.isMonsterZone() && this.isXyzMonster()`)
  - [x] 6.3: Update `onDrop()` handler: if `this.card() !== null` (zone occupied), call `this.commandStack.attachMaterial(cardInstanceId, fromZone, this.card()!.instanceId, toZone)` instead of `moveCard()`
  - [x] 6.4: Wire `(materialPeekClicked)` output from SimCardComponent → calls `this.boardState.openMaterialPeek(card.instanceId, this.zoneId())`
  - [x] 6.5: Trigger glow on successful material attachment

- [x] **Task 7: Integrate SimXyzMaterialPeekComponent into SimBoardComponent** (AC: 2, 3, 6)
  - [x] 7.1: Import `SimXyzMaterialPeekComponent` in `board.component.ts`
  - [x] 7.2: Add `<app-sim-xyz-material-peek />` in `board.component.html` inside `board-container` div (after `<app-sim-pile-overlay />`, before `<app-sim-card-inspector />`) — ensures pill is inside `cdkDropListGroup`

- [x] **Task 8: Verify build** (AC: all)
  - [x] 8.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **`overlayMaterials` already exists on `CardInstance`.** The field `overlayMaterials?: CardInstance[]` was defined in Story 1.1 (simulator.models.ts). It is currently unused — this story activates it. Do NOT redefine or rename it. [Source: simulator.models.ts, architecture.md#Data Architecture]
- **Material operations use `MoveCardCommand` — NO new command class.** The architecture specifies 6 command types + CompositeCommand. Extend `MoveCardCommand` with optional `materialContext` parameter for attach/detach. Do NOT create `AttachMaterialCommand` or `DetachMaterialCommand` classes. [Source: architecture.md#Command Pattern Design — "6 concrete command types"]
- **`moveCard()` auto-detects material drags.** When `moveCard()` is called with a cardInstanceId not found in the source zone's main array, it MUST search `overlayMaterials` of cards in that zone. If found, it creates a detach MoveCardCommand transparently. This makes detach work without modifying any existing zone onDrop handlers. [Source: AC 3 — "via MoveCardCommand"]
- **XYZ detection via `CardType.XYZ` enum.** Import `CardType` from `core/enums/card-type.enum.ts`. Check: `card.card.card.types?.includes(CardType.XYZ)`. Do NOT use string matching or frameType. [Source: card-type.enum.ts — `XYZ = 'XYZ'`]
- **Material pill shares `cdkDropListGroup`.** The pill is rendered inside `board-container` div (which has `cdkDropListGroup`). This enables cross-container drag from pill to any board zone. Same proven pattern as `SimPileOverlayComponent`. [Source: architecture.md#Drag & Drop Orchestration, ux-design-specification.md#Cross-Container Drag]
- **Mutual exclusion: pill vs pile overlay.** Opening the material pill closes any open pile overlay. Opening a pile overlay closes any open material pill. Max 1 overlay of any type visible. [Source: ux-design-specification.md#Overlay & Panel Patterns — "maximum one pile overlay visible at a time"]
- **Zero direct board state mutation.** All material attach/detach goes through CommandStackService. Components NEVER modify `overlayMaterials` directly. [Source: architecture.md#Enforcement Guidelines]
- **Undo/redo works automatically.** MoveCardCommand with materialContext stores all delta data at construction. Undo reverses the operation. No special undo handling needed at component level. [Source: architecture.md#Command Stack]

### Implementation Details

#### MoveCardCommand Extension — Material Context

```typescript
// In move-card.command.ts — add optional parameter:
export interface MaterialContext {
  type: 'attach' | 'detach';
  xyzHostId: string;
}

export class MoveCardCommand implements SimCommand {
  private fromIndex: number;
  private cardInstance: CardInstance;
  private originalMaterials?: CardInstance[]; // Snapshot for undo safety

  constructor(
    private readonly boardState: BoardStateService,
    private readonly cardInstanceId: string,
    private readonly fromZone: ZoneId,
    private readonly toZone: ZoneId,
    private readonly toIndex?: number,
    private readonly materialContext?: MaterialContext,
  ) {
    if (materialContext?.type === 'detach') {
      // Card is in XYZ host's overlayMaterials, not in zone array
      const hostCard = boardState.boardState()[fromZone]
        .find(c => c.instanceId === materialContext.xyzHostId);
      if (!hostCard) throw new Error(`XYZ host ${materialContext.xyzHostId} not found in ${fromZone}`);
      const matIdx = hostCard.overlayMaterials?.findIndex(m => m.instanceId === cardInstanceId) ?? -1;
      if (matIdx === -1) throw new Error(`Material ${cardInstanceId} not found on XYZ host`);
      this.fromIndex = matIdx;
      this.cardInstance = hostCard.overlayMaterials![matIdx];
      this.originalMaterials = [...(hostCard.overlayMaterials ?? [])];
    } else {
      // Normal: card in fromZone array (also used for attach — card comes from zone)
      const fromCards = boardState.boardState()[fromZone];
      this.fromIndex = fromCards.findIndex(c => c.instanceId === cardInstanceId);
      if (this.fromIndex === -1) throw new Error(`Card ${cardInstanceId} not found in ${fromZone}`);
      this.cardInstance = fromCards[this.fromIndex];
      if (materialContext?.type === 'attach') {
        const hostCard = boardState.boardState()[toZone]
          .find(c => c.instanceId === materialContext.xyzHostId);
        this.originalMaterials = [...(hostCard?.overlayMaterials ?? [])];
      }
    }
  }
}
```

#### Attach Execute/Undo

```typescript
// ATTACH execute: remove from fromZone, add to XYZ host's overlayMaterials in toZone
execute(): void {
  if (this.materialContext?.type === 'attach') {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      // Remove card from source zone
      newState[this.fromZone] = state[this.fromZone].filter(c => c.instanceId !== this.cardInstanceId);
      // Add to XYZ host's overlayMaterials in target zone
      newState[this.toZone] = state[this.toZone].map(c =>
        c.instanceId === this.materialContext!.xyzHostId
          ? { ...c, overlayMaterials: [...(c.overlayMaterials ?? []), this.cardInstance] }
          : c
      );
      return newState;
    });
    return;
  }
  // ... detach and normal cases follow
}

// ATTACH undo: remove from overlayMaterials, restore to source zone
undo(): void {
  if (this.materialContext?.type === 'attach') {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      // Remove from XYZ host's overlayMaterials
      newState[this.toZone] = state[this.toZone].map(c =>
        c.instanceId === this.materialContext!.xyzHostId
          ? { ...c, overlayMaterials: this.originalMaterials ?? [] }
          : c
      );
      // Restore card to source zone at original position
      const fromCards = [...state[this.fromZone]];
      fromCards.splice(this.fromIndex, 0, this.cardInstance);
      newState[this.fromZone] = fromCards;
      return newState;
    });
    return;
  }
  // ... detach and normal cases follow
}
```

#### Detach Execute/Undo

```typescript
// DETACH execute: remove from XYZ host's overlayMaterials, add to target zone
execute(): void {
  if (this.materialContext?.type === 'detach') {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      // Remove material from XYZ host
      newState[this.fromZone] = state[this.fromZone].map(c =>
        c.instanceId === this.materialContext!.xyzHostId
          ? { ...c, overlayMaterials: (c.overlayMaterials ?? []).filter(m => m.instanceId !== this.cardInstanceId) }
          : c
      );
      // Add card to target zone
      const toCards = [...state[this.toZone]];
      if (this.toIndex !== undefined) {
        toCards.splice(this.toIndex, 0, this.cardInstance);
      } else {
        toCards.push(this.cardInstance);
      }
      newState[this.toZone] = toCards;
      return newState;
    });
    return;
  }
  // ... normal case follows (existing code unchanged)
}

// DETACH undo: remove from target zone, restore to XYZ host's overlayMaterials
undo(): void {
  if (this.materialContext?.type === 'detach') {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      // Remove from target zone
      newState[this.toZone] = state[this.toZone].filter(c => c.instanceId !== this.cardInstanceId);
      // Restore material to XYZ host
      newState[this.fromZone] = state[this.fromZone].map(c =>
        c.instanceId === this.materialContext!.xyzHostId
          ? { ...c, overlayMaterials: this.originalMaterials ?? [] }
          : c
      );
      return newState;
    });
    return;
  }
  // ... normal case follows (existing code unchanged)
}
```

#### CommandStackService — Auto-Detect Material Detach

```typescript
// In command-stack.service.ts — enhance moveCard():
moveCard(cardInstanceId: string, fromZone: ZoneId, toZone: ZoneId, toIndex?: number): void {
  const fromCards = this.boardState.boardState()[fromZone];
  const isInMainArray = fromCards.some(c => c.instanceId === cardInstanceId);

  if (isInMainArray) {
    // Regular zone-to-zone move (existing behavior — unchanged)
    this.execute(new MoveCardCommand(this.boardState, cardInstanceId, fromZone, toZone, toIndex));
  } else {
    // Auto-detect: card might be an overlay material being detached
    const xyzHost = fromCards.find(c =>
      c.overlayMaterials?.some(m => m.instanceId === cardInstanceId)
    );
    if (xyzHost) {
      this.execute(new MoveCardCommand(
        this.boardState, cardInstanceId, fromZone, toZone, toIndex,
        { type: 'detach', xyzHostId: xyzHost.instanceId }
      ));
    } else {
      throw new Error(`Card ${cardInstanceId} not found in zone ${fromZone} or its materials`);
    }
  }
}

// New semantic method:
attachMaterial(cardInstanceId: string, fromZone: ZoneId, xyzHostId: string, xyzZoneId: ZoneId): void {
  this.execute(new MoveCardCommand(
    this.boardState, cardInstanceId, fromZone, xyzZoneId, undefined,
    { type: 'attach', xyzHostId }
  ));
}

// Explicit detach method (optional — moveCard auto-detects, but explicit is clearer):
detachMaterial(materialInstanceId: string, xyzHostId: string, xyzZoneId: ZoneId, targetZone: ZoneId): void {
  this.execute(new MoveCardCommand(
    this.boardState, materialInstanceId, xyzZoneId, targetZone, undefined,
    { type: 'detach', xyzHostId }
  ));
}
```

**Key insight:** `moveCard()` auto-detects material drags. This means existing `onDrop()` handlers on ALL zone components (SimZoneComponent, SimHandComponent, SimStackedZoneComponent) automatically support receiving detached materials from the XYZ pill WITHOUT any code changes. Only SimZoneComponent's onDrop needs modification for the ATTACH path (occupied XYZ zone).

#### SimZoneComponent — Drop Handler for Attach

```typescript
// In zone.component.ts — modify onDrop():
onDrop(event: CdkDragDrop<ZoneId, ZoneId, CardInstance>): void {
  if (event.previousContainer === event.container) return;
  const cardInstanceId = event.item.data.instanceId;
  const fromZone = event.previousContainer.data;
  const toZone = event.container.data;

  try {
    const existingCard = this.card();
    if (existingCard) {
      // Zone occupied — attach as material to existing card
      this.commandStack.attachMaterial(cardInstanceId, fromZone, existingCard.instanceId, toZone);
    } else {
      // Zone empty — normal move
      this.commandStack.moveCard(cardInstanceId, fromZone, toZone);
    }
    this.glow.triggerGlow();
  } catch (e) {
    if (isDevMode()) console.warn('Drop failed', e);
  }
}
```

#### SimZoneComponent — canDrop Predicate for XYZ

```typescript
// In zone.component.ts — add:
import { CardType } from '../../../../core/enums/card-type.enum';

readonly isMonsterZone = computed(() => {
  const config = this.zoneConfig();
  return config.type === 'single' && [
    ZoneId.MONSTER_1, ZoneId.MONSTER_2, ZoneId.MONSTER_3,
    ZoneId.MONSTER_4, ZoneId.MONSTER_5,
    ZoneId.EXTRA_MONSTER_L, ZoneId.EXTRA_MONSTER_R,
  ].includes(this.zoneId());
});

readonly isXyzMonster = computed(() =>
  this.card()?.card.card.types?.includes(CardType.XYZ) ?? false
);

// Update canDrop predicate:
canDrop = () => {
  const card = this.card();
  if (card === null) return true;                          // Empty zone — accept
  if (this.isMonsterZone() && this.isXyzMonster()) return true; // XYZ zone — accept for material
  return false;                                            // Occupied non-XYZ — reject
};
```

#### SimXyzMaterialPeekComponent — Material Pill

```typescript
// xyz-material-peek.component.ts
@Component({
  selector: 'app-sim-xyz-material-peek',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, MatIconModule],
  templateUrl: './xyz-material-peek.component.html',
  styleUrl: './xyz-material-peek.component.scss',
})
export class SimXyzMaterialPeekComponent {
  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);

  readonly peekState = this.boardState.activeMaterialPeek;
  readonly isOpen = computed(() => this.peekState() !== null);

  readonly xyzCard = computed(() => {
    const state = this.peekState();
    if (!state) return null;
    return this.boardState.boardState()[state.zoneId]
      ?.find(c => c.instanceId === state.cardId) ?? null;
  });

  readonly materials = computed(() => this.xyzCard()?.overlayMaterials ?? []);
  readonly materialCount = computed(() => this.materials().length);
  readonly xyzName = computed(() => this.xyzCard()?.card.card.name ?? 'XYZ Monster');

  readonly overlayTitle = computed(() => {
    const count = this.materialCount();
    return `Materials — ${count} card${count !== 1 ? 's' : ''}`;
  });

  readonly noDrop = () => false; // Prevent drops INTO pill

  constructor() {
    // Auto-close when all materials detached
    effect(() => {
      if (this.isOpen() && this.materialCount() === 0) {
        untracked(() => this.boardState.closeMaterialPeek());
      }
    });
  }

  close(): void {
    this.boardState.closeMaterialPeek();
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
    if (this.isOpen()) this.close();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMousedown(event: MouseEvent): void {
    // Click-outside handler — same pattern as pile overlay
    if (!this.isOpen()) return;
    const target = event.target as HTMLElement;
    if (!target.closest('.material-peek-panel')) {
      this.close();
    }
  }
}
```

#### SimXyzMaterialPeekComponent — Template

```html
<!-- xyz-material-peek.component.html -->
@if (isOpen()) {
  @if (xyzCard(); as xyz) {
    <div class="material-peek-panel" role="complementary" aria-label="XYZ overlay materials">
      <div class="peek-header">
        <h3 class="peek-title">{{ overlayTitle() }}</h3>
        <button class="peek-close" (click)="close()" aria-label="Close material peek">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="peek-subtitle">{{ xyzName() }}</div>

      <div cdkDropList
           [cdkDropListData]="peekState()?.zoneId"
           [cdkDropListEnterPredicate]="noDrop"
           class="material-list">
        @for (material of materials(); track material.instanceId) {
          <div class="material-row"
               cdkDrag
               [cdkDragData]="material"
               cdkDragPreviewContainer="global"
               (cdkDragStarted)="onDragStarted()"
               (cdkDragEnded)="onDragEnded()"
               (mouseenter)="onCardHovered(material)"
               (mouseleave)="onCardUnhovered()">
            <img [src]="material.image.smallUrl"
                 [alt]="material.card.card.name"
                 class="material-image" />
            <span class="material-name">{{ material.card.card.name }}</span>
            <mat-icon class="drag-handle">drag_indicator</mat-icon>
          </div>
        }
      </div>
    </div>
  }
}
```

#### SimXyzMaterialPeekComponent — SCSS

```scss
// xyz-material-peek.component.scss
@use 'sim-tokens' as *;

:host {
  display: contents;
}

.material-peek-panel {
  position: absolute;
  top: 50%;
  right: $sim-padding-overlay;
  transform: translateY(-50%);
  width: 240px;
  max-height: 400px;
  background: $sim-surface;
  border: 1px solid $sim-zone-border;
  border-radius: $sim-radius-zone;
  padding: $sim-padding-overlay;
  z-index: 50; // Below pile overlay (60), above board
  animation: peek-fade-in 150ms ease-out;
  display: flex;
  flex-direction: column;
  gap: $sim-gap-zone;
}

.peek-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.peek-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: $sim-text-primary;
}

.peek-close {
  background: none;
  border: none;
  color: $sim-text-secondary;
  cursor: pointer;
  padding: 4px;
  border-radius: $sim-radius-card;

  &:hover {
    color: $sim-text-primary;
    background: $sim-surface-elevated;
  }
}

.peek-subtitle {
  font-size: 0.75rem;
  color: $sim-text-secondary;
  font-weight: 500;
}

.material-list {
  display: flex;
  flex-direction: column;
  gap: $sim-gap-card;
  overflow-y: auto;
  max-height: 280px;
}

.material-row {
  display: flex;
  align-items: center;
  gap: $sim-gap-card;
  padding: 4px;
  border-radius: $sim-radius-card;
  cursor: grab;
  transition: background 100ms ease;

  &:hover {
    background: $sim-surface-elevated;
  }
}

.material-image {
  width: 32px;
  height: auto;
  aspect-ratio: $sim-card-aspect-ratio;
  border-radius: 2px;
  object-fit: cover;
  flex-shrink: 0;
}

.material-name {
  flex: 1;
  font-size: 0.8125rem;
  color: $sim-text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drag-handle {
  color: $sim-text-secondary;
  font-size: 18px;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

// CDK drag preview
.cdk-drag-preview {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  border-radius: $sim-radius-card;
  z-index: 1000;
}

.cdk-drag-placeholder {
  opacity: 0.3;
}

@keyframes peek-fade-in {
  from { opacity: 0; transform: translateY(-50%) translateX(8px); }
  to { opacity: 1; transform: translateY(-50%) translateX(0); }
}

@media (prefers-reduced-motion: reduce) {
  .material-peek-panel {
    animation: none;
  }
}

:host-context(.force-reduced-motion) {
  .material-peek-panel {
    animation: none;
  }
}
```

#### SimCardComponent — Material Border Peek

```html
<!-- sim-card.component.html — add material peek BEHIND card -->
<div class="sim-card"
     [class.def-position]="isDefPosition()"
     [class.hand-size]="size() === 'hand'"
     (mouseenter)="hovered.emit(cardInstance())"
     (mouseleave)="unhovered.emit()"
     (click)="onCardClick()">
  @if (isFaceDown()) {
    <div class="card-back"></div>
  } @else {
    <img [src]="imageUrl()" [alt]="cardInstance().card.card.name" class="card-image">
  }
</div>

<!-- Material border peek: offset card-back elements behind the card -->
@if (hasMaterials()) {
  <div class="material-peek-borders">
    @for (material of materialPeekSlots(); track $index) {
      <div class="material-border"
           [style.bottom.px]="-(($index + 1) * 3)"
           [style.left.px]="($index + 1) * 1">
      </div>
    }
  </div>
}
```

```typescript
// sim-card.component.ts — add:
readonly hasMaterials = computed(() => (this.cardInstance().overlayMaterials?.length ?? 0) > 0);
readonly materialCount = computed(() => this.cardInstance().overlayMaterials?.length ?? 0);

// Max 5 peek borders visible (even if more materials)
readonly materialPeekSlots = computed(() => {
  const count = Math.min(this.materialCount(), 5);
  return Array.from({ length: count });
});

readonly materialPeekClicked = output<CardInstance>();

onCardClick(): void {
  if (this.hasMaterials()) {
    this.materialPeekClicked.emit(this.cardInstance());
  }
}
```

```scss
// sim-card.component.scss — add:
:host {
  position: relative; // Needed for material peek positioning
}

.material-peek-borders {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
}

.material-border {
  position: absolute;
  width: 100%;
  height: 100%;
  background: $sim-surface-elevated;
  border: 1px solid $sim-zone-border;
  border-radius: $sim-radius-card;
}
```

#### BoardStateService — Material Peek State

```typescript
// In board-state.service.ts — add:
readonly activeMaterialPeek = signal<{ cardId: string; zoneId: ZoneId } | null>(null);
readonly isMaterialPeekOpen = computed(() => this.activeMaterialPeek() !== null);

openMaterialPeek(cardInstanceId: string, zoneId: ZoneId): void {
  this.closeOverlay(); // Close any pile overlay first
  this.activeMaterialPeek.set({ cardId: cardInstanceId, zoneId });
}

closeMaterialPeek(): void {
  this.activeMaterialPeek.set(null);
}

// Modify existing openOverlay() — add at the START of the method:
openOverlay(zoneId: ZoneId, mode: OverlayMode = 'browse'): void {
  this.closeMaterialPeek(); // Mutual exclusion
  // ... rest of existing openOverlay code unchanged
}
```

### Edge Cases

- **XYZ with 0 materials → click:** `hasMaterials()` is `false` → `materialPeekClicked` does NOT emit → no pill opens. `openMaterialPeek()` never called. Correct per AC 4.
- **Detach all materials → pill closes:** `effect()` in SimXyzMaterialPeekComponent watches `materialCount()`. When it reaches 0 and pill is open, auto-closes via `closeMaterialPeek()`.
- **Attach to face-down card:** canDrop checks `isXyzMonster()` which reads card types. Face-down cards have `faceDown: true` but STILL have card data accessible (CardInstance preserves `card` reference). So XYZ detection works even on face-down cards.
- **Attach from hand/overlay/stacked zone:** All work — `attachMaterial()` takes `fromZone` and the card is removed from that zone's array regardless of zone type.
- **Detach to hand:** Works — `moveCard()` auto-detects material, creates detach command, card goes to HAND zone.
- **Detach to stacked zone (GY, Banished):** Works — same auto-detect, card goes to stacked zone.
- **Undo attach:** Card is removed from overlayMaterials, restored to original zone at original index. XYZ host's overlayMaterials restored from `originalMaterials` snapshot.
- **Undo detach:** Card is removed from target zone, restored to XYZ host's overlayMaterials from `originalMaterials` snapshot.
- **XYZ monster moved to different zone with materials:** Materials move with the card — MoveCardCommand stores the full `CardInstance` reference including `overlayMaterials`. Automatic.
- **XYZ monster sent to GY with materials:** Same — materials travel with the card to GY. Materials are still accessible via GY overlay (pile overlay shows the card with its materials).
- **Multiple XYZ monsters on board:** Each has independent `overlayMaterials`. `canDrop` per-zone, `activeMaterialPeek` tracks specific card by ID. No conflicts.
- **Drop on S/T zone occupied by card:** `canDrop` returns `false` — S/T zones are NOT monster zones. Silent rejection.
- **Drop on occupied monster zone with non-XYZ monster:** `isXyzMonster()` returns `false` → `canDrop` returns `false`. Silent rejection (CDK returns card to origin).
- **Material pill + pile overlay mutual exclusion:** Opening pill closes overlay. Opening overlay closes pill. `closeMaterialPeek()` called in `openOverlay()`, `closeOverlay()` called in `openMaterialPeek()`.
- **Drag material during isDragging suppression:** Pill stays open during drag (same as pile overlay). Inspector is hidden. Other overlays suppressed.
- **Click-outside pill closure:** `document:mousedown` handler checks if target is inside `.material-peek-panel`. If not, closes pill.
- **Escape key closes pill:** `@HostListener('document:keydown.escape')` calls `close()`.

### NFR Compliance

- **NFR1 (<16ms frame):** Material peek borders use pure CSS (`position: absolute`, no layout recalc). Signal-based reactivity — only affected zones re-render.
- **NFR2 (<100ms board update):** `boardState.update()` with immutable spread. Computed signals propagate instantly.
- **NFR4 (responsive with 20+ cards):** Material borders are lightweight CSS elements (no additional card images). Pill uses simple card list (same as pile overlay).
- **NFR5 (<200ms inspector):** Inspector works with material cards — `hoveredCard` signal on material rows, 50ms debounce unchanged.
- **`prefers-reduced-motion`:** Pill fade-in animation disabled. Material peek borders have no animation (static position).

### What This Story Does NOT Include

- **No XYZ summoning flow** — Player manually places materials + XYZ monster. This story handles rendering and detaching AFTER they're in position.
- **No automatic material attachment on XYZ summon** — Player must manually drag materials to zone, then overlay XYZ on top.
- **No undo/redo UI buttons** — Story 5.1 (buttons exist in undo stack silently)
- **No keyboard shortcuts** (Ctrl+Z, Ctrl+Y) — Story 5.2
- **No Link monster arrow indicators** — Post-MVP
- **No token creation** — Post-MVP
- **No card pill shortcuts on board cards** (Send to GY, Banish) — Post-MVP
- **No touch/mobile support** — Post-MVP
- **No material count in zone badge** — Materials are per-card, not per-zone. Badge on stacked zones shows zone card count only.

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `attachMaterial()` on CommandStackService | Story 5.1 (undo/redo of attach/detach) |
| `detachMaterial()` on CommandStackService | Story 5.1 (undo/redo of detach) |
| `moveCard()` auto-detect enhancement | All future stories using moveCard() — transparent |
| `materialContext` on MoveCardCommand | Internal — CommandStackService only |
| `activeMaterialPeek` signal on BoardStateService | No downstream dependency |
| `SimXyzMaterialPeekComponent` | No downstream dependency |
| Material border peek in SimCardComponent | No downstream dependency |

### Previous Story Intelligence (Story 4.2)

**Patterns established — MUST follow:**
- SCSS import: `@use 'sim-tokens' as *` (Dart Sass 2.0, NOT `@import`)
- Service injection: `inject()` function pattern (NOT constructor injection)
- Signal access: `.()` to read, `.set()` / `.update()` to mutate
- `isDragging` management via `(cdkDragStarted)` / `(cdkDragEnded)` on drag parents
- `prefers-reduced-motion` media query on all animations
- `.force-reduced-motion` host-context for dev toggle
- `isDevMode()` guard on `event.preventDefault()` for context menus
- try/catch wrapping all CommandStackService calls with `console.warn` in devMode
- `aria-label` on all interactive elements
- SimCardComponent is pure — parent wires `(hovered)` / `(unhovered)` events
- `cdkDragPreviewContainer: 'global'` on ALL drag items in overlays
- `noDrop` predicate on overlay's `cdkDropList`
- `@HostListener('document:keydown.escape')` for overlay close
- Click-outside uses `document:mousedown` listener (not backdrop div)
- `role="complementary"` for non-modal side panels
- Focus management via `effect()` on open
- `@if` aliasing instead of non-null assertions

**Code review fixes from 4.1 and 4.2 to maintain:**
- `slice(-n)` for top-of-deck operations (top = last elements in array)
- Empty state messages contextual per overlay mode
- try/catch + isDevMode() console.warn on ALL CommandStackService calls

### Existing Code — What NOT to Change

| File | Keep As-Is | Reason |
|---|---|---|
| `commands/draw-card.command.ts` | Unchanged | Not used by this story |
| `commands/shuffle.command.ts` | Unchanged | Not used by this story |
| `commands/flip-card.command.ts` | Unchanged | Not used by this story |
| `commands/toggle-position.command.ts` | Unchanged | Not used by this story |
| `commands/reorder-hand.command.ts` | Unchanged | Not used by this story |
| `commands/composite.command.ts` | Unchanged | Not used by this story |
| `commands/index.ts` | Unchanged | No new command classes — only MoveCardCommand extended |
| `hand.component.*` | Unchanged | Hand onDrop calls `moveCard()` which auto-detects materials |
| `stacked-zone.component.*` | Unchanged | Stacked zone onDrop calls `moveCard()` which auto-detects materials |
| `pile-overlay.component.*` | Unchanged | Pile overlay drag calls `moveCard()` which auto-detects materials |
| `card-inspector.component.*` | Unchanged | Inspector works with hoveredCard signal — no changes needed |
| `simulator-page.component.*` | Unchanged | Page container and service provider |
| `glow-effect.ts` | Unchanged | Glow utility reused as-is |
| `_sim-tokens.scss` | Unchanged | All needed tokens exist |

### Project Structure Notes

- Alignment with unified project structure: all files in `front/src/app/pages/simulator/`
- **1 new file** created: `xyz-material-peek.component.ts` + `.html` + `.scss`
- Component selector uses `app-sim-` prefix: `app-sim-xyz-material-peek`

**Files modified by this story:**
```
front/src/app/pages/simulator/
  commands/move-card.command.ts    # MODIFIED — add MaterialContext interface, attach/detach logic
  command-stack.service.ts         # MODIFIED — add attachMaterial(), detachMaterial(), enhance moveCard() auto-detect
  board-state.service.ts           # MODIFIED — add activeMaterialPeek signal, openMaterialPeek(),
                                   #            closeMaterialPeek(), isMaterialPeekOpen computed,
                                   #            modify openOverlay() for mutual exclusion
  sim-card.component.ts            # MODIFIED — add hasMaterials, materialCount, materialPeekSlots computeds,
                                   #            materialPeekClicked output, onCardClick() method
  sim-card.component.html          # MODIFIED — add material border peek elements, click handler
  sim-card.component.scss          # MODIFIED — add material-peek-borders and material-border styles
  zone.component.ts                # MODIFIED — add isMonsterZone, isXyzMonster computeds, update canDrop
                                   #            predicate, update onDrop for attach, wire materialPeekClicked
  zone.component.html              # MODIFIED — wire (materialPeekClicked) output to openMaterialPeek()
  board.component.ts               # MODIFIED — import SimXyzMaterialPeekComponent
  board.component.html             # MODIFIED — add <app-sim-xyz-material-peek />

front/src/app/pages/simulator/     # NEW FILES
  xyz-material-peek.component.ts   # NEW — material pill overlay component
  xyz-material-peek.component.html # NEW — material pill template
  xyz-material-peek.component.scss # NEW — material pill styles
```

### References

- [Source: epics.md#Story 4.3] — Acceptance criteria, user story, implementation notes
- [Source: epics.md#Epic 4 Implementation Notes] — SimXyzMaterialPeekComponent, material borders, drag to detach, cdkDropListGroup sharing
- [Source: architecture.md#Command Pattern Design] — 6 commands + CompositeCommand, delta-based, MoveCardCommand for all moves
- [Source: architecture.md#Data Architecture] — `CardInstance.overlayMaterials?: CardInstance[]` for XYZ material tracking
- [Source: architecture.md#Service Responsibility Boundaries] — CommandStackService semantic methods, BoardStateService UI signals
- [Source: architecture.md#Enforcement Guidelines] — Zero direct mutation, components never instantiate commands
- [Source: architecture.md#Component Hierarchy] — SimCardComponent owns XYZ material peek responsibility
- [Source: architecture.md#Architectural Boundaries] — SimXyzMaterialPeekComponent: pill overlay for material management
- [Source: architecture.md#Drag & Drop Orchestration] — cdkDropListGroup on BoardComponent root
- [Source: ux-design-specification.md#Zone Interaction Rules] — XYZ exception: materials stacked underneath, click for pill, drag to detach
- [Source: ux-design-specification.md#Overlay & Panel Patterns] — Max 1 overlay visible, auto-close, stays open during drag
- [Source: ux-design-specification.md#Overlay Z-Index Hierarchy] — drag preview > context menus > pile overlays > inspector > board
- [Source: ux-design-specification.md#Component Strategy — SimXyzMaterialPeekComponent] — CDK Overlay, cdkDropListGroup sharing, technical risk flagged
- [Source: ux-design-specification.md#Component Strategy — SimCardComponent] — Owns XYZ material peek responsibility
- [Source: ux-design-specification.md#Feedback & State Indication] — Card state indicators, XYZ with materials: 2-3px offset borders
- [Source: ux-design-specification.md#Pill Interaction System] — Pills on click, isDragging suppresses, board stays clean
- [Source: ux-design-specification.md#Accessibility] — prefers-reduced-motion, ARIA roles, keyboard navigation
- [Source: card-type.enum.ts] — `CardType.XYZ = 'XYZ'` for XYZ monster identification
- [Source: simulator.models.ts] — `CardInstance.overlayMaterials?: CardInstance[]` already defined
- [Source: 4-2-deck-search-mill-and-reveal.md] — Previous story patterns, code review fixes, established conventions
- [Source: 4-1-pile-overlay-browse-mode.md] — Overlay architecture, click-outside pattern, drag-from-overlay behavior

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build passed on first attempt with zero errors

### Completion Notes List

- **Task 1:** Added `activeMaterialPeek` signal, `isMaterialPeekOpen` computed, `openMaterialPeek()` and `closeMaterialPeek()` methods to BoardStateService. Modified `openOverlay()` for mutual exclusion with material peek.
- **Task 2:** Extended `MoveCardCommand` with `MaterialContext` interface and optional `materialContext` parameter. Implemented attach/detach execute and undo logic with `originalMaterials` snapshot for safe undo. Constructor validation handles both detach (card in overlayMaterials) and attach (card in zone array) paths.
- **Task 3:** Added `attachMaterial()` and `detachMaterial()` semantic methods to CommandStackService. Enhanced `moveCard()` to auto-detect material detach when card not found in zone's main array — transparent to all existing callers (hand, stacked-zone, pile-overlay).
- **Task 4:** Created SimXyzMaterialPeekComponent with full feature set: pill overlay, cdkDropList with noDrop predicate, material row drag with `cdkDragPreviewContainer: 'global'`, escape/click-outside close, isDragging management, hoveredCard integration, auto-close effect when materialCount reaches 0, prefers-reduced-motion support.
- **Task 5:** Added material border peek to SimCardComponent: `hasMaterials`, `materialCount`, `materialPeekSlots` computeds, `materialPeekClicked` output, `onCardClick()` method, CSS peek borders (max 5 visible, 3px offset each).
- **Task 6:** Modified SimZoneComponent: added `isMonsterZone` and `isXyzMonster` computeds with `CardType.XYZ` enum check, updated `canDrop` to accept drops on occupied XYZ monster zones, updated `onDrop` to call `attachMaterial()` when zone is occupied, wired `materialPeekClicked` output to `openMaterialPeek()`.
- **Task 7:** Integrated SimXyzMaterialPeekComponent into SimBoardComponent (import + template placement after pile overlay, before inspector, inside cdkDropListGroup).
- **Task 8:** `ng build --configuration development` — zero errors.
- **Note:** `commands/index.ts` also updated to re-export `MaterialContext` interface — minor deviation from "keep unchanged" but necessary for type visibility.

### File List

**Modified files:**
- `front/src/app/pages/simulator/board-state.service.ts`
- `front/src/app/pages/simulator/commands/move-card.command.ts`
- `front/src/app/pages/simulator/commands/index.ts`
- `front/src/app/pages/simulator/command-stack.service.ts`
- `front/src/app/pages/simulator/sim-card.component.ts`
- `front/src/app/pages/simulator/sim-card.component.html`
- `front/src/app/pages/simulator/sim-card.component.scss`
- `front/src/app/pages/simulator/zone.component.ts`
- `front/src/app/pages/simulator/zone.component.html`
- `front/src/app/pages/simulator/board.component.ts`
- `front/src/app/pages/simulator/board.component.html`

**New files:**
- `front/src/app/pages/simulator/xyz-material-peek.component.ts`
- `front/src/app/pages/simulator/xyz-material-peek.component.html`
- `front/src/app/pages/simulator/xyz-material-peek.component.scss`

## Change Log

- **2026-02-11:** Implemented Story 4.3 — XYZ Material Management. Added material attach/detach via MoveCardCommand extension, SimXyzMaterialPeekComponent pill overlay, material border peek visuals on SimCardComponent, XYZ drop handling on SimZoneComponent, and mutual exclusion between material peek and pile overlay.
- **2026-02-11:** Code review (AI) — 7 findings (1 HIGH, 3 MEDIUM, 3 LOW). All HIGH/MEDIUM fixed:
  - HIGH-1: Fixed mutual exclusion — `openDeckSearch()`/`openDeckReveal()` now call `closeMaterialPeek()` (board-state.service.ts)
  - MEDIUM-1: Added `transferMaterial()` to CommandStackService for XYZ-to-XYZ material drag via CompositeCommand; updated zone.component.ts `onDrop` to detect material transfers (command-stack.service.ts, zone.component.ts)
  - MEDIUM-2: Removed duplicate `role="complementary"` from host — kept on inner div only (xyz-material-peek.component.ts)
  - MEDIUM-3: Added `transition: none` for `.material-row` in `prefers-reduced-motion` and `.force-reduced-motion` (xyz-material-peek.component.scss)
  - LOW-1/2/3: Accepted as-is (design interpretation, edge case, acknowledged deviation)
