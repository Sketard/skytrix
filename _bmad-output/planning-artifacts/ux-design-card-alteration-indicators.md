# UX Design Specification — Card Alteration Indicators

**Author:** Axel
**Date:** 2026-03-10
**Scope:** PvP duel board — persistent visual indicators for card stat/state modifications
**Parent spec:** ux-design-specification-pvp.md (PvP-C polish layer)

---

## 1. Problem Statement

During a duel, card stats and properties are frequently altered by effects — ATK boosts, effect negation, level changes, attribute swaps. Currently, the board shows zero visual feedback for any of these alterations. The player must mentally track which cards are modified and by how much, relying entirely on memory or clicking each card to inspect it.

This creates cognitive overload, especially in complex board states with multiple continuous effects active. Players make suboptimal plays because they forget a monster's ATK was halved or its effect was negated.

**Scope:** Visual indicators for all card alterations detectable via OCGCore query flags (`ATTACK`, `DEFENSE`, `BASE_ATTACK`, `BASE_DEFENSE`, `LEVEL`, `RANK`, `ATTRIBUTE`, `RACE`, `STATUS`, `LSCALE`, `RSCALE`, `EQUIP_CARD`). Indicators are persistent (visible as long as the alteration is active) and update with each `BOARD_STATE` snapshot.

---

## 1b. Design Tokens

All alteration indicator sizing uses `--pvp-*` CSS custom properties defined in `_tokens.scss` (within the `// === PvP tokens ===` section), following the parent spec convention of `clamp()` with `dvh` units.

| Token | Value | Purpose | Tunability |
|-------|-------|---------|------------|
| `--pvp-alteration-badge-font-size` | `clamp(0.4rem, 1.2dvh, 0.65rem)` | Font size for stat/level/counter badges | Tunable |
| `--pvp-alteration-badge-icon-size` | `clamp(0.4rem, 1.2dvh, 0.65rem)` | Level/rank SVG icon size (matches font size) | Tunable |
| `--pvp-alteration-boost` | `#4caf50` | Green — boost color (ATK/DEF/Level/Rank/Scale) | Locked |
| `--pvp-alteration-debuff` | `#f44336` | Red — debuff color (ATK/DEF/Level/Rank/Scale) | Locked |
| `--pvp-alteration-badge-bg` | `rgba(0, 0, 0, 0.8)` | Badge background | Tunable |
| `--pvp-alteration-negated-opacity` | `0.55` | Negated icon opacity | Tunable |
| `--pvp-alteration-equip-lift` | `-4px` | Equip hover float translateY | Tunable |

> **Sizing strategy:**
> - **Font sizes** use `clamp(min, ideal-dvh, max)` tokens — consistent with parent spec rule "Use `clamp()` for all sizing" and ensures minimum readability on small viewports.
> - **Icon/element dimensions on cards** use `%` relative to `.zone-card` container (e.g., `width: 22%`, `width: 65%`). Cards are already sized by the viewport via `clamp()` + `aspect-ratio: 59/86`, so `%` naturally cascades the responsiveness. Using absolute `dvh` for sub-card elements would break proportionality when card size varies.
> - **Positional offsets** (`top`, `bottom`, `left`, `right`, `padding`) use `%` as they're relative to the card container.
> - No `--card-w` variable — card width is derived from height via `aspect-ratio: 59/86`.

---

## 2. Design Decisions

### 2.1 Corner System — Spatial Layout

Each card corner has a fixed semantic role. Players learn once where to look for each type of information:

```
┌─────────────────┐
│ [TL]       [TR] │   TL = Level/Rank change
│                 │   TR = Attribute/Type change
│    card art     │
│                 │
│ [BL]       [BR] │   BL = ATK/DEF stats
└─────────────────┘   BR = XYZ overlay (existing) / Counters

        [CENTER]      Center = Effect negated (prohibition circle)
```

### 2.2 ATK/DEF Modification — Bottom-Left Badge

**Trigger:** `currentAtk !== baseAtk` OR `currentDef !== baseDef`

**Rendering:**
- Compact micro-badge displaying modified stat values
- **Green text** when current value > base (boost)
- **Red text** when current value < base (debuff)
- When both ATK and DEF are modified, show both with respective colors: `3k / 0`
- Values ≥ 10000 truncated: `10000` → `10k`, `12500` → `12.5k`. Values < 10000 shown as-is.
- Badge hidden when no stat differs from base (no badge = no alteration)

**Examples:**
- Monster ATK 2500→3000: green `3000`
- Monster ATK 2500→0, DEF unchanged: red `0`
- Both modified (ATK up, DEF down): `3000 / 0` (green / red)
- `?` ATK/DEF (e.g., Tragoedia): badge shows current resolved value

**Truncation:** Inline method in component — `formatStat(value: number): string` returns `value >= 10000 ? (value / 1000) + 'k' : String(value)`.

**Template:**
```html
@if (card.currentAtk !== card.baseAtk || card.currentDef !== card.baseDef) {
  <div class="stat-badge">
    @if (card.currentAtk !== card.baseAtk) {
      <span [class.stat-badge__value--boost]="card.currentAtk > card.baseAtk"
            [class.stat-badge__value--debuff]="card.currentAtk < card.baseAtk">
        {{ formatStat(card.currentAtk) }}
      </span>
    }
    @if (card.currentAtk !== card.baseAtk && card.currentDef !== card.baseDef) {
      <span class="stat-badge__separator">/</span>
    }
    @if (card.currentDef !== card.baseDef) {
      <span [class.stat-badge__value--boost]="card.currentDef > card.baseDef"
            [class.stat-badge__value--debuff]="card.currentDef < card.baseDef">
        {{ formatStat(card.currentDef) }}
      </span>
    }
  </div>
}
```

**Style:**
```scss
.stat-badge {
  position: absolute;
  bottom: 3%;
  left: 3%;
  background: var(--pvp-alteration-badge-bg);
  border-radius: var(--pvp-radius-sm);
  font-size: var(--pvp-alteration-badge-font-size);
  font-weight: 700;
  padding: 3% 5%;
  line-height: 1;
  pointer-events: none;
  z-index: 2;
  display: flex;
  gap: 2px;
  white-space: nowrap;

  &__value--boost { color: var(--pvp-alteration-boost); }
  &__value--debuff { color: var(--pvp-alteration-debuff); }
}
```

### 2.3 Effect Negated — Prohibition Circle Overlay

**Trigger:** `STATUS` flag indicates effect negated

**Rendering:**
- Prohibition circle (🚫 shape) centered on the card at slight opacity
- SVG asset: `assets/images/icons/negated.svg` — circle + diagonal bar, grey stroke
- Sized at 65% of card dimensions, centered via `top:50%; left:50%; translate(-50%,-50%)`
- Grey conveys "disabled/inert" without conflicting with red ATK debuff badges
- `opacity: 0.55` — visible but card art remains readable

**SVG Asset** (`assets/images/icons/negated.svg`):
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <circle cx="50" cy="50" r="42" stroke="#b4b4b4" stroke-width="6"/>
  <line x1="20" y1="80" x2="80" y2="20" stroke="#b4b4b4" stroke-width="6" stroke-linecap="round"/>
</svg>
```
> Note: SVG strokes are solid `#b4b4b4`; transparency is controlled via CSS `opacity: 0.55` on the `<img>` element.

**Style:**
```scss
.negated-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 65%;
  height: 65%;
  pointer-events: none;
  z-index: 3;
  opacity: var(--pvp-alteration-negated-opacity);
}
```

**Template:**
```html
@if (card.isEffectNegated) {
  <img src="assets/images/icons/negated.svg" class="negated-icon" alt="">
}
```

### 2.4 Level/Rank Modification — Top-Left Badge

**Trigger:** `currentLevel !== baseLevel` OR `currentRank !== baseRank`

**Rendering:**
- Small badge with SVG icon + number: level-star icon for levels, rank-star icon for ranks
- Icon visually distinguishes level (orange circle) from rank (dark circle), both with yellow star
- **Green** (`--pvp-alteration-boost`) text when current > base (boost)
- **Red** (`--pvp-alteration-debuff`) text when current < base (debuff)
- Consistent with ATK/DEF color coding — green = boost, red = debuff across all indicators
- Only displayed when value differs from base

**SVG Assets:**
- `assets/images/icons/level-star.svg` — yellow star on orange radial gradient circle
- `assets/images/icons/rank-star.svg` — yellow star on dark/black radial gradient circle

**Template:**
```html
@if (card.currentLevel !== card.baseLevel) {
  <div class="level-badge" [class.level-badge--boost]="card.currentLevel > card.baseLevel"
       [class.level-badge--debuff]="card.currentLevel < card.baseLevel">
    <img src="assets/images/icons/level-star.svg" class="level-badge__icon" alt="">
    {{ card.currentLevel }}
  </div>
}
@if (card.currentRank !== card.baseRank) {
  <div class="level-badge" [class.level-badge--boost]="card.currentRank > card.baseRank"
       [class.level-badge--debuff]="card.currentRank < card.baseRank">
    <img src="assets/images/icons/rank-star.svg" class="level-badge__icon" alt="">
    {{ card.currentRank }}
  </div>
}
```

**Style:**
```scss
.level-badge {
  position: absolute;
  top: 3%;
  left: 3%;
  background: var(--pvp-alteration-badge-bg);
  border-radius: var(--pvp-radius-sm);
  font-size: var(--pvp-alteration-badge-font-size);
  font-weight: 700;
  padding: 3% 5%;
  line-height: 1;
  pointer-events: none;
  z-index: 2;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 2px;

  &__icon {
    width: var(--pvp-alteration-badge-icon-size);
    height: var(--pvp-alteration-badge-icon-size);
    flex-shrink: 0;
  }

  &--boost { color: var(--pvp-alteration-boost); }
  &--debuff { color: var(--pvp-alteration-debuff); }
}
```

### 2.5 Attribute / Type Change — Mini Icon (Top-Right)

**Trigger:** `currentAttribute !== baseAttribute` OR `currentRace !== baseRace`

**Rendering:**
- Top-right: mini icon of the **current** attribute using existing project SVGs: `assets/images/attributes/{ATTR}.svg` (DARK, LIGHT, FIRE, WATER, WIND, EARTH, DIVINE)
- If type (race) also changed: second mini icon stacked below, using existing project webp: `assets/images/races/{RACE}.webp` (DRAGON, WARRIOR, SPELLCASTER, etc.)
- Icons only displayed when value differs from base
- Circular crop with subtle drop shadow to separate from card art

**Template:**
```html
@if (card.currentAttribute !== card.baseAttribute) {
  <img [src]="'assets/images/attributes/' + getAttributeName(card.currentAttribute) + '.svg'"
       class="alteration-icon" alt="">
}
@if (card.currentRace !== card.baseRace) {
  <img [src]="'assets/images/races/' + getRaceName(card.currentRace) + '.webp'"
       class="alteration-icon alteration-icon--race" alt="">
}
```

**Style:**
```scss
.alteration-icon {
  position: absolute;
  top: 3%;
  right: 3%;
  width: 22%;
  aspect-ratio: 1;
  border-radius: 50%;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.7);
  pointer-events: none;
  object-fit: contain;
  z-index: 2;
}

.alteration-icon--race {
  top: calc(3% + 22% + 3%);
}
```

### 2.6 Counters — Bottom-Right Badge (Enriched)

**Trigger:** `counters` record is non-empty (existing field on `CardOnField`)

**Rendering:**
- Same position as existing XYZ indicator (bottom-right)
- When both XYZ overlay AND counters exist: stack vertically (XYZ badge at bottom, counter badge above)
- Circular badge, **purple** (`rgba(150, 50, 200, 0.85)`), displaying total counter count
- Click on card → inspect panel shows counter detail (`Spell Counter: 3, Predator Counter: 1`)

**Template:**
```html
@if (totalCounters(card) > 0) {
  <div class="counter-indicator" [class.counter-indicator--with-xyz]="card.overlayMaterials.length > 0">
    {{ totalCounters(card) }}
  </div>
}
```

> `totalCounters(card)`: sums all values in `card.counters` record.

**Style:**
```scss
.counter-indicator {
  position: absolute;
  bottom: 3%;
  right: 3%;
  width: 22%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: rgba(150, 50, 200, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--pvp-alteration-badge-font-size);
  font-weight: 700;
  color: var(--text-primary);
  pointer-events: none;
  z-index: 2;
}

// When both XYZ and counters are present, shift counter badge up
.counter-indicator--with-xyz {
  bottom: calc(3% + 22% + 3%);
}
```

### 2.7 Pendulum Scale Change — Scale Value Color

**Trigger:** `currentLScale !== baseLScale` OR `currentRScale !== baseRScale`

**Rendering:**
- Pendulum zones (S1/S5) display scale values — color the number **green** (`--pvp-alteration-boost`) or **red** (`--pvp-alteration-debuff`) when modified from base
- No additional badge needed; the color change on the existing scale display is sufficient
- Consistent with all other indicator color coding

**Style:**
```scss
.pendulum-scale--boost { color: var(--pvp-alteration-boost); }
.pendulum-scale--debuff { color: var(--pvp-alteration-debuff); }
```

**Template:**
```html
<span [class.pendulum-scale--boost]="card.currentLScale > card.baseLScale"
      [class.pendulum-scale--debuff]="card.currentLScale < card.baseLScale">
  {{ card.currentLScale }}
</span>
```

### 2.8 Equipped Card — Bidirectional Hover Float

**Trigger:** `equipTarget` is non-null (equip spell/trap → monster link known via `EQUIP_CARD` query flag)

**Behavior:**

| User Action | Visual Effect |
|-------------|---------------|
| **Hover on equip card** | Equipped monster **floats up** slightly (raised elevation effect) |
| **Hover on equipped monster** | All its equip cards **float up** slightly for the duration of the hover |

**Rendering:**
- Linked cards lift via `translateY(var(--pvp-alteration-equip-lift))` + enhanced `box-shadow` to simulate elevation
- Transition in/out: `150ms ease-out` for smooth lift/settle
- No lines or SVG overlays between cards
- The float effect is subtle enough to not disturb board layout (translate only, no scale)

**Style:**
```scss
.zone-card--equip-highlight {
  transform: translateY(var(--pvp-alteration-equip-lift));
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
  transition: transform 150ms ease-out, box-shadow 150ms ease-out;
}

// DEF position cards float sideways instead (already rotated 90deg)
.zone-card.def-position.zone-card--equip-highlight {
  transform: rotate(90deg) translateY(var(--pvp-alteration-equip-lift));
}
```

**Implementation:**
- `CardOnField.equipTarget` provides equip → monster link
- Component builds a `Map<zoneKey, zoneKey[]>` at each `BOARD_STATE` for reverse lookups (monster → its equip cards)
- `mouseenter`/`mouseleave` on `.zone-card` elements toggle `zone-card--equip-highlight` class on linked zones

---

## 3. Indicator Priority (z-ordering)

When multiple indicators coexist on a small card:

| Priority | Indicator | Rationale |
|----------|-----------|-----------|
| 1 (highest) | Effect Negated circle | Fundamentally changes what the card does |
| 2 | ATK/DEF badge | Most gameplay-critical stat info |
| 3 | Level/Rank badge | Impacts Synchro/XYZ plays |
| 4 | XYZ overlay count | Already existing |
| 5 | Counter badge | Situational |
| 6 | Attribute/Type icons | Rarely altered |
| 7 | Equip hover float | Transient (hover-only) |

All permanent indicators use `z-index: 2` on the `.zone-card` stacking context. The negated circle uses an `<img>` element with `z-index: 3`, ensuring it overlays all corner badges.

---

## 4. Opponent Field Handling

Badges use `position: absolute` relative to `.zone-card`, NOT to `.card-art`. Since the opponent field applies `transform: rotate(180deg)` only on `.card-art`, badges remain upright and readable from the player's perspective.

The corner positions (top-left, top-right, bottom-left, bottom-right) stay consistent relative to the card container — a level badge always appears at the visual top-left regardless of which player owns the card.

---

## 5. Accessibility

### prefers-reduced-motion: reduce
- All indicators are static (no pulsing animations)
- Effect negated circle renders without animation
- Equip hover: float applied instantly (no transition), `transform` snaps without easing

### prefers-contrast: more
- `--pvp-alteration-badge-bg` overridden to `rgba(0, 0, 0, 0.95)`
- `--pvp-alteration-negated-opacity` overridden to `0.75`
- 1px solid border added around stat/level badges for contrast

### forced-colors: active
- Badges and icons: `forced-color-adjust: none` to preserve semantic colors
- Negated circle: uses `CanvasText` and `Mark` system colors as fallback

### Screen Reader
- `aria-label` on `.zone-card` enriched with alteration context:
  - Base: `"Blue-Eyes White Dragon"`
  - With ATK boost: `"Blue-Eyes White Dragon, ATK 3500 boosted from 3000"`
  - With negation: `"Blue-Eyes White Dragon, effect negated"`
  - With attribute change: `"Blue-Eyes White Dragon, attribute changed to FIRE"`
- No `role="status"` — alterations are part of board state, not live announcements. Existing orchestrator announcements cover game events.

---

## 6. Data Requirements

### 6.1 CardOnField Extension (ws-protocol.ts + duel-ws.types.ts)

```typescript
interface CardOnField {
  // Existing fields
  cardCode: number | null;
  name: string | null;
  position: Position;
  overlayMaterials: number[];
  counters: Record<string, number>;

  // New — only populated for face-up monster/spell/trap cards
  currentAtk?: number;
  currentDef?: number;
  baseAtk?: number;
  baseDef?: number;
  currentLevel?: number;
  baseLevel?: number;
  currentRank?: number;
  baseRank?: number;
  currentAttribute?: number;
  baseAttribute?: number;
  currentRace?: number;
  baseRace?: number;
  currentLScale?: number;
  currentRScale?: number;
  baseLScale?: number;
  baseRScale?: number;
  isEffectNegated?: boolean;
  equipTarget?: { controller: 0 | 1; location: number; sequence: number } | null;
}
```

> **Base values source:** `baseAtk`/`baseDef` come from `OcgQueryFlags.BASE_ATTACK`/`BASE_DEFENSE`. For `baseLevel`, `baseRank`, `baseAttribute`, `baseRace`, `baseLScale`, `baseRScale`, the base values come from the card database (looked up by `cardCode`), since OCGCore does not expose separate "base" query flags for these fields — only the current (possibly modified) values.

### 6.2 OCGCore Query Flags Required (duel-worker.ts)

New flags to add to `queryCard()` (individual queries due to WASM combining bug):

| Flag | Constant | Field(s) Populated |
|------|----------|-------------------|
| `OcgQueryFlags.ATTACK` | 256 | `currentAtk` |
| `OcgQueryFlags.DEFENSE` | 512 | `currentDef` |
| `OcgQueryFlags.BASE_ATTACK` | 1024 | `baseAtk` |
| `OcgQueryFlags.BASE_DEFENSE` | 2048 | `baseDef` |
| `OcgQueryFlags.LEVEL` | 16 | `currentLevel` |
| `OcgQueryFlags.RANK` | 32 | `currentRank` |
| `OcgQueryFlags.ATTRIBUTE` | 64 | `currentAttribute` |
| `OcgQueryFlags.RACE` | 128 | `currentRace` |
| `OcgQueryFlags.STATUS` | 524288 | `isEffectNegated` (extract from status bitmask) |
| `OcgQueryFlags.EQUIP_CARD` | 16384 | `equipTarget` |
| `OcgQueryFlags.LSCALE` | 2097152 | `currentLScale` |
| `OcgQueryFlags.RSCALE` | 4194304 | `currentRScale` |

### 6.3 Message Filter Impact (message-filter.ts)

Face-down card sanitization must also clear new fields:
```typescript
function sanitizeFaceDownCard(card: CardOnField): CardOnField {
  if (isFaceDown) {
    return {
      ...card,
      cardCode: null, name: null,
      currentAtk: undefined, currentDef: undefined,
      baseAtk: undefined, baseDef: undefined,
      currentLevel: undefined, baseLevel: undefined,
      currentRank: undefined, baseRank: undefined,
      currentAttribute: undefined, baseAttribute: undefined,
      currentRace: undefined, baseRace: undefined,
      currentLScale: undefined, currentRScale: undefined,
      baseLScale: undefined, baseRScale: undefined,
      isEffectNegated: undefined, equipTarget: undefined,
    };
  }
  return card;
}
```

### 6.4 Frontend Component Changes (pvp-board-container)

- **Stat badge component or template fragment**: Renders ATK/DEF badge when `currentAtk !== baseAtk || currentDef !== baseDef`
- **Negated class**: `[class.zone-card--negated]="card.isEffectNegated"` on `.zone-card`
- **Level/Rank badge**: Conditional template when `currentLevel !== baseLevel` or `currentRank !== baseRank`, with SVG icon (`level-star.svg` or `rank-star.svg`) + number
- **Attribute/Type icons**: `<img>` elements with `[src]="'assets/images/attributes/' + getAttributeName(card.currentAttribute) + '.svg'"` when attribute differs from base
- **Equip hover map**: `Signal<Map<string, string[]>>` rebuilt on each `BOARD_STATE`, mapping monster zone keys → equip card zone keys and vice versa
- **Mouse events**: `mouseenter`/`mouseleave` handlers on `.zone-card` to toggle `zone-card--equip-highlight` class on linked zones

---

## 7. Edge Cases & Mitigations

| Edge Case | Mitigation |
|-----------|------------|
| **Card with `?` ATK/DEF** (e.g., Tragoedia) | Base is `null`/`-1`; badge always shows current resolved value if available |
| **ATK = 0 after negation** | Badge shows red `0` — distinct from "no badge" (unmodified) |
| **Multiple equip cards on one monster** | Hover on monster highlights all equip cards simultaneously |
| **Equip card targeting opponent's monster** | `equipTarget` references opponent's zone; hover highlight crosses field boundary |
| **Face-down card with alterations** | Sanitized by message filter — no indicators shown (anti-cheat) |
| **Negated + stat change** | Both indicators display: prohibition circle overlays the card, stat badge sits in corner beneath it |
| **Level AND rank both non-zero** | XYZ monsters use rank; show rank badge only. Non-XYZ use level badge only. |
| **Attribute icon on opponent's rotated card** | Icon positioned on `.zone-card` (not `.card-art`), remains upright |
| **Counter badge + XYZ badge coexistence** | Counter badge shifts up via `--with-xyz` modifier class |
| **Pendulum card with scale change in S1/S5** | Scale value text colored green/red; no additional badge |

---

## 8. Asset Reference

| Asset | Path | Format | Used For |
|-------|------|--------|----------|
| Negated icon | `assets/images/icons/negated.svg` | SVG | Effect negated overlay (center) |
| Level star icon | `assets/images/icons/level-star.svg` | SVG | Level change indicator (top-left badge) |
| Rank star icon | `assets/images/icons/rank-star.svg` | SVG | Rank change indicator (top-left badge) |
| Attribute icons | `assets/images/attributes/{ATTR}.svg` | SVG | Attribute change indicator (top-right) |
| Race icons | `assets/images/races/{RACE}.webp` | WebP | Type change indicator (top-right, below attribute) |
| Level star (existing) | `assets/images/level.webp` | WebP | Used elsewhere in app (card detail view) |

Attribute values: `DARK`, `LIGHT`, `FIRE`, `WATER`, `WIND`, `EARTH`, `DIVINE`

Race values: `AQUA`, `BEAST`, `BEAST_WARRIOR`, `CREATOR_GOD`, `CYBERSE`, `DINOSAUR`, `DIVINE_BEAST`, `DRAGON`, `FAIRY`, `FIEND`, `FISH`, `INSECT`, `MACHINE`, `PLANT`, `PSYCHIC`, `PYRO`, `REPTILE`, `ROCK`, `SEA_SERPENT`, `SPELLCASTER`, `THUNDER`, `WARRIOR`, `WINGED_BEAST`, `WYRM`, `ZOMBIE`
