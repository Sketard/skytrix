# Bug: Simulator Hand Cards Oversized

**Status**: `open`
**Priority**: Medium
**Scope**: Simulator only — does not block deck builder work

## Problem

Hand cards in the simulator are rendered at ~1060px × 96px instead of their expected ~65px × 96px. They overflow the hand zone and overlap board zones.

## Root Cause

The shared `app-card` component (refactored in story 8-2) uses responsive sizing on `:host`:

```scss
:host {
  display: block;
  width: 100%;
  height: 100%;
  aspect-ratio: 59 / 86;
}
```

In the simulator hand, cards are positioned absolutely inside `.sim-hand` (1060px wide, `position: relative`). The hand SCSS sets `height: 96px` on card wrappers but **no explicit width**:

```scss
.sim-hand > :not(.cdk-drag-placeholder) {
  position: absolute;
  height: $sim-hand-card-height; // 96px — no width set
}
```

Resolution chain:
1. `height: 96px` (hand rule, higher specificity than `:host`)
2. `width: 100%` (from `:host`) → resolves to containing block `.sim-hand` = **1060px**
3. Both dimensions explicit → `aspect-ratio: 59/86` is **ignored**
4. Result: 1060px × 96px per card

## Fix

Add `width: auto` to the hand card rule in `hand.component.scss` so `aspect-ratio` can derive width from height:

```scss
.sim-hand > :not(.cdk-drag-placeholder) {
  position: absolute;
  bottom: 4px;
  left: 50%;
  width: auto;                    // ← ADD: let aspect-ratio calculate from height
  height: $sim-hand-card-height;
  // ... rest unchanged
}
```

Expected result: `width: auto` + `height: 96px` + `aspect-ratio: 59/86` → width = 96 × 59/86 ≈ **65.9px**.

## Files

| File | Action |
|------|--------|
| `front/src/app/pages/simulator/hand.component.scss` | Add `width: auto` on line ~25 |
