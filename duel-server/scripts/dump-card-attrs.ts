// Dump fully-decoded card attributes from cards.cdb.
// Mechanically decodes type bitmask / race / attribute into human-readable names.
// Use this in effect-linking discovery passes instead of transcribing from memory.
//
// Usage: npx tsx scripts/dump-card-attrs.ts <cardId1> <cardId2> ...

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { decodeType, decodeRace, decodeAttribute } from '../src/solver/card-metadata.js';

const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (ids.length === 0) {
  console.error('Usage: npx tsx scripts/dump-card-attrs.ts <cardId1> <cardId2> ...');
  process.exit(2);
}

const db = new Database(join('data', 'cards.cdb'), { readonly: true });
const stmt = db.prepare('SELECT t.id, t.name, d.type, d.level, d.race, d.attribute, d.atk, d.def FROM texts t LEFT JOIN datas d ON d.id = t.id WHERE t.id = ?');

interface Row { id: number; name: string; type: number; level: number; race: number; attribute: number; atk: number; def: number; }

// Header
console.log('cardId     | Name                                     | Type                          | Race             | Attr    | Lv | ATK  | DEF');
console.log('-----------+------------------------------------------+-------------------------------+------------------+---------+----+------+-----');

for (const id of ids) {
  const row = stmt.get(id) as Row | undefined;
  if (!row) {
    console.log(`${String(id).padEnd(11)}| NOT FOUND`);
    continue;
  }
  const name = (row.name ?? '').slice(0, 40).padEnd(40);
  const type = decodeType(row.type ?? 0).padEnd(29);
  const race = decodeRace(row.race ?? 0).padEnd(16);
  const attr = decodeAttribute(row.attribute ?? 0).padEnd(7);
  const lv = String(row.level & 0xff).padStart(2);
  const atk = String(row.atk ?? 0).padStart(4);
  const def = String(row.def ?? 0).padStart(4);
  console.log(`${String(id).padEnd(11)}| ${name} | ${type} | ${race} | ${attr} | ${lv} | ${atk} | ${def}`);
}

db.close();
