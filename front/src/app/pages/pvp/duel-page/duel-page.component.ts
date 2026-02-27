import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { DuelWebSocketService } from './duel-web-socket.service';
import { BoardZone, CardInfo, CardOnField, LOCATION, PlaceOption, SelectBattleCmdMsg, SelectChainMsg, SelectDisfieldMsg, SelectIdleCmdMsg, SelectPlaceMsg, ZoneId } from '../duel-ws.types';
import { BATTLE_ACTION, buildActionableCardsFromBattle, buildActionableCardsFromIdle, CardAction, IDLE_ACTION } from './idle-action-codes';
import { SharedCardInspectorData } from '../../../core/model/shared-card-data';
import { getCardImageUrlByCode } from '../pvp-card.utils';
import { PvpBoardContainerComponent } from './pvp-board-container/pvp-board-container.component';
import { PvpHandRowComponent } from './pvp-hand-row/pvp-hand-row.component';
import { PvpPromptSheetComponent } from './prompts/pvp-prompt-sheet/pvp-prompt-sheet.component';
import { PromptZoneHighlightComponent } from './prompts/prompt-zone-highlight/prompt-zone-highlight.component';
import { PvpZoneBrowserOverlayComponent } from './pvp-zone-browser-overlay/pvp-zone-browser-overlay.component';
import { PvpCardInspectorWrapperComponent } from './pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component';
import { ActivationMode, PvpActivationToggleComponent } from './pvp-activation-toggle/pvp-activation-toggle.component';
import './prompts/prompt-registry';

interface RoomResponse {
  id: number;
  roomCode: string;
  status: string;
  duelId: string | null;
  wsToken: string | null;
}

@Component({
  selector: 'app-duel-page',
  templateUrl: './duel-page.component.html',
  styleUrl: './duel-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DuelWebSocketService],
  imports: [
    PvpBoardContainerComponent, PvpHandRowComponent, PvpPromptSheetComponent, PromptZoneHighlightComponent,
    PvpZoneBrowserOverlayComponent, PvpCardInspectorWrapperComponent, PvpActivationToggleComponent,
    MatIconButton, MatIcon,
  ],
})
export class DuelPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly wsService = inject(DuelWebSocketService);

  readonly roomCode = toSignal(this.route.paramMap.pipe(map(params => params.get('roomCode') ?? '')), {
    initialValue: '',
  });

  readonly connectionStatus = this.wsService.connectionStatus;
  readonly isLost = computed(() => this.connectionStatus() === 'lost');
  readonly isReconnecting = computed(() => this.connectionStatus() === 'reconnecting');

  private readonly retryCount = signal(0);
  readonly canRetry = computed(() => this.retryCount() < 3 && this.wsService.canRetry);

  readonly isPortrait = signal(false);

  readonly duelState = this.wsService.duelState;
  readonly timerState = this.wsService.timerState;

  readonly playerHand = computed(() => this.getHandCards(0));
  readonly opponentHand = computed(() => this.getHandCards(1));

  // Zone highlight (Pattern A — SELECT_PLACE / SELECT_DISFIELD)
  readonly isZoneHighlightActive = computed(() => {
    const p = this.wsService.pendingPrompt();
    return p?.type === 'SELECT_PLACE' || p?.type === 'SELECT_DISFIELD';
  });

  readonly highlightedZones = computed(() => {
    const p = this.wsService.pendingPrompt();
    if (p?.type !== 'SELECT_PLACE' && p?.type !== 'SELECT_DISFIELD') return new Set<ZoneId>();
    const places = (p as SelectPlaceMsg | SelectDisfieldMsg).places;
    const zoneIds = places.map(pl => this.placeOptionToZoneId(pl)).filter((z): z is ZoneId => z !== null);
    return new Set(zoneIds);
  });

  readonly zoneInstruction = computed(() => {
    const p = this.wsService.pendingPrompt();
    if (p?.type === 'SELECT_PLACE') return 'Select a zone to place your card';
    if (p?.type === 'SELECT_DISFIELD') return 'Select a zone to destroy';
    return '';
  });

  // Story 1.7 — Actionable prompt (IDLECMD/BATTLECMD distributed UI)
  readonly actionablePrompt = computed((): SelectIdleCmdMsg | SelectBattleCmdMsg | null => {
    const p = this.wsService.pendingPrompt();
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
  readonly hasActivePrompt = computed(() => {
    const p = this.wsService.pendingPrompt();
    return p !== null && p.type !== 'SELECT_IDLECMD' && p.type !== 'SELECT_BATTLECMD';
  });

  // Room ID for POST /rooms/:id/end on duel end
  private roomId: number | null = null;

  // Story 1.7 — Card inspector state
  readonly inspectedCard = signal<SharedCardInspectorData | null>(null);

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

  private menuClickListener: ((e: MouseEvent) => void) | null = null;

  constructor() {
    const code = this.route.snapshot.paramMap.get('roomCode');
    if (code) {
      this.fetchRoomAndConnect(code);
    }
    this.destroyRef.onDestroy(() => this.removeMenuClickListener());

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

    // H1 fix — notify Spring Boot that the duel ended
    effect(() => {
      const result = this.wsService.duelResult();
      if (!result) return;
      untracked(() => {
        if (this.roomId) {
          this.http.post(`/api/rooms/${this.roomId}/end`, {}).subscribe();
        }
      });
    });
  }

  ngOnInit(): void {
    this.initOrientationLock();
    this.requestFullscreenAndLock();
  }

  private fetchRoomAndConnect(roomCode: string): void {
    this.http.get<RoomResponse>(`/api/rooms/${roomCode}`).subscribe({
      next: room => {
        this.roomId = room.id;
        if (room.wsToken) {
          this.wsService.connect(room.wsToken);
        } else {
          this.router.navigate(['/pvp']);
        }
      },
      error: () => {
        this.router.navigate(['/pvp']);
      },
    });
  }

  retry(): void {
    this.retryCount.update(c => c + 1);
    this.wsService.retryConnection();
  }

  backToLobby(): void {
    this.router.navigate(['/pvp']);
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

  // [C1 fix] Build a proper SharedCardInspectorData with available fields
  inspectCardByCode(cardCode: number): void {
    this.inspectedCard.set({
      name: `Card #${cardCode}`,
      imageUrl: getCardImageUrlByCode(cardCode),
      isMonster: false,
      isLink: false,
      hasDefense: false,
      displayAtk: '',
      displayDef: '',
      description: '',
    });
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

  private requestFullscreenAndLock(): void {
    document.documentElement.requestFullscreen?.().catch(() => {});
    (screen.orientation as any).lock?.('landscape-primary')?.catch(() => {});
  }
}