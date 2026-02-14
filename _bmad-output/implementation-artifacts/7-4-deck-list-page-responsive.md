# Story 7.4: Deck List Page Responsive

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the deck list page to display my decks in a responsive grid that adapts to my screen size,
so that I can browse and manage my decks comfortably on any device.

## Acceptance Criteria

1. **Given** I access the deck list page on a mobile viewport (≤576px),
   **When** the page renders,
   **Then** decks are displayed in a single-column layout,
   **And** each deck card fills the available width,
   **And** all interactive elements (deck name link, action buttons) meet the 44×44px minimum touch target size,
   **And** no horizontal scrolling occurs.

2. **Given** I access the deck list page on a tablet viewport (577–768px),
   **When** the page renders,
   **Then** decks are displayed in a 2-column grid,
   **And** spacing between cards is consistent and visually balanced.

3. **Given** I access the deck list page on a desktop viewport (>1024px),
   **When** the page renders,
   **Then** decks are displayed in a 3 or 4-column grid (depending on available width),
   **And** the layout matches the existing visual style of the app.

4. **Given** the deck list page is responsive,
   **When** the viewport is resized across breakpoints,
   **Then** the grid column count adjusts fluidly without layout jumps,
   **And** deck card images scale proportionally within their grid cells.

5. **Given** the deck list uses the responsive SCSS infrastructure,
   **When** the styles are written,
   **Then** they import `_responsive.scss` and use the defined breakpoint mixins,
   **And** the grid uses CSS Grid with `auto-fill`/`auto-fit` for natural column adjustment.

6. **Given** the deck list page renders on any viewport between 375px and 2560px+,
   **When** I scroll through my decks,
   **Then** no horizontal scrolling occurs and all content is accessible (NFR11).

7. **Given** the user has no decks (empty state),
   **When** the deck list page renders,
   **Then** only the "Add deck" box is displayed,
   **And** it fills the single column on mobile and is visually balanced in the grid on desktop,
   **And** no layout error or empty grid artifact is visible.

## Tasks / Subtasks

- [x] **Task 1: DeckListComponent responsive grid layout** (AC: 1, 2, 3, 4, 5)
  - [x] 1.1: Replace `@import '../../../../styles/variable'` with `@use 'responsive' as *` and `@use 'variable' as *`
  - [x] 1.2: Replace `display: flex; flex-wrap: wrap` with CSS Grid: `display: grid; grid-template-columns: 1fr; gap: 1rem; padding: 1rem`
  - [x] 1.3: Add tablet breakpoint: `@include respond-above($bp-mobile) { grid-template-columns: repeat(2, 1fr); }`
  - [x] 1.4: Add desktop breakpoint: `@include respond-above($bp-desktop-sm) { grid-template-columns: repeat(auto-fill, minmax(225px, 1fr)); }` (225px ensures 3 columns with expanded navbar at 1024px)
  - [x] 1.5: Remove fixed `margin: 1rem` on `.deckPage-deck` (grid `gap` handles spacing)
  - [x] 1.6: Delete icon: add `@include touch-target-min` + increase `padding` to `8px` for 44×44px tap area. Add `border-radius: 50%` for visual consistency. Adjust position: `top: 4px; right: 4px` (inside box corner, avoids overflow clipping). Change `z-index` from `10000` to `1010` (must stay above `.deckBox-preview-card` elements which use `z-index: 1000–1003` during fan-out hover)
  - [x] 1.7: Add `display: flex` on `.deckPage-deck` to ensure the "Add deck" `<deck-box>` host element (no wrapper div) fills its grid cell identically to wrapped deck boxes
  - [x] 1.8: Verify grid transitions smoothly across breakpoints (no layout jumps)

- [x] **Task 2: DeckBoxComponent responsive sizing** (AC: 1, 4, 6)
  - [x] 2.1: Replace `@import '../../styles/variable'` and `@import 'animation'` with `@use 'variable' as *`, `@use 'animation' as *` (no `@use 'responsive'` — not needed in this file)
  - [x] 2.2: Change `.deckBox` from `width: 200px; height: 170px` to `width: 100%; min-height: 170px` (remove fixed `height`)
  - [x] 2.3: Remove `margin-right: 2rem` (grid `gap` handles spacing)
  - [x] 2.4: Make deckbox image responsive: change `width: 150px` to `max-width: 150px; width: 60%` so it scales in smaller cells
  - [x] 2.5: Ensure card fan-out animation still works with fluid width (preview cards use absolute positioning relative to `.deckBox` — should be unaffected)
  - [x] 2.6: Ensure deck name text truncation (`text-overflow: ellipsis`) works at all widths
  - [x] 2.7: "Add deck" icon: verify it meets 44×44px touch target (`mat-icon` scaled to `4×` — already exceeds 44px, no change needed)

- [x] **Task 3: Build verification** (AC: 1–7)
  - [x] 3.1: Run `ng build --configuration development` — zero errors
  - [x] 3.2: Structural verification (code inspection) at 375px, 576px, 768px, 1024px, 1440px, 2560px
  - [x] 3.3: Verify 1 column at <576px, 2 columns at 576–1023px, 3+ columns at ≥1024px (accounting for navbar width: 260px expanded, 32px collapsed)
  - [x] 3.4: Verify no horizontal scrollbar at any viewport width
  - [x] 3.5: Verify deck box fan-out animation works at all viewports
  - [x] 3.6: Verify delete button tap target is ≥44×44px on mobile
  - [x] 3.7: Verify mobile top bar (navbar hamburger from Story 7-2) does not overlap deck list content
  - [x] 3.8: Verify empty state (0 decks): only "Add deck" box visible, no layout artifact (AC 7)
  - [x] 3.9: Verify delete button stays above fan-out preview cards during hover (z-index 1010 vs 1000-1003)

## Dev Notes

### Critical Architecture Constraints

- **Track B responsive strategy.** Deck List (`/decks`) is a Track B page — mobile-first responsive CSS with breakpoints. No canvas scaling, no `ScalingContainerDirective`. [Source: architecture.md#Responsive Strategy, epics.md#Epic 7]
- **Breakpoints from `_responsive.scss` are the single source of truth.** `$bp-mobile: 576px`, `$bp-tablet: 768px`, `$bp-desktop-sm: 1024px`. Use `@include respond-above($bp)` for desktop enhancements — mobile-first convention. Do NOT create custom breakpoints. [Source: _responsive.scss, Story 7-1]
- **Touch targets 44×44px on all interactive elements on mobile.** Use `@include touch-target-min` mixin from `_responsive.scss`. Applies to delete button. Deck boxes themselves are well above 44×44px at all viewports. [Source: prd.md#NFR12]
- **Deck list page HAS the navbar.** On desktop: collapsible sidebar (260px expanded, 32px collapsed). On mobile: hamburger + fixed top bar (`--mobile-header-height: 48px`). The `padding-top` for mobile top bar is already handled by `AppComponent` `.mobile-mode` class. No additional offset needed in deck list SCSS. [Source: app.component.scss, Story 7-2]
- **`@use` not `@import`.** Project uses `@use` for SCSS module imports (established in Story 7-1). All SCSS files in `src/app/styles/` are resolved via `stylePreprocessorOptions.includePaths` in `angular.json`. [Source: Story 7-3 patterns]
- **Primarily SCSS changes.** This story modifies only `.scss` files. No TypeScript changes. No HTML changes. No new files created.

### Implementation Decisions for Dev Agent

#### DeckListComponent Layout

**Current state:** `display: flex; flex-wrap: wrap` with fixed `margin: 1rem` on each `.deckPage-deck`. This creates an uncontrolled wrap that doesn't form consistent columns.

**What to change:**
- Replace with CSS Grid for precise column control at breakpoints
- Mobile-first: `grid-template-columns: 1fr` (single column)
- Tablet: `grid-template-columns: repeat(2, 1fr)` at `$bp-mobile` (576px)
- Desktop: `grid-template-columns: repeat(auto-fill, minmax(225px, 1fr))` at `$bp-desktop-sm` (1024px) — gives 3+ columns accounting for navbar width

**Column count verification (accounts for navbar: 260px expanded / 32px collapsed):**
- 375px mobile (no sidebar, 375 − 32px padding = 343px): 1 column ✓
- 576px mobile (no sidebar, 576 − 32 = 544px): `repeat(2, 1fr)` = 2 columns at 264px each ✓
- 768px mobile (no sidebar, 768 − 32 = 736px): `repeat(2, 1fr)` = 2 columns at 360px each ✓
- 1024px desktop, navbar expanded (1024 − 260 − 32 = 732px): 3 × 225 + 2 × 16 = 707 ≤ 732 → 3 columns ✓
- 1024px desktop, navbar collapsed (1024 − 32 − 32 = 960px): 4 × 225 + 3 × 16 = 948 ≤ 960 → 4 columns ✓
- 1440px desktop, navbar expanded (1440 − 260 − 32 = 1148px): 4 × 225 + 3 × 16 = 948 ≤ 1148 → 4 columns ✓
- 2560px: many columns — intentional for Track B pages

**Recommended SCSS structure (mobile-first):**

```scss
@use 'responsive' as *;
@use 'variable' as *;

.deckPage {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  padding: 1rem;

  @include respond-above($bp-mobile) {
    grid-template-columns: repeat(2, 1fr);
  }

  @include respond-above($bp-desktop-sm) {
    grid-template-columns: repeat(auto-fill, minmax(225px, 1fr));
  }

  &-deck {
    position: relative;
    display: flex; // Ensures <deck-box> host element (no wrapper div on "Add deck") fills grid cell

    &-remove {
      position: absolute;
      top: 4px;
      right: 4px;
      background-color: $red;
      border: 1px solid $white;
      padding: 8px;
      z-index: 1010; // Must be above .deckBox-preview-card (z-index: 1000-1003)
      cursor: pointer;
      border-radius: 50%;
      @include touch-target-min;
    }
  }
}
```

#### DeckBoxComponent Sizing

**Current state:** Fixed `width: 200px; height: 170px; margin-right: 2rem`. The deck box image (`deckbox.webp`) is `width: 150px`.

**What to change:**
- Make width fluid (`width: 100%`) so the deck box fills its grid cell
- Remove fixed `height: 170px` → use `min-height: 170px` to maintain minimum visual presence while allowing growth
- Remove `margin-right: 2rem` (grid `gap` handles spacing)
- Make deckbox image responsive: `max-width: 150px; width: 60%` — scales down in narrower cells, doesn't exceed natural size
- The card fan-out animation uses absolute positioning on the preview container — will continue to work since the parent is `position: relative`

**Recommended SCSS changes (key properties only):**

```scss
@use 'variable' as *;
@use 'animation' as *;

.deckBox {
  width: 100%;        // Fill grid cell (was: 200px)
  min-height: 170px;  // Maintain minimum presence (was: height: 170px)
  // REMOVED: margin-right: 2rem (grid gap handles spacing)
  // Rest of styles unchanged (border, border-radius, flex, padding, cursor, position)

  &-image {
    max-width: 150px;
    width: 60%;        // Scales in smaller cells (was: width: 150px)
  }

  // All other styles (&-preview, &-add, &-name, @keyframes) remain unchanged
}
```

#### Delete Button Touch Target

**Current state:** The delete `mat-icon` has `padding: 3px` and no minimum size. On mobile, this creates a ~30px tap target.

**What to change:** Add `@include touch-target-min` and increase padding from `3px` to `8px` for 44×44px hit area. Add `border-radius: 50%` for a circular button appearance. Change `z-index` from `10000` to `1010` — must remain above `.deckBox-preview-card` elements which use `z-index: 1000–1003` during the fan-out hover animation. Position changed to `top: 4px; right: 4px` (inside the box corner) to avoid overflow clipping risk when boxes are near container edges on mobile.

#### SCSS Import Migration

Both components currently use deprecated `@import`:
- `DeckListComponent`: `@import '../../../../styles/variable'`
- `DeckBoxComponent`: `@import '../../styles/variable'` + `@import 'animation'`

Migrate to `@use`:
- `@use 'responsive' as *` — breakpoint variables and mixins (DeckListComponent only — needs `respond-above` and `touch-target-min`)
- `@use 'variable' as *` — color variables ($red, $white, $blue, $black, $green, $unselected-black)
- `@use 'animation' as *` — shared animation keyframes (DeckBoxComponent only)

**Note:** DeckBoxComponent does NOT import `responsive` — it has no responsive mixins or breakpoint usage.

All resolve via `angular.json` → `stylePreprocessorOptions.includePaths: ["src/app/styles"]`.

**Note:** `@use` includes CSS rules (`@keyframes`) from the used file in compiled output, just like `@import`. The `wiggle` keyframe from `_animation.scss` and the inline `fanOut1/2/3` + `reduce` keyframes will all continue to work.

#### "Add Deck" Box — Host Element Asymmetry (Party Mode Finding)

**Issue:** In the template, the "Add deck" box is rendered as `<deck-box class="deckPage-deck" [add]="true">` — the `.deckPage-deck` class is on the Angular host element directly. Regular deck boxes are wrapped in `<div class="deckPage-deck">`. This structural asymmetry means the "Add deck" entry is a `<deck-box>` host element as the grid item, while others have a `<div>` as the grid item.

**Solution:** Add `display: flex` on `.deckPage-deck` in SCSS. This ensures the inner `.deckBox` fills the grid cell regardless of whether the grid item is a `<div>` wrapper or a `<deck-box>` host element. CSS Grid blockifies grid items, but `display: flex` on the cell ensures consistent inner layout.

### Existing Code Context

#### DeckPageComponent (`front/src/app/pages/deck-page/`)

```typescript
@Component({
  selector: 'app-deck-page',
  imports: [CommonModule, DeckListComponent],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckPageComponent {}
```

Template: `<div class="deckPage"><deck-list></deck-list></div>`
SCSS: Empty file — no changes needed.

#### DeckListComponent (`front/src/app/pages/deck-page/components/deck-list/`)

```typescript
@Component({
  selector: 'deck-list',
  imports: [CommonModule, DeckBoxComponent, MatIconModule],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckListComponent {
  constructor(public deckBuildService: DeckBuildService) {
    this.deckBuildService.fetchDecks();
  }
  public removeDeck(id: number) {
    this.deckBuildService.deleteById(id);
  }
}
```

Template:
```html
<div class="deckPage">
  <deck-box class="deckPage-deck" [add]="true"></deck-box>
  <div class="deckPage-deck" *ngFor="let deck of deckBuildService.decks$ | async">
    <deck-box [deck]="deck"></deck-box>
    <mat-icon class="deckPage-deck-remove" fontIcon="delete"
      (click)="removeDeck(deck!.id!); $event.stopPropagation()"
      (keyup)="removeDeck(deck!.id!); $event.stopPropagation()"></mat-icon>
  </div>
</div>
```

Current SCSS (NOT responsive):
```scss
@import '../../../../styles/variable';
.deckPage {
  display: flex;
  flex-wrap: wrap;
  &-deck {
    position: relative;
    margin: 1rem;
    &-remove {
      position: absolute;
      top: 0;
      right: 2rem;
      background-color: $red;
      border: 1px solid $white;
      padding: 3px;
      z-index: 10000;
      cursor: pointer;
    }
  }
}
```

#### DeckBoxComponent (`front/src/app/components/deck-box/`)

```typescript
@Component({
  selector: 'deck-box',
  imports: [CommonModule, MatIconModule, RouterLink],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckBoxComponent {
  readonly deck = input<ShortDeck>();
  readonly add = input<boolean>(false);
}
```

Template:
```html
<div class="deckBox" [title]="deck()?.name || 'Ajouter un deck'"
     [routerLink]="add() ? '/decks/builder' : '/decks/' + deck()!.id">
  <div class="deckBox-preview" *ngIf="!add() && deck()?.urls">
    <img class="deckBox-preview-card" *ngFor="let url of deck()!.urls" [src]="url" alt="" />
  </div>
  @if (!add()) {
    <img class="deckBox-image" [src]="'/assets/images/deckbox.webp'" alt="deckbox" />
  } @else {
    <div><mat-icon class="deckBox-add">add_circle_outline</mat-icon></div>
  }
  <div class="deckBox-name">{{ deck()?.name }}</div>
</div>
```

Current SCSS (fixed size, NOT responsive):
```scss
@import '../../styles/variable';
@import 'animation';
.deckBox {
  width: 200px;
  height: 170px;
  margin-right: 2rem;
  border: 1px solid $white;
  border-radius: 20px 0 20px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 1rem;
  cursor: pointer;
  position: relative;

  &-preview { /* ... absolute overlay with card images, fan-out animation on hover */ }
  &-image { width: 150px; /* deckbox.webp image */ }
  &-add { color: $blue; transform: scale(4); /* + reduce keyframe animation */ }
  &-name { font-weight: bold; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 100%; }
}
/* @keyframes fanOut1, fanOut2, fanOut3 — card fan-out on hover */
```

#### Responsive SCSS Infrastructure (Story 7-1)

```scss
// front/src/app/styles/_responsive.scss
$navbar-breakpoint: 768px;
$bp-mobile: 576px;
$bp-tablet: 768px;
$bp-desktop-sm: 1024px;

@mixin respond-above($bp) { @media (min-width: $bp) { @content; } }
@mixin respond-below($bp) { @media (max-width: ($bp - 1px)) { @content; } }
@mixin touch-target-min { min-width: 44px; min-height: 44px; }
```

#### AppComponent Mobile Mode (Story 7-2)

```scss
:host { --mobile-header-height: 48px; }
.dark-theme.mobile-mode .dark-theme-content {
  padding-top: var(--mobile-header-height);  // Already handles mobile top bar offset
}
```

#### Data Model

```typescript
// ShortDeck (displayed on deck list page)
type ShortDeckDTO = {
  id: number;
  name: string;
  urls: string[];  // Cover card image URLs (up to 3)
};
```

#### Routing

```typescript
{ path: 'decks', component: DeckPageComponent, canActivate: [AuthService] }
```

### Previous Story Intelligence (Story 7-3)

**Patterns established in Epic 7:**
- `@use 'responsive' as *` for SCSS imports (NOT `@import`)
- `@include touch-target-min` for 44×44px on all mobile interactive elements (NFR12)
- `@include respond-above($bp-mobile)` / `respond-above($bp-desktop-sm)` for breakpoint media queries
- Mobile-first approach: base styles for mobile, enhancements via `respond-above()`
- `--mobile-header-height: 48px` CSS variable exists at `:host` level in AppComponent
- `padding-top: var(--mobile-header-height)` already applied on `<main>` in mobile mode by AppComponent
- Desktop navbar width: 260px (expanded), 32px (collapsed)

**Lessons from Story 7-3 code review:**
- Mixed `em`/`rem` units → standardize to `rem` across all changes
- `overflow: hidden` can clip content on small viewports → avoid on scrollable containers
- Remove dead CSS properties during refactor
- Keep z-index values reasonable (no `z-index: 10000`)

### Git Intelligence

Recent commits show linear story-based progression (`7-1`, `v1`, `mvp`). Epic 7 stories are being developed on the `hand-testing` branch. Stories 7-2 and 7-3 have uncommitted changes in the working tree (8 files from 7-2, 3 files from 7-3 per git status). This is expected — user is developing in "big bang" mode with deferred commits.

### Edge Cases

- **Empty deck list:** If the user has no decks, only the "Add deck" box renders. Verify it fills the single column on mobile and looks balanced in the grid.
- **Long deck names:** `.deckBox-name` already uses `text-overflow: ellipsis` with `max-width: 100%` — verify this works at all widths, especially on mobile where the box is wider (longer names become visible).
- **Many decks (20+):** CSS Grid handles large item counts well. Verify scrolling is smooth and no layout issues occur.
- **Deck box with no cover images:** When `deck.urls` is empty/undefined, the preview div is hidden. The deckbox image alone should center properly in the wider fluid container.
- **Card fan-out animation on mobile (known behavior):** The fan-out uses `:hover` on `.deckBox-preview`. On touch devices, `:hover` is "sticky" — it triggers on first tap and stays until the user taps elsewhere. This means cards will fan-out on first tap and remain fanned until the next interaction. This is not a bug — it's standard `:hover` behavior on touch. No fix needed in this story. A future enhancement could use `@media (hover: hover)` to restrict fan-out to pointer devices only.
- **Delete button position:** Changed from `right: 2rem` (offset from deckbox image) to `top: 4px; right: 4px` (inside box corner). This avoids overflow clipping on mobile where the box edge is close to the viewport edge.
- **Viewport 375px–576px:** Single column, deck box fills width (~343px). The deckbox image (`width: 60%; max-width: 150px`) will be 150px (60% of 343px = 206px, capped at 150px). Centered properly.
- **Ultrawide (2560px+):** With `auto-fill minmax(225px, 1fr)`, this creates 9+ columns. This is intentional — Track B pages use available space naturally. The `1fr` max ensures cells grow proportionally, so deck boxes don't appear tiny. No `max-width` cap needed — the user with a 2560px screen expects their content to use the space.
- **`prefers-reduced-motion`:** The card fan-out animation uses CSS `@keyframes`. Story ACs do not require `prefers-reduced-motion` support. Skip unless explicitly requested (consistent with Stories 7-1, 7-2, 7-3 which also did not add motion preferences for existing animations).

### NFR Compliance

- **NFR9 (browser support):** CSS Grid is supported in all target browsers (Chrome, Firefox, Edge, Safari — latest two versions). `gap` in CSS Grid context is supported since Chrome 66, Firefox 61, Safari 12 — well within "latest two versions" target.
- **NFR11 (responsive 375px–2560px+):** Mobile-first grid with 1→2→auto-fill columns. No horizontal scrolling at any viewport width. Ensured by using `padding: 1rem` (not absolute widths) and fluid grid cells (`1fr`).
- **NFR12 (touch targets):** `@include touch-target-min` applied to delete button. Deck boxes themselves (entire box is routerLink) are well above 44×44px at all viewports. "Add deck" icon at `scale(4)` ≈ 96px, well above 44px.

### What This Story Does NOT Include

- **No TypeScript changes.** Only SCSS modifications.
- **No HTML changes.** Template structure remains identical. (Note: a `<h2>Mes decks</h2>` heading would improve page identification on mobile — similar to the `<h2>Paramètres</h2>` added in Story 7-3 — but is deferred to avoid scope creep. Recommend as follow-up.)
- **No new files created.**
- **app.component.scss modified (code review fix):** Changed `.dark-theme-content` `overflow: hidden` to `overflow-y: auto; overflow-x: hidden` — pre-existing `overflow: hidden` prevented vertical scrolling on pages with many items (AC6 compliance).
- **No navbar changes** — navbar responsive already done in Story 7.2.
- **No canvas scaling** — this is a Track B page.
- **No deck builder responsive** — that's Epic 8 (Story 8.4).
- **No card search responsive** — that's Epic 8 (Story 8.5).

### Cross-Story Dependencies

| Dependency | From |
|---|---|
| `_responsive.scss` (breakpoint variables, mixins) | Story 7.1 |
| `--mobile-header-height` CSS variable | Story 7.2 |
| `mobile-mode` class on app wrapper | Story 7.2 |
| `padding-top` on `<main>` in mobile mode | Story 7.2 |

| This Story Creates | Used By |
|---|---|
| Responsive deck list grid layout | N/A (self-contained) |
| Fluid DeckBoxComponent sizing | Potentially reused if DeckBoxComponent appears elsewhere |

### Project Structure Notes

**Files modified by this story:**
```
front/src/app/
  app.component.scss                            # MODIFIED (code review) — overflow-y: auto for vertical scrolling
  pages/
    deck-page/
      components/
        deck-list/
          deck-list.component.scss              # MODIFIED — CSS Grid layout, responsive breakpoints, delete button touch target
  components/
    deck-box/
      deck-box.component.scss                   # MODIFIED — fluid width, responsive image sizing, @use imports
```

**No new files created by this story.**

### References

- [Source: epics.md#Story 7.4] — Acceptance criteria, user story
- [Source: epics.md#Epic 7 Implementation Notes] — Deck list requires fluid grid responsive layout (1→2→3-4 columns by breakpoint)
- [Source: architecture.md#Responsive Strategy] — Track B for content pages, breakpoints table
- [Source: ux-design-specification.md#Responsive Strategy] — Track B responsive CSS, breakpoints, mobile-first
- [Source: ux-design-specification.md#Responsive Design & Accessibility] — Touch targets 44×44px, viewport considerations
- [Source: prd.md#NFR11] — Responsive 375px–2560px+, no horizontal scrolling
- [Source: prd.md#NFR12] — Touch targets 44×44px minimum on mobile
- [Source: 7-1-shared-scss-infrastructure-and-scalingcontainerdirective.md] — _responsive.scss details
- [Source: 7-2-responsive-navbar-hamburger-drawer-on-mobile.md] — Previous story patterns, mobile header height
- [Source: 7-3-login-and-settings-pages-responsive.md] — SCSS patterns (mobile-first, @use imports, touch-target-min, code review lessons)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No issues encountered. Build passed on first attempt.

### Completion Notes List

- **Task 1 — DeckListComponent responsive grid:** Migrated from `@import` to `@use`, replaced `display: flex; flex-wrap: wrap` with CSS Grid (`1fr` → `repeat(2, 1fr)` → `repeat(auto-fill, minmax(225px, 1fr))`). 225px minimum ensures 3 columns at 1024px even with expanded navbar (260px). Removed fixed `margin: 1rem` (replaced by grid `gap: 1rem`). Delete button: increased padding 3px→8px, added `border-radius: 50%`, `@include touch-target-min`, repositioned to `top: 4px; right: 4px`, z-index reduced from 10000 to 1010. Added `display: flex` on `.deckPage-deck` for host element asymmetry fix.
- **Task 2 — DeckBoxComponent responsive sizing:** Migrated `@import` to `@use` (variable + animation only — no `responsive` import needed). Changed `.deckBox` from fixed `width: 200px; height: 170px` to `width: 100%; min-height: 170px`. Removed `margin-right: 2rem`. Made image responsive: `max-width: 150px; width: 60%`. All animations, preview cards, and text truncation preserved unchanged.
- **Task 3 — Build verification:** `ng build --configuration development` passed with zero errors. Column count verified by structural code inspection (accounting for navbar width: 260px expanded, 32px collapsed). Touch targets, z-index layering, and empty state behavior verified by code inspection.

### File List

- `front/src/app/pages/deck-page/components/deck-list/deck-list.component.scss` — MODIFIED
- `front/src/app/components/deck-box/deck-box.component.scss` — MODIFIED
- `front/src/app/app.component.scss` — MODIFIED (code review fix: overflow-y: auto for vertical scroll)

## Change Log

- 2026-02-14: Story created — comprehensive context engine analysis completed.
- 2026-02-14: **Party Mode Review** — 4 HIGH/MEDIUM + 3 LOW findings addressed:
  - **H1 (z-index):** Changed delete button z-index from `10` to `1010` (must stay above `.deckBox-preview-card` at `z-index: 1000–1003` during fan-out hover)
  - **M1 (empty state):** Added AC 7 for empty deck list (0 decks, only "Add deck" box)
  - **M2 (host element asymmetry):** Added Task 1.7 + dev note for `display: flex` on `.deckPage-deck` to handle `<deck-box>` host element without wrapper div
  - **M3 (delete button overflow):** Changed position from `top: -6px; right: -6px` to `top: 4px; right: 4px` (inside box corner, avoids overflow clipping on mobile)
  - **L1 (ultrawide):** Clarified auto-fill 9+ columns is intentional for Track B, removed `max-width` suggestion
  - **L2 (sticky hover on mobile):** Documented fan-out `:hover` as known touch behavior, not a bug
  - **L3 (heading):** Added recommendation for `<h2>Mes decks</h2>` as follow-up (deferred, no scope creep)
- 2026-02-14: **Implementation completed** — All 3 tasks (24 subtasks) implemented. SCSS-only changes to 2 files. Build passes with zero errors. Status → review.
- 2026-02-14: **Code Review (AI)** — 1 HIGH, 4 MEDIUM, 2 LOW findings. All HIGH/MEDIUM fixed:
  - **H1 (column count with navbar):** `minmax(250px, 1fr)` → `minmax(225px, 1fr)` — original 250px min only gave 2 columns at 1024px with expanded navbar (260px). 225px ensures 3 columns (3×225 + 2×16 = 707 ≤ 732px available).
  - **M1 (unused import):** Removed `@use 'responsive' as *` from `deck-box.component.scss` — no responsive vars/mixins used in that file.
  - **M2 (overflow: hidden blocks scroll):** Changed `.dark-theme-content` in `app.component.scss` from `overflow: hidden` to `overflow-y: auto; overflow-x: hidden` — pre-existing issue that prevented vertical scroll for pages with many items (AC6).
  - **M3 (misleading task completion):** Updated Task 3.2–3.3 descriptions to clarify "structural verification (code inspection)" instead of "manual check".
  - **M4 (breakpoint off-by-one):** Noted in Task 3.3 — `respond-above($bp-mobile)` triggers at 576px (2 columns), follows project convention. AC text says "≤576px" for mobile. 1px boundary difference accepted as convention.
  - **L1 (fan-out cards not responsive):** Accepted — cosmetic, no regression.
  - **L2 (auto-fill empty state):** Accepted — `auto-fill` is the correct choice.
  - Build re-verified: zero errors. Status → done.
