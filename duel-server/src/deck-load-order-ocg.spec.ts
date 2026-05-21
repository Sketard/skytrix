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
import { resolveDeckLoadOrder } from './deck-load-order.js';

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

/** Mirror of duel-worker.loadDeckToOcg: back-to-front `sequence: 0` insertion. */
function loadDeck(handle: OcgDuelHandle, deck: { main: number[]; extra: number[] }, team: 0 | 1): void {
  const ordered = resolveDeckLoadOrder(deck, false);
  for (let i = ordered.main.length - 1; i >= 0; i--) {
    core.duelNewCard(handle, {
      code: ordered.main[i], team, duelist: 0, controller: team,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
}

describe('resolveDeckLoadOrder — OCGCore opening hand', () => {
  it('shuffle off → the first decklist entries are the opening hand', () => {
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
    loadDeck(handle, DECK, 0);
    loadDeck(handle, DECK, 1);
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

    // Read player 0's hand straight from OCGCore.
    const hand = core.duelQueryLocation(handle, {
      flags: 0x1 /* CODE */, controller: 0, location: OcgLocation.HAND,
    } as never) as Array<{ code: number }>;

    expect(hand).toHaveLength(5);
    const markerCount = hand.filter(c => c.code === MARKER).length;

    // Decklist positions 0 and 1 are both MARKER. If draw is from the top
    // of a non-shuffled pile, BOTH markers are in the opening hand.
    expect(markerCount, 'both leading decklist cards drawn into the opening hand').toBe(2);

    core.destroyDuel(handle);
  });
});
