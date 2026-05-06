// dump-replay-events.ts — replay a captured duel and print MSG_CHAIN_*/MSG_MOVE
// trace to confirm Doom Queen Dark Contract freeze diagnosis.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/dump-replay-events.ts <replay-uuid>

import createCore, {
  OcgDuelMode, OcgLocation, OcgPosition, OcgProcessResult, OcgMessageType, OcgQueryFlags,
} from '@n1xx1/ocgcore-wasm';
import { resolve, join } from 'node:path';
import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from '../../src/ocg-scripts.js';
import { createCardReader, createScriptReader } from '../../src/ocg-callbacks.js';

const REPLAY_ID = process.argv[2];
if (!REPLAY_ID) {
  console.error('Usage: npx tsx scripts/dump-replay-events.ts <replay-uuid>');
  process.exit(1);
}

const API_URL = 'http://localhost:8080/api';
const API_KEY = 'dev-internal-key';

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

function autoRespond(msg: Record<string, unknown>, msgType: number): Record<string, unknown> | null {
  switch (msgType) {
    case OcgMessageType.ROCK_PAPER_SCISSORS: {
      const playerIndex = (msg['player'] as number) ?? 0;
      return { type: 20, value: playerIndex === 0 ? 1 : 3 };
    }
    case OcgMessageType.SELECT_OPTION:
      return { type: 4, index: 0 };
    default:
      return null;
  }
}

const TRACE_TYPES = new Set([
  OcgMessageType.NEW_TURN,
  OcgMessageType.NEW_PHASE,
  OcgMessageType.CHAINING,
  OcgMessageType.CHAIN_SOLVING,
  OcgMessageType.CHAIN_SOLVED,
  OcgMessageType.CHAIN_END,
  OcgMessageType.CHAIN_NEGATED,
  OcgMessageType.MOVE,
  OcgMessageType.SUMMONING,
  OcgMessageType.SUMMONED,
  OcgMessageType.SPSUMMONING,
  OcgMessageType.SPSUMMONED,
  OcgMessageType.DRAW,
  OcgMessageType.DAMAGE,
  OcgMessageType.PAY_LPCOST,
  OcgMessageType.RECOVER,
  OcgMessageType.SET,
]);

async function main() {
  const url = `${API_URL}/internal/replays/${REPLAY_ID}`;
  const res = await fetch(url, { headers: { 'X-Internal-Key': API_KEY } });
  if (!res.ok) throw new Error(`Replay fetch failed: HTTP ${res.status}`);
  const replay = await res.json() as any;

  const dataDir = resolve(import.meta.dirname!, '..', '..', '..', 'data');
  const cardDB = loadDatabase(join(dataDir, 'cards.cdb'));
  const scripts = loadScripts(join(dataDir, 'scripts_full'));
  const core = await createCore({ sync: true } as never);

  const seedRaw = replay.replayData.seed.map((s: string) => BigInt(s)) as bigint[];
  const seed: [bigint, bigint, bigint, bigint] = [seedRaw[0], seedRaw[1], seedRaw[2], seedRaw[3]];

  const duel = core.createDuel({
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
    if (content) core.loadScript(duel, name, content);
  }

  for (let team = 0; team < 2; team++) {
    const deck = replay.replayData.decks[team];
    for (const code of deck.main) {
      core.duelNewCard(duel, {
        code, team, duelist: 0, controller: team,
        location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
    for (const code of deck.extra) {
      core.duelNewCard(duel, {
        code, team, duelist: 0, controller: team,
        location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
      });
    }
  }
  core.startDuel(duel);

  const responses = replay.replayData.playerResponses;
  let responseIdx = 0;
  let iter = 0;
  const maxIter = 5000;

  const isSelectPrompt = (t: number) => t in EXPECTED_RESPONSE_TYPE;

  while (iter < maxIter) {
    iter++;
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const msgType = m['type'] as number;
      const name = OcgMessageType[msgType] ?? `type${msgType}`;

      if (TRACE_TYPES.has(msgType)) {
        const compact = { ...m };
        delete (compact as any)['type'];
        console.log(`[#${iter}] ${name}`, JSON.stringify(compact, (_k, v) => typeof v === 'bigint' ? `${v}n` : v));
      }

      // After every SPSUMMONED / SUMMONED, dump MZONE overlays for both players
      if (msgType === OcgMessageType.SPSUMMONED || msgType === OcgMessageType.SUMMONED) {
        const field = core.duelQueryField(duel) as any;
        for (const ctrl of [0, 1] as const) {
          const monsters = field.players?.[ctrl]?.monsters ?? [];
          for (let seq = 0; seq < monsters.length; seq++) {
            const m = monsters[seq];
            if (!m) continue;
            const codeQ = core.duelQuery(duel, { flags: OcgQueryFlags.CODE as number, controller: ctrl, location: OcgLocation.MZONE, sequence: seq, overlaySequence: 0 } as never) as any;
            const ovQ = core.duelQuery(duel, { flags: OcgQueryFlags.OVERLAY_CARD as number, controller: ctrl, location: OcgLocation.MZONE, sequence: seq, overlaySequence: 0 } as never) as any;
            const tgQ = core.duelQuery(duel, { flags: OcgQueryFlags.TARGET_CARD as number, controller: ctrl, location: OcgLocation.MZONE, sequence: seq, overlaySequence: 0 } as never) as any;
            console.log(`     [overlay-state] P${ctrl} M${seq+1} card=${codeQ?.code} mat=${m.materials} OVERLAY_keys=${ovQ?Object.keys(ovQ).join(','):null} TARGET_keys=${tgQ?Object.keys(tgQ).join(','):null} ovQ=${JSON.stringify(ovQ)} tgQ=${JSON.stringify(tgQ)}`);
            // Try querying each overlay slot directly
            for (let oseq = 0; oseq < (m.materials ?? 0); oseq++) {
              const oq = core.duelQuery(duel, { flags: OcgQueryFlags.CODE as number, controller: ctrl, location: OcgLocation.MZONE, sequence: seq, overlaySequence: oseq } as never) as any;
              console.log(`        slot[${oseq}] code=${oq?.code}`);
            }
          }
        }
      }

      // Dump SELECT_IDLECMD payload to inspect activate-vs-pendulum-summon mapping
      if (msgType === OcgMessageType.SELECT_IDLECMD) {
        const compact: any = {
          summons: m.summons?.map((c: any) => ({ code: c.code, loc: c.location, seq: c.sequence })),
          special_summons: m.special_summons?.map((c: any) => ({ code: c.code, loc: c.location, seq: c.sequence })),
          pos_changes: m.pos_changes?.map((c: any) => ({ code: c.code, loc: c.location, seq: c.sequence })),
          monster_sets: m.monster_sets?.map((c: any) => ({ code: c.code, loc: c.location, seq: c.sequence })),
          spell_sets: m.spell_sets?.map((c: any) => ({ code: c.code, loc: c.location, seq: c.sequence })),
          activates: m.activates?.map((c: any) => ({ code: c.code, loc: c.location, seq: c.sequence, desc: String(c.description) })),
        };
        console.log(`     [idle-cmd]`, JSON.stringify(compact, (_k, v) => typeof v === 'bigint' ? `${v}n` : v));
      }

      if (!isSelectPrompt(msgType)) continue;

      const expectedType = EXPECTED_RESPONSE_TYPE[msgType];
      const captured = responseIdx < responses.length ? responses[responseIdx].data : null;
      const capturedMatches = captured && (captured['type'] as number) === expectedType;
      let response: Record<string, unknown> | null;
      if (capturedMatches) {
        response = captured;
        console.log(`  -> ${name} response[${responseIdx}]:`, JSON.stringify(captured));
        responseIdx++;
      } else {
        response = autoRespond(m, msgType);
        if (!response) {
          console.log(`  -> ${name} END (no response, idx=${responseIdx}/${responses.length})`);
          core.destroyDuel(duel);
          cardDB.db.close();
          return;
        }
        console.log(`  -> ${name} auto:`, JSON.stringify(response));
      }
      core.duelSetResponse(duel, response);
    }

    if (status === OcgProcessResult.END) {
      console.log('[duel ended]');
      break;
    }
    if (responseIdx >= responses.length) {
      // Drain: keep iterating to see what the engine emits next, auto-respond
      // to anything still pending (forces progression past the freeze point).
      const pending = messages.filter(mm => isSelectPrompt((mm as Record<string, unknown>)['type'] as number));
      if (pending.length === 0 && status === OcgProcessResult.END) break;
      // After exhaust, just drain a few more iterations
      if (iter > 1000) { console.log('[draining cap reached]'); break; }
    }
  }
  core.destroyDuel(duel);
  cardDB.db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
