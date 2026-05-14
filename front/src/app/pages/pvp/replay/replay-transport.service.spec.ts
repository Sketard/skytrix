import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ReplayTransportService } from './replay-transport.service';
import type { ReplayDuelAdapter } from './replay-duel-adapter';
import type { PhaseAnnouncementService } from '../duel-page/phase-announcement.service';
import type { PreComputedState, TurnMeta } from '../replay-ws.types';
import { EMPTY_DUEL_STATE } from '../types';

// =============================================================================
// Test fixture: stub adapter / phase service / upstream signals
// =============================================================================

interface AdapterStub {
  jumpToState: jasmine.Spy;
  feedTransition: jasmine.Spy;
  feedTransitionPhased: jasmine.Spy;
  abort: jasmine.Spy;
  resumeAfterPrompt: jasmine.Spy;
  busy: jasmine.Spy;
  activePrompt: jasmine.Spy;
  activeTimestamp: jasmine.Spy;
}

interface PhaseStub {
  announcement: jasmine.Spy;
}

function makeAdapter(): AdapterStub {
  return jasmine.createSpyObj<AdapterStub>('ReplayDuelAdapter', [
    'jumpToState', 'feedTransition', 'feedTransitionPhased', 'abort',
    'resumeAfterPrompt', 'busy', 'activePrompt', 'activeTimestamp',
  ]);
}

function makePhase(): PhaseStub {
  const stub = jasmine.createSpyObj<PhaseStub>('PhaseAnnouncementService', ['announcement']);
  stub.announcement.and.returnValue(null);
  return stub;
}

const stubState = (label: string, responseCount = 0): PreComputedState => ({
  boardState: EMPTY_DUEL_STATE,
  events: [],
  label,
  responseCount,
});

interface Setup {
  svc: ReplayTransportService;
  adapter: AdapterStub;
  phase: PhaseStub;
  boardStates: ReturnType<typeof signal<PreComputedState[]>>;
  computedUpTo: ReturnType<typeof signal<number>>;
  animationsEnabled: ReturnType<typeof signal<boolean>>;
  promptMode: ReturnType<typeof signal<'result' | 'decision'>>;
}

function setup(opts: {
  states?: PreComputedState[];
  computedUpTo?: number;
  animationsEnabled?: boolean;
  promptMode?: 'result' | 'decision';
} = {}): Setup {
  TestBed.configureTestingModule({ providers: [ReplayTransportService] });
  const svc = TestBed.inject(ReplayTransportService);
  const adapter = makeAdapter();
  const phase = makePhase();
  adapter.busy.and.returnValue(false);
  adapter.activePrompt.and.returnValue(null);
  adapter.activeTimestamp.and.returnValue(null);
  const boardStates = signal<PreComputedState[]>(opts.states ?? []);
  const computedUpTo = signal<number>(opts.computedUpTo ?? -1);
  const animationsEnabled = signal<boolean>(opts.animationsEnabled ?? true);
  const promptMode = signal<'result' | 'decision'>(opts.promptMode ?? 'result');
  svc.configure({
    adapter: adapter as unknown as ReplayDuelAdapter,
    phaseService: phase as unknown as PhaseAnnouncementService,
    boardStates,
    computedUpTo,
    animationsEnabled,
    promptMode,
  });
  return { svc, adapter, phase, boardStates, computedUpTo, animationsEnabled, promptMode };
}

// =============================================================================
// Initial state + configure contract
// =============================================================================

describe('ReplayTransportService — initial state', () => {
  it('exposes default signal values: currentIndex=0, isPlaying=false, pausedAtBoundary=false', () => {
    const { svc } = setup();
    expect(svc.currentIndex()).toBe(0);
    expect(svc.isPlaying()).toBeFalse();
    expect(svc.pausedAtBoundary()).toBeFalse();
  });

  it('throws "configure() not called" when methods are invoked pre-configure', () => {
    TestBed.configureTestingModule({ providers: [ReplayTransportService] });
    const svc = TestBed.inject(ReplayTransportService);
    expect(() => svc.seek(0)).toThrowError(/configure\(\) not called/);
  });
});

// =============================================================================
// seek / scrub / skipStart / skipEnd
// =============================================================================

describe('ReplayTransportService — seek/scrub/skipStart/skipEnd', () => {
  it('seek(idx): pauses + sets currentIndex + jumpToState', () => {
    const { svc, adapter, boardStates, computedUpTo } = setup({
      states: [stubState('s0'), stubState('s1'), stubState('s2')],
      computedUpTo: 2,
    });
    svc.isPlaying.set(true); // simulate active playback
    svc.seek(2);
    expect(svc.isPlaying()).toBeFalse();
    expect(svc.currentIndex()).toBe(2);
    expect(adapter.jumpToState).toHaveBeenCalledWith(boardStates()[2]);
    void computedUpTo;
  });

  it('scrub(idx): identical behavior to seek (alias contract)', () => {
    const { svc, adapter, boardStates } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    svc.scrub(1);
    expect(svc.currentIndex()).toBe(1);
    expect(adapter.jumpToState).toHaveBeenCalledWith(boardStates()[1]);
  });

  it('skipStart: jumps to index 0 + jumpToState', () => {
    const { svc, adapter, boardStates } = setup({
      states: [stubState('s0'), stubState('s1'), stubState('s2')],
      computedUpTo: 2,
    });
    svc.currentIndex.set(2);
    svc.skipStart();
    expect(svc.currentIndex()).toBe(0);
    expect(adapter.jumpToState).toHaveBeenCalledWith(boardStates()[0]);
  });

  it('skipEnd: jumps to computedUpTo + jumpToState', () => {
    const { svc, adapter, boardStates } = setup({
      states: [stubState('s0'), stubState('s1'), stubState('s2')],
      computedUpTo: 2,
    });
    svc.skipEnd();
    expect(svc.currentIndex()).toBe(2);
    expect(adapter.jumpToState).toHaveBeenCalledWith(boardStates()[2]);
  });
});

// =============================================================================
// stepForward / stepBack
// =============================================================================

describe('ReplayTransportService — stepForward/stepBack', () => {
  it('stepForward (animations on, result mode): currentIndex++ + feedTransition', () => {
    const { svc, adapter } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
      animationsEnabled: true,
      promptMode: 'result',
    });
    svc.stepForward();
    expect(svc.currentIndex()).toBe(1);
    expect(adapter.feedTransition).toHaveBeenCalled();
    expect(adapter.feedTransitionPhased).not.toHaveBeenCalled();
  });

  it('stepForward (decision promptMode): uses feedTransitionPhased', () => {
    const { svc, adapter } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
      animationsEnabled: true,
      promptMode: 'decision',
    });
    svc.stepForward();
    expect(adapter.feedTransitionPhased).toHaveBeenCalled();
    expect(adapter.feedTransition).not.toHaveBeenCalled();
  });

  it('stepForward (animations off): jumpToState + auto-schedule next via timer', fakeAsync(() => {
    const { svc, adapter } = setup({
      states: [stubState('s0'), stubState('s1'), stubState('s2')],
      computedUpTo: 2,
      animationsEnabled: false,
    });
    svc.stepForward();
    expect(svc.currentIndex()).toBe(1);
    expect(adapter.jumpToState).toHaveBeenCalled();
    // No-animation path: scheduleNext via setTimeout (PLAYBACK_INTERVAL=500).
    // Drain pending timer to verify cleanup.
    tick(500);
  }));

  it('stepForward beyond computedUpTo: no-op (no feed call)', () => {
    const { svc, adapter } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    svc.currentIndex.set(1); // already at end
    svc.stepForward();
    expect(svc.currentIndex()).toBe(1);
    expect(adapter.feedTransition).not.toHaveBeenCalled();
    expect(adapter.feedTransitionPhased).not.toHaveBeenCalled();
  });

  it('stepBack: currentIndex-- + jumpToState', () => {
    const { svc, adapter, boardStates } = setup({
      states: [stubState('s0'), stubState('s1'), stubState('s2')],
      computedUpTo: 2,
    });
    svc.currentIndex.set(2);
    svc.stepBack();
    expect(svc.currentIndex()).toBe(1);
    expect(adapter.jumpToState).toHaveBeenCalledWith(boardStates()[1]);
  });

  it('stepBack at index 0: no-op (no jump, currentIndex stays 0)', () => {
    const { svc, adapter } = setup({
      states: [stubState('s0')],
      computedUpTo: 0,
    });
    svc.stepBack();
    expect(svc.currentIndex()).toBe(0);
    expect(adapter.jumpToState).not.toHaveBeenCalled();
  });
});

// =============================================================================
// togglePlay + atEnd
// =============================================================================

describe('ReplayTransportService — togglePlay / atEnd', () => {
  it('togglePlay starts playback when stopped + states available', () => {
    const { svc } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    svc.togglePlay();
    expect(svc.isPlaying()).toBeTrue();
  });

  it('togglePlay: when isPlaying=true, pauses + clears pausedAtBoundary', () => {
    const { svc } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    svc.isPlaying.set(true);
    svc.pausedAtBoundary.set(true);
    svc.togglePlay();
    expect(svc.isPlaying()).toBeFalse();
    expect(svc.pausedAtBoundary()).toBeFalse();
  });

  it('togglePlay at atEnd: no-op (does not start)', () => {
    const { svc } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    svc.currentIndex.set(1);
    svc.togglePlay();
    expect(svc.isPlaying()).toBeFalse();
  });

  it('atEnd is true when currentIndex >= computedUpTo (with computedUpTo > 0)', () => {
    const { svc } = setup({
      states: [stubState('s0'), stubState('s1'), stubState('s2')],
      computedUpTo: 2,
    });
    expect(svc.atEnd()).toBeFalse();
    svc.currentIndex.set(2);
    expect(svc.atEnd()).toBeTrue();
    svc.currentIndex.set(3); // past end
    expect(svc.atEnd()).toBeTrue();
  });

  it('atEnd is false when computedUpTo=0 (single state, atEnd guard)', () => {
    // The guard `upTo > 0` prevents atEnd from firing on a single-state replay
    // before any progress has been made. Documented behavior of atEnd().
    const { svc } = setup({
      states: [stubState('s0')],
      computedUpTo: 0,
    });
    expect(svc.atEnd()).toBeFalse();
  });
});

// =============================================================================
// maybeAdvance (auto-play step decision)
// =============================================================================

describe('ReplayTransportService — maybeAdvance', () => {
  it('no-op when not playing', () => {
    const { svc, adapter } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    svc.maybeAdvance();
    expect(adapter.feedTransition).not.toHaveBeenCalled();
    expect(adapter.feedTransitionPhased).not.toHaveBeenCalled();
  });

  it('with activePrompt: schedules prompt dismiss (setTimeout → resumeAfterPrompt)', fakeAsync(() => {
    const { svc, adapter } = setup({
      states: [stubState('s0', 1), stubState('s1', 2)],
      computedUpTo: 1,
    });
    adapter.activePrompt.and.returnValue({ type: 'SELECT_YESNO' } as never);
    svc.isPlaying.set(true);
    svc.maybeAdvance();
    // PROMPT_DISPLAY_FALLBACK = 1500ms when no timestamp delta available.
    tick(1500);
    expect(adapter.resumeAfterPrompt).toHaveBeenCalled();
  }));

  it('with phase announcement playing: no advance until announcement clears', () => {
    const { svc, adapter, phase } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    phase.announcement.and.returnValue({ kind: 'turn-start' } as never);
    svc.isPlaying.set(true);
    svc.maybeAdvance();
    expect(adapter.feedTransition).not.toHaveBeenCalled();
  });
});

// =============================================================================
// resumeIfBoundaryWaiting
// =============================================================================

describe('ReplayTransportService — resumeIfBoundaryWaiting', () => {
  it('returns false + no-op when not pausedAtBoundary', () => {
    const { svc } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    expect(svc.resumeIfBoundaryWaiting()).toBeFalse();
    expect(svc.isPlaying()).toBeFalse();
  });

  it('returns false when computedUpTo has not advanced past currentIndex', () => {
    const { svc } = setup({
      states: [stubState('s0'), stubState('s1')],
      computedUpTo: 1,
    });
    svc.pausedAtBoundary.set(true);
    svc.currentIndex.set(1);
    // computedUpTo (1) === currentIndex (1) → no progress
    expect(svc.resumeIfBoundaryWaiting()).toBeFalse();
    expect(svc.isPlaying()).toBeFalse();
  });

  it('returns true + starts playback when more states arrived', () => {
    const { svc, computedUpTo } = setup({
      states: [stubState('s0'), stubState('s1'), stubState('s2')],
      computedUpTo: 1,
    });
    svc.pausedAtBoundary.set(true);
    svc.currentIndex.set(1);
    computedUpTo.set(2);
    expect(svc.resumeIfBoundaryWaiting()).toBeTrue();
    expect(svc.isPlaying()).toBeTrue();
    expect(svc.pausedAtBoundary()).toBeFalse();
  });
});

// =============================================================================
// destroy / haltPlaybackTimer
// =============================================================================

describe('ReplayTransportService — destroy', () => {
  it('destroy clears the pending playback timer (no fire after destroy)', fakeAsync(() => {
    const { svc, adapter } = setup({
      states: [stubState('s0'), stubState('s1'), stubState('s2')],
      computedUpTo: 2,
      animationsEnabled: false, // forces setTimeout path
    });
    svc.stepForward();
    // A timer is now pending (PLAYBACK_INTERVAL=500). Destroy should clear it.
    svc.destroy();
    tick(500);
    // jumpToState was called once (during stepForward), but not a second
    // time via the cleared timer.
    expect(adapter.jumpToState).toHaveBeenCalledTimes(1);
  }));
});

// =============================================================================
// seekToTurn (F2 — mobile stepper / turn-picker)
// =============================================================================

describe('ReplayTransportService — seekToTurn', () => {
  const turns: TurnMeta[] = [
    { turnNumber: 0, startIndex: 0, endIndex: 2, p1LP: 8000, p2LP: 8000, eventCount: 3 },
    { turnNumber: 1, startIndex: 3, endIndex: 5, p1LP: 8000, p2LP: 8000, eventCount: 3 },
    { turnNumber: 2, startIndex: 6, endIndex: 8, p1LP: 8000, p2LP: 8000, eventCount: 3 },
  ];

  it('delegates to seek(turn.startIndex) when the target turn is computed', () => {
    const { svc, adapter, boardStates } = setup({
      states: Array.from({ length: 9 }, (_, i) => stubState(`s${i}`)),
      computedUpTo: 8,
    });
    svc.seekToTurn(2, turns);
    expect(svc.currentIndex()).toBe(6);
    expect(adapter.jumpToState).toHaveBeenCalledWith(boardStates()[6]);
  });

  it('no-ops when turnIndex is out of bounds (negative)', () => {
    const { svc, adapter } = setup({
      states: Array.from({ length: 9 }, (_, i) => stubState(`s${i}`)),
      computedUpTo: 8,
    });
    svc.seekToTurn(-1, turns);
    expect(svc.currentIndex()).toBe(0);
    expect(adapter.jumpToState).not.toHaveBeenCalled();
  });

  it('no-ops when turnIndex is out of bounds (past end)', () => {
    const { svc, adapter } = setup({
      states: Array.from({ length: 9 }, (_, i) => stubState(`s${i}`)),
      computedUpTo: 8,
    });
    svc.seekToTurn(5, turns);
    expect(svc.currentIndex()).toBe(0);
    expect(adapter.jumpToState).not.toHaveBeenCalled();
  });

  it('refuses to seek to a turn whose startIndex is past computedUpTo', () => {
    const { svc, adapter } = setup({
      states: Array.from({ length: 9 }, (_, i) => stubState(`s${i}`)),
      // Only turns 0 + 1 are computed; turn 2 starts at index 6 which is past computedUpTo=5
      computedUpTo: 5,
    });
    svc.seekToTurn(2, turns);
    expect(svc.currentIndex()).toBe(0);
    expect(adapter.jumpToState).not.toHaveBeenCalled();
  });

  it('pauses playback when seeking (inherits the seek() contract)', () => {
    const { svc } = setup({
      states: Array.from({ length: 9 }, (_, i) => stubState(`s${i}`)),
      computedUpTo: 8,
    });
    svc.isPlaying.set(true);
    svc.seekToTurn(1, turns);
    expect(svc.isPlaying()).toBeFalse();
  });
});
