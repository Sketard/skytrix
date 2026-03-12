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
  if (value >= 10000) return `${value / 1000}k`;
  return String(value);
}

export function totalCounters(counters: Record<string, number> | undefined): number {
  if (!counters) return 0;
  return Object.values(counters).reduce((s, v) => s + v, 0);
}
