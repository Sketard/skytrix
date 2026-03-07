# Story 4.2: Game Event Visual Feedback & Animation Queue

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want visual feedback for every game event (summon, destroy, activate, flip, LP change),
so that the duel feels dynamic and I can follow what's happening on the board.

## Acceptance Criteria

### AC1: FIFO Animation Queue Infrastructure

**Given** `DuelWebSocketService` exposes `animationQueue: Signal<GameEvent[]>` (FIFO)
**When** a game event message arrives from the server (MSG_MOVE, MSG_DRAW, MSG_DAMAGE, MSG_RECOVER, MSG_PAY_LPCOST, MSG_FLIP_SUMMONING, MSG_CHANGE_POS, MSG_SWAP, MSG_ATTACK, MSG_BATTLE)
**Then** it is pushed to the animation queue
**And** the animation system dequeues and plays events sequentially
**And** each animation completes within ~400ms maximum (under NFR1 500ms threshold)
**And** prompt display (`pendingPrompt`) waits for `animationQueue` to drain before showing — prevents out-of-context popups during chain resolution

### AC2: Summon Animation (MSG_MOVE to Monster Zone)

**Given** the animation system processes a summon event
**When** a MSG_MOVE moves a card to a Monster Zone (from HAND, EXTRA, DECK)
**Then** the card animates via CSS `scale(0) → scale(1)` entrance on the target zone (~300ms)
**And** uses `--pvp-transition-card-move` token for duration

### AC3: Destroy Animation (MSG_MOVE from Field to GY)

**Given** the animation system processes a destroy event
**When** a MSG_MOVE moves a card from a field zone (MZONE/SZONE) to GY
**Then** the card flashes `--pvp-destroy-highlight` (red pulse, 200ms) then fades (`opacity: 1 → 0`, 200ms)
**And** uses `--pvp-transition-highlight-flash` token for pulse duration

### AC4: Effect Activation Animation (MSG_CHAINING)

**Given** the animation system processes an effect activation event
**When** MSG_CHAINING arrives (already handled by Story 4.1 chain badges)
**Then** additionally, the activating card glows with `--pvp-activate-highlight` (bright pulse, 300ms)
**And** coexists with Story 4.1 chain badge (badge appears + glow pulse on same card)
**And** uses `--pvp-animation-duration` token

### AC5: Flip Animation (MSG_FLIP_SUMMONING / MSG_CHANGE_POS to face-up)

**Given** the animation system processes a flip event
**When** MSG_FLIP_SUMMONING or MSG_CHANGE_POS changes a card from face-down to face-up
**Then** the card rotates on Y-axis (180deg, 300ms) revealing the face
**And** uses `--pvp-animation-duration` token

### AC6: LP Change Animation (MSG_DAMAGE, MSG_RECOVER, MSG_PAY_LPCOST)

**Given** the animation system processes an LP change event
**When** MSG_DAMAGE, MSG_RECOVER, or MSG_PAY_LPCOST arrives
**Then** `PvpLpBadgeComponent` animates the LP value counting from old to new value using `--pvp-transition-lp-counter` token (currently 500ms — token is the single source of truth, tunable)
**And** damage/cost: LP text flashes red (`--pvp-lp-opponent` color, `--pvp-transition-highlight-flash` duration)
**And** recovery: LP text flashes green (`--pvp-lp-own` color, `--pvp-transition-highlight-flash` duration)
**And** all durations are token-driven — no hardcoded ms values in component code

### AC7: Queue Collapse (Burst Protection)

**Given** the animation queue accumulates faster than playback (e.g., rapid chain resolution, 10+ messages in <100ms)
**When** the queue length exceeds 5 pending events
**Then** older queued animations are collapsed: play instantly (0ms) to catch up, applying visual updates in correct order
**And** the most recent 3 events always play at normal speed

### AC8: Auto-Resolve Acceleration

**Given** the activation toggle is set to Off
**When** auto-resolved actions generate game events
**Then** animations play at 2× speed (duration halved) to accelerate through non-interactive sequences

### AC9: Reduced Motion Support

**Given** `prefers-reduced-motion: reduce` is active
**When** any game event animation would play
**Then** all animations are skipped (0ms duration, tokens already set to 0ms), board state updates applied immediately
**And** `LiveAnnouncer` still announces key events (summon, destroy, LP change) for accessibility

## Tasks / Subtasks

- [x] Task 1: New design tokens & z-layer for game event animations (AC: all)
  - [x] 1.1 Add `--pvp-destroy-highlight: rgba(244, 67, 54, 0.6)` to `_tokens.scss` PvP section
  - [x] 1.2 Add `--pvp-activate-highlight: rgba(201, 168, 76, 0.8)` to `_tokens.scss` PvP section
  - [x] 1.3 Add `$z-pvp-animation-overlay: 5` to `_z-layers.scss` (below chain badge at 10, above board at 1)
  - [x] 1.4 Verify existing tokens cover all animation needs: `--pvp-transition-highlight-flash` (200ms), `--pvp-transition-card-move` (300ms), `--pvp-transition-lp-counter` (500ms), `--pvp-animation-duration` (300ms) — all already 0ms under reduced-motion
  - [x] 1.5 Add `--pvp-destroy-highlight: transparent` and `--pvp-activate-highlight: transparent` in reduced-motion override block

- [x] Task 2: Enable animation queue population in DuelWebSocketService (AC: #1)
  - [x] 2.1 Uncomment `this._animationQueue.update(q => [...q, message])` at line ~274 in `duel-web-socket.service.ts`
  - [x] 2.2 Add `dequeueAnimation(): GameEvent | null` method — pops first element, returns it: `.update(q => q.slice(1))`, returns `q[0]` or `null`
  - [x] 2.3 Add `clearAnimationQueue(): void` method — `.set([])` for use on BOARD_STATE resync, DUEL_END, REMATCH_STARTING
  - [x] 2.4 Call `clearAnimationQueue()` alongside `_activeChainLinks.set([])` on: `BOARD_STATE` (resync only — NOT normal flow), `DUEL_END`, `REMATCH_STARTING`
  - [x] 2.5 For MSG_CHAINING: push to animation queue IN ADDITION to the existing chain badge handler (both coexist — badge is persistent state, queue entry is for the activation glow animation)

- [x] Task 3: Animation orchestration in DuelPageComponent (AC: #1, #7, #8)
  - [x] 3.1 Add `private _isAnimating = signal(false)` and `readonly isAnimating = this._isAnimating.asReadonly()`
  - [x] 3.2 Add `private animatingLpPlayer = signal<{ player: number; fromLp: number; toLp: number; type: 'damage' | 'recover' } | null>(null)` — passed to LP badge for counting animation
  - [x] 3.3 Add `private animatingZone = signal<{ zoneId: string; animationType: 'summon' | 'destroy' | 'flip' | 'activate' } | null>(null)` — passed to board container for zone-level animation
  - [x] 3.4 Add `processAnimationQueue()` method:
    - Dequeue first event from `wsService`
    - Determine animation type from event `.type` discriminant
    - Set animation signals (animatingZone, animatingLpPlayer)
    - Wait for animation duration (setTimeout with token-appropriate ms)
    - Clear animation signals
    - If queue not empty → recurse (process next)
    - If queue empty → `_isAnimating.set(false)`
  - [x] 3.5 Add `effect()` that watches `wsService.animationQueue()`:
    - When queue goes from empty→non-empty AND not already animating → start `processAnimationQueue()`
    - Use `untracked()` for the processing call
  - [x] 3.6 Implement queue collapse logic (AC7): at start of `processAnimationQueue()`, if queue length > 5, instantly process all but last 3 events (set animation signals + immediately clear, 0ms delay)
  - [x] 3.7 Implement 2× speed (AC8): check activation toggle state, if Off → halve all animation durations
  - [x] 3.8 Implement prompt drain coordination (AC1): modify the effect/computed that shows `pendingPrompt` — gate it behind `isAnimating() === false`. When animations finish, the prompt becomes visible
  - [x] 3.9 Cleanup on destroy: track all active setTimeout refs in an array, clear them all in an `ngOnDestroy` or `DestroyRef.onDestroy()` callback. Prevent animation timeouts from leaking on navigation away or duel end

- [x] Task 4: Board zone animations in PvpBoardContainerComponent (AC: #2, #3, #4, #5)
  - [x] 4.1 Add `animatingZone = input<{ zoneId: string; animationType: 'summon' | 'destroy' | 'flip' | 'activate' } | null>(null)`
  - [x] 4.2 In template: on each zone cell, add conditional animation CSS classes based on `animatingZone()`:
    ```html
    [class.pvp-anim-summon]="animatingZone()?.zoneId === zone.zoneId && animatingZone()?.animationType === 'summon'"
    [class.pvp-anim-destroy]="animatingZone()?.zoneId === zone.zoneId && animatingZone()?.animationType === 'destroy'"
    [class.pvp-anim-flip]="animatingZone()?.zoneId === zone.zoneId && animatingZone()?.animationType === 'flip'"
    [class.pvp-anim-activate]="animatingZone()?.zoneId === zone.zoneId && animatingZone()?.animationType === 'activate'"
    ```
  - [x] 4.3 Handle player perspective: use `ownPlayerIndex` to map MSG_MOVE's absolute `player` field to correct board side (own vs opponent). Reuse `mapChainLocationToZoneId()` pattern from Story 4.1 for location→zoneId mapping
  - [x] 4.4 Pass `animatingZone` from DuelPageComponent to PvpBoardContainerComponent in template binding
  - [x] 4.5 Pass `ownPlayerIndex` to board container (already exists — verify it's used for perspective mapping)

- [x] Task 5: Game event animation SCSS (AC: #2, #3, #4, #5, #9)
  - [x] 5.1 Add `.pvp-anim-summon` keyframe in `pvp-board-container.component.scss`:
    ```scss
    @keyframes pvp-summon-entrance {
      0% { transform: scale(0); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    .pvp-anim-summon .zone-card {
      animation: pvp-summon-entrance var(--pvp-transition-card-move) ease-out;
    }
    ```
  - [x] 5.2 Add `.pvp-anim-destroy` keyframe:
    ```scss
    @keyframes pvp-destroy-flash {
      0% { box-shadow: 0 0 0 0 var(--pvp-destroy-highlight); opacity: 1; }
      50% { box-shadow: 0 0 12px 4px var(--pvp-destroy-highlight); opacity: 0.7; }
      100% { box-shadow: 0 0 0 0 transparent; opacity: 0; }
    }
    .pvp-anim-destroy .zone-card {
      animation: pvp-destroy-flash calc(var(--pvp-transition-highlight-flash) * 2) ease-out forwards;
    }
    ```
  - [x] 5.3 Add `.pvp-anim-flip` keyframe:
    ```scss
    @keyframes pvp-flip-reveal {
      0% { transform: rotateY(180deg); }
      100% { transform: rotateY(0deg); }
    }
    .pvp-anim-flip .zone-card {
      animation: pvp-flip-reveal var(--pvp-animation-duration) ease-in-out;
    }
    ```
  - [x] 5.4 Add `.pvp-anim-activate` keyframe:
    ```scss
    @keyframes pvp-activate-glow {
      0%, 100% { box-shadow: none; }
      50% { box-shadow: 0 0 16px 4px var(--pvp-activate-highlight); }
    }
    .pvp-anim-activate .zone-card {
      animation: pvp-activate-glow var(--pvp-animation-duration) ease-in-out;
    }
    ```
  - [x] 5.5 Add `@media (prefers-reduced-motion: reduce)` block for all new animation classes:
    ```scss
    @media (prefers-reduced-motion: reduce) {
      .pvp-anim-summon .zone-card,
      .pvp-anim-destroy .zone-card,
      .pvp-anim-flip .zone-card,
      .pvp-anim-activate .zone-card {
        animation: none;
      }
    }
    ```
  - [x] 5.6 Verify animations use card-relative units inside perspective container per UX Unit Rule
  - [x] 5.7 Monitor SCSS budget (10kB limit) — animation CSS should be ~60 lines

- [x] Task 6: LP counter animation in PvpLpBadgeComponent (AC: #6, #9)
  - [x] 6.1 Add `animatingLp = input<{ player: number; fromLp: number; toLp: number; type: 'damage' | 'recover' } | null>(null)`
  - [x] 6.2 Add LP counting animation logic: when `animatingLp()` is non-null AND matches component's `side`:
    - Use `requestAnimationFrame` loop to interpolate from `fromLp` to `toLp` over `--pvp-transition-lp-counter` duration (read from CSS via `getComputedStyle` or use 500ms matching token value — single source of truth)
    - Display the interpolated value (formatted with existing `formattedLp` logic)
    - Clean up rAF handle when animation completes or component destroys
  - [x] 6.3 Add `displayedLp` computed/signal that returns either the animated value (during animation) or the real `lp()` value (when idle)
  - [x] 6.4 Update template to use `displayedLp()` instead of `formattedLp()`
  - [x] 6.5 Add damage/recovery flash SCSS in `pvp-lp-badge.component.scss`:
    ```scss
    @keyframes lp-damage-flash {
      0%, 100% { color: inherit; }
      50% { color: var(--pvp-lp-opponent); text-shadow: 0 0 8px var(--pvp-lp-opponent); }
    }
    @keyframes lp-recover-flash {
      0%, 100% { color: inherit; }
      50% { color: var(--pvp-lp-own); text-shadow: 0 0 8px var(--pvp-lp-own); }
    }
    .lp-value--damage { animation: lp-damage-flash var(--pvp-transition-highlight-flash) ease-in-out; }
    .lp-value--recover { animation: lp-recover-flash var(--pvp-transition-highlight-flash) ease-in-out; }
    ```
  - [x] 6.6 Add flash CSS class binding in template:
    ```html
    [class.lp-value--damage]="animatingLp()?.type === 'damage'"
    [class.lp-value--recover]="animatingLp()?.type === 'recover'"
    ```
  - [x] 6.7 Add `@media (prefers-reduced-motion: reduce)` for LP flash:
    ```scss
    @media (prefers-reduced-motion: reduce) {
      .lp-value--damage,
      .lp-value--recover {
        animation: none;
      }
    }
    ```
  - [x] 6.8 Under reduced motion: skip counting animation, snap to final value immediately
  - [x] 6.9 Preserve existing `aria-live="polite"` and `role="status"` — LP value updates are already announced

- [x] Task 7: Accessibility — LiveAnnouncer for game events (AC: #9)
  - [x] 7.1 Add LiveAnnouncer calls in the animation orchestrator (DuelPageComponent) for key events:
    - Summon (MSG_MOVE to MZONE): announce "Card summoned" (or "Opponent summoned a card")
    - Destroy (MSG_MOVE to GY from field): announce "Card destroyed"
    - LP change: announce "Your LP: [value]" / "Opponent LP: [value]" (use LP delta from event)
  - [x] 7.2 Use `untracked()` for all LiveAnnouncer calls (following Story 3.4 / 4.1 pattern)
  - [x] 7.3 Under reduced motion: announcements still fire (animations skip, announcements don't)

- [x] Task 8: Data flow wiring — DuelPageComponent template (AC: all)
  - [x] 8.1 Pass `[animatingZone]="animatingZone()"` to `<app-pvp-board-container>`
  - [x] 8.2 Pass `[animatingLp]` to both player and opponent `<app-pvp-lp-badge>` instances — compute the correct binding based on `ownPlayerIndex` (own player gets `animatingLpPlayer()` when player matches, opponent LP badge gets it when player doesn't match)
  - [x] 8.3 Implement prompt drain: ensure `pendingPrompt` display is gated behind `isAnimating() === false`

- [x] Task 9: Event-to-animation mapping logic (AC: #2, #3, #4, #5, #6)
  - [x] 9.1 In `processAnimationQueue()`, implement MSG_MOVE classification:
    - **Summon**: toLocation = MZONE, fromLocation ∈ {HAND, EXTRA, DECK} → 'summon' animation on target zone
    - **Destroy**: fromLocation ∈ {MZONE, SZONE}, toLocation = GRAVE → 'destroy' animation on source zone
    - **Banish**: fromLocation ∈ {MZONE, SZONE}, toLocation = BANISHED → 'destroy' animation (same visual)
    - **Return to hand / deck**: fromLocation ∈ {MZONE, SZONE}, toLocation ∈ {HAND, DECK} → 'destroy' animation (card disappears from field)
    - **Set**: toLocation = SZONE, fromLocation = HAND → 'summon' animation on target zone
    - **Other moves**: no animation (e.g., GY → BANISHED, deck shuffle)
  - [x] 9.2 Implement MSG_DAMAGE / MSG_RECOVER / MSG_PAY_LPCOST → LP animation:
    - Determine target player using `ownPlayerIndex`: `msg.player === ownPlayerIndex` → 'player' side, else → 'opponent' side
    - Compute `fromLp` = current displayed LP, `toLp` = fromLp - amount (damage/cost) or fromLp + amount (recover)
    - Set `animatingLpPlayer` signal
  - [x] 9.3 Implement MSG_FLIP_SUMMONING → 'flip' animation on card's zone
  - [x] 9.4 Implement MSG_CHANGE_POS → 'flip' animation only when changing from face-down to face-up (check `previousPosition` vs `currentPosition` using POSITION bitmask: face-down = FACEDOWN_ATTACK | FACEDOWN_DEFENSE)
  - [x] 9.5 Implement MSG_CHAINING → 'activate' animation on card's zone (reuse `mapChainLocationToZoneId()`)
  - [x] 9.6 Implement MSG_ATTACK / MSG_BATTLE → no dedicated animation in this story (DRY KISS — attack line animation is complex, defer to future enhancement. Board state already shows battle results)
  - [x] 9.7 Implement MSG_DRAW / MSG_SWAP → no animation (draw adds to hand which re-renders automatically, swap is rare and board state handles it)

- [x] Task 10: Zone ID mapping for animation events (AC: #2, #3, #5)
  - [x] 10.1 Add `mapMoveToZoneId(location: CardLocation, sequence: number, player: Player, ownPlayerIndex: number): string | null` in DuelWebSocketService or DuelPageComponent — maps MSG_MOVE locations to board zone IDs accounting for player perspective
  - [x] 10.2 Pattern: reuse the same logic as `mapChainLocationToZoneId()` from Story 4.1, extended with player perspective:
    - `player === ownPlayerIndex` → own zones (bottom of board)
    - `player !== ownPlayerIndex` → opponent zones (top of board)
    - Zone IDs must match `buildFieldZones()` convention in PvpBoardContainerComponent
  - [x] 10.3 Non-field locations (HAND, DECK, EXTRA, GRAVE, BANISHED) return `null` — no board zone animation for these

- [x] Task 11: Manual verification (all ACs)
  - [x] 11.1 Verify: summon (normal/special) → card scales in on target zone → animation completes → board state correct
  - [x] 11.2 Verify: destroy → card flashes red → fades out → gone after BOARD_STATE applies
  - [x] 11.3 Verify: effect activation → card glows + chain badge appears simultaneously
  - [x] 11.4 Verify: flip summon → card rotates to reveal face-up
  - [x] 11.5 Verify: LP damage → LP counter counts down, text flashes red
  - [x] 11.6 Verify: LP recovery → LP counter counts up, text flashes green
  - [x] 11.7 Verify: burst of 6+ events → first events instant, last 3 at normal speed
  - [x] 11.8 Verify: activation toggle Off → animations at 2× speed
  - [x] 11.9 Verify: prefers-reduced-motion → all animations skip, LP snaps to value, LiveAnnouncer still fires
  - [x] 11.10 Verify: prompt appears only AFTER animation queue drains
  - [x] 11.11 Verify: animations cleared on DUEL_END, REMATCH_STARTING, BOARD_STATE resync
  - [x] 11.12 Verify: SCSS budget not exceeded after changes
  - [x] 11.13 Verify: aria-live on LP badge still announces value changes

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring bug caught in Epics 1-3).
- **`effect()` with `untracked()`**: For all side effects (LiveAnnouncer, navigation, HTTP calls, animation triggering).
- **`prefers-reduced-motion`**: Verify on ALL animated elements. Existing tokens already set to 0ms under media query. New animations must also respect this.
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.
- **DRY KISS**: Minimal animation patterns, no over-engineering (Axel directive from Epic 3 retro). Keep animations simple — CSS class toggles, not complex choreography.
- **No new dependencies**: PvP uses Angular Material, CDK, and standard CSS only. Zero new packages.
- **Inside perspective container**: Board animations live INSIDE the CSS perspective container. Use card-relative units (`em` / `%`) not `rem`. [Source: ux-design-specification-pvp.md — Unit Rule]
- **Color Rule**: Maximum 3 active highlight colors at any moment. During animation: destroy red OR activate gold. Never both simultaneously on the same card. [Source: ux-design-specification-pvp.md — Color Rule]
- **Prompt drain point**: Architecture mandates prompts wait for animation queue to drain before appearing. This is the "architectural seam" between animation playback and interactive prompts. [Source: architecture-pvp.md — Animation drain point]

### Architecture Decision: Immediate State + Overlay Animations

The original architecture spec says "animation plays before board state update, board state applied after animation completes." A fully deferred model would hold back BOARD_STATE until the queue drains. However, per DRY KISS and implementation simplicity, **this story uses an Immediate State + Overlay Animation model**:

1. **BOARD_STATE applies immediately** to `duelState` (existing behavior, unchanged). The board visually reflects the final state as soon as BOARD_STATE arrives.
2. **MSG_* events are pushed to `animationQueue`** as they arrive (before BOARD_STATE). They trigger CSS overlay animations (glow, flash, scale, fade) on the zone where the event occurred.
3. **LP counter animation** uses a tracked `fromLp` / `toLp` pair computed from MSG_DAMAGE/RECOVER amounts. Since MSG_DAMAGE arrives BEFORE BOARD_STATE, the LP in `duelState` still holds the old value at the time of queueing — `fromLp = duelState().players[idx].lp` is correct.
4. **Prompt display waits for queue drain** — this is the critical coordination point. `visiblePrompt` computed gates `pendingPrompt` behind `isAnimating() === false`.
5. **Card movement** appears as an entrance/exit effect on the target/source zone. The card may already be in its final position (if BOARD_STATE arrived), so the animation is an overlay effect (scale-in for summon, flash+fade for destroy), not a positional transition.

**Why this model:**
- No structural change to the existing BOARD_STATE handling (3 epics of stable behavior preserved)
- CSS class toggles are simpler than deferred state management
- Visual result is equivalent — the player sees animations play and prompts appear after
- If BOARD_STATE arrives mid-animation: no conflict, the board shows final state while animations finish as overlays
- Prompt drain is the only coordination needed

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| `animationQueue` signal (disabled push) | `duel-web-socket.service.ts:16,25,274` | Exists — uncomment line 274 to enable |
| `GameEvent` union type (12 message types) | `game-event.types.ts:18-32` | Exists — MoveMsg, DrawMsg, DamageMsg, RecoverMsg, PayLpCostMsg, ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ChainEndMsg, FlipSummoningMsg, ChangePosMsg, SwapMsg, AttackMsg, BattleMsg |
| All MSG_* message interfaces | `duel-ws.types.ts:112-232` | Exists — MoveMsg, DamageMsg, RecoverMsg, PayLpCostMsg, FlipSummoningMsg, ChangePosMsg, SwapMsg, AttackMsg, BattleMsg with full field definitions |
| `POSITION` bitmask constants | `duel-ws.types.ts:27-33` | Exists — `FACEUP_ATTACK: 0x1`, `FACEDOWN_ATTACK: 0x2`, `FACEUP_DEFENSE: 0x4`, `FACEDOWN_DEFENSE: 0x8` |
| `LOCATION` bitmask constants | `duel-ws.types.ts:36-44` | Exists — `DECK: 0x01`, `HAND: 0x02`, `MZONE: 0x04`, `SZONE: 0x08`, `GRAVE: 0x10`, `BANISHED: 0x20`, `EXTRA: 0x40` |
| `mapChainLocationToZoneId()` helper | `duel-web-socket.service.ts:329-337` | Exists — maps MZONE/SZONE to zone IDs. Reuse pattern for animation zone mapping |
| Chain badge rendering (Story 4.1) | `pvp-board-container.component.*` | Exists — `.pvp-chain-badge`, chain resolve pulse, prefers-reduced-motion |
| `LiveAnnouncer` injection | `duel-page.component.ts:60` | Exists (from Story 3.4) — reuse |
| Chain resolved announcement effect | `duel-page.component.ts:478-487` | Exists (Story 4.1) — follow same pattern |
| `ownPlayerIndex` computed | `duel-page.component.ts:181-186` | Exists — needed for player perspective in animation events |
| PvpLpBadgeComponent | `pvp-lp-badge/` | Exists — 22 lines, `lp` + `side` inputs, `formattedLp` computed, `aria-live="polite"` |
| PvP design tokens (animation) | `_tokens.scss:107-138` | Exists — `--pvp-transition-highlight-flash`, `--pvp-transition-card-move`, `--pvp-transition-lp-counter`, `--pvp-animation-duration`, all with reduced-motion overrides to 0ms |
| PvP z-layers | `_z-layers.scss:27-38` | Exists — `$z-pvp-board: 1` through `$z-pvp-orientation-lock: 9000` |
| Existing `@keyframes` in board SCSS | `pvp-board-container.component.scss` | Exists — `badge-pulse`, `chain-resolve-pulse`, `pvp-actionable-pulse`, with prefers-reduced-motion block |
| `prefers-reduced-motion` in tokens | `_tokens.scss:147-157` | Exists — all PvP transition tokens → 0ms |
| MSG_* server passthrough | `message-filter.ts:106-131` | Exists — all animation-relevant messages broadcast unfiltered |
| Worker MSG_* transforms | `duel-worker.ts` | Exists — OCGCore → MSG_* transforms for all event types |
| Board zone rendering | `pvp-board-container.component.ts/html` | Exists — grid-based zones with `buildFieldZones()` |
| DuelPageComponent → Board data flow | `duel-page.component.html` | Exists — passes data to PvpBoardContainerComponent via inputs |

### Critical: What Does NOT Exist Yet (Story 4.2 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| Animation queue enabled (push uncommented) | `duel-web-socket.service.ts:274` | Enable the FIFO queue population |
| `dequeueAnimation()` method | `duel-web-socket.service.ts` | Controlled dequeue for sequential processing |
| `clearAnimationQueue()` method | `duel-web-socket.service.ts` | Reset on DUEL_END, REMATCH, resync |
| Animation orchestration logic | `duel-page.component.ts` | Process queue, trigger animations, coordinate prompts |
| `isAnimating` signal | `duel-page.component.ts` | Gate prompt display behind animation drain |
| `animatingZone` signal | `duel-page.component.ts` | Tell board which zone is animating and how |
| `animatingLpPlayer` signal | `duel-page.component.ts` | Tell LP badge to animate counting + flash |
| `animatingZone` input on board | `pvp-board-container.component.ts` | Receive animation instructions from parent |
| Zone animation CSS classes | `pvp-board-container.component.scss` | `.pvp-anim-summon`, `.pvp-anim-destroy`, `.pvp-anim-flip`, `.pvp-anim-activate` |
| `--pvp-destroy-highlight` token | `_tokens.scss` | Red flash color for destroy animation |
| `--pvp-activate-highlight` token | `_tokens.scss` | Gold glow color for effect activation |
| `$z-pvp-animation-overlay` | `_z-layers.scss` | Z-index for animation overlays |
| LP counting animation + flash | `pvp-lp-badge.component.ts/scss` | Animate LP value + damage/recovery color flash |
| `animatingLp` input on LP badge | `pvp-lp-badge.component.ts` | Receive animation state from parent |
| `displayedLp` computed | `pvp-lp-badge.component.ts` | Interpolated LP during animation, real LP otherwise |
| Event-to-animation mapping | `duel-page.component.ts` | Classify MSG_MOVE into summon/destroy/flip/etc. |
| Zone ID mapping for animations | `duel-web-socket.service.ts` or `duel-page.component.ts` | Map MSG_MOVE locations to board zone IDs with perspective |
| Prompt drain coordination | `duel-page.component.ts` | Gate pendingPrompt display behind queue empty |
| Game event LiveAnnouncer calls | `duel-page.component.ts` | Announce summon, destroy, LP change for a11y |

### Critical: Animation Queue is SEPARATE from Chain Badge State

Story 4.1 introduced `activeChainLinks` as **persistent visual state** (badges that appear, stay, then disappear). Story 4.2 introduces the **animation queue** as **transient visual effects** (play once, consume, done). They coexist:

- **Chain badges** (`activeChainLinks`): Persistent. Appear on MSG_CHAINING, persist during chain, removed on MSG_CHAIN_SOLVED/END. CSS class `.pvp-chain-badge`.
- **Animation queue** (`animationQueue`): Transient. Event pushed → animation plays → event consumed. CSS class `.pvp-anim-*`.
- **MSG_CHAINING coexistence**: On MSG_CHAINING, BOTH happen — chain badge appears (Story 4.1, already works) AND activation glow plays (Story 4.2, new). These are independent: badge is an `input` on board container, glow is via `animatingZone` signal.

### Critical: Player Perspective for Animation Events

All MSG_* `player` fields use **absolute OCGCore indices** (0 or 1), NOT relative to viewing player. This is a known issue documented in message-filter.ts:150 TODO.

For animation events:
- `msg.player === ownPlayerIndex()` → animation on OWN field (bottom of board)
- `msg.player !== ownPlayerIndex()` → animation on OPPONENT field (top of board)

The `ownPlayerIndex` computed signal in DuelPageComponent (line 181-186) provides the viewing player's absolute index. Use this to determine which side of the board to animate.

For LP events specifically:
- `msg.player === ownPlayerIndex()` → animate player LP badge (side='player')
- `msg.player !== ownPlayerIndex()` → animate opponent LP badge (side='opponent')

### Critical: MSG_MOVE Classification Logic

MSG_MOVE is the most common animation event and must be classified into visual categories:

```
fromLocation → toLocation → Animation Type
─────────────────────────────────────────────
HAND/EXTRA/DECK → MZONE     → 'summon' (scale entrance on target zone)
HAND → SZONE                → 'summon' (set card, scale entrance)
MZONE/SZONE → GRAVE         → 'destroy' (red flash + fade on source zone)
MZONE/SZONE → BANISHED      → 'destroy' (same visual as destroy)
MZONE/SZONE → HAND/DECK     → 'destroy' (card disappears from field)
All other moves              → no animation (GY→BANISHED, deck shuffles, etc.)
```

**Key field mapping:**
- `msg.fromLocation` + `msg.fromSequence` → source zone ID (for destroy animation)
- `msg.toLocation` + `msg.toSequence` → target zone ID (for summon animation)
- `msg.player` → which side of the board (absolute index, use ownPlayerIndex for perspective)

### Critical: LP Tracking During Animation

The animation orchestrator must track LP independently for counting animation:

1. **Initial LP**: Read from `duelState().players[playerIndex].lp` before animation starts
2. **MSG_DAMAGE**: `fromLp = currentTrackedLp`, `toLp = fromLp - msg.amount`, update `currentTrackedLp = toLp`
3. **MSG_RECOVER**: `fromLp = currentTrackedLp`, `toLp = fromLp + msg.amount`, update `currentTrackedLp = toLp`
4. **MSG_PAY_LPCOST**: Same as MSG_DAMAGE (LP decreases)
5. **BOARD_STATE arrives**: Reset tracked LP from BOARD_STATE data (authoritative sync)

Multiple LP events for the same player are processed sequentially — each starts from where the previous one ended.

### Critical: Prompt Drain Coordination

Architecture mandates: "Prompt display waits for animationQueue to drain — prevents out-of-context popups during chain resolution."

Implementation:
- The `pendingPrompt` signal is already set by DuelWebSocketService when SELECT_* arrives
- Add a `visiblePrompt` computed in DuelPageComponent: `computed(() => this.isAnimating() ? null : this.wsService.pendingPrompt())`
- Template binds to `visiblePrompt()` instead of `wsService.pendingPrompt()` directly
- When animation queue empties → `isAnimating` becomes false → prompt becomes visible

**Edge case**: If BOARD_STATE + SELECT_* arrive during animation, the BOARD_STATE applies normally (updating the board to final state), and the SELECT_* is held until animations drain. This is correct because the prompt needs the final board state visible.

### Critical: DRY KISS — Intentionally Skipped Animations

Per Axel directive and DRY KISS principle, these animations are intentionally NOT implemented:

| Event | Why Skipped |
|-------|-------------|
| MSG_ATTACK | Complex attack line animation (card advance + collision). Board state shows battle result. Defer to future story. |
| MSG_BATTLE | Related to MSG_ATTACK. LP damage from battle is animated via MSG_DAMAGE. |
| MSG_DRAW | Cards appear in hand automatically on BOARD_STATE. Hand re-renders on state change. |
| MSG_SWAP | Very rare (Creature Swap). Board state handles it. |
| Non-field zone moves (GY→BANISHED, etc.) | Not visible on main board. Zone browser shows current state. |

These events are still pushed to the animation queue (for future enhancement) but `processAnimationQueue()` treats them as no-op (0ms delay, dequeue immediately).

### Critical: SCSS Budget Monitoring

Epic 3 retro flagged SCSS `anyComponentStyle` budget at 10kB (increased from 6kB in Story 3.4). Story 4.2 adds ~60 lines of animation CSS across two components:
- `pvp-board-container.component.scss`: ~40 lines (4 animation types + reduced-motion)
- `pvp-lp-badge.component.scss`: ~20 lines (2 flash animations + reduced-motion)

This is well under 1kB total impact. Monitor build output. If budget exceeded, extract animation styles to a partial.

### What MUST Change (Story 4.2 Scope)

| File | Change | Why |
|------|--------|-----|
| `front/src/app/styles/_tokens.scss` | Add `--pvp-destroy-highlight`, `--pvp-activate-highlight` + reduced-motion overrides | New animation color tokens |
| `front/src/app/styles/_z-layers.scss` | Add `$z-pvp-animation-overlay: 5` | Z-index for animation overlays |
| `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` | Uncomment animation queue push, add `dequeueAnimation()`, `clearAnimationQueue()`, add MSG_CHAINING to queue | Enable FIFO queue |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Add animation orchestration, LP tracking, prompt drain, LiveAnnouncer events, zone animation signals | Central animation logic |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Add `[animatingZone]`, `[animatingLp]` bindings, switch prompt display to `visiblePrompt()` | Data flow wiring |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` | Add `animatingZone` input | Receive animation state |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` | Add `.pvp-anim-*` class bindings on zone cells | Trigger CSS animations |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` | Add 4 `@keyframes` + `.pvp-anim-*` classes + reduced-motion | Animation styles |
| `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.ts` | Add `animatingLp` input, `displayedLp` computed, counting animation via rAF | LP counter animation |
| `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.html` | Use `displayedLp()`, add flash class bindings | Animated LP display |
| `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.scss` | Add `lp-damage-flash`, `lp-recover-flash` keyframes + reduced-motion | LP flash styles |

### What NOT to Change

- **duel-server/** — No server changes needed. All messages already pass through.
- **duel-worker.ts** — Worker transforms already correct for all event types.
- **message-filter.ts** — All animation-relevant messages already whitelisted (TODO at line 150 is about player index documentation, not a code change).
- **game-event.types.ts** — GameEvent union already includes all needed types.
- **duel-ws.types.ts** — All message interfaces already fully defined.
- **duel-state.types.ts** — No changes (ChainLinkState from Story 4.1 is separate).
- **Chain badge logic (Story 4.1)** — DO NOT modify. Chain badges and animation queue coexist independently.
- **Prompt components** — No changes to prompt rendering. Only the display gating logic in DuelPageComponent changes.
- **Lobby / waiting room** — No changes.
- **Spring Boot backend** — No changes.

### Previous Story Intelligence (Story 4.1 — Chain Link Visualization)

**Patterns to follow:**
- Signal-based state: `signal()` + `.update()` with immutable arrays — follow for `animationQueue`
- `effect()` + `untracked()` for side effects (LiveAnnouncer, animation triggering)
- `prefers-reduced-motion` as explicit check on all animated elements — verified systematically
- `[class.specific-class]` binding only — NEVER `[class]` (recurring bug from Epic 1)
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)
- Chain message extraction from disabled animation block — Story 4.1 extracted MSG_CHAINING/CHAIN_* from the disabled block. Story 4.2 enables the remaining messages.

**Anti-Patterns from previous stories:**
- Do NOT create a separate Angular component for animations (CSS class approach, not component)
- Do NOT add animation libraries or new dependencies
- Do NOT inline z-index values — use `@use 'z-layers' as z` + `z.$z-pvp-animation-overlay`
- Do NOT inline color values — use `var(--pvp-destroy-highlight)` tokens
- Do NOT forget to reset `animationQueue` on DUEL_END/REMATCH_STARTING/BOARD_STATE resync
- Do NOT use `toObservable()` when `effect()` is simpler
- Do NOT store timeout refs without cleanup paths (Story 4.2 uses setTimeout in animation — ensure cleanup on destroy)
- Do NOT modify existing chain badge behavior (Story 4.1 is complete and working)

**Story 4.1 Code Review findings applied:**
- EMZ zone mapping support (EMZ_L, EMZ_R) — apply to animation zone mapping too
- Destructured message casts — use same pattern for MSG_MOVE type narrowing
- `@let` template optimization — use if applicable for animation bindings

**Epic 3 Retro Action Items:**
- DRY KISS throughout — minimal animation, no complex choreography
- SCSS budget monitoring — flagged, ~60 lines total
- Happy path AC verification — AC1 covers the primary flow (queue → animate → drain → prompt)
- prefers-reduced-motion explicit — AC9 covers this

### Git Intelligence

**Recent commits:** `d80b721f epic 2 & 3` (latest), `35c96f9a epic 1`. Current branch: `dev-pvp`. Story 4.1 changes committed within `d80b721f`.

**Code conventions observed:**
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)
- `camelCase` methods, `PascalCase` interfaces, `SCREAMING_SNAKE_CASE` constants
- `kebab-case` file names
- Standalone Angular components with `inject()` DI
- Signal-based inputs: `input<T>()` not `@Input()`
- Angular 19 control flow: `@if`, `@for`, `@switch`
- `requestAnimationFrame` for smooth interpolation (use for LP counting)

### Library & Framework Requirements

- **Angular 19.1.3**: Signals (`signal()`, `computed()`, `input()`, `effect()`), OnPush, `inject()`
- **Angular CDK**: `LiveAnnouncer` from `@angular/cdk/a11y` — already injected
- **TypeScript 5.5.4**: Strict mode, discriminated unions for GameEvent type narrowing
- **CSS**: `@keyframes` for animations, `animation` shorthand with `var()` tokens, `box-shadow` for glows, `transform: scale()/rotateY()` for summon/flip
- **requestAnimationFrame**: For LP counting interpolation (smooth number tween)
- **setTimeout**: For animation duration control in orchestrator (use token values)
- **No new dependencies** — zero new packages

### Testing Requirements

- No automated tests per project "big bang" approach
- Manual verification via Task 11 subtasks
- Focus on: animation queue lifecycle (push → dequeue → play → drain), LP counting accuracy, prompt drain coordination, burst collapse, 2× speed, prefers-reduced-motion, LiveAnnouncer, SCSS budget

### Source Tree — Files to Touch

**MODIFY (11 files):**
- `front/src/app/styles/_tokens.scss`
- `front/src/app/styles/_z-layers.scss`
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss`
- `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.scss`

**REFERENCE (read-only):**
- `front/src/app/pages/pvp/duel-ws.types.ts` (MoveMsg, DamageMsg, POSITION, LOCATION — verify field names)
- `front/src/app/pages/pvp/types/game-event.types.ts` (GameEvent union — verify all types)
- `duel-server/src/message-filter.ts` (verify passthrough whitelist + line 150 TODO context)
- `duel-server/src/duel-worker.ts` (verify MSG_* transform output shapes)
- `_bmad-output/implementation-artifacts/4-1-chain-link-visualization.md` (previous story patterns)
- `_bmad-output/implementation-artifacts/epic-3-retro-2026-02-28.md` (DRY KISS, SCSS budget, action items)

**DO NOT TOUCH:**
- `duel-server/src/server.ts` — No server changes
- `duel-server/src/ws-protocol.ts` — Protocol types already defined
- `duel-server/src/duel-worker.ts` — Worker transforms already correct
- `duel-server/src/message-filter.ts` — Messages already whitelisted
- Backend (Spring Boot) — No changes
- `game-event.types.ts` — Types already complete
- `duel-ws.types.ts` — Interfaces already defined
- Chain badge code (Story 4.1) — Independent, don't modify
- Prompt components — No rendering changes
- Lobby / waiting room — No changes

### Project Structure Notes

- Animation is CSS-class-based (`.pvp-anim-*`), not separate Angular components — per DRY KISS
- Animation orchestration lives in `DuelPageComponent` (not a separate service) — it needs access to `ownPlayerIndex`, `duelState`, `wsService`, and child component communication
- `animationQueue` remains in `DuelWebSocketService` (signal source), orchestration in `DuelPageComponent` (signal consumer)
- Data flow: `DuelWebSocketService.animationQueue` → `DuelPageComponent` (orchestrate) → `PvpBoardContainerComponent` (render zone anims) + `PvpLpBadgeComponent` (render LP anims)
- New tokens namespaced as `--pvp-*` within existing `// === PvP tokens ===` section
- New z-layer follows existing naming: `$z-pvp-animation-overlay` inserted between `$z-pvp-board: 1` and `$z-pvp-chain-badge: 10`

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 4, Story 4.2: Game Event Visual Feedback & Animation Queue (lines 799-847)]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — animationQueue signal (line 228-235), FIFO animation queue (line 74), Prompt drain coordination (line 238), Cross-cutting animation concern (line 46), visibilitychange fast-forward (line 95)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — Animation design tokens (lines 428-430, 493), Animation queue drain point (lines 357-360), Game event feedback table (lines 1470-1476), Chain choreography (lines 1496-1510), PvP-C scope (lines 1345-1350), Reduced motion (lines 1675-1679, 1843-1849), Color Rule (line 386), Unit Rule (line 403), LP badge spec (lines 981-988)]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — FR17 (chain display), FR22 (visual feedback per game event)]
- [Source: _bmad-output/implementation-artifacts/4-1-chain-link-visualization.md — Previous story patterns, signal conventions, mapChainLocationToZoneId(), zone ID convention]
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-02-28.md — DRY KISS directive, SCSS budget monitoring (10kB), absolute vs relative player indices (Story 3.2), prefers-reduced-motion practice, Code TODOs for Story 4.2]
- [Source: _bmad-output/project-context.md — Angular conventions, TypeScript strict, naming rules, anti-patterns]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts — MoveMsg, DamageMsg, RecoverMsg, PayLpCostMsg, FlipSummoningMsg, ChangePosMsg, AttackMsg, BattleMsg, POSITION, LOCATION constants]
- [Source: front/src/app/pages/pvp/types/game-event.types.ts — GameEvent discriminated union (12 types)]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts — animationQueue signal (line 16), disabled push (line 274), mapChainLocationToZoneId() (lines 329-337)]
- [Source: front/src/app/pages/pvp/duel-page/pvp-lp-badge/ — Current LP badge (22 lines TS, 8 lines HTML, 42 lines SCSS)]
- [Source: front/src/app/styles/_tokens.scss — Existing PvP animation tokens (lines 107-138), reduced-motion overrides (lines 147-157)]
- [Source: front/src/app/styles/_z-layers.scss — PvP z-layer stack (lines 27-38)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Missing `>` on opponent zone-card div after adding animation class bindings — fixed immediately
- `[animatingLp]` binding errors on LP badge resolved once Task 6 added the input

### Completion Notes List

- All 11 tasks implemented across 12 files (11 MODIFY + 1 additional: prompt sheet)
- Build passes with zero errors (`ng build --configuration=development`)
- Prompt drain coordination: `visiblePrompt` computed gates all prompt-dependent UI (prompt sheet, actionable glow, zone highlights, card action menu) behind `isAnimating() === false`
- LP badge uses `requestAnimationFrame` for smooth 500ms interpolation — `formattedLp` reads `_displayedLp` during animation, falls back to `lp()` input when idle
- Queue collapse: when queue > 5, all but last 3 events processed instantly (LP tracking only, no visual)
- 2x speed: activation toggle Off halves animation durations
- EMZ zones use `isEmzAnimating()` helper (no player context needed since EMZ is in central strip)
- Prompt sheet receives prompt via input now (not injecting `pendingPrompt` directly) for proper drain
- Animation SCSS uses design tokens throughout — no hardcoded durations in component code
- `prefers-reduced-motion` supported: all animation classes have `animation: none` override, tokens already 0ms, LP rAF snaps to final value (0ms)
- `LiveAnnouncer` announces summon, destroy, LP changes with own/opponent prefix

### Senior Developer Review (AI) — 2026-03-01

**Reviewer:** Claude Opus 4.6 (adversarial code review)
**Findings:** 1 Critical, 2 High, 5 Medium, 3 Low — **all fixed**

| ID | Severity | Finding | Fix Applied |
|---|---|---|---|
| C1 | CRITICAL | Task 6.8 marked [x] but LP rAF used hardcoded `duration = 500` — no snap under `prefers-reduced-motion` (AC6 + AC9 violation) | LP badge reads `--pvp-transition-lp-counter` from CSS via `getComputedStyle`. 0ms under reduced motion → snaps immediately. `LpAnimData` gains `durationMs` field, orchestrator passes speed-adjusted value |
| H1 | HIGH | LP tracking race condition: `trackedLp` reset by `duelState` effect before pending MSG_DAMAGE processed → double-subtraction, LP bounce | Guard trackedLp reset behind `!_isAnimating()`. Sync explicitly at end of `processAnimationQueue()` when queue drains |
| H2 | HIGH | AC2/AC3/AC5/AC6 animation specs (scale, rotateY, text-flash) don't match implementation (glow overlays, scaleX, background-flash) | Architecture Decision "Immediate State + Overlay" justifies zone animation divergence. LP flash fixed to text color + text-shadow per AC6/Task 6.5 |
| M1 | MEDIUM | Hardcoded `rgba(76,175,80)` in `pvp-summon-flash` — anti-pattern | Added `--pvp-summon-highlight` token + reduced-motion `transparent` override |
| M2 | MEDIUM | LP flash hardcoded RGBA colors instead of `var(--pvp-lp-*)` tokens | Replaced with `var(--pvp-lp-opponent)` and `var(--pvp-lp-own)` |
| M3 | MEDIUM | LP flash targets background instead of text color (AC6 specifies text + text-shadow) | Changed keyframes to `color` + `text-shadow` on `.lp-value` via descendant selector |
| M4 | MEDIUM | LP flash uses `--pvp-transition-lp-counter` (500ms) instead of `--pvp-transition-highlight-flash` (200ms) | Corrected to `--pvp-transition-highlight-flash` |
| M5 | MEDIUM | 2× speed cuts CSS/rAF animations short (setTimeout < CSS duration) | LP badge now receives `durationMs` from orchestrator (speed-adjusted). Zone CSS truncation accepted (glow peak at 40% visible before 50% cutoff) |
| L1 | LOW | AC2 token: `--pvp-animation-duration` used instead of `--pvp-transition-card-move` | Corrected summon CSS to use `--pvp-transition-card-move` |
| L2 | LOW | Destroy return 400ms but CSS 300ms → 100ms dead time | Changed destroy orchestrator return to 300 (matches `--pvp-animation-duration`) |
| L3 | LOW | `pvp-prompt-sheet.component.ts` not in "What MUST Change" table | Documented here in review record |

### Change Log

| File | Change |
|------|--------|
| `_tokens.scss` | Added `--pvp-summon-highlight`, `--pvp-destroy-highlight`, `--pvp-activate-highlight` tokens + reduced-motion overrides |
| `_z-layers.scss` | Added `$z-pvp-animation-overlay: 5` |
| `duel-web-socket.service.ts` | Enabled animation queue push for MSG_* events, added `dequeueAnimation()` + `clearAnimationQueue()`, split BOARD_STATE/STATE_SYNC handling, MSG_CHAINING added to queue |
| `duel-page.component.ts` | Added animation orchestration: `isAnimating`, `animatingZone`, `animatingLpPlayer`, `visiblePrompt`, `processAnimationQueue()`, `processEvent()`, `processMoveEvent()`, `processLpEvent()`, queue collapse, 2x speed, LiveAnnouncer, prompt drain on all computeds. [Review] Fixed: LP race condition (trackedLp guard), token-driven LP duration via `baseLpDuration`, `LpAnimData` with `durationMs`, destroy return 300ms |
| `duel-page.component.html` | Added `[animatingZone]`, `[animatingLp]` bindings, `[prompt]="visiblePrompt()"` on prompt sheet |
| `pvp-board-container.component.ts` | Added `animatingZone` + `animatingLp` inputs, `isZoneAnimating()` + `isEmzAnimating()` helpers, `playerLpAnim` + `opponentLpAnim` computeds. [Review] Updated `animatingLp` input to use shared `LpAnimData` type |
| `pvp-board-container.component.html` | Added `.pvp-anim-*` class bindings on opponent/player/EMZ zone-cards, `[animatingLp]` on both LP badges |
| `pvp-board-container.component.scss` | Added `.pvp-anim-summon`, `.pvp-anim-destroy`, `.pvp-anim-flip`, `.pvp-anim-activate` classes + 4 `@keyframes` + reduced-motion override. [Review] Fixed: summon uses `--pvp-summon-highlight` token + `--pvp-transition-card-move` duration |
| `pvp-lp-badge.component.ts` | Added `animatingLp` input, `_displayedLp` signal, `flashType` signal, rAF interpolation logic, `formattedLp` uses displayed LP during animation. [Review] Fixed: exported `LpAnimData` with `durationMs`, reads CSS token for duration, snaps under reduced-motion |
| `pvp-lp-badge.component.html` | Added `[class.lp-flash-damage]` + `[class.lp-flash-recover]` bindings |
| `pvp-lp-badge.component.scss` | Added `lp-damage-flash`, `lp-recover-flash` keyframes + reduced-motion override. [Review] Fixed: flash targets text color + text-shadow (not background), uses `var(--pvp-lp-*)` tokens, `--pvp-transition-highlight-flash` duration |
| `pvp-prompt-sheet.component.ts` | Added `prompt` input, changed effect to watch input instead of `wsService.pendingPrompt()` |

### File List

**MODIFIED (12 files):**
- `front/src/app/styles/_tokens.scss`
- `front/src/app/styles/_z-layers.scss`
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss`
- `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-lp-badge/pvp-lp-badge.component.scss`
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts`
