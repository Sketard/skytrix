import { describe, it, expect, vi } from 'vitest';
import { OcgMessageType, OcgProcessResult } from '@n1xx1/ocgcore-wasm';
import type { OcgCoreSync, OcgDuelHandle, OcgMessage } from '@n1xx1/ocgcore-wasm';
import {
  runForkReconstruction,
  performSanityCheck,
  type ForkContext,
  type PhaseToCodeMap,
} from './duel-worker-fork.js';
import type { WorkerEmitter } from './duel-worker-emit.js';
import type { DuelLogger } from './logger.js';
import type { InitForkMessage, CapturedResponse } from './types.js';
import type { Phase } from './ws-protocol.js';

/**
 * U4 review-fix (audit-4-modes-2026-06-01) — unit pinning for the fork
 * replay-driver extracted from `duel-worker.ts`. 6 control-flow branches:
 *
 *  1. MAX_ITERATIONS exceeded → forkError REPLAY_MAX_ITERATIONS + cleanup
 *  2. duelProcess throws       → forkError REPLAY_COMPUTATION_ERROR + cleanup
 *  3. MSG_RETRY                → forkError REPLAY_DIVERGED_RETRY + cleanup
 *  4. Fork point reached       → setForkPendingSelect + performSanityCheck →
 *                                setForkMode(true) + forkReady (ordering pinned)
 *  5. Out of responses         → forkError REPLAY_DIVERGED_NO_RESPONSES + cleanup
 *  6. END before fork point    → forkError REPLAY_DIVERGED_NO_RESULT + cleanup
 *
 * Plus a 7th probe for `performSanityCheck` mismatch reporting.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ScriptedTick {
  status: number;
  messages: OcgMessage[];
}

const PHASE_MAP: PhaseToCodeMap = {
  DRAW: 0x01,
  STANDBY: 0x02,
  MAIN1: 0x04,
  BATTLE_START: 0x08,
  BATTLE_STEP: 0x10,
  DAMAGE: 0x20,
  DAMAGE_CALC: 0x40,
  BATTLE: 0x80,
  MAIN2: 0x100,
  END: 0x200,
};

function makeMockCore(ticks: ScriptedTick[]): OcgCoreSync {
  let i = 0;
  const setResponseCalls: unknown[] = [];
  const core = {
    duelProcess: vi.fn(() => {
      if (i >= ticks.length) return OcgProcessResult.END;
      return ticks[i].status;
    }),
    duelGetMessage: vi.fn(() => {
      const tick = ticks[i] ?? { status: OcgProcessResult.END, messages: [] };
      i++;
      return tick.messages;
    }),
    duelSetResponse: vi.fn((_duel: OcgDuelHandle, data: unknown) => {
      setResponseCalls.push(data);
    }),
  } as unknown as OcgCoreSync;
  (core as unknown as { __setResponseCalls: unknown[] }).__setResponseCalls = setResponseCalls;
  return core;
}

interface MockEmitter {
  emitter: WorkerEmitter;
  events: Array<{ method: string; args: unknown[] }>;
}

function makeMockEmitter(): MockEmitter {
  const events: Array<{ method: string; args: unknown[] }> = [];
  const make = (method: string) => (...args: unknown[]) => { events.push({ method, args }); };
  const emitter: WorkerEmitter = {
    duelCreated: make('duelCreated'),
    message: make('message') as never,
    error: make('error') as never,
    retry: make('retry') as never,
    cancelDone: make('cancelDone') as never,
    replayData: make('replayData') as never,
    replayComplete: make('replayComplete') as never,
    replayError: make('replayError') as never,
    forkReady: make('forkReady') as never,
    forkError: make('forkError') as never,
  };
  return { emitter, events };
}

function makeDlog(): DuelLogger {
  return {
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

interface CtxBuild {
  ctx: ForkContext;
  emitter: MockEmitter;
  setForkModeCalls: boolean[];
  setForkPendingSelectCalls: Array<OcgMessage | null>;
  cleanupCalled: () => boolean;
  updateStateCalls: OcgMessage[];
  lp: [number, number];
  turnCount: number;
  phase: Phase;
}

function makeCtx(
  core: OcgCoreSync,
  opts: Partial<{ lp: [number, number]; turnCount: number; phase: Phase }> = {},
): CtxBuild {
  const emitter = makeMockEmitter();
  const setForkModeCalls: boolean[] = [];
  const setForkPendingSelectCalls: Array<OcgMessage | null> = [];
  const updateStateCalls: OcgMessage[] = [];
  let cleanupFired = false;
  const dlog = makeDlog();
  const duel = {} as OcgDuelHandle;
  const lp = opts.lp ?? [8000, 8000];
  const turnCount = opts.turnCount ?? 1;
  const phase = opts.phase ?? 'MAIN1';
  const ctx: ForkContext = {
    core: () => core,
    duel: () => duel,
    lp: () => lp,
    turnCount: () => turnCount,
    phase: () => phase,
    phaseMap: PHASE_MAP,
    dlog: () => dlog,
    emit: () => emitter.emitter,
    updateState: (msg) => { updateStateCalls.push(msg); },
    cleanup: () => { cleanupFired = true; },
    setForkMode: (v) => { setForkModeCalls.push(v); },
    setForkPendingSelect: (v) => { setForkPendingSelectCalls.push(v); },
  };
  return {
    ctx,
    emitter,
    setForkModeCalls,
    setForkPendingSelectCalls,
    cleanupCalled: () => cleanupFired,
    updateStateCalls,
    lp,
    turnCount,
    phase,
  };
}

function ocg(type: number, extra: Partial<OcgMessage> = {}): OcgMessage {
  return { type, ...extra } as OcgMessage;
}

function makeForkMsg(opts: Partial<InitForkMessage> = {}): InitForkMessage {
  const responses: CapturedResponse[] = opts.playerResponses ?? [{ data: { type: 'IDLE' } }];
  return {
    type: 'INIT_FORK',
    duelId: 'd-fork',
    seed: ['1', '2', '3', '4'],
    decks: [{ main: [], extra: [] }, { main: [], extra: [] }],
    playerResponses: responses,
    targetResponseCount: opts.targetResponseCount ?? responses.length,
    expectedState: opts.expectedState ?? { lp: [8000, 8000], turnNumber: 1, phase: PHASE_MAP.MAIN1 },
    scriptsHash: 'h',
    ocgcoreVersion: 'v',
    ...opts,
  };
}

// ─── runForkReconstruction ───────────────────────────────────────────────────

describe('runForkReconstruction', () => {
  it('branch 4 — fork point reached: stashes pending SELECT, runs sanity check, flips forkMode BEFORE forkReady', () => {
    // 1 recorded response → driver feeds it on the 1st SELECT, then the 2nd
    // SELECT (responseIndex >= targetResponseCount) is the fork point.
    const ticks: ScriptedTick[] = [
      { status: OcgProcessResult.CONTINUE, messages: [ocg(OcgMessageType.SELECT_IDLECMD)] },
      { status: OcgProcessResult.CONTINUE, messages: [ocg(OcgMessageType.SELECT_BATTLECMD)] },
    ];
    const core = makeMockCore(ticks);
    const build = makeCtx(core);
    const msg = makeForkMsg({ targetResponseCount: 1, playerResponses: [{ data: 0 }] });

    runForkReconstruction(msg, build.ctx);

    expect(build.setForkPendingSelectCalls).toHaveLength(1);
    expect(build.setForkPendingSelectCalls[0]).toEqual(ocg(OcgMessageType.SELECT_BATTLECMD));
    // U4 ordering invariant — setForkMode(true) MUST fire BEFORE forkReady
    // because the worker's FORK_RESUME handler gates on `forkMode === true`.
    expect(build.setForkModeCalls).toEqual([true]);
    const forkReadyIdx = build.emitter.events.findIndex(e => e.method === 'forkReady');
    expect(forkReadyIdx).toBeGreaterThanOrEqual(0);
    expect(build.emitter.events[forkReadyIdx].args[0]).toMatchObject({ match: true });
    // No error fired, no cleanup.
    expect(build.emitter.events.some(e => e.method === 'forkError')).toBe(false);
    expect(build.cleanupCalled()).toBe(false);
    // First SELECT consumed the recorded response.
    expect((core as unknown as { __setResponseCalls: unknown[] }).__setResponseCalls).toEqual([0]);
  });

  it('branch 3 — MSG_RETRY divergence: emits forkError REPLAY_DIVERGED_RETRY + cleanup', () => {
    const ticks: ScriptedTick[] = [
      { status: OcgProcessResult.CONTINUE, messages: [ocg(OcgMessageType.RETRY)] },
    ];
    const build = makeCtx(makeMockCore(ticks));

    runForkReconstruction(makeForkMsg(), build.ctx);

    const errEvt = build.emitter.events.find(e => e.method === 'forkError');
    expect(errEvt).toBeDefined();
    expect(errEvt!.args[0]).toBe('REPLAY_DIVERGED_RETRY');
    expect(build.cleanupCalled()).toBe(true);
    expect(build.setForkModeCalls).toEqual([]); // never flipped to true
  });

  it('branch 6 — END before fork point: emits forkError REPLAY_DIVERGED_NO_RESULT + cleanup', () => {
    const ticks: ScriptedTick[] = [
      // No SELECT, no RETRY — just ticks of no messages until END.
      { status: OcgProcessResult.END, messages: [] },
    ];
    const build = makeCtx(makeMockCore(ticks));

    runForkReconstruction(
      makeForkMsg({ targetResponseCount: 1, playerResponses: [{ data: 0 }] }),
      build.ctx,
    );

    const errEvt = build.emitter.events.find(e => e.method === 'forkError');
    expect(errEvt).toBeDefined();
    expect(errEvt!.args[0]).toBe('REPLAY_DIVERGED_NO_RESULT');
    expect(build.cleanupCalled()).toBe(true);
  });

  it('branch 5 — out of recorded responses: emits forkError REPLAY_DIVERGED_NO_RESPONSES + cleanup', () => {
    // targetResponseCount=2 but only 1 response recorded. Driver consumes
    // the 1st on the 1st SELECT, then the 2nd SELECT triggers the no-responses
    // branch (responseIndex >= msg.playerResponses.length, not yet at fork point).
    const ticks: ScriptedTick[] = [
      { status: OcgProcessResult.CONTINUE, messages: [ocg(OcgMessageType.SELECT_IDLECMD)] },
      { status: OcgProcessResult.CONTINUE, messages: [ocg(OcgMessageType.SELECT_BATTLECMD)] },
    ];
    const build = makeCtx(makeMockCore(ticks));

    runForkReconstruction(
      makeForkMsg({ targetResponseCount: 2, playerResponses: [{ data: 0 }] }),
      build.ctx,
    );

    const errEvt = build.emitter.events.find(e => e.method === 'forkError');
    expect(errEvt).toBeDefined();
    expect(errEvt!.args[0]).toBe('REPLAY_DIVERGED_NO_RESPONSES');
    expect(build.cleanupCalled()).toBe(true);
  });

  it('branch 2 — duelProcess throws: emits forkError REPLAY_COMPUTATION_ERROR + cleanup', () => {
    const core = {
      duelProcess: vi.fn(() => { throw new Error('boom'); }),
      duelGetMessage: vi.fn(() => []),
      duelSetResponse: vi.fn(),
    } as unknown as OcgCoreSync;
    const build = makeCtx(core);

    runForkReconstruction(makeForkMsg(), build.ctx);

    const errEvt = build.emitter.events.find(e => e.method === 'forkError');
    expect(errEvt).toBeDefined();
    expect(errEvt!.args[0]).toBe('REPLAY_COMPUTATION_ERROR');
    expect(errEvt!.args[1]).toContain('boom');
    expect(build.cleanupCalled()).toBe(true);
  });

  it('branch 1 — MAX_ITERATIONS exceeded: emits forkError REPLAY_MAX_ITERATIONS + cleanup', () => {
    // Infinite stream of CONTINUE+no-messages would tick forever ; the
    // 100_000 cap fires guard. We back-stop with vi.fn returning the same
    // CONTINUE-empty pair so the iteration counter is the only exit.
    const core = {
      duelProcess: vi.fn(() => OcgProcessResult.CONTINUE),
      duelGetMessage: vi.fn(() => []),
      duelSetResponse: vi.fn(),
    } as unknown as OcgCoreSync;
    const build = makeCtx(core);

    runForkReconstruction(makeForkMsg(), build.ctx);

    const errEvt = build.emitter.events.find(e => e.method === 'forkError');
    expect(errEvt).toBeDefined();
    expect(errEvt!.args[0]).toBe('REPLAY_MAX_ITERATIONS');
    expect(build.cleanupCalled()).toBe(true);
    // Hit the cap : 100_001 calls (the iteration counter increments BEFORE
    // the comparison, so MAX_ITERATIONS + 1 invocations land before the
    // guard fires).
    expect((core.duelProcess as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(99_000);
  });

  it('returns silently when core or duel handle is null (defensive guard)', () => {
    const build = makeCtx(makeMockCore([]));
    // Override : core() returns null.
    build.ctx.core = () => null;

    runForkReconstruction(makeForkMsg(), build.ctx);

    expect(build.emitter.events).toEqual([]);
    expect(build.cleanupCalled()).toBe(false);
  });

  it('feeds every non-SELECT OcgMessage to updateState (state catch-up)', () => {
    const ticks: ScriptedTick[] = [
      { status: OcgProcessResult.CONTINUE, messages: [
        ocg(OcgMessageType.DRAW),
        ocg(OcgMessageType.NEW_TURN),
        ocg(OcgMessageType.SELECT_IDLECMD),
      ] },
      { status: OcgProcessResult.CONTINUE, messages: [ocg(OcgMessageType.SELECT_BATTLECMD)] },
    ];
    const build = makeCtx(makeMockCore(ticks));

    runForkReconstruction(
      makeForkMsg({ targetResponseCount: 1, playerResponses: [{ data: 0 }] }),
      build.ctx,
    );

    // All 4 messages (DRAW, NEW_TURN, SELECT_IDLECMD, SELECT_BATTLECMD) reach
    // updateState before the fork-point branch returns.
    expect(build.updateStateCalls.map(m => m.type)).toEqual([
      OcgMessageType.DRAW,
      OcgMessageType.NEW_TURN,
      OcgMessageType.SELECT_IDLECMD,
      OcgMessageType.SELECT_BATTLECMD,
    ]);
  });
});

// ─── performSanityCheck ──────────────────────────────────────────────────────

describe('performSanityCheck', () => {
  it('match=true when expected matches actual lp/turn/phase', () => {
    const build = makeCtx(makeMockCore([]), { lp: [4500, 7800], turnCount: 5, phase: 'MAIN2' });

    performSanityCheck({ lp: [4500, 7800], turnNumber: 5, phase: PHASE_MAP.MAIN2 }, build.ctx);

    const evt = build.emitter.events.find(e => e.method === 'forkReady');
    expect(evt).toBeDefined();
    expect(evt!.args[0]).toEqual({ match: true, details: undefined });
    // Ordering invariant — setForkMode fires BEFORE forkReady.
    expect(build.setForkModeCalls).toEqual([true]);
  });

  it('match=false with details when lp diverges', () => {
    const build = makeCtx(makeMockCore([]), { lp: [4000, 8000], turnCount: 1, phase: 'MAIN1' });

    performSanityCheck({ lp: [8000, 8000], turnNumber: 1, phase: PHASE_MAP.MAIN1 }, build.ctx);

    const evt = build.emitter.events.find(e => e.method === 'forkReady');
    expect(evt).toBeDefined();
    expect((evt!.args[0] as { match: boolean }).match).toBe(false);
    expect((evt!.args[0] as { details: string }).details).toContain('LP mismatch');
  });

  it('match=false with phase mismatch when PhaseToCodeMap returns undefined for an unknown phase (E2 review-fix)', () => {
    // Pathological: ctx.phase() returns a phase string outside PHASE_MAP.
    // The E2 fix made the code warn-then-propagate (no `?? 0` fallback).
    const incompleteMap = { ...PHASE_MAP } as PhaseToCodeMap;
    delete (incompleteMap as Record<string, number>)['MAIN1'];
    const build = makeCtx(makeMockCore([]), { lp: [8000, 8000], turnCount: 1, phase: 'MAIN1' });
    build.ctx.phaseMap = incompleteMap;

    performSanityCheck({ lp: [8000, 8000], turnNumber: 1, phase: PHASE_MAP.MAIN1 }, build.ctx);

    const evt = build.emitter.events.find(e => e.method === 'forkReady');
    expect(evt).toBeDefined();
    expect((evt!.args[0] as { match: boolean }).match).toBe(false);
    expect((evt!.args[0] as { details: string }).details).toContain('Phase mismatch');
    // Warn fires — operator-visible signal that PHASE_MAP lost coverage.
    expect((build.ctx.dlog().warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
  });
});
