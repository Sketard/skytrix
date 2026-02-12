import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export class ReorderHandCommand implements SimCommand {
  private previousOrder: CardInstance[] = [];

  constructor(
    private readonly boardState: BoardStateService,
    private readonly fromIndex: number,
    private readonly toIndex: number,
  ) {}

  execute(): void {
    this.previousOrder = [...this.boardState.boardState()[ZoneId.HAND]];

    this.boardState.boardState.update(state => {
      const hand = [...state[ZoneId.HAND]];
      const [moved] = hand.splice(this.fromIndex, 1);
      hand.splice(this.toIndex, 0, moved);
      return { ...state, [ZoneId.HAND]: hand };
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => ({
      ...state,
      [ZoneId.HAND]: this.previousOrder,
    }));
  }
}
