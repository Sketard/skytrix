import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';

export type SystemOverlayVariant = 'lost' | 'reconnecting' | 'grace' | 'blocked';

@Component({
  selector: 'app-system-overlay',
  standalone: true,
  imports: [CdkTrapFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './system-overlay.component.html',
  styleUrl: './system-overlay.component.scss',
})
export class SystemOverlayComponent {
  readonly variant = input.required<SystemOverlayVariant>();
  readonly title = input<string>('');
  readonly subtitle = input<string>('');
  readonly ariaLabel = input<string>('');
  readonly pulseTitle = input<boolean>(false);

  protected readonly isModal = computed(() =>
    this.variant() === 'lost' || this.variant() === 'blocked',
  );

  protected readonly role = computed(() => this.isModal() ? 'alertdialog' : 'status');
  protected readonly ariaLive = computed(() => this.isModal() ? null : 'polite');
  protected readonly resolvedAriaLabel = computed(() => this.ariaLabel() || this.title());
}
