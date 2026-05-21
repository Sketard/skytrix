// =============================================================================
// resolveDeckLoadOrder — empirical OCGCore draw-order verification
// =============================================================================
//
// Boots a real OCGCore duel and confirms that, with shuffle off, the FIRST
// entries of the decklist end up in the opening hand. This is the only test
// that proves OCGCore draws from the top of the pile (vs. the bottom) and
// that loadDeckToOcg's back-to-front `sequence: 0` insertion produces the
// expected pile.
//
// Deck layout: a "marker" card as decklist[0] + decklist[1], then 38 filler
// cards. If both markers land in the 5-card opening hand, the first decklist
// entries were drawn → ordering contract holds.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
} from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle } from '@n1xx1/ocgcore-wasm';
import { resolve, join } from 'node:path';

import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from './ocg-scripts.js';
import { createCardReader, createScriptReader } from './ocg-callbacks.js';
import type { CardDB, ScriptDB } from './types.js';
import { resolveDeckLoadOrder, normalizeReplayDeck } from './deck-load-order.js';

const DATA_DIR = resolve(import.meta.dirname!, '../data');
const DB_PATH = join(DATA_DIR, 'cards.cdb');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');

const MARKER = 32864;   // The 13th Grave  (decklist positions 0 and 1)
const FILLER = 43096270; // Alexandrite Dragon (positions 2..39)

// 40-card decklist: 2 markers up front, 38 filler.
const DECK = { main: [MARKER, MARKER, ...Array(38).fill(FILLER)], extra: [] as number[] };

let core: OcgCoreSync;
let cardDb: CardDB;
let scripts: ScriptDB;

beforeAll(async () => {
  cardDb = loadDatabase(DB_PATH);
  scripts = loadScripts(SCRIPTS_DIR);
  core = await createCore({ sync: true });
});

afterAll(() => {
  try { cardDb?.db.close(); } catch { /* noop */ }
});

/**
 * Mirror of duel-worker.loadDeckToOcg: resolve the load order (shuffle off)
 * then insert back-to-front with `sequence: 0`. The optional `replayDeck`
 * pre-step runs `normalizeReplayDeck` exactly as the replay / fork load
 * paths do, so a test can exercise the full composition.
 */
function loadDeck(
  handle: OcgDuelHandle,
  deck: { main: number[]; extra: number[] },
  team: 0 | 1,
  replayDeck?: { convention: 'verbatim' | undefined },
): void {
  const normalised = replayDeck
    ? normalizeReplayDeck(deck, replayDeck.convention)
    : deck;
  const ordered = resolveDeckLoadOrder(normalised, false);
  for (let i = ordered.main.length - 1; i >= 0; i--) {
    core.duelNewCard(handle, {
      code: ordered.main[i], team, duelist: 0, controller: team,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
}

/** Boot a duel, drive it to the first SELECT_IDLECMD, return player 0's hand. */
function openingHand(load: (handle: OcgDuelHandle) => void): Array<{ code: number }> {
  const handle = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: [1n, 2n, 3n, 4n],
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader: createCardReader(cardDb),
    scriptReader: createScriptReader(scripts),
    errorHandler: () => {},
  });
  if (!handle) throw new Error('createDuel failed');
  for (const name of STARTUP_SCRIPTS) {
    const c = scripts.startupScripts.get(name);
    if (c) core.loadScript(handle, name, c);
  }
  load(handle);
  core.startDuel(handle);

  // Drive to the first SELECT_IDLECMD — all 5 opening draws are done by then.
  let reached = false;
  for (let step = 0; step < 200 && !reached; step++) {
    const status = core.duelProcess(handle);
    const msgs = core.duelGetMessage(handle);
    if (status === OcgProcessResult.END) break;
    for (const m of msgs) {
      if (m.type === OcgMessageType.SELECT_IDLECMD) { reached = true; break; }
    }
  }
  expect(reached, 'duel reached SELECT_IDLECMD').toBe(true);

  const hand = core.duelQueryLocation(handle, {
    flags: 0x1 /* CODE */, controller: 0, location: OcgLocation.HAND,
  } as never) as Array<{ code: number }>;
  core.destroyDuel(handle);
  return hand;
}

describe('resolveDeckLoadOrder — OCGCore opening hand', () => {
  it('shuffle off → the first decklist entries are the opening hand', () => {
    const hand = openingHand(handle => {
      loadDeck(handle, DECK, 0);
      loadDeck(handle, DECK, 1);
    });

    expect(hand).toHaveLength(5);
    // Decklist positions 0 and 1 are both MARKER. If draw is from the top
    // of a non-shuffled pile, BOTH markers are in the opening hand.
    expect(
      hand.filter(c => c.code === MARKER).length,
      'both leading decklist cards drawn into the opening hand',
    ).toBe(2);
  });

  it('legacy replay (no deckOrder) → normalizeReplayDeck + back-to-front load reproduce the original pile', () => {
    // A legacy capturedDeck is the decklist order (the pre-fix loadDeckToOcg
    // returned `[...mainCards]`, and front-to-back `sequence:0` insertion
    // made the live pile the decklist REVERSED). Put the two markers at the
    // END of the captured deck: `normalizeReplayDeck(undefined)` reverses it,
    // bringing them to the top, and the back-to-front load must keep them
    // there. If the two reversals did not compose correctly, the markers
    // would NOT be in the opening hand.
    const legacyCaptured = {
      main: [...Array(38).fill(FILLER), MARKER, MARKER],
      extra: [] as number[],
    };
    const hand = openingHand(handle => {
      loadDeck(handle, legacyCaptured, 0, { convention: undefined });
      loadDeck(handle, legacyCaptured, 1, { convention: undefined });
    });

    expect(hand).toHaveLength(5);
    expect(
      hand.filter(c => c.code === MARKER).length,
      'both trailing legacy-deck cards reach the opening hand after normalization',
    ).toBe(2);
  });

  it('new replay (verbatim) → no reversal, the captured pile loads as-is', () => {
    // A verbatim capturedDeck is already the live top→bottom pile: markers at
    // the front stay the opening hand, no normalization reversal applied.
    const hand = openingHand(handle => {
      loadDeck(handle, DECK, 0, { convention: 'verbatim' });
      loadDeck(handle, DECK, 1, { convention: 'verbatim' });
    });

    expect(hand).toHaveLength(5);
    expect(
      hand.filter(c => c.code === MARKER).length,
      'verbatim capture preserves the leading decklist cards',
    ).toBe(2);
  });
});
