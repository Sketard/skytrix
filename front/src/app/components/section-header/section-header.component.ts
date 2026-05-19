import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Section header — title + optional count badge + slotted actions.
 *
 * BEM source of truth: `styles/_section-header.scss`. Action slot is intended
 * for `.btn.btn--ghost.btn--sm` triggers (sort menu, filter chips, etc.).
 */
@Component({
  selector: 'app-section-header',
  standalone: true,
  imports: [MatIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './section-header.component.html',
  styleUrl: './section-header.component.scss',
})
export class SectionHeaderComponent {
  readonly titleKey = input.required<string>();
  readonly icon = input<string>();
  readonly count = input<number | null>(null);
  readonly countKey = input<string>();

  readonly hasCount = computed(() => this.count() != null);
  readonly countLabel = computed(() => {
    const k = this.countKey();
    return k ?? null;
  });
}
