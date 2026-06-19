import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FreeModePageComponent } from './free-mode-page.component';
import { FreeModeInteractionService } from './free-mode-interaction.service';
import { BoardStateService } from '../../simulator/board-state.service';
import { CommandStackService } from '../../simulator/command-stack.service';
import { RenderedBoardStateService } from '../duel-page/rendered-board-state.service';
import { CardInstance, ZoneId as SimZoneId } from '../../simulator/simulator.models';
import { POSITION } from '../duel-ws.types';
import { NavbarCollapseService } from '../../../services/navbar-collapse.service';

// =============================================================================
// Free Mode — end-to-end integration. Drives the page with REAL services
// (BoardStateService + CommandStackService + FreeModeInteractionService, no
// mocks for the edit engine) and asserts the rendered PvP payload reflects each
// edit. This is the §10 step-6 integration coverage: the whole chain
// gesture → command → adapter → RBS works together, not just in isolation.
// =============================================================================

let idSeq = 0;
function makeCard(passcode = ++idSeq): CardInstance {
  return {
    instanceId: `ci-${idSeq++}`,
    card: { card: { name: 'C', passcode } } as never,
    image: {} as never,
    faceDown: false,
    position: 'ATK',
  };
}

function pc(card: CardInstance): number {
  return card.card.card.passcode as number;
}

function routeWith(id: string | null): Partial<ActivatedRoute> {
  const map: ParamMap = convertToParamMap(id === null ? {} : { id });
  return { paramMap: of(map) };
}

describe('Free Mode — end-to-end (page + real edit engine)', () => {
  let fixture: ComponentFixture<FreeModePageComponent>;
  let board: BoardStateService;
  let interaction: FreeModeInteractionService;
  let rbs: RenderedBoardStateService;

  function zoneCards(pvpZoneId: string) {
    return rbs.renderedState().players[0].zones.find(z => z.zoneId === pvpZoneId)?.cards ?? [];
  }

  beforeEach(() => {
    // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
    const isMobile = signal(false);
    const mockNavbar = jasmine.createSpyObj<NavbarCollapseService>(
      'NavbarCollapseService', ['setImmersiveMode'],
      { isMobile, isMobilePortrait: isMobile });

    TestBed.configureTestingModule({
      imports: [FreeModePageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: routeWith(null) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: NavbarCollapseService, useValue: mockNavbar },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TranslateService, useValue: {
          currentLang: 'en', instant: (k: string) => k,
          get: () => of({}),
          onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onTranslationChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onDefaultLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
        } },
      ],
    });

    fixture = TestBed.createComponent(FreeModePageComponent);
    fixture.detectChanges();

    board = fixture.debugElement.injector.get(BoardStateService);
    interaction = fixture.debugElement.injector.get(FreeModeInteractionService);
    rbs = fixture.debugElement.injector.get(RenderedBoardStateService);
  });

  function placeHand(...cards: CardInstance[]): void {
    board.boardState.update(prev => ({ ...prev, [SimZoneId.HAND]: cards }));
    fixture.detectChanges();
  }

  it('arm a hand card → pose it on M3 → it renders on the board', () => {
    const a = makeCard();
    placeHand(a);

    interaction.onHandCardTap(0);          // arm
    interaction.onEmptyZoneTap('M3');      // pose
    fixture.detectChanges();

    expect(zoneCards('M3').length).toBe(1);
    expect(zoneCards('M3')[0].cardCode).toBe(pc(a));
    expect(zoneCards('HAND').length).toBe(0);
  });

  it('pose then flip via the mini-bar → the rendered card is face-down', () => {
    const a = makeCard();
    placeHand(a);
    interaction.onHandCardTap(0);
    interaction.onEmptyZoneTap('M1');
    fixture.detectChanges();
    expect(zoneCards('M1')[0].position).toBe(POSITION.FACEUP_ATTACK);

    interaction.flipArmed();
    fixture.detectChanges();

    expect(zoneCards('M1')[0].position).toBe(POSITION.FACEDOWN_ATTACK);
  });

  it('counters increment renders on the board and survives via the adapter', () => {
    const a = makeCard();
    placeHand(a);
    interaction.onHandCardTap(0);
    interaction.onEmptyZoneTap('M1');
    fixture.detectChanges();

    interaction.incrementCounterArmed();
    interaction.incrementCounterArmed();
    fixture.detectChanges();

    expect(zoneCards('M1')[0].counters).toEqual({ counter: 2 });
  });

  it('swap two posed cards via taps exchanges their zones', () => {
    const a = makeCard();
    const b = makeCard();
    board.boardState.update(prev => ({
      ...prev,
      [SimZoneId.MONSTER_1]: [a],
      [SimZoneId.MONSTER_3]: [b],
    }));
    fixture.detectChanges();

    interaction.onCardTap({ cardCode: pc(a), zoneId: 'M1' }); // arm A
    interaction.onCardTap({ cardCode: pc(b), zoneId: 'M3' }); // tap posed B → swap
    fixture.detectChanges();

    expect(zoneCards('M1')[0].cardCode).toBe(pc(b));
    expect(zoneCards('M3')[0].cardCode).toBe(pc(a));
  });

  it('undo reverses the last edit through the real command stack', () => {
    const a = makeCard();
    placeHand(a);
    interaction.onHandCardTap(0);
    interaction.onEmptyZoneTap('M5');
    fixture.detectChanges();
    expect(zoneCards('M5').length).toBe(1);

    fixture.debugElement.injector.get(CommandStackService).undo();
    fixture.detectChanges();

    expect(zoneCards('M5').length).toBe(0);
    expect(zoneCards('HAND').length).toBe(1);
  });

  it('reset clears the board AND the off-stack counters (no phantom counters)', () => {
    const a = makeCard();
    board.boardState.update(prev => ({ ...prev, [SimZoneId.MONSTER_1]: [a] }));
    fixture.detectChanges();
    interaction.onCardTap({ cardCode: pc(a), zoneId: 'M1' });
    interaction.incrementCounterArmed();
    fixture.detectChanges();
    expect(zoneCards('M1')[0].counters).toEqual({ counter: 1 });

    // The page's onDidReset wires resetEditorState → counters cleared.
    fixture.componentInstance.onDidReset();
    fixture.detectChanges();

    expect(interaction.counters().size).toBe(0);
    expect(interaction.armedInstanceId()).toBeNull();
  });
});
