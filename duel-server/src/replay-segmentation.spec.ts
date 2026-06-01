import { describe, it, expect } from 'vitest';
import { SEGMENTATION, getSegmentationAction, type SegmentationAction } from './replay-segmentation.js';

/**
 * U12 (audit-4-modes-2026-06-01) — spec parametrisée sur l'union complète
 * `ServerMessage['type']`. The taxonomy in `replay-segmentation.ts` is
 * `Record<ServerMessage['type'], SegmentationAction>` — TS already
 * enforces exhaustiveness at compile time. This spec adds runtime
 * verification + pins the classification for the 4 sites currently
 * handled inline by `runReplayPreComputation`'s ladder (so a refactor
 * that mis-classifies one of them gets caught here BEFORE it lands in
 * the precompute).
 */
describe('replay-segmentation (U12)', () => {
  const VALID_ACTIONS: ReadonlySet<SegmentationAction> = new Set(
    ['flush-before', 'accumulate', 'skip', 'not-an-event'] as const,
  );

  it('every ServerMessage type has a documented SegmentationAction', () => {
    const entries = Object.entries(SEGMENTATION);
    expect(entries.length).toBeGreaterThan(0);
    for (const [type, action] of entries) {
      expect(VALID_ACTIONS.has(action as SegmentationAction)).toBe(true);
      // Sanity — the lookup helper returns the same answer.
      expect(getSegmentationAction(type as never)).toBe(action);
    }
  });

  it('MSG_CHAINING is flush-before (replay-precompute.ts:407 ladder)', () => {
    expect(SEGMENTATION.MSG_CHAINING).toBe('flush-before');
  });

  it('MSG_CHAIN_END is flush-before + acts as separator (replay-precompute.ts:414)', () => {
    expect(SEGMENTATION.MSG_CHAIN_END).toBe('flush-before');
  });

  it('label-skip metadata types are classified as skip (replay-precompute.ts:137 SKIP_TYPES set)', () => {
    expect(SEGMENTATION.WAITING_RESPONSE).toBe('skip');
    expect(SEGMENTATION.MSG_CHAIN_SOLVING).toBe('skip');
    expect(SEGMENTATION.MSG_CHAIN_SOLVED).toBe('skip');
    expect(SEGMENTATION.MSG_HINT).toBe('skip');
    expect(SEGMENTATION.MSG_CONFIRM_CARDS).toBe('skip');
  });

  it('visual MSG_* types default to accumulate', () => {
    // Spot-check the most common visual events — the type-level Record
    // forces exhaustiveness, so we don't need to enumerate them all here.
    expect(SEGMENTATION.MSG_MOVE).toBe('accumulate');
    expect(SEGMENTATION.MSG_DRAW).toBe('accumulate');
    expect(SEGMENTATION.MSG_DAMAGE).toBe('accumulate');
    expect(SEGMENTATION.MSG_RECOVER).toBe('accumulate');
    expect(SEGMENTATION.MSG_ATTACK).toBe('accumulate');
    expect(SEGMENTATION.MSG_FLIP_SUMMONING).toBe('accumulate');
    expect(SEGMENTATION.MSG_CHANGE_POS).toBe('accumulate');
  });

  it('SELECT_*/SORT_*/ANNOUNCE_* prompts are not-an-event (fed as decisions, not events)', () => {
    expect(SEGMENTATION.SELECT_CARD).toBe('not-an-event');
    expect(SEGMENTATION.SELECT_CHAIN).toBe('not-an-event');
    expect(SEGMENTATION.SELECT_IDLECMD).toBe('not-an-event');
    expect(SEGMENTATION.SELECT_BATTLECMD).toBe('not-an-event');
    expect(SEGMENTATION.SORT_CARD).toBe('not-an-event');
    expect(SEGMENTATION.ANNOUNCE_CARD).toBe('not-an-event');
  });

  it('transport/system messages are not-an-event', () => {
    expect(SEGMENTATION.BOARD_STATE).toBe('not-an-event');
    expect(SEGMENTATION.DUEL_END).toBe('not-an-event');
    expect(SEGMENTATION.STATE_SYNC).toBe('not-an-event');
    expect(SEGMENTATION.SESSION_TOKEN).toBe('not-an-event');
    expect(SEGMENTATION.TIMER_STATE).toBe('not-an-event');
    expect(SEGMENTATION.INACTIVITY_WARNING).toBe('not-an-event');
  });

  it('getSegmentationAction falls back to accumulate for unknown types (defensive)', () => {
    // Real prod code can't reach this branch (Record exhaustiveness), but a
    // dev test fixture or a stray cast might — assert the safe default.
    expect(getSegmentationAction('NEVER_DEFINED_TYPE' as never)).toBe('accumulate');
  });
});
