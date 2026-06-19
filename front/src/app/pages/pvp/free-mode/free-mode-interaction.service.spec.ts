import { TestBed } from '@angular/core/testing';
import { FreeModeInteractionService } from './free-mode-interaction.service';
import { BoardStateService } from './engine/board-state.service';
import { CommandStackService } from './engine/command-stack.service';
import { DuelContext } from '../duel-page/duel-context';
import { CardInstance, ZoneId as SimZoneId } from './engine/board-models';

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
      'flipCard', 'togglePosition', 'detachMaterial',
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

  describe('onHandCardTap — index-based hand arming (resolves duplicate cardCode)', () => {
    it('arms the EXACT hand card at the given index even with duplicate cardCodes', () => {
      // Two copies of the same passcode — index disambiguates (cardCode cannot).
      const copy1 = makeCard(777);
      const copy2 = makeCard(777);
      place(SimZoneId.HAND, copy1, copy2);

      service.onHandCardTap(1); // the SECOND copy

      expect(service.armedInstanceId()).toBe(copy2.instanceId);
    });

    it('re-arms a different hand card on tap', () => {
      const a = makeCard();
      const b = makeCard();
      place(SimZoneId.HAND, a, b);

      service.onHandCardTap(0);
      service.onHandCardTap(1);

      expect(service.armedInstanceId()).toBe(b.instanceId);
    });

    it('disarms when the armed hand card is re-tapped (outside the dbl-tap window)', () => {
      const a = makeCard();
      place(SimZoneId.HAND, a);

      service.onHandCardTap(0);
      service['lastTapAt'] = performance.now() - 1000;
      service.onHandCardTap(0);

      expect(service.armedInstanceId()).toBeNull();
    });

    it('ignores an out-of-range index', () => {
      place(SimZoneId.HAND, makeCard());
      service.onHandCardTap(5);
      expect(service.armedInstanceId()).toBeNull();
    });
  });

  describe('armInstance — overlay → arm bridge (§15)', () => {
    it('arms a card by instanceId, re-locating its zone from live state', () => {
      const a = makeCard();
      place(SimZoneId.GRAVEYARD, makeCard(), a); // a is in GY (a pile)

      service.armInstance(a.instanceId);

      expect(service.armedInstanceId()).toBe(a.instanceId);
    });

    it('is a no-op for an unknown instanceId', () => {
      service.armInstance('ghost');
      expect(service.armedInstanceId()).toBeNull();
    });
  });

  describe('onInspect sink', () => {
    it('fires the registered inspect handler on double-tap', () => {
      const a = makeCard(123);
      place(SimZoneId.MONSTER_1, a);
      const inspected: number[] = [];
      service.onInspect(e => inspected.push(e.cardCode));

      service.onCardTap({ cardCode: 123, zoneId: 'M1' }); // arm
      service.onCardTap({ cardCode: 123, zoneId: 'M1' }); // dbl-tap → inspect

      expect(inspected).toEqual([123]);
    });

    it('fires the inspect handler on a forceExpanded (long-press) tap', () => {
      const a = makeCard(456);
      place(SimZoneId.MONSTER_1, a);
      const inspected: Array<{ code: number; expanded?: boolean }> = [];
      service.onInspect(e => inspected.push({ code: e.cardCode, expanded: e.forceExpanded }));

      service.onCardTap({ cardCode: 456, zoneId: 'M1', forceExpanded: true });

      expect(inspected).toEqual([{ code: 456, expanded: true }]);
    });
  });

  describe('mini-bar CARTE actions (§6.1)', () => {
    function armField(card: CardInstance, zone: SimZoneId, pvp: 'M1' | 'M2' | 'S1'): void {
      place(zone, card);
      service.onCardTap({ cardCode: pc(card), zoneId: pvp });
    }

    it('flipArmed flips the armed card faceDown', () => {
      const a = makeCard();
      a.faceDown = false;
      armField(a, SimZoneId.MONSTER_1, 'M1');

      service.flipArmed();

      expect(stack.flipCard).toHaveBeenCalledWith(a.instanceId, SimZoneId.MONSTER_1, true);
    });

    it('togglePositionArmed switches ATK → DEF', () => {
      const a = makeCard();
      a.position = 'ATK';
      armField(a, SimZoneId.MONSTER_1, 'M1');

      service.togglePositionArmed();

      expect(stack.togglePosition).toHaveBeenCalledWith(a.instanceId, SimZoneId.MONSTER_1, 'DEF');
    });

    it('destroyArmed moves the armed card to the Graveyard and disarms', () => {
      const a = makeCard();
      armField(a, SimZoneId.MONSTER_1, 'M1');

      service.destroyArmed();

      expect(stack.moveCard).toHaveBeenCalledWith(a.instanceId, SimZoneId.MONSTER_1, SimZoneId.GRAVEYARD);
      expect(service.armedInstanceId()).toBeNull();
    });

    it('detachArmed detaches an armed XYZ material to the Graveyard', () => {
      const mat = makeCard();
      const host = makeCard();
      host.overlayMaterials = [mat];
      place(SimZoneId.MONSTER_1, host);
      // Arm the material directly (it would be armed from the XYZ peek).
      service['_armed'].set({ instanceId: mat.instanceId, zone: SimZoneId.MONSTER_1, card: mat });

      service.detachArmed();

      expect(stack.detachMaterial).toHaveBeenCalledWith(
        mat.instanceId, host.instanceId, SimZoneId.MONSTER_1, SimZoneId.GRAVEYARD);
    });

    it('armedIsMaterial reflects whether the armed card is an XYZ material', () => {
      const mat = makeCard();
      const host = makeCard();
      host.overlayMaterials = [mat];
      place(SimZoneId.MONSTER_1, host);

      service['_armed'].set({ instanceId: mat.instanceId, zone: SimZoneId.MONSTER_1, card: mat });
      expect(service.armedIsMaterial()).toBe(true);

      service.disarm();
      const normal = makeCard();
      armField(normal, SimZoneId.MONSTER_2, 'M2');
      expect(service.armedIsMaterial()).toBe(false);
    });
  });

  describe('a11y announcements (§9 live-region)', () => {
    let ctxSpy: jasmine.SpyObj<DuelContext>;

    beforeEach(() => {
      ctxSpy = TestBed.inject(DuelContext) as jasmine.SpyObj<DuelContext>;
    });

    function announces(): string[] {
      return ctxSpy.announceEvent.calls.allArgs().map(a => a[0] as string);
    }

    it('announces flip face-down / face-up', () => {
      const a = makeCard();
      a.faceDown = false;
      place(SimZoneId.MONSTER_1, a);
      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });
      ctxSpy.announceEvent.calls.reset();

      service.flipArmed();

      expect(announces()).toContain('Face cachée');
    });

    it('announces position attack / defense', () => {
      const a = makeCard();
      a.position = 'ATK';
      place(SimZoneId.MONSTER_1, a);
      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });
      ctxSpy.announceEvent.calls.reset();

      service.togglePositionArmed();

      expect(announces()).toContain('Position défense');
    });

    it('announces the counter value on increment / decrement (incl. plural→singular)', () => {
      const a = makeCard();
      place(SimZoneId.MONSTER_1, a);
      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });
      ctxSpy.announceEvent.calls.reset();

      service.incrementCounterArmed();
      expect(announces()).toContain('1 compteur');
      service.incrementCounterArmed();
      expect(announces()).toContain('2 compteurs');
      ctxSpy.announceEvent.calls.reset();
      service.decrementCounterArmed(); // 2 → 1 (singular)
      expect(announces()).toContain('1 compteur');
      service.decrementCounterArmed(); // 1 → 0
      expect(announces()).toContain('Aucun compteur');
    });
  });

  describe('a11y announcements reflect LIVE state (not the stale arm snapshot)', () => {
    // Uses a REAL CommandStackService so flip/toggle mutate the board — pins
    // that a 2nd announcement reads the post-mutation state, mirroring the
    // command-side stale-snapshot regression.
    let realStack: CommandStackService;
    let liveService: FreeModeInteractionService;
    let ctxSpy: jasmine.SpyObj<DuelContext>;

    beforeEach(() => {
      ctxSpy = jasmine.createSpyObj<DuelContext>('DuelContext', ['announceEvent']);
      realStack = new CommandStackService(board);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          FreeModeInteractionService,
          { provide: BoardStateService, useValue: board },
          { provide: CommandStackService, useValue: realStack },
          { provide: DuelContext, useValue: ctxSpy },
        ],
      });
      liveService = TestBed.inject(FreeModeInteractionService);
    });

    function announces(): string[] {
      return ctxSpy.announceEvent.calls.allArgs().map(a => a[0] as string);
    }

    it('a 2nd flip announces "Face visible" (reads live face-down state)', () => {
      const a = makeCard();
      a.faceDown = false;
      place(SimZoneId.MONSTER_1, a);
      liveService.onCardTap({ cardCode: pc(a), zoneId: 'M1' });

      liveService.flipArmed(); // → face-down → "Face cachée"
      ctxSpy.announceEvent.calls.reset();
      liveService.flipArmed(); // → face-up → "Face visible"

      expect(announces()).toContain('Face visible');
    });

    it('a 2nd position toggle announces "Position attaque" (reads live position)', () => {
      const a = makeCard();
      a.position = 'ATK';
      place(SimZoneId.MONSTER_1, a);
      liveService.onCardTap({ cardCode: pc(a), zoneId: 'M1' });

      liveService.togglePositionArmed(); // → DEF
      ctxSpy.announceEvent.calls.reset();
      liveService.togglePositionArmed(); // → ATK

      expect(announces()).toContain('Position attaque');
    });
  });

  describe('mini-bar reads LIVE state (stale-snapshot regression)', () => {
    // Uses a REAL CommandStackService so flip/toggle actually mutate the board —
    // the spy variant can't catch the stale-snapshot bug (2nd flip = no-op).
    let realStack: CommandStackService;
    let liveService: FreeModeInteractionService;

    beforeEach(() => {
      const ctx = jasmine.createSpyObj<DuelContext>('DuelContext', ['announceEvent']);
      realStack = new CommandStackService(board);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          FreeModeInteractionService,
          { provide: BoardStateService, useValue: board },
          { provide: CommandStackService, useValue: realStack },
          { provide: DuelContext, useValue: ctx },
        ],
      });
      liveService = TestBed.inject(FreeModeInteractionService);
    });

    it('a SECOND flip toggles back (not a no-op on the stale arm snapshot)', () => {
      const a = makeCard();
      a.faceDown = false;
      place(SimZoneId.MONSTER_1, a);
      liveService.onCardTap({ cardCode: pc(a), zoneId: 'M1' });

      liveService.flipArmed(); // → face-down
      expect(board.boardState()[SimZoneId.MONSTER_1][0].faceDown).toBe(true);

      liveService.flipArmed(); // → face-up again (reads live state)
      expect(board.boardState()[SimZoneId.MONSTER_1][0].faceDown).toBe(false);
    });

    it('a SECOND position toggle flips back ATK', () => {
      const a = makeCard();
      a.position = 'ATK';
      place(SimZoneId.MONSTER_1, a);
      liveService.onCardTap({ cardCode: pc(a), zoneId: 'M1' });

      liveService.togglePositionArmed(); // → DEF
      expect(board.boardState()[SimZoneId.MONSTER_1][0].position).toBe('DEF');

      liveService.togglePositionArmed(); // → ATK
      expect(board.boardState()[SimZoneId.MONSTER_1][0].position).toBe('ATK');
    });
  });

  describe('counters (#11 / §5.4) — hors-undo, décrément OBLIGATOIRE plancher 0', () => {
    function armM1(card: CardInstance): void {
      place(SimZoneId.MONSTER_1, card);
      service.onCardTap({ cardCode: pc(card), zoneId: 'M1' });
    }

    it('increments the armed card counter', () => {
      const a = makeCard();
      armM1(a);

      service.incrementCounterArmed();
      service.incrementCounterArmed();

      expect(service.armedCounterValue()).toBe(2);
      expect(service.counters().get(a.instanceId)).toBe(2);
    });

    it('decrements the counter, floored at 0', () => {
      const a = makeCard();
      armM1(a);

      service.incrementCounterArmed();
      service.decrementCounterArmed();
      service.decrementCounterArmed(); // already 0 — stays 0, no negative

      expect(service.armedCounterValue()).toBe(0);
      expect(service.counters().has(a.instanceId)).toBe(false); // 0 removes the entry
    });

    it('decrement is a no-op when nothing is armed', () => {
      service.decrementCounterArmed();
      expect(service.counters().size).toBe(0);
    });

    it('resetEditorState clears all counters AND disarms (post-reset hygiene)', () => {
      const a = makeCard();
      armM1(a);
      service.incrementCounterArmed();
      expect(service.counters().size).toBe(1);
      expect(service.armedInstanceId()).toBe(a.instanceId);

      service.resetEditorState();

      expect(service.counters().size).toBe(0);
      expect(service.armedInstanceId()).toBeNull();
    });

    it('counters are per-card (independent across armed cards)', () => {
      const a = makeCard();
      const b = makeCard();
      place(SimZoneId.MONSTER_1, a);
      place(SimZoneId.MONSTER_2, b);

      service.onCardTap({ cardCode: pc(a), zoneId: 'M1' });
      service.incrementCounterArmed();
      service.disarm();
      service.onCardTap({ cardCode: pc(b), zoneId: 'M2' });
      service.incrementCounterArmed();
      service.incrementCounterArmed();

      expect(service.counters().get(a.instanceId)).toBe(1);
      expect(service.counters().get(b.instanceId)).toBe(2);
    });
  });
});
