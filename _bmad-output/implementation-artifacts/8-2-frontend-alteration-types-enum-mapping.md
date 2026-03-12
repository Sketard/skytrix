# Story 8.2: Frontend — Alteration Types & Enum Mapping

Status: done

## Story

As a developer,
I want the frontend TypeScript types to mirror the extended `CardOnField` interface and provide utility functions for attribute/race enum-to-filename mapping,
So that the UI components can consume alteration data and resolve asset paths.

## Acceptance Criteria

### AC1: CardOnField Type Extension (duel-ws.types.ts)

**Given** the frontend `CardOnField` type in `duel-ws.types.ts`
**When** new alteration fields are added to match the server interface
**Then** all fields from Story 8.1 AC2 are present with identical types:
- `currentAtk?: number`, `currentDef?: number`, `baseAtk?: number`, `baseDef?: number`
- `currentLevel?: number`, `baseLevel?: number`, `currentRank?: number`, `baseRank?: number`
- `currentAttribute?: number`, `baseAttribute?: number`, `currentRace?: number`, `baseRace?: number`
- `currentLScale?: number`, `currentRScale?: number`, `baseLScale?: number`, `baseRScale?: number`
- `isEffectNegated?: boolean`
- `equipTarget?: { controller: 0 | 1; location: number; sequence: number } | null`

### AC2: Attribute Enum → Filename Mapping

**Given** OCGCore uses numeric attribute IDs (bitmask values: EARTH=1, WATER=2, FIRE=4, WIND=8, LIGHT=16, DARK=32, DIVINE=64)
**When** a utility function `getAttributeName(attrId: number): string | null` is called
**Then** it returns the filename-compatible string matching existing SVG assets:
- 1 → `'EARTH'`, 2 → `'WATER'`, 4 → `'FIRE'`, 8 → `'WIND'`, 16 → `'LIGHT'`, 32 → `'DARK'`, 64 → `'DIVINE'`
**And** unknown values return `null` (no icon displayed)

### AC3: Race Enum → Filename Mapping

**Given** OCGCore uses numeric race IDs (bitmask values)
**When** a utility function `getRaceName(raceId: number): string | null` is called
**Then** it returns the filename-compatible string matching existing WebP assets in `assets/images/races/`:
- Maps all 25 race bitmask values to their filename equivalents:
  - 1→`'WARRIOR'`, 2→`'SPELLCASTER'`, 4→`'FAIRY'`, 8→`'FIEND'`, 16→`'ZOMBIE'`, 32→`'MACHINE'`
  - 64→`'AQUA'`, 128→`'PYRO'`, 256→`'ROCK'`, 512→`'WINGED_BEAST'`, 1024→`'PLANT'`, 2048→`'INSECT'`
  - 4096→`'THUNDER'`, 8192→`'DRAGON'`, 16384→`'BEAST'`, 32768→`'BEAST_WARRIOR'`, 65536→`'DINOSAUR'`
  - 131072→`'FISH'`, 262144→`'SEA_SERPENT'`, 524288→`'REPTILE'`, 1048576→`'PSYCHIC'`
  - 2097152→`'DIVINE_BEAST'`, 4194304→`'CREATOR_GOD'`, 8388608→`'WYRM'`, 16777216→`'CYBERSE'`
**And** unknown values return `null`

### AC4: Stat Formatting Utility

**Given** a stat value (ATK or DEF)
**When** `formatStat(value: number): string` is called
**Then** values ≥ 10000 are truncated: `10000` → `'10k'`, `12500` → `'12.5k'`
**And** values < 10000 are returned as-is: `3000` → `'3000'`, `0` → `'0'`

### AC5: Counter Total Utility

**Given** a card with a `counters` record (e.g., `{ 'Spell Counter': 3, 'Predator Counter': 1 }`)
**When** `totalCounters(counters: Record<string, number>): number` is called
**Then** it returns the sum of all counter values (e.g., `4`)

### AC6: Design Tokens in _tokens.scss

**Given** the `_tokens.scss` file with the `// === PvP tokens ===` section
**When** alteration indicator tokens are added
**Then** the following tokens are defined:
- `--pvp-alteration-badge-font-size: clamp(0.4rem, 1.2dvh, 0.65rem)`
- `--pvp-alteration-badge-icon-size: clamp(0.4rem, 1.2dvh, 0.65rem)`
- `--pvp-alteration-boost: #4caf50`
- `--pvp-alteration-debuff: #f44336`
- `--pvp-alteration-badge-bg: rgba(0, 0, 0, 0.8)`
- `--pvp-alteration-negated-opacity: 0.55`
- `--pvp-alteration-equip-lift: -4px`

## Tasks / Subtasks

- [x] Task 1: Extend CardOnField Type (AC1)
  - [x] 1.1 Add all new optional fields to `CardOnField` in `duel-ws.types.ts`
  - [x] 1.2 Verify TypeScript compilation passes

- [x] Task 2: Enum Mapping Utilities (AC2, AC3, AC4, AC5)
  - [x] 2.1 Create attribute name map (numeric ID → filename string) — verify against existing SVG filenames in `assets/images/attributes/`
  - [x] 2.2 Create race name map (numeric ID → filename string) — verify against existing WebP filenames in `assets/images/races/`
  - [x] 2.3 Implement `formatStat()` — truncation for ≥ 10000
  - [x] 2.4 Implement `totalCounters()` — sum all values in counters record
  - [x] 2.5 Place utilities in an appropriate file (e.g., `pvp-alteration.utils.ts` alongside existing `pvp-zone.utils.ts`)

- [x] Task 3: Design Tokens (AC6)
  - [x] 3.1 Add `--pvp-alteration-*` tokens to `_tokens.scss` in the PvP tokens section
  - [x] 3.2 Verify tokens are available in component styles

- [x] Task 4: Manual Verification (all ACs)
  - [x] 4.1 Verify build passes with zero errors
  - [x] 4.2 Verify attribute map covers all 7 values and matches SVG filenames
  - [x] 4.3 Verify race map covers all 25 values and matches WebP filenames
  - [x] 4.4 Verify `formatStat(10000)` → `'10k'`, `formatStat(3000)` → `'3000'`

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No RxJS for state.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI.
- **TypeScript strict mode**: `strict: true`. All types explicit.
- **No new dependencies**: Pure TypeScript utilities.

### Critical: Attribute/Race Numeric IDs

OCGCore uses bitmask values for attributes and races. The exact numeric values must be verified from `@n1xx1/ocgcore-wasm` types or from the existing codebase (the solo simulator may already have these mappings).

### Critical: Race Filename Verification

The `assets/images/races/` directory contains WebP files. The filenames must be verified — they may use `UPPER_CASE`, `PascalCase`, or other conventions. The mapping function must produce filenames that exactly match the existing files.

### Note: totalCounters Signature vs UX Spec Pseudo-Code

The UX spec template calls `totalCounters(card)` (passing the whole card object). This is pseudo-code — the actual utility accepts the counters record directly. The component template should call `totalCounters(card.counters)`.

### Note: formatStat Placement

The UX spec §2.2 says "Inline method in component", but this story creates `formatStat()` in `pvp-alteration.utils.ts`. The UX spec "inline" wording was a suggestion — placing it in the shared utility file is the correct decision for reusability.

### Note: Spell/Trap Attribute and Race Values

Attribute and race mappings only apply to monster cards. Spell/trap cards have attribute=0 and race=0 in OCGCore. The mapping functions should return `null` for 0 values (no icon displayed).

### Note: CardOnField Manual Sync Obligation

The `CardOnField` type in `duel-ws.types.ts` must be manually kept in sync with `ws-protocol.ts` (Story 8.1). There is no code generation — sync is a manual obligation.

### Source Tree — Files to Create/Modify

**CREATE (1 file):**
- `front/src/app/pages/pvp/pvp-alteration.utils.ts` — Attribute/race mapping, formatStat, totalCounters

**MODIFY (2 files):**
- `front/src/app/pages/pvp/duel-page/duel-ws.types.ts` — Extend CardOnField type
- `front/src/app/styles/_tokens.scss` — Add `--pvp-alteration-*` tokens

**DO NOT TOUCH:**
- `duel-server/` — Server changes are Story 8.1
- Component templates/styles — UI rendering is Story 8.3
- `animation-orchestrator.service.ts` — No orchestrator changes

### References

- [Source: _bmad-output/planning-artifacts/ux-design-card-alteration-indicators.md — §1b Design Tokens, §6.1 CardOnField, §8 Asset Reference]
- [Source: front/src/app/pages/pvp/duel-page/duel-ws.types.ts — Existing CardOnField type]
- [Source: front/src/app/styles/_tokens.scss — Existing PvP tokens section]
- [Source: front/src/assets/images/attributes/ — SVG attribute icons]
- [Source: front/src/assets/images/races/ — WebP race icons]
- [Source: front/src/app/pages/pvp/pvp-zone.utils.ts — Existing utility file pattern]

## Dev Agent Record

### Implementation Plan

- Task 1 (AC1): CardOnField already had all alteration fields from Story 8.1 sync. Verified types match AC1 spec exactly. No changes needed.
- Task 2 (AC2-5): Created `pvp-alteration.utils.ts` with `getAttributeName()`, `getRaceName()`, `formatStat()`, `totalCounters()`. All maps verified against actual asset filenames.
- Task 3 (AC6): Added 7 `--pvp-alteration-*` design tokens to `_tokens.scss` PvP section.
- Task 4: TypeScript compilation passes (zero new errors). All mapping outputs verified programmatically.

### Completion Notes

All 4 tasks completed. CardOnField type was already synced from Story 8.1. Utility functions created following existing `pvp-zone.utils.ts` pattern. Design tokens placed in PvP section of `_tokens.scss`. All acceptance criteria satisfied.

## File List

- `front/src/app/pages/pvp/pvp-alteration.utils.ts` — CREATED: attribute/race enum mapping, formatStat, totalCounters
- `front/src/app/styles/_tokens.scss` — MODIFIED: added --pvp-alteration-* design tokens + prefers-contrast overrides
- `front/src/app/pages/pvp/duel-ws.types.ts` — UNCHANGED (already had all AC1 fields from Story 8.1)

## Change Log

- 2026-03-11: Story 8.2 implemented — created pvp-alteration.utils.ts with 4 utility functions, added 7 design tokens to _tokens.scss
- 2026-03-11: Code review fixes — removed dead ternary in formatStat, added null guard + reduce in totalCounters, added prefers-contrast:more token overrides, added JSDoc for formatStat edge case
