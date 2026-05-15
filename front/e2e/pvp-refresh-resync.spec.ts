import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  BASE_URL,
  ADMIN,
  ADMIN2,
  type ShortDeck,
  loginViaUI,
  ensureAccount,
  fetchOwnedDecks,
  createRoom,
  endRoom,
  joinRoomViaDeepLink,
  waitForBoard,
} from './helpers';

/**
 * Validates that a page refresh during pre-duel phases lands the client
 * back on the correct dice-arena stage. Pairs with the server-side
 * `buildPreDuelSnapshot` (duel-server/src/pre-duel-snapshot.ts) + the
 * client `_finalSeen` / `finalGoFirst` latches.
 *
 * Coverage:
 *   - Refresh during FIRST_PLAYER_RESOLVED → final + announce text.
 *
 * CHOOSE_FIRST_PLAYER + ROLLING_DICE are too tight for Playwright in a
 * dev environment — by the time the front bundle hot-reloads and the
 * WS handshake reconnects (~5–10s), the SELECT_FIRST_PLAYER 15s
 * timeout has already auto-resolved into FIRST_PLAYER_RESOLVED → DUELING,
 * and the dice arena no longer renders. Both phases are covered by the
 * `pre-duel-snapshot.spec.ts` unit tests on the server side instead.
 */

test.describe('PvP refresh resync — pre-duel phases', () => {
  test.describe.configure({ mode: 'serial' });

  let creatorContext: BrowserContext;
  let joinerContext: BrowserContext;
  let creatorPage: Page;
  let joinerPage: Page;
  let creatorDeck: ShortDeck;
  let joinerDeck: ShortDeck;
  let roomCode = '';

  test.beforeAll(async ({ browser }) => {
    creatorContext = await browser.newContext();
    joinerContext = await browser.newContext();
    await ensureAccount(creatorContext, ADMIN2);
    creatorPage = await creatorContext.newPage();
    joinerPage = await joinerContext.newPage();
    await loginViaUI(creatorPage, ADMIN);
    await loginViaUI(joinerPage, ADMIN2);
    const creatorDecks = await fetchOwnedDecks(creatorContext);
    const joinerDecks = await fetchOwnedDecks(joinerContext);
    expect(creatorDecks.length).toBeGreaterThan(0);
    expect(joinerDecks.length).toBeGreaterThan(0);
    creatorDeck = creatorDecks[0]!;
    joinerDeck = joinerDecks[0]!;
  });

  test.afterAll(async () => {
    if (roomCode) {
      try { await endRoom(creatorContext, roomCode); } catch { /* ignore */ }
    }
    await creatorContext.close();
    await joinerContext.close();
  });

  /** Probe the dice arena DOM to derive its current stage. The template
   *  exposes distinctive markers per stage:
   *    `prep`    → `.dice-stage--prep`
   *    `ready`   → arena visible, no banner / no announce, no rollStrip
   *    `rolling` → `.dice-mover.animating`
   *    `result`  → `.dice-banner` (won/lost/draw) + `.dice-roll-strip`
   *    `final`   → `.dice-final-announce`
   *    `idle`    → no `.dice-arena-overlay`
   */
  async function diceStage(page: Page): Promise<string> {
    return page.evaluate(() => {
      const overlay = !!document.querySelector('.dice-arena-overlay');
      if (!overlay) return 'idle';
      if (document.querySelector('.dice-stage--prep')) return 'prep';
      if (document.querySelector('.dice-final-announce')) return 'final';
      if (document.querySelector('.dice-banner')) return 'result';
      if (document.querySelector('.dice-mover.animating')) return 'rolling';
      // Default if the overlay is mounted but no stage-specific marker.
      return 'ready';
    });
  }

  test('refresh during FIRST_PLAYER_RESOLVED → lands on `final` with announce text latched', async () => {
    const createdRoom = await createRoom(creatorContext, creatorDeck.id);
    roomCode = createdRoom.roomCode;

    await creatorPage.goto(`${BASE_URL}/pvp/duel/${roomCode}`);
    await joinRoomViaDeepLink(joinerPage, roomCode, joinerDeck.name);

    await expect(creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i })).toBeVisible({ timeout: 10000 });
    await creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i }).click();

    // Wait for the turn-choice button + click it. Whichever side won the
    // roll exposes it.
    const winningPage = await Promise.race([
      creatorPage.getByRole('button', { name: /Je commence|I start/i }).waitFor({ timeout: 30000 }).then(() => creatorPage),
      joinerPage.getByRole('button', { name: /Je commence|I start/i }).waitFor({ timeout: 30000 }).then(() => joinerPage),
    ]);
    await winningPage.getByRole('button', { name: /Je commence|I start/i }).click();

    // We're now in the FINAL_BANNER_MS (2.5s) announce window. Refresh
    // before the window expires + before the worker has sent BOARD_STATE.
    // The window is ~2.5s; reload as fast as we can after the click.
    const otherPage = winningPage === creatorPage ? joinerPage : creatorPage;
    await otherPage.reload();

    // After resync: server replays DICE_RESULT + DECK_PREFETCH +
    // FIRST_PLAYER_RESULT. Client should land on `final` with the
    // announce visible.
    await expect(async () => {
      expect(await diceStage(otherPage)).toBe('final');
    }).toPass({ timeout: 8000 });

    // Announce text should reflect who goes first (looser side =
    // goFirst=false unless the winner picked second).
    const announceText = await otherPage.locator('.dice-final-announce__headline').first().textContent();
    expect(announceText).toMatch(/Tu joues en (premier|second)|You go (first|second)/i);

    // Wait for the board to come up on both sides — confirms the
    // refresh didn't disrupt the duel start.
    await waitForBoard(creatorPage);
    await waitForBoard(joinerPage);
    roomCode = '';
  });
});
