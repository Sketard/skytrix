# Moteur de duel — replay

**Lecture** : le lecteur de replay (`MockDuelConnection`), la parité d'état du plateau, seek/pause et la fin du polling
; texte de l'ancien `CLAUDE.md`, déplacé tel quel (en anglais) le jour de l'adoption du plugin `workbench`. Index du
moteur de duel : [`README.md`](README.md). Se lit par sections : `Grep "^## "`, puis `Read` par plage.

## Sommaire

1. Replay = PvP readonly via MockDuelConnection (v4, 2026-06-05)
2. Replay Board State Parity Rule
3. Polling Removal — Regression Surface

## Replay = PvP readonly via MockDuelConnection (v4, 2026-06-05)

**Doctrine** : the replay viewer runs the EXACT same animation pipeline
as a live PvP duel. A `MockDuelConnection` (`front/src/app/pages/pvp/replay/
mock-duel-connection.ts`) implements `AnimationDataSource` (same contract
as `DuelConnection`) and consumes a `ServerMessage[]` stream pre-computed
server-side instead of a live WS feed. Strict consequence : every code
path after `dispatchNext(msg)` in replay is identical to
`_handleMessage(msg)` in PvP — bugs reproduce by construction.

**Architecture (Phases 1-6 livrées 2026-06-05/06)** :

- **Server precompute** (`duel-server/src/replay-precompute.ts`) emits
  `REPLAY_STREAM_CHUNK + REPLAY_STREAM_INIT` as the SOLE output path
  (Phase 6 retired the legacy `REPLAY_BOARD_STATES` / `PreComputedState[]`).
  Each chunk carries `messages: ServerMessage[]`, `autoResponses:
  {offset, promptType, data}[]`, and `navEntries: ReplayStreamNavEntry[]`
  where each nav entry carries `{messageOffset, label, turnNumber,
  chainIndex?, responseCount, boardStateSnapshot, events: ServerMessage[],
  chainSnapshot?}`. The single `flushNavEntry` helper at every segmentation
  boundary (chain link start/end, phase, turn, boundary prompt, end of
  duel) builds the nav entry from the accumulated `events[]` + current
  `responseIndex` + board snapshot. The 1:1 mapping legacy-state ↔ nav
  entry is preserved by construction.
- **Client transport** (`ReplayTransportService`) reads `messages[]` via
  `mockConn.dispatchNext()` in `dispatchMockUntilIndex(targetIdx)`.
  Seek/scrub/skip call `mockConn.seekToOffset(index)` which restores
  rendered state + chain state in O(1) from `navIndex[index].boardStateSnapshot
  + chainSnapshot` (Phase 4). Auto-respond uses a fixed
  `REPLAY_PROMPT_DELAY_MS = 1200ms` (no more human timestamp math).
  `gameLog.rebuildUpTo(navIndex.slice(0, idx + 1))` re-feeds the
  `GameLogBuilder` after a seek using the per-entry `events[]` (Phase 6
  — `rebuildUpTo` signature accepts `{events, boardStateSnapshot}[]`
  structurally so `ReplayStreamNavEntry` satisfies it).
- **UI surfaces** (`busy`, `pendingPrompt`, `activeHint`,
  `activeConfirmedCards`, `activePlayer`, `activeResponse`,
  `perspectiveIndex`, `navIndex`) all live on `MockDuelConnection`. The
  legacy `ReplayDuelAdapter` retired Phase 5 ; `replayConnection.boardStates`
  + `clearBoardStates` retired Phase 6 (the connection service only
  forwards chunks via `onStreamChunk` / `onStreamInit` callbacks). The
  doctrine sections F19 (skip sites) + F29 (forceClosure asymmetry)
  become trivial because `mockConn.seekToOffset` runs the same reset
  path as the PvP `CHAIN_STATE` reconnect handshake (via the SHARED
  `chainingMsgsToLinkStates` + `processor.restoreChainState` helper).
- **Fork integration** : `ReplayForkService.fork(currentIndex, navIndex,
  replayId)` reads `entry.responseCount` (input to the server-side
  REPLAY_FORK payload's `responseCount`) and `entry.boardStateSnapshot`
  (input to the `expectedState` sanity check). `cachedNavIndex` (formerly
  `cachedBoardStates`) holds a snapshot during the fork-warning
  interstitial so the timeline keeps rendering.

**Tempo rule below is unchanged** — the v4 mock pipeline pumps
`dispatchNext` at the same cadence the v3 adapter did. Conceptually, a
replay is a PvP duel played at **maximum rate without latency or human
reflection**. The server emits states as fast as it can ; the client
paces playback to whatever its own animation pipeline can sustain.
**The client is the source of truth for the minimum tempo** — server
events queue, animations gate.

This has one structural consequence : any visual animation OUTSIDE the
main `QueueRunner` (overlays, prompt fade transitions, deck shuffles)
needs to contribute to a gate the replay scheduler observes ; otherwise
the auto-advance scheduler steps forward over an animation that is
still drawing, and the user sees a half-rendered transition before the
next state lands. The PvP side has the user clicking a button as the
natural rate limiter ; replay has no such pacing humans.

**The contract today is `PvpChainOverlayComponent.overlayActive`** — a
computed bool gating both `pvp-prompt-dialog`'s visible `dialogState`
(Approach A, F1 gate, 2026-06-03) and `ReplayTransportService.maybeAdvance`'s
`schedulePromptDismiss` window. The full list of bounded animations
that contribute, and the load-bearing list of state flags that MUST
NOT contribute (gating on `resolvingIndex` causes a POLL-DROP deadlock,
discovered the hard way during 2026-06-03 diagnosis), lives in the
docblock on the computed itself — see
[pvp-chain-overlay.component.ts:434-457](../../front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts#L434-L457).

**Adding a new out-of-queue animation** — a 4-point checklist :

1. **The animation MUST be bounded by construction** — entry / body /
   exit timers all known ahead of time, no waits on user input or on
   external signals that may not arrive. The chain overlay enforces
   this via per-phase `scheduleTimeout` with explicit hold tails
   (`OVERLAY_ANIM_HOLD_MS`, 400ms with 200ms floor).
2. **Contribute the animation's "in flight" flag to `overlayActive`** —
   or to a sibling aggregate signal a future evolution adds. The flag
   MUST flip false WITHIN the bounded window from (1) ; an unbounded
   flag will deadlock the replay scheduler.
3. **No new replay-side wiring is needed** — `ReplayTransportService.maybeAdvance`
   already gates on `overlayActive` (F1) ; new contributions to the
   aggregate naturally extend the gate. PvP's prompt-dialog reads the
   same signal via Approach A.
4. **Do not pile on `resolvingIndex` / `negatedResolvingIndex` / logical
   chain state** — these stay true across async cleanup flows
   (`replayBuffer`, `impactPause`) that the gate must NOT wait for.
   The "INTENTIONALLY NOT included" block in the docblock is authoritative.

PvP is unaffected by the gate (no auto-advance scheduler ; the user
clicks). The gate is replay-only, but the contract lives in a component
shared by both modes so the doctrine stays unified.

## Replay Board State Parity Rule

Replay must provide equivalent intermediate board states so
`updateLogical()` + `syncRendered()` produce the same rendered state as PVP.
Replay's dispatch path MUST NOT call `commitAll()`: it goes through
`syncAfterBoardState()` (`syncRendered()`) to respect the lock contract. Its
only `commitAll()` is the seek reset, `seekToOffset()` after
`processor.reset()` (see below); the v3 `abort()`/`jumpToState()` sites
retired with `ReplayDuelAdapter`.

`assertNoLocks()` surfaces lock leaks at transition boundaries and PvP
reset points via `duelAssert()`. Throws in dev, `console.error`s in prod.

**Asserted sites (4 total — F19, 2026-05-31 ; recounted by audit
2026-06-11 : the "7" header dated from the v3 adapter era)**, ordered by
call path, plus the one non-asserted seek path :

- **PvP (`duel-connection.ts`)** :
  · `STATE_SYNC` handler — before `updateLogical + commitAll` (reconnect /
    cancel rollback). The server-side fresh state can't surface leaks
    from the prior animation pipeline if `commitAll` masks them first.
  · `REMATCH_STARTING` handler — before `commitAll`. The previous duel's
    pipeline MUST have settled all locks (chain end + queue drained)
    before the rematch transition.
  · `cleanup()` — duel teardown.
- **Animation orchestrator (`animation-orchestrator.service.ts`)** :
  · `resetAllState(scopes)` — before `commitAll`, after `finalizeAndCommit`.
    Any zone still locked here means a `lockZone` was never paired with a
    commit/release in the dispatch path that triggered the reset. v3 Phase 4
    (2026-06-04) — the legacy `tolerateLocks` skip is gone; the assert is
    now strict for ALL callers including `resetForReplaySeek`. The locks
    a seek mid-animation legitimately leaves behind are cleared by the
    earlier `clearTimersAndPolling → runner.requestStop() →
    rbs.dropOrphanedLocks('runner-requestStop')` (Phase 3) so the strict
    assert can re-take its role of canary for genuinely orphan locks
    (i.e. locks taken outside the runner's loop scope).
- **Replay (`mock-duel-connection.ts`, v4 Phase 5)** :
  · `seekToOffset(index)` — `processor.reset()` runs before the
    `rbs.commitAll('mock:seekToOffset')`. Locks from a seek mid-animation
    are cleared upstream by `orchestrator.resetForReplaySeek()` →
    `runner.requestStop()` → `dropOrphanedLocks` (called by the page's
    `abortAndClean()` BEFORE the transport's `seekToOffset`).

The v3 `ReplayDuelAdapter` step-queue API (`feedTransition`, `advanceStep`,
`collapseRemainingSteps`, `abort`, `jumpToState`) is retired ; the F19
skip sites it carried (3 call paths) collapsed into the single
`seekToOffset` site above.

Other `commitAll()` call-sites (draw-sequence-manager fallback paths,
buffer-replay-builder shuffle merge) are mid-pipeline flow recoveries,
not transition boundaries. They run with active locks by design and do
NOT assert.

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

   **Window scope (2026-06-04 Option 2b)** — the `chainResolving` window
   spans the FIRST `MSG_CHAIN_SOLVING` of a chain through `MSG_CHAIN_END`
   (NOT `MSG_CHAIN_SOLVED`). Reason : a card that self-destroys reacting
   to its own resolution emits `MSG_MOVE` AFTER its `MSG_CHAIN_SOLVED`
   but BEFORE `MSG_CHAIN_END`. Without the extension, that MOVE has no
   `boardStateAfter` → client logical state lags → `preSrcLock.commit()`
   for the straggler copies a stale logical state to rendered → source
   card stays visible during the travel animation ("card in 2 places"
   symptom). Side-effect : the live PvP `CANCEL_PROMPT_SEQUENCE` gate
   (which reads `liveChainTracker.isResolving`) is now also active
   between the last `MSG_CHAIN_SOLVED` and `MSG_CHAIN_END` — cancel is
   semantically incorrect there (chain not finished, OCGCore still
   emitting effect-bound events), so the broader gate is the right
   behavior.

   **Tracker lifetime across `runDuelLoop` calls (2026-06-04 Option O)** —
   `liveChainTracker` is hoisted to module scope in `duel-worker.ts` and
   was historically `.reset()`-ed at every `runDuelLoop` entry to "preserve
   per-call semantics". Post-Option 2b that reset became a bug : a chain
   that includes a player prompt mid-resolution (e.g. `SELECT_CARD` for a
   discard cost — `MSG_CHAIN_SOLVING + MSG_DRAW + MSG_SHUFFLE_HAND +
   SELECT_CARD` in one call, then `MSG_MOVE + MSG_CHAIN_SOLVED + MSG_MOVE
   + MSG_CHAIN_END` in the next call) loses its window between the two
   calls — every post-prompt MOVE was emitted with `_chainResolving =
   false`, no `boardStateAfter` attached, client logical never advances
   for those events. The fix : the per-call `.reset()` is NO LONGER
   called. The tracker self-resets at `MSG_CHAIN_END` (its only legitimate
   close trigger). Module-level state survives across PLAYER_RESPONSEs
   inside a chain. Terminal resets still happen at duel start (fresh
   module instance), rematch (worker terminated), and STATE_SYNC (the
   tracker is recreated locally for the replay precompute path).

   **Client BOARD_STATE skip during resolving + queue non-empty
   (2026-06-04 Option N)** — `syncAfterBoardState` (animation-data-source.ts)
   skips its `updateLogical(boardState)` when `chainPhase === 'resolving'
   && queueLength > 0`. Reason : the server emits a BOARD_STATE
   immediately after `MSG_CHAIN_END` while events from the chain are
   still pending in the client queue. If that BOARD_STATE were applied
   to logical now, the next MOVE's `commitZone` (e.g. GY-0 at the end of
   the first MOVE's travel) would copy the FINAL post-chain state to
   rendered — including cards that haven't been animated yet — and the
   following MOVE's destination card appears at its DOM destination
   before its own travel even starts ("card appears in cemetery before
   self-destroy travel" symptom). With Option O above, per-event
   `boardStateAfter` snapshots are the canonical source of logical
   advancement during the resolving window ; the mid-chain BOARD_STATE
   is redundant for these zones and harmful for the dispatch-order
   invariant. The skip is bounded : as soon as `queueLength === 0` the
   skip lifts and the next BOARD_STATE (or STATE_SYNC) syncs normally.
   The previous DOCTRINE that "BOARD_STATE was the sole source of
   logical sync mid-chain" no longer holds — per-event snapshots ARE
   the source, BOARD_STATE is the fallback.

   **Replay perspective swap** — `boardStateAfter` arrives in absolute
   server P0 order (replay precompute is perspective-agnostic). The
   orchestrator is shared with PvP and assumes already-relative data, so
   `MockDuelConnection` MUST relativize the per-event snapshot for
   `perspectiveIndex === 1` — the mock's `_maybeSwapBoardState` at
   `dispatchNext` time rewrites the event's `boardStateAfter` via
   `swapBoardState()` before forwarding to the processor. Skip the swap
   and perspective-1 replays render the board flipped for one frame
   when the orchestrator calls `updateLogical(event.boardStateAfter)`.

5. **`ReplayStreamNavEntry.chainSnapshot` mid-chain seek restore**
   (F9-bis, 2026-06-04 ; Phase 6 absorb 2026-06-06). When a nav entry
   is captured while a chain is open (`chainPhase !== 'idle'`),
   `replay-precompute.ts` embeds a snapshot of the server-side
   `ChainStateContainer` : `{ links: ChainingMsg[], phase, negatedIndices,
   currentSolvingChainIndex }`. `MockDuelConnection.seekToOffset` applies
   it via the SAME restore code path as the PvP `CHAIN_STATE` reconnect
   handshake — shared helper
   [chain-state-restore.utils.ts](../../front/src/app/pages/pvp/duel-page/chain-state-restore.utils.ts)
   `chainingMsgsToLinkStates` + `processor.restoreChainState` +
   conditional `processor.applyChainSolving(currentSolvingChainIndex)`.
   Without this, seeking into the middle of a chain wipes
   `activeChainLinks` (via `processor.reset()`) and leaves the chain
   overlay + chain badges empty even though the target state is
   semantically inside a chain. The PvP reconnect handshake doesn't
   carry `currentSolvingChainIndex` because the live worker fires
   `MSG_CHAIN_SOLVING` as a real message immediately after — replay
   can't, so the field is necessary for the in-resolution link to be
   visually distinguished (`resolving: true`) on seek. `replay-handlers.ts`
   caches the source `WorkerReplayPayload` (not the precomputed nav
   index), so existing replays re-precompute on next open and inherit
   any precompute changes immediately. See F9-bis section above for the
   3-consumer table + precompute timing rule.

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

4. *(retired — audit 2026-06-11 #20)* The legacy "Replay stagger guard"
   (`hasActiveReplayTimeouts` gating draw resume) was dead code — zero
   production writers since buffer replay moved to queue directives with
   `staggerMs`. The mechanism (`addReplayTimeout` / `_replayTimeouts`)
   was removed; staggering is owned by the `group` directive.

5. **Chain poll** — when the queue empties during `deferred` commitMode
   (`chainPhase === 'resolving'`), the orchestrator only polls if
   `isWaitingForOverlay` is true (post-CHAIN_SOLVED, overlay replaying
   buffered events). Otherwise it finalizes — in replay, CHAIN_SOLVED may
   be in the next step, and polling would deadlock. Poll ceiling force-resets
   chain state as a safety net. During `building` phase, `commitMode` is
   `'per-event'` — queue-empty finalizes normally.

6. **Mid-chain buffer drain rescue (2026-06-04)** — `decideNextStep`'s
   `pre-replay-buffer` branch fires whenever `isResolving && hasBufferedEvents`,
   regardless of `hasPendingPrompt`. Covers two scenarios with the same remedy
   (`replayBuffer(inlineFromLoop=true)`) :
   - **Mid-chain pre-replay (legacy)** — a prompt arrived while the chain is
     still resolving and the buffer is non-empty. Flushing ensures the player
     sees animations before answering.
   - **Post-MSG_CHAIN_SOLVED straggler** — a BOARD_CHANGING event was buffered
     AFTER the overlay-driven `replayBuffer` already drained this link's queue
     but BEFORE `chainPhase` flipped to `'idle'` (which only happens at
     MSG_CHAIN_END dispatch). In replay, `MSG_CHAIN_END` lands as a distinct
     `ReplayStreamNavEntry` produced by `replay-precompute.ts` (chain
     separator in the timeline, label `'MSG_CHAIN_END'` hidden by
     `HIDDEN_SUB_EVENT_LABELS`) and won't be reached by `dispatchMockUntilIndex`
     until `chainPhase=idle` — without an autonomous drain, the deadlock is
     circular (buffer holds the event → `chainPhase` stuck `resolving` →
     transport refuses to advance to the CHAIN_END entry). PvP bonus
     side-effect : 2 batches separated instead of one with lock GY-0
     ref-count=2 shared on stacked MSG_MOVE.

   `pause-external` (priority 1 — `isWaitingForOverlay || hasDrawsInFlight`)
   preempts this rescue ; the overlay-driven `replayBuffer` from
   `onChainLinkResolved` handles the first drain. The rescue handles whatever
   straggles after.

## Polling Removal — Regression Surface

The legacy chain-poll back-off (`_pollTimeout` + 50→500ms exponential +
ceiling=30) was removed 2026-05-10 after investigation found it
unreachable since commit 89b761c4 — three event-driven re-wakes
(`runner.notifyEnqueue` on WS message, `advanceStep` on
`setAnimating(false)`, `initResumeEffect` on `chainOverlayReady`) cover
the "chain resolving, queue temporarily empty" gap. Palier A
(2026-05-23) moved the loop into `QueueRunner` but the rescue + watchdog
contract is unchanged.

The `pollDropWatchdog.arm()` (fired in the runner's `'finalize'` case
when `chainPhase === 'resolving'`, cleared in `runner.notifyEnqueue` +
`runner.requestStop`) is the safety net: after
`POLL_DROP_REGRESSION_WATCHDOG_MS` (10s) it logs
`[POLL-DROP REGRESSION]` (unfilterable, not through `DuelLogger`) and
fires `duelAssert(false, 'POLL-DROP-REGRESSION', ...)`.

**If you see the marker, investigate in this order before anything
else:**
1. Did MSG_CHAIN_END arrive? Check WS logs for the duel ID.
2. Did `chainPhase` transition to `'idle'`? Grep `applyChainEnd` traces.
3. Was `initResumeEffect` fired on `chainOverlayReady`? Check
   `[ANIM:CHAIN] resumeEffect` logs.
4. Did `runner.notifyEnqueue` get called after the stall? Check
   `[RUNNER] notifyEnqueue` traces (enable category `RUNNER` first).

If none of (1-4) hold, the dropped poll mechanism was masking a real
upstream bug — find the missing event/signal first, do NOT re-introduce
the poll. Last-resort restore: a single
`setTimeout(() => this.runner.notifyEnqueue(), 500)` in the runner's
finalize case (no back-off, no ceiling — the watchdog is the ceiling).

**Grep markers (do not change without updating this section):**
`POLL-DROP REGRESSION` (the console.error string) and
`POLL-DROP-REGRESSION` (the duelAssert site tag).

### Replay interruption safety (seek / pause during a chain)

Interrupting a replay mid-chain has two distinct failure modes, both
fixed defensively (2026-05-20). Since Palier A (2026-05-23) the
lifecycle primitives live in `QueueRunner`; `orchestrator.clearTimersAndPolling`
delegates to `runner.requestStop()`.

1. **Stale async loop after a seek.** `_processAnimationQueueInner`
   (`QueueRunner`) is an async loop that cannot be cancelled mid-`await`.
   A seek / sub-event click runs `abortAndClean` → `resetForSwitch` →
   `runner.requestStop()` (flips `_isRunning` false through
   `onIsRunningChange`, which also flips `_isAnimating`). Then a fresh
   feed flips it back true — so the suspended stale loop would resume
   and run alongside the new one.

   **Root cause of the "infinite rescue" (fixed 2026-05-20):** when the
   reset landed while a loop was suspended on an `await`, that loop's
   `finally { _innerLoopDepth-- }` had not run, leaving `_innerLoopDepth`
   stale at 1. The post-reset feed's fresh loop then did `_innerLoopDepth++`
   → 2 → the parallel-re-entry `duelAssert` **threw**, aborting the loop
   body before it dispatched anything → the queue never drained → the
   `processAnimationQueue` finally rescue re-fired forever. Fix:
   `runner.requestStop()` zeroes `_innerLoopDepth`, and the inner-loop
   `finally` floors it at 0 (`Math.max(0, …)`) so a stale loop resuming
   after the reset can't drive it negative.

   Defense in depth (Palier C, 2026-05-23): the maison `_resetGeneration`
   token was replaced by an `AbortController`. `runner.requestStop()`
   calls `_abort.abort()` then installs a fresh controller; suspended
   inner loops check `abortSignal.aborted` after each `await` and bail
   cleanly. The `processAnimationQueue` finally compares its captured
   `AbortController` by reference against `_abort` to detect a swap and
   stays inert across it. Plus a no-progress ceiling
   (`RESCUE_NO_PROGRESS_CEILING`) — past N rescues with `queueLen`
   unchanged the rescue abandons with a `logger.warn` instead of looping.

   **F13 (2026-05-31) — `AbortController` does NOT make `_innerLoopDepth`
   redundant.** The two cover orthogonal scenarios:

   - `AbortController` guards RESET boundaries (single suspended loop
     bails after a `requestStop`).
   - `_innerLoopDepth` guards INTRA-TICK parallel re-entry. The finalize
     branch in `_processAnimationQueueInner` flips `_isProcessing=false`
     for a synchronous window between `onFinalize()` and
     `setRunning(false)` ; if `setRunning(false)` triggers
     `advanceStep → feedTransition → enqueue → notifyEnqueue →
     processAnimationQueue` in the same microtask, the new call passes
     the `_isProcessing=false` gate and a SECOND inner loop starts
     BEFORE the first returns. No abort involved. The `depth <= 1`
     assert is the only structural detection (audit finding C4).

   Removing `_innerLoopDepth` would lose that detection. The three
   sites (`requestStop` zero, entry `++` + assert, finally `Math.max(0,
   …)` floor) each load-bear a piece of the invariant the others rely
   on ; removing any one breaks the rest. Each site carries an `F13
   site N of 3` comment pointer in `queue-runner.ts`.

2. **Watchdog false-fire while paused.** A resolving chain can sit with
   an empty queue when replay auto-play is paused — the next link /
   `MSG_CHAIN_END` are in a transition `maybeAdvance` won't schedule
   until resume. That is healthy, not a stall. `setPlaybackPaused(bool)`
   (called from a replay-page effect watching `transport.isPlaying`)
   clears the watchdog on pause and re-arms it on resume if still
   mid-resolution. `armPollDropWatchdog` no-ops while `_playbackPaused`.
   PvP never calls `setPlaybackPaused` (no pause there).
