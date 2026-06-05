import { test } from '@playwright/test';
import { runSoloBootstrapDeadlockHarness } from './solo-bootstrap-deadlock-harness';

test.describe('SOLO bootstrap deadlock — capture harness', () => {
  test.setTimeout(60_000);

  test('capture WS frames + console + snapshot poll for the radiant-typhoon fixture', async ({ context }) => {
    const outDir = await runSoloBootstrapDeadlockHarness(context, {
      captureMs: 20_000,
      pollIntervalMs: 500,
    });
    // eslint-disable-next-line no-console
    console.log(`\n[harness] dump written to ${outDir}`);
  });
});
