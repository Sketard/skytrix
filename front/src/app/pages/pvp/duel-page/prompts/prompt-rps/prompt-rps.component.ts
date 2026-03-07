import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { RpsChoiceMsg } from '../../../duel-ws.types';

const RPS_CHOICES = [
  { value: 0, label: 'Rock', icon: '✊', key: '1' },
  { value: 1, label: 'Paper', icon: '✋', key: '2' },
  { value: 2, label: 'Scissors', icon: '✌️', key: '3' },
] as const;

@Component({
  selector: 'app-prompt-rps',
  templateUrl: './prompt-rps.component.html',
  styleUrl: './prompt-rps.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptRpsComponent implements PromptSubComponent<RpsChoiceMsg>, OnInit, OnDestroy {
  promptData: RpsChoiceMsg | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();

  readonly choices = RPS_CHOICES;
  readonly selected = signal<number | null>(null);
  readonly secondsLeft = signal(30);
  answered = false;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.timerInterval = setInterval(() => {
      this.secondsLeft.update(s => Math.max(0, s - 1));
      if (this.secondsLeft() <= 0) {
        this.selectRandom();
      }
    }, 1000);
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  selectChoice(value: number): void {
    if (this.answered) return;
    this.answered = true;
    this.selected.set(value);
    this.clearTimer();
    this.response.emit({ choice: value });
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const mapping: Record<string, number> = { '1': 0, '2': 1, '3': 2 };
    const choice = mapping[event.key];
    if (choice !== undefined) {
      event.preventDefault();
      this.selectChoice(choice);
    }
  }

  private selectRandom(): void {
    if (this.answered) return;
    this.selectChoice(Math.floor(Math.random() * 3));
  }

  private clearTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}
