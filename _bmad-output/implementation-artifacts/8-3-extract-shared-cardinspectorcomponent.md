# Story 8.3: Extract Shared CardInspectorComponent

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a shared `CardInspectorComponent` (`app-card-inspector`) extracted from the simulator's `SimCardInspectorComponent`,
So that the simulator and deck builder can both display card details using the same component with different activation modes.

## Acceptance Criteria

1. **Given** the harmonization analysis from Story 8.1 is complete, **When** the shared `CardInspectorComponent` is created in `src/app/components/card-inspector/`, **Then** it uses the selector `app-card-inspector`, accepts `card` input (`SharedCardInspectorData | null`), `mode` input (`'hover' | 'click' | 'permanent'`), and `position` input (`'left' | 'right'`). All inputs use Angular signal-based input API. It emits a `dismissed` output.

2. **Given** the `CardInspectorComponent` is in `hover` mode (simulator), **When** a non-null `card` input is provided, **Then** the inspector panel appears with fade transition (~150ms). When `card` becomes null, the panel fades out. The component does NOT manage its own hover/click detection — the parent provides the `card` value. The `position` input controls left/right placement.

3. **Given** the `CardInspectorComponent` is in `click` mode (deck builder, card search), **When** the parent sets the `card` input after a card tap/click, **Then** the inspector appears as a floating overlay centered over the canvas with a semi-transparent backdrop. Tapping/clicking outside the overlay or pressing Escape dismisses it and emits `dismissed`. The `position` input is ignored in `click` mode — overlay is always centered.

4. **Given** the `CardInspectorComponent` is in `permanent` mode, **When** a card is provided, **Then** the inspector panel is always visible (no show/hide transition). Content updates when the `card` input changes.

5. **Given** the `CardInspectorComponent` renders card details, **When** a card is displayed, **Then** it shows: full-size card image (with error fallback to `card_back.jpg`), card name, attribute/race/level (monsters), ATK/DEF values (with Link rating and Pendulum scale where applicable), full effect text (scrollable via `[innerHTML]`). Face-down cards show full details (solo context). No deck-building buttons rendered.

6. **Given** the `CardInspectorComponent` supports theming, **When** different pages host it, **Then** CSS custom properties (`--inspector-bg`, `--inspector-text`, `--inspector-text-secondary`, `--inspector-width`, `--inspector-border-color`, `--inspector-border-radius`, `--inspector-image-width`, `--inspector-backdrop`, `--inspector-z-index`) allow each page to style the inspector differently.

7. **Given** the shared `CardInspectorComponent` is ready, **When** the simulator's `SimCardInspectorComponent` is refactored, **Then** `SimCardInspectorComponent` is replaced with `CardInspectorComponent` (`app-card-inspector`, `mode="hover"`) in the simulator board template. The `selectedCard` signal (click-driven) continues to drive the `card` input via an adapter computed signal. `isDragging` signal continues to hide the inspector during drag. The inspector repositioning logic (move to left when pile overlay is on right) is preserved via the `position` input driven by a computed signal. The old `SimCardInspectorComponent` files are deleted.

8. **Given** the simulator uses the shared `CardInspectorComponent`, **When** all existing simulator interactions are tested manually, **Then** click-to-inspect behavior, Escape/click-outside dismissal, face-down inspection, pile overlay repositioning, fade transitions, mobile centering, `prefers-reduced-motion` support, and ARIA attributes all work identically to before the refactor.

## Tasks / Subtasks

- [x] Task 1: Create shared `CardInspectorComponent` (AC: #1, #2, #3, #4, #5, #6)
  - [x] 1.1 Create `front/src/app/components/card-inspector/card-inspector.component.ts` — selector `app-card-inspector`, standalone, OnPush. Inject `ElementRef` (for click-outside detection in hover mode). Signal inputs: `card = input<SharedCardInspectorData | null>(null)`, `mode = input<'hover' | 'click' | 'permanent'>('hover')`, `position = input<'left' | 'right'>('left')`. Output: `dismissed = output<void>()`. Computed: `isVisible` (mode-dependent logic). Host bindings: `role="complementary"`, `aria-label="Card inspector"`, `aria-live="polite"`, `[class.visible]` tied to visibility. `@HostListener('document:keydown.escape')` → emit `dismissed` in hover/click modes. `@HostListener('document:mousedown', ['$event'])` → in hover mode only: check `elementRef.nativeElement.contains(event.target)`, if outside emit `dismissed`. Click mode uses `(click)` on backdrop div instead. Permanent mode ignores both.
  - [x] 1.2 Create `front/src/app/components/card-inspector/card-inspector.component.html` — Two template branches via `@if (mode())`: **hover mode** renders horizontal layout (image left + details right) inside `.inspector-content`; **click mode** renders full-screen backdrop `.inspector-backdrop` + centered panel `.inspector-panel` with vertical layout (large image + details). Both share the same card detail rendering block (name, stats, effect). Use `card()` directly (flat path: `card().name`, NOT `card.card.card.name`). Image error fallback: `(error)="$any($event.target).src='assets/images/card_back.jpg'"`.
  - [x] 1.3 Create `front/src/app/components/card-inspector/card-inspector.component.scss` — All theme values via CSS custom properties with defaults (see contract below). `:host` styles for hover mode (absolute positioned, opacity transition). `.inspector-backdrop` + `.inspector-panel` for click mode (fixed, centered, z-index 1050). Mobile media query at 768px for hover mode (centered). `prefers-reduced-motion` and `.force-reduced-motion` support. `@use` syntax only (no `@import`).
  - [x] 1.4 Verify shared component compiles standalone — `ng build` succeeds

- [x] Task 2: Migrate simulator — `app-sim-card-inspector` → `app-card-inspector` (AC: #7, #8)
  - [x] 2.1 Update `board.component.ts`: Remove `SimCardInspectorComponent` import → add `CardInspectorComponent` from `components/card-inspector/`. Add `inspectorData` computed signal (adapter: `BoardStateService.selectedCard` → `SharedCardInspectorData | null`). Add `inspectorPosition` computed signal (returns `'right'` when `boardState.isOverlayOpen()` is true, `'left'` otherwise). Add `clearSelection()` method → `boardState.clearSelection()`. Import `SharedCardInspectorData` from `core/model/shared-card-data`.
  - [x] 2.2 Update `board.component.html`: Replace `<app-sim-card-inspector />` (line 42) with `<app-card-inspector [card]="inspectorData()" mode="hover" [position]="inspectorPosition()" (dismissed)="clearSelection()" />`
  - [x] 2.3 Update `board.component.ts` imports array: `SimCardInspectorComponent` → `CardInspectorComponent`

- [x] Task 3: Delete old SimCardInspectorComponent files (AC: #7)
  - [x] 3.1 Delete `front/src/app/pages/simulator/card-inspector.component.ts`
  - [x] 3.2 Delete `front/src/app/pages/simulator/card-inspector.component.html`
  - [x] 3.3 Delete `front/src/app/pages/simulator/card-inspector.component.scss`

- [x] Task 4: Verify zero regression (AC: #8)
  - [x] 4.1 `ng build` succeeds with zero TS/Angular errors (budget warning is pre-existing)
  - [x] 4.2 Verify no remaining references to `SimCardInspectorComponent` or `app-sim-card-inspector` in codebase
  - [ ] 4.3 Manual test: inspector appears on card click in zone
  - [ ] 4.4 Manual test: inspector appears on card click in hand
  - [ ] 4.5 Manual test: inspector appears on card click in pile overlay
  - [ ] 4.6 Manual test: inspector appears on card click in XYZ material peek
  - [ ] 4.7 Manual test: inspector shows full details (name, stats, ATK/DEF, effect text)
  - [ ] 4.8 Manual test: inspector shows full details for face-down cards (solo context)
  - [ ] 4.9 Manual test: inspector image fallback (broken image → card back)
  - [ ] 4.10 Manual test: inspector dismissed on Escape key
  - [ ] 4.11 Manual test: inspector dismissed on click outside panel
  - [ ] 4.12 Manual test: inspector repositions to left when pile overlay is open (right side)
  - [ ] 4.13 Manual test: inspector hidden during drag (`isDragging` signal)
  - [ ] 4.14 Manual test: inspector mobile centering (viewport ≤768px)
  - [ ] 4.15 Manual test: `prefers-reduced-motion` disables fade transition
  - [ ] 4.16 Manual test: ARIA attributes present (`role="complementary"`, `aria-label`, `aria-live`)

## Dev Notes

### Binding Implementation Spec

**This story MUST follow the migration plan from Story 8.1:**
- `_bmad-output/implementation-artifacts/8-1-migration-plan.md` — Sections 3.2, 3.3, 4.2
- The migration plan defines the exact `SharedCardInspectorData` interface, CSS custom property contract, mode behavior spec, and step-by-step migration sequence. It is authoritative.

### Extraction Principle: Extract, Don't Rewrite

The shared `CardInspectorComponent` is based on the existing `SimCardInspectorComponent` (`pages/simulator/card-inspector.component.*`). The extraction approach:
1. **Copy** `SimCardInspectorComponent` code to `components/card-inspector/card-inspector.component.*`
2. **Remove** `BoardStateService` injection — replace with `card` signal input + `mode` input + `position` input
3. **Keep** `ElementRef` injection — needed for click-outside detection in `hover` mode (`elementRef.nativeElement.contains(event.target)`). This is Angular infrastructure, not a business service.
4. **Flatten** template data paths: `card.card.card.name` → `card().name` (SharedCardInspectorData is flat)
5. **Add** `click` mode template branch: backdrop + centered panel (Master Duel pattern)
6. **Add** `permanent` mode: simplest — always visible, no dismiss
7. **Convert** SCSS from `@use 'sim-tokens'` to CSS custom properties with defaults
8. **Preserve** ARIA attributes, `prefers-reduced-motion`, mobile responsive layout
9. **Preserve** Escape + click-outside dismiss logic (now emits `dismissed` output instead of calling service)

### SharedCardInspectorData Interface (Already Exists)

The interface was created in Story 8.2 (Task 1.2) at `front/src/app/core/model/shared-card-data.ts`:

```typescript
export interface SharedCardInspectorData extends SharedCardData {
  readonly isMonster: boolean;
  readonly attribute?: string;
  readonly race?: string;
  readonly level?: number;
  readonly scale?: number;
  readonly linkval?: number;
  readonly isLink: boolean;
  readonly hasDefense: boolean;
  readonly displayAtk: string;
  readonly displayDef: string;
  readonly description: string;
}
```

**DO NOT recreate this interface.** Import from `core/model/shared-card-data`.

### CardInspectorComponent Input/Output Contract

| Input | Type | Default | Notes |
|-------|------|---------|-------|
| `card` | `input<SharedCardInspectorData \| null>()` | `null` | Card data for display. `null` = hidden. |
| `mode` | `input<'hover' \| 'click' \| 'permanent'>()` | `'hover'` | Display behavior mode |
| `position` | `input<'left' \| 'right'>()` | `'left'` | Panel position (hover mode only) |

| Output | Type | Notes |
|--------|------|-------|
| `dismissed` | `output<void>()` | Emits when inspector is dismissed (Escape, outside click, backdrop click) |

**No business services injected. No `BoardStateService`, no `TooltipService`. `ElementRef` is injected for click-outside detection in `hover` mode (Angular infrastructure dependency, not a business service). Purely presentational with self-contained dismiss logic.**

### CSS Custom Properties Contract

| Property | Default | Simulator Override (`hover`) | Deck Builder Override (`click`) |
|----------|---------|------------------------------|----------------------------------|
| `--inspector-bg` | `rgba(17, 24, 39, 0.92)` | (use default) | `rgba(30, 30, 30, 0.95)` |
| `--inspector-text` | `#f1f5f9` | (use default) | (use default) |
| `--inspector-text-secondary` | `#94a3b8` | (use default) | (use default) |
| `--inspector-width` | `260px` | (use default) | `min(400px, 90vw)` |
| `--inspector-border-color` | `rgba(0, 212, 255, 0.15)` | (use default) | `rgba(255, 255, 255, 0.1)` |
| `--inspector-border-radius` | `8px` | (use default) | `12px` |
| `--inspector-image-width` | `80px` | (use default) | `140px` |
| `--inspector-backdrop` | `rgba(0, 0, 0, 0.6)` | n/a (no backdrop in hover) | (use default) |
| `--inspector-z-index` | `10` | (use default) | `1050` |

### Mode Behavior Specification

**`hover` mode (simulator):**
- `:host` is `position: absolute` — parent controls placement via CSS or position input
- `position: 'left'` → `left: 8px; top: 8px`
- `position: 'right'` → `right: 8px; top: 8px` (auto-set `left: auto`)
- Show/hide via `opacity` transition + `pointer-events` (CSS `.visible` class)
- Visibility = `card() !== null`
- Dismiss: Escape key → emit `dismissed`. Click outside component → emit `dismissed`.
- No backdrop.
- Mobile (≤768px): centered horizontally (`left: 50%; transform: translateX(-50%); width: 90%`)

**`click` mode (deck builder — Story 8.4/8.5 will consume):**
- Renders backdrop div (`position: fixed; inset: 0; background: var(--inspector-backdrop); z-index: var(--inspector-z-index)`)
- Panel centered on backdrop (horizontal + vertical center)
- `position` input ignored — always centered
- Visibility = `card() !== null`
- Dismiss: Escape key → emit `dismissed`. Backdrop click → emit `dismissed`.
- Clicking a different card replaces content without close/reopen.

**`permanent` mode (future use):**
- Always visible when `card() !== null`. No dismiss behavior. No transitions.
- Escape and click-outside ignored.

### Adapter Pattern for Simulator (board.component.ts)

```typescript
// In SimBoardComponent — adapter from selectedCard to SharedCardInspectorData
readonly inspectorData = computed<SharedCardInspectorData | null>(() => {
  if (this.boardState.isDragging()) return null; // Suppress inspector during drag
  const ci = this.boardState.selectedCard();
  if (!ci) return null;
  const c = ci.card.card; // Card class (3-level nesting in CardInstance)
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

// Inspector position: default 'left' (top-left of board). When pile overlay is open
// (overlay renders on the left side of the board), move inspector to 'right' to avoid overlap.
readonly inspectorPosition = computed<'left' | 'right'>(() =>
  this.boardState.isOverlayOpen() || this.boardState.isMaterialPeekOpen() ? 'right' : 'left'
);

clearSelection(): void {
  this.boardState.clearSelection();
}
```

**`isDragging` suppression:** The `inspectorData` computed signal MUST return `null` when `isDragging()` is true — this hides the inspector during drag operations. Add the guard as the first line of the computed:
```typescript
if (this.boardState.isDragging()) return null;
```
This is the definitive approach. Do NOT rely on `clearSelection()` being called in drag-start handlers (it currently is not).

### Current SimCardInspectorComponent Code Reference

**TS** (39 lines) — `pages/simulator/card-inspector.component.ts`:
- Injects `BoardStateService` (for `selectedCard` signal) and `ElementRef` (for click-outside)
- `isVisible = computed(() => this.selectedCard() !== null)`
- `@HostListener('document:keydown.escape')` → `boardState.clearSelection()`
- `@HostListener('document:mousedown', ['$event'])` → checks `elementRef.contains()` → `boardState.clearSelection()`

**HTML** (44 lines) — `pages/simulator/card-inspector.component.html`:
- `@if (isVisible())` + `@if (selectedCard(); as card)` guard
- Image: `card.image.url || card.image.smallUrl` with error fallback
- Name: `card.card.card.name`
- Monster stats: `card.card.card.attribute`, `.race`, `.isLink`, `.linkval`, `.level`, `.scale`
- ATK/DEF: `card.card.card.displayAtk`, `.displayDef`, `.hasDefense`
- Spell/Trap: shows `.race` only
- Effect: `[innerHTML]="card.card.card.description"`

**SCSS** (87 lines) — `pages/simulator/card-inspector.component.scss`:
- `@use 'sim-tokens' as *`
- `:host` → absolute, `top: 8px; left: 8px; width: 260px`, `rgba($sim-surface, 0.92)` bg, `$sim-zone-border`, opacity transition 150ms
- `.visible` → opacity 1, pointer-events auto
- `.inspector-content` → flex row, 0.75rem gap
- `.inspector-image` → 80px width, `$sim-radius-card` border-radius
- `.card-name` → `$sim-text-primary`, 0.875rem
- `.card-stats`, `.card-atk-def` → `$sim-text-secondary`, 0.75rem, flex with gap
- `.card-effect` → `$sim-text-primary`, 0.75rem, line-height 1.4
- Mobile (≤768px): centered, 90% width, 60px image
- `prefers-reduced-motion: reduce` → transition: none
- `.force-reduced-motion` (host-context) → transition: none

### Board Template Change (line 42)

**Before:**
```html
<app-sim-card-inspector />
```

**After:**
```html
<app-card-inspector [card]="inspectorData()" mode="hover" [position]="inspectorPosition()" (dismissed)="clearSelection()" />
```

### sim-tokens Values to Map to CSS Custom Properties

| sim-tokens Variable | Value | CSS Custom Property |
|---------------------|-------|---------------------|
| `$sim-surface` (in `rgba($sim-surface, 0.92)`) | `#111827` | `--inspector-bg: rgba(17, 24, 39, 0.92)` |
| `$sim-zone-border` | `rgba(0, 212, 255, 0.15)` | `--inspector-border-color` |
| `$sim-text-primary` | `#f1f5f9` | `--inspector-text` |
| `$sim-text-secondary` | `#94a3b8` | `--inspector-text-secondary` |
| `$sim-radius-card` | `0.25rem` | `--inspector-border-radius` (image uses same) |

### Critical Anti-Patterns to Avoid

1. **DO NOT inject `BoardStateService`** — the shared inspector must be context-agnostic. The `card` input is the only data source.
2. **`ElementRef` is allowed** for click-outside detection in `hover` mode — inject it, use `elementRef.nativeElement.contains(event.target)` in `@HostListener('document:mousedown')`. For `click` mode, use `(click)` on the backdrop div instead. DO NOT use `ElementRef` for service calls or DOM manipulation.
3. **DO NOT use `card.card.card.name`** — the template reads flat `SharedCardInspectorData` fields: `card().name`, `card().attribute`, etc.
4. **DO NOT use `@import`** in SCSS — use `@use` syntax only.
5. **DO NOT hardcode sim-tokens values** — use CSS custom properties with defaults.
6. **DO NOT add deck-building buttons** (+1/-1, add/remove, favorite) — these are page-specific concerns.
7. **DO NOT break ARIA attributes** — `role="complementary"`, `aria-label="Card inspector"`, `aria-live="polite"` must be preserved.
8. **DO NOT skip the `permanent` mode** — even if unused today, implementing it is trivial (no dismiss, always visible) and prevents future rework.
9. **DO NOT call `boardState.clearSelection()` from the shared component** — emit `dismissed` output and let the parent handle service calls.
10. **DO NOT forget the image error fallback** — `(error)="$any($event.target).src='assets/images/card_back.jpg'"` is required.

### Files to Modify — Complete List

**New files:**

| File | Description |
|------|-------------|
| `front/src/app/components/card-inspector/card-inspector.component.ts` | Shared CardInspectorComponent |
| `front/src/app/components/card-inspector/card-inspector.component.html` | Inspector template (hover + click + permanent modes) |
| `front/src/app/components/card-inspector/card-inspector.component.scss` | Inspector styles with CSS custom properties |

**Deleted files:**

| File | Reason |
|------|--------|
| `front/src/app/pages/simulator/card-inspector.component.ts` | Replaced by shared CardInspectorComponent |
| `front/src/app/pages/simulator/card-inspector.component.html` | Replaced |
| `front/src/app/pages/simulator/card-inspector.component.scss` | Replaced |

**Modified files:**

| File | Changes |
|------|---------|
| `front/src/app/pages/simulator/board.component.ts` | Remove `SimCardInspectorComponent` import → add `CardInspectorComponent`. Add `inspectorData` computed signal (adapter). Add `inspectorPosition` computed signal. Add `clearSelection()` method. Import `SharedCardInspectorData`. |
| `front/src/app/pages/simulator/board.component.html` | `<app-sim-card-inspector />` → `<app-card-inspector [card]="inspectorData()" mode="hover" [position]="inspectorPosition()" (dismissed)="clearSelection()" />` |

**NOT modified in this story:**
- Zone/hand/stacked-zone/pile-overlay/xyz-material-peek components — they still call `boardState.selectCard()` directly (unchanged)
- Deck builder components — migration to `<app-card-inspector mode="click">` happens in Story 8.4
- `TooltipService` / `[customToolTip]` deprecation — happens in Story 8.4
- `SharedCardInspectorData` interface — already exists from Story 8.2

### Project Structure Notes

- Shared components directory: `front/src/app/components/` (existing pattern — already contains `card/`, `card-list/`, `deck-box/`, etc.)
- New `components/card-inspector/` directory created alongside existing components
- Interface file at `front/src/app/core/model/shared-card-data.ts` already exists — DO NOT create or modify
- SCSS uses `@use` syntax (project-wide convention since Story 7.1)

### Previous Story Intelligence (Story 8.2)

**Key learnings from 8.2 extraction that apply here:**
- **Adapter deduplication (H1 fix):** `toSharedCardData()` was deduplicated to `simulator.models.ts`. For this story, the `toSharedCardInspectorData` adapter only lives in `board.component.ts` (single consumer), so deduplication is not needed yet. If Story 8.4 needs the same adapter, extract then.
- **`:host` styling (H2 fix):** Ensure critical layout properties (width, position) are on `:host`, not an inner div.
- **`?? ''` fallback (M1 fix):** All nullable string fields in the adapter (`name`, `description`) must use `?? ''` to prevent "undefined" text in the template.
- **OnPush required:** All new components must have `changeDetection: ChangeDetectionStrategy.OnPush`.
- **Build budget error is pre-existing** — `ng build` succeeding with only the budget warning is expected.
- **Legacy bridge pattern:** Story 8.2 created `deck-builder-card.component.*` as a legacy bridge. No similar bridge is needed for the inspector — `SimCardInspectorComponent` has only one consumer (`board.component`).

### References

- [Source: _bmad-output/implementation-artifacts/8-1-migration-plan.md — Sections 3.2, 3.3, 4.2]
- [Source: _bmad-output/implementation-artifacts/8-1-harmonization-analysis-and-migration-plan.md — Section 2 (Inspector Comparison)]
- [Source: _bmad-output/implementation-artifacts/8-2-extract-shared-cardcomponent.md — Previous story learnings]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 8, Story 8.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Shared Component Extraction section]
- [Source: front/src/app/pages/simulator/card-inspector.component.ts — Current SimCardInspectorComponent (39 lines)]
- [Source: front/src/app/pages/simulator/card-inspector.component.html — Template (44 lines)]
- [Source: front/src/app/pages/simulator/card-inspector.component.scss — Styles (87 lines)]
- [Source: front/src/app/pages/simulator/board.component.ts — BoardComponent (86 lines)]
- [Source: front/src/app/pages/simulator/board.component.html — Board template (43 lines)]
- [Source: front/src/app/pages/simulator/board-state.service.ts — selectedCard signal, selectCard/clearSelection (lines 58, 120-126)]
- [Source: front/src/app/core/model/shared-card-data.ts — SharedCardInspectorData interface (19 lines)]
- [Source: front/src/app/pages/simulator/simulator.models.ts — CardInstance interface, toSharedCardData (69 lines)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- No debug issues encountered. Build compiled cleanly on first attempt.

### Completion Notes List

- **Task 1:** Created shared `CardInspectorComponent` with 3 modes (hover/click/permanent), signal-based inputs, CSS custom properties theming, ARIA attributes, `prefers-reduced-motion` support. No business services injected — purely presentational with `dismissed` output.
- **Task 2:** Migrated `board.component` to use shared inspector. Added `inspectorData` adapter computed signal (flattens `CardInstance` → `SharedCardInspectorData`, suppresses during drag). Added `inspectorPosition` computed signal (moves inspector right when overlay/material-peek open). Added `clearSelection()` method for `dismissed` handler.
- **Task 3:** Deleted 3 old `SimCardInspectorComponent` files from `pages/simulator/`.
- **Task 4:** `ng build` passes with zero TS/Angular errors (budget error is pre-existing). Zero residual references to old component. Manual tests (4.3-4.16) pending user verification.

### File List

**New:**
- `front/src/app/components/card-inspector/card-inspector.component.ts`
- `front/src/app/components/card-inspector/card-inspector.component.html`
- `front/src/app/components/card-inspector/card-inspector.component.scss`

**Modified:**
- `front/src/app/pages/simulator/board.component.ts`
- `front/src/app/pages/simulator/board.component.html`

**Deleted:**
- `front/src/app/pages/simulator/card-inspector.component.ts`
- `front/src/app/pages/simulator/card-inspector.component.html`
- `front/src/app/pages/simulator/card-inspector.component.scss`

## Senior Developer Review (AI)

**Reviewer:** Axel | **Date:** 2026-02-14 | **Model:** Claude Opus 4.6 | **Outcome:** Approved (all issues fixed)

### Findings (6 total: 3 Medium, 3 Low — 0 High/Critical)

| ID | Severity | Description | Resolution |
|----|----------|-------------|------------|
| M1 | MEDIUM | Template duplication — 32 lines of card detail rendering duplicated between click and hover/permanent branches | Fixed: extracted to `<ng-template #cardDetails>` with `*ngTemplateOutlet` |
| M2 | MEDIUM | `display: contents` on `:host.mode-click` breaks ARIA (`role`, `aria-label`, `aria-live`) in accessibility tree | Fixed: removed `display: contents` — fixed-position backdrop works without it |
| M3 | MEDIUM | `:host.mode-permanent` renders visible empty box when `card()` is null (no visibility handling) | Fixed: added `&:not(.visible) { display: none; }` |
| L1 | LOW | `.card-effect` not scrollable (AC #5 requires scrollable effect text) — no `max-height`/`overflow-y` | Fixed: added `max-height: 8rem; overflow-y: auto;` |
| L2 | LOW | New SCSS budget warning: `card-inspector.component.scss` at 2.46 KB exceeds 2 KB per-component budget | Accepted — consistent with 6 other components in project |
| L3 | LOW | Hover mode (80px image) loads `imageUrlFull` unnecessarily instead of `imageUrl` (small) | Fixed: hover/permanent now uses `c.imageUrl`, click keeps `c.imageUrlFull \|\| c.imageUrl` |

### Git vs Story Discrepancies

None — File List matches git changes exactly.

### Task Completion Audit

All tasks marked `[x]` verified against actual implementation. Manual tests (4.3–4.16) correctly left unchecked.

## Change Log

- 2026-02-14: Extracted shared `CardInspectorComponent` from `SimCardInspectorComponent`. Supports hover/click/permanent modes with CSS custom property theming. Migrated simulator board to use shared component via adapter pattern. Deleted old simulator-specific inspector files.
- 2026-02-14: **Code review** — Fixed 5/6 issues (M1 template dedup, M2 ARIA accessibility, M3 permanent mode visibility, L1 scrollable effect text, L3 hover image optimization). L2 budget warning accepted. Status → done.
