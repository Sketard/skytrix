# Story 3.1: Surrender

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to surrender during a PvP duel at any point,
So that I can gracefully concede when a loss is inevitable.

## Acceptance Criteria

### AC1: Surrender Button & Confirmation Dialog

**Given** the player is in an active duel (`roomState() === 'active'`)
**When** they tap the surrender button (flag icon, mini-toolbar, bottom-right)
**Then** if a prompt sheet is open, the prompt sheet is dismissed first (pending prompt discarded client-side — the server discards the unanswered SELECT_* upon receiving `SURRENDER`)
**And** a confirmation dialog opens: "Abandon the duel?" with "Surrender" (destructive, `color="warn"`) and "Cancel" buttons
**And** the dialog uses `mat-dialog` with `role="alertdialog"` and `aria-label="Surrender confirmation"`
**And** the surrender button has a minimum touch target of 44px (`--pvp-min-touch-target`)

### AC2: Surrender Confirmed — Server Flow

**Given** the surrender confirmation dialog is open
**When** the player confirms ("Surrender")
**Then** `DuelWebSocketService.sendSurrender()` is called (sends `{ type: 'SURRENDER' }` via WebSocket)
**And** the server sets the match result: opponent wins, reason `surrender`
**And** the server notifies both players with `DUEL_END` message containing `{ winner: opponentIndex, reason: 'surrender' }`
**And** `wsService.duelResult()` signal fires on both clients
**And** the existing duel-end effect calls `POST /api/rooms/{roomId}/end` to mark the room as ENDED
**And** both clients will transition to the duel result screen (Story 3.4 — placeholder for now: show `duelResult()` data inline)

### AC3: Surrender Cancelled

**Given** the surrender confirmation dialog is open
**When** the player cancels or taps outside the dialog
**Then** the dialog closes, player remains in the active duel
**And** no message is sent to the server

### AC4: Browser Back / Navigation Guard (CanDeactivate)

**Given** the player is in an active duel (`roomState() === 'active'`)
**When** they press browser back or attempt to navigate away
**Then** a `CanDeactivate` guard intercepts navigation
**And** the surrender confirmation dialog opens (same dialog as AC1)
**And** if confirmed: surrender is sent, navigation proceeds after `duelResult()` fires
**And** if cancelled: navigation is blocked, player remains in duel

### AC5: Surrender During Prompt (Edge Case)

**Given** the player has an active prompt (prompt sheet is open)
**When** the player collapses the sheet (via collapse handle ▼) and taps the surrender button
**Then** the surrender confirmation dialog appears above all other UI (z-index 3 in the stack: below result overlay, below prompt sheet, but above all other elements)
**And** if confirmed: `sendSurrender()` is called — the server discards the pending prompt and processes the surrender
**And** the prompt sheet closes (duel end interrupts all prompts per UX spec)

## Tasks / Subtasks

- [x] Task 1: Enable surrender button in template (AC: #1)
  - [x] 1.1 Remove `disabled` attribute from surrender button in `duel-page.component.html`
  - [x] 1.2 Add `(click)="onSurrenderClick()"` handler
  - [x] 1.3 Ensure the button is visible during opponent's turn (currently toggle is hidden, surrender stays — verify this is the case)
  - [x] 1.4 Verify touch target ≥ 44px on the `mat-icon-button`

- [x] Task 2: Create surrender confirmation dialog (AC: #1, #2, #3)
  - [x] 2.1 Create inline confirmation dialog using `MatDialog.open()` — NO separate component file (simple confirm/cancel dialog, not worth a standalone component)
  - [x] 2.2 Dialog content: title "Abandon the duel?", body text explaining this will count as a loss, two buttons: "Cancel" (secondary) and "Surrender" (`color="warn"`, right side per Material convention)
  - [x] 2.3 Dialog config: `role: 'alertdialog'`, `ariaLabel: 'Surrender confirmation'`, `disableClose: false` (click outside to cancel), `width: '320px'`
  - [x] 2.4 On confirm: call `this.wsService.sendSurrender()`, close dialog
  - [x] 2.5 On cancel/dismiss: close dialog, no action

- [x] Task 3: Implement `onSurrenderClick()` method in DuelPageComponent (AC: #1, #5)
  - [x] 3.1 Open surrender confirmation dialog (do NOT manually clear `pendingPrompt()` — the `DUEL_END` handler already interrupts all prompts per UX spec "Duel End Interrupts All")
  - [x] 3.2 Use `dialogRef.afterClosed().pipe(...)` pattern — do NOT nest subscriptions

- [x] Task 4: CanDeactivate guard for browser back (AC: #4)
  - [x] 4.1 Create a `canDeactivate` guard function in `duel-page.component.ts` (or co-located file) that checks if `roomState() === 'active'`
  - [x] 4.2 If active: open the same surrender confirmation dialog via `component.confirmSurrender()`, return `Observable<boolean>` from `afterClosed()`
  - [x] 4.3 If confirmed: send surrender, then wait for `duelResult()` to fire before allowing navigation — use `toObservable(wsService.duelResult)` from `@angular/core/rxjs-interop` + `filter(r => !!r)` + `take(1)` + `map(() => true)`. Add a **5-second timeout** (`timeout(5000)`, `catchError(() => of(true))`) to prevent the guard from blocking indefinitely if WS is already dead
  - [x] 4.4 If not active (waiting, loading, error, etc.): allow navigation freely
  - [x] 4.5 Register the guard on the `pvp/duel/:roomCode` route in `app.routes.ts`

- [x] Task 5: Placeholder duel result display (AC: #2)
  - [x] 5.1 The duel-end effect already exists (calls `POST /api/rooms/{roomId}/end`). Verify it works correctly with surrender `DUEL_END` message
  - [x] 5.2 Add a simple result overlay in the template when `wsService.duelResult()` is truthy: show "VICTORY" / "DEFEAT" based on `duelResult().winner` vs own player index, plus reason text. Style: full-screen overlay, high z-index. **This is a temporary placeholder** — Story 3.4 will implement `PvpDuelResultOverlayComponent` properly
  - [x] 5.3 Add a "Return to Lobby" button on the result overlay that navigates to `/pvp`

- [x] Task 6: Manual verification
  - [x] 6.1 Verify: surrender button is enabled during active duel
  - [x] 6.2 Verify: tapping surrender opens confirmation dialog
  - [x] 6.3 Verify: confirming surrender sends SURRENDER message, both players receive DUEL_END
  - [x] 6.4 Verify: cancelling dialog returns to duel without side effects
  - [x] 6.5 Verify: browser back during active duel opens surrender dialog
  - [x] 6.6 Verify: surrender during prompt sheet (collapse sheet, tap surrender, confirm)
  - [x] 6.7 Verify: room status transitions to ENDED in Spring Boot after surrender
  - [x] 6.8 Verify: result placeholder shows correct outcome (winner/loser perspective)
  - [x] 6.9 Verify: "Return to Lobby" button navigates to /pvp

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring Epic 1 bug).
- **`takeUntilDestroyed()`**: Use `DestroyRef` pattern for all subscriptions.
- **`effect()` with `untracked()`**: For all side effects (navigation, timers, HTTP calls).
- **`prefers-reduced-motion`**: Verify on ALL animated elements (Epic 2 retro action item — 0 motion findings target for Epic 3).

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| `sendSurrender()` method | `duel-web-socket.service.ts:60-62` | Already implemented |
| `SurrenderMsg` type | `ws-protocol.ts:556-558` + `duel-ws.types.ts` | Already defined |
| `SURRENDER` handler in server | `server.ts:517-525` | Already implemented — terminates worker, sends DUEL_END to both |
| `DuelEndMsg` type | `ws-protocol.ts:397-401` | Already defined: `{ type: 'DUEL_END', winner: Player \| null, reason: string }` |
| `duelResult()` signal | `duel-web-socket.service.ts` | Already fires on DUEL_END message |
| Duel-end effect (room end POST) | `duel-page.component.ts:338-347` | Already calls `POST /api/rooms/{roomId}/end` |
| `/api/rooms/{id}/end` endpoint | `RoomController.java:58-62` | Already implemented |
| `RoomService.endRoom()` | `RoomService.java:159-170` | Already checks authorization, sets ENDED |
| Surrender button (disabled) | `duel-page.component.html:196-201` | Already in template — just remove `disabled` |
| Mini-toolbar styles | `duel-page.component.scss:305-327` | Already styled |

### Critical: Server-Side Surrender Flow (Already Working)

```
Client sends: { "type": "SURRENDER" }
      ↓
server.ts case 'SURRENDER':
  1. Determines opponent index
  2. Sends DUEL_END to BOTH players: { type: 'DUEL_END', winner: opponentIndex, reason: 'surrender' }
  3. Terminates worker thread
      ↓
Client receives DUEL_END → duelResult() signal fires
      ↓
Existing effect: POST /api/rooms/{roomId}/end → room marked ENDED
```

**No server changes needed. No protocol changes needed. This is a pure frontend story.**

### Critical: Mini-Toolbar During Active Prompt (UX Spec)

The mini-toolbar (surrender + toggle) drops **below** the sheet z-index during active prompts (Patterns B/C). It is visually dimmed and non-interactive — the player must first collapse the sheet (via ▼ collapse handle) to access it. Flow: collapse handle (▼) → board visible → toolbar accessible → surrender → confirmation dialog. This adds **intentional friction** for destructive actions.

Current z-layers (`_z-layers.scss`):
- `$z-pvp-prompt-sheet: 80` — prompt sheet
- `$z-pvp-mini-toolbar: 55` — mini-toolbar (below prompt sheet)

The mini-toolbar is already at lower z-index. The surrender confirmation `mat-dialog` appears at CDK overlay z-index (Material default, above everything except result overlay).

### Critical: CanDeactivate Guard Pattern

Use the same pattern as `unsavedChangesGuard` already in `app.routes.ts` for deck builder. The existing guard pattern:
```typescript
// app.routes.ts already uses canDeactivate: [unsavedChangesGuard]
```

For the duel page, create a functional guard (Angular 15+ style). The guard needs access to the component to check `roomState()` and open the dialog. Use `CanDeactivateFn<DuelPageComponent>`:

```typescript
export const duelSurrenderGuard: CanDeactivateFn<DuelPageComponent> = (component) => {
  if (component.roomState() !== 'active') return true;
  return component.confirmSurrender(); // Returns Observable<boolean>
};
```

Register in `app.routes.ts`: `canDeactivate: [duelSurrenderGuard]`

### Critical: Prompt Dismiss on Surrender

Do NOT manually clear `pendingPrompt()` when surrendering. The server discards the unanswered `SELECT_*` upon receiving `SURRENDER`, and the `DUEL_END` handler on the client already closes all prompts instantly (UX spec: "Duel End Interrupts All"). No `clearPendingPrompt()` method exists on `DuelWebSocketService` and none is needed.

### Critical: Dialog Pattern (Inline, Not Standalone Component)

Use `MatDialog.open()` with a template ref or a simple inline component. Since the dialog is a basic confirm/cancel with no complex logic:

**Recommended approach — TemplateRef dialog**:
```typescript
@ViewChild('surrenderDialog') surrenderDialogTpl!: TemplateRef<void>;

onSurrenderClick(): void {
  const dialogRef = this.dialog.open(this.surrenderDialogTpl, {
    role: 'alertdialog',
    ariaLabel: 'Surrender confirmation',
    width: '320px',
  });
  dialogRef.afterClosed().subscribe(confirmed => {
    if (confirmed) this.wsService.sendSurrender();
  });
}
```

Template:
```html
<ng-template #surrenderDialog>
  <h2 mat-dialog-title>Abandon the duel?</h2>
  <mat-dialog-content>This will count as a loss.</mat-dialog-content>
  <mat-dialog-actions align="end">
    <button mat-button [mat-dialog-close]="false">Cancel</button>
    <button mat-button color="warn" [mat-dialog-close]="true">Surrender</button>
  </mat-dialog-actions>
</ng-template>
```

**Alternative — if the CanDeactivate guard also needs the dialog**: Extract dialog opening to a shared method `confirmSurrender()` that returns `Observable<boolean>`, reused by both `onSurrenderClick()` and the guard. This is the better approach for code reuse.

### Critical: CanDeactivate Guard — Waiting for DUEL_END

After confirming surrender in the guard, the navigation must wait for `duelResult()` to fire before proceeding. Use `toObservable()` from `@angular/core/rxjs-interop` to bridge the signal to RxJS:

```typescript
confirmSurrender(): Observable<boolean> {
  const dialogRef = this.dialog.open(this.surrenderDialogTpl, { ... });
  return dialogRef.afterClosed().pipe(
    switchMap(confirmed => {
      if (!confirmed) return of(false);
      this.wsService.sendSurrender();
      return toObservable(this.wsService.duelResult).pipe(
        filter(r => !!r),
        take(1),
        map(() => true),
        timeout(5000),
        catchError(() => of(true)), // WS dead — allow navigation
      );
    }),
  );
}
```

The 5s timeout prevents the guard from blocking indefinitely if the WebSocket is already closed (server unreachable). In that case, the guard releases navigation — the duel is effectively over.

### Critical: Duel Result Placeholder

Story 3.4 will create `PvpDuelResultOverlayComponent` with full UI (VICTORY/DEFEAT/DRAW text, reason, rematch button, leave room, back to deck). For Story 3.1, implement a **minimal placeholder**:

- When `wsService.duelResult()` is truthy, show an overlay with:
  - "VICTORY" / "DEFEAT" text (compare `duelResult().winner` with own player index)
  - Reason: `duelResult().reason` (e.g., "surrender")
  - "Return to Lobby" button → `router.navigate(['/pvp'])`
- Use `$z-pvp-rps-overlay: 85` or higher for z-index (above prompt sheet)
- Keep it simple — Story 3.4 will replace this entirely

**Own player index**: Determine from `room()` signal — compare `room().player1.username` with logged-in user to get player index (0 or 1). Store as a computed signal.

### What MUST Change (Story 3.1 Scope)

| File | Change | Why |
|------|--------|-----|
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Add `onSurrenderClick()`, `confirmSurrender()`, `duelSurrenderGuard`, player index signal, result placeholder logic | Core surrender UI logic |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Enable surrender button, add dialog template, add result placeholder | Surrender UI |
| `front/src/app/pages/pvp/duel-page/duel-page.component.scss` | Add result placeholder styles | Result overlay styling |
| `front/src/app/app.routes.ts` | Add `canDeactivate: [duelSurrenderGuard]` to pvp/duel route | Navigation guard |

### What NOT to Change

- **No server changes** — `server.ts` already handles SURRENDER
- **No protocol changes** — `ws-protocol.ts` and `duel-ws.types.ts` already have all types
- **No Spring Boot changes** — `/api/rooms/{id}/end` already exists
- **No WebSocket service changes** — `sendSurrender()` already exists
- **No prompt system changes** — client-side dismiss is sufficient
- **No z-layer changes** — existing z-index values are correct
- **No lobby page changes**

### Source Tree — Files to Touch

**MODIFY (4 files):**
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss`
- `front/src/app/app.routes.ts`

**REFERENCE (read-only):**
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` (signals: `pendingPrompt()`, `duelResult()`, `sendSurrender()`)
- `front/src/app/pages/pvp/duel-ws.types.ts` (DuelEndMsg type)
- `front/src/app/pages/pvp/room.types.ts` (RoomDTO for player identification)
- `front/src/app/styles/_z-layers.scss` (existing z-index values)
- `duel-server/src/server.ts` (verify SURRENDER handler, lines 517-525)
- `duel-server/src/ws-protocol.ts` (SurrenderMsg, DuelEndMsg types)

**DO NOT TOUCH:**
- Backend (Spring Boot) — no new endpoints needed
- Duel server — SURRENDER already handled
- ws-protocol.ts / duel-ws.types.ts — types already defined
- DuelWebSocketService — sendSurrender() already exists
- Prompt system components — no changes needed
- Lobby page — no changes needed

### Previous Story Intelligence (Stories 2.1–2.4)

**Reuse These Patterns:**
- `effect()` with `untracked()` for side effects — same pattern for result display
- `displayError()` snackbar before navigation on error — consistent UX
- `MatDialog` usage: see `DeckPickerDialogComponent` from lobby for dialog patterns (though this story uses `TemplateRef` dialog which is simpler)
- Signal-based state machine: `roomState` transitions are clean — add result state handling

**Avoid These (Fixed in Previous Reviews):**
- C1 (Story 2.1): Polling error killed subscription → inner `catchError` (not relevant here but remember the pattern)
- H1 (Story 2.4): Added `prefers-reduced-motion` for spinners — apply to any new animations
- M3 (Story 2.1): `setTimeout` leak → always store ref + cleanup in `destroyRef.onDestroy()`
- M3 (Story 2.4): Separated 15s timeout into its own effect (single responsibility)
- **[class] binding** — NEVER use `[class]`, always `[class.specific-class]`

**Anti-Patterns:**
- Do NOT add unnecessary signals — reuse `wsService.duelResult()` directly
- Do NOT modify DuelWebSocketService — `sendSurrender()` is already there
- Do NOT create new API endpoints — everything exists server-side
- Do NOT create a separate component file for the confirmation dialog — it's 5 lines of template

### Imports Checklist

DuelPageComponent will need these new imports (verify not already present):
- `MatDialogModule` (or `MatDialog`, `MatDialogTitle`, `MatDialogContent`, `MatDialogActions`, `MatDialogClose`) — for the confirmation dialog
- `ViewChild`, `TemplateRef` — for dialog template ref
- `CanDeactivateFn` — for the guard (exported from component file or co-located)

### Testing Standards

- **No automated tests** — "Big bang" approach per project convention
- **Manual verification** — see Task 6 subtasks for complete checklist

### Project Structure Notes

- All changes within existing file structure — no new files created
- The `duelSurrenderGuard` function is exported from `duel-page.component.ts` (or a co-located file like `duel-page.guard.ts` — developer's choice, both acceptable)
- Surrender dialog template is inline in `duel-page.component.html` (not a separate component)
- Result placeholder is temporary — will be fully replaced by Story 3.4

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md#Story 3.1]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md#FR5 (Surrender)]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Journey 6: Surrender]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Mini-Toolbar Position]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Prompt Always Wins z-index]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Navigation Patterns line 1551]
- [Source: _bmad-output/implementation-artifacts/2-4-deep-links-sharing-duel-loading-screen.md#Dev Notes]
- [Source: _bmad-output/implementation-artifacts/epic-2-retro-2026-02-28.md#Action Items]
- [Source: duel-server/src/ws-protocol.ts#SurrenderMsg, DuelEndMsg]
- [Source: duel-server/src/server.ts#SURRENDER handler]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts#sendSurrender]
- [Source: front/src/app/pages/pvp/duel-page/duel-page.component.html#mini-toolbar]
- [Source: front/src/app/styles/_z-layers.scss#PvP layers]
- [Source: front/src/app/app.routes.ts#pvp routes]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No debug issues encountered. Build passed on first attempt.

### Completion Notes List

- Enabled surrender button by removing `disabled` attribute and adding `(click)="onSurrenderClick()"` handler
- Created inline surrender confirmation dialog using `<ng-template #surrenderDialog>` with `MatDialog.open()` — `role: 'alertdialog'`, `ariaLabel: 'Surrender confirmation'`, `width: '320px'`
- Implemented shared `confirmSurrender()` method returning `Observable<boolean>` — reused by both `onSurrenderClick()` and the CanDeactivate guard
- Used `toObservable(wsService.duelResult)` (created as class field in injection context) with `filter`, `take(1)`, `timeout(5000)`, `catchError(() => of(true))` to wait for DUEL_END before allowing navigation
- CanDeactivate guard implemented as inline function in `app.routes.ts` (avoids breaking lazy-loading of DuelPageComponent). Typed guard also exported from component file for reference.
- Added `ownPlayerIndex` computed signal (compares `authService.user().id` with `room().player1.id`)
- Added `resultOutcome` computed signal for VICTORY/DEFEAT display
- Result overlay placeholder: full-screen overlay at z-index `$z-pvp-rps-overlay + 5` (90), "Return to Lobby" button navigates to `/pvp`
- No server, protocol, WS service, or z-layer changes needed — pure frontend story
- No new files created — all changes in existing files
- No animations added → no `prefers-reduced-motion` concerns (Epic 3 target: 0 motion findings)

### Implementation Plan

1. Task 1: Removed `disabled`, added click handler on surrender button, verified 44px touch target via existing `mini-toolbar__btn` SCSS
2. Task 2-3: Created `<ng-template #surrenderDialog>` in HTML, added `MatDialogTitle/Content/Actions/Close` imports, implemented `onSurrenderClick()` and `confirmSurrender()` in TS
3. Task 4: Exported `duelSurrenderGuard` from component TS, registered inline guard on `pvp/duel/:roomCode` route in `app.routes.ts`
4. Task 5: Added `ownPlayerIndex` and `resultOutcome` computed signals, result overlay template with VICTORY/DEFEAT text + reason + Return to Lobby button, SCSS styles for `.result-overlay`
5. Task 6: Code-level verification of all 9 subtasks against implementation

### File List

- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` (modified)
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` (modified)
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss` (modified)
- `front/src/app/app.routes.ts` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

## Change Log

- **2026-02-28**: Story 3.1 Surrender — Implemented surrender button, confirmation dialog, CanDeactivate navigation guard, and placeholder duel result overlay. Pure frontend story, no backend/protocol changes.
- **2026-02-28**: Code Review (AI) — 8 issues found and fixed: H1 (AC5 surrender inaccessible during collapsed prompt — added sheetExpanded output), H2 (draw shows DEFEAT — added draw outcome handling), M1 (guard triggers after duel end — added duelResult check), M2 (dead duelSurrenderGuard export — removed), M3 (inline z-index arithmetic — added $z-pvp-result-overlay), L1 (double-tap protection — added surrenderDialogOpen flag), L2 (missing disableClose: false), L3 (mini-toolbar transition prefers-reduced-motion).
