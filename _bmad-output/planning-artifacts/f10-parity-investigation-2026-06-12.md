# F10 / Parity investigation — wire-level objectivation (2026-06-12)

**Goal** : objectify the F10 divergence (intermediate post-cost board sync —
two mechanisms "equivalent by construction") with real wire data BEFORE
hoisting the sync into a shared helper, using the Phase 0 SOLO↔Replay parity
harness on fixture `18a55f97-7076-4716-9032-dcf88c9a86f4` (Radiant Typhoon
Vision discard chain).

**Method** : isolated dev-stack + `sync-db` ; parity harness
(`e2e/parity/event-stream-parity.spec.ts`, `--timeout=300000` — the
30s default kills the captures) ; live wire extracted from
`scripts/.dev-stack/duel.log` (`EMIT type=` debug lines of the
`from-replay` SOLO duel) ; replay wire captured server-side via the new
`duel-server/scripts/capture-replay-stream.mjs` (raw
`REPLAY_STREAM_CHUNK/INIT`, no browser).

Artifacts: `_bmad-output/debug-replay/parity-dump/` (normalized + raw event
streams, `*-server-stream.json` = full precompute wire + navIndex).

---

## Finding 1 — NEW BUG (blocks everything else) : auto-play nav-index
## inflation — one prompt burns one timeline index

**Severity : high, user-facing (replay viewer), v4 transport.**

`ReplayTransportService` resumes after every prompt auto-dismiss through
`maybeAdvance → scheduleNext → doStepForward`, and `doStepForward`
unconditionally increments `currentIndex` before dispatching. But a nav
entry can contain N prompts (`dispatchMockUntilIndex` yields at each
`pendingPrompt`) — so every prompt response consumes one nav index even
though the message cursor is still mid-entry. The index runs ahead of the
cursor by (cumulative prompt count − entry count).

On the fixture (7 nav entries, 6 prompts before chain resolution) the
reconstruction from the session console.log is exact :

| t | action | currentIndex | cursor |
|---|--------|--------------|--------|
| 6.5s | seek(0) baseline | 0 | 3 |
| 7.0s | step → SELECT_CHAIN (msg 6) yields | 2 | 7 |
| 8.2s | prompt answered → step → SELECT_PLACE (8) | 3 | 9 |
| 9.4s | answered → step → MOVE+BS+CHAINING, SELECT_OPTION (12) | 4 | 13 |
| 10.7s | answered → step → HINT+SELECT_CHAIN (14) | 5 | 15 |
| 11.9s | answered → step → SELECT_CHAIN (15) | **6** | 16 |
| 13.1s | answered → `scheduleNext` : `currentIndex(6) >= computedUpTo(6)` → **`isPlaying=false`, `pausedAtBoundary=true`** | 6 | 16 |

Result : playback freezes at message 16/36 — **MSG_CHAIN_SOLVING and the
whole chain resolution are never dispatched** — while the UI reports
end-of-replay (`currentIndex == computedUpTo`). The Play button is dead
(`startPlayback` early-returns on `currentIndex >= computedUpTo`) ; only a
backward seek recovers. `pausedAtBoundary` never resumes
(`computedUpTo` will not increase — the full stream already arrived).

Repro : any prompt-dense replay (i.e. most real duels). The F21/F21-bis
fixes (2026-06-07) cover the *boundary* stalls, not this index/cursor
desync — neither pins the "prompt mid-entry" case.

**Fix sketch** : `doStepForward` (or the prompt-resume path) must first
check whether the CURRENT entry's span is fully dispatched
(`mock.messageCursor() < nav[currentIndex()].messageOffset`) and resume
`dispatchMockUntilIndex(currentIndex())` WITHOUT incrementing ; only a
completed span advances the index. Spec to add : "a prompt inside a nav
entry does not advance currentIndex past the entry".

Side effect on the harness : `waitForNaturalEnd` saw `isPlaying=false &&
cur >= tot-1` and treated the freeze as a natural end → the parity capture
silently truncated (Replay 13 raw events vs SOLO 39). The June-5 baseline
(62 vs 36) predates the v4 transport — **the v4 mock playback path has
likely never passed this fixture end-to-end**.

---

## Finding 2 — F10 objectified : the doctrine describes only the
## same-batch case ; live and replay BOARD_STATE cadences are disjoint

Side-by-side of the two wires (full dumps in parity-dump/) :

- **Replay precompute (36 msgs)** : 7 synthetic BOARD_STATE, one per
  `flushNavEntry` — offsets 2, 3, **10 (after MOVE, BEFORE MSG_CHAINING —
  the F10 sync)**, 24 (before MSG_CHAIN_END), 26 (CHAIN_END separator),
  31, 34 (phase changes). Mid-chain prompts get NO preceding BOARD_STATE.
- **Live worker (40 emissions)** : 10 BOARD_STATE, every single one
  emitted right AFTER a prompt (`BOARD_STATE (final, before prompt)` at
  every `status=WAITING`). **ZERO intermediate BOARD_STATE** on this
  fixture : the `hasCostMoves` flag is local to one `duelProcess` batch,
  and the activation MOVE (batch N) is separated from MSG_CHAIN_SOLVING
  (batch N+3) by SELECT_OPTION/SELECT_CHAIN prompts — the predicate
  resets at each batch boundary and never fires.

Consequences for the F10 doctrine (CLAUDE.md "Intermediate post-cost board
sync") :

1. The documented PvP mechanism ("BOARD_STATE after MSG_CHAINING, before
   MSG_CHAIN_SOLVING when costs moved") only covers costs in the SAME
   batch as the SOLVING. Cross-batch costs — the common case, any cost
   paid through a prompt — get NO live intermediate sync. The client
   then relies on the per-prompt `BOARD_STATE (final, before prompt)`
   instead, which replay does NOT mirror.
2. The real cadence contract is therefore NOT "one intermediate sync
   before resolving" but two entirely different cadences :
   live = per-prompt, replay = per-nav-flush. They overlap only by
   accident. Any hoist of F10 into a shared helper must decide the
   canonical cadence first — aligning replay on the live per-prompt
   cadence (emit synthetic BOARD_STATE after each ingested SELECT_* in
   the precompute) is the smallest move that makes the streams
   wire-comparable, and subsumes the F10 special case entirely (the
   pre-SOLVING sync becomes redundant : a prompt always sits between the
   cost and the SOLVING in the cross-batch case, and the same-batch case
   keeps the existing `hasCostMoves` emission).
3. The client-side tier asymmetry documented in F10 (tier 3 vs tier 2)
   was confirmed observable but is downstream of the cadence question.

## Finding 3 — audit P2 "mock MSG_WIN skips processor.reset" confirmed
## in vivo

At the (premature) end of playback the residue is
`{queue: [], chainPhase: 'building', activeLinks: 1}` — captured by the
new diagnostic mode of `waitForQueueDrain` (dump-and-continue instead of
throw). With finding 1 fixed, a clean end-of-stream mid-chain will still
leave this residue ; the audit's "defer the reset to queue drain" fix
note stands.

## Collateral notes

- F9-bis intact : nav[3] carries its `chainSnapshot` (verified in the
  server stream dump).
- The `normalize-stream.ts` boundary-event filter justifies itself by the
  retired v3 `ReplayDuelAdapter.resetProcessorForTransition` behavior ;
  in today's truncated capture the v4 boundary emissions looked sane
  (single TurnStarted/PhaseStarted/ChainStarted). Re-evaluate lifting the
  filter once finding 1 is fixed and a full capture exists.
- Harness hygiene fixed/needed : per-test timeout (300s) must move into
  `playwright.config.ts` for the parity project (CLI flag today) ;
  `waitForQueueDrain` now dumps residue instead of throwing (shipped).

## Recommended order (revised)

1. **Fix finding 1** (transport index/cursor desync) — prerequisite for
   any parity gate AND a real replay UX bug.
2. Re-run the harness → first complete v4 capture → re-evaluate the
   boundary filter + divergence list on full streams.
3. THEN design the F10 hoist with the cadence decision above (per-prompt
   synthetic BOARD_STATE in precompute), validated by the harness diff.
