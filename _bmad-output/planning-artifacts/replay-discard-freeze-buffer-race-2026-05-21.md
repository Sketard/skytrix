# Bug — Replay freeze on discard during chain resolution (buffer-drain race)

**Discovered:** 2026-05-21
**Status:** OPEN — documented, not yet fixed
**Severity:** High — replay becomes permanently frozen
**Scope:** Replay mode ONLY. Confirmed NOT reproducible in live PvP.

## Repro

- Replay `68a50639-40cb-43d3-9e2e-a8510236e96b`, perspective **1**, `?seekTo=2`.
- Harness spec: `front/e2e/debug-discard-freeze.spec.ts`
  (`npx playwright test e2e/debug-discard-freeze.spec.ts`).
- A `MSG_MOVE` discard (`reason=0x4040`, HAND→GRAVE) plays during a chain
  resolution. ~7.5s later the replay freezes.

## NOT caused by the 2026-05-21 seven-bug batch

Verified by `git stash`-ing all seven bug fixes and re-running the harness
against the baseline: the freeze reproduces identically (`Lock safety
timeout`, `POLL-DROP REGRESSION`, ×7). Pre-existing bug.

## Symptom chain

```
[ANIM-TRACE] directive { kind: group, count: 1 }      ← discard MSG_MOVE
[ANIM-TRACE] groupEvent { type: MSG_MOVE, result: Promise }
[ANIM-TRACE] groupDone
[ANIM-TRACE] directive { kind: barrier }
[ANIM-TRACE] directive { kind: batch-end }
[ANIM-TRACE] directive { kind: await-signal, resolved: false }
[ANIM-TRACE] postFinalize { action: rescued-stall, queueLen: 1 }
[ANIM-TRACE] queueEmpty { action: finalize }
[ANIM-TRACE] commitUnlocked { site: finalizeAndCommit }   ← locks=[GY-1] still held
[ANIM:CHAIN] Buffering MSG_MOVE card=20508881 reason=1024  ← arrives AFTER batch-end
[ANIM:CHAIN] onChainLinkResolved DONE — signaling ready
... 7.5s ...
Error: lockZone: Lock safety timeout for GY-1
... 10s ...
[POLL-DROP REGRESSION] chain stuck ... queueLen=0 hasBufferedEvents=true
```

## Root cause (hypothesis)

A **race between the chain buffer drain and a late-arriving event.**

1. During `chainPhase === 'resolving'`, BOARD_CHANGING events are buffered
   (`ChainResolutionManager._bufferedBoardEvents`).
2. `replayBuffer()` drains the buffer, `BufferReplayBuilder.build()` produces
   a batch (`group | barrier | batch-end | await-signal`), the orchestrator
   prepends it and runs it.
3. **After** the batch has been built AND consumed, one more
   `MSG_MOVE` (`card=20508881 reason=1024`) arrives and hits
   `bufferIfResolving()` → it is appended to `_bufferedBoardEvents`.
4. No second `replayBuffer()` is triggered — the chain is already finalizing.
   The late event is stranded in the buffer forever:
   `hasBufferedEvents=true`, `chainPhase` stuck at `resolving`.
5. The stranded event's pre-lock (`GY-1`, posted by `preLockQueuedSources`)
   is never consumed/released → `lockZone` safety timeout (7.5s) → then the
   `POLL-DROP REGRESSION` watchdog fires (10s).

## Investigation pointers (for the fix)

- `ChainResolutionManager` — buffer ownership, `drainBuffer()`,
  `_bufferedBoardEvents`.
- `AnimationOrchestratorService.replayBuffer()` — when is it (re)triggered?
  Does anything re-check the buffer after `batch-end` / `onChainLinkResolved`?
- `bufferIfResolving()` — accepts events even after the batch was built; the
  drain needs to either (a) re-run when the buffer grows post-drain, or
  (b) the `await-signal` / `batch-end` must re-check `hasBufferedEvents`
  before finalizing.
- The `MSG_DRAW`-in-a-group `[GROUP] barrier MUST follow` warning fires in
  the same window — likely a related symptom of the same batch/timing
  mismatch, worth checking together.
- Watchdog markers: `POLL-DROP REGRESSION` (console.error string),
  `POLL-DROP-REGRESSION` (duelAssert site tag). See CLAUDE.md
  "Polling Removal — Regression Surface".

## Why live PvP is unaffected

In live PvP the events stream in over the WS at duel pace; the buffer drain
and the event arrival do not race the same way. The replay precompute
delivers buffered events in tight bursts, exposing the post-drain late
arrival.
