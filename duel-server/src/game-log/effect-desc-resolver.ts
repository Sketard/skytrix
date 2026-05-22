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
 * Unsubstituted printf-style placeholders OCGCore leaves in some strings (a
 * `%ls` for an interpolated card name, a `%d` for a count). They only resolve
 * inside the engine where the argument list is in scope; a Game Log row never
 * has those args. A string still carrying one is unusable as display text.
 */
const PLACEHOLDER_RE = /%ls|%d/;

/**
 * Resolve a packed effect-description code to human-readable text.
 *
 * Fallback chain (CONTRACT — the return is ALWAYS clean text or `''`, NEVER a
 * string that still carries a `%ls` / `%d` placeholder):
 *   1. `cardCode != 0` → the card's own effect text (`str{strIndex+1}`).
 *   2. `cardCode == 0 && strIndex != 0` → an OCGCore system string
 *      (strings.conf) — e.g. 1160 = "Activate it as a Pendulum Spell".
 *   3. `cardCode == 0 && strIndex == 0` → OCGCore emits 0 when no
 *      disambiguation is needed (single-effect Continuous Spell, lone GY
 *      effect, Pendulum placement). System 0 is absent from strings.conf —
 *      a genuine void, return `''`.
 * A resolved text (card OR system) carrying an unsubstituted placeholder is
 * dropped to `''` so it never reaches the renderer.
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

  return cleanOrEmpty(resolveRaw(cardCode, strIndex, cardDb, systemStrings));
}

/** Resolve the raw text for a decoded `(cardCode, strIndex)` pair — before the
 *  placeholder guard. `''` when there is nothing to resolve. */
function resolveRaw(
  cardCode: number,
  strIndex: number,
  cardDb: CardDB,
  systemStrings: ReadonlyMap<number, string>,
): string {
  if (cardCode === 0) {
    // strIndex 0 == OCGCore "no disambiguation needed" — a genuine void.
    if (strIndex === 0) return '';
    return systemStrings.get(strIndex) ?? '';
  }

  const row = cardDb.descStmt.get(cardCode) as Record<string, string> | undefined;
  if (!row) return '';
  return row[`str${strIndex + 1}`] || '';
}

/** Universal guard — a text still carrying a `%ls` / `%d` is unusable. */
function cleanOrEmpty(text: string): string {
  return PLACEHOLDER_RE.test(text) ? '' : text;
}
