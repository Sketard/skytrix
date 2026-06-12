import { LOCATION, BOARD_CHANGING_EVENT_TYPES } from '../duel-ws.types';
import type { ChainingMsg, ChainNegatedMsg, ChainSolvingMsg, ChainSolvedMsg, ServerMessage } from '../duel-ws.types';
import type { GameEvent } from '../types';
import type { QueueEntry } from './animation-data-source';
import { DuelEventProcessor, GAME_EVENT_TYPES } from './duel-event-processor';

// =============================================================================
// F9 PARITY ANCHOR (audit C2, 2026-06-01)
// =============================================================================
// This spec pins the CLIENT-side chain-phase transition matrix
// (_processMessageInner sync branches + applyChainSolving/Solved/End from
// queue runner). The SERVER mirror lives at
// duel-server/src/chain-state-tracker.spec.ts.
//
// Any change to chain-phase semantics on EITHER side MUST update BOTH specs
// + the transition matrix in CLAUDE.md §"Cross-side chainPhase parity (F9)".
//
// There is currently no automated cross-side gate. Detection of a divergence
// happens only at runtime, only on a real reconnect mid-chain (CHAIN_STATE
// handshake → restoreChainState lands a phase the client cannot handle).
// =============================================================================


/** Narrows a QueueEntry to GameEvent for `.type` access in assertions. */
const asEvent = (e: QueueEntry): GameEvent => e as GameEvent;

const chaining = (chainIndex: number, cardCode = 100, sequence = 0): ChainingMsg => ({
  type: 'MSG_CHAINING', chainIndex, cardCode, cardName: `Card ${cardCode}`,
  player: 0, location: LOCATION.HAND, sequence, description: 0,
});

const chainSolving = (chainIndex: number): ChainSolvingMsg => ({ type: 'MSG_CHAIN_SOLVING', chainIndex });
const chainSolved = (chainIndex: number): ChainSolvedMsg => ({ type: 'MSG_CHAIN_SOLVED', chainIndex });
const chainEnd = (): ServerMessage => ({ type: 'MSG_CHAIN_END' }) as any;
const chainNegated = (chainIndex: number): ChainNegatedMsg => ({ type: 'MSG_CHAIN_NEGATED', chainIndex });
const waitingResponse = (): ServerMessage => ({ type: 'WAITING_RESPONSE' }) as any;
const selectCard = (): ServerMessage => ({ type: 'SELECT_CARD' }) as any;
const msgMove = (): ServerMessage => ({ type: 'MSG_MOVE' }) as any;
const msgDamage = (): ServerMessage => ({ type: 'MSG_DAMAGE', player: 0, amount: 500 }) as any;

describe('DuelEventProcessor', () => {
  let proc: DuelEventProcessor;

  beforeEach(() => { proc = new DuelEventProcessor(); });

  describe('initial state', () => {
    it('should start idle with empty queue and no chain links', () => {
      expect(proc.chainPhase()).toBe('idle');
      expect(proc.activeChainLinks()).toEqual([]);
      expect(proc.animationQueue()).toEqual([]);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });
  });

  describe('processMessage — chain lifecycle', () => {
    it('should transition to building on first MSG_CHAINING', () => {
      proc.processMessage(chaining(0));
      expect(proc.chainPhase()).toBe('building');
    });

    it('should not overwrite building phase on second MSG_CHAINING', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      expect(proc.chainPhase()).toBe('building');
    });

    it('should set hasPendingChainEntry on MSG_CHAINING', () => {
      proc.processMessage(chaining(0));
      expect(proc.hasPendingChainEntry()).toBeTrue();
    });

    it('exposes the pending chain link via pendingChainEntry before it is committed', () => {
      // The hand-reveal builders read `pendingChainEntry` so a just-activated
      // card registers (z-index + badge) before the deferred commit lands.
      expect(proc.pendingChainEntry()).toBeNull();
      proc.processMessage(chaining(0, 12345));
      const pending = proc.pendingChainEntry();
      expect(pending).not.toBeNull();
      expect(pending!.cardCode).toBe(12345);
      expect(pending!.chainIndex).toBe(0);
      // Still NOT in activeChainLinks — only the pending slot holds it.
      expect(proc.activeChainLinks().length).toBe(0);
    });

    it('should commit pending entry and replace it on consecutive MSG_CHAINING', () => {
      proc.processMessage(chaining(0, 100));
      proc.processMessage(chaining(1, 200));
      // First chaining committed to activeChainLinks, second is pending
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.activeChainLinks()[0].chainIndex).toBe(0);
      expect(proc.hasPendingChainEntry()).toBeTrue();
    });

    it('should commit pending entry on WAITING_RESPONSE', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    it('should commit pending entry on SELECT_* prompts', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(selectCard());
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    it('should commit pending entry on MSG_CHAIN_SOLVING', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chainSolving(0));
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    it('should commit pending entry on MSG_CHAIN_END', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chainEnd());
      expect(proc.activeChainLinks().length).toBe(1);
    });
  });

  describe('processMessage — chain link state', () => {
    it('should build ChainLinkState with correct zoneId from location+sequence', () => {
      proc.processMessage({
        type: 'MSG_CHAINING', chainIndex: 0, cardCode: 42, cardName: 'Monster',
        player: 1, location: LOCATION.MZONE, sequence: 2, description: 0,
      } as ChainingMsg);
      proc.processMessage(waitingResponse());
      const link = proc.activeChainLinks()[0];
      expect(link.zoneId).toBe('M3');
      expect(link.player).toBe(1);
      expect(link.resolving).toBeFalse();
      expect(link.negated).toBeFalse();
    });

    it('should set zoneId to null for HAND location', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      expect(proc.activeChainLinks()[0].zoneId).toBeNull();
    });
  });

  describe('processMessage — MSG_CHAIN_NEGATED', () => {
    it('should mark committed chain link as negated', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      proc.processMessage(chainNegated(0));
      expect(proc.activeChainLinks()[0].negated).toBeTrue();
    });

    it('should mark pending chain entry as negated', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chainNegated(0));
      // Commit and check
      proc.processMessage(waitingResponse());
      expect(proc.activeChainLinks()[0].negated).toBeTrue();
    });

    it('should not affect other chain links', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      proc.processMessage(waitingResponse());
      proc.processMessage(chainNegated(1));
      expect(proc.activeChainLinks()[0].negated).toBeFalse();
      expect(proc.activeChainLinks()[1].negated).toBeTrue();
    });

    it('should NOT enqueue MSG_CHAIN_NEGATED', () => {
      proc.processMessage(chaining(0));
      const qBefore = proc.animationQueue().length;
      proc.processMessage(chainNegated(0));
      expect(proc.animationQueue().length).toBe(qBefore);
    });
  });

  describe('processMessage — queue routing', () => {
    it('should enqueue MSG_CHAINING', () => {
      proc.processMessage(chaining(0));
      expect(proc.animationQueue().length).toBe(1);
      expect(asEvent(proc.animationQueue()[0]).type).toBe('MSG_CHAINING');
    });

    it('should enqueue MSG_CHAIN_SOLVING', () => {
      proc.processMessage(chainSolving(0));
      expect(proc.animationQueue().some(e => asEvent(e).type === 'MSG_CHAIN_SOLVING')).toBeTrue();
    });

    it('should enqueue MSG_CHAIN_SOLVED', () => {
      proc.processMessage(chainSolved(0));
      expect(proc.animationQueue().some(e => asEvent(e).type === 'MSG_CHAIN_SOLVED')).toBeTrue();
    });

    it('should enqueue MSG_CHAIN_END', () => {
      proc.processMessage(chainEnd());
      expect(proc.animationQueue().some(e => asEvent(e).type === 'MSG_CHAIN_END')).toBeTrue();
    });

    it('should enqueue generic visual messages (MSG_MOVE, MSG_DAMAGE)', () => {
      proc.processMessage(msgMove());
      proc.processMessage(msgDamage());
      expect(proc.animationQueue().length).toBe(2);
    });

    it('should NOT enqueue SELECT_* prompts', () => {
      proc.processMessage(selectCard());
      expect(proc.animationQueue().length).toBe(0);
    });

    it('should NOT enqueue WAITING_RESPONSE', () => {
      proc.processMessage(waitingResponse());
      expect(proc.animationQueue().length).toBe(0);
    });
  });

  describe('applyChainSolving', () => {
    it('should set phase to resolving and mark link', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      proc.applyChainSolving(0);
      expect(proc.chainPhase()).toBe('resolving');
      expect(proc.activeChainLinks()[0].resolving).toBeTrue();
    });

    it('should only mark the targeted chain link', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      proc.processMessage(waitingResponse());
      proc.applyChainSolving(1);
      expect(proc.activeChainLinks()[0].resolving).toBeFalse();
      expect(proc.activeChainLinks()[1].resolving).toBeTrue();
    });
  });

  describe('applyChainSolved', () => {
    it('should remove the solved link', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      proc.processMessage(waitingResponse());
      proc.applyChainSolved(1);
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.activeChainLinks()[0].chainIndex).toBe(0);
    });
  });

  describe('applyChainEnd', () => {
    it('should reset to idle with no links', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(waitingResponse());
      proc.applyChainSolving(0);
      proc.applyChainEnd();
      expect(proc.chainPhase()).toBe('idle');
      expect(proc.activeChainLinks()).toEqual([]);
    });
  });

  // ===========================================================================
  // Dense back-to-back chains — generation scoping (2026-06-12).
  // ---------------------------------------------------------------------------
  // Receipt (sync) writes links; dispatch (queue runner) clears them. When
  // chain N+1's CHAINING + SOLVING are RECEIVED while chain N's END still
  // sits in the animation queue, the next chain's link is committed BEFORE
  // applyChainEnd(N) runs. Pre-fix, that applyChainEnd blanket-wiped it →
  // the overlay had no link to drop at SOLVED(N+1) dispatch → never flipped
  // `chainOverlayReady` → the runner deadlocked on `isWaitingForOverlay`
  // (D/D/D 24-chain fixture, trace _bmad-output/debug-solo/ddd-stall-diag/).
  // The matrix in CLAUDE.md §F9 documents the scoped MSG_CHAIN_END client
  // transition; the server side is untouched (it transitions at EMIT, in
  // wire order, so generations cannot overlap there).
  // ===========================================================================
  describe('dense back-to-back chains — generation scoping (2026-06-12)', () => {
    /** Wire receipt of a full chain-1 then the head of chain-2, exactly the
     *  D/D/D interleaving: chain 2 fully received before chain 1's queued
     *  events have been dispatched. */
    function receiveDenseTwoChains(): void {
      proc.processMessage(chaining(0, 100));     // chain 1 link
      proc.processMessage(chainSolving(0));      // commits c1
      proc.processMessage(chainSolved(0));
      proc.processMessage(chainEnd());           // closes generation 0 (receipt side)
      proc.processMessage(chaining(0, 200));     // chain 2 link — SAME chainIndex 0
      proc.processMessage(chainSolving(0));      // commits c2 (generation 1)
    }

    it('a chain-2 link committed before chain 1\'s END dispatches survives applyChainEnd', () => {
      receiveDenseTwoChains();
      expect(proc.activeChainLinks().length).toBe(2); // c1 (gen 0) + c2 (gen 1)

      // Dispatch side, FIFO — chain 1's cycle:
      proc.applyChainSolving(0);
      proc.applyChainSolved(0);                  // drops c1 only
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.activeChainLinks()[0].cardCode).toBe(200);
      proc.applyChainEnd();                      // closes generation 0
      // c2 SURVIVES — pre-fix this wiped it and chain 2 deadlocked.
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.activeChainLinks()[0].cardCode).toBe(200);
      // Announced-but-not-resolving ⇒ building (mirrors the server container).
      expect(proc.chainPhase()).toBe('building');

      // Chain 2's cycle is nominal again:
      proc.applyChainSolving(0);
      expect(proc.activeChainLinks()[0].resolving).toBeTrue();
      proc.applyChainSolved(0);                  // the overlay HAS a link to drop
      expect(proc.activeChainLinks()).toEqual([]);
      proc.applyChainEnd();
      expect(proc.chainPhase()).toBe('idle');
    });

    it('applyChainSolving/Solved only target the dispatching generation on chainIndex collision', () => {
      receiveDenseTwoChains();
      // Chain 1's SOLVING(0) must not mark c2 (also chainIndex 0).
      proc.applyChainSolving(0);
      const [c1, c2] = proc.activeChainLinks();
      expect(c1.cardCode).toBe(100);
      expect(c1.resolving).toBeTrue();
      expect(c2.resolving).toBeFalse();
      // Chain 1's SOLVED(0) must not drop c2.
      proc.applyChainSolved(0);
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.activeChainLinks()[0].cardCode).toBe(200);
    });

    it('three stacked chains: each END clears exactly its own generation', () => {
      receiveDenseTwoChains();
      proc.processMessage(chainSolved(0));
      proc.processMessage(chainEnd());           // closes generation 1
      proc.processMessage(chaining(0, 300));     // chain 3 link (generation 2)
      proc.processMessage(chainSolving(0));      // commits c3
      expect(proc.activeChainLinks().length).toBe(3);

      proc.applyChainSolving(0); proc.applyChainSolved(0); proc.applyChainEnd(); // chain 1
      expect(proc.activeChainLinks().map(l => l.cardCode)).toEqual([200, 300]);
      expect(proc.chainPhase()).toBe('building');
      proc.applyChainSolving(0); proc.applyChainSolved(0); proc.applyChainEnd(); // chain 2
      expect(proc.activeChainLinks().map(l => l.cardCode)).toEqual([300]);
      expect(proc.chainPhase()).toBe('building');
      proc.applyChainSolving(0); proc.applyChainSolved(0); proc.applyChainEnd(); // chain 3
      expect(proc.activeChainLinks()).toEqual([]);
      expect(proc.chainPhase()).toBe('idle');
    });

    it('reset() rebases the generation window for the next duel', () => {
      receiveDenseTwoChains();
      proc.reset();
      // Fresh mono-chain cycle behaves like generation 0 again.
      proc.processMessage(chaining(0, 999));
      proc.processMessage(chainSolving(0));
      proc.applyChainSolving(0);
      expect(proc.activeChainLinks()[0].resolving).toBeTrue();
      proc.applyChainSolved(0);
      expect(proc.activeChainLinks()).toEqual([]);
      proc.applyChainEnd();
      expect(proc.chainPhase()).toBe('idle');
    });
  });

  describe('queue operations', () => {
    it('dequeueAnimation should return first entry and remove it', () => {
      proc.processMessage(msgMove());
      proc.processMessage(msgDamage());
      const first = proc.dequeueAnimation()!;
      expect(asEvent(first).type).toBe('MSG_MOVE');
      expect(proc.animationQueue().length).toBe(1);
    });

    it('dequeueAnimation should return null on empty queue', () => {
      expect(proc.dequeueAnimation()).toBeNull();
    });

    it('removeAnimationAt should remove entry at given index', () => {
      proc.processMessage(msgMove());
      proc.processMessage(msgDamage());
      proc.processMessage(msgMove());
      proc.removeAnimationAt(1);
      expect(proc.animationQueue().length).toBe(2);
      expect(proc.animationQueue().every(e => asEvent(e).type === 'MSG_MOVE')).toBeTrue();
    });

    it('prependToQueue should insert entries before existing ones', () => {
      proc.processMessage(msgDamage());
      proc.prependToQueue([msgMove() as any]);
      expect(asEvent(proc.animationQueue()[0]).type).toBe('MSG_MOVE');
      expect(asEvent(proc.animationQueue()[1]).type).toBe('MSG_DAMAGE');
    });
  });

  describe('restoreChainState', () => {
    const linkAt = (chainIndex: number, overrides: Partial<{ resolving: boolean; negated: boolean }> = {}) => ({
      chainIndex, cardCode: 100 + chainIndex, cardName: `Card${chainIndex}`,
      player: 0, zoneId: 'M1', location: LOCATION.MZONE, sequence: 0,
      resolving: false, negated: false, ...overrides,
    });

    it('should restore links and phase, clearing pending entry', () => {
      proc.processMessage(chaining(0));
      const links = [linkAt(2, { resolving: true })];
      proc.restoreChainState(links, 'resolving');
      expect(proc.activeChainLinks()).toEqual(links);
      expect(proc.chainPhase()).toBe('resolving');
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    // F9-bis (2026-06-04) — the replay seek path calls
    // `processor.reset()` (via adapter.abort()) BEFORE `restoreChainState`.
    // The reset must not leave residue that the restore would compound with.
    it('reset then restoreChainState produces a clean state (no residue)', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(chaining(1));
      proc.processMessage(waitingResponse());
      proc.applyChainSolving(0);
      // simulate seek: reset, then restore from a snapshot
      proc.reset();
      const links = [linkAt(0), linkAt(1)];
      proc.restoreChainState(links, 'building');
      expect(proc.activeChainLinks().length).toBe(2);
      expect(proc.chainPhase()).toBe('building');
      expect(proc.animationQueue()).toEqual([]);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    // F9-bis (2026-06-04) — the replay adapter follows restoreChainState
    // with `applyChainSolving(currentSolvingChainIndex)` when the snapshot
    // designates an in-resolution link. The combination MUST flip
    // resolving=true on exactly the matched link, leaving the others alone.
    it('restoreChainState then applyChainSolving flips resolving on the matched link only', () => {
      const links = [linkAt(0), linkAt(1), linkAt(2)];
      proc.restoreChainState(links, 'resolving');
      proc.applyChainSolving(1);
      const after = proc.activeChainLinks();
      expect(after[0].resolving).toBeFalse();
      expect(after[1].resolving).toBeTrue();
      expect(after[2].resolving).toBeFalse();
      expect(proc.chainPhase()).toBe('resolving');
    });

    it('restoreChainState preserves the negated flag on links', () => {
      const links = [linkAt(0, { negated: true }), linkAt(1)];
      proc.restoreChainState(links, 'building');
      expect(proc.activeChainLinks()[0].negated).toBeTrue();
      expect(proc.activeChainLinks()[1].negated).toBeFalse();
    });

    it('restoreChainState with empty links + idle phase is a no-op for downstream consumers', () => {
      proc.processMessage(chaining(0));
      proc.restoreChainState([], 'idle');
      expect(proc.activeChainLinks()).toEqual([]);
      expect(proc.chainPhase()).toBe('idle');
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });

    // Two consecutive restoreChainState calls (e.g. user seeks twice in
    // a row to two different mid-chain states) must NOT compound — each
    // call replaces the previous snapshot wholesale.
    it('a second restoreChainState replaces the previous one wholesale', () => {
      proc.restoreChainState([linkAt(0), linkAt(1)], 'building');
      expect(proc.activeChainLinks().length).toBe(2);
      proc.restoreChainState([linkAt(5)], 'resolving');
      expect(proc.activeChainLinks().length).toBe(1);
      expect(proc.activeChainLinks()[0].chainIndex).toBe(5);
      expect(proc.chainPhase()).toBe('resolving');
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      proc.processMessage(chaining(0));
      proc.processMessage(msgDamage());
      proc.reset();
      expect(proc.chainPhase()).toBe('idle');
      expect(proc.activeChainLinks()).toEqual([]);
      expect(proc.animationQueue()).toEqual([]);
      expect(proc.hasPendingChainEntry()).toBeFalse();
    });
  });

  // F8 (2026-05-31) — pin `BOARD_CHANGING_EVENT_TYPES ⊆ GAME_EVENT_TYPES`.
  // Without this invariant, a future addition to `BOARD_CHANGING_EVENT_TYPES`
  // (byte-synced front↔back via `check-ws-protocol-sync.mjs`) that forgot
  // to update `GAME_EVENT_TYPES` would silently break chain animations: the
  // event would be buffered by `bufferIfResolving` during chain resolution,
  // then drained via `replayBuffer` → `enqueue` → `isGameEvent` returns
  // false → `logger.warn` and the event is dropped. The user sees the chain
  // resolve but a board mutation is missing, with no assertion firing.
  //
  // `GAME_EVENT_TYPES` itself is structurally aligned with the `GameEvent`
  // union via the exhaustive `Record<GameEvent['type'], true>` map declared
  // in `duel-event-processor.ts` — TS compile-time catches divergence on
  // that side. This runtime test catches divergence on the other side.
  describe('F8 invariant — BOARD_CHANGING_EVENT_TYPES ⊆ GAME_EVENT_TYPES', () => {
    it('every BOARD_CHANGING type is a known GAME_EVENT type', () => {
      const orphans = [...BOARD_CHANGING_EVENT_TYPES].filter(
        t => !GAME_EVENT_TYPES.has(t as GameEvent['type']),
      );
      expect(orphans).withContext(
        `These BOARD_CHANGING_EVENT_TYPES entries are missing from ` +
        `GAME_EVENT_TYPES (or GameEvent union): ${orphans.join(', ')}. ` +
        `Add them to GAME_EVENT_TYPE_MAP in duel-event-processor.ts and ` +
        `the matching variant to the GameEvent union in types/game-event.types.ts.`
      ).toEqual([]);
    });
  });
});
