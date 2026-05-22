# Game Log — Integration Analysis (PvP live + Replay)

> Integration analysis — 2026-05-22.
> Steady-state skytrix: this is a feature analysis, not a frozen BMad
> planning spec. Live truth stays `CLAUDE.md` + `docs/`.
> Communication FR / document EN.
> **No code was written for this analysis.** It is a study + plan only.
>
> **Revision history:**
> - v1 (2026-05-22) — first draft.
> - v2 (2026-05-22) — O5–O10 resolved with code-grounded decisions.
> - v3 (2026-05-22) — architecture review (Winston). Code-verified the
>   `notifyGameLog` tap point (inside `processEvent`, between line 1048
>   and the dispatch switch), the `boardStateAfter` absorption into
>   `logicalState()`, and the rematch reset path. Added R10 (late service
>   instantiation), R11 (re-dispatch order), R12 (frozen bitmask dup);
>   upgraded R8 (stale journal across rematch). Fixed the bubble
>   `pointer-events` / G1-scroll contradiction (§3.4) and added §3.6
>   (service lifecycle).
> - v4 (2026-05-22) — added §5.4 (visual-fidelity doctrine): reference of
>   record = the generated `a8859c98.html`; "faithful, not pixel" with
>   the three permitted deltas + known intentional divergences; the
>   structural fidelity gate moved to end-of-Lot-4 (new step 4g).
> - v5 (2026-05-22) — added §3.7 (dev-hub bubble trigger): a synthetic-
>   `MSG_CHAINING` injection (D1) through the real pipeline, a declarative
>   `effect-bubble-fixtures.ts` catalogue (short / long / burst /
>   self-suppressed), new Lot 3d, O11 (4th dev-hub tab).
> - v6 (2026-05-22) — implementation-readiness review. Added §1.5
>   recording the deliberate scope divergence from chantier §5.4
>   (`game-log-labels.ts` is NOT created — the `GameLogBuilder` is the
>   single shared labelling authority; `replay-precompute.ts` is not
>   repointed). **This version is decision-complete and review-cleared
>   — fit to drive the implementation plan.**

## 0. Scope of this document

The Game Log prototype (`duel-server/src/game-log/`, 6 pure modules + 1
impure CLI) is **validated visually** as an offline tool. This document
analyses how to turn it into a real Angular feature with **two distinct
surfaces**:

- **Surface 1 — the journal panel** (`<app-game-log>`): a persistent,
  scrollable side band, full duel history. This is what the prototype
  `.html` renders today.
- **Surface 2 — the opponent effect bubble**: an ephemeral notification
  anchored above the chain overlay, shown when the opponent activates an
  effect, then dismissed.

The companion plan is `game-log-feed-chantier.md` (Sally's UX spec). This
document does **not** restate it — it complements it with the *technical
integration verdict*: where to hook, what is reusable as-is, what must be
adapted, what must be discarded, the risk ledger, the work breakdown, and
the open product questions.

---

## 1. Existing-asset inventory

### 1.1 The 6 `game-log/` modules — verdict per module

| Module | LOC role | Browser-safe? | Verdict |
|--------|----------|---------------|---------|
| `game-log-types.ts` | The five-block `GameLogEntry` model — pure types | **Yes** — imports only `ws-protocol-shared` types | **Reuse as-is, shared.** |
| `game-log-builder.ts` | `GameLogBuilder` stateful walker — `PreComputedState[]` → `GameLogEntry[]` | **Yes** — imports only protocol types, zero `fs`/`net`/`ws`/sqlite | **Reuse as the production brick.** One adaptation needed (§1.3). |
| `game-log-markdown.ts` | Markdown renderer | Yes | **Keep as a CLI/test artefact.** Not used by the front. |
| `game-log-html.ts` | Standalone-HTML renderer + `buildShowcaseEntries()` | Yes | **Partial reuse.** Discard the document-shell + avatar duplication; the per-block render *logic* is the reference the Angular template must reproduce. The `buildShowcaseEntries()` catalogue is reusable as a Storybook-style fixture. |
| `game-log.css` | Style source of truth (`:root` mirrors `_tokens.scss` by value) | n/a | **Port, do not copy.** Becomes component SCSS consuming the *real* DS tokens (§5). |
| `effect-desc-resolver.ts` | `description` code → effect text via `cards.cdb` | **No** — needs `CardDB` (sqlite, server-only) | **Server-side only.** Stays in the duel-server; the front never resolves descriptions itself (§4). |

**Headline finding:** the *core* — `game-log-types.ts` + `game-log-builder.ts`
— is already a clean, pure, browser-safe TypeScript brick. Its own
docstring states the intent: *"Exposé (not just `buildGameLog`) so the
future `DuelGameLogService` can drive it incrementally event-by-event."*
The architecture below honours that — the brick is **not reimplemented**,
it is wrapped.

### 1.2 The `GameLogBuilder` contract — can it be driven event-by-event?

The class exposes three relevant members:

- `ingestState(state: PreComputedState): void` — ingests one state: it
  calls `syncTurnAndPhase(state)` then loops `state.events`.
- `finish(): void` — currently a **no-op** ("nothing buffered across
  states in the current grammar").
- `readonly entries: GameLogEntry[]` — the accumulated output, a public
  mutable array.

**Verdict — drivable incrementally, but `ingestState` is state-coupled,
not event-coupled.** Two things are bundled inside `ingestState`:

1. `syncTurnAndPhase(state)` — reads `state.boardState.turnCount` and
   `state.boardState.phase`, synthesises turn/phase separators on a delta.
2. The event loop — `for (const event of state.events)`.

For an **incremental live feed**, the service does not receive a
`PreComputedState`; it receives individual `GameEvent`s plus, separately,
board-state deltas. So the live driver needs a *finer* entry point than
`ingestState`. Two options:

- **(A) widen the public surface** of `GameLogBuilder` with
  `ingestEvent(event, boardSnapshot)` + `syncTurnAndPhase(boardSnapshot)`
  as public methods (today both are `private`). The live service drives
  those directly; `ingestState` stays as the batch convenience used by
  the CLI and tests.
- **(B) keep `ingestState` only** and have the live service synthesise a
  minimal `PreComputedState`-shaped object per event (`{ boardState,
  events: [event], … }`).

**Recommendation: (A).** Option B fabricates a fake `PreComputedState`
that does not carry a real `responseCount`/`decisions`/`chainIndex` — a
lie the type system cannot catch, and a maintenance trap. Option A is a
small, honest widening of an API the module's own docstring already
anticipated. It changes `private ingestEvent` / `private syncTurnAndPhase`
to `public` (or adds thin public wrappers) — no behaviour change. **This
is the single adaptation the builder needs.**

One caveat — `syncTurnAndPhase` and the event loop have an **ordering
contract**: the board snapshot's turn/phase is synced *before* the events
of that state run. The live driver must preserve this: on each delivered
event, sync turn/phase from the *current* board snapshot first, then
ingest the event. §2.4 covers how the live feed gets a board snapshot.

### 1.3 What is reusable on the front, verbatim vs adapted

| Asset | Front reuse |
|-------|-------------|
| `GameLogEntry` + all sub-types | **Verbatim** — shared type module (§6). |
| `GameLogBuilder` class | **Verbatim logic**, with `ingestEvent`/`syncTurnAndPhase` made public (§1.2 option A). |
| Builder helper consts (`VERB`, `PHASE_LABEL`, `WIN_REASON`, `summonVerb`, `zoneLabel`, reason bitmask) | **Verbatim** — they travel with the builder. |
| `game-log-html.ts` render functions | **Reference only** — re-expressed as Angular template + small render helpers. Not imported (it emits raw HTML strings; the front needs an Angular component tree for `OnPush`, click handlers, `<app-avatar>`). |
| `game-log.css` | **Ported** to component SCSS (§5). |
| `game-log-markdown.ts` | **Not used by the front.** Stays a CLI artefact. |
| `effect-desc-resolver.ts` | **Not used by the front.** Server-only. |
| `buildShowcaseEntries()` | Optional — reusable as a dev-hub fixture / visual catalogue. |

### 1.4 Does the builder depend on Node? — No.

Confirmed by reading every import in `game-log-builder.ts` and
`game-log-types.ts`: only `ws-protocol-*` type imports + the `LOCATION` /
`POSITION` enums. No `fs`, no `net`, no `ws`, no `better-sqlite3`, no
`process`. The purity contract in the file header is real and enforced by
the import list. **The builder runs in a browser unchanged.**

The single non-portable concern is the `.js` import suffix
(`'../ws-protocol-shared.js'`) — a duel-server NodeNext convention. The
front's TypeScript resolution does not use it. This is exactly the
problem `scripts/check-ws-protocol-sync.mjs` already solves for the
ws-protocol barrel: the front copy drops the `.js`. The shared
game-log module must follow the same rule (§6).

### 1.5 Deliberate scope divergence from the chantier — `game-log-labels.ts`

The chantier §5.4 proposes a separate shared utility, `game-log-labels.ts`:
extract `generateLabel()` / `describeMoveLabel()` *out of*
`replay-precompute.ts` into a shared module, and **repoint
`replay-precompute.ts`** at it — eliminating the duplication, per the
`no-doc-code-divergence` rule.

**This analysis does NOT follow that route — a deliberate divergence,
recorded here so it is not a silent omission.** The reasoning:

- The chantier's `game-log-labels.ts` and this analysis's shared
  `GameLogBuilder` (§7.1) would be *two* shared modules doing
  overlapping work. The builder already owns the `event → human label`
  logic in full (`VERB`, `PHASE_LABEL`, `WIN_REASON`, `summonVerb`,
  `zoneLabel`) — richer and more structured than
  `replay-precompute.ts`'s `generateLabel`.
- The builder is the *single source of truth* the chantier itself wants
  (§8.2: "the same module the Angular component will consume"). Adding a
  second shared label utility splits that truth.
- So the decision: **the `GameLogBuilder` is the shared labelling
  authority. `game-log-labels.ts` is not created.**

**The cost — accepted, not hidden:** `replay-precompute.ts` keeps its
own `generateLabel()`. It is NOT repointed; the duplication the chantier
wanted to remove *persists*. This is acceptable because the two label
producers serve different consumers — `replay-precompute.ts`'s
`generateLabel` feeds the *replay timeline stepper* (short segment
labels), while the builder feeds the *game-log grammar* (the five-block
rows). They are not the same output and forcing one to serve both would
distort it. A future consolidation could still happen, but it is **out
of scope for this chantier** and explicitly so. (Mirrored in the
implementation plan's "out of scope" section.)

---

## 2. The hard point — PvP vs Replay parity

This is the crux. `CLAUDE.md` is emphatic: PvP↔Replay parity must hold
**by construction**, never by manual mirroring. The Game Log + bubble
must inherit that.

### 2.1 The candidate hook points

Three layers see game events. Each has a different parity story.

| Layer | What it is | Parity story |
|-------|-----------|--------------|
| **`DuelEventProcessor`** | The chain state machine — single source of truth for `chainPhase`, `activeChainLinks`. Both `DuelConnection` (PvP) and `ReplayDuelAdapter` own their own instance. | Shared *class*, separate instances. Sees events as they are *enqueued*, before animation. |
| **`AnimationDataSource`** (token `ANIMATION_DATA_SOURCE`) | The interface the orchestrator reads. PvP impl = `DuelWebSocketService`; Replay impl = `ReplayDuelAdapter`. Exposes signals (`activeChainLinks`, `chainPhase`, `pendingPrompt`) + queue methods. | Two implementations — a signal added here must be implemented twice. Risk of manual parity. |
| **`AnimationOrchestratorService.processEvent()`** | The single dispatcher. Every `GameEvent` reaches it via `_handleEntry` (the file calls `_handleEntry` "the single divert point"). The orchestrator itself is **shared**: PvP and Replay both feed the same orchestrator instance. | **One instance, one code path, both modes.** This is where parity is free. |

### 2.2 Verdict — tap the orchestrator's event stream, NOT the data source

The chantier (§5.3) already proposes this: *"Taps the
`AnimationOrchestratorService.processEvent()` event stream — the single
chronological stream that already sees every game event in order."* The
code confirms it is the right call, and sharpens *where exactly* to tap.

**Why the orchestrator and not `DuelEventProcessor`:** there are two
`DuelEventProcessor` instances (one per mode). Tapping it means wiring the
tap twice and trusting both wirings stay identical — exactly the "manual
parity" `CLAUDE.md` forbids. The orchestrator is a **single shared
instance** (the Animation Parity Rule is built on this). One tap there,
both modes covered, by construction.

**Why not `AnimationDataSource`:** same problem — two implementations.
Adding a `gameLogEvents` signal to the interface means implementing it in
`DuelWebSocketService` *and* `ReplayDuelAdapter`. The orchestrator tap
needs zero interface change.

### 2.3 The precise tap point — `_handleEntry`, and the buffering trap

`processEvent` is `private`. The honest tap is **inside `_handleEntry`**,
the documented single divert point, *before* `processEvent` runs.

But there is a **non-obvious trap** that the buffer-replay machinery
creates, and it is the single most important finding of this section:

> During chain resolution, `BOARD_CHANGING_EVENTS` are **buffered** by
> `bufferIfResolving()` and **replayed later** via `replayBuffer()`. A
> buffered event passes through `_handleEntry` *twice*: once when it is
> first dequeued and buffered (returns early), and again when
> `replayBuffer` re-dispatches it through `_handleEntry` (line 975 calls
> `processEvent(entry.events[i])` directly during replay; line 757/769
> route replay batches back through `_handleEntry`).

If the Game Log tap sits naïvely at the top of `_handleEntry`, a buffered
activation/move during a chain is **logged twice** — once out of order
(at buffer time, before the chain overlay resolves) and once in order (at
replay time).

**Verdict — tap inside `processEvent`, at the dispatch point (T2,
refined after a code review 2026-05-22).** The earlier draft proposed a
T1/T2 choice; reading the actual dispatch code resolves it cleanly.

`processEvent` (`animation-orchestrator.service.ts:1031`) has a precise
shape that settles the tap question:

1. **Line 1035** — `if (chainManager.bufferIfResolving(event)) return 0`.
   A board-changing event during chain resolution is buffered here and
   `processEvent` returns *before the switch*. So a buffered event's
   *first* pass through `processEvent` is a no-op for the dispatch
   switch.
2. **Lines 1047-1048** — `boardStateAfter` is read off the event and
   `rbs.updateLogical(boardStateAfter)` runs **before** the dispatch
   switch. (See §2.4 — this is why the tap needs no board parameter.)
3. **Lines 1050-1078** — the dispatch switch: the event genuinely runs.

When the chain buffer is later drained, `replayBuffer` re-dispatches the
buffered events through `processEvent` with `_isReplayingBuffer = true`,
which makes line 1035's guard fall through (`!this._isReplayingBuffer`)
so the switch finally executes.

**The tap point: a single `notifyGameLog(event)` call placed AFTER line
1048 (`updateLogical`) and BEFORE the switch (line 1050), inside
`processEvent`.** This one placement gives the right behaviour for free:

- A buffered event hits `processEvent`, returns at line 1035 *before*
  reaching the tap → **not logged at buffer time**.
- When `replayBuffer` re-dispatches it, `_isReplayingBuffer` is true,
  line 1035 falls through, the event reaches the tap → **logged once, at
  replay time, in resolution order**.
- A non-buffered event (every event outside a resolving chain, and every
  chain event — `MSG_CHAINING` etc. are not `BOARD_CHANGING_EVENTS`)
  reaches the tap on its single pass.

No three-site dedupe, no separate drain hooks, no `shouldBufferDuringChain`
flag plumbing. **One line, inside the method that already is the single
dispatch point.** The pre-activation buffer is the one remaining case:
those events return at `_handleEntry` *before* reaching `processEvent`,
and are re-injected via `drainPreActivationBuffer → processAnimationQueue`
→ they pass through `processEvent` normally on drain. So the
pre-activation buffer also needs no special tap handling — its drained
events reach `processEvent` like any other.

**Ordering — three orders exist, the tap picks the right one.** A
reviewer (Winston, 2026-05-22) flagged that "buffer order" vs "replay
order" is not a binary — there are *three* orders for a chain's events:
(a) the **park order** (when first buffered), (b) the **`BufferReplayBuilder`
order** (the 3-pass re-sequenced order optimised for *animation* — Xyz
materials before the monster, confirm-interleaving, category flush —
`CLAUDE.md` "Buffer Replay Batch Construction"), and (c) the
**logical-resolution order**. The journal must show (c) — the order
effects *resolved* — not (b), which is an animation-fidelity ordering.

Tapping inside `processEvent` gives (c): `replayBuffer`'s direct
re-dispatch loop calls `processEvent(entry.events[i])` for the buffered
events; the `BufferReplayBuilder`'s re-sequencing governs the *animation
queue directives*, not this re-dispatch order. The events reach
`processEvent` — and therefore the tap — in their buffered (logical)
sequence. **The tap inside `processEvent` is the journal's correct
chronological source by construction.** ⚠️ This is an assumption to
*verify* during implementation (Lot 5b's regression diff catches it): if
`replayBuffer` ever re-dispatches in `BufferReplayBuilder` order rather
than buffered order, the journal order would drift. The CLI offline
build (which walks `PreComputedState.events` in raw order) is the oracle.

**The bubble keys off the real-time `MSG_CHAINING`.** `MSG_CHAINING` is a
chain event, not a `BOARD_CHANGING_EVENT` — it is never buffered. It
reaches the tap on its single, real-time pass. The bubble fires there,
synchronous with the chain overlay. The panel's *move* rows arrive later
(post-buffer, in resolution order). Both surfaces get the timing they
need from the *same* single tap.

### 2.4 The `PreComputedState[]` problem — what is the live equivalent?

The builder's batch entry, `ingestState(state: PreComputedState)`, wants
a `{ boardState, events }` pair. In **replay**, `PreComputedState[]`
exists natively — the precompute pipeline produces it, and
`ReplayDuelAdapter.feedTransition` already iterates `next.events`. In
**live PvP**, there is no `PreComputedState`.

This is *not* a blocker, because the chantier (§5.3) already decided the
service is **independent of the precompute pipeline** and drives the
builder **incrementally**. The live equivalents:

- **`events`** → the individual `GameEvent`s tapped from the orchestrator
  (§2.3). One at a time, not a batch.
- **`boardState`** → `RenderedBoardStateService.logicalState()`. The
  builder needs the board snapshot for exactly two things:
  1. **turn/phase synthesis** (`syncTurnAndPhase`) — reads
     `boardState.turnCount` and `boardState.phase`. `logicalState()`
     carries both.
  2. **`MSG_BECOME_TARGET` board resolution** (`resolveBoardCard`) —
     reads `boardState.players[].zones[].cards[]` to name a targeted
     field position. `logicalState()` carries the full zone arrays.

  ⚠️ **`logicalState()` vs `renderedState()`** — `CLAUDE.md`'s Rendered
  Board State Constraint says `turnCount`/`phase` may run *ahead* of
  locked zones during animation. For turn/phase **synthesis** that is
  fine (the chantier §5.5 explicitly accepts it — the log is a journal,
  not animation-synced). But for **target resolution** the builder needs
  the zones and the metadata to be *consistent*. `logicalState()` is the
  synchronised pair (`CLAUDE.md`: "For synchronized metadata + zones,
  read `logicalState()`"). **Use `logicalState()`, never
  `renderedState()`, for the live builder feed.** Document this so a
  future reader does not "optimise" it to `renderedState`.

  ⚠️ **`logicalState()` is relative-to-viewer — confirmed by code.**
  `RenderedBoardStateService` holds a `DuelState` whose `players[]` is
  already in `[you, opp]` order: the board renders in relative indices
  (`${zoneId}-${relPlayer}`), and the RBS is fed relative data in both
  modes (PvP via the server's `sanitizeBoardState`, replay via
  `ReplayDuelAdapter.swapBoardState`). This is **central to the O5
  decision** (§4.3): the builder must be told the board it receives is
  already relative.

**No board parameter on `notifyGameLog` — and `boardStateAfter` is
already absorbed (code review, 2026-05-22).** A reviewer asked whether
`notifyGameLog` should carry a board snapshot, to avoid a read-after-
write race (the service reading `logicalState()` *after* it has moved
on). The code answers it: `processEvent` runs `rbs.updateLogical(
boardStateAfter)` at **line 1048**, *before* the dispatch switch at line
1050. The `notifyGameLog` tap sits between them (§2.3). So at the instant
the tap fires, `logicalState()` has *already* been advanced by this
event's `boardStateAfter` snapshot. The service reads `logicalState()`
synchronously inside its tap handler → it sees the board *for this
event*. **`notifyGameLog(event)` needs no board argument.**

This also resolves the `boardStateAfter` question cleanly. `boardStateAfter`
(`ws-protocol-game.ts`) is a per-event board snapshot attached
server-side **only to `BOARD_CHANGING_EVENTS` during `chainPhase ===
'resolving'`** — and **`processEvent`'s own comment states "PvP events
never carry this field"** (it is a replay-precompute / chain-snapshot
mechanism). So the builder must NOT depend on `event.boardStateAfter`
directly — it is absent in live PvP and absent outside chains. Instead,
the builder always reads the *one* board source that is correct
everywhere: `logicalState()`, which the orchestrator has *already*
folded `boardStateAfter` into (line 1048) when one was present. **The
builder gets the per-event chain snapshot for free, via `logicalState()`,
without ever touching the `boardStateAfter` field.** One source, both
modes, no special-casing.

So the live driver, per tapped event:
1. read `logicalState()` → synthesise turn/phase separators on a delta;
2. ingest the event with that same snapshot as the resolution context
   for `MSG_BECOME_TARGET` board lookups.

The replay path can keep using `ingestState` batch-style **or** route
through the same incremental `ingestEvent` for uniformity. **Recommend
the same incremental path for both** — one driver, one code path, parity
by construction (the whole point of §2.2). The replay adapter would feed
the service the same per-event stream the orchestrator tap produces;
since the tap *is* in the shared orchestrator, replay already gets the
events for free — no separate replay wiring.

### 2.5 Parity verdict

**One hook, both modes, zero manual parity:** the `DuelGameLogService`
taps the shared `AnimationOrchestratorService` via a single
`notifyGameLog(event)` call placed inside `processEvent` (§2.3). Because
the orchestrator is the shared instance both PvP and Replay feed, the
service inherits parity the same way every animation feature does. The chantier's "verify this during
implementation — do not assume" (§5.7) becomes a concrete test: drive the
`a8859c98` replay, capture the service's `gameLogEntries`, diff against
the CLI's offline build of the same replay — they must match.

---

## 3. The opponent effect bubble — synchronisation

Surface 2 is the genuinely new build (the panel has a validated prototype;
the bubble does not). Its behaviour is *opposite* to the panel's: transient,
attention-grabbing-but-not-stealing, animation-synchronised.

### 3.1 When does the bubble appear / disappear?

**Appear:** on `MSG_CHAINING` where the activating player is the opponent.
As established in §2.3, `MSG_CHAINING` is **not buffered** — it reaches
`processEvent` in real time. So the bubble fires off the same tap as the
panel, filtered to `event.type === 'MSG_CHAINING'` + opponent.

**Content:** the resolved `descriptionText` of that activation (§4 — the
text comes from the server, added to `ChainingMsg`).

**Disappear:** after a fixed hold (`EFFECT_BUBBLE_MS` ≈ 3500ms, scaled by
`ctx.scaledDuration`), fade out. A second opponent `MSG_CHAINING` within
the window **replaces** content + **restarts** the timer (chantier
decision — "last effect wins", no queue, no stacking).

**Why `MSG_CHAINING` and not the chain overlay's lifecycle:** the chain
overlay is driven by `activeChainLinks` + `chainPhase` and persists for
the *whole* chain (idle→building→resolving→idle). The bubble must fire
*per activation* — once per link, as each link is *declared*, not once
per chain. `MSG_CHAINING` is the per-link declaration event. Keying the
bubble off the overlay would make it fire once per chain (wrong
granularity) and would not carry the per-link `descriptionText`.

### 3.2 Anchoring "above the chain overlay"

`PvpChainOverlayComponent` (`pvp-chain-overlay/`) is a **standalone
Angular component, `OnPush`**, rendered inline inside the duel board
component tree (not a CDK overlay — confirmed: it is a plain
`<app-pvp-chain-overlay>` element reacting to `dataSource` signals).

The earlier chain-effect *hover* was migrated to a CDK overlay (recent
commit `983b9865` "render the chain effect hover via a CDK overlay") —
but that is the hover tooltip, **not** the main chain resolution overlay.
The main overlay stays inline.

**Implication for the bubble's z-index / anchoring:**

- "Above the chain overlay" means a **higher stacking context**. Two
  viable approaches:
  - **(B1) Inline, anchored to the opponent duelist card.** The bubble
    is a child of (or a sibling positioned relative to) the opponent's
    duelist-card element, with a `z-index` above the chain overlay's.
    This requires knowing both z-indices and keeping them ordered — a
    fragile coupling if either changes.
  - **(B2) CDK overlay anchored to the opponent duelist card.** A CDK
    overlay renders in the CDK overlay container, which sits *above* the
    app's normal stacking context by construction. A `Flexible
    ConnectedPositionStrategy` anchored to the opponent duelist-card
    element keeps the bubble glued to it (and re-positions on scroll /
    resize). The chain overlay being inline means the CDK overlay is
    *always* above it — no z-index arithmetic.

  **Recommendation: (B2).** It is the pattern the recent chain-effect
  hover already adopted (`983b9865`), so it is an established, reviewed
  pattern in this codebase — not a new dependency, not a new idiom. It
  also makes guard-rail **G2** ("never mask the board") tractable: the
  CDK position strategy can be given fallback positions that always
  expand *toward the corner*, away from the board centre.

- **Anchor element:** the opponent's duelist card. The Explore pass found
  the duel page exposes `opponentPseudo` (a `computed`) and the
  opponent's duelist card is a known DOM element in the board HUD. The
  bubble's `ConnectedPosition` origin is that element; the overlay
  position is "below it, growing toward the screen corner".

### 3.3 The opponent-only filter × perspective convention

The bubble shows **only opponent activations**. `MSG_CHAINING.player` is
**absolute** (server P0/P1 — `CLAUDE.md` Perspective Convention; the
chantier §5.6 confirms `ChainingMsg.player` is absolute).

The filter is the canonical relativiser:
```
const rel = chaining.player === ownPlayerIndex ? 0 : 1;
if (rel === 1) showBubble(...);   // opponent only
```
- In **PvP**, `ownPlayerIndex` = `DuelContext.ownPlayerIndex()` (absolute).
- In **replay**, `ownPlayerIndex` = `perspectiveIndex()` (the replay
  convention — `CLAUDE.md`, chantier §5.7).

The `DuelGameLogService` already holds an `ownPlayerIndex` accessor for
relativising every `GameLogEntry.player` (§4 below) — the bubble reuses
the *same* accessor. One relativiser, no second source of truth.

### 3.4 Timing constraint — no flicker, no attention theft

Three failure modes and their mitigations:

1. **Flicker on a fast chain.** A long opponent chain fires
   `MSG_CHAINING` for link 1, 2, 3 within a few hundred ms. "Last effect
   wins" already prevents *stacking*, but a naïve implementation would
   still flash three contents in rapid succession. **Mitigation:** a
   minimum-display floor — once the bubble shows content X, hold X for at
   least `EFFECT_BUBBLE_MIN_VISIBLE_MS` before allowing a replacement,
   then swap to the latest pending content. This coalesces a burst into
   "show link 1 briefly → show the final link" rather than a strobe.
   (This is a *new* guard-rail not in the chantier — flag it as an open
   detail, §8.)
2. **Stealing attention during a critical animation.** The bubble holds
   ~3.5s scaled by `speedMultiplier` — under slow playback that stretches,
   under fast playback it shrinks. `ctx.scaledDuration(EFFECT_BUBBLE_MS,
   EFFECT_BUBBLE_MIN_MS)` is the right call (chantier §5.8). The bubble
   *coexists* with the chain overlay (it sits above) — it must not
   intercept clicks meant for the board.

   ⚠️ **`pointer-events` — the bubble is NOT uniformly `none`** (review
   correction, 2026-05-22). An earlier draft said the bubble is a
   `pointer-events: none` notification. That **contradicts chantier
   guard-rail G1**: on a long effect text the bubble grows to a max
   height then **scrolls internally** — and a `pointer-events: none`
   element cannot be wheel- or touch-scrolled. The resolution: the
   bubble's **outer wrapper is `pointer-events: none`** (so it never
   blocks a board click in the gap around it), and the **inner
   scrollable content box is `pointer-events: auto`** (so the user can
   scroll a long effect). This is the standard "click-through frame,
   interactive content" pattern. The bubble still takes no *semantic*
   input — no buttons, not focusable — `auto` on the content box only
   re-enables scroll, nothing else.
3. **Replay seek / pause mid-bubble.** A replay seek runs
   `abortAndClean` → `resetForSwitch` → `resetAllState()`
   (`animation-orchestrator.service.ts:533`). The bubble's hold timer
   must be cleared on that path. The `DuelGameLogService` registers in
   the same reset sequence (see R8 / §3.6) — the bubble timer clears
   with the log accumulator.

### 3.6 Service lifecycle — instantiation timing and reset

Two lifecycle facts, both code-confirmed, that the plan must honour:

- **The service must be injected at page start, not at panel open.** An
  Angular service provided at component level is instantiated on its
  *first injection*. The `GameLogBuilder` is stateful and accumulates
  from the duel's very first event (chantier: whole-duel history). If
  nothing injects `DuelGameLogService` until the user opens the panel,
  it **misses every event before that** — potentially 20 turns. The
  duel-page / replay-page component MUST inject the service in its own
  constructor (the exact pattern `DuelDebugService` uses — provided +
  injected at page level so it is live from frame one). The panel
  component is a *consumer* of the already-running service, never its
  trigger.

- **Reset must clear the accumulator on rematch — not just on destroy.**
  `resetAllState()` (`animation-orchestrator.service.ts:533`) is the
  shared reset for `resetForSwitch` (rematch / mode switch) and
  `onStateSync`. A rematch reuses the same page component — `ngOnDestroy`
  does **not** fire — so a service that only clears on destroy would
  carry duel 1's log into duel 2. The `DuelGameLogService` must clear
  its accumulated `entries` + reset the `GameLogBuilder` + clear the
  bubble timer on the **`resetForSwitch` path**. Cleanest wiring: the
  orchestrator (or the page component) calls a `DuelGameLogService.reset()`
  from within / alongside `resetAllState()`. This is **risk R8,
  upgraded** — the first draft scoped R8 to "a leaked bubble timer";
  the real exposure is a **stale journal across a rematch**.

### 3.5 Bubble — does it need the builder at all?

A subtle point. The bubble shows *one card name + one effect text*. It
does **not** need the five-block grammar, the move anatomy, the
mini-board. It needs: the activating card's name + its `descriptionText`.

That data is already on the `MSG_CHAINING` event (`cardName`,
`cardCode`, and — once §4 lands — `descriptionText`). **The bubble can
read it straight off the tapped `MSG_CHAINING` event without going
through `GameLogBuilder` at all.** This is cleaner: the builder's job is
the *journal*; the bubble's job is a *notification*. They share the
*tap* and the *perspective relativiser*, but the bubble does not consume
`GameLogEntry[]`.

The chantier (§intro) says the two surfaces "share the same data (the
`GameLogEntry` of an activation…)". The technical refinement: they share
the *source* data (the `MSG_CHAINING` event + its resolved description),
not the *built* `GameLogEntry`. The shared brick is the **description
resolution** (§4) and the **perspective relativiser**, not the builder
output. Building a whole `GameLogEntry` just to extract two fields for
the bubble would be YAGNI.

### 3.7 Dev-hub trigger for the bubble (new, 2026-05-22)

The bubble is the only surface with **no validated visual reference**
(§5.4) and the **hardest to observe in vivo** — it needs an opponent to
activate an effect, at the right moment, to appear at all. A dev-hub
trigger removes that friction: invoke the bubble on demand to validate
its look, anchor, timing, anti-flicker — without staging a PvP duel.

This fits the existing dev-hub design. `DuelDevHub` already has a
**Prompts tab** driven by **declarative, type-checked fixtures**
(`prompt-fixtures.ts` → `PROMPT_FIXTURES`, applied via
`DuelDevStateService.forcedPrompt`). The bubble trigger is the *same
pattern*, one surface over: a fixture catalogue + a state signal.

**Mechanism — inject a synthetic `MSG_CHAINING` (D1), not a direct
component call (D2).** Decision (Axel, 2026-05-22). The trigger pushes a
**fake `MSG_CHAINING` event through the real pipeline** — it reaches the
`notifyGameLog` tap (§2.3) like any genuine event. Rationale:

- D1 exercises the **whole Surface 2 chain**: the `notifyGameLog` tap,
  the opponent-only perspective filter (§3.3), the last-wins replace,
  the `EFFECT_BUBBLE_MIN_VISIBLE_MS` anti-flicker floor (§3.4), the
  `scaledDuration` hold, the coexistence with the chain overlay.
- D2 (`effectBubble.show(card, text)` direct) would test only the
  component's *render* — a bubble that "appears" but whose *integration*
  is unverified. That is a weaker test for no real saving.
- D1 aligns with the project's `clean-code` / `code-principles`
  doctrine: a dev tool that travels the production path cannot lie about
  whether the feature works.

**Wiring.** The bubble keys off `DuelGameLogService.lastOpponentActivation`
(§7.1 — a signal fed by the `notifyGameLog` tap, opponent-filtered). The
dev-hub trigger needs a way to push a synthetic `MSG_CHAINING` *to that
tap*. Cleanest: a single dev-only entry method on `DuelGameLogService`,
e.g. `injectDevChaining(fixture)`, that feeds the synthetic event into
the *same* internal handler `notifyGameLog` calls. It MUST be a no-op /
absent in production builds (`isDevMode()` guard — the same discipline
`DuelDebugService` applies to its `window.__skytrixDebug` surface). The
event is tagged so the journal builder can ignore it (a dev-injected
activation must not pollute the real game log — see the caveat below).

**Fixture catalogue — covers the bubble's hard cases.** A new
`effect-bubble-fixtures.ts` (sibling of `prompt-fixtures.ts`,
`end-flow-fixtures.ts`), declarative and type-checked against
`ChainingMsg`. Minimum coverage — each one tests a *specific* bubble
behaviour, not just "it shows":

- **Short effect** — one-line text. Baseline look + anchor.
- **Very long effect** — a paragraph-length text. Tests guard-rail G1
  (grow to max height, then internal scroll) and the
  `pointer-events: auto` content box (§3.4).
- **Rapid burst** — fires 3 synthetic `MSG_CHAINING` in quick
  succession. Tests last-wins replace + the
  `EFFECT_BUBBLE_MIN_VISIBLE_MS` anti-flicker floor (§3.4 / R6).
- *(optional)* **Self vs opponent** — one self-activation fixture, to
  confirm the opponent-only filter (§3.3) correctly *suppresses* the
  bubble for a self effect.

**Caveats the plan must honour:**

1. **Dev-injected events must not pollute the real journal.** The
   synthetic `MSG_CHAINING` reaches `notifyGameLog`, which also drives
   the panel builder. A dev fixture firing must NOT add a phantom
   activation row to the game-log panel. The synthetic event carries a
   dev flag; the builder-feeding path skips flagged events, the
   bubble-feeding path honours them. One branch, explicit.
2. **Dev-only, stripped from prod.** The fixtures file, the
   `injectDevChaining` method, and the new dev-hub tab/section are all
   `isDevMode()`-gated and tree-shaken in production — same contract as
   the rest of `DuelDevHub` (its header literally reads "remove before
   prod").
3. **It is a Lot 3 deliverable, gated on the bubble existing.** The
   trigger is meaningless before the bubble exists — it ships *with*
   Surface 2, not before. Sequenced as Lot 3d (§9).
4. **Placement — a 4th tab (decided, O11).** `DuelDevHub` has 3 tabs
   (Board / Prompts / End-flow). The bubble trigger lands as a **4th
   tab** ("Game Log" / "Effects") — O11, resolved §10. It leaves room
   for a later game-log-panel dev affordance. Cost: one `@case` + one
   tab button in the existing `@switch`.

---

## 4. Perspective convention — at-risk fields

The builder already takes a `perspective: Player` constructor arg and
relativises through `rel()` / `relLp()`. The risk is not the builder's
*internal* logic — it is the **inputs** and the **two new live concerns**.

### 4.1 Builder inputs that are absolute and must be relativised

The builder relativises correctly *as long as `perspective` is the
absolute viewer index*. Every absolute field it consumes:

| Field | Source event | Builder handling | Risk |
|-------|-------------|------------------|------|
| `ChainingMsg.player` | `MSG_CHAINING` | `rel()` in `rowHead` | OK — relativised. |
| `MoveMsg.player` / `toPlayer` | `MSG_MOVE` | `rel()` in `rowHead`; `fieldCell` relativises `toPlayer` | OK. |
| `DrawMsg.player` | `MSG_DRAW` | `rel()` | OK. |
| `AttackMsg.attackerPlayer` / `defenderPlayer` | `MSG_ATTACK` | `rel()` | OK. |
| `BattleMsg.*Player` | `MSG_BATTLE` | `rel()` for `lpLoss` | OK. |
| `BoardStatePayload.players[]` / `turnCount` | board snapshot | `relLp()` **swaps** `players[0/1].lp` assuming the board is absolute | ⚠️ **WRONG — see §4.3.** The board is NOT absolute. |
| `MSG_BECOME_TARGET` `cards[].player` | board snapshot lookup | `resolveBoardCard(board, absolute, …)` indexes `board.players[absolute]` | ⚠️ **WRONG — see §4.3.** Indexes a relative board with an absolute index. |

**The builder relativises the *event* player fields correctly** (rows 1-5
above — those fields ARE absolute on both sides, per `CLAUDE.md`). But its
**board-snapshot** handling (rows 6-7) is **broken** — it treats the board
as absolute when it is not. §4.3 is the fix; it is the single blocking
finding. The job at integration is to (a) feed the right `perspective` for
the event fields, and (b) correct the board-snapshot contract.

### 4.2 Feeding the right `perspective`

- **PvP:** `perspective` = `DuelContext.ownPlayerIndex()` — absolute, the
  canonical PvP value.
- **Replay:** `perspective` = `perspectiveIndex()` — the replay
  convention. `CLAUDE.md` is explicit: in replay `ownPlayerIndex` is fed
  `perspectiveIndex()`.

⚠️ **Replay perspective can change mid-session.** The replay viewer lets
the user flip perspective. If `perspectiveIndex()` changes, the builder's
`perspective` is now stale — every already-built `GameLogEntry` was
relativised for the *old* viewer. **Two options:**

- **(P1)** Rebuild the whole log on a perspective flip. The builder is
  pure and fast; re-running it over the captured event stream is cheap.
  Requires the service to *retain the raw tapped events*, not just the
  built entries.
- **(P2)** Store entries with *absolute* player indices and relativise
  at *render* time in the Angular template.

**Recommendation: (P1).** It keeps the builder's existing design intact
(relativise-at-build, single `perspective` arg) — P2 would mean gutting
the builder's relativisation and pushing it into the component, a much
bigger change to a *validated* module. P1 costs one "retain raw events"
array + a rebuild on flip. Flag this as an **open question** only if the
product decision is "perspective flip is replay-only and rare" — then P1
is obviously fine. (It almost certainly is.)

### 4.3 The `BoardStatePayload` relativisation bug — RESOLVED (O5)

> **This section was rewritten 2026-05-22 after reading the actual code.**
> The first draft assumed the CLI prototype was fed *absolute* board
> data. **It is not.** The correction below is grounded in the source.

**What the builder does today.** `relLp()` does
`this.perspective === 0 ? [lp0, lp1] : [lp1, lp0]` — it *swaps*
`players[]` when `perspective === 1`. And `resolveBoardCard(board,
absolute, …)` indexes `board.players[absolute]`. Both assume the board
snapshot is in **absolute** OCGCore order.

**What the board snapshot actually is — three sources, all relative:**

1. **Replay precompute** (`replay-precompute.ts:357`):
   `filterMessage(translated, 0 as Player, true)` →
   `sanitizeBoardState(data, forPlayer=0, omniscient=true)`. With
   `forPlayer=0`, `sanitizeBoardState` (`message-filter.ts:245`) produces
   `players: [data.players[0], data.players[1]]` and
   `turnPlayer: data.turnPlayer === 0 ? 0 : 1`. So
   `PreComputedState.boardState` is **relative-to-P0** — not absolute.
2. **Replay adapter** (`ReplayDuelAdapter.swapBoardState`,
   `replay-duel-adapter.ts:83`): for `perspectiveIndex === 1` it swaps
   `players[1], players[0]`; for `0` it is identity. So whatever the RBS
   receives is **relative-to-the-viewer**.
3. **Live PvP**: the server's `sanitizeBoardState(data, forPlayer)`
   relativises per recipient before broadcast. The RBS receives
   **relative-to-the-viewer**.

**Conclusion: `logicalState()` is ALWAYS relative-to-the-viewer**, in
both modes. The board the live `DuelGameLogService` would feed the
builder is relative. The builder's `relLp()` swap and absolute
`resolveBoardCard` index are therefore **wrong** — not "wrong if",
**wrong**.

**The prototype already has this bug — latent.** The CLI feeds the
builder `PreComputedState.boardState` (relative-to-P0). Run with
`--perspective 0`, relative-to-P0 == relative-to-viewer, the builder's
`relLp` is identity (`perspective===0` branch) and `resolveBoardCard`'s
absolute index 0/1 happens to match — **correct by coincidence**. Run
with `--perspective 1`, the builder's `relLp` *swaps* an
already-P0-relative board (now scrambled) and `resolveBoardCard` indexes
it with an absolute index. **The `a8859c98` prototype was validated
visually in perspective 0 — the perspective-1 bug was never seen.**

**O5 — DECISION: (C2). The builder receives a relative-to-viewer board
and NEVER swaps it.** This is the documented builder input contract.

- `relLp()` → **identity**: `[players[0].lp, players[1].lp]`.
  `players[0]` is already "you".
- `resolveBoardCard` → indexed by a **relative** player. Its caller
  (`onBecomeTarget`) must relativise `MSG_BECOME_TARGET.cards[].player`
  (absolute) *before* the lookup, with the same `rel()` used for event
  fields.
- The builder's `perspective` arg keeps **one** job: relativising the
  *event* player fields (`MSG_CHAINING.player`, `MSG_MOVE.player` /
  `toPlayer`, `MSG_DRAW.player`, `MSG_ATTACK`/`MSG_BATTLE` players) —
  those **are** absolute on both sides (`CLAUDE.md` Perspective
  Convention). `rel()` stays. `relLp()` and `resolveBoardCard`'s indexing
  change.

**Why not (C1) "builder owns all relativisation, receives absolute".**
The live path has no absolute board source — `logicalState()` is
relative and the client never sees pre-`sanitizeBoardState` state. C1 is
not feasible live. Rejected.

**Consequences for the implementation:**

- **The builder needs a second adaptation** beyond the incremental API
  (§1.2): fix `relLp` (→ identity) and `resolveBoardCard` (→ relative
  index), and relativise the `MSG_BECOME_TARGET` player in
  `onBecomeTarget`. Fold into **Lot 0**.
- **The CLI must change too.** It feeds `PreComputedState.boardState`
  (relative-to-P0). For `--perspective 1` it must swap the board to
  relative-to-viewer *before* `ingestState` — the same one-line
  `[players[1], players[0]]` swap `ReplayDuelAdapter.swapBoardState`
  does. Today the CLI relies on the builder's (buggy) swap; after the
  fix the builder no longer swaps, so the CLI owns it. **This also fixes
  the prototype's latent perspective-1 bug** — a free correctness win.
- **Replay live integration**: `ReplayDuelAdapter` already produces a
  relative-to-viewer board for the RBS (`swapBoardState`). If the
  `DuelGameLogService` feeds the builder from `logicalState()` (§2.4),
  the board is already correct — no extra swap. If instead it were fed
  raw `PreComputedState.boardState` it would need the same P0→viewer
  swap as the CLI. **Feed from `logicalState()`** — one source, already
  relative, both modes (this is the §2.4 recommendation, and O5
  reinforces it).

⚠️ **Still the single most important finding for the implementer**, but
now *resolved*, not open. The builder's board contract is: **relative-to-
viewer in, no swap**. Anything that feeds it (live service, CLI, replay)
relativises the board to the viewer *before* handing it over.

### 4.4 Bubble perspective

Trivial by comparison — covered in §3.3. The bubble relativises one field
(`MSG_CHAINING.player`) with the same accessor the service uses. No board
snapshot involved.

---

## 5. Styling — porting `game-log.css` to the DS

`game-log.css` is a **standalone stylesheet** whose `:root` *copies* DS
token values by hand (the file header says so: *"Tokens `:root`
synchronised on `front/src/app/styles/_tokens.scss`"*). A standalone HTML
file has no SCSS access, so the copy is unavoidable *for the prototype*.
In an Angular component it is a **DS violation** — `CLAUDE.md` is
explicit: colours always a token `var(--…)`, literal hex only in
token-defining files.

### 5.1 Token reconciliation — three buckets

The `:root` block in `game-log.css` declares ~60 tokens. Sorting them:

**Bucket A — already real DS tokens, just consume them.** `--text-xs/sm/md/lg`,
`--space-1..7`, `--radius-*`, `--elevation-2/3`, `--gold`, `--gold-50`,
`--gold-on-surface`, `--gold-soft-*`, `--self-blue*`, `--opp-amber*`,
`--surface-bg*`, `--border-*`, `--text-primary/secondary/muted/inverse`,
the `--font-*` families. These exist in `_tokens.scss`. The component
SCSS **deletes the local copies and inherits them** — they cascade from
the app root. Zero work beyond *not* re-declaring them.

**Bucket B — game-log-specific tokens that must be ADDED to the DS token
layer.** The chantier (D-D) is explicit: the 6 `--gl-*` typographic
tokens (`--gl-title`, `--gl-text`, `--gl-label`, `--gl-icon-title/-text/
-label`) plus the two pictogram sizes (`--gl-pictogram`, `--gl-pile-tag`).
And the chantier's D-A aliases `--duel-side-self` / `--duel-side-opponent`
(/`-border`). These are *semantic handles* — they belong in `styles/**`
(the token layer), declared once, as **aliases of existing tokens** (D-A:
"aliases of `--self-blue` / `--opp-amber`", not new hues). ~10 tokens.

**Bucket C — local derived values that stay component-scoped.** The
`game-log.css` file invents a handful of surfaces/gradients not in the DS:
`--surface-row`, `--surface-effect`, `--surface-sub`, `--surface-zonecell`,
`--thumb-grad`, `--cardback-grad`, `--glow-target`, `--combat-atk/def/dmg`
(+ soft variants), `--action-add/rem`, `--negated`. Per the
`ds-token-doctrine` memo: a value used 3+ times → token; component
geometry → local. These are mostly **component-local** — declare them in
the component's SCSS `:host` block, *derived from* DS tokens where
possible (e.g. `--combat-dmg-soft-10` from a DS danger token). The ones
that are genuinely shared semantics (the combat ATK/DEF colours might
already exist as `--pvp-*` tokens — verify against `_tokens.scss`) get
promoted to Bucket B. **Audit each against `_tokens.scss` during the
visual pass** — `CLAUDE.md`'s anti-pattern list (`ds-token-anti-patterns`)
warns specifically against hardcoded rgba and "détourné" tokens.

### 5.2 Elements that must become DS components

The prototype emits raw `<div>`/`<button>` chrome. The Angular component
must use DS primitives (`CLAUDE.md` non-negotiable rule):

| Prototype markup | DS replacement |
|------------------|----------------|
| `.gamelog__close` button | `<app-icon-button>` (close icon) |
| `.gamelog__newpill` ("↓ new entries" affordance, G3) | `<app-pill>` (clickable) or `<app-button>` size-small |
| The trigger button (replaces the dev-hub button) | `<app-icon-button>` (history/scroll icon — chantier §6.3) |
| `.material-icons-round` glyphs | `<mat-icon>` sized via `@include icon-size(...)` — never the hand-written `font-size` trio |
| Turn-header avatar (`.lg-turn__avatar`, currently a hand-rolled djb2 disc) | `<app-avatar>` — §7.2 |
| Card thumbnails (`.lg-thumb--art`) | Stay a plain `<img>` — there is no DS "card thumbnail" primitive; the `<img src>` comes from `DuelCardArtService.resolveUrl` (§7.3). |
| Chain-link badge (`.badge-cl`) | `.badge` is an allowed *global* class (`CLAUDE.md`: "`.badge` stays a global class") — reuse it, do not re-invent. |
| `.lg-row`, `.lg-board`, `.lg-bare`, etc. | Stay **component-internal SCSS** — these are bespoke log structures, not DS primitives. They are the legitimate component-scoped styling. |

### 5.3 The bubble's style — reconciling the dropped `.bubble*` classes

The original mockup had `.bubble`, `.bubble-demo`, `.bubble-duelist`
classes, **removed** from `game-log.css` because the offline tool never
emits a bubble. The bubble is a *new component* — `<app-effect-bubble>`
(or similar). Its SCSS:

- **Surface:** a DS surface token (`--surface-card-ds` / `--pvp-zone-
  browser-bg`-family) + `--gold` border/glow (the chantier §6.1: gold
  *background/border/glow* → `--gold`; gold *text* → `--gold-on-surface`).
- **The ⚡ glyph:** `<mat-icon>` + `@include icon-size`.
- **Effect text:** `--gl-text` (Bucket B) — same scale as the panel's
  effect description, for consistency.
- **Max-height + internal scroll** (guard-rail G1): a `max-height` in
  the SCSS + `@include ghost-scroll` for the overflow (the skytrix ghost
  scrollbar convention).
- **Enter/exit animation:** fade+slide in, fade out — timed by the new
  `EFFECT_BUBBLE_FADE_MS` constant (chantier §5.8).

The dropped `.bubble*` classes are **not resurrected** — they were
mockup-era ad-hoc CSS. The bubble is built fresh from DS tokens, like any
new component. Register `<app-effect-bubble>` and `<app-game-log>` in
`front/DESIGN-SYSTEM.md` (the chantier §6 + the `ds-catalogue` memo rule:
every new `components/` entry must be catalogued — *if* they live under
`components/`; a duel-page-scoped component lives under `pvp/duel-page/`
and is not a DS primitive, so confirm placement first — see §8 O6).

### 5.4 Visual-fidelity doctrine — what "respect the mockup" means

This section closes a gap the rest of the analysis left open: it answers
*how visually faithful* the Angular result must be, and to *which*
reference. Without it, "the mockup will be respected" is an unverifiable
claim and the first fidelity check happens far too late (Lot 6).

**The reference of record is `_bmad-output/game-log/a8859c98.html`** —
the generated `.html`, the chantier's declared "single visual reference"
(§8.5). It is the right oracle because it is **generated from the real
builder + the real renderer**: it cannot drift from the grammar, and it
already carries both columns (real replay + the synthetic showcase
catalogue). Decision (Axel, 2026-05-22): **the panel targets
`a8859c98.html`; the Master Duel captures are mood/origin reference
only.** The deprecated `_mockups/mockup-game-log.html` is **not** a
reference — the chantier deprecated it (§8.5).

**Fidelity is "faithful", not "pixel-identical" — and the gap is
intentional.** Three forces make a pixel match impossible *and
undesirable*:

1. **Token migration shifts values (§5.1).** The generated `.html`
   injects `game-log.css`, whose `:root` *copies* DS values by hand. The
   Angular port replaces those copies with the *real* DS tokens. A
   hand-copied `--combat-dmg: #ff6b6b` may resolve, after promotion to a
   real DS token, to a marginally different hue. **This is correct** —
   DS conformity outranks fidelity to a hand-copied literal. Expect
   sub-perceptual colour/spacing shifts; do not "fix" them back.
2. **Static HTML strings → an Angular component tree.** The renderer
   emits raw HTML; the component is `OnPush` with real `<app-avatar>`,
   `<mat-icon>` (`@include icon-size`), `<app-icon-button>`. These
   primitives have their *own* metrics — an `<app-avatar size="sm">` is
   not byte-identical to the prototype's hand-rolled `.lg-turn__avatar`
   disc. The *layout* is faithful; the *primitives* are the DS's.
3. **The `.html` is a desktop, fixed-size artefact.** It has no
   responsive behaviour, no real scroll viewport, no sticky-header
   interaction. The component must add those (chantier: sticky turn
   headers, G3 auto-scroll). The `.html` shows the *resting visual*; the
   component owns the *behaviour the `.html` cannot express*.

**Already-known intentional divergences** (do not flag these as bugs in
the visual pass):

- **D-A** — opponent band is **amber** (`--opp-amber`), not the Master
  Duel red. A chantier decision; the `.html` already reflects it.
- **D-B / D-C / D-D** — chain-as-grouped-block, bare-row weight, the
  3-level type scale. The `.html` reflects them; the captures do not.
- **The bubble has NO visual reference at all.** Its `.bubble*` mockup
  classes were deleted (§5.3); no capture isolates it. **Surface 2 is a
  fresh design** — "respecting the mockup" does not apply to it. It is
  governed by the chantier's *behavioural* spec (§4.1 ASCII sketch +
  guard-rails G1/G2) and DS tokens, nothing more. The visual pass
  *creates* the bubble's look; it does not *match* one.

**The fidelity check moves earlier than Lot 6.** The original breakdown
parked all visual verification in Lot 6 — meaning a structural mismatch
would surface only at the very end. Correction: add a **fidelity
checkpoint at the end of Lot 4** (panel built, before the bubble and the
replay-parity work). At that point, render the live panel against the
`a8859c98` replay and **diff it side-by-side with `a8859c98.html`**.
This catches a structural drift while Lot 5/6 can still absorb it. Lot 6
keeps the *final polish* pass (the captures' "spirit", DS audit, i18n) —
but the *structural* fidelity gate is end-of-Lot-4. Fold this into the
work breakdown (§9, new step 4g).

**Acceptance reframed.** "The mockup is respected" means, concretely:
the live panel, fed the `a8859c98` replay, is **structurally and
typographically faithful to `a8859c98.html`** — same five-block grammar,
same row anatomy, same chain grouping, same type hierarchy — with only
(a) DS-token value shifts, (b) DS-primitive metric differences, and
(c) added responsive/scroll behaviour as permitted deltas. It is **not**
a pixel-diff gate.

---

## 6. Missing data

### 6.1 Player pseudos

- **Replay:** `REPLAY_METADATA.playerUsernames` — `[string, string]` in
  **absolute** `[P0, P1]` order. The replay page already reads it. The
  service relativises to `[you, opp]` exactly as the CLI does
  (`game-log-builder-cli.ts` swaps when `perspective === 1`).
- **PvP live:** the duel page already exposes `ownPlayerPseudo` /
  `opponentPseudo` as `computed`s derived from the room state
  (`room().player1.pseudo` / `player2.pseudo`). The `DuelGameLogService`
  reads those two computeds. **No new data source needed** — the pseudos
  are already in the duel page's component state.

The service exposes the pseudo pair in **relative** order `[you, opp]` so
both the turn separators and the bubble anchor ("opponent's name") read
it uniformly.

### 6.2 Avatars

Reuse `<app-avatar>` directly — `front/src/app/shared/avatar/`. Its API:
`pseudo` (required input), `size` (`'sm'|'md'|'lg'|'xl'`), `ariaLabel`.
The prototype's `avatarMarkup()` is a hand-rolled djb2 copy of the
component's hashing — in Angular, **delete that copy, use `<app-avatar>`**.
The hash formula is identical (the prototype copied it deliberately), so
the rendered colour is the same — no visual regression.

### 6.3 Card artwork

`DuelCardArtService.resolveUrl(cardCode)` — already the pattern the
zone-browser overlay uses. It returns a prefetched URL or falls back to
`/api/documents/small/code/{cardCode}`. The prototype's CLI hardcodes
`/documents/small/code/{code}` against Spring Boot; the front uses the
service. **The Angular component injects `DuelCardArtService` and calls
`resolveUrl` for every revealed thumbnail.** No new service.

---

## 7. Recommended architecture

### 7.1 Component / service map

```
┌─ shared/game-log/ (NEW shared module) ─────────────────────┐
│  game-log-types.ts      ← MOVED from duel-server, .js-stripped│
│  game-log-builder.ts    ← MOVED, made incremental (§1.2)     │
│  (byte-synced front↔back, like ws-protocol — §6 / scripts)   │
└────────────────────────────────────────────────────────────┘
        ▲ imports                          ▲ imports
        │                                  │
┌─ duel-server ─────────┐    ┌─ front: pvp/duel-page/ ────────────┐
│ game-log-cli (impure) │    │ DuelGameLogService                 │
│ game-log-markdown.ts  │    │  · taps orchestrator notifyGameLog  │
│ game-log-html.ts      │    │  · drives GameLogBuilder            │
│ effect-desc-resolver  │    │  · gameLogEntries: Signal<…>        │
└───────────────────────┘    │  · lastOpponentActivation: Signal<…>│
                             │    (for the bubble)                 │
                             ├────────────────────────────────────┤
                             │ <app-game-log>     (Surface 1 panel)│
                             │ <app-effect-bubble>(Surface 2)      │
                             └────────────────────────────────────┘
   provided at duel-page AND replay-page component level
   (same scope as DuelDebugService)
```

### 7.2 Why this shape — alternatives rejected

| Decision | Chosen | Rejected alternative | Why |
|----------|--------|---------------------|-----|
| Hook point | `notifyGameLog(event)` inside `processEvent` | `DuelEventProcessor` tap; `AnimationDataSource` signal | Two instances → manual parity. Orchestrator is the one shared instance; the tap inside `processEvent` also gets buffer-dedupe + correct order for free. |
| Tap timing | Post-buffer dispatch point | Top of `_handleEntry` | A buffered chain event would log twice + out of order. |
| Builder location | Shared module, byte-synced | Keep in duel-server, front re-implements | Re-implementation = two grammars to keep in sync = the `no-doc-code-divergence` rule violated. |
| Builder location | Shared module, byte-synced | Front imports duel-server path directly | Cross-package import + `.js` suffix mismatch; the ws-protocol precedent is byte-sync. |
| Bubble data source | Raw `MSG_CHAINING` event | Build a `GameLogEntry` for the bubble | YAGNI — the bubble needs 2 fields, not the 5-block grammar. |
| Bubble anchoring | CDK overlay | Inline element + z-index | z-index arithmetic against the inline chain overlay is fragile; CDK container is always above by construction; matches the `983b9865` hover precedent. |
| Builder feed (both modes) | Same incremental `ingestEvent` path | Replay keeps `ingestState` batch, PvP incremental | Two code paths = two behaviours to keep in parity. One path = parity by construction. |
| Board snapshot for live | `logicalState()` | `renderedState()` | `renderedState` zones lag metadata during animation; `logicalState` is the synchronised pair. |
| Perspective flip (replay) | Rebuild log from retained raw events (P1) | Store absolute, relativise in template (P2) | P2 guts the builder's validated relativisation. P1 keeps the builder intact. |

### 7.3 `descriptionText` wiring (chantier §5.1–5.2 — restated as the dependency it is)

The bubble and the panel's activation rows both need the effect text.
`MSG_CHAINING` carries a numeric `description` code; the front drops it.
The server-side resolution already exists (`getOptionDesc` in
`duel-worker.ts`, mirrored by `effect-desc-resolver.ts`). The production
wiring:

1. `duel-server` — add `descriptionText?: string` to `ChainingMsg` in
   `ws-protocol-game.ts`, populate it in `duel-worker.ts` via
   `getOptionDesc`. (ws-protocol sub-file → byte-synced front↔back by
   `check-ws-protocol-sync.mjs`.)
2. `front` — `DuelEventProcessor.buildChainLinkState()` copies
   `descriptionText` onto `ChainLinkState` (today the field is dropped).
3. The `DuelGameLogService` reads `descriptionText` straight off the
   tapped `MSG_CHAINING` event — for both the bubble and the builder's
   `resolveDescription` (the builder's `DescriptionResolver` becomes "read
   the field off the event" instead of a sqlite lookup; live + replay
   both get the text from the server, no client-side `cards.cdb`).

This is **prerequisite work** — the builder's activation rows are empty
of text until it lands. Sequence it first (§8 lots).

**Replay note (O7 — resolved):** `descriptionText` works in replay for
free. Replay precompute does not store `PreComputedState[]` — it
recomputes them at read time from the stored raw OCGCore stream
(`replay-precompute.ts`). So if step 1 populates `descriptionText` at
`MSG_CHAINING` build time and the precompute shares that build path, old
replays inherit it on their next load. The one dev-time check is that
the precompute's `MSG_CHAINING` construction reaches `getOptionDesc`
(`cards.cdb` is available server-side at precompute). See R4 / O7.

---

## 8. Risk ledger (ordered by severity)

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| **R1** | **Wrong board relativisation in the builder** (O5 — RESOLVED). The builder's `relLp` swaps `players[]` and `resolveBoardCard` indexes by absolute, assuming an absolute board. But every board source (`logicalState()` live, `PreComputedState.boardState` replay) is **relative-to-viewer** (or P0). The builder both double-swaps LP and resolves targets on the wrong half. **The prototype already carries this bug latent** — correct in `--perspective 0` by coincidence, broken in `--perspective 1` (never visually tested). | **Critical → resolved** | O5/§4.3: builder contract = **relative board in, no swap**. Fix `relLp` (→ identity), `resolveBoardCard` (→ relative index), relativise `MSG_BECOME_TARGET.player` in `onBecomeTarget`. CLI swaps P0→viewer before `ingestState`. Live feeds `logicalState()` (already relative). Fold into Lot 0. |
| **R2** | **Buffered chain events logged twice / out of order.** During chain resolution, board-changing events pass through `processEvent` at buffer time *and* replay time. A naïve tap logs both. | **High → resolved** | §2.3: the tap sits *inside* `processEvent`, after line 1048, before the switch (line 1050). A buffered event returns at line 1035 *before* the tap on its first pass; it reaches the tap only when `replayBuffer` re-dispatches it (`_isReplayingBuffer` true). Logged once, in resolution order. One line, no dedupe plumbing. |
| **R3** | **Parity drift PvP↔Replay.** If the tap is wired per-mode (data source / event processor), the two wirings can diverge. | **High** | Tap the *shared* orchestrator instance. One hook, both modes. Regression test: diff live service output vs CLI offline build of the same replay. |
| **R4** | **Replay `descriptionText` gap** (O7 — RESOLVED). Concern was: old replays show no effect text. | **Negligible** | Replay precompute does NOT store `PreComputedState[]` — it recomputes them at read time from the stored raw OCGCore stream (`replay-precompute.ts`: `transformMessage` → `filterMessage` per replay load). So if `duel-worker.ts` populates `descriptionText` at `MSG_CHAINING` build time, and the precompute re-runs the same build path, **old replays get it for free**. One thing to confirm at dev time: the precompute's `MSG_CHAINING` construction shares the `getOptionDesc` call path (`cards.cdb` is available server-side at precompute). No client fallback needed. |
| **R5** | **Live render perf.** A long duel = hundreds of `GameLogEntry`s. Re-rendering the whole panel on every new entry, every frame, is wasteful. | **Medium** | `OnPush` + a `Signal<GameLogEntry[]>`; `@for` with `track`. The panel is *closed by default* (chantier) — when closed, render nothing (`@if (panelOpen())`). The builder runs regardless (cheap, pure), the *DOM* only exists when open. Consider CDK virtual scroll if a duel exceeds a few hundred rows (the lobby already uses CDK virtual scroll — established pattern). |
| **R6** | **Bubble flicker on a fast chain.** 3 `MSG_CHAINING` within 300ms strobes 3 contents. | **Medium** | Minimum-visible floor before a content swap (§3.4.1) — a *new* guard-rail. → O8. |
| **R7** | **Perspective flip mid-replay invalidates built entries.** | **Low** | Retain raw tapped events; rebuild on flip (P1). Cheap — builder is pure. |
| **R8** | **Stale journal across a rematch** (upgraded from "timer leak"). A rematch reuses the same page component — `ngOnDestroy` does NOT fire — so a service that clears only on destroy carries duel 1's whole log into duel 2. The bubble timer leak is the *minor* part of this. | **Medium** | §3.6: `DuelGameLogService.reset()` (clear `entries` + reset `GameLogBuilder` + clear bubble timer) wired into the orchestrator's `resetAllState()` path (`animation-orchestrator.service.ts:533`) — the shared reset for `resetForSwitch` *and* `onStateSync`. Not `ngOnDestroy`. |
| **R9** | **Token drift.** `game-log.css` `:root` copies DS values; if ported carelessly the copies survive as hardcoded literals. | **Low** | §5.1 three-bucket sort: delete Bucket A copies, promote Bucket B to the token layer, derive Bucket C from DS tokens. Stylelint + the pre-commit hook catch literal hex. |
| **R10** | **Service instantiated too late** — an Angular component-level service is created on first injection. If only the panel injects `DuelGameLogService`, it misses every event before the panel is first opened. | **Medium** | §3.6: the duel-page / replay-page component injects `DuelGameLogService` in its own constructor (the `DuelDebugService` pattern), so it is live from the first frame. The panel is a consumer, never the trigger. |
| **R11** | **Re-dispatch order assumption.** The journal's chain ordering relies on `replayBuffer` re-dispatching buffered events to `processEvent` in *buffered (logical) order*, not `BufferReplayBuilder` (animation) order. If that ever changes, the journal order drifts. | **Low** | §2.3: documented as a verify-during-impl assumption. Lot 5b's regression diff (live service output vs CLI offline build, which walks `PreComputedState.events` in raw order) is the oracle that catches a drift. |
| **R12** | **Shared module freezes a duplication.** `game-log-builder.ts` declares the OCGCore `reason` bitmask constants *locally* (to preserve purity) — already a duplicate of `replay-precompute.ts`. Moving the builder into a byte-synced shared module freezes this duplication across front + back + precompute. An OCGCore `reason` flag change must then be edited in 2-3 places. | **Low (accepted)** | Accepted, not mitigated: consolidating the bitmask source is out of scope here. Flagged so a future reader knows it is deliberate. A single shared `reason-flags.ts` in the same shared module would close it later if it ever bites. |

---

## 9. Work breakdown (lots + dependency order)

The chantier §9 gives a delivery sequence; this refines it into lots with
explicit dependencies and the new findings folded in.

```
Lot 0 ─ Builder hardening (prerequisite, no UI)
  0a. O5 board-contract fix (RESOLVED — C2): relLp → identity,
      resolveBoardCard → relative index, relativise
      MSG_BECOME_TARGET.player in onBecomeTarget. Update the
      CLI to swap P0→viewer before ingestState for
      --perspective 1 (also fixes the prototype's latent
      perspective-1 bug). Update game-log-builder.spec.ts.
  0b. Make GameLogBuilder incremental: public ingestEvent +
      syncTurnAndPhase (§1.2 option A).
  0c. O9: VERB / PHASE_LABEL / WIN_REASON → i18n key maps.
      CLI Markdown/HTML renderers keep a local FR key→string
      table (dev artefact, not i18n-bound).
  0d. Move game-log-types.ts + game-log-builder.ts to a shared
      module; add to the byte-sync check (like ws-protocol).
        → unblocks Lot 2, Lot 3.

Lot 1 ─ Server + transport (prerequisite for effect text)
  1a. descriptionText on ChainingMsg (ws-protocol-game.ts, both
      sides, byte-synced).
  1b. Populate it in duel-worker.ts via getOptionDesc.
  1c. ChainLinkState.descriptionText + buildChainLinkState copy.
  1d. Confirm the replay precompute MSG_CHAINING build shares
      the getOptionDesc path so old replays inherit it (O7).
        → unblocks the bubble content + builder activation text.

Lot 2 ─ DuelGameLogService (the spine)
  2a. notifyGameLog(event) — ONE call inside processEvent,
      between line 1048 (updateLogical) and line 1050 (the
      dispatch switch). No board parameter. depends on: Lot 0.
  2b. The service: tap, drive the builder, accumulate
      gameLogEntries signal, turn/phase synthesis from
      logicalState(), perspective relativiser. Retain raw
      tapped events (for the P1 perspective-flip rebuild, R7).
  2c. lastOpponentActivation signal (raw MSG_CHAINING, opponent-
      filtered) for the bubble. depends on: Lot 1 (descriptionText).
  2d. Provide at duel-page AND replay-page level — and INJECT
      it in the page component constructor so it is live from
      frame one (R10), not on first panel open.
  2e. DuelGameLogService.reset() wired into the orchestrator's
      resetAllState() path (animation-orchestrator.service.ts:533)
      — clears entries + builder + bubble timer on rematch /
      switch / state-sync (R8). NOT ngOnDestroy.
        → unblocks Lot 3, Lot 4.

Lot 3 ─ Surface 2: the effect bubble
  3a. <app-effect-bubble> component — CDK overlay anchored to the
      opponent duelist card, DS tokens, mat-icon glyph.
      pointer-events: none wrapper + auto content box (§3.4).
  3b. Hold timer (EFFECT_BUBBLE_MS scaled), last-wins replace,
      min-visible floor (O8), fade in/out (EFFECT_BUBBLE_FADE_MS).
  3c. animation-constants.ts: EFFECT_BUBBLE_MS / _MIN_MS /
      _FADE_MS / _MIN_VISIBLE_MS.
  3d. Dev-hub trigger (§3.7): effect-bubble-fixtures.ts catalogue
      (short / long / rapid-burst / self-suppressed), a dev-only
      DuelGameLogService.injectDevChaining(fixture) feeding a
      synthetic MSG_CHAINING through the real pipeline (D1), and
      a dev-hub tab/section (O11). isDevMode()-gated, tree-shaken
      in prod. Dev events flagged so they DON'T pollute the
      journal builder. Gated on 3a/3b existing.
        depends on: Lot 2c.

Lot 4 ─ Surface 1: the game-log panel
  4a. Port game-log.css → component SCSS, three-bucket token
      sort (§5.1). Add the --gl-* + --duel-side-* tokens to the
      token layer.
  4b. <app-game-log> — the five-block render tree as an Angular
      template (re-expressing game-log-html.ts logic), OnPush,
      @if(open) gate, @for+track.
  4c. Panel chrome modelled on pvp-zone-browser-overlay:
      setupClickOutsideListener, onKeydown (Escape), isClosing.
  4d. Sticky turn headers, auto-scroll G3 + "↓ new entries" pill.
  4e. Click-a-row → card-inspector (reuse inspectCard pattern).
  4f. Trigger button: replace the dev-hub on-screen button in
      PvP with an <app-icon-button>; keep the dev hub on its
      Ctrl+Shift+D shortcut (O2 already resolved).
  4g. STRUCTURAL FIDELITY GATE (§5.4): render the live panel
      against the a8859c98 replay, diff side-by-side with
      a8859c98.html. Same five-block grammar, row anatomy,
      chain grouping, type hierarchy — DS-token / DS-primitive
      shifts allowed. A structural mismatch is fixed HERE, while
      Lot 5/6 can still absorb it — not deferred to Lot 6.
        depends on: Lot 2.

Lot 5 ─ Replay parity check
  5a. Provide both surfaces at replay-page level (done in 2d) —
      verify they render in replay with zero extra wiring.
  5b. Regression test: drive a8859c98 replay, diff service
      output vs CLI offline build. depends on: Lot 2,3,4.

Lot 6 ─ Final visual polish + DS audit
  6a. Polish pass — fidelity "spirit" vs the Master Duel
      captures (O4); the STRUCTURAL gate already passed at 4g,
      so this is refinement, not a structural check.
  6b. DESIGN-SYSTEM.md registration of the new components.
  6c. i18n keys FR + EN for every verb/label (builder emits
      keys per O9 — Lot 0c; this lot adds the FR + EN entries).
  6d. lint + stylelint + ws-protocol-sync green; specs green.
```

**Critical path:** `0a → 0b/0c/0d → 2a/2b → {3, 4→4g} → 5 → 6`. Lot 1
runs in parallel with Lot 0 (independent), but **must** land before Lot
3c and Lot 4b's activation rows. **Lot 0a (the O5 board-contract fix)
must land first** — every consumer of the builder is incorrect until it
does; the decision itself is made (§10), only the code change remains.
**Step 4g is the structural fidelity gate** (§5.4) — a hard checkpoint,
not optional polish; a structural mismatch found there is cheap to fix,
the same mismatch found at Lot 6 is not.

---

## 10. Open questions — all resolved (2026-05-22)

The chantier resolved O1–O4. O5–O10 surfaced from this technical
analysis and were **all decided 2026-05-22** after a code-grounded review
with the user. None remain open — the table below is the decision log.

| ID | Question | DECISION |
|----|----------|----------|
| **O5** | **Builder board-input contract** (R1). Absolute or relative board snapshot? | **RESOLVED — relative (C2).** Code proof (§4.3): `replay-precompute.ts:357` feeds the builder a P0-relative board, never absolute; `logicalState()` is relative-to-viewer in both modes. The builder contract is **relative board in, no swap**: `relLp` → identity, `resolveBoardCard` → relative index, `MSG_BECOME_TARGET.player` relativised in `onBecomeTarget`. The CLI swaps P0→viewer before `ingestState` for `--perspective 1` (this also fixes the prototype's latent perspective-1 bug). Fold into Lot 0. |
| **O6** | **Component placement.** `components/` (DS core) or `pvp/duel-page/` (feature-scoped)? | **RESOLVED — feature-scoped** (`pvp/duel-page/`). Duel-specific, not reusable primitives. Documented in `DESIGN-SYSTEM.md`'s relevant section per the chantier, but not in the 36-component DS core. |
| **O7** | **Old-replay `descriptionText`.** Do replays recorded before Lot 1 show empty effect text? | **RESOLVED — no gap.** Replay precompute recomputes `PreComputedState[]` at read time from the stored raw OCGCore stream (`replay-precompute.ts`). If `duel-worker.ts` populates `descriptionText` at `MSG_CHAINING` build time and the precompute shares that path, old replays get it for free. No client fallback. One dev-time check: precompute's `MSG_CHAINING` build uses the `getOptionDesc` path (R4). |
| **O8** | **Bubble min-visible floor** — coalesce a fast-chain burst? | **RESOLVED — yes.** Add `EFFECT_BUBBLE_MIN_VISIBLE_MS` ≈ 700ms. "Last effect wins" alone does not prevent a 3-frame strobe; the floor coalesces a burst to "first link briefly → final link". Cheap. Fold into Lot 3. |
| **O9** | **Builder `VERB` map → i18n.** Builder emits i18n keys or final French strings? | **RESOLVED — builder emits stable keys; the component translates.** Keeps the builder pure + language-agnostic; EN support (chantier acceptance criterion) comes free. `VERB`/`PHASE_LABEL`/`WIN_REASON` become key maps. ⚠️ The CLI's Markdown/HTML renderers consume French strings today — they keep a local FR key→string table (the CLI is a dev artefact, not i18n-bound). Fold into Lot 0. |
| **O10** | **Panel virtual scroll** — plain `@for` or CDK virtual scroll? | **RESOLVED — plain `@for`+`track` first.** Panel closed by default → DOM only when open. CDK virtual scroll only if a real duel measurably janks (the lobby's usage is the reference if needed). YAGNI. |
| **O11** | **Dev-hub bubble trigger placement** (§3.7) — a 4th `DuelDevHub` tab, or a section appended to the existing Prompts tab? | **RESOLVED — a 4th tab ("Game Log" or "Effects").** A dedicated tab leaves room for a future game-log-panel dev affordance (toggle, fixture-fed panel) without re-crowding Prompts. The cost is one `@case` + one tab button — trivial, the hub is already a 3-tab `@switch`. Non-blocking; revisit only if the tab stays single-purpose forever. |

---

## 11. Summary

- The `game-log/` core (`game-log-types.ts` + `game-log-builder.ts`) is a
  **clean, pure, browser-safe brick** — reuse it, do not reimplement. It
  needs **two adaptations**: (1) a public incremental `ingestEvent` API
  (its own docstring anticipated this), (2) the O5 board-contract fix
  (`relLp` → identity, `resolveBoardCard` → relative index).
- **All open questions O5–O10 are now resolved** (§10) — the analysis is
  decision-complete; nothing blocks moving to an implementation plan.
- **Parity is free if the tap is in the shared orchestrator.** A single
  `notifyGameLog` dispatch point, called at genuine-dispatch time (after
  buffering), covers PvP and Replay by construction — no manual mirroring.
- **The two surfaces share the tap and the perspective relativiser, not
  the builder output.** The panel consumes `GameLogEntry[]`; the bubble
  reads two fields straight off the raw `MSG_CHAINING` event. Building a
  `GameLogEntry` for the bubble would be YAGNI.
- **The single highest risk was wrong board relativisation** (R1) — and
  the code review found it is **not** a "live-only" risk: the builder
  treats the board as absolute, but every board source (replay precompute,
  `logicalState()`) is relative. **The prototype already carries this bug
  latent** — correct in `--perspective 0` by coincidence, broken in
  `--perspective 1`. O5/C2 fixes it in the builder; the CLI fix is a free
  correctness win for the prototype too.
- The bubble is the genuinely new build; anchor it as a **CDK overlay**
  on the opponent duelist card (matches the recent chain-hover precedent),
  fire it off the real-time, non-buffered `MSG_CHAINING`, and add a
  min-visible floor (`EFFECT_BUBBLE_MIN_VISIBLE_MS`) against fast-chain
  strobing.
- Styling: **port, don't copy** — three-bucket token sort, DS primitives
  for all chrome, the `--gl-*` scale promoted to the token layer.
- `descriptionText` on `ChainingMsg` is **prerequisite** work (Lot 1) —
  the activation rows and the bubble are textless until it lands; old
  replays inherit it for free via precompute (O7).
```
