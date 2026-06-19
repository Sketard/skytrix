import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { IconButtonComponent } from '../../../components/icon-button/icon-button.component';
import { InputComponent } from '../../../components/input/input.component';
import { ZoneId as PvpZoneId } from '../duel-ws.types';

/**
 * Free-mode mini-bar PILE (§6.2 / T4) — replaces the simulator's right-click
 * deck menu (gone with drag). Shuffle / Mill N / Reveal N / Browse. Mill & Reveal
 * apply to the MAIN DECK only (sim semantics); other piles get Browse only.
 *
 * The N count uses a DS `<app-input type="number">` (never `window.prompt`,
 * which the sim used — out of the DS + blocking). Presentational: the page
 * routes shuffle/mill/reveal/browse to CommandStack / BoardStateService.
 */
@Component({
  selector: 'app-free-mode-pile-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './free-mode-pile-bar.component.html',
  styleUrl: './free-mode-pile-bar.component.scss',
  imports: [IconButtonComponent, InputComponent, MatIcon, FormsModule],
})
export class FreeModePileBarComponent {
  /** The PvP pile zone this bar acts on. */
  readonly zone = input.required<PvpZoneId>();

  /** Shuffle / Mill / Reveal apply to the main deck only. */
  readonly isDeck = computed(() => this.zone() === 'DECK');

  /** The N value for mill / reveal (bound to the DS number input). */
  // why: local editor input state outside the animation pipeline taxonomy.
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  readonly count = signal(1);

  readonly shuffle = output<void>();
  readonly mill = output<number>();
  readonly reveal = output<number>();
  readonly browse = output<void>();

  protected emitMill(): void {
    const n = Math.max(1, Math.floor(this.count()));
    this.mill.emit(n);
  }

  protected emitReveal(): void {
    const n = Math.max(1, Math.floor(this.count()));
    this.reveal.emit(n);
  }
}
