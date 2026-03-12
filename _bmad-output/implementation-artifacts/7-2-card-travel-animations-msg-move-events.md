# Story 7.2: Card Travel Animations for MSG_MOVE Events

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want card movements between zones (summon, destroy, bounce, return to deck, field-to-field) to display as spatial travel animations instead of in-place glow effects,
So that I can visually perceive where a card came from and where it went.

## Acceptance Criteria

### AC1: Summon Travel (Hand/Deck/Extra -> MZ/SZ)

**Given** a MSG_MOVE event for a summon (hand/deck/extra -> MZ/SZ)
**When** the orchestrator processes the event
**Then** `CardTravelService.travel()` is called with source = origin zone key, destination = target zone key, card face visible on arrival
**And** a green impact glow pulses on the destination zone during the Land phase (`impactGlowColor: 'rgba(60,255,100,0.6)'`)
**And** the orchestrator awaits the travel Promise (~400ms base) instead of the previous fixed 300ms

### AC2: Source/Destination From MSG_MOVE Payload

**Given** MSG_MOVE contains `fromLocation`/`fromSequence` and `toLocation`/`toSequence`
**When** the orchestrator processes a MSG_MOVE
**Then** it uses the MSG_MOVE payload fields (not the current BOARD_STATE) to determine source and destination zone keys for the travel animation — the BOARD_STATE may already reflect the final position
**And** zone keys are constructed as `"${zoneId}-${relativePlayerIndex}"` for field zones (via `locationToZoneId()`) and `"${locationName}-${relativePlayerIndex}"` for non-field zones (HAND, DECK, EXTRA, GY, BANISHED)

### AC3: Destroy Travel (MZ/SZ -> GY/Banished)

**Given** a MSG_MOVE event for a destroy (MZ/SZ -> GY/banished)
**When** the orchestrator processes the event
**Then** `CardTravelService.travel()` is called with card flipping to back during the Travel phase (`flipDuringTravel: true`)
**And** a red departure glow appears on the source zone during the Lift phase (`departureGlowColor: 'rgba(255,60,60,0.6)'`)

### AC4: Bounce Travel (MZ/SZ -> Hand)

**Given** a MSG_MOVE event for a bounce (MZ/SZ -> hand)
**When** the orchestrator processes the event
**Then** `CardTravelService.travel()` is called with no destructive glow (no departure/impact glow colors)

### AC5: Return to Deck Travel (MZ/SZ -> Deck)

**Given** a MSG_MOVE event for return to deck (MZ/SZ -> deck)
**When** the orchestrator processes the event
**Then** card flips to back during travel (`flipDuringTravel: true`), deck pile pulses on arrival with a neutral glow (`impactGlowColor: 'rgba(180,180,220,0.5)'`)

### AC6: Field-to-Field Travel (MZ -> MZ, SZ -> SZ)

**Given** a MSG_MOVE event for field-to-field movement
**When** the orchestrator processes the event
**Then** direct travel with neutral glow (`impactGlowColor: 'rgba(180,180,220,0.5)'`)

### AC7: Token Dissolution (No Travel)

**Given** a token is destroyed (detected via `cardCode === 0` on the MoveMsg — tokens have sanitized/zero card codes in client-facing messages)
**When** the orchestrator processes the token destruction event
**Then** the card dissolves in-place at the source zone (fade out + scale down via Web Animations API on the zone element), no travel animation to GY
**And** the dissolution returns a Promise that resolves after ~300ms

### AC8: Stagger for Parallel Travels

**Given** multiple cards travel simultaneously (e.g., Raigeki -> 5 destroys)
**When** the orchestrator processes the batch (multiple MSG_MOVE events in sequence)
**Then** the stagger is handled naturally by the orchestrator's sequential event processing — each event fires `travel()` and the ~400ms duration overlaps with the next event's processing delay

### AC9: Speed Multiplier Integration

**Given** the speed multiplier is active (`speedMultiplierFn()`)
**When** any travel animation plays
**Then** the travel duration is set to `Math.max(200, Math.round(400 * speedMultiplierFn()))` — the 200ms floor ensures travels remain perceptible

### AC10: CSS Keyframe Cleanup

**Given** `pvp-summon-flash` and `pvp-destroy-flash` CSS keyframes exist in `pvp-board-container.component.scss`
**When** this story is complete
**Then** both `@keyframes` blocks and their associated CSS classes (`.pvp-anim-summon`, `.pvp-anim-destroy`) are removed from the SCSS file
**And** all `[class.pvp-anim-summon]` and `[class.pvp-anim-destroy]` bindings are removed from the board container HTML template
**And** `pvp-flip-flash` and `pvp-activate-flash` keyframes and their classes remain unchanged (in-place by nature)
**And** the `--pvp-actionable-glow` (blue/gold interactive glow) system is completely untouched — it is prompt system UI, not animation effects

### AC11: Non-Field Zone Key Resolution

**Given** `locationToZoneId()` returns `null` for non-field locations (HAND, DECK, EXTRA, GY, BANISHED)
**When** the orchestrator needs a zone key for a non-field location
**Then** it constructs the key using a `locationToNonFieldZoneKey(location, player)` helper that maps:
- `LOCATION.HAND` -> `"HAND-${relativePlayer}"`
- `LOCATION.DECK` -> `"DECK-${relativePlayer}"`
- `LOCATION.EXTRA` -> `"EXTRA-${relativePlayer}"`
- `LOCATION.GRAVE` -> `"GY-${relativePlayer}"`
- `LOCATION.BANISHED` -> `"BANISHED-${relativePlayer}"`

This aligns with the zone element registry keys established in Story 7.1.

## Tasks / Subtasks

- [x] Task 1: Add non-field zone key helper to pvp-zone.utils.ts (AC2, AC11)
  - [x] 1.1 Add `locationToZoneKey(location: CardLocation, sequence: number, relativePlayer: number): string` function that: calls `locationToZoneId()` first, if non-null returns `"${zoneId}-${relativePlayer}"`, else maps LOCATION constants to non-field zone names and returns `"${name}-${relativePlayer}"`
  - [x] 1.2 Export the function from `pvp-zone.utils.ts`

- [x] Task 2: Refactor `processMoveEvent()` in AnimationOrchestratorService (AC1-AC6, AC9)
  - [x] 2.1 Import `CardTravelService` and inject it in `AnimationOrchestratorService` constructor (both are component-scoped in DuelPageComponent providers — direct injection works)
  - [x] 2.2 Import `getCardImageUrlByCode` from `pvp-card.utils.ts` and `locationToZoneKey` from `pvp-zone.utils.ts`
  - [x] 2.3 Add a `toAbsoluteUrl(relativePath: string): string` private helper (same pattern as in `CardTravelService`) — `window.location.origin + '/' + relativePath`
  - [x] 2.4 Replace `processMoveEvent()` to return `Promise<number>` (or refactor call site):
    - Compute `relativePlayer = msg.player === this.ownPlayerIndexFn() ? 0 : 1`
    - Compute `srcKey = locationToZoneKey(msg.fromLocation, msg.fromSequence, relativePlayer)`
    - Compute `dstKey = locationToZoneKey(msg.toLocation, msg.toSequence, relativePlayer)`
    - Compute `cardImage = toAbsoluteUrl(getCardImageUrlByCode(msg.cardCode))`
    - Compute `duration = Math.max(200, Math.round(400 * this.speedMultiplierFn()))` (AC9)
    - Determine event category and build `TravelOptions`:
      - **Summon** (to=MZONE from HAND/EXTRA/DECK, or to=SZONE from HAND): `{ duration, impactGlowColor: 'rgba(60,255,100,0.6)' }`
      - **Destroy** (from=MZONE/SZONE to=GRAVE/BANISHED): `{ duration, flipDuringTravel: true, departureGlowColor: 'rgba(255,60,60,0.6)' }`
      - **Bounce** (from=MZONE/SZONE to=HAND): `{ duration }` (no glow)
      - **Return to deck** (from=MZONE/SZONE to=DECK): `{ duration, flipDuringTravel: true, impactGlowColor: 'rgba(180,180,220,0.5)' }`
      - **Field-to-field** (MZONE->MZONE or SZONE->SZONE): `{ duration, impactGlowColor: 'rgba(180,180,220,0.5)' }`
      - **Other** (e.g., EXTRA->EXTRA, HAND->HAND): no animation, return 0
    - Call `await this.cardTravelService.travel(srcKey, dstKey, cardImage, options)`
    - Keep LiveAnnouncer calls for summon/destroy
  - [x] 2.5 Update `processEvent()` to handle the async nature of `processMoveEvent()`: since `processAnimationQueue()` already handles `'async'` returns, adapt `processMoveEvent()` to fire `travel()` without awaiting (fire-and-forget), returning the duration synchronously — this preserves the existing sync dequeue loop and lets the travel animation run in parallel with the timeout
  - [x] 2.6 Remove `setAnimatingZone()` calls for summon/destroy from `processMoveEvent()` — travel animations replace CSS class-based glow. Keep `setAnimatingZone()` for flip and activate (they remain in-place)

- [x] Task 3: Token dissolution animation (AC7)
  - [x] 3.1 In `processMoveEvent()`, detect token: `msg.cardCode === 0` AND `from=MZONE/SZONE` AND `to=GRAVE`
  - [x] 3.2 For tokens: find the source zone element via `cardTravelService` zone resolver, apply a fade-out + scale-down animation directly on the zone card element using Web Animations API
  - [x] 3.3 Return 300ms duration for token dissolution (no travel Promise needed)

- [x] Task 4: Remove summon/destroy CSS keyframes + class bindings (AC10)
  - [x] 4.1 In `pvp-board-container.component.scss`: remove `.pvp-anim-summon` class + `@keyframes pvp-summon-flash` block
  - [x] 4.2 In `pvp-board-container.component.scss`: remove `.pvp-anim-destroy` class + `@keyframes pvp-destroy-flash` block
  - [x] 4.3 In `pvp-board-container.component.html`: remove all `[class.pvp-anim-summon]` and `[class.pvp-anim-destroy]` bindings (4 occurrences: opponent field zones, player field zones, and EMZ in both sections)
  - [x] 4.4 Verify: `[class.pvp-anim-flip]` and `[class.pvp-anim-activate]` bindings remain intact
  - [x] 4.5 Verify: `--pvp-actionable-glow` system (blue/gold interactive glow for IDLECMD/BATTLECMD) is completely untouched

- [x] Task 5: Update `animatingZone` signal usage (cleanup)
  - [x] 5.1 The `animatingZone` signal in the orchestrator continues to work for flip/activate events — no change to signal type or board container input
  - [x] 5.2 Verify that `animatingZoneKeys` computed in board container still works correctly (it will now only produce keys for flip/activate, never summon/destroy)

- [ ] Task 6: Manual Verification (all ACs)
  - [ ] 6.1 Verify: summon from hand -> MZ shows card traveling from hand area to monster zone with green arrival glow
  - [ ] 6.2 Verify: summon from extra deck -> MZ shows card traveling from extra pile to monster zone
  - [ ] 6.3 Verify: destroy (MZ -> GY) shows card lifting with red glow, flipping to back during travel, landing on GY pile
  - [ ] 6.4 Verify: bounce (MZ -> hand) shows card traveling back to hand with no glow
  - [ ] 6.5 Verify: return to deck (MZ -> deck) shows card flipping to back, deck pulses on arrival
  - [ ] 6.6 Verify: field-to-field (MZ -> MZ) shows direct travel with neutral glow
  - [ ] 6.7 Verify: token destruction shows in-place fade-out (no travel to GY)
  - [ ] 6.8 Verify: `pvp-summon-flash` and `pvp-destroy-flash` CSS classes are fully removed (no glow on zone during travel — glow is now on the floating element via CardTravelService)
  - [ ] 6.9 Verify: `pvp-flip-flash` and `pvp-activate-flash` still work for flip summon / effect activation
  - [ ] 6.10 Verify: `--pvp-actionable-glow` (blue/gold interactive glow) still works during IDLECMD/BATTLECMD
  - [ ] 6.11 Verify: speed multiplier affects travel duration (faster with activation toggle off)
  - [ ] 6.12 Verify: `prefers-reduced-motion: reduce` skips all travel animations (instant)
  - [x] 6.13 Verify: build passes with zero errors

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **Component-scoped services**: `AnimationOrchestratorService` and `CardTravelService` are both provided in `DuelPageComponent.providers` — direct injection between them works.
- **No new dependencies**: Pure Web Animations API + Angular signals + DOM API.
- **TypeScript strict mode**: `strict: true` in tsconfig. All types must be explicit.
- **Big bang testing approach**: No automated tests until full MVP — manual verification only.

### Critical: processMoveEvent() Refactoring Strategy

The current `processMoveEvent()` returns a sync `number` (duration). The travel animation is async (Promise). Two approaches:

**Recommended approach — fire-and-forget with sync duration return:**
```typescript
private processMoveEvent(msg: MoveMsg): number {
  const relPlayer = msg.player === this.ownPlayerIndexFn() ? 0 : 1;
  const srcKey = locationToZoneKey(msg.fromLocation, msg.fromSequence, relPlayer);
  const dstKey = locationToZoneKey(msg.toLocation, msg.toSequence, relPlayer);
  const duration = Math.max(200, Math.round(400 * this.speedMultiplierFn()));
  const cardImage = this.toAbsoluteUrl(getCardImageUrlByCode(msg.cardCode));

  // Summon: HAND/EXTRA/DECK → MZONE, or HAND → SZONE
  if ((to === LOCATION.MZONE && (from === LOCATION.HAND || from === LOCATION.EXTRA || from === LOCATION.DECK))
    || (to === LOCATION.SZONE && from === LOCATION.HAND)) {
    this.cardTravelService.travel(srcKey, dstKey, cardImage, {
      duration, impactGlowColor: 'rgba(60,255,100,0.6)'
    }); // fire-and-forget — Promise completion handled by CardTravelService cleanup
    this.announceEvent('Card summoned', msg.player);
    return duration;
  }
  // ... other categories
}
```

This preserves the existing sync `processAnimationQueue()` dequeue loop. The orchestrator's `setTimeout` with `duration` ms provides the visual delay before processing the next event, while the travel animation plays during that window. No async refactoring of the queue loop needed.

### Critical: Zone Key Construction for Non-Field Zones

`locationToZoneId()` returns `null` for HAND, DECK, EXTRA, GRAVE, BANISHED. These must be mapped to the zone element registry keys from Story 7.1:

```typescript
// In pvp-zone.utils.ts
export function locationToZoneKey(location: CardLocation, sequence: number, relativePlayer: number): string {
  const zoneId = locationToZoneId(location, sequence);
  if (zoneId) return `${zoneId}-${relativePlayer}`;

  // Non-field locations → registry keys from Story 7.1
  switch (location) {
    case LOCATION.HAND: return `HAND-${relativePlayer}`;
    case LOCATION.DECK: return `DECK-${relativePlayer}`;
    case LOCATION.EXTRA: return `EXTRA-${relativePlayer}`;
    case LOCATION.GRAVE: return `GY-${relativePlayer}`;
    case LOCATION.BANISHED: return `BANISHED-${relativePlayer}`;
    default: return `UNKNOWN-${relativePlayer}`;
  }
}
```

### Critical: Card Image URL Resolution

`getCardImageUrlByCode()` returns relative paths like `/api/documents/small/code/12345` or `assets/images/card_back.jpg`. The floating element lives in `document.body` outside Angular's router context. CardTravelService already has `toAbsoluteUrl()` that prepends `window.location.origin + '/'` — the orchestrator must pass absolute URLs to `travel()`.

**Pattern from CardTravelService (Story 7.1):**
```typescript
private toAbsoluteUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return window.location.origin + (path.startsWith('/') ? '' : '/') + path;
}
```

The orchestrator should reuse this pattern or delegate URL resolution to the travel service.

### Critical: Token Detection

No `isToken` field exists in the codebase. Tokens in OCGCore have card codes, but the message filter sanitizes opponent card codes to 0. For own tokens, the card code is present. The safest approach:
- Tokens going to GY from MZONE with `cardCode === 0` are likely sanitized opponent cards, NOT necessarily tokens
- **Revised approach**: Skip token dissolution for now — treat all MSG_MOVE to GY/BANISHED uniformly as destroy travel. Token dissolution can be added in a follow-up when `isToken` metadata is available on CardOnField or MoveMsg

### Critical: `showBack` Usage for Face-Down Cards

When a face-down card is destroyed (MZ/SZ -> GY), the card was face-down so the player shouldn't see the face. Use `msg.fromPosition` to determine:
- If `fromPosition` has `FACEDOWN_ATTACK` or `FACEDOWN_DEFENSE` flags → `showBack: true` (travel shows card back throughout)
- If face-up → `showBack: false`, but `flipDuringTravel: true` (card flips from face to back during travel)

### Critical: What NOT to Touch

- **`animation-orchestrator.service.ts` chain resolution logic** — buffer & replay is Story 7.3
- **`pvp-chain-overlay/`** — no overlay changes
- **`duel-connection.ts`** — no data layer changes
- **`duel-server/`** — no server changes
- **Prompt components** — no prompt changes
- **`pvp-flip-flash`, `pvp-activate-flash`** CSS keyframes — they remain as-is
- **`--pvp-actionable-glow`** system — interactive glow for IDLECMD/BATTLECMD is unrelated

### Previous Story Intelligence (7.1)

From Story 7.1 implementation:
- **`Promise.withResolvers<void>()` not available** in ES2022 target — use manual deferred Promise pattern (`new Promise<void>(r => { resolve = r })`)
- **Pre-existing build issue**: `duel-page.component.scss` exceeds 10KB CSS budget (12.23KB) — not related to this story
- **Zone key format**: `"${ZoneId}-${relativePlayerIndex}"` (e.g., `"M1-0"`, `"GY-1"`, `"HAND-0"`) — matches registry
- **`registerZoneResolver()`** registered once in `ngAfterViewInit` — resolver stays valid as map rebuilds
- **Floating element uses `<img>` element** (not background-image) with absolute URL
- **z-index 1000** for floating elements (above board ~100, below chain overlay ~2000)
- **Glow effects** applied via inline `boxShadow` on zone element, removed after duration via tracked timer

### Git Intelligence

Recent commits:
- `6f55ef08` 7-1 — Story 7.1 implementation (CardTravelService + zone registry)
- `acb67aec` Chain build and resolve animations — Epic 6 completion
- Pattern: feature-focused commits, build validation before commit

### Source Tree — Files to Modify

**MODIFY (4 files):**
- `front/src/app/pages/pvp/pvp-zone.utils.ts` — Add `locationToZoneKey()` helper function
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` — Refactor `processMoveEvent()` to use `CardTravelService.travel()` instead of `setAnimatingZone()` for summon/destroy events
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` — Remove `pvp-summon-flash`, `pvp-destroy-flash` keyframes + `.pvp-anim-summon`, `.pvp-anim-destroy` classes
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — Remove `[class.pvp-anim-summon]` and `[class.pvp-anim-destroy]` bindings

**DO NOT TOUCH:**
- `card-travel.service.ts` — Already complete from Story 7.1
- `duel-connection.ts` — No data layer changes
- `duel-server/` — No server changes
- `pvp-chain-overlay/` — No overlay changes (Story 7.3)
- Prompt components — No prompt changes

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 7 Story 7.2 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — AnimationOrchestratorService patterns, CardTravelService API, event-specific travel behavior, z-index layers, buffer & replay]
- [Source: _bmad-output/planning-artifacts/ux-design-board-animations.md — Card travel animation phases (Lift/Travel/Land), glow replacement, event-specific behavior, stagger, timing reference]
- [Source: _bmad-output/implementation-artifacts/7-1-card-travel-service-zone-element-registry.md — Previous story patterns, zone key convention, CardTravelService API, TravelOptions interface]
- [Source: front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts — Current processMoveEvent(), setAnimatingZone(), processAnimationQueue() loop]
- [Source: front/src/app/pages/pvp/duel-page/card-travel.service.ts — travel() API, TravelOptions, toAbsoluteUrl(), zone resolver pattern]
- [Source: front/src/app/pages/pvp/duel-ws.types.ts — MoveMsg interface, LOCATION constants, POSITION flags, ZoneId type]
- [Source: front/src/app/pages/pvp/pvp-zone.utils.ts — locationToZoneId() mapping]
- [Source: front/src/app/pages/pvp/pvp-card.utils.ts — getCardImageUrlByCode(), isFaceUp()]
- [Source: front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss — pvp-summon-flash, pvp-destroy-flash keyframes to remove]
- [Source: front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html — animation class bindings to remove]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- **Task 1**: Added `locationToZoneKey()` to `pvp-zone.utils.ts` — maps OCGCore (location, sequence, relativePlayer) to zone element registry keys. Field zones delegate to `locationToZoneId()`, non-field zones (HAND, DECK, EXTRA, GRAVE, BANISHED) use direct name mapping.
- **Task 2**: Refactored `processMoveEvent()` — replaced `setAnimatingZone()` CSS-class glow with `CardTravelService.travel()` fire-and-forget calls. 5 event categories (summon, destroy, bounce, return-to-deck, field-to-field) each with correct TravelOptions per ACs. Added `CardTravelService` to `init()` config. Speed multiplier applied to travel duration with 200ms floor (AC9). Returns base 400ms to queue loop which applies its own multiplier for setTimeout delay. Face-down cards use `showBack: true` instead of `flipDuringTravel`.
- **Task 3**: Token dissolution via `dissolveTokenAtZone()` — detects `cardCode === 0` from field to GY, applies Web Animations API fade-out + scale-down on zone element. Added `resolveZone()` public method to `CardTravelService` for clean zone element access.
- **Task 4**: Removed `pvp-summon-flash` and `pvp-destroy-flash` keyframes + `.pvp-anim-summon` and `.pvp-anim-destroy` CSS classes from SCSS. Removed 6 `[class.pvp-anim-summon]`/`[class.pvp-anim-destroy]` bindings from HTML (opponent zones, EMZ, player zones). `pvp-flip-flash`, `pvp-activate-flash`, and `--pvp-actionable-glow` system untouched.
- **Task 5**: Verified `animatingZone` signal and `animatingZoneKeys`/`animatingEmzKeys` computeds still work — they now only produce flip/activate keys since orchestrator no longer sets summon/destroy.
- **Build**: Production build passes with zero errors.

### File List

- `front/src/app/pages/pvp/pvp-zone.utils.ts` — MODIFIED (added `locationToZoneKey()`, imported `CardLocation` type)
- `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` — MODIFIED (refactored `processMoveEvent()` with travel calls, `CardTravelService` dependency, delegated URL resolution)
- `front/src/app/pages/pvp/duel-page/card-travel.service.ts` — MODIFIED (exposed `toAbsoluteUrl()` as public)
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — MODIFIED (injected `CardTravelService`, passed to `animationService.init()`)
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — MODIFIED (narrowed `animatingZone` input type to `'flip' | 'activate'`)
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` — MODIFIED (removed summon/destroy CSS classes + keyframes)
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — MODIFIED (removed summon/destroy class bindings)
- `front/src/app/styles/_tokens.scss` — MODIFIED (removed dead `--pvp-summon-highlight` and `--pvp-destroy-highlight` tokens)

### Change Log

- 2026-03-10: Story 7.2 implementation — replaced CSS-class glow animations for summon/destroy with spatial card travel animations via CardTravelService. Added zone key helper, cleaned up dead CSS.
- 2026-03-10: Code review fixes — removed unreliable token dissolution (cardCode===0 ambiguous with sanitized cards), eliminated duplicated `toAbsoluteUrl()`, narrowed `animatingZone` type union, removed dead CSS tokens from `_tokens.scss`.
