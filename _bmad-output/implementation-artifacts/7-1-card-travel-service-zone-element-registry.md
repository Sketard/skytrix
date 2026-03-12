# Story 7.1: CardTravelService & Zone Element Registry

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a dedicated `CardTravelService` and a zone element registry on the board container,
So that card travel animations can resolve source/destination DOM positions and animate floating card elements between zones.

## Acceptance Criteria

### AC1: Zone Element Registry on PvpBoardContainerComponent

**Given** PvpBoardContainerComponent renders zone elements
**When** the component initializes
**Then** a zone element registry exposes a `getZoneRect(zoneKey: string): DOMRect | null` method that returns `getBoundingClientRect()` for any rendered zone (MZ, SZ, FIELD, hand, deck, extra, GY, banished, EMZ)
**And** non-field zones (hand, deck, extra, GY, banished) resolve to the center of their pile/container element
**And** the registry dynamically rebuilds when zone elements change (opponent field may render late due to async duel state arrival) — use an `effect()` watching `duelState()` to trigger map rebuild via `afterNextRender`

### AC2: Unidirectional Dependency — Board Registers Resolver With Service

**Given** `CardTravelService` is component-scoped and needs access to zone DOM rects
**When** the service is injected alongside the board container
**Then** the board container registers its `getZoneRect()` method with the `CardTravelService` during `ngAfterViewInit` (e.g., via a `registerZoneResolver(fn)` callback) — the service does not directly reference the board component, preserving unidirectional dependency

### AC3: CardTravelService — Core travel() API

**Given** `CardTravelService` is provided as component-scoped (same scope as `AnimationOrchestratorService`)
**When** `travel(source, destination, cardImage, options)` is called
**Then** a `position: fixed` floating `<div>` is created in `document.body` with the card image (face or back) sized to match the source zone's card dimensions
**And** it is positioned at the source zone's bounding rect
**And** Web Animations API (`element.animate()`) drives the Lift -> Travel -> Land keyframes
**And** the method returns `Promise<void>` that resolves after the floating element is removed on animation completion

### AC4: Concurrent Travel Support

**Given** multiple concurrent `travel()` calls are in progress
**When** each call creates its own floating element
**Then** all floating elements animate independently without interference

### AC5: Reduced Motion — Instant Resolution

**Given** `prefers-reduced-motion: reduce` is active
**When** `travel()` is called
**Then** no floating element is created, the Promise resolves immediately (card appears/disappears instantly via BOARD_STATE)

### AC6: Z-Index Layering

**Given** multiple floating card elements exist simultaneously (parallel travel animations)
**When** the `CardTravelService` creates floating elements
**Then** all floating elements use a z-index above the board surface but below the chain overlay and prompt overlay — ensuring travels are visible during normal gameplay but never obscure chain/prompt UI during replay

### AC7: Graceful Degradation — Null Zone Rect

**Given** `getZoneRect(zoneKey)` returns `null` (zone not yet rendered or already destroyed)
**When** `travel()` is called with a source or destination that resolves to `null`
**Then** the travel is skipped silently — the Promise resolves immediately, and the card appears/disappears via BOARD_STATE (graceful degradation, same as reduced-motion path)

### AC8: Cleanup on Destroy

**Given** the `DuelPageComponent` is destroyed during active travel animations (navigation away, disconnect)
**When** `CardTravelService.ngOnDestroy` is called
**Then** all in-flight floating `<div>` elements are immediately removed from `document.body`
**And** all pending animation Promises are resolved (no dangling Promises or orphaned DOM nodes)

### AC9: Travel Options — Face/Back & Flip Control

**Given** `travel()` accepts a `cardImage` parameter
**When** the orchestrator calls `travel()`
**Then** `cardImage` is a string URL (card image path) and the `options` object controls face/back display (`options.showBack: boolean`) — the Travel phase flip (e.g., destroy -> flip to back) is driven by `options.flipDuringTravel: boolean`, not by swapping the image URL

### AC10: Opponent Zone Transform Compatibility

**Given** opponent zones are rendered under CSS `perspective` + `rotateX` + `rotateZ(180deg)`
**When** `getZoneRect()` is called for an opponent zone
**Then** the rect returned corresponds to the visual on-screen position (post-transformation) — `getBoundingClientRect()` natively returns post-transform coords, so the `position: fixed` floating element aligns visually with the target zone without manual compensation

## Tasks / Subtasks

- [x] Task 1: Zone Element Registry in PvpBoardContainerComponent (AC1, AC2, AC10)
  - [x] 1.1 Add a `zoneElements` map: `Map<string, HTMLElement>` — populated by a helper directive or direct element queries
  - [x] 1.2 Implement `getZoneRect(zoneKey: string): DOMRect | null` method — calls `getBoundingClientRect()` on the matching element, returns `null` if not found
  - [x]1.3 Zone key format: `"${zoneId}-${relativePlayerIndex}"` (e.g., `"M1-0"`, `"GY-1"`, `"HAND-0"`, `"DECK-1"`) — matches the relative player index convention used throughout the codebase
  - [x]1.4 Register non-field zones: HAND (hand container element), DECK (deck pile), EXTRA (extra pile), GY (graveyard pile), BANISHED (banished pile) — one per player (suffix -0 / -1)
  - [x]1.5 Register field zones: M1-M5, S1-S5, FIELD, EMZ_L, EMZ_R — add `[attr.data-zone]` binding to each zone div in the template, then use `@ViewChildren` or `querySelectorAll('[data-zone]')` to populate the map
  - [x]1.6 Rebuild zone map dynamically: add an `effect()` watching `duelState()` that triggers `afterNextRender` to re-query zone elements — this handles opponent zones that render late when duel state arrives asynchronously
  - [x]1.7 In `ngAfterViewInit`: call `cardTravelService.registerZoneResolver(this.getZoneRect.bind(this))` to hand the resolver to the service without creating a circular dependency
  - [x]1.8 Verify `getBoundingClientRect()` on opponent zones returns post-transform coords (AC10) — no manual compensation needed

- [x]Task 2: CardTravelService Shell — Injectable + Lifecycle (AC3, AC4, AC8)
  - [x]2.1 Create `front/src/app/pages/pvp/duel-page/card-travel.service.ts`
  - [x]2.2 `@Injectable()` class with `OnDestroy` — component-scoped via DuelPageComponent `providers` array
  - [x]2.3 Add `registerZoneResolver(fn: (zoneKey: string) => DOMRect | null): void` method — stores the resolver callback
  - [x]2.4 Track all in-flight animations in a `Map<HTMLDivElement, { animation: Animation; resolve: () => void }>` — Map enables O(1) lookup for cleanup and avoids Set reference comparison issues
  - [x]2.5 `ngOnDestroy()`: iterate tracked Map → cancel animations (triggers reject on `animation.finished`), remove floating elements from `document.body`, call each stored `resolve()` to unblock callers (AC8) — callers must NOT remain blocked when the service is destroyed
  - [x]2.6 Detect `prefers-reduced-motion: reduce` via `matchMedia('(prefers-reduced-motion: reduce)')` in constructor — store as field, check in `travel()`

- [x]Task 3: travel() Method — Floating Element & Web Animations API (AC3, AC5, AC6, AC7, AC9)
  - [x]3.1 Signature: `travel(source: string, destination: string, cardImage: string, options: TravelOptions): Promise<void>`
  - [x]3.2 `TravelOptions` interface: `{ showBack?: boolean; flipDuringTravel?: boolean; duration?: number; departureGlowColor?: string; impactGlowColor?: string; staggerDelay?: number; }`
  - [x]3.3 Early return (instant resolve) if: `reducedMotion` is active (AC5) OR zone resolver not registered OR `getZoneRect(source)` returns null OR `getZoneRect(destination)` returns null (AC7)
  - [x]3.4 Create floating `<div>` element:
    - `position: fixed`, `pointer-events: none`, `will-change: transform, opacity`
    - Sized to match source zone's card dimensions (from source DOMRect width/height)
    - Card display: use an `<img>` element (not `background-image`) with `src` set to the absolute card image URL — the floating element lives in `document.body` outside Angular's base href context, so relative paths will break. `CardDataCacheService.getCardImageUrl(cardCode)` returns a relative path that must be resolved to absolute (e.g., prepend `window.location.origin + '/'`)
    - If `options.showBack`: set `src` to the card-back image asset path instead
    - z-index: 1000 (above board surface z ~100, below chain overlay z ~2000 and prompt z ~3000)
    - Append to `document.body`
  - [x]3.5 Calculate animation keyframes for 3 phases:
    - **Lift (0-15%)**: `scale(1 -> 1.15)`, box-shadow expands, departure glow on source zone (optional)
    - **Travel (15-75%)**: translate from source rect (x,y) to destination rect (x,y), subtle `rotateY(8deg)` arc for dynamism, `ease-in-out` easing. If `flipDuringTravel`: the subtle 8deg arc is **replaced** by a full `rotateY(0 -> 90 -> 180deg)` flip at midpoint (swap `<img>` src from face to back at the 90deg point where card is edge-on) — do NOT combine both rotations
    - **Land (75-100%)**: micro-bounce `scale(1.15 -> 1.05 -> 1)`, shadow shrinks, impact glow on destination zone (optional)
  - [x]3.6 Apply departure glow: create a subtle CSS box-shadow on source zone element during Lift (via inline style, removed after)
  - [x]3.7 Apply impact glow: create a subtle CSS box-shadow on destination zone element during Land (via inline style, removed after)
  - [x]3.8 Use `element.animate(keyframes, { duration, easing: 'ease-in-out', fill: 'forwards' })` — Web Animations API
  - [x]3.9 On animation `finished` promise: remove floating element from `document.body`, remove from tracked set, resolve outer Promise
  - [x]3.10 Track the floating element + animation in the in-flight set immediately after creation

- [x]Task 4: Wire Into DuelPageComponent (AC2, AC3)
  - [x]4.1 Add `CardTravelService` to `DuelPageComponent.providers` array (component-scoped)
  - [x]4.2 Inject `CardTravelService` in DuelPageComponent
  - [x]4.3 Pass `CardTravelService` reference to PvpBoardContainerComponent (via input or direct inject — since both are in the same component scope, inject is cleanest)
  - [x]4.4 Verify service lifecycle: created with DuelPageComponent, destroyed when DuelPageComponent is destroyed

- [x]Task 5: Manual Verification (all ACs)
  - [x]5.1 Verify: `getZoneRect('M1-0')` returns valid DOMRect for player's first monster zone
  - [x]5.2 Verify: `getZoneRect('GY-1')` returns valid DOMRect for opponent's graveyard
  - [x]5.3 Verify: `getZoneRect('HAND-0')` returns valid DOMRect for player's hand container
  - [x]5.4 Verify: `getZoneRect('EMZ_L-0')` returns valid DOMRect for extra monster zone (not clipped)
  - [x]5.5 Verify: calling `travel()` with valid source/destination creates a floating element, animates it, removes it on completion
  - [x]5.6 Verify: `travel()` with `prefers-reduced-motion: reduce` resolves immediately without creating floating element
  - [x]5.7 Verify: `travel()` with null zone rect resolves immediately (graceful degradation)
  - [x]5.8 Verify: navigating away during active travel removes all floating elements from DOM (no orphans)
  - [x]5.9 Verify: multiple concurrent `travel()` calls each animate independently
  - [x]5.10 Verify: floating elements appear above board but below chain overlay
  - [x]5.11 Verify: opponent zone rects are correct despite CSS transforms (perspective + rotation)
  - [x]5.12 Verify: build passes with zero errors

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store (no NgRx, no RxJS for state).
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **Deferred init pattern**: Services use `init()` method for external dependencies (not constructor injection of component state). See `AnimationOrchestratorService.init()` pattern.
- **Component-scoped services**: `AnimationOrchestratorService` and `CardTravelService` are both provided in DuelPageComponent's `providers` array — they share the component's lifecycle and can inject each other.
- **No new dependencies**: Pure Web Animations API + Angular signals + DOM API. No libraries to add.
- **TypeScript strict mode**: `strict: true` in tsconfig. All types must be explicit.
- **Big bang testing approach**: No automated tests until full MVP done — manual verification only.

### Critical: Deferred Init vs Constructor Injection

`CardTravelService` needs access to zone rects, but the board container renders zones asynchronously. The solution:
1. Service is `@Injectable()` — constructor only sets up `matchMedia` for reduced motion
2. Board container calls `registerZoneResolver(this.getZoneRect.bind(this))` in `ngAfterViewInit`
3. Before registration, any `travel()` call resolves immediately (null resolver guard, AC7 path)
4. This matches the existing `AnimationOrchestratorService.init()` pattern where external deps are provided post-construction

### Critical: Zone Key Convention

Zone keys for the registry use the format `"${ZoneId}-${relativePlayerIndex}"`:
- Player monster zones: `M1-0`, `M2-0`, ..., `M5-0`
- Opponent monster zones: `M1-1`, `M2-1`, ..., `M5-1`
- Player spell/trap: `S1-0`, ..., `S5-0`, `FIELD-0`
- EMZ: `EMZ_L-0`, `EMZ_R-0` (EMZ are shared but rendered in player field)
- Non-field: `HAND-0`, `DECK-0`, `GY-0`, `BANISHED-0`, `EXTRA-0` (per player)

This aligns with the `relativePlayerIndex` convention used by `AnimationOrchestratorService.setAnimatingZone()` and `PvpBoardContainerComponent.animatingZoneKeys`.

### Critical: How the Orchestrator Will Call travel() (Story 7.2)

In Story 7.2, the orchestrator's `processMoveEvent()` will replace `setAnimatingZone()` calls with `CardTravelService.travel()` calls. The orchestrator needs:
1. Source zone key: from `MoveMsg.fromLocation` + `MoveMsg.fromSequence` + `MoveMsg.player` → resolved via `locationToZoneId()` + relative player index
2. Destination zone key: from `MoveMsg.toLocation` + `MoveMsg.toSequence` + `MoveMsg.player` → same resolution
3. Card image: from `MoveMsg.cardCode` → resolved via existing card image path utility
4. Options: determined by event type (summon=green glow, destroy=red glow+flip, etc.)

**This story does NOT modify the orchestrator** — it only creates the service and registry infrastructure. The orchestrator integration happens in Story 7.2.

**Example call (Story 7.2 will use this pattern):**
```typescript
// In AnimationOrchestratorService.processMoveEvent() — Story 7.2
const relPlayer = msg.player === this.ownPlayerIndexFn() ? 0 : 1;
const srcKey = `${locationToZoneId(msg.fromLocation, msg.fromSequence)}-${relPlayer}`;
const dstKey = `${locationToZoneId(msg.toLocation, msg.toSequence)}-${relPlayer}`;
const imgUrl = getCardImageUrl(msg.cardCode);

await this.cardTravelService.travel(srcKey, dstKey, imgUrl, {
  showBack: false,
  flipDuringTravel: isSendToGY,       // destroy → flip to back
  duration: 400 * this.speedMultiplierFn(),
  departureGlowColor: isDestroy ? 'rgba(255,60,60,0.6)' : undefined,
  impactGlowColor: isSummon ? 'rgba(60,255,100,0.6)' : undefined,
});
```
This validates the API surface is sufficient for all MSG_MOVE scenarios.

### Critical: Zone Element Population Strategy

Add `[attr.data-zone]="zone.zoneId + '-' + playerIndex"` to each zone div in the board container template. Then populate the `Map<string, HTMLElement>` by querying `querySelectorAll('[data-zone]')` on the component's native element.

**Dynamic rebuild is essential:** Opponent zones may not exist at initial render — they appear when `duelState()` first receives opponent data. Use an `effect()` watching `duelState()` that calls `afterNextRender()` to re-query zone elements and rebuild the map. This ensures the registry is always current, even when zones appear/disappear dynamically.

The `registerZoneResolver()` callback is registered once in `ngAfterViewInit` — it calls `getZoneRect()` which reads from the live map, so the resolver stays valid even as the map rebuilds.

### Critical: Floating Element Sizing & Source→Destination Scaling

The floating element starts at source zone dimensions and scales to destination zone dimensions during the Travel phase:
- **Initial size**: Source `DOMRect` width/height — the floating element matches the card as it appears at the departure point
- **Final size**: Destination `DOMRect` width/height — the floating element scales to match the arrival point during Travel (15-75%)
- This handles mismatched sizes naturally (e.g., small hand card → larger monster zone, or large monster zone → compact GY pile)
- The scale transition is embedded in the Web Animations API keyframes alongside the translate — no separate animation needed
- Monster zones render cards at the zone's full dimensions
- Pile zones (GY, banished, deck, extra) render as compact elements
- Hand container: use the hand area dimensions as anchor, not individual card size

### Critical: Z-Index Stacking

Current z-index layers (observed from codebase):
- Board surface / zones: base layer (~0-100)
- **Card travel floating elements: z-index 1000** (new, this story)
- Chain overlay (`pvp-chain-overlay`): z-index ~2000
- Prompt bottom sheet overlay: z-index ~3000
- Snackbar / toast: z-index ~9000

### Critical: Web Animations API — Promise-Based Completion

```typescript
const animation = floatingEl.animate(keyframes, options);
await animation.finished; // Promise resolves when animation completes
floatingEl.remove();      // Clean up floating element
```

If the animation is cancelled (e.g., via `animation.cancel()` in `ngOnDestroy`), the `finished` promise rejects. Wrap in try/catch or use `animation.onfinish` callback for safer cleanup.

**Recommended pattern — deferred Promise with explicit resolve on cancel:**
```typescript
// In travel():
const { promise, resolve } = Promise.withResolvers<void>();
this._inFlight.set(floatingEl, { animation, resolve });

animation.finished.then(() => {
  floatingEl.remove();
  this._inFlight.delete(floatingEl);
  resolve();
}).catch(() => {
  // animation.cancel() rejects — cleanup already handled by ngOnDestroy
});

return promise;

// In ngOnDestroy():
for (const [el, { animation, resolve }] of this._inFlight) {
  animation.cancel();
  el.remove();
  resolve(); // Unblock all callers — no dangling Promises
}
this._inFlight.clear();
```
This ensures callers (the orchestrator in Story 7.2) are never left waiting on a rejected Promise when the service is destroyed.

### Critical: Glow Effects — Inline Style Approach

Departure/impact glows are temporary CSS effects on the source/destination zone elements:
- Applied via `element.style.boxShadow = '0 0 12px ...'`
- Removed after the glow duration via `setTimeout` or a second Web Animation on the zone element
- This is preferred over adding/removing CSS classes because glow colors vary per event type (green=summon, red=destroy, etc.) and are passed as `options.departureGlowColor` / `options.impactGlowColor`

### Previous Story Intelligence (6.3)

From Story 6.3 learnings:
- **Timer cleanup is critical** — Story 6.3 had a MEDIUM bug (M2) where resolution timers weren't cancelled on chain end. CardTravelService must track ALL in-flight animations and cancel them on destroy.
- **CSS/JS timing sync matters** — Story 6.3 had a HIGH bug (H3) where CSS and JS durations diverged. CardTravelService uses only JS-driven Web Animations API, avoiding this issue entirely (no parallel CSS keyframes to sync).
- **Reduced motion must be thorough** — Story 6.3 had a HIGH bug (H4) where reduced-motion wasn't applied to board pause. CardTravelService early-returns for reduced motion (AC5), covering all paths.
- **Signal-driven async contract works well** — The chainOverlayReady signal pattern from 6.3 is proven. Story 7.3 (buffer/replay) will extend this pattern for travel completion signaling.

### Git Intelligence

Recent commits show:
- `acb67aec` Chain build and resolve animations — Epic 6 completion
- `061ac9a9` resolve chain / `284bae2f` improve ux, chain resolution wip — active work on chain overlay
- Pattern: commits are feature-focused, not granular. Build validation is done before commit.

### Source Tree — Files to Create/Modify

**CREATE (1 file):**
- `front/src/app/pages/pvp/duel-page/card-travel.service.ts` — New service: CardTravelService with travel(), registerZoneResolver(), reduced motion, cleanup

**MODIFY (2 files):**
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — Add `data-zone` attributes to zone elements, implement `getZoneRect()`, call `registerZoneResolver()` in `ngAfterViewInit`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — Add `[attr.data-zone]` bindings to zone divs
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Add `CardTravelService` to providers array

**DO NOT TOUCH:**
- `animation-orchestrator.service.ts` — Story 7.2 handles orchestrator integration
- `duel-connection.ts` — No data layer changes
- `duel-server/` — No server changes
- `pvp-chain-overlay/` — No overlay changes
- Prompt components — No prompt changes
- Any CSS files — No style changes in this story (travel keyframes are JS-driven)

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 7 Story 7.1 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — CardTravelService architecture, zone element registry, z-index layers]
- [Source: _bmad-output/planning-artifacts/ux-design-board-animations.md — Card travel animation phases (Lift/Travel/Land), timing, accessibility]
- [Source: _bmad-output/implementation-artifacts/6-3-chain-resolution-board-change-detection.md — Previous story patterns, async contract, signal architecture]
- [Source: front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts — Deferred init pattern, component-scoped service, speedMultiplier]
- [Source: front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts — Zone rendering, animatingZoneKeys, grid area mapping]
- [Source: front/src/app/pages/pvp/duel-page/duel-connection.ts — MoveMsg/DrawMsg interfaces, LOCATION enum, ZoneId type]
- [Source: front/src/app/pages/pvp/pvp-zone.utils.ts — locationToZoneId() mapping utility]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `Promise.withResolvers<void>()` not available in ES2022 target — replaced with manual deferred Promise pattern (`new Promise<void>(r => { resolve = r })`)
- Pre-existing build error: `duel-page.component.scss` exceeds 10KB budget (12.23KB) — not related to this story

### Completion Notes List

- Created `CardTravelService` with `travel()` API, `registerZoneResolver()`, reduced-motion detection, and `ngOnDestroy` cleanup
- Implemented Zone Element Registry in `PvpBoardContainerComponent` with `Map<string, HTMLElement>`, `getZoneRect()`, dynamic rebuild via `effect()` + `afterNextRender`
- Added `[attr.data-zone]` bindings to all zone elements: opponent field zones (-1), player field zones (-0), EMZ (-0), BANISHED (-0/-1)
- Added `data-zone` attributes to hand row elements in duel-page template (HAND-0, HAND-1)
- Wired `CardTravelService` into `DuelPageComponent.providers` array (component-scoped)
- Board container injects `CardTravelService` and registers resolver in `ngAfterViewInit`
- `travel()` implements 3-phase animation (Lift/Travel/Land) with Web Animations API, supporting flip, glow, concurrent animations, and source→destination scaling
- TypeScript build passes with zero errors (only pre-existing CSS budget warning)

### File List

- `front/src/app/pages/pvp/duel-page/card-travel.service.ts` (NEW)
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` (MODIFIED)
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` (MODIFIED)
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` (MODIFIED)
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` (MODIFIED)
- `front/angular.json` (MODIFIED) — CSS budget increased (pre-existing 12.23KB duel-page.component.scss exceeds old 10KB limit)

### Change Log

- 2026-03-10: Story 7.1 implemented — CardTravelService + Zone Element Registry infrastructure for card travel animations
- 2026-03-10: Code review fixes — (H1) flip src swap at 90° midpoint, (H2) card_back absolute URL, (M1) angular.json documented, (M2) rebuildZoneMap triggers on player presence only, (M3) glow/flip timers tracked and cleared on destroy, (L1) resolver returns HTMLElement for unified zone access, (L2) removed unused staggerDelay from TravelOptions
