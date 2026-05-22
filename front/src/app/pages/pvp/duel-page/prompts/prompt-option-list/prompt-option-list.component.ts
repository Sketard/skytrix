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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DuelCardArtService } from '../../duel-card-art.service';
import { DuelSystemStringsService } from '../../../duel-system-strings.service';
import { resolveDescription } from '../../../duel-description.util';
import { CardDataCacheService } from '../../card-data-cache.service';

interface OptionItem {
  index: number;
  label: string;
  icon: string | null;
}

type OptionListPrompt = SelectPositionMsg | SelectOptionMsg | AnnounceRaceMsg | AnnounceAttribMsg;

/** OCGCore battle-position value → i18n key + icon for SELECT_POSITION. */
const POSITION_LABELS: ReadonlyArray<{ pos: number; key: string; icon: string }> = [
  { pos: POSITION.FACEUP_ATTACK, key: 'duel.prompt.position.faceUpAttack', icon: '⚔️' },
  { pos: POSITION.FACEDOWN_ATTACK, key: 'duel.prompt.position.faceDownAttack', icon: '🔽' },
  { pos: POSITION.FACEUP_DEFENSE, key: 'duel.prompt.position.faceUpDefense', icon: '🛡️' },
  { pos: POSITION.FACEDOWN_DEFENSE, key: 'duel.prompt.position.set', icon: '🔻' },
];

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
  private readonly translate = inject(TranslateService);
  private readonly systemStrings = inject(DuelSystemStringsService);
  private readonly cardDataCache = inject(CardDataCacheService);
  readonly getCardImageUrl = (code: number | null) => this.artService.resolveUrl(code);

  readonly selectedIndex = signal<number | null>(null);
  answered = false;

  /** SELECT_OPTION labels, resolved (system synchronously, card-text async). */
  private readonly resolvedOptionLabels = signal<string[]>([]);

  ngOnInit(): void {
    this.restorePreSelection();
    if (this.promptData?.type === 'SELECT_OPTION') {
      void this.resolveOptionLabels(this.promptData.options ?? []);
    }
  }

  private restorePreSelection(): void {
    if (!this.readOnly || this.preSelectedResponse == null) return;
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

  /**
   * Resolves each SELECT_OPTION code to a localized label.
   *
   * The server now ships `optionTexts` — the per-code effect text resolved
   * from its `strN` paragraph (cards.cdb), the only place that text exists.
   * It is preferred whenever present and non-empty. The legacy client-side
   * path is the fallback for payloads without `optionTexts`: a system string
   * resolves synchronously, a card-text code degrades to the card's name
   * (no `strN` access client-side). When `optionTexts` IS present but an
   * entry is `''` (server dropped a placeholder string / unknown card), the
   * generic "Option N" label is shown — never a misleading card name.
   */
  private async resolveOptionLabels(codes: number[]): Promise<void> {
    const optionTexts =
      this.promptData?.type === 'SELECT_OPTION'
        ? this.promptData.optionTexts
        : undefined;
    const deps = { resolveSystemString: (i: number) => this.systemStrings.resolveSystemString(i) };
    await this.systemStrings.preload();
    const labels = await Promise.all(
      codes.map(async (code, i) => {
        const fallback = this.translate.instant('duel.prompt.optionFallback', { n: i + 1 });
        // Server-resolved text wins. `optionTexts` present ⇒ trust it fully:
        // a '' entry is an explicit "nothing usable", fall to the generic label.
        if (optionTexts) return optionTexts[i] || fallback;

        // Legacy payload — best-effort client-side resolution.
        const result = resolveDescription(code, deps);
        if (result.kind === 'system') return result.text || fallback;
        const card = await this.cardDataCache.getCardData(result.cardCode);
        return card.name || fallback;
      }),
    );
    this.resolvedOptionLabels.set(labels);
  }

  get options(): OptionItem[] {
    if (!this.promptData) return [];

    switch (this.promptData.type) {
      case 'SELECT_POSITION':
        return this.buildPositionOptions();
      case 'SELECT_OPTION': {
        const resolved = this.resolvedOptionLabels();
        return (this.promptData.options ?? []).map((_opt, i) => ({
          index: i,
          label: resolved[i] || this.translate.instant('duel.prompt.optionFallback', { n: i + 1 }),
          icon: null,
        }));
      }
      case 'ANNOUNCE_RACE':
        return (this.promptData.available ?? []).map((race, i) => ({
          index: i, label: this.translate.instant('duel.prompt.raceFallback', { n: race }), icon: null,
        }));
      case 'ANNOUNCE_ATTRIB':
        return (this.promptData.available ?? []).map((attr, i) => ({
          index: i, label: this.translate.instant('duel.prompt.attributeFallback', { n: attr }), icon: null,
        }));
      default:
        return [];
    }
  }

  private buildPositionOptions(): OptionItem[] {
    if (this.promptData?.type !== 'SELECT_POSITION') return [];
    return this.promptData.positions.map((pos, i) => {
      const entry = POSITION_LABELS.find(e => e.pos === pos);
      return {
        index: i,
        label: entry ? this.translate.instant(entry.key) : this.translate.instant('duel.prompt.position.unknown'),
        icon: entry?.icon ?? null,
      };
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
