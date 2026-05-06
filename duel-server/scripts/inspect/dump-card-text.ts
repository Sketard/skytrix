// Dump card name + desc text for a list of cardIds. One-off research tool.
// Usage: npx tsx scripts/dump-card-text.ts <id1> <id2> ...

import Database from 'better-sqlite3';
import { join } from 'node:path';

const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (ids.length === 0) {
  console.error('Usage: npx tsx scripts/dump-card-text.ts <cardId1> <cardId2> ...');
  process.exit(2);
}

const db = new Database(join('data', 'cards.cdb'), { readonly: true });
const stmt = db.prepare('SELECT t.id, t.name, t.desc, d.type, d.level, d.race, d.attribute, d.atk, d.def FROM texts t LEFT JOIN datas d ON d.id = t.id WHERE t.id = ?');

for (const id of ids) {
  const row = stmt.get(id) as { id: number; name: string; desc: string; type: number; level: number; race: number; attribute: number; atk: number; def: number } | undefined;
  if (!row) {
    console.log(`─── ${id} ─── NOT FOUND\n`);
    continue;
  }
  console.log(`─── ${id} · ${row.name} ───`);
  console.log(`type=0x${row.type.toString(16)}  level=${row.level}  race=0x${row.race.toString(16)}  attr=0x${row.attribute.toString(16)}  atk=${row.atk}  def=${row.def}`);
  console.log(row.desc);
  console.log();
}
db.close();
