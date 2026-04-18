// =============================================================================
// replay-trajectory.ts — replay a canonical-combo trajectory in OCGCore.
//
// Consumes a trajectory file (produced by `scripts/record-trajectory.ts` or
// hand-authored) and replays each step against a fresh OCGCore duel. Verifies
// bit-exact reproducibility by checking that `legalActions[step.responseIndex]`
// has the same cardId as stored in the step (drift detection: a scripts/CDB
// update that re-orders OCGCore options surfaces here rather than silently).
//
// At the end, the peak FieldState is matched against the fixture's
// `expectedBoard` using the same zone/position rubric as
// `evaluate-structural.ts` (zone-aware matcher, position enforcement).
//
// Usage:
//   cd duel-server
//   SOLVER_INSTRUMENT=1 npx tsx scripts/replay-trajectory.ts \
//     --trajectory=data/trajectories/ryzeal-mitsurugi-opener.json
//
// Exit 0 if replay completes AND endboard matches. Exit 1 on any divergence.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DATA_DIR,
  loadFixtureFile,
  type FixtureFile,
  type HandFixture,
} from './evaluate-structural.js';
import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import type { DuelConfig, FieldCard } from '../src/solver/solver-types.js';
import { join } from 'node:path';

export interface TrajectoryStep {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
  annotation?: string;
}

export interface TrajectoryFile {
  fixtureId: string;
  description: string;
  /** The cardId hint sequence the recorder consumed to derive `steps`.
   *  Kept for audit trail; ignored at replay time (steps are authoritative). */
  canonicalPathHint?: number[];
  steps: TrajectoryStep[];
}

const MZONE_EXPANSION = new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R']);
const SZONE_EXPANSION = new Set(['S1', 'S2', 'S3', 'S4', 'S5']);

function zoneMatches(expectedZone: string, actualZone: string): boolean {
  if (expectedZone === actualZone) return true;
  if (expectedZone === 'MZONE') return MZONE_EXPANSION.has(actualZone);
  if (expectedZone === 'SZONE') return SZONE_EXPANSION.has(actualZone);
  return false;
}

function positionMatches(
  expectedPosition: 'attack' | 'defense' | 'set' | undefined,
  actualPosition: string,
): boolean {
  if (!expectedPosition) return true;
  if (expectedPosition === 'attack') return actualPosition === 'faceup-atk';
  if (expectedPosition === 'defense') return actualPosition === 'faceup-def';
  if (expectedPosition === 'set') {
    return actualPosition === 'facedown' || actualPosition === 'facedown-def';
  }
  return false;
}

function findHand(fixture: FixtureFile, id: string): HandFixture {
  const hand = fixture.hands.find(h => h.id === id);
  if (!hand) throw new Error(`[replay] fixture '${id}' not found`);
  if (hand._draft === true) throw new Error(`[replay] fixture '${id}' is marked _draft`);
  return hand;
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const trajectoryPath = parseStringArg('trajectory');
  if (!trajectoryPath) {
    console.error('[replay] --trajectory=<path> required');
    process.exit(2);
  }

  const absTraj = resolve(trajectoryPath);
  const traj = JSON.parse(readFileSync(absTraj, 'utf-8')) as TrajectoryFile;
  console.log(`[replay] trajectory=${absTraj}`);
  console.log(`[replay] fixture=${traj.fixtureId}  steps=${traj.steps.length}  ${traj.description ? `(${traj.description})` : ''}`);

  const fixture = loadFixtureFile();
  const hand = findHand(fixture, traj.fixtureId);
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`[replay] deck '${hand.deck}' not found`);

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  try {
    const mainDeck = [...deck.main];
    for (const cid of hand.hand) {
      const idx = mainDeck.indexOf(cid);
      if (idx === -1) throw new Error(`[replay] hand card ${cid} not in main deck`);
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
    const handle = adapter.createDuel(duelConfig);

    let driftDetected = false;
    for (let i = 0; i < traj.steps.length; i++) {
      const step = traj.steps[i];
      const legal = adapter.getLegalActions(handle);

      if (legal.length === 0) {
        console.error(`[replay] step ${i}: no legal actions available (trajectory expected ${step.cardId} ${step.cardName})`);
        process.exit(1);
      }

      // Match by (responseIndex, cardId) tuple. `responseIndex` alone is not
      // always a 0-based array index — SELECT_CHAIN uses `-1` as the "pass"
      // sentinel, and some OCGCore prompts reuse indices across the legal
      // pool. The cardId narrows to the right option.
      const matches = legal.filter(a => a.responseIndex === step.responseIndex && a.cardId === step.cardId);
      if (matches.length === 0) {
        console.error(`[replay] step ${i}: DRIFT — no legal action has (responseIndex=${step.responseIndex}, cardId=${step.cardId}/${step.cardName})`);
        const byCardId = legal.filter(a => a.cardId === step.cardId);
        if (byCardId.length > 0) {
          console.error(`[replay]   hint: cardId=${step.cardId} is present at responseIndex=[${byCardId.map(a => a.responseIndex).join(', ')}] — re-record trajectory`);
        } else {
          console.error(`[replay]   hint: cardId=${step.cardId} is NOT in the current legal-action pool — state diverged earlier, replay broken`);
        }
        driftDetected = true;
        process.exit(1);
      }
      const action = matches[0];

      const annotation = step.annotation ? ` [${step.annotation}]` : '';
      console.log(`[replay] step ${i}: rIdx=${step.responseIndex} ${step.cardName} — ${step.actionDescription}${annotation}`);
      adapter.applyAction(handle, action);
    }

    // Terminal — compare fieldState to fixture.expectedBoard if present.
    const fieldState = adapter.getFieldState(handle);
    const expected = hand.expectedBoard ?? [];
    if (expected.length === 0) {
      console.log(`[replay] no expectedBoard on fixture; replay completed ${traj.steps.length} steps without drift.`);
      adapter.destroyAll();
      process.exit(0);
    }

    const matched: number[] = [];
    const missing: string[] = [];
    for (const e of expected) {
      let found = false;
      let foundElsewhere: { zone: string; position: string } | null = null;
      for (const [zoneName, zs] of Object.entries(fieldState.zones)) {
        for (const c of zs as FieldCard[]) {
          if (c.cardId !== e.cardId) continue;
          if (!foundElsewhere) foundElsewhere = { zone: zoneName, position: c.position };
          if (!zoneMatches(e.zone, zoneName)) continue;
          if (!positionMatches(e.position, c.position)) continue;
          found = true;
          break;
        }
        if (found) break;
      }
      if (found) matched.push(e.cardId);
      else {
        const expectedDesc = `${e.zone}${e.position ? `/${e.position}` : ''}`;
        missing.push(foundElsewhere
          ? `${e.cardId} ${e.cardName} — expected ${expectedDesc}, actual ${foundElsewhere.zone}/${foundElsewhere.position}`
          : `${e.cardId} ${e.cardName} — expected ${expectedDesc}, NOT ON FIELD`);
      }
    }

    console.log(`\n[replay] ═══ ENDBOARD MATCH ═══`);
    console.log(`[replay] matched=${matched.length}/${expected.length}`);
    if (missing.length > 0) {
      console.log(`[replay] MISS:`);
      for (const m of missing) console.log(`  ${m}`);
    }

    adapter.destroyAll();
    if (matched.length === expected.length && !driftDetected) {
      console.log(`[replay] PASS`);
      process.exit(0);
    } else {
      console.log(`[replay] FAIL: ${expected.length - matched.length} missing endboard piece(s)`);
      process.exit(1);
    }
  } catch (err) {
    adapter.destroyAll();
    throw err;
  }
}

main().catch(err => {
  console.error('[replay] FATAL:', err);
  process.exit(2);
});
