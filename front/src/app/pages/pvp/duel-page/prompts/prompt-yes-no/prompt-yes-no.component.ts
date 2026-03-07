import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { SelectYesNoMsg, SelectEffectYnMsg } from '../../../duel-ws.types';

type YesNoPrompt = SelectYesNoMsg | SelectEffectYnMsg;

@Component({
  selector: 'app-prompt-yes-no',
  templateUrl: './prompt-yes-no.component.html',
  styleUrl: './prompt-yes-no.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptYesNoComponent implements PromptSubComponent<YesNoPrompt> {
  promptData: YesNoPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();

  answered = false;

  get isEffectYn(): boolean {
    return this.promptData?.type === 'SELECT_EFFECTYN';
  }

  get primaryLabel(): string {
    return this.isEffectYn ? 'Effect Activation' : 'Yes';
  }

  get secondaryLabel(): string {
    return this.isEffectYn ? 'Cancel' : 'No';
  }

  selectPrimary(): void {
    if (this.answered) return;
    this.answered = true;
    this.response.emit({ yes: true });
  }

  selectSecondary(): void {
    if (this.answered) return;
    this.answered = true;
    this.response.emit({ yes: false });
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.selectPrimary();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.selectSecondary();
    }
  }
}
