// =============================================================================
// diagnose-ip-block.ts — synthetic minimal repro of the I:P SS block at
// snake-eye-yummy-opener step ~86.
//
// Builds the step-86 board directly via `duelNewCard` (pre-`startDuel`),
// starts the duel, auto-responds through the initial prompts until P0's
// first SELECT_IDLECMD, then DUMPS the raw prompt payload:
//   - `special_summons` list (where I:P should appear but doesn't)
//   - any subsequent SELECT_PLACE field_mask (hex + decoded)
//
// Goal: measure what OCGCore considers "a legal Link-SS target zone" in
// the blocked state, so we can compare against the Link-arrow convention
// encoded in `link-arrows.json` + the MR5 EMZ rule.
//
// Usage:
//   cd duel-server
//   npx tsx scripts/diagnose-ip-block.ts [--variant=baseline|no-silhouhatte|m2-free]
//
// The baseline variant reproduces step 86 exactly. Other variants mutate
// one board parameter to isolate which factor drives the block.
// =============================================================================

import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgMessageType,
  OcgQueryFlags,
} from '@n1xx1/ocgcore-wasm';
import { join, resolve } from 'node:path';
import { loadDatabase, loadScripts, STARTUP_SCRIPTS } from '../../src/ocg-scripts.js';
import { createCardReader, createScriptReader } from '../../src/ocg-callbacks.js';
import { decodeFieldMask } from '../../src/solver/ocg-field-query.js';

// --- Card IDs (from cards.cdb, verified) ---
const I_P_MASQUERENA = 65741786;
const SILHOUHATTE_RABBIT = 1528054;
const LINKURIBOH = 41999284;
const CUPSY_YW = 31603289;
const LOLLIPO_YW = 93192592;
const DIABELLSTAR_BLACK_WITCH = 72270339; // main-deck, non-Link
const SNAKE_EYES_DOOMED_DRAGON = 58071334; // Fusion, non-Link
const SNAKE_EYE_ASH = 9674034;            // Level 1, non-Link
const ALEXANDRITE_DRAGON = 38232082;      // fallback non-Link for filler
const FILLER_OPP_DECK = 38232082;          // opponent deck filler

// --- Positions ---
const P0 = 0;
const P1 = 1;
const MZ = OcgLocation.MZONE;
const EZ = OcgLocation.EXTRA;
const DECK = OcgLocation.DECK;
const HAND = OcgLocation.HAND;

// --- Zone sequence map (P0 side) ---
// M1..M5 = seq 0..4 ; EMZ_L = 5 ; EMZ_R = 6
const SEQ = { M1: 0, M2: 1, M3: 2, M4: 3, M5: 4, EMZ_L: 5, EMZ_R: 6 } as const;

type Variant = 'baseline' | 'no-silhouhatte' | 'm2-free' | 'linkuriboh-emz' | 'proper-link-summon' | 'm1-free' | 'm3-free' | 'silhouhatte-in-m4' | 'p1-silhouhatte-emz-l';
function parseVariant(): Variant {
  const arg = process.argv.find(a => a.startsWith('--variant='));
  const v = arg?.slice('--variant='.length) ?? 'baseline';
  const allowed: Variant[] = ['baseline', 'no-silhouhatte', 'm2-free', 'linkuriboh-emz', 'proper-link-summon', 'm1-free', 'm3-free', 'silhouhatte-in-m4', 'p1-silhouhatte-emz-l'];
  if (!allowed.includes(v as Variant)) {
    throw new Error(`Unknown variant: ${v}`);
  }
  return v as Variant;
}

interface FieldLayout {
  description: string;
  mzone: Array<{ seq: number; code: number }>;
  /** Optional: cards to pre-place on P1's MZONE (team=1, controller=1). */
  p1Mzone?: Array<{ seq: number; code: number }>;
  extra: number[];
  hand: number[];
}

function buildLayout(variant: Variant): FieldLayout {
  const baseExtra = [I_P_MASQUERENA, SILHOUHATTE_RABBIT, LINKURIBOH];
  const baseHand = [SNAKE_EYE_ASH]; // keep hand non-empty; unrelated to the check
  switch (variant) {
    case 'baseline':
      return {
        description: 'step-86 board: Silhouhatte EMZ_L + 4 non-Link monsters M1..M3,M5',
        mzone: [
          { seq: SEQ.M1, code: CUPSY_YW },
          { seq: SEQ.M2, code: LOLLIPO_YW },
          { seq: SEQ.M3, code: DIABELLSTAR_BLACK_WITCH },
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
          { seq: SEQ.EMZ_L, code: SILHOUHATTE_RABBIT },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
    case 'no-silhouhatte':
      return {
        description: 'baseline minus Silhouhatte (no Link in any P0 zone)',
        mzone: [
          { seq: SEQ.M1, code: CUPSY_YW },
          { seq: SEQ.M2, code: LOLLIPO_YW },
          { seq: SEQ.M3, code: DIABELLSTAR_BLACK_WITCH },
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
    case 'm2-free':
      return {
        description: 'baseline but M2 empty — Silhouhatte BL arrow from EMZ_L points to M2',
        mzone: [
          { seq: SEQ.M1, code: CUPSY_YW },
          // M2 intentionally empty
          { seq: SEQ.M3, code: DIABELLSTAR_BLACK_WITCH },
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
          { seq: SEQ.EMZ_L, code: SILHOUHATTE_RABBIT },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
    case 'linkuriboh-emz':
      return {
        description: 'baseline with Linkuriboh (arrow B) in EMZ_L instead of Silhouhatte',
        mzone: [
          { seq: SEQ.M1, code: CUPSY_YW },
          { seq: SEQ.M2, code: LOLLIPO_YW },
          { seq: SEQ.M3, code: DIABELLSTAR_BLACK_WITCH },
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
          { seq: SEQ.EMZ_L, code: LINKURIBOH },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
    case 'proper-link-summon':
      // No Silhouhatte on field — we will Link-summon her properly at the first
      // IDLECMD, then check I:P availability at the second IDLECMD. This rules
      // out any weirdness from duelNewCard placing a Link card directly onto
      // MZONE (which skips the normal summon flow and may not set EMZ-ownership
      // flags the engine expects).
      return {
        description: 'Silhouhatte NOT direct-placed — Link-summoned properly at 1st IDLECMD, then check I:P at 2nd IDLECMD',
        mzone: [
          { seq: SEQ.M1, code: CUPSY_YW },
          { seq: SEQ.M2, code: LOLLIPO_YW },
          { seq: SEQ.M3, code: DIABELLSTAR_BLACK_WITCH },
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
    case 'm1-free':
      return {
        description: 'baseline but M1 empty — if Silhouhatte BL from EMZ_L → M1, I:P gets a free+linked MZone',
        mzone: [
          // M1 intentionally empty
          { seq: SEQ.M2, code: LOLLIPO_YW },
          { seq: SEQ.M3, code: DIABELLSTAR_BLACK_WITCH },
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
          { seq: SEQ.EMZ_L, code: SILHOUHATTE_RABBIT },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
    case 'm3-free':
      return {
        description: 'baseline but M3 empty — if Silhouhatte BR from EMZ_L → M3, I:P gets a free+linked MZone',
        mzone: [
          { seq: SEQ.M1, code: CUPSY_YW },
          { seq: SEQ.M2, code: LOLLIPO_YW },
          // M3 intentionally empty
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
          { seq: SEQ.EMZ_L, code: SILHOUHATTE_RABBIT },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
    case 'silhouhatte-in-m4':
      // Silhouhatte on field but in a Main Monster Zone (NOT EMZ). If I:P is
      // offered here, the block is specifically "P0 Link in EMZ". If still
      // blocked, "P0 Link anywhere" blocks I:P (would be a stronger/weirder rule).
      return {
        description: 'Silhouhatte in M4 (main zone, not EMZ) — both EMZ slots free',
        mzone: [
          { seq: SEQ.M1, code: CUPSY_YW },
          { seq: SEQ.M2, code: LOLLIPO_YW },
          { seq: SEQ.M3, code: DIABELLSTAR_BLACK_WITCH },
          { seq: SEQ.M4, code: SILHOUHATTE_RABBIT },
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
    case 'p1-silhouhatte-emz-l':
      // P1 controls Silhouhatte in EMZ_L. P0 has 4 non-Link on field + I:P in
      // Extra. If OCGCore handles arrow orientation per-controller correctly,
      // P1's BL+BR from EMZ_L should geometrically link P0's M-zones (since
      // P1 views the board rotated 180°). If so, I:P should find linked
      // landing zones on P0 side. Opposite outcome = arrow/ownership mismatch.
      return {
        description: 'P1 owns Silhouhatte in EMZ_L — test if her arrows link P0 MZones (cross-control)',
        mzone: [
          { seq: SEQ.M1, code: CUPSY_YW },
          { seq: SEQ.M2, code: LOLLIPO_YW },
          { seq: SEQ.M3, code: DIABELLSTAR_BLACK_WITCH },
          { seq: SEQ.M5, code: SNAKE_EYES_DOOMED_DRAGON },
        ],
        p1Mzone: [
          { seq: SEQ.EMZ_L, code: SILHOUHATTE_RABBIT },
        ],
        extra: baseExtra,
        hand: baseHand,
      };
  }
}

function fmtMask(mask: number): string {
  // 32-bit mask, 16 bits per player. Print both halves with zone labels.
  const decodeHalf = (halfBits: number, label: string): string => {
    const labels = ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R', '_', 'S1', 'S2', 'S3', 'S4', 'S5', 'FZONE', 'PZ_L', 'PZ_R'];
    const blocked: string[] = [];
    const free: string[] = [];
    for (let b = 0; b < 16; b++) {
      if (labels[b] === '_') continue;
      if (halfBits & (1 << b)) blocked.push(labels[b]);
      else free.push(labels[b]);
    }
    return `${label}{free=[${free.join(',')}] blocked=[${blocked.join(',')}]}`;
  };
  return `0x${(mask >>> 0).toString(16).padStart(8, '0')} ` +
    decodeHalf(mask & 0xFFFF, 'P0') + ' ' +
    decodeHalf((mask >> 16) & 0xFFFF, 'P1');
}

function fmtPlace(p: { player: number; location: number; sequence: number }): string {
  const side = p.player === P0 ? 'P0' : 'P1';
  if (p.location === MZ) {
    if (p.sequence < 5) return `${side}/M${p.sequence + 1}`;
    if (p.sequence === 5) return `${side}/EMZ_L`;
    return `${side}/EMZ_R`;
  }
  if (p.location === OcgLocation.SZONE) return `${side}/S${p.sequence + 1}`;
  if (p.location === OcgLocation.FZONE) return `${side}/FZONE`;
  return `${side}/loc${p.location}seq${p.sequence}`;
}

async function main(): Promise<void> {
  const variant = parseVariant();
  const layout = buildLayout(variant);
  console.log(`\n=== diagnose-ip-block variant=${variant} ===`);
  console.log(`    ${layout.description}\n`);

  const DATA_DIR = resolve(import.meta.dirname!, '..', '..', '..', 'data');
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const core = await createCore({ sync: true });

  const duel = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: [1n, 2n, 3n, 4n],
    team1: { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 1 },
    cardReader: createCardReader(cardDB),
    scriptReader: createScriptReader(scripts),
    errorHandler: (_t, text) => { if (!text.includes('script not found')) console.error(`   [OCG] ${text}`); },
  });
  if (!duel) throw new Error('createDuel failed');

  // Load startup Lua
  for (const name of STARTUP_SCRIPTS) {
    const content = scripts.startupScripts.get(name);
    if (content) core.loadScript(duel, name, content);
  }

  // === P0 setup ===
  // Hand (minimal — keep the duel from ending via deck-out on draw step)
  for (const code of layout.hand) {
    core.duelNewCard(duel, {
      code, team: P0, duelist: 0, controller: P0,
      location: HAND, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  // Main deck filler — need >= drawCountPerTurn cards to survive draw phase
  for (let i = 0; i < 40; i++) {
    core.duelNewCard(duel, {
      code: ALEXANDRITE_DRAGON, team: P0, duelist: 0, controller: P0,
      location: DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  // Extra deck — the Links we care about
  for (const code of layout.extra) {
    core.duelNewCard(duel, {
      code, team: P0, duelist: 0, controller: P0,
      location: EZ, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }
  // MZONE direct-placement
  for (const { seq, code } of layout.mzone) {
    core.duelNewCard(duel, {
      code, team: P0, duelist: 0, controller: P0,
      location: MZ, sequence: seq, position: OcgPosition.FACEUP_ATTACK,
    });
  }

  // === P1 setup — minimal (plus optional direct-place MZONE for cross-control variants) ===
  if (layout.p1Mzone) {
    for (const { seq, code } of layout.p1Mzone) {
      core.duelNewCard(duel, {
        code, team: P1, duelist: 0, controller: P1,
        location: MZ, sequence: seq, position: OcgPosition.FACEUP_ATTACK,
      });
    }
  }
  for (let i = 0; i < 40; i++) {
    core.duelNewCard(duel, {
      code: FILLER_OPP_DECK, team: P1, duelist: 0, controller: P1,
      location: DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK,
    });
  }

  core.startDuel(duel);

  // === Game loop — auto-respond, intercept what we care about ===
  let iteration = 0;
  const MAX_ITER = 200;
  let p0IdleCmdCount = 0;
  // For proper-link-summon variant: stop after 2nd P0 IDLECMD.
  // For other variants: stop after 1st P0 IDLECMD.
  const targetIdleCmdCount = variant === 'proper-link-summon' ? 2 : 1;
  let stop = false;

  while (iteration < MAX_ITER && !stop) {
    iteration++;
    const status = core.duelProcess(duel);
    const messages = core.duelGetMessage(duel);

    for (const msg of messages) {
      const m = msg as unknown as Record<string, unknown>;

      if (msg.type === OcgMessageType.SELECT_IDLECMD && m['player'] === P0) {
        p0IdleCmdCount++;
        console.log(`\n─── SELECT_IDLECMD #${p0IdleCmdCount} (P0, iter=${iteration}) ───`);
        // Dump current field state for P0 MZone + EMZ via per-sequence duelQuery (not duelQueryLocation)
        const queryFlags = (OcgQueryFlags.CODE as number) | (OcgQueryFlags.POSITION as number) | (OcgQueryFlags.TYPE as number) | (OcgQueryFlags.LINK as number);
        const dumpZone = (controller: 0 | 1, seq: number): void => {
          const info = core.duelQuery(duel, { flags: queryFlags, controller, location: MZ, sequence: seq, overlaySequence: 0 } as never) as unknown as { code?: number; position?: number; type?: number; link?: { rating: number; marker: number } } | null;
          const zone = seq < 5 ? `M${seq + 1}` : (seq === 5 ? 'EMZ_L' : 'EMZ_R');
          const side = controller === P0 ? 'P0' : 'P1';
          console.log(`  [raw] ${side}/${zone}:`, JSON.stringify(info, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
          if (info && info.code) {
            const isLink = !!(info.type && (info.type & 0x4000000));
            const linkStr = info.link
              ? ` link.marker=0x${info.link.marker.toString(16)} link.rating=${info.link.rating}`
              : (isLink ? ' link=<MISSING — flag requested but engine returned nothing>' : '');
            console.log(`  field ${side}/${zone}: code=${info.code} pos=${info.position} type=0x${(info.type ?? 0).toString(16)} isLink=${isLink}${linkStr}`);
          }
        };
        for (let seq = 0; seq < 7; seq++) dumpZone(P0, seq);
        if (layout.p1Mzone) {
          for (let seq = 0; seq < 7; seq++) dumpZone(P1, seq);
        }
        // Dump Extra-Deck Link cards to compare their link_marker with MZONE-placed ones
        for (let seq = 0; seq < 10; seq++) {
          const info = core.duelQuery(duel, { flags: queryFlags, controller: P0, location: EZ, sequence: seq, overlaySequence: 0 } as never) as unknown as { code?: number; type?: number; link?: { rating: number; marker: number } } | null;
          console.log(`  [extra] P0/EXTRA[seq=${seq}]:`, JSON.stringify(info));
          if (!info) break;
        }
        // Also dump full field state — authoritative view of monsters on both sides
        const field = core.duelQueryField(duel) as unknown as { players: Array<{ monsters: Array<{ position?: number } | null> }> };
        const zoneLabels = ['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R'];
        for (let p = 0; p < 2; p++) {
          const monsters = field?.players?.[p]?.monsters ?? [];
          for (let s = 0; s < 7; s++) {
            const slot = monsters[s];
            const pos = slot?.position ?? 0;
            if (pos !== 0) {
              // Isolate flags: try CODE+LINK, CODE alone, LINK alone to see which combos work
              const qAtk = core.duelQuery(duel, { flags: (OcgQueryFlags.ATTACK as number) | (OcgQueryFlags.DEFENSE as number) | (OcgQueryFlags.BASE_ATTACK as number) | (OcgQueryFlags.BASE_DEFENSE as number), controller: p as 0 | 1, location: MZ, sequence: s, overlaySequence: 0 } as never) as unknown as Record<string, unknown> | null;
              const qCode = core.duelQuery(duel, { flags: (OcgQueryFlags.CODE as number), controller: p as 0 | 1, location: MZ, sequence: s, overlaySequence: 0 } as never) as unknown as Record<string, unknown> | null;
              const qLink = core.duelQuery(duel, { flags: (OcgQueryFlags.LINK as number), controller: p as 0 | 1, location: MZ, sequence: s, overlaySequence: 0 } as never) as unknown as Record<string, unknown> | null;
              console.log(`  [field] P${p}/${zoneLabels[s]}: pos=${pos}`);
              console.log(`    qCode:`, JSON.stringify(qCode, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
              console.log(`    qAtk :`, JSON.stringify(qAtk, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
              console.log(`    qLink:`, JSON.stringify(qLink, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
            }
          }
        }
        const specialSummons = (m['special_summons'] ?? []) as { code: number; location?: number; sequence?: number }[];
        const summons = (m['summons'] ?? []) as { code: number; location?: number; sequence?: number }[];
        const activates = (m['activates'] ?? []) as { code: number; location?: number }[];

        const fmtEntry = (c: { code: number; location?: number; sequence?: number }): string =>
          `${c.code}(loc=${c.location ?? '?'}/seq=${c.sequence ?? '?'})`;

        console.log(`  summons         (${summons.length}): ${summons.map(fmtEntry).join(', ') || '∅'}`);
        console.log(`  special_summons (${specialSummons.length}): ${specialSummons.map(fmtEntry).join(', ') || '∅'}`);
        console.log(`  activates       (${activates.length}): ${activates.map(c => c.code).join(', ') || '∅'}`);
        console.log(`  to_bp=${!!m['to_bp']} to_ep=${!!m['to_ep']}`);

        const ipOffered = specialSummons.some(c => c.code === I_P_MASQUERENA);
        const silOffered = specialSummons.some(c => c.code === SILHOUHATTE_RABBIT);
        const lkbOffered = specialSummons.some(c => c.code === LINKURIBOH);
        console.log(`  >>> I:P Masquerena   (${I_P_MASQUERENA}) ${ipOffered ? 'OFFERED ✓' : 'BLOCKED ✗'}`);
        console.log(`  >>> Silhouhatte Rabbit (${SILHOUHATTE_RABBIT}) ${silOffered ? 'OFFERED ✓' : 'BLOCKED ✗'}`);
        console.log(`  >>> Linkuriboh         (${LINKURIBOH}) ${lkbOffered ? 'OFFERED ✓' : 'BLOCKED ✗'}`);

        // Proper-link-summon variant: at 1st IDLECMD, force Silhouhatte SS.
        if (variant === 'proper-link-summon' && p0IdleCmdCount === 1) {
          const silIdx = specialSummons.findIndex(c => c.code === SILHOUHATTE_RABBIT);
          if (silIdx >= 0) {
            console.log(`  → [proper-link-summon] picking Silhouhatte at index=${silIdx} to Link-summon her`);
            core.duelSetResponse(duel, { type: 1, action: 1, index: silIdx } as never);
            continue;
          } else {
            console.log(`  → [proper-link-summon] Silhouhatte NOT offered — cannot force summon, aborting`);
            core.duelSetResponse(duel, { type: 1, action: 7 } as never);
            stop = true;
            continue;
          }
        }

        if (p0IdleCmdCount >= targetIdleCmdCount) {
          // Measurement IDLECMD reached. If I:P is offered, pick her to
          // surface SELECT_PLACE and see the zones OCGCore considers valid.
          // Otherwise pick first special_summon (if any) for the same purpose.
          // Only fall back to to_ep when nothing is offered.
          const ipIdx = specialSummons.findIndex(c => c.code === I_P_MASQUERENA);
          if (ipIdx >= 0) {
            console.log(`  → measurement IDLECMD: picking I:P at index=${ipIdx} to probe SELECT_PLACE`);
            core.duelSetResponse(duel, { type: 1, action: 1, index: ipIdx } as never);
          } else if (specialSummons.length > 0) {
            console.log(`  → measurement IDLECMD: picking first special_summon (${specialSummons[0].code}) to probe SELECT_PLACE`);
            core.duelSetResponse(duel, { type: 1, action: 1, index: 0 } as never);
          } else {
            console.log(`  → measurement IDLECMD: nothing to SS; picking to_ep`);
            core.duelSetResponse(duel, { type: 1, action: 7 } as never);
          }
          stop = true;
          continue;
        }

        // Default: pick first special_summon to surface SELECT_PLACE (legacy behavior).
        if (specialSummons.length > 0) {
          console.log(`  → picking first special_summon (${specialSummons[0].code}) to probe SELECT_PLACE`);
          core.duelSetResponse(duel, { type: 1, action: 1, index: 0 } as never);
        } else {
          console.log(`  → no special_summons — picking to_ep`);
          core.duelSetResponse(duel, { type: 1, action: 7 } as never);
        }
        continue;
      }

      if (msg.type === OcgMessageType.SELECT_PLACE || msg.type === OcgMessageType.SELECT_DISFIELD) {
        const mask = m['field_mask'] as number;
        const count = (m['count'] as number) ?? 1;
        const places = decodeFieldMask(mask, 99);
        const placesStr = places.map(fmtPlace).join(', ');
        console.log(`\n─── SELECT_PLACE (player=${m['player']}, iter=${iteration}) ───`);
        console.log(`  field_mask: ${fmtMask(mask)}`);
        console.log(`  count: ${count}`);
        console.log(`  decoded places: ${placesStr}`);
        core.duelSetResponse(duel, { type: 10, places: [places[0] ?? { player: P0, location: MZ, sequence: 0 }] } as never);
        continue;
      }

      // --- Auto-respond for everything else to reach main phase ---
      let response: unknown | null = null;
      switch (msg.type) {
        case OcgMessageType.SELECT_EFFECTYN:
          response = { type: 2, yes: false };
          break;
        case OcgMessageType.SELECT_YESNO:
          response = { type: 3, yes: false };
          break;
        case OcgMessageType.SELECT_OPTION:
          response = { type: 4, index: 0 };
          break;
        case OcgMessageType.SELECT_CARD:
          response = { type: 5, indicies: Array.from({ length: (m['min'] as number) ?? 0 }, (_, i) => i) };
          break;
        case OcgMessageType.SELECT_CHAIN:
          response = { type: 8, index: null };
          break;
        case OcgMessageType.SELECT_POSITION:
          response = { type: 11, position: OcgPosition.FACEUP_ATTACK };
          break;
        case OcgMessageType.SELECT_TRIBUTE:
          response = { type: 12, indicies: Array.from({ length: (m['min'] as number) ?? 0 }, (_, i) => i) };
          break;
        case OcgMessageType.SELECT_UNSELECT_CARD:
          response = (m['can_finish']) ? { type: 7, index: null } : { type: 7, index: 0 };
          break;
        case OcgMessageType.ROCK_PAPER_SCISSORS:
          response = { type: 20, value: 2 };
          break;
        case OcgMessageType.SELECT_BATTLECMD:
          response = { type: 0, action: 3 }; // to_ep
          break;
      }
      if (response) core.duelSetResponse(duel, response as never);
    }

    if (status === OcgProcessResult.END) {
      console.log(`[diagnose] duel ENDed before P0 IDLECMD (iter=${iteration})`);
      break;
    }
  }

  if (p0IdleCmdCount === 0) {
    console.log(`\n[diagnose] FAIL: no P0 SELECT_IDLECMD seen in ${MAX_ITER} iterations`);
  } else {
    // Follow-up loop — keep pumping the engine to surface SELECT_PLACE
    // (the mask shows the zones OCGCore considers valid for the picked Link).
    for (let i = 0; i < 50; i++) {
      const status = core.duelProcess(duel);
      const messages = core.duelGetMessage(duel);
      let sawPlace = false;
      for (const msg of messages) {
        const m = msg as unknown as Record<string, unknown>;
        if (msg.type === OcgMessageType.SELECT_PLACE || msg.type === OcgMessageType.SELECT_DISFIELD) {
          const mask = m['field_mask'] as number;
          const places = decodeFieldMask(mask, 99);
          const placesStr = places.map(fmtPlace).join(', ');
          console.log(`\n─── POST-IDLECMD SELECT_PLACE (iter follow-up ${i}) ───`);
          console.log(`  field_mask: ${fmtMask(mask)}`);
          console.log(`  decoded places: ${placesStr}`);
          core.duelSetResponse(duel, { type: 10, places: [places[0] ?? { player: P0, location: MZ, sequence: 0 }] } as never);
          sawPlace = true;
          continue;
        }
        if (msg.type === OcgMessageType.SELECT_CARD) {
          const min = (m['min'] as number) ?? 2;
          core.duelSetResponse(duel, { type: 5, indicies: Array.from({ length: min }, (_, i) => i) } as never);
          continue;
        }
        if (msg.type === OcgMessageType.SELECT_UNSELECT_CARD) {
          core.duelSetResponse(duel, (m['can_finish']) ? { type: 7, index: null } : { type: 7, index: 0 } as never);
          continue;
        }
        if (msg.type === OcgMessageType.SELECT_CHAIN) {
          core.duelSetResponse(duel, { type: 8, index: null } as never);
          continue;
        }
        if (msg.type === OcgMessageType.SELECT_EFFECTYN) {
          core.duelSetResponse(duel, { type: 2, yes: false } as never);
          continue;
        }
        if (msg.type === OcgMessageType.SELECT_YESNO) {
          core.duelSetResponse(duel, { type: 3, yes: false } as never);
          continue;
        }
        if (msg.type === OcgMessageType.SELECT_OPTION) {
          core.duelSetResponse(duel, { type: 4, index: 0 } as never);
          continue;
        }
        if (msg.type === OcgMessageType.SELECT_POSITION) {
          core.duelSetResponse(duel, { type: 11, position: OcgPosition.FACEUP_ATTACK } as never);
          continue;
        }
      }
      // Stop once we've seen the key SELECT_PLACE (that's what we came for)
      if (sawPlace) break;
      if (status === OcgProcessResult.END) break;
    }
  }

  core.destroyDuel(duel);
  cardDB.db.close();
  console.log(`\n=== diagnose-ip-block variant=${variant} complete ===\n`);
}

main().catch(err => {
  console.error('[diagnose] FATAL:', err);
  process.exit(1);
});
