---
title: Inspector Gesture Redesign — Direction B (Master Duel-style)
date: 2026-06-05
status: ready-for-implementation
authors: Sally (UX) + Winston (architecture) + Axel (validation)
estimated_effort: ~8h focused
target_branch: feat/inspector-gesture-redesign
related_memory:
  - card-inspector-premium-spec (deferred, different scope)
---

# Inspector Gesture Redesign — PvP

## TL;DR

In PvP, the card inspector currently opens as a **side-effect of every
tap** on a card — including taps that the user intended as primary
actions (selecting a target in a `SELECT_CARD` prompt, activating a card
from hand, clicking a chain link). The inspector takes over the screen,
masks the prompt dialog underneath, and breaks the action flow.

This document specifies the refactor that aligns Skytrix on the
**Master Duel / MTG Arena / Hearthstone** convention :
- **Primary gesture (tap / click)** = act
- **Secondary gesture (right-click desktop, long-press touch)** = inspect

The inspector becomes a **modeless, on-demand** UI element instead of an
incidental modal that hijacks every interaction.

## Problem statement

### Today's behavior (the bug)

A click/tap on a card emits **two outputs at once** in 8 sites :

| # | Source | Gesture | Side-effect |
|---|--------|---------|-------------|
| 1 | Player hand (`pvp-hand-row`) | Tap | Inspector + (optional) action menu |
| 2 | Opponent hand | Tap | Inspector |
| 3 | Field zone (M1-M5, S1-S5, …) | Click | Inspector + (optional) action menu |
| 4 | EMZ zone | Click | Same as #3 |
| 5 | Zone browser (pile GY/Banished/Extra opened) | Click | Inspector + (optional) prompt selection |
| 6 | Game Log panel entries | Click | Inspector |
| 7 | Prompt card grid (`SELECT_CARD/CHAIN/SUM/TRIBUTE/UNSELECT`) | Tap | Inspector (full-screen) + selection |
| 8 | Prompt sort card (`SORT_CARD`) | Tap | Inspector (full-screen) + rank toggle |

On **desktop** the inspector wrapper jumps straight to **full mode**
([pvp-card-inspector-wrapper.ts:50-56](../../front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.ts#L50-L56))
— the compact branch only fires on `prompt active AND viewport <768px`.
The `forceExpanded=true` passed by `onLongPressInspect`
([duel-page.ts:1041-1043](../../front/src/app/pages/pvp/duel-page/duel-page.component.ts#L1041-L1043))
also bypasses the compact mode entirely.

Sites 7/8 are the worst offenders : the output is **mis-named**
`longPressInspect` but actually fires on every simple tap inside
`toggleCard`
([prompt-card-grid.ts:495-503](../../front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts#L495-L503),
[prompt-sort-card.ts:70-76](../../front/src/app/pages/pvp/duel-page/prompts/prompt-sort-card/prompt-sort-card.component.ts#L70-L76)).
Every prompt selection currently opens a full-screen inspector.

### Why it's wrong (UX framing)

The conflict has multiple framings in HCI literature :
- **Modeless inspection** — inspecting should never block the primary
  action flow. Today's inspector is incidental modal.
- **Primary vs secondary action** (NN/g / Material) — Skytrix multiplexes
  two distinct primaries (act, inspect) on the same gesture (tap). The
  resolution is to make them physically different gestures.
- **Gesture disambiguation** — production TCGs (Master Duel, MTGA,
  Hearthstone, Marvel Snap) all separate inspect and act gestures, never
  fire them simultaneously.

## Decision space — Direction B chosen

Three directions were considered :

| Direction | Pattern | Verdict |
|---|---|---|
| A — Marvel Snap | Persistent inspector pane + drag to act | Too disruptive ; requires drag paradigm |
| **B — Master Duel** | **Tap = act ; right-click + long-press = inspect** | **✅ Chosen** |
| C — Hybrid contextual | Tap inspects out-of-prompt, acts during prompt | Mental model too complex |
| D — Minimum viable | Trim double-emission only | Insufficient ; doesn't solve full conflict |

Axel validated **B** with the following sub-decisions (via AskUserQuestion 2026-06-05) :

- ✅ Idle prompt + actionable hand card → tap = open action menu
  (no inspect side-effect)
- ✅ Prompt active → tap = select card for prompt (no inspect side-effect)
- ✅ Inspect gesture (right-click / long-press) → **always full-screen**
  (`forceExpanded=true`)
- ✅ No onboarding hint — right-click / long-press is conventional TCG
  vocabulary
- ✅ Game log keeps **tap-to-inspect** (no conflict — read-only context)
- ✅ Effect panel on long-press (SELECT_CHAIN) stays ; inspect on touch
  during SELECT_CHAIN moves to **double-tap** (native `dblclick` event)
- ✅ `liveOverlay` (runtime type diff) always passed via `liveCard` when
  available — gesture-agnostic
- ✅ **B2 fallback** : if a tap is on a card with no available action in
  the current context, fall back to inspect rather than no-op. Mental
  model : "tap does the useful thing if there's only one ; explicit
  inspect gesture if there's an ambiguity"

## Final gesture contract

| Platform | Context | Gesture | Effect |
|---|---|---|---|
| Desktop | Any | Click | Action (or inspect if non-actionable — B2) |
| Desktop | Any | **Right-click** | Inspect full-screen |
| Touch | Out of SELECT_CHAIN | Tap | Action (or inspect if non-actionable — B2) |
| Touch | Out of SELECT_CHAIN | **Long-press 500ms** | Inspect full-screen |
| Touch | SELECT_CHAIN | Tap | Chain selection |
| Touch | SELECT_CHAIN | **Long-press 500ms** | Effect panel (existing behavior) |
| Touch | SELECT_CHAIN | **`dblclick` native** | Inspect full-screen |
| Game log | Any | Tap | Inspect (unchanged — no conflict) |

## Architectural decisions

1. **Output naming** : the `longPressInspect` output name is **kept
   everywhere** for backward compatibility with the F23 pattern in
   `pvp-prompt-dialog`
   ([pvp-prompt-dialog.component.ts:552-560](../../front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component.ts#L552-L560))
   which binds outputs by string lookup. Renaming would break the
   binding silently. Cosmetic vs runtime safety → runtime safety wins.

2. **B2 contract is 3 branches, not 2** : every site applying B2 must
   explicitly handle (a) actionable → action, (b) non-actionable but
   has cardCode → inspect, (c) explicit inspect gesture (right-click /
   long-press / double-tap) → inspect with `forceExpanded=true`. The
   intent must be commented in code, not just in the spec.

3. **Long-press extracted as Angular directive `[appLongPress]`**.
   Rule of Three is satisfied across 5 sites (hand-row, board-container,
   prompt-card-grid, prompt-sort-card, zone-browser-overlay). Directive
   pattern is idiomatic Angular, minimizes per-site plumbing, and
   handles trailing-click suppression internally.

4. **Double-tap on SELECT_CHAIN uses the native `dblclick` event** with
   dispatch on `promptData.type` inside the existing `dblclickCard`
   handler. No stateful timestamp counter — browser handles the timing
   window (~300ms).

5. **Compact mode in `pvp-card-inspector-wrapper`** : `shouldShowCompact()`
   returns `false` always. The DOM template is kept (cheap, no runtime
   cost, ready for a future "persistent inspector pane" feature if we
   ever revisit Direction A).

6. **Trailing-click suppression** lives in the `LongPressDirective`, not
   in each consumer component. The directive calls `event.preventDefault()`
   on the `pointerup` that fires after a long-press detection.

## Files touched

### New file

#### `front/src/app/pages/pvp/duel-page/long-press.directive.ts`

Angular directive `[appLongPress]`. Standalone, no DI beyond `ElementRef`
and `DestroyRef`.

API :
```ts
@Directive({ selector: '[appLongPress]', standalone: true })
export class LongPressDirective {
  readonly appLongPress = output<PointerEvent>();
  readonly appLongPressDuration = input(500);  // ms
  readonly appLongPressTolerance = input(12);   // px move
}
```

Behavior :
- Binds `pointerdown/move/up/cancel` on host element.
- Skips if `event.pointerType === 'mouse'` (mouse path uses hover / right-click).
- Timer armed on `pointerdown`, cleared on `move > tolerance` / `up` / `cancel`.
- On fire : emits `appLongPress(event)` + sets internal `_pressedFiring` flag.
- On `pointerup` post-firing : `event.preventDefault()` to suppress
  the synthetic trailing click.

Unit spec : `long-press.directive.spec.ts` pins 6 cases :
- Mouse pointer → no firing
- Touch + 500ms hold → fires, click suppressed
- Touch + 300ms release → cleared, click goes through
- Touch + 600ms but moved 20px → cleared, no firing
- Touch + `pointercancel` mid-press → cleared, no firing
- Touch + custom `appLongPressDuration` honored

### `front/src/app/pages/pvp/duel-page/pvp-hand-row/pvp-hand-row.component.ts`

Refactor `onCardTap` to apply B2 explicitly :

```ts
onCardTap(index: number, event: MouseEvent): void {
  this.selectedIndex.set(index);
  const card = this.cards()[index];
  const cardCode = card?.cardCode ?? 0;
  const isActionable = this.side() === 'player' && this.actionableCardIndices().has(index);

  if (isActionable) {
    this.handCardAction.emit({ index, element: event.currentTarget as HTMLElement });
  } else {
    // B2 fallback: a tap on a non-actionable hand card has no other intent
    // than inspecting it. Direction B (Master Duel) doesn't say "tap = act
    // ALWAYS" — it says "tap = primary affordance for context". Inspect is
    // the only useful intent on a non-actionable card.
    this.cardInspectRequest.emit({ cardCode });
  }
}

onCardContextMenu(index: number, event: MouseEvent): void {
  event.preventDefault();
  const cardCode = this.cards()[index]?.cardCode ?? 0;
  if (cardCode) this.cardInspectRequest.emit({ cardCode, forceExpanded: true });
}

onCardLongPress(index: number): void {
  const cardCode = this.cards()[index]?.cardCode ?? 0;
  if (cardCode) this.cardInspectRequest.emit({ cardCode, forceExpanded: true });
}
```

Output signature extends to `{ cardCode: number; forceExpanded?: boolean }`.

Template : add `(contextmenu)="onCardContextMenu(i, $event)"` and
`(appLongPress)="onCardLongPress(i)"` on the card button. Keep
`(click)="onCardTap(i, $event)"`.

### `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`

Refactor `onZoneCardClick` ([:491-504](../../front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts#L491-L504))
and `onEmzCardClick` ([:654-663](../../front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts#L654-L663))
with the B2 contract :

```ts
onZoneCardClick(event: MouseEvent, zone: ZoneRenderData): void {
  if (this.effectiveReadOnly()) {
    // Read-only (replay / spectator) — tap = inspect (no action ever possible).
    if (zone.card?.cardCode) {
      this.cardInspectRequest.emit({ cardCode: zone.card.cardCode, liveCard: zone.card });
    }
    return;
  }
  const actions = this.getActionsForZone(zone.zoneId);
  if (actions.length > 0) {
    this.menuRequest.emit({
      zoneId: zone.zoneId,
      element: event.currentTarget as HTMLElement,
      actions,
    });
  } else if (zone.card?.cardCode) {
    // B2 fallback
    this.cardInspectRequest.emit({ cardCode: zone.card.cardCode, liveCard: zone.card });
  }
}

onZoneCardContextMenu(event: MouseEvent, zone: ZoneRenderData): void {
  event.preventDefault();
  if (zone.card?.cardCode) {
    this.cardInspectRequest.emit({
      cardCode: zone.card.cardCode,
      liveCard: zone.card,
      forceExpanded: true,
    });
  }
}

onZoneCardLongPress(zone: ZoneRenderData): void {
  if (zone.card?.cardCode) {
    this.cardInspectRequest.emit({
      cardCode: zone.card.cardCode,
      liveCard: zone.card,
      forceExpanded: true,
    });
  }
}
```

Same pattern for `onEmzCardClick`. The existing
`onCardInspect(card)` method ([:665-669](../../front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts#L665-L669))
should be **audited** : if it's dead code post-refactor, delete it.

Template : add `(contextmenu)` + `(appLongPress)` on every clickable
zone card (field zones M1-M5, S1-S5, EMZ, GY, Banished, Extra, Field
spell, Deck).

### `front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts`

The most surgical refactor. Three changes :

#### Change A — strip inspect from `toggleCard`

```ts
toggleCard(index: number): void {
  if (this.answered) return;
  if (this.consumeLongPress()) return;
  // No more inspect emission — tap = select only (Direction B).
  if (this.readOnly) return;
  // ... rest unchanged (SELECT_SUM, SELECT_UNSELECT_CARD, plain toggle)
}
```

#### Change B — `dblclickCard` dispatches by prompt type

```ts
dblclickCard(index: number): void {
  if (this.answered || this.readOnly) return;
  const cardCode = this.cards[index]?.cardCode;

  // SELECT_CHAIN: double-tap = inspect (no select+confirm shortcut on chains).
  if (this.promptData?.type === 'SELECT_CHAIN') {
    if (cardCode) this.longPressInspect.emit({ cardCode });
    return;
  }

  // Other prompts: keep existing select+confirm shortcut.
  if (this.isMultiSelect || this.isToggleMode) return;
  if (this.promptData?.type === 'SELECT_SUM' || this.promptData?.type === 'SELECT_TRIBUTE') return;
  if (!this.isSelected(index)) this.toggleCard(index);
  if (this.isConfirmEnabled) this.confirm();
}
```

#### Change C — replace inline pointer handlers with directive + dispatch

The current
[onCardPointerDown/Move/Up](../../front/src/app/pages/pvp/duel-page/prompts/prompt-card-grid/prompt-card-grid.component.ts#L435-L470)
becomes a single `onCardLongPress` handler with dispatch on
`promptData?.type` :

```ts
onCardLongPress(originalIndex: number): void {
  this.longPressFired = true; // for consumeLongPress() trailing-click guard

  if (this.promptData?.type === 'SELECT_CHAIN' && this.effectTitle(this.cards[originalIndex])) {
    // Existing effect panel path (touch-only — desktop uses mouseenter/leave).
    this.onCardHover(originalIndex);
  } else {
    // Otherwise: inspect.
    const cardCode = this.cards[originalIndex]?.cardCode;
    if (cardCode) this.longPressInspect.emit({ cardCode });
  }
}

onCardContextMenu(index: number, event: MouseEvent): void {
  event.preventDefault();
  const cardCode = this.cards[index]?.cardCode;
  if (cardCode) this.longPressInspect.emit({ cardCode });
}
```

Delete the four inline `onCardPointer*` handlers. Keep `consumeLongPress()`
(still used by `toggleCard` for trailing-click safety).

Template : remove `(pointerdown)(pointermove)(pointerup)(pointercancel)`,
add `(appLongPress)="onCardLongPress(entry.originalIndex)"` and
`(contextmenu)="onCardContextMenu(entry.originalIndex, $event)"`.

CSS : add `touch-action: manipulation` on `.card-slot` so iOS Safari
doesn't intercept `dblclick`.

### `front/src/app/pages/pvp/duel-page/prompts/prompt-sort-card/prompt-sort-card.component.ts`

Simpler than prompt-card-grid (no effect panel, no `dblclickCard`
shortcut). Strip the inspect emission from `toggleCard`, add a
long-press + right-click path :

```ts
toggleCard(index: number): void {
  if (this.answered) return;
  // No more inspect emission — tap = sort logic only.
  if (this.readOnly) return;
  // ... rest unchanged
}

onCardLongPress(index: number): void {
  const cardCode = this.cards[index]?.cardCode;
  if (cardCode) this.longPressInspect.emit({ cardCode });
}

onCardContextMenu(index: number, event: MouseEvent): void {
  event.preventDefault();
  const cardCode = this.cards[index]?.cardCode;
  if (cardCode) this.longPressInspect.emit({ cardCode });
}
```

Template : `(appLongPress)`, `(contextmenu)`, `touch-action: manipulation`.

### `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.ts`

Routing logic moves to the parent (`duel-page.onZoneBrowserAction`).
The overlay emits a unified event ; the parent dispatches between
action menu and inspect.

Overlay :
```ts
onCardClick(card: CardOnField): void {
  if (!card.cardCode) return;
  this.cardClick.emit({ cardCode: card.cardCode, sequence: card.sequence, element: ... });
}

onCardLongPress(card: CardOnField): void {
  if (!card.cardCode) return;
  this.inspectCard.emit(card.cardCode);
}

onCardContextMenu(event: MouseEvent, card: CardOnField): void {
  event.preventDefault();
  if (!card.cardCode) return;
  this.inspectCard.emit(card.cardCode);
}
```

Parent (`duel-page.onZoneBrowserAction`) gets B2 dispatch :

```ts
onZoneBrowserAction(event: { cardCode: number; sequence: number; element: HTMLElement }): void {
  const prompt = this.actionablePrompt();
  const zb = this.zoneBrowserState();
  if (!prompt || !zb) {
    // Idle browsing → tap = inspect
    this.inspectCardByCode(event.cardCode);
    return;
  }
  const targetLocation = this.zoneIdToLocation(zb.zoneId);
  if (targetLocation === null) return;
  const actions = this.collectActionsForCardCode(event.cardCode, targetLocation, event.sequence, prompt);
  if (actions.length > 0) {
    this.closeZoneBrowser();
    this.openCardActionMenu(event.element, actions, prompt.type);
  } else {
    // Prompt active but card has no action → B2 inspect fallback
    this.inspectCardByCode(event.cardCode);
  }
}
```

### `front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.ts`

```ts
readonly shouldShowCompact = computed(() => {
  // Direction B (Master Duel-style, 2026-06-05) — inspector now only
  // opens via explicit gestures (right-click / long-press / double-tap).
  // Compact mode kept in template for potential future "persistent
  // inspector pane" (Direction A) — disabled here but cheap to keep.
  return false;
});
```

No template change. The `<div class="inspector-compact">` branch stays
in the DOM tree but is unreachable. The `initialForceExpanded` effect
keeps working but becomes a no-op (since `forceExpanded` is read inside
`shouldShowCompact` which returns false anyway).

### `front/src/app/pages/pvp/duel-page/duel-page.component.ts` + `replay-page.component.ts`

Extend `onCardInspectRequest` signature to accept `forceExpanded` :

```ts
async onCardInspectRequest(event: {
  cardCode: number;
  liveCard?: CardOnField;
  forceExpanded?: boolean;
}): Promise<void> {
  await this.cardInspection.inspectByCode(
    event.cardCode,
    event.forceExpanded ?? false,
    event.liveCard,
  );
}
```

`onLongPressInspect` keeps its `forceExpanded=true` hardcoded behavior
(used by `pvp-prompt-dialog` F23 subscribe path — don't break that).

In replay-page, all components are effectively read-only ; B2 always
falls back to inspect. No behavioral change visible to the user.

## Implementation order

1. **`LongPressDirective` + spec** (~1h)
   - Pin all 6 unit cases
   - Verify no DI service additions (only standard Angular tokens)
2. **`pvp-card-inspector-wrapper`** flip `shouldShowCompact` (~10min)
3. **`prompt-card-grid`** refactor B2 + dblclick + directive (~2h) — most complex
4. **`prompt-sort-card`** refactor B2 + directive (~30min)
5. **`pvp-hand-row`** refactor B2 + directive + contextmenu (~1h)
6. **`pvp-board-container`** refactor B2 + directive + contextmenu (~1h15)
7. **`pvp-zone-browser-overlay`** + parent dispatch (~45min)
8. **`duel-page` + `replay-page`** signature extension (~20min)
9. **Karma run** on 8 specs (~1h)

**Estimated total : ~8h focused.**

## Tests to pin (per component)

Generic checklist for each touched component :
- ✅ Tap on actionable → action emitted, **no** inspect emission
- ✅ Tap on non-actionable → inspect emitted (`forceExpanded=false`),
  **no** action emission
- ✅ Right-click → `event.preventDefault()` + inspect emitted
  (`forceExpanded=true`)
- ✅ Long-press touch → inspect emitted (`forceExpanded=true`),
  trailing click suppressed
- ✅ Long-press <500ms or moved >12px → no inspect, normal tap behavior
- ✅ Mouse pointer → no long-press triggered (skip via
  `pointerType !== 'mouse'`)

Component-specific :
- `prompt-card-grid` :
  - `dblclick` SELECT_CHAIN → inspect emitted, no select
  - Single tap SELECT_CHAIN → select, no inspect
  - Long-press SELECT_CHAIN with effect text → effect panel opens, no inspect
  - Long-press SELECT_CHAIN without effect text → inspect, no panel
  - Long-press other prompt types → inspect
- `pvp-board-container` :
  - Read-only mode → tap = inspect direct (replay path)
- `pvp-zone-browser-overlay` :
  - Idle (no prompt) → tap = inspect
  - Prompt active + actionable card → menu opens, browser closes
  - Prompt active + non-actionable card → inspect (B2 fallback)

## Residual risks

1. **iOS Safari `dblclick` reliability** — `touch-action: manipulation`
   added on `.card-slot` (prompt-card-grid + prompt-sort-card). Verify
   via Playwright iPhone device emulation.

2. **F23 binding regression** — the `pvp-prompt-dialog` subscribe path
   ([:553](../../front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component.ts#L553))
   binds by string lookup. The output **must** stay named
   `longPressInspect`. Adding a new output with a different name on a
   prompt sub-component is allowed only if it's not expected to flow
   through `pvp-prompt-dialog`.

3. **Dead code audit** — `pvp-board-container.onCardInspect(card)`
   ([:665](../../front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts#L665))
   may become unreferenced post-refactor. Grep before deletion.

4. **DI rule A6** — `LongPressDirective` injects only `ElementRef` and
   `DestroyRef` (standard Angular tokens, always provided). No
   component DI additions per CLAUDE.md "Component DI changes — run
   Karma before commit" rule. Karma run is still mandatory because we
   touch component logic.

5. **Inspector close behavior unchanged** — `escape`, `mousedown
   outside`, and the existing `dismissed` event flow stay intact. Only
   the **opening** gesture changes.

## Out of scope

- **Direction A (persistent inspector pane)** — would require drag
  paradigm. Memorized as
  [card-inspector-premium-spec](../../C:/Users/Axel/.claude/projects/c--Users-Axel-Desktop-code-skytrix/memory/project_card_inspector_premium_spec.md)
  for future visit.
- **Hover popovers on desktop** — distinct from inspect ; the
  game-log-panel hover already exists and isn't touched.
- **Game log inspect behavior** — `tap = inspect` is correct and stays.
- **Card inspector lightbox UX** — already covered by
  [card-inspector.component.ts](../../front/src/app/components/card-inspector/card-inspector.component.ts)
  (zoom, pan, image navigation). Not touched.

## References

- Sally's UX research synthesis (this conversation, 2026-06-05) — TCG
  gesture mapping table (Master Duel / MTGA / Hearthstone / Marvel Snap)
- CLAUDE.md → "Perspective Convention" (untouched — pure UI refactor)
- CLAUDE.md → "Component DI changes — run Karma before commit" (rule A6)
- `front/DESIGN-SYSTEM.md` — DS rules for buttons / DS components (no
  new DS additions needed for this refactor)

## Hand-off note for Amelia

When picking this up :

1. Create branch `feat/inspector-gesture-redesign` off current `master`.
2. Follow the 9-step implementation order above.
3. After each component refactor (steps 3-7), run that component's spec
   in isolation : `ng test --include="<spec-path>" --watch=false
   --browsers=ChromeHeadless`.
4. Step 9 runs the full PvP spec batch.
5. Manual smoke testing (the `verify` skill) on : a live PvP session, a
   SOLO multiplex session, a replay seek mid-chain. Capture inspector
   open / close / dismiss across each gesture (mouse + touch via
   DevTools emulation).
6. Don't merge until 1187+ specs are green and the 3 manual scenarios
   pass.
