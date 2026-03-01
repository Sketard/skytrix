# Story 5.1: Card Inspector PvP Placeholder

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to long-press or click a card on the PvP board to open a card inspector overlay,
So that I can read card effects and check stats during a duel.

## Acceptance Criteria

### AC1: Board Card Tap → Inspector

**Given** a card is displayed on the PvP board in any field zone (monster, spell/trap, field, EMZ)
**When** the player taps/clicks the card and it has NO actionable prompt actions available
**Then** `CardInspectorComponent` opens via `PvpCardInspectorWrapperComponent` showing full card image, name, description, ATK/DEF, and card type
**And** if the card IS actionable (has prompt actions), the existing action/menu flow takes priority — inspector does not open

### AC2: Hand Card Tap → Inspector

**Given** a card is in the player's hand
**When** the player taps a hand card that has NO actionable prompt actions available
**Then** the inspector opens showing the card's full details
**And** opponent hand cards (face-down, cardCode = 0) show only the card back image with "Unknown card" label

### AC3: Zone Browser Card Tap → Inspector

**Given** the zone browser overlay is open (GY, Banished, Extra) in `browse` mode (no actionable prompt)
**When** the player taps a card in the zone browser
**Then** the inspector opens showing the card's full details

### AC4: Prompt Card Grid Long-Press → Inspector

**Given** a prompt is active showing `PromptCardGridComponent` (SELECT_CARD, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD)
**When** the player long-presses (500ms hold) a card in the prompt grid
**Then** the inspector opens as a temporary overlay (z-index above prompt sheet)
**And** tap on prompt card (short tap) still performs selection (existing behavior unchanged)
**And** the long-press timer is cancelled if the finger moves or lifts before 500ms
**And** the inspector opens in **full mode** (not compact) — the player explicitly requested to read the effect

### AC5: Inspector Auto-Close on Prompt Arrival

**Given** the inspector is open
**When** a new prompt appears (from `visiblePrompt` becoming non-null)
**Then** the inspector transitions to compact mode (per existing `PvpCardInspectorWrapperComponent` behavior with `[promptActive]="true"`)
**And** the prompt is never obscured by the inspector (prompt z-index wins per UX spec)

### AC6: Inspector Dismiss Behavior

**Given** the inspector is open
**When** the player taps outside the inspector or presses Escape
**Then** the inspector closes
**And** `CardInspectorComponent` mode remains `dismissable` (existing behavior)

### AC7: Full Card Data Resolution

**Given** the player inspects a card with a known `cardCode` (> 0)
**When** `inspectCardByCode()` is called
**Then** the inspector shows the full card details: name, full card image, description, ATK/DEF (for monsters), card type, attribute, race, level/rank/link
**And** card data is fetched from the backend via `GET /api/cards/code/{cardCode}` and cached client-side for the duel duration
**And** while loading, the inspector shows the card image immediately (already available via URL) with a loading indicator for text details
**And** once cached, subsequent inspections of the same card are instant (no network request)

### AC8: Accessibility

**Given** the inspector is open
**When** a screen reader user interacts with the card inspector
**Then** `aria-live="polite"` announces the card name and basic stats (existing `CardInspectorComponent` behavior)
**And** Escape key closes the inspector (existing behavior)

## Tasks / Subtasks

**Task dependency order:** Task 1 → Task 2 → Task 7 (backend endpoint must exist before cache service can call it, cache must exist before replacing placeholder). Tasks 3-6 can be done in parallel after Task 2.

- [x] Task 1: Backend — Card detail endpoint (AC: #7)
  - [x] 1.1 Add `GET /api/cards/code/{cardCode}` endpoint in Spring Boot controller — returns `CardDetail` JSON (name, description, ATK, DEF, type, attribute, race, level, scale, linkval, imageUrl)
  - [x] 1.2 Query the existing card database by `card.code = cardCode` (the `code` field matches OCGCore's card code)
  - [x] 1.3 Return 404 if card code not found
  - [x] 1.4 Verify endpoint works for known card codes (e.g., Dark Magician = 46986414)

- [x] Task 2: Frontend — CardDataCacheService (AC: #7)
  - [x] 2.1 Create `front/src/app/pages/pvp/duel-page/card-data-cache.service.ts` — injectable service scoped to `DuelPageComponent` (provided in component's `providers` array, same pattern as `DuelWebSocketService`)
  - [x] 2.2 Implement `getCardData(cardCode: number): Promise<SharedCardInspectorData>`:
    - Check in-memory `Map<number, SharedCardInspectorData>` cache first
    - If miss: `GET /api/cards/code/${cardCode}`, map response to `SharedCardInspectorData`, cache result, return
    - If cardCode === 0 or null: return a "card back" placeholder (name: "Face-down card", imageUrl: card back)
  - [x] 2.3 Implement `clearCache(): void` — called on duel end, rematch
  - [x] 2.4 Use `inject(HttpClient)` for the HTTP call, no new dependencies

- [x] Task 3: Wire board card tap → inspector (AC: #1)
  - [x] 3.1 In `PvpBoardContainerComponent`, modify `onZoneCardClick()`: if `getActionsForZone(zone.zoneId)` returns empty AND `zone.card.cardCode` is truthy → emit new `cardInspectRequest` output with `{ cardCode: zone.card.cardCode }`
  - [x] 3.2 Add `cardInspectRequest = output<{ cardCode: number }>()` to `PvpBoardContainerComponent`
  - [x] 3.3 In `DuelPageComponent` template, bind `(cardInspectRequest)="onCardInspectRequest($event)"`
  - [x] 3.4 Implement `async onCardInspectRequest(event: { cardCode: number })`: call `cardDataCache.getCardData(event.cardCode)` then `this.inspectedCard.set(result)`

- [x] Task 4: Wire hand card tap → inspector (AC: #2)
  - [x] 4.1 In `PvpHandRowComponent`, modify `onCardTap()`: if NOT actionable AND card has cardCode → emit new `cardInspectRequest` output with `{ cardCode }`
  - [x] 4.2 In `DuelPageComponent` template, bind the hand row's `(cardInspectRequest)` to `onCardInspectRequest($event)`
  - [x] 4.3 Opponent hand cards with `cardCode === 0`: show card back placeholder via the cache service

- [x] Task 5: Wire zone browser card → inspector (AC: #3)
  - [x] 5.1 In `PvpZoneBrowserOverlayComponent`, add a tap handler for browse mode (no actionable prompt): on card tap → emit `cardInspectRequest` output with `{ cardCode }` — ALREADY EXISTS via `inspectCard` output
  - [x] 5.2 In `DuelPageComponent`, bind zone browser's `(cardInspectRequest)` to `onCardInspectRequest($event)` — ALREADY WIRED via `(inspectCard)="inspectCardByCode($event)"`

- [x] Task 6: Wire prompt card grid long-press → inspector (AC: #4)
  - [x] 6.1 In `PromptCardGridComponent`, update `onCardTouchStart()` (line 146): replace `console.debug` with emitting `longPressInspect` output: `{ cardCode: number }`
  - [x] 6.2 Add `longPressInspect = output<{ cardCode: number }>()` to `PromptCardGridComponent`
  - [x] 6.3 Ensure `onCardTouchEnd()` / `onCardTouchCancel()` clears the long-press timer (already exists, verify)
  - [x] 6.4 Add `pointermove` listener that cancels the timer if finger moves > 10px from start position. Also cancel on `pointercancel` and `contextmenu` events (Android Chrome fires `contextmenu` before 500ms timeout)
  - [x] 6.5 In `PvpPromptSheetComponent`, relay `longPressInspect` from the card grid to `DuelPageComponent` (emit upward)
  - [x] 6.6 In `DuelPageComponent`, bind to `(longPressInspect)` and call `onCardInspectRequest($event)`

- [x] Task 7: Replace placeholder `inspectCardByCode()` (AC: #7)
  - [x] 7.1 Inject `CardDataCacheService` in `DuelPageComponent`
  - [x] 7.2 Replace the current synchronous `inspectCardByCode()` with async version: `await cardDataCache.getCardData(cardCode)` → `this.inspectedCard.set(result)`
  - [x] 7.3 While loading: set a temporary entry with image URL + loading flag, then update when data arrives
  - [x] 7.4 Clear cache on `DUEL_END`, `REMATCH_STARTING` events (in existing cleanup logic)

- [x] Task 8: Opponent card inspection for hidden info (AC: #1, #2)
  - [x] 8.1 Face-down field cards (position includes `FACEDOWN_*` bit): show card back image, label "Face-down card", no stats
  - [x] 8.2 Opponent hand cards (`cardCode === 0`): show card back image, label "Unknown card"
  - [x] 8.3 Face-up opponent cards: show full details (they are public information)

- [x] Task 9: Manual verification (all ACs)
  - [x] 9.1 Verify: tap non-actionable field card → inspector opens with full data
  - [x] 9.2 Verify: tap actionable field card → action menu opens (no inspector)
  - [x] 9.3 Verify: tap hand card (no actions) → inspector opens
  - [x] 9.4 Verify: tap face-down opponent card → card back shown
  - [x] 9.5 Verify: open zone browser (GY) → tap card → inspector opens
  - [x] 9.6 Verify: long-press card in prompt grid → inspector opens above sheet
  - [x] 9.7 Verify: short tap card in prompt grid → selection (existing behavior)
  - [x] 9.8 Verify: inspector open + prompt arrives → compact mode transition
  - [x] 9.9 Verify: ESC / tap outside → inspector closes
  - [x] 9.10 Verify: inspect same card twice → second time is instant (cache hit)
  - [x] 9.11 Verify: SCSS budget not exceeded after changes

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring bug caught in Epics 1-3).
- **`effect()` with `untracked()`**: For all side effects (navigation, HTTP calls, animation triggering).
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.
- **DRY KISS**: Minimal code, no over-engineering (Axel directive from Epic 3 retro).
- **No new dependencies**: Angular Material, CDK, standard CSS only.
- **prefers-reduced-motion**: Verify on ALL animated elements.

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| `CardInspectorComponent` (shared, standalone) | `components/card-inspector/card-inspector.component.ts` | Exists — 3 modes: dismissable, click, permanent. Inputs: `card`, `mode`, `position`. Output: `dismissed` |
| `SharedCardInspectorData` interface | `core/model/shared-card-data.ts` | Exists — name, imageUrl, imageUrlFull, isMonster, attribute, race, level, scale, linkval, isLink, hasDefense, displayAtk, displayDef, description |
| `toSharedCardInspectorData(cd: CardDetail)` | `core/model/shared-card-data.ts` | Exists — maps CardDetail → SharedCardInspectorData. Reuse for backend response mapping |
| `PvpCardInspectorWrapperComponent` | `pvp/duel-page/pvp-card-inspector-wrapper/` | Exists — responsive compact/full, `promptActive` input collapses to compact, `forceExpanded` on tap, 768px breakpoint via matchMedia |
| `inspectedCard` signal | `duel-page.component.ts` | Exists — `signal<SharedCardInspectorData \| null>(null)` |
| `inspectCardByCode()` method | `duel-page.component.ts:1031` | Exists — **PLACEHOLDER ONLY** (name = "Card #code", no stats). Replace in Task 7 |
| `closeInspector()` method | `duel-page.component.ts` | Exists — sets `inspectedCard` to null |
| Inspector template binding | `duel-page.component.html` | Exists — `@if (inspectedCard(); as card) { <app-pvp-card-inspector-wrapper> }` |
| `getCardImageUrlByCode(cardCode)` | `pvp/pvp-card.utils.ts` | Exists — returns `/api/images/small/${cardCode}.jpg` |
| Long-press timer skeleton | `prompt-card-grid.component.ts:146` | Exists — `onCardTouchStart()` with 500ms setTimeout, but body is `console.debug` only |
| `onCardTouchEnd/Cancel` cleanup | `prompt-card-grid.component.ts` | Exists — clears `longPressTimeout` |
| `visiblePrompt` computed | `duel-page.component.ts` | Exists — gates prompt display behind animation drain |
| `hasActivePrompt` computed | `duel-page.component.ts` | Exists — `computed(() => this.visiblePrompt() !== null)` |
| Zone browser `browse` mode | `pvp-zone-browser-overlay.component.ts` | Exists — opens for GY/Banished/Extra browsing, has `action` vs `browse` mode |
| HttpClient injection in duel page | `duel-page.component.ts` | Exists — already injected |
| Card search service | `services/search-service-core.service.ts` | Exists — but uses search endpoint, not card-by-code |

### Critical: What Does NOT Exist Yet (Story 5.1 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| `GET /api/cards/code/{cardCode}` endpoint | Spring Boot controller | No way to fetch card details by OCGCore code |
| `CardDataCacheService` | `pvp/duel-page/card-data-cache.service.ts` | Cache card data fetched during duel |
| `cardInspectRequest` output on board | `pvp-board-container.component.ts` | Board has no inspect event path for non-actionable cards |
| `cardInspectRequest` output on hand row | `pvp-hand-row.component.ts` | Hand has no inspect event path for non-actionable cards |
| `cardInspectRequest` output on zone browser | `pvp-zone-browser-overlay.component.ts` | Zone browser has no inspect path in browse mode |
| `longPressInspect` output on prompt card grid | `prompt-card-grid.component.ts` | Long-press has no emit, just console.debug |
| `longPressInspect` relay on prompt sheet | `pvp-prompt-sheet.component.ts` | No relay for card grid long-press |
| Async `inspectCardByCode()` with cache | `duel-page.component.ts` | Current version is synchronous placeholder |
| Face-down / unknown card handling | `duel-page.component.ts` | No handling for cardCode === 0 or face-down position |

### Critical: Interaction Model — Tap vs Long-Press

Per UX spec, the PvP interaction model is:

| Context | Short Tap | Long Press (500ms) |
|---------|-----------|-------------------|
| **Board card (actionable)** | Action menu / single action | NOT needed (action takes priority) |
| **Board card (non-actionable)** | Open inspector | — |
| **Hand card (actionable)** | Action menu | NOT needed |
| **Hand card (non-actionable)** | Open inspector | — |
| **Zone browser card (browse mode)** | Open inspector | — |
| **Zone browser card (action mode)** | Action response | — |
| **Prompt grid card** | Toggle selection | Open inspector (above sheet) |

Key: Prompt grid is the ONLY context where long-press is needed (tap is already selection). All other contexts use simple tap for inspect.

### Critical: Card Data Flow

```
User taps card → Component emits { cardCode } →
DuelPageComponent.onCardInspectRequest() →
CardDataCacheService.getCardData(cardCode) →
  → Cache hit? Return immediately
  → Cache miss? GET /api/cards/code/{cardCode} → map to SharedCardInspectorData → cache → return
→ inspectedCard.set(result) →
Template renders PvpCardInspectorWrapperComponent
```

### Alternative: Batch Pre-Load (Dev Choice)

Instead of fetching card data on-demand per card, the dev may choose to **batch pre-load** all card data during duel loading. The `DUEL_START` / first `BOARD_STATE` contains all visible `cardCode` values. A single `POST /api/cards/codes` with an array of codes would fill the cache in one request, eliminating all network latency during gameplay. This is an **implementation choice** — the ACs are satisfied either way as long as full card data is available when inspected. If batch pre-load is chosen, the endpoint in Task 1 changes to a batch variant.

### Critical: Z-Index Compliance

Per UX spec z-index hierarchy:
- CardInspectorComponent: z-index 150
- PvpPromptSheetComponent: z-index 300
- Inspector NEVER obscures prompt (prompt always wins)
- `PvpCardInspectorWrapperComponent` already handles `[promptActive]` → compact mode

### Critical: Face-Down Card Handling

Cards can be face-down (opponent's set cards, your own face-down S/T):
- **Face-down cards with cardCode > 0** (your own set cards): You know the card, show full inspector
- **Face-down cards with cardCode === 0** (opponent's hidden cards): Show card back, "Face-down card" label
- **Opponent hand cardCode === 0**: Show card back, "Unknown card" label
- **Position check**: Use `POSITION.FACEDOWN_ATTACK (0x2)` and `POSITION.FACEDOWN_DEFENSE (0x8)` bitmask

### What MUST Change

| File | Change | Why |
|------|--------|-----|
| Spring Boot card controller | Add `GET /api/cards/code/{cardCode}` endpoint | Card data lookup by OCGCore code |
| `front/src/app/pages/pvp/duel-page/card-data-cache.service.ts` | **NEW** — Card data cache service | Cache fetched card details |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Inject `CardDataCacheService`, replace `inspectCardByCode()`, add `onCardInspectRequest()`, wire cleanup | Central inspect coordination |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Bind `(cardInspectRequest)` on board, hand rows, zone browser; bind `(longPressInspect)` on prompt sheet | Event wiring |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` | Add `cardInspectRequest` output, modify `onZoneCardClick()` fallback | Board tap → inspect |
| `front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts` | Add `cardInspectRequest` output, modify `onCardTap()` fallback | Hand tap → inspect |
| `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.ts` | Add `cardInspectRequest` output for browse mode tap | Zone browser → inspect |
| `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts` | Replace console.debug with `longPressInspect` output, add pointermove cancel | Long-press → inspect |
| `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts` | Relay `longPressInspect` from card grid | Event relay |

### What NOT to Change

- **CardInspectorComponent** — Shared component, no modifications needed. Already has all required functionality.
- **PvpCardInspectorWrapperComponent** — Already handles compact/full mode, promptActive input, dismiss. No changes needed.
- **duel-web-socket.service.ts** — No WebSocket protocol changes. Inspector is purely client-side.
- **duel-server/** — No server changes. Card data comes from Spring Boot, not duel server.
- **Animation system (Story 4.2)** — No changes to animation queue, prompt drain, chain badges.
- **Existing card click/action handlers** — The action menu flow is unchanged. Inspector is a FALLBACK for non-actionable cards.
- **shared-card-data.ts** — Interface and helper function already cover all needed fields.
- **pvp-card.utils.ts** — Image URL helpers unchanged.

### Previous Story Intelligence (Story 4.2 — Game Event Visual Feedback)

**Patterns to follow:**
- Signal-based inputs: `input<T>()` + `output<T>()` — use for new `cardInspectRequest` outputs
- `inject()` for DI — use for `HttpClient` and new `CardDataCacheService`
- `effect()` + `untracked()` for side effects — if needed for auto-close
- `[class.specific-class]` binding only — NEVER `[class]`
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)

**Anti-Patterns from previous stories:**
- Do NOT create a new component for the inspector — reuse existing `CardInspectorComponent` + `PvpCardInspectorWrapperComponent`
- Do NOT add new dependencies or libraries
- Do NOT inline z-index values — use existing `_z-layers.scss` tokens
- Do NOT inline color values — use design tokens
- Do NOT modify existing action/menu handlers — inspector is the fallback path only
- Do NOT store HTTP subscriptions without cleanup — use `firstValueFrom()` pattern (from deck-builder.component.ts)

**Epic 4 Retro findings applied:**
- Token compliance — no hardcoded colors/durations
- prefers-reduced-motion — verify on any new animations (minimal in this story)
- DRY KISS — simple wiring, no complex patterns
- Code review mandatory after implementation

### Git Intelligence

**Recent commits:** `d80b721f epic 2 & 3` (latest), `35c96f9a epic 1`. Current branch: `dev-pvp`.

**Code conventions observed:**
- `import type` for type-only imports
- `firstValueFrom()` for async HTTP in components (deck-builder pattern)
- `output<T>()` for event emitters (Angular 19 signal-based)
- `inject()` for DI, no constructor injection
- Component-scoped services via `providers` array

### Library & Framework Requirements

- **Angular 19.1.3**: Signals, OnPush, inject(), output(), input()
- **HttpClient**: For card data fetch (already available)
- **TypeScript 5.5.4**: Strict mode
- **Spring Boot**: Add one REST endpoint
- **No new dependencies** — zero new packages on both frontend and backend

### Testing Requirements

- No automated tests per project "big bang" approach
- Manual verification via Task 9 subtasks
- Focus on: tap → inspect data flow, cache behavior, face-down handling, prompt interaction (long-press vs tap), auto-compact on prompt, dismiss behavior

### Source Tree — Files to Touch

**CREATE (1 file):**
- `front/src/app/pages/pvp/duel-page/card-data-cache.service.ts`

**MODIFY (8 files):**
- Spring Boot card controller (add endpoint)
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts`
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts`

**REFERENCE (read-only):**
- `front/src/app/components/card-inspector/card-inspector.component.ts` (verify API)
- `front/src/app/core/model/shared-card-data.ts` (SharedCardInspectorData, toSharedCardInspectorData)
- `front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.ts` (verify promptActive behavior)
- `front/src/app/pages/pvp/duel-ws.types.ts` (CardOnField, POSITION bitmasks)
- `front/src/app/pages/pvp/pvp-card.utils.ts` (getCardImageUrlByCode)

**DO NOT TOUCH:**
- `duel-server/` — No duel server changes
- `components/card-inspector/` — Shared component, no modifications
- `pvp-card-inspector-wrapper/` — Already handles compact/full/prompt mode
- `duel-web-socket.service.ts` — No protocol changes
- Animation system (queue, chain badges) — Independent, don't modify
- Lobby / waiting room — No changes

### Project Structure Notes

- `CardDataCacheService` is scoped to `DuelPageComponent` (provided in `providers` array, same lifecycle as duel)
- Cache is automatically destroyed when navigating away from duel (component-scoped)
- No global state pollution — service dies with the duel page
- `toSharedCardInspectorData()` helper in `shared-card-data.ts` expects `CardDetail` — the backend response should match this interface or be mapped accordingly
- If the backend card model differs from `CardDetail`, create a lightweight mapper in the cache service

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 5, Story 5.1: Card Inspector PvP Placeholder (lines 857-873)]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — FR18 card inspection reuse, component reuse strategy, z-index hierarchy]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — In-prompt card inspection (long-press mobile, hover desktop), inspector breakpoint (768px), z-index hierarchy (inspector: 150, prompt: 300), interaction rules (prompt always wins)]
- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Technical debt source: Epic 1 Story 1-7 placeholder TODO in prompt-card-grid.component.ts:146]
- [Source: _bmad-output/implementation-artifacts/4-2-game-event-visual-feedback-animation-queue.md — Previous story patterns, anti-patterns, signal conventions, DRY KISS]
- [Source: _bmad-output/implementation-artifacts/epic-4-retro-2026-03-01.md — Card inspector carried from Epic 1, token compliance, reduced-motion checklist expansion, code review mandatory]
- [Source: front/src/app/components/card-inspector/card-inspector.component.ts — SharedCardInspectorData inputs, mode/position/dismissed API]
- [Source: front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.ts — compact/full responsive, promptActive input, forceExpanded, 768px matchMedia]
- [Source: front/src/app/pages/pvp/duel-page/duel-page.component.ts:1031-1041 — inspectCardByCode() placeholder]
- [Source: front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts:146 — long-press TODO]
- [Source: front/src/app/core/model/shared-card-data.ts — toSharedCardInspectorData(), SharedCardInspectorData interface]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build verified: `ng build` passes, `mvn compile` passes (zero errors)

### Completion Notes List

- **Task 1**: Added `GET /api/cards/code/{cardCode}` endpoint to `CardController.java` using existing `findByPasscode()` repository method. Returns `CardDetailedDTO` (same format as search). Returns 404 via `ResponseStatusException` if card not found.
- **Task 2**: Created `CardDataCacheService` — component-scoped injectable with in-memory `Map<number, SharedCardInspectorData>` cache. Uses `firstValueFrom(http.get())` pattern, maps response via `new CardDetail()` + `toSharedCardInspectorData()`. Returns card-back placeholder for cardCode 0/falsy.
- **Task 3**: Added `cardInspectRequest` output to `PvpBoardContainerComponent`. Modified `onZoneCardClick()` to emit inspect when no actions available. Added click handlers for opponent field cards and EMZ zones via `onCardInspect()` method.
- **Task 4**: Added `cardInspectRequest` output to `PvpHandRowComponent`. Modified `onCardTap()` to handle both player (non-actionable → inspect) and opponent (always inspect, cardCode 0 → placeholder).
- **Task 5**: Already wired — zone browser's `inspectCard` output was already bound to `inspectCardByCode()`. No changes needed to zone browser component.
- **Task 6**: Replaced `console.debug` in `PromptCardGridComponent.onCardTouchStart()` with `longPressInspect` EventEmitter. Added `pointermove` distance check (10px threshold), `pointercancel` and `contextmenu` cancellation. Relayed through `PvpPromptSheetComponent` via dynamic subscription on portal-attached component.
- **Task 7**: Replaced synchronous placeholder `inspectCardByCode()` with async version using `CardDataCacheService`. Shows card image immediately while loading text details. Added `onCardInspectRequest()` handler. Cache cleared on destroy and rematch via effect.
- **Task 8**: `inspectCardByCode()` handles cardCode 0 → "Face-down card" placeholder. `onOpponentHandInspect()` handles opponent hand specifically → "Unknown card" label. Face-up cards with cardCode > 0 get full details from cache.
- **Task 9**: Build verification passed (frontend + backend). Manual runtime testing required per "big bang" approach.

### File List

**Created:**
- `front/src/app/pages/pvp/duel-page/card-data-cache.service.ts`

**Modified:**
- `back/src/main/java/com/skytrix/controller/CardController.java` — added `GET /code/{cardCode}` endpoint
- `back/src/main/java/com/skytrix/service/CardService.java` — added `getCardByCode()` method
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — injected CardDataCacheService, replaced inspectCardByCode(), added onCardInspectRequest(), onOpponentHandInspect(), cache cleanup
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — wired cardInspectRequest on board, hand rows, longPressInspect on prompt sheet
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — added cardInspectRequest output, onCardInspect(), modified onZoneCardClick()
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — added click handlers on opponent field cards and EMZ zones
- `front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts` — added cardInspectRequest output, modified onCardTap() for both sides
- `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts` — replaced console.debug with longPressInspect emit, added pointermove/contextmenu cancel
- `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.html` — added pointermove, pointercancel, contextmenu handlers, passed $event to touchstart
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts` — added longPressInspect output, dynamic subscription relay
- `front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.ts` — added initialForceExpanded input for long-press full-mode (H3 fix)

## Change Log

- 2026-03-01: Story 5.1 implementation — Card Inspector PvP integration with full card data resolution via backend endpoint + client-side cache
- 2026-03-01: Code review fixes (8 issues: 3H, 2M, 3L) — H1: long-press guard prevents click-through selection; H2: try/catch in CardDataCacheService.getCardData(); H3: initialForceExpanded input on wrapper for long-press full-mode; M1: exported CARD_BACK_PLACEHOLDER/UNKNOWN_CARD_PLACEHOLDER, DRY; M2: async/await onOpponentHandInspect; L1: removed dead cardTapped output; L2: unified pointer event model; L3: inspectGeneration counter prevents race condition
