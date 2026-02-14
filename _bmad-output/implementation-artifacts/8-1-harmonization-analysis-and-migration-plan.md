# Story 8.1: Harmonization Analysis & Migration Plan

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a documented analysis comparing the existing deck builder card/inspector components with the simulator versions,
So that I can extract shared components with a clear understanding of interface differences, naming conflicts, and migration steps.

## Acceptance Criteria

1. **Given** the simulator has `SimCardComponent` (`app-sim-card`) and the deck builder has its own card rendering component(s), **When** the harmonization analysis is performed, **Then** a comparison document is produced listing for each component pair: input/output contracts (signal inputs, event emitters), CSS class names and custom properties used, template structure differences, and features present in one but not the other (e.g., drag handle, context menu trigger, face-down rendering).

2. **Given** the simulator uses selector `app-sim-card` and the shared component will use `app-card`, **When** selector collision risk is evaluated, **Then** the analysis confirms whether any existing component in the codebase already uses the `app-card` selector. If a collision exists, a renaming strategy is documented.

3. **Given** the simulator has `SimCardInspectorComponent` (`app-sim-card-inspector`) with click-triggered activation (currently using `selectedCard` signal), **When** the deck builder's card detail/preview component is compared, **Then** the analysis documents the activation mode differences and proposes a unified `mode` input contract for the shared `CardInspectorComponent` (`mode: 'hover' | 'click' | 'permanent'`). **Clarification:** the `hover` mode means "parent-driven card input with show/hide panel behavior" — the component itself does not attach DOM hover listeners. The simulator uses click-select (`BoardStateService.selectedCard`) to drive the `card` input; the mode name is kept for semantic clarity but activation is always parent-controlled.

4. **Given** the harmonization analysis is complete, **When** the migration plan is produced, **Then** it defines:
   - The unified input/output contract for `CardComponent` (all inputs, their types, defaults)
   - The unified input/output contract for `CardInspectorComponent` (including `mode: 'hover' | 'click' | 'permanent'`)
   - CSS custom properties for theming (allowing simulator dark theme and deck builder theme to coexist)
   - Migration steps for the simulator (replace imports, verify no regression)
   - Migration steps for the deck builder (replace existing card component with shared version)
   - A checklist of manual tests to validate zero regression

5. **Given** the migration plan covers inspector placement on non-simulator pages, **When** the `click` mode behavior is documented, **Then** it specifies a floating overlay pattern (semi-transparent backdrop over canvas, card image + name/stats/effect text, dismiss on outside tap/click) inspired by Master Duel's card detail overlay. This floating overlay applies uniformly on all viewports — no breakpoint-dependent placement switch. The `position` input (`left` | `right`) is documented as relevant only to `hover` mode (simulator side panel); `click` mode uses centered overlay positioning.

6. **Given** the migration plan covers CDK drag binding migration, **When** the document specifies how simulator-specific behaviors exit the extracted CardComponent, **Then** the template-driven pattern is documented: parent applies `cdkDrag`, `cdkDragPreview`, and context menu trigger directly on `<app-card>` in the template. At least one code example is provided for the simulator use case.

7. **Given** the migration plan defines CSS custom properties, **When** the theming contract is documented, **Then** it lists all CSS custom properties for `CardComponent` (e.g., `--card-border-color`, `--card-shadow`, `--card-hover-scale`, `--card-bg`) and `CardInspectorComponent` (e.g., `--inspector-bg`, `--inspector-text`, `--inspector-width`, `--inspector-backdrop`). Default values are specified for each property. Simulator and deck builder override values are documented side by side.

8. **Given** the migration plan is reviewed, **When** the team proceeds to Story 8.2, **Then** the plan serves as the implementation spec — no ambiguity remains about what to extract and how.

## Tasks / Subtasks

- [x] Task 1: Component Inventory & Comparison Analysis (AC: #1, #2)
  - [x] 1.1 Analyze SimCardComponent (`app-sim-card`): inputs, outputs, computed signals, template structure, SCSS tokens
  - [x] 1.2 Analyze CardComponent (deck builder, selector `card`): inputs, outputs, display modes, template structure, SCSS sizes
  - [x] 1.3 Produce side-by-side comparison table covering: data models, inputs/outputs, CDK drag integration, face-down/position logic, XYZ materials, tooltip/hover behavior, sizing system, SCSS variables
  - [x] 1.4 Verify selector collision risk: confirm no existing `app-card` selector in codebase (deck builder uses `card` — no prefix collision)
  - [x] 1.5 Document features unique to each component and features that must be unified

- [x] Task 2: Inspector Component Comparison (AC: #3, #5)
  - [x] 2.1 Analyze SimCardInspectorComponent (`app-sim-card-inspector`): activation via `selectedCard` signal, positioning (absolute top-left 260px), ARIA roles, dismissal (Escape/click-outside), responsive mobile variant
  - [x] 2.2 Analyze deck builder's card detail mechanism: `[customToolTip]` directive on card images, inline INFORMATIVE mode info panel
  - [x] 2.3 Document activation mode differences and propose unified `mode: 'hover' | 'click' | 'permanent'` contract
  - [x] 2.4 Design floating overlay pattern for `click` mode (Master Duel inspired): centered over canvas, semi-transparent backdrop, dismiss on outside tap/click, no position input dependency

- [x] Task 3: Unified Contract Definition (AC: #4, #6, #7)
  - [x] 3.1 Define shared `CardComponent` input/output contract: `card` (unified card data), `faceDown`, `position`, `showOverlayMaterials`, sizing via CSS custom properties (not enum-based). **Must produce an explicit TypeScript interface** (`SharedCardData` or equivalent) — not just prose description. The interface is the binding contract for Stories 8.2–8.5.
  - [x] 3.2 Define shared `CardInspectorComponent` input/output contract: `card`, `mode`, `position`, CSS custom properties for theming
  - [x] 3.3 Define complete CSS custom property theming contract for both components with default values + simulator/deck builder overrides
  - [x] 3.4 Document template-driven CDK drag pattern: parent applies `cdkDrag` + `cdkDragPreview` + context menu on `<app-card>` host element, with code example for simulator zone template

- [x] Task 4: Migration Plan (AC: #4, #8)
  - [x] 4.1 Document step-by-step migration for simulator: extract SimCardComponent → shared CardComponent, update all zone/hand/overlay templates, delete old files, verify no regression
  - [x] 4.2 Document step-by-step migration for simulator inspector: extract SimCardInspectorComponent → shared CardInspectorComponent (mode="hover"), update board template, delete old files
  - [x] 4.3 Document migration for deck builder: replace `card` component with shared `app-card`, adapt data model bridging (`CardDetail` → unified card data), update template bindings. **Deprecation:** `TooltipService` and `[customToolTip]` directive are deprecated — the shared `CardInspectorComponent` (mode="click") replaces card tooltip functionality. Document removal of `TooltipService` + directive files.
  - [x] 4.3.1 Audit all usages of `TooltipService` and `[customToolTip]` in the codebase — confirm deprecation scope is limited to card tooltips and does not break other UI tooltips
  - [x] 4.4 Document migration for deck builder inspector: integrate shared `app-card-inspector` (mode="click") for card detail overlay, replacing `[customToolTip]`-based card detail display
  - [x] 4.5 Produce manual test checklist for zero-regression validation (simulator + deck builder)
  - [x] 4.6 **Output format:** The migration plan is a separate `.md` file in `_bmad-output/implementation-artifacts/` (e.g., `8-1-migration-plan.md`) serving as the binding implementation spec for Stories 8.2–8.5

## Dev Notes

### Story Type: Analysis Document (No Code Changes)

This story produces a **migration plan document** — no production code is written or modified. The output is the analysis document itself, which becomes the implementation spec for Stories 8.2 and 8.3.

### Current Component Landscape

**Simulator Components (under `pages/simulator/`):**

| Component | Selector | File | Lines |
|---|---|---|---|
| SimCardComponent | `app-sim-card` | `sim-card.component.ts/html/scss` | 29 / 22 / 84 |
| SimCardInspectorComponent | `app-sim-card-inspector` | `card-inspector.component.ts/html/scss` | 39 / 45 / 88 |

**Deck Builder Components (under `components/`):**

| Component | Selector | File | Lines |
|---|---|---|---|
| CardComponent | `card` | `card/card.component.ts/html/scss` | 103 / 88 / 290 |
| (No dedicated inspector) | — | Uses `[customToolTip]` directive | — |

### Critical Divergences Identified

#### Data Model Mismatch
- **SimCardComponent** uses `CardInstance` — a simulator-runtime wrapper containing: card data reference, `faceDown: boolean`, `position: 'ATK' | 'DEF'`, `overlayMaterials?: CardInstance[]`, `image` (direct image reference)
- **CardComponent** uses `CardDetail` — a database DTO containing: `Card` object, `images: ImageDTO[]`, `sets: SetDTO[]`, ban info, owned quantities
- **Unified contract must bridge both models** — the shared component needs a minimal input interface that both data models can satisfy. Likely: `card: { name, imageUrl, description, attribute, race, level, atk, def, ... }` + separate `faceDown`, `position` inputs

#### CDK Drag Integration Pattern
- **SimCardComponent**: CDK drag directives (`cdkDrag`, `cdkDragData`) applied by **parent** zone/hand components on `<app-sim-card>` host element. Card itself is drag-agnostic.
- **CardComponent**: CDK drag **built into** the component (`cdkDrag` on the container div, controlled by `deckBuildMode` input, `cdkDragDisabled` binding).
- **Shared pattern**: Card must be drag-agnostic (simulator pattern). Parents apply `cdkDrag` on `<app-card>` host. Deck builder must adapt to this pattern.

#### Face-Down & Position Logic
- **SimCardComponent**: `isFaceDown` computed signal (with `forceFaceDown` override), `isDefPosition` computed. Renders card-back image when face-down, rotates 90° for DEF.
- **CardComponent**: **No face-down or position logic** — always renders face-up in the deck builder context.
- **Shared component must support both**: optional `faceDown` and `position` inputs with sensible defaults (false, 'ATK').

#### XYZ Material Rendering
- **SimCardComponent**: Renders material peek borders when `hasMaterials()` is true. Up to 5 material slots offset below card.
- **CardComponent**: **No XYZ concept** — not needed in deck builder context.
- **Shared component**: Optional `showOverlayMaterials` input (default: false). Material data from `card.overlayMaterials`.

#### Sizing System
- **SimCardComponent**: 2 sizes via string input (`'board' | 'hand'`). Height-driven (`height: 100%`), width auto from aspect ratio.
- **CardComponent**: 5 sizes via `CardSize` enum (DECK, DECK_EXTRA_SIDE, BIG, MEDIUM, SMALL). Fixed px dimensions per size variant.
- **Shared component**: Size should be controlled via CSS custom properties on the host element, not through component-level size inputs. Each consumer sets dimensions via host/parent CSS. Internal aspect ratio preserved via `aspect-ratio: 59/86`.

#### Inspector Activation Divergence
- **SimCardInspectorComponent**: Activated via `BoardStateService.selectedCard` signal (click on card in zone/hand). Fixed absolute position (top-left, 260px). Dismissal via Escape or click-outside.
- **Deck builder**: No inspector. Uses `[customToolTip]` directive for hover-based tooltip popup (lightweight, auto-positioned).
- **Original UX spec** called for hover + 50ms debounce via `hoveredCard` signal. **Decision: click-select is confirmed** — no migration to hover+debounce. The shared inspector's `hover` mode means "parent-driven card input" — the component never attaches DOM hover listeners itself.
- **Click mode for deck builder** (AC #5): Floating overlay centered over canvas, semi-transparent backdrop, dismiss on outside tap/click/Escape. Master Duel card detail pattern.

#### TooltipService & customToolTip Deprecation
- **`TooltipService`** and **`[customToolTip]` directive** are deprecated post-migration. The shared `CardInspectorComponent` (mode="click") replaces all card detail tooltip functionality in the deck builder and card search pages.
- The analysis must audit all usages of `TooltipService` and `[customToolTip]` to confirm the deprecation scope does not break non-card tooltips elsewhere in the app.
- Files to be removed during deck builder migration (Story 8.4): `TooltipService` + `customToolTip` directive source files.

#### Selector Collision Analysis
- **SimCardComponent**: `app-sim-card` — no collision risk
- **CardComponent**: selector is `card` (no `app-` prefix) — **non-standard but no collision with target `app-card`**
- **Shared target**: `app-card` — **NO existing component uses this selector**. Safe to proceed.
- Post-extraction: `card` component in deck builder is replaced by `app-card`. The old `card` files are deleted.

### Architecture Compliance

**From architecture.md — Extraction Principles:**
1. Extract, don't rewrite — simulator versions are the starting point
2. Context-agnostic interface — no simulator-specific logic in shared components
3. Signal-based inputs — `input<T>()` for all extracted components
4. Multi-mode activation for inspector — mode is an input, not hardcoded
5. Harmonization analysis first (this story)
6. Simulator must not regress after extraction

**From architecture.md — Shared Component Targets:**

| Extracted Component | Source | Target Location | Selector Change |
|---|---|---|---|
| `CardComponent` | `SimCardComponent` | `components/card/` | `app-sim-card` → `app-card` |
| `CardInspectorComponent` | `SimCardInspectorComponent` | `components/card-inspector/` | `app-sim-card-inspector` → `app-card-inspector` |

### Library & Framework Requirements

- **Angular 19.1.3**: Signal-based inputs (`input<T>()`), standalone components, OnPush change detection
- **Angular CDK DragDrop**: `cdkDrag`, `cdkDropList`, `cdkDropListGroup`, `cdkDragPreviewContainer: 'global'`
- **Angular Material 19.1.1**: `mat-menu` for context menus, `mat-badge` for counts
- **TypeScript 5.5.4 strict**: All types explicit, no `any` in shared interfaces
- **SCSS**: `_sim-tokens.scss` for simulator theme, CSS custom properties for cross-theme support

### File Structure Requirements

**New files to be created by Stories 8.2 and 8.3 (documented in this analysis):**
```
front/src/app/
├── components/
│   ├── card/                        # NEW — extracted from SimCardComponent
│   │   ├── card.component.ts
│   │   ├── card.component.html
│   │   └── card.component.scss
│   └── card-inspector/              # NEW — extracted from SimCardInspectorComponent
│       ├── card-inspector.component.ts
│       ├── card-inspector.component.html
│       └── card-inspector.component.scss
```

**Files to be deleted by Stories 8.2 and 8.3:**
```
front/src/app/pages/simulator/
├── sim-card.component.ts            # DELETED — replaced by shared CardComponent
├── sim-card.component.html          # DELETED
├── sim-card.component.scss          # DELETED
├── card-inspector.component.ts      # DELETED — replaced by shared CardInspectorComponent
├── card-inspector.component.html    # DELETED
└── card-inspector.component.scss    # DELETED
```

**Files to be modified:**
```
front/src/app/pages/simulator/
├── zone.component.ts/html           # Update: app-sim-card → app-card, adapt inputs
├── hand.component.ts/html           # Update: app-sim-card → app-card, adapt inputs
├── stacked-zone.component.ts/html   # Update: if uses sim-card
├── pile-overlay.component.ts/html   # Update: if uses sim-card
├── board.component.ts/html          # Update: app-sim-card-inspector → app-card-inspector

front/src/app/components/
├── card/card.component.ts/html/scss # REPLACED entirely by new shared version (old `card` selector → `app-card`)
├── card-list/card-list.component.*  # Update: card → app-card, adapt data binding
├── deck-card-zone/deck-card-zone.*  # Update: card → app-card, adapt data binding

front/src/app/pages/deck-page/
├── components/deck-builder/*        # Update: card references, add inspector integration
```

### Testing Requirements

**Manual test checklist (produced by Task 4.5):**

**Simulator regression tests:**
- [ ] Card renders face-up in monster zones
- [ ] Card renders face-down (card back) when set
- [ ] DEF position rotates card 90°
- [ ] XYZ material peek borders visible
- [ ] CDK drag from zone to zone works
- [ ] CDK drag from hand to zone works
- [ ] CDK drag from overlay to zone works
- [ ] Context menu (right-click) on board cards works
- [ ] Card inspector appears on card click
- [ ] Card inspector shows full details for face-down cards
- [ ] Inspector dismissed on Escape / click outside
- [ ] Gold glow on drop
- [ ] `prefers-reduced-motion` disables animations

**Deck builder regression tests:**
- [ ] Cards render in MOSAIC mode (all 5 sizes)
- [ ] Cards render in INFORMATIVE mode
- [ ] Cards render in OWNED mode
- [ ] CDK drag between deck zones works
- [ ] Ban info badge displays correctly
- [ ] Quantity controls work in deck build mode
- [ ] Card tooltip on hover (customToolTip) works
- [ ] Card double-click adds to deck

**Card search regression tests:**
- [ ] Search results display cards correctly
- [ ] Display mode toggle (INFORMATIVE/MOSAIC/OWNED) works
- [ ] Card interactions work in search context

### Previous Story Intelligence

**From Story 7.4 (Deck List Page Responsive) — Key Learnings:**
- SCSS migration to `@use` module syntax completed — all new files should use `@use` not `@import`
- Host element asymmetry issue: `deck-box` renders with/without wrapper div. Consider similar issues when shared `app-card` replaces `card` in different template contexts
- Z-index management: delete button needed `z-index: 1010` (above preview cards at 1000-1003). Shared card component must document z-index expectations
- `overflow-y: auto` fix in app.component.scss — vertical scrolling issue surfaced during responsive work. Keep in mind for inspector overlay positioning
- Column count math depends on navbar width (260px expanded, 32px collapsed) — relevant for inspector positioning

**From Story 7.1 (Shared SCSS Infrastructure):**
- `_responsive.scss` created with breakpoints: `$navbar-breakpoint: 768px`, `$bp-mobile: 576px`, `$bp-tablet: 768px`, `$bp-desktop-sm: 1024px`
- `_canvas-scaling.scss` created for Track A pages
- `ScalingContainerDirective` created — used by deck builder/card search pages (Stories 8.4, 8.5)

### Git Intelligence

**Recent commits:**
- `9e0fd19` — 7-3 & 7-4: Responsive login, settings, deck list pages (18 files changed, 1394 insertions)
- `8546c6f` — 7-1: Shared SCSS infrastructure and ScalingContainerDirective
- `907bd92` — v1: All Epic 1-6 work (simulator complete)

**Patterns from recent work:**
- Stories 7.x modified SCSS files extensively — responsive breakpoints, CSS Grid migration, `@use` syntax
- NavbarComponent recently extended with hamburger/drawer mode (html +107 lines, scss +128 lines, ts +39 lines)
- `navbar-collapse.service.ts` modified (+28 lines) — service now manages both desktop collapse and mobile drawer state
- `board.component.ts` modified (+6 lines in 7-1) — likely ScalingContainerDirective integration prep

### Project Structure Notes

- Alignment with unified project structure: shared components go in `front/src/app/components/` (existing pattern — `card/`, `card-list/`, `deck-box/`, `deck-card-zone/`, etc.)
- The existing `components/card/` directory will be **overwritten** with the new shared CardComponent. The old `card` selector component files are completely replaced.
- New `components/card-inspector/` directory created alongside existing components
- Simulator files under `pages/simulator/` are modified (import changes) but not moved

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 8, Story 8.1]
- [Source: _bmad-output/planning-artifacts/architecture.md — Shared Component Extraction section]
- [Source: _bmad-output/planning-artifacts/architecture.md — Responsive Strategy section]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — SimCardComponent spec]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — SimCardInspectorComponent spec]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Responsive Design section]
- [Source: front/src/app/pages/simulator/sim-card.component.ts — Current SimCardComponent implementation]
- [Source: front/src/app/pages/simulator/card-inspector.component.ts — Current SimCardInspectorComponent implementation]
- [Source: front/src/app/components/card/card.component.ts — Current deck builder CardComponent]
- [Source: _bmad-output/implementation-artifacts/7-4-deck-list-page-responsive.md — Previous story learnings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

(No code changes — analysis document story)

### Completion Notes List

- ✅ Task 1: Analyzed both SimCardComponent and CardComponent (deck builder) in full — all inputs, outputs, computed signals, templates, SCSS. Produced comprehensive side-by-side comparison table. Verified `app-card` selector has zero collisions. Documented 5 simulator-only features, 10 deck-builder-only features, and 2 features requiring unification.
- ✅ Task 2: Analyzed SimCardInspectorComponent and deck builder tooltip chain (ToolTipRendererDirective → TooltipService → CardTooltipComponent). Documented unified `mode: 'hover' | 'click' | 'permanent'` contract with clear behavior specs. Designed floating overlay pattern for click mode (Master Duel inspired, centered, backdrop, uniform across viewports).
- ✅ Task 3: Defined `SharedCardData` and `SharedCardInspectorData` TypeScript interfaces as binding contracts. Defined input/output contracts for both shared components. Produced CSS custom property theming contract (10 card properties, 10 inspector properties) with defaults + per-consumer overrides. Documented template-driven CDK drag pattern with code examples for both simulator and deck builder.
- ✅ Task 4: Produced step-by-step migration plans for simulator card (7 steps), simulator inspector (6 steps), deck builder card (7 steps), deck builder inspector (4 steps). Audited TooltipService/customToolTip — confirmed 10 files affected, all card-specific, safe to deprecate. Produced comprehensive manual test checklist (20 simulator tests, 15 deck builder tests, 7 card search tests, 5 cross-cutting tests). Migration plan saved as separate `8-1-migration-plan.md`.

### Implementation Decisions

- `SharedCardData` kept minimal (name, imageUrl, imageUrlFull) — adapter pattern in parent components bridges CardInstance/CardDetail to this interface
- OWNED mode, INFORMATIVE mode, ban info, quantity controls stay in deck builder wrapper — NOT in shared CardComponent
- CardTooltipComponent features (favorite toggle, deck add/remove) are page-specific business logic, NOT migrated into shared inspector
- Card sizing via CSS custom properties (host element) instead of enum/string input — each consumer controls dimensions

### Change Log

- 2026-02-14: Story 8.1 complete — harmonization analysis and migration plan produced
- 2026-02-14: **Code review (adversarial)** — 10 issues found (1H, 5M, 4L), all fixed:
  - H1: Added CSS class names comparison table (Section 1.3b) to satisfy AC #1 fully
  - M1: Documented `imgLoader` directive removal in migration plan (Section 4.3 step 5)
  - M2: Fixed `SharedCardInspectorData` file location ambiguity (Section 4.2 step 2)
  - M3: Documented `loaded` output as dead code being dropped (Section 3.1)
  - M4: Added image error fallback strategy for shared CardComponent (Section 3.1)
  - M5: Fixed SCSS-only `rgba(#hex)` syntax to valid CSS `rgba()` (Section 3.3)
  - L1: Corrected line counts (SimCard HTML 21→22, SCSS 83→84; Inspector TS 38→39, HTML 44→45, SCSS 87→88; CardComponent TS 104→103)
  - L2: Replaced "glass morphism" with "semi-transparent overlay surface" (Section 2.1)
  - L3: Flagged deck builder `loaded` output as dead code in analysis (Section 1.2)
  - L4: Added `custom-tooltip.component.ts` out-of-scope clarification in deprecation audit (Section 4.3.1)

### File List

**New files:**
- `_bmad-output/implementation-artifacts/8-1-migration-plan.md` (binding implementation spec for Stories 8.2–8.5)

**Modified files:**
- `_bmad-output/implementation-artifacts/8-1-harmonization-analysis-and-migration-plan.md` (this story file — tasks checked, Dev Agent Record, status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (8-1 status: ready-for-dev → in-progress → review)
