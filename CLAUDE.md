# Project Instructions

## Code Quality

When writing or modifying code, always apply the `clean-code` and `code-principles` skills to enforce DRY, KISS, SRP, YAGNI, and Miller's Law thresholds.

## Design System & Styling Conventions

The front-end has a custom Design System. **Before writing ANY UI, read
`front/DESIGN-SYSTEM.md`** — it is the canonical component catalogue
(triage of the 36 `components/`, per-component API, usage rules). Styling
rules are enforced by `stylelint` + ESLint + a pre-commit hook
(`scripts/hooks/`, activated via `core.hooksPath`); full lint reference:
`front/LINTING.md`.

Non-negotiable rules (full detail in `DESIGN-SYSTEM.md`):

- **Use DS components, never ad-hoc HTML/SCSS.** Buttons / pills / chips /
  toggles / form controls are Angular components (`<app-button>`,
  `<app-icon-button>`, `<app-pill>`, `<app-chip>`, `<app-seg-button>`,
  `<app-input>`, `<app-checkbox>`, `<app-toggle-switch>`, …), NOT global
  SCSS classes. Never `<button class="…">`, never `mat-*-button` /
  `<mat-chip>` (MDC layer). `.badge` stays a global class (`_badge.scss`,
  single consumer).
- **Colors** → always a token `var(--…)`. Literal hex only in
  token-defining files (`front/src/app/styles/**`, `_sim-tokens.scss`,
  `simulator-page.component.scss`). `--gold` = background/accent/border/
  glow; `--gold-on-surface` = gold text/icon `color:`.
- **`mat-icon` sizing** → `@include icon-size($size, $line-height?)` from
  `styles/mixin.scss`. Never re-write the `font-size/width/height
  !important` trio by hand.
- **`::ng-deep`** → forbidden in components. Non-encapsulated CDK/Material
  → `styles/_cdk-overrides.scss`; child component → a variant `input`.
- **Host-wrapper contract** (button/pill/chip/seg/input/checkbox) — a
  parent SCSS override of chrome (padding, bg, hover, `:disabled`) MUST
  target the inner `.btn__el` / `.icon-btn__el` / etc.; size contracts
  (`min-height`, `width`) stay on the host.
- **`!important`** → structural cases only; any `!important` outside the
  mixin needs a `// !important: why` comment.

Maintenance: any new component added under `components/` MUST be added to
`front/DESIGN-SYSTEM.md` (category + API) — there is no sync script.

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

`DuelEventProcessor` is the single source of truth for chain state
management (activeChainLinks, chainPhase, animation queue, chain entry
commit). Ownership rules (γ-c PR2 c8, 2026-05-29) :

- **PvP normal** : the `DuelWebSocketService` ctor builds a default
  `DuelConnection` which owns its processor outright. Lifetime = the
  wsService's component scope.
- **SOLO multiplex** : `SoloDuelOrchestratorService.init` builds ONE
  `DuelConnection` (mono-conn, post-c6a) which owns its processor
  outright, then swaps it into the wsService via `bindSoloConnection`.
  Both perspectives are projected from the same `_slots[0|1]` on this
  SAME conn — the cardinal γ invariant that eliminates the
  `bug-solo-sequence.md` chain-orphan bug structurally (a
  `switchPerspective` no longer routes future messages to a different
  processor — there is only one). The default conn built by the
  wsService ctor is orphaned and `cleanup()`-ed by `bindSoloConnection`.
- **Replay** : `ReplayDuelAdapter` owns its processor outright (separate
  scope, no SOLO/PvP interaction). γ does not touch the replay path.

The `sharedProcessor` ctor option on `DuelConnection` was dropped in
PR2 c8 — there is no longer a "processor shared across multiple
conns" model. Every `DuelConnection` instance owns its processor ;
the consolidation happened by collapsing to 1 conn, not by sharing.

No manual PvP/replay parity is required — the processor guarantees
identical behavior across both modes.

`MSG_CHAIN_NEGATED` is consumed silently by the processor (sets `negated`
flag on the matching chain link) — it is NOT pushed to `animationQueue`.
It IS pushed to `AnimationOrchestratorService.eventStream` via
`DuelEventProcessor.onEvent` so the Game Log sees the "Nié" badge in PvP
live (Palier 0).

## Transport Lifecycle Invariants

Two load-bearing invariants the γ-c bootstrap relies on. Both are
implicit today (enforced by code structure + comments) — documenting
them here so a future refactor that breaks them gets caught at review.

**Invariant 1 — `DuelConnection.cleanup()` MUST stay idempotent + safe
without prior `connect()`.** The `DuelWebSocketService` ctor builds a
default `DuelConnection` even in SOLO mode (where it's immediately
orphaned and `cleanup()`-ed by `bindSoloConnection`). On top of that,
SOLO teardown can fire `cleanup()` twice on the same conn (once via
`SoloDuelOrchestratorService.cleanup`, once via
`DuelWebSocketService.ngOnDestroy` — see [F-3.3]). Both work today
because `cleanup()` is null-safe (no-op WS close, RBS destroy is
idempotent, timer slots check before clear). Any future addition to
`cleanup()` (Datadog counter, listener removal that throws on missing
listener, …) MUST preserve both properties or the SOLO bootstrap +
teardown paths break silently.

**Invariant 2 — `DuelConnection.soloMode` and `_duelCtx` MUST be set
together before `connect()`.** A conn with `soloMode = true` and
`_duelCtx === undefined` throws via `duelAssert` at the first
BOARD_STATE through `_shouldSwapForSolo`. The reverse (`soloMode =
false` with `_duelCtx` set) is harmless but pointless. Currently the
"pair flip A21" is enforced by `SoloDuelOrchestratorService.init`
calling both at construction in the SAME statement chain, then doing
`wsService.setSoloMode(true)` before `conn.connect(token)`. Anyone
adding a third SOLO-only field to `DuelConnection` MUST honour the
same "set before connect" discipline ; the cleanest long-term fix is
to derive `soloMode` from `wsService.soloModeSource` as a getter
(audit P1 [F-2.3] — noted as a c8 cleanup that never landed).

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
    `ReplayDuelAdapter.attachOutOfBandSink`); `DuelConnection`
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

(F15, 2026-05-31) — `ChainResolutionAnnounceProjection` (3.2-REDO) was
collapsed into a unified `signal<boolean>` on `ChainResolutionManager`;
see "Cas dual-purpose collapsé" below + the dedicated subsection. The
slot is intentionally retired from this table.

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

**Cas dual-purpose collapsé (F15, 2026-05-31)** —
`chainResolutionAnnounce` était un signal *dual-use* : Effect D
réactif côté UI ET predicat sync côté `handleSolving`. β.3 Lot
3.2-REDO l'avait migré en split-brain (projection
`ChainResolutionAnnounceProjection` pour la surface réactive +
`_announcePending: boolean` privé pour le predicat sync, alimentés
en parallèle par le même `pauseMs` timer). F15 retire le split-
brain : la projection est supprimée et le state vit comme un
unique `signal<boolean>` privé sur le manager
(`_announcing`), exposé en `asReadonly()` pour la surface
réactive ET lu en sync via `_announcing()` pour le predicat. Le
split parallel-feed était fragile par construction (F-bugB4
2026-05-31 a exposé une divergence transitoire qui causait une
boucle infinie dans le queue runner). Doctrine 3-bis mise à jour
en conséquence.

Le pattern `_entryAnimInProgress` du composant chain-overlay a aussi
été dropé (mirror de `entryTimerId !== null`, Lot 2.1bis) + le
`hasLockedZones` signal redondant du RBS converti en getter dérivé de
`_locks.size > 0` (Lot 4 cleanup).

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

**`chainResolutionAnnounce`** (F15, 2026-05-31 — collapsed) —
unified `signal<boolean>` privately owned by `ChainResolutionManager`
(`_announcing`), exposed as `chainResolutionAnnounce: Signal<boolean>`
via `asReadonly()`. Set sync via `markAnnouncePending()` (called
from the orchestrator's `announcement` directive `onShow`
callback) ; cleared in `reset()` / `handleEnd` / `applyReset()`.
Serves BOTH the sync predicate inside `handleSolving`'s first-link
multi-link branch (via the manager's internal `_announcing()`
direct call) AND the reactive UI surface (templates + Effect D in
`pvp-chain-overlay`, via the exposed readonly Signal).

Replaces the prior split-brain (β.3 Lot 3.2-REDO 2026-05-26): a
`ChainResolutionAnnounceProjection` stream-observer + a private
`_announcePending: boolean` mirror, fed in parallel by the same
`pauseMs` timer. F-bugB4 (2026-05-31) exposed the split-brain's
fragility — an infinite re-deferred loop in the queue runner
caused by a transient divergence between the sync mirror and the
stream-driven projection. The collapse to one signal removes the
class structurally. `get isAnnouncePending(): boolean` is kept as
a sync alias on the manager for test introspection ;
`pvp-chain-overlay` reads via `chainResolutionAnnounce()` (the
Signal direct call instead of the prior `.value()` projection
accessor).

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
   NOT split into a projection + private mirror pair. Although the
   shapes appear orthogonal (a `BaseProjection` for the reactive
   surface and a `boolean` for the sync read), keeping two copies
   of the same state in lock-step is fragile by construction — the
   two writers may agree within a tick today but skew under any
   future timing change (cf. F-bugB4 2026-05-31, where the
   parallel-fed sync mirror and stream-driven projection diverged
   and caused an infinite re-deferred loop in the queue runner).
   The correct shape is a single `signal<T>` owned by the manager,
   read sync via direct call (`this._announcing()`) for the
   predicate AND exposed as readonly via an `asReadonly()`
   accessor for the reactive surface. The manager handles its own
   `applyReset` to clear; no projection-class wrapping needed.
   Example migrated: `chainResolutionAnnounce` (F15, 2026-05-31).
   The legacy Lot 3.2-REDO "projection + mirror" pattern is RETIRED.

4. **External state dependency** — when a signal value depends on
   state outside the projection (e.g., LP's `fromLp` depending on
   `trackedLp`), the orchestrator decorates the event at push time
   so the projection consumes a self-contained payload
   (Standardisation 2 pattern).

A signal that doesn't fit (1) and can't be made to fit via
Standardisation 1 or 2 isn't a candidate projection — it stays in
its manager and is documented in this file's drop list.

## Replay Board State Parity Rule

Replay must provide equivalent intermediate board states so
`updateLogical()` + `syncRendered()` produce the same rendered state as PVP.
Replay MUST NOT call `commitAll()` (reserved for `abort()`/`jumpToState()`);
it uses `syncRendered()` to respect the lock contract.

`assertNoLocks()` surfaces lock leaks at transition boundaries and PvP
reset points via `duelAssert()`. Throws in dev, `console.error`s in prod.

**Asserted sites (7 total — F19, 2026-05-31)**, ordered by call path :

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
    commit/release in the dispatch path that triggered the reset.
- **Replay (`replay-duel-adapter.ts`)** :
  · `feedTransition()` — every new state transition starts clean.
  · `feedTransitionPhased()` — same.
  · `advanceStep` end branch — every step exhaustion finishes clean.

**Intentionally NOT asserted** (volontary skip/abort paths in replay) :

- `replay-duel-adapter.ts:collapseRemainingSteps` — user-triggered
  "skip to end" interruption. Intermediate locks from cut-short steps
  are expected and `commitAll` is the right cleanup.
- `replay-duel-adapter.ts:abort` — replay tear-down ; locks from the
  interrupted dispatch are expected.
- `replay-duel-adapter.ts:jumpToState` — user-triggered seek ; same.

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

   **Replay perspective swap** — `boardStateAfter` arrives in absolute
   server P0 order (replay precompute is perspective-agnostic). The
   orchestrator is shared with PvP and assumes already-relative data, so
   `ReplayDuelAdapter` MUST relativize the per-event snapshot for
   `perspectiveIndex === 1` — `swapEventBoardStates()` rewrites
   `event.boardStateAfter` via `swapBoardState()` at the `feedTransition`
   / `feedTransitionPhased` entry points (before `buildSteps` / processor
   feeding). `swapBoardState()` alone is NOT enough — it only covers the
   step/transition-level `boardState`, not the snapshot buried on each
   event. Skip the swap and perspective-1 replays render the board
   flipped for one frame when the orchestrator calls
   `updateLogical(event.boardStateAfter)`.

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

## Perspective Convention (absolute vs relative player index)

Two player-index referentials coexist — mixing them is a recurring bug
class ("the board briefly flips", "Equip line points at the wrong half"):

- **Absolute** — raw OCGCore index (server player 0 / 1). What the duel
  worker emits.
- **Relative** — `0` = the viewer ("me", bottom of board), `1` = the
  opponent (top). What the animation pipeline + DOM zone keys
  (`${zoneId}-${relPlayer}`) assume.

**Server-side relativization is partial.** `message-filter.ts`
`sanitizeBoardState` swaps `players[]` and `turnPlayer` to relative — but
NOT the `player` / `controller` fields buried inside cards, zones, prompt
entries, or chain links (see the Story 4.2 TODO at `message-filter.ts`).
Those stay **absolute** in both PvP and Replay.

**Replay-side swap is also partial by construction.** `ReplayDuelAdapter`
precompute data arrives in absolute server order; `swapBoardState()` swaps
`players[]` + `turnPlayer`, and `swapEventBoardStates()` swaps the
per-event `boardStateAfter`. Anything else absolute stays absolute.

**Rules:**

1. Any index used to build a DOM zone key `${zoneId}-${X}` MUST be
   relative. Convert an absolute index with the canonical idiom
   `const rel = absolute === ownPlayerIndex ? 0 : 1` (PvP/board) or
   `=== perspectiveIndex` (replay-page), or `ctx.relativePlayer(absolute)`
   inside the orchestrator/managers.
2. `DuelContext.ownPlayerIndex()` and `pvp-board-container`'s
   `ownPlayerIndex` input are **absolute** — so `absolute === ownIdx`
   comparisons are valid. In replay, `ownPlayerIndex` is fed
   `perspectiveIndex()`.
3. The prompt pipeline (`pvp-prompt-dialog` + sub-components) runs
   **fully absolute end-to-end**: `CardInfo.player`, `PlaceOption.player`,
   and the `ownPlayerIndex` it receives (`activePlayer()` = `decision.player`
   in replay) are all absolute. Do NOT relativize `activePlayer` — it would
   desync against the absolute `card.player`. Internal keys like
   `confirmedCardKeys` (`${location}-${player}-${sequence}`) are absolute on
   both sides and never hit the DOM zone registry.
4. `HintContext.player` is currently dead (never read by any renderer) —
   leave it absolute; do not build new logic on it without relativizing.

**Known-correct relativizers** (reference idiom): `chainBadges` +
`linkedZoneMap` (pvp-board-container), `target-indicator-manager`,
`prompt-derivation.service`, `replayHighlightedZones`/`replayChosenZone`
(replay-page), all `ctx.relativePlayer()` callers in the orchestrator.

**SOLO PvP — perspective is a projection signal (γ, 2026-05-27).**
`DuelContext.perspectiveSource` (tag α.1 `*Source`) is a
`WritableSignal<0 | 1>` written by `SoloDuelOrchestratorService.switchPerspective`
and read by every relativizer. A SOLO switch flips the signal +
emits `PerspectiveSwitched` on the EventStream + dispatches
`applyReset({PERSPECTIVE_LIFETIME})` — the processor state
(activeChainLinks, chainPhase, pendingChainEntry, locks, queue) is
NOT touched (CONNECTION_LIFETIME, survives). `DuelGameLogService`
re-relativises the journal entries on flip via the
`effect(() => gameLog.setPerspective(ownPlayerIndex()))` wired in
`duel-page.component.ts:575` (R10 acted at γ §8 spec). PvP normal +
replay leave `perspectiveSource` at its default 0.

**Convention §5.2 POC — révisée γ-c c10 (2026-05-29).** Le switch SOLO
n'est PAS bloqué pour TOUS les prompts pending mais seulement pour les
prompts MODAUX (`SELECT_CARD`, `SELECT_CHAIN`, `SELECT_PLACE`,
`SELECT_TRIBUTE`, …). La whitelist `IDLE_PHASE_PROMPT_TYPES` dans
[solo-duel-orchestrator.service.ts](front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts)
autorise explicitement `SELECT_IDLECMD` (Main Phase 1/2) et
`SELECT_BATTLECMD` (Battle Phase) — ces prompts sont l'état stable
d'attente du joueur actif pendant TOUTE sa phase, donc les bloquer
revient à interdire le switch tout au long du tour. Bug user-facing
remonté 2026-05-29 : "je clique P1 et rien ne se passe alors que je
n'ai aucun prompt modal ouvert". Tests pinning : 4 cas dans
`phase-gamma-victory.spec.ts` (IDLECMD/BATTLECMD autorisés ;
CARD/CHAIN/PLACE bloqués).

## Orchestrator Decomposition

`AnimationOrchestratorService` is a thin coordinator that delegates to
8 extracted managers/classes. The processor (chain state machine +
animation queue) lives on the `DuelConnection` / `ReplayDuelAdapter`
that owns the WS / precompute feed, NOT on the orchestrator — see the
"Chain Event Processing & State Machine" section above for ownership
rules post-c8.

- **`ChainResolutionManager`** — chain state (signals, buffer, replay
  timeouts, solved count). Pure state + `drainBuffer()`. Orchestrator
  owns `replayBuffer()` (cross-cutting dispatch via queue directives).
  α.4b: `ResetTarget` with declared scope **`PERSPECTIVE_LIFETIME`**
  (the most volatile slice — banner + replay timers); `applyReset`
  branches on `scopes.has('CONNECTION_LIFETIME')` for the full chain
  state reset (signals + buffer + counters + deferred peek). The
  cascade guarantees a CONNECTION/DUEL/SESSION reset also carries
  PERSPECTIVE, so the timers are cleared as part of the full reset.
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

`DuelLogger` is the gated console logger. Nine categories, each filterable
via `localStorage['duel-log-categories']` (CSV) or the DevHub toggle. Default
set keeps the console readable; the three **verbose** categories are off by
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
- `RUNNER` (verbose, Palier A 2026-05-23) — `QueueRunner` internal trace.
  One line per queue tick (the `action` returned by `decideNextStep` +
  the inputs that drove it: `isResolving`, `queueLen`,
  `isWaitingForOverlay`, `commitMode`). Lifecycle transitions
  (`notifyEnqueue`, `requestStop`, generation bump) and rescue/finalize
  events get their own trace lines. Use when diagnosing re-entry, stalls,
  or stale-loop bugs — centralises the causal chain that was previously
  scattered across `decideNextStep`, `case finalize`, and the `.finally`
  rescue.

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
