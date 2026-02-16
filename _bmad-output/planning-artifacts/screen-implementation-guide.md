# Screen Implementation Guide — Skytrix

> This document complements the **UX Design Specification**. It provides per-screen implementation decisions, key files, and regression risks. For design system tokens, component patterns, and interaction rules → see `ux-design-specification.md`.

Per-screen audit at 3 breakpoints (mobile portrait, mobile landscape, desktop). Each screen is analyzed for visual inconsistencies, anti-patterns, and modernization opportunities.

---

## Global Decisions

### Palette — Semantic Tokens

Replace raw color variables in `variable.scss` with CSS custom properties on `:root`:

| Token | Proposed Value | Usage |
|-------|---------------|-------|
| `--surface-base` | `#121212` | Main background |
| `--surface-card` | `#1E1E1E` | Card surfaces, form field backgrounds |
| `--surface-card-hover` | `#252525` | Card hover state |
| `--surface-elevated` | `#1E293B` | Elevated panels, hover states in overlays |
| `--surface-nav` | `#161616` | Sidebar / toolbar |
| `--accent-primary` | `#C9A84C` | Gold accent (Millennium theme) |
| `--accent-primary-dim` | `#C9A84C33` | Accent at 20% for subtle backgrounds |
| `--text-primary` | `#EAEAEA` | Primary text |
| `--text-secondary` | `#9E9E9E` | Secondary text (metadata) |
| `--danger` | `#CF6679` | Destructive actions (Material dark error) |

Raw colors ($red, $blue, etc.) remain defined but are no longer used directly in components.

#### Migration Mapping

| Old SCSS Variable | Context | New Token |
|-------------------|---------|-----------|
| `$black` (#303030) | Text on light backgrounds | `--text-primary` (#EAEAEA) |
| `$white` (#fff) | Borders, card backgrounds | `--surface-card` / removed |
| `$blue` (#93dafa) | Accent, active states, badges | `--accent-primary` (#C9A84C) |
| `$red` (#a30000) | Destructive actions | `--danger` (#CF6679) |
| `$grey` (#a0a0a0) | Secondary text, metadata | `--text-secondary` (#9E9E9E) |
| `$green` (#00b451) | Valid count indicator | Kept as-is (no token needed) |
| `$purple`, `$orange`, `$yellow` | Unused in redesigned screens | Kept in variable.scss, no migration |
| `$unselected-black` | Low-opacity overlay | Replaced by `--accent-primary-dim` where applicable |

Migration is **incremental per screen** — not a big-bang refactor. Each screen edit introduces the tokens it needs.

### Sidebar & Toolbar — Dark Theme

- Replace `linear-gradient(rgb(240,240,240), rgb(220,220,220))` with `--surface-nav`
- Applies to: desktop sidebar, mobile top bar, mobile drawer
- Text color: `--text-primary` (was $black)
- Nav items: icon + label, hover = `--surface-card` background (150ms ease)
- Active item: 3px left border `--accent-primary` + `--accent-primary-dim` background
- User section at bottom: avatar icon, dropdown menu for logout
- Unifies the entire app under a cohesive dark theme

---

## Screen 1: Decklist

### Screenshots

- `decklist_d.PNG` — Desktop
- `decklist_m.PNG` — Mobile portrait
- `decklist_ml.PNG` — Mobile landscape

### Key Files

| File | Role |
|------|------|
| `front/src/app/pages/deck-page/components/deck-list/deck-list.component.html` | Grid template |
| `front/src/app/pages/deck-page/components/deck-list/deck-list.component.scss` | Grid layout + delete button |
| `front/src/app/components/deck-box/deck-box.component.html` | Deck card template |
| `front/src/app/components/deck-box/deck-box.component.scss` | Deck card styles + fan-out animations |
| `front/src/app/components/navbar/navbar.component.scss` | Sidebar & mobile bar styles |
| `front/src/app/styles/variable.scss` | Color palette |
| `front/src/app/styles/_responsive.scss` | Breakpoints & mixins |

### Issues Found

| # | Issue | Severity | Current Code |
|---|-------|----------|-------------|
| 1 | White wireframe border on cards | High | `border: 1px solid $white` (deck-box.scss:8) |
| 2 | Asymmetric border-radius looks "cut" | Medium | `border-radius: 20px 0 20px 0` (deck-box.scss:9) |
| 3 | Delete button is most prominent element (red circle, z-index 1010, no confirmation) | Critical | deck-list.scss:21-35 |
| 4 | Create button cyan disconnected from palette | High | `color: $blue` (#93dafa), `scale(4)` (deck-box.scss:65-86) |
| 5 | Sidebar light gradient clashes with dark content | High | `linear-gradient(rgb(240), rgb(220))` (navbar.scss:13) |
| 6 | Mobile top bar same light gradient | High | navbar.scss:119 |
| 7 | No empty state (0 decks) | Medium | Template only has *ngFor |
| 8 | No hover affordance beyond fan-out | Medium | No elevation/shadow transitions |
| 9 | Color variables lack semantic hierarchy | Medium | variable.scss — raw colors only |
| 10 | Fan-out card previews invisible on mobile (no hover) | High | Fan-out relies on :hover CSS |

### Decisions Made

#### Deckbox Image
- **KEEP the deckbox** image on both desktop and mobile
- Desktop: fan-out animation on hover remains as-is (size, zone, behavior untouched)
- Mobile: no fan-out (no hover event), deckbox displayed as-is

#### Deck Card Redesign

- No border — use `background: --surface-card` + `border-radius: 12px` + `box-shadow` (0 2px 8px rgba(0,0,0,0.3))
- Hover (desktop): elevation increases, bg shifts to `--surface-card-hover`, 150ms transition
- Delete: subtle `mat-icon-button` (trash icon) top-right, `--danger` color, confirmation dialog before deletion
- Whole card surface is clickable → opens deck
- No metadata changes (ShortDeckDTO stays as {id, name, urls})

#### Create Button
- Ghost card first in grid on all breakpoints, `dashed 2px --accent-primary-dim` border, `+` icon in `--accent-primary`

#### Layout (already correct in code)
- Mobile < 576px: 1 column
- Tablet 576-1023px: 2 columns
- Desktop >= 1024px: `auto-fill, minmax(225px, 1fr)`

#### Empty State (0 decks)
- Centered illustration + "Aucun deck pour le moment" + CTA button "Créer un deck"

#### Interactions

| Interaction | Behavior |
|-------------|----------|
| Hover card (desktop) | Elevation up, bg lightens, 150ms ease |
| Fan-out (desktop) | Keep existing animation as-is |
| Tap card (mobile) | Material ripple |
| Delete (trash icon) | `$event.stopPropagation()` + confirmation dialog |

---

## Screen 2: Recherche de cartes

### Screenshots

- `recherche_carte_d.PNG` — Desktop
- `recherche_carte_m.PNG` — Mobile portrait
- `recherche_carte_ml.PNG` — Mobile landscape

### Key Files

| File | Role |
|------|------|
| `front/src/app/pages/card-search-page/card-search-page.component.*` | Search page entry point |
| `front/src/app/components/card-searcher/card-searcher.component.*` | Main layout (search bar + grid + filters) |
| `front/src/app/components/search-bar/search-bar.component.*` | Search input + filter toggle |
| `front/src/app/components/card-list/card-list.component.*` | Card grid/list (4 display modes) |
| `front/src/app/components/card-filters/card-filters.component.*` | Filter panel + sub-components |
| `front/src/app/components/card/card.component.*` | Individual card display |
| `front/src/app/components/card-inspector/card-inspector.component.*` | Card detail modal |
| `front/src/app/services/search-service-core.service.ts` | Search logic, infinite scroll, API |
| `front/src/app/core/enums/card-display-type.ts` | MOSAIC, INFORMATIVE, OWNED, FAVORITE |

### Issues Found

| # | Issue | Severity | Current Code |
|---|-------|----------|-------------|
| 1 | Search bar white on dark background — harsh flash | High | Default mat-form-field white bg |
| 2 | View mode toggles: tiny icons, no labels/tooltips, "store" icon unintuitive | Medium | 4 mat-icon buttons, active = $blue |
| 3 | Card grid too dense: full card images illegible at 85px | High | `minmax(85px, 1fr)`, gap: 0.5em (card-list.scss) |
| 4 | No loading indicator for infinite scroll | High | Scroll listener in search-service-core, no spinner |
| 5 | Mobile landscape: too much vertical space consumed by top bar + search + toggles (~148px) | Medium | Stacked: top-bar 48px + search ~56px + toggles ~44px |
| 6 | Filter panel transition too slow on mobile | Low | `transition: transform 0.5s ease-out` (card-searcher.scss) |
| 7 | Filter badge small and easy to miss | Low | 21px circle, $black bg, $blue border (search-bar.scss) |

### Decisions Made

#### Search Bar
- Background `--surface-card` (#1E1E1E) instead of white
- Text `--text-primary`, placeholder `--text-secondary`
- Subtle border, focus state in `--accent-primary` (gold)
- Filter badge in `--accent-primary` instead of $blue

#### View Mode Toggles
- `mat-button-toggle-group` compact with tooltips
- Active state: `--accent-primary-dim` background + `--accent-primary` icon
- **Replace** `store` icon with `style` (overlapping cards) for "Mes cartes"

#### Card Grid (Mosaic)
- **Standalone search page**: increase `minmax` from 85px to 100px for better readability
- **Deck builder side panel**: keep 85px (side panel is only 280-360px wide, 100px would leave only 2 columns)
- Increase `gap` from 0.5em to 0.75em for breathing room
- Keep full card images (no cropped artwork)
- No tooltip on hover

#### Infinite Scroll
- Add spinner/skeleton row at bottom during loading
- "Fin des résultats" message when no more cards

#### Mobile Landscape
- **Merge toggles into search bar row** (Option A chosen)
- Layout: `[🔍 input.........] [≡ ⊞ 🃏 ⭐] [⚙️]` on a single line
- Use existing `landscape-split` mixin, CSS-only change
- Saves ~44px vertical space (one extra card row visible)

#### Filter Panel (Mobile)
- Speed up transition from 0.5s to 0.3s ease-out

#### Card Inspector
- Already well-styled (dark theme, 12px radius, proper structure)
- Use as **visual reference** for styling other components

---

## Screen 3: Deck Builder

### Screenshots

- `deckbuilder_d.PNG` — Desktop
- `deckbuilder_m.PNG` — Mobile portrait
- `deckbuilder_ml.PNG` — Mobile landscape
- `deckbuilder_masterduel.jpg` / `deckbuilder_masterduel_desktop.PNG` — Master Duel reference

### Key Files

| File | Role |
|------|------|
| `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.*` | Main split layout, modals, hand test |
| `front/src/app/pages/deck-page/components/deck-builder/components/deck-viewer/deck-viewer.component.*` | MAIN/EXTRA/SIDE sections + headers |
| `front/src/app/components/deck-card-zone/deck-card-zone.component.*` | Card grid (5/10 col) + CDK drag-drop |
| `front/src/app/pages/deck-page/components/deck-builder/components/hand-test/hand-test.component.*` | Hand test overlay |
| `front/src/app/components/card-searcher/card-searcher.component.*` | Reused in deckBuildMode=true |
| `front/src/app/services/deck-build.service.ts` | Deck data, add/remove/reorder cards |

### Issues Found

| # | Issue | Severity | Current Code |
|---|-------|----------|-------------|
| 1 | Deck name input white on dark | High | White mat-form-field (side panel header + mobile header) |
| 2 | Section headers (MAIN/EXTRA/SIDE) blend into background | High | `rgba(0,0,0,0.3)` on dark bg (deck-viewer.scss) |
| 3 | No strong visual separation between deck zones | High | Zones stacked with minimal spacing |
| 4 | Side panel header cluttered (name + save + menu + preview + search + toggles) | Medium | Desktop side panel header area |
| 5 | Mobile landscape split 55/45 too compressed | Medium | Both sides barely legible |
| 6 | Mobile portrait search = full overlay, loses deck context | Medium | `translateX(100%)` → full width |
| 7 | Count badge small and discreet | Low | Small colored number next to section label |

### Existing Good Patterns (keep as-is)

- FAB search toggle on mobile portrait
- CDK drag-drop from search to deck zones
- Double-click with fly animation to add cards
- Right-click to remove (power user shortcut)
- Hand test overlay (slide-up, shuffle, toggle first/second)
- Card inspector in `dismissable` mode with add/remove controls
- Deck card zone grid: 5 col mobile / 10 col desktop

### Decisions Made

#### Inputs
- Same treatment as Screen 2: background `--surface-card`, focus `--accent-primary`

#### Section Headers (MAIN / EXTRA / SIDE)
- Opaque background `--surface-nav` instead of `rgba(0,0,0,0.3)`
- Label uppercase bold + count badge as pill (e.g., `MAIN  [38]`)
- 3px left border in `--accent-primary` to mark section
- **Sticky on scroll** so user always knows which zone is visible
- Count color: `--danger` when illegal (main < 40), `--accent-primary` when valid

#### Zone Separation
- `margin-top: 1rem` between MAIN→EXTRA and EXTRA→SIDE

#### Side Panel Header (Desktop)
- "Aperçu du deck" section made collapsible (chevron toggle)
- Deck name + save + menu on a single compact line

#### Mobile Landscape
- Merge toggles into search bar row (same as Screen 2)
- Deck name in collapsed mode: text only, tap to edit inline

#### Mobile Portrait — Deck Name
- Deck name in collapsed mode: text only, tap to edit inline (same as landscape)

#### Mobile Portrait Search
- **Bottom sheet** instead of full overlay
- Snap points: **60% height** (default), **100%** on drag up, **dismiss** on drag down
- Drag handle at top of sheet
- Top of deck remains visible at 60%
- Custom component (no new dependency — built with CDK touch/drag or vanilla pointer events)

---

## Screen 4: Simulateur

### Screenshots

- `simulateur_d.PNG` — Desktop
- `simulateur_m.PNG` — Mobile portrait
- `simulateur_ml.PNG` — Mobile landscape
- `simulateur_masterduel.jpg` / `simulateur_masterduel_desktop.jpg` — Master Duel reference

### Key Files

| File | Role |
|------|------|
| `front/src/app/pages/simulator/simulator-page.component.ts` | Entry point, scopes BoardStateService + CommandStackService |
| `front/src/app/pages/simulator/board.component.*` | Master grid layout (1060×772), scaling, keyboard shortcuts |
| `front/src/app/pages/simulator/zone.component.*` | Single-card zones (monster, S/T, field spell) |
| `front/src/app/pages/simulator/stacked-zone.component.*` | Pile zones (deck, GY, banish, extra deck) |
| `front/src/app/pages/simulator/hand.component.*` | Fanned hand with CSS fan algorithm |
| `front/src/app/pages/simulator/control-bar.component.*` | Undo/Redo/Reset floating pill |
| `front/src/app/pages/simulator/pile-overlay.component.*` | Browse/Search/Reveal overlay |
| `front/src/app/pages/simulator/xyz-material-peek.component.*` | XYZ materials panel |
| `front/src/app/pages/simulator/_sim-tokens.scss` | Simulator-specific design tokens |
| `front/src/app/pages/simulator/board-state.service.ts` | Zone state signals |
| `front/src/app/pages/simulator/command-stack.service.ts` | Undo/redo history |

### Existing Good Patterns (keep as-is)

- Fixed 1060×772 grid with dynamic `transform: scale()` — clean approach
- Hand fan algorithm with CSS custom properties (--fan-x, --fan-y, --fan-rotation)
- Hand hover: lift -24px + scale 1.08
- Zone borders: subtle cyan rgba(#00d4ff, 0.15), highlight on drop, gold glow on success
- Control bar: frosted glass (backdrop-filter: blur(8px)), pill shape
- Pile overlay: compact 72px → expanded 250px on search
- CDK drag-drop with canDrop predicates, context menus
- Deck shake animation on empty deck click
- Card inspector on desktop: `dismissable` mode, positioned left — unchanged

### Issues Found

| # | Issue | Severity | Current Code |
|---|-------|----------|-------------|
| 1 | Sidebar light clashes with dark navy board — worst immersion break in app | Critical | Same light gradient as other screens |
| 2 | Mobile portrait: dead space below the board (portrait taller than 1060×772 ratio) | High | Board scaled + anchored to top |
| 3 | "U:0 R:0" debug counter behind `isDevMode` — cosmetic cleanup | Low | control-bar.component, guarded by isDevMode |
| 4 | No labels on empty zones (removed due to drag bugs) | Medium | Previously existed, removed |
| 5 | Landscape top bar consumes space on immersive game screen | Medium | 48px mobile-top-bar always visible |
| 6 | Sim tokens separate from global tokens — dual system | Low | _sim-tokens.scss independent from variable.scss |

### Decisions Made

#### Sidebar
- Dark theme (global decision) — resolves critical immersion break

#### Mobile Portrait Layout
- **Board anchored at bottom** of viewport (thumb-friendly for touch interaction)
- **Card inspector at the top** as overlay on card click (eye-level, no reach needed)
- On screens with enough space: inspector floats above the board naturally
- On smaller screens: inspector stays as floating overlay at top

```
┌──────────────────┐
│ [Card Inspector]  │  ← Appears on card click, top overlay
│                   │
│                   │
│                   │
│   ┌───────────┐   │
│   │   Board    │   │  ← Board anchored to bottom
│   │  (scaled)  │   │
│   │ [hand fan] │   │
│   └───────────┘   │
│           [⟳ ↩ ↪] │  ← Control bar
└──────────────────┘
```

#### Desktop Layout
- Unchanged — board centered, inspector `dismissable` positioned left

#### Debug Counter
- Remove entirely

#### Zone Labels
- Reimplement labels on empty zones (e.g., "GY", "Banish", "ED", "Deck", "Field")
- Style: `--text-secondary` at ~0.65rem, disappears when card is placed
- Implementation: `pointer-events: none` + low `z-index` to avoid CDK drag interference

#### Landscape Navigation
- **Hide top bar in landscape only** in simulator (immersive mode)
- Add **back/exit button** to the control bar pill (top position, visually separated):

```
┌─────┐
│  ←  │  Back to deck builder (/decks/:id)
├─────┤
│  ↩  │  Undo
│  ↪  │  Redo
│  ⟳  │  Reset
└─────┘
```

- No quit confirmation needed (state is ephemeral by design)

#### Token Architecture
- **Unified global tokens** in `_tokens.scss` with CSS custom properties on `:root`
- Simulator **overrides only what differs** via scoped `:host` properties:
  - `--surface-base: #0a0e1a` (navy instead of #121212)
  - `--accent-primary: #00d4ff` (cyan instead of gold)
- Shared values (text colors, danger, `--surface-elevated`) inherit from global — zero duplication
- Migrate `_sim-tokens.scss` to reference global tokens + sim-specific overrides only

#### XYZ Material Peek

**Existing Implementation (keep as-is):**
- `SimXyzMaterialPeekComponent` — side pill overlay, right-aligned, 240px wide
- CDK drag sources for each material → detach to any board zone
- Auto-close when last material detached (signal-driven `effect()`)
- Click-outside and Escape to dismiss
- `cdkDragPreviewContainer: 'global'` for correct z-index during drag
- `noDrop` predicate prevents re-dropping onto pill
- Material border peek (2-3px offset per material below XYZ card)

**Issues:**

| # | Issue | Severity |
|---|-------|----------|
| 1 | Uses `$sim-*` tokens directly — needs migration to global tokens + sim overrides | Medium |
| 2 | Positioned absolute right — may clip on mobile portrait if board is narrow | Medium |
| 3 | `@media (prefers-reduced-motion)` block in SCSS — remove | Low |

**Decisions:**
- Migrate `$sim-surface`, `$sim-zone-border`, `$sim-radius-zone`, `$sim-surface-elevated` to global tokens (sim overrides via `:host`)
- Mobile portrait: pill positioned **above the board** (top overlay) instead of right, matching inspector placement strategy
- Remove `@media (prefers-reduced-motion)` block from component SCSS

---

## Regression Risk Analysis

### Risk by Change

#### Global — Token System
| Risk | Detail | Severity |
|------|--------|----------|
| Migration blast radius | Replacing SCSS vars ($red, $blue...) with CSS custom properties touches all components. Must add tokens in parallel, migrate component by component, remove old vars last. | Medium |
| Angular Material theming | mat-form-field, mat-button, mat-menu use Material's token system (`--mat-*`). Must override via Material API, not fragile `::ng-deep`. | Medium |

#### Global — Sidebar & Toolbar Dark
| Risk | Detail | Severity |
|------|--------|----------|
| Invisible text | Currently `$black` (#303030) text on light bg. If bg goes dark without migrating text → black on black. Affects: nav links, user pseudo, drawer title, drawer links. | Medium |
| Collapse toggle hardcoded bg | `background: rgb(230,230,230)` in navbar.scss:94. Must migrate. | Low |
| Hover state invisible | Current hover is `rgba(59,59,59,0.048)` — designed for light bg. Invisible on dark. Must replace. | Medium |

#### Screen 1 — Decklist
| Risk | Detail | Severity |
|------|--------|----------|
| Border removal breaks hover feedback | Current hover (`border-color: $blue`, deck-box.scss:52-54) relies on border. New hover (elevation + bg) must replace it. | Medium |
| Trash icon stopPropagation | `mat-icon-button` click must not trigger card navigation. Use `$event.stopPropagation()`. | Low |

#### Screen 2 — Recherche de cartes
| Risk | Detail | Severity |
|------|--------|----------|
| Search bar shared component | Style changes affect both search page AND deck builder. Clear button (X), search icon, badge all need light color variants. Test both contexts. | Medium |
| Grid minmax conditional | card-list is shared. Need mechanism to apply 100px standalone vs 85px in deck builder. Use existing `deckBuildMode` input as CSS class discriminant. If wrong, deck builder side panel grid breaks. | **High** |
| Toggles → mat-button-toggle-group | Template change — event handlers must be reconnected. `displayMode` signal must feed from toggle group value. | Medium |
| Merge toggles in search bar (landscape) | Toggles are in card-searcher.component.html, search bar is a child component. Same-line layout requires template restructuring or CSS hack (`display: contents` + grid). If wrong, portrait layout breaks too. | Medium |
| Infinite scroll loading signal | search-service-core has no `loading` signal. Adding one requires tracking request lifecycle. If mis-synced, spinner stays visible or never appears. End-of-results detection: API returns < 60 items. | Medium |

#### Screen 3 — Deck Builder
| Risk | Detail | Severity |
|------|--------|----------|
| Sticky headers | `position: sticky` requires no `overflow: hidden` ancestor. `.deckBuilder-canvasParent` has `overflow: auto` (OK). z-index must be > cards but < modals/inspector. | Medium |
| Deck name collapsed tap-to-edit | Currently a mat-form-field with FormControl that auto-saves. Collapsed mode needs: display text → tap → show input + focus → blur/Enter → back to text + save. Risk: blur triggers save before user finishes typing. Debounce needed. | Medium |
| **Bottom sheet (custom component)** | **HIGHEST RISK in entire audit.** Critical points: | **High** |
| | - CDK drag-drop from sheet to deck zones must cross sheet boundary → test `cdkDropListGroup` coverage | |
| | - Virtual keyboard on mobile pushes viewport → sheet must handle resize (`visualViewport` API) | |
| | - Snap points require pointer event tracking (touchstart/move/end) + velocity calculation | |
| | - z-index: above FAB search, below card inspector | |
| | - No new dependency allowed → fully custom build | |

#### Screen 4 — Simulateur
| Risk | Detail | Severity |
|------|--------|----------|
| Board bottom anchor | `transform-origin` changes from `top center` to `bottom center`. Hand ends up at viewport edge — verify thumb margin. Control bar (fixed bottom-right) may overlap hand area. | Medium |
| Inspector top (mobile portrait) | card-inspector `position` input only supports 'left' \| 'right'. Must add 'top' option. Inspector must not cover Extra Monster zones. | Medium |
| Zone labels (drag bug history) | Previously removed due to CDK drag bugs. Fix: `pointer-events: none` + low z-index. CDK uses `document.elementFromPoint()` — transparent labels should not interfere. **Must test drag operations thoroughly.** | **High** |
| Hide top bar (landscape sim) | Navbar uses global `isMobile` signal. Simulator-specific "immersive mode" needs a service signal. Risk: if signal not cleaned up on `OnDestroy` → top bar disappears everywhere. | Medium |
| Token migration sim | ~15 $sim-* variables to map to global tokens. Mechanical but error-prone on the most polished screen. Cyan `#00d4ff` used for zone-border, zone-highlight, accent, overlay-border. Gold `#d4a017` is ONLY for glow-success — do NOT confuse with global gold accent `#C9A84C`. | Medium |
| XYZ peek mobile positioning | Pill positioned right (absolute) clips on narrow mobile portrait boards. Must switch to top overlay. | Medium |

### Risk Summary

| Level | Changes |
|-------|---------|
| **High** | Bottom sheet (custom component), Grid minmax conditional (shared component), Zone labels simulator (historical drag bug) |
| **Medium** | Sidebar dark (invisible text), Search bar shared, Toggles landscape (template restructure), Board bottom + inspector top, Deck name collapsed, Hide top bar sim, Token migration sim, XYZ peek mobile positioning |
| **Low** | Empty state, Zone separation margin, Filter transition speed, Debug counter cleanup, Side panel collapsible, Collapse toggle bg, Trash icon stopPropagation |

### Recommended Implementation Order (risk-minimized)

| Step | Change | Rationale |
|------|--------|-----------|
| 1 | Global tokens (`_tokens.scss`) | Foundation — everything depends on it |
| 2 | Sidebar dark | Global, high visibility, validates tokens |
| 3 | Search bar dark | Shared component, validates Material theming approach |
| 4 | Deck card redesign (border, radius, hover, trash icon) | Contained to deck-box + deck-list |
| 5 | Grid minmax conditional | Shared component, test in both contexts |
| 6 | Deck builder headers + zone separation | Moderate risk |
| 7 | Deck name collapsed | New interaction pattern |
| 8 | Toggles landscape | Template restructuring |
| 9 | Simulator: board bottom + inspector top + labels | Test together as a batch |
| 10 | Simulator: XYZ peek mobile positioning | Test with board layout changes |
| 11 | Simulator: hide top bar + back button | Depends on immersive service |
| 12 | Simulator: token migration + remove prefers-reduced-motion | Mechanical but sensitive |
| 13 | Bottom sheet | Most complex — last, when everything else is stable |
| 14 | Infinite scroll indicator | Additive, can be done anytime |
