# Sprint Retrospective — Epics 1-5: Simulator MVP

**Date:** 2026-02-12
**Scope:** Full sprint (Epics 1–5, 13 stories)
**Facilitator:** Bob (Scrum Master)
**Participants:** Axel (Project Lead), Alice (Product Owner), Charlie (Senior Dev), Dana (QA Engineer), Elena (Junior Dev)

---

## Sprint Summary

| Epic | Title | Stories | Status |
|------|-------|---------|--------|
| 1 | Simulator Board & Deck Loading | 3 (1.1, 1.2, 1.3) | Done |
| 2 | Card Movement & Drag-Drop System | 3 (2.1, 2.2, 2.3) | Done |
| 3 | Card State & Effect Reading | 2 (3.1, 3.2) | Done |
| 4 | Zone Inspection & Deck Operations | 3 (4.1, 4.2, 4.3) | Done |
| 5 | Undo/Redo & Session Control | 2 (5.1, 5.2) | Done |

- **Delivery:** 13/13 stories (100%)
- **FRs covered:** FR1–FR34
- **NFRs covered:** NFR1–NFR10
- **First retrospective** — no prior retro to reference

---

## What Went Well

### Architecture & Design
- **Command stack silent accumulation** (Epic 2→5): CommandStackService infrastructure built in Epic 2, silently filled stacks through Epics 3–4, cleanly exposed in Epic 5. Story 5.1 was the cleanest story because it just surfaced existing work.
- **Auto-detect material detach in moveCard()** (4.3): Extension transparent to all existing callers — extensibility win.
- **Mutual exclusion via signal overwrite** (4.1): Eliminated complex coordination between overlays, material peek, and inspector.
- **Zone-centric data model** (`Record<ZoneId, CardInstance[]>`): Proved solid across all 13 stories, no refactoring needed.

### Process
- **Code review catching edge cases**: Most HIGH fixes were defensive ("what if null / order inverted / edge input"). Prevented real bugs from shipping.
- **Data model validation early**: XYZ `overlayMaterials` identified in Story 1.1, avoided later refactoring.
- **Signal-based architecture**: Immutability enforced via `update()` pattern prevented entire class of bugs.

### Patterns Established
- Command validation at construction (all commands capture and validate delta data early)
- 50ms debounce for hover/interactions (reduces flicker, natural drag suppression)
- Immutable updates via spread (`{ ...state, [zone]: [...newCards] }`) enforced everywhere
- Try/catch + `isDevMode()` console.warn for consistent error handling

---

## Challenges & Struggles

### Recurring Technical Struggles
- **Array indexing ambiguity**: "Top of deck" = last element; `slice(0, n)` vs `slice(-n)` caught in code review (Story 4.2 — CRITICAL fix)
- **Fixed-size data structures**: Deck with 60 slots and empty slots (`index === -1`) required explicit filtering
- **Undo semantics**: Distinguishing operations that should undo atomically vs sequentially (mill = CompositeCommand)

### Code Review HIGH Fixes (pattern)
- Exception handling in drop handlers (2.2)
- `slice(-n).reverse()` for correct undo semantics on mill (4.2)
- Missing try/catch + `isDevMode()` on undo/redo calls (5.1)
- Mutual exclusion: `openDeckSearch()`/`openDeckReveal()` not closing material peek (4.3)
- `setHoveredCard(null)` vs `.set(null)` — 50ms timeout stale state (5.2)

### Key Insight
Code reviews consistently caught edge cases that developers missed in initial implementation. The HIGH fix count is not a quality problem — it's the review process working as designed.

---

## Technical Debt

| Item | Source | Severity | Notes |
|------|--------|----------|-------|
| `window.confirm()` for reset dialog | Story 5.2 | Low | MatDialog is post-MVP enhancement |
| `prefers-reduced-motion` dev toggle | UX Spec | Low | Mentioned in spec, never assigned to a story |
| Glow effect duplication | Story 2.2 | Resolved | Extracted to `glow-effect.ts` factory |

---

## Post-MVP Improvements Identified

### A. Layout fixe — UX Redesign
- Board must fit entirely in viewport, no scroll, no zone compression
- Fixed-size zones with proportional scaling per device ("zoom-out" Master Duel style)
- **Requires UX Design Spec update before implementation**

### B. Face-down Card Bugs (4 fixes)
1. **Board rendering**: Face-down card displays card back image (currently invisible/disappearing — visual bug)
2. **Inspector face-down**: Show full card details even for face-down cards (spec change FR28 — justified by solo simulator context, player knows own cards)
3. **Extra Deck overlay**: Display cards face-up (like main deck overlay), remove eye icon and "Face down" grouping. In Yu-Gi-Oh!, ED contents are known to the owner — only hidden from opponent.
4. **Deck/ED zone visual**: Show a card-back image when `count > 0` (currently appears empty)

### C. Right-click Context Menu
- Force `event.preventDefault()` on the entire board, including in `isDevMode()`
- Navbar retains native browser context menu

### D. Collapsible Navbar
- Toggle to collapse/expand the navbar for more board space

### E. Verification: Deck & ED Card Order Preservation
- Validate order is correctly preserved across all operations: shuffle, search + auto-shuffle on close, mill, reveal, drag from overlay, and undo/redo of each operation
- Historical risk: Story 4.2 had a CRITICAL `slice(-n)` bug that would have corrupted deck order on undo

---

## Lessons Learned

1. **Code review is the primary quality gate** — HIGH fixes in nearly every story caught real bugs before they shipped. The process works; maintain review rigor.
2. **"Top of deck" indexing is a recurring trap** — Array-end semantics need explicit team convention and testing.
3. **Silent infrastructure pays off** — Building CommandStackService in Epic 2 and exposing it in Epic 5 was the cleanest architectural decision of the sprint.
4. **Face-down card semantics need rethinking for solo context** — The 2-player Yu-Gi-Oh! rules (hidden information) don't translate directly to a solo simulator. Solo context means all information is visible to the player.
5. **Viewport-fitting layout should have been designed upfront** — CSS Grid with flexible zones causes compression/overflow issues that a fixed-ratio approach would prevent.

---

## Next Steps

1. **UX Spec update** for fixed layout + face-down behavior changes
2. **Fix face-down rendering bugs** (B.1–B.4) — highest priority, breaks current experience
3. **Force `preventDefault()` on board** (C) — quick fix
4. **Collapsible navbar** (D)
5. **Verify deck/ED order preservation** (E) — regression risk
6. **Layout redesign implementation** (A) — after UX spec update

---

*This is the first retrospective for skytrix. Future retrospectives should reference this document for action item follow-through.*
