import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId } from '../simulator.models';

export class FlipCardCommand implements SimCommand {
  private readonly previousFaceDown: boolean;
  private readonly previousPosition: 'ATK' | 'DEF';

  constructor(
    private readonly boardState: BoardStateService,
    private readonly cardInstanceId: string,
    private readonly zoneId: ZoneId,
    private readonly targetFaceDown: boolean,
    private readonly targetPosition?: 'ATK' | 'DEF',
  ) {
    const cards = this.boardState.boardState()[this.zoneId];
    const card = cards.find(c => c.instanceId === this.cardInstanceId);
    if (!card) {
      throw new Error(`FlipCardCommand: card ${this.cardInstanceId} not found in ${this.zoneId}`);
    }
    this.previousFaceDown = card.faceDown;
    this.previousPosition = card.position;
  }

  execute(): void {
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.zoneId] = state[this.zoneId].map(c =>
        c.instanceId === this.cardInstanceId
          ? {
              ...c,
              faceDown: this.targetFaceDown,
              ...(this.targetPosition !== undefined ? { position: this.targetPosition } : {}),
            }
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
          ? { ...c, faceDown: this.previousFaceDown, position: this.previousPosition }
          : c
      );
      return newState;
    });
  }
}
