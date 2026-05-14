import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Shared e2e helpers — keep this file thin. Only extract patterns
 * with ≥2 callsites or an obvious next-spec reuse. Single-use
 * scenario glue stays in its own spec file.
 *
 * Stack assumed up at:
 *   - back:  http://localhost:8080
 *   - front: http://localhost:4200
 *   - duel:  http://localhost:3001
 */

export const BASE_URL = 'http://localhost:4200';
export const BACK_URL = 'http://localhost:8080';

export interface UserCredentials {
  pseudo: string;
  password: string;
}

/** Default credentials seeded in the dev DB. */
export const ADMIN: UserCredentials = { pseudo: 'admin', password: 'admin' };
export const ADMIN2: UserCredentials = { pseudo: 'admin2', password: 'admin' };

export interface ShortDeck {
  id: number;
  name: string;
}

export interface RoomDTO {
  id: number;
  roomCode: string;
  status: 'WAITING' | 'READY' | 'CREATING_DUEL' | 'ACTIVE' | 'ENDED' | 'CLOSED';
  player1: { id: number; pseudo: string; role: string };
  player2: { id: number; pseudo: string; role: string } | null;
  wsToken: string | null;
  decklistId: number | null;
  createdAt: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────

/** Log in through the front-end login form so Angular guards see the
 *  cookies. Use this when the test exercises UI flows; for back-only
 *  API tests, prefer basic-auth on `context.request`. */
export async function loginViaUI(page: Page, user: UserCredentials): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('textbox', { name: /Pseudo/i }).fill(user.pseudo);
  await page.getByRole('textbox', { name: /Mot de passe/i }).fill(user.password);
  await page.getByRole('button', { name: /Se connecter/i }).click();
  await page.waitForURL(url => !url.toString().endsWith('/login'), { timeout: 10000 });
}

/** Idempotent: try a basic-auth login first; only fire create-account
 *  if it fails. The create-account endpoint currently has no uniqueness
 *  check on `pseudo` (back issue tracked separately), so blindly
 *  creating duplicates would render the user un-loginable
 *  (Optional<User> + multiple matches → Spring throws). */
export async function ensureAccount(context: BrowserContext, user: UserCredentials): Promise<void> {
  const credentials = Buffer.from(`${user.pseudo}:${user.password}`).toString('base64');
  const loginRes = await context.request.post(`${BACK_URL}/api/login`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (loginRes.status() === 200) return;
  const createRes = await context.request.post(`${BACK_URL}/api/create-account`, {
    data: { pseudo: user.pseudo, password: user.password },
  });
  if (createRes.status() !== 201) {
    throw new Error(`Failed to create account ${user.pseudo}: HTTP ${createRes.status()}`);
  }
}

// ─── Decks ────────────────────────────────────────────────────────────────

/** Fetch the decks owned by the currently-authenticated user in `context`. */
export async function fetchOwnedDecks(context: BrowserContext): Promise<ShortDeck[]> {
  const res = await context.request.get(`${BACK_URL}/api/decks`);
  expect(res.status(), 'GET /api/decks must succeed for the connected user').toBe(200);
  return await res.json();
}

// ─── Rooms (PvP API) ──────────────────────────────────────────────────────

/** Create a PvP room owned by the calling user (HTTP, not UI). */
export async function createRoom(context: BrowserContext, decklistId: number): Promise<RoomDTO> {
  const res = await context.request.post(`${BACK_URL}/api/rooms`, { data: { decklistId } });
  expect(res.status(), 'POST /api/rooms must return 201').toBe(201);
  return await res.json();
}

/** End a room (HTTP). Returns the response so callers can inspect status if needed. */
export async function endRoom(context: BrowserContext, roomCode: string): Promise<void> {
  await context.request.post(`${BACK_URL}/api/rooms/${roomCode}/end`);
}

/** Deep-link join via the UI: navigate to /pvp/duel/{code}, then pick a
 *  deck in the dialog and confirm. Bypasses the lobby virtual-scroll
 *  list (which doesn't show room codes anyway). */
export async function joinRoomViaDeepLink(page: Page, roomCode: string, deckName: string): Promise<void> {
  await page.goto(`${BASE_URL}/pvp/duel/${roomCode}`);
  await page.getByText(deckName, { exact: false }).first().click();
  // Deck-picker's confirm button: "Rejoindre" (FR) / "Join" (EN) in 'join' context.
  await page.getByRole('button', { name: /^Rejoindre|^Join/i }).first().click();
}

// ─── Duel board ───────────────────────────────────────────────────────────

/** Wait until at least one board zone is rendered — used as a "duel is
 *  live" signal across solo, PvP, and replay specs. */
export async function waitForBoard(page: Page, timeoutMs = 30000): Promise<void> {
  await page.waitForSelector('[data-zone]', { timeout: timeoutMs });
}
