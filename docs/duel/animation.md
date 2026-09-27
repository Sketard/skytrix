# Moteur de duel — animation

**Lecture** : la règle de parité d'animation (`AnimationDataSource`), l'EventStream, les projections et les processeurs
du pipeline v2 ; texte de l'ancien `CLAUDE.md`, déplacé tel quel (en anglais) le jour de l'adoption du plugin
`workbench`. Index du moteur de duel : [`README.md`](README.md). Se lit par sections : `Grep "^## "`, puis `Read` par
plage.

## Sommaire

1. Animation Parity Rule
2. EventStream vs AnimationQueue (Palier 0)
3. Animation Pipeline v2 — shipped lots (α + β)

## Animation Parity Rule

Any animation added to `AnimationOrchestratorService` MUST work through the
`AnimationDataSource` interface (animation-data-source.ts),
`RenderedBoardStateService` (board state management), and
`DuelEventProcessor` (chain/queue event processing). The orchestrator
MUST NOT import or reference `DuelWebSocketService` or `DuelConnection` directly.
This ensures replay mode automatically inherits all animation features.

When adding a new signal or method to the orchestrator that reads/writes
game state, add it to `AnimationDataSource` and implement it in both
`DuelWebSocketService` and `MockDuelConnection`.

`AnimationDataSource` is injected via the `ANIMATION_DATA_SOURCE` token.
Implementations: `DuelWebSocketService` (PvP, delegates to `DuelConnection`)
and `MockDuelConnection` (Replay). Shared utility: `syncAfterBoardState()` —
free function used by both for BOARD_STATE sync tier logic.
`DuelConnection` is a concrete WebSocket class, NOT an abstraction layer.

## EventStream vs AnimationQueue (Palier 0)

Two distinct flux coexist in the animation pipeline:

- **`AnimationQueue`** — the animatable subset, owned by
  `DuelEventProcessor._animationQueue`, consumed by the queue runner.
  Strict `GameEvent` union; the invariant "`MSG_CHAIN_NEGATED` is NOT
  pushed to `animationQueue`" stays true.
- **`AnimationOrchestratorService.eventStream`** — every duel event in
  logical order (post-chain-buffer), the journal source. Wider
  `StreamEvent` union (`GameEvent | ChainNegatedMsg | WinMsg |
  SelectCardMsg | BoundaryEvent | DeferredFluxEvent | AnimationFluxEvent
  | InternalTransportEvent`). β.2a refactored the push pipeline around a
  **single convergence point**: `AnimationOrchestratorService.pushToStream(event)`
  appends to `_eventStream` AND calls `deferredProcessor.observe(event)`.
  The DEP's own emissions go through `pushDeferredToStream` which
  bypasses observe re-entry. Push sites converging on `pushToStream`:
  · the in-queue tap inside `processEvent` (after `bufferIfResolving`,
    after `updateLogical(boardStateAfter)`, before the dispatch switch);
  · the page-bootstrapped out-of-band sink (γ-c cleanup F-1.2 retired
    the `notifyOutOfBandEvent` wrapper — sink callers invoke
    `pushToStream` directly) — feeds
    `DuelEventProcessor.onEvent(MSG_CHAIN_NEGATED)` (wired by
    `DuelConnection.attachOutOfBandSink` /
    `MockDuelConnection.attachOutOfBandSink`); `DuelConnection`
    `SELECT_CARD` prompt branch (PvP only — replay has no interactive
    prompts); `DuelConnection` `DUEL_END` handler reconstructs a
    synthetic `MSG_WIN` from `winner` + `winReasonCode` when the duel
    ended naturally in the engine (non-engine ends — surrender,
    timeout, disconnect — leave `winReasonCode` undefined and skip the
    synthesis, matching what replay sees in its precompute final state);
    β.1 BoundaryProcessor emissions via the same `processor.onEvent`
    sink the adapters wire (`ChainStarted/Ended`, `TurnStarted/Ended`,
    `PhaseStarted/Ended` — see the dedicated "BoundaryProcessor"
    section below);
  · β.2a (2026-05-26) — `QueueRunner.onInternalEvent` sink absorbed
    onto the stream (the α.3 `InternalTransportEvent` family —
    `runner-started/stopped`, `rescue-*`, `watchdog-armed`). Closes the
    W1 code-review finding. The DEP observes runner transport events
    alongside WS messages so a future rule can predicate on them.
  · β.2a (2026-05-26) — `DeferredEffectProcessor` emits
    `DeferredEffect/EffectReady/EffectAbandoned` via
    `pushDeferredToStream`. See the dedicated
    "DeferredEffectProcessor" section below.
  · β.2b (2026-05-26) — the orchestrator emits
    `AnimationStarted({ref, msgType})` + `AnimationCompleted({ref, msgType})`
    around every dispatched business event (sync emit today, see the
    DeferredEffectProcessor section for the β.3 follow-up).

`DuelGameLogService` subscribes via `attachEventStream(stream)` — a
`signal` effect that drains newly-pushed events through `notifyGameLog`
in arrival order. The journal index is reset at `reset()`; on replay
seek `orchestrator.resetForSwitch` clears the stream and the service
together, then `rebuildUpTo(states)` re-feeds the builder via the
separate `ingestState` path. PvP↔Replay parity is structural — the
same `GameLogBuilder` consumes the same event set on both sides.

## Animation Pipeline v2 — shipped lots (α + β)

For full implementation history, edge cases, and design justifications
see [docs/anim-pipeline-v2/README.md](../../docs/anim-pipeline-v2/README.md).
This section keeps only the **load-bearing invariants** a future dev
MUST respect to extend or modify the pipeline safely.

**Lot inventory** :

| Lot | Component | File | Status |
|---|---|---|---|
| α.1 | Signal tagging ESLint rule | `eslint-plugins/pipeline-signal-tagged/` | ACTIVE — every new `signal()` MUST be tagged |
| α.2 + α.4a | `BaseProjection<T>` + `ResetTarget` infra | `front/src/app/pages/pvp/projections/` | ACTIVE — base contracts |
| β.1 | `BoundaryProcessor` (ChainStarted/Ended, TurnStarted/Ended, PhaseStarted/Ended) | `front/src/app/pages/pvp/duel-page/boundary-processor.ts` | SHIPPED 2026-05-26 |
| β.2a + β.2b | `DeferredEffectProcessor` + rules table + central `pushToStream` ref | `front/src/app/pages/pvp/duel-page/deferred-effect-processor.ts` + `deferred-effect-rules.ts` | SHIPPED 2026-05-26 |
| β.3 | 7 production projections + 2 standardisations + Doctrine | `front/src/app/pages/pvp/projections/*.projection.ts` | SHIPPED 2026-05-31 (F15 collapse closed last residual) |

### Signal tagging convention (α.1) — STILL ENFORCED

Every `signal()` under `front/src/app/pages/pvp/` MUST declare its
nature so a reviewer can answer "projection / @Environment / transport
state?" without archaeology. ESLint rule
`skytrix-pipeline/pipeline-signal-tagged` enforces it. Three tags + 1
escape hatch :

1. **`_transport_<name>`** — internal transport state (queue pointers,
   timer flags, debounce counters). Never read by UI templates. Strict
   prefix : `_transport_*` only (P8 hardening).
2. **`<name>Source`** — `@Environment` input (OS setting, user prefs,
   session config). Read-only from the pipeline's POV. Module-scope
   only (P8).
3. **Property of a class that `extends BaseProjection<T>` or
   `implements ResetTarget`** — every other signal MUST live inside a
   registered projection. Class membership IS the tag. The
   `BaseProjection` / `ResetTarget` import MUST be from `projections/`
   (P8 — guards against local shadow classes).
4. **`// eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged`** —
   escape hatch with a `// why:` sibling comment.

Baseline of pre-existing untagged files :
`eslint-plugins/pipeline-signal-tagged/allowed-files.json`. New files
in `pvp/` are checked from creation. Regenerate baseline (after a
migration batch) with `node front/eslint-plugins/pipeline-signal-tagged/regenerate-baseline.mjs`.

### Projection infrastructure (α.2 + α.4a) — STILL ENFORCED

Two layered contracts in
[front/src/app/pages/pvp/projections/](../../front/src/app/pages/pvp/projections/) :

- **`ResetTarget`** (interface, α.4a) — `readonly scope: ScopeCategory`
  + `applyReset(scopes, payload?)`. Implemented by managers that mix
  business + transport + exposed signals (`ChainResolutionManager`,
  `LpAnimationTracker`, `BattleAnimationTracker`,
  `DuelGameLogService`, `TargetIndicatorManager`).
- **`BaseProjection<T>`** (abstract class, α.2) — strict superset of
  `ResetTarget`. Adds `readonly value: Signal<T>` + `applyEvent(FluxEvent)`.
  Used by all 7 β.3 projections.

**`ScopeCategory`** : `SESSION_LIFETIME | DUEL_LIFETIME |
CONNECTION_LIFETIME | PERSPECTIVE_LIFETIME`. Ordered top-down.
Invalidating a scope cascades to every scope below via
`expandInvalidatedScopes(set)`. The algorithm anchors on the shallowest
(most durable) entry and fills every scope strictly below — non-
contiguous inputs like `{SESSION, CONNECTION}` expand to all 4 (P9
hardening).

**`ScopeResetDispatcher`** — registry + fan-out. `register(target)`
accepts any `ResetTarget`. `dispatch(scopes, payload?)` expands then
calls `applyReset` on every registered target whose scope is in the
expanded set. Idempotent register ; silent unregister.

### BoundaryProcessor invariants (β.1)

`BoundaryProcessor` (`boundary-processor.ts`) is owned privately by
`DuelEventProcessor`. Emits `ChainStarted/Ended`, `TurnStarted/Ended`,
`PhaseStarted/Ended` (carrying `kind: 'boundary'`) on the EventStream.

**Call-site invariants** (any future refactor MUST preserve) :

- `observeMessage(msg)` MUST be called as the FIRST line of
  `_processMessageInner`, BEFORE any state mutation. Sync-mandatory.
- `observeBoardState(payload)` MUST be called from the WS adapter
  AFTER `syncAfterBoardState`.
- `forceClosure(reason)` MUST be called on `STATE_SYNC` /
  `REMATCH_STARTING` / `DUEL_END` to emit `*Ended` for every open
  group in Chain → Phase → Turn order before chain state is wiped.
- `silentReset` drops state WITHOUT emitting any boundary. Use it on
  hard teardown ; use `forceClosure` when a §3.6 checkpoint is the
  actual cause and the journal should see the closures.

**Replay-side asymmetry (F29 doctrine, 2026-05-31 — v4 Phase 5)** —
the v4 `MockDuelConnection.seekToOffset` intentionally does NOT call
`forceClosure` at seek. A replay seek runs `abortAndClean` →
`resetForReplaySeek` → dispatch `{DUEL_LIFETIME}` → `processor.reset()`
→ `boundary.silentReset()` (the processor is the one owned by the mock,
which the orchestrator's `ResetTarget` registry sees via the
`ANIMATION_DATA_SOURCE` token). The journal would only see those
closures briefly because `gameLog` is fully wiped + rebuilt the same
tick via `gameLogRebuildTick` → `rebuildUpTo([0..currentIndex])` (new
`GameLogBuilder` instance). Emitting closures juste avant the wipe
would be pure noise. PvP/SOLO have NO such full rebuild — their
journal stays live across STATE_SYNC/Rematch, so `forceClosure` is
load-bearing there. Don't add `forceClosure` to the replay seek path
without first introducing a consumer that would survive the journal
wipe.


### DeferredEffectProcessor invariants (β.2)

`DeferredEffectProcessor` (`deferred-effect-processor.ts`) materialises
cross-event temporal correlations as explicit markers on the
EventStream. Owned by `AnimationOrchestratorService` (NOT by
`DuelEventProcessor` like the BP — the DEP MUST observe the SAME
convergence point that sees WS messages AND boundary events AND
runner transport events).

**Emitted event types** (all carrying `kind: 'deferred'`) :

- `DeferredEffect(name, triggerRef, awaitingPredicate)` — a rule's
  trigger fired ; the processor is now watching for a matching event.
- `EffectReady(name, triggerRef)` — a flux event matched the
  predicate ; consumers can treat the deferred as resolved.
- `EffectAbandoned(name, triggerRef, reason)` — closed without a
  match. `reason: 'timeout'` (no match within `DEFERRED_TIMEOUT_MS =
  5s`) or `'checkpoint'` (a §3.6 reset wiped every pending deferred).

**Call-site invariants** :

- **Reset scope** : `CONNECTION_LIFETIME`. `PerspectiveSwitched`
  (PERSPECTIVE-only, deeper) does NOT abandon open deferreds —
  deferreds survive the switch.
- **`silentReset`** drops state + timers WITHOUT emitting any
  `EffectAbandoned`. Mirror of `BoundaryProcessor.silentReset`. Use
  on hard teardown ; use `applyReset({CONNECTION_LIFETIME})` via the
  dispatcher when a §3.6 checkpoint is the actual cause.
- **Name collisions** are an invariant violation : `duelAssert`
  throws in dev ; in prod the older entry is abandoned with
  `EffectAbandoned(reason='timeout')`. The rules table guarantees
  uniqueness by including index / chainIndex / ref in each name.
- **Central monotonic ref** : `pushToStream(event)` returns the
  monotonic `ref` and forwards `(event, ref)` to
  `deferredProcessor.observe`. The DEP stores ref as the deferred's
  `triggerRef`. The orchestrator stashes it on
  `_transport_lastDispatchedRef` so `AnimationStarted` /
  `AnimationCompleted` carry it. The ref counter resets in
  `resetAllState`.

**Rule contract** (`deferred-effect-rules.ts`) — each rule declares
`trigger / deriveName / derivePredicate` and an optional `chainTo`.
The rule reference is stored on the active deferred so `tryRearm`
reaches `chainTo` in O(1). 6 rules ship — 5 `DeferredRule`
(overlay-show compound, trigger-show self-ref, attack-impact, lp-cost,
counter-pulse) + 1 `RewriterRule` (xyz-leave-with-materials, a
distinct `kind:'rewriter'` type that rewrites the event stream
in-place rather than producing deferred markers) ; 6 stubs documented
inline (`#3` through `#11` — see the file).

**RuleSinks doctrine (2026-06-01)** — production uses `NO_OP_SINKS`
**by design**. `xyzLeaveWithMaterials` absorbs the N XYZ-material
settling MSG_MOVE (GY→GY reason=0x600) cleanly side-journal (closes
the duplicate "→ Graveyard" rows), and the absence of a replacement
travel animation is **intentional** : a synthetic OVERLAY→GRAVE travel
from the XYZ source's MZONE carries no user-visible information, and
the pre-U16 `pileToPile` flash visual was ugly anyway. The rule's
`onTrigger` keeps synthesizing virtuals + acquiring a no-op lock so
the rule contract is self-sufficient — wire the real sinks
(`dataSource.enqueueVirtualMoves` + `rbs.lockZone`) only if a future
scenario actually wants a replacement visual. Do NOT call the
`NO_OP_SINKS` state "dette" or "Commit 2 missing" — it's the chosen
production behavior.

### Projections β.3 — inventory

7 production projections in `front/src/app/pages/pvp/projections/`,
each `extends BaseProjection<T>` and is registered + attached on
`_eventStream` by the orchestrator constructor. All `PERSPECTIVE_LIFETIME`.

| Lot | Projection | Source events | Clear path |
|---|---|---|---|
| 1 | `OverlayShowReadyProjection` | `EffectReady` / `EffectAbandoned` ('overlay-show:chain-N') from DEP | `ChainEnded(N)` boundary + applyReset |
| 2.3 | `CounterPulseProjection` | `MSG_ADD_COUNTER` / `MSG_REMOVE_COUNTER` | `AnimationCompleted({msgType ∈ COUNTER_MSG_TYPES})` |
| 2.6 | `AnimatingZoneProjection` | `MSG_FLIP_SUMMONING` / `MSG_CHANGE_POS` (FD→FU) / `MSG_CHAINING` (with zoneId) | `AnimationCompleted({msgType ∈ ZONE_MSG_TYPES})` |
| 3.1 | `IsAnimatingProjection` | `runner-started` / `runner-stopped` (InternalTransportEvents) | applyReset |
| 2.4-REDO | `SwapGraveDeckProjection` | `MSG_SWAP_GRAVE_DECK` | `AnimationPhaseCompleted({phase: 'glow'})` (Standardisation 1) |
| 2.2-REDO | `AnimatingLpProjection` | `MSG_DAMAGE` / `MSG_RECOVER` / `MSG_PAY_LPCOST` decorated with `lpDelta` (Standardisation 2) | `AnimationCompleted({msgType ∈ LP_MSG_TYPES})` |
| 4.1-REDO | `TargetedZoneKeysProjection` | `MSG_BECOME_TARGET` (FIELD locations only, union accumulation) | `AnimationPhaseCompleted({phase: 'reticle-pulse'})` (Standardisation 1) |

Slot 3.2 is intentionally absent — `chainResolutionAnnounce` (F15) is
a single dual-purpose signal owned by `ChainResolutionManager`, NOT
a projection. See Doctrine 3-bis below.

**Permanent drops (by design)** :
- `chainOverlayBoardChanged` (Lot 2.1) — replaced by
  `chainManager.hasBufferedEvents` getter.
- `confirmRevealedCards` (Lot 2.5) — orphelin (never set in prod). 3
  alternative mechanisms cover reveal : chain-tagged hand badges,
  `confirmCardsInHand` flip, `revealCardOnDeck`.

### Standardisation 1 — `phaseWait` + `AnimationPhaseCompleted`

`phaseWait(phase: string, durationMs: number, msgType: string):
Promise<void>` on the orchestrator combines a tracked
`scheduleTimeout` wait + a stream push. Emits
`AnimationPhaseCompletedEvent({phase, msgType, ref})` once the timer
fires. The `ref` is captured from `_transport_lastDispatchedRef` at
phaseWait call time (synchronous prefix of the async handler).

**Use-case** : handlers with INTERNAL sub-phases ending before the
overall animation completes (`MSG_SWAP_GRAVE_DECK`'s glow finishes
mid-handler before the travel). Projections observing the phase
boundary clear at the sub-step instead of waiting for the runner's
final `AnimationCompleted`.

**Caller's responsibility** : playback-speed scaling of `durationMs`
(typically via `ctx.scaledDuration(BASE, MIN)`) — symmetric with the
runner's already-scaled durations.

### Standardisation 2 — `decorateLpEventForStream` + `peekLpDelta`

`LpAnimationTracker.peekLpDelta(player, amount, type) → {fromLp,
toLp, durationMs}` is a pure read of the tracker's `trackedLp` —
NEVER mutates. The orchestrator's `decorateLpEventForStream(event)`
shallow-clones `MSG_DAMAGE` / `MSG_RECOVER` / `MSG_PAY_LPCOST` with
`lpDelta` attached, called BEFORE `pushToStream` in `processEvent`.

**Order contract** — `peekLpDelta` MUST run BEFORE `processLpEvent`.
If swapped, `fromLp === toLp` → silent animation freeze. Pinned by
`lp-animation-tracker.spec.ts` "β.3 R4" test pair (positive +
regression). The orchestrator's `processDirective.case 'lp'` path
follows the same contract for buffered LP replay.

### Doctrine — projection vs signal manager

Not every signal in the pipeline is a candidate projection. The β.3
chasse aux sorcières established these rules :

1. **A projection is dérivable du FLUX** — its value is a pure
   function of `(EventStream history, perspective, environment)`.
   Adding `BaseProjection<T>` is correct when the source data lives
   in events the pipeline already pushes.

2. **A signal manager is dérivable du STATE** — its value is a pure
   function of internal mutable state (a Map, a buffer, a counter)
   that lives in a manager. Examples that stayed managers in β.3 :
   `chainOverlayBoardChanged` (now `hasBufferedEvents` getter),
   `hasLockedZones` on the RBS (now `_locks.size > 0` getter).

3. **Sub-step timers internal to a handler** — when a signal clears
   via `setTimeout(...)` mid-handler (BEFORE the final
   `AnimationCompleted`), it needs Standardisation 1 (`phaseWait` +
   `AnimationPhaseCompleted`) to become migrable. Otherwise it stays
   in its manager. Examples migrated : `swapGraveDeckKeys` (phase
   `'glow'`), `targetedZoneKeys` (phase `'reticle-pulse'`, Lot 4.1-REDO).

3-bis. **Dual-purpose signal — reactive UI + sync predicate** — when
   a single signal serves BOTH a reactive Angular template / effect
   AND a synchronous predicate inside a manager method, do NOT split
   into a projection + private mirror pair. Keeping two writers in
   lock-step is fragile by construction — they may agree within a
   tick today but skew under any future timing change (F-bugB4
   2026-05-31 surfaced an infinite re-deferred loop caused by exactly
   this skew). The correct shape is a single `signal<T>` owned by the
   manager, read sync via direct call for the predicate AND exposed
   as readonly via `asReadonly()` for the reactive surface. The
   manager handles its own `applyReset` ; no projection-class wrapping
   needed. Reference implementation : `chainResolutionAnnounce`.

4. **External state dependency** — when a signal value depends on
   state outside the projection (e.g., LP's `fromLp` depending on
   `trackedLp`), the orchestrator decorates the event at push time so
   the projection consumes a self-contained payload (Standardisation
   2 pattern).

A signal that doesn't fit (1) and can't be made to fit via
Standardisation 1 or 2 isn't a candidate projection — it stays in
its manager and is documented in the drop list above.

### Wall-clock `AnimationCompleted` alignment

- `AnimationStarted({ref, msgType})` is emitted SYNC (right after
  dispatch).
- `AnimationCompleted({ref, msgType})` is emitted by
  `QueueRunner.onStepSettled(event, ref)` at the REAL wall-clock end
  of the awaited step (Promise.race resolve OR setTimeout fire). The
  runner reads the orchestrator's `_transport_lastDispatchedRef`
  synchronously after `handleEntry` returns. Captured at that moment
  so the NEXT handleEntry doesn't overwrite the ref before
  `onStepSettled` fires.

In a `group` directive, the inner events go through `processEvent`
directly (not `handleEntryAndAwait`) ; a `pendingCompletions` array
captures each event's ref + `AnimationCompleted` is emitted for every
event after the group's `Promise.all` resolves.
