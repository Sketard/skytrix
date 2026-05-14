import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { i18nAttr } from '../../../../shared/i18n';

export type ZoomLevel = 1 | 2 | 3;

// Mini-control `1× 2× 3×` rendered inside `TransportBarComponent` (.transport-options
// cluster). Caché sous 920px via CSS (D7 — power-user feature, cramped layout).
//
// State is lifted at page level (`ReplayPageComponent.zoomLevel`) — this component
// is purely input/output driven. The page wires the same signal to both this
// control AND the TimelineBar so the wheel-handler on the bar emits to the
// shared source of truth (D21).
@Component({
  selector: 'app-timeline-zoom-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  templateUrl: './timeline-zoom-control.component.html',
  styleUrl: './timeline-zoom-control.component.scss',
  host: {
    role: 'radiogroup',
    '[attr.aria-label]': 'ariaLabel()',
  },
})
export class TimelineZoomControlComponent {
  readonly level = input.required<ZoomLevel>();
  readonly levelChange = output<ZoomLevel>();

  protected readonly levels: ZoomLevel[] = [1, 2, 3];
  protected readonly ariaLabel = i18nAttr('replay.viewer.zoom.label');

  protected onSelect(next: ZoomLevel): void {
    if (next === this.level()) return;
    this.levelChange.emit(next);
  }
}
