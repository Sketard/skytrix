import { ChangeDetectionStrategy, Component, inject, model } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';

export type ActivationMode = 'auto' | 'on' | 'off';

const MODE_CYCLE: ActivationMode[] = ['auto', 'on', 'off'];

const MODE_LABELS: Record<ActivationMode, string> = {
  auto: 'Auto',
  on: 'On',
  off: 'Off',
};

const MODE_ICONS: Record<ActivationMode, string> = {
  auto: 'A',
  on: '✓',
  off: '✕',
};

@Component({
  selector: 'app-pvp-activation-toggle',
  templateUrl: './pvp-activation-toggle.component.html',
  styleUrl: './pvp-activation-toggle.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvpActivationToggleComponent {
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  readonly mode = model<ActivationMode>('auto');

  get label(): string {
    return MODE_LABELS[this.mode()];
  }

  get icon(): string {
    return MODE_ICONS[this.mode()];
  }

  cycle(): void {
    const current = this.mode();
    const idx = MODE_CYCLE.indexOf(current);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    this.mode.set(next);
    this.liveAnnouncer.announce(`Activation toggle: ${MODE_LABELS[next]}`);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.cycle();
      event.preventDefault();
    }
  }
}
