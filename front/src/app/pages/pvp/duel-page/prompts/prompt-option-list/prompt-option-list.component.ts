import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PromptSubComponent, PreferredHeight } from '../prompt.types';
import { HintContext } from '../../../types';
import { POSITION, SelectPositionMsg, SelectOptionMsg, AnnounceRaceMsg, AnnounceAttribMsg } from '../../../duel-ws.types';

interface OptionItem {
  index: number;
  label: string;
  icon: string | null;
}

type OptionListPrompt = SelectPositionMsg | SelectOptionMsg | AnnounceRaceMsg | AnnounceAttribMsg;

@Component({
  selector: 'app-prompt-option-list',
  templateUrl: './prompt-option-list.component.html',
  styleUrl: './prompt-option-list.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
})
export class PromptOptionListComponent implements PromptSubComponent<OptionListPrompt> {
  promptData: OptionListPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();

  readonly selectedIndex = signal<number | null>(null);
  answered = false;

  get preferredHeight(): PreferredHeight {
    const count = this.options.length;
    if (count > 5) return 'full';
    return count * 48;
  }

  get options(): OptionItem[] {
    if (!this.promptData) return [];

    switch (this.promptData.type) {
      case 'SELECT_POSITION':
        return this.buildPositionOptions();
      case 'SELECT_OPTION':
        return (this.promptData.options ?? []).map((opt, i) => ({
          index: i, label: `Option ${opt}`, icon: null,
        }));
      case 'ANNOUNCE_RACE':
        return (this.promptData.available ?? []).map((race, i) => ({
          index: i, label: `Race ${race}`, icon: null,
        }));
      case 'ANNOUNCE_ATTRIB':
        return (this.promptData.available ?? []).map((attr, i) => ({
          index: i, label: `Attribute ${attr}`, icon: null,
        }));
      default:
        return [];
    }
  }

  private buildPositionOptions(): OptionItem[] {
    if (this.promptData?.type !== 'SELECT_POSITION') return [];
    return this.promptData.positions.map((pos, i) => {
      let label = 'Unknown';
      let icon: string | null = null;
      if (pos === POSITION.FACEUP_ATTACK) { label = 'Face-up Attack'; icon = '⚔️'; }
      else if (pos === POSITION.FACEDOWN_ATTACK) { label = 'Face-down Attack'; icon = '🔽'; }
      else if (pos === POSITION.FACEUP_DEFENSE) { label = 'Face-up Defense'; icon = '🛡️'; }
      else if (pos === POSITION.FACEDOWN_DEFENSE) { label = 'Set'; icon = '🔻'; }
      return { index: i, label, icon };
    });
  }

  selectOption(index: number): void {
    if (this.answered) return;
    this.selectedIndex.set(index);
  }

  confirm(): void {
    const idx = this.selectedIndex();
    if (this.answered || idx === null) return;
    this.answered = true;

    if (this.promptData?.type === 'SELECT_POSITION') {
      this.response.emit({ position: this.promptData.positions[idx] });
    } else if (this.promptData?.type === 'ANNOUNCE_RACE' || this.promptData?.type === 'ANNOUNCE_ATTRIB') {
      this.response.emit({ value: this.promptData.available[idx] });
    } else {
      this.response.emit({ index: idx });
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const current = this.selectedIndex() ?? -1;
    const max = this.options.length - 1;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.set(Math.min(current + 1, max));
        break;
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
