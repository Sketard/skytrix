import { defineConfig, devices } from '@playwright/test';

/** POC-only Playwright config — runs the POC projection spec on both
 *  chromium and webkit. Kept separate from the main playwright.config.ts
 *  so the main e2e runs aren't slowed down by an extra browser install. */
export default defineConfig({
  testDir: './e2e',
  testMatch: /poc-projection-transform\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
