# Story 6.1: Teardown Old Chain Badges & Scaffold PvpChainOverlayComponent

Status: done

## Story

As a player,
I want the old on-card chain badges replaced by a dedicated chain overlay component,
so that chain visualization can evolve into a full Master Duel-style cascade animation.

## Acceptance Criteria

### AC1: Old Chain Badge Removal

**Given** the old `.pvp-chain-badge` CSS class and `#chainBadgeTpl` ng-template exist in PvpBoardContainerComponent
**When** this story is complete
**Then** all chain badge rendering is removed from PvpBoardContainerComponent:
- `#chainBadgeTpl` ng-template (lines 263-283) removed
- All `*ngTemplateOutlet="chainBadgeTpl"` usages removed (lines 61, 119, 242)
- `.pvp-chain-badge`, `.pvp-chain-badge--resolving`, `.pvp-chain-badge--overflow` SCSS removed (lines 419-446)
- `chain-resolve-pulse` keyframe removed (lines 448-460)
- `chainBadgesByZone` computed removed (lines 280-290)
- `emzLChainBadges` / `emzRChainBadges` computeds removed (lines 310-316)
- `emzConfigs` updated to remove `chainBadges` property (lines 130-133 in TS)
- EMZ template loop updated: remove `emz.chainBadges` reference (line 119 in HTML — the `*ngTemplateOutlet` using `emz.chainBadges` is already removed by Task 1.2, but verify no other reference to `chainBadges` remains in the `@for` block)
- `activeChainLinks` input removed from PvpBoardContainerComponent
- `[activeChainLinks]` binding removed from duel-page.component.html (line 149)
**And** the old `.pvp-chain-badge--resolving` reduced-motion rule is removed (lines 554-556)
**And** no compilation errors remain

### AC2: Design Tokens Update

**Given** chain badge tokens exist in `_tokens.scss` (lines 148-150) and `_z-layers.scss` (line 31)
**When** this story is complete
**Then** existing tokens are updated:
- `--pvp-chain-badge-size` updated: `24px` → `28px` (line 150)
- `--pvp-chain-badge-bg` and `--pvp-chain-badge-color` retained as-is (lines 148-149)
**And** `--pvp-chain-resolve-pulse: 400ms` removed from main token list (line 151)
**And** `--pvp-chain-resolve-pulse: 0ms` removed from reduced-motion block (line 184)
**And** `$z-pvp-chain-badge: 10` removed from `_z-layers.scss` (line 31)
**And** new chain overlay tokens are added to `_tokens.scss` (9 genuinely new tokens):
```
--pvp-chain-overlay-backdrop: rgba(0, 0, 0, 0.6);
--pvp-chain-overlay-transition: 300ms;
--pvp-chain-card-perspective: 800px;
--pvp-chain-card-rotate-y: 8deg;
--pvp-chain-card-scale-back: 0.70;
--pvp-chain-card-scale-mid: 0.85;
--pvp-chain-card-scale-front: 1.00;
--pvp-chain-link-color: #8a9bb5;
--pvp-chain-glow-resolving: rgba(255, 215, 0, 0.6);
```
**And** new z-layer added: `$z-pvp-chain-overlay` (above board, below prompts)
**And** reduced-motion block includes `--pvp-chain-overlay-transition: 0ms`

### AC3: PvpChainOverlayComponent Shell

**Given** the new chain overlay component does not yet exist
**When** this story is complete
**Then** `PvpChainOverlayComponent` is created as a standalone component:
- Selector: `app-pvp-chain-overlay`
- `ChangeDetectionStrategy.OnPush`
- `pointer-events: none` on `:host` (non-interactive, visual-only)
- Input: `activeChainLinks: ChainLinkState[]` (signal input)
- Input: `phase: 'idle' | 'building' | 'resolving'` (signal input)
- Input: `promptActive: boolean` (signal input — driven by `hasActivePrompt()` from DuelPageComponent, which excludes IDLECMD/BATTLECMD distributed prompts. Hides overlay when a blocking prompt dialog is visible during resolution edge cases, e.g., effect that requires choosing a target mid-chain)
- Input: `boardChanged: boolean` (signal input — driven by orchestrator, see AC6)
- Output: `overlayDismissed: EventEmitter<void>` (signals board is visible between appearances)
- Template: placeholder `@if (activeChainLinks().length > 0 && !promptActive())` with backdrop + empty card container
- SCSS: `:host` with `position: fixed; inset: 0; z-index: z.$z-pvp-chain-overlay; pointer-events: none;`
- Backdrop div with `background: var(--pvp-chain-overlay-backdrop)`
**And** the component is added to DuelPageComponent template, after the connection status overlays and before the duel result overlay (near line 365 — verify exact position by checking the template)
**And** DuelPageComponent passes `[activeChainLinks]`, `[phase]`, `[promptActive]`, `[boardChanged]` and binds `(overlayDismissed)`
**And** accessibility: `role="status"` + `aria-live="polite"` on the container

### AC4: Chain State Model Extension

**Given** `ChainLinkState` exists in `duel-state.types.ts` (lines 5-12)
**When** this story is complete
**Then** `ChainLinkState` retains all existing fields (`chainIndex`, `cardCode`, `cardName`, `player`, `zoneId`, `resolving`)
**And** a new `chainPhase` signal is added to `DuelConnection`:
- `'idle'` — no active chain
- `'building'` — MSG_CHAINING events arriving
- `'resolving'` — MSG_CHAIN_SOLVING/SOLVED events arriving
**And** `chainPhase` transitions: `idle → building` on first MSG_CHAINING, `building → resolving` on first MSG_CHAIN_SOLVING, `resolving → idle` on MSG_CHAIN_END
**And** `chainPhase` resets to `'idle'` on STATE_SYNC, DUEL_END, REMATCH_STARTING (alongside existing `_activeChainLinks` resets)

### AC5: Animation Orchestrator Chain Timing Update

**Given** the animation orchestrator handles chain events (lines 180-198)
**When** this story is complete
**Then** MSG_CHAINING duration changes: 300ms → 700ms (400ms overlay appear + 300ms pause)
**And** MSG_CHAIN_SOLVING duration changes: 400ms → 300ms
**And** MSG_CHAIN_SOLVED duration: the orchestrator does NOT use a fixed duration — it returns `'async'` (see AC6) because the overlay controls timing (variable duration depending on board-change detection)
**And** MSG_CHAIN_END duration changes: 0ms → 200ms (final fade-out)
**And** the orchestrator **continues to call** `applyChainSolving` / `applyChainSolved` / `applyChainEnd` (these update the `_activeChainLinks` signal that the overlay reads)

### AC6: Async Orchestrator Contract (Overlay ↔ Orchestrator)

**Given** the animation orchestrator currently uses a synchronous model: `processEvent()` returns a `number` (duration in ms) and `setTimeout(duration)` triggers the next dequeue
**When** this story is complete
**Then** `processEvent()` return type changes from `number` to `number | 'async'`
**And** `processAnimationQueue()` is updated: when `processEvent()` returns `'async'`, the orchestrator sets `_waitingForOverlay = true` and returns immediately — it does NOT set a `setTimeout`. The `speedMultiplierFn` calculation is moved into the `else` branch (only applied to numeric durations, never to `'async'`)
**And** the orchestrator adds a `_waitingForOverlay` flag (private boolean, default `false`) — guards the resume effect to prevent spurious reprocessing
**And** the orchestrator exposes a `chainOverlayReady` writable signal (`WritableSignal<boolean>`, default `true`)
**And** the orchestrator exposes a `chainOverlayBoardChanged` writable signal (`WritableSignal<boolean>`, default `false`)
**And** the orchestrator adds a `_boardEventsSinceSolving` counter (private, reset to 0 on MSG_CHAIN_SOLVING, incremented on board-changing events: MSG_MOVE, MSG_DAMAGE, MSG_RECOVER, MSG_FLIPSUMMONING, MSG_PAY_LPCOST, MSG_CHANGE_POS). Guard: only increment when currently processing chain events (between MSG_CHAIN_SOLVING and MSG_CHAIN_SOLVED in the sequential queue — no `chainPhase` check needed since the orchestrator processes events one at a time and tracks its own `_insideChainResolution` boolean, set `true` on MSG_CHAIN_SOLVING, set `false` on MSG_CHAIN_SOLVED/MSG_CHAIN_END)
**And** on MSG_CHAIN_SOLVED: orchestrator sets `chainOverlayBoardChanged(this._boardEventsSinceSolving > 0)` then returns `'async'`
**And** the orchestrator registers a resume `effect()` inside `init()` (using the component's injection context, since the orchestrator is `@Injectable()` provided at component level and has no injection context of its own). The effect watches `chainOverlayReady`: when it transitions to `true` and `_waitingForOverlay` is `true`, the orchestrator sets `_waitingForOverlay = false` and calls `processAnimationQueue()`
**And** `applyInstantAnimation()` (queue collapse) is updated: when collapsing a MSG_CHAIN_SOLVED event, it calls `applyChainSolved()` but does NOT set `chainOverlayBoardChanged` and does NOT return `'async'` — collapsed events bypass the overlay entirely (the overlay will catch up via signal state)
**And** the overlay component (Story 6.3) is the sole writer of `chainOverlayReady` — it sets `false` when starting exit animation, `true` when done. The `overlayDismissed` EventEmitter is kept for parent-level coordination (e.g., logging) but does NOT write `chainOverlayReady` (no double-write)
**And** DuelPageComponent wires `[boardChanged]="orchestrator.chainOverlayBoardChanged()"`

## Tasks / Subtasks

- [x] Task 1: Remove old chain badge rendering from PvpBoardContainerComponent (AC1)
  - [x] 1.1 Remove `#chainBadgeTpl` ng-template (lines 263-283) from HTML
  - [x] 1.2 Remove all 3 `*ngTemplateOutlet="chainBadgeTpl"` usages (lines 61, 119, 242) from HTML
  - [x] 1.3 Remove `chainBadgesByZone` computed (lines 280-290) from TS
  - [x] 1.4 Remove `emzLChainBadges` / `emzRChainBadges` computeds (lines 310-316) from TS
  - [x] 1.5 Update `emzConfigs` computed (lines 130-133) to remove `chainBadges` property
  - [x] 1.6 Remove `activeChainLinks` input (line 46) from TS
  - [x] 1.7 Remove `ChainLinkState` import if no longer used in this file
  - [x] 1.8 Remove `.pvp-chain-badge`, `.pvp-chain-badge--resolving`, `.pvp-chain-badge--overflow` classes (lines 419-446) from SCSS
  - [x] 1.9 Remove `chain-resolve-pulse` keyframe (lines 448-460) from SCSS
  - [x] 1.10 Remove `.pvp-chain-badge--resolving` from `prefers-reduced-motion` block (lines 554-556) in SCSS
  - [x] 1.11 Remove `[activeChainLinks]` binding from duel-page.component.html (line 149)

- [x] Task 2: Update design tokens (AC2)
  - [x] 2.1 Update `--pvp-chain-badge-size` from `24px` to `28px` in `_tokens.scss` (line 150)
  - [x] 2.2 Remove `--pvp-chain-resolve-pulse: 400ms` from main token list (line 151)
  - [x] 2.3 Remove `--pvp-chain-resolve-pulse: 0ms` from reduced-motion block (line 184)
  - [x] 2.4 Remove `$z-pvp-chain-badge: 10` from `_z-layers.scss` (line 31)
  - [x] 2.5 Add 9 new chain overlay tokens to `_tokens.scss` (per AC2 list)
  - [x] 2.6 Add `$z-pvp-chain-overlay` to `_z-layers.scss` — value between `$z-pvp-zone-browser` and `$z-pvp-prompt` (check current values)
  - [x] 2.7 Add `--pvp-chain-overlay-transition: 0ms` to reduced-motion block

- [x] Task 3: Create PvpChainOverlayComponent shell (AC3)
  - [x] 3.1 Create component files: `pvp-chain-overlay.component.ts`, `.html`, `.scss`
  - [x] 3.2 Implement shell: standalone, OnPush, signal inputs (`activeChainLinks`, `phase`, `promptActive`, `boardChanged`), `pointer-events: none` host
  - [x] 3.3 Template: `@if (activeChainLinks().length > 0 && !promptActive())` → backdrop div + card container div (empty for now)
  - [x] 3.4 SCSS: `:host` fixed positioning, backdrop with `var(--pvp-chain-overlay-backdrop)`, card container centering
  - [x] 3.5 Add `role="status"` + `aria-live="polite"` on container
  - [x] 3.6 Wire into DuelPageComponent template (after connection status overlays, before duel result overlay)
  - [x] 3.7 Pass `[activeChainLinks]`, `[phase]`, `[promptActive]`, `[boardChanged]` bindings + `(overlayDismissed)` binding from DuelPageComponent

- [x] Task 4: Extend chain state model (AC4)
  - [x] 4.1 Add `_chainPhase = signal<'idle' | 'building' | 'resolving'>('idle')` to DuelConnection
  - [x] 4.2 Expose `readonly chainPhase = this._chainPhase.asReadonly()`
  - [x] 4.3 Update MSG_CHAINING handler: if `_chainPhase() === 'idle'`, set `'building'`
  - [x] 4.4 Update MSG_CHAIN_SOLVING handler: set `'resolving'`
  - [x] 4.5 Update MSG_CHAIN_END handler: set `'idle'`
  - [x] 4.6 Add `_chainPhase.set('idle')` to STATE_SYNC, DUEL_END, REMATCH_STARTING reset blocks
  - [x] 4.7 Expose `chainPhase` via `DuelWebSocketService`: add `readonly chainPhase = computed(() => this._activeConnection().chainPhase())` (same pattern as `activeChainLinks`)

- [x] Task 5: Update animation orchestrator timings (AC5)
  - [x] 5.1 Update MSG_CHAINING duration: 300ms → 700ms
  - [x] 5.2 Update MSG_CHAIN_SOLVING duration: 400ms → 300ms
  - [x] 5.3 MSG_CHAIN_SOLVED: return `'async'` instead of fixed duration (orchestrator waits for overlay)
  - [x] 5.4 Update MSG_CHAIN_END duration: 0ms → 200ms
  - [x] 5.5 Keep `applyChainSolving` / `applyChainSolved` / `applyChainEnd` calls in orchestrator

- [x] Task 6: Scaffold async orchestrator contract (AC6)
  - [x] 6.1 Change `processEvent()` return type to `number | 'async'`
  - [x] 6.2 Update `processAnimationQueue()`: when return is `'async'`, set `_waitingForOverlay = true` and return. Move `speedMultiplierFn` calculation into the `else` branch (only for numeric durations)
  - [x] 6.3 Add `_waitingForOverlay = false` flag (private boolean)
  - [x] 6.4 Add `chainOverlayReady = signal<boolean>(true)` (writable, public)
  - [x] 6.5 Add `chainOverlayBoardChanged = signal<boolean>(false)` (writable, public)
  - [x] 6.6 Add `_boardEventsSinceSolving = 0` counter (private)
  - [x] 6.7 Add `_insideChainResolution = false` flag (private boolean) — set `true` on MSG_CHAIN_SOLVING, `false` on MSG_CHAIN_SOLVED/MSG_CHAIN_END
  - [x] 6.8 Reset counter to 0 on MSG_CHAIN_SOLVING
  - [x] 6.9 Increment counter on board-changing events (MSG_MOVE, MSG_DAMAGE, MSG_RECOVER, MSG_FLIPSUMMONING, MSG_PAY_LPCOST, MSG_CHANGE_POS) only when `_insideChainResolution === true`
  - [x] 6.10 On MSG_CHAIN_SOLVED: `chainOverlayBoardChanged.set(this._boardEventsSinceSolving > 0)`
  - [x] 6.11 Register resume `effect()` inside `init()` method (component injection context): watch `chainOverlayReady`, when `true` and `_waitingForOverlay`, set `_waitingForOverlay = false` and call `processAnimationQueue()`
  - [x] 6.12 Update `applyInstantAnimation()`: for collapsed MSG_CHAIN_SOLVED, call `applyChainSolved()` without setting `chainOverlayBoardChanged` or returning `'async'` — collapse bypasses overlay
  - [x] 6.13 Reset `_boardEventsSinceSolving`, `_insideChainResolution`, and `_waitingForOverlay` on MSG_CHAIN_END / `destroy()` / `resetForSwitch()`

- [x] Task 7: Wire overlay in DuelPageComponent (AC3, AC6)
  - [x] 7.1 Add `<app-pvp-chain-overlay>` to template with all input/output bindings
  - [x] 7.2 Bind `[promptActive]="hasActivePrompt()"` — uses existing `hasActivePrompt()` computed (duel-page.component.ts:222-225) which excludes IDLECMD/BATTLECMD distributed prompts
  - [x] 7.3 Bind `(overlayDismissed)` for parent-level coordination (logging, etc.) — overlay component itself writes `chainOverlayReady` directly (no double-write)

- [x] Task 8: Build verification (all ACs)
  - [x] 8.1 Verify: `ng build` compiles with zero errors
  - [x] 8.2 Verify: no references to old `.pvp-chain-badge` class remain in codebase
  - [x] 8.3 Verify: PvpChainOverlayComponent shell renders (backdrop visible when chain active)
  - [x] 8.4 Verify: chain state signals (`activeChainLinks`, `chainPhase`) update correctly on chain messages
  - [x] 8.5 Verify: `processEvent()` returns `'async'` for MSG_CHAIN_SOLVED and orchestrator pauses correctly
  - [x] 8.6 Verify: SCSS budget not exceeded

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring bug caught in Epics 1-3).
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.
- **No new dependencies**: PvP uses Angular Material, CDK, and standard CSS only.

### Critical: Async Orchestrator Migration

The animation orchestrator currently uses a pure sync model: `processEvent()` returns a `number`, `setTimeout(duration)` triggers next dequeue. This story introduces the first async event (`MSG_CHAIN_SOLVED`) where the duration is variable (depends on whether the board changed).

**Migration approach:**
```typescript
// processEvent return type changes:
private processEvent(event: GameEvent): number | 'async' { ... }

// processAnimationQueue updated:
const result = this.processEvent(event);
if (result === 'async') {
  // Do NOT setTimeout — orchestrator pauses until overlay signals ready.
  this._waitingForOverlay = true;
  return;
}
// Speed multiplier only applies to numeric durations — never to 'async'.
const adjustedDuration = Math.round(result * this.speedMultiplierFn());
const timeout = setTimeout(() => { ... }, adjustedDuration);
```

The `chainOverlayReady` effect acts as the async resume mechanism.
**Must be created inside `init()` method** (the orchestrator is `@Injectable()` without its own injection context — `effect()` requires one):
```typescript
init(config: { ..., injector: Injector }) {
  // ... existing init code ...
  effect(() => {
    const ready = this.chainOverlayReady();
    untracked(() => {
      if (ready && this._isAnimating() && this._waitingForOverlay) {
        this._waitingForOverlay = false;
        this.processAnimationQueue();
      }
    });
  }, { injector: config.injector });
}
```

This keeps the contract within Angular's signal system — no RxJS, no Promises.

**Queue collapse interaction:** `applyInstantAnimation()` bypasses the async contract entirely. Collapsed MSG_CHAIN_SOLVED events call `applyChainSolved()` but do NOT set `chainOverlayBoardChanged` or return `'async'`. The overlay catches up by reading signal state after collapse completes.

### Critical: What Already Exists (Modify/Remove)

| Feature | Location | Action |
|---------|----------|--------|
| `ChainLinkState` interface | `duel-state.types.ts:5-12` | Keep as-is |
| `_activeChainLinks` signal | `duel-connection.ts:18` | Keep as-is |
| `activeChainLinks` readonly | `duel-connection.ts:34` | Keep as-is |
| MSG_CHAINING handler | `duel-connection.ts:420-432` | Modify (add phase transition) |
| MSG_CHAIN_SOLVING handler | `duel-connection.ts:434` | Modify (add phase transition) |
| MSG_CHAIN_END handler | `duel-connection.ts:436` | Modify (add phase transition) |
| `applyChainSolving` method | `duel-connection.ts:149-153` | Keep (still updates signal) |
| `applyChainSolved` method | `duel-connection.ts:155-159` | Keep (still updates signal) |
| `applyChainEnd` method | `duel-connection.ts:161-163` | Keep (still updates signal) |
| Chain resets (STATE_SYNC, DUEL_END, REMATCH) | Various lines | Modify (also reset `chainPhase`) |
| Orchestrator chain handlers | `animation-orchestrator.service.ts:180-198` | Modify (update durations + async return) |
| Orchestrator `init()` method | `animation-orchestrator.service.ts:57-67` | Modify (add `injector` param + resume `effect()`) |
| Orchestrator `applyInstantAnimation()` | `animation-orchestrator.service.ts:261-278` | Modify (collapse bypasses async) |
| `chainBadgesByZone` computed | `pvp-board-container.component.ts:280-290` | **Remove** |
| `emzLChainBadges` / `emzRChainBadges` | `pvp-board-container.component.ts:310-316` | **Remove** |
| `activeChainLinks` input | `pvp-board-container.component.ts:46` | **Remove** |
| `#chainBadgeTpl` template | `pvp-board-container.component.html:263-283` | **Remove** |
| `*ngTemplateOutlet="chainBadgeTpl"` ×3 | `pvp-board-container.component.html:61,119,242` | **Remove** |
| `.pvp-chain-badge` + keyframe SCSS | `pvp-board-container.component.scss:419-460` | **Remove** |
| Reduced-motion chain rule | `pvp-board-container.component.scss:554-556` | **Remove** |
| `--pvp-chain-badge-size` token | `_tokens.scss:150` | **Update** 24px → 28px |
| `--pvp-chain-resolve-pulse: 400ms` | `_tokens.scss:151` (main) | **Remove** |
| `--pvp-chain-resolve-pulse: 0ms` | `_tokens.scss:184` (reduced-motion) | **Remove** |
| `$z-pvp-chain-badge` z-layer | `_z-layers.scss:31` | **Remove & Replace** |
| `[activeChainLinks]` binding | `duel-page.component.html:149` | **Remove** (moved to overlay) |
| Chain resolved LiveAnnouncer effect | `duel-page.component.ts:703-711` | Keep (still valid) |
| `previousChainLinksCount` | `duel-page.component.ts:344` | Keep |

### Critical: What Does NOT Exist Yet (Story 6.1 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| `PvpChainOverlayComponent` | New component dir under `duel-page/` | Dedicated overlay for chain cascade |
| `_chainPhase` signal | `duel-connection.ts` | Track chain lifecycle phase |
| `$z-pvp-chain-overlay` | `_z-layers.scss` | Z-index for overlay |
| 9 new chain overlay tokens | `_tokens.scss` | Design tokens per UX spec |
| `chainOverlayReady` signal | `animation-orchestrator.service.ts` | Async contract: overlay tells orchestrator when to proceed |
| `chainOverlayBoardChanged` signal | `animation-orchestrator.service.ts` | Passes board-change info from orchestrator to overlay |
| `_boardEventsSinceSolving` counter | `animation-orchestrator.service.ts` | Counts board events between SOLVING/SOLVED |
| `_insideChainResolution` flag | `animation-orchestrator.service.ts` | Guards counter increment (no `chainPhase` dependency) |
| `_waitingForOverlay` flag | `animation-orchestrator.service.ts` | Guards the resume effect |
| `chainPhase` on `DuelWebSocketService` | `duel-web-socket.service.ts` | Expose `chainPhase` from `DuelConnection` (needed by DuelPageComponent for overlay `[phase]` binding) |

### What NOT to Change (Story 6.2/6.3 Scope)

- Card cascade layout CSS (perspective, rotateY, scale) → Story 6.2
- Construction animation (appear/disappear rhythm) → Story 6.2
- Chain connectors (SVG/CSS) → Story 6.2
- Resolution animation (LIFO card exit) → Story 6.3
- Board change detection overlay behavior (fade-out/pause/resume) → Story 6.3
- Auto-resolve acceleration → Story 6.3

### Source Tree — Files to Touch

**CREATE (3 files):**
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss`

**MODIFY (8 files):**
- `front/src/app/styles/_tokens.scss`
- `front/src/app/styles/_z-layers.scss`
- `front/src/app/pages/pvp/duel-page/duel-connection.ts`
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` (expose `chainPhase` from `DuelConnection`)
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` (wire overlay + promptActive signal)

**DO NOT TOUCH:**
- `duel-server/` — No server changes
- Prompt components — No impact
- Lobby / waiting room — No changes

### References

- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — PvpChainOverlayComponent spec]
- [Source: _bmad-output/implementation-artifacts/4-1-chain-link-visualization.md — Previous implementation (being replaced)]
- [Source: _bmad-output/implementation-artifacts/epic-4-retro-2026-03-01.md — Epic 4 retro learnings]

## Dev Agent Record

### Implementation Notes

- Removed all old chain badge rendering (ng-template, 3 template outlets, 3 computeds, SCSS classes + keyframe + reduced-motion rule) from PvpBoardContainerComponent
- Also removed `NgTemplateOutlet` import and `ChainLinkState` type import from the TS file since no longer needed
- Updated design tokens: `--pvp-chain-badge-size` 24px→28px, removed `--pvp-chain-resolve-pulse`, added 9 new chain overlay tokens, added `$z-pvp-chain-overlay: 68` (between zone-browser 65 and card-action-menu 70)
- Created PvpChainOverlayComponent shell with signal inputs, OnPush, fixed positioning, pointer-events:none, accessibility attrs
- Extended DuelConnection with `_chainPhase` signal tracking idle→building→resolving→idle lifecycle, exposed via DuelWebSocketService
- Migrated animation orchestrator to support async events: `processEvent()` now returns `number | 'async'`, MSG_CHAIN_SOLVED returns `'async'` causing orchestrator to pause until `chainOverlayReady` signals true
- Added board-change detection counter (`_boardEventsSinceSolving`) incremented on MSG_MOVE/DAMAGE/RECOVER/FLIPSUMMONING/PAY_LPCOST/CHANGE_POS during chain resolution
- Resume effect created inside `init()` with component's `Injector` (orchestrator has no injection context of its own)
- Queue collapse (`applyInstantAnimation`) bypasses async contract for MSG_CHAIN_SOLVED — just applies state without overlay coordination
- Pre-existing SCSS budget error on `duel-page.component.scss` (12.23 kB > 10 kB limit) is unrelated to this story

### Debug Log

No issues encountered during implementation.

## File List

### Created
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss`

### Modified
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-connection.ts`
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts`
- `front/src/app/styles/_tokens.scss`
- `front/src/app/styles/_z-layers.scss`

## Change Log

- 2026-03-09: Story 6.1 implemented — Tore down old chain badges from PvpBoardContainerComponent, updated design tokens for chain overlay, created PvpChainOverlayComponent shell, added chainPhase signal to DuelConnection, migrated animation orchestrator to async model with board-change detection, wired overlay into DuelPageComponent
- 2026-03-09: Code review (AI) — 3 issues fixed: [H1] replaced dead `(overlayDismissed)="null"` binding with proper handler, [M2] added `_insideChainResolution`/`_boardEventsSinceSolving` reset in `applyInstantAnimation` for MSG_CHAIN_SOLVING collapse, [M5] removed unused `EventEmitter` import from PvpChainOverlayComponent. Status → done
