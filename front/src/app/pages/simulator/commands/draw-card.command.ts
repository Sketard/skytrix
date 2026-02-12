import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export class DrawCardCommand implements SimCommand {
  private drawnCard: CardInstance | undefined;

  constructor(private readonly boardState: BoardStateService) {}

  execute(): void {
    const deck = this.boardState.boardState()[ZoneId.MAIN_DECK];
    if (deck.length === 0) return;
    // Top of deck = last element
    const drawnCard = deck[deck.length - 1];
    this.drawnCard = drawnCard;

    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.MAIN_DECK]: state[ZoneId.MAIN_DECK].slice(0, -1),
      [ZoneId.HAND]: [...state[ZoneId.HAND], drawnCard],
    }));
  }

  undo(): void {
    const drawnCard = this.drawnCard;
    if (!drawnCard) return;
    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.HAND]: state[ZoneId.HAND].filter(c => c.instanceId !== drawnCard.instanceId),
      [ZoneId.MAIN_DECK]: [...state[ZoneId.MAIN_DECK], drawnCard],
    }));
  }
}
