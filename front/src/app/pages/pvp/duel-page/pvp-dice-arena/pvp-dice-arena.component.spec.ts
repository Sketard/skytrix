import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { PvpDiceArenaComponent } from './pvp-dice-arena.component';
import { DuelWebSocketService } from '../duel-web-socket.service';
import { DuelCardArtService } from '../duel-card-art.service';
import { DICE_AUTO_ROLL_DELAY_MS, DICE_ROLL_ANIM_DURATION_MS } from '../../pvp-timings';
import type { DiceResultMsg } from '../../duel-ws.types';

/**
 * Spec the dice arena state machine — the `stage` computed must return the
 * right value for every combination of WS signals + component inputs, and the
 * supporting effects (auto-roll, rolling-anim, final-latch, fresh-DICE_ROLL
 * reset) must mutate the durable state correctly under refresh-replay
 * scenarios.
 */
describe('PvpDiceArenaComponent', () => {
  // Hand-rolled stub: just the surface the arena reads.
  interface WsStub {
    pendingPrompt: WritableSignal<{ type: string } | null>;
    diceInProgress: WritableSignal<boolean>;
    diceResult: WritableSignal<DiceResultMsg | null>;
    firstPlayerResult: WritableSignal<{ goFirst: boolean } | null>;
    firstPlayerResponseSent: WritableSignal<boolean>;
    cardCodes: WritableSignal<number[]>;
    sendResponse: jasmine.Spy;
  }

  function makeWs(): WsStub {
    return {
      pendingPrompt: signal<{ type: string } | null>(null),
      diceInProgress: signal(false),
      diceResult: signal<DiceResultMsg | null>(null),
      firstPlayerResult: signal<{ goFirst: boolean } | null>(null),
      firstPlayerResponseSent: signal(false),
      cardCodes: signal<number[]>([]),
      sendResponse: jasmine.createSpy('sendResponse'),
    };
  }

  function makeArt(): { prefetchCards: jasmine.Spy } {
    return { prefetchCards: jasmine.createSpy('prefetchCards') };
  }

  function setup(): { fixture: ReturnType<typeof createComponent>; ws: WsStub; art: { prefetchCards: jasmine.Spy } } {
    const ws = makeWs();
    const art = makeArt();
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: DuelWebSocketService, useValue: ws },
        { provide: DuelCardArtService, useValue: art },
      ],
    });
    const fixture = createComponent();
    return { fixture, ws, art };
  }

  function createComponent() {
    const fixture = TestBed.createComponent(PvpDiceArenaComponent);
    fixture.detectChanges();
    TestBed.flushEffects();
    return fixture;
  }

  function flush(fixture: ReturnType<typeof createComponent>): void {
    fixture.detectChanges();
    TestBed.flushEffects();
  }

  // -----------------------------------------------------------------------
  // Static stage table — pure function of inputs (no effects involved yet)
  // -----------------------------------------------------------------------

  describe('stage computed — initial state', () => {
    it('idle when nothing is set', () => {
      const { fixture } = setup();
      expect(fixture.componentInstance.stage()).toBe('idle');
    });

    it('prep when `preparing` input is true and no WS context', () => {
      const { fixture } = setup();
      fixture.componentRef.setInput('preparing', true);
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('prep');
    });

    it('ready when DICE_ROLL prompt is pending', () => {
      const { fixture, ws } = setup();
      ws.pendingPrompt.set({ type: 'DICE_ROLL' });
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('ready');
    });

    it('DICE_ROLL prompt beats `preparing` (chrome stays mounted, content swaps)', () => {
      const { fixture, ws } = setup();
      fixture.componentRef.setInput('preparing', true);
      ws.pendingPrompt.set({ type: 'DICE_ROLL' });
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('ready');
    });
  });

  describe('stage computed — dice flow', () => {
    it('rolling on diceInProgress (response sent, server rolling)', () => {
      const { fixture, ws } = setup();
      ws.diceInProgress.set(true);
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('rolling');
    });

    it('rolling for DICE_ROLL_ANIM_DURATION_MS after DICE_RESULT arrives, then result', () => {
      jasmine.clock().install();
      try {
        const { fixture, ws } = setup();
        ws.diceResult.set({ type: 'DICE_RESULT', dice0: [3, 4], dice1: [5, 2], sum0: 7, sum1: 7, winner: null });
        flush(fixture);
        expect(fixture.componentInstance.stage()).toBe('rolling');
        // Right at the boundary
        jasmine.clock().tick(DICE_ROLL_ANIM_DURATION_MS - 1);
        flush(fixture);
        expect(fixture.componentInstance.stage()).toBe('rolling');
        // Crossing it
        jasmine.clock().tick(2);
        flush(fixture);
        expect(fixture.componentInstance.stage()).toBe('result');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('final on FIRST_PLAYER_RESULT when holdFinal=true (the contract: page connecting/duel-loading)', () => {
      const { fixture, ws } = setup();
      fixture.componentRef.setInput('holdFinal', true);
      ws.firstPlayerResult.set({ goFirst: true });
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('final');
    });

    it('idle when holdFinal=false even with FIRST_PLAYER_RESULT (degenerate: page already in `active` when result lands)', () => {
      // In practice this can't happen — the wrapper sets holdFinal=true for
      // everything except `active`, and we transition into `final` long before
      // `active`. The test pins the computed contract anyway.
      const { fixture, ws } = setup();
      ws.firstPlayerResult.set({ goFirst: true });
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('idle');
    });
  });

  // -----------------------------------------------------------------------
  // The fix from this iteration: `final` survives the server clearing
  // `firstPlayerResult` on DUEL_STARTING and stays put while `holdFinal=true`.
  // -----------------------------------------------------------------------

  describe('stage computed — final hold contract', () => {
    it('stays in `final` after firstPlayerResult is cleared (server DUEL_STARTING), as long as holdFinal=true', () => {
      const { fixture, ws } = setup();
      fixture.componentRef.setInput('holdFinal', true);
      ws.firstPlayerResult.set({ goFirst: true });
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('final');

      // Server sends DUEL_STARTING → front clears firstPlayerResult.
      ws.firstPlayerResult.set(null);
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('final');
    });

    it('drops to `idle` once holdFinal flips false (page entered `active`)', () => {
      const { fixture, ws } = setup();
      fixture.componentRef.setInput('holdFinal', true);
      ws.firstPlayerResult.set({ goFirst: true });
      flush(fixture);
      ws.firstPlayerResult.set(null);  // server clears it on DUEL_STARTING
      flush(fixture);
      fixture.componentRef.setInput('holdFinal', false);
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('idle');
    });

    it('latches finalGoFirst from FIRST_PLAYER_RESULT so the announce text survives the server clearing the WS signal', () => {
      const { fixture, ws } = setup();
      fixture.componentRef.setInput('holdFinal', true);
      ws.firstPlayerResult.set({ goFirst: false });
      flush(fixture);
      expect(fixture.componentInstance.finalGoFirst()).toBe(false);

      ws.firstPlayerResult.set(null);
      flush(fixture);
      expect(fixture.componentInstance.finalGoFirst()).toBe(false);  // still latched
    });
  });

  // -----------------------------------------------------------------------
  // Side-effect timers
  // -----------------------------------------------------------------------

  describe('auto-roll effect', () => {
    it('sends DICE_ROLL after DICE_AUTO_ROLL_DELAY_MS in `ready` stage', () => {
      jasmine.clock().install();
      try {
        const { fixture, ws } = setup();
        ws.pendingPrompt.set({ type: 'DICE_ROLL' });
        flush(fixture);
        expect(fixture.componentInstance.stage()).toBe('ready');
        expect(ws.sendResponse).not.toHaveBeenCalled();
        jasmine.clock().tick(DICE_AUTO_ROLL_DELAY_MS + 1);
        expect(ws.sendResponse).toHaveBeenCalledWith('DICE_ROLL', {});
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('cancels the auto-roll timer when stage leaves `ready` before it fires', () => {
      jasmine.clock().install();
      try {
        const { fixture, ws } = setup();
        ws.pendingPrompt.set({ type: 'DICE_ROLL' });
        flush(fixture);
        // Stage moves out of ready before the timer fires.
        ws.diceInProgress.set(true);
        ws.pendingPrompt.set(null);
        flush(fixture);
        jasmine.clock().tick(DICE_AUTO_ROLL_DELAY_MS + 1);
        expect(ws.sendResponse).not.toHaveBeenCalled();
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Rematch / fresh DICE_ROLL — transient state must reset
  // -----------------------------------------------------------------------

  describe('fresh DICE_ROLL prompt — transient reset', () => {
    it('clears _finalSeen + finalGoFirst when a new DICE_ROLL prompt arrives (rematch)', () => {
      const { fixture, ws } = setup();
      fixture.componentRef.setInput('holdFinal', true);
      ws.firstPlayerResult.set({ goFirst: true });
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('final');
      expect(fixture.componentInstance.finalGoFirst()).toBe(true);

      // Rematch: server clears firstPlayerResult + opens a new DICE_ROLL.
      ws.firstPlayerResult.set(null);
      ws.pendingPrompt.set({ type: 'DICE_ROLL' });
      flush(fixture);

      expect(fixture.componentInstance.finalGoFirst()).toBeNull();
      expect(fixture.componentInstance.stage()).toBe('ready');
    });

    it('does NOT reset on a SELECT_FIRST_PLAYER prompt (only DICE_ROLL is "fresh")', () => {
      const { fixture, ws } = setup();
      fixture.componentRef.setInput('holdFinal', true);
      ws.firstPlayerResult.set({ goFirst: true });
      flush(fixture);

      ws.pendingPrompt.set({ type: 'SELECT_FIRST_PLAYER' });
      flush(fixture);

      expect(fixture.componentInstance.finalGoFirst()).toBe(true);
      expect(fixture.componentInstance.stage()).toBe('final');
    });
  });

  // -----------------------------------------------------------------------
  // STATE_SYNC / refresh resync — driven by the new server snapshot path
  // -----------------------------------------------------------------------

  describe('refresh / STATE_SYNC resync', () => {
    it('refresh during CHOOSE_FIRST_PLAYER: DICE_RESULT + SELECT_FIRST_PLAYER prompt → lands on `result` with turn-choice', () => {
      jasmine.clock().install();
      try {
        const { fixture, ws } = setup();
        // Server replay (via buildPreDuelSnapshot): DICE_RESULT first.
        ws.diceResult.set({ type: 'DICE_RESULT', dice0: [6, 6], dice1: [3, 4], sum0: 12, sum1: 7, winner: 0 });
        // resendPendingPrompt: SELECT_FIRST_PLAYER.
        ws.pendingPrompt.set({ type: 'SELECT_FIRST_PLAYER' });
        flush(fixture);
        // Rolling animation plays again — visually nice rétro-action.
        expect(fixture.componentInstance.stage()).toBe('rolling');
        jasmine.clock().tick(DICE_ROLL_ANIM_DURATION_MS + 1);
        flush(fixture);
        expect(fixture.componentInstance.stage()).toBe('result');
        expect(fixture.componentInstance.outcome()).toBe('won');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('refresh during FIRST_PLAYER_RESOLVED: lands on `final` with announce text latched', () => {
      const { fixture, ws } = setup();
      fixture.componentRef.setInput('holdFinal', true);  // page is connecting
      // Server replay: DICE_RESULT + DECK_PREFETCH + FIRST_PLAYER_RESULT.
      ws.diceResult.set({ type: 'DICE_RESULT', dice0: [6, 6], dice1: [3, 4], sum0: 12, sum1: 7, winner: 0 });
      ws.cardCodes.set([100, 101, 200]);
      ws.firstPlayerResult.set({ goFirst: true });
      flush(fixture);
      expect(fixture.componentInstance.stage()).toBe('final');
      expect(fixture.componentInstance.finalGoFirst()).toBe(true);
    });
  });
});
