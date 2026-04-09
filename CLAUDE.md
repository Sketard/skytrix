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

### Chain State Machine Rules

1. **`isResolving`** is set at MSG_CHAIN_SOLVING and cleared at
   MSG_CHAIN_SOLVED. All BOARD_CHANGING_EVENTS while this flag is true are
   buffered. The buffer is replayed after the chain overlay hides, using
   queue directives (group, barrier, lp, batch-end, await-signal).

2. **`chainSolvedCount`** tracks how many links resolved in the current
   chain. ONLY reset at MSG_CHAIN_END. Drives the first-multi-link banner
   animation. Between consecutive chains in the same turn, resets via
   CHAIN_END.

3. **Queue collapse** (> threshold events) is disabled when a queue
   directive (`'kind' in entry`) or an explicit chain event
   (`MSG_CHAIN_SOLVING`, `MSG_CHAIN_SOLVED`, `MSG_CHAIN_END`) is in the
   queue — chain events need the async overlay contract, and directives
   have no `.type` property.

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

Initial draws lock both HAND zones synchronously before the first `await`.
DECK is NOT locked (locking before first BOARD_STATE freezes `deckCount=0`
from `EMPTY_DUEL_STATE`, hiding the pile). Inner locks ref-count; outer
early locks commit in `finally`. Pre-locks run AFTER `syncAfterBoardState()`
— safe because `syncAfterBoardState` only calls `syncPileCounts()` when
the queue has events, never `syncRendered()`.

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
