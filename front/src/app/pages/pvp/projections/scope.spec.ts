import { expandInvalidatedScopes, SCOPE_HIERARCHY, ScopeCategory } from './scope';

describe('expandInvalidatedScopes', () => {
  it('returns an empty set when input is empty', () => {
    const out = expandInvalidatedScopes(new Set());
    expect(out.size).toBe(0);
  });

  it('expands DUEL_LIFETIME down to PERSPECTIVE_LIFETIME', () => {
    const out = expandInvalidatedScopes(new Set<ScopeCategory>(['DUEL_LIFETIME']));
    expect(out.has('DUEL_LIFETIME')).toBeTrue();
    expect(out.has('CONNECTION_LIFETIME')).toBeTrue();
    expect(out.has('PERSPECTIVE_LIFETIME')).toBeTrue();
    expect(out.has('SESSION_LIFETIME')).toBeFalse();
  });

  it('expands SESSION_LIFETIME down to everything else', () => {
    const out = expandInvalidatedScopes(new Set<ScopeCategory>(['SESSION_LIFETIME']));
    expect(out.size).toBe(SCOPE_HIERARCHY.length);
    for (const s of SCOPE_HIERARCHY) expect(out.has(s)).toBeTrue();
  });

  it('expands PERSPECTIVE_LIFETIME to itself only (already deepest)', () => {
    const out = expandInvalidatedScopes(
      new Set<ScopeCategory>(['PERSPECTIVE_LIFETIME']),
    );
    expect(out.size).toBe(1);
    expect(out.has('PERSPECTIVE_LIFETIME')).toBeTrue();
  });

  it('fills gaps below the shallowest entry in a mixed input (P9 hardening 2026-05-26)', () => {
    // SESSION_LIFETIME (idx 0) is the shallowest = most-durable = highest;
    // anything below it (DUEL, CONNECTION, PERSPECTIVE) is implicitly
    // invalidated. The result therefore fills DUEL even though the input
    // only named SESSION + CONNECTION. Previous algorithm anchored on the
    // deepest entry and dropped DUEL silently — see code-review #2.
    const out = expandInvalidatedScopes(
      new Set<ScopeCategory>(['SESSION_LIFETIME', 'CONNECTION_LIFETIME']),
    );
    expect(out.has('SESSION_LIFETIME')).toBeTrue();
    expect(out.has('DUEL_LIFETIME')).toBeTrue();
    expect(out.has('CONNECTION_LIFETIME')).toBeTrue();
    expect(out.has('PERSPECTIVE_LIFETIME')).toBeTrue();
    expect(out.size).toBe(4);
  });

  it('expands non-contiguous {DUEL_LIFETIME, PERSPECTIVE_LIFETIME} to include CONNECTION_LIFETIME', () => {
    const out = expandInvalidatedScopes(
      new Set<ScopeCategory>(['DUEL_LIFETIME', 'PERSPECTIVE_LIFETIME']),
    );
    expect(out.has('SESSION_LIFETIME')).toBeFalse();
    expect(out.has('DUEL_LIFETIME')).toBeTrue();
    expect(out.has('CONNECTION_LIFETIME')).toBeTrue();
    expect(out.has('PERSPECTIVE_LIFETIME')).toBeTrue();
    expect(out.size).toBe(3);
  });

  it('does not mutate the input set', () => {
    const input = new Set<ScopeCategory>(['DUEL_LIFETIME']);
    expandInvalidatedScopes(input);
    expect(input.size).toBe(1);
    expect(input.has('DUEL_LIFETIME')).toBeTrue();
  });
});
