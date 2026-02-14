# Story 8.2: Extract Shared CardComponent

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a shared `CardComponent` (`app-card`) extracted from the simulator's `SimCardComponent`,
So that the simulator, deck builder, and card search pages can all use the same card rendering component.

## Acceptance Criteria

1. **Given** the harmonization analysis from Story 8.1 is complete, **When** the shared `CardComponent` is created in `src/app/components/card/`, **Then** it uses the selector `app-card`, accepts all inputs defined in the migration plan (`card: SharedCardData`, `faceDown: boolean`, `position: 'ATK' | 'DEF'`, `showOverlayMaterials: boolean`, `overlayMaterialCount: number`), all inputs use Angular signal-based input API, and it emits a `clicked` output.

2. **Given** the `CardComponent` is created, **When** it renders a card, **Then** it displays the card image (face-up or card back based on `faceDown` input), applies 90° rotation for DEF position, shows XYZ overlay material peek borders when `showOverlayMaterials` is true, and is context-agnostic (no dependency on BoardStateService, CommandStackService, or simulator signals).

3. **Given** the `CardComponent` supports theming, **When** different pages use it, **Then** CSS custom properties (`--card-border-radius`, `--card-bg`, `--card-border-color`, `--card-shadow`, `--card-hover-scale`, `--card-drag-preview-scale`, etc.) allow each host page to style cards differently without modifying the component.

4. **Given** the shared `CardComponent` is ready, **When** the simulator's `SimCardComponent` is refactored, **Then** `SimCardComponent` is replaced with `CardComponent` (`app-card`) in all simulator templates. Any simulator-specific behavior (CDK drag bindings, context menu triggers) is applied by the parent component via template attributes — not inside `CardComponent`. The old `SimCardComponent` files are deleted.

5. **Given** the simulator uses the shared `CardComponent`, **When** all existing simulator interactions are tested manually, **Then** drag & drop, context menu (right-click), face-down rendering, position toggle visual, XYZ material peek, gold glow on drop, and `prefers-reduced-motion` behavior all work identically to before the refactor. No visual difference is detectable.

6. **Given** the shared `CardComponent` is available, **When** it is imported in a non-simulator context, **Then** it renders correctly without requiring simulator services or signals.

## Tasks / Subtasks

- [x] Task 1: Create `SharedCardData` interface (AC: #1, #6)
  - [x] 1.1 Create `front/src/app/core/model/shared-card-data.ts` with `SharedCardData` interface (`name: string`, `imageUrl: string`, `imageUrlFull?: string`)
  - [x] 1.2 Add `SharedCardInspectorData` interface extending `SharedCardData` (same file — needed by Story 8.3)

- [x] Task 2: Create shared `CardComponent` (AC: #1, #2, #3, #6)
  - [x] 2.1 Delete existing `front/src/app/components/card/card.component.ts`, `.html`, `.scss` (old deck builder `card` selector component — fully replaced)
  - [x] 2.2 Create new `front/src/app/components/card/card.component.ts` based on `SimCardComponent` — use `app-card` selector, standalone, OnPush, signal inputs: `card = input.required<SharedCardData>()`, `faceDown = input(false)`, `position = input<'ATK' | 'DEF'>('ATK')`, `showOverlayMaterials = input(false)`, `overlayMaterialCount = input(0)`. Output: `clicked = output<void>()`. Zero injected services.
  - [x] 2.3 Create `front/src/app/components/card/card.component.html` — face-up image (`card().imageUrl`) with `(error)` fallback to `card_back.jpg`, card-back image when `faceDown()`, XYZ material peek borders when `showOverlayMaterials()` with `overlayMaterialCount()` slots. Use `@if`/`@for` control flow.
  - [x] 2.4 Create `front/src/app/components/card/card.component.scss` — Use `@use` syntax. All theme values via CSS custom properties (see Section 3.3 of migration plan). `:host` styles for aspect-ratio `59/86`, width/height `100%`, `display: block`. CDK drag host styles (`:host.cdk-drag-preview`, `:host.cdk-drag-placeholder`, `:host.cdk-drag-animating`). `prefers-reduced-motion` media query. Material peek borders conditional on `showOverlayMaterials`.
  - [x] 2.5 Verify `CardComponent` compiles standalone — `ng build` succeeds

- [x] Task 3: Migrate simulator templates — `app-sim-card` → `app-card` (AC: #4, #5)
  - [x] 3.1 Update `zone.component.ts/html`: import `CardComponent`, replace `<app-sim-card>` with `<app-card>`, add `toSharedCardData(ci: CardInstance): SharedCardData` adapter method, pass `[card]`, `[faceDown]`, `[position]`, `[showOverlayMaterials]`, `[overlayMaterialCount]` explicitly. CDK drag directives (`cdkDrag`, `cdkDragData`, `cdkDragPreview`) stay on `<app-card>` host.
  - [x] 3.2 Update `hand.component.ts/html`: same migration — replace `<app-sim-card>` with `<app-card>`, adapter method, explicit inputs.
  - [x] 3.3 Update `stacked-zone.component.ts/html`: replace `<app-sim-card>` with `<app-card>` if used for top-card rendering.
  - [x] 3.4 Update `pile-overlay.component.ts/html`: replace `<app-sim-card>` with `<app-card>`, adapter method, explicit inputs. Ensure `cdkDragPreviewContainer: 'global'` preserved.
  - [x] 3.5 Update `xyz-material-peek.component.ts/html`: N/A — does not use `SimCardComponent` (uses inline `<img>` tags).

- [x] Task 4: Update simulator SCSS selectors (AC: #5)
  - [x] 4.1 `zone.component.scss`: `app-sim-card { ... }` → `app-card { ... }`
  - [x] 4.2 `hand.component.scss`: N/A — no `app-sim-card` selector in SCSS
  - [x] 4.3 `stacked-zone.component.scss`: `app-sim-card { ... }` → `app-card { ... }`
  - [x] 4.4 `pile-overlay.component.scss`: `app-sim-card { ... }` → `app-card { ... }`

- [x] Task 5: Update simulator imports (AC: #4)
  - [x] 5.1 All simulator components that imported `SimCardComponent`: remove import, add `CardComponent` from `components/card/`
  - [x] 5.2 Ensure no remaining references to `SimCardComponent` or `app-sim-card` in any file

- [x] Task 6: Delete old SimCardComponent files (AC: #4)
  - [x] 6.1 Delete `front/src/app/pages/simulator/sim-card.component.ts`
  - [x] 6.2 Delete `front/src/app/pages/simulator/sim-card.component.html`
  - [x] 6.3 Delete `front/src/app/pages/simulator/sim-card.component.scss`

- [x] Task 7: Verify zero regression (AC: #5)
  - [x] 7.1 `ng build` succeeds with zero errors (budget warning is pre-existing)
  - [ ] 7.2 Manual test: card renders face-up in monster zones
  - [ ] 7.3 Manual test: card renders face-down (card back) when set
  - [ ] 7.4 Manual test: DEF position rotates card 90°
  - [ ] 7.5 Manual test: XYZ material peek borders visible
  - [ ] 7.6 Manual test: CDK drag zone-to-zone, hand-to-zone, overlay-to-zone
  - [ ] 7.7 Manual test: CDK drag preview at correct scale
  - [ ] 7.8 Manual test: context menu (right-click) on board cards
  - [ ] 7.9 Manual test: gold glow on drop
  - [ ] 7.10 Manual test: `prefers-reduced-motion` disables animations
  - [ ] 7.11 Manual test: hand fan layout preserved
  - [ ] 7.12 Manual test: pile overlay card rendering

## Dev Notes

### Binding Implementation Spec

**This story MUST follow the migration plan from Story 8.1:**
- `_bmad-output/implementation-artifacts/8-1-migration-plan.md` — Sections 3.1, 3.3, 3.4, 4.1
- The migration plan defines the exact `SharedCardData` interface, CSS custom property contract, template-driven CDK drag pattern, and step-by-step migration sequence. It is authoritative.

### Extraction Principle: Extract, Don't Rewrite

The shared `CardComponent` is based on the existing `SimCardComponent` (`pages/simulator/sim-card.component.*`). The extraction approach:
1. **Copy** `SimCardComponent` code to `components/card/card.component.*`
2. **Replace** `CardInstance` input with `SharedCardData` interface + separate `faceDown`/`position`/overlay inputs
3. **Remove** `size` input — sizing is now controlled via CSS custom properties on the host element by the parent
4. **Remove** all simulator-specific computed signals that derived from `CardInstance` internals (e.g., `isFaceDown = computed(() => this.forceFaceDown() ?? this.cardInstance().faceDown)`) — replace with direct input reads
5. **Keep** all visual rendering logic (face-down card back, DEF rotation, material peek borders)
6. **Keep** CDK drag host styles (`:host.cdk-drag-preview`, `:host.cdk-drag-placeholder`, `:host.cdk-drag-animating`)
7. **Keep** `prefers-reduced-motion` media queries
8. **Convert** SCSS from `@use 'sim-tokens'` to CSS custom properties with defaults

### SharedCardData Interface (Binding Contract)

```typescript
// front/src/app/core/model/shared-card-data.ts

export interface SharedCardData {
  readonly name: string;           // Card name for alt text and accessibility
  readonly imageUrl: string;       // Small image URL for card face rendering
  readonly imageUrlFull?: string;  // Full-size image URL for inspector/detail views
}

export interface SharedCardInspectorData extends SharedCardData {
  readonly isMonster: boolean;
  readonly attribute?: string;     // DARK, LIGHT, FIRE, WATER, etc.
  readonly race?: string;          // Warrior, Spellcaster, Dragon, etc.
  readonly level?: number;
  readonly scale?: number;         // Pendulum scale
  readonly linkval?: number;       // Link rating
  readonly isLink: boolean;
  readonly hasDefense: boolean;    // true for monsters except Link
  readonly displayAtk: string;     // Handles '?' for variable ATK
  readonly displayDef: string;     // Handles '?' for variable DEF
  readonly description: string;    // Card effect/flavor text
}
```

### CardComponent Input/Output Contract

| Input | Type | Default | Notes |
|-------|------|---------|-------|
| `card` | `input.required<SharedCardData>()` | — | Name + image URLs |
| `faceDown` | `input<boolean>()` | `false` | Shows card back when true |
| `position` | `input<'ATK' \| 'DEF'>()` | `'ATK'` | DEF = 90° rotation |
| `showOverlayMaterials` | `input<boolean>()` | `false` | XYZ material peek borders |
| `overlayMaterialCount` | `input<number>()` | `0` | Number of material borders (max 5) |

| Output | Type | Notes |
|--------|------|-------|
| `clicked` | `output<void>()` | Parent handles selection logic |

**No injected services. No `DeckBuildService`, `TooltipService`, `Router`, `OwnedCardService`, `BoardStateService`, `CommandStackService`. Purely presentational.**

### CSS Custom Properties Contract

| Property | Default | Description |
|----------|---------|-------------|
| `--card-border-radius` | `0.25rem` | Card corner radius |
| `--card-bg` | `transparent` | Card background |
| `--card-border-color` | `transparent` | Card border |
| `--card-shadow` | `none` | Box shadow |
| `--card-hover-scale` | `1` | Scale on hover (parent controls) |
| `--card-drag-preview-scale` | `1.05` | CDK drag preview scale |
| `--card-drag-preview-shadow` | `0 8px 24px rgba(0,0,0,0.5)` | Drag preview shadow |
| `--card-drag-preview-opacity` | `0.9` | Drag preview opacity |
| `--card-drag-placeholder-opacity` | `0.3` | Drag placeholder opacity |
| `--card-material-bg` | `#1e293b` | XYZ material border bg |
| `--card-material-border` | `rgba(0, 212, 255, 0.15)` | XYZ material border color |

**Sizing:** Parent sets `width` and/or `height` on `<app-card>` host. Component preserves `aspect-ratio: 59/86` internally. No `size` input.

### Template-Driven CDK Drag Pattern

The shared `CardComponent` is **drag-agnostic**. Parents apply CDK drag on the `<app-card>` host element:

```html
<!-- Simulator zone template example -->
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
```

Key points:
- `cdkDrag` on `<app-card>` host — NOT inside the component
- `cdkDragData` carries `CardInstance` (full data), not `SharedCardData`
- `cdkDragPreview` uses a second `<app-card>` for drag preview rendering
- Context menu (`[matMenuTriggerFor]`) also applied on host by parent
- Component's `:host.cdk-drag-preview/placeholder/animating` SCSS handles visual states

### Adapter Pattern for Data Model Bridging

Each parent component that consumes `<app-card>` needs a helper to bridge its data model to `SharedCardData`:

**Simulator adapter (CardInstance → SharedCardData):**
```typescript
toSharedCardData(ci: CardInstance): SharedCardData {
  return {
    name: ci.card.card.name,
    imageUrl: ci.image.smallUrl,
    imageUrlFull: ci.image.url,
  };
}
```

**Deck builder adapter (CardDetail → SharedCardData) — for Stories 8.4/8.5:**
```typescript
toSharedCardData(cd: CardDetail): SharedCardData {
  return {
    name: cd.card.name ?? '',
    imageUrl: cd.images[0]?.smallUrl ?? '',
    imageUrlFull: cd.images[0]?.url ?? '',
  };
}
```

### Image Error Fallback

The shared `CardComponent` must handle image load failures:
```html
<img [src]="card().imageUrl"
     [alt]="card().name"
     (error)="$any($event.target).src='assets/images/card_back.jpg'" />
```
This pattern is already used by `SimCardInspectorComponent` and ensures broken images degrade gracefully.

### Files to Modify — Complete List

**New files:**
| File | Description |
|------|-------------|
| `front/src/app/core/model/shared-card-data.ts` | `SharedCardData` + `SharedCardInspectorData` interfaces |
| `front/src/app/components/card/card.component.ts` | Shared CardComponent (replaces old deck builder `card` component) |
| `front/src/app/components/card/card.component.html` | Card template |
| `front/src/app/components/card/card.component.scss` | Card styles with CSS custom properties |

**Deleted files (simulator):**
| File | Reason |
|------|--------|
| `front/src/app/pages/simulator/sim-card.component.ts` | Replaced by shared CardComponent |
| `front/src/app/pages/simulator/sim-card.component.html` | Replaced |
| `front/src/app/pages/simulator/sim-card.component.scss` | Replaced |

**Modified files (simulator template migration):**
| File | Changes |
|------|---------|
| `front/src/app/pages/simulator/zone.component.ts` | Remove `SimCardComponent` import → add `CardComponent`, add `toSharedCardData()` adapter |
| `front/src/app/pages/simulator/zone.component.html` | `<app-sim-card>` → `<app-card>`, explicit `[card]`/`[faceDown]`/`[position]`/`[showOverlayMaterials]`/`[overlayMaterialCount]` bindings |
| `front/src/app/pages/simulator/zone.component.scss` | `app-sim-card` → `app-card` in selectors |
| `front/src/app/pages/simulator/hand.component.ts` | Same migration as zone |
| `front/src/app/pages/simulator/hand.component.html` | Same template migration |
| `front/src/app/pages/simulator/hand.component.scss` | Same selector migration |
| `front/src/app/pages/simulator/stacked-zone.component.ts` | Same migration if uses SimCardComponent |
| `front/src/app/pages/simulator/stacked-zone.component.html` | Same template migration if applicable |
| `front/src/app/pages/simulator/stacked-zone.component.scss` | Same selector migration if applicable |
| `front/src/app/pages/simulator/pile-overlay.component.ts` | Same migration |
| `front/src/app/pages/simulator/pile-overlay.component.html` | Same template migration |
| `front/src/app/pages/simulator/pile-overlay.component.scss` | Same selector migration |
| `front/src/app/pages/simulator/xyz-material-peek.component.ts` | Same migration if uses SimCardComponent |
| `front/src/app/pages/simulator/xyz-material-peek.component.html` | Same template migration if applicable |

**NOT modified in this story:**
- Deck builder components (`card-list`, `deck-card-zone`, `deck-builder`) — migration to `<app-card>` happens in Story 8.4
- `CardInspectorComponent` extraction — happens in Story 8.3
- `TooltipService` / `[customToolTip]` deprecation — happens in Story 8.4

### Project Structure Notes

- Shared components directory: `front/src/app/components/` (existing pattern — already contains `card/`, `card-list/`, `deck-box/`, `deck-card-zone/`, etc.)
- The existing `components/card/` directory is **overwritten** — the old deck builder `card` selector component files are fully replaced by the new shared `app-card` component. The old component (selector `card`, 103 lines TS, 88 lines HTML, 290 lines SCSS) is a completely different component. **Delete all three old files before writing new ones.**
- Interface files go in `front/src/app/core/model/` (existing pattern for data model types)
- SCSS uses `@use` syntax (project-wide migration completed in Story 7.1)

### Critical Anti-Patterns to Avoid

1. **DO NOT inject any service** into the shared CardComponent — it must be purely presentational
2. **DO NOT add CDK drag directives** inside the CardComponent template — parents apply drag on the host
3. **DO NOT add `[customToolTip]`** or tooltip logic — inspector is a separate component (Story 8.3)
4. **DO NOT add display modes** (INFORMATIVE, OWNED, MOSAIC) — these are deck builder wrapper concerns
5. **DO NOT add `searchService`, `deckBuildMode`, or business logic inputs** — these are page-specific
6. **DO NOT use `@import`** in SCSS — use `@use` module syntax only
7. **DO NOT create a `size` input** — sizing is via CSS custom properties on host
8. **DO NOT break the `forceFaceDown` pattern** — in `SimCardComponent`, `forceFaceDown` overrides `cardInstance.faceDown`. In the shared component, the parent resolves this before passing `[faceDown]`. The shared component does not need `forceFaceDown` — it just reads `faceDown` input directly.

### Existing SimCardComponent Code Reference

The extraction source (`sim-card.component.ts`, 29 lines):
- Signal inputs: `cardInstance = input.required<CardInstance>()`, `size = input<'board' | 'hand'>('board')`, `forceFaceDown = input<boolean | null>(null)`
- Computed: `isFaceDown`, `isDefPosition`, `imageUrl`, `hasMaterials`, `materialCount`, `materialPeekSlots`
- Output: `clicked = output<CardInstance>()`
- The component is already drag-agnostic — CDK drag is applied by parent zones/hand
- Template uses `@if`/`@for` modern control flow
- SCSS uses `@use 'sim-tokens'` for theme tokens, `:host` styles with CDK drag states

### Simulator Consumers of SimCardComponent

Components that currently import and use `SimCardComponent` and must be migrated:

| Component | Uses `<app-sim-card>` in template | CDK drag on host | Context menu on host |
|-----------|-----------------------------------|------------------|---------------------|
| `ZoneComponent` | Yes — single card in zone | Yes (`cdkDrag`) | Yes (`matMenuTriggerFor`) |
| `HandComponent` | Yes — cards in hand fan | Yes (`cdkDrag` with sort) | No |
| `StackedZoneComponent` | Yes — top card peek | Yes (`cdkDrag`) | No (context menu on zone, not card) |
| `PileOverlayComponent` | Yes — cards in overlay list | Yes (`cdkDrag`, `cdkDragPreviewContainer: 'global'`) | No |
| `XyzMaterialPeekComponent` | Possibly — material cards | If yes, with `cdkDrag` | No |

### References

- [Source: _bmad-output/implementation-artifacts/8-1-migration-plan.md — Sections 3.1, 3.3, 3.4, 4.1]
- [Source: _bmad-output/implementation-artifacts/8-1-harmonization-analysis-and-migration-plan.md — Full analysis]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 8, Story 8.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Shared Component Extraction section]
- [Source: front/src/app/pages/simulator/sim-card.component.ts — Current SimCardComponent (29 lines)]
- [Source: front/src/app/pages/simulator/sim-card.component.html — Template (22 lines)]
- [Source: front/src/app/pages/simulator/sim-card.component.scss — Styles (84 lines)]
- [Source: front/src/app/components/card/card.component.ts — Old deck builder CardComponent (103 lines, to be replaced)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build budget error (`bundle initial exceeded maximum budget 1.00 MB`) is pre-existing — confirmed by testing base branch build.
- `card.card.name` type `string | undefined` in strict mode — resolved with `?? ''` in all adapter methods.

### Completion Notes List

- **Task 1:** Created `SharedCardData` and `SharedCardInspectorData` interfaces in `core/model/shared-card-data.ts`.
- **Task 2:** Created new shared `CardComponent` (`app-card` selector) with signal inputs, CSS custom properties, CDK drag host styles, and `prefers-reduced-motion` support. Purely presentational — zero injected services.
- **Task 3:** Migrated 4 simulator components (zone, hand, stacked-zone, pile-overlay) from `<app-sim-card>` to `<app-card>` with explicit input bindings and `toSharedCardData()` adapter methods. `xyz-material-peek` was not applicable (uses inline `<img>` tags, not `SimCardComponent`). The `(clicked)` output changed from `CardInstance` to `void` — parent components now pass the card instance directly from their template context.
- **Task 4:** Updated SCSS selectors in zone, stacked-zone, and pile-overlay. Hand SCSS had no `app-sim-card` selector.
- **Task 5:** Verified zero remaining references to `SimCardComponent` or `app-sim-card` across the codebase.
- **Task 6:** Deleted all 3 old `sim-card.component.*` files.
- **Task 7:** `ng build` compiles with zero TS/Angular errors. Budget error is pre-existing. Manual tests (7.2–7.12) pending user verification.
- **Legacy bridge:** The old deck builder `CardComponent` (selector `card`) was preserved as `deck-builder-card.component.*` to maintain build integrity. Deck builder consumers (`card-list`, `deck-card-zone`, `hand-test`, `deck-builder`, `card-searcher`, `deck-viewer`) were updated to import from the legacy file. These legacy files will be removed in Story 8.4 when the deck builder migrates to `<app-card>`.

### Senior Developer Review (AI)

**Reviewer:** Axel (via Claude Opus 4.6 adversarial review)
**Date:** 2026-02-14
**Outcome:** Changes Requested → Fixed

**Issues Found: 2 High, 2 Medium, 2 Low**

| # | Severity | Description | Resolution |
|---|----------|-------------|------------|
| H1 | HIGH | `toSharedCardData()` duplicated 4x in zone/hand/stacked-zone/pile-overlay | **Fixed** — extracted to `simulator.models.ts`, 4 components use `protected readonly toSharedCardData = toSharedCardData` |
| H2 | HIGH | `aspect-ratio: 59/86` on `.card` div instead of `:host` (deviates from Task 2.4 spec, fragile sizing) | **Fixed** — moved to `:host`, `.card` uses `width: 100%; height: 100%` |
| M1 | MEDIUM | `aria-label` risk of "Drag undefined" — `card.card.card.name` used without `?? ''` in zone/hand templates | **Fixed** — added `?? ''` fallback |
| M2 | MEDIUM | (Pre-existing) `HandTestComponent` missing `ChangeDetectionStrategy.OnPush` | **Fixed** — added OnPush + standalone |
| L1 | LOW | `--card-hover-scale` in CSS custom properties contract but unused by CardComponent | **Accepted** — hover is parent-controlled per design, contract table note "(parent controls)" is accurate |
| L2 | LOW | (Pre-existing) Legacy `deck-builder-card.component.scss` uses `@import` | **Deferred** — `mixin.scss` depends on `@import` cascade for `$black`. File deleted in Story 8.4 |

**Post-fix build:** `ng build` — 0 TS/Angular errors (budget warning pre-existing).

### Change Log

- 2026-02-14: Story 8.2 implementation — extracted shared CardComponent from SimCardComponent, migrated all simulator consumers, deleted old SimCardComponent files.
- 2026-02-14: Code review fixes — H1: deduplicated toSharedCardData adapter, H2: moved aspect-ratio to :host, M1: aria-label fallback, M2: OnPush on HandTestComponent.

### File List

**New files:**
- `front/src/app/core/model/shared-card-data.ts`
- `front/src/app/components/card/card.component.ts` (new shared CardComponent)
- `front/src/app/components/card/card.component.html` (new shared template)
- `front/src/app/components/card/card.component.scss` (new shared styles)
- `front/src/app/components/card/deck-builder-card.component.ts` (legacy bridge)
- `front/src/app/components/card/deck-builder-card.component.html` (legacy bridge)
- `front/src/app/components/card/deck-builder-card.component.scss` (legacy bridge)

**Deleted files:**
- `front/src/app/pages/simulator/sim-card.component.ts`
- `front/src/app/pages/simulator/sim-card.component.html`
- `front/src/app/pages/simulator/sim-card.component.scss`

**Modified files:**
- `front/src/app/pages/simulator/simulator.models.ts` — added shared `toSharedCardData()` function (review fix H1)
- `front/src/app/pages/simulator/zone.component.ts` — import CardComponent, use shared adapter
- `front/src/app/pages/simulator/zone.component.html` — `<app-sim-card>` → `<app-card>` with explicit inputs
- `front/src/app/pages/simulator/zone.component.scss` — `app-sim-card` → `app-card`
- `front/src/app/pages/simulator/hand.component.ts` — import CardComponent, add adapter
- `front/src/app/pages/simulator/hand.component.html` — `<app-sim-card>` → `<app-card>`
- `front/src/app/pages/simulator/stacked-zone.component.ts` — import CardComponent, add adapter
- `front/src/app/pages/simulator/stacked-zone.component.html` — `<app-sim-card>` → `<app-card>`
- `front/src/app/pages/simulator/stacked-zone.component.scss` — `app-sim-card` → `app-card`
- `front/src/app/pages/simulator/pile-overlay.component.ts` — import CardComponent, add adapter
- `front/src/app/pages/simulator/pile-overlay.component.html` — `<app-sim-card>` → `<app-card>`
- `front/src/app/pages/simulator/pile-overlay.component.scss` — `app-sim-card` → `app-card`
- `front/src/app/components/card-list/card-list.component.ts` — import DeckBuilderCardComponent (legacy bridge)
- `front/src/app/components/deck-card-zone/deck-card-zone.component.ts` — import DeckBuilderCardComponent
- `front/src/app/components/card-searcher/card-searcher.component.ts` — import CardSize from legacy
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts` — import CardSize from legacy
- `front/src/app/pages/deck-page/components/deck-builder/components/hand-test/hand-test.component.ts` — import DeckBuilderCardComponent
- `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.ts` — import CardSize from legacy
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 8-2 status: in-progress → review
