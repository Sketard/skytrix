# Story 7.5: XYZ Material Visual Enhancement

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want XYZ monsters to display stacked card-back indicators beneath them showing attached materials, and detached materials to slide out before traveling to the graveyard,
So that I can visually track XYZ material count and detachment events.

## Acceptance Criteria

### AC1: Stacked Material Indicators (Resting State)

**Given** a monster zone contains an XYZ monster with `overlayMaterials.length > 0`
**When** the zone renders
**Then** 1-3 small card-back colored rectangles are visible offset ~2px each below/behind the monster card (stacked effect)
**And** the offset scales proportionally with zone card size (use percentage-based or relative unit offsets, e.g., `0.05em`)
**And** the number of visible layers = `Math.min(overlayMaterials.length, 3)`
**And** the existing blue badge with material count is preserved on top

### AC2: No Materials = No Indicators

**Given** `overlayMaterials.length` is 0
**When** the zone renders
**Then** no stacked indicators are displayed

### AC3: Material Detach Slide-Out + Travel

**Given** a MSG_MOVE event detaches a material from an XYZ monster overlay to GY
**When** the orchestrator processes the event
**Then** one stacked card "slides out" from under the XYZ monster (vertical offset + slide animation, ~200ms)
**And** then performs a standard travel animation toward GY (departure point = XYZ parent monster position with slight vertical offset downward)
**And** badge count updates (e.g., 3 -> 2), one stacked indicator disappears after the slide-out completes

### AC4: Overlay fromLocation Detection

**Given** a MSG_MOVE event originates from the overlay zone (`fromLocation = OVERLAY`)
**When** the orchestrator determines the animation type
**Then** it triggers the XYZ detach slide-out + travel animation (AC3)
**And** if `fromLocation = MZONE` (not OVERLAY), it triggers a standard destroy travel animation (Story 7.2) -- the `fromLocation` field distinguishes detach from normal monster destruction

### AC5: EMZ Overflow Fix

**Given** `.emz-slot` (`.emz` class) has `overflow: hidden`
**When** this story is complete
**Then** it is changed to `overflow: visible` to prevent clipping of stacked material indicators on EMZ-positioned XYZ monsters

### AC6: Reduced Motion

**Given** `prefers-reduced-motion: reduce` is active
**When** a material is detached
**Then** no slide-out animation -- indicator disappears instantly, badge updates, no travel

### AC7: Material Re-Attachment

**Given** a card effect re-attaches a material to an XYZ monster (e.g., via MSG_MOVE with `toLocation = OVERLAY`)
**When** `overlayMaterials.length` increases
**Then** the stacked indicators update reactively -- a new indicator layer appears (no animation needed, instant addition)
**And** the badge count updates accordingly

### AC8: Speed Multiplier

**Given** the speed multiplier is active
**When** the detach slide-out animation plays
**Then** the 200ms base duration is multiplied by the speed factor (100ms floor)

## Tasks / Subtasks

- [x] Task 1: Add OVERLAY constant to LOCATION (AC4)
  - [x] 1.1 Add `OVERLAY: 0x80` to `LOCATION` in `duel-server/src/ws-protocol.ts`
  - [x] 1.2 Add `OVERLAY: 0x80` to `LOCATION` in `front/src/app/pages/pvp/duel-ws.types.ts` (mirrored file)

- [x] Task 2: Add OVERLAY handling to locationToZoneKey (AC4)
  - [x] 2.1 In `pvp-zone.utils.ts`, add a case for `LOCATION.OVERLAY` in `locationToZoneKey()`: resolve to the parent monster zone using `MZONE` + `sequence` (OCGCore sends `fromSequence` = parent monster's zone sequence for overlay detach). Return the same key as `locationToZoneId(LOCATION.MZONE, sequence)` + `-${relativePlayer}`
  - [x] 2.2 Ensure `locationToZoneId` is NOT modified -- overlay is not a field zone, the resolution is handled only in `locationToZoneKey`

- [x] Task 3: Add stacked material indicators CSS (AC1, AC2)
  - [x] 3.1 In `pvp-board-container.component.scss`, add `.xyz-material-stack` class with pseudo-elements or generated layers:
    - Position: absolute, behind the card (`z-index: -1`)
    - Each layer offset by ~2px downward and ~1px right (proportional to card size)
    - Background: card-back color (`#1e293b` or similar dark tone with subtle border `rgba(0, 212, 255, 0.15)`)
    - Max 3 visible layers via data-attribute or class modifier (`.xyz-material-stack--1`, `--2`, `--3`)
    - Border-radius matching card corners
  - [x] 3.2 Add `@media (prefers-reduced-motion: reduce)` -- no transition on indicator appearance/disappearance

- [x] Task 4: Update HTML template for stacked indicators (AC1, AC2)
  - [x] 4.1 In `pvp-board-container.component.html`, wrap each monster zone card in a container that includes the stacked indicator element. The indicator renders when `overlayMaterials.length > 0` and passes the count via a data attribute or class modifier
  - [x] 4.2 Apply to all three XYZ indicator locations: opponent zones (line ~55), EMZ slots (line ~112), player zones (line ~226)
  - [x] 4.3 Preserve the existing `.xyz-indicator` badge (cyan circle with count number) on top

- [x] Task 5: EMZ overflow fix (AC5)
  - [x] 5.1 In `pvp-board-container.component.scss`, change `.emz { overflow: hidden }` to `overflow: visible`

- [x] Task 6: Add XYZ detach slide-out animation in orchestrator (AC3, AC4, AC6, AC8)
  - [x] 6.1 In `processMoveEvent()`, add a new condition BEFORE the destroy condition: if `from === LOCATION.OVERLAY && (to === LOCATION.GRAVE || to === LOCATION.BANISHED)` -> call `processOverlayDetachEvent(msg)`
  - [x] 6.2 Implement `processOverlayDetachEvent(msg: MoveMsg): number`:
    - Compute `relPlayer` from `msg.player` vs `ownPlayerIndexFn()`
    - If `this._reducedMotion` -> return `0` (AC6)
    - Resolve source zone key: use `locationToZoneKey(LOCATION.MZONE, msg.fromSequence, relPlayer)` -- the parent monster's zone (fromSequence = parent zone sequence in OCGCore overlay moves)
    - Resolve destination zone key: `locationToZoneKey(to, msg.toSequence, relPlayer)` (typically GY)
    - Compute slide-out duration: `Math.max(100, Math.round(200 * this.speedMultiplierFn()))` (AC8)
    - Compute travel duration: `Math.max(200, Math.round(400 * this.speedMultiplierFn()))`
    - Card image: card back URL `this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg')` (overlay materials are usually hidden)
    - Step 1: Add CSS class `pvp-xyz-detach` to source zone element (via `this.cardTravelService.getZoneElement(srcKey)`) for slide-out animation
    - Step 2: After slide-out duration, call `this.cardTravelService.travel(srcKey, dstKey, cardBackImage, { duration: travelDuration, showBack: true, departureGlowColor: 'rgba(0, 150, 255, 0.4)' })` (blue glow matching XYZ theme)
    - Schedule class removal after slide-out: push timeout to `this.animationTimeouts[]`
    - Announce: `this.announceEvent('Material detached', msg.player)`
    - Return `200 + 400` (slide-out base + travel base -- queue loop applies speedMultiplier for setTimeout)
  - [x] 6.3 Handle `toLocation = OVERLAY` (re-attachment, AC7): add a condition in `processMoveEvent()` -- if `to === LOCATION.OVERLAY` -> return `0` (no animation, indicators update reactively via BOARD_STATE)

- [x] Task 7: CSS keyframes for XYZ detach slide-out (AC3)
  - [x] 7.1 In `pvp-board-container.component.scss`, add `@keyframes pvp-xyz-detach-slide`:
    - `0%`: normal position (same as stacked indicator offset)
    - `100%`: translated downward ~10px (slide out from under XYZ monster)
  - [x] 7.2 `.pvp-xyz-detach` class applies the animation to one pseudo-element layer
  - [x] 7.3 Add `@media (prefers-reduced-motion: reduce)` override: `animation: none`

- [x] Task 8: Detach animation during chain resolution (buffer/replay)
  - [x] 8.1 MSG_MOVE with `fromLocation = OVERLAY` is already a MSG_MOVE -- it's already in `BOARD_CHANGING_EVENTS` and gets buffered during chain resolution
  - [x] 8.2 In `replayBufferedEvents()`, the existing Beat 1 dispatch for MSG_MOVE will call `processMoveEvent()` which routes to `processOverlayDetachEvent()` via the new condition -- no replay changes needed
  - [x] 8.3 Verify that the slide-out + travel total duration is accounted for in Beat 1 stagger calculation

- [x] Task 9: Manual Verification (all ACs)
  - [ ] 9.1 Verify: XYZ monster with 2+ materials shows stacked card-back indicators beneath it
  - [ ] 9.2 Verify: material count badge (cyan circle) still displays correctly on top
  - [ ] 9.3 Verify: EMZ-positioned XYZ monster indicators are not clipped (overflow: visible)
  - [ ] 9.4 Verify: detaching a material (e.g., using XYZ effect) shows slide-out + travel to GY
  - [ ] 9.5 Verify: after detach, stacked indicators update (3->2 layers, badge 3->2)
  - [ ] 9.6 Verify: 0 materials remaining = no indicators, no badge
  - [ ] 9.7 Verify: `prefers-reduced-motion: reduce` -- no slide-out, no travel, instant update
  - [ ] 9.8 Verify: speed multiplier affects detach slide-out and travel durations
  - [ ] 9.9 Verify: detach during chain resolution is buffered and replays correctly in Beat 1
  - [x] 9.10 Verify: build passes with zero errors

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` -- NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects -- always `.set()` or `.update()` with new reference.
- **Component-scoped services**: `AnimationOrchestratorService` and `CardTravelService` are both provided in `DuelPageComponent.providers` -- direct injection works.
- **No new dependencies**: Pure Web Animations API + Angular signals + CSS keyframes + DOM API.
- **TypeScript strict mode**: `strict: true` in tsconfig. All types must be explicit.
- **Big bang testing approach**: No automated tests until full MVP -- manual verification only.

### Critical: OVERLAY Location Not in LOCATION Constants

**DISCOVERY**: OCGCore uses `0x80` for overlay location. When a material is detached via MSG_MOVE, the server sends:
```typescript
fromLocation = 0x80  // OVERLAY
fromSequence = N     // Parent monster's zone sequence (0-4 for M1-M5, 5-6 for EMZ)
toLocation = 0x10    // GRAVE
toSequence = N       // GY sequence
```

But `LOCATION` in both `ws-protocol.ts` and `duel-ws.types.ts` currently only has:
```typescript
export const LOCATION = {
  DECK: 0x01,
  HAND: 0x02,
  MZONE: 0x04,
  SZONE: 0x08,
  GRAVE: 0x10,
  BANISHED: 0x20,
  EXTRA: 0x40,
} as const;
```

**Action required**: Add `OVERLAY: 0x80` to BOTH files. The server's `transformMessage()` already passes `msg.from.location as number` through a raw cast (line 205 of `duel-worker.ts`), so the value `0x80` is already being sent -- it just wasn't recognized client-side. Currently, `processMoveEvent()` falls through all conditions and returns `0` (no animation) for overlay detach events.

### Critical: locationToZoneKey for OVERLAY

`locationToZoneKey(LOCATION.OVERLAY, sequence, relPlayer)` currently returns `UNKNOWN-X` because OVERLAY isn't handled. For detach animation, the source zone is the XYZ parent monster's physical zone. OCGCore sets `fromSequence` to the parent monster's zone sequence.

**Solution**: In `locationToZoneKey`, when `location === LOCATION.OVERLAY`, delegate to `locationToZoneId(LOCATION.MZONE, sequence)` to resolve the parent monster zone. This gives us the correct source rect for the slide-out animation departure point.

```typescript
// In pvp-zone.utils.ts locationToZoneKey():
case LOCATION.OVERLAY: {
  // Overlay fromSequence = parent monster's zone sequence
  const parentZoneId = locationToZoneId(LOCATION.MZONE, sequence);
  return parentZoneId ? `${parentZoneId}-${relativePlayer}` : `UNKNOWN-${relativePlayer}`;
}
```

### Critical: processOverlayDetachEvent() Pattern

```typescript
private processOverlayDetachEvent(msg: MoveMsg): number {
  if (this._reducedMotion) return 0; // AC6
  const relPlayer = msg.player === this.ownPlayerIndexFn() ? 0 : 1;
  // Source = parent XYZ monster zone (OVERLAY fromSequence = parent zone seq)
  const srcKey = locationToZoneKey(LOCATION.OVERLAY, msg.fromSequence, relPlayer);
  const dstKey = locationToZoneKey(msg.toLocation, msg.toSequence, relPlayer);
  const slideOutDuration = Math.max(100, Math.round(200 * this.speedMultiplierFn()));
  const travelDuration = Math.max(200, Math.round(400 * this.speedMultiplierFn()));
  const cardBackImage = this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg');

  // Step 1: Slide-out CSS class on parent zone
  const srcElement = this.cardTravelService.getZoneElement(srcKey);
  if (srcElement) {
    srcElement.classList.add('pvp-xyz-detach');
    const tid = setTimeout(() => {
      srcElement.classList.remove('pvp-xyz-detach');
      // Step 2: Travel to GY after slide-out
      this.cardTravelService.travel(srcKey, dstKey, cardBackImage, {
        duration: travelDuration,
        showBack: true,
        departureGlowColor: 'rgba(0, 150, 255, 0.4)',
      });
    }, slideOutDuration);
    this.animationTimeouts.push(tid);
  }

  this.announceEvent('Material detached', msg.player);
  return 600; // 200 slide-out + 400 travel base
}
```

**Key decisions:**
- Source zone = parent XYZ monster zone (resolved via OVERLAY + MZONE delegation)
- Card back image always (overlay materials are hidden from opponent)
- Blue departure glow (matches XYZ cyan theme)
- Two-phase: CSS slide-out then CardTravelService travel (same pattern as shuffle in 7.4)
- Return `600` (200 + 400 base) -- queue loop applies speedMultiplier for setTimeout delay

### Critical: Condition Order in processMoveEvent()

The overlay detach condition MUST be checked BEFORE the destroy condition. Both match `to === LOCATION.GRAVE`, but overlay detach has `from === LOCATION.OVERLAY` while destroy has `from === LOCATION.MZONE`. Place the overlay check first:

```typescript
// NEW: XYZ overlay detach (OVERLAY -> GRAVE/BANISHED)
if (from === LOCATION.OVERLAY && (to === LOCATION.GRAVE || to === LOCATION.BANISHED)) {
  return this.processOverlayDetachEvent(msg);
}

// Existing: Destroy (MZONE/SZONE -> GRAVE/BANISHED)
if ((from === LOCATION.MZONE || from === LOCATION.SZONE)
  && (to === LOCATION.GRAVE || to === LOCATION.BANISHED)) {
  // ... existing destroy logic
}
```

### Critical: Re-Attachment (toLocation = OVERLAY) is a No-Op

When a card is attached to an XYZ monster (MSG_MOVE with `toLocation = OVERLAY`), the stacked indicators update automatically via BOARD_STATE (reactive rendering). No animation needed. Add an early return:

```typescript
// Re-attachment to overlay: no animation, indicators update via BOARD_STATE
if (to === LOCATION.OVERLAY) return 0;
```

### Critical: Stacked Indicators Implementation

Use CSS pseudo-elements or `@for` loop with Angular control flow. The indicators go BEHIND the card (`z-index: -1`), offset downward. Approach options:

**Option A: CSS pseudo-elements with data attribute** (simpler, max 3):
```html
<div class="xyz-material-stack" [attr.data-count]="Math.min(zone.card.overlayMaterials.length, 3)">
```
```scss
.xyz-material-stack {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
.xyz-material-stack[data-count="1"]::before,
.xyz-material-stack[data-count="2"]::before,
.xyz-material-stack[data-count="3"]::before {
  content: '';
  position: absolute;
  inset: 0;
  background: #1e293b;
  border: 1px solid rgba(0, 212, 255, 0.15);
  border-radius: var(--pvp-radius-sm, 0.15rem);
  transform: translate(1px, 2px);
}
.xyz-material-stack[data-count="2"]::after,
.xyz-material-stack[data-count="3"]::after {
  content: '';
  position: absolute;
  inset: 0;
  background: #1e293b;
  border: 1px solid rgba(0, 212, 255, 0.15);
  border-radius: var(--pvp-radius-sm, 0.15rem);
  transform: translate(2px, 4px);
}
// Third layer via a sibling div for count >= 3
```

**Option B: Angular @for loop** (more flexible, consistent with simulator CardComponent pattern):
```html
@if (zone.card.overlayMaterials.length > 0) {
  <div class="xyz-material-stack">
    @for (i of materialLayers(zone.card.overlayMaterials.length); track i) {
      <div class="xyz-material-layer"
           [style.transform]="'translate(' + (i+1) + 'px, ' + ((i+1)*2) + 'px)'">
      </div>
    }
  </div>
}
```

**Recommendation**: Use Option A (CSS pseudo-elements) -- no extra Angular rendering, pure CSS, consistent with the `.zone-pile--stack` pseudo-element pattern used for deck/GY/banished piles. Max 3 layers is sufficient.

### Critical: EMZ Overflow Change

```scss
// BEFORE (line 81):
.emz {
  overflow: hidden;
}

// AFTER:
.emz {
  overflow: visible;
}
```

This prevents stacked material indicators from being clipped on EMZ-positioned XYZ monsters. Regular `.zone` already uses `overflow: visible`.

### Critical: What NOT to Touch

- **duel-server/** -- only `ws-protocol.ts` needs the OVERLAY constant (no server logic changes)
- **CardTravelService** -- `travel()` API unchanged, `getZoneElement()` already available from Story 7.4
- **duel-connection.ts** -- no changes (MSG_MOVE already enqueued)
- **animation-orchestrator `replayBufferedEvents()`** -- no changes (MSG_MOVE already in Beat 1, routing to overlay detach is automatic via `processMoveEvent()`)
- **pvp-chain-overlay** -- no changes
- **Prompt components** -- no changes
- **game-event.types.ts** -- no changes (MSG_MOVE already in GameEvent union)

### Critical: MoveMsg Type Widening for OVERLAY

The `MoveMsg.fromLocation` and `toLocation` fields are typed as `CardLocation`, which is derived from `(typeof LOCATION)[keyof typeof LOCATION]`. After adding `OVERLAY: 0x80` to LOCATION, the type automatically widens to include the new value. No interface changes needed.

### Previous Story Intelligence (7.4)

From Story 7.4 implementation:
- **`getZoneElement()` is available** on `CardTravelService` -- registered by `PvpBoardContainerComponent` in `ngAfterViewInit()`. Use it to get the source zone DOM element for the slide-out CSS class.
- **CSS class add/remove pattern**: Same as `pvp-deck-shuffle` in Story 7.4 -- add class, setTimeout removal, push timeout to `animationTimeouts[]`.
- **`_reducedMotion` guard**: Added to `processDrawEvent()` in 7.4 code review fix H1. Follow same pattern for overlay detach.
- **Speed multiplier dual application**: Applied once in method for animation duration, return base duration for queue setTimeout.

### Previous Story Intelligence (7.2)

- **`processMoveEvent()` is the routing hub**: All MSG_MOVE events flow through it. Add overlay detach condition at the TOP (before destroy condition).
- **`toAbsoluteUrl()` public** on CardTravelService -- use for card back image.
- **Fire-and-forget `travel()`**: Don't await, return base duration synchronously.

### Previous Story Intelligence (7.1)

- **Zone key format**: `"${ZoneId}-${relativePlayerIndex}"` (e.g., `"M3-0"`, `"GY-1"`)
- **z-index 1000** for floating elements -- above board (~100), below chain overlay (~2000).

### Git Intelligence

Recent commits:
- `6be29ce3` 7-3 -- Story 7.3 (buffer & replay during chain resolution)
- `061f8563` 7-2 -- Story 7.2 (travel animations for MSG_MOVE)
- `6f55ef08` 7-1 -- Story 7.1 (CardTravelService + zone registry)
- Pattern: feature-focused commits, build validation before commit

### Source Tree -- Files to Modify

**MODIFY (5 files):**
- `duel-server/src/ws-protocol.ts` -- Add `OVERLAY: 0x80` to LOCATION constant
- `front/src/app/pages/pvp/duel-ws.types.ts` -- Add `OVERLAY: 0x80` to LOCATION constant (mirrored)
- `front/src/app/pages/pvp/pvp-zone.utils.ts` -- Add OVERLAY case in `locationToZoneKey()` delegating to MZONE resolution
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` -- Add `processOverlayDetachEvent()`, overlay detach condition in `processMoveEvent()`, OVERLAY re-attachment no-op
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` -- Add `.xyz-material-stack` indicators, `@keyframes pvp-xyz-detach-slide`, `.pvp-xyz-detach` class, change `.emz` overflow to visible

**MODIFY (1 file, template only):**
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` -- Add stacked indicator elements in all 3 XYZ indicator locations

**DO NOT TOUCH:**
- `duel-server/` (other than ws-protocol.ts) -- no server logic changes
- `card-travel.service.ts` -- travel API unchanged, getZoneElement() already available
- `duel-connection.ts` -- MSG_MOVE already enqueued
- `animation-orchestrator replayBufferedEvents()` -- no replay changes needed
- `pvp-chain-overlay/` -- no overlay changes
- `game-event.types.ts` -- MSG_MOVE already in GameEvent union
- Prompt components -- no prompt changes

### Enforcement Rules (from architecture-pvp.md)

1. **Card travel minimum duration floor: 200ms** after speed multiplier -- apply to detach travel
2. **All floating elements MUST be cleaned up** on animation completion -- CardTravelService handles this
3. **Buffer & replay ONLY during chain resolution** (`_insideChainResolution = true`) -- overlay detach MSG_MOVE is already buffered
4. **Beat ordering fixed**: Beat 1 (zone travels including overlay detach) completes before Beat 2 (LP)
5. **Never mutate game state from visual components** -- only orchestrator controls animation timing
6. **Overlay <-> orchestrator unidirectional** -- overlay calls only `replayBufferedEvents()`
7. **All CSS class setTimeout MUST be tracked** in `animationTimeouts[]` -- clean up on `destroy()`

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md -- Epic 7 Story 7.5 acceptance criteria, lines 1154-1202]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md -- AnimationOrchestratorService, CardTravelService API, enforcement rules, anti-patterns, timing reference table, EMZ overflow rule]
- [Source: _bmad-output/planning-artifacts/ux-design-board-animations.md -- XYZ material visual enhancement (Section 2.5), timing table (Section 3), reduced motion (Section 4)]
- [Source: _bmad-output/implementation-artifacts/7-4-msg-draw-travel-msg-shuffle-hand-animation.md -- getZoneElement() pattern, CSS class add/remove pattern, _reducedMotion guard, speed multiplier]
- [Source: _bmad-output/implementation-artifacts/7-2-card-travel-animations-msg-move-events.md -- processMoveEvent() routing, fire-and-forget travel, toAbsoluteUrl()]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts -- LOCATION constants (missing OVERLAY), MoveMsg interface, CardOnField.overlayMaterials]
- [Source: front/src/app/pages/pvp/pvp-zone.utils.ts -- locationToZoneKey() and locationToZoneId() functions]
- [Source: front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts -- processMoveEvent() routing, processDrawEvent() pattern, _reducedMotion guard]
- [Source: front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss -- .xyz-indicator (lines 293-309), .emz overflow:hidden (line 81)]
- [Source: front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html -- XYZ indicator @if blocks (lines ~55, ~112, ~226)]
- [Source: duel-server/src/duel-worker.ts -- MSG_MOVE transformMessage (line 204-208), fromLocation raw cast from OCGCore]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build error: `CardLocation` type widened to include `0x80` broke `Record<CardLocation, string>` in `zone-icons.ts` — fixed by adding `OVERLAY` key mapping to mzone icon.

### Completion Notes List

- Task 1: Added `OVERLAY: 0x80` to LOCATION constants in both mirrored protocol files (ws-protocol.ts, duel-ws.types.ts)
- Task 2: Added OVERLAY case in `locationToZoneKey()` delegating to MZONE resolution via `locationToZoneId()` — `locationToZoneId` left unmodified as specified
- Task 3: Added `.xyz-material-stack` CSS using pseudo-elements with `data-count` attribute (1-3 layers), matching `.zone-pile--stack` pattern. Added reduced motion overrides.
- Task 4: Added `xyz-material-stack` div in all 3 XYZ indicator locations (opponent zones, EMZ slots, player zones) with `data-count` binding. Preserved existing `.xyz-indicator` badge on top.
- Task 5: Changed `.emz { overflow: hidden }` to `overflow: visible`
- Task 6: Added `processOverlayDetachEvent()` with two-phase animation (CSS slide-out → CardTravelService travel), overlay detach condition BEFORE destroy in `processMoveEvent()`, and `to === OVERLAY` re-attachment no-op return
- Task 7: Added `@keyframes pvp-xyz-detach-slide` and `.pvp-xyz-detach` class targeting `::before` pseudo-element, with reduced motion override
- Task 8: Verified MSG_MOVE with OVERLAY is already buffered during chain resolution (in BOARD_CHANGING_EVENTS set). Beat 1 replay routes through `processMoveEvent()` → `processOverlayDetachEvent()` automatically. No code changes needed.
- Build fix: Added `OVERLAY` entry to `ZONE_ICON_MAP` in `zone-icons.ts` (maps to mzone icon)
- Task 9: Build passes with zero errors on both frontend and duel-server. Manual verification subtasks left unchecked for user testing.

### Change Log

- 2026-03-10: Story 7.5 implementation complete — XYZ material visual enhancement (stacked indicators, detach slide-out animation, EMZ overflow fix, OVERLAY location constant)
- 2026-03-10: Code review fixes (5 issues) — H1: added 3rd material layer via child div, H2: detach CSS duration via --pvp-detach-duration variable, M1: px offsets → % proportional, M2: use LOCATION.OVERLAY in processOverlayDetachEvent, L1: resolved by H1

### File List

- duel-server/src/ws-protocol.ts (modified — added OVERLAY: 0x80)
- front/src/app/pages/pvp/duel-ws.types.ts (modified — added OVERLAY: 0x80)
- front/src/app/pages/pvp/pvp-zone.utils.ts (modified — OVERLAY case in locationToZoneKey)
- front/src/app/pages/pvp/zone-icons.ts (modified — OVERLAY entry in ZONE_ICON_MAP)
- front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts (modified — processOverlayDetachEvent, overlay conditions in processMoveEvent)
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html (modified — xyz-material-stack divs in 3 locations)
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss (modified — xyz-material-stack CSS, detach keyframes, EMZ overflow fix, reduced motion)
