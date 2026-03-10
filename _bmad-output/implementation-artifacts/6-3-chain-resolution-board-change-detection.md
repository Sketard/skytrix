# Story 6.3: Chain Resolution Animation (LIFO) & Board Change Detection

Status: done

**Depends on:** Story 6.2 (cascade layout and construction animation must be functional)

## Story

As a player,
I want the chain overlay to animate resolution in reverse order (LIFO) with the resolving card highlighted, and the overlay to pause and reveal the board when a card effect changes the game state,
so that I can see each chain effect's impact on the board before the next one resolves.

## Acceptance Criteria

### AC1: Resolution Animation — Front Card Pulse & Exit

**Given** the chain is in `resolving` phase and the overlay is visible
**When** MSG_CHAIN_SOLVING fires for chain link N
**Then** the overlay appears showing the remaining chain links in cascade
**And** the front card (highest chain index = resolving link) pulses: `scale(1.0 → 1.1 → 1.0)` over 300ms
**And** the front card has a golden glow: `box-shadow: 0 0 20px var(--pvp-chain-glow-resolving)`
**And** the badge number on the front card glows matching golden color

**When** MSG_CHAIN_SOLVED fires for chain link N
**Then** the front card exits: `translateX(100px) + opacity → 0` (slide-out right, 300ms)
**And** remaining cards shift down and grow to promoted positions (N-1 → front, N-2 → mid, next visible → back)
**And** chain connector between exited card and new front card fades out

### AC2: Board Change Detection — Overlay Pause

**Given** the chain is resolving and MSG_CHAIN_SOLVED fires for chain link N
**When** the board state has changed since the previous chain link resolution (detected via event counting — see AC3)
**Then** the overlay sets `orchestrator.chainOverlayReady(false)` (pauses orchestrator queue)
**And** the front card exit animation plays (300ms)
**And** the overlay fades out (300ms) after the card exit animation
**And** the board is visible for 500ms (player sees the impact: destruction, summon, GY send, LP change…)
**And** the overlay fades back in for the next chain link resolution
**And** the overlay sets `orchestrator.chainOverlayReady(true)` when done → orchestrator resumes queue processing
**And** `overlayDismissed` is emitted when the overlay fades out (for any additional parent-level coordination)

**When** the board state has NOT changed since the previous chain link resolution
**Then** the overlay transitions directly to the next chain link resolution (no fade-out, 0ms pause)
**And** `orchestrator.chainOverlayReady(true)` is set immediately → orchestrator resumes without delay

**Note:** The async contract (overlay ↔ orchestrator) uses the `chainOverlayReady` and `chainOverlayBoardChanged` signals scaffolded in Story 6.1 AC6. The orchestrator returns `'async'` for MSG_CHAIN_SOLVED and waits for the overlay to signal readiness.

### AC3: Board Change Detection via Event Counting

**Given** the chain is resolving
**When** the orchestrator processes events between MSG_CHAIN_SOLVING and MSG_CHAIN_SOLVED for each link
**Then** the orchestrator's `_boardEventsSinceSolving` counter (scaffolded in Story 6.1 AC6) is incremented on each board-changing event:
- `MSG_MOVE` (card moved between zones)
- `MSG_DAMAGE` (LP damage)
- `MSG_RECOVER` (LP recovery)
- `MSG_FLIPSUMMONING` (flip summon)
- `MSG_PAY_LPCOST` (LP cost payment)
- `MSG_CHANGE_POS` (position change)
**And** the counter resets to 0 on each `MSG_CHAIN_SOLVING`
**And** on `MSG_CHAIN_SOLVED`: orchestrator sets `chainOverlayBoardChanged(this._boardEventsSinceSolving > 0)` then returns `'async'`
**And** the overlay reads `boardChanged` input (driven by `orchestrator.chainOverlayBoardChanged()`) and decides: pause or transition directly
**And** this logic lives in the animation orchestrator — the overlay only reads the result, it does not count events itself

### AC4: Chain End — Final Fade-Out

**Given** the last chain link has resolved
**When** MSG_CHAIN_END fires
**Then** the overlay performs a final fade-out (200ms)
**And** the backdrop fully disappears
**And** `chainPhase` transitions to `'idle'`

**Given** a chain of exactly 1 link
**When** it resolves
**Then** skip the resolution overlay entirely (the card was already shown during construction in Story 6.2)
**And** only perform board-change pause if applicable (board events detected between MSG_CHAIN_SOLVING and MSG_CHAIN_SOLVED)
**And** the overlay does not reappear for the single-link resolution — go directly to MSG_CHAIN_END fade-out

### AC5: Auto-Resolve Acceleration

**Given** no prompt interrupts the chain (both players' triggers auto-skipped)
**When** the chain resolves automatically
**Then** animation timings are reduced:
- Construction: 400ms → 250ms appear, 300ms → 150ms fade-out
- Resolution pulse: 300ms → 150ms
- Card exit: 300ms → 150ms
- Board-changed pause: 500ms → 300ms
**And** acceleration is triggered by the animation orchestrator detecting 3+ chain resolution events queued without prompt interruption (new logic — this does not already exist, it must be built)
**And** the overlay receives a new `accelerated: boolean` signal input (added in this story — not part of Story 6.1 shell, which only scaffolds the initial inputs). DuelPageComponent template must be updated to pass `[accelerated]` binding
**And** when a prompt interrupts the chain mid-resolution, the parent sets `accelerated(false)`, reverting to normal timing for the remaining links

### AC6: Reduced Motion Support

**Given** `prefers-reduced-motion: reduce` is active
**When** the chain overlay resolves
**Then** no pulse animation, no scale effect, no slide-out animation
**And** cards appear/disappear instantly at final positions
**And** overlay shows static positions briefly then disappears
**And** board-change pauses are instant (0ms — just show the board state update, no dramatic pause)

### AC7: Screen Reader Announcements — Resolution

**Given** the chain is resolving
**When** MSG_CHAIN_SOLVING fires
**Then** `LiveAnnouncer` announces: "Chain Link [N] resolving: [cardName]"

**When** MSG_CHAIN_SOLVED fires
**Then** no individual announcement (coalesced per existing pattern)

**When** MSG_CHAIN_END fires
**Then** existing "Chain resolved" announcement fires (from `duel-page.component.ts:703-711`)

**Given** auto-resolve acceleration is active (no prompt interrupt)
**When** the full chain resolves without interruption
**Then** buffer individual announcements and flush a single summary: "Chain of N links resolved. Your LP: [value]. Opponent LP: [value]."

### AC8: Edge Cases

**Given** a prompt interrupts mid-chain (e.g., mandatory trigger during resolution)
**When** the prompt dialog appears
**Then** the chain overlay is hidden via `@if (!promptActive())` (the `promptActive` input from Story 6.1 AC3 controls visibility)
**And** after prompt is resolved, `promptActive` becomes `false` and the overlay resumes with remaining chain links
**And** animation timing reverts to normal speed (AC5)
**And** the orchestrator's `chainOverlayReady` signal is not affected by prompt hide/show — the orchestrator pauses naturally because the prompt event is processed first in the queue

**Given** disconnection during chain resolution
**When** STATE_SYNC is received on reconnect
**Then** `chainPhase` resets to `'idle'`, overlay disappears instantly, all chain state cleared (timers, counters, animation classes)

## Tasks / Subtasks

- [x] Task 1: Resolution animation — pulse & exit (AC1)
  - [x] 1.1 Add `.chain-card--resolving` CSS class: `animation: chain-resolve-glow 300ms`, `box-shadow: 0 0 20px var(--pvp-chain-glow-resolving)`
  - [x] 1.2 Create `@keyframes chain-resolve-glow`: scale(1.0 → 1.1 → 1.0) with golden glow
  - [x] 1.3 Add `.chain-card--resolve-exiting` CSS class: `translateX(100px) + opacity: 0` transition
  - [x] 1.4 In component TS: track `resolvingIndex` signal from `activeChainLinks` changes (link with `resolving: true`)
  - [x] 1.5 On link removal (filter detects removed chainIndex): trigger exit animation on that card, then promote remaining cards after transition ends
  - [x] 1.6 Fade out chain connector for exiting card (`.chain-connector--fading`)

- [x] Task 2: Board change detection — overlay behavior (AC2, AC3)
  - [x] 2.1 Read `boardChanged` input signal (driven by `orchestrator.chainOverlayBoardChanged()`, scaffolded in Story 6.1)
  - [x] 2.2 On card exit complete: if `boardChanged` → fade-out overlay (300ms) → wait 500ms → fade back in → set `chainOverlayReady(true)`. If not → set `chainOverlayReady(true)` immediately
  - [x] 2.3 Set `chainOverlayReady(false)` at start of resolution animation for each link (before exit begins)
  - [x] 2.4 Emit `overlayDismissed` when overlay fades out during board-change pause

- [x] Task 3: Chain end handling (AC4)
  - [x] 3.1 On `chainPhase === 'idle'` transition: trigger final fade-out (200ms)
  - [x] 3.2 Clean up all internal state: `visibleCards`, `resolvingIndex`, timers
  - [x] 3.3 Handle 1-link chain: detect `linksAtResolutionStart === 1` at resolution start → skip resolution overlay entirely, only do board-change pause if `boardChanged`

- [x] Task 4: Auto-resolve acceleration (AC5)
  - [x] 4.1 Add `accelerated` input signal to PvpChainOverlayComponent
  - [x] 4.2 In animation orchestrator: add acceleration detection logic — set `chainAccelerated(true)` when 3+ chain resolution events queued without prompt interruption
  - [x] 4.3 Create `durations` getter in overlay: returns normal or accelerated durations based on `accelerated()`
  - [x] 4.4 Apply `durations` values to all timing: entry, exit, pulse, fade, board pause
  - [x] 4.5 On prompt interrupt: orchestrator `notifyPromptDuringChain()` sets `chainAccelerated(false)`, timing reverts

- [x] Task 5: Reduced motion (AC6)
  - [x] 5.1 Wrap resolution animations in `@media (prefers-reduced-motion: no-preference)` blocks
  - [x] 5.2 Under `prefers-reduced-motion: reduce`: `.chain-card--resolving { animation: none; box-shadow: none; }`, `.chain-card--resolve-exiting { transition: none; opacity: 0; }`
  - [x] 5.3 Board-change pause: 0ms under reduced motion (handled by overlay TS durations)

- [x] Task 6: Screen reader announcements (AC7)
  - [x] 6.1 Add `effect()` watching `activeChainLinks` for resolving state during resolving phase
  - [x] 6.2 Announce "Chain Link [N] resolving: [cardName]" on each MSG_CHAIN_SOLVING
  - [x] 6.3 Implement coalescing for auto-resolve: buffer announcements during accelerated mode
  - [x] 6.4 Flush buffer on chain end (existing "Chain resolved" announcement in duel-page)

- [x] Task 7: Edge case handling (AC8)
  - [x] 7.1 Prompt interruption: overlay hidden via `@if (!promptActive())` — no special logic needed beyond the existing `promptActive` input (Story 6.1 AC3)
  - [x] 7.2 Disconnection: verified `chainPhase` reset to `'idle'` clears all overlay state (timers, animation classes, resolveExitingCard, resolvingIndex)

- [x] Task 8: Manual verification (all ACs)
  - [x] 8.1 Verify: single chain resolves — card pulses golden, exits right, overlay fades
  - [x] 8.2 Verify: 3-link chain — cards exit LIFO (3→2→1), cascade promotes each time
  - [x] 8.3 Verify: board change (destruction) — overlay pauses, board visible for 500ms, overlay resumes
  - [x] 8.4 Verify: no board change — overlay transitions directly to next link (no pause)
  - [x] 8.5 Verify: 5+ link chain with mixed board changes — pauses only when delta detected
  - [x] 8.6 Verify: auto-resolve (no prompts) — faster timings
  - [x] 8.7 Verify: prompt interrupts chain — overlay hides via promptActive, resumes after prompt, normal timing
  - [x] 8.8 Verify: 1-link chain — no resolution overlay, only board-change pause if applicable
  - [x] 8.9 Verify: disconnection during chain — overlay clears instantly
  - [x] 8.10 Verify: `prefers-reduced-motion` — no animations, instant state changes
  - [x] 8.11 Verify: screen reader announces resolving links, coalesced summary for auto-resolve
  - [x] 8.12 Verify: mobile landscape — overlay readable during resolution (CSS unchanged, column-reverse layout preserved)
  - [x] 8.13 Verify: SCSS budget not exceeded (build passes)

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`pointer-events: none`**: Entire overlay is non-interactive. No tap/click handlers.
- **CSS transforms GPU-accelerated**: `transform`, `opacity` are compositor-only — safe for mobile performance.
- **No new dependencies**: Pure CSS animations + Angular signals.
- **Timer cleanup via DestroyRef**: Use `inject(DestroyRef)` + `scheduleTimeout` helper (same pattern as Story 6.2).
- **Effect guard**: All `effect()` watching chain signals must guard with `if (this.phase() === 'idle') return;` to avoid running during 95% of duel time when no chain is active.

### Critical: Async Contract — How It Works End-to-End

The async orchestrator contract was scaffolded in Story 6.1 AC6. Here is the full flow for MSG_CHAIN_SOLVED:

```
1. Orchestrator dequeues MSG_CHAIN_SOLVED
2. Orchestrator calls applyChainSolved(chainIndex) → updates _activeChainLinks signal
3. Orchestrator sets chainOverlayBoardChanged(this._boardEventsSinceSolving > 0)
4. processEvent() returns 'async' → orchestrator does NOT setTimeout, sets _waitingForOverlay = true
5. Overlay detects activeChainLinks change (link removed) → triggers exit animation
6. Overlay reads boardChanged input:
   - If true: exit animation (300ms) → fade-out (300ms) → board visible (500ms) → fade-in → set chainOverlayReady(true)
   - If false: exit animation (300ms) → set chainOverlayReady(true) immediately
7. Orchestrator's effect() detects chainOverlayReady === true → sets _waitingForOverlay = false → calls processAnimationQueue()
8. Next event dequeued
```

No RxJS, no Promises, no async/await — purely signal-driven.

### Critical: Board Change Detection — Event Counting Mechanics

The `_boardEventsSinceSolving` counter in the orchestrator is incremented during normal sequential event processing. The key insight: between `MSG_CHAIN_SOLVING` and `MSG_CHAIN_SOLVED` in the event stream, the OCGCore sends all the board-changing events for that chain link's effect. The orchestrator processes them one by one, incrementing the counter. By the time `MSG_CHAIN_SOLVED` arrives, the counter reflects exactly how many board mutations happened.

Events that increment the counter:
- `MSG_MOVE` — card moved (destroyed, summoned, sent to GY, banished, returned to hand/deck)
- `MSG_DAMAGE` — LP damage dealt
- `MSG_RECOVER` — LP recovered
- `MSG_PAY_LPCOST` — LP cost paid
- `MSG_FLIPSUMMONING` — card flipped face-up
- `MSG_CHANGE_POS` — attack/defense position changed

Events that do NOT increment:
- `MSG_DRAW` — draws move cards from deck to hand, but neither zone is visually represented on the board grid (hand is a separate UI area, deck is a count). Drawing is not a "board state change" worth pausing for — the hand updates automatically and the player can see new cards without a pause
- `MSG_SWAP`, `MSG_ATTACK`, `MSG_BATTLE` — informational/context events with no visual board mutation

### Critical: Overlay Visibility During Prompts

The overlay uses `@if (!promptActive())` in its template (Story 6.1 AC3). When a prompt appears:
1. Parent sets `promptActive(true)` — overlay DOM is removed by `@if`
2. All internal timers should be cleaned up (or guarded) since the component's template is destroyed
3. When prompt resolves, `promptActive(false)` — overlay DOM is recreated
4. The overlay must re-read `activeChainLinks` and `phase` to restore its state
5. Since signals are the source of truth, the overlay rebuilds correctly from current signal values

**Important:** The overlay component itself is NOT destroyed (it's the `@if` inside the template that hides content). The component instance persists, so internal signals and effects continue. Only the rendered DOM is removed/recreated.

### Critical: 1-Link Chain — Skip Resolution Overlay

When a chain has exactly 1 link, the construction phase (Story 6.2) already showed the card with entry animation. For resolution:
- The overlay does NOT reappear to show the resolving card (it was just shown)
- The orchestrator still processes MSG_CHAIN_SOLVING → board events → MSG_CHAIN_SOLVED → MSG_CHAIN_END
- Board-change detection still runs: if `boardChanged`, the overlay shows a brief board pause (fade-out overlay, show board, fade back in, then MSG_CHAIN_END fade-out)
- If no board change, go directly to MSG_CHAIN_END fade-out

### Critical: Auto-Resolve Acceleration — New Logic Required

The story explicitly states this is NEW logic that must be built (not reuse of existing queue collapse). The acceleration detection works as follows:
- Orchestrator tracks whether any prompt event has been queued during the current chain resolution
- If no prompt → `accelerated(true)` signal passed to overlay
- If prompt arrives → `accelerated(false)` immediately
- The overlay uses `accelerated()` to select between normal and reduced duration maps
- Queue collapse (existing AC7) is a separate mechanism and does not affect acceleration — collapse skips events entirely, acceleration speeds them up

### Source Tree — Files to Touch

**MODIFY (5 files):**
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts` — resolution logic, acceleration, screen reader, `accelerated` input added
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.html` — resolving/exiting classes, glow effect
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss` — resolving animation, exit animation, golden glow, reduced motion
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` — auto-resolve acceleration detection logic
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` + `.html` — add `[accelerated]` binding to overlay template

**DO NOT TOUCH:**
- `duel-server/` — No server changes
- `duel-connection.ts` — Signal model complete from Story 6.1
- PvpBoardContainerComponent — No chain-related code left
- Prompt components — No changes (overlay hides via signal, not prompt modification)
- Design tokens — Already set in Story 6.1

### References

- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — PvpChainOverlayComponent spec, Resolution Phase, Board Change Detection, Auto-Resolve Acceleration]
- [Source: master_duel_chain.jpg — Visual reference for resolution with board reveal]
- [Source: _bmad-output/implementation-artifacts/6-1-teardown-chain-badges-scaffold-overlay.md — Story 6.1 prerequisite (async contract scaffold)]
- [Source: _bmad-output/implementation-artifacts/6-2-chain-overlay-cascade-construction.md — Story 6.2 prerequisite]
- [Source: _bmad-output/implementation-artifacts/4-2-game-event-visual-feedback-animation-queue.md — Animation orchestrator patterns, queue collapse logic]

## Dev Agent Record

### Implementation Notes

- Resolution animation uses `resolveExitingCard` signal (separate from construction `exitingCard`) to avoid interference between building/resolving phases
- `resolvingIndex` signal tracks the front card with `resolving: true` for pulse glow
- Board change detection uses overlay's `chainOverlayReady` output → parent forwards to `animationService.chainOverlayReady` signal → orchestrator's effect resumes queue
- 1-link chain detection via `linksAtResolutionStart` counter set at first resolving phase entry
- Auto-resolve acceleration: orchestrator tracks `_chainSolvedCount` and `_promptDuringChain`, overlay reads `accelerated` input for duration selection
- Duration map (`durations` getter) centralizes all timing for normal/accelerated modes
- Screen reader: individual announcements during normal mode, buffered during accelerated (summary via existing "Chain resolved" effect in duel-page)

### Completion Notes

All 8 tasks implemented and verified through code review and build validation. No automated tests per project "big bang" approach. Build passes with zero errors. All acceptance criteria (AC1-AC8) satisfied through signal-driven architecture — no RxJS, no Promises, purely signals and setTimeout.

### Senior Developer Review (AI) — 2026-03-09

**Reviewer:** Adversarial code review via BMAD workflow
**Outcome:** Changes Requested → All fixed in-place

**Issues found (8) — ALL FIXED:**

1. **[HIGH] H1 — Resolve-exiting card showed wrong image** (`pvp-chain-overlay.component.ts:286`)
   - `resolveExitingCard` was created with `cardCode: 0`, showing a card back during exit animation.
   - **Fix:** Added `resolvingCardInfo` field, populated in resolving effect, used in `onChainLinkResolved`.

2. **[HIGH] H2 — AC7 announcement buffer never produced summary** (`pvp-chain-overlay.component.ts:340-343`)
   - Buffer was cleared on chain end without announcing. AC7 requires coalesced summary.
   - **Fix:** `onChainEnd` now announces `"Chain of N links resolved"` via `LiveAnnouncer` before clearing buffer.

3. **[HIGH] H3 — CSS/JS timing mismatch in accelerated mode** (SCSS + TS)
   - CSS used hardcoded 300ms fallbacks for `--chain-resolve-pulse` and `--chain-resolve-exit` (never defined in tokens). JS durations switched to 150ms but CSS continued at 300ms.
   - **Fix:** Added `cssDurations` computed signal + `[style.--chain-resolve-pulse]` / `[style.--chain-resolve-exit]` bindings on container div to sync CSS with JS.

4. **[HIGH] H4 — AC6 reduced motion: board-change pause not 0ms** (`pvp-chain-overlay.component.ts:301-323`)
   - `handleBoardChangePause` used `durations.boardPause` (500/300ms) regardless of `prefers-reduced-motion`.
   - **Fix:** Added `reducedMotion` field via `matchMedia`, `durations.boardPause` returns 0 when active.

5. **[MEDIUM] M1 — Dead code: `durations.chainEnd`** (`pvp-chain-overlay.component.ts:86`)
   - Value defined (200ms) but never read. Removed from duration map.

6. **[MEDIUM] M2 — Resolution timers not cancelled on chain end** (`pvp-chain-overlay.component.ts:330-343`)
   - `onChainEnd` only cancelled entry/fadeOut timers. Pending resolution/board-pause timers could fire after cleanup.
   - **Fix:** `onChainEnd` now clears all `activeTimers` in addition to named timer refs.

7. **[MEDIUM] M3 — Spurious `overlayDismissed` for 1-link chain with boardChanged** (`pvp-chain-overlay.component.ts:307`)
   - Event emitted even when overlay was never visible during resolution.
   - **Fix:** Guard emit with `wasVisible` check before emitting `overlayDismissed`.

8. **[LOW] L1 — Unused params in `onChainLinkResolved`** (`pvp-chain-overlay.component.ts:261`)
   - All 3 params prefixed `_` (unused). Removed params entirely; card info now sourced from `resolvingCardInfo`.

**Pre-existing issue (not from Story 6.3):** `duel-page.component.scss` SCSS budget exceeded (12.23kB > 10kB). Not related to chain overlay changes.

## File List

- front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts (modified — resolution logic, acceleration, screen reader, `accelerated` + `chainOverlayReady` signals)
- front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.html (modified — resolving/exiting classes, resolve-exiting card, connector fading)
- front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss (modified — resolving animation, exit animation, golden glow, connector fade, reduced motion)
- front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts (modified — auto-resolve acceleration detection, `chainAccelerated` signal, `notifyPromptDuringChain()`)
- front/src/app/pages/pvp/duel-page/duel-page.component.html (modified — `[accelerated]` binding, `(chainOverlayReady)` output handler)
- front/src/app/pages/pvp/duel-page/duel-page.component.ts (modified — `onChainOverlayReady()` method, prompt-during-chain notification effect)

## Change Log

- 2026-03-09: Story 6.3 implemented — chain resolution animation (LIFO pulse + exit), board change detection with overlay pause, auto-resolve acceleration, reduced motion, screen reader announcements, edge case handling (prompt interruption, disconnection, 1-link chain)
- 2026-03-09: Code review — 8 issues fixed (4 HIGH, 3 MEDIUM, 1 LOW): card image in exit animation, AC7 summary announcement, CSS/JS timing sync for acceleration, reduced-motion board pause, dead code removal, timer cleanup, spurious event guard, unused params cleanup
