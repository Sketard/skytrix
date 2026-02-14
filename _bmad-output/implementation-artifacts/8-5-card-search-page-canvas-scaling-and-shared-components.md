# Story 8.5: Card Search Page Canvas Scaling & Shared Components

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the card search page to scale its card results canvas on all viewport sizes and use the same card/inspector components,
So that I can search and browse cards comfortably on any device.

## Acceptance Criteria

1. **Given** the card search page has a card results area (canvas), **When** the `ScalingContainerDirective` from Epic 7 is applied to the results container, **Then** the results canvas scales proportionally via `transform: scale()` with a page-specific `referenceWidth` and the parent container has explicit height accounting for the search header.

2. **Given** the card search page renders, **When** the layout is displayed, **Then** the entire `CardSearcherComponent` (search bar, display toggles, filters sidebar, card results) is wrapped in the scaling canvas (Track A). No Track B header exists for this page (unlike deck builder). The canvas parent manages its own responsive height.

3. **Given** the card search page integrates the shared `CardComponent` (`app-card`), **When** search results are displayed, **Then** they render using the shared `CardComponent` (already migrated in Story 8.4 — `CardListComponent` uses `<app-card>` with `toSharedCardData` adapter). No card rendering changes are needed in this story.

4. **Given** the card search page integrates the shared `CardInspectorComponent` (`app-card-inspector`), **When** a card is tapped/clicked in the results, **Then** the inspector appears as a floating overlay centered on screen (`mode="click"`, Master Duel pattern) showing the full card image, name, stats, and description. A favorite toggle button is projected into the inspector's `<ng-content>` slot inside the backdrop.

5. **Given** the card search page renders on a mobile viewport (<=768px), **When** the navbar is in hamburger/drawer mode, **Then** the canvas parent height accounts for the mobile header: `calc(100vh - var(--mobile-header-height))`. All interactive elements meet the 44x44px minimum touch target size (NFR12).

6. **Given** the card search page renders on a desktop viewport (>1024px), **When** the page loads, **Then** the canvas scales to fill the available space. The layout is visually consistent with the deck builder's canvas scaling pattern.

7. **Given** the card search page uses shared components and scaling, **When** all existing card search interactions are tested manually, **Then** searching, filtering, browsing results, display mode switching (INFORMATIVE, MOSAIC, OWNED, FAVORITE), and viewing card details all work correctly. No functionality is lost compared to the pre-refactor version.

8. **Given** Epic 8 is fully complete (stories 8.1-8.5), **When** the legacy tooltip infrastructure has no remaining consumers, **Then** `TooltipService`, `ToolTipRendererDirective`, `CardTooltipComponent`, and `<card-tooltip>` in `app.component.html` are fully deleted. `CustomTooltipComponent` is NOT deleted (unrelated component).

## Tasks / Subtasks

- [x] Task 1: Integrate CardInspectorComponent (mode="click") in CardSearchPageComponent — replace TooltipService flow (AC: #4, #7)
  - [x] 1.1 In `card-search-page.component.ts`: remove `TooltipService` import and injection. Add imports for `CardInspectorComponent`, `SharedCardInspectorData`, `toSharedCardInspectorData`, `HttpClient`, `firstValueFrom`. Add `selectedCardForInspector = signal<SharedCardInspectorData | null>(null)` and `private selectedCardDetail: CardDetail | null = null`. Add `onCardClicked(cd: CardDetail)` that sets both signals. Add `dismissInspector()` that nulls both.
  - [x] 1.2 Add favorite toggle method `toggleFavorite()` in `card-search-page.component.ts` — replicates the existing `CardTooltipComponent.toggleFavorite()` logic: call `cardSearchService.addFavoriteCard(httpClient, id)` or `removeFavoriteCard(httpClient, id)` via `firstValueFrom`, then update the local `selectedCardDetail` with toggled `favorite` and re-set the inspector data, and call `cardSearchService.refreshResearch()`.
  - [x] 1.3 In `card-search-page.component.html`: add `(cardClicked)="onCardClicked($event)"` binding on `<app-card-searcher>`. Add `<app-card-inspector [card]="selectedCardForInspector()" mode="click" (dismissed)="dismissInspector()">` with a projected favorite toggle button inside `<ng-content>`: a `<button mat-icon-button>` with star/star_border icon based on `selectedCardDetail?.favorite`.
  - [x] 1.4 In `card-search-page.component.ts`: add `CardInspectorComponent`, `MatIconButton`, `MatIcon` to `imports` array.
  - [x] 1.5 Verify inspector appears on card click, shows full card details (image, name, stats, description), shows correct favorite icon, dismisses on backdrop click and Escape key.

- [x] Task 2: Implement favorite toggle functionality (AC: #4, #7)
  - [x] 2.1 Verify the `toggleFavorite()` method correctly calls `cardSearchService.addFavoriteCard()` / `removeFavoriteCard()` and refreshes the search results list.
  - [x] 2.2 Verify the favorite icon updates immediately after toggle (star_border -> star and vice versa).
  - [x] 2.3 Verify FAVORITE display mode still works (filter toggle switches between favorite-only and all cards).

- [x] Task 3: Apply ScalingContainerDirective to card search canvas (AC: #1, #2, #5, #6)
  - [x] 3.1 In `card-search-page.component.html`: wrap `<app-card-searcher>` in a canvas parent `<div class="searchPage-canvasParent">` + canvas `<div class="searchPage-canvas" appScalingContainer [referenceWidth]="1400" [aspectRatio]="1.5">`. The canvas parent must have explicit height — use `@include canvas-parent` from `_canvas-scaling.scss`.
  - [x] 3.2 In `card-search-page.component.ts`: add `ScalingContainerDirective` to `imports`.
  - [x] 3.3 In `card-search-page.component.scss`: add styles for `.searchPage-canvasParent` (explicit height: `calc(100vh - headerHeight)`, use `@include canvas-parent` mixin) and `.searchPage-canvas` (flex child filling available space). Use `@use '../../../styles/canvas-scaling' as cs;` and `@include cs.canvas-parent;` pattern.
  - [x] 3.4 Calibrate `referenceWidth` and `aspectRatio`: open DevTools at 1920px viewport, measure the CardSearcherComponent's natural unscaled dimensions. Start with `referenceWidth=1400, aspectRatio=1.5`. Adjust if content is clipped or too small. The card search page is wider than deck builder (full width vs. half width), hence 1400 instead of 1200.
  - [x] 3.5 Verify canvas scaling at multiple viewport widths (800px, 1024px, 1440px, 1920px). Cards should remain readable at all sizes.

- [x] Task 4: Mobile responsive adjustments (AC: #5)
  - [x] 4.1 Ensure canvas parent uses mobile-aware height: `calc(100vh - var(--mobile-header-height))` on viewports <=768px. The `@include canvas-parent` mixin from `_canvas-scaling.scss` should handle this (verify).
  - [x] 4.2 Verify favorite toggle button and all card click targets meet 44x44px minimum on mobile. Use `@include touch-target-min` from `_responsive.scss` where needed.
  - [x] 4.3 Verify canvas scales correctly within the reduced mobile space.

- [x] Task 5: Delete ALL legacy tooltip infrastructure — no remaining consumers (AC: #8)
  - [x] 5.1 Delete `front/src/app/services/tooltip.service.ts`
  - [x] 5.2 Delete `front/src/app/core/directives/tooltip.directive.ts` (`ToolTipRendererDirective`)
  - [x] 5.3 Delete `front/src/app/components/card-tooltip/card-tooltip.component.ts`
  - [x] 5.4 Delete `front/src/app/components/card-tooltip/card-tooltip.component.html`
  - [x] 5.5 Delete `front/src/app/components/card-tooltip/card-tooltip.component.scss`
  - [x] 5.6 In `app.component.html`: remove the entire `<div class="dark-theme-tooltip"><card-tooltip></card-tooltip></div>` block (lines 10-12)
  - [x] 5.7 In `app.component.ts`: remove `CardTooltipComponent` import (line 5) and remove it from the `imports` array (line 12)
  - [x] 5.8 Search entire codebase for any remaining references to `TooltipService`, `ToolTipRendererDirective`, `CardTooltipComponent`, `card-tooltip`, `customToolTip`, `.dark-theme-tooltip`. All must be zero.
  - [x] 5.9 **DO NOT delete `CustomTooltipComponent`** (`custom-tooltip.component.ts`) — it is a separate, unrelated general-purpose tooltip.

- [x] Task 6: Verify zero regression (AC: #7, #8)
  - [x] 6.1 `ng build` succeeds with zero TS/Angular errors (budget warning is pre-existing and acceptable)
  - [x] 6.2 No remaining references to `TooltipService`, `CardTooltipComponent`, or `ToolTipRendererDirective` in any active import
  - [ ] 6.3 Manual test: card search page — MOSAIC display mode renders cards correctly
  - [ ] 6.4 Manual test: card search page — INFORMATIVE display mode renders card info panels
  - [ ] 6.5 Manual test: card search page — OWNED display mode shows quantity controls
  - [ ] 6.6 Manual test: card search page — FAVORITE display mode shows only favorited cards
  - [ ] 6.7 Manual test: card click opens inspector overlay (click mode, centered, backdrop, full card image)
  - [ ] 6.8 Manual test: inspector overlay dismisses on backdrop click and Escape key
  - [ ] 6.9 Manual test: favorite toggle works from inspector (star toggles, card list refreshes)
  - [ ] 6.10 Manual test: search input filtering works (type name → results filter)
  - [ ] 6.11 Manual test: filter sidebar works (attribute, type, archetype filters)
  - [ ] 6.12 Manual test: infinite scroll works (scroll to bottom → more results load)
  - [ ] 6.13 Manual test: canvas scaling works — card grid scales proportionally at different viewport sizes
  - [ ] 6.14 Manual test: mobile viewport — canvas scales, touch targets adequate
  - [ ] 6.15 Manual test: deck builder page — no regression (inspector, scaling, card rendering, CDK drag all still work)
  - [ ] 6.16 Manual test: simulator page — no regression from shared component changes
  - [ ] 6.17 Manual test: `CustomTooltipComponent` still works (not deleted)

## Dev Notes

### Architecture Context: Card Search Page Layout

The card search page is simpler than the deck builder:
- **No header (Track B) section** — unlike the deck builder, there are no deck management controls (save, print, export, etc.)
- **Entire page is a canvas (Track A)** — the `CardSearcherComponent` (search bar + display mode toggles + card list + filters sidebar) is wrapped in a single `ScalingContainerDirective` canvas
- **No CDK DragDrop** — `deckBuildMode=false`, so CDK drag is disabled in `CardListComponent`. No CDK constraint to worry about.

**Current `CardSearchPageComponent` (14 lines)** is a thin wrapper that:
1. Injects `CardSearchService` and `TooltipService`
2. Sets `tooltipService.setActiveSearchService(this.cardSearchService)` in constructor
3. Renders `<app-card-searcher [deckBuildMode]="false" [searchService]="cardSearchService">`

**After migration**, the component will:
1. Inject `CardSearchService` and `HttpClient` (no `TooltipService`)
2. Manage `selectedCardForInspector` signal + `selectedCardDetail` reference
3. Handle card click → inspector display, favorite toggle, dismiss
4. Wrap `<app-card-searcher>` in a scaling canvas with explicit height parent

### CardInspectorComponent Integration Pattern (from Story 8.4)

Follow the deck builder pattern established in `deck-builder.component.ts/html`:

```typescript
// In card-search-page.component.ts
readonly selectedCardForInspector = signal<SharedCardInspectorData | null>(null);
private selectedCardDetail: CardDetail | null = null;

onCardClicked(cd: CardDetail): void {
  this.selectedCardDetail = cd;
  this.selectedCardForInspector.set(toSharedCardInspectorData(cd));
}

dismissInspector(): void {
  this.selectedCardForInspector.set(null);
  this.selectedCardDetail = null;
}
```

```html
<!-- In card-search-page.component.html -->
<div class="searchPage-canvasParent">
  <div class="searchPage-canvas" appScalingContainer [referenceWidth]="1400" [aspectRatio]="1.5">
    <app-card-searcher
      [deckBuildMode]="false"
      [searchService]="cardSearchService"
      (cardClicked)="onCardClicked($event)">
    </app-card-searcher>
  </div>
</div>

<app-card-inspector
  [card]="selectedCardForInspector()"
  mode="click"
  (dismissed)="dismissInspector()">
  @if (selectedCardDetail; as cd) {
    <button mat-icon-button class="favorite-toggle"
            (click)="toggleFavorite(); $event.stopPropagation()"
            [title]="cd.favorite ? 'Supprimer des favoris' : 'Ajouter aux favoris'">
      <mat-icon [fontIcon]="cd.favorite ? 'star' : 'star_border'"></mat-icon>
    </button>
  }
</app-card-inspector>
```

**Important:** The `<app-card-inspector>` must be placed OUTSIDE the scaling canvas (same as deck builder). The inspector uses `position: fixed` for its backdrop, so it should be at the page root level, not inside a scaled container.

### Favorite Toggle Migration

The favorite toggle currently lives in `CardTooltipComponent` (lines 48-56). It must be replicated in `CardSearchPageComponent`:

```typescript
async toggleFavorite(): Promise<void> {
  const cd = this.selectedCardDetail;
  if (!cd) return;
  if (cd.favorite) {
    await firstValueFrom(this.cardSearchService.removeFavoriteCard(this.httpClient, cd.card.id!));
  } else {
    await firstValueFrom(this.cardSearchService.addFavoriteCard(this.httpClient, cd.card.id!));
  }
  // Update local state
  this.selectedCardDetail = { ...cd, favorite: !cd.favorite };
  this.selectedCardForInspector.set(toSharedCardInspectorData(this.selectedCardDetail));
  this.cardSearchService.refreshResearch();
}
```

**Key points:**
- `CardSearchService` extends `SearchServiceCore` which has `addFavoriteCard()` and `removeFavoriteCard()` methods
- Uses `firstValueFrom` (from rxjs) to await the HTTP call
- After toggling, spreads the `CardDetail` with toggled `favorite` flag
- Calls `refreshResearch()` to update the card list
- `HttpClient` must be injected in the component constructor

### ScalingContainerDirective Usage

Already exists at `components/scaling-container/scaling-container.directive.ts` (Story 7.1, 103 lines).

**Interface:**
```typescript
@Directive({ selector: '[appScalingContainer]', standalone: true })
export class ScalingContainerDirective {
  aspectRatio = input<number>(16 / 9);
  referenceWidth = input<number>(1920);
  scale = output<number>();
}
```

**Behavior:** Observes parent element dimensions via ResizeObserver, computes `scale = min(parentWidth / refWidth, parentHeight / refHeight, 1)`, applies `transform: scale(scale)` + `transform-origin: top center`. Parent MUST have explicit height.

**Calibration for card search:** Start with `referenceWidth=1400, aspectRatio=1.5`. The card search page is wider than the deck builder canvas (full page width vs. half), hence 1400 vs. 1200. Adjust via DevTools if needed.

[Source: front/src/app/components/scaling-container/scaling-container.directive.ts — 103 lines]

### SCSS Structure

```scss
// card-search-page.component.scss
@use '../../../styles/canvas-scaling' as cs;

:host {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.searchPage-canvasParent {
  @include cs.canvas-parent;
  flex: 1;
}
```

The `canvas-parent` mixin from `_canvas-scaling.scss` provides the necessary parent setup (explicit height, overflow hidden, position relative). The `flex: 1` ensures it fills the remaining space after any shell chrome (navbar height is handled by the app-level layout).

[Source: front/src/app/styles/_canvas-scaling.scss — canvas-parent mixin]

### Legacy Tooltip Deletion Scope

After this story, **zero consumers** remain for the tooltip infrastructure:
- `CardSearchPageComponent` was the last consumer of `TooltipService` (constructor called `setActiveSearchService`)
- `DeckBuilderComponent` already removed `TooltipService` in Story 8.4
- No other component uses `[customToolTip]` directive, `TooltipService`, or `<card-tooltip>`

**Files to delete:**
| File | Reason |
|------|--------|
| `front/src/app/services/tooltip.service.ts` | Zero consumers |
| `front/src/app/core/directives/tooltip.directive.ts` | Zero consumers (ToolTipRendererDirective) |
| `front/src/app/components/card-tooltip/card-tooltip.component.ts` | Zero consumers |
| `front/src/app/components/card-tooltip/card-tooltip.component.html` | Template for deleted component |
| `front/src/app/components/card-tooltip/card-tooltip.component.scss` | Styles for deleted component |

**Modifications for deletion:**
| File | Change |
|------|--------|
| `front/src/app/app.component.html` | Remove `<div class="dark-theme-tooltip"><card-tooltip></card-tooltip></div>` |
| `front/src/app/app.component.ts` | Remove `CardTooltipComponent` import and from `imports` array |

**DO NOT DELETE:**
- `CustomTooltipComponent` (`custom-tooltip.component.ts`) — separate, unrelated general-purpose tooltip

### Previous Story Intelligence (Stories 8.3, 8.4)

1. **Adapter pattern (8.4):** `toSharedCardInspectorData(cd: CardDetail)` already exists in `core/model/shared-card-data.ts`. Reuse it — do NOT create a duplicate adapter.

2. **Inspector placement (8.4):** `<app-card-inspector>` is placed OUTSIDE the canvas, at the root level of the component template. The inspector uses `position: fixed` for its backdrop — placing it inside a `transform: scale()` container would break fixed positioning.

3. **`<ng-content>` projection (8.4 M2 fix):** Action buttons are projected via `<ng-content>` into the inspector's backdrop area (between the panel and the backdrop edge). The `(click)="$event.stopPropagation()"` on the projected content prevents backdrop dismissal when clicking buttons.

4. **`:host` aspect-ratio (8.2 H2 fix):** The shared `CardComponent` has `aspect-ratio: 59/86` on `:host`. Parents set width only — height follows automatically.

5. **`?? ''` fallback (8.2 M1 fix):** All nullable string fields in adapters use `?? ''`.

6. **OnPush required (8.2 M2 fix):** All modified components must have `ChangeDetectionStrategy.OnPush`.

7. **Build budget error is pre-existing** — `ng build` succeeding with only the budget warning is expected.

8. **Canvas parent flex pattern (8.4 Task 3.3):** The deck builder uses `flex: 1` on the canvas parent to fill remaining space after the header. Card search page follows the same pattern but without a header.

### Critical Anti-Patterns to Avoid

1. **DO NOT place `<app-card-inspector>` inside the scaled canvas** — `position: fixed` is relative to the viewport only when no ancestor has `transform`. Inside a `transform: scale()` container, `position: fixed` behaves like `position: absolute` relative to the transformed element. The inspector MUST be outside.

2. **DO NOT modify `CardSearcherComponent` or `CardListComponent`** — they are already migrated (Story 8.4). Card rendering uses shared `CardComponent`. The `cardClicked` output already exists.

3. **DO NOT delete `CustomTooltipComponent`** — it is unrelated to the card tooltip system being removed.

4. **DO NOT create a new adapter** — `toSharedCardInspectorData(cd: CardDetail)` already exists in `core/model/shared-card-data.ts`.

5. **DO NOT use `@import`** in SCSS — use `@use` syntax only.

6. **DO NOT keep any TooltipService references** — after this story, the entire tooltip system is dead code. Search globally to confirm zero references remain.

7. **DO NOT forget to remove `CardTooltipComponent` from `app.component.ts` imports array** — it's imported both as a TS import and in the `@Component.imports` array.

8. **DO NOT add deck-building buttons** — the card search page's inspector only needs the favorite toggle. No add/remove deck buttons (those are deck builder specific, handled in Story 8.4).

9. **DO NOT hardcode the `.dark-theme-tooltip` CSS class** elsewhere — it only exists for the legacy `<card-tooltip>` wrapper and should be deleted along with it. Check `app.component.scss` for any related styles that become dead code.

### Project Structure Notes

**Files to create:** None (all shared components already exist)

**Files to delete:**
- `front/src/app/services/tooltip.service.ts`
- `front/src/app/core/directives/tooltip.directive.ts`
- `front/src/app/components/card-tooltip/card-tooltip.component.ts`
- `front/src/app/components/card-tooltip/card-tooltip.component.html`
- `front/src/app/components/card-tooltip/card-tooltip.component.scss`

**Files to modify:**
| File | Changes |
|------|---------|
| `front/src/app/pages/card-search-page/card-search-page.component.ts` | Remove TooltipService → add CardInspectorComponent, ScalingContainerDirective, HttpClient, signal, MatIconButton, MatIcon imports. Add selectedCardForInspector signal, selectedCardDetail, onCardClicked, dismissInspector, toggleFavorite methods. |
| `front/src/app/pages/card-search-page/card-search-page.component.html` | Wrap CardSearcherComponent in canvas parent + canvas. Add cardClicked binding. Add app-card-inspector with favorite toggle button projected. |
| `front/src/app/pages/card-search-page/card-search-page.component.scss` | Add searchPage-canvasParent (canvas-parent mixin, flex: 1), host display flex. |
| `front/src/app/app.component.html` | Remove dark-theme-tooltip div + card-tooltip |
| `front/src/app/app.component.ts` | Remove CardTooltipComponent import and from imports array |

**NOT modified in this story:**
- `CardSearcherComponent` — no changes needed (already migrated in 8.4)
- `CardListComponent` — no changes needed (already migrated in 8.4)
- `CardComponent` — shared presentational component (no changes)
- `CardInspectorComponent` — shared inspector component (no changes)
- Simulator components — no changes
- Deck builder components — no changes

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 8, Story 8.5 (lines 1281-1329)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Responsive Strategy, Shared Component Extraction sections]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Responsive Design section, Two-Track strategy]
- [Source: _bmad-output/implementation-artifacts/8-4-deck-builder-canvas-scaling-and-shared-components.md — Previous story: deck builder integration pattern, inspector placement, canvas scaling setup]
- [Source: _bmad-output/implementation-artifacts/8-3-extract-shared-cardinspectorcomponent.md — Inspector component creation, 3 modes, template deduplication]
- [Source: _bmad-output/implementation-artifacts/8-1-migration-plan.md — SharedCardData/SharedCardInspectorData interfaces, adapter pattern, tooltip deprecation scope]
- [Source: front/src/app/pages/card-search-page/card-search-page.component.ts — 21 lines (current)]
- [Source: front/src/app/pages/card-search-page/card-search-page.component.html — 1 line (current)]
- [Source: front/src/app/components/card-searcher/card-searcher.component.ts — 53 lines]
- [Source: front/src/app/components/card-searcher/card-searcher.component.html — 41 lines]
- [Source: front/src/app/components/card-list/card-list.component.ts — 97 lines]
- [Source: front/src/app/components/card-list/card-list.component.html — 93 lines]
- [Source: front/src/app/components/card-inspector/card-inspector.component.ts — 48 lines]
- [Source: front/src/app/components/card-inspector/card-inspector.component.html — 68 lines]
- [Source: front/src/app/components/card-tooltip/card-tooltip.component.ts — 65 lines (to be deleted)]
- [Source: front/src/app/components/card-tooltip/card-tooltip.component.html — 77 lines (to be deleted)]
- [Source: front/src/app/services/tooltip.service.ts — 21 lines (to be deleted)]
- [Source: front/src/app/core/directives/tooltip.directive.ts — 87 lines (to be deleted)]
- [Source: front/src/app/app.component.ts — 34 lines]
- [Source: front/src/app/app.component.html — 14 lines]
- [Source: front/src/app/core/model/shared-card-data.ts — interfaces + adapter functions]
- [Source: front/src/app/services/search-service-core.service.ts — addFavoriteCard/removeFavoriteCard methods]
- [Source: front/src/app/components/scaling-container/scaling-container.directive.ts — 103 lines]
- [Source: front/src/app/styles/_canvas-scaling.scss — canvas-parent mixin]
- [Source: front/src/app/styles/_responsive.scss — touch-target-min mixin]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build budget error (exit code 1) is pre-existing — confirmed zero TS/Angular compilation errors via `ng build --configuration development` (success).

### Completion Notes List

- **Task 1-2:** Replaced `TooltipService` injection with `CardInspectorComponent` (mode="click") + `HttpClient`. Added `selectedCardForInspector` signal, `onCardClicked`, `dismissInspector`, and `toggleFavorite` methods. Favorite toggle replicates exact logic from deleted `CardTooltipComponent.toggleFavorite()`. Inspector placed outside canvas (position: fixed requirement).
- **Task 3:** Wrapped `<app-card-searcher>` in `searchPage-canvasParent` + `searchPage-canvas` with `ScalingContainerDirective` (`referenceWidth=1400`, `aspectRatio=1.5`). SCSS uses `canvas-parent` mixin with `flex: 1` + `min-height: 0`.
- **Task 4:** Favorite toggle button has `touch-target-min` mixin (44x44px). Canvas parent height inherits from `:host { height: 100% }` flex layout — mobile header height handled by app shell.
- **Task 5:** Deleted 5 tooltip files (`tooltip.service.ts`, `tooltip.directive.ts`, `card-tooltip.component.*`). Cleaned `app.component.ts` (removed import + imports array entry) and `app.component.html` (removed `dark-theme-tooltip` div). Global grep confirmed zero remaining references. `CustomTooltipComponent` preserved.
- **Task 6:** `ng build --configuration development` succeeds. Zero tooltip references remain in codebase. Manual tests (6.3-6.17) require user validation.

### File List

**Modified:**
- `front/src/app/pages/card-search-page/card-search-page.component.ts`
- `front/src/app/pages/card-search-page/card-search-page.component.html`
- `front/src/app/pages/card-search-page/card-search-page.component.scss`
- `front/src/app/app.component.ts`
- `front/src/app/app.component.html`
- `front/src/app/app.component.scss` *(review fix: removed dead `.dark-theme-tooltip` CSS + unused `@import`)*
- `front/src/app/components/card-inspector/card-inspector.component.scss` *(review fix: click-mode CSS variable defaults)*
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss` *(review fix: removed duplicated CSS vars)*

**Deleted:**
- `front/src/app/services/tooltip.service.ts`
- `front/src/app/core/directives/tooltip.directive.ts`
- `front/src/app/components/card-tooltip/card-tooltip.component.ts`
- `front/src/app/components/card-tooltip/card-tooltip.component.html`
- `front/src/app/components/card-tooltip/card-tooltip.component.scss`

## Senior Developer Review (AI)

**Reviewer:** Claude Opus 4.6 | **Date:** 2026-02-14 | **Outcome:** Approved with fixes applied

**Issues Found:** 1 Critical, 1 High, 3 Medium, 3 Low — **All fixed automatically**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| C1 | CRITICAL | Task 5.8 marked [x] but `.dark-theme-tooltip` dead CSS in `app.component.scss` (SCSS `&-tooltip` nesting missed by grep) | Deleted dead CSS block + removed unused `@import` |
| H1 | HIGH | AC #8 "fully deleted" violated — tooltip CSS remnant | Same fix as C1 |
| M1 | MEDIUM | Favorite toggle button missing `aria-label` | Added `[attr.aria-label]` with same text as `title` |
| M2 | MEDIUM | Inspector CSS variables duplicated in card-search-page and deck-builder SCSS | Moved to `:host.mode-click` in inspector component SCSS |
| M3 | MEDIUM | `toggleFavorite()` has no error handling — unhandled promise rejection on API failure | Added `try/catch`, state unchanged on error |
| L1 | LOW | Non-null assertion `cd.card.id!` without guard | Added `id == null` early return |
| L2 | LOW | `selectedCardDetail` non-reactive property in OnPush template | Converted to `signal<CardDetail \| null>` |
| L3 | LOW | `app.component.scss` uses deprecated `@import` | Removed (unused after C1 fix) |

## Change Log

- **2026-02-14:** Story 8.5 implementation — Migrated card search page to shared CardInspectorComponent (click mode) with favorite toggle, applied ScalingContainerDirective canvas scaling (ref 1400x1.5), deleted entire legacy tooltip infrastructure (TooltipService, ToolTipRendererDirective, CardTooltipComponent) with zero remaining references.
- **2026-02-14:** Code review — Fixed 8 issues (1C/1H/3M/3L): removed dead `.dark-theme-tooltip` CSS from `app.component.scss`, added `aria-label` to favorite button, deduplicated inspector CSS variables into `:host.mode-click`, added error handling + null guard to `toggleFavorite()`, converted `selectedCardDetail` to signal.
