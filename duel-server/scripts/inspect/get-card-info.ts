// =============================================================================
// get-card-info.ts — CLI for Path β subagent.
//
// Given a cardId, outputs a compact JSON record with:
//   - name, type (Monster/Spell/Trap), level, atk, def, attribute, race, sets
//   - oracle text (cards.cdb `desc` field)
//   - paths to effects-catalog and Lua script (if available) — subagent
//     reads them on demand to avoid blowing up output size
//   - interruption tags (if any) — already structured, embed inline
//
// Usage:
//   npx tsx scripts/get-card-info.ts <cardId>            # human-readable
//   npx tsx scripts/get-card-info.ts <cardId> --json     # one-line JSON for piping
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const DATA_DIR = resolve(import.meta.dirname!, '..', '..', '..', 'data');
const CATALOG_DIR = resolve(import.meta.dirname!, '..', '..', '..', '_bmad-output', 'solver-data', 'card-effects-catalog');
const SCRIPTS_DIR = join(DATA_DIR, 'scripts_full');
const TAGS_PATH = join(DATA_DIR, 'interruption-tags.json');

// OCGCore type bitfield → strings (subset; covers main families).
const TYPE_BITS: Array<[number, string]> = [
  [0x1, 'Monster'],
  [0x2, 'Spell'],
  [0x4, 'Trap'],
  [0x10, 'Normal'],
  [0x20, 'Effect'],
  [0x40, 'Fusion'],
  [0x80, 'Ritual'],
  [0x100, 'TrapMonster'],
  [0x200, 'Spirit'],
  [0x400, 'Union'],
  [0x800, 'Gemini'],
  [0x1000, 'Tuner'],
  [0x2000, 'Synchro'],
  [0x4000, 'Token'],
  [0x10000, 'QuickPlay'],
  [0x20000, 'Continuous'],
  [0x40000, 'Equip'],
  [0x80000, 'Field'],
  [0x100000, 'Counter'],
  [0x200000, 'Flip'],
  [0x400000, 'Toon'],
  [0x800000, 'Xyz'],
  [0x1000000, 'Pendulum'],
  [0x2000000, 'SpSummon'],
  [0x4000000, 'Link'],
];

const ATTRIBUTES: Record<number, string> = {
  0x1: 'EARTH', 0x2: 'WATER', 0x4: 'FIRE', 0x8: 'WIND',
  0x10: 'LIGHT', 0x20: 'DARK', 0x40: 'DIVINE',
};

const RACES: Record<number, string> = {
  0x1: 'Warrior', 0x2: 'Spellcaster', 0x4: 'Fairy', 0x8: 'Fiend',
  0x10: 'Zombie', 0x20: 'Machine', 0x40: 'Aqua', 0x80: 'Pyro',
  0x100: 'Rock', 0x200: 'WingedBeast', 0x400: 'Plant', 0x800: 'Insect',
  0x1000: 'Thunder', 0x2000: 'Dragon', 0x4000: 'Beast', 0x8000: 'BeastWarrior',
  0x10000: 'Dinosaur', 0x20000: 'Fish', 0x40000: 'SeaSerpent', 0x80000: 'Reptile',
  0x100000: 'Psychic', 0x200000: 'DivineBeast', 0x400000: 'CreatorGod',
  0x800000: 'Wyrm', 0x1000000: 'Cyberse',
};

function decodeBits(value: number, table: Array<[number, string]>): string[] {
  const out: string[] = [];
  for (const [bit, name] of table) if ((value & bit) !== 0) out.push(name);
  return out;
}

function decodeAttr(value: number): string | null {
  return ATTRIBUTES[value] ?? null;
}

function decodeRace(value: number): string | null {
  return RACES[value] ?? null;
}

interface CardInfo {
  cardId: number;
  name: string;
  oracle: string;
  type: string[];
  isMonster: boolean;
  isSpell: boolean;
  isTrap: boolean;
  level?: number;
  atk?: number;
  def?: number;
  attribute?: string | null;
  race?: string | null;
  setcode?: string;
  effectsCatalogPath: string | null;
  luaScriptPath: string | null;
  interruptionTag: unknown | null;
  notFound?: boolean;
}

function getCardInfo(cardId: number): CardInfo {
  const db = new Database(join(DATA_DIR, 'cards.cdb'), { readonly: true });
  const data = db.prepare(
    'SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category FROM datas WHERE id = ?',
  ).get(cardId) as Record<string, number | bigint> | undefined;
  const text = db.prepare('SELECT name, desc FROM texts WHERE id = ?').get(cardId) as { name: string; desc: string } | undefined;
  db.close();

  if (!data || !text) {
    return {
      cardId,
      name: '(unknown)',
      oracle: '',
      type: [],
      isMonster: false,
      isSpell: false,
      isTrap: false,
      effectsCatalogPath: null,
      luaScriptPath: null,
      interruptionTag: null,
      notFound: true,
    };
  }

  const typeBits = Number(data.type);
  const typeNames = decodeBits(typeBits, TYPE_BITS);
  const isMonster = (typeBits & 0x1) !== 0;
  const isSpell = (typeBits & 0x2) !== 0;
  const isTrap = (typeBits & 0x4) !== 0;
  // Level field on Xyz/Link encodes rank/link rating in the lower 8 bits;
  // use that nibble as displayed level.
  const lvlRaw = Number(data.level);
  const level = isMonster ? (lvlRaw & 0xff) : undefined;
  const atk = isMonster ? Number(data.atk) : undefined;
  const def = isMonster && (typeBits & 0x4000000) === 0 ? Number(data.def) : undefined;
  const attribute = isMonster ? decodeAttr(Number(data.attribute)) : null;
  const race = isMonster ? decodeRace(Number(data.race)) : null;
  const setcodeBig = typeof data.setcode === 'bigint' ? data.setcode : BigInt(data.setcode);
  const setcode = `0x${setcodeBig.toString(16)}`;

  const catalogPath = join(CATALOG_DIR, `${cardId}.json`);
  // Lua scripts can live under official/, pre-release/, or unofficial/ subdirs.
  const luaCandidates = ['official', 'pre-release', 'unofficial'].map(sub => join(SCRIPTS_DIR, sub, `c${cardId}.lua`));
  const luaPath = luaCandidates.find(p => existsSync(p)) ?? null;

  let interruptionTag: unknown | null = null;
  if (existsSync(TAGS_PATH)) {
    const tags = JSON.parse(readFileSync(TAGS_PATH, 'utf-8')) as Record<string, unknown>;
    if (tags[String(cardId)]) interruptionTag = tags[String(cardId)];
  }

  return {
    cardId,
    name: text.name,
    oracle: text.desc,
    type: typeNames,
    isMonster,
    isSpell,
    isTrap,
    level,
    atk,
    def,
    attribute,
    race,
    setcode,
    effectsCatalogPath: existsSync(catalogPath) ? catalogPath : null,
    luaScriptPath: luaPath,
    interruptionTag,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const idStr = args.find(a => !a.startsWith('--'));
  const json = args.includes('--json');
  if (!idStr) {
    console.error('Usage: npx tsx scripts/get-card-info.ts <cardId> [--json]');
    process.exit(2);
  }
  const cardId = Number(idStr);
  if (!Number.isFinite(cardId) || cardId <= 0) {
    console.error(`[get-card-info] invalid cardId: ${idStr}`);
    process.exit(2);
  }
  const info = getCardInfo(cardId);
  if (json) {
    process.stdout.write(JSON.stringify(info) + '\n');
    return;
  }
  // Human-readable.
  if (info.notFound) {
    console.log(`Card ${cardId} not found in cards.cdb`);
    return;
  }
  const lines: string[] = [];
  lines.push(`# ${info.name} (id=${info.cardId})`);
  lines.push('');
  lines.push(`Type: ${info.type.join(', ')}`);
  if (info.isMonster) {
    const stats = [`Lv${info.level}`, info.attribute, info.race, `ATK ${info.atk}`];
    if (info.def !== undefined) stats.push(`DEF ${info.def}`);
    lines.push(`Stats: ${stats.filter(Boolean).join(' / ')}`);
  }
  lines.push(`Setcode: ${info.setcode}`);
  lines.push('');
  lines.push('Oracle text:');
  lines.push(info.oracle);
  lines.push('');
  if (info.interruptionTag) {
    lines.push('Interruption tag (structured):');
    lines.push(JSON.stringify(info.interruptionTag, null, 2));
    lines.push('');
  }
  if (info.effectsCatalogPath) {
    lines.push(`Effects catalog: ${info.effectsCatalogPath}`);
  }
  if (info.luaScriptPath) {
    lines.push(`Lua script: ${info.luaScriptPath}`);
  }
  console.log(lines.join('\n'));
}

main();
