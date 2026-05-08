import { TestBed } from '@angular/core/testing';
import { BattleAnimationTracker } from './battle-animation-tracker';
import { CardTravelService } from './card-travel.service';
import { DuelContext } from './duel-context';
import type { AttackMsg, BattleMsg } from '../duel-ws.types';

/**
 * Builds a DOM element whose `animate()` returns a controllable mock —
 * `finished` resolves immediately so `await` in the SUT does not hang.
 */
function makeAnimatableEl(tag: 'div' | 'span' = 'div'): HTMLElement {
  const el = document.createElement(tag);
  // jsdom/Karma already provide Element.animate, but the returned Animation
  // object is not always testable. Override with a minimal stub.
  el.animate = ((): Animation => ({
    finished: Promise.resolve() as unknown as Promise<Animation>,
    cancel: () => undefined,
  } as unknown as Animation)) as typeof el.animate;
  return el;
}

describe('BattleAnimationTracker', () => {
  let tracker: BattleAnimationTracker;
  let mockCardTravel: jasmine.SpyObj<CardTravelService>;
  let mockCtx: jasmine.SpyObj<DuelContext>;
  let attackerEl: HTMLElement;
  let defenderEl: HTMLElement;
  let lineEl: HTMLDivElement;
  let containerEl: HTMLElement;

  beforeEach(() => {
    attackerEl = makeAnimatableEl();
    // BattleAnimationTracker queries `.zone-card` inside the attacker element.
    const cardChild = makeAnimatableEl();
    cardChild.className = 'zone-card';
    attackerEl.appendChild(cardChild);

    defenderEl = makeAnimatableEl();
    lineEl = makeAnimatableEl('div') as HTMLDivElement;
    containerEl = document.createElement('div');

    mockCardTravel = jasmine.createSpyObj<CardTravelService>('CardTravelService', [
      'getZoneElement', 'getContainer', 'createLineBetween',
    ]);
    mockCardTravel.getZoneElement.and.callFake((key: string) => {
      if (key.startsWith('M')) return attackerEl;
      if (key.startsWith('HAND')) return defenderEl;
      return defenderEl;
    });
    mockCardTravel.getContainer.and.returnValue(containerEl);
    mockCardTravel.createLineBetween.and.returnValue(lineEl);

    mockCtx = jasmine.createSpyObj<DuelContext>('DuelContext', [
      'relativePlayer', 'scaledDuration', 'announceEvent',
    ]);
    mockCtx.relativePlayer.and.callFake((p: number) => (p === 0 ? 0 : 1));
    mockCtx.scaledDuration.and.callFake((base: number) => base);
    mockCtx.announceEvent.and.stub();

    TestBed.configureTestingModule({
      providers: [
        BattleAnimationTracker,
        { provide: CardTravelService, useValue: mockCardTravel },
        { provide: DuelContext, useValue: mockCtx },
      ],
    });
    tracker = TestBed.inject(BattleAnimationTracker);
  });

  function attackMsg(overrides: Partial<AttackMsg> = {}): AttackMsg {
    return {
      type: 'MSG_ATTACK',
      attackerPlayer: 0,
      attackerSequence: 0,
      defenderPlayer: 1,
      defenderSequence: 2,
      ...overrides,
    } as AttackMsg;
  }

  function battleMsg(): BattleMsg {
    return {
      type: 'MSG_BATTLE',
      attackerPlayer: 0,
      attackerSequence: 0,
      attackerDamage: 0,
      defenderPlayer: 1,
      defenderSequence: 2,
      defenderDamage: 0,
    };
  }

  describe('processAttackEvent', () => {
    it('looks up attacker via MZONE + relativePlayer + sequence', async () => {
      await tracker.processAttackEvent(attackMsg({ attackerPlayer: 0, attackerSequence: 3 }));
      // MZONE seq 3 → M4 (locationToZoneId), relPlayer 0 → "M4-0"
      expect(mockCardTravel.getZoneElement).toHaveBeenCalledWith('M4-0');
    });

    it('builds defenderKey HAND-${opponentRel} on direct attack (defenderPlayer null)', async () => {
      await tracker.processAttackEvent(attackMsg({
        attackerPlayer: 0, defenderPlayer: null, defenderSequence: null,
      }));
      // attacker rel=0 → opponentRel=1 → HAND-1 visual proxy
      expect(mockCardTravel.getZoneElement).toHaveBeenCalledWith('HAND-1');
    });

    it('uses MZONE defender lookup when both defender fields present', async () => {
      await tracker.processAttackEvent(attackMsg({
        attackerPlayer: 0, defenderPlayer: 1, defenderSequence: 4,
      }));
      // defender rel=1, MZONE seq 4 → M5 → "M5-1"
      expect(mockCardTravel.getZoneElement).toHaveBeenCalledWith('M5-1');
    });

    it('returns early without creating line when attackerEl missing', async () => {
      mockCardTravel.getZoneElement.and.returnValue(null);
      await tracker.processAttackEvent(attackMsg());
      expect(mockCardTravel.createLineBetween).not.toHaveBeenCalled();
    });

    it('returns early without setting pendingAttack when createLineBetween returns null', async () => {
      mockCardTravel.createLineBetween.and.returnValue(null);
      await tracker.processAttackEvent(attackMsg());
      // Trigger BATTLE — no pending should mean no defender lookup beyond ATTACK
      mockCardTravel.getZoneElement.calls.reset();
      await tracker.processBattleEvent(battleMsg());
      expect(mockCardTravel.getZoneElement).not.toHaveBeenCalled();
    });

    it('back-to-back attacks release the previous pending line', async () => {
      const firstLine = makeAnimatableEl() as HTMLDivElement;
      const removeSpy = spyOn(firstLine, 'remove');
      mockCardTravel.createLineBetween.and.returnValues(firstLine, lineEl);

      await tracker.processAttackEvent(attackMsg());
      await tracker.processAttackEvent(attackMsg());

      // first line gets faded + removed (release path)
      // animation fade resolves async; trigger microtasks
      await Promise.resolve();
      expect(removeSpy).toHaveBeenCalled();
    });

    it('schedules an 8s release timer for the new pending attack', async () => {
      jasmine.clock().install();
      try {
        const promise = tracker.processAttackEvent(attackMsg());
        // line-extension await resolves on a microtask, drain it
        await promise;
        const removeSpy = spyOn(lineEl, 'remove');
        jasmine.clock().tick(8001);
        // releasePendingAttack triggers fade animate; its `.finished.then` removes lineEl
        await Promise.resolve();
        await Promise.resolve();
        expect(removeSpy).toHaveBeenCalled();
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });

  describe('processBattleEvent', () => {
    it('is a no-op when no pendingAttack (queue collapse safety)', async () => {
      await tracker.processBattleEvent(battleMsg());
      // No exception, no defender lookup beyond what would be inside the branch
      expect(mockCardTravel.getZoneElement).not.toHaveBeenCalled();
    });

    it('removes the pending line and clears the signal on resolve', async () => {
      await tracker.processAttackEvent(attackMsg());
      const removeSpy = spyOn(lineEl, 'remove');
      await tracker.processBattleEvent(battleMsg());
      expect(removeSpy).toHaveBeenCalled();
      // Subsequent BATTLE is a no-op → no further removeSpy calls
      removeSpy.calls.reset();
      await tracker.processBattleEvent(battleMsg());
      expect(removeSpy).not.toHaveBeenCalled();
    });
  });

  describe('releasePendingAttack', () => {
    it('is a no-op when no pendingAttack', () => {
      expect(() => tracker.releasePendingAttack()).not.toThrow();
    });

    it('fades the line and removes it after the fade promise resolves', async () => {
      await tracker.processAttackEvent(attackMsg());
      const removeSpy = spyOn(lineEl, 'remove');
      tracker.releasePendingAttack();
      await Promise.resolve();
      expect(removeSpy).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('removes any pending line synchronously without animation', async () => {
      await tracker.processAttackEvent(attackMsg());
      const removeSpy = spyOn(lineEl, 'remove');
      tracker.reset();
      // reset is sync — no microtask drain needed
      expect(removeSpy).toHaveBeenCalled();
    });

    it('clears the pending release timer (no removal fires after reset)', async () => {
      jasmine.clock().install();
      try {
        await tracker.processAttackEvent(attackMsg());
        const removeSpy = spyOn(lineEl, 'remove');
        tracker.reset();
        removeSpy.calls.reset();
        // The 8s auto-release timer must NOT fire after reset.
        jasmine.clock().tick(10_000);
        expect(removeSpy).not.toHaveBeenCalled();
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });
});
