import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

export interface MaterialContext {
  type: 'attach' | 'detach';
  xyzHostId: string;
}

export class MoveCardCommand implements SimCommand {
  private readonly cardInstance: CardInstance;
  private readonly movedCard: CardInstance;
  private readonly fromIndex: number;
  private readonly originalMaterials?: CardInstance[];

  private static isFaceDownZone(zone: ZoneId): boolean {
    return zone === ZoneId.MAIN_DECK || zone === ZoneId.EXTRA_DECK;
  }

  constructor(
    private readonly boardState: BoardStateService,
    private readonly cardInstanceId: string,
    private readonly fromZone: ZoneId,
    private readonly toZone: ZoneId,
    private readonly toIndex?: number,
    private readonly materialContext?: MaterialContext,
  ) {
    if (materialContext?.type === 'detach') {
      const hostCard = boardState.boardState()[fromZone]
        .find(c => c.instanceId === materialContext.xyzHostId);
      if (!hostCard) throw new Error(`MoveCardCommand: XYZ host ${materialContext.xyzHostId} not found in ${fromZone}`);
      const matIdx = hostCard.overlayMaterials?.findIndex(m => m.instanceId === cardInstanceId) ?? -1;
      if (matIdx === -1) throw new Error(`MoveCardCommand: material ${cardInstanceId} not found on XYZ host`);
      this.fromIndex = matIdx;
      this.cardInstance = hostCard.overlayMaterials![matIdx];
      this.originalMaterials = [...(hostCard.overlayMaterials ?? [])];
    } else {
      const fromCards = boardState.boardState()[fromZone];
      this.fromIndex = fromCards.findIndex(c => c.instanceId === cardInstanceId);
      if (this.fromIndex === -1) {
        throw new Error(`MoveCardCommand: card ${cardInstanceId} not found in ${fromZone}`);
      }
      this.cardInstance = fromCards[this.fromIndex];
      if (materialContext?.type === 'attach') {
        const hostCard = boardState.boardState()[toZone]
          .find(c => c.instanceId === materialContext.xyzHostId);
        this.originalMaterials = [...(hostCard?.overlayMaterials ?? [])];
      }
    }

    // Adjust faceDown based on target zone (except attach — materials have no face state)
    const targetFaceDown = MoveCardCommand.isFaceDownZone(toZone);
    this.movedCard = materialContext?.type === 'attach' || targetFaceDown === this.cardInstance.faceDown
      ? this.cardInstance
      : { ...this.cardInstance, faceDown: targetFaceDown };
  }

  execute(): void {
    if (this.materialContext?.type === 'attach') {
      this.boardState.boardState.update(state => {
        const newState = { ...state };
        newState[this.fromZone] = state[this.fromZone].filter(c => c.instanceId !== this.cardInstanceId);
        newState[this.toZone] = state[this.toZone].map(c =>
          c.instanceId === this.materialContext!.xyzHostId
            ? { ...c, overlayMaterials: [...(c.overlayMaterials ?? []), this.cardInstance] }
            : c
        );
        return newState;
      });
      return;
    }

    if (this.materialContext?.type === 'detach') {
      this.boardState.boardState.update(state => {
        const newState = { ...state };
        newState[this.fromZone] = state[this.fromZone].map(c =>
          c.instanceId === this.materialContext!.xyzHostId
            ? { ...c, overlayMaterials: (c.overlayMaterials ?? []).filter(m => m.instanceId !== this.cardInstanceId) }
            : c
        );
        const toCards = [...state[this.toZone]];
        if (this.toIndex !== undefined && this.toIndex >= 0) {
          toCards.splice(this.toIndex, 0, this.movedCard);
        } else {
          toCards.push(this.movedCard);
        }
        newState[this.toZone] = toCards;
        return newState;
      });
      return;
    }

    // Normal move
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.fromZone] = state[this.fromZone].filter(c => c.instanceId !== this.cardInstanceId);
      if (this.toIndex !== undefined && this.toIndex >= 0) {
        const target = [...newState[this.toZone]];
        target.splice(this.toIndex, 0, this.movedCard);
        newState[this.toZone] = target;
      } else {
        newState[this.toZone] = [...newState[this.toZone], this.movedCard];
      }
      return newState;
    });
  }

  undo(): void {
    if (this.materialContext?.type === 'attach') {
      this.boardState.boardState.update(state => {
        const newState = { ...state };
        newState[this.toZone] = state[this.toZone].map(c =>
          c.instanceId === this.materialContext!.xyzHostId
            ? { ...c, overlayMaterials: this.originalMaterials ?? [] }
            : c
        );
        const fromCards = [...state[this.fromZone]];
        fromCards.splice(this.fromIndex, 0, this.cardInstance);
        newState[this.fromZone] = fromCards;
        return newState;
      });
      return;
    }

    if (this.materialContext?.type === 'detach') {
      this.boardState.boardState.update(state => {
        const newState = { ...state };
        newState[this.toZone] = state[this.toZone].filter(c => c.instanceId !== this.cardInstanceId);
        newState[this.fromZone] = state[this.fromZone].map(c =>
          c.instanceId === this.materialContext!.xyzHostId
            ? { ...c, overlayMaterials: this.originalMaterials ?? [] }
            : c
        );
        return newState;
      });
      return;
    }

    // Normal undo (existing behavior)
    this.boardState.boardState.update(state => {
      const newState = { ...state };
      newState[this.toZone] = state[this.toZone].filter(c => c.instanceId !== this.cardInstanceId);
      const source = [...newState[this.fromZone]];
      source.splice(this.fromIndex, 0, this.cardInstance);
      newState[this.fromZone] = source;
      return newState;
    });
  }
}
