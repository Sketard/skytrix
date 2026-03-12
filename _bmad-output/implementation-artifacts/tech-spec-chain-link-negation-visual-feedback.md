---
title: 'Chain Link Negation Visual Feedback'
slug: 'chain-link-negation-visual-feedback'
created: '2026-03-11'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Angular 19.1.3', 'TypeScript 5.5.4 strict', 'SCSS', 'Node.js worker threads', '@n1xx1/ocgcore-wasm']
files_to_modify:
  - duel-server/src/ws-protocol.ts
  - duel-server/src/duel-worker.ts
  - duel-server/src/message-filter.ts
  - front/src/app/pages/pvp/duel-ws.types.ts
  - front/src/app/pages/pvp/types/duel-state.types.ts
  - front/src/app/pages/pvp/duel-page/duel-connection.ts
  - front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts
  - front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.html
  - front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss
  - front/src/app/styles/_tokens.scss
code_patterns:
  - 'signal() + .update() immutable arrays — never mutate directly'
  - '[class.specific-class] binding only — never [class]'
  - 'effect() + untracked() for all side effects'
  - 'Angular 19 control flow: @if, @for, @switch'
  - 'import type for type-only imports'
  - 'OCGCore chain_size is 1-based: chainIndex = msg.chain_size - 1'
  - 'ws-protocol.ts and duel-ws.types.ts are mirror files — update both in same commit'
test_patterns: ['No automated tests — manual verification only (big bang approach)']
---

# Tech-Spec: Chain Link Negation Visual Feedback

**Created:** 2026-03-11

## Overview

### Problem Statement

During chain resolution, negated effects are visually indistinguishable from effects that resolved normally. Both chain links receive the same golden pulse glow, slide-right exit animation, and identical screen reader announcement. The player must deduce negation from the absence of a board change — a significant cognitive burden during long chains.

### Solution

Surface the OCGCore `CHAIN_NEGATED` / `CHAIN_DISABLED` messages through the full pipeline (worker → WebSocket → frontend) and apply distinct visual treatment to negated chain links in `PvpChainOverlayComponent`: static grey glow, horizontal shake animation, a prohibition seal (`::after` pseudo-element), and a collapse exit (grayscale + shrink in place) instead of the normal slide-right exit.

### Scope

**In Scope:**
- duel-worker: transform `CHAIN_NEGATED` and `CHAIN_DISABLED` into `MSG_CHAIN_NEGATED`
- ws-protocol: define `ChainNegatedMsg` type (server + frontend)
- message-filter: whitelist `MSG_CHAIN_NEGATED` for passthrough broadcast
- `ChainLinkState` model: add `negated: boolean`
- `DuelConnection`: `applyChainNegated()` method + immediate handler (no animation queue)
- `PvpChainOverlayComponent`: `negatedResolvingIndex` signal, Effect B extension, exit logic, negated announcements
- CSS: `chain-card--negated`, `chain-card--negated-exiting`, `chain-negated-shake`, `chain-negated-exit` keyframes, prohibition seal `::after`, reduced-motion support
- Accessibility: distinct "Chain Link N negated" LiveAnnouncer announcement; coalesced accelerated announcement includes negation count

**Out of Scope:**
- Chain building phase visuals (negation never occurs during building)
- Board-level negation badges (separate Epic 8 concern)
- Any new npm dependencies
- Spring Boot backend
- Prompt components, lobby, waiting room

## Context for Development

### Codebase Patterns

- **Signal-based state**: `signal()` + `.update()` with immutable arrays in `DuelConnection`. Never mutate.
- **`[class.specific-class]` binding only**: NEVER `[class]` (recurring bug Epics 1–3).
- **`effect()` + `untracked()`**: All side effects (LiveAnnouncer, navigation) follow this pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **`import type`** for type-only imports.
- **Explicit `null`** — never `undefined` or field omission.
- **prefers-reduced-motion**: Must be handled on all animated elements.
- **No new dependencies**: CSS-only animations, no animation libraries.
- **OCGCore chain_size**: 1-based → `chainIndex = msg.chain_size - 1` (same as existing CHAIN_SOLVING/CHAIN_SOLVED transforms in duel-worker.ts).
- **MSG_CHAIN_NEGATED is NOT queued**: It mutates `ChainLinkState.negated` immediately via `applyChainNegated()`, not via the animation queue. The overlay reacts via Angular's reactive signal system.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `_bmad-output/planning-artifacts/ux-design-chain-negation-feedback.md` | Full UX design spec — source of truth for all visual decisions |
| `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.ts` | Current overlay TS — Effect B, `resolvingCardInfo` capture pattern, `ExitingCardState`, `onChainLinkResolved()` |
| `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.scss` | Current overlay CSS — existing keyframes (`chain-resolve-glow`, `chain-resolve-exit`), reduced-motion block |
| `front/src/app/pages/pvp/duel-page/pvp-chain-overlay/pvp-chain-overlay.component.html` | Current overlay template — existing `[class.chain-card--resolving]` binding to extend |
| `front/src/app/pages/pvp/duel-page/duel-connection.ts` | `applyChainSolving/Solved/End()` pattern to follow for `applyChainNegated()` |
| `front/src/app/pages/pvp/types/duel-state.types.ts` | `ChainLinkState` interface — add `negated: boolean` |
| `duel-server/src/duel-worker.ts:239-243` | Existing CHAIN_SOLVING/CHAIN_SOLVED transforms — exact pattern to replicate |
| `duel-server/src/message-filter.ts:110-113` | Chain passthrough whitelist block — add `MSG_CHAIN_NEGATED` |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` | `.negated-icon` / `zone-card--negated::after` — visual reference for prohibition seal design |
| `front/src/app/styles/_tokens.scss` | PvP tokens section (line ~148) — add `--pvp-chain-glow-negated` |

### Technical Decisions

1. **Unified treatment**: `CHAIN_NEGATED` (75) and `CHAIN_DISABLED` (76) both map to `MSG_CHAIN_NEGATED` — the OCGCore distinction has no UX value for the player.
2. **`negatedResolvingIndex` signal**: A separate signal from `resolvingIndex` drives `chain-card--negated` CSS class. When a link is negated, `negatedResolvingIndex` is set instead of `resolvingIndex`, preventing the golden glow from appearing.
3. **`ExitingCardState.negated`**: Add `negated?: boolean` to carry negation state from Effect B capture → `onChainLinkResolved()` → template CSS class selection.
4. **Prohibition seal via `::after`**: Same technique as `zone-card--negated::after` in board container. Grey semi-transparent circle + bar, `inset: 15%`, fades in 200ms.
5. **Shake replaces pulse during negation**: `chain-negated-shake` keyframe uses `translateX` oscillation. `box-shadow` is static grey (no pulse). Duration matches `--chain-resolve-pulse`.
6. **Collapse exit replaces slide-right**: `chain-negated-exit` stays in place, shrinks to `scale(0.6)`, applies `grayscale(1) brightness(0.5)`, fades to opacity 0. Duration matches `--chain-resolve-exit`.
7. **`MSG_CHAIN_NEGATED` timing**: May arrive before OR after `MSG_CHAIN_SOLVING` for the same link. `applyChainNegated()` sets the flag immediately; Effect B reads it whenever `resolving: true` appears — handles both orderings.
8. **Race condition (after CHAIN_SOLVED)**: If `MSG_CHAIN_NEGATED` arrives after the link is already removed, `applyChainNegated()` updates nothing (immutable filter finds no match) — safe no-op.

## Implementation Plan

### Tasks

**Task 1 — Server: New message type** (AC: pipeline)
- 1.1 `duel-server/src/ws-protocol.ts` (line 194): Add after `ChainEndMsg` interface:
  ```typescript
  export interface ChainNegatedMsg {
    type: 'MSG_CHAIN_NEGATED';
    chainIndex: number;
  }
  ```
  Add `| ChainNegatedMsg` to `ServerMessage` union after `| ChainEndMsg` (line ~649).
- 1.2 `duel-server/src/duel-worker.ts`: In `transformMessage()`, add after the `CHAIN_END` case (line ~245):
  ```typescript
  case OcgMessageType.CHAIN_NEGATED:
  case OcgMessageType.CHAIN_DISABLED:
    return { type: 'MSG_CHAIN_NEGATED', chainIndex: msg.chain_size - 1 };
  ```
- 1.3 `duel-server/src/message-filter.ts`: Find `case 'MSG_CHAIN_END':` in the chain passthrough block (currently at line 113) and add `case 'MSG_CHAIN_NEGATED':` as a new line immediately after it (the new case becomes line 114). Do not modify line 113 itself.

**Task 2 — Frontend types** (AC: model)
- 2.1 `front/src/app/pages/pvp/duel-ws.types.ts`: **Mirror of ws-protocol.ts — apply identical changes as Task 1.1.** Use named anchors, not line numbers — this file's line numbers may differ from `ws-protocol.ts` and were not independently verified: find the `ChainEndMsg` interface by name and add `ChainNegatedMsg` after it; find `| ChainEndMsg` in the `ServerMessage` union by name and add `| ChainNegatedMsg` after it. ⚠️ Must be committed in the same commit as Task 1.1.
- 2.2 `front/src/app/pages/pvp/types/duel-state.types.ts` (line 13): Add `negated: boolean` field to `ChainLinkState` after `resolving: boolean`.
- 2.3 `front/src/app/pages/pvp/duel-page/duel-connection.ts` (line 575): Add `negated: false` to `_pendingChainEntry` initialization in `MSG_CHAINING` handler (after `resolving: false`).

**Task 3 — Frontend: DuelConnection handler** (AC: data flow)
- 3.1 `front/src/app/pages/pvp/duel-page/duel-connection.ts` (after line 280, after `applyChainEnd()`): Add as **private** method (called only from `handleMessage()`, no orchestrator involvement):
  ```typescript
  private applyChainNegated(chainIndex: number): void {
    this._activeChainLinks.update(links =>
      links.map(l => l.chainIndex === chainIndex ? { ...l, negated: true } : l),
    );
  }
  ```
- 3.2 In `handleMessage()` switch: insert immediately after the `MSG_CHAIN_END` block (line 594 `break;`) and before the `MSG_MOVE` block (line 596). NOT in animation queue:
  ```typescript
  case 'MSG_CHAIN_NEGATED':
    this.applyChainNegated((message as ChainNegatedMsg).chainIndex);
    break;
  ```
- 3.3 Line 3 of `duel-connection.ts`: `import type { ChainingMsg, MoveMsg }` — add `ChainNegatedMsg` here: `import type { ChainingMsg, MoveMsg, ChainNegatedMsg }`.

**Task 4 — Overlay TS: negated state handling** (AC: visual logic)
- 4.1 `pvp-chain-overlay.component.ts`: Add `readonly negatedResolvingIndex = signal(-1)` after `resolvingIndex`.
- 4.2 Add `private resolvingNegated = false` field (alongside `resolvingCardInfo`).
- 4.3 Extend `ExitingCardState` interface: add `negated: boolean` field (required, not optional — consistent with "no undefined" pattern). `ExitingCardState` has **two construction sites** — both must be updated:
  - (1) Overflow exit in `onNewChainLink()` (~line 310, `type: 'overflow'`): pass `negated: false`
  - (2) Normal/negated resolution in `onChainLinkResolved()` (~line 361-369): covered in Task 4.5 — pass `negated: this.resolvingNegated`
  TypeScript strict mode will produce a compile error at both sites if `negated` is omitted.
  ⚠️ **Tasks 4.3 and 4.5 must be implemented atomically** (in the same editing pass). Adding `negated: boolean` to the interface (Task 4.3) immediately causes a compile error at the `onChainLinkResolved()` construction site (Task 4.5). Do not commit between these two tasks.
- 4.4 Extend Effect B (`// Effect B — resolving detection`):
  - Extend the **early-return guard** (`if (phase !== 'resolving' || links.length === 0)`): add `this.negatedResolvingIndex.set(-1)` alongside the existing `this.resolvingIndex.set(-1)` (prevents stale value when phase exits resolving without going through `onChainEnd()`).
  - When `resolvingLink` found:
    - If `resolvingLink.negated === true`: call `this.negatedResolvingIndex.set(resolvingLink.chainIndex)` AND `this.resolvingIndex.set(-1)` (clears any previously set golden glow if CHAIN_NEGATED arrived after CHAIN_SOLVING)
    - Else: call `this.resolvingIndex.set(resolvingLink.chainIndex)` and leave `negatedResolvingIndex` at -1 (current behavior)
  - Store `this.resolvingNegated = resolvingLink.negated` alongside `resolvingCardInfo`
  - Announcement: `resolvingLink.negated ? "Chain Link N negated: CardName" : "Chain Link N resolving: CardName"`
- 4.5 Extend `onChainLinkResolved()`:
  - **Replace** the existing `const resolvedIdx = this.resolvingIndex()` (line 357) with: `const resolvedIdx = this.resolvingNegated ? this.negatedResolvingIndex() : this.resolvingIndex()`. Do NOT add a second declaration alongside the existing one — that would cause a TypeScript "variable already declared" compile error. This ensures negated links (where `resolvingIndex()` is -1) still produce an exit animation card. For chain-1 negated (`chainIndex === 0`): `resolvedIdx = 0 >= 0` is true but `overlayVisible` is already false, so `exitingCard` is set but invisible — the orchestrator timing (`chainOverlayReady`) still functions correctly.
  - When building `exitingCard`: include `negated: this.resolvingNegated`
  - In the `scheduleTimeout` cleanup callback, **order is critical — do not reorder**. The callback must follow this exact sequence:
    ```typescript
    // 1. FIRST — reads this.resolvingNegated to decide board reveal skip
    this.handleBoardChangePause();
    // 2. THEN — reset flags (handleBoardChangePause must see the correct value)
    this.resolvingNegated = false;
    this.resolvingCardInfo = null;
    this.resolvingIndex.set(-1);
    this.negatedResolvingIndex.set(-1);
    ```
    **If `resolvingNegated` is reset before `handleBoardChangePause()`, every negated link falls through to the normal board-change path — AC4-bis fails silently with no compile or runtime error.**
- 4.6-bis Extend `handleBoardChangePause()`: if `this.resolvingNegated === true` at call time, skip board change detection entirely — call `orchestrator.chainOverlayReady.set(true)` immediately without calling `replayBufferedEvents()`. **Synchronous call is safe**: the existing `handleBoardChangePause()` already calls `chainOverlayReady.set(true)` synchronously in the `else` branch (line 390 — when `chainOverlayBoardChanged()` is false). This is the same pattern. Rationale: a negated effect guarantees no board state change between CHAIN_SOLVING and CHAIN_SOLVED, so the board reveal pause is semantically meaningless and should be omitted. ⚠️ **Risk (unverified assumption)**: activation costs (e.g., `MSG_MOVE` for tribute costs) may be emitted by OCGCore before the chain resolves. If such moves were already buffered during the overlay phase, skipping `replayBufferedEvents()` will drop those board-change animations silently. Verify against OCGCore WASM source before shipping. If cost-related moves are confirmed to arrive before CHAIN_SOLVING (i.e., before the overlay opens), the skip is safe. If they can arrive between CHAIN_SOLVING and CHAIN_SOLVED, this task must be revised to call `replayBufferedEvents()` unconditionally.
- 4.6 Extend `onChainEnd()` cleanup: add `this.negatedResolvingIndex.set(-1)`, `this.resolvingNegated = false`, and `this.negatedLinksCount = 0`.
- 4.6-ter Abnormal duel termination — no extra code needed: `DUEL_END`, `REMATCH_STARTING`, and `STATE_SYNC` all result in `_activeChainLinks.set([])` and `_chainPhase.set('idle')` in `DuelConnection`. Effect A in the overlay watches both signals; when `phase === 'idle' && links.length === 0`, it calls `onChainEnd()` (line 173-175 of overlay component). Task 4.6's additions to `onChainEnd()` therefore cover these abnormal termination paths automatically. The overlay has no `onDuelEnd()` / `onRematchStarting()` methods — it is purely signal-reactive. **Verify** after implementation: confirm that no timing window exists where the overlay is mid-animation when the signals reset (the scheduleTimeout callback holds a reference to `this.resolvingNegated` by closure, so the reset in `onChainEnd()` will not interrupt an in-flight timeout).
- 4.7 Add `private negatedLinksCount = 0` field. In Effect B, inside the `resolvingLink.negated === true` branch, increment **before** calling `this.negatedResolvingIndex.set(resolvingLink.chainIndex)`:
  ```typescript
  if (resolvingLink.negated) {
    if (this.negatedResolvingIndex() === -1) this.negatedLinksCount++; // guard: === -1 BEFORE the set below
    this.negatedResolvingIndex.set(resolvingLink.chainIndex);
    this.resolvingIndex.set(-1);
  }
  ```
  The `=== -1` check MUST happen before `.set()`. After `.set()`, `negatedResolvingIndex()` is no longer -1, so a subsequent re-fire of Effect B for the same link (before `onChainLinkResolved()` clears the signal) will correctly be blocked.
  In `onChainEnd()`, **inside the existing `if (this.announcementBuffer.length > 0)` block (accelerated mode only)**, include the negation count:
  - If `negatedLinksCount > 0`: announce `"Chain of N links resolved (${negatedLinksCount} negated)"` instead of `"Chain of N links resolved"`
  - This is deliberately scoped to accelerated mode to match existing behavior: in normal mode, per-link "Chain Link N negated" announcements already convey the information.

**Task 5 — Overlay HTML: CSS class bindings** (AC: visual)
- 5.1 `pvp-chain-overlay.component.html`: On the exiting card `<div>`:
  - Change `[class.chain-card--resolve-exiting]="exiting.type === 'resolved'"` to `[class.chain-card--resolve-exiting]="exiting.type === 'resolved' && !exiting.negated"`
  - Add `[class.chain-card--negated-exiting]="exiting.type === 'resolved' && exiting.negated"`
- 5.2 On the visible cards `@for` block, add `[class.chain-card--negated]` binding:
  ```html
  [class.chain-card--negated]="card.position === 'front' && phase() === 'resolving' && exitingCard()?.type !== 'resolved' && negatedResolvingIndex() === card.chainIndex"
  ```
  (Mirrors the existing `[class.chain-card--resolving]` binding structure)

**Task 6 — Overlay SCSS + Token** (AC: visual, accessibility)
- 6.1 `front/src/app/styles/_tokens.scss` (after `--pvp-chain-glow-resolving` in the `// --- Chain Overlay (Story 6.1) ---` block): Add:
  ```scss
  --pvp-chain-glow-negated: rgba(160, 160, 160, 0.6);
  ```
- 6.2 `pvp-chain-overlay.component.scss`: Add **all three keyframes** together before any of the classes that reference them. SCSS doesn't error on missing keyframe names, but animations will silently not play if the keyframe is undefined. Add `chain-negated-shake`, `chain-seal-fade-in`, and `chain-negated-exit` as a single block (Tasks 6.5 content is also included here for ordering safety — the class in Task 6.6 references `chain-negated-exit`):
  ```scss
  @keyframes chain-negated-shake {
    0%   { transform: perspective(1200px) rotateZ(3deg) rotateY(-8deg) translateX(0); }
    20%  { transform: perspective(1200px) rotateZ(3deg) rotateY(-8deg) translateX(-3px); }
    40%  { transform: perspective(1200px) rotateZ(3deg) rotateY(-8deg) translateX(3px); }
    60%  { transform: perspective(1200px) rotateZ(3deg) rotateY(-8deg) translateX(-2px); }
    80%  { transform: perspective(1200px) rotateZ(3deg) rotateY(-8deg) translateX(1px); }
    100% { transform: perspective(1200px) rotateZ(3deg) rotateY(-8deg) translateX(0); }
  }

  @keyframes chain-seal-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  ```
  (Task 6.5's `chain-negated-exit` keyframe should also be placed here, before `.chain-card--negated-exiting` in Task 6.6.)
- 6.3 Add `.chain-card--negated` class (after `.chain-card--resolving`):
  ```scss
  .chain-card--negated {
    box-shadow: 0 0 20px var(--pvp-chain-glow-negated);

    @media (prefers-reduced-motion: no-preference) {
      animation: chain-negated-shake var(--chain-resolve-pulse, 600ms) ease-in-out;
    }

    &::after {
      content: '';
      position: absolute; // Note: .chain-card already has position: absolute — it IS the containing block for this ::after. No position: relative needed.
      inset: 15%;
      border-radius: 50%;
      border: 3px solid rgba(180, 180, 180, 0.8);
      background: rgba(180, 180, 180, 0.55);
      // Diagonal bar via clip-path simulation: use a rotated pseudo gradient
      background-image: linear-gradient(
        to bottom right,
        transparent calc(50% - 1.5px),
        rgba(180, 180, 180, 0.9) calc(50% - 1.5px),
        rgba(180, 180, 180, 0.9) calc(50% + 1.5px),
        transparent calc(50% + 1.5px)
      );
      pointer-events: none;
      z-index: 5;

      @media (prefers-reduced-motion: no-preference) {
        animation: chain-seal-fade-in 200ms ease-out forwards;
      }
    }

    .chain-badge {
      text-shadow:
        0 0 8px rgba(160, 160, 160, 0.6),
        2px 4px 6px rgba(0, 0, 0, 0.7);
      -webkit-text-stroke: 2px rgba(160, 160, 160, 0.8);
    }
  }
  ```
- 6.4 Add `chain-negated-exit` keyframe (place in the SCSS file alongside the keyframes added in Task 6.2, before Task 6.6's class). ⚠️ Known DRY limitation: the `from`/`to` blocks hardcode `top`/`left` values matching `.chain-card--front` (same limitation as the existing `chain-resolve-exit` keyframe — accepted pattern for this project):
  ```scss
  @keyframes chain-negated-exit {
    from {
      top: calc(80% - 45dvh);
      left: calc(70% - 45dvh * 59 / 86);
      transform: perspective(1200px) rotateZ(3deg) rotateY(-8deg) scale(1);
      filter: grayscale(0) brightness(1);
      opacity: 1;
    }
    to {
      top: calc(80% - 45dvh);
      left: calc(70% - 45dvh * 59 / 86);
      transform: perspective(1200px) rotateZ(3deg) rotateY(-8deg) scale(0.6);
      filter: grayscale(1) brightness(0.5);
      opacity: 0;
    }
  }
  ```
- 6.6 Add `.chain-card--negated-exiting` class (after `.chain-card--resolve-exiting`):
  ```scss
  .chain-card--negated-exiting {
    height: 45dvh;
    width: calc(45dvh * 59 / 86);
    z-index: 4;

    @media (prefers-reduced-motion: no-preference) {
      animation: chain-negated-exit var(--chain-resolve-exit, 600ms) ease-in forwards;
    }

    @media (prefers-reduced-motion: reduce) {
      opacity: 0;
    }
  }
  ```
- 6.7 Extend `@media (prefers-reduced-motion: reduce)` block (after line ~263):
  ```scss
  .chain-card--negated {
    animation: none;
    box-shadow: 0 0 20px var(--pvp-chain-glow-negated); // static grey — preserved

    &::after {
      animation: none; // suppresses chain-seal-fade-in — seal appears instantly
      opacity: 1;
    }
  }
  ```
- 6.8 Add badge size + color rule for negated-exiting card:
  ```scss
  .chain-card--negated-exiting .chain-badge {
    font-size: calc(45dvh * 0.20);
    right: -2%;
    // Keep grey treatment consistent through collapse animation
    text-shadow:
      0 0 8px rgba(160, 160, 160, 0.6),
      2px 4px 6px rgba(0, 0, 0, 0.7);
    -webkit-text-stroke: 2px rgba(160, 160, 160, 0.8);
  }
  ```

### Acceptance Criteria

#### AC1: MSG_CHAIN_NEGATED flows from OCGCore to frontend

**Given** `OcgMessageType.CHAIN_NEGATED` or `OcgMessageType.CHAIN_DISABLED` fires in duel-worker
**When** the worker processes the message
**Then** `MSG_CHAIN_NEGATED { type: 'MSG_CHAIN_NEGATED'; chainIndex: number }` is emitted to the server
**And** `message-filter.ts` passes it through to both players (not dropped)
**And** the frontend `DuelConnection` receives it and calls `applyChainNegated(chainIndex)`
**And** `_activeChainLinks` is updated: the matching link gets `negated: true`

#### AC2: Negated link shows grey glow + shake + prohibition seal

**Given** `MSG_CHAIN_NEGATED` has been received (setting `link.negated = true`)
**When** `MSG_CHAIN_SOLVING` fires for that link (or has already fired)
**Then** the front card in `PvpChainOverlayComponent` gets CSS class `chain-card--negated` (not `chain-card--resolving`)
**And** the card has a static grey box-shadow (`--pvp-chain-glow-negated`)
**And** the `chain-negated-shake` keyframe plays (horizontal shake)
**And** a prohibition seal (`::after` pseudo-element, grey circle + diagonal bar) fades in over 200ms simultaneously with the shake
**And** the chain badge number uses grey neutral text-shadow (not golden)

#### AC3: Negated link exits with collapse animation

**Given** `MSG_CHAIN_SOLVED` fires for a negated link
**When** `onChainLinkResolved()` plays the exit animation
**Then** the exiting card gets CSS class `chain-card--negated-exiting` (not `chain-card--resolve-exiting`)
**And** the card stays in place (no translateX), shrinks to `scale(0.6)`, applies `grayscale(1) brightness(0.5)`, fades to opacity 0
**And** duration matches `--chain-resolve-exit` (600ms normal / 300ms accelerated)

#### AC4: Pre-arrival edge case (MSG_CHAIN_NEGATED before MSG_CHAIN_SOLVING)

**Given** `MSG_CHAIN_NEGATED` arrives before `MSG_CHAIN_SOLVING` for the same link
**When** `MSG_CHAIN_SOLVING` fires
**Then** Effect B reads `link.negated === true` and applies negated treatment from the start
**And** no golden glow ever appears for that link

#### AC4-bis: Board reveal phase skipped for negated links

**Given** a chain link resolves with `negated === true`
**When** `handleBoardChangePause()` is called after the exit animation
**Then** the board reveal pause is skipped unconditionally (regardless of `chainOverlayBoardChanged()`)
**And** `orchestrator.chainOverlayReady.set(true)` is called immediately
**And** `replayBufferedEvents()` is NOT called
**Rationale:** A negated effect produces no board state changes between CHAIN_SOLVING and CHAIN_SOLVED — the board reveal would show nothing new.
**⚠️ Verify before implementing:** Confirm via OCGCore WASM source that activation costs (MSG_MOVE etc.) cannot be buffered in the CHAIN_SOLVING→CHAIN_SOLVED window for negated links. If they can, revert Task 4.6-bis to always call `replayBufferedEvents()`.

#### AC5: Post-removal race (MSG_CHAIN_NEGATED after MSG_CHAIN_SOLVED)

**Given** `MSG_CHAIN_NEGATED` arrives after the link has already been removed from `_activeChainLinks`
**When** `applyChainNegated(chainIndex)` runs
**Then** the update finds no matching link → no-op (safe)
**And** no visual change occurs (the link is already gone)

#### AC6: Accessibility — LiveAnnouncer

**Given** a negated link is resolving
**When** Effect B detects `resolving: true` on a link with `negated: true`
**Then** `LiveAnnouncer` announces `"Chain Link N negated: CardName"` (not "resolving")
**And** in accelerated mode, the coalesced summary includes negation count: `"Chain of N links resolved (M negated)"` when M > 0
**And** normal (non-negated) links still announce `"Chain Link N resolving: CardName"`

#### AC8: Chain-1 single-link negation

**Given** a chain of exactly 1 link that gets negated (`MSG_CHAIN_NEGATED` received)
**When** `MSG_CHAIN_SOLVING` fires and `MSG_CHAIN_SOLVED` follows
**Then** `negatedResolvingIndex` is set (so `resolvingNegated = true`)
**And** the overlay remains hidden (chain-1 building phase never shows the overlay — unchanged)
**And** `onChainLinkResolved()` still runs: `resolvedIdx = negatedResolvingIndex() = 0`, `exitingCard` is set but invisible (overlay hidden)
**And** `handleBoardChangePause()` skips the board reveal (negated) and calls `chainOverlayReady.set(true)` immediately
**And** the orchestrator resumes normally

#### AC7: prefers-reduced-motion

**Given** `prefers-reduced-motion: reduce` is active
**When** a chain link is negated
**Then** no shake animation plays
**And** prohibition seal appears instantly (no fade-in transition)
**And** grey `box-shadow` is displayed statically (preserved per UX spec: "static visual feedback preserved")
**And** negated exit: card disappears instantly (same as existing reduced-motion exit behavior)

## Additional Context

### Dependencies

- No new npm dependencies
- Depends on existing `PvpChainOverlayComponent` (Stories 6.1–6.3, all done)
- Depends on existing `AnimationOrchestratorService` (no changes needed there)
- `MSG_CHAIN_NEGATED` is NOT processed by the orchestrator — it bypasses the animation queue entirely

### Testing Strategy

- No automated tests (project "big bang" approach — full MVP first)
- Manual verification:
  - Trigger a negation: activate Monster Reborn (CL1), opponent chains Solemn Judgment (CL2). Chain resolves LIFO: CL2 (Solemn Judgment) resolves **first** — golden glow + slide exit (normal). Then CL1 (Monster Reborn) resolves **negated** — shake + seal + collapse exit.
  - Verify MSG_CHAIN_NEGATED arriving before CHAIN_SOLVING: use debug log viewer to confirm ordering; seal should appear immediately on CHAIN_SOLVING
  - Verify multiple negations in same chain: each gets independent seal + shake + collapse
  - Verify accelerated mode: animations halved, announcement buffer includes negation count
  - Verify prefers-reduced-motion: no shake, instant seal, instant disappear

### Notes

- **⚠️ Mirror files**: `duel-server/src/ws-protocol.ts` and `front/src/app/pages/pvp/duel-ws.types.ts` are identical copies (comment header says "copied verbatim"). Any change to one MUST be mirrored in the other in the same commit. This applies to `ChainNegatedMsg` interface + `ServerMessage` union update.
- The prohibition seal `::after` design is intentionally simpler than the board-level `negated.svg` SVG. An inline SVG was considered but rejected for DRY KISS — the CSS gradient diagonal-bar approach is sufficient for the overlay card size and maintains zero new asset dependencies.
- `negatedResolvingIndex` and `resolvingIndex` are mutually exclusive by design: Effect B sets one or the other, never both.
- **MSG_CHAIN_NEGATED during active shake**: If `MSG_CHAIN_NEGATED` arrives after `MSG_CHAIN_SOLVING` has already started the shake animation (i.e., mid-animation), `applyChainNegated()` sets `negated: true` on the link, which re-triggers Effect B. Effect B will call `negatedResolvingIndex.set(chainIndex)` and clear `resolvingIndex` to -1. Angular's change detection will switch the CSS class from `chain-card--resolving` to `chain-card--negated`, restarting the animation with the shake + seal fade-in. This is the intended behavior — the prohibition seal appears whenever the negation is known, regardless of timing.
- **TypeScript strict and construction sites**:
  - `ChainLinkState`: adding `negated: boolean` will cause a compile error at any raw-object construction site. The only such site is `_pendingChainEntry` in `handleMessage()` (Task 2.3). All other mutations use spread (`{ ...l, resolving: true }`) — no additional `ChainLinkState` sites to update.
  - `ExitingCardState`: adding `negated: boolean` exposes **two** raw-object construction sites — the overflow site in `onNewChainLink()` (Task 4.3.1) and the resolution site in `onChainLinkResolved()` (Task 4.5). Both must be updated before the project will compile.
- The `chain_size` field in OCGCore is 1-based (verified: existing CHAIN_SOLVING/CHAIN_SOLVED both use `msg.chain_size - 1`). **`CHAIN_NEGATED` (75) and `CHAIN_DISABLED` (76) both carry `chain_size: number`** — confirmed against `@n1xx1/ocgcore-wasm` type definitions (`index.d.ts` lines 870–900). The `msg.chain_size - 1` transform in Task 1.2 is type-safe and correct for both message types.

## Review Notes
- Adversarial review completed 2026-03-11
- Findings: 12 total, 10 fixed, 2 skipped (false alarms)
- Resolution approach: fix-all (including lows)
- Post-review fixes applied:
  - F1/F8/F10: Announcement dedup guard in Effect B (`lastAnnouncedResolvingIndex` / `lastAnnouncedNegated`)
  - F2: `negatedAtSchedule` captured at scheduling time, passed explicitly to `handleBoardChangePause(negated)`
  - F3: Comment in `onChainLinkResolved()` timeout corrected
  - F5: `applyChainNegated()` now also updates `_pendingChainEntry` when chainIndex matches
  - F6: `chain-card--negated` HTML binding guards against `enteringCardIndex()` coexistence
  - F7: Explicit `right: -2%` rule added to `.chain-card--negated .chain-badge`
  - F9: Covered by F2 fix (closure isolation)
  - F11: Comment added documenting intentional seal visibility under reduced-motion
  - F12: Redundant `(message as ChainNegatedMsg)` cast removed; `ChainNegatedMsg` import dropped
- Skipped: F4 (false alarm — `clearAllTimers()` can't cancel exit timeout before `chainOverlayReady`), F2 race analysis (Angular async effect scheduling prevents the race)
