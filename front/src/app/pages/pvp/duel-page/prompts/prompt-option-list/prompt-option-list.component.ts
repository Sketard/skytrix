import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  HostListener,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { PromptSubComponent } from '../prompt.types';
import { HintContext } from '../../../types';
import { CardInfo, POSITION, SelectPositionMsg, SelectOptionMsg, AnnounceRaceMsg, AnnounceAttribMsg } from '../../../duel-ws.types';
import { TranslatePipe } from '@ngx-translate/core';
import { DuelCardArtService } from '../../duel-card-art.service';

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
  imports: [TranslatePipe],
})
export class PromptOptionListComponent implements PromptSubComponent<OptionListPrompt>, OnInit {
  promptData: OptionListPrompt | null = null;
  hintContext: HintContext | null = null;
  response = new EventEmitter<unknown>();
  @HostBinding('class.read-only') readOnly = false;
  preSelectedResponse: unknown = undefined;
  revealedCards: CardInfo[] = [];

  private readonly artService = inject(DuelCardArtService);
  readonly getCardImageUrl = (code: number | null) => this.artService.resolveUrl(code);

  readonly selectedIndex = signal<number | null>(null);
  answered = false;

  ngOnInit(): void {
    if (this.readOnly && this.preSelectedResponse != null) {
      const r = this.preSelectedResponse as Record<string, unknown>;
      if (r['position'] != null) {
        // SELECT_POSITION: find index by position value
        const pos = r['position'] as number;
        if (this.promptData?.type === 'SELECT_POSITION') {
          const idx = this.promptData.positions.indexOf(pos);
          if (idx >= 0) this.selectedIndex.set(idx);
        }
      } else if (r['value'] != null) {
        // ANNOUNCE_RACE/ANNOUNCE_ATTRIB: find index by value
        const val = r['value'] as number;
        if (this.promptData?.type === 'ANNOUNCE_RACE' || this.promptData?.type === 'ANNOUNCE_ATTRIB') {
          const idx = this.promptData.available.indexOf(val);
          if (idx >= 0) this.selectedIndex.set(idx);
        }
      } else if (r['index'] != null) {
        this.selectedIndex.set(r['index'] as number);
      }
      this.answered = true;
    }
  }

  get options(): OptionItem[] {
    if (!this.promptData) return [];

    switch (this.promptData.type) {
      case 'SELECT_POSITION':
        return this.buildPositionOptions();
      case 'SELECT_OPTION':
        return (this.promptData.options ?? []).map((opt, i) => ({
          index: i,
          label: this.promptData!.type === 'SELECT_OPTION' && this.promptData!.descriptions?.[i]
            ? this.promptData!.descriptions[i]
            : `Option ${i + 1}`,
          icon: null,
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

  /** Double-click on an option = select + confirm in one gesture. */
  dblclickOption(index: number): void {
    if (this.answered || this.readOnly) return;
    this.selectedIndex.set(index);
    this.confirm();
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
    if (this.readOnly) return;
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
