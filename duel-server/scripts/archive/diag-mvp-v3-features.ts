// =============================================================================
// diag-mvp-v3-features.ts — Phase B Day 3 smoke test for MVP v3 features.
//
// Verifies that the new FieldState + Action fields populate correctly at
// runtime. Walks linearly through snake-eye-yummy-opener (no DFS, just pick
// action[0] each prompt) and dumps the values at each step.
//
// Checks:
//   - state.activatableHandCardCount    (set at IDLECMD, undefined elsewhere)
//   - state.specialSummonsThisTurn[0]   (counter, increments on SPSUMMONING)
//   - state.effectsActivatedThisTurn    (counter, increments on own activation)
//   - state.distinctCardsUsedThisTurn   (set, distinct own cardIds activated)
//   - state.chainResolutionsThisTurn    (counter, MSG_CHAIN_END)
//   - state.cardsDrawnThisTurn[0]       (counter, MSG_DRAW)
//   - state.cardsSearchedThisTurn[0]    (counter, MSG_MOVE deck→hand)
//   - state.normalSummonUsed[0]         (boolean, set on SUMMONING/FLIPSUMMONING)
//   - action.actionVerb                 (set by adapter on enumerate)
//   - action.actionVerb tribute split   (Lv≤4 = normal-summon, Lv≥5 = tribute-summon)
//
// Goal: confirm that "no commit, type-check green" actually means "working
// runtime". If counters stay at 0 forever, plumbing has a wiring bug.
//
// Usage: npx tsx scripts/diag-mvp-v3-features.ts [--steps=10]
// =============================================================================

import {
  loadFixtureFile,
  DATA_DIR,
} from '../eval/evaluate-structural.js';
import { join } from 'node:path';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import type { Action, FieldState } from '../../src/solver/solver-types.js';

function pickArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function summarizeState(s: FieldState): Record<string, unknown> {
  return {
    turn: s.turn,
    phase: s.phase,
    handSize: s.zones.HAND?.length ?? 0,
    LP: s.lifePoints[0],
    NS_used: s.normalSummonUsed?.[0] ?? '(undef)',
    activatableHandCardCount: s.activatableHandCardCount ?? '(undef)',
    specialSummons_self: s.specialSummonsThisTurn?.[0] ?? '(undef)',
    effectsActivated: s.effectsActivatedThisTurn ?? '(undef)',
    distinctCardsUsed: s.distinctCardsUsedThisTurn ?? '(undef)',
    chainResolutions: s.chainResolutionsThisTurn ?? '(undef)',
    cardsDrawn_self: s.cardsDrawnThisTurn?.[0] ?? '(undef)',
    cardsSearched_self: s.cardsSearchedThisTurn?.[0] ?? '(undef)',
  };
}

function summarizeAction(a: Action): string {
  const tag = a.actionTag ?? '?';
  const verb = a.actionVerb ?? '(undef)';
  const sz = a.sourceZone ?? '?';
  return `cardId=${a.cardId} tag=${tag} verb=${verb} src=${sz} respIdx=${a.responseIndex}`;
}

async function main(): Promise<void> {
  const maxSteps = Number(pickArg('steps') ?? 12);

  const fixtureFile = loadFixtureFile();
  const fxt = fixtureFile.hands.find(h => h.id === 'snake-eye-yummy-opener');
  if (!fxt) throw new Error('snake-eye-yummy-opener fixture not found');
  const deck = fixtureFile.decks[fxt.deck];
  if (!deck) throw new Error(`deck ${fxt.deck} not found`);

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  const config = {
    mainDeck: deck.main,
    extraDeck: deck.extra,
    hand: fxt.hand,
    deckSeed: fxt.deckSeed,
    opponentDeck: deck.main, // mirror; doesn't matter for goldfish smoke test
  };
  const handle = adapter.createDuel(config);

  console.log('=== MVP v3 features smoke test — snake-eye-yummy-opener ===');
  console.log(`Hand: ${fxt.hand.join(', ')}`);
  console.log();

  let stepNo = 0;
  while (stepNo < maxSteps) {
    const actions = adapter.getLegalActions(handle);
    if (actions.length === 0) {
      console.log(`[step ${stepNo}] no legal actions — duel ended`);
      break;
    }
    const state = adapter.getFieldState(handle);
    console.log(`--- step ${stepNo} (${actions.length} actions) ---`);
    console.log('  state:', JSON.stringify(summarizeState(state)));
    // Show first 6 actions with verbs (full enum can be 30+).
    for (let i = 0; i < Math.min(6, actions.length); i++) {
      console.log(`  action[${i}]: ${summarizeAction(actions[i])}`);
    }
    if (actions.length > 6) console.log(`  ... (${actions.length - 6} more)`);

    // Pick priority: activate > summon-procedure > normal-summon > others
    // > pass/end-phase. This drives the duel toward effect activations so
    // the unverified counters (effectsActivated, chainResolutions,
    // cardsDrawn, cardsSearched) get triggered.
    const priority: readonly (Action['actionVerb'] | string)[] = [
      'activate', 'summon-procedure', 'normal-summon', 'tribute-summon',
      'set-monster', 'set-st', 'pendulum-summon',
    ];
    let pickIndex = -1;
    for (const verb of priority) {
      pickIndex = actions.findIndex(a => a.actionVerb === verb);
      if (pickIndex !== -1) break;
    }
    if (pickIndex === -1) {
      // No verb-tagged action: fall back to first non-end-phase
      pickIndex = actions.findIndex(a => a.actionTag !== 'to_ep' && a.actionTag !== 'pass');
    }
    if (pickIndex === -1) pickIndex = 0;
    const picked = actions[pickIndex];
    console.log(`  -> picking [${pickIndex}]: ${summarizeAction(picked)}`);
    adapter.applyAction(handle, picked);
    stepNo++;
  }

  // Final state dump
  const finalState = adapter.getFieldState(handle);
  console.log();
  console.log('=== Final state ===');
  console.log(JSON.stringify(summarizeState(finalState), null, 2));
  adapter.destroyDuel(handle);
  cardDB.db.close();
}

main().catch(err => {
  console.error('[diag-mvp-v3-features] error:', err);
  process.exit(1);
});
