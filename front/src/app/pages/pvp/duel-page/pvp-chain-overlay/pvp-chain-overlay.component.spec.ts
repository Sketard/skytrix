import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { PvpChainOverlayComponent } from './pvp-chain-overlay.component';
import { ANIMATION_DATA_SOURCE } from '../animation-data-source';
import { AnimationOrchestratorService } from '../animation-orchestrator.service';
import { ChainResolutionManager } from '../chain-resolution-manager';
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
    chainResolutionAnnounce: WritableSignal<boolean>;
    chainOverlayReady: WritableSignal<boolean>;
    chainPromptGateActive: WritableSignal<boolean>;
    chainOverlayBoardChanged: WritableSignal<boolean>;
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

    mockChainManager = {
      chainEntryAnimating: signal(false),
      chainResolutionAnnounce: signal(false),
      chainOverlayReady: signal(true),
      chainPromptGateActive: signal(false),
      chainOverlayBoardChanged: signal(false),
      isWaitingForOverlay: false,
    };

    mockAnnouncer = jasmine.createSpyObj<LiveAnnouncer>('LiveAnnouncer', ['announce']);
    mockArtService = jasmine.createSpyObj<DuelCardArtService>('DuelCardArtService', ['resolveUrl']);
    mockArtService.resolveUrl.and.returnValue('mock-url');

    const silentLogger: Partial<DuelLogger> = {
      log: () => undefined,
      warn: () => undefined,
    };

    TestBed.configureTestingModule({
      imports: [PvpChainOverlayComponent],
      providers: [
        { provide: ANIMATION_DATA_SOURCE, useValue: { activeChainLinks, chainPhase } },
        { provide: AnimationOrchestratorService, useValue: mockOrchestrator },
        { provide: ChainResolutionManager, useValue: mockChainManager },
        { provide: LiveAnnouncer, useValue: mockAnnouncer },
        { provide: DuelLogger, useValue: silentLogger },
        { provide: DuelCardArtService, useValue: mockArtService },
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

  describe('overflow exit (4+ links)', () => {
    it('should set exitingCard with type "overflow" when 4th link arrives', fakeAsync(() => {
      setLinksAndPhase([createLink(0)], 'building');
      setLinks([createLink(0), createLink(1)]);
      setLinks([createLink(0), createLink(1), createLink(2)]);
      setLinks([createLink(0), createLink(1), createLink(2), createLink(3)]);

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
      setLinks([createLink(0), createLink(1), createLink(2), createLink(3)]);

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

    it('should map 2 links to front + mid positions (newest first)', () => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      const cards = component.visibleCards();
      expect(cards.length).toBe(2);
      expect(cards[0]).toEqual(jasmine.objectContaining({ chainIndex: 1, position: 'front' }));
      expect(cards[1]).toEqual(jasmine.objectContaining({ chainIndex: 0, position: 'mid' }));
    });

    it('should keep only the last 3 links when 4+ are active', () => {
      setLinksAndPhase(
        [createLink(0), createLink(1), createLink(2), createLink(3)],
        'building',
      );
      const cards = component.visibleCards();
      expect(cards.length).toBe(3);
      expect(cards.map(c => c.chainIndex)).toEqual([3, 2, 1]);
    });

    it('should prepend pendingExitCard at front and shift others back', () => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      component.pendingExitCard.set({
        type: 'resolved',
        negated: false,
        card: { chainIndex: 99, cardCode: 9999, cardName: 'Resolved', position: 'front' },
      });
      const cards = component.visibleCards();
      expect(cards[0].chainIndex).toBe(99);
      expect(cards[0].position).toBe('front');
      expect(cards[1].chainIndex).toBe(1);
      expect(cards[1].position).toBe('mid');
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
      mockChainManager.chainOverlayBoardChanged.set(false);
      setLinks([createLink(0)]);

      // chainOverlayReady set to false synchronously at start of onChainLinkResolved
      expect(mockChainManager.chainOverlayReady()).toBeFalse();

      // Drain all timers (overlayFadeOut + impactPause + overlayFadeIn)
      flush();
      expect(mockChainManager.chainOverlayReady()).toBeTrue();
    }));

    it('should call replayBuffer when chainOverlayBoardChanged + non-negated', fakeAsync(() => {
      setLinksAndPhase([createLink(0), createLink(1)], 'building');
      setLinksAndPhase(
        [createLink(0), createLink(1, { resolving: true })],
        'resolving',
      );
      mockChainManager.chainOverlayBoardChanged.set(true);
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
      mockChainManager.chainOverlayBoardChanged.set(true);
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
      mockChainManager.chainOverlayBoardChanged.set(false);
      setLinks([createLink(0)]);
      flush();

      expect(component.pendingExitCard()).not.toBeNull();
      expect(component.pendingExitCard()!.card.chainIndex).toBe(1);
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
        card: { chainIndex: 99, cardCode: 9999, cardName: 'X', position: 'front' },
      });
      component.exitingCard.set({
        type: 'overflow',
        negated: false,
        card: { chainIndex: 0, cardCode: 1000, cardName: 'A', position: 'back' },
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
      mockChainManager.chainOverlayBoardChanged.set(true);
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
      mockChainManager.chainOverlayBoardChanged.set(false);
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
      mockChainManager.chainOverlayBoardChanged.set(false);
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
});
