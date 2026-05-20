import { test, expect } from '@playwright/test';
import { BACK_URL } from './helpers';
import { buildPageCatalog, runResponsiveAudit, DEFAULT_VIEWPORTS } from './responsive-audit-harness';

/**
 * Smoke-test for the responsive-audit harness: 2 pages × 2 viewports +
 * 1 interactive state + EN locale, with axe enabled. Used to verify the
 * pipeline before committing to the full ~3-min full-grid run.
 *
 * Output → `_bmad-output/responsive-audit-smoke/`. Safe to nuke between runs.
 */

test.describe('Responsive audit — smoke', () => {
  test.setTimeout(3 * 60 * 1000);

  test('2 pages × 2 viewports + EN + 1 state + axe', async ({ context }) => {
    // Get a replay id for the catalog (used by the full builder)
    const loginRes = await context.request.post(`${BACK_URL}/api/login`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:admin').toString('base64') },
    });
    expect(loginRes.status()).toBe(200);

    const replaysRes = await context.request.get(`${BACK_URL}/api/replays?page=0&size=1`);
    const replays = await replaysRes.json();
    const replayId: string = replays.elements?.[0]?.id;
    expect(replayId).toBeTruthy();

    const catalog = buildPageCatalog({ replayId, deckId: 19, deckName: 'Fireking' });
    const { outputDir, findings } = await runResponsiveAudit(
      context,
      catalog,
      DEFAULT_VIEWPORTS,
      {
        outputTag: 'responsive-audit-smoke',
        onlyPages: ['01-login', '08-pvp-lobby'],  // 1 unauth + 1 auth with states + EN
        onlyViewports: ['360', '1280'],            // 1 mobile + 1 desktop
      },
    );

    console.log(`\n  → ${findings.length} captures in ${outputDir}`);

    // Sanity: should produce captures for both pages × both viewports × {initial, ?state} × {fr, ?en}
    // 01-login: 1 state (loginError), runInEnglish=true → 2 vp × (1+1) × 2 = 8
    // 08-pvp-lobby: 2 states (quickDuel, createRoom), runInEnglish=true → 2 vp × (1+2) × 2 = 12
    // total expected = 20
    expect(findings.length).toBeGreaterThanOrEqual(12);

    // At least one capture must have run axe successfully (CDN reachable + axe global there)
    const axeOk = findings.filter(f => f.axeRanOk).length;
    console.log(`  axe ran ok on: ${axeOk} / ${findings.length} captures`);
    expect(axeOk, 'axe-core CDN injection should work on at least one capture').toBeGreaterThan(0);

    // At least one capture should be in EN
    const en = findings.filter(f => f.locale === 'en').length;
    console.log(`  EN captures: ${en}`);
    expect(en).toBeGreaterThan(0);

    // At least one capture should be a state (not 'initial')
    const stateCaptures = findings.filter(f => f.state !== 'initial').length;
    console.log(`  state captures: ${stateCaptures}`);
    expect(stateCaptures).toBeGreaterThan(0);
  });
});
