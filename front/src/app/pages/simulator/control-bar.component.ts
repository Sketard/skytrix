import { ChangeDetectionStrategy, Component, computed, inject, isDevMode } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BoardStateService } from './board-state.service';
import { CommandStackService } from './command-stack.service';

@Component({
  selector: 'app-sim-control-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './control-bar.component.html',
  styleUrl: './control-bar.component.scss',
  host: {
    '[class.pile-open]': 'isPileOpen()',
  },
})
export class SimControlBarComponent {
  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);

  readonly isPileOpen = this.boardState.isOverlayOpen;
  readonly canUndo = this.commandStack.canUndo;
  readonly canRedo = this.commandStack.canRedo;

  readonly isDevMode = isDevMode();
  readonly undoCount = computed(() => this.commandStack.undoStack().length);
  readonly redoCount = computed(() => this.commandStack.redoStack().length);
  readonly reducedMotion = this.boardState.forceReducedMotion;

  onUndo(): void {
    try {
      this.commandStack.undo();
    } catch (e) {
      if (isDevMode()) console.warn('Undo failed:', e);
    }
  }

  onRedo(): void {
    try {
      this.commandStack.redo();
    } catch (e) {
      if (isDevMode()) console.warn('Redo failed:', e);
    }
  }

  onReset(): void {
    const confirmed = confirm('Reset the board? This will clear undo history and deal a new hand.');
    if (!confirmed) return;

    try {
      this.commandStack.reset();
    } catch (e) {
      if (isDevMode()) console.warn('Reset failed:', e);
    }
  }

  onToggleReducedMotion(): void {
    this.boardState.forceReducedMotion.update(v => !v);
  }
}
