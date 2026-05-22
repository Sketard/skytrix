# Game Log — Implementation Plan

> Implementation plan — 2026-05-22. Author: Winston (System Architect).
> Steady-state skytrix: a feature build plan, not a frozen BMad spec.
> Communication FR / document EN.
>
> **Companion documents — read first:**
> - `game-log-feed-chantier.md` — the UX spec (Sally). Scope of record.
> - `game-log-integration-analysis.md` v5 — the integration analysis.
>   Architecture of record. Every decision (O5–O11, R1–R12, the lots)
>   is justified there; this plan does not re-argue them, it executes
>   them.
>
> This document turns the analysis's 6 lots + the dev-hub addition into
> a **codable plan**: exact files, signatures, edit order, per-lot
> acceptance. It is the artefact a developer (or `bmad-dev-story`) picks
> up to start writing code.

---

## 0. How to read this plan

- **Lots run in the analysis's dependency order.** `0 → 1 (∥) → 2 →
  {3, 4→4g} → 5 → 6`. Lot 0 and Lot 1 are independent; Lot 1 may run in
  parallel.
- Each lot has: **goal**, **files** (new / modified, exact paths),
  **steps** (ordered edits), **acceptance** (what "done" means),
  **risks touched**.
- Signatures are given precisely. Where a name is a proposal it is
  marked *(proposed)* — the developer may rename, but the shape holds.
- **Nothing here contradicts the analysis.** If a conflict is found,
  the analysis wins and this plan is corrected.

**Global conventions** (from `CLAUDE.md`, non-negotiable):
- `clean-code` + `code-principles` on every file.
- Front: read `front/DESIGN-SYSTEM.md` before any markup. DS components,
  token colours, `@include icon-size`, no `::ng-deep`.
- ws-protocol sub-files are byte-synced front↔back — any edit runs
  `scripts/check-ws-protocol-sync.mjs` (duel-server `prebuild`).
- Animation timing magic numbers → `animation-constants.ts` only.
- New component under `components/` → register in `DESIGN-SYSTEM.md`.

---

## Lot 0 — Builder hardening (prerequisite, no UI)

**Goal.** Make `GameLogBuilder` (a) correct under the O5 board contract,
(b) drivable event-by-event, (c) language-agnostic, and (d) physically
shared between front and duel-server. No UI, no service yet — this lot
only touches the pure brick and its harness.

**Why first.** Every consumer of the builder (the live service, the CLI,
the replay path) is incorrect until O5 lands (R1). The builder cannot be
shared until it is moved (0d). Lot 2 cannot start until both are done.

### 0a — O5 board-contract fix (R1)

The builder must treat its board snapshot as **relative-to-viewer** and
never swap it. See `game-log-integration-analysis.md` §4.3.

**Files modified:**
- `duel-server/src/game-log/game-log-builder.ts`
- `duel-server/src/game-log/game-log-builder.spec.ts`
- `duel-server/src/tools/game-log-builder-cli.ts`

**Steps — `game-log-builder.ts`:**

1. **`relLp()` → identity.** Current:
   ```ts
   private relLp(lp0: number, lp1: number): [number, number] {
     return this.perspective === 0 ? [lp0, lp1] : [lp1, lp0];
   }
   ```
   New: the board is already `[you, opp]`. Replace the two-arg swap with
   a direct read of the relative-ordered players. Simplest — drop
   `relLp` and inline `[board.players[0].lp, board.players[1].lp]` at the
   single call site (`syncTurnAndPhase`). The `perspective` field is no
   longer read by LP logic.

2. **`resolveBoardCard` — index by a relative player.** Current
   signature takes `absolute: Player` and does `board.players[absolute]`.
   The board is relative, so the index must be a *relative* player.
   Rename the param `relativePlayer: RelPlayer`; the body is unchanged
   (`board.players[relativePlayer]`).

3. **`onBecomeTarget` — relativise before the lookup.** It currently
   passes `c.player` (absolute, from `MSG_BECOME_TARGET.cards[]`)
   straight into `resolveBoardCard`. Wrap it: `this.rel(c.player)`.
   The `rel()` helper stays — it is the *event-field* relativiser,
   still correct (event player fields are absolute on both sides).

4. **Audit every other `resolveBoardCard` call** — grep the file.
   `onBecomeTarget` is the only caller today; confirm.

5. **Leave `rel()` untouched.** `rel(absolute)` relativises *event*
   player fields (`MSG_CHAINING.player`, `MSG_MOVE.player`/`toPlayer`,
   `MSG_DRAW.player`, attack/battle players). Those ARE absolute on both
   sides — `rel()` is correct. Only board-snapshot handling changes.

6. **`fieldCell(absolute, …)`** — it calls `this.rel(absolute)` on
   `toPlayer` (a `MSG_MOVE` event field, absolute). Correct, leave it.

**Steps — `game-log-builder.spec.ts` (the regression-sensitive part):**

7. **The fixture `board()` must produce a RELATIVE board.** Today
   `board(turnCount, phase, lp0, lp1)` builds `players: [player(lp0),
   player(lp1)]` in absolute P0/P1 order. Under C2 the builder expects
   `[you, opp]`. Two honest options — pick **(7a)**:
   - **(7a)** Rename the params `lpYou, lpOpp` and treat the fixture as
     already-relative. This matches what the live service feeds
     (`logicalState()`), so the spec tests the real contract.
   - (7b) Keep absolute fixtures and have the spec swap before
     `buildGameLog` — rejected: it re-introduces the absolute-board
     assumption the spec should no longer encode.

8. **Rewrite the test "Turn separator LP is swapped for perspective 1"**
   (currently lines 81-87). It asserts `buildGameLog({perspective:1})`
   *swaps* `[8000,3000] → [3000,8000]`. Under C2 the builder does NOT
   swap. New test intent: **"the builder never swaps the board — LP is
   passed through in the order given"**. Feed a relative board
   `[lpYou, lpOpp]`, assert `turn.lp` equals it verbatim, for BOTH
   `perspective: 0` and `perspective: 1` (the LP result is now
   perspective-independent — that IS the fix).

9. **Audit every other test for an absolute-board assumption.** Grep the
   spec for `board(` calls with non-default LP and for `perspective: 1`.
   The `MSG_BECOME_TARGET` resolution tests (if any feed a board with
   zone cards) need their player index re-checked: a target card placed
   in `players[1].zones` is now the *opponent's* card by relative index.
   Most tests use `perspective: 0` with symmetric boards — those are
   unaffected. Flag and fix each that is not.

10. **Add one new test — the perspective-1 board lookup.** Build a state
    whose board has a card in `players[1]` (opponent half), fire a
    `MSG_BECOME_TARGET` at it, with `perspective: 1`. Assert the target
    resolves to that card. This is the test that would have caught the
    latent prototype bug — it MUST exist.

**Steps — `game-log-builder-cli.ts`:**

11. **The CLI must swap the precompute board P0→viewer for
    `--perspective 1`.** `PreComputedState.boardState` is relative-to-P0
    (analysis §4.3, proven via `replay-precompute.ts:357`). Under C2 the
    builder no longer swaps, so the CLI must hand it a viewer-relative
    board. Add a swap helper mirroring `ReplayDuelAdapter.swapBoardState`:
    ```ts
    function toViewerRelative(
      bs: BoardStatePayload, perspective: 0 | 1,
    ): BoardStatePayload {
      if (perspective === 0) return bs;          // already P0-relative
      return { ...bs,
        turnPlayer: bs.turnPlayer === 0 ? 1 : 0,
        players: [bs.players[1], bs.players[0]] };
    }
    ```
    Apply it to each `state.boardState` before `buildGameLogWithStats`
    (map the states array). **This also fixes the prototype's latent
    perspective-1 bug** — a free correctness win.

12. **Regenerate `a8859c98.html` for BOTH perspectives** and eyeball.
    Perspective 0 must be unchanged (the C2 fix is a no-op there);
    perspective 1 must now be correct (it was silently wrong before).
    Keep the perspective-0 `a8859c98.html` as the §5.4 reference of
    record — confirm byte-stability.

**Acceptance 0a:**
- `npm test` (duel-server vitest) green, including the rewritten +
  new perspective tests.
- `npm run game-log -- --replayId a8859c98… --perspective 0` produces a
  visually-unchanged `.html` (the reference holds).
- `npm run game-log -- --replayId a8859c98… --perspective 1` produces a
  board-correct `.html` (was wrong before).

**Risks:** R1 (resolved here).

### 0b — Incremental builder API

Make `GameLogBuilder` drivable event-by-event so the live service can
feed it without fabricating a `PreComputedState`. Analysis §1.2 (option A).

**File modified:** `duel-server/src/game-log/game-log-builder.ts`

**Steps:**

1. **Promote `ingestEvent` and `syncTurnAndPhase` to `public`.** They
   are `private` today. No body change — just the visibility keyword.
   `ingestEvent(event: ServerMessage, state: PreComputedState)` —
   note it currently takes the *state* only for the `MSG_BECOME_TARGET`
   board snapshot.

2. **Split the board dependency out of `ingestEvent`'s signature.** The
   live driver has no `PreComputedState` — it has an event + a board
   snapshot (`logicalState()`). Change the public signature to:
   ```ts
   ingestEvent(event: ServerMessage, board: BoardStatePayload): void
   ```
   `syncTurnAndPhase` already takes a board-shaped arg — align it:
   ```ts
   syncTurnAndPhase(board: BoardStatePayload): void
   ```
   Internally `ingestEvent` passes `board` where it currently passes
   `state.boardState` (the `MSG_BECOME_TARGET` path). `ingestState`
   (the batch entry, kept for the CLI + tests) becomes a thin wrapper:
   ```ts
   ingestState(state: PreComputedState): void {
     this.syncTurnAndPhase(state.boardState);
     for (const e of state.events) this.ingestEvent(e, state.boardState);
   }
   ```
   This is a behaviour-preserving refactor — `ingestState`'s observable
   output is identical.

3. **`finish()` stays public, stays a no-op** — the docstring already
   says "kept for the incremental API". No change.

**Acceptance 0b:** `npm test` green — `ingestState` output byte-identical
to before (the batch path is unchanged in behaviour). The new public
`ingestEvent`/`syncTurnAndPhase` are reachable.

**Risks:** none new — pure refactor.

### 0c — Language-agnostic builder (O9)

The builder must emit **stable i18n keys**, not French strings, so the
Angular component translates and EN comes free. Analysis O9.

**Files modified:**
- `duel-server/src/game-log/game-log-builder.ts`
- `duel-server/src/game-log/game-log-markdown.ts`
- `duel-server/src/game-log/game-log-html.ts`
- `duel-server/src/game-log/game-log-builder.spec.ts`

**Steps:**

1. **Convert `VERB`, `PHASE_LABEL`, `WIN_REASON` to key maps.** Today
   `VERB.draw = 'Pioche'`. Change to `VERB.draw = 'gameLog.verb.draw'`
   (a stable key). Same for `PHASE_LABEL` (`'gameLog.phase.draw'`) and
   `WIN_REASON` (`'gameLog.winReason.lpZero'`). The builder now emits
   keys in `MovedCard.verb`, `SeparatorEntry.label` (phase + win), etc.

   ⚠️ **Decision point — separator `label` is mixed.** `SeparatorEntry.label`
   carries turn labels (`"Tour 3"` — has a number), phase names, decision
   sentences, the winner line. A pure key works for phase/win; turn
   labels need interpolation. Cleanest: the builder emits a **key + a
   params object** for entries that interpolate, or emits a structured
   field (`turnNumber` already exists on the turn separator — the
   renderer composes `"Tour {{n}}"` from the i18n key + `turnNumber`).
   Prefer the **structured** route: the builder already carries
   `turnNumber`; the renderer owns the `"Tour N"` string. Drop the
   pre-composed `label` for turn separators, keep it key-based for phase.
   Audit each `SeparatorKind` and decide key-vs-structured per kind —
   small, 7 kinds.

2. **The CLI renderers keep a local FR table.** `game-log-markdown.ts`
   and `game-log-html.ts` are dev artefacts, not i18n-bound. They must
   still render readable French. Add a small `KEY_TO_FR: Record<string,
   string>` map in a shared CLI-side helper (e.g.
   `game-log/game-log-fr-strings.ts`, server-only) and have both
   renderers translate keys through it. This keeps `a8859c98.html`
   readable as the visual reference.

3. **Update the spec** — assertions like `verb).toBe('Pioche')` become
   `verb).toBe('gameLog.verb.draw')`. Mechanical, one pass.

**Acceptance 0c:** `npm test` green with key-based assertions; the CLI
still emits French `.md` + `.html` (via `KEY_TO_FR`); `a8859c98.html`
visually unchanged.

**Risks:** none new.

### 0d — Move the builder to a shared module

Physically share `game-log-types.ts` + `game-log-builder.ts` between
front and duel-server, byte-synced like the ws-protocol files.
Analysis §6 / §7.1.

**Decision — placement.** The ws-protocol precedent is **paired files
byte-synced by a script**, not a literal shared package (the repo has no
shared-package tooling — brownfield, no new deps). Follow it exactly:

- duel-server keeps `duel-server/src/game-log/game-log-types.ts` and
  `game-log-builder.ts` (with `.js` import suffixes).
- front gets copies at `front/src/app/pages/pvp/game-log/game-log-types.ts`
  and `game-log-builder.ts` (no `.js` suffix, front import style).
- `scripts/check-ws-protocol-sync.mjs` gains two entries in its
  `splitFiles` array for the new pair. **The normalizer WILL need
  widening — this is a certainty, not a "verify".** The script's stem
  regex matches `from '\.\/ws-protocol-(\w+)\.js'` only; the game-log
  files are NOT named `ws-protocol-*`, so their cross-import paths
  (`game-log-types` ↔ `game-log-builder`, and their `ws-protocol-shared`
  / `ws-protocol-replay` imports) will NOT normalise under the current
  regex. The fix: add a game-log-specific normalization branch (or a
  generalised path-stem rule) so the front copy
  (`pvp/game-log/game-log-*.ts`, no `.js`) and the back copy
  (`game-log/game-log-*.ts`, `.js` suffix) reduce to byte-identical.
  Confirmed by reading the script during plan authoring (2026-05-22).

**Files:**
- *New:* `front/src/app/pages/pvp/game-log/game-log-types.ts`
- *New:* `front/src/app/pages/pvp/game-log/game-log-builder.ts`
- *Modified:* `scripts/check-ws-protocol-sync.mjs` (sync list + maybe
  the normalizer)
- *Modified:* the duel-server `game-log/` imports stay; the CLI +
  renderers keep importing the duel-server copy.

**Steps:**

1. Finish 0a/0b/0c on the duel-server copy FIRST — move a *finished*
   builder, not a moving target.
2. Copy `game-log-types.ts` + `game-log-builder.ts` to the front path,
   stripping `.js` import suffixes (`'../ws-protocol-shared.js'` →
   `'../duel-ws-shared.types'` etc. — same transform the ws-protocol
   files use).
3. Extend `check-ws-protocol-sync.mjs`: add the game-log pair to
   `splitFiles`; if the normalizer's stem regex does not cover them,
   add a game-log-specific normalization branch.
4. Run `npm run --prefix duel-server prebuild` — the sync check must
   pass (the two copies normalise to byte-identical).
5. The front does NOT import the renderers (`game-log-html`,
   `game-log-markdown`) or `effect-desc-resolver` — those stay
   server-only (§1.1). Only types + builder cross.

**Acceptance 0d:** `check-ws-protocol-sync.mjs` green with the game-log
pair; front `tsc` resolves the new module; duel-server build unaffected.

**Risks:** R12 (accepted — the `reason` bitmask duplication is now frozen
across the two copies; documented, not mitigated).

### Lot 0 — exit criteria

- duel-server `npm test` + `npm run build` green.
- `npm run game-log` perspectives 0 + 1 both correct.
- `check-ws-protocol-sync.mjs` green with the game-log pair.
- front `tsc` resolves `pvp/game-log/`.
- The builder: relative-board contract, public `ingestEvent`, key-based
  output, shared. **Lot 2 is unblocked.**

---

## Lot 1 — Server + transport (effect text) — runs ∥ Lot 0

**Goal.** `descriptionText` reaches the front on `MSG_CHAINING`. Without
it the bubble and the panel's activation rows are textless.

**Files:**
- *Modified:* `duel-server/src/ws-protocol-game.ts`
- *Modified:* `front/src/app/pages/pvp/duel-ws-game.types.ts`
- *Modified:* `duel-server/src/duel-worker.ts`
- *Modified:* `front/src/app/pages/pvp/duel-page/duel-event-processor.ts`
- *Modified:* `front/src/app/pages/pvp/duel-page/types/duel-state.types.ts`
  (`ChainLinkState`)

**Steps:**

1. **`ChainingMsg.descriptionText?: string`** — add the optional field
   to the `ChainingMsg` interface in `ws-protocol-game.ts` (duel-server)
   AND `duel-ws-game.types.ts` (front). The two are byte-synced — make
   the SAME edit on both, then run `check-ws-protocol-sync.mjs`.
2. **Populate it in `duel-worker.ts`** where `MSG_CHAINING` is built.
   The analysis (chantier §5.1) names the existing helper:
   `getOptionDesc(description)` — the same path `SelectEffectYnMsg`
   already uses. Resolve `description` → text, assign to
   `descriptionText`.
3. **Confirm the replay precompute path (O7).** `replay-precompute.ts`
   builds `MSG_CHAINING` via `transformMessage` → `filterMessage`. Verify
   that path reaches the same `getOptionDesc` resolution — if the
   precompute builds `MSG_CHAINING` through the same code touched in
   step 2, old replays inherit `descriptionText` for free (they are
   recomputed at read time). If precompute has a *separate* `MSG_CHAINING`
   construction, apply the same `getOptionDesc` call there too.
4. **`ChainLinkState.descriptionText?: string`** — add the field to the
   interface in `duel-state.types.ts`.
5. **`DuelEventProcessor.buildChainLinkState()`** — copy
   `msg.descriptionText` onto the built `ChainLinkState` (the field is
   dropped today).

**Acceptance Lot 1:**
- `check-ws-protocol-sync.mjs` green.
- A live PvP `MSG_CHAINING` carries `descriptionText` (verify via
  `__skytrixDebug` snapshot or a WS log).
- A freshly-loaded replay of `a8859c98` carries `descriptionText` on its
  chaining events.
- duel-server + front build green.

**Risks:** R4 (resolved — O7).

---

## Lot 2 — `DuelGameLogService` (the spine)

**Goal.** The service that taps the orchestrator, drives the builder,
accumulates the log, and feeds both surfaces. Depends on Lot 0 (the
shared builder) and Lot 1 (`descriptionText`).

**Files:**
- *New:* `front/src/app/pages/pvp/duel-page/duel-game-log.service.ts`
- *Modified:* `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts`
  (the `notifyGameLog` tap + the `reset()` wiring)
- *Modified:* `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
  (provide + inject)
- *Modified:* the replay page component (provide + inject)

### 2a — The `notifyGameLog` tap

**One call, inside `processEvent`, between line 1048 and line 1050.**
Analysis §2.3.

**Steps:**

1. In `animation-orchestrator.service.ts`, `processEvent` — after the
   `boardStateAfter` / `updateLogical` block (line 1048) and before the
   `switch` (line 1050), insert one line:
   ```ts
   this.gameLog?.notifyGameLog(event);
   ```
   `gameLog` is an *optional* injected `DuelGameLogService` (optional so
   the orchestrator's existing spec suite, which does not provide the
   service, keeps compiling — the analysis's "passive side-effect tap,
   must not interfere with dispatch" constraint). Inject via
   `inject(DuelGameLogService, { optional: true })`.
2. **Why this placement is correct** (do not move it): a buffered event
   returns at line 1035 *before* this line; it reaches the tap only when
   `replayBuffer` re-dispatches it. `updateLogical(boardStateAfter)` has
   already run, so `logicalState()` is current for this event. See
   analysis §2.3 / §2.4 — this is load-bearing, comment it in the code.

### 2b — The service itself

**Signature *(proposed)*:**
```ts
@Injectable()
export class DuelGameLogService {
  /** The accumulated log — drives the panel. */
  readonly gameLogEntries: Signal<GameLogEntry[]>;
  /** The last opponent activation — drives the bubble. Null = none / cleared. */
  readonly lastOpponentActivation: Signal<OpponentActivation | null>;

  /** Called by the orchestrator tap, once per genuinely-dispatched event. */
  notifyGameLog(event: GameEvent): void;

  /** Cleared on rematch / switch / state-sync — wired into resetAllState. */
  reset(): void;

  /** DEV ONLY — inject a synthetic MSG_CHAINING for the dev-hub bubble
   *  trigger. No-op in production. (Lot 3d.) */
  injectDevChaining(fixture: EffectBubbleFixture): void;
}
```

**Steps:**

1. **Hold a `GameLogBuilder` instance** (the shared one from Lot 0d) +
   a `WritableSignal<GameLogEntry[]>`. After each `notifyGameLog`, the
   service drives the builder and republishes `builder.entries`.
2. **`notifyGameLog(event)` body:**
   - read `logicalState()` (the relative board — analysis §2.4);
   - synthesise turn/phase: call `builder.syncTurnAndPhase(board)` (it
     no-ops when turn/phase unchanged);
   - call `builder.ingestEvent(event, board)`;
   - republish: `this._entries.set([...builder.entries])`.
   ⚠️ `builder.entries` is a mutable array — the signal needs a fresh
   reference each publish (`[...]`) or `OnPush` consumers won't update.
3. **`perspective`** — the builder needs the viewer's absolute index at
   construction. PvP: `DuelContext.ownPlayerIndex()`. Replay:
   `perspectiveIndex()`. The service reads whichever applies (it is
   provided in both pages — see 2d). Per analysis O5, `perspective`
   only relativises *event* fields now.
4. **Retain raw tapped events** in a private array — needed for the P1
   perspective-flip rebuild (R7 / analysis §4.2). On a replay
   perspective flip, rebuild: new `GameLogBuilder(newPerspective)`,
   re-feed the retained events, republish.
5. **`lastOpponentActivation`** — on a `MSG_CHAINING` event whose
   relativised player is the opponent (`rel === 1`), set a signal with
   `{ cardCode, cardName, descriptionText }`. This is the bubble's feed;
   it does NOT go through the builder (analysis §3.5 — the bubble reads
   the raw event). The bubble component owns the hold timer + last-wins;
   the service just exposes the latest opponent activation.
6. **`reset()`** — clear `_entries`, new `GameLogBuilder`, clear the
   retained-events array, clear `lastOpponentActivation`.

### 2c — `lastOpponentActivation` (bubble feed)

Covered in 2b step 5 — the signal exists from Lot 2; the bubble
*component* consuming it is Lot 3.

### 2d — Provide + inject at page level (R10)

**Steps:**

1. Add `DuelGameLogService` to the `providers` array of
   `duel-page.component.ts` AND the replay page component.
2. **Inject it in each page component's constructor** — even if nothing
   reads it yet — so it is instantiated from frame one. Analysis R10:
   a component-level service is created on first injection; if only the
   panel injects it, it misses every pre-panel-open event. The
   `DuelDebugService` does exactly this (provided + injected at page
   level). Mirror it.

### 2e — `reset()` wired into the orchestrator reset path (R8)

**Steps:**

1. `resetAllState()` in `animation-orchestrator.service.ts:533` is the
   shared reset for `resetForSwitch` + `onStateSync`. Add a call to the
   optional game-log service's `reset()`:
   ```ts
   this.gameLog?.reset();
   ```
   Place it alongside the other sub-system resets in `resetAllState()`.
2. **Not `ngOnDestroy`.** A rematch reuses the page component —
   `ngOnDestroy` does not fire. Analysis R8.

**Acceptance Lot 2:**
- front build + existing orchestrator specs green (the optional
  injection keeps them compiling).
- A new `duel-game-log.service.spec.ts`: feed a scripted event sequence
  through `notifyGameLog`, assert `gameLogEntries` matches; assert
  `lastOpponentActivation` fires only for opponent `MSG_CHAINING`;
  assert `reset()` clears both.
- Manual: drive a duel, `__skytrixDebug` (or a temporary log) confirms
  `gameLogEntries` grows.

**Risks:** R2, R3 (resolved — single shared tap), R7, R8, R10.

---

## Lot 3 — Surface 2: the effect bubble

**Goal.** The ephemeral opponent-effect bubble + its dev-hub trigger.
Depends on Lot 2c.

**Files:**
- *New:* `front/src/app/pages/pvp/duel-page/effect-bubble/effect-bubble.component.ts`
  (+ `.html`, `.scss`)
- *New:* `front/src/app/pages/pvp/duel-page/duel-dev-hub/effect-bubble-fixtures.ts`
- *New:* `front/src/app/pages/pvp/duel-page/duel-dev-hub/duel-dev-hub-game-log-tab.component.ts`
  (+ `.html`, `.scss`)
- *Modified:* `animation-constants.ts`
- *Modified:* `duel-dev-hub.component.html` + `.ts` (4th tab)
- *Modified:* `duel-dev-state.service.ts` (the tab enum)
- *Modified:* `duel-page.component.html` / replay page template (mount
  the bubble)
- *Modified:* `front/DESIGN-SYSTEM.md` (register the component — §6 / O6)

### 3a — `<app-effect-bubble>` component

**Steps:**

1. Standalone, `OnPush`. Anchored as a **CDK overlay** on the opponent
   duelist-card element (analysis §3.2 — B2, the `983b9865` hover
   precedent). A `FlexibleConnectedPositionStrategy` with fallback
   positions that expand *toward the corner* (guard-rail G2).
2. **`pointer-events`** — the outer overlay wrapper is
   `pointer-events: none` (click-through), the inner scrollable content
   box is `pointer-events: auto` (analysis §3.4 — so a long effect can
   be scrolled, guard-rail G1).
3. **DS chrome** — surface token, `--gold` border/glow, `--gold-on-surface`
   text, the ⚡ glyph as `<mat-icon>` + `@include icon-size`. No ad-hoc
   `<div class>`. The `.bubble*` mockup classes are NOT resurrected
   (analysis §5.3) — fresh from DS tokens.
4. **Max-height + internal scroll** — `max-height` (≈40% opponent
   half-board, chantier G1) + `@include ghost-scroll`.

### 3b — Timing + state

**Steps:**

1. The component reads `DuelGameLogService.lastOpponentActivation`. On a
   change → show, start the hold timer.
2. **Hold** — `ctx.scaledDuration(EFFECT_BUBBLE_MS, EFFECT_BUBBLE_MIN_MS)`,
   then fade out.
3. **Last-wins** — a new activation while visible replaces content +
   restarts the timer, no exit anim (chantier §4.1 state table).
4. **Anti-flicker floor** — once content X shows, hold it at least
   `EFFECT_BUBBLE_MIN_VISIBLE_MS` before allowing a replace; queue the
   latest pending content and swap when the floor elapses. Analysis
   §3.4.1 / R6 / O8.
5. **Reset** — the hold timer clears via `DuelGameLogService.reset()`
   (the service owns the bubble's feed signal; clearing it dismisses the
   bubble). Replay seek → `resetForSwitch` → `resetAllState` →
   `gameLog.reset()`. Analysis §3.4.3.

### 3c — `animation-constants.ts`

Add: `EFFECT_BUBBLE_MS` (≈3500), `EFFECT_BUBBLE_MIN_MS`,
`EFFECT_BUBBLE_FADE_MS` (+ `_MIN_MS` if the handler passes a min),
`EFFECT_BUBBLE_MIN_VISIBLE_MS` (≈700). Each with the one-line "what does
this gate" comment the file convention requires.

### 3d — Dev-hub trigger (§3.7)

**Steps:**

1. **`effect-bubble-fixtures.ts`** — declarative, type-checked against
   `ChainingMsg`. Mirror `prompt-fixtures.ts` structure (a `{ key,
   label, value }[]` exported const). Fixtures: short effect, very-long
   effect (G1 scroll), rapid-burst (an array of 3 — tests anti-flicker),
   self-activation (tests the opponent-only suppression). DEV-ONLY
   header comment, `isDevMode()`-gated consumption.
2. **`DuelGameLogService.injectDevChaining(fixture)`** — DEV ONLY,
   `isDevMode()` guard (no-op in prod). Feeds a synthetic `MSG_CHAINING`
   into the same internal path `notifyGameLog` uses (D1 — analysis §3.7).
   The synthetic event carries a **dev flag** (e.g. a `__dev: true`
   marker) so the builder-feeding branch skips it (no phantom journal
   row) while the bubble-feeding branch honours it. Analysis §3.7
   caveat 1.
3. **4th dev-hub tab** (O11) — `duel-dev-hub-game-log-tab.component.ts`,
   a fixture list with trigger buttons. Add the `@case` + tab button to
   `duel-dev-hub.component.html`; extend the tab union in
   `duel-dev-state.service.ts` (today `'board' | 'prompts' | 'end-flow'`
   → add `'game-log'`).
4. The whole 3d surface — fixtures file, `injectDevChaining`, the tab —
   is `isDevMode()`-gated and tree-shaken in prod, same contract as the
   rest of `DuelDevHub`.

**Acceptance Lot 3:**
- The bubble appears on an opponent activation, holds ~3.5s scaled,
  fades; a second activation replaces + restarts; never strobes on a
  fast burst (the dev-hub rapid-burst fixture is the test).
- The bubble never blocks a board click; a long effect scrolls.
- Self-activation does NOT show the bubble (dev fixture confirms).
- Dev-injected events do NOT add a journal row.
- All 3d code absent from a prod build.
- `front/DESIGN-SYSTEM.md` updated.

**Risks:** R6 (resolved).

---

## Lot 4 — Surface 1: the game-log panel

**Goal.** The full-height side-band journal. Depends on Lot 2.

**Files:**
- *New:* `front/src/app/pages/pvp/duel-page/game-log-panel/game-log-panel.component.ts`
  (+ `.html`, `.scss`)
- *New (token layer):* additions to `front/src/app/styles/**` (the
  `--gl-*` + `--duel-side-*` tokens)
- *Modified:* `duel-page.component.html` / replay page template (mount
  the panel + the trigger button)
- *Modified:* `pvp-board-container` (swap the dev-hub on-screen button —
  step 4f)
- *Modified:* `front/DESIGN-SYSTEM.md`
- *Modified:* `front/src/assets/i18n/en.json` + `fr.json` (Lot 6, but
  the keys are designed here)

### 4a — Port `game-log.css` → component SCSS (token three-bucket sort)

Analysis §5.1. **Steps:**

1. **Bucket A — delete the local copies.** Every `:root` token in
   `game-log.css` that already exists in `_tokens.scss` (`--text-*`,
   `--space-*`, `--radius-*`, `--gold*`, `--self-blue*`, `--opp-amber*`,
   `--surface-bg*`, `--border-*`, `--text-primary/...`, `--font-*`) —
   do NOT redeclare. The component SCSS inherits them from the app root.
2. **Bucket B — add to the token layer.** The 6 `--gl-*` type tokens +
   `--gl-pictogram` / `--gl-pile-tag`, and the `--duel-side-self/-opp`
   (+`-border`) aliases. Declare ONCE in `styles/**`, as aliases of
   existing tokens (D-A: aliases, not new hues).
3. **Bucket C — component-local, derived.** `--surface-row/-effect/-sub/
   -zonecell`, `--thumb-grad`, `--cardback-grad`, `--glow-target`,
   `--combat-atk/def/dmg` (+soft), `--action-add/rem`, `--negated` —
   declare in the component's `:host`, **derived from DS tokens where
   possible**. Audit each against `_tokens.scss` first — if a combat
   colour already exists as a `--pvp-*` token, promote it to Bucket B
   instead. Analysis §5.1.
4. Translate every `.lg-*` rule into the component SCSS verbatim
   (structure unchanged) — only the token *sources* change.
5. Stylelint + the pre-commit hook catch any surviving literal hex (R9).

### 4b — `<app-game-log-panel>` — the five-block render tree

**Steps:**

1. Standalone, `OnPush`. Consumes `DuelGameLogService.gameLogEntries`.
2. **Re-express `game-log-html.ts`'s render logic as an Angular
   template.** `game-log-html.ts` emits HTML strings — the component
   reproduces the same structure (`renderStream` chain-grouping,
   `renderEntry` per block, `renderMiniBoard`, the bare-row two-tier
   layout) as `@if`/`@for`/`@switch` template blocks + small render
   helper methods. Do NOT import `game-log-html.ts` (it is a string
   emitter; §1.1).
3. **`@if (open())`** gate — when closed, render nothing (R5 — DOM only
   when open; the builder runs regardless).
4. **`@for` with `track`** over `gameLogEntries()` — `track` by a stable
   per-entry id (add an index/id to `GameLogEntry` if none exists, or
   `track $index` if entries are append-only and never reordered —
   they are append-only, so `$index` is safe).
5. **DS primitives** for chrome (analysis §5.2): `<app-icon-button>`
   close, `<app-pill>` for the "↓ new entries" affordance, `<app-avatar>`
   for turn-header avatars (delete the hand-rolled djb2 disc),
   `<mat-icon>` glyphs via `@include icon-size`, `.badge` global class
   for the chain-link badge. Card thumbnails — plain `<img>` with
   `DuelCardArtService.resolveUrl(cardCode)`.

### 4c — Panel chrome (modelled on `pvp-zone-browser-overlay`)

`setupClickOutsideListener`, `onKeydown` (Escape), `isClosing` + timed
close, `OnPush`. Reuse the patterns from `pvp-zone-browser-overlay`
(analysis §6.2 of the chantier).

### 4d — Sticky headers + auto-scroll (G3)

1. Sticky turn-group headers — `position: sticky`, no `::ng-deep`.
2. **G3 auto-scroll** — when the panel is open AND scrolled to the
   bottom, a new entry auto-scrolls into view. When scrolled up, do NOT
   hijack — show a "↓ new entries" `<app-pill>` pinned at the bottom
   that scrolls down on click. Standard chat-log pattern.

### 4e — Click-a-row → card-inspector

A row with a `cardCode` → open the card-inspector. Reuse the
`inspectCard` output pattern from `pvp-zone-browser-overlay`
(analysis §6.2 of the chantier).

### 4f — Trigger button (swap the dev-hub on-screen button)

1. The PvP on-screen dev-hub button is swapped for the game-log trigger:
   an `<app-icon-button>` (history/scroll icon). The dev hub itself
   stays — reachable via `Ctrl+Shift+D` (O2, already resolved). Only the
   *on-screen button* changes.
2. The button lives where the dev-hub button lives — `pvp-board-container`.

### 4g — STRUCTURAL FIDELITY GATE (analysis §5.4)

**Not optional polish — a hard checkpoint.** Render the live panel
against the `a8859c98` replay; diff side-by-side with
`_bmad-output/game-log/a8859c98.html` (the reference of record). Verify:
same five-block grammar, same row anatomy, same chain grouping, same
3-level type hierarchy. **Permitted deltas** (do NOT "fix" these):
DS-token value shifts, DS-primitive metric differences, added
responsive/scroll behaviour. A *structural* mismatch is fixed HERE,
while Lot 5/6 can still absorb it.

**Acceptance Lot 4:**
- The panel opens/closes from the trigger button; full-height side band.
- Lists turns (with LP), phases, draws, summons, sets, flips,
  activations, resolutions (chain-link number), movements — grouped by
  turn, oldest at top.
- Sticky turn headers; G3 auto-scroll behaves.
- Row click opens the card-inspector.
- 4g structural diff vs `a8859c98.html` passes.
- Stylelint + lint green; `front/DESIGN-SYSTEM.md` updated.

**Risks:** R5, R9.

---

## Lot 5 — Replay parity check

**Goal.** Prove both surfaces work in replay with zero extra wiring.

**Steps:**

1. **5a** — confirm `DuelGameLogService` is provided + injected at the
   replay page level (done in Lot 2d). Mount `<app-effect-bubble>` and
   `<app-game-log-panel>` in the replay page template. Drive a replay —
   both surfaces must render with no replay-specific code.
2. **5b — the parity regression test.** Drive the `a8859c98` replay
   through the live app; capture `DuelGameLogService.gameLogEntries`.
   Run the CLI offline build of the same replay
   (`npm run game-log -- --replayId a8859c98…`). **Diff the two entry
   streams** — they must match (modulo the i18n-key vs FR-string
   difference: compare keys, or run the CLI with the `KEY_TO_FR` table
   reversed). This is the test that catches R11 (re-dispatch order
   drift) and proves the analysis's §2.5 parity claim.
3. Verify the bubble's opponent-only filter uses `perspectiveIndex()`
   in replay (analysis §3.3) — flip perspective, confirm the bubble
   switches sides.
4. Verify a replay perspective flip rebuilds the journal correctly
   (R7 / Lot 2b step 4).

**Acceptance Lot 5:** both surfaces render in replay; the `a8859c98`
live-vs-CLI diff matches; perspective flip is correct for both surfaces.

**Risks:** R3, R7, R11 (all verified here).

---

## Lot 6 — Final visual polish + DS audit

**Goal.** Final fidelity, i18n, registration, green gates.

**Steps:**

1. **6a** — polish pass: fidelity "spirit" vs the Master Duel captures
   (O4). The *structural* gate already passed at 4g — this is
   refinement (spacing, micro-typography), not a structural check.
2. **6b** — register `<app-effect-bubble>` + `<app-game-log-panel>` in
   `front/DESIGN-SYSTEM.md` (the §6 rule). Note: they are feature-scoped
   (`pvp/duel-page/`), not DS-core primitives (O6) — document them in
   the relevant section, not the 36-component catalogue.
3. **6c — i18n keys, FR + EN.** The builder emits keys (Lot 0c). Add the
   FR + EN entries to `front/src/assets/i18n/fr.json` + `en.json` for
   every `gameLog.verb.*`, `gameLog.phase.*`, `gameLog.winReason.*`, and
   every UI string of the two components (panel title, close, "new
   entries", bubble labels). The chantier's acceptance criteria require
   FR + EN.
4. **6d — green gates.** `npm run` lint + stylelint +
   `check-ws-protocol-sync.mjs`; front + duel-server specs green;
   builds green.
5. **6e — prototype-artefact cleanup.** The chantier left several
   prototype-era artefacts to retire *after* this chantier — no other
   lot owns them, so they land here:
   - `_mockups/mockup-game-log.html` — deprecated (chantier §8.5).
     Delete it.
   - `Capture1/2/3.PNG` at the repo root — chantier §1 says move to
     `_mockups/assets/` or delete. Decide and do it.
   - The O3/cards-fr investigation scripts at the `duel-server/` root
     (`check_card_count.mjs`, `query_cdb.js`, `query_cdb.mjs`,
     `verify_fr_availability.mjs`) — one-off probes, not shipped code.
     Delete them (or move to a scratch dir outside the repo).
   - Keep `_bmad-output/game-log/a8859c98.html` — it is the §5.4
     fidelity reference of record, not a throwaway. Keep the CLI
     (`game-log-builder-cli.ts`) — it is the parity oracle (Lot 5b).

**Acceptance Lot 6:** all chantier §9 acceptance criteria met; all gates
green; both components registered; prototype artefacts cleaned (6e).

---

## Critical path & sequencing summary

```
Lot 0 ──────────────┐
 0a → 0b → 0c → 0d   │  (0a/0b/0c on the duel-server copy,
                     │   THEN 0d moves the finished builder)
Lot 1 ──────────────┤  (independent — runs ∥ Lot 0)
 1a → 1b → 1c/1d/1e  │
                     ▼
Lot 2 ─ 2a → 2b → 2c → 2d → 2e   (needs Lot 0 + Lot 1)
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
Lot 3 ─ 3a→3b→3c→3d        Lot 4 ─ 4a→4b→4c→4d→4e→4f→4g
        (needs 2c)                (needs 2; 4g = HARD GATE)
        └────────────┬────────────┘
                     ▼
Lot 5 ─ 5a → 5b (parity diff — the R11 oracle)
                     ▼
Lot 6 ─ 6a → 6b → 6c → 6d → 6e (polish, i18n, registration, gates,
                               prototype-artefact cleanup)
```

**The one ordering rule that must not be broken:** finish 0a/0b/0c on the
duel-server builder copy *before* 0d moves it — move a finished brick,
not a moving target.

---

## Deliberate scope decisions (recorded so they are not silent gaps)

These are conscious choices, not omissions. An implementation-readiness
review (2026-05-22) confirmed each is intentional.

- **`game-log-labels.ts` is NOT created.** The chantier §5.4 proposed
  extracting `generateLabel()` from `replay-precompute.ts` into a shared
  label utility and repointing the precompute. This plan does NOT do
  that — the `GameLogBuilder` (Lot 0d, shared) is the single labelling
  authority; `replay-precompute.ts` keeps its own `generateLabel()`
  (it serves a different consumer — the replay timeline stepper). Full
  rationale: `game-log-integration-analysis.md` §1.5. The duplication
  the chantier wanted to remove is **knowingly retained**, scoped out.

- **Prototype-artefact cleanup is owned by Lot 6e** — not "after the
  chantier", not unassigned. The deprecated `mockup-game-log.html`, the
  root `Capture*.PNG`, and the O3 investigation `.mjs` scripts are
  retired in 6e (see the lot). They are no longer "hygiene noticed in
  passing" — they have a home.

## Pre-existing repo hygiene noticed (genuinely out of scope)

One item unrelated to the Game Log feature, listed so it is not silently
absorbed:

- `game-log-integration-analysis.md` §3 numbers run §3.6 *before* §3.5,
  and `game-log-feed-chantier.md` has two `## 9` headings. Cosmetic
  document-numbering slips; fix if those docs are revised again. Not a
  code task.

---

## What this plan deliberately does NOT do

- It does not re-argue the architecture — that is the analysis's job.
- It does not specify pixel-level visual detail — the chantier UX spec
  and `a8859c98.html` own that; 4g is the gate.
- It does not write code — it is the map a developer or `bmad-dev-story`
  follows to write it.
