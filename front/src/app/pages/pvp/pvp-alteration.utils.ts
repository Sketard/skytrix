const ATTRIBUTE_MAP: Record<number, string> = {
  1: 'EARTH',
  2: 'WATER',
  4: 'FIRE',
  8: 'WIND',
  16: 'LIGHT',
  32: 'DARK',
  64: 'DIVINE',
};

const RACE_MAP: Record<number, string> = {
  1: 'WARRIOR',
  2: 'SPELLCASTER',
  4: 'FAIRY',
  8: 'FIEND',
  16: 'ZOMBIE',
  32: 'MACHINE',
  64: 'AQUA',
  128: 'PYRO',
  256: 'ROCK',
  512: 'WINGED_BEAST',
  1024: 'PLANT',
  2048: 'INSECT',
  4096: 'THUNDER',
  8192: 'DRAGON',
  16384: 'BEAST',
  32768: 'BEAST_WARRIOR',
  65536: 'DINOSAUR',
  131072: 'FISH',
  262144: 'SEA_SERPENT',
  524288: 'REPTILE',
  1048576: 'PSYCHIC',
  2097152: 'DIVINE_BEAST',
  4194304: 'CREATOR_GOD',
  8388608: 'WYRM',
  16777216: 'CYBERSE',
};

export function getAttributeName(attrId: number): string | null {
  return ATTRIBUTE_MAP[attrId] ?? null;
}

export function getRaceName(raceId: number): string | null {
  return RACE_MAP[raceId] ?? null;
}

export function formatStat(value: number): string {
  if (value < 0) return '?';
  if (value >= 10000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

export function totalCounters(counters: Record<string, number> | undefined): number {
  if (!counters) return 0;
  return Object.values(counters).reduce((s, v) => s + v, 0);
}

/**
 * `OcgType` bitmask label mapping. Subset of the upstream enum focused on
 * type flags whose presence/absence the player visibly cares about (alters
 * gameplay): EFFECT/NORMAL/TUNER/FLIP/PENDULUM and the summon families
 * (FUSION/RITUAL/SYNCHRO/XYZ/LINK). Demographic flags (MONSTER/SPELL/TRAP/
 * TOON/SPIRIT/UNION/GEMINI/etc.) are deliberately excluded — their state
 * doesn't change visibly in modern play and would clutter the inspector.
 *
 * Values match `@n1xx1/ocgcore-wasm` `OcgType` exactly (powers of 2).
 */
const TYPE_FLAG_LABELS: ReadonlyArray<{ bit: number; label: string }> = [
  { bit: 16, label: 'NORMAL' },
  { bit: 32, label: 'EFFECT' },
  { bit: 64, label: 'FUSION' },
  { bit: 128, label: 'RITUAL' },
  { bit: 4096, label: 'TUNER' },
  { bit: 8192, label: 'SYNCHRO' },
  { bit: 2097152, label: 'FLIP' },
  { bit: 8388608, label: 'XYZ' },
  { bit: 16777216, label: 'PENDULUM' },
  { bit: 67108864, label: 'LINK' },
];

export interface TypeBitmaskDiff {
  /** Type-flag labels present in `current` but not in `base` (granted by an effect). */
  added: string[];
  /** Type-flag labels present in `base` but not in `current` (removed by an effect). */
  removed: string[];
}

/**
 * Compute the diff between a card's printed type bitmask (`base`) and its
 * live in-game type bitmask (`current`). Returns labels for the flags whose
 * presence changed; empty arrays mean no observable alteration.
 *
 * Use when rendering an "altered type" indicator in the card inspector.
 */
export function diffTypeBitmask(current: number | undefined, base: number | undefined): TypeBitmaskDiff {
  if (current === undefined || base === undefined || current === base) {
    return { added: [], removed: [] };
  }
  const added: string[] = [];
  const removed: string[] = [];
  for (const { bit, label } of TYPE_FLAG_LABELS) {
    const inCurrent = (current & bit) !== 0;
    const inBase = (base & bit) !== 0;
    if (inCurrent && !inBase) added.push(label);
    else if (!inCurrent && inBase) removed.push(label);
  }
  return { added, removed };
}
