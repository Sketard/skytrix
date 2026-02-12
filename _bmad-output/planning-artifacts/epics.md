---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: ['prd.md', 'architecture.md', 'ux-design-specification.md', 'yugioh-game-rules.md', 'implementation-readiness-report-2026-02-12.md']
context: 'Post-IR update — aligning epics with revised UX spec (2026-02-12). Correcting E1-E5 divergences, adding E6-E7 new requirements.'
---

# skytrix - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for skytrix, decomposing the requirements from the PRD, UX Design Specification, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: The player can launch a simulation from any existing decklist
- FR2: The system loads main deck cards into the main deck zone and extra deck cards into the extra deck zone
- FR3: The player can shuffle the main deck
- FR4: The system draws an initial hand of 5 cards from the top of the shuffled deck
- FR5: The player can shuffle the deck at any point during the simulation
- FR6: The player can move a card from any zone to any other zone via drag & drop
- FR7: The player can reorder cards within the hand zone
- FR8: The system enforces zone capacity (single-card zones accept only one card; no card replacement — player must clear zone first)
- FR9: All 18 physical game zones are available: hand, monster (1-5), spell/trap (1-5 — ST1/ST5 double as Pendulum L/R per Master Rule 5), Extra Monster (L/R), field spell, graveyard, banish, extra deck, main deck
- FR10: The player can see visual feedback on drop zones during drag (cyan highlight on valid zones, no reaction on occupied/invalid zones)
- FR11: The player can draw one or more cards from the top of the deck to the hand
- FR12: The player can summon or set a card from hand to a monster zone
- FR13: The player can activate a card (move from hand to a spell/trap zone or field spell zone)
- FR14: The player can send any card on the board or in hand to the graveyard
- FR15: The player can banish any card on the board, in hand, or in the graveyard
- FR16: The player can return any card from any zone to the hand
- FR17: The player can return any card from any zone to the top or bottom of the deck
- FR18: The player can search the deck (view all cards) and pick a specific card to add to hand or another zone
- FR19: The player can mill a specified number of cards (send top N from deck to graveyard)
- FR20: The player can reveal/excavate the top N cards of the deck in a popup overlay for inspection, then return them or move them to other zones
- FR21: The system prevents drawing when the deck is empty and provides visual feedback
- FR22: The player can view the full contents of any stacked zone (deck, graveyard, banish, extra deck) in an overlay
- FR23: The player can select and move a specific card from any stacked zone to another zone
- FR24: The player can see the card count for each stacked zone without opening it
- FR25: The player can set a card face-down (displaying card back) via right-click context menu
- FR26: The player can flip a face-down card face-up via right-click context menu
- FR27: The player can toggle a monster's battle position (ATK/DEF) via right-click context menu
- FR28: The player can view card details (enlarged image and effect text) by hovering over any card via the SimCardInspectorComponent side panel. Face-down cards: inspector shows full card details (solo context — player knows all own cards). Face-down is a positional state, not an information barrier.
- FR29: The player can undo the last action performed (board state only — does not restore UI state like overlays)
- FR30: The player can redo a previously undone action
- FR31: The player can undo/redo batch operations as a single unit (e.g., mill 3 undoes all 3 card moves at once)
- FR32: The player can perform common actions via keyboard shortcuts (Ctrl+Z undo, Ctrl+Y redo, Escape close overlay). No keyboard shortcut for Reset.
- FR33: The player can reset the entire board to the initial state (re-shuffle and re-draw) via button with confirmation
- FR34: The simulator is accessible only to authenticated users from the deck detail page

### NonFunctional Requirements

- NFR1: Drag & drop interactions render within a single animation frame (<16ms) with no visible jank
- NFR2: Board state updates (card moved, flipped, position toggled) reflect visually within 100ms
- NFR3: Board reset completes in under 1 second including re-shuffle and re-draw
- NFR4: The simulator remains responsive with a full board state (20+ cards across zones)
- NFR5: Card inspector panel appears within 200ms of hover (with 50ms debounce on hoveredCard signal)
- NFR6: Zone overlays (deck search, graveyard view) open within 300ms regardless of card count
- NFR7: The simulator route is protected by existing authentication — unauthenticated users cannot access it
- NFR8: No card data or simulation state is transmitted to the backend — all processing remains client-side
- NFR9: The simulator functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions)
- NFR10: The simulator integrates with the existing skytrix build and deployment pipeline without additional configuration

### Additional Requirements

**From Architecture:**
- Brownfield project — no starter template, extend existing Angular 19 SPA
- 18 physical zones with ZoneId enum (ST1/ST5 double as Pendulum L/R)
- Hybrid zone-centric data model: `Record<ZoneId, CardInstance[]>`
- 6 delta-based command types + CompositeCommand for undo/redo
- 2 services only: BoardStateService (state + computed) + CommandStackService (actions + undo/redo)
- Services scoped to SimulatorPageComponent via `providers` (not `providedIn: 'root'`)
- Zero direct board state mutation — all changes through CommandStackService canonical action flow
- Component selectors with `app-sim-` prefix
- Route `/decks/:id/simulator` in `app.routes.ts`
- Complete directory structure under `pages/simulator/`
- Debug panel dev-only behind `isDevMode()`
- Reset is NOT a command — clears both stacks, reinitializes board

**From UX Design Specification (revised 2026-02-12):**
- SimCardInspectorComponent: hover-triggered fixed side panel (dark theme, scrollable effect text, no deck-building buttons)
- Face-down cards: inspector shows **full card details** (solo context — player knows all own cards). Face-down is a positional state, not an information barrier
- Card State Toggle: right-click `mat-menu` on board cards (Flip face-down, Change to DEF/ATK — dynamic items based on current state)
- Context menu on Deck/ED: `mat-menu` (Shuffle, Search / View)
- `event.preventDefault()` on `contextmenu` event on the **entire board** in **all builds** (including `isDevMode()`). Native browser context menu never shown on the board. Navbar retains native context menu
- Gold glow feedback: CSS `@keyframes` + `.zone--just-dropped` class (pure CSS, no Angular signal)
- Pile overlay auto-close: opening new overlay closes current one (max 1 visible)
- Pile overlay stays open during drag-from-overlay (closes after drop if user navigates away)
- Empty stacked zone click: opens empty overlay with "No cards in [zone name]" message
- Empty hand: dashed border only, no placeholder text
- `hoveredCard` signal with 50ms debounce in BoardStateService
- `isDragging` global signal suppresses inspector/pills/overlays during drag
- Inspector repositioning: computed signal moves panel to left when pile overlay is on right — fixed side panel at all viewport sizes
- `cdkDragPreviewContainer: 'global'` for correct z-index when dragging from overlays
- No card replacement on occupied single-card zones — must clear zone first
- Undo scope: board state only (not UI state like overlays/inspector)
- No keyboard shortcut for Reset — button only (Ctrl+Shift+R conflicts with browser)
- **Fixed 16:9 aspect ratio layout** with `transform: scale()` proportional scaling — no breakpoints, no responsive layout changes. Board never scrolls, never changes grid structure, never hides zones. Scale factor = `min(availableWidth / boardWidth, availableHeight / boardHeight)`. Centered with letterboxing
- Board rescales dynamically on navbar toggle (available viewport space changes)
- **Collapsible navbar (vertical sidebar):** chevron toggle at navbar border (← collapse, → expand), collapsed by default on simulator page only, ~32px **width** thin bar when collapsed (no logo, no links — just toggle control). Expanded by default on all other pages. Ephemeral state (not persisted)
- Mobile (post-MVP): landscape-locked, same 16:9 scaling model, tap-to-place designed separately
- Deck zone: card-back image when `count > 0` (never appears visually empty)
- **Extra Deck overlay:** all cards displayed **face-up**, no grouping, no eye icon (solo context — ED contents known to owner)
- **ED "View" mode:** right-click ED → "View" opens pile overlay in browse mode (all cards face-up)
- **No auto-shuffle:** deck search does NOT auto-shuffle on close — shuffling is the player's manual responsibility (right-click Deck → Shuffle)
- `prefers-reduced-motion` support (disable glow, scale, CDK drag transitions)
- Dev-only reduced-motion toggle in SimControlBarComponent
- Visual regression tests: Playwright screenshots at 3 viewport widths (1280, 1100, 800)
- Dual-accent color system: Cyan #00d4ff (interaction) + Gold #d4a017 (status)
- Master Duel Classic visual direction (dark atmospheric board)
- XYZ overlay material mechanics: borders peeking, click for pill, drag to detach
- Overlay z-index hierarchy: drag preview > context menus > pile overlays > inspector > board
- `cdkDropListGroup` on SimBoardComponent root — all drop lists as children

### FR Coverage Map

| FR | Epic | Description |
|---|---|---|
| FR1 | Epic 1 | Launch simulation from decklist |
| FR2 | Epic 1 | Load main deck + extra deck into zones |
| FR3 | Epic 1 | Shuffle main deck |
| FR4 | Epic 1 | Draw initial hand of 5 |
| FR9 | Epic 1 | All 18 physical game zones available |
| FR24 | Epic 1 | Card count badges on stacked zones |
| FR34 | Epic 1 | Auth-only access from deck detail page |
| FR5 | Epic 2 | Shuffle deck at any time |
| FR6 | Epic 2 | Drag & drop between any zones |
| FR7 | Epic 2 | Reorder cards within hand |
| FR8 | Epic 2 | Zone capacity enforcement (no replacement) |
| FR10 | Epic 2 | Visual feedback on drop zones during drag |
| FR11 | Epic 2 | Draw from deck to hand |
| FR12 | Epic 2 | Summon/set from hand to monster zone |
| FR13 | Epic 2 | Activate card to S/T or field zone |
| FR14 | Epic 2 | Send card to graveyard |
| FR15 | Epic 2 | Banish card |
| FR16 | Epic 2 | Return card to hand |
| FR17 | Epic 2 | Return card to deck |
| FR21 | Epic 2 | Empty deck prevention + visual feedback |
| FR25 | Epic 3 | Set card face-down via context menu |
| FR26 | Epic 3 | Flip face-down card face-up via context menu |
| FR27 | Epic 3 | Toggle ATK/DEF position via context menu |
| FR28 | Epic 3 + Epic 6 | Card inspector on hover (all cards). Epic 6 corrects face-down behavior |
| FR18 | Epic 4 | Search deck and pick card |
| FR19 | Epic 4 | Mill top N cards to GY |
| FR20 | Epic 4 | Reveal/excavate top N cards |
| FR22 | Epic 4 | View stacked zone contents in overlay |
| FR23 | Epic 4 | Pick and move card from stacked zone |
| FR29 | Epic 5 | Undo last action |
| FR30 | Epic 5 | Redo undone action |
| FR31 | Epic 5 | Batch undo/redo (CompositeCommand) |
| FR32 | Epic 5 | Keyboard shortcuts (Ctrl+Z, Ctrl+Y, Escape) |
| FR33 | Epic 5 | Reset board with confirmation |

## Epic List

### Epic 1: Simulator Board & Deck Loading

The player can navigate to the simulator from a decklist, see the complete 18-zone board rendered in CSS Grid with card count badges on stacked zones, load their deck, shuffle, and receive an initial hand of 5 cards.

**FRs covered:** FR1, FR2, FR3, FR4, FR9, FR24, FR34

**Implementation Notes:**
- Story 1.1 = scaffold technique: create SimulatorPageComponent, register route `/decks/:id/simulator`, configure providers (BoardStateService + CommandStackService scoped to component)
- 7×4 CSS Grid with named areas matching official Yu-Gi-Oh! playmat layout
- BoardStateService with `boardState` signal + computed derivations per zone
- `mat-badge` card count on Deck, ED, GY, Banished zones — visible from initial load
- Standalone: delivers a visible, loaded board

### Epic 2: Card Movement & Drag-Drop System

The player can move cards between all zones via drag & drop with visual feedback. All card actions (summon, activate, send to GY, banish, return to hand/deck) are performed via drag. Hand reordering supported. Empty deck draw prevention.

**FRs covered:** FR5, FR6, FR7, FR8, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR21

**Implementation Notes:**
- CommandStackService infrastructure created here — `execute()` method, all command classes (MoveCardCommand, DrawCardCommand, ShuffleCommand, ReorderHandCommand). Undo/redo stacks fill silently but are not yet exposed to user.
- CDK DragDrop with `cdkDropListGroup` on SimBoardComponent root
- `cdkDropListSortingDisabled: true` on single-card zones, `false` on hand
- `cdkDropListEnterPredicate` rejects drop on occupied single-card zones (no card replacement)
- Gold glow feedback: CSS `@keyframes` + `.zone--just-dropped` class
- Context menu on Deck with "Shuffle" only (Search, Mill (N), Reveal (N) added in Epic 4)
- `isDragging` signal suppresses pills during drag
- FR12-17 are all drag & drop (FR6) applied to different zone pairs — same implementation, different source/target

### Epic 3: Card State & Effect Reading

The player can manage card states (face-down, flip face-up, ATK/DEF position toggle) via right-click context menu on board cards, and read card effects via the hover-triggered inspector side panel.

**FRs covered:** FR25, FR26, FR27, FR28

**Implementation Notes:**
- SimCardInspectorComponent: fixed side panel, `hoveredCard` signal with 50ms debounce, dark theme, scrollable effect text, no deck-building buttons
- Card State Toggle: right-click `mat-menu` on SimCardComponent (board only). Dynamic menu items based on current card state.
- FlipCardCommand + TogglePositionCommand added to CommandStackService
- Face-down cards: inspector shows **full card details** (solo context — positional state, not information barrier)
- `event.preventDefault()` on contextmenu on **entire board** in **all builds** (including `isDevMode()`). Navbar retains native context menu

### Epic 4: Zone Inspection & Deck Operations

The player can browse stacked zone contents in overlays, search the deck and pick cards, mill top N cards to GY, and reveal/excavate top N cards for inspection. Cards are draggable from overlays to the board.

**FRs covered:** FR18, FR19, FR20, FR22, FR23

**Implementation Notes:**
- SimPileOverlayComponent with 3 modes: browse (GY, Banish), search (Deck), reveal (Deck top N)
- Context menu on Deck: extends existing `mat-menu` from Epic 2 — adds "Search", "Mill (N)", and "Reveal (N)" items. Mill (N) uses `executeBatch()` for CompositeCommand wrapping.
- SimXyzMaterialPeekComponent: material borders peeking, click for pill, drag to detach
- `cdkDragPreviewContainer: 'global'` for correct z-index when dragging from overlays
- Pile overlay auto-close when new one opens; stays open during drag-from-overlay
- Empty stacked zone click opens empty overlay with "No cards in [zone name]" message
- Inspector repositioning: computed signal moves panel to left when pile overlay on right

### Epic 5: Undo/Redo & Session Control

The player can undo and redo card actions, batch undo composite operations (e.g., mill 3), reset the board to initial state, and use keyboard shortcuts for common actions.

**FRs covered:** FR29, FR30, FR31, FR32, FR33

**Implementation Notes:**
- Exposes the undo/redo stack already populated since Epic 2 — `undo()` and `redo()` methods on CommandStackService
- SimControlBarComponent: Undo, Redo, Reset buttons in controls grid area
- CompositeCommand for batch undo/redo (mill N = N MoveCardCommands wrapped)
- Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Y (redo), Escape (close overlay). No shortcut for Reset.
- Reset is NOT a command — clears both stacks, reinitializes board state with confirmation dialog
- Undo scope: board state only (does not restore overlay/inspector UI state)

### Epic 6: Post-Retro UX Alignment

The player benefits from a board with a fixed 16:9 layout that scales proportionally, a collapsible navbar to maximize board space, a functional context menu in dev mode, an inspector that shows full details for face-down cards, and a View mode for the Extra Deck.

**FRs covered:** FR28 (correction — face-down inspector behavior), + post-retro UX requirements (E1-E7)

**Implementation Notes:**
- Story 6.1: Fixed 16:9 layout + `transform: scale()` — HIGH impact, CSS refactor of entire board. Removes 3 breakpoints, replaces with single scale factor. `min(availableWidth / boardWidth, availableHeight / boardHeight)`, centered with letterboxing. Board rescales on navbar toggle.
- Story 6.2: Face-down rendering fixes (4 fixes) — MEDIUM impact, multi-component. Card-back on board, inspector full details, ED overlay all face-up (no grouping/eye icon), deck/ED visual when count > 0.
- Story 6.3: Board-wide `preventDefault` in all builds — LOW impact, quick fix. Remove `isDevMode()` guard from `contextmenu` handler on board. Navbar retains native context menu.
- Story 6.4: Collapsible navbar — MEDIUM impact. Chevron toggle at navbar border, collapsed by default on simulator page (~32px thin bar). Board recalculates scale factor on toggle. Ephemeral state.
- Epic 6 is standalone — builds on implemented Epics 1-5, requires no future epics to function.

## Epic 1: Simulator Board & Deck Loading

The player can navigate to the simulator from a decklist, see the complete 18-zone board rendered in CSS Grid with card count badges on stacked zones, load their deck, shuffle, and receive an initial hand of 5 cards.

### Story 1.1: Simulator Page Scaffold & Route

As a player,
I want to click "Tester" on my deck detail page and navigate to the simulator,
So that I can access the combo testing tool from my existing workflow.

**Acceptance Criteria:**

**Given** I am on the existing deck detail page
**When** the page renders
**Then** a "Tester" button is visible that links to `/decks/:id/simulator`

**Given** I am authenticated and click "Tester"
**When** navigation occurs
**Then** SimulatorPageComponent loads with BoardStateService and CommandStackService provided via component-level `providers`
**And** the deck ID is extracted from route params

**Given** I am not authenticated
**When** I try to access `/decks/:id/simulator`
**Then** I am redirected by the existing AuthService guard

**Given** the SimulatorPageComponent is scaffolded
**When** the module is created
**Then** `simulator.models.ts` is created with `ZoneId` enum (18 values: HAND, MONSTER_1-5, SPELL_TRAP_1-5, EXTRA_MONSTER_L/R, FIELD_SPELL, MAIN_DECK, EXTRA_DECK, GRAVEYARD, BANISH), `CardInstance` interface (including optional `overlayMaterials: CardInstance[]` for XYZ material tracking), and `SimCommand` interface

### Story 1.2: Render 18-Zone Board with Components

As a player,
I want to see the complete Yu-Gi-Oh! game board with all 18 zones and card rendering infrastructure,
So that the visual playmat is ready for card operations.

**Acceptance Criteria:**

**Given** the SimulatorPageComponent is loaded
**When** the board renders
**Then** a 7×4 CSS Grid displays all 18 zones using named `grid-template-areas`:
- Row 1: EMZ-L, EMZ-R, Banished (+ 4 empty cells)
- Row 2: Field, M1-M5, GY
- Row 3: ED, ST1-ST5, Deck
- Row 4: Controls area, Hand (5 cols)

**Given** the board is rendered
**When** I look at stacked zones (Deck, ED, GY, Banished)
**Then** each displays a `mat-badge` with card count (initially 0)

**Given** the board is rendered
**When** I look at the hand zone
**Then** it shows a dashed border (empty state)

**Given** a `_sim-tokens.scss` file is created
**When** any simulator component imports it
**Then** all SCSS variables are available (`$sim-bg`, `$sim-surface`, `$sim-surface-elevated`, `$sim-accent-primary`, `$sim-accent-secondary`, `$sim-zone-border`, `$sim-zone-highlight`, `$sim-zone-glow-success`, `$sim-text-primary`, `$sim-text-secondary`, `$sim-overlay-backdrop`, etc.)

**Given** a `CardInstance` is provided to `SimCardComponent`
**When** the component renders
**Then** it displays the card image face-up using the existing card image service
**And** all simulator component selectors use the `app-sim-` prefix

### Story 1.3: Load Deck, Shuffle & Draw Initial Hand

As a player,
I want my deck to be automatically loaded, shuffled, and dealt when I enter the simulator,
So that I can immediately start testing combos without manual setup.

**Acceptance Criteria:**

**Given** the simulator page loads with a valid deck ID
**When** deck data is fetched from the existing deck service
**Then** main deck cards populate the Deck zone and extra deck cards populate the ED zone
**And** card count badges update reactively (e.g., Deck: 40, ED: 15)

**Given** the deck is loaded
**When** initialization completes
**Then** the main deck is shuffled (client-side Fisher-Yates randomization)
**And** 5 cards are drawn from the top to the hand zone, displayed face-up via SimCardComponent
**And** Deck badge decrements (e.g., 40 → 35)

**Given** a deck ID that returns 404 from the API
**When** the simulator tries to load
**Then** the player is redirected to the deck list page

**Given** a deck with 0 main deck cards (ED only)
**When** the simulator loads
**Then** the board renders with Deck: 0, ED populated, hand empty — no error

## Epic 2: Card Movement & Drag-Drop System

The player can move cards between all zones via drag & drop with visual feedback. All card actions (summon, activate, send to GY, banish, return to hand/deck) are performed via drag. Hand reordering supported. Empty deck draw prevention.

### Story 2.1: Command Stack Infrastructure

As a player,
I want all my card actions to be tracked internally,
So that board state changes are predictable, traceable, and consistent across all interactions.

**Acceptance Criteria:**

**Given** the CommandStackService is created
**When** a semantic method is called (e.g., `moveCard(cardId, fromZone, toZone)`)
**Then** a `MoveCardCommand` is instantiated internally and `execute()` is called
**And** the command mutates `BoardStateService.boardState` via immutable update
**And** the command is pushed onto the `undoStack` signal
**And** the `redoStack` is cleared

**Given** the following command classes are created
**When** each implements the `SimCommand` interface (`execute()`, `undo()`)
**Then** `MoveCardCommand`, `DrawCardCommand`, `ShuffleCommand`, and `ReorderHandCommand` are available
**And** each command stores minimum delta data (cardId, fromZone, toZone, indices) at construction time
**And** components never import or instantiate command classes directly — only CommandStackService exposes semantic methods

### Story 2.2: Drag & Drop Between All Zones

As a player,
I want to grab any card and drag it to any zone on the board,
So that I can perform all card actions (summon, activate, send to GY, banish, return) through a single intuitive gesture.

**Acceptance Criteria:**

**Given** a card (face-up or face-down) is on the board or in hand
**When** I click and hold on the card
**Then** the card lifts (scale 1.05, increased box-shadow) and `isDragging` signal is set to `true`

**Given** I am dragging a card
**When** I hover over valid empty zones
**Then** those zones highlight with `$sim-zone-highlight` (cyan at 0.3 opacity + border intensification)
**And** occupied single-card zones show no reaction (silent rejection, no card replacement)

**Given** I drop a card on a valid empty zone
**When** the drop event fires
**Then** the card snaps into position (<100ms)
**And** a gold glow plays via CSS `@keyframes` + `.zone--just-dropped` class (~400ms fade)
**And** `CommandStackService.moveCard()` is called, creating a `MoveCardCommand`
**And** `isDragging` is set back to `false`

**Given** I drop a card on an invalid or occupied zone
**When** the drop event fires
**Then** the card returns to its origin with smooth animation (CDK default revert)

**Given** all zone components are rendered
**When** the board initializes
**Then** `cdkDropListGroup` is on `SimBoardComponent` root
**And** `cdkDropListSortingDisabled: true` on all single-card zones
**And** `cdkDropListEnterPredicate` rejects drops on occupied single-card zones

**Given** the user's system has `prefers-reduced-motion: reduce` enabled
**When** drag & drop interactions occur
**Then** gold glow animation, card lift scale (1.05), and CDK drag placeholder transitions (`.cdk-drag-placeholder`, `.cdk-drag-animating`) are disabled — cards move instantly without animation

### Story 2.3: Draw, Shuffle & Hand Management

As a player,
I want to draw cards from my deck, shuffle at any time, and reorder my hand,
So that I can manage my resources during combo testing.

**Acceptance Criteria:**

**Given** the deck has cards remaining
**When** I drag the top card of the deck to the hand zone
**Then** the card moves to hand via `CommandStackService.drawCard()`
**And** the deck badge decrements

**Given** the deck has 0 cards
**When** I attempt to drag from the deck
**Then** no drag initiates and the deck zone shows brief visual feedback (subtle shake or highlight)

**Given** I right-click on the Deck zone
**When** the context menu opens
**Then** a `mat-menu` appears with "Shuffle" option
**And** clicking "Shuffle" calls `CommandStackService.shuffleDeck()`
**And** `event.preventDefault()` is applied on the entire board in **all builds** (including `isDevMode()`). Native browser context menu never shown on the board. Navbar retains native context menu.

**Given** I have multiple cards in hand
**When** I drag a card within the hand zone
**Then** the hand reorders via CDK sort animation (`cdkDropListSortingDisabled: false`)
**And** `CommandStackService.reorderHand()` is called with the new order

## Epic 3: Card State & Effect Reading

The player can manage card states (face-down, flip face-up, ATK/DEF position toggle) via right-click context menu on board cards, and read card effects via the hover-triggered inspector side panel.

### Story 3.1: Card State Toggle via Context Menu

As a player,
I want to right-click a card on the board to change its position or flip it face-down,
So that I can simulate set/flip/position changes during combo testing.

**Acceptance Criteria:**

**Given** a face-up ATK position card is on the board
**When** I right-click on it
**Then** a `mat-menu` appears with options: "Flip face-down", "Change to DEF"

**Given** a face-up DEF position card is on the board
**When** I right-click on it
**Then** a `mat-menu` appears with options: "Flip face-down", "Change to ATK"

**Given** a face-down card is on the board
**When** I right-click on it
**Then** a `mat-menu` appears with options: "Flip face-up (ATK)", "Flip face-up (DEF)"

**Given** I select a state change option from the context menu
**When** the action executes
**Then** `CommandStackService.flipCard()` or `CommandStackService.togglePosition()` is called
**And** `FlipCardCommand` or `TogglePositionCommand` is created and executed
**And** the card's visual state updates immediately (rotation for DEF, card back for face-down)

**Given** I right-click a card in the hand or in an overlay
**When** the context menu event fires
**Then** no context menu appears (card state toggle is board-only)

**Given** the board is in any build mode (production or dev)
**When** I right-click anywhere on the board
**Then** `event.preventDefault()` blocks the native context menu in all builds
**And** the navbar retains native browser context menu

### Story 3.2: Card Inspector Panel

As a player,
I want to see full card details (image, stats, effect text) when I hover over a card,
So that I can read card effects without interrupting my combo flow.

**Acceptance Criteria:**

**Given** I hover over any face-up card (board, hand, or overlay)
**When** the `hoveredCard` signal updates (after 50ms debounce)
**Then** the `SimCardInspectorComponent` appears as a fixed panel on the right side of the viewport
**And** it displays: full-size card image, card name, attribute/race/level, ATK/DEF values, full effect text (scrollable)
**And** the panel uses `$sim-surface` background with `$sim-text-primary` for card name and effect text
**And** the panel appears/disappears with a fast fade transition (~100ms)

**Given** I hover over a face-down card
**When** the `hoveredCard` signal updates
**Then** the inspector shows **full card details** (image, name, stats, effect text) — face-down is a positional state, not an information barrier in solo context

**Given** `isDragging` signal is `true`
**When** I am dragging a card
**Then** the inspector panel is hidden regardless of hover state
**And** it reappears when the drag ends

**Given** I move my mouse off all cards
**When** `hoveredCard` signal becomes null (after debounce)
**Then** the inspector panel fades out

**Given** the inspector panel has no deck-building buttons
**When** it renders
**Then** there are no +1/-1 or add/remove buttons — simulator context only

**Given** any viewport size
**When** the inspector renders
**Then** it appears as a fixed side panel (no breakpoint-based drawer variant — board scales proportionally via `transform: scale()`, inspector stays as side panel at all sizes)

## Epic 4: Zone Inspection & Deck Operations

The player can browse stacked zone contents in overlays, search the deck and pick cards, mill top N cards to GY, and reveal/excavate top N cards for inspection. Cards are draggable from overlays to the board.

### Story 4.1: Pile Overlay — Browse Mode

As a player,
I want to click on a stacked zone and see all its cards in a side overlay,
So that I can browse and drag cards from the graveyard, banished pile, or extra deck to the board.

**Acceptance Criteria:**

**Given** I click on a stacked zone (GY, Banished, or ED)
**When** the overlay opens
**Then** a `SimPileOverlayComponent` appears to the side of the board (never centered fullscreen)
**And** it displays all cards in the zone as scrollable rows: card image thumbnail + card name
**And** each card row is a CDK drag source — I can drag any card to a board zone
**And** the overlay opens within 300ms

**Given** I click on the Extra Deck zone
**When** the overlay opens in browse mode
**Then** **all cards are displayed face-up** — no face-down/face-up grouping, no eye icon (solo context — ED contents known to owner)

**Given** I click on the Banished zone and it contains face-down banished cards
**When** the overlay opens in browse mode
**Then** face-down cards are visually distinct (card back image + subtle face-down indicator icon) and displayed in a separate visual group from face-up cards

**Given** a pile overlay is open and I click a different stacked zone
**When** the new overlay opens
**Then** the previous overlay auto-closes (max 1 pile overlay visible at a time)

**Given** I drag a card from the overlay to the board
**When** the drag starts
**Then** the source overlay **stays open** during the drag (allows multi-card operations)
**And** `cdkDragPreviewContainer: 'global'` ensures the drag preview has correct z-index above the overlay

**Given** I click on a stacked zone that has 0 cards
**When** the overlay opens
**Then** it shows a subtle message: "No cards in [zone name]"

**Given** a pile overlay is open on the right side
**When** the SimCardInspectorComponent would appear on the right
**Then** the inspector repositions to the left via computed signal

**Given** I click outside the overlay or press Escape
**When** the dismiss event fires
**Then** the overlay closes

### Story 4.2: Deck Search, Mill & Reveal

As a player,
I want to search my deck for a specific card, mill cards to GY, and reveal top cards,
So that I can simulate search effects, mill effects, and excavate effects during combos.

**Acceptance Criteria:**

**Given** I right-click on the Deck zone
**When** the context menu opens
**Then** the existing `mat-menu` (from Epic 2) now includes "Search", "Mill (N)", and "Reveal (N)" in addition to "Shuffle"

**Given** I click "Search" in the Deck context menu
**When** the overlay opens in search mode
**Then** all remaining deck cards are displayed with image + name
**And** a filter text input is available at the top (`aria-label="Search cards"`)
**And** I can type to filter cards by name
**And** each card is draggable to any board zone or hand
**And** closing the overlay does NOT auto-shuffle the deck — shuffling is the player's responsibility (right-click Deck → Shuffle), consistent with real Yu-Gi-Oh! rules and the full manual control philosophy

**Given** I click "Mill (N)" in the Deck context menu
**When** a prompt asks for the number of cards to mill
**Then** I enter N and `CommandStackService.executeBatch()` wraps N `MoveCardCommand`s (deck top → GY) in a single `CompositeCommand`
**And** N cards move from deck top to GY in sequence, deck and GY badges update
**And** undo reverses all N moves as a single unit

**Given** I click "Reveal (N)" in the Deck context menu
**When** a prompt asks for the number of cards to reveal
**Then** I enter N and the overlay opens showing only the top N cards of the deck
**And** each card can be dragged to a destination zone
**And** cards not moved when the overlay closes are returned to the top of the deck in their original order

**Given** I need to mill cards (send top N from deck to GY)
**When** I drag the top card of the deck to the GY zone
**Then** the card moves via `MoveCardCommand` (repeated for each card milled)

### Story 4.3: XYZ Material Management

As a player,
I want to see overlay materials under my XYZ monsters and detach them when needed,
So that I can simulate XYZ effects that require detaching materials.

**Acceptance Criteria:**

**Given** an XYZ monster is on a board zone with overlay materials attached
**When** I look at the card
**Then** material card borders peek out below the XYZ card (2-3px offset per material, visible card edges)

**Given** I click on an XYZ monster with materials
**When** the material pill opens
**Then** a `SimXyzMaterialPeekComponent` overlay lists all attached materials with image + name
**And** a material count badge is visible

**Given** the material pill is open
**When** I drag a material card from the pill to any board zone (e.g., GY)
**Then** the material detaches from the XYZ monster and moves to the target zone via `MoveCardCommand`
**And** the material pill updates (count decrements, removed card disappears)
**And** the pill shares the `cdkDropListGroup` with the board for cross-container drag

**Given** an XYZ monster has 0 materials remaining
**When** I look at the card
**Then** no material borders peek and clicking does not open the pill

**Given** I drag a non-XYZ card onto a monster zone that already contains an XYZ monster
**When** the drop event fires
**Then** the card is attached as an overlay material: removed from its source zone and added to the XYZ monster's `overlayMaterials` array via `MoveCardCommand`
**And** the material border peek visual updates immediately

## Epic 5: Undo/Redo & Session Control

The player can undo and redo card actions, batch undo composite operations (e.g., mill 3), reset the board to initial state, and use keyboard shortcuts for common actions.

### Story 5.1: Undo, Redo & Batch Operations

As a player,
I want to undo and redo my actions to explore different combo lines,
So that I can try alternative sequences without resetting the entire board.

**Acceptance Criteria:**

**Given** I have performed card actions (moves, flips, position toggles, shuffles)
**When** I click the Undo button in `SimControlBarComponent`
**Then** the last command is popped from `undoStack`, `undo()` is called, and the command is pushed to `redoStack`
**And** the board state reverts to before that action

**Given** I have undone an action
**When** I click the Redo button
**Then** the last command is popped from `redoStack`, `execute()` is called, and the command is pushed to `undoStack`
**And** the board state re-applies that action

**Given** a batch operation is needed (e.g., mill 3 cards from deck to GY)
**When** `CommandStackService.executeBatch(commands: SimCommand[])` is called
**Then** a `CompositeCommand` wraps all sub-commands and executes them sequentially
**And** the CompositeCommand is pushed as a single entry on the `undoStack`
**And** undoing the CompositeCommand undoes all sub-commands in reverse order as a single unit

**Given** the `undoStack` is empty
**When** the Undo button renders
**Then** it is visually disabled (dimmed icon, `aria-disabled="true"`)

**Given** the `redoStack` is empty
**When** the Redo button renders
**Then** it is visually disabled

**Given** I perform a new action after undoing
**When** the new command executes
**Then** the `redoStack` is cleared (redo history lost — standard undo/redo behavior)

**Given** undo is triggered
**When** the board state reverts
**Then** no overlay is re-opened and inspector state is not restored — undo scope is board state only

### Story 5.2: Reset Board & Keyboard Shortcuts

As a player,
I want to reset the board to start fresh and use keyboard shortcuts for speed,
So that I can quickly test another hand without navigating away.

**Acceptance Criteria:**

**Given** I click the Reset button in `SimControlBarComponent`
**When** a confirmation dialog appears
**Then** confirming clears both `undoStack` and `redoStack`, reinitializes the board (re-load deck, re-shuffle, re-draw 5)
**And** the reset completes in under 1 second
**And** Reset is NOT a command — it cannot be undone

**Given** I dismiss the confirmation dialog
**When** I click Cancel
**Then** the board state remains unchanged

**Given** I press `Ctrl+Z` anywhere on the board
**When** the keyboard event fires
**Then** `CommandStackService.undo()` is called (same as clicking Undo button)

**Given** I press `Ctrl+Y` anywhere on the board
**When** the keyboard event fires
**Then** `CommandStackService.redo()` is called

**Given** I press `Escape` anywhere on the board
**When** an overlay or context menu is open
**Then** it closes and focus returns to the triggering zone

**Given** focus is in a text input (e.g., pile overlay search filter)
**When** I press `Ctrl+Z` or other shortcuts
**Then** the shortcut is not captured — default browser behavior applies

**Given** there is no keyboard shortcut for Reset
**When** I look at the SimControlBarComponent
**Then** Undo and Redo buttons show shortcut hints in tooltips (`Ctrl+Z`, `Ctrl+Y`)
**And** Reset button shows no shortcut hint

**Given** all keyboard shortcuts are captured
**When** the board initializes
**Then** shortcuts are registered via `@HostListener('document:keydown')` on `SimBoardComponent`

---

## Epic 6: Post-Retro UX Alignment

> Addresses divergences identified in the Implementation Readiness Report (2026-02-12) between the implemented Epics 1–5 and the revised UX Design Specification. These stories bring the simulator in line with the final UX vision without breaking existing functionality.

**Implementation Notes:**

- Stories are ordered by dependency: layout (6.1) first, then behavioral fixes (6.2, 6.3) that depend on the new layout, then navbar (6.4) which affects scaling inputs.
- Story 6.1 replaces the current responsive breakpoint/`fr`/`minmax()` sizing model with a fixed 16:9 proportional layout using `transform: scale()`. All subsequent stories assume this new layout.
- Story 6.4 interacts with 6.1's scaling model: collapsing/expanding the navbar changes `availableWidth`, triggering a scale recalculation.

### Story 6.1: Fixed 16:9 Board Layout with Proportional Scaling

As a player,
I want the board to always maintain a 16:9 ratio and scale proportionally to fit my viewport,
So that the layout is consistent and predictable regardless of screen size.

**Acceptance Criteria:**

**Given** the simulator page loads
**When** the board renders
**Then** the board has a fixed internal resolution of 1280×720 (16:9) defined in CSS

**Given** the fixed 16:9 board is rendered
**When** the viewport is resized (or navbar toggled)
**Then** a `scaleFactor` is computed: `min(availableWidth / 1280, availableHeight / 720)` where `availableWidth = window.innerWidth - navbarWidth` (if expanded) and `availableHeight = window.innerHeight`
**And** the board is scaled via `transform: scale(scaleFactor)` with `transform-origin: top center`
**And** the board is centered in the remaining space

**Given** the board uses `transform: scale()`
**When** the previous responsive layout code is replaced
**Then** all `fr` units, `minmax()` sizing, and breakpoint-driven layout logic in the board grid are removed and replaced with fixed pixel dimensions inside the 1280×720 coordinate space

**Given** the board is scaled via `transform: scale()`
**When** CDK DragDrop calculates drop coordinates
**Then** the coordinates are correctly mapped from viewport pixels to the board's local coordinate space (divide by `scaleFactor`)
**And** a test is performed at `scaleFactor < 1` (small viewport) to verify drops land on the correct zone

**Given** the board is rendered on a very small viewport (e.g., 800×450)
**When** the scale factor drops below 1
**Then** all zones, cards, and text remain proportionally scaled — no layout breakage

**Given** the board is rendered on a large viewport (e.g., 2560×1440)
**When** the scale factor exceeds 1
**Then** the board scales up proportionally, capped at `scaleFactor = 1` (no upscaling beyond native resolution)

### Story 6.2: Face-Down Card Behavior Fixes (Solo Context)

As a player testing combos solo,
I want face-down cards to behave correctly in all interaction contexts,
So that I can simulate face-down sets, flips, and inspections accurately.

**Acceptance Criteria:**

**Given** a face-down card is on the board
**When** I click on it to open the inspector
**Then** the inspector shows the full card details (name, image, stats, effects) — face-down is a positional state, not an information barrier in solo context

**Given** a face-down card is on the board
**When** I drag it to another zone using CDK DragDrop
**Then** the drag preview shows the card back (not the front)
**And** the card lands in the destination zone still face-down

**Given** cards exist in the Extra Deck zone
**When** I open the ED overlay
**Then** all cards are displayed face-up (full art and details visible)
**And** cards are displayed in a flat list — no grouping by face-up/face-down status

**Given** a face-down card is in a pile zone (GY, Banished)
**When** I open the pile overlay for that zone
**Then** the card is displayed face-up in the overlay (pile overlays always show full card info)

### Story 6.3: preventDefault on Right-Click (All Builds)

As a player,
I want the native browser context menu to be suppressed on the board,
So that right-click interactions (future card actions) are not blocked by the browser.

**Acceptance Criteria:**

**Given** I right-click anywhere inside the `SimBoardComponent`
**When** the `contextmenu` event fires
**Then** `event.preventDefault()` is called and the native context menu does not appear
**And** this behavior applies in ALL builds (development and production) — no `isDevMode()` guard

**Given** I right-click on the navbar (outside `SimBoardComponent`)
**When** the `contextmenu` event fires
**Then** the native browser context menu appears normally (preventDefault is scoped to the board only)

### Story 6.4: Collapsible Navbar (Vertical Sidebar)

As a player,
I want to collapse the navigation sidebar to maximize board space,
So that I can focus on the board during combo testing.

**Acceptance Criteria:**

**Given** the simulator page loads
**When** the navbar renders
**Then** the navbar is a vertical sidebar on the left side of the viewport
**And** it displays the full navigation links (expanded state by default)

**Given** the navbar is expanded
**When** I click the collapse chevron button (←)
**Then** the navbar collapses to a thin vertical bar (~32px width) showing only the expand chevron (→)
**And** navigation links are hidden

**Given** the navbar is collapsed
**When** I click the expand chevron button (→)
**Then** the navbar expands to full width showing all navigation links

**Given** the navbar is toggled (expanded ↔ collapsed)
**When** the navbar width changes
**Then** the board `scaleFactor` is recalculated using the updated `availableWidth = window.innerWidth - navbarWidth`
**And** the board re-scales smoothly (CSS transition on `transform`)

**Given** the simulator page loads (or I navigate back to it)
**When** the navbar initializes
**Then** the navbar starts in **collapsed** state (default for simulator page only — expanded by default on all other pages)
**And** this state is ephemeral (not persisted to localStorage or sessionStorage)

**Given** the navbar is collapsed
**When** I right-click on the collapsed navbar bar
**Then** the native browser context menu appears (navbar is excluded from `preventDefault` scope)

