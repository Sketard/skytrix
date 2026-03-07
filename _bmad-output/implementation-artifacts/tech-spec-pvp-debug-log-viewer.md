---
title: 'PvP Debug Log Viewer'
slug: 'pvp-debug-log-viewer'
created: '2026-03-03'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Angular 19.1.3', 'Angular Material 19.1.1', 'TypeScript 5.5.4', 'SCSS with centralized z-layers']
files_to_modify:
  - 'front/src/app/pages/pvp/duel-page/debug-log-formatter.ts (new)'
  - 'front/src/app/pages/pvp/duel-page/debug-log.service.ts (new)'
  - 'front/src/app/pages/pvp/duel-page/debug-log-panel/debug-log-panel.component.ts (new)'
  - 'front/src/app/pages/pvp/duel-page/debug-log-panel/debug-log-panel.component.scss (new)'
  - 'front/src/app/pages/pvp/duel-page/debug-log-panel/debug-log-panel.component.html (new)'
  - 'front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts'
  - 'front/src/app/pages/pvp/duel-page/duel-page.component.ts'
  - 'front/src/app/pages/pvp/duel-page/duel-page.component.html'
  - 'front/src/app/pages/pvp/duel-page/duel-page.component.scss'
  - 'front/src/app/styles/_z-layers.scss'
code_patterns:
  - 'Angular signals (signal(), computed(), asReadonly())'
  - 'Standalone components with OnPush change detection'
  - 'Component-scoped services (@Injectable() provided at component level)'
  - 'signal-based inputs: input<T>() / output<T>() — NOT @Input/@Output'
  - 'Prettier: single quotes, 2-space indent, trailing comma es5, printWidth 120'
  - 'Z-index via @use z-layers as z — tokens in _z-layers.scss'
  - 'SCSS BEM naming (.block__element--modifier)'
test_patterns: ['Big bang — no automated tests until full MVP']
---

# Tech-Spec: PvP Debug Log Viewer

**Created:** 2026-03-03

## Overview

### Problem Statement

During PvP duels, there is zero visibility into the game state changes happening over WebSocket. Debugging requires reading raw console output, which is impractical for understanding game flow, verifying prompt/response sequences, and diagnosing issues.

### Solution

Add a debug log panel accessible via a FAB button during PvP duels. The panel displays human-readable logs of all game events, prompts received, and player responses. Card names are proactively resolved via `CardDataCacheService` (display cardCode first, update with name once resolved). The feature is hidden in production behind the `environment.production` flag.

### Scope

**In Scope:**
- Intercept all WS messages in `DuelWebSocketService` and transform them into human-readable log entries
- Proactive card name resolution via `CardDataCacheService` (code-first, name-update pattern)
- Log prompts received and player responses sent
- FAB button to toggle a debug log panel
- Hidden in production (`environment.production === true` → no FAB, no logging)
- Excluded messages: `TIMER_STATE`, `SESSION_TOKEN` (noise)

**Out of Scope:**
- Debug solo mode (play as both players)
- Log export
- Performance metrics / latency tracking
- Session replay
- Card name preloading at duel start

## Context for Development

### Codebase Patterns

- All components are standalone with `changeDetection: OnPush`
- State management via Angular signals (`signal()`, `computed()`, `asReadonly()`)
- `DuelWebSocketService` is scoped to `DuelPageComponent` (not root-provided)
- `CardDataCacheService` is also scoped to `DuelPageComponent`, exposes `getCardData(cardCode): Promise<SharedCardInspectorData>` with in-memory `Map<number, SharedCardInspectorData>` cache
- Environment files control prod/dev behavior (`environment.production`)
- Kebab-case file names, PascalCase class names, suffixed (`.service.ts`, `.component.ts`)

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` | WS message handling — intercept point for log capture |
| `front/src/app/pages/pvp/duel-page/card-data-cache.service.ts` | Card name resolution cache (`getCardData(cardCode)`) |
| `front/src/app/pages/pvp/duel-ws.types.ts` | All ServerMessage / ClientMessage type definitions |
| `front/src/app/pages/pvp/duel-page/idle-action-codes.ts` | IDLE_ACTION / BATTLE_ACTION code-to-label mapping |
| `front/src/app/pages/pvp/pvp-zone.utils.ts` | `locationToZoneId()` for zone label resolution |
| `front/src/app/pages/pvp/pvp-card.utils.ts` | `isFaceUp()`, `isDefense()` position helpers |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Host component — FAB + panel integration point |
| `front/src/environments/environment.ts` | Dev environment (production: false) |
| `front/src/environments/environment.prod.ts` | Prod environment (production: true) |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Template — FAB goes next to `.mini-toolbar` (line 203), panel as sibling |
| `front/src/app/pages/pvp/duel-page/duel-page.component.scss` | Styles — existing z-index tokens, BEM naming |
| `front/src/app/styles/_z-layers.scss` | Z-index tokens — add `$z-pvp-debug-panel: 58` (between mini-toolbar:55 and floating-instruction:60) |
| `_bmad-output/project-context.md` | Project rules: standalone, OnPush, signal inputs, Prettier config |

### Anchor Points (from Deep Investigation)

- **WS intercept**: `DuelWebSocketService.handleMessage()` line 163 — single call to `this.debugLog.logServerMessage(message)` at top
- **Response intercept**: `DuelWebSocketService.sendResponse()` line 62 — call `this.debugLog.logPlayerResponse(promptType, data)` as first line of method body (the `safeSend` is inside an `if` condition, not a standalone statement)
- **Provider registration**: `DuelPageComponent` `providers` array line 42 — add `DebugLogService`
- **Template FAB + panel**: inside the outer `@if (roomState() === 'active' || roomState() === 'connecting')` block (line 110), after the prompt sheet (line 333), guarded by `@if (!isProduction)`. Placed at this level (not inside the inner `active`-only block) so logs are visible during RPS/connecting phases.
- **Z-index slot**: `$z-pvp-debug-panel: 58` — between mini-toolbar (55) and floating-instruction (60)
- **Card name API**: `CardDataCacheService.getCardData(cardCode)` → `Promise<SharedCardInspectorData>` with `.name` field. Errors not cached.
- **Rematch cleanup**: `clearCache()` already called on rematch (effect line 365) — add `this.debugLog.clearLogs()` in the same `untracked()` block

### Technical Decisions

- **Environment guard, not feature flag:** Use existing `environment.production` to gate the feature. No new configuration surface needed.
- **Proactive name resolution:** On each message with a `cardCode`, call `CardDataCacheService.getCardData()`. Cache hit = free, cache miss = 1 HTTP call. Log entry updates reactively once name resolves.
- **Signal-based log list:** Use a `WritableSignal<DebugLogEntry[]>` to store log entries. The panel component reads it reactively.
- **Separate service:** Create a dedicated `DebugLogService` (scoped to `DuelPageComponent`) to avoid bloating `DuelWebSocketService` or the god component further.
- **Separate formatter:** Three pure functions in `debug-log-formatter.ts`: `formatServerMessage(msg)`, `extractCardCodes(msg)`, `formatPlayerResponse(promptType, data)`. No side effects, keeps service lean.
- **No artificial cap:** No max log entries. Provide a "Clear" button instead. In debug sessions, losing early messages is worse than marginal memory usage.
- **Intercept via direct injection:** `DuelWebSocketService` injects `DebugLogService` and calls it at 2 points: `handleMessage()` for server messages, `sendResponse()` for player responses. In prod, the service is a no-op (guard in constructor). No circular dependency risk (`CardDataCacheService` only depends on `HttpClient`).
- **UI panel:** `position: fixed; right: 0` panel with CSS `transform: translateX()` slide-in transition — avoids `MatSidenav`/`MatSidenavContainer` which would require restructuring the duel-page template. FAB in bottom-left corner. Smart auto-scroll: only scrolls to bottom if the user is already near the bottom (within ~50px threshold); if user scrolled up to read older entries, new messages do not force scroll. Width `min(380px, 90vw)` for mobile compatibility. Z-index above board but below Material overlays (dialogs, snackbars).
- **Color-coded entries:** Game events = neutral, prompts = blue, responses = green, system = grey.
- **Exclusions:** Only `TIMER_STATE` and `SESSION_TOKEN` are excluded. All other system messages (`OPPONENT_DISCONNECTED`, `OPPONENT_RECONNECTED`, `DUEL_END`, etc.) are logged — they provide crucial debug context.
- **DebugLogEntry model:** Minimal `{ timestamp: number; category: 'event' | 'prompt' | 'response' | 'system'; text: string }`. Card names update via immutable replacement: create a new `{ ...entry, text: newText }` object and replace the entry in the array, then set the signal to a new array. Never mutate the existing entry object in-place (OnPush hygiene).
- **Batched card name resolution:** When a message contains multiple cardCodes, use `Promise.all` to resolve all names in one batch, then perform a single signal `.set()` update. This avoids N successive change detections for a single message.

### API Surface (from Party Mode review)

**`debug-log-formatter.ts`** (pure functions):
- `formatServerMessage(msg: ServerMessage): string` — human-readable text with `[cardCode]` placeholders
- `extractCardCodes(msg: ServerMessage): number[]` — all cardCodes to resolve from a message
- `formatPlayerResponse(promptType: string, data: Record<string, unknown>): string` — human-readable response text (uses type narrowing internally per promptType)

**`DebugLogService`** (component-scoped):
- `logServerMessage(msg: ServerMessage): void` — called by WS service in `handleMessage()`
- `logPlayerResponse(promptType: string, data: Record<string, unknown>): void` — called by WS service in `sendResponse()`
- `clearLogs(): void` — called on rematch
- `readonly entries: Signal<DebugLogEntry[]>` — consumed by panel component
- `readonly panelOpen: WritableSignal<boolean>` — toggled by FAB

**`DebugLogEntry`** (interface):
```
{ timestamp: number; category: 'event' | 'prompt' | 'response' | 'system'; text: string }
```

## Implementation Plan

### Tasks

- [x] Task 1: Add z-index token
  - File: `front/src/app/styles/_z-layers.scss`
  - Action: Add `$z-pvp-debug-panel: 58;` between `$z-pvp-mini-toolbar: 55` and `$z-pvp-floating-instruction: 60`

- [x] Task 2: Create `debug-log-formatter.ts`
  - File: `front/src/app/pages/pvp/duel-page/debug-log-formatter.ts` (new)
  - Action: Implement three pure functions:
    - `formatServerMessage(msg: ServerMessage): string | null` — switch on `msg.type`, narrow to specific message type, return human-readable string. **Important:** After narrowing, access fields on the specific type (e.g., for `BOARD_STATE`, access `msg.data.turnCount` not `msg.turnCount` — the payload is wrapped in `data: BoardStatePayload`). Use `locationToZoneId()` for zone labels, `isFaceUp()`/`isDefense()` for position labels. Card codes formatted as `[cardCode]`. Skip `TIMER_STATE` and `SESSION_TOKEN` (return `null`).
    - `extractCardCodes(msg: ServerMessage): number[]` — extract all non-null, non-zero cardCodes from each message type. Sources vary by type — after type narrowing: `msg.cardCode` (direct field), `msg.cards` (varies: `CardInfo[]` with `.cardCode` on `MSG_CONFIRM_CARDS` vs `(number | null)[]` raw codes on `MSG_DRAW`/`MSG_SHUFFLE_HAND`), `msg.card1.cardCode`/`msg.card2.cardCode` on `MSG_SWAP`, `msg.summons[].cardCode`/`msg.spSummons[].cardCode`/`msg.activations[].cardCode` on prompts. Return `[]` for messages with no individual card codes: `BOARD_STATE`, `STATE_SYNC`, `MSG_CHAIN_END`, `MSG_CHAIN_SOLVING`, `MSG_CHAIN_SOLVED`, `MSG_SHUFFLE_HAND`, `MSG_HINT`, `MSG_BATTLE`, `MSG_WIN`, and all system messages. Only extract codes for messages whose format string contains `[cardCode]` placeholders.
    - `formatPlayerResponse(promptType: string, data: Record<string, unknown>): string` — switch on promptType, narrow `data` via type guards/casts per case, return readable string. Use `IDLE_ACTION`/`BATTLE_ACTION` labels for IDLECMD/BATTLECMD responses. RPS: 1=Scissors, 2=Rock, 3=Paper.
  - Notes: Import `ServerMessage` from `../duel-ws.types`, `locationToZoneId` from `../pvp-zone.utils`, `isFaceUp`/`isDefense` from `../pvp-card.utils`, `IDLE_ACTION`/`BATTLE_ACTION` from `./idle-action-codes`. Export `DebugLogEntry` interface from this file. `data` is typed as `Record<string, unknown>` to match the `ResponseData` type from `sendResponse`. Access properties directly (e.g., `data['index']`, `data['response']`) and cast as needed per promptType case. Complete message-to-text mapping:

    **Game events:**
    | Type | Format |
    |------|--------|
    | `BOARD_STATE` | `Turn {msg.data.turnCount} — P{msg.data.turnPlayer+1}, Phase: {msg.data.phase}` (fields on `msg.data`, not `msg`) |
    | `STATE_SYNC` | `State resynchronized` |
    | `MSG_DRAW` | `P{p+1} drew {n} card(s)` |
    | `MSG_MOVE` | `P{p+1}: [{cardCode}] {fromZone} → {toZone} ({position})` |
    | `MSG_DAMAGE` | `P{p+1} took {amount} damage` |
    | `MSG_RECOVER` | `P{p+1} recovered {amount} LP` |
    | `MSG_PAY_LPCOST` | `P{p+1} paid {amount} LP` |
    | `MSG_CHAINING` | `Chain {chainIndex+1}: [{cardCode}] activated by P{p+1}` |
    | `MSG_CHAIN_SOLVING` | `Resolving chain link {chainIndex+1}` |
    | `MSG_CHAIN_SOLVED` | `Chain link {chainIndex+1} resolved` |
    | `MSG_CHAIN_END` | `Chain resolved completely` |
    | `MSG_HINT` | `Hint: type={hintType}, value={value}, P{p+1}` |
    | `MSG_CONFIRM_CARDS` | `P{p+1} confirmed {n} card(s)` |
    | `MSG_SHUFFLE_HAND` | `P{p+1} hand shuffled` |
    | `MSG_FLIP_SUMMONING` | `P{p+1}: [{cardCode}] flip summoned at {zone}` |
    | `MSG_CHANGE_POS` | `P{p+1}: [{cardCode}] changed position ({prev} → {curr})` |
    | `MSG_SWAP` | `Cards swapped: [{card1Code}] ↔ [{card2Code}]` |
    | `MSG_ATTACK` | `P{attackerPlayer+1} M{attackerSequence+1} attacks P{defenderPlayer+1} M{defenderSequence+1}` or `P{attackerPlayer+1} M{attackerSequence+1} direct attack` (detect direct attack via `defenderPlayer === null`) |
    | `MSG_BATTLE` | `Battle: P{atk+1} ({atkDmg}) vs P{def+1} ({defDmg})` |
    | `MSG_WIN` | `P{p+1} wins! (reason: {reason})` |

    **Prompts:**
    | Type | Format |
    |------|--------|
    | `SELECT_IDLECMD` | `P{p+1} prompt: Idle command ({n} summons, {n} sps, {n} activations...)` |
    | `SELECT_BATTLECMD` | `P{p+1} prompt: Battle command ({n} attacks, {n} activations)` |
    | `SELECT_CARD` | `P{p+1} prompt: Select {min}-{max} card(s) from {n} options` |
    | `SELECT_CHAIN` | `P{p+1} prompt: Chain? ({n} options, forced={forced})` |
    | `SELECT_EFFECTYN` | `P{p+1} prompt: Activate [{cardCode}] effect?` |
    | `SELECT_YESNO` | `P{p+1} prompt: Yes/No (desc={description})` |
    | `SELECT_PLACE` | `P{p+1} prompt: Select {count} zone(s)` |
    | `SELECT_DISFIELD` | `P{p+1} prompt: Select {count} field zone(s) to disable` |
    | `SELECT_POSITION` | `P{p+1} prompt: Choose position for [{cardCode}]` |
    | `SELECT_OPTION` | `P{p+1} prompt: Choose from {n} options` |
    | `SELECT_TRIBUTE` | `P{p+1} prompt: Tribute {min}-{max} from {n} cards` |
    | `SELECT_SUM` | `P{p+1} prompt: Select cards for sum ({n} options)` |
    | `SELECT_UNSELECT_CARD` | `P{p+1} prompt: Select/unselect from {n} cards` |
    | `SELECT_COUNTER` | `P{p+1} prompt: Distribute {count} counters on {n} cards` |
    | `SORT_CARD` | `P{p+1} prompt: Sort {n} cards (auto-selected)` |
    | `SORT_CHAIN` | `P{p+1} prompt: Sort chain {n} cards (auto-selected)` |
    | `ANNOUNCE_RACE` | `P{p+1} prompt: Announce {count} type(s)` |
    | `ANNOUNCE_ATTRIB` | `P{p+1} prompt: Announce {count} attribute(s)` |
    | `ANNOUNCE_CARD` | `P{p+1} prompt: Announce card (auto-selected)` |
    | `ANNOUNCE_NUMBER` | `P{p+1} prompt: Announce number from {n} options` |
    | `RPS_CHOICE` | `P{p+1} prompt: Rock-Paper-Scissors` |

    **System messages:**
    | Type | Format |
    |------|--------|
    | `DUEL_END` | `Duel ended — Winner: P{w+1} ({reason})` or `Duel ended — Draw ({reason})` |
    | `RPS_RESULT` | `RPS result: P1={label}, P2={label} → Winner: P{w+1}` (map `player1Choice`/`player2Choice` via 1=Scissors, 2=Rock, 3=Paper) |
    | `OPPONENT_DISCONNECTED` | `Opponent disconnected` |
    | `OPPONENT_RECONNECTED` | `Opponent reconnected` |
    | `REMATCH_INVITATION` | `Rematch invitation received` |
    | `REMATCH_STARTING` | `Rematch starting...` |
    | `REMATCH_CANCELLED` | `Rematch cancelled ({reason})` |
    | `WORKER_ERROR` | `Worker error: {msg.message}` |
    | `TIMER_STATE` | _(skip — return null)_ |
    | `SESSION_TOKEN` | _(skip — return null)_ |

    **Player responses:**
    | promptType | Format |
    |------------|--------|
    | `SELECT_IDLECMD` | `→ Response: {action_label} (index {index})` using IDLE_ACTION labels |
    | `SELECT_BATTLECMD` | `→ Response: {action_label} (index {index})` using BATTLE_ACTION labels |
    | `SELECT_CARD` / `SELECT_TRIBUTE` / `SELECT_SUM` | `→ Response: selected {n} card(s)` |
    | `SELECT_CHAIN` | `→ Response: chain index {index}` or `→ Response: pass` |
    | `SELECT_EFFECTYN` / `SELECT_YESNO` | `→ Response: Yes` or `→ Response: No` |
    | `SELECT_PLACE` / `SELECT_DISFIELD` | `→ Response: placed at {zone(s)}` |
    | `SELECT_POSITION` | `→ Response: {position_label}` |
    | `SELECT_OPTION` | `→ Response: option {index}` |
    | `SELECT_COUNTER` | `→ Response: distributed counters` |
    | `SELECT_UNSELECT_CARD` | `→ Response: selected index {index}` or `→ Response: finished` |
    | `SORT_CARD` / `SORT_CHAIN` | `→ Response: auto-sorted` |
    | `ANNOUNCE_RACE` / `ANNOUNCE_ATTRIB` / `ANNOUNCE_CARD` / `ANNOUNCE_NUMBER` | `→ Response: announced {value}` |
    | `RPS_CHOICE` | `→ Response: {Rock/Paper/Scissors}` (1=Scissors, 2=Rock, 3=Paper) |

- [x] Task 3: Create `DebugLogService`
  - File: `front/src/app/pages/pvp/duel-page/debug-log.service.ts` (new)
  - Action: Create `@Injectable()` service with:
    - Constructor: inject `CardDataCacheService`. Check `environment.production` — if true, set `private readonly enabled = false` and all methods become no-ops.
    - `private _entries = signal<DebugLogEntry[]>([])` + `readonly entries = this._entries.asReadonly()`
    - `readonly panelOpen = signal(false)`
    - `logServerMessage(msg: ServerMessage)`: if not enabled, return. Call `formatServerMessage(msg)` — if null (excluded type), return. Determine category from msg.type (`event` for game events, `prompt` for SELECT_*/ANNOUNCE_*/SORT_*/RPS_CHOICE, `system` for DUEL_END/RPS_RESULT/OPPONENT_*/REMATCH_*). Create entry with `Date.now()` timestamp. Append to signal. Then call `extractCardCodes(msg)` — if codes.length > 0, use `Promise.all(codes.map(c => cardDataCache.getCardData(c).catch(() => null)))` to batch-resolve all card names. On resolve, find the entry in the current entries array, build a new text by replacing each `[{code}]` with `{data.name} [{code}]` for each successful resolve, create a new entry object `{ ...entry, text: newText }`, replace the entry in the array, and `.set()` the signal to the new array (single update, immutable replacement — never mutate entry in-place).
    - `logPlayerResponse(promptType, data)`: if not enabled, return. Call `formatPlayerResponse(promptType, data)`. Create entry with category `'response'`, append to signal.
    - `clearLogs()`: set `_entries` to `[]`.
  - Notes: Import `environment` from `../../../../environments/environment`.

- [x] Task 4: Create `DebugLogPanelComponent`
  - File: `front/src/app/pages/pvp/duel-page/debug-log-panel/debug-log-panel.component.ts` (new)
  - File: `front/src/app/pages/pvp/duel-page/debug-log-panel/debug-log-panel.component.html` (new)
  - File: `front/src/app/pages/pvp/duel-page/debug-log-panel/debug-log-panel.component.scss` (new)
  - Action: Create standalone component with OnPush. Inputs: `entries` via `input<DebugLogEntry[]>()`, `open` via `input<boolean>()`. Output: `closed` via `output<void>()`, `clearRequested` via `output<void>()`.
  - Template: Fixed-position panel on the right. Header with title "Debug Logs", close button (X), clear button (trash icon). Scrollable list of entries. Each entry shows timestamp (HH:mm:ss.SSS), colored dot by category, and text. Smart auto-scroll: on new entries, check if the scroll container's `scrollTop + clientHeight >= scrollHeight - 50` (user is near bottom); if yes, scroll to bottom; if no (user scrolled up to read), do not force scroll. Use an `effect` watching `entries().length` to trigger the check. Panel visibility controlled by `open` input + CSS `transform: translateX(100%)` / `translateX(0)`.
  - Styles: `position: fixed; top: 0; right: 0; bottom: 0; width: min(380px, 90vw);` Dark theme matching duel page (`background: #16213e`). Use `@use 'z-layers' as z` and `z-index: z.$z-pvp-debug-panel`. Category colors: event=`#ccc`, prompt=`#64b5f6`, response=`#81c784`, system=`#bdbdbd`. Monospace font for log text. Transition: `transform 200ms ease`. `@media (prefers-reduced-motion: reduce)` disables transition.

- [x] Task 5: Wire `DebugLogService` into `DuelWebSocketService`
  - File: `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
  - Action:
    - Add `import { DebugLogService } from './debug-log.service';` and `private readonly debugLog = inject(DebugLogService);`
    - In `handleMessage()` (line 163), add as first line: `this.debugLog.logServerMessage(message);`
    - In `sendResponse()` (line 62), add as the **first line of the method body** (before the `if (this.safeSend(...))` conditional): `this.debugLog.logPlayerResponse(promptType, data);`

- [x] Task 6: Integrate into `DuelPageComponent`
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
  - Action:
    - Add `DebugLogService` to `providers` array (line 42)
    - Add `DebugLogPanelComponent` to `imports` array (line 46)
    - Add `import { environment } from '../../../../environments/environment';`
    - Add `readonly debugLog = inject(DebugLogService);` (only needed if FAB directly calls `debugLog.panelOpen`)
    - Add `readonly isProduction = environment.production;`
    - In the rematch effect (line 365), the existing `untracked()` contains a single-expression arrow: `untracked(() => this.cardDataCache.clearCache())`. Restructure to block-body arrow and add `clearLogs()`: `untracked(() => { this.cardDataCache.clearCache(); this.debugLog.clearLogs(); })`

- [x] Task 7: Add FAB and panel to template
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.html`
  - Action: Inside the parent `@if (roomState() === 'active' || roomState() === 'connecting')` block (line 110), but **outside** the inner `@if (roomState() === 'active')` block. The inner `active`-only block closes at line 334 (`}`). Insert the debug markup **between line 334** (closing `}` of inner active block) **and line 336** (surrender dialog `<ng-template>`), which is still inside the outer `active || connecting` block. This ensures debug logs are available during RPS/connecting phases too (system messages like `RPS_RESULT`, `OPPONENT_DISCONNECTED` arrive before state becomes `active`):
    ```html
    @if (!isProduction) {
      <button class="debug-fab"
              aria-label="Toggle debug logs"
              (click)="debugLog.panelOpen.set(!debugLog.panelOpen())">
        <mat-icon>bug_report</mat-icon>
      </button>
      <app-debug-log-panel [entries]="debugLog.entries()"
                            [open]="debugLog.panelOpen()"
                            (closed)="debugLog.panelOpen.set(false)"
                            (clearRequested)="debugLog.clearLogs()" />
    }
    ```

- [x] Task 8: Add FAB and panel styles
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.scss`
  - Action: Add `.debug-fab` styles:
    ```scss
    .debug-fab {
      position: absolute;
      bottom: calc(var(--pvp-hand-card-height) + 8px);
      left: max(8px, env(safe-area-inset-left, 8px));
      z-index: z.$z-pvp-mini-toolbar;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    }
    ```
  - Notes: FAB goes bottom-LEFT to avoid collision with mini-toolbar on bottom-right. Uses same z-index as mini-toolbar.

### Acceptance Criteria

- [ ] AC 1: Given a dev environment (`environment.production === false`) and a duel in `active` or `connecting` state, when the duel page renders, then a debug FAB button is visible in the bottom-left corner.

- [ ] AC 2: Given a prod environment (`environment.production === true`) and a duel in progress, when the duel page loads, then no debug FAB button is visible and no log interception occurs.

- [ ] AC 3: Given the debug FAB is visible, when the user clicks it, then a panel slides in from the right with title "Debug Logs", a close button, and a clear button.

- [ ] AC 4: Given the debug panel is open, when the user clicks the close button or the FAB again, then the panel slides out to the right.

- [ ] AC 5: Given the debug panel is open and a `BOARD_STATE` message arrives, when the panel renders, then a new entry appears with text like `Turn 3 — P1, Phase: MAIN1` with neutral color.

- [ ] AC 6: Given the debug panel is open and a `MSG_MOVE` message arrives with `cardCode: 46986414`, when the entry first appears, then it shows `P1: [46986414] M3 → GY (face-up)`. After the card name resolves via `CardDataCacheService`, the entry updates to `P1: Dark Magician [46986414] M3 → GY (face-up)`.

- [ ] AC 7: Given the debug panel is open and a `SELECT_IDLECMD` prompt is received, when the entry renders, then it appears with blue color and text like `P1 prompt: Idle command (2 summons, 1 sps, 3 activations...)`.

- [ ] AC 8: Given the player responds to a prompt, when the response is sent, then a green-colored entry appears with text like `→ Response: Normal Summon (index 0)`.

- [ ] AC 9: Given the debug panel is open and a `TIMER_STATE` or `SESSION_TOKEN` message arrives, when the panel renders, then no new entry is created for those message types.

- [ ] AC 10: Given the debug panel has entries, when the user clicks the Clear button, then all entries are removed from the panel.

- [ ] AC 11: Given a duel is in progress and a rematch starts, when the `REMATCH_STARTING` message is received, then all debug log entries are cleared automatically.

- [ ] AC 12: Given the debug panel is open and the user is scrolled to the bottom (within 50px), when new entries are added, then the panel auto-scrolls to show the latest entry. If the user has scrolled up (more than 50px from bottom), new entries do not force scroll.

- [ ] AC 13: Given the debug panel is open and `OPPONENT_DISCONNECTED` message arrives, when the entry renders, then a grey-colored system entry appears with text `Opponent disconnected`.

## Additional Context

### Dependencies

- No new dependencies. Uses existing Angular Material (`MatIcon`) for FAB icon. Panel is plain CSS (position fixed). Injects existing `CardDataCacheService` for card name resolution.

### Testing Strategy

- Big bang approach (no automated tests until full MVP done, per project convention).
- Manual testing steps:
  1. Start a PvP duel in dev mode
  2. Verify FAB appears bottom-left
  3. Click FAB → panel slides in from right
  4. Play a few turns → verify game events, prompts, and responses appear with correct colors
  5. Verify card names resolve (initially `[code]`, then `Name [code]`)
  6. Click Clear → entries cleared
  7. Click close → panel slides out
  8. Build in prod mode → verify no FAB appears

### Notes

- `duel-page.component.ts` is already 1397 lines (god component). The log viewer adds ~5 lines to this component (provider, import, inject, isProduction, clearLogs in rematch effect). All logic stays in `DebugLogService` and `DebugLogPanelComponent`.
- `MSG_HINT` stays technical (OCGCore opaque hint types) — no name resolution needed.
- RPS choices: 1 = Scissors, 2 = Rock, 3 = Paper (from `RpsResponse` type).
- The `formatServerMessage` function returns `string | null` — null means "skip this message" (used for TIMER_STATE, SESSION_TOKEN).
- Position labels for `MSG_CHANGE_POS`: use `isFaceUp()` + `isDefense()` from `pvp-card.utils.ts` to produce `ATK`, `DEF`, `face-down ATK`, `face-down DEF`.
- Location labels for `MSG_MOVE`: use `locationToZoneId()` for field zones (returns a `ZoneId` string like `M3`, `ST2`, `FIELD`). For non-field locations where `locationToZoneId()` returns `null`, build a reverse lookup from the `LOCATION` const in `duel-ws.types.ts`: `{ [LOCATION.HAND]: 'HAND', [LOCATION.DECK]: 'DECK', [LOCATION.GRAVE]: 'GY', [LOCATION.REMOVED]: 'BANISHED', [LOCATION.EXTRA]: 'EXTRA' }`. Export this helper map from the formatter file.

## Review Notes

- Adversarial review completed: 22 findings total
- 10 findings fixed, 12 confirmed noise — zero tech debt
- Resolution approach: auto-fix (6 real) + user-requested full investigation (4 additional)
- Round 1 fixes (F3, F9, F13, F16, F17, F20): exhaustive switch default, log-after-send ordering, MSG_WIN reason labels, type="button", aria-hidden/inert panel, distinct system dot color (#90a4ae)
- Round 2 fixes (F1, F4, F5+F6, F15): DestroyRef guard on async callbacks, SELECT_SUM mustSelect count, scroll cleanup + auto-scroll on panel open, focus-visible on debug FAB
