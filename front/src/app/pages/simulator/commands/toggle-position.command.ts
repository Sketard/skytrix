import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId } from '../simulator.models';

export class TogglePositionCommand implements SimCommand {
  private readonly previousPosition: 'ATK' | 'DEF';

  constructor(
    private readonly boardState: BoardStateService,
    private readonly cardInstanceId: string,
    private readonly zoneId: ZoneId,
    private readonly targetPosition: 'ATK' | 'DEF',
  ) {
    const cards = this.boardState.boardState()[this.zoneId];
    const card = cards.find(c => c.instanceId === this.cardInstanceId);
    if (!card) {
      throw new Error(`TogglePositionCommand: card ${this.cardInstanceId} not found in ${this.zoneId}`);
    }
    this.previousPosition = card.position;
  }

  execute(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? { ...c, position: this.targetPosition }
          : c
      );
      return newState;
    });
  }

  undo(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? { ...c, position: this.previousPosition }
          : c
      );
      return newState;
    });
  }
}
