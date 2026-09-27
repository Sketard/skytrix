# Moteur de duel — transport

**Lecture** : les invariants du cycle de vie de `DuelConnection` et de l'amorçage ; texte de l'ancien `CLAUDE.md`,
déplacé tel quel (en anglais) le jour de l'adoption du plugin `workbench`. Index du moteur de duel :
[`README.md`](README.md).

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
false` with `_duelCtx` set) is harmless but pointless. The cleanup landed (F-2.3, post-c8) : `conn.soloMode` is now a
**getter derived from `soloModeSource`**
([duel-connection.ts:251-253](../../front/src/app/pages/pvp/duel-page/duel-connection.ts#L251-L253)),
passed in as a ctor option by `SoloDuelOrchestratorService`
([solo-duel-orchestrator.service.ts:159](../../front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts#L159)),
so the "pair flip" is structurally impossible to break — there is no
longer a `setSoloMode` writer on the conn. Anyone adding a third
SOLO-only field to `DuelConnection` SHOULD follow the same pattern
(ctor option backed by a wsService source signal) rather than a
mutable setter.
