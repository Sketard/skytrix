// =============================================================================
// spike-seed-hunter.ts — Find "clean" deckSeeds for the 3 validation fixtures
//
// Purpose (quick-win v2): the current fixtures have deckSeeds that happen to
// place interruption-tagged cards near the top of the deck after OCGCore's
// internal shuffle. Those cards get drawn during the solve, land in HAND,
// and the scorer credits them even though no combo was executed — creating
// the Branded Dracotail regression observed after the first quick-win.
//
// This script iterates candidate deckSeeds, creates a duel for each, queries
// the post-shuffle DECK zone, and reports seeds whose top-K cards contain
// ZERO interruption-tagged cards. The first clean seed per fixture is
// written back to solver-validation-decks.json.
//
// Non-goals: does not touch the solver, does not modify decklists. Pure
// seed-space search.
//
// Usage:
//   npx tsx scripts/spike-seed-hunter.ts
//   npx tsx scripts/spike-seed-hunter.ts --top=20 --max-attempts=500 --apply
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadDatabase, loadScripts } from '../../src/ocg-scripts.js';
import { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import type { DuelConfig } from '../../src/solver/solver-types.js';

interface ExpectedBoardEntry { zone: string; cardId: number; cardName: string }
interface HandFixture {
  id: string; deck: string; description: string;
  hand: number[]; deckSeed: string;
  expectedBoard?: ExpectedBoardEntry[];
}
interface FixtureFile {
  _meta: unknown;
  decks: Record<string, { main: number[]; extra: number[]; side?: number[] }>;
  hands: HandFixture[];
}

interface CliOpts {
  topK: number;
  maxAttempts: number;
  apply: boolean;
  handFilter?: string;
}

function parseCli(argv: string[]): CliOpts {
  const opts: CliOpts = { topK: 20, maxAttempts: 500, apply: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--top=')) opts.topK = Number(arg.slice(6));
    else if (arg.startsWith('--max-attempts=')) opts.maxAttempts = Number(arg.slice(15));
    else if (arg === '--apply') opts.apply = true;
    else if (arg.startsWith('--hand=')) opts.handFilter = arg.slice(7);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx scripts/spike-seed-hunter.ts [--top=N] [--max-attempts=N] [--apply] [--hand=ID]');
      process.exit(0);
    } else {
      console.error(`[SeedHunter] Unknown arg: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

/** Generate the Nth candidate seed tuple. Deterministic — same N always
 *  produces the same tuple. Keeps the 4-bigint seed shape OCGCore expects. */
function generateSeed(n: number): [bigint, bigint, bigint, bigint] {
  // Simple linear generator over the seed space. Good enough for hunting —
  // we just need deterministic coverage.
  const base = BigInt(n + 1) * 0x9E3779B97F4A7C15n;
  return [
    base ^ 0x1111111111111111n,
    base ^ 0x2222222222222222n,
    base ^ 0x3333333333333333n,
    base ^ 0x4444444444444444n,
  ];
}

function seedToString(seed: readonly bigint[]): string {
  return seed.map(s => s.toString()).join(',');
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv);
  console.log(`[SeedHunter] topK=${opts.topK} maxAttempts=${opts.maxAttempts} apply=${opts.apply}`);

  const DATA_DIR = resolve(import.meta.dirname!, '..', '..', '..', 'data');
  const FIXTURE_PATH = resolve(
    import.meta.dirname!, '..', '..', '..',
    '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
  );

  const fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');
  const fixture = JSON.parse(fixtureText) as FixtureFile;

  console.log(`[SeedHunter] Boot adapter (for shuffle-via-createDuel query)`);
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
  const stmt = cardDB.stmt;
  const tags = allConfigs.interruptionTags;

  const isTaggedInterruption = (cardId: number): boolean => tags[String(cardId)] !== undefined;
  const nameOf = (cardId: number): string => {
    const row = stmt.get(cardId) as { name?: string } | undefined;
    return row?.name ?? `#${cardId}`;
  };

  const hands = opts.handFilter
    ? fixture.hands.filter(h => h.id === opts.handFilter)
    : fixture.hands;

  const cleanSeeds: Record<string, string> = {};

  for (const hand of hands) {
    const deck = fixture.decks[hand.deck];
    if (!deck) { console.error(`[SeedHunter] missing deck ${hand.deck}`); continue; }

    // Strip hand cards from main (same as the harness does)
    const mainDeck = [...deck.main];
    let missing = false;
    for (const cardId of hand.hand) {
      const idx = mainDeck.indexOf(cardId);
      if (idx === -1) { console.error(`[SeedHunter] ${hand.id}: hand card ${cardId} not in main`); missing = true; break; }
      mainDeck.splice(idx, 1);
    }
    if (missing) continue;

    console.log(`\n═══ ${hand.id} (${hand.deck}) ═══`);
    console.log(`  hand: ${hand.hand.map(nameOf).join(', ')}`);
    console.log(`  current seed: ${hand.deckSeed}`);

    // Report current seed's top-K for reference
    {
      const current = hand.deckSeed.split(',').map(s => BigInt(s.trim()));
      const duelConfig: DuelConfig = {
        mainDeck, extraDeck: deck.extra, hand: hand.hand,
        deckSeed: current, opponentDeck: [],
      };
      const handle = adapter.createDuel(duelConfig);
      const fs = adapter.getFieldState(handle);
      const deckZone = fs.zones.DECK ?? [];
      const topK = deckZone.slice(0, opts.topK);
      const tagged = topK.filter(c => isTaggedInterruption(c.cardId));
      console.log(`  current top-${opts.topK}: ${tagged.length} tagged cards`);
      for (const c of tagged) {
        const idx = deckZone.findIndex(z => z === c);
        console.log(`    [idx ${idx}] ${nameOf(c.cardId)} (${c.cardId})`);
      }
      adapter.destroyAll();
    }

    // Seed hunt
    let found: { seed: [bigint, bigint, bigint, bigint]; topK: number[]; attempts: number } | null = null;
    for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
      const seed = generateSeed(attempt);
      const duelConfig: DuelConfig = {
        mainDeck, extraDeck: deck.extra, hand: hand.hand,
        deckSeed: seed, opponentDeck: [],
      };
      try {
        const handle = adapter.createDuel(duelConfig);
        const fs = adapter.getFieldState(handle);
        const deckZone = fs.zones.DECK ?? [];
        const topK = deckZone.slice(0, opts.topK).map(c => c.cardId);
        adapter.destroyAll();

        const tagged = topK.filter(isTaggedInterruption);
        if (tagged.length === 0) {
          found = { seed, topK, attempts: attempt + 1 };
          break;
        }
      } catch (err) {
        console.error(`[SeedHunter] attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
        adapter.destroyAll();
      }
    }

    if (!found) {
      console.log(`  ❌ no clean seed found in ${opts.maxAttempts} attempts`);
      continue;
    }

    const seedStr = seedToString(found.seed);
    console.log(`  ✅ clean seed found after ${found.attempts} attempts: ${seedStr}`);
    console.log(`     top-${opts.topK}: ${found.topK.map(nameOf).slice(0, 10).join(', ')}${found.topK.length > 10 ? ', ...' : ''}`);
    cleanSeeds[hand.id] = seedStr;
  }

  if (opts.apply) {
    // Patch fixture file in-place — but keep the original as a comment via
    // a side backup file, so we can revert.
    const backup = FIXTURE_PATH + '.backup-pre-seed-hunt';
    writeFileSync(backup, fixtureText);
    console.log(`\n[SeedHunter] Backup written to ${backup}`);

    for (const h of fixture.hands) {
      if (cleanSeeds[h.id]) h.deckSeed = cleanSeeds[h.id];
    }
    writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
    console.log(`[SeedHunter] Patched ${FIXTURE_PATH}`);
  } else {
    console.log(`\n[SeedHunter] DRY RUN — pass --apply to patch the fixture file`);
    console.log(`  seeds found:`);
    for (const [id, seed] of Object.entries(cleanSeeds)) {
      console.log(`    ${id}: ${seed}`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[SeedHunter] FATAL:', err);
  process.exit(1);
});
