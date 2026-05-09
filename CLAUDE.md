# Project Instructions

## Code Quality

When writing or modifying code, always apply the `clean-code` and `code-principles` skills to enforce DRY, KISS, SRP, YAGNI, and Miller's Law thresholds.

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
   both replay precompute (`duel-worker.ts:runReplayPreComputation`) and
   live PvP (`duel-worker.ts:runDuelLoop`). `AnimationOrchestratorService.
   processEvent()` calls `rbs.updateLogical(event.boardStateAfter)` BEFORE
   dispatching the event so buffer replay progressively updates logical
   state per event instead of jumping to the chain's final state at commit.
   Field is optional: `filterMessage` sanitizes the snapshot per-player
   (opponent hand/deck hidden unless omniscient) to prevent info leak.
   PvP/Replay parity: same code path on both sides.

### Chain State Machine Rules

1. **`isResolving`** is set at MSG_CHAIN_SOLVING and cleared at
   MSG_CHAIN_SOLVED. All BOARD_CHANGING_EVENTS while this flag is true are
   buffered. The buffer is replayed after the chain overlay hides, using
   queue directives (group, barrier, lp, batch-end, await-signal).

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
5 extracted managers:

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

**`DuelContext`** is the shared context for all managers: `relativePlayer()`,
`scaledDuration()`, `announceEvent()`, `reducedMotion` signal, and
component-dependent closures (`ownPlayerIndex`, `speedMultiplier`,
`isBoardActive`). MUST be configured via `configure(config)` before first
read — `duelAssert()` fires if not. Config provides closures reading
the host component's signals.

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

**DI graph:** Engine ↔ BoardEffects (cycle, resolved via Angular
field-level `inject()`). Engine → FloatRegistry. BoardEffects → Engine
(uses `getZoneElement` / `getContainer` / `toAbsoluteUrl`).
FloatRegistry has zero cross-service deps. The Engine ↔ BoardEffects
cycle is intentional — `travel()` calls back into
`zoneImpactEffect` / `slamDustParticles` for soft / banish / slam
landings, while BoardEffects consumes the Engine's zone registry
rather than duplicating it.

`RenderedBoardStateService.attachFloatRegistry(svc)` wires the
LOCK-ASSERT observer (replaces former `attachCardTravelService` —
the assertion only ever needed `inFlightByZone()`).

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

## Buffer Replay Batch Construction

`AnimationOrchestratorService.replayBuffer()` drains
`chainManager._bufferedBoardEvents` and builds a `QueueEntry[]` batch
prepended to the main animation queue. The batch builder runs THREE
sequential passes on the buffer before queue emission:

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

1. **`!boardActive`** → `commitAll()` — hard reset (init, disconnect).
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
animation plays (via `_pendingLpCommits` Set in the queue loop), or via
`commitAll()` at hard-reset / `syncRendered()` at queue-empty.
`_pendingLpCommits` is a `Set<Player>` so batched LP events affecting
both players are committed correctly.

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

4. **Per-event `boardStateAfter` snapshot** — `runReplayPreComputation`
   tracks a `chainResolving` flag (set at MSG_CHAIN_SOLVING, cleared at
   MSG_CHAIN_SOLVED) and attaches `buildBoardState().data` as
   `boardStateAfter` on each filtered event whose type is in
   `LIVE_BOARD_CHANGING_EVENT_TYPES` during resolving. Payload growth
   is ~50-150 KB gzipped per duel (snapshots are highly redundant).
   Same shared Set is used by `runDuelLoop` (live PvP) so both modes
   attach snapshots identically. Z-index-style note: snapshots reflect
   ocgcore state at `buildBoardState()` call time (post-batch if
   multiple events fire in one `duelProcess` call) — strictly better
   than no snapshot, but not truly per-event within a single batch.

## Duel Assertion Pattern

Use `duelAssert(condition, site, msg)` (`duel-assert.ts`) for all
animation-critical invariants. It throws in dev mode and `console.error`s
in prod — never silent. Do NOT use raw `isDevMode()` checks for new
assertions; always go through `duelAssert()`.

## Animation Constants

All animation timing magic numbers live in `animation-constants.ts`:
`LOCK_SAFETY_TIMEOUT_MS`, `CHAIN_POLL_CEILING`, `CHAIN_POLL_BASE_DELAY_MS`,
`CHAIN_POLL_MAX_DELAY_MS`, `QUEUE_COLLAPSE_THRESHOLD`, `QUEUE_COLLAPSE_KEEP`,
`REPLAY_BUFFER_SAFETY_TIMEOUT_MS`. New timing values MUST be added there
instead of inlined as literals.

## Solver Interruption Tags Generation

`duel-server/data/interruption-tags.json` is the single source of truth for
which cards count as end-board interruptions and how they score. Adding new
cards (or revalidating existing entries) goes through an AI-assisted prompt
persisted at `_bmad-output/solver-data/interruption-tag-generation-prompt.md`.

To add cards: invoke Claude Code with the cardIds, ask it to read the prompt
file, fetch oracle text from `https://db.ygoprodeck.com/api/v7/cardinfo.php?id={cardId}`
via WebFetch, and produce schema-compliant JSON entries. The new entries are
inserted into `interruption-tags.json` with `_validated: false`. A human must
review and flip `_validated: true` for top-meta cards.

The schema accepts `sharedOpt`, `totalUsesPerTurn`, per-effect `trigger`, and
audit metadata (`_generatedBy`, `_oracleVersion`, `_validated`). Existing
entries without these fields still load — the loader is forward-compatible.

The `trigger` field is critical: the solver's OPT-aware scoring uses it to
disambiguate which effect of a multi-effect card was activated at a given
prompt context. Missing or wrong triggers fall back to index 0 with a runtime
warning.
