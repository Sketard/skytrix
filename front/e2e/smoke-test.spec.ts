import { test, expect, type BrowserContext } from '@playwright/test';
import {
  BASE_URL, ADMIN, ADMIN2, ensureAccount, loginViaUI, fetchOwnedDecks,
  createRoom, endRoom, joinRoomViaDeepLink,
} from './helpers';

test('smoke: creator + joiner reach READY state', async ({ browser }) => {
  const creatorContext: BrowserContext = await browser.newContext();
  const joinerContext: BrowserContext = await browser.newContext();
  let roomCode = '';
  try {
    await ensureAccount(creatorContext, ADMIN2);
    const cPage = await creatorContext.newPage();
    const jPage = await joinerContext.newPage();
    await loginViaUI(cPage, ADMIN);
    await loginViaUI(jPage, ADMIN2);
    const cDecks = await fetchOwnedDecks(creatorContext);
    const jDecks = await fetchOwnedDecks(joinerContext);
    expect(cDecks.length).toBeGreaterThan(0);
    expect(jDecks.length).toBeGreaterThan(0);

    const room = await createRoom(creatorContext, cDecks[0]!.id);
    roomCode = room.roomCode;
    console.log('Created room:', roomCode);

    await cPage.goto(`${BASE_URL}/pvp/duel/${roomCode}`);
    await expect(cPage.getByText(/En attente d'un adversaire/i)).toBeVisible({ timeout: 5000 });
    console.log('Creator in waiting');

    await joinRoomViaDeepLink(jPage, roomCode, jDecks[0]!.name);
    console.log('Joiner attempted join');

    await expect(cPage.getByRole('button', { name: /Lancer la partie/i })).toBeVisible({ timeout: 15000 });
    console.log('READY state reached');
  } finally {
    if (roomCode) {
      try { await endRoom(creatorContext, roomCode); } catch { /* ignore */ }
    }
    await creatorContext.close();
    await joinerContext.close();
  }
});
