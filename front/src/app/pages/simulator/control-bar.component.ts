import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, input, isDevMode, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { BoardStateService } from './board-state.service';
import { CommandStackService } from './command-stack.service';
import { NavbarCollapseService } from '../../services/navbar-collapse.service';

@Component({
  selector: 'app-sim-control-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './control-bar.component.html',
  styleUrl: './control-bar.component.scss',
  host: {
    '[class.pile-open]': 'isPileOpen()',
    '[class.mobile]': 'isMobile()',
    '[class.mobile-portrait]': 'isMobilePortrait()',
    '[class.expanded]': 'isExpanded()',
  },
})
export class SimControlBarComponent {
  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);
  private readonly router = inject(Router);
  private readonly navbarCollapse = inject(NavbarCollapseService);
  private readonly elRef = inject(ElementRef);

  readonly isMobile = this.navbarCollapse.isMobile;
  readonly isMobilePortrait = this.navbarCollapse.isMobilePortrait;

  readonly deckId = input(0);

  readonly isPileOpen = this.boardState.isOverlayOpen;
  readonly canUndo = this.commandStack.canUndo;
  readonly canRedo = this.commandStack.canRedo;

  readonly isDevMode = isDevMode();
  readonly undoCount = computed(() => this.commandStack.undoStack().length);
  readonly redoCount = computed(() => this.commandStack.redoStack().length);

  readonly isExpanded = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isMobile() || !this.isExpanded()) return;
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.isExpanded.set(false);
    }
  }

  toggleExpand(): void {
    this.isExpanded.update(v => !v);
  }

  private collapseAfterAction(): void {
    if (this.isMobile()) {
      setTimeout(() => this.isExpanded.set(false), 300);
    }
  }

  onUndo(): void {
    try {
      this.commandStack.undo();
      this.collapseAfterAction();
    } catch (e) {
      if (isDevMode()) console.warn('Undo failed:', e);
    }
  }

  onRedo(): void {
    try {
      this.commandStack.redo();
      this.collapseAfterAction();
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
      this.collapseAfterAction();
    } catch (e) {
      if (isDevMode()) console.warn('Reset failed:', e);
    }
  }
}
