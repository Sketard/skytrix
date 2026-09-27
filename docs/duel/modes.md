# Moteur de duel — modes

**Lecture** : les modes de duel (PvP, solo multiplex, fork-solo, replay) et les drapeaux `soloMode`/`forkMode` ; texte
de l'ancien `CLAUDE.md`, déplacé tel quel (en anglais) le jour de l'adoption du plugin `workbench`. Index du moteur de
duel : [`README.md`](README.md). Se lit par sections : `Grep "^## "`, puis `Read` par plage.

## Sommaire

1. Modes — vue d'ensemble
2. Fork-solo unification (F5-bis, 2026-05-31)

## Modes — vue d'ensemble

Skytrix has **3 live duel modes** (interactive OCGCore + WS sessions)
and **1 archive mode** (precomputed read-only playback) on top of the
animation pipeline. Plus a **paused R&D solver** that consumes the
duel-server / OCGCore stack for headless analysis.

| Mode | Bootstrap entry | Worker entry | Sockets | Server flags |
|---|---|---|---|---|
| **PvP normal** | POST `/api/duels` (2 distinct players) | `INIT_DUEL` | 2 (slots 0 + 1, both connected) | `soloMode: false, forkMode: false` |
| **PvP solo multiplex** | POST quick-duel (1 player plays both sides) | `INIT_DUEL` | 1 (slot 0 ; slot 1 reserved-but-never-connected) | `soloMode: true, forkMode: false` |
| **Fork-solo** | Replay viewer → REPLAY_FORK | `INIT_FORK` (precompute + sanity ; same worker process stays live with `forkMode=true`, no second init) | 1 (same as SOLO multiplex) | `soloMode: true, forkMode: true` |
| **Replay** | Replay viewer → WS replay handshake (replayId in the URL query param ; precompute auto-starts on connect) | `INIT_REPLAY` (precompute batch only ; no live session) | 1 (WS replay endpoint, NOT WS duel) | n/a — no `ActiveDuelSession` |

**Mental pivot — fork-solo IS a SOLO multiplex.** Post-F5-bis (2026-05-31)
the fork-solo runtime is structurally identical to a SOLO multiplex
session ; only the bootstrap differs (sourced from a replay seek point
instead of a fresh POST). The `forkMode` flag gates exactly 3 server-side
divergences (audit 2026-06-11 recount) : no replay persist, fork-expiry
cleanup instead of the rematch flow (same `rematchTimeout` slot, fires
`cleanupDuelSession` directly — plus a defense-in-depth REMATCH_REQUEST
reject in `client-message-router`), log tag `'fork_solo'`. Everything
else (omniscient filter, 1-socket slot routing, chain tracking,
MSG_CONFIRM_CARDS tagging, winReasonCode, game-log ingestion,
cancel-rollback, no turn timer, SOLO orphan deadline) is inherited from
SOLO multiplex by construction. See "Fork-solo unification (F5-bis)" below.

**Mental pivot — replay is NOT a live duel.** The replay path runs the
worker in **precompute batch mode** : it replays the recorded
`playerResponses` against OCGCore and streams `REPLAY_STREAM_CHUNK +
REPLAY_STREAM_INIT` (messages: `ServerMessage[]` + navIndex:
`ReplayStreamNavEntry[]`) to the replay viewer, which consumes the stream
like an enriched video with play/pause/seek. There is no `ActiveDuelSession`,
no `broadcastMessage`, no per-message routing — the client drives playback
via `MockDuelConnection` + `ReplayTransportService` (v4 Phase 5, 2026-06-05
— the legacy `ReplayDuelAdapter` retired ; v4 Phase 6, 2026-06-06 — the
legacy `PreComputedState[]` / `REPLAY_BOARD_STATES` retired, the nav
index absorbs `events[]` + `responseCount` 1:1). See "Replay = PvP
readonly via MockDuelConnection" ([replay.md](replay.md)) and "Pre-computation Timeline Rules" ([orchestrator.md](orchestrator.md))
for the parity contracts that keep replay's rendered behavior identical
to PvP's.

**The fifth consumer — R&D solver (paused).** `duel-server/src/solver/`
hosts a paused combo-path solver (R&D since 2026-04, last work
2026-05-05 ; see memory `solver-repo-cleanup-2026-05-05`) that
**ALSO spawns OCGCore** (via its own pipeline, not `duel-worker.ts`)
for headless deck analysis. It is not a runtime mode but a CLI / batch
harness — useful when debugging OCGCore behavior in isolation, because
the solver's evaluators can replay arbitrary game states without the
WS / session overhead. If you need to reproduce a tricky OCGCore
question without booting the full duel-server, the solver's
`evaluate-structural.ts` or `solver-poc.ts` entry points are valid
exploration tools. Treat its code as archived ; do not extend it
without re-activating the R&D track.

**Cross-mode invariants** (all 4 consumers share these by contract) :
- **Animation pipeline** — `AnimationOrchestratorService` consumes the
  same `GameEvent[]` regardless of mode. PvP↔Replay parity is structural
  (see "Animation Parity Rule" in [animation.md](animation.md)).
- **Perspective** — absolute (server P0/P1) vs relative (viewer 0/1)
  routed via `DuelContext.relativePlayer()` where injection is
  available. See "Perspective Convention" + "Relativizer routing
  discipline (F6)" in [perspective.md](perspective.md).
- **Chain state machine** — `idle | building | resolving` on both
  client and server, transitions matched by contract. See "Cross-side
  `chainPhase` parity (F9)" in [chain.md](chain.md).
- **Game log** — every mode feeds the same `GameLogBuilder` via the
  EventStream (palier 0). See "EventStream vs AnimationQueue" in [animation.md](animation.md).

## Fork-solo unification (F5-bis, 2026-05-31)

For the mode table + the high-level "fork-solo IS a SOLO multiplex"
pivot, see "Modes — vue d'ensemble" at the top of this file. This
section documents the runtime contract : the 3 fork-specific skips,
the inherited-from-SOLO surface, and the call-site invariants.

`ActiveDuelSession.forkMode: boolean` implies `soloMode: true` and is
NEVER set on a PvP normal session. The 3 legitimate combinations
(`soloMode: false / forkMode: false` = PvP, `soloMode: true /
forkMode: false` = SOLO multiplex, `soloMode: true / forkMode: true`
= fork-solo) all flow through the same `attachWorkerHandlers` →
`broadcastMessage` path. The 3 fork-specific behavioral differences :

1. **No replay persist** — `worker-message-router.ts`
   `case 'WORKER_REPLAY_DATA'` skips `persistReplay` when
   `session.forkMode`. Fork-solo derives from an existing replay,
   recording the variant doesn't make sense.
2. **Fork-expiry instead of rematch** — `duel-end-coordinator.ts
   handleDuelEnd`
   ([duel-end-coordinator.ts:126](../../duel-server/src/duel-end-coordinator.ts#L126))
   arms the shared `rematchTimeout` slot with `onForkSessionExpired`
   (→ `cleanupDuelSession`, no REMATCH_CANCELLED) instead of
   `onRematchExpired`. Fork-solo is exploratory one-shot — no rematch
   flow — but the session still needs a terminal deadline : fork
   sessions have no Spring Room (DELETE /api/duels can't reach them)
   and the soloMode close path has no grace period (audit 2026-06-11
   #2/#3 — the historical "skip the arm entirely" leaked every ended
   fork session forever). `client-message-router` additionally rejects
   REMATCH_REQUEST for fork as defense in depth. (Pre-U34
   audit-4-modes-2026-06-01 this lived in `worker-lifecycle.ts`.)
3. **Log tag** — `broadcastMessage` `case 'MSG_WIN'` writes
   `mode: 'fork_solo'` on the DUEL_END log line, alongside `'solo'`
   for SOLO multiplex and `'pvp'` for PvP normal. For audit-log
   filtering only.

### Inherited from SOLO multiplex (no fork-specific code)

Everything else flows through the SAME code path as a regular SOLO
multiplex session, no per-fork branches :

- **Omniscient filter** : `broadcastMessage` SOLO branch
  ([worker-message-router.ts:358-380](../../duel-server/src/worker-message-router.ts#L358-L380))
  fires on `session.soloMode`, applies to fork.
- **1-socket routing** : `decideSoloRouting` / `PSEUDO_PAIRWISE_SOLO_ROUTED`
  in `lifecycle-helpers.ts` handle slot-1 sends via tag (no-op or
  route-to-0). Same for fork.
- **Chain tracking** : `applyChainTransition` runs in
  `broadcastMessage` for every message. Same for fork.
- **MSG_CONFIRM_CARDS chainIndex tag** : tagged in `broadcastMessage`
  via `session.currentSolvingChainIndex`. Same for fork.
- **`winReasonCode` on DUEL_END** : extracted from `MSG_WIN.reason` in
  `broadcastMessage`. Same for fork.
- **Game-log ingestion** : `broadcastMessage` top of body runs
  `ingestIntoSessionGameLog(session.gameLog, message)`. Same for fork.
- **Cancel-rollback** : `takeWorkerSnapshot()` fires at every
  IDLECMD/BATTLECMD boundary
  ([duel-worker.ts:1182](../../duel-server/src/duel-worker.ts#L1182))
  regardless of `forkMode`. Fork-solo inherits the anti-fat-finger
  discipline — FULLY since audit 2026-06-11 #5 : two pre-F5-bis
  leftover gates (a hard CANCEL_PROMPT_SEQUENCE reject + a `!forkMode`
  gate on the stale-snapshot drop) were removed ; the worker's cancel
  path is now mode-agnostic. (The worker's own `forkMode` flag is
  scoped to other bootstrap concerns : bypassing `capturedSetResponse`,
  the `FORK_RESUME` handler — see "Worker `forkMode` variable" below.)

### Turn timer disabled in SOLO + fork (F5-bis behavior change)

The `case 'WORKER_DUEL_CREATED'` handler in
[worker-message-router.ts](../../duel-server/src/worker-message-router.ts)
now wraps `timerContext` allocation + `sendTimerStateToAll` in
`if (!session.soloMode)`. Rationale : a turn timer counting down
against oneself is a paradox. SOLO and fork-solo simply skip the
allocation ; all timer-management functions early-return on
`timerContext === null` so no further branches are required.

**Client behavior** : with no `TIMER_STATE` ever emitted, the
`pvp-timer-badge` component reads `timerState() === null` →
`effectiveRemainingMs() === null` → displays `'--:--'` cosmetically.
All UI computeds degrade gracefully (no crash, no NaN, no off-by-one).

**Inactivity timer kept** : the per-prompt inactivity timer
(`startInactivityTimer`) is still armed via `broadcastMessage` for
SOLO sessions. Load-bearing — protects against worker leaks when the
client keeps the socket open without activity (5min timeout → forfeit
+ session cleanup). The "you forfeit yourself" paradox is accepted in
exchange for the resource-leak protection. SOLO players who walk away
from an active prompt for >5min will see "duel ended by inactivity" ;
closing the tab cleanly is the recommended flow.

**SOLO orphan deadline (audit 2026-06-11 #4)** : closing the tab
mid-duel clears the closing player's inactivity timer — when the
pending prompt targeted slot 0 (the common case) nothing else bounded
the session, and the WAITING worker + session leaked forever. The
`ws.on('close')` SOLO branch now arms `session.soloOrphanTimeout`
(`SOLO_ORPHAN_TIMEOUT_MS` = 5min) before returning ; it fires the same
teardown as an inactivity forfeit (`requestReplayFromWorker('TIMEOUT')`
+ `handleDuelEnd`), double-checks `isFullyDisconnected` at fire time,
and is disarmed on (re)connect and by `clearAllDuelTimers`. Pinned by
source-level specs in `pvp-connection-handler.spec.ts`. Related belts :
`cleanupDuelSession` now calls `safeTerminateWorker` itself (audit #11
— last line of defense against hung workers), and the H17 60s
connection-timeout only fires when `startedAt === null` (audit #12 —
it used to kill a live SOLO duel whose F5 refresh straddled T+60s).

### Fork-specific construction (the only path that touches `forkMode`)

[fork-handlers.ts createForkSoloSession](../../duel-server/src/fork-handlers.ts)
is the only constructor that sets `forkMode: true`. It :

1. Allocates 1 token (not 2 — `register(session, [token1])`).
2. Builds the session with `soloMode: true, forkMode: true`, 2 player
   slots where slot 1 is reserved-but-never-connected (same as SOLO
   multiplex — see [lifecycle-helpers.ts](../../duel-server/src/lifecycle-helpers.ts)
   comment block).
3. Removes the worker's transient (replay-precompute-style) listeners
   and calls `attachWorkerHandlers(session)` — the canonical PvP/SOLO
   handler set. No `setupForkWorkerHandlers` parallel implementation
   remains.

### Front consumer changes

- `REPLAY_FORK_READY` payload : `{ token1 }` only (no `token2`).
- `replay-connection.service.ts forkTokens` signal :
  `{ token1: string } | null`.
- `replay-fork.service.ts navigateToForkDuel` : router state
  `{ wsToken1: tokens.token1 }` only.
- `duel-page.component.ts` fork branch : gate is `if (!wsToken1)`
  (the `wsToken2` validation guard is gone).
- `solo-mode-effects.service.ts initFork` : unchanged. Fork still
  legitimately skips the `initSolo` player-persistence + rematch-reset
  effects — those are SOLO UX features the fork explicitly doesn't
  want.

### Worker `forkMode` variable (not the same as `session.forkMode`)

[duel-worker.ts](../../duel-server/src/duel-worker.ts) has an internal
`forkMode: boolean` variable ([duel-worker.ts:1063](../../duel-server/src/duel-worker.ts#L1063)) set on `INIT_FORK`
that gates worker-side behavior : bypassing `capturedSetResponse` (for
deterministic replay reconstruction), skipping the `duelResult`
tracking (no replay capture), the `FORK_RESUME` handler.
These are LEGITIMATELY worker-internal concerns that do not collapse
into the SOLO multiplex path — they relate to how the worker bootstraps
on a replay's seek point, not how the server routes messages.
Audit 2026-06-11 #2 — `emitReplayData` is NO LONGER gated on
`!forkMode` at natural END : `WORKER_REPLAY_DATA` is what drives
`safeTerminateWorker` on the main side (the router's fork branch skips
the persist but terminates), so the gate leaked the fork worker thread
forever after a played-to-the-end fork.

The `session.forkMode` flag is the SERVER-side concern (which routing
skips to apply) ; the worker's `forkMode` variable is the WORKER-side
concern (how to bootstrap + handle responses). They share a name but
have different scopes.
