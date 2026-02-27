import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { SharedCardInspectorData } from '../../../../core/model/shared-card-data';
import { CardInspectorComponent } from '../../../../components/card-inspector/card-inspector.component';

@Component({
  selector: 'app-pvp-card-inspector-wrapper',
  templateUrl: './pvp-card-inspector-wrapper.component.html',
  styleUrl: './pvp-card-inspector-wrapper.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardInspectorComponent],
})
export class PvpCardInspectorWrapperComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly card = input<SharedCardInspectorData | null>(null);
  readonly promptActive = input(false);

  readonly dismissed = output<void>();

  readonly isCompact = signal(false);
  // [M2 fix] Separate signal for user-initiated re-expand while prompt is active
  readonly forceExpanded = signal(false);
  private mql: MediaQueryList | null = null;

  constructor() {
    this.mql = window.matchMedia('(min-width: 768px)');
    this.isCompact.set(!this.mql.matches);

    const handler = (e: MediaQueryListEvent) => this.isCompact.set(!e.matches);
    this.mql.addEventListener('change', handler);
    this.destroyRef.onDestroy(() => this.mql?.removeEventListener('change', handler));

    // Reset forceExpanded when a new prompt arrives → back to compact
    effect(() => {
      this.promptActive();
      untracked(() => this.forceExpanded.set(false));
    });
  }

  readonly shouldShowCompact = computed(() => {
    if (this.forceExpanded()) return false;
    if (this.promptActive()) return true;
    return this.isCompact();
  });

  onCompactTap(): void {
    if (this.shouldShowCompact()) {
      this.forceExpanded.set(true);
    }
  }

  onDismissed(): void {
    this.dismissed.emit();
  }
}
