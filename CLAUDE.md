# Project Instructions

## Code Quality

When writing or modifying code, always apply the `clean-code` and `code-principles` skills to enforce DRY, KISS, SRP, YAGNI, and Miller's Law thresholds.

## Design System & Styling Conventions

The front-end has a custom Design System. Styling rules are enforced by
`stylelint` + a pre-commit hook (`scripts/hooks/`, activated via
`core.hooksPath`). Full reference: `front/LINTING.md`.

- **Colors** → always a token `var(--…)`. Literal hex is allowed only in
  token-defining files (`front/src/app/styles/**`, `_sim-tokens.scss`,
  `simulator-page.component.scss`).
- **`mat-icon` sizing** → `@include icon-size($size, $line-height?)` from
  `styles/mixin.scss`. Never re-write the `font-size/width/height
  !important` trio by hand — the `!important` (required by Material) is
  centralized in that mixin.
- **`::ng-deep`** → forbidden in components. Style non-encapsulated
  CDK/Material elements via `styles/_cdk-overrides.scss`; style a child
  component via a variant `input` (e.g. `embedded` on `pvp-timer-badge`).
- **Buttons** → native `<button class="btn …">` + `_buttons.scss`. Avoid
  `mat-*-button` (MDC layer forces `!important`). View toggles use
  `.seg-btn` (`styles/_segmented.scss`).
- **`!important`** → structural cases only (Material/CDK override,
  `prefers-reduced-motion`, state vs higher-specificity `:hover`, inline
  style). Any `!important` outside the mixin needs a `// !important: why`
  comment.
- **Radius** → single scale `--radius-{sm,md,lg,xl,pill}`.

## Animation Parity Rule

Any animation added to `AnimationOrchestratorService` MUST work through the
`AnimationDataSource` interface (animation-data-source.ts),
`RenderedBoardStateService` (board state management), and
`DuelEventProcessor` (chain/queue event processing). The orchestrator
MUST NOT import or reference `DuelWebSocketService` or `DuelConnection` directly.
This ensures replay mode automatically inherits all animation features.

When adding a new signal or method to the orchestrator that reads/writes
game state, add it to `AnimationDataSource` and implement it in both
`DuelWebSocketService` and `ReplayDuelAdapter`.

`AnimationDataSource` is injected via the `ANIMATION_DATA_SOURCE` token.
Implementations: `DuelWebSocketService` (PvP, delegates to `DuelConnection`)
and `ReplayDuelAdapter` (Replay). Shared utility: `syncAfterBoardState()` —
free function used by both for BOARD_STATE sync tier logic.
`DuelConnection` is a concrete WebSocket class, NOT an abstraction layer.

## Chain Event Processing & State Machine

`DuelEventProcessor` is the single source of truth for chain state management
(activeChainLinks, chainPhase, animation queue, chain entry commit). Both
`DuelConnection` and `ReplayDuelAdapter` delegate to their own
`DuelEventProcessor` instance. No manual PvP/replay parity is required — the
processor guarantees identical behavior across both modes.

`MSG_CHAIN_NEGATED` is consumed silently by the processor (sets `negated`
flag on the matching chain link) — it is NOT pushed to `animationQueue`.

## Replay Board State Parity Rule

Replay must provide equivalent intermediate board states so
`updateLogical()` + `syncRendered()` produce the same rendered state as PVP.
Replay MUST NOT call `commitAll()` (reserved for `abort()`/`jumpToState()`);
it uses `syncRendered()` to respect the lock contract.

`assertNoLocks()` surfaces lock leaks at transition boundaries and PvP
reset points via `duelAssert()`.

Key rules:

1. **`buildSteps` final segment** MUST receive `finalBoardState` (the
   transition's `next.boardState`) as `pendingState`. This matches the PVP
   server's post-event BOARD_STATE (including shuffle results). The adapter
   passes this to `updateLogical()` so the orchestrator sees the correct
   logical state.

2. **`advanceStep` during chain** (chainPhase !== 'idle'): `updateLogical()`
   is called per step. Empty steps (0 animation events) call `syncRendered()`
   only when `chainPhase() === 'idle'`. During chain resolution, the
   orchestrator controls commits via locks and the chain overlay contract —
   `advanceStep` must not force-sync.

3. **`processAnimationQueue` queue-empty path**: `finalizeAndCommit()`
   MUST run BEFORE `setAnimating(false)`. In replay, `setAnimating(false)`
   triggers `advanceStep()` which calls `updateLogical()` with a future
   state. Committing first uses the correct current state.

4. **`boardStateAfter` per-event snapshot** (BOARD_CHANGING events during
   `chainResolving` only — see ws-protocol.ts). Attached server-side in
   both replay precompute (`replay-precompute.ts:runReplayPreComputation`)
   and live PvP (`duel-worker.ts:runDuelLoop`) via the shared
   `ChainSnapshotTracker` class — same code path on both sides guarantees
   parity by construction. `AnimationOrchestratorService.processEvent()`
   calls `rbs.updateLogical(event.boardStateAfter)` BEFORE dispatching the
   event so buffer replay progressively updates logical state per event
   instead of jumping to the chain's final state at commit. Field is
   optional: `filterMessage` sanitizes the snapshot per-player (opponent
   hand/deck hidden unless omniscient) to prevent info leak.

### Chain State Machine Rules

1. **`ChainResolutionManager.isResolving`** is a **pure observer** of
   `DuelEventProcessor.chainPhase()` — wired at construction via
   `attachChainPhaseSource(() => dataSource.chainPhase())`. The manager
   does NOT own a parallel flag; the processor is the single source of
   truth. Phase transitions: `idle → building → resolving → idle`.
   `'resolving'` is set by `applyChainSolving(chainIndex)` (driven by the
   orchestrator after `chainManager.handleSolving`) and remains true
   across all links of the same chain — it only flips back to `'idle'`
   at `applyChainEnd()` (MSG_CHAIN_END). All BOARD_CHANGING_EVENTS while
   `isResolving` is true are buffered. The buffer is replayed after the
   chain overlay hides, using queue directives (group, barrier, lp,
   batch-end, await-signal). **Regression guard** — `handleSolving` MUST
   NOT re-acquire ownership of an `_insideChainResolution` flag; the
   spec test "handleSolving alone does NOT flip isResolving" catches it.

2. **`chainSolvedCount`** tracks how many links resolved in the current
   chain. ONLY reset at MSG_CHAIN_END. Drives the first-multi-link banner
   animation. Between consecutive chains in the same turn, resets via
   CHAIN_END.

3. **Queue collapse** — LP-only predicate. Triggers only when **every**
   queued entry is a LP-class event (`MSG_DAMAGE`, `MSG_PAY_LPCOST`,
   `MSG_RECOVER`) since `applyInstantAnimation()` only knows how to fold
   those. Visual events (MSG_MOVE, MSG_DRAW, MSG_CONFIRM_CARDS,
   MSG_FLIP_SUMMONING, etc.) MUST NOT be collapsed — dropping them would
   silently skip the animation while the zone still syncs via
   `commitUnlocked()`. Chain events + directives are naturally excluded
   (not LP-class).

4. **Replay stagger guard** — draw sequence resume and `confirmCardsInHand`
   check `hasActiveReplayTimeouts` before calling `processAnimationQueue()`.
   This prevents premature queue advancement while `replayBuffer()` is
   actively staggering events. Replay timeouts are bulk-cleared at chain
   reset.

5. **Chain poll** — when the queue empties during `deferred` commitMode
   (`chainPhase === 'resolving'`), the orchestrator only polls if
   `isWaitingForOverlay` is true (post-CHAIN_SOLVED, overlay replaying
   buffered events). Otherwise it finalizes — in replay, CHAIN_SOLVED may
   be in the next step, and polling would deadlock. Poll ceiling force-resets
   chain state as a safety net. During `building` phase, `commitMode` is
   `'per-event'` — queue-empty finalizes normally.

## Orchestrator Decomposition

`AnimationOrchestratorService` is a thin coordinator that delegates to
7 extracted managers:

- **`ChainResolutionManager`** — chain state (signals, buffer, replay
  timeouts, solved count). Pure state + `drainBuffer()`. Orchestrator
  owns `replayBuffer()` (cross-cutting dispatch via queue directives).
- **`DrawSequenceManager`** — draw sequences, hand expansion, shuffle
  processing, card confirmation.
- **`MoveAnimationRouter`** — MSG_MOVE routing via `MoveContext`, overlay
  detach, source + destination pre-locking. Field-destination branches
  lock dst synchronously (no imperative DOM hiding).
- **`LpAnimationTracker`** — LP tracking, counter animation, pending LP
  commit.
- **`BattleAnimationTracker`** — in-progress attack animations (attack
  line + clash impact), pending attack release.
- **`TargetIndicatorManager`** — `MSG_BECOME_TARGET` reticles for cards
  inside pile zones (GY, Banished, Extra Deck). Pile zones only render
  their top card, so a separate float layer is needed to point at
  sequence > 0 cards. Field-zone targets stay on the orchestrator's
  `targetedZoneKeys` signal.
- **`BufferReplayBuilder`** — owns the 3-pass batch construction for
  `replayBuffer` (see "Buffer Replay Batch Construction" section below).
  `build(buffer)` returns `{ batch, releaseSessionLocks }`. The
  orchestrator stays as dispatch policy: drain → call builder → prepend
  batch + `batch-end` + `await-signal` directives.

**`DuelContext`** is the shared context for all managers. API surface:

- **Component-bound closures** (set via `configure({ ownPlayerIndex,
  speedMultiplier, isBoardActive })`): `ownPlayerIndex()`, `speedMultiplier()`,
  `isBoardActive()`. MUST be configured before first read — `duelAssert()`
  fires if not.
- **Reactive signal**: `reducedMotion` (auto-tracks
  `prefers-reduced-motion` MQ).
- **Player helpers**: `relativePlayer(absolute) → 0|1`, `announceEvent(text,
  player)` (LiveAnnouncer with "Opponent: " prefix when not own).
- **Timing helpers**: `scaledDuration(base, min=0)` for animation budgets,
  `safetyTimeout(baseMs)` for guard timers (divides by speedMultiplier
  then adds 50% margin, so slow playback doesn't clip and loaded hardware
  has slack).
- **Card rotation helpers**: `cardBaseRotation(rel) → 180|undefined` for
  float orientation (cards face their owner), `cardBaseRotateCSS(rel) →
  string` for inline transform fragments, `zoneCardRotation(isDefense)
  → 0|-90` for Web Animation interpolation (atan2 reads CSS 270° as
  -90°, so we use -90° to force the 90° CCW shortest path).

**DI graph:** Chain ← Draw ↔ Move (Move injected lazily in Draw).
Move depends on Draw for `travelToHand()`. Draw depends on Move
(lazy `injector.get()`) for `processShuffleEvent` → `processMoveEvent`.
Draw depends on Chain for `hasActiveReplayTimeouts`. Chain has zero
cross-manager deps.

## Card Travel Stack

The card-travel subsystem is split into 3 services (M11 Phases 1+2):

- **`CardTravelEngine`** (`card-travel-engine.service.ts`) — animates card
  travel from a source zone/element to a destination zone/element. Owns:
  zone resolver registry (`registerZoneResolver` / `getZoneElement`),
  container element (`registerContainer` / `getContainer`), geometry +
  keyframe computation (via `card-travel-helpers`), animation kickoff,
  departure/impact glow timers, `createLineBetween`, `toAbsoluteUrl`.
- **`BoardEffectsService`** (`board-effects.service.ts`) — autonomous
  visual effects anchored to a zone/element: `zoneImpactEffect`,
  `slamDustParticles`, `preDestroyEffect`, `activateEffect`,
  `createTargetFloat` / `removeTargetFloat` / `fadeOutAndRemoveTargetFloat`.
- **`FloatRegistryService`** (`float-registry.service.ts`) — tracks the
  lifecycle of float elements created by `CardTravelEngine.travel()`.
  Owns the in-flight `Map` and the landed `Set` plus the LIFO/FIFO
  `popLandedFloat`, prefix queries, `stabilizeFloat`, `cancelTravel`,
  `clearAllTravels`, `inFlightByZone` (LOCK-ASSERT consumer).

**Single entry point** for adding a float to the registry:
`FloatRegistryService.register(el, animation, onLand?)` returns a
cancel-safe `Promise<void>` (resolves on both `animation.finished`
success AND on `animation.cancel()` rejection). The Engine never
touches `_inFlight`/`_landed` directly.

**`clearAllTravels` cancels (not finishes)** so the registered
`.finished.then()` callback does NOT asynchronously re-add the element
to `_landed` after the registry was cleared.

**DI graph:** Engine ↔ BoardEffects (intentional cycle, resolved via
Angular field-level `inject()` — `travel()` calls into
`zoneImpactEffect` / `slamDustParticles` for soft/banish/slam landings,
while BoardEffects reuses Engine's zone registry rather than duplicating
it). Engine → FloatRegistry. FloatRegistry has zero cross-service deps.

`RenderedBoardStateService.attachFloatRegistry(svc)` wires the
LOCK-ASSERT observer (the assertion only ever needed `inFlightByZone()`).

## Async Handler Lock Contract

Event handlers in `processEvent()` MUST call `lockZone()` on ALL zones they
animate (source AND destination) synchronously before the first `await`.
`commitUnlocked()` runs immediately after `processEvent()` returns — any
unlocked zone will be committed.

For field-destination moves (MZONE/SZONE), the destination lock keeps the
rendered state at "zone empty" until `dstLock.commit()` fires after the
travel float lands. No imperative DOM hiding is needed.

Pre-locking (`MoveAnimationRouter.preLockQueuedSources`) protects both
source AND destination zones of future queued MSG_MOVE events from
premature `commitUnlocked()` sync. `buildMoveContext()` consumes both
src and dst pre-locks via `consumePreLock()`. Each branch method either
reuses the dst pre-lock as its animation lock (`mc.preDstLock ??
this.rbs.lockZone(mc.dstKey)`) or releases it if the destination has its
own lock management (HAND via `travelToHand`, DECK never locked).

The orchestrator releases any remaining pre-locks after `processEvent()`
unconditionally (not gated on `result === 0`). For animated MSG_MOVE
branches this is a no-op (already consumed by `buildMoveContext`). For
MSG_DRAW it cleans up the HAND pre-lock that `launchInitialDraw` replaces
with its own `earlyLocks`.

**EXCEPTION — buffered events**: when `chainManager.isResolving` and the
event type is in `BOARD_CHANGING_EVENTS`, `processEvent` returns 0 after
`bufferIfResolving()` without running the branch. The orchestrator's
`releasePreLocksForKeys` is skipped in this case — the pre-locks stay
alive in the map and are consumed later when `replayBuffer()` replays
the buffered events via group directives. `MSG_CHAIN_END`'s
`releaseAllPreLocks()` is the safety net for unreplayed pre-locks.

Initial draws lock both HAND zones synchronously before the first `await`.
DECK is NOT locked (locking before first BOARD_STATE freezes `deckCount=0`
from `EMPTY_DUEL_STATE`, hiding the pile). Inner locks ref-count; outer
early locks commit in `finally`. Pre-locks run AFTER `syncAfterBoardState()`
— safe because `syncAfterBoardState` only calls `syncPileCounts()` when
the queue has events, never `syncRendered()`.

### Pre-activation Buffer (initial draw breathe beat)

Between `BOARD_STATE` landing (roomState transitions `connecting →
duel-loading`) and the dice arena dismissing (`duel-loading → active`),
`boardActive=false`. `AnimationOrchestratorService._handleEntry` parks
incoming `BOARD_CHANGING_EVENT_TYPES` events in
`_preActivationBuffer` instead of running them — the legacy
`!isBoardActive` guard in `draw-sequence-manager.processDrawEvent`
returned 0 silently, causing the initial 5-card draw to never animate
("cartes déjà en main" symptom, 2026-05-15).

`DuelLoadingEffectsService.duel-loading → active` effect orders:
1. `setBoardActive(true)` — gates downstream handlers.
2. `roomState.set('active')` — dismisses the dice arena.
3. `orchestrator.drainPreActivationBuffer()` — schedules
   `prependToQueue(buffer)` + `processAnimationQueue()` after a
   `ctx.scaledDuration(BOARD_BREATHE_MS, BOARD_BREATHE_MIN_MS)` beat
   (500ms base, floors at 200ms under slow-playback).

Step 1 MUST precede step 3 — the drain re-enters `_handleEntry`, which
re-checks `isBoardActive()`; if it ran before the flip, events would be
re-parked instantly.

`clearTimersAndPolling` clears the buffer + the `_preActivationDrainScheduled`
flag so a hard reset (rematch, switch, destroy) does not carry stale
draws into the next duel. The `processDrawEvent` legacy guard is
retained as defense-in-depth with a `logger.warn` — reaching it now
indicates a bypass of the buffer, not the expected silent-skip.

### Pre-lock Handle Ownership

1. **`travelToHand(src, relPlayer, cardImage, options, targetIndex?,
   externalHandLock?, cardCode?)`** — HAND-destination branches
   (`bounceToHand`, `pileToHand`, `fallback→HAND`) MUST pass
   `mc.preDstLock` as `externalHandLock` instead of releasing it.
   `travelToHand` reuses the pre-lock as its `handLock`, avoiding a
   release+relock race that would drop HAND ref-count to 0 and flash
   `commitZone(HAND)` between the two. The `cardCode` tag is stored on
   the float's dataset so `confirmCardsInHand` / `processShuffleEvent`
   can match floats to reveals even when multiple tutor events carry
   identical cardCodes (LIFO match: see `popLandedFloat(prefix, cardCode)`).

2. **`commitAndClearFloat(dstLock, dstKey)`** (non-HAND branches) —
   MUST be the tail call in each branch. Commits the dstLock and THEN
   clears landed floats at `dstKey` **only if the zone is actually
   unlocked** (`!lockedZoneKeys().includes(dstKey)`). For multi-event
   groups sharing a destination (Link materials → GY, mass destroy,
   multi-tribute), intermediate commits only decrement the ref-count;
   keeping the floats visible during the travel window gives the user
   a progressive overlay instead of each ghost vanishing mid-travel.
   Only the final commit (ref=0 → `commitZone`) clears the accumulated
   floats in one sweep.

### Hand Batch Slot Reservation (`replayBuffer` only)

When a buffer replay contains MSG_MOVE events with `toLocation === HAND`,
`AnimationOrchestratorService.replayBuffer` calls
`DrawSequenceManager.beginHandBatch(relPlayer, count)` before building
the queue directives. This reserves `count` distinct expansion slots
upfront (via `handExpansionSlots` signal). Each MOVE→HAND branch calls
`consumeHandBatchSlot(relPlayer)` to get a monotonic slot index and
passes it as `travelToHand`'s `targetIndex` — so tutor1 lands at slot
0, tutor2 at slot 1, each keeping the fan's per-index rotation. Released
at `batch-end` directive via `endHandBatch(relPlayer)`. Session HAND
locks (`sessionHandLocks`) are acquired in parallel for any player
with a MOVE **touching** HAND (src OR dst) so rendered HAND stays at
its pre-chain state across the whole batch replay; the per-event
`rbs.updateLogical(boardStateAfter)` hook progresses logical state
without triggering commitZone until batch-end.

## Buffer Replay Batch Construction (`BufferReplayBuilder`)

`BufferReplayBuilder.build(buffer)` (`buffer-replay-builder.ts`) is the
batch builder. `AnimationOrchestratorService.replayBuffer()` drains
`chainManager._bufferedBoardEvents` via `chainManager.drainBuffer()`,
calls `bufferReplayBuilder.build()`, and prepends the resulting
`{ batch, releaseSessionLocks }` plus `batch-end` + `await-signal`
directives to the main animation queue. The orchestrator is dispatch
policy only — all batch transformation logic lives in the builder.

The builder runs THREE sequential passes on the buffer before queue
emission:

1. **`interleaveConfirmsWithMoves(buffer)`** — splits aggregated
   `MSG_CONFIRM_CARDS` into per-card single-card CONFIRMs inlined
   immediately after each matching MOVE→HAND (match by `cardCode` +
   `player` + `card.location === HAND`). Unmatched cards (e.g., GY
   reveal, face-down) stay in a reduced CONFIRM at the original
   position. Produces the `tutor → reveal → tutor → reveal` flow.
   Uses a WeakSet to track consumed moves by reference, so splice
   index shifts across multiple CONFIRMs don't invalidate matching.

2. **Session HAND lock + `beginHandBatch`** — for every affected
   `relPlayer` (derived from MOVE-touching-HAND events in the
   interleaved buffer), acquire a `lockZone('HAND-N')` held for the
   whole batch + reserve expansion slots. Keeps rendered HAND at the
   pre-chain state throughout, and gives each tutor a distinct
   fan-positioned slot. Released in the `batch-end` resolve callback.

3. **Group category boundary flush** — the batch-building loop flushes
   the pending group when the next zone event's category differs from
   the last. Category = `'overlay'` (MSG_MOVE with `fromLocation ===
   OVERLAY`) vs `'other'`. Splits XYZ destroy patterns
   `[detach1, detach2, destroy_monster]` into two groups with a barrier
   between them, so overlay materials finish their slide-out + travel
   before the monster's `preDestroyEffect` captures a srcEl that still
   holds them.

Final shape:
`[group(..), barrier]+ | confirm | lp | ... , batch-end, await-signal`

The `await-signal` pauses the main queue until the chain overlay
component sets `chainOverlayReady=true` — coordinates chain resolve
pulse → effect animations → next link resolve.

## syncAfterBoardState Sync Tiers

`syncAfterBoardState` (animation-data-source.ts) decides how to sync
rendered state when a `BOARD_STATE` arrives:

1. **`!boardActive`** → `syncPileCounts()` — bootstrap path. The very
   first BOARD_STATE arrives AFTER `MSG_DRAW × 5` (the server runs
   `start_duel` before the first prompt), so its zone arrays already
   contain the starting hand. A full `commitAll()` here would copy those
   cards into the rendered state, then the buffered MSG_DRAWs would
   animate ON TOP of cards already visible (regression observed
   2026-05-15). `syncPileCounts()` keeps DECK/EXTRA visible so the
   "cards travel from deck to hand" animation has a source; the buffered
   MSG_DRAWs commit HAND through their normal lockZone/commit cycle when
   `drainPreActivationBuffer()` fires.
2. **`chainPhase === 'idle' && queueLength === 0`** → `syncRendered()` —
   full sync, safe because no animations are queued.
3. **`chainPhase !== 'resolving'`** (idle/building with queue) →
   `syncPileCounts()` — only DECK/EXTRA counts + global metadata (turn,
   phase). Zones are NOT synced because pre-locks may not be in place yet.
4. **`resolving`** → defer entirely — orchestrator controls commits via
   chain overlay contract.

`syncPileCounts()` preserves LP from rendered (same discipline as
`mergeUnlockedZones`) and does not touch zone arrays.

## Rendered Board State Constraint

Components MUST NOT derive conditional behavior from combining
`renderedState().turnCount` or `renderedState().phase` with zone content
during animations. Global properties (turnCount, phase) may be ahead of
locked zones by one transition. For synchronized metadata + zones, read
`logicalState()`.

## LP Commit Discipline

LP is excluded from auto-sync in `mergeUnlockedZones()` and
`syncPileCounts()` — both always copy LP from the rendered state. LP is
committed explicitly via `commitLp(playerIndex)` after the counting
animation plays, or via `commitAll()` at hard-reset / `syncRendered()`
at queue-empty.

The pending-commit batching lives in **`LpAnimationTracker`**
(`lp-animation-tracker.ts:_pendingLpCommits: Set<Player>`), NOT in the
orchestrator. The orchestrator's queue loop drains the set via
`lpTracker.commitIfPending()` after the LP counter animation duration
elapses; `discardPending()` is the escape hatch when an upcoming
`commitUnlocked()`/`commitAll()` will sync via a different path. Set
semantics let batched LP events affecting both players (e.g. mass damage
during chain resolution) commit correctly without dedup or ordering bugs.

## Pre-computation Timeline Rules

1. **Turn 0 ("Setup")** contains all events before the first `MSG_NEW_TURN`.
   When `MSG_NEW_TURN` arrives, accumulated events are flushed as Turn 0,
   then `currentTurn` increments. Transition boundary prompts
   (`SELECT_IDLECMD`, `SELECT_BATTLECMD`) trigger automatic state flushes;
   other SELECT_* prompts are accumulated within the same turn state.

2. **MSG_CHAIN_END** is flushed as its own state WITHOUT `chainIndex` — it
   acts as a separator between consecutive chains in the timeline. The
   front-end hides it via `HIDDEN_LABELS` in `subEventSegments`.

3. **`generateLabel`** returns `''` for batches with only non-visual events
   (SELECT_*, WAITING_RESPONSE, MSG_CHAIN_END, MSG_CHAIN_SOLVING, etc.).
   `flushState` skips these empty states to avoid phantom bullets.

4. **Per-event `boardStateAfter` snapshot** — both `runReplayPreComputation`
   (in `replay-precompute.ts`) and `runDuelLoop` (in `duel-worker.ts`)
   delegate to a `ChainSnapshotTracker` instance (one per duel) which
   tracks a `chainResolving` flag (set at MSG_CHAIN_SOLVING, cleared at
   MSG_CHAIN_SOLVED) and attaches `buildBoardState().data` as
   `boardStateAfter` on each filtered event whose type is in
   `BOARD_CHANGING_EVENT_TYPES` during resolving. Payload growth is
   ~50-150 KB gzipped per duel (snapshots are highly redundant). Both
   modes use the same shared class so the attach predicate, the field
   name, and the timing are identical by construction. Z-index-style
   note: snapshots reflect ocgcore state at `buildBoardState()` call
   time (post-batch if multiple events fire in one `duelProcess` call)
   — strictly better than no snapshot, but not truly per-event within
   a single batch.

## Duel Assertion Pattern

Use `duelAssert(condition, site, msg)` (`duel-assert.ts`) for all
animation-critical invariants. It throws in dev mode and `console.error`s
in prod — never silent. Do NOT use raw `isDevMode()` checks for new
assertions; always go through `duelAssert()`.

## Animation Constants

All animation timing magic numbers live in `animation-constants.ts`. New
timing values MUST be added there instead of inlined as literals. Naming
convention:

- **`*_MS`** — base duration (in ms) consumed by handlers via
  `ctx.scaledDuration(BASE_MS)` so playback-speed scaling applies.
- **`*_MIN_MS`** — companion floor passed to `scaledDuration(BASE, MIN)`
  for any constant whose handler uses the 2-arg form. The floor protects
  against slow-playback collapsing the animation to 0ms. Pair convention:
  every `FOO_MS` consumed with a min has a matching `FOO_MIN_MS`.
- **Safety timers** (`LOCK_SAFETY_TIMEOUT_MS`, `REPLAY_BUFFER_SAFETY_TIMEOUT_MS`,
  `POLL_DROP_REGRESSION_WATCHDOG_MS`, etc.) — wrapped in
  `ctx.safetyTimeout(BASE)` instead of `scaledDuration` so slow playback
  stretches the guard rather than tightens it.

When adding a constant: pick a `*_MS` name describing what it times,
add a `*_MIN_MS` floor if the handler will pass a min, and document the
single line "what does this gate" — most existing entries are 1-3 lines.

## Debugging Animations (`DuelLogger` + `DuelDebugService` + harness)

The animation pipeline has three layers of instrumentation. Use them in
order — they're additive, not redundant.

### Layer 1 — `DuelLogger` categories

`DuelLogger` is the gated console logger. Eight categories, each filterable
via `localStorage['duel-log-categories']` (CSV) or the DevHub toggle. Default
set keeps the console readable; the two **verbose** categories are off by
default and must be opted in.

- `QUEUE` / `MOVE` / `DRAW` / `CHAIN` / `SHUFFLE` / `LP` / `PROC` / `REPLAY`
  — the existing animation pipeline categories. Loud but bounded; on by
  default.
- `RESOLVE` (verbose) — every conversion from a string identifier to a
  runtime object: `getZoneElement(zoneKey) → HTMLElement | null`,
  `popLandedFloat(prefix, cardCode) → HTMLElement | null`,
  `findCardOnField → CardOnField | null`. Off by default. **A failing
  resolve auto-promotes to `logger.warn`** so silent skips surface even
  when the category is filtered out.
- `PIPELINE` (verbose) — message ingestion across the WS / Replay adapter /
  `DuelEventProcessor` boundary. One line per WS message received
  (`ws.recv type=…`), per `processMessage` entry/exit with queue-length
  delta, per `advanceStep` step kind. Off by default. Use when diagnosing
  "did the event arrive at all".

`logger.resolve(method, input, result, note?)` is the canonical helper for
the `RESOLVE` category — it formats consistently and handles the null →
warn promotion automatically. Don't roll your own `console.log` for zone
lookups; use `logger.resolve`.

### Layer 2 — `window.__skytrixDebug`

`DuelDebugService` is provided at the duel-page + replay-page component
level and exposes itself on `window.__skytrixDebug` in dev mode only
(`isDevMode() === true`). No-op + tree-shaken in production.

The console surface:

- `__skytrixDebug.snapshot()` — JSON-serialisable state dump
  (logicalState, renderedState, animationQueue, chain.phase + activeLinks,
  locks, inFlightFloats, landedFloats, preActivationBuffer). The
  `domZones` field is a getter — invoking it forces ~50
  `getBoundingClientRect` reads, so don't call it on every animation tick.
- `__skytrixDebug.dump()` — same as snapshot, but also pretty-prints a
  grouped console block. Cheap.
- `__skytrixDebug.enableAll()` — turn on every log category, including
  RESOLVE + PIPELINE. Persists to localStorage.
- `__skytrixDebug.setLogCategories([...])` — fine-grained set.
- `__skytrixDebug.help()` — lists the above in the console.

The snapshot is the right tool when "the animation looks stalled, what's
the state right now?". From DevTools console, paste:
```
copy(JSON.stringify(__skytrixDebug.snapshot(), null, 2))
```
and the JSON dump goes to your clipboard for bug-report inclusion.

### Layer 3 — Playwright debug harness

`front/e2e/debug-replay-harness.ts` (`runReplayDebug({ replayId,
perspective, screenshotOn, buildFirst, fromEvent, timeoutSec })`) is the
batch-mode equivalent: scripted replay playback, console capture,
screenshots, JSON snapshots, and a Markdown report.

Output goes to `_bmad-output/debug-replay/<tag>/`:

- `report.md` — timeline of captures, warnings, errors, last 100 PIPELINE
  lines. Read this first.
- `console.log` — raw filtered log with timestamps.
- `frames/<idx>-<label>.png` — screenshots at each trigger.
- `snapshots/<idx>-<label>.json` — `__skytrixDebug.snapshot()` dump
  paired with each screenshot.

Two modes:

1. **`buildFirst: false`** (fast, fragile) — points at the user's running
   `ng serve`. Iterative dev mode. HMR can truncate captures if you edit
   code mid-run.
2. **`buildFirst: true`** (slow, reproducible) — runs `ng build
   --configuration=development`, serves the static output on a free port,
   captures against that. ~30s overhead for the build, then HMR-immune.
   Use for archival captures + regression snapshots.

Run via:
```
npm run debug:replay              # default example spec
npx playwright test e2e/<spec>    # specific spec
```

Copy `debug-replay-example.spec.ts` as the template for a new bug
investigation — set the `replayId`, `perspective`, and `screenshotOn`
trigger substrings. The trigger pattern that worked for the 2026-05-18
EMZ resolver bug was `screenshotOn: ['travel skipped']` — every `travel
skipped` warn captures a frame + snapshot at the bug moment.

### What NOT to instrument

- Bind expensive payloads (board-state dumps, large arrays) behind
  `logger.isEnabled(cat)` checks so the cost is paid only when the
  category is on.
- Don't use `duelAssert()` for new resolve-style failures — the
  warn-on-null path in `logger.resolve()` is already the right
  signal-without-throw mechanism.
- Don't add console.log directly — go through DuelLogger so the output
  is categorised + the prefix + traceId are consistent.

## Polling Removal — Regression Surface

The legacy chain-poll back-off (`_pollTimeout` + 50→500ms exponential +
ceiling=30) was removed 2026-05-10 after investigation found it
unreachable since commit 89b761c4 — three event-driven re-wakes
(`startProcessingIfIdle` on WS message, `advanceStep` on
`setAnimating(false)`, `initResumeEffect` on `chainOverlayReady`) cover
the "chain resolving, queue temporarily empty" gap. The
`armPollDropWatchdog()` (fired in the `'finalize'` case when
`chainPhase === 'resolving'`, cleared in `startProcessingIfIdle` +
`clearTimersAndPolling`) is the safety net: after
`POLL_DROP_REGRESSION_WATCHDOG_MS` (10s) it logs
`[POLL-DROP REGRESSION]` (unfilterable, not through `DuelLogger`) and
fires `duelAssert(false, 'POLL-DROP-REGRESSION', ...)`.

**If you see the marker, investigate in this order before anything
else:**
1. Did MSG_CHAIN_END arrive? Check WS logs for the duel ID.
2. Did `chainPhase` transition to `'idle'`? Grep `applyChainEnd` traces.
3. Was `initResumeEffect` fired on `chainOverlayReady`? Check
   `[ANIM:CHAIN] resumeEffect` logs.
4. Did `startProcessingIfIdle` get called after the stall? Check
   `[ANIM:QUEUE] startProcessingIfIdle` traces.

If none of (1-4) hold, the dropped poll mechanism was masking a real
upstream bug — find the missing event/signal first, do NOT re-introduce
the poll. Last-resort restore: a single
`setTimeout(processAnimationQueue, 500)` in the finalize case (no
back-off, no ceiling — the watchdog is the ceiling).

**Grep markers (do not change without updating this section):**
`POLL-DROP REGRESSION` (the console.error string) and
`POLL-DROP-REGRESSION` (the duelAssert site tag).

## Server Module Configuration (`createConfigurable<T>`)

Server-side modules extracted from `server.ts` follow a two-phase init
contract via `createConfigurable<T>(name)`
(`duel-server/src/configurable.ts`). The factory returns
`{ configure(cfg), get(), isConfigured() }`. `get()` throws
`"<name>: configure<Name>() not called"` if the module is read before
configuration. `isConfigured()` participates in the **boot invariant**
in `server.ts` (block just before `wss.on('connection')`), which throws
with the list of unconfigured modules. New configurable modules MUST
register their `isXxxConfigured()` in the boot block — that block is
the regression fence for the whole pattern.

**Current extracts** (10 modules, each owns its slice of `server.ts`):

- **`http-routes`** — `/health`, `/status`, `/api/update-data`,
  `/api/validate-passcodes`.
- **`replay-handlers`** — replay WS connections + fork-solo
  bridge-in (delegates session creation to `fork-handlers`).
- **`timer-management`** — turn/inactivity/grace timers + clock-skew
  clamp.
- **`solver-handlers`** — solver WS attach/detach + deck cache +
  per-userId SOLVER_START mutex.
- **`rps-coordinator`** — pre-duel RPS + turn-player selection state
  machine; spawns the OCGCore worker via injected `startDuelWithOrder`.
- **`worker-lifecycle`** — per-session worker spawn handle, listener
  attach, idempotent terminate, natural-end bookkeeping
  (`endedAt`, `totalDuelsServed`, rematch timer arm). Owns the
  `workerTerminated` flag.
- **`worker-message-router`** — dispatches worker→main messages
  (`WORKER_*`) + `broadcastMessage` outbound (chain-state update,
  CONFIRM_CARDS chainIndex tag, BOARD_STATE cache, per-player
  `filterMessage`).
- **`client-message-router`** — dispatches client→server messages
  (`PLAYER_RESPONSE`, `SURRENDER`, `REMATCH_REQUEST`,
  `REQUEST_STATE_SYNC`, `ACTIVITY_PING`, `ANIMATIONS_DONE`,
  `CANCEL_PROMPT_SEQUENCE`), invalid-response strike count,
  cancelTargetPrompt snapshot.
- **`fork-handlers`** — fork-solo `ActiveDuelSession` construction +
  fork-specific worker handlers (omniscient filtering, no
  chain/turn/inactivity tracking, MSG_WIN logged as `mode:
  'fork_solo'`).
- **`replay-persist`** — POST replay payload to Spring Boot with
  `3^(attempt-1)s` back-off; consumes `pendingReplayResult` override
  for TIMEOUT/SURRENDER/RESIGN cases.

`server.ts` retains: WS server, session map drives (via
`DuelSessionManager`), `cleanupDuelSession`, `safeSend`,
`sendToPlayer`, `broadcastMessage` plumbing closures, the new-PvP
duel POST handler. Everything that was a long inline closure now lives
in one of the modules above.

## WS Protocol Module Split (barrel)

`ws-protocol.ts` (both `front/src/app/pages/pvp/duel-ws.types.ts` and
`duel-server/src/ws-protocol.ts`) is a **barrel** that re-exports 6
sub-files. Adding a new message type goes in the matching sub-file, NOT
the barrel:

- **`ws-protocol-shared.ts`** — `Player`, `Phase`, `LOCATION`, `POSITION`,
  `BoardStatePayload`, `BOARD_CHANGING_EVENT_TYPES`, etc. — types and
  enums consumed across all categories.
- **`ws-protocol-game.ts`** — game events (MSG_*: MOVE, DRAW, DAMAGE,
  CHAINING, etc.). All BOARD_CHANGING events live here.
- **`ws-protocol-prompts.ts`** — SELECT_*, ANNOUNCE_*, SORT_*,
  `PlayerResponseMsg`. Anything that pauses the duel for player input.
- **`ws-protocol-system.ts`** — duel lifecycle (DUEL_END, RPS, REMATCH,
  STATE_SYNC, CHAIN_STATE, timer, surrender, cancel). Non-game-event
  protocol messages.
- **`ws-protocol-replay.ts`** — replay-specific (REPLAY_BOARD_STATES,
  REPLAY_METADATA, fork lifecycle).
- **`ws-protocol-solver.ts`** — solver-specific (SOLVER_INIT, START,
  PROGRESS, RESULT, etc.).

The 6 sub-files are byte-synced front↔back via
`scripts/check-ws-protocol-sync.mjs` (modulo `.js` import suffix in
duel-server). The barrels are NOT byte-synced (paths differ) but mirror
each other in structure. **A check-ws-protocol-sync run is part of
duel-server's prebuild step.**

## Server Chain Helpers (`ChainSnapshotTracker` + `ChainStateTracker`)

Two small classes encapsulate chain-related server logic that used to
live inline in `duel-worker.ts` / `server.ts`. Future bugs touching chain
state on the server side belong in these files, not in their former hosts.

- **`ChainSnapshotTracker`** (`duel-server/src/chain-snapshot-tracker.ts`)
  — owns the `chainResolving` flag (set at MSG_CHAIN_SOLVING, cleared at
  MSG_CHAIN_SOLVED) and attaches `boardStateAfter` snapshots to outgoing
  BOARD_CHANGING events while resolving. Single instance per duel run.
  Used by both `runDuelLoop` (live PvP, `duel-worker.ts`) and
  `runReplayPreComputation` (replay precompute, `replay-precompute.ts`)
  via `tracker.process(dto, captureSnapshot)` — the same predicate, the
  same field, the same code path on both sides → PvP↔Replay parity by
  construction.

- **`ChainStateTracker`** (`duel-server/src/chain-state-tracker.ts` —
  `ChainStateContainer` interface, `emptyChainState()`, and the
  `applyChainTransition(state, message)` dispatcher) — server-side chain
  snapshot persisted per session for reconnect handshake. Stores
  `activeChainLinks`, `chainPhase`, `negatedChainIndices`,
  `currentSolvingChainIndex`. Mirror of the client-side
  `DuelEventProcessor` but minimal (server only needs what CHAIN_STATE
  replays on reconnect). The transition logic is pure — testable
  without booting the WS server (covered by `chain-state-tracker.spec.ts`).

## Solver Connection Lifecycle (`solver-handlers.ts`)

`solver-handlers.ts` owns four private Maps (`solverConnections`,
`solverJwts`, `solverLastStart`, `solverDeckCache`) — none are exported.
`server.ts` drives state via two functions:

- **`attachSolverConnection(userId, ws, jwt)`** — atomic limit-check +
  replace + set. Returns `{ kind: 'limit' }` (server.ts must close ws
  with 4029) or `{ kind: 'attached'; replaced: WS | null }` (server.ts
  closes the replaced socket with 4001 if present). Atomic so two
  concurrent attaches can't both pass `maxSolverConnections`.
- **`detachSolverConnection(userId, ws)`** — idempotent cleanup. Guards
  against the replace race (`if (solverConnections.get(userId) !== ws)
  return`) so a `close` handler that fires after a replace doesn't kick
  out the new WS. Drops connection + JWT + the user's deck-cache prefix
  entries in one call.

WS IO (the actual `ws.close(...)` calls) stays in server.ts — solver-handlers
mutates state, server.ts owns the socket lifecycle. `maxSolverConnections`
lives in `SolverHandlerConfig` (getter for hot-reload via `/api/update-data`).
A future handler that adds solver state and forgets to clean up via detach
can no longer leak silently — the Maps simply aren't reachable from outside.

## Session Management (`DuelSessionManager`)

`DuelSessionManager` (`duel-server/src/duel-session-manager.ts`) owns
the three session-state Maps (`activeDuels`, `pendingTokens`,
`reconnectTokens`). Token consumption uses **atomic read+delete** with
a tagged return discriminator: `'unknown'` (token never issued),
`'session-gone'` (orphan token; auto-pruned), `'ok'` (resolved).
Callers MUST switch on `kind` rather than null-check — the three
branches drive distinct close-codes and log lines. `terminate()` is
idempotent and called LAST in `cleanupDuelSession()`; WS close, timer
clears, and worker termination happen before it.

## Protocol Version Mismatch (Close-code 4426)

WS handshakes that fail protocol-version validation close with **code
4426** (analog to HTTP 426 "Upgrade Required"). Server side:
`protocol-version-check.ts` runs on every WS connect (PvP, replay,
solver) before any session bookkeeping; mismatches increment a
`protocolMismatchCount` counter exposed via `/status`. Client side:
every connection service (`duel-connection.ts`,
`replay-connection.service.ts`, `solver.service.ts`) MUST inspect
`event.code === 4426` in its `onclose` handler and surface a "client
outdated, refresh" UX rather than a generic "connection lost". Losing
this branch reads as a transient network error to the user and
triggers an infinite reconnect loop on stale bundles.

## Solver Interruption Tags

`duel-server/data/interruption-tags.json` is the single source of truth
for end-board interruption scoring. Adding/revalidating cards is a
procedure (AI-assisted prompt + ygoprodeck oracle fetch + human
validation flip) — see
`_bmad-output/solver-data/interruption-tags-howto.md`.
