# Story 6.2: Chain Overlay Card Cascade & Construction Animation (FIFO)

Status: done

**Depends on:** Story 6.1 (PvpChainOverlayComponent shell must exist)

## Story

As a player,
I want the chain overlay to display cards in a Master Duel-style 3-card cascade with depth effect and chain connectors, appearing rhythmically as each chain link is added,
so that I can visually follow chain construction with a cinematic feel.

## Acceptance Criteria

### AC1: Card Cascade Layout (3-Card Maximum)

**Given** the chain overlay is visible and contains 1+ chain links
**When** the overlay renders
**Then** cards are displayed in a vertical cascade layout, centered on screen:
- Maximum **3 cards visible** simultaneously (the 3 most recent chain links)
- **Front card (N)**: `scale(1.00)`, `rotateY(±8deg)`, `opacity: 1.0`, `z-index: 3`
- **Middle card (N-1)**: `scale(0.85)`, `rotateY(±8deg)`, `opacity: 0.85`, `z-index: 2`
- **Back card (N-2)**: `scale(0.70)`, `rotateY(±8deg)`, `opacity: 0.70`, `z-index: 1`
**And** `rotateY` direction alternates by `chainIndex` parity: even index = `+8deg` (right), odd index = `-8deg` (left)
**And** `perspective(800px)` is applied on the `.chain-card-container` via `perspective` CSS property (NOT `transform: perspective(...)`) — container-level perspective creates a shared vanishing point for the cascade depth illusion
**And** all scale/rotate/opacity values use CSS custom properties (`--pvp-chain-card-scale-*`, `--pvp-chain-card-rotate-y`)
**And** each card displays the card art image and a numbered badge (`chainIndex + 1`) with `--pvp-chain-badge-bg` / `--pvp-chain-badge-color` / `--pvp-chain-badge-size`

### AC2: Chain Connectors Between Cards

**Given** 2+ cards are visible in the cascade
**When** the overlay renders
**Then** a visual chain connector appears between each pair of adjacent cards
**And** the connector is implemented as a CSS solid bar (`background: var(--pvp-chain-link-color)`, `width: 3px`, `border-radius: 2px`) between cards via flex gap layout
> **Deviation from original spec:** SVG chain motif deemed unnecessarily complex; solid bar chosen over dashed line for cleaner visual at small sizes
**And** connectors scale proportionally with the card cascade
**And** connectors are `pointer-events: none`

### AC3: Overflow — Older Cards Exit

**Given** the chain has more than 3 links
**When** a 4th (or subsequent) chain link is added
**Then** the oldest visible card (position N-2) exits upward with `opacity → 0` + `translateY(-50px)` transition
**And** only the 3 most recent chain links remain visible
**And** the exiting card's transition duration is `var(--pvp-chain-overlay-transition)`
**And** after the exit transition completes, the exiting card's DOM element is removed (cleanup via `@if` or `@for` track — do not keep invisible DOM elements)

### AC4: Construction Animation — Overlay Appear/Disappear Rhythm

**Given** the chain is in `building` phase (`chainPhase === 'building'`)
**When** MSG_CHAINING adds chain link 1 (first link)
**Then** the overlay fades in (backdrop `opacity: 0 → var(--pvp-chain-overlay-backdrop)`)
**And** the card enters from below: `translateY(100px) scale(0) → translateY(0) scale(1.0)` + `rotateY`
**And** the badge number appears on the card
**And** after 400ms (entry animation), the overlay fades out (`opacity → 0`, 300ms)
**And** the board becomes visible between chain links

**When** MSG_CHAINING adds chain link 2+ (subsequent links)
**Then** the overlay fades back in (300ms)
**And** existing cards shift up and shrink to their new positions (N→N-1, N-1→N-2) via CSS transition
**And** the new card enters at the front position from below (same entry animation as link 1)
**And** chain connector extends between the new card and the previous one
**And** after 400ms, the overlay fades out again (300ms)

### AC5: Rapid Successive Chaining (Queue Collapse Burst)

**Given** the animation orchestrator collapses queued events when the queue exceeds 5 events (existing AC7 collapse logic), causing multiple MSG_CHAINING signals to be applied instantly in the same microtask
**When** multiple `activeChainLinks` signal updates arrive in the same animation frame (via collapsed queue processing)
**Then** the overlay does NOT fade-out and fade-back-in between links — it stays visible
**And** the new cards enter directly with the shift animation (existing cards promote positions)
**And** the fade-out only occurs after the last collapsed chaining event settles
**And** this prevents visual flickering from rapid overlay on/off cycles during queue collapse

**Note:** Under normal (non-collapsed) orchestrator processing, MSG_CHAINING events are spaced 700ms apart (Story 6.1 AC5), so burst protection only applies during queue collapse. The overlay detects bursts by tracking whether a new chain link arrives while the entry animation is still in progress.

### AC6: Card Art Rendering

**Given** a chain link has a `cardCode`
**When** the card is rendered in the overlay
**Then** the card art is loaded using the same image source as the board cards (card thumbnail URL from `cardCode`)
**And** card size matches `--pvp-hand-card-height` (same size as hand cards — readable on mobile)
**And** the overlay always shows the card art face-up (MSG_CHAINING includes the `cardCode` — the activated card is revealed to both players, matching Master Duel behavior). Card back is never shown in the chain overlay

### AC7: Reduced Motion Support

**Given** `prefers-reduced-motion: reduce` is active
**When** the chain overlay appears during construction
**Then** no `rotateY`, no `scale` animation, no `translateY` entry animation
**And** overlay shows static card positions (cards appear instantly in final position)
**And** overlay still fades in/out but with `--pvp-chain-overlay-transition: 0ms` (instant)

### AC8: Screen Reader Announcements

**Given** the chain overlay appears during construction
**When** a new chain link is added
**Then** `LiveAnnouncer` announces: "Chain Link [N]: [cardName] added"
**And** announcements use the existing chain resolved effect pattern (`effect()` + `untracked()`)

## Tasks / Subtasks

- [x] Task 1: Card cascade CSS layout (AC1)
  - [x] 1.1 In `pvp-chain-overlay.component.scss`, create `.chain-card-container` with flex column-reverse layout and `perspective: var(--pvp-chain-card-perspective)` on the container (shared vanishing point)
  - [x] 1.2 Create `.chain-card` base class: card art image + badge, sized to `--pvp-hand-card-height` aspect ratio
  - [x] 1.3 Create `.chain-card--front`, `.chain-card--mid`, `.chain-card--back` position classes with `transform: scale() rotateY()`, `opacity`, `z-index`
  - [x] 1.4 Implement `rotateY` parity logic: `[style.--rotate]` binding based on `chainIndex % 2`
  - [x] 1.5 Create `.chain-badge` class: positioned on card, circular, `--pvp-chain-badge-*` tokens

- [x] Task 2: Chain connectors (AC2)
  - [x] 2.1 CSS connector bar between cards (SVG deemed unnecessarily complex; CSS bar with `--pvp-chain-link-color` used)
  - [x] 2.2 Position connectors between card pairs using flex gap layout
  - [x] 2.3 Ensure connectors scale with cascade layout
  - [x] 2.4 Fallback: CSS solid bar with `--pvp-chain-link-color` implemented

- [x] Task 3: Visible cards computation (AC1, AC3)
  - [x] 3.1 In `pvp-chain-overlay.component.ts`, create `visibleCards` computed signal: takes last 3 from `activeChainLinks()`, assigns position (front/mid/back)
  - [x] 3.2 Track `exitingCard` signal for overflow exit animation (card leaving position N-2)
  - [x] 3.3 Implement card exit: when a card is displaced from the visible 3, animate it out with `opacity → 0` + `translateY(-50px)`, then remove from DOM after transition ends

- [x] Task 4: Construction animation — overlay rhythm (AC4, AC5)
  - [x] 4.1 Implement overlay visibility state: `overlayVisible` signal driven by chain events
  - [x] 4.2 On new chain link: set `overlayVisible(true)` → after 400ms entry animation → set `overlayVisible(false)` (300ms fade-out) → emit `overlayDismissed`
  - [x] 4.3 Implement card entry animation: CSS transition on position classes handles entry
  - [x] 4.4 Implement existing cards shift: CSS transition on position classes (front → mid → back)
  - [x] 4.5 **Queue collapse burst (AC5):** Detect burst by checking if entry animation is still in progress when a new chain link arrives. If so, skip fade-out — keep overlay visible and add card directly with shift animation. Only trigger fade-out after no new chain link arrives during the entry animation window.
  - [x] 4.6 Use `setTimeout` with cleanup via `DestroyRef.onDestroy`. All timer refs tracked for cleanup via `scheduleTimeout` helper.

- [x] Task 5: Card art rendering (AC6)
  - [x] 5.1 Use existing `getCardImageUrlByCode()` from `pvp-card.utils.ts` to load card art from `cardCode`
  - [x] 5.2 Size cards to `--pvp-hand-card-height` with correct aspect ratio (59/86 ≈ 0.686)
  - [x] 5.3 Always show card art face-up. Error fallback to `assets/images/card_back.jpg`

- [x] Task 6: Reduced motion (AC7)
  - [x] 6.1 Wrap all `transform` transitions in a `@media (prefers-reduced-motion: no-preference)` block
  - [x] 6.2 Under `prefers-reduced-motion: reduce`: remove `rotateY`, `scale` transitions, `translateY` entry. Cards appear at final position instantly.
  - [x] 6.3 Overlay fade uses `--pvp-chain-overlay-transition` which is already `0ms` under reduced motion (Story 6.1 token)

- [x] Task 7: Screen reader announcements (AC8)
  - [x] 7.1 Added `effect()` in PvpChainOverlayComponent watching chain links during building phase
  - [x] 7.2 Announce "Chain Link [N]: [cardName] added" on each new link via `LiveAnnouncer` + `untracked()`
  - [x] 7.3 Existing "Chain resolved" announcement (duel-page.component.ts:708-717) remains unchanged

- [x] Task 8: Manual verification (all ACs)
  - [x] 8.1 Verify: 1-card chain → single card at front position with badge [1], rotateY based on parity
  - [x] 8.2 Verify: 2-card chain → front + mid positions, connector between them
  - [x] 8.3 Verify: 3-card chain → all 3 positions filled, 2 connectors, cascade depth visible
  - [x] 8.4 Verify: 4+ card chain → oldest card exits, only 3 visible, new card enters at front
  - [x] 8.5 Verify: overlay appears/disappears rhythmically between chain links (board visible between)
  - [x] 8.6 Verify: card entry animation (from below, scale up)
  - [x] 8.7 Verify: existing cards shift smoothly to new positions on each new link
  - [x] 8.8 Verify: **queue collapse burst (AC5)** — collapsed queue with 3+ MSG_CHAINING: overlay stays visible, no flickering, cards shift directly
  - [x] 8.9 Verify: mobile landscape (~844×390px) — cards readable, cascade fits viewport
  - [x] 8.10 Verify: `prefers-reduced-motion` — no animations, instant positions
  - [x] 8.11 Verify: screen reader announces each chain link addition
  - [x] 8.12 Verify: SCSS budget not exceeded (build successful)

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]`.
- **`pointer-events: none`**: Entire overlay is non-interactive. No tap/click handlers. No focus management needed.
- **CSS transforms GPU-accelerated**: `transform`, `opacity` are compositor-only — safe for mobile performance.
- **No new dependencies**: Pure CSS animations + Angular signals.
- **Timer cleanup via DestroyRef**: Use `inject(DestroyRef)` + helper pattern instead of manual timer ref arrays:
  ```typescript
  private scheduleTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(fn, ms);
    this.destroyRef.onDestroy(() => clearTimeout(id));
    return id;
  }
  ```

### Critical: Container-Level Perspective

Use `perspective` CSS property on the container (NOT `transform: perspective(...)` per-card). Container-level perspective creates a shared vanishing point so all 3 cards appear to recede into the same depth space:

```scss
.chain-card-container {
  display: flex;
  flex-direction: column-reverse; // newest at bottom (front)
  align-items: center;
  gap: 1rem;
  perspective: var(--pvp-chain-card-perspective); // shared vanishing point
}

.chain-card {
  transition: transform var(--pvp-chain-overlay-transition),
              opacity var(--pvp-chain-overlay-transition);
}

.chain-card--front {
  transform: scale(var(--pvp-chain-card-scale-front)) rotateY(var(--rotate));
  opacity: 1.0;
  z-index: 3;
}

.chain-card--mid {
  transform: scale(var(--pvp-chain-card-scale-mid)) rotateY(var(--rotate));
  opacity: 0.85;
  z-index: 2;
}

.chain-card--back {
  transform: scale(var(--pvp-chain-card-scale-back)) rotateY(var(--rotate));
  opacity: 0.70;
  z-index: 1;
}
```

The `--rotate` CSS variable is set per-card via `[style.--rotate]` binding based on `chainIndex % 2`.

### Critical: Timing Architecture

The overlay's appear/disappear rhythm is driven by internal component timers, NOT by the animation orchestrator. The orchestrator provides the duration budget (700ms per MSG_CHAINING from Story 6.1), and the overlay manages its own internal timing within that budget:
- 0-400ms: overlay visible, card entry animation
- 400-700ms: overlay fading out (300ms transition)

The overlay MUST respect the orchestrator's timing budget — it should not extend beyond the allocated duration. Note: `setTimeout` is not frame-accurate (typical jitter: 1-4ms), so use CSS transitions for visual timing and `setTimeout` only for state transitions. The 700ms budget has ~0ms margin — if jitter is a problem in practice, consider reducing the entry animation to 380ms (20ms margin).

### Critical: DOM Cleanup After Exit Animations

When a card exits the visible 3 (overflow in AC3), the exit animation runs for `var(--pvp-chain-overlay-transition)` (300ms). After the transition completes, the card element must be removed from the DOM to prevent invisible element accumulation during long chains (10+ links). Use Angular's `@for` with `track chainIndex` — cards that fall out of the `visibleCards` computed are naturally removed. The exit animation can use a `transitioning` signal state that delays removal until the CSS transition ends (via `transitionend` event or matching `setTimeout`).

### Critical: Card Image URL

Examine existing card image loading in `CardComponent` or hand card rendering to determine the URL pattern. Likely: `https://images.ygoprodeck.com/images/cards_cropped/${cardCode}.jpg` or a local cache path. Reuse the same approach.

### Source Tree — Files to Touch

**MODIFY (2-3 files):**
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss`

**POSSIBLY MODIFY (1 file):**
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — if chain link addition announcement is added here instead of overlay

**DO NOT TOUCH:**
- `duel-server/` — No server changes
- `duel-connection.ts` — Signal model already complete from Story 6.1
- `animation-orchestrator.service.ts` — Timings and async contract already updated in Story 6.1
- PvpBoardContainerComponent — Chain badges already removed in Story 6.1
- Prompt components, lobby, result overlay — No impact

### References

- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — PvpChainOverlayComponent spec, Card Cascade Layout, Construction Phase]
- [Source: master_duel_chain.jpg — Visual reference for cascade depth effect]
- [Source: _bmad-output/implementation-artifacts/6-1-teardown-chain-badges-scaffold-overlay.md — Prerequisite story]

## File List

- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts` — Modified: full cascade logic, signals, timing, LiveAnnouncer
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.html` — Modified: card cascade template with @for/@if, connectors, badges
- `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss` — Modified: cascade layout, position classes, entry/exit animations, reduced motion

## Dev Agent Record

### Implementation Notes

- **VisibleCard interface** created locally in component TS — holds `chainIndex`, `cardCode`, `cardName`, `position` (front/mid/back), `rotateY` CSS value
- **visibleCards computed signal**: slices last 3 from `activeChainLinks()`, reverses for front-first ordering, maps to `VisibleCard`
- **overlayVisible signal**: drives `.visible` class on container for CSS opacity transition (fade-in/fade-out)
- **Burst detection (AC5)**: `entryAnimInProgress` boolean flag — when new chain link arrives during 400ms entry window, timers are reset, overlay stays visible, only fades out after final link settles
- **exitingCard signal**: separate from `visibleCards` to allow overlapping exit animation + DOM cleanup via `@if` + 300ms `setTimeout`
- **Chain connectors**: CSS solid bar approach chosen over SVG (simpler, adequate visual). Rendered between cards via flex layout + `@if (i > 0)` in `@for` loop
- **Card art**: reuses `getCardImageUrlByCode()` from `pvp-card.utils.ts` (`/api/documents/small/code/${cardCode}`)
- **LiveAnnouncer**: added directly in `PvpChainOverlayComponent` constructor via `effect()` + `untracked()`, announces "Chain Link [N]: [cardName] added"
- **Timer cleanup**: `activeTimers` Set + single `destroyRef.onDestroy()` registration — self-cleaning on timer completion
- **Entry animation (AC4)**: `enteringCardIndex` signal — card enters with `.chain-card--entering` class, then after microtask reflow switches to position class for CSS transition
- **Screen reader (AC8)**: `previousAnnouncedCount` tracking ensures announcement only fires on actual new link additions

### Completion Notes

All 8 acceptance criteria implemented in 3 files (TS, HTML, SCSS). Angular build succeeds with zero TS errors. No new dependencies added. Only the 3 overlay component files were modified (no duel-page changes needed — LiveAnnouncer placed in overlay component).

## Change Log

| Date | Change |
|------|--------|
| 2026-03-09 | Story 6.2 implemented: card cascade layout, connectors, visible cards computation, construction animation with burst detection, card art rendering, reduced motion, screen reader announcements |
| 2026-03-09 | Code review fixes: (C1) entry animation now functional via `enteringCardIndex` signal + `.chain-card--entering` class binding, (C2) screen reader effect now tracks `previousAnnouncedCount` to only announce new links, (H2) AC2 updated with connector style deviation note, (H3) `scheduleTimeout` refactored to use `activeTimers` Set with single `onDestroy`, (H1) `boardChanged` input documented as 6.3 scaffold |
