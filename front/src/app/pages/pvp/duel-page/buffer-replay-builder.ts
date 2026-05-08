import { inject, Injectable } from '@angular/core';
import type { GameEvent } from '../types';
import type { CardInfo, ConfirmCardsMsg, DrawMsg, MoveMsg } from '../duel-ws.types';
import { LOCATION } from '../duel-ws.types';
import { ANIMATION_DATA_SOURCE, type QueueEntry } from './animation-data-source';
import { GROUP_STAGGER_MS } from './animation-constants';
import { DrawSequenceManager } from './draw-sequence-manager';
import { DuelContext } from './duel-context';
import { DuelLogCategory, DuelLogger } from './duel-logger';
import { LpAnimationTracker } from './lp-animation-tracker';
import { MoveAnimationRouter } from './move-animation-router';

/**
 * Set of event types known to be safe to replay from the chain buffer.
 * Anything outside this set logs a warning at build time — it indicates
 * a server protocol addition that hasn't been integrated.
 */
const KNOWN_BUFFER_TYPES = new Set([
  'MSG_MOVE', 'MSG_DRAW', 'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
  'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_SET', 'MSG_SHUFFLE_HAND',
  'MSG_CONFIRM_CARDS', 'MSG_SHUFFLE_DECK', 'MSG_TOSS_COIN', 'MSG_TOSS_DICE',
  'MSG_EQUIP', 'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER', 'MSG_SHUFFLE_SET_CARD',
  'MSG_SWAP_GRAVE_DECK', 'MSG_BECOME_TARGET', 'MSG_SWAP',
]);

const isZoneEvent = (e: GameEvent): boolean =>
  e.type === 'MSG_MOVE' || e.type === 'MSG_DRAW';
const isLpEvent = (e: GameEvent): boolean =>
  e.type === 'MSG_DAMAGE' || e.type === 'MSG_RECOVER' || e.type === 'MSG_PAY_LPCOST';
const isOverlayDetach = (e: GameEvent): boolean =>
  e.type === 'MSG_MOVE' && (e as MoveMsg).fromLocation === LOCATION.OVERLAY;

export interface BuiltBatch {
  /** Queue entries ready to prepend to the animation queue. */
  batch: QueueEntry[];
  /**
   * Cleanup callback to invoke at batch-end: releases the session HAND locks
   * acquired for the duration of the batch and retires hand-batch expansion
   * slots so the post-commit fan lays out against the final card count.
   *
   * NOTE: caller is responsible for invoking this in its `batch-end` directive's
   * resolve handler; the builder itself never holds a reference past return.
   */
  releaseSessionLocks: () => void;
}

/**
 * Builds the QueueEntry batch for `replayBuffer`. Pure transform from a
 * chain buffer into a directive sequence ready for the animation queue.
 *
 * Responsibilities (extracted from AnimationOrchestratorService):
 *   1. Interleave aggregated MSG_CONFIRM_CARDS with their matching MOVE→HAND
 *      events, producing a tutor→reveal flow.
 *   2. Acquire session HAND locks for any player with a HAND-touching MOVE
 *      and reserve hand-batch expansion slots upfront.
 *   3. Pre-lock all zone-event sources via MoveAnimationRouter.
 *   4. Group consecutive zone events with stagger + barrier, splitting at
 *      overlay-detach category boundaries (XYZ destroy pattern).
 *
 * Side effects on injected deps (lockZone, beginHandBatch, preLockQueuedSources)
 * are intentional — they MUST happen synchronously with batch construction
 * so the orchestrator's prependToQueue sees a coherent locked state.
 *
 * Provided at component level (NOT root) — same lifetime as the orchestrator.
 */
@Injectable()
export class BufferReplayBuilder {
  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly ctx = inject(DuelContext);
  private readonly logger = inject(DuelLogger);
  private readonly drawManager = inject(DrawSequenceManager);
  private readonly moveRouter = inject(MoveAnimationRouter);
  private readonly lpTracker = inject(LpAnimationTracker);

  private get rbs() { return this.dataSource.renderedBoardState; }

  /**
   * Reduced-motion fast-path: apply zone events instantly via their handlers,
   * commit all locks, then fire LP events. No animation, no batch.
   */
  applyReducedMotion(buffer: readonly GameEvent[]): void {
    for (const event of buffer) {
      if (event.type === 'MSG_MOVE') this.moveRouter.processMoveEvent(event as MoveMsg);
      else if (event.type === 'MSG_DRAW') this.drawManager.processDrawEvent(event as DrawMsg);
    }
    this.rbs.commitAll();
    for (const event of buffer) {
      if (event.type === 'MSG_DAMAGE' || event.type === 'MSG_RECOVER' || event.type === 'MSG_PAY_LPCOST') {
        this.lpTracker.fireLpReplayEvent(event);
      }
    }
  }

  /**
   * Build the batch. Side-effects: lockZone(HAND-N), beginHandBatch(),
   * preLockQueuedSources() — see class docstring.
   */
  build(buffer: readonly GameEvent[]): BuiltBatch {
    const unknown = buffer.filter(e => !KNOWN_BUFFER_TYPES.has(e.type));
    if (unknown.length) {
      this.logger.warn('replayBuffer: %d unknown event type(s): %o', unknown.length, unknown.map(e => e.type));
    }

    const interleaved = this.interleaveConfirmsWithMoves(buffer);

    // Session HAND lock + expansion-slot batch: hold HAND across the entire
    // buffer replay so travelToHand/discardFromHand inner commits only
    // decrement their own ref-count without firing commitZone(HAND). This
    // keeps rendered HAND at its pre-chain state throughout the sequence,
    // otherwise:
    //   - For tutors: the first tutor's commit would snap rendered HAND to
    //     the pre-computed FINAL logical state mid-way.
    //   - For discards: the first discard's commit would remove the
    //     subsequent cards from the HAND DOM, breaking
    //     `resolveHandTarget(HAND, fromSeq)` for discard 2/3 — they'd
    //     animate from the HAND zone centre instead of their real card
    //     position.
    //
    // Also reserves N distinct expansion slots per affected player via
    // `drawManager.beginHandBatch` (only for MOVE→HAND), so tutor1 lands at
    // slot 0, tutor2 at slot 1, etc., each keeping the fan's per-index
    // rotation. Released at batch-end.
    const sessionHandLocks: Array<{ commit(): void; release(): void }> = [];
    const handMoveCountByRelPlayer = new Map<0 | 1, number>();
    const handInvolvedRelPlayers = new Set<0 | 1>();
    for (const e of interleaved) {
      if (e.type !== 'MSG_MOVE') continue;
      const mm = e as MoveMsg;
      const touchesHand = mm.toLocation === LOCATION.HAND || mm.fromLocation === LOCATION.HAND;
      if (!touchesHand) continue;
      const rp = this.ctx.relativePlayer(mm.player);
      handInvolvedRelPlayers.add(rp);
      if (mm.toLocation === LOCATION.HAND) {
        handMoveCountByRelPlayer.set(rp, (handMoveCountByRelPlayer.get(rp) ?? 0) + 1);
      }
    }
    for (const rp of handInvolvedRelPlayers) {
      sessionHandLocks.push(this.rbs.lockZone(`HAND-${rp}`));
    }
    for (const [rp, count] of handMoveCountByRelPlayer) {
      this.drawManager.beginHandBatch(rp, count);
    }

    // Pre-lock all zone event sources across the entire buffer
    this.moveRouter.preLockQueuedSources(interleaved.filter(isZoneEvent));

    // Build batch preserving buffer chronology.
    // Consecutive zone events (MSG_MOVE/MSG_DRAW) are grouped for parallel
    // travel with stagger; a barrier follows each group so subsequent events
    // see cards in their final positions. When a single-card CONFIRM has been
    // inlined right after a MOVE→HAND (see interleaveConfirmsWithMoves), the
    // MOVE becomes a group of one, followed by barrier and its reveal.
    const batch: QueueEntry[] = [];
    let pendingGroup: GameEvent[] = [];

    const flushGroup = () => {
      if (pendingGroup.length === 0) return;
      batch.push({ kind: 'group', events: pendingGroup, staggerMs: GROUP_STAGGER_MS });
      batch.push({ kind: 'barrier' });
      pendingGroup = [];
    };

    // A zone event is an "overlay detach" when its source is the OVERLAY
    // location. We split the group at the boundary between overlay detach
    // events and other zone events so XYZ destruction plays cleanly:
    //   detach material 1 + detach material 2 (parallel, ~600ms)
    //   └─ barrier ─┘
    //   destroy monster (next group, ~400ms)
    // Without the split, all three animate together: the monster's
    // `preDestroyEffect` captures a srcEl that still holds the sliding-out
    // overlay children, and the monster finishes disappearing before its
    // materials finish their slide-out.
    for (const e of interleaved) {
      if (isZoneEvent(e)) {
        const last = pendingGroup[pendingGroup.length - 1];
        if (last && isOverlayDetach(last) !== isOverlayDetach(e)) {
          flushGroup();
        }
        pendingGroup.push(e);
      } else {
        flushGroup();
        batch.push(isLpEvent(e) ? { kind: 'lp', event: e } : e);
      }
    }
    flushGroup();

    const releaseSessionLocks = () => {
      // Safety release: processShuffleEvent's commitAll() clears locks during
      // normal shuffle flow, and each lock's .release() is idempotent via the
      // internal `released` flag. Release all here so the last remaining
      // session lock drops HAND ref-count to the travelToHand commits' level
      // and commitZone(HAND) fires with the final logical state. Also
      // retires the hand-batch expansion slots so the post-commit fan lays
      // out against the final card count.
      for (const rp of handMoveCountByRelPlayer.keys()) {
        this.drawManager.endHandBatch(rp);
      }
      for (const l of sessionHandLocks) l.release();
    };

    this.logger.log(DuelLogCategory.REPLAY, 'BufferReplayBuilder.build — bufferLen=%d directives=%d',
      buffer.length, batch.filter(e => 'kind' in e).length);

    return { batch, releaseSessionLocks };
  }

  /**
   * Split aggregated MSG_CONFIRM_CARDS into per-card reveals inlined right
   * after each matching MOVE→HAND, so the visual flow becomes
   * `tutor1 → reveal1 → tutor2 → reveal2 → … → (unmatched remainder)`.
   *
   * Matching: confirm card is matched to the earliest unconsumed preceding
   * MOVE→HAND with the same (cardCode, player) AND the confirm card's
   * location === HAND. Unmatched cards stay as a reduced CONFIRM at the
   * original CONFIRM position (or, if multiple CONFIRMs share the same
   * position, accumulated per-CONFIRM-event).
   *
   * Implementation (O(n), M12 fix): two passes with no splice.
   *   - Pass 1 builds a per-key FIFO of MOVE→HAND events from the buffer
   *     and walks each CONFIRM in chronological order, popping from the
   *     FIFO to assign single-card CONFIRMs to specific MOVEs (stored in
   *     a Map<MoveMsg, ConfirmCardsMsg[]>) and accumulating unmatched
   *     cards into a remainder per original CONFIRM index.
   *   - Pass 2 emits the buffer in order, inlining the per-MOVE inserts
   *     after each MOVE and the remainder CONFIRM at its original index.
   *
   * Replaces the prior O(n²) implementation that scanned `interleaved` for
   * each card. Behavior is preserved: same earliest-unconsumed match rule,
   * same remainder placement, same single-card output shape. Validated by
   * the spec invariants in buffer-replay-builder.spec.ts (24 tests).
   *
   * Public for unit testing — the orchestrator does NOT call this directly,
   * `build()` invokes it internally.
   */
  interleaveConfirmsWithMoves(buffer: readonly GameEvent[]): GameEvent[] {
    const matchKey = (player: number, cardCode: number) => `${player}:${cardCode}`;

    // Pass 1: assign matches.
    const fifoByKey = new Map<string, MoveMsg[]>();
    const insertedAfter = new Map<MoveMsg, ConfirmCardsMsg[]>();
    // Per original-buffer-index → reduced CONFIRM (or null when no remainder).
    const remainderAtIndex = new Map<number, ConfirmCardsMsg>();

    for (let i = 0; i < buffer.length; i++) {
      const e = buffer[i];
      if (e.type === 'MSG_MOVE') {
        const mm = e as MoveMsg;
        if (mm.toLocation === LOCATION.HAND) {
          const key = matchKey(mm.player, mm.cardCode);
          const list = fifoByKey.get(key);
          if (list) list.push(mm);
          else fifoByKey.set(key, [mm]);
        }
        continue;
      }
      if (e.type !== 'MSG_CONFIRM_CARDS') continue;

      const confirmMsg = e as ConfirmCardsMsg;
      const remaining: CardInfo[] = [];
      for (const card of confirmMsg.cards) {
        if (card.location !== LOCATION.HAND) {
          remaining.push(card);
          continue;
        }
        const key = matchKey(card.player, card.cardCode);
        const list = fifoByKey.get(key);
        const matchedMove = list && list.length > 0 ? list.shift()! : null;
        if (!matchedMove) {
          remaining.push(card);
          continue;
        }
        const inserts = insertedAfter.get(matchedMove);
        const single: ConfirmCardsMsg = {
          type: 'MSG_CONFIRM_CARDS',
          player: confirmMsg.player,
          cards: [card],
        } as ConfirmCardsMsg;
        if (inserts) inserts.push(single);
        else insertedAfter.set(matchedMove, [single]);
      }
      if (remaining.length > 0) {
        remainderAtIndex.set(i, { ...confirmMsg, cards: remaining } as ConfirmCardsMsg);
      }
    }

    // Pass 2: emit in order. Original CONFIRM positions are skipped — their
    // remainder (if any) is appended at the end to preserve the prior
    // implementation's behavior (which used `interleaved.push(remaining)`
    // after walking the buffer).
    const out: GameEvent[] = [];
    const remainderAppendOrder: ConfirmCardsMsg[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const e = buffer[i];
      if (e.type === 'MSG_CONFIRM_CARDS') {
        const r = remainderAtIndex.get(i);
        if (r) remainderAppendOrder.push(r);
        continue;
      }
      out.push(e);
      if (e.type === 'MSG_MOVE') {
        const inserts = insertedAfter.get(e as MoveMsg);
        if (inserts) for (const c of inserts) out.push(c);
      }
    }
    for (const r of remainderAppendOrder) out.push(r);
    return out;
  }
}
