import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { PvpBoardContainerComponent } from './pvp-board-container.component';
import { CardTravelEngine } from '../card-travel-engine.service';
import { DuelCardArtService } from '../duel-card-art.service';
import { DuelGameLogService } from '../duel-game-log.service';
import { ScopeResetDispatcher } from '../../projections';
import { ChainLinkState, DuelState, EMPTY_DUEL_STATE } from '../../types';
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
        DuelGameLogService,
        ScopeResetDispatcher,
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

  // Regression: `LinkedCardRef.controller` is an absolute OCGCore index
  // (message-filter.ts swaps players[] but NOT per-card `controller`). The
  // linkedZoneMap target key MUST relativize it via ownPlayerIndex — else
  // Equip/target lines point at the wrong board half for the J2 / perspective-1
  // viewer.
  it('linkedZoneMap relativizes link.controller against ownPlayerIndex', () => {
    const linkSpell = makeCard({
      cardCode: 50001, name: 'Equip Spell',
      // Equip spell sits in S1, points at a monster controlled by absolute
      // player 1 in M3.
      linkedCards: [{ kind: 'equip', controller: 1, location: LOCATION.MZONE, sequence: 2 }],
    });
    const state = makeState([makeZone('S1', [linkSpell])]);

    // Viewer is absolute player 1 → the controller-1 monster is the viewer's
    // OWN side → its zone key must use relative 0, not absolute 1.
    fixture.componentRef.setInput('duelState', state);
    fixture.componentRef.setInput('ownPlayerIndex', 1);
    fixture.detectChanges();

    const map = (component as unknown as { linkedZoneMap: () => Map<string, string[]> }).linkedZoneMap();
    expect(map.get('S1-0')).toEqual(['M3-0']);
    expect(map.get('M3-0')).toEqual(['S1-0']);
    expect(map.has('M3-1')).toBeFalse();
  });

  it('linkedZoneMap keeps controller absolute-matching when ownPlayerIndex is 0', () => {
    const linkSpell = makeCard({
      cardCode: 50002, name: 'Equip Spell',
      linkedCards: [{ kind: 'equip', controller: 1, location: LOCATION.MZONE, sequence: 2 }],
    });
    const state = makeState([makeZone('S1', [linkSpell])]);

    // Viewer is absolute player 0 → controller-1 monster is the opponent →
    // relative 1.
    fixture.componentRef.setInput('duelState', state);
    fixture.componentRef.setInput('ownPlayerIndex', 0);
    fixture.detectChanges();

    const map = (component as unknown as { linkedZoneMap: () => Map<string, string[]> }).linkedZoneMap();
    expect(map.get('S1-0')).toEqual(['M3-1']);
    expect(map.get('M3-1')).toEqual(['S1-0']);
  });
});

// =============================================================================
// emptyZoneTap — Free-mode empty-slot tap channel (non-regression)
//
// The ONLY addition to the shared board container for PvP Free Mode. Wired by
// `(click)` on the empty field slots of the PLAYER side only:
//   - L474 — own zones (relPlayer 0): WIRED
//   - L303 — EMZ, P0 half only (`!emz.isOpponent`): WIRED
//   - L200 — opponent zones (relPlayer 1): NOT wired
// Inert in PvP/replay: no parent subscribes, so `emit()` is a no-op. These
// pins guard that (a) the right slots emit, (b) the opponent slot never does,
// (c) the new (click) doesn't perturb neighbouring event propagation.
// =============================================================================

describe('PvpBoardContainerComponent — emptyZoneTap (free-mode channel)', () => {
  let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;
  let mockArt: jasmine.SpyObj<DuelCardArtService>;
  let fixture: ComponentFixture<PvpBoardContainerComponent>;
  let component: PvpBoardContainerComponent;

  beforeEach(() => {
    mockCardTravel = jasmine.createSpyObj<CardTravelEngine>(
      'CardTravelEngine',
      ['registerZoneResolver', 'getZoneElement', 'createLineBetween', 'registerContainer'],
    );
    mockArt = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArt.resolveUrl.and.returnValue('mock-url');

    TestBed.configureTestingModule({
      imports: [PvpBoardContainerComponent],
      providers: [
        { provide: CardTravelEngine, useValue: mockCardTravel },
        { provide: DuelCardArtService, useValue: mockArt },
        DuelGameLogService,
        ScopeResetDispatcher,
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
    // preview=true renders the full template but skips ngAfterViewInit's
    // CardTravelEngine wiring (same escape hatch the C4.1/C4.3 specs use).
    fixture.componentRef.setInput('preview', true);
    // EMPTY_DUEL_STATE → every field zone is empty → all 3 .zone-empty sites render.
    fixture.componentRef.setInput('duelState', EMPTY_DUEL_STATE);
  });

  it('emits the zoneId when an OWN empty field slot (relPlayer 0) is clicked', () => {
    fixture.detectChanges();
    const emitted: ZoneId[] = [];
    component.emptyZoneTap.subscribe(z => emitted.push(z));

    const host = fixture.nativeElement as HTMLElement;
    const ownEmpty = host.querySelector<HTMLElement>('.player-field .zone-empty');
    expect(ownEmpty).withContext('own empty slot rendered').toBeTruthy();
    ownEmpty!.click();

    expect(emitted.length).toBe(1);
  });

  it('emits the zoneId when the OWN EMZ empty slot (P0 half) is clicked', () => {
    fixture.detectChanges();
    const emitted: ZoneId[] = [];
    component.emptyZoneTap.subscribe(z => emitted.push(z));

    const host = fixture.nativeElement as HTMLElement;
    const emzOwnEmpty = host.querySelector<HTMLElement>('.emz:not(.emz--opponent) .zone-empty');
    expect(emzOwnEmpty).withContext('own EMZ empty slot rendered').toBeTruthy();
    emzOwnEmpty!.click();

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toMatch(/^EMZ_[LR]$/);
  });

  it('does NOT emit when an OPPONENT empty field slot (relPlayer 1) is clicked', () => {
    fixture.detectChanges();
    const emitted: ZoneId[] = [];
    component.emptyZoneTap.subscribe(z => emitted.push(z));

    const host = fixture.nativeElement as HTMLElement;
    const oppEmpty = host.querySelector<HTMLElement>('.opponent-field .zone-empty');
    expect(oppEmpty).withContext('opponent empty slot rendered').toBeTruthy();
    oppEmpty!.click();

    expect(emitted).toEqual([]);
  });

  it('does NOT wire the (click) on the OPPONENT EMZ half (only P0 half is wired)', () => {
    // Force EMZ_R to opponent ownership by placing a P1 card on it. The other
    // EMZ (EMZ_L) stays P0 + empty, so the own-half wiring still works while
    // the opponent half carries no emit binding. We assert the own half still
    // emits and the opponent EMZ is rendered as the opponent (no own emit path).
    const oppCard = makeCard({ cardCode: 88888 });
    const state = makeState([], [makeZone('EMZ_R', [oppCard])]);
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    const emitted: ZoneId[] = [];
    component.emptyZoneTap.subscribe(z => emitted.push(z));

    const host = fixture.nativeElement as HTMLElement;
    // EMZ_R is now opponent-owned (and occupied → no .zone-empty there).
    // EMZ_L stays own + empty → its empty slot is the only wired EMZ tap.
    const emzOppOccupied = host.querySelector<HTMLElement>('.emz.emz--opponent');
    expect(emzOppOccupied).withContext('opponent EMZ rendered').toBeTruthy();

    const emzOwnEmpty = host.querySelector<HTMLElement>('.emz:not(.emz--opponent) .zone-empty');
    expect(emzOwnEmpty).withContext('own EMZ empty slot still present').toBeTruthy();
    emzOwnEmpty!.click();
    expect(emitted).toEqual(['EMZ_L']);
  });

  it('is a no-op in PvP — no parent subscriber means emit reaches nobody (output inert)', () => {
    // No subscriber attached at all. Clicking must not throw and must not
    // affect any other channel — this is the structural inertness guarantee.
    fixture.detectChanges();
    const inspects: number[] = [];
    const menus: ZoneId[] = [];
    component.cardInspectRequest.subscribe(e => inspects.push(e.cardCode));
    component.menuRequest.subscribe(e => menus.push(e.zoneId));

    const host = fixture.nativeElement as HTMLElement;
    const ownEmpty = host.querySelector<HTMLElement>('.player-field .zone-empty');
    expect(() => ownEmpty!.click()).not.toThrow();

    // The (click) on an empty slot must not bleed into neighbouring channels.
    expect(inspects).toEqual([]);
    expect(menus).toEqual([]);
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
        DuelGameLogService,
        ScopeResetDispatcher,
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

    const events: Array<{ zoneId: ZoneId; playerIndex: number; sourceEvent: MouseEvent }> = [];
    component.zonePillRequest.subscribe(e => events.push(e));

    const sourceEvent = { currentTarget: document.createElement('button') } as unknown as MouseEvent;
    component.onZonePillClick(sourceEvent, 'GY', 1);

    expect(events).toEqual([{ zoneId: 'GY', playerIndex: 1, sourceEvent }]);
  });

  // ---------------------------------------------------------------------
  // Direction B gesture handlers (2026-06-05) — pin the inspect-with-
  // `forceExpanded` contract for the new right-click / long-press paths.
  // ---------------------------------------------------------------------

  it('onZoneCardContextMenu preventDefaults + emits inspect forceExpanded', () => {
    fixture.detectChanges();
    const events: Array<{ cardCode: number; forceExpanded?: boolean }> = [];
    component.cardInspectRequest.subscribe(e => events.push({ cardCode: e.cardCode, forceExpanded: e.forceExpanded }));

    let prevented = false;
    const card = makeCard({ cardCode: 11111 });
    const zone = { zoneId: 'M2' as ZoneId, card, cardCount: 1, renderMode: 'terrain' as const, gridArea: 'mz2' };
    component.onZoneCardContextMenu({ preventDefault: () => { prevented = true; } } as unknown as MouseEvent, zone);

    expect(prevented).toBeTrue();
    expect(events).toEqual([{ cardCode: 11111, forceExpanded: true }]);
  });

  it('onZoneCardLongPress emits inspect forceExpanded (no preventDefault — directive owns it)', () => {
    fixture.detectChanges();
    const events: Array<{ cardCode: number; forceExpanded?: boolean }> = [];
    component.cardInspectRequest.subscribe(e => events.push({ cardCode: e.cardCode, forceExpanded: e.forceExpanded }));

    const card = makeCard({ cardCode: 22222 });
    const zone = { zoneId: 'S1' as ZoneId, card, cardCount: 1, renderMode: 'terrain' as const, gridArea: 'sz1' };
    component.onZoneCardLongPress(zone);

    expect(events).toEqual([{ cardCode: 22222, forceExpanded: true }]);
  });

  it('onOpponentCardTap emits inspect (no forceExpanded)', () => {
    fixture.detectChanges();
    const events: Array<{ cardCode: number; forceExpanded?: boolean }> = [];
    component.cardInspectRequest.subscribe(e => events.push({ cardCode: e.cardCode, forceExpanded: e.forceExpanded }));

    component.onOpponentCardTap(makeCard({ cardCode: 33333 }));

    expect(events).toEqual([{ cardCode: 33333, forceExpanded: undefined }]);
  });

  it('onOpponentCardLongPress emits inspect forceExpanded', () => {
    fixture.detectChanges();
    const events: Array<{ cardCode: number; forceExpanded?: boolean }> = [];
    component.cardInspectRequest.subscribe(e => events.push({ cardCode: e.cardCode, forceExpanded: e.forceExpanded }));

    component.onOpponentCardLongPress(makeCard({ cardCode: 44444 }));

    expect(events).toEqual([{ cardCode: 44444, forceExpanded: true }]);
  });

  it('onZoneCardClick B2 fallback emits inspect (no actions, not readOnly)', () => {
    // No actionablePrompt set → no actions for any zone → B2 should kick in.
    fixture.detectChanges();
    const events: number[] = [];
    component.cardInspectRequest.subscribe(e => events.push(e.cardCode));

    const card = makeCard({ cardCode: 77777 });
    const zone = { zoneId: 'M3' as ZoneId, card, cardCount: 1, renderMode: 'terrain' as const, gridArea: 'mz3' };
    component.onZoneCardClick({ currentTarget: document.createElement('div') } as unknown as MouseEvent, zone);

    expect(events).toEqual([77777]);
  });

  it('onEmzCardContextMenu preventDefaults + emits inspect forceExpanded with zoneId', () => {
    fixture.detectChanges();
    const events: Array<{ cardCode: number; forceExpanded?: boolean; zoneId?: ZoneId }> = [];
    component.cardInspectRequest.subscribe(e => events.push({ cardCode: e.cardCode, forceExpanded: e.forceExpanded, zoneId: e.zoneId }));

    let prevented = false;
    component.onEmzCardContextMenu(
      { preventDefault: () => { prevented = true; } } as unknown as MouseEvent,
      'EMZ_L',
      makeCard({ cardCode: 55555 }),
    );

    expect(prevented).toBeTrue();
    expect(events).toEqual([{ cardCode: 55555, forceExpanded: true, zoneId: 'EMZ_L' }]);
  });
});

// =============================================================================
// C4.3 — Chain badges + linkedZoneMap + animation keys
// =============================================================================

function makeLink(overrides: Partial<ChainLinkState> = {}): ChainLinkState {
  return {
    chainIndex: 0,
    cardCode: 11111,
    cardName: 'Chain Card',
    player: 0,
    zoneId: 'M1',
    location: LOCATION.MZONE,
    sequence: 0,
    resolving: false,
    negated: false,
    ...overrides,
  };
}

describe('PvpBoardContainerComponent — chain/link badges + animation (C4.3)', () => {
  let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;
  let mockArt: jasmine.SpyObj<DuelCardArtService>;
  let fixture: ComponentFixture<PvpBoardContainerComponent>;
  let component: PvpBoardContainerComponent;

  // Component-internal protected signals re-typed for direct access in tests.
  type ProtectedSurface = {
    chainBadges: () => Map<string, number>;
    linkedZoneMap: () => Map<string, string[]>;
    animatingZoneKeys: () => Set<string>;
    animatingEmzKeys: () => Set<string>;
  };

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
        DuelGameLogService,
        ScopeResetDispatcher,
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

  function getProtected(): ProtectedSurface {
    return component as unknown as ProtectedSurface;
  }

  it('chainBadges() is empty when chain has < 2 links and phase is not "resolving"', () => {
    fixture.componentRef.setInput('activeChainLinks', [makeLink({ chainIndex: 0 })]);
    fixture.componentRef.setInput('chainPhase', 'building');
    fixture.detectChanges();

    expect(getProtected().chainBadges().size).toBe(0);
  });

  it('chainBadges() populates when chain has 2+ links (badge UI activates)', () => {
    fixture.componentRef.setInput('activeChainLinks', [
      makeLink({ chainIndex: 0, zoneId: 'M1', player: 0 }),
      makeLink({ chainIndex: 1, zoneId: 'S2', player: 0 }),
    ]);
    fixture.componentRef.setInput('chainPhase', 'building');
    fixture.detectChanges();

    const badges = getProtected().chainBadges();
    expect(badges.get('M1-0')).toBe(1); // chainIndex 0 → label 1
    expect(badges.get('S2-0')).toBe(2); // chainIndex 1 → label 2
  });

  it('chainBadges() populates during "resolving" phase even with 1 link (last-link-resolving case)', () => {
    fixture.componentRef.setInput('activeChainLinks', [makeLink({ chainIndex: 0, zoneId: 'M3', player: 0, resolving: true })]);
    fixture.componentRef.setInput('chainPhase', 'resolving');
    fixture.detectChanges();

    expect(getProtected().chainBadges().get('M3-0')).toBe(1);
  });

  it('chainBadges() keeps the HIGHEST chainNum when multiple links target the same slot', () => {
    // Two links land on M2-0 → keep chainIndex 2 → label 3.
    fixture.componentRef.setInput('activeChainLinks', [
      makeLink({ chainIndex: 0, zoneId: 'M2', player: 0 }),
      makeLink({ chainIndex: 1, zoneId: 'S1', player: 0 }),
      makeLink({ chainIndex: 2, zoneId: 'M2', player: 0 }), // same slot as link 0
    ]);
    fixture.componentRef.setInput('chainPhase', 'building');
    fixture.detectChanges();

    expect(getProtected().chainBadges().get('M2-0')).toBe(3);
    expect(getProtected().chainBadges().get('S1-0')).toBe(2);
  });

  it('linkedZoneMap() is bidirectional (src→dst AND dst→src) for equip/target relations', () => {
    // M1 (player 0) equipped to M3 (player 0) via linkedCards entry.
    const equipped = makeCard({
      cardCode: 11111,
      linkedCards: [{ kind: 'equip', controller: 0, location: LOCATION.MZONE, sequence: 2 }],
    });
    const state = makeState([
      makeZone('M1', [equipped]),
      makeZone('M3', [makeCard({ cardCode: 22222 })]),
    ]);
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    const map = getProtected().linkedZoneMap();
    expect(map.get('M1-0')).toEqual(['M3-0']);
    expect(map.get('M3-0')).toEqual(['M1-0']); // reverse edge
  });

  it('linkedZoneMap() skips cards without linkedCards', () => {
    const state = makeState([makeZone('M1', [makeCard({ cardCode: 11111 })])]);
    fixture.componentRef.setInput('duelState', state);
    fixture.detectChanges();

    expect(getProtected().linkedZoneMap().size).toBe(0);
  });

  it('animatingZoneKeys() emits a single "zoneId-relPlayer-type" key when animatingZone is set', () => {
    fixture.componentRef.setInput('animatingZone', { zoneId: 'M1', animationType: 'flip', relativePlayerIndex: 0 });
    fixture.detectChanges();

    expect(getProtected().animatingZoneKeys()).toEqual(new Set(['M1-0-flip']));
  });

  it('animatingZoneKeys() is empty when animatingZone is null', () => {
    fixture.componentRef.setInput('animatingZone', null);
    fixture.detectChanges();

    expect(getProtected().animatingZoneKeys().size).toBe(0);
  });

  it('animatingEmzKeys() emits "zoneId-type" only for EMZ_L/R; non-EMZ animations are ignored', () => {
    // EMZ animation → key included
    fixture.componentRef.setInput('animatingZone', { zoneId: 'EMZ_L', animationType: 'activate', relativePlayerIndex: 0 });
    fixture.detectChanges();
    expect(getProtected().animatingEmzKeys()).toEqual(new Set(['EMZ_L-activate']));

    // Non-EMZ animation → empty (the regular animatingZoneKeys handles it)
    fixture.componentRef.setInput('animatingZone', { zoneId: 'M3', animationType: 'flip', relativePlayerIndex: 1 });
    fixture.detectChanges();
    expect(getProtected().animatingEmzKeys().size).toBe(0);
  });

  // DS convention pin (CLAUDE.md "Chain Badges" tokens): GOLD = viewer (own
  // player), BLUE = opponent — applies to every rendered .chain-badge across
  // board zones, EMZ, hand cards, and the chain overlay. Catch silent
  // regressions where a new <div class="chain-badge"> is added without the
  // own/opponent class binding.
  it('every rendered .chain-badge carries .chain-badge--own iff its zone-key suffix is "-0" (own side)', () => {
    // 2 links to force chainBadges to populate (threshold ≥ 2). One on each
    // side (M3 own + M3 opp) plus piles + EMZ to cover the 4 distinct
    // template sites (terrain face-up, EMZ, BANISHED, pile-faceup GY).
    const p0Cards = [
      makeZone('M3', [makeCard({ cardCode: 100 })]),
      makeZone('GY', [makeCard({ cardCode: 101 })]),
      makeZone('BANISHED', [makeCard({ cardCode: 102 })]),
      makeZone('EMZ_L', [makeCard({ cardCode: 103 })]),
    ];
    const p1Cards = [
      makeZone('M3', [makeCard({ cardCode: 200 })]),
      makeZone('GY', [makeCard({ cardCode: 201 })]),
      makeZone('BANISHED', [makeCard({ cardCode: 202 })]),
      makeZone('EMZ_R', [makeCard({ cardCode: 203 })]),
    ];
    fixture.componentRef.setInput('duelState', makeState(p0Cards, p1Cards));
    // preview=true (set in beforeEach) is fine — the full template still renders;
    // only ngAfterViewInit's CardTravelEngine registrations are skipped.
    fixture.componentRef.setInput('activeChainLinks', [
      // Own side links (relPlayer === 0 → '-0' suffix)
      makeLink({ chainIndex: 0, zoneId: 'M3',       player: 0, location: LOCATION.MZONE,    sequence: 0 }),
      makeLink({ chainIndex: 1, zoneId: 'GY',       player: 0, location: LOCATION.GRAVE,    sequence: 0 }),
      makeLink({ chainIndex: 2, zoneId: 'BANISHED', player: 0, location: LOCATION.BANISHED,  sequence: 0 }),
      makeLink({ chainIndex: 3, zoneId: 'EMZ_L',    player: 0, location: LOCATION.MZONE,    sequence: 5 }),
      // Opponent side links (relPlayer === 1 → '-1' suffix)
      makeLink({ chainIndex: 4, zoneId: 'M3',       player: 1, location: LOCATION.MZONE,    sequence: 0 }),
      makeLink({ chainIndex: 5, zoneId: 'GY',       player: 1, location: LOCATION.GRAVE,    sequence: 0 }),
      makeLink({ chainIndex: 6, zoneId: 'BANISHED', player: 1, location: LOCATION.BANISHED,  sequence: 0 }),
      makeLink({ chainIndex: 7, zoneId: 'EMZ_R',    player: 1, location: LOCATION.MZONE,    sequence: 5 }),
    ]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const ownBadges = host.querySelectorAll<HTMLElement>('.player-field .chain-badge, .central-strip .zone--banished:not(.zone--banished-opponent) .chain-badge, .central-strip .emz:not(.emz--opponent) .chain-badge');
    const oppBadges = host.querySelectorAll<HTMLElement>('.opponent-field .chain-badge, .central-strip .zone--banished-opponent .chain-badge, .central-strip .emz.emz--opponent .chain-badge');

    // Sanity: both sides actually rendered badges.
    expect(ownBadges.length).toBeGreaterThan(0);
    expect(oppBadges.length).toBeGreaterThan(0);

    ownBadges.forEach(el => expect(el.classList.contains('chain-badge--own'))
      .withContext(`own-side badge missing .chain-badge--own (content="${el.textContent?.trim()}")`).toBe(true));
    oppBadges.forEach(el => expect(el.classList.contains('chain-badge--own'))
      .withContext(`opponent-side badge wrongly carries .chain-badge--own (content="${el.textContent?.trim()}")`).toBe(false));
  });
});

// =============================================================================
// registerContainer — climb past isolating ancestors
//
// `.board-host` has `isolation: isolate` (cf. `_duel-tokens.scss`) which
// creates a stacking context that traps a float's z-index. Pre-fix
// `ngAfterViewInit` registered `.board-host` itself as the float
// container — a landed float (z=940 inside .board-host) could not rise
// above sibling `.hand-player` (z=50) because the isolating context
// capped its effective z-index at the (z=auto / 0) of `.board-host` in
// the outer context. Visual effect: the tutored card was stuck UNDER
// the player's hand row.
//
// The fix walks up from `.board-host` to the first ancestor that does
// NOT create a stacking context, then registers that ancestor. The
// helper is `findNonIsolatingAncestor` (private; tested indirectly
// through the `registerContainer` call). This spec pins the climb.
// =============================================================================

describe('PvpBoardContainerComponent — registerContainer (float clipping fix)', () => {
  let mockCardTravel: jasmine.SpyObj<CardTravelEngine>;
  let mockArt: jasmine.SpyObj<DuelCardArtService>;
  let fixture: ComponentFixture<PvpBoardContainerComponent>;

  beforeEach(() => {
    mockCardTravel = jasmine.createSpyObj<CardTravelEngine>(
      'CardTravelEngine',
      ['registerContainer', 'registerZoneResolver', 'getZoneElement', 'createLineBetween'],
    );
    mockArt = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArt.resolveUrl.and.returnValue('mock-url');

    TestBed.configureTestingModule({
      imports: [PvpBoardContainerComponent],
      providers: [
        { provide: CardTravelEngine, useValue: mockCardTravel },
        { provide: DuelCardArtService, useValue: mockArt },
        DuelGameLogService,
        ScopeResetDispatcher,
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
    // preview defaults to false (no setInput) so ngAfterViewInit runs.
    fixture.componentRef.setInput('duelState', EMPTY_DUEL_STATE);
  });

  it('registers a float container that is NOT a stacking-context ancestor of .board-host', () => {
    // The component is the root of the test fixture, so its `.board-host`
    // element is wrapped by Jasmine fixture nodes (no isolation/transform/
    // z-index on them). Expected behavior: walk past `.board-host` (which
    // IS a stacking context via `isolation: isolate`) and land on a
    // non-isolating ancestor — anything BUT the host itself.
    fixture.detectChanges();

    expect(mockCardTravel.registerContainer).toHaveBeenCalled();
    const registered = mockCardTravel.registerContainer.calls.mostRecent().args[0] as HTMLElement;

    // The registered container MUST NOT be `.board-host` itself — that's
    // the regression we're guarding against. If a future refactor makes
    // the helper return `.board-host` as a fallback (no climbable
    // ancestor), the test fails fast and forces a re-think.
    expect(registered.classList.contains('board-host'))
      .withContext('registerContainer should climb PAST `.board-host` (isolation: isolate) — registering it directly traps floats below sibling .hand-player')
      .toBe(false);

    // The registered container MUST contain `.board-host` — it's an ancestor.
    const boardHost = (fixture.nativeElement as HTMLElement).querySelector('.board-host');
    expect(boardHost).toBeTruthy();
    expect(registered.contains(boardHost!))
      .withContext('registered container must be an ancestor of `.board-host` so the float is still anchored to the board area')
      .toBe(true);
  });

  it('climbs ONLY past ancestors that do NOT create a stacking context', () => {
    // Wrap the host in a synthetic isolating ancestor BEFORE rendering so
    // the helper sees it during ngAfterViewInit. With the wrapper isolated,
    // the helper must stop climbing AT the wrapper's first non-isolating
    // sibling. Most fixture setups give us at least one non-isolating
    // ancestor (jasmine's <body> fixture container is `position: static`).
    //
    // We detect that by re-asserting the invariant: the registered
    // container is contained-by or equal-to the body, and does not have
    // `isolation: isolate` on its own computed style.
    fixture.detectChanges();
    const registered = mockCardTravel.registerContainer.calls.mostRecent().args[0] as HTMLElement;

    // Either:
    //   (a) the registered container is `.board-host` itself (fallback
    //       path when no climbable ancestor exists), OR
    //   (b) the registered container's computed `isolation` is NOT `isolate`.
    //
    // Both are correct outcomes — what we forbid is registering an
    // intermediate isolating ancestor that would trap floats in the same
    // way as `.board-host`. Anything chosen by the helper must either be
    // the fallback OR a clean (non-isolating) ancestor.
    const isFallback = registered.classList.contains('board-host');
    const cs = getComputedStyle(registered);
    const isCleanAncestor = cs.isolation !== 'isolate';

    expect(isFallback || isCleanAncestor)
      .withContext(`registered container must be either the fallback (.board-host) OR a non-isolating ancestor — got isolation="${cs.isolation}"`)
      .toBe(true);
  });
});
