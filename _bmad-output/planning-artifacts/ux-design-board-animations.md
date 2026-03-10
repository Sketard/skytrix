# UX Design Specification — Board Animations & Chain Resolution Travel

**Author:** Axel
**Date:** 2026-03-10
**Scope:** PvP duel board — card travel animations, chain resolution board replay, XYZ material visual feedback
**Parent spec:** ux-design-specification-pvp.md (PvP-C polish layer)

---

## 1. Problem Statement

During chain resolution, board state changes (card destroyed, summoned, LP change) apply instantly via `BOARD_STATE` signal while the chain overlay is visible. When the overlay briefly hides to show the board, the user sees the final state already in place — no visual feedback of *what happened*. Current zone animations (summon flash, destroy flash) play behind the overlay, invisible to the user.

Additionally, all card zone transitions (summon, destroy, bounce, draw) use in-place glow effects. Cards appear/disappear without spatial context — the user cannot perceive *where* a card came from or *where* it went.

**Scope:** Card travel animations replace in-place glow effects **globally** — during chain resolution replay AND during normal gameplay (summon during Main Phase, destroy by battle, draw during Draw Phase, etc.). The buffer & replay mechanism is chain-specific; the travel animations themselves apply everywhere the orchestrator processes board events.

---

## 2. Design Decisions

### 2.1 Buffer & Replay During Chain Resolution

**Current flow:**
```
MSG_CHAIN_SOLVING(N) → 600ms pulse glow (overlay visible)
  MSG_MOVE (board events) → animations play BEHIND overlay (invisible)
MSG_CHAIN_SOLVED(N) → overlay exit → overlay hides → fixed 1000ms pause → overlay returns
```

**New flow:**
```
MSG_CHAIN_SOLVING(N) → 600ms pulse glow (overlay visible)
  MSG_MOVE (board events) → BUFFERED (not processed)
MSG_CHAIN_SOLVED(N) → overlay exit animation
  → overlay fades out
    → REPLAY buffered events in parallel on the visible board
    → pause duration = total replay animation time
  → overlay fades back in (if more chain links remain)
  → chainOverlayReady = true
```

**Key change:** Board events between SOLVING and SOLVED are buffered instead of processed immediately, then replayed as visible animations during the overlay-hidden window. The board pause duration becomes **dynamic** — calculated from the replay animation duration instead of a fixed 1000ms.

**No visible board events:** If a chain link produces no board-changing events, skip the pause entirely (same as current `chainOverlayBoardChanged = false` behavior).

### 2.2 Parallel Replay Grouping

Buffered events replay in **two sequential beats**, each internally parallel:

| Beat | Events | Behavior | Duration |
|------|--------|----------|----------|
| **Beat 1** (zones) | MSG_MOVE, MSG_FLIP_SUMMONING, MSG_CHANGE_POS | All zone animations play simultaneously | `max(individual durations)` ~400ms |
| **Beat 2** (LP) | MSG_DAMAGE, MSG_RECOVER, MSG_PAY_LPCOST | All LP animations play simultaneously | `baseLpDuration` from CSS token |

If only one beat has events, the other is skipped. Total board pause = Beat 1 + Beat 2 (when both exist).

Example — Raigeki (destroy 5 monsters):
- Beat 1: 5 destroy travel animations play in parallel with 50ms stagger → `max(400) + 4×50 = 600ms`
- Beat 2: none
- Total pause: ~600ms + overlay fade margins

### 2.3 Card Travel Animations (Lift → Travel → Land)

Replace in-place glow effects with spatial card movement between zones.

#### Animation Phases

**Lift (0-15% of duration):**
- Card scales up slightly (`scale(1.15)`)
- Box-shadow expands (card "lifts" off the board)
- Source zone gets a subtle departure glow (color matches event type)

**Travel (15-75% of duration):**
- Card translates from source zone rect to destination zone rect (`position: fixed` floating element)
- Slight 3D rotation during flight (`rotateY(8deg)`) for dynamism
- Card shows face or back depending on context (face-down set = back)
- Easing: `ease-in-out` for natural arc

**Land (75-100% of duration):**
- Micro-bounce on arrival: `scale(1.15 → 1.05 → 1)` (overshoot + settle)
- Impact glow pulse on destination zone (single pulse, color matches event type)
- Shadow shrinks (card settles onto board)

#### Technical Approach

- **Floating card element**: `position: fixed` overlay created dynamically
- **Position calculation**: `getBoundingClientRect()` on source and destination zone DOM elements
- **Animation API**: Web Animations API (`element.animate()`) for dynamic keyframes + Promise-based completion
- **Cleanup**: Floating element removed after animation completes; card is already in final position via BOARD_STATE
- **Ownership**: A dedicated `CardTravelService` (component-scoped, like the orchestrator) creates, animates, and removes floating elements. The orchestrator calls it with source/destination zone IDs + card image info; the service resolves DOM rects and returns a `Promise<void>` for completion. This keeps DOM manipulation out of the orchestrator.

#### Glow Replacement

Card travel animations **fully replace** the current in-place keyframe effects (`pvp-summon-flash`, `pvp-destroy-flash`). The existing CSS keyframes are removed. The travel animation's Lift phase (departure glow) and Land phase (impact glow) provide the equivalent visual feedback with added spatial context. `pvp-flip-flash` and `pvp-activate-flash` remain unchanged (they are in-place by nature).

#### Event-Specific Travel Behavior

| Event | Source | Destination | Travel Details |
|-------|--------|-------------|----------------|
| **MSG_MOVE summon** (Hand/Deck/Extra → MZ/SZ) | Hand area / Deck pile / Extra pile | Target MZ or SZ | Face visible on arrival, green impact glow |
| **MSG_MOVE destroy** (MZ/SZ → GY/Banished) | Source MZ or SZ | GY or Banished pile | Card flips to back during travel, red departure glow |
| **MSG_MOVE bounce** (MZ/SZ → Hand) | Source MZ or SZ | Hand area | No destructive glow, softer travel arc |
| **MSG_MOVE return to deck** (MZ/SZ → Deck) | Source MZ or SZ | Deck pile | Card flips to back, deck pulses on arrival |
| **MSG_MOVE field-to-field** (MZ → MZ, SZ → SZ) | Source zone | Target zone | Direct travel, neutral glow |
| **MSG_FLIP_SUMMONING** | In-place | In-place | No travel — existing scaleX flip + golden glow (unchanged) |
| **MSG_CHANGE_POS** (FD→FU) | In-place | In-place | No travel — existing flip animation (unchanged) |
| **MSG_DRAW** | Deck pile | Hand area | Card back visible during travel, no flip reveal (hand updates via BOARD_STATE). Server provides `player` + `cards: (number \| null)[]` — sufficient for animation. Currently a no-op in orchestrator (`return 0`) — must be promoted to a travel event. |
| **Token destruction** | Source MZ | None (dissolves) | Dissolve in-place: fade out + scale down, no travel to GY |

#### Source/Destination for Non-Field Zones

| Zone | Travel anchor point |
|------|---------------------|
| **Player Hand** | Hand container element (bottom of screen) |
| **Opponent Hand** | Opponent's visible reversed hand (top of screen) |
| **Deck, Extra, GY, Banished** | Center of the pile element's bounding rect |
| **EMZ** | Center of the EMZ slot element |

#### Stagger for Multiple Simultaneous Travels

When multiple cards travel in parallel (e.g., Raigeki → 5 destroys to GY):
- **~50ms stagger** between each card's departure
- Cards converge toward the destination with slight position offsets
- Prevents visual overlap at the arrival point

### 2.4 MSG_SHUFFLE_HAND — Deck Shuffle Animation

Visual effect on the deck zone only:

- **Fan-out (~100ms):** 2-3 pseudo-element card backs (`::before`, `::after`) offset ±3px / ±2deg from deck center
- **Fan-in (~150ms):** Pseudo-elements return to stacked position
- Total duration: ~250ms
- Implementation: CSS keyframes on deck zone pseudo-elements, triggered by animation class

### 2.5 XYZ Material Visual Enhancement

#### Resting State (new)

Add **stacked card indicators** beneath the XYZ monster:
- 2-3 small rectangles (card-back colored) offset by ~2px each, visible below/behind the monster card
- Number matches `overlayMaterials.length` (max 3 visible layers regardless of actual count)
- Existing blue badge with count number is preserved on top
- Implementation: pseudo-elements or sibling divs with absolute positioning and slight translate offsets

#### Detach Animation (new)

When a material is detached (MSG_MOVE from MZONE overlay → GY):
- One stacked card "slides out" from under the XYZ monster (vertical offset + slide)
- Then performs a standard travel animation toward GY
- Departure point: position of the XYZ parent monster, with slight vertical offset downward
- Badge count updates (3 → 2), one stacked indicator disappears
- When 0 materials remain: all stacked indicators removed

#### Overflow Fix

`.emz-slot` currently has `overflow: hidden` — change to `overflow: visible` to prevent clipping of stacked material indicators on EMZ-positioned XYZ monsters. `.zone` already uses `overflow: visible`.

---

## 3. Timing & Duration Reference

### Base Durations

| Animation | Normal | Accelerated (3+ chain) | Reduced Motion |
|-----------|--------|------------------------|----------------|
| Card travel (Lift→Travel→Land) | 400ms | 250ms (min 200ms floor) | Instant (no travel) |
| Stagger between parallel cards | 50ms | 30ms | 0ms |
| LP counter animation | CSS `--pvp-transition-lp-counter` | Same × speed multiplier | 0ms |
| Deck shuffle | 250ms | 150ms | Instant |
| XYZ detach slide-out | 200ms | 120ms | Instant |

### Board Pause Calculation

```
boardPauseDuration =
  (hasBeat1 ? max(beat1Durations) + (beat1Count - 1) * stagger : 0)
  + (hasBeat2 ? baseLpDuration : 0)
```

### Speed Multiplier (AC8)

All durations are multiplied by `speedMultiplierFn()` (0.5 when activation toggle = off, 1.0 when on). The 200ms floor for card travel applies AFTER the multiplier.

---

## 4. Accessibility

### prefers-reduced-motion: reduce

- **Card travel**: No floating element, no movement. Card appears/disappears instantly in source/destination zones (current behavior preserved).
- **Deck shuffle**: No fan-out/fan-in. Instant state change.
- **XYZ detach**: No slide-out. Material indicator disappears instantly, badge updates.
- **Board pause during chain**: Duration = 0ms (existing behavior via `reducedMotion` flag).

### Screen Reader (LiveAnnouncer)

Existing announcements remain unchanged:
- "Chain Link N resolving: CardName"
- "Card summoned" / "Card destroyed" / "LP: X"
- Accelerated mode: buffered summary "Chain of N links resolved"

No additional announcements needed for visual travel animations — the existing semantic announcements already convey the game state changes.

---

## 5. Edge Cases & Mitigations

| Edge Case | Mitigation |
|-----------|------------|
| **Multiple cards to same destination** (5× destroy → GY) | 50ms stagger + slight position offsets at arrival; cards converge naturally |
| **Card face-down during travel** | Floating element uses card back image based on card position at event time, not at replay time |
| **XYZ material detach** | Travel starts from XYZ parent monster position with vertical offset; badge and stacked indicators update after travel completes |
| **Token destruction** | Dissolve in-place (fade + scale down), no travel — tokens don't go to GY |
| **BOARD_STATE already applied** | Floating element covers the zone transition; if animation interrupted, user sees valid final state (graceful degradation) |
| **Opponent summon from hand** | Travel starts from opponent's visible reversed hand area |
| **No board-changing events in chain link** | Skip pause entirely, overlay returns immediately (unchanged behavior) |
| **Accelerated mode minimum floor** | Travel duration never below 200ms even with speed multiplier, to remain perceptible |
| **Resize during travel** | Accepted risk — travel lasts ~400ms, resize during this window is extremely unlikely |

---

## 6. Interaction with Existing Systems

### AnimationOrchestratorService Changes

- **Buffer mode**: When `_insideChainResolution` + board-changing event → push to `_bufferedBoardEvents[]` instead of processing
- **`animatingZone` signal**: Evolve from single zone to `Set<string>` of zone keys to support parallel replay (option B — aligned with existing `animatingZoneKeys()` computed in board component)
- **MSG_CHAIN_SOLVED**: Instead of returning `'async'` immediately, first transmit buffered events for replay
- **Board pause duration**: Calculated from buffer contents, not fixed
- **MSG_DRAW**: Promote from no-op (`return 0`) to a travel event — use `DrawMsg.player` to determine deck zone, trigger travel animation (deck → hand)
- **MSG_MOVE (summon/destroy)**: Replace `setAnimatingZone()` calls with `CardTravelService` calls — return the travel Promise duration instead of fixed 300ms

### CardTravelService (new, component-scoped)

- **Responsibility**: Creates `position: fixed` floating card elements, calculates source/destination rects from DOM, runs Web Animations API, cleans up on completion
- **API**: `travel(source: ZoneRef, destination: ZoneRef, cardImage: string, options: TravelOptions): Promise<void>`
- **Zone ref resolution**: Accepts zone IDs, resolves to DOM rects via `getBoundingClientRect()` on board container's zone elements (requires a zone element registry or `ViewChildren` query)
- **Parallel support**: Multiple concurrent `travel()` calls — each creates its own floating element

### PvpChainOverlayComponent Changes

- **`handleBoardChangePause()`**: Replace fixed `boardPause` duration with dynamic duration signal from orchestrator (`chainBoardReplayDuration`)
- **Overlay contract**: Remains signal-based (`chainOverlayReady`), but the "hidden window" duration now depends on board animation completion

### PvpBoardContainerComponent Changes

- **`animatingZoneKeys()`**: Already supports set-based lookups — extend to accept multiple simultaneous entries
- **Zone element registry**: Expose zone DOM element refs so `CardTravelService` can resolve bounding rects
- **XYZ stacked indicators**: New pseudo-elements or template additions to zone card rendering
- **`.emz-slot`**: Change `overflow: hidden` → `overflow: visible`
- **Remove** `pvp-summon-flash` and `pvp-destroy-flash` CSS keyframes + associated classes (replaced by travel animations)
- **Keep** `pvp-flip-flash` and `pvp-activate-flash` (in-place by nature)
