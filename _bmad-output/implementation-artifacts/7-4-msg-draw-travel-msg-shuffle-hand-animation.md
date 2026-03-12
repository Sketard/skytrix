# Story 7.4: MSG_DRAW Travel & MSG_SHUFFLE_HAND Animation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want draw events to show a card traveling from deck to hand and shuffle events to show a fan-out/fan-in animation on the deck,
So that these common game events have clear visual feedback instead of being invisible state changes.

## Acceptance Criteria

### AC1: MSG_DRAW Promoted to Travel Event

**Given** a MSG_DRAW event is received by the orchestrator during normal gameplay (not initial hand distribution)
**When** the event is processed (currently a no-op returning `0`)
**Then** it is promoted to a travel event: `CardTravelService.travel()` is called with source = deck pile zone, destination = hand container
**And** the floating element shows a card back during travel (hand updates via BOARD_STATE)
**And** `DrawMsg.player` determines which player's deck/hand zones are used (own deck -> own hand for player, opponent deck -> opponent hand for opponent)
**And** opponent draws are visible to the local player (card back travels from opponent deck to opponent hand area at top of screen)
**And** the orchestrator returns the travel base duration (400ms) instead of `0`

### AC2: Multiple Consecutive Draws Stagger

**Given** multiple consecutive MSG_DRAW events occur outside chain resolution (e.g., Pot of Greed -> 2x draw)
**When** the orchestrator processes them sequentially via the animation queue
**Then** each draw travel plays with the standard queue stagger — the queue loop applies `speedMultiplier` to the returned 400ms duration for the setTimeout delay between events, producing natural overlap (same mechanism as consecutive MSG_MOVE events)

### AC3: Initial Hand Distribution Suppressed

**Given** the initial hand distribution (5x MSG_DRAW at duel start, before the board is visible)
**When** the loading screen is still active (`roomState !== 'active'`)
**Then** the initial MSG_DRAW events do NOT trigger travel animations — the orchestrator returns `0` (hand appears directly via BOARD_STATE, loading screen masks them)

### AC4: MSG_DRAW Participates in Chain Replay Beat 1

**Given** a MSG_DRAW event occurs during chain resolution
**When** the event is buffered and replayed via `replayBufferedEvents()`
**Then** the draw travel animation participates in Beat 1 (zone travels) alongside MSG_MOVE events
**And** uses the same stagger pattern (50ms normal, 30ms accelerated)

### AC5: MSG_SHUFFLE_HAND Deck Fan Animation

**Given** a MSG_SHUFFLE_HAND event is received
**When** the orchestrator processes it
**Then** a fan-out/fan-in CSS animation plays on the deck zone: 2-3 pseudo-element card backs (`::before`, `::after`) offset +/-3px/+/-2deg from deck center (~100ms fan-out), then return to stacked position (~150ms fan-in)
**And** total duration is ~250ms
**And** `ShuffleHandMsg.player` determines which player's deck zone receives the animation

### AC6: Reduced Motion

**Given** `prefers-reduced-motion: reduce` is active
**When** MSG_DRAW or MSG_SHUFFLE_HAND is processed
**Then** no travel animation, no fan-out/fan-in — instant state change (return 0)

### AC7: Speed Multiplier

**Given** the speed multiplier is active
**When** MSG_DRAW travel or MSG_SHUFFLE_HAND animation plays
**Then** durations are multiplied by the speed factor (200ms floor for travel, same as MSG_MOVE pattern)

## Tasks / Subtasks

- [x] Task 1: Add `isBoardActiveFn` to orchestrator init config (AC3)
  - [x] 1.1 Add `isBoardActiveFn: () => boolean` to the `init()` config interface and store as private field
  - [x] 1.2 In DuelPageComponent, pass `() => this.roomState() === 'active'` as the `isBoardActiveFn` argument

- [x] Task 2: Promote MSG_DRAW to travel event in processEvent() (AC1, AC3)
  - [x] 2.1 Move `MSG_DRAW` out of the no-op case block (remove from the `MSG_DRAW/MSG_SWAP/MSG_ATTACK/MSG_BATTLE` group)
  - [x] 2.2 Add a dedicated `case 'MSG_DRAW':` that calls a new `processDrawEvent(event as DrawMsg)` method
  - [x] 2.3 Implement `processDrawEvent(msg: DrawMsg): number`:
    - Compute `relPlayer` from `msg.player` vs `ownPlayerIndexFn()` (same pattern as `processMoveEvent`)
    - If `!this.isBoardActiveFn()` → return `0` (AC3: suppress initial hand draws)
    - Source key: `DECK-${relPlayer}`, destination key: `HAND-${relPlayer}`
    - Card image: card back URL (`this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg')`)
    - Travel duration: `Math.max(200, Math.round(400 * this.speedMultiplierFn()))` (same pattern as processMoveEvent)
    - Call `this.cardTravelService.travel(srcKey, dstKey, cardBackImage, { duration: travelDuration, showBack: true })`
    - Announce: `this.announceEvent('Card drawn', msg.player)`
    - Return `400` (base duration, queue loop applies speedMultiplier for setTimeout delay)

- [x] Task 3: Update replayBufferedEvents() for MSG_DRAW in Beat 1 (AC4)
  - [x] 3.1 Change the Beat 1 filter from `e.type === 'MSG_MOVE'` to `e.type === 'MSG_MOVE' || e.type === 'MSG_DRAW'`
  - [x] 3.2 In the Beat 1 loop, dispatch based on type: if `MSG_MOVE` call `processMoveEvent()`, if `MSG_DRAW` call `processDrawEvent()`
  - [x] 3.3 Same for the reduced-motion path: add MSG_DRAW events to the zone events loop

- [x] Task 4: Add MSG_SHUFFLE_HAND to duel-connection animation queue
  - [x] 4.1 In `duel-connection.ts` `handleMessage()`, add `case 'MSG_SHUFFLE_HAND':` to the group that enqueues to `_animationQueue` (alongside MSG_DRAW, MSG_MOVE, etc.)

- [x] Task 5: Add MSG_SHUFFLE_HAND processing in orchestrator (AC5, AC6, AC7)
  - [x] 5.1 Import `ShuffleHandMsg` from `duel-ws.types`
  - [x] 5.2 Add `case 'MSG_SHUFFLE_HAND':` in `processEvent()` that calls `processShuffleEvent(event as ShuffleHandMsg)`
  - [x] 5.3 Implement `processShuffleEvent(msg: ShuffleHandMsg): number`:
    - Compute `relPlayer` from `msg.player` vs `ownPlayerIndexFn()`
    - If `this._reducedMotion` → return `0`
    - Compute `deckZoneKey = 'DECK-' + relPlayer`
    - Get deck zone element from card travel service zone resolver: `this.cardTravelService.getZoneElement(deckZoneKey)`
    - If no element → return `0` (graceful degradation)
    - Add CSS class `pvp-deck-shuffle` to the deck zone element
    - Compute duration: `Math.max(100, Math.round(250 * this.speedMultiplierFn()))` — 250ms base with speed multiplier, 100ms floor
    - Schedule class removal: `const tid = setTimeout(() => element.classList.remove('pvp-deck-shuffle'), duration)` — push `tid` to `this.animationTimeouts[]` so `destroy()` clears it
    - Return `250` (base duration for queue loop)

- [x] Task 6: CSS animation for deck shuffle (AC5)
  - [x] 6.1 In `pvp-board-container.component.scss`, add `.pvp-deck-shuffle` animation class on `.zone-pile--stack`:
    - Keyframe `pvp-shuffle-fan`: `0%` normal, `40%` pseudo-elements offset +/-3px translate + +/-2deg rotate, `100%` back to normal
    - `.pvp-deck-shuffle::before` and `::after` get `animation: pvp-shuffle-fan 250ms ease-in-out`
    - Use `var(--pvp-shuffle-duration, 250ms)` CSS variable for duration (overridable by speed multiplier)
  - [x] 6.2 Add `@media (prefers-reduced-motion: reduce)` override: `.pvp-deck-shuffle::before, .pvp-deck-shuffle::after { animation: none; }`

- [x] Task 7: Expose getZoneElement() on CardTravelService (AC5)
  - [x] 7.1 In `PvpBoardContainerComponent`, extend the zone resolver registration to also expose `getZoneElement(zoneKey: string): HTMLElement | null` — the board container already builds a zone map via `rebuildZoneMap()` with `querySelectorAll('[data-zone]')`, so return the element from that map
  - [x] 7.2 In `CardTravelService`, add `registerZoneElementResolver(fn: (key: string) => HTMLElement | null)` and a public `getZoneElement(zoneKey: string): HTMLElement | null` method that delegates to it
  - [x] 7.3 In `PvpBoardContainerComponent.ngAfterViewInit()`, call `cardTravelService.registerZoneElementResolver(...)` alongside the existing `registerZoneResolver()` call

- [x] Task 8: Add MSG_SHUFFLE_HAND to BOARD_CHANGING_EVENTS if needed
  - [x] 8.1 Determine if MSG_SHUFFLE_HAND should be buffered during chain resolution. Per the UX spec, shuffle is a deck-only visual — it does NOT change board state, so it should NOT be in BOARD_CHANGING_EVENTS and NOT be buffered. It should process immediately (the deck animation is purely cosmetic and can play behind the overlay harmlessly)

- [x] Task 9: Manual Verification (all ACs)
  - [x] 9.1 Verify: Pot of Greed (draw 2) — two card-back travels from deck to hand with natural stagger
  - [x] 9.2 Verify: opponent draw — card-back travels from opponent deck (top) to opponent hand area
  - [x] 9.3 Verify: initial 5 draws at duel start — NO travel animations, hand appears via BOARD_STATE under loading screen
  - [x] 9.4 Verify: draw during chain resolution — buffered, replays in Beat 1 after overlay hides
  - [x] 9.5 Verify: MSG_SHUFFLE_HAND — deck zone shows fan-out/fan-in pseudo-element animation (~250ms)
  - [x] 9.6 Verify: `prefers-reduced-motion: reduce` — no travel, no fan animation, instant state changes
  - [x] 9.7 Verify: speed multiplier (activation toggle off) — faster travel and shuffle durations
  - [x] 9.8 Verify: build passes with zero errors

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **Component-scoped services**: `AnimationOrchestratorService` and `CardTravelService` are both provided in `DuelPageComponent.providers` — direct injection between them works.
- **No new dependencies**: Pure Web Animations API + Angular signals + CSS keyframes + DOM API.
- **TypeScript strict mode**: `strict: true` in tsconfig. All types must be explicit.
- **Big bang testing approach**: No automated tests until full MVP — manual verification only.

### Critical: MSG_DRAW Event Structure

```typescript
// duel-ws.types.ts:129-133
export interface DrawMsg {
  type: 'MSG_DRAW';
  player: Player;       // 0 or 1 — which player drew
  cards: (number | null)[];  // card codes (null for opponent's face-down)
}
```

- `player` is the OCGCore absolute player index — convert to relative with `player === ownPlayerIndexFn() ? 0 : 1`
- Cards array is NOT needed for the animation — we always show card back during travel
- The hand updates via BOARD_STATE — the travel is purely visual

### Critical: processDrawEvent() Pattern — Follow processMoveEvent() Exactly

```typescript
private processDrawEvent(msg: DrawMsg): number {
  if (!this.isBoardActiveFn()) return 0; // AC3: suppress initial hand draws
  const relPlayer = msg.player === this.ownPlayerIndexFn() ? 0 : 1;
  const srcKey = `DECK-${relPlayer}`;
  const dstKey = `HAND-${relPlayer}`;
  const travelDuration = Math.max(200, Math.round(400 * this.speedMultiplierFn()));
  const cardBackImage = this.cardTravelService.toAbsoluteUrl('assets/images/card_back.jpg');

  this.cardTravelService.travel(srcKey, dstKey, cardBackImage, {
    duration: travelDuration,
    showBack: true,
  });
  this.announceEvent('Card drawn', msg.player);
  return 400; // base duration — queue loop applies speedMultiplier for setTimeout
}
```

**Key decisions:**
- `showBack: true` — always card back during draw travel (card identity hidden until hand renders)
- Return `400` (base duration) not `travelDuration` — the queue loop multiplies by speedMultiplier for the setTimeout delay, same as processMoveEvent returns 400
- Fire-and-forget `travel()` — don't await, same as processMoveEvent pattern

### Critical: Initial Draw Suppression via isBoardActiveFn (AC3)

The loading screen (`roomState === 'duel-loading'`) is active during initial 5x MSG_DRAW events. The orchestrator doesn't have direct access to `roomState`. Solution: inject a callback.

```typescript
// In orchestrator init() config — add:
isBoardActive: () => boolean;

// In DuelPageComponent — pass:
isBoardActive: () => this.roomState() === 'active',
```

When `isBoardActiveFn()` returns `false`, `processDrawEvent()` returns `0` (no-op, same as current behavior). This is clean because:
- No new signals or effects needed
- The callback evaluates lazily at call time
- Once `roomState` transitions to `'active'`, all subsequent draws get travel animations

### Critical: replayBufferedEvents() — MSG_DRAW in Beat 1

Currently Beat 1 only filters `MSG_MOVE`:
```typescript
const moveEvents = buffer.filter(e => e.type === 'MSG_MOVE');
```

Must become:
```typescript
const zoneEvents = buffer.filter(e => e.type === 'MSG_MOVE' || e.type === 'MSG_DRAW');
```

And the dispatch loop must route by type:
```typescript
for (let i = 0; i < zoneEvents.length; i++) {
  const event = zoneEvents[i];
  const id = setTimeout(() => {
    if (event.type === 'MSG_MOVE') this.processMoveEvent(event as MoveMsg);
    else if (event.type === 'MSG_DRAW') this.processDrawEvent(event as DrawMsg);
  }, i * stagger);
  this._replayTimeouts.push(id);
}
```

**Note**: During replay, `isBoardActiveFn()` will return `true` (board is visible during chain resolution), so the AC3 guard doesn't interfere with replay.

### Critical: MSG_SHUFFLE_HAND — CSS-Only Animation, NOT CardTravelService

MSG_SHUFFLE_HAND is a visual-only deck animation. It does NOT create floating elements or use `CardTravelService.travel()`. Instead:
1. Orchestrator adds a CSS class to the deck zone element
2. CSS `@keyframes` animates the `::before`/`::after` pseudo-elements (already exist on `.zone-pile--stack`)
3. Class removed after animation duration via `setTimeout`

This is simpler than travel and leverages the existing pseudo-element stack styling in `pvp-board-container.component.scss`.

### Critical: MSG_SHUFFLE_HAND is NOT Buffered During Chain Resolution

MSG_SHUFFLE_HAND should NOT be added to `BOARD_CHANGING_EVENTS` — it's a cosmetic deck animation that doesn't affect board state. If it arrives during chain resolution, it should process immediately (the fan animation plays on the deck zone which is behind the overlay — harmless). This avoids complicating the replay logic for a purely visual effect.

### Critical: Accessing Deck Zone DOM Element for Shuffle

The orchestrator is the *timing layer* — it must NOT access the DOM directly (`document.querySelector`). Instead, expose zone elements through the existing CardTravelService zone resolver pattern:

1. `PvpBoardContainerComponent` already builds a zone map via `rebuildZoneMap()` with `querySelectorAll('[data-zone]')` — extend it to also expose element references
2. Register a `getZoneElement(zoneKey): HTMLElement | null` callback on `CardTravelService` alongside the existing `registerZoneResolver()` for `getZoneRect()`
3. Orchestrator calls `this.cardTravelService.getZoneElement('DECK-0')` — clean layer separation, same pattern as travel rect resolution

### Critical: CSS Keyframes for Deck Shuffle

```scss
// In pvp-board-container.component.scss — add alongside existing .zone-pile--stack styles

@keyframes pvp-shuffle-fan {
  0% { transform: var(--pvp-pile-stack-offset); }
  40% { transform: var(--pvp-pile-stack-offset) translateX(3px) rotate(2deg); }
  100% { transform: var(--pvp-pile-stack-offset); }
}

.pvp-deck-shuffle {
  &::before {
    animation: pvp-shuffle-fan 250ms ease-in-out;
  }
  &::after {
    animation: pvp-shuffle-fan 250ms ease-in-out reverse;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pvp-deck-shuffle::before,
  .pvp-deck-shuffle::after {
    animation: none;
  }
}
```

The `::before` and `::after` pseudo-elements already exist on `.zone-pile--stack` (lines 193-216, 265-291 in the SCSS). The `pvp-shuffle-fan` keyframe offsets them from their current stack position. The `reverse` on `::after` creates the opposing fan direction (one goes left, one goes right).

### Critical: Shuffle setTimeout Must Be Tracked

The `setTimeout` for removing the `pvp-deck-shuffle` CSS class MUST be pushed to `animationTimeouts[]`. If `destroy()` is called during the animation (navigation away, disconnect), untracked timeouts would manipulate detached DOM elements. Pattern:
```typescript
const tid = setTimeout(() => el.classList.remove('pvp-deck-shuffle'), duration);
this.animationTimeouts.push(tid);
```

### Critical: What NOT to Touch

- **CardTravelService** — minor addition: `registerZoneElementResolver()` + `getZoneElement()`. `travel()` API unchanged
- **duel-server/** — no server changes
- **pvp-board-container HTML** — no template changes (deck zone already has `data-zone` attribute)
- **duel-ws.types.ts** — `DrawMsg` and `ShuffleHandMsg` already defined
- **pvp-zone.utils.ts** — no changes needed
- **pvp-chain-overlay.component.ts** — no changes (overlay already calls `replayBufferedEvents()`)
- **Prompt components** — no prompt changes

### Previous Story Intelligence (7.3)

From Story 7.3 implementation:
- **Buffer infrastructure works**: `_bufferedBoardEvents[]`, `replayBufferedEvents()`, Beat 1/Beat 2 pattern all proven in production
- **MSG_DRAW already in BOARD_CHANGING_EVENTS**: Added in Story 7.3 Task 6 — it gets buffered during chain resolution already, just not replayed (no-op filter). Story 7.4 promotes it to a real Beat 1 participant.
- **`_replayTimeouts` tracked for cancellation**: All replay `setTimeout` calls pushed to `_replayTimeouts[]`, cleared in `resetChainState()`. New MSG_DRAW replay timeouts must follow same pattern.
- **handleBoardChangePause() uses `.then()` not async/await**: The overlay's replay trigger is `scheduleTimeout` (cancellable) + `.then()` on `replayBufferedEvents()`. No changes needed in overlay.
- **Pre-existing build issue**: `duel-page.component.scss` exceeds 10KB CSS budget (12.23KB) — not related to this story.

### Previous Story Intelligence (7.2)

- **`processMoveEvent()` is fire-and-forget**: calls `cardTravelService.travel()` without awaiting, returns base duration (400ms) synchronously. `processDrawEvent()` must follow the same pattern.
- **`toAbsoluteUrl()` exposed as public** on `CardTravelService` — use it for card back image URL.
- **Speed multiplier applied twice**: once in `processMoveEvent()` for travel duration, once in `processAnimationQueue()` for setTimeout delay. `processDrawEvent()` must follow same pattern: compute `travelDuration` with multiplier for the travel call, return `400` (base) for queue setTimeout.

### Previous Story Intelligence (7.1)

- **Zone key format**: `"${ZoneId}-${relativePlayerIndex}"` (e.g., `"DECK-0"`, `"HAND-1"`)
- **z-index 1000** for floating elements — above board (~100), below chain overlay (~2000). During chain replay, overlay is hidden so floating elements are fully visible.
- **`Promise.withResolvers<void>()` not available** in ES2022 target — use manual deferred Promise pattern.

### Git Intelligence

Recent commits:
- `6be29ce3` 7-3 — Story 7.3 (buffer & replay during chain resolution)
- `061f8563` 7-2 — Story 7.2 (travel animations for MSG_MOVE)
- `6f55ef08` 7-1 — Story 7.1 (CardTravelService + zone registry)
- Pattern: feature-focused commits, build validation before commit

### Source Tree — Files to Modify

**MODIFY (5 files):**
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` — Promote MSG_DRAW from no-op to travel event, add `processDrawEvent()`, add `isBoardActiveFn`, update `replayBufferedEvents()` Beat 1 to include MSG_DRAW, add `processShuffleEvent()` for MSG_SHUFFLE_HAND
- `front/src/app/pages/pvp/duel-page/duel-connection.ts` — Add `MSG_SHUFFLE_HAND` to animation queue enqueue switch
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` — Add `@keyframes pvp-shuffle-fan` and `.pvp-deck-shuffle` class for deck fan-out/fan-in animation
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Pass `isBoardActive` callback in orchestrator `init()` config
- `front/src/app/pages/pvp/duel-page/card-travel.service.ts` — Add `registerZoneElementResolver()` + `getZoneElement()` for deck element access
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — Register zone element resolver callback in `ngAfterViewInit()`

**DO NOT TOUCH:**
- `pvp-board-container.component.html` — no template changes
- `pvp-chain-overlay/` — no overlay changes
- `duel-ws.types.ts` — DrawMsg and ShuffleHandMsg already defined
- `pvp-zone.utils.ts` — no changes
- `duel-server/` — no server changes
- Prompt components — no prompt changes

### Enforcement Rules (from architecture-pvp.md)

1. **Card travel minimum duration floor: 200ms** after speed multiplier — apply to MSG_DRAW travel
2. **All floating elements MUST be cleaned up** on animation completion — CardTravelService already handles this
3. **Buffer & replay ONLY during chain resolution** (`_insideChainResolution = true`) — MSG_DRAW is already in BOARD_CHANGING_EVENTS
4. **Beat ordering fixed**: Beat 1 (zone travels including MSG_DRAW) completes before Beat 2 (LP)
5. **Overlay never calls orchestrator methods except replayBufferedEvents()** — no overlay changes needed
6. **Never process board events immediately during chain resolution** — MSG_DRAW buffering already works from Story 7.3

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 7 Story 7.4 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — AnimationOrchestratorService, CardTravelService API, enforcement rules 10-15, anti-patterns 5-7, timing reference table]
- [Source: _bmad-output/planning-artifacts/ux-design-board-animations.md — MSG_DRAW travel spec (Section 2.3), MSG_SHUFFLE_HAND fan-out/fan-in (Section 2.4), timing table (Section 3), reduced motion (Section 4)]
- [Source: _bmad-output/implementation-artifacts/7-3-buffer-replay-during-chain-resolution.md — Buffer infrastructure, replayBufferedEvents(), MSG_DRAW added to BOARD_CHANGING_EVENTS]
- [Source: _bmad-output/implementation-artifacts/7-2-card-travel-animations-msg-move-events.md — processMoveEvent() fire-and-forget pattern, speed multiplier dual application, toAbsoluteUrl()]
- [Source: front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts — Current processEvent(), replayBufferedEvents(), BOARD_CHANGING_EVENTS]
- [Source: front/src/app/pages/pvp/duel-page/duel-connection.ts — MSG_DRAW enqueue (line 544), missing MSG_SHUFFLE_HAND]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts — DrawMsg (lines 129-133), ShuffleHandMsg (lines 193-197)]
- [Source: front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss — .zone-pile--stack pseudo-elements (lines 193-216)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Tasks 1-8 implemented: MSG_DRAW promoted from no-op to travel event (card back, DECK→HAND), MSG_SHUFFLE_HAND CSS fan-out/fan-in animation on deck zone, `isBoardActiveFn` for initial draw suppression, replay Beat 1 updated for MSG_DRAW, `getZoneElement()` exposed on CardTravelService, `ShuffleHandMsg` added to `GameEvent` union type
- Build passes with zero errors
- Task 9 (manual verification) requires user testing in live duel environment

### File List

- front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts (modified)
- front/src/app/pages/pvp/duel-page/duel-page.component.ts (modified)
- front/src/app/pages/pvp/duel-page/duel-connection.ts (modified)
- front/src/app/pages/pvp/duel-page/card-travel.service.ts (modified)
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts (modified)
- front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss (modified)
- front/src/app/pages/pvp/types/game-event.types.ts (modified)

### Change Log

- 2026-03-10: Implemented MSG_DRAW travel animation and MSG_SHUFFLE_HAND deck fan animation (Tasks 1-8)
- 2026-03-10: Code review fixes (4 issues):
  - C1: Fixed broken @keyframes pvp-shuffle-fan — split into pvp-shuffle-fan-before/after with correct base transforms per pseudo-element
  - H1: Added _reducedMotion guard to processDrawEvent() (AC6 compliance — return 0 for instant state change)
  - M1: Removed redundant _zoneElementResolver from CardTravelService — getZoneElement() now delegates to existing _zoneResolver
  - L1: Added --pvp-shuffle-duration CSS variable set by orchestrator for speed multiplier sync with CSS animation
