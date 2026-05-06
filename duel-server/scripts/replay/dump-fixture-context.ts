// =============================================================================
// dump-fixture-context.ts — pre-extracts a clean per-fixture context for
// Path β subagent dispatches. Reads the master fixture file + cards.cdb
// and writes:
//
//   <out-dir>/fixture.json
//     {
//       fixtureId, deckLabel, hand: [{cardId,name}], deckMain: [{cardId,name,count}],
//       deckExtra: [{cardId,name,count}], expectedBoard: [{cardId,name,zone,position?}],
//       deckSeed
//     }
//
// Subagents read this file to understand the deck composition without
// having to query SQLite themselves.
//
// Usage:
//   npx tsx scripts/dump-fixture-context.ts \
//     --fixture-id=branded-dracotail-opener \
//     --out-dir=data/path-beta-poc/branded-dracotail-opener
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

import { DATA_DIR, loadFixtureFile, type HandFixture } from '../eval/evaluate-structural.js';

interface Args {
  fixtureId: string;
  outDir: string;
}

function parseArgs(): Args {
  const pick = (n: string): string | undefined => {
    const a = process.argv.find(x => x.startsWith(`--${n}=`));
    return a?.slice(n.length + 3);
  };
  const fixtureId = pick('fixture-id');
  const outDir = pick('out-dir');
  if (!fixtureId || !outDir) {
    console.error('Usage: --fixture-id=<id> --out-dir=<dir>');
    process.exit(2);
  }
  return { fixtureId, outDir };
}

function main(): void {
  const args = parseArgs();
  const fixture = loadFixtureFile();
  const hand: HandFixture | undefined = fixture.hands.find(h => h.id === args.fixtureId);
  if (!hand) {
    console.error(`[dump-fixture] fixture ${args.fixtureId} not found`);
    process.exit(2);
  }
  const deck = fixture.decks[hand.deck];
  if (!deck) {
    console.error(`[dump-fixture] deck ${hand.deck} not found`);
    process.exit(2);
  }

  const db = new Database(join(DATA_DIR, 'cards.cdb'), { readonly: true });
  const nameStmt = db.prepare('SELECT name FROM texts WHERE id = ?');
  const lookupName = (id: number): string => {
    const row = nameStmt.get(id) as { name: string } | undefined;
    return row?.name ?? `#${id}`;
  };

  const handCards = hand.hand.map(id => ({ cardId: id, name: lookupName(id) }));

  // Aggregate deck counts.
  const aggregate = (ids: readonly number[]) => {
    const counts = new Map<number, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const out = [...counts.entries()]
      .map(([cardId, count]) => ({ cardId, name: lookupName(cardId), count }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return out;
  };

  const deckMain = aggregate(deck.main);
  const deckExtra = aggregate(deck.extra);
  const expectedBoard = (hand.expectedBoard ?? []).map(e => ({
    cardId: e.cardId,
    name: lookupName(e.cardId),
    zone: e.zone,
    position: e.position,
  }));
  db.close();

  const out = {
    fixtureId: args.fixtureId,
    deckLabel: hand.deck,
    deckSeed: hand.deckSeed,
    hand: handCards,
    handSize: handCards.length,
    deckMain,
    deckMainSize: deck.main.length,
    deckMainUnique: deckMain.length,
    deckExtra,
    deckExtraSize: deck.extra.length,
    deckExtraUnique: deckExtra.length,
    expectedBoard,
    expectedBoardSize: expectedBoard.length,
    notes: hand.notes ?? null,
  };

  const outAbs = resolve(args.outDir);
  mkdirSync(outAbs, { recursive: true });
  const outPath = join(outAbs, 'fixture.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`[dump-fixture] wrote ${outPath}`);
  console.log(`  hand: ${handCards.length} cards`);
  console.log(`  deckMain: ${deck.main.length} (${deckMain.length} unique)`);
  console.log(`  deckExtra: ${deck.extra.length} (${deckExtra.length} unique)`);
  console.log(`  expectedBoard: ${expectedBoard.length}`);
}

main();
