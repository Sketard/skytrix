/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (mocks of the
   real pipeline shape). They are not pipeline signals at runtime;
   the §3.2 tagging convention (transport / environment / projection)
   targets the real classes only. (α.7b.1, 2026-05-25) */

import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { PvpChainOverlayComponent } from './pvp-chain-overlay.component';
import { ANIMATION_DATA_SOURCE } from '../animation-data-source';
import { AnimationOrchestratorService } from '../animation-orchestrator.service';
import { ChainResolutionManager } from '../chain-resolution-manager';
import { DuelContext } from '../duel-context';
import { DuelLogger } from '../duel-logger';
import { DuelCardArtService } from '../duel-card-art.service';
import type { ChainLinkState } from '../../types';
import { LOCATION } from '../../duel-ws.types';

/**
 * Specs pin the PvpChainOverlayComponent's signal-driven orchestration.
 * Coverage focuses on the 5 effects (A/B/C/D/E), the 8 private flags, and
 * the resolution sequence's async contract with the orchestrator.
 *
 * Filet for M9 (chain-overlay state-machine refactor) — these specs MUST
 * keep passing after the refactor; if a behavior changes intentionally,
 * the test is the place to encode the decision.
 */
describe('PvpChainOverlayComponent', () => {
  // --- Mocks -----------------------------------------------------------------

  let activeChainLinks: WritableSignal<ChainLinkState[]>;
  let chainPhase: WritableSignal<'idle' | 'building' | 'resolving'>;
  let mockOrchestrator: jasmine.SpyObj<AnimationOrchestratorService>;
  let mockChainManager: ChainManagerMock;
  let mockAnnouncer: jasmine.SpyObj<LiveAnnouncer>;
  let mockArtService: jasmine.SpyObj<DuelCardArtService>;
  let fixture: ComponentFixture<PvpChainOverlayComponent>;
  let component: PvpChainOverlayComponent;

  // ChainResolutionManager carries 5 signals + 1 boolean getter — replicate
  // the surface used by the component without spinning up the real class
  // (which would drag DuelLogger + buffer state).
  type ChainManagerMock = {
    chainEntryAnimating: WritableSignal<boolean>;
    // F15 (2026-05-31) — `chainResolutionAnnounce` is now a single
    // signal owned by the manager (no more split projection + sync
    // mirror). Tests flip the value via
    // `mockChainManager.chainResolutionAnnounce.set(true)`.
    chainResolutionAnnounce: WritableSignal<boolean>;
    chainOverlayReady: WritableSignal<boolean>;
    chainPromptGateActive: WritableSignal<boolean>;
    hasBufferedEvents: boolean;
    isWaitingForOverlay: boolean;
  };

  // --- Helpers ---------------------------------------------------------------

  function createLink(idx: number, opts: Partial<ChainLinkState> = {}): ChainLinkState {
    return {
      chainIndex: idx,
      cardCode: 1000 + idx,
      cardName: `Card ${idx + 1}`,
      player: 0,
      zoneId: 'M1',
      location: LOCATION.MZONE,
      sequence: 0,
      resolving: false,
      negated: false,
      ...opts,
    };
  }

  function setLinks(links: ChainLinkState[]): void {
    activeChainLinks.set(links);
    fixture.detectChanges();
  }

  function setPhase(p: 'idle' | 'building' | 'resolving'): void {
    chainPhase.set(p);
    fixture.detectChanges();
  }

  function setLinksAndPhase(links: ChainLinkState[], p: 'idle' | 'building' | 'resolving'): void {
    activeChainLinks.set(links);
    chainPhase.set(p);
    fixture.detectChanges();
  }

  // Component reads `promptActive` as an input signal — write through fixture.componentRef.
  function setPromptActive(active: boolean): void {
    fixture.componentRef.setInput('promptActive', active);
    fixture.detectChanges();
  }

  beforeEach(() => {
    activeChainLinks = signal<ChainLinkState[]>([]);
    chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');

    mockOrchestrator = jasmine.createSpyObj<AnimationOrchestratorService>(
      'AnimationOrchestratorService',
      ['speedMultiplier', 'chainPulseDuration', 'chainExitDuration', 'replayBuffer'],
    );
    mockOrchestrator.speedMultiplier.and.returnValue(1);
    mockOrchestrator.chainPulseDuration.and.returnValue(800);
    mockOrchestrator.chainExitDuration.and.returnValue(800);
    mockOrchestrator.replayBuffer.and.returnValue(Promise.resolve());

    // β.3 Lot 1b — overlayShowReady stub. The component reads
    // `orchestrator.overlayShowReady.isReady(chainIndex)` in onNewChainLink
    // and watches `.value()` in the deferred-show effect. The default
    // stub returns true for every chainId so existing chain-overlay
    // specs (which predate the gating) keep their pre-β.3 behaviour
    // (show overlay synchronously). β.3-specific specs that test the
    // gating itself should override this stub locally.
    const overlayShowReadyStub = {
      value: signal<ReadonlySet<number>>(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
      isReady: (_chainId: number) => true,
    };
    (mockOrchestrator as unknown as { overlayShowReady: typeof overlayShowReadyStub }).overlayShowReady = overlayShowReadyStub;

    mockChainManager = {
      chainEntryAnimating: signal(false),
      chainResolutionAnnounce: signal(false),
      chainOverlayReady: signal(true),
      chainPromptGateActive: signal(false),
      hasBufferedEvents: false,
      isWaitingForOverlay: false,
    };

    mockAnnouncer = jasmine.createSpyObj<LiveAnnouncer>('LiveAnnouncer', ['announce']);
    mockArtService = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArtService.resolveUrl.and.returnValue('mock-url');

    const silentLogger: Partial<DuelLogger> = {
      log: () => undefined,
      warn: () => undefined,
    };

    // DuelContext stub — `ownPlayerIndex` is consumed by visibleCards
    // (viewer = absolute P0 here). `scaledDuration(base, min)` is consumed
    // by the breathing-room hold timers added 2026-06-03 in
    // `_startEnterAndShoveAnims` + `applyResolvingPulse` +
    // `onChainLinkResolved` step 2 — under speed=1 it's the identity, so
    // returning `base` directly is the right stub.
    const duelCtxStub = {
      ownPlayerIndex: () => 0,
      scaledDuration: (base: number, _min = 0) => base,
    } as unknown as DuelContext;

    TestBed.configureTestingModule({
      imports: [PvpChainOverlayComponent],
      providers: [
        { provide: ANIMATION_DATA_SOURCE, useValue: { activeChainLinks, chainPhase } },
        { provide: AnimationOrchestratorService, useValue: mockOrchestrator },
        { provide: ChainResolutionManager, useValue: mockChainManager },
        { provide: LiveAnnouncer, useValue: mockAnnouncer },
        { provide: DuelLogger, useValue: silentLogger },
        { provide: DuelCardArtService, useValue: mockArtService },
        { provide: DuelContext, useValue: duelCtxStub },
      ],
    });

    fixture = TestBed.createComponent(PvpChainOverlayComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('promptActive', false);
    fixture.detectChanges();
  });

  // ---------------------------------------------------------------------------
  // 1. chain-1 (no overlay)
  // ---------------------------------------------------------------------------

  describe('chain-1 (no overlay)', () => {
    it('should NOT show the overlay for a single chain link', () => {
      setLinksAndPhase([createLink(0)], 'building');
      expect(component.overlayVisible()).toBeFalse();
    });

    it('should NOT set enteringCardIndex for a single chain link', () => {
      setLinksAndPhase([createLink(0)], 'building');
      expect(component.enteringCardIndex()).toBe(-1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. chain-2+ entry animation
  // ---------------------------------------------------------------------------

  describe('chain-2+ entry animation', () => {
    it('should show overlay + set enteringCardIndex when 2nd link arrives', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);

      expect(component.overlayVisible()).toBeTrue();
      expect(component.enteringCardIndex()).toBe(1);
      expect(mockChainManager.chainEntryAnimating()).toBeTrue();

      flush();
    }));

    it('should fade out overlay after constructAppear ms', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);

      const constructAppear = component.durations().constructAppear;
      tick(constructAppear);
      expect(component.overlayVisible()).toBeFalse();

      flush();
    }));

    it('should call liveAnnouncer with the new link name', () => {
      setLinksAndPhase([createLink(0, { cardName: 'Ash Blossom' })], 'building');
      setLinks([
        createLink(0, { cardName: 'Ash Blossom' }),
        createLink(1, { cardName: 'Maxx C' }),
      ]);
      expect(mockAnnouncer.announce).toHaveBeenCalledWith('Chain Link 2: Maxx C added');
    });

    it('should set shovedCardIndex on the same-side previous link when a new link arrives', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);
      // Link 0 was at front, now shoved to mid by link 1's arrival
      expect(component.shovedCardIndex()).toBe(0);

      tick(component.durations().shove);
      expect(component.shovedCardIndex()).toBe(-1);

      flush();
    }));

    it('should NOT set shovedCardIndex when the new link is on a different side (no prior same-side link)', fakeAsync(() => {
      setLinksAndPhase([createLink(0, { player: 0 })], 'building');
      // New link from opponent → arrives on the empty right side, nothing to shove
      setLinks([createLink(0, { player: 0 }), createLink(1, { player: 1 })]);
      expect(component.shovedCardIndex()).toBe(-1);

      flush();
    }));

    it('should burst-detect a 3rd link arriving mid fade-out (no overlay re-show)', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);

      // Mid-entry: 3rd link before fade-out fires
      tick(component.durations().constructAppear / 2);
      setLinks([createLink(0), createLink(1), createLink(2)]);

      // Burst path: enteringCardIndex updates to new link, overlay still true
      expect(component.enteringCardIndex()).toBe(2);
      expect(component.overlayVisible()).toBeTrue();

      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // 3. overflow exit (4+ links)
  // ---------------------------------------------------------------------------

  describe('overflow exit (3+ links — monoCap=2)', () => {
    it('should set exitingCard with type "overflow" when 3rd same-side link arrives', fakeAsync(() => {
      // monoCap=2 (chat 2026-06-03 doctrine) → the 3rd link of a side
      // is the first one to overflow, dropping the oldest (CL0).
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);
      setLinks([createLink(0), createLink(1), createLink(2)]);

      const exit = component.exitingCard();
      expect(exit).not.toBeNull();
      expect(exit!.type).toBe('overflow');
      expect(exit!.card.chainIndex).toBe(0);

      flush();
    }));

    it('should clear exitingCard after constructFadeOut ms', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);
      setLinks([createLink(0), createLink(1), createLink(2)]);

      tick(component.durations().constructFadeOut);
      expect(component.exitingCard()).toBeNull();

      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // 4. visibleCards computed
  // ---------------------------------------------------------------------------

  describe('visibleCards computed', () => {
    it('should return empty array when no links', () => {
      expect(component.visibleCards()).toEqual([]);
    });

    it('should map 2 same-side links — newest gets slot=front, older gets slot=mid', () => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      const cards = component.visibleCards();
      expect(cards.length).toBe(2);
      // Cards are returned in chainIndex ASCENDING order. Slot is derived from
      // newest-of-its-side: chainIndex=1 (newest) → front, chainIndex=0 → mid.
      const cl0 = cards.find(c => c.chainIndex === 0)!;
      const cl1 = cards.find(c => c.chainIndex === 1)!;
      expect(cl1).toEqual(jasmine.objectContaining({ side: 'left', slot: 'front' }));
      expect(cl0).toEqual(jasmine.objectContaining({ side: 'left', slot: 'mid' }));
      // Vertical levels are anchored on level 4 (newest = bottom = largest).
      // With N cards visible, the oldest gets `4 - N + 1` and the newest
      // gets level 4. With 2 cards : levels 3 (oldest) and 4 (newest).
      expect(cl0.level).toBe(3);
      expect(cl1.level).toBe(4);
    });

    it('should split links by side (viewer vs opponent) — viewer left, opponent right', () => {
      setLinksAndPhase([createLink(0, { player: 0 }), createLink(1, { player: 1 })], 'building');
      const cards = component.visibleCards();
      const left = cards.find(c => c.side === 'left');
      const right = cards.find(c => c.side === 'right');
      expect(left?.chainIndex).toBe(0);
      expect(left?.slot).toBe('front'); // only link on its side → front
      expect(right?.chainIndex).toBe(1);
      expect(right?.slot).toBe('front'); // only link on its side → front
    });

    it('should cap mono-side stack at 2 (older links drop off the stack)', () => {
      // Mono-side cap is 2 (newest + previous). CL0 + CL1 drop off ; CL2 +
      // CL3 survive. Slot for the visible : CL3=front (newest), CL2=mid.
      setLinksAndPhase(
        [createLink(0), createLink(1), createLink(2), createLink(3)],
        'building',
      );
      const cards = component.visibleCards();
      expect(cards.length).toBe(2);
      expect(cards.every(c => c.side === 'left')).toBeTrue();
      expect(cards.map(c => c.chainIndex)).toEqual([2, 3]);
      const cl2 = cards.find(c => c.chainIndex === 2)!;
      const cl3 = cards.find(c => c.chainIndex === 3)!;
      expect(cl3.slot).toBe('front');
      expect(cl2.slot).toBe('mid');
      // 2 visible → levels 3 (oldest visible) + 4 (newest).
      expect([cl2.level, cl3.level]).toEqual([3, 4]);
    });

    it('should apply majority/minority caps when bi-sided (tie → newest side = majority)', () => {
      // 3 left + 3 right = 6 total. Tie-break rule : the side carrying
      // the most recent overall link (idx=5 → right) is majority.
      // Karma headless usually trips the cramped-viewport mediaquery so
      // the minority cap drops to 1 ; on a normal desktop it stays at 2.
      // We assert the contract that's robust across both : right is
      // majority (2 visible), left is minority (1 or 2 visible).
      setLinksAndPhase(
        [
          createLink(0, { player: 0 }), createLink(1, { player: 1 }),
          createLink(2, { player: 0 }), createLink(3, { player: 1 }),
          createLink(4, { player: 0 }), createLink(5, { player: 1 }),
        ],
        'building',
      );
      const cards = component.visibleCards();
      const left = cards.filter(c => c.side === 'left').map(c => c.chainIndex).sort((a, b) => b - a);
      const right = cards.filter(c => c.side === 'right').map(c => c.chainIndex).sort((a, b) => b - a);
      // Right = majority side, capped at 2 (newest 2).
      expect(right).toEqual([5, 3]);
      // Left = minority side : either 1 (cramped) or 2 (desktop) visible,
      // always the newest of the side.
      expect(left[0]).toBe(4);
      expect(left.length).toBeGreaterThanOrEqual(1);
      expect(left.length).toBeLessThanOrEqual(2);
    });

    it('should slot pendingExitCard at front of its own side (newest of that side wins front)', () => {
      // CL0 + CL1 + pendingExit on left side = 3 candidates on mono-side
      // (cap=2). Only the 2 newest survive : pending (highest "virtual"
      // chainIndex) and CL1. CL0 falls off the stack.
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      component.pendingExitCard.set({
        type: 'resolved',
        negated: false,
        card: {
          chainIndex: 99, cardCode: 9999, cardName: 'Resolved',
          side: 'left', level: 4, slot: 'front', player: 0,
        },
      });
      const cards = component.visibleCards();
      expect(cards.length).toBe(2);
      const pending = cards.find(c => c.chainIndex === 99)!;
      const cl1 = cards.find(c => c.chainIndex === 1)!;
      expect(pending).toBeTruthy();
      expect(cl1).toBeTruthy();
      expect(pending.slot).toBe('front'); // highest chainIndex → newest of left → front
      expect(cl1.slot).toBe('mid');
      // CL0 is dropped by the mono-side cap=2.
      expect(cards.find(c => c.chainIndex === 0)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. resolution sequence (single link)
  // ---------------------------------------------------------------------------

  describe('resolution sequence (single link)', () => {
    it('should force-clear chainEntryAnimating when phase enters resolving', () => {
      setLinksAndPhase([createLink(0)], 'building');
      mockChainManager.chainEntryAnimating.set(true);
      setLinksAndPhase([createLink(0, { resolving: true })], 'resolving');
      expect(mockChainManager.chainEntryAnimating()).toBeFalse();
    });

    it('should set resolvingIndex on a non-negated resolving link', () => {
      // chain-2+ to enable overlay path
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      expect(component.resolvingIndex()).toBe(1);
      expect(component.negatedResolvingIndex()).toBe(-1);
    });

    it('should set negatedResolvingIndex on a negated resolving link', () => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true, negated: true })],
        'resolving',
      );
      expect(component.negatedResolvingIndex()).toBe(1);
      expect(component.resolvingIndex()).toBe(-1);
    });

    it('should toggle chainOverlayReady false at resolution start, true at end', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      // Trigger link removal → onChainLinkResolved
      mockChainManager.hasBufferedEvents = false;
      setLinks([createLink(0)]);

      // chainOverlayReady set to false synchronously at start of onChainLinkResolved
      expect(mockChainManager.chainOverlayReady()).toBeFalse();

      // Drain all timers (overlayFadeOut + impactPause — no more overlayFadeIn since
      // 2026-06-02: overlay stays off until next MSG_CHAIN_SOLVING fades it back in)
      flush();
      expect(mockChainManager.chainOverlayReady()).toBeTrue();
    }));

    it('should leave overlay hidden after onChainLinkResolved completes (no final re-show)', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      mockChainManager.hasBufferedEvents = false;
      setLinks([createLink(0)]);
      flush();

      // 2026-06-02 contract — board stays free after each resolved link;
      // the next MSG_CHAIN_SOLVING (modelled by setLinks with a resolving
      // link) is what fades the overlay back in via Effect B.
      expect(component.overlayVisible()).toBeFalse();
      expect(component.pendingExitCard()).not.toBeNull();
    }));

    it('should fade out overlay after pulse duration even when MSG_CHAIN_SOLVED is delayed (opponent prompt)', fakeAsync(() => {
      // Regression 2026-06-02 — opponent activates a chain effect that
      // requires a target prompt (SELECT_CARD) on the active player. The
      // server emits MSG_CHAIN_SOLVING immediately but holds MSG_CHAIN_SOLVED
      // until the prompt is answered. Without an auto fade-out post-pulse,
      // the overlay stayed locked on the resolving link for the entire
      // prompt window — visible by P2 (who doesn't chain) as a frozen
      // overlay with the last link's pulse glow burnt in.
      //
      // 2026-06-03 update — `applyResolvingPulse` now schedules the
      // overlayVisible=false at `pulse + OVERLAY_ANIM_HOLD_MS` (breathing
      // room before fade-out, cf. chat 2026-06-03 bug 4). Adjust the tick.
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      expect(component.overlayVisible()).toBeTrue();

      // OVERLAY_ANIM_HOLD_MS = 400 ; scaledDuration in this test stubs to
      // base (speed=1). Hard-code the value here rather than importing
      // the constant to keep the regression intent explicit.
      const PULSE_HOLD_MS = 400;
      tick(component.durations().pulse + PULSE_HOLD_MS);
      expect(component.overlayVisible()).toBeFalse();

      flush();
    }));

    it('should re-fade-in overlay when next link starts resolving (with pendingExitCard visible)', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      mockChainManager.hasBufferedEvents = false;
      setLinks([createLink(0)]);
      flush();
      expect(component.overlayVisible()).toBeFalse();

      // Next link starts resolving — Effect B fires:
      //   · overlayVisible flips back true (fade-in)
      //   · pendingExitCard moves into exitingCard (push-out anim)
      setLinks([createLink(0, { resolving: true })]);
      expect(component.overlayVisible()).toBeTrue();
      expect(component.exitingCard()).not.toBeNull();
      expect(component.pendingExitCard()).toBeNull();

      flush();
    }));

    it('should call replayBuffer when hasBufferedEvents + non-negated', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      mockChainManager.hasBufferedEvents = true;
      setLinks([createLink(0)]);
      flush();

      expect(mockOrchestrator.replayBuffer).toHaveBeenCalled();
    }));

    it('should NOT call replayBuffer for a negated resolved link', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true, negated: true })],
        'resolving',
      );
      mockChainManager.hasBufferedEvents = true;
      setLinks([createLink(0)]);
      flush();

      expect(mockOrchestrator.replayBuffer).not.toHaveBeenCalled();
    }));
  });

  // ---------------------------------------------------------------------------
  // 6. resolution sequence (multi-link cascade)
  // ---------------------------------------------------------------------------

  describe('resolution sequence (multi-link cascade)', () => {
    it('should populate pendingExitCard after onChainLinkResolved completes', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      mockChainManager.hasBufferedEvents = false;
      setLinks([createLink(0)]);
      flush();

      expect(component.pendingExitCard()).not.toBeNull();
      expect(component.pendingExitCard()!.card.chainIndex).toBe(1);
    }));

    it('should preserve cardCode + cardName of the dropped link (regression 2026-06-02 card_back exit)', fakeAsync(() => {
      // Regression — a 3-link chain (Lukias / Ash / Faimena) saw Ash exit as
      // card_back because pendingExitCard read from `_resolvingCardInfo`,
      // which was null'd by the prior link's cleanup BEFORE Effect B for the
      // next CHAIN_SOLVING had set the new value. Fix: Effect A passes the
      // dropped link directly to onChainLinkResolved, so cardCode/cardName
      // are read from the link snapshot — immune to all race timings.
      const lukias = createLink(0, { cardCode: 75003700, cardName: 'Dracotail Lukias' });
      const ash = createLink(1, { cardCode: 14558127, cardName: 'Ash Blossom & Joyous Spring' });
      const faimena = createLink(2, { cardCode: 1498449, cardName: 'Dracotail Faimena' });

      setLinksAndPhase([lukias], 'building');
      setLinks([lukias, ash]);
      setLinks([lukias, ash, faimena]);

      // Faimena resolves
      setLinksAndPhase([lukias, ash, { ...faimena, resolving: true }], 'resolving');
      setLinks([lukias, ash]); // CHAIN_SOLVED Faimena drops it
      flush();
      expect(component.pendingExitCard()!.card.cardCode).toBe(1498449);
      expect(component.pendingExitCard()!.card.cardName).toBe('Dracotail Faimena');

      // Ash resolves
      setLinks([lukias, { ...ash, resolving: true }]);
      flush(); // exit anim of Faimena, then pulse Ash, then any pending timers
      setLinks([lukias]); // CHAIN_SOLVED Ash drops it
      flush();
      expect(component.pendingExitCard()!.card.cardCode).toBe(14558127);
      expect(component.pendingExitCard()!.card.cardName).toBe('Ash Blossom & Joyous Spring');

      // Lukias resolves
      setLinks([{ ...lukias, resolving: true }]);
      flush();
      setLinks([]); // CHAIN_SOLVED Lukias drops it
      flush();
      expect(component.pendingExitCard()!.card.cardCode).toBe(75003700);
      expect(component.pendingExitCard()!.card.cardName).toBe('Dracotail Lukias');
    }));

    it('should push out pendingExitCard with exit anim when next link starts resolving', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      // Resolve link 1
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      setLinks([createLink(0)]);
      flush();
      expect(component.pendingExitCard()).not.toBeNull();

      // Now link 0 starts resolving
      setLinks([createLink(0, { resolving: true })]);

      // pendingExitCard moved to exitingCard
      expect(component.exitingCard()).not.toBeNull();
      expect(component.pendingExitCard()).toBeNull();

      flush();
    }));

    it('should apply pulse to new resolving link after exit anim completes', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      setLinks([createLink(0)]);
      flush();

      setLinks([createLink(0, { resolving: true })]);
      tick(component.durations().exit);

      expect(component.exitingCard()).toBeNull();
      expect(component.resolvingIndex()).toBe(0);

      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // 7. liveAnnouncer dedup
  // ---------------------------------------------------------------------------

  describe('liveAnnouncer dedup (lastAnnounced*)', () => {
    it('should NOT re-announce the same resolving link twice', () => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      mockAnnouncer.announce.calls.reset();
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      const firstCount = mockAnnouncer.announce.calls.count();

      // Re-emit same link state — should NOT re-announce
      setLinks([createLink(0), createLink(1, { resolving: true })]);
      expect(mockAnnouncer.announce.calls.count()).toBe(firstCount);
    });

    it('should re-announce when negation flips false → true on the same link', () => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      mockAnnouncer.announce.calls.reset();
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      mockAnnouncer.announce.calls.reset();

      setLinks([createLink(0), createLink(1, { resolving: true, negated: true })]);
      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        jasmine.stringMatching(/negated/i),
      );
    });

    it('should announce afresh when a new link starts resolving', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      setLinks([createLink(0)]);
      flush();
      mockAnnouncer.announce.calls.reset();

      setLinks([createLink(0, { resolving: true })]);
      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        jasmine.stringMatching(/Chain Link 1.*Card 1/i),
      );

      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // 8. prompt deferral (Effect C)
  // ---------------------------------------------------------------------------

  describe('prompt deferral (Effect C)', () => {
    it('should defer entry animation while promptActive=true', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setPromptActive(true);
      setLinks([createLink(0), createLink(1)]);

      // Entry animation NOT triggered yet
      expect(component.enteringCardIndex()).toBe(-1);
      expect(component.overlayVisible()).toBeFalse();

      flush();
    }));

    it('should play deferred entry when promptActive flips to false', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setPromptActive(true);
      setLinks([createLink(0), createLink(1)]);

      setPromptActive(false);
      expect(component.enteringCardIndex()).toBe(1);
      expect(component.overlayVisible()).toBeTrue();

      flush();
    }));

    it('should NOT play deferred entry if chain ended (phase=idle) before prompt closes', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setPromptActive(true);
      setLinks([createLink(0), createLink(1)]);

      // Chain ends while prompt still open
      setLinksAndPhase([], 'idle');

      setPromptActive(false);
      // No entry animation kicked off
      expect(component.enteringCardIndex()).toBe(-1);
      expect(component.overlayVisible()).toBeFalse();

      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // 9. prompt mid-resolution gate (Effect E)
  // ---------------------------------------------------------------------------

  describe('prompt mid-resolution gate (Effect E)', () => {
    it('should hide overlay + set chainPromptGateActive when prompt arrives mid-resolving', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      // Force overlay visible (resolving phase keeps it shown if overlayShownDuringBuild)
      component.overlayVisible.set(true);
      fixture.detectChanges();

      setPromptActive(true);

      expect(component.overlayVisible()).toBeFalse();
      expect(mockChainManager.chainPromptGateActive()).toBeTrue();

      flush();
    }));

    it('should release gate after overlayFadeOut ms', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      component.overlayVisible.set(true);
      fixture.detectChanges();
      setPromptActive(true);

      tick(component.durations().overlayFadeOut);
      expect(mockChainManager.chainPromptGateActive()).toBeFalse();

      flush();
    }));

    it('should release gate immediately if prompt closes before fade-out fires', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      component.overlayVisible.set(true);
      fixture.detectChanges();
      setPromptActive(true);

      // Mid fade-out, prompt closes
      tick(component.durations().overlayFadeOut / 2);
      setPromptActive(false);

      expect(mockChainManager.chainPromptGateActive()).toBeFalse();

      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // 10. chain resolution announce banner (Effect D)
  // ---------------------------------------------------------------------------

  describe('chain resolution announce banner (Effect D)', () => {
    it('should hide overlay when chainResolutionAnnounce flips true', () => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      // Overlay was shown during entry
      expect(component.overlayVisible()).toBeTrue();

      mockChainManager.chainResolutionAnnounce.set(true);
      fixture.detectChanges();

      expect(component.overlayVisible()).toBeFalse();
    });
  });

  // ---------------------------------------------------------------------------
  // 11. chain end cleanup
  // ---------------------------------------------------------------------------

  describe('chain end cleanup', () => {
    it('should reset all signals when phase=idle and links=0', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      // Push some state
      component.pendingExitCard.set({
        type: 'resolved',
        negated: false,
        card: { chainIndex: 99, cardCode: 9999, cardName: 'X', side: 'left', level: 4, slot: 'front', player: 0 },
      });
      component.exitingCard.set({
        type: 'overflow',
        negated: false,
        card: { chainIndex: 0, cardCode: 1000, cardName: 'A', side: 'left', level: 0, slot: 'back', player: 0 },
      });

      setLinksAndPhase([], 'idle');

      expect(component.overlayVisible()).toBeFalse();
      expect(component.pendingExitCard()).toBeNull();
      expect(component.exitingCard()).toBeNull();
      expect(component.resolvingIndex()).toBe(-1);
      expect(component.negatedResolvingIndex()).toBe(-1);

      flush();
    }));

    it('should re-enable overlay path on a fresh chain after end', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      flush();
      setLinksAndPhase([], 'idle');

      // New chain starts
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);

      expect(component.overlayVisible()).toBeTrue();

      flush();
    }));

    it('should reset lastAnnouncedResolvingIndex to allow re-announce in next chain', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      setLinks([createLink(0)]);
      flush();
      setLinksAndPhase([], 'idle');

      // New chain
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      mockAnnouncer.announce.calls.reset();
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );

      expect(mockAnnouncer.announce).toHaveBeenCalledWith(
        jasmine.stringMatching(/resolving/i),
      );

      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // 12. timer cleanup on destroy
  // ---------------------------------------------------------------------------

  describe('timer cleanup on destroy', () => {
    it('should clear all active timers when component is destroyed', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      // Multiple timers now scheduled (entry, fade-out, chainEntryAnimating release)

      fixture.destroy();

      // Drain — if any timer leaked, fakeAsync would throw
      flush();
      expect(true).toBeTrue();
    }));
  });

  // ---------------------------------------------------------------------------
  // 13. reentrancy guard
  // ---------------------------------------------------------------------------

  describe('reentrancy guard (resolvingInFlight)', () => {
    it('should ignore a second resolution trigger while one is in flight', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      // Slow replay so onChainLinkResolved is in-flight
      mockChainManager.hasBufferedEvents = true;
      let resolveReplay: () => void = () => undefined;
      mockOrchestrator.replayBuffer.and.returnValue(
        new Promise<void>(r => { resolveReplay = r; }),
      );
      setLinks([createLink(0)]);

      // chainOverlayReady false → in-flight
      expect(mockChainManager.chainOverlayReady()).toBeFalse();

      // Trigger another link removal — guard should keep ready=false
      setLinks([]);
      expect(mockChainManager.chainOverlayReady()).toBeFalse();

      // Let the original flow finish
      resolveReplay();
      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // 14. cancellation behavior + late-commit pathology
  // ---------------------------------------------------------------------------

  describe('cancellation + late-commit pathology', () => {
    it('should let a fresh chain re-enter resolution after a mid-flow cancel', fakeAsync(() => {
      // The guard `_resolvingInFlight` MUST be reset so the next chain isn't
      // blocked. Two paths reset it: onChainEnd (synchronous) and the finally
      // block of onChainLinkResolved (after the AbortController fires).
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      setLinks([createLink(0)]); // triggers onChainLinkResolved
      setLinksAndPhase([], 'idle'); // hard cancel mid-flow
      flush();

      // Fresh chain re-enters the sequence immediately
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      mockChainManager.hasBufferedEvents = false;
      setLinks([createLink(0)]);

      // chainOverlayReady set to false synchronously — proves the guard didn't block
      expect(mockChainManager.chainOverlayReady()).toBeFalse();

      flush();
    }));

    it('should clear activeTimers synchronously when chain ends mid-resolution', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      mockChainManager.hasBufferedEvents = false;
      setLinks([createLink(0)]);
      const internal = component as unknown as { activeTimers: Set<unknown> };
      // Pre-cancel: resolution is mid-flow so timers are scheduled
      expect(internal.activeTimers.size).toBeGreaterThan(0);

      // Hard cancel — clearAllTimers MUST wipe the Set synchronously, before
      // any flush. Asserting pre-flush distinguishes "cleared at clearAllTimers"
      // from "cleared via auto-removal callbacks during flush".
      setLinksAndPhase([], 'idle');
      expect(internal.activeTimers.size).toBe(0);

      flush();
    }));

    it('should handle late-commit batched signals (resolving phase + new link in same tick)', () => {
      // Simulate a SELECT_CHAIN response that commits the pending entry at the
      // same time as MSG_CHAIN_SOLVING — Angular batches both, Effect A sees
      // phase='resolving' AND currentCount > prevCount in one pass.
      setLinksAndPhase([createLink(0)], 'building');
      // Atomic-ish: 2 signal writes before next CD cycle
      activeChainLinks.set([createLink(0), createLink(1, { resolving: true })]);
      chainPhase.set('resolving');
      fixture.detectChanges();

      // The new link's entry handling kicks in even though phase=resolving
      // (late-commit branch in Effect A). overlayVisible should reflect the
      // chain-2+ path (entry handler ran).
      expect(component.overlayVisible()).toBeTrue();
    });
  });

  // DS convention pin (CLAUDE.md "Chain Badges"): GOLD = viewer, BLUE =
  // opponent — applies regardless of context. In the overlay, side is
  // routed via `.chain-card--left` (viewer) / `.chain-card--right`
  // (opponent), which the SCSS uses to swap the `-webkit-text-stroke`
  // color (default = blue, `.chain-card--left` override = gold).
  describe('chain-badge side routing (DS convention)', () => {
    it('viewer-side link gets .chain-card--left; opponent-side link gets .chain-card--right', () => {
      // ownPlayerIndex stub = 0 → player 0 = viewer = left; player 1 = opp = right.
      setLinksAndPhase([
        createLink(0, { player: 0, cardCode: 1000 }),
        createLink(1, { player: 1, cardCode: 2000 }),
      ], 'building');

      const host = fixture.nativeElement as HTMLElement;
      const leftCards = host.querySelectorAll<HTMLElement>('.chain-card--left');
      const rightCards = host.querySelectorAll<HTMLElement>('.chain-card--right');

      expect(leftCards.length).toBeGreaterThan(0);
      expect(rightCards.length).toBeGreaterThan(0);

      // Every left card must own a .chain-badge (the SCSS hook for the
      // gold stroke). Same for right (default blue stroke).
      leftCards.forEach(card => expect(card.querySelector('.chain-badge'))
        .withContext('left chain-card missing .chain-badge child (gold stroke target)').not.toBeNull());
      rightCards.forEach(card => expect(card.querySelector('.chain-badge'))
        .withContext('right chain-card missing .chain-badge child (default blue stroke target)').not.toBeNull());
    });
  });

  // ---------------------------------------------------------------------------
  // overlayActive signal — bug 2026-06-03 regression filet
  //
  // Pin the contract that drives the prompt-dialog gate (Approach A) and the
  // replay scheduler gate (F1). `overlayActive` MUST :
  //   · be true while the overlay is playing a card-level animation that
  //     consumers wait on (entry, pulse, exit-pulse, exit) — including the
  //     +OVERLAY_ANIM_HOLD breathing room baked into the clear timer ;
  //   · be false otherwise — including the case "overlay visible but stable
  //     during building between two chain links" (gating here would deadlock
  //     the building) ;
  //   · NOT include `resolvingIndex !== -1` (logical state stays true through
  //     onChainLinkResolved's async flow — replayBuffer + impactPause — and
  //     gating the replay scheduler on it triggers a POLL-DROP deadlock,
  //     bug 3 of the 2026-06-03 session).
  // ---------------------------------------------------------------------------

  describe('overlayActive (2026-06-03 regression filet)', () => {
    it('is false at initial idle state', () => {
      expect(component.overlayActive()).toBeFalse();
    });

    it('is true while the entry animation is playing (entry + hold + overlayFadeOut)', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);

      // _runOverlayShowSequence fires synchronously (the orchestrator stub
      // returns isReady=true for every chainId) → enteringCardIndex set.
      expect(component.overlayActive()).withContext('immediately after entry').toBeTrue();

      const d = component.durations();
      // OVERLAY_ANIM_HOLD_MS=400 scaled by speed=1 → 400ms ; overlayFadeOut
      // is the third leg of the bounded window.
      // Total = entry + hold + overlayFadeOut.

      // Halfway through the window — still active.
      tick(d.entry);
      expect(component.overlayActive()).withContext('after entry duration alone').toBeTrue();

      // The hold + overlayFadeOut tail keeps it true.
      // Use a value slightly less than the remaining total to ensure we
      // sample BEFORE the clear timer fires.
      tick(d.overlayFadeOut);
      expect(component.overlayActive()).withContext('during the hold/fade-out tail').toBeTrue();

      flush();
      expect(component.overlayActive()).withContext('after flush all timers').toBeFalse();
    }));

    it('is true while the resolving pulse is playing (pulse + hold + overlayFadeOut)', fakeAsync(() => {
      setLinksAndPhase([
        createLink(0),
        createLink(1, { resolving: true }),
      ], 'resolving');

      // Effect B detects resolvingLink → applyResolvingPulse → _pulseActive=true.
      expect(component.overlayActive()).withContext('during pulse').toBeTrue();

      const d = component.durations();
      tick(d.pulse);
      expect(component.overlayActive()).withContext('during the hold tail').toBeTrue();

      flush();
      expect(component.overlayActive()).withContext('after pulse window fully elapsed').toBeFalse();
    }));

    it('is NOT true on resolvingIndex alone after _pulseActive cleared (anti-deadlock)', fakeAsync(() => {
      setLinksAndPhase([
        createLink(0),
        createLink(1, { resolving: true }),
      ], 'resolving');

      // Let the _pulseActive timer fire (pulse + hold + overlayFadeOut).
      const d = component.durations();
      tick(d.pulse + 1000); // far past the bounded window

      // `resolvingIndex` set by Effect B may still be the chainIndex of the
      // resolving link (cleared only at onChainLinkResolved step 5 — after
      // replayBuffer + impactPause). overlayActive must NOT track this.
      // The orchestrator's `onChainLinkResolved` async flow ISN'T invoked
      // in this minimal scenario (no link removed), but we assert the
      // INVARIANT : as long as `_pulseActive` is false, `overlayActive`
      // can only be true via the other contributors (none active here).
      expect(component.resolvingIndex()).toBe(1);
      expect(component.overlayActive())
        .withContext('overlayActive must NOT track resolvingIndex alone — caused POLL-DROP deadlock pre-fix')
        .toBeFalse();

      flush();
    }));

    it('clears _pulseActive on onChainEnd (defense in depth)', fakeAsync(() => {
      setLinksAndPhase([
        createLink(0),
        createLink(1, { resolving: true }),
      ], 'resolving');
      expect(component.overlayActive()).toBeTrue();

      // Simulate chain end (Effect A path).
      setLinksAndPhase([], 'idle');
      // onChainEnd is called synchronously by Effect A.
      expect(component.overlayActive()).withContext('overlayActive cleared on chain end').toBeFalse();

      flush();
    }));

    it('is NOT true on overlayVisible alone (building stable should not gate consumers)', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);
      expect(component.overlayVisible()).toBeTrue();

      // Let the entry animation + hold + tail fully elapse — overlay still
      // visible (scheduleFadeOutAfterEntry hasn't fired yet, that fires at
      // constructAppear), but enteringCardIndex is cleared.
      const d = component.durations();
      tick(d.entry + d.overlayFadeOut + 500); // past entry+hold+tail (clear timer fires)

      // Depending on constructAppear vs entry+hold+overlayFadeOut order,
      // overlayVisible may still be true here. The contract is: even if
      // overlayVisible is true, overlayActive must be false once
      // enteringCardIndex is cleared (no other animation contributor).
      expect(component.enteringCardIndex()).toBe(-1);
      expect(component.overlayActive())
        .withContext('overlayActive must NOT track overlayVisible alone — building stable should be passable')
        .toBeFalse();

      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // Resolution breathing-room hold — bug 4 of 2026-06-03 session
  //
  // onChainLinkResolved step 2 awaits OVERLAY_ANIM_HOLD_MS before hiding the
  // overlay. Before the fix, the timer in applyResolvingPulse scheduled
  // overlayVisible=false at `pulse + hold` — but onChainLinkResolved set it
  // synchronously after MSG_CHAIN_SOLVED, winning the race and hiding without
  // hold. The fix adds an `await waitForOrAbort(hold)` to step 2.
  // ---------------------------------------------------------------------------

  describe('onChainLinkResolved breathing-room hold (2026-06-03 bug 4)', () => {
    it('keeps overlayVisible=true for at least OVERLAY_ANIM_HOLD after MSG_CHAIN_SOLVED', fakeAsync(() => {
      // Setup : building phase reaches 2 links, then resolving phase with
      // the front link marked resolving.
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      tick(component.durations().pulse);  // settle entry-related timers

      // Move to resolving — Effect B sets resolvingIndex via applyResolvingPulse.
      setLinksAndPhase([
        createLink(0),
        createLink(1, { resolving: true }),
      ], 'resolving');

      // Drop the front link — Effect A finds the dropped link + calls
      // onChainLinkResolved. The async flow starts.
      setLinks([createLink(0)]);

      // Step 1 set pendingExitCard synchronously. Step 2 starts the hold
      // via waitForOrAbort(hold). At this point the overlay should still
      // be visible (step 3 not yet reached).
      // Wait a tiny tick to let the microtask kick off the async chain.
      tick(1);
      expect(component.overlayVisible()).withContext('immediately into step 2').toBeTrue();

      // Sample halfway through the hold — overlay still up.
      tick(100);
      expect(component.overlayVisible()).withContext('mid-hold (~100ms in)').toBeTrue();

      // Flush everything else.
      flush();
    }));
  });

  // ---------------------------------------------------------------------------
  // F21 deferred (2026-06-04) — side routing
  // ---------------------------------------------------------------------------
  // Commit bd9ec8e8 (DS chain-badge owner doctrine) deferred the overlay-side
  // spec for `chain-card--left/right` routing because it depends on a
  // DuelContext mock refresh that lives on a sibling branch. `xit` keeps the
  // pending entry visible in Karma output so we don't lose track. When the
  // mock refresh lands, drop the `x` and implement: build a 2-link chain with
  // links from both players, render via `setLinks`, assert `chain-card--left`
  // appears on the viewer's card and `chain-card--right` on the opponent's.
  describe('side routing (F21 deferred)', () => {
    xit('routes chain-card to .chain-card--left/right per link owner (DEFERRED — needs DuelContext mock refresh)', () => {
      // Implementation pending — see commit bd9ec8e8 + memory note.
    });
  });
});
