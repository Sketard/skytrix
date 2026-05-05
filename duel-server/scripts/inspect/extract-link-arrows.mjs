#!/usr/bin/env node
/**
 * extract-link-arrows.mjs — one-shot: dump link arrow bitmap for every Link
 * monster in cards.cdb as a JSON table consumable by the Phase D latent
 * interruption computer.
 *
 * Konami bitmap convention (verified 2026-04-17 against I:P Masquerena,
 * Knightmare Phoenix, Accesscode Talker, Firewall Dragon):
 *   BL=0x01  B=0x02  BR=0x04  L=0x08  R=0x20  TL=0x40  T=0x80  TR=0x100
 *
 * Link monster type bit: datas.type & 0x4000000.
 * Link arrows live in datas.def (Link monsters have no DEF stat, so def
 * field is repurposed for the arrow bitmap).
 *
 * Output: duel-server/data/link-arrows.json — { "cardId": ["BL","BR",...] }.
 * Only direction names are stored (ordered by compass direction, CCW from
 * Bottom-Left). Phase D consumers translate (cardZone, direction) → targetZone
 * via a separate zone-adjacency map.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'cards.cdb');
const OUT_PATH = join(__dirname, '..', 'data', 'link-arrows.json');

const TYPE_LINK = 0x4000000;

const ARROW_BITS = [
  { mask: 0x001, name: 'BL' },
  { mask: 0x002, name: 'B' },
  { mask: 0x004, name: 'BR' },
  { mask: 0x008, name: 'L' },
  { mask: 0x020, name: 'R' },
  { mask: 0x040, name: 'TL' },
  { mask: 0x080, name: 'T' },
  { mask: 0x100, name: 'TR' },
];

const db = new Database(DB_PATH, { readonly: true });
const rows = db.prepare(`
  SELECT datas.id AS id, texts.name AS name, datas.def AS def
  FROM datas
  INNER JOIN texts ON datas.id = texts.id
  WHERE (datas.type & ?) != 0
  ORDER BY datas.id
`).all(TYPE_LINK);

const entries = {};
for (const r of rows) {
  const arrows = ARROW_BITS.filter(a => (r.def & a.mask) !== 0).map(a => a.name);
  if (arrows.length === 0) continue; // defensive — every Link has ≥1 arrow
  entries[String(r.id)] = { name: r.name, arrows };
}

writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${Object.keys(entries).length} Link monsters → ${OUT_PATH}`);
