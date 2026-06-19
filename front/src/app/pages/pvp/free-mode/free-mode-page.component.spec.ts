import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { convertToParamMap, ParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FreeModePageComponent } from './free-mode-page.component';
import { DeckBuildService } from '../../../services/deck-build.service';
import { NavbarCollapseService } from '../../../services/navbar-collapse.service';
import { BoardStateService } from '../../simulator/board-state.service';
import { CommandStackService } from '../../simulator/command-stack.service';
import { DuelContext } from '../duel-page/duel-context';
import { RenderedBoardStateService } from '../duel-page/rendered-board-state.service';
import { ZoneId as SimZoneId } from '../../simulator/simulator.models';

// =============================================================================
// FreeModePageComponent — providers (NG0201 gate, CLAUDE.md A6) + bootstrap
//
// A6: every required inject() in a component MUST be exercised through Karma —
// a missing testbed provider surfaces as runtime NG0201, invisible to tsc.
// This spec instantiates the page with its real provider block and asserts:
//   - no NG0201 (all transitive board + edit-engine deps resolve);
//   - bootstrap order (DuelContext configured before any RBS/relativizer read);
//   - the sync effect produces a chainPhase-free, render-valid payload;
//   - chainPhase is never anything but the hard 'idle' the template passes.
// =============================================================================

function makeRouteWithParam(id: string | null): Partial<ActivatedRoute> {
  const map: ParamMap = convertToParamMap(id === null ? {} : { id });
  return { paramMap: of(map) };
}

function makeNavbarMock(): jasmine.SpyObj<NavbarCollapseService> {
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  const isMobile = signal(false);
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  const isMobilePortrait = signal(false);
  return jasmine.createSpyObj<NavbarCollapseService>(
    'NavbarCollapseService', ['setImmersiveMode'], { isMobile, isMobilePortrait });
}

describe('FreeModePageComponent — providers + bootstrap (A6)', () => {
  let fixture: ComponentFixture<FreeModePageComponent>;
  let component: FreeModePageComponent;
  let mockDeckBuild: jasmine.SpyObj<DeckBuildService>;
  let mockNavbar: jasmine.SpyObj<NavbarCollapseService>;
  let mockRouter: jasmine.SpyObj<Router>;

  function configure(route: Partial<ActivatedRoute>): void {
    mockDeckBuild = jasmine.createSpyObj<DeckBuildService>('DeckBuildService', ['getById']);
    mockNavbar = makeNavbarMock();
    mockRouter = jasmine.createSpyObj<Router>('Router', ['navigate']);

    TestBed.configureTestingModule({
      imports: [FreeModePageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: mockRouter },
        { provide: DeckBuildService, useValue: mockDeckBuild },
        { provide: NavbarCollapseService, useValue: mockNavbar },
        provideHttpClient(),
        provideHttpClientTesting(),
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

    fixture = TestBed.createComponent(FreeModePageComponent);
    component = fixture.componentInstance;
  }

  it('instantiates with all providers resolved (no NG0201) when deckId is 0', () => {
    // deckId 0 → the deck-load pipe is filtered out → no getById, no HTTP.
    configure(makeRouteWithParam(null));
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(component).toBeTruthy();
  });

  it('configures DuelContext in the constructor (before any RBS read)', () => {
    configure(makeRouteWithParam(null));
    fixture.detectChanges();

    // Component-scoped provider → read from the component injector, not TestBed root.
    const ctx = fixture.debugElement.injector.get(DuelContext);
    // If configure() had not run, ownPlayerIndex() would fire the duelAssert.
    expect(() => ctx.ownPlayerIndex()).not.toThrow();
    expect(ctx.ownPlayerIndex()).toBe(0);
    expect(ctx.isBoardActive()).toBe(true);
    expect(ctx.speedMultiplier()).toBe(1);
  });

  it('provides BoardStateService + CommandStackService (edit engine resolves)', () => {
    configure(makeRouteWithParam(null));
    fixture.detectChanges();
    expect(fixture.debugElement.injector.get(BoardStateService)).toBeTruthy();
    expect(fixture.debugElement.injector.get(CommandStackService)).toBeTruthy();
  });

  it('the sync effect drives RBS.renderedState with a chainPhase-free payload', () => {
    configure(makeRouteWithParam(null));
    fixture.detectChanges();

    const rbs = fixture.debugElement.injector.get(RenderedBoardStateService);
    const state = rbs.renderedState();
    // Adapter contract: fixed metadata, 2 players, no chainPhase field.
    expect(state.turnPlayer).toBe(0);
    expect(state.turnCount).toBe(1);
    expect(state.phase).toBe('MAIN1');
    expect(state.players.length).toBe(2);
    expect('chainPhase' in state).toBe(false);
    expect(state.players[0].lp).toBe(8000);
  });

  it('re-syncs the render payload when the edit model mutates', () => {
    configure(makeRouteWithParam(null));
    fixture.detectChanges();

    const boardState = fixture.debugElement.injector.get(BoardStateService);
    const rbs = fixture.debugElement.injector.get(RenderedBoardStateService);

    // Mutate the sim board directly (a command would do this in prod).
    boardState.boardState.update(prev => ({
      ...prev,
      [SimZoneId.MAIN_DECK]: [
        { instanceId: 'x', card: { card: { passcode: 1 } } as never, image: {} as never, faceDown: false, position: 'ATK' },
      ],
    }));
    fixture.detectChanges();

    expect(rbs.renderedState().players[0].deckCount).toBe(1);
  });

  it('enables immersive mode on construct and restores it on destroy', () => {
    configure(makeRouteWithParam(null));
    fixture.detectChanges();
    expect(mockNavbar.setImmersiveMode).toHaveBeenCalledWith(true);

    fixture.destroy();
    expect(mockNavbar.setImmersiveMode).toHaveBeenCalledWith(false);
  });

  it('marks EVERY hand card actionable so a tap fires handCardAction (arm), not inspect', () => {
    // Regression (review): with actionableCardIndices unbound (empty), the hand
    // row routes every tap to cardInspectRequest (inspect) — the tap-to-arm flow
    // is dead. handActionableIndices must cover all hand indices.
    configure(makeRouteWithParam(null));
    fixture.detectChanges();

    const boardState = fixture.debugElement.injector.get(BoardStateService);
    boardState.boardState.update(prev => ({
      ...prev,
      [SimZoneId.HAND]: [
        { instanceId: 'h0', card: { card: { passcode: 1 } } as never, image: {} as never, faceDown: false, position: 'ATK' },
        { instanceId: 'h1', card: { card: { passcode: 2 } } as never, image: {} as never, faceDown: false, position: 'ATK' },
        { instanceId: 'h2', card: { card: { passcode: 3 } } as never, image: {} as never, faceDown: false, position: 'ATK' },
      ],
    }));
    fixture.detectChanges();

    const indices = (component as unknown as { handActionableIndices: () => Set<number> }).handActionableIndices();
    expect(indices).toEqual(new Set([0, 1, 2]));
  });

  it('loads the deck into BoardStateService when a valid deckId is present', () => {
    const deck = {
      mainDeck: [], extraDeck: [],
    } as unknown as Parameters<BoardStateService['initializeBoard']>[0];
    mockDeckBuild = jasmine.createSpyObj<DeckBuildService>('DeckBuildService', ['getById']);
    mockDeckBuild.getById.and.returnValue(of(deck));
    mockNavbar = makeNavbarMock();
    mockRouter = jasmine.createSpyObj<Router>('Router', ['navigate']);

    TestBed.configureTestingModule({
      imports: [FreeModePageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: makeRouteWithParam('42') },
        { provide: Router, useValue: mockRouter },
        { provide: DeckBuildService, useValue: mockDeckBuild },
        { provide: NavbarCollapseService, useValue: mockNavbar },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TranslateService, useValue: {
          currentLang: 'en', instant: (k: string) => k,
          get: (k: string) => ({ subscribe: (fn: (v: string) => void) => fn(k) }),
          onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onTranslationChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onDefaultLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
        } },
      ],
    });

    const fix = TestBed.createComponent(FreeModePageComponent);
    fix.detectChanges();

    expect(mockDeckBuild.getById).toHaveBeenCalledWith(42);
  });

  it('navigates to /decks when the deck load fails', () => {
    mockDeckBuild = jasmine.createSpyObj<DeckBuildService>('DeckBuildService', ['getById']);
    mockDeckBuild.getById.and.returnValue(throwError(() => new Error('boom')));
    mockNavbar = makeNavbarMock();
    mockRouter = jasmine.createSpyObj<Router>('Router', ['navigate']);

    TestBed.configureTestingModule({
      imports: [FreeModePageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: makeRouteWithParam('7') },
        { provide: Router, useValue: mockRouter },
        { provide: DeckBuildService, useValue: mockDeckBuild },
        { provide: NavbarCollapseService, useValue: mockNavbar },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TranslateService, useValue: {
          currentLang: 'en', instant: (k: string) => k,
          get: (k: string) => ({ subscribe: (fn: (v: string) => void) => fn(k) }),
          onLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onTranslationChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
          onDefaultLangChange: { subscribe: () => ({ unsubscribe: () => undefined }) },
        } },
      ],
    });

    const fix = TestBed.createComponent(FreeModePageComponent);
    fix.detectChanges();

    expect(mockDeckBuild.getById).toHaveBeenCalledWith(7);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/decks']);
  });
});
