import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  OnDestroy,
  signal,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { CardInfo, CardLocation, SelectCardMsg, SelectChainMsg, SelectTributeMsg, SelectSumMsg, SelectUnselectCardMsg } from '../../../duel-ws.types';
import { getCardImageUrlByCode } from '../../../pvp-card.utils';
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
})
export class PromptCardGridComponent implements PromptSubComponent<CardGridPrompt>, OnDestroy {
  promptData: CardGridPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  longPressInspect = new EventEmitter<{ cardCode: number }>();
  excludedCards: CardInfo[] = [];

  readonly selectedIndices = signal<Set<number>>(new Set());
  answered = false;
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private longPressStartPos: { x: number; y: number } | null = null;
  private longPressFired = false;

  ngOnDestroy(): void {
    this.cancelLongPress();
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
    const map = new Map<CardLocation, DisplayEntry[]>();
    for (const entry of entries) {
      const loc = entry.card.location;
      const list = map.get(loc);
      if (list) list.push(entry);
      else map.set(loc, [entry]);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => getZoneDisplayOrder(a) - getZoneDisplayOrder(b))
      .map(([location, groupEntries]) => ({
        location,
        iconPath: getZoneIconPath(location),
        entries: groupEntries.sort((a, b) => b.card.name.localeCompare(a.card.name)),
      }));
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
    if ('max' in p) return p.max;
    return 1;
  }

  /** For SELECT_SUM: total sum of currently selected cards. */
  get selectedSum(): number {
    if (this.promptData?.type !== 'SELECT_SUM') return 0;
    let sum = 0;
    for (const idx of this.selectedIndices()) {
      sum += this.cards[idx]?.amount ?? 1;
    }
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

  get isConfirmEnabled(): boolean {
    const count = this.selectedIndices().size;
    if (this.isToggleMode) return this.canFinish || count > 0;
    if (this.promptData?.type === 'SELECT_SUM') {
      const p = this.promptData as SelectSumMsg;
      return this.selectedSum >= p.targetSum;
    }
    if (this.isMultiSelect) return count >= this.minSelect && count <= this.maxSelect;
    return count === 1;
  }

  readonly getCardImageUrl = getCardImageUrlByCode;

  isSelected(index: number): boolean {
    return this.selectedIndices().has(index);
  }

  toggleCard(index: number): void {
    if (this.answered) return;
    // H1 fix: Skip selection if long-press just fired (click event follows touchend)
    if (this.longPressFired) {
      this.longPressFired = false;
      return;
    }

    // Inspect card on every click (shows image + description like in deck builder)
    const cardCode = this.cards[index]?.cardCode;
    if (cardCode) {
      this.longPressInspect.emit({ cardCode });
    }

    this.selectedIndices.update(set => {
      const next = new Set(set);
      if (next.has(index)) {
        next.delete(index);
      } else {
        if (!this.isMultiSelect && !this.isToggleMode) {
          next.clear();
        }
        if (this.promptData?.type === 'SELECT_SUM') {
          const p = this.promptData as SelectSumMsg;
          if (next.size >= this.maxSelect) return set;
          // Block adding more cards once target sum is reached or would be exceeded
          const currentSum = Array.from(next).reduce((s, i) => s + (this.cards[i]?.amount ?? 1), 0);
          if (currentSum >= p.targetSum) return set; // already at/above target — no more picks
        } else if (this.isMultiSelect && next.size >= this.maxSelect) {
          return set;
        }
        next.add(index);
      }
      return next;
    });
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
    const indices = Array.from(this.selectedIndices());

    // SELECT_CHAIN and SELECT_UNSELECT_CARD use { index } (single)
    if (type === 'SELECT_CHAIN' || type === 'SELECT_UNSELECT_CARD') {
      this.response.emit({ index: indices[0] ?? null });
    } else {
      this.response.emit({ indices });
    }
  }

  // L2 fix: Consistent pointer event model (pointerdown instead of touchstart)
  onCardPointerDown(cardCode: number, event: PointerEvent): void {
    this.cancelLongPress();
    this.longPressFired = false;
    this.longPressStartPos = { x: event.clientX, y: event.clientY };
    this.longPressTimeout = setTimeout(() => {
      if (cardCode) {
        this.longPressFired = true;
        this.longPressInspect.emit({ cardCode });
      }
    }, 500);
  }

  onCardPointerUp(): void {
    this.cancelLongPress();
  }

  onCardPointerMove(event: PointerEvent): void {
    if (!this.longPressStartPos || !this.longPressTimeout) return;
    const dx = event.clientX - this.longPressStartPos.x;
    const dy = event.clientY - this.longPressStartPos.y;
    if (dx * dx + dy * dy > 100) { // 10px threshold squared
      this.cancelLongPress();
    }
  }

  onContextMenu(event: Event): void {
    this.cancelLongPress();
    event.preventDefault();
  }

  private cancelLongPress(): void {
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }
    this.longPressStartPos = null;
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
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
