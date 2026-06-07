import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

/** Playwright config for skytrix e2e.
 *
 *  Two modes:
 *  - default: targets the user's hand-driven stack on the canonical
 *    ports (back :8080 / duel :3001 / front :4200). Assumes that stack
 *    is already up — typical workflow when the user is actively coding
 *    in the browser and wants Playwright to drive what they see.
 *  - PW_AUTO_STACK=1: globalSetup invokes scripts/dev-stack.mjs
 *    ensureStack() which brings up an isolated stack on shifted ports
 *    (15432/18080/13001/14200) so it cohabits with whatever the user
 *    is doing. helpers.ts reads E2E_BASE_URL / E2E_BACK_URL env vars
 *    set below. Use this when Claude debugs e2e in parallel sessions,
 *    or for CI runs that shouldn't depend on a pre-existing stack.
 */

// Playwright loads .ts configs via pirates in CJS mode, so `__dirname` is
// already defined globally — using `import.meta.url` here throws
// "exports is not defined in ES module scope" at evaluation.
const USE_AUTO_STACK = !!process.env['PW_AUTO_STACK'];

if (USE_AUTO_STACK) {
  // Tell helpers.ts + Playwright baseURL where to find the isolated stack.
  process.env['E2E_BASE_URL'] ??= 'http://localhost:14200';
  process.env['E2E_BACK_URL'] ??= 'http://localhost:18080';
  // 2026-06-07 — parity harness reads E2E_DUEL_SERVER_URL via
  // capture-solo-stream.ts to talk to /api/duels/from-replay. Without
  // this, PW_AUTO_STACK runs hit :3001 (canonical) instead of :13001
  // (isolated) and ECONNREFUSED.
  process.env['E2E_DUEL_SERVER_URL'] ??= 'http://localhost:13001';
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: USE_AUTO_STACK ? resolve(__dirname, '../scripts/playwright-global-setup.mjs') : undefined,
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
