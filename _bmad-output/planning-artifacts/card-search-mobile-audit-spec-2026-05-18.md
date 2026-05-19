---
title: Card Search Page — Mobile UX Audit & Refresh Spec
author: Sally (UX Designer)
date: 2026-05-18
status: ready-for-implementation
scope: front/src/app/pages/card-search-page + front/src/app/components/card-searcher + front/src/app/components/card-list
related: project_design_system_strategy, project_deck_flow_filters_spec_2026_05_17, mockup-deck-flow.html
---

# Card Search Page — Mobile UX Audit & Refresh Spec

## TL;DR

The card-search-page is **broken on landscape mobile** (480-767px, orientation paysage) and **suboptimal on portrait mobile**. Root cause: every mobile-specific rule is gated on `@include mobile-portrait` (which is `(max-width: 767px) AND (orientation: portrait)`). The landscape case falls through to the desktop layout, except the FAB which is portrait-only — so filters are unreachable and the GRID/LIST toggle exposes a mode whose rendering is broken below 768px regardless of orientation.

**Verdict**: unify the mobile layout under `(max-width: 767px)` regardless of orientation. The portrait/landscape distinction is only meaningful for the deck-build split-screen mode (`landscape-split`, kept intact).

---

## Current state — what's wrong

### Findings

#### F1 — GRID/LIST toggle visible but useless in landscape mobile
- Files: `card-searcher.component.scss:118`, `card-search-page.component.scss:108`
- The `mobile-portrait` mixin hides the toggle group only in portrait. In landscape mobile, the toggle stays clickable. But the LIST mode `.card-info` panel requires 280px (`card-list.component.scss:149-152`), which overflows any viewport < 768px.
- **Worst case**: user picks LIST on desktop → rotates phone landscape → LIST renders broken AND toggle to GRID is still visible (works) but mode is "trap with escape", not "intent supported".

#### F2 — Filters unreachable in landscape mobile (the real blocker)
- The page exposes **3 entry points** to the filter panel, none of which fire in landscape mobile:
  - `__sidebar` (always-on aside) — hidden in `mobile-portrait` only, geometrically visible in landscape mobile but **squeezed**: 280px sidebar + main on a 844px-wide viewport leaves ~500px main, and only ~300px vertical headroom after the header. Unusable.
  - `__fab` (floating action button) — `display: flex` only in `mobile-portrait`. **Hidden** in landscape mobile.
  - `__external-filters` bottom-sheet — `display: block` when `landscape-split` (576-767 paysage) OR `(min-width: 768px) AND (max-height: 500px)`. **Matches** landscape mobile geometrically, BUT…
- `card-search-page.component.ts:92-98` defines `onFiltersExpanded()` to drive `externalFiltersOpened`, but the template never wires `(filterToggled)` or `(filtersExpanded)` to it. The page passes `[showFilters]="false"` to `search-bar` (l. 25), which removes the only emitter of `filterToggled`. **No code path can open the external sheet.**

→ **Net result**: in landscape mobile, filters are visually crammed into a 280px sidebar with 300px height, and there's no way to expand them.

#### F3 — Header search-bar wraps weirdly in landscape mobile
- `card-search-page.component.scss:72-91` — `__bar` is `flex` with `min-width: 280px` on the search-bar. `flex-wrap: wrap` is only enabled in `mobile-portrait`. In landscape mobile, the bar shares one line with title block + toggle + favorites star → either it wraps (because flex flow can't fit, but no `flex-wrap`) clipping the title, or it overflows.

#### F4 — Mobile portrait: minor but worth fixing
- `searchPanelOpened = signal(true)` (page.ts:39) → on cold load mobile, the bottom-sheet opens automatically and covers the empty grid. Mockup intent (ll. 3660-3694) is **grid first, FAB closed, sheet on demand**.
- Header keeps both title row + search-bar wrap → ~120px of vertical chrome on a 390×844 phone, eats 14% of the screen before any results show.

#### F5 — Inconsistency between `card-searcher` and `card-search-page`
- The `card-searcher` component is the embed used in deck-build mode (with its own `.cardSearchPage-searcher-bar-displayMode` toggle). The `card-search-page` duplicates the same `__view-group` markup. Both gate visibility on `mobile-portrait`. Any fix has to land in **both** to stay consistent, but they should converge on a shared rule rather than diverge over time.

### Quick severity grid

| ID | Issue | Severity | Fix complexity |
|---|---|---|---|
| F2 | Filters unreachable in landscape mobile | 🔴 Blocker | M |
| F3 | Search-bar overflow in landscape mobile | 🔴 Blocker | S |
| F1 | GRID/LIST toggle exposes broken mode | 🟡 UX trap | S |
| F4 | Sheet auto-opens in portrait mobile | 🟡 Polish | XS |
| F5 | Duplicated toggle markup | 🟢 Tech-debt | S |

---

## Target UX — Unified Mobile Layout

### Single breakpoint rule

**Everything < 768px = mobile pattern, regardless of orientation.**

The existing `mobile-portrait` mixin stays alive (other Track A pages use it), but **`card-search-page` and `card-searcher` switch to a new mixin** that covers both orientations:

```scss
// _responsive.scss — NEW mixin (additive, doesn't replace mobile-portrait)
@mixin mobile-full {
  @media (max-width: ($bp-tablet - 1px)) {
    @content;
  }
}
```

Why a new mixin vs reusing `respond-below($bp-tablet)`: it reads better semantically and we can later attach a TS-side `BreakpointObserver` (e.g. `isMobile`) that matches the same query, keeping HTML/SCSS/TS in sync as we do for `isMobilePortrait`.

### Layout shape per breakpoint

| Range | Layout | Header | Filters | Toggle GRID/LIST |
|---|---|---|---|---|
| **< 768px** (mobile, any orientation) | Single column, full-bleed grid | Title + favorites only — **no search-bar** | FAB → bottom-sheet (contains search-bar + filters) | Hidden, mode forced to GRID at render |
| 768-1023px (tablet) | 2-col (sidebar 240-280px + main) | Title + search-bar + toggle + favorites | Sidebar always visible | Visible |
| ≥ 1024px (desktop) | 2-col (sidebar 280px + main) | Title + search-bar + toggle + favorites | Sidebar always visible | Visible |
| **Mobile landscape 576-767** in deck-build mode | Keep `landscape-split` (slide-in side sheet) — **unchanged** | — | — | — |

The `landscape-split` deck-build path is **out of scope** for this spec — it works, and the dual-pane case has different ergonomic needs (drag-into-deck).

### Mobile (< 768px) — detailed behaviour

#### Header
- Visible: title icon + `<h1>`Recherche de cartes`</h1>` + subtitle (result count) + favorites star.
- Hidden: search-bar, GRID/LIST toggle.
- Padding compact: `var(--space-3) var(--space-3) var(--space-2)`.
- Background: same `screen-bg` + glows as desktop.

#### Body
- `__sidebar`: `display: none`.
- `__body`: `grid-template-columns: 1fr; padding: 0`.
- `__main`: full-width, no gap from outer padding.
- `__count`: hidden in header position, **moved** to a thin row above the grid (mockup-faithful) OR shown as part of the FAB sheet header (TBD during implementation — both readable).
- `__results`: edge-to-edge grid `grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))` with `gap: var(--space-2)`, padding `0 var(--space-3)`.

#### FAB
- `display: flex` for `mobile-full` (current rule is portrait-only).
- Position: `fixed; bottom: var(--space-4); right: var(--space-4)`.
- Aria-label: `'cardSearcher.searchAndFilters'` (new i18n key, FR `"Recherche et filtres"`, EN `"Search and filters"`).
- Badge: optional dot if `numberOfActiveFilters > 0`, gold glow.

#### Bottom-sheet (the only filter surface on mobile)
- `app-bottom-sheet { display: block }` for `mobile-full` (current rule is portrait-only). Drop the legacy `__external-filters` variant from this page — it was the unreached fallback.
- Content order inside the sheet:
  1. Sheet drag handle.
  2. Sheet header: title `Filtres` + `Effacer (n)` button (existing `filter-panel-header`).
  3. **Search-bar** (full-width, `min-width: 0`, autofocus when sheet opens via FAB tap).
  4. `app-card-filters` (existing component, scrollable).
- Initial state: `searchPanelOpened = signal(false)` (was `true`). User taps FAB to open.
- Snap: default `'half'`, can drag to `'full'`.

#### Grid mode forced
- Even if `cardSearchService.displayMode() === LIST`, the grid renders as GRID on mobile.
- This is **already partially done** in `card-list.component.scss:25-30`, `79-94`, `145-147` via `mobile-portrait`. Extend all three to `mobile-full`.
- The signal value is **not** mutated — user's desktop preference is preserved for when they go back to a larger viewport.

### Tablet & Desktop — unchanged

The existing layout above 768px is correct. Only mobile (< 768px) gets touched.

---

## Implementation plan

### Phase 1 — Responsive infrastructure (S)

1. **`front/src/app/styles/_responsive.scss`**: add `mobile-full` mixin (above). Document in comment block that this is the page-level mobile gate for card-search.
2. **`front/src/app/services/navbar-collapse.service.ts`**: add `isMobile = toSignal(BreakpointObserver.observe('(max-width: 767px)'))` alongside the existing `isMobilePortrait`. Keep both — `isMobilePortrait` stays for the bottom-sheet page-level wiring elsewhere.

Note: don't replace `isMobilePortrait` with `isMobile` globally — bottom-sheets on Track A pages (Simulator, Deck Builder) intentionally only fire on portrait. Each page picks its own gate.

### Phase 2 — card-search-page (M)

#### HTML (`card-search-page.component.html`)
- Wrap the `<div class="card-search-page__bar">` block in `@if (!isMobile()) { ... }` to remove the search-bar + toggle + favorites row from the header on mobile.
- Add a mobile-only header tail showing favorites + result count:
  ```html
  @if (isMobile()) {
    <div class="card-search-page__mobile-meta">
      <span class="card-search-page__count">{{ resultsLabel() }}</span>
      <button class="card-search-page__favorite ..."><mat-icon>...</mat-icon></button>
    </div>
  }
  ```
- Bottom-sheet wiring: change `[opened]="searchPanelOpened() && isMobilePortrait()"` to `[opened]="searchPanelOpened() && isMobile()"`. The sheet content gains the search-bar:
  ```html
  <app-bottom-sheet ...>
    <div class="card-search-page__sheet">
      <search-bar
        [form]="cardSearchService.filterForm.controls.name"
        [searchService]="cardSearchService"
        [showFilters]="false">
      </search-bar>
      <app-card-filters [searchService]="cardSearchService"></app-card-filters>
    </div>
  </app-bottom-sheet>
  ```
- Remove the now-dead `__external-filters` sheet block (was unreachable from this page anyway).
- FAB: aria-label key change → `'cardSearcher.searchAndFilters'`.

#### TS (`card-search-page.component.ts`)
- Add `readonly isMobile = this.navbarCollapseService.isMobile;` (new signal).
- `searchPanelOpened = signal(false)` (was `true`).
- Remove `externalFiltersOpened`, `isCompactHeight`, `isLandscapeSplit`, `useExternalFilters`, `onFiltersExpanded()`. The compact-height variant was speculative; it's not connected to any UI gesture on this page. (Verify no other component reads them — `Grep` first.)
- Reduces 5 reactive fields → 2 (`isMobile`, `searchPanelOpened`).

#### SCSS (`card-search-page.component.scss`)
- Replace `@include r.mobile-portrait` blocks for `__sidebar`, `__body`, `__fab`, `app-bottom-sheet`, `app-card-inspector` with `@include r.mobile-full`.
- Add `.card-search-page__mobile-meta` styles (row, space-between, padding consistent with header compact).
- Delete `.card-search-page__external-filters` block.

### Phase 3 — card-searcher embed (S)

The `card-searcher` component is used in deck-build mode (split-screen). It has its own header bar with the toggle. **Different rules apply** because deck-build landscape-split is a real two-pane use case.

- `card-searcher.component.scss:118` (`.cardSearchPage-searcher-view-group`) — change `mobile-portrait` → `mobile-full`. The toggle is just as useless in deck-build landscape mobile as on the page.
- The favorite button stays visible — single icon, fits anywhere.

### Phase 4 — card-list (S)

`card-list.component.scss`:
- l. 25-30 (`&.LIST` fallback in container): `mobile-portrait` → `mobile-full`.
- l. 79-94 (`.card-wrapper.LIST` mobile reset): `mobile-portrait` → `mobile-full`.
- l. 145-147 (`.card-info` hide): `mobile-portrait` → `mobile-full`.

### Phase 5 — i18n (XS)

Add to `front/src/assets/i18n/{fr,en}.json` under `cardSearcher`:
- `searchAndFilters`: `"Recherche et filtres"` / `"Search and filters"`

### Phase 6 — Tests & validation (M)

Test viewports (Playwright e2e or manual):
- iPhone SE portrait 375×667
- iPhone 14 Pro portrait 393×852
- iPhone 14 Pro landscape 852×393 ← **previously broken**
- iPad mini portrait 768×1024 (must remain desktop layout)
- iPad mini landscape 1024×768
- Desktop 1440×900

Acceptance criteria per viewport:
- AC1 — Filters accessible via FAB or sidebar (no dead-end).
- AC2 — Search-bar editable without overflow.
- AC3 — No GRID/LIST toggle visible below 768px.
- AC4 — Cards render in GRID layout below 768px, even if `displayMode === LIST`.
- AC5 — Bottom-sheet renders inside the viewport (no clipping above or below).
- AC6 — Tap targets ≥ 44×44px (NFR12).
- AC7 — A11y: sheet open announces "Filtres ouverts" via `aria-live`; FAB has descriptive label.

---

## Out of scope (deliberate)

- **Deck-build mode landscape-split**: untouched. The two-pane experience exists for a reason (drag from search into deck without losing context). Different problem, different spec ([[deck-flow-filters-spec-2026-05-17]]).
- **Tablet (768-1023) refinements**: sidebar at 280px is OK here. Could be tightened to 240px in a later polish pass.
- **Card inspector mobile UX**: out of scope — covered by [[card-inspector-premium-spec]] (deferred).
- **Tablet landscape iPad pro fallback**: > 1024 = desktop, fine.
- **Bottom-sheet swipe gestures rework**: existing drag-to-snap is fine.

---

## Risks & open questions

| Risk | Mitigation |
|---|---|
| Removing `useExternalFilters` breaks another caller | Grep across `front/src/` — this signal & method should only exist on `card-search-page.component.ts`. Confirmed by spec author; double-check before merging. |
| `isMobile` BreakpointObserver doesn't fire on initial load | Use `toSignal(... , { initialValue: window.matchMedia(...).matches })` to seed correctly. |
| Mobile user-agent that reports orientation but not consistent with width | Rely on `(max-width: 767px)` only — never read `window.orientation`. Width is the truth. |
| Landscape mobile may regress on tablets PWA-mode (Surface 8" landscape) | Not in supported matrix. Skytrix targets phones + tablets + desktop; weird PWA cases aren't a priority. |

## Effort estimate

| Phase | Effort |
|---|---|
| 1. Responsive infra | ~30 min |
| 2. card-search-page (HTML + TS + SCSS) | ~2h |
| 3. card-searcher | ~30 min |
| 4. card-list | ~30 min |
| 5. i18n | ~10 min |
| 6. Tests + manual viewport sweep | ~1h30 |
| **Total** | **~5h** |

Implementation handoff: Amelia (`bmad-dev-story` or `bmad-quick-dev` with this spec as input).

---

## Appendix — Why mobile-full instead of extending mobile-portrait

`mobile-portrait` is used across Track A pages (Simulator, Deck Builder) to gate the bottom-sheet versus side-pane behaviour. Those pages **intentionally** keep landscape-split behaviour (two panels side by side) because the canvas-scaling layout makes it work.

`card-search-page` is **Track B** (responsive CSS, not canvas-scaled). It has no two-pane mode of its own — the search results don't compose with anything else on screen. So the orientation distinction is artificial here. Picking the right tool: `mobile-full` for Track B page-level layouts, `mobile-portrait` for Track A bottom-sheets. Both stay in the codebase; they answer different questions.
