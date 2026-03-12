# UX Design Specification — Chain Link Negation Feedback

**Author:** Axel
**Date:** 2026-03-10
**Scope:** PvP duel board — visual feedback when a chain link's effect is negated during resolution
**Parent spec:** ux-design-board-animations.md (addendum — chain resolution overlay)

---

## 1. Problem Statement

During chain resolution, nothing visually distinguishes a negated effect from one that resolved normally. Both chain links receive the same golden pulse glow, the same slide-right exit animation, and the same screen reader announcement. The player can only infer negation by noticing that nothing changed on the board — a cognitive burden, especially during long chains.

**Example:** Player activates Monster Reborn (CL1), opponent chains Solemn Judgment (CL2). Both links resolve with identical visual treatment. The player must deduce Monster Reborn was negated from the absence of a summoned monster.

---

## 2. Data Availability

### OCGCore Messages (currently ignored by duel-worker)

| OCGCore Message | Value | Payload |
|-----------------|-------|---------|
| `CHAIN_NEGATED` | 75 | `{ chain_size: number }` |
| `CHAIN_DISABLED` | 76 | `{ chain_size: number }` |

Both messages are defined in `@n1xx1/ocgcore-wasm` (`OcgMessageChainNegated`, `OcgMessageChainDisabled`) but fall through to the default `return null` case in `duel-worker.ts:transformMessage()`.

### Required Backend Change

- **duel-worker**: Handle `CHAIN_NEGATED` and `CHAIN_DISABLED` → transform into a single `MSG_CHAIN_NEGATED` WebSocket message.
- **ws-protocol**: Define `ChainNegatedMsg { type: 'MSG_CHAIN_NEGATED'; chainIndex: number }`.
- **Frontend**: `DuelConnection` receives `MSG_CHAIN_NEGATED` → sets `negated = true` on the matching `ChainLinkState`.

### Model Change

```typescript
export interface ChainLinkState {
  chainIndex: number;
  cardCode: number;
  cardName: string;
  player: number;
  zoneId: string | null;
  resolving: boolean;
  negated: boolean;   // ← NEW
}
```

`CHAIN_NEGATED` and `CHAIN_DISABLED` receive identical visual treatment — the OCGCore distinction has no UX value for the player.

---

## 3. Design Decisions

### 3.1 Visual Language — Prohibition Seal

Reuse the existing board-level negation indicator (grey prohibition circle from `zone-card--negated::after` in `alteration-mockup.html`) to maintain visual consistency:

- **Shape:** Circle with diagonal bar (prohibition sign), grey semi-transparent (`rgba(180, 180, 180, 0.55)`)
- **Size:** `inset: 15%` relative to the chain overlay card (slightly larger ratio than board cards due to overlay card size)
- **Appearance:** Fade-in `200ms`, synchronized with the negated shake animation
- **Persistence:** Remains visible through the resolving phase and the exit animation

### 3.2 Resolving Phase — Shake Instead of Pulse

| State | Glow | Animation | Badge text-shadow |
|-------|------|-----------|-------------------|
| **Normal** (current) | `--pvp-chain-glow-resolving` (golden pulse) | `chain-resolve-glow` keyframe | Golden |
| **Negated** | `--pvp-chain-glow-negated` (static grey) | `chain-negated-shake` keyframe | Grey neutral |

**Shake keyframe (`chain-negated-shake`):**
```
0%   { transform: ...base... translateX(0);    }
20%  { transform: ...base... translateX(-3px); }
40%  { transform: ...base... translateX(3px);  }
60%  { transform: ...base... translateX(-2px); }
80%  { transform: ...base... translateX(1px);  }
100% { transform: ...base... translateX(0);    }
```

- Duration: Same as resolve pulse (`--chain-resolve-pulse`, 600ms normal / 300ms accelerated)
- `box-shadow` is static grey (no pulse animation) — only the shake provides motion
- The prohibition seal fades in simultaneously with the shake start
- **Rationale:** Pulse communicates "energy rising" (positive). Shake communicates "struggling and failing" (negation). The grey color reinforces inertness.

### 3.3 Exit Animation — Negated (Collapse)

New keyframe `chain-negated-exit` replaces `chain-resolve-exit` when `negated = true`:

| Property | Normal resolve exit | Negated exit |
|----------|---------------------|--------------|
| Movement | Slide right +200px | No translation — stays in place |
| Scale | 0.85 | Shrink to 0.6 |
| Filter | — | `grayscale(1) brightness(0.5)` |
| Opacity | Fade to 0 | Fade to 0 |
| Feeling | "Card departs to execute its effect" | "Card collapses under the seal, energy drained" |

Duration: Same as normal exit (`--chain-resolve-exit`, 600ms / 300ms accelerated).

### 3.4 CSS Tokens

| Token | Value |
|-------|-------|
| `--pvp-chain-glow-negated` | `rgba(160, 160, 160, 0.6)` |

### 3.5 Template Changes (PvpChainOverlayComponent)

- New CSS class `chain-card--negated` on the front card when `negated = true` (replaces `chain-card--resolving`)
- Prohibition seal rendered via `::after` pseudo-element on `chain-card--negated` (same technique as board alteration)
- New CSS class `chain-card--negated-exiting` on the exiting card (replaces `chain-card--resolve-exiting`)

---

## 4. Temporal Flow

```
MSG_CHAIN_SOLVING(N)
  → If link already marked negated: grey glow + shake + seal fade-in
  → Else: golden pulse glow (current behavior)

  [MSG_CHAIN_NEGATED]  ← may arrive between SOLVING and SOLVED
  → Mark link.negated = true
  → Switch glow to grey + start shake + seal fade-in

MSG_CHAIN_SOLVED(N)
  → If negated: exit "collapse" (grayscale + shrink in place)
  → Else: exit slide right (current behavior)
  → Overlay fades → replay board events → overlay returns
```

**Note:** `MSG_CHAIN_NEGATED` may arrive before or after `MSG_CHAIN_SOLVING` for the same link — the seal applies on reception regardless of timing.

---

## 5. Accessibility

### prefers-reduced-motion: reduce

- No shake animation, no fade-in transition
- Prohibition seal and grey `box-shadow` displayed **instantly** (static visual feedback preserved)
- Exit: card disappears instantly (same as current reduced-motion behavior)

### Screen Reader (LiveAnnouncer)

| State | Announcement |
|-------|-------------|
| Normal resolving | `"Chain Link N resolving: CardName"` (unchanged) |
| Negated resolving | `"Chain Link N negated: CardName"` |
| Accelerated buffer | `"Chain of N links resolved (M negated)"` |

---

## 6. Edge Cases

| Edge Case | Mitigation |
|-----------|------------|
| `MSG_CHAIN_NEGATED` arrives before `MSG_CHAIN_SOLVING` | Store negated flag on `ChainLinkState` immediately; Effect B picks it up when resolving starts |
| `MSG_CHAIN_NEGATED` arrives after `MSG_CHAIN_SOLVED` (race) | Ignored — link already removed from active chain. No visual impact needed (the link is gone) |
| Multiple negations in same chain | Each negated link gets independent seal + shake + collapse exit |
| `CHAIN_NEGATED` + `CHAIN_DISABLED` for same link | Both set `negated = true` — idempotent, no double animation |
| Accelerated mode (3+ auto-resolved) | Shake duration halved (300ms). Seal still visible. Collapse exit halved. |

---

## 7. Interaction with Existing Systems

### AnimationOrchestratorService

- `MSG_CHAIN_NEGATED` processing: No timing return needed — it only mutates `ChainLinkState.negated`. The visual change is driven by the overlay's Effect B reacting to the flag.
- If `MSG_CHAIN_NEGATED` arrives between SOLVING and SOLVED (inside buffer window), it is **not buffered** — it applies immediately to the chain link state.

### PvpChainOverlayComponent

- **Effect B** extended: when `resolvingLink.negated === true`, set a `negatedResolving` signal instead of `resolvingIndex` → drives `chain-card--negated` CSS class
- **`onChainLinkResolved()`**: Check `negated` flag to choose between `chain-card--resolve-exiting` and `chain-card--negated-exiting`

### DuelConnection

- New handler for `MSG_CHAIN_NEGATED`: `applyChainNegated(chainIndex)` → sets `negated = true` on matching active chain link

### Buffer & Replay (Story 7.3)

- No interaction — negation feedback is purely overlay-level. Board event buffering/replay proceeds identically whether a link was negated or not.
