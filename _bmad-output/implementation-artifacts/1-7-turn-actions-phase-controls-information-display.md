# Story 1.7: Turn Actions, Phase Controls & Information Display

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **player**,
I want to see my available actions on the board, control phase transitions, inspect cards, and configure my activation preferences,
So that I can play a complete turn with full information and strategic control.

## Acceptance Criteria

1. **Actionable Card Glow (SELECT_IDLECMD)** — Given the duel service receives `SELECT_IDLECMD` during Main Phase, when the distributed UI renders, then:
   - Cards with available actions pulse with `--pvp-actionable-glow` (subtle continuous pulse on `--pvp-accent`)
   - Tapping a card with 1 action sends the action directly to the server
   - Tapping a card with 2+ actions opens a Card Action Menu (absolute-positioned `<div>` at card position) with `<button>` items (e.g., "Normal Summon" / "Set" / "Activate Effect")
   - Tapping a menu item sends the action; tapping outside closes the menu
   - The menu has `role="menu"`, focus trapped, `Escape` closes, arrow keys navigate, `Enter` selects
   - Zone browsers (GY, Banished, ED) highlight actionable cards in action mode

2. **Battle Phase Actions (SELECT_BATTLECMD)** — Given the duel service receives `SELECT_BATTLECMD` during Battle Phase, when the distributed UI renders, then:
   - Attackable monsters pulse with `--pvp-actionable-glow`
   - Tapping a monster opens attack target selection (Card Action Menu or direct if 1 target)

3. **Phase Badge Menu (PvpPhaseBadgeComponent)** — Given `PvpPhaseBadgeComponent` is implemented, when it's the player's own turn, then:
   - Tapping the badge expands a menu with available phase transitions ("Battle Phase", "Main Phase 2", "End Turn") extracted from IDLECMD/BATTLECMD
   - Tapping a transition sends the response to the server; menu closes
   - The badge border shows accent color (`--pvp-accent`) during own turn
   - When it's the opponent's turn: badge shows current phase read-only (`opacity: 0.6`, non-interactive)

4. **Zone Browser Overlay (PvpZoneBrowserOverlayComponent)** — Given the overlay is implemented, when the player taps a GY, Banished, or Extra Deck zone, then:
   - A scrollable card list overlay opens with card name + art thumbnail
   - In browse mode (no active IDLECMD): tap card → `CardInspectorComponent`
   - In action mode (during IDLECMD): actionable cards show `--pvp-actionable-glow` + action label; tap actionable card with 1 action → sends directly; 2+ actions → Card Action Menu
   - Opponent Extra Deck shows face-down count only (not browsable individually)
   - The overlay is disabled during active prompt (use collapse handle to inspect board instead)

5. **Card Inspector PvP Variants** — Given `CardInspectorComponent` PvP variants are implemented, when the player taps any face-up card on the board or in a public zone, then:
   - Below 768px: compact variant (art 60x87px + name + type + ATK/DEF); tap to expand full text
   - At >=768px: full variant (large art + all stats + card text)
   - When a prompt arrives while inspector is expanded: inspector transitions to compact (not closed), repositions above the sheet
   - Tap compact → re-expand (temporary z-index bump); new prompt → back to compact

6. **Activation Toggle (PvpActivationToggleComponent)** — Given the toggle is implemented, when the player taps it (inside mini-toolbar, bottom-right, thumb zone), then:
   - It cycles through Auto → On → Off → Auto
   - Auto (default): client filters optional prompts based on OCGCore `MSG_HINT` type — prompts shown when HINT indicates game event context (activation response, summon response, attack response, end-of-phase). Not a hardcoded event list
   - On: prompts at every legal priority window
   - Off: auto-responds "No"/"Pass" to all optional prompts
   - Visible during own turn only, hidden during opponent's turn
   - Per-duel lifecycle: resets to Auto at duel start
   - `aria-label="Activation toggle: [current state]"`, `Space` to cycle (only when no prompt `FocusTrap` is active), `LiveAnnouncer` on change

7. **Mini-Toolbar** — Given the mini-toolbar is implemented, when the duel page renders, then:
   - The toolbar contains the surrender button (icon, placeholder — actual surrender logic in Epic 3) and the activation toggle
   - It is positioned `absolute, bottom-right` outside the CSS perspective container
   - Both elements have `min-height: 44px` touch target

## Tasks / Subtasks

- [x] Task 1: Add Story 1.7 design tokens + z-index layers (AC: all)
  - [x]1.1 Add `--pvp-actionable-glow` token to `_tokens.scss`: `0 0 6px 2px var(--pvp-accent)` + `@keyframes pvp-actionable-pulse` (1.5s infinite ease-in-out opacity 0.6→1→0.6)
  - [x]1.2 Add `--pvp-action-menu-bg`, `--pvp-action-menu-radius`, `--pvp-zone-browser-bg` tokens
  - [x]1.3 Add z-index token `$z-pvp-zone-browser: 65` to `_z-layers.scss` (between floating-instruction 60 and card-action-menu 70)
  - [x]1.4 Add `$z-pvp-mini-toolbar: 55` (above hand 50, below floating-instruction 60)
  - [x]1.5 Under `prefers-reduced-motion: reduce`, set `pvp-actionable-pulse` animation to `none` (static glow only)

- [x] Task 2: Create Card Action Menu in DuelPageComponent (AC: #1, #2)
  - [x]2.1 Implement as inline `<div>` in `DuelPageComponent` template (NOT in PvpBoardContainerComponent — the board uses CSS 3D perspective/rotateX on opponent field, which would visually distort the menu). The menu must render OUTSIDE the perspective container, positioned in viewport coordinates
  - [x]2.2 Position via `getBoundingClientRect()` of the tapped card element: PvpBoardContainerComponent emits `{ zoneId, element: HTMLElement, actions: CardAction[] }` via output, DuelPageComponent reads element rect and positions the menu `<div>` using `position: absolute; top/left` in viewport-relative coordinates
  - [x]2.3 Render `<button>` items for each available action from `SelectIdleCmdMsg` or `SelectBattleCmdMsg` data
  - [x]2.4 Map OCGCore action categories to labels: summons→"Normal Summon", specialSummons→"Special Summon", activations→"Activate Effect", setMonsters→"Set", setSpellTraps→"Set", repositions→"Change Position"
  - [x]2.5 On button tap: call `wsService.sendResponse('SELECT_IDLECMD', { action, index })` with mapped action code + card index; close menu
  - [x]2.6 Close on click-outside (document click listener, not CDK Overlay)
  - [x]2.7 Add `role="menu"`, `aria-label`, `Escape` to close, arrow key navigation between items, `Enter` to select
  - [x]2.8 Z-index: `$z-pvp-card-action-menu: 70`

- [x] Task 3: Implement IDLECMD/BATTLECMD distributed UI in PvpBoardContainerComponent (AC: #1, #2)
  - [x]3.1 Add `actionablePrompt` signal input (type `SelectIdleCmdMsg | SelectBattleCmdMsg | null`) from DuelPageComponent
  - [x]3.2 Add `actionResponse` output to emit response data back to DuelPageComponent
  - [x]3.3 Compute `actionableCards: Map<string, CardAction[]>` — map each zone+sequence key to its available actions, derived from IDLECMD/BATTLECMD message fields (summons, specialSummons, activations, attacks, etc.)
  - [x]3.4 Apply CSS class `zone-card--actionable` with `--pvp-actionable-glow` animation to cards present in `actionableCards` map
  - [x]3.5 On card tap: if 1 action → emit action directly via `actionResponse` output; if 2+ actions → emit `{ zoneId, element: event.target as HTMLElement, actions }` via `menuRequest` output so DuelPageComponent can open Card Action Menu positioned via `getBoundingClientRect()`
  - [x]3.6 For BATTLECMD attacks: tap attacker monster → if 1 target (or direct attack) → send directly; if 2+ targets → show target selection menu

- [x] Task 4: Extend PvpHandRowComponent for actionable glow (AC: #1)
  - [x]4.1 Add `actionableCardIndices` signal input (type `Set<number>`) from DuelPageComponent
  - [x]4.2 Apply `hand-card--actionable` CSS class with `--pvp-actionable-glow` pulse to actionable hand cards
  - [x]4.3 Update `onCardTap()`: if card is actionable with 1 action → emit action directly; 2+ actions → emit card index + position for DuelPageComponent to open Card Action Menu

- [x] Task 5: Upgrade PvpPhaseBadgeComponent with menu (AC: #3)
  - [x]5.1 Add `actionablePrompt` signal input (same `SelectIdleCmdMsg | SelectBattleCmdMsg | null`)
  - [x]5.2 Compute available transitions from prompt: if IDLECMD → `canBattlePhase` / `canEndPhase`; if BATTLECMD → `canMainPhase2` / `canEndPhase`
  - [x]5.3 Add expandable menu template: on badge tap (own turn only) → show vertical list of `<button>` items for available transitions
  - [x]5.4 Map transitions to response: "Battle Phase"→`{action: 6, index: null}`, "Main Phase 2"→`{action: 3, index: null}`, "End Turn"→`{action: 7, index: null}` (OCGCore action codes)
  - [x]5.5 Add `phaseAction` output to emit selected transition response
  - [x]5.6 Close menu on action selection, click-outside, or new prompt arrival
  - [x]5.7 Add `role="toolbar"` with `aria-label="Phase actions"`, arrow key navigation, `Enter` to select
  - [x]5.8 `LiveAnnouncer` announces phase changes

- [x] Task 6: Create PvpZoneBrowserOverlayComponent (AC: #4)
  - [x]6.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.ts` with OnPush
  - [x]6.2 Inputs: `zoneId: ZoneId`, `cards: CardOnField[]`, `playerIndex: number`, `actionableCardCodes: Set<number>` (empty set in browse mode), `mode: 'browse' | 'action'`
  - [x]6.3 Render scrollable vertical list of cards: card art thumbnail (via `getCardImageUrlByCode()`) + card name
  - [x]6.4 Browse mode: tap card → emit `inspectCard` output (card code for CardInspector)
  - [x]6.5 Action mode: actionable cards show `--pvp-actionable-glow` + action label; tap → emit `actionSelected` output (card code + action info)
  - [x]6.6 Opponent Extra Deck: show face-down count text only ("X cards"), no individual card listing
  - [x]6.7 Close on `Escape`, tap-outside, or when prompt sheet opens
  - [x]6.8 Z-index: `$z-pvp-zone-browser: 65`
  - [x]6.9 Add `role="dialog"`, `aria-label="[Zone name] browser"`, keyboard `Tab` between cards, `Enter` to select
  - [x]6.10 150ms fade-in/out animations (respects `prefers-reduced-motion`)

- [x] Task 7: Create PvpCardInspectorWrapperComponent (AC: #5)
  - [x]7.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.ts` with OnPush — this wraps the shared `CardInspectorComponent` to add PvP-specific behaviors WITHOUT modifying the shared component (solo simulator must not be affected)
  - [x]7.2 Inputs: `card: SharedCardInspectorData | null`, `promptActive: boolean` (true when pendingPrompt is non-null and not IDLECMD/BATTLECMD)
  - [x]7.3 Embed `<app-card-inspector [card]="card()" mode="dismissable">` inside the wrapper template
  - [x]7.4 Implement compact/full variant switching via native `matchMedia('(min-width: 768px)')` listener: below 768px render compact layout (art 60x87px + name + type + ATK/DEF), at >=768px delegate to full CardInspectorComponent
  - [x]7.5 On `promptActive` becoming true while inspector expanded: transition wrapper to compact state, reposition above prompt sheet via CSS (`bottom: calc(var(--pvp-prompt-sheet-max-height) + 8px)`)
  - [x]7.6 On compact wrapper tap: re-expand with temporary z-index bump above prompt sheet
  - [x]7.7 Emit `dismissed` output when inspector closed (propagate from inner CardInspectorComponent)
  - [x]7.8 Add `inspectedCard` signal in DuelPageComponent, wire `<app-pvp-card-inspector-wrapper>` in duel-page template
  - [x]7.9 Map `CardOnField.cardCode` → `SharedCardInspectorData` using existing card data service (check `CardService` or equivalent for `cardCode → card details` lookup)

- [x] Task 8: Create PvpActivationToggleComponent (AC: #6)
  - [x]8.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/pvp-activation-toggle/pvp-activation-toggle.component.ts` with OnPush
  - [x]8.2 Define `ActivationMode = 'auto' | 'on' | 'off'` type
  - [x]8.3 Internal state: `mode = signal<ActivationMode>('auto')`
  - [x]8.4 Cycle logic: tap → `auto→on→off→auto`
  - [x]8.5 Display current state label ("Auto" / "On" / "Off") with icon
  - [x]8.6 `modeChange` output emits new mode on each toggle
  - [x]8.7 `aria-label="Activation toggle: [current state]"`, `Space` to cycle, `LiveAnnouncer` announces mode on change
  - [x]8.8 Minimum touch target: `44px` (`--pvp-card-min-tap-target`)
  - [x]8.9 Visible only during own turn (controlled via `@if` by parent based on `duelState().turnPlayer`)

- [x] Task 9: Create Mini-Toolbar container (AC: #7)
  - [x]9.1 Implement as inline template section in `DuelPageComponent` (simple container, NOT a separate component)
  - [x]9.2 Position: `position: absolute; bottom: calc(var(--pvp-hand-card-height) + 8px); right: max(8px, env(safe-area-inset-right, 8px))`
  - [x]9.3 Contains: surrender `<button mat-icon-button>` (placeholder, disabled, flag icon) + `<app-pvp-activation-toggle>`
  - [x]9.4 Stacked vertically with `8px` gap between buttons
  - [x]9.5 Both elements: `min-height: 44px; min-width: 44px`
  - [x]9.6 Z-index: `$z-pvp-mini-toolbar: 55`
  - [x]9.7 During active prompt: `opacity: 0.6; pointer-events: none` (must collapse prompt sheet first to access)

- [x] Task 10: Wire DuelPageComponent orchestration (AC: all)
  - [x]10.1 Detect `SELECT_IDLECMD` / `SELECT_BATTLECMD` from `pendingPrompt` signal: route to `actionablePrompt` input on PvpBoardContainerComponent + PvpPhaseBadgeComponent + PvpHandRowComponent
  - [x]10.2 Wire `actionResponse` / `phaseAction` outputs: call `wsService.sendResponse(prompt.type, responseData)` to send response to server
  - [x]10.3 Wire zone pill click → open `PvpZoneBrowserOverlayComponent` with zone data from `duelState()` + actionable cards from current `actionablePrompt`
  - [x]10.4 Wire card inspector: board card tap / zone browser inspect → set `inspectedCard` signal
  - [x]10.5 Wire activation toggle `modeChange`: store mode in component, apply filter to `SELECT_EFFECTYN` / `SELECT_CHAIN` prompts — if mode is 'off' → auto-respond "No" via `wsService.sendResponse()`
  - [x]10.6 Compute `isOwnTurn` from `duelState().turnPlayer === 0` (player is always index 0)
  - [x]10.7 Ensure prompt sheet still ignores IDLECMD/BATTLECMD (already in `IGNORED_PROMPT_TYPES`)

- [x] Task 11: Build verification (AC: all)
  - [x]11.1 `ng build --configuration=development` — zero errors
  - [x]11.2 Verify all new components are OnPush + standalone
  - [x]11.3 Verify no new npm dependencies added
  - [x]11.4 Verify z-index hierarchy: mini-toolbar(55) < floating-instruction(60) < zone-browser(65) < card-action-menu(70) < prompt-sheet(80)

## Dev Notes

### Critical Architecture Context

- **SELECT_IDLECMD / SELECT_BATTLECMD are NOT prompt sheet prompts** — they are "distributed UI" prompts. The prompt sheet (`PvpPromptSheetComponent`) explicitly ignores them via `IGNORED_PROMPT_TYPES` set in `prompt.types.ts`. Story 1.7 renders these spatially: card glows on the board + inline Card Action Menu + phase badge menu. Do NOT route these to the prompt sheet.
- **Card Action Menu renders in DuelPageComponent, NOT inside PvpBoardContainerComponent** — The opponent field has CSS `transform: rotateX(15deg)` (3D perspective), which would visually distort any absolute-positioned element inside it. The menu is a lightweight inline `<div>` in DuelPageComponent (outside the perspective container), positioned via `getBoundingClientRect()` of the tapped card's DOM element. PvpBoardContainerComponent emits a `menuRequest` output with the element ref + actions; DuelPageComponent reads the rect and positions the menu. NOT a CDK Overlay, NOT `mat-menu`, NOT a separate component.
- **PvpPhaseBadgeComponent already exists as placeholder** — it currently displays phase abbreviation (DP/SP/M1/BP/M2/EP) with own-turn accent styling. Upgrade it to add an expandable menu with phase transition buttons. Do NOT rebuild from scratch.
- **CardInspectorComponent is SHARED — do NOT modify it** — reuse from `front/src/app/components/card-inspector/`. Create a `PvpCardInspectorWrapperComponent` that wraps it to add PvP-specific behaviors (compact/full variant switching, reposition above prompt sheet on prompt arrival, temporary z-index bump). This wrapper isolates PvP logic so the solo simulator's inspector is not affected.
- **Signal-based reactive architecture**: All state flows from `DuelWebSocketService` signals. Components are read-only consumers — zero direct state mutation.
- **OnPush everywhere**: Every component uses `ChangeDetectionStrategy.OnPush`.
- **Click-based interaction only**: PvP uses click/tap, NOT CDK DragDrop.
- **No new npm dependencies**: Use existing Angular CDK (`A11yModule` for LiveAnnouncer, FocusTrap) and Angular Material (`MatButtonModule`, `MatIconModule`).

### Data Model Reference — IDLECMD/BATTLECMD

```typescript
// From duel-ws.types.ts — key types for this story

interface SelectIdleCmdMsg {
  type: 'SELECT_IDLECMD';
  player: Player;
  summons: CardInfo[];        // Normal summon options
  specialSummons: CardInfo[]; // Special summon options
  repositions: CardInfo[];    // Change position options
  setMonsters: CardInfo[];    // Set monster face-down options
  activations: CardInfo[];    // Spell/trap/effect activation options
  setSpellTraps: CardInfo[];  // Set spell/trap options
  canBattlePhase: boolean;    // Phase badge: "Battle Phase" available
  canEndPhase: boolean;       // Phase badge: "End Turn" available
}

interface SelectBattleCmdMsg {
  type: 'SELECT_BATTLECMD';
  player: Player;
  attacks: CardInfo[];        // Attack declaration options
  activations: CardInfo[];    // Quick effect activation options
  canMainPhase2: boolean;     // Phase badge: "Main Phase 2" available
  canEndPhase: boolean;       // Phase badge: "End Turn" available
}

interface CardInfo {
  cardCode: number;           // OCG card code
  player: Player;             // 0 | 1
  location: CardLocation;     // LOCATION.HAND, LOCATION.MZONE, etc.
  sequence: number;           // Zone index (0-4 for M/S zones)
}

// Response format for both:
interface IdleCmdResponse { action: number; index: number | null; }
interface BattleCmdResponse { action: number; index: number | null; }
// Sent via: wsService.sendResponse('SELECT_IDLECMD', { action, index })
```

### IDLECMD Action Code Mapping

```typescript
// Extract these constants to a shared file:
// front/src/app/pages/pvp/duel-page/idle-action-codes.ts
// This prevents hardcoding magic numbers across components and eases
// maintenance if OCGCore changes action codes in future versions.

// OCGCore action codes for SELECT_IDLECMD responses
export const IDLE_ACTION = {
  SUMMON: 0,        // Normal Summon from summons[]
  SPECIAL_SUMMON: 1,// Special Summon from specialSummons[]
  REPOSITION: 2,    // Change position from repositions[]
  SET_MONSTER: 3,   // Set monster from setMonsters[]
  SET_SPELLTP: 4,   // Set spell/trap from setSpellTraps[]
  ACTIVATE: 5,      // Activate from activations[]
  BATTLE_PHASE: 6,  // Transition to Battle Phase
  END_TURN: 7       // End turn
} as const;

// OCGCore action codes for SELECT_BATTLECMD responses
export const BATTLE_ACTION = {
  ATTACK: 0,        // Attack from attacks[]
  ACTIVATE: 1,      // Activate from activations[]
  MAIN_PHASE_2: 2,  // Transition to Main Phase 2
  END_TURN: 3       // End turn (skip MP2)
} as const;
```

### Building the Actionable Cards Map

```typescript
// Derive from IDLECMD/BATTLECMD which cards have actions

interface CardAction {
  label: string;        // "Normal Summon", "Activate Effect", etc.
  actionCode: number;   // IDLE_ACTION.SUMMON, etc.
  index: number;        // Index within the source array
}

// Key format: `${location}-${sequence}` e.g., "HAND-2", "MZONE-3"
// IMPORTANT: For LOCATION.HAND, CardInfo.sequence matches the card's index in the
// player's hand array. Verify this holds in OCGCore — if sequence is 0-based hand index,
// it maps directly to PvpHandRowComponent's $index. If not, build a cardCode-based lookup instead.
type ActionableCardsMap = Map<string, CardAction[]>;

function buildActionableCards(msg: SelectIdleCmdMsg): ActionableCardsMap {
  const map = new Map<string, CardAction[]>();
  const add = (cards: CardInfo[], label: string, actionCode: number) => {
    cards.forEach((card, idx) => {
      const key = `${card.location}-${card.sequence}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ label, actionCode, index: idx });
    });
  };
  add(msg.summons, 'Normal Summon', IDLE_ACTION.SUMMON);
  add(msg.specialSummons, 'Special Summon', IDLE_ACTION.SPECIAL_SUMMON);
  add(msg.repositions, 'Change Position', IDLE_ACTION.REPOSITION);
  add(msg.setMonsters, 'Set', IDLE_ACTION.SET_MONSTER);
  add(msg.activations, 'Activate Effect', IDLE_ACTION.ACTIVATE);
  add(msg.setSpellTraps, 'Set', IDLE_ACTION.SET_SPELLTP);
  return map;
}
```

### Zone Browser Mode Logic

```typescript
// Browse mode: no active IDLECMD/BATTLECMD → read-only card list
// Action mode: active IDLECMD/BATTLECMD → actionable cards highlighted

// Mode determined by DuelPageComponent:
const zoneMode = computed(() =>
  actionablePrompt() ? 'action' : 'browse'
);

// Actionable card codes for the opened zone:
const actionableCodesForZone = computed(() => {
  const prompt = actionablePrompt();
  if (!prompt) return new Set<number>();
  // Filter actions by zone location (e.g., LOCATION.GRAVE for GY)
  const actions = prompt.type === 'SELECT_IDLECMD'
    ? [...prompt.activations, ...prompt.specialSummons]
    : [...prompt.activations];
  return new Set(
    actions.filter(a => a.location === zoneLocation).map(a => a.cardCode)
  );
});
```

### Activation Toggle Filter Logic

```typescript
// Applied in DuelPageComponent when processing pendingPrompt changes

function shouldAutoRespond(
  prompt: Prompt,
  mode: ActivationMode,
  hintContext: HintContext | null
): boolean {
  if (mode === 'on') return false;  // Show all prompts
  if (mode === 'off') {
    // Auto-respond "No" to optional prompts (SELECT_EFFECTYN, SELECT_CHAIN)
    // IMPORTANT: SELECT_CHAIN with cards.length === 0 means "pass" (no chain possible)
    // Only filter when cards.length > 0 — otherwise we'd filter a non-choice
    if (prompt.type === 'SELECT_CHAIN' && 'cards' in prompt && (prompt as any).cards.length === 0) {
      return false; // Let the service auto-pass naturally
    }
    return prompt.type === 'SELECT_EFFECTYN' || prompt.type === 'SELECT_CHAIN';
  }
  // mode === 'auto': filter based on MSG_HINT type
  // Show prompt when HINT indicates game event context
  // (activation response, summon response, attack response, end-of-phase)
  // This is intentionally NOT a hardcoded event list — use hintType classification
  if (prompt.type === 'SELECT_EFFECTYN' || prompt.type === 'SELECT_CHAIN') {
    return hintContext === null; // No hint = auto-decline
  }
  return false;
}
```

### Component Tree (What This Story Creates/Modifies)

```
DuelPageComponent (MODIFY — add orchestration for IDLECMD/BATTLECMD routing)
├── [orientation lock overlay] (existing)
├── PvpHandRowComponent [side='opponent'] (existing)
├── PvpHandRowComponent [side='player'] (MODIFY — add actionable glow)
├── PvpBoardContainerComponent (MODIFY — add actionable glow, emit menuRequest for multi-action cards)
│   ├── Zone cells with card rendering (MODIFY — add actionable CSS class)
│   ├── PvpLpBadgeComponent (existing)
│   ├── Central Strip
│   │   ├── EMZ zones (existing)
│   │   ├── PvpTimerBadgeComponent (existing)
│   │   └── PvpPhaseBadgeComponent (MODIFY — add expandable phase menu)
│   └── Zone pills GY/Banished/ED (existing click handler → now opens browser)
├── Card Action Menu <div> (NEW — inline absolute template, positioned via getBoundingClientRect)
├── PvpZoneBrowserOverlayComponent (NEW — scrollable card list overlay)
├── PvpCardInspectorWrapperComponent (NEW — wraps shared CardInspectorComponent with PvP behaviors)
│   └── CardInspectorComponent (existing shared — mode="dismissable")
├── PvpPromptSheetComponent (existing — no changes, already ignores IDLECMD/BATTLECMD)
├── PromptZoneHighlightComponent (existing)
├── Mini-Toolbar container (NEW — inline template in DuelPageComponent)
│   ├── Surrender button (placeholder, disabled)
│   └── PvpActivationToggleComponent (NEW — Auto/On/Off toggle)
└── [connection overlay] (existing)
```

### File Structure (New Files)

```
front/src/app/pages/pvp/duel-page/
├── idle-action-codes.ts                         # IDLE_ACTION + BATTLE_ACTION constants (shared)
├── pvp-zone-browser-overlay/
│   ├── pvp-zone-browser-overlay.component.ts
│   ├── pvp-zone-browser-overlay.component.html
│   └── pvp-zone-browser-overlay.component.scss
├── pvp-card-inspector-wrapper/
│   ├── pvp-card-inspector-wrapper.component.ts
│   ├── pvp-card-inspector-wrapper.component.html
│   └── pvp-card-inspector-wrapper.component.scss
├── pvp-activation-toggle/
│   ├── pvp-activation-toggle.component.ts
│   ├── pvp-activation-toggle.component.html
│   └── pvp-activation-toggle.component.scss
```

### Modified Files

```
front/src/app/styles/_tokens.scss              # Add actionable-glow, action-menu, zone-browser tokens
front/src/app/styles/_z-layers.scss            # Add $z-pvp-zone-browser, $z-pvp-mini-toolbar

front/src/app/pages/pvp/duel-page/
  duel-page.component.ts                       # IDLECMD/BATTLECMD routing, Card Action Menu positioning (getBoundingClientRect), inspector wrapper, activation toggle, mini-toolbar, zone browser orchestration
  duel-page.component.html                     # Add Card Action Menu <div>, zone-browser, inspector wrapper, mini-toolbar, pass actionablePrompt to children
  duel-page.component.scss                     # Card Action Menu absolute positioning, mini-toolbar positioning, zone-browser z-index

  pvp-board-container/
    pvp-board-container.component.ts           # Add actionablePrompt input, actionableCards computed, menuRequest output, card tap → action/menu logic
    pvp-board-container.component.html         # Add actionable CSS class on cards, zone pill click → emit
    pvp-board-container.component.scss         # Add --pvp-actionable-glow animation styles

  pvp-hand-row/
    pvp-hand-row.component.ts                  # Add actionableCardIndices input
    pvp-hand-row.component.html                # Add actionable CSS class on hand cards
    pvp-hand-row.component.scss                # Add --pvp-actionable-glow for hand cards

  pvp-phase-badge/
    pvp-phase-badge.component.ts               # Add actionablePrompt input, expandable menu state, phaseAction output
    pvp-phase-badge.component.html             # Add expandable menu template
    pvp-phase-badge.component.scss             # Add menu styles, expanded state
```

### Project Structure Notes

- New components go under `front/src/app/pages/pvp/duel-page/` in sub-folders (one component per folder)
- Naming convention: `pvp-{name}.component.ts` (kebab-case files, PascalCase classes)
- Card Action Menu is NOT a separate component — inline `<div>` template in DuelPageComponent (NOT in board container due to 3D perspective distortion; positioned via getBoundingClientRect)
- Mini-Toolbar is NOT a separate component — inline template section in DuelPageComponent (only 2 buttons)
- SCSS files colocated with their component (component-scoped styles)
- Standalone components: `standalone: true`, no NgModule declarations
- Signal-based inputs: `input<T>()` and `output<T>()` — NOT `@Input()`/`@Output()` decorators
- `ChangeDetectionStrategy.OnPush` on ALL components

### Previous Story Intelligence

**From Story 1.6 (Prompt System):**
- `IGNORED_PROMPT_TYPES = new Set(['SELECT_IDLECMD', 'SELECT_BATTLECMD'])` — prompt sheet explicitly skips these. Confirmed working. Story 1.7 handles them via distributed UI instead.
- `DuelWebSocketService.pendingPrompt` signal contains both IDLECMD/BATTLECMD AND regular prompts — DuelPageComponent must route IDLECMD/BATTLECMD to board container / phase badge while regular prompts still go to prompt sheet
- CDK Portal + EventEmitter pattern used for prompt sub-components (not signal output — CDK Portal requires programmatic `.subscribe()`)
- `getCardImageUrlByCode(cardCode: number)` exists in `pvp-card.utils.ts` — reuse for zone browser card thumbnails
- `_prompt-btn.scss` mixin exists for shared button styles — reuse for Card Action Menu buttons if appropriate
- Prompt sheet z-index = `$z-pvp-prompt-sheet: 80` — Card Action Menu at 70 sits below, zone browser at 65 sits below that
- Code review lesson: `[class]` binding wipes base CSS classes — use `[class.specific-class]` instead
- Code review lesson: `@for track $index` for non-unique card codes (cards can be duplicated)
- `hasAttached` on CdkPortalOutlet is a method, requires `()` invocation

**From Story 1.5 (Board Display):**
- `PvpBoardContainerComponent` renders zone grid with `FIELD_ZONE_IDS` constant and `ZONE_GRID_AREA` mapping
- `onZonePillClick(zoneId, playerIndex)` is a placeholder method — wire to zone browser overlay
- Zone pills (GY/Banished/ED) already have `(click)="onZonePillClick(zone.zoneId, 0)"` in template
- `PvpHandRowComponent.cardTapped` output emits card index — currently unhandled in DuelPageComponent
- `pvp-card.utils.ts`: `isFaceUp()`, `isDefense()`, `getCardImageUrl()`, `getCardImageUrlByCode()` — reuse all
- Board grid-area names: `mz1`-`mz5`, `st1`-`st5`, `field`, `gy`, `banish`, `ed`, `deck`, `lp` — match exactly in SCSS
- Player is ALWAYS `players[0]`, opponent is ALWAYS `players[1]` (server orients per-player)

**From Story 1.4 (WebSocket Connection):**
- `DuelWebSocketService.sendResponse(promptType: string, data: ResponseData)` — sets `pendingPrompt` to null after sending
- `pendingPrompt` signal contains IDLECMD/BATTLECMD messages when player has actions available
- MSG_HINT → SELECT_* invariant: `hintContext` always set before `pendingPrompt`
- `DUEL_END` clears `pendingPrompt` to null — all action UI must react and close

**From Story 1.2 (Protocol Definition):**
- Protocol frozen at 49 message types — `duel-ws.types.ts` is source of truth
- `PLAYER_RESPONSE` contains `promptType` (string matching SELECT_* type) and `data` (variant per prompt type)
- `CardInfo` interface: `{ cardCode, player, location, sequence }` — location is enum, sequence is zone index

### Web Research Findings

**Angular CDK LiveAnnouncer (Feb 2026):**
- Inject `LiveAnnouncer` from `@angular/cdk/a11y`, call `announce(message, priority)` for screen reader announcements
- Use 'polite' (default) for non-urgent updates, 'assertive' for critical state changes
- Service-based approach (inject + call) is more testable than `aria-live` attributes
- Available in Angular 19.x via `A11yModule` import

**Angular CDK FocusTrap (Feb 2026):**
- `cdkTrapFocus` directive: `[cdkTrapFocus]="condition"` for dynamic enable/disable
- `[cdkTrapFocusAutoCapture]="true"` auto-focuses first focusable element when trap activates
- Used in Story 1.6 prompt sheet — do NOT add a second focus trap for Card Action Menu (it's too lightweight). Use document click listener for close-on-outside instead

**Angular Signals (Feb 2026):**
- Prefer `computed()` for derived state (pure, synchronous, cached)
- Use `effect()` only for syncing to imperative APIs — last resort
- `input()` / `input.required()` for signal-based component inputs
- All signal APIs are synchronous

### Anti-Patterns to Avoid

- **Do NOT use CDK Overlay or `mat-menu`** for Card Action Menu — it's too heavyweight for 50-100 uses per duel. Use a simple absolute-positioned `<div>` with document click listener
- **Do NOT render Card Action Menu inside PvpBoardContainerComponent** — the opponent field has CSS `rotateX(15deg)` which would distort the menu. Render in DuelPageComponent, position via `getBoundingClientRect()` of the card element
- **Do NOT create a separate component** for Card Action Menu or Mini-Toolbar — inline templates are appropriate for these small, frequently-used UI elements
- **Do NOT rebuild PvpPhaseBadgeComponent from scratch** — it's a working placeholder. Only ADD the expandable menu
- **Do NOT modify the shared CardInspectorComponent** — create `PvpCardInspectorWrapperComponent` to add PvP behaviors (compact/full, reposition, z-index bump). The wrapper embeds the shared inspector internally
- **Do NOT use `@Input()` / `@Output()` decorators** — use signal-based `input()` / `output()`
- **Do NOT add CDK DragDrop** — PvP is click-based only
- **Do NOT route IDLECMD/BATTLECMD to the prompt sheet** — they are distributed UI, not modal prompts
- **Do NOT mutate DuelWebSocketService signals** from components — read-only consumers, response goes through `sendResponse()`
- **Do NOT use `[class]` binding** — it wipes base CSS classes. Use `[class.specific-class]` instead
- **Do NOT use `vh`/`vw` units** in duel view — use `dvh`/`dvw` (dynamic viewport)
- **Do NOT add `position: fixed`** on overlays inside the duel container — use `position: absolute` (avoids iOS Safari bugs with CSS perspective)

### Deferred to Later Stories

- **Story 2.x**: Lobby, room creation, waiting room, deck validation
- **Story 3.1**: Surrender button actual logic (currently placeholder in mini-toolbar)
- **Story 3.2**: Turn timer logic (PvpTimerBadgeComponent is placeholder)
- **Story 3.3**: Disconnection handling, reconnection
- **Story 3.4**: Duel result screen, rematch
- **Story 4.1**: Chain link visualization
- **Story 4.2**: Game event visual feedback, animation queue playback

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 1 Story 1.7 Acceptance Criteria]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — §Card Action Menu, §PvpPhaseBadgeComponent, §PvpZoneBrowserOverlayComponent, §CardInspectorComponent Variants, §PvpActivationToggleComponent, §Mini-Toolbar, §Actionable Glow, §Z-Index Hierarchy, §Touch Targets, §Accessibility]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — §Component Architecture, §Signal Coordination Rules, §SELECT_IDLECMD/BATTLECMD Distributed UI, §Activation Toggle FR25, §MSG_HINT Filtering]
- [Source: _bmad-output/implementation-artifacts/1-6-prompt-system-bottom-sheet-6-sub-components.md — IGNORED_PROMPT_TYPES, prompt-registry.ts, CDK Portal pattern, getCardImageUrlByCode, z-layers, code review lessons]
- [Source: _bmad-output/implementation-artifacts/1-5-pvp-board-display-css-3d-perspective.md — PvpBoardContainerComponent zone grid, PvpHandRowComponent cardTapped, pvp-card.utils.ts, design tokens, zone pill click placeholder]
- [Source: _bmad-output/implementation-artifacts/1-4-spring-boot-deck-relay-angular-websocket-connection.md — DuelWebSocketService signals, sendResponse(), EMPTY_DUEL_STATE]
- [Source: _bmad-output/implementation-artifacts/1-2-duel-server-scaffold-protocol-definition.md — ws-protocol.ts frozen interface, CardInfo, PLAYER_RESPONSE format]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts — SelectIdleCmdMsg, SelectBattleCmdMsg, CardInfo, IdleCmdResponse, BattleCmdResponse]
- [Source: front/src/app/pages/pvp/duel-page/prompts/prompt.types.ts — IGNORED_PROMPT_TYPES, Prompt union type]
- [Source: front/src/app/pages/pvp/pvp-card.utils.ts — getCardImageUrlByCode(), isFaceUp(), isDefense()]
- [Source: front/src/app/components/card-inspector/card-inspector.component.ts — SharedCardInspectorData, mode input, dismissable behavior]
- [Source: front/src/app/styles/_tokens.scss — existing --pvp-* tokens, --pvp-accent: #C9A84C]
- [Source: front/src/app/styles/_z-layers.scss — existing z-layer hierarchy: hand(50), floating-instruction(60), card-action-menu(70), prompt-sheet(80)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build error: `SharedCardInspectorData` cast — resolved via `as unknown as SharedCardInspectorData` (PvP inspector only has cardCode, full data model TBD)
- Build error: `actionResponse` type mismatch (`index: null` from phase badge) — resolved by widening output type to `number | null`

### Completion Notes List

- All 11 tasks completed across 2 context windows (context limit reached mid-Task 9)
- Pre-existing warning in `lobby-page.component.ts` (unused RouterLink import) — not related to this story
- Card inspector shows `Card #XXXX` placeholder name + card art image — full card name lookup requires a card data service not yet available in PvP context

### File List

**New files created:**
- `front/src/app/pages/pvp/duel-page/idle-action-codes.ts`
- `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.scss`
- `front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.scss`
- `front/src/app/pages/pvp/duel-page/pvp-activation-toggle/pvp-activation-toggle.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-activation-toggle/pvp-activation-toggle.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-activation-toggle/pvp-activation-toggle.component.scss`

**Modified files:**
- `front/src/app/styles/_tokens.scss` — Added actionable glow, action menu, zone browser tokens + keyframes + reduced-motion
- `front/src/app/styles/_z-layers.scss` — Added `$z-pvp-mini-toolbar: 55`, `$z-pvp-zone-browser: 65`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Full orchestration wiring (Task 2, 9, 10)
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — Card Action Menu, zone browser, inspector, mini-toolbar, component bindings
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss` — Card Action Menu + mini-toolbar styles
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — actionablePrompt input, actionResponse/menuRequest/zonePillRequest outputs, actionable cards logic
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — Actionable glow classes, zone pill/card click handlers, phase badge wiring
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` — Actionable glow animation styles
- `front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts` — actionableCardIndices input, handCardAction output
- `front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.html` — Actionable class binding, event forwarding
- `front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.scss` — Actionable glow styles
- `front/src/app/pages/pvp/duel-page/pvp-phase-badge/pvp-phase-badge.component.ts` — Rewritten with expandable menu, phaseAction output, LiveAnnouncer
- `front/src/app/pages/pvp/duel-page/pvp-phase-badge/pvp-phase-badge.component.html` — Rewritten with menu template
- `front/src/app/pages/pvp/duel-page/pvp-phase-badge/pvp-phase-badge.component.scss` — Rewritten with menu styles

### Change Log

| Change | Reason |
|--------|--------|
| `actionResponse` output type widened to `number \| null` for index | Phase transitions have no card index (`null`), card actions have numeric index |
| `onPhaseAction` method removed from DuelPageComponent | Phase actions now flow through board container's `actionResponse` output, avoiding duplicate handler |
| [CR-C1] `inspectCardByCode` builds proper `SharedCardInspectorData` with `getCardImageUrlByCode` | Previous `as unknown` cast produced undefined fields — now shows placeholder name + card art |
| [CR-C2] `hasActivePrompt` excludes IDLECMD/BATTLECMD | Mini-toolbar was disabled during player's turn — IDLECMD/BATTLECMD are distributed UI, not blocking prompts |
| [CR-H2] `zoneBrowserActionableCodes` computed wired to zone browser | `actionableCardCodes` input was never bound — action mode couldn't highlight cards |
| [CR-H3] `onZoneBrowserAction` handler + zone browser emits `element` ref | `actionSelected` emitted empty actions and wasn't handled — clicking actionable cards in browser now works |
| [CR-H4] Auto mode uses `hintContext.hintType` to filter optional prompts | Was completely stubbed (identical to 'on' mode) — now auto-declines when no MSG_HINT context |
| [CR-M1] Activation toggle wrapped in `@if (isOwnTurn())` | Was always visible — AC #6 requires hidden during opponent's turn |
| [CR-M2] `forceExpanded` signal in card inspector wrapper | `onCompactTap` was no-op when prompt active — now re-expands temporarily per AC #5 |
| [CR-M3] Phase badge menu items `min-height: 44px` | Was 36px — below project's `--pvp-card-min-tap-target` standard |
| [CR-M4] Zone browser blocked during active non-IDLECMD prompt | Could open during SELECT_CARD etc. — AC #4 requires disabled during active prompt |
| [CR-M5] Phase badge menu closes on `actionablePrompt` change via effect | Menu stayed open on new prompt arrival — Task 5.6 requires close |
| [CR-L1] Zone browser fade-out animation (150ms) | Only fade-in existed — Task 6.10 specifies fade-in/out |
| [CR-L2] Removed 6 unnecessary `as unknown as ResponseData` casts | `ResponseData = Record<string, unknown>` already accepts any object literal |
| [CR-L3] `openCardActionMenu` uses `visualViewport` API | `window.innerWidth/innerHeight` may differ from visual viewport on mobile |
