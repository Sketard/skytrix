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

  it('uses the deepest entry in a mixed input', () => {
    // CONNECTION_LIFETIME (idx 2) is deeper than SESSION_LIFETIME (idx 0)
    // → output should include the original SESSION_LIFETIME +
    //   everything from CONNECTION_LIFETIME onwards. DUEL_LIFETIME
    //   is NOT added because it lies between SESSION and CONNECTION
    //   and was not in the input.
    const out = expandInvalidatedScopes(
      new Set<ScopeCategory>(['SESSION_LIFETIME', 'CONNECTION_LIFETIME']),
    );
    expect(out.has('SESSION_LIFETIME')).toBeTrue();
    expect(out.has('CONNECTION_LIFETIME')).toBeTrue();
    expect(out.has('PERSPECTIVE_LIFETIME')).toBeTrue();
    expect(out.has('DUEL_LIFETIME')).toBeFalse();
  });

  it('does not mutate the input set', () => {
    const input = new Set<ScopeCategory>(['DUEL_LIFETIME']);
    expandInvalidatedScopes(input);
    expect(input.size).toBe(1);
    expect(input.has('DUEL_LIFETIME')).toBeTrue();
  });
});
