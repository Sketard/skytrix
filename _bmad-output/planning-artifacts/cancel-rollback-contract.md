# Cancel Rollback Contract — P0-3bis

**Status:** living document (update on every state-slot addition)
**Last updated:** 2026-05-08
**Owner:** anyone touching the cancel feature
**Related stories:** [P0-3bis-POC.1](../implementation-artifacts/p0-3bis-poc-1-wasm-snapshot-pvp-worker.md), [.2](../implementation-artifacts/p0-3bis-2-worker-snapshot-wrapper.md), [.3](../implementation-artifacts/p0-3bis-3-cancel-prompt-sequence.md), [.4](../implementation-artifacts/p0-3bis-4-cancel-lifecycle-gating.md), [.5](../implementation-artifacts/p0-3bis-5-multi-duel-stress.md)

## Why this document exists

The cancel feature (right-click on a continuation prompt → rollback to the
previous SELECT_IDLECMD/SELECT_BATTLECMD) is correct only if **every piece
of state that diverged between the commit and the cancel is reset**.

State lives on **three surfaces**: the worker, the server, and the client.
Each surface has its own slots that must be tracked. The mechanism to
reset each slot is also surface-specific (WASM snapshot restore, in-place
mutation, message-driven cascade). This document is the single inventory.

**Add a row whenever you add a new mutable state slot that:**
- Is set or modified between an IDLECMD/BATTLECMD `PLAYER_RESPONSE` and the
  next IDLECMD/BATTLECMD prompt
- Could affect a subsequent IDLECMD/BATTLECMD if not reset

If a slot belongs there and isn't, the cancel feature has a latent bug.

## How a cancel flows (summary)

```
Client right-click on continuation prompt (SELECT_PLACE / TRIBUTE / POSITION / ...)
  ↓
WS: { type: 'CANCEL_PROMPT_SEQUENCE' }
  ↓
Server case 'CANCEL_PROMPT_SEQUENCE'
  ├─ Phase guard: must be DUELING
  ├─ Rate-limit (1s / player)
  ├─ awaitingResponse[player] required
  ├─ worker exists + duel not ended
  └─ forward to worker: { type: 'CANCEL_PROMPT_SEQUENCE', playerIndex }
  ↓
Worker handler
  ├─ tryCancelRollback(snap, playerIndex, chainResolving)
  │     ├─ no-snapshot → WARN, no-op
  │     ├─ wrong-player → WARN, no-op
  │     └─ chain-resolving → WARN, no-op (snapshot kept)
  ├─ restoreWorkerSnapshot(snap)   ← restores WASM + 5 module slots
  ├─ setLastIdleSnapshot(null)     ← clears the snapshot + TTL timer
  ├─ duelProcess() once to drain the post-restore RETRY message
  ├─ post BOARD_STATE
  └─ post WORKER_CANCEL_DONE
  ↓
Server case 'WORKER_CANCEL_DONE'
  ├─ STATE_SYNC (last board state) → triggers client reset
  ├─ CHAIN_STATE empty → clears chain overlay client-side
  ├─ Reset server-side bookkeeping (chain, hint, invalidResponseCount, ...)
  ├─ Restore lastSentPrompt + awaitingResponse
  └─ Re-broadcast cached IDLECMD/BATTLECMD prompt
  ↓
Client case 'STATE_SYNC' → processor.reset() + commitAll() + clear prompt/hint
Client case 'CHAIN_STATE' [] → clear chain links + badges
Client case 'SELECT_IDLECMD' / 'SELECT_BATTLECMD' → action menu reopens
```

## State inventory

### Surface 1 — Worker (`duel-server/src/duel-worker.ts`)

| Slot | Reset mechanism | Notes |
|---|---|---|
| ocgcore WASM linear memory | `restoreWorkerSnapshot` → `restoreSnapshot(snap.wasm)` | The whole 16 MB blob. Heart of the rollback. |
| `turnPlayer` | `restoreWorkerSnapshot` via accessor | UI mirror — diverges if turn changes mid-flow |
| `turnCount` | `restoreWorkerSnapshot` via accessor | Idem |
| `phase` | `restoreWorkerSnapshot` via accessor | Idem |
| `lp` | `restoreWorkerSnapshot` via accessor | Set per-player as `[number, number]` |
| `lastResponsePlayerIndex` | `restoreWorkerSnapshot` via accessor | Tracked for WORKER_RETRY |
| `lastAnnounceNumberOptions` | `restoreWorkerSnapshot` via accessor | Set on MSG_ANNOUNCE_NUMBER, used by next prompt |
| `capturedResponses.length` | `restoreWorkerSnapshot` truncates in-place | Cancelled response NOT persisted to replay |
| `lastIdleSnapshot` | `setLastIdleSnapshot(null)` after restore | Clears the rollback target itself |
| `lastIdleSnapshotTimer` | `setLastIdleSnapshot` clearTimeout | TTL timer reaped |
| `chainResolving` (module-level) | Hoisted out of `runDuelLoop`; cancel handler reads it for the interlock; reset to `false` at top of each `runDuelLoop` | Used by `tryCancelRollback` |
| `forkMode` | Defensive reset in `cleanup()` | Pre-existing bug; surfaced by P0-3bis gating |

### Surface 2 — Server (`duel-server/src/server.ts`, case `'WORKER_CANCEL_DONE'`)

| Slot | Reset mechanism | Notes |
|---|---|---|
| `cancelTargetPrompt[p]` | Set at PLAYER_RESPONSE for IDLECMD/BATTLECMD; cleared after use in WORKER_CANCEL_DONE; cleared on next IDLECMD/BATTLECMD broadcast | The IDLECMD prompt to re-emit |
| `lastSentPrompt[p]` | Replaced with `cancelTargetPrompt[p]` at WORKER_CANCEL_DONE | So reconnect-resync sees the rolled-back prompt |
| `lastSentHint[p]` | Set to `null` at WORKER_CANCEL_DONE | Hint of the cancelled effect would otherwise replay on resync |
| `awaitingResponse[p]` | Set to `true` (re-broadcast prompt re-opens window) | |
| `activeChainLinks` | Set to `[]` at WORKER_CANCEL_DONE | Chain reset; client mirror via empty CHAIN_STATE |
| `chainPhase` | Set to `'idle'` at WORKER_CANCEL_DONE | Idem |
| `negatedChainIndices` | `.clear()` at WORKER_CANCEL_DONE | Idem |
| `invalidResponseCount[p]` | Set to `0` at WORKER_CANCEL_DONE | Cancel must not stack toward MAX_INVALID_RESPONSES |
| `lastCancelAt[p]` | Set to `Date.now()` at handler entry | Drives the rate-limit |

### Surface 3 — Client (`front/src/app/pages/pvp/duel-page/duel-connection.ts`, case `'STATE_SYNC'`)

The cancel reuses the existing `STATE_SYNC` handler (reconnection re-sync).
Every reset listed here MUST live in that case so reconnection ALSO benefits.

| Slot | Reset mechanism | Notes |
|---|---|---|
| `_pendingPrompt` | `set(null)` | Stale prompt cleared; new one arrives next |
| `_hintContext` | reset to neutral | Same reason |
| `_lastConfirmedCards` | `[]` | MSG_CONFIRM_CARDS reveals from cancelled flow |
| `_lastSelectedCards` | `[]` | Selection accumulator across same-type prompts |
| `_lastSelectedPromptType` | `null` | Companion to `_lastSelectedCards` |
| `_hintCardConsumed` | `false` | Bleed-protection flag — re-enable hint merging |
| `_rematchStarting` | `set(false)` | Rematch UI |
| `_justReconnected` | `set(true)` | Suppresses auto-respond on the next prompt |
| `processor` (state machine) | `reset()` clears chainLinks, animation queue, replay buffer, banners | Single call covers many sub-slots |
| `rbs` (rendered board state) | `commitAll()` after `updateLogical(message.data)` | Re-syncs all zones to the snapshot |

The `CHAIN_STATE` case (with empty `links`) hits `processor.restoreChainState([], 'idle')`
to clear the chain badges + overlay. Implicitly part of the cancel flow even though it's
a separate message case.

## Decision: phases are NOT cancellable

Battle Phase / End Turn / Main Phase 2 transitions are **intentionally
non-rollback-able**, see [duel-worker.ts](../../duel-server/src/duel-worker.ts)
around the `setLastIdleSnapshot(null)` call inside `runDuelLoop`. If product
ever wants to add "Are you sure?" prompts on these, the right pattern is a
client-side confirm step, NOT a server-side snapshot rollback. See the
inline comment for the YGO-rules / fairness justification.

## Procedure: how to add a new state slot

**Rule of thumb:** if the slot is mutated between a SELECT_IDLECMD/BATTLECMD
response and the next IDLECMD/BATTLECMD prompt, it must be reset on cancel.

1. Identify the surface (worker / server / client).

2. Worker:
   - If part of `WorkerStateAccessors`: extend `WorkerSnapshot`, add the
     accessor in `wasm-snapshot-wrapper.ts`, wire it through `duel-worker.ts`.
     `restoreWorkerSnapshotImpl` will handle it automatically.
   - If module-local but not in `WorkerSnapshot`: ask whether it belongs in
     the snapshot (probably yes). Don't add ad-hoc reset paths.

3. Server:
   - Add the reset in the `case 'WORKER_CANCEL_DONE'` block in `server.ts`.
   - Add the reset in `cleanup` paths if it should also clear on duel end.
   - Add the slot to the `ActiveDuelSession` interface.
   - Add three init sites: factory + rematch reset + replay/fork session.

4. Client:
   - If reachable from `DuelConnection`: extend the `case 'STATE_SYNC'`
     handler in `duel-connection.ts`. Reuses the reconnection path —
     no need for a dedicated cancel case.
   - If state lives in a separate Angular service: add a method that the
     orchestrator's `onStateSync` callback calls. The orchestrator's
     `resetAllState` already does this for the animation pipeline.

5. Add a row to this document, mentioning the slot, the reset mechanism,
   and the reason it diverges.

6. If feasible, write a test in
   `duel-server/src/duel-worker-cancel-lifecycle.spec.ts` (worker side)
   or extend the existing `duel-worker-cancel.spec.ts` covering the rollback
   semantics.

## Diagnostic checklist when cancel "doesn't fully work"

Symptom: client UI keeps stale state after cancel.
1. Open the browser console. Confirm `[pvp-prompt-dialog] contextmenu fired`
   appears.
2. Open the duel-server log. Look for the `CANCEL_PROMPT_SEQUENCE forwarded
   to worker` and `[duel-worker] cancel applied` lines.
3. Compare the actual sent messages to the inventory above. The missing
   reset is the unfiltered slot.

Symptom: cancel doesn't fire at all.
1. Console log absent → `@HostListener('document:contextmenu')` isn't
   attached. Check `dialogState !== 'open'` short-circuit, replay mode,
   or a parent component's `stopImmediatePropagation`.
2. Server logs absent → WS message not sent. Check
   `wsService.sendCancelPromptSequence()` is reached and the WS connection
   is open.
3. Server logs say `rate-limited` / `non-DUELING phase` / `not awaiting
   response` → guard rejected. Diagnostic: which guard fires tells you
   what state the server thinks it's in.

Symptom: server applies cancel but client diverges.
1. The 3-message cascade (STATE_SYNC + empty CHAIN_STATE + cached prompt)
   may have a missing piece. Compare server logs against client receipt
   in the network panel.
