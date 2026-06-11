# Post-merge Audit — Animation/Transport Pipeline v4 (2026-06-11)

Full audit of the merged v4 unification (HEAD `bae6aa0e`) across three axes:
**code quality**, **event/animation robustness**, **cross-mode parity**
(PvP normal / SOLO multiplex / fork-solo / replay). Method: 6 parallel audit
agents (2 quality, 2 robustness, 2 parity), every finding verified by reading
the cited code; the two top findings were re-verified independently by the
coordinator. Findings cross-confirmed by ≥2 independent agents are marked ✔✔.

---

## Executive summary

The v4 architecture is **structurally sound**: the `AnimationDataSource`
contract genuinely carries both modes, `MockDuelConnection` is a disciplined
readonly mirror of `DuelConnection`, server chain machinery
(`applyChainTransition` / `ChainSnapshotTracker`) is shared rather than
duplicated, and the lock/reset/abort defense-in-depth on the front is layered
and pinned by specs. `check-ws-protocol-sync.mjs` passes (9 paired files).

Three problem clusters dominate:

1. **One front P0 regression** — `_isReplayingBuffer` is a one-way latch
   (set `true`, never reset) that permanently disables chain buffering and
   the pre-activation divert after the first inline buffer drain. ✔✔
2. **Fork-solo end-of-life is broken** — natural END leaks the worker thread
   AND the session forever; every fork end leaks the session; cancel-rollback
   is rejected by the worker despite three docs claiming it works; the
   Rematch button is shown enabled and silently does nothing. The doctrine
   "forkMode gates exactly 3 skips" is false (6 runtime gates found). ✔✔
3. **The Phase 5/6 retirement was not finished** — ~20 live comments still
   reference `ReplayDuelAdapter` / `PreComputedState` (including the central
   `AnimationDataSource` contract docblock and the written justifications for
   `_innerLoopDepth`), dead mechanisms remain (replay stagger timeouts,
   `REPLAY_LOAD`, `resetQueue`), and TEMP `console.warn` traces from the
   2026-06-05 "main vide" investigation ship in prod hot paths. ✔✔

Parity verdict: **PvP↔Replay parity is genuinely strong** (scorecard: 5×
OK/OK-with-notes, 1 GAP on game-log rebuild at perspective 1). **Live-mode
parity holds for the duel itself but breaks at the edges** (fork end-of-life,
SOLO tab-close).

---

## Consolidated priority list

> **VERIFICATION STATUS (second pass, 2026-06-11)** : every finding below went
> through an adversarial verification pass (5 verifier agents instructed to
> REFUTE each claim by hunting compensating mechanisms). **None refuted —
> 17/22 CONFIRMED as stated, 5 NUANCED with severity adjusted** (#7→P2
> pre-existing, #8→P2 bounded, #15→P2 known-pending, #19→P2 no drift today,
> #22→P2 cosmetic; #4 slot-1 sub-case self-heals). See the
> "Adversarial verification verdicts" section below the table for per-finding
> detail, compensators found, and two AGGRAVATING discoveries.

| # | Sev | Finding | Where | Confirmed by |
|---|-----|---------|-------|--------------|
| 1 | **P0** | `_isReplayingBuffer` one-way latch — chain buffering + pre-activation divert dead after first inline drain | `animation-orchestrator.service.ts:197,784,1385,1623` | quality-front + robustness-front (git archaeology: reset dropped in BufferReplayBuilder refactor) + coordinator grep |
| 2 | **P0** | Fork-solo natural END leaks worker thread + session forever (`!forkMode` gates `emitReplayData` → `WORKER_REPLAY_DATA` never sent → `safeTerminateWorker` unreachable; no rematch timer; SOLO close early-return) | `duel-worker.ts:832-836`, `duel-end-coordinator.ts:145`, `pvp-connection-handler.ts:627` | server-robustness + parity-live + coordinator read |
| 3 | **P1** | Every fork-solo end (any reason) leaks the `ActiveDuelSession` (no rematch timer, no close-path cleanup, no grace period for soloMode) | same sites as #2 | server-robustness + parity-live |
| 4 | **P1** | SOLO tab-close with slot-0 prompt pending: session + WAITING worker leak with no deadline (close handler clears the only inactivity timer then early-returns) | `pvp-connection-handler.ts:600-612` | server-robustness + parity-live |
| 5 | **P1** | Fork cancel-rollback contradiction: snapshots taken (cost paid) but `CANCEL_PROMPT_SEQUENCE` hard-rejected in fork; docs claim inheritance | `duel-worker.ts:1229-1236` vs `:1256-1258`, `:819` | quality-server + parity-live |
| 6 | **P1** | Replay perspective-1 double-swap: `_maybeSwapBoardStateAfter` mutates the persistent `_messages[]` buffer in place → re-dispatch after backward seek swaps an already-swapped `boardStateAfter` | `mock-duel-connection.ts:225-231` (PvP justification at `duel-connection.ts:647-652` doesn't transfer) | parity-replay |
| 7 | **P1** | Game-log rebuild at perspective 1 feeds ABSOLUTE `boardStateSnapshot` to a builder whose O5/C2 contract requires viewer-relative boards (LP separators swapped after any seek/flip) | `duel-game-log.service.ts:49-53,297-306` vs `game-log-builder.ts:421-424` | parity-replay |
| 8 | **P1** | `replayBuffer` safety timeout calls `endDrain()` only — leaks session HAND locks + inflated `handExpansionSlots` exactly when the batch stalls | `animation-orchestrator.service.ts:792-797` (normal path: `cleanup()` = release + endDrain at `:775`) | robustness-front |
| 9 | **P1** | Fork end overlay shows an ENABLED Rematch button; server silently drops the request (no feedback) | `duel-page.component.html:503-514`, `client-message-router.ts:220-225` | parity-live |
| 10 | **P1** | `replayWorkerCount` double-decrement in fork-warning flows (same worker counted in `conn.worker` AND `pendingForkWorkers`) → permanent pool-cap erosion, can go negative | `replay-handlers.ts:486-490,616-628,634-663` | server-robustness |
| 11 | **P1** | Worker-side `duelProcess` watchdog is dead code (sync WASM blocks the timer); live duels have NO main-process liveness kill — a hung script = 100%-CPU thread leaked until restart (`cleanupDuelSession` doesn't terminate the worker) | `duel-worker.ts:665-672,717-726`, `session-orchestrator.ts:105-170` | server-robustness |
| 12 | **P1** | H17 60s connection-timeout only checks `isFullyDisconnected` — a SOLO F5 refresh spanning T+60s kills a live duel mid-game | `server.ts:545-553` | server-robustness |
| 13 | **P1** | ANIMATIONS_READY gate has no server deadline: connected-but-never-ready clients wedge sessions with zero timers (incl. fork post-watchdog and SOLO post-rematch holes) | `lifecycle-helpers.ts:32-40`, `server.ts:346-390`, `fork-handlers.ts:103-109` | server-robustness |
| 14 | **P1** | WORKER_RETRY re-sends cached prompt bypassing timer re-arm → post-engine-reject the duel has no timer pressure (PvP stall vector; SOLO loses anti-leak protection); silent no-op if cache empty | `worker-message-router.ts:160-190` vs `:310-358` | server-robustness |
| 15 | **P1** | No abort check inside `group`/`announcement` directives — post-`requestStop` they keep locking a board that `dropOrphanedLocks` just vacated (v3 "Phase 2 AbortSignal propagation" never landed; instrumentation `_postRequestStopLockCount` already ships) | `animation-orchestrator.service.ts:1454-1501,1591-1602`, `queue-runner.ts:566,616` | robustness-front |
| 16 | **P1** | Fork Escape→`returnToReplay()` abandons the duel without SURRENDER → funnels every canonical fork exit into the slot-0 close leak (#4) | `duel-page.component.ts:942-948,1133-1138` | parity-live |
| 17 | **P1** | TEMP diagnostic `console.warn` traces ship in prod hot paths (per-event `commitUnlocked`, per-draw `dumpHand` ×3 deferred timers) — dated 2026-06-05, investigation closed | `draw-sequence-manager.ts:272-313,477-485,502-504`, `rendered-board-state.service.ts:151-159,373-387,425-431,479-485` | quality-front + robustness-front |
| 18 | **P1** | ~20 stale `ReplayDuelAdapter`/`PreComputedState` references on load-bearing docs: `AnimationDataSource` contract docblock names the deleted second impl; `_innerLoopDepth`/F13 rationales describe a retired call chain; `liveChainTracker` field doc says the exact thing Option O removed (re-adding the reset would reintroduce the bug) | `animation-data-source.ts:71,89-91,144`; `queue-runner.ts:287-292,446,528-530,650`; `duel-worker.ts:181-184`; +15 sites listed in detail below | quality-front + quality-server + parity-replay |
| 19 | **P1** | SELECT/GAME-EVENT message-type sets hand-synced ×4+ (DuelConnection, MockDuelConnection — "kept in sync by inspection", worker-message-router, replay-precompute) in a repo that owns a byte-sync tool | `duel-connection.ts:1091-1135`, `mock-duel-connection.ts:612-638`, `worker-message-router.ts:66-84`, `replay-precompute.ts:81-88` | quality-server |
| 20 | **P1** | Dead mechanism: replay stagger timeouts — `addReplayTimeout` has zero prod callers → `hasActiveReplayTimeouts` always false → the documented "Replay stagger guard" (CLAUDE.md Chain rule 4) is dead code | `chain-resolution-manager.ts:261-269,104`, `draw-sequence-manager.ts:682` | quality-front |
| 21 | **P1** | `runReplayPreComputation` god function (370 LOC, nesting 5-6, F9-bis timing invariant scattered across 5 call sites in one if/else ladder) + `recordNavEntry` 8 positional params | `replay-precompute.ts:448-820,307-315` | quality-server |
| 22 | **P1** | `ReplayErrorMsg.code` typed required but emitted without it ×6 (untyped `safeSend` payloads); front compensates with `?? msg.message` | `ws-protocol-replay.ts:80-84`, `replay-handlers.ts:296,389,397,410-420,467` | quality-server |

---

## Adversarial verification verdicts (second pass, 2026-06-11)

Method: 5 verifier agents, each instructed to refute its batch by tracing the
full trigger chain and hunting compensating mechanisms (resets elsewhere,
guards upstream, sweepers, Spring-side reconciliation, timers, specs pinning
the behavior as intentional). Verdicts per finding:

### Confirmed as stated (P0/P1 stand)

- **#1 `_isReplayingBuffer` (P0)** — no reset anywhere (5 occurrences total);
  inline path reachable in normal play (`decideNextStep` branch 4a →
  `replayBuffer(true)`); `_drainingBuffer` makes the flag redundant DURING
  drains so the stuck-true state is pure regression (git: reset existed in
  `52d1d7af`, dropped in the BufferReplayBuilder/beginDrain-endDrain refactor).
  After the latch: `bufferIfResolving` is never even CALLED again (1623
  short-circuit) → all later chains animate under the overlay; rematch initial
  draws swallowed by `processDrawEvent`'s guard. Bonus inconsistency found:
  `_dispatchEvent`'s pre-lock-release skip (`:1418`) keys on
  `shouldBufferDuringChain`, not actual buffering → bounded pre-lock leak
  until `MSG_CHAIN_END`. No spec pins the latch.
- **#2 fork natural END leak (P0)** — ALL candidate compensators refuted one
  by one: worker `cleanup()` does NOT `process.exit` (the `port.on('message')`
  listener pins the event loop → `worker.on('exit')` never fires); every
  `safeTerminateWorker`/`terminate` caller enumerated, none reachable post
  natural END; no sweeper exists (`disconnectedAt` written, never read);
  Spring's `RoomCleanupScheduler` only flips Room status (never calls
  `terminateDuel`), and **fork sessions have no Spring Room at all** so
  `DELETE /api/duels/:id` can never target them. **AGGRAVATING DISCOVERY**:
  each leaked session inflates `activeDuelsSize`, which **blocks
  `/api/update-data` with 409 indefinitely** (`http-routes.ts:102-104`) and
  pollutes `/api/duels/active` (pinning Spring Rooms ACTIVE for SOLO leaks —
  the scheduler PROTECTS the leak).
- **#3 fork session leak on every end** — surrender/inactivity DO reap the
  worker (ungated `EMIT_REPLAY_DATA` handler, `duel-worker.ts:1195-1203`),
  but `cleanupDuelSession` is never called: no rematch timer, both close
  branches dead-end (`:612`, `:627`), worker `exit` handler returns on
  `endedAt !== null` (`worker-lifecycle.ts:84`).
- **#5 fork cancel contradiction** — 3 mutually inconsistent worker gates
  (`:1229` snapshot ungated / `:1256` cancel rejected / `:819` drop gated
  `!forkMode`); server forwards ungated (`client-message-router.ts:304-353`);
  front surfaces the affordance ungated (`pvp-prompt-dialog.component.ts:289`,
  `prompt-zone-highlight.component.ts:59`). Dead WASM-snapshot cost paid at
  every IDLECMD/BATTLECMD boundary.
- **#6 perspective-1 double-swap** — mutation is in-place on the persistent
  `_messages[]` (no swap marker); `seekToOffset` only moves the cursor (no
  re-clone from chunks); `swapBoardState` verified involutive → double-swap =
  ABSOLUTE data at perspective 1 during the resolving window, where Option N
  makes per-event snapshots the canonical logical source (no auto-correction
  until the post-chain BOARD_STATE). The 1→0 flip variant also confirmed. The
  spec PINS the in-place mutation (`mock-duel-connection.spec.ts:212-233`)
  without covering re-dispatch — fix must update it.
- **#9 fork Rematch button** — server fork branch = `logger.warn` + `break`,
  no message back, `rematchStarting` never flips; the front already has
  `forkReplayId` (used to branch Escape at `:945`) — gating was trivially
  possible.
- **#10 replayWorkerCount** — both sub-claims verified, no guard, no floor.
  **3rd variant found**: re-fork after CANCEL sees stale `conn.worker` →
  `hadWorker=true` → "reuses" an already-released slot → same net −1 skew.
- **#11 dead watchdog + no main-process kill** — `duelProcess` is fully sync
  (`OcgCoreSync` depromisified bindings; zero awaits between arm and clear).
  Narrow compensators exist (both-disconnect preservation timer, manual
  DELETE, graceful shutdown) — SOLO has none. Aggravating: the hang typically
  follows PLAYER_RESPONSE where the turn timer was just paused and inactivity
  cleared → even the forfeit chain may never fire.
- **#13 ANIMATIONS_READY no deadline** — (a) PvP wedge has a human escape
  (SURRENDER is not phase-gated); (b) **fork connected-but-silent is the worst
  sub-case**: `forkConnectionTimeout` one-shot fires as a no-op → session +
  idle fork worker (full reconstructed WASM state) leak permanently; (c) SOLO
  post-rematch tab-close leaks the session map entry (worker already
  terminated).
- **#14 WORKER_RETRY** — `pauseTurnTimer` has no deadline and no auto-resume;
  post-RETRY zero timer pressure. Partial compensator: `ACTIVITY_PING`
  re-arms inactivity for COOPERATING clients; silent client = unbounded
  stall. Single RETRY + AFK is unbounded (storms are bounded by
  `invalidResponseCount` forfeit).
- **#16 fork Escape exit** — session leaks in 100% of cases; worker leaks
  whenever the pending prompt targets slot 0 (slot-1 case: inactivity forfeit
  reaps the worker in ~5min, session still leaks via #3).
- **#17 TEMP traces** — all sites unconditional at HEAD; introduced
  `29f93da2` (2026-06-05), NOT gated by follow-up `f50bd6f1`;
  `commitUnlocked` warn fires per event, `updateLogical` runs 4 zone scans
  per call. (The keep-debug-logs memory covers duel-server only — confirm
  removal with Axel.)
- **#18 stale docs** — full list re-verified line by line. One entry dropped
  (`mock-duel-connection.ts:474-475` — not a retired-API ref; its MSG_HINT
  claim is still wrong, see D3). Two BONUS stale sites found:
  `validation/worker-message-validation.ts:11` (cites the retired
  `setupForkWorkerHandlers`) and the CLAUDE.md mode table itself ("Replay
  viewer → REPLAY_LOAD" — no handler dispatches on REPLAY_LOAD). F13
  assessment: the `_innerLoopDepth` guard currently protects against NO live
  sync path (`setAnimating` is a no-op on both impls; the `pushToStream`
  fan-out has no sync re-entrant consumer) — keep it as a canary, but the
  written rationale must be rewritten in v4 terms.
- **#20 dead stagger mechanism** — zero prod callers since the
  `35a19b00`/`89b761c4` era; gate always passes; removal mechanically safe
  including CLAUDE.md Chain rule 4.
- **#21 precompute god function** — metrics accepted (two independent agents,
  consistent numbers; not re-measured a third time).

### Nuanced (real, severity adjusted)

- **#4 SOLO tab-close → NUANCED** — the **slot-0-prompt case is confirmed**
  (only deadline just cleared; a new POST /api/duels does NOT dedup the old
  session; Spring reconciliation actually protects the leak). The
  **slot-1-prompt case self-heals**: its inactivity timer survives the close →
  warning → forfeit → rematch expiry → `cleanupDuelSession` (~10 min,
  autonomous) — a compensator the first pass underestimated.
- **#7 game-log rebuild → P2** — mechanism confirmed (turn-separator LP +
  `resolveBoardCard` for MSG_BECOME_TARGET resolve on the wrong side; journal
  becomes INCONSISTENT: live entries correct, rebuilt entries swapped, same
  panel). But impact is bounded to journal lines (no board corruption) and
  the bug is **PRE-EXISTING** (the legacy `REPLAY_BOARD_STATES` path fed the
  same absolute payload — not a v4 regression).
- **#8 safety-timeout lock leak → P2** — asymmetry real (one-line fix still
  wanted: call `cleanup()` not `endDrain()`), but the persistent leak is
  REFUTED: the per-lock safety auto-releases at ~3-6s
  (`LOCK_SAFETY_TIMEOUT_MS`=2000 × `safetyTimeout`) while the replayBuffer
  safety is ~15s — session HAND locks structurally cannot outlive it; a late
  batch-end is idempotent; reset paths run `dropOrphanedLocks`/`commitAll`.
  Residuals: duelAssert warn spam, HAND rendered stale until next commit,
  cosmetic slot inflation. **New hazard spotted in the same path**: the
  safety's premature `endDrain()` mid-batch re-enables re-buffering of the
  remaining group events.
- **#12 H17 → mechanism confirmed, plausibility nuanced** — one-shot timer;
  the kill needs the 1-5s F5 window to straddle exactly T+60s. **Double-edged
  (new)**: H17 is ALSO the only cleanup for SOLO abandoned pre-connect — the
  fix must keep that role (guard on `phase === 'WAITING_PLAYERS' &&
  startedAt === null`, do NOT simply clear on connect).
- **#15 directive abort → P2** — gap confirmed (untracked stagger setTimeout;
  no mid-directive abort; the announcement hang leaks one permanently
  suspended loop) but blast radius bounded: `requestStop` resets
  `_isProcessing`/depth so the hang does NOT block the next run; zombie locks
  bounded by `dropOrphanedLocks` + the 2s per-lock safety; the blocking
  announcement's `onClear` is a no-op today. And it is a KNOWN pending work
  item — the rbs `_postRequestStopLockCount` docblock explicitly drives
  "Phase 2 AbortSignal" with shipped instrumentation.
- **#19 type sets → P2** — diffed element-by-element: **NO drift today** (all
  four = the same 20 prompt types; the server's +2 are documented defensive
  extras; the mock's GAME_EVENT +2 are intentional). Valid maintenance debt,
  no live bug.
- **#22 ReplayErrorMsg.code → P2** — 6 code-less emissions confirmed
  individually (3 others DO carry code); root cause is `safeSend(ws,
  payload: unknown)` (`http-helpers.ts:28`); front fallback absorbs it (only
  `FORK_DIVERGENCE_WARNING` drives logic and is always set).

### P2 verdicts (second-tier findings)

- **MSG_HINT warn spam (replay)** ✅ CONFIRMED — `DuelLogger.warn` is
  unconditional; one warn per hint; the mock's justifying comment is wrong.
  Fix: stop forwarding MSG_HINT to the processor.
- **Last-entry auto-play stall** ✅ CONFIRMED — `nextIdx === computedUpTo` is
  covered by NEITHER F21 (`>`) nor F21-bis (`<`); at end-of-stream the end
  overlay masks the symptom (residuals: play button stuck on "pause",
  `setPlaybackPaused(false)` never corrected); mid-stream variant = real
  freeze but rare. The F21 specs do not pin the equal case.
- **Mock MSG_WIN skips `processor.reset()`** 🟡 NUANCED — bites only on
  win-mid-chain; most concrete consequence: the final synthetic BOARD_STATE
  is IGNORED (`syncAfterBoardState` tier 4 `resolving` → defer) + residual
  chain overlay behind the end overlay; cleaned at first seek. **A naive fix
  would break the final animations** (reset mid-pump wipes the queue) — the
  correct fix defers the reset to queue drain.
- **Dead-code list** ✅ ALL CONFIRMED zero prod callers: `addReplayTimeout`,
  `resetQueue`, `getTrackedLp` (wrapper AND underlying tracker method),
  `isAnnouncePending`, the `QueueStep`/`QueueDecisionInputs` re-export,
  `REPLAY_LOAD` (server never dispatches on it; sole sender is the game-log
  CLI whose send is silently ignored), `ReplayTransportConfig.promptMode` —
  **bonus: `ReplayTransportConfig.navIndex` is ALSO never read** (the service
  uses `mock.navIndex()`).
- **Doc-traps E2** ✅ ALL 3 CONFIRMED — (a) `liveChainTracker` field doc
  actively contradicts Option O (the reset is literally commented out at
  `:659` with rationale; the field doc never retracted "Reset at the top");
  (b) F13 rationale describes a dead chain (see #18); (c)
  `duel-end-coordinator.ts:142-144` documents a fork cleanup path
  (`startGracePeriod`) that is unreachable for soloMode (`:612`, `:627`; the
  third call site `:480` is gated on `bothDisconnected`, never set for solo).

---

## Axis 1 — Code quality

### Grades (front pipeline core)

| File | Grade | Dominant issue |
|---|---|---|
| animation-orchestrator.service.ts | C+ | P0 latch; orphan docblock; dead exports; `processDirective` 154 LOC |
| queue-runner.ts | B+ | stale retired-adapter rationales on load-bearing guards |
| duel-event-processor.ts | A- | dead `resetQueue`; stale adapter refs |
| chain-resolution-manager.ts | B | dead replay-timeout mechanism; duplicate `clearTimeouts`≡`clearReplayTimeouts` |
| draw-sequence-manager.ts | C | shipped TEMP traces; 3 god functions (127/149/160 LOC); DRY ×6 hand-slot mutation; magic durations |
| move-animation-router.ts | B | DRY ×6 travel-commit tails + 2 near-identical trios; unconditional debug computation in `buildMoveContext` |
| lp/battle/target trackers | A-/B+/A- | magic numbers; `8000` LP literal ×3 |
| buffer-replay-builder.ts | A- | hand-written `Set<string>` should be `ReadonlySet<GameEvent['type']>` |
| boundary/deferred processors + projections | A/A- | `RULES` name shadowing; DRY ×5 structural-cast guards across projections |

### Grades (transport + server)

| File | Grade | Dominant issue |
|---|---|---|
| duel-connection.ts | B | 1,961 LOC; slot-clear loop ×3; 2 contradicting stale comments |
| duel-web-socket.service.ts | B | stale replay header; inline `import()` type noise ×4 |
| solo-duel-orchestrator.service.ts | A | — |
| animation-data-source.ts | B | the one file where doc accuracy is load-bearing names a deleted impl |
| mock-duel-connection.ts | B | type sets "synced by inspection"; stale Phase 1/4/5 scope comments |
| replay-transport.service.ts | B- | F21/F21-bis spread the progress invariant across 3 methods + 4 comment blocks; `atEnd` boundary inconsistency for 1-entry streams |
| replay-connection.service.ts / replay-fork.service.ts | A/A | exemplary |
| replay-precompute.ts | C | god function; finalize sequence duplicated ×2; error-exit ×4 |
| replay-handlers.ts | C+ | 140-LOC entry fn; worker teardown idiom ×6 with variations; internally contradictory config docblock; unverified JWT decode undocumented |
| worker-message-router / client-message-router | B/B+ | `as any` cluster in SELECT logging |
| chain trackers, fork-handlers, session-orchestrator, lifecycle-helpers, duel-end-coordinator | A/A-/A | — |
| duel-worker.ts (audited sections) | B- | 2 doc-code contradictions hiding behavioral traps (#5, #18) |

### Notable P2 quality items

- `hasCostMoves` misnomer (flips on ANY MSG_MOVE) — rename `hasMovesSinceLastSolving` (`duel-worker.ts:733/769`).
- `REPLAY_LOAD` is a dead protocol type (no server handler; only the dev CLI sends it) — delete from both protocol files (`ws-protocol-replay.ts:29-32`).
- `processDirective` case bodies are functions in disguise (group 47 / lp 39 / announcement 42 LOC); group case duplicates `_dispatchEvent`'s commit-mode block.
- Stale-comment sweep targets (full list): `animation-data-source.ts:71,89-91,144`; `duel-web-socket.service.ts:39-41`; `duel-connection.ts:169-174,614-616,1210`; `duel-event-processor.ts:44,91,99,275`; `boundary-processor.ts:11,153`; `websocket-factory.service.ts:12`; `chain-state-restore.utils.ts:15,24`; `mock-duel-connection.ts:34-37,188-191,360-362,474-475`; `rendered-board-state.service.ts:351-356`; `queue-runner.ts:287-292,446,528-530,650`; `queue-runner-events.ts:6-8`; `duel-worker.ts:181-184,784-787`; `fork-handlers.ts:28`; `replay-handlers.ts:29,82-89`; `lifecycle-helpers.ts:102`; `deferred-effect-rules.ts:11`; `projections/flux-event.ts` (α.3 note); CLAUDE.md "exactly 3 skips" + Chain rule 4 + `REPLAY_PROMPT_DELAY_MS` "scaled" claim.
- DRY extraction candidates: `adjustHandSlots(relPlayer, delta)` (×6), `awaitTravel(p, dstLock, dstKey)` (×6), `awaitNextRender()` (×4), `lpParamsFromEvent(event)` (×3 across 2 files), `_clearSlotPromptFlow(opts)` (×3), `releaseWorker(conn, {releaseSlot})` (×6 server), `finishStream()`/`failStream()` (precompute), shared projection guards `isAnimationCompletedFor`/`isPhaseCompleted` (×5).
- `setSoloMode(boolean)` only ever called with `true`; `simulatePlayerResponse(_response)` ignores its payload; `getTrackedLp()`, `isAnnouncePending`, `resetQueue()`, `export type { QueueStep, QueueDecisionInputs }` are spec-only/dead.

---

## Axis 2 — Robustness

### Front (beyond consolidated #1, #8, #15, #17)

- **P2** `phaseWait` promise never resolves if its timer is cleared; docblock claims the opposite (`animation-orchestrator.service.ts:518-531` vs `:461-466`). Locks rescued by `dropOrphanedLocks`, but any future post-await cleanup would silently never run.
- **P2** `tokenDissolve` has no rejection handler — WAAPI cancel rejects `finished` → pre-locks neither committed nor released + unhandled rejection (`move-animation-router.ts:459-463`; every sibling branch handles it).
- **P2** Handler throw/rejection path: `_processAnimationQueueInner` has `try/finally` but no `catch`; a sync `processEvent` throw skips pre-lock release + `commitUnlocked` (`queue-runner.ts:487-545`, `animation-orchestrator.service.ts:1392-1441`). Resilience-by-rescue, not correctness.
- **P2** Replay parity: `WAITING_RESPONSE` is in `REPLAY_IGNORED_TYPES` so the mock never lets the processor commit `_pendingChainEntry` on it as PvP does (`mock-duel-connection.ts:651` vs `duel-event-processor.ts:186-188`) — transient chain-badge divergence.
- **P2** `pvp-deck-shuffle` CSS class left on the pile by any reset except a replay seek (`animation-orchestrator.service.ts:2030-2039` vs `:1313-1320`).
- **P2** `_eventStream` full-array-copy per push (O(n²) cumulative) + timer arrays never pruned on fire — bounded by duel length.
- **P2** `pause-external` waits have zero watchdog coverage (POLL-DROP only arms at finalize-during-resolving) — missing safety net, not a live bug.

### Server (beyond consolidated #2-4, #10-14)

- **P2** Module-level `liveChainTracker` never reset in `cleanup()`/`initDuel()` — latent for any future worker re-init with a mid-chain abort (`duel-worker.ts:196,1019-1055`). One-line fix in `cleanup()`.
- **P2** Replay precompute: `duelSetResponse` throw is OUTSIDE the try/catch (`replay-precompute.ts:776`) → uncaught worker exception → client waits the full 30s watchdog instead of an immediate REPLAY_ERROR.
- **P2** Nav index shipped whole in `WORKER_REPLAY_STREAM_INIT` (full board snapshot per entry, outside the 512KB chunk discipline) + split-path partition filter can defer trailing nav entries to emitInit.
- **P2** Queued replay/fork `startFn`s not cancelled on connection close — full precompute runs against a dead conn (`replay-handlers.ts:117-133`).
- **P2** `fork_warning` holds a live fork worker + pool slot with no deadline (open-but-idle client).
- **P2** Engine-crash path skips `emitReplayData` — no partial replay artifact for the exact crash you'd want to repro (`duel-worker.ts:716-725`).

### Verified-safe (do not re-dig — cross-checked)

Rematch mid-chain (worker terminated, fresh tracker); F9-bis precompute timing
rule implemented as documented; double ANIMATIONS_READY / double connect /
double WORKER_REPLAY_DATA idempotent; JSON.parse armored on every WS path;
token consumption atomic; F13 `_innerLoopDepth` 3-site invariant verified;
`FloatRegistryService.register` never rejects (removes a whole deadlock
class); per-lock safety timeouts + `assertNoLocks` at all 7 boundaries;
compile-time `Exclude<>`-based worker-message routing fence; boot invariant
for the 13 configurable modules.

---

## Axis 3 — Parity

### Live modes (PvP / SOLO / fork-solo)

The "fork-solo IS a SOLO multiplex" claim **holds for the duel itself**: all
~30 `session.soloMode` sites treat SOLO and fork identically (omniscient
filter, slot routing, chain tracking, CONFIRM tag, winReasonCode, game-log,
inactivity, reconnect/STATE_SYNC incl. FORK_RESUME re-post, ANIMATIONS_READY
3-way dispatch). It **breaks at end-of-life** (consolidated #2/3/9/16) and on
**cancel-rollback** (#5). The doctrine count is wrong: 6 runtime
`forkMode` gates exist, not 3 — the extra ones are REMATCH_REQUEST reject
(`client-message-router.ts:220`), cancel reject (`duel-worker.ts:1256`), and
idle-snapshot-drop skip (`duel-worker.ts:819`; must move in lock-step with
the cancel gate). CLAUDE.md + `fork-handlers.ts:25-39` +
`duel-end-coordinator.ts:142-144` (documents a nonexistent grace-timer
cleanup path) need a doctrine update.

### PvP ↔ Replay scorecard

| Contract | Verdict |
|---|---|
| `AnimationDataSource` completeness | OK-with-notes (doc drift only; `setAnimating` no-op on BOTH sides — justified) |
| Message handling (`_handleMessage` vs `dispatchNext`) | OK-with-notes (#6 double-swap; MSG_HINT warn spam; empty-cards auto-respond not mirrored) |
| Seek vs reconnect (shared `chainingMsgsToLinkStates` + `restoreChainState`) | OK-with-notes (confirmed-cards accumulator not restored on seek — the F7 asymmetry one field over) |
| Server precompute (`ChainSnapshotTracker`, F10 dual mechanism, F9-bis timing) | OK |
| Timing/gating (`overlayActive`, F21 + F21-bis) | OK-with-notes (residual dead-state: landing exactly on last entry with no-anim dispatch leaves `isPlaying=true` with no timer — cosmetic) |
| Game log | GAP (#7 absolute snapshots in rebuild at perspective 1) |
| `check-ws-protocol-sync.mjs` | PASS |

Replay-side P2s: MSG_HINT forwarded to processor → `enqueue: dropped
non-GameEvent` warn per hint (pollutes every debug-harness report;
`mock-duel-connection.ts:466-477`); empty-cards SELECT auto-respond pauses
1.2s where PvP renders nothing; `promptMode` is dead config in the transport
(never read; comment at `replay-page.component.ts:1011-1013` is false); mock
MSG_WIN skips `processor.reset()` (chain state non-idle at end of playback).

---

## Recommended fix waves

**Wave 1 — correctness (½ day)**
1. `_isReplayingBuffer`: reset in the inline batch-end resolve + defensively in `clearTimersAndPolling` (or delete the flag — `beginDrain/endDrain` covers the same guard).
2. `replayBuffer` safety timeout → call `cleanup()` not `endDrain()`.
3. `_maybeSwapBoardStateAfter` → swap on a clone (mirror `swapEventBoardStates`).
4. `navEntryToRebuildState` → swap `boardStateSnapshot` by current perspective.

**Wave 2 — fork/SOLO end-of-life (1 day)**
5. `safeTerminateWorker` inside `cleanupDuelSession` (idempotent, cheap defense — also closes the hung-worker tail).
6. Fork post-end cleanup: arm a short cleanup timer in `handleDuelEnd`'s fork branch; make the worker END path emit a terminal signal in fork.
7. Bounded orphaned-SOLO deadline armed on SOLO socket close (covers slot-0 hole + fork Escape exit).
8. Decide fork cancel semantics (inherit or re-gate snapshot + docs); hide fork Rematch button (show "Return to replay").
9. `replayWorkerCount`: null `conn.worker` when parking into `pendingForkWorkers`.
10. H17 timer: guard on `phase === 'WAITING_PLAYERS' && startedAt === null` —
    do NOT simply clear on connect: H17 is also the only cleanup for SOLO
    sessions abandoned pre-connect (verification pass discovery).

**Wave 3 — hygiene sweep (1 day)**
11. Delete TEMP traces (draw-sequence-manager + rendered-board-state).
12. Stale-comment sweep (list above) + CLAUDE.md doctrine updates (fork skips = 6; Chain rule 4 dead; REPLAY_PROMPT_DELAY_MS not scaled).
13. Delete dead mechanisms: replay stagger timeouts, `REPLAY_LOAD`, `resetQueue`, spec-only accessors.
14. Extract shared SELECT/GAME-EVENT type sets (front pair minimum; ideally into `ws-protocol-shared.ts` under the byte-sync).

**Wave 4 — structural (opportunistic, next touch)**
15. Decompose `runReplayPreComputation` + `replay-handlers.handleReplayConnection`; `recordNavEntry` options object.
16. AbortSignal propagation into `processDirective` (the planned v3 "Phase 2" — instrumentation already ships).
17. DRY extractions list (Axis 1); `ensureProgress()` consolidation in replay-transport.
