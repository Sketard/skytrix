import { ChangeDetectionStrategy, Component, HostListener, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { i18nAttr } from '../../../../shared/i18n';

interface CheatItem {
  /** i18n key under `replay.transport.*` (existing) or `replay.viewer.cheatSheet.*` (new). */
  labelKey: string;
  /** Display tokens for keys. Single-token = one <kbd>; multi-token separated by '+' renders <kbd>+<kbd>. */
  keys: string[];
}

interface CheatSection {
  titleKey: string;
  items: CheatItem[];
}

// Keyboard shortcuts modal — rendered as a self-contained surface card.
// Esc closes via `(close)` output. The page hosts it inside a backdrop element
// when needed; rendering is gated by the page's signal (mounted only when open).
//
// Existing `replay.transport.*` keys are reused for the actions whose label
// matches transport tooltips (cf. F5 §i18n note). Only "help" and "close" are
// truly new under `replay.viewer.cheatSheet.*`.
@Component({
  selector: 'app-replay-cheat-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  templateUrl: './replay-cheat-sheet.component.html',
  styleUrl: './replay-cheat-sheet.component.scss',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': 'ariaLabel()',
  },
})
export class ReplayCheatSheetComponent {
  readonly close = output<void>();

  // Resolved via i18nAttr so the host binding doesn't need the pipe (forbidden).
  protected readonly ariaLabel = i18nAttr('replay.viewer.cheatSheet.title');

  protected readonly sections: CheatSection[] = [
    {
      titleKey: 'replay.viewer.cheatSheet.section.playback',
      items: [
        { labelKey: 'replay.viewer.cheatSheet.playPause',     keys: ['Space'] },
        { labelKey: 'replay.viewer.cheatSheet.stepEvent',     keys: ['←', '→'] },
        { labelKey: 'replay.viewer.cheatSheet.skipBoundary',  keys: ['Home', 'End'] },
      ],
    },
    {
      titleKey: 'replay.viewer.cheatSheet.section.viewing',
      items: [
        { labelKey: 'replay.viewer.cheatSheet.perspective',   keys: ['V'] },
        { labelKey: 'replay.viewer.cheatSheet.animations',    keys: ['A'] },
        { labelKey: 'replay.viewer.cheatSheet.promptMode',    keys: ['M'] },
        { labelKey: 'replay.viewer.cheatSheet.debug',         keys: ['D'] },
        { labelKey: 'replay.viewer.cheatSheet.logLevel',      keys: ['G'] },
      ],
    },
    {
      titleKey: 'replay.viewer.cheatSheet.section.actions',
      items: [
        { labelKey: 'replay.viewer.cheatSheet.fork',          keys: ['F'] },
        { labelKey: 'replay.viewer.cheatSheet.help',          keys: ['?'] },
        { labelKey: 'replay.viewer.cheatSheet.close',         keys: ['Esc'] },
      ],
    },
  ];

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.close.emit();
  }
}
