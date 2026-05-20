import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { DeckListStore } from './deck-list-store';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { OwnedCardService } from '../../../../services/owned-card.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ShortDeck } from '../../../../core/model/short-deck';

function makeDeck(overrides: Partial<ShortDeck>): ShortDeck {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    name: 'Deck',
    urls: [],
    mainDeckCount: 40,
    valid: true,
    updatedAt: '2026-05-18T12:00:00Z',
    ...overrides,
  };
}

describe('DeckListStore', () => {
  let store: DeckListStore;
  let deckSubject: BehaviorSubject<ShortDeck[]>;
  let fetchDecksSpy: jasmine.Spy;
  let deleteByIdSpy: jasmine.Spy;
  let notify: jasmine.SpyObj<NotificationService>;

  beforeEach(() => {
    deckSubject = new BehaviorSubject<ShortDeck[]>([]);
    fetchDecksSpy = jasmine.createSpy('fetchDecks');
    deleteByIdSpy = jasmine.createSpy('deleteById');
    notify = jasmine.createSpyObj('NotificationService', ['success', 'error']);

    const deckBuildStub = {
      decks$: deckSubject.asObservable(),
      isFirstDeckLoad: signal(false),
      fetchDecks: fetchDecksSpy,
      deleteById: deleteByIdSpy,
    };
    const ownedStub = {
      ownedMap: signal(new Map<number, number>([[1, 3], [2, 4]])),
    };

    TestBed.configureTestingModule({
      providers: [
        DeckListStore,
        { provide: DeckBuildService, useValue: deckBuildStub },
        { provide: OwnedCardService, useValue: ownedStub },
        { provide: NotificationService, useValue: notify },
      ],
    });

    store = TestBed.inject(DeckListStore);
    // start() wires the decks$ → items subscription + an initial
    // fetchSnapshot() which now delegates to the stubbed fetchDecks (no HTTP).
    store.start();
  });

  // ─── filteredDecks / sort ───────────────────────────────────────────────────

  it('sorts by recent (updatedAt desc) by default', () => {
    const newer = makeDeck({ id: 1, name: 'Alpha', updatedAt: '2026-05-18T12:00:00Z' });
    const older = makeDeck({ id: 2, name: 'Beta',  updatedAt: '2026-04-01T12:00:00Z' });
    deckSubject.next([older, newer]);

    expect(store.sortMode()).toBe('recent');
    expect(store.filteredDecks().map(d => d.id)).toEqual([1, 2]);
  });

  it('sorts by name when sortMode = name', () => {
    deckSubject.next([
      makeDeck({ id: 1, name: 'Zeta',  updatedAt: '2026-01-01T12:00:00Z' }),
      makeDeck({ id: 2, name: 'Alpha', updatedAt: '2026-05-01T12:00:00Z' }),
    ]);
    store.setSortMode('name');
    expect(store.filteredDecks().map(d => d.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('sorts legal decks first when sortMode = legality (alphabetical secondary)', () => {
    deckSubject.next([
      makeDeck({ id: 1, name: 'BadDeck',  valid: false }),
      makeDeck({ id: 2, name: 'AlphaDeck', valid: true }),
      makeDeck({ id: 3, name: 'Aardvark', valid: false }),
      makeDeck({ id: 4, name: 'Bravo',   valid: true }),
    ]);
    store.setSortMode('legality');
    expect(store.filteredDecks().map(d => d.name)).toEqual([
      'AlphaDeck', 'Bravo',
      'Aardvark', 'BadDeck',
    ]);
  });

  it('filters by searchQuery (accent-insensitive)', () => {
    deckSubject.next([
      makeDeck({ id: 1, name: 'Élemental Hero' }),
      makeDeck({ id: 2, name: 'Branded Despia' }),
    ]);
    store.setSearchQuery('eLeMeN');
    expect(store.filteredDecks().map(d => d.id)).toEqual([1]);
  });

  // ─── stats ──────────────────────────────────────────────────────────────────

  it('exposes 3 stats with icons + accent for <app-stats-strip>', () => {
    deckSubject.next([
      makeDeck({ id: 1, valid: true }),
      makeDeck({ id: 2, valid: false }),
      makeDeck({ id: 3, valid: true }),
    ]);
    const stats = store.stats();
    expect(stats.length).toBe(3);
    expect(stats[0].labelKey).toBe('deckStats.decks');
    expect(stats[0].value).toBe(3);
    expect(stats[0].surfaceAccent).toBe('cyan');
    expect(stats[1].labelKey).toBe('deckStats.cardsOwned');
    expect(stats[1].value).toBe(7); // 3 + 4 from the owned stub
    expect(stats[2].labelKey).toBe('deckStats.legalDecks');
    expect(stats[2].value).toBe(2);
  });

  // ─── view guards ────────────────────────────────────────────────────────────

  it('showEmptyState fires when not loading and decks empty', () => {
    deckSubject.next([]);
    expect(store.showEmptyState()).toBeTrue();
  });

  it('showNoResultsState fires when decks exist but search excludes all', () => {
    deckSubject.next([makeDeck({ name: 'Branded' })]);
    store.setSearchQuery('xyzzy');
    expect(store.showNoResultsState()).toBeTrue();
    expect(store.showEmptyState()).toBeFalse();
  });

  // ─── fetchSnapshot ──────────────────────────────────────────────────────────

  it('start() triggers an initial fetchSnapshot → fetchDecks(true, onError)', () => {
    expect(fetchDecksSpy).toHaveBeenCalledTimes(1);
    const [force, onError] = fetchDecksSpy.calls.mostRecent().args;
    expect(force).toBeTrue();
    expect(typeof onError).toBe('function');
    expect(store.error()).toBeNull();
  });

  it('fetchSnapshot delegates to the shared service fetchDecks(true, onError)', () => {
    fetchDecksSpy.calls.reset(); // start() already triggered one
    store.fetchSnapshot();
    expect(fetchDecksSpy).toHaveBeenCalledTimes(1);
    const [force, onError] = fetchDecksSpy.calls.mostRecent().args;
    expect(force).toBeTrue();
    expect(typeof onError).toBe('function');
    expect(store.error()).toBeNull();
  });

  it('fetchSnapshot surfaces the error via the onError callback', () => {
    fetchDecksSpy.calls.reset();
    store.fetchSnapshot();
    const onError = fetchDecksSpy.calls.mostRecent().args[1] as (e: unknown) => void;
    onError(new Error('boom'));
    expect(store.error()).not.toBeNull();
  });

  // ─── deleteDeck ─────────────────────────────────────────────────────────────

  it('deleteDeck optimistically removes the deck and notifies on success', () => {
    const kept = makeDeck({ id: 1, name: 'Keep' });
    const doomed = makeDeck({ id: 7, name: 'Doomed' });
    deckSubject.next([kept, doomed]);

    store.deleteDeck(doomed);
    // Optimistic: gone from the list before the HTTP resolves.
    expect(store.decks().map(d => d.id)).toEqual([1]);
    expect(deleteByIdSpy).toHaveBeenCalledWith(7, jasmine.any(Function), jasmine.any(Function));

    const successCb = deleteByIdSpy.calls.mostRecent().args[1] as () => void;
    successCb();
    expect(notify.success).toHaveBeenCalledWith('success.DECK_DELETED');
  });

  it('deleteDeck rolls back the optimistic removal on error', () => {
    const kept = makeDeck({ id: 1, name: 'Keep' });
    const doomed = makeDeck({ id: 7, name: 'Doomed' });
    deckSubject.next([kept, doomed]);

    store.deleteDeck(doomed);
    expect(store.decks().map(d => d.id)).toEqual([1]);

    const errorCb = deleteByIdSpy.calls.mostRecent().args[2] as (e: unknown) => void;
    errorCb(new Error('server down'));
    // Rolled back: the doomed deck is restored.
    expect(store.decks().map(d => d.id).sort()).toEqual([1, 7]);
    expect(notify.error).toHaveBeenCalled();
  });
});
