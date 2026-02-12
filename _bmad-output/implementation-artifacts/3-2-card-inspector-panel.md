# Story 3.2: Card Inspector Panel

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see full card details (image, stats, effect text) when I hover over a card,
so that I can read card effects without interrupting my combo flow.

## Acceptance Criteria

1. **Given** I hover over any face-up card (board, hand, or overlay),
   **When** the `hoveredCard` signal updates (after 50ms debounce),
   **Then** the `SimCardInspectorComponent` appears as a fixed panel on the right side of the viewport,
   **And** it displays: full-size card image, card name, attribute/race/level, ATK/DEF values, full effect text (scrollable),
   **And** the panel uses `$sim-surface` background with `$sim-text-primary` for card name and effect text,
   **And** the panel appears/disappears with a fast fade transition (~100ms).

2. **Given** I hover over a face-down card,
   **When** the `hoveredCard` signal updates,
   **Then** the inspector shows the card back image only — no name, no stats, no effect text.

3. **Given** `isDragging` signal is `true`,
   **When** I am dragging a card,
   **Then** the inspector panel is hidden regardless of hover state,
   **And** it reappears when the drag ends.

4. **Given** I move my mouse off all cards,
   **When** `hoveredCard` signal becomes null (after debounce),
   **Then** the inspector panel fades out.

5. **Given** the inspector panel has no deck-building buttons,
   **When** it renders,
   **Then** there are no +1/-1 or add/remove buttons — simulator context only.

6. **Given** the viewport width is ≤1279px (compact desktop),
   **When** the inspector renders,
   **Then** it appears as a collapsible bottom drawer: 40px bar showing hovered card name by default, expanding to ~200px on click (horizontal layout: card image left, effect text right).

## Tasks / Subtasks

- [x] **Task 1: Add hover event outputs to SimCardComponent** (AC: 1, 2)
  - [x] 1.1: Add `hovered = output<CardInstance>()` and `unhovered = output<void>()` to `sim-card.component.ts`
  - [x] 1.2: Add `(mouseenter)="hovered.emit(cardInstance())"` and `(mouseleave)="unhovered.emit()"` to root div in `sim-card.component.html`

- [x] **Task 2: Wire hover events in parent components** (AC: 1, 2)
  - [x] 2.1: In `zone.component.ts`, add `onCardHovered(card: CardInstance)` and `onCardUnhovered()` methods that call `boardState.setHoveredCard()`
  - [x] 2.2: In `zone.component.html`, bind `(hovered)="onCardHovered($event)"` and `(unhovered)="onCardUnhovered()"` on `<app-sim-card>`
  - [x] 2.3: In `hand.component.ts`, add same `onCardHovered` / `onCardUnhovered` methods
  - [x] 2.4: In `hand.component.html`, bind hover outputs on each `<app-sim-card>` in the `@for` loop

- [x] **Task 3: Add 50ms debounce to hoveredCard in BoardStateService** (AC: 1, 4)
  - [x] 3.1: Add `setHoveredCard(card: CardInstance | null): void` method with internal 50ms `setTimeout` debounce
  - [x] 3.2: The public `hoveredCard` signal updates only after debounce timer fires
  - [x] 3.3: Add `private _hoverTimeout: ReturnType<typeof setTimeout> | null = null` field
  - [x] 3.4: Clean up timeout on destroy (inject `DestroyRef`, register cleanup)

- [x] **Task 4: Create SimCardInspectorComponent** (AC: 1, 2, 3, 4, 5)
  - [x] 4.1: Create `card-inspector.component.ts` — standalone, OnPush, selector `app-sim-card-inspector`
  - [x] 4.2: Inject `BoardStateService`, read `hoveredCard` and `isDragging` signals
  - [x] 4.3: Create `isVisible = computed(() => this.hoveredCard() !== null && !this.isDragging())`
  - [x] 4.4: Create `isFaceDown = computed(() => this.hoveredCard()?.faceDown ?? false)`
  - [x] 4.5: Create `card-inspector.component.html` — face-up: card image + name + stats + scrollable effect text; face-down: card back only
  - [x] 4.6: Create `card-inspector.component.scss` — `position: fixed`, right panel, `$sim-surface` bg, fade transition, `prefers-reduced-motion` support
  - [x] 4.7: ARIA: `role="complementary"`, `aria-label="Card inspector"`, `aria-live="polite"`

- [x] **Task 5: Responsive — collapsible bottom drawer** (AC: 6)
  - [x] 5.1: `@media (max-width: 1279px)` — inspector switches from right panel to bottom drawer
  - [x] 5.2: Collapsed state: `height: 40px`, showing hovered card name only (reactive)
  - [x] 5.3: Expanded state: `height: ~200px`, horizontal layout (card image left, effect text right)
  - [x] 5.4: Toggle via click on the bar (add `isExpanded = signal(false)` local state)

- [x] **Task 6: Integrate into board template** (AC: all)
  - [x] 6.1: Add `SimCardInspectorComponent` to `board.component.ts` imports array
  - [x] 6.2: Add `<app-sim-card-inspector />` to `board.component.html` — outside the CSS Grid div, sibling element

- [x] **Task 7: Verify build** (AC: all)
  - [x] 7.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **hoveredCard signal with 50ms debounce in BoardStateService.** The debounce prevents flicker during fast mouse traversal across multiple cards, and naturally suppresses hover events during drag (drag starts before debounce fires). [Source: ux-design-specification.md#Drag & Drop Patterns]
- **isDragging suppresses inspector.** When `isDragging` is `true`, the inspector panel MUST be hidden regardless of hover state. [Source: ux-design-specification.md#Card Inspector Panel]
- **Face-down cards: card back only.** No name, no stats, no effect text revealed. This preserves face-down semantics. [Source: epics.md#Story 3.2 AC 2, prd.md#FR28]
- **No deck-building buttons.** Simulator context only — no +1/-1 or add/remove buttons. [Source: epics.md#Story 3.2 AC 5]
- **Inspector is OUTSIDE the CSS Grid.** Uses `position: fixed` overlaying the board edge. NOT part of `grid-template-areas`. [Source: ux-design-specification.md#SimCardInspectorComponent]
- **SimCardComponent stays pure.** Card emits hover events as signal outputs. It does NOT inject services. Parent components (SimZoneComponent, SimHandComponent) wire hover events to `BoardStateService.setHoveredCard()`. [Source: 3-1 story dev notes — "Context Menu Design Decision: SimZoneComponent not SimCardComponent"]
- **Hover is NOT a command.** `hoveredCard` is a UI interaction signal — not a board state mutation. No command is created. The canonical action flow does not apply. [Source: architecture.md#Action Flow Pattern, architecture.md#Anti-Patterns — "Storing UI-only state in BoardStateService" exception for `hoveredCard`]
- **Inspector repositioning NOT needed yet.** Moving inspector to the left when pile overlay is on the right is Story 4.1 scope. For now, inspector is always right (desktop) or bottom (compact). [Source: ux-design-specification.md#Overlay & Panel Patterns]

### Hover Event Design Decision: Output Events on SimCardComponent

SimCardComponent emits hover events via Angular signal-based `output()`. Parent components listen and call `boardState.setHoveredCard()`.

**Why outputs (not direct service injection in SimCardComponent):**
1. **SimCardComponent is pure presentation** — no service injection (established in Story 3.1: "SimCardComponent stays pure")
2. **Consistent with drag events** — card is a CDK drag source, parent handles drag events
3. **Multiple rendering contexts** — SimCardComponent renders in zones, hand, and future overlays. Parent decides how to handle hover.

### Debounce Implementation

```typescript
// board-state.service.ts — add debounced hover tracking

private _hoverTimeout: ReturnType<typeof setTimeout> | null = null;

setHoveredCard(card: CardInstance | null): void {
  if (this._hoverTimeout !== null) {
    clearTimeout(this._hoverTimeout);
  }
  this._hoverTimeout = setTimeout(() => {
    this.hoveredCard.set(card);
    this._hoverTimeout = null;
  }, 50);
}
```

**Debounce behavior:**
- Fast mouse traversal across cards → previous card's `null` + new card's `set` both fire before 50ms → only final card appears in inspector
- Drag start → `mouseenter` stops firing (card picked up) → `hoveredCard` stays as last value, but `isDragging` hides inspector anyway
- Mouse leaves all cards → `null` after 50ms → inspector fades out
- **Cleanup:** Use `inject(DestroyRef)` + `destroyRef.onDestroy(() => clearTimeout(...))` to prevent memory leaks on navigation away

### SimCardComponent Hover Output

```typescript
// sim-card.component.ts — add outputs (NO new imports needed, output already available)
readonly hovered = output<CardInstance>();
readonly unhovered = output<void>();
```

```html
<!-- sim-card.component.html — add events to root div -->
<div class="sim-card"
     [class.def-position]="isDefPosition()"
     [class.hand-size]="size() === 'hand'"
     (mouseenter)="hovered.emit(cardInstance())"
     (mouseleave)="unhovered.emit()">
  @if (isFaceDown()) {
    <div class="card-back"></div>
  } @else {
    <img [src]="imageUrl()" [alt]="cardInstance().card.card.name" class="card-image">
  }
</div>
```

### Parent Wiring Example (SimZoneComponent)

```html
<!-- zone.component.html — update <app-sim-card> usage -->
<app-sim-card [cardInstance]="c"
              cdkDrag
              [cdkDragData]="c"
              [attr.aria-label]="'Drag ' + c.card.card.name"
              (cdkDragStarted)="onDragStarted()"
              (cdkDragEnded)="onDragEnded()"
              (hovered)="onCardHovered($event)"
              (unhovered)="onCardUnhovered()" />
```

```typescript
// zone.component.ts — add methods (boardState already injected)
onCardHovered(card: CardInstance): void {
  this.boardState.setHoveredCard(card);
}

onCardUnhovered(): void {
  this.boardState.setHoveredCard(null);
}
```

### Parent Wiring Example (SimHandComponent)

```html
<!-- hand.component.html — update each <app-sim-card> in @for loop -->
@for (card of hand(); track card.instanceId) {
  <app-sim-card [cardInstance]="card"
                [size]="'hand'"
                cdkDrag
                [cdkDragData]="card"
                (cdkDragStarted)="onDragStarted()"
                (cdkDragEnded)="onDragEnded()"
                (hovered)="onCardHovered($event)"
                (unhovered)="onCardUnhovered()" />
}
```

```typescript
// hand.component.ts — add methods (boardState already injected)
onCardHovered(card: CardInstance): void {
  this.boardState.setHoveredCard(card);
}

onCardUnhovered(): void {
  this.boardState.setHoveredCard(null);
}
```

### SimCardInspectorComponent Structure

```typescript
@Component({
  selector: 'app-sim-card-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [], // Minimal — no Material components needed
  templateUrl: './card-inspector.component.html',
  styleUrl: './card-inspector.component.scss',
  host: {
    'role': 'complementary',
    '[attr.aria-label]': '"Card inspector"',
    'aria-live': 'polite',
    '[class.visible]': 'isVisible()',
    '[class.expanded]': 'isExpanded()',
  }
})
export class SimCardInspectorComponent {
  private readonly boardState = inject(BoardStateService);

  readonly hoveredCard = this.boardState.hoveredCard;
  readonly isDragging = this.boardState.isDragging;

  readonly isVisible = computed(() =>
    this.hoveredCard() !== null && !this.isDragging()
  );

  readonly isFaceDown = computed(() =>
    this.hoveredCard()?.faceDown ?? false
  );

  // Responsive: bottom drawer toggle (compact desktop only)
  readonly isExpanded = signal(false);

  toggleDrawer(): void {
    this.isExpanded.update(v => !v);
  }
}
```

### Inspector Template Structure

```html
<!-- card-inspector.component.html -->

<!-- Desktop: right panel -->
@if (isVisible()) {
  @if (isFaceDown()) {
    <!-- Face-down: card back only -->
    <div class="inspector-content">
      <div class="card-back-large"></div>
    </div>
  } @else {
    <!-- Face-up: full details -->
    <div class="inspector-content">
      <img [src]="hoveredCard()!.image.url ?? hoveredCard()!.image.smallUrl"
           [alt]="hoveredCard()!.card.card.name"
           class="inspector-image" />
      <h3 class="card-name">{{ hoveredCard()!.card.card.name }}</h3>
      <div class="card-stats">
        <!-- Attribute, Race, Level/Rank/Link -->
        <span class="stat">{{ hoveredCard()!.card.card.attribute }}</span>
        <span class="stat">{{ hoveredCard()!.card.card.race }}</span>
        <span class="stat">Lv. {{ hoveredCard()!.card.card.level }}</span>
      </div>
      <div class="card-atk-def">
        <span>ATK {{ hoveredCard()!.card.card.atk }}</span>
        <span>DEF {{ hoveredCard()!.card.card.def }}</span>
      </div>
      <div class="card-effect" [innerHTML]="hoveredCard()!.card.card.description"></div>
    </div>
  }
}

<!-- Compact desktop: bottom drawer bar (click to expand) -->
<!-- The same component handles both layouts via CSS @media -->
```

**Important:** The exact property paths on `CardDetail`/`Card` model must be verified against the existing `core/model/card.ts`. The dev agent should read the actual Card model to confirm field names (`attribute`, `race`, `level`, `atk`, `def`, `description`). Some fields may use different names (e.g., `desc` instead of `description`).

### Inspector Styling

```scss
// card-inspector.component.scss
@use 'sim-tokens' as *;

:host {
  position: fixed;
  top: 0;
  right: 0;
  width: 280px;
  height: 100vh;
  background: $sim-surface;
  border-left: 1px solid $sim-zone-border;
  z-index: 10; // Above board, below CDK overlays (1000+)
  overflow-y: auto;
  padding: $sim-padding-overlay;
  opacity: 0;
  pointer-events: none;
  transition: opacity 100ms ease;

  &.visible {
    opacity: 1;
    pointer-events: auto;
  }
}

.inspector-image {
  width: 100%;
  border-radius: $sim-radius-card;
}

.card-name {
  color: $sim-text-primary;
  font-size: 1rem;
  font-weight: 600;
  margin: 0.5rem 0 0.25rem;
}

.card-stats, .card-atk-def {
  color: $sim-text-secondary;
  font-size: 0.8125rem;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.card-effect {
  color: $sim-text-primary;
  font-size: 0.875rem;
  line-height: 1.4;
  margin-top: 0.5rem;
  overflow-y: auto;
}

.card-back-large {
  width: 100%;
  aspect-ratio: 59 / 86;
  background: $sim-surface-elevated;
  border-radius: $sim-radius-card;
  border: 1px solid $sim-zone-border;
}

// Compact desktop: bottom drawer
@media (max-width: 1279px) {
  :host {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 40px;
    border-left: none;
    border-top: 1px solid $sim-zone-border;
    overflow: hidden;
    padding: 0 $sim-padding-overlay;
    display: flex;
    align-items: center;
    cursor: pointer;

    &.expanded {
      height: 200px;
      overflow-y: auto;
      cursor: default;
      flex-direction: row;
      align-items: flex-start;
      padding: $sim-padding-overlay;
    }
  }

  .inspector-content {
    display: flex;
    flex-direction: row;
    gap: 1rem;
    width: 100%;
  }

  .inspector-image {
    width: 120px;
    flex-shrink: 0;
  }
}

// Reduced motion support
@media (prefers-reduced-motion: reduce) {
  :host {
    transition: none;
  }
}

// Dev-only reduced-motion toggle
:host-context(.force-reduced-motion) {
  transition: none;
}
```

### Board Integration

```html
<!-- board.component.html — add AFTER the grid div -->
<div class="sim-board" cdkDropListGroup ...>
  <!-- ... existing 18 zones + hand + controls ... -->
</div>

<!-- Inspector is outside the grid — position: fixed -->
<app-sim-card-inspector />
```

```typescript
// board.component.ts — update imports
imports: [DragDropModule, SimZoneComponent, SimStackedZoneComponent, SimHandComponent, SimCardInspectorComponent],
```

### Z-Index Context

Per UX spec overlay hierarchy:
1. Drag preview (highest — `cdkDragPreviewContainer: 'global'`)
2. Context menus (`mat-menu` CDK Overlay — z-index ~1000)
3. Pile overlays (Story 4.1)
4. **Card inspector (`position: fixed`, z-index: 10)** ← this story
5. Board zones (base level)

Inspector z-index of 10 is intentionally low — it sits above the board grid but below all CDK overlay-based components (menus, pile overlays, drag previews).

### NFR Compliance

- **NFR5:** Card inspector panel appears within 200ms of hover — 50ms debounce + 100ms fade = 150ms total. ✅ Under 200ms budget.
- **NFR2:** Board state updates reflect visually within 100ms — hover is not a board state mutation, but inspector appearance at 150ms total is within acceptable range. ✅
- **NFR4:** Responsive with full board — inspector uses `position: fixed`, no impact on board rendering. OnPush + computed signals ensure only inspector re-renders on hover change. ✅

### What This Story Does NOT Include

- **No inspector repositioning** when pile overlay opens on right — Story 4.1 scope
- **No hover on overlay cards** (pile overlay doesn't exist yet) — Story 4.1 will wire hover in overlay
- **No card pills** (quick actions on board cards) — post-MVP per UX spec
- **No undo/redo UI** — Story 5.1
- **No keyboard shortcut for inspector** — not specified in any FR
- **No context menu on hand cards** — not specified (board-only per Story 3.1)
- **No card image zoom or lightbox** — not specified

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `setHoveredCard()` method on BoardStateService | Story 4.1 (pile overlay card hover wiring) |
| `SimCardInspectorComponent` | Story 4.1 (inspector repositioning via computed signal when overlay on right) |
| `hovered` / `unhovered` outputs on SimCardComponent | Story 4.1 (overlay card hover events) |
| `hoveredCard` 50ms debounce logic | All future hover interactions |

### Previous Story Intelligence (Story 3.1)

**Patterns established to follow:**
- SCSS import: `@use 'sim-tokens' as *` (not `@import`) — Dart Sass 2.0
- Service injection: `inject()` function pattern (not constructor injection in components)
- Signal access: read via `.()`, mutate via `.set()` or `.update()`
- `isDragging` management via `(cdkDragStarted)` and `(cdkDragEnded)` on parent components
- `prefers-reduced-motion` media query on all animations
- `isDevMode()` guard where appropriate
- try/catch wrapping service calls with `console.warn` in dev mode
- `aria-label` on all interactive elements

**Story 3.1 code review fixes to maintain:**
- try/catch in all command service call sites (from H1 fix)
- `requestAnimationFrame` + timeout reset for glow restart on rapid drops (via `triggerGlow()`)
- `aria-label` on draggable cards
- Context menu opens at cursor position using ElementRef offset (from M1 fix)

### Existing Code — What NOT to Change

| File | Keep As-Is |
|---|---|
| `simulator.models.ts` | `CardInstance` already has all needed data (`card`, `image`, `faceDown`, `position`). No changes. |
| `command-stack.service.ts` | No new commands — hover is not a command. No changes. |
| `commands/*` | All 7 command files unchanged. |
| `stacked-zone.component.*` | Unchanged — hover on stacked zone cards not in scope (no SimCardComponent rendered there). |
| `glow-effect.ts` | Unchanged. |
| `simulator-page.component.*` | Unchanged — inspector is in board, not page. |

### Project Structure Notes

**New files created by this story:**
```
front/src/app/pages/simulator/
  card-inspector.component.ts     # NEW — SimCardInspectorComponent
  card-inspector.component.html   # NEW — Inspector template
  card-inspector.component.scss   # NEW — Inspector styles + responsive drawer
```

**Files modified by this story:**
```
front/src/app/pages/simulator/
  board-state.service.ts          # MODIFIED — add setHoveredCard() with 50ms debounce + DestroyRef cleanup
  sim-card.component.ts           # MODIFIED — add hovered/unhovered output events
  sim-card.component.html         # MODIFIED — add (mouseenter)/(mouseleave) bindings
  zone.component.ts               # MODIFIED — add onCardHovered/onCardUnhovered handlers
  zone.component.html             # MODIFIED — wire (hovered)/(unhovered) on <app-sim-card>
  hand.component.ts               # MODIFIED — add onCardHovered/onCardUnhovered handlers
  hand.component.html             # MODIFIED — wire (hovered)/(unhovered) on each <app-sim-card>
  board.component.ts              # MODIFIED — add SimCardInspectorComponent to imports
  board.component.html            # MODIFIED — add <app-sim-card-inspector /> after grid div
```

### References

- [Source: ux-design-specification.md#SimCardInspectorComponent] — Full component spec (purpose, content, trigger, position, states, suppression, styling, face-down, accessibility)
- [Source: ux-design-specification.md#Overlay & Panel Patterns — Card Inspector Panel] — Positioning, repositioning (Story 4.1), suppression, face-down behavior
- [Source: ux-design-specification.md#Drag & Drop Patterns] — hoveredCard signal with 50ms debounce, isDragging suppression
- [Source: ux-design-specification.md#Responsive Strategy] — Compact desktop breakpoint (1024-1279px), collapsible bottom drawer
- [Source: ux-design-specification.md#Accessibility Strategy] — ARIA roles, reduced motion support
- [Source: ux-design-specification.md#Feedback & State Indication Patterns] — Inspector z-index hierarchy
- [Source: ux-design-specification.md#Component Strategy — SimCardInspectorComponent] — Implementation notes
- [Source: architecture.md#Service Responsibility Boundaries] — hoveredCard owned by BoardStateService
- [Source: architecture.md#Component Communication Patterns] — Signal-based inputs/outputs, service injection
- [Source: architecture.md#State Management Patterns] — Signal naming (hoveredCard = noun), isDragging = is-prefixed boolean
- [Source: architecture.md#Anti-Patterns to Avoid] — Exception: isDragging and hoveredCard are cross-cutting interaction signals in BoardStateService
- [Source: epics.md#Story 3.2] — Acceptance criteria, user story, implementation notes
- [Source: epics.md#Epic 3 Implementation Notes] — SimCardInspectorComponent spec
- [Source: prd.md#FR28] — Card details on hover (face-up only, card back for face-down)
- [Source: prd.md#NFR5] — Card inspector panel appears within 200ms of hover (with 50ms debounce)
- [Source: 3-1-card-state-toggle-via-context-menu.md] — Previous story patterns, code review fixes, context menu design decision

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No issues encountered during implementation.

### Completion Notes List

- Task 1: Added `hovered` and `unhovered` signal outputs to SimCardComponent with `mouseenter`/`mouseleave` bindings on root div
- Task 2: Wired hover events in SimZoneComponent and SimHandComponent — parent components call `boardState.setHoveredCard()` on hover/unhover
- Task 3: Implemented `setHoveredCard()` with 50ms setTimeout debounce in BoardStateService. Added `DestroyRef` cleanup for timeout. `hoveredCard` signal only updates after debounce fires.
- Task 4: Created SimCardInspectorComponent (standalone, OnPush) — reads `hoveredCard` and `isDragging` signals, computes `isVisible` and `isFaceDown`. Template shows full card details (image, name, attribute/race/level, ATK/DEF, scrollable effect text) for face-up cards, card back only for face-down. Used `displayAtk`/`displayDef` for formatted values, `[innerHTML]` for description (already contains `<br>` from CardDTO). ARIA: `role="complementary"`, `aria-label="Card inspector"`, `aria-live="polite"`.
- Task 5: Responsive bottom drawer implemented via `@media (max-width: 1279px)` — collapsed 40px bar with card name, expands to 200px horizontal layout on click. `isExpanded` signal + `toggleDrawer()` method.
- Task 6: Added `SimCardInspectorComponent` to board imports and placed `<app-sim-card-inspector />` outside the CSS Grid div as sibling element.
- Task 7: `ng build --configuration development` passed with zero errors.

### Change Log

- 2026-02-11: Implemented Story 3.2 — Card Inspector Panel (all 7 tasks, all ACs satisfied)
- 2026-02-11: Code review (Claude Opus 4.6) — Fixed 4 issues:
  - H1: Added dedicated `.drawer-bar` with card name for compact collapsed state (AC6 compliance)
  - M1: Replaced ~15 `hoveredCard()!` non-null assertions with `@if (hoveredCard(); as card)` aliasing
  - M2: Added `max-height` on `.card-effect` to keep image/stats visible with long descriptions
  - M3: Added `height` transition for smooth compact drawer expansion
  - L1: Removed unused `CardInstance` import

### File List

**New files:**
- `front/src/app/pages/simulator/card-inspector.component.ts`
- `front/src/app/pages/simulator/card-inspector.component.html`
- `front/src/app/pages/simulator/card-inspector.component.scss`

**Modified files:**
- `front/src/app/pages/simulator/sim-card.component.ts` — added `hovered`/`unhovered` outputs
- `front/src/app/pages/simulator/sim-card.component.html` — added `(mouseenter)`/`(mouseleave)` bindings
- `front/src/app/pages/simulator/zone.component.ts` — added `onCardHovered`/`onCardUnhovered` methods
- `front/src/app/pages/simulator/zone.component.html` — wired `(hovered)`/`(unhovered)` on `<app-sim-card>`
- `front/src/app/pages/simulator/hand.component.ts` — added `onCardHovered`/`onCardUnhovered` methods
- `front/src/app/pages/simulator/hand.component.html` — wired `(hovered)`/`(unhovered)` on `<app-sim-card>`
- `front/src/app/pages/simulator/board-state.service.ts` — added `setHoveredCard()` with 50ms debounce + `DestroyRef` cleanup
- `front/src/app/pages/simulator/board.component.ts` — added `SimCardInspectorComponent` to imports
- `front/src/app/pages/simulator/board.component.html` — added `<app-sim-card-inspector />` outside grid
