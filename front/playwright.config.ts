import { defineConfig, devices } from '@playwright/test';

/** Minimal Playwright config for the cache/prefetch validation scenario.
 *  Targets a locally-running stack (back: 8080, duel-server: 3001, front: 4200).
 *  No webServer auto-start — assumes the dev stack is already up. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
