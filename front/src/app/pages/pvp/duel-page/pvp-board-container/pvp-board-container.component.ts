import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ChainLinkState } from '../../types';
import { DuelState } from '../../types';
import { BoardZone, CardOnField, LOCATION, Player, SelectBattleCmdMsg, SelectIdleCmdMsg, ZoneId, TimerStateMsg } from '../../duel-ws.types';
import { isFaceUp, isDefense, getCardImageUrl } from '../../pvp-card.utils';
import { ActionableCardsMap, buildActionableCardsFromBattle, buildActionableCardsFromIdle, CardAction } from '../idle-action-codes';
import { PvpLpBadgeComponent, LpAnimData } from '../pvp-lp-badge/pvp-lp-badge.component';
import { PvpTimerBadgeComponent } from '../pvp-timer-badge/pvp-timer-badge.component';
import { PvpPhaseBadgeComponent } from '../pvp-phase-badge/pvp-phase-badge.component';

/** Zone IDs that appear in the player/opponent field grid (not EMZ, not HAND) */
const FIELD_ZONE_IDS: ZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD', 'GY', 'BANISHED', 'EXTRA', 'DECK'];

/** Pill zones that show count badges */
const PILL_ZONE_IDS: ZoneId[] = ['GY', 'BANISHED', 'EXTRA'];

/** Maps ZoneId → CSS grid-area name (M1→mz1, S1→st1, etc.) */
const ZONE_GRID_AREA: Record<string, string> = {
  M1: 'mz1', M2: 'mz2', M3: 'mz3', M4: 'mz4', M5: 'mz5',
  S1: 'st1', S2: 'st2', S3: 'st3', S4: 'st4', S5: 'st5',
  FIELD: 'field', GY: 'gy', BANISHED: 'banished', EXTRA: 'extra', DECK: 'deck',
};

interface ZoneRenderData {
  zoneId: ZoneId;
  card: CardOnField | null;
  cardCount: number;
  isPill: boolean;
  isDeck: boolean;
  gridArea: string;
}

@Component({
  selector: 'app-pvp-board-container',
  templateUrl: './pvp-board-container.component.html',
  styleUrl: './pvp-board-container.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PvpLpBadgeComponent, PvpTimerBadgeComponent, PvpPhaseBadgeComponent],
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
  readonly zoneSelected = output<ZoneId>();
  readonly actionResponse = output<{ action: number; index: number | null }>();
  readonly menuRequest = output<{ zoneId: ZoneId; element: HTMLElement; actions: CardAction[] }>();
  readonly zonePillRequest = output<{ zoneId: ZoneId; playerIndex: number }>();

  readonly playerZones = computed(() => this.buildFieldZones(0));
  readonly opponentZones = computed(() => this.buildFieldZones(1));

  readonly actionableCards = computed((): ActionableCardsMap => {
    const prompt = this.actionablePrompt();
    if (!prompt) return new Map();
    return prompt.type === 'SELECT_IDLECMD'
      ? buildActionableCardsFromIdle(prompt)
      : buildActionableCardsFromBattle(prompt);
  });

  readonly actionableZoneIds = computed((): Set<ZoneId> => {
    const map = this.actionableCards();
    if (map.size === 0) return new Set();
    const zoneIds = new Set<ZoneId>();
    for (const key of map.keys()) {
      const parts = key.split('-');
      const zoneId = this.locationSeqToZoneId(parseInt(parts[0], 10), parseInt(parts[1], 10));
      if (zoneId) zoneIds.add(zoneId);
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

  readonly emzL = computed(() => this.findZoneCard(0, 'EMZ_L') ?? this.findZoneCard(1, 'EMZ_L'));
  readonly emzR = computed(() => this.findZoneCard(0, 'EMZ_R') ?? this.findZoneCard(1, 'EMZ_R'));

  readonly phase = computed(() => this.duelState().phase);
  readonly turnPlayer = computed(() => this.duelState().turnPlayer);
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

  isHighlighted(zoneId: ZoneId): boolean {
    return this.highlightedZones().has(zoneId);
  }

  highlightBadgeNumber(zoneId: ZoneId): number {
    return Array.from(this.highlightedZones()).indexOf(zoneId) + 1;
  }

  onHighlightedZoneClick(zoneId: ZoneId): void {
    if (this.isHighlighted(zoneId)) {
      this.zoneSelected.emit(zoneId);
    }
  }

  onZonePillClick(zoneId: ZoneId, playerIndex: number): void {
    this.zonePillRequest.emit({ zoneId, playerIndex });
  }

  onZoneCardClick(event: MouseEvent, zone: ZoneRenderData): void {
    const actions = this.getActionsForZone(zone.zoneId);
    if (actions.length === 0) return;
    if (actions.length === 1) {
      this.actionResponse.emit({ action: actions[0].actionCode, index: actions[0].index });
    } else {
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
      case 'EXTRA': return `${LOCATION.EXTRA}-0`;
      default: return null;
    }
  }

  private locationSeqToZoneId(location: number, sequence: number): ZoneId | null {
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
      const card = cards.length > 0 ? cards[0] : null;
      const isPill = PILL_ZONE_IDS.includes(zoneId);
      const isDeck = zoneId === 'DECK';

      return {
        zoneId,
        card,
        cardCount: cards.length,
        isPill,
        isDeck,
        gridArea: ZONE_GRID_AREA[zoneId] ?? zoneId.toLowerCase(),
      };
    });
  }

  getChainBadges(zoneId: string, relativePlayerIndex: number): ChainLinkState[] {
    const ownIdx = this.ownPlayerIndex();
    const absolutePlayerIndex = relativePlayerIndex === 0 ? ownIdx : (ownIdx === 0 ? 1 : 0);
    return this.activeChainLinks().filter(l => l.zoneId === zoneId && l.player === absolutePlayerIndex);
  }

  /** CardOnField doesn't include card name — fallback to code identifier */
  resolveCardName(cardCode: number): string {
    return 'Card ' + cardCode;
  }

  isZoneAnimating(zoneId: string, relativePlayerIndex: number, type: 'summon' | 'destroy' | 'flip' | 'activate'): boolean {
    const az = this.animatingZone();
    return az !== null && az.zoneId === zoneId && az.relativePlayerIndex === relativePlayerIndex && az.animationType === type;
  }

  /** EMZ zones are in the central strip — match only by zoneId + type (no player context needed) */
  isEmzAnimating(zoneId: 'EMZ_L' | 'EMZ_R', type: 'summon' | 'destroy' | 'flip' | 'activate'): boolean {
    const az = this.animatingZone();
    return az !== null && az.zoneId === zoneId && az.animationType === type;
  }

  getEmzChainBadges(zoneId: 'EMZ_L' | 'EMZ_R'): ChainLinkState[] {
    return this.activeChainLinks().filter(l => l.zoneId === zoneId);
  }

  private findZoneCard(playerIndex: number, zoneId: ZoneId): CardOnField | null {
    const player = this.duelState().players[playerIndex];
    if (!player) return null;
    const zone = player.zones.find(z => z.zoneId === zoneId);
    return zone?.cards?.[0] ?? null;
  }
}
