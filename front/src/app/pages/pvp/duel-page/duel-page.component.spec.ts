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

import { Component, signal, WritableSignal, Signal, computed } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';

import { DuelPageComponent } from './duel-page.component';
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
import type { DuelState } from '../types';
import type { TimerStateMsg, BoardStatePayload, PlayerBoardState } from '../duel-ws.types';

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
    hasLockedZones: signal(false).asReadonly(),
  };
  setLogical(s: DuelState): void { this._logical.set(s); }
  setRendered(s: DuelState): void { this._rendered.set(s); }

  // Direct signal surface read by the component + by PromptDerivationService.
  readonly pendingPrompt = signal<unknown>(null);
  readonly hintContext = signal({ hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' });
  readonly animationQueue = signal<readonly unknown[]>([]);
  readonly timerState = signal<TimerStateMsg | null>(null);
  readonly timerStatePerPlayer = signal<readonly [TimerStateMsg | null, TimerStateMsg | null]>([null, null]);
  readonly connectionStatus = signal<'connecting' | 'connected' | 'lost' | 'reconnecting'>('connected');
  readonly protocolMismatch = signal(false);
  readonly opponentDisconnected = signal(false);
  readonly disconnectGraceSec = signal(0);
  readonly activeChainLinks = signal<readonly unknown[]>([]);
  readonly chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  readonly duelResult = signal<{ winner: number | null; reason: string } | null>(null);
  readonly rpsResult = signal<unknown>(null);
  readonly rpsInProgress = signal(false);
  readonly ocgPlayerIndex = signal<number | null>(0);
  readonly cardCodes = signal<readonly number[]>([]);
  readonly rematchState = signal<'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired'>('idle');
  readonly rematchStarting = signal(false);
  readonly inactivityWarning = signal<unknown>(null);
  readonly waitingForOpponent = signal(false);
  readonly tpResult = signal<{ goFirst: boolean } | null>(null);
  readonly tpResponseSent = signal(false);
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
  clearRpsResult = jasmine.createSpy('clearRpsResult');
  connect = jasmine.createSpy('connect');
  destroy = jasmine.createSpy('destroy');
  ngOnDestroy = jasmine.createSpy('ngOnDestroy');

  onStateSync?: () => void;
}

/** Generic no-op stub for *EffectsService classes — `initEffects` is the
 *  only consumed surface; we intentionally do nothing. */
class NoopEffectsStub {
  initEffects(): void { /* no-op */ }
  initSolo(): void { /* no-op */ }
  initFork(): void { /* no-op */ }
  silenceCurrentPhase(): void { /* no-op */ }
  markAwaitingStateSync(): void { /* no-op */ }
  clear(): void { /* no-op */ }
}

/** Stub for AnimationOrchestratorService — only the few signals/methods the
 *  component reads/calls. Component owns no animation logic itself. */
class StubAnimationOrchestrator {
  readonly isAnimating = signal(false);
  readonly animatingZone = signal<unknown>(null);
  readonly confirmRevealedCards = signal<Map<number, number>>(new Map());
  readonly lpTracker = { animatingLpPlayer: signal<number | null>(null) };
  destroy = jasmine.createSpy('destroy');
  onStateSync = jasmine.createSpy('onStateSync');
}

/** Stub for SoloDuelOrchestratorService. */
class StubSoloOrchestrator {
  readonly connections = signal<readonly { timerStatePerPlayer: () => readonly [TimerStateMsg | null, TimerStateMsg | null] }[] | null>(null);
  readonly activePlayerIndex = signal(0);
  init = jasmine.createSpy('init');
  switchPlayer = jasmine.createSpy('switchPlayer');
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
        { provide: SoloDuelOrchestratorService, useClass: StubSoloOrchestrator },
        { provide: PhaseAnnouncementService, useClass: StubPhaseAnnouncementService },
        { provide: DuelToastService, useValue: {} },
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

  it('boardReady() is false when both players exist but player[0].lp === 0', () => {
    // Seed shape: 2 players present but LP not yet populated (the server
    // sends LP only on the first BOARD_STATE; the gate prevents flashing
    // the board before that). A refactor that loosens the check to `>= 0`
    // would silently flip this gate.
    ws.setLogical(makeState(0, 8000));
    expect(component.boardReady()).toBe(false);
  });

  it('boardReady() is true once player[0].lp > 0 (post first BOARD_STATE)', () => {
    ws.setLogical(makeState(8000, 8000));
    expect(component.boardReady()).toBe(true);
  });

  it('duelLoadingReady() is false while boardReady=true but thumbnailsReady=false', () => {
    ws.setLogical(makeState(8000, 8000));
    component.thumbnailsReady.set(false);
    expect(component.boardReady()).toBe(true);
    expect(component.duelLoadingReady()).toBe(false);
  });

  it('duelLoadingReady() is true only when both boardReady and thumbnailsReady', () => {
    ws.setLogical(makeState(8000, 8000));
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

  it('Solo + connections=null falls back to top-level timerState() (during init)', () => {
    const fallback = makeTimer('solo-fallback');
    ws.timerState.set(fallback);
    (component.isSoloMode as WritableSignal<boolean>).set(true);
    solo.connections.set(null);
    expect(component.displayedTimerState()).toBe(fallback);
  });

  it('Solo + activePlayerIndex=1 reads connections[1].timerStatePerPlayer()[1]', () => {
    // After switchPlayer(), the active connection is index 1 and its own
    // timer pool is at index 1 (server broadcasts both pools to each
    // connection). The active connection's pool — not the previous
    // active one — drives the displayed timer.
    const t0own = makeTimer('conn0-own');
    const t1own = makeTimer('conn1-own');
    const conn0 = makeConnection(t0own, makeTimer('conn0-opp'));
    const conn1 = makeConnection(makeTimer('conn1-opp'), t1own);
    (component.isSoloMode as WritableSignal<boolean>).set(true);
    solo.connections.set([conn0, conn1] as unknown as ReturnType<typeof solo.connections>);
    solo.activePlayerIndex.set(1);
    expect(component.displayedTimerState()).toBe(t1own);
  });
});
