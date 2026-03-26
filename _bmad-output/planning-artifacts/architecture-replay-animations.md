---
title: "Replay Animation Architecture v4 — AnimationDataSource + Over-the-Shoulder"
description: "AnimationDataSource interface extracted from DuelWebSocketService for transparent orchestrator reuse, phased queue splitting for decision-pause replay, enriched PreComputedState with prompt+response pairing. Full visual parity with live PvP + readonly prompt display."
date: 2026-03-24
version: "4.5"
supersedes: "v1 (feeder pattern), v2 (DuelConnection-only), v3 (incorrect DuelConnection abstract — DuelConnection is already a concrete class), v4 (missing pending chain entry pattern, MSG_CHAIN_NEGATED, incomplete DRY signatures), v4.1 (type safety violation in filterEventsForQueue, busy signal edge cases, phaseService.show signature mismatch), v4.2 (granularity signal name collision with existing logDetail, missing abortAndClean DRY helper, filterEventsForQueue blacklist rationale undocumented), v4.3 (missing prompt context: hintContext and confirmedCards not carried in DecisionMoment), v4.4 (prompt timing race, busy cleared between segments, missing queue watcher effect, activeResponse wrapper mismatch, multi-decision events not interleaved, worker boundary logic unchanged)"
status: planning
inputDocuments:
  - architecture-replay.md
  - architecture-pvp.md
  - ux-design-specification-replay.md
  - epics-replay.md
  - architecture-replay-animations-v2.md (absorbed)
---

# Replay Animation Architecture v4

## Goal

Make replay a **"look over the shoulder" experience**: the viewer sees exactly what each player saw — full animations, prompts appearing with the chosen answer highlighted, zone selections marked — all in read-only. Two prompt modes:

- **Result mode** (default): step = 1 response. Prompt flashes briefly, animation plays, board advances.
- **Decision mode**: step = prompt phase → selection highlight → animation → next prompt. The viewer sees *what the player was deciding* before seeing the result.

Controlled by the existing `animationsEnabled` toggle (animations on/off), `promptMode` toggle (result/decision), and a new **`perspectiveIndex` toggle** (view from player 0 or player 1).

> **Naming note:** The existing `ReplayPageComponent` already has a `granularity` signal (`'normal' | 'debug'`) that controls debug log detail level (collapsed vs expanded events, toggled via `G` key). To avoid collision, the new decision-pause toggle is named **`promptMode`** (`'result' | 'decision'`). The existing `granularity` signal is renamed to **`logDetail`** for clarity. Both are preserved in the rewrite.

---

## Why v4?

**v1** (feeder + `*ForReplay()` methods) had critical gaps: chain overlay protocol, card travel, pre-masking all undocumented — the feeder would need to replicate orchestrator internals.

**v2** (DuelConnection abstraction) solved this cleanly but lacked the "over the shoulder" experience — prompts and player decisions were invisible in replay.

**v3** proposed making `DuelConnection` an abstract class. **But `DuelConnection` is already a concrete class** (840 lines) — the actual WebSocket data layer with signals, message handling, reconnect logic. `DuelWebSocketService` is a facade that delegates to `DuelConnection` instances via `_activeConnection()`. Making `DuelConnection` abstract would break the entire live duel stack.

**v4** fixed this by extracting an **`AnimationDataSource` interface** from the 13 methods/signals that `AnimationOrchestratorService` + `PvpChainOverlayComponent` actually consume. Both `DuelWebSocketService` (live) and `ReplayDuelAdapter` (replay) implement it. Additionally:
1. **Enriched data model** — each `PreComputedState` carries a `decisions[]` array (not singular) to support multi-prompt transitions (chain: `SELECT_CHAIN` × N)
2. **Phased queue splitting** — the adapter cuts the event queue at `SELECT_*` boundaries, creating a natural pause for prompt display without touching the orchestrator
3. **Read-only prompt display** — existing `PvpPromptDialogComponent` + `PromptZoneHighlight` gain `readOnly` + `preSelected` inputs. `SELECT_IDLECMD`/`SELECT_BATTLECMD` (currently in `IGNORED_PROMPT_TYPES`) get a dedicated read-only renderer.

The orchestrator remains **completely untouched**. All decision-pause logic lives in `ReplayDuelAdapter`.

### v4 → v4.1 Changes (code audit against actual codebase)

1. **Pending chain entry pattern** — `dequeueAnimation()` rewritten to mirror DuelConnection's deferred commit behavior. MSG_CHAINING stores the link as `_pendingChainEntry`, committed only at 5 specific points (SELECT_CHAIN, WAITING_RESPONSE, MSG_CHAIN_SOLVING, next MSG_CHAINING, MSG_CHAIN_END). Prevents chain overlay from showing cards before cost payment is complete.
2. **MSG_CHAIN_NEGATED handler** — added synchronous negation handling in `dequeueAnimation()`. Sets `negated: true` on the chain link, triggering the overlay's "grey shake" animation.
3. **SELECT_CHAIN stripped from queue** — `filterEventsForQueue()` strips ALL SELECT_* types. SELECT_CHAIN's commit-point role for the pending chain entry is handled by `dequeueAnimation()`'s internal loop (defensive) and by the other commit points (MSG_CHAIN_SOLVING, next MSG_CHAINING, MSG_CHAIN_END). Its prompt role is handled by `feedTransitionPhased()` splitting on raw events before filtering, with pause control driven by `decisions[]` (not queue scanning).
4. **DRY extraction signatures corrected** — 0A: uses `ChainLinkState` not `ChainLink`, documents actual computed names. 0B: full service signature with queue management, LiveAnnouncer, TranslateService, 5-field announcement object, 3 derived signals. 0D: expanded input types, compound condition documented.
5. **Known Limitations section** — documents 4 accepted trade-offs: omniscient-only draw mask, no 50ms safety timer, prompt readOnly not yet implemented, ghost card edge case with phased queue splitting.
6. **`abort()` updated** — also resets `_pendingChainEntry`.

### v4.1 → v4.2 Changes (cross-verification audit against actual codebase)

1. **`filterEventsForQueue()` blacklist clarified** — strips types with active roles in `dequeueAnimation()` (SELECT_*, MSG_CHAIN_NEGATED, WAITING_RESPONSE). Other non-GameEvent types (BOARD_STATE, TIMER_STATE, etc.) pass through intentionally — the orchestrator's `default: return 0` ignores them harmlessly. A whitelist was considered but rejected: it would silently drop new GameEvent types added to the union but forgotten in the whitelist (invisible bug). The type predicate `(e): e is GameEvent` is technically imprecise for pass-through types but safe given the orchestrator's default path.
2. **`dequeueAnimation()` rewritten as internal loop** — consumes MSG_CHAIN_NEGATED, WAITING_RESPONSE, and any SELECT_* that slip through filtering internally via `continue`, without returning them to the orchestrator. Only true `GameEvent` types are returned. In live PvP, these types are never in the animation queue (handled by `DuelConnection.handleMessage()`), so the loop is a defensive safety net.
3. **`resumeAfterPrompt()` rewritten as decisions-driven** — pauses are now driven by `_remainingDecisions[]` array (popping `DecisionMoment` entries), NOT by scanning the filtered queue for SELECT_* types. The old approach was broken: `filterEventsForQueue()` strips all SELECT_*, so `findIndex(e.type.startsWith('SELECT_'))` on filtered events would never find anything.
4. **`feedTransition()` empty queue guard** — if `filterEventsForQueue()` returns `[]`, applies pending board state directly and clears `busy`. Without this, the orchestrator's queue-watch effect (which only fires on `queue.length > 0`) would never start processing, leaving `busy = true` indefinitely.
5. **`resumeAfterPrompt()` busy always cleared** — `busy.set(false)` is now unconditional when queue is empty (regardless of `_pendingBoardState` being null). Previously, `busy` could stay `true` if pending board state was already applied by the orchestrator.
6. **`phaseService.show()` call fixed** — added missing `turnCount` argument (4th param) and replaced hardcoded `0` with `this.perspectiveIndex()` for correct "your turn"/"opponent's turn" labels.
7. **`onScrub()` cleanup added** — now calls `cardTravel.clearAllTravels()` + `phaseService.clear()`, matching `onSeek()` and `onStepBack()`. Prevents orphaned floating card elements during rapid scrubbing.
8. **Perspective toggle table corrected** — "re-display prompt from new perspective" replaced with accurate behavior: `abort()` clears prompt, user steps forward to re-trigger.
9. **`_activePrompt` type corrected** — changed from `Signal<GameEvent | null>` to `Signal<ServerMessage | null>` (prompts are ServerMessage types, not GameEvent).
10. **API Surface table clarified** — `activeChainLinks` marked as consumed by chain overlay ONLY (not by orchestrator). Orchestrator manipulates chain links via `applyChainSolving/Solved/End` methods but never reads the signal directly.

### v4.2 → v4.3 Changes (cross-verification audit against actual codebase)

1. **`granularity` signal renamed to `promptMode`** — the existing `ReplayPageComponent` already has `granularity = signal<'normal' | 'debug'>('normal')` (line 61) controlling debug log detail level via `buildReplayLogEntries()`. The new decision-pause toggle (`'result' | 'decision'`) was also named `granularity`, silently overwriting the existing feature. Fix: new toggle renamed to `promptMode`, existing signal renamed to `logDetail`. Keyboard shortcut `G` stays on `logDetail` (debug log toggle); a new shortcut is assigned to `promptMode`.
2. **`abortAndClean()` DRY helper extracted** — 6 callsites (`onStepForward` busy guard, `onStepBack`, `onSeek`, `onScrub`, `onToggleAnimations`, `onTogglePerspective`, `onFork`) all repeated the same 3-line pattern: `cardTravel.clearAllTravels()` + `phaseService.clear()` + `adapter.abort()`. Extracted into a single `private abortAndClean(): void` method. `ngOnDestroy` also uses it (+ `orchestrator.destroy()`). Prevents future callsites from forgetting one of the three cleanup steps.
3. **`filterEventsForQueue()` blacklist rationale documented** — the blacklist approach (strip known non-animation types, let unknown types through) is intentional and superior to a whitelist. The orchestrator's `processAnimationQueue()` switch has a `default: return 0` path that silently ignores unknown types. A whitelist would silently DROP new GameEvent types (e.g. `MSG_EQUIP`) if added to the union but forgotten in the whitelist — an invisible bug where animations never play. The blacklist is fail-open: new types pass through, reach the switch, and either have a case (works) or hit default (harmless no-op).

### v4.3 → v4.4 Changes (prompt context parity audit)

Two prompt context gaps identified: in live PvP, `DuelConnection` accumulates `_hintContext` (from `MSG_HINT`) as a **signal** and `_lastConfirmedCards` (from `MSG_CONFIRM_CARDS`) as a **plain property with getter** (not a signal — reactivity is driven by prompt changes, not by `_lastConfirmedCards` itself). Both are consumed by the prompt dialog. Neither is in `AnimationDataSource` (they are prompt enrichment, not animation state). Without replication, Decision mode prompts would display without contextual card names ("Activate?" instead of "Activate [Monster Reborn]?") and without excavated card context.

**Design decision:** Enrich `DecisionMoment` at capture time rather than replicating signals in the adapter. In live mode, hints/confirmed cards arrive as streaming messages *before* the SELECT_* — signals are necessary because data and consumer are temporally separated. In replay, the entire `events[]` batch is available at once — the context can be captured alongside the prompt in `DecisionMoment`, eliminating the need for parallel signals.

1. **`DecisionMoment` type enriched** — added `hint?: HintContext` and `confirmedCards?: CardInfo[]` optional fields. Carries the `MSG_HINT` and `MSG_CONFIRM_CARDS` context that was active when the prompt was sent. Both are reset after consumption (mirrors `DuelConnection`'s behavior where `_hintContext` is cleared after response and `_lastConfirmedCards` is replaced by the next `MSG_CONFIRM_CARDS`).
2. **`duel-worker.ts` pre-computation capture** — `runReplayPreComputation()` tracks `lastHint` and `lastConfirmedCards` accumulators. On each `SELECT_*`, they are included in the `DecisionMoment` and reset to null. ~10 lines.
3. **`ReplayDuelAdapter` signals** — added `activeHint: Signal<HintContext | null>` and `activeConfirmedCards: Signal<CardInfo[] | null>`. Set from `DecisionMoment` fields in `feedTransitionPhased()` and `resumeAfterPrompt()` (same 2 sites that already set `_activePrompt`/`_activeResponse`/`_activePlayer`). Cleared in `abort()`. ~8 lines.
4. **`PvpPromptDialogComponent` optional inputs** — added `hintContext = input<HintContext | null>(null)` and `confirmedCards = input<CardInfo[] | null>(null)`. In live mode, inputs are not passed (defaults to null) — the component continues reading from injected `DuelWebSocketService`. In replay, these inputs provide the context. ~2 lines.
5. **`ReplayPageComponent` template** — passes `adapter.activeHint()` and `adapter.activeConfirmedCards()` to the read-only prompt dialog. ~2 lines.

6. **`PvpPromptDialogComponent` location filter (bugfix)** — `_lastConfirmedCards` was injected into prompt components without filtering by card location. OCGCore sends `CONFIRM_CARDS` for hand activations (to reveal the card to the opponent), which caused cards activated from hand (e.g., Ponix) to appear in the "Revealed Cards" bandeau of the next prompt. Fix: filter to `LOCATION.DECK | LOCATION.EXTRA` at both injection sites (`attachComponent()` and `lastConfirmedName` hint fallback). This fix applies to live PvP immediately; replay inherits it because `DecisionMoment.confirmedCards` flows through the same prompt dialog component. The worker captures unfiltered `confirmedCards` (preserving full data), and the display layer filters — single responsibility.

**Total impact:** ~28 lines across 5 files. No new interface, no new service, no modification to `AnimationDataSource` or `DuelConnection`. Prompt context travels with the data in `DecisionMoment` — not in a parallel signal channel.

### v4.4 → v4.5 Changes (cross-verification audit against orchestrator queue-end flow + worker pre-computation)

Six issues identified by tracing the exact orchestrator end-of-queue sequence (`animation-orchestrator.service.ts` lines 550-558) and the worker's transition boundary logic (`duel-worker.ts` lines 1336-1371).

1. **Step queue pattern replaces `_pendingAfterPrompt` + `_remainingDecisions`** — v4.4's phased mode set `_activePrompt` synchronously in `feedTransitionPhased()`, meaning the prompt was visible WHILE Segment 1 animations were still playing. Root cause: no mechanism to defer prompt display until the orchestrator finishes. Fix: `ReplayStep` discriminated union (`'animate' | 'decide'`) + single `advanceStep()` consumer called from two points: `setAnimating(false)` (orchestrator finished a segment) and `resumeAfterPrompt()` (user/playback dismissed prompt). The orchestrator's exact end-of-queue order is `setAnimating(false)` (L551) → cleanup (L552-557) → `applyPendingBoardState()` (L558). The `setAnimating(false)` hook is the correct coordination point: animations are done, board state will be applied next.

2. **`busy` no longer cleared between segments** — v4.4's `setAnimating(false)` unconditionally called `busy.set(false)`, causing the `duelState` computed in ReplayPageComponent to switch from adapter state to pre-computed state mid-transition. Fix: `setAnimating(false)` now calls `advanceStep()`, which only sets `busy.set(false)` when ALL steps are exhausted.

3. **Single-signal decision state** — v4.4 had 5 separate signals (`_activePrompt`, `_activeResponse`, `_activePlayer`, `_activeHint`, `_activeConfirmedCards`) that had to be set/cleared in sync at 4 callsites. Fix: single `_activeDecision = signal<DecisionMoment | null>(null)` with 5 derived computeds. One `.set()` to show, one `.set(null)` to clear. Also fixes the `activeResponse` bug: v4.4 passed the `CapturedResponse` wrapper (`{ data, timestamp }`) instead of `response.data` — prompt components received the wrong format for selection highlighting.

4. **Queue watcher effect added to ReplayPageComponent** — the orchestrator has NO internal queue-watch. In live PvP, `DuelPageComponent` (line 876) has an effect that watches `wsService.animationQueue()` and calls `orchestrator.startProcessingIfIdle()`. Without this effect in the replay page, the orchestrator never starts processing events fed by the adapter. This was completely absent from v4.4.

5. **Multi-decision event interleaving** — v4.4 split the queue at the FIRST `SELECT_*` only. Events between subsequent `SELECT_*` boundaries were lumped into `_pendingAfterPrompt` and fed all at once after the last decision. In a chain sequence `[MSG_CHAINING, SELECT_CHAIN, MSG_CHAINING, SELECT_CHAIN, MSG_CHAIN_SOLVING]`, the second `MSG_CHAINING` (chain entry animation) would never play between decisions 1 and 2. Fix: `buildSteps()` splits at EVERY `SELECT_*` that has a matching decision, creating interleaved `animate` → `decide` → `animate` → `decide` → `animate` steps.

6. **Worker pre-computation boundary change** — v4.4 proposed capturing `decisions[]` in `DecisionMoment` but did NOT change the worker's transition boundary logic. The worker pushes a new `PreComputedState` at every `SELECT_*` (`duel-worker.ts` line 1370), meaning each state has at most 1 `SELECT_*` and `decisions[]` would always be `[0..1]` entries. For multi-decision transitions to exist, the worker must distinguish **transition boundary prompts** (`SELECT_IDLECMD`, `SELECT_BATTLECMD`) from **intermediate prompts** (all other `SELECT_*`). Intermediate prompts accumulate decisions within the current transition; boundary prompts flush and start a new transition.

7. **`collapseRemainingSteps()` for `promptMode` toggle** — switching from decision→result mode while a prompt is displayed now collapses remaining steps: skip all `decide` steps, merge remaining `animate` steps into one batch, feed to orchestrator. v4.4 called `resumeAfterPrompt()` once, which showed the next decision instead of collapsing.

8. **`commitPendingChainEntry()` on SELECT_CHAIN decide step** — in live PvP, `DuelConnection.handleMessage(SELECT_CHAIN)` calls `commitPendingChainEntry()` synchronously before setting `_pendingPrompt` (line 551). This makes the chain link visible in the overlay (via `activeChainLinks` signal → Effect A fade-in) concurrently with the prompt. In replay, SELECT_CHAIN is stripped from the animation queue and handled as a decide step. Without explicit commit, the pending entry stays uncommitted during the entire prompt pause — the chain overlay never shows the card, and its entry animation is lost. Fix: `advanceStep()` calls `commitPendingChainEntry()` when the decide step's prompt type is `SELECT_CHAIN`. Only SELECT_CHAIN has this side-effect in DuelConnection; other SELECT_* types do not commit.

---

## Design Principles

- **Interface Segregation.** `AnimationDataSource` exposes only the 13 members the orchestrator needs. `DuelWebSocketService` (live) and `ReplayDuelAdapter` (replay) both implement it. Consumers inject via `ANIMATION_DATA_SOURCE` token — they never know the source.
- **Zero orchestrator changes.** Chain overlay, card travel, pre-masking, LP flash — all work identically. Not "additive methods" — literally untouched code paths.
- **Phased queue splitting.** Decision pauses are implemented by feeding event segments to the orchestrator with a gap between them. The orchestrator sees normal batches — never a "pause" concept.
- **Forward-compatible.** New animation features added to the orchestrator automatically work in replay. New prompt types automatically show in decision mode (with fallback).

---

## Core Architectural Decision: AnimationDataSource Interface

### Existing Architecture (IMPORTANT — do not break)

```
DuelConnection (concrete class, 840 lines — duel-connection.ts)
├── Owns all signals (duelState, animationQueue, activeChainLinks, etc.)
├── Handles WebSocket lifecycle (connect, reconnect, session tokens)
├── Processes raw ServerMessage → signal updates
├── Auto-responds to empty prompts
└── Manages pending chain entries, hint context, card selection state

DuelWebSocketService (facade, 148 lines — duel-web-socket.service.ts)
├── Wraps DuelConnection via _activeConnection signal
├── Delegates ALL 13 signals + ALL methods to active connection
├── In solo mode: swaps between 2 DuelConnection instances
└── Injects DebugLogService for logging
```

### Problem

`AnimationOrchestratorService` receives `DuelWebSocketService` via `init()`. `PvpChainOverlayComponent` injects it via `@inject()`. Both consume a subset of its API — signals for reading state, methods for mutating animation state. Neither needs WebSocket connectivity, prompts, surrender, or connection management.

### Decision

Extract the consumed API surface into an **`AnimationDataSource` interface**. Both `DuelWebSocketService` (live) and `ReplayDuelAdapter` (replay) implement it. Consumers inject via `ANIMATION_DATA_SOURCE` InjectionToken. Each page provides its implementation at the component-level injector.

`DuelConnection` remains **completely untouched** — it is a concrete class with WebSocket internals that only live PvP uses.

### API Surface (verified by exhaustive code audit)

```
┌─────────────────────────────────────────────────────────────┐
│              AnimationDataSource (interface)                    │
├─────────────────────────────────────────────────────────────┤
│  SIGNALS                                                     │
│  ─────────────────────────────────────────────               │
│  duelState:          Signal<DuelState>          (orchestrator)│
│  animationQueue:     Signal<GameEvent[]>        (orchestrator)│
│  activeChainLinks:   Signal<ChainLinkState[]>   (chain overlay ONLY) │
│  chainPhase:         Signal<'idle'|'building'|'resolving'>   (both)  │
│  pendingPrompt:      Signal<Prompt | null>      (orchestrator)│
│                                                              │
│  MUTATIONS (called by orchestrator)                          │
│  ─────────────────────────────────                           │
│  dequeueAnimation():              GameEvent | null           │
│  removeAnimationAt(index):        void                       │
│  applyPendingBoardState():        void                       │
│  setAnimating(v: boolean):        void                       │
│  setDrawMaskActive(v: boolean):   void                       │
│  applyChainSolving(chainIdx):     void                       │
│  applyChainSolved(chainIdx):      void                       │
│  applyChainEnd():                 void                       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
                    Live PvP                                   Replay
                    ────────                                   ──────

             WebSocket messages                       PreComputedState[N]
                    │                                  events[] + decisions[]
                    ▼                                         │
     DuelConnection (concrete, unchanged)           ReplayDuelAdapter
          │                                          (implements AnimationDataSource)
          ▼                                                   │
     DuelWebSocketService (facade)                            │
     (implements AnimationDataSource)                         │
                    │                                         │
                    │  provides as ANIMATION_DATA_SOURCE       │
                    ▼                                         ▼
          ┌──────────────────────────────────────────────────────┐
          │            AnimationOrchestratorService                │
          │  injects AnimationDataSource — doesn't know source    │
          │                                                       │
          │   processAnimationQueue()                              │
          │     → dequeueAnimation()          ← same call         │
          │     → applyChainSolving()         ← same call         │
          │     → cardTravel.travel()         ← same call         │
          │     → preMaskQueuedSources()      ← same call         │
          │     → applyPendingBoardState()    ← same call         │
          └────────────────────┬──────────────────────────────────┘
                               │
                  ┌────────────┼────────────┐
                  ▼            ▼            ▼
            Board render  Chain overlay  Card travel
            (unchanged)   (unchanged)    (unchanged)
```

---

## Enriched Data Model

### PreComputedState — new `decisions` field

```typescript
interface DecisionMoment {
  prompt: ServerMessage;        // The SELECT_* message (full options)
  response: CapturedResponse;   // What the player chose
  player: 0 | 1;               // Who was prompted
  hint?: HintContext;           // MSG_HINT active when prompt was sent (v4.4)
  confirmedCards?: CardInfo[];  // MSG_CONFIRM_CARDS preceding the prompt (v4.4)
}

interface PreComputedState {
  // ── Existing (unchanged) ──
  boardState: BoardStatePayload;
  events: ServerMessage[];
  label: string;
  responseCount: number;

  // ── New: all "decision moments" in this transition ──
  decisions?: DecisionMoment[];
  // Array because a single transition can contain multiple prompts
  // (e.g., chain: SELECT_CHAIN × N, or tributes + chain in one batch).
  // Each entry pairs the prompt with the player's response.
}
```

**Source:** During pre-computation in `duel-worker.ts`, every `SELECT_*` prompt in the event batch is captured along with its corresponding response, plus the `MSG_HINT` and `MSG_CONFIRM_CARDS` context that preceded it. The worker collects them into a `decisions[]` array and stores it in the `PreComputedState`. Cost: ~25 lines in `runReplayPreComputation()`.

**Why an array, not a single object?** A single transition can contain multiple decision points (e.g., chain building: `SELECT_CHAIN` appears N times). With a single `decision`, the phased queue splitting in `resumeAfterPrompt()` would re-show the same prompt/response for every pause — wrong question, wrong answer highlighted. With `decisions[]`, the adapter pops the next decision from the array at each pause.

### CapturedResponse — optional timestamp

```typescript
// duel-worker.ts — capturedSetResponse()
capturedResponses.push({
  data: response,
  timestamp: Date.now(),    // NEW — when the response was sent
});
```

Enables proportional prompt display duration in decision mode (longer thinking time = longer pause). Optional — `PROMPT_DISPLAY_FALLBACK` (1.5s) if absent.

---

## Phased Queue Splitting — Decision Pause Without Orchestrator Changes

### The Problem

The orchestrator processes events continuously: `dequeue → animate → dequeue → ... → idle`. We need to insert a pause (prompt visible) mid-sequence. But the orchestrator has no "pause for prompt" concept.

In live PvP, `SELECT_*` messages go to `_pendingPrompt` — they are **never** in the animation queue (`duel-connection.ts` lines 544-582). Game events (`MSG_CHAINING`, `MSG_MOVE`, etc.) go to `_animationQueue`. The two streams are interleaved in real-time by the WebSocket. Replay must reproduce this interleaving.

### The Solution: Step Queue

The `ReplayDuelAdapter` builds an **ordered sequence of steps** from the raw events and decisions:

```typescript
type ReplayStep =
  | { kind: 'animate'; events: GameEvent[] }
  | { kind: 'decide';  decision: DecisionMoment };
```

A single `advanceStep()` method consumes the sequence, called from exactly two coordination points:
- **`setAnimating(false)`** — orchestrator finished processing an animate segment
- **`resumeAfterPrompt()`** — user/playback dismissed a decision prompt

```
PreComputedState.events = [MSG_MOVE, SELECT_CARD, MSG_CHAINING, SELECT_CHAIN, MSG_CHAIN_SOLVING]
decisions = [D_CARD, D_CHAIN]

buildSteps() →
  [animate:[MSG_MOVE], decide:D_CARD, animate:[MSG_CHAINING], decide:D_CHAIN, animate:[MSG_CHAIN_SOLVING]]

Execution:
  1. advanceStep() → animate [MSG_MOVE]     → orchestrator processes → animations play
  2. setAnimating(false) → advanceStep()    → decide D_CARD → prompt displayed
  3. resumeAfterPrompt() → advanceStep()    → animate [MSG_CHAINING] → chain entry animation
  4. setAnimating(false) → advanceStep()    → decide D_CHAIN → prompt displayed
  5. resumeAfterPrompt() → advanceStep()    → animate [MSG_CHAIN_SOLVING] → chain resolves
  6. setAnimating(false) → advanceStep()    → no steps left → busy.set(false)
```

The orchestrator never sees `SELECT_*`. It receives normal event batches. **Zero orchestrator changes.** Each prompt appears **after** its preceding animations finish (not simultaneously), matching live PvP behavior.

### Why `setAnimating(false)` Is the Correct Hook

The orchestrator's exact end-of-queue sequence (`animation-orchestrator.service.ts` lines 550-558):
```
L550: _isAnimating.set(false)
L551: setAnimating(false)          ← adapter hook — show next prompt or feed next segment
L552: setDrawMaskActive(false)
L553: resetHandAnimationState()
L557: clearAllTravels()
L558: applyPendingBoardState()     ← typically no-op (consumed at L573 during processing)
```

`applyPendingBoardState()` is also called at L573 **after each event** during processing. The pending state is consumed by the first event — the L558 call is a safety net. This matches live PvP behavior: the board state jumps to final after the first event, and pre-masking creates the visual illusion of gradual change.

### Edge Cases

| Case | Handling |
|---|---|
| No events before the prompt | Animate step has `events: []` → `advanceStep()` skips it → prompt displayed immediately |
| No events after the last prompt | Trailing animate step has `events: []` → skipped → `advanceStep()` applies pending board state, clears busy |
| Multiple prompts (chain: `SELECT_CHAIN` × N) | `buildSteps()` creates interleaved animate/decide steps — each prompt appears after its preceding events animate |
| Seek / scrub during prompt pause | `abort()` clears `_steps` + `_activeDecision` → instant jump, no residual |
| Result mode (no decision pause) | `feedTransition()` sets `_steps = []`, pushes all events at once — `setAnimating(false)` → `advanceStep()` → no steps → `busy.set(false)` |
| `promptMode` toggle decision→result during prompt | `collapseRemainingSteps()` merges remaining animate steps, skips decide steps, feeds merged batch |

---

## AnimationDataSource — Interface

**New file:** `front/src/app/pages/pvp/duel-page/animation-data-source.ts`

```typescript
import { InjectionToken, Signal } from '@angular/core';
import type { DuelState, Prompt, GameEvent, ChainLinkState } from '../types';

/**
 * Data source interface for the animation pipeline.
 *
 * Implemented by DuelWebSocketService (live PvP) and ReplayDuelAdapter (replay).
 * Injected by AnimationOrchestratorService and PvpChainOverlayComponent via
 * the ANIMATION_DATA_SOURCE token — they never reference the concrete class.
 *
 * NOTE: DuelConnection (duel-connection.ts) is an EXISTING concrete class
 * with WebSocket internals. Do NOT modify it. This interface extracts only
 * the subset needed by the animation pipeline.
 */
export interface AnimationDataSource {
  readonly duelState: Signal<DuelState>;
  readonly animationQueue: Signal<GameEvent[]>;
  readonly activeChainLinks: Signal<ChainLinkState[]>;
  readonly chainPhase: Signal<'idle' | 'building' | 'resolving'>;
  readonly pendingPrompt: Signal<Prompt | null>;

  dequeueAnimation(): GameEvent | null;
  removeAnimationAt(index: number): void;
  applyPendingBoardState(): void;
  setAnimating(animating: boolean): void;
  setDrawMaskActive(active: boolean): void;
  applyChainSolving(chainIndex: number): void;
  applyChainSolved(chainIndex: number): void;
  applyChainEnd(): void;
}

export const ANIMATION_DATA_SOURCE = new InjectionToken<AnimationDataSource>('AnimationDataSource');
```

---

## ReplayDuelAdapter — Full Implementation

**New file:** `front/src/app/pages/pvp/replay/replay-duel-adapter.ts`

```typescript
import { locationToZoneId } from '../pvp-zone.utils';  // zoneId derivation (ChainingMsg has location+sequence, not zoneId)

@Injectable()
export class ReplayDuelAdapter implements AnimationDataSource {

  // ══════════════════════════════════════════════════
  //  AnimationDataSource contract (orchestrator interface)
  // ══════════════════════════════════════════════════

  private readonly _duelState = signal<DuelState>(EMPTY_DUEL_STATE);
  private readonly _activeChainLinks = signal<ChainLinkState[]>([]);
  private readonly _chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  // IMPORTANT: _animationQueue is a SIGNAL wrapping the array, not a plain array.
  // Angular computed/effect only re-evaluate when signals they read change.
  // Mutating a plain array (push/shift/splice) would NOT trigger reactivity.
  private readonly _animationQueue = signal<GameEvent[]>([]);
  private _pendingBoardState: BoardStatePayload | null = null;

  readonly duelState = this._duelState.asReadonly();
  readonly animationQueue = this._animationQueue.asReadonly();
  readonly activeChainLinks = this._activeChainLinks.asReadonly();
  readonly chainPhase = this._chainPhase.asReadonly();
  readonly pendingPrompt = signal<Prompt | null>(null);  // Always null — replay has no interactive prompts

  // ── Pending chain entry — mirrors DuelConnection's deferred commit pattern ──
  // In live PvP, DuelConnection does NOT add chain links to activeChainLinks
  // immediately on MSG_CHAINING. Instead, it stores the link as a "pending entry"
  // and commits it only when one of these events arrives:
  //   1. SELECT_CHAIN (cost prompt answered)
  //   2. WAITING_RESPONSE (opponent waiting)
  //   3. MSG_CHAIN_SOLVING (resolution starts)
  //   4. Next MSG_CHAINING (another link in chain)
  //   5. MSG_CHAIN_END (chain ends)
  // This prevents the card from appearing in the chain overlay before the player
  // has finished paying costs (e.g., SELECT_TRIBUTE for a tribute-cost activation).
  private _pendingChainEntry: ChainLinkState | null = null;

  private commitPendingChainEntry(): void {
    if (this._pendingChainEntry) {
      this._activeChainLinks.update(links => [...links, this._pendingChainEntry!]);
      this._pendingChainEntry = null;
    }
  }

  dequeueAnimation(): GameEvent | null {
    // Loop to consume internal bookkeeping types (not in GameEvent union)
    // without returning them to the orchestrator. This ensures the return
    // type is honestly GameEvent | null — no type lies.
    //
    // In live PvP, these types (MSG_CHAIN_NEGATED, WAITING_RESPONSE) are
    // handled synchronously in DuelConnection.handleMessage() and never
    // reach the animation queue. SELECT_CHAIN is a prompt, not queued.
    // filterEventsForQueue() already strips all three, so this loop is a
    // defensive safety net — it should never actually loop in practice.
    while (true) {
      const q = this._animationQueue();
      if (q.length === 0) return null;
      const first = q[0];
      this._animationQueue.update(queue => queue.slice(1));

      // ── Internal types: consume and continue (not returned) ──
      if (first.type === 'MSG_CHAIN_NEGATED') {
        // Negation applied synchronously — chain overlay's Effect B
        // detects the signal change and triggers "grey shake" animation.
        this._activeChainLinks.update(links =>
          links.map(l => l.chainIndex === (first as { chainIndex: number }).chainIndex
            ? { ...l, negated: true } : l));
        continue;
      }
      if (first.type === 'WAITING_RESPONSE') {
        this.commitPendingChainEntry();
        continue;
      }
      if (first.type.startsWith('SELECT_')) {
        // SELECT_CHAIN or any other SELECT_* that slipped through filtering.
        // Commit pending entry (SELECT_CHAIN is a commit point) and consume.
        this.commitPendingChainEntry();
        continue;
      }

      // ── GameEvent types: chain bookkeeping + return to orchestrator ──
      if (first.type === 'MSG_CHAINING') {
        // Commit any previous pending entry before storing the new one
        this.commitPendingChainEntry();
        if (this._chainPhase() === 'idle') {
          this._chainPhase.set('building');
        }
        const chaining = first as ChainingMsg;
        this._pendingChainEntry = {
          chainIndex: chaining.chainIndex,
          cardCode: chaining.cardCode,
          cardName: chaining.cardName,
          player: chaining.player,
          zoneId: locationToZoneId(chaining.location, chaining.sequence),
          location: chaining.location,
          sequence: chaining.sequence,
          resolving: false,
          negated: false,
        };
      }
      // MSG_CHAIN_SOLVING and MSG_CHAIN_END also commit pending entries.
      // applyChainSolving()/applyChainEnd() already mutate activeChainLinks,
      // but we must commit the pending entry first so it's in the array.
      if (first.type === 'MSG_CHAIN_SOLVING' || first.type === 'MSG_CHAIN_END') {
        this.commitPendingChainEntry();
      }
      return first as GameEvent;
    }
  }

  removeAnimationAt(index: number): void {
    this._animationQueue.update(q => [...q.slice(0, index), ...q.slice(index + 1)]);
  }

  applyPendingBoardState(): void {
    if (this._pendingBoardState) {
      this._duelState.set(this._pendingBoardState);
      this._pendingBoardState = null;
    }
  }

  setAnimating(animating: boolean): void {
    // Called by orchestrator at queue-empty (L551). In live PvP, DuelConnection
    // uses this to cancel the pending board state flush timer. In replay, this
    // is the coordination point: advance to the next step in the step queue.
    // busy is cleared by advanceStep() only when ALL steps are exhausted.
    if (!animating) {
      this.advanceStep();
    }
  }

  setDrawMaskActive(_active: boolean): void {
    // No-op — hands always visible in omniscient replay.
    // CONSTRAINT: If a perspective-specific mode is added later (showing only
    // what one player would see, hiding opponent hand), this must be replaced
    // with actual draw mask tracking. That would require extracting
    // hiddenHandIndices + handGhostCards from AnimationOrchestratorService into
    // a shared HandAnimationStateService. See "Known Limitations" section.
  }

  applyChainSolving(chainIndex: number): void {
    this._activeChainLinks.update(links =>
      links.map(l => l.chainIndex === chainIndex ? { ...l, resolving: true } : l));
    this._chainPhase.set('resolving');
  }

  applyChainSolved(chainIndex: number): void {
    this._activeChainLinks.update(links =>
      links.filter(l => l.chainIndex !== chainIndex));
  }

  applyChainEnd(): void {
    this._activeChainLinks.set([]);
    this._chainPhase.set('idle');
  }

  // ══════════════════════════════════════════════════
  //  Replay-specific API — Step Queue + Decision State
  // ══════════════════════════════════════════════════

  readonly busy = signal(false);

  // ── Single source of truth for active decision ──
  // One signal replaces the 5 separate signals from v4.4 (_activePrompt,
  // _activeResponse, _activePlayer, _activeHint, _activeConfirmedCards).
  // All derived from a single DecisionMoment — impossible to desync.
  private readonly _activeDecision = signal<DecisionMoment | null>(null);

  // Derived computeds — consumed by ReplayPageComponent template
  readonly activePrompt          = computed(() => this._activeDecision()?.prompt ?? null);
  readonly activeResponse        = computed(() => this._activeDecision()?.response.data ?? null); // .data, NOT the CapturedResponse wrapper
  readonly activePlayer          = computed(() => this._activeDecision()?.player ?? 0);
  readonly activeHint            = computed(() => this._activeDecision()?.hint ?? null);
  readonly activeConfirmedCards  = computed(() => this._activeDecision()?.confirmedCards ?? null);
  readonly activeTimestamp        = computed(() => this._activeDecision()?.response.timestamp ?? null); // for proportional prompt duration in playback

  // ── Step queue — replaces _pendingAfterPrompt + _remainingDecisions ──
  private _steps: ReplayStep[] = [];

  /**
   * Filter events for the animation queue — BLACKLIST approach.
   *
   * Strips known non-animation types:
   * - ALL SELECT_* types (prompts — handled via decisions[])
   * - MSG_CHAIN_NEGATED and WAITING_RESPONSE (consumed internally by
   *   dequeueAnimation() loop, never returned to orchestrator)
   *
   * Lets everything else through, including non-GameEvent ServerMessage types
   * (BOARD_STATE, TIMER_STATE, DUEL_END, etc.) that may be present in the
   * pre-computed events[]. This is intentional:
   *
   * WHY BLACKLIST, NOT WHITELIST:
   * The orchestrator's processAnimationQueue() switch has `default: return 0`
   * — unknown types are silently ignored (0ms duration, next event immediately).
   * A whitelist would silently DROP new GameEvent types (e.g. MSG_EQUIP) if
   * added to the union but forgotten in the whitelist — an invisible bug where
   * the animation never plays. The blacklist is fail-open: new types pass
   * through, reach the switch, and either have a handler (works) or hit
   * default (harmless no-op). The only types that MUST be stripped are those
   * with active roles in dequeueAnimation() (chain commit points, negation)
   * or that would confuse the phased queue splitting (SELECT_*).
   *
   * NOTE: The type predicate `(e): e is GameEvent` is technically a lie for
   * non-GameEvent types that pass through. This is accepted because the
   * orchestrator handles them safely via `default: return 0`, and strict
   * type narrowing would require the whitelist approach with its worse
   * maintenance trade-off.
   *
   * SELECT_CHAIN serves a DUAL ROLE: it is both a user-visible prompt (decision
   * pause in phased mode) AND a commit point for the pending chain entry pattern.
   * The commit role is handled by dequeueAnimation() when it encounters
   * MSG_CHAIN_SOLVING, next MSG_CHAINING, or MSG_CHAIN_END — all of which also
   * commit. SELECT_CHAIN is stripped here because its prompt role is handled by
   * feedTransitionPhased() splitting on raw events before filtering.
   */
  private filterEventsForQueue(events: ServerMessage[]): GameEvent[] {
    const INTERNAL_TYPES = new Set(['MSG_CHAIN_NEGATED', 'WAITING_RESPONSE']);
    return events.filter(
      (e): e is GameEvent =>
        !e.type.startsWith('SELECT_') && !INTERNAL_TYPES.has(e.type)
    );
  }

  /**
   * Feed a full transition (Result mode — no decision pause).
   * Pushes ALL events at once. Orchestrator processes them identically to live.
   */
  feedTransition(prev: PreComputedState, next: PreComputedState): void {
    this.busy.set(true);
    this._steps = []; // No steps — result mode. setAnimating(false) → advanceStep() → busy.set(false)
    // Pre-set current state so orchestrator's pre-masking reads correct zones
    this._duelState.set(prev.boardState);
    this._pendingBoardState = next.boardState;
    // Chain links NOT pre-populated — dequeueAnimation() manages them via the
    // pending entry pattern (mirrors DuelConnection's deferred commit behavior).
    const filtered = this.filterEventsForQueue(next.events);
    if (filtered.length === 0) {
      // No animation events in this transition (e.g., phase change only).
      // Apply board state directly — the orchestrator's queue-watch effect
      // only fires on queue.length > 0, so it would never start processing
      // and busy would stay true indefinitely without this guard.
      this.applyPendingBoardState();
      this.busy.set(false);
      return;
    }
    this._animationQueue.set(filtered);
  }

  /**
   * Feed a transition with decision pause (Decision mode).
   * Builds an interleaved step queue of animate/decide steps, then starts
   * consuming it via advanceStep().
   *
   * Returns 'prompt' if a decision pause was inserted, 'done' if no prompt.
   */
  feedTransitionPhased(
    prev: PreComputedState,
    next: PreComputedState,
  ): 'prompt' | 'done' {
    if (!next.decisions?.length) {
      this.feedTransition(prev, next);
      return 'done';
    }

    this.busy.set(true);
    this._duelState.set(prev.boardState);
    this._pendingBoardState = next.boardState;
    this._steps = this.buildSteps(next.events, next.decisions);
    this.advanceStep(); // Process first step (animate or decide)
    return this._activeDecision() ? 'prompt' : 'done';
  }

  /**
   * Build an interleaved sequence of animate/decide steps from raw events.
   *
   * Splits at each SELECT_* that has a matching decision (sequential pairing).
   * SELECT_* types without a matching decision (excess prompts, auto-responded)
   * are NOT split points — they flow into the current segment and are stripped
   * by filterEventsForQueue().
   *
   * Input:  events    = [E1, E2, SELECT_A, E3, SELECT_B, E4]
   *         decisions = [D_A, D_B]
   *
   * Output: [
   *   { kind: 'animate', events: [E1, E2] },    ← filtered
   *   { kind: 'decide',  decision: D_A },
   *   { kind: 'animate', events: [E3] },         ← filtered
   *   { kind: 'decide',  decision: D_B },
   *   { kind: 'animate', events: [E4] },         ← filtered (trailing)
   * ]
   */
  private buildSteps(
    rawEvents: ServerMessage[],
    decisions: DecisionMoment[],
  ): ReplayStep[] {
    const steps: ReplayStep[] = [];
    let segment: ServerMessage[] = [];
    let di = 0;

    for (const e of rawEvents) {
      if (e.type.startsWith('SELECT_') && di < decisions.length) {
        steps.push({ kind: 'animate', events: this.filterEventsForQueue(segment) });
        steps.push({ kind: 'decide', decision: decisions[di++] });
        segment = [];
      } else {
        segment.push(e);
      }
    }
    // Trailing events after last SELECT_* (or all events if no split occurred)
    steps.push({ kind: 'animate', events: this.filterEventsForQueue(segment) });

    return steps;
  }

  /**
   * Central step consumer — single method, two callers:
   *   1. setAnimating(false) — orchestrator finished an animate segment
   *   2. resumeAfterPrompt() — user/playback dismissed a decision prompt
   *
   * One method, one flow, any number of decisions.
   */
  private advanceStep(): void {
    // Loop instead of recursion to avoid unbounded stack depth when
    // multiple consecutive animate steps have empty events[].
    while (true) {
      const step = this._steps.shift();

      if (!step) {
        // All steps consumed. Apply deferred board state if the orchestrator
        // didn't get a chance (e.g., all animate steps were empty).
        this.applyPendingBoardState();
        this.busy.set(false);
        return;
      }

      if (step.kind === 'decide') {
        // Replicate DuelConnection's commit-on-SELECT_CHAIN (duel-connection.ts:551).
        // In live PvP, handleMessage(SELECT_CHAIN) calls commitPendingChainEntry()
        // synchronously BEFORE setting _pendingPrompt. This makes the chain link
        // appear in activeChainLinks so the chain overlay's Effect A triggers the
        // fade-in + card entry animation concurrently with the prompt display.
        // Without this, the pending entry stays uncommitted during the entire prompt
        // pause — the overlay never shows the card, and the entry animation is lost.
        // Only SELECT_CHAIN has this side-effect; other SELECT_* types do not commit.
        if (step.decision.prompt.type === 'SELECT_CHAIN') {
          this.commitPendingChainEntry();
        }
        this._activeDecision.set(step.decision);
        return; // busy stays true — waiting for resumeAfterPrompt()
      }

      // Animate step — feed events to orchestrator via queue
      if (step.events.length === 0) {
        continue; // Skip empty segment, process next step immediately
      }
      this._animationQueue.set(step.events);
      // Queue watcher effect in ReplayPageComponent will call
      // orchestrator.startProcessingIfIdle(). When orchestrator finishes →
      // setAnimating(false) → advanceStep() → next step.
      return;
    }
  }

  /**
   * Called when the user steps forward from a decision pause,
   * or auto-called after proportional duration in playback.
   */
  resumeAfterPrompt(): void {
    this._activeDecision.set(null);
    this.advanceStep();
  }

  /**
   * Collapse remaining steps when switching from decision→result mode
   * while a prompt is displayed. Skips all decide steps, merges remaining
   * animate steps into one batch, feeds to orchestrator.
   */
  collapseRemainingSteps(): void {
    this._activeDecision.set(null);
    const remaining = this._steps
      .filter((s): s is { kind: 'animate'; events: GameEvent[] } => s.kind === 'animate')
      .flatMap(s => s.events);
    this._steps = [];
    if (remaining.length > 0) {
      this._animationQueue.update(q => [...q, ...remaining]);
      // Orchestrator will process, then setAnimating(false) → advanceStep() → no steps → busy.set(false)
    } else {
      if (this._pendingBoardState) this.applyPendingBoardState();
      this.busy.set(false);
    }
  }

  /** Abort everything. Used on seek, scrub, step-back, toggle-off. */
  abort(): void {
    this._animationQueue.set([]);
    this._pendingBoardState = null;
    this._pendingChainEntry = null;
    this._steps = [];
    this._activeDecision.set(null);
    this._activeChainLinks.set([]);
    this._chainPhase.set('idle');
    this.busy.set(false);
  }

  /** Instant jump to a state. No animation, no prompt. */
  jumpToState(state: PreComputedState): void {
    this.abort();
    this._duelState.set(state.boardState);
  }

  // NOTE: Chain link management uses the PENDING ENTRY PATTERN in dequeueAnimation().
  // MSG_CHAINING stores the link as _pendingChainEntry, committed only when
  // MSG_CHAIN_SOLVING, next MSG_CHAINING, or MSG_CHAIN_END arrives — matching
  // live DuelConnection's deferred commit behavior. SELECT_CHAIN and
  // WAITING_RESPONSE also commit but are consumed internally (not returned to
  // orchestrator) since they are not GameEvent types. MSG_CHAIN_NEGATED is
  // consumed internally too (sets negated=true on the link synchronously).
  // This ensures chain entry animations respect cost-payment timing.
}
```

---

## Modifications to Existing Files

### File 1 — `AnimationOrchestratorService` (type change + rename)

```typescript
// BEFORE
private wsService!: DuelWebSocketService;
init(config: { wsService: DuelWebSocketService; ... }): void {
  this.wsService = config.wsService;
}

// AFTER
private dataSource!: AnimationDataSource;
init(config: { dataSource: AnimationDataSource; ... }): void {
  this.dataSource = config.dataSource;
}
```

**Scope:** ~30 occurrences `this.wsService` → `this.dataSource`. Pure rename + type change, zero logic change.

### File 2 — `PvpChainOverlayComponent` (injection swap)

```typescript
// BEFORE
private readonly wsService = inject(DuelWebSocketService);

// AFTER
private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
```

**Scope:** 1 injection + 2 property reads renamed.

### File 3 — `DuelWebSocketService` (implements interface)

```typescript
// BEFORE
@Injectable()
export class DuelWebSocketService implements OnDestroy {

// AFTER
@Injectable()
export class DuelWebSocketService implements AnimationDataSource, OnDestroy {
```

**Scope:** 1 line. All interface methods already implemented — compiler confirms.
**NOTE:** `DuelConnection` (concrete class) is NOT modified. Only `DuelWebSocketService` (facade) gains the interface marker.

### File 4 — `DuelPageComponent` (provider token + init param)

```typescript
// providers: add
{ provide: ANIMATION_DATA_SOURCE, useExisting: DuelWebSocketService },

// init call: rename param
this.animationService.init({ dataSource: this.wsService, ... });
```

### File 5 — `PvpPromptDialogComponent` (read-only mode + prompt context)

```typescript
// NEW inputs
readonly readOnly = input(false);
readonly preSelectedResponse = input<unknown>(null);
readonly hintContext = input<HintContext | null>(null);           // v4.4 — prompt context from DecisionMoment
readonly confirmedCards = input<CardInfo[] | null>(null);         // v4.4 — excavation context from DecisionMoment
```

When `readOnly()` is true:
- All buttons/cards are non-interactive (`pointer-events: none`)
- The selected option (matched via `preSelectedResponse`) gets a `.selected` highlight class
- The dialog auto-sizes to fit (no scrollable area needed)

When `hintContext()` is non-null, the prompt dialog uses it for contextual card names (e.g., "Activate [Monster Reborn]?" instead of "Activate?"). In live mode, this input is not passed — the component falls back to reading from injected `DuelWebSocketService.hintContext()`. When `confirmedCards()` is non-null, excavated cards are shown in relevant card selection prompts.

**Scope:** ~30 lines of template conditionals + ~15 lines CSS (`.selected` class per prompt type) + ~4 lines for prompt context inputs (v4.4).

### File 6 — `PromptZoneHighlight` (selected zone marker)

```typescript
// NEW input
readonly selectedZone = input<string | null>(null);
```

When set, the selected zone gets a distinct marker (thicker border, check icon) on top of the existing highlight.

**Scope:** ~10 lines.

### File 7 — `duel-worker.ts` (capture decisions + transition boundary change)

The current worker creates a new `PreComputedState` at **every** `SELECT_*` (`duel-worker.ts` line 1370). This means each state has at most 1 decision, and `decisions[]` never exceeds length 1.

To support multi-decision transitions (mimicking live PvP's continuous prompt flow — e.g., chain building with `SELECT_CHAIN × N`), the worker must distinguish **transition boundary prompts** from **intermediate prompts**:

- **Boundary prompts** (`SELECT_IDLECMD`, `SELECT_BATTLECMD`): flush accumulated events + decisions into a new `PreComputedState`, starting a new transition. These are the "main action" prompts where the player decides what to do next.
- **Intermediate prompts** (all other `SELECT_*`): accumulate the decision, feed the response, but do NOT push a new state. Events continue accumulating. The next boundary or phase change carries all accumulated decisions.

```typescript
// In runReplayPreComputation():
const transitionDecisions: DecisionMoment[] = [];
let lastHint: HintContext | null = null;
let lastConfirmedCards: CardInfo[] | null = null;

// Boundary prompts — these start a new player action and flush the transition.
// All other SELECT_* types are intermediate (chain responses, cost selections,
// placement choices) and accumulate within the current transition.
const TRANSITION_BOUNDARY_PROMPTS = new Set([
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_BATTLECMD,
]);

// ... inside the event loop:
if (rawMsg.type === OcgMessageType.MSG_HINT) {
  lastHint = { hintType: rawMsg.hintType, player: rawMsg.player,
               value: rawMsg.value, cardName: rawMsg.cardName,
               hintAction: rawMsg.hintAction };
}
if (rawMsg.type === OcgMessageType.MSG_CONFIRM_CARDS) {
  lastConfirmedCards = rawMsg.cards;  // Unfiltered — display layer filters by DECK|EXTRA (v4.4 bugfix)
}

// ... inside the SELECT_* handling block:
if (SELECT_MESSAGE_TYPES.has(rawMsg.type)) {
  // Capture decision BEFORE feeding the response
  transitionDecisions.push({
    prompt: translated!,                           // The transformed SELECT_* message
    response: msg.playerResponses[responseIndex],  // What the player chose
    player: (rawMsg as any).player as 0 | 1,
    hint: lastHint ?? undefined,                   // MSG_HINT context (v4.4)
    confirmedCards: lastConfirmedCards ?? undefined, // MSG_CONFIRM_CARDS context (v4.4)
  });
  lastHint = null;
  lastConfirmedCards = null;

  core.duelSetResponse(duel, msg.playerResponses[responseIndex].data as never);
  responseIndex++;

  // Only boundary prompts flush the transition into a new PreComputedState.
  // Intermediate prompts accumulate — their events/decisions carry forward
  // until the next boundary (or phase/turn change handled elsewhere).
  if (TRANSITION_BOUNDARY_PROMPTS.has(rawMsg.type)) {
    const boardState = (buildBoardState() as BoardStateMsg).data;
    const label = generateLabel(events);
    turnStates.push({
      boardState,
      events: [...events],
      label,
      responseCount: responseIndex,
      decisions: transitionDecisions.length > 0 ? [...transitionDecisions] : undefined,
    });
    events = [];
    transitionDecisions.length = 0;
  }
  // else: intermediate prompt — events/decisions keep accumulating.
  // The next duelProcess() generates effects of the response (MSG_CHAINING, etc.)
  // which flow into the same events[] array.
}
```

**Why this boundary set?** In live PvP, `SELECT_IDLECMD` and `SELECT_BATTLECMD` are the "idle" prompts where the player decides their next action (summon, activate, set, attack, etc.). Everything between two idle prompts is one logical action sequence — tribute selections, chain responses, placement choices — that should replay as one continuous flow with interleaved decision pauses.

**Fallback for phase/turn boundaries:** The existing `NEW_PHASE` and `NEW_TURN` handlers must also flush accumulated `transitionDecisions` into the pushed state and reset the array, ensuring no decisions leak across boundaries:

```typescript
// NEW_PHASE handler (replaces lines 1326-1333):
if (rawMsg.type === OcgMessageType.NEW_PHASE) {
  const phaseLabel = PHASE_LABELS[rawMsg.phase as number] ?? 'Phase Change';
  if (events.length > 0 || transitionDecisions.length > 0) {
    const boardState = (buildBoardState() as BoardStateMsg).data;
    turnStates.push({
      boardState, events: [...events], label: phaseLabel,
      responseCount: responseIndex,
      decisions: transitionDecisions.length > 0 ? [...transitionDecisions] : undefined,
    });
    events = [];
    transitionDecisions.length = 0;
  }
}

// NEW_TURN handler (replaces lines 1310-1316):
if (rawMsg.type === OcgMessageType.NEW_TURN) {
  // Flush remaining events/decisions from the previous turn before emitting
  if (events.length > 0 || transitionDecisions.length > 0) {
    const boardState = (buildBoardState() as BoardStateMsg).data;
    turnStates.push({
      boardState, events: [...events], label: generateLabel(events),
      responseCount: responseIndex,
      decisions: transitionDecisions.length > 0 ? [...transitionDecisions] : undefined,
    });
    events = [];
    transitionDecisions.length = 0;
  }
  emitTurnBatch(duelId, currentTurn, turnStates);
  currentTurn++;
  turnStates = [];
}
```

**Scope:** ~35 lines (replaces existing ~15 lines + adds boundary logic).

**NOTE:** Events generated by the OCG engine AFTER `duelSetResponse()` (e.g., `MSG_CHAINING` following a `SELECT_CHAIN` "Yes") arrive in the NEXT `duelProcess()` iteration. They naturally accumulate in `events[]` alongside the response's effects. This is why intermediate prompts must NOT flush: the events between two intermediate prompts belong to the same logical sequence.

### File 8 — `duel-worker.ts` (timestamp in capture)

```typescript
// In capturedSetResponse():
capturedResponses.push({ data: response, timestamp: Date.now() });
```

**Scope:** 1 line.

### File 9 — `ws-protocol.ts` + `duel-ws.types.ts` (PreComputedState type + DecisionMoment)

```typescript
// Add new type
interface DecisionMoment {
  prompt: ServerMessage;
  response: { data: unknown; timestamp?: number };
  player: 0 | 1;
  hint?: HintContext;           // v4.4 — MSG_HINT active when prompt was sent
  confirmedCards?: CardInfo[];  // v4.4 — MSG_CONFIRM_CARDS preceding the prompt
}

// Add to PreComputedState interface
decisions?: DecisionMoment[];
```

**Scope:** ~12 lines per file.

### Summary

| File | Lines changed | Nature |
|------|--------------|--------|
| `animation-orchestrator.service.ts` | ~30 renames | `wsService` → `dataSource` (mechanical) |
| `pvp-chain-overlay.component.ts` | 3 | injection swap |
| `duel-web-socket.service.ts` | 1 | `implements AnimationDataSource` |
| `duel-page.component.ts` | 2 | provider token + init param |
| `pvp-prompt-dialog.component.ts` | ~49 | `readOnly` + `preSelectedResponse` + `hintContext` + `confirmedCards` inputs |
| `prompt-zone-highlight.component.ts` | ~10 | `selectedZone` input |
| `duel-worker.ts` | ~25 | decisions[] capture + timestamp + hint/confirmedCards tracking |
| `ws-protocol.ts` | ~12 | PreComputedState type + DecisionMoment (with hint/confirmedCards) |
| `duel-ws.types.ts` | ~12 | PreComputedState type + DecisionMoment (with hint/confirmedCards) |
| **Total existing** | **~140** | |

| New File | Lines | Purpose |
|----------|-------|---------|
| `animation-data-source.ts` | ~35 | Interface + InjectionToken |
| `replay-duel-adapter.ts` | ~290 | AnimationDataSource impl + pending chain entry + phased queue splitting + hint/confirmedCards signals |
| **Total new** | **~255** | |

---

## DRY Extractions (from v1, preserved)

These should be implemented **before** the AnimationDataSource refactor. Live duel works identically after each sub-step.

### 0A — Chain Badge Pure Functions

**New file:** `chain-badge.utils.ts`

```typescript
// NOTE: In duel-page.component.ts, these are currently computeds named
// `playerHandChainBadges` and `opponentHandChainData` (lines 297-328).
// They read signals: wsService.activeChainLinks(), ownPlayerIndex(), wsService.chainPhase().
// Extract as pure functions so computeds become thin wrappers calling these.
export function buildHandChainBadges(
  links: readonly ChainLinkState[], playerIndex: number, chainPhase: string,
): Map<number, number>;

export function buildOpponentHandChainData(
  links: readonly ChainLinkState[], ownPlayerIndex: number, chainPhase: string,
): { badges: Map<number, number>; revealed: Map<number, number> };
```

Refactor `duel-page.component.ts`: keep computeds as thin wrappers that call the pure functions with signal values. The reactive dependency tracking is preserved by the computed — the function just contains the logic.

### 0B — Phase Announcement Service

**New file:** `phase-announcement.service.ts`

```typescript
// NOTE: Actual implementation must include:
// - Queue management (phaseAnnouncementQueue[] + drainPhaseAnnouncementQueue timer)
// - LiveAnnouncer injection (from @angular/cdk/a11y) for accessibility
// - TranslateService injection for i18n (duel.a11y.opponentPhase key)
// - PHASE_DISPLAY static map (DRAW → 'Draw Phase', etc.)
// - displayedPhase, displayedTurnPlayer, displayedTurnCount derived signals
//   (used by duel-page.component.ts for phase badge rendering)
// - Cleanup on destroy (clear timer + queue)
//
// The effect that watches duelState().phase changes and gates on roomState()
// stays in the parent component (duel-page.component.ts), calling show().
@Injectable()
export class PhaseAnnouncementService implements OnDestroy {
  readonly announcement: Signal<{
    label: string; isOpponent: boolean;
    phase: Phase; turnPlayer: Player; turnCount: number;
  } | null>;
  readonly displayedPhase: Signal<Phase | null>;
  readonly displayedTurnPlayer: Signal<Player | null>;
  readonly displayedTurnCount: Signal<number | null>;
  show(phase: string, turnPlayer: number, ownPlayerIndex: number, turnCount: number): void;
  clear(): void;
}
```

Refactor `duel-page.component.ts`: remove inlined phase logic (queue, timer, PHASE_DISPLAY map, drain), delegate to service. Keep the effect that watches `duelState().phase` in the component (it depends on `roomState()` gating).

### 0C — Shared Overlay SCSS Partial

**New file:** `_pvp-overlays.scss`

Move `.opponent-thinking-glow` (from `duel-page.component.scss`, lines 25-49), `.phase-announcement` + variants (from `duel-page-overlays.scss`, lines 529-661), `prefers-reduced-motion` rules. Verify z-layer partial import order is preserved in both consuming files.

### 0D — Shared Overlay Component

**New file:** `pvp-duel-overlays.component.ts`

```typescript
// NOTE: The parent component must pre-compute compound conditions before
// passing as inputs. In particular:
// - opponentThinking: actual condition is `waitingForOpponent() && roomState() === 'active'`
//   (parent computes this and passes the boolean)
// - phaseAnnouncement: full object with 5 fields (label, isOpponent, phase, turnPlayer, turnCount)
//   not just 2 as originally planned
// - chainResolutionAnnounce: reads from animationService signal
//
// Accessibility attributes (role="status", aria-live="polite", aria-atomic="true")
// must be preserved on all announcement blocks.
@Component({ selector: 'app-pvp-duel-overlays', ... })
export class PvpDuelOverlaysComponent {
  readonly phaseAnnouncement = input<{
    label: string; isOpponent: boolean;
    phase: Phase; turnPlayer: Player; turnCount: number;
  } | null>(null);
  readonly chainResolutionAnnounce = input(false);
  readonly opponentThinking = input(false);
}
```

Refactor `duel-page.component.html`: replace 3 inline overlay blocks.

**Note:** v1's Step 0E (animation bindings interface) is **replaced** by `AnimationDataSource` interface — it provides compile-time enforcement. A separate bindings interface is redundant.

---

## ReplayPageComponent — Wiring

### Providers

```typescript
@Component({
  standalone: true,
  providers: [
    ReplayDuelAdapter,
    { provide: ANIMATION_DATA_SOURCE, useExisting: ReplayDuelAdapter },
    AnimationOrchestratorService,
    CardTravelService,
    PhaseAnnouncementService,
    CardInspectionService,
    ReplayConnectionService,
    ReplayForkService,
  ],
})
export class ReplayPageComponent implements OnInit, OnDestroy { ... }
```

### Template

```html
<div class="replay-viewer" (keydown)="onKeydown($event)" tabindex="0">

  <!-- ═══ BOARD — same components as live PvP ═══ -->

  <!-- Opponent = 1-perspectiveIndex, Player = perspectiveIndex -->
  <app-pvp-hand-row class="hand-opponent"
    side="opponent"
    [cards]="opponentHand()"
    [omniscient]="true"
    [hiddenIndices]="orchestrator.hiddenHandIndices()[perspectiveIndex() === 0 ? 1 : 0]"
    [ghostCards]="orchestrator.handGhostCards()[perspectiveIndex() === 0 ? 1 : 0]"
    [initialDrawPending]="orchestrator.initialDrawPending()[perspectiveIndex() === 0 ? 1 : 0]"
    (cardInspectRequest)="onCardInspectRequest($event)" />

  <app-pvp-board-container
    [duelState]="duelState()"
    [ownPlayerIndex]="perspectiveIndex()"
    [readOnly]="fork.mode() === 'replay'"
    [omniscient]="true"
    [revealedZoneKeys]="revealedZoneKeys()"
    [animatingZone]="orchestrator.animatingZone()"
    [animatingLp]="orchestrator.animatingLpPlayer()"
    [activeChainLinks]="adapter.activeChainLinks()"
    [chainPhase]="adapter.chainPhase()"
    [maskedZoneKeys]="orchestrator.maskedZoneKeys()"
    [maskedPileImages]="orchestrator.maskedPileImages()"
    [maskedSourceImages]="orchestrator.maskedSourceImages()"
    [targetedZoneKeys]="orchestrator.targetedZoneKeys()"
    (cardInspectRequest)="onCardInspectRequest($event)"
    (actionResponse)="onBoardActionResponse($event)" />

  <app-pvp-hand-row class="hand-player"
    side="player"
    [cards]="playerHand()"
    [hiddenIndices]="orchestrator.hiddenHandIndices()[perspectiveIndex()]"
    [ghostCards]="orchestrator.handGhostCards()[perspectiveIndex()]"
    [initialDrawPending]="orchestrator.initialDrawPending()[perspectiveIndex()]"
    (cardInspectRequest)="onCardInspectRequest($event)" />

  <app-pvp-chain-overlay />

  <app-pvp-duel-overlays
    [phaseAnnouncement]="phaseService.announcement()"
    [chainResolutionAnnounce]="orchestrator.chainResolutionAnnounce()"
    [opponentThinking]="false" />
    <!-- No thinking glow in replay — prompt read-only display already shows who is deciding -->

  <!-- ═══ READONLY PROMPT (Decision mode) ═══ -->

  @if (adapter.activePrompt(); as prompt) {
    <app-pvp-prompt-dialog
      [prompt]="prompt"
      [readOnly]="true"
      [preSelectedResponse]="adapter.activeResponse()"
      [hintContext]="adapter.activeHint()"
      [confirmedCards]="adapter.activeConfirmedCards()"
      [ownPlayerIndex]="adapter.activePlayer()" />

    <!-- Zone highlight for SELECT_PLACE / SELECT_DISFIELD -->
    @if (prompt.type === 'SELECT_PLACE' || prompt.type === 'SELECT_DISFIELD') {
      <app-prompt-zone-highlight
        [zones]="promptZones()"
        [selectedZone]="selectedZone()" />
    }
  }

  <!-- ═══ INTERACTIVE PROMPT (Fork/solo mode only) ═══ -->

  @if (fork.mode() === 'solo') {
    <app-pvp-prompt-dialog
      [prompt]="fork.activeConnection()?.pendingPrompt()"
      [ownPlayerIndex]="fork.activePlayerIndex()"
      (response)="onBoardActionResponse($event)" />
  }

  <!-- ═══ REPLAY CONTROLS ═══ -->

  @if (fork.mode() === 'replay') {
    <app-timeline-bar
      [turns]="turns()"
      [currentIndex]="currentIndex()"
      [computedUpTo]="replayConn.computedUpTo()"
      [totalEvents]="replayConn.totalResponses()"
      [boardStates]="replayConn.boardStates()"
      (seekTo)="onSeek($event)"
      (scrubbing)="onScrub($event)" />
  }

  <app-transport-bar
    [mode]="fork.mode()"
    [isPlaying]="isPlaying()"
    [forking]="forkService.forking()"
    [animationsEnabled]="animationsEnabled()"
    [promptMode]="promptMode()"
    [perspectiveIndex]="perspectiveIndex()"
    [positionLabel]="positionLabel()"
    (playPause)="onPlayPause()"
    (stepForward)="onStepForward()"
    (stepBack)="onStepBack()"
    (skipStart)="onSeek(0)"
    (skipEnd)="onSeek(replayConn.computedUpTo())"
    (fork)="onFork()"
    (returnToReplay)="onReturnToReplay()"
    (toggleAnimations)="onToggleAnimations()"
    (togglePromptMode)="onTogglePromptMode()"
    (togglePerspective)="onTogglePerspective()" />

  <app-debug-log-panel
    [entries]="debugLogEntries()"
    [open]="debugPanelOpen()"
    [replayMode]="true"
    [activeIndex]="currentIndex()"
    [computedUpTo]="computedUpTo()"
    (closed)="debugPanelOpen.set(false)"
    (seekToEvent)="onSeek($event)" />

  @if (inspectedCard(); as card) {
    <app-pvp-card-inspector-wrapper ... />
  }
</div>
```

### State & Injection

```typescript
private readonly adapter = inject(ReplayDuelAdapter);
readonly orchestrator = inject(AnimationOrchestratorService);
readonly replayConn = inject(ReplayConnectionService);
readonly forkService = inject(ReplayForkService);
private readonly phaseService = inject(PhaseAnnouncementService);
private readonly cardTravel = inject(CardTravelService);

readonly currentIndex = signal(0);
readonly isPlaying = signal(false);
readonly pausedAtBoundary = signal(false);
readonly animationsEnabled = signal(localStorage.getItem(ReplayPageComponent.STORAGE_KEY) !== 'false');
readonly promptMode = signal<'result' | 'decision'>('result');  // decision-pause toggle
readonly logDetail = signal<'normal' | 'debug'>('normal');      // preserved from existing granularity — debug log detail level
readonly debugPanelOpen = signal(false);                        // preserved — toggle via D key
readonly perspectiveIndex = signal<0 | 1>(0);
readonly playbackSpeed = signal(1);            // replay speed multiplier (0.5, 1, 2)
private _lastResponseTimestamp: number | null = null;  // for proportional prompt duration

readonly currentState = computed(() =>
  this.replayConn.boardStates()[this.currentIndex()] ?? null);

readonly duelState = computed(() => {
  if (this.animationsEnabled() && this.adapter.busy()) {
    return this.adapter.duelState();
  }
  const state = this.currentState();
  return state ? state.boardState : EMPTY_DUEL_STATE;
});

// ── Preserved from existing component — debug log entries ──
readonly debugLogEntries = computed(() => buildReplayLogEntries(this.replayConn.boardStates(), this.logDetail()));

// ── Lifecycle — CRITICAL: init orchestrator + cleanup on destroy ──

ngOnInit(): void {
  // The orchestrator MUST be initialized with the adapter as its data source.
  // Without this, processAnimationQueue() never starts and events accumulate.
  this.orchestrator.init({
    dataSource: this.adapter,
    cardTravelService: this.cardTravel,
    liveAnnouncer: this.liveAnnouncer,       // required for a11y announcements
    ownPlayerIndex: () => this.perspectiveIndex(),
    speedMultiplier: () => this.playbackSpeed(),  // replay speed signal (default 1)
    isBoardActive: () => true,               // always active in replay
    injector: this.injector,                  // required for runInInjectionContext
  });

  // CRITICAL: Queue watcher effect — mirrors duel-page.component.ts line 876.
  // The orchestrator has NO internal queue-watch. It relies on an external
  // trigger via startProcessingIfIdle(). Without this effect, events fed by
  // the adapter (via advanceStep → _animationQueue.set) are never processed.
  effect(() => {
    const queue = this.adapter.animationQueue();
    untracked(() => {
      if (queue.length > 0) {
        this.orchestrator.startProcessingIfIdle();
      }
    });
  });

  // Playback continuation — reactively drives auto-play when adapter.busy()
  // changes or a decision prompt appears. Replaces the 100ms polling pattern.
  this.initPlaybackContinuationEffect();
}

ngOnDestroy(): void {
  this.clearPlaybackTimer();
  this.abortAndClean();
  this.orchestrator.destroy();  // clean up effects + subscriptions
}

/**
 * DRY cleanup helper — every interruption point (seek, step-back, scrub,
 * perspective toggle, fork, animation toggle) needs the same 3 steps:
 * 1. Remove in-flight card travel DOM elements
 * 2. Clear phase announcement overlay
 * 3. Reset adapter state (queue, pending board state, chain, prompt)
 *
 * Without this helper, each callsite would repeat the 3 lines and a future
 * callsite could forget one (e.g. orphaned floating card elements).
 */
private abortAndClean(): void {
  this.cardTravel.clearAllTravels();
  this.phaseService.clear();
  this.adapter.abort();
}
```

### Navigation — Step Forward (handles both modes)

```typescript
onStepForward(): void {
  // If we're paused on a decision prompt → resume, don't advance index
  if (this.adapter.activePrompt()) {
    this.adapter.resumeAfterPrompt();
    return;
  }

  // Abort in-flight animations if stepping during ongoing transition.
  // Without this, feedTransition() overwrites the queue mid-animation,
  // leaving orphaned card travel elements and stale chain overlay state.
  if (this.adapter.busy()) {
    this.abortAndClean();
  }

  const states = this.replayConn.boardStates();
  const next = this.currentIndex() + 1;
  if (next > this.replayConn.computedUpTo()) return;

  const prev = states[this.currentIndex()];
  const nextState = states[next];
  this.currentIndex.set(next);

  if (!this.animationsEnabled()) return; // no-anim: index change is enough

  // Phase announcement
  if (prev.boardState.phase !== nextState.boardState.phase) {
    this.phaseService.show(
      nextState.boardState.phase,
      nextState.boardState.turnPlayer,
      this.perspectiveIndex(),
      nextState.boardState.turnCount,
    );
  }

  // Feed transition — phased or full depending on promptMode
  if (this.promptMode() === 'decision') {
    this.adapter.feedTransitionPhased(prev, nextState);
    // returns 'prompt' → prompt displayed, next stepForward will resume
    // returns 'done' → no prompt, animations play normally
  } else {
    this.adapter.feedTransition(prev, nextState);
  }
}
```

### Navigation — Step Back, Seek, Scrub

```typescript
onStepBack(): void {
  const prev = this.currentIndex() - 1;
  if (prev < 0) return;
  this.abortAndClean();
  this.adapter.jumpToState(this.replayConn.boardStates()[prev]);
  this.currentIndex.set(prev);
}

onSeek(index: number): void {
  this.abortAndClean();
  this.adapter.jumpToState(this.replayConn.boardStates()[index]);
  this.currentIndex.set(index);
}

onScrub(index: number): void {
  this.abortAndClean();
  this.adapter.jumpToState(this.replayConn.boardStates()[index]);
  this.currentIndex.set(index);
}
```

### Playback Loop (handles decision pauses)

```typescript
private playbackTimer: ReturnType<typeof setTimeout> | null = null;

onPlayPause(): void {
  this.isPlaying.update(v => !v);
  if (this.isPlaying()) this.scheduleNext();
  else this.clearPlaybackTimer();
}

private scheduleNext(): void {
  if (!this.isPlaying()) return;

  // If adapter is busy (orchestrator animating or decision prompt active),
  // do nothing — the playback continuation effect watches adapter.busy()
  // and adapter.activePrompt() and will call scheduleNext() reactively.
  if (this.adapter.busy()) return;

  // End of computed states → pause at boundary
  if (this.currentIndex() >= this.replayConn.computedUpTo()) {
    this.isPlaying.set(false);
    this.pausedAtBoundary.set(true);
    return;
  }

  this.onStepForward();

  // If animations are off, the adapter completes synchronously (busy never
  // stays true), so schedule the next step directly after a brief delay.
  if (!this.animationsEnabled()) {
    this.playbackTimer = setTimeout(() => this.scheduleNext(), 500);
  }
  // If animations are on, feedTransition/feedTransitionPhased sets busy=true.
  // The playback continuation effect will fire when busy returns to false.
}

// ── Playback continuation effect (replaces 100ms polling) ──
// Watches adapter.busy() and adapter.activePrompt() to reactively drive
// the playback loop. When the orchestrator finishes a transition (busy
// goes false) or a decision prompt appears, this effect handles the next
// step — no setTimeout polling needed.
private initPlaybackContinuationEffect(): void {
  effect(() => {
    const busy = this.adapter.busy();
    const prompt = this.adapter.activePrompt();
    untracked(() => {
      if (!this.isPlaying()) return;

      // Decision prompt appeared → auto-dismiss after proportional duration
      if (prompt) {
        this.schedulePromptDismiss();
        return;
      }

      // Transition complete (busy went false) → schedule next step
      if (!busy) {
        this.scheduleNext();
      }
    });
  });
}

private schedulePromptDismiss(): void {
  const PROMPT_DISPLAY_MIN = 800;
  const PROMPT_DISPLAY_MAX = 3000;
  const PROMPT_DISPLAY_FALLBACK = 1500;

  // Proportional prompt display: compute delta between consecutive response
  // timestamps to reflect the player's actual thinking time.
  // If the player took 5s to decide, show the prompt longer than if 0.2s.
  const ts = this.adapter.activeTimestamp();
  const prevTs = this._lastResponseTimestamp;
  this._lastResponseTimestamp = ts;
  const delta = (ts && prevTs) ? ts - prevTs : null;
  const duration = delta !== null
    ? Math.min(Math.max(delta * 0.6, PROMPT_DISPLAY_MIN), PROMPT_DISPLAY_MAX)
    : PROMPT_DISPLAY_FALLBACK;

  this.playbackTimer = setTimeout(() => {
    this.adapter.resumeAfterPrompt();
    // No need to call scheduleNext() — adapter.busy will go false
    // when the next animate step completes, triggering the effect.
  }, duration);
}

onToggleAnimations(): void {
  this.animationsEnabled.update(v => !v);
  localStorage.setItem(ReplayPageComponent.STORAGE_KEY, String(this.animationsEnabled()));
  if (!this.animationsEnabled()) {
    this.abortAndClean();
  }
  if (this.isPlaying()) {
    this.clearPlaybackTimer();
    this.scheduleNext();
  }
}

onTogglePromptMode(): void {
  this.promptMode.update(m => m === 'result' ? 'decision' : 'result');
  // If switching to result mode while paused on prompt → auto-resume
  if (this.promptMode() === 'result' && this.adapter.activePrompt()) {
    // Collapse remaining decide steps — merge all remaining animate steps
    // into one batch and feed to orchestrator. Without this, resumeAfterPrompt()
    // would show the next decision instead of collapsing to result mode.
    this.adapter.collapseRemainingSteps();
  }
}

onToggleLogDetail(): void {
  this.logDetail.update(v => v === 'normal' ? 'debug' : 'normal');
}

onTogglePerspective(): void {
  // Clean cut: abort ongoing animations, swap, jump to current state
  this.abortAndClean();
  this.perspectiveIndex.update(p => p === 0 ? 1 : 0);
  // Re-apply current board state (hands/zones re-read from new perspective)
  const state = this.currentState();
  if (state) this.adapter.jumpToState(state);
}

onFork(): void {
  // CRITICAL: abort in-flight animations before fork handshake.
  // Without this, the chain overlay's async contract (chainOverlayReady)
  // can remain pending indefinitely after the adapter is replaced.
  this.abortAndClean();
  this.clearPlaybackTimer();
  this.isPlaying.set(false);
  this.forkService.fork(this.currentIndex(), this.replayConn.boardStates());
}

private clearPlaybackTimer(): void {
  if (this.playbackTimer !== null) {
    clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
  }
}
```

### End of Replay

When `currentIndex >= totalStates - 1` and the user steps forward or playback reaches the end:

```typescript
// In scheduleNext(), after the boundary check:
if (this.currentIndex() >= this.replayConn.computedUpTo()) {
  this.isPlaying.set(false);
  this.pausedAtBoundary.set(true);
  return;
}
```

The `pausedAtBoundary` signal drives the UI:
- Transport bar shows "End" indicator instead of position label
- A "Return to Match History" button appears (via `routerLink`)
- The duel result (win/loss/draw) is displayed as a banner overlay
- If pre-computation is still in progress (`computedUpTo < totalResponses`), playback pauses and auto-resumes when new states arrive

---

## What Works Automatically (Zero Replay-Specific Code)

| Animation | Orchestrator Handler | Events |
|---|---|---|
| Card travel (zone → zone) | `processMoveEvent()` → `cardTravel.travel()` | `MSG_MOVE` |
| Draw animation (deck → hand) | `processDrawEvent()` → `travelToHand()` | `MSG_DRAW` |
| Multi-draw ghost cards | `preMaskQueuedSources()` → `handGhostCards` | Multiple `MSG_DRAW` |
| Chain overlay (3-layer async) | `applyChainSolving()` → buffer → `applyChainSolved()` → resume | `MSG_CHAIN_*` |
| Chain entry pulse | `chainEntryAnimating` signal | `MSG_CHAINING` |
| Chain resolution announce | `chainResolutionAnnounce` signal | `MSG_CHAIN_SOLVING` |
| LP damage/recover flash | `animatingLpPlayer` signal | `MSG_DAMAGE`, `MSG_RECOVER`, `MSG_PAY_LPCOST` |
| Zone flip | `animatingZone` signal (type: 'flip') | `MSG_FLIP_SUMMONING` |
| Position change | `animatingZone` signal (type: 'activate') | `MSG_CHANGE_POS` |
| Pre-masking (anti-flicker) | `preMaskQueued*()` | Queue inspection |
| Destination zone masking | `maskedZoneKeys` signal | `MSG_MOVE` (dest) |
| Pile top-card masking | `maskedPileImages` signal | `MSG_MOVE` (to GY/banished) |
| Source ghost preservation | `maskedSourceImages` signal | `MSG_MOVE` (from zone) |
| Target reticle | `targetedZoneKeys` signal | `MSG_BECOME_TARGET` |
| Deck shuffle | `processShuffleEvent()` | `MSG_SHUFFLE_HAND` |
| XYZ material detach | CSS class trigger | Board state diff |
| Pre-destroy effect (dissolution) | `cardTravel.preDestroyEffect()` | `MSG_MOVE` (destroy) |
| Slam/soft/banish landing | `cardTravel.travel()` with style | `MSG_MOVE` (dest-based) |
| Queue collapse (AC7) | >5 events → instant all but last 3 | Queue length |
| Deadlock guard (3s) | `Promise.race([travel, timeout])` | Travel promise |
| Reduced motion | `prefers-reduced-motion` | All |

---

## Toggle Behavior Matrix

| `animationsEnabled` | `promptMode` | Action | Board Source | Animations | Prompt Display |
|---|---|---|---|---|---|
| any | any | Toggle perspective | abortAndClean → swap → jumpToState | Cleared | Cleared |
| `false` | any | Step forward | Pre-computed direct | — | — |
| `false` | any | Seek / Scrub | Pre-computed direct | — | — |
| `false` | any | Playback (500ms) | Pre-computed direct | — | — |
| `true` | `result` | Step forward | Adapter (animated) | Full pipeline | — |
| `true` | `decision` | Step forward | Adapter (animated) | Full pipeline | Prompt shown, pauses for step/auto |
| `true` | any | Seek / Scrub | Pre-computed (abortAndClean) | `abortAndClean()` | Cleared |
| `true` | `decision` | Playback | Adapter (animated) | Full pipeline | Prompt auto-dismissed after duration |

---

## Perspective Toggle — View From Player 0 or Player 1

### What It Does

The viewer can switch between "watching over Player 0's shoulder" (default) and "watching over Player 1's shoulder". This is **purely visual reorientation** — both hands remain fully visible (omniscient mode). The toggle swaps:

- Which field is at the bottom (player) vs top (opponent)
- Which hand row shows at bottom vs top
- LP animation routing (damage flashes on the correct side)
- Chain badge zone assignment (relative player conversion)
- Phase announcement "your turn" / "opponent's turn" labels

### What Already Works (zero changes needed)

These components use `ownPlayerIndex` for relative conversion — passing a different value automatically flips everything:

| Component | Mechanism |
|-----------|-----------|
| `PvpBoardContainerComponent` | `.player-field` / `.opponent-field` CSS classes, LP routing via `ownPlayerIndex()` |
| Chain badges | `relativePlayer()` conversion in `chainBadges` computed |
| `PvpHandRowComponent` | Fan direction based on `side` property |
| `AnimationOrchestratorService` | `relativePlayer()` using `ownPlayerIndex` callback |

### What Needs Changing (~25 lines)

#### ReplayPageComponent — new signal + swap logic

```typescript
readonly perspectiveIndex = signal<0 | 1>(0);

// Hands swap based on perspective
readonly playerHand = computed(() => {
  const p = this.perspectiveIndex();
  return [...this.getHandCards(p), ...this.orchestrator.handGhostCards()[p]];
});
readonly opponentHand = computed(() => {
  const opp = this.perspectiveIndex() === 0 ? 1 : 0;
  return [...this.getHandCards(opp), ...this.orchestrator.handGhostCards()[opp]];
});

// Hidden indices / ghost cards also swap
readonly playerHiddenIndices = computed(() =>
  this.orchestrator.hiddenHandIndices()[this.perspectiveIndex()]);
readonly opponentHiddenIndices = computed(() =>
  this.orchestrator.hiddenHandIndices()[this.perspectiveIndex() === 0 ? 1 : 0]);

onTogglePerspective(): void {
  this.perspectiveIndex.update(p => p === 0 ? 1 : 0);
}
```

#### Template — dynamic side + ownPlayerIndex

```html
<app-pvp-hand-row class="hand-opponent" side="opponent"
  [cards]="opponentHand()"
  [hiddenIndices]="opponentHiddenIndices()"
  [ghostCards]="orchestrator.handGhostCards()[perspectiveIndex() === 0 ? 1 : 0]"
  [initialDrawPending]="orchestrator.initialDrawPending()[perspectiveIndex() === 0 ? 1 : 0]"
  ... />

<app-pvp-board-container
  [ownPlayerIndex]="perspectiveIndex()"
  ... />

<app-pvp-hand-row class="hand-player" side="player"
  [cards]="playerHand()"
  [hiddenIndices]="playerHiddenIndices()"
  [ghostCards]="orchestrator.handGhostCards()[perspectiveIndex()]"
  [initialDrawPending]="orchestrator.initialDrawPending()[perspectiveIndex()]"
  ... />
```

#### Orchestrator init — dynamic ownPlayerIndex callback

```typescript
ngOnInit(): void {
  this.orchestrator.init({
    dataSource: this.adapter,
    cardTravelService: this.cardTravel,
    ownPlayerIndex: () => this.perspectiveIndex(),  // reactive via callback
    // ...
  });
}
```

#### Timeline bar preview

```html
<app-pvp-board-container [ownPlayerIndex]="perspectiveIndex()" ... />
```

#### Transport bar — new inputs/outputs

```typescript
// Add to transport bar inputs/outputs
readonly promptMode = input<'result' | 'decision'>('result');
readonly perspectiveIndex = input<0 | 1>(0);
readonly togglePromptMode = output<void>();
readonly togglePerspective = output<void>();
```

### Draw Mask / Omniscient

`setDrawMaskActive` is a no-op in the replay adapter — both hands are always visible regardless of perspective. The toggle is purely a **visual rotation**, not an information boundary.

### Toggle Behavior

| Action | Effect |
|--------|--------|
| Toggle perspective during idle | Board + hands swap instantly (no animation) |
| Toggle perspective during animation | `abortAndClean()` → swap → `jumpToState()` (clean cut, no mid-animation flip) |
| Toggle perspective during decision pause | `abortAndClean()` clears prompt → swap → `jumpToState()`. User can step-forward to re-trigger prompt display from the new perspective. Saving/restoring prompt state would require managing `_steps` queue position and `_activeDecision` — complexity not justified for a rare interaction. |

---

## Readonly Prompt Display Per Type

| Prompt Type | Decision Mode Display |
|---|---|
| `SELECT_IDLECMD` / `SELECT_BATTLECMD` | **Dedicated read-only renderer** (NOT in `PROMPT_COMPONENT_MAP` — currently in `IGNORED_PROMPT_TYPES`). New `PromptActionListReadonlyComponent`: shows available actions as a flat list, chosen action highlighted. Must be rendered separately from the standard prompt portal since these types are excluded from the live prompt registry. |
| `SELECT_CARD` | Card grid, chosen cards with `.selected` border |
| `SELECT_CHAIN` | Card name + "Activate? → Yes/No" with answer highlighted |
| `SELECT_EFFECTYN` | "[Card Name] — Activate?" → "Yes"/"No" badge highlighted |
| `SELECT_YESNO` | "[Question]" → "Yes"/"No" badge highlighted |
| `SELECT_POSITION` | Position icons, chosen position highlighted |
| `SELECT_PLACE` | Zone highlight overlay + selected zone marker |
| `SELECT_DISFIELD` | Zone highlight overlay + selected zone marker |
| `SELECT_TRIBUTE` | Card grid, tributed cards highlighted |
| `SELECT_OPTION` | Option list, chosen option highlighted |
| `SELECT_SUM` | Card grid with values, chosen combination highlighted |
| `SELECT_SORT` | Displayed as final order result |
| Unknown/new types | Label-only fallback (graceful degradation) |

---

## Known Limitations & Constraints

These are documented limitations of the current design. They are accepted trade-offs, not bugs.

### L1 — Draw Mask Is a No-Op (Omniscient Only)

`ReplayDuelAdapter.setDrawMaskActive()` is a no-op because replay always shows both hands (omniscient view). If a **perspective-specific mode** is added later (showing only what one player would see), this must be replaced with actual draw mask tracking. That would require:
1. Extracting `hiddenHandIndices` + `handGhostCards` from `AnimationOrchestratorService` into a shared `HandAnimationStateService`
2. Having `ReplayDuelAdapter` track hidden indices per player
3. Conditional reveal logic mirroring `revealHandCardAtIndex()` in the orchestrator

**Current risk:** None — omniscient mode is the only planned mode. Track if requirements change.

### L2 — No 50ms Pending Board State Safety Timer

In live PvP, `DuelConnection` has a 50ms one-shot timer (`schedulePendingBoardStateFlush`) that auto-applies the pending board state if nothing else does. This is a defensive safety net — the primary path is always the orchestrator calling `applyPendingBoardState()` explicitly.

`ReplayDuelAdapter` has **no equivalent timer**. This is safe because:
- The orchestrator calls `applyPendingBoardState()` after each event during processing (line 573) AND at queue-empty (line 558)
- The adapter calls it directly in `feedTransition()` (empty queue guard) and `advanceStep()` (all steps consumed, pending state still present)
- The timer only fires when `!animating && queueEmpty && !resolving` — conditions that the adapter handles via the step queue + `busy` signal

**If the orchestrator is ever refactored** to rely on this timer (removing explicit `applyPendingBoardState()` calls), the adapter will need a matching timer.

### L3 — Prompt ReadOnly Mode Not Yet Implemented

9 prompt components exist (`PromptYesNoComponent`, `PromptChoiceComponent`, `PromptCardGridComponent`, etc.) but **none** currently support `readOnly` or `preSelectedResponse` inputs. Implementation is required in Step 5 (Prompt Components: Read-Only Mode + Prompt Context Inputs). Key considerations:
- All use an `answered: boolean` flag that can be adapted for pre-population
- `PromptChoiceComponent` has a countdown timer that must be stopped in readOnly mode
- No visual styling exists for "frozen" state (disabled buttons, grayed out)
- Each of the 9 components needs individual work (~5-10 lines each)
- `PvpPromptDialogComponent` needs `hintContext` + `confirmedCards` optional inputs (v4.4) to display contextual card names and excavated cards in replay Decision mode

### L4 — Proportional Prompt Duration Requires Post-Deploy Captures

`CapturedResponse.timestamp` is added to `capturedSetResponse()` — it captures the wall-clock time during the **live game**. Only games played **after this feature ships** will carry timestamps. Existing replays will have `timestamp: undefined`, falling back to `PROMPT_DISPLAY_FALLBACK` (1.5s) for all prompt pauses in auto-playback. This is graceful degradation, not a bug — proportional duration is an enhancement, not a correctness requirement.

### L5 — Board State Visible During Prompt Display

In phased mode, the orchestrator calls `applyPendingBoardState()` (L573) after the first event of each segment — applying `next.boardState` (post-response state). This happens BEFORE the prompt is displayed (prompt appears at `setAnimating(false)`, L551). Since Angular change detection hasn't run yet between L573 and L551, the viewer sees both the prompt and the post-response board state simultaneously.

**Why this is acceptable:**
- `applyPendingBoardState()` at L573 is the same behavior as live PvP — the board state jumps after the first event, pre-masking creates visual continuity. Changing this would require orchestrator modifications.
- Response effects (e.g., `MSG_CHAINING` after a chain "Yes") are generated in the NEXT `duelProcess()` iteration. The board state at the prompt point is post-response but pre-effects — typically identical or near-identical to the pre-response state.
- The prompt dialog overlays most of the board, minimizing visual impact.
- For `SELECT_PLACE` / `SELECT_DISFIELD` (zone highlights on the board), the board is visible but the zone highlight shows the selected answer — which IS the post-response state.

**If visual parity with pre-response state is needed** for specific prompt types, a targeted fix could gate `applyPendingBoardState()` when `_activeDecision() !== null` and maintain pre-masking. This would require careful testing with `clearAllTravels()` (L557) which removes floating cards — without the board state update, cards would snap back to their pre-travel positions.

### L6 — Chain Entry Animation Timing Differs From Live PvP

In live PvP, `visiblePrompt` (`duel-page.component.ts:454`) gates prompts behind **4 conditions** — the prompt only appears when ALL are false:

```typescript
const blocked = animating || chainEntryAnim || queuePending || chainPromptGate;
```

- `animating` — orchestrator `isAnimating()` (card travel in flight)
- `chainEntryAnim` — `orchestrator.chainEntryAnimating()` (overlay card entry, `constructAppear` duration = **800ms at 1.0x speed**, scaled by `speedMultiplier`)
- `queuePending` — `animationQueue().length > 0` (events not yet dequeued)
- `chainPromptGate` — `orchestrator.chainPromptGateActive()` (post-chain-solving guard)

**Special exception:** During chain building with a pending cost entry (`chainPhase === 'building' && hasPendingChainEntry()`), cost prompts pass through even if `chainEntryAnim` is true — but only if `!animating && !queuePending`. This allows tribute/cost prompts to appear during the overlay card entry animation.

The full gating sequence for a chain prompt:

1. `handleMessage(SELECT_CHAIN)` → commit → `activeChainLinks` = [card]
2. Orchestrator processes `MSG_CHAINING` → `activateEffect` (zone glow, ~500ms)
3. Overlay Effect A → `onNewChainLink()` → `chainEntryAnimating.set(true)` → card constructs (800ms)
4. Both glow and entry animation run **concurrently**
5. `visiblePrompt` waits for `!animating && !chainEntryAnim && !queuePending && !chainPromptGate` → prompt appears after all finish

In replay, the step queue produces a different timing:

1. Animate step `[MSG_CHAINING]` → orchestrator processes → zone glow (~500ms)
2. Glow finishes → `setAnimating(false)` → `advanceStep()`
3. Decide step → commit → overlay entry animation **starts** → prompt appears **immediately**

The prompt is visible ~800ms earlier in replay (during the entry animation, not after). There is **no `chainEntryAnimating` gating** in the replay page.

**Why this is acceptable:**
- The viewer has no time pressure (no timer, no opponent waiting).
- The card constructing in the overlay while the prompt is visible is a smooth visual — the viewer sees context building alongside the decision.
- Adding the gate would require the replay page to read `chainEntryAnimating` and delay `_activeDecision` display by ~800ms — added latency for a purely cosmetic difference.
- The difference only affects `SELECT_CHAIN` decide steps during chain building. All other prompts have identical timing (step queue sequencing ≈ `visiblePrompt` drain).
- The special exception for cost prompts during building phase is not needed in replay (cost prompts are intermediate `SELECT_*` types, handled as decide steps with their own timing).

---

## Implementation Steps

### Step 1 — DRY Extractions

1. `chain-badge.utils.ts`
2. `phase-announcement.service.ts`
3. `_pvp-overlays.scss`
4. `pvp-duel-overlays.component.ts`

**Validation:** Live PvP plays identically.

### Step 2 — AnimationDataSource Interface

1. Create `animation-data-source.ts` (interface + `ANIMATION_DATA_SOURCE` InjectionToken)
2. `DuelWebSocketService implements AnimationDataSource` (1 line — methods already present)
3. Add `ANIMATION_DATA_SOURCE` provider in `DuelPageComponent`

**Validation:** Live PvP unchanged. Token exists, unused.
**NOTE:** `DuelConnection` (concrete class) is NOT modified.

### Step 3 — Orchestrator + Chain Overlay Migration

1. `AnimationOrchestratorService`: `wsService` → `dataSource` (~30 renames), type `AnimationDataSource`
2. `PvpChainOverlayComponent`: inject `ANIMATION_DATA_SOURCE`
3. `DuelPageComponent`: rename init param

**Validation:** Live PvP plays identically via interface type. Verify: `ng build` succeeds, no `DuelWebSocketService` imports remain in orchestrator or chain overlay, config object key names match between caller and callee (`dataSource` not `wsService`).
**Verify interface completeness:** `DuelWebSocketService implements AnimationDataSource` must compile without errors — all 5 signals + 8 methods must be present on the facade. If `applyChainSolving`/`applyChainSolved`/`applyChainEnd` are not currently exposed by the facade (only on `DuelConnection`), add delegation methods.

### Step 4 — Backend: Enrich PreComputedState + Transition Boundary Change

1. Add `DecisionMoment` type (with `hint?` + `confirmedCards?` fields — v4.4) + `decisions` field to `PreComputedState` (both TS files)
2. **Change worker transition boundaries** — distinguish `TRANSITION_BOUNDARY_PROMPTS` (SELECT_IDLECMD, SELECT_BATTLECMD) from intermediate prompts. Only boundary prompts flush a new `PreComputedState`. Intermediate prompts accumulate decisions and feed responses without flushing. Phase/turn handlers must also flush accumulated decisions.
3. Capture decisions[] array in `duel-worker.ts` pre-computation (accumulate per transition, reset on flush)
4. Add `timestamp` in `capturedSetResponse()`
5. Track `lastHint` and `lastConfirmedCards` accumulators in `runReplayPreComputation()` — set on `MSG_HINT`/`MSG_CONFIRM_CARDS`, consumed (included + reset) on each `SELECT_*` (v4.4)
6. **Ensure ALL event types are captured in `events[]`** — including `MSG_BECOME_TARGET`, `MSG_HINT`, and any other events that the live DuelConnection passes to the animation queue. The worker must NOT filter events during pre-computation. The `events[]` array must be a complete record of what the orchestrator would see in live mode.

**Validation:** Pre-computed states include prompt+response pairs with hint/confirmedCards context. Verify a chain building sequence (SELECT_CHAIN × 2) produces ONE PreComputedState with `decisions.length === 2` (not two separate states). Verify `MSG_BECOME_TARGET` events are present in events[]. Verify `MSG_HINT` preceding a `SELECT_EFFECTYN` produces a `DecisionMoment` with non-null `hint.cardName`. Existing replay still works (all new fields are optional).

### Step 5 — Prompt Components: Read-Only Mode + Prompt Context Inputs

**NOTE:** 9 prompt components exist, none currently support readOnly. Each needs:
- `readOnly = input(false)` — disables all interaction (pointer-events: none, buttons disabled)
- `preSelectedResponse = input<unknown>(undefined)` — pre-populates the response and marks `answered = true` on init
- CSS `.selected` highlight class for the pre-selected option
- `PromptChoiceComponent`: also stop countdown timer when readOnly

1. Add `readOnly` + `preSelectedResponse` inputs to all 9 prompt components:
   - `PromptYesNoComponent`, `PromptChoiceComponent`, `PromptCardGridComponent`
   - `PromptNumericInputComponent`, `PromptZoneHighlightComponent`, `PromptAnnounceCardComponent`
   - `PromptOptionListComponent`, `PromptSortCardComponent`, `PromptPositionSelectComponent`
2. `PromptZoneHighlight`: add `selectedZone` input for zone marker
3. CSS: `.selected` highlight styles per prompt type
4. **NEW: `PromptActionListReadonlyComponent`** for `SELECT_IDLECMD`/`SELECT_BATTLECMD` (currently in `IGNORED_PROMPT_TYPES` — needs dedicated read-only renderer)
5. **`PvpPromptDialogComponent`: add `hintContext` + `confirmedCards` optional inputs** (v4.4) — in live mode these default to null and the component reads from injected `DuelWebSocketService`; in replay mode the inputs provide the context from `DecisionMoment`. The component prioritizes input over injected service when non-null.

**Validation:** Live PvP prompts unchanged (inputs default to false/undefined/null). Read-only mode testable in isolation. Verify: prompt with `hintContext` input shows card name in prompt text; prompt with `confirmedCards` input shows excavated cards in card selection UI.

### Step 6 — ReplayDuelAdapter

1. Create `replay-duel-adapter.ts`
2. Implement AnimationDataSource contract (with `Signal<GameEvent[]>` for animationQueue — NOT plain array)
3. Implement **`dequeueAnimation()` as internal loop** — consumes non-GameEvent types (MSG_CHAIN_NEGATED, WAITING_RESPONSE, SELECT_*) internally via `continue`. Only returns true `GameEvent` types. Mirrors DuelConnection's deferred commit behavior with pending chain entry pattern (commit points: MSG_CHAIN_SOLVING, next MSG_CHAINING, MSG_CHAIN_END + defensive SELECT_CHAIN/WAITING_RESPONSE)
4. Implement `filterEventsForQueue()` — strips ALL SELECT_*, MSG_CHAIN_NEGATED, WAITING_RESPONSE. Returns `GameEvent[]` with proper type predicate `(e): e is GameEvent`
5. Implement `feedTransition()` with **empty queue guard** + `_steps = []` — if filtered events are empty, apply pending board state directly and clear `busy`
6. Implement **`buildSteps()`** — interleaves `animate`/`decide` steps by splitting raw events at each `SELECT_*` that has a matching decision. Trailing events after last `SELECT_*` become a final animate step
7. Implement **`advanceStep()`** — central step consumer. On `decide` step: set `_activeDecision`. On `animate` step: set `_animationQueue`. On empty animate: skip (recurse). On no steps left: apply pending board state if present, clear `busy`
8. Implement `feedTransitionPhased()` — calls `buildSteps()` + `advanceStep()` to start the sequence
9. Implement `resumeAfterPrompt()` — clears `_activeDecision`, calls `advanceStep()`
10. Implement `collapseRemainingSteps()` — merges remaining animate steps, skips decide steps, feeds merged batch
11. Implement **`setAnimating(false)` as step queue hook** — calls `advanceStep()`. In result mode (`_steps = []`), this clears `busy`. In phased mode, this advances to the next step
12. Implement single `_activeDecision` signal + 5 derived computeds (`activePrompt`, `activeResponse` = `.data`, `activePlayer`, `activeHint`, `activeConfirmedCards`, `activeTimestamp`)
13. Implement `abort()` (clears `_steps`, `_activeDecision`, `_pendingChainEntry`, chain state), `jumpToState()`

**Validation:** Unit-testable — feed events with chain sequences, verify pending entry commits at correct points. Feed MSG_CHAIN_NEGATED, verify `negated: true` on correct link. Feed empty events, verify `busy` clears. **Feed multi-decision transition** (2 SELECT_* with 2 decisions): verify `buildSteps()` produces 5 steps (animate-decide-animate-decide-animate), verify each prompt appears AFTER its preceding animations complete (not simultaneously), verify events between SELECT_* play as separate animate segments. Feed DecisionMoment with hint, verify `activeHint()` returns it during prompt pause. **Feed chain building sequence** (MSG_CHAINING → SELECT_CHAIN decide step): verify `commitPendingChainEntry()` is called before `_activeDecision.set()`, verify chain link is in `activeChainLinks` during prompt pause (chain overlay visible).

### Step 7 — ReplayPageComponent Rewrite

1. Wire providers (adapter, orchestrator, services)
2. **`ngOnInit`: call `orchestrator.init({ dataSource: adapter, ownPlayerIndex: () => perspectiveIndex(), ... })`** — CRITICAL, without this no animations play
3. **`ngOnInit`: add queue watcher effect** — `effect(() => { if (adapter.animationQueue().length > 0) orchestrator.startProcessingIfIdle() })`. CRITICAL — mirrors `duel-page.component.ts:876`. Without this effect, events fed by the adapter are never processed by the orchestrator
4. **`ngOnDestroy`: call `clearPlaybackTimer()`, `abortAndClean()`, `orchestrator.destroy()`** — prevents orphaned timers + effects
4. **`abortAndClean()` DRY helper** — `cardTravel.clearAllTravels()` + `phaseService.clear()` + `adapter.abort()`. Used by: `onStepForward` (busy guard), `onStepBack`, `onSeek`, `onScrub`, `onToggleAnimations`, `onTogglePerspective`, `onFork`, `ngOnDestroy`
5. Template: board components + prompt display + replay controls + debug log panel, all indexed via `perspectiveIndex()`
   - **Zone highlight in replay:** For `SELECT_PLACE`/`SELECT_DISFIELD` decisions, wire `highlightedZones` (eligible zones) from the prompt data AND apply a distinct `--chosen` CSS class on the zone matching `selectedZone` (from `PromptZoneHighlightComponent` input) to visually mark the zone that was actually selected
6. Navigation: step forward (phased), step back, seek, scrub — all use `abortAndClean()` for interruption
7. Playback loop with decision-pause auto-resume
8. **`promptMode` toggle** (`'result' | 'decision'`) — decision-pause on prompts, transport bar binding. Switch decision→result during prompt calls `adapter.collapseRemainingSteps()`
9. **`logDetail` signal** (`'normal' | 'debug'`) — preserved from existing `granularity`, drives `buildReplayLogEntries()`, toggled via `G` key
10. **Perspective toggle** — `perspectiveIndex` signal, `onTogglePerspective()` handler, transport bar button
11. Remove old `triggerTransitionAnimations()` (replaced by orchestrator)
12. **Remove `DuelWebSocketService` injection** — the existing component injects `DuelWebSocketService` (line 54) and includes it in `providers` (line 38). The rewrite must NOT inject it — replay uses `ReplayDuelAdapter` via `ANIMATION_DATA_SOURCE`, not the WS facade. Verify no residual `wsService` references remain.

**Validation:** Full replay with animations + decision mode + perspective swap. Verify: debug log panel still toggles between collapsed/expanded events via `G` key. Verify: no `DuelWebSocketService` import in the rewritten component.

### Step 8 — CLAUDE.md Sync Rule

```markdown
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
```

### Dependency Graph

```
Step 1  (DRY extractions)             ← standalone
Step 2  (AnimationDataSource iface)   ← standalone
Step 3  (Orchestrator migration)      ← depends on 2
Step 4  (Backend: decisions[] data)   ← standalone, parallelizable with 1-3
Step 5  (Prompt read-only mode)       ← standalone, parallelizable with 1-4
Step 6  (ReplayDuelAdapter)           ← depends on 2
Step 7  (ReplayPage rewrite)          ← depends on 1, 3, 4, 5, 6
Step 8  (CLAUDE.md rule)              ← after all
```

Steps 1, 2, 4, 5 are parallelizable. Steps 4+5 are independent of the AnimationDataSource refactor.

---

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Orchestrator accesses method not in AnimationDataSource | Low | Build error | Interface enforces contract at compile time |
| Chain overlay deadlock in replay | Medium | Animation freeze | Existing 3s deadlock guard + playback polls `isAnimating()` with 100ms + user can seek to abort |
| Phased queue split leaves orphaned segment | Low | Stale prompt | `abortAndClean()` clears `_steps` + `_activeDecision` + card travel + phase. All interruption callsites use the DRY helper |
| Decision mode prompt type not handled | Medium | Empty dialog | Fallback: show label-only for unknown prompt types |
| Pre-masking reads stale queue after abort | Low | Brief ghost | `abortAndClean()` clears queue + card travel floating elements in one call |
| Large event batch (100+ events) | Low | Slow animation | AC7 queue collapse handles automatically |
| Live PvP regression from AnimationDataSource refactor | Very Low | Broken duels | Mechanical renames only. DuelConnection untouched. Validate after steps 2-3 |
| Multi-prompt transitions show wrong decision | Medium (v3 bug, fixed in v4) | Wrong prompt/answer highlighted | `decisions[]` array + `buildSteps()` interleaves animate/decide steps — each prompt paired with correct decision |
| animationQueue not reactive (v3 bug, fixed in v4) | High (v3 bug) | Animations never trigger | `_animationQueue` is a `Signal<GameEvent[]>`, mutated via `.set()`/`.update()` — not a plain array |
| Orphaned playback timers on page destroy | Medium (v3 gap, fixed in v4) | Timers fire after navigation | `ngOnDestroy` calls `clearPlaybackTimer()` + `abortAndClean()` |
| IDLECMD/BATTLECMD invisible in decision mode (v3 gap, fixed in v4) | High (v3 gap) | Most frequent prompts missing | Dedicated `PromptActionListReadonlyComponent` — bypasses `IGNORED_PROMPT_TYPES` |
| Orchestrator not initialized in replay (v3 gap, fixed in v4) | Critical (v3 gap) | Zero animations play | `ngOnInit` calls `orchestrator.init({ dataSource: adapter, ... })` |
| Response data increases payload size | Very Low | Larger WS messages | Responses are tiny (~20-50 bytes). PreComputedState already large |
| Rapid step-forward during animation | Medium | Orphaned card travel elements, stale overlay | `onStepForward()` calls `abortAndClean()` before feeding new transition |
| Fork during animation leaves async contract pending | Medium | Chain overlay deadlock | `onFork()` calls `abortAndClean()` before fork handshake |
| `prefers-reduced-motion` + playback timer 1200ms | Low | Replay feels slow | Timer uses 500ms (not 1200ms) when reduced-motion is active |
| Rename config key mismatch (`wsService` → `dataSource`) | Very Low | Runtime crash | TypeScript strict mode catches missing/extra keys. Verify in Step 3 validation |
| Empty event queue after filtering (v4.1 bug, fixed in v4.2) | Medium (v4.1 bug) | `busy` stuck forever | `feedTransition()` now guards on empty filtered queue — applies board state directly and clears `busy` |
| Non-GameEvent types in animation queue | Very Low | Harmless no-op | Blacklist strips types with active roles (SELECT_*, MSG_CHAIN_NEGATED, WAITING_RESPONSE). Other non-GameEvent types (BOARD_STATE, TIMER_STATE, etc.) pass through safely — orchestrator's `default: return 0` ignores them. Whitelist rejected: would silently drop new GameEvent types forgotten in the list |
| `resumeAfterPrompt()` queue-scanning dead code (v4.1 bug, fixed in v4.2, rearchitected in v4.5) | Medium (v4.1 bug) | Decision pauses never trigger after first | Step queue pattern: `advanceStep()` drives pauses via `ReplayStep[]`, not queue scanning or `_remainingDecisions` |
| `phaseService.show()` missing arg (v4.1 bug, fixed in v4.2) | High (v4.1 bug) | Runtime crash or wrong labels | Added `turnCount` param + replaced hardcoded `0` with `perspectiveIndex()` |
| `onScrub()` missing cleanup (v4.1 bug, fixed in v4.2) | Medium (v4.1 bug) | Orphaned floating DOM elements | Now uses `abortAndClean()` (same as all other interruption points) |
| `granularity` signal name collision (v4.2 bug, fixed in v4.3) | Medium (v4.2 bug) | Existing debug log toggle overwritten | Renamed to `promptMode` (`'result'\|'decision'`). Existing signal renamed to `logDetail` (`'normal'\|'debug'`). Both preserved |
| Cleanup steps forgotten in future callsite (v4.2 gap, fixed in v4.3) | Medium (v4.2 gap) | Orphaned card travel / stale phase badge | `abortAndClean()` DRY helper centralizes the 3-step cleanup. All 8 callsites use it |
| Prompt displayed during animations (v4.4 bug, fixed in v4.5) | High (v4.4 bug) | Prompt visible while cards still traveling | Step queue: `setAnimating(false)` hook shows prompt AFTER orchestrator finishes segment |
| `busy` cleared between segments (v4.4 bug, fixed in v4.5) | High (v4.4 bug) | Board snaps to pre-computed state mid-transition | `advanceStep()` only clears `busy` when ALL steps exhausted |
| `activeResponse` passes wrapper (v4.4 bug, fixed in v4.5) | High (v4.4 bug) | Prompt highlight never matches | `activeResponse` computed returns `decision.response.data` (raw indices), not `CapturedResponse` wrapper |
| 5 decision signals desynced (v4.4 gap, fixed in v4.5) | Medium (v4.4 gap) | Wrong hint/player shown for prompt | Single `_activeDecision` signal + 5 derived computeds — impossible to desync |
| Missing queue watcher effect (v4.4 gap, fixed in v4.5) | Critical (v4.4 gap) | Zero animations play despite events in queue | Effect mirrors `duel-page.component.ts:876` — watches `adapter.animationQueue()`, calls `orchestrator.startProcessingIfIdle()` |
| Multi-decision events not interleaved (v4.4 gap, fixed in v4.5) | High (v4.4 gap) | Chain entry animations invisible between decisions | `buildSteps()` splits at EVERY `SELECT_*` with a matching decision, creating proper animate/decide interleaving |
| Worker boundary unchanged for multi-decision (v4.4 gap, fixed in v4.5) | Medium (v4.4 gap) | `decisions[]` always 0-1 entries | Worker now distinguishes boundary prompts (`SELECT_IDLECMD/BATTLECMD`) from intermediate prompts — only boundaries flush transitions |
| `promptMode` toggle shows next decision instead of collapsing (v4.4 gap, fixed in v4.5) | Medium (v4.4 gap) | User stuck in decision prompts after switching to result mode | `collapseRemainingSteps()` merges remaining animate steps, skips decide steps |
| Chain overlay missing during SELECT_CHAIN prompt (v4.4 gap, fixed in v4.5) | High (v4.4 gap) | Chain card invisible in overlay during decision, entry animation lost | `advanceStep()` calls `commitPendingChainEntry()` for SELECT_CHAIN decide steps — mirrors `DuelConnection.handleMessage` (line 551) |

---

## Files Summary

### New Files

| File | Lines | Purpose |
|---|---|---|
| `duel-page/animation-data-source.ts` | ~35 | Interface + InjectionToken |
| `replay/replay-duel-adapter.ts` | ~260 | AnimationDataSource impl + step queue + buildSteps + single decision signal |
| `duel-page/prompts/prompt-action-list-readonly/` | ~60 | Read-only renderer for IDLECMD/BATTLECMD |
| `duel-page/chain-badge.utils.ts` | ~30 | Pure functions (extracted) |
| `duel-page/phase-announcement.service.ts` | ~50 | Extracted service |
| `pvp/_pvp-overlays.scss` | ~105 | Extracted styles |
| `duel-page/pvp-duel-overlays/` | ~40 | Shared overlay component |
| **Total new** | **~540** | |

### Modified Files

| File | Nature |
|---|---|
| `animation-orchestrator.service.ts` | ~30 renames (mechanical) |
| `pvp-chain-overlay.component.ts` | injection swap (3 lines) |
| `duel-web-socket.service.ts` | `implements AnimationDataSource` (1 line) |
| `duel-page.component.ts` | provider + init param (2 lines) + use extracted utils/service |
| `duel-page.component.html` | use `pvp-duel-overlays` component |
| `duel-page.component.scss` | remove moved styles |
| `pvp-prompt-dialog.component.ts` | `readOnly` + `preSelectedResponse` + `hintContext` + `confirmedCards` (~49 lines) |
| `prompt-zone-highlight.component.ts` | `selectedZone` (~10 lines) |
| `duel-worker.ts` | decisions[] capture + timestamp + hint/confirmedCards tracking (~25 lines) |
| `ws-protocol.ts` | DecisionMoment type (with hint/confirmedCards) + PreComputedState (~12 lines) |
| `duel-ws.types.ts` | DecisionMoment type (with hint/confirmedCards) + PreComputedState (~12 lines) |
| `replay-page.component.ts` | Rewrite — adapter wiring + `abortAndClean()` DRY helper + `promptMode`/`logDetail` signals + perspective toggle |
| `replay-page.component.html` | Rewrite — board + prompt + controls + debug log panel + `perspectiveIndex()` indexing |
| `transport-bar.component.ts/html` | Add `promptMode` + `perspectiveIndex` inputs, `togglePromptMode` + `togglePerspective` outputs + buttons |
| `timeline-bar.component.html` | `[ownPlayerIndex]="perspectiveIndex()"` (was hardcoded `0`) |
| `CLAUDE.md` | Sync rule |

### What Is NOT Changed

- **`DuelConnection` (duel-connection.ts)** — **completely untouched** (concrete WebSocket class)
- `AnimationOrchestratorService` — **zero logic changes** (renames only)
- `CardTravelService` — unchanged
- `PvpBoardContainerComponent` — unchanged
- `PvpHandRowComponent` — unchanged
- `PvpChainOverlayComponent` — injection swap only
- No database migration — replays recomputed on demand
- No new i18n keys — reuse existing
