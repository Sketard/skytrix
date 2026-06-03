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
