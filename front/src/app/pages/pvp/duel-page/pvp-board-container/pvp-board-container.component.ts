import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { ChainLinkState } from '../../types';
import { DuelState } from '../../types';
import { BoardZone, CardOnField, LOCATION, Phase, Player, SelectBattleCmdMsg, SelectIdleCmdMsg, ZoneId, TimerStateMsg } from '../../duel-ws.types';
import { isFaceUp, isDefense, getCardImageUrl } from '../../pvp-card.utils';
import { ActionableCardsMap, buildActionableCardsFromBattle, buildActionableCardsFromIdle, CardAction, isActivateAction } from '../idle-action-codes';
import { PvpLpBadgeComponent, LpAnimData } from '../pvp-lp-badge/pvp-lp-badge.component';
import { PvpTimerBadgeComponent } from '../pvp-timer-badge/pvp-timer-badge.component';
import { PvpPhaseBadgeComponent } from '../pvp-phase-badge/pvp-phase-badge.component';

/** Zone IDs that appear in the player/opponent field grid (not EMZ, not HAND) */
const FIELD_ZONE_IDS: ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD', 'GY', 'EXTRA', 'DECK'];

type ZoneRenderMode = 'terrain' | 'pile-faceup' | 'pile-facedown' | 'deck';

/** Maps ZoneId → CSS grid-area name (M1→mz1, S1→st1, etc.) */
const ZONE_GRID_AREA: Record<string, string> = {
  M1: 'mz1', M2: 'mz2', M3: 'mz3', M4: 'mz4', M5: 'mz5',
  S1: 'st1', S2: 'st2', S3: 'st3', S4: 'st4', S5: 'st5',
  FIELD: 'field', GY: 'gy', EXTRA: 'extra', DECK: 'deck',
};

interface ZoneRenderData {
  zoneId: ZoneId;
  card: CardOnField | null;
  cardCount: number;
  renderMode: ZoneRenderMode;
  gridArea: string;
}

@Component({
  selector: 'app-pvp-board-container',
  templateUrl: './pvp-board-container.component.html',
  styleUrl: './pvp-board-container.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, PvpLpBadgeComponent, PvpTimerBadgeComponent, PvpPhaseBadgeComponent],
})
export class PvpBoardContainerComponent {
  readonly duelState = input.required<DuelState>();
  readonly timerState = input<TimerStateMsg | null>(null);
  readonly ownPlayerIndex = input<Player>(0);
  readonly highlightedZones = input<Set<ZoneId>>(new Set());
  readonly actionablePrompt = input<SelectIdleCmdMsg | SelectBattleCmdMsg | null>(null);
  readonly activeChainLinks = input<ChainLinkState[]>([]);
  readonly opponentDisconnected = input(false);
  readonly animatingZone = input<{ zoneId: string; animationType: 'summon' | 'destroy' | 'flip' | 'activate'; relativePlayerIndex: number } | null>(null);
  readonly animatingLp = input<LpAnimData | null>(null);
  readonly displayedPhase = input<Phase | null>(null);
  readonly displayedTurnPlayer = input<Player | null>(null);
  readonly displayedTurnCount = input<number | null>(null);
  readonly zoneSelected = output<ZoneId>();
  readonly actionResponse = output<{ action: number; index: number | null }>();
  readonly menuRequest = output<{ zoneId: ZoneId; element: HTMLElement; actions: CardAction[] }>();
  readonly zonePillRequest = output<{ zoneId: ZoneId; playerIndex: number }>();
  readonly cardInspectRequest = output<{ cardCode: number }>();

  readonly playerZones = computed(() => this.buildFieldZones(0));
  readonly opponentZones = computed(() => this.buildFieldZones(1));

  readonly actionableCards = computed((): ActionableCardsMap => {
    const prompt = this.actionablePrompt();
    if (!prompt) return new Map();
    return prompt.type === 'SELECT_IDLECMD'
      ? buildActionableCardsFromIdle(prompt)
      : buildActionableCardsFromBattle(prompt);
  });

  readonly activateZoneIds = computed((): Set<ZoneId> => {
    const map = this.actionableCards();
    const prompt = this.actionablePrompt();
    if (map.size === 0 || !prompt) return new Set();
    const promptType = prompt.type as 'SELECT_IDLECMD' | 'SELECT_BATTLECMD';
    const zoneIds = new Set<ZoneId>();
    for (const [key, actions] of map) {
      if (actions.some(a => isActivateAction(a.actionCode, promptType))) {
        const parts = key.split('-');
        const zoneId = this.locationSeqToZoneId(parseInt(parts[0], 10), parseInt(parts[1], 10));
        if (zoneId) zoneIds.add(zoneId);
      }
    }
    return zoneIds;
  });

  readonly nonActivateZoneIds = computed((): Set<ZoneId> => {
    const map = this.actionableCards();
    const prompt = this.actionablePrompt();
    if (map.size === 0 || !prompt) return new Set();
    const promptType = prompt.type as 'SELECT_IDLECMD' | 'SELECT_BATTLECMD';
    const zoneIds = new Set<ZoneId>();
    for (const [key, actions] of map) {
      if (actions.some(a => !isActivateAction(a.actionCode, promptType))) {
        const parts = key.split('-');
        const zoneId = this.locationSeqToZoneId(parseInt(parts[0], 10), parseInt(parts[1], 10));
        if (zoneId) zoneIds.add(zoneId);
      }
    }
    return zoneIds;
  });

  readonly playerLp = computed(() => this.duelState().players[0]?.lp ?? 8000);
  readonly opponentLp = computed(() => this.duelState().players[1]?.lp ?? 8000);

  // Story 4.2 — LP animation routing: map absolute player index to relative side
  readonly playerLpAnim = computed(() => {
    const anim = this.animatingLp();
    if (!anim) return null;
    const ownIdx = this.ownPlayerIndex();
    return anim.player === ownIdx ? anim : null;
  });

  readonly opponentLpAnim = computed(() => {
    const anim = this.animatingLp();
    if (!anim) return null;
    const ownIdx = this.ownPlayerIndex();
    return anim.player !== ownIdx ? anim : null;
  });

  readonly playerBanished = computed((): CardOnField | null => this.findZoneCard(0, 'BANISHED'));
  readonly opponentBanished = computed((): CardOnField | null => this.findZoneCard(1, 'BANISHED'));

  readonly playerBanishedCount = computed(() => this.findZoneCardCount(0, 'BANISHED'));
  readonly opponentBanishedCount = computed(() => this.findZoneCardCount(1, 'BANISHED'));

  readonly emzL = computed(() => this.findZoneCard(0, 'EMZ_L') ?? this.findZoneCard(1, 'EMZ_L'));
  readonly emzR = computed(() => this.findZoneCard(0, 'EMZ_R') ?? this.findZoneCard(1, 'EMZ_R'));

  /** H2 refactor: unified EMZ config array for @for loop deduplication */
  protected readonly emzConfigs = computed(() => [
    { zoneId: 'EMZ_L' as ZoneId, zone: this.emzL(), chainBadges: this.emzLChainBadges(), cssClass: 'emz--left' },
    { zoneId: 'EMZ_R' as ZoneId, zone: this.emzR(), chainBadges: this.emzRChainBadges(), cssClass: 'emz--right' },
  ]);

  readonly phase = computed(() => this.displayedPhase() ?? this.duelState().phase);
  readonly turnPlayer = computed(() => this.displayedTurnPlayer() ?? this.duelState().turnPlayer);
  readonly turnCount = computed(() => this.displayedTurnCount() ?? this.duelState().turnCount);
  // Absolute turn player for PvpTimerBadgeComponent (timerState.player is absolute from server)
  readonly absoluteTurnPlayer = computed((): Player => {
    const relativeTurn = this.duelState().turnPlayer;
    const own = this.ownPlayerIndex();
    // relative 0 = "my turn" → absolute = own; relative 1 = "opponent" → absolute = 1 - own
    return (relativeTurn === 0 ? own : (own === 0 ? 1 : 0)) as Player;
  });

  readonly playerDeckCount = computed(() => this.duelState().players[0]?.deckCount ?? 0);
  readonly opponentDeckCount = computed(() => this.duelState().players[1]?.deckCount ?? 0);

  readonly isFaceUp = isFaceUp;
  readonly isDefense = isDefense;
  readonly getCardImageUrl = getCardImageUrl;

  private static readonly MONSTER_ZONES = new Set<ZoneId>(['M1', 'M2', 'M3', 'M4', 'M5']);

  isMonsterDefense(zone: ZoneRenderData): boolean {
    return PvpBoardContainerComponent.MONSTER_ZONES.has(zone.zoneId) && isDefense(zone.card!.position);
  }

  isHighlighted(zoneId: ZoneId): boolean {
    return this.highlightedZones().has(zoneId);
  }

  protected readonly highlightBadgeMap = computed(() => {
    const map = new Map<ZoneId, number>();
    let i = 1;
    for (const zoneId of this.highlightedZones()) {
      map.set(zoneId, i++);
    }
    return map;
  });

  onHighlightedZoneClick(zoneId: ZoneId): void {
    console.log('[ZONE-CLICK] badge clicked zoneId=%s highlighted=%s highlightedSet=%o',
      zoneId, this.isHighlighted(zoneId), [...this.highlightedZones()]);
    if (this.isHighlighted(zoneId)) {
      this.zoneSelected.emit(zoneId);
    }
  }

  onZonePillClick(zoneId: ZoneId, playerIndex: number): void {
    this.zonePillRequest.emit({ zoneId, playerIndex });
  }

  onZoneCardClick(event: MouseEvent, zone: ZoneRenderData): void {
    if (zone.card?.cardCode) {
      this.cardInspectRequest.emit({ cardCode: zone.card.cardCode });
    }
    const actions = this.getActionsForZone(zone.zoneId);
    if (actions.length > 0) {
      this.menuRequest.emit({
        zoneId: zone.zoneId,
        element: event.currentTarget as HTMLElement,
        actions,
      });
    }
  }

  private getActionsForZone(zoneId: ZoneId): CardAction[] {
    const map = this.actionableCards();
    const key = this.zoneIdToLocationKey(zoneId);
    if (!key) return [];
    if (zoneId === 'GY' || zoneId === 'BANISHED' || zoneId === 'EXTRA') {
      const locPrefix = key.split('-')[0] + '-';
      const result: CardAction[] = [];
      for (const [k, v] of map) {
        if (k.startsWith(locPrefix)) result.push(...v);
      }
      return result;
    }
    return map.get(key) ?? [];
  }

  private zoneIdToLocationKey(zoneId: ZoneId): string | null {
    switch (zoneId) {
      case 'M1': return `${LOCATION.MZONE}-0`;
      case 'M2': return `${LOCATION.MZONE}-1`;
      case 'M3': return `${LOCATION.MZONE}-2`;
      case 'M4': return `${LOCATION.MZONE}-3`;
      case 'M5': return `${LOCATION.MZONE}-4`;
      case 'S1': return `${LOCATION.SZONE}-0`;
      case 'S2': return `${LOCATION.SZONE}-1`;
      case 'S3': return `${LOCATION.SZONE}-2`;
      case 'S4': return `${LOCATION.SZONE}-3`;
      case 'S5': return `${LOCATION.SZONE}-4`;
      case 'FIELD': return `${LOCATION.SZONE}-5`;
      case 'GY': return `${LOCATION.GRAVE}-0`;
      case 'BANISHED': return `${LOCATION.BANISHED}-0`;
      case 'EMZ_L': return `${LOCATION.MZONE}-5`;
      case 'EMZ_R': return `${LOCATION.MZONE}-6`;
      case 'EXTRA': return `${LOCATION.EXTRA}-0`;
      default: return null;
    }
  }

  private locationSeqToZoneId(location: number, sequence: number): ZoneId | null {
    if (location === LOCATION.MZONE && sequence === 5) return 'EMZ_L';
    if (location === LOCATION.MZONE && sequence === 6) return 'EMZ_R';
    if (location === LOCATION.MZONE && sequence <= 4) return `M${sequence + 1}` as ZoneId;
    if (location === LOCATION.SZONE && sequence <= 4) return `S${sequence + 1}` as ZoneId;
    if (location === LOCATION.SZONE && sequence === 5) return 'FIELD';
    if (location === LOCATION.GRAVE) return 'GY';
    if (location === LOCATION.BANISHED) return 'BANISHED';
    if (location === LOCATION.EXTRA) return 'EXTRA';
    if (location === LOCATION.HAND) return 'HAND';
    return null;
  }

  private buildFieldZones(playerIndex: number): ZoneRenderData[] {
    const player = this.duelState().players[playerIndex];
    if (!player) return [];

    const zoneMap = new Map<ZoneId, BoardZone>();
    for (const zone of player.zones) {
      zoneMap.set(zone.zoneId, zone);
    }

    return FIELD_ZONE_IDS.map(zoneId => {
      const zone = zoneMap.get(zoneId);
      const cards = zone?.cards ?? [];
      const isPile = zoneId === 'GY' || zoneId === 'BANISHED' || zoneId === 'EXTRA';
      // Pile zones: top of pile = last element (highest OCGCore sequence)
      const card = cards.length > 0 ? (isPile ? cards[cards.length - 1] : cards[0]) : null;

      let renderMode: ZoneRenderMode = 'terrain';
      if (zoneId === 'DECK') renderMode = 'deck';
      else if (zoneId === 'EXTRA') renderMode = 'pile-faceup';
      else if (zoneId === 'GY' || zoneId === 'BANISHED') renderMode = 'pile-faceup';

      return {
        zoneId,
        card,
        cardCount: cards.length,
        renderMode,
        gridArea: ZONE_GRID_AREA[zoneId] ?? zoneId.toLowerCase(),
      };
    });
  }

  /** Pre-computed chain badges grouped by "zoneId-relativePlayerIndex" key */
  protected readonly chainBadgesByZone = computed(() => {
    const map = new Map<string, ChainLinkState[]>();
    const ownIdx = this.ownPlayerIndex();
    for (const link of this.activeChainLinks()) {
      const relPlayer = link.player === ownIdx ? 0 : 1;
      const key = `${link.zoneId}-${relPlayer}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(link);
    }
    return map;
  });

  /** Pre-computed animation state: Set of "zoneId-relativePlayer-type" keys for O(1) template lookup */
  protected readonly animatingZoneKeys = computed(() => {
    const az = this.animatingZone();
    if (!az) return new Set<string>();
    return new Set([`${az.zoneId}-${az.relativePlayerIndex}-${az.animationType}`]);
  });

  /** Pre-computed EMZ animation: Set of "zoneId-type" keys (no player context for EMZ) */
  protected readonly animatingEmzKeys = computed(() => {
    const az = this.animatingZone();
    if (!az) return new Set<string>();
    if (az.zoneId === 'EMZ_L' || az.zoneId === 'EMZ_R') {
      return new Set([`${az.zoneId}-${az.animationType}`]);
    }
    return new Set<string>();
  });

  /** Pre-computed EMZ chain badges */
  protected readonly emzLChainBadges = computed(() =>
    this.activeChainLinks().filter(l => l.zoneId === 'EMZ_L'),
  );

  protected readonly emzRChainBadges = computed(() =>
    this.activeChainLinks().filter(l => l.zoneId === 'EMZ_R'),
  );

  onEmzCardClick(event: MouseEvent, zoneId: ZoneId, card: CardOnField): void {
    if (card.cardCode) {
      this.cardInspectRequest.emit({ cardCode: card.cardCode });
    }
    const actions = this.getActionsForZone(zoneId);
    if (actions.length > 0) {
      this.menuRequest.emit({ zoneId, element: event.currentTarget as HTMLElement, actions });
    }
  }

  onCardInspect(card: CardOnField): void {
    if (card.cardCode) {
      this.cardInspectRequest.emit({ cardCode: card.cardCode });
    }
  }

  private findZoneCard(playerIndex: number, zoneId: ZoneId): CardOnField | null {
    const player = this.duelState().players[playerIndex];
    if (!player) return null;
    const zone = player.zones.find(z => z.zoneId === zoneId);
    return zone?.cards?.[0] ?? null;
  }

  private findZoneCardCount(playerIndex: number, zoneId: ZoneId): number {
    const player = this.duelState().players[playerIndex];
    if (!player) return 0;
    const zone = player.zones.find(z => z.zoneId === zoneId);
    return zone?.cards?.length ?? 0;
  }
}
