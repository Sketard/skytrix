import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PvpHandRowComponent } from './pvp-hand-row.component';
import { DuelCardArtService } from '../duel-card-art.service';
import { CardOnField, POSITION } from '../../duel-ws.types';

function makeCard(overrides: Partial<CardOnField> = {}): CardOnField {
  return {
    cardCode: 12345,
    name: 'Test Card',
    position: POSITION.FACEUP_ATTACK,
    overlayMaterials: [],
    counters: {},
    ...overrides,
  };
}

describe('PvpHandRowComponent — chain-badge side routing (DS convention)', () => {
  let mockArt: jasmine.SpyObj<DuelCardArtService>;
  let fixture: ComponentFixture<PvpHandRowComponent>;

  beforeEach(() => {
    mockArt = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArt.resolveUrl.and.returnValue('mock-url');

    TestBed.configureTestingModule({
      imports: [PvpHandRowComponent],
      providers: [
        { provide: DuelCardArtService, useValue: mockArt },
      ],
    });

    fixture = TestBed.createComponent(PvpHandRowComponent);
    fixture.componentRef.setInput('cards', [makeCard({ cardCode: 1001 })]);
    fixture.componentRef.setInput('chainBadges', new Map([[0, 1]]));
  });

  // DS convention pin (CLAUDE.md "Chain Badges" tokens): GOLD = viewer (own
  // player), BLUE = opponent — applies in every context. Hand row signals
  // own/opp via the required `side` input.
  it('player-side hand row renders .chain-badge with .chain-badge--own', () => {
    fixture.componentRef.setInput('side', 'player');
    fixture.detectChanges();

    const badge = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.chain-badge');
    expect(badge)
      .withContext('chain-badge should be rendered when chainBadges map has an entry for the card index')
      .not.toBeNull();
    expect(badge!.classList.contains('chain-badge--own'))
      .withContext('player-side hand badge must carry .chain-badge--own (gold)')
      .toBe(true);
  });

  it('opponent-side hand row renders .chain-badge WITHOUT .chain-badge--own', () => {
    fixture.componentRef.setInput('side', 'opponent');
    fixture.detectChanges();

    const badge = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.chain-badge');
    expect(badge).not.toBeNull();
    expect(badge!.classList.contains('chain-badge--own'))
      .withContext('opponent-side hand badge must NOT carry .chain-badge--own (default blue)')
      .toBe(false);
  });
});

describe('PvpHandRowComponent — Direction B gestures (2026-06-05)', () => {
  let mockArt: jasmine.SpyObj<DuelCardArtService>;
  let fixture: ComponentFixture<PvpHandRowComponent>;
  let component: PvpHandRowComponent;

  beforeEach(() => {
    mockArt = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArt.resolveUrl.and.returnValue('mock-url');

    TestBed.configureTestingModule({
      imports: [PvpHandRowComponent],
      providers: [{ provide: DuelCardArtService, useValue: mockArt }],
    });

    fixture = TestBed.createComponent(PvpHandRowComponent);
    fixture.componentRef.setInput('cards', [makeCard({ cardCode: 1001 }), makeCard({ cardCode: 1002 })]);
    fixture.componentRef.setInput('side', 'player');
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('tap on an actionable card emits handCardAction, NOT inspect', () => {
    fixture.componentRef.setInput('actionableCardIndices', new Set([0]));
    fixture.detectChanges();
    const actions: { index: number; element: HTMLElement }[] = [];
    const inspects: { cardCode: number; forceExpanded?: boolean }[] = [];
    component.handCardAction.subscribe(e => actions.push(e));
    component.cardInspectRequest.subscribe(e => inspects.push(e));

    component.onCardTap(0, { currentTarget: document.createElement('div') } as unknown as MouseEvent);

    expect(actions.length).toBe(1);
    expect(inspects.length).toBe(0);
  });

  it('tap on a non-actionable card (B2 fallback) emits inspect, NOT action', () => {
    fixture.componentRef.setInput('actionableCardIndices', new Set<number>());
    fixture.detectChanges();
    const actions: { index: number; element: HTMLElement }[] = [];
    const inspects: { cardCode: number; forceExpanded?: boolean }[] = [];
    component.handCardAction.subscribe(e => actions.push(e));
    component.cardInspectRequest.subscribe(e => inspects.push(e));

    component.onCardTap(1, { currentTarget: document.createElement('div') } as unknown as MouseEvent);

    expect(actions.length).toBe(0);
    expect(inspects).toEqual([{ cardCode: 1002 }]);
  });

  it('opponent-side tap (non-actionable by definition) falls back to inspect', () => {
    fixture.componentRef.setInput('side', 'opponent');
    fixture.componentRef.setInput('actionableCardIndices', new Set<number>());
    fixture.detectChanges();
    const inspects: { cardCode: number; forceExpanded?: boolean }[] = [];
    component.cardInspectRequest.subscribe(e => inspects.push(e));
    component.onCardTap(0, { currentTarget: document.createElement('div') } as unknown as MouseEvent);
    expect(inspects).toEqual([{ cardCode: 1001 }]);
  });

  it('onCardContextMenu preventDefaults + emits inspect forceExpanded', () => {
    const inspects: { cardCode: number; forceExpanded?: boolean }[] = [];
    component.cardInspectRequest.subscribe(e => inspects.push(e));
    let prevented = false;
    const ev = { preventDefault: () => { prevented = true; } } as unknown as MouseEvent;
    component.onCardContextMenu(0, ev);
    expect(prevented).toBeTrue();
    expect(inspects).toEqual([{ cardCode: 1001, forceExpanded: true }]);
  });

  it('onCardLongPress emits inspect forceExpanded', () => {
    const inspects: { cardCode: number; forceExpanded?: boolean }[] = [];
    component.cardInspectRequest.subscribe(e => inspects.push(e));
    component.onCardLongPress(1);
    expect(inspects).toEqual([{ cardCode: 1002, forceExpanded: true }]);
  });
});
