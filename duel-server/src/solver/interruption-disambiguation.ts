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

/** Maps a runtime activation prompt to a specific effect index in
 *  `tag.effects[]`. Single-effect tags always return 0. For multi-effect
 *  tags, the prompt context is matched against each effect's `trigger`
 *  field via `TRIGGERS_FOR_PROMPT`. Falls back to index 0 with a warning
 *  when no effect matches; returns the lowest-index match (with a warning)
 *  when multiple effects match.
 *
 *  `cardId` is passed for log readability — production grep wants both the
 *  human name AND the numeric id. */
export function disambiguateEffect(
  tag: InterruptionTag,
  cardId: number,
  promptType: PromptType,
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

  // Multiple effects match — true ambiguity. Pick lowest index. Rare in
  // practice (most multi-effect cards have differently-typed triggers).
  console.warn(`[Solver] effect-disambiguation-ambiguous: ${tag.cardName} (cardId=${cardId}) prompt=${promptType} matches=[${matches.join(',')}] — using index ${matches[0]}`);
  return matches[0];
}
