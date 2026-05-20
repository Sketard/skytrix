import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { DeckListComponent } from './deck-list.component';
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
    banlistLegal: true,
    updatedAt: '2026-05-18T12:00:00Z',
    ...overrides,
  };
}

describe('DeckListComponent', () => {
  let fixture: ComponentFixture<DeckListComponent>;
  let deckSubject: BehaviorSubject<ShortDeck[]>;
  let isFirstDeckLoad: ReturnType<typeof signal<boolean>>;
  let deleteByIdSpy: jasmine.Spy;
  let dialogOpenSpy: jasmine.Spy;

  function setup(): void {
    fixture = TestBed.createComponent(DeckListComponent);
    fixture.detectChanges();
  }

  /** Native helpers — query the rendered DOM. */
  const q = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

  beforeEach(() => {
    deckSubject = new BehaviorSubject<ShortDeck[]>([]);
    isFirstDeckLoad = signal<boolean>(false);
    deleteByIdSpy = jasmine.createSpy('deleteById');
    dialogOpenSpy = jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(false) });

    const deckBuildStub = {
      decks$: deckSubject.asObservable(),
      isFirstDeckLoad,
      fetchDecks: jasmine.createSpy('fetchDecks'),
      deleteById: deleteByIdSpy,
    };
    const ownedStub = { ownedMap: signal(new Map<number, number>()) };
    const notify = jasmine.createSpyObj('NotificationService', ['success', 'error']);

    TestBed.configureTestingModule({
      imports: [DeckListComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: DeckBuildService, useValue: deckBuildStub },
        { provide: OwnedCardService, useValue: ownedStub },
        { provide: NotificationService, useValue: notify },
        { provide: MatDialog, useValue: { open: dialogOpenSpy } },
      ],
    });
  });

  // ─── Top-level branch routing ─────────────────────────────────────────────

  it('renders the welcome empty-state when not loading and no decks', () => {
    setup();
    const empty = q('app-empty-state');
    expect(empty?.getAttribute('variant')).toBe('welcome');
    // Welcome is full-bleed — no page-shell chrome above it.
    expect(q('app-page-shell')).toBeNull();
  });

  it('renders the full-bleed error empty-state on initial-load failure', () => {
    isFirstDeckLoad.set(true);
    setup();
    fixture.componentInstance['store'].error.set('boom');
    fixture.detectChanges();

    expect(q('app-empty-state')?.getAttribute('variant')).toBe('error');
    // Branch 1: error empty-state shows WITHOUT page-shell chrome.
    expect(q('app-page-shell')).toBeNull();
  });

  it('wraps the skeleton chrome in <app-page-shell> while first-loading', () => {
    isFirstDeckLoad.set(true);
    setup();

    expect(q('app-page-shell')).not.toBeNull();
    expect(q('app-deck-box-skeleton')).not.toBeNull();
    expect(q('app-deck-stats-strip-skeleton')).not.toBeNull();
  });

  it('renders the populated list inside <app-page-shell> when decks exist', () => {
    deckSubject.next([makeDeck({ id: 1, name: 'Alpha' }), makeDeck({ id: 2, name: 'Beta' })]);
    setup();

    expect(q('app-page-shell')).not.toBeNull();
    // 2 decks + the "add" deck-box tile.
    expect(fixture.nativeElement.querySelectorAll('deck-box').length).toBe(3);
  });

  // ─── page-shell wiring (the migration's core risk) ────────────────────────

  it('passes the deck-list title + gold icon-wrap to the page-shell', () => {
    deckSubject.next([makeDeck({ id: 1 })]);
    setup();

    // iconWrapPalette="gold" → page-shell renders <app-icon-wrap>, not a plain icon.
    expect(q('.page-header app-icon-wrap')).not.toBeNull();
    expect(q('.page-header .page-header__title')?.textContent?.trim()).toBe('deckList.title');
    expect(q('.page-header .page-header__subtitle')?.textContent?.trim()).toBe('deckList.subtitle');
  });

  it('projects the search-bar + new-deck CTA into the page-shell header slot', () => {
    deckSubject.next([makeDeck({ id: 1 })]);
    setup();

    // The [header-actions] slot must land the actions INSIDE the header,
    // not in the default body slot. A mistyped attribute would silently
    // drop them into the body — this asserts the contract.
    const actions = q('.page-header .deck-list__actions');
    expect(actions).not.toBeNull();
    expect(actions?.querySelector('search-bar')).not.toBeNull();
    expect(actions?.querySelector('.deck-list__cta')).not.toBeNull();
  });

  it('keeps the body content (stats + list) below the header', () => {
    deckSubject.next([makeDeck({ id: 1 })]);
    setup();

    const body = q('.deck-list__body');
    expect(body).not.toBeNull();
    expect(body?.querySelector('app-stats-strip')).not.toBeNull();
    expect(body?.querySelector('.deck-page')).not.toBeNull();
  });

  // ─── no-results vs welcome ────────────────────────────────────────────────

  it('shows the no-results empty-state when a search excludes every deck', () => {
    deckSubject.next([makeDeck({ id: 1, name: 'Branded' })]);
    setup();

    fixture.componentInstance.searchControl.setValue('xyzzy');
    fixture.detectChanges();

    // Still inside the page-shell — only the grid swaps to the empty-state.
    expect(q('app-page-shell')).not.toBeNull();
    expect(q('.deck-page app-empty-state')?.getAttribute('variant')).toBe('no-results');
  });

  // ─── interactions ─────────────────────────────────────────────────────────

  it('opens the confirm dialog when a deck delete button is clicked', () => {
    deckSubject.next([makeDeck({ id: 7, name: 'Doomed' })]);
    setup();

    (q('.deck-page-deck-remove') as HTMLButtonElement).click();
    expect(dialogOpenSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes the deck when the confirm dialog resolves true', () => {
    dialogOpenSpy.and.returnValue({ afterClosed: () => of(true) });
    deckSubject.next([makeDeck({ id: 7, name: 'Doomed' })]);
    setup();

    (q('.deck-page-deck-remove') as HTMLButtonElement).click();
    expect(deleteByIdSpy).toHaveBeenCalledWith(7, jasmine.any(Function), jasmine.any(Function));
  });

  it('does not delete when the confirm dialog resolves false', () => {
    dialogOpenSpy.and.returnValue({ afterClosed: () => of(false) });
    deckSubject.next([makeDeck({ id: 7, name: 'Doomed' })]);
    setup();

    (q('.deck-page-deck-remove') as HTMLButtonElement).click();
    expect(deleteByIdSpy).not.toHaveBeenCalled();
  });

  it('clearSearch resets both the form control and the store query', () => {
    deckSubject.next([makeDeck({ id: 1, name: 'Branded' })]);
    setup();

    fixture.componentInstance.searchControl.setValue('branded');
    fixture.detectChanges();
    fixture.componentInstance.clearSearch();

    expect(fixture.componentInstance.searchControl.value).toBe('');
    expect(fixture.componentInstance['store'].searchQuery()).toBe('');
  });
});
