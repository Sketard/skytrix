import { ChangeDetectionStrategy, Component, HostListener, inject, isDevMode } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ZoneId } from './simulator.models';
import { SimZoneComponent } from './zone.component';
import { SimStackedZoneComponent } from './stacked-zone.component';
import { SimHandComponent } from './hand.component';
import { SimCardInspectorComponent } from './card-inspector.component';
import { SimPileOverlayComponent } from './pile-overlay.component';
import { SimXyzMaterialPeekComponent } from './xyz-material-peek.component';
import { BoardStateService } from './board-state.service';
import { CommandStackService } from './command-stack.service';
import { SimControlBarComponent } from './control-bar.component';

@Component({
  selector: 'app-sim-board',
  templateUrl: './board.component.html',
  styleUrl: './board.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, SimZoneComponent, SimStackedZoneComponent, SimHandComponent, SimCardInspectorComponent, SimPileOverlayComponent, SimXyzMaterialPeekComponent, SimControlBarComponent],
})
export class SimBoardComponent {
  protected readonly ZoneId = ZoneId;
  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);
  readonly forceReducedMotion = this.boardState.forceReducedMotion;

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }

    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      try {
        this.commandStack.undo();
      } catch (e) {
        if (isDevMode()) console.warn('Keyboard undo failed:', e);
      }
      return;
    }

    if (ctrl && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      try {
        this.commandStack.redo();
      } catch (e) {
        if (isDevMode()) console.warn('Keyboard redo failed:', e);
      }
      return;
    }
  }
}
