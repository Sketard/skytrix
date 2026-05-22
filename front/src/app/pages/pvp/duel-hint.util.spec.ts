import {
  HintResolveDeps,
  KNOWN_HINT_TYPES,
  resolveHintAction,
  resolveHintTimingLabel,
  TIMING_STRING_ID,
} from './duel-hint.util';

// =============================================================================
// duel-hint.util specs — pure resolvers for MSG_HINT / SELECT_CHAIN hint text.
// Each hintType branch mirrors the duel-server's former `transformHint`; the
// `deps` are mocked so the test pins the dispatch, not the resolution data.
// =============================================================================

/** Builds a `HintResolveDeps` mock — each resolver echoes a tagged string. */
function makeDeps(overrides: Partial<HintResolveDeps> = {}): HintResolveDeps {
  return {
    resolveSystemString: idx => `sys:${idx}`,
    resolveCardName: code => `card:${code}`,
    resolveRace: bitmask => `race:${bitmask}`,
    resolveAttribute: bitmask => `attr:${bitmask}`,
    ...overrides,
  };
}

describe('resolveHintAction', () => {
  it('type 1 (HINT_EVENT) resolves value as a system-string index', () => {
    expect(resolveHintAction(1, 20, makeDeps())).toBe('sys:20');
  });

  it('type 2 (HINT_MESSAGE) resolves value as a system-string index', () => {
    expect(resolveHintAction(2, 504, makeDeps())).toBe('sys:504');
  });

  it('type 3 (HINT_SELECTMSG) prefers the system string when it resolves', () => {
    expect(resolveHintAction(3, 42, makeDeps())).toBe('sys:42');
  });

  it('type 3 falls back to the card name when the system string is empty', () => {
    const deps = makeDeps({ resolveSystemString: () => '' });
    expect(resolveHintAction(3, 87746184, deps)).toBe('card:87746184');
  });

  it('type 4 (HINT_OPSELECTED) prefers the system string when it resolves', () => {
    expect(resolveHintAction(4, 7, makeDeps())).toBe('sys:7');
  });

  it('type 4 falls back to the card name when the system string is empty', () => {
    const deps = makeDeps({ resolveSystemString: () => '' });
    expect(resolveHintAction(4, 12345678, deps)).toBe('card:12345678');
  });

  it('type 6 (HINT_RACE) resolves value as a race bitmask', () => {
    expect(resolveHintAction(6, 8192, makeDeps())).toBe('race:8192');
  });

  it('type 7 (HINT_ATTRIB) resolves value as an attribute bitmask', () => {
    expect(resolveHintAction(7, 32, makeDeps())).toBe('attr:32');
  });

  it('type 9 (HINT_NUMBER) stringifies the value with no translation', () => {
    expect(resolveHintAction(9, 2000, makeDeps())).toBe('2000');
  });

  it('card-code hint types (5/8/10/13/15) resolve value as a card code', () => {
    for (const t of [5, 8, 10, 13, 15]) {
      expect(resolveHintAction(t, 66666666, makeDeps())).toBe('card:66666666');
    }
  });

  it('returns "" for an unanticipated hintType (caller surfaces it)', () => {
    expect(resolveHintAction(99, 1, makeDeps())).toBe('');
  });

  it('KNOWN_HINT_TYPES covers every type resolveHintAction handles', () => {
    for (const t of [1, 2, 3, 4, 6, 7, 9, 5, 8, 10, 13, 15]) {
      expect(KNOWN_HINT_TYPES.has(t)).toBe(true);
    }
    expect(KNOWN_HINT_TYPES.has(99)).toBe(false);
  });
});

describe('resolveHintTimingLabel', () => {
  it('resolves a known hintTiming via TIMING_STRING_ID', () => {
    // 0x08 → string index 80 (Entering the Battle Phase).
    expect(resolveHintTimingLabel(0x08, makeDeps())).toBe('sys:80');
  });

  it('resolves every mapped hintTiming through its system-string index', () => {
    for (const [timing, strIndex] of Object.entries(TIMING_STRING_ID)) {
      expect(resolveHintTimingLabel(Number(timing), makeDeps())).toBe(`sys:${strIndex}`);
    }
  });

  it('returns "" for a hintTiming not in the map (no timing prefix)', () => {
    expect(resolveHintTimingLabel(0x1000, makeDeps())).toBe('');
  });

  it('returns "" for hintTiming 0', () => {
    expect(resolveHintTimingLabel(0, makeDeps())).toBe('');
  });
});
