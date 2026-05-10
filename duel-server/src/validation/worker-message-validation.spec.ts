import { describe, it, expect } from 'vitest';
import { validateWorkerMessage } from './worker-message-validation.js';

describe('validateWorkerMessage', () => {
  // ==========================================================================
  // Top-level shape rejection
  // ==========================================================================

  it('rejects null', () => {
    expect(validateWorkerMessage(null)).toBeNull();
  });

  it('rejects undefined', () => {
    expect(validateWorkerMessage(undefined)).toBeNull();
  });

  it('rejects primitives', () => {
    expect(validateWorkerMessage('WORKER_MESSAGE')).toBeNull();
    expect(validateWorkerMessage(42)).toBeNull();
    expect(validateWorkerMessage(true)).toBeNull();
  });

  it('rejects array', () => {
    expect(validateWorkerMessage([{ type: 'WORKER_DUEL_CREATED', duelId: 'd1' }])).toBeNull();
  });

  it('rejects object without `type`', () => {
    expect(validateWorkerMessage({ duelId: 'd1' })).toBeNull();
  });

  it('rejects object with non-string `type`', () => {
    expect(validateWorkerMessage({ type: 42, duelId: 'd1' })).toBeNull();
  });

  it('rejects unknown type', () => {
    expect(validateWorkerMessage({ type: 'WORKER_UNKNOWN_VARIANT', duelId: 'd1' })).toBeNull();
  });

  // ==========================================================================
  // WORKER_DUEL_CREATED
  // ==========================================================================

  it('accepts WORKER_DUEL_CREATED with duelId', () => {
    const m = { type: 'WORKER_DUEL_CREATED', duelId: 'd1' };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('rejects WORKER_DUEL_CREATED without duelId', () => {
    expect(validateWorkerMessage({ type: 'WORKER_DUEL_CREATED' })).toBeNull();
  });

  // ==========================================================================
  // WORKER_MESSAGE — has nested message.type that must be string
  // ==========================================================================

  it('accepts WORKER_MESSAGE with valid inner message', () => {
    const m = { type: 'WORKER_MESSAGE', duelId: 'd1', message: { type: 'BOARD_STATE' } };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('rejects WORKER_MESSAGE without inner message', () => {
    expect(validateWorkerMessage({ type: 'WORKER_MESSAGE', duelId: 'd1' })).toBeNull();
  });

  it('rejects WORKER_MESSAGE with null inner message', () => {
    expect(validateWorkerMessage({ type: 'WORKER_MESSAGE', duelId: 'd1', message: null })).toBeNull();
  });

  it('rejects WORKER_MESSAGE with inner message lacking type', () => {
    expect(validateWorkerMessage({ type: 'WORKER_MESSAGE', duelId: 'd1', message: {} })).toBeNull();
  });

  it('rejects WORKER_MESSAGE with non-string inner message.type', () => {
    expect(validateWorkerMessage({ type: 'WORKER_MESSAGE', duelId: 'd1', message: { type: 99 } })).toBeNull();
  });

  // ==========================================================================
  // WORKER_ERROR / WORKER_REPLAY_ERROR / WORKER_FORK_ERROR — string fields
  // ==========================================================================

  it('accepts WORKER_ERROR with duelId+error', () => {
    const m = { type: 'WORKER_ERROR', duelId: 'd1', error: 'boom' };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('rejects WORKER_ERROR with missing error field', () => {
    expect(validateWorkerMessage({ type: 'WORKER_ERROR', duelId: 'd1' })).toBeNull();
  });

  it('accepts WORKER_REPLAY_ERROR with duelId+code+message', () => {
    const m = { type: 'WORKER_REPLAY_ERROR', duelId: 'd1', code: 'X', message: 'failed' };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('rejects WORKER_REPLAY_ERROR missing code', () => {
    expect(validateWorkerMessage({ type: 'WORKER_REPLAY_ERROR', duelId: 'd1', message: 'x' })).toBeNull();
  });

  it('accepts WORKER_FORK_ERROR with duelId+code+message', () => {
    const m = { type: 'WORKER_FORK_ERROR', duelId: 'd1', code: 'X', message: 'failed' };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  // ==========================================================================
  // WORKER_RETRY / WORKER_CANCEL_DONE — playerIndex must be 0 or 1
  // ==========================================================================

  it('accepts WORKER_RETRY with playerIndex=0', () => {
    const m = { type: 'WORKER_RETRY', duelId: 'd1', playerIndex: 0 };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('accepts WORKER_RETRY with playerIndex=1', () => {
    const m = { type: 'WORKER_RETRY', duelId: 'd1', playerIndex: 1 };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('rejects WORKER_RETRY with playerIndex=2', () => {
    expect(validateWorkerMessage({ type: 'WORKER_RETRY', duelId: 'd1', playerIndex: 2 })).toBeNull();
  });

  it('rejects WORKER_RETRY with non-numeric playerIndex', () => {
    expect(validateWorkerMessage({ type: 'WORKER_RETRY', duelId: 'd1', playerIndex: '0' })).toBeNull();
  });

  it('accepts WORKER_CANCEL_DONE with valid playerIndex', () => {
    const m = { type: 'WORKER_CANCEL_DONE', duelId: 'd1', playerIndex: 1 };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  // ==========================================================================
  // WORKER_REPLAY_DATA / WORKER_REPLAY_BOARD_STATES / WORKER_REPLAY_COMPLETE
  // ==========================================================================

  it('accepts WORKER_REPLAY_DATA with object payload', () => {
    const m = { type: 'WORKER_REPLAY_DATA', duelId: 'd1', payload: { seed: [], decks: [], playerResponses: [], metadata: {} } };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('rejects WORKER_REPLAY_DATA with null payload', () => {
    expect(validateWorkerMessage({ type: 'WORKER_REPLAY_DATA', duelId: 'd1', payload: null })).toBeNull();
  });

  it('rejects WORKER_REPLAY_DATA with non-object payload', () => {
    expect(validateWorkerMessage({ type: 'WORKER_REPLAY_DATA', duelId: 'd1', payload: 'bad' })).toBeNull();
  });

  it('accepts WORKER_REPLAY_BOARD_STATES with turnNumber+states array', () => {
    const m = { type: 'WORKER_REPLAY_BOARD_STATES', duelId: 'd1', turnNumber: 3, states: [] };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('rejects WORKER_REPLAY_BOARD_STATES with non-numeric turnNumber', () => {
    expect(validateWorkerMessage({ type: 'WORKER_REPLAY_BOARD_STATES', duelId: 'd1', turnNumber: '3', states: [] })).toBeNull();
  });

  it('rejects WORKER_REPLAY_BOARD_STATES with non-array states', () => {
    expect(validateWorkerMessage({ type: 'WORKER_REPLAY_BOARD_STATES', duelId: 'd1', turnNumber: 3, states: 'bad' })).toBeNull();
  });

  it('accepts WORKER_REPLAY_COMPLETE with duelId', () => {
    const m = { type: 'WORKER_REPLAY_COMPLETE', duelId: 'd1' };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  // ==========================================================================
  // WORKER_FORK_READY — sanityResult.match boolean required
  // ==========================================================================

  it('accepts WORKER_FORK_READY with sanityResult.match=true', () => {
    const m = { type: 'WORKER_FORK_READY', duelId: 'd1', sanityResult: { match: true } };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('accepts WORKER_FORK_READY with sanityResult.match=false + details', () => {
    const m = { type: 'WORKER_FORK_READY', duelId: 'd1', sanityResult: { match: false, details: 'lp diverged' } };
    expect(validateWorkerMessage(m)).toBe(m);
  });

  it('rejects WORKER_FORK_READY without sanityResult', () => {
    expect(validateWorkerMessage({ type: 'WORKER_FORK_READY', duelId: 'd1' })).toBeNull();
  });

  it('rejects WORKER_FORK_READY with non-boolean sanityResult.match', () => {
    expect(validateWorkerMessage({ type: 'WORKER_FORK_READY', duelId: 'd1', sanityResult: { match: 'yes' } })).toBeNull();
  });

  // ==========================================================================
  // Identity preservation — validator returns the SAME object on success
  // ==========================================================================

  it('returns the same object reference on success (not a copy)', () => {
    const m = { type: 'WORKER_DUEL_CREATED', duelId: 'd1' };
    expect(validateWorkerMessage(m)).toBe(m);
  });
});
