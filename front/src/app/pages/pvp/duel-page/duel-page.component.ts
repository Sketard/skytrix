import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, OnInit, signal, TemplateRef, untracked, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, filter, map, Observable, of, switchMap, take, timeout } from 'rxjs';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose } from '@angular/material/dialog';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { NotificationService } from '../../../core/services/notification.service';
import { NavbarCollapseService } from '../../../services/navbar-collapse.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DuelTabGuardService } from './duel-tab-guard.service';
import { EMPTY_STRING_SET } from '../types';
import { BoardZone, CardInfo, CardOnField, LOCATION, Phase, Player, SelectBattleCmdMsg, SelectCardMsg, SelectDisfieldMsg, SelectIdleCmdMsg, SelectPlaceMsg, ZoneId } from '../duel-ws.types';
import { BATTLE_ACTION, buildActionableCardsFromBattle, buildActionableCardsFromIdle, CardAction, groupMenuActions, IDLE_ACTION, isActivateAction } from './idle-action-codes';
import { buildFaceDownZoneKeys } from '../pvp-card.utils';
import { DuelCardArtService } from './duel-card-art.service';
import { locationToZoneId, locationToZoneKey, getZonePillCards } from '../pvp-zone.utils';
import { CardDataCacheService } from './card-data-cache.service';
import { PvpBoardContainerComponent } from './pvp-board-container/pvp-board-container.component';
import { PvpHandRowComponent } from './pvp-hand-row/pvp-hand-row.component';
import { PvpPromptDialogComponent } from './prompts/pvp-prompt-dialog/pvp-prompt-dialog.component';
import { PromptZoneHighlightComponent } from './prompts/prompt-zone-highlight/prompt-zone-highlight.component';
import { PvpZoneBrowserOverlayComponent } from './pvp-zone-browser-overlay/pvp-zone-browser-overlay.component';
import { PvpCardInspectorWrapperComponent } from './pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component';
import { ActivationMode, PvpActivationToggleComponent } from './pvp-activation-toggle/pvp-activation-toggle.component';
import { setupClickOutsideListener } from './click-outside.utils';
import { buildHandChainBadges, buildOpponentHandChainData } from './chain-badge.utils';
import { PhaseAnnouncementService } from './phase-announcement.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { ANIMATION_DATA_SOURCE } from './animation-data-source';
import { CardTravelService } from './card-travel.service';
import { DuelContext } from './duel-context';
import { DuelLogger } from './duel-logger';
import { BattleAnimationTracker } from './battle-animation-tracker';
import { LpAnimationTracker } from './lp-animation-tracker';
import { ChainResolutionManager } from './chain-resolution-manager';
import { DrawSequenceManager } from './draw-sequence-manager';
import { MoveAnimationRouter } from './move-animation-router';
import { RoomStateMachineService } from './room-state-machine.service';
import { CardInspectionService } from './card-inspection.service';
import { DuelConnectionEffectsService } from './duel-connection-effects.service';
import { SoloModeEffectsService } from './solo-mode-effects.service';
import { DuelPromptEffectsService } from './duel-prompt-effects.service';
import { DuelA11yEffectsService } from './duel-a11y-effects.service';
import { DuelLoadingEffectsService } from './duel-loading-effects.service';
import { DuelAnimationBridgeService } from './duel-animation-bridge.service';
import { DuelToastService } from './duel-toast.service';
import { DebugLogService } from './debug-log.service';
import { DebugLogPanelComponent } from './debug-log-panel/debug-log-panel.component';
import { SoloDuelOrchestratorService } from './solo-duel-orchestrator.service';
import { PvpChainOverlayComponent } from './pvp-chain-overlay/pvp-chain-overlay.component';
import { PvpDuelOverlaysComponent } from './pvp-duel-overlays/pvp-duel-overlays.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-duel-page',
  templateUrl: './duel-page.component.html',
  styleUrls: ['./duel-page.component.scss', './duel-page-overlays.scss', './duel-page-ui.scss', '../_pvp-overlays.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    DuelWebSocketService, CardDataCacheService, DuelTabGuardService,
    DuelLogger, LpAnimationTracker, BattleAnimationTracker, DuelContext,
    ChainResolutionManager, DrawSequenceManager, MoveAnimationRouter,
    AnimationOrchestratorService, CardTravelService, RoomStateMachineService, CardInspectionService,
    DebugLogService, SoloDuelOrchestratorService, PhaseAnnouncementService, DuelToastService,
    DuelConnectionEffectsService, SoloModeEffectsService, DuelPromptEffectsService, DuelA11yEffectsService, DuelLoadingEffectsService, DuelAnimationBridgeService,
    DuelCardArtService,
    { provide: ANIMATION_DATA_SOURCE, useExisting: DuelWebSocketService },
  ],
  imports: [
    PvpBoardContainerComponent, PvpHandRowComponent, PvpPromptDialogComponent, PromptZoneHighlightComponent,
    PvpZoneBrowserOverlayComponent, PvpCardInspectorWrapperComponent, PvpActivationToggleComponent,
    MatButton, MatIcon, MatProgressSpinner,
    MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, CdkTrapFocus,
    DebugLogPanelComponent,
    PvpChainOverlayComponent,
    PvpDuelOverlaysComponent,
    TranslatePipe,
  ],
})
export class DuelPageComponent implements OnInit {
  private static readonly MENU_HEIGHT = 200;
  private static readonly MENU_WIDTH_WITH_PADDING = 164;
  private static readonly MENU_HEIGHT_WITH_PADDING = 204;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly wsService = inject(DuelWebSocketService);
  private readonly notify = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly navbarCollapse = inject(NavbarCollapseService);
  private readonly dialog = inject(MatDialog);
  private readonly cardDataCache = inject(CardDataCacheService);
  readonly tabGuard = inject(DuelTabGuardService);
  readonly debugLog = inject(DebugLogService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  readonly orchestrator = inject(SoloDuelOrchestratorService);
  readonly showDebugTools = environment.debugTools;
  readonly isSoloMode = signal(false);
  forkReplayId: string | null = null;
  forkSeekTo = 0;

  // --- Extracted services ---
  private readonly duelCtx = inject(DuelContext);
  readonly animationService = inject(AnimationOrchestratorService);
  readonly chainManager = inject(ChainResolutionManager);
  readonly drawManager = inject(DrawSequenceManager);
  private readonly cardTravelService = inject(CardTravelService);
  readonly roomService = inject(RoomStateMachineService);
  readonly cardInspection = inject(CardInspectionService);
  readonly phaseService = inject(PhaseAnnouncementService);
  readonly toastService = inject(DuelToastService);
  private readonly connEffects = inject(DuelConnectionEffectsService);
  private readonly soloEffects = inject(SoloModeEffectsService);
  private readonly promptEffects = inject(DuelPromptEffectsService);
  private readonly a11yEffects = inject(DuelA11yEffectsService);
  private readonly loadingEffects = inject(DuelLoadingEffectsService);
  private readonly animBridge = inject(DuelAnimationBridgeService);

  readonly roomCode = toSignal(this.route.paramMap.pipe(map(params => params.get('roomCode') ?? '')), {
    initialValue: '',
  });

  // Delegate room signals to service
  readonly roomState = this.roomService.roomState;
  readonly room = this.roomService.room;
  readonly countdown = this.roomService.countdown;
  readonly canShare = this.roomService.canShare;

  readonly connectionStatus = this.wsService.connectionStatus;
  readonly isLost = computed(() => this.connectionStatus() === 'lost');
  readonly isReconnecting = computed(() => this.connectionStatus() === 'reconnecting');

  private static readonly MAX_RETRIES = 3;
  private readonly retryCount = signal(0);
  readonly canRetry = computed(() => this.retryCount() < DuelPageComponent.MAX_RETRIES && this.wsService.canRetry());

  // Story 2.3 — Board ready when first BOARD_STATE arrives (both players populated with LP)
  readonly boardReady = computed(() => this.logicalState().players.length === 2 && this.logicalState().players[0].lp > 0);

  // Story 2.4 — Duel loading: thumbnails pre-cached (or all settled with fallback)
  readonly thumbnailsReady = signal(false);
  readonly duelLoadingReady = computed(() => this.boardReady() && this.thumbnailsReady());
  readonly loadingTimeout = signal(false);

  readonly isPortrait = signal(false);

  readonly renderedState = computed(() => this.wsService.renderedBoardState.renderedState());
  readonly logicalState = computed(() => this.wsService.renderedBoardState.logicalState());
  readonly timerState = this.wsService.timerState;

  // In solo mode, show the active player's own timer instead of the last received timer
  readonly displayedTimerState = computed(() => {
    if (!this.isSoloMode()) return this.timerState();
    const conns = this.orchestrator.connections();
    if (!conns) return this.timerState();
    const activeIdx = this.orchestrator.activePlayerIndex();
    return conns[activeIdx].timerStatePerPlayer()[activeIdx] ?? this.timerState();
  });

  readonly playerHand = computed(() => this.getHandCards(0));
  readonly opponentHand = computed(() => this.getHandCards(1));

  // Delegate animation signals to service
  readonly isAnimating = this.animationService.isAnimating;
  readonly animatingZone = this.animationService.animatingZone;

  // Notify server when animations complete so it can start the turn timer.
  // Fires on every (pendingPrompt, isAnimating) change: sends immediately if
  // not animating, or defers until the queue drains.
  private readonly _animationsDoneEffect = effect(() => {
    const prompt = this.wsService.pendingPrompt();
    const animating = this.isAnimating();
    if (prompt && !animating) {
      untracked(() => this.wsService.sendAnimationsDone());
    }
  });
  private readonly lpTracker = inject(LpAnimationTracker);
  readonly animatingLpPlayer = this.lpTracker.animatingLpPlayer;

  // Delegate card inspection signals to service
  private readonly artService = inject(DuelCardArtService);

  readonly inspectedCard = this.cardInspection.inspectedCard;
  readonly inspectorForceExpanded = this.cardInspection.inspectorForceExpanded;

  getCardImageUrl(cardCode: number | null): string {
    return this.artService.resolveUrl(cardCode);
  }

  // Zone highlight (Pattern A — SELECT_PLACE / SELECT_DISFIELD)
  // Story 4.2 — All prompt-dependent computeds use visiblePrompt (drain coordination)
  readonly isZoneHighlightActive = computed(() => {
    const p = this.visiblePrompt();
    return p?.type === 'SELECT_PLACE' || p?.type === 'SELECT_DISFIELD';
  });

  readonly highlightedZones = computed(() => {
    const p = this.visiblePrompt();
    if (p?.type !== 'SELECT_PLACE' && p?.type !== 'SELECT_DISFIELD') return new Set<string>();
    const places = (p as SelectPlaceMsg | SelectDisfieldMsg).places;
    const ownIdx = this.ownPlayerIndex();
    const keys = places
      .map(pl => {
        const zoneId = locationToZoneId(pl.location, pl.sequence);
        const relPlayer = pl.player === ownIdx ? 0 : 1;
        return zoneId ? `${zoneId}-${relPlayer}` : null;
      })
      .filter((k): k is string => k !== null);
    return new Set(keys);
  });

  readonly zoneInstruction = computed(() => {
    const p = this.visiblePrompt();
    if (p?.type === 'SELECT_PLACE') return 'Select a zone to place your card';
    if (p?.type === 'SELECT_DISFIELD') return 'Select a zone to destroy';
    return '';
  });

  // Story 1.7 — Actionable prompt (IDLECMD/BATTLECMD distributed UI)
  readonly actionablePrompt = computed((): SelectIdleCmdMsg | SelectBattleCmdMsg | null => {
    const p = this.visiblePrompt();
    if (p?.type === 'SELECT_IDLECMD' || p?.type === 'SELECT_BATTLECMD') return p;
    return null;
  });

  // Card Action Menu state
  readonly menuState = signal<{
    top: number;
    left: number;
    actions: CardAction[];
    promptType: 'SELECT_IDLECMD' | 'SELECT_BATTLECMD';
  } | null>(null);

  // Effect sub-menu: shown when user clicks a grouped "Activate Effect" entry
  readonly effectSubMenu = signal<CardAction[] | null>(null);

  // Pile card selection: synthetic prompt for choosing a card from a pile action group
  readonly pilePrompt = signal<SelectCardMsg | null>(null);
  private pileActions: CardAction[] = [];
  private pilePromptType: 'SELECT_IDLECMD' | 'SELECT_BATTLECMD' = 'SELECT_IDLECMD';

  readonly effectivePrompt = computed(() => this.pilePrompt() ?? this.visiblePrompt());

  readonly pileResponseHandler = (data: unknown) => {
    const resp = data as { indices: number[] };
    const idx = resp.indices?.[0];
    const action = this.pileActions[idx];
    if (action) {
      this.wsService.sendResponse(this.pilePromptType, { action: action.actionCode, index: action.index });
    }
    this.pilePrompt.set(null);
    this.pileActions = [];
  };

  readonly menuDisplayActions = computed(() => {
    const menu = this.menuState();
    if (!menu) return [];
    return groupMenuActions(menu.actions);
  });

  // Story 1.7 — Own turn detection
  readonly isOwnTurn = computed(() => this.renderedState().turnPlayer === 0);

  // Story 1.7 — Hand actionable indices (all actions, for click behavior)
  readonly playerActionableHandIndices = computed((): Set<number> => {
    const prompt = this.actionablePrompt();
    if (!prompt) return new Set();
    const actionMap = prompt.type === 'SELECT_IDLECMD'
      ? buildActionableCardsFromIdle(prompt)
      : buildActionableCardsFromBattle(prompt);
    const indices = new Set<number>();
    for (const key of actionMap.keys()) {
      const parts = key.split('-');
      if (parseInt(parts[0], 10) === LOCATION.HAND) {
        indices.add(parseInt(parts[1], 10));
      }
    }
    return indices;
  });

  // Hand indices with activate effect (gold glow)
  readonly playerActivateHandIndices = computed((): Set<number> => {
    const prompt = this.actionablePrompt();
    if (!prompt) return new Set();
    const promptType = prompt.type as 'SELECT_IDLECMD' | 'SELECT_BATTLECMD';
    const actionMap = prompt.type === 'SELECT_IDLECMD'
      ? buildActionableCardsFromIdle(prompt)
      : buildActionableCardsFromBattle(prompt);
    const indices = new Set<number>();
    for (const [key, actions] of actionMap) {
      const parts = key.split('-');
      if (parseInt(parts[0], 10) === LOCATION.HAND && actions.some(a => isActivateAction(a.actionCode, promptType))) {
        indices.add(parseInt(parts[1], 10));
      }
    }
    return indices;
  });

  // Server-driven: true when opponent has a pending prompt
  readonly waitingForOpponent = this.wsService.waitingForOpponent;

  // TP passive message: shown in prompt dialog during turn-order phase
  readonly tpPassiveMessage = computed(() => {
    const tpResult = this.wsService.tpResult();
    if (tpResult) return {
      title: tpResult.goFirst ? 'You go first!' : 'You go second!',
      subtitle: 'The duel will begin shortly',
      style: 'result' as const,
    };
    // Pre-duel waiting (loser waits for winner to choose TP)
    const waiting = this.wsService.waitingForOpponent();
    const preDuel = this.wsService.ocgPlayerIndex() === null;
    const noPrompt = !this.wsService.pendingPrompt();
    const noRps = !this.wsService.rpsResult() && !this.wsService.rpsInProgress();
    if (waiting && preDuel && noPrompt && noRps) return {
      title: 'Opponent is choosing turn order...',
      style: 'waiting' as const,
    };
    return null;
  });

  // [C2 fix] Has active blocking prompt — excludes IDLECMD/BATTLECMD (distributed UI, not blocking)
  // Story 4.2 — uses visiblePrompt for drain coordination
  readonly hasActivePrompt = computed(() => {
    const p = this.visiblePrompt();
    return p !== null && p.type !== 'SELECT_IDLECMD' && p.type !== 'SELECT_BATTLECMD';
  });

  // Story 3.1 — Own player index (0 = player1, 1 = player2)
  // In solo mode, tracks the active connection's player index so the board and badges
  // render from the correct perspective after switching players.
  readonly ownPlayerIndex = computed(() => {
    if (this.isSoloMode()) return this.orchestrator.activePlayerIndex();
    return this.wsService.ocgPlayerIndex() ?? 0;
  });

  /** Chain badges for hand cards: hand index → chain link number (player side). */
  readonly playerHandChainBadges = computed(() =>
    buildHandChainBadges(this.wsService.activeChainLinks(), this.ownPlayerIndex(), this.wsService.chainPhase(), this.playerHand()),
  );

  /** Chain badges + revealed card codes for opponent hand cards in chain. Single pass over links. */
  private readonly opponentHandChainData = computed(() =>
    buildOpponentHandChainData(this.wsService.activeChainLinks(), this.ownPlayerIndex(), this.wsService.chainPhase(), this.opponentHand()),
  );
  readonly opponentHandChainBadges = computed(() => this.opponentHandChainData().badges);
  readonly opponentHandRevealedCards = computed<Map<number, number>>(() => {
    const confirm = this.animationService.confirmRevealedCards();
    if (confirm.size === 0) return this.opponentHandChainData().revealed;
    const merged = new Map(this.opponentHandChainData().revealed);
    for (const [k, v] of confirm) merged.set(k, v);
    return merged;
  });

  /** X-ray overlay keys for face-down cards owned by the current player (player always at index 0). */
  readonly revealedZoneKeys = computed<ReadonlySet<string>>(() => {
    const keys = buildFaceDownZoneKeys(this.logicalState().players, [0]);
    return keys.size ? keys : EMPTY_STRING_SET;
  });

  // Story 3.4 — Duel result display with reason mapping
  readonly resultOutcome = computed(() => {
    const result = this.wsService.duelResult();
    if (!result) return null;
    const cause = result.reason;
    if (result.winner === null) {
      return { outcome: 'draw' as const, reason: this.mapDuelEndReason(result.reason, false) || 'Draw', cause };
    }
    const isWinner = result.winner === this.ownPlayerIndex();
    const outcome = isWinner ? 'victory' as const : 'defeat' as const;
    const reason = this.mapDuelEndReason(result.reason, isWinner);
    return { outcome, reason, cause };
  });

  // Story 3.4 — Rematch UI state
  readonly rematchButtonLabel = computed(() => {
    if (this.isSoloMode()) {
      return this.wsService.rematchStarting() ? 'Starting...' : 'Rematch';
    }
    switch (this.wsService.rematchState()) {
      case 'idle': return 'Rematch';
      case 'requested': return 'Waiting for opponent...';
      case 'invited': return 'Accept Rematch';
      case 'opponent-left': return 'Opponent left';
      case 'expired': return 'Room expired';
    }
  });

  readonly rematchDisabled = computed(() => {
    if (this.isSoloMode()) return this.wsService.rematchStarting();
    const state = this.wsService.rematchState();
    return state === 'requested' || state === 'opponent-left' || state === 'expired';
  });

  // [H1 fix] Track prompt sheet expanded state for mini-toolbar interaction
  readonly promptSheetExpanded = signal(false);

  readonly preTargetZoneKeys = signal<ReadonlySet<string>>(new Set());

  // Story 1.7 — Activation toggle mode
  readonly activationMode = signal<ActivationMode>('auto');

  // Story 1.7 — Zone browser state
  private zoneBrowserOpenId = 0;
  readonly zoneBrowserState = signal<{
    zoneId: ZoneId;
    cards: CardOnField[];
    playerIndex: number;
    mode: 'browse' | 'action';
    reversed: boolean;
    openId: number;
  } | null>(null);

  // [H2 fix] Actionable card codes for the currently open zone browser
  readonly zoneBrowserActionableCodes = computed((): Set<number> => {
    const zb = this.zoneBrowserState();
    const prompt = this.actionablePrompt();
    if (!zb || !prompt || zb.mode !== 'action') return new Set();

    const targetLocation = this.zoneIdToLocation(zb.zoneId);
    if (targetLocation === null) return new Set();

    const allCards: CardInfo[] = [];
    if (prompt.type === 'SELECT_IDLECMD') {
      allCards.push(
        ...prompt.summons, ...prompt.specialSummons, ...prompt.repositions,
        ...prompt.setMonsters, ...prompt.activations, ...prompt.setSpellTraps,
      );
    } else {
      allCards.push(...prompt.attacks, ...prompt.activations);
    }
    return new Set(allCards.filter(c => c.location === targetLocation).map(c => c.cardCode));
  });

  // Story 3.1 — Surrender dialog template ref
  @ViewChild('surrenderDialog') surrenderDialogTpl!: TemplateRef<void>;
  @ViewChild('playerHandRow') private playerHandRow?: PvpHandRowComponent;

  /** Guard prevents the click that opens the browser from immediately closing it. */
  private _zoneBrowserClickGuard = false;

  // Story 3.1 — duelResult as observable (created in injection context for toObservable)
  private readonly duelResult$ = toObservable(this.wsService.duelResult);

  private teardownMenuListener: () => void = () => {};


  // Task 16 — Board flip transition for solo player switch
  readonly switching = signal(false);
  private switchTimer: ReturnType<typeof setTimeout> | null = null;


  // Story 4.2 — Prompt drain: gate prompt display behind animation queue drain
  // During chain building with pending cost, let cost prompts through immediately
  // (the zone glow continues visually behind the prompt dialog).
  // After cost paid, gate on chainEntryAnimating so the overlay entry animation
  // plays before SELECT_CHAIN appears.
  readonly visiblePrompt = computed(() => {
    const animating = this.isAnimating();
    const chainEntryAnim = this.chainManager.chainEntryAnimating();
    const prompt = this.wsService.pendingPrompt();
    const queuePending = this.wsService.animationQueue().length > 0;
    const chainPromptGate = this.chainManager.chainPromptGateActive();
    const blocked = animating || chainEntryAnim || queuePending || chainPromptGate;
    if (!blocked) return prompt;
    // During chain building with pending cost → let cost prompts through,
    // but ONLY if the sole blocker is chain entry animation (not active travels/moves)
    if (this.wsService.chainPhase() === 'building' && this.wsService.hasPendingChainEntry()
      && !animating && !queuePending) {
      return prompt;
    }
    return null;
  });

  constructor() {
    // --- Initialize extracted services ---
    this.roomService.init({ wsService: this.wsService, tabGuard: this.tabGuard });
    this.duelCtx.configure({
      ownPlayerIndex: () => this.ownPlayerIndex(),
      speedMultiplier: () => this.activationMode() === 'off' ? 0.5 : 1,
      isBoardActive: () => this.roomState() === 'active',
    });
    this.cardTravelService.registerContainer(this.elementRef.nativeElement);
    this.cardInspection.init(this.cardDataCache);
    this.wsService.onStateSync = () => {
      this.animationService.onStateSync();
      // On reconnect (STATE_SYNC), skip the duel-loading phase — thumbnails were
      // already loaded in the previous session; no need to show the loading screen again.
      this.thumbnailsReady.set(true);
      // Silence the phase announcement that would otherwise fire when logicalState is
      // restored by STATE_SYNC. This runs synchronously before Angular effects (microtasks),
      // so lastAnnouncedPhase is already set when the phase effect fires.
      const s = this.wsService.renderedBoardState.logicalState();
      this.animBridge.silenceCurrentPhase(s.phase, s.turnPlayer);
    };

    // --- Bootstrap room ---
    const code = this.route.snapshot.paramMap.get('roomCode');
    const isFork = this.route.snapshot.queryParamMap.get('fork') === 'true';
    const isSolo = isFork || this.route.snapshot.queryParamMap.get('solo') === 'true';

    if (isFork && code) {
      this.isSoloMode.set(true);
      this.forkReplayId = this.route.snapshot.queryParamMap.get('replayId');
      this.forkSeekTo = parseInt(this.route.snapshot.queryParamMap.get('seekTo') ?? '0', 10);
      const wsToken1 = history.state?.wsToken1 as string | undefined;
      const wsToken2 = history.state?.wsToken2 as string | undefined;
      if (!wsToken1 || !wsToken2) {
        this.notify.error('error.SOLO_SESSION_EXPIRED');
        this.router.navigate(['/pvp']);
      } else {
        this.orchestrator.init(wsToken1, wsToken2);
        this.roomService.forceState('connecting');
        this.soloEffects.initFork();
      }
    } else if (isSolo && code) {
      this.isSoloMode.set(true);
      const soloTokensKey = `solo-duel-tokens-${code}`;
      const stored = (() => { try { return JSON.parse(sessionStorage.getItem(soloTokensKey) ?? 'null'); } catch { return null; } })();
      const wsToken1 = (history.state?.wsToken1 as string | undefined) ?? stored?.wsToken1;
      const wsToken2 = (history.state?.wsToken2 as string | undefined) ?? stored?.wsToken2;

      if (!wsToken1 || !wsToken2) {
        this.notify.error('error.SOLO_SESSION_EXPIRED');
        this.router.navigate(['/pvp']);
      } else {
        const restoredPlayer = (stored?.activePlayer as 0 | 1 | undefined) ?? 0;
        const decklistId = (history.state?.decklistId as number | undefined) ?? (stored?.decklistId as number | undefined) ?? null;
        this.roomService.decklistId = decklistId;
        try { sessionStorage.setItem(soloTokensKey, JSON.stringify({ wsToken1, wsToken2, activePlayer: restoredPlayer, decklistId })); } catch {}
        this.tabGuard.init(code);
        this.tabGuard.broadcast();
        this.orchestrator.init(wsToken1, wsToken2);
        if (restoredPlayer === 1) this.orchestrator.switchPlayer();
        this.roomService.forceState('connecting');
        this.soloEffects.initSolo({ soloTokensKey, wsToken1, wsToken2, roomService: this.roomService, thumbnailsReady: this.thumbnailsReady });
      }
    } else if (code) {
      this.roomService.deckName.set(history.state?.deckName ?? '');
      this.roomService.fetchRoom(code);
    }

    this.navbarCollapse.setNavbarHidden(true);

    this.destroyRef.onDestroy(() => {
      this.navbarCollapse.setNavbarHidden(false);
      this.teardownMenuListener();
      this.roomService.destroy();
      this.animationService.destroy();
      if (isSolo && code) {
        try { sessionStorage.removeItem(`solo-duel-tokens-${code}`); } catch {}
      }
      if (this.switchTimer) clearTimeout(this.switchTimer);
      this.phaseService.clear();
      this.cardDataCache.clearCache();
    });

    // Story 5.2 — visibilitychange listener for background tab recovery
    const visibilityHandler = () => {
      if (document.hidden) {
        // No-op on hide — timestamp not needed (grace period is server-side)
      } else {
        // Tab became visible — check connection and request state sync
        if (this.wsService.connectionStatus() === 'connected' && this.roomState() === 'active') {
          this.a11yEffects.markAwaitingStateSync(this.logicalState().turnCount);
          this.wsService.sendRequestStateSync();
        }
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', visibilityHandler));

    // A11y effects (extracted to DuelA11yEffectsService)
    this.a11yEffects.initEffects({
      logicalState: this.logicalState,
      resultOutcome: this.resultOutcome,
      displayedTimerState: this.displayedTimerState,
      ownPlayerIndex: this.ownPlayerIndex,
    });

    // Animation bridge effects (extracted to DuelAnimationBridgeService)
    this.animBridge.initEffects({
      logicalState: this.logicalState,
      isAnimating: this.isAnimating,
      roomState: this.roomState,
    });

    // Prompt effects (extracted to DuelPromptEffectsService)
    this.promptEffects.initEffects({ activationMode: this.activationMode });

    // Loading effects (extracted to DuelLoadingEffectsService)
    this.loadingEffects.initEffects({
      boardReady: this.boardReady,
      duelLoadingReady: this.duelLoadingReady,
      roomState: this.roomState,
      thumbnailsReady: this.thumbnailsReady,
      loadingTimeout: this.loadingTimeout,
    });

    // Story 3.3 — Connection effects (extracted to DuelConnectionEffectsService)
    this.connEffects.initEffects();


  }

  ngOnInit(): void {
    this.initOrientationLock();
  }

  // --- Template-facing delegations to roomService ---

  deckName(): string {
    return this.roomService.deckName();
  }

  copyRoomLink(): void {
    this.roomService.copyRoomLink();
  }

  shareRoom(): void {
    this.roomService.shareRoom();
  }

  leaveRoom(): void {
    this.roomService.leaveRoom();
  }

  retry(): void {
    this.retryCount.update(c => c + 1);
    this.wsService.retryConnection();
  }

  private endRoomIfNeeded(): void {
    if (this.wsService.duelResult()) return;
    const code = this.roomCode();
    if (code) {
      this.http.post(`/api/rooms/${code}/end`, {}).subscribe();
    }
  }

  backToLobby(): void {
    this.endRoomIfNeeded();
    try { sessionStorage.removeItem('duel-reconnect-token'); } catch {}
    this.router.navigate(['/pvp']);
  }

  backToDeck(): void {
    this.endRoomIfNeeded();
    try { sessionStorage.removeItem('duel-reconnect-token'); } catch {}
    const deckId = this.room()?.decklistId ?? this.roomService.decklistId;
    if (deckId) {
      this.router.navigate(['/decks', deckId]);
    } else {
      this.router.navigate(['/decks']);
    }
  }

  onRematchClick(): void {
    this.wsService.sendRematchRequest();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this._zoneBrowserClickGuard || !this.zoneBrowserState()) return;
    const zoneEl = document.querySelector('app-pvp-zone-browser-overlay');
    if (!zoneEl || !zoneEl.contains(event.target as Node)) {
      zoneEl?.querySelector('.zone-browser')?.classList.add('zone-browser--closing');
      setTimeout(() => this.closeZoneBrowser(), 150);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === 's' && this.isSoloMode() && !event.ctrlKey && !event.altKey && !event.metaKey) {
      this.switchPlayerWithTransition();
    }

    if (event.key === 'Escape') {
      if (this.menuState()) this.closeCardActionMenu();
      else if (this.zoneBrowserState()) this.closeZoneBrowser();
      else if (this.forkReplayId) this.returnToReplay();
      else this.onSurrenderClick();
      event.preventDefault();
    }
  }

  switchPlayerWithTransition(): void {
    if (this.switching()) return;
    this.switching.set(true);
    this.orchestrator.switchPlayer();
    this.switchTimer = setTimeout(() => this.switching.set(false), 200);
  }

  // --- Card Action Menu methods ---

  // [L3 fix] Use visualViewport for mobile-safe bounds checking
  openCardActionMenu(element: HTMLElement, actions: CardAction[], promptType: 'SELECT_IDLECMD' | 'SELECT_BATTLECMD'): void {
    const rect = element.getBoundingClientRect();
    const vpWidth = window.visualViewport?.width ?? window.innerWidth;
    const vpHeight = window.visualViewport?.height ?? window.innerHeight;
    const gap = 10;
    // Initial left approximation (corrected after render using actual width)
    let left = rect.left;
    let top = rect.top - DuelPageComponent.MENU_HEIGHT - gap;
    // Clamp horizontally
    left = Math.max(4, Math.min(left, vpWidth - DuelPageComponent.MENU_WIDTH_WITH_PADDING));
    // If above viewport, place below the card instead
    if (top < 4) {
      top = rect.bottom + gap;
    }
    // If below also overflows, clamp to bottom
    if (top + DuelPageComponent.MENU_HEIGHT > vpHeight) {
      top = Math.max(4, vpHeight - DuelPageComponent.MENU_HEIGHT_WITH_PADDING);
    }

    this.menuState.set({ top, left, actions, promptType });

    this.teardownMenuListener();
    // After the menu renders (next tick), attach click-outside listener to the menu element
    setTimeout(() => {
      const menuEl = document.querySelector('.card-action-menu') as HTMLElement | null;
      if (menuEl) {
        // Correct position using actual rendered dimensions
        const actualHeight = menuEl.offsetHeight;
        const actualWidth = menuEl.offsetWidth;
        const correctedTop = rect.top - actualHeight - gap;
        const centeredLeft = Math.max(4, Math.min(
          rect.left + rect.width / 2 - actualWidth / 2,
          vpWidth - actualWidth - 4,
        ));
        this.menuState.update(s => s ? {
          ...s,
          left: centeredLeft,
          top: correctedTop >= 4 ? correctedTop : s.top,
        } : s);
        this.teardownMenuListener = setupClickOutsideListener(
          { nativeElement: menuEl } as ElementRef,
          this.destroyRef,
          () => this.closeCardActionMenu(),
        );
      }
    });
  }

  closeCardActionMenu(): void {
    this.menuState.set(null);
    this.effectSubMenu.set(null);
    this.teardownMenuListener();
    this.playerHandRow?.selectedIndex.set(null);
  }

  onMenuAction(action: CardAction, event?: MouseEvent): void {
    if (action.children) {
      // Pile grouped actions (children with cardCode) → open prompt card grid
      if (action.children[0]?.cardCode) {
        const menu = this.menuState();
        if (!menu) return;
        this.pileActions = action.children;
        this.pilePromptType = menu.promptType;
        this.pilePrompt.set({
          type: 'SELECT_CARD',
          player: 0,
          min: 1,
          max: 1,
          cancelable: true,
          cards: action.children.map(c => ({
            cardCode: c.cardCode!,
            name: c.cardName ?? '',
            player: 0 as Player,
            location: 0 as any,
            sequence: 0,
            description: c.description,
          })),
        });
        this.closeCardActionMenu();
        return;
      }
      // Same-card effect grouping → sub-menu
      event?.stopPropagation();
      this.effectSubMenu.set(action.children);
      return;
    }
    const menu = this.menuState();
    if (!menu || !this.actionablePrompt()) return;
    this.wsService.sendResponse(menu.promptType, { action: action.actionCode, index: action.index });
    this.closeCardActionMenu();
  }

  onMenuChildAction(action: CardAction): void {
    this.effectSubMenu.set(null);
    this.onMenuAction(action);
  }

  onMenuKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        if (this.effectSubMenu()) {
          this.effectSubMenu.set(null);
        } else {
          this.closeCardActionMenu();
        }
        event.preventDefault();
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const items = Array.from(
          (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]')
        );
        const current = items.indexOf(event.target as HTMLElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = items[(current + delta + items.length) % items.length];
        next?.focus();
        event.preventDefault();
        break;
      }
      case 'Tab':
        event.preventDefault();
        break;
    }
  }

  // --- Board container handlers ---

  onBoardActionResponse(event: { action: number; index: number | null }): void {
    const prompt = this.actionablePrompt();
    if (!prompt) return;
    this.wsService.sendResponse(prompt.type, { action: event.action, index: event.index });
  }

  onBoardMenuRequest(event: { zoneId: ZoneId; element: HTMLElement; actions: CardAction[] }): void {
    const prompt = this.actionablePrompt();
    if (!prompt) return;
    this.openCardActionMenu(event.element, event.actions, prompt.type);
  }

  onZonePillRequest(event: { zoneId: ZoneId; playerIndex: number }): void {
    const player = this.logicalState().players[event.playerIndex];
    if (!player) return;
    this._zoneBrowserClickGuard = true;
    setTimeout(() => this._zoneBrowserClickGuard = false, 0);
    const isPile = event.zoneId === 'GY' || event.zoneId === 'BANISHED' || event.zoneId === 'EXTRA';
    this.zoneBrowserState.set({
      zoneId: event.zoneId,
      cards: getZonePillCards(player.zones, event.zoneId),
      playerIndex: event.playerIndex,
      mode: 'browse',
      reversed: isPile,
      openId: ++this.zoneBrowserOpenId,
    });
  }

  // Story 1.7 — Hand card action handler
  onPlayerHandAction(event: { index: number; element: HTMLElement }): void {
    const prompt = this.actionablePrompt();
    if (!prompt) return;
    const actionMap = prompt.type === 'SELECT_IDLECMD'
      ? buildActionableCardsFromIdle(prompt)
      : buildActionableCardsFromBattle(prompt);
    const key = `${LOCATION.HAND}-${event.index}`;
    const actions = actionMap.get(key) ?? [];
    if (actions.length > 0) {
      this.openCardActionMenu(event.element, actions, prompt.type);
    }
  }

  // --- Card inspection delegations ---

  async inspectCardByCode(cardCode: number, forceExpanded = false): Promise<void> {
    await this.cardInspection.inspectByCode(cardCode, forceExpanded);
  }

  async onCardInspectRequest(event: { cardCode: number; liveCard?: CardOnField }): Promise<void> {
    await this.cardInspection.inspectByCode(event.cardCode, false, event.liveCard);
  }

  async onLongPressInspect(event: { cardCode: number; liveCard?: CardOnField }): Promise<void> {
    await this.cardInspection.inspectByCode(event.cardCode, true, event.liveCard);
  }

  onPreTargetCards(cards: CardInfo[]): void {
    if (cards.length === 0) {
      this.preTargetZoneKeys.set(new Set());
      return;
    }
    const ownIdx = this.ownPlayerIndex();
    const keys = new Set(cards.map(c => {
      const relPlayer = c.player === ownIdx ? 0 : 1;
      return locationToZoneKey(c.location, c.sequence, relPlayer);
    }));
    this.preTargetZoneKeys.set(keys);
  }

  async onOpponentHandInspect(event: { cardCode: number }): Promise<void> {
    if (!event.cardCode) {
      this.cardInspection.showUnknownCard();
    } else {
      await this.cardInspection.inspectByCode(event.cardCode);
    }
  }

  closeInspector(): void {
    this.cardInspection.close();
  }

  // Story 1.7 — Zone browser methods
  closeZoneBrowser(openId?: number): void {
    // If openId is provided, only close if it still matches the current browser session.
    // This prevents a stale close (from click-outside animation timeout) from killing
    // a newly opened zone browser.
    if (openId != null && this.zoneBrowserState()?.openId !== openId) return;
    this.zoneBrowserState.set(null);
  }

  // [H3 fix] Handle actionable card selection from zone browser
  onZoneBrowserAction(event: { cardCode: number; sequence: number; element: HTMLElement }): void {
    const prompt = this.actionablePrompt();
    const zb = this.zoneBrowserState();
    if (!prompt || !zb) return;

    const targetLocation = this.zoneIdToLocation(zb.zoneId);
    if (targetLocation === null) return;

    const actions = this.collectActionsForCardCode(event.cardCode, targetLocation, event.sequence, prompt);

    if (actions.length > 0) {
      this.closeZoneBrowser();
      this.openCardActionMenu(event.element, actions, prompt.type);
    }
  }

  // Story 3.1 — Surrender
  private surrenderDialogOpen = false;

  onSurrenderClick(): void {
    if (this.surrenderDialogOpen) return;
    this.confirmSurrender().subscribe();
  }

  returnToReplay(): void {
    if (!this.forkReplayId) return;
    this.router.navigate(['/pvp/replay', this.forkReplayId], {
      queryParams: { seekTo: this.forkSeekTo },
    });
  }

  confirmSurrender(): Observable<boolean> {
    if (this.surrenderDialogOpen) return of(false);
    this.surrenderDialogOpen = true;
    const dialogRef = this.dialog.open(this.surrenderDialogTpl, {
      role: 'alertdialog',
      ariaLabel: 'Surrender confirmation',
      width: '320px',
      panelClass: ['pvp-dialog-panel', 'pvp-dialog-panel--danger'],
      autoFocus: false,
      disableClose: false,
    });
    return dialogRef.afterClosed().pipe(
      switchMap(confirmed => {
        this.surrenderDialogOpen = false;
        if (!confirmed) return of(false);
        this.wsService.sendSurrender();
        return this.duelResult$.pipe(
          filter(r => !!r),
          take(1),
          map(() => true),
          timeout(5000),
          catchError(() => of(true)),
        );
      }),
    );
  }

  onZoneSelected(zoneKey: string): void {
    const p = this.wsService.pendingPrompt();
    if (p?.type !== 'SELECT_PLACE' && p?.type !== 'SELECT_DISFIELD') return;
    const prompt = p as SelectPlaceMsg | SelectDisfieldMsg;
    const ownIdx = this.ownPlayerIndex();
    const place = prompt.places.find(pl => {
      const id = locationToZoneId(pl.location, pl.sequence);
      const relPlayer = pl.player === ownIdx ? 0 : 1;
      return id ? `${id}-${relPlayer}` === zoneKey : false;
    });
    if (place) {
      this.wsService.sendResponse(prompt.type, { places: [place] });
    }
  }

  // Story 2.3 — Map RPS choice value to SVG icon path
  readonly RPS_ICONS = [
    'assets/images/icons/rps-rock.svg',
    'assets/images/icons/rps-paper.svg',
    'assets/images/icons/rps-scissors.svg',
  ] as const;

  rpsIcon(choice: number): string {
    return this.RPS_ICONS[choice] ?? '';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private collectActionsForCardCode(
    cardCode: number, targetLocation: number, targetSequence: number,
    prompt: SelectIdleCmdMsg | SelectBattleCmdMsg,
  ): CardAction[] {
    const result: CardAction[] = [];
    const addMatches = (cards: CardInfo[], label: string, actionCode: number) => {
      cards.forEach((card, idx) => {
        if (card.cardCode === cardCode && card.location === targetLocation && card.sequence === targetSequence) {
          result.push({ label, actionCode, index: idx });
        }
      });
    };
    // Special Summon entries sourced from pendulum scales (SZONE seq 0/4 in
    // MR5) get the 'Pendulum Summon' label; same dedup discipline as
    // buildActionableCardsFromIdle (OCG emits N identical entries when an
    // effect grants extra Pendulum Summons; YGO doesn't distinguish "which
    // use" the player consumes).
    const addSpecialSummonMatches = (cards: CardInfo[]) => {
      const seenPendulum = new Set<string>();
      cards.forEach((card, idx) => {
        if (card.cardCode !== cardCode || card.location !== targetLocation || card.sequence !== targetSequence) return;
        const isPendulum = card.location === LOCATION.SZONE && (card.sequence === 0 || card.sequence === 4);
        if (isPendulum) {
          const dedupKey = `${card.cardCode}-${card.location}-${card.sequence}`;
          if (seenPendulum.has(dedupKey)) return;
          seenPendulum.add(dedupKey);
        }
        result.push({
          label: isPendulum ? 'Pendulum Summon' : 'Special Summon',
          actionCode: IDLE_ACTION.SPECIAL_SUMMON,
          index: idx,
        });
      });
    };
    if (prompt.type === 'SELECT_IDLECMD') {
      addMatches(prompt.summons, 'Normal Summon', IDLE_ACTION.SUMMON);
      addSpecialSummonMatches(prompt.specialSummons);
      addMatches(prompt.repositions, 'Change Position', IDLE_ACTION.REPOSITION);
      addMatches(prompt.setMonsters, 'Set', IDLE_ACTION.SET_MONSTER);
      addMatches(prompt.activations, 'Activate Effect', IDLE_ACTION.ACTIVATE);
      addMatches(prompt.setSpellTraps, 'Set', IDLE_ACTION.SET_SPELLTP);
    } else {
      addMatches(prompt.attacks, 'Attack', BATTLE_ACTION.ATTACK);
      addMatches(prompt.activations, 'Activate Effect', BATTLE_ACTION.ACTIVATE);
    }
    return result;
  }

  private zoneIdToLocation(zoneId: ZoneId): number | null {
    switch (zoneId) {
      case 'GY': return LOCATION.GRAVE;
      case 'BANISHED': return LOCATION.BANISHED;
      case 'EXTRA': return LOCATION.EXTRA;
      default: return null;
    }
  }


  private getHandCards(playerIndex: number): CardOnField[] {
    const player = this.renderedState().players[playerIndex];
    if (!player) return [];
    const handZone = player.zones.find((z: BoardZone) => z.zoneId === 'HAND');
    return handZone?.cards ?? [];
  }

  private initOrientationLock(): void {
    const mql = window.matchMedia('(orientation: portrait)');
    this.isPortrait.set(mql.matches);

    const handler = (e: MediaQueryListEvent) => this.isPortrait.set(e.matches);
    mql.addEventListener('change', handler);
    this.destroyRef.onDestroy(() => mql.removeEventListener('change', handler));
  }

  private mapDuelEndReason(reason: string, isWinner: boolean): string {
    const side = isWinner ? 'winner' : 'loser';
    const key = `duel.reason.${reason}.${side}`;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : this.translate.instant('duel.reason.unknown');
  }

}
