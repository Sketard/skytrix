import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export interface DeckStat {
  label: string;
  value: number | string;
}

@Component({
  selector: 'app-deck-stats-strip',
  templateUrl: './deck-stats-strip.component.html',
  styleUrl: './deck-stats-strip.component.scss',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckStatsStripComponent {
  readonly stats = input.required<Array<DeckStat>>();
}
