---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments: ['prd.md', 'project-context.md', 'ux-design-specification.md', 'sprint-change-proposal-2026-02-12.md']
workflowType: 'architecture'
project_name: 'skytrix'
user_name: 'Axel'
date: '2026-02-08'
lastStep: 8
status: 'complete'
completedAt: '2026-02-08'
lastEdited: '2026-02-12'
editHistory:
  - date: '2026-02-12'
    changes: 'Added Responsive Strategy and Shared Component Extraction sections per sprint change proposal'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
34 functional requirements across 7 categories covering simulation initialization, card movement via drag & drop across 18 interconnected game zones, card actions (draw, summon, activate, send to GY, banish, return), deck operations (search, mill, reveal/excavate), zone inspection with expandable overlays, card state management (face-down/flip, ATK/DEF toggle), and session management (undo/redo with Command pattern, reset, keyboard shortcuts).

The simulator is fully manual with no rules engine — the player has complete freedom over card placement and actions. This eliminates rules engine complexity but places the burden on intuitive UX and flexible state management.

**Non-Functional Requirements:**
12 NFRs focused on four areas:
- **Performance (NFR1-6):** 16ms frame budget for drag & drop, <100ms board state updates, <1s board reset, <200ms tooltip, <300ms overlay open. These are tight constraints requiring OnPush change detection and signal-based reactivity.
- **Security (NFR7-8):** Route protected by existing authentication. No data transmitted to backend — fully client-side.
- **Compatibility (NFR9-10):** Modern desktop and mobile browsers. Integrates with existing build/deploy pipeline.
- **Responsiveness (NFR11-12):** Deck management pages usable 375px–2560px+. Touch targets min 44×44px on mobile.

**Scale & Complexity:**

- Primary domain: Frontend web (Angular SPA)
- Complexity level: Medium — rich interactive UI with state management challenges, but no backend, no real-time, no multi-tenancy
- Estimated architectural components: ~8-12 (board container, zone components, card component, drag & drop orchestration, game state service, command stack service, deck operations service, overlay components)

### Technical Constraints & Dependencies

- **Framework:** Angular 19.1.3 with standalone components, signals, OnPush — all new components must follow these patterns
- **Drag & Drop:** Angular CDK DragDrop already installed — no new dependencies
- **Existing services:** Card data, deck data, card images, card-tooltip component available for reuse
- **Routing:** New route `/decks/:id/simulator` in flat `app.routes.ts` config
- **Styling:** SCSS with shared styles from `src/app/styles/`
- **TypeScript:** Strict mode, ES2022 target
- **No backend changes:** All state is ephemeral, client-side only
- **Zero direct board state mutation:** All state changes must go through the command stack. This is non-negotiable for undo/redo integrity and debuggability.
- **Big bang development with manual testing only:** No automated tests. Architecture must compensate through code readability, predictable state flow, and clear separation of responsibilities.

### Cross-Cutting Concerns Identified

- **Board state management:** Single source of truth for all 18 zones, card positions, card states (face-up/down, ATK/DEF). Must support efficient querying and updates.
- **Command pattern integration:** Every user action that modifies board state must be wrapped in a command for undo/redo. CompositeCommand for batch operations. This permeates all action handlers.
- **Drag & drop orchestration:** cdkDropListGroup connects all 18 zones. Zone capacity enforcement, visual feedback during drag, and drop validation are cross-cutting across all zone components.
- **Performance discipline:** OnPush + signals throughout. No unnecessary re-renders when only one zone changes. cdkDropListSortingDisabled on single-card zones.
- **Card rendering consistency:** Cards appear in multiple contexts (hand, board zones, overlays, tooltips) — consistent rendering logic needed.
- **Board scaling:** The board uses a fixed aspect ratio container that scales via `transform: scale()` to fit the available viewport space. The scale factor must be computed reactively (viewport resize, navbar toggle) and propagated to the board component. → See UX spec for visual behavior (dimensions, transform-origin, letterboxing).

## Starter Template Evaluation

### Primary Technology Domain

Frontend web (Angular SPA) — brownfield project. The simulator is a new feature within an existing, established application.

### Starter Options Considered

**Not applicable.** This is a brownfield project with a fully established technology stack. The existing skytrix application provides all foundational architecture — no starter template, boilerplate, or scaffolding tool is needed.

### Selected Approach: Extend Existing Application

**Rationale:** The simulator is a new page/route within an existing Angular 19 SPA. All infrastructure (build pipeline, routing, services, components, styling) is already in place. Adding a starter template would conflict with the established project structure and conventions.

**Architectural Decisions Already Established by Existing Project:**

**Language & Runtime:**
TypeScript 5.5.4 strict mode, ES2022 target, `useDefineForClassFields: false` for Angular compatibility.

**Styling Solution:**
SCSS with shared styles from `src/app/styles/`. Angular Material theming.

**Build Tooling:**
Angular CLI with existing build and deployment pipeline. No additional configuration needed.

**Testing Framework:**
Karma + Jasmine available but not used for this feature (big bang development, manual testing only).

**Code Organization:**
`pages/simulator/` as root folder with colocated components, services, and models. Flat structure preferred — introduce sub-folders only if file count exceeds readability threshold.

**Development Experience:**
`ng serve` with proxy to backend, hot reload, Angular DevTools compatible.

**Entry Point:** Create the simulator page component and register the route `/decks/:id/simulator` in `app.routes.ts`. This is the first concrete action — all other simulator code branches from this.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Board state data model (hybrid zone-centric + card instance state)
- Zone identification (18 physical zones, ZoneId enum)
- Command pattern design (delta-based, 6 command types + CompositeCommand)
- Component hierarchy (SimulatorPage → Board → Zone/Card)

**Important Decisions (Shape Architecture):**
- Command stack management (dual signal-based stacks)
- Zone behavior categorization (single-card, ordered, stack, dual-purpose)
- Drag & drop targeting (individual slot = individual cdkDropList)

**Deferred Decisions (Post-MVP):**
- Token creation UI
- Life point counter design
- Phase tracking system
- Board state persistence/serialization

### Data Architecture

**Board State Model: Hybrid (Zone-Centric + Card Instance State)**
- Board state stored as `Record<ZoneId, CardInstance[]>` — zone-centric for fast lookup per zone
- Each `CardInstance` carries its own state: card data reference, faceDown flag, battle position (ATK/DEF)
- 18 physical zones (not 20): Spell/Trap zones 1 and 5 double as Pendulum L/R (Master Rule 5 — shared zones)

**Zone Identification:**
- `ZoneId` enum with 18 values: HAND, MONSTER_1-5, SPELL_TRAP_1-5, EXTRA_MONSTER_L/R, FIELD_SPELL, MAIN_DECK, EXTRA_DECK, GRAVEYARD, BANISH
- No separate PENDULUM_L/PENDULUM_R — these are SPELL_TRAP_1 and SPELL_TRAP_5
- Zone behavior categories: single-card (13 zones), ordered multi-card (HAND), stack/pile (4 zones), dual-purpose Pendulum (SPELL_TRAP_1, SPELL_TRAP_5)

### Frontend Architecture

**Component Hierarchy:**
```
SimulatorPage (page container — loads deck, orchestrates)
├── BoardComponent (game board — CSS grid layout of zones)
│   ├── ZoneComponent (reusable per-zone — receives ZoneId input)
│   │   └── CardComponent (card rendering — image, face-down, position)
│   └── StackedZoneComponent (GY, Banish, Deck, Extra Deck — count + top card)
├── HandComponent (ordered multi-card zone, free reordering)
│   └── CardComponent
└── OverlayComponent (inspect stacked zones, search deck, reveal/excavate)
    └── CardComponent
```

- Each individual slot is its own `cdkDropList` — player chooses exactly which slot to place a card in
- ZoneComponent is generic: adapts behavior based on ZoneId (single-card enforcement, dual-purpose Pendulum indicator)
- CardComponent is unique and reused everywhere: handles face-up/down, ATK/DEF rotation, drag handle

**Board Scaling Model:**
- The board container has fixed internal dimensions (1060×772). Zone sizes use fixed proportions inside this container — no `fr`/`minmax()`.
- The container scales via `transform: scale()` to fit the available viewport space.
- Scale factor: `min(availableWidth / boardWidth, availableHeight / boardHeight)` — computed as a signal in `BoardComponent`, reactive to `window.resize` and navbar collapse state.
- No breakpoints, no responsive layout changes — the grid structure is invariant; only the scale factor changes.
- → See UX spec for visual behavior (transform-origin, letterboxing, mobile portrait anchoring).

**Command Pattern Design: Delta-Based**
- Interface: `SimCommand { execute(): void; undo(): void; }`
- Delta-based: each command stores minimum data to do/undo (cardId, fromZone, toZone, indices)
- 6 concrete command types + CompositeCommand wrapper:

| Command | Purpose |
|---|---|
| `MoveCardCommand` | Move a card from any zone to any other zone (also covers search pick, reveal moves) |
| `DrawCardCommand` | Draw from deck top to hand (semantic wrapper — knows to pick from top) |
| `ShuffleCommand` | Shuffle deck (stores order before/after for undo) |
| `FlipCardCommand` | Toggle face-up/face-down |
| `TogglePositionCommand` | Toggle ATK/DEF battle position |
| `ReorderHandCommand` | Reorder cards within hand |
| `CompositeCommand` | Wraps multiple commands for batch undo/redo (e.g., mill 3 = 3 MoveCardCommands) |

- Search/pick from deck is UI (overlay) + `MoveCardCommand` — no separate command needed
- Mill is a `CompositeCommand` of `MoveCardCommand`s — no separate command needed

**Command Stack:**
- Two Angular signal-based arrays: `undoStack` and `redoStack`
- `execute(cmd)`: run command, push to undoStack, clear redoStack
- `undo()`: pop undoStack, call undo(), push to redoStack
- `redo()`: pop redoStack, call execute(), push to undoStack
- Zero direct board state mutation — all changes go through command execution

**Reset Behavior:**
- Reset is NOT a command — it is a definitive act with a confirmation dialog
- On reset: clear both undo/redo stacks, reinitialize board state (re-shuffle, re-draw)

### Decision Impact Analysis

**Cross-Component Dependencies:**
- BoardState service ← consumed by all zone/card components via signals
- CommandStack service ← invoked by all user actions (drag & drop handler, button actions, keyboard shortcuts)
- ZoneId enum ← referenced by BoardState, all zone components, command constructors, drag & drop predicates

## Implementation Patterns & Consistency Rules

_These patterns supplement the existing project-context.md (62 rules). They cover simulator-specific decisions where AI agents could diverge._

### State Management Patterns

**Board State Signal Architecture: Single Source + Computed Derivations**
- One source signal: `boardState = signal<Record<ZoneId, CardInstance[]>>(initialState)`
- Computed signals per zone: `hand = computed(() => this.boardState()[ZoneId.HAND])` — memo built-in, only re-renders when that zone's data changes
- All board state mutations produce a new `Record` reference (immutable update pattern) to trigger signal change detection
- Commands receive a reference to the BoardStateService to perform mutations via `boardState.update()`

**Signal Naming Convention:**
- State signals: noun — `boardState`, `undoStack`, `redoStack`
- Computed derivations: noun matching the zone or concept — `hand`, `graveyard`, `monsterZone1`
- Boolean computed: `is`-prefixed — `canUndo`, `canRedo`, `isDeckEmpty`

### Action Flow Pattern

**Canonical action flow (every user action follows this path):**
```
User Action (drag drop / button / keyboard)
  → Component captures intent (fromZone, toZone, cardId)
  → Component calls CommandStackService semantic method (e.g., moveCard(), drawCard())
  → Service creates Command instance internally (commands are implementation detail)
  → Service calls command.execute() (mutates boardState signal)
  → Service pushes command to undoStack, clears redoStack
  → Signal change propagates to computed → components re-render (OnPush)
```

- Components NEVER mutate state directly — they call CommandStackService methods
- Components NEVER instantiate Command classes — they call semantic methods
- CommandStackService is the ONLY entry point for state mutations
- BoardStateService owns the signal, CommandStackService orchestrates commands

### Service Responsibility Boundaries

| Service | Responsibility | Owns |
|---|---|---|
| `BoardStateService` | Holds board state signal + computed derivations, provides zone queries, handles initialization/reset, deck operations (shuffle, draw logic, mill). Also owns cross-cutting UI interaction signals: `hoveredCard` (with 50ms debounce) and `isDragging` — needed by multiple components for pill/overlay/inspector suppression. | `boardState` signal, all computed zone signals, `hoveredCard` signal, `isDragging` signal |
| `CommandStackService` | Exposes semantic action methods (`moveCard()`, `drawCard()`, `flipCard()`, etc.), creates and executes commands internally, manages undo/redo stacks, exposes `canUndo`/`canRedo` | `undoStack`, `redoStack` signals, Command class instantiation |

- Only 2 services for the simulator — no DeckService (deck operations are trivial methods in BoardStateService)
- Command classes are internal to CommandStackService — components never see them
- If a new concern emerges, prefer adding a method to an existing service over creating a new one

**Collapsible Navbar Signal Flow:**
- The navbar collapse state (`navbarCollapsed` signal) lives in the **NavbarComponent** (or a shared app-level service if multiple components need it). It is NOT a simulator service concern.
- The route drives the initial collapse state — `SimulatorPageComponent` sets `navbarCollapsed = true` on init.
- `BoardComponent` reads the navbar width (or collapsed state) to compute its scale factor. This can be done via a `ResizeObserver` on the viewport area beside the board, or by reading `navbarCollapsed` and computing available width = `window.innerWidth - navbarWidth`.
- Navbar toggle state is **ephemeral** — not persisted across navigations.
- → See UX spec for visual behavior (widths, default states per page, dark theme).

### Component Communication Patterns

**Parent → Child:** Signal-based inputs (`input<ZoneId>()`, `input<CardInstance>()`)
**Child → Parent:** Signal-based outputs (`output<DragDropEvent>()`) for user actions
**Cross-component (non-hierarchical):** Via injected services (BoardStateService, CommandStackService) — no event bus, no RxJS subjects for state

### Drag & Drop Orchestration Pattern

- `cdkDropListGroup` on BoardComponent to auto-connect all zone drop lists
- Each ZoneComponent / HandComponent registers as `cdkDropList` with its `ZoneId` as data
- `cdkDropListSortingDisabled: true` on all single-card zones (performance + no reorder needed)
- `cdkDropListSortingDisabled: false` on HandComponent only (reorder allowed)
- `cdkDropListEnterPredicate` on single-card zones to reject drop when occupied
- On `cdkDragDrop` event: component extracts `fromZone`, `toZone`, `cardId`, `indices` → calls `CommandStackService`

### Context Menu Pattern

- `event.preventDefault()` on `contextmenu` event on the **entire board** in all builds (including `isDevMode()`). The native browser context menu is never shown on the board. The navbar retains native context menu.
- `mat-menu` used directly for all context menus — no custom component. Consistent with the "no new abstractions" principle.
- Menu items are dynamic, computed from current card/zone state.
- → See UX spec for specific menu items per zone type.

### Error Handling Patterns

- Invalid drops (zone full, same zone): silently ignored — no toast, no error. Card returns to origin via CDK default behavior.
- Empty deck draw attempt: visual feedback on deck zone (brief highlight/shake), no toast. Prevented by `isDeckEmpty` computed disabling draw actions.
- Drop handlers in components wrap `CommandStackService` calls in try/catch — catch blocks silently ignore errors and let CDK return the card to its origin. Commands themselves operate on known-good state; the try/catch guards against unexpected runtime errors. If state is corrupted, reset is the recovery path.

### Debug Observability Pattern

- Debug counter removed per UX audit. No dev-only debug UI on the simulator board.
- Debugging relies on browser DevTools + Angular DevTools signal inspection.

### Enforcement Guidelines

**All AI Agents MUST:**
- Follow the canonical action flow — never bypass CommandStackService for state changes
- Use computed signals for zone data in templates — never read boardState directly in components
- Create commands with all delta data at construction time — commands must be self-contained
- Use `ZoneId` enum values for all zone references — never raw strings
- Call CommandStackService semantic methods — never instantiate Command classes from components

**Anti-Patterns to Avoid:**
- Direct `boardState.update()` from a component — always go through CommandStackService
- Creating a new service for a single method — add to existing services
- Using RxJS Subjects for state that should be signals
- Storing UI-only state (overlay open/closed, drag preview) in BoardStateService — keep UI state in components. Exception: `isDragging` and `hoveredCard` are cross-cutting interaction signals that live in BoardStateService because multiple components need them for suppression logic.
- Exposing Command classes outside of CommandStackService
- Treating `faceDown` as hidden information — in a solo simulator, the player knows all their own cards. `faceDown` is a **positional state** (gameplay choice), not an information barrier. The card inspector always shows full details regardless of face-down state. Extra Deck overlay displays all cards face-up (owner knows ED contents). Deck/ED zones display a card-back image when `count > 0` (never appear visually empty).

## Responsive Strategy

### Two-Track Approach

The application follows a two-track responsive strategy, determined by page type:

**Track A — Fixed Canvas Scaling (Card Manipulation Pages)**

Pages where cards are the primary content and spatial layout is critical:
- Simulator (`/decks/:id/simulator`) — already implemented
- Deck Builder (`/decks/builder`, `/decks/:id`)
- Card Search (`/search`)

Fixed internal resolution per page, `transform: scale()` to fit viewport. The canvas structure is invariant — only the scale factor changes. No breakpoints, no responsive layout changes for the canvas area.

**Hybrid layout pattern** for deck builder and card search: responsive search/filter header (Track B patterns) above the scaled canvas. The header uses standard responsive CSS and contains search inputs, filter controls, and action buttons. The canvas below contains the card grid/workspace and uses fixed scaling. The boundary is clear: **interactive controls that don't require spatial card layout go in the header; everything involving card arrangement goes in the canvas**.

**Track B — Responsive CSS (Content/Utility Pages)**

Pages where content flows naturally and card spatial layout is not required:
- Deck List (`/decks`)
- Settings (`/parameters`)
- Login (`/login`)

Mobile-first CSS with breakpoints:

| Breakpoint | Name | Target |
|---|---|---|
| ≤576px | Mobile | Phone portrait |
| 577–768px | Tablet | Tablet portrait / phone landscape |
| 769–1024px | Desktop-small | Laptop / small desktop |
| >1024px | Desktop | Standard desktop |

Standard responsive patterns: fluid grid, stacking columns, adjusted spacing. No canvas scaling needed.

**Cross-Track Navigation:** When users navigate from a Track B page (e.g., deck list) to a Track A page (e.g., deck builder), the layout paradigm shifts (fluid → fixed canvas) and the navbar may change mode (expanded → collapsed). This transition should be validated during implementation to ensure it feels natural and not jarring.

### ScalingContainerDirective

Shared autonomous directive extracted from the simulator's BoardComponent scaling logic. Provides canvas scaling for any Track A page.

**Interface:**

```ts
@Directive({ selector: '[appScalingContainer]', standalone: true })
export class ScalingContainerDirective {
  aspectRatio = input<number>(16 / 9);     // internal canvas aspect ratio
  referenceWidth = input<number>(1920);    // internal logical width
  scale = output<number>();                // emits computed scale factor (debug/UI)
}
```

**Behavior:**
- Observes parent element dimensions via `ResizeObserver`
- Computes `scale = min(parentWidth / refWidth, parentHeight / refHeight)` where `refHeight = referenceWidth / aspectRatio`
- Applies `transform: scale(scale)` and `transform-origin: top center` on the host element
- Reactive: recalculates on parent resize (viewport change, navbar toggle)
- Measures the **parent container**, not the viewport — navbar awareness comes naturally from the DOM layout

**Critical constraint:** The parent container **must have an explicit height** (e.g., `height: 100vh`, `height: calc(100vh - headerHeight)`) — not `height: auto`. A `ResizeObserver` on an auto-height parent will not detect viewport changes correctly. This applies to all Track A pages.

**`referenceWidth` is per-page:** Each Track A page has its own internal logical width based on its content density. The simulator uses 1920 (full-width board). The deck builder and card search will have different values determined during implementation. This is not a "set and forget" parameter — it must be calibrated for each page's canvas layout.

**Usage examples:**

```html
<!-- Simulator board -->
<div class="canvas-parent" style="height: 100vh">
  <div appScalingContainer [aspectRatio]="16/9" [referenceWidth]="1920">
    <app-sim-board />
  </div>
</div>

<!-- Deck builder: responsive header + scaled canvas -->
<div class="deck-builder-page">
  <header class="responsive-header"><!-- filters, search --></header>
  <div class="canvas-parent" style="height: calc(100vh - var(--header-height))">
    <div appScalingContainer [aspectRatio]="16/9" [referenceWidth]="1600">
      <app-deck-canvas />
    </div>
  </div>
</div>
```

**Migration:** The simulator's BoardComponent delegates its existing scaling logic to this directive. The scale computation and `ResizeObserver` setup are removed from BoardComponent and replaced by the directive on its container element. The navbar awareness (`navbarCollapsed` signal → available width) is no longer needed in BoardComponent — the parent container naturally resizes when the navbar toggles, and the directive's `ResizeObserver` picks up the change.

### Navbar Responsive Behavior

The existing collapsible navbar (chevron toggle, ~32px collapsed state) extends with a responsive mode switch:

| Viewport | Navbar Mode | Default State |
|---|---|---|
| >768px (desktop) | Collapsible sidebar | Expanded (except simulator: collapsed) |
| ≤768px (mobile/tablet) | Hamburger + drawer overlay | Hidden |

**Technical mechanism:**
- NavbarComponent uses CDK `BreakpointObserver` to detect viewport width crossing the 768px threshold
- Desktop mode: existing sidebar behavior unchanged (chevron toggle, collapsed/expanded)
- Mobile mode: hamburger icon button in a fixed top bar, navbar content slides in as a drawer overlay (`mat-sidenav` or equivalent)
- On Track A pages (mobile): the fixed top bar with hamburger reduces available vertical space. The ScalingContainerDirective's parent must account for this header height (e.g., `height: calc(100vh - var(--mobile-header-height))`)
- ScalingContainerDirective is otherwise unaffected on mobile — no sidebar present, full viewport width available to the parent container

**Breakpoint source of truth:** `768px` is the single breakpoint for navbar mode switch. Defined as SCSS variable `$navbar-breakpoint` in `_responsive.scss` and matched in TypeScript via CDK `BreakpointObserver`.

## Shared Component Extraction

### Extraction Strategy

Three components are extracted into a shared `components/` directory for reuse across simulator, deck builder, and card search pages.

| Extracted Component | Source | Target Location | Selector Change |
|---|---|---|---|
| `CardComponent` | `SimCardComponent` | `components/card/` | `app-sim-card` → `app-card` |
| `CardInspectorComponent` | `SimCardInspectorComponent` | `components/card-inspector/` | `app-sim-card-inspector` → `app-card-inspector` |
| `ScalingContainerDirective` | new (logic from BoardComponent) | `components/scaling-container/` | n/a (directive) |

### Extraction Principles

1. **Extract, don't rewrite** — The simulator versions are the starting point. Extract with minimal changes, then harmonize with existing deck builder equivalents
2. **Context-agnostic interface** — Extracted components work without knowledge of their consumer (simulator, deck builder, card search). No simulator-specific logic in shared components
3. **Signal-based inputs** — All extracted components use Angular signal inputs (`input<T>()`) for consistency with the simulator architecture
4. **Multi-mode activation** — The `CardInspectorComponent` must support multiple activation modes via configuration (hover-triggered for simulator, click-triggered or permanently visible for deck builder). The exact modes are defined in story 8.1, but the architecture mandates that the component is mode-agnostic — activation logic is an input, not hardcoded
5. **Harmonization analysis first** — Story 8.1 performs a comparative analysis of existing interfaces before extraction. The analysis defines the exact unified contract
6. **Simulator must not regress** — After extraction, the simulator imports shared components and works identically. Manual testing validates no regression

### Harmonization Scope (Deferred to Story 8.1)

The architecture intentionally does NOT define the exact unified interface for extracted components. Story 8.1 will:
- Compare existing deck builder card/inspector components with simulator versions
- Identify input/output divergences and visual/behavioral differences
- **Verify selector collision risk** — an existing `app-card` component in the deck builder would conflict with the extracted shared `CardComponent`. The analysis must identify and resolve naming conflicts before extraction begins
- Define the unified contract (inputs, outputs, CSS custom properties for theming)
- Produce a migration plan (which files change, in which order)

### Shared SCSS Infrastructure

| File | Purpose |
|---|---|
| `src/app/styles/_canvas-scaling.scss` | Mixins and host styles for Track A canvas scaling (letterboxing, transform-origin, container setup) |
| `src/app/styles/_responsive.scss` | Breakpoint variables (`$navbar-breakpoint`, `$bp-mobile`, `$bp-tablet`, `$bp-desktop-sm`), responsive mixins (mobile-first media queries), shared responsive utilities |

These files extend the existing `src/app/styles/` directory. Consumed by both shared components and page-level SCSS.

## Project Structure & Boundaries

### Complete Simulator Directory Structure

_Only new files shown. Existing project structure (`components/`, `services/`, `core/`, other `pages/`) remains unchanged._

```
front/src/app/
├── pages/
│   └── simulator/                          # NEW — all simulator code lives here
│       ├── simulator-page.component.ts     # Page container — loads deck, orchestrates
│       ├── simulator-page.component.html
│       ├── simulator-page.component.scss
│       ├── board.component.ts              # Game board — CSS grid layout of 18 zones
│       ├── board.component.html
│       ├── board.component.scss
│       ├── zone.component.ts               # Reusable single-card zone (Monster, S/T, EMZ, Field, Pendulum)
│       ├── zone.component.html
│       ├── zone.component.scss
│       ├── stacked-zone.component.ts       # Stack zones (Deck, Extra, GY, Banish) — count + top card
│       ├── stacked-zone.component.html
│       ├── stacked-zone.component.scss
│       ├── hand.component.ts               # Hand zone — ordered, reorderable
│       ├── hand.component.html
│       ├── hand.component.scss
│       ├── sim-card.component.ts           # Card rendering — face-up/down, ATK/DEF, drag handle
│       ├── sim-card.component.html
│       ├── sim-card.component.scss
│       ├── pile-overlay.component.ts       # Pile inspection overlay — 3 modes (browse, search, reveal)
│       ├── pile-overlay.component.html
│       ├── pile-overlay.component.scss
│       ├── xyz-material-peek.component.ts  # XYZ overlay material pill — material borders + drag-to-detach
│       ├── xyz-material-peek.component.html
│       ├── xyz-material-peek.component.scss
│       ├── card-inspector.component.ts     # Hover-triggered card detail side panel (replaces card-tooltip in simulator)
│       ├── card-inspector.component.html
│       ├── card-inspector.component.scss
│       ├── control-bar.component.ts        # Undo/Redo/Reset buttons + keyboard shortcut hints
│       ├── control-bar.component.html
│       ├── control-bar.component.scss
│       ├── board-state.service.ts          # Board state signal + computed derivations + deck ops
│       ├── command-stack.service.ts         # Semantic action methods + command creation + undo/redo
│       ├── simulator.models.ts             # ZoneId enum, CardInstance, SimCommand interface, zone config
│       └── commands/                       # Internal command classes (only imported by command-stack.service)
│           ├── index.ts                    # Barrel export
│           ├── move-card.command.ts
│           ├── draw-card.command.ts
│           ├── shuffle.command.ts
│           ├── flip-card.command.ts
│           ├── toggle-position.command.ts
│           ├── reorder-hand.command.ts
│           └── composite.command.ts
├── app.routes.ts                           # MODIFIED — add simulator route
```

### Naming Conventions

**Component Selectors:** All simulator components use the `app-sim-` prefix to avoid collisions with existing components (e.g., existing `app-card` vs simulator's `app-sim-card`).
- `app-sim-board`, `app-sim-zone`, `app-sim-stacked-zone`, `app-sim-hand`, `app-sim-card`, `app-sim-pile-overlay`, `app-sim-xyz-material-peek`, `app-sim-card-inspector`, `app-sim-control-bar`

### Route Addition

```ts
// In app.routes.ts — add:
{ path: 'decks/:id/simulator', component: SimulatorPageComponent, canActivate: [AuthService] }
```

### Overlay Component Modes

The overlay component serves three distinct use cases via a `mode` input:

| Mode | Use Case | Behavior |
|---|---|---|
| `search` | Deck search (FR18) | Shows all deck cards, player picks one to move to target zone |
| `inspect` | View stacked zone (FR22-23) | Shows all cards in a stacked zone (GY, Banish, Extra Deck), player can pick and move |
| `reveal` | Reveal/excavate (FR20) | Shows top N cards from deck, player can move or return them |

Single component, single template — mode determines which cards are displayed and what actions are available.

### Architectural Boundaries

**Component Boundaries:**
- `SimulatorPage` ← only component that injects route params and loads deck data from existing `DeckBuildService`
- `Board`, `Zone`, `StackedZone`, `Hand` ← receive data via signal inputs, emit user actions via outputs
- `SimCard` ← pure presentation, receives `CardInstance` input. If XYZ with materials: renders material peek borders and delegates to `XyzMaterialPeek`.
- `PileOverlay` ← opened/closed by parent component, receives zone data and mode as inputs
- `XyzMaterialPeek` ← pill overlay for XYZ material management, CDK drag sources for detach
- `CardInspector` ← hover-triggered side panel for card detail (replaces existing card-tooltip in simulator context)
- `ControlBar` ← Undo/Redo/Reset buttons with keyboard shortcut hints

**Service Boundaries:**
- `BoardStateService` ← owns all state, provides computed derivations. No component writes to it directly.
- `CommandStackService` ← the ONLY way to mutate board state. Injects `BoardStateService` internally. Exposes semantic methods to components.
- `commands/` folder ← internal implementation detail of `CommandStackService`. No component imports from here.

**Reuse of Existing Code:**
- `Card` model from `core/model/card.ts` ← card data reference in `CardInstance`
- `DeckBuildService` or deck data service ← loads deck card list for initialization
- `AuthService` ← route guard, unchanged
- Card images ← existing image paths, unchanged

### Requirements to Structure Mapping

| FR Category | Files |
|---|---|
| Simulation Init (FR1-5) | `simulator-page.component.ts`, `board-state.service.ts` |
| Card Movement (FR6-10) | `zone.component.ts`, `hand.component.ts`, `board.component.ts`, `command-stack.service.ts`, `move-card.command.ts` |
| Card Actions (FR11-17) | `command-stack.service.ts`, `move-card.command.ts`, `draw-card.command.ts` |
| Deck Operations (FR18-21) | `pile-overlay.component.ts`, `board-state.service.ts`, `composite.command.ts` |
| Zone Inspection (FR22-24) | `stacked-zone.component.ts`, `pile-overlay.component.ts`, `xyz-material-peek.component.ts` |
| Card State (FR25-28) | `sim-card.component.ts`, `flip-card.command.ts`, `toggle-position.command.ts`, `card-inspector.component.ts` |
| Session Mgmt (FR29-34) | `command-stack.service.ts`, `control-bar.component.ts`, `board.component.ts` (shortcuts) |

### Data Flow

```
DeckBuildService (existing) → loads deck data
  → SimulatorPage initializes BoardStateService with card instances
    → BoardStateService.boardState signal (source of truth)
      → computed signals per zone (hand, monster1, graveyard, etc.)
        → Components read computed signals (OnPush re-render)
          → User action → CommandStackService.moveCard() / drawCard() / etc.
            → Command.execute() → BoardStateService.boardState.update()
              → cycle continues
```

### Shared Infrastructure (Epics 7-8)

_New shared files added by the responsive and component extraction work. The simulator directory structure documented above remains valid during Epics 1-6. Post-Epic 8, `sim-card.component.*` and `card-inspector.component.*` in `pages/simulator/` are replaced by shared equivalents imported from `components/`. All existing references to `app-sim-card` and `app-sim-card-inspector` selectors in this document apply to the shared `app-card` and `app-card-inspector` selectors post-extraction._

```
front/src/app/
├── components/                               # EXTENDED — shared components
│   ├── card/                                 # NEW — extracted from SimCardComponent
│   │   ├── card.component.ts
│   │   ├── card.component.html
│   │   └── card.component.scss
│   ├── card-inspector/                       # NEW — extracted from SimCardInspectorComponent
│   │   ├── card-inspector.component.ts
│   │   ├── card-inspector.component.html
│   │   └── card-inspector.component.scss
│   └── scaling-container/                    # NEW — ScalingContainerDirective
│       └── scaling-container.directive.ts
├── styles/                                   # EXTENDED — shared SCSS
│   ├── _canvas-scaling.scss                  # NEW — Track A scaling mixins
│   └── _responsive.scss                      # NEW — breakpoints, responsive mixins
```

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All technology choices are compatible — Angular 19.1.3, CDK DragDrop, TypeScript 5.5.4 strict, signals, OnPush. Zero new dependencies, zero version conflicts.

**Pattern Consistency:** Signal-based state management aligns with OnPush rendering. Command pattern with immutable updates ensures predictable state flow. Canonical action flow eliminates ambiguity in how state changes propagate.

**Structure Alignment:** Project structure directly supports all patterns — colocated simulator code, encapsulated commands folder, clear service boundaries.

### Requirements Coverage Validation ✅

**Functional Requirements:** 34/34 FRs fully covered by architectural decisions and mapped to specific files.

**Non-Functional Requirements:** 10/10 NFRs addressed — performance via signals + OnPush + CDK optimizations, security via existing auth, compatibility via existing build pipeline.

### Implementation Readiness Validation ✅

**Decision Completeness:** All critical and important decisions documented with rationale.

**Structure Completeness:** Every file defined, every component named, every boundary documented. FR-to-file mapping explicit.

**Pattern Completeness:** Naming conventions, action flow, error handling, debug observability, enforcement guidelines, and anti-patterns all specified.

### Service Scoping Decision

**BoardStateService and CommandStackService are provided via `providers` on SimulatorPageComponent** (not `providedIn: 'root'`). This is a documented exception to the project-context pattern — justified by the ephemeral nature of simulation state. Each navigation to the simulator creates fresh service instances, ensuring a clean board when returning after deck edits (per User Journey 2).

### Gap Analysis Results

**Critical Gaps:** None.
**Important Gaps:** None — keyboard shortcut specifics are implementation-level detail.
**Nice-to-Have:** Board CSS grid wireframe recommended as a separate UX artifact.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (medium)
- [x] Technical constraints identified (frontend-only, brownfield, big bang)
- [x] Cross-cutting concerns mapped (6 concerns)

**✅ Architectural Decisions**
- [x] Critical decisions documented (data model, zones, commands, components)
- [x] Technology stack fully specified (all existing, zero new deps)
- [x] Integration patterns defined (service injection, signal inputs/outputs)
- [x] Performance considerations addressed (OnPush, computed per zone, CDK optimizations)

**✅ Implementation Patterns**
- [x] Naming conventions established (signal naming, selector prefix, ZoneId enum)
- [x] Structure patterns defined (2 services scoped to component, commands encapsulated)
- [x] Communication patterns specified (inputs/outputs, service injection, no event bus)
- [x] Process patterns documented (action flow, error handling, debug panel)

**✅ Project Structure**
- [x] Complete directory structure defined (all files listed)
- [x] Component boundaries established (who reads/writes what)
- [x] Integration points mapped (existing services reused)
- [x] Requirements to structure mapping complete (FR → file table)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Clean separation: 2 services scoped to component, commands encapsulated, clear boundaries
- Performance-first: signals + computed + OnPush from the ground up
- Predictable state: canonical action flow, zero direct mutations
- Brownfield-native: fits seamlessly into existing project structure

**Areas for Future Enhancement (Post-MVP):**
- Board CSS grid wireframe/layout specification
- Token creation architecture (Phase 2)
- Board state serialization for save/load (Phase 3)

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:** Create `simulator-page.component.ts` with `providers: [BoardStateService, CommandStackService]` and register route `/decks/:id/simulator` in `app.routes.ts`.
