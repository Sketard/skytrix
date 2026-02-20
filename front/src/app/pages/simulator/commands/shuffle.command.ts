import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export class ShuffleCommand implements SimCommand {
  private previousOrder: CardInstance[] = [];

  constructor(private readonly boardState: BoardStateService) {}

  execute(): void {
    // Capture order before shuffle
    this.previousOrder = [...this.boardState.boardState()[ZoneId.MAIN_DECK]];

    this.boardState.boardState.update(state => {
      const shuffled = [...state[ZoneId.MAIN_DECK]];
      // Fisher-Yates shuffle
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return { ...state, [ZoneId.MAIN_DECK]: shuffled };
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.MAIN_DECK]: this.previousOrder,
    }));
  }
}
