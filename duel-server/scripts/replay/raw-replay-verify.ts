// =============================================================================
// raw-replay-verify.ts — replay a PvP `.raw-replay.json` directly through
// OCGCore (bypassing the solver adapter) and compute matched/score against
// the fixture's expectedBoard.
//
// Why bypass the adapter: the adapter auto-resolves mechanical sub-prompts
// (SELECT_PLACE/SELECT_POSITION/SELECT_CARD with single-choice etc.) via
// MechanicalDefaultOracle, picking deterministic defaults that may differ
// from the captured PvP responses (humans pick zone 4, default picks 0).
// For round-trip fidelity we need to feed each captured response verbatim
// to OCGCore.duelSetResponse, in raw-step order — no skipping, no matching.
//
// Pattern follows `replay-to-fixture.ts::runReplayOnCore` which validated
// snake-eye-yummy 7/7 round-trip 2026-04-19.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/raw-replay-verify.ts \
//     --raw-replay=../_bmad-output/planning-artifacts/research/trajectories/branded-dracotail-opener.raw-replay.json \
//     --fixture-id=branded-dracotail-opener \
//     --out=/tmp/branded-verify.json
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
} from '@n1xx1/ocgcore-wasm';

import {
  DATA_DIR,
  loadFixtureFile,
  type HandFixture,
} from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from '../../src/ocg-scripts.js';
import { createCardReader, createScriptReader } from '../../src/ocg-callbacks.js';

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const rawReplayPath = parseArg('raw-replay');
const fixtureId = parseArg('fixture-id');
const outPath = parseArg('out');
if (!rawReplayPath || !fixtureId || !outPath) {
  console.error('[verify] required: --raw-replay=<path> --fixture-id=<id> --out=<path>');
  process.exit(2);
}
const maxIterations = Number(parseArg('max-iterations') ?? '5000');

// B3 audit flag: override the captured ANNOUNCE_NUMBER response with a
// policy-driven value. Used to empirically verify whether the
// `MechanicalDefaultOracle.ANNOUNCE_NUMBER` default (`value = opts.length - 1`)
// matches the PvP replay's captured value, or whether it diverges.
//
// Values:
//   'verbatim' (default) — feed the captured response unchanged
//   'max'                — override to value = opts.length - 1 (adapter default)
//   'min'                — override to value = 0
//
// On divergence, the verifier logs the per-step diff (captured vs override)
// and reports the post-replay matched/score so we can quantify the impact.
const announcePolicy = parseArg('announce-policy') ?? 'verbatim';
if (!['verbatim', 'max', 'min'].includes(announcePolicy)) {
  console.error(`[verify] invalid --announce-policy=${announcePolicy} (allowed: verbatim, max, min)`);
  process.exit(2);
}
const announceLog: Array<{ stepIdx: number; options: number[]; capturedValue: number; appliedValue: number; overridden: boolean }> = [];

/** Optional prompt trace dump path (one JSONL line per prompt). When set,
 *  every prompt encountered by the OCGCore-direct loop is recorded with the
 *  prompt type, captured-PvP response, and any auto-respond fallback. The
 *  output format mirrors `replay-trajectory-cli`'s `responseTrace` so the
 *  trajectory-diff tool can align the two streams on a step-by-step basis.
 *  Each entry: { step, stepIdx, promptType, promptPlayer, response, source }
 *  where `source` is one of 'pvp' (captured raw-replay step) or 'auto' (RPS,
 *  initial OPTION fallback). */
const promptTracePath = parseArg('dump-prompt-trace');
const promptTrace: Array<{
  step: number;
  stepIdx: number | null;
  promptType: string;
  promptPlayer: number;
  response: Record<string, unknown>;
  source: 'pvp' | 'auto';
  options?: number[];
}> = [];

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

interface BoardEntry {
  zone: 'MZONE' | 'EMZ' | 'SZONE' | 'FIELD';
  sequence: number;
  cardId: number;
  cardName: string;
  position: 'attack' | 'defense' | 'set';
  overlayMaterials?: number[];
}

interface VerifyResult {
  fixtureId: string;
  rawReplayPath: string;
  expectedBoardSize: number;
  matched: number;
  matchedCardIds: number[];
  matchedCardNames: string[];
  missingCardIds: number[];
  missingCardNames: string[];
  unexpectedOnFieldCardIds: number[];
  unexpectedOnFieldCardNames: string[];
  finalBoardSelf: BoardEntry[];
  finalBoardOpp: BoardEntry[];
  rawStepsTotal: number;
  rawStepsConsumed: number;
  iterationsUsed: number;
  terminated: 'responses-exhausted' | 'duel-end' | 'max-iterations' | 'response-mismatch';
  divergence: string | null;
}

// -----------------------------------------------------------------------------
// Helpers (mirrored from replay-to-fixture.ts)
// -----------------------------------------------------------------------------
const EXPECTED_RESPONSE_TYPE: Partial<Record<number, number>> = {
  [OcgMessageType.SELECT_BATTLECMD]: 0,
  [OcgMessageType.SELECT_IDLECMD]: 1,
  [OcgMessageType.SELECT_EFFECTYN]: 2,
  [OcgMessageType.SELECT_YESNO]: 3,
  [OcgMessageType.SELECT_OPTION]: 4,
  [OcgMessageType.SELECT_CARD]: 5,
  [OcgMessageType.SELECT_UNSELECT_CARD]: 7,
  [OcgMessageType.SELECT_CHAIN]: 8,
  [OcgMessageType.SELECT_PLACE]: 10,
  [OcgMessageType.SELECT_DISFIELD]: 10,
  [OcgMessageType.SELECT_POSITION]: 11,
  [OcgMessageType.SELECT_TRIBUTE]: 12,
  [OcgMessageType.SELECT_COUNTER]: 13,
  [OcgMessageType.SELECT_SUM]: 14,
  [OcgMessageType.SORT_CARD]: 15,
  [OcgMessageType.SORT_CHAIN]: 15,
  [OcgMessageType.ANNOUNCE_RACE]: 16,
  [OcgMessageType.ANNOUNCE_ATTRIB]: 17,
  [OcgMessageType.ANNOUNCE_CARD]: 18,
  [OcgMessageType.ANNOUNCE_NUMBER]: 19,
  [OcgMessageType.ROCK_PAPER_SCISSORS]: 20,
};
function isSelectPrompt(type: number): boolean {
  return type in EXPECTED_RESPONSE_TYPE;
}
function autoRespond(_msg: Record<string, unknown>, msgType: number): Record<string, unknown> | null {
  switch (msgType) {
    case OcgMessageType.ROCK_PAPER_SCISSORS: {
      const playerIndex = (_msg['player'] as number) ?? 0;
      return { type: 20, value: playerIndex === 0 ? 1 : 3 };
    }
    case OcgMessageType.SELECT_OPTION:
      return { type: 4, index: 0 };
    default:
      return null;
  }
}
function queryZoneCard(core: any, duel: any, controller: 0 | 1, location: number, sequence: number): {
  code: number; position: number; overlay: number[];
} | null {
  const q = (flags: number) => core.duelQuery(duel, { flags, controller, location, sequence, overlaySequence: 0 }) as Record<string, unknown> | null;
  const codeInfo = q(OcgQueryFlags.CODE as number);
  const code = codeInfo ? (codeInfo['code'] as number | undefined) : undefined;
  if (!code) return null;
  const posInfo = q(OcgQueryFlags.POSITION as number);
  const position = posInfo ? ((posInfo['position'] as number) ?? 0) : 0;
  // Read overlay materials (XYZ overlays)
  const overlay: number[] = [];
  for (let oseq = 0; oseq < 8; oseq++) {
    const oi = core.duelQuery(duel, { flags: OcgQueryFlags.CODE as number, controller, location: OcgLocation.OVERLAY, sequence, overlaySequence: oseq }) as Record<string, unknown> | null;
    const ocode = oi ? (oi['code'] as number | undefined) : undefined;
    if (!ocode) break;
    overlay.push(ocode);
  }
  return { code, position, overlay };
}
function positionToString(pos: number): 'attack' | 'defense' | 'set' {
  if (pos === OcgPosition.FACEUP_ATTACK) return 'attack';
  if (pos === OcgPosition.FACEUP_DEFENSE) return 'defense';
  return 'set';
}
function captureBoard(core: any, duel: any, controller: 0 | 1, getName: (id: number) => string): BoardEntry[] {
  const out: BoardEntry[] = [];
  // MZONE seq 0-4 main monster zones, 5-6 EMZ
  for (let seq = 0; seq < 7; seq++) {
    const c = queryZoneCard(core, duel, controller, OcgLocation.MZONE, seq);
    if (c) out.push({
      zone: seq < 5 ? 'MZONE' : 'EMZ',
      sequence: seq,
      cardId: c.code,
      cardName: getName(c.code),
      position: positionToString(c.position),
      overlayMaterials: c.overlay.length > 0 ? c.overlay : undefined,
    });
  }
  // SZONE seq 0-4
  for (let seq = 0; seq < 5; seq++) {
    const c = queryZoneCard(core, duel, controller, OcgLocation.SZONE, seq);
    if (c) out.push({ zone: 'SZONE', sequence: seq, cardId: c.code, cardName: getName(c.code), position: positionToString(c.position) });
  }
  // FIELD zone
  const fz = queryZoneCard(core, duel, controller, OcgLocation.FZONE, 0);
  if (fz) out.push({ zone: 'FIELD', sequence: 0, cardId: fz.code, cardName: getName(fz.code), position: positionToString(fz.position) });
  return out;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
const raw = JSON.parse(readFileSync(resolve(rawReplayPath), 'utf-8')) as RawReplayFile;
if (raw.format !== 'raw-replay-v1') {
  console.error(`[verify] unexpected format: ${raw.format}`);
  process.exit(2);
}
console.log(`[verify] loaded ${raw.steps.length} raw steps from ${rawReplayPath}`);

const fixture = loadFixtureFile();
const hand: HandFixture | undefined = fixture.hands.find(h => h.id === fixtureId);
if (!hand) {
  console.error(`[verify] fixture ${fixtureId} not found in solver-validation-decks.json`);
  process.exit(2);
}

const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const nameStmt = cardDB.nameStmt;
const nameCache = new Map<number, string>();
function getName(id: number): string {
  if (id <= 0) return '';
  const cached = nameCache.get(id);
  if (cached !== undefined) return cached;
  const row = nameStmt.get(id) as { name?: string } | undefined;
  const name = row?.name ?? `#${id}`;
  nameCache.set(id, name);
  return name;
}

const core = await createCore({ sync: true } as never);
const seed: [bigint, bigint, bigint, bigint] = [
  BigInt(raw.seed[0]),
  BigInt(raw.seed[1]),
  BigInt(raw.seed[2]),
  BigInt(raw.seed[3]),
];
const duel = (core as any).createDuel({
  flags: OcgDuelMode.MODE_MR5,
  seed,
  team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
  team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
  cardReader: createCardReader(cardDB),
  scriptReader: createScriptReader(scripts),
  errorHandler: (_t: number, text: string) => {
    if (!text.includes('script not found')) console.error(`[OCG] ${text}`);
  },
});
if (!duel) throw new Error('createDuel failed');

for (const name of STARTUP_SCRIPTS) {
  const content = scripts.startupScripts.get(name);
  if (content) (core as any).loadScript(duel, name, content);
}

// Load both decks
for (let team = 0; team < 2; team++) {
  const d = raw.decks[team];
  for (const code of d.main) {
    (core as any).duelNewCard(duel, {
      code, team, duelist: 0, controller: team,
      location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  for (const code of d.extra) {
    (core as any).duelNewCard(duel, {
      code, team, duelist: 0, controller: team,
      location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
}

(core as any).startDuel(duel);

let responseIdx = 0;
let iter = 0;
let terminated: VerifyResult['terminated'] = 'max-iterations';
let divergence: string | null = null;

mainLoop:
while (iter < maxIterations) {
  iter++;
  const status = (core as any).duelProcess(duel);
  const messages = (core as any).duelGetMessage(duel);

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const msgType = (m['type'] as number);
    if (!isSelectPrompt(msgType)) continue;

    const expectedType = EXPECTED_RESPONSE_TYPE[msgType];

    let promptStepNum = promptTrace.length;
    // Try captured response first
    if (responseIdx < raw.steps.length) {
      const candidate = raw.steps[responseIdx].response;
      const candidateType = (candidate['type'] as number);
      if (candidateType === expectedType) {
        // B3 audit hook for ANNOUNCE_NUMBER
        let toFeed: Record<string, unknown> = candidate;
        if (msgType === OcgMessageType.ANNOUNCE_NUMBER) {
          const opts = (m['options'] as Array<bigint | number> | undefined) ?? [];
          const optsAsNumbers = opts.map(Number);
          const capturedValue = candidate['value'] as number;
          let appliedValue = capturedValue;
          let overridden = false;
          if (announcePolicy === 'max') {
            appliedValue = opts.length > 0 ? opts.length - 1 : 0;
            overridden = appliedValue !== capturedValue;
          } else if (announcePolicy === 'min') {
            appliedValue = 0;
            overridden = appliedValue !== capturedValue;
          }
          announceLog.push({
            stepIdx: raw.steps[responseIdx].stepIdx,
            options: optsAsNumbers,
            capturedValue,
            appliedValue,
            overridden,
          });
          if (overridden) {
            toFeed = { ...candidate, value: appliedValue };
          }
        }
        if (promptTracePath) {
          const opts = (m['options'] as Array<bigint | number> | undefined);
          promptTrace.push({
            step: promptStepNum,
            stepIdx: raw.steps[responseIdx].stepIdx,
            promptType: OcgMessageType[msgType] ?? `type${msgType}`,
            promptPlayer: (m['player'] as number) ?? -1,
            response: toFeed,
            source: 'pvp',
            options: opts ? opts.map(Number) : undefined,
          });
        }
        (core as any).duelSetResponse(duel, toFeed);
        responseIdx++;
        continue;
      }
    }

    // Fallback: auto-respond for prompts not captured (RPS, initial OPTION)
    const auto = autoRespond(m, msgType);
    if (auto) {
      if (promptTracePath) {
        promptTrace.push({
          step: promptStepNum,
          stepIdx: null,
          promptType: OcgMessageType[msgType] ?? `type${msgType}`,
          promptPlayer: (m['player'] as number) ?? -1,
          response: auto,
          source: 'auto',
        });
      }
      (core as any).duelSetResponse(duel, auto);
      continue;
    }

    // True mismatch — captured stream is exhausted or out of sync
    divergence = `iter=${iter} responseIdx=${responseIdx}/${raw.steps.length} prompt msgType=${msgType} (${OcgMessageType[msgType] ?? '?'}) expectedResponseType=${expectedType}, no captured/auto response available`;
    if (responseIdx >= raw.steps.length) {
      terminated = 'responses-exhausted';
    } else {
      const candidate = raw.steps[responseIdx].response;
      divergence += ` — next captured response.type=${candidate['type']} doesn't match expectedType=${expectedType}`;
      terminated = 'response-mismatch';
    }
    break mainLoop;
  }

  if (status === OcgProcessResult.END) {
    terminated = 'duel-end';
    break;
  }
}

// Capture final board state
const finalBoardSelf = captureBoard(core, duel, 0, getName);
const finalBoardOpp = captureBoard(core, duel, 1, getName);

const onFieldCardIds = new Set<number>();
for (const e of finalBoardSelf) {
  onFieldCardIds.add(e.cardId);
  if (e.overlayMaterials) for (const o of e.overlayMaterials) onFieldCardIds.add(o);
}

const expectedCardIds = (hand.expectedBoard ?? []).map(e => e.cardId);
const matchedCardIds = expectedCardIds.filter(id => onFieldCardIds.has(id));
const missingCardIds = expectedCardIds.filter(id => !onFieldCardIds.has(id));
const unexpectedOnFieldCardIds = [...onFieldCardIds].filter(id => !expectedCardIds.includes(id));

const result: VerifyResult = {
  fixtureId,
  rawReplayPath,
  expectedBoardSize: expectedCardIds.length,
  matched: matchedCardIds.length,
  matchedCardIds,
  matchedCardNames: matchedCardIds.map(getName),
  missingCardIds,
  missingCardNames: missingCardIds.map(getName),
  unexpectedOnFieldCardIds,
  unexpectedOnFieldCardNames: unexpectedOnFieldCardIds.map(getName),
  finalBoardSelf,
  finalBoardOpp,
  rawStepsTotal: raw.steps.length,
  rawStepsConsumed: responseIdx,
  iterationsUsed: iter,
  terminated,
  divergence,
};

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), JSON.stringify(result, null, 2) + '\n', 'utf-8');

if (promptTracePath) {
  const absT = resolve(promptTracePath);
  mkdirSync(dirname(absT), { recursive: true });
  const lines = promptTrace.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(absT, lines, 'utf-8');
  console.log(`[verify] wrote ${promptTrace.length} prompt-trace lines to ${absT}`);
}

console.log(`[verify] ────────────────────────────────────────────────`);
console.log(`[verify] fixtureId        = ${fixtureId}`);
console.log(`[verify] matched          = ${result.matched}/${result.expectedBoardSize}`);
console.log(`[verify] terminated       = ${terminated}`);
console.log(`[verify] iterations used  = ${iter}`);
console.log(`[verify] raw steps        = ${responseIdx}/${raw.steps.length}`);
if (divergence) console.log(`[verify] divergence       = ${divergence}`);
if (matchedCardIds.length > 0) {
  console.log(`[verify] matched cards:`);
  matchedCardIds.forEach(id => console.log(`           ✓ ${id} ${getName(id)}`));
}
if (missingCardIds.length > 0) {
  console.log(`[verify] missing cards:`);
  missingCardIds.forEach(id => console.log(`           ✗ ${id} ${getName(id)}`));
}
console.log(`[verify] final board (self):`);
finalBoardSelf.forEach(e => console.log(`           [${e.zone}-${e.sequence}] ${e.cardId} ${e.cardName} (${e.position})${e.overlayMaterials ? ` overlay=[${e.overlayMaterials.join(',')}]` : ''}`));
if (announceLog.length > 0) {
  console.log(`[verify] ANNOUNCE_NUMBER audit (policy=${announcePolicy}):`);
  announceLog.forEach(a => {
    const tag = a.overridden ? ` OVERRIDDEN: ${a.capturedValue}→${a.appliedValue}` : '';
    console.log(`           step=${a.stepIdx} options=[${a.options.join(',')}] applied=value:${a.appliedValue}${tag}`);
  });
}
console.log(`[verify] wrote ${outPath}`);

(core as any).destroyDuel(duel);
process.exit(divergence ? 1 : 0);
