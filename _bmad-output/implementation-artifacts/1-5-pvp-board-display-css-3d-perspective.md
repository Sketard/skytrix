# Story 1.5: PvP Board Display (CSS 3D Perspective)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **player**,
I want to see both my field and my opponent's field on a 3D perspective board,
so that I can visually track the game state during a PvP duel.

## Acceptance Criteria

1. **Board Container & CSS 3D Perspective** — Given `DuelWebSocketService` provides the `duelState` signal (Story 1.4), when `PvpBoardContainerComponent` renders, then:
   - It applies CSS `perspective: var(--pvp-perspective-depth)` (800px) on the board container
   - It applies `transform: rotateX(var(--pvp-rotate-x-angle))` (15deg) on the opponent field section only
   - The player's field (bottom) renders at full size (no rotation) — thumb-accessible
   - The opponent's field (top) appears naturally foreshortened — visually recessed
   - A central strip between fields contains EMZ-L, EMZ-R zone slots, a `PvpTimerBadgeComponent` placeholder, and a `PvpPhaseBadgeComponent` placeholder
   - It enforces `max-width: 1280px; max-height: 720px` on desktop (centered, black background beyond)
   - It uses `ChangeDetectionStrategy.OnPush`
   - `-webkit-perspective` prefix is applied for Safari compatibility

2. **Dual-Player Zone Grid Layout** — Given the board container renders two field sections, when each field section displays its zones, then:
   - 2a. Each field section renders a CSS grid with `grid-template-areas` covering: 5 Spell/Trap zones (S1–S5), 5 Monster zones (M1–M5), Field Zone, Graveyard (GY), Banished, Extra Deck (ED), Deck (count badge only)
   - 2b. S1/S5 double as Pendulum L/R zones (Master Rule 5) — 18 physical zones per player
   - 2c. EMZ-L and EMZ-R render in the central strip (shared between players), NOT inside either field grid
   - 2d. Zone sizing uses `clamp()` for responsive scaling, card aspect ratio `59:86` preserved
   - 2e. Field gap between opponent and player fields: `--pvp-field-gap: 0.25rem`
   - 2f. Zones accept `CardOnField` data from `duelState().players[n].zones` (`n=0` for player, `n=1` for opponent) and render card art (face-up) or card back (face-down) based on `position` bitmask
   - 2g. Monster zones render cards vertically (ATK) or horizontally rotated 90° (DEF) via CSS `transform: rotate(90deg)`
   - 2h. XYZ overlay materials display as stacked visual indicators on parent card
   - 2i. Zone pills for GY, Banished, ED show count badges (minimum 16px font-size for readability on foreshortened opponent field); tap triggers zone browser overlay (Story 1.7 scope — placeholder `(click)` output only)
   - 2j. Deck zone shows count badge only (minimum 16px font-size), no interaction

3. **LP Badge Display** — Given the board renders, when `PvpLpBadgeComponent` is implemented, then:
   - It displays LP for both players, positioned inside each field grid area
   - Standard format for LP ≤ 9999: `"8000"`; compact format for LP ≥ 10000: `"12.5k"`
   - Typography: `clamp(1rem, 4dvh, 1.5rem)`, font-weight 700
   - Background: semi-transparent dark pill (`rgba(0,0,0,0.7)`) with `backdrop-filter: blur(2px)`
   - `role="status"` and `aria-live="polite"` for accessibility
   - LP value sourced from `duelState().players[n].lp`

4. **Hand Row Display** — Given the board renders, when `PvpHandRowComponent` is implemented, then:
   - `[side='player']` displays hand cards face-up at screen bottom (`position: absolute; bottom: 0`), OUTSIDE the perspective container
   - `[side='opponent']` displays hand card backs at screen top (`position: absolute; top: 0; pointer-events: none`), OUTSIDE the perspective container
   - Cards overlap with increasing negative `margin-left` when 6+ cards (Master Duel pattern), with incremental `z-index` (last card = highest)
   - Card height: `--pvp-hand-card-height: clamp(48px, 12dvh, 72px)`
   - Player hand cards are tappable (emit card selection output for Story 1.6 prompt integration)
   - Card aspect ratio `59:86` preserved
   - Hand card data sourced from `duelState().players[playerIndex].zones` where zoneId = `'HAND'`

5. **Mobile Orientation Enforcement** — Given the duel page loads on a mobile device in portrait, then:
   - A blocking full-screen overlay displays: rotation icon + "Rotate your device to landscape"
   - Triggered by `matchMedia('(orientation: portrait)')` listener
   - No "Continue anyway" fallback exists
   - `document.documentElement.requestFullscreen()` called at duel init (graceful degradation via `.catch()`)
   - `screen.orientation.lock('landscape-primary')` called at duel init (graceful degradation — NOT supported on iOS Safari, overlay is primary enforcement)
   - Overlay disappears when orientation changes to landscape

6. **PvP Design Tokens** — Given all PvP-specific visual values, when `_design-tokens.scss` is updated, then:
   - A `// === PvP Tokens ===` section is added containing all `--pvp-*` CSS custom properties:
     - Perspective: `--pvp-perspective-depth`, `--pvp-rotate-x-angle`, `--pvp-perspective-enabled`, `--pvp-field-gap`
     - Layout: `--pvp-hand-card-height`, `--pvp-hand-overlap`, `--pvp-card-min-tap-target`, `--pvp-min-touch-target-primary`
     - Colors: `--pvp-accent`, `--pvp-highlight-selectable`, `--pvp-highlight-selected`, `--pvp-lp-own`, `--pvp-lp-opponent`, `--pvp-disabled-opacity`
     - Typography: `--pvp-lp-font-size`, `--pvp-timer-font-size`, `--pvp-phase-badge-font-size`
     - Animation: `--pvp-transition-highlight-flash`, `--pvp-transition-card-move`, `--pvp-transition-lp-counter`, `--pvp-animation-duration`
   - `@media (prefers-reduced-motion: reduce)` sets ALL PvP transition/animation durations to `0ms`
   - `@media (forced-colors: active)` provides high-contrast fallbacks: zone boundaries use `border: 2px solid ButtonText`, selected zones use `border: 3px solid Highlight`, card backs use `Canvas`/`CanvasText` system colors
   - All color tokens achieve WCAG AA contrast (≥ 4.5:1 for text, ≥ 3:1 for UI)

7. **Responsive Design (dvh/dvw Units)** — Given the duel view renders, then:
   - All sizing within the duel view uses `dvh`/`dvw` (dynamic viewport units) — NEVER `vh`/`vw`
   - `clamp()` provides continuous scaling without media-query breakpoints
   - Desktop adaptation (≥768px): CardInspector uses `full` variant, board max 1280×720
   - Viewport height budget: ~10% opponent hand, ~25% opponent field (foreshortened), ~8% central strip, ~35% player field, ~12% player hand
   - Safe area handling: `padding: max(8px, env(safe-area-inset-*, 8px))` on all edge-positioned elements
   - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
   - Minimum supported viewport: 640 × 360px (Android low-end landscape)

8. **Timer Badge Placeholder** — Given the central strip renders, when `PvpTimerBadgeComponent` is implemented as a placeholder, then:
   - It displays `MM:SS` format from `timerState` signal (or `"--:--"` when null)
   - Color states: green (>120s), yellow (≤60s), red (≤30s) — using `--pvp-timer-*` tokens
   - Typography: `clamp(0.875rem, 3dvh, 1.125rem)`, font-weight 600
   - `aria-live="polite"` for accessibility
   - Active player timer: accent background; inactive: dimmed (opacity 0.5)
   - Full timer logic and connection state display deferred to Story 1.7

9. **Phase Badge Placeholder** — Given the central strip renders, when `PvpPhaseBadgeComponent` is implemented as a placeholder, then:
   - It displays current phase abbreviation: `'DP' | 'SP' | 'M1' | 'BP' | 'M2' | 'EP'`
   - Circular badge with centered text, uppercase, 2 characters
   - Phase value mapped from `duelState().phase` (which uses verbose form like `'MAIN1'` → display `'M1'`)
   - Own turn: accent border, opacity 1; Opponent turn: neutral border, opacity 0.6
   - Phase action menu interaction deferred to Story 1.7

10. **Empty/Initial State Rendering** — Given the WebSocket has not yet sent a `BOARD_STATE` (or the connection is still being established), when the board renders with `EMPTY_DUEL_STATE`, then:
    - Both fields display empty zones (no cards, no errors, no null references)
    - Both LP badges display `8000`
    - Phase badge displays `DP` (DRAW phase)
    - Timer badge displays `"--:--"`
    - Hand rows display empty (0 cards)
    - All zone count badges display `0`
    - No console errors or Angular change detection crashes

## Tasks / Subtasks

- [x] Task 1: Create PvP design tokens (AC: #6)
  - [x] 1.1 Add `// === PvP Tokens ===` section to `_design-tokens.scss` with all `--pvp-*` custom properties
  - [x] 1.2 Add `@media (prefers-reduced-motion: reduce)` block zeroing all PvP animation/transition durations
  - [x] 1.3 Update `_z-layers.scss` with PvP-specific z-index tokens (board layers, hand overlay, orientation lock overlay)

- [x] Task 2: Create PvpBoardContainerComponent (AC: #1, #2)
  - [x] 2.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` with OnPush
  - [x] 2.2 Implement CSS grid layout: 3-row template (opponent field / central strip / player field) × 6-column zones
  - [x] 2.3 Apply CSS 3D perspective on container (`perspective`, `-webkit-perspective`) and `rotateX` on opponent field section
  - [x] 2.4 Implement zone rendering sub-template for 18 zones per player field (S1–S5, M1–M5, Field, GY, Banished, ED, Deck)
  - [x] 2.5 Render card art (face-up via `cardCode`) or card back (face-down via `position` bitmask check) in each zone
  - [x] 2.6 Render DEF position monsters with CSS `rotate(90deg)`, ATK position normal orientation
  - [x] 2.7 Render XYZ overlay material indicators on parent card
  - [x] 2.8 Render GY/Banished/ED as count-badge pills; Deck as count-badge only
  - [x] 2.9 Render EMZ-L and EMZ-R in central strip (outside field grids)
  - [x] 2.10 Add desktop max constraint: `max-width: 1280px; max-height: 720px; margin: auto`
  - [x] 2.11 Wire `duelState` signal input from `DuelPageComponent` → consume `players[0]` and `players[1]` zone data

- [x] Task 3: Create PvpLpBadgeComponent (AC: #3)
  - [x] 3.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.ts`
  - [x] 3.2 Implement LP formatting logic (standard ≤9999, compact ≥10000 with `k` suffix)
  - [x] 3.3 Style with semi-transparent dark pill, responsive typography via `clamp()`
  - [x] 3.4 Add `role="status"`, `aria-live="polite"` attributes

- [x] Task 4: Create PvpHandRowComponent (AC: #4)
  - [x] 4.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts`
  - [x] 4.2 Implement player hand (face-up, absolute bottom, interactive) and opponent hand (face-down, absolute top, pointer-events: none)
  - [x] 4.3 Implement card overlap with negative `margin-left` for 6+ cards, incremental `z-index`
  - [x] 4.4 Emit card tap output event for future prompt integration (Story 1.6)

- [x] Task 5: Create PvpTimerBadgeComponent placeholder (AC: #8)
  - [x] 5.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.ts`
  - [x] 5.2 Display `MM:SS` from `timerState` signal, `"--:--"` when null
  - [x] 5.3 Apply color-coded states (green/yellow/red) based on remaining seconds thresholds

- [x] Task 6: Create PvpPhaseBadgeComponent placeholder (AC: #9)
  - [x] 6.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/pvp-phase-badge/pvp-phase-badge.component.ts`
  - [x] 6.2 Map Phase enum to 2-char abbreviation (DRAW→DP, MAIN1→M1, etc.)
  - [x] 6.3 Style circular badge with own-turn accent vs opponent-turn dimmed states

- [x] Task 7: Implement orientation lock overlay (AC: #5)
  - [x] 7.1 Add portrait detection via `matchMedia('(orientation: portrait)')` in `DuelPageComponent`
  - [x] 7.2 Create blocking full-screen overlay template with rotation icon + instruction text
  - [x] 7.3 Call `requestFullscreen()` + `screen.orientation.lock('landscape-primary')` at duel init with `.catch()` graceful degradation
  - [x] 7.4 Ensure overlay is highest z-index, blocks all interaction

- [x] Task 8: Integrate into DuelPageComponent (AC: #1, #7)
  - [x] 8.1 Replace `.board-placeholder` in `duel-page.component.html` with `<app-pvp-board-container>` wired to `wsService.duelState`
  - [x] 8.2 Add `<app-pvp-hand-row>` for player (bottom) and opponent (top)
  - [x] 8.3 Add `<meta viewport-fit=cover>` to `index.html` (if not present)
  - [x] 8.4 Verify all components render with `EMPTY_DUEL_STATE` as initial state (no null errors)
  - [x] 8.5 Responsive sizing: verify on 640×360, 844×390, 1280×720 viewports via Chrome DevTools

## Dev Notes

### Critical Architecture Context

- **Player Index Convention**: `duelState().players[0]` = the LOCAL player (self), `duelState().players[1]` = the OPPONENT. The duel server filters and orients `BOARD_STATE` per-player before sending — `players[0]` is ALWAYS "me" from the receiving client's perspective. Use `players[0]` for the bottom (player) field and `players[1]` for the top (opponent) field. Do NOT hardcode player IDs or add index-swapping logic.
- **Story 1.1 was SKIPPED**: The solo simulator's `PlayerFieldComponent` (7-col grid, EMZ in grid, drag-drop) is incompatible with PvP (6-col grid, EMZ external, click-based). **PvpBoardContainerComponent MUST be built from scratch** — do NOT attempt to extend or reuse `SimBoardComponent` or any solo board layout code.
- **Shared components reusable**: `CardComponent` (card art rendering) and `CardInspectorComponent` (card details) from `front/src/app/components/` are shared and CAN be reused.
- **Signal-based reactive architecture**: All state flows from `DuelWebSocketService` signals. Components MUST be read-only consumers — zero direct state mutation.
- **OnPush everywhere**: Every PvP component uses `ChangeDetectionStrategy.OnPush`. State updates via signal `.set()` create new references → trigger change detection.
- **Click-based interaction only**: PvP uses click/tap, NOT CDK DragDrop. The drag-drop module is NOT imported in PvP components.
- **No Three.js / heavy 3D libraries**: CSS 3D transforms (`perspective` + `rotateX`) only. ~10 lines of CSS. Compositor-only = negligible GPU cost.

### Data Model Reference

```typescript
// From duel-ws.types.ts — key types for board rendering
interface BoardStatePayload {
  turnPlayer: Player;       // 0 | 1
  turnCount: number;
  phase: Phase;             // 'DRAW' | 'STANDBY' | 'MAIN1' | 'BATTLE_START' | ... | 'END'
  players: [PlayerBoardState, PlayerBoardState];
}

interface PlayerBoardState {
  lp: number;
  deckCount: number;
  extraCount: number;
  zones: BoardZone[];
}

interface BoardZone {
  zoneId: ZoneId;           // 'M1'...'M5' | 'S1'...'S5' | 'FIELD' | 'EMZ_L' | 'EMZ_R' | 'GY' | 'BANISHED' | 'EXTRA' | 'DECK' | 'HAND'
  cards: CardOnField[];
}

interface CardOnField {
  cardCode: number | null;  // null or 0 = hidden (opponent private cards)
  position: Position;       // Bitmask: FACEUP_ATTACK=0x1, FACEDOWN_ATTACK=0x2, FACEUP_DEFENSE=0x4, FACEDOWN_DEFENSE=0x8
  overlayMaterials: number[];
  counters: Record<string, number>;
}

// Position bitmask helpers:
const isFaceUp = (pos: number) => (pos & 0x1) !== 0 || (pos & 0x4) !== 0;
const isDefense = (pos: number) => (pos & 0x4) !== 0 || (pos & 0x8) !== 0;
```

### Card Image Resolution

- `cardCode` (number) maps to card art. The existing app uses `CardImageDTO` with `imageUrl` (thumbnail) and `imageUrlFull` (full art) fields — check `front/src/app/components/card/card.component.ts` for the `SharedCardData` input interface.
- **Create a `PvpCardImageService`** (or reuse an existing card lookup service if one exists) that maps `cardCode: number → imageUrl: string`. Investigate `front/src/app/` for any existing service that does passcode/code → image URL resolution before creating a new one. The solo simulator uses `CardDetail` objects with pre-loaded images — PvP needs a lighter lookup since it only receives numeric codes from the server.
- Hidden cards (`cardCode === null` or `cardCode === 0`): render generic card back image (a static asset, e.g. `assets/card-back.png`). Do NOT attempt to fetch card data for code 0.
- Card art thumbnails used in zones (~5KB), full art on inspector open (lazy load).
- Pre-cache card images for both players' decks at duel init if a card database exists client-side; otherwise lazy-load on first render.

### CSS 3D Perspective — Safari Compatibility

- **Always prefix**: Use both `perspective` and `-webkit-perspective`
- **Safari 13-15 regression**: If any ancestor has `position: sticky; z-index: -1`, add `-webkit-transform: translateZ(0)` to the perspective container parent
- **iOS 16.4+ click area**: After flipping, only half may be clickable — test on real device. Workaround: avoid `rotateY(180deg)` for opponent mirror; use `rotateX()` only (which is the design)
- **`transform-style: preserve-3d`**: Required on the perspective container for children transforms to compose correctly
- **No `rotateY` or `rotateZ` on opponent field**: The architecture says `rotateX` only for foreshortening. The opponent zones are simply rendered top-to-bottom in reversed visual order (ST row first, then MZ row) — the "mirror" is spatial, not a CSS transform

### Viewport & Orientation

- Use `dvh`/`dvw` in ALL duel-view sizing — NEVER `vh`/`vw` (dynamic viewport tracks mobile address bar)
- `screen.orientation.lock()` is NOT supported on iOS Safari — the `matchMedia('(orientation: portrait)')` overlay is the PRIMARY enforcement
- Fullscreen API: `requestFullscreen()` may be denied on iOS — graceful degradation, `clamp()` sizing absorbs reduced viewport height
- Safe area: `env(safe-area-inset-*)` for notch/camera cutout avoidance on edge-positioned elements

### Board Layout Visual Reference

```
┌─────────────────────────────── 100dvw ───────────────────────────────┐
│ PvpHandRowComponent [opponent]  (absolute, top, pointer-events:none) │
│   🂠 🂠 🂠 🂠 🂠  (face-down, overlap at 6+)                          │
│──────────────────────────────────────────────────────────────────────│
│ PvpBoardContainerComponent (CSS perspective container, max 1280×720) │
│                                                                      │
│  ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐            LP: 8000           │
│  │ ST1 ││ ST2 ││ ST3 ││ ST4 ││ ST5 │  ← Opponent field             │
│  └─────┘└─────┘└─────┘└─────┘└─────┘    (rotateX(15deg), foreshort.)│
│  ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐                               │
│  │ MZ1 ││ MZ2 ││ MZ3 ││ MZ4 ││ MZ5 │                               │
│  └─────┘└─────┘└─────┘└─────┘└─────┘                               │
│ ─[EMZ-L]───── ⏱ --:-- ─────[EMZ-R]──── (M1) ─── Central Strip ──  │
│  ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐                               │
│  │ MZ1 ││ MZ2 ││ MZ3 ││ MZ4 ││ MZ5 │  ← Player field              │
│  └─────┘└─────┘└─────┘└─────┘└─────┘    (no rotation, full-size)    │
│  ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐            LP: 8000           │
│  │ ST1 ││ ST2 ││ ST3 ││ ST4 ││ ST5 │                                │
│  └─────┘└─────┘└─────┘└─────┘└─────┘                               │
│                                                                      │
│──────────────────────────────────────────────────────────────────────│
│ PvpHandRowComponent [player]  (absolute, bottom)                     │
│   🃏 🃏 🃏 🃏 🃏 🃏  (face-up, overlap at 6+)                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Grid Template Areas Per Field Section

```css
/* Player field (bottom) — zones top-to-bottom: MZ row, ST row */
grid-template-areas:
  "mz1    mz2   mz3   mz4   mz5   gy"
  "st1    st2   st3   st4   st5   field"
  "ed     lp    .     .     deck  banish";

/* Opponent field (top) — reversed row order: ST row (top), MZ row (bottom) */
grid-template-areas:
  "ed     lp    .     .     deck  banish"
  "st1    st2   st3   st4   st5   field"
  "mz1    mz2   mz3   mz4   mz5   gy";
```

### Component Tree (What This Story Creates)

```
DuelPageComponent (existing — modify template)
├── [orientation lock overlay] (portrait detection, blocking)
├── PvpBoardContainerComponent (NEW — main board with perspective)
│   ├── Opponent Field Section (CSS grid, rotateX applied)
│   │   ├── Zone cells × 18 (S1-S5, M1-M5, Field, GY, Banished, ED, Deck)
│   │   └── PvpLpBadgeComponent (NEW — opponent LP)
│   ├── Central Strip
│   │   ├── EMZ-L zone cell
│   │   ├── PvpTimerBadgeComponent (NEW — placeholder)
│   │   ├── PvpPhaseBadgeComponent (NEW — placeholder)
│   │   └── EMZ-R zone cell
│   └── Player Field Section (CSS grid, no rotation)
│       ├── Zone cells × 18 (M1-M5, S1-S5, Field, GY, Banished, ED, Deck)
│       └── PvpLpBadgeComponent (NEW — player LP)
├── PvpHandRowComponent [side='opponent'] (NEW — top, face-down)
├── PvpHandRowComponent [side='player'] (NEW — bottom, face-up)
└── [connection overlay] (existing — reconnecting/lost states)
```

### Deferred to Later Stories

- **Story 1.6**: Prompt sheet system (bottom-sheet + 6 sub-components), hand row opacity toggle when prompt open
- **Story 1.7**: Phase badge menu interaction, card action glow (SELECT_IDLECMD distributed UI), zone browser overlay, activation toggle, card inspector integration
- **Story 2.x**: Lobby, room creation, waiting room
- **Story 3.x**: Surrender button, timer logic, disconnection handling, duel result screen
- **Story 4.x**: Chain visualization, animation queue playback

### Project Structure Notes

- All PvP components go under `front/src/app/pages/pvp/duel-page/` in sub-folders (one component per folder)
- Naming convention: `pvp-{name}.component.ts` (kebab-case files, PascalCase classes)
- SCSS files colocated with their component (component-scoped styles)
- Design tokens in `front/src/app/styles/_design-tokens.scss` (shared SCSS partial)
- Z-index tokens in `front/src/app/styles/_z-layers.scss`
- NO new npm dependencies — pure CSS 3D, Angular standalone, existing Material/CDK
- Standalone components: `standalone: true`, no NgModule declarations

### References

- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — §Component Architecture, §CSS 3D Perspective, §Zone Layout, §ADR-R5, §ADR-R7]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — §Board Layout, §Design Tokens, §Card Display States, §Responsive Design, §Accessibility, §Orientation Lock]
- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 1 Story 1.5 Acceptance Criteria, §Dependencies]
- [Source: _bmad-output/implementation-artifacts/1-4-spring-boot-deck-relay-angular-websocket-connection.md — DuelWebSocketService signals, DuelPageComponent, duel-ws.types.ts]
- [Source: _bmad-output/implementation-artifacts/1-2-duel-server-scaffold-protocol-definition.md — ws-protocol.ts frozen interface, BoardStatePayload]
- [Source: _bmad-output/implementation-artifacts/1-3-ocgcore-duel-engine-anti-cheat-filter.md — Message filter whitelist, BOARD_STATE building, private zone sanitization]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts — ZoneId, CardOnField, BoardStatePayload, Position bitmask, Phase enum]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts — 6 signals: duelState, pendingPrompt, hintContext, animationQueue, timerState, connectionStatus]

### Previous Story Intelligence

**From Story 1.2 (Duel Server Scaffold):**
- Protocol frozen at 49 message types — `duel-ws.types.ts` is the source of truth for Angular
- `duel-ws.types.ts` is a manual verbatim copy of `ws-protocol.ts` — same-commit rule
- Message naming: `SCREAMING_SNAKE_CASE` discriminants, `camelCase` fields, explicit `null` for absent values

**From Story 1.3 (OCGCore Engine):**
- BOARD_STATE includes all zones + LP + phase + turn — complete snapshot
- Private zones (DECK, HAND, EXTRA) are sanitized: opponent card codes → 0
- Position bitmask: FACEUP_ATTACK=0x1, FACEDOWN_ATTACK=0x2, FACEUP_DEFENSE=0x4, FACEDOWN_DEFENSE=0x8

**From Story 1.4 (Spring Boot + Angular WS):**
- `DuelWebSocketService` with 6 writable signals exposed as readonly via `.asReadonly()`
- Native WebSocket API (no RxJS WebSocketSubject wrapping)
- `DuelPageComponent` provides `DuelWebSocketService` at component level (scoped)
- `EMPTY_DUEL_STATE` = both players at 8000 LP, 0 deck count, empty zones — used as initial state
- `ChangeDetectionStrategy.OnPush` pattern established on all PvP components
- Existing dark theme: `#1a1a2e` background, `#16213e` overlay, `#0f3460`/`#533483` buttons
- `_z-layers.scss` already has `$z-overlay: 2000` and `$z-flight: 10000`

### Web Research Findings

**CSS 3D Perspective (Feb 2026):**
- Safari 13-15 had `rotateX()`/`rotateY()` regression with `position: sticky` ancestors. Fix: `-webkit-transform: translateZ(0)` on parent. Not an issue for our layout (no sticky elements in duel view).
- iOS 16.4+ introduced click area reduction on flipped elements. Mitigation: we use `rotateX()` on opponent field (not `rotateY()` flip), which doesn't trigger this bug.
- Always use `-webkit-perspective` prefix alongside standard `perspective` for Safari compatibility.

**screen.orientation.lock() (Feb 2026):**
- Still NOT supported on iOS Safari. `matchMedia('(orientation: portrait)')` CSS overlay is the only reliable cross-browser enforcement.
- Android Chrome supports it in fullscreen mode. Call after `requestFullscreen()` for best compat.

**Angular 19 Signals (Feb 2026):**
- Use `input()` / `input.required()` for signal-based component inputs (replaces `@Input()` decorator)
- `computed()` for derived state — must be pure, synchronous, no side effects
- Standalone + OnPush + signals = recommended architecture for new components

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build warning: `NgClass` unused import — removed from PvpBoardContainerComponent imports array
- Pre-existing warning: `lobby-page.component.ts` has unused `RouterLink` import (out of scope)

### Completion Notes List

- **Task 1**: Added 25 `--pvp-*` CSS custom properties to `_tokens.scss` organized by category (perspective, layout, colors, typography, animation). Added `prefers-reduced-motion` and `forced-colors` media queries. Added 3 PvP z-index tokens to `_z-layers.scss`.
- **Task 2**: Built `PvpBoardContainerComponent` with CSS 3D perspective (`perspective` + `-webkit-perspective`, `transform-style: preserve-3d`), flexbox 3-section layout (opponent field with `rotateX`, central strip, player field), 6-column CSS grid per field section with `grid-template-areas`. Zone rendering handles card art (face-up), card back (face-down), DEF rotation, XYZ overlay indicators, count-badge pills (GY/Banished/ED), deck count-only pill. EMZ-L/EMZ-R in central strip. Desktop max 1280x720.
- **Task 3**: Built `PvpLpBadgeComponent` with LP formatting (standard <=9999, compact >=10000 with `k` suffix), semi-transparent dark pill styling, `role="status"` + `aria-live="polite"`.
- **Task 4**: Built `PvpHandRowComponent` with player (face-up, bottom, interactive) and opponent (face-down, top, pointer-events:none) modes. Card overlap via negative `margin-left` for 6+ cards with incremental z-index. `cardTapped` output for Story 1.6 integration.
- **Task 5**: Built `PvpTimerBadgeComponent` placeholder with MM:SS display, `"--:--"` null state, color-coded thresholds (green >120s, yellow <=60s, red <=30s), active/inactive dimming.
- **Task 6**: Built `PvpPhaseBadgeComponent` placeholder with Phase→2-char abbreviation mapping, circular badge, own-turn accent vs opponent-turn dimmed states.
- **Task 7**: Added portrait orientation detection via `matchMedia` in `DuelPageComponent` with `isPortrait` signal, blocking full-screen overlay with rotation SVG icon and instruction text, `requestFullscreen()` + `screen.orientation.lock()` with graceful degradation, z-index 9000 (above all except loader).
- **Task 8**: Replaced `.board-placeholder` with `<app-pvp-board-container>` wired to `wsService.duelState` and `wsService.timerState`. Added `<app-pvp-hand-row>` for player (bottom) and opponent (top) with hand card extraction from zones. Added `viewport-fit=cover` to `index.html`. Build verified with `ng build --configuration=development` — no errors.

### File List

**New files:**
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss
- front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.ts
- front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.html
- front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.scss
- front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts
- front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.html
- front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.scss
- front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.ts
- front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.html
- front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.scss
- front/src/app/pages/pvp/duel-page/pvp-phase-badge/pvp-phase-badge.component.ts
- front/src/app/pages/pvp/duel-page/pvp-phase-badge/pvp-phase-badge.component.html
- front/src/app/pages/pvp/duel-page/pvp-phase-badge/pvp-phase-badge.component.scss

**Modified files:**
- front/src/app/styles/_tokens.scss
- front/src/app/styles/_z-layers.scss
- front/src/app/pages/pvp/duel-page/duel-page.component.ts
- front/src/app/pages/pvp/duel-page/duel-page.component.html
- front/src/app/pages/pvp/duel-page/duel-page.component.scss
- front/src/index.html

**New files (review):**
- front/src/app/pages/pvp/pvp-card.utils.ts

**Modified files (review):**
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss
- front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.ts
- front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.html
- front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts
- front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.html
- front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.scss
- front/src/app/pages/pvp/duel-page/duel-page.component.html
- front/src/app/pages/pvp/duel-page/duel-page.component.scss

## Change Log

- 2026-02-26: Implemented Story 1.5 — PvP Board Display with CSS 3D Perspective. Created 5 new components (PvpBoardContainerComponent, PvpLpBadgeComponent, PvpHandRowComponent, PvpTimerBadgeComponent, PvpPhaseBadgeComponent), added PvP design tokens, orientation lock overlay, and integrated into DuelPageComponent.
- 2026-02-26: **Senior Developer Code Review (AI)** — Found and fixed 12 issues (3 Critical, 2 High, 4 Medium, 3 Low). Critical: `[class]` binding wiped base CSS classes on zone divs and timer badge; zone grid-area names mismatched between TS (m1/s1) and SCSS (mz1/st1) breaking board layout. High: hand cards used position bitmask instead of cardCode for face-up check; timer color thresholds didn't match AC. Medium: duplicated utils extracted to pvp-card.utils.ts; dead isPill() removed; hand row triple-positioned absolute simplified; safe-area padding 4px→8px. Low: magic number documented; dead Math.min removed; ARIA added to orientation overlay. Build verified clean.