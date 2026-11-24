import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { NotificationService } from '../../../core/services/notification.service';
import { RoomApiService } from '../room-api.service';
import { RoomDTO } from '../room.types';
import { BoosterStateDTO, PulledCardDTO } from './booster.types';
import { BoosterDraftComponent, FIRST_FLIP_DELAY_MS, FLIP_STAGGER_MS, TEAR_MS } from './booster-draft.component';
import { makePull } from './booster-deck.utils.spec';

function makeState(overrides: Partial<BoosterStateDTO> = {}): BoosterStateDTO {
  return {
    setName: 'Legend of Blue Eyes White Dragon',
    boosterCount: 2,
    openedBoosters: 0,
    minMainDeckSize: 3,
    maxMainDeckSize: 60,
    maxExtraDeckSize: 15,
    ready: false,
    cards: [],
    ...overrides,
  };
}

function booster(): PulledCardDTO[] {
  return [makePull(1), makePull(2), makePull(3), makePull(4), makePull(5, { extra: true })];
}

describe('BoosterDraftComponent', () => {
  let fixture: ComponentFixture<BoosterDraftComponent>;
  let component: BoosterDraftComponent;
  let roomApi: jasmine.SpyObj<RoomApiService>;

  function setup(state: BoosterStateDTO): void {
    roomApi.getBoosterState.and.returnValue(of(state));
    fixture = TestBed.createComponent(BoosterDraftComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('roomCode', 'ABCDEF');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    roomApi = jasmine.createSpyObj<RoomApiService>('RoomApiService',
      ['getBoosterState', 'openBooster', 'submitBoosterDeck', 'unreadyBooster']);
    await TestBed.configureTestingModule({
      imports: [BoosterDraftComponent, TranslateModule.forRoot()],
      providers: [
        { provide: RoomApiService, useValue: roomApi },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['error', 'success']) },
      ],
    }).compileComponents();
  });

  it('starts on the opening view while boosters remain', () => {
    setup(makeState());
    expect(component.view()).toBe('open');
    expect(fixture.nativeElement.querySelector('.pack')).not.toBeNull();
  });

  it('starts on the building view once every booster is open, with the submitted deck restored', () => {
    const cards = booster().map((p, i) => i === 0 ? { ...p, deckZone: 'MAIN' as const, deckIndex: 0 } : p);
    setup(makeState({ openedBoosters: 2, cards }));
    expect(component.view()).toBe('build');
    expect(component.deck().main).toEqual([cards[0].id]);
  });

  it('opening a booster tears the pack, then flips the 5 cards one by one', fakeAsync(() => {
    setup(makeState());
    roomApi.openBooster.and.returnValue(of(booster()));

    component.openNext();
    expect(component.revealStage()).toBe('tearing');
    expect(component.openedBoosters()).toBe(1);

    tick(TEAR_MS);
    expect(component.revealStage()).toBe('dealing');
    expect(component.flippedCount()).toBe(0);

    tick(FIRST_FLIP_DELAY_MS);
    expect(component.flippedCount()).toBe(1);

    tick(FLIP_STAGGER_MS * 4);
    expect(component.flippedCount()).toBe(5);
    expect(component.revealStage()).toBe('revealed');
  }));

  it('a click on the dealt cards reveals them all at once', fakeAsync(() => {
    setup(makeState());
    roomApi.openBooster.and.returnValue(of(booster()));
    component.openNext();
    tick(TEAR_MS);

    component.skipReveal();

    expect(component.flippedCount()).toBe(5);
    expect(component.revealStage()).toBe('revealed');
    tick(FIRST_FLIP_DELAY_MS + FLIP_STAGGER_MS * 5);
    expect(component.flippedCount()).toBe(5);
  }));

  it('open all opens the remaining boosters and goes to the building view', () => {
    setup(makeState());
    roomApi.openBooster.and.returnValues(of(booster()), of(booster()));

    component.openAll();

    expect(roomApi.openBooster).toHaveBeenCalledTimes(2);
    expect(component.state()!.cards.length).toBe(10);
    expect(component.view()).toBe('build');
  });

  it('marking ready submits the deck and re-emits the room', () => {
    const cards = booster();
    setup(makeState({ openedBoosters: 2, cards }));
    const room = { roomCode: 'ABCDEF', player1Ready: true } as RoomDTO;
    roomApi.submitBoosterDeck.and.returnValue(of(room));
    const emitted: RoomDTO[] = [];
    component.roomUpdated.subscribe(r => emitted.push(r));

    component.addEverything();
    expect(component.problem()).toBeNull();
    component.markReady();

    expect(roomApi.submitBoosterDeck).toHaveBeenCalledWith('ABCDEF', {
      main: cards.slice(0, 4).map(c => c.id).sort((a, b) => a - b),
      extra: [cards[4].id],
    });
    expect(component.ready()).toBeTrue();
    expect(emitted).toEqual([room]);
  });

  it('like the deck builder: right click adds a pulled card, right click in the deck removes it', () => {
    const cards = booster();
    setup(makeState({ openedBoosters: 2, cards }));
    const entry = component.pool().find(e => e.cardId === 1)!;
    const event = new MouseEvent('contextmenu', { cancelable: true });

    component.addFromContextMenu(event, entry);
    expect(event.defaultPrevented).toBeTrue();
    expect(component.deck().main).toEqual([cards[0].id]);

    component.removeFromContextMenu(new MouseEvent('contextmenu', { cancelable: true }), component.pool()[0]);
    expect(component.deck().main).toEqual([]);
  });

  it('a click shows the card details, whose deck count follows the deck', () => {
    setup(makeState({ openedBoosters: 2, cards: booster() }));
    const entry = component.pool().find(e => e.cardId === 2)!;

    component.inspectEntry(entry);
    expect(component.inspected()).not.toBeNull();
    expect(component.inspectedEntry()!.inDeck).toBe(0);

    component.add(component.inspectedEntry()!);
    expect(component.inspectedEntry()!.inDeck).toBe(1);

    component.closeInspector();
    expect(component.inspected()).toBeNull();
    expect(component.inspectedEntry()).toBeNull();
  });

  it('does not submit a Main Deck below the room minimum', () => {
    setup(makeState({ openedBoosters: 2, cards: booster() }));
    component.markReady();
    expect(component.problem()).toBe('mainTooSmall');
    expect(roomApi.submitBoosterDeck).not.toHaveBeenCalled();
  });
});
