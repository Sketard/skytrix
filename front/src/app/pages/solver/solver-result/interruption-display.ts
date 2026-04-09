// =============================================================================
// interruption-display.ts — Single source of truth for interruption-type
// presentation: chip color family, display label, and weight order. Shared by
// hero result block, decision tree, and any future result component that
// surfaces ScoreBreakdown entries.
// =============================================================================

/** Interruption types in descending importance for badge selection. */
export const EFFECT_WEIGHT_ORDER: readonly string[] = [
  'omniNegate', 'typedNegate', 'targetedNegate', 'floodgate',
  'controlChange', 'banish', 'banishFacedown', 'attach',
  'spin', 'flipFacedown', 'destruction', 'moveToSt',
  'bounce', 'handRip', 'sendToGy',
];

/** Maps each interruption type to one of the 5 SCSS chip color families. */
export const CHIP_COLOR_MAP: Record<string, string> = {
  omniNegate:     'var(--solver-chip-negate)',
  typedNegate:    'var(--solver-chip-negate)',
  targetedNegate: 'var(--solver-chip-negate)',
  destruction:    'var(--solver-chip-removal)',
  banish:         'var(--solver-chip-removal)',
  banishFacedown: 'var(--solver-chip-removal)',
  sendToGy:       'var(--solver-chip-removal)',
  bounce:         'var(--solver-chip-control)',
  spin:           'var(--solver-chip-control)',
  controlChange:  'var(--solver-chip-control)',
  attach:         'var(--solver-chip-control)',
  moveToSt:       'var(--solver-chip-control)',
  floodgate:      'var(--solver-chip-disable)',
  flipFacedown:   'var(--solver-chip-disable)',
  handRip:        'var(--solver-chip-hand)',
};

export const AMBER_COLOR = 'var(--solver-chip-disable)';

/** Short display label per interruption type (kebab-case). */
export const DISPLAY_LABELS: Record<string, string> = {
  omniNegate:     'omni-negate',
  typedNegate:    'typed-negate',
  targetedNegate: 'targeted-negate',
  floodgate:      'floodgate',
  controlChange:  'control-change',
  banish:         'banish',
  banishFacedown: 'banish-fd',
  attach:         'attach',
  spin:           'spin',
  flipFacedown:   'flip-fd',
  destruction:    'destruction',
  moveToSt:       'move-to-st',
  bounce:         'bounce',
  handRip:        'hand-rip',
  sendToGy:       'send-to-gy',
};
