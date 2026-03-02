import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PromptSubComponent, PreferredHeight } from '../prompt.types';
import { HintContext } from '../../../types';
import { AnnounceNumberMsg, SelectCounterMsg } from '../../../duel-ws.types';

type NumericPrompt = AnnounceNumberMsg | SelectCounterMsg;

@Component({
  selector: 'app-prompt-numeric-input',
  templateUrl: './prompt-numeric-input.component.html',
  styleUrl: './prompt-numeric-input.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
})
export class PromptNumericInputComponent implements PromptSubComponent<NumericPrompt> {
  preferredHeight: PreferredHeight = 'compact';
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

  get min(): number {
    if (this.promptData?.type === 'SELECT_COUNTER') return 0;
    if (this.promptData?.type === 'ANNOUNCE_NUMBER') {
      const opts = this.promptData.options;
      return opts.length > 0 ? Math.min(...opts) : 0;
    }
    return 0;
  }

  get max(): number {
    if (this.promptData?.type === 'SELECT_COUNTER') {
      return this.promptData.count;
    }
    if (this.promptData?.type === 'ANNOUNCE_NUMBER') {
      const opts = this.promptData.options;
      return opts.length > 0 ? Math.max(...opts) : 99;
    }
    return 99;
  }

  get label(): string {
    return this.isCounterMode ? 'Select counters' : 'Declare number';
  }

  get isValid(): boolean {
    const v = this.value();
    if (this.isDeclareMode && this.promptData?.type === 'ANNOUNCE_NUMBER') {
      return this.promptData.options.includes(v);
    }
    return v >= this.min && v <= this.max;
  }

  increment(): void {
    if (this.answered) return;
    if (this.value() < this.max) this.value.update(v => v + 1);
  }

  decrement(): void {
    if (this.answered) return;
    if (this.value() > this.min) this.value.update(v => v - 1);
  }

  onInputChange(val: string): void {
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
      this.value.set(Math.max(this.min, Math.min(this.max, num)));
    }
  }

  confirm(): void {
    if (this.answered || !this.isValid) return;
    this.answered = true;

    if (this.isCounterMode && this.promptData?.type === 'SELECT_COUNTER') {
      // SELECT_COUNTER: distribute the selected count across all cards
      // For single-counter prompts, server expects one value per card
      // TODO: Currently assigns all counters to card[0]. For multi-card counter distribution,
      // a dedicated UI is needed (e.g., stepper per card). Single-card is the common case.
      const cardCount = this.promptData.cards.length;
      const counts = new Array<number>(cardCount).fill(0);
      counts[0] = this.value();
      this.response.emit({ counts });
    } else {
      this.response.emit({ value: this.value() });
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
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
