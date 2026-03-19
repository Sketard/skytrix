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
import { Prompt } from '../../../types/prompt.types';

export interface ChoiceOption<T = unknown> {
  value: T;
  label: string;
  icon: string;
  key: string;
}

export interface ChoiceConfig<T = unknown> {
  title: string;
  subtitle: string;
  waitingLabel: string;
  choices: readonly ChoiceOption<T>[];
  timeoutSeconds: number;
  defaultValue: T;
  responseKey: string;
  maxWidth: string;
}

const RPS_CONFIG: ChoiceConfig<number> = {
  title: 'ROCK PAPER SCISSORS',
  subtitle: 'Winner picks turn order',
  waitingLabel: 'Waiting for opponent...',
  choices: [
    { value: 0, label: 'Rock', icon: 'assets/images/icons/rps-rock.svg', key: '1' },
    { value: 1, label: 'Paper', icon: 'assets/images/icons/rps-paper.svg', key: '2' },
    { value: 2, label: 'Scissors', icon: 'assets/images/icons/rps-scissors.svg', key: '3' },
  ],
  timeoutSeconds: 30,
  defaultValue: -1, // sentinel — triggers random pick
  responseKey: 'choice',
  maxWidth: '120px',
};

const TP_CONFIG: ChoiceConfig<boolean> = {
  title: 'TURN ORDER',
  subtitle: 'You won — choose your position',
  waitingLabel: 'Waiting for confirmation...',
  choices: [
    { value: true, label: 'Go First', icon: 'assets/images/icons/tp-first.svg', key: '1' },
    { value: false, label: 'Go Second', icon: 'assets/images/icons/tp-second.svg', key: '2' },
  ],
  timeoutSeconds: 30,
  defaultValue: true,
  responseKey: 'goFirst',
  maxWidth: '140px',
};

export const CHOICE_CONFIGS: Record<string, ChoiceConfig> = {
  RPS_CHOICE: RPS_CONFIG,
  SELECT_TP: TP_CONFIG,
};

@Component({
  selector: 'app-prompt-choice',
  templateUrl: './prompt-choice.component.html',
  styleUrl: './prompt-choice.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptChoiceComponent implements PromptSubComponent, OnInit, OnDestroy {
  promptData: Prompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();

  config!: ChoiceConfig;
  readonly selected = signal<unknown>(null);
  readonly secondsLeft = signal(30);
  answered = false;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private keyMap: Record<string, unknown> = {};

  ngOnInit(): void {
    const type = this.promptData?.type ?? '';
    this.config = CHOICE_CONFIGS[type] ?? CHOICE_CONFIGS['RPS_CHOICE'];
    this.secondsLeft.set(this.config.timeoutSeconds);
    this.keyMap = Object.fromEntries(this.config.choices.map(c => [c.key, c.value]));

    this.timerInterval = setInterval(() => {
      this.secondsLeft.update(s => Math.max(0, s - 1));
      if (this.secondsLeft() <= 0) {
        this.onTimeout();
      }
    }, 1000);
  }

  ngOnDestroy(): void {
    this.answered = true;
    this.clearTimer();
  }

  selectChoice(value: unknown): void {
    if (this.answered) return;
    this.answered = true;
    this.selected.set(value);
    this.clearTimer();
    this.response.emit({ [this.config.responseKey]: value });
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const value = this.keyMap[event.key];
    if (value !== undefined) {
      event.preventDefault();
      this.selectChoice(value);
    }
  }

  private onTimeout(): void {
    if (this.answered) return;
    const def = this.config.defaultValue;
    // RPS: sentinel -1 means pick random
    if (typeof def === 'number' && def < 0) {
      this.selectChoice(this.config.choices[Math.floor(Math.random() * this.config.choices.length)].value);
    } else {
      this.selectChoice(def);
    }
  }

  private clearTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}
