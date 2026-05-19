/**
 * Spec for ReplayPageComponent — root coordinator of the replay viewer.
 *
 * Strategy: like duel-page (C1) and deck-builder (C10), the component
 * instantiates ~25 component-scoped services with effects + WS lifecycle.
 * We:
 *
 *  1. Stub `ReplayConnectionService`, `ReplayTransportService`,
 *     `ReplayDuelAdapter`, `ReplayForkService`, `PhaseAnnouncementService`
 *     with signal-driven surfaces.
 *  2. Replace every other collaborator via `overrideComponent` with a
 *     no-op stub.
 *  3. Override the template to `''`.
 *  4. Stub `localStorage` per test (perspective + animations + promptMode
 *     prefs are persisted there).
 *
 * The pinned surface is the component's own logic — turn segmentation,
 * perspective swaps, keyboard dispatch, toggle persistence, zone-browser
 * concurrency guard. Things a future refactor would silently break.
 */

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { ReplayPageComponent } from './replay-page.component';
import { ReplayConnectionService } from './replay-connection.service';
import { ReplayForkService } from './replay-fork.service';
import { ReplayDuelAdapter } from './replay-duel-adapter';
import { ReplayTransportService } from './replay-transport.service';
import { CardDataCacheService } from '../duel-page/card-data-cache.service';
import { CardInspectionService } from '../duel-page/card-inspection.service';
import { CardTravelEngine } from '../duel-page/card-travel-engine.service';
import { BoardEffectsService } from '../duel-page/board-effects.service';
import { FloatRegistryService } from '../duel-page/float-registry.service';
import { DuelCardArtService } from '../duel-page/duel-card-art.service';
import { DebugLogService } from '../duel-page/debug-log.service';
import { DuelDebugService } from '../duel-page/duel-debug.service';
import { DuelWebSocketService } from '../duel-page/duel-web-socket.service';
import { AnimationOrchestratorService } from '../duel-page/animation-orchestrator.service';
import { PhaseAnnouncementService } from '../duel-page/phase-announcement.service';
import { DuelToastService } from '../duel-page/duel-toast.service';
import { DuelContext } from '../duel-page/duel-context';
import { DuelLogger } from '../duel-page/duel-logger';
import { LpAnimationTracker } from '../duel-page/lp-animation-tracker';
import { BattleAnimationTracker } from '../duel-page/battle-animation-tracker';
import { ChainResolutionManager } from '../duel-page/chain-resolution-manager';
import { DrawSequenceManager } from '../duel-page/draw-sequence-manager';
import { MoveAnimationRouter } from '../duel-page/move-animation-router';
import { TargetIndicatorManager } from '../duel-page/target-indicator-manager';
import { BufferReplayBuilder } from '../duel-page/buffer-replay-builder';
import { ANIMATION_DATA_SOURCE } from '../duel-page/animation-data-source';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';

import { EMPTY_DUEL_STATE } from '../types';
import type { DuelState } from '../types';
import type { BoardStatePayload, PlayerBoardState, BoardZone, CardOnField, ZoneId } from '../duel-ws.types';
import type { PreComputedState } from '../duel-ws-replay.types';

// =============================================================================
// Stubs
// =============================================================================

class StubReplayConnection {
  readonly connectionStatus = signal<'connecting' | 'connected' | 'disconnected'>('disconnected');
  readonly metadata = signal<unknown>(null);
  readonly boardStates = signal<PreComputedState[]>([]);
  readonly computedUpTo = signal<number>(-1);
  readonly totalResponses = signal(0);
  readonly error = signal<string | null>(null);
  readonly lastReceivedTurn = signal<number>(-1);
  readonly forkStatus = signal<'idle' | 'forking' | 'ready' | 'warning' | 'error'>('idle');
  readonly forkTokens = signal<unknown>(null);
  readonly forkWarning = signal<string | null>(null);
  readonly protocolMismatch = signal(false);
  connect = jasmine.createSpy('connect');
  disconnect = jasmine.createSpy('disconnect');
}

class StubReplayTransport {
  readonly currentIndex = signal<number>(0);
  readonly isPlaying = signal(false);
  readonly pausedAtBoundary = signal(false);
  configure = jasmine.createSpy('configure');
  destroy = jasmine.createSpy('destroy');
  seek = jasmine.createSpy('seek');
  scrub = jasmine.createSpy('scrub');
  stepForward = jasmine.createSpy('stepForward');
  stepBack = jasmine.createSpy('stepBack');
  togglePlay = jasmine.createSpy('togglePlay');
  skipStart = jasmine.createSpy('skipStart');
  skipEnd = jasmine.createSpy('skipEnd');
  seekToTurn = jasmine.createSpy('seekToTurn');
  haltPlaybackTimer = jasmine.createSpy('haltPlaybackTimer');
  restart = jasmine.createSpy('restart');
  maybeAdvance = jasmine.createSpy('maybeAdvance');
  resumeIfBoundaryWaiting = jasmine.createSpy('resumeIfBoundaryWaiting');
}

class StubReplayDuelAdapter {
  readonly perspectiveIndex = signal<0 | 1>(0);
  readonly busy = signal(false);
  readonly activePrompt = signal<unknown>(null);
  readonly activeResponse = signal<unknown>(null);
  readonly animationQueue = signal<readonly unknown[]>([]);
  readonly activeChainLinks = signal<readonly unknown[]>([]);
  readonly chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  private readonly _rendered = signal<DuelState>(structuredClone(EMPTY_DUEL_STATE));
  setRendered(s: DuelState): void { this._rendered.set(s); }
  readonly boardStateView = {
    renderedState: this._rendered.asReadonly(),
    logicalState: this._rendered.asReadonly(),
    hasLockedZones: signal(false).asReadonly(),
  };
  jumpToState = jasmine.createSpy('jumpToState');
  abort = jasmine.createSpy('abort');
  collapseRemainingSteps = jasmine.createSpy('collapseRemainingSteps');
}

class StubReplayFork {
  readonly forkEventIndex = signal<number | null>(null);
  readonly cachedBoardStates = signal<PreComputedState[]>([]);
  readonly forking = signal(false);
  fork = jasmine.createSpy('fork');
  cleanup = jasmine.createSpy('cleanup');
}

class StubPhaseAnnouncement {
  readonly announcement = signal<unknown>(null);
  readonly displayedPhase = signal<unknown>(null);
  readonly displayedTurnPlayer = signal<unknown>(null);
  readonly displayedTurnCount = signal<unknown>(null);
  phaseDisplayName = (phase: string): string => `phase:${phase}`;
  show = jasmine.createSpy('show');
  clear = jasmine.createSpy('clear');
}

class StubAnimationOrchestrator {
  readonly isAnimating = signal(false);
  readonly animatingZone = signal<unknown>(null);
  readonly confirmRevealedCards = signal<Map<number, number>>(new Map());
  readonly lpTracker = { animatingLpPlayer: signal<number | null>(null) };
  destroy = jasmine.createSpy('destroy');
  resetForSwitch = jasmine.createSpy('resetForSwitch');
  startProcessingIfIdle = jasmine.createSpy('startProcessingIfIdle');
  onStateSync = jasmine.createSpy('onStateSync');
}

class StubChainResolutionManager {
  readonly chainEntryAnimating = signal(false);
  readonly chainPromptGateActive = signal(false);
  readonly chainSolvedCount = signal(0);
  readonly isResolving = signal(false);
  readonly hasActiveReplayTimeouts = signal(false);
}

class StubCardInspection {
  readonly inspectedCard = signal<unknown>(null);
  readonly inspectorForceExpanded = signal(false);
  init = jasmine.createSpy('init');
  inspectByCode = jasmine.createSpy('inspectByCode').and.resolveTo();
  showUnknownCard = jasmine.createSpy('showUnknownCard');
  close = jasmine.createSpy('close');
}

class StubCardTravelEngine {
  registerContainer = jasmine.createSpy('registerContainer');
  registerZoneResolver = jasmine.createSpy('registerZoneResolver');
}

class StubAuthService {
  user = signal<{ id: string; pseudo?: string } | null>({ id: 'user-1', pseudo: 'AxelTest' });
}

class StubNotification {
  error = jasmine.createSpy('error');
  success = jasmine.createSpy('success');
}

class StubRouter {
  navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
}

class StubDuelContext {
  configure = jasmine.createSpy('configure');
  reducedMotion = signal(false);
  ownPlayerIndex = (): number => 0;
  speedMultiplier = (): number => 1;
  isBoardActive = (): boolean => true;
  relativePlayer = (): 0 | 1 => 0;
  scaledDuration = (b: number): number => b;
  safetyTimeout = (b: number): number => b;
  announceEvent = jasmine.createSpy('announceEvent');
}

class StubTranslate {
  currentLang = 'en';
  // The component reads `instant` for label composition — return distinct
  // strings for the three keys so positionLabel can be asserted later.
  instant = (key: string, params?: Record<string, unknown>): string => {
    if (params) return `${key}(${JSON.stringify(params)})`;
    return key;
  };
  get = (key: string): { subscribe: (fn: (v: string) => void) => void } => ({ subscribe: fn => fn(key) });
  onLangChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
  onTranslationChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
  onDefaultLangChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
}

// =============================================================================
// Fixtures
// =============================================================================

function makePlayer(lp: number, zones: BoardZone[] = []): PlayerBoardState {
  return { lp, deckCount: 0, extraCount: 0, zones };
}

function makeBoardState(turnCount: number, turnPlayer: 0 | 1 = 0, p0Zones: BoardZone[] = [], p1Zones: BoardZone[] = []): BoardStatePayload {
  return {
    turnPlayer, turnCount, phase: 'DRAW',
    players: [makePlayer(8000, p0Zones), makePlayer(8000, p1Zones)],
  };
}

function makeDuelState(turnCount: number, turnPlayer: 0 | 1 = 0, p0Zones: BoardZone[] = [], p1Zones: BoardZone[] = []): DuelState {
  return {
    turnPlayer, turnCount, phase: 'DRAW',
    players: [makePlayer(8000, p0Zones), makePlayer(8000, p1Zones)],
  };
}

function makePrecomputed(turnCount: number, label = 'evt', overrides: Partial<PreComputedState> = {}): PreComputedState {
  return {
    boardState: makeBoardState(turnCount),
    events: [],
    label,
    responseCount: 0,
    ...overrides,
  };
}

function makeRouteStub(replayId: string | null = 'replay-42'): ActivatedRoute {
  const paramMap = convertToParamMap(replayId ? { replayId } : {});
  const queryParamMap = convertToParamMap({});
  return {
    snapshot: { paramMap, queryParamMap },
    paramMap: of(paramMap),
  } as unknown as ActivatedRoute;
}

function setupTestBed(): void {
  TestBed.configureTestingModule({
    imports: [ReplayPageComponent],
    providers: [
      { provide: ActivatedRoute, useValue: makeRouteStub() },
      { provide: Router, useClass: StubRouter },
      { provide: TranslateService, useClass: StubTranslate },
      { provide: AuthService, useClass: StubAuthService },
      { provide: NotificationService, useClass: StubNotification },
    ],
  });

  TestBed.overrideComponent(ReplayPageComponent, {
    set: {
      template: '',
      providers: [
        { provide: ReplayConnectionService, useClass: StubReplayConnection },
        { provide: ReplayForkService, useClass: StubReplayFork },
        { provide: ReplayTransportService, useClass: StubReplayTransport },
        { provide: ReplayDuelAdapter, useClass: StubReplayDuelAdapter },
        { provide: CardDataCacheService, useValue: { clearCache: () => undefined } },
        { provide: CardInspectionService, useClass: StubCardInspection },
        { provide: CardTravelEngine, useClass: StubCardTravelEngine },
        { provide: BoardEffectsService, useValue: {} },
        { provide: FloatRegistryService, useValue: {} },
        { provide: DuelCardArtService, useValue: { resolveUrl: () => '', setArtMap: () => undefined, prefetchCard: () => undefined } },
        { provide: DuelLogger, useValue: { log: () => undefined, warn: () => undefined, setTraceId: () => undefined } },
        { provide: LpAnimationTracker, useValue: { animatingLpPlayer: signal<number | null>(null) } },
        { provide: BattleAnimationTracker, useValue: {} },
        { provide: DuelContext, useClass: StubDuelContext },
        { provide: ChainResolutionManager, useClass: StubChainResolutionManager },
        { provide: DrawSequenceManager, useValue: {} },
        { provide: MoveAnimationRouter, useValue: {} },
        { provide: BufferReplayBuilder, useValue: {} },
        { provide: TargetIndicatorManager, useValue: {} },
        { provide: AnimationOrchestratorService, useClass: StubAnimationOrchestrator },
        { provide: PhaseAnnouncementService, useClass: StubPhaseAnnouncement },
        { provide: DuelToastService, useValue: {} },
        { provide: DebugLogService, useValue: { logServerMessage: () => undefined, logPlayerResponse: () => undefined } },
        {
          provide: DuelDebugService,
          useValue: {
            bindToWindow: () => undefined,
            unbindFromWindow: () => undefined,
            preActivationBufferAccessor: null as unknown,
          },
        },
        { provide: DuelWebSocketService, useValue: {} },
        { provide: ANIMATION_DATA_SOURCE, useExisting: ReplayDuelAdapter },
      ],
    },
  });
}

function connOf(fixture: ComponentFixture<ReplayPageComponent>): StubReplayConnection {
  return fixture.componentRef.injector.get(ReplayConnectionService) as unknown as StubReplayConnection;
}
function adapterOf(fixture: ComponentFixture<ReplayPageComponent>): StubReplayDuelAdapter {
  return fixture.componentRef.injector.get(ReplayDuelAdapter) as unknown as StubReplayDuelAdapter;
}
function transportOf(fixture: ComponentFixture<ReplayPageComponent>): StubReplayTransport {
  return fixture.componentRef.injector.get(ReplayTransportService) as unknown as StubReplayTransport;
}
function forkOf(fixture: ComponentFixture<ReplayPageComponent>): StubReplayFork {
  return fixture.componentRef.injector.get(ReplayForkService) as unknown as StubReplayFork;
}

// localStorage shim — Karma runs in a real browser, so localStorage exists.
// We clear it per-test to keep each spec independent and predictable.
function clearReplayPrefs(): void {
  localStorage.removeItem('replay.animationsEnabled');
  localStorage.removeItem('replay.promptMode');
  localStorage.removeItem('replay.perspectiveIndex');
}

// =============================================================================
// turns + atEnd + boardStates fallback
// =============================================================================

describe('ReplayPageComponent — turns + boardStates fallback', () => {
  let fixture: ComponentFixture<ReplayPageComponent>;
  let component: ReplayPageComponent;
  let conn: StubReplayConnection;
  let fork: StubReplayFork;

  beforeEach(() => {
    clearReplayPrefs();
    setupTestBed();
    fixture = TestBed.createComponent(ReplayPageComponent);
    component = fixture.componentInstance;
    conn = connOf(fixture);
    fork = forkOf(fixture);
  });

  it('boardStates() falls back to fork.cachedBoardStates when live is empty', () => {
    // Live empty, fork cached has 2 states — the component must read
    // through the cached pool so the post-fork viewer keeps rendering.
    fork.cachedBoardStates.set([makePrecomputed(1), makePrecomputed(2)]);
    expect(component.boardStates().length).toBe(2);

    // Then live arrives — it takes priority.
    conn.boardStates.set([makePrecomputed(1)]);
    expect(component.boardStates().length).toBe(1);
  });

  it('turns() returns [] for empty boardStates', () => {
    expect(component.turns()).toEqual([]);
  });

  it('turns() segments by turnCount and emits one TurnMeta per turn', () => {
    // 5 events: 2 in turn 1, 3 in turn 2 — expect 2 TurnMeta entries with
    // correct startIndex/endIndex/eventCount.
    conn.boardStates.set([
      makePrecomputed(1, 'a'), makePrecomputed(1, 'b'),
      makePrecomputed(2, 'c'), makePrecomputed(2, 'd'), makePrecomputed(2, 'e'),
    ]);
    const turns = component.turns();
    expect(turns.length).toBe(2);
    expect(turns[0]).toEqual(jasmine.objectContaining({ turnNumber: 1, startIndex: 0, endIndex: 1, eventCount: 2 }));
    expect(turns[1]).toEqual(jasmine.objectContaining({ turnNumber: 2, startIndex: 2, endIndex: 4, eventCount: 3 }));
  });

  it('turns() reads p1LP / p2LP from the FIRST state of each turn', () => {
    // The "Setup" turn (turnCount 0) shows starting LP. Then turn 1 starts
    // after one player paid — first state of turn 1 carries the new LP.
    const setup = makePrecomputed(0);
    setup.boardState.players = [makePlayer(8000), makePlayer(8000)];
    const turn1Start = makePrecomputed(1);
    turn1Start.boardState.players = [makePlayer(7000), makePlayer(8000)];
    const turn1End = makePrecomputed(1);
    turn1End.boardState.players = [makePlayer(6000), makePlayer(8000)];
    conn.boardStates.set([setup, turn1Start, turn1End]);
    const turns = component.turns();
    expect(turns[0]).toEqual(jasmine.objectContaining({ turnNumber: 0, p1LP: 8000, p2LP: 8000 }));
    // p1LP must be 7000 (first state of turn 1), NOT 6000 (last) — a
    // refactor that read endIndex would silently flip this.
    expect(turns[1]).toEqual(jasmine.objectContaining({ turnNumber: 1, p1LP: 7000, p2LP: 8000 }));
  });

  it('atEnd() is false until computedUpTo > 0 even when currentIndex >= upTo', () => {
    // Pre-data state: upTo=-1, currentIndex=0. The guard `upTo > 0`
    // prevents flagging "end of replay" before any state arrives.
    conn.computedUpTo.set(-1);
    expect(component.atEnd()).toBe(false);

    conn.computedUpTo.set(5);
    transportOf(fixture).currentIndex.set(5);
    expect(component.atEnd()).toBe(true);

    transportOf(fixture).currentIndex.set(4);
    expect(component.atEnd()).toBe(false);
  });

  it('totalEvents() returns boardStates length', () => {
    expect(component.totalEvents()).toBe(0);
    conn.boardStates.set([makePrecomputed(1), makePrecomputed(1)]);
    expect(component.totalEvents()).toBe(2);
  });
});

// =============================================================================
// perspective swaps
// =============================================================================

describe('ReplayPageComponent — perspective swaps', () => {
  let fixture: ComponentFixture<ReplayPageComponent>;
  let component: ReplayPageComponent;
  let conn: StubReplayConnection;
  let transport: StubReplayTransport;

  beforeEach(() => {
    clearReplayPrefs();
    setupTestBed();
    fixture = TestBed.createComponent(ReplayPageComponent);
    component = fixture.componentInstance;
    conn = connOf(fixture);
    transport = transportOf(fixture);
  });

  it('replayDisplayedTurnPlayer swaps when perspective=1', () => {
    // currentState's turnPlayer=0 means "the actual ocgcore player 0 is
    // taking their turn". From perspective=1's viewpoint (we're player 1),
    // that translates to "opponent's turn" → 1.
    conn.boardStates.set([makePrecomputed(1, 'evt', { boardState: makeBoardState(1, /*turnPlayer*/ 0) })]);
    transport.currentIndex.set(0);

    component.perspectiveIndex.set(0);
    expect(component.replayDisplayedTurnPlayer()).toBe(0);

    component.perspectiveIndex.set(1);
    expect(component.replayDisplayedTurnPlayer()).toBe(1);
  });

  it('replayDisplayedTurnPlayer is null when no current state', () => {
    expect(component.replayDisplayedTurnPlayer()).toBeNull();
  });
});

// =============================================================================
// keyboard handler
// =============================================================================

describe('ReplayPageComponent — onKeydown dispatch', () => {
  let fixture: ComponentFixture<ReplayPageComponent>;
  let component: ReplayPageComponent;
  let transport: StubReplayTransport;

  beforeEach(() => {
    clearReplayPrefs();
    setupTestBed();
    fixture = TestBed.createComponent(ReplayPageComponent);
    component = fixture.componentInstance;
    transport = transportOf(fixture);
  });

  function press(key: string, target?: EventTarget): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    if (target) Object.defineProperty(event, 'target', { value: target });
    component.onKeydown(event);
    return event;
  }

  it('ArrowRight → stepForward (delegated to transport)', () => {
    press('ArrowRight', document.body);
    expect(transport.stepForward).toHaveBeenCalled();
  });

  it('ArrowLeft → stepBack (with abortAndClean)', () => {
    press('ArrowLeft', document.body);
    expect(transport.stepBack).toHaveBeenCalled();
  });

  it('Space → togglePlay AND preventDefault (avoid page scroll)', () => {
    const event = press(' ', document.body);
    expect(transport.togglePlay).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Home → skipStart, End → skipEnd', () => {
    press('Home', document.body);
    expect(transport.skipStart).toHaveBeenCalled();

    press('End', document.body);
    expect(transport.skipEnd).toHaveBeenCalled();
  });

  it('typing in INPUT does NOT dispatch — guard on TARGET tag', () => {
    const input = document.createElement('input');
    press('ArrowRight', input);
    expect(transport.stepForward).not.toHaveBeenCalled();
  });

  it('typing in TEXTAREA does NOT dispatch', () => {
    const textarea = document.createElement('textarea');
    press(' ', textarea);
    expect(transport.togglePlay).not.toHaveBeenCalled();
  });

  it('contentEditable target does NOT dispatch', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    press('ArrowRight', div);
    expect(transport.stepForward).not.toHaveBeenCalled();
  });

  it('G toggles logDetail (normal ↔ debug)', () => {
    const initial = component.logDetail();
    press('g', document.body);
    expect(component.logDetail()).not.toBe(initial);
    press('G', document.body);
    expect(component.logDetail()).toBe(initial);
  });

  it('D toggles debugPanelOpen', () => {
    expect(component.debugPanelOpen()).toBe(false);
    press('d', document.body);
    expect(component.debugPanelOpen()).toBe(true);
    press('D', document.body);
    expect(component.debugPanelOpen()).toBe(false);
  });

  it('unmapped key is a no-op', () => {
    press('q', document.body);
    expect(transport.stepForward).not.toHaveBeenCalled();
    expect(transport.togglePlay).not.toHaveBeenCalled();
  });
});

// =============================================================================
// toggle handlers (perspective / promptMode / animations)
// =============================================================================

describe('ReplayPageComponent — toggle handlers', () => {
  let fixture: ComponentFixture<ReplayPageComponent>;
  let component: ReplayPageComponent;
  let conn: StubReplayConnection;
  let adapter: StubReplayDuelAdapter;
  let transport: StubReplayTransport;

  beforeEach(() => {
    clearReplayPrefs();
    setupTestBed();
    fixture = TestBed.createComponent(ReplayPageComponent);
    component = fixture.componentInstance;
    conn = connOf(fixture);
    adapter = adapterOf(fixture);
    transport = transportOf(fixture);
  });

  it('onTogglePerspective flips the index, persists to localStorage, and jumps to current state', () => {
    const state = makePrecomputed(1);
    conn.boardStates.set([state]);
    transport.currentIndex.set(0);

    expect(component.perspectiveIndex()).toBe(0);
    component.onTogglePerspective();
    expect(component.perspectiveIndex()).toBe(1);
    expect(localStorage.getItem('replay.perspectiveIndex')).toBe('1');
    expect(adapter.perspectiveIndex()).toBe(1);
    expect(adapter.jumpToState).toHaveBeenCalledWith(state);
    expect(transport.haltPlaybackTimer).toHaveBeenCalled();
  });

  it('onTogglePromptMode flips and persists; collapses remaining steps when result+activePrompt', () => {
    expect(component.promptMode()).toBe('decision');
    adapter.activePrompt.set({ type: 'SELECT_PLACE' });

    component.onTogglePromptMode();
    expect(component.promptMode()).toBe('result');
    expect(localStorage.getItem('replay.promptMode')).toBe('result');
    expect(adapter.collapseRemainingSteps).toHaveBeenCalled();

    // Toggle back: no collapse (mode is decision again, no prompt anyway).
    adapter.collapseRemainingSteps.calls.reset();
    component.onTogglePromptMode();
    expect(component.promptMode()).toBe('decision');
    expect(adapter.collapseRemainingSteps).not.toHaveBeenCalled();
  });

  it('onTogglePromptMode does NOT collapse when toggling to result with no active prompt', () => {
    adapter.activePrompt.set(null);
    component.onTogglePromptMode();
    expect(component.promptMode()).toBe('result');
    expect(adapter.collapseRemainingSteps).not.toHaveBeenCalled();
  });

  it('onToggleAnimations flips, persists, jumpToState, and restarts only when isPlaying', () => {
    const state = makePrecomputed(1);
    conn.boardStates.set([state]);
    transport.currentIndex.set(0);

    expect(component.animationsEnabled()).toBe(false);

    // Not playing: no restart.
    component.onToggleAnimations();
    expect(component.animationsEnabled()).toBe(true);
    expect(localStorage.getItem('replay.animationsEnabled')).toBe('true');
    expect(adapter.jumpToState).toHaveBeenCalledWith(state);
    expect(transport.restart).not.toHaveBeenCalled();

    // Playing: restart fires.
    transport.isPlaying.set(true);
    adapter.jumpToState.calls.reset();
    component.onToggleAnimations();
    expect(component.animationsEnabled()).toBe(false);
    expect(transport.restart).toHaveBeenCalled();
  });
});

// =============================================================================
// zone browser concurrency guard
// =============================================================================

describe('ReplayPageComponent — zone browser', () => {
  let fixture: ComponentFixture<ReplayPageComponent>;
  let component: ReplayPageComponent;
  let adapter: StubReplayDuelAdapter;

  beforeEach(() => {
    clearReplayPrefs();
    setupTestBed();
    fixture = TestBed.createComponent(ReplayPageComponent);
    component = fixture.componentInstance;
    adapter = adapterOf(fixture);
  });

  function makeZoneCard(cardCode: number): CardOnField {
    return { cardCode, name: 'C', position: 0, overlayMaterials: [], counters: {} } as unknown as CardOnField;
  }

  it('onZonePillRequest opens the browser with the requested zoneId + cards', () => {
    adapter.setRendered(makeDuelState(1, 0, [{ zoneId: 'GY', cards: [makeZoneCard(1), makeZoneCard(2)] } as BoardZone]));
    component.onZonePillRequest({ zoneId: 'GY' as ZoneId, playerIndex: 0 });
    const state = component.zoneBrowserState();
    expect(state).toBeTruthy();
    expect(state?.zoneId).toBe('GY');
    expect(state?.playerIndex).toBe(0);
    expect(state?.cards.length).toBe(2);
  });

  it('onZonePillRequest assigns a monotonic openId per call', () => {
    adapter.setRendered(makeDuelState(1, 0, [{ zoneId: 'GY', cards: [] } as BoardZone]));
    component.onZonePillRequest({ zoneId: 'GY' as ZoneId, playerIndex: 0 });
    const id1 = component.zoneBrowserState()?.openId;
    component.onZonePillRequest({ zoneId: 'GY' as ZoneId, playerIndex: 0 });
    const id2 = component.zoneBrowserState()?.openId;
    expect(id2).toBeGreaterThan(id1!);
  });

  it('closeZoneBrowser with stale openId is ignored — concurrency guard', () => {
    // Open #1, then open #2. A late close arriving for #1 must NOT close
    // the now-active #2.
    adapter.setRendered(makeDuelState(1, 0, [{ zoneId: 'GY', cards: [] } as BoardZone]));
    component.onZonePillRequest({ zoneId: 'GY' as ZoneId, playerIndex: 0 });
    const staleId = component.zoneBrowserState()!.openId;
    component.onZonePillRequest({ zoneId: 'GY' as ZoneId, playerIndex: 0 });
    component.closeZoneBrowser(staleId);
    expect(component.zoneBrowserState()).not.toBeNull();
  });

  it('closeZoneBrowser with current openId closes the browser', () => {
    adapter.setRendered(makeDuelState(1, 0, [{ zoneId: 'GY', cards: [] } as BoardZone]));
    component.onZonePillRequest({ zoneId: 'GY' as ZoneId, playerIndex: 0 });
    const currentId = component.zoneBrowserState()!.openId;
    component.closeZoneBrowser(currentId);
    expect(component.zoneBrowserState()).toBeNull();
  });

  it('closeZoneBrowser without openId argument always closes (legacy behavior)', () => {
    adapter.setRendered(makeDuelState(1, 0, [{ zoneId: 'GY', cards: [] } as BoardZone]));
    component.onZonePillRequest({ zoneId: 'GY' as ZoneId, playerIndex: 0 });
    component.closeZoneBrowser();
    expect(component.zoneBrowserState()).toBeNull();
  });

  it('onZonePillRequest is a no-op when the player slot is missing', () => {
    // Edge: state.players[5] is undefined — must NOT throw, must NOT open.
    adapter.setRendered(makeDuelState(1));
    component.onZonePillRequest({ zoneId: 'GY' as ZoneId, playerIndex: 5 });
    expect(component.zoneBrowserState()).toBeNull();
  });
});

// =============================================================================
// hand getters (playerHand / opponentHand)
// =============================================================================

describe('ReplayPageComponent — hand getters', () => {
  let fixture: ComponentFixture<ReplayPageComponent>;
  let component: ReplayPageComponent;
  let adapter: StubReplayDuelAdapter;

  beforeEach(() => {
    clearReplayPrefs();
    setupTestBed();
    fixture = TestBed.createComponent(ReplayPageComponent);
    component = fixture.componentInstance;
    adapter = adapterOf(fixture);
  });

  function makeHandCard(code: number): CardOnField {
    return { cardCode: code, name: 'H', position: 0, overlayMaterials: [], counters: {} } as unknown as CardOnField;
  }

  it('playerHand reads HAND zone from players[0]', () => {
    adapter.setRendered(makeDuelState(1, 0, [{ zoneId: 'HAND', cards: [makeHandCard(1), makeHandCard(2)] } as BoardZone]));
    expect(component.playerHand().length).toBe(2);
  });

  it('opponentHand reads HAND zone from players[1]', () => {
    adapter.setRendered(makeDuelState(1, 0, [], [{ zoneId: 'HAND', cards: [makeHandCard(3)] } as BoardZone]));
    expect(component.opponentHand().length).toBe(1);
    expect(component.opponentHand()[0].cardCode).toBe(3);
  });

  it('playerHand returns [] when HAND zone is absent', () => {
    adapter.setRendered(makeDuelState(1));
    expect(component.playerHand()).toEqual([]);
  });

  it('playerHand returns [] when player slot is missing', () => {
    // Defensive: a future malformed state with players: [] must not crash.
    const state = makeDuelState(1);
    state.players = [] as unknown as DuelState['players'];
    adapter.setRendered(state);
    expect(component.playerHand()).toEqual([]);
    expect(component.opponentHand()).toEqual([]);
  });
});

// =============================================================================
// F4 — keyboard, sheet open/close, end-overlay, copy-link, zoom, seekToTurn
// =============================================================================

describe('ReplayPageComponent — F4 wiring', () => {
  let fixture: ComponentFixture<ReplayPageComponent>;
  let component: ReplayPageComponent;
  let conn: StubReplayConnection;
  let transport: StubReplayTransport;

  beforeEach(() => {
    clearReplayPrefs();
    localStorage.removeItem('replay.zoomLevel');
    setupTestBed();
    fixture = TestBed.createComponent(ReplayPageComponent);
    component = fixture.componentInstance;
    conn = connOf(fixture);
    transport = transportOf(fixture);
  });

  function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    Object.defineProperty(event, 'target', { value: document.body });
    component.onKeydown(event);
    return event;
  }

  // ── ? opens cheat sheet on QWERTY + AZERTY ────────────────────────────────
  it('"?" key opens the cheat sheet (QWERTY US + AZERTY FR both emit U+003F)', () => {
    expect(component.cheatSheetOpen()).toBe(false);
    press('?');
    expect(component.cheatSheetOpen()).toBe(true);
  });

  // ── Escape closes overlays in priority order ──────────────────────────────
  it('Escape closes the cheat sheet first when open', () => {
    component.cheatSheetOpen.set(true);
    press('Escape');
    expect(component.cheatSheetOpen()).toBe(false);
  });

  it('Escape closes the picker before falling through to other overlays', () => {
    component.pickerOpen.set(true);
    component.optionsOpen.set(true);
    press('Escape');
    expect(component.pickerOpen()).toBe(false);
    // optionsOpen unchanged — picker had priority and consumed the Esc.
    expect(component.optionsOpen()).toBe(true);
  });

  // ── Sheet open/close handlers ─────────────────────────────────────────────
  it('onOpen* / onClose* flip their respective signals', () => {
    component.onOpenCheatSheet();   expect(component.cheatSheetOpen()).toBe(true);
    component.onCloseCheatSheet();  expect(component.cheatSheetOpen()).toBe(false);
    component.onOpenPicker();       expect(component.pickerOpen()).toBe(true);
    component.onClosePicker();      expect(component.pickerOpen()).toBe(false);
    component.onOpenOptions();      expect(component.optionsOpen()).toBe(true);
    component.onCloseOptions();     expect(component.optionsOpen()).toBe(false);
    component.onOpenDetails();      expect(component.detailsOpen()).toBe(true);
    component.onCloseDetails();     expect(component.detailsOpen()).toBe(false);
  });

  // ── Zoom level persistence ────────────────────────────────────────────────
  it('onZoomLevelChange updates the signal AND persists to localStorage', () => {
    expect(component.zoomLevel()).toBe(1);
    component.onZoomLevelChange(3);
    expect(component.zoomLevel()).toBe(3);
    expect(localStorage.getItem('replay.zoomLevel')).toBe('3');
  });

  it('restores zoomLevel from localStorage on construction', () => {
    // Tear down the previous fixture + module, then build a fresh one with
    // a pre-seeded pref so the new instance reads it at field initialiser time.
    fixture.destroy();
    TestBed.resetTestingModule();
    localStorage.setItem('replay.zoomLevel', '2');
    setupTestBed();
    const fx2 = TestBed.createComponent(ReplayPageComponent);
    expect(fx2.componentInstance.zoomLevel()).toBe(2);
    fx2.destroy();
  });

  // ── onSeekToTurn delegates to transport with abortAndClean ────────────────
  it('onSeekToTurn calls transport.seekToTurn with the current turns()', () => {
    conn.boardStates.set([
      makePrecomputed(0, 'setup'), makePrecomputed(1, 'a'), makePrecomputed(1, 'b'),
    ]);
    conn.computedUpTo.set(2);
    component.onSeekToTurn(1);
    expect(transport.seekToTurn).toHaveBeenCalledWith(1, jasmine.any(Array));
  });

  it('onSeekToTurn no-ops when target turn is not yet computed', () => {
    conn.boardStates.set([
      makePrecomputed(0, 'setup'), makePrecomputed(1, 'a'), makePrecomputed(1, 'b'),
    ]);
    conn.computedUpTo.set(0); // setup computed only — turn 1 starts at index 1, not yet reached
    component.onSeekToTurn(1);
    expect(transport.seekToTurn).not.toHaveBeenCalled();
  });

  it('onSeekToTurn no-ops on out-of-range index', () => {
    conn.boardStates.set([makePrecomputed(0, 'setup'), makePrecomputed(1, 'a')]);
    conn.computedUpTo.set(1);
    component.onSeekToTurn(42);
    expect(transport.seekToTurn).not.toHaveBeenCalled();
  });

  it('onSwipeLeft delegates to onSeekToTurn(currentTurnIndex + 1)', () => {
    conn.boardStates.set([
      makePrecomputed(0, 'setup'), makePrecomputed(1, 'a'),
    ]);
    conn.computedUpTo.set(1);
    transport.currentIndex.set(0);
    component.onSwipeLeft();
    expect(transport.seekToTurn).toHaveBeenCalledWith(1, jasmine.any(Array));
  });

  it('onSwipeLeft at last turn does NOT call transport.seekToTurn (bounds guard)', () => {
    conn.boardStates.set([makePrecomputed(0, 'setup'), makePrecomputed(1, 'a')]);
    conn.computedUpTo.set(1);
    transport.currentIndex.set(1); // already on the last computed turn
    component.onSwipeLeft();
    expect(transport.seekToTurn).not.toHaveBeenCalled();
  });

  // ── endOverlayState ───────────────────────────────────────────────────────
  it('endOverlayState is null until atEnd() is true', () => {
    conn.boardStates.set([makePrecomputed(1)]);
    conn.computedUpTo.set(0);
    transport.currentIndex.set(0);
    conn.metadata.set({ playerUsernames: ['AxelTest', 'Opp'], result: 'victory' });
    // Not at end yet (atEnd needs upTo > 0 + currentIndex >= upTo, but upTo=0 → atEnd=false)
    expect(component.endOverlayState()).toBeNull();
  });

  it('endOverlayState maps result via deriveOutcome from local perspective', () => {
    conn.boardStates.set([makePrecomputed(1), makePrecomputed(2)]);
    conn.computedUpTo.set(1);
    transport.currentIndex.set(1);
    conn.metadata.set({
      playerUsernames: ['AxelTest', 'OppName'],
      deckNames: ['MyDeck', 'OppDeck'],
      result: 'victory',
      turnCount: 2,
    } as unknown);
    const eo = component.endOverlayState();
    expect(eo).not.toBeNull();
    expect(eo?.outcome).toBe('victory');
    expect(eo?.selfName).toBe('AxelTest');
    expect(eo?.oppName).toBe('OppName');
  });

  it('endOverlayState returns null when metadata is missing even at end', () => {
    conn.boardStates.set([makePrecomputed(1), makePrecomputed(2)]);
    conn.computedUpTo.set(1);
    transport.currentIndex.set(1);
    conn.metadata.set(null);
    expect(component.endOverlayState()).toBeNull();
  });

  // ── onCopyLink ────────────────────────────────────────────────────────────
  // window.location is not configurable in Karma, so we use the real origin
  // and only verify the writeText was called with a URL containing the
  // seekTo query param + the replayId. Full URL exactness is verified
  // implicitly by inspecting the call argument shape.
  it('onCopyLink writes the URL with seekTo + flashes the success state', async () => {
    transport.currentIndex.set(7);
    const writeSpy = jasmine.createSpy('writeText').and.resolveTo();
    spyOnProperty(navigator, 'clipboard', 'get').and.returnValue({ writeText: writeSpy } as unknown as Clipboard);

    await component.onCopyLink();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const url = writeSpy.calls.mostRecent().args[0] as string;
    expect(url).toContain('/pvp/replay/replay-42?seekTo=7');
    expect(component.copyJustSucceeded()).toBe(true);
  });

  it('onCopyLink falls back to execCommand when navigator.clipboard fails', async () => {
    transport.currentIndex.set(3);
    const writeSpy = jasmine.createSpy('writeText').and.rejectWith(new Error('no clipboard'));
    spyOnProperty(navigator, 'clipboard', 'get').and.returnValue({ writeText: writeSpy } as unknown as Clipboard);
    const execSpy = spyOn(document, 'execCommand').and.returnValue(true);

    await component.onCopyLink();

    expect(writeSpy).toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalledWith('copy');
    expect(component.copyJustSucceeded()).toBe(true);
  });

  // ── hasNonDefaultOption ───────────────────────────────────────────────────
  it('hasNonDefaultOption flags any non-default visionnage option', () => {
    expect(component.hasNonDefaultOption()).toBe(false);
    component.animationsEnabled.set(true);
    expect(component.hasNonDefaultOption()).toBe(true);
    component.animationsEnabled.set(false);
    component.promptMode.set('result');
    expect(component.hasNonDefaultOption()).toBe(true);
  });

  // ── isNarrow / matchMedia ─────────────────────────────────────────────────
  it('exposes isNarrow signal driven by matchMedia(< 760px)', () => {
    // The constructor reads window.matchMedia which jsdom-like envs honour
    // (defaults to false unless the test forces it). We only verify the
    // signal exists + is boolean — the listener wiring is in ngOnInit, not
    // tested here because ngOnInit is gated behind connect() in the legacy
    // suite.
    expect(typeof component.isNarrow()).toBe('boolean');
  });

  // ── currentTurnIndex ──────────────────────────────────────────────────────
  it('currentTurnIndex resolves to the turn containing currentIndex', () => {
    conn.boardStates.set([
      makePrecomputed(0, 'setup'),
      makePrecomputed(1, 'a'), makePrecomputed(1, 'b'),
      makePrecomputed(2, 'c'),
    ]);
    transport.currentIndex.set(0);  expect(component.currentTurnIndex()).toBe(0); // setup
    transport.currentIndex.set(2);  expect(component.currentTurnIndex()).toBe(1); // turn 1
    transport.currentIndex.set(3);  expect(component.currentTurnIndex()).toBe(2); // turn 2
  });

  // ── mySide ────────────────────────────────────────────────────────────────
  it('mySide returns 1 when auth pseudo matches the second player', () => {
    conn.metadata.set({ playerUsernames: ['Other', 'AxelTest'] } as unknown);
    expect(component.mySide()).toBe(1);
  });

  it('mySide returns 0 when auth pseudo matches the first player (or default)', () => {
    conn.metadata.set({ playerUsernames: ['AxelTest', 'Other'] } as unknown);
    expect(component.mySide()).toBe(0);
  });
});
