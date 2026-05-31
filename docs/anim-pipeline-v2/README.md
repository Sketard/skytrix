# Animation Pipeline v2 — Lots shippés (α + β)

Consolidated history and design notes for the `anim-pipeline-v2`
chantier on branch `feat/anim-pipeline-v2`. This document is the
**archive** of the 5 lots' implementation details, edge cases, and
historical context. The **invariants still active** for new
development live inline in `CLAUDE.md` (see "Animation Pipeline v2"
section there for the TOC + load-bearing rules).

This file is the canonical reference when you want to understand
**why** the pipeline has the shape it has — the reasoning behind each
lot, the bug classes each component closed, the trade-offs that
shaped the API. New code only needs to follow the rules pinned in
CLAUDE.md ; this file explains where those rules came from.

---

## Pipeline Signal Tagging Convention (α.1, 2026-05-25)

Every `signal()` declared under `front/src/app/pages/pvp/` MUST declare
its nature so a code reviewer can answer "projection / @Environment /
transport state?" without archaeology. Enforced by the custom ESLint
rule `skytrix-pipeline/pipeline-signal-tagged`
(`eslint-plugins/pipeline-signal-tagged/`).

Three tags + one escape hatch:

1. **`_transport_<name>`** — internal transport state (queue pointers,
   timer flags, debounce counters). Never read by UI templates. **Strict
   prefix** (P8 hardening 2026-05-26): `_transport_*` only, no
   `transport_*` without leading underscore.
2. **`<name>Source`** — `@Environment` input (OS setting, user prefs,
   session config). Read-only from the pipeline's POV. **Module-scope
   only** (P8 hardening): a `*Source` declared inside a function/method
   body is no longer a valid tag — close the loophole that let local
   variables (`const mySource = signal(0)`) silently pass. Top-level
   `const`/`readonly` properties stay valid.
3. **Property of a class that `extends BaseProjection<T>` or
   `implements ResetTarget`** — every other signal MUST live inside a
   registered projection (cf. α.2 + α.4). The class membership is the
   tag. **Import required** (P8 hardening): the tag class name must be
   imported from `projections/` (barrel or `base-projection`/`reset-target`
   directly). A local `class BaseProjection {}` declared in the same
   file does NOT auto-tag — guards against shadowing the canonical type.
4. **`// eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged`**
   — escape hatch for the rare legitimate exception. Add a `// why:`
   sibling comment explaining the carve-out (lint doesn't enforce the
   sibling — code review does).

The rule also recognises late-bound assignment patterns inside a
tagged class — `this.x = signal(...)` (constructor), `x = signal(...)`,
and `return signal(...)` from a method body all inherit the class tag
(P8 hardening). The previous rule treated them as anonymous and emitted
`untaggedAnonymousSignal`.

The rule has a **baseline** at
`eslint-plugins/pipeline-signal-tagged/allowed-files.json` listing
files that were untagged when the rule landed (α.1). Story α.7 shrinks
that list to zero as it migrates the legacy signals. New files in
`pvp/` are checked from creation — there's no "I'll tag it later"
window.

Regenerate the baseline (after taging a batch of legacy files) with
`node front/eslint-plugins/pipeline-signal-tagged/regenerate-baseline.mjs`.
Rule unit tests live in
`eslint-plugins/pipeline-signal-tagged/__tests__/rule.spec.mjs` —
run via `node --test`.

---

## Projection Infrastructure (α.2 + α.4a, 2026-05-25)

`front/src/app/pages/pvp/projections/` holds the base infrastructure
for flux-state resets and read-only projections. Cf.
`_bmad-output/planning-artifacts/duel-session-chantier.md §3.5`.

**Two contracts, layered**:

- **`ResetTarget`** (interface, α.4a) — minimal contract for any
  flux-state holder that needs to participate in scope resets. Two
  members: `readonly scope: ScopeCategory` + `applyReset(scopes,
  payload?)`. Implemented by **managers in transition** that mix YGO
  business + transport + exposed signals in the same class
  (`ChainResolutionManager`, `LpAnimationTracker`,
  `BattleAnimationTracker`, `DuelGameLogService`). Wired at α.4b.
- **`BaseProjection<T>`** (abstract class, α.2) — a strict superset of
  `ResetTarget` (`BaseProjection<T> implements ResetTarget`). Adds
  `readonly value: Signal<T>` + `applyEvent(FluxEvent)`. Models a pure
  **deterministic read-only view of the flux + perspective** — what
  the §3.9 ~10 projections will be. **Not yet used** at α.4 because
  the existing managers are not at that purity; β.3 will extract
  proper `BaseProjection` subclasses from the manager signals.

**Sequence**:
1. α.4b — managers implement `ResetTarget` (declare scope, refactor
   `reset()` into `applyReset(scopes, payload?)`).
2. β.3+ — read-only signals get extracted as proper
   `BaseProjection<T>` subclasses, separate from the manager that
   writes them.

**Other members**:

- **`ScopeCategory`** (`scope.ts`) — `'SESSION_LIFETIME' |
  'DUEL_LIFETIME' | 'CONNECTION_LIFETIME' | 'PERSPECTIVE_LIFETIME'`.
  Ordered top-down in `SCOPE_HIERARCHY`. Invalidating a scope cascades
  to every scope below it via `expandInvalidatedScopes(set)`. **P9
  hardening (2026-05-26)**: the algorithm anchors on the **shallowest**
  (most durable) entry in the input and fills every scope strictly
  below it — so non-contiguous inputs like `{SESSION, CONNECTION}`
  expand to `{SESSION, DUEL, CONNECTION, PERSPECTIVE}` (DUEL no longer
  silently dropped). Today's callsites pass single-element sets, so
  the change is observation-equivalent for production; the new
  contract becomes load-bearing when β.3 checkpoint payloads bundle
  multiple boundary scopes.
- **`ScopeResetDispatcher`** (`@Injectable`, provided at duel-page
  component level) — registry + fan-out. `register(target)` accepts
  any `ResetTarget` (including `BaseProjection` subclasses); checks
  scope is a known category via `duelAssert` (dev throws / prod warns).
  `dispatch(scopes, payload?)` expands then calls `applyReset` on
  every registered target whose scope is in the expanded set.
  Idempotent register; silent unregister.
- **`CheckpointPayload`** — forwarded by `dispatch` only for §3.6
  checkpoints (`STATE_SYNC` / `RematchStarted`). Shape is `{ source,
  body: unknown }` at α.2; each target narrows on its own. Concrete
  schema will be pinned when the first consumer lands (β.3).
- **`FluxEvent`** — alias of the legacy `StreamEvent` at α.2. The union
  will grow as α.3 adds transport events, β.1 adds boundary events, β.2
  adds deferred events. Adding a member requires every `applyEvent`
  switch to remain exhaustive (TS `never` default arm catches it).

The lint rule `pipeline-signal-tagged` already recognises `extends
BaseProjection` by name — new projection files are auto-tagged the
moment they subclass it (option c in the rule). Internal registry
structures inside the dispatcher are prefixed `_transport_*` (option a).

---

## BoundaryProcessor (β.1, 2026-05-26)

`BoundaryProcessor` (`boundary-processor.ts`) is a plain class owned
privately by `DuelEventProcessor` that emits explicit causal-group
boundary markers on the EventStream. Cf. `duel-session-chantier.md
§3.8`. Three pairs, all flat by OCGCore guarantee — chains never
nest, turns never overlap, phases are strictly sequential:

- `ChainStarted(chainId)` / `ChainEnded(chainId)` — encadrent les
  events d'une même chain. `chainId` = `chainIndex` of the opening
  `MSG_CHAINING`, stays fixed across multi-link chains.
- `TurnStarted(turnNumber, player)` / `TurnEnded(turnNumber)` —
  detected from BOARD_STATE `turnCount`/`turnPlayer` delta.
- `PhaseStarted(phase)` / `PhaseEnded(phase)` — detected from
  BOARD_STATE `phase` delta.

Every boundary carries `kind: 'boundary'` so consumers narrow via
`isBoundaryEvent(e)`. Boundaries live on `StreamEvent` (extended at
β.1) alongside the MSG_* family — they are NEVER enqueued for
animation, and `DuelGameLogService.notifyGameLog` filters them out
before the legacy `GameLogBuilder` (β.3+ will wire dedicated
boundary-aware projections).

**Inputs**:

- `observeMessage(msg)` — called from `DuelEventProcessor._processMessageInner`
  as the FIRST line, BEFORE any state mutation. Sync-mandatory:
  `ChainStarted(N)` emits on the stream before `MSG_CHAINING(N)`
  reaches the orchestrator's `processEvent`.
- `observeBoardState(payload)` — called from the WS adapter
  (`DuelConnection` `case 'BOARD_STATE'`, `ReplayDuelAdapter`
  `feedTransition` + `advanceStep` + `collapseRemainingSteps`)
  AFTER `syncAfterBoardState`. Turn/Phase deltas emit on the
  stream right after the board state lands.
- `forceClosure(reason)` — called from the WS adapter on STATE_SYNC,
  REMATCH_STARTING, DUEL_END. Emits `*Ended` for every open group in
  Chain → Phase → Turn order, then clears state. Lets the journal
  see the duel closure in causality order before the chain state is
  wiped.

**First-BOARD_STATE rule (Option 4, 2026-05-26)**: the very first
BOARD_STATE emits `TurnStarted(N)` + `PhaseStarted(P)` without any
preceding `*Ended`. Asymmetric by design — a duel opens with no
preceding turn/phase. Avoids the "boardActive coupling" trap (the BP
does not know about `boardActive`) and the "silent baseline" trap
(consumers would have to infer Turn 1 opening).

**Mismatch handling**: an `MSG_CHAIN_END` arriving without an open
chain emits a synthetic `ChainEnded(-1)` + `logger.warn`. Throw was
considered but rejected — legitimate queue-routing specs feed
isolated `MSG_CHAIN_END` and would crash; the journal stays
consistent via the synth, the anomaly surfaces in DevHub.

**`silentReset`** drops the BP's state WITHOUT emitting any
boundary. Called by `DuelEventProcessor.reset()` on hard teardown
(duel destroy / fresh start) — the stream subscriber dies with the
same scope, so emitting `*Ended` there would just pollute a stream
nobody reads. Use `forceClosure(reason)` from the adapter when a
§3.6 checkpoint is the actual cause and the journal should see the
closures.

---

## DeferredEffectProcessor (β.2a + β.2b, 2026-05-26)

`DeferredEffectProcessor` (`deferred-effect-processor.ts`) materialises
cross-event temporal correlations as **explicit markers on the
EventStream** instead of leaving each consumer to track them ad-hoc.
Cf. `duel-session-chantier.md §3.7` + the implementation spec at
`_bmad-output/planning-artifacts/beta-2-deferred-effect-processor-spec.md`.

The processor closes the *cost-before-overlay* bug class
**structurally** — the timing of the chain overlay vs the cost
animation is no longer a mutable flag in 5 consumers but a single
`DeferredEffect('overlay-show:N')` / `EffectReady('overlay-show:N')`
pair that projections read off the flux. Cf. memory
[[cost-before-overlay-failed-2026-05-25]] for the 4 prior attempts
that motivated the rewrite.

**β.2a shipped INFRASTRUCTURE only**: the observe loop, the timer /
collision / checkpoint / silentReset mechanics, the `ResetTarget`
integration, and an empty `RULES` table.

**β.2b adds the metier table**: 5 working rules + 5 documented stubs
in `deferred-effect-rules.ts` (`overlay-show`, `trigger-show`,
`attack-impact`, `lp-cost`, `counter-pulse`). The 5 stubs (#3
search-reveal, #4 flip-summon-trigger, #5 banish-seq, #7 equip-stat,
#8 xyz-attach) need either richer predicates or lookahead the
flux-only DEP can't express — they're deferred to β.2b-bis / β.3.
Case #11 (pile-float-cleanup) still awaits β.2c's
`TargetIndicatorManager` stream wiring.

**Three emitted event types**, all carrying `kind: 'deferred'`:
- `DeferredEffect(name, triggerRef, awaitingPredicate)` — a rule's
  trigger fired; the processor is now watching for an event matching
  the predicate.
- `EffectReady(name, triggerRef)` — a flux event matched the
  predicate; consumers can now treat the deferred as resolved.
- `EffectAbandoned(name, triggerRef, reason)` — the deferred was
  closed without a match. `reason: 'timeout'` (no match within
  `DEFERRED_TIMEOUT_MS = 5s`) or `'checkpoint'` (a §3.6 reset wiped
  every pending deferred).

Discriminator: every event carries `kind: 'deferred'` so consumers
narrow via `isDeferredFluxEvent(e)`. Deferred events live on
`StreamEvent` (extended at β.2a) alongside the MSG_* family — they
are NEVER enqueued for animation, and `DuelGameLogService.notifyGameLog`
filters them out before the legacy `GameLogBuilder` (β.3+ will wire
dedicated projection consumers).

**Wiring** (different from β.1 BP): the DEP is owned by
`AnimationOrchestratorService`, NOT `DuelEventProcessor`. Reason:
the DEP must observe the SAME convergence point that sees WS
messages AND boundary events AND runner transport events in arrival
order — that point is the orchestrator's `pushToStream`.
Instantiating inside the processor (like the BP) would miss the
runner half of the stream. The two patterns are not the same because
the two scopes are not the same.

**Reset scope**: `CONNECTION_LIFETIME`. `PerspectiveSwitched`
(PERSPECTIVE-only, deeper) does NOT abandon open deferreds —
deferreds survive the switch (spec §3.7bis lifecycle bullet). A
checkpoint dispatch (`STATE_SYNC` / `RematchStarted` → DUEL cascading
to CONNECTION) emits `EffectAbandoned(reason='checkpoint')` for
every active deferred in insertion order, then clears the internal
map + timers.

**`silentReset`** drops state + timers WITHOUT emitting any
`EffectAbandoned`. Mirror of `BoundaryProcessor.silentReset`: called
by `AnimationOrchestratorService.destroy()` on hard teardown
(duel destroy / fresh start) where the stream subscriber dies with
the same scope, so emitting closures would just pollute a stream
nobody reads. Use `applyReset({CONNECTION_LIFETIME})` via the
dispatcher when a §3.6 checkpoint is the actual cause and the
journal should see the closures.

**Collisions of `name`** are an invariant violation: `duelAssert`
throws in dev; in prod the older entry is abandoned with
`EffectAbandoned(reason='timeout')` and a `logger.warn`. The rules
table guarantees uniqueness by including index / chainIndex / ref in
each name (`overlay-show:<chainIdx>`, `banish-seq:<ref>:<n>`, …).

**Convergence point — `pushToStream` (β.2a)**: the orchestrator
exposes a single public `pushToStream(event)` method (γ-c cleanup
F-1.2 made it public, retiring the redundant `notifyOutOfBandEvent`
wrapper) that both appends to `_eventStream` and calls
`deferredProcessor.observe(event)`. Four call sites converge here:
the in-queue tap inside `processEvent`, the page-bootstrapped
out-of-band sink (boundary events + MSG_CHAIN_NEGATED + SELECT_CARD
+ synthesized MSG_WIN from DUEL_END), and the
`QueueRunner.onInternalEvent` sink (β.2a absorbs the α.3 sink onto
the stream, closing the W1 code-review finding). The DEP's own
emissions go through `pushDeferredToStream` which **bypasses the
observe re-entry guard** — an emitted `EffectReady` must not be
re-fed to the DEP that emitted it.

**β.2b — central monotonic ref**: `pushToStream(event)` returns the
monotonic `ref` it just assigned, and forwards `(event, ref)` to
`deferredProcessor.observe`. The DEP stores the ref as the deferred's
`triggerRef`; the orchestrator stashes it on a private side-channel
(`_transport_lastDispatchedRef`) so `_dispatchEvent` /
`processDirective.group` can emit `AnimationStarted({ref, msgType})`
+ `AnimationCompleted({ref, msgType})` around the business handler.
A rule's `chainTo` callback receives `(matchedEvent, matchedRef,
deferred)` and typically returns
`{kind:'animation', type:'AnimationCompleted', ref: matchedRef}` so
the deferred is closed only when the SPECIFIC matched event's
animation completes. The ref counter resets in `resetAllState` so a
rematch / state-sync starts fresh.

**β.2b — AnimationStarted/Completed emission is SYNCHRONOUS** today:
the orchestrator pushes both events immediately after `processEvent`
returns. This keeps the DEP's relative-order semantics correct (the
test of victory verifies the stream sequence, not wall-clock
timing). β.3 will hook the runner's `onStepSettled` so the
AnimationCompleted aligns with the actual travel completion — needed
once a projection consumes EffectReady to gate a real visual.

**β.2b — rule contract** (`deferred-effect-rules.ts`): each rule
declares `trigger / deriveName / derivePredicate` and an optional
`chainTo`. The rule reference is stored on the active deferred so
`tryRearm` reaches `chainTo` in O(1). Five rules ship (#1 overlay-
show compound, #2 trigger-show self-ref, #6 attack-impact, #9
lp-cost, #10 counter-pulse); the other six are documented stubs
inline (search the file for `**#3` through `**#11`).

**β.2b — what overlay-show catches and misses**: the rule predicate
narrows on `player + cardCode` of the chaining card. This covers
hand traps activated as their own cost (Ash Blossom, Effect Veiler,
Ghost Ogre, Maxx "C", Droll & Lock Bird). It MISSES chains whose
cost is a DIFFERENT card (Solemn series banishing a board monster,
Pot of Desires banishing 10 deck cards) — those would need per-card
narrowing in β.x.

---

## Projections β.3 (Lots 1-4, 2026-05-26)

First production `BaseProjection<T>` family of the DEP flux + the
wall-clock alignment of `AnimationStarted` / `AnimationCompleted`
needed for the cost-before-overlay fix to be USER-VISIBLE (β.2b only
made it DEP-correct, the visual overlay still popped early because the
emission was sync at dispatch).

**Lot inventory** — 8 projections live in `front/src/app/pages/pvp/projections/`,
each `extends BaseProjection<T>` and is registered + attached on
`_eventStream` by the orchestrator's constructor (search for
`scopeDispatcher?.register`). All `PERSPECTIVE_LIFETIME` scope.

| Lot | Projection | Source events | Clear path |
|---|---|---|---|
| 1 | `OverlayShowReadyProjection` | `EffectReady` / `EffectAbandoned` ('overlay-show:chain-N') from DEP | `ChainEnded(N)` boundary + applyReset |
| 2.3 | `CounterPulseProjection` | `MSG_ADD_COUNTER` / `MSG_REMOVE_COUNTER` | `AnimationCompleted({msgType ∈ COUNTER_MSG_TYPES})` |
| 2.6 | `AnimatingZoneProjection` | `MSG_FLIP_SUMMONING` / `MSG_CHANGE_POS` (FD→FU) / `MSG_CHAINING` (with zoneId) | `AnimationCompleted({msgType ∈ ZONE_MSG_TYPES})` |
| 3.1 | `IsAnimatingProjection` | `runner-started` / `runner-stopped` (InternalTransportEvents) | applyReset |
| 2.4-REDO | `SwapGraveDeckProjection` | `MSG_SWAP_GRAVE_DECK` | `AnimationPhaseCompleted({phase: 'glow'})` (Standardisation 1) |
| 2.2-REDO | `AnimatingLpProjection` | `MSG_DAMAGE` / `MSG_RECOVER` / `MSG_PAY_LPCOST` decorated with `lpDelta` (Standardisation 2) | `AnimationCompleted({msgType ∈ LP_MSG_TYPES})` |
| 4.1-REDO | `TargetedZoneKeysProjection` | `MSG_BECOME_TARGET` (FIELD locations only, union accumulation) | `AnimationPhaseCompleted({phase: 'reticle-pulse'})` (Standardisation 1) |

Slot 3.2-REDO is intentionally absent from this table — see the
`chainResolutionAnnounce` dedicated subsection below (Lot 3) for the
unified-signal pattern that replaced it.

**Drops (signaux définitivement NON migrés en projection, par
design)** — voir la section "Doctrine projection vs signal manager"
ci-dessous pour les critères. Deux cas droppés en β.3 :
- `chainOverlayBoardChanged` (Lot 2.1) — supprimé, remplacé par
  `chainManager.hasBufferedEvents` (getter dérivable, équivalent
  strict au moment de la lecture par `replayAndPause`).
- `confirmRevealedCards` (Lot 2.5) — orphelin big-bang (déclaré
  jamais set en prod). 3 mécaniques alternatives couvrent reveal :
  chain-tagged hand badges, `confirmCardsInHand` flip,
  `revealCardOnDeck`.

**Cas dual-purpose collapsé** — `chainResolutionAnnounce` is a single
`signal<boolean>` privately owned by `ChainResolutionManager` that
serves BOTH a sync predicate (`handleSolving`) and a reactive UI
surface (templates + Effect D in `pvp-chain-overlay`). See the
`chainResolutionAnnounce` subsection below for the contract +
Doctrine 3-bis for the rule that motivated keeping it as a single
signal (split-brain projection + private mirror is fragile by
parallel-feed construction).

Other cleanups in the same chasse-aux-sorcières pass : the
`_entryAnimInProgress` flag in chain-overlay (mirror of
`entryTimerId !== null`, Lot 2.1bis) and the redundant `hasLockedZones`
signal on the RBS (now a `_locks.size > 0` getter, Lot 4) were dropped
for the same reason.

### `OverlayShowReadyProjection`

`projections/overlay-show-ready.projection.ts` — extends
`BaseProjection<ReadonlySet<number>>`, scope `PERSPECTIVE_LIFETIME`.
Accumulates the `chainId`s for which the overlay is allowed to appear:
- `EffectReady('overlay-show:chain-<N>')` (from the DEP) → add N.
- `EffectAbandoned('overlay-show:chain-<N>')` → also add N (graceful
  degradation: a timeout / checkpoint means "stop waiting, just show
  it"; better than a never-showing overlay).
- `ChainEnded(N)` (boundary) → remove N.
- `applyReset({PERSPECTIVE_LIFETIME})` → clear.

Owned by `AnimationOrchestratorService` as a `readonly` field, auto-
registered with the scope dispatcher AND attached to the orchestrator's
`_eventStream` via `BaseProjection.attachEventStream(stream, injector)`.
Detached in `destroy()`.

### Consumer wiring — `pvp-chain-overlay.component`

The `onNewChainLink` handler used to set `overlayVisible=true` SYNCHRONOUSLY
on every MSG_CHAINING with link ≥ 2 — exactly the cost-before-overlay
bug. β.3 splits the show into two helpers:
- `_runOverlayShowSequence()` — the body that was inline (set overlay,
  mark entry anim in progress, schedule fade-out).
- `_gateOverlayShowOnReady(chainIndex)` — checks `orchestrator.overlayShowReady.isReady(chainIndex)`:
  - True → fire `_runOverlayShowSequence` immediately (cost finished
    before MSG_CHAINING — pathological but legal).
  - False → install a one-shot `effect()` that watches
    `overlayShowReady.value()` and fires the sequence the moment
    `chainIndex` appears. The previous effect is destroyed on every new
    chain link (no stacking on bursts) and on `onChainEnd` / destroyRef.

The burst-detection path (entry anim still in progress) is unchanged —
it doesn't gate, because the overlay is already up.

### `BaseProjection.attachEventStream(stream, injector)` (β.3)

`base-projection.ts` was extended with the glue every projection needs:
an `effect()` that drains `stream()` through `applyEvent` in arrival
order. The `_transport_streamConsumedLength` cursor + length-regression
sync mirror the `DuelGameLogService.attachEventStream` pattern from
palier 0 (the GLS predates β.3 and has its own copy — left as-is, β.x
could DRY it). Required `injector` because `BaseProjection` is a plain
class (constructable outside an injection context — e.g. in tests),
so `effect()` needs an explicit injector.

### Wall-clock `AnimationCompleted` alignment

β.2b emitted both `AnimationStarted` and `AnimationCompleted` SYNCHRONOUSLY
after `processEvent` returned — DEP-correct (relative order on the stream
holds) but the user-visible timing was wrong because EffectReady fired
the same frame as the cost MSG_MOVE. β.3 splits the pair:
- `AnimationStarted({ref, msgType})` stays sync (right after dispatch).
- `AnimationCompleted({ref, msgType})` is emitted by
  `QueueRunner.onStepSettled(event, ref)` at the REAL wall-clock end of
  the awaited step (Promise.race resolve OR setTimeout fire). The
  callback signature was widened from `() => void` to
  `(event, ref) => void`, and `QueueRunnerDeps.getLastDispatchedRef`
  was added (optional, defaults to `() => null`) so the runner reads
  the orchestrator's side-channel `_transport_lastDispatchedRef`
  synchronously after `handleEntry` returns. Captured at that moment
  so the NEXT handleEntry doesn't overwrite the ref before
  `onStepSettled` fires.

In a `group` directive, the inner events go through `processEvent`
directly (not `handleEntryAndAwait`); a `pendingCompletions` array
captures each event's ref + the `AnimationCompleted` is emitted for
every event after the group's `Promise.all` resolves.

### Lot 2 projections — pure flux consumers

**`CounterPulseProjection`** (Lot 2.3) —
`projections/counter-pulse.projection.ts`. Tracks the zone key whose
counter badge is pulsing. Constructor deps: `relativePlayer`,
`reducedMotion`. Double-set null→key trick preserved for CSS animation
restart on consecutive same-zone events (Object.is dedup would
otherwise swallow). `handleCounter` reduced to gate + duration
return.

**`AnimatingZoneProjection`** (Lot 2.6) —
`projections/animating-zone.projection.ts`. Tracks `{zoneId,
animationType: 'flip' | 'activate', relativePlayerIndex}` for the
field zone playing a flip or activate animation. Three handlers
(`handleFlipSummoning`, `handleChangePos`, `handleChaining`) no
longer call `setAnimatingZone(...)` — the projection self-sets.
MSG_CHANGE_POS narrowing on face-down → face-up branch preserved;
MSG_CHAINING narrowing on non-empty `locationToZoneId` preserved
(HAND-activated cards already use `boardEffects.activateEffect` on
the hand element).

**`AnimatingLpProjection`** (Lot 2.2-REDO) —
`projections/animating-lp.projection.ts`. Tracks `{player, fromLp,
toLp, type, durationMs}` for the LP counter animation. The
projection reads `lpDelta` from the decorated event (cf.
Standardisation 2 below), so no `trackedLp` duplication on the
projection side. Lives on the `LpAnimationTracker`; the
`animatingLpPlayer` field on the tracker is now an alias for
`animatingLpPlayerProjection.value` (back-compat for templates).

**`SwapGraveDeckProjection`** (Lot 2.4-REDO) —
`projections/swap-grave-deck.projection.ts`. Tracks `{GY-rel,
DECK-rel}` keys during the glow sub-phase of `MSG_SWAP_GRAVE_DECK`.
Cleared by `AnimationPhaseCompleted({phase: 'glow'})` emitted by
`phaseWait` (cf. Standardisation 1 below) — the boundary between
phase 1 (glow) and phase 2 (travel).

### Lot 3 projections — transport surface

**`IsAnimatingProjection`** (Lot 3.1) —
`projections/is-animating.projection.ts`. Tracks the `QueueRunner`'s
`_isRunning` flag via `runner-started` / `runner-stopped`
InternalTransportEvents (absorbed onto the stream by β.2a's W1
finding). The `onIsRunningChange` callback no longer sets a signal
— it only fires `dataSource.setAnimating(running)` (imperative
side-effect that drives `advanceStep` in replay).

**Sync vs async timing audit** — the legacy `_isAnimating.set(...)`
flipped synchronously with the runner; the projection observes the
flip through an Angular `effect()` (one micro-task lag). Four
audited readers tolerate the lag: `PollDropWatchdog.arm()` getter
(poll-driven), chain-resume effect (reactive to
`chainOverlayReady`), prompt-derivation computed (reactive),
animation-bridge effect (reactive to `logicalState`). If a NEW
SYNCHRONOUS reader is introduced, either wrap in
effect/computed/timer, OR break the abstraction with a sync-tap
method (discuss before).

**`chainResolutionAnnounce`** (F15, 2026-05-31) — single
`signal<boolean>` privately owned by `ChainResolutionManager`
(`_announcing`), exposed as `chainResolutionAnnounce: Signal<boolean>`
via `asReadonly()`. Set sync via `markAnnouncePending()` (called from
the orchestrator's `announcement` directive `onShow` callback) ;
cleared in `reset()` / `handleEnd` / `applyReset()`. Serves BOTH the
sync predicate inside `handleSolving`'s first-link multi-link branch
(via the manager's internal `_announcing()` direct call) AND the
reactive UI surface (templates + Effect D in `pvp-chain-overlay`, via
the exposed readonly Signal). `get isAnnouncePending(): boolean` is
kept as a sync alias on the manager for test introspection.

**NOT a projection by design** — see Doctrine 3-bis. A single dual-use
signal beats a projection + private mirror split-brain (the
parallel-fed pair was shipped at β.3 Lot 3.2-REDO and rolled back at
F15 after F-bugB4 surfaced an infinite re-deferred loop caused by
transient divergence between the two writers).

### Lot 4 projection — RMW + sub-step boundary

**`TargetedZoneKeysProjection`** (Lot 4.1-REDO) —
`projections/targeted-zone-keys.projection.ts`. Tracks the FIELD
zone keys (`${zoneId}-${relPlayer}`) targeted by an in-flight
MSG_BECOME_TARGET cascade. Pile-zone targets (HAND/GY/Banished/Extra/
Deck/Overlay) are filtered out — pile-zone targets are surfaced as
float overlays by `TargetIndicatorManager` (separate concern; pile
zones only render their top card).
- Set path: `MSG_BECOME_TARGET` → union the FIELD keys (MZONE/SZONE
  only) onto the running set. Accumulation REQUIRED across
  back-to-back MSG_BECOME_TARGET (one per card, common when an
  effect targets a group).
- Clear path: `AnimationPhaseCompleted({phase:'reticle-pulse',
  msgType:'MSG_BECOME_TARGET'})` emitted by the handler via
  `phaseWait('reticle-pulse', holdMs, 'MSG_BECOME_TARGET')`.
- applyReset → set empty.

The handler `handleBecomeTarget` keeps the pile-float side-effect
(`targetIndicator.spawnPileFloats`) and the numeric duration return
(stagger vs final hold); it no longer reads/writes the projection
state, and the inline `setTimeout(clear, holdMs)` is replaced by the
fire-and-forget `void phaseWait(...)`. The pile-float fade-out
outlives the reticle pulse — `AnimationPhaseCompleted` clears the
field reticles at the pulse boundary, the pile floats fade past it.

### Standardisation 1 — `phaseWait` + `AnimationPhaseCompleted`

`phaseWait(phase: string, durationMs: number, msgType: string):
Promise<void>` on the orchestrator combines a tracked
`scheduleTimeout` wait + a stream push. Emits
`AnimationPhaseCompletedEvent({kind: 'animation', type:
'AnimationPhaseCompleted', phase, msgType, ref})` once the timer
fires. The `ref` is captured from `_transport_lastDispatchedRef` at
phaseWait call time (synchronous prefix of the async handler — the
side-channel is still pinned to the parent business event before
any await).

**Use-case**: handlers with INTERNAL sub-phases ending before the
overall animation completes (`MSG_SWAP_GRAVE_DECK`'s glow finishes
mid-handler before the travel). Projections observing the phase
boundary clear at the sub-step instead of waiting for the runner's
final `AnimationCompleted`.

**Caller's responsibility**: playback-speed scaling of `durationMs`
(typically via `ctx.scaledDuration(BASE, MIN)`) — symmetric with the
runner's already-scaled durations.

### Standardisation 2 — `decorateLpEventForStream` + `peekLpDelta`

`LpAnimationTracker.peekLpDelta(player, amount, type) → {fromLp,
toLp, durationMs}` is a pure read of the tracker's `trackedLp` —
NEVER mutates. The orchestrator's
`decorateLpEventForStream(event)` shallow-clones MSG_DAMAGE /
MSG_RECOVER / MSG_PAY_LPCOST with `lpDelta` attached, called BEFORE
`pushToStream` in `processEvent`. The dispatch switch subsequently
calls `processLpEvent` which re-uses the SAME `_computeLpArithmetic`
private helper (R1 mitigation) and applies the mutation.

**Order contract** — `peekLpDelta` MUST run BEFORE
`processLpEvent`. If swapped, `fromLp === toLp` → silent animation
freeze. Pinned by the spec
`lp-animation-tracker.spec.ts` "β.3 R4" test pair (positive +
regression). The orchestrator's `processDirective.case 'lp'` path
follows the same contract for buffered LP replay.

### Doctrine — projection vs signal manager

Not every signal in the pipeline is a candidate projection. The
β.3 chasse aux sorcières established two rules:

1. **A projection is dérivable du FLUX** — its value is a pure
   function of `(EventStream history, perspective, environment)`.
   Adding `BaseProjection<T>` is correct when the source data lives
   in events the pipeline already pushes.

2. **A signal manager is dérivable du STATE** — its value is a
   pure function of internal mutable state (a Map, a buffer, a
   counter) that lives in a manager. Examples that stayed managers
   in β.3: `chainOverlayBoardChanged` (was a mirror of
   `_bufferedBoardEvents.length > 0` — replaced by
   `hasBufferedEvents` getter). `hasLockedZones` on the RBS (now a
   getter `_locks.size > 0`).

3. **Sub-step timers internal to a handler** — when a signal
   clears via `setTimeout(...)` mid-handler (BEFORE the final
   `AnimationCompleted`), it needs Standardisation 1 (`phaseWait` +
   `AnimationPhaseCompleted`) to become migrable. Otherwise it
   stays in its manager. Examples migrated: `swapGraveDeckKeys`
   (phase `'glow'`), `targetedZoneKeys` (phase `'reticle-pulse'`,
   Lot 4.1-REDO).

3-bis. **Dual-purpose signal — reactive UI + sync predicate** —
   when a single signal serves BOTH a reactive Angular template /
   effect AND a synchronous predicate inside a manager method, do
   NOT split into a projection + private mirror pair. Keeping two
   writers in lock-step is fragile by construction — they may agree
   within a tick today but skew under any future timing change
   (F-bugB4 2026-05-31 surfaced an infinite re-deferred loop caused
   by exactly this skew). The correct shape is a single `signal<T>`
   owned by the manager, read sync via direct call for the predicate
   AND exposed as readonly via `asReadonly()` for the reactive
   surface. The manager handles its own `applyReset`; no
   projection-class wrapping needed. Reference implementation:
   `chainResolutionAnnounce`.

4. **External state dependency** — when a signal value depends on
   state outside the projection (e.g., LP's `fromLp` depending on
   `trackedLp`), the orchestrator decorates the event at push time
   so the projection consumes a self-contained payload
   (Standardisation 2 pattern).

A signal that doesn't fit (1) and can't be made to fit via
Standardisation 1 or 2 isn't a candidate projection — it stays in
its manager and is documented in this file's drop list.
