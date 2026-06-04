import { describe, it, expect, vi } from 'vitest';
import { ChainSnapshotTracker } from './chain-snapshot-tracker.js';
import { BOARD_CHANGING_EVENT_TYPES } from './ws-protocol.js';
import type { ServerMessage, BoardStatePayload } from './ws-protocol.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal ServerMessage of the given type. The tracker only reads
 *  `type`, so other fields are irrelevant for these tests. */
function msg(type: string): ServerMessage {
  return { type } as unknown as ServerMessage;
}

/** Pick a board-changing event type that's not MSG_CHAIN_SOLVING/SOLVED
 *  (those would also flip the resolving flag, muddying snapshot tests). */
const SAMPLE_BOARD_CHANGING = (() => {
  for (const t of BOARD_CHANGING_EVENT_TYPES) {
    if (t !== 'MSG_CHAIN_SOLVING' && t !== 'MSG_CHAIN_SOLVED') return t;
  }
  throw new Error('No board-changing event type other than chain markers — fix the test setup');
})();

const FAKE_SNAPSHOT: BoardStatePayload = {
  turnPlayer: 0,
  turnCount: 1,
  phase: 'MAIN1',
  players: [
    { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
    { lp: 8000, deckCount: 40, extraCount: 15, zones: [] },
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ChainSnapshotTracker', () => {
  describe('isResolving', () => {
    it('starts false', () => {
      expect(new ChainSnapshotTracker().isResolving).toBe(false);
    });

    it('becomes true after MSG_CHAIN_SOLVING', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(true);
    });

    it('stays true after MSG_CHAIN_SOLVED — Option 2b window extension', () => {
      // 2026-06-04 Option 2b — window now closes on MSG_CHAIN_END, not
      // MSG_CHAIN_SOLVED. Events between the last SOLVED and END (typically
      // a card self-destroy reacting to its own resolution) keep getting
      // `boardStateAfter` so the client's logical state advances atomically
      // with the dispatch.
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_SOLVED'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(true);
    });

    it('becomes false after MSG_CHAIN_END — Option 2b window extension', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_SOLVED'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_END'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(false);
    });

    it('multi-link chain stays resolving across SOLVING/SOLVED pairs until END', () => {
      // 2026-06-04 Option 2b — verifies the window spans multiple links
      // (chain of 2+ links). The flag stays true through every link's
      // SOLVING/SOLVED pair and only flips on END.
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_SOLVED'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(true);
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_SOLVED'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(true);
      t.process(msg('MSG_CHAIN_END'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(false);
    });

    it('idempotent: double SOLVING stays true', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(true);
    });

    it('idempotent: standalone MSG_CHAIN_END stays false', () => {
      // 2026-06-04 — verifies MSG_CHAIN_END alone (no prior SOLVING) is a
      // no-op transition (false → false), matching the prior MSG_CHAIN_SOLVED
      // idempotence guarantee.
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_END'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(false);
    });

    it('unrelated message does not change isResolving', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_DRAW'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears resolving state', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.reset();
      expect(t.isResolving).toBe(false);
    });

    it('safe to call when already idle', () => {
      const t = new ChainSnapshotTracker();
      expect(() => t.reset()).not.toThrow();
      expect(t.isResolving).toBe(false);
    });
  });

  describe('boardStateAfter snapshot attachment', () => {
    it('attaches snapshot to BOARD_CHANGING event during resolving', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      const evt = msg(SAMPLE_BOARD_CHANGING) as { boardStateAfter?: BoardStatePayload; type: string };
      t.process(evt as ServerMessage, () => FAKE_SNAPSHOT);
      expect(evt.boardStateAfter).toBe(FAKE_SNAPSHOT);
    });

    it('does NOT attach snapshot when not resolving', () => {
      const t = new ChainSnapshotTracker();
      // Skip MSG_CHAIN_SOLVING — tracker stays idle
      const evt = msg(SAMPLE_BOARD_CHANGING) as { boardStateAfter?: BoardStatePayload; type: string };
      t.process(evt as ServerMessage, () => FAKE_SNAPSHOT);
      expect(evt.boardStateAfter).toBeUndefined();
    });

    it('does NOT attach snapshot to non-board-changing event during resolving', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      // MSG_HINT is not in BOARD_CHANGING_EVENT_TYPES
      const evt = msg('MSG_HINT') as { boardStateAfter?: BoardStatePayload; type: string };
      t.process(evt as ServerMessage, () => FAKE_SNAPSHOT);
      expect(evt.boardStateAfter).toBeUndefined();
    });

    it('keeps attaching between MSG_CHAIN_SOLVED and MSG_CHAIN_END — Option 2b', () => {
      // 2026-06-04 Option 2b — straggler MOVE post-SOLVED (e.g.
      // Radiant Typhoon Vision self-destroying after its draw resolution)
      // must carry `boardStateAfter` so the client logical state
      // advances atomically with the dispatch.
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_SOLVED'), () => FAKE_SNAPSHOT);
      const evt = msg(SAMPLE_BOARD_CHANGING) as { boardStateAfter?: BoardStatePayload; type: string };
      t.process(evt as ServerMessage, () => FAKE_SNAPSHOT);
      expect(evt.boardStateAfter).toBe(FAKE_SNAPSHOT);
    });

    it('stops attaching after MSG_CHAIN_END', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_SOLVED'), () => FAKE_SNAPSHOT);
      t.process(msg('MSG_CHAIN_END'), () => FAKE_SNAPSHOT);
      const evt = msg(SAMPLE_BOARD_CHANGING) as { boardStateAfter?: BoardStatePayload; type: string };
      t.process(evt as ServerMessage, () => FAKE_SNAPSHOT);
      expect(evt.boardStateAfter).toBeUndefined();
    });

    it('attaches snapshot to multiple events in same window', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      const e1 = msg(SAMPLE_BOARD_CHANGING) as { boardStateAfter?: BoardStatePayload; type: string };
      const e2 = msg(SAMPLE_BOARD_CHANGING) as { boardStateAfter?: BoardStatePayload; type: string };
      t.process(e1 as ServerMessage, () => FAKE_SNAPSHOT);
      t.process(e2 as ServerMessage, () => FAKE_SNAPSHOT);
      expect(e1.boardStateAfter).toBe(FAKE_SNAPSHOT);
      expect(e2.boardStateAfter).toBe(FAKE_SNAPSHOT);
    });
  });

  describe('captureSnapshot is lazy', () => {
    it('callback NOT invoked when not resolving', () => {
      const t = new ChainSnapshotTracker();
      const capture = vi.fn(() => FAKE_SNAPSHOT);
      t.process(msg(SAMPLE_BOARD_CHANGING), capture);
      expect(capture).not.toHaveBeenCalled();
    });

    it('callback NOT invoked for non-board-changing event during resolving', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      const capture = vi.fn(() => FAKE_SNAPSHOT);
      t.process(msg('MSG_HINT'), capture);
      expect(capture).not.toHaveBeenCalled();
    });

    it('callback invoked exactly once per board-changing event during resolving', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      const capture = vi.fn(() => FAKE_SNAPSHOT);
      t.process(msg(SAMPLE_BOARD_CHANGING), capture);
      expect(capture).toHaveBeenCalledTimes(1);
      t.process(msg(SAMPLE_BOARD_CHANGING), capture);
      expect(capture).toHaveBeenCalledTimes(2);
    });

    it('MSG_CHAIN_SOLVING itself: snapshot attached only if it is also board-changing', () => {
      // MSG_CHAIN_SOLVING is in BOARD_CHANGING_EVENT_TYPES (verify), so the
      // first SOLVING gets a snapshot in the same call (flag set, predicate
      // matches). This is the documented behavior — kept as a test to lock it.
      const t = new ChainSnapshotTracker();
      const capture = vi.fn(() => FAKE_SNAPSHOT);
      const evt = msg('MSG_CHAIN_SOLVING') as { boardStateAfter?: BoardStatePayload; type: string };
      t.process(evt as ServerMessage, capture);
      const isBoardChanging = BOARD_CHANGING_EVENT_TYPES.has('MSG_CHAIN_SOLVING');
      if (isBoardChanging) {
        expect(capture).toHaveBeenCalledTimes(1);
        expect(evt.boardStateAfter).toBe(FAKE_SNAPSHOT);
      } else {
        expect(capture).not.toHaveBeenCalled();
        expect(evt.boardStateAfter).toBeUndefined();
      }
    });
  });

  describe('Full lifecycle (integration)', () => {
    it('chain with 3 board-changing events between SOLVING and END (Option 2b)', () => {
      const t = new ChainSnapshotTracker();
      const capture = vi.fn(() => FAKE_SNAPSHOT);

      // Pre-chain noise — no snapshot
      t.process(msg('MSG_CHAINING'), capture);
      expect(capture).toHaveBeenCalledTimes(0);

      // Open window
      t.process(msg('MSG_CHAIN_SOLVING'), capture);
      const solvingCalls = capture.mock.calls.length; // 0 or 1 depending on whether SOLVING is board-changing

      // 2 board-changing events BEFORE MSG_CHAIN_SOLVED
      const preEvents = [msg(SAMPLE_BOARD_CHANGING), msg(SAMPLE_BOARD_CHANGING)];
      for (const e of preEvents) t.process(e, capture);
      expect(capture.mock.calls.length).toBe(solvingCalls + 2);

      // MSG_CHAIN_SOLVED — window stays open under Option 2b
      t.process(msg('MSG_CHAIN_SOLVED'), capture);
      expect(t.isResolving).toBe(true);

      // 1 straggler board-changing event AFTER SOLVED (the self-destroy case)
      // — must still get its snapshot under Option 2b.
      const straggler = msg(SAMPLE_BOARD_CHANGING) as { boardStateAfter?: BoardStatePayload; type: string };
      t.process(straggler as ServerMessage, capture);
      expect(straggler.boardStateAfter).toBe(FAKE_SNAPSHOT);
      expect(capture.mock.calls.length).toBe(solvingCalls + 3);

      // Close window on END
      t.process(msg('MSG_CHAIN_END'), capture);
      expect(t.isResolving).toBe(false);

      // Post-chain — no snapshot
      const postCalls = capture.mock.calls.length;
      t.process(msg(SAMPLE_BOARD_CHANGING), capture);
      expect(capture.mock.calls.length).toBe(postCalls);
    });

    it('reset mid-resolving (e.g. STATE_SYNC) clears window', () => {
      const t = new ChainSnapshotTracker();
      t.process(msg('MSG_CHAIN_SOLVING'), () => FAKE_SNAPSHOT);
      expect(t.isResolving).toBe(true);
      t.reset();
      // Subsequent board-changing event no longer triggers snapshot
      const capture = vi.fn(() => FAKE_SNAPSHOT);
      t.process(msg(SAMPLE_BOARD_CHANGING), capture);
      expect(capture).not.toHaveBeenCalled();
    });
  });
});
