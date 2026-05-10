import { PROTOCOL_VERSION } from './ws-protocol-shared.js';

/**
 * Pure protocol-version check, extracted from server.ts for unit-testability.
 *
 * Compares the `pv` query param against the server-side `PROTOCOL_VERSION`.
 * Returns a discriminated decision so the caller can apply the appropriate
 * side-effects (rate-limiter strike + ws.close(4426) on mismatch).
 *
 * Mismatch semantics:
 *  - `pv` absent → mismatch (treated as "missing")
 *  - `pv` present but non-numeric → `Number(raw)` returns NaN → mismatch
 *  - `pv` present and numeric but != server → mismatch
 */
export interface ProtocolVersionMatch {
  ok: true;
}

export interface ProtocolVersionMismatch {
  ok: false;
  /** Raw value from the `pv` query param (string or null), preserved for logs. */
  rawClientVersion: string | null;
  /** Server's pinned protocol version. */
  serverVersion: number;
  /** Client's parsed numeric version, or NaN if non-numeric, or null if absent. */
  parsedClientVersion: number | null;
}

export type ProtocolVersionResult = ProtocolVersionMatch | ProtocolVersionMismatch;

export function checkProtocolVersionPure(rawPv: string | null): ProtocolVersionResult {
  const parsedClientVersion = rawPv === null ? null : Number(rawPv);
  if (parsedClientVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      rawClientVersion: rawPv,
      serverVersion: PROTOCOL_VERSION,
      parsedClientVersion,
    };
  }
  return { ok: true };
}
