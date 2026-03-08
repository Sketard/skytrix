import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  signal,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { POSITION, SelectPositionMsg } from '../../../duel-ws.types';
import { getCardImageUrlByCode } from '../../../pvp-card.utils';

interface PositionOption {
  index: number;
  position: number;
  imageUrl: string;
  rotated: boolean;
  label: string;
}

@Component({
  selector: 'app-prompt-position-select',
  templateUrl: './prompt-position-select.component.html',
  styleUrl: './prompt-position-select.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class PromptPositionSelectComponent implements PromptSubComponent<SelectPositionMsg> {
  promptData: SelectPositionMsg | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();

  readonly selectedIndex = signal<number | null>(null);
  answered = false;

  get options(): PositionOption[] {
    if (!this.promptData) return [];
    const cardUrl = getCardImageUrlByCode(this.promptData.cardCode);
    const backUrl = 'assets/images/card_back.jpg';

    return this.promptData.positions.map((pos, i) => {
      const faceDown = pos === POSITION.FACEDOWN_ATTACK || pos === POSITION.FACEDOWN_DEFENSE;
      const defense = pos === POSITION.FACEUP_DEFENSE || pos === POSITION.FACEDOWN_DEFENSE;

      let label = 'Unknown';
      if (pos === POSITION.FACEUP_ATTACK) label = 'ATK';
      else if (pos === POSITION.FACEDOWN_ATTACK) label = 'Face-down ATK';
      else if (pos === POSITION.FACEUP_DEFENSE) label = 'DEF';
      else if (pos === POSITION.FACEDOWN_DEFENSE) label = 'SET';

      return {
        index: i,
        position: pos,
        imageUrl: faceDown ? backUrl : cardUrl,
        rotated: defense,
        label,
      };
    });
  }

  selectOption(index: number): void {
    if (this.answered) return;
    this.selectedIndex.set(index);
  }

  confirm(): void {
    const idx = this.selectedIndex();
    if (this.answered || idx === null || !this.promptData) return;
    this.answered = true;
    this.response.emit({ position: this.promptData.positions[idx] });
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const current = this.selectedIndex() ?? -1;
    const max = this.options.length - 1;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.set(Math.min(current + 1, max));
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.set(Math.max(current - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        this.confirm();
        break;
    }
  }
}
