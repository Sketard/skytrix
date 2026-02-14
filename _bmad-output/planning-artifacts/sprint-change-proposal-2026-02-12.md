# Sprint Change Proposal — Responsive Application

**Date:** 2026-02-12
**Triggered by:** Post-MVP new requirement (Axel)
**Scope classification:** Moderate
**Status:** APPROVED (2026-02-12)

---

## Section 1: Issue Summary

### Problem Statement

skytrix is currently a desktop-only application. No page (deck list, deck builder, card search, settings, login) is adapted for tablet or mobile viewports. The simulator has a fixed 16:9 scaling model that works at any viewport size, but all other pages lack any responsive strategy. The goal is to make the entire application usable on all screen sizes.

### Context

- All 6 planned epics are **done** — the MVP simulator is fully functional
- The PRD explicitly states "Desktop-first" and NFR9 only mentions desktop browsers
- The UX Spec marks mobile as "Post-MVP" with tap-to-place designed separately
- The simulator's `transform: scale()` scaling model is proven and can be extended to other card manipulation pages
- Existing card components in the deck builder and simulator have overlap that can be harmonized

### Evidence

| Document | Current State | Gap |
|---|---|---|
| PRD | "Desktop-first", "Modern desktop browsers only" | No mobile/tablet support defined |
| Architecture | "No breakpoints, no responsive layout changes" (simulator) | No responsive strategy for deck pages |
| UX Spec | Mobile = "Post-MVP", tap-to-place mentioned but not designed | No responsive design for non-simulator pages |
| Epics | No epic covers responsive for existing pages | New epics needed |
| Codebase | Pages built without media queries or responsive patterns | CSS refactoring required |

---

## Section 2: Impact Analysis

### Epic Impact

- **Existing Epics 1-6:** No impact — all done, no modifications needed
- **New Epics Required:** 2 new epics (Epic 7, Epic 8)
- **No epic invalidated, no rollback needed**

### Artifact Conflicts

| Artifact | Impact Level | Changes Required |
|---|---|---|
| **PRD** | Medium | Update Web App Technical Context, NFR9, add NFR11-12 |
| **Architecture** | Medium | Add Responsive Strategy section, Shared Component Extraction |
| **UX Spec** | Medium | Update Responsive Design section with two-track approach |
| **Epics** | High | Add Epic 7 and Epic 8 with full story breakdowns |
| **Sprint Status** | Low | Add Epic 7, Epic 8 entries |

### Technical Impact

- **Shared component extraction:** SimCardComponent and SimCardInspectorComponent refactored into shared `components/` directory — simulator must not regress
- **New shared infrastructure:** ScalingContainerDirective, `_canvas-scaling.scss`, `_responsive.scss`
- **Existing pages modified:** Deck builder, card search get canvas scaling; deck list, settings, login get responsive CSS
- **Navbar:** Extends existing collapsible behavior — collapsed by default on canvas pages, expanded on content pages

---

## Section 3: Recommended Approach

### Selected Path: Direct Adjustment

Add 2 new epics to the existing backlog. Update PRD, Architecture, and UX Spec to reflect the expanded scope. No rollback, no MVP redefinition.

### Rationale

- The work is **purely additive** — no existing code needs to be rewritten (only refactored for extraction)
- The simulator's proven scaling model provides a solid foundation for deck builder and card search
- Component extraction (card, inspector) reduces long-term duplication
- Risk is low: responsive CSS and scaling are well-understood patterns

### Effort Estimate

- **Epic 7 (App Shell & Navbar):** Medium — infrastructure + responsive CSS for 4 pages (login, settings, deck list, navbar)
- **Epic 8 (Card Manipulation Pages):** Medium-High — component harmonization analysis + extraction + canvas refactoring for 2 pages (deck builder, card search) + simulator refactor

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Simulator regression during component extraction | Low | High | Extract, don't rewrite. Run manual testing after refactor |
| Card/Inspector harmonization complexity | Medium | Medium | Dedicated analysis story (8.1) before implementation |
| Canvas scaling on deck builder doesn't fit all layouts | Low | Medium | Hybrid layout (responsive header + scaled canvas) |

---

## Section 4: Detailed Change Proposals

### 4.1 PRD Changes

**Web App Technical Context — Browser Support:**

OLD:
```
- Browser Support: Modern desktop browsers only (Chrome, Firefox, Edge, Safari latest)
- Responsive Design: Desktop-first — card game board requires sufficient screen real estate
```

NEW:
```
- Browser Support: Modern browsers — desktop (Chrome, Firefox, Edge, Safari latest two versions) and mobile (Chrome Android, Safari iOS latest two versions)
- Responsive Design: Responsive multi-device — deck management pages use fluid layouts with breakpoints (mobile-first CSS). The simulator board uses a fixed 16:9 aspect ratio with proportional scaling on all devices; mobile adds a tap-to-place interaction mode and landscape-locked display.
```

**NFR9 — Compatibility:**

OLD:
```
- NFR9: The simulator functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions)
```

NEW:
```
- NFR9: The application functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions) and modern mobile browsers (Chrome Android, Safari iOS — latest two versions). The simulator locks to landscape orientation on mobile devices.
```

**New NFRs:**

```
- NFR11: Deck management pages (deck list, deck detail, deck builder) are usable on viewports from 375px width (mobile portrait) to 2560px+ (ultrawide desktop) without horizontal scrolling
- NFR12: All interactive elements meet minimum touch target size of 44×44px on mobile viewports
```

### 4.2 Architecture Changes

**New section: Responsive Strategy**

Two-track approach:

**Track A — Fixed Canvas Scaling (card manipulation pages):**
- Deck builder (`/decks/builder`, `/decks/:id`)
- Card search (`/search`)
- Simulator (`/decks/:id/simulator`) — already implemented

Fixed internal resolution per page, `transform: scale()` to fit viewport. Hybrid layout: responsive search/filter header above scaled canvas. Shared scaling logic via reusable directive.

**Track B — Responsive CSS (content/utility pages):**
- Deck list (`/decks`)
- Settings (`/parameters`)
- Login (`/login`)

Mobile-first CSS with breakpoints: 576px, 768px, 1024px.

**New section: Shared Component Extraction**

| Extracted Component | Source | Used By |
|---|---|---|
| `CardComponent` | ex `SimCardComponent` | Simulator, Deck builder, Card search |
| `CardInspectorComponent` | ex `SimCardInspectorComponent` | Simulator, Deck builder, Card search |
| `ScalingContainerDirective` | new (logic from BoardComponent) | Simulator, Deck builder, Card search |

Harmonization analysis required before implementation: compare existing card/inspector components with simulator versions, define unified interface.

**New shared infrastructure:**
- `src/app/styles/_canvas-scaling.scss`
- `src/app/styles/_responsive.scss`
- `src/app/components/scaling-container/`

### 4.3 UX Spec Changes

**Responsive Design section updated to two-track approach:**
- Card manipulation pages (deck builder, card search, simulator): fixed canvas scaling
- Content pages (deck list, settings, login): mobile-first responsive CSS
- Shared components (CardComponent, CardInspectorComponent): identical behavior everywhere
- Navbar: collapsed by default on canvas pages, expanded on content pages

### 4.4 Epics Changes

**Epic 7: Responsive App Shell & Navbar**

Scope:
- Shared scaling directive extracted from simulator BoardComponent
- Shared SCSS infrastructure (`_canvas-scaling.scss`, `_responsive.scss`)
- Navbar responsive: hamburger/drawer on mobile, collapsible sidebar on desktop
- Login page responsive
- Settings page responsive
- Deck list page responsive (fluid grid, breakpoints)

Implementation order: **First** — provides foundation for Epic 8.

**Epic 8: Responsive Card Manipulation Pages**

Scope:
- Extract CardComponent from SimCardComponent (harmonize with existing)
- Extract CardInspectorComponent from SimCardInspectorComponent (harmonize with existing)
- Deck builder: fixed canvas scaling with hybrid layout
- Card search page: fixed canvas scaling with hybrid layout
- Simulator refactor: replace Sim-prefixed components with shared versions
- Touch targets 44×44px

Implementation order: **Second** — depends on Epic 7.

---

## Section 5: Implementation Handoff

### Change Scope: Moderate

Backlog reorganization needed — 2 new epics with full story breakdowns required.

### Handoff Plan

| Step | Agent | Action |
|---|---|---|
| 1. Update PRD | 📋 Product Manager (John) | Apply Section 4.1 changes |
| 2. Update Architecture | 🏗️ Architect (Winston) | Apply Section 4.2 changes |
| 3. Update UX Spec | 🎨 UX Designer (Sally) | Apply Section 4.3 changes + design responsive layouts for deck list, login, settings |
| 4. Update Epics | 📋 Product Manager (John) | Add Epic 7 and Epic 8 with full stories to epics.md |
| 5. Sprint Planning | 🏃 Scrum Master (Bob) | Plan sprint for Epic 7 → Epic 8 |
| 6. Implementation | 💻 Developer (Amelia) | Execute stories via Create Story → Dev Story cycle |

### Success Criteria

- All 6 pages render correctly on viewports from 375px to 2560px+
- Simulator does not regress after component extraction
- Shared CardComponent and CardInspectorComponent work identically in simulator, deck builder, and card search
- Touch targets meet 44×44px minimum on mobile viewports
- No horizontal scrolling on any page at any viewport width
