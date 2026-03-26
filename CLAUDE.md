# Project Instructions

## Code Quality

When writing or modifying code, always apply the `clean-code` and `code-principles` skills to enforce DRY, KISS, SRP, YAGNI, and Miller's Law thresholds.

## Animation Parity Rule

Any animation added to `AnimationOrchestratorService` MUST work through the
`AnimationDataSource` interface (animation-data-source.ts). The orchestrator
MUST NOT import or reference `DuelWebSocketService` or `DuelConnection` directly.
This ensures replay mode automatically inherits all animation features.

When adding a new signal or method to the orchestrator that reads/writes
game state, add it to `AnimationDataSource` and implement it in both
`DuelWebSocketService` and `ReplayDuelAdapter`.

NOTE: `DuelConnection` (duel-connection.ts) is a concrete class for WebSocket
duel connections — it is NOT an abstraction layer. Do not confuse it with
`AnimationDataSource`.

## Chain Protocol Parity Rule

`ReplayDuelAdapter.dequeueAnimation()` mirrors `DuelConnection.handleMessage()`
for chain-related internal types (MSG_CHAIN_NEGATED, WAITING_RESPONSE,
SELECT_CHAIN). Any modification to the pending chain entry pattern or commit
points in `DuelConnection.handleMessage()` MUST be reflected in
`ReplayDuelAdapter.dequeueAnimation()`. A divergence between the two causes
incorrect chain overlay animations in replay (missing entries, stale negation
state, or premature card reveal).

## Replay Board State Parity Rule

In PVP, the server sends an incremental `BOARD_STATE` with each prompt — it
always reflects the current game state at that moment. In replay, the adapter
must provide equivalent intermediate states so `applyPendingBoardState()` is
safe to call at any time.

Key rules:

1. **`buildSteps` final segment** MUST receive `finalBoardState` (the
   transition's `next.boardState`) as an explicit parameter. This matches the
   PVP server's post-event BOARD_STATE (including shuffle results).

2. **`advanceStep` during chain** (chainPhase !== 'idle'): `_pendingBoardState`
   is always updated for each step, but empty steps (0 events) MUST NOT call
   `applyPendingBoardState()`. Only the orchestrator controls when to apply
   state during chains (via masks + explicit calls in processShuffleEvent,
   replayBufferedEvents, etc.).

3. **`processAnimationQueue` queue-empty path**: `applyPendingBoardState()`
   MUST run BEFORE `setAnimating(false)`. In replay, `setAnimating(false)`
   triggers `advanceStep()` which overwrites `_pendingBoardState` with a
   future state. Applying first uses the correct current state.

## Pile Mask & Float Lifecycle Rules

1. **Source pile masks** must use `card_back.jpg` for face-down cards (EXTRA
   deck, face-down banished). Check `msg.fromPosition` for FACEDOWN flags.

2. **`popLandedFloat` and `clearLandedByDstPrefix`** filter by `dataset.dstKey`
   prefix. Every `travel()` call that targets an HTMLElement (not a string
   zoneKey) MUST pass `dstZoneKey` in TravelOptions so the float is tagged.

3. **`processShuffleEvent`** clears only HAND floats (`clearLandedByDstPrefix
   ('HAND')`), not all floats. Non-hand floats (GY, banished, field) stay as
   visual placeholders until the next `processAnimationQueue` cycle or
   `resetChainState`.

4. **`replayBufferedEvents` final cleanup** calls only `_clearHandGhosts()`.
   Board state and masks are handled by the normal queue flow
   (`processAnimationQueue` per-event with masks, `resetChainState` at
   CHAIN_END). Applying board state here would reveal cards that have
   pending animations in the queue.

## Chain State Machine Rules

1. **`_insideChainResolution`** is set at MSG_CHAIN_SOLVING and cleared at
   MSG_CHAIN_SOLVED. All BOARD_CHANGING_EVENTS while this flag is true are
   buffered in `_bufferedBoardEvents`. The buffer is replayed by
   `replayBufferedEvents()` after the chain overlay hides.

2. **`_chainSolvedCount`** tracks how many links resolved in the current
   chain. It is ONLY reset by `resetChainState()` (at MSG_CHAIN_END). It
   drives the first-multi-link banner animation (3s pause). Between
   consecutive chains in the same turn, it resets via CHAIN_END.

3. **Queue collapse** (> 5 events) is disabled when ANY chain event
   (MSG_CHAIN_SOLVING, MSG_CHAIN_SOLVED, MSG_CHAIN_END) is in the queue.
   This is intentional — chain events need the async overlay contract.

4. **`_replayPendingEvents`** is the replay buffer used by
   `travelMaskedPile()` keep-alive logic to decide whether to REFRESH+KEEP
   or CLEAR a pile mask. It is set at the start of `replayBufferedEvents()`
   beat 1 and cleared after all travels complete. If null, the keep-alive
   falls back to the live animation queue.

## Pre-computation Timeline Rules

1. **MSG_CHAIN_END** is flushed as its own state WITHOUT `chainIndex` — it
   acts as a separator between consecutive chains in the timeline. The
   front-end hides it via `HIDDEN_LABELS` in `subEventSegments`.

2. **`generateLabel`** returns `''` for batches with only non-visual events
   (SELECT_*, WAITING_RESPONSE, MSG_CHAIN_END, MSG_CHAIN_SOLVING, etc.).
   `flushState` skips these empty states to avoid phantom bullets.
