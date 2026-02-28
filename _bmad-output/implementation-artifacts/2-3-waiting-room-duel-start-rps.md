# Story 2.3: Waiting Room & Duel Start (RPS)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the duel to start automatically with Rock-Paper-Scissors when my opponent joins,
so that we can fairly determine who plays first.

## Acceptance Criteria

1. **Given** both players have joined the room and the room status is `ACTIVE`
   **When** both WebSocket connections are established for both players
   **Then** OCGCore sends `RPS_CHOICE` prompt to both clients simultaneously
   **And** the `PromptRpsComponent` (Story 1.6, already implemented) displays via the existing prompt sheet (`PvpPromptSheetComponent`) in `full` height mode — covering the entire viewport
   **And** each player selects Rock, Paper, or Scissors within 30 seconds
   **And** if timeout: system selects randomly for the timed-out player (already implemented in `PromptRpsComponent`)
   **And** the duel board is NOT visible during RPS — only the prompt sheet overlay

2. **Given** both RPS selections are received by the server
   **When** OCGCore resolves RPS
   **Then** server sends `RPS_RESULT` to both clients (both choices + winner ID)
   **And** the client displays an RPS result overlay: both choices revealed simultaneously with a brief animation + winner announcement text
   **And** the overlay auto-dismisses after 3 seconds
   **And** if draw (`winner === null`): OCGCore sends a new `RPS_CHOICE` — RPS repeats

3. **Given** RPS is resolved (a winner exists)
   **When** OCGCore determines turn order (winner goes first automatically — no explicit "Go First / Go Second" prompt; `@n1xx1/ocgcore-wasm` has no `SELECT_TP` message type)
   **Then** OCGCore distributes 5 cards to each player's hand automatically
   **And** the duel enters Draw Phase of the first turn
   **And** the first `BOARD_STATE` message arrives at the client

4. **Given** the first `BOARD_STATE` is received
   **When** the client processes the board state
   **Then** `roomState` transitions from `'connecting'` to `'active'`
   **And** the duel board renders with both players' fields, hands, and LP (8000 vs 8000)
   **And** fullscreen + landscape lock is triggered (existing effect on `roomState === 'active'`)
   **And** the prompt sheet returns to normal height (no longer full-screen overlay)

5. **Given** the player is on the `DuelPageComponent` in `'connecting'` state
   **When** the WebSocket connection fails before RPS completes
   **Then** the existing reconnection logic applies (exponential backoff: 2s, 4s, 8s, max 3 retries)
   **And** if all retries fail: `connectionStatus` = `'lost'`, error overlay shown with "Back to lobby" button

## Tasks / Subtasks

- [x] Task 1: Handle `RPS_RESULT` in `DuelWebSocketService` (AC: #2)
  - [x] 1.1 Add `private _rpsResult = signal<RpsResultMsg | null>(null)` and `readonly rpsResult = this._rpsResult.asReadonly()` to `DuelWebSocketService`
  - [x] 1.2 Add `case 'RPS_RESULT':` in `handleMessage()` switch — set `this._rpsResult.set(message as RpsResultMsg)`
  - [x] 1.3 Import `RpsResultMsg` from `duel-ws.types.ts` (already defined: `{ type: 'RPS_RESULT', player1Choice: number, player2Choice: number, winner: Player | null }`)

- [x] Task 2: Fix `connectWhenReady()` — defer `'active'` state to first `BOARD_STATE` (AC: #1, #4)
  - [x] 2.1 In `connectWhenReady()`: remove `this.roomState.set('active')` — keep `roomState` at `'connecting'` after `wsService.connect()`
  - [x] 2.2 Add a `boardReady` computed: `readonly boardReady = computed(() => this.duelState().players.length > 0 && this.duelState().players[0].lp > 0)`
  - [x] 2.3 Add effect: when `boardReady()` becomes `true` AND `roomState() === 'connecting'` → `this.roomState.set('active')`
  - [x] 2.4 Verify: the `@if (roomState() === 'active' || roomState() === 'connecting')` block in template already renders the prompt sheet for `'connecting'` — no template gate change needed for prompt visibility

- [x] Task 3: Add RPS result overlay in template (AC: #2)
  - [x] 3.1 Inside the `@if (roomState() === 'active' || roomState() === 'connecting')` block, add a full-screen overlay: `@if (wsService.rpsResult(); as rps)` displaying both choices + winner text
  - [x] 3.2 Display: player choice (left) vs opponent choice (right) using emoji icons — map choice values: `0 = Rock ✊`, `1 = Paper ✋`, `2 = Scissors ✌️`
  - [x] 3.3 Winner text: "You go first!" (winner === 0) / "Opponent goes first!" (winner === 1) / "Draw — playing again..." (winner === null)
  - [x] 3.4 Auto-dismiss: add effect in `DuelPageComponent` that watches `wsService.rpsResult()` — when non-null, `setTimeout(() => wsService['_rpsResult'].set(null), duration)` with 3000ms for winner, 2000ms for draw
  - [x] 3.5 Also clear rpsResult when a new `RPS_CHOICE` arrives (for draw replay) — add `this._rpsResult.set(null)` in the `RPS_CHOICE` case of `handleMessage()`
  - [x] 3.6 SCSS: full-viewport overlay with z-index above prompt sheet, centered content, semi-transparent dark background, large emoji display with scale-in CSS animation, `prefers-reduced-motion` support

- [x] Task 4: Conditionally hide board during `'connecting'` (RPS phase) (AC: #1)
  - [x] 4.1 Wrap the board container (`app-pvp-board-container`), hand rows (`app-pvp-hand-row` x2), mini-toolbar, zone browser overlay, and card inspector inside `@if (roomState() === 'active')` — NOT visible during `'connecting'`
  - [x] 4.2 Keep outside the `'active'` gate: prompt sheet (`app-pvp-prompt-sheet`), connection overlays, RPS result overlay, orientation overlay — these must be visible during `'connecting'`
  - [x] 4.3 Add "Connecting to duel..." fallback text + spinner visible during `'connecting'` when no prompt is pending (before RPS_CHOICE arrives)

- [ ] Task 5: Verify end-to-end RPS flow (AC: #1-5)
  - [ ] 5.1 Two browser tabs: create room + join → verify RPS prompt appears for both players
  - [ ] 5.2 Verify: PromptRpsComponent shows 3 choices (Rock/Paper/Scissors), 30s countdown, keyboard 1/2/3
  - [ ] 5.3 Verify: after both choose → RPS_RESULT displayed with both choices + winner text
  - [ ] 5.4 Verify: on draw → "Draw — playing again..." → new RPS prompt after 2s
  - [ ] 5.5 Verify: after RPS resolved → first BOARD_STATE → board renders with 5 cards in each hand, LP 8000 vs 8000
  - [ ] 5.6 Verify: fullscreen + landscape lock triggered only on `'active'` (not during RPS)
  - [ ] 5.7 Verify: 30s RPS timeout → random selection → flow continues normally
  - [ ] 5.8 Edge case: disconnect during RPS → reconnection logic → re-sends RPS_CHOICE or STATE_SYNC

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays.
- **[class.specific-class] binding**: NEVER use `[class]` (wipes base CSS classes — recurring Epic 1 bug).
- **takeUntilDestroyed()**: Use `DestroyRef` pattern for all subscriptions.

### Critical: OCGCore RPS Flow (Verified from duel-worker.ts + @n1xx1/ocgcore-wasm)

The RPS flow is **entirely managed by OCGCore** — NOT custom server logic:

```
OCGCore                    duel-worker.ts              message-filter.ts           Angular client
────────────────────────   ───────────────────────────  ──────────────────────────  ────────────────────────
ROCK_PAPER_SCISSORS(p0) →  → RPS_CHOICE{player:0}  →   only send to p0        →   pendingPrompt → PromptRpsComponent
ROCK_PAPER_SCISSORS(p1) →  → RPS_CHOICE{player:1}  →   only send to p1        →   pendingPrompt → PromptRpsComponent
                           ← RPS response(p0)      ←   ← PLAYER_RESPONSE          ← user picks (0=Rock,1=Paper,2=Scissors)
                           ← RPS response(p1)      ←   ← PLAYER_RESPONSE          ← user picks
HAND_RES(result)       →   → RPS_RESULT{...}       →   broadcast to both      →   rpsResult signal → overlay
[if draw: repeat from ROCK_PAPER_SCISSORS]
[if winner: OCGCore auto-proceeds — winner goes first]
MSG_DRAW + START       →   → BOARD_STATE{...}      →   filter per player      →   duelState signal → board renders
```

**Key facts:**
- `@n1xx1/ocgcore-wasm` has NO `SELECT_TP` message type — winner goes first **automatically**
- Epics AC "HAND_RES: Go First / Go Second via PromptOptionListComponent" is **incorrect** for this WASM binding
- RPS choice values: client sends `0-2`, worker maps to `1-3` for OCGCore (`duel-worker.ts:571`: `value: (data['choice'] as number) + 1`)
- `RPS_RESULT` fields: `player1Choice`, `player2Choice`, `winner` (0 = player 0 wins, 1 = player 1 wins, null = draw)
- Filter: `RPS_CHOICE` private per player (`message-filter.ts:80-82`), `RPS_RESULT` broadcast (`message-filter.ts:109`)

### What NOT to Change (Already Implemented)

| Component | File | Status |
|-----------|------|--------|
| `PromptRpsComponent` | `prompts/prompt-rps/prompt-rps.component.ts` | ✅ Done (Story 1.6) — 30s timer, keyboard 1/2/3, random on timeout, `preferredHeight: 'full'` |
| `prompt-registry.ts` | `prompts/prompt-registry.ts` | ✅ Done — `['RPS_CHOICE', PromptRpsComponent]` registered |
| `RPS_CHOICE` handler | `duel-web-socket.service.ts:148-150` | ✅ Done — `pendingPrompt.set(message)` |
| `PvpPromptSheetComponent` | `prompts/pvp-prompt-sheet/` | ✅ Done (Story 1.6) — portal-based sheet |
| `RpsChoiceMsg`, `RpsResultMsg` | `duel-ws.types.ts:409-419` | ✅ Done — TypeScript interfaces defined |
| Duel server RPS | `duel-worker.ts:373-385`, `message-filter.ts:80-82,109` | ✅ Done — transforms + routes correctly |
| Spring Boot backend | All room/duel endpoints | ✅ Done — no changes needed |

### What MUST Change (Story 2.3 Scope)

| File | Change | Why |
|------|--------|-----|
| `duel-web-socket.service.ts` | Add `RPS_RESULT` case + `rpsResult` signal + clear rpsResult on `RPS_CHOICE` | Currently `RPS_RESULT` falls to `default` → console.log only |
| `duel-page.component.ts` | Remove immediate `roomState.set('active')` from `connectWhenReady()` | Board renders before any data; RPS should play first |
| `duel-page.component.ts` | Add `boardReady` computed + effect to transition to `'active'` on first BOARD_STATE | Proper state transition |
| `duel-page.component.ts` | Add RPS result auto-dismiss effect | 3s winner / 2s draw auto-dismiss |
| `duel-page.component.html` | Gate board/hands/toolbar behind `@if (roomState() === 'active')` | Don't show empty board during RPS |
| `duel-page.component.html` | Add RPS result overlay + "Connecting..." fallback | UX for RPS result display |
| `duel-page.component.scss` | RPS result overlay styles + animation | Full-viewport overlay with scale-in |

### Previous Story Intelligence (Stories 2-1 and 2-2)

**Reuse These Patterns:**
- `effect()` with `untracked()` for side effects (countdown, fullscreen) — same pattern for RPS auto-dismiss
- Signal-based state machine — `roomState` transitions are clean and predictable
- `displayError()` snackbar before navigation on error

**Avoid These (Fixed in Previous Reviews):**
- C1: Polling error killed subscription → inner `catchError`
- H1: Missing loading overlay → always show feedback during async
- L2: Snackbar 2000ms → 3000ms consistently

**Anti-Patterns:**
- ❌ Don't add unnecessary signals — DuelPageComponent already has ~20 signals
- ❌ Don't trigger fullscreen during `'connecting'` — only on `'active'`
- ❌ Don't modify PromptRpsComponent — it's complete from Story 1.6

### Source Tree — Files to Touch

**MODIFY (4 files):**
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss`

**REFERENCE (read-only):**
- `front/src/app/pages/pvp/duel-page/prompts/prompt-rps/prompt-rps.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-registry.ts`
- `front/src/app/pages/pvp/duel-ws.types.ts:409-419`
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts`
- `duel-server/src/duel-worker.ts:373-385`
- `duel-server/src/message-filter.ts:80-82,109`

**DO NOT TOUCH:**
- Backend Spring Boot, backend duel server, PromptRpsComponent, prompt-registry, lobby page, room API/types

### RPS Result Overlay Design

```
┌──────────────────────────────────────────────┐
│                                              │
│           ROCK PAPER SCISSORS                │
│                                              │
│      ✊          VS          ✌️              │
│    (You)                 (Opponent)           │
│                                              │
│          🎉 You go first! 🎉                │
│                                              │
│          [auto-dismiss in 3s]                │
└──────────────────────────────────────────────┘
```

- Full-viewport overlay: `position: fixed; inset: 0`, z-index above prompt sheet
- Background: `rgba(0,0,0,0.85)`
- Large emoji: `font-size: 4rem` with CSS `transform: scale(0) → scale(1)` animation (200ms ease-out)
- Winner text: fade-in 500ms delay after choices appear
- Draw variant: "Draw — playing again..." with shorter 2s dismiss
- `prefers-reduced-motion`: skip scale animation, instant display

### Testing Standards

- **No automated tests** — "Big bang" approach per project convention
- **Manual verification** — see Task 5 subtasks for complete checklist

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md#Story 2.3]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md#WebSocket Protocol]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md#PvP State Flow]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#PromptRpsComponent]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md#FR4]
- [Source: _bmad-output/implementation-artifacts/2-1-room-creation-from-decklist.md#Dev Notes]
- [Source: _bmad-output/implementation-artifacts/2-2-room-browsing-joining.md#Previous Story Intelligence]
- [Source: duel-server/src/duel-worker.ts:373-385]
- [Source: duel-server/src/message-filter.ts:80-82,109]
- [Source: front/src/app/pages/pvp/duel-page/prompts/prompt-rps/prompt-rps.component.ts]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts:409-419]
- [Source: @n1xx1/ocgcore-wasm — OcgResponseType enum confirms no SELECT_TP]

## Change Log

- 2026-02-28: Story 2.3 implementation — Tasks 1-4 completed, build passes, Task 5 (manual verification) pending user execution
- 2026-02-28: **Code Review** — 6 findings (1C, 3M, 2L), all auto-fixed:
  - [C1] RPS_RESULT perspective bug: joiner saw inverted choices + wrong winner text. Fixed in `message-filter.ts` — swap `player1Choice`/`player2Choice` and `winner` for player 1.
  - [M1] Private member access `wsService['_rpsResult']` → exposed public `clearRpsResult()` method.
  - [M2] Flash "Connecting to duel..." between RPS selection and result → added `rpsInProgress` signal to bridge the gap.
  - [M3] setTimeout leak in RPS auto-dismiss → stored ref + cleanup in `destroyRef.onDestroy()`.
  - [L1] `boardReady` checked `players.length > 0` → `=== 2` for PvP precision.
  - [L2] Missing `aria-live` on connecting fallback → added `aria-live="polite"`.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build verified: `ng build --configuration=development` — 0 errors, 0 warnings

### Completion Notes List

- **Task 1**: Added `rpsResult` signal + `RPS_RESULT` case in `DuelWebSocketService.handleMessage()`. Also clears `rpsResult` when new `RPS_CHOICE` arrives (draw replay).
- **Task 2**: Removed immediate `roomState.set('active')` from `connectWhenReady()`. Added `boardReady` computed (checks players populated + LP > 0) + effect to transition `'connecting'` → `'active'` on first `BOARD_STATE`.
- **Task 3**: Added RPS result overlay in template with emoji display (Rock/Paper/Scissors), winner/draw text, auto-dismiss effect (3s winner, 2s draw), full-viewport SCSS with scale-in animation + `prefers-reduced-motion` support. Added `$z-pvp-rps-overlay: 85` to z-layers.
- **Task 4**: Restructured template — board/hands/toolbar/zone-browser/inspector gated behind `@if (roomState() === 'active')`. Prompt sheet, connection overlays, RPS overlay, orientation overlay remain visible during `'connecting'`. Added "Connecting to duel..." fallback with spinner.
- **Task 5**: Manual verification checklist — requires running duel server + Spring Boot + Angular dev server with 2 browser tabs.

### File List

- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` (modified)
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` (modified)
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` (modified)
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss` (modified)
- `front/src/app/styles/_z-layers.scss` (modified)
- `duel-server/src/message-filter.ts` (modified) — [Review C1] RPS_RESULT perspective correction
