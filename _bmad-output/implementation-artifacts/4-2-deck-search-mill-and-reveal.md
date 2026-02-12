# Story 4.2: Deck Search, Mill & Reveal

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to search my deck for a specific card, mill cards to GY, and reveal top cards,
so that I can simulate search effects, mill effects, and excavate effects during combos.

## Acceptance Criteria

1. **Given** I right-click on the Deck zone,
   **When** the context menu opens,
   **Then** the existing `mat-menu` (from Epic 2) now includes "Search", "Mill (N)", and "Reveal (N)" in addition to "Shuffle".

2. **Given** I click "Search" in the Deck context menu,
   **When** the overlay opens in search mode,
   **Then** all remaining deck cards are displayed with image + name,
   **And** a filter text input is available at the top (`aria-label="Search cards"`),
   **And** I can type to filter cards by name,
   **And** each card is draggable to any board zone or hand,
   **And** when I close the overlay, the deck is automatically shuffled.

3. **Given** I click "Mill (N)" in the Deck context menu,
   **When** a prompt asks for the number of cards to mill,
   **Then** I enter N and `CommandStackService.mill()` wraps N `MoveCardCommand`s (deck top → GY) in a single `CompositeCommand` via `executeBatch()`,
   **And** N cards move from deck top to GY in sequence, deck and GY badges update,
   **And** undo reverses all N moves as a single unit.

4. **Given** I click "Reveal (N)" in the Deck context menu,
   **When** a prompt asks for the number of cards to reveal,
   **Then** I enter N and the overlay opens showing only the top N cards of the deck,
   **And** each card can be dragged to a destination zone,
   **And** cards not moved when the overlay closes are returned to the top of the deck in their original order.

5. **Given** I need to mill cards (send top N from deck to GY),
   **When** I drag the top card of the deck to the GY zone,
   **Then** the card moves via `MoveCardCommand` (already implemented — no change needed).

## Tasks / Subtasks

- [x] **Task 1: Add `OverlayMode` type and overlay mode signals to BoardStateService** (AC: 2, 4)
  - [x] 1.1: Add `OverlayMode` type (`'browse' | 'search' | 'reveal'`) export to `simulator.models.ts`
  - [x] 1.2: Add `readonly activeOverlayMode = signal<OverlayMode | null>(null)` to `board-state.service.ts`
  - [x] 1.3: Add `readonly revealedCardIds = signal<Set<string>>(new Set())` for tracking originally revealed cards
  - [x] 1.4: Modify `openOverlay(zoneId: ZoneId, mode: OverlayMode = 'browse')` to accept and set mode (backward-compatible default)
  - [x] 1.5: Add `openDeckSearch(): void` — sets zone=MAIN_DECK, mode='search'
  - [x] 1.6: Add `openDeckReveal(count: number): void` — snapshots top N card IDs into `revealedCardIds`, sets zone=MAIN_DECK, mode='reveal'
  - [x] 1.7: Add `readonly revealCards = computed(...)` — filters deck cards by `revealedCardIds` (only originally revealed cards still in deck)
  - [x] 1.8: Modify `closeOverlay()` to also reset `activeOverlayMode` to null and `revealedCardIds` to empty Set

- [x] **Task 2: Add `executeBatch()` and `mill()` to CommandStackService** (AC: 3)
  - [x] 2.1: Add private `executeBatch(commands: SimCommand[]): void` — wraps in `CompositeCommand`, calls internal execute method (push to undoStack, clear redoStack)
  - [x] 2.2: Add public `mill(count: number): void` — reads top N deck cards by slicing `boardState()[ZoneId.MAIN_DECK]`, creates N `MoveCardCommand`s (MAIN_DECK → GRAVEYARD), calls `executeBatch()`
  - [x] 2.3: Cap count at deck size: `Math.min(count, deckCards.length)`, return early if 0

- [x] **Task 3: Extend Deck context menu in SimStackedZoneComponent** (AC: 1, 3, 4)
  - [x] 3.1: Inject `CommandStackService` via `inject()` into `stacked-zone.component.ts`
  - [x] 3.2: Add "Search" `mat-menu-item` with `mat-icon` `search` → calls `onSearch()`
  - [x] 3.3: Add "Mill (N)" `mat-menu-item` with `mat-icon` `archive` → calls `onMill()`
  - [x] 3.4: Add "Reveal (N)" `mat-menu-item` with `mat-icon` `visibility` → calls `onReveal()`
  - [x] 3.5: Create `onSearch(): void` — calls `this.boardState.openDeckSearch()`
  - [x] 3.6: Create `onMill(): void` — `window.prompt('Mill how many cards?')`, parseInt + validate (>0, not NaN), call `this.commandStack.mill(count)` in try/catch
  - [x] 3.7: Create `onReveal(): void` — `window.prompt('Reveal how many cards?')`, parseInt + validate (>0, not NaN), call `this.boardState.openDeckReveal(count)`

- [x] **Task 4: Extend SimPileOverlayComponent with search mode** (AC: 2)
  - [x] 4.1: Inject `CommandStackService` via `inject()` into `pile-overlay.component.ts`
  - [x] 4.2: Add `readonly mode = this.boardState.activeOverlayMode`
  - [x] 4.3: Add `readonly isSearchMode = computed(() => this.mode() === 'search')`
  - [x] 4.4: Add `readonly filterText = signal('')`
  - [x] 4.5: Add `readonly filteredCards = computed(...)` — when search mode, filter `cards()` by name case-insensitive using `filterText()`; when no filter or not search, return `cards()`
  - [x] 4.6: Add search `<input>` in template after header, before card list — `aria-label="Search cards"`, `(input)` sets `filterText`, wrapped in search-input styling div
  - [x] 4.7: Add `MatIconModule` to imports if not present (for search icon in input wrapper)
  - [x] 4.8: Autofocus search input when search mode opens — `viewChild` ref + `effect()` + `requestAnimationFrame`
  - [x] 4.9: Modify `close()`: if `isSearchMode()`, call `this.commandStack.shuffleDeck()` before `boardState.closeOverlay()` (try/catch with console.warn in devMode)
  - [x] 4.10: Reset `filterText` to `''` in `close()`

- [x] **Task 5: Extend SimPileOverlayComponent with reveal mode** (AC: 4)
  - [x] 5.1: Add `readonly isRevealMode = computed(() => this.mode() === 'reveal')`
  - [x] 5.2: Add `readonly displayCards = computed(...)` — reveal: `boardState.revealCards()`, search: `filteredCards()`, browse: `cards()`
  - [x] 5.3: Update template to use `displayCards()` for the card list (all 3 rendering paths: grouped, flat, and search/reveal)
  - [x] 5.4: Add `readonly overlayTitle = computed(...)` — search: "Deck Search", reveal: "Reveal — N card(s)", browse: `zoneName()`
  - [x] 5.5: Update header `<h3>` to use `overlayTitle()` instead of `zoneName()`
  - [x] 5.6: In search/reveal mode, use flat card list (no face-down grouping — deck cards are always face-down, search/reveal shows them face-up)

- [x] **Task 6: Verify build** (AC: all)
  - [x] 6.1: Run `ng build --configuration development` — zero errors

## Dev Notes

### Critical Architecture Constraints

- **`executeBatch()` is PRIVATE.** Components never call it directly. They call `commandStack.mill(count)` — the semantic method. Mill internally uses `executeBatch()` to wrap MoveCardCommands in a CompositeCommand. [Source: architecture.md#Enforcement Guidelines — "components never import or instantiate Command classes directly"]
- **`mill()` uses existing `MoveCardCommand` + `CompositeCommand`.** No new command class needed. Mill = N MoveCardCommands wrapped in one CompositeCommand. [Source: architecture.md#Command Pattern Design, epics.md#Epic 4 Implementation Notes]
- **Overlay mode is UI-only state.** `activeOverlayMode` lives in BoardStateService alongside `activeOverlayZone`. Mode changes are NOT commands — they don't affect undo/redo. [Source: architecture.md#Anti-Patterns — Exception for cross-cutting UI signals]
- **Search close auto-shuffle IS a command.** When search overlay closes, `commandStack.shuffleDeck()` creates a ShuffleCommand on the undo stack. Intentional — player saw the deck order, shuffle must happen, and it's undoable. [Source: AC 2]
- **Reveal cards track by ID snapshot.** `revealedCardIds` is set ONCE when reveal opens (snapshot of top N card IDs). Prevents new cards from becoming visible when revealed cards are dragged away. [Source: AC 4 — "overlay opens showing only the top N cards"]
- **No drop INTO overlay in any mode.** The existing `noDrop` predicate (`cdkDropListEnterPredicate` returning false) applies to ALL overlay modes. Cards can only be dragged OUT. [Source: 4-1-pile-overlay-browse-mode.md — overlay design]
- **`window.prompt()` for Mill/Reveal count.** Simple, zero-dependency. Cancelled prompt = no action. Non-numeric/negative = no action. Acceptable for personal tool. [Source: pragmatic approach]
- **Zero direct board state mutation.** Cards dragged from search/reveal overlay to board go through existing target zone `onDrop()` handlers → `commandStack.moveCard()`. No changes to target zones needed. [Source: architecture.md#Enforcement Guidelines]

### Implementation Details

#### Mill: MoveCardCommand Batch

Each MoveCardCommand moves a specific card by `instanceId` from MAIN_DECK to GRAVEYARD. Card IDs are resolved from the current deck array BEFORE creating commands. CompositeCommand.execute() runs them in order. CompositeCommand.undo() reverses in reverse order, correctly restoring all cards to deck top.

```typescript
// In CommandStackService — add:
private executeBatch(commands: SimCommand[]): void {
  if (commands.length === 0) return;
  if (commands.length === 1) {
    // Single command: no composite wrapper needed
    this.executeInternal(commands[0]);
    return;
  }
  const composite = new CompositeCommand(commands);
  this.executeInternal(composite);
}

mill(count: number): void {
  const deckCards = this.boardState.boardState()[ZoneId.MAIN_DECK];
  const n = Math.min(count, deckCards.length);
  if (n === 0) return;

  const commands = deckCards.slice(0, n).map(card =>
    new MoveCardCommand(this.boardState, card.instanceId, ZoneId.MAIN_DECK, ZoneId.GRAVEYARD)
  );
  this.executeBatch(commands);
}
```

**Note:** `executeInternal` refers to the existing private method that calls `command.execute()`, pushes to `undoStack`, and clears `redoStack`. Use whatever the current internal method name is in the actual code.

#### Reveal: Card ID Snapshot

When reveal opens, snapshot top N card IDs. The `revealCards` computed filters the live deck array by these IDs — as cards are dragged away (removed from deck by MoveCardCommand), they disappear from the reveal list. No new deeper cards ever appear.

```typescript
// In BoardStateService — add:
readonly revealedCardIds = signal<Set<string>>(new Set());

openDeckReveal(count: number): void {
  const deckCards = this.boardState()[ZoneId.MAIN_DECK];
  const n = Math.min(count, deckCards.length);
  const ids = new Set(deckCards.slice(0, n).map(c => c.instanceId));
  this.revealedCardIds.set(ids);
  this.activeOverlayZone.set(ZoneId.MAIN_DECK);
  this.activeOverlayMode.set('reveal');
}

readonly revealCards = computed(() => {
  if (this.activeOverlayMode() !== 'reveal') return [];
  const ids = this.revealedCardIds();
  return this.boardState()[ZoneId.MAIN_DECK].filter(c => ids.has(c.instanceId));
});
```

On close: remaining revealed cards are already at the deck top (never physically moved). `closeOverlay()` resets all signals — nothing else needed.

#### Search: Auto-Shuffle on Close

```typescript
// In SimPileOverlayComponent — modify close():
close(): void {
  if (this.isSearchMode()) {
    try {
      this.commandStack.shuffleDeck();
    } catch (e) {
      if (isDevMode()) console.warn('Auto-shuffle on search close failed', e);
    }
  }
  this.filterText.set('');
  this.boardState.closeOverlay();
}
```

The auto-shuffle creates a ShuffleCommand in the undo stack. Each card dragged from search was a separate MoveCardCommand. Undo history: [...MoveCard(s), Shuffle]. Undo reverses shuffle first, then each move — correct behavior.

#### Search Filter

```typescript
// In SimPileOverlayComponent — add:
readonly filterText = signal('');

readonly filteredCards = computed(() => {
  const allCards = this.cards();
  if (!this.isSearchMode()) return allCards;
  const filter = this.filterText().toLowerCase().trim();
  if (!filter) return allCards;
  return allCards.filter(c => c.card.card.name.toLowerCase().includes(filter));
});
```

#### Display Cards (Unified for All Modes)

```typescript
// In SimPileOverlayComponent — add:
readonly isSearchMode = computed(() => this.boardState.activeOverlayMode() === 'search');
readonly isRevealMode = computed(() => this.boardState.activeOverlayMode() === 'reveal');

readonly displayCards = computed(() => {
  if (this.isRevealMode()) return this.boardState.revealCards();
  if (this.isSearchMode()) return this.filteredCards();
  return this.cards(); // browse mode
});
```

#### Overlay Title (Mode-Aware)

```typescript
readonly overlayTitle = computed(() => {
  const mode = this.boardState.activeOverlayMode();
  if (mode === 'search') return 'Deck Search';
  if (mode === 'reveal') {
    const count = this.boardState.revealCards().length;
    return `Reveal — ${count} card${count !== 1 ? 's' : ''}`;
  }
  return this.zoneName(); // browse mode: zone name from ZONE_CONFIG
});
```

#### Stacked Zone Context Menu (Extend Existing)

```html
<!-- stacked-zone.component.html — extend existing deckMenu -->
<mat-menu #deckMenu="matMenu">
  <button mat-menu-item (click)="onShuffle()">
    <mat-icon>shuffle</mat-icon>
    <span>Shuffle</span>
  </button>
  <button mat-menu-item (click)="onSearch()">
    <mat-icon>search</mat-icon>
    <span>Search</span>
  </button>
  <button mat-menu-item (click)="onMill()">
    <mat-icon>archive</mat-icon>
    <span>Mill (N)</span>
  </button>
  <button mat-menu-item (click)="onReveal()">
    <mat-icon>visibility</mat-icon>
    <span>Reveal (N)</span>
  </button>
</mat-menu>
```

```typescript
// stacked-zone.component.ts — add:
private readonly commandStack = inject(CommandStackService);

onSearch(): void {
  this.boardState.openDeckSearch();
}

onMill(): void {
  const input = window.prompt('Mill how many cards?');
  if (input === null) return;
  const count = parseInt(input, 10);
  if (isNaN(count) || count <= 0) return;
  try {
    this.commandStack.mill(count);
  } catch (e) {
    if (isDevMode()) console.warn('Mill failed', e);
  }
}

onReveal(): void {
  const input = window.prompt('Reveal how many cards?');
  if (input === null) return;
  const count = parseInt(input, 10);
  if (isNaN(count) || count <= 0) return;
  this.boardState.openDeckReveal(count);
}
```

#### Search Input Template

```html
<!-- pile-overlay.component.html — add after header, before card list -->
@if (isSearchMode()) {
  <div class="search-input-wrapper">
    <mat-icon class="search-icon">search</mat-icon>
    <input class="search-input"
           type="text"
           placeholder="Filter by name..."
           aria-label="Search cards"
           [value]="filterText()"
           (input)="onFilterInput($event)"
           #searchInput />
  </div>
}
```

```typescript
// pile-overlay.component.ts — add:
onFilterInput(event: Event): void {
  this.filterText.set((event.target as HTMLInputElement).value);
}

// Autofocus search input when search mode opens
private readonly searchInputRef = viewChild<ElementRef>('searchInput');

constructor() {
  effect(() => {
    if (this.isSearchMode() && this.isOpen()) {
      requestAnimationFrame(() => {
        this.searchInputRef()?.nativeElement.focus();
      });
    }
  });
}
```

#### Search/Reveal Template: Flat Card List (No Grouping)

In search and reveal modes, ALL displayed cards render as a flat list (no face-up/face-down grouping). Deck cards are face-down by data model, but search/reveal exposes them — display them like face-up cards. The existing `needsGrouping` computed already handles this: it only groups for ED and Banished zones, never for MAIN_DECK.

Template logic for displayCards:
```html
<!-- Update card list sections to use displayCards() instead of cards() -->
<!-- The grouped path (needsGrouping) stays for browse mode ED/Banished -->
<!-- The flat path uses displayCards() for search/reveal/GY browse -->
@if (!needsGrouping() || isSearchMode() || isRevealMode()) {
  @for (card of displayCards(); track card.instanceId) {
    <!-- same card row template -->
  }
}
```

#### Search Input SCSS

```scss
// pile-overlay.component.scss — add:

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: $sim-surface-elevated;
  border-radius: $sim-radius-zone;
  border: 1px solid $sim-zone-border;

  &:focus-within {
    border-color: $sim-accent-primary;
  }
}

.search-icon {
  color: $sim-text-secondary;
  font-size: 20px;
  width: 20px;
  height: 20px;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: $sim-text-primary;
  font-size: 0.875rem;
  font-family: inherit;

  &::placeholder {
    color: $sim-text-secondary;
  }
}
```

### Edge Cases

- **Mill > deck size:** `Math.min(count, deckCards.length)` caps at available cards. Mill 10 from a 3-card deck = mill 3.
- **Reveal > deck size:** Same cap logic. Reveal 5 from a 2-card deck = reveal 2.
- **Mill 0 / Reveal 0:** Early return, no command created.
- **Prompt cancelled:** `window.prompt()` returns null → no action.
- **Prompt non-numeric:** `parseInt` returns NaN → validated, no action.
- **Empty deck → Search:** Opens overlay with empty state: "No cards in Main Deck". No shuffle on close (deck is empty).
- **Empty deck → Mill/Reveal:** `Math.min(count, 0)` = 0 → early return, no action.
- **Search + drag all cards out → close:** Deck now empty. `shuffleDeck()` on close shuffles an empty array — harmless ShuffleCommand stored, no visual change.
- **Reveal + drag some cards → close:** Remaining revealed cards stay at deck top. `closeOverlay()` resets signals. Order preserved naturally.

### NFR Compliance

- **NFR2:** Board state updates < 100ms — mill CompositeCommand updates `boardState` signal via sequential `MoveCardCommand.execute()` calls. Computed signals propagate instantly.
- **NFR6:** Zone overlays open < 300ms — search/reveal modes reuse existing overlay with 150ms fade-in animation.
- **NFR4:** Responsive with full board — no additional rendering cost. Filter is a simple string operation on signals.

### What This Story Does NOT Include

- **No XYZ material management** — Story 4.3
- **No undo/redo UI buttons** — Story 5.1
- **No keyboard shortcuts** (Ctrl+Z, Ctrl+Y) — Story 5.2
- **No card pills on board cards** — post-MVP
- **No touch/mobile support** — post-MVP
- **No Deck click-to-browse** — Deck uses context menu for Search (click on Deck does nothing for browse)
- **No extra deck context menu** — ED retains click-to-browse overlay (no Search/Mill/Reveal on ED)

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| `mill()` on CommandStackService | Story 5.1 (undo/redo of mill as single composite unit) |
| `executeBatch()` private method | Internal — future batch operations |
| `OverlayMode` type in models | Story 4.3 (potential XYZ-related overlay usage) |
| Search/reveal overlay modes | No downstream dependency |
| `revealedCardIds` signal | No downstream dependency |

### Previous Story Intelligence (Story 4.1)

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
- `cdkDragPreviewContainer: 'global'` on ALL overlay drag items
- `noDrop` predicate on overlay's `cdkDropList`
- `@HostListener('document:keydown.escape')` for overlay close

**Code review fixes from 4.1 to maintain:**
- Click-outside uses `document:mousedown` listener (not backdrop div)
- `role="complementary"` for non-modal side panel
- Focus management via `effect()` on open
- `@if` aliasing instead of non-null assertions

### Existing Code — What NOT to Change

| File | Keep As-Is | Reason |
|---|---|---|
| `commands/move-card.command.ts` | Unchanged | Already handles cross-zone moves by instanceId |
| `commands/composite.command.ts` | Unchanged | Already wraps commands for batch execute/undo |
| `commands/draw-card.command.ts` | Unchanged | Not used by this story |
| `commands/shuffle.command.ts` | Unchanged | Called via existing `shuffleDeck()` method |
| `commands/flip-card.command.ts` | Unchanged | Not used by this story |
| `commands/toggle-position.command.ts` | Unchanged | Not used by this story |
| `commands/reorder-hand.command.ts` | Unchanged | Not used by this story |
| `commands/index.ts` | Unchanged | Barrel export, no new commands |
| `sim-card.component.*` | Unchanged | Pure rendering + hover outputs |
| `zone.component.*` | Unchanged | Single-card zones unaffected |
| `hand.component.*` | Unchanged | Hand zone unaffected |
| `board.component.*` | Unchanged | cdkDropListGroup already correct from 4.1 |
| `card-inspector.component.*` | Unchanged | Inspector repositioning already done in 4.1 |
| `simulator-page.component.*` | Unchanged | Page container and service provider |
| `glow-effect.ts` | Unchanged | Glow utility |
| `_sim-tokens.scss` | Unchanged | All needed tokens exist |

### Project Structure Notes

- Alignment with unified project structure: all files in `front/src/app/pages/simulator/`
- No new files created — this story extends existing components
- Component selectors remain `app-sim-*` prefix

**Files modified by this story:**
```
front/src/app/pages/simulator/
  simulator.models.ts            # MODIFIED — add OverlayMode type export
  board-state.service.ts         # MODIFIED — add activeOverlayMode signal, revealedCardIds signal,
                                 #            openDeckSearch(), openDeckReveal(), revealCards computed,
                                 #            modify openOverlay() signature, modify closeOverlay()
  command-stack.service.ts       # MODIFIED — add private executeBatch(), public mill()
  stacked-zone.component.ts     # MODIFIED — inject CommandStackService, add onSearch/onMill/onReveal
  stacked-zone.component.html   # MODIFIED — extend deck mat-menu with 3 new items
  pile-overlay.component.ts     # MODIFIED — inject CommandStackService, add search/reveal mode signals,
                                 #            filterText signal, filteredCards/displayCards/overlayTitle computeds,
                                 #            autofocus effect, modify close() for search shuffle
  pile-overlay.component.html   # MODIFIED — add search input, use displayCards(), update header title,
                                 #            handle search/reveal flat rendering
  pile-overlay.component.scss   # MODIFIED — add search-input-wrapper and search-input styles
```

### References

- [Source: epics.md#Story 4.2] — Acceptance criteria, user story, implementation notes
- [Source: epics.md#Epic 4 Implementation Notes] — executeBatch(), CompositeCommand wrapping, overlay modes
- [Source: architecture.md#Command Pattern Design] — 6 commands + CompositeCommand, delta-based
- [Source: architecture.md#Service Responsibility Boundaries] — CommandStackService exposes semantic methods, BoardStateService owns UI signals
- [Source: architecture.md#Enforcement Guidelines] — Zero direct mutation, components never instantiate commands
- [Source: architecture.md#Action Flow Pattern] — Canonical action flow for all state mutations
- [Source: architecture.md#Anti-Patterns to Avoid] — Exception for cross-cutting UI signals
- [Source: ux-design-specification.md#Context Menu Patterns] — Deck context menu: Shuffle, Search, Mill, Reveal
- [Source: ux-design-specification.md#Overlay & Panel Patterns] — Pile overlay modes (browse/search/reveal), auto-close, stays open during drag
- [Source: ux-design-specification.md#Component Strategy — SimPileOverlayComponent] — 3 modes, search filter, reveal behavior
- [Source: ux-design-specification.md#Zone Interaction Rules] — Deck right-click menu items
- [Source: ux-design-specification.md#Flow Optimization Principles] — Zero-step mill (drag to GY), overlay as drag source
- [Source: prd.md#FR18] — Search deck and pick card
- [Source: prd.md#FR19] — Mill top N cards to GY
- [Source: prd.md#FR20] — Reveal/excavate top N cards
- [Source: prd.md#NFR2] — Board state updates within 100ms
- [Source: prd.md#NFR6] — Overlay opens within 300ms
- [Source: 4-1-pile-overlay-browse-mode.md] — Previous story patterns, overlay architecture, code review fixes

## Change Log

- 2026-02-11: Implemented Deck Search, Mill & Reveal — all 6 tasks completed, build passes with zero errors
- 2026-02-11: **Code Review (AI)** — 6 findings (1 CRITICAL, 1 HIGH, 2 MEDIUM, 2 LOW). Fixed 4:
  - [C1+H1] Mill & Reveal used `slice(0, n)` (bottom of deck) instead of `slice(-n)` (top). Also fixed mill undo deck order corruption by using `slice(-n).reverse()` for correct descending fromIndex.
  - [M1] Empty state message now contextual: "No matching cards" (search filter), "All revealed cards moved" (reveal), "No cards in {zone}" (browse).
  - [M2] Added try/catch + isDevMode() console.warn to `onReveal()` for pattern consistency.
  - [L1, L2] Not fixed (low priority — template safe navigation, stale `nul` file).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build error: `c.card.card.name` possibly undefined (TS18048) — fixed with optional chaining `?.`
- `executeBatch()` already existed in CommandStackService from previous story — enhanced with single-command optimization and added `mill()` method

### Completion Notes List

- **Task 1**: Added `OverlayMode` type to `simulator.models.ts`, added `activeOverlayMode`, `revealedCardIds` signals and `revealCards` computed to `BoardStateService`, modified `openOverlay()` to accept mode parameter, added `openDeckSearch()` and `openDeckReveal()`, modified `closeOverlay()` to reset mode and revealedCardIds
- **Task 2**: Enhanced existing `executeBatch()` with single-command optimization (no composite wrapper for 1 command), added `mill()` public method using MoveCardCommand batch
- **Task 3**: `CommandStackService` was already injected. Added Search, Mill (N), Reveal (N) menu items to deck context menu. Added `onSearch()`, `onMill()`, `onReveal()` methods with window.prompt validation
- **Task 4**: Injected `CommandStackService`, added search mode signals (`isSearchMode`, `filterText`, `filteredCards`), search input with autofocus, auto-shuffle on close, filter reset on close
- **Task 5**: Added reveal mode signals (`isRevealMode`, `displayCards`, `overlayTitle`), updated template to use `displayCards()` and `overlayTitle()`, flat card list for search/reveal modes
- **Task 6**: Build passes — `ng build --configuration development` completed with zero errors

### File List

- `front/src/app/pages/simulator/simulator.models.ts` — MODIFIED: added `OverlayMode` type export
- `front/src/app/pages/simulator/board-state.service.ts` — MODIFIED: added `activeOverlayMode` signal, `revealedCardIds` signal, `revealCards` computed, `openDeckSearch()`, `openDeckReveal()`, modified `openOverlay()` and `closeOverlay()`
- `front/src/app/pages/simulator/command-stack.service.ts` — MODIFIED: enhanced `executeBatch()` with single-command optimization, added `mill()` public method
- `front/src/app/pages/simulator/stacked-zone.component.ts` — MODIFIED: added `onSearch()`, `onMill()`, `onReveal()` methods
- `front/src/app/pages/simulator/stacked-zone.component.html` — MODIFIED: added Search, Mill (N), Reveal (N) menu items to deck context menu
- `front/src/app/pages/simulator/pile-overlay.component.ts` — MODIFIED: injected `CommandStackService`, added search/reveal mode signals, filter logic, autofocus effect, modified `close()` for auto-shuffle and filter reset
- `front/src/app/pages/simulator/pile-overlay.component.html` — MODIFIED: added search input, updated header to use `overlayTitle()`, updated card list to use `displayCards()`, flat rendering for search/reveal
- `front/src/app/pages/simulator/pile-overlay.component.scss` — MODIFIED: added search-input-wrapper and search-input styles
