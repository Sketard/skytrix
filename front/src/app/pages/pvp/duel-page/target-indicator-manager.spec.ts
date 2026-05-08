import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TargetIndicatorManager } from './target-indicator-manager';
import { CardTravelService } from './card-travel.service';
import { DuelCardArtService } from './duel-card-art.service';
import { DuelContext } from './duel-context';
import { ANIMATION_DATA_SOURCE, type AnimationDataSource, type QueueEntry } from './animation-data-source';
import { LOCATION, POSITION } from '../duel-ws.types';
import type { BecomeTargetMsg, BoardZone } from '../duel-ws.types';
import { EMPTY_DUEL_STATE, type DuelState } from '../types';

function makeFloatEl(): HTMLDivElement {
  const div = document.createElement('div');
  return div;
}

function makeBoardWithGyCards(player: 0 | 1, cards: { cardCode: number | null; faceDown?: boolean }[]): DuelState {
  const playerZones: BoardZone[] = [
    {
      zoneId: 'GY',
      cards: cards.map(c => ({
        cardCode: c.cardCode,
        name: null,
        position: c.faceDown ? POSITION.FACEDOWN_DEFENSE : POSITION.FACEUP_ATTACK,
        overlayMaterials: [],
        counters: {},
      })),
    },
  ];
  const empty = EMPTY_DUEL_STATE;
  const players: DuelState['players'] = [
    { ...empty.players[0], zones: player === 0 ? playerZones : [] },
    { ...empty.players[1], zones: player === 1 ? playerZones : [] },
  ];
  return { ...empty, players };
}

describe('TargetIndicatorManager', () => {
  let manager: TargetIndicatorManager;
  let mockCardTravel: jasmine.SpyObj<CardTravelService>;
  let mockArtService: jasmine.SpyObj<DuelCardArtService>;
  let renderedState: WritableSignal<DuelState>;
  let mockDataSource: AnimationDataSource;

  let createdFloats: HTMLDivElement[];
  let removedFloats: HTMLDivElement[];
  let fadedFloats: HTMLDivElement[];

  beforeEach(() => {
    createdFloats = [];
    removedFloats = [];
    fadedFloats = [];
    renderedState = signal<DuelState>(EMPTY_DUEL_STATE);

    const mockRbs = { renderedState };

    mockDataSource = {
      renderedBoardState: mockRbs as unknown as AnimationDataSource['renderedBoardState'],
      animationQueue: signal<QueueEntry[]>([]),
      activeChainLinks: signal([]),
      chainPhase: signal('idle'),
      pendingPrompt: signal(null),
      dequeueAnimation: () => null,
      removeAnimationAt: () => undefined,
      prependToQueue: () => undefined,
      setAnimating: () => undefined,
      applyChainSolving: () => undefined,
      applyChainSolved: () => undefined,
      applyChainEnd: () => undefined,
    };

    mockCardTravel = jasmine.createSpyObj<CardTravelService>('CardTravelService', [
      'createTargetFloat', 'removeTargetFloat', 'fadeOutAndRemoveTargetFloat', 'toAbsoluteUrl',
    ]);
    mockCardTravel.createTargetFloat.and.callFake(() => {
      const el = makeFloatEl();
      createdFloats.push(el);
      return el;
    });
    mockCardTravel.removeTargetFloat.and.callFake((el: HTMLDivElement) => { removedFloats.push(el); });
    mockCardTravel.fadeOutAndRemoveTargetFloat.and.callFake((el: HTMLDivElement) => { fadedFloats.push(el); });
    mockCardTravel.toAbsoluteUrl.and.callFake((s: string) => s);

    mockArtService = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArtService.resolveUrl.and.callFake((code: number | null | undefined) => code == null ? 'card_back.jpg' : `art/${code}.jpg`);

    const mockCtx = {
      ownPlayerIndex: () => 0,
      relativePlayer: (p: number) => (p === 0 ? 0 : 1) as 0 | 1,
      speedMultiplier: () => 1,
      isBoardActive: () => true,
      reducedMotion: signal(false),
      scaledDuration: (base: number) => base,
      cardBaseRotation: () => undefined,
      cardBaseRotateCSS: () => '',
      announceEvent: () => undefined,
    };

    TestBed.configureTestingModule({
      providers: [
        TargetIndicatorManager,
        { provide: CardTravelService, useValue: mockCardTravel },
        { provide: DuelCardArtService, useValue: mockArtService },
        { provide: ANIMATION_DATA_SOURCE, useValue: mockDataSource },
        { provide: DuelContext, useValue: mockCtx as unknown as DuelContext },
      ],
    });
    manager = TestBed.inject(TargetIndicatorManager);
  });

  function targetMsg(targets: BecomeTargetMsg['cards']): BecomeTargetMsg {
    return { type: 'MSG_BECOME_TARGET', cards: targets };
  }

  describe('spawnPileFloats', () => {
    it('skips field-zone targets (MZONE/SZONE) — handled by orchestrator signal', () => {
      manager.spawnPileFloats(targetMsg([
        { player: 0, location: LOCATION.MZONE, sequence: 2 },
        { player: 0, location: LOCATION.SZONE, sequence: 1 },
      ]));
      expect(mockCardTravel.createTargetFloat).not.toHaveBeenCalled();
    });

    it('spawns a float for a GY target with the correct zoneKey', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 12345 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      expect(mockCardTravel.createTargetFloat).toHaveBeenCalledTimes(1);
      const args = mockCardTravel.createTargetFloat.calls.mostRecent().args;
      expect(args[0]).toBe('GY-0'); // zoneKey
      expect(args[1]).toBe('art/12345.jpg'); // cardImage
      expect(args[2]).toBe(0); // cascadeIndex
    });

    it('builds opponent zoneKey with relPlayer=1', () => {
      renderedState.set(makeBoardWithGyCards(1, [{ cardCode: 999 }]));
      manager.spawnPileFloats(targetMsg([{ player: 1, location: LOCATION.GRAVE, sequence: 0 }]));
      const args = mockCardTravel.createTargetFloat.calls.mostRecent().args;
      expect(args[0]).toBe('GY-1');
    });

    it('cascades indices monotonically across consecutive spawns on the same zone', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 1 }, { cardCode: 2 }, { cardCode: 3 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 1 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 2 }]));

      const calls = mockCardTravel.createTargetFloat.calls.allArgs();
      expect(calls.length).toBe(3);
      expect(calls[0][2]).toBe(0); // cascadeIndex
      expect(calls[1][2]).toBe(1);
      expect(calls[2][2]).toBe(2);
    });

    it('marks new float --active and demotes previous floats on the same zone', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 1 }, { cardCode: 2 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 1 }]));

      const [first, second] = createdFloats;
      expect(first.classList.contains('target-float--demoted')).toBeTrue();
      expect(first.classList.contains('target-float--active')).toBeFalse();
      expect(second.classList.contains('target-float--active')).toBeTrue();
    });

    it('uses card_back when targeted banished card is face-down', () => {
      const banishedZones: BoardZone[] = [{ zoneId: 'BANISHED', cards: [{
        cardCode: 99999, name: null, position: POSITION.FACEDOWN_DEFENSE, overlayMaterials: [], counters: {},
      }] }];
      renderedState.set({
        ...EMPTY_DUEL_STATE,
        players: [
          { ...EMPTY_DUEL_STATE.players[0], zones: banishedZones },
          EMPTY_DUEL_STATE.players[1],
        ],
      });
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.BANISHED, sequence: 0 }]));
      // resolveUrl was called with null (face-down → no leak of cardCode)
      expect(mockArtService.resolveUrl).toHaveBeenCalledWith(null);
    });

    it('skips float when createTargetFloat returns null (reduced motion / unmounted zone)', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 1 }]));
      mockCardTravel.createTargetFloat.and.returnValue(null);
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      expect(mockCardTravel.createTargetFloat).toHaveBeenCalled();
      // No float tracked → cleanup is a no-op
      manager.cleanup();
      expect(mockCardTravel.fadeOutAndRemoveTargetFloat).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('fades out every tracked float and clears state', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 1 }, { cardCode: 2 }]));
      manager.spawnPileFloats(targetMsg([
        { player: 0, location: LOCATION.GRAVE, sequence: 0 },
        { player: 0, location: LOCATION.GRAVE, sequence: 1 },
      ]));
      manager.cleanup();
      expect(mockCardTravel.fadeOutAndRemoveTargetFloat).toHaveBeenCalledTimes(2);
      // Subsequent spawn starts fresh at cascadeIndex=0
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      expect(mockCardTravel.createTargetFloat.calls.mostRecent().args[2]).toBe(0);
    });

    it('is idempotent (second call after no spawns is a no-op)', () => {
      manager.cleanup();
      manager.cleanup();
      expect(mockCardTravel.fadeOutAndRemoveTargetFloat).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('removes floats immediately (no fade) and clears the cleanup timer', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 1 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      manager.scheduleCleanup(800);
      manager.reset();
      expect(mockCardTravel.removeTargetFloat).toHaveBeenCalledTimes(1);
      expect(mockCardTravel.fadeOutAndRemoveTargetFloat).not.toHaveBeenCalled();
    });
  });

  describe('scheduleCleanup', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('fires cleanup after the specified delay', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 1 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      manager.scheduleCleanup(800);

      jasmine.clock().tick(799);
      expect(mockCardTravel.fadeOutAndRemoveTargetFloat).not.toHaveBeenCalled();
      jasmine.clock().tick(2);
      expect(mockCardTravel.fadeOutAndRemoveTargetFloat).toHaveBeenCalledTimes(1);
    });

    it('cancels the previous timer when called again before it fires (cascade hold extension)', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 1 }, { cardCode: 2 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      manager.scheduleCleanup(800);

      jasmine.clock().tick(500);
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 1 }]));
      manager.scheduleCleanup(800);

      jasmine.clock().tick(500); // total 1000ms → first timer would have fired at 800ms
      expect(mockCardTravel.fadeOutAndRemoveTargetFloat).not.toHaveBeenCalled();
      jasmine.clock().tick(400); // total 1400ms → second timer at 1300ms (500+800)
      expect(mockCardTravel.fadeOutAndRemoveTargetFloat).toHaveBeenCalledTimes(2);
    });
  });

  describe('ngOnDestroy', () => {
    it('resets immediately on destroy', () => {
      renderedState.set(makeBoardWithGyCards(0, [{ cardCode: 1 }]));
      manager.spawnPileFloats(targetMsg([{ player: 0, location: LOCATION.GRAVE, sequence: 0 }]));
      manager.ngOnDestroy();
      expect(mockCardTravel.removeTargetFloat).toHaveBeenCalledTimes(1);
    });
  });
});
