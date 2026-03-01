import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, OnInit, signal, TemplateRef, untracked, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, filter, firstValueFrom, interval, map, Observable, of, Subject, switchMap, take, takeUntil, timeout } from 'rxjs';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { displaySuccess, displayError } from '../../../core/utilities/functions';
import { RoomDTO, SHARE_TEXT_TEMPLATE } from '../room.types';
import { RoomApiService } from '../room-api.service';
import { AuthService } from '../../../services/auth.service';
import { DuelWebSocketService } from './duel-web-socket.service';
import { DuelTabGuardService } from './duel-tab-guard.service';
import type { ConnectionStatus, GameEvent } from '../types';
import type { LpAnimData } from './pvp-lp-badge/pvp-lp-badge.component';
import { BoardZone, CardInfo, CardOnField, LOCATION, PlaceOption, POSITION, SelectBattleCmdMsg, SelectChainMsg, SelectDisfieldMsg, SelectIdleCmdMsg, SelectPlaceMsg, ZoneId } from '../duel-ws.types';
import type { MoveMsg, DamageMsg, RecoverMsg, PayLpCostMsg, FlipSummoningMsg, ChangePosMsg, ChainingMsg } from '../duel-ws.types';
import { BATTLE_ACTION, buildActionableCardsFromBattle, buildActionableCardsFromIdle, CardAction, IDLE_ACTION } from './idle-action-codes';
import type { SharedCardInspectorData } from '../../../core/model/shared-card-data';
import type { DeckDTO } from '../../../core/model/dto/deck-dto';
import { getCardImageUrlByCode } from '../pvp-card.utils';
import { CardDataCacheService, CARD_BACK_PLACEHOLDER, UNKNOWN_CARD_PLACEHOLDER } from './card-data-cache.service';
import { PvpBoardContainerComponent } from './pvp-board-container/pvp-board-container.component';
import { PvpHandRowComponent } from './pvp-hand-row/pvp-hand-row.component';
import { PvpPromptSheetComponent } from './prompts/pvp-prompt-sheet/pvp-prompt-sheet.component';
import { PromptZoneHighlightComponent } from './prompts/prompt-zone-highlight/prompt-zone-highlight.component';
import { PvpZoneBrowserOverlayComponent } from './pvp-zone-browser-overlay/pvp-zone-browser-overlay.component';
import { PvpCardInspectorWrapperComponent } from './pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component';
import { ActivationMode, PvpActivationToggleComponent } from './pvp-activation-toggle/pvp-activation-toggle.component';
import { DeckPickerDialogComponent } from '../lobby-page/deck-picker-dialog.component';
import './prompts/prompt-registry';

type RoomState = 'loading' | 'waiting' | 'creating-duel' | 'connecting' | 'duel-loading' | 'active' | 'error';

@Component({
  selector: 'app-duel-page',
  templateUrl: './duel-page.component.html',
  styleUrl: './duel-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DuelWebSocketService, CardDataCacheService, DuelTabGuardService],
  imports: [
    PvpBoardContainerComponent, PvpHandRowComponent, PvpPromptSheetComponent, PromptZoneHighlightComponent,
    PvpZoneBrowserOverlayComponent, PvpCardInspectorWrapperComponent, PvpActivationToggleComponent,
    MatIconButton, MatButton, MatIcon, MatProgressSpinner,
    MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose,
  ],
})
export class DuelPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly wsService = inject(DuelWebSocketService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(Clipboard);
  private readonly roomApiService = inject(RoomApiService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly cardDataCache = inject(CardDataCacheService);
  readonly tabGuard = inject(DuelTabGuardService);

  readonly roomCode = toSignal(this.route.paramMap.pipe(map(params => params.get('roomCode') ?? '')), {
    initialValue: '',
  });

  // Story 2.1 — Room state management
  readonly roomState = signal<RoomState>('loading');
  readonly room = signal<RoomDTO | null>(null);
  readonly deckName = signal('');
  private readonly stopPolling$ = new Subject<void>();
  readonly countdownTick = signal(Date.now());
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  readonly countdown = computed(() => {
    this.countdownTick();
    const r = this.room();
    if (!r) return null;
    const expiresAt = new Date(r.createdAt).getTime() + 30 * 60 * 1000;
    const remaining = Math.max(0, expiresAt - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const color = totalSeconds > 60 ? 'green' : totalSeconds > 30 ? 'yellow' : 'red';
    return { display, color, expired: totalSeconds === 0 };
  });

  readonly canShare = typeof navigator !== 'undefined' && !!navigator.share;

  readonly connectionStatus = this.wsService.connectionStatus;
  readonly isLost = computed(() => this.connectionStatus() === 'lost');
  readonly isReconnecting = computed(() => this.connectionStatus() === 'reconnecting');

  private readonly retryCount = signal(0);
  readonly canRetry = computed(() => this.retryCount() < 3 && this.wsService.canRetry);

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
    const map = prompt.type === 'SELECT_IDLECMD'
      ? buildActionableCardsFromIdle(prompt)
      : buildActionableCardsFromBattle(prompt);
    const indices = new Set<number>();
    for (const key of map.keys()) {
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

  // Room ID for POST /rooms/:id/end on duel end
  private roomId: number | null = null;
  private decklistId: number | null = null;
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

  // Story 1.7 — Card inspector state
  readonly inspectedCard = signal<SharedCardInspectorData | null>(null);
  // H3 fix: Force full mode when opening from long-press inspect
  readonly inspectorForceExpanded = signal(false);
  // L3 fix: Generation counter to prevent race conditions on rapid inspection
  private inspectGeneration = 0;

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

  private menuClickListener: ((e: MouseEvent) => void) | null = null;

  // Story 3.3 — Connection snackbar tracking
  private previousConnectionStatus: ConnectionStatus | null = null;
  private previousOpponentDisconnected: boolean | null = null;

  // Story 3.2 — Timer announcement tracking
  private announcedThresholds = new Set<number>();
  private lastAnnouncedTurnPlayer: number | null = null;

  // Story 5.2 — Background tab recovery
  readonly returningFromBackground = signal(false);
  private lastKnownTurnCount = 0;
  private awaitingStateSyncAfterBackground = false;

  // Story 4.1 — Chain resolved announcement tracking
  private previousChainLinksCount = 0;

  // Story 4.2 — Animation orchestration
  private _isAnimating = signal(false);
  readonly isAnimating = this._isAnimating.asReadonly();
  readonly animatingZone = signal<{ zoneId: string; animationType: 'summon' | 'destroy' | 'flip' | 'activate'; relativePlayerIndex: number } | null>(null);
  readonly animatingLpPlayer = signal<LpAnimData | null>(null);
  private animationTimeouts: ReturnType<typeof setTimeout>[] = [];
  private trackedLp: [number, number] = [8000, 8000];
  // [Review C1 fix] Read LP counter duration from CSS token (0ms under prefers-reduced-motion)
  private readonly baseLpDuration = (() => {
    const style = getComputedStyle(document.documentElement);
    const raw = style.getPropertyValue('--pvp-transition-lp-counter').trim();
    return parseFloat(raw) || 0;
  })();

  // Story 4.2 — Prompt drain: gate prompt display behind animation queue drain
  readonly visiblePrompt = computed(() => this.isAnimating() ? null : this.wsService.pendingPrompt());

  constructor() {
    const code = this.route.snapshot.paramMap.get('roomCode');
    if (code) {
      this.deckName.set(history.state?.deckName ?? '');
      this.fetchRoom(code);
    }
    this.destroyRef.onDestroy(() => {
      this.removeMenuClickListener();
      this.stopPolling$.next();
      this.stopCountdown();
      if (this.rpsAutoDismissTimeout) clearTimeout(this.rpsAutoDismissTimeout);
      if (this.loadingTimeoutRef) clearTimeout(this.loadingTimeoutRef);
      this.animationTimeouts.forEach(t => clearTimeout(t));
      this.animationTimeouts = [];
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
        // If disconnected, existing reconnect logic handles it
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', visibilityHandler));

    // Story 5.2 — STATE_SYNC auto-resolved snackbar + "Board state refreshed" announcer
    // [Review C1 fix] Only fire when awaitingStateSyncAfterBackground is set (not on every turn change)
    // [Review H2 fix] Merged "Board state refreshed" here (was a separate effect with broken tracking)
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
          // Auto-focus the "Take control here" button after render
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
        untracked(() => this.cardDataCache.clearCache());
      }
    });

    // Story 2.1 — Countdown timer tick + expiration
    effect(() => {
      const state = this.roomState();
      untracked(() => {
        if (state === 'waiting' || state === 'creating-duel') {
          this.startCountdown();
        } else {
          this.stopCountdown();
        }
      });
    });

    effect(() => {
      const cd = this.countdown();
      if (cd?.expired) {
        untracked(() => {
          this.stopPolling$.next();
          this.stopCountdown();
          displayError(this.snackBar, 'Room expired');
          this.router.navigate(['/pvp']);
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
          // Auto mode: decline when no MSG_HINT context preceded the prompt
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

    // Story 2.4 — Transition to 'duel-loading' on first BOARD_STATE (guarded: wait for RPS overlay to dismiss)
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

    // Story 2.4 — Transition 'duel-loading' → 'active' when loading ready
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
        // Only announce for own player's timer
        if (ts.player !== this.ownPlayerIndex()) return;

        const totalSec = Math.floor(ts.remainingMs / 1000);
        const thresholds = [60, 30, 10];
        // Pre-seed already-passed thresholds (e.g., after reconnection) to avoid misleading announcements
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
          // Reset announced thresholds on turn change (new countdown)
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

    // Story 4.1 — LiveAnnouncer: "Chain resolved" when chain links go from non-empty → empty
    effect(() => {
      const links = this.wsService.activeChainLinks();
      untracked(() => {
        if (links.length === 0 && this.previousChainLinksCount > 0) {
          this.liveAnnouncer.announce('Chain resolved');
        }
        this.previousChainLinksCount = links.length;
      });
    });

    // Story 4.2 — Animation queue watcher: start processing when queue goes from empty → non-empty
    effect(() => {
      const queue = this.wsService.animationQueue();
      untracked(() => {
        if (queue.length > 0 && !this._isAnimating()) {
          this._isAnimating.set(true);
          this.processAnimationQueue();
        }
      });
    });

    // Story 4.2 — Reset tracked LP when BOARD_STATE arrives (authoritative sync)
    // [Review H1 fix] Guard behind !isAnimating to prevent race condition where
    // BOARD_STATE resets trackedLp before pending MSG_DAMAGE events are processed,
    // causing double-subtraction and LP bounce artifacts.
    effect(() => {
      const state = this.duelState();
      untracked(() => {
        if (state.players.length === 2 && !this._isAnimating()) {
          this.trackedLp = [state.players[0].lp, state.players[1].lp];
        }
      });
    });
  }

  ngOnInit(): void {
    this.initOrientationLock();
  }

  // Story 4.2 — Animation orchestration
  private processAnimationQueue(): void {
    const queue = this.wsService.animationQueue();

    // Queue collapse (AC7): if queue > 5, instantly process all but last 3
    if (queue.length > 5) {
      const collapseCount = queue.length - 3;
      for (let i = 0; i < collapseCount; i++) {
        const event = this.wsService.dequeueAnimation();
        if (event) this.applyInstantAnimation(event);
      }
    }

    const event = this.wsService.dequeueAnimation();
    if (!event) {
      this._isAnimating.set(false);
      this.animatingZone.set(null);
      this.animatingLpPlayer.set(null);
      // [Review H1 fix] Sync trackedLp to authoritative board state after all animations processed
      const state = this.duelState();
      if (state.players.length === 2) {
        this.trackedLp = [state.players[0].lp, state.players[1].lp];
      }
      return;
    }

    const duration = this.processEvent(event);

    // AC8: 2x speed when activation toggle is Off
    const speedMultiplier = this.activationMode() === 'off' ? 0.5 : 1;
    const adjustedDuration = Math.round(duration * speedMultiplier);

    const timeout = setTimeout(() => {
      this.animatingZone.set(null);
      this.animatingLpPlayer.set(null);
      const idx = this.animationTimeouts.indexOf(timeout);
      if (idx !== -1) this.animationTimeouts.splice(idx, 1);
      this.processAnimationQueue();
    }, adjustedDuration);
    this.animationTimeouts.push(timeout);
  }

  private processEvent(event: GameEvent): number {
    switch (event.type) {
      case 'MSG_MOVE': {
        const msg = event as MoveMsg;
        return this.processMoveEvent(msg);
      }
      case 'MSG_DAMAGE': {
        const msg = event as DamageMsg;
        return this.processLpEvent(msg.player, msg.amount, 'damage');
      }
      case 'MSG_RECOVER': {
        const msg = event as RecoverMsg;
        return this.processLpEvent(msg.player, msg.amount, 'recover');
      }
      case 'MSG_PAY_LPCOST': {
        const msg = event as PayLpCostMsg;
        return this.processLpEvent(msg.player, msg.amount, 'damage');
      }
      case 'MSG_FLIP_SUMMONING': {
        const msg = event as FlipSummoningMsg;
        const zoneId = this.mapAnimationZoneId(msg.location, msg.sequence);
        if (zoneId) {
          this.setAnimatingZone(zoneId, 'flip', msg.player);
          this.announceEvent('Card flip summoned', msg.player);
        }
        return 300;
      }
      case 'MSG_CHANGE_POS': {
        const msg = event as ChangePosMsg;
        const wasFaceDown = (msg.previousPosition & (POSITION.FACEDOWN_ATTACK | POSITION.FACEDOWN_DEFENSE)) !== 0;
        const nowFaceUp = (msg.currentPosition & (POSITION.FACEUP_ATTACK | POSITION.FACEUP_DEFENSE)) !== 0;
        if (wasFaceDown && nowFaceUp) {
          const zoneId = this.mapAnimationZoneId(msg.location, msg.sequence);
          if (zoneId) this.setAnimatingZone(zoneId, 'flip', msg.player);
          return 300;
        }
        return 0;
      }
      case 'MSG_CHAINING': {
        const msg = event as ChainingMsg;
        const zoneId = this.mapAnimationZoneId(msg.location, msg.sequence);
        if (zoneId) this.setAnimatingZone(zoneId, 'activate', msg.player);
        return 300;
      }
      // No-op events: dequeue immediately
      case 'MSG_DRAW':
      case 'MSG_SWAP':
      case 'MSG_ATTACK':
      case 'MSG_BATTLE':
      case 'MSG_CHAIN_SOLVING':
      case 'MSG_CHAIN_SOLVED':
      case 'MSG_CHAIN_END':
        return 0;
      default:
        return 0;
    }
  }

  private processMoveEvent(msg: MoveMsg): number {
    const from = msg.fromLocation;
    const to = msg.toLocation;

    // Summon: HAND/EXTRA/DECK → MZONE, or HAND → SZONE (set)
    if ((to === LOCATION.MZONE && (from === LOCATION.HAND || from === LOCATION.EXTRA || from === LOCATION.DECK))
      || (to === LOCATION.SZONE && from === LOCATION.HAND)) {
      const zoneId = this.mapAnimationZoneId(to, msg.toSequence);
      if (zoneId) {
        this.setAnimatingZone(zoneId, 'summon', msg.player);
        this.announceEvent('Card summoned', msg.player);
      }
      return 300;
    }

    // Destroy: MZONE/SZONE → GRAVE/BANISHED/HAND/DECK (card disappears from field)
    // [Review L2 fix] return 300 to match CSS --pvp-animation-duration (was 400, causing 100ms dead time)
    if ((from === LOCATION.MZONE || from === LOCATION.SZONE)
      && (to === LOCATION.GRAVE || to === LOCATION.BANISHED || to === LOCATION.HAND || to === LOCATION.DECK)) {
      const zoneId = this.mapAnimationZoneId(from, msg.fromSequence);
      if (zoneId) {
        this.setAnimatingZone(zoneId, 'destroy', msg.player);
        if (to === LOCATION.GRAVE || to === LOCATION.BANISHED) {
          this.announceEvent('Card destroyed', msg.player);
        }
      }
      return 300;
    }

    return 0;
  }

  private processLpEvent(player: number, amount: number, type: 'damage' | 'recover'): number {
    const fromLp = this.trackedLp[player] ?? 8000;
    const toLp = type === 'damage' ? Math.max(0, fromLp - amount) : fromLp + amount;
    this.trackedLp[player] = toLp;

    // [Review C1/M5 fix] Token-driven LP duration, speed-adjusted. 0ms under prefers-reduced-motion
    const speedMultiplier = this.activationMode() === 'off' ? 0.5 : 1;
    const durationMs = Math.round(this.baseLpDuration * speedMultiplier);
    this.animatingLpPlayer.set({ player, fromLp, toLp, type, durationMs });

    // LiveAnnouncer: announce LP change
    const isOwn = player === this.ownPlayerIndex();
    const label = isOwn ? 'Your' : 'Opponent';
    untracked(() => this.liveAnnouncer.announce(`${label} LP: ${toLp}`));

    return this.baseLpDuration;
  }

  private applyInstantAnimation(event: GameEvent): void {
    // For collapsed events: apply LP tracking without visual animation
    if (event.type === 'MSG_DAMAGE' || event.type === 'MSG_PAY_LPCOST') {
      const msg = event as DamageMsg | PayLpCostMsg;
      this.trackedLp[msg.player] = Math.max(0, (this.trackedLp[msg.player] ?? 8000) - msg.amount);
    } else if (event.type === 'MSG_RECOVER') {
      const msg = event as RecoverMsg;
      this.trackedLp[msg.player] = (this.trackedLp[msg.player] ?? 8000) + msg.amount;
    }
  }

  private setAnimatingZone(zoneId: string, animationType: 'summon' | 'destroy' | 'flip' | 'activate', absolutePlayer: number): void {
    const relativePlayerIndex = absolutePlayer === this.ownPlayerIndex() ? 0 : 1;
    this.animatingZone.set({ zoneId, animationType, relativePlayerIndex });
  }

  private mapAnimationZoneId(location: number, sequence: number): string | null {
    if (location === LOCATION.MZONE) {
      if (sequence <= 4) return `M${sequence + 1}`;
      if (sequence === 5) return 'EMZ_L';
      if (sequence === 6) return 'EMZ_R';
    }
    if (location === LOCATION.SZONE) {
      if (sequence <= 4) return `S${sequence + 1}`;
      if (sequence === 5) return 'FIELD';
    }
    return null;
  }

  private announceEvent(text: string, player: number): void {
    const isOwn = player === this.ownPlayerIndex();
    const prefix = isOwn ? '' : 'Opponent: ';
    untracked(() => this.liveAnnouncer.announce(`${prefix}${text}`));
  }

  private fetchRoom(roomCode: string): void {
    this.roomState.set('loading');
    this.roomApiService.getRoom(roomCode).subscribe({
      next: room => {
        this.roomId = room.id;
        this.decklistId = room.decklistId;
        this.room.set(room);
        this.handleRoomStatus(room);
      },
      error: (err: HttpErrorResponse) => {
        const message = err.status === 404
          ? 'Room not found or already ended'
          : 'Unable to reach server';
        displayError(this.snackBar, message);
        this.router.navigate(['/pvp']);
      },
    });
  }

  private handleRoomStatus(room: RoomDTO): void {
    const currentUserId = this.authService.user()?.id;
    const isParticipant = currentUserId === room.player1.id || (room.player2 !== null && currentUserId === room.player2.id);

    switch (room.status) {
      case 'WAITING':
        if (isParticipant) {
          this.roomState.set('waiting');
          this.startPolling(room.roomCode);
        } else {
          this.openDeckPickerForJoin(room.roomCode);
        }
        break;
      case 'CREATING_DUEL':
        this.roomState.set('creating-duel');
        this.startPolling(room.roomCode);
        break;
      case 'ACTIVE':
        this.connectWhenReady(room);
        break;
      case 'ENDED':
        displayError(this.snackBar, 'Room not found or already ended');
        this.router.navigate(['/pvp']);
        break;
      case 'CLOSED':
        displayError(this.snackBar, 'This room has been closed');
        this.router.navigate(['/pvp']);
        break;
    }
  }

  private openDeckPickerForJoin(roomCode: string, attempt = 0): void {
    if (attempt >= 3) {
      displayError(this.snackBar, 'Too many failed attempts');
      this.router.navigate(['/pvp']);
      return;
    }
    const dialogRef = this.dialog.open(DeckPickerDialogComponent);
    dialogRef.afterClosed().pipe(
      switchMap(decklistId => {
        if (decklistId === undefined || decklistId === null) {
          this.router.navigate(['/pvp']);
          return EMPTY;
        }
        this.decklistId = decklistId;
        return this.roomApiService.joinRoom(roomCode, decklistId);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: room => {
        this.room.set(room);
        this.roomId = room.id;
        this.handleRoomStatus(room);
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 409) {
          displayError(this.snackBar, 'Room is full');
          this.router.navigate(['/pvp']);
        } else if (err.status === 422) {
          displayError(this.snackBar, 'Invalid deck, please select another');
          this.openDeckPickerForJoin(roomCode, attempt + 1);
        } else {
          displayError(this.snackBar, 'Failed to join room');
          this.router.navigate(['/pvp']);
        }
      },
    });
  }

  private connectWhenReady(room: RoomDTO): void {
    this.roomState.set('connecting');
    if (room.wsToken) {
      // Story 5.2 — Init tab guard with room code for single-tab enforcement
      this.tabGuard.init(room.roomCode);
      this.tabGuard.broadcast();
      this.wsService.connect(room.wsToken);
    } else {
      displayError(this.snackBar, 'Unable to connect to duel');
      this.router.navigate(['/pvp']);
    }
  }

  private startPolling(roomCode: string): void {
    this.stopPolling$.next();
    let consecutiveErrors = 0;

    interval(3000).pipe(
      takeUntil(this.stopPolling$),
      takeUntilDestroyed(this.destroyRef),
      switchMap(() => this.roomApiService.getRoom(roomCode).pipe(
        catchError(() => {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            this.stopPolling$.next();
            this.roomState.set('error');
          }
          return EMPTY;
        }),
      )),
    ).subscribe(room => {
      consecutiveErrors = 0;
      this.room.set(room);
      if (room.status === 'WAITING') {
        this.roomState.set('waiting');
      } else if (room.status === 'CREATING_DUEL') {
        this.roomState.set('creating-duel');
      } else if (room.status === 'ACTIVE') {
        this.stopPolling$.next();
        this.connectWhenReady(room);
      } else if (room.status === 'ENDED') {
        this.stopPolling$.next();
        displayError(this.snackBar, 'Room not found or already ended');
        this.router.navigate(['/pvp']);
      }
    });
  }

  // Story 2.1 — Waiting room actions
  copyRoomLink(): void {
    const code = this.room()?.roomCode;
    if (!code) return;
    const url = `${window.location.origin}/pvp/duel/${code}`;
    this.clipboard.copy(url);
    displaySuccess(this.snackBar, 'Link copied!', 3000);
  }

  shareRoom(): void {
    const code = this.room()?.roomCode;
    if (!code) return;
    const baseUrl = window.location.origin;
    navigator.share({
      title: 'skytrix PvP Duel',
      text: SHARE_TEXT_TEMPLATE(code, baseUrl),
    }).catch(() => this.copyRoomLink());
  }

  leaveRoom(): void {
    this.stopPolling$.next();
    this.stopCountdown();
    this.router.navigate(['/pvp']);
  }

  private startCountdown(): void {
    if (this.countdownInterval) return;
    this.countdownInterval = setInterval(() => this.countdownTick.set(Date.now()), 1000);
  }

  private stopCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  retry(): void {
    this.retryCount.update(c => c + 1);
    this.wsService.retryConnection();
  }

  backToLobby(): void {
    if (this.roomId) {
      this.http.post(`/api/rooms/${this.roomId}/end`, {}).subscribe();
    }
    this.router.navigate(['/pvp']);
  }

  backToDeck(): void {
    if (this.roomId) {
      this.http.post(`/api/rooms/${this.roomId}/end`, {}).subscribe();
    }
    const deckId = this.room()?.decklistId ?? this.decklistId;
    if (deckId) {
      this.router.navigate(['/decks', deckId]);
    } else {
      this.router.navigate(['/decks']);
    }
  }

  onRematchClick(): void {
    this.wsService.sendRematchRequest();
  }

  // Card Action Menu methods
  // [L3 fix] Use visualViewport for mobile-safe bounds checking
  openCardActionMenu(element: HTMLElement, actions: CardAction[], promptType: 'SELECT_IDLECMD' | 'SELECT_BATTLECMD'): void {
    const rect = element.getBoundingClientRect();
    const vpWidth = window.visualViewport?.width ?? window.innerWidth;
    const vpHeight = window.visualViewport?.height ?? window.innerHeight;
    let left = rect.right + 4;
    let top = rect.top;

    if (left + 160 > vpWidth) {
      left = rect.left - 164;
    }
    if (top + 200 > vpHeight) {
      top = Math.max(4, vpHeight - 204);
    }

    this.menuState.set({ top, left, actions, promptType });

    this.removeMenuClickListener();
    setTimeout(() => {
      this.menuClickListener = (event: MouseEvent) => {
        if (!(event.target as HTMLElement).closest('.card-action-menu')) {
          this.closeCardActionMenu();
        }
      };
      document.addEventListener('click', this.menuClickListener);
    });
  }

  closeCardActionMenu(): void {
    this.menuState.set(null);
    this.removeMenuClickListener();
  }

  // [L2 fix] Remove unnecessary double casts — ResponseData = Record<string, unknown> accepts any object
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

  // Story 1.7 — Board container handlers
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

  async inspectCardByCode(cardCode: number, forceExpanded = false): Promise<void> {
    this.inspectorForceExpanded.set(forceExpanded);
    const gen = ++this.inspectGeneration;

    if (!cardCode) {
      this.inspectedCard.set(CARD_BACK_PLACEHOLDER);
      return;
    }
    // Show image immediately while loading text details
    this.inspectedCard.set({
      name: '',
      imageUrl: getCardImageUrlByCode(cardCode),
      isMonster: false,
      isLink: false,
      hasDefense: false,
      displayAtk: '',
      displayDef: '',
      description: '',
    });
    const data = await this.cardDataCache.getCardData(cardCode);
    // L3 fix: Discard stale response if a newer inspection was triggered
    if (this.inspectGeneration === gen) {
      this.inspectedCard.set(data);
    }
  }

  async onCardInspectRequest(event: { cardCode: number }): Promise<void> {
    await this.inspectCardByCode(event.cardCode);
  }

  // H3 fix: Long-press inspect opens inspector in full mode despite active prompt
  async onLongPressInspect(event: { cardCode: number }): Promise<void> {
    await this.inspectCardByCode(event.cardCode, true);
  }

  async onOpponentHandInspect(event: { cardCode: number }): Promise<void> {
    if (!event.cardCode) {
      this.inspectorForceExpanded.set(false);
      this.inspectedCard.set(UNKNOWN_CARD_PLACEHOLDER);
    } else {
      await this.inspectCardByCode(event.cardCode);
    }
  }

  closeInspector(): void {
    this.inspectedCard.set(null);
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

  // Story 1.7 — Activation toggle
  onActivationModeChange(mode: ActivationMode): void {
    this.activationMode.set(mode);
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
    if (place.location === LOCATION.MZONE) {
      if (place.sequence <= 4) return `M${place.sequence + 1}` as ZoneId;
      if (place.sequence === 5) return 'EMZ_L';
      if (place.sequence === 6) return 'EMZ_R';
    }
    if (place.location === LOCATION.SZONE) {
      if (place.sequence <= 4) return `S${place.sequence + 1}` as ZoneId;
      if (place.sequence === 5) return 'FIELD';
    }
    return null;
  }

  private getHandCards(playerIndex: number): CardOnField[] {
    const player = this.duelState().players[playerIndex];
    if (!player) return [];
    const handZone = player.zones.find((z: BoardZone) => z.zoneId === 'HAND');
    return handZone?.cards ?? [];
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

      const promises = allCodes.map(code =>
        new Promise<void>(resolve => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = getCardImageUrlByCode(code);
        }),
      );

      await Promise.allSettled(promises);
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

    const promises = cardCodes.map(code =>
      new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = getCardImageUrlByCode(code);
      }),
    );

    Promise.allSettled(promises).then(() => this.thumbnailsReady.set(true));
  }

  private initOrientationLock(): void {
    const mql = window.matchMedia('(orientation: portrait)');
    this.isPortrait.set(mql.matches);

    const handler = (e: MediaQueryListEvent) => this.isPortrait.set(e.matches);
    mql.addEventListener('change', handler);
    this.destroyRef.onDestroy(() => mql.removeEventListener('change', handler));
  }

  private removeMenuClickListener(): void {
    if (this.menuClickListener) {
      document.removeEventListener('click', this.menuClickListener);
      this.menuClickListener = null;
    }
  }

  // Story 2.3 — Map RPS choice value to emoji
  readonly RPS_EMOJIS = ['\u270A', '\u270B', '\u270C\uFE0F'] as const;

  rpsEmoji(choice: number): string {
    return this.RPS_EMOJIS[choice] ?? '\u2753';
  }

  private requestFullscreenAndLock(): void {
    document.documentElement.requestFullscreen?.().catch(() => {});
    (screen.orientation as any).lock?.('landscape-primary')?.catch(() => {});
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
