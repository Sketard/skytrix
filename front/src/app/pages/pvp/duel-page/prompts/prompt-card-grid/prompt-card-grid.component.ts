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
import { HintContext } from '../../../types';
import { CardInfo, SelectCardMsg, SelectChainMsg, SelectTributeMsg, SelectSumMsg, SelectUnselectCardMsg } from '../../../duel-ws.types';
import { getCardImageUrlByCode } from '../../../pvp-card.utils';

type CardGridPrompt = SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg;

@Component({
  selector: 'app-prompt-card-grid',
  templateUrl: './prompt-card-grid.component.html',
  styleUrl: './prompt-card-grid.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptCardGridComponent implements PromptSubComponent<CardGridPrompt>, OnInit, OnDestroy {
  preferredHeight: PreferredHeight = 'full';
  promptData: CardGridPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  longPressInspect = new EventEmitter<{ cardCode: number }>();

  readonly selectedIndices = signal<Set<number>>(new Set());
  answered = false;
  private autoRespondTimeout: ReturnType<typeof setTimeout> | null = null;
  private longPressTimeout: ReturnType<typeof setTimeout> | null = null;
  private longPressStartPos: { x: number; y: number } | null = null;
  private longPressFired = false;

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
    return this.promptData.cards ?? [];
  }

  get isMultiSelect(): boolean {
    const t = this.promptData?.type;
    return t === 'SELECT_TRIBUTE' || t === 'SELECT_SUM' || t === 'SELECT_UNSELECT_CARD';
  }

  get minSelect(): number {
    const p = this.promptData;
    if (!p) return 1;
    if ('min' in p) return p.min;
    return 1;
  }

  get maxSelect(): number {
    const p = this.promptData;
    if (!p) return 1;
    if ('max' in p) return p.max;
    return 1;
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
    // H1 fix: Skip selection if long-press just fired (click event follows touchend)
    if (this.longPressFired) {
      this.longPressFired = false;
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
    }
  }
}
