import {
  ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, isDevMode, OnDestroy, OnInit, signal, untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslateService, TranslateModule } from '@ngx-translate/core';

import { ReplayConnectionService } from './replay-connection.service';
import { ReplayForkService } from './replay-fork.service';
import { ReplayDuelAdapter } from './replay-duel-adapter';
import { TimelineBarComponent } from './timeline-bar/timeline-bar.component';
import { TransportBarComponent } from './transport-bar/transport-bar.component';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CURRENT_USER_KEY } from '../../../core/utilities/auth.constants';
import { EMPTY_DUEL_STATE, EMPTY_ZONE_SET, EMPTY_STRING_SET, EMPTY_ARRAY } from '../types';
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
import { CardTravelService } from '../duel-page/card-travel.service';
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
    ReplayConnectionService, ReplayForkService,
    CardDataCacheService, CardInspectionService, CardTravelService, DuelCardArtService,
    DuelLogger, LpAnimationTracker, BattleAnimationTracker, DuelContext,
    ChainResolutionManager, DrawSequenceManager, MoveAnimationRouter, BufferReplayBuilder,
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
    MatProgressSpinner, TranslateModule,
  ],
})
export class ReplayPageComponent implements OnInit, OnDestroy {
  private readonly replayConnection = inject(ReplayConnectionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly authService = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly cardDataCache = inject(CardDataCacheService);
  private readonly cardInspection = inject(CardInspectionService);
  private readonly cardTravel = inject(CardTravelService);
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

  readonly currentIndex = signal<number>(0);
  readonly isPlaying = signal(false);
  readonly pausedAtBoundary = signal(false);
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
  private static readonly PLAYBACK_INTERVAL = 500;
  private static readonly PROMPT_DISPLAY_MIN = 800;
  private static readonly PROMPT_DISPLAY_MAX = 3000;
  private static readonly PROMPT_DISPLAY_FALLBACK = 1500;
  readonly animationsEnabled = signal(localStorage.getItem(ReplayPageComponent.PREF_ANIMATIONS) === 'true');
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastResponseTimestamp: number | null = null;

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
  readonly currentState = computed<PreComputedState | null>(() => this.boardStates()[this.currentIndex()] ?? null);
  readonly debugLogEntries = computed(() => buildReplayLogEntries(this.boardStates(), this.logDetail()));

  /** Duel state for display — the adapter's RBS is already perspective-relative
   *  (swapBoardState applied on every updateLogical), so no swap needed here. */
  readonly activeDuelState = computed<DuelState>(() =>
    this.adapter.renderedBoardState.renderedState(),
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

  readonly positionLabel = computed<string | null>(() => {
    const state = this.currentState();
    if (!state) return null;
    const bs = state.boardState;
    if (bs.turnCount === 0) return this.translate.instant('replay.timeline.setup');
    return `${this.translate.instant('replay.timeline.turn', { n: bs.turnCount })} · ${this.phaseService.phaseDisplayName(bs.phase)} · P${bs.turnPlayer + 1} · ${state.label}`;
  });

  /** Perspective-adjusted turnPlayer for displayedTurnPlayer (0=me, 1=opponent). */
  readonly replayDisplayedTurnPlayer = computed<Player | null>(() => {
    const tp = this.currentState()?.boardState?.turnPlayer;
    if (tp == null) return null;
    if (this.perspectiveIndex() === 0) return tp as Player;
    return (tp === 0 ? 1 : 0) as Player;
  });

  readonly loading = computed(() => this.boardStates().length === 0 && !this.replayConnection.error());

  readonly progressText = computed(() => {
    const last = this.replayConnection.lastReceivedTurn();
    const meta = this.replayConnection.metadata();
    if (meta && last >= 0) {
      return this.translate.instant('replay.viewer.loadingProgress', {
        current: last,
        total: meta.turnCount,
      });
    }
    return this.translate.instant('replay.viewer.loading');
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

  constructor() {
    this.cardInspection.init(this.cardDataCache);
    this.cardTravel.registerContainer(this.elementRef.nativeElement);

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
      const upTo = this.computedUpTo();
      if (this.pausedAtBoundary() && upTo > this.currentIndex()) {
        this.startPlayback();
        this.pausedAtBoundary.set(false);
      }
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
      const busy = this.adapter.busy();
      const prompt = this.adapter.activePrompt();
      const announcing = this.phaseService.announcement();
      untracked(() => {
        if (!this.isPlaying()) return;

        // Decision prompt appeared → auto-dismiss after proportional duration
        if (prompt) {
          this.schedulePromptDismiss();
          return;
        }

        // Phase announcement still playing → wait for it to finish.
        if (announcing) return;

        // Transition complete (busy went false) → schedule next step
        if (!busy) {
          this.scheduleNext();
        }
      });
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
        const rendered = this.adapter.renderedBoardState.renderedState();
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
  }

  ngOnDestroy(): void {
    this.clearPlaybackTimer();
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

  // --- Playback controls ---

  onSeek(index: number): void {
    this.pausePlayback();
    this.abortAndClean();
    this.currentIndex.set(index);
    const state = this.boardStates()[index];
    if (state) this.adapter.jumpToState(state);
  }

  onScrub(index: number): void {
    this.pausePlayback();
    this.abortAndClean();
    this.currentIndex.set(index);
    const state = this.boardStates()[index];
    if (state) this.adapter.jumpToState(state);
  }

  onStepForward(): void {
    this.pausePlayback();
    this.doStepForward();
  }

  /** Internal step — does NOT pause playback (used by auto-play). */
  private doStepForward(): void {
    this.clearPlaybackTimer();

    if (this.adapter.activePrompt()) {
      this.adapter.resumeAfterPrompt();
      return;
    }

    const curr = this.currentIndex();
    const nextIdx = curr + 1;
    if (nextIdx > this.computedUpTo()) return;

    if (this.adapter.busy()) {
      this.abortAndClean();
    }

    this.currentIndex.set(nextIdx);
    this.feedTransition(curr, nextIdx);
  }

  onStepBack(): void {
    this.pausePlayback();
    this.abortAndClean();
    const prev = this.currentIndex() - 1;
    if (prev < 0) return;
    this.currentIndex.set(prev);
    const state = this.boardStates()[prev];
    if (state) this.adapter.jumpToState(state);
  }

  onToggleAnimations(): void {
    this.abortAndClean();
    const next = !this.animationsEnabled();
    this.animationsEnabled.set(next);
    localStorage.setItem(ReplayPageComponent.PREF_ANIMATIONS, String(next));
    if (this.isPlaying()) {
      this.pausePlayback();
      this.startPlayback();
    }
    const state = this.boardStates()[this.currentIndex()];
    if (state) this.adapter.jumpToState(state);
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
    this.clearPlaybackTimer();
    this.abortAndClean();
    this.perspectiveIndex.update(i => i === 0 ? 1 : 0);
    this.adapter.perspectiveIndex.set(this.perspectiveIndex());
    localStorage.setItem(ReplayPageComponent.PREF_PERSPECTIVE, String(this.perspectiveIndex()));
    const state = this.boardStates()[this.currentIndex()];
    if (state) this.adapter.jumpToState(state);
  }

  onPlayPause(): void {
    if (this.isPlaying()) {
      this.pausePlayback();
      this.pausedAtBoundary.set(false);
    } else {
      this.startPlayback();
    }
  }

  onSkipStart(): void {
    this.pausePlayback();
    this.abortAndClean();
    this.currentIndex.set(0);
    const state = this.boardStates()[0];
    if (state) this.adapter.jumpToState(state);
  }

  onSkipEnd(): void {
    this.pausePlayback();
    this.abortAndClean();
    const idx = this.computedUpTo();
    this.currentIndex.set(idx);
    const state = this.boardStates()[idx];
    if (state) this.adapter.jumpToState(state);
  }

  onFork(): void {
    this.abortAndClean();
    const replayId = this.route.snapshot.paramMap.get('replayId');
    if (replayId) {
      this.fork.fork(this.currentIndex(), this.boardStates(), replayId);
    }
  }

  // --- Keyboard handler ---

  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

    switch (event.key) {
      case 'ArrowRight': this.onStepForward(); break;
      case 'ArrowLeft': this.onStepBack(); break;
      case ' ': event.preventDefault(); this.onPlayPause(); break;
      case 'Home': this.onSkipStart(); break;
      case 'End': this.onSkipEnd(); break;
      case 'f': case 'F': this.onFork(); break;
      case 'a': case 'A': this.onToggleAnimations(); break;
      case 'g': case 'G': this.logDetail.update(v => v === 'normal' ? 'debug' : 'normal'); break;
      case 'm': case 'M': this.onTogglePromptMode(); break;
      case 'v': case 'V': this.onTogglePerspective(); break;
      case 'd': case 'D': this.debugPanelOpen.update(v => !v); break;
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

  // --- Private: playback ---

  private feedTransition(fromIdx: number, toIdx: number): void {
    const states = this.boardStates();
    const prev = states[fromIdx];
    const next = states[toIdx];
    if (!prev || !next) return;
    this.feedAnimatedTransition(prev, next);
  }

  private static readonly EMPTY_PRE_COMPUTED: PreComputedState = {
    boardState: EMPTY_DUEL_STATE,
    events: [],
    label: '',
    responseCount: 0,
  };

  private startPlayback(): void {
    console.log('[PLAY:START] idx=%d computedUpTo=%d t=%dms',
      this.currentIndex(), this.computedUpTo(), performance.now() | 0);

    if (this.currentIndex() >= this.computedUpTo()) {
      this.abortAndClean();
      this.currentIndex.set(0);
    }
    if (this.computedUpTo() <= 0) return;
    this.isPlaying.set(true);

    if (this.adapter.activePrompt()) {
      this.schedulePromptDismiss();
      return;
    }

    if (this.currentIndex() === 0) {
      const first = this.boardStates()[0];
      if (first) {
        this.feedAnimatedTransition(ReplayPageComponent.EMPTY_PRE_COMPUTED, first);
        return;
      }
    }
    this.scheduleNext();
  }

  private feedAnimatedTransition(prev: PreComputedState, next: PreComputedState): void {
    if (this.animationsEnabled()) {
      if (this.promptMode() === 'decision') {
        this.adapter.feedTransitionPhased(prev, next);
      } else {
        this.adapter.feedTransition(prev, next);
      }
    } else {
      this.adapter.jumpToState(next);
      // Schedule next via timer to avoid synchronous recursion
      // (scheduleNext → doStepForward → feedAnimatedTransition → scheduleNext ...)
      this.playbackTimer = setTimeout(() => { this.playbackTimer = null; this.scheduleNext(); }, ReplayPageComponent.PLAYBACK_INTERVAL);
    }
  }

  private scheduleNext(): void {
    if (!this.isPlaying()) return;
    if (this.playbackTimer !== null) return; // Already scheduled — prevent double-fire
    if (this.adapter.busy()) return;

    if (this.currentIndex() >= this.computedUpTo()) {
      this.isPlaying.set(false);
      this.pausedAtBoundary.set(true);
      return;
    }

    this.doStepForward();
    // No timer here — feedAnimatedTransition already schedules the next
    // step via its own setTimeout when animations are disabled.
  }

  private schedulePromptDismiss(): void {
    this.clearPlaybackTimer();
    const tsStr = this.adapter.activeTimestamp();
    const ts = tsStr ? new Date(tsStr).getTime() : null;
    const prevTs = this._lastResponseTimestamp;
    this._lastResponseTimestamp = ts;
    const delta = (ts && prevTs) ? ts - prevTs : null;
    const duration = delta !== null
      ? Math.min(Math.max(delta * 0.6, ReplayPageComponent.PROMPT_DISPLAY_MIN), ReplayPageComponent.PROMPT_DISPLAY_MAX)
      : ReplayPageComponent.PROMPT_DISPLAY_FALLBACK;

    this.playbackTimer = setTimeout(() => {
      this.playbackTimer = null;
      this.adapter.resumeAfterPrompt();
    }, duration);
  }

  private pausePlayback(): void {
    this.isPlaying.set(false);
    this.clearPlaybackTimer();
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer !== null) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

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
