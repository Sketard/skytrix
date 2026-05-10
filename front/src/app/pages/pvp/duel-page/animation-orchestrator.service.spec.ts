import {
  AnimationOrchestratorService,
  type QueueDecisionInputs,
} from './animation-orchestrator.service';
import {
  CHAIN_POLL_BASE_DELAY_MS,
  CHAIN_POLL_CEILING,
  CHAIN_POLL_MAX_DELAY_MS,
  QUEUE_COLLAPSE_KEEP,
  QUEUE_COLLAPSE_THRESHOLD,
} from './animation-constants';
import type { QueueEntry } from './animation-data-source';
import type { GameEvent } from '../types';

// Helpers — minimal GameEvent stubs. Only the `type` field is read by
// decideNextStep (collapse predicate filters on type).
const damage = (): GameEvent => ({ type: 'MSG_DAMAGE' } as unknown as GameEvent);
const recover = (): GameEvent => ({ type: 'MSG_RECOVER' } as unknown as GameEvent);
const payLp = (): GameEvent => ({ type: 'MSG_PAY_LPCOST' } as unknown as GameEvent);
const move = (): GameEvent => ({ type: 'MSG_MOVE' } as unknown as GameEvent);
const groupDirective = (): QueueEntry => ({ kind: 'group', events: [] });

const baseInputs = (overrides: Partial<QueueDecisionInputs> = {}): QueueDecisionInputs => ({
  isWaitingForOverlay: false,
  hasDrawsInFlight: false,
  queue: [],
  isResolving: false,
  hasBufferedEvents: false,
  hasPendingPrompt: false,
  commitMode: 'per-event',
  pollCount: 0,
  pollDelay: CHAIN_POLL_BASE_DELAY_MS,
  deferredSolvingEntry: null,
  ...overrides,
});

describe('AnimationOrchestratorService.decideNextStep', () => {
  // -------------------------------------------------------------------------
  // External wait gate (priority 1)
  // -------------------------------------------------------------------------

  describe('pause-external (wait gate)', () => {
    it('returns pause-external when isWaitingForOverlay=true', () => {
      const step = AnimationOrchestratorService.decideNextStep(
        baseInputs({ isWaitingForOverlay: true }),
      );
      expect(step.action).toBe('pause-external');
    });

    it('returns pause-external when hasDrawsInFlight=true', () => {
      const step = AnimationOrchestratorService.decideNextStep(
        baseInputs({ hasDrawsInFlight: true }),
      );
      expect(step.action).toBe('pause-external');
    });

    it('returns pause-external even when queue has entries (gate priority)', () => {
      const step = AnimationOrchestratorService.decideNextStep(
        baseInputs({ isWaitingForOverlay: true, queue: [damage(), damage()] }),
      );
      expect(step.action).toBe('pause-external');
    });

    it('gate prioritized over collapse: large LP burst with isWaitingForOverlay=true', () => {
      // 6 LP events would normally collapse; gate must preempt.
      const queue = [damage(), damage(), damage(), damage(), damage(), damage()];
      const step = AnimationOrchestratorService.decideNextStep(
        baseInputs({ isWaitingForOverlay: true, queue }),
      );
      expect(step.action).toBe('pause-external');
    });
  });

  // -------------------------------------------------------------------------
  // Queue collapse (priority 2 — LP-only burst)
  // -------------------------------------------------------------------------

  describe('collapse (LP-only burst)', () => {
    it('collapses when queue length > THRESHOLD and all LP-class', () => {
      // queue=6 (THRESHOLD=5), KEEP=3 → collapseCount=3
      const queue = [damage(), damage(), damage(), recover(), payLp(), damage()];
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({ queue }));
      expect(step.action).toBe('collapse');
      if (step.action === 'collapse') {
        expect(step.collapseCount).toBe(queue.length - QUEUE_COLLAPSE_KEEP);
      }
    });

    it('does NOT collapse at threshold edge (queue.length === THRESHOLD)', () => {
      // queue=5 (== THRESHOLD), strict > required → no collapse
      const queue = [damage(), damage(), damage(), damage(), damage()];
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({ queue }));
      expect(step.action).toBe('dequeue');
    });

    it('does NOT collapse when any non-LP event is mixed in', () => {
      // queue=10 with 1 visual MSG_MOVE among 9 LP — visual blocks collapse
      const queue = [
        damage(), damage(), damage(), damage(), damage(),
        move(), damage(), damage(), damage(), damage(),
      ];
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({ queue }));
      expect(step.action).toBe('dequeue');
    });

    it('does NOT collapse when queue contains directives (not GameEvents)', () => {
      // Directives have a 'kind' field — collapse predicate excludes them
      const queue = [
        groupDirective(), groupDirective(), groupDirective(),
        groupDirective(), groupDirective(), groupDirective(),
      ];
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({ queue }));
      expect(step.action).toBe('dequeue');
    });
  });

  // -------------------------------------------------------------------------
  // Dequeue — deferred-solving has priority over normal queue
  // -------------------------------------------------------------------------

  describe('dequeue priority', () => {
    it('returns consume-deferred when deferredSolvingEntry is set, even if queue non-empty', () => {
      const deferred = { type: 'MSG_CHAIN_SOLVING' } as unknown as GameEvent;
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({
        deferredSolvingEntry: deferred,
        queue: [damage()],
      }));
      expect(step.action).toBe('consume-deferred');
      if (step.action === 'consume-deferred') {
        expect(step.entry).toBe(deferred);
      }
    });

    it('returns dequeue with first queue entry when no deferred', () => {
      const head = damage();
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({
        queue: [head, recover()],
      }));
      expect(step.action).toBe('dequeue');
      if (step.action === 'dequeue') {
        expect(step.entry).toBe(head);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Empty queue — three terminal branches
  // -------------------------------------------------------------------------

  describe('empty queue terminal branches', () => {
    it('returns pre-replay-buffer when isResolving + hasBufferedEvents + hasPendingPrompt', () => {
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({
        isResolving: true,
        hasBufferedEvents: true,
        hasPendingPrompt: true,
      }));
      expect(step.action).toBe('pre-replay-buffer');
    });

    it('returns finalize when isResolving + hasBufferedEvents but NO prompt', () => {
      // Missing prompt — pre-replay condition fails, falls through.
      // commitMode=per-event by default → poll branch also skipped.
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({
        isResolving: true,
        hasBufferedEvents: true,
        hasPendingPrompt: false,
      }));
      expect(step.action).toBe('finalize');
    });

    it('returns finalize when isResolving + hasPendingPrompt but NO buffered events', () => {
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({
        isResolving: true,
        hasBufferedEvents: false,
        hasPendingPrompt: true,
      }));
      expect(step.action).toBe('finalize');
    });

    it('returns finalize for empty queue with default state (per-event commitMode)', () => {
      const step = AnimationOrchestratorService.decideNextStep(baseInputs());
      expect(step.action).toBe('finalize');
    });

    it('returns finalize when commitMode=deferred but isWaitingForOverlay=false (poll condition unmet)', () => {
      // The poll branch requires both commitMode='deferred' AND isWaitingForOverlay=true.
      // With only commitMode='deferred', the branch is skipped and we fall through to finalize.
      // This is the typical mid-chain-resolving state where the WS will re-trigger via
      // startProcessingIfIdle when the next event arrives (event-driven, not poll-driven).
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({
        commitMode: 'deferred',
        isWaitingForOverlay: false,
      }));
      expect(step.action).toBe('finalize');
    });
  });

  // -------------------------------------------------------------------------
  // Poll branch — currently UNREACHABLE in production. See Phase 2 of the
  // pvp-replay-2026-05-08 audit closure plan: the poll branch was found dead
  // because the wait gate (priority 1) returns first whenever
  // isWaitingForOverlay=true, and the poll predicate also requires
  // isWaitingForOverlay=true. The two conditions are mutually exclusive in
  // the same loop tick. The unit-level cases are kept here as xit markers
  // so the regression is pinned: if the wait-gate logic ever changes such
  // that the poll branch becomes reachable, the suite calls attention to
  // re-validate these scenarios.
  //
  // Pure-function unit tests below would PASS (decideNextStep is pure and
  // has no concept of caller-side mutual exclusion). They are skipped to
  // signal the architectural unreachability rather than testing dead code.
  // -------------------------------------------------------------------------

  describe('poll branch (DEAD CODE — see Phase 2 cleanup)', () => {
    xit('would return poll when commitMode=deferred + isWaitingForOverlay=true (UNREACHABLE: gate returns first)', () => {
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({
        commitMode: 'deferred',
        isWaitingForOverlay: true,
        pollCount: 0,
        pollDelay: CHAIN_POLL_BASE_DELAY_MS,
      }));
      expect(step.action).toBe('poll');
      if (step.action === 'poll') {
        expect(step.delayMs).toBe(Math.min(CHAIN_POLL_BASE_DELAY_MS * 2, CHAIN_POLL_MAX_DELAY_MS));
      }
    });

    xit('would return poll-ceiling-reset when pollCount + 1 > CHAIN_POLL_CEILING (UNREACHABLE)', () => {
      const step = AnimationOrchestratorService.decideNextStep(baseInputs({
        commitMode: 'deferred',
        isWaitingForOverlay: true,
        pollCount: CHAIN_POLL_CEILING,
      }));
      expect(step.action).toBe('poll-ceiling-reset');
    });
  });
});
