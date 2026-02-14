# Story 8.4: Deck Builder Canvas Scaling & Shared Components

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the deck builder page to scale its card canvas on all viewport sizes and use the same card/inspector components as the simulator,
So that I can build decks comfortably on any device with a familiar card interaction experience.

## Acceptance Criteria

1. **Given** the deck builder page has a card manipulation area (canvas), **When** the `ScalingContainerDirective` from Epic 7 is applied to the canvas container, **Then** the canvas scales proportionally via `transform: scale()` with a page-specific `referenceWidth` and `aspectRatio` (NOT the default 16/9 — calibrated to deck builder content). The parent container has explicit height (e.g., `calc(100vh - headerHeight)` or `calc(100vh - var(--mobile-header-height))` on mobile).

2. **Given** the deck builder has a hybrid layout, **When** the page renders, **Then** the header area (deck name + action buttons ONLY) above the canvas uses Track B responsive CSS (mobile-first, breakpoint-driven). The card canvas below — containing CardSearcherComponent (search input, filters, results) AND DeckViewerComponent — uses Track A scaling (fixed reference resolution, `transform: scale()`). The two sections are separated by a clear visual boundary.

3. **Given** the deck builder integrates the shared `CardComponent` (`app-card`), **When** cards are displayed in the canvas, **Then** they render using the shared `CardComponent` with deck-builder-specific CSS custom property values (theme, sizing). The existing deck builder card rendering behavior is preserved (deck-building interactions like add/remove are handled by the deck builder page, not the card component).

4. **Given** the deck builder integrates the shared `CardInspectorComponent` (`app-card-inspector`), **When** a card is tapped/clicked in the canvas, **Then** the inspector appears as a floating overlay centered over the canvas (`mode="click"`, Master Duel pattern). Deck-building actions (+1/-1 buttons, add to deck, remove from deck) are rendered by the deck builder page — as action buttons within or adjacent to the floating overlay, not inside the inspector component itself.

5. **Given** the deck builder renders on a mobile viewport (≤768px), **When** the navbar is in hamburger/drawer mode, **Then** the canvas parent height accounts for the mobile header: `calc(100vh - var(--mobile-header-height))`. The canvas scales correctly within the reduced space. All interactive elements meet the 44×44px minimum touch target size (NFR12).

6. **Given** the deck builder renders on a desktop viewport (>1024px), **When** the page loads, **Then** the layout matches the existing visual style with the canvas at full scale (or close to it). The sidebar navbar is in its default state.

7. **Given** the deck builder uses shared components and scaling, **When** all existing deck builder interactions are tested manually, **Then** card browsing, deck editing, search/filter, and inspector display all work correctly. No functionality is lost compared to the pre-refactor version.

## Tasks / Subtasks

- [x] Task 1: Migrate DeckBuilderCardComponent → shared CardComponent in deck builder templates (AC: #3, #7)
  - [x]1.1 Create `toSharedCardData(cd: CardDetail): SharedCardData` adapter function in a shared utility (e.g., `core/model/shared-card-data.ts` or a local helper)
  - [x]1.2 Migrate `card-list.component.ts/html`: replace `<deck-builder-card>` with wrapper `<div>` + `<app-card>` inside. Move `cdkDrag`, `cdkDragData`, `cdkDragDisabled`, `dblclick`, ban info badge, owned count badge to wrapper div. Import shared `CardComponent`.
  - [x]1.3 Migrate `deck-card-zone.component.ts/html`: replace `<deck-builder-card>` with wrapper `<div>` + `<app-card>`. Preserve CDK drag/drop behavior, context menu (right-click to remove), and slot-based display. Import shared `CardComponent`.
  - [x]1.4 Migrate `hand-test.component.ts/html`: replace `<deck-builder-card>` with `<app-card>`. Simple rendering — no drag, no interaction beyond display.
  - [x]1.5 Migrate `deck-viewer.component.ts/html` if it directly uses DeckBuilderCardComponent (verify — likely uses DeckCardZoneComponent instead)
  - [x]1.6 Migrate INFORMATIVE display mode: move the name + attribute icons + stats panel layout (`.cardContainer-infos`) to the parent wrapper in card-list. `<app-card>` renders image only (MOSAIC equivalent).
  - [x]1.7 Migrate OWNED display mode: move quantity controls, set code, rarity per edition to the parent wrapper. `<app-card>` renders the small card image only. Import `FindOwnedCardPipe` and `FindGroupedOwnedCardPipe` in the parent wrapper component (`card-list.component.ts`) — these pipes provide OWNED-mode data (owned count, grouped editions).
  - [x]1.8 Verify `ng build` compiles with zero TS/Angular errors

- [x] Task 2: Integrate shared CardInspectorComponent (mode="click") — replace TooltipService flow (AC: #4, #7)
  - [x]2.1 In `deck-builder.component.ts`: add `selectedCardForInspector = signal<SharedCardInspectorData | null>(null)`, add `toSharedCardInspectorData(cd: CardDetail): SharedCardInspectorData` adapter, add card click handler that sets the signal
  - [x]2.2 In `deck-builder.component.html`: add `<app-card-inspector [card]="selectedCardForInspector()" mode="click" (dismissed)="selectedCardForInspector.set(null)" />`. Import `CardInspectorComponent`.
  - [x]2.3 Remove `[customToolTip]` directive references from all deck builder card templates (card-list, deck-card-zone)
  - [x]2.4 Remove `TooltipService` injection from `deck-builder.component.ts`
  - [x]2.5 Wire card click events: card-list card click → emit event to deck-builder → set `selectedCardForInspector`
  - [x]2.6 Add deck-building action buttons (add/remove from deck, +1/-1) in a `<div class="inspector-actions">` rendered by `DeckBuilderComponent`, positioned below the inspector panel within the backdrop overlay. Pattern: the backdrop `<div>` wraps both `<app-card-inspector>` and the actions div. Managed entirely by `DeckBuilderComponent` — NOT inside the inspector component.
  - [x]2.7 Verify inspector appears on card click, dismisses on Escape/backdrop click, shows full card details

- [x] Task 3: Apply ScalingContainerDirective to deck builder canvas (AC: #1, #2, #5, #6)
  - [x]3.1 Refactor `deck-builder.component.html` layout: split into responsive header (deck name + action buttons ONLY — Track B) + scaled canvas (CardSearcherComponent + DeckViewerComponent — Track A). **MANDATORY (CDK constraint):** CardSearcherComponent (search input, filters, AND CardListComponent results) MUST be inside the canvas. CDK DragDrop requires all connected `cdkDropList` elements to be children of the same `transform: scale()` container — cross-scale drag does NOT work.
  - [x]3.2 Apply `[appScalingContainer]` directive on the canvas container wrapping CardSearcherComponent + DeckViewerComponent. Set `[aspectRatio]` to the deck builder canvas's actual content aspect ratio (NOT 16/9 — measure via DevTools). Set `[referenceWidth]` to a calibrated value (start with `1200` — adjust based on current canvas content width). **Calibration sub-task:** open DevTools at 1920px viewport, measure the unscaled canvas container's natural width and height, compute `aspectRatio = width / height`, use that value and the natural width as `referenceWidth`.
  - [x]3.3 Ensure canvas parent has explicit height: `calc(100vh - headerHeight)` on desktop, `calc(100vh - var(--mobile-header-height))` on mobile. Use `@include canvas-parent` from `_canvas-scaling.scss`.
  - [x]3.4 Remove existing `scaleFactor` manual calculation from `deck-builder.component.ts` if present (ScalingContainerDirective handles this now)
  - [x]3.5 Import `ScalingContainerDirective` in `deck-builder.component.ts`
  - [x]3.6 Use responsive SCSS mixins from `_responsive.scss` for the header area breakpoints
  - [x]3.7 Verify canvas scaling works at multiple viewport widths (800px, 1024px, 1440px, 1920px)

- [x] Task 4: Deprecate and remove old tooltip infrastructure from deck builder (AC: #7)
  - [x]4.1 Remove `ToolTipRendererDirective` import from `card-list.component.ts` (and any other deck builder consumers)
  - [x]4.2 Remove `ImgLoaderDirective` usage from card templates if no longer needed
  - [x]4.3 Remove `TooltipService` injection from `deck-builder.component.ts` and any child components
  - [x]4.4 **Do NOT delete** `TooltipService`, `ToolTipRendererDirective`, `CardTooltipComponent`, or `<card-tooltip>` from `app.component.html` yet — Story 8.5 (card search page) still uses them. Deletion happens after 8.5 migrates.
  - [x]4.5 Remove `DeckBuilderCardComponent` legacy bridge files: delete `deck-builder-card.component.ts`, `.html`, `.scss`
  - [x]4.6 Remove `CardSize` enum imports from deck builder consumers — sizing is now via CSS custom properties on `<app-card>` host
  - [x]4.7 Verify `ng build` compiles cleanly

- [x] Task 5: Mobile responsive adjustments (AC: #5)
  - [x]5.1 Ensure deck builder canvas parent uses `calc(100vh - var(--mobile-header-height))` on viewports ≤768px
  - [x]5.2 Verify all interactive elements (buttons, card click targets) meet 44×44px minimum on mobile using `@include touch-target-min` where needed
  - [x]5.3 Verify header area (deck name, action buttons, search) stacks vertically or wraps on mobile viewports
  - [x]5.4 Verify inspector overlay (click mode) is centered and usable on mobile

- [x] Task 6: Verify zero regression (AC: #7)
  - [x]6.1 `ng build` succeeds with zero TS/Angular errors (budget warning is pre-existing)
  - [x]6.2 Verify no remaining references to `DeckBuilderCardComponent` or `deck-builder-card` in any active import
  - [x]6.3 Manual test: cards render correctly in MOSAIC display mode in deck zones
  - [x]6.4 Manual test: cards render correctly in INFORMATIVE display mode in card-list (search results)
  - [x]6.5 Manual test: cards render correctly in OWNED display mode (per-set quantity controls)
  - [x]6.6 Manual test: card images load correctly (small URL)
  - [x]6.7 Manual test: ban info badge (0, 1, 2) displays on restricted cards
  - [x]6.8 Manual test: CDK drag between deck zones works (Main → Extra, etc.) in deck build mode
  - [x]6.9 Manual test: CDK drag is disabled when not in deck build mode
  - [x]6.10 Manual test: card double-click adds card to deck
  - [x]6.11 Manual test: owned quantity increment/decrement works in OWNED mode
  - [x]6.12 Manual test: card click opens inspector overlay (click mode, centered, backdrop)
  - [x]6.13 Manual test: inspector overlay shows full card details
  - [x]6.14 Manual test: inspector overlay dismisses on backdrop click and Escape key
  - [x]6.15 Manual test: deck-building action buttons work in inspector context (add/remove from deck)
  - [x]6.16 Manual test: canvas scaling works — deck viewer scales proportionally at different viewport sizes
  - [x]6.17 Manual test: mobile viewport — canvas scales, header responsive, touch targets adequate
  - [x]6.18 Manual test: simulator still works correctly (no regression from shared component changes)

## Dev Notes

### Binding Implementation Spec

**This story MUST follow the migration plan from Story 8.1:**
- `_bmad-output/implementation-artifacts/8-1-migration-plan.md` — Sections 4.3, 4.3.1, 4.4
- The migration plan defines the exact adapter pattern, template migration steps, tooltip deprecation scope, and test checklist. It is authoritative.

### Architecture Context: Two-Track Responsive Strategy

The deck builder uses a **hybrid layout** — combining both responsive strategies:

- **Track B (header area):** The deck name input and action buttons above the canvas use standard mobile-first responsive CSS with breakpoints from `_responsive.scss` (`$bp-mobile: 576px`, `$bp-tablet: 768px`, `$bp-desktop-sm: 1024px`). **Search/filter controls are NOT in the header** — they are inside the canvas (CDK constraint, see below).
- **Track A (canvas area):** The card grid/workspace below the header uses `ScalingContainerDirective` with fixed reference resolution and `transform: scale()`. The canvas structure is invariant — only the scale factor changes.

The boundary is clear: **deck name and action buttons go in the header; everything involving card search, filtering, and card arrangement goes in the canvas** (CDK DragDrop requires all connected drop lists under the same scaled container).

[Source: _bmad-output/planning-artifacts/architecture.md — Responsive Strategy section]

### ScalingContainerDirective Usage

The directive is already created at `components/scaling-container/scaling-container.directive.ts` (Story 7.1, 103 lines).

**Interface:**
```typescript
@Directive({ selector: '[appScalingContainer]', standalone: true })
export class ScalingContainerDirective {
  aspectRatio = input<number>(16 / 9);
  referenceWidth = input<number>(1920);
  scale = output<number>();
}
```

**Behavior:**
- Observes parent element dimensions via ResizeObserver
- Computes `scale = min(parentWidth / refWidth, parentHeight / refHeight, 1)` (capped at 1.0 — no upscaling)
- Applies `transform: scale(scale)` and `transform-origin: top center`
- Reactive: recalculates on parent resize (viewport change, navbar toggle)

**Critical constraint:** Parent container MUST have explicit height (not `height: auto`). Use `@include canvas-parent` from `_canvas-scaling.scss` for the parent setup.

**`referenceWidth` calibration for deck builder:**
- The simulator uses `1060` (its original board width at 16:9 ratio scaled).
- The deck builder needs a different value based on its own content density. Start with `1200` and adjust:
  - Measure the current natural width of the DeckViewerComponent (main + extra + side zones)
  - The `referenceWidth` should match the unscaled pixel width the canvas was designed for
  - If the current deck viewer width is ~1100-1200px, use `1200`
  - Test at viewport widths 800px, 1024px, 1440px, 1920px — cards should remain readable at all sizes

[Source: front/src/app/components/scaling-container/scaling-container.directive.ts — 103 lines]
[Source: front/src/app/styles/_canvas-scaling.scss — canvas-parent mixin]

### Current Deck Builder Layout (Pre-Refactor)

The `DeckBuilderComponent` (192 lines TS, 68 lines HTML, 136 lines SCSS) currently has:
- **Layout:** Flex two-column — left (`.deckBuilder-viewer`) + right (`.deckBuilder-side`)
- **Left column:** DeckViewerComponent + HandTestComponent overlay
- **Right column:** Deck name input, action buttons (Save, Print, Export, Import, Test Hand, Simulator), images zone (3-slot card display), CardSearcherComponent, CardFiltersComponent
- **Scaling:** Has a `scaleFactor` signal — already has some manual scaling logic that should be replaced by `ScalingContainerDirective`
- **CDK:** `CdkDropListGroup` is applied at the deck builder level to connect search results and deck zones

**Hybrid layout target (post-refactor):**
```
┌───────────────────────────────────────────────────────┐
│  HEADER (Track B — responsive)                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Deck name input  │  Action buttons (Save, Print, │ │
│  │                  │  Export, Import, Test Hand,    │ │
│  │                  │  Simulator)                    │ │
│  └──────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────┤
│  CANVAS (Track A — scaled)                            │
│  ┌──────────────────────────────────────────────────┐ │
│  │  [appScalingContainer]                           │ │
│  │  ┌──────────────────┐ ┌────────────────────────┐ │ │
│  │  │CardSearcher      │ │ DeckViewerComponent    │ │ │
│  │  │ (search input +  │ │ (Main + Extra + Side)  │ │ │
│  │  │  filters +       │ │                        │ │ │
│  │  │  CardList results│ │                        │ │ │
│  │  └──────────────────┘ └────────────────────────┘ │ │
│  └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

**MANDATORY (CDK constraint):** CardSearcherComponent (search input, filters, AND CardListComponent results) MUST be inside the scaled canvas alongside the deck zones. CDK DragDrop requires all connected `cdkDropList` elements to be children of the same `transform: scale()` container. Cross-scale drag (one list inside scaled container, one outside) does NOT work — pointer coordinates are misaligned. The header contains ONLY deck name + action buttons.

[Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts — 192 lines]
[Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html — 68 lines]

### DeckBuilderCardComponent → CardComponent Migration

**Migration pattern per consuming component:**

The existing `DeckBuilderCardComponent` (selector `deck-builder-card`, 107 lines TS, 88 lines HTML, 290 lines SCSS) is a monolithic component with display modes (MOSAIC, INFORMATIVE, OWNED), CDK drag built-in, tooltip directive, and business logic (add to deck on dblclick, quantity management). The shared `CardComponent` is purely presentational — all business logic and display chrome moves to the parent wrapper.

**card-list.component migration:**
```html
<!-- BEFORE: -->
<deck-builder-card
  [cardDetail]="cd"
  [size]="size()"
  [cropped]="cropped()"
  [displayMode]="displayMode()"
  [deckBuildMode]="deckBuildMode()"
  [searchService]="searchService()" />

<!-- AFTER (MOSAIC mode): -->
<div class="card-wrapper"
     cdkDrag
     [cdkDragDisabled]="!deckBuildMode()"
     [cdkDragData]="cd"
     (dblclick)="onDoubleClick(cd)"
     (click)="onCardClick(cd)">
  <app-card [card]="toSharedCardData(cd)" />
  @if (cd.card.banInfo < 3) {
    <div class="ban-badge">{{ cd.card.banInfo }}</div>
  }
</div>
```

**INFORMATIVE mode:** The info panel (name, attribute icons, ATK/DEF) moves to the parent wrapper alongside `<app-card>`:
```html
<div class="card-wrapper informative-mode"
     (click)="onCardClick(cd)">
  <app-card [card]="toSharedCardData(cd)" />
  <div class="card-info">
    <span class="card-name">{{ cd.card.name }}</span>
    <!-- attribute icons, race, ATK/DEF... -->
  </div>
</div>
```

**OWNED mode:** The quantity controls, set code, rarity per edition move to the parent wrapper. `<app-card>` renders only the small image.

[Source: _bmad-output/implementation-artifacts/8-1-migration-plan.md — Section 4.3]

### SharedCardData Adapter for Deck Builder

```typescript
// Reusable adapter — add to core/model/shared-card-data.ts or local helper
toSharedCardData(cd: CardDetail): SharedCardData {
  return {
    name: cd.card.name ?? '',
    imageUrl: cd.images[0]?.smallUrl ?? '',
    imageUrlFull: cd.images[0]?.url ?? '',
  };
}
```

### SharedCardInspectorData Adapter for Deck Builder

```typescript
// In deck-builder.component.ts
toSharedCardInspectorData(cd: CardDetail): SharedCardInspectorData {
  const c = cd.card;
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
}
```

Note the data path: `cd.card.name` (2-level, not 3-level like simulator's `ci.card.card.name`).

[Source: _bmad-output/implementation-artifacts/8-1-migration-plan.md — Section 3.1, 3.2]

### CSS Custom Properties for Deck Builder Card Styling

The shared `CardComponent` uses CSS custom properties for theming. The deck builder needs to set appropriate values on the host or parent container:

```scss
// In deck-builder.component.scss or deck-card-zone.component.scss
app-card {
  // Deck builder uses fixed px sizing (parent controls width/height)
  --card-border-radius: 2px;
  --card-shadow: none;
}
```

**Sizing is parent-controlled:** The shared `CardComponent` fills its host (`width: 100%; height: 100%; aspect-ratio: 59/86`). The parent sets the card dimensions via CSS on `<app-card>` or its wrapper:

| Old CardSize enum | Dimensions (W×H px) | New approach |
|---|---|---|
| DECK | 75×100 | Parent sets `width: 75px` on `<app-card>` |
| DECK_EXTRA_SIDE | 50×66.5 | Parent sets `width: 50px` on `<app-card>` |
| BIG | 250×365 | Parent sets `width: 250px` on `<app-card>` |
| MEDIUM | 100×147 | Parent sets `width: 100px` on `<app-card>` |
| SMALL | 33×44 | Parent sets `width: 33px` on `<app-card>` |

[Source: _bmad-output/implementation-artifacts/8-1-migration-plan.md — Section 3.3]

### TooltipService Deprecation Scope (Partial — Deck Builder Only)

**Story 8.4 removes tooltip usage FROM the deck builder.** Story 8.5 removes it from the card search page. After both are done, the global `<card-tooltip>` in `app.component.html` and the `TooltipService` / `ToolTipRendererDirective` can be fully deleted.

**In this story:**
- Remove `[customToolTip]` from card-list and deck-card-zone templates
- Remove `TooltipService` injection from `deck-builder.component.ts`
- Remove `ToolTipRendererDirective` import from `card-list.component.ts`
- **Do NOT delete** `TooltipService`, `ToolTipRendererDirective`, `CardTooltipComponent`, or `<card-tooltip>` from `app.component.html` — card search page still uses them

**Favorite toggle and deck +1/-1 buttons:**
- `CardTooltipComponent` currently renders favorite toggle and deck add/remove buttons
- After migration, these features are the deck builder page's responsibility — render them as action buttons adjacent to the `<app-card-inspector mode="click">` overlay
- The shared `CardInspectorComponent` never renders deck-building buttons

[Source: _bmad-output/implementation-artifacts/8-1-migration-plan.md — Section 4.3.1]

### CardSearcherComponent Integration

`CardSearcherComponent` is a child of `DeckBuilderComponent` that renders `CardListComponent` (which renders `DeckBuilderCardComponent` cards). After migration:
- `CardListComponent` renders shared `<app-card>` in wrapper divs
- `CardSearcherComponent` itself needs no direct code changes — it delegates card rendering to `CardListComponent` which handles the `<app-card>` migration
- The `CdkDropListGroup` on `DeckBuilderComponent` connects the search list with deck zones — verify this still works after migration

[Source: front/src/app/components/card-list/card-list.component.ts — 42 lines]

### HandTestComponent Migration

`HandTestComponent` (45 lines) displays 5-6 cards for the opening hand test. It currently uses `DeckBuilderCardComponent`. Migration is straightforward — replace with `<app-card>` wrapping `IndexedCardDetail`:

```typescript
// IndexedCardDetail has a .cardDetail property (CardDetail)
toSharedCardData(icd: IndexedCardDetail): SharedCardData {
  return {
    name: icd.cardDetail.card.name ?? '',
    imageUrl: icd.cardDetail.images[0]?.smallUrl ?? '',
    imageUrlFull: icd.cardDetail.images[0]?.url ?? '',
  };
}
```

**Recommendation:** Consider rendering `HandTestComponent` as a positioned overlay OUTSIDE the canvas (e.g., fixed/absolute positioned above the canvas). Since it has no CDK drag interactions, it doesn't need to be inside the scaled container — rendering outside avoids scaling the hand test cards, improving readability.

[Source: front/src/app/pages/deck-page/components/deck-builder/components/hand-test/hand-test.component.ts — 45 lines]

### Previous Story Intelligence (Stories 8.2, 8.3)

**Key learnings that apply to this story:**

1. **Adapter deduplication (8.2 H1 fix):** The simulator's `toSharedCardData()` was extracted to `simulator.models.ts`. For the deck builder, create a separate `toSharedCardData(cd: CardDetail)` function — different data model, different adapter. Consider adding it to `core/model/shared-card-data.ts` as a standalone export.

2. **`:host` aspect-ratio (8.2 H2 fix):** The shared `CardComponent` has `aspect-ratio: 59/86` on `:host`. Parents set width; height follows automatically. Do NOT set both width and height on the wrapper — set width only.

3. **`?? ''` fallback (8.2 M1 fix):** All nullable string fields in adapters (`name`, `description`) must use `?? ''`.

4. **OnPush required (8.2 M2 fix):** All modified components must have `ChangeDetectionStrategy.OnPush`.

5. **Build budget error is pre-existing** — `ng build` succeeding with only the budget warning is expected.

6. **Legacy bridge from 8.2:** Story 8.2 created `deck-builder-card.component.*` as a legacy bridge. **This story deletes those files** after migrating all deck builder consumers to `<app-card>`.

7. **Template deduplication (8.3 M1 fix):** The inspector uses `<ng-template #cardDetails>` to avoid duplication between modes.

8. **Inspector image optimization (8.3 L3 fix):** `hover` mode uses `imageUrl` (small), `click` mode uses `imageUrlFull || imageUrl` (full-size). Deck builder uses `click` mode — full-size image displays correctly.

### Git Intelligence

Recent commits show the progression: `8-1 et 8-2` → `7-3 & 7-4` → `7-1` → `v1` → `mvp`. The codebase is on the `hand-testing` branch with:
- Sprint status modified (tracking)
- Board component modified (8-3 changes)
- Old SimCardInspectorComponent files deleted (8-3)
- New shared card-inspector files added (8-3)

### Critical Anti-Patterns to Avoid

1. **DO NOT inject services into shared `CardComponent`** — it is purely presentational (this is already enforced from 8.2)
2. **DO NOT add display modes (INFORMATIVE, OWNED, MOSAIC) to the shared CardComponent** — these are parent wrapper concerns
3. **DO NOT delete TooltipService/CardTooltipComponent globally** — card search page still uses them (Story 8.5)
4. **DO NOT use `@import`** in SCSS — use `@use` syntax only
5. **DO NOT set both width AND height on `<app-card>`** — set width only, aspect-ratio handles height
6. **DO NOT break CDK drag connections** — the `CdkDropListGroup` on `DeckBuilderComponent` must encompass the ENTIRE canvas (both CardSearcherComponent and DeckViewerComponent). All `cdkDropList` instances must be descendants of the same scaled container
7. **DO NOT hardcode card dimensions** — use CSS custom properties or parent CSS, not a `size` input enum
8. **DO NOT add favorite/add-remove deck buttons to `CardInspectorComponent`** — these are page-specific, rendered externally
9. **DO NOT delete the `CustomTooltipComponent`** (`custom-tooltip.component.ts`) — it is a separate, unrelated general-purpose tooltip. Only the card-specific `CardTooltipComponent` is being deprecated.
10. **DO NOT mix up data paths** — deck builder uses `cd.card.name` (2-level), simulator uses `ci.card.card.name` (3-level). The adapters are different.

### Project Structure Notes

**Files to create:** None (all shared components already exist from 8.2/8.3)

**Files to delete:**
- `front/src/app/components/card/deck-builder-card.component.ts` (legacy bridge)
- `front/src/app/components/card/deck-builder-card.component.html` (legacy bridge)
- `front/src/app/components/card/deck-builder-card.component.scss` (legacy bridge)

**Files to modify (deck builder migration):**
| File | Changes |
|------|---------|
| `front/src/app/components/card-list/card-list.component.ts` | Remove `DeckBuilderCardComponent`/`ToolTipRendererDirective` imports → add `CardComponent`. Add `toSharedCardData()` adapter. Add card click output. |
| `front/src/app/components/card-list/card-list.component.html` | `<deck-builder-card>` → wrapper div + `<app-card>`. Move CDK drag, display mode chrome, ban info to wrapper. |
| `front/src/app/components/card-list/card-list.component.scss` | Add wrapper styles, card sizing via CSS custom properties. Adapt display mode layouts. |
| `front/src/app/components/deck-card-zone/deck-card-zone.component.ts` | Remove `DeckBuilderCardComponent` import → add `CardComponent`. Add `toSharedCardData()` adapter. |
| `front/src/app/components/deck-card-zone/deck-card-zone.component.html` | `<deck-builder-card>` → wrapper div + `<app-card>`. Preserve CDK drag, context menu. |
| `front/src/app/components/deck-card-zone/deck-card-zone.component.scss` | Card sizing via CSS on `<app-card>` host. |
| `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts` | Add `selectedCardForInspector` signal, adapter, click handler. Remove `TooltipService`. Add `CardInspectorComponent` + `ScalingContainerDirective` imports. |
| `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html` | Add `<app-card-inspector mode="click">`. Refactor layout to hybrid (responsive header + scaled canvas). Apply `[appScalingContainer]`. |
| `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss` | Canvas parent height, responsive header styles. Import `_responsive.scss` and `_canvas-scaling.scss`. |
| `front/src/app/pages/deck-page/components/deck-builder/components/hand-test/hand-test.component.ts` | Remove `DeckBuilderCardComponent` import → add `CardComponent`. Add adapter. |
| `front/src/app/pages/deck-page/components/deck-builder/components/hand-test/hand-test.component.html` | `<deck-builder-card>` → `<app-card>`. |
| `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.ts` | Update `CardSize` import if needed (may just need removal). |
| `front/src/app/components/card-searcher/card-searcher.component.ts` | Update `CardSize` import if needed. |

**NOT modified in this story:**
- Card search page (`card-search-page.component`) — migration to shared components in Story 8.5
- `TooltipService`, `ToolTipRendererDirective`, `CardTooltipComponent` — NOT deleted (still used by card search)
- `app.component.html` — `<card-tooltip>` NOT removed yet
- Simulator components — no changes (already using shared components from 8.2/8.3)

### References

- [Source: _bmad-output/implementation-artifacts/8-1-migration-plan.md — Sections 4.3, 4.3.1, 4.4]
- [Source: _bmad-output/implementation-artifacts/8-1-harmonization-analysis-and-migration-plan.md — Full analysis]
- [Source: _bmad-output/implementation-artifacts/8-2-extract-shared-cardcomponent.md — Previous story learnings]
- [Source: _bmad-output/implementation-artifacts/8-3-extract-shared-cardinspectorcomponent.md — Previous story learnings]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 8, Story 8.4]
- [Source: _bmad-output/planning-artifacts/architecture.md — Responsive Strategy, Shared Component Extraction sections]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Responsive Design section, Two-Track strategy]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts — 192 lines]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html — 68 lines]
- [Source: front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss — 136 lines]
- [Source: front/src/app/components/card-list/card-list.component.ts — 42 lines]
- [Source: front/src/app/components/deck-card-zone/deck-card-zone.component.ts — 68 lines]
- [Source: front/src/app/components/card/deck-builder-card.component.ts — 107 lines (legacy bridge)]
- [Source: front/src/app/components/card-tooltip/card-tooltip.component.ts — 65 lines (to be partially deprecated)]
- [Source: front/src/app/services/tooltip.service.ts — 21 lines (to be partially deprecated)]
- [Source: front/src/app/core/directives/tooltip.directive.ts — 87 lines (to be partially deprecated)]
- [Source: front/src/app/components/scaling-container/scaling-container.directive.ts — 103 lines]
- [Source: front/src/app/styles/_responsive.scss — 36 lines]
- [Source: front/src/app/styles/_canvas-scaling.scss — 31 lines]
- [Source: front/src/app/pages/simulator/board.component.ts — 118 lines (current after 8-3)]
- [Source: front/src/app/core/model/shared-card-data.ts — SharedCardData + SharedCardInspectorData interfaces]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- SCSS `@use` vs `@import` conflict: `mixin.scss` needed `@use 'variable' as _v` to avoid namespace collision with files that `@import 'variable'` then `@import 'mixin'`. Using `as *` caused "both define variable $black" errors.
- `[size]` binding removed from deck-builder template after `CardSize` enum and `size` input were removed from deck-card-zone.
- `NgIf` import removed from deck-builder — replaced `*ngIf` with `@if` control flow for hand-test.

### Completion Notes List

- Task 1: Migrated all deck builder consumers (card-list, deck-card-zone, hand-test, deck-viewer) from `DeckBuilderCardComponent` to shared `CardComponent` with `toSharedCardData` adapter. Created adapter functions in `core/model/shared-card-data.ts`. All 3 display modes (MOSAIC, INFORMATIVE, OWNED) migrated to parent wrappers.
- Task 2: Integrated `CardInspectorComponent` (mode=click) with `selectedCardForInspector` signal, `toSharedCardInspectorData` adapter, card click event chain from card-list→card-searcher→deck-builder and deck-card-zone→deck-viewer→deck-builder. Added inspector-actions with add/remove deck buttons.
- Task 3: Refactored layout to hybrid header (Track B responsive) + canvas (Track A scaling with ScalingContainerDirective). referenceWidth=1200, aspectRatio=1.5. Canvas parent uses `@include canvas-parent` + `flex: 1`. cdkDropListGroup moved to canvas container. Hand-test moved outside canvas as fixed overlay.
- Task 4: All tooltip references already removed in Tasks 1-2. Deleted legacy bridge files (deck-builder-card.component.ts/html/scss). Zero remaining references to DeckBuilderCardComponent or CardSize.
- Task 5: Header wraps on mobile (respond-below bp-tablet). Canvas parent height adapts via flex layout inheriting from app.component mobile padding-top. Touch targets on inspector action buttons enforced with touch-target-min mixin.
- Task 6: `ng build` succeeds with zero TS/Angular errors. Only pre-existing budget warning. No remaining references to legacy components.

### File List

**Created:**
- (none — all shared components already existed from 8.2/8.3)

**Modified:**
- `front/src/app/core/model/shared-card-data.ts` — Added `toSharedCardData()` and `toSharedCardInspectorData()` adapter functions for deck builder's CardDetail model
- `front/src/app/components/card-list/card-list.component.ts` — Replaced DeckBuilderCardComponent with CardComponent, added card click/drag/dblclick handlers, quantity management
- `front/src/app/components/card-list/card-list.component.html` — Complete rewrite: 3 display mode branches with `<app-card>` in wrapper divs, modern `@for`/`@if` control flow
- `front/src/app/components/card-list/card-list.component.scss` — Rewritten with `@use` syntax, card-wrapper/ban-badge/owned-count/card-info styles
- `front/src/app/components/card-searcher/card-searcher.component.ts` — Removed CardSize, added cardClicked output
- `front/src/app/components/card-searcher/card-searcher.component.html` — Removed size/cropped bindings, added cardClicked forwarding
- `front/src/app/components/deck-card-zone/deck-card-zone.component.ts` — Replaced DeckBuilderCardComponent with CardComponent, added cardClicked output
- `front/src/app/components/deck-card-zone/deck-card-zone.component.html` — `<card>` → `<app-card>` with toSharedCardData adapter
- `front/src/app/components/deck-card-zone/deck-card-zone.component.scss` — `@use` syntax, card slot padding, CSS custom properties
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts` — Added CardInspectorComponent, ScalingContainerDirective imports; selectedCardForInspector signal; card click/inspector/deck action methods; removed TooltipService, NgIf, CardSize
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html` — Refactored to hybrid layout: header (Track B) + canvas parent + canvas (Track A with appScalingContainer); hand-test moved outside canvas; added inspector + action buttons
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss` — Complete rewrite: `@use` syntax, header (responsive breakpoints), canvasParent (canvas-parent mixin), canvas (flex layout), handOverlay (fixed), inspector styles, touch-target-min
- `front/src/app/pages/deck-page/components/deck-builder/components/hand-test/hand-test.component.ts` — Replaced DeckBuilderCardComponent with CardComponent
- `front/src/app/pages/deck-page/components/deck-builder/components/hand-test/hand-test.component.html` — `<card>` → `<app-card>` with `@for` control flow
- `front/src/app/pages/deck-page/components/deck-builder/components/hand-test/hand-test.component.scss` — `.hand-card` selector with explicit width
- `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.ts` — Removed CardSize, added cardClicked output
- `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.html` — Removed size bindings, added cardClicked forwarding
- `front/src/app/styles/mixin.scss` — Added `@use 'variable' as _v` for `@use` compatibility

**Deleted:**
- `front/src/app/components/card/deck-builder-card.component.ts` — Legacy bridge (created in 8.2, replaced by shared CardComponent)
- `front/src/app/components/card/deck-builder-card.component.html` — Legacy bridge template
- `front/src/app/components/card/deck-builder-card.component.scss` — Legacy bridge styles

### Change Log

- 2026-02-14: Implemented Story 8.4 — migrated all deck builder consumers to shared CardComponent and CardInspectorComponent, applied ScalingContainerDirective with hybrid Track A/B layout, deleted legacy DeckBuilderCardComponent bridge files, added mobile responsive adjustments.
- 2026-02-14: **Code Review (AI)** — 7 issues found (1H, 4M, 2L), all fixed:
  - H1: Fixed `removeSelectedCardFromDeck()` to search all 3 zones (main, extra, side) instead of only main/extra
  - M1: Reorganized `shared-card-data.ts` — imports at top, interfaces before functions
  - M2: Projected inspector action buttons inside `<app-card-inspector>` via `<ng-content>` (backdrop now wraps both panel and actions per spec)
  - M3: Migrated card-searcher from `*ngIf`/`NgIf` to `@if` control flow
  - M4: Removed obsolete vendor prefixes for `user-select` in deck-builder SCSS
  - L1: Added click handler on OWNED mode rows for card inspection
  - L2: Added `(cardClicked)` binding on cover images deck-card-zone
- 2026-02-14: **Code Review 2 (Sprint 7+8 cross-review)** — 4 uncommitted fixes documented:
  - card-list.component.ts: `!.clearOffset()` → `?.clearOffset()` (null safety fix in ngOnDestroy)
  - card-searcher.component.scss: `@import 'variable'` → `@use 'variable' as *` (deprecated SCSS syntax)
  - deck-builder.component.ts: `selectedCardDetail` plain property → `signal<CardDetail | null>(null)` (OnPush reactivity fix)
  - deck-viewer.component.scss: `@import '../../../../../../styles/variable'` → `@use 'variable' as *` (deprecated SCSS syntax)
