// =============================================================================
// raw-replay-to-trajectory.ts — reduce a PvP `.raw-replay.json` to the
// adapter's decision-level representation (human-readable combo summary).
//
// ⚠ NOT ROUND-TRIP COMPATIBLE WITH `replay-trajectory.ts`. The adapter's
// initialization (explicit `hand`, `startingDrawCount=0`, 2-bigint seed
// → hardcoded fallback) produces a DIFFERENT engine state than PvP's
// (empty hand, `startingDrawCount=5`, full 4-bigint seed → shuffle+deal).
// Same 5 hand cards post-init, but the 35-card deck residue has a
// different order, so response indices drift as soon as a search/draw
// fires. Output is useful for inspecting the combo line at high level
// (24 key decisions out of 177 raw prompts for snake-eye-yummy), NOT
// for replaying in the solver.
//
// Round-trip would require either (a) extending the solver to support
// PvP-style init when fixture deckSeed has 4 bigints + empty hand, OR
// (b) reconstructing the post-shuffle deck residue in solver mode.
// See memory: project_replay_to_fixture_tool_2026_04_19.md.
//
// For Phase 5-lite behavior cloning: the raw-replay format itself is
// the training corpus. This converter is visualization only.
//
// Input format (produced by `replay-to-fixture.ts`):
//   { format: 'raw-replay-v1', seed: [4 bigint strings], decks: [{main,extra}×2],
//     steps: [{ promptType, promptPlayer, response, autoRespond }, ...] }
//
// Method: spin up OCGCoreAdapter in PvP-style mode (startingDrawCount=5,
// full 4-bigint seed, empty hand) so that opening state matches the replay
// exactly. At each player-0 prompt, enumerate adapter legalActions and
// match the raw-replay's captured response against each action's `_response`
// (canonical JSON compare). The matching action's responseIndex + cardId is
// the trajectory step. Opponent + mechanical prompts are auto-handled by
// the adapter (via `runUntilPlayerPrompt`).
//
// Usage:
//   cd duel-server
//   npx tsx scripts/raw-replay-to-trajectory.ts \
//     --in=../_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener.raw-replay.json \
//     --out=../_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener.summary.json \
//     --fixture-id=branded-dracotail-opener
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import Database from 'better-sqlite3';
import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import type { Action, DuelConfig } from '../src/solver/solver-types.js';

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const inPath = parseArg('in');
const outPath = parseArg('out');
const fixtureId = parseArg('fixture-id');
if (!inPath || !outPath || !fixtureId) {
  console.error('[convert] required: --in=<raw-replay.json> --out=<trajectory.json> --fixture-id=<id>');
  process.exit(2);
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
interface RawReplayStep {
  stepIdx: number;
  promptType: number;
  promptTypeName: string;
  promptPlayer: number;
  response: Record<string, unknown>;
  autoRespond: boolean;
}
interface RawReplayFile {
  format: string;
  fixtureId: string;
  seed: string[];
  decks: [{ main: number[]; extra: number[] }, { main: number[]; extra: number[] }];
  steps: RawReplayStep[];
}
interface TrajectoryStep {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
}
interface TrajectoryFile {
  fixtureId: string;
  description: string;
  sourceRawReplayPath: string;
  format: 'adapter-summary-v1';
  _warning: string;
  steps: TrajectoryStep[];
}

// -----------------------------------------------------------------------------
// Canonical response compare (handles key-order + bigint stability)
// -----------------------------------------------------------------------------
function canonical(obj: unknown): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj === 'bigint') return `${obj}n`;
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical((obj as Record<string, unknown>)[k])}`).join(',')}}`;
}

function responsesEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
const raw = JSON.parse(readFileSync(resolve(inPath), 'utf-8')) as RawReplayFile;
if (raw.format !== 'raw-replay-v1') {
  console.error(`[convert] unexpected format: ${raw.format}`);
  process.exit(2);
}
console.log(`[convert] loaded ${raw.steps.length} raw steps from ${inPath}`);

const DATA_DIR = resolve(import.meta.dirname!, '../data');
const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
// Separate read-only connection for name lookups via the `texts` table
// (cardDB.stmt queries `datas` only).
const nameDB = new Database(join(DATA_DIR, 'cards.cdb'), { readonly: true, fileMustExist: true });
const nameStmt = nameDB.prepare('SELECT name FROM texts WHERE id = ?');
const nameCache = new Map<number, string>();
function cardName(id: number): string {
  if (id <= 0) return '';
  const cached = nameCache.get(id);
  if (cached !== undefined) return cached;
  const row = nameStmt.get(id) as { name?: string } | undefined;
  const name = row?.name ?? '';
  nameCache.set(id, name);
  return name;
}
const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

// Seed conversion: 4-bigint PvP seed → adapter deckSeed
const seed4 = raw.seed.map(s => BigInt(s));

// Construct DuelConfig in PvP-style: empty hand, full main deck, startingDrawCount=5
const duelConfig: DuelConfig = {
  hand: [],
  mainDeck: [...raw.decks[0].main],
  extraDeck: raw.decks[0].extra,
  deckSeed: seed4,
  opponentDeck: [...raw.decks[1].main],
  startingDrawCount: 5,
  drawCountPerTurn: 1,
};

const handle = adapter.createDuel(duelConfig);

const steps: TrajectoryStep[] = [];
const unmatchedLog: string[] = [];
let rawIdx = 0;
let adapterPromptCount = 0;
const MAX_ITER = 2000;
let iter = 0;

while (iter++ < MAX_ITER) {
  let actions: Action[];
  try {
    actions = adapter.getLegalActions(handle);
  } catch (err) {
    unmatchedLog.push(`iter=${iter}: getLegalActions threw — ${String(err)}`);
    break;
  }
  if (!actions || actions.length === 0) {
    // Adapter signaled duel end
    console.log(`[convert] adapter returned 0 actions at iter=${iter} — duel ended`);
    break;
  }
  adapterPromptCount++;

  // Consume raw steps until we find one matching an adapter action.
  // Raw steps may include opponent prompts the adapter auto-handled.
  let matched: Action | null = null;
  let consumedRawForThisPrompt = 0;
  while (rawIdx < raw.steps.length) {
    const rawStep = raw.steps[rawIdx];
    matched = actions.find(a => responsesEqual(a._response, rawStep.response)) ?? null;
    if (matched) {
      rawIdx++;
      consumedRawForThisPrompt++;
      break;
    }
    // No match for this raw step at this adapter prompt — the adapter likely
    // auto-handled an opponent prompt that the raw captured too. Skip the raw
    // step, try next. If we fall through all raw without match, we have a
    // real divergence.
    rawIdx++;
    consumedRawForThisPrompt++;
  }

  if (!matched) {
    // Exhausted raw steps without finding a match. That's either the end of
    // the user's captured actions or a true divergence.
    unmatchedLog.push(
      `iter=${iter} rawIdx=${rawIdx}/${raw.steps.length} no match (adapter has ${actions.length} actions but raw stream exhausted or diverged)`,
    );
    break;
  }

  steps.push({
    responseIndex: matched.responseIndex,
    cardId: matched.cardId,
    cardName: cardName(matched.cardId),
    actionDescription: matched.description ?? '',
  });

  try {
    adapter.applyAction(handle, matched);
  } catch (err) {
    unmatchedLog.push(`iter=${iter}: applyAction threw — ${String(err)}`);
    break;
  }
}

console.log(`[convert] produced ${steps.length} trajectory steps`);
console.log(`[convert] adapter prompts encountered: ${adapterPromptCount}`);
console.log(`[convert] raw steps consumed: ${rawIdx}/${raw.steps.length}`);
if (unmatchedLog.length > 0) {
  console.log('[convert] divergence log:');
  for (const l of unmatchedLog.slice(0, 10)) console.log(`  ${l}`);
}

const out: TrajectoryFile = {
  fixtureId,
  description: `Auto-converted from ${raw.fixtureId}.raw-replay.json — ${steps.length} adapter-level steps (decision summary of ${raw.steps.length} raw responses)`,
  sourceRawReplayPath: inPath,
  format: 'adapter-summary-v1',
  _warning: 'NOT replayable via scripts/replay-trajectory.ts — solver init differs from PvP init (deck residue order drift). Human-readable summary only.',
  steps,
};

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log(`[convert] wrote ${outPath}`);

adapter.destroyAll();
process.exit(0);
