import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { PvpBoardContainerComponent } from './pvp-board-container.component';
import { CardTravelEngine } from '../card-travel-engine.service';
import { DuelCardArtService } from '../duel-card-art.service';
import { DuelState, EMPTY_DUEL_STATE } from '../../types';
import { BoardZone, CardOnField, ZoneId, POSITION } from '../../duel-ws.types';

// =============================================================================
// Helpers
// =============================================================================

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

function makeZone(zoneId: ZoneId, cards: CardOnField[] = []): BoardZone {
  return { zoneId, cards };
}

/** Returns a fully-populated DuelState with N cards in the given zones for player 0
 *  and an empty player 1 by default. Override `players` to set both. */
function makeState(p0Zones: BoardZone[] = [], p1Zones: BoardZone[] = []): DuelState {
  return {
    ...EMPTY_DUEL_STATE,
    players: [
      { lp: 8000, deckCount: 40, extraCount: 15, zones: p0Zones },
      { lp: 8000, deckCount: 40, extraCount: 15, zones: p1Zones },
    ],
  };
}

// =============================================================================
// C4.1 — Field zones rendering + EMZ ownership
// =============================================================================

describe('PvpBoardContainerComponent — field zones + EMZ (C4.1)', () => {
  let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;
  let mockArt: jasmine.SpyObj<DuelCardArtService>;
  let fixture: ComponentFixture<PvpBoardContainerComponent>;
  let component: PvpBoardContainerComponent;

  beforeEach(() => {
    mockCardTravel = jasmine.createSpyObj<CardTravelEngine>(
      'CardTravelEngine',
      ['registerZoneResolver', 'getZoneElement', 'createLineBetween'],
    );
    mockArt = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArt.resolveUrl.and.returnValue('mock-url');

    TestBed.configureTestingModule({
      imports: [PvpBoardContainerComponent],
      providers: [
        { provide: CardTravelEngine, useValue: mockCardTravel },
        { provide: DuelCardArtService, useValue: mockArt },
        { provide: TranslateService, useValue: {
          currentLang: 'en',
          instant: (k: string) => k,
          get: (k: string) => ({ subscribe: (fn: (v: string) => void) => fn(k) }),
          onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onTranslationChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onDefaultLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
        } },
      ],
    });

    fixture = TestBed.createComponent(PvpBoardContainerComponent);
    component = fixture.componentInstance;
    // Mark this fixture as a preview to skip the rebuildZoneMap DOM scope query
    // (we don't render the full board template — preview=true is the public
    // escape hatch already used by the timeline thumbnail in replay).
    fixture.componentRef.setInput('preview', true);
    fixture.componentRef.setInput('duelState', EMPTY_DUEL_STATE);
  });

  it('playerZones() returns one entry per FIELD_ZONE_ID with the correct gridArea', () => {
    fixture.detectChanges();

    const zones = component.playerZones();
    // 14 field zones: M1-M5, S1-S5, FIELD, GY, EXTRA, DECK
    expect(zones.length).toBe(14);

    const m1 = zones.find(z => z.zoneId === 'M1');
    expect(m1?.gridArea).toBe('mz1');
    const s5 = zones.find(z => z.zoneId === 'S5');
    expect(s5?.gridArea).toBe('st5');
    const gy = zones.find(z => z.zoneId === 'GY');
    expect(gy?.gridArea).toBe('gy');
    const deck = zones.find(z => z.zoneId === 'DECK');
    expect(deck?.gridArea).toBe('deck');
  });

  it('field zones (M1-M5, S1-S5) read card from cards[0], cardCount = cards.length', () => {
    const card = makeCard({ cardCode: 99999, name: 'Top Monster' });
    const state = makeState([makeZone('M3', [card])]);
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    const m3 = component.playerZones().find(z => z.zoneId === 'M3');
    expect(m3?.card?.cardCode).toBe(99999);
    expect(m3?.cardCount).toBe(1);
    expect(m3?.renderMode).toBe('terrain');
  });

  it('pile zones (GY, BANISHED, EXTRA) read card from cards[cards.length-1] (top of pile)', () => {
    const bottom = makeCard({ cardCode: 1, name: 'Bottom' });
    const middle = makeCard({ cardCode: 2, name: 'Middle' });
    const top = makeCard({ cardCode: 3, name: 'Top' });
    const state = makeState([makeZone('GY', [bottom, middle, top])]);
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    const gy = component.playerZones().find(z => z.zoneId === 'GY');
    // OCGCore convention: highest sequence = top of pile = LAST element. Pin
    // this — flipping the order would silently desync the GY top with the
    // server's "top of pile" notion and break click→inspect on the visible card.
    expect(gy?.card?.cardCode).toBe(3);
    expect(gy?.cardCount).toBe(3);
    expect(gy?.renderMode).toBe('pile-faceup');
  });

  it('DECK zone has renderMode="deck" regardless of cards content', () => {
    fixture.detectChanges();
    const deck = component.playerZones().find(z => z.zoneId === 'DECK');
    expect(deck?.renderMode).toBe('deck');
  });

  it('EMZ_L lookup tries player 0 first, then player 1 (MR5 ownership rule)', () => {
    // Both players have an EMZ_L slot in OCGCore FieldState; ownership is
    // implied by which side has the actual card. emzL() reads p0 first then
    // falls back to p1.
    const oppCard = makeCard({ cardCode: 88888, name: 'Opponent EMZ Card' });
    const state = makeState([], [makeZone('EMZ_L', [oppCard])]);
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    expect(component.emzL()?.cardCode).toBe(88888);
  });

  it('emzConfigs marks EMZ as opponent when only player 1 has the card', () => {
    const oppCard = makeCard({ cardCode: 77777 });
    const state = makeState([], [makeZone('EMZ_R', [oppCard])]);
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    const configs = (component as unknown as { emzConfigs: () => Array<{ zoneId: ZoneId; isOpponent: boolean }> }).emzConfigs();
    const emzR = configs.find(c => c.zoneId === 'EMZ_R');
    expect(emzR?.isOpponent).toBe(true);
    const emzL = configs.find(c => c.zoneId === 'EMZ_L');
    expect(emzL?.isOpponent).toBe(false);
  });

  it('playerLp / opponentLp default to 8000 when player slot is missing', () => {
    // Defensive fallback for the brief window between init and first
    // BOARD_STATE — pinning prevents a future refactor from removing the
    // `?? 8000` and rendering 0/undefined LP during pre-game.
    const state: DuelState = {
      ...EMPTY_DUEL_STATE,
      players: [undefined as unknown as DuelState['players'][0], undefined as unknown as DuelState['players'][1]] as DuelState['players'],
    };
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    expect(component.playerLp()).toBe(8000);
    expect(component.opponentLp()).toBe(8000);
  });

  it('playerBanishedCount reflects cards.length on the BANISHED zone', () => {
    const cards = [makeCard({ cardCode: 1 }), makeCard({ cardCode: 2 }), makeCard({ cardCode: 3 })];
    const state = makeState([makeZone('BANISHED', cards)]);
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    expect(component.playerBanishedCount()).toBe(3);
    expect(component.playerBanished()?.cardCode).toBe(1); // findZoneCard returns cards[0]
  });

  it('absoluteTurnPlayer maps relative=0 to ownPlayerIndex (own=1 → absolute=1)', () => {
    // Own player 1, relative turn=0 means "my turn" → absolute=1. Pin the
    // mapping that PvpTimerBadgeComponent depends on (timerState.player is
    // absolute server-side; the badge needs to know whose pool to display).
    const state: DuelState = { ...EMPTY_DUEL_STATE, turnPlayer: 0 };
    fixture.componentRef.setInput('duelState', state);
    fixture.componentRef.setInput('ownPlayerIndex', 1);
    fixture.detectChanges();

    expect(component.absoluteTurnPlayer()).toBe(1);

    // Relative=1 ("opponent's turn") with own=1 → absolute=0
    fixture.componentRef.setInput('duelState', { ...state, turnPlayer: 1 });
    fixture.detectChanges();

    expect(component.absoluteTurnPlayer()).toBe(0);
  });
});
