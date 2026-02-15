---
title: 'Responsive UX Fixes — Multi-Page'
slug: 'responsive-ux-fixes'
created: '2026-02-15'
status: 'in-progress'
stepsCompleted: [1]
tech_stack: ['Angular 19.1.3', 'Angular Material 19.1.1', 'CDK BreakpointObserver', 'SCSS', 'TypeScript 5.5.4']
files_to_modify: []
code_patterns: []
test_patterns: []
---

# Tech-Spec: Responsive UX Fixes — Multi-Page

**Created:** 2026-02-15

## Overview

### Problem Statement

Hand testing on mobile (portrait + landscape) and desktop reveals 10 responsive layout issues across 4 pages: decklist, deck builder, card search, and simulator. Issues include navbar appearing on mobile landscape, inaccessible filters, suboptimal deck builder layout (both mobile and desktop), and visual bugs in the simulator (DEF card overflow, broken hand layout, drag-induced scroll).

### Solution

10 targeted SCSS/HTML/TS fixes addressing layout, visibility, and interaction issues across the app's existing responsive breakpoints. The Two-Track Strategy is preserved: Track A (canvas scaling) internal dimensions are reworked for the deck builder, Track B (mobile-first CSS) fixes are applied to content pages.

### Scope

**In Scope (9 tasks):**
1. Decklist portrait: delete button repositioned as badge overlay on deckbox
2. Global mobile landscape: navbar hidden via BreakpointObserver height+width condition
3. Deck builder portrait mobile: **blocking overlay** "Rotate your device" (not dismissible banner)
4. Deck builder mobile landscape: canvas internal dimensions reworked (60/40 ratio, Master Duel style) — depends on #10
5. Card search: filter toggle visible on all viewports, panel collapsible by default *(merged #5/#6 — single toggle controls visibility in both portrait and landscape)*
6. Simulator: DEF position card scaled to fit zone *(render bug — validate at all sizes, not just breakpoints)*
7. Simulator: hand/card fan layout fixed *(render bug — root cause TBD in Step 2)*
8. Simulator: `touch-action: none` on game board to prevent drag-scroll
9. Deck builder desktop: header moved to right column with grouped action menu — **must be implemented before #4**

**Out of Scope:**
- New features or gameplay mechanics
- Track A/B infrastructure refactoring
- Backend changes
- Simulator gameplay logic
- Automated tests (big bang approach — tests after full MVP)

## Context for Development

### Codebase Patterns

- **Two-Track Responsive Strategy**: Track A (canvas scaling via `transform: scale()` + `ScalingContainerDirective`) for simulator, deck builder, card search. Track B (mobile-first CSS with breakpoints) for deck list, settings, login.
- **Breakpoints**: `$bp-mobile: 576px`, `$bp-tablet: 768px`, `$navbar-breakpoint: 768px`, `$bp-desktop-sm: 1024px`
- **Responsive mixins**: `respond-above($bp)`, `respond-below($bp)`, `touch-target-min`
- **Canvas scaling mixins**: `canvas-parent`, `canvas-host($w, $h)`, `canvas-letterbox($bg)`
- **Navbar**: CDK `BreakpointObserver` in `NavbarCollapseService` with `(max-width: 768px)` query, exposes `isMobile` signal consumed by `AppComponent`
- **Mobile overlays**: Fixed-position panels with `transform: translateX()` slide transitions (300ms)
- **Card dimensions**: `$DECK_CARD_HEIGHT: 100px`, `$DECK_CARD_WIDTH: 75px`, `$DECK_EXTRASIDE_CARD_HEIGHT: 66.5px`, `$DECK_EXTRASIDE_CARD_WIDTH: 50px`

### Technical Decisions

- **Q1 — Navbar breakpoint**: Modify `NavbarCollapseService` BreakpointObserver query to `'(max-width: 768px), (max-width: 1024px) and (max-height: 500px)'`. This covers: mobile portrait (≤768px) AND phone/tablet landscape (≤1024px with height ≤500px) WITHOUT affecting resized desktop browser windows. *(Refined via Party Mode — original `max-height: 500px` alone was too aggressive, would trigger on small desktop windows.)*
- **Q2 — Deck builder Track A**: Keep canvas scaling, rework internal reference dimensions to allocate ~60% to deck viewer, ~40% to search panel (Master Duel proportions).
- **Q3 — Filter toggle**: The filter component and toggle button already exist — just hidden on mobile. Make the toggle accessible, not build new components.
- **Q4 — Point #9 `touch-action: none`**: Must verify compatibility with CDK DragDrop which manages its own touch event handlers. Risk of conflict — investigate in Step 2.
- **Q5 — Point #10 Header restructuring**: Moving the header from full-width to right column child is a significant HTML restructuration. Impacts flex flow, z-index layering, and potentially canvas scaling parent. Must be precisely documented in Step 2.
- **Q6 — Point #8 Hand layout**: Current description "fix hand layout" is too vague. Step 2 must determine root cause: 3D transforms? Container overflow? Dynamic sizing based on card count? All three?

### Files to Reference

| File | Purpose |
| ---- | ------- |

*(To be populated in Step 2 — Deep Investigation)*

## Implementation Plan

### Tasks

*(To be populated in Step 3 — Generate)*

### Acceptance Criteria

*(To be populated in Step 3 — Generate)*

## Additional Context

### Dependencies

- No new dependencies required. All fixes use existing Angular Material, CDK, and SCSS infrastructure.

### Testing Strategy

- Manual visual testing at breakpoints: 375px, 576px, 768px, 1024px, 1440px (portrait + landscape on mobile)
- Big bang approach: no automated tests until full MVP

### Notes

- Priority order defined with UX Designer (Sally):
  - Bloc 1: Navbar breakpoint (foundation, unblocks other fixes)
  - Bloc 2: Deck builder (desktop header, mobile landscape, portrait overlay)
  - Bloc 3: Card search (portrait filters, landscape collapsible)
  - Bloc 4: Decklist (delete badge)
  - Bloc 5: Simulator (touch-action, DEF scale, hand layout)
