import { test, expect } from '@playwright/test';
import { runSoloPvpDebug, captureFrame } from './solo-pvp-harness';

/**
 * γ commit 7b — SOLO PvP harness smoke test.
 *
 * Verifies the harness module loads without TS errors and exposes its
 * documented entry point. Does NOT exercise the live stack — that
 * requires back 8080, duel-server 3001, and a seeded admin deck, none of
 * which CI sets up. The end-to-end T2-T10 runs are scripted manually
 * per the checklist at
 * `_bmad-output/phase-gamma/test-T2-T10-manual-checklist.md` ; running
 * them is the user's job (they need a live deck + chain-capable card to
 * trigger the bug-solo sequence).
 *
 * If this spec fails, the harness module has a regression — either a
 * TS surface change or a missing export. The fix lives in
 * `front/e2e/solo-pvp-harness.ts`.
 */
test('harness module exports runSoloPvpDebug + captureFrame', async () => {
  expect(typeof runSoloPvpDebug).toBe('function');
  expect(typeof captureFrame).toBe('function');
});
