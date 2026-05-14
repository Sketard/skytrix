import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Validates the READY-state waiting-room flow shipped in commits
 * `feat(pvp): introduce READY state` / `feat(pvp): waiting room READY state`.
 *
 * Two browser contexts (creator + joiner) — admin / admin2.
 *
 * Happy path:
 *   1. admin creates a room with deck A
 *   2. admin2 opens the lobby, clicks the room, picks deck B
 *   3. joinRoom returns status=READY — both players are in the waiting room
 *   4. admin clicks "Lancer la partie" → POST /start
 *   5. both contexts land on the duel board (board zones visible)
 *
 * Kick path:
 *   1. admin creates a room with deck A
 *   2. admin2 joins with deck B → status=READY
 *   3. admin clicks "Exclure" → POST /kick
 *   4. admin2's UI redirects to /pvp with the KICKED_FROM_ROOM toast
 *   5. admin's UI returns to the WAITING state, room visible in lobby
 *
 * Setup:
 *   - admin / admin   (creator) — owns at least one deck (e.g. deck 19, Fireking)
 *   - admin2 / admin2 (joiner)  — owns at least one valid deck
 *   - Dev stack up: back:8080, duel-server:3001, front:4200
 *
 * If admin2 doesn't exist, the spec creates the account (POST /create-account)
 * but does NOT seed decks — admin2 must already own at least one playable
 * deck. To create a deck for admin2 quickly: log in via the UI once and
 * import / build a deck through the deck-builder.
 */

const BASE_URL = 'http://localhost:4200';
const BACK_URL = 'http://localhost:8080';

const CREATOR = { pseudo: 'admin', password: 'admin' };
const JOINER = { pseudo: 'admin2', password: 'admin' };

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loginViaUI(page: Page, user: { pseudo: string; password: string }): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('textbox', { name: /Pseudo/i }).fill(user.pseudo);
  await page.getByRole('textbox', { name: /Mot de passe/i }).fill(user.password);
  await page.getByRole('button', { name: /Se connecter/i }).click();
  await page.waitForURL(url => !url.toString().endsWith('/login'), { timeout: 10000 });
}

interface ShortDeck { id: number; name: string; }

async function fetchOwnedDecks(context: BrowserContext): Promise<ShortDeck[]> {
  const res = await context.request.get(`${BACK_URL}/api/decks`);
  expect(res.status(), 'GET /api/decks must succeed for the connected user').toBe(200);
  return await res.json();
}

/** Idempotent: try a basic-auth login first; only fire create-account if
 *  it fails. The create-account endpoint currently has no uniqueness check
 *  on `pseudo` (back issue, unrelated to this spec), so blindly creating
 *  duplicates would render the user un-loginable (Optional<User> +
 *  multiple matches → Spring throws). Login-first sidesteps that. */
async function ensureJoinerAccount(context: BrowserContext): Promise<void> {
  const credentials = Buffer.from(`${JOINER.pseudo}:${JOINER.password}`).toString('base64');
  const loginRes = await context.request.post(`${BACK_URL}/api/login`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (loginRes.status() === 200) return;
  const createRes = await context.request.post(`${BACK_URL}/api/create-account`, {
    data: { pseudo: JOINER.pseudo, password: JOINER.password },
  });
  if (createRes.status() !== 201) {
    throw new Error(`Failed to create joiner account: HTTP ${createRes.status()}`);
  }
}

/** Deep-link join: navigate directly to /pvp/duel/{code}, then pick a deck
 *  in the dialog. Bypasses the lobby virtual-scroll list (which doesn't
 *  show the room code anyway — only the creator's pseudo). */
async function joinRoomViaDeepLink(page: Page, roomCode: string, deckName: string): Promise<void> {
  await page.goto(`${BASE_URL}/pvp/duel/${roomCode}`);
  // The deck picker dialog opens — pick the deck by name
  await page.getByText(deckName, { exact: false }).first().click();
  // Confirm — the deck-picker dialog's confirm button is labelled
  // "Rejoindre" in 'join' context (FR) / "Join" (EN). Match both.
  await page.getByRole('button', { name: /^Rejoindre|^Join/i }).first().click();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

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

    // Pre-flight: make sure admin2 exists. Decks themselves cannot be
    // created from this spec — admin2 must already own at least one.
    await ensureJoinerAccount(creatorContext);

    creatorPage = await creatorContext.newPage();
    joinerPage = await joinerContext.newPage();

    await loginViaUI(creatorPage, CREATOR);
    await loginViaUI(joinerPage, JOINER);

    const creatorDecks = await fetchOwnedDecks(creatorContext);
    const joinerDecks = await fetchOwnedDecks(joinerContext);
    expect(creatorDecks.length, 'creator must own at least one deck').toBeGreaterThan(0);
    expect(joinerDecks.length, 'joiner (admin2) must own at least one deck — build one via the UI first').toBeGreaterThan(0);
    creatorDeck = creatorDecks[0]!;
    joinerDeck = joinerDecks[0]!;
  });

  test.afterAll(async () => {
    // Best-effort cleanup of any room we left dangling. Each test that
    // creates a room captures roomCode, so we can target it here.
    if (roomCode) {
      try { await creatorContext.request.post(`${BACK_URL}/api/rooms/${roomCode}/end`); } catch {}
    }
    await creatorContext.close();
    await joinerContext.close();
  });

  test('happy path: join → READY → creator starts → both see the duel board', async () => {
    // 1. admin creates a room
    const createRes = await creatorContext.request.post(`${BACK_URL}/api/rooms`, {
      data: { decklistId: creatorDeck.id },
    });
    expect(createRes.status()).toBe(201);
    const createdRoom = await createRes.json();
    roomCode = createdRoom.roomCode;

    // Navigate the creator to the room page (he's the room owner)
    await creatorPage.goto(`${BASE_URL}/pvp/duel/${roomCode}`);
    await expect(creatorPage.getByText(/En attente d'un adversaire|Waiting for an opponent/i)).toBeVisible({ timeout: 5000 });

    // 2. admin2 joins via the lobby UI (deck picker dialog)
    await joinRoomViaDeepLink(joinerPage, roomCode, joinerDeck.name);

    // 3. Both pages are in the READY-state waiting room
    //    - creator sees the "Lancer la partie" button (creator-only)
    //    - joiner sees the "L'hôte va lancer la partie..." hint
    await expect(creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i })).toBeVisible({ timeout: 10000 });
    await expect(joinerPage.getByText(/L'hôte va lancer|Host is about to start/i)).toBeVisible({ timeout: 10000 });

    // 4. Creator clicks "Lancer la partie"
    await creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i }).click();

    // 5. Both pages reach the duel board (board zones rendered)
    await expect(creatorPage.locator('[data-zone]').first()).toBeVisible({ timeout: 30000 });
    await expect(joinerPage.locator('[data-zone]').first()).toBeVisible({ timeout: 30000 });

    // Reset roomCode so afterAll doesn't fire on an already-active room
    roomCode = '';
  });

  test('kick path: join → READY → creator kicks → joiner bounces to /pvp', async () => {
    // 1. admin creates a fresh room
    const createRes = await creatorContext.request.post(`${BACK_URL}/api/rooms`, {
      data: { decklistId: creatorDeck.id },
    });
    expect(createRes.status()).toBe(201);
    const createdRoom = await createRes.json();
    roomCode = createdRoom.roomCode;

    await creatorPage.goto(`${BASE_URL}/pvp/duel/${roomCode}`);
    await expect(creatorPage.getByText(/En attente d'un adversaire|Waiting for an opponent/i)).toBeVisible({ timeout: 5000 });

    // 2. admin2 joins
    await joinRoomViaDeepLink(joinerPage, roomCode, joinerDeck.name);

    // 3. Both in READY-state waiting room
    await expect(creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i })).toBeVisible({ timeout: 10000 });
    await expect(joinerPage.getByText(/L'hôte va lancer|Host is about to start/i)).toBeVisible({ timeout: 10000 });

    // 4. Creator clicks "Exclure"
    await creatorPage.getByRole('button', { name: /Exclure|^Kick$/i }).click();

    // 5. Joiner's UI redirects to /pvp (lobby) with the kick error toast
    await joinerPage.waitForURL(/\/pvp$/, { timeout: 10000 });
    // Toast appears at the top — match either FR or EN copy
    await expect(joinerPage.getByText(/exclu de la room|kicked you from the room/i)).toBeVisible({ timeout: 5000 });

    // 6. Creator returns to the WAITING state (slot is empty again)
    await expect(creatorPage.getByText(/En attente.{0,30}adversaire|Waiting for an opponent/i)).toBeVisible({ timeout: 5000 });
    // The "Lancer la partie" button is gone — only the empty-slot UI remains
    await expect(creatorPage.getByRole('button', { name: /Lancer la partie|Start duel/i })).not.toBeVisible();
  });
});
