import { Injectable, computed, signal } from '@angular/core';
import { SimCommand, ZoneId } from './simulator.models';
import { BoardStateService } from './board-state.service';
import {
  MoveCardCommand,
  DrawCardCommand,
  ShuffleCommand,
  ReorderHandCommand,
  CompositeCommand,
  FlipCardCommand,
  TogglePositionCommand,
} from './commands';

@Injectable()
export class CommandStackService {
  private readonly _undoStack = signal<SimCommand[]>([]);
  private readonly _redoStack = signal<SimCommand[]>([]);

  readonly undoStack = this._undoStack.asReadonly();
  readonly redoStack = this._redoStack.asReadonly();

  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

  constructor(private readonly boardStateService: BoardStateService) {}

  clearHistory(): void {
    this._undoStack.set([]);
    this._redoStack.set([]);
  }

  reset(): void {
    this.boardStateService.resetBoard();
    this.clearHistory();
  }

  undo(): void {
    const stack = this._undoStack();
    if (stack.length === 0) return;
    const command = stack[stack.length - 1];
    command.undo();
    this._undoStack.update(s => s.slice(0, -1));
    this._redoStack.update(s => [...s, command]);
  }

  redo(): void {
    const stack = this._redoStack();
    if (stack.length === 0) return;
    const command = stack[stack.length - 1];
    command.execute();
    this._redoStack.update(s => s.slice(0, -1));
    this._undoStack.update(s => [...s, command]);
  }

  private execute(command: SimCommand): void {
    command.execute();
    this._undoStack.update(stack => [...stack, command]);
    this._redoStack.set([]);
  }

  private executeBatch(commands: SimCommand[]): void {
    if (commands.length === 0) return;
    if (commands.length === 1) {
      this.execute(commands[0]);
      return;
    }
    const composite = new CompositeCommand(commands);
    this.execute(composite);
  }

  moveCard(cardInstanceId: string, fromZone: ZoneId, toZone: ZoneId, toIndex?: number): void {
    const fromCards = this.boardStateService.boardState()[fromZone];
    const isInMainArray = fromCards.some(c => c.instanceId === cardInstanceId);

    if (isInMainArray) {
      const cmd = new MoveCardCommand(this.boardStateService, cardInstanceId, fromZone, toZone, toIndex);
      this.execute(cmd);
    } else {
      const xyzHost = fromCards.find(c =>
        c.overlayMaterials?.some(m => m.instanceId === cardInstanceId)
      );
      if (xyzHost) {
        const cmd = new MoveCardCommand(
          this.boardStateService, cardInstanceId, fromZone, toZone, toIndex,
          { type: 'detach', xyzHostId: xyzHost.instanceId }
        );
        this.execute(cmd);
      } else {
        throw new Error(`Card ${cardInstanceId} not found in zone ${fromZone} or its materials`);
      }
    }
  }

  attachMaterial(cardInstanceId: string, fromZone: ZoneId, xyzHostId: string, xyzZoneId: ZoneId): void {
    const cmd = new MoveCardCommand(
      this.boardStateService, cardInstanceId, fromZone, xyzZoneId, undefined,
      { type: 'attach', xyzHostId }
    );
    this.execute(cmd);
  }

  detachMaterial(materialInstanceId: string, xyzHostId: string, xyzZoneId: ZoneId, targetZone: ZoneId): void {
    const cmd = new MoveCardCommand(
      this.boardStateService, materialInstanceId, xyzZoneId, targetZone, undefined,
      { type: 'detach', xyzHostId }
    );
    this.execute(cmd);
  }

  transferMaterial(materialInstanceId: string, fromZone: ZoneId, targetXyzHostId: string, targetZone: ZoneId): void {
    const fromCards = this.boardStateService.boardState()[fromZone];
    const sourceHost = fromCards.find(c =>
      c.overlayMaterials?.some(m => m.instanceId === materialInstanceId)
    );
    if (!sourceHost) {
      throw new Error(`Source XYZ host not found for material ${materialInstanceId} in ${fromZone}`);
    }

    // Create detach command (material → targetZone main array)
    const detachCmd = new MoveCardCommand(
      this.boardStateService, materialInstanceId, fromZone, targetZone, undefined,
      { type: 'detach', xyzHostId: sourceHost.instanceId }
    );

    // Execute detach so attach command can find card in targetZone
    detachCmd.execute();

    // Create attach command (card now in targetZone → target XYZ's overlayMaterials)
    const attachCmd = new MoveCardCommand(
      this.boardStateService, materialInstanceId, targetZone, targetZone, undefined,
      { type: 'attach', xyzHostId: targetXyzHostId }
    );

    // Undo detach to restore original state before composite executes both
    detachCmd.undo();

    // Atomic composite: single undo reverses both
    const composite = new CompositeCommand([detachCmd, attachCmd]);
    this.execute(composite);
  }

  drawCard(): void {
    if (this.boardStateService.isDeckEmpty()) return;
    const cmd = new DrawCardCommand(this.boardStateService);
    this.execute(cmd);
  }

  shuffleDeck(): void {
    const cmd = new ShuffleCommand(this.boardStateService);
    this.execute(cmd);
  }

  reorderHand(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const cmd = new ReorderHandCommand(this.boardStateService, fromIndex, toIndex);
    this.execute(cmd);
  }

  flipCard(cardInstanceId: string, zoneId: ZoneId, targetFaceDown: boolean, targetPosition?: 'ATK' | 'DEF'): void {
    const cmd = new FlipCardCommand(this.boardStateService, cardInstanceId, zoneId, targetFaceDown, targetPosition);
    this.execute(cmd);
  }

  togglePosition(cardInstanceId: string, zoneId: ZoneId, targetPosition: 'ATK' | 'DEF'): void {
    const cmd = new TogglePositionCommand(this.boardStateService, cardInstanceId, zoneId, targetPosition);
    this.execute(cmd);
  }

  mill(count: number): void {
    const deckCards = this.boardStateService.boardState()[ZoneId.MAIN_DECK];
    const n = Math.min(count, deckCards.length);
    if (n === 0) return;
    const commands = deckCards.slice(-n).reverse().map(card =>
      new MoveCardCommand(this.boardStateService, card.instanceId, ZoneId.MAIN_DECK, ZoneId.GRAVEYARD)
    );
    this.executeBatch(commands);
  }
}
