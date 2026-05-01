// =============================================================================
// debug-fieldstate.ts — Walk a real combo manually and print the field state
// at each step. Goal: understand why MCTS rollouts produce empty endBoards.
// Usage: npx tsx scripts/debug-fieldstate.ts
// =============================================================================

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import type { DuelConfig, FieldState } from '../src/solver/solver-types.js';
import { ALL_ZONE_IDS } from '../src/solver/solver-types.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const HANDS_PATH = resolve(import.meta.dirname!, '..', '..', '_bmad-output', 'planning-artifacts', 'research', 'mcts-calibration-hands.json');

console.log('[Debug] Booting...');
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
const scorer = new InterruptionScorer(allConfigs.interruptionTags, allConfigs.interruptionWeights);
console.log('[Debug] Boot complete\n');

interface CalibFile {
  decks: Record<string, { main: number[]; extra: number[] }>;
  hands: { id: string; deck: string; hand: number[]; deckSeed: string }[];
}
const calib = JSON.parse(readFileSync(HANDS_PATH, 'utf-8')) as CalibFile;
const handIdx = process.argv.includes('--hand') ? Number(process.argv[process.argv.indexOf('--hand') + 1]) : 0;
const hand = calib.hands[handIdx]; // 0=branded-fusion, 2=snake-eye-ash, 4=snake-eye-diabellstar
const deck = calib.decks[hand.deck];
const mainDeck = [...deck.main];
for (const cardId of hand.hand) {
  const idx = mainDeck.indexOf(cardId);
  mainDeck.splice(idx, 1);
}

const duelConfig: DuelConfig = {
  mainDeck,
  extraDeck: deck.extra,
  hand: hand.hand,
  deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
  opponentDeck: [],
};

const stmt = cardDB.stmt;
function shortName(cardId: number): string {
  if (!cardId) return '_';
  const r = stmt.get(cardId) as { name?: string } | undefined;
  return (r?.name ?? `#${cardId}`).slice(0, 25);
}

function dumpField(label: string, fs: FieldState): void {
  console.log(`  [field] ${label} | turn=${fs.turn} phase=${fs.phase} lp=${fs.lifePoints[0]}/${fs.lifePoints[1]}`);
  for (const z of ALL_ZONE_IDS) {
    const cards = fs.zones[z];
    if (cards.length === 0) continue;
    const summary = cards.map(c => `${shortName(c.cardId)}/${c.position}${c.overlayCount > 0 ? `+${c.overlayCount}` : ''}`).join(', ');
    console.log(`           ${z.padEnd(10)}: ${summary}`);
  }
  const { score, scoreBreakdown } = scorer.score(fs);
  console.log(`           score=${score} weighted=${scoreBreakdown.weighted} fallback=${scoreBreakdown.fallbackPoints}`);
}

const handle = adapter.createDuel(duelConfig);

console.log('=== Manual walk: try to execute a Branded combo ===\n');
console.log('Hand:');
for (const cid of hand.hand) console.log(`  ${cid} -> ${shortName(cid)}`);
console.log('');

// Initial state
dumpField('initial (before any prompt)', adapter.getFieldState(handle));
console.log('');

let step = 0;
const MAX_STEPS = 80;

while (step < MAX_STEPS) {
  const actions = adapter.getLegalActions(handle);
  if (actions.length === 0) {
    console.log(`[step ${step}] NO ACTIONS — duel ended\n`);
    break;
  }
  const prompt = actions[0].promptType;

  // Build summary
  const visible = actions.slice(0, 8).map((a, i) => `[${i}]${a.responseIndex}/${shortName(a.cardId)}/${a.actionTag ?? '-'}`).join(' ');
  console.log(`[step ${step}] prompt=${prompt} (${actions.length} actions) ${visible}${actions.length > 8 ? ' ...' : ''}`);

  // Strategy: prefer actions that build the board
  // Priority: special_summon (action.tag undefined for IDLECMD subtypes) > activate > summon > pass > to_ep
  // For SELECT_IDLECMD, look at the action tag from enumeration order:
  //   summons, special_summons, pos_changes, monster_sets, spell_sets, activates, to_bp, to_ep
  // For SELECT_CHAIN: prefer activate over pass
  // For SELECT_EFFECTYN: prefer yes (responseIndex 1)
  // For SELECT_OPTION: pick 0
  let chosen = actions[0];
  if (prompt === 'SELECT_CHAIN') {
    chosen = actions.find(a => a.actionTag !== 'pass') ?? actions[0];
  } else if (prompt === 'SELECT_EFFECTYN') {
    chosen = actions.find(a => a.responseIndex === 1) ?? actions[0];
  } else if (prompt === 'SELECT_IDLECMD') {
    // Prefer special summons / activates / summons over to_bp/to_ep
    const nonTerminal = actions.filter(a => a.actionTag !== 'to_bp' && a.actionTag !== 'to_ep');
    chosen = nonTerminal[0] ?? actions[0];
  }

  console.log(`[step ${step}] -> apply respIdx=${chosen.responseIndex} ${shortName(chosen.cardId)} ${chosen.actionTag ?? ''}`);
  try {
    adapter.applyAction(handle, chosen);
  } catch (err) {
    console.log(`[step ${step}] ERROR: ${String(err)}\n`);
    break;
  }

  // Dump field every step for the first 10, then every 5
  if (step < 10 || step % 5 === 0) {
    dumpField(`after step ${step}`, adapter.getFieldState(handle));
  }
  console.log('');
  step++;
}

console.log('\n=== Final state ===');
dumpField('FINAL', adapter.getFieldState(handle));

adapter.destroyAll();
process.exit(0);
