// Build a property-indexed view of a card list. Input: cardIds (dedup'd).
// Output: Markdown-formatted index by attribute / race / level / type flag /
// archetype setcode. Enables mechanical resolution of material-slot predicates
// (e.g. "1 DARK monster", "Reptile Lv8", "Dracotail Spell/Trap") against the
// actual deck contents.
//
// Usage: npx tsx scripts/index-deck.ts <cardId1> <cardId2> ...
//
// Source of truth: cards.cdb datas table + archetype_setcode_constants.lua.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeAttribute, decodeRace, decodeType,
  TYPE_MONSTER, TYPE_SPELL, TYPE_TRAP, TYPE_NORMAL, TYPE_EFFECT,
  TYPE_FUSION, TYPE_RITUAL, TYPE_SYNCHRO, TYPE_XYZ, TYPE_LINK,
  TYPE_TUNER, TYPE_PENDULUM, TYPE_QUICKPLAY, TYPE_CONTINUOUS,
  TYPE_EQUIP, TYPE_FIELD, TYPE_COUNTER,
} from '../src/solver/card-metadata.js';

const ids = [...new Set(process.argv.slice(2).map(Number).filter(Number.isFinite))];
if (ids.length === 0) {
  console.error('Usage: npx tsx scripts/index-deck.ts <cardId1> <cardId2> ...');
  process.exit(2);
}

// Load setcode→name map from archetype_setcode_constants.lua.
const setcodeMap = loadSetcodeMap();
const db = new Database(join('data', 'cards.cdb'), { readonly: true });
const stmt = db.prepare('SELECT t.id, t.name, d.type, d.level, d.race, d.attribute, d.setcode FROM texts t LEFT JOIN datas d ON d.id = t.id WHERE t.id = ?');

interface Row {
  id: number; name: string; type: number; level: number; race: number; attribute: number; setcode: number | bigint;
}

// Bucketed indices.
const byAttribute = new Map<string, number[]>();
const byRace = new Map<string, number[]>();
const byLevel = new Map<string, number[]>();    // "Lv8" | "Rank8" | "Link3" | "(non-monster)"
const byType = new Map<string, number[]>();
const byArchetype = new Map<string, number[]>();
const byPendulumScale = new Map<string, number[]>(); // "L2/R2" etc. — only populated if Pendulum cards in deck
const cardNames = new Map<number, string>();

const TYPE_FLAGS: readonly [number, string][] = [
  [TYPE_MONSTER, 'Monster'], [TYPE_SPELL, 'Spell'], [TYPE_TRAP, 'Trap'],
  [TYPE_NORMAL, 'Normal'], [TYPE_EFFECT, 'Effect'],
  [TYPE_FUSION, 'Fusion'], [TYPE_RITUAL, 'Ritual'],
  [TYPE_SYNCHRO, 'Synchro'], [TYPE_XYZ, 'Xyz'], [TYPE_LINK, 'Link'],
  [TYPE_TUNER, 'Tuner'], [TYPE_PENDULUM, 'Pendulum'],
  [TYPE_QUICKPLAY, 'QuickPlay'], [TYPE_CONTINUOUS, 'Continuous'],
  [TYPE_EQUIP, 'Equip'], [TYPE_FIELD, 'Field'], [TYPE_COUNTER, 'Counter'],
];

for (const id of ids) {
  const row = stmt.get(id) as Row | undefined;
  if (!row) { console.error(`NOT FOUND: ${id}`); continue; }
  cardNames.set(id, row.name);

  const type = row.type ?? 0;
  const levelField = row.level ?? 0;
  const lv = levelField & 0xff;
  const isMonster = (type & TYPE_MONSTER) !== 0;
  const isXyz = (type & TYPE_XYZ) !== 0;
  const isLink = (type & TYPE_LINK) !== 0;
  const isPendulum = (type & TYPE_PENDULUM) !== 0;
  const isTuner = (type & TYPE_TUNER) !== 0;

  bucket(byAttribute, decodeAttribute(row.attribute ?? 0), id);
  bucket(byRace, decodeRace(row.race ?? 0), id);

  // Level field is repurposed for Xyz Rank and Link Rating. Separate buckets
  // so "Rank 4 Xyz" and "Lv4 monster" don't collide.
  const lvPadded = String(lv).padStart(2, '0');
  if (!isMonster) bucket(byLevel, '(non-monster)', id);
  else if (isLink) bucket(byLevel, `Link ${lvPadded}`, id);
  else if (isXyz) bucket(byLevel, `Rank ${lvPadded}`, id);
  else bucket(byLevel, `Lv ${lvPadded}`, id);

  for (const [flag, name] of TYPE_FLAGS) {
    if ((type & flag) !== 0) bucket(byType, name, id);
  }
  // Derived: Non-Tuner Monster — filling the other half of Synchro material clauses.
  if (isMonster && !isTuner) bucket(byType, 'Non-Tuner', id);

  // Pendulum scales (left = bits 16-23, right = bits 24-31). Only surface when bit set.
  if (isPendulum) {
    const leftScale = (levelField >> 16) & 0xff;
    const rightScale = (levelField >> 24) & 0xff;
    bucket(byPendulumScale, `L${leftScale}/R${rightScale}`, id);
  }

  for (const code of unpackSetcodes(row.setcode)) {
    const name = setcodeMap.get(code) ?? `UNKNOWN(0x${code.toString(16)})`;
    bucket(byArchetype, name, id);
  }
}

db.close();

// Emit Markdown.
console.log(`# Deck Index\n`);
console.log(`${ids.length} unique cards indexed.\n`);

emitBucket('Attribute', byAttribute);
emitBucket('Race', byRace);
emitBucket('Level / Rank / Link', byLevel);
emitBucket('Type flag (bitmask bits + derived)', byType);
if (byPendulumScale.size > 0) emitBucket('Pendulum scale (L/R)', byPendulumScale);
emitBucket('Archetype (setcode)', byArchetype);

// Helpers.
function bucket<K>(map: Map<K, number[]>, key: K, id: number): void {
  const arr = map.get(key);
  if (arr) arr.push(id); else map.set(key, [id]);
}

function emitBucket(heading: string, map: Map<string, number[]>): void {
  console.log(`## By ${heading}\n`);
  const keys = [...map.keys()].sort();
  if (keys.length === 0) { console.log('(none)\n'); return; }
  for (const k of keys) {
    const ids = map.get(k)!;
    console.log(`**${k}** (${ids.length}) — ${ids.map(id => `${id} ${cardNames.get(id) ?? ''}`.trim()).join(' / ')}`);
  }
  console.log();
}

function unpackSetcodes(v: number | bigint): number[] {
  let big = typeof v === 'bigint' ? v : BigInt(v ?? 0);
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const code = Number(big & 0xFFFFn);
    if (code !== 0) out.push(code);
    big >>= 16n;
  }
  return out;
}

function loadSetcodeMap(): Map<number, string> {
  const path = join('data', 'scripts_full', 'archetype_setcode_constants.lua');
  const text = readFileSync(path, 'utf-8');
  const map = new Map<number, string>();
  const re = /^\s*SET_([A-Z0-9_]+)\s*=\s*0x([0-9a-fA-F]+)/gm;
  for (const m of text.matchAll(re)) {
    const name = m[1];
    const hex = parseInt(m[2], 16);
    // Keep FIRST name seen for a given hex (primary archetype).
    if (!map.has(hex)) map.set(hex, name);
  }
  return map;
}
