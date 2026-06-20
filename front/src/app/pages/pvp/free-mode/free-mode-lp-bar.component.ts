import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { IconButtonComponent } from '../../../components/icon-button/icon-button.component';
import { InputComponent } from '../../../components/input/input.component';

/** Quick LP adjustment steps (the common cost/burn amounts). */
const LP_STEP = 1000;
const LP_STEP_SMALL = 100;

/**
 * Free-mode LP editor (UX §4 — LP is a NEW free-mode capability the sim lacks).
 * Mono-player: edits player 0's LP only. Quick ±1000 / ±100 buttons + a direct
 * DS number input, floored at 0. Presentational — the page owns the `lp` signal
 * and feeds it back through the board-sync effect.
 */
@Component({
  selector: 'app-free-mode-lp-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './free-mode-lp-bar.component.html',
  styleUrl: './free-mode-lp-bar.component.scss',
  imports: [IconButtonComponent, InputComponent, MatIcon, FormsModule],
})
export class FreeModeLpBarComponent {
  /** Current LP (player 0). */
  readonly lp = input.required<number>();

  /** Emits the new LP value (already floored at 0). */
  readonly lpChange = output<number>();

  protected step(delta: number): void {
    this.emit(this.lp() + delta);
  }

  /** Set LP from the raw input string. Ignores a transient empty / non-numeric
   *  value (the field being cleared to retype) instead of snapping LP to 0,
   *  which would fight the user's edit through the [ngModel]="lp()" round-trip. */
  protected setExact(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return;
    this.emit(value);
  }

  private emit(value: number): void {
    this.lpChange.emit(Math.max(0, Math.floor(value)));
  }

  protected readonly LP_STEP = LP_STEP;
  protected readonly LP_STEP_SMALL = LP_STEP_SMALL;
}
