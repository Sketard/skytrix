import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  signal,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { AnnounceNumberMsg, SelectCounterMsg } from '../../../duel-ws.types';
import { getCardImageUrlByCode } from '../../../pvp-card.utils';

type NumericPrompt = AnnounceNumberMsg | SelectCounterMsg;

@Component({
  selector: 'app-prompt-numeric-input',
  templateUrl: './prompt-numeric-input.component.html',
  styleUrl: './prompt-numeric-input.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class PromptNumericInputComponent implements PromptSubComponent<NumericPrompt> {
  private _promptData: NumericPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();

  readonly getCardImageUrl = getCardImageUrlByCode;
  readonly value = signal(0);
  readonly cardCounts = signal<number[]>([]);
  answered = false;

  get promptData(): NumericPrompt | null { return this._promptData; }
  set promptData(v: NumericPrompt | null) {
    this._promptData = v;
    if (v?.type === 'SELECT_COUNTER' && v.cards.length > 1) {
      this.cardCounts.set(new Array(v.cards.length).fill(0));
    }
  }

  get isCounterMode(): boolean {
    return this._promptData?.type === 'SELECT_COUNTER';
  }

  get isMultiCounterMode(): boolean {
    return this.isCounterMode && (this._promptData as SelectCounterMsg).cards.length > 1;
  }

  get isDeclareMode(): boolean {
    return this.promptData?.type === 'ANNOUNCE_NUMBER';
  }

  get declareOptions(): number[] {
    return this.promptData?.type === 'ANNOUNCE_NUMBER' ? this.promptData.options : [];
  }

  get counterMax(): number {
    return this.promptData?.type === 'SELECT_COUNTER' ? this.promptData.count : 0;
  }

  get counterCards(): SelectCounterMsg['cards'] {
    return this.promptData?.type === 'SELECT_COUNTER' ? this.promptData.cards : [];
  }

  get countsSum(): number {
    return this.cardCounts().reduce((s, v) => s + v, 0);
  }

  get isCounterValid(): boolean {
    if (this.isMultiCounterMode) return this.countsSum === this.counterMax;
    const v = this.value();
    return v >= 0 && v <= this.counterMax;
  }

  incrementCard(index: number): void {
    if (this.answered || this.countsSum >= this.counterMax) return;
    this.cardCounts.update(arr => { const next = [...arr]; next[index]++; return next; });
  }

  decrementCard(index: number): void {
    if (this.answered || this.cardCounts()[index] <= 0) return;
    this.cardCounts.update(arr => { const next = [...arr]; next[index]--; return next; });
  }

  increment(): void {
    if (this.answered) return;
    if (this.value() < this.counterMax) this.value.update(v => v + 1);
  }

  decrement(): void {
    if (this.answered) return;
    if (this.value() > 0) this.value.update(v => v - 1);
  }

  selectAndConfirm(opt: number): void {
    if (this.answered) return;
    this.value.set(opt);
    this.answered = true;
    this.response.emit({ value: opt });
  }

  confirm(): void {
    if (this.answered || !this.isCounterValid) return;
    this.answered = true;

    if (this.isMultiCounterMode) {
      this.response.emit({ counts: this.cardCounts() });
    } else if (this.promptData?.type === 'SELECT_COUNTER') {
      const counts = new Array<number>(this.counterCards.length).fill(0);
      counts[0] = this.value();
      this.response.emit({ counts });
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.isCounterMode) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirm();
    } else if (event.key === 'ArrowUp' && !this.isMultiCounterMode) {
      event.preventDefault();
      this.increment();
    } else if (event.key === 'ArrowDown' && !this.isMultiCounterMode) {
      event.preventDefault();
      this.decrement();
    }
  }
}
