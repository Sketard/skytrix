import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PromptDerivationService } from './prompt-derivation.service';
import type { Prompt } from '../types';
import {
  LOCATION,
  type CardLocation,
  type Player,
  type SelectIdleCmdMsg,
  type SelectPlaceMsg,
  type SelectCardMsg,
} from '../duel-ws.types';

type ChainPhase = 'idle' | 'building' | 'resolving';

interface Harness {
  service: PromptDerivationService;
  pendingPrompt: WritableSignal<Prompt | null>;
  isAnimating: WritableSignal<boolean>;
  queueLength: WritableSignal<number>;
  chainPhase: WritableSignal<ChainPhase>;
  hasPendingChainEntry: WritableSignal<boolean>;
  chainEntryAnimating: WritableSignal<boolean>;
  chainPromptGateActive: WritableSignal<boolean>;
  ownPlayerIndex: WritableSignal<number>;
  waitingForOpponent: WritableSignal<boolean>;
  tpResult: WritableSignal<{ goFirst: boolean } | null>;
  rpsResult: WritableSignal<unknown>;
  rpsInProgress: WritableSignal<boolean>;
  ocgPlayerIndex: WritableSignal<number | null>;
}

function makeHarness(): Harness {
  const pendingPrompt = signal<Prompt | null>(null);
  const isAnimating = signal(false);
  const queueLength = signal(0);
  const chainPhase = signal<ChainPhase>('idle');
  const hasPendingChainEntry = signal(false);
  const chainEntryAnimating = signal(false);
  const chainPromptGateActive = signal(false);
  const ownPlayerIndex = signal(0);
  const waitingForOpponent = signal(false);
  const tpResult = signal<{ goFirst: boolean } | null>(null);
  const rpsResult = signal<unknown>(null);
  const rpsInProgress = signal(false);
  const ocgPlayerIndex = signal<number | null>(0);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [PromptDerivationService] });
  const service = TestBed.inject(PromptDerivationService);
  service.configure({
    pendingPrompt,
    isAnimating,
    queueLength: () => queueLength(),
    chainPhase,
    hasPendingChainEntry: () => hasPendingChainEntry(),
    chainEntryAnimating,
    chainPromptGateActive,
    ownPlayerIndex,
    waitingForOpponent,
    tpResult,
    rpsResult: () => rpsResult(),
    rpsInProgress: () => rpsInProgress(),
    ocgPlayerIndex: () => ocgPlayerIndex(),
  });

  return {
    service, pendingPrompt, isAnimating, queueLength, chainPhase,
    hasPendingChainEntry, chainEntryAnimating, chainPromptGateActive,
    ownPlayerIndex, waitingForOpponent, tpResult, rpsResult, rpsInProgress,
    ocgPlayerIndex,
  };
}

function idleCmd(): SelectIdleCmdMsg {
  return {
    type: 'SELECT_IDLECMD',
    player: 0 as Player,
    summons: [], specialSummons: [], repositions: [], setMonsters: [],
    activations: [], setSpellTraps: [],
    canBattlePhase: true, canEndPhase: true,
  };
}

function placeMsg(places: Array<{ player: number; location: CardLocation; sequence: number }>): SelectPlaceMsg {
  return {
    type: 'SELECT_PLACE',
    player: 0 as Player,
    count: 1,
    places: places.map(p => ({ player: p.player as Player, location: p.location, sequence: p.sequence })),
  };
}

describe('PromptDerivationService', () => {
  // -------------------------------------------------------------------------
  // configure() guard
  // -------------------------------------------------------------------------

  describe('configure()', () => {
    it('throws via duelAssert when read before configure() in dev mode', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [PromptDerivationService] });
      const svc = TestBed.inject(PromptDerivationService);
      expect(() => svc.visiblePrompt()).toThrowError(/configure\(\) was not called/);
    });
  });

  // -------------------------------------------------------------------------
  // visiblePrompt — drain coordination
  // -------------------------------------------------------------------------

  describe('visiblePrompt', () => {
    it('returns the pending prompt when nothing blocks', () => {
      const h = makeHarness();
      const p = idleCmd();
      h.pendingPrompt.set(p);
      expect(h.service.visiblePrompt()).toBe(p);
    });

    it('returns null when isAnimating=true (and not in chain-building cost gap)', () => {
      const h = makeHarness();
      h.pendingPrompt.set(idleCmd());
      h.isAnimating.set(true);
      expect(h.service.visiblePrompt()).toBeNull();
    });

    it('returns null when the queue has pending entries', () => {
      const h = makeHarness();
      h.pendingPrompt.set(idleCmd());
      h.queueLength.set(3);
      expect(h.service.visiblePrompt()).toBeNull();
    });

    it('returns null when chainEntryAnimating=true', () => {
      const h = makeHarness();
      h.pendingPrompt.set(idleCmd());
      h.chainEntryAnimating.set(true);
      expect(h.service.visiblePrompt()).toBeNull();
    });

    it('returns null when chainPromptGateActive=true', () => {
      const h = makeHarness();
      h.pendingPrompt.set(idleCmd());
      h.chainPromptGateActive.set(true);
      expect(h.service.visiblePrompt()).toBeNull();
    });

    it('lets cost prompts through during chain building when only chainEntryAnimating blocks', () => {
      const h = makeHarness();
      const p = idleCmd();
      h.pendingPrompt.set(p);
      h.chainPhase.set('building');
      h.hasPendingChainEntry.set(true);
      h.chainEntryAnimating.set(true);
      // animating=false, queueLength=0 → cost-prompt-bypass kicks in
      expect(h.service.visiblePrompt()).toBe(p);
    });

    it('does NOT bypass when isAnimating=true even with chain building + pending entry', () => {
      const h = makeHarness();
      h.pendingPrompt.set(idleCmd());
      h.chainPhase.set('building');
      h.hasPendingChainEntry.set(true);
      h.isAnimating.set(true);
      expect(h.service.visiblePrompt()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // actionablePrompt
  // -------------------------------------------------------------------------

  describe('actionablePrompt', () => {
    it('returns the prompt when type is SELECT_IDLECMD', () => {
      const h = makeHarness();
      const p = idleCmd();
      h.pendingPrompt.set(p);
      expect(h.service.actionablePrompt()).toBe(p);
    });

    it('returns null for non-IDLECMD/BATTLECMD prompts', () => {
      const h = makeHarness();
      h.pendingPrompt.set({ type: 'SELECT_CARD', player: 0, min: 1, max: 1, cards: [], cancelable: false } as SelectCardMsg);
      expect(h.service.actionablePrompt()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // hasActivePrompt
  // -------------------------------------------------------------------------

  describe('hasActivePrompt', () => {
    it('is false when no prompt', () => {
      const h = makeHarness();
      expect(h.service.hasActivePrompt()).toBeFalse();
    });

    it('is false for IDLECMD (distributed UI, not blocking)', () => {
      const h = makeHarness();
      h.pendingPrompt.set(idleCmd());
      expect(h.service.hasActivePrompt()).toBeFalse();
    });

    it('is true for blocking prompts (SELECT_CARD)', () => {
      const h = makeHarness();
      h.pendingPrompt.set({ type: 'SELECT_CARD', player: 0, min: 1, max: 1, cards: [], cancelable: false } as SelectCardMsg);
      expect(h.service.hasActivePrompt()).toBeTrue();
    });
  });

  // -------------------------------------------------------------------------
  // isZoneHighlightActive + highlightedZones + zoneInstruction
  // -------------------------------------------------------------------------

  describe('zone highlight derivation', () => {
    it('isZoneHighlightActive is true for SELECT_PLACE', () => {
      const h = makeHarness();
      h.pendingPrompt.set(placeMsg([{ player: 0, location: LOCATION.MZONE, sequence: 0 }]));
      expect(h.service.isZoneHighlightActive()).toBeTrue();
    });

    it('isZoneHighlightActive is false for IDLECMD', () => {
      const h = makeHarness();
      h.pendingPrompt.set(idleCmd());
      expect(h.service.isZoneHighlightActive()).toBeFalse();
    });

    it('highlightedZones derives keys from places (own player → rel 0)', () => {
      const h = makeHarness();
      h.ownPlayerIndex.set(0);
      h.pendingPrompt.set(placeMsg([
        { player: 0, location: LOCATION.MZONE, sequence: 0 }, // M1-0
        { player: 1, location: LOCATION.SZONE, sequence: 1 }, // S2-1
      ]));
      const keys = h.service.highlightedZones();
      expect(keys.has('M1-0')).toBeTrue();
      expect(keys.has('S2-1')).toBeTrue();
    });

    it('highlightedZones inverts relPlayer when own player is 1', () => {
      const h = makeHarness();
      h.ownPlayerIndex.set(1);
      h.pendingPrompt.set(placeMsg([
        { player: 0, location: LOCATION.MZONE, sequence: 0 }, // opponent → rel 1 → M1-1
      ]));
      const keys = h.service.highlightedZones();
      expect(keys.has('M1-1')).toBeTrue();
    });

    it('highlightedZones returns empty set when prompt is not PLACE/DISFIELD', () => {
      const h = makeHarness();
      h.pendingPrompt.set(idleCmd());
      expect(h.service.highlightedZones().size).toBe(0);
    });

    it('zoneInstruction returns the right string per prompt type', () => {
      const h = makeHarness();
      h.pendingPrompt.set(placeMsg([]));
      expect(h.service.zoneInstruction()).toBe('Select a zone to place your card');

      h.pendingPrompt.set({ type: 'SELECT_DISFIELD', player: 0 as Player, count: 1, places: [] } as Prompt);
      expect(h.service.zoneInstruction()).toBe('Select a zone to destroy');

      h.pendingPrompt.set(idleCmd());
      expect(h.service.zoneInstruction()).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // tpPassiveMessage
  // -------------------------------------------------------------------------

  describe('tpPassiveMessage', () => {
    it('returns "You go first!" when tpResult.goFirst=true', () => {
      const h = makeHarness();
      h.tpResult.set({ goFirst: true });
      const msg = h.service.tpPassiveMessage();
      expect(msg).toEqual({
        title: 'You go first!',
        subtitle: 'The duel will begin shortly',
        style: 'result',
      });
    });

    it('returns "You go second!" when tpResult.goFirst=false', () => {
      const h = makeHarness();
      h.tpResult.set({ goFirst: false });
      expect(h.service.tpPassiveMessage()!.title).toBe('You go second!');
    });

    it('returns waiting message when pre-duel + waitingForOpponent + no prompt + no rps', () => {
      const h = makeHarness();
      h.waitingForOpponent.set(true);
      h.ocgPlayerIndex.set(null); // pre-duel
      // pendingPrompt=null, rpsResult=null, rpsInProgress=false (defaults)
      const msg = h.service.tpPassiveMessage();
      expect(msg).toEqual({
        title: 'Opponent is choosing turn order...',
        style: 'waiting',
      });
    });

    it('returns null when ocgPlayerIndex is set (no longer pre-duel)', () => {
      const h = makeHarness();
      h.waitingForOpponent.set(true);
      h.ocgPlayerIndex.set(0);
      expect(h.service.tpPassiveMessage()).toBeNull();
    });

    it('returns null when an RPS result is present', () => {
      const h = makeHarness();
      h.waitingForOpponent.set(true);
      h.ocgPlayerIndex.set(null);
      h.rpsResult.set({ winner: 0 });
      expect(h.service.tpPassiveMessage()).toBeNull();
    });
  });
});
