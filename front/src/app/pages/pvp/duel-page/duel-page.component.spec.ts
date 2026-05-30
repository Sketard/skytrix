/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (mocks of the
   real pipeline shape). They are not pipeline signals at runtime;
   the §3.2 tagging convention (transport / environment / projection)
   targets the real classes only. (α.7b.1, 2026-05-25) */

/**
 * Spec for DuelPageComponent — root coordinator of the PvP duel flow.
 *
 * Strategy: the real component instantiates 24 component-scoped services
 * (orchestrator, 7 managers, effects services, HTTP). Most have heavy
 * lifecycle (effects, WS connect, HTTP polling) that has nothing to do
 * with the invariants pinned here. We therefore:
 *
 *  1. Stub `DuelWebSocketService` with a signal-driven surface (no real
 *     `DuelConnection` — that one owns the WebSocket open path).
 *  2. Replace every effects-bearing service via `overrideComponent` with
 *     a no-op stub exposing the same shape the component reads.
 *  3. Override the template to `''` to avoid rendering 458 LOC of HTML
 *     bindings against the stubs.
 *
 * The pinned surface is the component's own computeds / effects, which
 * is exactly what a future refactor would silently break.
 */

import { Component, input, signal, WritableSignal, Signal, computed } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';

import { DuelPageComponent } from './duel-page.component';
import { PvpDiceArenaComponent } from './pvp-dice-arena/pvp-dice-arena.component';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DuelTabGuardService } from './duel-tab-guard.service';
import { CardDataCacheService } from './card-data-cache.service';
import { DuelCardArtService } from './duel-card-art.service';
import { DuelLogger } from './duel-logger';
import { DuelContext } from './duel-context';
import { LpAnimationTracker } from './lp-animation-tracker';
import { BattleAnimationTracker } from './battle-animation-tracker';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DrawSequenceManager } from './draw-sequence-manager';
import { MoveAnimationRouter } from './move-animation-router';
import { TargetIndicatorManager } from './target-indicator-manager';
import { BufferReplayBuilder } from './buffer-replay-builder';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { CardTravelEngine } from './card-travel-engine.service';
import { BoardEffectsService } from './board-effects.service';
import { FloatRegistryService } from './float-registry.service';
import { RoomStateMachineService } from './room-state-machine.service';
import { CardInspectionService } from './card-inspection.service';
import { DebugLogService } from './debug-log.service';
import { DuelDebugService } from './duel-debug.service';
import { DuelGameLogService } from './duel-game-log.service';
import { SoloDuelOrchestratorService } from './solo-duel-orchestrator.service';
import { PhaseAnnouncementService } from './phase-announcement.service';
import { DuelToastService } from './duel-toast.service';
import { DuelConnectionEffectsService } from './duel-connection-effects.service';
import { SoloModeEffectsService } from './solo-mode-effects.service';
import { DuelPromptEffectsService } from './duel-prompt-effects.service';
import { DuelA11yEffectsService } from './duel-a11y-effects.service';
import { DuelLoadingEffectsService } from './duel-loading-effects.service';
import { DuelAnimationBridgeService } from './duel-animation-bridge.service';
import { CardActionMenuService } from './card-action-menu.service';
import { PromptDerivationService } from './prompt-derivation.service';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { NotificationService } from '../../../core/services/notification.service';
import { NavbarCollapseService } from '../../../services/navbar-collapse.service';

import { EMPTY_DUEL_STATE } from '../types';
import type { DuelState, ChainLinkState } from '../types';
import type { TimerStateMsg, BoardStatePayload, PlayerBoardState, BoardZone, CardOnField } from '../duel-ws.types';
import { LOCATION, POSITION } from '../duel-ws.types';

// =============================================================================
// Stubs
// =============================================================================

/**
 * Minimal `DuelWebSocketService` stub: exposes the writable signals the
 * component reads + spies for the side-effect calls we want to assert.
 *
 * Each test mutates the writable signals to drive the computeds; the real
 * WS layer never opens.
 */
class StubWsService {
  // The component reads `this.wsService.boardStateView.{logical,rendered}State()`.
  // Two writable signals back the view; tests assign to them directly.
  private readonly _logical = signal<DuelState>(structuredClone(EMPTY_DUEL_STATE));
  private readonly _rendered = signal<DuelState>(structuredClone(EMPTY_DUEL_STATE));
  readonly boardStateView = {
    logicalState: this._logical.asReadonly(),
    renderedState: this._rendered.asReadonly(),
    hasLockedZones: false,
  };
  setLogical(s: DuelState): void { this._logical.set(s); }
  setRendered(s: DuelState): void { this._rendered.set(s); }

  // Direct signal surface read by the component + by PromptDerivationService.
  readonly pendingPrompt = signal<unknown>(null);
  readonly hintContext = signal({ hintType: 0, player: 0, value: 0, cardName: '' });
  readonly animationQueue = signal<readonly unknown[]>([]);
  readonly timerState = signal<TimerStateMsg | null>(null);
  readonly timerStatePerPlayer = signal<readonly [TimerStateMsg | null, TimerStateMsg | null]>([null, null]);
  readonly connectionStatus = signal<'connecting' | 'connected' | 'lost' | 'reconnecting'>('connected');
  readonly protocolMismatch = signal(false);
  readonly opponentDisconnected = signal(false);
  readonly disconnectGraceSec = signal(0);
  readonly activeChainLinks = signal<readonly unknown[]>([]);
  readonly pendingChainEntry = signal<unknown>(null);
  readonly chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  readonly duelResult = signal<{ winner: number | null; reason: string } | null>(null);
  readonly diceResult = signal<unknown>(null);
  readonly diceInProgress = signal(false);
  readonly ocgPlayerIndex = signal<number | null>(0);
  readonly cardCodes = signal<readonly number[]>([]);
  readonly rematchState = signal<'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired'>('idle');
  readonly rematchStarting = signal(false);
  readonly inactivityWarning = signal<unknown>(null);
  readonly waitingForOpponent = signal(false);
  // c6f — per-slot waitingForOpponent accessor used by waitingForOpponentOnOtherSlot.
  // The two slots are mocked as independent signals — tests can drive either.
  readonly waitingForOpponentBySlot: [ReturnType<typeof signal<boolean>>, ReturnType<typeof signal<boolean>>] = [signal(false), signal(false)];
  waitingForOpponentForSlot(slot: 0 | 1): ReturnType<typeof signal<boolean>> { return this.waitingForOpponentBySlot[slot]; }
  // c6g — server ERROR surface read by the toast effect.
  readonly lastError = signal<{ message: string; player?: 0 | 1 } | null>(null);
  clearLastError = jasmine.createSpy('clearLastError');
  readonly firstPlayerResult = signal<{ goFirst: boolean } | null>(null);
  readonly firstPlayerResponseSent = signal(false);
  readonly sessionPhase = signal<'PRE_DUEL' | 'DUELING' | 'ENDED' | null>(null);
  readonly canRetry = signal(true);
  readonly totalAutoRetries = signal(0);
  readonly justReconnected = signal(false);

  hasPendingChainEntry(): boolean { return false; }

  // Spies (assigned in beforeEach to fresh jasmine.Spy instances).
  sendAnimationsDone = jasmine.createSpy('sendAnimationsDone');
  sendResponse = jasmine.createSpy('sendResponse');
  sendRequestStateSync = jasmine.createSpy('sendRequestStateSync');
  sendRematchRequest = jasmine.createSpy('sendRematchRequest');
  sendSurrender = jasmine.createSpy('sendSurrender');
  retryConnection = jasmine.createSpy('retryConnection');
  setBoardActive = jasmine.createSpy('setBoardActive');
  clearDiceResult = jasmine.createSpy('clearDiceResult');
  connect = jasmine.createSpy('connect');
  destroy = jasmine.createSpy('destroy');
  ngOnDestroy = jasmine.createSpy('ngOnDestroy');
  attachOutOfBandSink = jasmine.createSpy('attachOutOfBandSink');

  onStateSync?: () => void;
}

/** Generic stub for *EffectsService classes — `initEffects` and the
 *  bootstrap entry points are spies so C1.5 can assert which branch
 *  the constructor entered. */
class NoopEffectsStub {
  initEffects = jasmine.createSpy('initEffects');
  initSolo = jasmine.createSpy('initSolo');
  initFork = jasmine.createSpy('initFork');
  silenceCurrentPhase = jasmine.createSpy('silenceCurrentPhase');
  markAwaitingStateSync = jasmine.createSpy('markAwaitingStateSync');
  clear = jasmine.createSpy('clear');
}

/** Stub for AnimationOrchestratorService — only the few signals/methods the
 *  component reads/calls. Component owns no animation logic itself. */
class StubAnimationOrchestrator {
  // β.3 Lot 3.1 — `isAnimating` is now a projection on the real service;
  // expose a matching `{ value: WritableSignal }` shape so tests can drive
  // it via `.value.set(...)` instead of the legacy `.set(...)`.
  readonly isAnimating = { value: signal(false) };
  readonly animatingZone = signal<unknown>(null);
  readonly lpTracker = { animatingLpPlayer: signal<number | null>(null) };
  readonly eventStream = signal<readonly unknown[]>([]);
  destroy = jasmine.createSpy('destroy');
  onStateSync = jasmine.createSpy('onStateSync');
  isPreActivationBufferActive = jasmine.createSpy('isPreActivationBufferActive').and.returnValue(false);
  drainPreActivationBuffer = jasmine.createSpy('drainPreActivationBuffer');
  pushToStream = jasmine.createSpy('pushToStream').and.returnValue(0);
}

/** Stub for SoloDuelOrchestratorService.
 *  c6a — refactor `connections` paire → `connection` singular. */
class StubSoloOrchestrator {
  readonly connection = signal<{ timerStatePerPlayer: () => readonly [TimerStateMsg | null, TimerStateMsg | null] } | null>(null);
  readonly perspectiveIndex = signal(0);
  init = jasmine.createSpy('init');
  switchPerspective = jasmine.createSpy('switchPerspective');
  // F3 — gate read by the toolbar [disabled] + urgent-glow bindings. Default
  // true so the switch button renders enabled in component tests.
  canSwitchPerspective = true;
}

/** Stub for RoomStateMachineService — exposes the signals + spies for
 *  init/destroy/forceState consumed in the constructor. */
class StubRoomStateMachine {
  readonly roomState = signal<'loading' | 'waiting' | 'creating-duel' | 'connecting' | 'duel-loading' | 'active' | 'error'>('loading');
  readonly room = signal<unknown>(null);
  readonly countdown = signal<unknown>(null);
  readonly canShare = false;
  readonly deckName = signal('');
  decklistId: number | null = null;
  init = jasmine.createSpy('init');
  forceState = jasmine.createSpy('forceState');
  destroy = jasmine.createSpy('destroy');
  fetchRoom = jasmine.createSpy('fetchRoom');
  copyRoomLink = jasmine.createSpy('copyRoomLink');
  shareRoom = jasmine.createSpy('shareRoom');
  leaveRoom = jasmine.createSpy('leaveRoom');
}

/** Stub CardInspectionService. */
class StubCardInspection {
  readonly inspectedCard = signal<unknown>(null);
  readonly inspectorForceExpanded = signal(false);
  init = jasmine.createSpy('init');
  inspectByCode = jasmine.createSpy('inspectByCode').and.resolveTo();
  showUnknownCard = jasmine.createSpy('showUnknownCard');
  close = jasmine.createSpy('close');
}

/** Stub PromptDerivationService — every signal read by the component is
 *  exposed as a writable signal directly. configure() is a no-op. */
class StubPromptDerivation {
  readonly visiblePrompt = signal<unknown>(null);
  readonly actionablePrompt = signal<unknown>(null);
  readonly hasActivePrompt = signal(false);
  readonly isZoneHighlightActive = signal(false);
  readonly highlightedZones = signal<unknown>(new Set());
  readonly zoneInstruction = signal<unknown>(null);
  readonly playerActionableHandIndices = signal<readonly number[]>([]);
  readonly playerActivateHandIndices = signal<readonly number[]>([]);
  readonly tpPassiveMessage = signal<unknown>(null);
  configure = jasmine.createSpy('configure');
}

/** Stub CardActionMenuService. */
class StubCardActionMenu {
  readonly menuState = signal<unknown>(null);
  readonly effectSubMenu = signal<unknown>(null);
  readonly pilePrompt = signal<unknown>(null);
  readonly menuDisplayActions = signal<readonly unknown[]>([]);
  setOnClose = jasmine.createSpy('setOnClose');
  open = jasmine.createSpy('open');
  close = jasmine.createSpy('close');
  onAction = jasmine.createSpy('onAction');
  onChildAction = jasmine.createSpy('onChildAction');
  onKeydown = jasmine.createSpy('onKeydown');
  pileResponse = jasmine.createSpy('pileResponse');
}

/** Stub DuelTabGuardService. */
class StubDuelTabGuard {
  readonly isBlocked = signal(false);
  init = jasmine.createSpy('init');
  takeControl = jasmine.createSpy('takeControl');
  broadcast = jasmine.createSpy('broadcast');
}

/** Stub DuelContext — configure() captures closures; methods read them. */
class StubDuelContext {
  private _ownPlayerIndex: () => number = () => 0;
  private _speedMultiplier: () => number = () => 1;
  private _isBoardActive: () => boolean = () => false;
  configure(c: { ownPlayerIndex: () => number; speedMultiplier: () => number; isBoardActive: () => boolean }): void {
    this._ownPlayerIndex = c.ownPlayerIndex;
    this._speedMultiplier = c.speedMultiplier;
    this._isBoardActive = c.isBoardActive;
  }
  ownPlayerIndex(): number { return this._ownPlayerIndex(); }
  speedMultiplier(): number { return this._speedMultiplier(); }
  isBoardActive(): boolean { return this._isBoardActive(); }
  reducedMotion = signal(false);
  relativePlayer(): 0 | 1 { return 0; }
  scaledDuration(base: number): number { return base; }
  safetyTimeout(base: number): number { return base; }
  announceEvent = jasmine.createSpy('announceEvent');
}

class StubChainResolutionManager {
  readonly chainEntryAnimating = signal(false);
  readonly chainPromptGateActive = signal(false);
  readonly chainSolvedCount = signal(0);
  readonly isResolving = signal(false);
  readonly hasActiveReplayTimeouts = signal(false);
}

class StubCardTravelEngine {
  registerContainer = jasmine.createSpy('registerContainer');
  registerZoneResolver = jasmine.createSpy('registerZoneResolver');
}

class StubCardDataCache {
  clearCache = jasmine.createSpy('clearCache');
}

class StubPhaseAnnouncementService {
  clear = jasmine.createSpy('clear');
}

class StubNavbarCollapse {
  setNavbarHidden = jasmine.createSpy('setNavbarHidden');
}

class StubNotification {
  error = jasmine.createSpy('error');
}

class StubRouter {
  navigate = jasmine.createSpy('navigate');
}

class StubMatDialog {
  open = jasmine.createSpy('open');
}

class StubHttpClient {
  get = jasmine.createSpy('get');
  post = jasmine.createSpy('post').and.returnValue({ subscribe: () => undefined });
}

class StubTranslate {
  currentLang = 'en';
  instant = (key: string): string => key;
  get = (key: string): { subscribe: (fn: (v: string) => void) => void } => ({ subscribe: fn => fn(key) });
  onLangChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
  onTranslationChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
  onDefaultLangChange = { subscribe: () => ({ unsubscribe: () => undefined }) };
}

// =============================================================================
// Helpers
// =============================================================================

/** Build a player board state with the given LP. */
function makePlayer(lp: number, overrides: Partial<PlayerBoardState> = {}): PlayerBoardState {
  return { lp, deckCount: 0, extraCount: 0, zones: [], ...overrides };
}

/** Two-player state with custom LPs. */
function makeState(lp0: number, lp1: number, overrides: Partial<BoardStatePayload> = {}): DuelState {
  return {
    turnPlayer: 0,
    turnCount: 0,
    phase: 'DRAW',
    players: [makePlayer(lp0), makePlayer(lp1)],
    ...overrides,
  };
}

/** Build the `ActivatedRoute` stub the component reads in its constructor.
 *  No `roomCode` ⇒ none of the bootstrap branches fire (PvP/solo/fork all
 *  guard on `code` truthy), keeping the constructor minimal. */
function makeRouteStub(opts: {
  roomCode?: string | null;
  query?: Record<string, string>;
} = {}): ActivatedRoute {
  const paramMap = convertToParamMap(opts.roomCode ? { roomCode: opts.roomCode } : {});
  const queryParamMap = convertToParamMap(opts.query ?? {});
  return {
    snapshot: { paramMap, queryParamMap },
    // The component pipes `route.paramMap` through `toSignal`, which expects
    // a real Observable. `of(paramMap)` emits once and completes — toSignal
    // captures the value as the initialValue replacement.
    paramMap: of(paramMap),
  } as unknown as ActivatedRoute;
}

/** Configure TestBed with the full stub provider list. The component uses
 *  `providers: [...]` at the @Component level — TestBed's
 *  `overrideComponent({ set: { providers } })` replaces them entirely, which
 *  is what we want (we know the full list and own the stubs). */
function setupTestBed(routeStub: ActivatedRoute = makeRouteStub()): void {
  TestBed.configureTestingModule({
    imports: [DuelPageComponent],
    providers: [
      { provide: ActivatedRoute, useValue: routeStub },
      { provide: Router, useClass: StubRouter },
      { provide: HttpClient, useClass: StubHttpClient },
      { provide: MatDialog, useClass: StubMatDialog },
      { provide: TranslateService, useClass: StubTranslate },
      { provide: NotificationService, useClass: StubNotification },
      { provide: NavbarCollapseService, useClass: StubNavbarCollapse },
    ],
  });

  TestBed.overrideComponent(DuelPageComponent, {
    set: {
      template: '',
      providers: [
        { provide: DuelWebSocketService, useClass: StubWsService },
        { provide: CardDataCacheService, useClass: StubCardDataCache },
        { provide: DuelTabGuardService, useClass: StubDuelTabGuard },
        { provide: DuelLogger, useValue: { log: () => undefined, warn: () => undefined } },
        { provide: LpAnimationTracker, useValue: { animatingLpPlayer: signal<number | null>(null) } },
        { provide: BattleAnimationTracker, useValue: {} },
        { provide: DuelContext, useClass: StubDuelContext },
        { provide: ChainResolutionManager, useClass: StubChainResolutionManager },
        { provide: DrawSequenceManager, useValue: {} },
        { provide: MoveAnimationRouter, useValue: {} },
        { provide: BufferReplayBuilder, useValue: {} },
        { provide: TargetIndicatorManager, useValue: {} },
        { provide: AnimationOrchestratorService, useClass: StubAnimationOrchestrator },
        { provide: CardTravelEngine, useClass: StubCardTravelEngine },
        { provide: BoardEffectsService, useValue: {} },
        { provide: FloatRegistryService, useValue: {} },
        { provide: RoomStateMachineService, useClass: StubRoomStateMachine },
        { provide: CardInspectionService, useClass: StubCardInspection },
        { provide: DebugLogService, useValue: { logServerMessage: () => undefined, logPlayerResponse: () => undefined } },
        {
          provide: DuelDebugService,
          useValue: {
            bindToWindow: () => undefined,
            unbindFromWindow: () => undefined,
            preActivationBufferAccessor: null as unknown,
          },
        },
        // Real service — pure (signals + GameLogBuilder), no DI deps, inert
        // until the orchestrator taps it. The page wires it in its constructor.
        DuelGameLogService,
        { provide: SoloDuelOrchestratorService, useClass: StubSoloOrchestrator },
        { provide: PhaseAnnouncementService, useClass: StubPhaseAnnouncementService },
        // c6g — `show` consumed by the toast ERROR effect ; `clear` by
        // the ngOnDestroy. Spies so c6g tests can observe what fired.
        { provide: DuelToastService, useValue: { show: jasmine.createSpy('show'), clear: jasmine.createSpy('clear') } },
        { provide: DuelConnectionEffectsService, useClass: NoopEffectsStub },
        { provide: SoloModeEffectsService, useClass: NoopEffectsStub },
        { provide: DuelPromptEffectsService, useClass: NoopEffectsStub },
        { provide: DuelA11yEffectsService, useClass: NoopEffectsStub },
        { provide: DuelLoadingEffectsService, useClass: NoopEffectsStub },
        { provide: DuelAnimationBridgeService, useClass: NoopEffectsStub },
        { provide: DuelCardArtService, useValue: { resolveUrl: () => '', setArtMap: () => undefined, prefetchCard: () => undefined } },
        { provide: CardActionMenuService, useClass: StubCardActionMenu },
        { provide: PromptDerivationService, useClass: StubPromptDerivation },
        { provide: ANIMATION_DATA_SOURCE, useExisting: DuelWebSocketService },
      ],
    },
  });
}

/** Pull the `DuelWebSocketService` instance bound to the fixture (the
 *  component reads via `inject(DuelWebSocketService)`, which resolves to
 *  the stub class). */
function wsOf(fixture: ComponentFixture<DuelPageComponent>): StubWsService {
  return fixture.componentRef.injector.get(DuelWebSocketService) as unknown as StubWsService;
}

// =============================================================================
// C1.1 — boardReady + duelLoadingReady display gating
// =============================================================================

describe('DuelPageComponent — boardReady + duelLoadingReady (C1.1)', () => {
  let fixture: ComponentFixture<DuelPageComponent>;
  let component: DuelPageComponent;
  let ws: StubWsService;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DuelPageComponent);
    component = fixture.componentInstance;
    ws = wsOf(fixture);
  });

  it('boardReady() is false when logicalState.players is empty', () => {
    // Pre-init / between-games state: server has not pushed any BOARD_STATE,
    // logicalState carries the EMPTY_DUEL_STATE shape but with `players: []`
    // for some transient invariants (e.g., post-disconnect hard reset).
    ws.setLogical({ ...EMPTY_DUEL_STATE, players: [] as unknown as DuelState['players'] });
    expect(component.boardReady()).toBe(false);
  });

  it('boardReady() is false when both players exist but deckCount === 0 (EMPTY_DUEL_STATE shape)', () => {
    // Regression guard for 2026-05-14 fix: EMPTY_DUEL_STATE seeds lp=8000
    // before any BOARD_STATE arrives, so gating on LP flipped boardReady true
    // immediately and skipped the duel-loading screen. The gate must require
    // a real worker BOARD_STATE — only those populate deckCount.
    ws.setLogical(makeState(8000, 8000));
    expect(component.boardReady()).toBe(false);
  });

  it('boardReady() is false when only one player has a populated deck', () => {
    ws.setLogical(makeState(8000, 8000, { players: [
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
      { lp: 8000, deckCount: 0, extraCount: 0, zones: [] },
    ] }));
    expect(component.boardReady()).toBe(false);
  });

  it('boardReady() is true once both players have deckCount > 0 (post first BOARD_STATE)', () => {
    ws.setLogical(makeState(8000, 8000, { players: [
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
    ] }));
    expect(component.boardReady()).toBe(true);
  });

  it('duelLoadingReady() is false while boardReady=true but thumbnailsReady=false', () => {
    ws.setLogical(makeState(8000, 8000, { players: [
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
    ] }));
    component.thumbnailsReady.set(false);
    expect(component.boardReady()).toBe(true);
    expect(component.duelLoadingReady()).toBe(false);
  });

  it('duelLoadingReady() is true only when both boardReady and thumbnailsReady', () => {
    ws.setLogical(makeState(8000, 8000, { players: [
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
      { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
    ] }));
    component.thumbnailsReady.set(true);
    expect(component.duelLoadingReady()).toBe(true);
  });
});

// =============================================================================
// C1.2 — displayedTimerState multiplexing (PvP / solo / fallback)
// =============================================================================

/** Shape of the per-connection accessor the component reads in solo mode:
 *  `conns[activeIdx].timerStatePerPlayer()[activeIdx]`. */
type FakeSoloConnection = {
  timerStatePerPlayer: () => readonly [TimerStateMsg | null, TimerStateMsg | null];
};

function makeTimer(label: string): TimerStateMsg {
  // The component reads through `displayedTimerState()` and forwards the
  // whole object — its inner shape doesn't matter for the multiplexing
  // invariant. We tag with a unique label to assert *which* pool was read.
  return { type: 'TIMER_STATE', tag: label } as unknown as TimerStateMsg;
}

function makeConnection(t0: TimerStateMsg | null, t1: TimerStateMsg | null): FakeSoloConnection {
  const tuple = [t0, t1] as const;
  return { timerStatePerPlayer: () => tuple };
}

describe('DuelPageComponent — displayedTimerState multiplexing (C1.2)', () => {
  let fixture: ComponentFixture<DuelPageComponent>;
  let component: DuelPageComponent;
  let ws: StubWsService;
  let solo: StubSoloOrchestrator;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DuelPageComponent);
    component = fixture.componentInstance;
    ws = wsOf(fixture);
    solo = fixture.componentRef.injector.get(SoloDuelOrchestratorService) as unknown as StubSoloOrchestrator;
  });

  it('PvP + ocgPlayerIndex=null falls back to top-level timerState() (pre-handshake)', () => {
    const fallback = makeTimer('fallback');
    ws.timerState.set(fallback);
    ws.ocgPlayerIndex.set(null);
    // isSoloMode defaults to false — PvP path.
    expect(component.displayedTimerState()).toBe(fallback);
  });

  it('PvP + ocgPlayerIndex=0 reads timerStatePerPlayer[0] (own pool, player 1 perspective)', () => {
    const own = makeTimer('p0-own');
    const opp = makeTimer('p1-opp');
    ws.timerStatePerPlayer.set([own, opp]);
    ws.ocgPlayerIndex.set(0);
    expect(component.displayedTimerState()).toBe(own);
  });

  it('PvP + ocgPlayerIndex=1 reads timerStatePerPlayer[1] (perspective on player 2 side)', () => {
    // The "each player sees their own pool" invariant is exactly what would
    // regress if a future refactor simplified the multiplex to read by
    // `turnPlayer` instead of `ocgPlayerIndex` — the opponent's pool
    // would tick down on the local screen. Pin both indices.
    const own = makeTimer('p1-own');
    const opp = makeTimer('p0-opp');
    ws.timerStatePerPlayer.set([opp, own]);
    ws.ocgPlayerIndex.set(1);
    expect(component.displayedTimerState()).toBe(own);
  });

  it('Solo + connection=null falls back to top-level timerState() (during init)', () => {
    const fallback = makeTimer('solo-fallback');
    ws.timerState.set(fallback);
    (component.isSoloMode as WritableSignal<boolean>).set(true);
    solo.connection.set(null);
    expect(component.displayedTimerState()).toBe(fallback);
  });

  it('Solo + perspectiveIndex=1 reads connection.timerStatePerPlayer()[1] (c6a mono-connection)', () => {
    // c6a — SOLO multiplex passe à 1 connection. Le pool timer per-
    // player est broadcast omniscient ; la perspective sélectionne
    // l'index du pool (`[activeIdx]`).
    const t0own = makeTimer('conn-pool-0');
    const t1own = makeTimer('conn-pool-1');
    const conn = makeConnection(t0own, t1own);
    (component.isSoloMode as WritableSignal<boolean>).set(true);
    solo.connection.set(conn as unknown as ReturnType<typeof solo.connection>);
    solo.perspectiveIndex.set(1);
    expect(component.displayedTimerState()).toBe(t1own);
  });
});

// =============================================================================
// γ Option C PR2 c6fg — waitingForOpponentOnOtherSlot + toast ERROR
// =============================================================================

describe('DuelPageComponent — c6fg (urgent glow + toast ERROR)', () => {
  let fixture: ComponentFixture<DuelPageComponent>;
  let component: DuelPageComponent;
  let ws: StubWsService;
  let solo: StubSoloOrchestrator;
  let toast: DuelToastService;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DuelPageComponent);
    component = fixture.componentInstance;
    ws = wsOf(fixture);
    solo = fixture.componentRef.injector.get(SoloDuelOrchestratorService) as unknown as StubSoloOrchestrator;
    toast = fixture.componentRef.injector.get(DuelToastService);
  });

  // ⚠️ Semantics (fixed 2026-05-30): `waitingForOpponentBySlot[X] = true` means
  // "slot X is WAITING for the other player to act" — so the OTHER slot has the
  // action. The glow invites a switch when the OTHER (opponent) slot has the
  // action, i.e. when the CURRENT slot is the one waiting. The glow therefore
  // reads `waitingForOpponentForSlot(cur)`, NOT `(other)`.
  describe('waitingForOpponentOnOtherSlot (c6f)', () => {
    it('returns false outside SOLO mode', () => {
      (component.isSoloMode as WritableSignal<boolean>).set(false);
      ws.waitingForOpponentBySlot[0].set(true);
      ws.waitingForOpponentBySlot[1].set(true);
      expect(component.waitingForOpponentOnOtherSlot()).toBe(false);
    });

    it('SOLO + perspective=0: glows when the CURRENT slot (0) is waiting → opponent (1) has the action', () => {
      (component.isSoloMode as WritableSignal<boolean>).set(true);
      solo.perspectiveIndex.set(0);
      ws.waitingForOpponentBySlot[0].set(true);  // current slot is waiting
      ws.waitingForOpponentBySlot[1].set(false);
      expect(component.waitingForOpponentOnOtherSlot()).toBe(true);
    });

    it('SOLO + perspective=1: glows when the CURRENT slot (1) is waiting → opponent (0) has the action', () => {
      (component.isSoloMode as WritableSignal<boolean>).set(true);
      solo.perspectiveIndex.set(1);
      ws.waitingForOpponentBySlot[0].set(false);
      ws.waitingForOpponentBySlot[1].set(true);  // current slot is waiting
      expect(component.waitingForOpponentOnOtherSlot()).toBe(true);
    });

    it('SOLO + the CURRENT player has the action (current slot NOT waiting) → no glow', () => {
      (component.isSoloMode as WritableSignal<boolean>).set(true);
      solo.perspectiveIndex.set(0);
      // The OTHER slot (1) is waiting → the CURRENT player (0) has the action →
      // no point inviting a switch.
      ws.waitingForOpponentBySlot[0].set(false); // current slot NOT waiting
      ws.waitingForOpponentBySlot[1].set(true);  // other slot waiting
      expect(component.waitingForOpponentOnOtherSlot()).toBe(false);
    });
  });

  describe('toast ERROR effect (c6g)', () => {
    it('shows a toast with the server message when lastError flips non-null', () => {
      // `toast.show` is already a jasmine.Spy (TestBed mock at line ~426).
      // Cast it through `unknown` to silence the structural typing.
      const showSpy = toast.show as unknown as jasmine.Spy;
      const clearSpy = toast.clear as unknown as jasmine.Spy;
      showSpy.calls.reset();
      clearSpy.calls.reset();
      (ws.clearLastError as jasmine.Spy).calls.reset();

      fixture.detectChanges();
      ws.lastError.set({ message: 'Expected prompt type SELECT_CARD, got ANNOUNCE_CARD' });
      TestBed.tick();

      expect(showSpy).toHaveBeenCalledOnceWith(
        { icon: 'error', lines: ['Expected prompt type SELECT_CARD, got ANNOUNCE_CARD'] },
        4000,
      );
      expect(ws.clearLastError).toHaveBeenCalledTimes(1);
    });

    it('does NOT show a toast while lastError stays null', () => {
      const showSpy = toast.show as unknown as jasmine.Spy;
      showSpy.calls.reset();

      fixture.detectChanges();
      TestBed.tick();

      expect(showSpy).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// C1.3 — _animationsDoneEffect gating ANIMATIONS_DONE
// =============================================================================

describe('DuelPageComponent — _animationsDoneEffect (C1.3)', () => {
  let fixture: ComponentFixture<DuelPageComponent>;
  let ws: StubWsService;
  let anim: StubAnimationOrchestrator;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DuelPageComponent);
    ws = wsOf(fixture);
    anim = fixture.componentRef.injector.get(AnimationOrchestratorService) as unknown as StubAnimationOrchestrator;
    // Trigger the initial effect run so subsequent transitions are observed
    // from a clean baseline (effect is created in the constructor and runs
    // on the first flush — calling flushEffects here makes the baseline
    // explicit instead of side-loaded into the first test).
    fixture.detectChanges();
  });

  it('does not send ANIMATIONS_DONE when no pending prompt and not animating', () => {
    ws.pendingPrompt.set(null);
    anim.isAnimating.value.set(false);
    fixture.detectChanges();
    expect(ws.sendAnimationsDone).not.toHaveBeenCalled();
  });

  it('does not send ANIMATIONS_DONE while a prompt is pending and animation queue is busy', () => {
    // Gate: server timer waits until the visible animation queue drains.
    // Setting isAnimating=true before the prompt arrives means we should
    // never have fired before this point.
    anim.isAnimating.value.set(true);
    ws.pendingPrompt.set({ type: 'SELECT_CARD' });
    fixture.detectChanges();
    expect(ws.sendAnimationsDone).not.toHaveBeenCalled();
  });

  it('sends ANIMATIONS_DONE exactly once when a prompt arrives while idle', () => {
    anim.isAnimating.value.set(false);
    ws.pendingPrompt.set({ type: 'SELECT_CARD' });
    fixture.detectChanges();
    expect(ws.sendAnimationsDone).toHaveBeenCalledTimes(1);
  });

  it('fires after isAnimating flips true→false with a pending prompt (queue drained mid-flow)', () => {
    // Realistic flow: prompt arrives while orchestrator is still draining
    // the animation queue, then drain completes and isAnimating flips off.
    anim.isAnimating.value.set(true);
    ws.pendingPrompt.set({ type: 'SELECT_CARD' });
    fixture.detectChanges();
    expect(ws.sendAnimationsDone).not.toHaveBeenCalled();

    anim.isAnimating.value.set(false);
    fixture.detectChanges();
    expect(ws.sendAnimationsDone).toHaveBeenCalledTimes(1);
  });

  it('fires after pendingPrompt flips null→{prompt} while not animating (prompt arrives last)', () => {
    anim.isAnimating.value.set(false);
    ws.pendingPrompt.set(null);
    fixture.detectChanges();
    expect(ws.sendAnimationsDone).not.toHaveBeenCalled();

    ws.pendingPrompt.set({ type: 'SELECT_CARD' });
    fixture.detectChanges();
    expect(ws.sendAnimationsDone).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// C1.4 — Hand computation + chain badges + revealed cards merge
// =============================================================================

function makeHandCard(code: number): CardOnField {
  return {
    cardCode: code,
    name: `Card${code}`,
    position: POSITION.FACEDOWN_ATTACK,
    overlayMaterials: [],
    counters: {},
  };
}

function makeHandZone(cards: CardOnField[]): BoardZone {
  return { zoneId: 'HAND', cards };
}

/** Build a rendered DuelState with given hands for player 0 / player 1.
 *  We populate `renderedState` (not `logicalState`) because the playerHand /
 *  opponentHand computeds read renderedState — the lock-aware view. */
function makeStateWithHands(p0Hand: CardOnField[], p1Hand: CardOnField[]): DuelState {
  return {
    turnPlayer: 0,
    turnCount: 1,
    phase: 'MAIN1',
    players: [
      { lp: 8000, deckCount: 35, extraCount: 15, zones: [makeHandZone(p0Hand)] },
      { lp: 8000, deckCount: 35, extraCount: 15, zones: [makeHandZone(p1Hand)] },
    ],
  };
}

function makeChainLink(overrides: Partial<ChainLinkState>): ChainLinkState {
  return {
    chainIndex: 0,
    cardCode: 0,
    cardName: '',
    player: 0,
    zoneId: null,
    location: LOCATION.HAND,
    sequence: 0,
    resolving: false,
    negated: false,
    ...overrides,
  };
}

describe('DuelPageComponent — playerHand + chain badges + revealed merge (C1.4)', () => {
  let fixture: ComponentFixture<DuelPageComponent>;
  let component: DuelPageComponent;
  let ws: StubWsService;
  let anim: StubAnimationOrchestrator;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DuelPageComponent);
    component = fixture.componentInstance;
    ws = wsOf(fixture);
    anim = fixture.componentRef.injector.get(AnimationOrchestratorService) as unknown as StubAnimationOrchestrator;
  });

  it('playerHand() reads renderedState (not logicalState) so locks gate it', () => {
    // The renderedState is the lock-aware view: during chain animations,
    // logical may already show the post-state while rendered still shows
    // the pre-state. Reading playerHand from rendered keeps the visible
    // hand consistent with the animation timeline. Pin both reads to
    // make sure a refactor doesn't accidentally swap the source.
    const renderedHand = [makeHandCard(101), makeHandCard(102)];
    const logicalHand = [makeHandCard(999)];
    ws.setRendered(makeStateWithHands(renderedHand, []));
    ws.setLogical(makeStateWithHands(logicalHand, []));
    expect(component.playerHand()).toEqual(renderedHand);
    expect(component.playerHand().some(c => c.cardCode === 999)).toBe(false);
  });

  it('playerHand() returns [] when player[0] is missing in renderedState', () => {
    // Pre-init / hard-reset edge: renderedState carries `players: []` for a
    // tick. The getHandCards helper guards on `if (!player) return []`.
    ws.setRendered({ ...EMPTY_DUEL_STATE, players: [] as unknown as DuelState['players'] });
    expect(component.playerHand()).toEqual([]);
    expect(component.opponentHand()).toEqual([]);
  });

  it('playerHandChainBadges delegates to buildHandChainBadges (filtered to ownPlayerIndex)', () => {
    // ownPlayerIndex=0; chain has two HAND links, one for each player.
    // Only the link belonging to player 0 should produce a badge in
    // playerHandChainBadges. The badge value is chainIndex + 1.
    const p0Card = makeHandCard(701);
    const p1Card = makeHandCard(702);
    ws.setRendered(makeStateWithHands([p0Card], [p1Card]));
    ws.ocgPlayerIndex.set(0);
    ws.activeChainLinks.set([
      makeChainLink({ chainIndex: 0, cardCode: 701, player: 0, sequence: 0 }),
      makeChainLink({ chainIndex: 1, cardCode: 702, player: 1, sequence: 0 }),
    ]);
    ws.chainPhase.set('resolving');

    const badges = component.playerHandChainBadges();
    expect(badges.size).toBe(1);
    expect(badges.get(0)).toBe(1); // chainIndex 0 → badge "1"
  });

  it('opponentHandRevealedCards exposes the chain-derived reveal map', () => {
    // β.3 Lot 2.5 — `confirmRevealedCards` was an orphan signal (declared
    // since the 89b761c4 big-bang refacto, never wired to any setter).
    // The computed merged it over the chain-derived `revealed` Map; with
    // the orphan dropped, the computed is a direct alias of
    // `opponentHandChainData().revealed`. Pin the alias to catch a future
    // regression that reintroduces a parallel reveal source.
    const p1Card = makeHandCard(801);
    ws.setRendered(makeStateWithHands([], [p1Card]));
    ws.ocgPlayerIndex.set(0);
    ws.activeChainLinks.set([
      makeChainLink({ chainIndex: 0, cardCode: 801, player: 1, sequence: 0 }),
    ]);
    ws.chainPhase.set('resolving');

    const out = component.opponentHandRevealedCards();
    expect(out.size).toBe(1);
    expect(out.get(0)).toBe(801);
  });
});

// =============================================================================
// C1.5 — Bootstrap routing (fork / solo / pvp) + cleanup
// =============================================================================

/** Push a fake `history.state` for the duration of the next constructor
 *  run. Using `history.replaceState` is safe in headless tests — we never
 *  navigate the test URL. The previous state is restored after each test. */
function withHistoryState<T extends object>(state: T, fn: () => void): void {
  const prev = history.state;
  history.replaceState(state, '');
  try { fn(); } finally { history.replaceState(prev, ''); }
}

describe('DuelPageComponent — bootstrap routing + cleanup (C1.5)', () => {
  // The constructor branches on route+history+sessionStorage *at
  // createComponent time*. Each test sets up its preconditions, calls
  // setupTestBed with a tailored route, then creates the fixture. We
  // resist a shared beforeEach because the entire point is to pin
  // distinct bootstrap branches.

  afterEach(() => {
    // Clean any sessionStorage spillover from solo mode tests.
    try { sessionStorage.clear(); } catch { /* noop */ }
  });

  function pickSoloOrch(fixture: ComponentFixture<DuelPageComponent>): StubSoloOrchestrator {
    return fixture.componentRef.injector.get(SoloDuelOrchestratorService) as unknown as StubSoloOrchestrator;
  }
  function pickRoom(fixture: ComponentFixture<DuelPageComponent>): StubRoomStateMachine {
    return fixture.componentRef.injector.get(RoomStateMachineService) as unknown as StubRoomStateMachine;
  }
  function pickSoloEffects(fixture: ComponentFixture<DuelPageComponent>): NoopEffectsStub {
    return fixture.componentRef.injector.get(SoloModeEffectsService) as unknown as NoopEffectsStub;
  }
  function pickTabGuard(fixture: ComponentFixture<DuelPageComponent>): StubDuelTabGuard {
    return fixture.componentRef.injector.get(DuelTabGuardService) as unknown as StubDuelTabGuard;
  }

  it('fork mode + tokens in history.state → orchestrator.init + forceState("connecting") + initFork', () => {
    // Fork branch: replay viewer hits the "duplicate as solo" entry, the
    // tokens travel via history.state (set by router.navigate on the
    // replay page, never persisted to sessionStorage).
    setupTestBed(makeRouteStub({ roomCode: 'r1', query: { fork: 'true', replayId: 'abc', seekTo: '12' } }));
    withHistoryState({ wsToken1: 'tok1', wsToken2: 'tok2' }, () => {
      const fixture = TestBed.createComponent(DuelPageComponent);
      const orch = pickSoloOrch(fixture);
      const room = pickRoom(fixture);
      const soloEff = pickSoloEffects(fixture);

      // c6a — orchestrator.init() passe à 1 token (SOLO mono-connection).
      // Le fork garde 2 tokens server-side ; le wsToken2 n'est plus
      // consommé front mais reste validé en gate.
      expect(orch.init).toHaveBeenCalledOnceWith('tok1');
      expect(room.forceState).toHaveBeenCalledWith('connecting');
      expect(soloEff.initFork).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.forkReplayId).toBe('abc');
      expect(fixture.componentInstance.forkSeekTo).toBe(12);
    });
  });

  it('fork mode without tokens → notify.error + router.navigate(/pvp), no orchestrator.init', () => {
    // Missing tokens means the user reloaded the fork URL after losing the
    // history state — the constructor must surface SOLO_SESSION_EXPIRED
    // and bounce them to the lobby instead of attempting a connect.
    setupTestBed(makeRouteStub({ roomCode: 'r1', query: { fork: 'true' } }));
    withHistoryState({}, () => {
      const fixture = TestBed.createComponent(DuelPageComponent);
      const orch = pickSoloOrch(fixture);
      const notify = TestBed.inject(NotificationService) as unknown as StubNotification;
      const router = TestBed.inject(Router) as unknown as StubRouter;

      expect(notify.error).toHaveBeenCalledWith('error.SOLO_SESSION_EXPIRED');
      expect(router.navigate).toHaveBeenCalledWith(['/pvp']);
      expect(orch.init).not.toHaveBeenCalled();
    });
  });

  it('solo mode falls back to sessionStorage tokens when history.state is empty', () => {
    // After the very first navigation, F5 wipes history.state but the
    // sessionStorage entry persists. The component must read from there
    // so the duel survives reloads. Pin: tabGuard.init+broadcast and
    // orchestrator.init both fire with the stored tokens.
    // c6a — wsToken2 retiré du sessionStorage (SOLO mono-connection,
    // PR1 A6). Le sessionStorage ne porte plus que wsToken1+activePlayer+decklistId.
    sessionStorage.setItem('solo-duel-tokens-r2', JSON.stringify({
      wsToken1: 'stored-tok-1', activePlayer: 0, decklistId: 42,
    }));
    setupTestBed(makeRouteStub({ roomCode: 'r2', query: { solo: 'true' } }));
    withHistoryState({}, () => {
      const fixture = TestBed.createComponent(DuelPageComponent);
      const orch = pickSoloOrch(fixture);
      const tab = pickTabGuard(fixture);
      const room = pickRoom(fixture);

      expect(tab.init).toHaveBeenCalledOnceWith('r2');
      expect(tab.broadcast).toHaveBeenCalledTimes(1);
      expect(orch.init).toHaveBeenCalledOnceWith('stored-tok-1');
      expect(room.decklistId).toBe(42);
      expect(orch.switchPerspective).not.toHaveBeenCalled(); // restoredPlayer=0
    });
  });

  it('solo mode with stored activePlayer=1 → orchestrator.switchPerspective() called once', () => {
    // After a tab survives a switch-to-player-2 mid-duel, the
    // sessionStorage payload carries activePlayer=1. The component
    // restores it by re-running switchPerspective once after init.
    // (γ commit 3 renamed switchPlayer → switchPerspective.)
    sessionStorage.setItem('solo-duel-tokens-r3', JSON.stringify({
      wsToken1: 'tk1', activePlayer: 1, decklistId: null,
    }));
    setupTestBed(makeRouteStub({ roomCode: 'r3', query: { solo: 'true' } }));
    withHistoryState({}, () => {
      const fixture = TestBed.createComponent(DuelPageComponent);
      const orch = pickSoloOrch(fixture);
      expect(orch.switchPerspective).toHaveBeenCalledTimes(1);
    });
  });

  it('solo mode → destroy callback removes the solo-duel-tokens-* sessionStorage entry', () => {
    // The cleanup invariant: when the component is destroyed (route change,
    // navigate-away, hot-reload), the per-room solo-duel-tokens entry
    // must be removed so the next navigation re-uses fresh tokens
    // instead of replaying a stale duel. This is the only place the
    // entry is removed; if a refactor moves it elsewhere by mistake,
    // duels would resume with the wrong tokens after lobby round-trips.
    sessionStorage.setItem('solo-duel-tokens-r4', JSON.stringify({
      wsToken1: 'tk1', activePlayer: 0, decklistId: null,
    }));
    setupTestBed(makeRouteStub({ roomCode: 'r4', query: { solo: 'true' } }));
    withHistoryState({}, () => {
      const fixture = TestBed.createComponent(DuelPageComponent);
      // The init wrote the canonical entry — confirm the precondition.
      expect(sessionStorage.getItem('solo-duel-tokens-r4')).not.toBeNull();
      fixture.destroy();
      expect(sessionStorage.getItem('solo-duel-tokens-r4')).toBeNull();
    });
  });
});

// =============================================================================
// C1.6 — <app-pvp-dice-arena> wrapper bindings vs roomState
// =============================================================================
//
// Pins the truth table encoded inline in duel-page.component.html: the
// `@if` gate (4 states) plus the `[preparing]` and `[holdFinal]` input
// expressions. A regression here re-introduces either the "PRÉPARATION
// DU DUEL…" flash (if `creating-duel` or `connecting` drops out of the
// gate) or the dice→empty-board flash (if `duel-loading` drops out, or
// if `holdFinal` no longer holds through it).

/** Capture-only stub that mirrors the real dice arena's selector +
 *  input signature. The spec reads each `InputSignal` after
 *  `detectChanges()` to assert what the wrapper bound. */
@Component({
  selector: 'app-pvp-dice-arena',
  standalone: true,
  template: '',
})
class StubDiceArenaComponent {
  readonly preparing = input<boolean>(false);
  readonly holdFinal = input<boolean>(false);
}

describe('DuelPageComponent — dice-arena wrapper bindings (C1.6)', () => {
  let fixture: ComponentFixture<DuelPageComponent>;
  let room: StubRoomStateMachine;

  // Truth table the template encodes. `null` for the arena entry means
  // the @if gate is false (arena is not rendered).
  type RS = 'loading' | 'waiting' | 'creating-duel' | 'connecting' | 'duel-loading' | 'active' | 'error';
  const TABLE: ReadonlyArray<readonly [RS, { preparing: boolean; holdFinal: boolean } | null]> = [
    ['loading',        null],
    ['waiting',        null],
    ['error',          null],
    ['creating-duel',  { preparing: true,  holdFinal: true  }],
    ['connecting',     { preparing: true,  holdFinal: true  }],
    ['duel-loading',   { preparing: false, holdFinal: true  }],
    ['active',         { preparing: false, holdFinal: false }],
  ];

  beforeEach(() => {
    setupTestBed();
    // Re-override the component to install (a) the stub dice-arena in
    // `imports`, and (b) a minimal template containing only the arena
    // block we want to pin. `overrideComponent` forbids mixing `set`
    // with `add`/`remove` in one call, so split into two consecutive
    // overrides — each call merges by key into the accumulated override
    // (the `providers` set by `setupTestBed` survives).
    TestBed.overrideComponent(DuelPageComponent, {
      remove: { imports: [PvpDiceArenaComponent] },
      add: { imports: [StubDiceArenaComponent] },
    });
    TestBed.overrideComponent(DuelPageComponent, {
      set: {
        // Minimal template — only the arena block we want to pin. Other
        // top-level @if branches (waiting room, error page, board) are
        // omitted so unrelated bindings can't trip on the stub graph.
        template: `
          @if (roomState() === 'creating-duel' || roomState() === 'connecting' || roomState() === 'duel-loading' || roomState() === 'active') {
            <app-pvp-dice-arena
              [preparing]="roomState() === 'creating-duel' || roomState() === 'connecting'"
              [holdFinal]="roomState() !== 'active'" />
          }
        `,
      },
    });
    withHistoryState({}, () => {
      fixture = TestBed.createComponent(DuelPageComponent);
      room = fixture.componentRef.injector.get(RoomStateMachineService) as unknown as StubRoomStateMachine;
    });
  });

  /** Locate the rendered stub instance (or null if the @if gate is off). */
  function getStubArena(): StubDiceArenaComponent | null {
    const debugEl = fixture.debugElement.query(
      (el) => el.componentInstance instanceof StubDiceArenaComponent,
    );
    return debugEl ? (debugEl.componentInstance as StubDiceArenaComponent) : null;
  }

  for (const [state, expected] of TABLE) {
    it(`roomState='${state}' → ${expected === null ? 'arena hidden' : `preparing=${expected.preparing}, holdFinal=${expected.holdFinal}`}`, () => {
      room.roomState.set(state);
      fixture.detectChanges();
      const arena = getStubArena();
      if (expected === null) {
        expect(arena).toBeNull();
      } else {
        expect(arena).not.toBeNull();
        expect(arena!.preparing()).toBe(expected.preparing);
        expect(arena!.holdFinal()).toBe(expected.holdFinal);
      }
    });
  }

  it('transitioning creating-duel → connecting → duel-loading → active keeps holdFinal latched until active', () => {
    // The whole point of `holdFinal` is to hold the arena's final stage
    // visible across the duel-loading window. This sequence pins that:
    // holdFinal stays true through the first three states and only drops
    // when we land on 'active'.
    const sequence: ReadonlyArray<readonly [RS, boolean]> = [
      ['creating-duel', true],
      ['connecting',    true],
      ['duel-loading',  true],
      ['active',        false],
    ];
    for (const [state, expectedHoldFinal] of sequence) {
      room.roomState.set(state);
      fixture.detectChanges();
      const arena = getStubArena();
      expect(arena).not.toBeNull();
      expect(arena!.holdFinal()).toBe(expectedHoldFinal);
    }
  });
});

describe('DuelPageComponent — rematch re-enters the dice flow (C1.7)', () => {
  let fixture: ComponentFixture<DuelPageComponent>;
  let component: DuelPageComponent;
  let ws: StubWsService;
  let room: StubRoomStateMachine;

  beforeEach(() => {
    setupTestBed();
    fixture = TestBed.createComponent(DuelPageComponent);
    component = fixture.componentInstance;
    ws = wsOf(fixture);
    room = fixture.componentRef.injector.get(RoomStateMachineService) as unknown as StubRoomStateMachine;
    fixture.detectChanges(); // flush constructor effects once
    room.forceState.calls.reset();
  });

  it('PvP: REMATCH_STARTING pulls the room back to connecting (dice arena shows)', () => {
    ws.rematchStarting.set(true);
    fixture.detectChanges();
    expect(room.forceState).toHaveBeenCalledWith('connecting');
  });

  it('Solo: REMATCH_STARTING does NOT pull the room to connecting (no dice flow)', () => {
    (component.isSoloMode as WritableSignal<boolean>).set(true);
    ws.rematchStarting.set(true);
    fixture.detectChanges();
    expect(room.forceState).not.toHaveBeenCalledWith('connecting');
  });
});
