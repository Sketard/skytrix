import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type SkelVariant = 'rect' | 'circle' | 'pill' | 'text-sm' | 'text-md' | 'text-lg';

// Skeleton placeholder primitive. Renders a `<div class="skel skel--{variant}">`
// with optional inline width/height. Used standalone (variant defines shape +
// height for text variants) or as a building block inside composite skeletons
// (`<app-room-card-skeleton>`, etc.). The composites target the global class
// rules in skel.scss — `<app-skel>` only consumes `.skel` + `.skel--{variant}`.
@Component({
  selector: 'app-skel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      [class]="cssClass()"
      [style.width]="width()"
      [style.height]="height()"
      aria-hidden="true"
    ></div>
  `,
})
export class SkelComponent {
  readonly variant = input<SkelVariant>('rect');
  readonly width = input<string | undefined>(undefined);
  readonly height = input<string | undefined>(undefined);

  readonly cssClass = computed(() => `skel skel--${this.variant()}`);
}
