import { ChangeDetectionStrategy, Component, computed, contentChild, input, TemplateRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/**
 * Repeats a projected `<ng-template>` `count` times and wraps the block
 * with the a11y wiring shared by every "loading list" skeleton (role,
 * aria-busy, aria-live, aria-label).
 *
 * The item shape is fully owned by the caller — `<app-skeleton-list>`
 * only knows how to repeat + announce. The template is selected via the
 * `*skelItem` structural directive (no need to project as a named slot).
 *
 * Usage:
 * ```html
 * <app-skeleton-list [count]="4" ariaLabel="a11y.loadingRooms">
 *   <ng-template skelItem>
 *     <div class="room-card-skel" aria-hidden="true">…</div>
 *   </ng-template>
 * </app-skeleton-list>
 * ```
 *
 * Pass the translated string (or i18n key handled via TranslatePipe at
 * the call site) — this component is i18n-agnostic to avoid pulling in
 * TranslateModule everywhere.
 */
@Component({
  selector: 'app-skeleton-list',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skeleton-list.component.html',
  styleUrl: './skeleton-list.component.scss',
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    '[attr.aria-label]': 'ariaLabel()',
  },
})
export class SkeletonListComponent {
  readonly count = input<number>(4);
  readonly ariaLabel = input.required<string>();

  protected readonly itemTemplate = contentChild.required(TemplateRef);

  readonly placeholders = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
