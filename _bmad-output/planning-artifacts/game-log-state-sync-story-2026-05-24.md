# Story — Game-log persistence across F5 (PvP STATE_SYNC extension)

**Date** : 2026-05-24
**Author** : Winston (architecture cadrage with Axel)
**Status** : Story ready, not started
**Estimated effort** : ~1 day single commit
**Branch (to create)** : `feat/game-log-state-sync-persistence`

---

## Context

Observed during the palier 0 EventStream test (see
[[queue-runner-extraction-chantier]]) : an F5 mid-PvP empties the
in-game journal (`game-log-panel`). Pre-existing behaviour on master
— not a palier 0 regression — but it became visible because the
palier 0 made the live journal complete and useful for the first time.

Memory backlog reference :
`memory/project_game_log_refresh_persistence_2026_05_23.md`.

---

## Decisions tranchées (architecture cadrage 2026-05-24)

Four decisions locked during the cadrage conversation with Axel.
Locking them here so we don't re-litigate them in 3 weeks.

### 1. Authority model — **server-authoritative**

The server owns the canonical game-log. On reconnect, it sends the
full entries list to the client.

**Why** : consistency with the existing `STATE_SYNC` contract, which
is already server-authoritative for board + chain + locks. Adding "and
the journal entries since duel start" extends the model without
breaking it. Also supports multi-device (open the duel on phone after
F5'ing on desktop — same journal).

**Rejected alternatives** :
- *Client-only via `localStorage` snapshot* — cheaper to ship but
  fragile (lost on storage clear, divergent across tabs of the same
  session, no multi-device).
- *Hybrid (localStorage cache + STATE_SYNC override)* — best UX but
  more code to maintain for marginal gain over pure
  server-authoritative.

### 2. Payload shape — **textual entries only**, not raw event stream

The server sends `GameLogEntry[]` (the already-built journal lines),
not the raw `StreamEvent[]` that produced them.

**Why** : lighter payload (~150-300 bytes per entry vs ~15-field
event metadata), and the client doesn't need the raw events for
journal display today. Doors closed (intentionally) for now :
"click an entry to jump-to-replay" or "tooltip showing the board at
that event". If those features become priority, revisit then.

### 3. Builder location — **main thread**, in `worker-message-router.ts`

A `GameLogBuilder` instance is held per session in the main thread,
ingested via a tap in the worker→client message router.

**Why** : three reasons.
1. The builder is **pure by contract** (see header in
   `duel-server/src/game-log/game-log-builder.ts`) — no compute-heavy
   work, just event→entry transformation. No gain from worker
   isolation.
2. The skytrix pattern already places per-session protocol-aware
   state in the main thread : `ChainSnapshotTracker`,
   `ChainStateTracker`. Same exact rationale (need direct access to
   `sendToPlayer` + session state).
3. Worker placement would force IPC serialization of the entries
   array on every `STATE_SYNC`. Main thread = `[...this.entries]`
   reference copy.

### 4. Delivery shape — **single story, one commit**

Server + front + tests + manual validation in one bundle.

**Why** : scope is small (~1 day), perimeter is well-defined, and
the optional field on `StateSyncMsg` makes the server-only first
deploy theoretically safe but adds zero practical value (the front
ignores unknown fields today). No reason to split.

---

## Implementation plan

### Server scope (`duel-server/`)

#### S1. Per-session builder ownership

In `worker-message-router.ts` :

- Add a `sessionGameLogs: Map<string, GameLogBuilder>` (sessionId →
  builder), or extend the existing per-session state container if one
  fits.
- Instantiate a fresh builder on session creation.
- In the worker→client message dispatch, BEFORE the
  `filterMessage` + `broadcastMessage` calls, tap
  `builder.ingest(event)` on each message.
- Clear the entry in `cleanupDuelSession` (or wherever the matching
  teardown lives) to avoid mem-leak across long-running deployments.

#### S2. Protocol extension

In `duel-server/src/ws-protocol-system.ts` :

```ts
import type { GameLogEntry } from './game-log/game-log-types.js';

export interface StateSyncMsg {
  type: 'STATE_SYNC';
  data: BoardStatePayload;
  /** Full journal entries from duel start to current event, relativized
   *  to the receiving player's perspective. Optional for backward
   *  compatibility with replay-precompute callers that never produce
   *  STATE_SYNC. Restored client-side via
   *  DuelGameLogService.restoreFromSnapshot(). */
  gameLogEntries?: GameLogEntry[];
}
```

Mirror byte-for-byte in `front/src/app/pages/pvp/duel-ws-system.types.ts`.
The `scripts/check-ws-protocol-sync.mjs` step in duel-server's
prebuild will fence this.

#### S3. Per-recipient relativization

In `sendToPlayer` (`server.ts` today, or wherever the helper ends
up after future extraction) :

- When the outgoing message is `STATE_SYNC`, read the session's
  `builder.entries` (absolute server perspective).
- Pass through a new pure helper `relativizeGameLogEntries(entries,
  perspective)` — mirrors the pattern of `swapBoardState` /
  `swapEventBoardStates`. Most `GameLogEntry` fields are already
  `RelPlayer` (0/1 relative-to-viewer) so the work is : swap
  `RelPlayer` 0↔1 when perspective === 1. Verify no absolute
  `Player` field leaks (the `RelPlayer` type itself is the
  type-system guard).
- Attach the relativized list to the outgoing msg.

#### S4. Tests (`duel-server/src/`)

- 1 spec for the router tap : after N ingested events, the per-session
  builder produces the expected entries (reuse a small fixture, ideally
  borrowed from the existing CLI corpus
  `tools/game-log-builder-cli.ts`).
- 1 spec for `relativizeGameLogEntries` : roundtrip absolute → rel(0)
  → identity, absolute → rel(1) → swap-verified.
- 1 spec verifying the message router clears the builder on session
  cleanup.

### Front scope (`front/src/app/pages/pvp/`)

#### F1. `DuelGameLogService.restoreFromSnapshot`

```ts
restoreFromSnapshot(entries: GameLogEntry[]): void {
  this.reset();              // clears builder + tappedEvents
  this.builder.entries.splice(0, this.builder.entries.length, ...entries);
  // tappedEvents stays empty — future drains repick from the current
  // EventStream position; no replay of past events from the front.
}
```

The signal feeding the panel re-emits on the splice (verify the
`entries` accessor is exposed as a signal or that the panel reads
through a computed wrap).

#### F2. STATE_SYNC consumption

Wherever the client today handles `STATE_SYNC` (likely
`DuelWebSocketService.onStateSync` or equivalent), after the
existing `orchestrator.onStateSync(...)` call :

```ts
if (msg.gameLogEntries) {
  this.gameLog.restoreFromSnapshot(msg.gameLogEntries);
}
```

Order matters : restore the journal AFTER the orchestrator has
reset its state, so the `gameLog.reset()` chain doesn't race-clear
what we just restored.

#### F3. Tests (`front/src/app/pages/pvp/duel-page/`)

- 1 spec on `DuelGameLogService.restoreFromSnapshot` : populate, then
  drain a new event via the EventStream, verify the new entry is
  appended to the restored ones (not replacing).
- Add a STATE_SYNC scenario to `duel-game-log.service.spec.ts`
  covering the wire-through.

---

## Pre-requisites — VERIFY BEFORE CODING

Two assumptions underpin this plan. If either is false, the plan
needs rework.

### PR1. Does the message router see ALL relevant events ?

The builder's grammar covers `MSG_MOVE`, `MSG_DRAW`, `MSG_DAMAGE`,
`MSG_CHAINING`, `MSG_CHAIN_NEGATED`, `MSG_WIN`, `SELECT_CARD` (the
last three matter especially — they are the events that the palier
0 EventStream rescued from PvP↔Replay divergence).

**Verify** : grep `worker-message-router.ts` for any per-type
short-circuit that would skip these. If a type is filtered out
before reaching the broadcast point, the tap won't see it either.
If so : either move the tap upstream, or add a dedicated tap
specifically for the journal (the palier 0 pattern of
`attachOutOfBandSink` shows the precedent).

### PR2. Is the server-side `GameLogBuilder` truly byte-equivalent to the front-side one ?

`duel-server/src/game-log/game-log-builder.ts` and
`front/src/app/pages/pvp/game-log/game-log-builder.ts` are claimed
byte-synced (memory: "GameLogBuilder (front+back byte-synced, pure)").

**Verify** : `diff` the two files modulo `.js` import suffix. If
they have diverged silently (no automated sync check currently
fences this file specifically, unlike the WS protocol), this story
has a side-task : either reconcile, or add a sync check for
game-log files.

The risk : the server builds entries based on its understanding of
the events, but the front rebuilds a slightly different set when
fed the same stream. Today this is hidden because the front
ingests live events (its builder is the source of truth for live
display). Once the front trusts a server-built entries snapshot,
any drift becomes a visible bug.

---

## Manual validation checklist

Run via the `verify` skill or by hand. Each scenario : note the
expected vs observed in the commit message if anything surprises.

- [ ] **F5 early-duel** (turn 1, main phase, no chain). Journal repopulates
      with the opening events (turn marker, initial draws, etc.).
- [ ] **F5 mid-animation** (during an MSG_MOVE travel). Journal shows
      the pre-animation state ; subsequent events drain correctly via
      EventStream after STATE_SYNC.
- [ ] **F5 mid-chain** (`chainPhase === 'resolving'`). Critical scenario.
      Journal shows the chain entries built so far ; no duplication
      after the post-sync events flow in.
- [ ] **F5 multi-device** if the session model supports it (desktop
      then phone same account). Both clients see the identical journal.
- [ ] **F5 post-MSG_WIN before close**. The victory line is in the
      restored journal.
- [ ] **F5 in SOLO PvP mode** (the test scenario where palier 0 was
      validated). Verify no interaction with the bugs tracked in
      [[pvp-solo-chain-state-hygiene-2026-05-23]] — those bugs are
      pre-existing and orthogonal, but the F5 path crosses similar
      state-reset code, so an explicit check is cheap insurance.

---

## Out of scope (intentionally)

- **Raw event stream persistence** (would enable click-to-jump-replay).
  Deferred — revisit if/when that feature is prioritized.
- **localStorage cache layer** (would smooth the F5 paint by avoiding
  the empty-journal flash before STATE_SYNC arrives). Skipped — the
  STATE_SYNC arrives fast enough today that the flash is not a UX
  blocker. Easy add-on later if user feedback says otherwise.
- **Fix for the SOLO chain-state bugs** ([[pvp-solo-chain-state-hygiene-2026-05-23]]).
  Different root cause (race conn↔orchestrator at switchPlayer during
  chain). Tracked separately.
- **Backfill of journal entries for replays already in the DB**. Live
  PvP only ; replays already have their own journal reconstruction
  path via `rebuildUpTo` (which is unchanged by this story).

---

## Open questions surfacing during implementation — append here

(blank — fill in as the dev hits them)
