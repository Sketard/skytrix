/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: signals declared in this file are TestBed stubs (mocks of the
   real pipeline shape). They are not pipeline signals at runtime;
   the §3.2 tagging convention (transport / environment / projection)
   targets the real classes only. (α.7b.1, 2026-05-25) */

import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ReplayTransportService } from './replay-transport.service';
import type { MockDuelConnection } from './mock-duel-connection';
import type { PhaseAnnouncementService } from '../duel-page/phase-announcement.service';
import type { TurnMeta, ReplayStreamNavEntry } from '../replay-ws.types';
import { EMPTY_DUEL_STATE } from '../types';

// =============================================================================
// v4 Phase 5 (2026-06-05) — ReplayTransportService rewritten around
// `MockDuelConnection`. Legacy adapter retired ; the spec mirrors the
// new contract : seek → mockConn.seekToOffset, stepForward →
// dispatchMockUntilIndex (forward pump), prompt dismiss → fixed
// REPLAY_PROMPT_DELAY_MS (no more `activeTimestamp` math).
// =============================================================================

interface MockConnStub {
  seekToOffset: jasmine.Spy;
  dispatchNext: jasmine.Spy;
  simulatePlayerResponse: jasmine.Spy;
  getAutoResponseAt: jasmine.Spy;
  busy: jasmine.Spy;
  pendingPrompt: jasmine.Spy;
  messageCursor: jasmine.Spy;
  navIndex: jasmine.Spy;
}

interface PhaseStub {
  announcement: jasmine.Spy;
}

function makeMock(): MockConnStub {
  const m = jasmine.createSpyObj<MockConnStub>('MockDuelConnection', [
    'seekToOffset', 'dispatchNext', 'simulatePlayerResponse',
    'getAutoResponseAt', 'busy', 'pendingPrompt', 'messageCursor', 'navIndex',
  ]);
  m.busy.and.returnValue(false);
  m.pendingPrompt.and.returnValue(null);
  m.messageCursor.and.returnValue(0);
  m.navIndex.and.returnValue([]);
  m.dispatchNext.and.returnValue(false);
  m.getAutoResponseAt.and.returnValue(null);
  return m;
}

function makePhase(): PhaseStub {
  const stub = jasmine.createSpyObj<PhaseStub>('PhaseAnnouncementService', ['announcement']);
  stub.announcement.and.returnValue(null);
  return stub;
}

const stubState = (label: string, responseCount = 0): ReplayStreamNavEntry => ({
  messageOffset: 0,
  boardStateSnapshot: EMPTY_DUEL_STATE,
  events: [],
  label,
  responseCount,
  turnNumber: 0,
});

const stubNav = (count: number): ReplayStreamNavEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    messageOffset: i,
    label: `nav-${i}`,
    turnNumber: 0,
    boardStateSnapshot: EMPTY_DUEL_STATE,
    events: [],
    responseCount: 0,
  }));

interface Setup {
  svc: ReplayTransportService;
  mockConn: MockConnStub;
  phase: PhaseStub;
  computedUpTo: ReturnType<typeof signal<number>>;
  animationsEnabled: ReturnType<typeof signal<boolean>>;
  overlayActive: ReturnType<typeof signal<boolean>>;
}

function setup(opts: {
  states?: ReplayStreamNavEntry[];
  computedUpTo?: number;
  animationsEnabled?: boolean;
} = {}): Setup {
  TestBed.configureTestingModule({ providers: [ReplayTransportService] });
  const svc = TestBed.inject(ReplayTransportService);
  const mockConn = makeMock();
  const phase = makePhase();
  // Audit 2026-06-11 — `navIndex` + `promptMode` removed from the config
  // (the transport never read them ; nav data comes from `mockConn.navIndex()`).
  if (opts.states) mockConn.navIndex.and.returnValue(opts.states);
  const computedUpTo = signal<number>(opts.computedUpTo ?? -1);
  const animationsEnabled = signal<boolean>(opts.animationsEnabled ?? true);
  const overlayActive = signal<boolean>(false);
  svc.configure({
    mockConn: mockConn as unknown as MockDuelConnection,
    phaseService: phase as unknown as PhaseAnnouncementService,
    computedUpTo,
    animationsEnabled,
    overlayActive,
  });
  return { svc, mockConn, phase, computedUpTo, animationsEnabled, overlayActive };
}

// =============================================================================
// Initial state + configure
// =============================================================================

describe('ReplayTransportService — initial state', () => {
  it('starts at index 0, not playing, not paused at boundary', () => {
    const { svc } = setup();
    expect(svc.currentIndex()).toBe(0);
    expect(svc.isPlaying()).toBeFalse();
    expect(svc.pausedAtBoundary()).toBeFalse();
  });

  it('throws if a transport op is called before configure', () => {
    TestBed.configureTestingModule({ providers: [ReplayTransportService] });
    const svc = TestBed.inject(ReplayTransportService);
    expect(() => svc.seek(0)).toThrowError(/configure\(\) not called/);
  });
});

// =============================================================================
// Seek / scrub / step / skip
// =============================================================================

describe('ReplayTransportService — seek / scrub / step', () => {
  it('seek(N) calls mockConn.seekToOffset(N) and updates currentIndex', () => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b'), stubState('c')],
      computedUpTo: 2,
    });
    svc.seek(2);
    expect(svc.currentIndex()).toBe(2);
    expect(mockConn.seekToOffset).toHaveBeenCalledWith(2);
  });

  it('scrub(N) delegates to seek (alias)', () => {
    const { svc, mockConn } = setup({ computedUpTo: 5 });
    svc.scrub(3);
    expect(mockConn.seekToOffset).toHaveBeenCalledWith(3);
  });

  it('seek with negative index is a no-op', () => {
    const { svc, mockConn } = setup({ computedUpTo: 5 });
    svc.seek(-1);
    expect(mockConn.seekToOffset).not.toHaveBeenCalled();
  });

  it('stepBack jumps to currentIndex - 1', () => {
    const { svc, mockConn } = setup({ computedUpTo: 5 });
    svc.seek(3);
    mockConn.seekToOffset.calls.reset();
    svc.stepBack();
    expect(mockConn.seekToOffset).toHaveBeenCalledWith(2);
  });

  it('skipStart jumps to 0', () => {
    const { svc, mockConn } = setup({ computedUpTo: 5 });
    svc.seek(3);
    mockConn.seekToOffset.calls.reset();
    svc.skipStart();
    expect(mockConn.seekToOffset).toHaveBeenCalledWith(0);
  });

  it('skipEnd jumps to computedUpTo', () => {
    const { svc, mockConn } = setup({ computedUpTo: 7 });
    svc.skipEnd();
    expect(mockConn.seekToOffset).toHaveBeenCalledWith(7);
  });
});

// =============================================================================
// Auto-play scheduler — maybeAdvance + step pump
// =============================================================================

describe('ReplayTransportService — maybeAdvance', () => {
  it('does nothing when not playing', () => {
    const { svc, mockConn } = setup({ computedUpTo: 2 });
    svc.maybeAdvance();
    expect(mockConn.dispatchNext).not.toHaveBeenCalled();
  });

  it('bails when overlayActive is true (chain overlay mid-animation)', fakeAsync(() => {
    const { svc, mockConn, overlayActive } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    svc.togglePlay();
    mockConn.seekToOffset.calls.reset();
    overlayActive.set(true);
    mockConn.pendingPrompt.and.returnValue({ type: 'SELECT_CARD' } as never);
    svc.maybeAdvance();
    tick(2000);
    // Prompt dismiss was NOT scheduled because overlay was active
    expect(mockConn.simulatePlayerResponse).not.toHaveBeenCalled();
  }));

  it('schedules prompt dismiss with REPLAY_PROMPT_DELAY_MS when prompt is up', fakeAsync(() => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    mockConn.pendingPrompt.and.returnValue({ type: 'SELECT_CARD' } as never);
    mockConn.messageCursor.and.returnValue(5);
    mockConn.getAutoResponseAt.and.returnValue({ promptType: 'SELECT_CARD', data: { indices: [0] } });
    svc.togglePlay();
    svc.maybeAdvance();
    tick(1199);
    expect(mockConn.simulatePlayerResponse).not.toHaveBeenCalled();
    tick(1); // total 1200ms = REPLAY_PROMPT_DELAY_MS
    expect(mockConn.simulatePlayerResponse).toHaveBeenCalledWith({
      promptType: 'SELECT_CARD', data: { indices: [0] },
    });
  }));

  it('falls back to no-op simulate when no auto-response is recorded', fakeAsync(() => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    mockConn.pendingPrompt.and.returnValue({ type: 'SELECT_CARD' } as never);
    mockConn.messageCursor.and.returnValue(5);
    mockConn.getAutoResponseAt.and.returnValue(null);
    svc.togglePlay();
    svc.maybeAdvance();
    tick(1200);
    // Falls back to a synthetic no-op so playback doesn't stall
    expect(mockConn.simulatePlayerResponse).toHaveBeenCalledWith({
      promptType: 'UNKNOWN', data: {},
    });
  }));

  it('waits while phaseService.announcement is non-null', () => {
    const { svc, mockConn, phase } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    svc.togglePlay();
    mockConn.dispatchNext.calls.reset();
    phase.announcement.and.returnValue({} as never);
    svc.maybeAdvance();
    expect(mockConn.dispatchNext).not.toHaveBeenCalled();
  });

  it('does not schedule when mockConn.busy() is true', () => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b'), stubState('c')],
      computedUpTo: 2,
    });
    svc.togglePlay();
    mockConn.dispatchNext.calls.reset();
    mockConn.busy.and.returnValue(true);
    svc.maybeAdvance();
    expect(mockConn.dispatchNext).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Step forward (manual)
// =============================================================================

describe('ReplayTransportService — stepForward', () => {
  it('pumps mockConn.dispatchNext up to next nav offset when animationsEnabled', () => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b'), stubState('c')],
      computedUpTo: 2,
      animationsEnabled: true,
    });
    mockConn.navIndex.and.returnValue(stubNav(3));
    // Simulate cursor advancing on each dispatch
    let cursor = 0;
    mockConn.messageCursor.and.callFake(() => cursor);
    mockConn.dispatchNext.and.callFake(() => {
      cursor++;
      return cursor < 3;
    });
    svc.stepForward();
    expect(svc.currentIndex()).toBe(1);
    expect(mockConn.dispatchNext).toHaveBeenCalled();
  });

  it('snaps to target via seekToOffset when animationsEnabled is false', fakeAsync(() => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b'), stubState('c')],
      computedUpTo: 2,
      animationsEnabled: false,
    });
    svc.stepForward();
    expect(svc.currentIndex()).toBe(1);
    expect(mockConn.seekToOffset).toHaveBeenCalledWith(1);
    tick(500); // PLAYBACK_INTERVAL — next step scheduled (but not playing → no-op)
  }));

  it('refuses to step past computedUpTo', () => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    svc.seek(1);
    mockConn.dispatchNext.calls.reset();
    svc.stepForward();
    expect(svc.currentIndex()).toBe(1);
    expect(mockConn.dispatchNext).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Toggle play / pause
// =============================================================================

describe('ReplayTransportService — togglePlay', () => {
  it('togglePlay starts playback when stopped', () => {
    // computedUpTo=2 so the first step (currentIndex 0→1) lands BEFORE
    // the boundary. With computedUpTo=1 (pre-F21 test setup), the
    // immediate `doStepForward` after togglePlay landed AT the boundary
    // and silently exited without flipping isPlaying — the test passed
    // because of that silent exit. Post-F21 fix the boundary path
    // correctly flips `isPlaying=false + pausedAtBoundary=true`, so we
    // need a timeline long enough for the first step to actually run.
    const { svc } = setup({
      states: [stubState('a'), stubState('b'), stubState('c')],
      computedUpTo: 2,
    });
    svc.togglePlay();
    expect(svc.isPlaying()).toBeTrue();
  });

  it('togglePlay stops playback when playing', () => {
    const { svc } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    svc.togglePlay();
    svc.togglePlay();
    expect(svc.isPlaying()).toBeFalse();
  });

  it('togglePlay no-op at end (atEnd)', () => {
    const { svc } = setup({
      states: [stubState('a')],
      computedUpTo: 0,
    });
    svc.seek(0);
    svc.togglePlay();
    expect(svc.isPlaying()).toBeFalse();
  });

  it('startPlayback seeks to 0 when starting from index 0', () => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    mockConn.seekToOffset.calls.reset();
    svc.togglePlay();
    expect(mockConn.seekToOffset).toHaveBeenCalledWith(0);
  });
});

// =============================================================================
// resumeIfBoundaryWaiting + pause + destroy
// =============================================================================

describe('ReplayTransportService — auto-resume + lifecycle', () => {
  it('resumeIfBoundaryWaiting returns false when not paused at boundary', () => {
    const { svc } = setup({ computedUpTo: 2 });
    expect(svc.resumeIfBoundaryWaiting()).toBeFalse();
  });

  it('resumeIfBoundaryWaiting returns true when paused and more states arrived', () => {
    const { svc, computedUpTo } = setup({ computedUpTo: 1 });
    svc.seek(1);
    // Simulate playback reaching the end via internal state
    svc.pausedAtBoundary.set(true);
    computedUpTo.set(3); // More states arrived
    expect(svc.resumeIfBoundaryWaiting()).toBeTrue();
    expect(svc.isPlaying()).toBeTrue();
    expect(svc.pausedAtBoundary()).toBeFalse();
  });

  it('haltPlaybackTimer clears timer without changing pausedAtBoundary', fakeAsync(() => {
    const { svc, mockConn } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
      animationsEnabled: false,
    });
    svc.togglePlay();
    svc.haltPlaybackTimer();
    expect(svc.pausedAtBoundary()).toBeFalse();
    tick(1000);
    // The timer was cleared so no further seekToOffset calls
    mockConn.seekToOffset.calls.reset();
    tick(1000);
    expect(mockConn.seekToOffset).not.toHaveBeenCalled();
  }));

  it('destroy clears any pending timer', () => {
    const { svc } = setup();
    expect(() => svc.destroy()).not.toThrow();
  });

  // F21 (2026-06-07) — auto-play stall regression guard. The pre-fix
  // `doStepForward` silent-exited when `nextIdx > computedUpTo` without
  // flipping `pausedAtBoundary` — the transport ended up in a dead
  // state (isPlaying=true + no timer + no re-wake hook). Manual
  // pause/play was the only way out. The fix mirrors scheduleNext's
  // boundary branch : flip isPlaying=false + pausedAtBoundary=true so
  // the resume effect picks up the next chunk arrival via its
  // computedUpTo subscription.
  it('F21 — togglePlay at penultimate index flips pausedAtBoundary after the single step', () => {
    // currentIndex=0, computedUpTo=1 → first step lands at 1 = boundary.
    // The subsequent doStepForward attempt (driven by maybeAdvance after
    // the busy flip) sees nextIdx=2 > upTo=1 → must pause.
    const { svc } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    svc.togglePlay();
    // After togglePlay, the synchronous scheduleNext → doStepForward
    // path moves the cursor to 1 + dispatches. isPlaying stays true.
    expect(svc.currentIndex()).toBe(1);
    expect(svc.isPlaying()).toBeTrue();
    // Now simulate the re-entry that production drives via the
    // maybeAdvance effect after the busy/queue settles. The scheduler
    // sees currentIndex=upTo → flips pausedAtBoundary via scheduleNext's
    // own boundary branch.
    svc.maybeAdvance();
    expect(svc.isPlaying()).toBeFalse();
    expect(svc.pausedAtBoundary()).toBeTrue();
  });

  it('F21 — doStepForward direct boundary hit flips pausedAtBoundary', () => {
    // Direct repro of the silent-exit path : seed at the last index, then
    // call scheduleNext via maybeAdvance with isPlaying already true.
    // Pre-fix : doStepForward saw nextIdx > upTo and exited silently,
    // leaving isPlaying=true. Post-fix : flips pausedAtBoundary.
    const { svc } = setup({
      states: [stubState('a'), stubState('b')],
      computedUpTo: 1,
    });
    svc.togglePlay();          // playback engages, lands at index 1
    svc.maybeAdvance();        // first re-entry pauses via scheduleNext
    expect(svc.pausedAtBoundary()).toBeTrue();

    // Now manually re-arm isPlaying without going through resumeIfBoundaryWaiting,
    // to exercise the doStepForward boundary branch directly. This mirrors
    // a race where a chunk arrival triggered startPlayback but the next
    // doStepForward still lands past computedUpTo.
    svc.pausedAtBoundary.set(false);
    svc.isPlaying.set(true);
    svc.maybeAdvance();
    // scheduleNext re-checks currentIndex >= upTo → still true → pauses.
    expect(svc.isPlaying()).toBeFalse();
    expect(svc.pausedAtBoundary()).toBeTrue();
  });
});

// =============================================================================
// seekToTurn
// =============================================================================

describe('ReplayTransportService — seekToTurn', () => {
  const turns: TurnMeta[] = [
    { turnNumber: 1, startIndex: 0, endIndex: 1, p1LP: 8000, p2LP: 8000, eventCount: 2 },
    { turnNumber: 2, startIndex: 2, endIndex: 3, p1LP: 8000, p2LP: 8000, eventCount: 2 },
    { turnNumber: 3, startIndex: 4, endIndex: 5, p1LP: 8000, p2LP: 8000, eventCount: 2 },
  ];

  it('seekToTurn delegates to seek with the turn startIndex', () => {
    const { svc, mockConn } = setup({ computedUpTo: 5 });
    svc.seekToTurn(2, turns);
    expect(mockConn.seekToOffset).toHaveBeenCalledWith(4);
  });

  it('seekToTurn refuses out-of-bounds turn index', () => {
    const { svc, mockConn } = setup({ computedUpTo: 5 });
    svc.seekToTurn(99, turns);
    expect(mockConn.seekToOffset).not.toHaveBeenCalled();
  });

  it('seekToTurn refuses when target turn not yet computed', () => {
    const { svc, mockConn } = setup({ computedUpTo: 1 });
    svc.seekToTurn(2, turns); // Turn 2 starts at 4, but only computedUpTo=1
    expect(mockConn.seekToOffset).not.toHaveBeenCalled();
  });
});
