# Moteur de duel — perspective

**Lecture** : l'index de joueur absolu ou relatif, les clés de zone et le relativiseur ; texte de l'ancien `CLAUDE.md`,
déplacé tel quel (en anglais) le jour de l'adoption du plugin `workbench`. Index du moteur de duel :
[`README.md`](README.md). Se lit par sections : `Grep "^## "`, puis `Read` par plage.

## Sommaire

1. Perspective Convention (absolute vs relative player index)

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

### Relativizer routing discipline (F6, 2026-05-31)

Every absolute→relative conversion `abs === ownIdx ? 0 : 1` for DOM
zone-key building is now routed through `DuelContext.relativePlayer()`
where the call site has access to `DuelContext` (the conversion lives
in one place — change the semantics of "relative" once, every site
follows). Refactored sites :

- [target-indicator-manager.ts](../../front/src/app/pages/pvp/duel-page/target-indicator-manager.ts) — `spawnPileFloats` uses `this.ctx.relativePlayer(target.player)`.
- [duel-page.component.ts](../../front/src/app/pages/pvp/duel-page/duel-page.component.ts) — `onPreTargetCards` + `onZoneSelected` use `this.duelCtx.relativePlayer(c.player / pl.player)`.
- [pvp-board-container.component.ts](../../front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts) — `chainBadges` + `linkedZoneMap` go through a private `toRelativePlayer()` helper that injects `DuelContext` optionally and falls back to the input idiom in standalone preview specs.
- [replay-page.component.ts](../../front/src/app/pages/pvp/replay/replay-page.component.ts) — `replayHighlightedZones` + `replayChosenZone` use `this.duelCtx.relativePlayer(pl.player / place.player)`. Replay configures `duelCtx.ownPlayerIndex = () => perspectiveIndex()` so the helper is equivalent to the prior `=== perspectiveIndex() ? 0 : 1` inline.

**Sites intentionally left with the inline idiom** :

- [prompt-derivation.service.ts](../../front/src/app/pages/pvp/duel-page/prompt-derivation.service.ts) `highlightedZones` (1 site) — the service follows the two-phase init pattern (closures over signals, not DI), so it doesn't inject DuelContext. If a SECOND absolute→relative conversion ever lands in this service, add `relativePlayer: (abs) => 0 | 1` to `PromptDerivationConfig` and route through it instead of duplicating the idiom.
- Components with `ownPlayerIndex: input<Player>` that don't read `controller`/`player` fields from absolute payloads ([pvp-board-container](../../front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts) `playerLpAnim`/`opponentLpAnim`, [prompt-card-grid](../../front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts), [timeline-bar](../../front/src/app/pages/pvp/replay/timeline-bar/timeline-bar.component.ts)) — these run a boolean "is mine" test, not an absolute→relative conversion. Routing through `ctx.relativePlayer()` would be a no-op : the test is already absolute-vs-absolute.
- Pure utility functions taking `ownPlayerIndex` as a parameter ([chain-badge.utils.ts](../../front/src/app/pages/pvp/duel-page/chain-badge.utils.ts)) — by design absolute-agnostic, no ctx access.
- `mySide()` / "other side of mySide" computations in replay-page + topbar + mini-board-thumbnail — these compare with `userPseudo` (the LOGGED-IN user's position in the replay) or invert `mySide()`, NOT the viewer's perspective. Different semantic, not refactorable to `ctx.relativePlayer()`.
- `absoluteTurnPlayer` in pvp-board-container — inverse direction (relative→absolute), not the routing target.

**Enforcement** : there is currently no automated lint rule that flags
new `${zoneId}-${X}` builders where X is not provably relative. The
gate is review-time discipline + this checklist. If you add a new
relativizer, add it to the Known-correct list above and route through
`ctx.relativePlayer()` whenever possible.

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
`duel-page.component.ts:606` (R10 acted at γ §8 spec). PvP normal +
replay leave `perspectiveSource` at its default 0.

**Convention §5.2 POC — révisée γ-c c10 (2026-05-29).** Le switch SOLO
n'est PAS bloqué pour TOUS les prompts pending mais seulement pour les
prompts MODAUX (`SELECT_CARD`, `SELECT_CHAIN`, `SELECT_PLACE`,
`SELECT_TRIBUTE`, …). La whitelist `IDLE_PHASE_PROMPT_TYPES` dans
[solo-duel-orchestrator.service.ts](../../front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts)
autorise explicitement `SELECT_IDLECMD` (Main Phase 1/2) et
`SELECT_BATTLECMD` (Battle Phase) — ces prompts sont l'état stable
d'attente du joueur actif pendant TOUTE sa phase, donc les bloquer
revient à interdire le switch tout au long du tour. Bug user-facing
remonté 2026-05-29 : "je clique P1 et rien ne se passe alors que je
n'ai aucun prompt modal ouvert". Tests pinning : 4 cas dans
`phase-gamma-victory.spec.ts` (IDLECMD/BATTLECMD autorisés ;
CARD/CHAIN/PLACE bloqués).
