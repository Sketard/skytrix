---
stepsCompleted: [1, 2, 3, 4, 'step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments: ['prd.md', 'architecture.md', 'ux-design-specification.md', 'yugioh-game-rules.md', 'implementation-readiness-report-2026-02-12.md', 'sprint-change-proposal-2026-02-12.md']
context: 'Post-sprint-change-proposal — adding Epic 7 (Responsive App Shell & Navbar) and Epic 8 (Shared Components & Responsive Card Pages) per approved proposal. Epics 1-6 unchanged (all done).'
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
- NFR9: The application functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions) and modern mobile browsers (Chrome Android, Safari iOS — latest two versions). The simulator locks to landscape orientation on mobile devices.
- NFR10: The simulator integrates with the existing skytrix build and deployment pipeline without additional configuration
- NFR11: Deck management pages (deck list, deck detail, deck builder) are usable on viewports from 375px width (mobile portrait) to 2560px+ (ultrawide desktop) without horizontal scrolling
- NFR12: All interactive elements meet minimum touch target size of 44×44px on mobile viewports

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

**From Sprint Change Proposal (2026-02-12) — Responsive & Shared Components:**
- Responsive two-track strategy: Track A (fixed canvas scaling) for card manipulation pages (simulator, deck builder, card search); Track B (mobile-first responsive CSS) for content pages (deck list, settings, login)
- ScalingContainerDirective: shared autonomous directive extracted from simulator's BoardComponent scaling logic, provides canvas scaling for any Track A page. Measures parent container via ResizeObserver, applies `transform: scale()`. Parent must have explicit height.
- Shared component extraction: CardComponent (`app-sim-card` → `app-card`) and CardInspectorComponent (`app-sim-card-inspector` → `app-card-inspector`) extracted from simulator to `components/` for cross-page reuse
- CardInspectorComponent multi-mode: hover-triggered for simulator, click-triggered or permanently visible for deck builder — mode is an input, not hardcoded
- Harmonization analysis required before extraction: compare existing deck builder card/inspector components with simulator versions, verify selector collision risk (`app-card`), define unified contract
- Simulator must not regress after extraction — manual testing validates
- Navbar responsive: CDK BreakpointObserver at 768px threshold. Desktop (>768px) = collapsible sidebar (existing). Mobile (≤768px) = hamburger icon button in fixed top bar, navbar slides in as drawer overlay
- On Track A pages (mobile): fixed top bar reduces available vertical space — canvas parent must account for header height (`calc(100vh - var(--mobile-header-height))`)
- Shared SCSS infrastructure: `_canvas-scaling.scss` (Track A scaling mixins), `_responsive.scss` (breakpoint variables, responsive mixins)
- Breakpoint source of truth: `$navbar-breakpoint: 768px` in `_responsive.scss`, matched in TS via CDK BreakpointObserver
- Login and Settings pages are simple (form-centric) — can be grouped in a single story
- Deck list page requires fluid grid responsive layout (1→2→3-4 columns by breakpoint)

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
| NFR9 | Epic 7 | Desktop + mobile browser support, landscape lock simulator |
| NFR11 | Epic 7 | Deck management pages responsive 375px–2560px+ |
| NFR12 | Epic 7 + Epic 8 | Touch targets 44×44px minimum on mobile |

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

### Epic 7: Responsive App Shell & Navbar

The application adapts to all viewport sizes. Content pages (deck list, settings, login) use mobile-first responsive CSS. The navbar switches to hamburger/drawer mode on mobile. Shared SCSS infrastructure and ScalingContainerDirective are created as foundation for Track A pages.

**NFRs covered:** NFR9 (updated), NFR11, NFR12 (partial)

**Implementation Notes:**
- ScalingContainerDirective created as new code extracted from BoardComponent's scaling logic — simulator NOT migrated in this epic (migration is Epic 8). Zero simulator regression risk.
- `_responsive.scss`: breakpoint variables ($navbar-breakpoint: 768px, $bp-mobile: 576px, $bp-tablet: 768px, $bp-desktop-sm: 1024px), responsive mixins (mobile-first media queries)
- `_canvas-scaling.scss`: mixins for Track A canvas scaling (letterboxing, transform-origin, container setup)
- Navbar responsive: extends existing NavbarComponent with CDK BreakpointObserver at 768px threshold. Desktop = collapsible sidebar (existing). Mobile = hamburger + drawer overlay (mat-sidenav). Single component, two modes.
- Login + Settings: simple pages, grouped in one story. Center form, full-width inputs on mobile, margin adjustments.
- Deck list: fluid grid responsive — 1 column mobile, 2 tablet, 3-4 desktop. Separate story.
- Touch targets 44×44px minimum on all responsive pages.
- Epic 7 is standalone — provides foundation for Epic 8. Does not depend on Epic 8 to function.

### Epic 8: Shared Components & Responsive Card Pages

CardComponent and CardInspectorComponent are extracted from the simulator into shared components for cross-page reuse. The deck builder and card search pages use fixed canvas scaling with hybrid layout. The simulator is refactored to import shared components without regression.

**NFRs covered:** NFR12 (completion)

**Implementation Notes:**
- Story 8.1 = harmonization analysis: compare existing deck builder card/inspector components with simulator versions, verify selector collision risk (`app-card`), define unified contract (inputs, outputs, CSS custom properties), produce migration plan. MUST run before any extraction.
- CardComponent: `app-sim-card` → `app-card` in `components/card/`. Signal-based inputs, context-agnostic.
- CardInspectorComponent: `app-sim-card-inspector` → `app-card-inspector` in `components/card-inspector/`. Multi-mode activation via input (hover for simulator, click/permanent for deck builder).
- Deck builder: hybrid layout — responsive header (Track B patterns) + scaled canvas (ScalingContainerDirective from Epic 7). `referenceWidth` calibrated per page.
- Card search: same hybrid pattern as deck builder.
- Simulator refactor: replace `app-sim-card` and `app-sim-card-inspector` imports with shared `app-card` and `app-card-inspector`. Manual testing validates no regression.
- Touch targets 44×44px on card manipulation pages.
- Epic 8 depends on Epic 7 (ScalingContainerDirective, SCSS infrastructure). Standalone once Epic 7 is complete.

### Epic 10: Bottom Sheet & Filter UX Unification

The bottom sheet component is made generic and reusable. The card searcher filter display is unified to a vertical expand/collapse pattern across all contexts (deck builder, card search page, bottom sheet). The card search page gains a bottom sheet for mobile portrait. Auto-snap full behavior links filter expansion to bottom sheet state.

**UX spec refs:** Revision 2026-02-18 points G, H, I, J

**Implementation Notes:**
- Story 10.1: Bottom sheet API extension (`ariaLabel` input, programmatic `snapTo()` method for auto-snap full) + deck builder updated to pass new input. No breaking changes.
- Story 10.2: `card-searcher` internalizes filter display — replaces lateral slide-in overlay (deck builder), lateral panel (card search page), and overlay-inside-bottom-sheet (mobile) with unified vertical expand/collapse. `card-filters` rendered inline above `card-list`. `filtersExpanded` output signal emitted for bottom sheet integration. Removes external filter containers from deck builder and card search page.
- Story 10.3: Card search page gains `<app-bottom-sheet>` wrapping `<app-card-searcher>` on mobile portrait. Same CSS `display` toggling pattern as deck builder. FAB search toggle button on mobile portrait. `filtersExpanded` signal wired to trigger auto-snap full on bottom sheet.
- Epic 10 depends on Epic 9 (bottom sheet component created in 9-13). Standalone once Epic 9 is complete.

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

**Given** any stacked zone (Deck, ED, GY, Banished) has cards
**When** I drag directly on the stacked zone pill (without clicking to open the overlay first)
**Then** the top card is grabbed — identical behavior to dragging a board card (same cursor `grab`, same lift animation, same drag preview showing the actual top card image or card back for Deck, same valid drop targets, same drop feedback)
**And** empty pills (count = 0) disable drag: cursor `not-allowed`, reduced opacity

**Given** I right-click on the Extra Deck zone
**When** the context menu opens
**Then** a `mat-menu` appears with a "View" option
**And** clicking "View" opens the pile overlay in browse mode (all cards face-up, no grouping)

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

**Given** I enter a Mill (N) value greater than the remaining deck size
**When** the mill executes
**Then** only `min(N, deckSize)` cards are milled — the operation completes without error

**Given** I enter a Reveal (N) value greater than the remaining deck size
**When** the reveal executes
**Then** only `min(N, deckSize)` cards are revealed — no error, the overlay shows all remaining deck cards

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

**Given** the Deck zone has cards (count > 0)
**When** the board renders
**Then** the Deck zone displays a card-back image (never appears visually empty)
**And** the Extra Deck zone similarly displays a card-back image when count > 0

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

---

## Epic 7: Responsive App Shell & Navbar

> The application adapts to all viewport sizes. Content pages (deck list, settings, login) use mobile-first responsive CSS. The navbar switches to hamburger/drawer mode on mobile. Shared SCSS infrastructure and ScalingContainerDirective are created as foundation for Track A pages.

**Implementation Notes:**

- Stories are ordered by dependency: infrastructure (7.1) first, then navbar (7.2) which depends on the breakpoint variables, then pages (7.3, 7.4) which depend on both.
- ScalingContainerDirective is NEW code — the simulator is NOT migrated to use it in this epic. Migration happens in Epic 8.
- The navbar extends the existing NavbarComponent from Epic 6.4 (collapsible sidebar) — adding a second mode (hamburger/drawer) for mobile.

### Story 7.1: Shared SCSS Infrastructure & ScalingContainerDirective

As a developer,
I want shared SCSS breakpoint variables, responsive mixins, canvas scaling mixins, and a reusable ScalingContainerDirective,
So that all pages can implement consistent responsive behavior and canvas scaling without duplicating code.

**Acceptance Criteria:**

**Given** the shared SCSS infrastructure is needed
**When** `src/app/styles/_responsive.scss` is created
**Then** it defines breakpoint variables: `$navbar-breakpoint: 768px`, `$bp-mobile: 576px`, `$bp-tablet: 768px`, `$bp-desktop-sm: 1024px`
**And** it provides mobile-first responsive mixins (e.g., `@mixin respond-above($bp)` wrapping `@media (min-width: $bp)`)
**And** it provides shared responsive utilities (e.g., `.touch-target-min` ensuring 44×44px minimum)

**Given** the canvas scaling infrastructure is needed
**When** `src/app/styles/_canvas-scaling.scss` is created
**Then** it provides mixins for Track A canvas parent setup (explicit height, overflow hidden, centering)
**And** it provides host styles for scaled containers (transform-origin, letterboxing background)

**Given** the ScalingContainerDirective is created in `src/app/components/scaling-container/`
**When** applied to a host element via `[appScalingContainer]`
**Then** it accepts `aspectRatio` input (default: `16/9`) and `referenceWidth` input (default: `1920`)
**And** it observes the parent element dimensions via `ResizeObserver`
**And** it computes `scale = min(parentWidth / referenceWidth, parentHeight / (referenceWidth / aspectRatio))`
**And** it applies `transform: scale(scale)` and `transform-origin: top center` on the host element
**And** it emits the computed scale factor via a `scale` output signal (for debug/UI use)

**Given** the directive's parent container has `height: auto` (no explicit height)
**When** the ResizeObserver fires
**Then** the directive still functions but the scale may not respond correctly to viewport changes — this is a documented constraint (parent MUST have explicit height)

**Given** the directive is applied and the parent resizes (viewport change, navbar toggle)
**When** the ResizeObserver detects the dimension change
**Then** the scale factor is recomputed and the transform updates reactively

**Given** all new files are created
**When** the build runs
**Then** the existing application compiles and functions identically — no existing component imports these files yet

### Story 7.2: Responsive Navbar (Hamburger/Drawer on Mobile)

As a user,
I want the navbar to switch to a hamburger menu with a drawer on mobile devices,
So that I can navigate the app on small screens without the sidebar consuming permanent screen space.

**Acceptance Criteria:**

**Given** the viewport width is greater than 768px (desktop)
**When** the navbar renders
**Then** the existing collapsible sidebar behavior from Epic 6.4 is unchanged (chevron toggle, expanded/collapsed states)
**And** no hamburger icon is visible

**Given** the viewport width is 768px or less (mobile/tablet)
**When** the navbar renders
**Then** the sidebar is hidden
**And** a fixed top bar appears with a hamburger icon button
**And** the top bar has a defined height stored in CSS variable `--mobile-header-height`

**Given** the navbar is in mobile mode and the hamburger is visible
**When** I tap/click the hamburger icon
**Then** the navbar content slides in as a drawer overlay from the left (using `mat-sidenav` or equivalent)
**And** a semi-transparent backdrop appears behind the drawer

**Given** the drawer is open on mobile
**When** I tap the backdrop, press Escape, or navigate to a page
**Then** the drawer closes

**Given** the viewport is resized across the 768px threshold
**When** the width crosses from above to below (or vice versa)
**Then** the navbar mode switches seamlessly between sidebar and hamburger/drawer
**And** no layout flash or jump occurs during the transition

**Given** the navbar is in mobile mode on a Track A page (simulator, deck builder, card search)
**When** the page renders
**Then** the canvas parent height accounts for the fixed top bar: `height: calc(100vh - var(--mobile-header-height))`
**And** the canvas content scales correctly within the reduced available space

**Given** the navbar mode detection is implemented
**When** the component initializes
**Then** CDK `BreakpointObserver` is used with the `$navbar-breakpoint` value (768px) as the single source of truth — matching the SCSS variable

**Given** the navbar is in mobile mode
**When** I right-click anywhere on the top bar or drawer
**Then** the native browser context menu appears (navbar is excluded from board `preventDefault` scope)

### Story 7.3: Login & Settings Pages Responsive

As a user,
I want the login and settings pages to be usable on any device from mobile to desktop,
So that I can access my account and configure the app regardless of screen size.

**Acceptance Criteria:**

**Given** I access the login page on a mobile viewport (≤576px)
**When** the page renders
**Then** the login form is centered and fills the available width with appropriate margins
**And** all input fields are full-width
**And** the submit button meets the 44×44px minimum touch target size
**And** no horizontal scrolling occurs

**Given** I access the login page on a desktop viewport (>1024px)
**When** the page renders
**Then** the login form is centered with a max-width constraint (not stretched to full screen)
**And** the layout is visually balanced with the existing app aesthetic

**Given** I access the settings page on a mobile viewport (≤576px)
**When** the page renders
**Then** settings sections stack vertically
**And** all interactive elements (toggles, buttons, links) meet the 44×44px minimum touch target size
**And** no horizontal scrolling occurs

**Given** I access the settings page on a tablet viewport (577–768px)
**When** the page renders
**Then** the layout adjusts with appropriate spacing — no wasted space, no cramping

**Given** both pages use the responsive SCSS infrastructure
**When** the styles are written
**Then** they import `_responsive.scss` and use the defined breakpoint mixins for media queries
**And** the styles follow mobile-first convention (base styles for mobile, `respond-above` for larger viewports)

### Story 7.4: Deck List Page Responsive

As a user,
I want the deck list page to display my decks in a responsive grid that adapts to my screen size,
So that I can browse and manage my decks comfortably on any device.

**Acceptance Criteria:**

**Given** I access the deck list page on a mobile viewport (≤576px)
**When** the page renders
**Then** decks are displayed in a single-column layout
**And** each deck card fills the available width
**And** all interactive elements (deck name link, action buttons) meet the 44×44px minimum touch target size
**And** no horizontal scrolling occurs

**Given** I access the deck list page on a tablet viewport (577–768px)
**When** the page renders
**Then** decks are displayed in a 2-column grid
**And** spacing between cards is consistent and visually balanced

**Given** I access the deck list page on a desktop viewport (>1024px)
**When** the page renders
**Then** decks are displayed in a 3 or 4-column grid (depending on available width)
**And** the layout matches the existing visual style of the app

**Given** the deck list page is responsive
**When** the viewport is resized across breakpoints
**Then** the grid column count adjusts fluidly without layout jumps
**And** deck card images scale proportionally within their grid cells

**Given** the deck list uses the responsive SCSS infrastructure
**When** the styles are written
**Then** they import `_responsive.scss` and use the defined breakpoint mixins
**And** the grid uses CSS Grid or Flexbox with `auto-fill`/`auto-fit` for natural column adjustment

**Given** the deck list page renders on any viewport between 375px and 2560px+
**When** I scroll through my decks
**Then** no horizontal scrolling occurs and all content is accessible (NFR11)

---

## Epic 8: Shared Components & Responsive Card Pages

> CardComponent and CardInspectorComponent are extracted from the simulator into shared components for cross-page reuse. The deck builder and card search pages use fixed canvas scaling with hybrid layout. The simulator is refactored to import shared components without regression.

**Implementation Notes:**

- Stories are ordered by dependency: harmonization analysis (8.1) must complete before any extraction. Card extraction (8.2) before inspector extraction (8.3) since the inspector references cards. Then page-level integrations (8.4, 8.5) which consume both shared components + ScalingContainerDirective from Epic 7.
- Simulator refactoring (replacing `app-sim-card` → `app-card`, `app-sim-card-inspector` → `app-card-inspector`) is embedded in stories 8.2 and 8.3 respectively — not a separate story — to ensure regression testing happens immediately after each extraction.
- All extraction follows the "extract, don't rewrite" principle: copy existing simulator component code, generalize inputs, update selectors.

### Story 8.1: Harmonization Analysis & Migration Plan

As a developer,
I want a documented analysis comparing the existing deck builder card/inspector components with the simulator versions,
So that I can extract shared components with a clear understanding of interface differences, naming conflicts, and migration steps.

**Acceptance Criteria:**

**Given** the simulator has `SimCardComponent` (`app-sim-card`) and the deck builder has its own card rendering component(s)
**When** the harmonization analysis is performed
**Then** a comparison document is produced listing for each component pair:
- Input/output contracts (signal inputs, event emitters)
- CSS class names and custom properties used
- Template structure differences
- Features present in one but not the other (e.g., drag handle, context menu trigger, face-down rendering)

**Given** the simulator uses selector `app-sim-card` and the shared component will use `app-card`
**When** selector collision risk is evaluated
**Then** the analysis confirms whether any existing component in the codebase already uses the `app-card` selector
**And** if a collision exists, a renaming strategy is documented

**Given** the simulator has `SimCardInspectorComponent` (`app-sim-card-inspector`) with hover-triggered activation
**When** the deck builder's card detail/preview component is compared
**Then** the analysis documents the activation mode differences (hover vs. click vs. permanent panel)
**And** proposes a unified `mode` input contract for the shared `CardInspectorComponent`

**Given** the harmonization analysis is complete
**When** the migration plan is produced
**Then** it defines:
- The unified input/output contract for `CardComponent` (all inputs, their types, defaults)
- The unified input/output contract for `CardInspectorComponent` (including `mode: 'hover' | 'click' | 'permanent'`)
- CSS custom properties for theming (allowing simulator dark theme and deck builder theme to coexist)
- Migration steps for the simulator (replace imports, verify no regression)
- Migration steps for the deck builder (replace existing card component with shared version)
- A checklist of manual tests to validate zero regression

**Given** the migration plan covers inspector placement on non-simulator pages
**When** the `click` mode behavior is documented
**Then** it specifies a floating overlay pattern (semi-transparent backdrop over canvas, card image + name/stats/effect text, dismiss on outside tap/click) inspired by Master Duel's card detail overlay
**And** this floating overlay applies uniformly on all viewports — no breakpoint-dependent placement switch
**And** the `position` input (`left` | `right`) is documented as relevant only to `hover` mode (simulator side panel); `click` mode uses centered overlay positioning

**Given** the migration plan covers CDK drag binding migration
**When** the document specifies how simulator-specific behaviors exit the extracted CardComponent
**Then** the template-driven pattern is documented: parent applies `cdkDrag`, `cdkDragPreview`, and context menu trigger directly on `<app-card>` in the template
**And** at least one code example is provided for the simulator use case (showing the parent template with CDK directives on the shared component)

**Given** the migration plan defines CSS custom properties
**When** the theming contract is documented
**Then** it lists all CSS custom properties for `CardComponent` (e.g., `--card-border-color`, `--card-shadow`, `--card-hover-scale`, `--card-bg`) and `CardInspectorComponent` (e.g., `--inspector-bg`, `--inspector-text`, `--inspector-width`, `--inspector-backdrop`)
**And** default values are specified for each property
**And** the simulator and deck builder override values are documented side by side

**Given** the migration plan is reviewed
**When** the team proceeds to Story 8.2
**Then** the plan serves as the implementation spec — no ambiguity remains about what to extract and how

### Story 8.2: Extract Shared CardComponent

As a developer,
I want a shared `CardComponent` (`app-card`) extracted from the simulator's `SimCardComponent`,
So that the simulator, deck builder, and card search pages can all use the same card rendering component.

**Acceptance Criteria:**

**Given** the harmonization analysis from Story 8.1 is complete
**When** the shared `CardComponent` is created in `src/app/components/card/`
**Then** it uses the selector `app-card`
**And** it accepts all inputs defined in the migration plan (e.g., `card: CardInstance`, `faceDown: boolean`, `position: 'ATK' | 'DEF'`, `draggable: boolean`, `showOverlayMaterials: boolean`)
**And** all inputs use Angular signal-based input API
**And** it emits outputs for interactions (e.g., `cardClicked`, `cardRightClicked`, `cardHovered`)

**Given** the `CardComponent` is created
**When** it renders a card
**Then** it displays the card image (face-up or card back based on `faceDown` input)
**And** it applies rotation for DEF position when `position === 'DEF'`
**And** it shows XYZ overlay material borders peeking when `showOverlayMaterials` is true and `card.overlayMaterials` is non-empty
**And** it is context-agnostic — no simulator-specific logic (no direct dependency on BoardStateService, CommandStackService, or simulator signals)

**Given** the `CardComponent` supports theming
**When** different pages use it
**Then** CSS custom properties (e.g., `--card-border-color`, `--card-shadow`, `--card-hover-scale`) allow each host page to style cards differently without modifying the component

**Given** the shared `CardComponent` is ready
**When** the simulator's `SimCardComponent` is refactored
**Then** `SimCardComponent` is replaced with `CardComponent` (`app-card`) in all simulator templates
**And** any simulator-specific behavior (CDK drag bindings, context menu triggers) is applied by the parent component via template attributes or wrapper directives — not inside `CardComponent`
**And** the old `SimCardComponent` files are deleted

**Given** the simulator uses the shared `CardComponent`
**When** all existing simulator interactions are tested manually
**Then** drag & drop, context menu (right-click), face-down rendering, position toggle visual, XYZ material peek, gold glow on drop, and `prefers-reduced-motion` behavior all work identically to before the refactor
**And** no visual difference is detectable between the old and new rendering

**Given** the shared `CardComponent` is available
**When** it is imported in a non-simulator context (e.g., a test harness or the deck builder)
**Then** it renders correctly without requiring simulator services or signals

### Story 8.3: Extract Shared CardInspectorComponent

As a developer,
I want a shared `CardInspectorComponent` (`app-card-inspector`) extracted from the simulator's `SimCardInspectorComponent`,
So that the simulator and deck builder can both display card details using the same component with different activation modes.

**Acceptance Criteria:**

**Given** the harmonization analysis from Story 8.1 is complete
**When** the shared `CardInspectorComponent` is created in `src/app/components/card-inspector/`
**Then** it uses the selector `app-card-inspector`
**And** it accepts a `card` input (the card to display) and a `mode` input (`'hover' | 'click' | 'permanent'`)
**And** it accepts a `position` input (`'left' | 'right'`) for panel placement
**And** all inputs use Angular signal-based input API

**Given** the `CardInspectorComponent` is in `hover` mode (simulator)
**When** a `card` input value is provided (non-null)
**Then** the inspector panel appears with fade transition (~100ms)
**And** when `card` becomes null, the panel fades out
**And** the component does NOT manage its own hover detection — the parent provides the `card` value via the existing `hoveredCard` signal

**Given** the `CardInspectorComponent` is in `click` mode (deck builder, card search)
**When** the parent sets the `card` input after a card tap/click
**Then** the inspector appears as a floating overlay centered over the canvas with a semi-transparent backdrop (Master Duel card detail pattern)
**And** the overlay displays: card image, card name, stats (ATK/DEF), type/attribute/level, full effect text (scrollable)
**And** tapping/clicking outside the overlay or pressing Escape dismisses it
**And** tapping/clicking a different card replaces the displayed card without closing and reopening
**And** the `position` input is ignored in `click` mode — overlay is always centered

**Given** the `CardInspectorComponent` is in `permanent` mode
**When** a card is provided
**Then** the inspector panel is always visible (no show/hide transition)
**And** content updates when the `card` input changes

**Given** the `CardInspectorComponent` renders card details
**When** a card is displayed
**Then** it shows: full-size card image, card name, attribute/race/level, ATK/DEF values, full effect text (scrollable)
**And** face-down cards show full details (solo context — positional state, not information barrier)
**And** no deck-building buttons (+1/-1, add/remove) are rendered — these are the deck builder's responsibility via separate UI outside the inspector

**Given** the `CardInspectorComponent` supports theming
**When** different pages host it
**Then** CSS custom properties (e.g., `--inspector-bg`, `--inspector-text`, `--inspector-width`) allow each page to style the inspector differently

**Given** the shared `CardInspectorComponent` is ready
**When** the simulator's `SimCardInspectorComponent` is refactored
**Then** `SimCardInspectorComponent` is replaced with `CardInspectorComponent` (`app-card-inspector`, `mode="hover"`) in the simulator template
**And** the `hoveredCard` signal (with 50ms debounce) continues to drive the `card` input
**And** `isDragging` signal continues to hide the inspector during drag
**And** the inspector repositioning logic (move to left when pile overlay is on right) is preserved via the `position` input driven by a computed signal
**And** the old `SimCardInspectorComponent` files are deleted

**Given** the simulator uses the shared `CardInspectorComponent`
**When** all existing simulator interactions are tested manually
**Then** hover behavior, debounce timing, drag suppression, face-down inspection, pile overlay repositioning, and fade transitions all work identically to before the refactor

### Story 8.4: Deck Builder Canvas Scaling & Shared Components

As a user,
I want the deck builder page to scale its card canvas on all viewport sizes and use the same card/inspector components as the simulator,
So that I can build decks comfortably on any device with a familiar card interaction experience.

**Acceptance Criteria:**

**Given** the deck builder page has a card manipulation area (canvas)
**When** the `ScalingContainerDirective` from Epic 7 is applied to the canvas container
**Then** the canvas scales proportionally via `transform: scale()` with a page-specific `referenceWidth`
**And** the parent container has explicit height (e.g., `calc(100vh - headerHeight)` or `calc(100vh - var(--mobile-header-height))` on mobile)

**Given** the deck builder has a hybrid layout
**When** the page renders
**Then** the search/filter header area above the canvas uses Track B responsive CSS (mobile-first, breakpoint-driven)
**And** the card canvas below uses Track A scaling (fixed reference resolution, `transform: scale()`)
**And** the two sections are separated by a clear visual boundary

**Given** the deck builder integrates the shared `CardComponent` (`app-card`)
**When** cards are displayed in the canvas
**Then** they render using the shared `CardComponent` with deck-builder-specific CSS custom property values (theme, sizing)
**And** the existing deck builder card rendering behavior is preserved (deck-building interactions like add/remove are handled by the deck builder page, not the card component)

**Given** the deck builder integrates the shared `CardInspectorComponent` (`app-card-inspector`)
**When** a card is tapped/clicked in the canvas
**Then** the inspector appears as a floating overlay centered over the canvas (`mode="click"`, Master Duel pattern)
**And** deck-building actions (+1/-1 buttons, add to deck, remove from deck) are rendered by the deck builder page — as action buttons within or adjacent to the floating overlay, not inside the inspector component itself

**Given** the deck builder renders on a mobile viewport (≤768px)
**When** the navbar is in hamburger/drawer mode
**Then** the canvas parent height accounts for the mobile header: `calc(100vh - var(--mobile-header-height))`
**And** the canvas scales correctly within the reduced space
**And** all interactive elements meet the 44×44px minimum touch target size (NFR12)

**Given** the deck builder renders on a desktop viewport (>1024px)
**When** the page loads
**Then** the layout matches the existing visual style with the canvas at full scale (or close to it)
**And** the sidebar navbar is in its default state (expanded or collapsed depending on user action)

**Given** the deck builder uses shared components and scaling
**When** all existing deck builder interactions are tested manually
**Then** card browsing, deck editing, search/filter, and inspector display all work correctly
**And** no functionality is lost compared to the pre-refactor version

### Story 8.5: Card Search Page Canvas Scaling & Shared Components

As a user,
I want the card search page to scale its card results canvas on all viewport sizes and use the same card/inspector components,
So that I can search and browse cards comfortably on any device.

**Acceptance Criteria:**

**Given** the card search page has a card results area (canvas)
**When** the `ScalingContainerDirective` from Epic 7 is applied to the results container
**Then** the results canvas scales proportionally via `transform: scale()` with a page-specific `referenceWidth`
**And** the parent container has explicit height accounting for the search header

**Given** the card search page has a hybrid layout
**When** the page renders
**Then** the search input and filter controls above the results use Track B responsive CSS (mobile-first, breakpoint-driven)
**And** the card results grid below uses Track A scaling (fixed reference resolution, `transform: scale()`)

**Given** the card search page integrates the shared `CardComponent` (`app-card`)
**When** search results are displayed
**Then** they render using the shared `CardComponent` with card-search-specific CSS custom property values
**And** card interactions (click to view details, add to deck if applicable) are handled by the card search page, not the card component

**Given** the card search page integrates the shared `CardInspectorComponent` (`app-card-inspector`)
**When** a card is tapped/clicked in the results
**Then** the inspector appears as a floating overlay centered over the canvas (`mode="click"`, Master Duel pattern)
**And** the inspector uses card-search-specific theming via CSS custom properties

**Given** the card search page renders on a mobile viewport (≤768px)
**When** the navbar is in hamburger/drawer mode
**Then** the canvas parent height accounts for the mobile header: `calc(100vh - var(--mobile-header-height))`
**And** the search input and filters remain accessible above the scaled canvas
**And** all interactive elements meet the 44×44px minimum touch target size (NFR12)

**Given** the card search page renders on a desktop viewport (>1024px)
**When** the page loads
**Then** the layout is visually consistent with the deck builder's hybrid pattern (responsive header + scaled canvas)

**Given** the card search page uses shared components and scaling
**When** all existing card search interactions are tested manually
**Then** searching, filtering, browsing results, and viewing card details all work correctly
**And** no functionality is lost compared to the pre-refactor version

**Given** Epic 8 is fully complete (stories 8.1–8.5)
**When** all pages are tested across viewports (375px to 2560px+)
**Then** the simulator, deck builder, and card search all use shared `CardComponent` and `CardInspectorComponent`
**And** the simulator has zero regression from the extraction
**And** all touch targets meet 44×44px minimum on mobile (NFR12 complete)

---

## Epic 9: UI/UX Modernization (Screen Implementation Guide)

> The entire application transitions from its legacy light-theme color palette to a unified dark theme built on CSS custom properties. A global design token system (`_tokens.scss`) provides the semantic palette foundation. Each screen is modernized individually — sidebar, search bar, deck cards, deck builder, and simulator — following the risk-minimized order from the Screen Implementation Guide. The simulator overrides global tokens via scoped `:host` for its distinct navy/cyan theme.

**Implementation Notes:**

- Stories are ordered by the risk-minimized implementation order from the Screen Implementation Guide (§Recommended Implementation Order). Dependencies flow forward: story 9-1 (global tokens) is the foundation for all others. Sidebar dark (9-2) validates the token system globally. Search bar (9-3) validates Material theming. Simulator stories (9-9 through 9-12) are grouped but ordered by dependency.
- Migration is incremental per screen — no big-bang variable replacement. Each story migrates only the components it touches. Old SCSS variables in `variable.scss` remain until all consumers are migrated.
- The Screen Implementation Guide (`screen-implementation-guide.md`) is the primary reference for per-screen decisions, key files, issues, and regression risks. The UX Design Specification (`ux-design-specification.md` §Customization Strategy, §Visual Design Foundation) defines the token values and design system foundations.
- No new dependencies — all changes use existing Angular Material, CDK, and SCSS infrastructure.

### Story 9.1: Global Tokens

As a developer,
I want a unified global design token system using CSS custom properties on `:root` in a new `_tokens.scss` file,
So that all screens share a consistent dark theme foundation and each page can override tokens via scoped `:host` without duplicating values.

**Acceptance Criteria:**

**Given** the application needs a unified token system
**When** `_tokens.scss` is created in `front/src/app/styles/`
**Then** it defines CSS custom properties on `:root` with the complete semantic palette (10 tokens: `--surface-base`, `--surface-card`, `--surface-card-hover`, `--surface-elevated`, `--surface-nav`, `--accent-primary`, `--accent-primary-dim`, `--text-primary`, `--text-secondary`, `--danger`)

**Given** `_tokens.scss` is created
**When** it is imported in `styles.scss` via `@import 'app/styles/tokens'`
**Then** the `:root` custom properties are available globally to all components
**And** the import is placed after `material` and before `variable`

**Given** the application builds
**When** `ng build` completes
**Then** zero compilation errors occur and the existing application functions identically — no visual regression on any page

**Given** the old SCSS variables in `variable.scss` still exist
**When** this story is complete
**Then** `variable.scss` is NOT modified, no existing component SCSS files are modified, and `_sim-tokens.scss` is NOT modified

**Given** `_tokens.scss` includes documentation
**When** a developer reads the file
**Then** a migration mapping comment block documents old SCSS variable → new CSS custom property relationships, variables with no direct replacement, deprecated variables, and a note that migration is incremental per screen

### Story 9.2: Sidebar Dark

As a user,
I want the navigation sidebar and mobile toolbar to use the dark theme,
So that the entire application has a cohesive dark visual identity instead of a jarring light navigation on dark content.

**Acceptance Criteria:**

**Given** the navbar component uses a light gradient background
**When** the sidebar dark theme is applied
**Then** the background is replaced with `var(--surface-nav)` on desktop sidebar, mobile top bar, and mobile drawer
**And** text color uses `var(--text-primary)` instead of `$black`

**Given** navigation items have hover and active states
**When** they are rendered with the dark theme
**Then** hover state uses `var(--surface-card)` background with 150ms ease transition
**And** active item has a 3px left border in `var(--accent-primary)` + `var(--accent-primary-dim)` background

**Given** the collapse toggle has a hardcoded light background (`rgb(230,230,230)`)
**When** the dark theme is applied
**Then** the toggle background is migrated to use tokens

**Given** the sidebar dark theme is applied
**When** all pages are tested (simulator, deck list, deck builder, card search, login, settings)
**Then** no text is invisible (no dark-on-dark) and no visual regression occurs on page content

### Story 9.3: Search Bar Dark

As a user,
I want the search bar and filter controls to use the dark theme,
So that form inputs blend seamlessly with the dark background instead of showing harsh white fields.

**Acceptance Criteria:**

**Given** the search bar uses default Material form field styling (white background)
**When** the dark theme is applied
**Then** the background is `var(--surface-card)`, text is `var(--text-primary)`, placeholder is `var(--text-secondary)`
**And** focus state uses `var(--accent-primary)` border/outline

**Given** the search bar is a shared component used in both card search page and deck builder
**When** the style changes are applied
**Then** both contexts render correctly with the dark theme
**And** clear button (X), search icon, and filter badge all use appropriate token colors

**Given** the filter badge uses `$blue` (#93dafa) border
**When** the dark theme is applied
**Then** the badge uses `var(--accent-primary)` instead

### Story 9.4: Deck Card Redesign

As a user,
I want deck cards in the deck list to have a modern dark design with subtle shadows and proper hover feedback,
So that the deck list looks polished and consistent with the dark theme.

**Acceptance Criteria:**

**Given** deck cards currently have `border: 1px solid $white` and asymmetric border-radius
**When** the redesign is applied
**Then** borders are removed, background is `var(--surface-card)`, border-radius is `12px`, and `box-shadow: 0 2px 8px rgba(0,0,0,0.3)` is applied

**Given** a user hovers over a deck card on desktop
**When** the card has the new hover state
**Then** elevation increases, background shifts to `var(--surface-card-hover)`, with 150ms transition

**Given** the delete button is currently a red circle with no confirmation
**When** the redesign is applied
**Then** it becomes a subtle `mat-icon-button` (trash icon) top-right in `var(--danger)` color
**And** clicking it triggers a confirmation dialog before deletion
**And** `$event.stopPropagation()` prevents card navigation on delete click

**Given** the create button uses `$blue` with `scale(4)` animation
**When** the redesign is applied
**Then** it becomes a ghost card first in the grid with `dashed 2px var(--accent-primary-dim)` border and `+` icon in `var(--accent-primary)`

**Given** the deck list has no empty state for 0 decks
**When** the empty state is implemented
**Then** a centered message and CTA button are displayed when no decks exist

### Story 9.5: Grid Minmax Conditional

As a user,
I want the card grid to use appropriate minimum column widths depending on context,
So that cards are legible on the standalone search page while fitting in the deck builder's narrower side panel.

**Acceptance Criteria:**

**Given** `card-list` is a shared component used in both card search page and deck builder
**When** the grid minmax is made conditional
**Then** the standalone search page uses `minmax(100px, 1fr)` for better readability
**And** the deck builder context uses `minmax(85px, 1fr)` to fit the narrower side panel

**Given** the deck builder passes `deckBuildMode=true` input
**When** this input is used as CSS class discriminant
**Then** the correct minmax value is applied per context via CSS

**Given** grid gap is currently `0.5em`
**When** the update is applied
**Then** gap increases to `0.75em` for breathing room

**Given** the grid changes are applied
**When** both the card search page and deck builder are tested
**Then** card grids render correctly in both contexts at all breakpoints

### Story 9.6: Deck Builder Headers & Zone Separation

As a user,
I want clear section headers (MAIN/EXTRA/SIDE) and visual separation between deck zones,
So that I can quickly identify which section I'm viewing when scrolling through my deck.

**Acceptance Criteria:**

**Given** section headers currently use `rgba(0,0,0,0.3)` on dark background
**When** the redesign is applied
**Then** headers use opaque `var(--surface-nav)` background, uppercase bold label with count badge as pill (e.g., `MAIN [38]`)
**And** a 3px left border in `var(--accent-primary)` marks each section
**And** count color is `var(--danger)` when illegal (main < 40 or > 60), `var(--accent-primary)` when valid

**Given** sections are stacked with minimal spacing
**When** zone separation is added
**Then** `margin-top: 1rem` is applied between MAIN→EXTRA and EXTRA→SIDE sections

**Given** the headers are styled
**When** the user scrolls through the deck viewer
**Then** headers are sticky (`position: sticky`) so the current section is always visible
**And** z-index is above cards but below modals/inspector

### Story 9.7: Deck Name Collapsed

As a user,
I want the deck name input to display as collapsed text by default and expand to an editable input on tap,
So that the header area is cleaner and less cluttered.

**Acceptance Criteria:**

**Given** the deck name is currently always displayed as a mat-form-field
**When** collapsed mode is implemented
**Then** the name displays as text only by default
**And** tapping/clicking the text reveals the input field with focus
**And** blur or Enter saves and returns to text display

**Given** the collapsed mode applies to both mobile portrait and landscape
**When** the user interacts with the deck name
**Then** the behavior is consistent across breakpoints

**Given** the auto-save triggers on blur
**When** the user is still typing
**Then** a debounce prevents premature saves

### Story 9.8: Toggles Landscape

As a user,
I want the view mode toggles to be merged into the search bar row on landscape viewports,
So that vertical space is preserved and I can see more card results.

**Acceptance Criteria:**

**Given** view mode toggles currently occupy a separate row (~44px) below the search bar
**When** landscape viewport is detected
**Then** toggles are merged into the same row as the search bar: `[search input] [toggles] [filter button]`
**And** ~44px vertical space is saved (one extra card row visible)

**Given** the toggles use individual `mat-icon` buttons
**When** the redesign is applied
**Then** they use `mat-button-toggle-group` compact with tooltips
**And** active state uses `var(--accent-primary-dim)` background + `var(--accent-primary)` icon

**Given** the portrait layout currently stacks search and toggles
**When** portrait orientation is active
**Then** the stacked layout is preserved (no regression)

**Given** the merge affects both card search page and deck builder (shared card-searcher component)
**When** both contexts are tested in landscape
**Then** the merged layout renders correctly in both

### Story 9.9: Simulator Board Bottom, Inspector Top & Zone Labels

As a user,
I want the simulator board anchored at the bottom of the viewport on mobile portrait with the card inspector at the top and labels on empty zones,
So that the board is thumb-friendly, card details are at eye level, and I can identify zones without cards.

**Acceptance Criteria:**

**Given** the board is currently anchored at the top on mobile portrait
**When** the layout is updated
**Then** `transform-origin` changes to `bottom center` on mobile portrait, anchoring the board at the bottom
**And** the hand zone is at the bottom edge of the viewport for thumb interaction

**Given** the card inspector currently supports `position: 'left' | 'right'`
**When** mobile portrait is detected
**Then** a `'top'` position option is added and used, displaying the inspector as a floating overlay at the top of the viewport
**And** the inspector does not cover Extra Monster zones

**Given** zone labels were previously removed due to CDK drag bugs
**When** labels are reimplemented on empty zones
**Then** labels display zone names (GY, Banish, ED, Deck, Field, etc.) in `var(--text-secondary)` at ~0.65rem
**And** labels disappear when a card is placed in the zone
**And** `pointer-events: none` + low z-index prevent CDK drag interference

**Given** the layout changes are applied
**When** drag & drop operations are tested on mobile portrait
**Then** all drag operations work correctly with no regression from label or layout changes

### Story 9.10: Simulator XYZ Peek Mobile Positioning

As a user,
I want the XYZ material peek panel positioned above the board on mobile portrait instead of to the right,
So that the panel doesn't clip or overflow on narrow viewports.

**Acceptance Criteria:**

**Given** the XYZ peek panel is positioned absolute right
**When** mobile portrait viewport is detected
**Then** the panel is repositioned as a top overlay (matching the inspector placement strategy)

**Given** the panel uses `$sim-*` tokens directly
**When** the token migration is applied
**Then** tokens are migrated to reference global tokens with simulator overrides via `:host`

**Given** the panel has a `@media (prefers-reduced-motion)` block
**When** the cleanup is applied
**Then** the block is removed from the component SCSS

**Given** the repositioning is applied
**When** CDK drag from peek panel to board zones is tested on mobile portrait
**Then** drag operations work correctly across the repositioned boundary

### Story 9.11: Simulator Hide Top Bar & Back Button

As a user,
I want the mobile top bar hidden in landscape simulator mode with a back button in the control bar,
So that the simulator is fully immersive with maximum board space.

**Acceptance Criteria:**

**Given** the mobile top bar consumes 48px on the simulator in landscape
**When** landscape simulator mode is detected
**Then** the top bar is hidden (simulator-specific immersive mode)

**Given** the top bar is hidden
**When** a back/exit button is added to the control bar pill
**Then** it navigates back to the deck builder (`/decks/:id`)
**And** no quit confirmation is needed (state is ephemeral by design)

**Given** the immersive mode uses a service signal
**When** the simulator component is destroyed
**Then** the signal is cleaned up and the top bar reappears on other pages

### Story 9.12: Simulator Token Migration

As a developer,
I want the simulator's `_sim-tokens.scss` migrated to reference global tokens with simulator-specific overrides via `:host`,
So that the dual token system is unified and the simulator inherits shared values without duplication.

**Acceptance Criteria:**

**Given** the simulator currently uses ~15 `$sim-*` SCSS variables in `_sim-tokens.scss`
**When** the migration is applied
**Then** `SimulatorPageComponent` overrides global tokens via `:host` (e.g., `--surface-base: #0a0e1a`, `--accent-primary: #00d4ff`)
**And** shared values (`--text-primary`, `--text-secondary`, `--danger`, `--surface-elevated`) inherit from global — zero duplication

**Given** the simulator uses cyan `#00d4ff` for interactive accents and gold `#d4a017` for success glow
**When** the token mapping is applied
**Then** cyan maps to `--accent-primary` override and gold glow remains hardcoded or as a simulator-specific token (NOT confused with global gold `#C9A84C`)

**Given** the migration is applied
**When** all simulator interactions are tested
**Then** zone borders, drag highlights, card glow, control bar, pile overlays, and hand rendering all appear visually identical to before the migration

**Given** the old `_sim-tokens.scss` file
**When** the migration is complete
**Then** it is either removed or reduced to only simulator-specific derived values that cannot be expressed as global token overrides

### Story 9.13: Bottom Sheet

As a user,
I want the deck builder's mobile portrait search to open as a bottom sheet instead of a full overlay,
So that the top of my deck remains visible while searching for cards.

**Acceptance Criteria:**

**Given** mobile portrait search currently opens as a full-width overlay
**When** the bottom sheet is implemented
**Then** it opens with snap points: 60% height (default), 100% on drag up, dismiss on drag down
**And** a drag handle is visible at the top of the sheet
**And** the top of the deck remains visible at the 60% snap point

**Given** the bottom sheet is a custom component (no new dependency)
**When** it is implemented
**Then** it uses CDK touch/drag or vanilla pointer events for snap point tracking
**And** velocity calculation determines whether to snap up, stay, or dismiss

**Given** cards in the bottom sheet are draggable to deck zones via CDK
**When** a card is dragged from the sheet to a deck zone
**Then** `cdkDropListGroup` coverage allows the drag to cross the sheet boundary

**Given** the virtual keyboard opens on mobile (search input focus)
**When** the viewport resizes
**Then** the bottom sheet handles the resize via `visualViewport` API without breaking layout

**Given** the bottom sheet z-index
**When** layered with other UI elements
**Then** it is above the FAB search button but below the card inspector

### Story 9.14: Infinite Scroll Indicator

As a user,
I want a loading indicator during infinite scroll and an end-of-results message,
So that I know whether more cards are loading or if I've reached the end of the results.

**Acceptance Criteria:**

**Given** the card search page uses infinite scroll via `search-service-core`
**When** more results are being fetched
**Then** a spinner or skeleton row is displayed at the bottom of the card grid

**Given** the API returns fewer than 60 items (page size)
**When** the end of results is reached
**Then** a "Fin des résultats" message is displayed instead of the spinner

**Given** the loading indicator is implemented
**When** the user scrolls through results
**Then** the spinner appears promptly when a fetch starts and disappears when results are rendered

**Given** Epic 9 is fully complete (stories 9.1–9.14)
**When** all pages are tested across viewports (375px to 2560px+)
**Then** the entire application uses the unified dark theme with consistent token usage
**And** the simulator retains its distinct navy/cyan visual identity via scoped `:host` overrides
**And** no visual regression exists on any page compared to pre-Epic-9 state (accounting for intentional redesigns)

## Epic 10: Bottom Sheet & Filter UX Unification

> The bottom sheet component is made generic and reusable across pages. The card searcher filter display is unified to a vertical expand/collapse pattern, replacing three different filter presentation mechanisms (lateral overlay in deck builder, lateral panel in card search page, overlay-inside-bottom-sheet on mobile). The card search page gains a bottom sheet for mobile portrait. When filters expand inside a bottom sheet, it auto-snaps to full for maximum space.

**Implementation Notes:**

- Source: UX Design Specification revision 2026-02-18, points G, H, I, J (§Bottom Sheet Pattern, §Card Searcher Filter Pattern)
- The bottom sheet component already exists (`components/bottom-sheet/`) from story 9-13. This epic extends it and unifies filter UX.
- Key design rule: bottom sheet = exploration panels (search, filters). Card detail = CardInspectorComponent overlay/modal. Never nest bottom sheets.
- No new dependencies — all changes use existing Angular 19, Angular Material, CDK infrastructure.

### Story 10.1: Generic Bottom Sheet & Auto-Snap Full

As a developer,
I want the bottom sheet component to have a configurable aria-label and support programmatic snap-to-full,
so that it can be reused on any page and respond to external events like filter expansion.

**Acceptance Criteria:**

**Given** the bottom sheet has a hardcoded `aria-label="Panneau de recherche de cartes"` in the template
**When** a new `ariaLabel` input is added with a default value
**Then** the template uses the input value for `aria-label`
**And** the deck builder passes `"Panneau de recherche de cartes"` explicitly (no behavior change)

**Given** the bottom sheet needs to snap to full programmatically (not just via user drag)
**When** a public `snapToFull()` method or a `requestedState` input signal is added
**Then** the sheet can be driven to the `full` snap state from the parent component
**And** the sheet remembers the previous snap state (before the programmatic snap) for later restoration

**Given** the programmatic snap was triggered (e.g., filters expanded)
**When** the external event ends (e.g., filters collapsed)
**Then** the sheet restores to the previous snap state (typically `half`)

**Given** the bottom sheet API is extended
**When** the deck builder is updated to use the new `ariaLabel` input
**Then** the deck builder behavior is identical to before — no visual or functional regression

### Story 10.2: Unified Expand/Collapse Filters in Card Searcher

As a user,
I want filters to expand/collapse vertically above the card list in every context,
so that I have a consistent, non-overlapping filter experience whether I'm in the deck builder, card search page, or mobile bottom sheet.

**Acceptance Criteria:**

**Given** the card searcher currently delegates filter display to external containers (deck builder overlay `z-index: 999`, card search page lateral panel `width: 0→300px`)
**When** the filter toggle button is pressed
**Then** the `card-filters` component expands vertically **above** the `card-list` inside the `card-searcher` component, pushing the list down
**And** the animation uses CSS `max-height` or `grid-template-rows` transition for smooth expand/collapse

**Given** the `card-searcher` manages filters internally
**When** filters are open
**Then** the card list remains partially visible below the filters (in full-height contexts)
**And** scrolling the card list still works normally

**Given** the card searcher emits a `filtersExpanded` output signal
**When** filters are expanded
**Then** the signal emits `true`
**When** filters are collapsed
**Then** the signal emits `false`

**Given** the deck builder previously had `.deckBuilder-side-filters` as an absolute-positioned overlay
**When** the expand/collapse pattern is active
**Then** the `.deckBuilder-side-filters` div and its styling are removed from `deck-builder.component.html` and `deck-builder.component.scss`
**And** the `filtersOpened` signal and `closeFilters()` method in `deck-builder.component.ts` are removed (filters now managed by card-searcher)

**Given** the card search page previously had `.cardSearchPage-filters` as a lateral panel
**When** the expand/collapse pattern is active
**Then** the `.cardSearchPage-filters` div and its responsive SCSS (width transition, mobile overlay) are removed from `card-searcher.component.html` and `card-searcher.component.scss`

**Given** the `deckBuildMode` input exists on `card-searcher`
**When** `deckBuildMode` is `true`
**Then** the filter toggle button and expand/collapse work identically to when `deckBuildMode` is `false` — no mode-specific filter behavior

**Given** the filter expand/collapse is implemented
**When** tested on desktop (both pages) and mobile portrait (bottom sheet)
**Then** no visual regression occurs and filters are functional in all 3 contexts

### Story 10.3: Card Search Page Mobile Bottom Sheet

As a user,
I want the card search page to use a bottom sheet on mobile portrait,
so that I have a familiar, draggable search panel experience consistent with the deck builder.

**Acceptance Criteria:**

**Given** the card search page has no bottom sheet on mobile
**When** viewed on mobile portrait (≤767px width, portrait orientation)
**Then** a `<app-bottom-sheet>` wraps the `<app-card-searcher>` component
**And** the bottom sheet is hidden via CSS `display: none` on desktop/landscape (same pattern as deck builder)

**Given** the card search page needs a trigger to open the bottom sheet on mobile portrait
**When** a FAB search toggle button is added (same pattern as deck builder's `.deckBuilder-searchToggle`)
**Then** tapping the FAB opens the bottom sheet in `half` snap state
**And** the FAB is only visible on mobile portrait (hidden on desktop/landscape via CSS media query)

**Given** the card searcher emits `filtersExpanded: true` inside the bottom sheet
**When** the event is received by the card search page component
**Then** the bottom sheet snaps to `full` via the programmatic snap API (from story 10.1)

**Given** the card searcher emits `filtersExpanded: false`
**When** the event is received
**Then** the bottom sheet restores to its previous snap state

**Given** the card search page uses `CardInspectorComponent` with `mode="click"`
**When** a card is tapped in the bottom sheet
**Then** the inspector opens as an overlay **above** the bottom sheet (z-index hierarchy preserved)
**And** no nested bottom sheet is created

**Given** the bottom sheet is implemented on the card search page
**When** the `ariaLabel` input is set
**Then** it uses `"Panneau de recherche de cartes"` (or appropriate label)
**And** the `cardDragActive` input is NOT used (no CDK drag on card search page)

**Given** the card search page bottom sheet is complete
**When** tested on mobile portrait, mobile landscape, tablet, and desktop
**Then** the bottom sheet is only visible/functional on mobile portrait
**And** desktop/landscape behavior is unchanged (full-page card searcher with inline filters)

