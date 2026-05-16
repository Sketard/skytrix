import {
  ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, isDevMode, OnDestroy, OnInit, signal, untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { TranslateService, TranslateModule } from '@ngx-translate/core';

import { ReplayConnectionService } from './replay-connection.service';
import { ReplayForkService } from './replay-fork.service';
import { ReplayDuelAdapter } from './replay-duel-adapter';
import { ReplayTransportService } from './replay-transport.service';
import { TimelineBarComponent, type ZoomLevel } from './timeline-bar/timeline-bar.component';
import { TransportBarComponent } from './transport-bar/transport-bar.component';
import { TimelineStepperComponent } from './timeline-stepper/timeline-stepper.component';
import { buildSubEventSegments, type TimelineSegment } from './timeline-bar/timeline-bar.component';
import { TurnPickerSheetComponent } from './turn-picker-sheet/turn-picker-sheet.component';
import { ReplayTopbarComponent } from './topbar/replay-topbar.component';
import { ReplayLoadingSkeletonComponent } from './loading-skeleton/replay-loading-skeleton.component';
import { ReplayEndOverlayComponent } from './end-overlay/replay-end-overlay.component';
import { ReplayCheatSheetComponent } from './cheat-sheet/replay-cheat-sheet.component';
import { ReplayBottomSheetComponent } from './bottom-sheet/replay-bottom-sheet.component';
import { BoardSwipeNavigatorDirective } from './board-swipe-navigator.directive';
import { deriveOutcome, type ReplayOutcome } from './replay-outcome.util';
import type { ReplayMetadataMsg } from '../duel-ws-replay.types';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { OrientationLockComponent } from '../../../shared/orientation-lock/orientation-lock.component';
import { CURRENT_USER_KEY } from '../../../core/utilities/auth.constants';
import { EMPTY_ZONE_SET, EMPTY_STRING_SET, EMPTY_ARRAY } from '../types';
import type { DuelState } from '../types';
import type { PreComputedState, TurnMeta } from '../replay-ws.types';
import { DebugLogPanelComponent } from '../duel-page/debug-log-panel/debug-log-panel.component';
import { buildReplayLogEntries } from '../duel-page/debug-log-formatter';
import type { CardOnField, SelectPlaceMsg, SelectDisfieldMsg, PlaceOption, ZoneId } from '../duel-ws.types';
import { buildFaceDownZoneKeys, preloadCardImages } from '../pvp-card.utils';
import { buildHandChainBadges, buildOpponentHandChainData } from '../duel-page/chain-badge.utils';
import type { Player } from '../duel-ws.types';
import { locationToZoneId, getZonePillCards } from '../pvp-zone.utils';
import { PvpBoardContainerComponent } from '../duel-page/pvp-board-container/pvp-board-container.component';
import { PvpHandRowComponent } from '../duel-page/pvp-hand-row/pvp-hand-row.component';
import { PvpCardInspectorWrapperComponent } from '../duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component';
import { PvpZoneBrowserOverlayComponent } from '../duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component';
import { CardDataCacheService } from '../duel-page/card-data-cache.service';
import { CardInspectionService } from '../duel-page/card-inspection.service';
import { CardTravelEngine } from '../duel-page/card-travel-engine.service';
import { BoardEffectsService } from '../duel-page/board-effects.service';
import { FloatRegistryService } from '../duel-page/float-registry.service';
import { DuelCardArtService } from '../duel-page/duel-card-art.service';
import { DebugLogService } from '../duel-page/debug-log.service';
import { DuelWebSocketService } from '../duel-page/duel-web-socket.service';
import { AnimationOrchestratorService } from '../duel-page/animation-orchestrator.service';
import { PhaseAnnouncementService } from '../duel-page/phase-announcement.service';
import { DuelToastService } from '../duel-page/duel-toast.service';
import { ANIMATION_DATA_SOURCE } from '../duel-page/animation-data-source';
import { DuelContext } from '../duel-page/duel-context';
import { DuelLogger } from '../duel-page/duel-logger';
import { BattleAnimationTracker } from '../duel-page/battle-animation-tracker';
import { LpAnimationTracker } from '../duel-page/lp-animation-tracker';
import { ChainResolutionManager } from '../duel-page/chain-resolution-manager';
import { DrawSequenceManager } from '../duel-page/draw-sequence-manager';
import { MoveAnimationRouter } from '../duel-page/move-animation-router';
import { TargetIndicatorManager } from '../duel-page/target-indicator-manager';
import { BufferReplayBuilder } from '../duel-page/buffer-replay-builder';
import { PvpChainOverlayComponent } from '../duel-page/pvp-chain-overlay/pvp-chain-overlay.component';
import { PvpDuelOverlaysComponent } from '../duel-page/pvp-duel-overlays/pvp-duel-overlays.component';
import { PvpPromptDialogComponent } from '../duel-page/prompts/pvp-prompt-dialog/pvp-prompt-dialog.component';

@Component({
  selector: 'app-replay-page',
  templateUrl: './replay-page.component.html',
  styleUrl: './replay-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    ReplayConnectionService, ReplayForkService, ReplayTransportService,
    CardDataCacheService, CardInspectionService, CardTravelEngine, BoardEffectsService, FloatRegistryService, DuelCardArtService,
    DuelLogger, LpAnimationTracker, BattleAnimationTracker, DuelContext,
    ChainResolutionManager, DrawSequenceManager, MoveAnimationRouter, BufferReplayBuilder, TargetIndicatorManager,
    ReplayDuelAdapter, AnimationOrchestratorService, PhaseAnnouncementService, DuelToastService,
    DebugLogService,
    DuelWebSocketService, // Required by PvpPromptDialogComponent
    { provide: ANIMATION_DATA_SOURCE, useExisting: ReplayDuelAdapter },
  ],
  imports: [
    PvpBoardContainerComponent, PvpHandRowComponent, PvpCardInspectorWrapperComponent,
    PvpZoneBrowserOverlayComponent,
    TimelineBarComponent, TransportBarComponent, DebugLogPanelComponent,
    PvpPromptDialogComponent, PvpChainOverlayComponent, PvpDuelOverlaysComponent,
    OrientationLockComponent,
    ReplayTopbarComponent, ReplayLoadingSkeletonComponent,
    ReplayEndOverlayComponent, ReplayCheatSheetComponent, ReplayBottomSheetComponent,
    TimelineStepperComponent, TurnPickerSheetComponent,
    BoardSwipeNavigatorDirective,
    NgTemplateOutlet,
    TranslateModule,
  ],
  host: {
    '[class.is-narrow]': 'isNarrow()',
  },
})
export class ReplayPageComponent implements OnInit, OnDestroy {
  readonly replayConnection = inject(ReplayConnectionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly authService = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly cardDataCache = inject(CardDataCacheService);
  private readonly cardInspection = inject(CardInspectionService);
  private readonly cardTravel = inject(CardTravelEngine);
  private readonly injector = inject(Injector);
  private readonly elementRef = inject(ElementRef);
  private readonly duelCtx = inject(DuelContext);
  private readonly duelLogger = inject(DuelLogger);
  readonly adapter = inject(ReplayDuelAdapter);
  readonly orchestrator = inject(AnimationOrchestratorService);
  readonly chainManager = inject(ChainResolutionManager);
  readonly drawManager = inject(DrawSequenceManager);
  readonly lpTracker = inject(LpAnimationTracker);
  readonly phaseService = inject(PhaseAnnouncementService);
  readonly toastService = inject(DuelToastService);
  readonly fork = inject(ReplayForkService);
  readonly transport = inject(ReplayTransportService);

  // Transport state — owned by ReplayTransportService, re-exposed for the template (audit M10).
  readonly currentIndex = this.transport.currentIndex;
  readonly isPlaying = this.transport.isPlaying;
  readonly pausedAtBoundary = this.transport.pausedAtBoundary;

  readonly debugPanelOpen = signal(false);

  /** 'decision' = pause on prompts, 'result' = skip prompts */
  readonly promptMode = signal<'result' | 'decision'>(
    localStorage.getItem(ReplayPageComponent.PREF_PROMPT_MODE) === 'result' ? 'result' : 'decision',
  );
  /** Debug log detail level (toggled via G key) */
  readonly logDetail = signal<'normal' | 'debug'>(isDevMode() ? 'debug' : 'normal');
  /** Perspective: 0 = player 1, 1 = player 2 */
  readonly perspectiveIndex = signal<Player>(
    localStorage.getItem(ReplayPageComponent.PREF_PERSPECTIVE) === '1' ? 1 : 0,
  );

  private static readonly PREF_ANIMATIONS = 'replay.animationsEnabled';
  private static readonly PREF_PROMPT_MODE = 'replay.promptMode';
  private static readonly PREF_PERSPECTIVE = 'replay.perspectiveIndex';
  private static readonly PREF_ZOOM_LEVEL  = 'replay.zoomLevel';
  private static readonly NARROW_BREAKPOINT_PX = 760; // D1
  readonly animationsEnabled = signal(localStorage.getItem(ReplayPageComponent.PREF_ANIMATIONS) === 'true');

  // F4 overlay + bottom-sheet open state (uniquely managed at the page level
  // so the keyboard handler + swipe directive can stay in sync).
  readonly cheatSheetOpen = signal(false);
  readonly pickerOpen     = signal(false);
  readonly optionsOpen    = signal(false);
  readonly detailsOpen    = signal(false);
  readonly copyJustSucceeded = signal(false);
  /** Swipe feedback (D6 mockup — board-area swipe-flash gold edge + hint banner).
   *  `swipeFlash` carries the active direction for ~250ms, `swipeHintVisible`
   *  is true at mount on narrow viewports then fades after 3s or first swipe. */
  readonly swipeFlash = signal<'left' | 'right' | null>(null);
  readonly swipeHintVisible = signal(false);
  private swipeFlashTimer: ReturnType<typeof setTimeout> | null = null;
  private swipeHintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Zoom state lifted from `TimelineBarComponent` (D21). Persisted via localStorage. */
  readonly zoomLevel = signal<ZoomLevel>(this.restoreZoomLevel());
  /** True when the viewport is `<= NARROW_BREAKPOINT_PX` — toggled by a
   *  `matchMedia('(max-width: 759px)')` listener (mobile-first inversion of D1). */
  readonly isNarrow = signal(window.matchMedia(`(max-width: ${ReplayPageComponent.NARROW_BREAKPOINT_PX - 1}px)`).matches);
  private narrowMql: MediaQueryList | null = null;
  private narrowMqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

  readonly boardStates = computed(() => {
    const live = this.replayConnection.boardStates();
    return live.length > 0 ? live : this.fork.cachedBoardStates();
  });
  readonly computedUpTo = computed(() => this.replayConnection.computedUpTo());

  readonly turns = computed<TurnMeta[]>(() => {
    const states = this.boardStates();
    if (states.length === 0) return [];
    const result: TurnMeta[] = [];
    let currentTurn = states[0].boardState.turnCount;
    let startIdx = 0;
    const pushTurn = (endIdx: number) => {
      const first = states[startIdx].boardState;
      result.push({
        turnNumber: currentTurn,
        startIndex: startIdx,
        endIndex: endIdx,
        p1LP: first.players[0]?.lp ?? 8000,
        p2LP: first.players[1]?.lp ?? 8000,
        eventCount: endIdx - startIdx + 1,
      });
    };
    for (let i = 1; i < states.length; i++) {
      if (states[i].boardState.turnCount !== currentTurn) {
        pushTurn(i - 1);
        currentTurn = states[i].boardState.turnCount;
        startIdx = i;
      }
    }
    pushTurn(states.length - 1);
    return result;
  });

  readonly totalEvents = computed(() => this.boardStates().length);
  readonly atEnd = computed(() => {
    const upTo = this.computedUpTo();
    return upTo > 0 && this.currentIndex() >= upTo;
  });
  readonly currentState = computed<PreComputedState | null>(() => this.boardStates()[this.currentIndex()] ?? null);
  readonly debugLogEntries = computed(() => buildReplayLogEntries(this.boardStates(), this.logDetail()));

  /** Duel state for display — the adapter's RBS is already perspective-relative
   *  (swapBoardState applied on every updateLogical), so no swap needed here. */
  readonly activeDuelState = computed<DuelState>(() =>
    this.adapter.boardStateView.renderedState(),
  );

  /** Eligible zones for the active SELECT_PLACE/SELECT_DISFIELD decision (zone keys with player suffix). */
  readonly replayHighlightedZones = computed<ReadonlySet<string>>(() => {
    const prompt = this.adapter.activePrompt();
    if (prompt?.type !== 'SELECT_PLACE' && prompt?.type !== 'SELECT_DISFIELD') return EMPTY_ZONE_SET;
    const places = (prompt as SelectPlaceMsg | SelectDisfieldMsg).places;
    const perspective = this.perspectiveIndex();
    const keys = places
      .map((pl: PlaceOption) => {
        const zoneId = locationToZoneId(pl.location, pl.sequence);
        const relPlayer = pl.player === perspective ? 0 : 1;
        return zoneId ? `${zoneId}-${relPlayer}` : null;
      })
      .filter((k): k is string => k !== null);
    return new Set(keys);
  });

  /** The zone key that was actually chosen in the active decision. */
  readonly replayChosenZone = computed<string | null>(() => {
    const prompt = this.adapter.activePrompt();
    if (prompt?.type !== 'SELECT_PLACE' && prompt?.type !== 'SELECT_DISFIELD') return null;
    const resp = this.adapter.activeResponse() as { places?: PlaceOption[] } | null;
    const place = resp?.places?.[0];
    if (!place) return null;
    const zoneId = locationToZoneId(place.location, place.sequence);
    const relPlayer = place.player === this.perspectiveIndex() ? 0 : 1;
    return zoneId ? `${zoneId}-${relPlayer}` : null;
  });

  /** Perspective-adjusted turnPlayer for displayedTurnPlayer (0=me, 1=opponent). */
  readonly replayDisplayedTurnPlayer = computed<Player | null>(() => {
    const tp = this.currentState()?.boardState?.turnPlayer;
    if (tp == null) return null;
    if (this.perspectiveIndex() === 0) return tp as Player;
    return (tp === 0 ? 1 : 0) as Player;
  });

  /**
   * The skeleton stays visible while:
   *  - no precomputed states are available yet, OR
   *  - the first state has arrived BUT the adapter hasn't jumped to it yet
   *    (rendered hand still empty by structural check, audit L16 pattern).
   *
   * Without the second clause the skeleton flips off as soon as the first
   * REPLAY_BOARD_STATES chunk lands, exposing a half-rendered board (cards
   * stacked in the bottom-left corner because the hand-row hasn't received
   * its data yet). Gating on the adapter's rendered state ensures the
   * board is paint-ready before we swap the skeleton for the duel UI.
   *
   * Hidden when an error is shown — the error toast/banner replaces both.
   */
  readonly loading = computed(() => {
    if (this.replayConnection.error()) return false;
    if (this.boardStates().length === 0) return true;
    return this.adapter.boardStateView.renderedState().players[0].zones.length === 0;
  });

  /** Index of the current turn inside `turns()` — used by stepper + picker. */
  readonly currentTurnIndex = computed<number>(() => {
    const idx = this.currentIndex();
    const turns = this.turns();
    const found = turns.findIndex(t => idx >= t.startIndex && idx <= t.endIndex);
    return found === -1 ? 0 : found;
  });

  /** Local auth user side (0 = player 1, 1 = player 2) inside this replay.
   *  Used by `<app-replay-topbar>` to derive the outcome from the (perspective-
   *  independent) metadata.result. */
  readonly mySide = computed<0 | 1>(() => {
    const meta = this.replayConnection.metadata() as ReplayMetadataMsg | null;
    if (!meta) return 0;
    const userPseudo = this.authService.user()?.pseudo;
    if (!userPseudo) return 0;
    return meta.playerUsernames[1] === userPseudo ? 1 : 0;
  });

  /** Composed pieces of the transport-bar context zone (D9). Split into four
   *  pieces so each can be hidden independently (D13 cascade). */
  readonly turnLabelText = computed<string>(() => {
    const state = this.currentState();
    if (!state) return '';
    const bs = state.boardState;
    if (bs.turnCount === 0) return this.translate.instant('replay.timeline.setup');
    const total = this.turns().length;
    return this.translate.instant('replay.timeline.turn', { n: bs.turnCount }) + (total > 0 ? ` / ${total}` : '');
  });

  readonly playerPositionLabel = computed<string | null>(() => {
    const tp = this.currentState()?.boardState?.turnPlayer;
    if (tp == null) return null;
    return `P${tp + 1}`;
  });

  readonly phaseLabel = computed<string | null>(() => {
    const phase = this.currentState()?.boardState?.phase;
    if (!phase) return null;
    return this.phaseService.phaseDisplayName(phase);
  });

  readonly eventLabel = computed<string | null>(() => this.currentState()?.label ?? null);

  /** Display name of the currently-perspective-active player (shown on the
   *  perspective swap button). */
  readonly perspectiveName = computed<string>(() => {
    const meta = this.replayConnection.metadata() as ReplayMetadataMsg | null;
    return meta?.playerUsernames?.[this.perspectiveIndex()] ?? '';
  });

  /** Drives the gold dot indicator on the mobile `⋯ More` button — true when
   *  any visionnage option is set to a non-default value. */
  readonly hasNonDefaultOption = computed<boolean>(() =>
    this.animationsEnabled() !== false
    || this.promptMode() !== 'decision'
    || this.perspectiveIndex() !== 0,
  );

  /** End-overlay view model — null while the replay isn't over OR metadata is
   *  missing. Mapping done via D19 `deriveOutcome`. */
  readonly endOverlayState = computed<{
    outcome: ReplayOutcome; selfLp: number; oppLp: number; selfName: string; oppName: string;
    turnCount: number; durationSec: number | null;
  } | null>(() => {
    if (!this.atEnd()) return null;
    const meta = this.replayConnection.metadata() as ReplayMetadataMsg | null;
    if (!meta) return null;
    const lastState = this.boardStates()[this.computedUpTo()];
    if (!lastState) return null;
    const side = this.mySide();
    const outcome = deriveOutcome(meta.result, side);
    return {
      outcome,
      selfLp: lastState.boardState.players[side]?.lp ?? 0,
      oppLp:  lastState.boardState.players[side === 0 ? 1 : 0]?.lp ?? 0,
      selfName: meta.playerUsernames[side] ?? '',
      oppName:  meta.playerUsernames[side === 0 ? 1 : 0] ?? '',
      turnCount: meta.turnCount,
      durationSec: meta.durationSec ?? null,
    };
  });

  /** Whether the `BoardSwipeNavigator` should be muted (a sheet/overlay is
   *  consuming touches). */
  readonly swipeDisabled = computed<boolean>(() =>
    this.pickerOpen() || this.optionsOpen() || this.detailsOpen()
    || this.cheatSheetOpen() || this.endOverlayState() != null,
  );

  /** Sub-event bullets of the CURRENT turn, fed to `<app-timeline-stepper>`
   *  on narrow viewports. Shares `buildSubEventSegments` with the desktop
   *  timeline-bar so hidden-label policy stays in one place. */
  readonly currentTurnSubEvents = computed<readonly TimelineSegment[]>(() => {
    const turn = this.turns()[this.currentTurnIndex()];
    if (!turn) return [];
    return buildSubEventSegments(turn, this.boardStates());
  });

  readonly playerHand = computed<CardOnField[]>(() =>
    this.getHandCards(this.activeDuelState(), 0)
  );
  readonly opponentHand = computed<CardOnField[]>(() =>
    this.getHandCards(this.activeDuelState(), 1)
  );

  readonly playerHandChainBadges = computed(() =>
    buildHandChainBadges(this.adapter.activeChainLinks(), this.perspectiveIndex(), this.adapter.chainPhase(), this.playerHand()),
  );
  private readonly opponentHandChainData = computed(() =>
    buildOpponentHandChainData(this.adapter.activeChainLinks(), this.perspectiveIndex(), this.adapter.chainPhase(), this.opponentHand()),
  );
  readonly opponentHandChainBadges = computed(() => this.opponentHandChainData().badges);

  // Revealed zone keys — face-down cards on the board (memoized to avoid unnecessary CD)
  private prevRevealedKeys: ReadonlySet<string> = EMPTY_STRING_SET;
  readonly revealedZoneKeys = computed<ReadonlySet<string>>(() => {
    const keys = buildFaceDownZoneKeys(this.activeDuelState().players, [0, 1]);
    return this.prevRevealedKeys = this.memoizeSet(this.prevRevealedKeys, keys);
  });

  // Opponent hand revealed card codes (memoized to avoid unnecessary CD)
  private prevRevealedCodes = new Map<number, number>();
  readonly opponentHandRevealedCodes = computed<Map<number, number>>(() => {
    const state = this.activeDuelState();
    const player = state.players[1];
    if (!player) return this.prevRevealedCodes = this.memoizeMap(this.prevRevealedCodes, new Map());
    const handZone = player.zones.find(z => z.zoneId === 'HAND');
    if (!handZone) return this.prevRevealedCodes = this.memoizeMap(this.prevRevealedCodes, new Map());
    const map = new Map<number, number>();
    handZone.cards.forEach((card, i) => {
      if (card?.cardCode) {
        map.set(i, card.cardCode);
      }
    });
    return this.prevRevealedCodes = this.memoizeMap(this.prevRevealedCodes, map);
  });

  // Zone browser state (read-only in replay)
  private zoneBrowserOpenId = 0;
  readonly zoneBrowserState = signal<{
    zoneId: ZoneId;
    cards: CardOnField[];
    playerIndex: number;
    openId: number;
  } | null>(null);

  readonly inspectedCard = this.cardInspection.inspectedCard;
  readonly inspectorForceExpanded = this.cardInspection.inspectorForceExpanded;

  readonly emptySet = EMPTY_ZONE_SET;
  readonly emptyStringSet = EMPTY_STRING_SET;
  readonly emptyArray = EMPTY_ARRAY;

  private hasConnected = false;

  // Phase announcement tracking
  private lastAnnouncedPhase: string | null = null;

  // F4 — clear copyJustSucceeded after 1.5s so .btn--success-flash flips off.
  private copyFlashTimer: ReturnType<typeof setTimeout> | null = null;

  private restoreZoomLevel(): ZoomLevel {
    const raw = localStorage.getItem(ReplayPageComponent.PREF_ZOOM_LEVEL);
    const parsed = raw ? Number.parseInt(raw, 10) : 1;
    return (parsed === 2 || parsed === 3) ? (parsed as ZoomLevel) : 1;
  }

  constructor() {
    this.cardInspection.init(this.cardDataCache);
    this.cardTravel.registerContainer(this.elementRef.nativeElement);
    this.transport.configure({
      adapter: this.adapter,
      phaseService: this.phaseService,
      boardStates: this.boardStates,
      computedUpTo: this.computedUpTo,
      animationsEnabled: this.animationsEnabled,
      promptMode: this.promptMode,
    });

    effect(() => {
      const meta = this.replayConnection.metadata();
      if (meta?.divergenceWarning) {
        this.notify.error('replay.viewer.divergenceWarning');
      }
    });

    effect(() => {
      const err = this.replayConnection.error();
      if (err) {
        this.notify.error(err);
        this.router.navigate(['/pvp/history']);
      }
    });

    effect(() => {
      const status = this.replayConnection.connectionStatus();
      if (status === 'connected') {
        this.hasConnected = true;
      }
      if (status === 'disconnected' && this.hasConnected && this.replayConnection.forkStatus() === 'idle') {
        this.notify.error('replay.viewer.connectionLost');
      }
    });

    // Auto-resume when computedUpTo increases after boundary pause
    effect(() => {
      // Subscribe to both signals so the effect re-fires on either change.
      this.computedUpTo();
      this.pausedAtBoundary();
      untracked(() => this.transport.resumeIfBoundaryWaiting());
    });


    // Prefetch all card images upfront from decklist codes sent with metadata.
    // Fires once on REPLAY_METADATA (before any board state arrives).
    // Tokens/non-deck cards are not covered — they load on demand during
    // travel animations which provide a natural loading window.
    let imagesPrefetched = false;
    effect(() => {
      const meta = this.replayConnection.metadata();
      const codes = meta?.cardCodes;
      if (codes?.length && !imagesPrefetched) {
        imagesPrefetched = true;
        untracked(() => preloadCardImages(codes));
      }
    });

    // Queue watcher — mirrors duel-page.component.ts: triggers orchestrator when events arrive
    effect(() => {
      const queue = this.adapter.animationQueue();
      untracked(() => {
        if (queue.length > 0) {
          this.orchestrator.startProcessingIfIdle();
        }
      });
    });

    // Playback continuation — reactively drives auto-play when adapter.busy()
    // changes, a decision prompt appears, or a phase announcement finishes.
    effect(() => {
      // Subscribe to all 3 signals so the effect re-fires when any of them flips.
      this.adapter.busy();
      this.adapter.activePrompt();
      this.phaseService.announcement();
      untracked(() => this.transport.maybeAdvance());
    });

    // Phase announcement detection
    effect(() => {
      const state = this.activeDuelState();
      untracked(() => {
        // Skip while uninitialised — EMPTY_DUEL_STATE has players[0].zones === []
        // by construction (audit L16: don't rely on referential equality with
        // EMPTY_DUEL_STATE because a future patch could clone the sentinel).
        if (state.players[0].zones.length === 0) return;
        const key = `${state.turnCount}-${state.phase}`;
        if (key === this.lastAnnouncedPhase) return;
        this.lastAnnouncedPhase = key;
        const isOpponent = state.turnPlayer !== 0;
        const label = this.phaseService.phaseDisplayName(state.phase);
        this.phaseService.show(label, isOpponent, state.phase, state.turnPlayer, state.turnCount);
      });
    });

    // Initialize first board state when data arrives
    effect(() => {
      const states = this.boardStates();
      untracked(() => {
        // Same uninitialised guard as above (L16) — structural check rather
        // than referential equality with EMPTY_DUEL_STATE.
        const rendered = this.adapter.boardStateView.renderedState();
        if (states.length > 0 && rendered.players[0].zones.length === 0) {
          this.adapter.jumpToState(states[0]);
        }
      });
    });
  }

  ngOnInit(): void {
    const replayId = this.route.snapshot.paramMap.get('replayId');
    if (replayId) {
      this.duelLogger.setTraceId(replayId);
      this.replayConnection.connect(replayId, this.buildReplayToken());
    } else {
      this.router.navigate(['/pvp/history']);
      return;
    }

    // seekTo support: query param only (fork return)
    const seekToParam = this.route.snapshot.queryParamMap.get('seekTo');
    const seekTo = seekToParam ? parseInt(seekToParam, 10) : NaN;
    if (!isNaN(seekTo) && seekTo > 0) {
      this.setupSeekTo(seekTo);
    }

    this.duelCtx.configure({
      ownPlayerIndex: () => this.perspectiveIndex(),
      speedMultiplier: () => 1,
      isBoardActive: () => true,
    });
    this.adapter.perspectiveIndex.set(this.perspectiveIndex());

    // F4 — width-driven `.is-narrow` host class (D1). matchMedia change events
    // fire only on the breakpoint crossing, so the initial value is read at
    // signal construction time above.
    this.narrowMql = window.matchMedia(`(max-width: ${ReplayPageComponent.NARROW_BREAKPOINT_PX - 1}px)`);
    this.narrowMqlHandler = (e: MediaQueryListEvent) => this.isNarrow.set(e.matches);
    this.narrowMql.addEventListener('change', this.narrowMqlHandler);

    // D6 swipe-hint — show the "Glisse pour changer de tour" banner on narrow
    // viewports for 3s at mount. The flash gold edge + auto-hide on first
    // swipe live in `triggerSwipeFlash()`.
    if (this.isNarrow()) {
      this.swipeHintVisible.set(true);
      this.swipeHintTimer = setTimeout(() => this.hideSwipeHint(), 3000);
    }
  }

  ngOnDestroy(): void {
    if (this.narrowMql && this.narrowMqlHandler) {
      this.narrowMql.removeEventListener('change', this.narrowMqlHandler);
    }
    if (this.copyFlashTimer !== null) clearTimeout(this.copyFlashTimer);
    if (this.swipeFlashTimer !== null) clearTimeout(this.swipeFlashTimer);
    if (this.swipeHintTimer !== null) clearTimeout(this.swipeHintTimer);
    this.transport.destroy();
    this.abortAndClean();
    this.orchestrator.destroy();
    this.fork.cleanup();
    this.replayConnection.disconnect();
  }

  // --- DRY cleanup helper (used by all interruption points) ---

  private abortAndClean(): void {
    this.orchestrator.resetForSwitch();
    this.phaseService.clear();
    this.adapter.abort();
  }

  // --- Playback controls (transport delegates with abortAndClean side-effect) ---

  onSeek(index: number): void { this.abortAndClean(); this.transport.seek(index); }
  onScrub(index: number): void { this.abortAndClean(); this.transport.scrub(index); }
  onStepForward(): void { this.transport.stepForward(); }
  onStepBack(): void { this.abortAndClean(); this.transport.stepBack(); }
  onPlayPause(): void { this.transport.togglePlay(); }
  onSkipStart(): void { this.abortAndClean(); this.transport.skipStart(); }
  onSkipEnd(): void { this.abortAndClean(); this.transport.skipEnd(); }

  onToggleAnimations(): void {
    this.abortAndClean();
    const next = !this.animationsEnabled();
    this.animationsEnabled.set(next);
    localStorage.setItem(ReplayPageComponent.PREF_ANIMATIONS, String(next));
    const state = this.boardStates()[this.currentIndex()];
    if (state) this.adapter.jumpToState(state);
    if (this.isPlaying()) this.transport.restart();
  }

  onTogglePromptMode(): void {
    const next = this.promptMode() === 'decision' ? 'result' : 'decision';
    this.promptMode.set(next);
    localStorage.setItem(ReplayPageComponent.PREF_PROMPT_MODE, next);
    if (next === 'result' && this.adapter.activePrompt()) {
      this.adapter.collapseRemainingSteps();
    }
  }

  onTogglePerspective(): void {
    this.transport.haltPlaybackTimer();
    this.abortAndClean();
    this.perspectiveIndex.update(i => i === 0 ? 1 : 0);
    this.adapter.perspectiveIndex.set(this.perspectiveIndex());
    localStorage.setItem(ReplayPageComponent.PREF_PERSPECTIVE, String(this.perspectiveIndex()));
    const state = this.boardStates()[this.currentIndex()];
    if (state) this.adapter.jumpToState(state);
  }

  onFork(): void {
    this.abortAndClean();
    const replayId = this.route.snapshot.paramMap.get('replayId');
    if (replayId) {
      this.fork.fork(this.currentIndex(), this.boardStates(), replayId);
    }
  }

  // --- F4 — overlays, sheets, end-overlay, copy-link, zoom ---

  onOpenCheatSheet(): void   { this.cheatSheetOpen.set(true); }
  onCloseCheatSheet(): void  { this.cheatSheetOpen.set(false); }
  onOpenOptions(): void      { this.optionsOpen.set(true); }
  onCloseOptions(): void     { this.optionsOpen.set(false); }
  onOpenDetails(): void      { this.detailsOpen.set(true); }
  onCloseDetails(): void     { this.detailsOpen.set(false); }
  onOpenPicker(): void       { this.pickerOpen.set(true); }
  onClosePicker(): void      { this.pickerOpen.set(false); }

  onBackToHub(): void        { this.router.navigate(['/pvp/history']); }
  onEndOverlayReplay(): void { this.onSkipStart(); }
  onEndOverlayLibrary(): void { this.onBackToHub(); }
  /** V-A7 mockup restore — the end-overlay exposes a Fork CTA matching the
   *  mockup §end-overlay. Reuses the existing `onFork()` keyboard handler
   *  (keeps single source of truth for the fork flow). */
  onEndOverlayFork(): void { this.onFork(); }
  /** Soft-dismiss the end overlay (Esc/← from inside the component). We pause
   *  the timer and step back one event so the overlay disappears and the user
   *  can scrub freely. */
  onEndOverlayDismissed(): void { this.onStepBack(); }

  onZoomLevelChange(level: ZoomLevel): void {
    this.zoomLevel.set(level);
    localStorage.setItem(ReplayPageComponent.PREF_ZOOM_LEVEL, String(level));
  }

  onSeekToTurn(turnIndex: number): void {
    // Bound-check BEFORE abortAndClean — out-of-range indices (swipe at first/
    // last turn, picker click on a not-computed turn) must not tear down
    // in-flight animations for a seek that will silently no-op.
    const turns = this.turns();
    const turn = turns[turnIndex];
    if (!turn) return;
    if (turn.startIndex > this.computedUpTo()) return;
    this.abortAndClean();
    this.transport.seekToTurn(turnIndex, turns);
  }

  onSeekToTurnAndClose(turnIndex: number): void {
    this.onSeekToTurn(turnIndex);
    this.onClosePicker();
  }

  onSwipeLeft(): void {
    this.triggerSwipeFlash('left');
    this.onSeekToTurn(this.currentTurnIndex() + 1);
  }
  onSwipeRight(): void {
    this.triggerSwipeFlash('right');
    this.onSeekToTurn(this.currentTurnIndex() - 1);
  }

  /** 250ms gold edge flash + hides the swipe-hint banner if still visible
   *  (the user has clearly understood the gesture). */
  private triggerSwipeFlash(dir: 'left' | 'right'): void {
    this.swipeFlash.set(dir);
    if (this.swipeFlashTimer) clearTimeout(this.swipeFlashTimer);
    this.swipeFlashTimer = setTimeout(() => this.swipeFlash.set(null), 250);
    if (this.swipeHintVisible()) this.hideSwipeHint();
  }

  private hideSwipeHint(): void {
    this.swipeHintVisible.set(false);
    if (this.swipeHintTimer) {
      clearTimeout(this.swipeHintTimer);
      this.swipeHintTimer = null;
    }
  }

  /** D20 — copy a shareable seekTo URL for the current event index. Falls
   *  back to `execCommand('copy')` when the Clipboard API is unavailable
   *  (HTTP localhost, older browsers). */
  async onCopyLink(): Promise<void> {
    const replayId = this.route.snapshot.paramMap.get('replayId');
    if (!replayId) return;
    const url = `${window.location.origin}/pvp/replay/${replayId}?seekTo=${this.currentIndex()}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(input); }
    }
    this.copyJustSucceeded.set(true);
    if (this.copyFlashTimer !== null) clearTimeout(this.copyFlashTimer);
    this.copyFlashTimer = setTimeout(() => {
      this.copyFlashTimer = null;
      this.copyJustSucceeded.set(false);
    }, 1500);
    this.notify.success('replay.viewer.copyLinkToast');
  }

  // --- Keyboard handler ---

  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

    // Esc closes any open overlay/sheet first — drops the duel keyboard map
    // when the user is interacting with a modal.
    if (event.key === 'Escape') {
      if (this.cheatSheetOpen()) { this.onCloseCheatSheet(); return; }
      if (this.pickerOpen())     { this.onClosePicker(); return; }
      if (this.optionsOpen())    { this.onCloseOptions(); return; }
      if (this.detailsOpen())    { this.onCloseDetails(); return; }
    }

    switch (event.key) {
      case 'ArrowRight': this.onStepForward(); break;
      // ArrowLeft inside the end-overlay dismisses it (and steps back via the
      // dismiss handler) — without this gate the page handler AND the overlay's
      // own listener would both fire stepBack, jumping two events.
      case 'ArrowLeft':
        if (this.endOverlayState() != null) this.onEndOverlayDismissed();
        else this.onStepBack();
        break;
      case ' ': event.preventDefault(); this.onPlayPause(); break;
      case 'Home': this.onSkipStart(); break;
      case 'End': this.onSkipEnd(); break;
      case 'f': case 'F': this.onFork(); break;
      case 'a': case 'A': this.onToggleAnimations(); break;
      case 'g': case 'G': this.logDetail.update(v => v === 'normal' ? 'debug' : 'normal'); break;
      case 'm': case 'M': this.onTogglePromptMode(); break;
      case 'v': case 'V': this.onTogglePerspective(); break;
      case 'd': case 'D': this.debugPanelOpen.update(v => !v); break;
      // `?` — Shift+/ on QWERTY US AND Shift+, on AZERTY FR both emit
      // the literal character U+003F regardless of physical key, so testing
      // `event.key === '?'` covers both layouts without `event.code` magic.
      case '?': this.onOpenCheatSheet(); break;
    }
  }

  async onCardInspectRequest(event: { cardCode: number; liveCard?: CardOnField }): Promise<void> {
    if (!event.cardCode) return;
    await this.cardInspection.inspectByCode(event.cardCode, false, event.liveCard);
  }

  onZonePillRequest(event: { zoneId: ZoneId; playerIndex: number }): void {
    const player = this.activeDuelState().players[event.playerIndex];
    if (!player) return;
    this.zoneBrowserState.set({
      zoneId: event.zoneId,
      cards: getZonePillCards(player.zones, event.zoneId),
      playerIndex: event.playerIndex,
      openId: ++this.zoneBrowserOpenId,
    });
  }

  closeZoneBrowser(openId?: number): void {
    if (openId != null && this.zoneBrowserState()?.openId !== openId) return;
    this.zoneBrowserState.set(null);
  }

  closeInspector(): void {
    this.cardInspection.close();
  }

  // --- Private: seekTo ---

  private setupSeekTo(seekTo: number): void {
    let done = false;
    effect(() => {
      const states = this.boardStates();
      untracked(() => {
        if (done || states.length <= seekTo) return;
        done = true;
        this.onSeek(seekTo);
      });
    }, { injector: this.injector });
  }

  // --- Private: playback engine extracted to ReplayTransportService (audit M10) ---

  private getHandCards(state: DuelState, playerIndex: number): CardOnField[] {
    const player = state.players[playerIndex];
    if (!player) return [];
    const handZone = player.zones.find(z => z.zoneId === 'HAND');
    return handZone?.cards ?? [];
  }

  private buildReplayToken(): string {
    try {
      const userId = this.authService.user()?.id
        ?? JSON.parse(localStorage.getItem(CURRENT_USER_KEY) ?? 'null')?.id;
      const header = btoa(JSON.stringify({ alg: 'none' }));
      const payload = btoa(JSON.stringify({ sub: String(userId ?? 0) }));
      return `${header}.${payload}.`;
    } catch (e) {
      console.warn('[ReplayPage] Failed to build replay token, using anonymous fallback:', e);
      return 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIwIn0.';
    }
  }

  private memoizeSet<T>(prev: ReadonlySet<T>, current: Set<T>): ReadonlySet<T> {
    if (current.size === prev.size && [...current].every(item => prev.has(item))) return prev;
    return current;
  }

  private memoizeMap<K, V>(prev: Map<K, V>, current: Map<K, V>): Map<K, V> {
    if (current.size === prev.size && [...current].every(([k, v]) => prev.get(k) === v)) return prev;
    return current;
  }
}
