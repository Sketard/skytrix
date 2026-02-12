# Story 6.2: Face-Down Card Behavior Fixes (Solo Context)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player testing combos solo,
I want face-down cards to behave correctly in all interaction contexts,
so that I can simulate face-down sets, flips, and inspections accurately.

## Acceptance Criteria

1. **Given** a face-down card is on the board,
   **When** I click on it to open the inspector,
   **Then** the inspector shows the full card details (name, image, stats, effects) — face-down is a positional state, not an information barrier in solo context.

2. **Given** a face-down card is on the board,
   **When** I drag it to another zone using CDK DragDrop,
   **Then** the drag preview shows the card back (not the front),
   **And** the card lands in the destination zone still face-down.

3. **Given** cards exist in the Extra Deck zone,
   **When** I open the ED overlay,
   **Then** all cards are displayed face-up (full art and details visible),
   **And** cards are displayed in a flat list — no grouping by face-up/face-down status.

4. **Given** a face-down card is in a pile zone (GY, Banished),
   **When** I open the pile overlay for that zone,
   **Then** the card is displayed face-up in the overlay (pile overlays always show full card info).

## Tasks / Subtasks

- [x] **Task 1: Fix inspector to show full details for face-down cards** (AC: 1)
  - [x] 1.1: In `card-inspector.component.html`, verify the template reads from `hoveredCard().card` (the card data), NOT from `hoveredCard().faceDown` to decide what to display
  - [x] 1.2: The inspector should ALWAYS show: card image (front), card name, attribute/race/level, ATK/DEF, full effect text — regardless of `faceDown` state
  - [x] 1.3: If the current template conditionally hides data when `faceDown === true`, remove that conditional
  - [x] 1.4: In `zone.component.ts` `onCardHovered()`, verify it calls `setHoveredCard(card)` with the full `CardInstance` (not a modified copy)

- [x] **Task 2: Fix drag preview to show card back for face-down cards** (AC: 2)
  - [x] 2.1: In `sim-card.component.html`, verify the CDK drag preview uses `isFaceDown` computed to determine visual
  - [x] 2.2: The `cdkDragPreview` template should render card back when `isFaceDown()` is true
  - [x] 2.3: Verify `MoveCardCommand` preserves `faceDown: true` when moving between zones — check command does not reset faceDown on move
  - [x] 2.4: Test: set a card face-down (via context menu), then drag it — preview should show card back, destination should show card back

- [x] **Task 3: Fix ED overlay to show all cards face-up, no grouping** (AC: 3)
  - [x] 3.1: In `pile-overlay.component.ts`, locate the `needsGrouping` computed signal that groups ED cards by face-up/face-down
  - [x] 3.2: Remove or bypass the grouping logic for ED zone: `needsGrouping` should be `false` when `activeZone === ZoneId.EXTRA_DECK`
  - [x] 3.3: In `pile-overlay.component.html`, when rendering ED cards, pass `[forceFaceDown]="false"` (or just don't pass it) to always show face-up
  - [x] 3.4: Remove any "eye" icon or face-down visual indicator for ED overlay cards
  - [x] 3.5: Ensure ED cards render as a flat list — no separate sections for face-up/face-down

- [x] **Task 4: Fix pile overlay to show face-down cards face-up** (AC: 4)
  - [x] 4.1: In `pile-overlay.component.html`, for GY and Banished overlays, ensure `[forceFaceDown]="false"` on `app-sim-card` in card rows — overlay always shows front of card
  - [x] 4.2: Banished zone may have a legitimate face-down banished state (game mechanic). In solo context, still show face-up in overlay for information. Keep the face-down indicator icon for Banished cards that are `faceDown: true` but show the card image face-up
  - [x] 4.3: GY overlay: all cards always face-up (GY cards are public knowledge even in competitive play)

- [ ] **Task 5: Verify build and visual check** (AC: all)
  - [x] 5.1: Run `ng build --configuration development` — zero errors
  - [ ] 5.2: Visual test: set a card face-down, hover it → inspector shows full details
  - [ ] 5.3: Visual test: drag a face-down card → preview shows card back
  - [ ] 5.4: Visual test: open ED overlay → all cards face-up, no grouping
  - [ ] 5.5: Visual test: open GY overlay with face-down card in it → card shown face-up

## Dev Notes

### Critical Architecture Constraints

- **Face-down is a positional state, not an information barrier.** In a solo simulator, the player knows all their own cards. The inspector MUST show full card details for face-down cards. This is explicitly stated in FR28, the UX spec, and the architecture doc. [Source: epics.md#FR28, ux-design-specification.md#SimCardInspectorComponent, architecture.md]
- **Drag preview MUST reflect visual board state.** A face-down card on the board shows card back. When dragged, the preview should also show card back for visual consistency. But the MoveCardCommand must preserve `faceDown: true`. [Source: epics.md#Story 6.2 AC 2]
- **Extra Deck overlay: all cards face-up, no grouping.** The ED is private knowledge in competitive play but in solo context, the player owns everything. No eye icon, no face-down/face-up groups, no separation. Just a flat list. [Source: epics.md#Story 6.2 AC 3, ux-design-specification.md#Extra Deck overlay]
- **Services scoped to SimulatorPageComponent.** [Source: architecture.md#Service Scoping Decision]

### Implementation Details

#### Current Pile Overlay Grouping Logic (pile-overlay.component.ts)

```typescript
// CURRENT — to be modified:
readonly isExtraDeck = computed(() => this.activeZone() === ZoneId.EXTRA_DECK);
readonly isBanished = computed(() => this.activeZone() === ZoneId.BANISH);
readonly faceDownCards = computed(() => this.cards().filter(c => c.faceDown));
readonly faceUpCards = computed(() => this.cards().filter(c => !c.faceDown));
readonly needsGrouping = computed(() =>
  (this.isExtraDeck() || this.isBanished()) && this.faceDownCards().length > 0
);
```

**Fix:** Change `needsGrouping` to exclude ED:

```typescript
// AFTER:
readonly needsGrouping = computed(() =>
  this.isBanished() && this.faceDownCards().length > 0
);
```

This removes grouping for ED entirely. For Banished, grouping is kept (face-down banished is a real game mechanic) but cards are displayed face-up in the overlay anyway.

#### Overlay Card Rendering — Force Face-Up

In `pile-overlay.component.html`, the `app-sim-card` in card rows should use:

```html
<app-sim-card
  [cardInstance]="card"
  [forceFaceDown]="false"
  size="board"
/>
```

This ensures all cards in any pile overlay are shown face-up (front image visible) regardless of their `faceDown` board state.

#### Inspector — Already Correct?

Check `card-inspector.component.html`. The inspector receives `hoveredCard()` which is a `CardInstance`. If the template simply reads `hoveredCard().card.name`, `hoveredCard().image.smallUrl`, etc. without checking `faceDown`, it already works correctly. **Verify — do not assume.**

If there IS a conditional like `@if (!hoveredCard().faceDown)`, remove it.

#### MoveCardCommand — Preserves faceDown

Check `commands/move-card.command.ts`. The command should copy the entire `CardInstance` to the target zone without resetting `faceDown`. If it creates a new object, verify `faceDown` is preserved.

### Edge Cases

- **Face-down card flipped face-up then dragged:** `faceDown` is now `false`. Drag preview shows front. Normal behavior.
- **Face-down card in hand:** Hand cards are always face-up visually. If somehow a face-down card ends up in hand (via game mechanic), inspector still shows full details.
- **ED with 0 cards:** Empty overlay with "No cards in Extra Deck" message. No grouping logic triggered.
- **Banished with mix of face-up and face-down cards:** Grouping applies (Banished keeps grouping) but all cards shown face-up in overlay with face-down indicator icon.

### NFR Compliance

- **NFR5 (<200ms inspector):** No change to inspector timing. Still 50ms debounce + signal propagation.
- **NFR6 (<300ms overlay):** No change to overlay timing. Removing grouping simplifies rendering slightly.

### What This Story Does NOT Include

- **No layout changes** — Story 6.1 handles 16:9 layout. This story only fixes card rendering behavior.
- **No new components** — Only modifications to existing components.
- **No context menu changes** — Context menu for flip/position toggle is unchanged.
- **No command changes** — Commands already handle faceDown correctly (verify, don't change).

### Cross-Story Dependencies

| This Story Creates | Used By |
|---|---|
| Correct face-down inspector behavior | All future stories (consistent behavior) |
| ED overlay without grouping | Story 6.5 (Deck View mode) |

### Previous Story Intelligence (Story 6.1)

**Patterns to follow:**
- Inspector is now always a side panel (6.1 removed responsive breakpoint)
- Board uses fixed 1280×720 layout with `transform: scale()`
- All SCSS uses `@use 'sim-tokens' as *`
- Service injection via `inject()` pattern

### Existing Code — What NOT to Change

| File | Keep As-Is | Reason |
|---|---|---|
| `simulator.models.ts` | Unchanged | CardInstance.faceDown is already correct |
| `board-state.service.ts` | Unchanged | hoveredCard signal works correctly |
| `command-stack.service.ts` | Unchanged | No command changes |
| `commands/flip-card.command.ts` | Unchanged | Flip command is correct |
| `commands/toggle-position.command.ts` | Unchanged | Position toggle is correct |
| `zone.component.ts` | Unchanged | onCardHovered passes full CardInstance |
| `hand.component.ts` | Unchanged | Hand hover works correctly |
| `board.component.*` | Unchanged | Board layout handled by 6.1 |
| `control-bar.component.*` | Unchanged | No UI changes |

### Project Structure Notes

- All files in `front/src/app/pages/simulator/`
- **0 new files** — all changes are modifications

**Files modified by this story:**
```
front/src/app/pages/simulator/
  card-inspector.component.html   # POSSIBLY MODIFIED — verify/fix face-down conditional display
  pile-overlay.component.ts       # MODIFIED — fix needsGrouping to exclude ED
  pile-overlay.component.html     # MODIFIED — forceFaceDown="false" on card rows, remove eye icon for ED
```

### References

- [Source: epics.md#Story 6.2] — Acceptance criteria, user story
- [Source: epics.md#FR28] — Face-down cards: inspector shows full details (solo context)
- [Source: epics.md#Additional Requirements] — Face-down is positional state, ED overlay all face-up
- [Source: ux-design-specification.md#SimCardInspectorComponent] — Face-down cards show full details
- [Source: ux-design-specification.md#Extra Deck overlay] — All cards face-up, no grouping, no eye icon
- [Source: architecture.md] — CardInstance.faceDown field
- [Source: pile-overlay.component.ts] — Current grouping logic (needsGrouping, faceDownCards, faceUpCards)
- [Source: card-inspector.component.html] — Current inspector template
- [Source: sim-card.component.ts] — forceFaceDown input, isFaceDown computed
- [Source: commands/move-card.command.ts] — Card movement preserves faceDown
- [Source: 6-1-fixed-16-9-board-layout-with-proportional-scaling.md] — Previous story patterns

## Change Log

- 2026-02-12: Implemented face-down card behavior fixes — inspector always shows full details, ED overlay flat list without grouping, all pile overlays force cards face-up, sim-card forceFaceDown input changed to nullable boolean for face-up override support
- 2026-02-12: [Code Review] Fixed stacked-zone showFaceDown regression (returned null instead of false for GY/Banished). Added [forceFaceDown]="false" to Banished face-up group for consistency. Removed dead isExtraDeck computed from pile-overlay. Added broken-image fallback on inspector. Updated Task 1 completion notes with drawer removal documentation and Task 1.4 verification. Fixed Task 5 parent marking (was [x] with incomplete subtasks).
- 2026-02-12: [Code Review #2] CRITICAL FIX — face-down cards rendered as colored rectangle (#1e293b) instead of Yu-Gi-Oh card back image. Replaced `<div class="card-back">` with `<img src="assets/images/card_back.jpg">` in sim-card template. Removed dead `.card-back` CSS class. Fixed inspector image error handler to show card_back.jpg fallback instead of hiding image. Added missing sim-card.component.html and sim-card.component.scss to File List.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build verified: `ng build --configuration development` — zero errors, 4.29s

### Completion Notes List

- **Task 1:** Removed `@if (isFaceDown())` conditional from inspector template. Inspector now always shows full card details (image, name, stats, effect) regardless of faceDown state. Removed unused `isFaceDown` computed from TS and `.card-back-large` CSS class from SCSS. Verified `zone.component.ts:99-100` — `onCardHovered()` passes full `CardInstance`, no change needed. Also removed unused responsive drawer code (`isExpanded`, `toggleDrawer`, `[class.expanded]`, `@media (max-width: 1279px)` SCSS block) — inspector is always a fixed side panel per revised UX spec (Story 6.1 alignment).
- **Task 2:** Verified existing behavior — sim-card renders card back when `isFaceDown()`, CDK uses element clone as drag preview (no explicit `cdkDragPreview`), MoveCardCommand preserves entire CardInstance including faceDown. No code changes needed.
- **Task 3:** Changed `needsGrouping` computed to exclude Extra Deck (`this.isBanished()` only). ED now renders as flat list in the `@else` branch. Updated `sim-card.component.ts`: changed `forceFaceDown` from `input(false)` to `input<boolean | null>(null)` and `isFaceDown` from `||` to `??` logic to support explicit face-up override.
- **Task 4:** Added `[forceFaceDown]="false"` to flat display section (covers ED, GY, search, reveal). For Banished grouped face-down section: added `[forceFaceDown]="false"`, changed label from "Face-down" to actual card name, kept `visibility_off` icon indicator, updated aria-label.
- **Task 5:** Build passes with zero errors. Visual tests 5.2–5.5 require manual verification by user.

### File List

- `front/src/app/pages/simulator/card-inspector.component.html` — Modified: removed face-down conditional, always shows full card details, image error fallback shows card_back.jpg instead of hiding
- `front/src/app/pages/simulator/card-inspector.component.ts` — Modified: removed unused `isFaceDown` computed signal, removed unused `isExpanded` signal + `toggleDrawer()` method + `[class.expanded]` host binding (drawer mode cleanup)
- `front/src/app/pages/simulator/card-inspector.component.scss` — Modified: removed unused `.card-back-large` class, removed responsive drawer `@media (max-width: 1279px)` block and `.drawer-bar` styles (inspector is always a fixed side panel per revised UX spec)
- `front/src/app/pages/simulator/sim-card.component.ts` — Modified: changed `forceFaceDown` input to `boolean | null` (default `null`), updated `isFaceDown` to use `??` instead of `||`
- `front/src/app/pages/simulator/sim-card.component.html` — Modified (review fix): replaced `<div class="card-back">` placeholder with `<img src="assets/images/card_back.jpg">` — face-down cards now display the actual Yu-Gi-Oh! card back image
- `front/src/app/pages/simulator/sim-card.component.scss` — Modified (review fix): removed unused `.card-back` CSS class (replaced by `<img>` tag with `.card-image` class)
- `front/src/app/pages/simulator/pile-overlay.component.ts` — Modified: `needsGrouping` excludes Extra Deck (Banished only), removed dead `isExtraDeck` computed
- `front/src/app/pages/simulator/pile-overlay.component.html` — Modified: added `[forceFaceDown]="false"` on all overlay cards (including Banished face-up group), Banished face-down group shows card name + face-down icon
- `front/src/app/pages/simulator/stacked-zone.component.ts` — Modified (review fix): `showFaceDown` returns `null` instead of `false` for GY/Banished to preserve card's faceDown state with new `??` semantics
