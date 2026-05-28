// =============================================================================
// pre-process-overlays — wasm binding behaviour verification (H7 post-review)
// =============================================================================
//
// Boots a real OCGCore duel and verifies the assumption that
// `pre-process-overlays.ts:capturePreProcessOverlays` makes about
// `duelQueryLocation(controller, MZONE)` :
//
//   "The binding returns a SPARSE array indexed by MZONE sequence
//    (0-4 for monster zones, 5-6 for EMZ slots). Empty slots are
//    null. cards.length === 7 reflects the full MZONE slot count."
//
// If this assumption is WRONG (dense array, missing EMZ slots, …)
// the `for (let seq = 0; seq < cards.length; seq++)` loop in
// `capturePreProcessOverlays` would either skip slots or misassign
// `sourceMzoneSeq`. The test fails early and visibly instead of
// shipping a silent broken snapshot.
//
// This is the ONLY test that exercises the wasm binding for this
// concern — the unit spec `pre-process-overlays.spec.ts` mocks the
// binding and cannot catch a binding-side semantic change.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgQueryFlags,
} from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle } from '@n1xx1/ocgcore-wasm';
import { resolve, join } from 'node:path';

import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from './ocg-scripts.js';
import { createCardReader, createScriptReader } from './ocg-callbacks.js';
import type { CardDB, ScriptDB } from './types.js';

const DATA_DIR = resolve(import.meta.dirname!, '../data');
const DB_PATH = join(DATA_DIR, 'cards.cdb');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');

// Minimal 40-card deck — content doesn't matter for the MZONE query.
const FILLER = 43096270; // Alexandrite Dragon
const DECK = { main: Array(40).fill(FILLER), extra: [] as number[] };

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

function bootDuel(): OcgDuelHandle {
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
  for (let i = DECK.main.length - 1; i >= 0; i--) {
    for (const team of [0, 1] as const) {
      core.duelNewCard(handle, {
        code: DECK.main[i], team, duelist: 0, controller: team,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
  }
  core.startDuel(handle);
  return handle;
}

describe('pre-process-overlays — wasm binding sparse-array assumption (H7)', () => {
  it('duelQueryLocation(MZONE) returns a sparse array indexed by seq (length=7 for MR5)', () => {
    const handle = bootDuel();
    try {
      for (const controller of [0, 1] as const) {
        const cards = core.duelQueryLocation(handle, {
          flags: OcgQueryFlags.OVERLAY_CARD as number,
          controller,
          location: OcgLocation.MZONE as number,
        } as never);

        // The contract `capturePreProcessOverlays` relies on : the array
        // length covers every MZONE slot, sparse (null on empty slots).
        // MR5 = 5 monster + 2 EMZ = 7 slots per controller.
        expect(cards.length, `controller=${controller} MZONE slot count`).toBe(7);
        // No card is summoned at this point — every slot must be null.
        for (let seq = 0; seq < cards.length; seq++) {
          expect(cards[seq], `controller=${controller} seq=${seq} should be empty`).toBeNull();
        }
      }
    } finally {
      core.destroyDuel(handle);
    }
  });

  it('SZONE returns a sparse array (slot count is binding-defined)', () => {
    // Sanity probe : verify the sparse assumption isn't MZONE-specific.
    // The exact SZONE slot count is binding-defined (empirically 8 in
    // this build — MR5 spec is 5 spell/trap + 1 field + Pendulum extras).
    // What matters for `capturePreProcessOverlays`-style callers : the
    // array is sparse, indexed by seq, with null on empty slots.
    // A dense binding (length 0 when empty) would break the seq-as-index
    // assumption everywhere.
    const handle = bootDuel();
    try {
      for (const controller of [0, 1] as const) {
        const cards = core.duelQueryLocation(handle, {
          flags: OcgQueryFlags.OVERLAY_CARD as number,
          controller,
          location: OcgLocation.SZONE as number,
        } as never);
        // Sparse contract : non-empty (5+ slots) with null on empty seqs.
        expect(cards.length, `controller=${controller} SZONE not dense-empty`).toBeGreaterThan(0);
        for (let seq = 0; seq < cards.length; seq++) {
          expect(cards[seq], `controller=${controller} SZONE seq=${seq} should be empty`).toBeNull();
        }
      }
    } finally {
      core.destroyDuel(handle);
    }
  });
});
