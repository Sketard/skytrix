import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-dice-arena-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    'aria-label': 'Chargement de l\'arène de dés',
  },
  template: `
    <div class="dice-arena-skel" aria-hidden="true">
      <div class="skel-die"></div>
      <div class="skel-die"></div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      max-width: 720px;
      margin: 0 auto;
    }
  `],
})
export class DiceArenaSkeletonComponent {}
