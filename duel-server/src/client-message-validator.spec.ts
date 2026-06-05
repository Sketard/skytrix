import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateClientMessageForPlayer } from './client-message-validator.js';
import * as logger from './logger.js';

// =============================================================================
// γ Option C — A2 strict validation of `forPlayer` field
// =============================================================================
//
// T-S2 — `forPlayer` overrides `currentPlayerIndex` in SOLO. Scenario the
//        validator is consumed by: in SOLO multiplex the WS-derived
//        `currentPlayerIndex` is always 0 (both perspectives share
//        `players[0].ws`), so the routing override is the only way to
//        recover which perspective slot emitted the response.
// T-S6 — `forPlayer` in PvP normal is rejected with a warn (no dispatch).
//        Defense against the impersonation vector R2.
//
// The validator also hardens runtime against wire-level abuse: non-object
// payloads + non-`0 | 1` `forPlayer` values are rejected with their own
// warn (post-review hardening, code-review P1 + P2).

describe('client-message-validator — A2 `forPlayer` strict', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // ==========================================================================
  // T-S6 — PvP normal: forPlayer rejected with warn
  // ==========================================================================

  describe('T-S6 — PvP normal rejects `forPlayer`', () => {
    it('rejects PLAYER_RESPONSE with `forPlayer` defined and logs a warn', () => {
      const parsed = {
        type: 'PLAYER_RESPONSE',
        promptType: 'SELECT_CARD',
        data: { indices: [0] },
        forPlayer: 1,
      };

      const result = validateClientMessageForPlayer(parsed, false, 0, 'd1');

      expect(result).toEqual({ kind: 'reject', reason: 'forPlayer-in-pvp-normal' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [msg, ctx] = warnSpy.mock.calls[0]!;
      expect(msg).toContain('forPlayer field rejected');
      expect(ctx).toMatchObject({
        duelId: 'd1',
        from: 0,
        claimed: 1,
        type: 'PLAYER_RESPONSE',
      });
    });

    it('rejects SURRENDER with `forPlayer` defined in PvP normal', () => {
      const parsed = { type: 'SURRENDER', forPlayer: 0 };

      const result = validateClientMessageForPlayer(parsed, false, 1, 'd2');

      expect(result.kind).toBe('reject');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects even when `forPlayer === currentPlayerIndex` (no privileged self-tag)', () => {
      // A2 strict: PvP normal NEVER carries `forPlayer`. Even a payload tagging
      // the sender's own slot is a protocol violation (a legitimate PvP client
      // would not set the field at all). Avoids any partial-acceptance grey
      // zone in the impersonation counter.
      const parsed = {
        type: 'PLAYER_RESPONSE',
        promptType: 'SELECT_CARD',
        data: { indices: [] },
        forPlayer: 0,
      };

      const result = validateClientMessageForPlayer(parsed, false, 0, 'd3');

      expect(result.kind).toBe('reject');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('accepts PvP normal payload without `forPlayer` (legacy back-compat)', () => {
      const parsed = {
        type: 'PLAYER_RESPONSE',
        promptType: 'SELECT_CARD',
        data: { indices: [0] },
      };

      const result = validateClientMessageForPlayer(parsed, false, 1, 'd4');

      expect(result).toEqual({ kind: 'ok', live: 1 });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    // F7 review (animations-ready-protocol-2026-06-05) — A2 must reject
    // a PvP-normal ANIMATIONS_READY carrying `forPlayer`. The validator
    // is type-agnostic (rejects any non-undefined `forPlayer` in PvP),
    // so this pins the contract for the new message type explicitly.
    it('F7 review — rejects ANIMATIONS_READY with `forPlayer` in PvP normal (impersonation guard)', () => {
      const parsed = { type: 'ANIMATIONS_READY', forPlayer: 0 };

      const result = validateClientMessageForPlayer(parsed, false, 0, 'd-f7');

      expect(result.kind).toBe('reject');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [, ctx] = warnSpy.mock.calls[0]!;
      expect(ctx).toMatchObject({ type: 'ANIMATIONS_READY' });
    });

    it('F7 review — accepts PvP-normal ANIMATIONS_READY WITHOUT `forPlayer`', () => {
      const parsed = { type: 'ANIMATIONS_READY' };

      const result = validateClientMessageForPlayer(parsed, false, 1, 'd-f7');

      expect(result).toEqual({ kind: 'ok', live: 1 });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // T-S2 — SOLO: forPlayer overrides currentPlayerIndex
  // ==========================================================================

  describe('T-S2 — SOLO `forPlayer` overrides `currentPlayerIndex`', () => {
    it('routes PLAYER_RESPONSE{forPlayer:1} to live=1 even when captured socket index is 0', () => {
      const parsed = {
        type: 'PLAYER_RESPONSE',
        promptType: 'SELECT_CARD',
        data: { indices: [2] },
        forPlayer: 1,
      };

      const result = validateClientMessageForPlayer(parsed, true, 0, 'solo-d1');

      expect(result).toEqual({ kind: 'ok', live: 1 });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('routes PLAYER_RESPONSE{forPlayer:0} to live=0', () => {
      const parsed = {
        type: 'PLAYER_RESPONSE',
        promptType: 'SELECT_CARD',
        data: { indices: [] },
        forPlayer: 0,
      };

      const result = validateClientMessageForPlayer(parsed, true, 0, 'solo-d2');

      expect(result).toEqual({ kind: 'ok', live: 0 });
    });

    it('falls back to `currentPlayerIndex` when `forPlayer` is absent in SOLO', () => {
      // Legacy SOLO client (pre-γ Option C) or bootstrap path without a
      // tracked last `forPlayer` — the captured socket index is used.
      const parsed = { type: 'ACTIVITY_PING' };

      const result = validateClientMessageForPlayer(parsed, true, 0, 'solo-d3');

      expect(result).toEqual({ kind: 'ok', live: 0 });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('falls back to `currentPlayerIndex=1` when `forPlayer` is absent in SOLO', () => {
      // Locks the `?? currentPlayerIndex` branch on the asymmetric input side.
      const parsed = { type: 'ACTIVITY_PING' };

      const result = validateClientMessageForPlayer(parsed, true, 1, 'solo-d3b');

      expect(result).toEqual({ kind: 'ok', live: 1 });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    // F7 review (animations-ready-protocol-2026-06-05) — SOLO multiplex
    // tags `forPlayer: 0` on ANIMATIONS_READY via
    // `DuelWebSocketService.sendAnimationsReady` (the single live slot).
    // Pin the validator's acceptance of that exact shape.
    it('F7 review — accepts SOLO ANIMATIONS_READY{forPlayer:0}', () => {
      const parsed = { type: 'ANIMATIONS_READY', forPlayer: 0 };

      const result = validateClientMessageForPlayer(parsed, true, 0, 'solo-f7');

      expect(result).toEqual({ kind: 'ok', live: 0 });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('forwards SURRENDER{forPlayer:1} in SOLO without warn', () => {
      const parsed = { type: 'SURRENDER', forPlayer: 1 };

      const result = validateClientMessageForPlayer(parsed, true, 0, 'solo-d4');

      expect(result).toEqual({ kind: 'ok', live: 1 });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Runtime hardening — non-object payloads + invalid `forPlayer` values
  //
  // The wire is JSON; the TS cast `(parsed as { forPlayer?: 0 | 1 })` does
  // not validate at runtime. Without these guards, `forPlayer: 2` would
  // propagate as `live: 2`, `players[2] === undefined`, and downstream
  // dispatchers would mis-route or crash. Closes code-review findings
  // P1 + P2.
  // ==========================================================================

  describe('runtime hardening — non-object payloads (P2)', () => {
    it('rejects `null` parsed payload with `non-object-payload`', () => {
      const result = validateClientMessageForPlayer(null, false, 0, 'd5');

      expect(result).toEqual({ kind: 'reject', reason: 'non-object-payload' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![1]).toMatchObject({ payloadType: 'null' });
    });

    it('rejects primitive parsed payload (`42`)', () => {
      const result = validateClientMessageForPlayer(42, true, 0, 'd6');

      expect(result.kind).toBe('reject');
      expect(warnSpy.mock.calls[0]![1]).toMatchObject({ payloadType: 'number' });
    });

    it('rejects string parsed payload', () => {
      const result = validateClientMessageForPlayer('abc', false, 1, 'd7');

      expect(result.kind).toBe('reject');
      expect(warnSpy.mock.calls[0]![1]).toMatchObject({ payloadType: 'string' });
    });

    it('rejects array parsed payload', () => {
      const result = validateClientMessageForPlayer([1, 2, 3], true, 0, 'd8');

      expect(result.kind).toBe('reject');
      expect(warnSpy.mock.calls[0]![1]).toMatchObject({ payloadType: 'array' });
    });
  });

  describe('runtime hardening — invalid `forPlayer` value (P1)', () => {
    it.each([2, -1, 1.5, null, false, true, '0', '1', 'foo', NaN, Infinity])(
      'rejects `forPlayer = %p` in SOLO with `forPlayer-invalid`',
      (badValue) => {
        const parsed = { type: 'ACTIVITY_PING', forPlayer: badValue };

        const result = validateClientMessageForPlayer(parsed, true, 0, 'd9');

        expect(result).toEqual({ kind: 'reject', reason: 'forPlayer-invalid' });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [msg, ctx] = warnSpy.mock.calls[0]!;
        expect(msg).toContain('forPlayer field rejected (invalid value');
        expect(ctx).toMatchObject({
          duelId: 'd9',
          from: 0,
          claimed: badValue,
          type: 'ACTIVITY_PING',
        });
      },
    );

    it.each([2, -1, null, false, '1'])(
      'rejects `forPlayer = %p` in PvP normal with `forPlayer-invalid` (invalid check precedes A2)',
      (badValue) => {
        // The invalid-value guard runs BEFORE the PvP-rejection guard so the
        // telemetry classifies impersonation attempts (valid `0 | 1` tags from
        // a PvP wire) separately from outright protocol abuse (garbage values).
        const parsed = { type: 'PLAYER_RESPONSE', promptType: 'SELECT_CARD', data: {}, forPlayer: badValue };

        const result = validateClientMessageForPlayer(parsed, false, 0, 'd10');

        expect(result).toEqual({ kind: 'reject', reason: 'forPlayer-invalid' });
      },
    );
  });
});
