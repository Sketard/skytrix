import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ReplayHubStore } from './replay-hub-store';
import { AuthService } from '../../../services/auth.service';
import { DeckBuildService } from '../../../services/deck-build.service';
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
  let deckSubject: BehaviorSubject<Array<{ name: string }>>;

  beforeEach(() => {
    notify = jasmine.createSpyObj('NotificationService', ['error']);
    deckSubject = new BehaviorSubject<Array<{ name: string }>>([{ name: 'MyDeck' }]);

    const authStub = {
      user: () => ({ id: ME_ID, pseudo: 'Me', role: 'USER' } as unknown as UserDTO),
    };
    const deckBuildStub = { decks$: deckSubject.asObservable() };

    TestBed.configureTestingModule({
      providers: [
        ReplayHubStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authStub },
        { provide: DeckBuildService, useValue: deckBuildStub },
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

    it('myDeck — keeps only replays whose user-side deck matches decks[0].name', () => {
      seedAndFlushSnapshot([
        // Me is player1, my deck = "MyDeck" (matches defaultDeckName)
        makeReplay({ id: 'a', player1Id: ME_ID, metadataOverrides: { deckNames: ['MyDeck', 'OppDeck'] } }),
        // Me is player2 (other side), my deck = "OtherDeck" (no match)
        makeReplay({ id: 'b', player1Id: OTHER_ID, player2Id: ME_ID, metadataOverrides: { deckNames: ['OppDeck', 'OtherDeck'] } }),
        // Me is player2, my deck = "MyDeck" (matches)
        makeReplay({ id: 'c', player1Id: OTHER_ID, player2Id: ME_ID, metadataOverrides: { deckNames: ['OppDeck', 'MyDeck'] } }),
      ]);
      store.setActiveFilter('myDeck');
      const ids = store.filteredReplays().map(r => r.id).sort();
      expect(ids).toEqual(['a', 'c']);
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
  // hasDecks / defaultDeckName reactivity
  // ───────────────────────────────────────────────────────────────────────────

  describe('decks subscription', () => {
    it('hasDecks() flips when DeckBuildService.decks$ emits an empty list', () => {
      store.start();
      http.expectOne(req => req.url === '/api/replays' && req.method === 'GET').flush({ elements: [], size: 0 });
      http.expectOne('/api/replays/stats').flush({
        total: 0, victories: 0, defeats: 0, draws: 0, winrate: 0,
      });
      expect(store.hasDecks()).toBe(true);

      deckSubject.next([]);
      expect(store.hasDecks()).toBe(false);
    });
  });
});
