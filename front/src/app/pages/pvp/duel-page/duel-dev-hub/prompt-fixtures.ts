// DEV ONLY — to be removed before final ship.
// Prompt fixtures for the Prompts dev hub tab. Cf duel-prompts-refresh-spec §9.5.
//
// Coverage : 10 prompt variants live via fixtures.
//   - Yes/No, Option List, Card Grid Target, Numeric Counter (Sprint 1)
//   - Card Grid Sum, Sort Card, Position Select, Numeric Multi,
//     Numeric Declare, Announce Card (this commit)
//
// NOT shipped as fixtures (deliberate):
//   - Zone Highlight    — uses Pattern A (floating overlay), not the sheet
//                         (cf prompt-registry.ts comment).
//   - Shell Collapsed   — internal state of pvp-prompt-dialog (user-toggled).
//   - Shell Sending     — internal state (pendingResponse), not a Prompt.

import { CardInfo, LOCATION } from '../../duel-ws.types';
import { Prompt } from '../../types';

// =============================================================================
// Mock CardInfo factory — minimal valid shape for prompts that need cards.
// =============================================================================
function makeMockCard(overrides: Partial<CardInfo> & { cardCode: number; name: string }): CardInfo {
  return {
    player: 0,
    location: LOCATION.HAND,
    sequence: 0,
    ...overrides,
  };
}

const MOCK_CARDS: CardInfo[] = [
  makeMockCard({ cardCode: 12345, name: 'Branded Fusion',                  sequence: 0 }),
  makeMockCard({ cardCode: 23456, name: 'Albion the Branded Dragon',       sequence: 1 }),
  makeMockCard({ cardCode: 34567, name: 'Lubellion the Searing Dragon',    sequence: 2 }),
  makeMockCard({ cardCode: 45678, name: 'Mirrorjade the Iceblade Dragon',  sequence: 3 }),
  makeMockCard({ cardCode: 56789, name: 'Sprind the Irondash Dragon',      sequence: 4 }),
];

// Cards on the field — used by SELECT_SUM mock (tribute summon scenario).
const MOCK_FIELD_CARDS: CardInfo[] = [
  makeMockCard({ cardCode: 12345, name: 'Albaz, Branded',         location: LOCATION.MZONE, sequence: 0, amount: 4 }),
  makeMockCard({ cardCode: 23456, name: 'Branded Beast',          location: LOCATION.MZONE, sequence: 1, amount: 4 }),
  makeMockCard({ cardCode: 34567, name: 'Mirrorjade Token',       location: LOCATION.MZONE, sequence: 2, amount: 2 }),
];

// =============================================================================
// Fixtures — declarative, minimal, type-checked against the Prompt union.
// =============================================================================

export const FIXTURE_YES_NO: Prompt = {
  type: 'SELECT_YESNO',
  player: 0,
  description: 0,
  descriptionText: 'Activate Branded Fusion?',
};

export const FIXTURE_OPTION_LIST: Prompt = {
  type: 'SELECT_OPTION',
  player: 0,
  options: [1, 2, 3],
  descriptions: [
    'Discard 1 card from your hand',
    'Banish 1 monster from your GY',
    'Negate the activation',
  ],
};

export const FIXTURE_CARD_GRID_TARGET: Prompt = {
  type: 'SELECT_CARD',
  player: 0,
  min: 1,
  max: 2,
  cards: MOCK_CARDS,
  cancelable: false,
};

export const FIXTURE_CARD_GRID_SUM: Prompt = {
  type: 'SELECT_SUM',
  player: 0,
  mustSelect: [],
  cards: MOCK_FIELD_CARDS,
  targetSum: 8,
  minCards: 2,
  maxCards: 3,
  selectMax: 3,
};

export const FIXTURE_SORT_CARD: Prompt = {
  type: 'SORT_CARD',
  player: 0,
  cards: MOCK_CARDS.slice(0, 4),
};

export const FIXTURE_POSITION_SELECT: Prompt = {
  type: 'SELECT_POSITION',
  player: 0,
  cardCode: 12345,
  cardName: 'Albion the Branded Dragon',
  // Bitmask of allowed positions: face-up ATK, face-up DEF, face-down DEF.
  // The component decomposes this into 3 cards in the grid.
  positions: [0x1, 0x4, 0x8],
};

export const FIXTURE_NUMERIC_COUNTER: Prompt = {
  type: 'SELECT_COUNTER',
  player: 0,
  counterType: 0x1,
  count: 3,
  cards: [MOCK_CARDS[0]],
};

// Multi-counter variant — SELECT_COUNTER with 2+ cards triggers the
// multi-distribution UI in PromptNumericInputComponent.
export const FIXTURE_NUMERIC_MULTI: Prompt = {
  type: 'SELECT_COUNTER',
  player: 0,
  counterType: 0x1,
  count: 5,
  cards: MOCK_FIELD_CARDS.slice(0, 3),
};

export const FIXTURE_NUMERIC_DECLARE: Prompt = {
  type: 'ANNOUNCE_NUMBER',
  player: 0,
  options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

export const FIXTURE_ANNOUNCE_CARD: Prompt = {
  type: 'ANNOUNCE_CARD',
  player: 0,
  // Opcodes describe a filter on declarable cards. Empty list lets the
  // search input drive the lookup (default behaviour for the dev fixture).
  opcodes: [],
};

// =============================================================================
// Public registry — order matters (drives the hub UI list).
// =============================================================================

export const PROMPT_FIXTURES: ReadonlyArray<{ key: string; label: string; value: Prompt }> = [
  { key: 'yes-no',           label: 'Yes / No',           value: FIXTURE_YES_NO },
  { key: 'option-list',      label: 'Option List',        value: FIXTURE_OPTION_LIST },
  { key: 'card-grid-target', label: 'Card Grid Target',   value: FIXTURE_CARD_GRID_TARGET },
  { key: 'card-grid-sum',    label: 'Card Grid Sum',      value: FIXTURE_CARD_GRID_SUM },
  { key: 'sort-card',        label: 'Sort Card',          value: FIXTURE_SORT_CARD },
  { key: 'position-select',  label: 'Position Select',    value: FIXTURE_POSITION_SELECT },
  { key: 'numeric-counter',  label: 'Numeric Counter',    value: FIXTURE_NUMERIC_COUNTER },
  { key: 'numeric-multi',    label: 'Numeric Multi',      value: FIXTURE_NUMERIC_MULTI },
  { key: 'numeric-declare',  label: 'Numeric Declare',    value: FIXTURE_NUMERIC_DECLARE },
  { key: 'announce-card',    label: 'Announce Card',      value: FIXTURE_ANNOUNCE_CARD },
];
