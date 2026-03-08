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
  promptData: NumericPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();

  readonly value = signal(0);
  answered = false;

  get isCounterMode(): boolean {
    return this.promptData?.type === 'SELECT_COUNTER';
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

  get isCounterValid(): boolean {
    const v = this.value();
    return v >= 0 && v <= this.counterMax;
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

    if (this.promptData?.type === 'SELECT_COUNTER') {
      // SELECT_COUNTER: distribute the selected count across all cards
      // TODO: Currently assigns all counters to card[0]. For multi-card counter distribution,
      // a dedicated UI is needed (e.g., stepper per card). Single-card is the common case.
      const cardCount = this.promptData.cards.length;
      const counts = new Array<number>(cardCount).fill(0);
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
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.increment();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.decrement();
    }
  }
}
