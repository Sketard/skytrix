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
} from './helpers';

/**
 * Validates the READY-state waiting-room flow shipped in commits
 * `feat(pvp): introduce READY state` / `feat(pvp): waiting room READY state`.
 *
 * Two browser contexts (creator + joiner) — admin / admin2.
 *
 * Happy path:
 *   1. admin creates a room with deck A
 *   2. admin2 opens the deep-link, picks deck B
 *   3. joinRoom returns status=READY — both players are in the waiting room
 *   4. admin clicks "Lancer la partie" → POST /start
 *   5. both contexts land on the duel board (board zones visible)
 *
 * Kick path:
 *   1. admin creates a room with deck A
 *   2. admin2 joins with deck B → status=READY
 *   3. admin clicks "Exclure" → POST /kick
 *   4. admin2's UI redirects to /pvp with the KICKED_FROM_ROOM toast
 *   5. admin's UI returns to the WAITING state
 *
 * Setup:
 *   - admin / admin   (creator) — owns at least one deck
 *   - admin2 / admin  (joiner)  — owns at least one valid deck
 *   - Dev stack up: back:8080, duel-server:3001, front:4200
 *
 * The spec creates admin2 idempotently via ensureAccount() but does NOT
 * seed decks — admin2 must already own at least one playable deck.
 */

test.describe('PvP READY state — waiting room start / kick', () => {
  test.describe.configure({ mode: 'serial' });

  let creatorContext: BrowserContext;
  let joinerContext: BrowserContext;
  let creatorPage: Page;
  let joinerPage: Page;
  let creatorDeck: ShortDeck;
  let joinerDeck: ShortDeck;
  let roomCode: string;

  test.beforeAll(async ({ browser }) => {
    creatorContext = await browser.newContext();
    joinerContext = await browser.newContext();

    // Make sure admin2 exists. Decks themselves cannot be created from
    // this spec — admin2 must already own at least one.
    await ensureAccount(creatorContext, ADMIN2);

    creatorPage = await creatorContext.newPage();
    joinerPage = await joinerContext.newPage();

    await loginViaUI(creatorPage, ADMIN);
    await loginViaUI(joinerPage, ADMIN2);

    const creatorDecks = await fetchOwnedDecks(creatorContext);
    const joinerDecks = await fetchOwnedDecks(joinerContext);
    expect(creatorDecks.length, 'creator must own at least one deck').toBeGreaterThan(0);
    expect(joinerDecks.length, 'joiner (admin2) must own at least one deck — build one via the UI first').toBeGreaterThan(0);
    creatorDeck = creatorDecks[0]!;
    joinerDeck = joinerDecks[0]!;
  });

  test.afterAll(async () => {
    if (roomCode) {
      try { await endRoom(creatorContext, roomCode); } catch {}
    }
    await creatorContext.close();
    await joinerContext.close();
  });

  test('happy path: join → READY → creator starts → both see the duel board', async () => {
    const createdRoom = await createRoom(creatorContext, creatorDeck.id);
    roomCode = createdRoom.roomCode;

    await creatorPage.goto(`${BASE_URL}/pvp/duel/${roomCode}`);
    await expect(creatorPage.getByText(/En attente d'un adversaire|Waiting for an opponent/i)).toBeVisible({ timeout: 5000 });

    await joinRoomViaDeepLink(joinerPage, roomCode, joinerDeck.name);

    // Both pages are in the READY-state waiting room:
    //   - creator sees "Lancer la partie" (CTA, creator-only)
    //   - joiner sees "L'hôte va lancer la partie..." (hint)
    await expect(creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i })).toBeVisible({ timeout: 10000 });
    await expect(joinerPage.getByText(/L'hôte va lancer|Host is about to start/i)).toBeVisible({ timeout: 10000 });

    await creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i }).click();

    // Both pages reach the duel board (board zones rendered)
    await expect(creatorPage.locator('[data-zone]').first()).toBeVisible({ timeout: 30000 });
    await expect(joinerPage.locator('[data-zone]').first()).toBeVisible({ timeout: 30000 });

    // Reset roomCode so afterAll doesn't fire on an already-active room
    roomCode = '';
  });

  test('kick path: join → READY → creator kicks → joiner bounces to /pvp', async () => {
    const createdRoom = await createRoom(creatorContext, creatorDeck.id);
    roomCode = createdRoom.roomCode;

    await creatorPage.goto(`${BASE_URL}/pvp/duel/${roomCode}`);
    await expect(creatorPage.getByText(/En attente d'un adversaire|Waiting for an opponent/i)).toBeVisible({ timeout: 5000 });

    await joinRoomViaDeepLink(joinerPage, roomCode, joinerDeck.name);

    await expect(creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i })).toBeVisible({ timeout: 10000 });
    await expect(joinerPage.getByText(/L'hôte va lancer|Host is about to start/i)).toBeVisible({ timeout: 10000 });

    await creatorPage.getByRole('button', { name: /Exclure|^Kick$/i }).click();

    // Joiner redirects to /pvp (lobby) with the kick error toast
    await joinerPage.waitForURL(/\/pvp$/, { timeout: 10000 });
    await expect(joinerPage.getByText(/exclu de la room|kicked you from the room/i)).toBeVisible({ timeout: 5000 });

    // Creator returns to WAITING — the start button is gone
    await expect(creatorPage.getByText(/En attente.{0,30}adversaire|Waiting for an opponent/i)).toBeVisible({ timeout: 5000 });
    await expect(creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i })).not.toBeVisible();
  });
});

