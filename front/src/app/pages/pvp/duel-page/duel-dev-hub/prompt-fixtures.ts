// DEV ONLY — to be removed before final ship.
// Prompt fixtures for the Prompts dev hub tab. Cf duel-prompts-refresh-spec §9.5.
//
// Sprint 1 — 4 base prompt fixtures (Y/N, Option List, Card Grid Target,
// Numeric Counter). The "Passive Waiting" variant is driven by
// `tpPassiveMessage`, not by `prompt` itself — a future extension will
// override that signal too if visual preview becomes useful.
//
// Additional fixtures (Sort Card, Position Select, etc.) will land in
// subsequent prompt-refresh sprints.

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
  makeMockCard({ cardCode: 12345, name: 'Branded Fusion',     sequence: 0 }),
  makeMockCard({ cardCode: 23456, name: 'Albion the Branded Dragon', sequence: 1 }),
  makeMockCard({ cardCode: 34567, name: 'Lubellion the Searing Dragon', sequence: 2 }),
  makeMockCard({ cardCode: 45678, name: 'Mirrorjade the Iceblade Dragon', sequence: 3 }),
  makeMockCard({ cardCode: 56789, name: 'Sprind the Irondash Dragon', sequence: 4 }),
];

// =============================================================================
// Sprint 1 — 4 base fixtures, declarative (not yet via a factory).
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

export const FIXTURE_NUMERIC_COUNTER: Prompt = {
  type: 'SELECT_COUNTER',
  player: 0,
  counterType: 0x1,
  count: 3,
  cards: [MOCK_CARDS[0]],
};

// =============================================================================
// Public registry — order matters (drives the hub UI list).
// =============================================================================

export const PROMPT_FIXTURES: ReadonlyArray<{ key: string; label: string; value: Prompt }> = [
  { key: 'yes-no',           label: 'Yes / No',         value: FIXTURE_YES_NO },
  { key: 'option-list',      label: 'Option List',      value: FIXTURE_OPTION_LIST },
  { key: 'card-grid-target', label: 'Card Grid Target', value: FIXTURE_CARD_GRID_TARGET },
  { key: 'numeric-counter',  label: 'Numeric Counter',  value: FIXTURE_NUMERIC_COUNTER },
];
