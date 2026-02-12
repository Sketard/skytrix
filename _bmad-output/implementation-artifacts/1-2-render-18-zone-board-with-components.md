# Story 1.2: Render 18-Zone Board with Components

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see the complete Yu-Gi-Oh! game board with all 18 zones and card rendering infrastructure,
so that the visual playmat is ready for card operations.

## Acceptance Criteria

1. **Given** the SimulatorPageComponent is loaded,
   **When** the board renders,
   **Then** a 7×4 CSS Grid displays all 18 zones using named `grid-template-areas`:
   - Row 1: `.` `.` `emz-l` `.` `emz-r` `.` `banish`
   - Row 2: `field` `m1` `m2` `m3` `m4` `m5` `gy`
   - Row 3: `ed` `st1` `st2` `st3` `st4` `st5` `deck`
   - Row 4: `controls` `hand` `hand` `hand` `hand` `hand` `.`
   **And** the board fills the full viewport height (`100vh`) with `$sim-bg` background.

2. **Given** the board is rendered,
   **When** I look at stacked zones (Deck, ED, GY, Banished),
   **Then** each displays a `mat-badge` with card count,
   **And** the badge is hidden when count is 0 (empty state per UX spec — `[matBadgeHidden]="count === 0"`),
   **And** the badge uses `$sim-accent-primary` background when visible.

3. **Given** the board is rendered,
   **When** I look at the hand zone,
   **Then** it shows a dashed border (`$sim-zone-border` with `border-style: dashed`) spanning 5 grid columns,
   **And** no placeholder text is shown — dashed border is the only empty state indicator.

4. **Given** `_sim-tokens.scss` is populated,
   **When** any simulator component imports it via `@use 'sim-tokens' as *`,
   **Then** all SCSS variables are available: `$sim-bg`, `$sim-surface`, `$sim-surface-elevated`, `$sim-accent-primary`, `$sim-accent-secondary`, `$sim-zone-border`, `$sim-zone-highlight`, `$sim-zone-glow-success`, `$sim-text-primary`, `$sim-text-secondary`, `$sim-overlay-backdrop`, `$sim-gap-zone`, `$sim-gap-card`, `$sim-padding-zone`, `$sim-padding-overlay`, `$sim-radius-zone`, `$sim-radius-card`.

5. **Given** a `CardInstance` is provided to `SimCardComponent`,
   **When** the component renders,
   **Then** it displays the card image face-up using `cardInstance.image.smallUrl`,
   **And** face-down cards display a CSS-rendered card back (`$sim-surface-elevated` with subtle border),
   **And** DEF position cards are rotated 90° clockwise via `transform: rotate(90deg)`,
   **And** the component selector is `app-sim-card`.

6. **Given** a single-card zone (Monster, S/T, EMZ, Field) is empty,
   **When** it renders,
   **Then** the zone label from `ZONE_CONFIG` is displayed in `$sim-text-secondary` at `0.75rem`,
   **And** the zone has a subtle border (`$sim-zone-border`) with `$sim-radius-zone` rounding,
   **And** the zone selector is `app-sim-zone`.

7. **Given** a stacked zone has cards,
   **When** it renders,
   **Then** the top card is shown (face-down for MAIN_DECK/EXTRA_DECK, face-up for GRAVEYARD/BANISH),
   **And** the `mat-badge` displays the card count,
   **And** the zone label is visible below the card area,
   **And** the zone selector is `app-sim-stacked-zone`.

8. **Given** all simulator components are created,
   **When** the build compiles,
   **Then** all component selectors use the `app-sim-` prefix,
   **And** all components are standalone with `ChangeDetectionStrategy.OnPush`,
   **And** `ng build --configuration development` completes without errors.

## Tasks / Subtasks

- [x] **Task 1: Populate `_sim-tokens.scss`** (AC: 4)
  - [x] 1.1: Replace placeholder content with full SCSS variable declarations
  - [x] 1.2: Define color tokens: `$sim-bg: #0a0e1a`, `$sim-surface: #111827`, `$sim-surface-elevated: #1e293b`, `$sim-accent-primary: #00d4ff`, `$sim-accent-secondary: #d4a017`, `$sim-zone-border: rgba(#00d4ff, 0.15)`, `$sim-zone-highlight: rgba(#00d4ff, 0.3)`, `$sim-zone-glow-success: rgba(#d4a017, 0.4)`, `$sim-text-primary: #f1f5f9`, `$sim-text-secondary: #94a3b8`, `$sim-error: #ef4444`, `$sim-overlay-backdrop: rgba(#0a0e1a, 0.7)`
  - [x] 1.3: Define spacing tokens: `$sim-gap-zone: 0.5rem`, `$sim-gap-card: 0.25rem`, `$sim-padding-zone: 0.5rem`, `$sim-padding-overlay: 1rem`, `$sim-radius-zone: 0.375rem`, `$sim-radius-card: 0.25rem`
  - [x] 1.4: Define card dimension token: `$sim-card-aspect-ratio: 59 / 86` (standard Yu-Gi-Oh! card ratio)

- [x] **Task 2: Create `SimCardComponent`** (AC: 5, 8)
  - [x] 2.1: Create `front/src/app/pages/simulator/sim-card.component.ts` (standalone, OnPush, selector `app-sim-card`)
  - [x] 2.2: Define required signal input: `cardInstance = input.required<CardInstance>()`
  - [x] 2.3: Define optional signal input: `size = input<'board' | 'hand'>('board')` for sizing variants
  - [x] 2.4: Create computed signal: `isFaceDown = computed(() => this.cardInstance().faceDown)`
  - [x] 2.5: Create computed signal: `isDefPosition = computed(() => this.cardInstance().position === 'DEF')`
  - [x] 2.6: Create `.html`: render `<img>` with `[src]="cardInstance().image.smallUrl"` when face-up, or a div with class `card-back` when face-down
  - [x] 2.7: Create `.scss`: card styling with `aspect-ratio: $sim-card-aspect-ratio`, `border-radius: $sim-radius-card`, `$sim-surface-elevated` background. DEF rotation via `transform: rotate(90deg)`. Face-down: `$sim-surface-elevated` with subtle inner border pattern. Import tokens via `@use 'sim-tokens' as *`
  - [x] 2.8: Card image uses `object-fit: cover` and `width: 100%` to fill the card area

- [x] **Task 3: Create `SimZoneComponent`** (AC: 1, 6, 8)
  - [x] 3.1: Create `front/src/app/pages/simulator/zone.component.ts` (standalone, OnPush, selector `app-sim-zone`)
  - [x] 3.2: Define required signal input: `zoneId = input.required<ZoneId>()`
  - [x] 3.3: Inject `BoardStateService`, create computed: `card = computed(() => this.boardState.boardState()[this.zoneId()]?.[0] ?? null)`
  - [x] 3.4: Create computed: `zoneConfig = computed(() => ZONE_CONFIG[this.zoneId()])` for label access
  - [x] 3.5: Create `.html`: show `app-sim-card` when `card()` is not null, otherwise show zone label text
  - [x] 3.6: Create `.scss`: zone box with `$sim-zone-border` border, `$sim-radius-zone` rounding, `$sim-padding-zone` padding, `$sim-surface` background. Empty state: label in `$sim-text-secondary` at `0.75rem` font-size, weight 500, centered. Import tokens via `@use 'sim-tokens' as *`
  - [x] 3.7: Add Pendulum indicator for ST1/ST5 — if `ZONE_CONFIG[zoneId].pendulum` exists, show a small "P-L" or "P-R" label in `$sim-text-secondary` at `0.625rem`

- [x] **Task 4: Create `SimStackedZoneComponent`** (AC: 2, 7, 8)
  - [x] 4.1: Create `front/src/app/pages/simulator/stacked-zone.component.ts` (standalone, OnPush, selector `app-sim-stacked-zone`)
  - [x] 4.2: Define required signal input: `zoneId = input.required<ZoneId>()`
  - [x] 4.3: Inject `BoardStateService`, create computed: `cards = computed(() => this.boardState.boardState()[this.zoneId()])`
  - [x] 4.4: Create computed: `cardCount = computed(() => this.cards().length)`
  - [x] 4.5: Create computed: `topCard = computed(() => this.cards().length > 0 ? this.cards()[this.cards().length - 1] : null)` — top of stack is last element
  - [x] 4.6: Create computed: `showFaceDown = computed(() => this.zoneId() === ZoneId.MAIN_DECK || this.zoneId() === ZoneId.EXTRA_DECK)` — Deck and ED show card backs
  - [x] 4.7: Create computed: `zoneConfig = computed(() => ZONE_CONFIG[this.zoneId()])` for label
  - [x] 4.8: Create `.html`: zone wrapper with `matBadge` showing `cardCount()`, `[matBadgeHidden]="cardCount() === 0"`. Inside: `app-sim-card` for top card (if exists, with face-down override for deck zones) or empty state. Zone label below.
  - [x] 4.9: Import `MatBadgeModule` in component imports array
  - [x] 4.10: Create `.scss`: zone styling similar to SimZoneComponent but with dimmed empty state (lower opacity). Badge positioned via `matBadgePosition="above after"`. `$sim-accent-primary` badge background override. Import tokens via `@use 'sim-tokens' as *`

- [x] **Task 5: Create `SimHandComponent`** (AC: 3, 8)
  - [x] 5.1: Create `front/src/app/pages/simulator/hand.component.ts` (standalone, OnPush, selector `app-sim-hand`)
  - [x] 5.2: Inject `BoardStateService`, use existing computed: `cards = computed(() => this.boardState.hand())`
  - [x] 5.3: Create computed: `isEmpty = computed(() => this.cards().length === 0)`
  - [x] 5.4: Create `.html`: flex container with `@for (card of cards(); track card.instanceId)` rendering `app-sim-card` instances with `size="hand"`. Empty state: only the dashed border is visible (no text).
  - [x] 5.5: Create `.scss`: horizontal flex layout with `$sim-gap-card` gap, `$sim-padding-zone` padding, `min-height` for empty state. Dashed border: `border: 1px dashed $sim-zone-border`, `$sim-radius-zone` rounding. Import tokens via `@use 'sim-tokens' as *`

- [x] **Task 6: Create `SimBoardComponent`** (AC: 1, 8)
  - [x] 6.1: Create `front/src/app/pages/simulator/board.component.ts` (standalone, OnPush, selector `app-sim-board`)
  - [x] 6.2: Import all child components: `SimZoneComponent`, `SimStackedZoneComponent`, `SimHandComponent` (SimCardComponent not needed — used by child components, not directly by board)
  - [x] 6.3: Expose `ZoneId` enum reference for template use: `protected readonly ZoneId = ZoneId`
  - [x] 6.4: Create `.html` with the 7×4 CSS Grid layout — 13 `app-sim-zone` instances + 4 `app-sim-stacked-zone` instances + 1 `app-sim-hand` + 1 controls placeholder div. Each zone positioned via `[style.grid-area]` binding matching the grid-template-areas
  - [x] 6.5: Create `.scss` with CSS Grid definition:
    ```
    grid-template-areas:
      ".        .     emz-l   .      emz-r   .      banish"
      "field    m1    m2      m3     m4      m5     gy"
      "ed       st1   st2     st3    st4     st5    deck"
      "controls hand  hand    hand   hand    hand   .";
    ```
    Using `grid-template-columns: minmax(60px, 1fr) repeat(5, minmax(70px, 1fr)) minmax(60px, 1fr)` and `grid-template-rows` with appropriate sizing. `gap: $sim-gap-zone`. Import tokens via `@use 'sim-tokens' as *`
  - [x] 6.6: Add `role="application"` and `aria-label="Yu-Gi-Oh simulator board"` on the board root element
  - [x] 6.7: Empty cells in row 1 (columns 1, 2, 4, 6) and row 4 (column 7) are rendered as invisible `<div>` elements or omitted (CSS Grid handles them via `.` in template-areas)

- [x] **Task 7: Update `SimulatorPageComponent`** (AC: 1)
  - [x] 7.1: Import `SimBoardComponent` in the component's `imports` array
  - [x] 7.2: Replace placeholder HTML with `<app-sim-board></app-sim-board>`
  - [x] 7.3: Update `.scss`: remove placeholder centering styles, set `.sim-page` to `height: 100vh`, `background: $sim-bg`, `overflow: hidden`

- [ ] **Task 8: Verify build** (AC: 8)
  - [x] 8.1: Run `ng build --configuration development` — must pass with zero errors
  - [ ] 8.2: Run `ng serve` and visually verify the empty board renders at `/decks/1/simulator`

## Dev Notes

### Critical Architecture Constraints

- **18 zones, NOT 20.** `SPELL_TRAP_1` doubles as Pendulum Left, `SPELL_TRAP_5` doubles as Pendulum Right (Master Rule 5). There are NO separate `PENDULUM_L`/`PENDULUM_R` zones — they are already encoded as ST1/ST5 with pendulum metadata in `ZONE_CONFIG`. [Source: architecture.md#Zone Identification]
- **Component selectors use `app-sim-` prefix.** Every new component: `app-sim-board`, `app-sim-zone`, `app-sim-stacked-zone`, `app-sim-hand`, `app-sim-card`. This avoids collision with existing components like `app-card`. [Source: architecture.md#Naming Conventions]
- **All standalone components with OnPush.** Every new component must use `standalone: true` and `changeDetection: ChangeDetectionStrategy.OnPush`. No NgModule. [Source: architecture.md#Component Implementation Strategy]
- **Services scoped to component.** `BoardStateService` and `CommandStackService` are already provided at `SimulatorPageComponent` level. New child components inject them directly — they share the same instance. Do NOT add new providers. [Source: architecture.md#Service Scoping Decision]
- **Signal-based inputs.** All inputs use Angular 19 signal inputs (`input()`, `input.required()`), not `@Input()` decorator. [Source: architecture.md#Component Communication Patterns]
- **Zero direct board state mutation.** Components read from `BoardStateService` computed signals only. No component calls `boardState.update()`. All mutations go through `CommandStackService` (not used in this story — components are read-only). [Source: architecture.md#Action Flow Pattern]

### Existing Code Integration Points

- **`BoardStateService.boardState`** — `WritableSignal<Record<ZoneId, CardInstance[]>>` initialized with empty arrays for all 18 zones. Components read zone data via `computed(() => this.boardState.boardState()[this.zoneId()])`. Also provides named computed signals: `hand`, `monster1`-`monster5`, `spellTrap1`-`spellTrap5`, `extraMonsterL`, `extraMonsterR`, `fieldSpell`, `mainDeck`, `extraDeck`, `graveyard`, `banish`, `isDeckEmpty`, `isExtraDeckEmpty`. [Source: `front/src/app/pages/simulator/board-state.service.ts`]
- **`ZONE_CONFIG`** — Constant in `simulator.models.ts` mapping each `ZoneId` to `{ type: 'single' | 'ordered' | 'stack', label: string, pendulum?: 'left' | 'right' }`. Use `ZONE_CONFIG[zoneId].label` for zone labels. ST1 has `pendulum: 'left'`, ST5 has `pendulum: 'right'`. [Source: `front/src/app/pages/simulator/simulator.models.ts`]
- **`CardInstance`** — Interface with `instanceId`, `card: CardDetail`, `image: CardImageDTO`, `faceDown: boolean`, `position: 'ATK' | 'DEF'`, `overlayMaterials?: CardInstance[]`. For card rendering, use `image.smallUrl` for board/hand cards. [Source: `front/src/app/pages/simulator/simulator.models.ts`]
- **`CardImageDTO`** — Contains `url: string` (full resolution) and `smallUrl: string` (thumbnail). The simulator uses `smallUrl` for board cards, `url` reserved for inspector (Story 3.2). [Source: `front/src/app/core/model/dto/card-image-dto.ts`]
- **`_sim-tokens.scss`** — Currently a placeholder file at `front/src/app/pages/simulator/_sim-tokens.scss`. Already imported by `simulator-page.component.scss` via `@use 'sim-tokens' as *`. All new component SCSS files should use the same import pattern. [Source: `front/src/app/pages/simulator/_sim-tokens.scss`]

### Component Implementation Guide

**SimCardComponent — Card Rendering (app-sim-card):**
```typescript
// Signal inputs
cardInstance = input.required<CardInstance>();
size = input<'board' | 'hand'>('board');

// Computed
isFaceDown = computed(() => this.cardInstance().faceDown);
isDefPosition = computed(() => this.cardInstance().position === 'DEF');
imageUrl = computed(() => this.cardInstance().image.smallUrl);
```
- Face-up: `<img [src]="imageUrl()" [alt]="cardInstance().card.card.name">` with `object-fit: cover`
- Face-down: CSS-rendered card back — `$sim-surface-elevated` background with `1px solid $sim-zone-border` and centered card-back pattern (no external image asset needed)
- DEF position: `transform: rotate(90deg)` on the host or card wrapper
- Card dimensions: `aspect-ratio: $sim-card-aspect-ratio` (59/86), `width: 100%` within zone

**SimZoneComponent — Single-Card Zone (app-sim-zone):**
```typescript
// Signal inputs
zoneId = input.required<ZoneId>();

// Injected
private boardState = inject(BoardStateService);

// Computed
card = computed(() => this.boardState.boardState()[this.zoneId()]?.[0] ?? null);
zoneConfig = computed(() => ZONE_CONFIG[this.zoneId()]);
isPendulum = computed(() => !!this.zoneConfig().pendulum);
```
- Empty state: zone label (`zoneConfig().label`) centered, `$sim-text-secondary`
- Occupied state: `<app-sim-card [cardInstance]="card()!">`
- Pendulum zones (ST1/ST5): small secondary label "P-L" or "P-R"

**SimStackedZoneComponent — Stacked Zone (app-sim-stacked-zone):**
```typescript
zoneId = input.required<ZoneId>();
private boardState = inject(BoardStateService);

cards = computed(() => this.boardState.boardState()[this.zoneId()]);
cardCount = computed(() => this.cards().length);
topCard = computed(() => {
  const c = this.cards();
  return c.length > 0 ? c[c.length - 1] : null;
});
showFaceDown = computed(() =>
  this.zoneId() === ZoneId.MAIN_DECK || this.zoneId() === ZoneId.EXTRA_DECK
);
zoneConfig = computed(() => ZONE_CONFIG[this.zoneId()]);
```
- `matBadge` bound to `cardCount()`, hidden when 0: `[matBadgeHidden]="cardCount() === 0"`
- Top card rendering: if `showFaceDown()` is true, override the card's faceDown to true for display (Deck/ED always show card backs). If false (GY/Banished), show card as-is.
- Empty state: dimmed (`opacity: 0.5`), zone label visible, no card image
- **Important:** The top card of a stack is the LAST element in the array (index `length - 1`). This is the card that would be "on top" of the pile.

**SimHandComponent — Hand Zone (app-sim-hand):**
```typescript
private boardState = inject(BoardStateService);
cards = computed(() => this.boardState.hand());
isEmpty = computed(() => this.cards().length === 0);
```
- Horizontal flex layout: `display: flex; gap: $sim-gap-card`
- Track by `card.instanceId` in `@for` loop
- Empty state: only dashed border visible, no text
- Hand cards use `size="hand"` on SimCardComponent for appropriate sizing

**SimBoardComponent — Board Layout (app-sim-board):**
```typescript
protected readonly ZoneId = ZoneId; // Expose enum to template
```
- CSS Grid with named areas matching the Yu-Gi-Oh! playmat
- Each zone component positioned via `[style.grid-area]` binding
- Controls area: empty `<div>` placeholder (SimControlBarComponent in Story 5)
- ARIA: `role="application"` and `aria-label="Yu-Gi-Oh simulator board"`
- No drag & drop infrastructure in this story (added in Story 2.2)

### CSS Grid Layout Specification

**Grid Template (exact from UX spec):**
```css
display: grid;
grid-template-areas:
  ".        .     emz-l   .      emz-r   .      banish"
  "field    m1    m2      m3     m4      m5     gy"
  "ed       st1   st2     st3    st4     st5    deck"
  "controls hand  hand    hand   hand    hand   .";
grid-template-columns: minmax(60px, 1fr) repeat(5, minmax(70px, 1fr)) minmax(60px, 1fr);
grid-template-rows: auto 1fr 1fr auto;
gap: $sim-gap-zone;
height: 100%;
```

**Column Strategy:**
- Columns 1 and 7 (side zones: Field/ED, GY/Banish/Deck) use `minmax(60px, 1fr)` — narrower side columns for stacked zones
- Columns 2-6 (central play zones: Monsters, S/T) use `minmax(70px, 1fr)` — primary zones get slightly more space

**Row Strategy:**
- Row 1 (EMZ + Banish): `auto` — minimal height, determined by zone content
- Row 2 (Monsters): `1fr` — equal share of available space
- Row 3 (Spell/Traps): `1fr` — equal share
- Row 4 (Hand + Controls): `auto` — minimal height for hand

**Zone Positioning in Template:**
```html
<!-- Row 1: Extra Monster Zones + Banish -->
<app-sim-zone [zoneId]="ZoneId.EXTRA_MONSTER_L" [style.grid-area]="'emz-l'"/>
<app-sim-zone [zoneId]="ZoneId.EXTRA_MONSTER_R" [style.grid-area]="'emz-r'"/>
<app-sim-stacked-zone [zoneId]="ZoneId.BANISH" [style.grid-area]="'banish'"/>

<!-- Row 2: Field + Monster Zones + GY -->
<app-sim-zone [zoneId]="ZoneId.FIELD_SPELL" [style.grid-area]="'field'"/>
<app-sim-zone [zoneId]="ZoneId.MONSTER_1" [style.grid-area]="'m1'"/>
<app-sim-zone [zoneId]="ZoneId.MONSTER_2" [style.grid-area]="'m2'"/>
<app-sim-zone [zoneId]="ZoneId.MONSTER_3" [style.grid-area]="'m3'"/>
<app-sim-zone [zoneId]="ZoneId.MONSTER_4" [style.grid-area]="'m4'"/>
<app-sim-zone [zoneId]="ZoneId.MONSTER_5" [style.grid-area]="'m5'"/>
<app-sim-stacked-zone [zoneId]="ZoneId.GRAVEYARD" [style.grid-area]="'gy'"/>

<!-- Row 3: ED + Spell/Trap Zones + Deck -->
<app-sim-stacked-zone [zoneId]="ZoneId.EXTRA_DECK" [style.grid-area]="'ed'"/>
<app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_1" [style.grid-area]="'st1'"/>
<app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_2" [style.grid-area]="'st2'"/>
<app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_3" [style.grid-area]="'st3'"/>
<app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_4" [style.grid-area]="'st4'"/>
<app-sim-zone [zoneId]="ZoneId.SPELL_TRAP_5" [style.grid-area]="'st5'"/>
<app-sim-stacked-zone [zoneId]="ZoneId.MAIN_DECK" [style.grid-area]="'deck'"/>

<!-- Row 4: Controls + Hand -->
<div [style.grid-area]="'controls'" class="controls-placeholder"></div>
<app-sim-hand [style.grid-area]="'hand'"/>
```

### SCSS Token Reference

All tokens defined in `_sim-tokens.scss` — exact values from UX Design Specification:

| Token | Value | Purpose |
|---|---|---|
| `$sim-bg` | `#0a0e1a` | Board background (deep navy) |
| `$sim-surface` | `#111827` | Zone surfaces, overlay backgrounds |
| `$sim-surface-elevated` | `#1e293b` | Cards, active overlays, face-down card back |
| `$sim-accent-primary` | `#00d4ff` | Interactive elements — highlights, badges, focus |
| `$sim-accent-secondary` | `#d4a017` | Status feedback — placement glow (not used in this story) |
| `$sim-zone-border` | `rgba(#00d4ff, 0.15)` | Zone borders at rest — subtle cyan |
| `$sim-zone-highlight` | `rgba(#00d4ff, 0.3)` | Drop zone highlight during drag (not used in this story) |
| `$sim-zone-glow-success` | `rgba(#d4a017, 0.4)` | Card placement glow (not used in this story) |
| `$sim-text-primary` | `#f1f5f9` | Primary text on dark background |
| `$sim-text-secondary` | `#94a3b8` | Zone labels, secondary text |
| `$sim-error` | `#ef4444` | Semantic error (rarely used) |
| `$sim-overlay-backdrop` | `rgba(#0a0e1a, 0.7)` | Overlay backdrop (not used in this story) |
| `$sim-gap-zone` | `0.5rem` | CSS Grid gap between zones |
| `$sim-gap-card` | `0.25rem` | Gap between cards in hand |
| `$sim-padding-zone` | `0.5rem` | Zone internal padding |
| `$sim-padding-overlay` | `1rem` | Overlay padding (not used in this story) |
| `$sim-radius-zone` | `0.375rem` | Zone border radius |
| `$sim-radius-card` | `0.25rem` | Card border radius |
| `$sim-card-aspect-ratio` | `59 / 86` | Standard Yu-Gi-Oh! card aspect ratio |

### Signal Wiring Pattern

Components inject `BoardStateService` to read zone data. The service is already scoped to `SimulatorPageComponent`, so all children share the same instance:

```typescript
// In any zone component:
private boardState = inject(BoardStateService);
cards = computed(() => this.boardState.boardState()[this.zoneId()]);
```

This is reactive: when `boardState` signal updates (Story 1.3 will populate it), the computed signals propagate to components automatically. OnPush change detection works because signals notify Angular of changes.

**Do NOT:**
- Call `boardState.update()` from any component
- Subscribe to observables — use computed signals only
- Create new services — inject existing `BoardStateService`

### What This Story Does NOT Include

- **No deck loading / shuffle / draw** (Story 1.3) — board renders empty
- **No drag & drop** (Story 2.2) — no `cdkDrag`, no `cdkDropList`, no `cdkDropListGroup`
- **No commands** (Story 2.1) — no command classes, no `CommandStackService` methods beyond shell
- **No context menus** (Stories 2.3, 3.1) — no right-click behavior
- **No card inspector** (Story 3.2) — no `SimCardInspectorComponent`, no hover behavior
- **No pile overlays** (Story 4.1) — no `SimPileOverlayComponent`, no stacked zone click behavior
- **No XYZ material rendering** (Story 4.3) — `overlayMaterials` exists in data model but no UI
- **No control bar** (Story 5.1) — placeholder div in controls grid area
- **No keyboard shortcuts** (Story 5.2)
- **No responsive breakpoints** (post-initial CSS Grid setup — the `fr` units and `minmax()` provide basic scaling, but dedicated breakpoint rules are deferred)
- **No `prefers-reduced-motion`** support — no animations to suppress yet (added in Story 2.2)
- **No `isDragging` / `hoveredCard` signal consumption** — signals exist in BoardStateService but are not used in this story's components

### Previous Story Intelligence (Story 1.1)

**Established Patterns to Follow:**
- SCSS import pattern: `@use 'sim-tokens' as *` (not `@import`) — Story 1.1 code review replaced deprecated `@import`
- Route param extraction: `toSignal()` with `map()` for Observable-to-Signal bridge
- Service pattern: `@Injectable()` without `providedIn`, provided at component level
- Signal pattern: `boardState` is public writable (commands call `.update()`), but components only read
- `ZONE_CONFIG` includes `pendulum` metadata on ST1/ST5 (added during Story 1.1 code review)

**Files Modified by Story 1.1 (context for this story):**
- `simulator.models.ts` — ZoneId, CardInstance, SimCommand, ZONE_CONFIG already defined
- `board-state.service.ts` — boardState signal, all computed zone signals already exist
- `simulator-page.component.ts` — component with providers, deckId signal
- `simulator-page.component.html` — placeholder to be replaced
- `simulator-page.component.scss` — placeholder styling to be updated
- `_sim-tokens.scss` — empty placeholder to be populated

**Build Notes:**
- `ng build --configuration development` passes without errors after Story 1.1
- `ng build` (production) has pre-existing bundle budget warnings (jspdf/canvg), unrelated to simulator

### Manual Verification Steps

1. `ng build --configuration development` completes without TypeScript errors
2. `ng serve` → navigate to `/decks/1/simulator` while authenticated
3. Board renders with 18 empty zones in the correct grid layout
4. Zone labels visible on all empty zones (from ZONE_CONFIG)
5. Stacked zones (Deck, ED, GY, Banished) show dimmed state with labels, no badge (count = 0)
6. Hand zone shows dashed border, no text
7. Controls area placeholder is visible in bottom-left
8. Board fills viewport with `$sim-bg` dark navy background
9. No console errors in browser DevTools
10. Pendulum labels visible on ST1 ("P-L") and ST5 ("P-R") zones

### Edge Cases

- **Board renders correctly with all zones empty** — initial state before deck loading (Story 1.3)
- **CSS Grid handles empty cells** — `.` in grid-template-areas creates invisible cells, no content needed
- **Window resize** — `fr` units and `minmax()` handle basic resizing without explicit breakpoints
- **SimCardComponent receives face-down card** — must render card back, not crash on missing image

### Project Structure Notes

Files created by this story:
```
front/src/app/pages/simulator/
  sim-card.component.ts             # NEW — card rendering
  sim-card.component.html           # NEW — card template
  sim-card.component.scss           # NEW — card styling
  zone.component.ts                 # NEW — single-card zone
  zone.component.html               # NEW — zone template
  zone.component.scss               # NEW — zone styling
  stacked-zone.component.ts         # NEW — stacked zone (Deck, ED, GY, Banish)
  stacked-zone.component.html       # NEW — stacked zone template
  stacked-zone.component.scss       # NEW — stacked zone styling
  hand.component.ts                 # NEW — hand zone
  hand.component.html               # NEW — hand template
  hand.component.scss               # NEW — hand styling
  board.component.ts                # NEW — board grid layout
  board.component.html              # NEW — board template (all 18 zones)
  board.component.scss              # NEW — CSS Grid definition
```

Files modified by this story:
```
front/src/app/pages/simulator/
  _sim-tokens.scss                  # MODIFIED — populate all SCSS tokens
  simulator-page.component.html     # MODIFIED — replace placeholder with <app-sim-board>
  simulator-page.component.scss     # MODIFIED — full viewport styling
```

### References

- [Source: architecture.md#Core Architectural Decisions] — Data model, ZoneId, component hierarchy
- [Source: architecture.md#Project Structure & Boundaries] — Directory structure, file naming
- [Source: architecture.md#Implementation Patterns & Consistency Rules] — Signal patterns, action flow
- [Source: architecture.md#Naming Conventions] — `app-sim-` prefix
- [Source: architecture.md#Component Communication Patterns] — Signal inputs, service injection
- [Source: ux-design-specification.md#Board Layout (Corrected)] — 7×4 CSS Grid, named areas, zone positions
- [Source: ux-design-specification.md#Design System Foundation] — SCSS tokens, color system, typography
- [Source: ux-design-specification.md#Spacing & Layout Foundation] — Gap, padding, radius tokens
- [Source: ux-design-specification.md#Component Strategy] — SimBoardComponent, SimZoneComponent, SimStackedZoneComponent, SimHandComponent, SimCardComponent specs
- [Source: ux-design-specification.md#Loading & Empty State Patterns] — Empty hand (dashed), empty stacked zone (dimmed)
- [Source: ux-design-specification.md#Feedback & State Indication Patterns] — Card count badges, mat-badge
- [Source: ux-design-specification.md#Accessibility Strategy] — ARIA roles, contrast compliance
- [Source: epics.md#Story 1.2] — Acceptance criteria, user story
- [Source: front/src/app/pages/simulator/simulator.models.ts] — ZoneId, CardInstance, ZONE_CONFIG
- [Source: front/src/app/pages/simulator/board-state.service.ts] — BoardStateService signal architecture
- [Source: front/src/app/core/model/dto/card-image-dto.ts] — CardImageDTO (url, smallUrl)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- Fixed Sass deprecation: `59 / 86` → `list.slash(59, 86)` to avoid Dart Sass 2.0 division warning
- Removed unused `SimCardComponent` import from `SimBoardComponent` (only child components use it)
- Added `displayCard` computed signal in `SimStackedZoneComponent` to avoid object spread in template

### Completion Notes List

- All 18 zones rendered in 7×4 CSS Grid with named `grid-template-areas`
- 5 new components created: SimCardComponent, SimZoneComponent, SimStackedZoneComponent, SimHandComponent, SimBoardComponent
- All components standalone with OnPush change detection and signal-based inputs
- SCSS tokens fully populated with all color, spacing, and dimension variables
- Stacked zones use MatBadge for card count with `$sim-accent-primary` override
- Hand zone uses dashed border empty state with no placeholder text
- Pendulum indicators ("P-L" / "P-R") visible on ST1 and ST5 zones
- Board has ARIA `role="application"` and `aria-label` for accessibility
- `ng build --configuration development` passes with zero errors and zero warnings
- Task 8.2 (visual verification via `ng serve`) requires manual user validation

### File List

**New files:**
- `front/src/app/pages/simulator/sim-card.component.ts`
- `front/src/app/pages/simulator/sim-card.component.html`
- `front/src/app/pages/simulator/sim-card.component.scss`
- `front/src/app/pages/simulator/zone.component.ts`
- `front/src/app/pages/simulator/zone.component.html`
- `front/src/app/pages/simulator/zone.component.scss`
- `front/src/app/pages/simulator/stacked-zone.component.ts`
- `front/src/app/pages/simulator/stacked-zone.component.html`
- `front/src/app/pages/simulator/stacked-zone.component.scss`
- `front/src/app/pages/simulator/hand.component.ts`
- `front/src/app/pages/simulator/hand.component.html`
- `front/src/app/pages/simulator/hand.component.scss`
- `front/src/app/pages/simulator/board.component.ts`
- `front/src/app/pages/simulator/board.component.html`
- `front/src/app/pages/simulator/board.component.scss`

**Modified files:**
- `front/src/app/pages/simulator/_sim-tokens.scss` — populated all SCSS design tokens
- `front/src/app/pages/simulator/simulator-page.component.ts` — added SimBoardComponent import
- `front/src/app/pages/simulator/simulator-page.component.html` — replaced placeholder with `<app-sim-board />`
- `front/src/app/pages/simulator/simulator-page.component.scss` — full viewport styling with $sim-bg

## Change Log

- **2026-02-10:** Implemented Story 1.2 — Rendered 18-zone board with 5 new components (SimCard, SimZone, SimStackedZone, SimHand, SimBoard), populated SCSS design tokens, updated SimulatorPageComponent to display the board grid layout.
- **2026-02-10:** Code review fixes (7 issues) — Replaced deprecated `::ng-deep` with M3 CSS custom property for mat-badge color; made hand dashed border conditional on empty state; removed undocumented board padding; removed redundant card-back border-radius; added explicit `as CardInstance` cast on displayCard spread; fixed Task 8 header to reflect incomplete 8.2 subtask.
