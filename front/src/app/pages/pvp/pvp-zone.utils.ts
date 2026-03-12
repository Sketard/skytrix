import { LOCATION, type CardLocation, ZoneId } from './duel-ws.types';

/**
 * Maps an OCGCore (location, sequence) pair to a board ZoneId.
 * Returns null for non-field locations (HAND, GRAVE, BANISHED, EXTRA, DECK).
 */
export function locationToZoneId(location: number, sequence: number): ZoneId | null {
  if (location === LOCATION.MZONE) {
    if (sequence >= 0 && sequence <= 4) return `M${sequence + 1}` as ZoneId;
    if (sequence === 5) return 'EMZ_L';
    if (sequence === 6) return 'EMZ_R';
  }
  if (location === LOCATION.SZONE) {
    if (sequence >= 0 && sequence <= 4) return `S${sequence + 1}` as ZoneId;
    if (sequence === 5) return 'FIELD';
  }
  return null;
}

/**
 * Maps an OCGCore (location, sequence, relativePlayer) to a zone element registry key.
 * For field zones (MZONE/SZONE), uses locationToZoneId → "ZoneId-player".
 * For non-field zones (HAND, DECK, EXTRA, GRAVE, BANISHED), maps to "NAME-player".
 */
export function locationToZoneKey(location: CardLocation, sequence: number, relativePlayer: number): string {
  const zoneId = locationToZoneId(location, sequence);
  if (zoneId) return `${zoneId}-${relativePlayer}`;

  switch (location) {
    case LOCATION.HAND: return `HAND-${relativePlayer}`;
    case LOCATION.DECK: return `DECK-${relativePlayer}`;
    case LOCATION.EXTRA: return `EXTRA-${relativePlayer}`;
    case LOCATION.GRAVE: return `GY-${relativePlayer}`;
    case LOCATION.BANISHED: return `BANISHED-${relativePlayer}`;
    case LOCATION.OVERLAY: {
      const parentZoneId = locationToZoneId(LOCATION.MZONE, sequence);
      return parentZoneId ? `${parentZoneId}-${relativePlayer}` : `UNKNOWN-${relativePlayer}`;
    }
    default: return `UNKNOWN-${relativePlayer}`;
  }
}
