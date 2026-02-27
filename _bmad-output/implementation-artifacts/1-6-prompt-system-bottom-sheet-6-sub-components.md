# Story 1.6: Prompt System (Bottom Sheet + 6 Sub-Components)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **player**,
I want to respond to engine prompts via intuitive bottom-sheet dialogs with full context,
So that I understand every decision the engine asks me to make and can respond quickly.

## Acceptance Criteria

1. **PvpPromptSheetComponent (Container)** — Given `DuelWebSocketService` provides `pendingPrompt` and `hintContext` signals, when `PvpPromptSheetComponent` is implemented, then:
   - It positions as `position: absolute; bottom: 0` within `DuelPageComponent` (NOT CDK Overlay — avoids position recalculation bugs on iOS Safari)
   - It uses CDK Portal (`<ng-template cdkPortalOutlet>`) to inject the active prompt sub-component dynamically
   - It implements 6 states: `closed`, `opening`, `open`, `transitioning` (swap without close/reopen), `collapsed`, `closing`
   - It includes a collapse handle (▼ button) that reduces the sheet to a minimal bar ("Waiting for your response...") — allows board inspection during active prompt
   - It implements two-beat rendering: Beat 1 renders MSG_HINT context text in sheet header area; Beat 2 (~50ms after, via `setTimeout`) injects the interactive sub-component via CDK Portal
   - During Beat 1, the portal outlet has `pointer-events: none` (no phantom taps). Beat 2 sets `pointer-events: auto` and moves focus to first actionable element
   - If no `MSG_HINT` precedes the `SELECT_*`, it renders directly with a generic label (skip Beat 1)
   - CDK `FocusTrap` (`cdkTrapFocus`) is active when sheet is `open`, disabled during `collapsed` state via `[cdkTrapFocus]="sheetState() !== 'collapsed'"`
   - Keyboard shortcut `C` toggles collapse handle (collapse/expand)
   - Keyboard shortcut `Space` confirms the active selection (equivalent to tapping confirm button)
   - Height strategy uses `preferredHeight` per sub-component: `compact` = `clamp(60px, 20dvh, 100px)`, `full` = `height: auto; max-height: 55dvh`, or `number` (px) for variable
   - During `transitioning` state (consecutive prompts): sheet stays open, height animates to new `preferredHeight`, sub-component swaps via portal, MSG_HINT context flashes highlight (200ms)
   - On prompt resolution: response sent to server, buttons disabled, spinner if gap >500ms → "Sending..." visible
   - When `DUEL_END` arrives: all prompts cancelled instantly, sheet closes (no animation)
   - `overscroll-behavior: contain` on sheet container to prevent scroll chaining
   - Safe areas: `padding-inline: env(safe-area-inset-left, 0px)` and `env(safe-area-inset-right, 0px)` on content area
   - Prompt type → sub-component mapping (see Dev Notes §Protocol → Sub-Component Mapping)
   - Uses `ChangeDetectionStrategy.OnPush`

2. **PromptYesNoComponent (Pattern C — Compact Sheet)** — Given the prompt sheet exists, when `PromptYesNoComponent` is implemented, then:
   - It handles `SELECT_YESNO` and `SELECT_EFFECTYN` prompts
   - It displays MSG_HINT context text + card art thumbnail (when `hintContext` contains a card code) + two buttons
   - `preferredHeight` is `compact` (`clamp(60px, 20dvh, 100px)`)
   - Buttons: "Yes" / "No" (or "Effect Activation" / "Cancel" per Master Duel convention for SELECT_EFFECTYN)
   - Buttons have `min-height: 48px` touch targets (`--pvp-min-touch-target-primary`)
   - Primary action button (Yes/Activate) RIGHT, secondary (No/Cancel) LEFT
   - Keyboard: `Enter` = confirm primary, `Escape` = secondary (cancel)
   - Card art thumbnail uses `getCardImageUrl()` from `pvp-card.utils.ts`

3. **PromptCardGridComponent (Pattern B — Full Sheet)** — Given the prompt sheet exists, when `PromptCardGridComponent` is implemented, then:
   - It handles `SELECT_CARD`, `SELECT_CHAIN`, `SELECT_TRIBUTE`, `SELECT_SUM`, `SELECT_UNSELECT_CARD`
   - It displays a horizontal row of card thumbnails with name labels below each card
   - Adaptive layout: ≤4 cards → large thumbnails centered; 5–9 → standard side-by-side; 10–12 → horizontal scroll (`overflow-x: auto`); >12 → 2-row layout (threshold: `--pvp-card-grid-row-threshold: 12`)
   - Card height calculated relative to sheet available space, NOT viewport: `height: clamp(3rem, 12dvh, 5rem)` with `aspect-ratio: 59/86`
   - `preferredHeight` is `full` (`height: auto; max-height: 55dvh`)
   - Tap card → glow highlight (`--pvp-selection-glow`) + `transform: scale(1.05)` 150ms transition; confirm button always present
   - For multi-select prompts (`SELECT_TRIBUTE`, `SELECT_SUM`): tap to toggle selection, confirm appears when min/max constraints met
   - For `SELECT_UNSELECT_CARD`: toggle selection mode (selected cards have glow, tap to deselect)
   - Min/max selection constraints from server message are enforced — confirm disabled until valid
   - Empty state: if `cards.length === 0` → display "No valid targets", auto-respond after 1s, log anomaly
   - In-prompt card inspection: long press (500ms) on a card → opens `CardInspectorComponent` as temporary overlay above sheet. Release/tap elsewhere → inspector closes. Desktop hover shows tooltip
   - Card images use `getCardImageUrl()` from `pvp-card.utils.ts`

4. **PromptZoneHighlightComponent (Pattern A — Floating Instruction)** — Given the prompt sheet exists, when `PromptZoneHighlightComponent` is implemented, then:
   - It handles `SELECT_PLACE` and `SELECT_DISFIELD`
   - **No sheet is opened** — a floating instruction text appears centered on the board: `font-weight: 700`, background `rgba(0,0,0,0.6)` with `backdrop-filter: blur(2px)`, `pointer-events: none` (board interactive behind)
   - Eligible empty zones display numbered badges (24px+ size, `--pvp-min-touch-target` compliant): badges are essential because empty zones are visually identical, especially on opponent's field with perspective foreshortening
   - Highlight opacity increased for opponent's field zones — brighter/thicker border to compensate for foreshortening
   - Tap a zone badge → selection sent to server via `wsService.sendResponse()`, instruction + highlights disappear immediately (150ms fade)
   - The zone badges are rendered by adding CSS classes to existing zone elements in `PvpBoardContainerComponent` (communicate via signal or shared service, NOT by re-rendering zones)
   - `LiveAnnouncer` announces instruction text on appear. Highlighted elements have `aria-label="Zone [name]"`. Keyboard: `Tab` between highlighted elements, `Enter` to select
   - 150ms fade-in on appear, 150ms fade-out on disappear

5. **PromptOptionListComponent (Pattern B — Variable Height Sheet)** — Given the prompt sheet exists, when `PromptOptionListComponent` is implemented, then:
   - It handles `SELECT_POSITION`, `SELECT_OPTION`, `ANNOUNCE_RACE`, `ANNOUNCE_ATTRIB`
   - It displays a vertical list of `mat-button` options with optional icons
   - For `SELECT_POSITION`: shows ATK/DEF/Set position options with orientation icons
   - `preferredHeight` is `N × 48px` where N = number of options; falls back to `full` if N > 5 (scrollable list)
   - Tap option → option highlighted, confirm button present (consistent with always-confirm pattern)
   - Keyboard: arrow keys navigate options, `Enter` selects

6. **PromptNumericInputComponent (Pattern B — Compact Sheet)** — Given the prompt sheet exists, when `PromptNumericInputComponent` is implemented, then:
   - It handles `ANNOUNCE_NUMBER` and `SELECT_COUNTER`
   - Mode `declare`: free numeric input with validation (e.g., declare level for card effects)
   - Mode `counter`: stepper (−/+) buttons for selecting number of counters
   - Min/max constraints from server message are enforced; confirm disabled if value out of range
   - `preferredHeight` is `compact`

7. **PromptRpsComponent (Pattern B — Full Sheet)** — Given the prompt sheet exists, when `PromptRpsComponent` is implemented, then:
   - It handles `RPS_CHOICE` prompts (pre-duel Rock/Paper/Scissors)
   - Displays three large tap zones (Rock / Paper / Scissors) with icons
   - 30-second timeout → random selection if no choice
   - After both players choose: receives `RPS_RESULT` message → displays result text (Win/Lose/Draw)
   - If winner: show turn order selection ("Go First" / "Go Second") — this is a `SELECT_YESNO`-like choice forwarded to `PromptYesNoComponent`
   - Keyboard shortcuts: `1`/`2`/`3` for Rock/Paper/Scissors
   - `preferredHeight` is `full`

8. **Auto-Select Fallback** — Given any `SELECT_*` type not yet fully implemented (specifically `SORT_CARD`, `SORT_CHAIN`, `ANNOUNCE_CARD`), when the service receives it, then:
   - It auto-selects the first valid option and sends the response automatically via `wsService.sendResponse()`
   - A brief `mat-snackbar` notification: "Auto-selected: [prompt type]" (dev debugging aid)
   - This is the PvP-A0 fallback — prevents duel from hanging on rare/unimplemented prompts

9. **SELECT_IDLECMD / SELECT_BATTLECMD — NOT handled by prompt sheet** — These are distributed UI prompts handled in Story 1.7. In this story, they are set in `pendingPrompt` signal but the prompt sheet does NOT open for them. The sheet component must explicitly ignore these two types.

## Tasks / Subtasks

- [x] Task 1: Add PvP prompt design tokens + z-index layers (AC: all)
  - [x] 1.1 Add prompt-related tokens to `_tokens.scss`: `--pvp-prompt-sheet-compact`, `--pvp-prompt-sheet-max-height`, `--pvp-prompt-sheet-radius`, `--pvp-selection-glow`, `--pvp-card-grid-row-threshold`
  - [x] 1.2 Add z-index tokens to `_z-layers.scss`: `$z-pvp-prompt-sheet`, `$z-pvp-floating-instruction`, `$z-pvp-card-action-menu`

- [x] Task 2: Create PromptSubComponent interface + type-to-component mapping (AC: #1)
  - [x] 2.1 Create `front/src/app/pages/pvp/duel-page/prompts/prompt.types.ts` with `PromptSubComponent` interface (`preferredHeight: 'compact' | 'full' | number`) and prompt-type-to-component mapping constant
  - [x] 2.2 Define `PROMPT_COMPONENT_MAP: Record<string, Type<PromptSubComponent>>` mapping each SELECT_* type to its corresponding component class

- [x] Task 3: Create PvpPromptSheetComponent (AC: #1)
  - [x] 3.1 Scaffold standalone component at `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts` with OnPush
  - [x] 3.2 Implement 6-state machine (`closed` → `opening` → `open` → `transitioning` / `collapsed` / `closing` → `closed`)
  - [x] 3.3 Implement CDK Portal injection: resolve component from `PROMPT_COMPONENT_MAP`, create `ComponentPortal`, attach to `cdkPortalOutlet`
  - [x] 3.4 Implement two-beat rendering: Beat 1 (MSG_HINT context in header), setTimeout ~50ms, Beat 2 (inject sub-component via portal)
  - [x] 3.5 Implement Beat 1 input guard: `pointer-events: none` on portal outlet until Beat 2
  - [x] 3.6 Implement collapse handle: toggle between `open` ↔ `collapsed`, keyboard `C`
  - [x] 3.7 Implement `cdkTrapFocus` with dynamic enable/disable based on state
  - [x] 3.8 Implement height animation: read `preferredHeight` from attached sub-component, animate sheet to target height
  - [x] 3.9 Implement transitioning state: on consecutive prompt, swap portal content without close/reopen, animate height change
  - [x] 3.10 Implement optimistic response: buttons disabled after tap, spinner if >500ms, "Sending..." text
  - [x] 3.11 Implement DUEL_END handling: instant close, no animation
  - [x] 3.12 Wire `pendingPrompt` and `hintContext` signals from `DuelWebSocketService`
  - [x] 3.13 Handle keyboard shortcuts: `C` (collapse), `Space` (confirm)
  - [x] 3.14 Add `overscroll-behavior: contain`, safe area padding, border-radius `--pvp-prompt-sheet-radius`

- [x] Task 4: Create PromptYesNoComponent (AC: #2)
  - [x] 4.1 Scaffold at `front/src/app/pages/pvp/duel-page/prompts/prompt-yes-no/prompt-yes-no.component.ts`
  - [x] 4.2 Implement `PromptSubComponent` interface with `preferredHeight: 'compact'`
  - [x] 4.3 Display context text from MSG_HINT + card art thumbnail (if applicable)
  - [x] 4.4 Two buttons: primary RIGHT ("Yes"/"Effect Activation"), secondary LEFT ("No"/"Cancel")
  - [x] 4.5 Wire response output: emit selected value for sheet to send via `wsService.sendResponse()`

- [x] Task 5: Create PromptCardGridComponent (AC: #3)
  - [x] 5.1 Scaffold at `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts`
  - [x] 5.2 Implement `PromptSubComponent` interface with `preferredHeight: 'full'`
  - [x] 5.3 Implement adaptive card layout (≤4 large, 5–9 standard, 10–12 scroll, >12 two-row)
  - [x] 5.4 Implement tap-to-select with glow highlight + scale animation
  - [x] 5.5 Implement multi-select mode for SELECT_TRIBUTE, SELECT_SUM (min/max constraints)
  - [x] 5.6 Implement toggle mode for SELECT_UNSELECT_CARD
  - [x] 5.7 Implement empty state auto-respond
  - [x] 5.8 Implement long-press card inspection (500ms → CardInspector overlay)
  - [x] 5.9 Wire response output

- [x] Task 6: Create PromptZoneHighlightComponent (AC: #4)
  - [x] 6.1 Scaffold at `front/src/app/pages/pvp/duel-page/prompts/prompt-zone-highlight/prompt-zone-highlight.component.ts`
  - [x] 6.2 Implement floating instruction text overlay (centered, `pointer-events: none`, `backdrop-filter: blur`)
  - [x] 6.3 Implement zone highlight signal/service: communicate eligible zones to `PvpBoardContainerComponent` via a shared signal (e.g., `highlightedZones: Signal<Set<ZoneId>>`)
  - [x] 6.4 Implement numbered badges on eligible zones in `PvpBoardContainerComponent` (24px+ touch targets)
  - [x] 6.5 Implement zone tap → send response + fade out instruction
  - [x] 6.6 Add `LiveAnnouncer` + `aria-label` on highlighted zones

- [x] Task 7: Create PromptOptionListComponent (AC: #5)
  - [x] 7.1 Scaffold at `front/src/app/pages/pvp/duel-page/prompts/prompt-option-list/prompt-option-list.component.ts`
  - [x] 7.2 Implement `PromptSubComponent` with variable `preferredHeight` (N × 48px, max `full`)
  - [x] 7.3 Render vertical list of `mat-button` options with optional icons
  - [x] 7.4 Implement position-specific rendering for SELECT_POSITION (ATK/DEF icons)
  - [x] 7.5 Wire response output

- [x] Task 8: Create PromptNumericInputComponent (AC: #6)
  - [x] 8.1 Scaffold at `front/src/app/pages/pvp/duel-page/prompts/prompt-numeric-input/prompt-numeric-input.component.ts`
  - [x] 8.2 Implement `declare` mode (free input + validation) and `counter` mode (stepper −/+)
  - [x] 8.3 Enforce min/max from server message, disable confirm if out of range
  - [x] 8.4 Wire response output

- [x] Task 9: Create PromptRpsComponent (AC: #7)
  - [x] 9.1 Scaffold at `front/src/app/pages/pvp/duel-page/prompts/prompt-rps/prompt-rps.component.ts`
  - [x] 9.2 Implement 3 large tap zones (Rock/Paper/Scissors) with icons
  - [x] 9.3 Implement 30-second countdown timer with random fallback
  - [x] 9.4 Implement keyboard shortcuts: 1/2/3
  - [x] 9.5 Wire response output

- [x] Task 10: Implement auto-select fallback (AC: #8)
  - [x] 10.1 In `DuelWebSocketService.handleMessage()`, add auto-select logic for `SORT_CARD`, `SORT_CHAIN`, `ANNOUNCE_CARD`: immediately call `sendResponse()` with first valid option
  - [x] 10.2 Show brief `mat-snackbar` notification for debugging

- [x] Task 11: Integrate into DuelPageComponent (AC: #1, #9)
  - [x] 11.1 Add `<app-pvp-prompt-sheet>` to `duel-page.component.html`, wired to `wsService.pendingPrompt` and `wsService.hintContext`
  - [x] 11.2 Add prompt sheet z-index styling in `duel-page.component.scss`
  - [x] 11.3 Wire zone highlight interaction: PvpBoardContainerComponent consumes `highlightedZones` signal, renders badges, emits zone selection
  - [x] 11.4 Ensure `SELECT_IDLECMD` / `SELECT_BATTLECMD` are ignored by prompt sheet (Story 1.7 scope)
  - [x] 11.5 Build verification: `ng build --configuration=development` — zero errors

## Dev Notes

### Critical Architecture Context

- **PvpPromptSheetComponent is NOT the existing `BottomSheetComponent`** — The deck builder's `components/bottom-sheet/` uses snap-to-grid drag + `position: fixed` + 3 snap points (collapsed/half/full). The PvP prompt sheet is a different component: `position: absolute; bottom: 0` within the duel container, CDK Portal for dynamic sub-components, 6 states (not 3 snap points), no drag behavior. **Build from scratch — do NOT extend or import the existing bottom sheet.**
- **Architecture divergence resolved**: The architecture document shows 3 consolidated prompt files (`card-select-prompt`, `zone-select-prompt`, `choice-prompt`). The epics and UX spec define 6 specialized sub-components. **Follow the epics/UX spec (6 sub-components)** — per project convention, UX spec takes precedence on UI decisions.
- **Signal-based reactive architecture**: All state flows from `DuelWebSocketService` signals. Components MUST be read-only consumers — zero direct state mutation. Use `effect()` or `computed()` to react to `pendingPrompt` changes.
- **OnPush everywhere**: Every component uses `ChangeDetectionStrategy.OnPush`. Signal updates trigger change detection automatically.
- **Click-based interaction only**: PvP uses click/tap. No CDK DragDrop in prompt components.
- **No new npm dependencies**: Use existing Angular CDK (`PortalModule`, `A11yModule` for FocusTrap/LiveAnnouncer), Angular Material (`MatButtonModule`, `MatIconModule`). Everything needed is already in the project.

### Data Model Reference — Prompt Types

```typescript
// From duel-ws.types.ts — key prompt-related types

// The Prompt union (already defined in types/prompt.types.ts)
type Prompt =
  | SelectIdleCmdMsg      // Story 1.7 — NOT handled by prompt sheet
  | SelectBattleCmdMsg    // Story 1.7 — NOT handled by prompt sheet
  | SelectCardMsg         // → PromptCardGridComponent
  | SelectChainMsg        // → PromptCardGridComponent
  | SelectTributeMsg      // → PromptCardGridComponent
  | SelectSumMsg          // → PromptCardGridComponent
  | SelectUnselectCardMsg // → PromptCardGridComponent
  | SelectPlaceMsg        // → PromptZoneHighlightComponent
  | SelectDisfieldMsg     // → PromptZoneHighlightComponent
  | SelectPositionMsg     // → PromptOptionListComponent
  | SelectOptionMsg       // → PromptOptionListComponent
  | SelectYesNoMsg        // → PromptYesNoComponent
  | SelectEffectYnMsg     // → PromptYesNoComponent
  | SelectCounterMsg      // → PromptNumericInputComponent
  | AnnounceNumberMsg     // → PromptNumericInputComponent
  | AnnounceRaceMsg       // → PromptOptionListComponent
  | AnnounceAttribMsg     // → PromptOptionListComponent
  | AnnounceCardMsg       // → Auto-select fallback
  | SortCardMsg           // → Auto-select fallback
  | SortChainMsg          // → Auto-select fallback
  | RpsChoiceMsg;         // → PromptRpsComponent

// HintContext (from types/hint-context.types.ts)
interface HintContext {
  hintType: number;  // OCGCore HINT_TYPE_* constants
  player: number;    // 0 | 1
  value: number;     // Card code or effect-specific value
}

// DuelWebSocketService response method:
sendResponse(promptType: string, data: ResponseData): void
// Sends: { type: 'PLAYER_RESPONSE', promptType, data }
```

### Protocol → Sub-Component Mapping (Definitive)

| Server Message | Sub-Component | Visual Pattern | `preferredHeight` | Notes |
|---|---|---|---|---|
| `SELECT_PLACE` / `SELECT_DISFIELD` | PromptZoneHighlight | **A — Floating** | N/A (no sheet) | Numbered badges on eligible zones |
| `SELECT_CARD` | PromptCardGrid | **B — Full** | `full` | Hand cards duplicated in grid |
| `SELECT_UNSELECT_CARD` | PromptCardGrid | **B — Full** | `full` | Toggle selection mode |
| `SELECT_CHAIN` | PromptCardGrid | **B — Full** | `full` | Chain response card selection |
| `SELECT_TRIBUTE` | PromptCardGrid | **B — Full** | `full` | Multi-select with min/max |
| `SELECT_SUM` | PromptCardGrid | **B — Full** | `full` | Level/rank sum selection |
| `SELECT_POSITION` | PromptOptionList | **B — Compact** | `compact` | ATK/DEF/Set options with icons |
| `SELECT_OPTION` | PromptOptionList | **B — Variable** | `N × 48` | Generic option list |
| `ANNOUNCE_NUMBER` / `SELECT_COUNTER` | PromptNumericInput | **B — Compact** | `compact` | Declare mode / Counter stepper |
| `ANNOUNCE_RACE` / `ANNOUNCE_ATTRIB` | PromptOptionList | **B — Compact** | `compact` | Engine-provided options as list |
| `RPS_CHOICE` | PromptRps | **B — Full** | `full` | Pre-duel Rock/Paper/Scissors |
| `SELECT_YESNO` | PromptYesNo | **C — Yes/No** | `compact` | Binary choice with card art |
| `SELECT_EFFECTYN` | PromptYesNo | **C — Yes/No** | `compact` | Optional trigger confirmation |
| `SELECT_IDLECMD` / `SELECT_BATTLECMD` | **SKIP** | N/A | N/A | Story 1.7 distributed UI |
| `SORT_CARD` / `SORT_CHAIN` / `ANNOUNCE_CARD` | **Auto-select** | N/A | N/A | PvP-A0 fallback |

### CDK Portal Implementation Pattern

```typescript
// PvpPromptSheetComponent uses ComponentPortal for dynamic injection

import { ComponentPortal, PortalModule } from '@angular/cdk/portal';
import { ComponentRef, ViewContainerRef } from '@angular/core';

// Template:
// <ng-template cdkPortalOutlet></ng-template>

// In component class:
@ViewChild(CdkPortalOutlet) portalOutlet!: CdkPortalOutlet;

private attachPromptComponent(promptType: string): void {
  const componentType = PROMPT_COMPONENT_MAP[promptType];
  if (!componentType) return; // auto-select fallback handled elsewhere

  const portal = new ComponentPortal(componentType);
  const ref: ComponentRef<PromptSubComponent> = this.portalOutlet.attach(portal);

  // Pass prompt data to sub-component via signal input or direct property
  ref.instance.promptData = this.currentPrompt();
  ref.instance.hintContext = this.hintContext();

  // Read preferredHeight for sheet sizing
  this.currentHeight.set(ref.instance.preferredHeight);

  // Listen for response from sub-component
  ref.instance.response.subscribe(data => this.onPromptResponse(data));
}

private detachPromptComponent(): void {
  if (this.portalOutlet.hasAttached) {
    this.portalOutlet.detach();
  }
}
```

### CDK FocusTrap Pattern

```typescript
// Template:
// <div class="prompt-sheet" [cdkTrapFocus]="isSheetOpen()" [cdkTrapFocusAutoCapture]="true">

// Import: A11yModule from '@angular/cdk/a11y'
// The directive automatically traps Tab focus when active.
// Set to false during 'collapsed' state to release focus to board.
```

### Two-Beat Rendering Sequence

```
pendingPrompt changes (non-null, non-IDLECMD/BATTLECMD)
  │
  ├─ Beat 1: Immediately
  │   ├─ Set sheetState → 'opening' (if closed) or 'transitioning' (if already open)
  │   ├─ Render MSG_HINT context text in sheet header
  │   ├─ Set portal outlet to pointer-events: none
  │   └─ Animate sheet to target preferredHeight
  │
  └─ Beat 2: setTimeout(~50ms)
      ├─ Create ComponentPortal for the mapped sub-component
      ├─ Attach portal to outlet
      ├─ Pass prompt data + hint context to sub-component
      ├─ Set portal outlet to pointer-events: auto
      ├─ Move focus to first actionable element
      └─ Set sheetState → 'open'

If no MSG_HINT preceded SELECT_*:
  └─ Skip Beat 1, attach portal immediately with generic label
```

### Zone Highlight Communication Pattern (Pattern A)

PromptZoneHighlightComponent does NOT open the sheet. It needs to communicate eligible zones to PvpBoardContainerComponent. **Recommended pattern:**

```typescript
// Create a signal-based service or use a shared signal in DuelPageComponent:

// Option A: Signal in DuelPageComponent (simplest)
highlightedZones = signal<Set<ZoneId>>(new Set());
zoneInstruction = signal<string | null>(null);

// PvpBoardContainerComponent receives as input:
@Input() highlightedZones: Signal<Set<ZoneId>>;

// In zone template:
// [class.zone--highlighted]="highlightedZones().has(zone.zoneId)"
// Show numbered badge @if zone is highlighted

// On zone click (when highlighted):
// Emit zoneSelected output → DuelPageComponent sends response + clears highlights
```

### Response Flow

```
Sub-component emits response value
  → PvpPromptSheetComponent receives it
  → Calls wsService.sendResponse(promptType, responseData)
  → Sets sheet to "awaiting" state (buttons disabled, spinner)
  → Next server message arrives:
      - If new prompt → transitioning state (swap content)
      - If board update only → closing state (slide down)
      - If DUEL_END → instant close
```

### Design Tokens to Add

```scss
// Add to _tokens.scss under // === PvP Tokens ===

// Prompt Sheet
--pvp-prompt-sheet-compact: clamp(60px, 20dvh, 100px);
--pvp-prompt-sheet-max-height: 55dvh;
--pvp-prompt-sheet-radius: 1rem 1rem 0 0;
--pvp-prompt-sheet-bg: rgba(20, 20, 40, 0.95);

// Prompt Interaction
--pvp-selection-glow: 0 0 8px 2px rgba(201, 168, 76, 0.6);
--pvp-card-grid-row-threshold: 12;
--pvp-prompt-transition-speed: 300ms;

// Already exists — verify these are present:
// --pvp-min-touch-target-primary: 48px;
// --pvp-accent: #C9A84C;
// --pvp-animation-duration: 300ms;
```

### Z-Index Hierarchy to Add

```scss
// Add to _z-layers.scss

$z-pvp-floating-instruction: 60;  // Pattern A — above hand (50), pointer-events: none
$z-pvp-card-action-menu: 70;     // Story 1.7 — card action absolute div
$z-pvp-prompt-sheet: 80;         // Patterns B/C — above all except overlays
// Existing: $z-sheet: 100, $z-sheet-backdrop: 99 (deck builder — unrelated)
// Existing: $z-overlay: 2000 (connection overlays, result overlays)
```

### Component Tree (What This Story Creates)

```
DuelPageComponent (existing — modify template + add signals)
├── [orientation lock overlay] (existing)
├── PvpHandRowComponent [side='opponent'] (existing)
├── PvpBoardContainerComponent (existing — add zone highlight support)
│   └── Zone badges (NEW — conditional render when zone is highlighted)
├── PvpHandRowComponent [side='player'] (existing)
├── PvpPromptSheetComponent (NEW — CDK Portal container)          ← AC #1
│   ├── Sheet header (MSG_HINT context)
│   ├── CDK Portal outlet → injects one of:
│   │   ├── PromptYesNoComponent (NEW)                            ← AC #2
│   │   ├── PromptCardGridComponent (NEW)                         ← AC #3
│   │   ├── PromptOptionListComponent (NEW)                       ← AC #5
│   │   ├── PromptNumericInputComponent (NEW)                     ← AC #6
│   │   └── PromptRpsComponent (NEW)                              ← AC #7
│   └── Action buttons (Confirm / Cancel)
├── PromptZoneHighlightComponent (NEW — floating instruction)     ← AC #4
│   └── Instruction text overlay (pointer-events: none)
└── [connection overlay] (existing)
```

### File Structure (New Files)

```
front/src/app/pages/pvp/duel-page/prompts/
├── prompt.types.ts                           # PromptSubComponent interface + PROMPT_COMPONENT_MAP
├── pvp-prompt-sheet/
│   ├── pvp-prompt-sheet.component.ts
│   ├── pvp-prompt-sheet.component.html
│   └── pvp-prompt-sheet.component.scss
├── prompt-yes-no/
│   ├── prompt-yes-no.component.ts
│   ├── prompt-yes-no.component.html
│   └── prompt-yes-no.component.scss
├── prompt-card-grid/
│   ├── prompt-card-grid.component.ts
│   ├── prompt-card-grid.component.html
│   └── prompt-card-grid.component.scss
├── prompt-zone-highlight/
│   ├── prompt-zone-highlight.component.ts
│   ├── prompt-zone-highlight.component.html
│   └── prompt-zone-highlight.component.scss
├── prompt-option-list/
│   ├── prompt-option-list.component.ts
│   ├── prompt-option-list.component.html
│   └── prompt-option-list.component.scss
├── prompt-numeric-input/
│   ├── prompt-numeric-input.component.ts
│   ├── prompt-numeric-input.component.html
│   └── prompt-numeric-input.component.scss
└── prompt-rps/
    ├── prompt-rps.component.ts
    ├── prompt-rps.component.html
    └── prompt-rps.component.scss
```

### Modified Files

```
front/src/app/styles/_tokens.scss            # Add prompt tokens
front/src/app/styles/_z-layers.scss          # Add prompt z-index layers
front/src/app/pages/pvp/duel-page/
  duel-page.component.ts                     # Add prompt sheet + zone highlight integration
  duel-page.component.html                   # Add <app-pvp-prompt-sheet> + zone highlight signals
  duel-page.component.scss                   # Add prompt sheet z-index positioning
  pvp-board-container/
    pvp-board-container.component.ts         # Add highlightedZones input + zone badge rendering
    pvp-board-container.component.html       # Add zone highlight badges + CSS classes
    pvp-board-container.component.scss       # Add zone highlight + badge styles
  duel-web-socket.service.ts                 # Add auto-select fallback for SORT_*/ANNOUNCE_CARD
```

### Project Structure Notes

- All prompt components go under `front/src/app/pages/pvp/duel-page/prompts/` (one component per subfolder)
- Naming convention: `prompt-{name}.component.ts` (kebab-case files), `Prompt{Name}Component` (PascalCase classes)
- The container is `pvp-prompt-sheet.component.ts` (prefixed `pvp-` like other PvP containers)
- SCSS files colocated with their component (component-scoped styles)
- Standalone components: `standalone: true`, no NgModule declarations
- Signal-based inputs: `input<T>()` and `output<T>()` — NOT `@Input()`/`@Output()` decorators
- `ChangeDetectionStrategy.OnPush` on ALL components

### Previous Story Intelligence

**From Story 1.5 (PvP Board Display):**
- Pattern established: standalone + OnPush + signal inputs + colocated SCSS
- `PvpBoardContainerComponent` has zone rendering template — zone highlight badges must integrate here
- `PvpHandRowComponent` already emits `cardTapped` output (index) — can be used for hand card selection in prompt context
- pvp-card.utils.ts: `isFaceUp()`, `isDefense()`, `getCardImageUrl()` — reuse for card rendering in PromptCardGrid
- Design tokens in `_tokens.scss` (25+ `--pvp-*` properties) — extend, don't duplicate
- Z-layers in `_z-layers.scss` — add new layers above `$z-pvp-hand: 50`
- Code review lesson: grid-area names must match between TS and SCSS — verify consistency
- Code review lesson: use `[class.foo]` bindings carefully — `[class]` binding wipes base CSS classes. Use `[class.specific-class]` instead
- Build verification: always run `ng build --configuration=development` at the end

**From Story 1.4 (WebSocket Connection):**
- `DuelWebSocketService` already handles all SELECT_* by setting `pendingPrompt` signal
- `sendResponse(promptType, data)` is the response method — takes prompt type string + response data object
- MSG_HINT → SELECT_* → PLAYER_RESPONSE invariant: hint always set before prompt in the service
- `DUEL_END` clears `pendingPrompt` to null — prompt sheet must react and close instantly

**From Story 1.2 (Protocol Definition):**
- Protocol frozen at 49 message types — `duel-ws.types.ts` is source of truth
- Message naming: `SCREAMING_SNAKE_CASE` discriminants, `camelCase` fields, explicit `null` for absent values
- `PLAYER_RESPONSE` contains `promptType` (string matching the SELECT_* type) and `data` (variant per prompt type)

### Web Research Findings

**Angular CDK Portal (Feb 2026):**
- `ComponentPortal` creates a portal from a component type. Attach to `CdkPortalOutlet` directive
- `CdkPortalOutlet` is a directive (use `<ng-template cdkPortalOutlet>` in template)
- Import `PortalModule` from `@angular/cdk/portal` in component imports array
- For passing data to the portal component: use `ComponentPortal` constructor with optional `Injector`, or set properties directly on `ComponentRef.instance` after attachment
- `portalOutlet.attach(portal)` returns `ComponentRef<T>` — access instance, subscribe to outputs

**Angular CDK FocusTrap (Feb 2026):**
- `cdkTrapFocus` directive traps Tab key focus within an element
- `[cdkTrapFocusAutoCapture]="true"` auto-focuses first focusable element when trap activates
- Can be dynamically enabled/disabled by binding `[cdkTrapFocus]="condition"`
- Import `A11yModule` from `@angular/cdk/a11y`
- For `LiveAnnouncer`: inject `LiveAnnouncer` service, call `announce(message, priority)` for screen reader announcements

### Anti-Patterns to Avoid

- **Do NOT use the existing `BottomSheetComponent`** from `components/bottom-sheet/` — it's the deck builder's snap-to-grid sheet. Build `PvpPromptSheetComponent` from scratch
- **Do NOT use CDK Overlay** for prompt sheet positioning — use CSS `position: absolute; bottom: 0` within the duel container (avoids iOS Safari position bugs)
- **Do NOT use `@Input()` / `@Output()` decorators** — use signal-based `input()` / `output()`
- **Do NOT create NgModules** — all components are standalone
- **Do NOT handle SELECT_IDLECMD / SELECT_BATTLECMD** in the prompt sheet — these are Story 1.7 scope (distributed UI)
- **Do NOT use `mat-bottom-sheet`** (Angular Material bottom sheet service) — it creates an overlay with backdrop, which blocks board interaction. Build a custom absolute-positioned sheet
- **Do NOT block the board behind the sheet** — no backdrop, no `pointer-events: none` on the board. The sheet sits at the bottom, board visible and tappable above (except during Pattern B/C where FocusTrap is active for keyboard but touch still reaches board for inspection)
- **Do NOT mutate DuelWebSocketService signals directly** from components — only read via `.pendingPrompt()`, `.hintContext()`. Response goes through `sendResponse()`

### Deferred to Later Stories

- **Story 1.7**: Phase badge menu interaction (SELECT_IDLECMD/BATTLECMD distributed UI), card action glow, zone browser overlay, activation toggle (Auto/On/Off), card inspector integration during prompts
- **Story 2.x**: Lobby, room creation, waiting room
- **Story 3.x**: Surrender button (mini-toolbar), timer logic (full), disconnection handling, duel result screen
- **Story 4.x**: Chain visualization, animation queue playback

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 1 Story 1.6 Acceptance Criteria, §Protocol → Sub-Component Mapping]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — §PvpPromptSheetComponent, §Prompt Sub-Components (CDK Portal), §Prompt Interaction Patterns, §Bottom-Sheet Prompt Lifecycle, §Floating Instruction Lifecycle, §Collapse-to-Inspect, §Inspector During Prompt, §Button Hierarchy, §Card Selection Feedback]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — §Component Architecture, §Signal Coordination Rules, §Implementation Patterns, §FR → Structure Mapping (FR11, FR23)]
- [Source: _bmad-output/implementation-artifacts/1-5-pvp-board-display-css-3d-perspective.md — PvpBoardContainerComponent structure, PvpHandRowComponent cardTapped output, pvp-card.utils.ts, design tokens, z-layers]
- [Source: _bmad-output/implementation-artifacts/1-4-spring-boot-deck-relay-angular-websocket-connection.md — DuelWebSocketService 6 signals, sendResponse(), EMPTY_DUEL_STATE]
- [Source: _bmad-output/implementation-artifacts/1-2-duel-server-scaffold-protocol-definition.md — ws-protocol.ts frozen interface, PLAYER_RESPONSE format]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts — All SELECT_* message interfaces, Prompt union, ResponseData types]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts — pendingPrompt signal, hintContext signal, sendResponse method]
- [Source: front/src/app/pages/pvp/types/prompt.types.ts — Prompt union type definition]
- [Source: _bmad-output/project-context.md — Angular 19.1.3 standalone components, signal-based inputs, OnPush, TypeScript 5.5.4 strict]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build error: `private answered` inaccessible from template — changed to public in all 5 sub-components
- Build error: `portalOutlet?.hasAttached` is a method, not a property — added `()` call
- Both fixed and build passes with zero errors

### Completion Notes List

- All 11 tasks (55 subtasks) completed
- 6 new standalone components created under `prompts/` directory
- CDK Portal used for dynamic sub-component injection (EventEmitter for response, not signal output — CDK Portal requires programmatic `.subscribe()`)
- PromptZoneHighlightComponent uses Pattern A (floating instruction, no sheet) — rendered directly in DuelPageComponent template
- Auto-select fallback covers SORT_CARD, SORT_CHAIN, ANNOUNCE_CARD with MatSnackBar notification
- SELECT_IDLECMD / SELECT_BATTLECMD explicitly ignored via IGNORED_PROMPT_TYPES set
- Long-press card inspection (Task 5.8) scaffolded with touchstart/touchend handlers; CardInspectorComponent overlay integration deferred to Story 1.7
- `hasAttached` on CdkPortalOutlet is a method (not a getter) — requires `()` invocation

### Senior Developer Review (AI)

**Reviewer:** Axel (via Claude Opus 4.6)
**Date:** 2026-02-26
**Outcome:** Approved after fixes (26 issues found, all fixed)

**Fixes applied (26 total — 3 Critical, 7 High, 10 Medium, 6 Low):**

- **C1** Fixed: Task 5.8 long-press scaffold — added touchstart/touchend handlers in PromptCardGridComponent
- **C2** Fixed: Card name labels added below card thumbnails in PromptCardGridComponent
- **C3** Fixed: `@for track card.cardCode` → `track $index` (non-unique card codes with duplicates)
- **H1** Fixed: Subscription leak in PvpPromptSheetComponent — stored and unsubscribed in detachComponent
- **H2** Fixed: Timer leak in PromptCardGridComponent — added OnDestroy + clearTimeout
- **H3** Fixed: Collapse handle min-height 32px → 48px (touch target compliance)
- **H4** Fixed: PromptYesNoComponent + PromptCardGridComponent now use `getCardImageUrlByCode()` from pvp-card.utils.ts
- **H5** Fixed: RPS_CHOICE added to Prompt union type — removed `as unknown as Prompt` cast
- **H6** Fixed: SELECT_COUNTER response now creates proper-length counts array matching card count
- **H7** Fixed: Removed unused `computed` import from PromptNumericInputComponent
- **M1** Fixed: Added `aria-modal="true"` to prompt sheet dialog
- **M2** Fixed: Added `aria-live="polite"` to sending indicator, selection count, stepper value, RPS timer
- **M3** Fixed: Replaced fragile side-effect imports with explicit registry function in prompt-registry.ts
- **M4** Fixed: Improved type narrowing in confirm() methods (option-list, numeric-input)
- **M5** Fixed: Added `event.stopPropagation()` on Escape key in PromptYesNoComponent
- **M6** Fixed: Added Angular `@fadeInOut` animation trigger for zone highlight enter/leave transitions
- **M7** Fixed: Changed `role="listbox"` to `role="group"` with `aria-pressed` toggle buttons
- **M8** Fixed: Added `:focus-visible` outlines to all interactive elements across all sub-components
- **M9** Fixed: Added `max-height` to transition property on prompt sheet for height animation
- **M10** Fixed: Documented duel-page.component.scss in modified files list (z-index handled in component SCSS)
- **L1** Fixed: Extracted shared `.btn` styles to `_prompt-btn.scss` mixin, used across 4 components
- **L2** Fixed: Replaced hardcoded `#d4b65e` hover with `color-mix()` token-based calculation
- **L3** Fixed: Replaced hardcoded `150ms` transitions with `--pvp-animation-duration` token
- **L5** Fixed: Added `@media (prefers-reduced-motion)` to card-grid and RPS components
- **L6** Fixed: Changed `white-space: nowrap` → `normal` with `max-width: 80vw` on zone instruction
- **L7** Fixed: File count corrected in File List header

### File List

**New files (24):**
- `front/src/app/pages/pvp/duel-page/prompts/prompt.types.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-registry.ts`
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.html`
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.scss`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-yes-no/prompt-yes-no.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-yes-no/prompt-yes-no.component.html`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-yes-no/prompt-yes-no.component.scss`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.html`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.scss`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-zone-highlight/prompt-zone-highlight.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-zone-highlight/prompt-zone-highlight.component.html`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-zone-highlight/prompt-zone-highlight.component.scss`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-option-list/prompt-option-list.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-option-list/prompt-option-list.component.html`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-option-list/prompt-option-list.component.scss`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-numeric-input/prompt-numeric-input.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-numeric-input/prompt-numeric-input.component.html`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-numeric-input/prompt-numeric-input.component.scss`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-rps/prompt-rps.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-rps/prompt-rps.component.html`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-rps/prompt-rps.component.scss`
- `front/src/app/pages/pvp/duel-page/prompts/_prompt-btn.scss`

**Modified files (10):**
- `front/src/app/styles/_tokens.scss` — added prompt sheet + interaction tokens
- `front/src/app/styles/_z-layers.scss` — added 3 z-index layers
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — zone highlight signals, prompt integration
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — prompt sheet + zone highlight in template
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — highlightedZones input, zoneSelected output
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — zone highlight badges
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` — zone highlight styles
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` — auto-select fallback, pendingPrompt clearing
- `front/src/app/pages/pvp/pvp-card.utils.ts` — added getCardImageUrlByCode() utility
- `front/src/app/pages/pvp/types/prompt.types.ts` — added RpsChoiceMsg to Prompt union