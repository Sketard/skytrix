import { ChangeDetectionStrategy, Component, computed, inject, input, isDevMode } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
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
  private readonly router = inject(Router);

  readonly deckId = input(0);

  readonly isPileOpen = this.boardState.isOverlayOpen;
  readonly canUndo = this.commandStack.canUndo;
  readonly canRedo = this.commandStack.canRedo;

  readonly isDevMode = isDevMode();
  readonly undoCount = computed(() => this.commandStack.undoStack().length);
  readonly redoCount = computed(() => this.commandStack.redoStack().length);
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

  onBack(): void {
    const id = this.deckId();
    this.router.navigate(id > 0 ? ['/decks', id] : ['/decks']);
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

}
