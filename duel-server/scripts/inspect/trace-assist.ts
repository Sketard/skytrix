// =============================================================================
// trace-assist.ts — interactive trajectory authoring (Phase 5-lite option 4).
//
// Hand-authoring mode for canonical combo trajectories. Skips the DFS and the
// scorer entirely. At each decision point, shows the legal-action pool and
// prompts the author for which action to take. Appends each chosen step to a
// trajectory JSON and auto-saves after every step (crash-resistant).
//
// Motivation: canonicalPath + bannedCardIds hit a ceiling on ryzeal-mitsurugi
// at matched ≤ 3/6 because the structural scorer prefers Murakumo over Futsu
// even when pins/bans redirect. For training-set authoring (behavior cloning)
// we need 6/6 matched trajectories; the fastest path is to bypass the scorer
// and write the SolverAction[] directly. `replay-trajectory.ts` then validates
// bit-exactly against the fixture's expectedBoard.
//
// The output file is drop-in compatible with `replay-trajectory.ts` — same
// TrajectoryFile shape.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/trace-assist.ts \
//     --fixture=ryzeal-mitsurugi-opener \
//     --out=../_bmad-output/planning-artifacts/research/trajectories/ryzeal-mitsurugi-opener.json
//
// Commands at each prompt:
//   <number>        pick action by index in the printed table
//   p               print full field state (zones + LP + turn/phase)
//   u               undo last step (re-inits OCGCore, replays remaining)
//   s               save and exit
//   q               quit without saving (changes still persisted after each
//                   step — 'q' only skips the final flush, and since we
//                   already flushed last step it's effectively 's')
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  DATA_DIR,
  loadFixtureFile,
  type FixtureFile,
  type HandFixture,
} from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import type { Action, DuelConfig, DuelHandle } from '../../src/solver/solver-types.js';

interface TrajectoryStep {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
}

interface TrajectoryFile {
  fixtureId: string;
  description: string;
  canonicalPathHint?: number[];
  bannedCardIdsHint?: number[];
  steps: TrajectoryStep[];
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function findHand(fixture: FixtureFile, id: string): HandFixture {
  const hand = fixture.hands.find(h => h.id === id);
  if (!hand) throw new Error(`[trace] fixture '${id}' not found`);
  if (hand._draft === true) throw new Error(`[trace] fixture '${id}' is marked _draft`);
  return hand;
}

function initDuel(adapter: OCGCoreAdapter, hand: HandFixture, deck: { main: number[]; extra: number[] }): DuelHandle {
  const mainDeck = [...deck.main];
  for (const cid of hand.hand) {
    const idx = mainDeck.indexOf(cid);
    if (idx === -1) throw new Error(`[trace] hand card ${cid} not in main deck`);
    mainDeck.splice(idx, 1);
  }
  const duelConfig: DuelConfig = {
    mainDeck,
    extraDeck: deck.extra,
    hand: hand.hand,
    deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
    opponentDeck: [],
    startingDrawCount: 0,
    drawCountPerTurn: 1,
  };
  return adapter.createDuel(duelConfig);
}

interface ReplayResult {
  handle: DuelHandle;
  /** Number of steps successfully replayed. Steps at index >= replayed
   *  were dropped because the adapter's action pool at that point did not
   *  contain a match (typically adapter semantics changed between sessions —
   *  e.g. multi-pick exposure added). Caller should truncate the trajectory
   *  to this length and resume authoring. */
  replayed: number;
  driftReason?: string;
}

function replaySteps(
  adapter: OCGCoreAdapter,
  handle: DuelHandle,
  steps: TrajectoryStep[],
): ReplayResult {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const legal = adapter.getLegalActions(handle);
    const match = legal.find(a => a.responseIndex === step.responseIndex && a.cardId === step.cardId);
    if (!match) {
      return {
        handle,
        replayed: i,
        driftReason: `step ${i}: (rIdx=${step.responseIndex}, cid=${step.cardId}/${step.cardName}) not in pool of ${legal.length} actions`,
      };
    }
    adapter.applyAction(handle, match);
  }
  return { handle, replayed: steps.length };
}

function formatAction(a: Action): string {
  const rIdxStr = a.responseIndex.toString().padStart(3);
  const cidStr = a.cardId === 0 ? '(none)' : String(a.cardId).padStart(9);
  const name = a.description ?? '(no description)';
  return `rIdx=${rIdxStr}  cid=${cidStr}  ${a.promptType.padEnd(18)}  ${name}`;
}

function printFieldState(adapter: OCGCoreAdapter, handle: DuelHandle): void {
  const fs = adapter.getFieldState(handle);
  console.log(`\n  ─── Field State ───`);
  console.log(`  turn=${fs.turn}  phase=${fs.phase}  LP=[${fs.lifePoints[0]}, ${fs.lifePoints[1]}]`);
  for (const [zone, cards] of Object.entries(fs.zones)) {
    if (cards.length === 0) continue;
    const formatted = cards.map(c => `${c.cardId}/${c.cardName.slice(0, 30)}/${c.position}${c.overlayCount > 0 ? `[+${c.overlayCount}ovl]` : ''}`).join(', ');
    console.log(`  ${zone.padEnd(10)} ${formatted}`);
  }
  console.log();
}

function saveTrajectory(outPath: string, traj: TrajectoryFile): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(traj, null, 2) + '\n', 'utf-8');
}

async function main(): Promise<void> {
  const fixtureId = parseStringArg('fixture');
  const outPath = parseStringArg('out');
  const description = parseStringArg('description') ?? '';
  const scriptPath = parseStringArg('script');
  if (!fixtureId || !outPath) {
    console.error('[trace] --fixture=<id> and --out=<path> required');
    process.exit(2);
  }

  const absOut = resolve(outPath);
  const fixture = loadFixtureFile();
  const hand = findHand(fixture, fixtureId);
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`[trace] deck '${hand.deck}' not found`);

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  // Phase 5-lite (2026-04-19): expose multi-pick mechanical prompts
  // (SELECT_CARD min>1, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD)
  // as interactive actions so the author can pick Xyz/Synchro materials,
  // tribute targets, etc. manually instead of hitting the first-N heuristic.
  adapter.exposeMultiPickMechanical = true;

  let traj: TrajectoryFile;
  if (existsSync(absOut)) {
    traj = JSON.parse(readFileSync(absOut, 'utf-8')) as TrajectoryFile;
    if (traj.fixtureId !== fixtureId) {
      throw new Error(`[trace] existing trajectory has fixtureId='${traj.fixtureId}', refusing to overwrite with '${fixtureId}'`);
    }
    console.log(`[trace] resuming: ${traj.steps.length} step(s) already authored`);
  } else {
    traj = { fixtureId, description, steps: [] };
    console.log(`[trace] starting fresh trajectory`);
  }

  let handle = initDuel(adapter, hand, deck);
  if (traj.steps.length > 0) {
    const r = replaySteps(adapter, handle, traj.steps);
    handle = r.handle;
    if (r.replayed < traj.steps.length) {
      console.log(`[trace] ⚠ drift detected — ${r.driftReason}`);
      console.log(`[trace] ⚠ truncating trajectory from ${traj.steps.length} steps to ${r.replayed} and re-initializing handle`);
      traj.steps.length = r.replayed;
      saveTrajectory(absOut, traj);
      // The partial replay drained OCG's message buffer; the handle is now
      // wedged. Re-init and re-apply the truncated steps to get a clean
      // handle at a WAITING state with pending messages available.
      adapter.destroyAll();
      handle = initDuel(adapter, hand, deck);
      if (traj.steps.length > 0) {
        const r2 = replaySteps(adapter, handle, traj.steps);
        handle = r2.handle;
        if (r2.replayed < traj.steps.length) {
          throw new Error(`[trace] cascading drift after truncate — ${r2.driftReason}`);
        }
      }
    }
  }

  // Script mode: read commands from file, apply sequentially, exit at end.
  // One command per line. Comments via '#' supported.
  let scriptCommands: string[] | undefined;
  let scriptCursor = 0;
  if (scriptPath) {
    const raw = readFileSync(resolve(scriptPath), 'utf-8');
    scriptCommands = raw.split(/\r?\n/)
      .map(l => l.replace(/#.*$/, '').trim())
      .filter(l => l.length > 0);
    console.log(`[trace] script mode: ${scriptCommands.length} commands from ${scriptPath}`);
  }

  const rl = scriptCommands ? null : createInterface({ input: stdin, output: stdout });
  const verbose = process.argv.includes('--verbose') ? true : (scriptCommands ? false : true);

  try {
    while (true) {
      const legal = adapter.getLegalActions(handle);
      if (legal.length === 0) {
        console.log(`\n[trace] no more legal actions (handle terminal or turn ended). Trajectory complete.`);
        break;
      }

      if (verbose) {
        console.log(`\n═══ Step ${traj.steps.length} ═══`);
        const fs = adapter.getFieldState(handle);
        console.log(`turn=${fs.turn}  phase=${fs.phase}  handSize=${fs.zones['HAND']?.length ?? 0}  legalActions=${legal.length}`);
        const pending = adapter.getPendingMultiPick(handle);
        if (pending) {
          const target = pending.targetSum !== undefined ? `  target=${pending.targetSum}` : '';
          console.log(`  ⎘ pending ${pending.promptType}: picks=[${pending.picks.join(',')}]  min=${pending.min}  max=${pending.max}${target}`);
        }
        for (let i = 0; i < legal.length; i++) {
          console.log(`  [${String(i).padStart(2)}] ${formatAction(legal[i])}`);
        }
      }

      let ans: string;
      if (scriptCommands) {
        if (scriptCursor >= scriptCommands.length) {
          console.log(`[trace] script exhausted at step ${traj.steps.length}. Saving and exiting.`);
          break;
        }
        ans = scriptCommands[scriptCursor++];
        console.log(`[step ${traj.steps.length}] legal=${legal.length} → pick '${ans}'`);
      } else {
        ans = (await rl!.question('pick [index|p|u|s|q]> ')).trim();
      }

      if (ans === 'q' || ans === 's') {
        console.log(`[trace] exiting. Trajectory saved to ${absOut}`);
        break;
      }
      if (ans === 'p') { printFieldState(adapter, handle); continue; }
      if (ans === 'u') {
        if (traj.steps.length === 0) { console.log('[trace] nothing to undo'); continue; }
        traj.steps.pop();
        saveTrajectory(absOut, traj);
        adapter.destroyAll();
        handle = initDuel(adapter, hand, deck);
        if (traj.steps.length > 0) {
          const r = replaySteps(adapter, handle, traj.steps);
          handle = r.handle;
          if (r.replayed < traj.steps.length) {
            console.log(`[trace] ⚠ undo caused drift at replay — truncating to ${r.replayed}`);
            traj.steps.length = r.replayed;
            saveTrajectory(absOut, traj);
          }
        }
        console.log(`[trace] undid step, now at step ${traj.steps.length}`);
        continue;
      }

      const idx = Number(ans);
      if (!Number.isInteger(idx) || idx < 0 || idx >= legal.length) {
        console.log(`[trace] invalid: expected integer in [0, ${legal.length - 1}] or p/u/s/q`);
        continue;
      }

      const chosen = legal[idx];
      const nameRow = cardDB.nameStmt.get(chosen.cardId) as { name: string } | undefined;
      const step: TrajectoryStep = {
        responseIndex: chosen.responseIndex,
        cardId: chosen.cardId,
        cardName: nameRow?.name ?? '',
        actionDescription: chosen.description ?? '',
      };
      adapter.applyAction(handle, chosen);
      traj.steps.push(step);
      saveTrajectory(absOut, traj);
      console.log(`  → applied rIdx=${chosen.responseIndex} ${step.cardName}  (saved ${absOut})`);
    }
  } finally {
    if (rl) rl.close();
    adapter.destroyAll();
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[trace] FATAL:', err);
  process.exit(1);
});
