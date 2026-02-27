import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { PromptSubComponent, PreferredHeight } from '../prompt.types';
import { Prompt, HintContext } from '../../../types';
import { CardInfo, SelectUnselectCardMsg } from '../../../duel-ws.types';
import { getCardImageUrlByCode } from '../../../pvp-card.utils';

@Component({
  selector: 'app-prompt-card-grid',
  templateUrl: './prompt-card-grid.component.html',
  styleUrl: './prompt-card-grid.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptCardGridComponent implements PromptSubComponent, OnInit, OnDestroy {
  preferredHeight: PreferredHeight = 'full';
  promptData: Prompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();

  readonly selectedIndices = signal<Set<number>>(new Set());
  answered = false;
  private autoRespondTimeout: ReturnType<typeof setTimeout> | null = null;
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (this.cards.length === 0) {
      console.warn('[PromptCardGrid] Empty card list — auto-responding');
      this.autoRespondTimeout = setTimeout(() => {
        this.response.emit({ indices: [] });
      }, 1000);
    }
  }

  ngOnDestroy(): void {
    if (this.autoRespondTimeout) {
      clearTimeout(this.autoRespondTimeout);
      this.autoRespondTimeout = null;
    }
    this.cancelLongPress();
  }

  get cards(): CardInfo[] {
    if (!this.promptData) return [];
    if ('cards' in this.promptData) {
      return (this.promptData as { cards: CardInfo[] }).cards ?? [];
    }
    return [];
  }

  get isMultiSelect(): boolean {
    const t = this.promptData?.type;
    return t === 'SELECT_TRIBUTE' || t === 'SELECT_SUM' || t === 'SELECT_UNSELECT_CARD';
  }

  get minSelect(): number {
    const p = this.promptData;
    if (!p) return 1;
    if ('min' in p) return (p as { min: number }).min;
    return 1;
  }

  get maxSelect(): number {
    const p = this.promptData;
    if (!p) return 1;
    if ('max' in p) return (p as { max: number }).max;
    return 1;
  }

  get isToggleMode(): boolean {
    return this.promptData?.type === 'SELECT_UNSELECT_CARD';
  }

  get canFinish(): boolean {
    if (this.promptData?.type === 'SELECT_UNSELECT_CARD') {
      return (this.promptData as SelectUnselectCardMsg).canFinish;
    }
    return false;
  }

  get layoutClass(): string {
    const count = this.cards.length;
    if (count <= 4) return 'layout-large';
    if (count <= 9) return 'layout-standard';
    if (count <= 12) return 'layout-scroll';
    return 'layout-two-row';
  }

  get isConfirmEnabled(): boolean {
    const count = this.selectedIndices().size;
    if (this.isToggleMode) return this.canFinish || count > 0;
    if (this.isMultiSelect) return count >= this.minSelect && count <= this.maxSelect;
    return count === 1;
  }

  readonly getCardImageUrl = getCardImageUrlByCode;

  isSelected(index: number): boolean {
    return this.selectedIndices().has(index);
  }

  toggleCard(index: number): void {
    if (this.answered) return;

    this.selectedIndices.update(set => {
      const next = new Set(set);
      if (next.has(index)) {
        next.delete(index);
      } else {
        if (!this.isMultiSelect && !this.isToggleMode) {
          next.clear();
        }
        if (this.isMultiSelect && next.size >= this.maxSelect) return set;
        next.add(index);
      }
      return next;
    });
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

  // Long-press card inspection (500ms hold → inspect card)
  onCardTouchStart(cardCode: number): void {
    this.cancelLongPress();
    this.longPressTimeout = setTimeout(() => {
      // TODO: Open CardInspectorComponent overlay (Story 1.7 integration)
      console.debug('[PromptCardGrid] Long-press inspect:', cardCode);
    }, 500);
  }

  onCardTouchEnd(): void {
    this.cancelLongPress();
  }

  private cancelLongPress(): void {
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirm();
    }
  }
}
