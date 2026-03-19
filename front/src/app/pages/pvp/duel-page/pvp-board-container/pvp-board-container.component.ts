import { AfterViewInit, afterNextRender, ChangeDetectionStrategy, Component, computed, effect, inject, Injector, input, output, signal } from '@angular/core';
import { ChainLinkState, DuelState } from '../../types';
import { BoardZone, CardOnField, LOCATION, Phase, Player, SelectBattleCmdMsg, SelectIdleCmdMsg, ZoneId, TimerStateMsg } from '../../duel-ws.types';
import { isFaceUp, isDefense, getCardImageUrl } from '../../pvp-card.utils';
import { ActionableCardsMap, buildActionableCardsFromBattle, buildActionableCardsFromIdle, CardAction, groupPileActions, isActivateAction } from '../idle-action-codes';
import { PvpLpBadgeComponent, LpAnimData } from '../pvp-lp-badge/pvp-lp-badge.component';
import { PvpTimerBadgeComponent } from '../pvp-timer-badge/pvp-timer-badge.component';
import { PvpPhaseBadgeComponent } from '../pvp-phase-badge/pvp-phase-badge.component';
import { CardTravelService } from '../card-travel.service';
import { formatStat, getAttributeName, getRaceName, totalCounters } from '../../pvp-alteration.utils';
import { locationToZoneId, locationToZoneKey } from '../../pvp-zone.utils';
import { NgTemplateOutlet } from '@angular/common';

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
  imports: [PvpLpBadgeComponent, PvpTimerBadgeComponent, PvpPhaseBadgeComponent, NgTemplateOutlet],
})
export class PvpBoardContainerComponent implements AfterViewInit {
  private readonly injector = inject(Injector);
  private readonly cardTravelService = inject(CardTravelService);
  private readonly zoneElements = new Map<string, HTMLElement>();

  /** Only rebuild zone map when players appear/disappear, not on every state update */
  private readonly hasOpponent = computed(() => this.duelState().players[1] != null);

  constructor() {
    // Dynamic rebuild: re-query zone elements when opponent field first renders
    effect(() => {
      this.hasOpponent(); // track only player presence changes
      afterNextRender(() => this.rebuildZoneMap(), { injector: this.injector });
    });
    effect(() => {
      const badges = this.chainBadges();
      if (badges.size > 0) {
        console.log('[DBG:BADGE] chainBadges non-empty (%d entries): %o', badges.size, [...badges.entries()]);
      } else {
        console.log('[DBG:BADGE] chainBadges cleared (size=0)');
      }
    });
  }

  ngAfterViewInit(): void {
    this.rebuildZoneMap();
    this.cardTravelService.registerZoneResolver(this.getZoneElement.bind(this));
  }

  getZoneElement(zoneKey: string): HTMLElement | null {
    return this.zoneElements.get(zoneKey) ?? null;
  }

  private rebuildZoneMap(): void {
    this.zoneElements.clear();
    const elements = document.querySelectorAll<HTMLElement>('[data-zone]');
    elements.forEach(el => {
      const key = el.getAttribute('data-zone');
      if (key) this.zoneElements.set(key, el);
    });
  }

  readonly duelState = input.required<DuelState>();
  readonly timerState = input<TimerStateMsg | null>(null);
  readonly ownPlayerIndex = input<Player>(0);
  readonly highlightedZones = input<Set<ZoneId>>(new Set());
  readonly actionablePrompt = input<SelectIdleCmdMsg | SelectBattleCmdMsg | null>(null);
  readonly opponentDisconnected = input(false);
  readonly animatingZone = input<{ zoneId: string; animationType: 'flip' | 'activate'; relativePlayerIndex: number } | null>(null);
  readonly animatingLp = input<LpAnimData | null>(null);
  readonly activeChainLinks = input<ChainLinkState[]>([]);
  readonly chainPhase = input<'idle' | 'building' | 'resolving'>('idle');
  readonly displayedPhase = input<Phase | null>(null);
  readonly displayedTurnPlayer = input<Player | null>(null);
  readonly displayedTurnCount = input<number | null>(null);
  readonly zoneSelected = output<ZoneId>();
  readonly actionResponse = output<{ action: number; index: number | null }>();
  readonly menuRequest = output<{ zoneId: ZoneId; element: HTMLElement; actions: CardAction[] }>();
  readonly zonePillRequest = output<{ zoneId: ZoneId; playerIndex: number }>();
  readonly cardInspectRequest = output<{ cardCode: number }>();
  readonly maskedZoneKeys = input<ReadonlySet<string>>(new Set());
  readonly maskedPileImages = input<ReadonlyMap<string, string | null>>(new Map());
  readonly maskedSourceImages = input<ReadonlyMap<string, CardOnField>>(new Map());
  readonly targetedZoneKeys = input<ReadonlySet<string>>(new Set());
  readonly preTargetZoneKeys = input<ReadonlySet<string>>(new Set());

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
    { zoneId: 'EMZ_L' as ZoneId, zone: this.emzL(), cssClass: 'emz--left', isOpponent: this.isOpponentEmz('EMZ_L') },
    { zoneId: 'EMZ_R' as ZoneId, zone: this.emzR(), cssClass: 'emz--right', isOpponent: this.isOpponentEmz('EMZ_R') },
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
  readonly formatStat = formatStat;
  readonly getAttributeName = getAttributeName;
  readonly getRaceName = getRaceName;
  readonly totalCounters = totalCounters;

  protected readonly equipMap = computed(() => {
    const map = new Map<string, string[]>();
    const state = this.duelState();
    for (let relPlayer = 0; relPlayer < 2; relPlayer++) {
      const player = state.players[relPlayer];
      if (!player) continue;
      for (const zone of player.zones) {
        const card = zone.cards[0];
        if (!card?.equipTarget) continue;
        const equipKey = `${zone.zoneId}-${relPlayer}`;
        const target = card.equipTarget;
        const targetZoneId = locationToZoneId(target.location, target.sequence);
        if (!targetZoneId) continue;
        const targetKey = `${targetZoneId}-${target.controller}`;
        const eArr = map.get(equipKey);
        if (eArr) eArr.push(targetKey); else map.set(equipKey, [targetKey]);
        const tArr = map.get(targetKey);
        if (tArr) tArr.push(equipKey); else map.set(targetKey, [equipKey]);
      }
    }
    return map;
  });

  protected readonly equipHighlightedZones = signal(new Set<string>());

  private static readonly MONSTER_ZONES = new Set<ZoneId>(['M1', 'M2', 'M3', 'M4', 'M5']);
  private static readonly STAT_ZONES = new Set<ZoneId>(['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R']);

  isMonsterZone(zoneId: ZoneId): boolean {
    return PvpBoardContainerComponent.MONSTER_ZONES.has(zoneId);
  }

  /** Zones where always-on ATK/DEF + Level/Rank stats should display (monster zones including EMZ) */
  isStatZone(zoneId: ZoneId): boolean {
    return PvpBoardContainerComponent.STAT_ZONES.has(zoneId);
  }

  isLinkMonster(card: CardOnField): boolean {
    return card.isLink === true;
  }

  isMonsterDefense(zone: ZoneRenderData): boolean {
    return this.isMonsterZone(zone.zoneId) && isDefense(zone.card!.position);
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
    if (this.isHighlighted(zoneId)) {
      this.zoneSelected.emit(zoneId);
    }
  }

  onZonePillClick(event: MouseEvent, zoneId: ZoneId, playerIndex: number): void {
    this.zonePillRequest.emit({ zoneId, playerIndex });
    // If player's own pile has actionable cards, also open the action menu
    if (playerIndex === 0) {
      const actions = this.getActionsForZone(zoneId);
      if (actions.length > 0) {
        this.menuRequest.emit({
          zoneId,
          element: event.currentTarget as HTMLElement,
          actions: groupPileActions(actions),
        });
      }
    }
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

  /**
   * Chain badge map: key → chain link number (only when chain ≥ 2).
   * Keys: "ZoneId-relPlayer" for field zones, "ZONENAME-relPlayer" for piles,
   * "HAND-relPlayer-sequence" for individual hand cards.
   * When multiple links target the same slot, only the highest number is kept.
   */
  protected readonly chainBadges = computed(() => {
    const links = this.activeChainLinks();
    const map = new Map<string, number>();
    if (links.length < 2 && this.chainPhase() !== 'resolving') return map;
    const ownIdx = this.ownPlayerIndex();
    for (const link of links) {
      const relPlayer = link.player === ownIdx ? 0 : 1;
      const chainNum = link.chainIndex + 1;
      const key = link.zoneId
        ? `${link.zoneId}-${relPlayer}`
        : link.location === LOCATION.HAND
          ? `HAND-${relPlayer}-${link.sequence}`
          : locationToZoneKey(link.location, link.sequence, relPlayer);
      if (!map.has(key) || map.get(key)! < chainNum) map.set(key, chainNum);
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

  onEquipHover(zoneKey: string): void {
    const linked = this.equipMap().get(zoneKey);
    if (linked?.length) {
      this.equipHighlightedZones.set(new Set(linked));
    }
  }

  onEquipLeave(): void {
    if (this.equipHighlightedZones().size > 0) {
      this.equipHighlightedZones.set(new Set());
    }
  }

  buildAriaLabel(card: CardOnField): string {
    const parts: string[] = [card.name ?? 'Card'];
    if (card.currentAtk != null && card.baseAtk != null && card.currentAtk !== card.baseAtk) {
      parts.push(`ATK ${card.currentAtk} ${card.currentAtk > card.baseAtk ? 'boosted' : 'reduced'} from ${card.baseAtk}`);
    }
    if (card.currentDef != null && card.baseDef != null && card.currentDef !== card.baseDef) {
      parts.push(`DEF ${card.currentDef} ${card.currentDef > card.baseDef ? 'boosted' : 'reduced'} from ${card.baseDef}`);
    }
    if (card.isEffectNegated) parts.push('effect negated');
    if (card.currentLevel != null && card.baseLevel != null && card.currentLevel !== card.baseLevel) {
      parts.push(`level ${card.currentLevel} from ${card.baseLevel}`);
    }
    if (card.currentRank != null && card.baseRank != null && card.currentRank !== card.baseRank) {
      parts.push(`rank ${card.currentRank} from ${card.baseRank}`);
    }
    if (card.currentAttribute != null && card.baseAttribute != null && card.currentAttribute !== card.baseAttribute) {
      const name = getAttributeName(card.currentAttribute);
      if (name) parts.push(`attribute changed to ${name}`);
    }
    if (card.currentRace != null && card.baseRace != null && card.currentRace !== card.baseRace) {
      const name = getRaceName(card.currentRace);
      if (name) parts.push(`type changed to ${name}`);
    }
    const cnt = totalCounters(card.counters);
    if (cnt > 0) parts.push(`${cnt} counter${cnt > 1 ? 's' : ''}`);
    return parts.join(', ');
  }

  private isOpponentEmz(zoneId: ZoneId): boolean {
    return this.findZoneCard(0, zoneId) === null && this.findZoneCard(1, zoneId) !== null;
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
