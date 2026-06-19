import { CommandStackService } from './command-stack.service';
import { BoardStateService } from './board-state.service';
import { CardInstance, ZoneId } from './simulator.models';

// =============================================================================
// CommandStackService — swapCards native command (free-mode §5.5)
//
// Pins: swap exchanges two cards in OCCUPIED zones with no collision; undo is
// atomic (a single undo() restores the exact pre-swap state); the 7 existing
// commands still operate through the stack (non-regression — swapCards is
// purely additive).
// =============================================================================

let idSeq = 0;
function makeCard(opts: { faceDown?: boolean; position?: 'ATK' | 'DEF'; name?: string } = {}): CardInstance {
  return {
    instanceId: `ci-${idSeq++}`,
    card: { card: { name: opts.name ?? 'C', passcode: idSeq } } as never,
    image: {} as never,
    faceDown: opts.faceDown ?? false,
    position: opts.position ?? 'ATK',
  };
}

function zone(board: BoardStateService, z: ZoneId): CardInstance[] {
  return board.boardState()[z];
}

describe('CommandStackService — swapCards (§5.5)', () => {
  let board: BoardStateService;
  let stack: CommandStackService;

  beforeEach(() => {
    board = new BoardStateService();
    stack = new CommandStackService(board);
  });

  function place(z: ZoneId, ...cards: CardInstance[]): void {
    board.boardState.update(prev => ({ ...prev, [z]: cards }));
  }

  it('exchanges two cards across occupied field zones without collision', () => {
    const a = makeCard({ name: 'A' });
    const b = makeCard({ name: 'B' });
    place(ZoneId.MONSTER_1, a);
    place(ZoneId.MONSTER_3, b);

    stack.swapCards(a.instanceId, b.instanceId);

    expect(zone(board, ZoneId.MONSTER_1).map(c => c.instanceId)).toEqual([b.instanceId]);
    expect(zone(board, ZoneId.MONSTER_3).map(c => c.instanceId)).toEqual([a.instanceId]);
    // No card lost or duplicated.
    expect(zone(board, ZoneId.MONSTER_1).length).toBe(1);
    expect(zone(board, ZoneId.MONSTER_3).length).toBe(1);
  });

  it('preserves each card faceDown/position state through the swap (sandbox: no legality)', () => {
    const a = makeCard({ faceDown: true, position: 'DEF' });
    const b = makeCard({ faceDown: false, position: 'ATK' });
    place(ZoneId.MONSTER_2, a);
    place(ZoneId.SPELL_TRAP_4, b); // monster swapping into an S-zone — allowed

    stack.swapCards(a.instanceId, b.instanceId);

    const inM2 = zone(board, ZoneId.MONSTER_2)[0];
    const inS4 = zone(board, ZoneId.SPELL_TRAP_4)[0];
    expect(inM2.instanceId).toBe(b.instanceId);
    expect(inM2.faceDown).toBe(false);
    expect(inS4.instanceId).toBe(a.instanceId);
    expect(inS4.faceDown).toBe(true);
    expect(inS4.position).toBe('DEF');
  });

  it('undo restores the exact pre-swap state (atomic, single undo)', () => {
    const a = makeCard({ name: 'A' });
    const b = makeCard({ name: 'B' });
    place(ZoneId.MONSTER_1, a);
    place(ZoneId.SPELL_TRAP_1, b);

    stack.swapCards(a.instanceId, b.instanceId);
    expect(stack.canUndo()).toBe(true);

    stack.undo();

    expect(zone(board, ZoneId.MONSTER_1).map(c => c.instanceId)).toEqual([a.instanceId]);
    expect(zone(board, ZoneId.SPELL_TRAP_1).map(c => c.instanceId)).toEqual([b.instanceId]);
  });

  it('redo re-applies the swap after an undo', () => {
    const a = makeCard();
    const b = makeCard();
    place(ZoneId.MONSTER_1, a);
    place(ZoneId.MONSTER_2, b);

    stack.swapCards(a.instanceId, b.instanceId);
    stack.undo();
    stack.redo();

    expect(zone(board, ZoneId.MONSTER_1)[0].instanceId).toBe(b.instanceId);
    expect(zone(board, ZoneId.MONSTER_2)[0].instanceId).toBe(a.instanceId);
  });

  it('is a no-op when both ids are the same card', () => {
    const a = makeCard();
    place(ZoneId.MONSTER_1, a);

    stack.swapCards(a.instanceId, a.instanceId);

    expect(stack.canUndo()).toBe(false);
    expect(zone(board, ZoneId.MONSTER_1)[0].instanceId).toBe(a.instanceId);
  });

  it('throws when a card id is not on the board', () => {
    const a = makeCard();
    place(ZoneId.MONSTER_1, a);

    expect(() => stack.swapCards(a.instanceId, 'ghost')).toThrow();
  });

  it('re-locates positions at apply time — robust to an index shift between commands', () => {
    // Pile with [bottom, a]; swap a (top of GY) with b (in M1). Then a prior
    // pile insert would shift indices — exchange re-locates by instanceId, so
    // undo/redo stay correct rather than corrupting a bystander.
    const bottom = makeCard({ name: 'bottom' });
    const a = makeCard({ name: 'A' });
    const b = makeCard({ name: 'B' });
    place(ZoneId.GRAVEYARD, bottom, a);
    place(ZoneId.MONSTER_1, b);

    stack.swapCards(a.instanceId, b.instanceId);

    expect(zone(board, ZoneId.MONSTER_1)[0].instanceId).toBe(a.instanceId);
    expect(zone(board, ZoneId.GRAVEYARD).map(c => c.instanceId)).toEqual([bottom.instanceId, b.instanceId]);

    stack.undo();
    expect(zone(board, ZoneId.GRAVEYARD).map(c => c.instanceId)).toEqual([bottom.instanceId, a.instanceId]);
    expect(zone(board, ZoneId.MONSTER_1)[0].instanceId).toBe(b.instanceId);
  });
});

// =============================================================================
// Non-regression — the existing commands still operate through the stack.
// =============================================================================

describe('CommandStackService — existing commands non-regression', () => {
  let board: BoardStateService;
  let stack: CommandStackService;

  beforeEach(() => {
    board = new BoardStateService();
    stack = new CommandStackService(board);
  });

  function place(z: ZoneId, ...cards: CardInstance[]): void {
    board.boardState.update(prev => ({ ...prev, [z]: cards }));
  }

  it('moveCard moves a card between zones and undoes', () => {
    const a = makeCard();
    place(ZoneId.HAND, a);

    stack.moveCard(a.instanceId, ZoneId.HAND, ZoneId.MONSTER_1);
    expect(zone(board, ZoneId.MONSTER_1)[0].instanceId).toBe(a.instanceId);
    expect(zone(board, ZoneId.HAND).length).toBe(0);

    stack.undo();
    expect(zone(board, ZoneId.HAND)[0].instanceId).toBe(a.instanceId);
    expect(zone(board, ZoneId.MONSTER_1).length).toBe(0);
  });

  it('flipCard toggles faceDown', () => {
    const a = makeCard({ faceDown: false });
    place(ZoneId.MONSTER_1, a);

    stack.flipCard(a.instanceId, ZoneId.MONSTER_1, true);
    expect(zone(board, ZoneId.MONSTER_1)[0].faceDown).toBe(true);
  });

  it('togglePosition switches ATK/DEF', () => {
    const a = makeCard({ position: 'ATK' });
    place(ZoneId.MONSTER_1, a);

    stack.togglePosition(a.instanceId, ZoneId.MONSTER_1, 'DEF');
    expect(zone(board, ZoneId.MONSTER_1)[0].position).toBe('DEF');
  });

  it('attachMaterial + detachMaterial round-trip', () => {
    const host = makeCard({ name: 'XYZ' });
    const mat = makeCard({ name: 'Mat' });
    place(ZoneId.MONSTER_1, host);
    place(ZoneId.MONSTER_2, mat);

    stack.attachMaterial(mat.instanceId, ZoneId.MONSTER_2, host.instanceId, ZoneId.MONSTER_1);
    expect(zone(board, ZoneId.MONSTER_1)[0].overlayMaterials?.map(m => m.instanceId)).toEqual([mat.instanceId]);
    expect(zone(board, ZoneId.MONSTER_2).length).toBe(0);

    stack.detachMaterial(mat.instanceId, host.instanceId, ZoneId.MONSTER_1, ZoneId.GRAVEYARD);
    expect(zone(board, ZoneId.MONSTER_1)[0].overlayMaterials?.length ?? 0).toBe(0);
    expect(zone(board, ZoneId.GRAVEYARD)[0].instanceId).toBe(mat.instanceId);
  });
});
