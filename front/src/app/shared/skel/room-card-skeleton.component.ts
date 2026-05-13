import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-room-card-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    'aria-label': 'Chargement des rooms',
  },
  template: `
    @for (i of placeholders(); track i) {
      <div class="room-card-skel" aria-hidden="true">
        <div class="skel-avatar"></div>
        <div class="skel-lines">
          <div class="skel skel--text-md skel--w-40"></div>
          <div class="skel skel--text-sm skel--w-60"></div>
        </div>
        <div class="skel skel--pill" style="width: 64px; height: 24px;"></div>
        <div class="skel-btn"></div>
      </div>
    }
  `,
  styles: [`:host { display: flex; flex-direction: column; gap: 10px; }`],
})
export class RoomCardSkeletonComponent {
  readonly count = input<number>(4);
  readonly placeholders = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
