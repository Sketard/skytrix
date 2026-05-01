import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { CardInfo, CardLocation, LOCATION, SelectCardMsg, SelectChainMsg, SelectTributeMsg, SelectSumMsg, SelectUnselectCardMsg } from '../../../duel-ws.types';
import { TranslatePipe } from '@ngx-translate/core';
import { CardNamePipe } from '../../../../../core/pipes/card-i18n.pipe';
import { isFaceUp } from '../../../pvp-card.utils';
import { DuelCardArtService } from '../../duel-card-art.service';
import { getZoneIconPath, getZoneDisplayOrder } from '../../../zone-icons';

type CardGridPrompt = SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg;

interface DisplayEntry {
  card: CardInfo;
  originalIndex: number;
}

interface ZoneGroup {
  location: CardLocation;
  iconPath: string;
  entries: DisplayEntry[];
  groupKey: string;
}

function isFieldZone(loc: CardLocation): boolean {
  return loc === LOCATION.MZONE || loc === LOCATION.SZONE;
}

function cardKey(c: CardInfo): string {
  return `${c.player}-${c.location}-${c.sequence}-${c.cardCode}`;
}

@Component({
  selector: 'app-prompt-card-grid',
  templateUrl: './prompt-card-grid.component.html',
  styleUrl: './prompt-card-grid.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, CardNamePipe],
})
export class PromptCardGridComponent implements PromptSubComponent<CardGridPrompt> {
  private readonly artService = inject(DuelCardArtService);

  promptData: CardGridPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  @HostBinding('class.read-only') readOnly = false;
  preSelectedResponse: unknown = undefined;
  longPressInspect = new EventEmitter<{ cardCode: number }>();
  preTargetCards = new EventEmitter<CardInfo[]>();
  excludedCards: CardInfo[] = [];
  revealedCards: CardInfo[] = [];
  /** Cards revealed by MSG_CONFIRM_CARDS — keyed by "location-player-sequence" to show face-up even if position is face-down. */
  confirmedCardKeys = new Set<string>();
  ownPlayerIndex = 0;

  readonly selectedIndices = signal<Set<number>>(new Set());
  /** For SELECT_SUM: tracks each selected card's chosen contribution amount. */
  readonly selectedCardAmounts = signal<Map<number, number>>(new Map());
  /** For SELECT_UNSELECT_CARD: the card index the user just toggled (delta to send to engine), or null if confirming as-is. */
  readonly toggledIndex = signal<number | null>(null);
  /** True when the replay response was a cancel action (empty indices / null index). */
  cancelSelected = false;
  answered = false;

  ngOnInit(): void {
    if (this.promptData?.type === 'SELECT_TRIBUTE') {
      const p = this.promptData as SelectTributeMsg;
      console.warn('[SELECT_TRIBUTE] cards=%d min=%d max=%d excluded=%d cards=%o',
        p.cards.length, p.min, p.max, this.excludedCards.length,
        p.cards.map((c, i) => ({ i, name: c.name, amount: c.amount ?? 1, loc: c.location, seq: c.sequence })));
    }
    console.log('[PromptCardGrid] type=%s cards=%d excluded=%d displayEntries=%d',
      this.promptData?.type, this.cards.length, this.excludedCards.length, this.displayEntries.length);

    if (this.readOnly && this.preSelectedResponse != null) {
      const r = this.preSelectedResponse as Record<string, unknown>;
      // Server sends "indicies" (legacy typo) — accept both spellings
      const arr = (r['indices'] ?? r['indicies']) as number[] | undefined;
      if (Array.isArray(arr)) {
        if (arr.length === 0) {
          this.cancelSelected = true;
        } else {
          this.selectedIndices.set(new Set<number>(arr));
        }
      } else if (r['index'] === null) {
        this.cancelSelected = true;
      } else if (r['index'] != null && (r['index'] as number) >= 0) {
        this.selectedIndices.set(new Set<number>([r['index'] as number]));
      }
      this.answered = true;
      return;
    }

    // Pre-highlight cards already in the engine's material group (unselect_cards section).
    if (this.promptData?.type === 'SELECT_UNSELECT_CARD') {
      const p = this.promptData as SelectUnselectCardMsg;
      const selectCount = p.selectCount ?? 0;
      const preSelected = new Set<number>();
      for (let i = selectCount; i < p.cards.length; i++) preSelected.add(i);
      this.selectedIndices.set(preSelected);
    }
  }

  get cards(): CardInfo[] {
    if (!this.promptData) return [];
    // For SELECT_SUM, combine mustSelect + optional into a single selectable pool.
    // mustSelect is the primary pool (not auto-included), player picks from it.
    if (this.promptData.type === 'SELECT_SUM') {
      const p = this.promptData as SelectSumMsg;
      return [...(p.mustSelect ?? []), ...(p.cards ?? [])];
    }
    return this.promptData.cards ?? [];
  }

  get displayEntries(): DisplayEntry[] {
    const all = this.cards;

    if (this.excludedCards.length === 0) {
      return all.map((card, i) => ({ card, originalIndex: i }));
    }
    const excludedKeys = new Set(this.excludedCards.map(cardKey));
    // Track used keys to handle duplicates correctly (only exclude once per excluded card)
    const usedKeys = new Map<string, number>();
    for (const k of excludedKeys) usedKeys.set(k, 0);

    return all.reduce<DisplayEntry[]>((acc, card, i) => {
      const k = cardKey(card);
      if (excludedKeys.has(k)) {
        const used = usedKeys.get(k)!;
        const total = this.excludedCards.filter(c => cardKey(c) === k).length;
        if (used < total) {
          usedKeys.set(k, used + 1);
          return acc; // skip this card
        }
      }
      acc.push({ card, originalIndex: i });
      return acc;
    }, []);
  }

  get zoneGroups(): ZoneGroup[] {
    const entries = this.displayEntries;
    const map = new Map<string, DisplayEntry[]>();
    for (const entry of entries) {
      const loc = entry.card.location;
      // Field zones: group by player+location to separate own vs opponent
      const key = isFieldZone(loc) ? `${entry.card.player}-${loc}` : `${loc}`;
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        const locA = Number(a.split('-').pop()!);
        const locB = Number(b.split('-').pop()!);
        return getZoneDisplayOrder(locA as CardLocation) - getZoneDisplayOrder(locB as CardLocation);
      })
      .map(([key, groupEntries]) => {
        const location = Number(key.split('-').pop()!) as CardLocation;
        if (isFieldZone(location)) {
          const isOpponent = groupEntries[0]?.card.player !== this.ownPlayerIndex;
          groupEntries.sort((a, b) =>
            isOpponent ? b.card.sequence - a.card.sequence : a.card.sequence - b.card.sequence,
          );
        } else {
          groupEntries.sort((a, b) => b.card.name.localeCompare(a.card.name));
        }
        return {
          location,
          groupKey: key,
          iconPath: getZoneIconPath(location),
          entries: groupEntries,
        };
      });
  }

  get isMultiSelect(): boolean {
    const t = this.promptData?.type;
    if (t === 'SELECT_CARD') return this.maxSelect > 1;
    return t === 'SELECT_TRIBUTE' || t === 'SELECT_SUM' || t === 'SELECT_UNSELECT_CARD';
  }

  get minSelect(): number {
    const p = this.promptData;
    if (!p) return 1;
    if (p.type === 'SELECT_SUM') return (p as SelectSumMsg).minCards;
    // For SELECT_TRIBUTE min/max are tribute counts, not card counts — use 1 as card-count floor
    if (p.type === 'SELECT_TRIBUTE') return 1;
    if ('min' in p) return (p as { min: number }).min;
    return 1;
  }

  get sumTarget(): number {
    if (this.promptData?.type !== 'SELECT_SUM') return 0;
    return (this.promptData as SelectSumMsg).targetSum;
  }

  get maxSelect(): number {
    const p = this.promptData;
    if (!p) return 1;
    if (p.type === 'SELECT_SUM') {
      const sum = p as SelectSumMsg;
      // selectMax is a mode flag (0=exact, 1=at-least), NOT a card count
      if (sum.maxCards > 0) return sum.maxCards;
      return this.cards.length;
    }
    // For SELECT_TRIBUTE max is a tribute count — any card count up to total cards is valid
    if (p.type === 'SELECT_TRIBUTE') return this.cards.length;
    if ('max' in p) return p.max;
    return 1;
  }

  /** For SELECT_SUM: total sum of currently selected cards (uses chosen amounts). */
  get selectedSum(): number {
    if (this.promptData?.type !== 'SELECT_SUM') return 0;
    let sum = 0;
    for (const amount of this.selectedCardAmounts().values()) sum += amount;
    return sum;
  }

  get isToggleMode(): boolean {
    return this.promptData?.type === 'SELECT_UNSELECT_CARD';
  }

  get canFinish(): boolean {
    if (this.promptData?.type === 'SELECT_UNSELECT_CARD') {
      return this.promptData.canFinish;
    }
    return false;
  }

  get canCancel(): boolean {
    const p = this.promptData;
    if (!p) return false;
    if (p.type === 'SELECT_CHAIN') return !p.forced;
    if ('cancelable' in p) return (p as SelectCardMsg).cancelable;
    return false;
  }

  /** Sum of tribute amounts of currently selected cards (SELECT_TRIBUTE). */
  get selectedTributeSum(): number {
    if (this.promptData?.type !== 'SELECT_TRIBUTE') return 0;
    let sum = 0;
    for (const idx of this.selectedIndices()) {
      const card = this.cards[idx];
      sum += card?.amount ?? 1;
    }
    return sum;
  }

  get isConfirmEnabled(): boolean {
    const count = this.selectedIndices().size;
    if (this.isToggleMode) return this.canFinish || this.toggledIndex() !== null;
    if (this.promptData?.type === 'SELECT_SUM') {
      const p = this.promptData as SelectSumMsg;
      return this.selectedSum >= p.targetSum;
    }
    if (this.promptData?.type === 'SELECT_TRIBUTE') {
      const p = this.promptData as SelectTributeMsg;
      return this.selectedTributeSum >= p.min && this.selectedTributeSum <= p.max;
    }
    if (this.isMultiSelect) return count >= this.minSelect && count <= this.maxSelect;
    return count === 1;
  }

  private static readonly CARD_BACK = 'assets/images/card_back.jpg';

  getCardImageUrl(card: CardInfo): string {
    if (card.position != null && !isFaceUp(card.position) && card.player !== this.ownPlayerIndex) {
      const key = `${card.location}-${card.player}-${card.sequence}`;
      if (!this.confirmedCardKeys.has(key)) return PromptCardGridComponent.CARD_BACK;
    }
    return this.artService.resolveUrl(card.cardCode);
  }

  isSelected(index: number): boolean {
    if (this.promptData?.type === 'SELECT_SUM') return this.selectedCardAmounts().has(index);
    return this.selectedIndices().has(index);
  }

  // OCGCore encodes dual-use cards as: low 16 bits = min (1), high 16 bits = max (link rating).
  private getAmountMin(card: CardInfo): number { return (card.amount ?? 1) & 0xFFFF; }
  private getAmountMax(card: CardInfo): number {
    const hi = (card.amount ?? 1) >>> 16;
    return hi !== 0 ? hi : this.getAmountMin(card);
  }
  isDualAmount(card: CardInfo): boolean { return this.getAmountMin(card) !== this.getAmountMax(card); }
  getSelectedAmount(index: number): number { return this.selectedCardAmounts().get(index) ?? 1; }

  toggleCard(index: number): void {
    if (this.answered) return;

    const cardCode = this.cards[index]?.cardCode;
    if (cardCode) {
      this.longPressInspect.emit({ cardCode });
    }

    if (this.readOnly) return;

    if (this.promptData?.type === 'SELECT_SUM') {
      const p = this.promptData as SelectSumMsg;
      this.selectedCardAmounts.update(map => {
        const next = new Map(map);
        const card = this.cards[index];
        if (!card) return map;
        const amtMin = this.getAmountMin(card);
        const amtMax = this.getAmountMax(card);
        const currentAmt = next.get(index);
        if (currentAmt === undefined) {
          // Unselected → select with max amount (link rating or 1 for normal monsters)
          if (next.size >= this.maxSelect) return map;
          // In exact mode (selectMax=0), prevent overshooting the target sum.
          // In at-least mode (selectMax=1), allow adding cards even after reaching the target.
          const currentSum = Array.from(next.values()).reduce((s, a) => s + a, 0);
          if (p.selectMax === 0 && currentSum >= p.targetSum) return map;
          next.set(index, amtMax);
        } else if (amtMin !== amtMax && currentAmt !== amtMin) {
          // Dual-amount card selected at max → toggle down to min (use as single monster)
          next.set(index, amtMin);
        } else {
          // Selected at min (or non-dual) → deselect
          next.delete(index);
        }
        return next;
      });
      return;
    }
    if (this.promptData?.type === 'SELECT_UNSELECT_CARD') {
      const p = this.promptData as SelectUnselectCardMsg;
      const selectCount = p.selectCount ?? 0;
      const isPreSelected = index >= selectCount; // card is already in engine's material group
      const newToggled = this.toggledIndex() === index ? null : index;
      this.toggledIndex.set(newToggled);
      // Rebuild visual selection: start from engine pre-selection, then apply the pending toggle
      this.selectedIndices.update(() => {
        const next = new Set<number>();
        for (let i = selectCount; i < p.cards.length; i++) next.add(i); // restore pre-selected
        if (newToggled !== null) {
          if (isPreSelected) next.delete(newToggled); // removing from group
          else next.add(newToggled);                  // adding to group
        }
        return next;
      });
      return;
    }
    this.selectedIndices.update(set => {
      const next = new Set(set);
      if (next.has(index)) {
        next.delete(index);
      } else {
        if (!this.isMultiSelect && !this.isToggleMode) {
          next.clear();
        }
        if (this.promptData?.type === 'SELECT_TRIBUTE') {
          // Block adding more cards once the tribute count requirement is already met
          const p = this.promptData as SelectTributeMsg;
          const currentSum = Array.from(next).reduce((s, i) => s + (this.cards[i]?.amount ?? 1), 0);
          if (currentSum >= p.max) return set;
        } else if (this.isMultiSelect && next.size >= this.maxSelect) {
          return set;
        }
        next.add(index);
      }
      return next;
    });

    const selected = Array.from(this.selectedIndices())
      .map(i => this.cards[i])
      .filter(Boolean);
    this.preTargetCards.emit(selected);
  }

  /** True when SELECT_SUM minimum is met (confirm enabled). Drives the two-button layout. */
  get isSumReady(): boolean {
    return this.promptData?.type === 'SELECT_SUM' && this.isConfirmEnabled;
  }

  /** True when more cards can still be added to the SELECT_SUM selection. */
  get canAddMoreMaterials(): boolean {
    const selectedCount = this.selectedCardAmounts().size;
    return selectedCount < this.cards.length && selectedCount < this.maxSelect;
  }

  /** Finish the SELECT_UNSELECT_CARD selection without toggling any card (sends null). */
  confirmFinish(): void {
    if (this.answered) return;
    this.answered = true;
    this.response.emit({ index: null });
  }

  cancel(): void {
    if (this.answered || !this.canCancel) return;
    this.answered = true;
    const type = this.promptData?.type;
    if (type === 'SELECT_CHAIN') {
      this.response.emit({ index: null });
    } else {
      this.response.emit({ indices: [] });
    }
  }

  confirm(): void {
    if (this.answered || !this.isConfirmEnabled) return;
    this.answered = true;

    const type = this.promptData?.type;

    if (type === 'SELECT_SUM') {
      const indices = Array.from(this.selectedCardAmounts().keys());
      this.response.emit({ indices });
      return;
    }

    const indices = Array.from(this.selectedIndices());
    // SELECT_CHAIN and SELECT_UNSELECT_CARD use { index } (single)
    if (type === 'SELECT_UNSELECT_CARD') {
      const idx = this.toggledIndex();
      console.log('[PromptCardGrid] SELECT_UNSELECT_CARD confirm: toggledIndex=%o card=%o canFinish=%s',
        idx, idx != null ? this.cards[idx] : null, (this.promptData as SelectUnselectCardMsg)?.canFinish);
      this.response.emit({ index: idx });
    } else if (type === 'SELECT_CHAIN') {
      this.response.emit({ index: indices[0] ?? null });
    } else {
      if (type === 'SELECT_TRIBUTE') {
        const tributeSum = indices.reduce((s, i) => s + (this.cards[i]?.amount ?? 1), 0);
        console.warn('[SELECT_TRIBUTE] confirm indices=%o tributeSum=%d', indices, tributeSum);
      }
      this.response.emit({ indices });
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.readOnly) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirm();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }
  }
}
