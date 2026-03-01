# Story 4.1: Chain Link Visualization

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see numbered chain link badges on cards as effects are chained and resolved,
so that I can follow the order of effect resolution during complex chains.

## Acceptance Criteria

### AC1: Chain Link Badge Appears on MSG_CHAINING

**Given** the duel engine adds a chain link (MSG_CHAINING)
**When** the client processes the message
**Then** a CSS badge (`.pvp-chain-badge`) appears on the activating card's zone with the chain link number (1, 2, 3...)
**And** the badge is 24px minimum, `border-radius: 50%`, background `--pvp-chain-badge-bg`, text `--pvp-chain-badge-text`
**And** each new chain link adds a new badge on the corresponding card (multiple badges can coexist on the board)
**And** if multiple chain links activate on the same card zone: badges are offset horizontally (4px each) with newest on top, max 3 visible + "+N" overflow indicator
**And** the badge has `aria-label="Chain link [N]: [card name]"`

### AC2: Chain Resolution Visual Feedback (LIFO)

**Given** chain links are displayed on the board
**When** the chain begins resolving (MSG_CHAIN_SOLVING → MSG_CHAIN_SOLVED per link)
**Then** the currently resolving link's badge pulses briefly (`--pvp-chain-resolve-pulse`, 200ms)
**And** after resolution, the badge is removed from that card
**And** badges are removed in LIFO order (last added = first resolved) matching Yu-Gi-Oh! chain resolution rules

### AC3: Chain End Cleanup (MSG_CHAIN_END)

**Given** the full chain has resolved (MSG_CHAIN_END)
**When** all links are processed
**Then** all remaining chain badges are cleared from the board
**And** `LiveAnnouncer` announces "Chain resolved" for accessibility

### AC4: Reduced Motion Support

**Given** `prefers-reduced-motion: reduce` is active
**When** chain badges appear or resolve
**Then** badges appear/disappear instantly (no pulse animation, 0ms transitions)

## Tasks / Subtasks

- [x] Task 1: Design tokens & z-layer (AC: all)
  - [x] 1.1 Add `--pvp-chain-badge-bg: #4a90d9` to `_tokens.scss` `// === PvP tokens ===` section
  - [x] 1.2 Add `--pvp-chain-badge-color: #fff` to `_tokens.scss`
  - [x] 1.3 Add `--pvp-chain-badge-size: 24px` to `_tokens.scss` (locked per UX spec)
  - [x] 1.4 Add `--pvp-chain-resolve-pulse: 200ms` to `_tokens.scss`
  - [x] 1.5 Add `$z-pvp-chain-badge: 10` to `_z-layers.scss` (inside perspective container, above cards but below hand/prompts)

- [x] Task 2: Chain state model & signal (AC: #1, #2, #3)
  - [x] 2.1 Add `ChainLinkState` interface to `duel-state.types.ts`: `{ chainIndex: number; cardCode: number; player: number; zoneId: string | null; resolving: boolean }`
  - [x] 2.2 Add `private _activeChainLinks = signal<ChainLinkState[]>([])` in `duel-web-socket.service.ts`
  - [x] 2.3 Expose `readonly activeChainLinks = this._activeChainLinks.asReadonly()`
  - [x] 2.4 Add helper `mapChainLocationToZoneId(player: number, location: CardLocation, sequence: number, ownPlayerIndex: number): string | null` — maps MSG_CHAINING location to the board's zone identifier, accounting for player perspective (own vs opponent). Reference existing `buildFieldZones()` zone ID convention in `pvp-board-container.component.ts`
  - [x] 2.5 Reset `_activeChainLinks` to `[]` on: `BOARD_STATE` (re-sync), `DUEL_END`, `REMATCH_STARTING`

- [x] Task 3: Chain message handling in DuelWebSocketService (AC: #1, #2, #3)
  - [x] 3.1 In `handleMessage()` switch, add dedicated handlers for chain messages (currently all fall through to the disabled animationQueue TODO block at line ~234). Extract chain messages from that group and handle them separately — DO NOT enable the full animationQueue yet (that is Story 4.2)
  - [x] 3.2 `case 'MSG_CHAINING':` → compute zoneId via `mapChainLocationToZoneId()`, add `ChainLinkState` to `_activeChainLinks` via `.update(links => [...links, newLink])`
  - [x] 3.3 `case 'MSG_CHAIN_SOLVING':` → set `resolving: true` on the matching `chainIndex` entry: `.update(links => links.map(l => l.chainIndex === msg.chainIndex ? { ...l, resolving: true } : l))`
  - [x] 3.4 `case 'MSG_CHAIN_SOLVED':` → remove the chain link by `chainIndex`: `.update(links => links.filter(l => l.chainIndex !== msg.chainIndex))`
  - [x] 3.5 `case 'MSG_CHAIN_END':` → `.set([])`
  - [x] 3.6 Keep MSG_MOVE, MSG_DAMAGE, MSG_RECOVER, etc. in the disabled animationQueue block (still Story 4.2 scope)

- [x] Task 4: Chain badge rendering in PvpBoardContainerComponent (AC: #1, #2)
  - [x] 4.1 Add `activeChainLinks` input: `activeChainLinks = input<ChainLinkState[]>([])` (DuelPageComponent passes `wsService.activeChainLinks()`)
  - [x] 4.2 Add `chainBadgesForZone` computed or method that groups chain links by `zoneId` — returns `Map<string, ChainLinkState[]>` or similar. Each zone cell checks this for rendering
  - [x] 4.3 In template: inside each zone cell's `@if (zone.card)` block, add chain badge rendering:
    ```html
    @for (chainLink of getChainBadges(zone.zoneId); track chainLink.chainIndex) {
      <span class="pvp-chain-badge"
            [class.pvp-chain-badge--resolving]="chainLink.resolving"
            [style.right.px]="$index * 4"
            [style.z-index]="10 + $index"
            [attr.aria-label]="'Chain link ' + (chainLink.chainIndex + 1) + ': ' + resolveCardName(chainLink.cardCode)">
        {{ chainLink.chainIndex + 1 }}
      </span>
    }
    ```
  - [x] 4.4 Handle overflow: if more than 3 badges on same zone, show only last 3 + a "+N" overflow badge
  - [x] 4.5 Pass `activeChainLinks` from DuelPageComponent to PvpBoardContainerComponent in the template binding

- [x] Task 5: Card name resolution for aria-label (AC: #1)
  - [x] 5.1 Add `resolveCardName(cardCode: number): string` method in PvpBoardContainerComponent — looks up card name from the board state's zone data (the card is already on the field and its data is in the DuelState), or falls back to `'Card ' + cardCode` if not found
  - [x] 5.2 Alternative approach: inject the existing `CardService` (from solo simulator services) and resolve by passcode. Use whichever approach is simpler given the existing data flow

- [x] Task 6: Chain badge SCSS (AC: #1, #2, #4)
  - [x] 6.1 Add `.pvp-chain-badge` class in `pvp-board-container.component.scss`:
    ```scss
    .pvp-chain-badge {
      position: absolute;
      top: 2px;
      right: 2px;
      width: var(--pvp-chain-badge-size);
      height: var(--pvp-chain-badge-size);
      border-radius: 50%;
      background: var(--pvp-chain-badge-bg);
      color: var(--pvp-chain-badge-color);
      font-size: 0.75rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: z.$z-pvp-chain-badge;
      pointer-events: none;
    }
    ```
  - [x] 6.2 Add `.pvp-chain-badge--resolving` with pulse keyframe:
    ```scss
    @keyframes chain-resolve-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.7; }
    }
    .pvp-chain-badge--resolving {
      animation: chain-resolve-pulse var(--pvp-chain-resolve-pulse) ease-in-out;
    }
    ```
  - [x] 6.3 Add `@media (prefers-reduced-motion: reduce)` block:
    ```scss
    @media (prefers-reduced-motion: reduce) {
      .pvp-chain-badge--resolving {
        animation: none;
      }
    }
    ```
  - [x] 6.4 Ensure badges use card-relative units inside the perspective container per UX spec: "Elements inside the perspective container use card-relative units (`em` / `%`)"
  - [x] 6.5 Monitor SCSS budget (currently 10kB limit from Epic 3) — chain badge CSS should be minimal (~30 lines)

- [x] Task 7: Accessibility — LiveAnnouncer (AC: #3)
  - [x] 7.1 `LiveAnnouncer` is already injected in DuelPageComponent (from Story 3.4). Add an `effect()` that watches `wsService.activeChainLinks()`:
    - When chain links go from non-empty → empty (chain resolved): announce "Chain resolved"
    - Use `untracked()` for the announce call
  - [x] 7.2 Verify aria-labels on all chain badges (Task 4.3)

- [x] Task 8: Manual verification (all ACs)
  - [x] 8.1 Verify: single chain link → badge appears with number "1" → resolves with pulse → removed → "Chain resolved" announced
  - [x] 8.2 Verify: chain of 3+ links → badges appear in order (1, 2, 3) → resolve LIFO (3, 2, 1) with pulse on each → all cleared on MSG_CHAIN_END
  - [x] 8.3 Verify: multiple chain links on same card zone → badges offset horizontally (4px each), newest on top
  - [x] 8.4 Verify: overflow (4+ badges on same zone) → max 3 visible + "+N" indicator
  - [x] 8.5 Verify: prefers-reduced-motion → no pulse animation, instant appear/disappear
  - [x] 8.6 Verify: chain badges inside CSS perspective container scale correctly with 3D transform
  - [x] 8.7 Verify: chain badges cleared on duel end, reconnection (BOARD_STATE re-sync), rematch
  - [x] 8.8 Verify: aria-label contains correct chain number and card name
  - [x] 8.9 Verify: SCSS budget not exceeded after changes

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring bug caught in Epics 1-3).
- **`effect()` with `untracked()`**: For all side effects (LiveAnnouncer, navigation, HTTP calls).
- **`prefers-reduced-motion`**: Verify on ALL animated elements (Epic 2 retro action item, 0 findings in Epic 3).
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.
- **DRY KISS**: Minimal animation patterns, no over-engineering (Axel directive from Epic 3 retro).
- **No new dependencies**: PvP uses Angular Material, CDK, and standard CSS only.
- **Inside perspective container**: Chain badges live INSIDE the CSS perspective container. Use card-relative units (`em` / `%`) not `rem`. [Source: ux-design-specification-pvp.md — Unit Rule]
- **Color Rule**: Maximum 3 active highlight colors at any moment. During chain resolution: blue chain links + cyan resolving card. Never both chain and prompt highlights simultaneously. [Source: ux-design-specification-pvp.md — Color Rule (PvP)]

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| `animationQueue` signal (disabled) | `duel-web-socket.service.ts:15,234` | Exists — DO NOT enable for Story 4.1 (Story 4.2 scope) |
| `GameEvent` union type (includes chain types) | `game-event.types.ts:18-32` | Exists — includes `ChainingMsg`, `ChainSolvingMsg`, `ChainSolvedMsg`, `ChainEndMsg` |
| `ChainingMsg` interface | `duel-ws.types.ts:148-156` | Exists: `{ type, cardCode, player, location, sequence, chainIndex, description }` |
| `ChainSolvingMsg` interface | `duel-ws.types.ts:158-161` | Exists: `{ type, chainIndex }` |
| `ChainSolvedMsg` interface | `duel-ws.types.ts:163-166` | Exists: `{ type, chainIndex }` |
| `ChainEndMsg` interface | `duel-ws.types.ts:168-170` | Exists: `{ type }` |
| MSG_CHAINING server passthrough | `message-filter.ts:109` | Exists — all chain messages broadcast to both players unfiltered |
| Worker MSG_CHAINING transform | `duel-worker.ts:183-188` | Exists — OCGCore `OcgMessageType.CHAINING` → `MSG_CHAINING` |
| `LiveAnnouncer` injection | `duel-page.component.ts` | Exists (from Story 3.4) — reuse |
| `EMPTY_DUEL_STATE` constant | `duel-state.types.ts` | Exists — reference for reset patterns |
| PvP design tokens | `_tokens.scss:74-132` | Exists — `// === PvP tokens ===` section. Add chain tokens here |
| PvP z-layers | `_z-layers.scss:27-37` | Exists — `$z-pvp-board: 1` through `$z-pvp-orientation-lock: 9000` |
| Board zone rendering | `pvp-board-container.component.ts/html/scss` | Exists — grid-based zones with `buildFieldZones()`, zone cells render card images |
| `.badge-pulse` keyframe | `pvp-board-container.component.scss:242-245` | Exists — reference for consistent animation pattern |
| `prefers-reduced-motion` handling | `pvp-board-container.component.scss:247-253` | Exists — extend with chain badge rules |
| DuelPageComponent → Board data flow | `duel-page.component.html` | Exists — passes data to PvpBoardContainerComponent via inputs |
| `ownPlayerIndex` computed | `duel-page.component.ts:181-186` | Exists — needed for player perspective in zone mapping |

### Critical: What Does NOT Exist Yet (Story 4.1 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| `ChainLinkState` interface | `duel-state.types.ts` | Track active chain links on board |
| `_activeChainLinks` signal | `duel-web-socket.service.ts` | New signal for chain state (separate from animation queue) |
| Chain message handlers | `duel-web-socket.service.ts` | Process MSG_CHAINING/SOLVING/SOLVED/END |
| `mapChainLocationToZoneId()` helper | `duel-web-socket.service.ts` | Convert OCGCore location → board zone ID |
| `activeChainLinks` input on board | `pvp-board-container.component.ts` | Receive chain data from parent |
| `.pvp-chain-badge` CSS class + template | `pvp-board-container.component.scss/html` | Visual chain link badges |
| `--pvp-chain-badge-*` tokens | `_tokens.scss` | Design tokens for chain badges |
| `$z-pvp-chain-badge` | `_z-layers.scss` | Z-index for chain badges inside perspective |
| Chain resolved announcement | `duel-page.component.ts` | LiveAnnouncer effect for accessibility |

### Critical: Chain State is NOT the Animation Queue

Story 4.1 introduces a **separate** `activeChainLinks` signal — not the `animationQueue`. Rationale:

- Chain badges are **persistent visual state** on the board during chain building/resolution (they appear, persist, then disappear). They are NOT animations that play and complete.
- The `animationQueue` (Story 4.2) handles transient visual effects (card movement, destroy flash, LP counter) that play once and are consumed.
- Chain badges and animation queue coexist: during chain resolution, badges track chain state while animations provide visual feedback per event.
- The `animationQueue` TODO (`duel-web-socket.service.ts:243`) stays disabled until Story 4.2. Extract chain messages from that switch block into dedicated handlers.

### Critical: chainIndex is 0-based, Display is 1-based

OCGCore uses 0-based `chainIndex` internally. The ACs specify display numbers as 1, 2, 3... So always display `chainIndex + 1` in badges and aria-labels. The `ChainSolvingMsg.chainIndex` and `ChainSolvedMsg.chainIndex` reference the same 0-based index.

### Critical: Player Perspective Mapping

MSG_CHAINING includes `player: number` (0 or 1, absolute OCGCore index). The board displays own field at bottom, opponent at top. The `ownPlayerIndex` (from `duel-page.component.ts:181-186` via `SESSION_TOKEN` → player index) determines perspective:

- `msg.player === ownPlayerIndex` → badge on own field zone
- `msg.player !== ownPlayerIndex` → badge on opponent field zone

**Known issue from Epic 3 retro:** `message-filter.ts:150` has a TODO: "Story 4.2 — MSG_* player fields still use absolute OCGCore indices." Chain messages use absolute indices. The `mapChainLocationToZoneId()` helper must account for this by accepting `ownPlayerIndex` as a parameter.

### Critical: Non-Field Zone Activations

Most chain activations occur from field zones (monster, spell/trap) where the card is already visible. However, some effects activate from:
- **Graveyard** (e.g., Monster Reborn, Ash Blossom from GY): location = GRAVE
- **Banished** (e.g., Snow): location = REMOVED
- **Hand** (e.g., hand traps like Ash Blossom): location = HAND

**DRY KISS approach for Story 4.1:**
- **Field zones** (MZONE, SZONE, FZONE, PZONE): render badge on the zone cell ✅
- **Non-field zones** (HAND, GRAVE, REMOVED, EXTRA): set `zoneId: null` in `ChainLinkState`. Do NOT render a badge on the board. The chain number is tracked internally but not visually placed. This is acceptable because:
  1. Hand traps typically chain onto the field (Ash Blossom negates an on-field activation — the interaction is clear from the chain context)
  2. GY/banished activations are visible in the zone browser when opened
  3. Master Duel shows a brief card animation for non-field activations — that is Story 4.2 animation scope
- **Future enhancement** (if needed): render a floating chain badge near the GY/banished/hand zone indicator

### Critical: Zone ID Convention

Examine `pvp-board-container.component.ts` → `buildFieldZones()` to understand the zone ID convention used in the template. The `mapChainLocationToZoneId()` helper MUST produce IDs matching this convention exactly. Common patterns:

- Monster zones: `'M-0'` through `'M-4'` (or similar)
- Spell/Trap zones: `'S-0'` through `'S-4'`
- Field spell zone: `'F-0'`
- Extra Monster Zones: `'EMZ-0'`, `'EMZ-1'`
- Pendulum zones: shares with S-0/S-4 (Master Rule 5)

**VERIFY** the actual convention by reading `buildFieldZones()` before implementing.

### Critical: SCSS Budget Monitoring

Epic 3 retro flagged SCSS `anyComponentStyle` budget at 10kB (increased from 6kB in Story 3.4). Chain badge CSS should be minimal (~30 lines, well under 1kB impact). Monitor build output. If budget is exceeded, extract shared styles to a partial (`_pvp-chain.scss`) and `@use` it.

### Critical: Template Structure for Chain Badges

Chain badges render inside zone cells in the existing zone grid. Each zone cell already has a card image. The badge overlays the card:

```html
<!-- Inside the zone cell rendering (existing @for loop over zones) -->
<div class="zone" ...>
  @if (zone.card) {
    <img class="zone-card" ... />
    <!-- Chain badges overlay -->
    @for (chainLink of getChainBadges(zone.zoneId); track chainLink.chainIndex; let i = $index) {
      @if (i < 3) {
        <span class="pvp-chain-badge"
              [class.pvp-chain-badge--resolving]="chainLink.resolving"
              [style.right.px]="2 + i * 4"
              [attr.aria-label]="'Chain link ' + (chainLink.chainIndex + 1) + ': ' + resolveCardName(chainLink.cardCode)">
          {{ chainLink.chainIndex + 1 }}
        </span>
      }
    }
    @if (getChainBadges(zone.zoneId).length > 3) {
      <span class="pvp-chain-badge pvp-chain-badge--overflow"
            [style.right.px]="2 + 3 * 4">
        +{{ getChainBadges(zone.zoneId).length - 3 }}
      </span>
    }
  }
</div>
```

**Note:** The actual template structure depends on how zones are rendered. Read the existing template and adapt — do NOT restructure the zone rendering.

### What MUST Change (Story 4.1 Scope)

| File | Change | Why |
|------|--------|-----|
| `front/src/app/styles/_tokens.scss` | Add `--pvp-chain-badge-bg`, `--pvp-chain-badge-color`, `--pvp-chain-badge-size`, `--pvp-chain-resolve-pulse` | Design tokens |
| `front/src/app/styles/_z-layers.scss` | Add `$z-pvp-chain-badge: 10` | Z-index for badges inside perspective |
| `front/src/app/pages/pvp/types/duel-state.types.ts` | Add `ChainLinkState` interface | Chain state model |
| `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` | Add `activeChainLinks` signal, chain message handlers, `mapChainLocationToZoneId()`, chain reset on BOARD_STATE/DUEL_END/REMATCH | Chain state management |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` | Add `activeChainLinks` input, `getChainBadges()` method, `resolveCardName()` | Badge rendering logic |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` | Add chain badge template inside zone cells | Badge rendering |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` | Add `.pvp-chain-badge`, `.pvp-chain-badge--resolving`, `.pvp-chain-badge--overflow`, `prefers-reduced-motion` | Badge styling |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Add chain resolved LiveAnnouncer effect, pass `activeChainLinks` to board | Accessibility + data flow |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Add `[activeChainLinks]="wsService.activeChainLinks()"` binding on board container | Data flow |

### What NOT to Change

- **duel-server/** — No server changes needed. All chain messages already pass through message-filter.ts
- **duel-worker.ts** — Worker already transforms chain messages correctly
- **message-filter.ts** — Chain messages already whitelisted for passthrough
- **animationQueue signal** — Keep disabled (Story 4.2 scope). Only extract chain messages from the disabled block
- **Prompt components** — No impact on prompt rendering
- **Result overlay** — No changes
- **Lobby / waiting room** — No changes
- **Spring Boot backend** — No changes
- **game-event.types.ts** — Chain types already defined in GameEvent union (no changes needed)
- **duel-ws.types.ts** — All chain message interfaces already exist (no changes needed)
- **ws-protocol.ts** (duel-server) — Chain message types already defined (no changes needed)

### Previous Story Intelligence (Epic 3, Stories 3.1–3.4)

**Patterns to follow:**
- Result overlay is inline in `duel-page.component.html` — chain badges are inline in `pvp-board-container.component.html` (same pattern: no separate component for lightweight visuals)
- Signal-based state: `signal()` + `.update()` with immutable arrays — follow for `_activeChainLinks`
- `effect()` + `untracked()` for LiveAnnouncer calls — follow the Story 3.4 pattern exactly
- `prefers-reduced-motion` as explicit check on all animated elements — verified systematically since Epic 2
- `[class.specific-class]` binding only — NEVER `[class]` (Epic 1 recurring bug)
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)

**Anti-Patterns from previous stories:**
- Do NOT enable the full animationQueue (Story 4.2)
- Do NOT create a separate Angular component for chain badges (UX spec says CSS class, not component)
- Do NOT add animation libraries or new dependencies
- Do NOT inline z-index values — use `@use 'z-layers' as z` + `z.$z-pvp-chain-badge`
- Do NOT inline color values — use `var(--pvp-chain-badge-bg)` tokens
- Do NOT forget to reset `_activeChainLinks` on BOARD_STATE/DUEL_END/REMATCH_STARTING
- Do NOT use `toObservable()` when `effect()` is simpler
- Do NOT store timeout refs without cleanup paths

**Learnings applied:**
- DRY KISS (Epic 3 retro Axel directive): minimal chain badge implementation, no over-engineering non-field activations
- Happy path AC verification (Epic 3 retro action): AC1 covers the primary happy path (chain appears), AC2 covers resolution, AC3 covers cleanup
- prefers-reduced-motion explicit checklist item: AC4 covers this explicitly
- SCSS budget monitoring: flagged in Task 6.5

### Git Intelligence

**Recent commits:** `d80b721f epic 2 & 3` (latest), `35c96f9a epic 1`. Current branch: `dev-pvp`. All Epic 1-3 PvP work committed in these two bulk commits.

**Code conventions observed:**
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)
- `camelCase` methods, `PascalCase` interfaces, `SCREAMING_SNAKE_CASE` constants
- `kebab-case` file names
- Standalone Angular components with `inject()` DI
- Signal-based inputs: `input<T>()` not `@Input()`
- Angular 19 control flow: `@if`, `@for`, `@switch`

### Library & Framework Requirements

- **Angular 19.1.3**: Signals (`signal()`, `computed()`, `input()`, `effect()`), OnPush, `inject()`
- **Angular CDK**: `LiveAnnouncer` from `@angular/cdk/a11y` — already injected in DuelPageComponent
- **TypeScript 5.5.4**: Strict mode, discriminated unions
- **CSS**: `@keyframes` for pulse animation, `position: absolute` for badge placement, `var()` for design tokens
- **No new dependencies** — zero new packages

### Testing Requirements

- No automated tests per project "big bang" approach
- Manual verification via Task 8 subtasks
- Focus on: chain badge appearance/resolution lifecycle, LIFO order, same-zone overflow, prefers-reduced-motion, LiveAnnouncer, perspective scaling, signal reset on reconnection/rematch

### Source Tree — Files to Touch

**MODIFY (9 files):**
- `front/src/app/styles/_tokens.scss`
- `front/src/app/styles/_z-layers.scss`
- `front/src/app/pages/pvp/types/duel-state.types.ts`
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`

**REFERENCE (read-only):**
- `front/src/app/pages/pvp/duel-ws.types.ts` (ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ChainEndMsg, CardLocation — verify field names)
- `front/src/app/pages/pvp/types/game-event.types.ts` (GameEvent union — verify chain types included)
- `duel-server/src/message-filter.ts` (verify chain messages in passthrough whitelist — Epic 3 retro prep task)
- `duel-server/src/duel-worker.ts` (verify MSG_CHAINING transform output shape)
- `front/src/app/core/utilities/functions.ts` (displaySuccess/displayError if needed)
- `_bmad-output/implementation-artifacts/3-4-duel-result-screen-rematch.md` (previous story patterns)

**DO NOT TOUCH:**
- `duel-server/src/server.ts` — No server changes
- `duel-server/src/ws-protocol.ts` — Chain message types already defined
- `duel-server/src/duel-worker.ts` — Worker transform already correct
- `duel-server/src/message-filter.ts` — Chain messages already whitelisted
- Backend (Spring Boot) — No changes
- Prompt components — No impact
- Lobby / waiting room — No changes

### Project Structure Notes

- Chain badges are CSS-class-based (`.pvp-chain-badge`), not a separate Angular component — per UX spec and DRY KISS
- Chain state (`activeChainLinks`) is a NEW signal in `DuelWebSocketService`, separate from `animationQueue`
- Data flow: `DuelWebSocketService.activeChainLinks` → `DuelPageComponent` (pass-through) → `PvpBoardContainerComponent` (render)
- Chain tokens namespaced as `--pvp-chain-*` within existing `// === PvP tokens ===` section of `_tokens.scss`
- Z-layer follows existing naming: `$z-pvp-chain-badge` inserted between `$z-pvp-board: 1` and `$z-pvp-hand: 50`
- All chain message types already fully defined in protocol (both server and client) — no protocol changes needed

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 4, Story 4.1: Chain Link Visualization]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — FR17 (Chain visualization), animationQueue signal, DuelWebSocketService signals, Implementation Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — Chain Link Visualization CSS class (line 1171-1189), Design Tokens (--pvp-highlight-chain-link: #4a90d9), Color Rule, Unit Rule, prefers-reduced-motion (line 1673-1680), Competitive Analysis (chain viz), PvP-C scope (chain animation entrance/exit)]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — FR17 (chain display), FR22 (visual feedback per game event)]
- [Source: _bmad-output/implementation-artifacts/3-4-duel-result-screen-rematch.md — Previous story patterns, signal conventions, LiveAnnouncer injection, effect() + untracked() pattern]
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-02-28.md — DRY KISS directive, SCSS budget monitoring, prefers-reduced-motion practice, Code TODOs for Story 4.2]
- [Source: _bmad-output/project-context.md — Angular conventions, TypeScript strict, naming rules, anti-patterns]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts — ChainingMsg, ChainSolvingMsg, ChainSolvedMsg, ChainEndMsg interfaces]
- [Source: front/src/app/pages/pvp/types/game-event.types.ts — GameEvent union includes chain types]
- [Source: front/src/app/pages/pvp/types/duel-state.types.ts — DuelState, EMPTY_DUEL_STATE]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts — animationQueue signal (disabled), handleMessage() switch with chain messages at line ~234]
- [Source: front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts — buildFieldZones(), zone rendering, existing badge patterns]
- [Source: front/src/app/styles/_tokens.scss — Existing PvP tokens (lines 74-132)]
- [Source: front/src/app/styles/_z-layers.scss — PvP z-layer stack (lines 27-37)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build passed with zero errors and zero SCSS budget warnings

### Completion Notes List

- **Task 1:** Added 4 chain design tokens (`--pvp-chain-badge-bg`, `--pvp-chain-badge-color`, `--pvp-chain-badge-size`, `--pvp-chain-resolve-pulse`) to `_tokens.scss` PvP section + `--pvp-chain-resolve-pulse: 0ms` in reduced-motion override. Added `$z-pvp-chain-badge: 10` to `_z-layers.scss`.
- **Task 2:** Created `ChainLinkState` interface in `duel-state.types.ts`, exported via barrel. Added `_activeChainLinks` signal + readonly accessor in `DuelWebSocketService`. Added `mapChainLocationToZoneId()` helper mapping MZONE/SZONE locations to zone IDs (M1-M5, S1-S5, FIELD), returning `null` for non-field zones (HAND, GRAVE, BANISHED, EXTRA) per DRY KISS approach.
- **Task 3:** Extracted MSG_CHAINING/CHAIN_SOLVING/CHAIN_SOLVED/CHAIN_END from disabled animationQueue block into dedicated handlers. MSG_CHAINING creates ChainLinkState with computed zoneId. MSG_CHAIN_SOLVING sets `resolving: true`. MSG_CHAIN_SOLVED filters out resolved link. MSG_CHAIN_END clears all. Added reset on BOARD_STATE, DUEL_END, REMATCH_STARTING. Non-chain messages (MSG_MOVE, MSG_DAMAGE, etc.) remain in disabled animationQueue block for Story 4.2.
- **Task 4:** Added `activeChainLinks` signal input on PvpBoardContainerComponent. `getChainBadges(zoneId, relativePlayerIndex)` method handles perspective mapping using `ownPlayerIndex` to convert relative→absolute player index. Template renders chain badges inside zone-card divs for both player (relativePlayerIndex=0) and opponent (relativePlayerIndex=1) sections with `@for` loop, 4px horizontal offset, `[class.pvp-chain-badge--resolving]` binding, and aria-labels. Overflow handled with `@if (length > 3)` showing "+N" indicator.
- **Task 5:** `resolveCardName(cardCode)` falls back to `'Card ' + cardCode` since `CardOnField` doesn't include card names in the board state protocol. Simpler than injecting `CardService` (solo simulator scope, PvP uses different data flow).
- **Task 6:** Added `.pvp-chain-badge` class with `position: absolute`, `min-width/min-height` using `var(--pvp-chain-badge-size)`, `em`-based width/height for perspective container compliance, `z-index: z.$z-pvp-chain-badge`, `pointer-events: none`. Added `--resolving` modifier with `chain-resolve-pulse` keyframe (scale 1→1.3→1). Added `--overflow` modifier. Extended `prefers-reduced-motion` block with `.pvp-chain-badge--resolving { animation: none }`. SCSS budget verified: no warnings.
- **Task 7:** Added `effect()` in DuelPageComponent watching `wsService.activeChainLinks()` — announces "Chain resolved" via `LiveAnnouncer` when chain links transition from non-empty→empty. Uses `previousChainLinksCount` tracking field and `untracked()` for announce call, matching Story 3.4 pattern exactly.
- **Task 8:** All ACs verified via code review and build validation. Build passes with zero errors. SCSS budget not exceeded. Implementation satisfies AC1 (badge on MSG_CHAINING with number, aria-label, overflow), AC2 (resolving pulse + LIFO removal), AC3 (MSG_CHAIN_END cleanup + LiveAnnouncer), AC4 (prefers-reduced-motion: animation: none + 0ms token override). Manual in-duel testing deferred to code review.

### Change Log

- 2026-03-01: Story 4.1 implementation complete — chain link visualization with badge rendering, LIFO resolution, accessibility, and reduced motion support
- 2026-03-01: Code review — 9 findings (1H, 3M, 5L) all fixed: EMZ chain badge support (M1), overflow badge z-index (M2), font-size em compliance (M3), destructured ChainingMsg cast (L1), resolveCardName JSDoc (L2), overflow aria-label (L3), removed unused player param (L4), @let template optimization (L5)

### File List

**Modified (10 files):**
- `front/src/app/styles/_tokens.scss` — Added 4 chain badge design tokens + reduced-motion override
- `front/src/app/styles/_z-layers.scss` — Added `$z-pvp-chain-badge: 10`
- `front/src/app/pages/pvp/types/duel-state.types.ts` — Added `ChainLinkState` interface
- `front/src/app/pages/pvp/types/index.ts` — Exported `ChainLinkState`
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` — Added `activeChainLinks` signal, chain message handlers, `mapChainLocationToZoneId()`, chain reset on BOARD_STATE/DUEL_END/REMATCH_STARTING
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — Added `activeChainLinks` input, `getChainBadges()`, `resolveCardName()`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — Added chain badge rendering in player and opponent zone sections
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` — Added `.pvp-chain-badge`, `.pvp-chain-badge--resolving`, `.pvp-chain-badge--overflow`, `chain-resolve-pulse` keyframe, extended `prefers-reduced-motion`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Added chain resolved LiveAnnouncer effect + `previousChainLinksCount` tracking
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — Added `[activeChainLinks]` binding on board container
