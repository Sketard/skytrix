import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkerEmitter } from './duel-worker-emit.js';
import type { WorkerToMainMessage } from './types.js';

// =============================================================================
// U33 (audit-4-modes-2026-06-01) — Pin the emitter's typed envelope against
// the WorkerToMainMessage union. The contract: every method's output must be
// a valid union member with the right `type` literal + `duelId` captured at
// construction time. A typo or a structural drift between the union and the
// emitter surfaces here (TS at build, this spec at runtime).
// =============================================================================

interface CapturedPort {
  postMessage(value: WorkerToMainMessage): void;
  sent: WorkerToMainMessage[];
}

function makePort(): CapturedPort {
  const sent: WorkerToMainMessage[] = [];
  return {
    sent,
    postMessage(value: WorkerToMainMessage): void {
      sent.push(value);
    },
  };
}

describe('createWorkerEmitter (U33)', () => {
  let port: CapturedPort;
  const duelId = 'test-duel-123';

  beforeEach(() => { port = makePort(); });

  it('captures duelId once + every method writes the right type literal', () => {
    const emit = createWorkerEmitter(port, duelId);

    emit.duelCreated();
    emit.message({ type: 'BOARD_STATE', data: {} as never });
    emit.error('boom');
    emit.retry(1);
    emit.cancelDone(0);
    emit.replayComplete();
    emit.replayError('REPLAY_INIT_FAILED', 'msg');
    emit.forkReady({ match: true });
    emit.forkError('REPLAY_COMPUTATION_ERROR', 'msg');

    const types = port.sent.map(m => m.type);
    expect(types).toEqual([
      'WORKER_DUEL_CREATED',
      'WORKER_MESSAGE',
      'WORKER_ERROR',
      'WORKER_RETRY',
      'WORKER_CANCEL_DONE',
      'WORKER_REPLAY_COMPLETE',
      'WORKER_REPLAY_ERROR',
      'WORKER_FORK_READY',
      'WORKER_FORK_ERROR',
    ]);
    for (const m of port.sent) {
      expect((m as { duelId: string }).duelId).toBe(duelId);
    }
  });

  it('replayData carries payload + duelId', () => {
    const emit = createWorkerEmitter(port, duelId);
    emit.replayData({
      seed: ['1', '2'],
      decks: [{ main: [], extra: [] }, { main: [], extra: [] }],
      playerResponses: [],
      metadata: {
        playerUsernames: ['a', 'b'],
        deckNames: ['d0', 'd1'],
        turnCount: 1,
        result: null,
        date: '2026-06-01',
        scriptsHash: 'h',
        ocgcoreVersion: 'v',
        durationSec: 60,
        deckOrder: 'verbatim',
      },
    });
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]).toMatchObject({
      type: 'WORKER_REPLAY_DATA',
      duelId,
      payload: { seed: ['1', '2'] },
    });
  });

  it('retry / cancelDone pass through playerIndex', () => {
    const emit = createWorkerEmitter(port, duelId);
    emit.retry(0);
    emit.retry(1);
    emit.cancelDone(1);
    expect(port.sent.map(m => (m as { playerIndex: 0 | 1 }).playerIndex)).toEqual([0, 1, 1]);
  });

  it('forkReady sanityResult: match=false carries details', () => {
    const emit = createWorkerEmitter(port, duelId);
    emit.forkReady({ match: false, details: 'mismatch at turn 3' });
    expect(port.sent[0]).toMatchObject({
      type: 'WORKER_FORK_READY',
      sanityResult: { match: false, details: 'mismatch at turn 3' },
    });
  });

  it('two emitters with different duelIds capture independently', () => {
    const port2 = makePort();
    const emit1 = createWorkerEmitter(port, 'duel-A');
    const emit2 = createWorkerEmitter(port2, 'duel-B');
    emit1.duelCreated();
    emit2.duelCreated();
    expect((port.sent[0] as { duelId: string }).duelId).toBe('duel-A');
    expect((port2.sent[0] as { duelId: string }).duelId).toBe('duel-B');
  });
});
