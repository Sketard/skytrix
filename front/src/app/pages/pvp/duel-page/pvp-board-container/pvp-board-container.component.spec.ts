import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { PvpBoardContainerComponent } from './pvp-board-container.component';
import { CardTravelEngine } from '../card-travel-engine.service';
import { DuelCardArtService } from '../duel-card-art.service';
import { DuelState, EMPTY_DUEL_STATE } from '../../types';
import { BoardZone, CardOnField, ZoneId, POSITION, LOCATION, SelectIdleCmdMsg, SelectBattleCmdMsg, CardInfo } from '../../duel-ws.types';
import { CardAction } from '../idle-action-codes';

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

// =============================================================================
// C4.2 — Action dispatch + click handlers
// =============================================================================

function makeCardInfo(overrides: Partial<CardInfo> = {}): CardInfo {
  return {
    cardCode: 12345,
    name: 'Test Card',
    player: 0,
    location: LOCATION.MZONE,
    sequence: 0,
    ...overrides,
  };
}

function makeIdleCmdPrompt(overrides: Partial<SelectIdleCmdMsg> = {}): SelectIdleCmdMsg {
  return {
    type: 'SELECT_IDLECMD',
    player: 0,
    summons: [],
    specialSummons: [],
    repositions: [],
    setMonsters: [],
    activations: [],
    setSpellTraps: [],
    canBattlePhase: true,
    canEndPhase: true,
    ...overrides,
  };
}

function makeBattleCmdPrompt(overrides: Partial<SelectBattleCmdMsg> = {}): SelectBattleCmdMsg {
  return {
    type: 'SELECT_BATTLECMD',
    player: 0,
    attacks: [],
    activations: [],
    canMainPhase2: true,
    canEndPhase: true,
    ...overrides,
  };
}

describe('PvpBoardContainerComponent — action dispatch + clicks (C4.2)', () => {
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
    fixture.componentRef.setInput('preview', true);
    fixture.componentRef.setInput('duelState', EMPTY_DUEL_STATE);
  });

  it('actionableCards() is empty when readOnly=true, even with an active prompt', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.componentRef.setInput('actionablePrompt', makeIdleCmdPrompt({
      summons: [makeCardInfo({ location: LOCATION.HAND, sequence: 0 })],
    }));
    fixture.detectChanges();

    expect(component.actionableCards().size).toBe(0);
    expect(component.activateZoneIds().size).toBe(0);
    expect(component.nonActivateZoneIds().size).toBe(0);
  });

  it('actionableCards() is empty when no prompt is active (regardless of duelState)', () => {
    fixture.componentRef.setInput('actionablePrompt', null);
    fixture.detectChanges();
    expect(component.actionableCards().size).toBe(0);
  });

  it('IDLECMD prompt builds actionableCards via buildActionableCardsFromIdle', () => {
    // Place a summonable monster at MZONE seq 2 → key "4-2"
    const card = makeCardInfo({ location: LOCATION.MZONE, sequence: 2 });
    fixture.componentRef.setInput('actionablePrompt', makeIdleCmdPrompt({ summons: [card] }));
    fixture.detectChanges();

    const map = component.actionableCards();
    const key = `${LOCATION.MZONE}-2`;
    expect(map.has(key)).toBe(true);
    expect(map.get(key)?.[0].label).toBe('Normal Summon');
  });

  it('BATTLECMD prompt builds actionableCards via buildActionableCardsFromBattle', () => {
    // Attack from MZONE seq 0 → key "4-0"
    const card = makeCardInfo({ location: LOCATION.MZONE, sequence: 0 });
    fixture.componentRef.setInput('actionablePrompt', makeBattleCmdPrompt({ attacks: [card] }));
    fixture.detectChanges();

    const map = component.actionableCards();
    const key = `${LOCATION.MZONE}-0`;
    expect(map.has(key)).toBe(true);
    expect(map.get(key)?.[0].label).toBe('Attack');
  });

  it('activateZoneIds contains only zones with isActivateAction (gold-glow filter)', () => {
    // Mix: one summon (non-activate) on M3, one activation on S2
    const summon = makeCardInfo({ location: LOCATION.MZONE, sequence: 2 });
    const activation = makeCardInfo({ location: LOCATION.SZONE, sequence: 1, cardCode: 22222 });
    fixture.componentRef.setInput('actionablePrompt', makeIdleCmdPrompt({
      summons: [summon],
      activations: [activation],
    }));
    fixture.detectChanges();

    expect(component.activateZoneIds()).toEqual(new Set<ZoneId>(['S2']));
    expect(component.nonActivateZoneIds()).toEqual(new Set<ZoneId>(['M3']));
  });

  it('onZoneCardClick emits cardInspectRequest when the zone has a card', () => {
    fixture.detectChanges();
    const events: Array<{ cardCode: number }> = [];
    component.cardInspectRequest.subscribe(e => events.push({ cardCode: e.cardCode }));

    const card = makeCard({ cardCode: 55555 });
    const zone = { zoneId: 'M1' as ZoneId, card, cardCount: 1, renderMode: 'terrain' as const, gridArea: 'mz1' };
    component.onZoneCardClick({ currentTarget: document.createElement('div') } as unknown as MouseEvent, zone);

    expect(events).toEqual([{ cardCode: 55555 }]);
  });

  it('onZoneCardClick emits menuRequest when actions are available for the zone', () => {
    // Make M1 actionable via SUMMON.
    const card = makeCardInfo({ location: LOCATION.MZONE, sequence: 0 });
    fixture.componentRef.setInput('actionablePrompt', makeIdleCmdPrompt({ summons: [card] }));
    fixture.detectChanges();

    const menuEvents: Array<{ zoneId: ZoneId; actions: CardAction[] }> = [];
    component.menuRequest.subscribe(e => menuEvents.push({ zoneId: e.zoneId, actions: e.actions }));

    const onFieldCard = makeCard({ cardCode: 99999 });
    const zone = { zoneId: 'M1' as ZoneId, card: onFieldCard, cardCount: 1, renderMode: 'terrain' as const, gridArea: 'mz1' };
    component.onZoneCardClick({ currentTarget: document.createElement('div') } as unknown as MouseEvent, zone);

    expect(menuEvents.length).toBe(1);
    expect(menuEvents[0].zoneId).toBe('M1');
    expect(menuEvents[0].actions[0].label).toBe('Normal Summon');
  });

  it('onZoneCardClick in readOnly=true emits cardInspectRequest but NOT menuRequest', () => {
    fixture.componentRef.setInput('readOnly', true);
    // Even with an actionable prompt set, readOnly must short-circuit the
    // menu open path (replay must never expose interactive actions).
    const card = makeCardInfo({ location: LOCATION.MZONE, sequence: 0 });
    fixture.componentRef.setInput('actionablePrompt', makeIdleCmdPrompt({ summons: [card] }));
    fixture.detectChanges();

    const inspectEvents: number[] = [];
    const menuEvents: ZoneId[] = [];
    component.cardInspectRequest.subscribe(e => inspectEvents.push(e.cardCode));
    component.menuRequest.subscribe(e => menuEvents.push(e.zoneId));

    const zone = { zoneId: 'M1' as ZoneId, card: makeCard({ cardCode: 55555 }), cardCount: 1, renderMode: 'terrain' as const, gridArea: 'mz1' };
    component.onZoneCardClick({ currentTarget: document.createElement('div') } as unknown as MouseEvent, zone);

    expect(inspectEvents).toEqual([55555]);
    expect(menuEvents).toEqual([]);
  });

  it('onPhaseAction is no-op in readOnly mode (replay)', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    const events: Array<{ action: number; index: number | null }> = [];
    component.actionResponse.subscribe(e => events.push(e));

    component.onPhaseAction({ action: 6, index: null }); // BATTLE_PHASE

    expect(events).toEqual([]);
  });

  it('onPhaseAction emits actionResponse when not readOnly', () => {
    fixture.detectChanges();

    const events: Array<{ action: number; index: number | null }> = [];
    component.actionResponse.subscribe(e => events.push(e));

    component.onPhaseAction({ action: 7, index: null }); // END_TURN

    expect(events).toEqual([{ action: 7, index: null }]);
  });

  it('onZonePillClick emits zonePillRequest unconditionally (readOnly + live)', () => {
    fixture.detectChanges();

    const events: Array<{ zoneId: ZoneId; playerIndex: number }> = [];
    component.zonePillRequest.subscribe(e => events.push(e));

    component.onZonePillClick({ currentTarget: document.createElement('button') } as unknown as MouseEvent, 'GY', 1);

    expect(events).toEqual([{ zoneId: 'GY', playerIndex: 1 }]);
  });
});
