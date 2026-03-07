import { LOCATION, ZoneId } from './duel-ws.types';

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
