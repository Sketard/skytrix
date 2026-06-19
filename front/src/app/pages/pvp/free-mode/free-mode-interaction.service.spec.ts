import { TestBed } from '@angular/core/testing';
import { FreeModeInteractionService } from './free-mode-interaction.service';
import { BoardStateService } from '../../simulator/board-state.service';
import { CommandStackService } from '../../simulator/command-stack.service';
import { DuelContext } from '../duel-page/duel-context';
import { CardInstance, ZoneId as SimZoneId } from '../../simulator/simulator.models';

// =============================================================================
// FreeModeInteractionService — the interaction state machine (§4 / §5.2).
//
// Covers: arm / re-arm / pose / swap / deposit-pile / attach (normal→attach,
// material→transfer) / disarm / double-tap (250ms window cancels arm) /
// long-press never leaves a phantom arm (§5.3). Card identity is resolved from
// (PvP zoneId + cardCode) via the adapter's reverse map.
// =============================================================================

let idSeq = 0;
function makeCard(passcode = ++idSeq, name = 'C'): CardInstance {
  return {
    instanceId: `ci-${idSeq++}`,
    card: { card: { name, passcode } } as never,
    image: {} as never,
    faceDown: false,
    position: 'ATK',
  };
}

/** The card's passcode, asserted defined (makeCard always sets one). */
function pc(card: CardInstance): number {
  return card.card.card.passcode as number;
}

describe('FreeModeInteractionService', () => {
  let service: FreeModeInteractionService;
  let board: BoardStateService;
  let stack: jasmine.SpyObj<CommandStackService>;

  function place(z: SimZoneId, ...cards: CardInstance[]): void {
    board.boardState.update(prev => ({ ...prev, [z]: cards }));
  }

  beforeEach(() => {
    board = new BoardStateService();
    stack = jasmine.createSpyObj<CommandStackService>('CommandStackService', [
      'moveCard', 'swapCards', 'attachMaterial', 'transferMaterial',
    ]);
    const ctx = jasmine.createSpyObj<DuelContext>('DuelContext', ['announceEvent']);

    TestBed.configureTestingModule({
      providers: [
        FreeModeInteractionService,
        { provide: BoardStateService, useValue: board },
        { provide: CommandStackService, useValue: stack },
        { provide: DuelContext, useValue: ctx },
      ],
    });
    service = TestBed.inject(FreeModeInteractionService);
  });

  describe('arm / re-arm / disarm', () => {
    it('arms a card on first tap', () => {
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);

      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });

      expect(service.armedInstanceId()).toBe(a.instanceId);
    });

    it('re-arms when ANOTHER HAND card is tapped (#1 — pick a new card)', () => {
      const a = makeCard();
      const b = makeCard();
      place(SimZoneId.HAND, a, b);

      service.onCardTap({ cardCode: pc(a), zoneId: 'HAND' });
      service.onCardTap({ cardCode: pc(b), zoneId: 'HAND' });

      expect(service.armedInstanceId()).toBe(b.instanceId);
      expect(stack.swapCards).not.toHaveBeenCalled(); // re-arm, not swap
    });

    it('disarms when the armed card is re-tapped', () => {
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);

      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });
      // Wait out the double-tap window so the 2nd tap is a re-tap, not a dbl-tap.
      service['lastTapAt'] = performance.now() - 1000;
      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });

      expect(service.armedInstanceId()).toBeNull();
    });

    it('disarm() clears the armed card', () => {
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);
      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });

      service.disarm();

      expect(service.armedInstanceId()).toBeNull();
    });
  });

  describe('pose (empty zone)', () => {
    it('poses the armed card into an empty slot via moveCard', () => {
      const a = makeCard();
      place(SimZoneId.HAND, a);

      service.onCardTap({ cardCode: pc(a), zoneId: 'HAND' });
      service.onEmptyZoneTap('M3');

      expect(stack.moveCard).toHaveBeenCalledWith(a.instanceId, SimZoneId.HAND, SimZoneId.MONSTER_3);
    });

    it('onEmptyZoneTap is a no-op when nothing is armed', () => {
      service.onEmptyZoneTap('M3');
      expect(stack.moveCard).not.toHaveBeenCalled();
    });

    it('keeps arming sticky after a pose (re-anchored to the new zone)', () => {
      const a = makeCard();
      place(SimZoneId.HAND, a);
      service.onCardTap({ cardCode: pc(a), zoneId: 'HAND' });

      service.onEmptyZoneTap('S2');

      // Still armed (sticky), now anchored to S2 for a follow-up move.
      expect(service.armedInstanceId()).toBe(a.instanceId);
    });
  });

  describe('swap (occupied field slot)', () => {
    it('swaps armed card with another POSED card (field/EMZ/pile)', () => {
      const a = makeCard();
      const b = makeCard();
      place(SimZoneId.MONSTER_1, a);
      place(SimZoneId.MONSTER_3, b);

      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' }); // arm A
      service.onCardTap({ cardCode: pc(b), zoneId: 'M3' }); // tap posed B → swap

      expect(stack.swapCards).toHaveBeenCalledWith(a.instanceId, b.instanceId);
      expect(service.armedInstanceId()).toBeNull(); // disarmed after swap
    });
  });

  describe('deposit into pile', () => {
    it('deposits the armed card into a pile and returns true', () => {
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);
      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });

      const deposited = service.onPileTap('GY');

      expect(deposited).toBe(true);
      expect(stack.moveCard).toHaveBeenCalledWith(a.instanceId, SimZoneId.MONSTER_1, SimZoneId.GRAVEYARD);
      expect(service.armedInstanceId()).toBeNull(); // disarmed after deposit
    });

    it('returns false (no deposit) when nothing is armed — page opens the pile', () => {
      expect(service.onPileTap('GY')).toBe(false);
      expect(stack.moveCard).not.toHaveBeenCalled();
    });
  });

  describe('double-tap arbiter (250ms — §5.3)', () => {
    it('a 2nd tap within the window cancels the arm (inspect, no command)', () => {
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);

      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' }); // arm
      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' }); // dbl-tap < 250ms

      expect(service.armedInstanceId()).toBeNull(); // arm cancelled
      expect(stack.swapCards).not.toHaveBeenCalled();
      expect(stack.moveCard).not.toHaveBeenCalled();
    });
  });

  describe('long-press never leaves a phantom arm (§5.3)', () => {
    it('disarms before inspecting, even if a tap had just armed', () => {
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);

      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' }); // arm
      service.onCardLongPress({ cardCode: pc(a), zoneId: 'M1' });

      expect(service.armedInstanceId()).toBeNull(); // no phantom arm
    });

    it('a forceExpanded tap (the board long-press/right-click) INSPECTS, never arms', () => {
      // The page routes ALL gestures through onCardTap; the board long-press
      // arrives as cardInspectRequest with forceExpanded:true. onCardTap must
      // treat it as inspect (disarm), NOT arm — the real-wiring §5.3 guard.
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);

      service.onCardTap({ cardCode: pc(a), zoneId: 'M1', forceExpanded: true });

      expect(service.armedInstanceId()).toBeNull();
      expect(stack.swapCards).not.toHaveBeenCalled();
    });

    it('a forceExpanded tap on an already-armed card cancels the arm (no phantom)', () => {
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);

      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' }); // arm
      service.onCardTap({ cardCode: pc(a), zoneId: 'M1', forceExpanded: true }); // long-press

      expect(service.armedInstanceId()).toBeNull();
    });
  });

  describe('double-tap window reset after pose (regression)', () => {
    it('clears the double-tap window so a tap on the posed card is not misread', () => {
      const a = makeCard();
      place(SimZoneId.HAND, a);

      service.onCardTap({ cardCode: pc(a), zoneId: 'HAND' }); // arm (lastTap set)
      service.onEmptyZoneTap('M1'); // pose — must reset lastTapInstanceId/At

      // The arming-tap's double-tap window must no longer be open: the internal
      // tracker is reset (commandStack is a spy so the board isn't really
      // mutated — we assert the window state directly).
      expect(service['lastTapInstanceId']).toBeNull();
      expect(service['lastTapAt']).toBe(0);
      // Card stays armed (sticky), re-anchored to M1.
      expect(service.armedInstanceId()).toBe(a.instanceId);
    });
  });

  describe('attach-XYZ (§5.2 / T2)', () => {
    it('attaches a NORMAL armed card onto a tapped XYZ host (attachMaterial)', () => {
      const normal = makeCard();
      const host = makeCard();
      place(SimZoneId.MONSTER_2, normal);
      place(SimZoneId.MONSTER_1, host);

      service.onCardTap({ cardCode: pc(normal), zoneId: 'M2' }); // arm normal
      service.beginAttachPending();
      service.onCardTap({ cardCode: pc(host), zoneId: 'M1' }); // tap host

      expect(stack.attachMaterial).toHaveBeenCalledWith(
        normal.instanceId, SimZoneId.MONSTER_2, host.instanceId, SimZoneId.MONSTER_1);
      expect(stack.transferMaterial).not.toHaveBeenCalled();
      expect(service.armedInstanceId()).toBeNull();
    });

    it('transfers a MATERIAL armed card onto another XYZ host (transferMaterial)', () => {
      const mat = makeCard();
      const sourceHost = makeCard();
      sourceHost.overlayMaterials = [mat];
      const targetHost = makeCard();
      place(SimZoneId.MONSTER_1, sourceHost);
      place(SimZoneId.MONSTER_3, targetHost);

      // Arm the material directly (the peek would surface it; we inject the armed
      // state by tapping its host zone then forcing the armed instance).
      service['_armed'].set({ instanceId: mat.instanceId, zone: SimZoneId.MONSTER_1, card: mat });
      service.beginAttachPending();
      service.onCardTap({ cardCode: pc(targetHost), zoneId: 'M3' });

      expect(stack.transferMaterial).toHaveBeenCalledWith(
        mat.instanceId, SimZoneId.MONSTER_1, targetHost.instanceId, SimZoneId.MONSTER_3);
      expect(stack.attachMaterial).not.toHaveBeenCalled();
    });
  });

  describe('identity resolution', () => {
    it('ignores a tap with no zoneId (cannot resolve identity)', () => {
      service.onCardTap({ cardCode: 123 });
      expect(service.armedInstanceId()).toBeNull();
    });

    it('resolves a pile tap to the TOP card (what the board renders)', () => {
      const bottom = makeCard(10);
      const top = makeCard(20);
      place(SimZoneId.GRAVEYARD, bottom, top);

      service.onCardTap({ cardCode: pc(top), zoneId: 'GY' });

      expect(service.armedInstanceId()).toBe(top.instanceId);
    });

    it('ignores a HAND tap whose cardCode matches nothing (no silent wrong-card arm)', () => {
      const a = makeCard(10);
      place(SimZoneId.HAND, a);

      service.onCardTap({ cardCode: 99999, zoneId: 'HAND' }); // no match

      expect(service.armedInstanceId()).toBeNull();
    });
  });
});
