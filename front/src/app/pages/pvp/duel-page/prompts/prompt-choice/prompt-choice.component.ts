import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  HostListener,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
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

// Pre-duel dice roll (Phase 2.12, since 2026-05-13). A single "Lancer les
// dés" choice — the server rolls 2D6 server-side as soon as the player
// confirms, so there's nothing to actually pick. We keep the choice-based
// component to reuse the timeout + keyboard wiring; the full dice-arena UI
// with rolling animation will live in <app-dice-arena> (Phase 3.14).
const DICE_ROLL_CONFIG: ChoiceConfig<true> = {
  title: 'duel.dice.title',
  subtitle: 'duel.dice.subtitle',
  waitingLabel: 'duel.dice.waitingOpponent',
  choices: [
    { value: true, label: 'duel.dice.roll', icon: 'assets/images/icons/dice.svg', key: '1' },
  ],
  timeoutSeconds: 30,
  defaultValue: true,
  // DICE_ROLL response is intentionally empty; the wrapper component will
  // strip this key when forwarding (we keep the responseKey to make the
  // generic component happy).
  responseKey: '_confirm',
  maxWidth: '160px',
};

// Pre-duel first-player pick — sent only to the dice winner.
const FIRST_PLAYER_CONFIG: ChoiceConfig<boolean> = {
  title: 'duel.firstPlayer.title',
  subtitle: 'duel.firstPlayer.subtitle',
  waitingLabel: 'duel.firstPlayer.waiting',
  choices: [
    { value: true, label: 'duel.firstPlayer.youFirst', icon: 'assets/images/icons/tp-first.svg', key: '1' },
    { value: false, label: 'duel.firstPlayer.youSecond', icon: 'assets/images/icons/tp-second.svg', key: '2' },
  ],
  timeoutSeconds: 15,
  defaultValue: true,
  responseKey: 'goFirst',
  maxWidth: '140px',
};

export const CHOICE_CONFIGS: Record<string, ChoiceConfig> = {
  DICE_ROLL: DICE_ROLL_CONFIG,
  SELECT_FIRST_PLAYER: FIRST_PLAYER_CONFIG,
};

@Component({
  selector: 'app-prompt-choice',
  templateUrl: './prompt-choice.component.html',
  styleUrl: './prompt-choice.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class PromptChoiceComponent implements PromptSubComponent, OnInit, OnDestroy {
  promptData: Prompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  @HostBinding('class.read-only') readOnly = false;
  preSelectedResponse: unknown = undefined;

  config!: ChoiceConfig;
  readonly selected = signal<unknown>(null);
  readonly secondsLeft = signal(30);
  answered = false;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private keyMap: Record<string, unknown> = {};

  ngOnInit(): void {
    const type = this.promptData?.type ?? '';
    this.config = CHOICE_CONFIGS[type] ?? CHOICE_CONFIGS['DICE_ROLL'];
    this.secondsLeft.set(this.config.timeoutSeconds);
    this.keyMap = Object.fromEntries(this.config.choices.map(c => [c.key, c.value]));

    if (this.readOnly) {
      if (this.preSelectedResponse != null) {
        const r = this.preSelectedResponse as Record<string, unknown>;
        const value = r[this.config.responseKey];
        this.selected.set(value);
        this.answered = true;
      }
      return; // skip timer in readOnly
    }

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
    if (this.readOnly) return;
    const value = this.keyMap[event.key];
    if (value !== undefined) {
      event.preventDefault();
      this.selectChoice(value);
    }
  }

  private onTimeout(): void {
    if (this.answered) return;
    this.selectChoice(this.config.defaultValue);
  }

  private clearTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}
