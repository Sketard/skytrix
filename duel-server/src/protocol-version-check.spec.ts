import { describe, it, expect } from 'vitest';
import { checkProtocolVersionPure } from './protocol-version-check.js';
import { PROTOCOL_VERSION } from './ws-protocol-shared.js';

// =============================================================================
// U2 (audit-4-modes-2026-06-01) — Confidence floor for the PROTOCOL_VERSION
// handshake. The function was extracted from server.ts explicitly "for unit-
// testability" (cf. docstring) but no spec existed. When PROTOCOL_VERSION is
// bumped (e.g. on a new system message addition), the parsing edge cases
// (absent / non-numeric / wrong number) MUST stay correctly rejected so a
// stale-bundle client gets the 4426 close, not a silent passthrough.
// =============================================================================

describe('checkProtocolVersionPure (U2)', () => {
  it('accepts the matching server version', () => {
    const r = checkProtocolVersionPure(String(PROTOCOL_VERSION));
    expect(r.ok).toBe(true);
  });

  it('rejects null (pv query param absent)', () => {
    const r = checkProtocolVersionPure(null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rawClientVersion).toBeNull();
      expect(r.parsedClientVersion).toBeNull();
      expect(r.serverVersion).toBe(PROTOCOL_VERSION);
    }
  });

  it('rejects non-numeric "abc" (Number("abc") → NaN)', () => {
    const r = checkProtocolVersionPure('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rawClientVersion).toBe('abc');
      expect(Number.isNaN(r.parsedClientVersion)).toBe(true);
    }
  });

  it('rejects empty string ""', () => {
    // Number('') is 0 — a legitimately mismatched numeric, not NaN. Still
    // rejected because 0 !== PROTOCOL_VERSION.
    const r = checkProtocolVersionPure('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.parsedClientVersion).toBe(0);
  });

  it('rejects numeric mismatch (server + 1)', () => {
    const r = checkProtocolVersionPure(String(PROTOCOL_VERSION + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.parsedClientVersion).toBe(PROTOCOL_VERSION + 1);
  });

  it('rejects negative numeric mismatch', () => {
    const r = checkProtocolVersionPure('-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.parsedClientVersion).toBe(-1);
  });
});
