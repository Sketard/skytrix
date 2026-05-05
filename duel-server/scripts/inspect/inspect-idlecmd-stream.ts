// =============================================================================
// inspect-idlecmd-stream.ts — replay a PvP `.raw-replay.json` directly via
// OCGCore and dump every SELECT_IDLECMD prompt with the full card-list
// breakdown (summons/special_summons/sets/activates/...) and the resolved
// PvP choice (cardId + cardName + verb).
//
// Outputs a JSONL stream where each line is one IDLECMD decision. Used to
// align PvP and plan trajectories step-by-step in post-hoc analyses.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
} from '@n1xx1/ocgcore-wasm';

import { DATA_DIR } from '../eval/evaluate-structural.js';
import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from '../../src/ocg-scripts.js';
import { createCardReader, createScriptReader } from '../../src/ocg-callbacks.js';

function parseArg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const rawReplayPath = parseArg('raw-replay');
const outPath = parseArg('out');
if (!rawReplayPath || !outPath) {
  console.error('[inspect-idlecmd] required: --raw-replay=<path> --out=<jsonl>');
  process.exit(2);
}

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

const ACTION_LABEL: Record<number, string> = {
  0: 'normal-summon',
  1: 'special-summon',
  2: 'pos-change',
  3: 'monster-set',
  4: 'spell-set',
  5: 'activate',
  6: 'to-bp',
  7: 'to-ep',
};
const ACTION_FIELD: Record<number, string> = {
  0: 'summons',
  1: 'special_summons',
  2: 'pos_changes',
  3: 'monster_sets',
  4: 'spell_sets',
  5: 'activates',
};

const raw = JSON.parse(readFileSync(resolve(rawReplayPath), 'utf-8')) as RawReplayFile;
if (raw.format !== 'raw-replay-v1') {
  console.error(`[inspect-idlecmd] unexpected format: ${raw.format}`);
  process.exit(2);
}

const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
const nameStmt = cardDB.nameStmt;
const nameCache = new Map<number, string>();
function getName(id: number): string {
  if (id <= 0) return '(none)';
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
let idleSeq = 0;
let turn = 0;
const lines: string[] = [];

const maxIterations = 5000;

mainLoop:
while (iter < maxIterations) {
  iter++;
  const status = (core as any).duelProcess(duel);
  const messages = (core as any).duelGetMessage(duel);

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const msgType = (m['type'] as number);
    if (msgType === OcgMessageType.NEW_TURN) {
      turn++;
      continue;
    }
    if (!isSelectPrompt(msgType)) continue;

    const expectedType = EXPECTED_RESPONSE_TYPE[msgType];

    // Snapshot IDLECMD enumerations before applying the response
    if (msgType === OcgMessageType.SELECT_IDLECMD && responseIdx < raw.steps.length) {
      const candidate = raw.steps[responseIdx].response as { type?: number; action?: number; index?: number };
      if (candidate.type === expectedType) {
        const promptPlayer = (m['player'] as number) ?? 0;
        const action = candidate.action ?? -1;
        const idx = candidate.index ?? -1;
        const fld = ACTION_FIELD[action];
        let chosenCardId = 0;
        let chosenCardName = '(none)';
        let chosenLoc: number | undefined;
        let chosenSeq: number | undefined;
        if (fld) {
          const arr = ((m[fld] ?? []) as { code: number; location?: number; sequence?: number }[]);
          if (idx >= 0 && idx < arr.length) {
            const c = arr[idx];
            chosenCardId = c.code;
            chosenCardName = getName(c.code);
            chosenLoc = c.location;
            chosenSeq = c.sequence;
          }
        }

        const enumeration: Record<string, Array<{ code: number; name: string; location?: number; sequence?: number }>> = {};
        for (const [k, fname] of Object.entries(ACTION_FIELD)) {
          const arr = ((m[fname] ?? []) as { code: number; location?: number; sequence?: number }[]);
          if (arr.length > 0) {
            enumeration[fname] = arr.map(c => ({ code: c.code, name: getName(c.code), location: c.location, sequence: c.sequence }));
          }
        }
        if (m['to_bp']) enumeration['to_bp'] = [];
        if (m['to_ep']) enumeration['to_ep'] = [];

        lines.push(JSON.stringify({
          idleSeq: idleSeq++,
          turn,
          stepIdx: raw.steps[responseIdx].stepIdx,
          promptPlayer,
          chosen: {
            action,
            actionLabel: ACTION_LABEL[action] ?? `action-${action}`,
            index: idx,
            cardId: chosenCardId,
            cardName: chosenCardName,
            location: chosenLoc,
            sequence: chosenSeq,
          },
          enumeration,
        }));
      }
    }

    // Apply captured response, or auto-respond
    if (responseIdx < raw.steps.length) {
      const candidate = raw.steps[responseIdx].response;
      const candidateType = (candidate['type'] as number);
      if (candidateType === expectedType) {
        (core as any).duelSetResponse(duel, candidate);
        responseIdx++;
        continue;
      }
    }
    const auto = autoRespond(m, msgType);
    if (auto) {
      (core as any).duelSetResponse(duel, auto);
      continue;
    }
    console.error(`[inspect-idlecmd] divergence at iter=${iter} responseIdx=${responseIdx} msgType=${msgType}`);
    break mainLoop;
  }

  if (status === OcgProcessResult.END) break;
}

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), lines.join('\n') + '\n', 'utf-8');
console.log(`[inspect-idlecmd] wrote ${lines.length} IDLECMD entries to ${outPath}`);
console.log(`[inspect-idlecmd] consumed ${responseIdx}/${raw.steps.length} captured responses`);

(core as any).destroyDuel(duel);
process.exit(0);
