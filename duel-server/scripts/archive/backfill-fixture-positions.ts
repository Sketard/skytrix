// =============================================================================
// backfill-fixture-positions.ts — one-shot transform that adds `position`
// to every expectedBoard entry in solver-validation-decks.json based on the
// canonical combo reference docs. Positions derived manually per card:
//   - MZONE/EMZ monsters end-board => attack (aggressive posture)
//   - SZONE traps/spells confirmed SET in ref docs => set
//   - Omitted entries (HAND, FIELD spell, face-up Continuous Spell) keep
//     no position field, so the matcher falls back to zone+cardId only.
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = resolve(
  __dirname,
  '../../_bmad-output/planning-artifacts/research/solver-validation-decks.json',
);

const ATTACK: ReadonlySet<number> = new Set([
  46593546, 79559912, 44852429, 30998403, // D/D/D bosses
  34909328, 7511613, 55397172, 8165596,   // Mitsurugi engine
  71068247, 49105782,                     // Radiant Typhoon
  30581601, 93192592, 10966439, 79606837, // Yummy
  33760966, 78397661,                     // Branded Dracotail (Arthalion line)
  46396218, 86066372, 22110647,           // Kashtira Azamina
  13455674, 10443957, 84941194,           // Horus Crystron
  92798873,                               // Dinomorphia Rexterm
  75922381, 2311090, 54498517, 90809975,  // Spright
  48452496, 82135803, 29301450, 58071334, // Snake-Eye Yummy
  92731385, 28226490, 2463794,            // Tearlaments
  80611581, 29587993, 48608796,           // Floowandereeze
  81497285,                               // Labrynth Lady
  55990317,                               // Stun Runick Hugin
  52068432,                               // Nekroz Trishula
  44146295, 38811586,                     // Branded Dracotail (Mirrorjade line)
]);

const SET: ReadonlySet<number> = new Set([
  91781484,                    // D/D/D Headhunt
  6798031, 17954937,           // Mitsurugi traps
  53813120,                    // Radiant Typhoon Mandate
  29369059,                    // Yummy Surprise
  5431722, 69932023, 80208225, // Dracotail Flame/Horn/Sting
  80845034,                    // Kashtira WANTED
  26631975, 7336745,           // Dinomorphia Domain/Intact
  92714517, 5380979, 6351147,  // Labrynth Big Welcome/Welcome/Rollback
  90846359, 30430448,          // Stun Runick Rivalry/Freezing Curses
  51124303,                    // Nekroz Kaleidoscope
]);

interface Entry {
  zone: string;
  cardId: number;
  cardName: string;
  position?: 'attack' | 'defense' | 'set';
}

interface Hand {
  id: string;
  expectedBoard?: Entry[];
  [k: string]: unknown;
}

interface File {
  hands: Hand[];
  [k: string]: unknown;
}

const raw = readFileSync(FIXTURE_PATH, 'utf-8');
const data = JSON.parse(raw) as File;

let added = 0;
let skippedExisting = 0;
let skippedUnassigned = 0;
const unassignedReport: Array<{ hand: string; zone: string; cardId: number; cardName: string }> = [];

for (const hand of data.hands) {
  if (!hand.expectedBoard) continue;
  for (const e of hand.expectedBoard) {
    if (e.position) { skippedExisting++; continue; }
    if (ATTACK.has(e.cardId)) {
      e.position = 'attack';
      added++;
    } else if (SET.has(e.cardId)) {
      e.position = 'set';
      added++;
    } else {
      skippedUnassigned++;
      unassignedReport.push({ hand: hand.id, zone: e.zone, cardId: e.cardId, cardName: e.cardName });
    }
  }
}

writeFileSync(FIXTURE_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');

console.log(`Backfill complete — ${FIXTURE_PATH}`);
console.log(`  added:              ${added}`);
console.log(`  already-existed:    ${skippedExisting}`);
console.log(`  intentionally-skip: ${skippedUnassigned} (HAND / FIELD / active continuous)`);
console.log();
console.log('Unassigned entries (must be HAND / FIELD / active continuous):');
for (const u of unassignedReport) {
  console.log(`  ${u.hand}: ${u.zone} ${u.cardId} ${u.cardName}`);
}
