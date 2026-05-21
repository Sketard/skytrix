// =============================================================================
// effect-desc-resolver.ts — resolve a MSG_CHAINING `description` code to text
// -----------------------------------------------------------------------------
// Mirrors `getOptionDesc` (duel-worker.ts) without the worker's module state:
// the caller injects `cardDb` + `systemStrings`. Kept separate so GameLogBuilder
// itself never touches sqlite — the CLI resolves descriptions and hands the
// builder already-resolved text.
//
// The `description` code packs: high 20 bits = card code, low 20 bits = the
// effect string index (0-based) into the card's str1..str16 columns. A card
// code of 0 means a system string (strings.conf) instead of a card text.
// =============================================================================

import type { CardDB } from '../types.js';

const STR_INDEX_MASK = 0xfffff;
const CARD_CODE_SHIFT = 20n;

/**
 * Resolve a packed effect-description code to human-readable text.
 *
 * @param descriptionCode the `MSG_CHAINING.description` numeric code
 * @param cardDb          opened card database (provides `descStmt`)
 * @param systemStrings   strings.conf map (for card-code-0 system strings)
 * @returns the resolved effect text, or '' when it cannot be resolved
 */
export function resolveDescription(
  descriptionCode: number,
  cardDb: CardDB,
  systemStrings: ReadonlyMap<number, string>,
): string {
  const code = BigInt(descriptionCode);
  const cardCode = Number(code >> CARD_CODE_SHIFT);
  const strIndex = Number(code & BigInt(STR_INDEX_MASK));

  if (cardCode === 0) {
    return systemStrings.get(strIndex) ?? '';
  }

  const row = cardDb.descStmt.get(cardCode) as Record<string, string> | undefined;
  if (!row) return '';
  return row[`str${strIndex + 1}`] || '';
}
