# Story 8.1 — Harmonization Analysis & Migration Plan

> **Binding implementation spec for Stories 8.2–8.5**
> Generated: 2026-02-14 | Story: 8-1-harmonization-analysis-and-migration-plan

---

## 1. Component Inventory & Comparison Analysis

### 1.1 SimCardComponent (`app-sim-card`)

| Aspect | Detail |
|--------|--------|
| **Selector** | `app-sim-card` |
| **Files** | `pages/simulator/sim-card.component.ts` (29 lines), `.html` (22 lines), `.scss` (84 lines) |
| **Model** | `CardInstance` (interface) |
| **Input API** | `cardInstance = input.required<CardInstance>()`, `size = input<'board' \| 'hand'>('board')`, `forceFaceDown = input<boolean \| null>(null)` |
| **Output API** | `clicked = output<CardInstance>()` |
| **Computed signals** | `isFaceDown`, `isDefPosition`, `imageUrl`, `hasMaterials`, `materialCount`, `materialPeekSlots` |
| **CDK Drag** | **Drag-agnostic** — parent zones apply `cdkDrag`, `cdkDragData`, `cdkDragPreview` on `<app-sim-card>` host. Card has `:host.cdk-drag-preview/placeholder/animating` styles only. |
| **Face-down** | `isFaceDown = forceFaceDown ?? cardInstance.faceDown` → renders `card_back.jpg` |
| **DEF position** | `isDefPosition = position === 'DEF'` → `transform: rotate(90deg)` |
| **XYZ materials** | Material peek borders — up to 5 stacked visual slots behind card |
| **Sizing** | Height-driven (`height: 100%`, `width: auto`), aspect ratio `59/86` from `$sim-card-aspect-ratio` |
| **SCSS tokens** | Uses `@use 'sim-tokens' as *` — `$sim-card-aspect-ratio`, `$sim-radius-card`, `$sim-surface-elevated`, `$sim-zone-border` |
| **Accessibility** | `prefers-reduced-motion` support for CDK drag states |
| **Template syntax** | `@if`/`@for` control flow (Angular 17+ syntax) |

### 1.2 CardComponent (deck builder, selector `card`)

| Aspect | Detail |
|--------|--------|
| **Selector** | `card` (no `app-` prefix — non-standard) |
| **Files** | `components/card/card.component.ts` (103 lines), `.html` (88 lines), `.scss` (290 lines) |
| **Model** | `CardDetail` (class) |
| **Input API** | `cardDetail = input<CardDetail>(new CardDetail())`, `size = input<CardSize>(CardSize.MEDIUM)`, `cropped = input<boolean>(false)`, `displayMode = input<CardDisplayType>(CardDisplayType.INFORMATIVE)`, `deckBuildMode = input<boolean>(false)`, `searchService = input<SearchServiceCore>()` |
| **Output API** | `@Output() loaded = new EventEmitter<number>()` (legacy decorator) — **dead code: never bound by any parent template** |
| **CDK Drag** | **Built-in** — `cdkDrag` on container div, `cdkDragDisabled` bound to `!deckBuildMode()`, `cdkDragData` bound to `cardDetail()` |
| **Face-down** | **None** — always renders face-up |
| **DEF position** | **None** — no position concept |
| **XYZ materials** | **None** — not applicable in deck builder |
| **Sizing** | Enum-based `CardSize` with fixed px dimensions: BIG (365×250), MEDIUM (147×100), SMALL (44×33), DECK (100×75), DECK_EXTRA_SIDE (66.5×50). Sizes duplicated between `card.component.scss` and `variable.scss`. |
| **Display modes** | `INFORMATIVE` (image + name + stats), `MOSAIC` (image only), `OWNED` (quantity form per set) |
| **Tooltip** | `[customToolTip]="cardDetail()"` directive on `<img>` — click-based, 150ms debounce, CDK Overlay |
| **SCSS tokens** | Uses `@import 'variable'` and `@import 'mixin'` (legacy `@import` syntax) |
| **Accessibility** | None |
| **Template syntax** | Mix of `*ngIf`/`*ngFor` (legacy) and `@if` (modern) |
| **Services injected** | `OwnedCardService`, `DeckBuildService`, `Router`, `TooltipService` |
| **Business logic** | `handleClick` (dblclick → add to deck), `handleDragStart` (hide tooltip), `updateQuantity`/`increaseQuantity` (owned card management) |

### 1.3 Side-by-Side Comparison

| Feature | SimCardComponent | CardComponent (Deck Builder) | Shared Component Strategy |
|---------|-----------------|------------------------------|---------------------------|
| **Data model** | `CardInstance` (game state wrapper around `CardDetail`) | `CardDetail` (card catalog DTO) | New `SharedCardInputs` interface — minimal contract both can satisfy |
| **Input API style** | Signal-based `input<T>()` | Signal-based `input<T>()` (but `@Output` decorator) | All signals: `input<T>()` / `output<T>()` |
| **CDK Drag** | Parent-applied (drag-agnostic) | Built-in (`cdkDrag` on div) | **Parent-applied** (simulator pattern) |
| **Face-down rendering** | ✅ `isFaceDown` computed | ❌ Not supported | Optional `faceDown = input(false)` |
| **DEF position rotation** | ✅ `isDefPosition` → rotate 90° | ❌ Not supported | Optional `position = input<'ATK' \| 'DEF'>('ATK')` |
| **XYZ material borders** | ✅ Up to 5 peek slots | ❌ Not applicable | Optional `overlayMaterials = input<unknown[]>([])` |
| **Sizing** | Height-driven, 2 modes (`board`/`hand`) | Fixed px, 5 enum sizes + crop | **CSS custom properties** on host |
| **Tooltip/inspect** | No — parent service handles | `[customToolTip]` directive | Removed — parent/page handles inspection |
| **Image loading** | Native `<img [src]>` | `[imgLoader]` directive | Native `<img [src]>` — lazy loading delegated to parent |
| **Ban info overlay** | ❌ Not applicable | ✅ Red circle badge | Not in shared CardComponent — deck builder adds via wrapper |
| **Owned quantity** | ❌ Not applicable | ✅ OWNED display mode | Not in shared CardComponent — separate deck builder concern |
| **INFORMATIVE layout** | ❌ Single image display | ✅ Image + name + attribute icons + stats | Not in shared CardComponent — deck builder wrapper concern |
| **Accessibility** | `prefers-reduced-motion` | None | `prefers-reduced-motion` preserved |
| **SCSS infrastructure** | `@use 'sim-tokens'` | `@import 'variable'` / `@import 'mixin'` | `@use` syntax, CSS custom properties |

### 1.3b CSS Class Names Comparison

| Class / Selector | SimCardComponent | CardComponent (Deck Builder) | Migration Notes |
|------------------|-----------------|------------------------------|-----------------|
| **Main container** | `.sim-card` | `.cardContainer` | Shared: rename to `.card` or `.card-container` |
| **Image element** | `.card-face` (face-up img) | `.cardContainer-img img` | Shared: `.card-face` |
| **Card back** | `.card-back` (face-down img) | n/a | Carried into shared component |
| **Position state** | `.def-position` (host class, rotate 90°) | n/a | Carried into shared component |
| **XYZ materials** | `.material-peek-borders`, `.material-border` | n/a | Carried into shared component |
| **CDK drag states** | `:host.cdk-drag-preview`, `:host.cdk-drag-placeholder`, `:host.cdk-drag-animating` | `.cardContainer` has `cdkDrag` built-in (no host-level drag classes) | Shared: host-level CDK drag classes (simulator pattern) |
| **Info layout** | n/a | `.cardContainer-infos`, `.cardContainer-moreInfos` | NOT in shared component — stays in deck builder wrapper |
| **Owned mode** | n/a | `.ownedContainer` | NOT in shared component — stays in deck builder wrapper |
| **Size variants** | No size classes — height-driven via parent CSS | `.BIG`, `.MEDIUM`, `.SMALL`, `.DECK`, `.DECK_EXTRA_SIDE` (enum-mapped) | Shared: no size classes — sizing via CSS custom properties on host |
| **Cropped variant** | n/a | `.cropped` | NOT in shared component — parent handles cropping via wrapper CSS |

### 1.4 Selector Collision Verification

| Selector | Status |
|----------|--------|
| `app-card` (target shared) | **NO COLLISION** — grep confirms zero matches across entire `front/src/` |
| `app-sim-card` (current simulator) | Will be deleted post-extraction |
| `card` (current deck builder) | Non-standard prefix. Will be replaced by `app-card`. Old files deleted. |

### 1.5 Features Unique to Each Component

**Simulator-only features (carried into shared component):**
- Face-down state (`faceDown` input + card back image)
- DEF position rotation (90° transform)
- XYZ material peek borders (overlay material visualization)
- CDK drag host styles (`:host.cdk-drag-preview/placeholder/animating`)

**Deck builder-only features (NOT carried into shared component — remain in deck builder wrapper):**
- Ban info badge overlay
- Owned quantity management (OWNED display mode with `mat-form-field`)
- INFORMATIVE layout (name + attribute icons + stats panel)
- Card cropping for compact display
- `[imgLoader]` lazy loading directive
- `[customToolTip]` integration
- `cdkDrag` built-in binding (becomes parent-applied)
- Double-click to add to deck
- `searchService` input

**Must be unified:**
- Image URL resolution: SimCard uses `cardInstance.image.smallUrl`, CardComponent uses `cardDetail.images[0].smallUrl`
- Sizing system: both need dimensions but through CSS custom properties, not enum or string input

---

## 2. Inspector Component Comparison

### 2.1 SimCardInspectorComponent (`app-sim-card-inspector`)

| Aspect | Detail |
|--------|--------|
| **Selector** | `app-sim-card-inspector` |
| **Files** | `pages/simulator/card-inspector.component.ts` (39 lines), `.html` (45 lines), `.scss` (88 lines) |
| **Activation** | Service-driven: `BoardStateService.selectedCard` signal. Card click → `boardState.selectCard()` → inspector renders. |
| **Positioning** | Absolute: `top: 8px; left: 8px; width: 260px`. Mobile: `left: 50%; transform: translateX(-50%); width: 90%` |
| **Dismissal** | `@HostListener('document:keydown.escape')` + `@HostListener('document:mousedown')` with `elementRef.contains()` check |
| **Visibility** | CSS opacity transition (0 → 1) with `pointer-events: none/auto` toggle via `.visible` host class |
| **ARIA** | `role="complementary"`, `aria-label="Card inspector"`, `aria-live="polite"` |
| **Layout** | Horizontal: 80px image left + details right (name, stats, effect text) |
| **Image fallback** | `(error)="$any($event.target).src='assets/images/card_back.jpg'"` |
| **Data path** | `card.card.card.name` (CardInstance → CardDetail → Card → name) — 3-level deep |
| **SCSS tokens** | `@use 'sim-tokens'` — semi-transparent overlay surface (`rgba($sim-surface, 0.92)`, no `backdrop-filter`) |
| **Reduced motion** | `prefers-reduced-motion: reduce` → `transition: none` |

### 2.2 Deck Builder Card Detail Mechanism

| Aspect | Detail |
|--------|--------|
| **Component** | `CardTooltipComponent` (`card-tooltip`) — global singleton in `app.component.html` |
| **Activation** | `[customToolTip]` directive → click with 150ms debounce → `TooltipService.setCardDetail()` → `CardTooltipComponent` reacts via `tooltipService.cardDetail()` signal |
| **Positioning** | CDK Overlay: `global().centerHorizontally().centerVertically()` |
| **Dismissal** | Click outside (via `window.addEventListener('click', handleClickOutside)` with manual rect check on `.dark-theme-tooltip` element) |
| **Layout** | Vertical: large card image (full `url` not `smallUrl`) + ban info + favorite toggle + deck add/remove buttons + name + attribute/race icons + ATK/DEF + description |
| **Features** | Favorite toggle (HTTP call), deck add/remove (+1/-1) with max copy check, set code display |
| **Data path** | `cardDetail.card.name` (CardDetail → Card → name) — 2-level deep |
| **Files** | `card-tooltip.component.ts` (65 lines), `.html` (77 lines), `.scss` (not read but exists) |
| **Dependencies** | `TooltipService`, `HttpClient`, `DeckBuildService` |

### 2.3 Unified Mode Contract

The shared `CardInspectorComponent` supports three activation modes:

| Mode | Behavior | Use Case | Card Input Source |
|------|----------|----------|-------------------|
| `'hover'` | Side panel display, parent-driven card input. Component shows/hides based on whether `card` input is non-null. No DOM hover listeners attached by component. | Simulator board (click-select drives `card` input) | Parent sets `card` input from `BoardStateService.selectedCard` |
| `'click'` | Floating centered overlay with backdrop. Component internally manages visibility. Triggered by parent setting `card` input. Dismiss on outside click/tap or Escape. | Deck builder pages, card search page | Parent sets `card` input from click event on card |
| `'permanent'` | Always visible, no dismiss behavior. Useful for dedicated detail views. | Future use (not required for 8.2–8.5) | Parent sets `card` input directly |

**Important clarification:** In all modes, the component itself does NOT attach click or hover listeners to detect card selection. The parent page is always responsible for setting the `card` input. The mode controls **display behavior** (positioning, backdrop, dismiss handling), not activation trigger.

### 2.4 Floating Overlay Pattern for `click` Mode (Master Duel Inspired)

**Visual design:**
- Semi-transparent backdrop over the entire canvas (`position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1050`)
- Card detail panel centered on backdrop (horizontally and vertically)
- Panel contains: large card image + name + type/attribute + stats + effect text
- Dismiss on: click/tap on backdrop, Escape key
- No `position` input dependency — always centered
- **Uniform across all viewports** — no breakpoint-dependent placement switch

**Distinction from `hover` mode:**
- `hover` mode: absolute-positioned side panel (simulator), no backdrop, `position: 'left' | 'right'` input relevant
- `click` mode: fixed centered overlay, backdrop, no `position` input dependency

---

## 3. Unified Contract Definition

### 3.1 Shared `CardComponent` Contract

#### TypeScript Interface — `SharedCardData`

```typescript
/**
 * Minimal card data contract for the shared CardComponent.
 * Both CardInstance (simulator) and CardDetail (deck builder) must satisfy this
 * through adapter mapping in the parent template or a computed signal.
 */
export interface SharedCardData {
  /** Card name for alt text */
  readonly name: string;
  /** Small image URL for card face rendering */
  readonly imageUrl: string;
  /** Full-size image URL for inspector/detail views */
  readonly imageUrlFull?: string;
}
```

#### Input/Output Contract

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `card` | `input.required<SharedCardData>()` | — | Card data (name + image URLs) |
| `faceDown` | `input<boolean>()` | `false` | Show card back instead of image |
| `position` | `input<'ATK' \| 'DEF'>()` | `'ATK'` | Battle position — DEF rotates 90° |
| `showOverlayMaterials` | `input<boolean>()` | `false` | Show XYZ material peek borders |
| `overlayMaterialCount` | `input<number>()` | `0` | Number of material borders to display (max 5) |

| Output | Type | Description |
|--------|------|-------------|
| `clicked` | `output<void>()` | Emits on card click. Parent handles selection logic. |

**No injected services.** No `DeckBuildService`, no `TooltipService`, no `Router`, no `OwnedCardService`. The shared CardComponent is purely presentational.

**Dropped from deck builder `CardComponent`:** The `@Output() loaded` event emitter is not carried over — it is dead code (never bound by any parent template in the current codebase). The `[imgLoader]` directive usage is also not carried over — the shared component uses native `<img [src]>`. Parents needing lazy loading can apply their own directive on the `<img>` or on the `<app-card>` host.

**Image error fallback:** The shared `CardComponent` renders a fallback `card_back.jpg` when the image fails to load, using `(error)="$any($event.target).src='assets/images/card_back.jpg'"` on the `<img>` element (same pattern as `SimCardInspectorComponent`).

#### Adapter Mapping Examples

**Simulator (CardInstance → SharedCardData):**
```typescript
// In zone/hand template or parent component
readonly cardData = computed<SharedCardData>(() => ({
  name: this.cardInstance().card.card.name,
  imageUrl: this.cardInstance().image.smallUrl,
  imageUrlFull: this.cardInstance().image.url,
}));
```

**Deck builder (CardDetail → SharedCardData):**
```typescript
// In card-list or deck-card-zone template or wrapper
readonly cardData = computed<SharedCardData>(() => ({
  name: this.cardDetail().card.name ?? '',
  imageUrl: this.cardDetail().images[0]?.smallUrl ?? '',
  imageUrlFull: this.cardDetail().images[0]?.url ?? '',
}));
```

### 3.2 Shared `CardInspectorComponent` Contract

#### Input/Output Contract

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `card` | `input<SharedCardInspectorData \| null>()` | `null` | Card data for display. `null` = hidden. |
| `mode` | `input<'hover' \| 'click' \| 'permanent'>()` | `'hover'` | Display behavior mode |
| `position` | `input<'left' \| 'right'>()` | `'left'` | Panel position (relevant only for `hover` mode) |

| Output | Type | Description |
|--------|------|-------------|
| `dismissed` | `output<void>()` | Emits when inspector is dismissed (Escape, outside click, backdrop click) |

#### TypeScript Interface — `SharedCardInspectorData`

```typescript
/**
 * Card data for the inspector panel.
 * Extends SharedCardData with fields needed for full card detail display.
 */
export interface SharedCardInspectorData extends SharedCardData {
  /** Monster/Spell/Trap classification */
  readonly isMonster: boolean;
  /** Card attribute (DARK, LIGHT, etc.) */
  readonly attribute?: string;
  /** Card race/type (Warrior, Spellcaster, etc.) */
  readonly race?: string;
  /** Monster level/rank */
  readonly level?: number;
  /** Pendulum scale */
  readonly scale?: number;
  /** Link rating */
  readonly linkval?: number;
  /** Is a Link monster */
  readonly isLink: boolean;
  /** Has DEF stat (monster, non-Link) */
  readonly hasDefense: boolean;
  /** Display ATK value (string — handles '?' for unknowns) */
  readonly displayAtk: string;
  /** Display DEF value (string — handles '?' for unknowns) */
  readonly displayDef: string;
  /** Card effect/description text (may contain HTML from `<br>` replacements) */
  readonly description: string;
}
```

#### Adapter Mapping Examples

**Simulator (CardInstance → SharedCardInspectorData):**
```typescript
readonly inspectorData = computed<SharedCardInspectorData | null>(() => {
  const ci = this.boardState.selectedCard();
  if (!ci) return null;
  const c = ci.card.card; // Card class
  return {
    name: c.name ?? '',
    imageUrl: ci.image.smallUrl,
    imageUrlFull: ci.image.url,
    isMonster: c.isMonster ?? false,
    attribute: c.attribute,
    race: c.race,
    level: c.level,
    scale: c.scale,
    linkval: c.linkval,
    isLink: c.isLink ?? false,
    hasDefense: c.hasDefense ?? false,
    displayAtk: c.displayAtk,
    displayDef: c.displayDef,
    description: c.description ?? '',
  };
});
```

**Deck builder (CardDetail → SharedCardInspectorData):**
```typescript
readonly inspectorData = computed<SharedCardInspectorData | null>(() => {
  const cd = this.selectedCardDetail();
  if (!cd) return null;
  const c = cd.card; // Card class
  return {
    name: c.name ?? '',
    imageUrl: cd.images[0]?.smallUrl ?? '',
    imageUrlFull: cd.images[0]?.url ?? '',
    isMonster: c.isMonster ?? false,
    attribute: c.attribute,
    race: c.race,
    level: c.level,
    scale: c.scale,
    linkval: c.linkval,
    isLink: c.isLink ?? false,
    hasDefense: c.hasDefense ?? false,
    displayAtk: c.displayAtk,
    displayDef: c.displayDef,
    description: c.description ?? '',
  };
});
```

### 3.3 CSS Custom Property Theming Contract

#### CardComponent CSS Custom Properties

| Property | Default | Simulator Override | Deck Builder Override |
|----------|---------|-------------------|----------------------|
| `--card-border-radius` | `0.25rem` | (use default) | `2px` |
| `--card-bg` | `transparent` | (use default) | (use default) |
| `--card-border-color` | `transparent` | (use default) | (use default) |
| `--card-shadow` | `none` | `0 2px 8px rgba(0,0,0,0.4)` (hand size) | (use default) |
| `--card-hover-scale` | `1` | `1.08` (hand hover via parent) | (use default) |
| `--card-drag-preview-scale` | `1.05` | (use default) | (use default) |
| `--card-drag-preview-shadow` | `0 8px 24px rgba(0,0,0,0.5)` | (use default) | (use default) |
| `--card-drag-preview-opacity` | `0.9` | (use default) | (use default) |
| `--card-drag-placeholder-opacity` | `0.3` | (use default) | (use default) |
| `--card-material-bg` | `#1e293b` | (use default) | n/a |
| `--card-material-border` | `rgba(0, 212, 255, 0.15)` | (use default) | n/a |

**Component sizing:** Controlled entirely via host element CSS by the parent — no size input. Parent sets `width` and/or `height` on `<app-card>`, component preserves `aspect-ratio: 59/86` internally.

#### CardInspectorComponent CSS Custom Properties

| Property | Default | Simulator Override (`hover` mode) | Deck Builder Override (`click` mode) |
|----------|---------|-----------------------------------|--------------------------------------|
| `--inspector-bg` | `rgba(17, 24, 39, 0.92)` | (use default — glass morphism on sim surface) | `rgba(30, 30, 30, 0.95)` |
| `--inspector-text` | `#f1f5f9` | (use default) | (use default) |
| `--inspector-text-secondary` | `#94a3b8` | (use default) | (use default) |
| `--inspector-width` | `260px` | (use default) | `min(400px, 90vw)` |
| `--inspector-border-color` | `rgba(0, 212, 255, 0.15)` | (use default) | `rgba(255, 255, 255, 0.1)` |
| `--inspector-border-radius` | `8px` | (use default) | `12px` |
| `--inspector-image-width` | `80px` | (use default) | `140px` |
| `--inspector-backdrop` | n/a (hover has no backdrop) | n/a | `rgba(0, 0, 0, 0.6)` |
| `--inspector-z-index` | `10` | (use default) | `1050` |

### 3.4 Template-Driven CDK Drag Pattern

The shared `CardComponent` is **drag-agnostic** — it contains no CDK drag directives or logic. Parents apply drag behavior on the `<app-card>` host element.

**Code example — simulator zone template:**

```html
<!-- zone.component.html -->
<div class="zone-content"
     cdkDropList
     [cdkDropListData]="zoneCards()"
     (cdkDropListDropped)="onDrop($event)">

  @for (c of zoneCards(); track c.instanceId) {
    <app-card
      [card]="toSharedCardData(c)"
      [faceDown]="c.faceDown"
      [position]="c.position"
      [showOverlayMaterials]="(c.overlayMaterials?.length ?? 0) > 0"
      [overlayMaterialCount]="c.overlayMaterials?.length ?? 0"
      (clicked)="onCardClick(c)"
      cdkDrag
      [cdkDragData]="c"
      (cdkDragStarted)="onDragStart($event)">
      <ng-template cdkDragPreview>
        <app-card [card]="toSharedCardData(c)" style="width: 60px;" />
      </ng-template>
    </app-card>
  }
</div>
```

**Key points:**
- `cdkDrag` applied on `<app-card>` host element by parent
- `cdkDragData` carries `CardInstance` (not `SharedCardData`)
- `cdkDragPreview` template uses `<app-card>` for preview rendering
- Context menu (`mat-menu-trigger`) also applied on host element by parent
- Card component's `:host.cdk-drag-preview/placeholder/animating` styles handle visual states

**Code example — deck builder card-list (post-migration):**

```html
<!-- card-list.component.html -->
@for (cd of cardDetails(); track cd.card.id) {
  <div class="card-wrapper"
       cdkDrag
       [cdkDragDisabled]="!deckBuildMode()"
       [cdkDragData]="cd"
       (cdkDragStarted)="onDragStart($event)"
       (dblclick)="onDoubleClick(cd)"
       (click)="onCardClick(cd)">
    <app-card [card]="toSharedCardData(cd)" />
    <!-- Ban info, owned count, etc. rendered in wrapper -->
    @if (cd.card.banInfo < 3) {
      <div class="ban-badge">{{ cd.card.banInfo }}</div>
    }
  </div>
}
```

---

## 4. Migration Plan

### 4.1 Simulator Card Migration (Story 8.2)

**Step-by-step:**

1. **Create shared `CardComponent`** at `components/card/card.component.ts/html/scss`
   - Rename old `components/card/` files first (or delete — they are fully replaced)
   - Base implementation on `SimCardComponent` (extract, don't rewrite)
   - Replace `CardInstance` input with `SharedCardData` interface + `faceDown`/`position`/overlay inputs
   - Remove `size` input — sizing via CSS custom properties
   - Keep `:host` CDK drag styles
   - Keep `prefers-reduced-motion` media queries
   - Keep material peek borders logic (conditional on `showOverlayMaterials` + `overlayMaterialCount`)
   - Use `@use` SCSS syntax, CSS custom properties for theming

2. **Create `SharedCardData` interface** at `core/model/shared-card-data.ts`
   - Define `SharedCardData` and `SharedCardInspectorData` interfaces

3. **Update simulator zone templates:**
   - `zone.component.ts/html`: `app-sim-card` → `app-card`, add adapter `toSharedCardData()` method, pass `faceDown`/`position`/overlay inputs explicitly
   - `hand.component.ts/html`: same changes
   - `stacked-zone.component.ts/html`: same changes
   - `pile-overlay.component.ts/html`: same changes

4. **Update simulator imports:**
   - All zone/hand/overlay components: remove `SimCardComponent` import, add `CardComponent` import

5. **Update simulator SCSS:**
   - `zone.component.scss`: `app-sim-card { ... }` → `app-card { ... }`
   - `stacked-zone.component.scss`: same
   - `pile-overlay.component.scss`: same

6. **Delete old files:**
   - `pages/simulator/sim-card.component.ts`
   - `pages/simulator/sim-card.component.html`
   - `pages/simulator/sim-card.component.scss`

7. **Verify:** All simulator card rendering works identically

### 4.2 Simulator Inspector Migration (Story 8.3)

**Step-by-step:**

1. **Create shared `CardInspectorComponent`** at `components/card-inspector/card-inspector.component.ts/html/scss`
   - Base on `SimCardInspectorComponent`
   - Replace `BoardStateService` injection with `card` input + `mode` input + `position` input
   - Move Escape/click-outside `@HostListener` logic into the component (mode-aware):
     - `hover` mode: Escape + click-outside → emit `dismissed`
     - `click` mode: Escape + backdrop click → emit `dismissed`
     - `permanent` mode: no dismiss behavior
   - Template renders from `SharedCardInspectorData` (flatter path: `card.name` not `card.card.card.name`)
   - Add `click` mode template: backdrop div + centered panel
   - Use CSS custom properties for all theme-dependent values
   - ARIA attributes preserved: `role`, `aria-label`, `aria-live`

2. **Create `SharedCardInspectorData` interface** in the same file as `SharedCardData` (`core/model/shared-card-data.ts`) — both interfaces are part of the same shared card data contract

3. **Update simulator board template:**
   - `board.component.html`: `<app-sim-card-inspector />` → `<app-card-inspector [card]="inspectorData()" mode="hover" (dismissed)="clearSelection()" />`
   - `board.component.ts`: Add `inspectorData` computed signal (adapter from `selectedCard`)

4. **Update simulator board imports:**
   - Remove `SimCardInspectorComponent`, add `CardInspectorComponent`

5. **Delete old files:**
   - `pages/simulator/card-inspector.component.ts`
   - `pages/simulator/card-inspector.component.html`
   - `pages/simulator/card-inspector.component.scss`

6. **Verify:** Inspector appears/dismisses identically on simulator

### 4.3 Deck Builder Card Migration (Story 8.4)

**Step-by-step:**

1. **Replace `card` component usage** in deck builder templates:
   - `card-list.component.html`: `<card ...>` → wrapper `<div>` with `<app-card>` inside. Move `cdkDrag`, `cdkDragData`, `cdkDragDisabled`, `dblclick`, ban info overlay, owned count badge to wrapper.
   - `deck-card-zone.component.html`: same pattern
   - `hand-test.component.html`: same pattern

2. **Create `SharedCardData` adapter** in each parent component:
   - `toSharedCardData(cd: CardDetail): SharedCardData` helper method or computed

3. **Migrate INFORMATIVE mode:** The deck builder's `cardContainer-infos` section (name + attribute icons + stats) stays in the parent wrapper div, not in shared `app-card`.

4. **Migrate OWNED mode:** The `ownedContainer` template stays in parent. `<app-card>` only renders the image at SMALL size inside the owned row.

5. **Update parent imports and remove deprecated directives:**
   - All consuming components: remove old `CardComponent` import, add new shared `CardComponent`
   - Remove `ToolTipRendererDirective` import from old `CardComponent`
   - Remove `[imgLoader]` directive usage from card templates — the shared `CardComponent` uses native `<img [src]>` with `(error)` fallback. If lazy loading is needed, parents can apply a loading strategy externally.
   - Remove `ImgLoaderDirective` import from consuming components if no longer used elsewhere

6. **Integrate shared `CardInspectorComponent`** (mode="click"):
   - Add `<app-card-inspector [card]="selectedCardData()" mode="click" (dismissed)="clearSelection()" />` in deck builder page template
   - Add selection logic: card click → set `selectedCardData` signal → inspector appears as floating overlay
   - This replaces the old `[customToolTip]` → `TooltipService` → `CardTooltipComponent` flow

7. **Delete/deprecate old files:**
   - `components/card/card.component.ts` → overwritten by shared version in Step 8.2
   - `components/card/card.component.html` → overwritten
   - `components/card/card.component.scss` → overwritten

### 4.3.1 TooltipService & customToolTip Deprecation Audit

**Files using `TooltipService`:**

| File | Usage | Deprecation Impact |
|------|-------|-------------------|
| `services/tooltip.service.ts` | Service definition | **DELETE** — replaced by `CardInspectorComponent` (mode="click") |
| `core/directives/tooltip.directive.ts` | `[customToolTip]` directive | **DELETE** — replaced by parent click → inspector flow |
| `components/card/card.component.ts` | `TooltipService` injection + `hideTooltip()` | **REPLACED** by shared CardComponent (no tooltip service) |
| `components/card-tooltip/card-tooltip.component.ts` | Tooltip display panel | **DELETE** — replaced by `CardInspectorComponent` |
| `components/card-tooltip/card-tooltip.component.html` | Tooltip template | **DELETE** |
| `components/card-tooltip/card-tooltip.component.scss` | Tooltip styles | **DELETE** |
| `app.component.html` | `<card-tooltip></card-tooltip>` | **REMOVE** element |
| `app.component.ts` | `CardTooltipComponent` import | **REMOVE** import |
| `pages/card-search-page/card-search-page.component.ts` | `TooltipService` injection | **REPLACE** with local selection signal + `CardInspectorComponent` |
| `pages/deck-page/components/deck-builder/deck-builder.component.ts` | `TooltipService` injection | **REPLACE** with local selection signal + `CardInspectorComponent` |

**Scope confirmation:** `TooltipService` and `[customToolTip]` are used **exclusively** for card detail display. No other UI tooltips depend on them. Deprecation is safe with no side effects.

**Out-of-scope clarification:** `components/custom-tooltip/custom-tooltip.component.ts` (`CustomTooltipComponent`) is a **separate, unrelated** general-purpose template tooltip component — it does NOT use `TooltipService` and is NOT part of this deprecation. Do not delete it during migration.

**CardTooltipComponent features to preserve in shared inspector:**
- Favorite toggle (HTTP call) → **NOT in shared inspector**. Deck builder pages add favorite button externally or via a wrapper around the inspector.
- Deck add/remove (+1/-1 buttons) → **NOT in shared inspector**. Deck builder pages handle this in their own UI layer.
- These features are page-specific business logic, not shared inspector concerns.

### 4.4 Deck Builder Inspector Integration (Story 8.4/8.5)

**Step-by-step:**

1. In `deck-builder.component.ts`:
   - Add `selectedCardForInspector = signal<SharedCardInspectorData | null>(null)`
   - On card click: map `CardDetail` → `SharedCardInspectorData`, set signal
   - On inspector dismiss: set signal to `null`

2. In `deck-builder.component.html`:
   - Add `<app-card-inspector [card]="selectedCardForInspector()" mode="click" (dismissed)="selectedCardForInspector.set(null)" />`
   - Remove any `[customToolTip]` references from card elements

3. In `card-search-page.component.ts/html`:
   - Same pattern: add selection signal, add `<app-card-inspector mode="click">`, remove tooltip references

4. Remove global `<card-tooltip>` from `app.component.html` after all pages migrated.

### 4.5 Manual Test Checklist for Zero-Regression Validation

#### Simulator Regression Tests

- [ ] Card renders face-up in all monster zones (MONSTER_1–5, EXTRA_MONSTER_L/R)
- [ ] Card renders face-down (card back image) when `faceDown: true`
- [ ] DEF position rotates card 90° in zones
- [ ] XYZ material peek borders visible (1–5 materials) on cards with overlay materials
- [ ] CDK drag from zone to zone works (card follows cursor, drops in target)
- [ ] CDK drag from hand to zone works
- [ ] CDK drag from pile overlay to zone works
- [ ] CDK drag preview shows card at correct scale (1.05)
- [ ] CDK drag placeholder shows card at reduced opacity (0.3)
- [ ] Context menu (right-click) on board cards opens mat-menu
- [ ] Card inspector appears on card click (hover mode, side panel)
- [ ] Card inspector shows full card details (name, type, stats, effect)
- [ ] Inspector shows card details even for face-down cards
- [ ] Inspector image fallback works (broken image → card back)
- [ ] Inspector dismissed on Escape key
- [ ] Inspector dismissed on click outside panel
- [ ] Inspector positioned correctly (top-left on desktop, centered on mobile)
- [ ] Gold glow animation on successful drop
- [ ] `prefers-reduced-motion` disables all card animations/transitions
- [ ] Hand fan layout preserved (card fan, hover lift effect)

#### Deck Builder Regression Tests

- [ ] Cards render correctly in MOSAIC display mode
- [ ] Cards render correctly in INFORMATIVE display mode (image + name + stats)
- [ ] Cards render correctly in OWNED display mode (per-set quantity controls)
- [ ] Card images load correctly (small URL)
- [ ] Ban info badge (0, 1, 2) displays as red circle overlay on restricted cards
- [ ] CDK drag between deck zones works (Main → Extra, etc.) when in deck build mode
- [ ] CDK drag is disabled when not in deck build mode
- [ ] Card double-click adds card to deck (main/extra based on card type)
- [ ] Owned quantity increment/decrement works in OWNED mode
- [ ] Card click opens inspector overlay (click mode, centered, backdrop)
- [ ] Inspector overlay shows full card details
- [ ] Inspector overlay dismisses on backdrop click
- [ ] Inspector overlay dismisses on Escape key
- [ ] Favorite toggle works in inspector context (if preserved)
- [ ] Deck add/remove buttons work in deck builder context

#### Card Search Page Regression Tests

- [ ] Search results display cards correctly in all display modes
- [ ] Display mode toggle (INFORMATIVE/MOSAIC/OWNED) works
- [ ] Card click opens inspector overlay (click mode)
- [ ] Inspector overlay displays correct card from search results
- [ ] Inspector dismisses correctly
- [ ] Pagination/infinite scroll still works after card component change
- [ ] Card interactions (favorite, add to deck if applicable) work

#### Cross-Cutting Tests

- [ ] No console errors on any page
- [ ] No broken images across all pages
- [ ] Angular build succeeds with `ng build` (no compilation errors)
- [ ] Mobile viewport: simulator inspector centered, deck builder overlay centered
- [ ] `prefers-reduced-motion` respected across all card animations on all pages

### 4.6 Output Format

This document (`_bmad-output/implementation-artifacts/8-1-migration-plan.md`) serves as the **binding implementation spec** for Stories 8.2–8.5. All interface definitions, CSS custom property contracts, migration steps, and test checklists documented here are authoritative.

**Stories mapping:**
- **Story 8.2:** Extract shared `CardComponent` — Sections 3.1, 3.3, 3.4, 4.1
- **Story 8.3:** Extract shared `CardInspectorComponent` — Sections 3.2, 3.3, 4.2
- **Story 8.4:** Deck builder canvas scaling + shared components — Sections 4.3, 4.3.1, 4.4
- **Story 8.5:** Card search page canvas scaling + shared components — Sections 4.4, 4.5
