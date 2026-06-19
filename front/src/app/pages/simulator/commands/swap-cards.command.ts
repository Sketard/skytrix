import { BoardStateService } from '../board-state.service';
import { SimCommand, ZoneId, CardInstance } from '../simulator.models';

/**
 * Swaps two cards between their zones. Native command (free-mode §5.5) —
 * the naïve "2× moveCard" is wrong: moving A→B's zone collides with B before
 * B has left. `exchange` re-locates both cards by instanceId at apply time and
 * writes each into the other's slot in a single board update, so an intervening
 * edit that shifted a pile/ordered index can't corrupt a bystander. Undo is the
 * same exchange (symmetric).
 *
 * Sandbox semantics (free-mode #2): no zone-type legality check — a monster
 * may swap into an S-zone. Each card keeps its own faceDown/position state;
 * only its zone changes.
 */
export class SwapCardsCommand implements SimCommand {
  private readonly aId: string;
  private readonly bId: string;

  constructor(
    private readonly boardState: BoardStateService,
    aInstanceId: string,
    bInstanceId: string,
  ) {
    if (aInstanceId === bInstanceId) {
      throw new Error(`SwapCardsCommand: cannot swap a card with itself (${aInstanceId})`);
    }
    const board = boardState.boardState();
    // Validate both exist at construction (fail fast) — positions are re-located
    // at apply time, so we don't store the captured indices.
    if (!SwapCardsCommand.locate(board, aInstanceId)) {
      throw new Error(`SwapCardsCommand: card ${aInstanceId} not found`);
    }
    if (!SwapCardsCommand.locate(board, bInstanceId)) {
      throw new Error(`SwapCardsCommand: card ${bInstanceId} not found`);
    }
    this.aId = aInstanceId;
    this.bId = bInstanceId;
  }

  private static locate(
    board: Record<ZoneId, CardInstance[]>,
    instanceId: string,
  ): { zone: ZoneId; index: number; card: CardInstance } | null {
    for (const zone of Object.keys(board) as ZoneId[]) {
      const index = board[zone].findIndex(c => c.instanceId === instanceId);
      if (index !== -1) return { zone, index, card: board[zone][index] };
    }
    return null;
  }

  execute(): void {
    // execute(): card currently at A's id → B's slot, card at B's id → A's slot.
    this.exchange(this.aId, this.bId);
  }

  undo(): void {
    // Symmetric: after execute the ids sit in swapped slots; exchanging them
    // again restores the original layout.
    this.exchange(this.aId, this.bId);
  }

  /**
   * Exchange the live positions of the two cards, re-locating them by
   * instanceId at apply time (NOT trusting the indices captured at
   * construction — an intervening edit may have shifted them). Throws if either
   * card has vanished from the board.
   */
  private exchange(firstId: string, secondId: string): void {
    this.boardState.boardState.update(state => {
      const locFirst = SwapCardsCommand.locate(state, firstId);
      const locSecond = SwapCardsCommand.locate(state, secondId);
      if (!locFirst || !locSecond) {
        throw new Error('SwapCardsCommand: a card to swap is no longer on the board');
      }
      const newState = { ...state };
      if (locFirst.zone === locSecond.zone) {
        const arr = [...state[locFirst.zone]];
        arr[locFirst.index] = locSecond.card;
        arr[locSecond.index] = locFirst.card;
        newState[locFirst.zone] = arr;
      } else {
        const a = [...state[locFirst.zone]];
        a[locFirst.index] = locSecond.card;
        newState[locFirst.zone] = a;
        const b = [...state[locSecond.zone]];
        b[locSecond.index] = locFirst.card;
        newState[locSecond.zone] = b;
      }
      return newState;
    });
  }
}
