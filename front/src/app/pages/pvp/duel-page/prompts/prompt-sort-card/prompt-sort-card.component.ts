import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  HostListener,
  OnInit,
  signal,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { SortCardMsg, SortChainMsg, CardInfo } from '../../../duel-ws.types';
import { TranslatePipe } from '@ngx-translate/core';
import { getCardImageUrlByCode } from '../../../pvp-card.utils';

type SortPrompt = SortCardMsg | SortChainMsg;

@Component({
  selector: 'app-prompt-sort-card',
  templateUrl: './prompt-sort-card.component.html',
  styleUrl: './prompt-sort-card.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class PromptSortCardComponent implements PromptSubComponent<SortPrompt>, OnInit {
  promptData: SortPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  @HostBinding('class.read-only') readOnly = false;
  preSelectedResponse: unknown = undefined;
  longPressInspect = new EventEmitter<{ cardCode: number }>();
  answered = false;

  readonly orderedIndices = signal<number[]>([]);

  ngOnInit(): void {
    if (this.readOnly && this.preSelectedResponse != null) {
      const r = this.preSelectedResponse as { order: number[] };
      if (Array.isArray(r.order)) this.orderedIndices.set(r.order);
      this.answered = true;
    }
  }

  get cards(): CardInfo[] {
    return this.promptData?.cards ?? [];
  }

  get isComplete(): boolean {
    return this.orderedIndices().length === this.cards.length;
  }

  getCardImageUrl(card: CardInfo): string {
    return getCardImageUrlByCode(card.cardCode);
  }

  getRank(index: number): number | null {
    const pos = this.orderedIndices().indexOf(index);
    return pos >= 0 ? pos + 1 : null;
  }

  isLastAssigned(index: number): boolean {
    const ordered = this.orderedIndices();
    return ordered.length > 0 && ordered[ordered.length - 1] === index;
  }

  toggleCard(index: number): void {
    if (this.answered) return;

    const cardCode = this.cards[index]?.cardCode;
    if (cardCode) {
      this.longPressInspect.emit({ cardCode });
    }

    if (this.readOnly) return;

    if (this.isLastAssigned(index)) {
      this.orderedIndices.update(arr => arr.slice(0, -1));
    } else if (this.getRank(index) === null) {
      this.orderedIndices.update(arr => [...arr, index]);
    }
  }

  reset(): void {
    if (this.answered) return;
    this.orderedIndices.set([]);
  }

  confirm(): void {
    if (this.answered || !this.isComplete) return;
    this.answered = true;
    this.response.emit({ order: this.orderedIndices() });
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.readOnly) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirm();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.orderedIndices.update(arr => arr.length > 0 ? arr.slice(0, -1) : arr);
    }
  }
}
