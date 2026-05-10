/**
 * Spec for DeckBuilderComponent — root of the deck-page editing flow.
 *
 * Strategy: like duel-page (C1), the component depends on a heavy DI
 * graph (DeckBuildService, Router, ExportService, OwnedCardService,
 * RoomApiService, NotificationService, HttpClient, BreakpointObserver,
 * TranslateService) plus 9 child components. We:
 *
 *  1. Stub `DeckBuildService` with a writable `deck` signal so tests
 *     drive state directly instead of replaying its 30+ mutators.
 *  2. Replace every collaborator with a spy stub via `overrideComponent`.
 *  3. Override the template to `''` to skip rendering 9 child components.
 *
 * The pinned surface is the component's own logic — selection helpers,
 * navigateToPvp guards, save flow, name-edit timing, image-update routing.
 * Things a future refactor would silently break.
 */

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { Observable, of, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

import { DeckBuilderComponent } from './deck-builder.component';
import { DeckBuildService, DeckZone } from '../../../../services/deck-build.service';
import { ExportService } from '../../../../services/export.service';
import { OwnedCardService } from '../../../../services/owned-card.service';
import { RoomApiService } from '../../../pvp/room-api.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { Deck } from '../../../../core/model/deck';
import { CardDetail, IndexedCardDetail } from '../../../../core/model/card-detail';
import { ExportMode } from '../../../../core/enums/export.mode.enum';

// =============================================================================
// Fixtures
// =============================================================================

/** Build a CardDetail with the given id and `extraCard` flag. The id lives
 *  on `card.card.id` (CardDetail wraps a Card which extends CardDTO). */
function makeCardDetail(id: number, opts: { extraCard?: boolean; favorite?: boolean } = {}): CardDetail {
  const cd = new CardDetail();
  cd.card.id = id;
  cd.card.extraCard = opts.extraCard ?? false;
  cd.favorite = opts.favorite ?? false;
  return cd;
}

/** Build an IndexedCardDetail wrapping a CardDetail at a given slot index. */
function makeIndexedCard(id: number, slotIndex: number, opts: { extraCard?: boolean; selectedImageId?: number } = {}): IndexedCardDetail {
  return new IndexedCardDetail(makeCardDetail(id, { extraCard: opts.extraCard }), slotIndex, opts.selectedImageId);
}

/** Build an empty Deck and inject N filled slots into the named zone. */
function makeDeck(zones: { main?: IndexedCardDetail[]; extra?: IndexedCardDetail[]; side?: IndexedCardDetail[] } = {}, id?: number): Deck {
  const deck = new Deck();
  deck.id = id;
  // The Deck ctor pads each zone with `index: -1` placeholder slots up to
  // the cap (60/15/15). We splice real cards into the head so that the
  // component's filters (`slot => slot.card.card.id === id`,
  // `slot => slot.index !== -1`) operate on a realistic shape.
  if (zones.main) {
    for (let i = 0; i < zones.main.length; i++) deck.mainDeck[i] = zones.main[i];
  }
  if (zones.extra) {
    for (let i = 0; i < zones.extra.length; i++) deck.extraDeck[i] = zones.extra[i];
  }
  if (zones.side) {
    for (let i = 0; i < zones.side.length; i++) deck.sideDeck[i] = zones.side[i];
  }
  return deck;
}

// =============================================================================
// Stubs
// =============================================================================

/** Minimal DeckBuildService stub: writable `deck` signal + spies for the
 *  mutators the component calls. The component reads `deck()` and calls
 *  ~10 distinct methods — everything else stays as no-op spies. */
class StubDeckBuildService {
  private readonly _deck = signal<Deck>(new Deck());
  readonly deck = this._deck.asReadonly();
  setDeck(d: Deck): void { this._deck.set(d); }

  // Read-only signals the component reads.
  readonly handTestOpened = signal(false).asReadonly();
  readonly cardDragActive = signal(false).asReadonly();
  readonly isDirty = signal(false).asReadonly();

  // Spies for the mutators the component calls.
  resetDeck = jasmine.createSpy('resetDeck');
  initDeck = jasmine.createSpy('initDeck');
  addCard = jasmine.createSpy('addCard');
  removeCard = jasmine.createSpy('removeCard');
  updateCardImage = jasmine.createSpy('updateCardImage');
  sortByType = jasmine.createSpy('sortByType');
  toggleHandTestOpened = jasmine.createSpy('toggleHandTestOpened');
  markDirty = jasmine.createSpy('markDirty');
  save = jasmine.createSpy('save');
  getById = jasmine.createSpy('getById').and.returnValue(of(new Deck()));
  addFavoriteCard = jasmine.createSpy('addFavoriteCard').and.returnValue(of(undefined));
  removeFavoriteCard = jasmine.createSpy('removeFavoriteCard').and.returnValue(of(undefined));
}

class StubExportService {
  exportDeckList = jasmine.createSpy('exportDeckList').and.returnValue(of({ body: new Blob() }));
  importDeckList = jasmine.createSpy('importDeckList').and.returnValue(of({ id: 1, name: 'imported', mainDeck: [], extraDeck: [], sideDeck: [], images: [] }));
}

class StubOwnedCardService {
  private readonly _ownedMap = signal<Map<number, number>>(new Map());
  readonly ownedMap = this._ownedMap.asReadonly();
  setOwned(map: Map<number, number>): void { this._ownedMap.set(map); }
  updateOwned = jasmine.createSpy('updateOwned');
}

class StubRoomApiService {
  createRoom = jasmine.createSpy('createRoom').and.returnValue(of({ roomCode: 'ABC123' }));
}

class StubNotification {
  success = jasmine.createSpy('success');
  error = jasmine.createSpy('error');
}

class StubRouter {
  navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
}

class StubHttpClient {
  get = jasmine.createSpy('get').and.returnValue(of({}));
  post = jasmine.createSpy('post').and.returnValue(of({}));
  delete = jasmine.createSpy('delete').and.returnValue(of({}));
}

class StubBreakpointObserver {
  // Each observe() call returns a fresh stream tied to the requested query.
  // Default: matches=false. Tests can swap this via `setMatches`.
  private _matches = false;
  setMatches(m: boolean): void { this._matches = m; }
  observe(): Observable<BreakpointState> {
    return of({ matches: this._matches, breakpoints: {} });
  }
}

class StubTranslate {
  currentLang = 'en';
  instant = (key: string): string => key;
  get = (key: string): { subscribe: (fn: (v: string) => void) => void } => ({ subscribe: fn => fn(key) });
  onLangChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
  onTranslationChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
  onDefaultLangChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
}

// =============================================================================
// TestBed setup
// =============================================================================

function setupTestBed(): void {
  TestBed.configureTestingModule({
    imports: [DeckBuilderComponent],
    providers: [
      { provide: Router, useClass: StubRouter },
      { provide: HttpClient, useClass: StubHttpClient },
      { provide: TranslateService, useClass: StubTranslate },
      { provide: NotificationService, useClass: StubNotification },
      { provide: BreakpointObserver, useClass: StubBreakpointObserver },
      { provide: DeckBuildService, useClass: StubDeckBuildService },
      { provide: ExportService, useClass: StubExportService },
      { provide: OwnedCardService, useClass: StubOwnedCardService },
      { provide: RoomApiService, useClass: StubRoomApiService },
    ],
  });

  TestBed.overrideComponent(DeckBuilderComponent, {
    set: { template: '' },
  });
}

function deckSvcOf(fixture: ComponentFixture<DeckBuilderComponent>): StubDeckBuildService {
  return fixture.componentRef.injector.get(DeckBuildService) as unknown as StubDeckBuildService;
}

function ownedSvcOf(fixture: ComponentFixture<DeckBuilderComponent>): StubOwnedCardService {
  return fixture.componentRef.injector.get(OwnedCardService) as unknown as StubOwnedCardService;
}

function roomApiOf(fixture: ComponentFixture<DeckBuilderComponent>): StubRoomApiService {
  return fixture.componentRef.injector.get(RoomApiService) as unknown as StubRoomApiService;
}

function notifyOf(fixture: ComponentFixture<DeckBuilderComponent>): StubNotification {
  return fixture.componentRef.injector.get(NotificationService) as unknown as StubNotification;
}

function routerOf(fixture: ComponentFixture<DeckBuilderComponent>): StubRouter {
  return fixture.componentRef.injector.get(Router) as unknown as StubRouter;
}

// =============================================================================
// Tests
// =============================================================================

describe('DeckBuilderComponent — selection helpers', () => {
  let fixture: ComponentFixture<DeckBuilderComponent>;
  let component: DeckBuilderComponent;
  let deckSvc: StubDeckBuildService;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DeckBuilderComponent);
    component = fixture.componentInstance;
    deckSvc = deckSvcOf(fixture);
  });

  it('selectedCardCount returns 0 when no card is selected', () => {
    expect(component.selectedCardCount()).toBe(0);
  });

  it('selectedCardCount sums occurrences across main+extra+side decks', () => {
    // Same id (12345) appears 2× in main, 0× in extra, 1× in side.
    // The computed must traverse all three zones — a refactor that drops
    // sideDeck would silently flip the count to 2.
    deckSvc.setDeck(makeDeck({
      main: [makeIndexedCard(12345, 0), makeIndexedCard(12345, 1), makeIndexedCard(99999, 2)],
      side: [makeIndexedCard(12345, 0)],
    }));
    component.onCardClicked(makeCardDetail(12345));
    expect(component.selectedCardCount()).toBe(3);
  });

  it('addSelectedCardToDeck routes extra-deck cards to EXTRA, others to MAIN', () => {
    component.onCardClicked(makeCardDetail(99999, { extraCard: true }));
    component.addSelectedCardToDeck();
    expect(deckSvc.addCard).toHaveBeenCalledWith(jasmine.any(CardDetail), DeckZone.EXTRA, undefined, false, undefined);

    component.onCardClicked(makeCardDetail(11111, { extraCard: false }));
    component.addSelectedCardToDeck();
    expect(deckSvc.addCard).toHaveBeenCalledWith(jasmine.any(CardDetail), DeckZone.MAIN, undefined, false, undefined);
  });

  it('addSelectedCardToDeck is a no-op when no card is selected', () => {
    component.addSelectedCardToDeck();
    expect(deckSvc.addCard).not.toHaveBeenCalled();
  });

  it('removeSelectedCardFromDeck removes from the first zone where the id is found (MAIN before EXTRA before SIDE)', () => {
    // Same id present in both EXTRA and SIDE — main must be checked first
    // (empty), then extra wins. A refactor reordering the zones would
    // silently change which copy is removed.
    const cd = makeCardDetail(12345, { extraCard: true });
    deckSvc.setDeck(makeDeck({
      extra: [makeIndexedCard(12345, 0, { extraCard: true })],
      side: [makeIndexedCard(12345, 0)],
    }));
    component.onCardClicked(cd);
    component.removeSelectedCardFromDeck();
    expect(deckSvc.removeCard).toHaveBeenCalledOnceWith(0, DeckZone.EXTRA);
  });

  it('removeSelectedCardFromDeck is a no-op when the selected card is not in the deck', () => {
    deckSvc.setDeck(makeDeck({ main: [makeIndexedCard(99999, 0)] }));
    component.onCardClicked(makeCardDetail(11111));
    component.removeSelectedCardFromDeck();
    expect(deckSvc.removeCard).not.toHaveBeenCalled();
  });

  it('selectedCardOwnedCount reads ownedMap by selected card id, defaults to 0', () => {
    const owned = ownedSvcOf(fixture);
    owned.setOwned(new Map([[12345, 3]]));
    component.onCardClicked(makeCardDetail(12345));
    expect(component.selectedCardOwnedCount()).toBe(3);

    component.onCardClicked(makeCardDetail(99999));
    expect(component.selectedCardOwnedCount()).toBe(0);
  });
});

describe('DeckBuilderComponent — onDeckCardClicked / onImageChange', () => {
  let fixture: ComponentFixture<DeckBuilderComponent>;
  let component: DeckBuilderComponent;
  let deckSvc: StubDeckBuildService;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DeckBuilderComponent);
    component = fixture.componentInstance;
    deckSvc = deckSvcOf(fixture);
  });

  it('onImageChange routes to updateCardImage with the correct zone+slot when a deck card is selected', () => {
    const indexed = makeIndexedCard(12345, 2, { selectedImageId: 100 });
    deckSvc.setDeck(makeDeck({ extra: [indexed] }));
    component.onDeckCardClicked(indexed);

    component.onImageChange(200);
    expect(deckSvc.updateCardImage).toHaveBeenCalledOnceWith(DeckZone.EXTRA, 0, 200);
  });

  it('onImageChange does NOT call updateCardImage when no deck slot is tracked (search-card selection)', () => {
    // onCardClicked sets selectedDeckSlot to null — image change is local
    // to the inspector preview, never persisted to the deck.
    component.onCardClicked(makeCardDetail(12345));
    component.onImageChange(200);
    expect(deckSvc.updateCardImage).not.toHaveBeenCalled();
  });

  it('dismissInspector clears all selection signals', () => {
    const indexed = makeIndexedCard(12345, 0);
    deckSvc.setDeck(makeDeck({ main: [indexed] }));
    component.onDeckCardClicked(indexed);
    expect(component.selectedCardForInspector()).not.toBeNull();

    component.dismissInspector();
    expect(component.selectedCardForInspector()).toBeNull();
    // Re-clicking image change after dismiss must NOT route — the slot is gone.
    component.onImageChange(999);
    expect(deckSvc.updateCardImage).not.toHaveBeenCalled();
  });
});

describe('DeckBuilderComponent — navigateToPvp guards', () => {
  let fixture: ComponentFixture<DeckBuilderComponent>;
  let component: DeckBuilderComponent;
  let deckSvc: StubDeckBuildService;
  let roomApi: StubRoomApiService;
  let notify: StubNotification;
  let router: StubRouter;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DeckBuilderComponent);
    component = fixture.componentInstance;
    deckSvc = deckSvcOf(fixture);
    roomApi = roomApiOf(fixture);
    notify = notifyOf(fixture);
    router = routerOf(fixture);
  });

  /** Build a deck with a stable id and N main / E extra / S side filled
   *  slots. Pads zones so `filter(s => s.index !== -1)` yields exactly the
   *  intended counts (Deck ctor caps at 60/15/15 with -1 placeholders). */
  function makeDeckWithCounts(main: number, extra: number, side: number, id: number = 42): Deck {
    return makeDeck({
      main: Array.from({ length: main }, (_, i) => makeIndexedCard(1, i)),
      extra: Array.from({ length: extra }, (_, i) => makeIndexedCard(2, i, { extraCard: true })),
      side: Array.from({ length: side }, (_, i) => makeIndexedCard(3, i)),
    }, id);
  }

  it('rejects deck with main < 40 cards (no createRoom call)', () => {
    deckSvc.setDeck(makeDeckWithCounts(39, 15, 0));
    component.navigateToPvp();
    expect(notify.error).toHaveBeenCalledWith('error.DECK_MAIN_INVALID', { count: 39, min: 40, max: 60 });
    expect(roomApi.createRoom).not.toHaveBeenCalled();
    expect(component.pvpLoading()).toBe(false);
  });

  it('rejects deck with main > 60 cards', () => {
    // Note: Deck zone caps at 60 in the constructor — this is the boundary
    // the validation MUST guard, not just the constructor.
    deckSvc.setDeck(makeDeckWithCounts(60, 0, 0));
    // Manually push the invariant past the cap by re-injecting one extra slot:
    const d = deckSvc.deck();
    d.mainDeck[60] = makeIndexedCard(1, 60); // direct mutation to bypass cap
    deckSvc.setDeck(d);
    component.navigateToPvp();
    expect(notify.error).toHaveBeenCalledWith('error.DECK_MAIN_INVALID', jasmine.objectContaining({ count: 61 }));
  });

  it('rejects deck with extra > 15 cards', () => {
    const d = makeDeckWithCounts(40, 15, 0);
    d.extraDeck[15] = makeIndexedCard(2, 15, { extraCard: true });
    deckSvc.setDeck(d);
    component.navigateToPvp();
    expect(notify.error).toHaveBeenCalledWith('error.DECK_EXTRA_INVALID', { count: 16, max: 15 });
    expect(roomApi.createRoom).not.toHaveBeenCalled();
  });

  it('rejects deck with side > 15 cards', () => {
    const d = makeDeckWithCounts(40, 0, 15);
    d.sideDeck[15] = makeIndexedCard(3, 15);
    deckSvc.setDeck(d);
    component.navigateToPvp();
    expect(notify.error).toHaveBeenCalledWith('error.DECK_SIDE_INVALID', { count: 16, max: 15 });
    expect(roomApi.createRoom).not.toHaveBeenCalled();
  });

  it('does nothing when deck has no id (unsaved deck)', () => {
    // Skip the helper's default `id=42` — explicitly clear it after build.
    const d = makeDeckWithCounts(40, 0, 0);
    d.id = undefined;
    deckSvc.setDeck(d);
    component.navigateToPvp();
    expect(notify.error).not.toHaveBeenCalled();
    expect(roomApi.createRoom).not.toHaveBeenCalled();
  });

  it('valid deck: sets pvpLoading, calls createRoom, navigates with deckName state', () => {
    deckSvc.setDeck(makeDeckWithCounts(40, 0, 0));
    deckSvc.deck().name = 'My Test Deck';
    component.navigateToPvp();
    // pvpLoading was true synchronously (before the of() resolves). The of()
    // resolves immediately, so by the time we check, it has flipped back.
    expect(roomApi.createRoom).toHaveBeenCalledWith(42);
    expect(router.navigate).toHaveBeenCalledWith(
      ['/pvp/duel', 'ABC123'],
      { state: { deckName: 'My Test Deck' } },
    );
    expect(component.pvpLoading()).toBe(false);
  });

  it('createRoom error path: clears pvpLoading and surfaces the error', () => {
    const err = new HttpErrorResponse({ status: 500 });
    roomApi.createRoom.and.returnValue(throwError(() => err));
    deckSvc.setDeck(makeDeckWithCounts(40, 0, 0));
    component.navigateToPvp();
    expect(notify.error).toHaveBeenCalledWith(err);
    expect(component.pvpLoading()).toBe(false);
  });
});

describe('DeckBuilderComponent — save flow', () => {
  let fixture: ComponentFixture<DeckBuilderComponent>;
  let component: DeckBuilderComponent;
  let deckSvc: StubDeckBuildService;
  let router: StubRouter;
  let notify: StubNotification;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DeckBuilderComponent);
    component = fixture.componentInstance;
    deckSvc = deckSvcOf(fixture);
    router = routerOf(fixture);
    notify = notifyOf(fixture);
  });

  it('save() on a new deck (no id): on success, navigates to /decks/:id with replaceUrl', () => {
    // Pre-save: no id. The success callback fires AFTER the service has
    // updated the deck with a server-assigned id, so we simulate the
    // mutation inside the spy.
    deckSvc.setDeck(makeDeck({}, undefined));
    deckSvc.save.and.callFake((onSuccess: () => void) => {
      // Service contract: the new id is set on the deck before onSuccess fires.
      const newDeck = makeDeck({}, 42);
      deckSvc.setDeck(newDeck);
      onSuccess();
    });

    component.save();

    expect(notify.success).toHaveBeenCalledWith('success.DECK_SAVED');
    expect(router.navigate).toHaveBeenCalledWith(['/decks', 42], { replaceUrl: true });
  });

  it('save() on an existing deck (has id): on success, does NOT navigate', () => {
    deckSvc.setDeck(makeDeck({}, 42));
    deckSvc.save.and.callFake((onSuccess: () => void) => onSuccess());

    component.save();

    expect(notify.success).toHaveBeenCalledWith('success.DECK_SAVED');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('save() on error: calls notify.error with the error, does NOT navigate', () => {
    const err = new HttpErrorResponse({ status: 500 });
    deckSvc.setDeck(makeDeck({}, undefined));
    deckSvc.save.and.callFake((_onSuccess: () => void, onError: (e: HttpErrorResponse) => void) => onError(err));

    component.save();

    expect(notify.error).toHaveBeenCalledWith(err);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('DeckBuilderComponent — name editing', () => {
  let fixture: ComponentFixture<DeckBuilderComponent>;
  let component: DeckBuilderComponent;
  let deckSvc: StubDeckBuildService;

  beforeEach(() => {
    jasmine.clock().install();
    setupTestBed();
    fixture = TestBed.createComponent(DeckBuilderComponent);
    component = fixture.componentInstance;
    deckSvc = deckSvcOf(fixture);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('startEditingName flips isEditingName to true', () => {
    component.startEditingName();
    expect(component.isEditingName()).toBe(true);
  });

  it('stopEditingName on a deck WITH id schedules a save after 500ms', () => {
    deckSvc.setDeck(makeDeck({}, 42));
    component.stopEditingName();
    // Save not called immediately — debounced 500ms.
    expect(deckSvc.save).not.toHaveBeenCalled();
    jasmine.clock().tick(499);
    expect(deckSvc.save).not.toHaveBeenCalled();
    jasmine.clock().tick(1);
    expect(deckSvc.save).toHaveBeenCalledTimes(1);
  });

  it('stopEditingName on a deck WITHOUT id calls markDirty (no auto-save)', () => {
    deckSvc.setDeck(makeDeck({}, undefined));
    component.stopEditingName();
    expect(deckSvc.markDirty).toHaveBeenCalledTimes(1);
    jasmine.clock().tick(1000);
    expect(deckSvc.save).not.toHaveBeenCalled();
  });

  it('startEditingName cancels a pending auto-save timer', () => {
    // Stop, then immediately re-start before the 500ms timer fires.
    // The timer must be cleared so save does NOT run.
    deckSvc.setDeck(makeDeck({}, 42));
    component.stopEditingName();
    jasmine.clock().tick(200);
    component.startEditingName();
    jasmine.clock().tick(500);
    expect(deckSvc.save).not.toHaveBeenCalled();
  });

  it('onNameKeydown(Enter) blurs the input', () => {
    const input = document.createElement('input');
    spyOn(input, 'blur');
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(event, 'target', { value: input });
    component.onNameKeydown(event);
    expect(input.blur).toHaveBeenCalledTimes(1);
  });
});

describe('DeckBuilderComponent — favorites', () => {
  let fixture: ComponentFixture<DeckBuilderComponent>;
  let component: DeckBuilderComponent;
  let deckSvc: StubDeckBuildService;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DeckBuilderComponent);
    component = fixture.componentInstance;
    deckSvc = deckSvcOf(fixture);
  });

  it('onFavoriteChange flips favorite=false → true via addFavoriteCard and updates local state', async () => {
    const cd = makeCardDetail(12345, { favorite: false });
    component.onCardClicked(cd);

    await component.onFavoriteChange();

    expect(deckSvc.addFavoriteCard).toHaveBeenCalled();
    expect(deckSvc.removeFavoriteCard).not.toHaveBeenCalled();
    // Local mirror updated so the inspector reflects the flip without
    // waiting for a re-fetch.
    expect(component['selectedCardDetail']()?.favorite).toBe(true);
  });

  it('onFavoriteChange flips favorite=true → false via removeFavoriteCard', async () => {
    const cd = makeCardDetail(12345, { favorite: true });
    component.onCardClicked(cd);

    await component.onFavoriteChange();

    expect(deckSvc.removeFavoriteCard).toHaveBeenCalled();
    expect(deckSvc.addFavoriteCard).not.toHaveBeenCalled();
    expect(component['selectedCardDetail']()?.favorite).toBe(false);
  });

  it('onFavoriteChange swallows API errors and leaves state unchanged', async () => {
    const cd = makeCardDetail(12345, { favorite: false });
    component.onCardClicked(cd);
    deckSvc.addFavoriteCard.and.returnValue(throwError(() => new Error('500')));

    await component.onFavoriteChange();

    // State NOT updated — failed flip must not silently lie.
    expect(component['selectedCardDetail']()?.favorite).toBe(false);
  });

  it('onFavoriteChange is a no-op when no card is selected', async () => {
    await component.onFavoriteChange();
    expect(deckSvc.addFavoriteCard).not.toHaveBeenCalled();
    expect(deckSvc.removeFavoriteCard).not.toHaveBeenCalled();
  });
});

describe('DeckBuilderComponent — filter routing (useExternalFilters)', () => {
  let fixture: ComponentFixture<DeckBuilderComponent>;
  let component: DeckBuilderComponent;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DeckBuilderComponent);
    component = fixture.componentInstance;
  });

  // BreakpointObserver default = matches: false — both isLandscapeSplit and
  // isCompactHeight resolve to false, so useExternalFilters() = false.

  it('onFiltersExpanded with internal filters routes to filtersRequestedSnap', () => {
    component.onFiltersExpanded(true);
    expect(component.filtersRequestedSnap()).toBe('full');
    expect(component.externalFiltersOpened()).toBe(false);

    component.onFiltersExpanded(false);
    expect(component.filtersRequestedSnap()).toBeNull();
  });

  it('toggleSearchPanel flips searchPanelOpened', () => {
    expect(component.searchPanelOpened()).toBe(false);
    component.toggleSearchPanel();
    expect(component.searchPanelOpened()).toBe(true);
    component.toggleSearchPanel();
    expect(component.searchPanelOpened()).toBe(false);
  });
});
