// =============================================================================
// duel-hint.util.ts — pure resolvers for MSG_HINT / SELECT_CHAIN hint text.
//
// The duel-server stamps only the raw codes onto the wire (`MSG_HINT` carries
// `hintType` + `value`; `SELECT_CHAIN` carries `hintTiming`). All localized
// text is resolved client-side, keyed off the current UI language — the same
// pivot the `duel-french-locale` chantier applied to prompt chrome.
//
// Mirrors the per-hintType branching that used to live in the duel-server's
// `transformHint`. Kept pure (no Angular deps) — the caller injects `deps`.
// =============================================================================

/**
 * Maps an OCGCore `hint_timing` bitmask value to a `strings.conf` system-string
 * index. Mirrors the duel-server's former `TIMING_STRING_ID` map (removed once
 * the timing label became client-resolved).
 */
export const TIMING_STRING_ID: Record<number, number> = {
  0x01: 20, // Draw Phase
  0x02: 21, // Standby Phase
  0x04: 23, // Attempting to end the Main Phase
  0x08: 80, // Entering the Battle Phase
  0x10: 25, // End of the Battle Phase
  0x20: 81, // Entering the End Phase
};

/** Dependencies for the hint resolvers — injected so the util stays pure. */
export interface HintResolveDeps {
  /** Resolves a system-string index to localized text (EN fallback inside). */
  resolveSystemString(strIndex: number): string;
  /** Resolves a card code to its (localized) card name. */
  resolveCardName(cardCode: number): string;
  /** Resolves a race bitmask to a localized label. */
  resolveRace(bitmask: number): string;
  /** Resolves an attribute bitmask to a localized label. */
  resolveAttribute(bitmask: number): string;
}

/**
 * Resolves a `MSG_HINT` to its localized action text from the raw `hintType`
 * + `value`. Mirrors the duel-server's former `transformHint` branching:
 *
 * - 1 / 2 (HINT_EVENT / HINT_MESSAGE) → `value` is a system-string index.
 * - 3 / 4 (HINT_SELECTMSG / HINT_OPSELECTED) → `value` is a system-string
 *   index OR a card code: try the system string, fall back to the card name.
 * - 6 (HINT_RACE) → `value` is a race bitmask.
 * - 7 (HINT_ATTRIB) → `value` is an attribute bitmask.
 * - 9 (HINT_NUMBER) → `value` is a literal number.
 * - 5 / 8 / 10 / 13 / 15 (HINT_CARD & card-bound hints) → `value` is a
 *   card code; the action text is the card name.
 *
 * Any other `hintType` returns '' — the caller logs it rather than rendering a
 * raw number (an unanticipated hint kind, see the spec's "Ask First").
 */
const CARD_CODE_HINT_TYPES: ReadonlySet<number> = new Set([5, 8, 10, 13, 15]);

/**
 * Every `hintType` `resolveHintAction` knows how to resolve. A type outside
 * this set is genuinely unanticipated — the caller should log it. A type
 * INSIDE it that still yields '' is benign (e.g. a card-code hint whose card
 * name is empty), not a missing-handler bug.
 */
export const KNOWN_HINT_TYPES: ReadonlySet<number> = new Set([
  1, 2, 3, 4, 6, 7, 9, ...CARD_CODE_HINT_TYPES,
]);

export function resolveHintAction(hintType: number, value: number, deps: HintResolveDeps): string {
  switch (hintType) {
    case 1:
    case 2:
      return deps.resolveSystemString(value);
    case 3:
    case 4: {
      const sysStr = deps.resolveSystemString(value);
      return sysStr || deps.resolveCardName(value);
    }
    case 6:
      return deps.resolveRace(value);
    case 7:
      return deps.resolveAttribute(value);
    case 9:
      return String(value);
    default:
      // Card-code hint types ({5,8,10,13,15}) — the action is the card name,
      // which the server still stamps on the message. Anything else is an
      // unanticipated kind → '' (the caller logs it).
      return CARD_CODE_HINT_TYPES.has(hintType) ? deps.resolveCardName(value) : '';
  }
}

/**
 * Resolves a `SELECT_CHAIN` timing label from its `hintTiming` bitmask:
 * `hintTiming` → system-string index (via `TIMING_STRING_ID`) → localized text.
 * A `hintTiming` not in the map returns '' (no timing prefix).
 */
export function resolveHintTimingLabel(hintTiming: number, deps: HintResolveDeps): string {
  const strIndex = TIMING_STRING_ID[hintTiming];
  return strIndex === undefined ? '' : deps.resolveSystemString(strIndex);
}
