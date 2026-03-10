import { CardLocation, LOCATION } from './duel-ws.types';

/** Maps a CardLocation bitmask to its zone SVG icon path. */
const ZONE_ICON_MAP: Record<CardLocation, string> = {
  [LOCATION.HAND]: 'assets/images/zones/hand.svg',
  [LOCATION.GRAVE]: 'assets/images/zones/gy.svg',
  [LOCATION.BANISHED]: 'assets/images/zones/banished.svg',
  [LOCATION.EXTRA]: 'assets/images/zones/extra.svg',
  [LOCATION.DECK]: 'assets/images/zones/deck.svg',
  [LOCATION.MZONE]: 'assets/images/zones/mzone.svg',
  [LOCATION.SZONE]: 'assets/images/zones/szone.svg',
};

/** Display order for zone groups (most common first). */
const ZONE_DISPLAY_ORDER: readonly CardLocation[] = [
  LOCATION.HAND,
  LOCATION.MZONE,
  LOCATION.SZONE,
  LOCATION.GRAVE,
  LOCATION.BANISHED,
  LOCATION.EXTRA,
  LOCATION.DECK,
];

export function getZoneIconPath(location: CardLocation): string {
  return ZONE_ICON_MAP[location] ?? 'assets/images/zones/deck.svg';
}

export function getZoneDisplayOrder(location: CardLocation): number {
  const idx = ZONE_DISPLAY_ORDER.indexOf(location);
  return idx === -1 ? ZONE_DISPLAY_ORDER.length : idx;
}
