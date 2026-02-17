# Story 9.12: Simulator Token Migration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the simulator's `_sim-tokens.scss` migrated to reference global tokens with simulator-specific overrides via `:host`,
so that the dual token system is unified and the simulator inherits shared values without duplication.

## Acceptance Criteria

1. **Given** the simulator currently uses ~24 `$sim-*` SCSS variables in `_sim-tokens.scss`
   **When** the migration is applied
   **Then** `SimulatorPageComponent` overrides global tokens via `:host` (e.g., `--surface-base: #0a0e1a`, `--accent-primary: #00d4ff`)
   **And** shared values (`--surface-elevated`) inherit from global — zero duplication

2. **Given** the simulator uses cyan `#00d4ff` for interactive accents and gold `#d4a017` for success glow
   **When** the token mapping is applied
   **Then** cyan maps to `--accent-primary` override and gold glow remains hardcoded (NOT confused with global gold `#C9A84C`)

3. **Given** the migration is applied
   **When** all simulator interactions are tested
   **Then** zone borders, drag highlights, card glow, control bar, pile overlays, and hand rendering all appear visually identical to before the migration

4. **Given** the old `_sim-tokens.scss` file
   **When** the migration is complete
   **Then** it is reduced to only simulator-specific values that cannot be expressed as global token overrides (spacing, sizing, animation SCSS variables, and derived color values)

5. **Given** `@media (prefers-reduced-motion)` blocks exist in 7 simulator SCSS files
   **When** the migration is complete
   **Then** all `prefers-reduced-motion` blocks are removed from simulator components
   **And** `grep -r "prefers-reduced-motion" front/src/app/pages/simulator/` returns zero matches
   [Source: screen-implementation-guide.md §XYZ Material Peek Decisions, §Recommended Implementation Order step 12]

6. **Given** all color `$sim-*` SCSS variables have been migrated to CSS custom properties
   **When** the migration is complete
   **Then** `grep -rE '\$sim-(bg|surface[^-]|surface-elevated|accent-primary|text-primary|text-secondary|error|zone-border|zone-highlight|zone-glow|overlay-backdrop|accent-secondary)' front/src/app/pages/simulator/` returns zero matches outside of `_sim-tokens.scss`
   **And** no orphaned color variable references remain in any simulator component SCSS file

## Tasks / Subtasks

- [x] Task 1: Define `:host` token overrides on `simulator-page.component.scss` (AC: #1)
  - [x] 1.1 Verify `SimulatorPageComponent` uses default ViewEncapsulation (Emulated) — if `ViewEncapsulation.None` is set, the `:host` overrides will leak to global scope
  - [x] 1.2 Add `:host` block with `--surface-base: #0a0e1a`
  - [x] 1.3 Add `--accent-primary: #00d4ff` (cyan override)
  - [x] 1.4 Add `--text-primary: #f1f5f9` (simulator-specific, contrast 15.4:1 on navy bg)
  - [x] 1.5 Add `--text-secondary: #94a3b8` (simulator-specific, contrast ~7.9:1 on navy — passes WCAG AA)
  - [x] 1.6 Add `--danger: #ef4444` (simulator-specific)
  - [x] 1.7 Add simulator-specific CSS custom properties for derived/unique colors:
    - `--sim-surface: #111827` (zone backgrounds — NOT mapped to `--surface-card` to avoid semantic mismatch)
    - `--sim-zone-border: rgba(0, 212, 255, 0.15)` (cyan at 15%)
    - `--sim-zone-highlight: rgba(0, 212, 255, 0.3)` (cyan at 30%)
    - `--sim-zone-glow-success: rgba(212, 160, 23, 0.4)` (gold at 40%)
    - `--sim-overlay-backdrop: rgba(10, 14, 26, 0.7)` (navy at 70%)
    - `--sim-glow-success: #d4a017` (gold glow base color — NOT the global gold `#C9A84C`)

- [x] Task 2: Refactor `_sim-tokens.scss` (AC: #4)
  - [x] 2.1 Remove all color SCSS variables that are now CSS custom properties
  - [x] 2.2 Keep spacing/sizing SCSS variables: `$sim-gap-zone`, `$sim-gap-zone-px`, `$sim-gap-card`, `$sim-padding-zone`, `$sim-padding-overlay`, `$sim-radius-zone`, `$sim-radius-card`
  - [x] 2.3 Keep animation SCSS variables: `$sim-card-aspect-ratio`, `$sim-hand-card-height`, `$sim-hand-hover-lift`, `$sim-hand-hover-scale`, `$sim-hand-transition`
  - [x] 2.4 Keep `@use 'sass:list'` — it is required by `$sim-card-aspect-ratio: list.slash(59, 86)`

- [x] Task 3: Migrate all 8 simulator SCSS files (AC: #1, #3, #6)
  **DEPENDENCY: Task 1 MUST be completed before Task 3.** If `$sim-bg` is replaced with `var(--surface-base)` before the `:host` override exists, the simulator will render with the global `#121212` background instead of navy `#0a0e1a`.
  - [x] 3.1 `simulator-page.component.scss` — replace `$sim-bg` → `var(--surface-base)`
  - [x] 3.2 `board.component.scss` — replace `$sim-bg` → `var(--surface-base)`, keep `$sim-gap-zone-px` as SCSS
  - [x] 3.3 `zone.component.scss` — replace all color `$sim-*` → `var(--*)` equivalents
  - [x] 3.4 `stacked-zone.component.scss` — same pattern as zone
  - [x] 3.5 `hand.component.scss` — replace color vars, keep `$sim-hand-*` as SCSS
  - [x] 3.6 `control-bar.component.scss` — replace all color `$sim-*` → `var(--*)`
  - [x] 3.7 `pile-overlay.component.scss` — replace all color `$sim-*` → `var(--*)`
  - [x] 3.8 `xyz-material-peek.component.scss` — replace color vars, keep `$sim-card-aspect-ratio`, `$sim-gap-*`, `$sim-radius-*`, `$sim-padding-*` as SCSS
  - [x] 3.9 Remove or keep `@use 'sim-tokens' as *` per file — see table below

**`@use 'sim-tokens' as *` — Keep or Remove per file:**

| File | Keep `@use`? | Remaining SCSS vars |
|---|---|---|
| `simulator-page.component.scss` | **Remove** | None — only used `$sim-bg` |
| `board.component.scss` | **Keep** | `$sim-gap-zone-px` |
| `zone.component.scss` | **Keep** | `$sim-radius-zone`, `$sim-padding-zone` |
| `stacked-zone.component.scss` | **Keep** | `$sim-radius-zone`, `$sim-padding-zone` |
| `hand.component.scss` | **Keep** | `$sim-radius-zone`, `$sim-hand-card-height`, `$sim-hand-transition`, `$sim-hand-hover-lift`, `$sim-hand-hover-scale` |
| `control-bar.component.scss` | **Remove** | None — all vars are color tokens |
| `pile-overlay.component.scss` | **Keep** | `$sim-radius-zone` |
| `xyz-material-peek.component.scss` | **Keep** | `$sim-padding-overlay`, `$sim-gap-zone`, `$sim-gap-card`, `$sim-radius-zone`, `$sim-radius-card`, `$sim-card-aspect-ratio` |

- [x] Task 4: Remove `@media (prefers-reduced-motion)` blocks (AC: #5)
  - [x] 4.1 `board.component.scss`
  - [x] 4.2 `zone.component.scss`
  - [x] 4.3 `stacked-zone.component.scss`
  - [x] 4.4 `hand.component.scss`
  - [x] 4.5 `control-bar.component.scss`
  - [x] 4.6 `pile-overlay.component.scss`
  - [x] 4.7 `xyz-material-peek.component.scss`

- [x] Task 5: Visual regression verification (AC: #3)
  - [x] 5.1 Run `ng build` — expect zero compilation errors (budget warnings are pre-existing, ignore)
  - [ ] 5.2 Visually verify: zone borders (cyan 15% opacity)
  - [ ] 5.3 Visually verify: drag-drop zone highlights (cyan 30% opacity)
  - [ ] 5.4 Visually verify: success glow on card placement (gold 40% opacity)
  - [ ] 5.5 Visually verify: control bar (surface + border)
  - [ ] 5.6 Visually verify: pile overlay (backdrop + content)
  - [ ] 5.7 Visually verify: XYZ material peek
  - [ ] 5.8 Visually verify: hand fan (hover lift, scale, transition)

## Dev Notes

### Critical Technical Decisions

**rgba(var()) Problem — RESOLVED: Hardcode derived values as CSS custom properties**

The UX spec references `rgba(var(--accent-primary), 0.15)` for derived tokens, but CSS `rgba()` cannot accept a hex string from `var()`. Three options were considered:

1. ~~RGB companion tokens~~ (`--accent-primary-rgb: 0, 212, 255`) — adds maintenance burden
2. ~~`color-mix(in srgb, ...)`~~ — CSS Color Level 4, works but less readable
3. **Hardcode the computed rgba values** as sim-specific CSS custom properties on `:host` — simplest, zero runtime overhead, no browser compat concerns

Decision: Define derived color values as pre-computed CSS custom properties in the `SimulatorPageComponent` `:host` block. These are simulator-specific and never need to respond to runtime token changes. Example:
```scss
:host {
  --sim-zone-border: rgba(0, 212, 255, 0.15);  // pre-computed from cyan #00d4ff
}
```

**Text/Error Color Overrides — Override ALL differing values**

| Token | Global | Simulator | Action |
|---|---|---|---|
| `--text-primary` | `#EAEAEA` | `#f1f5f9` | Override — UX spec §Accessibility uses `#f1f5f9` with 15.4:1 contrast on navy |
| `--text-secondary` | `#9E9E9E` | `#94a3b8` | Override — blue-grey tint matches navy palette, contrast ~7.9:1 on `#0a0e1a` (WCAG AA) |
| `--danger` | `#CF6679` | `#ef4444` | Override — brighter red for dark navy bg |
| `--surface-elevated` | `#1E293B` | `#1e293b` | **Same value** — inherits from global, no override |

[Source: story 9-1 code review findings M2 and L1]

### Token Mapping Reference

**Global tokens overridden via `:host` on SimulatorPageComponent:**

| `$sim-*` variable | → CSS custom property | Override value |
|---|---|---|
| `$sim-bg` | `--surface-base` | `#0a0e1a` |
| `$sim-accent-primary` | `--accent-primary` | `#00d4ff` |
| `$sim-text-primary` | `--text-primary` | `#f1f5f9` (contrast 15.4:1 on navy) |
| `$sim-text-secondary` | `--text-secondary` | `#94a3b8` (contrast ~7.9:1 on navy — WCAG AA) |
| `$sim-error` | `--danger` | `#ef4444` |

**Simulator-specific CSS custom properties (on `:host`, no global equivalent):**

| `$sim-*` variable | → CSS custom property | Value |
|---|---|---|
| `$sim-surface` | `--sim-surface` | `#111827` (zone backgrounds — semantically distinct from global `--surface-card`) |
| `$sim-glow-success` (was `$sim-accent-secondary`) | `--sim-glow-success` | `#d4a017` (gold glow base — NOT global gold `#C9A84C`) |
| `$sim-zone-border` | `--sim-zone-border` | `rgba(0, 212, 255, 0.15)` |
| `$sim-zone-highlight` | `--sim-zone-highlight` | `rgba(0, 212, 255, 0.3)` |
| `$sim-zone-glow-success` | `--sim-zone-glow-success` | `rgba(212, 160, 23, 0.4)` |
| `$sim-overlay-backdrop` | `--sim-overlay-backdrop` | `rgba(10, 14, 26, 0.7)` |

**Tokens that stay as SCSS variables in `_sim-tokens.scss`:**

| Variable | Value | Reason |
|---|---|---|
| `$sim-gap-zone` | `0.25rem` | Layout-only, no global equivalent |
| `$sim-gap-zone-px` | `4px` | Used in CSS grid `gap` |
| `$sim-gap-card` | `0.25rem` | Layout-only |
| `$sim-padding-zone` | `0.25rem` | Layout-only |
| `$sim-padding-overlay` | `1rem` | Layout-only |
| `$sim-radius-zone` | `0.375rem` | Layout-only |
| `$sim-radius-card` | `0.25rem` | Layout-only |
| `$sim-card-aspect-ratio` | `list.slash(59, 86)` | SCSS function, cannot be CSS custom property |
| `$sim-hand-card-height` | `140px` | Animation-only |
| `$sim-hand-hover-lift` | `-24px` | Animation-only |
| `$sim-hand-hover-scale` | `1.08` | Animation-only |
| `$sim-hand-transition` | `200ms ease` | Animation-only |

### Replacement Cheatsheet (per-file)

In each simulator SCSS file, make these replacements:

| Old (SCSS) | New (CSS custom property) |
|---|---|
| `$sim-bg` | `var(--surface-base)` |
| `$sim-surface` | `var(--sim-surface)` |
| `$sim-surface-elevated` | `var(--surface-elevated)` |
| `$sim-accent-primary` | `var(--accent-primary)` |
| `$sim-text-primary` | `var(--text-primary)` |
| `$sim-text-secondary` | `var(--text-secondary)` |
| `$sim-error` | `var(--danger)` |
| `$sim-zone-border` | `var(--sim-zone-border)` |
| `$sim-zone-highlight` | `var(--sim-zone-highlight)` |
| `$sim-zone-glow-success` | `var(--sim-zone-glow-success)` |
| `$sim-overlay-backdrop` | `var(--sim-overlay-backdrop)` |
| `$sim-accent-secondary` | `var(--sim-glow-success)` |

Spacing/sizing/animation vars remain as `$sim-*` SCSS — no change needed.

### Anti-Pattern Warnings

- **DO NOT** add `--accent-primary-dim` override on `:host` — no simulator component uses this global token.
- **DO NOT** confuse simulator gold `#d4a017` (`--sim-glow-success`) with global gold `#C9A84C` (`--accent-primary`). They serve different purposes.
- **DO NOT** map `$sim-surface` to `--surface-card` — simulator zone backgrounds are semantically different from "card surfaces". Use `--sim-surface` instead.
- **DO NOT** touch `_tokens.scss` — global tokens are already correct from story 9-1.
- **DO NOT** touch `styles.scss` or `variable.scss`.
- **DO NOT** modify any TypeScript or HTML files — this is purely SCSS migration.
- **DO NOT** remove `@use 'sim-tokens' as *` from files that still reference SCSS-only vars (spacing, sizing, animation).
- **DO NOT** attempt `rgba(var(--accent-primary), 0.15)` — it will silently produce `transparent` because CSS rgba() cannot parse hex from var().

### `@media (prefers-reduced-motion)` Removal

Per screen-implementation-guide.md §Recommended Implementation Order step 12 and §XYZ Material Peek Decisions, all `prefers-reduced-motion` blocks in simulator SCSS are removed in this story. These blocks existed as accessibility safeguards but the screen guide determined they are unnecessary for the simulator context.

Files with blocks to remove:
- `board.component.scss`
- `zone.component.scss`
- `stacked-zone.component.scss`
- `hand.component.scss`
- `control-bar.component.scss`
- `pile-overlay.component.scss`
- `xyz-material-peek.component.scss`

### CSS Custom Property Cascade

Angular `ViewEncapsulation.Emulated` (default) does NOT block CSS custom property inheritance. Defining `--accent-primary: #00d4ff` on `SimulatorPageComponent`'s `:host` makes it available to ALL child components (board, zone, hand, etc.) via normal CSS cascade — no extra configuration needed.

**Pre-flight check (Task 1.1):** Verify `SimulatorPageComponent` does NOT set `ViewEncapsulation.None` in its `@Component` decorator. If it does, the `:host` overrides will leak to all pages. Expected: no explicit `encapsulation` property (defaults to Emulated).

### Build Verification

`ng build` exits code 1 due to pre-existing budget warnings (bundle 1.57 MB > 1 MB limit; deck-builder.component.scss > 4 KB). These are NOT related to this story. Zero compilation errors = success.

### Project Structure Notes

- All simulator SCSS files are collocated in `front/src/app/pages/simulator/`
- `_sim-tokens.scss` is a Sass partial (underscore prefix) in the same directory — imported via `@use 'sim-tokens' as *` (no path prefix needed due to colocation)
- Global tokens in `front/src/app/styles/_tokens.scss` — imported in `styles.scss` (after `material`, before `variable`)
- No file moves needed — `_sim-tokens.scss` stays in its current location

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Story 9.12]
- [Source: _bmad-output/planning-artifacts/screen-implementation-guide.md §Token Architecture, §XYZ Material Peek Decisions, §Recommended Implementation Order]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §Color System, §Customization Strategy, §Accessibility]
- [Source: _bmad-output/planning-artifacts/architecture.md §Styling Patterns]
- [Source: _bmad-output/implementation-artifacts/9-1-global-tokens.md §Dev Notes, §Code Review findings M2, L1]

## Change Log

- 2026-02-17: Migrated simulator dual token system to unified CSS custom properties via `:host` overrides. Removed 12 color SCSS variables from `_sim-tokens.scss`, replaced all color `$sim-*` references across 8 SCSS files with `var(--*)` equivalents. Removed 7 `@media (prefers-reduced-motion)` blocks. `@use 'sim-tokens'` removed from `simulator-page.component.scss` and `control-bar.component.scss`. Build compiles with zero errors.
- 2026-02-17 (Code Review): Fixed 3 MEDIUM + 1 LOW findings. Removed 3 dead CSS custom properties (`--sim-overlay-backdrop`, `--sim-glow-success`, `--danger`). Added `--sim-surface-translucent` to `:host` and replaced hardcoded `rgba(17, 24, 39, 0.85)` in control-bar. Noted UX spec divergence (L1) for future spec update.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `rgba($sim-surface, 0.85)` in control-bar.component.scss initially hardcoded to `rgba(17, 24, 39, 0.85)`. Code review moved this to `--sim-surface-translucent` on `:host` for consistency with the derived-value pattern.
- `rgba($sim-accent-primary, 0.3)` in hand.component.scss replaced with `var(--sim-zone-highlight)` since the computed value is identical (`rgba(0, 212, 255, 0.3)`).
- During pile-overlay migration, `replace_all` for `$sim-surface` also matched `$sim-surface-elevated` (prefix collision), producing `var(--sim-surface)-elevated`. Fixed immediately by replacing the malformed string with `var(--surface-elevated)`.

### Completion Notes List

- Task 1: Added `:host` block on `simulator-page.component.scss` with 4 global token overrides (`--surface-base`, `--accent-primary`, `--text-primary`, `--text-secondary`) and 5 simulator-specific CSS custom properties (`--sim-surface`, `--sim-surface-translucent`, `--sim-zone-border`, `--sim-zone-highlight`, `--sim-zone-glow-success`). Verified ViewEncapsulation is default Emulated. Code review removed 3 dead tokens (`--danger`, `--sim-overlay-backdrop`, `--sim-glow-success`) and added `--sim-surface-translucent`.
- Task 2: Removed all 12 color SCSS variables from `_sim-tokens.scss`. Kept 12 spacing/sizing/animation variables and `@use 'sass:list'`.
- Task 3: Migrated all 8 simulator SCSS files per replacement cheatsheet. Removed `@use 'sim-tokens'` from `simulator-page.component.scss` and `control-bar.component.scss` (no remaining SCSS vars). Kept `@use` on 6 files that still use spacing/sizing/animation SCSS vars.
- Task 4: Removed all 7 `@media (prefers-reduced-motion: reduce)` blocks. `grep` confirms zero matches.
- Task 5: `ng build` — zero compilation errors. Budget warnings are pre-existing. Visual verification subtasks (5.2-5.8) require manual user inspection.
- AC #1: `:host` overrides defined, `--surface-elevated` inherits from global (no override needed — same value `#1e293b`).
- AC #2: Cyan `#00d4ff` maps to `--accent-primary` override. Gold `#d4a017` is used via pre-computed `--sim-zone-glow-success: rgba(212, 160, 23, 0.4)` (NOT confused with global `#C9A84C`).
- AC #4: `_sim-tokens.scss` reduced to spacing/sizing/animation only.
- AC #5: Zero `prefers-reduced-motion` matches in simulator directory.
- AC #6: Zero orphaned color `$sim-*` references outside `_sim-tokens.scss`.

### File List

- `front/src/app/pages/simulator/simulator-page.component.scss` — Modified: added `:host` overrides (4 global + 5 sim-specific), replaced `$sim-bg` → `var(--surface-base)`, removed `@use 'sim-tokens'`. Review: removed 3 dead tokens, added `--sim-surface-translucent`
- `front/src/app/pages/simulator/_sim-tokens.scss` — Modified: removed 12 color SCSS variables, kept spacing/sizing/animation
- `front/src/app/pages/simulator/board.component.scss` — Modified: replaced `$sim-bg` → `var(--surface-base)`, removed `prefers-reduced-motion` block
- `front/src/app/pages/simulator/zone.component.scss` — Modified: replaced 6 color vars → CSS custom properties, removed `prefers-reduced-motion` block
- `front/src/app/pages/simulator/stacked-zone.component.scss` — Modified: replaced 6 color vars → CSS custom properties, removed `prefers-reduced-motion` block
- `front/src/app/pages/simulator/hand.component.scss` — Modified: replaced color vars, `rgba($sim-accent-primary, 0.3)` → `var(--sim-zone-highlight)`, removed `prefers-reduced-motion` block
- `front/src/app/pages/simulator/control-bar.component.scss` — Modified: replaced all color vars, `rgba($sim-surface, 0.85)` → `var(--sim-surface-translucent)`, removed `@use 'sim-tokens'`, removed `prefers-reduced-motion` block
- `front/src/app/pages/simulator/pile-overlay.component.scss` — Modified: replaced all color vars, removed `prefers-reduced-motion` block
- `front/src/app/pages/simulator/xyz-material-peek.component.scss` — Modified: replaced all color vars, removed `prefers-reduced-motion` block
