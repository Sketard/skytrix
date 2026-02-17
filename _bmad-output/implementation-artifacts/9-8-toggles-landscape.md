# Story 9.8: Toggles Landscape

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want the view mode toggles to be merged into the search bar row on landscape viewports,
So that vertical space is preserved and I can see more card results.

## Acceptance Criteria

1. **Given** view mode toggles currently occupy a separate row (~44px) below the search bar
   **When** mobile landscape viewport is detected (via `landscape-split` mixin)
   **Then** toggles are merged into the same row as the search bar: `[search-bar] [toggles]`
   **And** ~44px vertical space is saved (one extra card row visible)

2. **Given** the toggles already use `mat-button-toggle-group` with token-based styling
   **When** tooltips are added
   **Then** each toggle button has a `matTooltip` describing its mode: "Liste", "Mosaïque", "Mes cartes", "Favoris"
   **And** `MatTooltip` is imported in the component

3. **Given** the OWNED toggle uses the `store` icon
   **When** the icon is updated per Screen Implementation Guide
   **Then** it uses the `style` icon instead (overlapping cards, more intuitive for "Mes cartes")

4. **Given** the portrait layout currently stacks search bar and toggles vertically
   **When** portrait orientation is active
   **Then** the stacked layout is preserved (no regression)

5. **Given** the merge affects both card search page and deck builder (shared `card-searcher` component)
   **When** both contexts are tested in landscape
   **Then** the merged layout renders correctly in both

## Tasks / Subtasks

- [ ] Task 1: Add `MatTooltip` import and tooltips to toggle buttons (AC: #2, #3)
  - [ ] 1.1: In `card-searcher.component.ts`, add `MatTooltip` to the `imports` array (import from `@angular/material/tooltip`)
  - [ ] 1.2: In `card-searcher.component.html`, add `matTooltip="Liste"` and `aria-label="Liste"` to the INFORMATIVE toggle
  - [ ] 1.3: Add `matTooltip="Mosaïque"` and `aria-label="Mosaïque"` to the MOSAIC toggle
  - [ ] 1.4: Add `matTooltip="Mes cartes"` and `aria-label="Mes cartes"` to the OWNED toggle
  - [ ] 1.5: Add `matTooltip="Favoris"` and `aria-label="Favoris"` to the FAVORITE toggle
  - [ ] 1.6: Replace `store` icon with `style` on the OWNED toggle (AC: #3)
  - [ ] 1.7: Preserve the `hideSingleSelectionIndicator` attribute on the `mat-button-toggle-group` — do NOT remove it

- [ ] Task 2: Merge toggles into search bar row in landscape — CSS only (AC: #1, #4, #5)
  - [ ] 2.1: In `card-searcher.component.scss`, add a `@include r.landscape-split` block inside `.cardSearchPage-searcher-bar` (the non-deckBuildMode context):
    - Set `display: flex; align-items: center; gap: 0.5em;`
    - Set `search-bar { flex: 1; min-width: 0; }`
    - Set `&-displayMode { margin-bottom: 0; }`
  - [ ] 2.2: In the existing `.deckBuildMode .cardSearchPage-searcher-bar @include r.landscape-split` block (lines 29–37), EXTEND the existing `search-bar { ... }` selector — do NOT create a second `search-bar {}` block. Add the flex layout rules to the parent and the `flex: 1; min-width: 0;` to the existing `search-bar` block:
    - Parent: `display: flex; align-items: center; gap: 0.5em;`
    - Extend existing `search-bar { ... }` with `flex: 1; min-width: 0;`
    - Add `&-displayMode { margin-bottom: 0; }`
  - [ ] 2.3: Verify the default (portrait) `.cardSearchPage-searcher-bar` still stacks children vertically (block layout) — no changes needed, just confirm no regression

- [ ] Task 3: Compact toggle sizing in landscape (AC: #1)
  - [ ] 3.1: Inside the landscape-split blocks (both modes), reduce toggle height for compact inline fit:
    - `mat-button-toggle { --mat-standard-button-toggle-height: 32px; }`
  - [ ] 3.2: Ensure mat-icon `transform: scale(0.8)` is preserved (already set in the `-displayMode` block, applies everywhere)

- [ ] Task 4: Verify zero regression (AC: #4, #5)
  - [ ] 4.1: Run `ng build` — confirm zero compilation errors (pre-existing budget warnings are expected)
  - [ ] 4.2: Verify card search page portrait: toggles remain on separate row below search bar
  - [ ] 4.3: Verify card search page landscape: toggles merge into same row as search bar
  - [ ] 4.4: Verify deck builder portrait: toggles remain on separate row below search bar
  - [ ] 4.5: Verify deck builder landscape: toggles merge into same row as search bar
  - [ ] 4.6: Verify tooltips appear on hover for all 4 toggle buttons
  - [ ] 4.7: Verify OWNED toggle now shows `style` icon instead of `store`
  - [ ] 4.8: Verify toggle selection state (accent-primary-dim bg + accent-primary icon) works correctly in both layouts

## Dev Notes

### Why This Story Exists

This is story 8 of Epic 9 (UI/UX Modernization). On mobile landscape, the top area consumes ~148px of vertical space: top bar (48px) + search bar (~56px) + toggles (~44px). By merging the toggles into the same row as the search bar, ~44px is saved — enough to display one extra row of card results. This is a quick CSS-only win identified in the Screen Implementation Guide.

Additionally, the Screen Implementation Guide identified that the `store` icon for "Mes cartes" is unintuitive and should be replaced with `style`, and that tooltips should be added for discoverability.

### What This Story Does

- Adds `matTooltip` to each of the 4 `mat-button-toggle` elements in `card-searcher.component.html`
- Imports `MatTooltip` in `card-searcher.component.ts`
- Replaces the `store` icon with `style` on the OWNED toggle
- Adds CSS `landscape-split` rules to merge the toggles and search bar onto a single flex row in mobile landscape
- Applies the merge in both normal mode and `deckBuildMode` contexts
- Reduces toggle height to 32px in landscape for compact inline fit

### What This Story Does NOT Do

- Does NOT modify the search-bar component (template, TS, or SCSS)
- Does NOT change the toggle button-toggle-group token styling (already done: `--accent-primary-dim` bg, `--accent-primary` text)
- Does NOT restructure the template (no moving filter button out of search-bar)
- Does NOT affect desktop (>768px) or tablet layouts — only mobile landscape via `landscape-split`
- Does NOT modify card-list, card-filters, or any other component
- Does NOT add new Angular Material modules beyond `MatTooltip` (already used in simulator control-bar)
- Does NOT change the `SearchServiceCore` or display mode logic
- Does NOT remove the `hideSingleSelectionIndicator` attribute from `mat-button-toggle-group`

### Current Template Structure (card-searcher.component.html)

```html
<div class="cardSearchPage-searcher-bar">
  <!-- Row 1: search-bar component (input + filter button) -->
  <search-bar [form]="..." [deckBuildMode]="..." (filterToggled)="..."></search-bar>
  <!-- Row 2: display mode toggles (separate row, ~44px) -->
  <div class="cardSearchPage-searcher-bar-displayMode">
    <mat-button-toggle-group ...>
      <mat-button-toggle [value]="INFORMATIVE">view_headline</mat-button-toggle>
      <mat-button-toggle [value]="MOSAIC">view_module</mat-button-toggle>
      <mat-button-toggle [value]="OWNED">store</mat-button-toggle>      <!-- → style -->
      <mat-button-toggle [value]="FAVORITE">star</mat-button-toggle>
    </mat-button-toggle-group>
  </div>
</div>
```

**Portrait (default):** Children stack vertically (block flow). Search bar full width, toggles below.
**Landscape (after this story):** Parent becomes `display: flex`, children sit side-by-side: `[search-bar flex:1] [toggles]`.

### CSS Implementation Approach

The Screen Implementation Guide specifies "CSS-only change using existing `landscape-split` mixin". The approach:

1. `.cardSearchPage-searcher-bar` has NO explicit `display` property — children stack via block flow
2. In `landscape-split` media query, set `display: flex; align-items: center; gap: 0.5em;`
3. `search-bar` (custom element host) gets `flex: 1; min-width: 0;` to fill remaining space
4. `.cardSearchPage-searcher-bar-displayMode` gets `margin-bottom: 0;` (its default is `0.5em`)
5. Toggle height reduced to 32px for compact fit

This produces: `[search-bar: 🔍 input... ⚙️] [≡ ⊞ 🃏 ⭐]`

Note: The filter button (⚙️) remains inside the search-bar component. The layout is `[search-bar][toggles]`, not `[input][toggles][filter]` as originally sketched in the guide. Moving the filter button out would require template restructuring beyond CSS-only scope. The vertical space saving is identical.

### The `landscape-split` Mixin

Defined in `front/src/app/styles/_responsive.scss`:
```scss
@mixin landscape-split {
  @media (orientation: landscape) and (min-width: 576px) and (max-width: 767px) {
    @content;
  }
}
```
Targets: mobile phones in landscape orientation (576px–767px width). Already used in the deckBuildMode context of card-searcher for compact form field sizing.

### deckBuildMode Landscape Context

The deckBuildMode already has a `landscape-split` block in the SCSS (lines 29–37) with compact form field overrides. The merge styles must be ADDED to this existing block — not duplicated as a separate block.

**Current deckBuildMode landscape-split (EXTEND, don't replace):**
```scss
&.deckBuildMode {
  .cardSearchPage-searcher-bar {
    @include r.landscape-split {
      margin: 0.5em;
      search-bar {
        --mat-form-field-container-height: 40px;
        --mat-form-field-filled-with-label-container-padding-top: 4px;
        --mat-form-field-filled-with-label-container-padding-bottom: 4px;
      }
    }
  }
}
```

After this story, add flex + toggle rules inside this same block.

### MatTooltip Import Pattern

`MatTooltip` is already used in the project (simulator control-bar). Import pattern:
```typescript
import { MatTooltip } from '@angular/material/tooltip';
// In @Component imports array:
imports: [..., MatTooltip]
```

### Accessibility: aria-label on Icon-Only Toggles

The toggle buttons contain only icons (no visible text). Adding `aria-label` alongside `matTooltip` ensures screen readers announce the toggle purpose. The `matTooltip` directive automatically adds `aria-describedby`, but `aria-label` provides the primary accessible name. Use the same French labels as the tooltips: `"Liste"`, `"Mosaïque"`, `"Mes cartes"`, `"Favoris"`.

### Icon Change: store → style

The `store` icon (shopping bag) is unintuitive for "owned cards". The `style` icon (overlapping rectangles) better conveys "my collection". This is a Screen Implementation Guide decision (Section 2: View Mode Toggles).

**Current:** `<mat-icon>store</mat-icon>` on OWNED toggle (line 18)
**New:** `<mat-icon>style</mat-icon>`

### Toggle Token Styling (Already Done)

The following styles are ALREADY applied (lines 67–82 of card-searcher.component.scss) and should NOT be modified:
```scss
&-displayMode {
  margin-bottom: 0.5em;

  mat-button-toggle-group {
    border-radius: 0;
    border: 0;
    --mat-legacy-button-toggle-text-color: var(--text-primary);
    --mat-legacy-button-toggle-selected-state-background-color: var(--accent-primary-dim);
    --mat-legacy-button-toggle-selected-state-text-color: var(--accent-primary);
  }

  mat-button-toggle {
    --mat-standard-button-toggle-height: 36px;
  }

  mat-icon {
    transform: scale(0.8);
  }
}
```

### Token Values Reference (from _tokens.scss)

| Token | Value | Usage in This Story |
|-------|-------|---------------------|
| `--accent-primary` | `#C9A84C` | Selected toggle icon color (already set) |
| `--accent-primary-dim` | `#C9A84C33` | Selected toggle background (already set) |
| `--text-primary` | `#EAEAEA` | Unselected toggle icon color (already set) |

### Previous Story Intelligence (9-7)

Story 9-7 (Deck Name Collapsed) established patterns relevant here:
- `setTimeout(0)` for post-render operations (not needed here, but good to know)
- CSS custom property migrations use Material `--mdc-*` and `--mat-*` prefixed properties
- Single signal shared between mobile/desktop contexts (only one visible at a time)
- `deck-builder.component.scss` still uses `@use 'variable' as *` — old variables NOT removed yet

### Git Intelligence

- Current branch: `hand-testing`
- Last commits: `35715a39 9.-2` (sidebar dark), `94a9097c 9-1` (global tokens)
- Working tree has uncommitted changes from stories 9-3 through 9-7
- Modified files include: `card-searcher.component.scss`, `search-bar.component.scss`, `_tokens.scss`

### Project Structure Notes

- **Files modified:**
  - `front/src/app/components/card-searcher/card-searcher.component.html` (add tooltips, change icon)
  - `front/src/app/components/card-searcher/card-searcher.component.ts` (add MatTooltip import)
  - `front/src/app/components/card-searcher/card-searcher.component.scss` (add landscape-split flex rules)
- **No new files** created
- **No new Angular Material modules** — `MatTooltip` already available in the project (used in simulator control-bar)
- Alignment with `@use 'responsive' as r;` already present at line 1 of the SCSS file

### Scope Boundaries

Elements in card-searcher that are NOT in scope for this story:
- `.cardSearchPage-filters` — filters panel positioning, separate concern
- `.cardSearchPage-searcher-result` — card grid layout, handled by story 9-5
- `search-bar` component internals — no changes to search-bar template/SCSS/TS
- Token values — no new tokens needed, no modifications to `_tokens.scss`

### References

- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 2 — View Mode Toggles decisions]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Screen 2 — Mobile Landscape decisions]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md#Regression Risk — Merge toggles in search bar]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.8 (lines 1520-1544)]
- [Source: front/src/app/components/card-searcher/card-searcher.component.html]
- [Source: front/src/app/components/card-searcher/card-searcher.component.ts]
- [Source: front/src/app/components/card-searcher/card-searcher.component.scss]
- [Source: front/src/app/components/search-bar/search-bar.component.html — filter button location context]
- [Source: front/src/app/styles/_responsive.scss — landscape-split mixin definition]
- [Source: front/src/app/styles/_tokens.scss — global design tokens]
- [Source: _bmad-output/implementation-artifacts/9-7-deck-name-collapsed.md — previous story intelligence]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
