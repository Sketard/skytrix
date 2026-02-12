import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { BoardStateService } from './board-state.service';
import { CommandStackService } from './command-stack.service';
import { createGlowEffect } from './glow-effect';
import { CardInstance, ZoneId } from './simulator.models';
import { SimCardComponent } from './sim-card.component';

@Component({
  selector: 'app-sim-hand',
  templateUrl: './hand.component.html',
  styleUrl: './hand.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DragDropModule, SimCardComponent],
})
export class SimHandComponent {
  private readonly boardState = inject(BoardStateService);
  private readonly commandStack = inject(CommandStackService);

  protected readonly ZoneId = ZoneId;

  readonly cards = computed(() => this.boardState.hand());
  readonly isEmpty = computed(() => this.cards().length === 0);
  private readonly glow = createGlowEffect();
  readonly justDropped = this.glow.justDropped;
  readonly onGlowAnimationEnd = this.glow.onGlowAnimationEnd;

  onDrop(event: CdkDragDrop<ZoneId, ZoneId, CardInstance>): void {
    const fromZone = event.previousContainer.data;
    const toZone = event.container.data;

    if (fromZone === ZoneId.HAND && toZone === ZoneId.HAND) {
      this.commandStack.reorderHand(event.previousIndex, event.currentIndex);
    } else if (fromZone === ZoneId.MAIN_DECK && toZone === ZoneId.HAND) {
      // drawCard() handles empty deck via silent return — cdkDragDisabled prevents this case
      this.commandStack.drawCard();
      this.glow.triggerGlow();
    } else {
      const cardInstanceId = event.item.data.instanceId;
      try {
        this.commandStack.moveCard(cardInstanceId, fromZone, toZone, event.currentIndex);
        this.glow.triggerGlow();
      } catch {
        // Invalid drop — silently ignored, card returns to origin via CDK
      }
    }
  }

  onDragStarted(): void {
    this.boardState.isDragging.set(true);
  }

  onDragEnded(): void {
    this.boardState.isDragging.set(false);
  }

  onCardHovered(card: CardInstance): void {
    this.boardState.setHoveredCard(card);
  }

  onCardUnhovered(): void {
    this.boardState.setHoveredCard(null);
  }
}
