# Moteur de duel — orchestrateur

**Lecture** : l'intérieur d'`AnimationOrchestratorService` : trajets de cartes, verrou des handlers, rejeu du tampon,
PV, timeline, constantes ; texte de l'ancien `CLAUDE.md`, déplacé tel quel (en anglais) le jour de l'adoption du plugin
`workbench`. Index du moteur de duel : [`README.md`](README.md). Se lit par sections : `Grep "^## "`, puis `Read` par
plage.

## Sommaire

1. Orchestrator Decomposition
2. Card Travel Stack
3. Async Handler Lock Contract
4. Buffer Replay Batch Construction (`BufferReplayBuilder`)
5. syncAfterBoardState Sync Tiers
6. Rendered Board State Constraint
7. LP Commit Discipline
8. Pre-computation Timeline Rules
9. Duel Assertion Pattern
10. Animation Constants

## Orchestrator Decomposition

`AnimationOrchestratorService` is a thin coordinator that delegates to
8 extracted managers/classes. The processor (chain state machine +
animation queue) lives on the `DuelConnection` / `MockDuelConnection`
that owns the WS / precompute feed, NOT on the orchestrator — see the
"Chain Event Processing & State Machine" section of [chain.md](chain.md) for ownership
rules post-c8.

- **`ChainResolutionManager`** — chain state (signals, buffer, solved
  count). Pure state + `drainBuffer()`. Orchestrator
  owns `replayBuffer()` (cross-cutting dispatch via queue directives).
  α.4b: `ResetTarget` with declared scope **`PERSPECTIVE_LIFETIME`**
  (historical — the PERSPECTIVE-scoped replay-stagger timers were
  removed as dead code, audit 2026-06-11 #20); `applyReset` runs the
  full chain state reset on `scopes.has('CONNECTION_LIFETIME')` and is
  a no-op for a PERSPECTIVE-only reset (chain state intentionally
  survives a switch).
- **`DrawSequenceManager`** — draw sequences, hand expansion, shuffle
  processing, card confirmation.
- **`MoveAnimationRouter`** — MSG_MOVE routing via `MoveContext`, overlay
  detach, source + destination pre-locking. Field-destination branches
  lock dst synchronously (no imperative DOM hiding).
- **`LpAnimationTracker`** — LP tracking, counter animation, pending LP
  commit. α.4b: `ResetTarget` with declared scope **`DUEL_LIFETIME`**
  (the most durable slice — `trackedLp` + `_pendingLpCommits`);
  `applyReset` branches on `scopes.has('PERSPECTIVE_LIFETIME')` to
  clear `animatingLpPlayer` separately. A `PerspectiveSwitched` (which
  carries only PERSPECTIVE_LIFETIME) does NOT reach this manager — the
  declared scope is DUEL, deeper than PERSPECTIVE in the hierarchy, so
  the dispatcher's filter skips it. This is the **mirror** of
  ChainResolutionManager.
- **`BattleAnimationTracker`** — in-progress attack animations (attack
  line + clash impact), pending attack release. α.4b: `ResetTarget`
  with scope **`PERSPECTIVE_LIFETIME`** — all carried state cleared
  on every switch.
- **`TargetIndicatorManager`** — `MSG_BECOME_TARGET` reticles for cards
  inside pile zones (GY, Banished, Extra Deck). Pile zones only render
  their top card, so a separate float layer is needed to point at
  sequence > 0 cards. Field-zone targets live on the orchestrator's
  `targetedZoneKeys` projection (Lot 4.1-REDO,
  `BaseProjection<ReadonlySet<string>>`).
- **`BufferReplayBuilder`** — owns the 3-pass batch construction for
  `replayBuffer` (see "Buffer Replay Batch Construction" section below).
  `build(buffer)` returns `{ batch, releaseSessionLocks }`. The
  orchestrator stays as dispatch policy: drain → call builder → prepend
  batch + `batch-end` + `await-signal` directives.
- **`QueueRunner`** (Paliers A + B + C, 2026-05-23; α.3 wrapper, 2026-05-25)
  — async animation loop, decision step (`decideNextStep` pure), and the
  lifecycle primitives (`_isRunning`, `_isProcessing`, `_innerLoopDepth`,
  `_abort: AbortController` (palier C, replaced the maison
  `_resetGeneration` token), `_rescueNoProgressCount`,
  `_lastRescueQueueLen`). **All 5 primitives are `PERSPECTIVE_LIFETIME`
  transport state** in the §3.2 sense — annotated in-file at their
  declaration; cleared/installed-fresh by every `requestStop()`. Owns
  the per-step `setTimeout` + travel `Promise.race` guard. Business
  dispatch (per-type handlers, directive switch, pre-activation buffer)
  stays in the orchestrator and is reached via `QueueRunnerDeps`
  callbacks; the runner never imports YGO types. Plain class,
  instantiated in the orchestrator constructor. `_isAnimating`
  (orchestrator's exposed signal) is synchronised via the runner's
  `onIsRunningChange` callback — orchestrator-side façade, runner-side
  source of truth. **α.3 adds an optional
  `onInternalEvent?(e: InternalTransportEvent)`** sink in
  `QueueRunnerDeps` — the runner emits `runner-started`,
  `runner-stopped`, `rescue-fired`, `rescue-abandoned`, `watchdog-armed`
  (see `queue-runner-events.ts`). Sink errors are swallowed
  (fire-and-forget); omitting it is back-compat. Two unit suites cover
  the lifecycle: `decideNextStep` (pure decision branches) + `QueueRunner
  (loop)` (notifyEnqueue / requestStop / rescue / finalize / await-signal
  / abort invalidation / onInternalEvent emissions).

**Other `ResetTarget` implementers** (documented in their dedicated
sections — listed here so the scope-reset inventory is complete) :

- **`DeferredEffectProcessor`** — scope `CONNECTION_LIFETIME`. Owned by
  `AnimationOrchestratorService` (not by a manager). See "DeferredEffectProcessor"
  section of [animation.md](animation.md) for the rules table + emission contract.
- **`DuelGameLogService`** — scope `DUEL_LIFETIME`. Subscribes to the
  EventStream. See "EventStream vs AnimationQueue" ([animation.md](animation.md)) + the perspective-
  switch wire (`gameLog.setPerspective`).

Adding a new checkpoint reset path → check both lists (the 8 managers
above + these 2) so no `ResetTarget` is missed.

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

**DI graph:** Draw ↔ Move (Move injected lazily in Draw).
Move depends on Draw for `travelToHand()`. Draw depends on Move
(lazy `injector.get()`) for `processShuffleEvent` → `processMoveEvent`.
The former Draw → Chain dep (`hasActiveReplayTimeouts`) was removed
with the dead stagger mechanism (audit 2026-06-11 #20). Chain has zero
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

### Pre-activation Buffer (defense in depth, post-`ANIMATIONS_READY`)

Historically this buffer absorbed a **wide** race window in SOLO
multiplex: the worker spawned the instant the lone WS connected, and
emitted MSG_DRAW × 5 + BOARD_STATE before the client had finished its
thumbnail prefetch. `boardActive=false` during that window, so events
parked in `_preActivationBuffer` and drained later via a 200ms breathe
beat. PvP normal hit a much narrower window — the dice arena flow
gave 5-10s of "human pause" between connection and worker spawn.

Post-`ANIMATIONS_READY` protocol (2026-06-05) the wide SOLO window is
closed at its root: the server's `isReadyToStart` gate waits for the
client's `ANIMATIONS_READY` message (emitted on `thumbnailsReady=true`)
before spawning the worker. The buffer's role narrows to **defense in
depth** absorbing the tick-level window between the first BOARD_STATE
landing and `setBoardActive(true)` flipping :

1. BOARD_STATE arrives → `_handleBoardState` → `updateLogical` → the
   `logicalState` signal flips → `boardReady` computed flips
2. The next Angular effect tick fires `duel-loading → active` →
   `setBoardActive(true)` + `roomState.set('active')` + `drainPreActivationBuffer()`

If MSG_DRAW × 2 arrives in the same WS batch as BOARD_STATE (Node + ws
deliver TCP-grouped frames sequentially in the same tick), it will hit
`_dispatchEvent` BEFORE the effect tick can flip `boardActive` → it
parks in the buffer. The drain re-injects it 200ms later, after
`boardActive=true`, and the animation plays correctly.

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

### `ANIMATIONS_READY` client-controlled worker spawn gate (Direction B)

Client → server message that gates the server-side worker spawn on the
client's visual readiness. Pre-protocol the SOLO bootstrap spawned the
worker the instant the WS connected and emitted MSG_DRAW × 5 before the
client had finished its thumbnail prefetch — events parked in the
pre-activation buffer, the chain resolved before the drain, events lost
permanently.

**The deadlock** : the naive design "emit ANIMATIONS_READY when
thumbnailsReady=true" is circular. `thumbnailsReady` flips when
`preFetchCardImages` finishes, which is gated on having `cardCodes`
populated, which historically arrived on `DUEL_STARTING` (post-worker-spawn)
or `DECK_PREFETCH` (post-dice in PvP). Worker spawn requires
`ANIMATIONS_READY` → cycle.

**The break (Direction B)** : a new server → client message
`EARLY_DECK_PREFETCH` is emitted by `pvp-connection-handler` immediately
after `SESSION_PHASE`, BEFORE the worker spawn / dice flow. It carries
`cardCodes` (always available from `session.decks` at that point). The
client's `DuelLoadingEffectsService` triggers `preFetchCardImages` on
`wsService.cardCodes()` non-empty (no `roomState` gate), so the chain
runs:
1. WS handshake → SESSION_TOKEN → SESSION_PHASE → **EARLY_DECK_PREFETCH**
2. Client `_handleEarlyDeckPrefetch` sets `_cardCodes`
3. Loading service effect fires `preFetchCardImages` (HTTP `/api/decks/{id}` + Image preloads)
4. `thumbnailsReady = true`
5. Loading service effect fires `wsService.sendAnimationsReady()` (gated on `thumbnailsReady=true` AND `connectionStatus === 'connected'`)
6. Server `animationsReady[i] = true` → `isReadyToStart` re-eval → spawn worker / dice flow / FORK_RESUME

**Server-side state** : `ActiveDuelSession.animationsReady: [boolean, boolean]`.
Init `[false, false]` in `createInitialSessionState`, reset to
`[false, false]` in `resetSessionForRematch`.

**Server-side handler** : `client-message-router.ts` `case 'ANIMATIONS_READY'`.
Idempotent — a second emission from the same slot is logged-and-ignored.
Calls `cfg.onAnimationsReady(session, playerIndex)`, wired in `server.ts`
to re-evaluate the gate and trigger the next phase:
- PvP normal + `phase === 'WAITING_PLAYERS'` → `startFirstPlayerPhase(session)`
- SOLO multiplex + `phase === 'WAITING_PLAYERS'` → `startDuelWithOrder(session, 0)`
- Fork + `phase === 'DUELING' && forkMode` → `worker.postMessage({ type: 'FORK_RESUME' })`

**Server-side emission of `EARLY_DECK_PREFETCH`** : in `pvp-connection-handler`,
immediately after `sendToPlayer(... SESSION_PHASE ...)`. PvP normal sends
own deck only (no info leak). SOLO multiplex also sends `bothCardCodes`
(parity with `DuelStartingMsg`). Pinned source-level by
`pvp-connection-handler.spec.ts` (order: SESSION_PHASE → EARLY_DECK_PREFETCH
→ isReadyToStart branch).

**Client-side emission of `ANIMATIONS_READY`** : `DuelLoadingEffectsService`,
gated on `(thumbnailsReady === true) && (wsService.connectionStatus() === 'connected')`.
The dual gate prevents the silent-drop bug where emission before
`SESSION_TOKEN` lands would hit `safeSend`'s `readyState !== OPEN` arm.
Idempotence : `_animationsReadySent` local flag; reset by the rematch
effect.

**Rematch flow** : `resetSessionForRematch` server-side resets
`animationsReady = [false, false]`. Client-side, the loading service's
rematch effect (`wsService.rematchStarting() === true`) resets
`_animationsReadySent = false`, `prefetchStarted = false`, and
`thumbnailsReady.set(false)`. The chain then re-fires automatically since
`_cardCodes` is still populated (carried over from the previous duel).
- **Backward compat** : `PROTOCOL_VERSION` bumped to `2`. Old clients
  that don't know the message are rejected at WS handshake with
  close-code 4426 → forced refresh → new bundle. No timeout fallback
  server-side ; the protocol bump is the structural backward-compat
  fence.

Cf. `work/planning-artifacts/animations-ready-protocol-2026-06-05.md`.

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

**Switch survival (α.5, 2026-05-25)** — `trackedLp` + `_pendingLpCommits`
are `DUEL_LIFETIME` (cf. §3.5). A SOLO PvP `switchPlayer` (or replay
perspective flip) goes through `AnimationOrchestratorService.resetForSwitch`
which dispatches `{PERSPECTIVE_LIFETIME}` only — LP state is preserved.
Safe because the BOARD_STATE that immediately follows the switch
re-syncs `trackedLp` via `lpTracker.syncFromBoardState`. Mid-chain
pending LP commits now correctly survive the switch (regression risk
on the SOLO chain hygiene path, cf. memory
`pvp-solo-chain-state-hygiene-2026-05-23`). `STATE_SYNC` / rematch
dispatches `{DUEL_LIFETIME}` which cascades and fully clears LP state.

## Pre-computation Timeline Rules

1. **Turn 0 ("Setup")** contains all events before the first `MSG_NEW_TURN`.
   When `MSG_NEW_TURN` arrives, accumulated events are flushed as the Turn 0
   nav entry, then `currentTurn` increments. Transition boundary prompts
   (`SELECT_IDLECMD`, `SELECT_BATTLECMD`) trigger automatic nav-entry flushes;
   other SELECT_* prompts are accumulated within the same turn's accumulator.

2. **MSG_CHAIN_END** is flushed as its own nav entry WITHOUT `chainIndex` —
   it acts as a separator between consecutive chains in the timeline. The
   front-end hides it via `HIDDEN_SUB_EVENT_LABELS` in `buildSubEventSegments`.

3. **`generateLabel`** returns `''` for batches with only non-visual events
   (SELECT_*, WAITING_RESPONSE, MSG_CHAIN_END, MSG_CHAIN_SOLVING, etc.).
   `flushNavEntry` skips these empty-label states to avoid phantom bullets.

4. **Per-event `boardStateAfter` snapshot** — both `runReplayPreComputation`
   (in `replay-precompute.ts`) and `runDuelLoop` (in `duel-worker.ts`)
   delegate to a `ChainSnapshotTracker` instance (one per duel) which
   tracks a `chainResolving` flag (set at the first MSG_CHAIN_SOLVING of
   a chain, cleared at MSG_CHAIN_END — Option 2b, 2026-06-04) and
   attaches `buildBoardState().data` as `boardStateAfter` on each
   filtered event whose type is in `BOARD_CHANGING_EVENT_TYPES` during
   resolving. The window stays open across SOLVING/SOLVED pairs in a
   multi-link chain, across the post-SOLVED straggler gap, AND across
   `runDuelLoop` re-entries triggered by PLAYER_RESPONSE during a
   resolution prompt (Option O, 2026-06-04 — `liveChainTracker.reset()`
   is no longer called at runDuelLoop entry). Payload growth is
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
