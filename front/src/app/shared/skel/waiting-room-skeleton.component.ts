import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-waiting-room-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    'aria-label': 'Chargement de la salle d\'attente',
  },
  template: `
    <div class="waiting-skel-tag"></div>
    <div class="waiting-skel-title"></div>
    <div class="waiting-skel-card">
      <div class="waiting-skel-slot">
        <div class="waiting-skel-avatar-big"></div>
        <div class="waiting-skel-name"></div>
      </div>
      <div class="waiting-skel-vs"></div>
      <div class="waiting-skel-slot">
        <div class="waiting-skel-avatar-big"></div>
        <div class="waiting-skel-name"></div>
      </div>
    </div>
    <div class="waiting-skel-code">
      <div class="waiting-skel-code-label"></div>
      <div class="waiting-skel-code-value"></div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-5, 20px);
      width: 100%;
      max-width: 540px;
      margin: 0 auto;
    }
  `],
})
export class WaitingRoomSkeletonComponent {}
