import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';

import type { SolverProgress } from '../../../core/model/solver.model';

@Component({
  selector: 'app-solver-progress',
  standalone: true,
  imports: [MatButtonModule, MatProgressSpinnerModule, TranslatePipe],
  templateUrl: './solver-progress.component.html',
  styleUrl: './solver-progress.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SolverProgressComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly progress = input.required<SolverProgress | null>();
  readonly isVerifying = input(false);
  readonly cancel = output<void>();

  readonly scoreHighlighted = signal(false);
  private previousBestScore = -1;
  private highlightTimeoutId: ReturnType<typeof setTimeout> | null = null;

  readonly elapsedFormatted = computed(() => {
    const p = this.progress();
    if (!p) return '00:00';
    const totalSeconds = Math.floor(p.elapsed / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  });

  constructor() {
    effect(() => {
      const p = this.progress();
      if (!p) return;

      if (p.bestScore > this.previousBestScore && this.previousBestScore >= 0) {
        if (this.highlightTimeoutId !== null) {
          clearTimeout(this.highlightTimeoutId);
        }
        this.scoreHighlighted.set(true);
        this.highlightTimeoutId = setTimeout(() => {
          this.scoreHighlighted.set(false);
          this.highlightTimeoutId = null;
        }, 300);
      }
      this.previousBestScore = p.bestScore;
    });

    this.destroyRef.onDestroy(() => {
      if (this.highlightTimeoutId !== null) {
        clearTimeout(this.highlightTimeoutId);
      }
    });
  }
}
