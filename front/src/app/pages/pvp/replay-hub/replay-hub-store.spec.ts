import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ReplayHubStore } from './replay-hub-store';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReplayDTO } from '../../../core/model/dto/replay-dto';
import { DuelResult } from '../../../core/enums/duel-result.enum';
import { UserDTO } from '../../../core/model/account/user';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ME_ID = 42;
const OTHER_ID = 99;

function makeReplay(overrides: Partial<ReplayDTO> & {
  metadataOverrides?: Partial<ReplayDTO['metadata']>;
}): ReplayDTO {
  const { metadataOverrides, ...rest } = overrides;
  return {
    id: 'r-' + Math.random().toString(36).slice(2),
    player1Id: ME_ID,
    player2Id: OTHER_ID,
    createdAt: '2026-05-14T12:00:00Z',
    metadata: {
      playerUsernames: ['Me', 'Opp'],
      deckNames: ['MyDeck', 'OppDeck'],
      turnCount: 5,
      result: DuelResult.VICTORY,
      date: '2026-05-14T12:00:00Z',
      scriptsHash: 'h',
      ocgcoreVersion: '1',
      ...metadataOverrides,
    },
    ...rest,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

describe('ReplayHubStore', () => {
  let store: ReplayHubStore;
  let http: HttpTestingController;
  let notify: jasmine.SpyObj<NotificationService>;

  beforeEach(() => {
    notify = jasmine.createSpyObj('NotificationService', ['error']);

    const authStub = {
      user: () => ({ id: ME_ID, pseudo: 'Me', role: 'USER' } as unknown as UserDTO),
    };

    TestBed.configureTestingModule({
      providers: [
        ReplayHubStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authStub },
        { provide: NotificationService, useValue: notify },
      ],
    });

    store = TestBed.inject(ReplayHubStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Filter
  // ───────────────────────────────────────────────────────────────────────────

  describe('filteredReplays — filter', () => {
    function seedAndFlushSnapshot(replays: ReplayDTO[]): void {
      store.start();
      // start() fires 2 requests: getMatchHistory + getStats.
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET')
        .flush({ elements: replays, size: replays.length });
      http.expectOne('/api/replays/stats').flush({
        total: replays.length, victories: 0, defeats: 0, draws: 0, winrate: 0,
      });
    }

    it('all — no filter, returns full list', () => {
      seedAndFlushSnapshot([
        makeReplay({ id: 'a', metadataOverrides: { result: DuelResult.VICTORY } }),
        makeReplay({ id: 'b', metadataOverrides: { result: DuelResult.DEFEAT } }),
      ]);
      store.setActiveFilter('all');
      expect(store.filteredReplays().length).toBe(2);
    });

    it('wins — keeps VICTORY + OPPONENT_*', () => {
      seedAndFlushSnapshot([
        makeReplay({ id: 'a', metadataOverrides: { result: DuelResult.VICTORY } }),
        makeReplay({ id: 'b', metadataOverrides: { result: DuelResult.OPPONENT_SURRENDER } }),
        makeReplay({ id: 'c', metadataOverrides: { result: DuelResult.OPPONENT_TIMEOUT } }),
        makeReplay({ id: 'd', metadataOverrides: { result: DuelResult.DEFEAT } }),
        makeReplay({ id: 'e', metadataOverrides: { result: DuelResult.DRAW } }),
      ]);
      store.setActiveFilter('wins');
      const ids = store.filteredReplays().map(r => r.id).sort();
      expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('losses — keeps DEFEAT + TIMEOUT + DISCONNECT + SURRENDER', () => {
      seedAndFlushSnapshot([
        makeReplay({ id: 'a', metadataOverrides: { result: DuelResult.DEFEAT } }),
        makeReplay({ id: 'b', metadataOverrides: { result: DuelResult.TIMEOUT } }),
        makeReplay({ id: 'c', metadataOverrides: { result: DuelResult.SURRENDER } }),
        makeReplay({ id: 'd', metadataOverrides: { result: DuelResult.VICTORY } }),
      ]);
      store.setActiveFilter('losses');
      const ids = store.filteredReplays().map(r => r.id).sort();
      expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('solo — keeps only replays with the same user on both sides', () => {
      seedAndFlushSnapshot([
        makeReplay({ id: 'solo1', player1Id: ME_ID, player2Id: ME_ID }),
        makeReplay({ id: 'solo2', player1Id: ME_ID, player2Id: ME_ID }),
        makeReplay({ id: 'pvp',   player1Id: ME_ID, player2Id: OTHER_ID }),
      ]);
      store.setActiveFilter('solo');
      const ids = store.filteredReplays().map(r => r.id).sort();
      expect(ids).toEqual(['solo1', 'solo2']);
    });

    it('wins / losses — exclude solo replays despite their result', () => {
      seedAndFlushSnapshot([
        makeReplay({ id: 'pvpWin',  player1Id: ME_ID, player2Id: OTHER_ID, metadataOverrides: { result: DuelResult.VICTORY } }),
        makeReplay({ id: 'soloWin', player1Id: ME_ID, player2Id: ME_ID,    metadataOverrides: { result: DuelResult.VICTORY } }),
        makeReplay({ id: 'pvpLoss', player1Id: ME_ID, player2Id: OTHER_ID, metadataOverrides: { result: DuelResult.DEFEAT } }),
        makeReplay({ id: 'soloLoss',player1Id: ME_ID, player2Id: ME_ID,    metadataOverrides: { result: DuelResult.DEFEAT } }),
      ]);
      store.setActiveFilter('wins');
      expect(store.filteredReplays().map(r => r.id)).toEqual(['pvpWin']);
      store.setActiveFilter('losses');
      expect(store.filteredReplays().map(r => r.id)).toEqual(['pvpLoss']);
    });

    it('last7days — keeps replays within last 7 days', () => {
      const now = Date.now();
      const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
      seedAndFlushSnapshot([
        makeReplay({ id: 'recent', createdAt: tenMinAgo }),
        makeReplay({ id: 'old', createdAt: tenDaysAgo }),
      ]);
      store.setActiveFilter('last7days');
      const ids = store.filteredReplays().map(r => r.id);
      expect(ids).toEqual(['recent']);
    });

    it('search — case-insensitive match on opponent or deck names', () => {
      seedAndFlushSnapshot([
        makeReplay({ id: 'a', metadataOverrides: { playerUsernames: ['Me', 'YubelMaster'] } }),
        makeReplay({ id: 'b', metadataOverrides: { playerUsernames: ['Me', 'HfdPlayer'] } }),
        makeReplay({ id: 'c', metadataOverrides: { deckNames: ['MyDeck', 'Snake-Eye Fiendsmith'] } }),
      ]);
      store.setSearchQuery('snake');
      const ids = store.filteredReplays().map(r => r.id);
      expect(ids).toEqual(['c']);

      store.setSearchQuery('YUBEL');
      const ids2 = store.filteredReplays().map(r => r.id);
      expect(ids2).toEqual(['a']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Sort
  // ───────────────────────────────────────────────────────────────────────────

  describe('filteredReplays — sort', () => {
    beforeEach(() => {
      store.start();
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET').flush({
        elements: [
          makeReplay({ id: 'old',    createdAt: '2026-04-01T00:00:00Z', metadataOverrides: { turnCount: 3 } }),
          makeReplay({ id: 'new',    createdAt: '2026-05-14T00:00:00Z', metadataOverrides: { turnCount: 5 } }),
          makeReplay({ id: 'middle', createdAt: '2026-05-01T00:00:00Z', metadataOverrides: { turnCount: 12 } }),
        ],
        size: 3,
      });
      http.expectOne('/api/replays/stats').flush({
        total: 3, victories: 0, defeats: 0, draws: 0, winrate: 0,
      });
    });

    it('newest — by createdAt desc', () => {
      store.setSortMode('newest');
      expect(store.filteredReplays().map(r => r.id)).toEqual(['new', 'middle', 'old']);
    });

    it('oldest — by createdAt asc', () => {
      store.setSortMode('oldest');
      expect(store.filteredReplays().map(r => r.id)).toEqual(['old', 'middle', 'new']);
    });

    it('mostTurns — by turnCount desc', () => {
      store.setSortMode('mostTurns');
      expect(store.filteredReplays().map(r => r.id)).toEqual(['middle', 'new', 'old']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Optimistic delete + rollback
  // ───────────────────────────────────────────────────────────────────────────

  describe('deleteReplay', () => {
    function seed(replays: ReplayDTO[]): void {
      store.start();
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET').flush({ elements: replays, size: replays.length });
      http.expectOne('/api/replays/stats').flush({
        total: replays.length, victories: 0, defeats: 0, draws: 0, winrate: 0,
      });
    }

    it('removes the replay optimistically and refreshes stats on success', async () => {
      const a = makeReplay({ id: 'a' });
      const b = makeReplay({ id: 'b' });
      seed([a, b]);
      expect(store.replays().length).toBe(2);

      const promise = store.deleteReplay('a');
      // Optimistic — list updated synchronously before HTTP responds.
      expect(store.replays().map(r => r.id)).toEqual(['b']);

      http.expectOne({ url: '/api/replays/a', method: 'DELETE' }).flush(null);
      await promise;

      expect(store.replays().map(r => r.id)).toEqual(['b']);
      // Stats refresh fires after successful delete.
      http.expectOne('/api/replays/stats').flush({
        total: 1, victories: 0, defeats: 0, draws: 0, winrate: 0,
      });
      expect(store.stats()?.total).toBe(1);
      expect(notify.error).not.toHaveBeenCalled();
    });

    it('rolls back to the snapshot on backend error and surfaces the error', async () => {
      const a = makeReplay({ id: 'a' });
      const b = makeReplay({ id: 'b' });
      seed([a, b]);

      const promise = store.deleteReplay('a');
      expect(store.replays().map(r => r.id)).toEqual(['b']);

      http.expectOne({ url: '/api/replays/a', method: 'DELETE' })
        .error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
      await promise;

      // Rolled back to both replays.
      expect(store.replays().map(r => r.id).sort()).toEqual(['a', 'b']);
      expect(notify.error).toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Favorites filter — endpoint routing
  // ───────────────────────────────────────────────────────────────────────────

  describe('favorites filter — endpoint routing', () => {
    function seedFromAll(replays: ReplayDTO[]): void {
      store.start();
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET')
        .flush({ elements: replays, size: replays.length });
      http.expectOne('/api/replays/stats').flush({
        total: replays.length, victories: 0, defeats: 0, draws: 0, winrate: 0,
      });
    }

    it('crossing into favorites re-fetches against /replays/favorites', () => {
      seedFromAll([makeReplay({ id: 'a' })]);
      store.setActiveFilter('favorites');
      // New page-0 fetch routed to the favorites endpoint.
      http.expectOne(req => req.url === '/api/replays/favorites' && req.method === 'GET')
        .flush({ elements: [makeReplay({ id: 'fav1', isFavorite: true })], size: 1 });
      expect(store.replays().map(r => r.id)).toEqual(['fav1']);
    });

    it('crossing out of favorites re-fetches against /replays', () => {
      seedFromAll([makeReplay({ id: 'a' })]);
      store.setActiveFilter('favorites');
      http.expectOne(req => req.url === '/api/replays/favorites' && req.method === 'GET')
        .flush({ elements: [makeReplay({ id: 'fav1', isFavorite: true })], size: 1 });
      // Back to "all" — must re-fetch on the main endpoint, not stay on /favorites.
      store.setActiveFilter('all');
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET')
        .flush({ elements: [makeReplay({ id: 'a' }), makeReplay({ id: 'b' })], size: 2 });
      expect(store.replays().map(r => r.id).sort()).toEqual(['a', 'b']);
    });

    it('switching between non-favorites filters does NOT re-fetch', () => {
      seedFromAll([
        makeReplay({ id: 'a', metadataOverrides: { result: DuelResult.VICTORY } }),
        makeReplay({ id: 'b', metadataOverrides: { result: DuelResult.DEFEAT } }),
      ]);
      store.setActiveFilter('wins');
      store.setActiveFilter('losses');
      // No re-fetch on either transition — `afterEach` http.verify() will
      // throw if a stray request landed.
      expect(store.filteredReplays().map(r => r.id)).toEqual(['b']);
    });

    it('loadNextPage routes to /favorites when active filter is favorites', () => {
      seedFromAll([makeReplay({ id: 'a' })]);
      store.setActiveFilter('favorites');
      // First page on /favorites — flush enough rows so hasMore() is true.
      const initialFavs = Array.from({ length: 20 }, (_, i) =>
        makeReplay({ id: `fav${i}`, isFavorite: true }));
      http.expectOne(req => req.url === '/api/replays/favorites' && req.method === 'GET')
        .flush({ elements: initialFavs, size: 25 });

      store.loadNextPage();
      http.expectOne(req => req.url === '/api/replays/favorites' && req.method === 'GET')
        .flush({ elements: [makeReplay({ id: 'fav20', isFavorite: true })], size: 25 });
      expect(store.replays().length).toBe(21);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // toggleFavorite — optimistic + rollback
  // ───────────────────────────────────────────────────────────────────────────

  describe('toggleFavorite', () => {
    function seedFromAll(replays: ReplayDTO[]): void {
      store.start();
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET')
        .flush({ elements: replays, size: replays.length });
      http.expectOne('/api/replays/stats').flush({
        total: replays.length, victories: 0, defeats: 0, draws: 0, winrate: 0,
      });
    }

    it('flips isFavorite=true optimistically and POSTs /favorite', async () => {
      seedFromAll([makeReplay({ id: 'a', isFavorite: false })]);

      const promise = store.toggleFavorite('a');
      // Optimistic flip BEFORE the HTTP roundtrip.
      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(true);

      const req = http.expectOne({ url: '/api/replays/a/favorite', method: 'POST' });
      req.flush(null);
      await promise;
      // Still favorited post-success.
      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(true);
      expect(store.favoritingId()).toBeNull();
    });

    it('flips isFavorite=false optimistically and DELETEs /favorite', async () => {
      seedFromAll([makeReplay({ id: 'a', isFavorite: true })]);

      const promise = store.toggleFavorite('a');
      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(false);

      const req = http.expectOne({ url: '/api/replays/a/favorite', method: 'DELETE' });
      req.flush(null);
      await promise;
      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(false);
    });

    it('rolls back on backend error and surfaces the error', async () => {
      seedFromAll([makeReplay({ id: 'a', isFavorite: false })]);

      const promise = store.toggleFavorite('a');
      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(true);

      http.expectOne({ url: '/api/replays/a/favorite', method: 'POST' })
        .error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
      await promise;

      // Reverted to the pre-toggle state.
      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(false);
      expect(notify.error).toHaveBeenCalled();
      expect(store.favoritingId()).toBeNull();
    });

    it('on favorites filter, un-favoriting removes the row from the visible list', async () => {
      // Seed from the favorites endpoint directly — simulates the user
      // landing on the Favorites tab and toggling one of their favorites off.
      store.start();
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET')
        .flush({ elements: [], size: 0 });
      http.expectOne('/api/replays/stats').flush({ total: 0, victories: 0, defeats: 0, draws: 0, winrate: 0 });
      store.setActiveFilter('favorites');
      http.expectOne(req => req.url === '/api/replays/favorites' && req.method === 'GET')
        .flush({
          elements: [
            makeReplay({ id: 'a', isFavorite: true }),
            makeReplay({ id: 'b', isFavorite: true }),
          ],
          size: 2,
        });
      expect(store.replays().length).toBe(2);

      const promise = store.toggleFavorite('a');
      // Optimistically drop from the visible list (server-side it'd disappear
      // from the next /favorites page anyway — keeping it on-screen would lie).
      expect(store.replays().map(r => r.id)).toEqual(['b']);

      http.expectOne({ url: '/api/replays/a/favorite', method: 'DELETE' }).flush(null);
      await promise;
      expect(store.replays().map(r => r.id)).toEqual(['b']);
    });

    it('on favorites filter, un-favorite rollback restores the row', async () => {
      store.start();
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET')
        .flush({ elements: [], size: 0 });
      http.expectOne('/api/replays/stats').flush({ total: 0, victories: 0, defeats: 0, draws: 0, winrate: 0 });
      store.setActiveFilter('favorites');
      http.expectOne(req => req.url === '/api/replays/favorites' && req.method === 'GET')
        .flush({
          elements: [makeReplay({ id: 'a', isFavorite: true })],
          size: 1,
        });

      const promise = store.toggleFavorite('a');
      expect(store.replays().length).toBe(0); // dropped optimistically

      http.expectOne({ url: '/api/replays/a/favorite', method: 'DELETE' })
        .error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });
      await promise;

      // Restored to the visible list with isFavorite=true.
      expect(store.replays().map(r => r.id)).toEqual(['a']);
      expect(store.replays()[0].isFavorite).toBe(true);
    });

    it('is a no-op when the id is not in the current list', async () => {
      seedFromAll([makeReplay({ id: 'a' })]);
      await store.toggleFavorite('ghost-id');
      // No HTTP request issued — afterEach http.verify() will fail if any did.
      expect(store.replays().map(r => r.id)).toEqual(['a']);
    });

    // F13 (2026-06-04) — per-row mutex. A second concurrent toggle on the
    // same id must early-return: pre-F13 a double-click could fire two
    // HTTP requests, the second snapshot would capture the optimistic flip
    // from the first, and the rollback paths could resurrect a pre-first-
    // toggle state + double-decrement `totalElements` under the favorites
    // filter. The icon-button shows a spinner during in-flight HTTP so
    // the UX absorbs the lockout cleanly.
    it('per-row mutex: a second toggle on the same id while one is in flight is a no-op', async () => {
      seedFromAll([makeReplay({ id: 'a', isFavorite: false })]);

      const first = store.toggleFavorite('a');
      // First toggle has flipped + taken the lock.
      expect(store.favoritingId()).toBe('a');
      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(true);

      // Second toggle while first is in flight — should early-return with NO HTTP.
      await store.toggleFavorite('a');
      // Still on the optimistic flip from the FIRST toggle (no re-flip back).
      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(true);

      // Drain the first toggle's HTTP (the only one expected).
      http.expectOne({ url: '/api/replays/a/favorite', method: 'POST' }).flush(null);
      await first;

      expect(store.replays().find(r => r.id === 'a')?.isFavorite).toBe(true);
      expect(store.favoritingId()).toBeNull();
      // afterEach `http.verify()` enforces there was no second HTTP.
    });
  });

});
