# Story 1.1: Simulator Page Scaffold & Route

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to click "Tester" on my deck detail page and navigate to the simulator,
so that I can access the combo testing tool from my existing workflow.

## Acceptance Criteria

1. **Given** I am on the existing deck detail page (`DeckBuilderComponent`) with a saved deck (has an `id`),
   **When** the page renders,
   **Then** a "Tester" button (icon: `sports_esports`) is visible in the toolbar alongside existing buttons (save, print, export, import, hand test),
   **And** the button is disabled when the deck has no `id` (new unsaved deck).

2. **Given** I am authenticated and click "Tester",
   **When** navigation occurs,
   **Then** I am routed to `/decks/:id/simulator`
   **And** `SimulatorPageComponent` loads with `BoardStateService` and `CommandStackService` provided via component-level `providers: []`
   **And** the deck ID is extracted from `ActivatedRoute` params.

3. **Given** I am not authenticated,
   **When** I try to access `/decks/:id/simulator` directly,
   **Then** I am redirected by the existing `AuthService` `canActivate` guard (no new auth logic).

4. **Given** the `SimulatorPageComponent` is scaffolded,
   **When** the simulator files are created,
   **Then** `simulator.models.ts` is created with:
   - `ZoneId` enum with exactly 18 values: `HAND`, `MONSTER_1` through `MONSTER_5`, `SPELL_TRAP_1` through `SPELL_TRAP_5`, `EXTRA_MONSTER_L`, `EXTRA_MONSTER_R`, `FIELD_SPELL`, `MAIN_DECK`, `EXTRA_DECK`, `GRAVEYARD`, `BANISH`
   - `CardInstance` interface containing: `instanceId: string`, `card: CardDetail`, `image: CardImageDTO` (selected from `cardDetail.images[0]` at creation time), `faceDown: boolean`, `position: 'ATK' | 'DEF'`, `overlayMaterials?: CardInstance[]`
   - `SimCommand` interface with `execute(): void` and `undo(): void`
   - `ZONE_CONFIG` constant mapping each `ZoneId` to `{ type: 'single' | 'ordered' | 'stack', label: string }` with English Yu-Gi-Oh! labels (e.g., "Monster Zone 1", "Graveyard")

5. **Given** `BoardStateService` is created,
   **When** it is instantiated within `SimulatorPageComponent` providers,
   **Then** it exposes:
   - `boardState: WritableSignal<Record<ZoneId, CardInstance[]>>` initialized with empty arrays for all 18 zones — public writable (commands in `CommandStackService` call `boardState.update()` directly; convention-enforced, not compile-enforced)
   - Computed signals per zone (e.g., `hand = computed(() => this.boardState()[ZoneId.HAND])`)
   - `hoveredCard: WritableSignal<CardInstance | null>` initialized to `null` (50ms debounce logic deferred to Story 3.2)
   - `isDragging: WritableSignal<boolean>` initialized to `false`

6. **Given** `CommandStackService` is created,
   **When** it is instantiated within `SimulatorPageComponent` providers,
   **Then** it exposes:
   - `undoStack: Signal<SimCommand[]>` (read-only, initialized empty)
   - `redoStack: Signal<SimCommand[]>` (read-only, initialized empty)
   - `canUndo: Signal<boolean>` computed from `undoStack.length > 0`
   - `canRedo: Signal<boolean>` computed from `redoStack.length > 0`
   - Shell methods: `undo()`, `redo()` (functional but no commands to process yet)
   **And** it injects `BoardStateService` internally.

7. **Given** the simulator page renders,
   **When** I see the page,
   **Then** a placeholder text "Simulator — Deck :id" (showing actual deck id) confirms the scaffold is working
   **And** the page uses `ChangeDetectionStrategy.OnPush`
   **And** the component selector is `app-sim-page`.

## Tasks / Subtasks

- [x] **Task 1: Create simulator models** (AC: 4)
  - [x] 1.1: Create `front/src/app/pages/simulator/simulator.models.ts`
  - [x] 1.2: Define `ZoneId` enum with 18 values (NOT 20 — no separate PENDULUM_L/R)
  - [x] 1.3: Define `CardInstance` interface referencing existing `CardDetail` and `CardImageDTO`
  - [x] 1.4: Define `SimCommand` interface with `execute()` and `undo()`
  - [x] 1.5: Define `ZONE_CONFIG` constant mapping each `ZoneId` to its behavior: `{ type: 'single' | 'ordered' | 'stack', label: string }`

- [x] **Task 2: Create BoardStateService shell** (AC: 5)
  - [x] 2.1: Create `front/src/app/pages/simulator/board-state.service.ts`
  - [x] 2.2: Declare `boardState` as public writable signal with `Record<ZoneId, CardInstance[]>` — initialize all 18 zones with `[]` (public writable so commands can call `.update()`)
  - [x] 2.3: Add computed signals for each zone (hand, monster1-5, spellTrap1-5, extraMonsterL/R, fieldSpell, mainDeck, extraDeck, graveyard, banish)
  - [x] 2.4: Add boolean computed signals: `isDeckEmpty`, `isExtraDeckEmpty`
  - [x] 2.5: Add `hoveredCard` signal (writable, null initial) and `isDragging` signal (writable, false initial)
  - [x] 2.6: Use `@Injectable()` WITHOUT `providedIn` — the service is provided by the component, not root

- [x] **Task 3: Create CommandStackService shell** (AC: 6)
  - [x] 3.1: Create `front/src/app/pages/simulator/command-stack.service.ts`
  - [x] 3.2: Inject `BoardStateService` in constructor
  - [x] 3.3: Declare private `_undoStack` and `_redoStack` writable signals, expose read-only `undoStack` / `redoStack`
  - [x] 3.4: Add `canUndo` and `canRedo` computed signals
  - [x] 3.5: Add shell `undo()` and `redo()` methods (pop/push logic, but no commands to process yet)
  - [x] 3.6: Use `@Injectable()` WITHOUT `providedIn` — the service is provided by the component, not root

- [x] **Task 4: Create SimulatorPageComponent** (AC: 2, 7)
  - [x] 4.1: Create `front/src/app/pages/simulator/simulator-page.component.ts` (standalone, OnPush)
  - [x] 4.2: Set selector to `app-sim-page`
  - [x] 4.3: Add `providers: [BoardStateService, CommandStackService]` on component decorator
  - [x] 4.4: Inject `ActivatedRoute`, extract deck `id` from route params
  - [x] 4.5: Create `.html` with placeholder: deck ID display confirming scaffold works
  - [x] 4.6: Create `.scss` — minimal, import `_sim-tokens.scss` (empty file for now, tokens come in Story 1.2)

- [x] **Task 5: Register route** (AC: 2, 3)
  - [x] 5.1: In `front/src/app/app.routes.ts`, add route `{ path: 'decks/:id/simulator', component: SimulatorPageComponent, canActivate: [AuthService] }`
  - [x] 5.2: Place the route BEFORE `decks/:id` to follow the more-specific-first convention
  - [x] 5.3: Add import for `SimulatorPageComponent`

- [x] **Task 6: Add "Tester" button to DeckBuilderComponent** (AC: 1)
  - [x] 6.1: In `deck-builder.component.html`, add a `mat-icon-button` with icon `sports_esports` in the toolbar div (`.deckBuilder-side-tools-buttons`), alongside the existing hand test button
  - [x] 6.2: Inject `Router` in `DeckBuilderComponent` if not already injected
  - [x] 6.3: Button navigates to `/decks/${deck.id}/simulator` via `Router.navigate()`
  - [x] 6.4: Disable button when `deck().id` is undefined/null (unsaved deck)
  - [x] 6.5: Add `title="Tester les combos"` for hover tooltip

- [x] **Task 7: Create _sim-tokens.scss placeholder** (AC: 7)
  - [x] 7.1: Create `front/src/app/pages/simulator/_sim-tokens.scss` as empty file with comment `// Simulator SCSS tokens — populated in Story 1.2`

## Dev Notes

### Critical Architecture Constraints

- **Services scoped to component, NOT root.** `BoardStateService` and `CommandStackService` use `@Injectable()` without `providedIn`. They are instantiated via `providers: [BoardStateService, CommandStackService]` on `SimulatorPageComponent`. This is a documented exception — simulation state is ephemeral and must be fresh on each navigation. [Source: architecture.md#Service Scoping Decision]
- **18 zones, NOT 20.** `SPELL_TRAP_1` doubles as Pendulum Left, `SPELL_TRAP_5` doubles as Pendulum Right (Master Rule 5). Do NOT create separate `PENDULUM_L` / `PENDULUM_R` enum values. [Source: architecture.md#Zone Identification]
- **`overlayMaterials` on CardInstance from day 1.** Even though XYZ mechanics are in Epic 4, the data model must include `overlayMaterials?: CardInstance[]` now to avoid a breaking data model change later. [Source: epics.md#Story 1.1 AC]
- **Zero direct board state mutation.** Components never call `boardState.update()` directly — all state changes go through `CommandStackService`. This story creates the shells; the enforcement begins in Story 2.1. [Source: architecture.md#Action Flow Pattern]
- **Component selectors use `app-sim-` prefix.** This avoids collision with existing components like `app-card`. [Source: architecture.md#Naming Conventions]

### Existing Code Integration Points

- **`DeckBuildService.getById(id: number): Observable<Deck>`** — Used to load deck data. Returns `Deck` containing `mainDeck: Array<IndexedCardDetail>` and `extraDeck: Array<IndexedCardDetail>`. The simulator page will call this to load the deck. Deck loading logic itself is Story 1.3 — this story only scaffolds. [Source: `front/src/app/services/deck-build.service.ts:91`]
- **`AuthService`** — Implements `canActivate()`. Used as route guard, no changes needed. [Source: `front/src/app/services/auth.service.ts`]
- **`CardDetail`** — Contains `card: Card`, `images: Array<CardImageDTO>`, `favorite: boolean`. The `CardInstance` interface wraps this with simulator state (`faceDown`, `position`, `overlayMaterials`). [Source: `front/src/app/core/model/card-detail.ts`]
- **`CardImageDTO`** — Contains `url: string` and `smallUrl: string`. The simulator will use `smallUrl` for board cards and `url` for the inspector. [Source: `front/src/app/core/model/dto/card-image-dto.ts`]
- **Existing `CardType` enum** — Contains `MONSTER`, `SPELL`, `TRAP`, `FUSION`, `SYNCHRO`, `XYZ`, `LINK`, `PENDULUM`. Used to determine card behavior (e.g., `extraCard` flag). [Source: `front/src/app/core/enums/card-type.enum.ts`]

### Route Ordering

The route `decks/:id/simulator` has 3 segments while `decks/:id` has 2. Angular matches based on segment count, so there is no actual conflict. However, place the simulator route BEFORE `decks/:id` in `app.routes.ts` to follow the convention of more-specific routes first:

```typescript
{ path: 'decks/builder', component: DeckBuilderComponent, canActivate: [AuthService] },
{ path: 'decks/:id/simulator', component: SimulatorPageComponent, canActivate: [AuthService] },  // NEW
{ path: 'decks/:id', component: DeckBuilderComponent, canActivate: [AuthService] },
```

### Signal Pattern Reference

**BoardStateService — public writable** (commands need `.update()` access):
```typescript
// Public writable — commands in CommandStackService call boardState.update() directly
// Convention-enforced: only commands mutate, never components
readonly boardState = signal<Record<ZoneId, CardInstance[]>>(initialState);

// Computed per zone — derived from boardState
readonly hand = computed(() => this.boardState()[ZoneId.HAND]);
readonly graveyard = computed(() => this.boardState()[ZoneId.GRAVEYARD]);
readonly isDeckEmpty = computed(() => this.boardState()[ZoneId.MAIN_DECK].length === 0);
```

**CommandStackService — private writable, public readonly** (components only read stacks):
```typescript
private readonly _undoStack = signal<SimCommand[]>([]);
readonly undoStack = this._undoStack.asReadonly();
readonly canUndo = computed(() => this.undoStack().length > 0);
```

**Rationale:** `boardState` is public writable because commands (internal to `CommandStackService`) call `this.boardStateService.boardState.update(...)`. This aligns with architecture.md: "Commands receive a reference to the BoardStateService to perform mutations via `boardState.update()`". The undo/redo stacks use private/readonly because only `CommandStackService` manages them internally. [Source: architecture.md#Action Flow Pattern]

### Manual Verification Steps

1. `ng build` completes without errors
2. `ng serve` → navigate to `/decks/1/simulator` while authenticated → placeholder page displays "Simulator — Deck 1"
3. Navigate to `/decks/1/simulator` while NOT authenticated → redirected to login
4. On DeckBuilderComponent with a saved deck → "Tester" button visible and enabled → click navigates to simulator
5. On DeckBuilderComponent with an unsaved deck (no id) → "Tester" button visible but disabled
6. Open browser DevTools → verify no console errors on simulator page load

### Edge Cases (Documented, Not In Scope)

- **Invalid deck ID** (NaN, non-numeric string): Handled in Story 1.3 (deck loading). This story only extracts the raw route param and displays it as placeholder text — no crash expected.

### What This Story Does NOT Include

- No CSS Grid board layout (Story 1.2)
- No SCSS tokens beyond placeholder (Story 1.2)
- No deck loading / shuffle / draw logic (Story 1.3)
- No card rendering components (Story 1.2)
- No drag & drop (Story 2.2)
- No command classes (Story 2.1)

### Project Structure Notes

Files created by this story:
```
front/src/app/
  pages/
    simulator/                          # NEW directory
      simulator-page.component.ts       # NEW — page container
      simulator-page.component.html     # NEW — placeholder
      simulator-page.component.scss     # NEW — minimal
      simulator.models.ts               # NEW — ZoneId, CardInstance, SimCommand
      board-state.service.ts            # NEW — state signal + computed
      command-stack.service.ts          # NEW — undo/redo shell
      _sim-tokens.scss                  # NEW — empty placeholder
```

Files modified by this story:
```
front/src/app/
  app.routes.ts                                                 # ADD route
  pages/deck-page/components/deck-builder/
    deck-builder.component.html                                 # ADD "Tester" button
    deck-builder.component.ts                                   # ADD Router import + navigate method
```

### References

- [Source: architecture.md#Core Architectural Decisions] — Data model, ZoneId, command pattern
- [Source: architecture.md#Project Structure & Boundaries] — Directory structure, naming
- [Source: architecture.md#Service Responsibility Boundaries] — BoardStateService vs CommandStackService
- [Source: architecture.md#Service Scoping Decision] — providers on component, not root
- [Source: ux-design-specification.md#Board Layout (Corrected)] — 18 zones, grid areas
- [Source: ux-design-specification.md#Design System Foundation] — SCSS tokens
- [Source: epics.md#Story 1.1] — Acceptance criteria, user story
- [Source: front/src/app/app.routes.ts] — Current route config
- [Source: front/src/app/services/deck-build.service.ts] — Deck loading, signal patterns
- [Source: front/src/app/core/model/card-detail.ts] — CardDetail, IndexedCardDetail models
- [Source: front/src/app/core/model/dto/card-image-dto.ts] — CardImageDTO model

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `ng build --configuration development` passes without TypeScript errors
- `ng build` (production) fails only on pre-existing bundle budget constraints (jspdf/canvg), unrelated to this story

### Completion Notes List

- Created `simulator.models.ts` with `ZoneId` (18 values), `CardInstance`, `SimCommand`, `ZONE_CONFIG`
- Created `BoardStateService` shell with public writable `boardState` signal, 18 computed zone signals, `isDeckEmpty`/`isExtraDeckEmpty`, `hoveredCard`, `isDragging`
- Created `CommandStackService` shell with private `_undoStack`/`_redoStack`, public readonly views, `canUndo`/`canRedo` computed, functional `undo()`/`redo()` methods
- Created `SimulatorPageComponent` (standalone, OnPush, selector `app-sim-page`) with component-level providers, extracting deck ID from `ActivatedRoute`
- Registered route `decks/:id/simulator` before `decks/:id` in `app.routes.ts` with `AuthService` guard
- Added "Tester" button (`sports_esports` icon) to `DeckBuilderComponent` toolbar, disabled when deck has no `id`, navigates to `/decks/:id/simulator`
- Created `_sim-tokens.scss` placeholder

### Change Log

- 2026-02-10: Story 1.1 implemented — simulator page scaffold, models, services, route, and Tester button
- 2026-02-10: Code Review (AI) — 8 issues found (1H, 4M, 3L), all fixed:
  - H1: Fixed undo/redo operation ordering — execute command before updating stacks (command-stack.service.ts)
  - M1: Added CSS class to Tester icon for toolbar consistency (deck-builder.component.html)
  - M2+M3: Replaced snapshot with reactive toSignal + number type for deckId (simulator-page.component.ts)
  - M4: Added runtime guard in navigateToSimulator() (deck-builder.component.ts)
  - L1: Replaced deprecated @import with @use in SCSS (simulator-page.component.scss)
  - L2: Added pendulum metadata to ZONE_CONFIG for ST1/ST5 (simulator.models.ts)
  - L3: Deleted nul artifact file from repo root

### File List

New files:
- `front/src/app/pages/simulator/simulator.models.ts`
- `front/src/app/pages/simulator/board-state.service.ts`
- `front/src/app/pages/simulator/command-stack.service.ts`
- `front/src/app/pages/simulator/simulator-page.component.ts`
- `front/src/app/pages/simulator/simulator-page.component.html`
- `front/src/app/pages/simulator/simulator-page.component.scss`
- `front/src/app/pages/simulator/_sim-tokens.scss`

Modified files:
- `front/src/app/app.routes.ts` — added simulator route
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts` — added Router import, navigateToSimulator()
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html` — added "Tester" button
