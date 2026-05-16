import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

// Composite of DS Wave 1 pills + text-eyebrow for the transport-bar context
// zone (turn pill + phase chip + event label). Single host is responsible
// for the cascade hide ordering on narrow viewports (D13):
// ≤ 920px → event label + phase chip drop. The turn pill always stays.
//
// The player-position label ("P1") was removed 2026-05-16 — the same info
// already lives on the perspective swap button in the transport-bar options
// cluster, no need to duplicate it next to the turn pill.
//
// Used by `TransportBarComponent` (F3) AND by the mobile stepper context line.
// All visuals come from DS utility classes — this SCSS file only carries the
// layout primitive (`display: inline-flex; gap;`) + the cascade-hide MQs.
@Component({
  selector: 'app-context-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  templateUrl: './context-pill.component.html',
  styleUrl: './context-pill.component.scss',
})
export class ContextPillComponent {
  readonly turnLabel = input.required<string>();         // "Tour 3 / 11 tours" or "T0 · Setup"
  readonly phase = input<string | null>(null);           // "Main 1"
  readonly eventLabel = input<string | null>(null);      // "Activation : Snake-Eye Ash"

  protected readonly hasPhase = computed(() => !!this.phase());
  protected readonly hasEvent = computed(() => !!this.eventLabel());
}
