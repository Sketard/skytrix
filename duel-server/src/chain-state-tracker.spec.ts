import { describe, it, expect } from 'vitest';
import { applyChainTransition, emptyChainState } from './chain-state-tracker.js';
import type { ServerMessage } from './ws-protocol.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function chaining(chainIndex: number, extra: Record<string, unknown> = {}): ServerMessage {
  return { type: 'MSG_CHAINING', chainIndex, ...extra } as unknown as ServerMessage;
}

function solving(chainIndex = 0): ServerMessage {
  return { type: 'MSG_CHAIN_SOLVING', chainIndex } as unknown as ServerMessage;
}

function solved(chainIndex = 0): ServerMessage {
  return { type: 'MSG_CHAIN_SOLVED', chainIndex } as unknown as ServerMessage;
}

function end(): ServerMessage {
  return { type: 'MSG_CHAIN_END' } as unknown as ServerMessage;
}

function negated(chainIndex: number): ServerMessage {
  return { type: 'MSG_CHAIN_NEGATED', chainIndex } as unknown as ServerMessage;
}

function unrelated(type: string): ServerMessage {
  return { type } as unknown as ServerMessage;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('emptyChainState', () => {
  it('returns idle phase + empty links + empty negated set + null currentSolvingChainIndex', () => {
    const s = emptyChainState();
    expect(s.chainPhase).toBe('idle');
    expect(s.activeChainLinks).toEqual([]);
    expect(s.negatedChainIndices.size).toBe(0);
    expect(s.currentSolvingChainIndex).toBeNull();
  });

  it('returns a fresh object each call (no shared state)', () => {
    const a = emptyChainState();
    const b = emptyChainState();
    expect(a).not.toBe(b);
    expect(a.activeChainLinks).not.toBe(b.activeChainLinks);
    expect(a.negatedChainIndices).not.toBe(b.negatedChainIndices);
  });
});

describe('applyChainTransition — MSG_CHAINING', () => {
  it('first MSG_CHAINING from idle: idle → building, push link', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    expect(s.chainPhase).toBe('building');
    expect(s.activeChainLinks.length).toBe(1);
  });

  it('subsequent MSG_CHAINING during building: stays building, push link', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, chaining(2));
    applyChainTransition(s, chaining(3));
    expect(s.chainPhase).toBe('building');
    expect(s.activeChainLinks.length).toBe(3);
  });

  it('MSG_CHAINING after MSG_CHAIN_SOLVING: stays resolving, push link', () => {
    // Edge case: can a CHAINING arrive during resolving? Defensive: should not flip back to building.
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, solving());
    expect(s.chainPhase).toBe('resolving');
    applyChainTransition(s, chaining(2));
    expect(s.chainPhase).toBe('resolving'); // idle check prevents downgrade
    expect(s.activeChainLinks.length).toBe(2);
  });
});

describe('applyChainTransition — MSG_CHAIN_SOLVING', () => {
  it('building → resolving', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, solving());
    expect(s.chainPhase).toBe('resolving');
    expect(s.activeChainLinks.length).toBe(1); // links preserved through solving
  });

  it('idle → resolving (defensive — rare but possible)', () => {
    const s = emptyChainState();
    applyChainTransition(s, solving());
    expect(s.chainPhase).toBe('resolving');
  });
});

describe('applyChainTransition — MSG_CHAIN_END', () => {
  it('resolving → idle, clears links + negated set', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, chaining(2));
    applyChainTransition(s, negated(2));
    applyChainTransition(s, solving());
    applyChainTransition(s, end());
    expect(s.chainPhase).toBe('idle');
    expect(s.activeChainLinks.length).toBe(0);
    expect(s.negatedChainIndices.size).toBe(0);
  });

  it('END from idle: stays idle, clears (no-op effectively)', () => {
    const s = emptyChainState();
    applyChainTransition(s, end());
    expect(s.chainPhase).toBe('idle');
    expect(s.activeChainLinks.length).toBe(0);
  });

  it('END creates a fresh negatedChainIndices instance (no aliasing leak)', () => {
    const s = emptyChainState();
    const beforeRef = s.negatedChainIndices;
    applyChainTransition(s, end());
    expect(s.negatedChainIndices).not.toBe(beforeRef);
  });
});

describe('applyChainTransition — MSG_CHAIN_NEGATED', () => {
  it('adds chainIndex to negated set without changing phase', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, chaining(2));
    applyChainTransition(s, negated(1));
    expect(s.chainPhase).toBe('building');
    expect(s.negatedChainIndices.has(1)).toBe(true);
    expect(s.negatedChainIndices.has(2)).toBe(false);
  });

  it('multiple negations accumulate', () => {
    const s = emptyChainState();
    applyChainTransition(s, negated(1));
    applyChainTransition(s, negated(3));
    applyChainTransition(s, negated(5));
    expect([...s.negatedChainIndices].sort()).toEqual([1, 3, 5]);
  });

  it('duplicate negation: idempotent (Set semantics)', () => {
    const s = emptyChainState();
    applyChainTransition(s, negated(1));
    applyChainTransition(s, negated(1));
    expect(s.negatedChainIndices.size).toBe(1);
  });
});

describe('applyChainTransition — non-chain messages', () => {
  it('BOARD_STATE: no-op', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    const before = { phase: s.chainPhase, links: s.activeChainLinks.length, neg: s.negatedChainIndices.size };
    applyChainTransition(s, unrelated('BOARD_STATE'));
    expect(s.chainPhase).toBe(before.phase);
    expect(s.activeChainLinks.length).toBe(before.links);
    expect(s.negatedChainIndices.size).toBe(before.neg);
  });

  it('MSG_MOVE: no-op', () => {
    const s = emptyChainState();
    applyChainTransition(s, unrelated('MSG_MOVE'));
    expect(s.chainPhase).toBe('idle');
    expect(s.activeChainLinks.length).toBe(0);
  });

  it('MSG_DRAW during building: no-op on chain state', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, unrelated('MSG_DRAW'));
    expect(s.chainPhase).toBe('building');
    expect(s.activeChainLinks.length).toBe(1);
  });
});

describe('Full chain lifecycle (integration)', () => {
  it('build a 3-link chain with one negation, then end', () => {
    const s = emptyChainState();
    expect(s.chainPhase).toBe('idle');

    // Build phase
    applyChainTransition(s, chaining(1));
    expect(s.chainPhase).toBe('building');
    applyChainTransition(s, chaining(2));
    applyChainTransition(s, chaining(3));
    expect(s.activeChainLinks.length).toBe(3);

    // Negate link 2
    applyChainTransition(s, negated(2));
    expect(s.chainPhase).toBe('building');
    expect(s.negatedChainIndices.has(2)).toBe(true);

    // Resolve
    applyChainTransition(s, solving());
    expect(s.chainPhase).toBe('resolving');
    expect(s.activeChainLinks.length).toBe(3); // still preserved for client snapshot
    expect(s.negatedChainIndices.has(2)).toBe(true);

    // End
    applyChainTransition(s, end());
    expect(s.chainPhase).toBe('idle');
    expect(s.activeChainLinks.length).toBe(0);
    expect(s.negatedChainIndices.size).toBe(0);
  });

  it('two consecutive chains in the same turn — state correctly resets between', () => {
    const s = emptyChainState();

    // First chain
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, solving());
    applyChainTransition(s, end());
    expect(s.chainPhase).toBe('idle');
    expect(s.activeChainLinks.length).toBe(0);

    // Second chain immediately after
    applyChainTransition(s, chaining(1));
    expect(s.chainPhase).toBe('building');
    expect(s.activeChainLinks.length).toBe(1);
  });
});

describe('currentSolvingChainIndex (M22)', () => {
  it('null in idle and building phases', () => {
    const s = emptyChainState();
    expect(s.currentSolvingChainIndex).toBeNull();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, chaining(2));
    expect(s.currentSolvingChainIndex).toBeNull();
  });

  it('set to chainIndex on MSG_CHAIN_SOLVING', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, chaining(2));
    applyChainTransition(s, solving(1));
    expect(s.currentSolvingChainIndex).toBe(1);
  });

  it('cleared on MSG_CHAIN_SOLVED', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, solving(0));
    expect(s.currentSolvingChainIndex).toBe(0);
    applyChainTransition(s, solved(0));
    expect(s.currentSolvingChainIndex).toBeNull();
  });

  it('cleared on MSG_CHAIN_END (safety net)', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, solving(0));
    expect(s.currentSolvingChainIndex).toBe(0);
    applyChainTransition(s, end());
    expect(s.currentSolvingChainIndex).toBeNull();
  });

  it('LIFO resolution: 3-link chain resolves links 2 → 1 → 0 with index updates', () => {
    const s = emptyChainState();
    applyChainTransition(s, chaining(0));
    applyChainTransition(s, chaining(1));
    applyChainTransition(s, chaining(2));

    applyChainTransition(s, solving(2));
    expect(s.currentSolvingChainIndex).toBe(2);
    applyChainTransition(s, solved(2));
    expect(s.currentSolvingChainIndex).toBeNull();

    applyChainTransition(s, solving(1));
    expect(s.currentSolvingChainIndex).toBe(1);
    applyChainTransition(s, solved(1));
    expect(s.currentSolvingChainIndex).toBeNull();

    applyChainTransition(s, solving(0));
    expect(s.currentSolvingChainIndex).toBe(0);
    applyChainTransition(s, end());
    expect(s.currentSolvingChainIndex).toBeNull();
  });
});
