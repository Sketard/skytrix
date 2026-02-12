import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export class DrawCardCommand implements SimCommand {
  private drawnCard: CardInstance | undefined;

  constructor(private readonly boardState: BoardStateService) {}

  execute(): void {
    const deck = this.boardState.boardState()[ZoneId.MAIN_DECK];
    if (deck.length === 0) return;
    // Top of deck = last element — store original (face-down) for undo
    this.drawnCard = deck[deck.length - 1];
    // Card arrives face-up in hand
    const handCard = this.drawnCard.faceDown
      ? { ...this.drawnCard, faceDown: false }
      : this.drawnCard;

    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.MAIN_DECK]: state[ZoneId.MAIN_DECK].slice(0, -1),
      [ZoneId.HAND]: [...state[ZoneId.HAND], handCard],
    }));
  }

  undo(): void {
    const drawnCard = this.drawnCard;
    if (!drawnCard) return;
    // Restore original card (face-down) back to deck
    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.HAND]: state[ZoneId.HAND].filter(c => c.instanceId !== drawnCard.instanceId),
      [ZoneId.MAIN_DECK]: [...state[ZoneId.MAIN_DECK], drawnCard],
    }));
  }
}
