import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, OnInit, signal, TemplateRef, untracked, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, filter, firstValueFrom, map, Observable, of, switchMap, take, timeout } from 'rxjs';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose } from '@angular/material/dialog';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { displaySuccess, displayError } from '../../../core/utilities/functions';
import { AuthService } from '../../../services/auth.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DuelTabGuardService } from './duel-tab-guard.service';
import type { ConnectionStatus } from '../types';
import { BoardZone, CardInfo, CardOnField, LOCATION, PlaceOption, SelectBattleCmdMsg, SelectChainMsg, SelectDisfieldMsg, SelectIdleCmdMsg, SelectPlaceMsg, ZoneId } from '../duel-ws.types';
import { BATTLE_ACTION, buildActionableCardsFromBattle, buildActionableCardsFromIdle, CardAction, IDLE_ACTION } from './idle-action-codes';
import type { DeckDTO } from '../../../core/model/dto/deck-dto';
import { getCardImageUrlByCode } from '../pvp-card.utils';
import { locationToZoneId } from '../pvp-zone.utils';
import { CardDataCacheService } from './card-data-cache.service';
import { PvpBoardContainerComponent } from './pvp-board-container/pvp-board-container.component';
import { PvpHandRowComponent } from './pvp-hand-row/pvp-hand-row.component';
import { PvpPromptSheetComponent } from './prompts/pvp-prompt-sheet/pvp-prompt-sheet.component';
import { PromptZoneHighlightComponent } from './prompts/prompt-zone-highlight/prompt-zone-highlight.component';
import { PvpZoneBrowserOverlayComponent } from './pvp-zone-browser-overlay/pvp-zone-browser-overlay.component';
import { PvpCardInspectorWrapperComponent } from './pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component';
import { ActivationMode, PvpActivationToggleComponent } from './pvp-activation-toggle/pvp-activation-toggle.component';
import { setupClickOutsideListener } from './click-outside.utils';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { RoomStateMachineService } from './room-state-machine.service';
import { CardInspectionService } from './card-inspection.service';
import { DebugLogService } from './debug-log.service';
import { DebugLogPanelComponent } from './debug-log-panel/debug-log-panel.component';
import { SoloDuelOrchestratorService } from './solo-duel-orchestrator.service';
import { environment } from '../../../../environments/environment';
import './prompts/prompt-registry';

@Component({
  selector: 'app-duel-page',
  templateUrl: './duel-page.component.html',
  styleUrl: './duel-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    DuelWebSocketService, CardDataCacheService, DuelTabGuardService,
    AnimationOrchestratorService, RoomStateMachineService, CardInspectionService,
    DebugLogService, SoloDuelOrchestratorService,
  ],
  imports: [
    PvpBoardContainerComponent, PvpHandRowComponent, PvpPromptSheetComponent, PromptZoneHighlightComponent,
    PvpZoneBrowserOverlayComponent, PvpCardInspectorWrapperComponent, PvpActivationToggleComponent,
    MatIconButton, MatButton, MatIcon, MatProgressSpinner,
    MatButtonToggle, MatButtonToggleGroup,
    MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose,
    DebugLogPanelComponent,
  ],
})
export class DuelPageComponent implements OnInit {
  private static readonly MENU_WIDTH = 160;
  private static readonly MENU_HEIGHT = 200;
  private static readonly MENU_WIDTH_WITH_PADDING = 164;
  private static readonly MENU_HEIGHT_WITH_PADDING = 204;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly wsService = inject(DuelWebSocketService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly cardDataCache = inject(CardDataCacheService);
  readonly tabGuard = inject(DuelTabGuardService);
  readonly debugLog = inject(DebugLogService);
  readonly orchestrator = inject(SoloDuelOrchestratorService);
  readonly isProduction = environment.production;
  readonly isSoloMode = signal(false);

  // --- Extracted services ---
  readonly animationService = inject(AnimationOrchestratorService);
  readonly roomService = inject(RoomStateMachineService);
  readonly cardInspection = inject(CardInspectionService);

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

  private readonly retryCount = signal(0);
  readonly canRetry = computed(() => this.retryCount() < 3 && this.wsService.canRetry());

  // Story 2.3 — Board ready when first BOARD_STATE arrives (both players populated with LP)
  readonly boardReady = computed(() => this.duelState().players.length === 2 && this.duelState().players[0].lp > 0);

  // Story 2.4 — Duel loading: thumbnails pre-cached (or all settled with fallback)
  readonly thumbnailsReady = signal(false);
  readonly duelLoadingReady = computed(() => this.boardReady() && this.thumbnailsReady());
  readonly loadingTimeout = signal(false);
  private loadingTimeoutRef: ReturnType<typeof setTimeout> | null = null;

  readonly isPortrait = signal(false);

  readonly duelState = this.wsService.duelState;
  readonly timerState = this.wsService.timerState;

  readonly playerHand = computed(() => this.getHandCards(0));
  readonly opponentHand = computed(() => this.getHandCards(1));

  // Delegate animation signals to service
  readonly isAnimating = this.animationService.isAnimating;
  readonly animatingZone = this.animationService.animatingZone;
  readonly animatingLpPlayer = this.animationService.animatingLpPlayer;

  // Delegate card inspection signals to service
  readonly inspectedCard = this.cardInspection.inspectedCard;
  readonly inspectorForceExpanded = this.cardInspection.inspectorForceExpanded;

  // Zone highlight (Pattern A — SELECT_PLACE / SELECT_DISFIELD)
  // Story 4.2 — All prompt-dependent computeds use visiblePrompt (drain coordination)
  readonly isZoneHighlightActive = computed(() => {
    const p = this.visiblePrompt();
    return p?.type === 'SELECT_PLACE' || p?.type === 'SELECT_DISFIELD';
  });

  readonly highlightedZones = computed(() => {
    const p = this.visiblePrompt();
    if (p?.type !== 'SELECT_PLACE' && p?.type !== 'SELECT_DISFIELD') return new Set<ZoneId>();
    const places = (p as SelectPlaceMsg | SelectDisfieldMsg).places;
    const zoneIds = places.map(pl => this.placeOptionToZoneId(pl)).filter((z): z is ZoneId => z !== null);
    return new Set(zoneIds);
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

  // Story 1.7 — Own turn detection
  readonly isOwnTurn = computed(() => this.duelState().turnPlayer === 0);

  // Story 1.7 — Hand actionable indices
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

  // [C2 fix] Has active blocking prompt — excludes IDLECMD/BATTLECMD (distributed UI, not blocking)
  // Story 4.2 — uses visiblePrompt for drain coordination
  readonly hasActivePrompt = computed(() => {
    const p = this.visiblePrompt();
    return p !== null && p.type !== 'SELECT_IDLECMD' && p.type !== 'SELECT_BATTLECMD';
  });

  private rpsAutoDismissTimeout: ReturnType<typeof setTimeout> | null = null;
  private prefetchStarted = false;

  // Story 3.1 — Own player index (0 = player1, 1 = player2)
  readonly ownPlayerIndex = computed(() => {
    const r = this.room();
    const userId = this.authService.user()?.id;
    if (!r || !userId) return 0;
    return userId === r.player1.id ? 0 : 1;
  });

  // Story 3.4 — Duel result display with reason mapping
  readonly resultOutcome = computed(() => {
    const result = this.wsService.duelResult();
    if (!result) return null;
    if (result.winner === null) {
      return { outcome: 'draw' as const, reason: this.mapDuelEndReason(result.reason, false) || 'Draw' };
    }
    const isWinner = result.winner === this.ownPlayerIndex();
    const outcome = isWinner ? 'victory' as const : 'defeat' as const;
    const reason = this.mapDuelEndReason(result.reason, isWinner);
    return { outcome, reason };
  });

  // Story 3.4 — Rematch UI state
  readonly rematchButtonLabel = computed(() => {
    switch (this.wsService.rematchState()) {
      case 'idle': return 'Rematch';
      case 'requested': return 'Waiting for opponent...';
      case 'invited': return 'Accept Rematch';
      case 'opponent-left': return 'Opponent left';
      case 'expired': return 'Room expired';
    }
  });

  readonly rematchDisabled = computed(() => {
    const state = this.wsService.rematchState();
    return state === 'requested' || state === 'opponent-left' || state === 'expired';
  });

  // [H1 fix] Track prompt sheet expanded state for mini-toolbar interaction
  readonly promptSheetExpanded = signal(false);

  // Story 1.7 — Activation toggle mode
  readonly activationMode = signal<ActivationMode>('auto');

  // Story 1.7 — Zone browser state
  readonly zoneBrowserState = signal<{
    zoneId: ZoneId;
    cards: CardOnField[];
    playerIndex: number;
    mode: 'browse' | 'action';
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

  // Story 3.1 — duelResult as observable (created in injection context for toObservable)
  private readonly duelResult$ = toObservable(this.wsService.duelResult);

  private teardownMenuListener: () => void = () => {};

  // Story 3.3 — Connection snackbar tracking
  private previousConnectionStatus: ConnectionStatus | null = null;
  private previousOpponentDisconnected: boolean | null = null;

  // Story 3.2 — Timer announcement tracking
  private announcedThresholds = new Set<number>();
  private lastAnnouncedTurnPlayer: number | null = null;

  // Task 16 — Board flip transition for solo player switch
  readonly switching = signal(false);
  private switchTimer: ReturnType<typeof setTimeout> | null = null;

  // Story 5.2 — Background tab recovery
  readonly returningFromBackground = signal(false);
  private lastKnownTurnCount = 0;
  private awaitingStateSyncAfterBackground = false;

  // Story 4.1 — Chain resolved announcement tracking
  private previousChainLinksCount = 0;

  // Story 4.2 — Prompt drain: gate prompt display behind animation queue drain
  readonly visiblePrompt = computed(() => this.isAnimating() ? null : this.wsService.pendingPrompt());

  constructor() {
    // --- Initialize extracted services ---
    this.roomService.init({ wsService: this.wsService, tabGuard: this.tabGuard });
    this.animationService.init({
      wsService: this.wsService,
      liveAnnouncer: this.liveAnnouncer,
      ownPlayerIndex: () => this.ownPlayerIndex(),
      speedMultiplier: () => this.activationMode() === 'off' ? 0.5 : 1,
    });
    this.cardInspection.init(this.cardDataCache);

    // --- Bootstrap room ---
    const code = this.route.snapshot.paramMap.get('roomCode');
    const isSolo = this.route.snapshot.queryParamMap.get('solo') === 'true';

    if (isSolo && code) {
      this.isSoloMode.set(true);
      const wsToken1 = history.state?.wsToken1 as string | undefined;
      const wsToken2 = history.state?.wsToken2 as string | undefined;

      if (!wsToken1 || !wsToken2) {
        displayError(this.snackBar, 'Solo duel session expired');
        this.router.navigate(['/pvp']);
      } else {
        this.orchestrator.init(wsToken1, wsToken2);
        this.roomService.forceState('active');
        this.thumbnailsReady.set(true);

        // Watch for connection loss in solo mode
        effect(() => {
          if (this.orchestrator.connectionLost()) {
            untracked(() => {
              displayError(this.snackBar, 'Connection lost — returning to lobby');
              this.router.navigate(['/pvp']);
            });
          }
        });

        // Handle rematch reset in solo mode — re-set roomState and thumbnailsReady
        // Uses orchestrator.rematchReset counter to avoid race with Effect 2's signal reset
        effect(() => {
          const count = this.orchestrator.rematchReset();
          if (count > 0) {
            untracked(() => {
              this.roomService.forceState('active');
              this.thumbnailsReady.set(true);
            });
          }
        });
      }
    } else if (code) {
      this.roomService.deckName.set(history.state?.deckName ?? '');
      this.roomService.fetchRoom(code);
    }

    this.destroyRef.onDestroy(() => {
      this.teardownMenuListener();
      this.roomService.destroy();
      this.animationService.destroy();
      if (this.rpsAutoDismissTimeout) clearTimeout(this.rpsAutoDismissTimeout);
      if (this.loadingTimeoutRef) clearTimeout(this.loadingTimeoutRef);
      if (this.switchTimer) clearTimeout(this.switchTimer);
      this.cardDataCache.clearCache();
    });

    // Story 5.2 — visibilitychange listener for background tab recovery
    const visibilityHandler = () => {
      if (document.hidden) {
        // No-op on hide — timestamp not needed (grace period is server-side)
      } else {
        // Tab became visible — check connection and request state sync
        this.returningFromBackground.set(true);
        setTimeout(() => { this.returningFromBackground.set(false); }, 500);

        if (this.wsService.connectionStatus() === 'connected' && this.roomState() === 'active') {
          this.lastKnownTurnCount = this.duelState().turnCount;
          this.awaitingStateSyncAfterBackground = true;
          this.wsService.sendRequestStateSync();
        }
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', visibilityHandler));

    // Story 5.2 — STATE_SYNC auto-resolved snackbar + "Board state refreshed" announcer
    effect(() => {
      const state = this.duelState();
      untracked(() => {
        if (!this.awaitingStateSyncAfterBackground) return;
        this.awaitingStateSyncAfterBackground = false;
        if (this.lastKnownTurnCount > 0 && state.turnCount > this.lastKnownTurnCount) {
          const turns = state.turnCount - this.lastKnownTurnCount;
          const msg = turns > 1
            ? `${turns} actions were auto-resolved while away`
            : 'An action was auto-resolved while away';
          this.snackBar.open(msg, '', { duration: 5000 });
          this.liveAnnouncer.announce(msg);
        }
        this.liveAnnouncer.announce('Board state refreshed');
        this.lastKnownTurnCount = state.turnCount;
      });
    });

    // Story 5.2 — Tab guard blocked state announcement + auto-focus button
    effect(() => {
      const blocked = this.tabGuard.isBlocked();
      if (blocked) {
        untracked(() => {
          this.liveAnnouncer.announce('Duel active in another tab');
          setTimeout(() => {
            const btn = document.querySelector<HTMLButtonElement>('.blocked-tab-overlay__btn');
            btn?.focus();
          });
        });
      }
    });

    // Story 5.1 — Clear card data cache on rematch
    effect(() => {
      const starting = this.wsService.rematchStarting();
      if (starting) {
        untracked(() => {
          this.cardDataCache.clearCache();
          this.debugLog.clearLogs();
        });
      }
    });

    // Story 2.1 — Countdown timer tick + expiration (delegates to roomService)
    effect(() => {
      const state = this.roomState();
      untracked(() => {
        if (state === 'waiting' || state === 'creating-duel') {
          this.roomService.startCountdown();
        } else {
          this.roomService.stopCountdown();
        }
      });
    });

    effect(() => {
      const cd = this.countdown();
      if (cd?.expired) {
        untracked(() => {
          displayError(this.snackBar, 'Room expired');
          this.roomService.leaveRoom();
        });
      }
    });

    // [H4 fix] Activation toggle auto-respond effect (off + auto modes)
    effect(() => {
      const mode = this.activationMode();
      const prompt = this.wsService.pendingPrompt();
      if (!prompt || mode === 'on') return;

      untracked(() => {
        const isOptionalEffectYn = prompt.type === 'SELECT_EFFECTYN';
        const isOptionalChain = prompt.type === 'SELECT_CHAIN' && !(prompt as SelectChainMsg).forced;
        if (!isOptionalEffectYn && !isOptionalChain) return;

        let shouldAutoRespond = false;

        if (mode === 'off') {
          shouldAutoRespond = true;
        } else if (mode === 'auto') {
          const hint = this.wsService.hintContext();
          shouldAutoRespond = hint.hintType === 0;
        }

        if (!shouldAutoRespond) return;

        if (isOptionalEffectYn) {
          this.wsService.sendResponse('SELECT_EFFECTYN', { yes: false });
        } else if (isOptionalChain) {
          this.wsService.sendResponse('SELECT_CHAIN', { index: null });
        }
      });
    });

    // Story 2.4 — Transition to 'duel-loading' on first BOARD_STATE
    effect(() => {
      const ready = this.boardReady();
      const rpsVisible = this.wsService.rpsResult();
      if (ready && !rpsVisible && this.roomState() === 'connecting') {
        untracked(() => this.roomState.set('duel-loading'));
      }
    });

    // Story 2.4 — When entering 'duel-loading', start thumbnail pre-fetch + 15s timeout
    effect(() => {
      const state = this.roomState();
      if (state === 'duel-loading' && !this.prefetchStarted) {
        untracked(() => {
          this.prefetchStarted = true;
          this.preFetchDeckThumbnails();
          this.loadingTimeoutRef = setTimeout(() => {
            if (this.roomState() === 'duel-loading') {
              this.loadingTimeout.set(true);
            }
          }, 15000);
        });
      }
    });

    // Story 2.4 — Transition 'duel-loading' -> 'active' when loading ready
    effect(() => {
      const ready = this.duelLoadingReady();
      if (ready && this.roomState() === 'duel-loading') {
        untracked(() => {
          if (this.loadingTimeoutRef) {
            clearTimeout(this.loadingTimeoutRef);
            this.loadingTimeoutRef = null;
          }
          this.roomState.set('active');
        });
      }
    });

    // [Review M1 fix] Defer fullscreen + landscape lock until duel is active
    effect(() => {
      if (this.roomState() === 'active') {
        untracked(() => this.requestFullscreenAndLock());
      }
    });

    // Story 2.3 — RPS result auto-dismiss (3s winner, 2s draw)
    effect(() => {
      const rps = this.wsService.rpsResult();
      if (!rps) return;
      untracked(() => {
        if (this.rpsAutoDismissTimeout) clearTimeout(this.rpsAutoDismissTimeout);
        const duration = rps.winner !== null ? 3000 : 2000;
        this.rpsAutoDismissTimeout = setTimeout(() => this.wsService.clearRpsResult(), duration);
      });
    });

    // Story 3.4 — LiveAnnouncer announces duel result
    effect(() => {
      const result = this.resultOutcome();
      if (!result) return;
      untracked(() => {
        const outcomeText = result.outcome === 'victory' ? 'Victory' : result.outcome === 'defeat' ? 'Defeat' : 'Draw';
        this.liveAnnouncer.announce(`${outcomeText} — ${result.reason}`);
      });
    });

    // Story 3.2 — LiveAnnouncer timer warnings at 60s, 30s, 10s (own timer only)
    effect(() => {
      const ts = this.timerState();
      if (!ts) return;
      untracked(() => {
        if (ts.player !== this.ownPlayerIndex()) return;

        const totalSec = Math.floor(ts.remainingMs / 1000);
        const thresholds = [60, 30, 10];
        for (const t of thresholds) {
          if (totalSec < t && !this.announcedThresholds.has(t)) {
            this.announcedThresholds.add(t);
          }
        }
        for (const t of thresholds) {
          if (totalSec <= t && !this.announcedThresholds.has(t)) {
            this.announcedThresholds.add(t);
            this.liveAnnouncer.announce(`${t} seconds remaining`);
            break;
          }
        }
      });
    });

    // Story 3.2 — Announce turn changes
    effect(() => {
      const turnPlayer = this.duelState().turnPlayer;
      untracked(() => {
        if (this.lastAnnouncedTurnPlayer === null) {
          this.lastAnnouncedTurnPlayer = turnPlayer;
          return;
        }
        if (turnPlayer !== this.lastAnnouncedTurnPlayer) {
          this.lastAnnouncedTurnPlayer = turnPlayer;
          this.announcedThresholds.clear();
          const msg = turnPlayer === 0 ? 'Your turn' : "Opponent's turn";
          this.liveAnnouncer.announce(msg);
        }
      });
    });

    // Story 3.3 — "Connection restored" snackbar on reconnection
    effect(() => {
      const current = this.wsService.connectionStatus();
      const prev = this.previousConnectionStatus;
      untracked(() => {
        if (prev === 'reconnecting' && current === 'connected') {
          displaySuccess(this.snackBar, 'Connection restored');
          this.liveAnnouncer.announce('Connection restored');
        }
        this.previousConnectionStatus = current;
      });
    });

    // Story 3.3 — "Opponent reconnected" snackbar
    effect(() => {
      const current = this.wsService.opponentDisconnected();
      const prev = this.previousOpponentDisconnected;
      untracked(() => {
        if (prev === true && current === false && !this.wsService.duelResult()) {
          displaySuccess(this.snackBar, 'Opponent reconnected');
        }
        this.previousOpponentDisconnected = current;
      });
    });

    // Story 4.1 — LiveAnnouncer: "Chain resolved" when chain links go from non-empty -> empty
    effect(() => {
      const links = this.wsService.activeChainLinks();
      untracked(() => {
        if (links.length === 0 && this.previousChainLinksCount > 0) {
          this.liveAnnouncer.announce('Chain resolved');
        }
        this.previousChainLinksCount = links.length;
      });
    });

    // Story 4.2 — Animation queue watcher: delegate to animation service
    effect(() => {
      const queue = this.wsService.animationQueue();
      untracked(() => {
        if (queue.length > 0) {
          this.animationService.startProcessingIfIdle();
        }
      });
    });

    // Story 4.2 — Reset tracked LP when BOARD_STATE arrives (authoritative sync)
    effect(() => {
      const state = this.duelState();
      untracked(() => {
        if (state.players.length === 2 && !this.isAnimating()) {
          this.animationService.syncTrackedLp(state.players[0].lp, state.players[1].lp);
        }
      });
    });
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
    if (this.roomService.roomId) {
      this.http.post(`/api/rooms/${this.roomService.roomId}/end`, {}).subscribe();
    }
  }

  backToLobby(): void {
    this.endRoomIfNeeded();
    this.router.navigate(['/pvp']);
  }

  backToDeck(): void {
    this.endRoomIfNeeded();
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

  onFirstPlayerToggle(value: string): void {
    this.orchestrator.firstPlayer.set(value === 'p1' ? 0 : 1);
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
    let left = rect.right + 4;
    let top = rect.top;

    if (left + DuelPageComponent.MENU_WIDTH > vpWidth) {
      left = rect.left - DuelPageComponent.MENU_WIDTH_WITH_PADDING;
    }
    if (top + DuelPageComponent.MENU_HEIGHT > vpHeight) {
      top = Math.max(4, vpHeight - DuelPageComponent.MENU_HEIGHT_WITH_PADDING);
    }

    this.menuState.set({ top, left, actions, promptType });

    this.teardownMenuListener();
    // After the menu renders (next tick), attach click-outside listener to the menu element
    setTimeout(() => {
      const menuEl = document.querySelector('.card-action-menu') as HTMLElement | null;
      if (menuEl) {
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
    this.teardownMenuListener();
  }

  onMenuAction(action: CardAction): void {
    const menu = this.menuState();
    if (!menu || !this.actionablePrompt()) return;
    this.wsService.sendResponse(menu.promptType, { action: action.actionCode, index: action.index });
    this.closeCardActionMenu();
  }

  onMenuKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        this.closeCardActionMenu();
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

  // [M4 fix] Block zone browser when a blocking prompt (non-IDLECMD/BATTLECMD) is active
  onZonePillRequest(event: { zoneId: ZoneId; playerIndex: number }): void {
    if (this.hasActivePrompt()) return;

    const player = this.duelState().players[event.playerIndex];
    if (!player) return;
    const zone = player.zones.find((z: BoardZone) => z.zoneId === event.zoneId);
    const cards = zone?.cards ?? [];
    const hasActions = this.actionablePrompt() !== null;
    this.zoneBrowserState.set({
      zoneId: event.zoneId,
      cards,
      playerIndex: event.playerIndex,
      mode: hasActions && event.playerIndex === 0 ? 'action' : 'browse',
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
    if (actions.length === 1) {
      this.wsService.sendResponse(prompt.type, { action: actions[0].actionCode, index: actions[0].index });
    } else if (actions.length > 1) {
      this.openCardActionMenu(event.element, actions, prompt.type);
    }
  }

  // --- Card inspection delegations ---

  async inspectCardByCode(cardCode: number, forceExpanded = false): Promise<void> {
    await this.cardInspection.inspectByCode(cardCode, forceExpanded);
  }

  async onCardInspectRequest(event: { cardCode: number }): Promise<void> {
    await this.cardInspection.inspectByCode(event.cardCode);
  }

  async onLongPressInspect(event: { cardCode: number }): Promise<void> {
    await this.cardInspection.inspectByCode(event.cardCode, true);
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
  closeZoneBrowser(): void {
    this.zoneBrowserState.set(null);
  }

  // [H3 fix] Handle actionable card selection from zone browser
  onZoneBrowserAction(event: { cardCode: number; element: HTMLElement }): void {
    const prompt = this.actionablePrompt();
    const zb = this.zoneBrowserState();
    if (!prompt || !zb) return;

    const targetLocation = this.zoneIdToLocation(zb.zoneId);
    if (targetLocation === null) return;

    const actions = this.collectActionsForCardCode(event.cardCode, targetLocation, prompt);

    if (actions.length === 1) {
      this.wsService.sendResponse(prompt.type, { action: actions[0].actionCode, index: actions[0].index });
      this.closeZoneBrowser();
    } else if (actions.length > 1) {
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

  confirmSurrender(): Observable<boolean> {
    if (this.surrenderDialogOpen) return of(false);
    this.surrenderDialogOpen = true;
    const dialogRef = this.dialog.open(this.surrenderDialogTpl, {
      role: 'alertdialog',
      ariaLabel: 'Surrender confirmation',
      width: '320px',
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

  onZoneSelected(zoneId: ZoneId): void {
    const p = this.wsService.pendingPrompt();
    if (p?.type !== 'SELECT_PLACE' && p?.type !== 'SELECT_DISFIELD') return;
    const prompt = p as SelectPlaceMsg | SelectDisfieldMsg;
    const place = prompt.places.find(pl => this.placeOptionToZoneId(pl) === zoneId);
    if (place) {
      this.wsService.sendResponse(prompt.type, { places: [place] });
    }
  }

  // Story 2.3 — Map RPS choice value to emoji
  readonly RPS_EMOJIS = ['\u270A', '\u270B', '\u270C\uFE0F'] as const;

  rpsEmoji(choice: number): string {
    return this.RPS_EMOJIS[choice] ?? '\u2753';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private collectActionsForCardCode(
    cardCode: number, targetLocation: number,
    prompt: SelectIdleCmdMsg | SelectBattleCmdMsg,
  ): CardAction[] {
    const result: CardAction[] = [];
    const addMatches = (cards: CardInfo[], label: string, actionCode: number) => {
      cards.forEach((card, idx) => {
        if (card.cardCode === cardCode && card.location === targetLocation) {
          result.push({ label, actionCode, index: idx });
        }
      });
    };
    if (prompt.type === 'SELECT_IDLECMD') {
      addMatches(prompt.summons, 'Normal Summon', IDLE_ACTION.SUMMON);
      addMatches(prompt.specialSummons, 'Special Summon', IDLE_ACTION.SPECIAL_SUMMON);
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

  private placeOptionToZoneId(place: PlaceOption): ZoneId | null {
    return locationToZoneId(place.location, place.sequence);
  }

  private getHandCards(playerIndex: number): CardOnField[] {
    const player = this.duelState().players[playerIndex];
    if (!player) return [];
    const handZone = player.zones.find((z: BoardZone) => z.zoneId === 'HAND');
    return handZone?.cards ?? [];
  }

  /** Pre-load a list of card images into the browser cache. Resolves when all are attempted. */
  private preloadImages(codes: number[]): Promise<void> {
    const promises = codes.map(code => new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = getCardImageUrlByCode(code);
    }));
    return Promise.allSettled(promises).then(() => {});
  }

  // Story 5.4 — Pre-fetch ALL own deck card thumbnails (main + extra) via deck API
  private async preFetchDeckThumbnails(): Promise<void> {
    const decklistId = this.room()?.decklistId;
    if (!decklistId) {
      this.preFetchHandThumbnails();
      return;
    }

    try {
      const deck = await firstValueFrom(this.http.get<DeckDTO>(`/api/decks/${decklistId}`));
      const allCodes = [...new Set([
        ...deck.mainDeck.map(entry => entry.card.card.passcode),
        ...deck.extraDeck.map(entry => entry.card.card.passcode),
      ].filter((code): code is number => !!code && code > 0))];

      await this.preloadImages(allCodes);
    } catch {
      // API failure — proceed without full pre-fetch
    }

    this.thumbnailsReady.set(true);
  }

  // Fallback: pre-fetch hand cards only (when decklistId unavailable)
  private preFetchHandThumbnails(): void {
    const player = this.duelState().players[0];
    if (!player) {
      this.thumbnailsReady.set(true);
      return;
    }
    const handZone = player.zones.find((z: BoardZone) => z.zoneId === 'HAND');
    const handCards = handZone?.cards ?? [];
    const cardCodes = handCards.map(c => c.cardCode).filter((code): code is number => !!code);

    if (cardCodes.length === 0) {
      this.thumbnailsReady.set(true);
      return;
    }

    this.preloadImages(cardCodes).then(() => this.thumbnailsReady.set(true));
  }

  private initOrientationLock(): void {
    const mql = window.matchMedia('(orientation: portrait)');
    this.isPortrait.set(mql.matches);

    const handler = (e: MediaQueryListEvent) => this.isPortrait.set(e.matches);
    mql.addEventListener('change', handler);
    this.destroyRef.onDestroy(() => mql.removeEventListener('change', handler));
  }

  private requestFullscreenAndLock(): void {
    document.documentElement.requestFullscreen?.().catch(() => {});
    // @ts-expect-error — screen.orientation.lock is non-standard but supported on mobile
    screen.orientation.lock?.('landscape-primary')?.catch(() => {});
  }

  private mapDuelEndReason(reason: string, isWinner: boolean): string {
    const subject = isWinner ? 'Opponent' : 'You';
    switch (reason) {
      case 'win': return isWinner ? 'Opponent LP reduced to 0' : 'Your LP reduced to 0';
      case 'surrender': return `${subject} surrendered`;
      case 'timeout': return `${subject} timed out`;
      case 'inactivity': return isWinner ? 'Opponent inactive' : 'You were inactive';
      case 'disconnect': return `${subject} disconnected`;
      case 'draw_both_disconnect': return 'Both players disconnected';
      default: return reason;
    }
  }
}
