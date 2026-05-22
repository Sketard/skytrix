// DEV ONLY — to be removed before final ship.
// Effect-bubble fixtures for the Game Log dev hub tab (Lot 3d, analysis §3.7).
//
// The bubble (Surface 2) is the only Game Log surface with no validated visual
// reference and the hardest to observe in vivo — it needs an opponent to
// activate an effect, at the right moment, to appear at all. These fixtures
// drive `DuelGameLogService.injectDevChaining()`, which feeds a synthetic
// `MSG_CHAINING` through the REAL pipeline (mechanism D1) — the bubble is
// exercised end-to-end, not poked directly.
//
// Each fixture targets a specific bubble behaviour:
//   - short        — baseline look + anchor.
//   - long         — guard-rail G1: grow to max-height, then internal scroll.
//   - burst        — an array of 3: last-wins replace + anti-flicker floor.
//   - self         — a self activation: confirms the opponent-only filter
//                    (§3.3) correctly SUPPRESSES the bubble.
//
// Consumed only under an `isDevMode()` guard — `injectDevChaining` is a no-op
// in production builds, so this catalogue is tree-shaken out.

import { ChainingMsg, LOCATION } from '../../duel-ws.types';

// =============================================================================
// Mock ChainingMsg factory — minimal valid shape, type-checked against the
// real `ChainingMsg` interface.
// =============================================================================
function makeChaining(
  overrides: Partial<ChainingMsg> & { cardCode: number; cardName: string },
): ChainingMsg {
  return {
    type: 'MSG_CHAINING',
    // `player: 1` = opponent under the default perspective 0 — the bubble's
    // opponent-only filter shows it. The `self` fixture overrides this to 0.
    player: 1,
    location: LOCATION.SZONE,
    sequence: 0,
    chainIndex: 0,
    description: 0,
    ...overrides,
  };
}

// =============================================================================
// Fixtures — declarative, type-checked against `ChainingMsg`.
// =============================================================================

const FIXTURE_SHORT: ChainingMsg = makeChaining({
  cardCode: 12345,
  cardName: 'Branded Fusion',
  descriptionText: 'Fusion Summon 1 monster from your Extra Deck.',
});

const FIXTURE_LONG: ChainingMsg = makeChaining({
  cardCode: 23456,
  cardName: 'Albion the Branded Dragon',
  descriptionText:
    'During your Main Phase: You can banish this card from your GY, then ' +
    'target 1 "Fallen of Albaz" or 1 Fusion Monster you control; until the ' +
    'end of this turn, it gains 1000 ATK, also it can attack twice during ' +
    'each Battle Phase this turn. If this card is sent to the GY: You can ' +
    'add 1 "Branded" Spell/Trap from your Deck to your hand, except ' +
    '"Branded Fusion". You can only use each effect of "Albion the Branded ' +
    'Dragon" once per turn.',
});

// A burst — 3 synthetic activations fired in quick succession. Tests last-wins
// replace + the `EFFECT_BUBBLE_MIN_VISIBLE_MS` anti-flicker floor (§3.4 / R6):
// the bubble must coalesce to "first link → last link", never strobe.
const FIXTURE_BURST: ChainingMsg[] = [
  makeChaining({
    cardCode: 34567,
    cardName: 'Lubellion the Searing Dragon',
    descriptionText: 'Link 1 — Send "Branded" cards from hand to the GY.',
  }),
  makeChaining({
    cardCode: 45678,
    cardName: 'Mirrorjade the Iceblade Dragon',
    descriptionText: 'Link 2 — Once per turn, send 1 monster to the GY.',
  }),
  makeChaining({
    cardCode: 56789,
    cardName: 'Sprind the Irondash Dragon',
    descriptionText: 'Link 3 — Special Summon 1 Level 8 monster.',
  }),
];

// A SELF activation (`player: 0` = the viewer under the default perspective 0).
// The bubble's opponent-only filter (§3.3) MUST suppress it — firing this
// fixture should leave the bubble hidden.
const FIXTURE_SELF: ChainingMsg = makeChaining({
  player: 0,
  cardCode: 67890,
  cardName: 'Fallen of Albaz',
  descriptionText: 'Your own effect — the bubble must NOT show this.',
});

// =============================================================================
// Public registry — order matters (drives the hub UI list). `value` is either
// a single synthetic event or an array (a burst).
// =============================================================================

export interface EffectBubbleFixture {
  key: string;
  label: string;
  /** Hint shown under the trigger button. */
  hint: string;
  /** A single synthetic `MSG_CHAINING`, or a burst of them. */
  value: ChainingMsg | ChainingMsg[];
}

export const EFFECT_BUBBLE_FIXTURES: ReadonlyArray<EffectBubbleFixture> = [
  {
    key: 'short',
    label: 'Short effect',
    hint: 'Baseline look + anchor.',
    value: FIXTURE_SHORT,
  },
  {
    key: 'long',
    label: 'Very long effect',
    hint: 'Grows to max-height, then scrolls internally (G1).',
    value: FIXTURE_LONG,
  },
  {
    key: 'burst',
    label: 'Rapid burst (×3)',
    hint: 'Last-wins replace + anti-flicker floor.',
    value: FIXTURE_BURST,
  },
  {
    key: 'self',
    label: 'Self activation',
    hint: 'Opponent-only filter must SUPPRESS the bubble.',
    value: FIXTURE_SELF,
  },
];
