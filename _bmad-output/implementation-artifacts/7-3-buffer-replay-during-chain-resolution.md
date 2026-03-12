# Story 7.3: Buffer & Replay During Chain Resolution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want board events during chain resolution to be buffered and replayed as visible card travel animations when the overlay briefly hides,
So that I can see each chain link's impact on the board as spatial card movements instead of instant state changes.

## Acceptance Criteria

### AC1: Buffer Board-Changing Events During Chain Resolution

**Given** the orchestrator is inside chain resolution (`_insideChainResolution = true`) and receives a board-changing event (MSG_MOVE, MSG_DRAW)
**When** the event arrives between MSG_CHAIN_SOLVING and MSG_CHAIN_SOLVED
**Then** the event is pushed to `_bufferedBoardEvents: GameEvent[]` instead of being processed immediately
**And** the `_boardEventsSinceSolving` counter continues to increment (preserving existing chainOverlayBoardChanged behavior)

### AC2: BOARD_STATE Applied Immediately During Buffering

**Given** a BOARD_STATE is received during buffering (between SOLVING and SOLVED)
**When** the buffer contains pending events
**Then** the BOARD_STATE is applied immediately to the data model (zones map) — the final position is correct underneath, and the replay animates only the visual transition

### AC3: Two-Beat Sequential Replay After Overlay Fade-Out

**Given** MSG_CHAIN_SOLVED fires and there are buffered events
**When** the overlay exit animation completes and the overlay fades out
**Then** buffered events replay on the visible board in two sequential beats:
- **Beat 1 (zones):** all MSG_MOVE travel animations play in parallel with stagger (50ms normal, 30ms accelerated), duration = `max(individual durations) + (count - 1) * stagger`
- **Beat 2 (LP):** all MSG_DAMAGE/MSG_RECOVER/MSG_PAY_LPCOST animations play in parallel
**And** the board pause duration is dynamically calculated from `Beat 1 + Beat 2` (not fixed 1000ms)

### AC4: Replay Waits for Overlay to Fully Hide

**Given** buffered events are ready to replay
**When** MSG_CHAIN_SOLVED triggers the overlay exit animation
**Then** replay does NOT start until the overlay has fully faded out (`opacity: 0` + `visibility: hidden`)
**And** this is contractualized via the overlay calling a callback or setting a signal after fade-out completes
**And** after replay completes, the overlay fades back in (if more chain links remain)
**And** `chainOverlayReady` is set to `true` after the full replay cycle

### AC5: Empty Buffer Skips Pause

**Given** a chain link produces no board-changing events (empty buffer)
**When** MSG_CHAIN_SOLVED fires
**Then** the pause is skipped entirely — same behavior as current `chainOverlayBoardChanged = false` path (retro-compatible)

### AC6: Reduced Motion

**Given** `prefers-reduced-motion: reduce` is active
**When** buffered events would replay
**Then** duration = 0ms, instant state changes, no travel animations (existing behavior via `reducedMotion` flag in CardTravelService)

### AC7: Accelerated Mode Timings

**Given** accelerated mode is active (`chainAccelerated = true`, 3+ chain links resolved without prompt)
**When** replay occurs
**Then** travel durations use accelerated timings: 250ms base (instead of 400ms), 30ms stagger (instead of 50ms), 200ms floor

### AC8: STATE_SYNC / Disconnect Flushes Buffer

**Given** a STATE_SYNC or disconnection event is received while the buffer contains pending events
**When** the orchestrator processes STATE_SYNC
**Then** `_bufferedBoardEvents[]` is flushed without replay — all buffered events are discarded
**And** `_insideChainResolution` is reset to `false`, chain overlay disappears instantly
**And** the board reflects the STATE_SYNC snapshot directly (no animation)

## Tasks / Subtasks

- [x] Task 1: Add event buffer to AnimationOrchestratorService (AC1, AC5)
  - [x] 1.1 Replace `_boardEventsSinceSolving: number` with `_bufferedBoardEvents: GameEvent[]` array. Keep the counter behavior by deriving count from `_bufferedBoardEvents.length`
  - [x] 1.2 In `processEvent()`, when `_insideChainResolution === true` and event is in `BOARD_CHANGING_EVENTS` set: push event to `_bufferedBoardEvents` and return `0` (skip animation, dequeue immediately)
  - [x] 1.3 Update `chainOverlayBoardChanged` to use `_bufferedBoardEvents.length > 0` instead of `_boardEventsSinceSolving > 0`
  - [x] 1.4 In `resetChainState()`: replace `_boardEventsSinceSolving = 0` with `_bufferedBoardEvents = []`

- [x] Task 2: Add `chainBoardReplayDuration` signal + replay method (AC3, AC4, AC7)
  - [x] 2.1 Add `readonly chainBoardReplayDuration = signal<number>(0)` — dynamic board pause duration calculated from buffered events
  - [x] 2.2 Add `replayBufferedEvents(): Promise<void>` method that:
    - Separates buffer into Beat 1 (MSG_MOVE, MSG_DRAW) and Beat 2 (MSG_DAMAGE, MSG_RECOVER, MSG_PAY_LPCOST)
    - Beat 1: fires all `processMoveEvent()` calls in parallel with stagger delay (`setTimeout` per event at `i * stagger`), waits for total Beat 1 duration
    - Beat 2: fires all `processLpEvent()` calls in parallel, waits for `baseLpDuration`
    - Returns after both beats complete
  - [x] 2.3 Compute stagger from `chainAccelerated()`: 30ms if accelerated, 50ms if normal
  - [x] 2.4 Compute travel base from `chainAccelerated()`: 250ms if accelerated, 400ms if normal (both with 200ms floor after speedMultiplier)
  - [x] 2.5 Compute total replay duration: `beat1Duration + beat2Duration` and set `chainBoardReplayDuration` signal before replay starts

- [x] Task 3: Modify MSG_CHAIN_SOLVED flow for replay integration (AC3, AC4)
  - [x] 3.1 In `processEvent()` case `MSG_CHAIN_SOLVED`: after setting `chainOverlayBoardChanged`, compute `chainBoardReplayDuration` from buffered events and set the signal
  - [x] 3.2 Still return `'async'` — the overlay uses the new `chainBoardReplayDuration` signal for dynamic pause

- [x] Task 4: Update PvpChainOverlayComponent for dynamic board pause + replay trigger (AC3, AC4)
  - [x] 4.1 Remove fixed `boardPause` from `durations` computed — the replay duration is now dynamic from `chainBoardReplayDuration` signal
  - [x] 4.2 In `handleBoardChangePause()`: keep `scheduleTimeout` for the fade-out wait (cancellable via `clearAllTimers()`), then chain `.then()` on `orchestrator.replayBufferedEvents()` for replay + fade-in + `chainOverlayReady = true`. Do NOT convert to `async/await` — the fade-out setTimeout must remain cancellable by `onChainEnd()` / `clearAllTimers()`
  - [x] 4.3 Pattern: `scheduleTimeout(() => { orchestrator.replayBufferedEvents().then(() => { overlayVisible.set(true); chainOverlayReady.set(true); }); }, fadeOut)` — if `onChainEnd()` clears timers during fade-out, the replay never fires. If `onChainEnd()` fires during replay, the `.then()` callback setting `chainOverlayReady = true` is harmless (already reset by `onChainEnd()`)

- [x] Task 5: STATE_SYNC buffer flush (AC8)
  - [x] 5.1 In `resetChainState()`: already clears `_bufferedBoardEvents` from Task 1.4 — verify STATE_SYNC path calls `resetChainState()`
  - [x] 5.2 In `applyInstantAnimation()` for collapsed chain events: also clear `_bufferedBoardEvents` when collapsing MSG_CHAIN_SOLVED

- [x] Task 6: MSG_DRAW buffering support (AC1)
  - [x] 6.1 Add `'MSG_DRAW'` to `BOARD_CHANGING_EVENTS` set (it's not there yet — currently a no-op returning 0)
  - [x] 6.2 In `replayBufferedEvents()` Beat 1: handle MSG_DRAW events alongside MSG_MOVE — for now, MSG_DRAW replay is a no-op (returns 0ms, same as current behavior). Story 7.4 will promote MSG_DRAW to a real travel event. The buffer infrastructure supports it.

- [ ] Task 7: Manual Verification (all ACs)
  - [ ] 7.1 Verify: chain resolution with board events (e.g., MST destroying a card) — card travel should play AFTER overlay fades out, not behind it
  - [ ] 7.2 Verify: chain resolution without board events (e.g., effect that searches deck) — no pause, overlay resolves immediately (same as before)
  - [ ] 7.3 Verify: Raigeki resolving in a chain — multiple destroy travels play in parallel with stagger during replay
  - [ ] 7.4 Verify: LP damage during chain resolution — LP counter animates during Beat 2 after card travels complete
  - [ ] 7.5 Verify: STATE_SYNC during chain resolution (reconnection) — buffer flushed, board reflects snapshot, no replay
  - [ ] 7.6 Verify: accelerated mode (3+ chain links) — faster stagger and travel durations during replay
  - [ ] 7.7 Verify: `prefers-reduced-motion: reduce` — instant state changes, no travel animations during replay
  - [ ] 7.8 Verify: speed multiplier affects replay travel duration (faster with activation toggle off)
  - [ ] 7.9 Verify: chain with mixed events (MSG_MOVE + MSG_DAMAGE) — Beat 1 plays card travels, then Beat 2 plays LP animation sequentially
  - [x] 7.10 Verify: build passes with zero errors

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **Component-scoped services**: `AnimationOrchestratorService` and `CardTravelService` are both provided in `DuelPageComponent.providers` — direct injection between them works.
- **No new dependencies**: Pure Web Animations API + Angular signals + DOM API.
- **TypeScript strict mode**: `strict: true` in tsconfig. All types must be explicit.
- **Big bang testing approach**: No automated tests until full MVP — manual verification only.

### Critical: Current Chain Resolution Flow (What Changes)

**Current flow (Story 6.3):**
```
MSG_CHAIN_SOLVING → _insideChainResolution = true, _boardEventsSinceSolving = 0
  board events → processed immediately (travel animations play behind overlay, invisible!)
  _boardEventsSinceSolving++ (counter only)
MSG_CHAIN_SOLVED → chainOverlayBoardChanged = (_boardEventsSinceSolving > 0)
  → return 'async' → overlay does: exit anim → fade out → FIXED boardPause (1000/600ms) → fade in → ready
```

**New flow (Story 7.3):**
```
MSG_CHAIN_SOLVING → _insideChainResolution = true, _bufferedBoardEvents = []
  board events → BUFFERED (pushed to array, return 0 to dequeue immediately)
MSG_CHAIN_SOLVED → chainOverlayBoardChanged = (_bufferedBoardEvents.length > 0)
  → compute chainBoardReplayDuration from buffer contents
  → return 'async' → overlay does: exit anim → fade out → REPLAY buffered events → DYNAMIC pause → fade in → ready
```

**Key insight**: Board events currently play travel animations BEHIND the visible overlay (invisible to user). The buffer captures them and replays AFTER the overlay hides. The BOARD_STATE (data model) is already correct — replay only produces the visual animation.

### Critical: Replay Architecture — Overlay Drives, Orchestrator Executes

The async overlay contract is **unchanged**: orchestrator pauses on `'async'`, overlay signals `chainOverlayReady = true` when done. What changes is what happens during the overlay's "board pause" window:

```
Overlay.handleBoardChangePause():
  1. overlayVisible = false  (fade out)
  2. await fadeOutDuration     (CSS transition)
  3. await orchestrator.replayBufferedEvents()  ← NEW: replay travel animations on visible board
  4. if (moreLinks) overlayVisible = true  (fade back in)
  5. chainOverlayReady = true  (resume orchestrator)
```

The overlay calls `replayBufferedEvents()` — the orchestrator fires travel calls and LP animations, returns a Promise that resolves when all replay animations complete. The overlay then proceeds with its existing flow.

### Critical: Beat 1 Parallel Replay with Stagger

```typescript
// Inside replayBufferedEvents()
const zoneEvents = buffer.filter(e => e.type === 'MSG_MOVE' || e.type === 'MSG_DRAW');
const lpEvents = buffer.filter(e => e.type === 'MSG_DAMAGE' || e.type === 'MSG_RECOVER' || e.type === 'MSG_PAY_LPCOST');
const stagger = this.chainAccelerated() ? 30 : 50;
const baseDuration = this.chainAccelerated() ? 250 : 400;
const travelDuration = Math.max(200, Math.round(baseDuration * this.speedMultiplierFn()));

// Beat 1: fire all zone travels with stagger
for (let i = 0; i < zoneEvents.length; i++) {
  setTimeout(() => this.processMoveEvent(zoneEvents[i] as MoveMsg), i * stagger);
}
const beat1Duration = zoneEvents.length > 0
  ? travelDuration + (zoneEvents.length - 1) * stagger
  : 0;

// Wait for Beat 1 to finish, then Beat 2
await delay(beat1Duration);

// Beat 2: fire all LP events simultaneously
for (const event of lpEvents) {
  this.processLpEvent(/*...*/);
}
const beat2Duration = lpEvents.length > 0 ? this.baseLpDuration : 0;
await delay(beat2Duration);
```

### Critical: processMoveEvent() During Replay — Call Directly, Bypass processEvent()

**ADR decision**: `replayBufferedEvents()` must call `processMoveEvent()` and `processLpEvent()` **directly** — never route through `processEvent()`. Reasons:
- `processEvent()` checks `_insideChainResolution` and could re-buffer events (even though `_insideChainResolution` is `false` at replay time, this is fragile)
- `processEvent()` has LP tracking side-effects via `trackedLp` mutation — during replay, BOARD_STATE has already been applied and `trackedLp` may have been synced
- `processMoveEvent()` is pure visual (fire-and-forget `CardTravelService.travel()`) — safe to call directly
- `processLpEvent()` mutates `trackedLp` and sets `animatingLpPlayer` signal — both are desired during replay for visual LP animation

Do NOT add a `_isReplaying` flag — direct calls are simpler and avoid flag-management complexity.

### Critical: Dynamic Board Pause Duration Calculation

```
chainBoardReplayDuration =
  (hasBeat1 ? max(travelDurations) + (beat1Count - 1) * stagger : 0)
  + (hasBeat2 ? baseLpDuration : 0)
```

This replaces the fixed `boardPause: fast ? 600 : 1000` in the overlay's `durations` computed. The overlay reads `chainBoardReplayDuration` signal instead of using a static value.

### Critical: handleBoardChangePause() Refactoring — setTimeout + .then(), NOT async/await

**ADR decision**: Keep `scheduleTimeout` for the fade-out wait (cancellable via `clearAllTimers()`), then chain `.then()` on the replay Promise.

**Why NOT async/await**: `await delay(fadeOut)` is NOT cancellable. If `onChainEnd()` fires during the fade-out (e.g., MSG_CHAIN_END arrives while overlay is fading), `clearAllTimers()` cannot abort the awaited Promise, causing the replay to execute on a stale chain state.

```typescript
// CURRENT (pvp-chain-overlay.component.ts:350-365)
handleBoardChangePause(): void {
  if (this.orchestrator.chainOverlayBoardChanged()) {
    this.overlayVisible.set(false);
    this.scheduleTimeout(() => {        // wait for fadeOut CSS transition — CANCELLABLE
      this.scheduleTimeout(() => {      // wait for boardPause (FIXED duration)
        if (links > 0) this.overlayVisible.set(true);
        this.orchestrator.chainOverlayReady.set(true);
      }, this.durations().boardPause);
    }, this.durations().fadeOut);
  } else {
    this.orchestrator.chainOverlayReady.set(true);
  }
}
```

```typescript
// NEW — scheduleTimeout for fade-out (cancellable), .then() for replay
handleBoardChangePause(): void {
  if (this.orchestrator.chainOverlayBoardChanged()) {
    this.overlayVisible.set(false);
    this.scheduleTimeout(() => {                           // CANCELLABLE fade-out wait
      this.orchestrator.replayBufferedEvents().then(() => { // replay travel animations
        if (this.activeChainLinks().length > 0) {
          this.overlayVisible.set(true);
        }
        this.orchestrator.chainOverlayReady.set(true);
      });
    }, this.durations().fadeOut);
  } else {
    this.orchestrator.chainOverlayReady.set(true);
  }
}
```

**Safety**: If `onChainEnd()` calls `clearAllTimers()` during fade-out, the `scheduleTimeout` callback never fires → replay never starts → no stale state. If `onChainEnd()` fires during replay (after fade-out), the `.then()` sets `chainOverlayReady = true` which is harmless (already reset by `onChainEnd()`).

### Critical: What NOT to Touch

- **CardTravelService** — already complete from Story 7.1/7.2, no changes needed
- **DuelConnection** — no data layer changes, handleMessage stays the same
- **duel-server/** — no server changes
- **pvp-board-container HTML/SCSS** — no template or style changes
- **Prompt components** — no prompt changes
- **MSG_CHAINING / MSG_CHAIN_END processing** — unchanged
- **Queue collapse logic (AC7)** — unchanged (already skips chain events)
- **`animatingZone` signal type** — keep as-is for now (`{ zoneId, animationType, relativePlayerIndex } | null`). The `Set<string>` evolution mentioned in the epic is NOT needed for 7.3 — replay fires `processMoveEvent()` which uses `CardTravelService.travel()` (fire-and-forget floating elements), not `setAnimatingZone()`. The `animatingZone` signal is only used for flip/activate in-place glow, which don't participate in replay.

### Previous Story Intelligence (7.2)

From Story 7.2 implementation:
- **`processMoveEvent()` is fire-and-forget**: calls `cardTravelService.travel()` without awaiting, returns base duration (400ms) synchronously. During replay, the same pattern works — fire travel, the floating element animates independently.
- **`toAbsoluteUrl()` exposed as public** on `CardTravelService` — orchestrator uses it for card image URLs.
- **`locationToZoneKey()` in `pvp-zone.utils.ts`** — maps (location, sequence, relativePlayer) to zone registry keys. Reused during replay.
- **Speed multiplier applied twice**: once in `processMoveEvent()` for travel duration, once in `processAnimationQueue()` for setTimeout delay. During replay, only the travel duration matters (no queue setTimeout).
- **Token dissolution removed** in code review — `cardCode === 0` is ambiguous with sanitized opponent cards. All destroy events use standard travel.
- **Pre-existing build issue**: `duel-page.component.scss` exceeds 10KB CSS budget (12.23KB) — not related to this story.

### Previous Story Intelligence (7.1)

- **`Promise.withResolvers<void>()` not available** in ES2022 target — use manual deferred Promise pattern (`new Promise<void>(r => { resolve = r })`)
- **Zone key format**: `"${ZoneId}-${relativePlayerIndex}"` (e.g., `"M1-0"`, `"GY-1"`, `"HAND-0"`)
- **z-index 1000** for floating elements (above board ~100, below chain overlay ~2000) — during replay, overlay is hidden (`overlayVisible = false`), so floating elements are fully visible

### Git Intelligence

Recent commits:
- `061f8563` 7-2 — Story 7.2 (travel animations for MSG_MOVE)
- `6f55ef08` 7-1 — Story 7.1 (CardTravelService + zone registry)
- `acb67aec` Chain build and resolve animations — Epic 6 completion
- Pattern: feature-focused commits, build validation before commit

### Source Tree — Files to Modify

**MODIFY (2 files):**
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` — Add event buffer array, `replayBufferedEvents()` method, `chainBoardReplayDuration` signal, modify `processEvent()` to buffer during chain resolution
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts` — Refactor `handleBoardChangePause()` to async with replay call, replace fixed `boardPause` with dynamic duration

**DO NOT TOUCH:**
- `card-travel.service.ts` — already complete from Story 7.1
- `pvp-board-container/` — no template, style, or component changes
- `duel-connection.ts` — no data layer changes
- `duel-server/` — no server changes
- Prompt components — no prompt changes
- `pvp-zone.utils.ts` — no changes needed

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 7 Story 7.3 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — AnimationOrchestratorService signals, chain resolution flow, buffer & replay (PvP-C), beat-based replay, async overlay contract, enforcement rules 14-15, anti-patterns 5-7]
- [Source: _bmad-output/planning-artifacts/ux-design-board-animations.md — Buffer & replay design, parallel replay grouping, board pause calculation, timing reference]
- [Source: _bmad-output/implementation-artifacts/7-2-card-travel-animations-msg-move-events.md — Previous story patterns, processMoveEvent() fire-and-forget, speed multiplier behavior]
- [Source: _bmad-output/implementation-artifacts/7-1-card-travel-service-zone-element-registry.md — CardTravelService API, zone key convention, Promise patterns]
- [Source: front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts — Current processEvent(), chain resolution flow, _insideChainResolution, _boardEventsSinceSolving]
- [Source: front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts — Current handleBoardChangePause(), durations computed, async overlay contract]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Replaced `_boardEventsSinceSolving` counter with `_bufferedBoardEvents: GameEvent[]` array — events are now captured during chain resolution instead of being processed behind the overlay
- Added `replayBufferedEvents(): Promise<void>` — two-beat sequential replay: Beat 1 fires MSG_MOVE travels with stagger (50ms normal, 30ms accelerated), Beat 2 fires LP events (MSG_DAMAGE/RECOVER/PAY_LPCOST) simultaneously
- Added `chainBoardReplayDuration` signal — computed from buffered event count + stagger + LP duration, replaces fixed `boardPause` in overlay
- MSG_CHAIN_SOLVED now computes dynamic replay duration before returning `'async'`
- Overlay's `handleBoardChangePause()` refactored: `scheduleTimeout` (cancellable) for fade-out wait → `.then()` on `replayBufferedEvents()` for replay + fade-in + ready signal. NOT async/await to preserve cancellability via `clearAllTimers()`
- Buffer flushed in `applyInstantAnimation()` when collapsing MSG_CHAIN_SOLVED (queue collapse safety)
- `MSG_DRAW` added to `BOARD_CHANGING_EVENTS` — buffered during chain resolution, replay is no-op (Story 7.4 will add real travel)
- Removed unused `reducedMotion` field from overlay (was only used in removed `boardPause` computation; CardTravelService already handles reduced motion for travel durations)
- Note: STATE_SYNC in duel-connection directly clears queue/chainPhase/links without calling orchestrator's `resetChainState()` — pre-existing pattern. Buffer becomes orphaned but harmless (empty queue means no replay). The overlay's `onChainEnd()` handles visual cleanup.

### Change Log

- 2026-03-10: Implemented buffer & replay for chain resolution (Tasks 1-6). Build passes with zero errors.
- 2026-03-10: Code review fixes (6 issues: 1H, 4M, 1L). Removed dead `chainBoardReplayDuration` signal + DRY-duplicated computation. Added `_reducedMotion` check for AC6 (instant replay, 0ms). Fixed Beat 1 stagger inflation from MSG_DRAW no-ops. Made replay `setTimeout` calls cancellable via `_replayTimeouts` (cleared in `resetChainState()`). Updated architecture-pvp.md overlay→orchestrator contract to document `replayBufferedEvents()` exception. Added JSDoc comment for silently dropped MSG_FLIP_SUMMONING/MSG_CHANGE_POS in replay. Build passes with zero errors.

### File List

- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` — MODIFIED: Added `_bufferedBoardEvents` array, `chainBoardReplayDuration` signal, `replayBufferedEvents()` method, buffering in `processEvent()`, dynamic duration in MSG_CHAIN_SOLVED, buffer flush in `applyInstantAnimation()`, MSG_DRAW in BOARD_CHANGING_EVENTS
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts` — MODIFIED: Removed fixed `boardPause` from `durations`, refactored `handleBoardChangePause()` to use replay, removed unused `reducedMotion` field
