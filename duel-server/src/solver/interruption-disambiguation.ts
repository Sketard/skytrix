// =============================================================================
// interruption-disambiguation.ts — Map a runtime activation prompt back to a
// specific effect index in InterruptionTag.effects[]. Story 1.8.
// Pure functions — no `this`, no I/O, easy to unit-test in isolation.
// =============================================================================

import type {
  InterruptionTag,
  InterruptionTrigger,
  PromptType,
} from './solver-types.js';

/** OCGCore location enum value for the Extra Deck. Inlined here so this
 *  module stays free of @n1xx1/ocgcore-wasm dependency (importable by both
 *  the WASM-bound adapter and pure-TS smoke tests). Source:
 *  @n1xx1/ocgcore-wasm/dist/index.d.ts → OcgLocation.EXTRA = 64. */
const OCG_LOCATION_EXTRA = 64;

/** True when an OCGCore activation entry's `location` represents a card
 *  that is genuinely activating an effect (not a Synchro/Xyz/Link summon
 *  procedure). The procedure entries carry `location === EXTRA` because
 *  the monster is still in the Extra Deck at activation time. Real effect
 *  activations come from MZONE/SZONE/HAND/GRAVE/REMOVED — anything that
 *  isn't EXTRA. Story 1.8 — fixes the C1 leak where summon procedures
 *  were polluting the activation log. */
export function isFieldActivation(location: number | undefined): boolean {
  return location !== undefined && location !== OCG_LOCATION_EXTRA;
}

/** Which `trigger` values are compatible with a given prompt context.
 *
 * Reasoning:
 * - SELECT_CHAIN happens during a chain window — only `chain` and `quick`
 *   effects can be activated then.
 * - SELECT_IDLECMD is the Main Phase activate command — only `main` and
 *   `quick` effects fit (`main` for ignition, `quick` for cards with quick
 *   effects that can also activate during your own MP).
 * - SELECT_BATTLECMD is during the Battle Phase chain window — `quick` only.
 * - SELECT_EFFECTYN is the prompt for "do you want to activate this trigger
 *   effect?" — `trigger` is the natural match.
 *
 * `continuous` triggers are NEVER consumed by player action (they're always-
 * on); they're not pushed into the activation log. */
export const TRIGGERS_FOR_PROMPT: Partial<Record<PromptType, ReadonlySet<InterruptionTrigger>>> = {
  'SELECT_CHAIN': new Set<InterruptionTrigger>(['chain', 'quick']),
  'SELECT_IDLECMD': new Set<InterruptionTrigger>(['main', 'quick']),
  'SELECT_BATTLECMD': new Set<InterruptionTrigger>(['quick']),
  'SELECT_EFFECTYN': new Set<InterruptionTrigger>(['trigger']),
};

/** Type-keyword fallback when an effect's `description` is not stored.
 *  Used by `disambiguateEffect` to match a runtime activation prompt against
 *  effect candidates whose triggers are identical (e.g. Underworld Goddess
 *  with omniNegate(quick) + controlChange(quick), or Baronne with
 *  omniNegate(quick) + destruction(main) at SELECT_IDLECMD).
 *
 *  Keywords are intentionally lowercase substring tokens — `String.includes`
 *  is enough; we don't need a real NLP layer for this. H1 fix from Epic 1
 *  review. */
const TYPE_KEYWORDS: Record<string, readonly string[]> = {
  omniNegate:     ['negate'],
  typedNegate:    ['negate'],
  targetedNegate: ['negate'],
  destruction:    ['destroy'],
  banish:         ['banish'],
  banishFacedown: ['banish'],
  bounce:         ['return', 'to the hand'],
  spin:           ['shuffle'],
  floodgate:      ['cannot', 'unless'],
  controlChange: ['take control', 'gain control', 'control of'],
  attach:         ['attach', 'xyz material'],
  flipFacedown:   ['face-down', 'facedown'],
  moveToSt:       ['spell & trap zone', 'continuous spell'],
  handRip:        ['discard'],
  sendToGy:       ['send', 'graveyard', 'to the gy'],
};

/** Score how well a runtime activation description matches an effect's
 *  stored description (or the type-keyword fallback when no description is
 *  stored). Higher = better match. */
function scoreEffectAgainstDescription(
  effect: InterruptionTag['effects'][number],
  runtimeDesc: string,
): number {
  const lower = runtimeDesc.toLowerCase();
  if (effect.description) {
    // Token overlap on words longer than 3 chars (skip "the", "and", "for"...)
    const tokens = effect.description.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 3);
    let hits = 0;
    for (const tok of tokens) if (lower.includes(tok)) hits++;
    return hits;
  }
  // No stored description → use type-keyword fallback. Each matching keyword
  // counts as one hit.
  const keywords = TYPE_KEYWORDS[effect.type] ?? [];
  let hits = 0;
  for (const kw of keywords) if (lower.includes(kw)) hits++;
  return hits;
}

/** Maps a runtime activation prompt to a specific effect index in
 *  `tag.effects[]`. Single-effect tags always return 0. For multi-effect
 *  tags, the prompt context is matched against each effect's `trigger`
 *  field via `TRIGGERS_FOR_PROMPT`. When trigger matching is ambiguous
 *  (multiple effects share the same trigger category — e.g. Underworld
 *  Goddess omniNegate(quick) + controlChange(quick)), the runtime
 *  activation `description` (extracted from OCGCore) is matched against
 *  each candidate's stored description or type-keywords. Falls back to
 *  index 0 with a warning when nothing matches.
 *
 *  `cardId` is passed for log readability — production grep wants both the
 *  human name AND the numeric id.
 *
 *  `runtimeDescription` is the OCGCore-emitted activation prompt text (set
 *  on `Action.description` by `enumerateActionsWithResponses` for
 *  SELECT_CHAIN, optional for other prompt types). H1 fix from Epic 1
 *  review — without this, multi-effect cards with same-trigger effects
 *  always logged the lowest-index effect, producing wrong OPT counts on
 *  meta cards (Underworld Goddess, Baronne via SELECT_IDLECMD, etc.). */
export function disambiguateEffect(
  tag: InterruptionTag,
  cardId: number,
  promptType: PromptType,
  runtimeDescription?: string,
): number {
  if (tag.effects.length === 1) return 0;

  const acceptedTriggers = TRIGGERS_FOR_PROMPT[promptType];
  if (!acceptedTriggers) {
    console.warn(`[Solver] effect-disambiguation-fallback: ${tag.cardName} (cardId=${cardId}) prompt ${promptType} not in TRIGGERS_FOR_PROMPT — using index 0`);
    return 0;
  }

  const matches: number[] = [];
  for (let i = 0; i < tag.effects.length; i++) {
    const t = tag.effects[i].trigger;
    if (t === undefined) continue;
    if (acceptedTriggers.has(t)) matches.push(i);
  }

  if (matches.length === 0) {
    console.warn(`[Solver] effect-disambiguation-fallback: ${tag.cardName} (cardId=${cardId}) no trigger matches prompt=${promptType} — using index 0`);
    return 0;
  }

  if (matches.length === 1) return matches[0];

  // Multiple effects share the trigger category. Use the runtime description
  // (if provided) to break the tie via keyword scoring. Highest score wins;
  // ties fall back to lowest index for determinism.
  if (runtimeDescription && runtimeDescription.length > 0) {
    let bestIdx = matches[0];
    let bestScore = -1;
    for (const i of matches) {
      const s = scoreEffectAgainstDescription(tag.effects[i], runtimeDescription);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestScore > 0) return bestIdx;
    // No keyword overlap — fall through to the lowest-index warning path
    // so production logs surface the gap.
  }

  console.warn(`[Solver] effect-disambiguation-ambiguous: ${tag.cardName} (cardId=${cardId}) prompt=${promptType} matches=[${matches.join(',')}] desc="${runtimeDescription ?? ''}" — using index ${matches[0]}`);
  return matches[0];
}
